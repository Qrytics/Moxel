import { describe, expect, it } from 'vitest';
import { MoxelDocument } from '../src/core/document/document';
import { DocCommands } from '../src/core/document/commands';
import { History } from '../src/core/history/history';
import { compositeFrame } from '../src/core/render/composite';

function setup(w = 4, h = 4) {
	const doc = MoxelDocument.create({ name: 'Test', kind: 'canvas', width: w, height: h });
	const history = new History(doc);
	const cmd = new DocCommands(doc, history);
	return { doc, history, cmd, frame: doc.frames[0].id };
}

function fill(doc: MoxelDocument, layerId: string, frameId: string, rgba: [number, number, number, number]) {
	const c = doc.ensureCel(layerId, frameId);
	for (let i = 0; i < c.length; i += 4) c.set(rgba, i);
}

describe('document & layers', () => {
	it('creates a project with one layer and one frame', () => {
		const { doc } = setup();
		expect(doc.layersBottomUp()).toHaveLength(1);
		expect(doc.frames).toHaveLength(1);
		expect(doc.meta.kind).toBe('canvas');
	});

	it('creates, deletes and reorders layers with undo/redo', () => {
		const { doc, cmd, history } = setup();
		const base = doc.root[0];
		const a = cmd.addLayer('A');
		const b = cmd.addLayer('B');
		expect(doc.root).toEqual([base, a, b]);

		cmd.nudge(b, -1);
		expect(doc.root).toEqual([base, b, a]);
		cmd.moveNode(base, null, 2);
		expect(doc.root).toEqual([b, a, base]);

		history.undo();
		history.undo();
		expect(doc.root).toEqual([base, a, b]);
		history.redo();
		expect(doc.root).toEqual([base, b, a]);

		expect(cmd.deleteNode(a)).toBe(true);
		expect(doc.getNode(a)).toBeUndefined();
		history.undo();
		expect(doc.getNode(a)?.name).toBe('A');
	});

	it('refuses to delete the last layer', () => {
		const { doc, cmd } = setup();
		expect(cmd.deleteNode(doc.root[0])).toBe(false);
		expect(doc.layersBottomUp()).toHaveLength(1);
	});

	it('restores pixels of a deleted layer on undo', () => {
		const { doc, cmd, history, frame } = setup();
		const a = cmd.addLayer('A');
		fill(doc, a, frame, [255, 0, 0, 255]);
		cmd.deleteNode(a);
		history.undo();
		expect(doc.getCel(a, frame)![0]).toBe(255);
	});

	it('groups, duplicates and ungroups', () => {
		const { doc, cmd, frame } = setup();
		const l = doc.root[0];
		fill(doc, l, frame, [0, 255, 0, 255]);
		const g = cmd.groupNode(l)!;
		expect(doc.root).toEqual([g]);
		expect(doc.parentOf(l)).toBe(g);

		const copy = cmd.duplicateNode(g)!;
		const copyGroup = doc.getNode(copy);
		expect(copyGroup?.type).toBe('group');
		const child = copyGroup!.type === 'group' ? copyGroup!.children[0] : '';
		expect(child).not.toBe(l);
		expect(doc.getCel(child, frame)![1]).toBe(255);

		cmd.ungroup(g);
		expect(doc.root[0]).toBe(l);
		expect(doc.getNode(g)).toBeUndefined();
	});

	it('cannot move a group into its own descendant', () => {
		const { doc, cmd } = setup();
		const outer = cmd.addGroup('Outer');
		const inner = cmd.addGroup('Inner', outer);
		expect(doc.parentOf(inner)).toBe(outer);
		cmd.moveNode(outer, inner, 0);
		expect(doc.parentOf(outer)).toBe(null);
	});

	it('merges down respecting opacity and flattens', () => {
		const { doc, cmd, frame } = setup(2, 1);
		const base = doc.root[0];
		fill(doc, base, frame, [0, 0, 255, 255]);
		const top = cmd.addLayer('Top');
		fill(doc, top, frame, [255, 0, 0, 255]);
		cmd.setNodeProps(top, { opacity: 0.5 });
		const merged = cmd.mergeDown(top)!;
		expect(merged).toBe(base);
		const px = doc.getCel(base, frame)!;
		expect(px[0]).toBeGreaterThan(120);
		expect(px[2]).toBeGreaterThan(120);
		expect(doc.layersBottomUp()).toHaveLength(1);

		cmd.addLayer('Another');
		const flat = cmd.flatten();
		expect(doc.root).toEqual([flat]);
		expect(compositeFrame(doc, frame)[3]).toBe(255);
	});

	it('round-trips through a snapshot', () => {
		const { doc, cmd, frame } = setup();
		const a = cmd.addLayer('A');
		fill(doc, a, frame, [1, 2, 3, 4]);
		cmd.addFrame(frame, true);
		const copy = MoxelDocument.fromSnapshot(doc.toSnapshot());
		expect(copy.root).toEqual(doc.root);
		expect(copy.frames).toHaveLength(2);
		expect(copy.getCel(a, copy.frames[1].id)![3]).toBe(4);
	});
});

describe('frames', () => {
	it('adds, duplicates, reorders and deletes frames', () => {
		const { doc, cmd, history, frame } = setup();
		const l = doc.root[0];
		fill(doc, l, frame, [9, 9, 9, 255]);
		const dup = cmd.addFrame(frame, true);
		expect(doc.getCel(l, dup)![0]).toBe(9);
		const blank = cmd.addFrame(dup, false);
		expect(doc.getCel(l, blank)).toBeUndefined();
		cmd.moveFrame(blank, 0);
		expect(doc.frames[0].id).toBe(blank);
		cmd.deleteFrame(dup);
		expect(doc.frames).toHaveLength(2);
		history.undo();
		expect(doc.frames.map((f) => f.id)).toContain(dup);
		expect(doc.getCel(l, dup)![0]).toBe(9);
	});

	it('never deletes the last frame', () => {
		const { cmd, frame } = setup();
		expect(cmd.deleteFrame(frame)).toBe(false);
	});
});

describe('canvas transforms', () => {
	it('resizes, rotates and flips with undo', () => {
		const { doc, cmd, history, frame } = setup(2, 1);
		const l = doc.root[0];
		const c = doc.ensureCel(l, frame);
		c.set([255, 0, 0, 255], 0); // red at (0,0)
		cmd.rotateCanvas(1);
		expect([doc.width, doc.height]).toEqual([1, 2]);
		expect(doc.getCel(l, frame)![3]).toBe(255); // (0,0) → (0,0) after cw rotate of a 2x1
		cmd.flipCanvas('v');
		expect(doc.getCel(l, frame)![7]).toBe(255);
		cmd.resizeCanvas(4, 4, 0, 0);
		expect(doc.width).toBe(4);
		history.undo();
		history.undo();
		history.undo();
		expect([doc.width, doc.height]).toEqual([2, 1]);
		expect(doc.getCel(l, frame)![3]).toBe(255);
	});
});
