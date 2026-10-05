import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoxelDocument } from '../src/core/document/document';
import { IDBProjectStore, MemoryProjectStore } from '../src/persistence/store';
import { Autosaver, type AutosaveState } from '../src/persistence/autosave';

let n = 0;
async function freshStore() {
	return IDBProjectStore.open(`moxel-test-${n++}`);
}

function makeDoc(name = 'Steve Skin') {
	const doc = MoxelDocument.create({ name, kind: 'skin', width: 64, height: 64, model: 'slim' });
	doc.ensureCel(doc.root[0], doc.frames[0].id).set([10, 20, 30, 255], 0);
	return doc;
}

describe('IndexedDB project store', () => {
	it('creates, saves, lists and loads a project', async () => {
		const store = await freshStore();
		const doc = makeDoc();
		const meta = await store.save(doc, { thumbnail: 'data:image/png;base64,xx' });
		expect(meta.name).toBe('Steve Skin');
		expect(meta.model).toBe('slim');

		const list = await store.list();
		expect(list.map((m) => m.id)).toEqual([doc.meta.id]);

		const loaded = (await store.load(doc.meta.id))!;
		expect(loaded.meta.skin?.model).toBe('slim');
		expect(Array.from(loaded.getCel(loaded.root[0], loaded.frames[0].id)!.subarray(0, 4))).toEqual([10, 20, 30, 255]);
		expect((await store.getMeta(doc.meta.id))?.thumbnail).toContain('data:image');
	});

	it('persists across connections (simulated browser restart)', async () => {
		const name = `moxel-restart-${n++}`;
		const a = await IDBProjectStore.open(name);
		const doc = makeDoc('Persisted');
		await a.save(doc);
		a.close();
		const b = await IDBProjectStore.open(name);
		expect((await b.list())[0].name).toBe('Persisted');
		expect(await b.load(doc.meta.id)).not.toBeNull();
	});

	it('renames, duplicates and deletes', async () => {
		const store = await freshStore();
		const doc = makeDoc();
		await store.save(doc);
		await store.rename(doc.meta.id, 'Alex Skin');
		expect((await store.load(doc.meta.id))!.meta.name).toBe('Alex Skin');

		const copy = (await store.duplicate(doc.meta.id))!;
		expect(copy.id).not.toBe(doc.meta.id);
		expect(copy.name).toBe('Alex Skin copy');
		expect(await store.list()).toHaveLength(2);

		await store.delete(doc.meta.id);
		const list = await store.list();
		expect(list.map((m) => m.id)).toEqual([copy.id]);
		expect(await store.load(doc.meta.id)).toBeNull();
	});

	it('stores settings', async () => {
		const store = await freshStore();
		await store.setSetting('palettes', [{ name: 'Mine', colors: ['#ff0000'] }]);
		expect(await store.getSetting('palettes')).toEqual([{ name: 'Mine', colors: ['#ff0000'] }]);
	});

	it('memory fallback store behaves the same', async () => {
		const store = new MemoryProjectStore();
		const doc = makeDoc();
		await store.save(doc);
		expect(store.persistent).toBe(false);
		expect((await store.load(doc.meta.id))!.meta.name).toBe('Steve Skin');
	});
});

describe('autosave', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('debounces edits into a single write', async () => {
		const store = new MemoryProjectStore();
		const save = vi.spyOn(store, 'save');
		const doc = makeDoc();
		const states: AutosaveState['status'][] = [];
		const a = new Autosaver(store, doc, { delay: 500, maxWait: 5000, onChange: (s) => states.push(s.status) });
		for (let i = 0; i < 10; i++) {
			a.markDirty();
			await vi.advanceTimersByTimeAsync(100);
		}
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(600);
		expect(save).toHaveBeenCalledTimes(1);
		expect(a.state.status).toBe('memory');
		expect(states).toContain('saving');
	});

	it('caps the wait during continuous editing', async () => {
		const store = new MemoryProjectStore();
		const save = vi.spyOn(store, 'save');
		const a = new Autosaver(store, makeDoc(), { delay: 500, maxWait: 1000 });
		for (let i = 0; i < 15; i++) {
			a.markDirty();
			await vi.advanceTimersByTimeAsync(100);
		}
		expect(save.mock.calls.length).toBeGreaterThanOrEqual(1);
	});

	it('flushes immediately and records the timestamp', async () => {
		vi.useRealTimers();
		const store = await freshStore();
		const doc = makeDoc('Flushed');
		const a = new Autosaver(store, doc, { delay: 10_000 });
		a.markDirty();
		await a.flush();
		expect(a.state.status).toBe('saved');
		expect(a.state.lastSaved).not.toBeNull();
		expect((await store.list())[0].name).toBe('Flushed');
	});

	it('reports errors without losing the dirty document', async () => {
		vi.useRealTimers();
		const store = new MemoryProjectStore();
		vi.spyOn(store, 'save').mockRejectedValueOnce(new Error('QuotaExceededError'));
		const a = new Autosaver(store, makeDoc());
		a.markDirty();
		await a.flush();
		expect(a.state.status).toBe('error');
		await a.retry();
		expect(a.state.status).toBe('memory');
	});
});
