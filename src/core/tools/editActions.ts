import { flipPixels, rotatePixels, scaleNearest } from '../document/commands';
import { invertPatch } from '../document/ops';
import { pixelsEqual, readRect, unionRect } from '../document/pixels';
import type { Rect } from '../document/types';
import { Transaction } from '../history/history';
import { compositeRect } from '../render/composite';
import type { CustomTip, ToolContext } from './types';
import { canEdit } from './paintTools';

/** Pixels captured by Copy/Cut, positioned where they came from. */
export interface ClipboardImage {
	x: number;
	y: number;
	w: number;
	h: number;
	data: Uint8ClampedArray;
}

function selectionRect(ctx: ToolContext): Rect {
	return ctx.selection.bounds ?? { x: 0, y: 0, w: ctx.doc.width, h: ctx.doc.height };
}

/** Extract the selected pixels of the active layer (or of the merged image). */
export function copySelection(ctx: ToolContext, merged = false): ClipboardImage | null {
	const r = selectionRect(ctx);
	const src = merged
		? compositeRect(ctx.doc, ctx.frameId, r)
		: readRect(
				ctx.doc.getCel(ctx.layerId, ctx.frameId) ?? new Uint8ClampedArray(ctx.doc.width * ctx.doc.height * 4),
				ctx.doc.width,
				r
			);
	if (ctx.selection.active) {
		for (let y = 0; y < r.h; y++)
			for (let x = 0; x < r.w; x++) {
				const cov = ctx.selection.coverage(r.x + x, r.y + y) / 255;
				src[(y * r.w + x) * 4 + 3] *= cov;
			}
	}
	return { ...r, data: src };
}

/** Clear selected pixels on the active layer. */
export function deleteSelection(ctx: ToolContext, label = 'Delete'): boolean {
	if (!canEdit(ctx)) return false;
	const { doc } = ctx;
	const r = selectionRect(ctx);
	const cel = doc.ensureCel(ctx.layerId, ctx.frameId);
	const before = readRect(cel, doc.width, r);
	const after = new Uint8ClampedArray(before);
	for (let y = 0; y < r.h; y++)
		for (let x = 0; x < r.w; x++) {
			const cov = ctx.selection.coverage(r.x + x, r.y + y) / 255;
			after[(y * r.w + x) * 4 + 3] *= 1 - cov;
		}
	if (pixelsEqual(before, after)) return false;
	return ctx.history.transact(label, (tx) =>
		tx.apply({ t: 'patch', layerId: ctx.layerId, frameId: ctx.frameId, rect: r, data: after })
	);
}

export function cutSelection(ctx: ToolContext): ClipboardImage | null {
	if (!canEdit(ctx)) return null;
	const clip = copySelection(ctx);
	deleteSelection(ctx, 'Cut');
	return clip;
}

/** Paste as a new layer above the active one and select the pasted pixels. Returns the new layer id. */
export function pasteImage(
	ctx: ToolContext,
	clip: ClipboardImage,
	atView?: { x: number; y: number }
): string {
	const { doc } = ctx;
	let x = clip.x,
		y = clip.y;
	if (atView) {
		x = Math.round(atView.x - clip.w / 2);
		y = Math.round(atView.y - clip.h / 2);
	}
	// Keep at least part of the paste on the canvas.
	x = Math.max(Math.min(x, doc.width - 1), 1 - clip.w);
	y = Math.max(Math.min(y, doc.height - 1), 1 - clip.h);
	const full = new Uint8ClampedArray(doc.width * doc.height * 4);
	const mask = new Uint8Array(doc.width * doc.height);
	for (let j = 0; j < clip.h; j++) {
		const ty = y + j;
		if (ty < 0 || ty >= doc.height) continue;
		for (let i = 0; i < clip.w; i++) {
			const tx = x + i;
			if (tx < 0 || tx >= doc.width) continue;
			const s = (j * clip.w + i) * 4,
				d = (ty * doc.width + tx) * 4;
			full.set(clip.data.subarray(s, s + 4), d);
			if (clip.data[s + 3]) mask[ty * doc.width + tx] = 255;
		}
	}
	const id = ctx.cmd.addLayerWithPixels('Pasted', ctx.frameId, full, ctx.layerId);
	ctx.selection.setMask(mask);
	return id;
}

type Transform = 'flipH' | 'flipV' | 'rotateCW' | 'rotateCCW' | 'rotate180' | { scale: [number, number] };

/**
 * Transform the selected pixels in place (or the whole layer without a selection), keeping the
 * result centred on the original bounds. The selection follows the pixels.
 */
export function transformSelection(ctx: ToolContext, t: Transform): boolean {
	if (!canEdit(ctx)) return false;
	const { doc, selection } = ctx;
	const W = doc.width,
		H = doc.height;
	const b = selectionRect(ctx);
	const cel = doc.ensureCel(ctx.layerId, ctx.frameId);
	const lifted = readRect(cel, W, b);
	const selMask = new Uint8Array(b.w * b.h);
	for (let y = 0; y < b.h; y++)
		for (let x = 0; x < b.w; x++) {
			const cov = selection.coverage(b.x + x, b.y + y);
			selMask[y * b.w + x] = cov;
			lifted[(y * b.w + x) * 4 + 3] *= cov / 255;
		}
	// Represent the mask as RGBA so it goes through the same pixel transforms.
	const maskRGBA = new Uint8ClampedArray(b.w * b.h * 4);
	for (let i = 0; i < selMask.length; i++) maskRGBA[i * 4 + 3] = selMask[i];

	let out: Uint8ClampedArray, outMask: Uint8ClampedArray, nw: number, nh: number;
	if (t === 'flipH' || t === 'flipV') {
		const axis = t === 'flipH' ? 'h' : 'v';
		out = flipPixels(lifted, b.w, b.h, axis);
		outMask = flipPixels(maskRGBA, b.w, b.h, axis);
		nw = b.w;
		nh = b.h;
	} else if (t === 'rotateCW' || t === 'rotateCCW' || t === 'rotate180') {
		const q = t === 'rotateCW' ? 1 : t === 'rotate180' ? 2 : 3;
		out = rotatePixels(lifted, b.w, b.h, q);
		outMask = rotatePixels(maskRGBA, b.w, b.h, q);
		nw = q === 2 ? b.w : b.h;
		nh = q === 2 ? b.h : b.w;
	} else {
		nw = Math.max(1, Math.round(t.scale[0]));
		nh = Math.max(1, Math.round(t.scale[1]));
		out = scaleNearest(lifted, b.w, b.h, nw, nh);
		outMask = scaleNearest(maskRGBA, b.w, b.h, nw, nh);
	}
	const nx = Math.round(b.x + (b.w - nw) / 2),
		ny = Math.round(b.y + (b.h - nh) / 2);

	const affected = unionRect(b, { x: nx, y: ny, w: nw, h: nh })!;
	const rect = {
		x: Math.max(0, affected.x),
		y: Math.max(0, affected.y),
		w: Math.min(W, affected.x + affected.w) - Math.max(0, affected.x),
		h: Math.min(H, affected.y + affected.h) - Math.max(0, affected.y)
	};
	const before = readRect(cel, W, rect);
	const work = new Uint8ClampedArray(cel);
	// Lift the original pixels out…
	for (let y = 0; y < b.h; y++)
		for (let x = 0; x < b.w; x++) work[((b.y + y) * W + b.x + x) * 4 + 3] *= 1 - selMask[y * b.w + x] / 255;
	// …and composite the transformed ones back in.
	const newMask = new Uint8Array(W * H);
	for (let y = 0; y < nh; y++) {
		const ty = ny + y;
		if (ty < 0 || ty >= H) continue;
		for (let x = 0; x < nw; x++) {
			const tx = nx + x;
			if (tx < 0 || tx >= W) continue;
			const s = (y * nw + x) * 4,
				d = (ty * W + tx) * 4;
			newMask[ty * W + tx] = outMask[s + 3];
			const sa = out[s + 3] / 255;
			if (sa <= 0) continue;
			const da = work[d + 3] / 255;
			const oa = sa + da * (1 - sa),
				k = da * (1 - sa);
			work[d] = (out[s] * sa + work[d] * k) / oa;
			work[d + 1] = (out[s + 1] * sa + work[d + 1] * k) / oa;
			work[d + 2] = (out[s + 2] * sa + work[d + 2] * k) / oa;
			work[d + 3] = oa * 255;
		}
	}
	const after = readRect(work, W, rect);
	if (pixelsEqual(before, after)) return false;
	cel.set(work);
	const tx = new Transaction(doc);
	tx.recordApplied(
		{ t: 'patch', layerId: ctx.layerId, frameId: ctx.frameId, rect, data: after },
		invertPatch(ctx.layerId, ctx.frameId, rect, before, after)
	);
	const label =
		typeof t === 'string'
			? t.startsWith('flip')
				? 'Flip selection'
				: 'Rotate selection'
			: 'Scale selection';
	ctx.history.commit(label, tx);
	doc.emit({ type: 'pixels', layerId: ctx.layerId, frameId: ctx.frameId, rect });
	if (selection.active) selection.setMask(newMask);
	return true;
}

/** Turn the selected pixels' alpha into a custom brush tip. */
export function tipFromSelection(ctx: ToolContext): CustomTip | null {
	const clip = copySelection(ctx, true);
	if (!clip || clip.w * clip.h === 0) return null;
	if (clip.w > 64 || clip.h > 64) {
		ctx.notify('Custom brushes can be at most 64×64 pixels. Make a smaller selection.');
		return null;
	}
	const mask: number[] = [];
	let any = false;
	for (let i = 0; i < clip.w * clip.h; i++) {
		const a = clip.data[i * 4 + 3];
		mask.push(a);
		if (a) any = true;
	}
	if (!any) {
		ctx.notify('The selection is empty. Select some painted pixels first.');
		return null;
	}
	return { w: clip.w, h: clip.h, mask };
}
