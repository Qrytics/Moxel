import { MoxelDocument, structuredCloneNode } from './document';
import { readRect } from './pixels';
import { celKey, type DocMeta, type DocNode, type Frame, type GroupNode, type Rect } from './types';

/**
 * Every document mutation is an Op: a plain, structured-clone-friendly object. `applyOp` performs
 * it and returns the inverse Op, which is all undo/redo needs — and because Ops are data, the same
 * objects are what a live session sends to peers.
 */
export type NodeProps = Partial<
	Pick<DocNode, 'name' | 'visible' | 'locked' | 'opacity' | 'blend' | 'owner'> & { collapsed: boolean }
>;
export type MetaProps = Partial<
	Pick<DocMeta, 'name' | 'animation' | 'palette' | 'skin' | 'texture' | 'paint'>
>;

export type Op =
	| {
			t: 'patch';
			layerId: string;
			frameId: string;
			rect: Rect;
			data: Uint8ClampedArray;
			/** When present, a pixel is only written if it currently equals `expect` — see `invertPatch`. */
			expect?: Uint8ClampedArray;
	  }
	| {
			t: 'addNodes';
			parentId: string | null;
			index: number;
			nodes: DocNode[];
			cels: [string, Uint8ClampedArray][];
	  }
	| { t: 'removeNode'; id: string }
	| { t: 'moveNode'; id: string; parentId: string | null; index: number }
	| { t: 'setNode'; id: string; props: NodeProps }
	| { t: 'addFrame'; frame: Frame; index: number; cels: [string, Uint8ClampedArray][] }
	| { t: 'removeFrame'; id: string }
	| { t: 'moveFrame'; id: string; index: number }
	| { t: 'setFrame'; id: string; props: Partial<Omit<Frame, 'id'>> }
	| { t: 'setMeta'; props: MetaProps }
	| { t: 'canvas'; width: number; height: number; cels: [string, Uint8ClampedArray][] };

export type OpType = Op['t'];

export const STRUCTURAL_OPS: ReadonlySet<OpType> = new Set([
	'addNodes',
	'removeNode',
	'moveNode',
	'setNode',
	'addFrame',
	'removeFrame',
	'moveFrame',
	'setFrame',
	'canvas'
]);

/** Apply an op. Returns its inverse, or null when the op no longer applies (e.g. a peer already deleted the target). */
export function applyOp(doc: MoxelDocument, op: Op): Op | null {
	switch (op.t) {
		case 'patch':
			return applyPatch(doc, op);
		case 'addNodes': {
			if (op.nodes.length === 0 || doc.nodes.has(op.nodes[0].id)) return null;
			const siblings = parentList(doc, op.parentId);
			if (!siblings) return null;
			for (const n of op.nodes) doc.nodes.set(n.id, structuredCloneNode(n));
			siblings.splice(clampIndex(op.index, siblings.length), 0, op.nodes[0].id);
			const size = doc.width * doc.height * 4;
			for (const [k, v] of op.cels) if (v.length === size) doc.cels.set(k, new Uint8ClampedArray(v));
			doc.emit({ type: 'structure' });
			return { t: 'removeNode', id: op.nodes[0].id };
		}
		case 'removeNode': {
			const parentId = doc.parentOf(op.id);
			if (parentId === undefined) return null;
			const siblings = doc.childrenOf(parentId);
			const index = siblings.indexOf(op.id);
			const nodes = doc.subtree(op.id).map(structuredCloneNode);
			const cels: [string, Uint8ClampedArray][] = [];
			for (const n of nodes) {
				if (n.type !== 'layer') continue;
				for (const f of doc.frames) {
					const k = celKey(n.id, f.id);
					const c = doc.cels.get(k);
					if (c) {
						cels.push([k, c]);
						doc.cels.delete(k);
					}
				}
			}
			for (const n of nodes) doc.nodes.delete(n.id);
			siblings.splice(index, 1);
			doc.emit({ type: 'structure' });
			return { t: 'addNodes', parentId, index, nodes, cels };
		}
		case 'moveNode': {
			const from = doc.parentOf(op.id);
			if (from === undefined) return null;
			if (op.parentId !== null && (op.parentId === op.id || doc.isAncestor(op.id, op.parentId))) return null;
			const target = parentList(doc, op.parentId);
			if (!target) return null;
			const src = doc.childrenOf(from);
			const oldIndex = src.indexOf(op.id);
			src.splice(oldIndex, 1);
			target.splice(clampIndex(op.index, target.length), 0, op.id);
			doc.emit({ type: 'structure' });
			return { t: 'moveNode', id: op.id, parentId: from, index: oldIndex };
		}
		case 'setNode': {
			const n = doc.nodes.get(op.id);
			if (!n) return null;
			const prev: Record<string, unknown> = {};
			const rec = n as unknown as Record<string, unknown>;
			for (const [k, v] of Object.entries(op.props)) {
				if (k === 'collapsed' && n.type !== 'group') continue;
				prev[k] = rec[k];
				if (v === undefined) delete rec[k];
				else rec[k] = v;
			}
			doc.emit({ type: 'structure' });
			return { t: 'setNode', id: op.id, props: prev as NodeProps };
		}
		case 'addFrame': {
			if (doc.frames.some((f) => f.id === op.frame.id)) return null;
			doc.frames.splice(clampIndex(op.index, doc.frames.length), 0, { ...op.frame });
			const size = doc.width * doc.height * 4;
			for (const [k, v] of op.cels) if (v.length === size) doc.cels.set(k, new Uint8ClampedArray(v));
			doc.emit({ type: 'structure' });
			return { t: 'removeFrame', id: op.frame.id };
		}
		case 'removeFrame': {
			const index = doc.frameIndex(op.id);
			if (index < 0 || doc.frames.length <= 1) return null;
			const [frame] = doc.frames.splice(index, 1);
			const cels: [string, Uint8ClampedArray][] = [];
			for (const [k, v] of [...doc.cels]) {
				if (k.endsWith(`:${op.id}`)) {
					cels.push([k, v]);
					doc.cels.delete(k);
				}
			}
			doc.emit({ type: 'structure' });
			return { t: 'addFrame', frame, index, cels };
		}
		case 'moveFrame': {
			const index = doc.frameIndex(op.id);
			if (index < 0) return null;
			const [frame] = doc.frames.splice(index, 1);
			doc.frames.splice(clampIndex(op.index, doc.frames.length), 0, frame);
			doc.emit({ type: 'structure' });
			return { t: 'moveFrame', id: op.id, index };
		}
		case 'setFrame': {
			const f = doc.frames.find((fr) => fr.id === op.id);
			if (!f) return null;
			const prev: Partial<Frame> = {};
			for (const [k, v] of Object.entries(op.props) as [keyof Frame, number][]) {
				(prev as Record<string, unknown>)[k] = f[k];
				(f as unknown as Record<string, unknown>)[k] = v;
			}
			doc.emit({ type: 'structure' });
			return { t: 'setFrame', id: op.id, props: prev };
		}
		case 'setMeta': {
			const prev: Record<string, unknown> = {};
			const meta = doc.meta as unknown as Record<string, unknown>;
			for (const [k, v] of Object.entries(op.props)) {
				const old = meta[k];
				prev[k] = Array.isArray(old) ? [...old] : old && typeof old === 'object' ? { ...old } : old;
				meta[k] = Array.isArray(v) ? [...v] : v && typeof v === 'object' ? { ...v } : v;
			}
			doc.emit({ type: 'meta' });
			return { t: 'setMeta', props: prev as MetaProps };
		}
		case 'canvas': {
			const prev: Op = { t: 'canvas', width: doc.width, height: doc.height, cels: [...doc.cels] };
			doc.meta.width = op.width;
			doc.meta.height = op.height;
			doc.cels = new Map(op.cels.map(([k, v]) => [k, new Uint8ClampedArray(v)]));
			doc.emit({ type: 'reset' });
			return prev;
		}
	}
}

function applyPatch(doc: MoxelDocument, op: Extract<Op, { t: 'patch' }>): Op | null {
	if (!doc.getLayer(op.layerId) || doc.frameIndex(op.frameId) < 0) return null;
	const { rect } = op;
	if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > doc.width || rect.y + rect.h > doc.height) return null;
	if (op.data.length !== rect.w * rect.h * 4) return null;
	const cel = doc.ensureCel(op.layerId, op.frameId);
	const before = readRect(cel, doc.width, rect);
	const { data, expect } = op;
	for (let y = 0; y < rect.h; y++) {
		let d = ((rect.y + y) * doc.width + rect.x) * 4;
		let s = y * rect.w * 4;
		for (let x = 0; x < rect.w; x++, d += 4, s += 4) {
			if (
				expect &&
				(cel[d] !== expect[s] ||
					cel[d + 1] !== expect[s + 1] ||
					cel[d + 2] !== expect[s + 2] ||
					cel[d + 3] !== expect[s + 3])
			)
				continue;
			cel[d] = data[s];
			cel[d + 1] = data[s + 1];
			cel[d + 2] = data[s + 2];
			cel[d + 3] = data[s + 3];
		}
	}
	const after = readRect(cel, doc.width, rect);
	doc.emit({ type: 'pixels', layerId: op.layerId, frameId: op.frameId, rect });
	return invertPatch(op.layerId, op.frameId, rect, before, after);
}

/**
 * The inverse of a patch restores `before`, but only on pixels still holding `after`. Locally that
 * is always true; in a live session it means undoing your stroke never erases a friend's later
 * stroke over the same pixels.
 */
export function invertPatch(
	layerId: string,
	frameId: string,
	rect: Rect,
	before: Uint8ClampedArray,
	after: Uint8ClampedArray
): Op {
	return { t: 'patch', layerId, frameId, rect, data: before, expect: after };
}

function parentList(doc: MoxelDocument, parentId: string | null): string[] | null {
	if (parentId === null) return doc.root;
	const g = doc.nodes.get(parentId);
	return g && g.type === 'group' ? (g as GroupNode).children : null;
}

function clampIndex(i: number, len: number) {
	return Math.max(0, Math.min(len, Math.floor(i)));
}

export function opBytes(op: Op): number {
	switch (op.t) {
		case 'patch':
			return op.data.length + (op.expect?.length ?? 0) + 64;
		case 'addNodes':
		case 'addFrame':
		case 'canvas':
			return op.cels.reduce((s, [, v]) => s + v.length, 128);
		default:
			return 128;
	}
}
