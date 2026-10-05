import type { SkinModel } from '../core/document/types';

/**
 * Minecraft player skin UV layout (64×64, the format since 1.8).
 *
 * Every body part is a box of (w, h, d) texels whose six faces are unwrapped from a texture
 * origin (u, v) in the standard net:
 *
 *            [top w×d][bottom w×d]
 *   [right d×h][front w×h][left d×h][back w×h]
 *
 * "right"/"left" are the character's own sides. Everything the editor knows about a skin — guides,
 * hover labels, left/right symmetry, validation and the 3D model — is derived from this table.
 */

export type PartId =
	| 'head'
	| 'body'
	| 'rightArm'
	| 'leftArm'
	| 'rightLeg'
	| 'leftLeg'
	| 'hat'
	| 'jacket'
	| 'rightSleeve'
	| 'leftSleeve'
	| 'rightPants'
	| 'leftPants';

export type FaceId = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back';
export const FACES: FaceId[] = ['top', 'bottom', 'right', 'front', 'left', 'back'];

export interface PartDef {
	id: PartId;
	label: string;
	u: number;
	v: number;
	w: number;
	h: number;
	d: number;
	overlay: boolean;
	/** The base part this overlay wraps (for overlays), or the overlay of this base part. */
	pair: PartId;
	/** Left/right counterpart for symmetry (self for head/body). */
	mirror: PartId;
	/** Which 3D group the part belongs to. */
	limb: 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
}

export interface FaceRect {
	part: PartId;
	face: FaceId;
	x: number;
	y: number;
	w: number;
	h: number;
}

export const SKIN_SIZE = 64;

export function skinParts(model: SkinModel): PartDef[] {
	const aw = model === 'slim' ? 3 : 4;
	const p = (
		id: PartId,
		label: string,
		u: number,
		v: number,
		w: number,
		h: number,
		d: number,
		overlay: boolean,
		pair: PartId,
		mirror: PartId,
		limb: PartDef['limb']
	): PartDef => ({ id, label, u, v, w, h, d, overlay, pair, mirror, limb });
	return [
		p('head', 'Head', 0, 0, 8, 8, 8, false, 'hat', 'head', 'head'),
		p('body', 'Body', 16, 16, 8, 12, 4, false, 'jacket', 'body', 'body'),
		p('rightArm', 'Right arm', 40, 16, aw, 12, 4, false, 'rightSleeve', 'leftArm', 'rightArm'),
		p('leftArm', 'Left arm', 32, 48, aw, 12, 4, false, 'leftSleeve', 'rightArm', 'leftArm'),
		p('rightLeg', 'Right leg', 0, 16, 4, 12, 4, false, 'rightPants', 'leftLeg', 'rightLeg'),
		p('leftLeg', 'Left leg', 16, 48, 4, 12, 4, false, 'leftPants', 'rightLeg', 'leftLeg'),
		p('hat', 'Hat', 32, 0, 8, 8, 8, true, 'head', 'hat', 'head'),
		p('jacket', 'Jacket', 16, 32, 8, 12, 4, true, 'body', 'jacket', 'body'),
		p('rightSleeve', 'Right sleeve', 40, 32, aw, 12, 4, true, 'rightArm', 'leftSleeve', 'rightArm'),
		p('leftSleeve', 'Left sleeve', 48, 48, aw, 12, 4, true, 'leftArm', 'rightSleeve', 'leftArm'),
		p('rightPants', 'Right pants', 0, 32, 4, 12, 4, true, 'rightLeg', 'leftPants', 'rightLeg'),
		p('leftPants', 'Left pants', 0, 48, 4, 12, 4, true, 'leftLeg', 'rightPants', 'leftLeg')
	];
}

export function faceRect(p: PartDef, face: FaceId): FaceRect {
	const { u, v, w, h, d } = p;
	switch (face) {
		case 'top':
			return { part: p.id, face, x: u + d, y: v, w, h: d };
		case 'bottom':
			return { part: p.id, face, x: u + d + w, y: v, w, h: d };
		case 'right':
			return { part: p.id, face, x: u, y: v + d, w: d, h };
		case 'front':
			return { part: p.id, face, x: u + d, y: v + d, w, h };
		case 'left':
			return { part: p.id, face, x: u + d + w, y: v + d, w: d, h };
		case 'back':
			return { part: p.id, face, x: u + 2 * d + w, y: v + d, w, h };
	}
}

export function allFaces(model: SkinModel): FaceRect[] {
	return skinParts(model).flatMap((p) => FACES.map((f) => faceRect(p, f)));
}

export const FACE_LABELS: Record<FaceId, string> = {
	top: 'Top',
	bottom: 'Bottom',
	right: 'Right side',
	front: 'Front',
	left: 'Left side',
	back: 'Back'
};

/** Map each texel to the part/face it belongs to (-1 = unused). Index into `allFaces(model)`. */
export function faceIndexMap(model: SkinModel): Int16Array {
	const map = new Int16Array(SKIN_SIZE * SKIN_SIZE).fill(-1);
	allFaces(model).forEach((f, i) => {
		for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) map[y * SKIN_SIZE + x] = i;
	});
	return map;
}

const cache = new Map<SkinModel, { faces: FaceRect[]; index: Int16Array; parts: Map<PartId, PartDef> }>();
function layout(model: SkinModel) {
	let l = cache.get(model);
	if (!l) {
		l = {
			faces: allFaces(model),
			index: faceIndexMap(model),
			parts: new Map(skinParts(model).map((p) => [p.id, p]))
		};
		cache.set(model, l);
	}
	return l;
}

/** What part of the model a texel belongs to — powers the "UV awareness" status readout. */
export function hitTest(model: SkinModel, x: number, y: number): { part: PartDef; face: FaceRect } | null {
	if (x < 0 || y < 0 || x >= SKIN_SIZE || y >= SKIN_SIZE) return null;
	const l = layout(model);
	const i = l.index[y * SKIN_SIZE + x];
	if (i < 0) return null;
	const face = l.faces[i];
	return { part: l.parts.get(face.part)!, face };
}

export function isUsedTexel(model: SkinModel, x: number, y: number) {
	return layout(model).index[y * SKIN_SIZE + x] >= 0;
}

/**
 * Character left/right symmetry: texel index → mirrored texel index (-1 = none / unused).
 *
 * Mirroring across the body's centre plane maps each part onto its counterpart (right arm ↔ left
 * arm, head ↔ head), swaps the outer/inner side faces, keeps the others, and flips every face
 * horizontally. Proven by construction in tests: the map is an involution.
 */
export function mirrorMap(model: SkinModel): Int32Array {
	const l = layout(model);
	const map = new Int32Array(SKIN_SIZE * SKIN_SIZE).fill(-1);
	const swap: Record<FaceId, FaceId> = {
		top: 'top',
		bottom: 'bottom',
		front: 'front',
		back: 'back',
		left: 'right',
		right: 'left'
	};
	for (const f of l.faces) {
		const part = l.parts.get(f.part)!;
		const target = faceRect(l.parts.get(part.mirror)!, swap[f.face]);
		if (target.w !== f.w || target.h !== f.h) continue;
		for (let y = 0; y < f.h; y++)
			for (let x = 0; x < f.w; x++) {
				map[(f.y + y) * SKIN_SIZE + f.x + x] = (target.y + y) * SKIN_SIZE + target.x + (f.w - 1 - x);
			}
	}
	return map;
}

/**
 * Convert a legacy 64×32 skin (pre-1.8) to 64×64: the top half is kept and the left arm/leg —
 * which legacy skins don't have — are generated by mirroring the right ones, exactly as the game does.
 */
export function upgradeLegacySkin(src: Uint8ClampedArray): Uint8ClampedArray {
	const out = new Uint8ClampedArray(SKIN_SIZE * SKIN_SIZE * 4);
	out.set(src.subarray(0, SKIN_SIZE * 32 * 4));
	const classic = layout('classic');
	const copyMirrored = (from: PartId, to: PartId) => {
		const a = classic.parts.get(from)!;
		const b = classic.parts.get(to)!;
		const swap: Record<FaceId, FaceId> = {
			top: 'top',
			bottom: 'bottom',
			front: 'front',
			back: 'back',
			left: 'right',
			right: 'left'
		};
		for (const face of FACES) {
			const s = faceRect(a, face);
			const t = faceRect(b, swap[face]);
			for (let y = 0; y < s.h; y++)
				for (let x = 0; x < s.w; x++) {
					const si = ((s.y + y) * SKIN_SIZE + s.x + x) * 4;
					const ti = ((t.y + y) * SKIN_SIZE + t.x + (s.w - 1 - x)) * 4;
					out.set(src.subarray(si, si + 4), ti);
				}
		}
	};
	copyMirrored('rightLeg', 'leftLeg');
	copyMirrored('rightArm', 'leftArm');
	return out;
}
