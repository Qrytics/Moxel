import { describe, expect, it } from 'vitest';
import { MoxelDocument } from '../src/core/document/document';
import { DocCommands } from '../src/core/document/commands';
import type { Op } from '../src/core/document/ops';
import { maxSize } from '../src/core/document/types';
import { History } from '../src/core/history/history';
import { Selection } from '../src/core/selection/selection';
import { SyncState } from '../src/collab/sync';
import { BRUSH_PRESETS, presetSettings } from '../src/core/tools/brushPresets';
import { renderBrushPreview } from '../src/core/tools/brushPreview';
import { mirrorPoints, PaintStroke, StrokePath, TILE, type Dab } from '../src/core/tools/paintEngine';
import { TOOLS, toolsFor } from '../src/core/tools/registry';
import {
	DEFAULT_PAINT_BRUSH,
	defaultToolSettings,
	type PaintBrushSettings,
	type PointerInfo,
	type RGBA,
	type ToolContext,
	type ToolId
} from '../src/core/tools/types';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { decodeMoxel, encodeMoxel, ProjectFileError } from '../src/io/moxelFile';
import { unrotate } from '../src/core/render/canvasRenderer';

function makeCtx(w = 200, h = 200) {
	const doc = MoxelDocument.create({ name: 't', kind: 'paint', width: w, height: h });
	const history = new History(doc);
	const ctx: ToolContext = {
		doc,
		history,
		cmd: new DocCommands(doc, history),
		selection: new Selection(w, h),
		layerId: doc.root[0],
		frameId: doc.frames[0].id,
		settings: defaultToolSettings(),
		fg: [255, 0, 0, 255],
		bg: [0, 0, 255, 255],
		overlay: {},
		setColor() {},
		usedColor() {},
		mirror: () => [],
		pan() {},
		zoomAt() {},
		notify() {},
		requestOverlay() {},
		setTool() {}
	};
	return { ctx, doc, history };
}

const P = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({
	x,
	y,
	sx: x,
	sy: y,
	pressure: 0.5,
	pointerType: 'mouse',
	button: 0,
	shift: false,
	alt: false,
	mod: false,
	...extra
});

function drag(ctx: ToolContext, tool: ToolId, pts: [number, number][], extra: Partial<PointerInfo> = {}) {
	const t = TOOLS[tool];
	t.onDown(ctx, P(pts[0][0], pts[0][1], extra));
	for (const [x, y] of pts.slice(1)) t.onMove(ctx, P(x, y, extra));
	const last = pts[pts.length - 1];
	t.onUp(ctx, P(last[0], last[1], extra));
}

function px(doc: MoxelDocument, x: number, y: number, layer = doc.root[0]): RGBA {
	const c = doc.getCel(layer, doc.frames[0].id);
	if (!c) return [0, 0, 0, 0];
	const i = (y * doc.width + x) * 4;
	return [c[i], c[i + 1], c[i + 2], c[i + 3]];
}

const brush = (o: Partial<PaintBrushSettings> = {}): PaintBrushSettings => ({
	...DEFAULT_PAINT_BRUSH,
	stabilizer: 0,
	...o
});

/** A plain dab for driving PaintStroke directly. */
const dab = (x: number, y: number, size: number, o: Partial<Dab> = {}): Dab => ({
	x,
	y,
	size,
	alpha: 1,
	hardness: 0.95,
	angle: 0,
	roundness: 1,
	grain: 0,
	grainScale: 1,
	...o
});

describe('paint documents', () => {
	it('allow larger canvases than pixel documents', () => {
		expect(maxSize('paint')).toBe(4096);
		expect(maxSize('canvas')).toBe(1024);
	});

	it('round-trip through .moxel as format version 2', () => {
		const { ctx, doc } = makeCtx(64, 48);
		drag(ctx, 'brush', [
			[5, 5],
			[50, 40]
		]);
		const back = decodeMoxel(encodeMoxel(doc));
		expect(back.meta.kind).toBe('paint');
		expect(back.meta.paint?.background).toBe('white');
		expect(back.toSnapshot().version).toBe(2);
		expect(px(back, 27, 22)).toEqual(px(doc, 27, 22));
		// Pixel documents keep writing v1, so older builds still open them.
		const pixel = MoxelDocument.create({ name: 'p', kind: 'canvas', width: 4, height: 4 });
		expect(pixel.toSnapshot().version).toBe(1);
	});

	it('only offer paint tools in paint documents', () => {
		const paint = toolsFor('paint').map((t) => t.id);
		const pixel = toolsFor('canvas').map((t) => t.id);
		expect(paint).toEqual(expect.arrayContaining(['brush', 'smudge', 'blur', 'gradient']));
		expect(paint).not.toContain('pencil');
		expect(pixel).not.toContain('smudge');
		expect(pixel).toContain('pencil');
	});

	it('rejects files from a future format version', () => {
		const { doc } = makeCtx(8, 8);
		const bytes = encodeMoxel(doc);
		// Re-encode the manifest with version 3.
		const files = unzipSync(bytes);
		const m = JSON.parse(strFromU8(files['project.json']));
		m.version = 3;
		files['project.json'] = strToU8(JSON.stringify(m));
		expect(() => decodeMoxel(zipSync(files))).toThrow(ProjectFileError);
	});
});

describe('paint engine', () => {
	it('backs up and patches only the tiles a stroke touches', () => {
		const { ctx, doc, history } = makeCtx(512, 512);
		const stroke = new PaintStroke(doc, ctx.layerId, ctx.frameId, 'paint', [0, 0, 0, 255], 1, null);
		// A dab in the top-left tile and one in the bottom-right tile: a bbox patch would cover all 64 tiles.
		stroke.stamp(dab(10, 10, 6));
		stroke.stamp(dab(500, 500, 6));
		expect(stroke.backups.size).toBe(2);
		expect(stroke.commit(history, 'two dots')).toBe(true);
		const entry = (history as unknown as { undoStack: { ops: Op[] }[] }).undoStack[0];
		expect(entry.ops).toHaveLength(2);
		for (const op of entry.ops) {
			expect(op.t).toBe('patch');
			if (op.t === 'patch') expect(op.rect.w * op.rect.h).toBeLessThanOrEqual(TILE * TILE);
		}
	});

	it('undo restores the cel byte for byte', () => {
		const { ctx, doc, history } = makeCtx(150, 150);
		const before = new Uint8ClampedArray(doc.ensureCel(ctx.layerId, ctx.frameId));
		drag(ctx, 'brush', [
			[10, 10],
			[140, 20],
			[30, 140]
		]);
		expect(px(doc, 75, 15)[3]).toBeGreaterThan(0);
		history.undo();
		expect(doc.getCel(ctx.layerId, ctx.frameId)).toEqual(before);
		history.redo();
		expect(px(doc, 75, 15)[3]).toBeGreaterThan(0);
	});

	it('builds up with flow but never past the stroke opacity', () => {
		const { ctx, doc } = makeCtx(40, 40);
		const s = new PaintStroke(doc, ctx.layerId, ctx.frameId, 'paint', [0, 0, 0, 255], 0.5, null);
		const alphas: number[] = [];
		for (let i = 0; i < 40; i++) {
			s.stamp(dab(20, 20, 10, { alpha: 0.1 }));
			alphas.push(px(doc, 20, 20)[3]);
		}
		expect(alphas[0]).toBeLessThan(alphas[5]);
		expect(alphas[5]).toBeLessThan(alphas[20]);
		// 50% opacity cap: 128 of 255, give or take rounding.
		expect(Math.max(...alphas)).toBeLessThanOrEqual(128);
		expect(alphas.at(-1)).toBeGreaterThan(120);
	});

	it('soft brushes anti-alias: edge pixels are partially covered', () => {
		const { ctx, doc } = makeCtx(40, 40);
		const s = new PaintStroke(doc, ctx.layerId, ctx.frameId, 'paint', [0, 0, 0, 255], 1, null);
		s.stamp(dab(20, 20, 20, { hardness: 0.2 }));
		const centre = px(doc, 19, 19)[3];
		const mid = px(doc, 26, 19)[3];
		expect(centre).toBe(255);
		expect(mid).toBeGreaterThan(0);
		expect(mid).toBeLessThan(255);
		expect(px(doc, 33, 19)[3]).toBe(0);
	});

	it('masks paint with a soft selection', () => {
		const { ctx, doc } = makeCtx(40, 40);
		const sel = new Selection(40, 40);
		const mask = new Uint8Array(40 * 40);
		for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) mask[y * 40 + x] = 255;
		sel.setMask(mask);
		const s = new PaintStroke(doc, ctx.layerId, ctx.frameId, 'paint', [0, 0, 0, 255], 1, sel);
		s.stamp(dab(20, 20, 20));
		expect(px(doc, 15, 20)[3]).toBe(255);
		expect(px(doc, 25, 20)[3]).toBe(0);
	});

	it('erases toward transparency', () => {
		const { ctx, doc } = makeCtx(40, 40);
		doc.ensureCel(ctx.layerId, ctx.frameId).fill(255);
		ctx.settings.paint.eraser = brush({ size: 10, hardness: 0.9 });
		drag(ctx, 'eraser', [
			[5, 20],
			[35, 20]
		]);
		expect(px(doc, 20, 20)[3]).toBe(0);
		expect(px(doc, 20, 2)[3]).toBe(255);
	});

	it('smudge drags colour along the stroke', () => {
		const { ctx, doc } = makeCtx(80, 40);
		const cel = doc.ensureCel(ctx.layerId, ctx.frameId);
		// Left half red, right half blue.
		for (let y = 0; y < 40; y++)
			for (let x = 0; x < 80; x++) cel.set(x < 40 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 80 + x) * 4);
		ctx.settings.paint.smudge = brush({ size: 16, hardness: 0.5, strength: 0.9, spacing: 0.05 });
		drag(ctx, 'smudge', [
			[30, 20],
			[60, 20]
		]);
		const [r, , b] = px(doc, 50, 20);
		// Red was pushed into the blue half.
		expect(r).toBeGreaterThan(40);
		expect(b).toBeLessThan(255);
		// Away from the stroke nothing moved.
		expect(px(doc, 50, 2)).toEqual([0, 0, 255, 255]);
	});

	it('blur softens a hard edge, sharpen strengthens it', () => {
		const make = () => {
			const { ctx, doc } = makeCtx(40, 40);
			const cel = doc.ensureCel(ctx.layerId, ctx.frameId);
			for (let y = 0; y < 40; y++)
				for (let x = 0; x < 40; x++)
					cel.set(x < 20 ? [0, 0, 0, 255] : [200, 200, 200, 255], (y * 40 + x) * 4);
			return { ctx, doc };
		};
		const a = make();
		const s = new PaintStroke(a.doc, a.ctx.layerId, a.ctx.frameId, 'blur', [0, 0, 0, 255], 1, null, null, 1);
		for (let i = 0; i < 6; i++) s.stamp(dab(20, 20, 16, { hardness: 0.9 }));
		const left = px(a.doc, 19, 20)[0],
			right = px(a.doc, 20, 20)[0];
		expect(left).toBeGreaterThan(0);
		expect(right).toBeLessThan(200);

		const b = make();
		const sh = new PaintStroke(
			b.doc,
			b.ctx.layerId,
			b.ctx.frameId,
			'blur',
			[0, 0, 0, 255],
			1,
			null,
			null,
			-1
		);
		sh.stamp(dab(20, 20, 16, { hardness: 0.9 }));
		// Sharpening pushes the light side of the edge lighter.
		expect(px(b.doc, 20, 20)[0]).toBeGreaterThan(200);
	});

	it('mirrors dabs, not texels, with symmetry on', () => {
		const { ctx, doc } = makeCtx(100, 60);
		ctx.settings.symmetry = 'horizontal';
		ctx.settings.paint.brush = brush({ size: 6, hardness: 0.95 });
		drag(ctx, 'brush', [
			[20.5, 30.5],
			[21, 30.5]
		]);
		expect(px(doc, 20, 30)[3]).toBeGreaterThan(200);
		expect(px(doc, 79, 30)[3]).toBeGreaterThan(200);
		expect(mirrorPoints('both', 100, 60)!(10, 20)).toEqual([
			[90, 20],
			[10, 40],
			[90, 40]
		]);
	});

	it('gradients run from foreground to background', () => {
		const { ctx, doc } = makeCtx(100, 10);
		drag(ctx, 'gradient', [
			[0, 5],
			[100, 5]
		]);
		const start = px(doc, 1, 5),
			end = px(doc, 98, 5),
			mid = px(doc, 50, 5);
		expect(start[0]).toBeGreaterThan(240);
		expect(end[2]).toBeGreaterThan(240);
		expect(mid[0]).toBeGreaterThan(100);
		expect(mid[2]).toBeGreaterThan(100);
	});
});

describe('stroke input', () => {
	it('interpolates pen pressure across a segment', () => {
		const sizes: number[] = [];
		const path = new StrokePath(brush({ size: 20, spacing: 0.1 }), (d) => sizes.push(d.size));
		path.begin({ x: 0, y: 0, pressure: 0.1, pen: true });
		path.move({ x: 100, y: 0, pressure: 1, pen: true });
		path.end();
		expect(sizes.length).toBeGreaterThan(10);
		// Sizes ramp smoothly instead of jumping to the last event's pressure.
		const mid = sizes[Math.floor(sizes.length / 2)];
		expect(mid).toBeGreaterThan(sizes[1]);
		expect(mid).toBeLessThan(sizes.at(-1)!);
	});

	it('the stabilizer trails the pointer but the line still ends at the last point', () => {
		const xs: number[] = [];
		const path = new StrokePath(brush({ size: 4, spacing: 0.1, stabilizer: 0.8 }), (d) => xs.push(d.x));
		path.begin({ x: 0, y: 0, pressure: 1, pen: false });
		path.move({ x: 100, y: 0, pressure: 1, pen: false });
		const beforeEnd = Math.max(...xs);
		path.end();
		expect(beforeEnd).toBeLessThan(50);
		expect(Math.max(...xs)).toBeGreaterThan(99);
	});

	it('mouse taper starts thin and swells', () => {
		const sizes: number[] = [];
		const path = new StrokePath(brush({ size: 20, spacing: 0.1, taper: true }), (d) => sizes.push(d.size));
		path.begin({ x: 0, y: 0, pressure: 0, pen: false });
		path.move({ x: 200, y: 0, pressure: 0, pen: false });
		expect(sizes[0]).toBeLessThan(6);
		expect(sizes.at(-1)).toBe(20);
	});
});

describe('presets and previews', () => {
	it('every built-in preset renders a visible preview', () => {
		for (const p of BRUSH_PRESETS) {
			const data = renderBrushPreview(p.tool, presetSettings(p), 66, 20);
			if (p.tool === 'brush') {
				let painted = 0;
				for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++;
				expect(painted, p.name).toBeGreaterThan(20);
			} else expect(data.length).toBe(66 * 20 * 4);
		}
	});
});

describe('paint strokes in live sessions', () => {
	it('a stroke spanning many tiles converges on a peer', () => {
		const seed = MoxelDocument.create({ name: 's', kind: 'paint', width: 300, height: 300 });
		const a = { doc: MoxelDocument.fromSnapshot(seed.toSnapshot()) };
		const b = { doc: MoxelDocument.fromSnapshot(seed.toSnapshot()) };
		const ha = new History(a.doc);
		const sa = new SyncState(a.doc, 'alice');
		const sb = new SyncState(b.doc, 'bob');
		const patches: ReturnType<SyncState['localPatch']>[] = [];
		ha.onApplied = (_ops, _k, _l, inverses) => {
			for (const inv of inverses) if (inv.t === 'patch') patches.push(sa.localPatch(inv));
		};
		const layer = a.doc.root[0],
			frame = a.doc.frames[0].id;
		const s = new PaintStroke(a.doc, layer, frame, 'paint', [10, 200, 30, 255], 1, null);
		const path = new StrokePath(brush({ size: 12 }), (d) => s.stamp(d));
		path.begin({ x: 5, y: 5, pressure: 1, pen: false });
		path.move({ x: 295, y: 295, pressure: 1, pen: false });
		path.end();
		s.commit(ha, 'diagonal');
		expect(patches.length).toBeGreaterThan(4);
		for (const p of patches) if (p) sb.applyRemotePatch(p);
		expect(b.doc.getCel(layer, frame)).toEqual(a.doc.getCel(layer, frame));
	});
});

describe('rotated view', () => {
	it('unrotate inverts the view rotation about the viewport centre', () => {
		const v = { zoom: 1, ox: 0, oy: 0, rot: 90 };
		// The point right of centre appears below centre after a 90° clockwise rotation.
		const [x, y] = unrotate(v, 400, 400, 800, 600);
		expect(x).toBeCloseTo(500);
		expect(y).toBeCloseTo(300);
		const [fx] = unrotate({ zoom: 1, ox: 0, oy: 0, flip: true }, 300, 300, 800, 600);
		expect(fx).toBeCloseTo(500);
	});
});
