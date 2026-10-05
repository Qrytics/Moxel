import type { Rect } from '../document/types';

export type SelectMode = 'replace' | 'add' | 'subtract' | 'intersect';
export interface Point {
	x: number;
	y: number;
}

/**
 * Pixel selection as a 0/255 coverage mask. `mask === null` means "no selection", in which case
 * tools affect the whole layer. Every selection tool (rect, lasso, wand, select-by-colour…) just
 * produces a mask and combines it with `apply`, so new selection tools slot in without touching
 * the tools that consume selections.
 */
export class Selection {
	mask: Uint8Array | null = null;
	bounds: Rect | null = null;
	private listeners = new Set<() => void>();
	private edgeCache: Float32Array | null = null;

	constructor(
		public width: number,
		public height: number
	) {}

	get active() {
		return this.mask !== null;
	}

	subscribe(fn: () => void) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private changed() {
		this.edgeCache = null;
		this.bounds = this.mask ? maskBounds(this.mask, this.width, this.height) : null;
		if (!this.bounds) this.mask = null;
		for (const fn of this.listeners) fn();
	}

	resize(width: number, height: number) {
		this.width = width;
		this.height = height;
		this.mask = null;
		this.changed();
	}

	/** Coverage 0..255 at a pixel; 255 everywhere when nothing is selected. */
	coverage(x: number, y: number): number {
		if (!this.mask) return 255;
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
		return this.mask[y * this.width + x];
	}

	apply(next: Uint8Array, mode: SelectMode) {
		const cur = this.mask;
		if (mode === 'replace' || !cur) {
			// With no current selection: add/intersect start from `next`; subtracting leaves nothing.
			this.mask = mode === 'subtract' ? null : next;
		} else {
			const out = new Uint8Array(cur.length);
			for (let i = 0; i < cur.length; i++) {
				if (mode === 'add') out[i] = Math.max(cur[i], next[i]);
				else if (mode === 'subtract') out[i] = next[i] ? 0 : cur[i];
				else out[i] = Math.min(cur[i], next[i]);
			}
			this.mask = out;
		}
		this.changed();
	}

	setMask(mask: Uint8Array | null) {
		this.mask = mask;
		this.changed();
	}

	selectRect(r: Rect, mode: SelectMode = 'replace') {
		const m = new Uint8Array(this.width * this.height);
		const x0 = Math.max(0, Math.floor(Math.min(r.x, r.x + r.w)));
		const y0 = Math.max(0, Math.floor(Math.min(r.y, r.y + r.h)));
		const x1 = Math.min(this.width, Math.ceil(Math.max(r.x, r.x + r.w)));
		const y1 = Math.min(this.height, Math.ceil(Math.max(r.y, r.y + r.h)));
		for (let y = y0; y < y1; y++) m.fill(255, y * this.width + x0, y * this.width + x1);
		this.apply(m, mode);
	}

	selectEllipse(r: Rect, mode: SelectMode = 'replace') {
		const m = new Uint8Array(this.width * this.height);
		const cx = r.x + r.w / 2,
			cy = r.y + r.h / 2,
			rx = Math.abs(r.w / 2),
			ry = Math.abs(r.h / 2);
		if (rx > 0 && ry > 0)
			for (let y = 0; y < this.height; y++)
				for (let x = 0; x < this.width; x++) {
					const dx = (x + 0.5 - cx) / rx,
						dy = (y + 0.5 - cy) / ry;
					if (dx * dx + dy * dy <= 1) m[y * this.width + x] = 255;
				}
		this.apply(m, mode);
	}

	/** Lasso: pixels whose centre lies inside the polygon (even-odd rule). */
	selectPolygon(points: Point[], mode: SelectMode = 'replace') {
		const m = new Uint8Array(this.width * this.height);
		if (points.length >= 3) {
			for (let y = 0; y < this.height; y++) {
				const py = y + 0.5;
				const xs: number[] = [];
				for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
					const a = points[i],
						b = points[j];
					if (a.y > py !== b.y > py) xs.push(a.x + ((py - a.y) * (b.x - a.x)) / (b.y - a.y));
				}
				xs.sort((p, q) => p - q);
				for (let k = 0; k + 1 < xs.length; k += 2) {
					const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
					const x1 = Math.min(this.width - 1, Math.floor(xs[k + 1] - 0.5));
					if (x1 >= x0) m.fill(255, y * this.width + x0, y * this.width + x1 + 1);
				}
			}
		}
		this.apply(m, mode);
	}

	/** Magic wand over an RGBA buffer. */
	selectSimilar(
		src: Uint8ClampedArray,
		x: number,
		y: number,
		tolerance: number,
		contiguous: boolean,
		mode: SelectMode = 'replace'
	) {
		this.apply(floodMask(src, this.width, this.height, x, y, tolerance, contiguous), mode);
	}

	selectAll() {
		this.setMask(new Uint8Array(this.width * this.height).fill(255));
	}

	clear() {
		if (this.mask) this.setMask(null);
	}

	invert() {
		if (!this.mask) return this.selectAll();
		const out = new Uint8Array(this.mask.length);
		for (let i = 0; i < out.length; i++) out[i] = 255 - this.mask[i];
		this.setMask(out);
	}

	/** Select every non-transparent pixel of a layer (Ctrl/Cmd-click on a layer thumbnail). */
	selectOpaque(src: Uint8ClampedArray, mode: SelectMode = 'replace') {
		const m = new Uint8Array(this.width * this.height);
		for (let i = 0; i < m.length; i++) m[i] = src[i * 4 + 3] > 0 ? 255 : 0;
		this.apply(m, mode);
	}

	translate(dx: number, dy: number) {
		if (!this.mask) return;
		this.setMask(shiftMask(this.mask, this.width, this.height, dx, dy));
	}

	/**
	 * Boundary segments for "marching ants", as a flat [x0,y0,x1,y1,…] array in pixel units.
	 * Cached until the mask changes.
	 */
	edges(): Float32Array {
		if (this.edgeCache) return this.edgeCache;
		const m = this.mask;
		const segs: number[] = [];
		if (m) {
			const w = this.width,
				h = this.height;
			const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] > 127;
			for (let y = 0; y <= h; y++) {
				let run = -1;
				for (let x = 0; x <= w; x++) {
					const edge = x < w && on(x, y) !== on(x, y - 1);
					if (edge && run < 0) run = x;
					if (!edge && run >= 0) {
						segs.push(run, y, x, y);
						run = -1;
					}
				}
			}
			for (let x = 0; x <= w; x++) {
				let run = -1;
				for (let y = 0; y <= h; y++) {
					const edge = y < h && on(x, y) !== on(x - 1, y);
					if (edge && run < 0) run = y;
					if (!edge && run >= 0) {
						segs.push(x, run, x, y);
						run = -1;
					}
				}
			}
		}
		this.edgeCache = new Float32Array(segs);
		return this.edgeCache;
	}
}

export function maskBounds(mask: Uint8Array, w: number, h: number): Rect | null {
	let x0 = w,
		y0 = h,
		x1 = -1,
		y1 = -1;
	for (let y = 0; y < h; y++) {
		const row = y * w;
		for (let x = 0; x < w; x++) {
			if (mask[row + x]) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
		}
	}
	return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function shiftMask(mask: Uint8Array, w: number, h: number, dx: number, dy: number): Uint8Array {
	const out = new Uint8Array(mask.length);
	for (let y = 0; y < h; y++) {
		const sy = y - dy;
		if (sy < 0 || sy >= h) continue;
		for (let x = 0; x < w; x++) {
			const sx = x - dx;
			if (sx >= 0 && sx < w) out[y * w + x] = mask[sy * w + sx];
		}
	}
	return out;
}

/** Colour distance used by fill and magic wand: max per-channel difference, 0..255. */
export function colorDistance(a: Uint8ClampedArray, i: number, r: number, g: number, b: number, al: number) {
	// Fully transparent pixels match each other regardless of their (invisible) RGB.
	if (a[i + 3] === 0 && al === 0) return 0;
	return Math.max(
		Math.abs(a[i] - r),
		Math.abs(a[i + 1] - g),
		Math.abs(a[i + 2] - b),
		Math.abs(a[i + 3] - al)
	);
}

/** Pixels similar to (x, y) — contiguous flood (4-connected) or global. */
export function floodMask(
	src: Uint8ClampedArray,
	w: number,
	h: number,
	x: number,
	y: number,
	tolerance: number,
	contiguous: boolean
): Uint8Array {
	const m = new Uint8Array(w * h);
	if (x < 0 || y < 0 || x >= w || y >= h) return m;
	const s = (y * w + x) * 4;
	const r = src[s],
		g = src[s + 1],
		b = src[s + 2],
		a = src[s + 3];
	const tol = Math.max(0, Math.min(255, tolerance));
	if (!contiguous) {
		for (let i = 0; i < w * h; i++) if (colorDistance(src, i * 4, r, g, b, a) <= tol) m[i] = 255;
		return m;
	}
	const stack = new Int32Array(w * h);
	let sp = 0;
	stack[sp++] = y * w + x;
	m[y * w + x] = 255;
	while (sp > 0) {
		const p = stack[--sp];
		const px = p % w,
			py = (p - px) / w;
		const visit = (q: number) => {
			if (m[q]) return;
			if (colorDistance(src, q * 4, r, g, b, a) <= tol) {
				m[q] = 255;
				stack[sp++] = q;
			}
		};
		if (px > 0) visit(p - 1);
		if (px < w - 1) visit(p + 1);
		if (py > 0) visit(p - w);
		if (py < h - 1) visit(p + w);
	}
	return m;
}
