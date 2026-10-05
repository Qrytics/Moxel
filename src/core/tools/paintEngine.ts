import type { MoxelDocument } from '../document/document';
import { invertPatch } from '../document/ops';
import { pixelsEqual, readRect } from '../document/pixels';
import type { Rect } from '../document/types';
import { Transaction, type History } from '../history/history';
import type { Selection } from '../selection/selection';
import type { PaintBrushSettings, PressureCurve, RGBA, SymmetryMode } from './types';

/**
 * The paint-mode stroke engine. Where `StrokeSession` is built for pixel art (one byte of coverage
 * per pixel, max() accumulation, a full-canvas copy per stroke), this one is built for big, soft
 * strokes on canvases up to 4096²:
 *
 * - The original pixels are backed up lazily, one 64×64 tile at a time, the first time a stroke
 *   touches that tile. Memory, undo size and live-session traffic follow the painted area — a
 *   diagonal line across a huge canvas costs its tiles, not its bounding box.
 * - Coverage is float, and accumulates with flow (`a += (1 - a)·dab`), capped at the stroke's
 *   opacity. Soft, low-flow strokes build up smoothly instead of banding in 8-bit steps.
 * - Commit writes one `patch` op per changed tile, all in one history entry.
 */

export const TILE = 64;

export type PaintMode = 'paint' | 'erase' | 'smudge' | 'blur';

/** One stamp of the brush tip, in document pixels. */
export interface Dab {
	x: number;
	y: number;
	/** Diameter. Below 1px the dab keeps a 1px footprint and fades instead of shrinking. */
	size: number;
	/** 0..1 coverage multiplier (flow × pressure × jitter). */
	alpha: number;
	hardness: number;
	/** Radians. */
	angle: number;
	roundness: number;
	grain: number;
	grainScale: number;
}

type MirrorFn = (x: number, y: number) => [number, number][];

export class PaintStroke {
	readonly w: number;
	readonly h: number;
	readonly cel: Uint8ClampedArray;
	private readonly tilesX: number;
	/** Tile index → the tile's pixels as they were before this stroke. */
	readonly backups = new Map<number, Uint8ClampedArray>();
	/** Tile index → stroke coverage 0..1 (paint and erase only). */
	private readonly cover = new Map<number, Float32Array>();
	/** Smudge: the paint carried by each finger (one per mirror image), premultiplied 0..255. */
	private carry: { buf: Float32Array; n: number }[] = [];
	private dirty: Rect | null = null;
	private pending: Rect | null = null;
	/** Smudge finger diameter — the brush's full size, so pressure changes don't resize it mid-stroke. */
	fingerSize = 0;

	constructor(
		readonly doc: MoxelDocument,
		readonly layerId: string,
		readonly frameId: string,
		readonly mode: PaintMode,
		readonly color: RGBA,
		/** Stroke opacity cap (paint/erase) — smudge and blur use `strength` instead. */
		readonly opacity: number,
		readonly selection: Selection | null,
		readonly mirror: MirrorFn | null = null,
		/** Smudge: paint carried (0..1). Blur: positive blurs, negative sharpens. */
		readonly strength = 0.5
	) {
		this.w = doc.width;
		this.h = doc.height;
		this.cel = doc.ensureCel(layerId, frameId);
		this.tilesX = Math.ceil(this.w / TILE);
	}

	tileRect(t: number): Rect {
		const x = (t % this.tilesX) * TILE,
			y = Math.floor(t / this.tilesX) * TILE;
		return { x, y, w: Math.min(TILE, this.w - x), h: Math.min(TILE, this.h - y) };
	}

	/** Back up a tile before its first write. Returns the backup. */
	private backup(t: number): Uint8ClampedArray {
		let b = this.backups.get(t);
		if (!b) {
			b = readRect(this.cel, this.w, this.tileRect(t));
			this.backups.set(t, b);
		}
		return b;
	}

	private tileOf(x: number, y: number) {
		return Math.floor(y / TILE) * this.tilesX + Math.floor(x / TILE);
	}

	/** Make sure every tile overlapping a rect is backed up, so it can be written freely. */
	private prepare(x0: number, y0: number, x1: number, y1: number) {
		for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++)
			for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++)
				this.backup(ty * this.tilesX + tx);
		const r = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
		this.dirty = union(this.dirty, r);
		this.pending = union(this.pending, r);
	}

	/** The pixel as it was before the stroke. Only valid for backed-up tiles. */
	private origIndex(x: number, y: number): [Uint8ClampedArray, number] {
		const t = this.tileOf(x, y);
		const r = this.tileRect(t);
		return [this.backups.get(t)!, ((y - r.y) * r.w + (x - r.x)) * 4];
	}

	private sel(x: number, y: number) {
		return this.selection ? this.selection.coverage(x, y) / 255 : 1;
	}

	/** Stamp a dab plus its mirror images. */
	stamp(d: Dab) {
		this.stampAt(d, 0);
		if (this.mirror) this.mirror(d.x, d.y).forEach(([x, y], i) => this.stampAt({ ...d, x, y }, i + 1));
	}

	private stampAt(d: Dab, finger: number) {
		const r = Math.max(0.5, d.size / 2);
		const fade = d.size < 1 ? Math.max(0, d.size) : 1;
		const x0 = Math.max(0, Math.floor(d.x - r - 1)),
			x1 = Math.min(this.w - 1, Math.ceil(d.x + r + 1));
		const y0 = Math.max(0, Math.floor(d.y - r - 1)),
			y1 = Math.min(this.h - 1, Math.ceil(d.y + r + 1));
		if (x0 > x1 || y0 > y1) return;
		const tip = tipSampler(d, r, fade);
		this.prepare(x0, y0, x1, y1);
		if (this.mode === 'smudge') this.smudge(d, r, tip, finger);
		else if (this.mode === 'blur') this.blur(x0, y0, x1, y1, tip);
		else
			for (let y = y0; y <= y1; y++)
				for (let x = x0; x <= x1; x++) {
					const c = tip(x, y);
					if (c > 0) this.accumulate(x, y, c);
				}
	}

	private accumulate(x: number, y: number, c: number) {
		// Inlined tile maths: this runs for every pixel of every dab.
		const tx = (x / TILE) | 0,
			ty = (y / TILE) | 0;
		const t = ty * this.tilesX + tx;
		const rw = Math.min(TILE, this.w - tx * TILE);
		let cov = this.cover.get(t);
		if (!cov) {
			cov = new Float32Array(rw * Math.min(TILE, this.h - ty * TILE));
			this.cover.set(t, cov);
		}
		const li = (y - ty * TILE) * rw + (x - tx * TILE);
		const a = cov[li];
		const na = a + (1 - a) * Math.min(1, c);
		if (na - a < 1e-5) return;
		cov[li] = na;
		const o = this.backups.get(t)!;
		const m = na * this.opacity * this.sel(x, y);
		const p = (y * this.w + x) * 4,
			q = li * 4;
		const cel = this.cel;
		if (this.mode === 'erase') {
			cel[p] = o[q];
			cel[p + 1] = o[q + 1];
			cel[p + 2] = o[q + 2];
			cel[p + 3] = o[q + 3] * (1 - m);
			return;
		}
		over(cel, p, o[q], o[q + 1], o[q + 2], o[q + 3], this.color, m);
	}

	private smudge(d: Dab, r: number, tip: (x: number, y: number) => number, finger: number) {
		// The finger is a fixed-size buffer centred on the dab; it holds the paint picked up so far.
		let f = this.carry[finger];
		if (!f) {
			const n = Math.ceil(Math.max(r * 2, this.fingerSize)) + 3;
			f = this.carry[finger] = { buf: new Float32Array(n * n * 4), n };
			this.pickUp(f, d);
			return;
		}
		const keep = Math.min(0.98, Math.max(0, this.strength));
		const half = Math.floor(f.n / 2);
		const ox = Math.floor(d.x) - half,
			oy = Math.floor(d.y) - half;
		this.prepare(
			Math.max(0, ox),
			Math.max(0, oy),
			Math.min(this.w - 1, ox + f.n - 1),
			Math.min(this.h - 1, oy + f.n - 1)
		);
		const cel = this.cel,
			buf = f.buf;
		for (let j = 0; j < f.n; j++) {
			const y = oy + j;
			if (y < 0 || y >= this.h) continue;
			for (let i = 0; i < f.n; i++) {
				const x = ox + i;
				if (x < 0 || x >= this.w) continue;
				const p = (y * this.w + x) * 4,
					k = (j * f.n + i) * 4;
				const a = cel[p + 3] / 255;
				const pr = cel[p] * a,
					pg = cel[p + 1] * a,
					pb = cel[p + 2] * a,
					pa = cel[p + 3];
				// Carried paint mixes with what's under the finger, then is laid down by the tip.
				buf[k] = buf[k] * keep + pr * (1 - keep);
				buf[k + 1] = buf[k + 1] * keep + pg * (1 - keep);
				buf[k + 2] = buf[k + 2] * keep + pb * (1 - keep);
				buf[k + 3] = buf[k + 3] * keep + pa * (1 - keep);
				const c = tip(x, y) * this.sel(x, y);
				if (c <= 0) continue;
				writePremult(
					cel,
					p,
					pr + (buf[k] - pr) * c,
					pg + (buf[k + 1] - pg) * c,
					pb + (buf[k + 2] - pb) * c,
					pa + (buf[k + 3] - pa) * c
				);
			}
		}
	}

	private pickUp(f: { buf: Float32Array; n: number }, d: Dab) {
		const half = Math.floor(f.n / 2);
		const ox = Math.floor(d.x) - half,
			oy = Math.floor(d.y) - half;
		for (let j = 0; j < f.n; j++)
			for (let i = 0; i < f.n; i++) {
				const x = Math.min(this.w - 1, Math.max(0, ox + i)),
					y = Math.min(this.h - 1, Math.max(0, oy + j));
				const p = (y * this.w + x) * 4,
					k = (j * f.n + i) * 4;
				const a = this.cel[p + 3] / 255;
				f.buf[k] = this.cel[p] * a;
				f.buf[k + 1] = this.cel[p + 1] * a;
				f.buf[k + 2] = this.cel[p + 2] * a;
				f.buf[k + 3] = this.cel[p + 3];
			}
	}

	private blur(x0: number, y0: number, x1: number, y1: number, tip: (x: number, y: number) => number) {
		// A 5-tap binomial blur of the footprint (plus a 2px margin), premultiplied so transparent
		// neighbours don't bleed dark fringes. Repeated dabs blur further, like a real blur brush.
		const m = 2;
		const bx0 = Math.max(0, x0 - m),
			by0 = Math.max(0, y0 - m);
		const bx1 = Math.min(this.w - 1, x1 + m),
			by1 = Math.min(this.h - 1, y1 + m);
		const bw = bx1 - bx0 + 1,
			bh = by1 - by0 + 1;
		const src = new Float32Array(bw * bh * 4);
		for (let y = 0; y < bh; y++)
			for (let x = 0; x < bw; x++) {
				const p = ((by0 + y) * this.w + bx0 + x) * 4,
					k = (y * bw + x) * 4;
				const a = this.cel[p + 3] / 255;
				src[k] = this.cel[p] * a;
				src[k + 1] = this.cel[p + 1] * a;
				src[k + 2] = this.cel[p + 2] * a;
				src[k + 3] = this.cel[p + 3];
			}
		const tmp = new Float32Array(src.length);
		const K = [1, 4, 6, 4, 1];
		const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
			for (let y = 0; y < bh; y++)
				for (let x = 0; x < bw; x++) {
					let s0 = 0,
						s1 = 0,
						s2 = 0,
						s3 = 0,
						ws = 0;
					for (let t = -2; t <= 2; t++) {
						const xx = horizontal ? x + t : x,
							yy = horizontal ? y : y + t;
						if (xx < 0 || yy < 0 || xx >= bw || yy >= bh) continue;
						const k = (yy * bw + xx) * 4,
							wt = K[t + 2];
						s0 += from[k] * wt;
						s1 += from[k + 1] * wt;
						s2 += from[k + 2] * wt;
						s3 += from[k + 3] * wt;
						ws += wt;
					}
					const k = (y * bw + x) * 4;
					to[k] = s0 / ws;
					to[k + 1] = s1 / ws;
					to[k + 2] = s2 / ws;
					to[k + 3] = s3 / ws;
				}
		};
		const out = new Float32Array(src.length);
		pass(src, tmp, true);
		pass(tmp, out, false);
		const k0 = Math.min(1, Math.abs(this.strength));
		const sharpen = this.strength < 0;
		for (let y = y0; y <= y1; y++)
			for (let x = x0; x <= x1; x++) {
				const c = tip(x, y) * this.sel(x, y) * k0;
				if (c <= 0) continue;
				const k = ((y - by0) * bw + (x - bx0)) * 4;
				const p = (y * this.w + x) * 4;
				const mix = (i: number) =>
					sharpen ? src[k + i] + (src[k + i] - out[k + i]) * c : src[k + i] + (out[k + i] - src[k + i]) * c;
				writePremult(this.cel, p, mix(0), mix(1), mix(2), mix(3));
			}
	}

	/**
	 * Composite a per-pixel colour over the original pixels of a region (gradients). `color` returns
	 * straight RGBA (alpha 0..255), or null to leave the pixel alone.
	 */
	fillRegion(region: Rect, color: (x: number, y: number) => RGBA | null, opacity: number) {
		const x1 = region.x + region.w - 1,
			y1 = region.y + region.h - 1;
		this.prepare(region.x, region.y, x1, y1);
		for (let y = region.y; y <= y1; y++)
			for (let x = region.x; x <= x1; x++) {
				const c = color(x, y);
				const m = opacity * this.sel(x, y);
				if (!c || m <= 0) continue;
				const [o, q] = this.origIndex(x, y);
				over(this.cel, (y * this.w + x) * 4, o[q], o[q + 1], o[q + 2], o[q + 3], c, m);
			}
	}

	/** Tell the renderer what changed since the last flush. */
	flush() {
		if (!this.pending) return;
		const rect = this.pending;
		this.pending = null;
		this.doc.emit({ type: 'pixels', layerId: this.layerId, frameId: this.frameId, rect });
	}

	/** Put every touched tile back as it was. */
	cancel() {
		for (const [t, b] of this.backups) {
			const r = this.tileRect(t);
			for (let y = 0; y < r.h; y++)
				this.cel.set(b.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * this.w + r.x) * 4);
		}
		this.pending = this.dirty;
		this.backups.clear();
		this.cover.clear();
		this.flush();
	}

	/** Record the stroke as one history entry: one patch per tile that actually changed. */
	commit(history: History, label: string): boolean {
		this.flush();
		const tx = new Transaction(this.doc);
		for (const [t, before] of this.backups) {
			const rect = this.tileRect(t);
			const after = readRect(this.cel, this.w, rect);
			if (pixelsEqual(before, after)) continue;
			tx.recordApplied(
				{ t: 'patch', layerId: this.layerId, frameId: this.frameId, rect, data: after },
				invertPatch(this.layerId, this.frameId, rect, before, after)
			);
		}
		return history.commit(label, tx);
	}
}

function union(a: Rect | null, b: Rect): Rect {
	if (!a) return b;
	const x = Math.min(a.x, b.x),
		y = Math.min(a.y, b.y);
	return {
		x,
		y,
		w: Math.max(a.x + a.w, b.x + b.w) - x,
		h: Math.max(a.y + a.h, b.y + b.h) - y
	};
}

/** Source-over of `color` at strength `m` onto the straight-alpha pixel (r,g,b,a), into dst[p]. */
function over(
	dst: Uint8ClampedArray,
	p: number,
	r: number,
	g: number,
	b: number,
	a: number,
	color: RGBA,
	m: number
) {
	const sa = (color[3] / 255) * m;
	const da = a / 255;
	const oa = sa + da * (1 - sa);
	if (oa <= 0) {
		dst[p] = r;
		dst[p + 1] = g;
		dst[p + 2] = b;
		dst[p + 3] = 0;
		return;
	}
	const k = da * (1 - sa);
	dst[p] = (color[0] * sa + r * k) / oa;
	dst[p + 1] = (color[1] * sa + g * k) / oa;
	dst[p + 2] = (color[2] * sa + b * k) / oa;
	dst[p + 3] = oa * 255;
}

/** Write a premultiplied (0..255) colour as straight alpha. */
function writePremult(dst: Uint8ClampedArray, p: number, r: number, g: number, b: number, a: number) {
	if (a < 0.5) {
		dst[p + 3] = 0;
		return;
	}
	const k = 255 / a;
	dst[p] = r * k;
	dst[p + 1] = g * k;
	dst[p + 2] = b * k;
	dst[p + 3] = a;
}

/** Coverage of a dab at pixel (x, y), sampled at the pixel centre with a 1px anti-aliased edge. */
function tipSampler(d: Dab, r: number, fade: number): (x: number, y: number) => number {
	const cos = Math.cos(d.angle),
		sin = Math.sin(d.angle);
	const squash = 1 / Math.max(0.05, Math.min(1, d.roundness));
	const inner = r * Math.min(0.999, Math.max(0, d.hardness));
	const alpha = d.alpha * fade;
	const grain = Math.min(1, Math.max(0, d.grain));
	const scale = Math.max(0.25, d.grainScale);
	return (x, y) => {
		const dx = x + 0.5 - d.x,
			dy = y + 0.5 - d.y;
		const u = dx * cos + dy * sin,
			v = (dy * cos - dx * sin) * squash;
		const dist = Math.sqrt(u * u + v * v);
		if (dist >= r + 0.5) return 0;
		const edge = Math.min(1, r + 0.5 - dist);
		let c = edge;
		if (dist > inner) {
			const t = Math.min(1, Math.max(0, (r - dist) / Math.max(1e-3, r - inner)));
			c = Math.min(edge, t * t * (3 - 2 * t));
		}
		if (grain > 0) c *= 1 - grain * (1 - paperGrain(x, y, scale));
		return c * alpha;
	};
}

// ── paper grain ──────────────────────────────────────────────────────────────────────────────────

const GRAIN = 256;
let grainTex: Float32Array | null = null;

/** Fixed to the canvas, not the brush, so grain reads as paper texture showing through. */
export function paperGrain(x: number, y: number, scale: number): number {
	if (!grainTex) grainTex = makeGrain();
	const gx = Math.floor(x / scale) & (GRAIN - 1),
		gy = Math.floor(y / scale) & (GRAIN - 1);
	return grainTex[gy * GRAIN + gx];
}

function makeGrain(): Float32Array {
	const rand = mulberry32(0x6d6f78);
	let a = new Float32Array(GRAIN * GRAIN).map(() => rand());
	// Two wrap-around box blurs give a fibrous grain rather than TV static.
	for (let pass = 0; pass < 2; pass++) {
		const b = new Float32Array(a.length);
		for (let y = 0; y < GRAIN; y++)
			for (let x = 0; x < GRAIN; x++) {
				let s = 0;
				for (let j = -1; j <= 1; j++)
					for (let i = -1; i <= 1; i++) s += a[((y + j) & (GRAIN - 1)) * GRAIN + ((x + i) & (GRAIN - 1))];
				b[y * GRAIN + x] = s / 9;
			}
		a = b;
	}
	let lo = Infinity,
		hi = -Infinity;
	for (const v of a) {
		lo = Math.min(lo, v);
		hi = Math.max(hi, v);
	}
	return a.map((v) => (v - lo) / (hi - lo || 1));
}

export function mulberry32(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// ── input → dabs ─────────────────────────────────────────────────────────────────────────────────

export interface InputPoint {
	x: number;
	y: number;
	/** 0..1, meaningful only when `pen`. */
	pressure: number;
	pen: boolean;
}

export function applyCurve(p: number, curve: PressureCurve): number {
	const v = Math.min(1, Math.max(0, p));
	return curve === 'soft' ? Math.pow(v, 0.6) : curve === 'firm' ? Math.pow(v, 1.7) : v;
}

/**
 * Turns pointer samples into evenly spaced dabs: stabilizer, per-dab pressure interpolation,
 * pressure curves, mouse taper, jitter and scatter. Pure, so it is tested without a canvas.
 */
export class StrokePath {
	private prev: InputPoint | null = null;
	private smooth: InputPoint | null = null;
	private raw: InputPoint | null = null;
	private since = 0;
	private travelled = 0;
	private readonly rand: () => number;

	constructor(
		readonly b: PaintBrushSettings,
		readonly emit: (d: Dab) => void,
		seed = 1
	) {
		this.rand = mulberry32(seed);
	}

	begin(p: InputPoint) {
		this.prev = this.smooth = this.raw = { ...p };
		this.since = 0;
		this.travelled = 0;
		this.dab(p);
	}

	move(p: InputPoint) {
		if (!this.prev || !this.smooth) return;
		this.raw = { ...p };
		// The stabilizer trails the pointer: 0 follows it exactly, 1 drags far behind.
		const k = 1 - Math.min(0.95, Math.max(0, this.b.stabilizer) * 0.95);
		const s = this.smooth;
		this.smooth = {
			x: s.x + (p.x - s.x) * k,
			y: s.y + (p.y - s.y) * k,
			pressure: s.pressure + (p.pressure - s.pressure) * k,
			pen: p.pen
		};
		this.segment(this.prev, this.smooth);
		this.prev = this.smooth;
	}

	/** Catch up with the real last point, so a stabilized line still ends where the pen lifted. */
	end() {
		if (this.prev && this.raw) this.segment(this.prev, this.raw);
		this.prev = this.smooth = this.raw = null;
	}

	private pressureAt(p: InputPoint): number {
		if (p.pen) return Math.max(0.02, applyCurve(p.pressure, this.b.pressureCurve));
		// Mouse taper: ramp up over the first few brush widths.
		if (this.b.taper) return Math.min(1, 0.15 + this.travelled / Math.max(4, this.b.size * 3));
		return 1;
	}

	private sizeAt(p: InputPoint) {
		const usePressure = this.b.pressureSize && (p.pen || this.b.taper);
		return Math.max(0.3, this.b.size * (usePressure ? this.pressureAt(p) : 1));
	}

	private segment(a: InputPoint, b: InputPoint) {
		const dx = b.x - a.x,
			dy = b.y - a.y;
		const dist = Math.hypot(dx, dy);
		if (dist < 1e-6) return;
		let pos = 0;
		for (;;) {
			const t = pos / dist;
			const here = {
				x: a.x + dx * t,
				y: a.y + dy * t,
				pressure: a.pressure + (b.pressure - a.pressure) * t,
				pen: b.pen
			};
			const step = Math.max(0.25, this.b.spacing * this.sizeAt(here));
			const need = step - this.since;
			if (pos + need > dist) {
				this.since += dist - pos;
				this.travelled += dist - pos;
				return;
			}
			pos += need;
			this.travelled += need;
			this.since = 0;
			const u = pos / dist;
			this.dab({
				x: a.x + dx * u,
				y: a.y + dy * u,
				pressure: a.pressure + (b.pressure - a.pressure) * u,
				pen: b.pen
			});
		}
	}

	private dab(p: InputPoint) {
		const b = this.b;
		const pr = this.pressureAt(p);
		const usePressure = p.pen || b.taper;
		let size = this.sizeAt(p);
		if (b.sizeJitter > 0) size *= 1 - b.sizeJitter * this.rand();
		let alpha = b.pressureOpacity && usePressure ? pr : 1;
		if (b.opacityJitter > 0) alpha *= 1 - b.opacityJitter * this.rand();
		const flow = b.flow * (b.pressureFlow && usePressure ? pr : 1);
		let { x, y } = p;
		if (b.scatter > 0) {
			const ang = this.rand() * Math.PI * 2,
				rr = Math.sqrt(this.rand()) * b.scatter * size;
			x += Math.cos(ang) * rr;
			y += Math.sin(ang) * rr;
		}
		this.emit({
			x,
			y,
			size,
			alpha: alpha * flow,
			hardness: b.hardness,
			angle: (b.angle * Math.PI) / 180,
			roundness: b.roundness,
			grain: b.grain,
			grainScale: b.grainScale
		});
	}
}

/** Symmetry for paint documents works on continuous coordinates: the dab is mirrored, not texels. */
export function mirrorPoints(mode: SymmetryMode, w: number, h: number): MirrorFn | null {
	switch (mode) {
		case 'horizontal':
		case 'character':
			return (x, y) => [[w - x, y]];
		case 'vertical':
			return (x, y) => [[x, h - y]];
		case 'both':
			return (x, y) => [
				[w - x, y],
				[x, h - y],
				[w - x, h - y]
			];
		default:
			return null;
	}
}
