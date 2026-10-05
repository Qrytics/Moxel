import { compositeFrame } from '../render/composite';
import { floodMask, type Point, type SelectMode } from '../selection/selection';
import { invertPatch } from '../document/ops';
import { pixelsEqual, readRect, unionRect } from '../document/pixels';
import type { Rect } from '../document/types';
import { Transaction } from '../history/history';
import { canEdit } from './paintTools';
import { linePixels, stampDab, StrokeSession } from './stroke';
import type { PointerInfo, RGBA, Tool, ToolContext } from './types';

// ── shapes ────────────────────────────────────────────────────────────────────

type ShapeKind = 'line' | 'rect' | 'ellipse';

function constrain(kind: ShapeKind, a: Point, b: Point, shift: boolean): Point {
	if (!shift) return b;
	const dx = b.x - a.x,
		dy = b.y - a.y;
	if (kind === 'line') {
		// Snap to 0/45/90°.
		const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
		const len = Math.hypot(dx, dy);
		return { x: a.x + Math.round(Math.cos(ang) * len), y: a.y + Math.round(Math.sin(ang) * len) };
	}
	const m = Math.max(Math.abs(dx), Math.abs(dy));
	return { x: a.x + Math.sign(dx || 1) * m, y: a.y + Math.sign(dy || 1) * m };
}

function drawShape(s: StrokeSession, kind: ShapeKind, a: Point, b: Point, size: number, filled: boolean) {
	const pen = (x: number, y: number) => stampDab(s, x + 0.5, y + 0.5, size, 1, 'round', true, 1, null);
	const x0 = Math.min(a.x, b.x),
		y0 = Math.min(a.y, b.y),
		x1 = Math.max(a.x, b.x),
		y1 = Math.max(a.y, b.y);
	if (kind === 'line') return linePixels(a.x, a.y, b.x, b.y, pen);
	if (kind === 'rect') {
		if (filled) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s.plot(x, y, 1);
		linePixels(x0, y0, x1, y0, pen);
		linePixels(x1, y0, x1, y1, pen);
		linePixels(x1, y1, x0, y1, pen);
		linePixels(x0, y1, x0, y0, pen);
		return;
	}
	// Ellipse inscribed in the inclusive pixel box, traced per row/column so it is gap-free.
	const cx = (x0 + x1) / 2,
		cy = (y0 + y1) / 2;
	const rx = (x1 - x0) / 2 + 0.5,
		ry = (y1 - y0) / 2 + 0.5;
	const inside = (x: number, y: number) => {
		const dx = (x - cx) / rx,
			dy = (y - cy) / ry;
		return dx * dx + dy * dy <= 1;
	};
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			if (!inside(x, y)) continue;
			const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
			if (edge) pen(x, y);
			else if (filled) s.plot(x, y, 1);
		}
}

function shapeTool(kind: ShapeKind): Tool {
	let s: StrokeSession | null = null;
	let start: Point | null = null;
	return {
		id: kind,
		cursor: 'crosshair',
		edits: true,
		onDown(ctx, p) {
			if (!canEdit(ctx)) return;
			start = { x: Math.floor(p.x), y: Math.floor(p.y) };
			s = new StrokeSession(
				ctx.doc,
				ctx.layerId,
				ctx.frameId,
				'paint',
				ctx.fg,
				ctx.settings.shape.opacity,
				ctx.selection.active ? ctx.selection : null,
				ctx.settings.symmetry === 'off' ? null : ctx.mirror
			);
			this.onMove(ctx, p);
		},
		onMove(ctx, p) {
			if (!s || !start) return;
			let end = { x: Math.floor(p.x), y: Math.floor(p.y) };
			end = constrain(kind, start, end, p.shift);
			let a = start;
			if (p.alt && kind !== 'line') a = { x: 2 * start.x - end.x, y: 2 * start.y - end.y }; // from centre
			s.reset();
			drawShape(s, kind, a, end, ctx.settings.shape.size, ctx.settings.shape.filled && kind !== 'line');
			s.flush();
		},
		onUp(ctx) {
			if (!s) return;
			if (s.commit(ctx.history, kind === 'line' ? 'Line' : kind === 'rect' ? 'Rectangle' : 'Ellipse'))
				ctx.usedColor(ctx.fg);
			s = null;
			start = null;
		},
		cancel() {
			s?.cancel();
			s = null;
		}
	};
}

export const lineTool = shapeTool('line');
export const rectTool = shapeTool('rect');
export const ellipseTool = shapeTool('ellipse');

// ── fill ──────────────────────────────────────────────────────────────────────

export const fillTool: Tool = {
	id: 'fill',
	cursor: 'crosshair',
	edits: true,
	onDown(ctx, p) {
		if (!canEdit(ctx)) return;
		const x = Math.floor(p.x),
			y = Math.floor(p.y);
		const { doc } = ctx;
		if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
		const f = ctx.settings.fill;
		const src = f.sampleAll ? compositeFrame(doc, ctx.frameId) : doc.ensureCel(ctx.layerId, ctx.frameId);
		if (ctx.selection.active && ctx.selection.coverage(x, y) === 0) return;
		const mask = floodMask(src, doc.width, doc.height, x, y, f.tolerance, f.contiguous && !p.shift);
		const s = new StrokeSession(
			doc,
			ctx.layerId,
			ctx.frameId,
			'paint',
			ctx.fg,
			f.opacity,
			ctx.selection.active ? ctx.selection : null,
			null
		);
		for (let i = 0; i < mask.length; i++) if (mask[i]) s.plot(i % doc.width, Math.floor(i / doc.width), 1);
		if (s.commit(ctx.history, 'Fill')) ctx.usedColor(ctx.fg);
	},
	onMove() {},
	onUp() {}
};

// ── eyedropper ───────────────────────────────────────────────────────────────

export function sampleColor(ctx: ToolContext, x: number, y: number, sampleAll: boolean): RGBA | null {
	const { doc } = ctx;
	x = Math.floor(x);
	y = Math.floor(y);
	if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
	const buf = sampleAll ? compositeFrame(doc, ctx.frameId) : doc.getCel(ctx.layerId, ctx.frameId);
	if (!buf) return [0, 0, 0, 0];
	const i = (y * doc.width + x) * 4;
	return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
}

function pick(ctx: ToolContext, p: PointerInfo) {
	const c = sampleColor(ctx, p.x, p.y, ctx.settings.eyedropper.sampleAll !== p.mod);
	if (!c) return;
	if (c[3] === 0) return; // sampling empty canvas shouldn't wipe the current colour
	ctx.setColor(c, p.alt ? 'bg' : 'fg');
}

export const eyedropperTool: Tool = {
	id: 'eyedropper',
	cursor: 'crosshair',
	onDown: pick,
	onMove: pick,
	onUp() {}
};

// ── selection tools ───────────────────────────────────────────────────────────

export function selectModeFrom(p: PointerInfo): SelectMode {
	if (p.shift && p.alt) return 'intersect';
	if (p.shift) return 'add';
	if (p.alt) return 'subtract';
	return 'replace';
}

function marqueeTool(id: 'select-rect' | 'select-ellipse'): Tool {
	let start: Point | null = null;
	let mode: SelectMode = 'replace';
	const rectFrom = (a: Point, p: PointerInfo): Rect => {
		let bx = Math.floor(p.x) + (p.x >= a.x ? 1 : 0),
			by = Math.floor(p.y) + (p.y >= a.y ? 1 : 0);
		if (p.mod) {
			// Constrain to a square with ⌘/Ctrl (Shift is taken by "add to selection").
			const m = Math.max(Math.abs(bx - a.x), Math.abs(by - a.y));
			bx = a.x + Math.sign(bx - a.x || 1) * m;
			by = a.y + Math.sign(by - a.y || 1) * m;
		}
		return { x: Math.min(a.x, bx), y: Math.min(a.y, by), w: Math.abs(bx - a.x), h: Math.abs(by - a.y) };
	};
	return {
		id,
		cursor: 'crosshair',
		onDown(ctx, p) {
			start = { x: Math.floor(p.x), y: Math.floor(p.y) };
			mode = selectModeFrom(p);
			ctx.overlay.rect = { x: start.x, y: start.y, w: 0, h: 0 };
			ctx.overlay.ellipse = id === 'select-ellipse';
			ctx.requestOverlay();
		},
		onMove(ctx, p) {
			if (!start) return;
			ctx.overlay.rect = rectFrom(start, p);
			ctx.requestOverlay();
		},
		onUp(ctx, p) {
			if (!start) return;
			const r = rectFrom(start, p);
			ctx.overlay.rect = null;
			ctx.requestOverlay();
			if (
				r.w === 0 ||
				r.h === 0 ||
				(r.w === 1 && r.h === 1 && Math.hypot(p.x - start.x, p.y - start.y) < 0.5)
			) {
				if (mode === 'replace') ctx.selection.clear();
			} else if (id === 'select-rect') ctx.selection.selectRect(r, mode);
			else ctx.selection.selectEllipse(r, mode);
			start = null;
		},
		cancel(ctx) {
			start = null;
			ctx.overlay.rect = null;
			ctx.requestOverlay();
		}
	};
}

export const selectRectTool = marqueeTool('select-rect');
export const selectEllipseTool = marqueeTool('select-ellipse');

export const lassoTool: Tool = (() => {
	let pts: Point[] | null = null;
	let mode: SelectMode = 'replace';
	return {
		id: 'lasso',
		cursor: 'crosshair',
		onDown(ctx, p) {
			pts = [{ x: p.x, y: p.y }];
			mode = selectModeFrom(p);
			ctx.overlay.path = pts;
			ctx.requestOverlay();
		},
		onMove(ctx, p) {
			if (!pts) return;
			const last = pts[pts.length - 1];
			if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.25) pts.push({ x: p.x, y: p.y });
			ctx.requestOverlay();
		},
		onUp(ctx) {
			if (!pts) return;
			if (pts.length < 3) {
				if (mode === 'replace') ctx.selection.clear();
			} else ctx.selection.selectPolygon(pts, mode);
			pts = null;
			ctx.overlay.path = null;
			ctx.requestOverlay();
		},
		cancel(ctx) {
			pts = null;
			ctx.overlay.path = null;
			ctx.requestOverlay();
		}
	};
})();

export const wandTool: Tool = {
	id: 'wand',
	cursor: 'crosshair',
	onDown(ctx, p) {
		const { doc } = ctx;
		const w = ctx.settings.wand;
		const src = w.sampleAll ? compositeFrame(doc, ctx.frameId) : doc.ensureCel(ctx.layerId, ctx.frameId);
		ctx.selection.selectSimilar(
			src,
			Math.floor(p.x),
			Math.floor(p.y),
			w.tolerance,
			w.contiguous,
			selectModeFrom(p)
		);
	},
	onMove() {},
	onUp() {}
};

// ── move ─────────────────────────────────────────────────────────────────────

/**
 * Moves the selected pixels (or the whole layer when nothing is selected). Alt-drag moves a copy.
 * The drag is live-previewed on the layer and committed as one undo step on release.
 */
export class MoveSession {
	private orig: Uint8ClampedArray;
	private lifted: Uint8ClampedArray;
	private base: Uint8ClampedArray;
	private bounds: Rect;
	private lastRect: Rect | null = null;
	dx = 0;
	dy = 0;

	constructor(
		private ctx: ToolContext,
		copy: boolean
	) {
		const { doc, selection } = ctx;
		const cel = doc.ensureCel(ctx.layerId, ctx.frameId);
		this.orig = new Uint8ClampedArray(cel);
		this.lifted = new Uint8ClampedArray(cel.length);
		this.base = new Uint8ClampedArray(cel);
		for (let i = 0; i < doc.width * doc.height; i++) {
			const cov = selection.active ? selection.mask![i] / 255 : 1;
			if (!cov) continue;
			const p = i * 4;
			this.lifted[p] = cel[p];
			this.lifted[p + 1] = cel[p + 1];
			this.lifted[p + 2] = cel[p + 2];
			this.lifted[p + 3] = cel[p + 3] * cov;
			if (!copy) this.base[p + 3] = cel[p + 3] * (1 - cov);
		}
		this.bounds = selection.bounds ?? { x: 0, y: 0, w: doc.width, h: doc.height };
	}

	update(dx: number, dy: number) {
		this.dx = dx;
		this.dy = dy;
		const { doc } = this.ctx;
		const W = doc.width,
			H = doc.height;
		const cel = doc.ensureCel(this.ctx.layerId, this.ctx.frameId);
		cel.set(this.base);
		const b = this.bounds;
		for (let y = b.y; y < b.y + b.h; y++) {
			const ty = y + dy;
			if (ty < 0 || ty >= H) continue;
			for (let x = b.x; x < b.x + b.w; x++) {
				const tx = x + dx;
				if (tx < 0 || tx >= W) continue;
				const s = (y * W + x) * 4;
				const sa = this.lifted[s + 3] / 255;
				if (sa <= 0) continue;
				const d = (ty * W + tx) * 4;
				const da = cel[d + 3] / 255;
				const oa = sa + da * (1 - sa);
				const k = da * (1 - sa);
				cel[d] = (this.lifted[s] * sa + cel[d] * k) / oa;
				cel[d + 1] = (this.lifted[s + 1] * sa + cel[d + 1] * k) / oa;
				cel[d + 2] = (this.lifted[s + 2] * sa + cel[d + 2] * k) / oa;
				cel[d + 3] = oa * 255;
			}
		}
		const moved = { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };
		const rect = clampToDoc(unionRect(unionRect(b, moved), this.lastRect)!, W, H);
		this.lastRect = moved;
		if (rect) doc.emit({ type: 'pixels', layerId: this.ctx.layerId, frameId: this.ctx.frameId, rect });
	}

	commit(label = 'Move'): boolean {
		const { doc, history, selection } = this.ctx;
		const b = this.bounds;
		const rect = clampToDoc(
			unionRect(b, { x: b.x + this.dx, y: b.y + this.dy, w: b.w, h: b.h })!,
			doc.width,
			doc.height
		);
		if (!rect) return false;
		const cel = doc.ensureCel(this.ctx.layerId, this.ctx.frameId);
		const before = readRect(this.orig, doc.width, rect);
		const after = readRect(cel, doc.width, rect);
		if (pixelsEqual(before, after)) {
			if (this.dx || this.dy) selection.translate(this.dx, this.dy);
			return false;
		}
		const tx = new Transaction(doc);
		tx.recordApplied(
			{ t: 'patch', layerId: this.ctx.layerId, frameId: this.ctx.frameId, rect, data: after },
			invertPatch(this.ctx.layerId, this.ctx.frameId, rect, before, after)
		);
		history.commit(label, tx, label === 'Nudge' ? 'nudge' : undefined);
		if (this.dx || this.dy) selection.translate(this.dx, this.dy);
		return true;
	}

	cancel() {
		const { doc } = this.ctx;
		doc.ensureCel(this.ctx.layerId, this.ctx.frameId).set(this.orig);
		doc.emit({
			type: 'pixels',
			layerId: this.ctx.layerId,
			frameId: this.ctx.frameId,
			rect: { x: 0, y: 0, w: doc.width, h: doc.height }
		});
	}
}

function clampToDoc(r: Rect, W: number, H: number): Rect | null {
	const x0 = Math.max(0, r.x),
		y0 = Math.max(0, r.y);
	const x1 = Math.min(W, r.x + r.w),
		y1 = Math.min(H, r.y + r.h);
	return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export const moveTool: Tool = (() => {
	let m: MoveSession | null = null;
	let start: Point | null = null;
	return {
		id: 'move',
		cursor: 'move',
		edits: true,
		onDown(ctx, p) {
			if (!canEdit(ctx)) return;
			m = new MoveSession(ctx, p.alt);
			start = { x: p.x, y: p.y };
		},
		onMove(ctx, p) {
			if (!m || !start) return;
			let dx = Math.round(p.x - start.x),
				dy = Math.round(p.y - start.y);
			if (p.shift) {
				if (Math.abs(dx) > Math.abs(dy)) dy = 0;
				else dx = 0;
			}
			if (dx === m.dx && dy === m.dy) return;
			m.update(dx, dy);
			ctx.overlay.selectionOffset = { x: dx, y: dy };
			ctx.requestOverlay();
		},
		onUp(ctx) {
			if (!m) return;
			ctx.overlay.selectionOffset = null;
			m.commit();
			ctx.requestOverlay();
			m = null;
		},
		cancel(ctx) {
			m?.cancel();
			m = null;
			ctx.overlay.selectionOffset = null;
			ctx.requestOverlay();
		}
	};
})();

/** Arrow-key nudge for the move tool. */
export function nudge(ctx: ToolContext, dx: number, dy: number) {
	if (!canEdit(ctx)) return;
	const m = new MoveSession(ctx, false);
	m.update(dx, dy);
	m.commit('Nudge');
}

// ── view tools ───────────────────────────────────────────────────────────────

export const handTool: Tool = (() => {
	let last: Point | null = null;
	return {
		id: 'hand',
		cursor: 'grab',
		onDown(_ctx, p) {
			last = { x: p.sx, y: p.sy };
		},
		onMove(ctx, p) {
			if (!last) return;
			ctx.pan(p.sx - last.x, p.sy - last.y);
			last = { x: p.sx, y: p.sy };
		},
		onUp() {
			last = null;
		}
	};
})();

export const zoomTool: Tool = {
	id: 'zoom',
	cursor: 'zoom-in',
	onDown(ctx, p) {
		ctx.zoomAt(p.alt ? 1 / 2 : 2, p.sx, p.sy);
	},
	onMove() {},
	onUp() {}
};
