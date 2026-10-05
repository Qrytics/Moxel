import type { ChangeEvent, MoxelDocument } from '../document/document';
import { unionRect, writeRect } from '../document/pixels';
import type { Rect } from '../document/types';
import { compositeRect } from './composite';

interface FrameEntry {
	canvas: HTMLCanvasElement;
	data: Uint8ClampedArray;
	stale: boolean;
}

/**
 * Keeps a flattened bitmap of each frame up to date with the document. The active frame is
 * re-composited incrementally (dirty rects only), once per animation frame, and shared by the 2D
 * view, the 3D preview, thumbnails and playback — so a brush dab costs one small composite
 * regardless of how many views are showing the result.
 */
export class CompositeCache {
	private frames = new Map<string, FrameEntry>();
	private dirty: Rect | null = null;
	private raf = 0;
	private listeners = new Set<(rect: Rect | null) => void>();
	private unsub: () => void;
	activeFrame: string;
	version = 0;

	constructor(
		readonly doc: MoxelDocument,
		activeFrame: string
	) {
		this.activeFrame = activeFrame;
		this.unsub = doc.subscribe((e) => this.onChange(e));
	}

	dispose() {
		this.unsub();
		cancelAnimationFrame(this.raf);
		this.listeners.clear();
	}

	subscribe(fn: (rect: Rect | null) => void) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	setActiveFrame(id: string) {
		if (id === this.activeFrame) return;
		this.activeFrame = id;
		this.invalidateAll();
	}

	private onChange(e: ChangeEvent) {
		if (e.type === 'pixels') {
			const f = this.frames.get(e.frameId);
			if (e.frameId === this.activeFrame && f && !f.stale) {
				this.dirty = unionRect(this.dirty, e.rect);
				this.schedule();
			} else if (f) f.stale = true;
		} else if (e.type === 'structure' || e.type === 'reset') {
			if (e.type === 'reset') this.frames.clear();
			this.invalidateAll();
		}
	}

	invalidateAll() {
		for (const f of this.frames.values()) f.stale = true;
		this.dirty = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
		this.schedule();
	}

	private schedule() {
		if (this.raf) return;
		this.raf = requestAnimationFrame(() => {
			this.raf = 0;
			this.flush();
		});
	}

	/** Bring the active frame up to date now and notify listeners. */
	flush() {
		const entry = this.entry(this.activeFrame);
		let rect = this.dirty;
		this.dirty = null;
		if (entry.stale) {
			this.recompose(this.activeFrame, entry, null);
			rect = null;
		} else if (rect) this.recompose(this.activeFrame, entry, rect);
		else return;
		this.version++;
		for (const fn of this.listeners) fn(rect);
	}

	private entry(frameId: string): FrameEntry {
		let e = this.frames.get(frameId);
		const { width, height } = this.doc;
		if (!e || e.canvas.width !== width || e.canvas.height !== height) {
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			e = { canvas, data: new Uint8ClampedArray(width * height * 4), stale: true };
			this.frames.set(frameId, e);
		}
		return e;
	}

	private recompose(frameId: string, e: FrameEntry, rect: Rect | null) {
		const { width, height } = this.doc;
		const r = rect ?? { x: 0, y: 0, w: width, h: height };
		const x0 = Math.max(0, r.x),
			y0 = Math.max(0, r.y);
		const x1 = Math.min(width, r.x + r.w),
			y1 = Math.min(height, r.y + r.h);
		if (x1 <= x0 || y1 <= y0) {
			e.stale = false;
			return;
		}
		const cr = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
		const px = compositeRect(this.doc, frameId, cr);
		writeRect(e.data, width, cr, px);
		const ctx = e.canvas.getContext('2d')!;
		ctx.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, cr.w, cr.h), cr.x, cr.y);
		e.stale = false;
	}

	/** Composited canvas for any frame (onion skin, playback, thumbnails). */
	frameCanvas(frameId: string): HTMLCanvasElement {
		const e = this.entry(frameId);
		if (e.stale) this.recompose(frameId, e, null);
		return e.canvas;
	}

	frameData(frameId: string): Uint8ClampedArray {
		const e = this.entry(frameId);
		if (e.stale) this.recompose(frameId, e, null);
		return e.data;
	}

	get canvas(): HTMLCanvasElement {
		return this.frameCanvas(this.activeFrame);
	}
}
