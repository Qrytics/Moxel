import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { MoxelDocument } from '../src/core/document/document';
import { DocCommands } from '../src/core/document/commands';
import { History } from '../src/core/history/history';
import { exportGIF, minecraftAnimation, spriteSheet } from '../src/io/export';
import { decodePNG } from '../src/io/png';

function anim(frames = 3, w = 16, h = 16) {
	const doc = MoxelDocument.create({
		name: 'Water',
		kind: 'texture',
		width: w,
		height: h,
		textureType: 'block',
		frames,
		fps: 4
	});
	doc.frames.forEach((f, i) => doc.ensureCel(doc.root[0], f.id).set([i * 80, 0, 255 - i * 80, 255], 0));
	return doc;
}

describe('animation export', () => {
	it('builds horizontal, vertical and grid sprite sheets', () => {
		const doc = anim(3);
		expect(spriteSheet(doc, 'horizontal')).toMatchObject({ width: 48, height: 16 });
		expect(spriteSheet(doc, 'vertical')).toMatchObject({ width: 16, height: 48 });
		expect(spriteSheet(doc, 'grid')).toMatchObject({ cols: 2, rows: 2 });
		const img = decodePNG(spriteSheet(doc, 'vertical').png);
		expect(img.data[16 * 16 * 4]).toBe(80); // frame 2's first pixel
	});

	it('writes a Minecraft animated texture strip with .mcmeta in ticks', () => {
		const doc = anim(3);
		const { mcmeta, zip } = minecraftAnimation(doc, 'water');
		expect(JSON.parse(mcmeta)).toEqual({ animation: { frametime: 5 } }); // 250 ms = 5 ticks
		const files = unzipSync(zip);
		expect(Object.keys(files).sort()).toEqual(['water.png', 'water.png.mcmeta']);
		expect(JSON.parse(strFromU8(files['water.png.mcmeta'])).animation.frametime).toBe(5);
	});

	it('emits per-frame timing when durations differ', () => {
		const doc = anim(2);
		new DocCommands(doc, new History(doc)).setFrameDuration(doc.frames[1].id, 500);
		expect(JSON.parse(minecraftAnimation(doc, 'x').mcmeta).animation.frames).toEqual([
			{ index: 0, time: 5 },
			{ index: 1, time: 10 }
		]);
	});

	it('encodes an animated GIF', () => {
		const gif = exportGIF(anim(3), 2);
		expect(String.fromCharCode(...gif.subarray(0, 6))).toBe('GIF89a');
		expect(gif[6] | (gif[7] << 8)).toBe(32);
	});

	it('sets every frame duration from FPS', () => {
		const doc = anim(3);
		new DocCommands(doc, new History(doc)).setFps(10);
		expect(doc.frames.every((f) => f.duration === 100)).toBe(true);
		expect(doc.meta.animation.fps).toBe(10);
	});
});
