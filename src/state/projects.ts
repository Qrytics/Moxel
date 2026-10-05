import { MoxelDocument, newLayer } from '../core/document/document';
import {
	MAX_CANVAS_SIZE,
	MAX_PAINT_SIZE,
	maxSize,
	type DocKind,
	type SkinModel,
	type TextureType
} from '../core/document/types';
import { decodePNG, isPNG } from '../io/png';
import {
	decodeProjectsFile,
	encodeBackup,
	encodeMoxel,
	BACKUP_EXT,
	MOXEL_EXT,
	safeFileName
} from '../io/moxelFile';
import { downloadBytes } from '../io/export';
import { SKIN_SIZE_ERROR, skinSizeKind } from '../minecraft/validate';
import { starterSkin } from '../minecraft/templates';
import { upgradeLegacySkin } from '../minecraft/uv';
import { renderThumbnail } from './thumbnail';
import { app } from './app.svelte';

export type NewProjectSpec =
	| { type: 'skin'; name: string; model: SkinModel; template: 'blank' | 'starter' }
	| {
			type: 'texture';
			name: string;
			textureType: TextureType;
			width: number;
			height: number;
			frames?: number;
			fps?: number;
	  }
	| { type: 'canvas'; name: string; width: number; height: number; frames: number; fps: number }
	| { type: 'paint'; name: string; width: number; height: number; background: 'white' | 'transparent' };

export function createDocument(spec: NewProjectSpec): MoxelDocument {
	if (spec.type === 'skin') {
		const doc = MoxelDocument.create({
			name: spec.name,
			kind: 'skin',
			width: 64,
			height: 64,
			model: spec.model,
			layerName: 'Base'
		});
		if (spec.template === 'starter')
			doc.ensureCel(doc.root[0], doc.frames[0].id).set(starterSkin(spec.model));
		return doc;
	}
	const w = clampSize(spec.width, spec.type),
		h = clampSize(spec.height, spec.type);
	if (spec.type === 'paint') {
		const doc = MoxelDocument.create({
			name: spec.name,
			kind: 'paint',
			width: w,
			height: h,
			background: spec.background,
			layerName: 'Background'
		});
		if (spec.background === 'white') doc.ensureCel(doc.root[0], doc.frames[0].id).fill(255);
		// Paint on a layer above the background, so erasing reveals white rather than transparency.
		const layer = newLayer('Layer 1');
		doc.nodes.set(layer.id, layer);
		doc.root.push(layer.id);
		return doc;
	}
	if (spec.type === 'texture')
		return MoxelDocument.create({
			name: spec.name,
			kind: 'texture',
			width: w,
			height: h,
			textureType: spec.textureType,
			frames: spec.frames ?? 1,
			fps: spec.fps
		});
	return MoxelDocument.create({
		name: spec.name,
		kind: 'canvas',
		width: w,
		height: h,
		frames: spec.frames,
		fps: spec.fps
	});
}

function clampSize(n: number, kind: DocKind) {
	return Math.max(1, Math.min(maxSize(kind), Math.round(n) || 1));
}

export async function saveNewDocument(doc: MoxelDocument): Promise<void> {
	await app.store!.save(doc, { thumbnail: renderThumbnail(doc) });
	await app.refreshProjects();
}

export async function decodeImageFile(
	file: Blob
): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (isPNG(bytes)) {
		try {
			return decodePNG(bytes);
		} catch {
			/* fall through to the browser decoder (interlaced / 16-bit PNGs) */
		}
	}
	const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
	const c = document.createElement('canvas');
	c.width = bmp.width;
	c.height = bmp.height;
	const g = c.getContext('2d', { willReadFrequently: true })!;
	g.drawImage(bmp, 0, 0);
	const img = g.getImageData(0, 0, bmp.width, bmp.height);
	bmp.close();
	return { width: img.width, height: img.height, data: img.data };
}

/** Slim skins leave the 4th column of each arm empty. */
export function detectSkinModel(px: Uint8ClampedArray): SkinModel {
	const probe = [
		[54, 20],
		[54, 31],
		[55, 20],
		[50, 16],
		[51, 19],
		[46, 52],
		[47, 63]
	];
	return probe.every(([x, y]) => px[(y * 64 + x) * 4 + 3] === 0) ? 'slim' : 'classic';
}

export class ImportError extends Error {}

/**
 * Turn an image into a project. `asSkin` forces skin interpretation (and the skin-size error);
 * otherwise skin-sized images become skins and anything else becomes a texture/canvas.
 */
export async function documentFromImage(
	file: File,
	asSkin: boolean | 'auto' = 'auto'
): Promise<MoxelDocument> {
	let img;
	try {
		img = await decodeImageFile(file);
	} catch {
		throw new ImportError(`“${file.name}” couldn't be read as an image.`);
	}
	const name = file.name.replace(/\.[^.]+$/, '') || 'Imported';
	const sizeKind = skinSizeKind(img.width, img.height);
	if (asSkin === true && !sizeKind) throw new ImportError(SKIN_SIZE_ERROR);
	if (sizeKind && asSkin !== false) {
		const px = sizeKind === 'legacy' ? upgradeLegacySkin(img.data) : img.data;
		const doc = MoxelDocument.create({
			name,
			kind: 'skin',
			width: 64,
			height: 64,
			model: detectSkinModel(px),
			layerName: 'Imported skin'
		});
		doc.ensureCel(doc.root[0], doc.frames[0].id).set(px);
		if (sizeKind === 'legacy') app.toast('Converted a legacy 64×32 skin to the modern 64×64 layout.', 'info');
		return doc;
	}
	if (img.width > MAX_PAINT_SIZE || img.height > MAX_PAINT_SIZE)
		throw new ImportError(
			`This image is ${img.width}×${img.height}. Moxel supports images up to ${MAX_PAINT_SIZE}×${MAX_PAINT_SIZE}.`
		);
	// Too big for pixel art: open it as a painting instead of refusing it.
	if (img.width > MAX_CANVAS_SIZE || img.height > MAX_CANVAS_SIZE) {
		const doc = MoxelDocument.create({
			name,
			kind: 'paint',
			width: img.width,
			height: img.height,
			background: 'transparent',
			layerName: 'Imported image'
		});
		doc.ensureCel(doc.root[0], doc.frames[0].id).set(img.data);
		app.toast('Large image opened as a painting.', 'info');
		return doc;
	}
	const square = img.width === img.height && (img.width & (img.width - 1)) === 0 && img.width <= 512;
	const doc = MoxelDocument.create({
		name,
		kind: square ? 'texture' : 'canvas',
		width: img.width,
		height: img.height,
		textureType: square ? (img.width <= 32 ? 'block' : 'other') : undefined,
		layerName: 'Imported image'
	});
	doc.ensureCel(doc.root[0], doc.frames[0].id).set(img.data);
	return doc;
}

/** Import .moxel / .moxelbackup / images. Returns the ids of the created projects. */
export async function importFiles(
	files: FileList | File[],
	opts: { asSkin?: boolean } = {}
): Promise<string[]> {
	const ids: string[] = [];
	for (const file of Array.from(files)) {
		try {
			const lower = file.name.toLowerCase();
			const bytes = new Uint8Array(await file.arrayBuffer());
			// Detect by content (zip signature "PK\x03\x04"), not just by extension.
			const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
			if (isZip || lower.endsWith(MOXEL_EXT) || lower.endsWith(BACKUP_EXT)) {
				const docs = decodeProjectsFile(bytes);
				const existing = new Set(app.projects.map((p) => p.id));
				for (const d of docs) {
					// Importing the same project twice must never overwrite local work.
					if (existing.has(d.meta.id)) {
						const copy = d.clone(true);
						copy.meta.name = `${d.meta.name} (imported)`;
						await saveNewDocument(copy);
						ids.push(copy.meta.id);
					} else {
						await saveNewDocument(d);
						ids.push(d.meta.id);
					}
				}
				if (docs.length > 1) app.toast(`Restored ${docs.length} projects from the backup.`, 'success');
			} else {
				const doc = await documentFromImage(file, opts.asSkin ?? 'auto');
				await saveNewDocument(doc);
				ids.push(doc.meta.id);
			}
		} catch (e) {
			app.toast(e instanceof Error ? e.message : `Couldn't import ${file.name}.`, 'error');
		}
	}
	return ids;
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.multiple = multiple;
		input.style.display = 'none';
		input.onchange = () => {
			resolve(input.files ? Array.from(input.files) : []);
			input.remove();
		};
		input.oncancel = () => {
			resolve([]);
			input.remove();
		};
		document.body.appendChild(input);
		input.click();
	});
}

export async function exportProjectFile(doc: MoxelDocument) {
	try {
		downloadBytes(encodeMoxel(doc), `${safeFileName(doc.meta.name)}${MOXEL_EXT}`, 'application/zip');
	} catch {
		app.toast('Export failed. Your project is still saved locally.', 'error');
	}
}

export async function exportProjectById(id: string) {
	const doc = await app.store?.load(id);
	if (doc) await exportProjectFile(doc);
}

export async function downloadBackup() {
	try {
		const docs: MoxelDocument[] = [];
		for (const m of app.projects) {
			const d = await app.store!.load(m.id);
			if (d) docs.push(d);
		}
		if (!docs.length) return app.toast('There are no projects to back up yet.');
		const date = new Date().toISOString().slice(0, 10);
		downloadBytes(encodeBackup(docs), `moxel-backup-${date}${BACKUP_EXT}`, 'application/zip');
		app.toast(`Backed up ${docs.length} project${docs.length === 1 ? '' : 's'}.`, 'success');
	} catch {
		app.toast('Backup failed. Your projects are still saved locally.', 'error');
	}
}

export const IMPORT_ACCEPT = `${MOXEL_EXT},${BACKUP_EXT},image/png,image/gif,image/webp,image/jpeg,.png`;
