import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import { strToU8, zipSync } from 'fflate';
import type { MoxelDocument } from '../core/document/document';
import { scaleNearest } from '../core/document/commands';
import { compositeFrame } from '../core/render/composite';
import { encodePNG } from './png';

/**
 * Exporters: everything that turns the layered document into a flat file. Pure functions over the
 * document so they run in tests and can be moved into a worker wholesale.
 */

export function flattenFrame(doc: MoxelDocument, frameId: string, scale = 1): { w: number; h: number; data: Uint8ClampedArray } {
	const data = compositeFrame(doc, frameId);
	if (scale === 1) return { w: doc.width, h: doc.height, data };
	const w = doc.width * scale,
		h = doc.height * scale;
	return { w, h, data: scaleNearest(data, doc.width, doc.height, w, h) };
}

export function exportFlattenedPNG(doc: MoxelDocument, frameId: string, scale = 1): Uint8Array {
	const { w, h, data } = flattenFrame(doc, frameId, scale);
	return encodePNG(data, w, h);
}

export type SheetLayout = 'horizontal' | 'vertical' | 'grid';

export function spriteSheet(doc: MoxelDocument, layout: SheetLayout, scale = 1) {
	const n = doc.frames.length;
	const cols = layout === 'horizontal' ? n : layout === 'vertical' ? 1 : Math.ceil(Math.sqrt(n));
	const rows = Math.ceil(n / cols);
	const fw = doc.width * scale,
		fh = doc.height * scale;
	const W = fw * cols,
		H = fh * rows;
	const out = new Uint8ClampedArray(W * H * 4);
	doc.frames.forEach((f, i) => {
		const { data } = flattenFrame(doc, f.id, scale);
		const ox = (i % cols) * fw,
			oy = Math.floor(i / cols) * fh;
		for (let y = 0; y < fh; y++) out.set(data.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * W + ox) * 4);
	});
	return { width: W, height: H, png: encodePNG(out, W, H), cols, rows };
}

/**
 * Minecraft animated texture: frames stacked vertically in one PNG, plus a `.png.mcmeta` sidecar.
 * Minecraft counts time in game ticks (50 ms), so per-frame durations are rounded to ticks; if all
 * frames share a duration we emit the compact `frametime` form.
 */
export function minecraftAnimation(doc: MoxelDocument, baseName: string) {
	const sheet = spriteSheet(doc, 'vertical');
	const ticks = doc.frames.map((f) => Math.max(1, Math.round(f.duration / 50)));
	const uniform = ticks.every((t) => t === ticks[0]);
	const animation: Record<string, unknown> = uniform
		? { frametime: ticks[0] }
		: { frametime: ticks[0], frames: ticks.map((time, index) => ({ index, time })) };
	if (doc.width !== doc.height) animation.width = doc.width;
	if (doc.width !== doc.height) animation.height = doc.height;
	const mcmeta = JSON.stringify({ animation }, null, 2);
	const zip = zipSync({
		[`${baseName}.png`]: sheet.png,
		[`${baseName}.png.mcmeta`]: strToU8(mcmeta)
	});
	return { png: sheet.png, mcmeta, zip };
}

export function exportGIF(doc: MoxelDocument, scale = 1): Uint8Array {
	const frames = doc.frames.map((f) => ({ duration: f.duration, ...flattenFrame(doc, f.id, scale) }));
	const w = frames[0].w,
		h = frames[0].h;

	// Pixel art usually has few colours: build an exact palette when we can, quantize otherwise.
	const colors = new Map<number, number>();
	let exact = true;
	for (const fr of frames) {
		const d = fr.data;
		for (let i = 0; i < d.length && exact; i += 4) {
			if (d[i + 3] < 128) continue;
			const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
			if (!colors.has(key)) {
				if (colors.size >= 255) exact = false;
				else colors.set(key, colors.size + 1);
			}
		}
	}

	let palette: number[][];
	let index: (data: Uint8ClampedArray) => Uint8Array;
	if (exact) {
		palette = [[0, 0, 0], ...[...colors.keys()].map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255])];
		index = (d) => {
			const out = new Uint8Array(d.length / 4);
			for (let i = 0, p = 0; i < d.length; i += 4, p++)
				out[p] = d[i + 3] < 128 ? 0 : colors.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])!;
			return out;
		};
	} else {
		const all = new Uint8ClampedArray(frames.reduce((s, f) => s + f.data.length, 0));
		let o = 0;
		for (const f of frames) {
			all.set(f.data, o);
			o += f.data.length;
		}
		const q = quantize(all, 255, { format: 'rgba4444', oneBitAlpha: true });
		palette = [[0, 0, 0], ...q.map((c: number[]) => c.slice(0, 3))];
		index = (d) => {
			const idx = applyPalette(d, q, 'rgba4444');
			const out = new Uint8Array(idx.length);
			for (let p = 0; p < idx.length; p++) out[p] = d[p * 4 + 3] < 128 ? 0 : idx[p] + 1;
			return out;
		};
	}
	const gif = GIFEncoder();
	frames.forEach((f, i) => {
		gif.writeFrame(index(f.data), w, h, {
			palette: i === 0 ? palette : undefined,
			delay: f.duration,
			transparent: true,
			transparentIndex: 0,
			repeat: doc.meta.animation.loop ? 0 : -1,
			dispose: 2
		});
	});
	gif.finish();
	return gif.bytes();
}

export function downloadBytes(bytes: Uint8Array, filename: string, type: string) {
	const blob = new Blob([bytes as BlobPart], { type });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
