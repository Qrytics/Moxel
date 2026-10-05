import type { MoxelDocument } from '../document/document';
import { invertPatch } from '../document/ops';
import { pixelsEqual, readRect } from '../document/pixels';
import type { Rect } from '../document/types';
import { Transaction, type History } from '../history/history';
import type { Selection } from '../selection/selection';
import type { BrushShape, CustomTip, RGBA } from './types';

export type StrokeMode = 'paint' | 'erase' | 'clone';

/**
 * A live paint operation on one cel. The original pixels are kept, coverage accumulates as a
 * max() per pixel, and every touched pixel is recomputed from (original, coverage) — so a stroke
 * that crosses itself doesn't darken (stroke opacity behaves like Photoshop's, not like stacked
 * dabs), shape previews can be reset cheaply, and the whole thing commits as ONE undo step.
 */
export class StrokeSession {
	readonly orig: Uint8ClampedArray;
	readonly cel: Uint8ClampedArray;
	readonly cover: Uint8Array;
	readonly w: number;
	readonly h: number;
	private x0 = Infinity;
	private y0 = Infinity;
	private x1 = -1;
	private y1 = -1;
	private bx0 = Infinity;
	private by0 = Infinity;
	private bx1 = -1;
	private by1 = -1;
	cloneOffset: { x: number; y: number } | null = null;

	constructor(
		readonly doc: MoxelDocument,
		readonly layerId: string,
		readonly frameId: string,
		readonly mode: StrokeMode,
		readonly color: RGBA,
		readonly opacity: number,
		readonly selection: Selection | null,
		readonly mirror: ((i: number) => number[]) | null
	) {
		this.w = doc.width;
		this.h = doc.height;
		this.cel = doc.ensureCel(layerId, frameId);
		this.orig = new Uint8ClampedArray(this.cel);
		this.cover = new Uint8Array(this.w * this.h);
	}

	/** Add coverage (0..1) at a pixel, plus its mirror images. */
	plot(x: number, y: number, alpha: number) {
		if (x < 0 || y < 0 || x >= this.w || y >= this.h || alpha <= 0) return;
		const i = y * this.w + x;
		this.cover1(i, alpha);
		if (this.mirror) for (const j of this.mirror(i)) this.cover1(j, alpha);
	}

	/** Remove a pixel from the stroke (pixel-perfect corner cleanup). */
	unplot(x: number, y: number) {
		if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
		const i = y * this.w + x;
		this.uncover(i);
		if (this.mirror) for (const j of this.mirror(i)) this.uncover(j);
	}

	private cover1(i: number, alpha: number) {
		const v = Math.round(Math.min(1, alpha) * 255);
		if (v <= this.cover[i]) return;
		this.cover[i] = v;
		this.recompute(i);
	}

	private uncover(i: number) {
		if (!this.cover[i]) return;
		this.cover[i] = 0;
		this.recompute(i);
	}

	private recompute(i: number) {
		const x = i % this.w,
			y = (i - x) / this.w;
		this.touch(x, y);
		const sel = this.selection ? this.selection.coverage(x, y) / 255 : 1;
		const m = (this.cover[i] / 255) * this.opacity * sel;
		const p = i * 4;
		const o = this.orig;
		const c = this.cel;
		if (m <= 0) {
			c[p] = o[p];
			c[p + 1] = o[p + 1];
			c[p + 2] = o[p + 2];
			c[p + 3] = o[p + 3];
			return;
		}
		if (this.mode === 'erase') {
			c[p] = o[p];
			c[p + 1] = o[p + 1];
			c[p + 2] = o[p + 2];
			c[p + 3] = o[p + 3] * (1 - m);
			return;
		}
		let r = this.color[0],
			g = this.color[1],
			b = this.color[2],
			a = this.color[3] / 255;
		if (this.mode === 'clone') {
			const off = this.cloneOffset;
			if (!off) return;
			const sx = x + off.x,
				sy = y + off.y;
			if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) return;
			const s = (sy * this.w + sx) * 4;
			r = o[s];
			g = o[s + 1];
			b = o[s + 2];
			a = o[s + 3] / 255;
		}
		const sa = a * m;
		const da = o[p + 3] / 255;
		const oa = sa + da * (1 - sa);
		if (oa <= 0) {
			c[p + 3] = 0;
			return;
		}
		const k = da * (1 - sa);
		c[p] = (r * sa + o[p] * k) / oa;
		c[p + 1] = (g * sa + o[p + 1] * k) / oa;
		c[p + 2] = (b * sa + o[p + 2] * k) / oa;
		c[p + 3] = oa * 255;
	}

	private touch(x: number, y: number) {
		if (x < this.x0) this.x0 = x;
		if (y < this.y0) this.y0 = y;
		if (x > this.x1) this.x1 = x;
		if (y > this.y1) this.y1 = y;
		if (x < this.bx0) this.bx0 = x;
		if (y < this.by0) this.by0 = y;
		if (x > this.bx1) this.bx1 = x;
		if (y > this.by1) this.by1 = y;
	}

	get dirty(): Rect | null {
		return this.x1 < 0
			? null
			: { x: this.x0, y: this.y0, w: this.x1 - this.x0 + 1, h: this.y1 - this.y0 + 1 };
	}

	/** Tell the renderer what changed since the last flush. */
	flush() {
		if (this.bx1 < 0) return;
		const rect = { x: this.bx0, y: this.by0, w: this.bx1 - this.bx0 + 1, h: this.by1 - this.by0 + 1 };
		this.bx0 = this.by0 = Infinity;
		this.bx1 = this.by1 = -1;
		this.doc.emit({ type: 'pixels', layerId: this.layerId, frameId: this.frameId, rect });
	}

	/** Undo everything drawn so far but keep the session (used by shape previews). */
	reset() {
		const d = this.dirty;
		if (!d) return;
		for (let y = d.y; y < d.y + d.h; y++) {
			const row = y * this.w;
			for (let x = d.x; x < d.x + d.w; x++) {
				const i = row + x;
				if (!this.cover[i]) continue;
				this.cover[i] = 0;
				const p = i * 4;
				this.cel[p] = this.orig[p];
				this.cel[p + 1] = this.orig[p + 1];
				this.cel[p + 2] = this.orig[p + 2];
				this.cel[p + 3] = this.orig[p + 3];
				this.touch(x, y);
			}
		}
	}

	cancel() {
		this.reset();
		this.flush();
	}

	/** Record the stroke as one history entry. Returns false if nothing changed. */
	commit(history: History, label: string): boolean {
		this.flush();
		const rect = this.dirty;
		if (!rect) return false;
		const before = readRect(this.orig, this.w, rect);
		const after = readRect(this.cel, this.w, rect);
		if (pixelsEqual(before, after)) return false;
		const tx = new Transaction(this.doc);
		tx.recordApplied(
			{ t: 'patch', layerId: this.layerId, frameId: this.frameId, rect, data: after },
			invertPatch(this.layerId, this.frameId, rect, before, after)
		);
		return history.commit(label, tx);
	}
}

/**
 * Stamp one brush dab centred at (cx, cy) in document pixels.
 * `aliased` dabs are pure pixel art: every pixel is fully in or out.
 */
export function stampDab(
	s: StrokeSession,
	cx: number,
	cy: number,
	size: number,
	hardness: number,
	shape: BrushShape,
	aliased: boolean,
	alpha: number,
	tip: CustomTip | null
) {
	const sz = Math.max(1, size);
	if (shape === 'custom' && tip) {
		const tw = Math.max(1, Math.round(sz * (tip.w / Math.max(tip.w, tip.h))));
		const th = Math.max(1, Math.round(sz * (tip.h / Math.max(tip.w, tip.h))));
		const ox = Math.floor(cx - tw / 2 + 0.5),
			oy = Math.floor(cy - th / 2 + 0.5);
		for (let y = 0; y < th; y++)
			for (let x = 0; x < tw; x++) {
				const v = tip.mask[Math.floor((y * tip.h) / th) * tip.w + Math.floor((x * tip.w) / tw)] / 255;
				if (v > 0) s.plot(ox + x, oy + y, aliased ? (v >= 0.5 ? alpha : 0) : v * alpha);
			}
		return;
	}
	if (aliased) {
		// Odd sizes centre on a pixel, even sizes on a pixel corner, so 1px stays 1px.
		const odd = Math.round(sz) % 2 === 1;
		const ccx = odd ? Math.floor(cx) + 0.5 : Math.round(cx);
		const ccy = odd ? Math.floor(cy) + 0.5 : Math.round(cy);
		const r = Math.round(sz) / 2;
		const lim = (r - 0.25) * (r - 0.25);
		const x0 = Math.floor(ccx - r),
			y0 = Math.floor(ccy - r);
		const n = Math.round(sz);
		for (let y = y0; y < y0 + n; y++)
			for (let x = x0; x < x0 + n; x++) {
				const dx = x + 0.5 - ccx,
					dy = y + 0.5 - ccy;
				if (shape === 'square' || n <= 2 || dx * dx + dy * dy <= lim) s.plot(x, y, alpha);
			}
		return;
	}
	const r = sz / 2;
	const inner = r * Math.min(0.999, Math.max(0, hardness));
	const x0 = Math.floor(cx - r - 1),
		x1 = Math.ceil(cx + r + 1);
	const y0 = Math.floor(cy - r - 1),
		y1 = Math.ceil(cy + r + 1);
	for (let y = y0; y <= y1; y++)
		for (let x = x0; x <= x1; x++) {
			const dx = x + 0.5 - cx,
				dy = y + 0.5 - cy;
			const d = shape === 'square' ? Math.max(Math.abs(dx), Math.abs(dy)) : Math.sqrt(dx * dx + dy * dy);
			if (d >= r + 0.5) continue;
			let a: number;
			if (d <= inner) a = 1;
			else a = Math.max(0, Math.min(1, (r + 0.5 - d) / (r + 0.5 - inner)));
			// Smooth the falloff curve so soft brushes don't look conical.
			a = a * a * (3 - 2 * a);
			s.plot(x, y, a * alpha);
		}
}

/** Integer line (Bresenham), inclusive of both ends. */
export function linePixels(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	fn: (x: number, y: number) => void
) {
	x0 = Math.floor(x0);
	y0 = Math.floor(y0);
	x1 = Math.floor(x1);
	y1 = Math.floor(y1);
	const dx = Math.abs(x1 - x0),
		dy = -Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1,
		sy = y0 < y1 ? 1 : -1;
	let err = dx + dy;
	for (;;) {
		fn(x0, y0);
		if (x0 === x1 && y0 === y1) break;
		const e2 = 2 * err;
		if (e2 >= dy) {
			err += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			err += dx;
			y0 += sy;
		}
	}
}
