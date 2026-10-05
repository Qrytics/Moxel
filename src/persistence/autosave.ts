import type { MoxelDocument } from '../core/document/document';
import type { ProjectStore } from './store';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'memory';

export interface AutosaveState {
	status: SaveStatus;
	lastSaved: number | null;
	error?: string;
}

export interface AutosaveOptions {
	/** Quiet period after the last edit before writing. */
	delay?: number;
	/** Upper bound on how long continuous editing can postpone a save. */
	maxWait?: number;
	thumbnail?: (doc: MoxelDocument) => string | undefined | Promise<string | undefined>;
	onChange?: (s: AutosaveState) => void;
	live?: boolean;
}

/**
 * Debounced autosave. Edits call `markDirty()`; a write happens `delay` ms after the last one, or
 * at most every `maxWait` ms during continuous drawing, so IndexedDB isn't hit on every pointer move.
 * `flush()` writes immediately — used on tab hide/close and before navigating away.
 */
export class Autosaver {
	state: AutosaveState = { status: 'idle', lastSaved: null };
	private timer: ReturnType<typeof setTimeout> | null = null;
	private firstDirty = 0;
	private saving: Promise<void> | null = null;
	private dirtyDuringSave = false;
	private disposed = false;
	readonly delay: number;
	readonly maxWait: number;

	constructor(
		private store: ProjectStore,
		private doc: MoxelDocument,
		private opts: AutosaveOptions = {}
	) {
		this.delay = opts.delay ?? 800;
		this.maxWait = opts.maxWait ?? 5000;
	}

	get dirty() {
		return this.state.status === 'pending' || this.dirtyDuringSave;
	}

	markDirty(): void {
		if (this.disposed) return;
		if (this.saving) {
			this.dirtyDuringSave = true;
			return;
		}
		const now = Date.now();
		if (this.state.status !== 'pending') {
			this.firstDirty = now;
			this.set({ status: 'pending' });
		}
		if (this.timer) clearTimeout(this.timer);
		const wait = Math.max(0, Math.min(this.delay, this.firstDirty + this.maxWait - now));
		this.timer = setTimeout(() => void this.flush(), wait);
	}

	async flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.saving) {
			await this.saving;
			if (this.dirtyDuringSave) return this.flush();
			return;
		}
		if (this.state.status !== 'pending') return;
		this.set({ status: 'saving' });
		this.saving = (async () => {
			try {
				const thumbnail = await this.opts.thumbnail?.(this.doc);
				await this.store.save(this.doc, { thumbnail, live: this.opts.live });
				this.set({ status: this.store.persistent ? 'saved' : 'memory', lastSaved: Date.now(), error: undefined });
			} catch (e) {
				this.set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
			}
		})();
		await this.saving;
		this.saving = null;
		if (this.dirtyDuringSave && !this.disposed) {
			this.dirtyDuringSave = false;
			this.markDirty();
		}
	}

	/** Retry after an error. */
	retry() {
		this.set({ status: 'pending' });
		return this.flush();
	}

	dispose() {
		this.disposed = true;
		if (this.timer) clearTimeout(this.timer);
	}

	private set(p: Partial<AutosaveState>) {
		this.state = { ...this.state, ...p };
		this.opts.onChange?.(this.state);
	}
}
