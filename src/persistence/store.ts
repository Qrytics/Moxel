import { MoxelDocument } from '../core/document/document';
import type { DocKind, DocSnapshot, SkinModel, TextureType } from '../core/document/types';

/**
 * Local-first project storage. Projects live in the browser's IndexedDB and never leave the device
 * unless the user explicitly exports them or joins a live session.
 *
 * Two object stores so the project list can be read without deserialising every document:
 *   projects – ProjectMeta (small, includes a thumbnail data URL)
 *   docs     – { id, snapshot } with raw RGBA cels (structured clone handles typed arrays natively)
 *   settings – arbitrary key/value (palettes, preferences, recent colours…)
 */

export interface ProjectMeta {
	id: string;
	name: string;
	kind: DocKind;
	width: number;
	height: number;
	model?: SkinModel;
	textureType?: TextureType;
	frameCount: number;
	layerCount: number;
	createdAt: number;
	updatedAt: number;
	thumbnail?: string;
	/** Set on copies of a live shared canvas. */
	live?: boolean;
}

export interface ProjectStore {
	readonly persistent: boolean;
	list(): Promise<ProjectMeta[]>;
	getMeta(id: string): Promise<ProjectMeta | undefined>;
	load(id: string): Promise<MoxelDocument | null>;
	save(doc: MoxelDocument, extra?: { thumbnail?: string; live?: boolean }): Promise<ProjectMeta>;
	rename(id: string, name: string): Promise<void>;
	duplicate(id: string): Promise<ProjectMeta | null>;
	delete(id: string): Promise<void>;
	getSetting<T>(key: string): Promise<T | undefined>;
	setSetting<T>(key: string, value: T): Promise<void>;
}

export class StorageUnavailableError extends Error {}

export const STORAGE_UNAVAILABLE_MESSAGE =
	"Local storage isn't available. You can continue editing, but make sure to export your project before closing this page.";

export const DB_NAME = 'moxel';
const DB_VERSION = 1;

function req<T>(r: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
	});
}

export function metaFromDoc(doc: MoxelDocument, prev?: ProjectMeta): ProjectMeta {
	return {
		id: doc.meta.id,
		name: doc.meta.name,
		kind: doc.meta.kind,
		width: doc.width,
		height: doc.height,
		model: doc.meta.skin?.model,
		textureType: doc.meta.texture?.type,
		frameCount: doc.frames.length,
		layerCount: doc.layersBottomUp().length,
		createdAt: doc.meta.createdAt,
		updatedAt: doc.meta.updatedAt,
		thumbnail: prev?.thumbnail,
		live: prev?.live
	};
}

export class IDBProjectStore implements ProjectStore {
	readonly persistent = true;
	private constructor(private db: IDBDatabase) {}

	static async open(name = DB_NAME): Promise<IDBProjectStore> {
		if (typeof indexedDB === 'undefined') throw new StorageUnavailableError('IndexedDB is not available');
		try {
			const open = indexedDB.open(name, DB_VERSION);
			open.onupgradeneeded = () => {
				const db = open.result;
				if (!db.objectStoreNames.contains('projects')) {
					const s = db.createObjectStore('projects', { keyPath: 'id' });
					s.createIndex('updatedAt', 'updatedAt');
				}
				if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
				if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
			};
			const db = await req(open);
			// Another tab upgrading the schema later shouldn't be blocked by us.
			db.onversionchange = () => db.close();
			return new IDBProjectStore(db);
		} catch (e) {
			throw new StorageUnavailableError(e instanceof Error ? e.message : String(e));
		}
	}

	async list(): Promise<ProjectMeta[]> {
		const tx = this.db.transaction('projects', 'readonly');
		const all = await req(tx.objectStore('projects').getAll() as IDBRequest<ProjectMeta[]>);
		return all.sort((a, b) => b.updatedAt - a.updatedAt);
	}

	async getMeta(id: string) {
		const tx = this.db.transaction('projects', 'readonly');
		return req(tx.objectStore('projects').get(id) as IDBRequest<ProjectMeta | undefined>);
	}

	async load(id: string): Promise<MoxelDocument | null> {
		const tx = this.db.transaction('docs', 'readonly');
		const row = await req(
			tx.objectStore('docs').get(id) as IDBRequest<{ id: string; snapshot: DocSnapshot } | undefined>
		);
		return row ? MoxelDocument.fromSnapshot(row.snapshot) : null;
	}

	async save(doc: MoxelDocument, extra: { thumbnail?: string; live?: boolean } = {}): Promise<ProjectMeta> {
		const prev = await this.getMeta(doc.meta.id);
		const meta = metaFromDoc(doc, prev);
		if (extra.thumbnail) meta.thumbnail = extra.thumbnail;
		if (extra.live !== undefined) meta.live = extra.live;
		const tx = this.db.transaction(['projects', 'docs'], 'readwrite');
		tx.objectStore('projects').put(meta);
		// `put` structured-clones synchronously, so sharing the live cel buffers here is safe.
		tx.objectStore('docs').put({ id: doc.meta.id, snapshot: doc.toSnapshot(false) });
		await done(tx);
		return meta;
	}

	async rename(id: string, name: string) {
		const tx = this.db.transaction(['projects', 'docs'], 'readwrite');
		const projects = tx.objectStore('projects');
		const docs = tx.objectStore('docs');
		const meta = await req(projects.get(id) as IDBRequest<ProjectMeta | undefined>);
		const row = await req(docs.get(id) as IDBRequest<{ id: string; snapshot: DocSnapshot } | undefined>);
		if (meta) projects.put({ ...meta, name, updatedAt: Date.now() });
		if (row) {
			row.snapshot.meta.name = name;
			docs.put(row);
		}
		await done(tx);
	}

	async duplicate(id: string): Promise<ProjectMeta | null> {
		const doc = await this.load(id);
		const prev = await this.getMeta(id);
		if (!doc) return null;
		const copy = doc.clone(true);
		copy.meta.name = `${doc.meta.name} copy`;
		copy.meta.createdAt = copy.meta.updatedAt = Date.now();
		return this.save(copy, { thumbnail: prev?.thumbnail });
	}

	async delete(id: string) {
		const tx = this.db.transaction(['projects', 'docs'], 'readwrite');
		tx.objectStore('projects').delete(id);
		tx.objectStore('docs').delete(id);
		await done(tx);
	}

	async getSetting<T>(key: string): Promise<T | undefined> {
		const tx = this.db.transaction('settings', 'readonly');
		return req(tx.objectStore('settings').get(key) as IDBRequest<T | undefined>);
	}

	async setSetting<T>(key: string, value: T) {
		const tx = this.db.transaction('settings', 'readwrite');
		tx.objectStore('settings').put(value, key);
		await done(tx);
	}

	close() {
		this.db.close();
	}
}

/** Fallback when IndexedDB is unavailable (private mode in some browsers, blocked storage). */
export class MemoryProjectStore implements ProjectStore {
	readonly persistent = false;
	private metas = new Map<string, ProjectMeta>();
	private docs = new Map<string, DocSnapshot>();
	private settings = new Map<string, unknown>();

	async list() {
		return [...this.metas.values()].sort((a, b) => b.updatedAt - a.updatedAt);
	}
	async getMeta(id: string) {
		return this.metas.get(id);
	}
	async load(id: string) {
		const s = this.docs.get(id);
		return s ? MoxelDocument.fromSnapshot(s) : null;
	}
	async save(doc: MoxelDocument, extra: { thumbnail?: string; live?: boolean } = {}) {
		const meta = metaFromDoc(doc, this.metas.get(doc.meta.id));
		if (extra.thumbnail) meta.thumbnail = extra.thumbnail;
		if (extra.live !== undefined) meta.live = extra.live;
		this.metas.set(meta.id, meta);
		this.docs.set(meta.id, doc.toSnapshot(true));
		return meta;
	}
	async rename(id: string, name: string) {
		const m = this.metas.get(id);
		if (m) this.metas.set(id, { ...m, name });
		const s = this.docs.get(id);
		if (s) s.meta.name = name;
	}
	async duplicate(id: string) {
		const d = await this.load(id);
		if (!d) return null;
		const c = d.clone(true);
		c.meta.name = `${d.meta.name} copy`;
		return this.save(c, { thumbnail: this.metas.get(id)?.thumbnail });
	}
	async delete(id: string) {
		this.metas.delete(id);
		this.docs.delete(id);
	}
	async getSetting<T>(key: string) {
		return this.settings.get(key) as T | undefined;
	}
	async setSetting<T>(key: string, value: T) {
		this.settings.set(key, value);
	}
}

/** Open IndexedDB, falling back to memory. Also asks the browser not to evict our data. */
export async function openProjectStore(): Promise<{ store: ProjectStore; error?: string }> {
	try {
		const store = await IDBProjectStore.open();
		try {
			await navigator.storage?.persist?.();
		} catch {
			/* best effort */
		}
		return { store };
	} catch {
		return { store: new MemoryProjectStore(), error: STORAGE_UNAVAILABLE_MESSAGE };
	}
}
