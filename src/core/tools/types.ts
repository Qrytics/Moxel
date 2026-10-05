import type { DocCommands } from '../document/commands';
import type { MoxelDocument } from '../document/document';
import type { Rect } from '../document/types';
import type { History } from '../history/history';
import type { Point, Selection } from '../selection/selection';

export type RGBA = [number, number, number, number];

export type ToolId =
	| 'brush'
	| 'pencil'
	| 'eraser'
	| 'fill'
	| 'eyedropper'
	| 'line'
	| 'rect'
	| 'ellipse'
	| 'select-rect'
	| 'select-ellipse'
	| 'lasso'
	| 'wand'
	| 'move'
	| 'clone'
	| 'hand'
	| 'zoom';

export type BrushShape = 'round' | 'square' | 'custom';
export type SymmetryMode = 'off' | 'horizontal' | 'vertical' | 'both' | 'character';

export interface BrushSettings {
	size: number;
	/** 0..1 */
	opacity: number;
	/** 0..1 — 1 is a crisp edge. */
	hardness: number;
	/** Dab spacing as a fraction of size. */
	spacing: number;
	shape: BrushShape;
	pixelPerfect: boolean;
	pressureSize: boolean;
	pressureOpacity: boolean;
}

export interface CustomTip {
	w: number;
	h: number;
	/** w*h coverage values 0..255. */
	mask: number[];
}

export interface ToolSettings {
	brush: BrushSettings;
	pencil: BrushSettings;
	eraser: BrushSettings & { aliased: boolean };
	clone: BrushSettings;
	fill: { tolerance: number; contiguous: boolean; sampleAll: boolean; opacity: number };
	wand: { tolerance: number; contiguous: boolean; sampleAll: boolean };
	shape: { size: number; filled: boolean; opacity: number };
	eyedropper: { sampleAll: boolean };
	symmetry: SymmetryMode;
	customTip: CustomTip | null;
}

export interface PointerInfo {
	/** Document-space coordinates (fractional pixels). */
	x: number;
	y: number;
	/** Screen-space (CSS px, relative to the canvas element). */
	sx: number;
	sy: number;
	pressure: number;
	pointerType: string;
	button: number;
	shift: boolean;
	alt: boolean;
	mod: boolean;
}

/** Transient visuals a tool wants drawn over the canvas (rubber bands, lasso path, clone source). */
export interface ToolOverlay {
	rect?: Rect | null;
	ellipse?: boolean;
	path?: Point[] | null;
	marker?: Point | null;
	/** Offset applied to the selection outline while dragging it. */
	selectionOffset?: Point | null;
}

/** Everything a tool may touch. The editor implements this; tools never reach into the UI. */
export interface ToolContext {
	doc: MoxelDocument;
	history: History;
	cmd: DocCommands;
	selection: Selection;
	layerId: string;
	frameId: string;
	peerId?: string;
	settings: ToolSettings;
	fg: RGBA;
	bg: RGBA;
	overlay: ToolOverlay;
	setColor(c: RGBA, which: 'fg' | 'bg'): void;
	usedColor(c: RGBA): void;
	/** Extra texel indices to mirror a texel index onto (empty when symmetry is off). */
	mirror(index: number): number[];
	pan(dxScreen: number, dyScreen: number): void;
	zoomAt(factor: number, sx: number, sy: number): void;
	notify(message: string): void;
	requestOverlay(): void;
	setTool(id: ToolId): void;
}

export interface Tool {
	id: ToolId;
	cursor: string;
	/** Tools that modify pixels need an editable active layer. */
	edits?: boolean;
	onDown(ctx: ToolContext, p: PointerInfo): void;
	onMove(ctx: ToolContext, p: PointerInfo): void;
	onUp(ctx: ToolContext, p: PointerInfo): void;
	onHover?(ctx: ToolContext, p: PointerInfo): void;
	/** Abort an in-progress gesture (Escape, tool switch, pointer cancel). */
	cancel?(ctx: ToolContext): void;
}

export const DEFAULT_BRUSH: BrushSettings = {
	size: 1,
	opacity: 1,
	hardness: 1,
	spacing: 0.15,
	shape: 'round',
	pixelPerfect: false,
	pressureSize: true,
	pressureOpacity: false
};

export function defaultToolSettings(): ToolSettings {
	return {
		brush: { ...DEFAULT_BRUSH, size: 4, hardness: 0.6, opacity: 1 },
		pencil: { ...DEFAULT_BRUSH, size: 1, pixelPerfect: true, pressureSize: false },
		eraser: { ...DEFAULT_BRUSH, size: 1, aliased: true, pressureSize: false },
		clone: { ...DEFAULT_BRUSH, size: 3, hardness: 1 },
		fill: { tolerance: 0, contiguous: true, sampleAll: false, opacity: 1 },
		wand: { tolerance: 0, contiguous: true, sampleAll: false },
		shape: { size: 1, filled: false, opacity: 1 },
		eyedropper: { sampleAll: true },
		symmetry: 'off',
		customTip: null
	};
}
