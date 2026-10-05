import { openProjectStore, type ProjectMeta, type ProjectStore } from '../persistence/store';
import { BUILTIN_PALETTES, type Palette } from '../color/color';
import type { BrushPreset } from '../core/tools/brushPresets';

export type Route =
	| { name: 'home' }
	| { name: 'editor'; id: string }
	| { name: 'join'; room: string; mode: 'together' | 'side' };

export interface Toast {
	id: number;
	message: string;
	kind: 'info' | 'success' | 'error';
	action?: { label: string; run: () => void };
}

export interface UserSettings {
	welcomeSeen: boolean;
	palettes: Palette[];
	recentColors: string[];
	lastOpenProject: string | null;
	displayName: string;
	cursorColor: string;
	/** Brushes saved from paint projects; shared by every project. */
	paintPresets: BrushPreset[];
}

const PEER_COLORS = ['#ff8f6b', '#7ee0a1', '#ffd36b', '#b494ff', '#6bd3ff', '#ff7ab8'];

function parseRoute(hash: string): Route {
	const h = hash.replace(/^#/, '');
	const [path, query] = h.split('?');
	const parts = path.split('/').filter(Boolean);
	if (parts[0] === 'p' && parts[1]) return { name: 'editor', id: decodeURIComponent(parts[1]) };
	if (parts[0] === 'join' && parts[1] && /^[a-f0-9]{16,64}$/.test(parts[1])) {
		const mode = new URLSearchParams(query ?? '').get('mode') === 'side' ? 'side' : 'together';
		return { name: 'join', room: parts[1], mode };
	}
	return { name: 'home' };
}

/** Application-wide state: storage, routing, toasts and user settings. */
class AppState {
	store: ProjectStore | null = null;
	ready = $state(false);
	storageError = $state<string | null>(null);
	projects = $state<ProjectMeta[]>([]);
	route = $state<Route>(parseRoute(location.hash));
	toasts = $state<Toast[]>([]);
	online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
	settings = $state<UserSettings>({
		welcomeSeen: false,
		palettes: [],
		recentColors: [],
		lastOpenProject: null,
		displayName: '',
		cursorColor: PEER_COLORS[Math.floor(Math.random() * PEER_COLORS.length)],
		paintPresets: []
	});
	private toastId = 0;

	async init() {
		const { store, error } = await openProjectStore();
		this.store = store;
		this.storageError = error ?? null;
		const saved = await store.getSetting<Partial<UserSettings>>('user');
		if (saved) this.settings = { ...this.settings, ...saved };
		await this.refreshProjects();
		window.addEventListener('hashchange', () => (this.route = parseRoute(location.hash)));
		window.addEventListener('online', () => (this.online = true));
		window.addEventListener('offline', () => (this.online = false));
		this.ready = true;
	}

	async refreshProjects() {
		if (!this.store) return;
		try {
			this.projects = await this.store.list();
		} catch (e) {
			this.toast(`Couldn't read your projects: ${e instanceof Error ? e.message : e}`, 'error');
		}
	}

	navigate(r: Route) {
		const hash =
			r.name === 'home'
				? '#/'
				: r.name === 'editor'
					? `#/p/${encodeURIComponent(r.id)}`
					: `#/join/${r.room}?mode=${r.mode}`;
		if (location.hash !== hash) location.hash = hash;
		this.route = r;
	}

	async saveSettings(patch: Partial<UserSettings>) {
		this.settings = { ...this.settings, ...patch };
		try {
			await this.store?.setSetting('user', $state.snapshot(this.settings));
		} catch {
			/* settings are a convenience; failing to persist them must not interrupt editing */
		}
	}

	get palettes(): Palette[] {
		return [...BUILTIN_PALETTES, ...this.settings.palettes];
	}

	toast(
		message: string,
		kind: Toast['kind'] = 'info',
		action?: Toast['action'],
		ms = kind === 'error' ? 7000 : 3200
	) {
		const id = ++this.toastId;
		this.toasts = [...this.toasts.slice(-3), { id, message, kind, action }];
		setTimeout(() => this.dismiss(id), ms);
	}

	dismiss(id: number) {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}
}

export const app = new AppState();
export { PEER_COLORS };
