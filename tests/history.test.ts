import { describe, expect, it } from 'vitest';
import { MoxelDocument } from '../src/core/document/document';
import { History, Transaction } from '../src/core/history/history';
import { applyOp, invertPatch } from '../src/core/document/ops';
import { readRect } from '../src/core/document/pixels';

function setup() {
	const doc = MoxelDocument.create({ name: 'H', kind: 'canvas', width: 4, height: 4 });
	return { doc, history: new History(doc), layer: doc.root[0], frame: doc.frames[0].id };
}

describe('history', () => {
	it('treats one stroke as one undo step', () => {
		const { doc, history, layer, frame } = setup();
		const cel = doc.ensureCel(layer, frame);
		const rect = { x: 0, y: 0, w: 4, h: 1 };
		const before = readRect(cel, 4, rect);
		// Simulate a stroke painting four pixels live, then committing once.
		for (let i = 0; i < 4; i++) cel.set([255, 255, 255, 255], i * 4);
		const after = readRect(cel, 4, rect);
		const tx = new Transaction(doc);
		tx.recordApplied(
			{ t: 'patch', layerId: layer, frameId: frame, rect, data: after },
			invertPatch(layer, frame, rect, before, after)
		);
		history.commit('Brush', tx);
		expect(history.size).toBe(1);
		history.undo();
		expect(cel[3]).toBe(0);
		expect(cel[15]).toBe(0);
		history.redo();
		expect(cel[15]).toBe(255);
	});

	it('clears redo after a new action and reports labels', () => {
		const { doc, history } = setup();
		history.transact('Rename', (tx) => tx.apply({ t: 'setMeta', props: { name: 'A' } }));
		history.transact('Rename', (tx) => tx.apply({ t: 'setMeta', props: { name: 'B' } }));
		history.undo();
		expect(doc.meta.name).toBe('A');
		expect(history.redoLabel).toBe('Rename');
		history.transact('Rename', (tx) => tx.apply({ t: 'setMeta', props: { name: 'C' } }));
		expect(history.canRedo).toBe(false);
	});

	it('merges rapid slider changes into one entry', () => {
		const { doc, history, layer } = setup();
		for (const o of [0.9, 0.8, 0.7])
			history.transact('Opacity', (tx) => tx.apply({ t: 'setNode', id: layer, props: { opacity: o } }), 'op');
		expect(history.size).toBe(1);
		history.undo();
		expect(doc.getNode(layer)!.opacity).toBe(1);
	});

	it('bounds entry count', () => {
		const doc = MoxelDocument.create({ name: 'H', kind: 'canvas', width: 2, height: 2 });
		const history = new History(doc, { maxEntries: 3 });
		for (let i = 0; i < 10; i++) history.transact('x', (tx) => tx.apply({ t: 'setMeta', props: { name: `${i}` } }));
		expect(history.size).toBe(3);
	});

	it('conditional patch undo leaves pixels that changed since', () => {
		const { doc, layer, frame } = setup();
		const rect = { x: 0, y: 0, w: 1, h: 1 };
		const red = new Uint8ClampedArray([255, 0, 0, 255]);
		const inv = applyOp(doc, { t: 'patch', layerId: layer, frameId: frame, rect, data: red })!;
		// A peer paints blue over the same pixel afterwards.
		applyOp(doc, { t: 'patch', layerId: layer, frameId: frame, rect, data: new Uint8ClampedArray([0, 0, 255, 255]) });
		applyOp(doc, inv);
		expect(Array.from(doc.getCel(layer, frame)!.subarray(0, 4))).toEqual([0, 0, 255, 255]);
	});

	it('notifies onApplied for do/undo/redo', () => {
		const { history } = setup();
		const kinds: string[] = [];
		history.onApplied = (_ops, kind) => kinds.push(kind);
		history.transact('x', (tx) => tx.apply({ t: 'setMeta', props: { name: 'z' } }));
		history.undo();
		history.redo();
		expect(kinds).toEqual(['do', 'undo', 'redo']);
	});
});
