import type { SkinModel, TextureType } from '../core/document/types';
import { faceRect, FACES, SKIN_SIZE, skinParts, type PartId } from './uv';

/**
 * Starter templates. These are original, procedurally drawn artwork (no Mojang textures are
 * shipped), giving a beginner a recognisable character to paint over.
 */

type RGBA = [number, number, number, number];
const hex = (h: string, a = 255): RGBA => [
	parseInt(h.slice(1, 3), 16),
	parseInt(h.slice(3, 5), 16),
	parseInt(h.slice(5, 7), 16),
	a
];

function fillFace(buf: Uint8ClampedArray, x: number, y: number, w: number, h: number, c: RGBA, shade = 0) {
	for (let j = y; j < y + h; j++)
		for (let i = x; i < x + w; i++) {
			const k = (j * SKIN_SIZE + i) * 4;
			// Subtle per-pixel dither so the template reads as "pixel art", not flat fills.
			const n = ((i * 7 + j * 13) % 5) - 2;
			buf[k] = c[0] + shade + n * 2;
			buf[k + 1] = c[1] + shade + n * 2;
			buf[k + 2] = c[2] + shade + n * 2;
			buf[k + 3] = c[3];
		}
}

function paintPart(buf: Uint8ClampedArray, model: SkinModel, id: PartId, color: RGBA) {
	const part = skinParts(model).find((p) => p.id === id)!;
	for (const face of FACES) {
		const r = faceRect(part, face);
		const shade =
			face === 'top' ? 12 : face === 'bottom' ? -18 : face === 'back' ? -8 : face === 'front' ? 0 : -4;
		fillFace(buf, r.x, r.y, r.w, r.h, color, shade);
	}
}

function px(buf: Uint8ClampedArray, x: number, y: number, c: RGBA) {
	buf.set(c, (y * SKIN_SIZE + x) * 4);
}

/** Base-layer starter character. */
export function starterSkin(model: SkinModel): Uint8ClampedArray {
	const buf = new Uint8ClampedArray(SKIN_SIZE * SKIN_SIZE * 4);
	const skin = hex('#c69c7c');
	const shirt = hex('#3f7f8c');
	const pants = hex('#3b3f6b');
	paintPart(buf, model, 'head', skin);
	paintPart(buf, model, 'body', shirt);
	paintPart(buf, model, 'rightArm', skin);
	paintPart(buf, model, 'leftArm', skin);
	paintPart(buf, model, 'rightLeg', pants);
	paintPart(buf, model, 'leftLeg', pants);

	// Sleeves: top 4 rows of each arm's side faces take the shirt colour.
	for (const id of ['rightArm', 'leftArm'] as PartId[]) {
		const part = skinParts(model).find((p) => p.id === id)!;
		for (const face of ['right', 'front', 'left', 'back'] as const) {
			const r = faceRect(part, face);
			fillFace(buf, r.x, r.y, r.w, 4, shirt, face === 'front' ? 0 : -6);
		}
		const top = faceRect(part, 'top');
		fillFace(buf, top.x, top.y, top.w, top.h, shirt, 10);
	}
	// Shoes: bottom 2 rows of legs.
	for (const id of ['rightLeg', 'leftLeg'] as PartId[]) {
		const part = skinParts(model).find((p) => p.id === id)!;
		for (const face of ['right', 'front', 'left', 'back'] as const) {
			const r = faceRect(part, face);
			fillFace(buf, r.x, r.y + r.h - 2, r.w, 2, hex('#4a3a2c'), 0);
		}
		const b = faceRect(part, 'bottom');
		fillFace(buf, b.x, b.y, b.w, b.h, hex('#3a2c20'), 0);
	}
	// Hair: head top, back, and upper rows of front/sides.
	const head = skinParts(model).find((p) => p.id === 'head')!;
	const hair = hex('#4b2e1c');
	const hTop = faceRect(head, 'top');
	fillFace(buf, hTop.x, hTop.y, hTop.w, hTop.h, hair, 6);
	const hBack = faceRect(head, 'back');
	fillFace(buf, hBack.x, hBack.y, hBack.w, 6, hair, -4);
	for (const face of ['right', 'left'] as const) {
		const r = faceRect(head, face);
		fillFace(buf, r.x, r.y, r.w, 3, hair, -2);
	}
	const front = faceRect(head, 'front');
	fillFace(buf, front.x, front.y, front.w, 2, hair, 0);
	// Face: eyes, mouth.
	const fx = front.x,
		fy = front.y;
	px(buf, fx + 1, fy + 4, hex('#ffffff'));
	px(buf, fx + 2, fy + 4, hex('#2b4c9c'));
	px(buf, fx + 5, fy + 4, hex('#2b4c9c'));
	px(buf, fx + 6, fy + 4, hex('#ffffff'));
	px(buf, fx + 3, fy + 6, hex('#8a5a44'));
	px(buf, fx + 4, fy + 6, hex('#8a5a44'));
	return buf;
}

export interface TexturePreset {
	id: string;
	label: string;
	type: TextureType;
	width: number;
	height: number;
	hint: string;
}

export const TEXTURE_PRESETS: TexturePreset[] = [
	{ id: 'block16', label: 'Block', type: 'block', width: 16, height: 16, hint: '16×16 · cube preview' },
	{ id: 'item16', label: 'Item', type: 'item', width: 16, height: 16, hint: '16×16 · sprite' },
	{ id: 'block32', label: 'HD block', type: 'block', width: 32, height: 32, hint: '32×32 · resource packs' },
	{ id: 'gui256', label: 'GUI', type: 'gui', width: 256, height: 256, hint: '256×256 · containers' },
	{
		id: 'entity64',
		label: 'Mob / entity',
		type: 'entity',
		width: 64,
		height: 64,
		hint: '64×64 · entity sheet'
	}
];
