import { describe, expect, it } from 'vitest';
import { MoxelDocument } from '../src/core/document/document';
import { DocCommands } from '../src/core/document/commands';
import { History } from '../src/core/history/history';
import { Selection } from '../src/core/selection/selection';
import { TOOLS } from '../src/core/tools/registry';
import {
	defaultToolSettings,
	type PointerInfo,
	type RGBA,
	type ToolContext,
	type ToolId
} from '../src/core/tools/types';
import {
	copySelection,
	deleteSelection,
	pasteImage,
	transformSelection
} from '../src/core/tools/editActions';
import { nudge } from '../src/core/tools/otherTools';
import { mirrorMap } from '../src/minecraft/uv';

function makeCtx(w = 8, h = 8, kind: 'canvas' | 'skin' = 'canvas') {
	const doc = MoxelDocument.create({ name: 't', kind, width: w, height: h, model: 'classic' });
	const history = new History(doc);
	const notes: string[] = [];
	const ctx: ToolContext = {
		doc,
		history,
		cmd: new DocCommands(doc, history),
		selection: new Selection(w, h),
		layerId: doc.root[0],
		frameId: doc.frames[0].id,
		settings: defaultToolSettings(),
		fg: [255, 0, 0, 255],
		bg: [255, 255, 255, 255],
		overlay: {},
		setColor(c, which) {
			if (which === 'fg') ctx.fg = c;
			else ctx.bg = c;
		},
		usedColor() {},
		mirror: () => [],
		pan() {},
		zoomAt() {},
		notify: (m) => notes.push(m),
		requestOverlay() {},
		setTool() {}
	};
	return { ctx, doc, history, notes };
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

function px(ctx: ToolContext, x: number, y: number): RGBA {
	const c = ctx.doc.getCel(ctx.layerId, ctx.frameId);
	if (!c) return [0, 0, 0, 0];
	const i = (y * ctx.doc.width + x) * 4;
	return [c[i], c[i + 1], c[i + 2], c[i + 3]];
}

function count(ctx: ToolContext) {
	const c = ctx.doc.getCel(ctx.layerId, ctx.frameId);
	if (!c) return 0;
	let n = 0;
	for (let i = 3; i < c.length; i += 4) if (c[i]) n++;
	return n;
}

describe('pencil', () => {
	it('draws a continuous 1px line as one undo step', () => {
		const { ctx, history } = makeCtx();
		drag(ctx, 'pencil', [
			[0.5, 0.5],
			[7.5, 0.5]
		]);
		expect(count(ctx)).toBe(8);
		expect(history.size).toBe(1);
		history.undo();
		expect(count(ctx)).toBe(0);
	});

	it('pixel-perfect mode removes L-shaped corners', () => {
		const { ctx } = makeCtx();
		drag(ctx, 'pencil', [
			[0.5, 0.5],
			[1.5, 0.5],
			[1.5, 1.5]
		]);
		// (1,0) is the inner corner of the L and is removed.
		expect(px(ctx, 1, 0)[3]).toBe(0);
		expect(px(ctx, 0, 0)[3]).toBe(255);
		expect(px(ctx, 1, 1)[3]).toBe(255);
	});

	it('respects the selection', () => {
		const { ctx } = makeCtx();
		ctx.selection.selectRect({ x: 0, y: 0, w: 4, h: 8 });
		drag(ctx, 'pencil', [
			[0.5, 2.5],
			[7.5, 2.5]
		]);
		expect(count(ctx)).toBe(4);
	});

	it('refuses to draw on locked or hidden layers', () => {
		const { ctx, notes, doc } = makeCtx();
		doc.getNode(ctx.layerId)!.locked = true;
		drag(ctx, 'pencil', [[1, 1]]);
		expect(count(ctx)).toBe(0);
		expect(notes[0]).toMatch(/locked/);
	});

	it('mirrors with symmetry', () => {
		const { ctx } = makeCtx();
		ctx.settings.symmetry = 'horizontal';
		ctx.mirror = (i) => {
			const x = i % 8,
				y = Math.floor(i / 8);
			return [y * 8 + (7 - x)];
		};
		drag(ctx, 'pencil', [[1.5, 1.5]]);
		expect(px(ctx, 1, 1)[3]).toBe(255);
		expect(px(ctx, 6, 1)[3]).toBe(255);
	});

	it('mirrors across the character with skin symmetry', () => {
		const { ctx } = makeCtx(64, 64, 'skin');
		const map = mirrorMap('classic');
		ctx.settings.symmetry = 'character';
		ctx.mirror = (i) => (map[i] >= 0 ? [map[i]] : []);
		drag(ctx, 'pencil', [[9.5, 12.5]]); // left eye area on the face
		expect(px(ctx, 9, 12)[3]).toBe(255);
		expect(px(ctx, 14, 12)[3]).toBe(255);
	});
});

describe('brush & eraser', () => {
	it('does not accumulate opacity when a stroke crosses itself', () => {
		const { ctx } = makeCtx();
		ctx.settings.brush = { ...ctx.settings.brush, size: 1, opacity: 0.5, hardness: 1 };
		drag(ctx, 'brush', [
			[2.5, 2.5],
			[5.5, 2.5],
			[2.5, 2.5]
		]);
		expect(px(ctx, 3, 2)[3]).toBe(128);
	});

	it('soft brush produces partial alpha at the edge', () => {
		const { ctx } = makeCtx(16, 16);
		ctx.settings.brush = { ...ctx.settings.brush, size: 8, hardness: 0 };
		drag(ctx, 'brush', [[8, 8]]);
		expect(px(ctx, 8, 8)[3]).toBeGreaterThan(200);
		const edge = px(ctx, 4, 8)[3];
		expect(edge).toBeGreaterThan(0);
		expect(edge).toBeLessThan(200);
	});

	it('erases to transparency', () => {
		const { ctx } = makeCtx();
		drag(ctx, 'pencil', [
			[0.5, 0.5],
			[7.5, 0.5]
		]);
		drag(ctx, 'eraser', [[3.5, 0.5]]);
		expect(px(ctx, 3, 0)[3]).toBe(0);
		expect(count(ctx)).toBe(7);
	});
});

describe('fill, shapes, eyedropper', () => {
	it('flood fills a bounded region only', () => {
		const { ctx } = makeCtx();
		drag(ctx, 'rect', [
			[0, 0],
			[4, 4]
		]); // outline 0..4
		ctx.fg = [0, 255, 0, 255];
		drag(ctx, 'fill', [[2, 2]]);
		expect(px(ctx, 2, 2)).toEqual([0, 255, 0, 255]);
		expect(px(ctx, 6, 6)[3]).toBe(0);
		expect(px(ctx, 0, 0)).toEqual([255, 0, 0, 255]);
	});

	it('shift-fill replaces every matching pixel', () => {
		const { ctx } = makeCtx();
		drag(ctx, 'fill', [[0, 0]], { shift: true });
		expect(count(ctx)).toBe(64);
	});

	it('draws a filled ellipse', () => {
		const { ctx } = makeCtx(16, 16);
		ctx.settings.shape.filled = true;
		drag(ctx, 'ellipse', [
			[2, 2],
			[12, 12]
		]);
		expect(px(ctx, 7, 7)[3]).toBe(255);
		expect(px(ctx, 2, 2)[3]).toBe(0);
	});

	it('picks a colour', () => {
		const { ctx } = makeCtx();
		drag(ctx, 'pencil', [[1, 1]]);
		ctx.fg = [0, 0, 0, 255];
		drag(ctx, 'eyedropper', [[1, 1]]);
		expect(ctx.fg).toEqual([255, 0, 0, 255]);
	});
});

describe('selection', () => {
	it('rect select with add/subtract and invert', () => {
		const { ctx } = makeCtx();
		drag(ctx, 'select-rect', [
			[0, 0],
			[3.5, 3.5]
		]);
		expect(ctx.selection.bounds).toEqual({ x: 0, y: 0, w: 4, h: 4 });
		drag(
			ctx,
			'select-rect',
			[
				[4, 4],
				[7.5, 7.5]
			],
			{ shift: true }
		);
		expect(ctx.selection.bounds).toEqual({ x: 0, y: 0, w: 8, h: 8 });
		drag(
			ctx,
			'select-rect',
			[
				[0, 0],
				[3.5, 3.5]
			],
			{ alt: true }
		);
		expect(ctx.selection.coverage(1, 1)).toBe(0);
		ctx.selection.invert();
		expect(ctx.selection.coverage(1, 1)).toBe(255);
		expect(ctx.selection.coverage(5, 5)).toBe(0);
	});

	it('lasso selects the polygon interior', () => {
		const { ctx } = makeCtx();
		drag(ctx, 'lasso', [
			[0, 0],
			[8, 0],
			[0, 8]
		]);
		expect(ctx.selection.coverage(1, 1)).toBe(255);
		expect(ctx.selection.coverage(7, 7)).toBe(0);
	});

	it('magic wand selects similar contiguous pixels', () => {
		const { ctx } = makeCtx();
		drag(ctx, 'pencil', [
			[0.5, 0.5],
			[7.5, 0.5]
		]);
		drag(ctx, 'wand', [[3, 0]]);
		expect(ctx.selection.bounds).toEqual({ x: 0, y: 0, w: 8, h: 1 });
	});

	it('moves selected pixels and the selection with one undo', () => {
		const { ctx, history } = makeCtx();
		drag(ctx, 'pencil', [[1.5, 1.5]]);
		ctx.selection.selectRect({ x: 1, y: 1, w: 1, h: 1 });
		drag(ctx, 'move', [
			[1.5, 1.5],
			[4.5, 3.5]
		]);
		expect(px(ctx, 1, 1)[3]).toBe(0);
		expect(px(ctx, 4, 3)[3]).toBe(255);
		expect(ctx.selection.bounds).toEqual({ x: 4, y: 3, w: 1, h: 1 });
		history.undo();
		expect(px(ctx, 1, 1)[3]).toBe(255);
		expect(px(ctx, 4, 3)[3]).toBe(0);
	});

	it('nudges with arrow keys', () => {
		const { ctx } = makeCtx();
		drag(ctx, 'pencil', [[1.5, 1.5]]);
		nudge(ctx, 1, 0);
		expect(px(ctx, 2, 1)[3]).toBe(255);
	});

	it('copy / paste into a new layer, delete, flip and rotate', () => {
		const { ctx, doc } = makeCtx();
		drag(ctx, 'pencil', [
			[0.5, 0.5],
			[2.5, 0.5]
		]); // 3px horizontal line at y=0
		ctx.selection.selectRect({ x: 0, y: 0, w: 3, h: 1 });
		const clip = copySelection(ctx)!;
		expect([clip.w, clip.h]).toEqual([3, 1]);
		const layer = pasteImage(ctx, clip);
		expect(doc.root).toContain(layer);
		expect(doc.getCel(layer, ctx.frameId)![3]).toBe(255);

		deleteSelection(ctx);
		expect(count(ctx)).toBe(0);

		const { ctx: c2 } = makeCtx();
		drag(c2, 'pencil', [[0.5, 3.5]]);
		c2.selection.selectRect({ x: 0, y: 3, w: 4, h: 1 });
		transformSelection(c2, 'flipH');
		expect(px(c2, 3, 3)[3]).toBe(255);
		expect(px(c2, 0, 3)[3]).toBe(0);
		transformSelection(c2, 'rotateCW');
		expect(c2.selection.bounds).toMatchObject({ w: 1, h: 4 });
		transformSelection(c2, { scale: [2, 8] });
		expect(c2.selection.bounds).toMatchObject({ w: 2, h: 8 });
	});
});
