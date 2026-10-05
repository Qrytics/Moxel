import { MoxelDocument } from '../document/document';
import { PaintStroke, StrokePath } from './paintEngine';
import type { PaintBrushSettings, PaintToolId, RGBA } from './types';

/**
 * Render a sample stroke with the real paint engine, for the preset picker. Brushes paint an S
 * curve with a pressure swell; erase, smudge and blur work over colour stripes so their effect is
 * visible. Returns straight RGBA, w×h.
 */
export function renderBrushPreview(
	tool: PaintToolId,
	settings: PaintBrushSettings,
	w: number,
	h: number,
	color: RGBA = [235, 236, 240, 255]
): Uint8ClampedArray {
	const doc = MoxelDocument.create({ name: 'preview', kind: 'paint', width: w, height: h });
	const cel = doc.ensureCel(doc.root[0], doc.frames[0].id);
	if (tool !== 'brush') {
		const stripes: RGBA[] = [
			[255, 143, 107, 255],
			[126, 224, 161, 255],
			[107, 211, 255, 255],
			[180, 148, 255, 255]
		];
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const c = stripes[Math.floor((x / w) * stripes.length)];
				cel.set(c, (y * w + x) * 4);
			}
	}
	// Scale big brushes down so every preview reads at the same height.
	const size = Math.max(1.5, Math.min(settings.size, h * 0.55));
	const b = { ...settings, size, stabilizer: 0 };
	const mode = tool === 'brush' ? 'paint' : tool === 'eraser' ? 'erase' : tool;
	const s = new PaintStroke(
		doc,
		doc.root[0],
		doc.frames[0].id,
		mode,
		color,
		b.opacity,
		null,
		null,
		b.strength
	);
	s.fingerSize = size;
	const path = new StrokePath(b, (d) => s.stamp(d), 7);
	const n = 48;
	const pt = (i: number) => {
		const t = i / n;
		return {
			x: w * (0.08 + 0.84 * t),
			y: h / 2 + Math.sin(t * Math.PI * 2) * h * 0.2,
			pressure: Math.sin(t * Math.PI) * 0.9 + 0.1,
			pen: true
		};
	};
	path.begin(pt(0));
	for (let i = 1; i <= n; i++) path.move(pt(i));
	path.end();
	return cel;
}
