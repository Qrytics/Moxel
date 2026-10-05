import { uid } from '../id';
import {
	celKey,
	DEFAULT_ANIMATION,
	type DocKind,
	type DocMeta,
	type DocNode,
	type DocSnapshot,
	type Frame,
	type GroupNode,
	type LayerNode,
	type Rect,
	type SkinModel,
	type TextureType
} from './types';

export type ChangeEvent =
	| { type: 'pixels'; layerId: string; frameId: string; rect: Rect }
	| { type: 'structure' }
	| { type: 'meta' }
	| { type: 'reset' };

export interface CreateOptions {
	name: string;
	kind: DocKind;
	width: number;
	height: number;
	model?: SkinModel;
	textureType?: TextureType;
	fps?: number;
	frames?: number;
	layerName?: string;
}

export interface DisplayRow {
	node: DocNode;
	depth: number;
	parentId: string | null;
}

/**
 * Mutable in-memory document. Mutation goes through `applyOp` (ops.ts) so that every change is
 * undoable and can be replayed on a peer; the methods here are read helpers plus the raw
 * primitives those ops are built from.
 */
export class MoxelDocument {
	meta: DocMeta;
	nodes = new Map<string, DocNode>();
	root: string[] = [];
	frames: Frame[] = [];
	cels = new Map<string, Uint8ClampedArray>();
	editor: Record<string, unknown> = {};
	private listeners = new Set<(e: ChangeEvent) => void>();

	constructor(meta: DocMeta) {
		this.meta = meta;
	}

	static create(o: CreateOptions): MoxelDocument {
		const now = Date.now();
		const doc = new MoxelDocument({
			id: uid('p'),
			name: o.name,
			kind: o.kind,
			width: o.width,
			height: o.height,
			createdAt: now,
			updatedAt: now,
			skin: o.kind === 'skin' ? { model: o.model ?? 'classic' } : undefined,
			texture: o.kind === 'texture' ? { type: o.textureType ?? 'other' } : undefined,
			animation: { ...DEFAULT_ANIMATION, fps: o.fps ?? DEFAULT_ANIMATION.fps },
			palette: []
		});
		const frameCount = Math.max(1, o.frames ?? 1);
		const duration = Math.round(1000 / doc.meta.animation.fps);
		for (let i = 0; i < frameCount; i++) doc.frames.push({ id: uid('f'), duration });
		const layer = newLayer(o.layerName ?? 'Layer 1');
		doc.nodes.set(layer.id, layer);
		doc.root.push(layer.id);
		return doc;
	}

	static fromSnapshot(s: DocSnapshot): MoxelDocument {
		if (s.format !== 'moxel') throw new Error('Not a Moxel document');
		const doc = new MoxelDocument({
			...s.meta,
			animation: { ...DEFAULT_ANIMATION, ...s.meta.animation },
			palette: [...(s.meta.palette ?? [])]
		});
		for (const n of s.nodes) doc.nodes.set(n.id, structuredCloneNode(n));
		doc.root = [...s.root];
		doc.frames = s.frames.map((f) => ({ ...f }));
		const size = s.meta.width * s.meta.height * 4;
		for (const [k, v] of s.cels) {
			if (v.length === size) doc.cels.set(k, new Uint8ClampedArray(v));
		}
		doc.editor = { ...(s.editor ?? {}) };
		doc.validateTree();
		return doc;
	}

	/**
	 * Snapshot the document. With `copy = false` the cel buffers are shared (fine for an
	 * IndexedDB `put`, which structured-clones synchronously); with `copy = true` they're detached.
	 */
	toSnapshot(copy = true): DocSnapshot {
		const cels: [string, Uint8ClampedArray][] = [];
		for (const [k, v] of this.cels) cels.push([k, copy ? new Uint8ClampedArray(v) : v]);
		return {
			format: 'moxel',
			version: 1,
			meta: { ...this.meta, animation: { ...this.meta.animation }, palette: [...this.meta.palette] },
			nodes: [...this.nodes.values()].map(structuredCloneNode),
			root: [...this.root],
			frames: this.frames.map((f) => ({ ...f })),
			cels,
			editor: { ...this.editor }
		};
	}

	clone(newId = true): MoxelDocument {
		const d = MoxelDocument.fromSnapshot(this.toSnapshot(true));
		if (newId) d.meta.id = uid('p');
		return d;
	}

	// ── events ────────────────────────────────────────────────────────────────

	subscribe(fn: (e: ChangeEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	emit(e: ChangeEvent): void {
		this.meta.updatedAt = Date.now();
		for (const fn of this.listeners) fn(e);
	}

	// ── tree reads ────────────────────────────────────────────────────────────

	get width() {
		return this.meta.width;
	}
	get height() {
		return this.meta.height;
	}

	getNode(id: string): DocNode | undefined {
		return this.nodes.get(id);
	}

	getLayer(id: string): LayerNode | undefined {
		const n = this.nodes.get(id);
		return n?.type === 'layer' ? n : undefined;
	}

	/** Parent group id, or null for root-level nodes (undefined if not in tree). */
	parentOf(id: string): string | null | undefined {
		if (this.root.includes(id)) return null;
		for (const n of this.nodes.values()) if (n.type === 'group' && n.children.includes(id)) return n.id;
		return undefined;
	}

	childrenOf(parentId: string | null): string[] {
		if (parentId === null) return this.root;
		const g = this.nodes.get(parentId);
		if (!g || g.type !== 'group') throw new Error(`Not a group: ${parentId}`);
		return g.children;
	}

	/** The node and all descendants, parent before children. */
	subtree(id: string): DocNode[] {
		const out: DocNode[] = [];
		const walk = (nid: string) => {
			const n = this.nodes.get(nid);
			if (!n) return;
			out.push(n);
			if (n.type === 'group') for (const c of n.children) walk(c);
		};
		walk(id);
		return out;
	}

	isAncestor(ancestorId: string, id: string): boolean {
		let p = this.parentOf(id);
		while (p) {
			if (p === ancestorId) return true;
			p = this.parentOf(p);
		}
		return false;
	}

	/** Leaf layers in paint order (bottom first). */
	layersBottomUp(): LayerNode[] {
		const out: LayerNode[] = [];
		const walk = (ids: string[]) => {
			for (const id of ids) {
				const n = this.nodes.get(id);
				if (!n) continue;
				if (n.type === 'layer') out.push(n);
				else walk(n.children);
			}
		};
		walk(this.root);
		return out;
	}

	/** Rows for the layers panel: top-most first, with nesting depth. */
	displayRows(includeCollapsed = false): DisplayRow[] {
		const rows: DisplayRow[] = [];
		const walk = (ids: string[], depth: number, parentId: string | null) => {
			for (let i = ids.length - 1; i >= 0; i--) {
				const n = this.nodes.get(ids[i]);
				if (!n) continue;
				rows.push({ node: n, depth, parentId });
				if (n.type === 'group' && (includeCollapsed || !n.collapsed)) walk(n.children, depth + 1, n.id);
			}
		};
		walk(this.root, 0, null);
		return rows;
	}

	effectiveVisible(id: string): boolean {
		let cur: string | null | undefined = id;
		while (cur) {
			const n = this.nodes.get(cur);
			if (!n || !n.visible) return false;
			cur = this.parentOf(cur);
		}
		return true;
	}

	effectiveLocked(id: string, peerId?: string): boolean {
		let cur: string | null | undefined = id;
		while (cur) {
			const n = this.nodes.get(cur);
			if (!n) return true;
			if (n.locked) return true;
			if (n.owner && n.owner !== peerId) return true;
			cur = this.parentOf(cur);
		}
		return false;
	}

	frameIndex(frameId: string): number {
		return this.frames.findIndex((f) => f.id === frameId);
	}

	// ── pixels ────────────────────────────────────────────────────────────────

	getCel(layerId: string, frameId: string): Uint8ClampedArray | undefined {
		return this.cels.get(celKey(layerId, frameId));
	}

	ensureCel(layerId: string, frameId: string): Uint8ClampedArray {
		const k = celKey(layerId, frameId);
		let c = this.cels.get(k);
		if (!c) {
			c = new Uint8ClampedArray(this.meta.width * this.meta.height * 4);
			this.cels.set(k, c);
		}
		return c;
	}

	/** All cels belonging to a layer, as [frameId, data]. */
	layerCels(layerId: string): [string, Uint8ClampedArray][] {
		const out: [string, Uint8ClampedArray][] = [];
		for (const f of this.frames) {
			const c = this.getCel(layerId, f.id);
			if (c) out.push([f.id, c]);
		}
		return out;
	}

	/** Drop dangling entries so a hand-edited or partially-synced document can't wedge the editor. */
	validateTree(): void {
		const seen = new Set<string>();
		const clean = (ids: string[]) =>
			ids.filter((id) => {
				if (seen.has(id) || !this.nodes.has(id)) return false;
				seen.add(id);
				return true;
			});
		this.root = clean(this.root);
		for (const n of this.nodes.values()) if (n.type === 'group') n.children = clean(n.children);
		for (const id of [...this.nodes.keys()]) if (!seen.has(id)) this.nodes.delete(id);
		if (this.frames.length === 0) this.frames.push({ id: uid('f'), duration: 125 });
		if (this.layersBottomUp().length === 0) {
			const l = newLayer('Layer 1');
			this.nodes.set(l.id, l);
			this.root.push(l.id);
		}
	}
}

export function newLayer(name: string, props: Partial<LayerNode> = {}): LayerNode {
	return {
		id: uid('l'),
		type: 'layer',
		name,
		visible: true,
		locked: false,
		opacity: 1,
		blend: 'normal',
		...props
	};
}

export function newGroup(name: string, props: Partial<GroupNode> = {}): GroupNode {
	return {
		id: uid('g'),
		type: 'group',
		name,
		visible: true,
		locked: false,
		opacity: 1,
		blend: 'normal',
		collapsed: false,
		children: [],
		...props
	};
}

export function structuredCloneNode<T extends DocNode>(n: T): T {
	return (n.type === 'group' ? { ...n, children: [...n.children] } : { ...n }) as T;
}
