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
	| 'zoom'
	| 'smudge'
	| 'blur'
	| 'gradient';

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

export type PressureCurve = 'soft' | 'linear' | 'firm';

/** Brush settings for paint documents (smooth, accumulating, tiled — see paintEngine.ts). */
export interface PaintBrushSettings {
	/** Diameter in document pixels. */
	size: number;
	/** 0..1 — the most a single stroke can cover. */
	opacity: number;
	/** 0..1 — how much each dab adds; low flow builds up gradually, like an airbrush. */
	flow: number;
	/** 0..1 — 1 is a crisp (still anti-aliased) edge. */
	hardness: number;
	/** Dab spacing as a fraction of size. */
	spacing: number;
	/** Tip rotation in degrees and squash (1 = round), for flat and calligraphy brushes. */
	angle: number;
	roundness: number;
	/** 0..1 paper-grain texture strength, and its scale in pixels. */
	grain: number;
	grainScale: number;
	/** Random dab offset as a fraction of size, and per-dab size/opacity variation (0..1). */
	scatter: number;
	sizeJitter: number;
	opacityJitter: number;
	/** 0..1 — smooths the line by trailing the pointer. */
	stabilizer: number;
	pressureSize: boolean;
	pressureOpacity: boolean;
	pressureFlow: boolean;
	pressureCurve: PressureCurve;
	/** Thin the ends of mouse strokes, standing in for pen pressure. */
	taper: boolean;
	/** Smudge: how much paint the finger carries (0..1). Blur: positive blurs, negative sharpens. */
	strength: number;
}

export type GradientShape = 'linear' | 'radial';

export interface PaintSettings {
	brush: PaintBrushSettings;
	eraser: PaintBrushSettings;
	smudge: PaintBrushSettings;
	blur: PaintBrushSettings;
	gradient: { shape: GradientShape; toTransparent: boolean; opacity: number };
	/** Preset last applied to each tool, for the picker's highlight. */
	preset: Partial<Record<PaintToolId, string>>;
}

export type PaintToolId = 'brush' | 'eraser' | 'smudge' | 'blur';

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
	paint: PaintSettings;
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

export const DEFAULT_PAINT_BRUSH: PaintBrushSettings = {
	size: 24,
	opacity: 1,
	flow: 1,
	hardness: 0.5,
	spacing: 0.08,
	angle: 0,
	roundness: 1,
	grain: 0,
	grainScale: 1,
	scatter: 0,
	sizeJitter: 0,
	opacityJitter: 0,
	stabilizer: 0.2,
	pressureSize: true,
	pressureOpacity: false,
	pressureFlow: false,
	pressureCurve: 'linear',
	taper: false,
	strength: 0.6
};

export function defaultPaintSettings(): PaintSettings {
	return {
		brush: { ...DEFAULT_PAINT_BRUSH },
		eraser: { ...DEFAULT_PAINT_BRUSH, size: 40, hardness: 0.3 },
		smudge: { ...DEFAULT_PAINT_BRUSH, size: 40, hardness: 0.2, strength: 0.75, stabilizer: 0 },
		blur: { ...DEFAULT_PAINT_BRUSH, size: 48, hardness: 0.1, strength: 0.5, stabilizer: 0 },
		gradient: { shape: 'linear', toTransparent: false, opacity: 1 },
		preset: { brush: 'soft-round', eraser: 'soft-eraser', smudge: 'smudge', blur: 'blur' }
	};
}

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
		customTip: null,
		paint: defaultPaintSettings()
	};
}
