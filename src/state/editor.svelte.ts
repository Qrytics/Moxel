import { DocCommands } from '../core/document/commands';
import type { ChangeEvent, MoxelDocument } from '../core/document/document';
import { applyOp, type Op } from '../core/document/ops';
import { History, type CommitKind } from '../core/history/history';
import { CompositeCache } from '../core/render/compositeCache';
import { fitView, unrotate, unrotateDelta, zoomViewAt, type ViewState } from '../core/render/canvasRenderer';
import { Selection } from '../core/selection/selection';
import { TOOL_INFO, TOOLS, toolAvailable } from '../core/tools/registry';
import {
	copySelection,
	cutSelection,
	deleteSelection,
	pasteImage,
	tipFromSelection,
	transformSelection,
	type ClipboardImage
} from '../core/tools/editActions';
import { nudge } from '../core/tools/otherTools';
import {
	defaultToolSettings,
	type RGBA,
	type ToolContext,
	type ToolId,
	type ToolOverlay,
	type ToolSettings
} from '../core/tools/types';
import { mirrorMap } from '../minecraft/uv';
import { parseHex, toHex } from '../color/color';
import { Autosaver, type AutosaveState } from '../persistence/autosave';
import type { ProjectStore } from '../persistence/store';
import { renderThumbnail } from './thumbnail';
import { app } from './app.svelte';

export type Workspace = '2d' | 'split' | '3d';

export interface DisplaySettings {
	pixelGrid: boolean;
	tileGrid: number;
	guides: boolean;
	guideLabels: boolean;
	dimOverlay: boolean;
	transparency: 'checker' | 'solid';
	background: string;
}

/** Hook a live session installs to see local edits and share cursor positions. */
export interface RemoteHook {
	onLocalOps(ops: Op[], kind: CommitKind, inverses: Op[]): void;
	onCursor(x: number, y: number): void;
	onDocChanged?(e: ChangeEvent): void;
}

export interface PeerCursor {
	id: string;
	name: string;
	color: string;
	x: number;
	y: number;
}

/**
 * The editor controller for one open document. Plain TypeScript objects (document, history,
 * selection, caches) are deliberately *not* reactive — pixel data changes thousands of times per
 * stroke — and the UI instead watches a few cheap version counters.
 */
export class EditorState {
	readonly history: History;
	readonly cmd: DocCommands;
	readonly selection: Selection;
	cache: CompositeCache;
	autosave: Autosaver;

	structureVersion = $state(0);
	pixelsVersion = $state(0);
	historyVersion = $state(0);
	selectionVersion = $state(0);
	overlayVersion = $state(0);
	metaVersion = $state(0);

	activeLayerId = $state('');
	activeFrameId = $state('');
	tool = $state<ToolId>('pencil');
	settings = $state<ToolSettings>(defaultToolSettings());
	fg = $state<RGBA>([0, 0, 0, 255]);
	bg = $state<RGBA>([255, 255, 255, 255]);
	save = $state<AutosaveState>({ status: 'idle', lastSaved: null });
	workspace = $state<Workspace>('split');
	display = $state<DisplaySettings>({
		pixelGrid: true,
		tileGrid: 0,
		guides: true,
		guideLabels: true,
		dimOverlay: false,
		transparency: 'checker',
		background: '#ffffff'
	});
	view = $state<ViewState>({ zoom: 8, ox: 0, oy: 0 });
	hover = $state<{ x: number; y: number } | null>(null);
	playing = $state(false);
	showTimeline = $state(false);
	peers = $state<PeerCursor[]>([]);
	notice = $state<string | null>(null);

	overlay: ToolOverlay = {};
	clipboard: ClipboardImage | null = null;
	remote: RemoteHook | null = null;
	peerId: string | undefined;
	readonly ctx: ToolContext;

	private mirrorCache: { key: string; map: Int32Array } | null = null;
	private viewport = { w: 800, h: 600 };
	private unsubs: (() => void)[] = [];
	private pixelTimer: ReturnType<typeof setTimeout> | null = null;
	private playTimer: ReturnType<typeof setTimeout> | null = null;
	private noticeTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		public doc: MoxelDocument,
		private store: ProjectStore,
		opts: { live?: boolean } = {}
	) {
		this.history = new History(doc, {
			onApplied: (ops, kind, _label, inverses) => this.remote?.onLocalOps(ops, kind, inverses)
		});
		this.cmd = new DocCommands(doc, this.history);
		this.selection = new Selection(doc.width, doc.height);
		this.cache = new CompositeCache(doc, doc.frames[0].id);
		this.autosave = this.makeAutosaver(opts.live);
		this.restoreEditorState();
		this.showTimeline = doc.frames.length > 1;

		this.unsubs.push(
			doc.subscribe((e) => this.onDocChange(e)),
			this.history.subscribe(() => this.historyVersion++),
			this.selection.subscribe(() => this.selectionVersion++)
		);

		// Tools see the editor through this narrow interface.
		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;
		this.ctx = {
			get doc() {
				return self.doc;
			},
			history: this.history,
			cmd: this.cmd,
			selection: this.selection,
			get layerId() {
				return self.activeLayerId;
			},
			get frameId() {
				return self.activeFrameId;
			},
			get peerId() {
				return self.peerId;
			},
			get settings() {
				return self.settings;
			},
			get fg() {
				return $state.snapshot(self.fg) as RGBA;
			},
			set fg(c: RGBA) {
				self.fg = c;
			},
			get bg() {
				return $state.snapshot(self.bg) as RGBA;
			},
			set bg(c: RGBA) {
				self.bg = c;
			},
			overlay: this.overlay,
			setColor: (c, which) => this.setColor(c, which),
			usedColor: (c) => this.pushRecent(c),
			mirror: (i) => this.mirror(i),
			pan: (dx, dy) => this.pan(dx, dy),
			zoomAt: (f, sx, sy) => this.zoomAt(f, sx, sy),
			notify: (m) => this.flashNotice(m),
			requestOverlay: () => this.overlayVersion++,
			setTool: (id) => this.setTool(id)
		};
	}

	private makeAutosaver(live?: boolean) {
		return new Autosaver(this.store, this.doc, {
			live,
			prepare: (doc) => {
				doc.editor = {
					activeLayer: this.activeLayerId,
					activeFrame: this.activeFrameId,
					tool: this.tool,
					settings: $state.snapshot(this.settings),
					fg: $state.snapshot(this.fg),
					bg: $state.snapshot(this.bg),
					workspace: this.workspace,
					display: $state.snapshot(this.display)
				};
			},
			thumbnail: (doc) => renderThumbnail(doc),
			onChange: (s) => {
				this.save = s;
				if (s.status === 'saved' || s.status === 'memory') void app.refreshProjects();
			}
		});
	}

	private restoreEditorState() {
		const e = this.doc.editor as Record<string, unknown>;
		const layer =
			typeof e.activeLayer === 'string' && this.doc.getLayer(e.activeLayer) ? e.activeLayer : null;
		this.activeLayerId = layer ?? this.doc.layersBottomUp().at(-1)!.id;
		const frame =
			typeof e.activeFrame === 'string' && this.doc.frameIndex(e.activeFrame) >= 0 ? e.activeFrame : null;
		this.activeFrameId = frame ?? this.doc.frames[0].id;
		this.cache.setActiveFrame(this.activeFrameId);
		if (typeof e.tool === 'string' && e.tool in TOOLS) this.tool = e.tool as ToolId;
		if (e.settings && typeof e.settings === 'object') {
			const d = defaultToolSettings();
			const s = e.settings as Partial<ToolSettings>;
			this.settings = {
				...d,
				...s,
				brush: { ...d.brush, ...s.brush },
				pencil: { ...d.pencil, ...s.pencil },
				eraser: { ...d.eraser, ...s.eraser },
				clone: { ...d.clone, ...s.clone },
				fill: { ...d.fill, ...s.fill },
				wand: { ...d.wand, ...s.wand },
				shape: { ...d.shape, ...s.shape },
				eyedropper: { ...d.eyedropper, ...s.eyedropper },
				paint: {
					...d.paint,
					...s.paint,
					brush: { ...d.paint.brush, ...s.paint?.brush },
					eraser: { ...d.paint.eraser, ...s.paint?.eraser },
					smudge: { ...d.paint.smudge, ...s.paint?.smudge },
					blur: { ...d.paint.blur, ...s.paint?.blur },
					gradient: { ...d.paint.gradient, ...s.paint?.gradient },
					preset: { ...d.paint.preset, ...s.paint?.preset }
				}
			};
		} else if (this.doc.meta.kind === 'skin') this.settings.symmetry = 'off';
		if (Array.isArray(e.fg) && e.fg.length === 4) this.fg = e.fg as RGBA;
		if (Array.isArray(e.bg) && e.bg.length === 4) this.bg = e.bg as RGBA;
		if (e.workspace === '2d' || e.workspace === '3d' || e.workspace === 'split') this.workspace = e.workspace;
		else this.workspace = this.doc.meta.kind === 'skin' && window.innerWidth >= 1100 ? 'split' : '2d';
		// The 3D preview wraps the image onto a skin or block; that means nothing for a painting.
		if (this.paintMode) this.workspace = '2d';
		if (e.display && typeof e.display === 'object')
			this.display = { ...this.display, ...(e.display as DisplaySettings) };
		if (this.doc.meta.kind !== 'skin') this.display.guides = false;
		if (this.doc.width > 128 || this.doc.height > 128 || this.paintMode) this.display.pixelGrid = false;
		if (this.paintMode && !(typeof e.tool === 'string' && e.tool in TOOLS)) this.tool = 'brush';
	}

	dispose() {
		this.stop();
		this.unsubs.forEach((u) => u());
		this.cache.dispose();
		this.autosave.dispose();
	}

	// ── document events ─────────────────────────────────────────────────────

	private onDocChange(e: ChangeEvent) {
		this.autosave.markDirty();
		this.remote?.onDocChanged?.(e);
		if (e.type === 'pixels') {
			if (!this.pixelTimer)
				this.pixelTimer = setTimeout(() => {
					this.pixelTimer = null;
					this.pixelsVersion++;
				}, 250);
			return;
		}
		if (e.type === 'reset') {
			this.selection.resize(this.doc.width, this.doc.height);
			this.mirrorCache = null;
			this.fit();
		}
		if (e.type === 'meta') {
			this.metaVersion++;
			this.mirrorCache = null;
		}
		if (!this.doc.getLayer(this.activeLayerId)) {
			const top = this.doc.layersBottomUp().at(-1);
			if (top) this.activeLayerId = top.id;
		}
		if (this.doc.frameIndex(this.activeFrameId) < 0) this.setFrame(this.doc.frames[0].id);
		if (this.doc.frames.length > 1) this.showTimeline = true;
		this.structureVersion++;
		this.pixelsVersion++;
	}

	/** Apply ops that arrived from a peer. They bypass local history (undo stays per-user). */
	applyRemote(ops: Op[]) {
		for (const op of ops) applyOp(this.doc, op);
	}

	// ── tools & colours ─────────────────────────────────────────────────────

	setTool(id: ToolId) {
		const info = TOOL_INFO.find((t) => t.id === id);
		if (info && !toolAvailable(info, this.doc.meta.kind)) {
			// The pencil's key still means "draw" in a painting; paint-only tools explain themselves.
			if (id === 'pencil') id = 'brush';
			else return this.flashNotice(`${info.label} is available in Paint projects.`);
		}
		if (id === this.tool) return;
		TOOLS[this.tool].cancel?.(this.ctx);
		this.tool = id;
	}

	setColor(c: RGBA, which: 'fg' | 'bg' = 'fg') {
		if (which === 'fg') this.fg = c;
		else this.bg = c;
	}

	swapColors() {
		const f = this.fg;
		this.fg = this.bg;
		this.bg = f;
	}

	resetColors() {
		this.fg = [0, 0, 0, 255];
		this.bg = [255, 255, 255, 255];
	}

	pushRecent(c: RGBA) {
		const hex = toHex(c);
		const recent = [hex, ...app.settings.recentColors.filter((h) => h !== hex)].slice(0, 24);
		if (recent[0] !== app.settings.recentColors[0]) void app.saveSettings({ recentColors: recent });
	}

	setColorHex(hex: string, which: 'fg' | 'bg' = 'fg') {
		const c = parseHex(hex);
		if (c) this.setColor(c, which);
	}

	mirror(i: number): number[] {
		const w = this.doc.width,
			h = this.doc.height;
		const x = i % w,
			y = (i - x) / w;
		switch (this.settings.symmetry) {
			case 'horizontal':
				return [y * w + (w - 1 - x)];
			case 'vertical':
				return [(h - 1 - y) * w + x];
			case 'both':
				return [y * w + (w - 1 - x), (h - 1 - y) * w + x, (h - 1 - y) * w + (w - 1 - x)];
			case 'character': {
				if (this.doc.meta.kind !== 'skin' || w !== 64 || h !== 64) return [y * w + (w - 1 - x)];
				const model = this.doc.meta.skin?.model ?? 'classic';
				if (this.mirrorCache?.key !== model) this.mirrorCache = { key: model, map: mirrorMap(model) };
				const j = this.mirrorCache.map[i];
				return j >= 0 ? [j] : [];
			}
			default:
				return [];
		}
	}

	// ── layers / frames ─────────────────────────────────────────────────────

	setLayer(id: string) {
		if (this.doc.getNode(id)) this.activeLayerId = id;
	}

	setFrame(id: string) {
		if (this.doc.frameIndex(id) < 0) return;
		this.activeFrameId = id;
		this.cache.setActiveFrame(id);
		this.structureVersion++;
	}

	stepFrame(dir: 1 | -1) {
		const n = this.doc.frames.length;
		const i = this.doc.frameIndex(this.activeFrameId);
		const loop = this.doc.meta.animation.loop || this.playing;
		let j = i + dir;
		if (j >= n) j = loop ? 0 : n - 1;
		if (j < 0) j = loop ? n - 1 : 0;
		this.setFrame(this.doc.frames[j].id);
	}

	play() {
		if (this.doc.frames.length < 2) return;
		this.playing = true;
		const tick = () => {
			if (!this.playing) return;
			const f = this.doc.frames.find((fr) => fr.id === this.activeFrameId) ?? this.doc.frames[0];
			this.playTimer = setTimeout(() => {
				const i = this.doc.frameIndex(this.activeFrameId);
				if (i === this.doc.frames.length - 1 && !this.doc.meta.animation.loop) return this.stop();
				this.stepFrame(1);
				tick();
			}, f.duration);
		};
		tick();
	}

	stop() {
		this.playing = false;
		if (this.playTimer) clearTimeout(this.playTimer);
		this.playTimer = null;
	}

	togglePlay() {
		if (this.playing) this.stop();
		else this.play();
	}

	// ── view ────────────────────────────────────────────────────────────────

	setViewport(w: number, h: number) {
		const first = this.viewport.w === 800 && this.viewport.h === 600;
		this.viewport = { w, h };
		if (first) this.fit();
	}

	get paintMode() {
		return this.doc.meta.kind === 'paint';
	}

	fit() {
		this.view = fitView(
			this.doc.width,
			this.doc.height,
			this.viewport.w,
			this.viewport.h,
			undefined,
			!this.paintMode
		);
	}

	/** Screen (CSS px, canvas-relative) → document coordinates, through zoom, pan and rotation. */
	screenToDoc(sx: number, sy: number): { x: number; y: number } {
		const [ux, uy] = unrotate(this.view, sx, sy, this.viewport.w, this.viewport.h);
		return { x: (ux - this.view.ox) / this.view.zoom, y: (uy - this.view.oy) / this.view.zoom };
	}

	/** Paint documents: rotate the view (not the image) by `deg`, or back to upright with `null`. */
	rotateView(deg: number | null) {
		if (!this.paintMode) return;
		const rot = deg === null ? 0 : (((((this.view.rot ?? 0) + deg) % 360) + 540) % 360) - 180;
		this.view = { ...this.view, rot: Math.abs(rot) < 0.01 ? 0 : rot };
		this.flashNotice(rot ? `Rotated ${Math.round(rot)}°` : 'Rotation reset');
	}

	/** Paint documents: mirror the view to check proportions. Doesn't touch the pixels. */
	toggleFlipView() {
		if (!this.paintMode) return;
		this.view = { ...this.view, flip: !this.view.flip };
		this.flashNotice(this.view.flip ? 'View mirrored' : 'View normal');
	}

	actualSize() {
		this.view = {
			zoom: 1,
			ox: (this.viewport.w - this.doc.width) / 2,
			oy: (this.viewport.h - this.doc.height) / 2
		};
	}

	pan(dx: number, dy: number) {
		const [ux, uy] = unrotateDelta(this.view, dx, dy);
		this.view = { ...this.view, ox: this.view.ox + ux, oy: this.view.oy + uy };
	}

	zoomAt(factor: number, sx = this.viewport.w / 2, sy = this.viewport.h / 2) {
		const [ux, uy] = unrotate(this.view, sx, sy, this.viewport.w, this.viewport.h);
		this.view = zoomViewAt(this.view, factor, ux, uy);
	}

	/** Step through "nice" zoom levels so pixels stay integer-sized (paintings zoom smoothly). */
	zoomStep(dir: 1 | -1) {
		if (this.paintMode) return this.zoomAt(dir > 0 ? 1.25 : 0.8);
		const levels = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];
		const z = this.view.zoom;
		const next = dir > 0 ? levels.find((l) => l > z + 1e-6) : [...levels].reverse().find((l) => l < z - 1e-6);
		if (next) this.zoomAt(next / z);
	}

	flashNotice(m: string) {
		this.notice = m;
		if (this.noticeTimer) clearTimeout(this.noticeTimer);
		this.noticeTimer = setTimeout(() => (this.notice = null), 2600);
	}

	// ── edit actions ────────────────────────────────────────────────────────

	undo() {
		TOOLS[this.tool].cancel?.(this.ctx);
		if (!this.history.undo()) this.flashNotice('Nothing to undo');
	}

	redo() {
		if (!this.history.redo()) this.flashNotice('Nothing to redo');
	}

	copy(merged = false) {
		const c = copySelection(this.ctx, merged);
		if (!c) return;
		this.clipboard = c;
		this.flashNotice(merged ? 'Copied merged pixels' : 'Copied');
		void writeSystemClipboard(c);
	}

	cut() {
		const c = cutSelection(this.ctx);
		if (c) {
			this.clipboard = c;
			void writeSystemClipboard(c);
		}
	}

	paste(clip: ClipboardImage | null = this.clipboard) {
		if (!clip) return this.flashNotice('The clipboard is empty');
		const id = pasteImage(this.ctx, clip);
		this.activeLayerId = id;
		this.setTool('move');
		this.flashNotice('Pasted as a new layer. Drag to position it.');
	}

	deleteSelected() {
		deleteSelection(this.ctx);
	}

	transform(t: Parameters<typeof transformSelection>[1]) {
		transformSelection(this.ctx, t);
	}

	nudge(dx: number, dy: number) {
		nudge(this.ctx, dx, dy);
	}

	defineBrush() {
		const tip = tipFromSelection(this.ctx);
		if (!tip) return;
		this.settings.customTip = tip;
		this.settings.brush.shape = 'custom';
		this.setTool('brush');
		this.flashNotice(`Custom brush created (${tip.w}×${tip.h}).`);
	}

	selectLayerPixels(layerId = this.activeLayerId) {
		const cel = this.doc.getCel(layerId, this.activeFrameId);
		if (cel) this.selection.selectOpaque(cel);
	}
}

async function writeSystemClipboard(c: ClipboardImage) {
	// Mirror the selection to the OS clipboard as PNG so it can be pasted into other apps.
	try {
		if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return;
		const canvas = document.createElement('canvas');
		canvas.width = c.w;
		canvas.height = c.h;
		canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(c.data), c.w, c.h), 0, 0);
		const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
		if (blob) await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
	} catch {
		/* the in-app clipboard still works */
	}
}
