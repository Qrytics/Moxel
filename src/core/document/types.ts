/**
 * The Moxel document model. Pure data + TypeScript: no DOM, no Svelte, so it runs unchanged in
 * tests, workers and on remote peers.
 *
 * Pixels live in "cels" — one RGBA buffer per (layer, frame) pair — which is what lets the same
 * model serve a single-frame Minecraft skin and a 40-frame animation. A missing cel is simply
 * transparent; cels are created lazily the first time something is drawn into them.
 */

/** `paint` is the smooth-brush mode; the others are pixel art. Fixed when a project is created. */
export type DocKind = 'skin' | 'texture' | 'canvas' | 'paint';
export type SkinModel = 'classic' | 'slim';
export type TextureType = 'block' | 'item' | 'gui' | 'entity' | 'other';
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add';

export const BLEND_MODES: BlendMode[] = [
	'normal',
	'multiply',
	'screen',
	'overlay',
	'darken',
	'lighten',
	'add'
];

interface NodeBase {
	id: string;
	name: string;
	visible: boolean;
	locked: boolean;
	/** 0..1 */
	opacity: number;
	blend: BlendMode;
	/** Peer id that has claimed this layer in a live session; others treat it as locked. */
	owner?: string;
}

export interface LayerNode extends NodeBase {
	type: 'layer';
}

export interface GroupNode extends NodeBase {
	type: 'group';
	collapsed: boolean;
	/** Child ids, bottom-most first. */
	children: string[];
}

export type DocNode = LayerNode | GroupNode;

export interface Frame {
	id: string;
	/** Display duration in milliseconds. */
	duration: number;
}

export interface AnimationSettings {
	fps: number;
	loop: boolean;
	onionSkin: boolean;
	onionBefore: number;
	onionAfter: number;
	onionOpacity: number;
}

export interface SkinMeta {
	model: SkinModel;
}

export interface TextureMeta {
	type: TextureType;
}

export interface PaintMeta {
	background: 'white' | 'transparent';
}

/** Everything about a document that isn't pixels or the layer tree. */
export interface DocMeta {
	id: string;
	name: string;
	kind: DocKind;
	width: number;
	height: number;
	createdAt: number;
	updatedAt: number;
	skin?: SkinMeta;
	texture?: TextureMeta;
	paint?: PaintMeta;
	animation: AnimationSettings;
	/** Project palette (hex strings, `#rrggbbaa` or `#rrggbb`). */
	palette: string[];
}

/** Serializable (structured-clone friendly) snapshot of a whole document. */
export interface DocSnapshot {
	format: 'moxel';
	/** 1 for pixel documents; 2 for paint documents, so builds that predate paint refuse them. */
	version: 1 | 2;
	meta: DocMeta;
	nodes: DocNode[];
	root: string[];
	frames: Frame[];
	/** `${layerId}:${frameId}` → RGBA bytes, width*height*4 long. */
	cels: [string, Uint8ClampedArray][];
	/** Editor state worth restoring (active layer/frame, tool settings, view). Opaque to the core. */
	editor?: Record<string, unknown>;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export const celKey = (layerId: string, frameId: string) => `${layerId}:${frameId}`;

export const DEFAULT_ANIMATION: AnimationSettings = {
	fps: 8,
	loop: true,
	onionSkin: false,
	onionBefore: 1,
	onionAfter: 1,
	onionOpacity: 0.3
};

export const MAX_CANVAS_SIZE = 1024;
/** Paint documents may be larger: their strokes are tiled, so cost follows the painted area. */
export const MAX_PAINT_SIZE = 4096;

export const maxSize = (kind: DocKind) => (kind === 'paint' ? MAX_PAINT_SIZE : MAX_CANVAS_SIZE);
export const isPaint = (meta: Pick<DocMeta, 'kind'>) => meta.kind === 'paint';
