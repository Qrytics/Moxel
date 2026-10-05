import { describe, expect, it } from 'vitest';
import { MoxelDocument } from '../src/core/document/document';
import { DocCommands } from '../src/core/document/commands';
import { History } from '../src/core/history/history';
import { decodePNG, encodePNG } from '../src/io/png';
import {
	decodeMoxel,
	decodeProjectsFile,
	encodeBackup,
	encodeMoxel,
	ProjectFileError
} from '../src/io/moxelFile';
import { exportFlattenedPNG } from '../src/io/export';

describe('PNG codec', () => {
	it('round-trips RGBA pixels exactly', () => {
		const w = 7,
			h = 5;
		const px = new Uint8ClampedArray(w * h * 4);
		for (let i = 0; i < px.length; i++) px[i] = (i * 37) % 256;
		const png = encodePNG(px, w, h);
		const img = decodePNG(png);
		expect(img.width).toBe(w);
		expect(img.height).toBe(h);
		expect(Array.from(img.data)).toEqual(Array.from(px));
	});

	it('rejects non-PNG data', () => {
		expect(() => decodePNG(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow();
	});
});

function sampleDoc() {
	const doc = MoxelDocument.create({
		name: 'Round trip',
		kind: 'skin',
		width: 64,
		height: 64,
		model: 'classic'
	});
	const cmd = new DocCommands(doc, new History(doc));
	const top = cmd.addLayer('Hair');
	cmd.setNodeProps(top, { opacity: 0.5, visible: false });
	const g = cmd.addGroup('Clothes');
	cmd.addLayer('Shirt', g);
	doc.ensureCel(top, doc.frames[0].id).set([200, 100, 50, 255], 4 * 10);
	cmd.setMeta({ palette: ['#ff0000', '#00ff00'] });
	doc.editor = { activeLayer: top, tool: 'pencil' };
	return { doc, top };
}

describe('.moxel project files', () => {
	it('preserves layers, names, visibility, opacity, palette, model and editor state', () => {
		const { doc, top } = sampleDoc();
		const bytes = encodeMoxel(doc);
		const back = decodeMoxel(bytes);
		expect(back.meta.id).toBe(doc.meta.id);
		expect(back.meta.skin?.model).toBe('classic');
		expect(back.meta.palette).toEqual(['#ff0000', '#00ff00']);
		expect(back.getNode(top)).toMatchObject({ name: 'Hair', opacity: 0.5, visible: false });
		expect(back.displayRows().map((r) => r.node.name)).toEqual(doc.displayRows().map((r) => r.node.name));
		expect(back.getCel(top, back.frames[0].id)![40]).toBe(200);
		expect(back.editor).toEqual({ activeLayer: top, tool: 'pencil' });
	});

	it('can import as a new project id', () => {
		const { doc } = sampleDoc();
		expect(decodeMoxel(encodeMoxel(doc), { newId: true }).meta.id).not.toBe(doc.meta.id);
	});

	it('rejects garbage with a readable error', () => {
		expect(() => decodeMoxel(new Uint8Array([0, 1, 2]))).toThrow(ProjectFileError);
	});

	it('bundles several projects into a backup', () => {
		const a = sampleDoc().doc;
		const b = MoxelDocument.create({ name: 'Second', kind: 'canvas', width: 32, height: 16 });
		const docs = decodeProjectsFile(encodeBackup([a, b]));
		expect(docs.map((d) => d.meta.name).sort()).toEqual(['Round trip', 'Second']);
		expect(decodeProjectsFile(encodeMoxel(b))).toHaveLength(1);
	});
});

describe('PNG export', () => {
	it('exports a flattened image at the document size, honouring visibility', () => {
		const { doc, top } = sampleDoc();
		const base = doc.root[0];
		doc.ensureCel(base, doc.frames[0].id).set([1, 2, 3, 255], 0);
		const png = exportFlattenedPNG(doc, doc.frames[0].id);
		const img = decodePNG(png);
		expect([img.width, img.height]).toEqual([64, 64]);
		expect(Array.from(img.data.subarray(0, 4))).toEqual([1, 2, 3, 255]);
		// "Hair" is hidden, so its pixel must not be in the export.
		expect(img.data[43]).toBe(0);
		doc.getNode(top)!.visible = true;
		expect(decodePNG(exportFlattenedPNG(doc, doc.frames[0].id)).data[43]).toBeGreaterThan(0);
	});

	it('scales up with nearest-neighbour', () => {
		const doc = MoxelDocument.create({ name: 's', kind: 'canvas', width: 2, height: 2 });
		doc.ensureCel(doc.root[0], doc.frames[0].id).set([255, 0, 0, 255], 0);
		const img = decodePNG(exportFlattenedPNG(doc, doc.frames[0].id, 4));
		expect([img.width, img.height]).toEqual([8, 8]);
		expect(img.data[(3 * 8 + 3) * 4]).toBe(255);
		expect(img.data[(4 * 8 + 4) * 4 + 3]).toBe(0);
	});
});
