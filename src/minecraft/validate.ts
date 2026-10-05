import type { SkinModel } from '../core/document/types';
import { faceRect, isUsedTexel, SKIN_SIZE, skinParts } from './uv';

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
	severity: Severity;
	code: string;
	message: string;
}

/** Image dimensions Moxel can open as a player skin. */
export function skinSizeKind(width: number, height: number): 'modern' | 'legacy' | null {
	if (width === 64 && height === 64) return 'modern';
	if (width === 64 && height === 32) return 'legacy';
	return null;
}

export const SKIN_SIZE_ERROR =
	'This image cannot be used as a Minecraft skin. Expected a supported Minecraft skin texture size (64×64, or legacy 64×32).';

/** Validate a flattened skin before export. */
export function validateSkin(
	pixels: Uint8ClampedArray,
	width: number,
	height: number,
	model: SkinModel | undefined
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	if (model !== 'classic' && model !== 'slim') {
		issues.push({
			severity: 'error',
			code: 'model',
			message: 'The skin has no valid model type. Choose Classic (4px arms) or Slim (3px arms).'
		});
		return issues;
	}
	if (width !== SKIN_SIZE || height !== SKIN_SIZE) {
		issues.push({
			severity: 'error',
			code: 'size',
			message: `The skin is ${width}×${height}. Minecraft skins must be exactly 64×64 pixels.`
		});
		return issues;
	}

	let opaque = 0,
		holes = 0,
		partial = 0,
		unused = 0;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const a = pixels[(y * width + x) * 4 + 3];
			if (a > 0) opaque++;
			if (!isUsedTexel(model, x, y)) {
				if (a > 0) unused++;
			} else if (a > 0 && a < 255) partial++;
		}

	if (opaque === 0) {
		issues.push({ severity: 'error', code: 'empty', message: 'The skin is completely transparent.' });
		return issues;
	}

	// Base-layer (non-overlay) texels are rendered opaque in-game; holes there show up black.
	for (const p of skinParts(model).filter((p) => !p.overlay)) {
		for (const face of ['top', 'bottom', 'right', 'front', 'left', 'back'] as const) {
			const r = faceRect(p, face);
			for (let y = r.y; y < r.y + r.h; y++)
				for (let x = r.x; x < r.x + r.w; x++) if (pixels[(y * width + x) * 4 + 3] < 255) holes++;
		}
	}
	if (holes > 0)
		issues.push({
			severity: 'warning',
			code: 'base-transparency',
			message: `${holes} pixel${holes === 1 ? '' : 's'} on the base layer (not the outer layer) are transparent. Minecraft draws the base layer opaque, so these will appear solid black or as other colors in-game.`
		});
	if (partial > 0)
		issues.push({
			severity: 'info',
			code: 'partial-alpha',
			message: `${partial} pixel${partial === 1 ? '' : 's'} are partially transparent. The outer layer only supports fully see-through or fully solid pixels in most versions.`
		});
	if (unused > 0)
		issues.push({
			severity: 'info',
			code: 'unused',
			message: `${unused} painted pixel${unused === 1 ? '' : 's'} are outside the skin's UV regions and will be ignored by the game.`
		});
	if (model === 'slim') {
		// Texels a Classic layout uses but Slim doesn't — paint there suggests the wrong model.
		let stray = 0;
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				if (isUsedTexel('classic', x, y) && !isUsedTexel('slim', x, y) && pixels[(y * width + x) * 4 + 3] > 0)
					stray++;
		if (stray > 0)
			issues.push({
				severity: 'warning',
				code: 'model-mismatch',
				message:
					'Pixels were found where a Classic (4px) arm would be. If the arms look cut off, switch the model to Classic.'
			});
	}
	return issues;
}

export interface TextureValidationInput {
	width: number;
	height: number;
	frameCount: number;
	textureType?: string;
}

export function validateTexture(t: TextureValidationInput): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const pow2 = (n: number) => (n & (n - 1)) === 0;
	if (t.textureType === 'block' || t.textureType === 'item') {
		if (t.width !== t.height)
			issues.push({
				severity: 'warning',
				code: 'square',
				message: `Block and item textures are expected to be square (this one is ${t.width}×${t.height}).`
			});
		if (!pow2(t.width) || !pow2(t.height))
			issues.push({
				severity: 'warning',
				code: 'pow2',
				message: 'Minecraft texture sizes should be powers of two (16, 32, 64…). Other sizes may be resampled or rejected.'
			});
		else if (t.width !== 16)
			issues.push({
				severity: 'info',
				code: 'hd',
				message: `This is a ${t.width}×${t.height} (HD) texture. Vanilla textures are 16×16; resource packs can use larger ones.`
			});
	}
	if (t.frameCount > 1)
		issues.push({
			severity: 'info',
			code: 'animated',
			message: `This texture has ${t.frameCount} frames. Use “Minecraft animated texture” to export the vertical strip and its .mcmeta file.`
		});
	return issues;
}
