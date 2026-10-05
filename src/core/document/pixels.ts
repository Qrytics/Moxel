import type { Rect } from './types';

export function clampRect(r: Rect, width: number, height: number): Rect | null {
	const x0 = Math.max(0, Math.floor(r.x));
	const y0 = Math.max(0, Math.floor(r.y));
	const x1 = Math.min(width, Math.ceil(r.x + r.w));
	const y1 = Math.min(height, Math.ceil(r.y + r.h));
	if (x1 <= x0 || y1 <= y0) return null;
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
	if (!a) return b;
	if (!b) return a;
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);
	return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Copy a rect out of a width-wide RGBA buffer. */
export function readRect(src: Uint8ClampedArray, width: number, r: Rect): Uint8ClampedArray {
	const out = new Uint8ClampedArray(r.w * r.h * 4);
	for (let y = 0; y < r.h; y++) {
		const s = ((r.y + y) * width + r.x) * 4;
		out.set(src.subarray(s, s + r.w * 4), y * r.w * 4);
	}
	return out;
}

/** Write a rect-sized RGBA buffer back into a width-wide buffer. */
export function writeRect(dst: Uint8ClampedArray, width: number, r: Rect, data: Uint8ClampedArray): void {
	for (let y = 0; y < r.h; y++) {
		const d = ((r.y + y) * width + r.x) * 4;
		dst.set(data.subarray(y * r.w * 4, (y + 1) * r.w * 4), d);
	}
}

export function isEmpty(buf: Uint8ClampedArray): boolean {
	for (let i = 3; i < buf.length; i += 4) if (buf[i] !== 0) return false;
	return true;
}

/** Bounding box of non-transparent pixels, or null if fully transparent. */
export function contentBounds(buf: Uint8ClampedArray, width: number, height: number): Rect | null {
	let x0 = width,
		y0 = height,
		x1 = -1,
		y1 = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (buf[(y * width + x) * 4 + 3] !== 0) {
				if (x < x0) x0 = x;
				if (x > x1) x1 = x;
				if (y < y0) y0 = y;
				if (y > y1) y1 = y;
			}
		}
	}
	return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function pixelsEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
