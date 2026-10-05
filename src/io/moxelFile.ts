import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { MoxelDocument } from '../core/document/document';
import { uid } from '../core/id';
import type { DocSnapshot } from '../core/document/types';
import { decodePNG, encodePNG } from './png';

/**
 * `.moxel` project files: a zip containing
 *
 *   project.json             – manifest: metadata, layer tree, frames, palette, editor state
 *   cels/<layer>/<frame>.png – one PNG per non-empty cel
 *
 * Zip + PNG rather than one JSON blob so files stay small, are inspectable with any unzip tool,
 * and individual cels can be extracted as ordinary images.
 *
 * `.moxelbackup` files bundle several projects: `backup.json` plus `projects/<id>.moxel`.
 */

export const MOXEL_EXT = '.moxel';
export const BACKUP_EXT = '.moxelbackup';
export const MOXEL_MIME = 'application/x-moxel';

interface Manifest extends Omit<DocSnapshot, 'cels'> {
	app: 'Moxel';
	savedAt: string;
	cels: { layer: string; frame: string; path: string }[];
}

export class ProjectFileError extends Error {}

export function encodeMoxel(doc: MoxelDocument): Uint8Array {
	const snap = doc.toSnapshot(false);
	const files: Zippable = {};
	const cels: Manifest['cels'] = [];
	for (const [key, data] of snap.cels) {
		if (!data.some((v, i) => i % 4 === 3 && v !== 0)) continue;
		const [layer, frame] = key.split(':');
		const path = `cels/${layer}/${frame}.png`;
		files[path] = [encodePNG(data, snap.meta.width, snap.meta.height), { level: 0 }];
		cels.push({ layer, frame, path });
	}
	const manifest: Manifest = {
		app: 'Moxel',
		savedAt: new Date().toISOString(),
		format: 'moxel',
		version: 1,
		meta: snap.meta,
		nodes: snap.nodes,
		root: snap.root,
		frames: snap.frames,
		editor: snap.editor,
		cels
	};
	files['project.json'] = strToU8(JSON.stringify(manifest, null, '\t'));
	return zipSync(files, { level: 6 });
}

export function decodeMoxel(bytes: Uint8Array, opts: { newId?: boolean } = {}): MoxelDocument {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes);
	} catch {
		throw new ProjectFileError('This file is not a valid Moxel project (it is not a zip archive).');
	}
	const json = files['project.json'];
	if (!json) throw new ProjectFileError('This file is not a Moxel project: project.json is missing.');
	let m: Manifest;
	try {
		m = JSON.parse(strFromU8(json));
	} catch {
		throw new ProjectFileError('The project manifest is corrupted and could not be read.');
	}
	if (m.format !== 'moxel') throw new ProjectFileError('This file is not a Moxel project.');
	if (typeof m.version !== 'number' || m.version > 1)
		throw new ProjectFileError('This project was made with a newer version of Moxel. Reload the page to update.');
	const { width, height } = m.meta ?? {};
	if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4096 * 4096)
		throw new ProjectFileError('The project has invalid canvas dimensions.');
	const cels: [string, Uint8ClampedArray][] = [];
	for (const c of m.cels ?? []) {
		const f = files[c.path];
		if (!f) continue;
		const img = decodePNG(f);
		if (img.width !== width || img.height !== height) continue;
		cels.push([`${c.layer}:${c.frame}`, img.data]);
	}
	const doc = MoxelDocument.fromSnapshot({
		format: 'moxel',
		version: 1,
		meta: m.meta,
		nodes: m.nodes ?? [],
		root: m.root ?? [],
		frames: m.frames ?? [],
		cels,
		editor: m.editor
	});
	if (opts.newId) doc.meta.id = uid('p');
	return doc;
}

export function encodeBackup(docs: MoxelDocument[]): Uint8Array {
	const files: Zippable = {};
	const index = docs.map((d) => ({ id: d.meta.id, name: d.meta.name, path: `projects/${d.meta.id}${MOXEL_EXT}` }));
	for (const d of docs) files[`projects/${d.meta.id}${MOXEL_EXT}`] = [encodeMoxel(d), { level: 0 }];
	files['backup.json'] = strToU8(
		JSON.stringify({ app: 'Moxel', format: 'moxel-backup', version: 1, createdAt: new Date().toISOString(), projects: index }, null, '\t')
	);
	return zipSync(files);
}

/** Decode a .moxelbackup, or a single .moxel (returned as a one-element list). */
export function decodeProjectsFile(bytes: Uint8Array): MoxelDocument[] {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes);
	} catch {
		throw new ProjectFileError('This file is not a Moxel project or backup.');
	}
	if (files['project.json']) return [decodeMoxel(bytes)];
	if (!files['backup.json']) throw new ProjectFileError('This file is not a Moxel project or backup.');
	const docs: MoxelDocument[] = [];
	for (const [path, data] of Object.entries(files)) {
		if (path.startsWith('projects/') && path.endsWith(MOXEL_EXT)) docs.push(decodeMoxel(data));
	}
	return docs;
}

export function safeFileName(name: string): string {
	return (name.trim() || 'untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 80);
}
