import type { MoxelDocument } from '../document/document';
import type { BlendMode, Rect } from '../document/types';

export interface CompositeOptions {
	/** Treat these nodes as hidden regardless of their own visibility (e.g. the 3D "hide overlay" toggle doesn't use this, but export of a single layer does). */
	include?: (nodeId: string) => boolean;
	/** Ignore node visibility flags (used when merging an explicitly chosen layer). */
	ignoreVisibility?: boolean;
}

/**
 * Composite one frame of the document into a rect-sized RGBA buffer (straight alpha).
 * Groups are composited in isolation and then blended as a unit, which is what makes group
 * opacity and blend modes behave the way artists expect.
 */
export function compositeRect(
	doc: MoxelDocument,
	frameId: string,
	rect: Rect,
	opts: CompositeOptions = {}
): Uint8ClampedArray {
	const out = new Uint8ClampedArray(rect.w * rect.h * 4);
	compositeChildren(doc, doc.root, frameId, rect, out, opts);
	return out;
}

export function compositeFrame(doc: MoxelDocument, frameId: string, opts: CompositeOptions = {}) {
	return compositeRect(doc, frameId, { x: 0, y: 0, w: doc.width, h: doc.height }, opts);
}

function compositeChildren(
	doc: MoxelDocument,
	ids: string[],
	frameId: string,
	rect: Rect,
	out: Uint8ClampedArray,
	opts: CompositeOptions
) {
	for (const id of ids) {
		const n = doc.nodes.get(id);
		if (!n) continue;
		if (!opts.ignoreVisibility && !n.visible) continue;
		if (opts.include && n.type === 'layer' && !opts.include(id)) continue;
		if (n.opacity <= 0) continue;
		if (n.type === 'layer') {
			const cel = doc.getCel(id, frameId);
			if (!cel) continue;
			blendInto(out, rect, cel, doc.width, rect.x, rect.y, n.opacity, n.blend);
		} else {
			const tmp = new Uint8ClampedArray(rect.w * rect.h * 4);
			compositeChildren(doc, n.children, frameId, rect, tmp, opts);
			blendInto(out, rect, tmp, rect.w, 0, 0, n.opacity, n.blend);
		}
	}
}

/**
 * Blend `src` (a buffer `srcWidth` wide, read starting at srcX/srcY) over the rect-sized `dst`.
 * Implements W3C compositing: Cs' = (1 - αb)·Cs + αb·B(Cb, Cs), then source-over.
 */
export function blendInto(
	dst: Uint8ClampedArray,
	rect: { w: number; h: number },
	src: Uint8ClampedArray,
	srcWidth: number,
	srcX: number,
	srcY: number,
	opacity: number,
	mode: BlendMode
) {
	const fn = mode === 'normal' ? null : BLEND_FNS[mode];
	for (let y = 0; y < rect.h; y++) {
		let s = ((srcY + y) * srcWidth + srcX) * 4;
		let d = y * rect.w * 4;
		for (let x = 0; x < rect.w; x++, s += 4, d += 4) {
			const sa = (src[s + 3] / 255) * opacity;
			if (sa <= 0) continue;
			const da = dst[d + 3] / 255;
			let sr = src[s],
				sg = src[s + 1],
				sb = src[s + 2];
			if (fn && da > 0) {
				sr = (1 - da) * sr + da * fn(dst[d], sr);
				sg = (1 - da) * sg + da * fn(dst[d + 1], sg);
				sb = (1 - da) * sb + da * fn(dst[d + 2], sb);
			}
			const oa = sa + da * (1 - sa);
			const k = da * (1 - sa);
			dst[d] = (sr * sa + dst[d] * k) / oa;
			dst[d + 1] = (sg * sa + dst[d + 1] * k) / oa;
			dst[d + 2] = (sb * sa + dst[d + 2] * k) / oa;
			dst[d + 3] = oa * 255;
		}
	}
}

type BlendFn = (b: number, s: number) => number;
const BLEND_FNS: Record<Exclude<BlendMode, 'normal'>, BlendFn> = {
	multiply: (b, s) => (b * s) / 255,
	screen: (b, s) => b + s - (b * s) / 255,
	overlay: (b, s) => (b < 128 ? (2 * b * s) / 255 : 255 - (2 * (255 - b) * (255 - s)) / 255),
	darken: (b, s) => Math.min(b, s),
	lighten: (b, s) => Math.max(b, s),
	add: (b, s) => Math.min(255, b + s)
};
