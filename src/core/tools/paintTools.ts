import { linePixels, stampDab, StrokeSession, type StrokeMode } from './stroke';
import type { BrushSettings, PointerInfo, Tool, ToolContext, ToolId } from './types';

/** Shared guard for every tool that writes pixels. */
export function canEdit(ctx: ToolContext): boolean {
	const layer = ctx.doc.getLayer(ctx.layerId);
	if (!layer) {
		ctx.notify('Select a layer to draw on.');
		return false;
	}
	if (ctx.doc.effectiveLocked(ctx.layerId, ctx.peerId)) {
		ctx.notify(
			layer.owner && layer.owner !== ctx.peerId
				? 'A collaborator is working on this layer.'
				: 'This layer is locked.'
		);
		return false;
	}
	if (!ctx.doc.effectiveVisible(ctx.layerId)) {
		ctx.notify('This layer is hidden. Show it to draw on it.');
		return false;
	}
	return true;
}

interface PaintConfig {
	id: ToolId;
	mode: StrokeMode;
	label: string;
	settings: (ctx: ToolContext) => BrushSettings;
	aliased: (ctx: ToolContext) => boolean;
}

/**
 * Brush, pencil, eraser and clone share one implementation; they differ only in blend mode and in
 * whether dabs are anti-aliased.
 */
function paintTool(cfg: PaintConfig): Tool {
	let s: StrokeSession | null = null;
	let last: { x: number; y: number } | null = null;
	let carry = 0;
	let path: { x: number; y: number }[] = [];
	let cloneSource: { x: number; y: number } | null = null;
	let cloneOffset: { x: number; y: number } | null = null;

	const dab = (ctx: ToolContext, x: number, y: number, p: PointerInfo) => {
		const b = cfg.settings(ctx);
		const pen = p.pointerType === 'pen';
		const pressure = pen ? Math.max(0.05, p.pressure) : 1;
		const size = b.pressureSize && pen ? Math.max(1, b.size * pressure) : b.size;
		const alpha = b.pressureOpacity && pen ? pressure : 1;
		stampDab(s!, x, y, size, b.hardness, b.shape, cfg.aliased(ctx), alpha, ctx.settings.customTip);
	};

	const pixelStep = (ctx: ToolContext, x: number, y: number, p: PointerInfo) => {
		const b = cfg.settings(ctx);
		const px = Math.floor(x),
			py = Math.floor(y);
		const prev = path.at(-1);
		if (prev && prev.x === px && prev.y === py) return;
		// Pixel-perfect: drop the inside pixel of an L-shaped corner so diagonal lines stay 1px.
		if (b.pixelPerfect && b.size <= 1 && path.length >= 2) {
			const a = path[path.length - 2],
				m = path[path.length - 1];
			if (
				Math.abs(a.x - px) === 1 &&
				Math.abs(a.y - py) === 1 &&
				(m.x === a.x || m.y === a.y) &&
				(m.x === px || m.y === py)
			) {
				s!.unplot(m.x, m.y);
				path.pop();
			}
		}
		path.push({ x: px, y: py });
		if (path.length > 8) path.shift();
		dab(ctx, px + 0.5, py + 0.5, p);
	};

	return {
		id: cfg.id,
		cursor: 'crosshair',
		edits: true,
		onDown(ctx, p) {
			if (cfg.mode === 'clone' && p.alt) {
				cloneSource = { x: Math.floor(p.x), y: Math.floor(p.y) };
				cloneOffset = null;
				ctx.overlay.marker = { x: cloneSource.x + 0.5, y: cloneSource.y + 0.5 };
				ctx.requestOverlay();
				ctx.notify('Clone source set. Paint to copy from it.');
				return;
			}
			if (cfg.mode === 'clone' && !cloneSource) {
				ctx.notify('Alt-click (Option-click) to choose where to clone from.');
				return;
			}
			if (!canEdit(ctx)) return;
			const b = cfg.settings(ctx);
			s = new StrokeSession(
				ctx.doc,
				ctx.layerId,
				ctx.frameId,
				cfg.mode,
				ctx.fg,
				b.opacity,
				ctx.selection.active ? ctx.selection : null,
				ctx.settings.symmetry === 'off' ? null : ctx.mirror
			);
			if (cfg.mode === 'clone') {
				// Aligned clone: the offset is fixed by the first stroke after choosing a source.
				if (!cloneOffset)
					cloneOffset = { x: cloneSource!.x - Math.floor(p.x), y: cloneSource!.y - Math.floor(p.y) };
				s.cloneOffset = cloneOffset;
			}
			path = [];
			carry = 0;
			last = { x: p.x, y: p.y };
			if (p.shift && lastEnd && lastEndLayer === ctx.layerId) {
				// Shift-click: straight line from the end of the previous stroke.
				this.onMove(ctx, { ...p, x: p.x, y: p.y }, lastEnd);
			} else if (cfg.aliased(ctx)) pixelStep(ctx, p.x, p.y, p);
			else dab(ctx, p.x, p.y, p);
			s.flush();
		},
		onMove(ctx, p, from?: { x: number; y: number }) {
			if (cfg.mode === 'clone' && cloneSource && cloneOffset) {
				ctx.overlay.marker = { x: p.x + cloneOffset.x, y: p.y + cloneOffset.y };
				ctx.requestOverlay();
			}
			if (!s) return;
			const start = from ?? last!;
			if (cfg.aliased(ctx)) {
				linePixels(start.x, start.y, p.x, p.y, (x, y) => pixelStep(ctx, x, y, p));
			} else {
				const b = cfg.settings(ctx);
				const step = Math.max(0.5, b.size * b.spacing);
				const dx = p.x - start.x,
					dy = p.y - start.y;
				const dist = Math.hypot(dx, dy);
				let t = step - carry;
				while (t <= dist) {
					dab(ctx, start.x + (dx * t) / dist, start.y + (dy * t) / dist, p);
					t += step;
				}
				carry = dist - (t - step);
			}
			last = { x: p.x, y: p.y };
			s.flush();
		},
		onUp(ctx) {
			if (!s) return;
			const changed = s.commit(ctx.history, cfg.label);
			if (changed && cfg.mode === 'paint') ctx.usedColor(ctx.fg);
			lastEnd = last;
			lastEndLayer = ctx.layerId;
			s = null;
		},
		cancel() {
			s?.cancel();
			s = null;
		}
	} as Tool & { onMove(ctx: ToolContext, p: PointerInfo, from?: { x: number; y: number }): void };
}

let lastEnd: { x: number; y: number } | null = null;
let lastEndLayer: string | null = null;

export const brushTool = paintTool({
	id: 'brush',
	mode: 'paint',
	label: 'Brush stroke',
	settings: (c) => c.settings.brush,
	aliased: (c) => c.settings.brush.hardness >= 1 && c.settings.brush.shape !== 'custom'
});

export const pencilTool = paintTool({
	id: 'pencil',
	mode: 'paint',
	label: 'Pencil',
	settings: (c) => c.settings.pencil,
	aliased: () => true
});

export const eraserTool = paintTool({
	id: 'eraser',
	mode: 'erase',
	label: 'Erase',
	settings: (c) => c.settings.eraser,
	aliased: (c) => c.settings.eraser.aliased
});

export const cloneTool = paintTool({
	id: 'clone',
	mode: 'clone',
	label: 'Clone',
	settings: (c) => c.settings.clone,
	aliased: (c) => c.settings.clone.hardness >= 1
});
