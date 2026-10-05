import { uid } from '../id';
import type { History } from '../history/history';
import { compositeFrame, blendInto } from '../render/composite';
import { MoxelDocument, newGroup, newLayer, structuredCloneNode } from './document';
import type { NodeProps, Op } from './ops';
import { readRect } from './pixels';
import { celKey, type DocNode, type Frame } from './types';

/**
 * User-level document commands. Each is one undoable history entry built out of Ops; the UI and
 * tools call these instead of touching the document directly.
 */
export class DocCommands {
	constructor(
		readonly doc: MoxelDocument,
		readonly history: History
	) {}

	// ── layers ────────────────────────────────────────────────────────────────

	/** Insert a node directly above `refId` (same parent), or at the top of the root. */
	private placeAbove(refId: string | null | undefined): { parentId: string | null; index: number } {
		if (refId) {
			const ref = this.doc.getNode(refId);
			const parentId = this.doc.parentOf(refId);
			if (ref && parentId !== undefined) {
				if (ref.type === 'group' && !ref.collapsed) return { parentId: ref.id, index: ref.children.length };
				return { parentId, index: this.doc.childrenOf(parentId).indexOf(refId) + 1 };
			}
		}
		return { parentId: null, index: this.doc.root.length };
	}

	addLayer(name?: string, aboveId?: string | null): string {
		const layer = newLayer(name ?? this.nextName('Layer'));
		const { parentId, index } = this.placeAbove(aboveId);
		this.history.transact('New layer', (tx) =>
			tx.apply({ t: 'addNodes', parentId, index, nodes: [layer], cels: [] })
		);
		return layer.id;
	}

	addLayerWithPixels(name: string, frameId: string, pixels: Uint8ClampedArray, aboveId?: string | null): string {
		const layer = newLayer(name);
		const { parentId, index } = this.placeAbove(aboveId);
		this.history.transact(`Add “${name}”`, (tx) =>
			tx.apply({
				t: 'addNodes',
				parentId,
				index,
				nodes: [layer],
				cels: [[celKey(layer.id, frameId), pixels]]
			})
		);
		return layer.id;
	}

	addGroup(name?: string, aboveId?: string | null): string {
		const group = newGroup(name ?? this.nextName('Group'));
		const { parentId, index } = this.placeAbove(aboveId);
		this.history.transact('New group', (tx) =>
			tx.apply({ t: 'addNodes', parentId, index, nodes: [group], cels: [] })
		);
		return group.id;
	}

	/** Wrap the given node in a new group at its position. */
	groupNode(id: string): string | null {
		const parentId = this.doc.parentOf(id);
		if (parentId === undefined) return null;
		const index = this.doc.childrenOf(parentId).indexOf(id);
		const group = newGroup(this.nextName('Group'));
		this.history.transact('Group layer', (tx) => {
			tx.apply({ t: 'addNodes', parentId, index: index + 1, nodes: [group], cels: [] });
			tx.apply({ t: 'moveNode', id, parentId: group.id, index: 0 });
		});
		return group.id;
	}

	/** Dissolve a group, moving its children into its place. */
	ungroup(groupId: string): void {
		const g = this.doc.getNode(groupId);
		const parentId = this.doc.parentOf(groupId);
		if (!g || g.type !== 'group' || parentId === undefined) return;
		this.history.transact('Ungroup', (tx) => {
			const index = this.doc.childrenOf(parentId).indexOf(groupId);
			const kids = [...g.children];
			kids.forEach((cid, i) => tx.apply({ t: 'moveNode', id: cid, parentId, index: index + 1 + i }));
			tx.apply({ t: 'removeNode', id: groupId });
		});
	}

	/** Returns false if refused (the last layer can't be deleted). */
	deleteNode(id: string): boolean {
		const remaining = this.doc.layersBottomUp().filter((l) => l.id !== id && !this.doc.isAncestor(id, l.id));
		if (remaining.length === 0) return false;
		return this.history.transact('Delete layer', (tx) => tx.apply({ t: 'removeNode', id }));
	}

	duplicateNode(id: string): string | null {
		const parentId = this.doc.parentOf(id);
		if (parentId === undefined) return null;
		const index = this.doc.childrenOf(parentId).indexOf(id);
		const idMap = new Map<string, string>();
		const src = this.doc.subtree(id);
		for (const n of src) idMap.set(n.id, uid(n.type === 'layer' ? 'l' : 'g'));
		const nodes: DocNode[] = src.map((n, i) => {
			const c = structuredCloneNode(n);
			c.id = idMap.get(n.id)!;
			if (i === 0) c.name = `${n.name} copy`;
			if (c.type === 'group') c.children = c.children.map((cid) => idMap.get(cid)!);
			return c;
		});
		const cels: [string, Uint8ClampedArray][] = [];
		for (const n of src) {
			if (n.type !== 'layer') continue;
			for (const [fid, data] of this.doc.layerCels(n.id))
				cels.push([celKey(idMap.get(n.id)!, fid), new Uint8ClampedArray(data)]);
		}
		this.history.transact('Duplicate layer', (tx) =>
			tx.apply({ t: 'addNodes', parentId, index: index + 1, nodes, cels })
		);
		return nodes[0].id;
	}

	setNodeProps(id: string, props: NodeProps, label = 'Layer properties', mergeKey?: string) {
		this.history.transact(label, (tx) => tx.apply({ t: 'setNode', id, props }), mergeKey);
	}

	rename(id: string, name: string) {
		const trimmed = name.trim();
		if (!trimmed || this.doc.getNode(id)?.name === trimmed) return;
		this.setNodeProps(id, { name: trimmed.slice(0, 80) }, 'Rename layer');
	}

	moveNode(id: string, parentId: string | null, index: number) {
		this.history.transact('Reorder layers', (tx) => tx.apply({ t: 'moveNode', id, parentId, index }));
	}

	/** Move one step up (+1) or down (-1) within the parent. */
	nudge(id: string, dir: 1 | -1) {
		const parentId = this.doc.parentOf(id);
		if (parentId === undefined) return;
		const sib = this.doc.childrenOf(parentId);
		const i = sib.indexOf(id);
		const j = i + dir;
		if (j < 0 || j >= sib.length) return;
		// After removing the node, inserting at j places it on the other side of its neighbour.
		this.moveNode(id, parentId, j);
	}

	/** Merge a layer into the sibling layer directly beneath it. */
	mergeDown(id: string): string | null {
		const below = this.layerBelow(id);
		const upper = this.doc.getLayer(id);
		if (!below || !upper) return null;
		const lower = this.doc.getLayer(below)!;
		const full = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
		this.history.transact('Merge down', (tx) => {
			for (const f of this.doc.frames) {
				const top = this.doc.getCel(id, f.id);
				if (!top || !upper.visible) continue;
				const base = this.doc.getCel(below, f.id);
				// Bake the lower layer's opacity first so the merged result looks the same.
				const merged = new Uint8ClampedArray(full.w * full.h * 4);
				if (base) blendInto(merged, full, base, full.w, 0, 0, lower.opacity, 'normal');
				blendInto(merged, full, top, full.w, 0, 0, upper.opacity, upper.blend);
				tx.apply({ t: 'patch', layerId: below, frameId: f.id, rect: full, data: merged });
			}
			if (lower.opacity !== 1) tx.apply({ t: 'setNode', id: below, props: { opacity: 1 } });
			tx.apply({ t: 'removeNode', id });
		});
		return below;
	}

	layerBelow(id: string): string | null {
		const parentId = this.doc.parentOf(id);
		if (parentId === undefined) return null;
		const sib = this.doc.childrenOf(parentId);
		const i = sib.indexOf(id);
		const belowId = sib[i - 1];
		return belowId && this.doc.getNode(belowId)?.type === 'layer' ? belowId : null;
	}

	/** Collapse everything visible into a single layer, per frame. */
	flatten(): string {
		const layer = newLayer('Flattened');
		const cels: [string, Uint8ClampedArray][] = this.doc.frames.map((f) => [
			celKey(layer.id, f.id),
			compositeFrame(this.doc, f.id)
		]);
		this.history.transact('Flatten image', (tx) => {
			for (const id of [...this.doc.root]) tx.apply({ t: 'removeNode', id });
			tx.apply({ t: 'addNodes', parentId: null, index: 0, nodes: [layer], cels });
		});
		return layer.id;
	}

	clearLayer(layerId: string, frameId: string) {
		const cel = this.doc.getCel(layerId, frameId);
		if (!cel) return;
		const rect = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
		this.history.transact('Clear layer', (tx) =>
			tx.apply({ t: 'patch', layerId, frameId, rect, data: new Uint8ClampedArray(cel.length) })
		);
	}

	private nextName(base: string) {
		const names = new Set([...this.doc.nodes.values()].map((n) => n.name));
		let i = this.doc.nodes.size + 1;
		while (names.has(`${base} ${i}`)) i++;
		return `${base} ${i}`;
	}

	// ── frames ────────────────────────────────────────────────────────────────

	addFrame(afterId: string | null, duplicate: boolean): string {
		const index = afterId ? this.doc.frameIndex(afterId) + 1 : this.doc.frames.length;
		const ref = afterId ? this.doc.frames.find((f) => f.id === afterId) : this.doc.frames.at(-1);
		const frame: Frame = { id: uid('f'), duration: ref?.duration ?? Math.round(1000 / this.doc.meta.animation.fps) };
		const cels: [string, Uint8ClampedArray][] = [];
		if (duplicate && afterId) {
			for (const l of this.doc.layersBottomUp()) {
				const c = this.doc.getCel(l.id, afterId);
				if (c) cels.push([celKey(l.id, frame.id), new Uint8ClampedArray(c)]);
			}
		}
		this.history.transact(duplicate ? 'Duplicate frame' : 'New frame', (tx) =>
			tx.apply({ t: 'addFrame', frame, index, cels })
		);
		return frame.id;
	}

	deleteFrame(id: string): boolean {
		if (this.doc.frames.length <= 1) return false;
		return this.history.transact('Delete frame', (tx) => tx.apply({ t: 'removeFrame', id }));
	}

	moveFrame(id: string, index: number) {
		this.history.transact('Reorder frames', (tx) => tx.apply({ t: 'moveFrame', id, index }));
	}

	setFrameDuration(id: string, duration: number) {
		const d = Math.max(10, Math.min(10000, Math.round(duration)));
		this.history.transact('Frame duration', (tx) => tx.apply({ t: 'setFrame', id, props: { duration: d } }));
	}

	/** Set every frame's duration from an FPS value. */
	setFps(fps: number) {
		const f = Math.max(1, Math.min(60, Math.round(fps)));
		const duration = Math.round(1000 / f);
		this.history.transact(
			'Frame rate',
			(tx) => {
				tx.apply({ t: 'setMeta', props: { animation: { ...this.doc.meta.animation, fps: f } } });
				for (const fr of this.doc.frames) tx.apply({ t: 'setFrame', id: fr.id, props: { duration } });
			},
			'fps'
		);
	}

	// ── meta ──────────────────────────────────────────────────────────────────

	setMeta(props: Extract<Op, { t: 'setMeta' }>['props'], label = 'Document settings', mergeKey?: string) {
		this.history.transact(label, (tx) => tx.apply({ t: 'setMeta', props }), mergeKey);
	}

	// ── canvas-wide transforms ──────────────────────────────────────────────

	/** Rebuild every cel through `map(oldCel) → newCel` at new dimensions, as one undo step. */
	transformCanvas(
		label: string,
		width: number,
		height: number,
		map: (src: Uint8ClampedArray, ow: number, oh: number) => Uint8ClampedArray
	) {
		const ow = this.doc.width,
			oh = this.doc.height;
		const cels: [string, Uint8ClampedArray][] = [];
		for (const [k, v] of this.doc.cels) cels.push([k, map(v, ow, oh)]);
		this.history.transact(label, (tx) => tx.apply({ t: 'canvas', width, height, cels }));
	}

	resizeCanvas(width: number, height: number, anchorX: number, anchorY: number) {
		const ox = Math.round((width - this.doc.width) * anchorX);
		const oy = Math.round((height - this.doc.height) * anchorY);
		this.transformCanvas('Resize canvas', width, height, (src, ow, oh) => {
			const out = new Uint8ClampedArray(width * height * 4);
			for (let y = 0; y < oh; y++) {
				const ty = y + oy;
				if (ty < 0 || ty >= height) continue;
				for (let x = 0; x < ow; x++) {
					const tx = x + ox;
					if (tx < 0 || tx >= width) continue;
					const s = (y * ow + x) * 4,
						d = (ty * width + tx) * 4;
					out[d] = src[s];
					out[d + 1] = src[s + 1];
					out[d + 2] = src[s + 2];
					out[d + 3] = src[s + 3];
				}
			}
			return out;
		});
	}

	scaleImage(width: number, height: number) {
		this.transformCanvas('Scale image', width, height, (src, ow, oh) => scaleNearest(src, ow, oh, width, height));
	}

	flipCanvas(axis: 'h' | 'v') {
		const w = this.doc.width,
			h = this.doc.height;
		this.transformCanvas(axis === 'h' ? 'Flip canvas horizontally' : 'Flip canvas vertically', w, h, (src) =>
			flipPixels(src, w, h, axis)
		);
	}

	rotateCanvas(quarterTurns: 1 | 2 | 3) {
		const w = this.doc.width,
			h = this.doc.height;
		const nw = quarterTurns === 2 ? w : h,
			nh = quarterTurns === 2 ? h : w;
		this.transformCanvas('Rotate canvas', nw, nh, (src) => rotatePixels(src, w, h, quarterTurns));
	}

	/** Snapshot helper used by tools: copy of a cel's rect, creating the cel if needed. */
	readCelRect(layerId: string, frameId: string, rect: { x: number; y: number; w: number; h: number }) {
		return readRect(this.doc.ensureCel(layerId, frameId), this.doc.width, rect);
	}
}

export function scaleNearest(src: Uint8ClampedArray, ow: number, oh: number, nw: number, nh: number) {
	const out = new Uint8ClampedArray(nw * nh * 4);
	for (let y = 0; y < nh; y++) {
		const sy = Math.min(oh - 1, Math.floor((y * oh) / nh));
		for (let x = 0; x < nw; x++) {
			const sx = Math.min(ow - 1, Math.floor((x * ow) / nw));
			const s = (sy * ow + sx) * 4,
				d = (y * nw + x) * 4;
			out[d] = src[s];
			out[d + 1] = src[s + 1];
			out[d + 2] = src[s + 2];
			out[d + 3] = src[s + 3];
		}
	}
	return out;
}

export function flipPixels(src: Uint8ClampedArray, w: number, h: number, axis: 'h' | 'v') {
	const out = new Uint8ClampedArray(src.length);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const sx = axis === 'h' ? w - 1 - x : x;
			const sy = axis === 'v' ? h - 1 - y : y;
			const s = (sy * w + sx) * 4,
				d = (y * w + x) * 4;
			out[d] = src[s];
			out[d + 1] = src[s + 1];
			out[d + 2] = src[s + 2];
			out[d + 3] = src[s + 3];
		}
	return out;
}

/** Rotate clockwise by quarter turns. For 1 and 3 the output is h×w. */
export function rotatePixels(src: Uint8ClampedArray, w: number, h: number, q: 1 | 2 | 3) {
	const nw = q === 2 ? w : h;
	const out = new Uint8ClampedArray(src.length);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			let nx: number, ny: number;
			if (q === 1) {
				nx = h - 1 - y;
				ny = x;
			} else if (q === 2) {
				nx = w - 1 - x;
				ny = h - 1 - y;
			} else {
				nx = y;
				ny = w - 1 - x;
			}
			const s = (y * w + x) * 4,
				d = (ny * nw + nx) * 4;
			out[d] = src[s];
			out[d + 1] = src[s + 1];
			out[d + 2] = src[s + 2];
			out[d + 3] = src[s + 3];
		}
	return out;
}
