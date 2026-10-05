import type { MoxelDocument } from '../core/document/document';
import { newLayer } from '../core/document/document';
import type { Op } from '../core/document/ops';
import { applyOp } from '../core/document/ops';
import { celKey, type DocNode, type Frame, type Rect } from '../core/document/types';

/**
 * Convergence for a shared canvas.
 *
 * Pixels: every pixel carries a stamp (Lamport clock × 16 + a per-peer tiebreak). A remote pixel
 * write only lands if its stamp is newer, so peers that see the same strokes in different orders
 * still end with identical pixels (last-writer-wins per pixel). Only pixels a stroke actually
 * changed are sent and stamped, so two friends drawing side by side never erase each other.
 *
 * Structure (layers, frames): ops are applied as they arrive (they're written to be idempotent) and
 * the host periodically broadcasts its authoritative tree, which every peer adopts.
 */

export interface NetPatch {
	layerId: string;
	frameId: string;
	rect: Rect;
	/** RGBA of the changed pixels' new values (rect-sized; unchanged pixels are ignored). */
	after: Uint8ClampedArray;
	/** One byte per pixel: 1 = this pixel changed. */
	changed: Uint8Array;
	stamp: number;
}

export interface StructureSnapshot {
	root: string[];
	nodes: DocNode[];
	frames: Frame[];
	animation: MoxelDocument['meta']['animation'];
	name: string;
	model?: 'classic' | 'slim';
}

export function peerTiebreak(peerId: string): number {
	let h = 0;
	for (let i = 0; i < peerId.length; i++) h = (h * 31 + peerId.charCodeAt(i)) >>> 0;
	return h % 16;
}

export class SyncState {
	lamport = 0;
	private stamps = new Map<string, Uint32Array>();
	readonly tiebreak: number;

	constructor(
		private doc: MoxelDocument,
		readonly peerId: string
	) {
		this.tiebreak = peerTiebreak(peerId);
	}

	setDocument(doc: MoxelDocument) {
		this.doc = doc;
		this.stamps.clear();
	}

	observe(stamp: number) {
		this.lamport = Math.max(this.lamport, Math.floor(stamp / 16));
	}

	nextStamp() {
		this.lamport++;
		return this.lamport * 16 + this.tiebreak;
	}

	private stampsFor(layerId: string, frameId: string) {
		const k = celKey(layerId, frameId);
		let s = this.stamps.get(k);
		if (!s || s.length !== this.doc.width * this.doc.height) {
			s = new Uint32Array(this.doc.width * this.doc.height);
			this.stamps.set(k, s);
		}
		return s;
	}

	/**
	 * Turn a locally applied patch (as seen through its inverse: before = inv.data,
	 * after = inv.expect) into a network patch, stamping the pixels it changed.
	 */
	localPatch(inverse: Extract<Op, { t: 'patch' }>): NetPatch | null {
		const before = inverse.data;
		const after = inverse.expect;
		if (!after) return null;
		const { rect } = inverse;
		const changed = new Uint8Array(rect.w * rect.h);
		let any = false;
		for (let i = 0; i < changed.length; i++) {
			const p = i * 4;
			if (
				before[p] !== after[p] ||
				before[p + 1] !== after[p + 1] ||
				before[p + 2] !== after[p + 2] ||
				before[p + 3] !== after[p + 3]
			) {
				changed[i] = 1;
				any = true;
			}
		}
		if (!any) return null;
		const stamp = this.nextStamp();
		const stamps = this.stampsFor(inverse.layerId, inverse.frameId);
		const W = this.doc.width;
		for (let y = 0; y < rect.h; y++)
			for (let x = 0; x < rect.w; x++)
				if (changed[y * rect.w + x]) stamps[(rect.y + y) * W + rect.x + x] = stamp;
		return { layerId: inverse.layerId, frameId: inverse.frameId, rect, after, changed, stamp };
	}

	/** Apply a peer's patch with last-writer-wins per pixel. Returns true if anything changed. */
	applyRemotePatch(p: NetPatch): boolean {
		this.observe(p.stamp);
		const doc = this.doc;
		if (!doc.getLayer(p.layerId) || doc.frameIndex(p.frameId) < 0) return false;
		const { rect } = p;
		if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > doc.width || rect.y + rect.h > doc.height) return false;
		if (p.after.length !== rect.w * rect.h * 4 || p.changed.length !== rect.w * rect.h) return false;
		const cel = doc.ensureCel(p.layerId, p.frameId);
		const stamps = this.stampsFor(p.layerId, p.frameId);
		const W = doc.width;
		let any = false;
		for (let y = 0; y < rect.h; y++)
			for (let x = 0; x < rect.w; x++) {
				const i = y * rect.w + x;
				if (!p.changed[i]) continue;
				const di = (rect.y + y) * W + rect.x + x;
				if (p.stamp <= stamps[di]) continue;
				stamps[di] = p.stamp;
				cel.set(p.after.subarray(i * 4, i * 4 + 4), di * 4);
				any = true;
			}
		if (any) doc.emit({ type: 'pixels', layerId: p.layerId, frameId: p.frameId, rect });
		return any;
	}

	/** Apply a peer's structural op (no local undo entry; undo stays per-user). */
	applyRemoteOp(op: Op) {
		if (op.t === 'canvas') this.stamps.clear();
		applyOp(this.doc, op);
	}
}

export function structureOf(doc: MoxelDocument): StructureSnapshot {
	return {
		root: [...doc.root],
		nodes: [...doc.nodes.values()].map((n) =>
			n.type === 'group' ? { ...n, children: [...n.children] } : { ...n }
		),
		frames: doc.frames.map((f) => ({ ...f })),
		animation: { ...doc.meta.animation },
		name: doc.meta.name,
		model: doc.meta.skin?.model
	};
}

/** Adopt the host's layer tree and frame list, keeping local pixels for everything that still exists. */
export function reconcileStructure(doc: MoxelDocument, s: StructureSnapshot): boolean {
	const before = JSON.stringify(structureOf(doc));
	const wanted = new Map(s.nodes.map((n) => [n.id, n]));
	for (const id of [...doc.nodes.keys()]) {
		if (!wanted.has(id)) {
			doc.nodes.delete(id);
			for (const k of [...doc.cels.keys()]) if (k.startsWith(`${id}:`)) doc.cels.delete(k);
		}
	}
	for (const n of s.nodes) {
		const cur = doc.nodes.get(n.id);
		if (!cur) doc.nodes.set(n.id, n.type === 'group' ? { ...n, children: [...n.children] } : { ...n });
		else Object.assign(cur, n.type === 'group' ? { ...n, children: [...n.children] } : n);
	}
	doc.root = [...s.root];
	const frameIds = new Set(s.frames.map((f) => f.id));
	for (const k of [...doc.cels.keys()]) if (!frameIds.has(k.split(':')[1])) doc.cels.delete(k);
	doc.frames = s.frames.map((f) => ({ ...f }));
	doc.meta.animation = { ...s.animation };
	doc.meta.name = s.name;
	if (s.model && doc.meta.skin) doc.meta.skin.model = s.model;
	doc.validateTree();
	if (doc.layersBottomUp().length === 0) {
		const l = newLayer('Layer 1');
		doc.nodes.set(l.id, l);
		doc.root.push(l.id);
	}
	const changed = JSON.stringify(structureOf(doc)) !== before;
	if (changed) doc.emit({ type: 'structure' });
	return changed;
}
