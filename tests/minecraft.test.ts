import { describe, expect, it } from 'vitest';
import { allFaces, faceRect, hitTest, mirrorMap, skinParts, SKIN_SIZE, upgradeLegacySkin } from '../src/minecraft/uv';
import { skinSizeKind, validateSkin, validateTexture } from '../src/minecraft/validate';
import { starterSkin } from '../src/minecraft/templates';

describe('skin UV layout', () => {
	it('classic arms are 4px wide, slim arms 3px', () => {
		const classic = skinParts('classic').find((p) => p.id === 'rightArm')!;
		const slim = skinParts('slim').find((p) => p.id === 'rightArm')!;
		expect(classic.w).toBe(4);
		expect(slim.w).toBe(3);
		expect(faceRect(classic, 'front')).toMatchObject({ x: 44, y: 20, w: 4, h: 12 });
		expect(faceRect(slim, 'back')).toMatchObject({ x: 51, y: 20, w: 3, h: 12 });
	});

	it('has no overlapping face rects and stays inside 64×64', () => {
		for (const model of ['classic', 'slim'] as const) {
			const seen = new Uint8Array(SKIN_SIZE * SKIN_SIZE);
			for (const f of allFaces(model)) {
				expect(f.x + f.w).toBeLessThanOrEqual(64);
				expect(f.y + f.h).toBeLessThanOrEqual(64);
				for (let y = f.y; y < f.y + f.h; y++)
					for (let x = f.x; x < f.x + f.w; x++) {
						expect(seen[y * 64 + x]).toBe(0);
						seen[y * 64 + x] = 1;
					}
			}
		}
	});

	it('identifies the part and face under a texel', () => {
		expect(hitTest('classic', 10, 10)).toMatchObject({ part: { id: 'head' }, face: { face: 'front' } });
		expect(hitTest('classic', 42, 10)).toMatchObject({ part: { id: 'hat' }, face: { face: 'front' } });
		expect(hitTest('classic', 0, 0)).toBeNull();
		// Column 47 at y=20 is the classic right arm's front, but the slim arm's left side.
		expect(hitTest('classic', 47, 20)?.face.face).toBe('front');
		expect(hitTest('slim', 47, 20)?.face.face).toBe('left');
		// x=54 is the classic arm's back but unused on slim.
		expect(hitTest('classic', 54, 20)?.face.face).toBe('back');
		expect(hitTest('slim', 54, 20)).toBeNull();
	});

	it('left/right mirror map is an involution and maps arms to arms', () => {
		for (const model of ['classic', 'slim'] as const) {
			const m = mirrorMap(model);
			for (let i = 0; i < m.length; i++) if (m[i] >= 0) expect(m[m[i]]).toBe(i);
			// Head front pixel (8,8) mirrors to (15,8).
			expect(m[8 * 64 + 8]).toBe(8 * 64 + 15);
			// Right arm front top-left ↔ left arm front top-right.
			const ra = faceRect(skinParts(model).find((p) => p.id === 'rightArm')!, 'front');
			const la = faceRect(skinParts(model).find((p) => p.id === 'leftArm')!, 'front');
			expect(m[ra.y * 64 + ra.x]).toBe(la.y * 64 + la.x + la.w - 1);
		}
	});

	it('upgrades legacy 64×32 skins by mirroring the right limbs', () => {
		const legacy = new Uint8ClampedArray(64 * 32 * 4);
		// Paint the right leg's front top-left texel (4,20).
		legacy.set([255, 0, 0, 255], (20 * 64 + 4) * 4);
		const up = upgradeLegacySkin(legacy);
		expect(up.length).toBe(64 * 64 * 4);
		expect(up[(20 * 64 + 4) * 4]).toBe(255);
		// Left leg front is at (20,52); mirrored → top-right (23,52).
		expect(up[(52 * 64 + 23) * 4]).toBe(255);
	});
});

describe('skin validation', () => {
	it('accepts the starter skin with no errors', () => {
		for (const model of ['classic', 'slim'] as const) {
			const issues = validateSkin(starterSkin(model), 64, 64, model);
			expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
			expect(issues.find((i) => i.code === 'base-transparency')).toBeUndefined();
		}
	});

	it('rejects wrong dimensions, empty skins and invalid models', () => {
		expect(validateSkin(new Uint8ClampedArray(32 * 32 * 4), 32, 32, 'classic')[0].code).toBe('size');
		expect(validateSkin(new Uint8ClampedArray(64 * 64 * 4), 64, 64, 'classic')[0].code).toBe('empty');
		expect(validateSkin(starterSkin('classic'), 64, 64, undefined)[0].code).toBe('model');
		expect(skinSizeKind(64, 32)).toBe('legacy');
		expect(skinSizeKind(64, 64)).toBe('modern');
		expect(skinSizeKind(128, 128)).toBeNull();
	});

	it('warns about holes in the base layer and classic paint on a slim skin', () => {
		const px = starterSkin('classic');
		px[(10 * 64 + 10) * 4 + 3] = 0;
		expect(validateSkin(px, 64, 64, 'classic').some((i) => i.code === 'base-transparency')).toBe(true);
		expect(validateSkin(starterSkin('classic'), 64, 64, 'slim').some((i) => i.code === 'model-mismatch')).toBe(true);
	});

	it('validates texture dimensions', () => {
		expect(validateTexture({ width: 16, height: 16, frameCount: 1, textureType: 'block' })).toEqual([]);
		expect(validateTexture({ width: 20, height: 16, frameCount: 1, textureType: 'block' }).map((i) => i.code)).toEqual([
			'square',
			'pow2'
		]);
	});
});
