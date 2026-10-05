import type { MoxelDocument } from '../core/document/document';
import { compositeFrame } from '../core/render/composite';
import { SKIN_SIZE, faceRect, skinParts } from '../minecraft/uv';

/**
 * Small preview image for the project list. Skins get a "bust" (head front + hat over it, body
 * front) because the raw UV sheet makes a poor thumbnail; everything else is the first frame scaled to fit.
 */
export function renderThumbnail(doc: MoxelDocument, size = 160): string | undefined {
	if (typeof document === 'undefined') return undefined;
	try {
		const data = compositeFrame(doc, doc.frames[0].id);
		const src = document.createElement('canvas');
		src.width = doc.width;
		src.height = doc.height;
		src
			.getContext('2d')!
			.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, doc.width, doc.height), 0, 0);

		const out = document.createElement('canvas');
		out.width = out.height = size;
		const g = out.getContext('2d')!;
		g.imageSmoothingEnabled = false;

		if (doc.meta.kind === 'skin' && doc.width === SKIN_SIZE && doc.height === SKIN_SIZE) {
			const model = doc.meta.skin?.model ?? 'classic';
			const parts = new Map(skinParts(model).map((p) => [p.id, p]));
			const u = size / 20; // 8px head + 12px body = 20 texels tall
			const draw = (id: string, dx: number, dy: number, inflate = 0) => {
				const r = faceRect(parts.get(id as never)!, 'front');
				g.drawImage(
					src,
					r.x,
					r.y,
					r.w,
					r.h,
					dx - inflate,
					dy - inflate,
					r.w * u + inflate * 2,
					r.h * u + inflate * 2
				);
			};
			const cx = size / 2;
			const aw = model === 'slim' ? 3 : 4;
			draw('rightArm', cx - 4 * u - aw * u, 8 * u);
			draw('leftArm', cx + 4 * u, 8 * u);
			draw('body', cx - 4 * u, 8 * u);
			draw('rightSleeve', cx - 4 * u - aw * u, 8 * u);
			draw('leftSleeve', cx + 4 * u, 8 * u);
			draw('jacket', cx - 4 * u, 8 * u);
			draw('head', cx - 4 * u, 0);
			draw('hat', cx - 4 * u, 0, u * 0.5);
		} else {
			const k = Math.min(size / doc.width, size / doc.height);
			const s = k >= 1 ? Math.floor(k) : k;
			g.drawImage(
				src,
				(size - doc.width * s) / 2,
				(size - doc.height * s) / 2,
				doc.width * s,
				doc.height * s
			);
		}
		return out.toDataURL('image/png');
	} catch {
		return undefined;
	}
}
