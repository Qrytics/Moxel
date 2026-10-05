import { isPaint } from '../document/types';
import { canEdit } from './paintTools';
import { mirrorPoints, PaintStroke, StrokePath, type InputPoint, type PaintMode } from './paintEngine';
import type { PaintBrushSettings, PaintToolId, PointerInfo, RGBA, Tool, ToolContext, ToolId } from './types';

const LABELS: Record<PaintToolId, string> = {
	brush: 'Brush stroke',
	eraser: 'Erase',
	smudge: 'Smudge',
	blur: 'Blur'
};

const input = (p: PointerInfo): InputPoint => ({
	x: p.x,
	y: p.y,
	pressure: p.pressure,
	pen: p.pointerType === 'pen'
});

/** Brush, eraser, smudge and blur for paint documents, all driven by `paintEngine`. */
export function paintModeTool(id: PaintToolId, mode: PaintMode): Tool {
	let stroke: PaintStroke | null = null;
	let path: StrokePath | null = null;
	let last: { x: number; y: number } | null = null;
	let seed = 1;

	const begin = (ctx: ToolContext, p: PointerInfo, b: PaintBrushSettings) => {
		stroke = new PaintStroke(
			ctx.doc,
			ctx.layerId,
			ctx.frameId,
			mode,
			ctx.fg,
			b.opacity,
			ctx.selection.active ? ctx.selection : null,
			mirrorPoints(ctx.settings.symmetry, ctx.doc.width, ctx.doc.height),
			b.strength
		);
		stroke.fingerSize = b.size;
		const s = stroke;
		path = new StrokePath(b, (d) => s.stamp(d), seed++);
		path.begin(input(p));
	};

	return {
		id,
		cursor: 'crosshair',
		edits: true,
		onDown(ctx, p) {
			if (!canEdit(ctx)) return;
			const b = ctx.settings.paint[id];
			if (p.shift && lastEnd && lastEndLayer === ctx.layerId) {
				// Shift-click: a straight stroke from where the previous one ended.
				begin(ctx, { ...p, x: lastEnd.x, y: lastEnd.y }, { ...b, stabilizer: 0 });
				path!.move(input(p));
			} else begin(ctx, p, b);
			last = { x: p.x, y: p.y };
			stroke!.flush();
		},
		onMove(_ctx, p) {
			if (!stroke || !path) return;
			path.move(input(p));
			last = { x: p.x, y: p.y };
			stroke.flush();
		},
		onUp(ctx) {
			if (!stroke || !path) return;
			path.end();
			const changed = stroke.commit(ctx.history, LABELS[id]);
			if (changed && mode === 'paint') ctx.usedColor(ctx.fg);
			lastEnd = last;
			lastEndLayer = ctx.layerId;
			stroke = path = null;
		},
		cancel() {
			stroke?.cancel();
			stroke = path = null;
		}
	};
}

let lastEnd: { x: number; y: number } | null = null;
let lastEndLayer: string | null = null;

/**
 * One toolbar slot, two engines: pixel documents keep the pixel tool, paint documents get the
 * paint one. Chosen per gesture, so an in-progress stroke never switches engine under itself.
 */
export function byDocKind(pixel: Tool, paint: Tool): Tool {
	let active: Tool | null = null;
	const pick = (ctx: ToolContext) => (isPaint(ctx.doc.meta) ? paint : pixel);
	return {
		id: pixel.id,
		get cursor() {
			return pixel.cursor;
		},
		edits: pixel.edits,
		onDown(ctx, p) {
			active = pick(ctx);
			active.onDown(ctx, p);
		},
		onMove(ctx, p) {
			(active ?? pick(ctx)).onMove(ctx, p);
		},
		onUp(ctx, p) {
			(active ?? pick(ctx)).onUp(ctx, p);
			active = null;
		},
		onHover(ctx, p) {
			pick(ctx).onHover?.(ctx, p);
		},
		cancel(ctx) {
			(active ?? pick(ctx)).cancel?.(ctx);
			active = null;
		}
	};
}

// ── gradient ───────────────────────────────────────────────────────────────────────────────────

/**
 * Linear or radial gradient from the foreground colour to the background colour (or to
 * transparent), inside the selection if there is one. Dithered by a fraction of a level so wide,
 * low-contrast gradients don't band.
 */
export const gradientTool: Tool = (() => {
	let a: { x: number; y: number } | null = null;
	return {
		id: 'gradient' as ToolId,
		cursor: 'crosshair',
		edits: true,
		onDown(ctx, p) {
			if (!canEdit(ctx)) return;
			a = { x: p.x, y: p.y };
			ctx.overlay.path = [a, a];
			ctx.requestOverlay();
		},
		onMove(ctx, p) {
			if (!a) return;
			ctx.overlay.path = [a, constrainAngle(a, p)];
			ctx.requestOverlay();
		},
		onUp(ctx, p) {
			if (!a) return;
			const b = constrainAngle(a, p);
			ctx.overlay.path = null;
			ctx.requestOverlay();
			const start = a;
			a = null;
			if (Math.hypot(b.x - start.x, b.y - start.y) < 1) return;
			const g = ctx.settings.paint.gradient;
			const stroke = new PaintStroke(
				ctx.doc,
				ctx.layerId,
				ctx.frameId,
				'paint',
				ctx.fg,
				1,
				ctx.selection.active ? ctx.selection : null
			);
			const region =
				ctx.selection.active && ctx.selection.bounds
					? ctx.selection.bounds
					: { x: 0, y: 0, w: ctx.doc.width, h: ctx.doc.height };
			const fg = ctx.fg,
				bg: RGBA = g.toTransparent ? [fg[0], fg[1], fg[2], 0] : ctx.bg;
			const dx = b.x - start.x,
				dy = b.y - start.y;
			const len2 = dx * dx + dy * dy,
				len = Math.sqrt(len2);
			const out: RGBA = [0, 0, 0, 0];
			stroke.fillRegion(
				region,
				(x, y) => {
					const px = x + 0.5 - start.x,
						py = y + 0.5 - start.y;
					let t = g.shape === 'radial' ? Math.sqrt(px * px + py * py) / len : (px * dx + py * dy) / len2;
					t = Math.min(1, Math.max(0, t));
					// Ordered-ish dither: a hash of the pixel, ±half a level.
					const n = ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 1024) / 1024 - 0.5;
					for (let i = 0; i < 3; i++) out[i] = fg[i] + (bg[i] - fg[i]) * t + n;
					out[3] = fg[3] + (bg[3] - fg[3]) * t + n;
					return out;
				},
				g.opacity
			);
			if (stroke.commit(ctx.history, 'Gradient')) ctx.usedColor(ctx.fg);
		},
		cancel(ctx) {
			a = null;
			ctx.overlay.path = null;
			ctx.requestOverlay();
		}
	};
})();

function constrainAngle(a: { x: number; y: number }, p: PointerInfo) {
	if (!p.shift) return { x: p.x, y: p.y };
	const dx = p.x - a.x,
		dy = p.y - a.y;
	const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
	const len = Math.hypot(dx, dy);
	return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
}
