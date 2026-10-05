import type { MoxelDocument } from '../document/document';
import type { Selection } from '../selection/selection';
import type { ToolOverlay } from '../tools/types';
import { allFaces, FACE_LABELS, skinParts } from '../../minecraft/uv';
import type { CompositeCache } from './compositeCache';

export interface ViewState {
	zoom: number;
	/** Screen position (CSS px) of the document's top-left corner. */
	ox: number;
	oy: number;
	/** Paint documents only: view rotation in degrees and a horizontal mirror, about the viewport centre. */
	rot?: number;
	flip?: boolean;
}

export interface DisplayOptions {
	pixelGrid: boolean;
	tileGrid: number; // 0 = off
	guides: boolean;
	guideLabels: boolean;
	dimOverlay: boolean;
	transparency: 'checker' | 'solid';
	background: string;
	onion: { before: HTMLCanvasElement[]; after: HTMLCanvasElement[]; opacity: number } | null;
	brushCursor: {
		x: number;
		y: number;
		size: number;
		square: boolean;
		/** Paint brushes: drawn at the true pointer position (no pixel snapping), with tip shape. */
		smooth?: boolean;
		angle?: number;
		roundness?: number;
	} | null;
	hoverPixel: { x: number; y: number } | null;
	peers: { name: string; color: string; x: number; y: number }[];
}

// Low enough to fit a 4096² painting in a small window.
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 128;

const PART_COLORS: Record<string, string> = {
	head: '#ffb454',
	body: '#59c2ff',
	rightArm: '#95e6cb',
	leftArm: '#d2a6ff',
	rightLeg: '#f07178',
	leftLeg: '#c2d94c'
};

/**
 * Draws the document view: checkerboard, composited frame, onion skin, grids, Minecraft UV guides,
 * selection outline, tool overlays, collaborator cursors. Stateless apart from the canvas; the
 * caller passes everything in, which keeps redraws cheap to reason about.
 */
export class CanvasRenderer {
	private ctx: CanvasRenderingContext2D;
	private checker: CanvasPattern | null = null;
	private dpr = 1;
	antsPhase = 0;

	constructor(readonly canvas: HTMLCanvasElement) {
		this.ctx = canvas.getContext('2d', { alpha: false })!;
	}

	resize(cssW: number, cssH: number) {
		this.dpr = Math.min(3, window.devicePixelRatio || 1);
		this.canvas.width = Math.max(1, Math.round(cssW * this.dpr));
		this.canvas.height = Math.max(1, Math.round(cssH * this.dpr));
		this.canvas.style.width = `${cssW}px`;
		this.canvas.style.height = `${cssH}px`;
	}

	private checkerPattern() {
		if (this.checker) return this.checker;
		const c = document.createElement('canvas');
		c.width = c.height = 16;
		const g = c.getContext('2d')!;
		// Mid-grey checks: dark enough for white paint, light enough for black paint.
		g.fillStyle = '#76777e';
		g.fillRect(0, 0, 16, 16);
		g.fillStyle = '#606168';
		g.fillRect(0, 0, 8, 8);
		g.fillRect(8, 8, 8, 8);
		this.checker = this.ctx.createPattern(c, 'repeat');
		return this.checker;
	}

	draw(
		doc: MoxelDocument,
		cache: CompositeCache,
		view: ViewState,
		sel: Selection,
		overlay: ToolOverlay,
		o: DisplayOptions
	) {
		const g = this.ctx;
		const { dpr } = this;
		const W = this.canvas.width / dpr,
			H = this.canvas.height / dpr;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.fillStyle = '#1b1c20';
		g.fillRect(0, 0, W, H);

		const z = view.zoom;
		const dw = doc.width * z,
			dh = doc.height * z;
		const ox = Math.round(view.ox),
			oy = Math.round(view.oy);
		const paint = doc.meta.kind === 'paint';
		const rotated = !!view.rot || !!view.flip;
		// Everything below is drawn in "unrotated screen space"; rotation and flip wrap all of it.
		g.save();
		if (rotated) {
			g.translate(W / 2, H / 2);
			g.rotate(((view.rot ?? 0) * Math.PI) / 180);
			if (view.flip) g.scale(-1, 1);
			g.translate(-W / 2, -H / 2);
		}

		// Drop shadow + background.
		g.fillStyle = 'rgba(0,0,0,0.35)';
		g.fillRect(ox + 3, oy + 3, dw, dh);
		if (o.transparency === 'checker') {
			g.save();
			g.translate(ox, oy);
			g.fillStyle = this.checkerPattern()!;
			g.fillRect(0, 0, dw, dh);
			g.restore();
		} else {
			g.fillStyle = o.background;
			g.fillRect(ox, oy, dw, dh);
		}

		// Pixel art stays nearest-neighbour. Paintings are smoothed when zoomed out or rotated, and
		// still show crisp pixels when zoomed right in, which is what painters expect.
		g.imageSmoothingEnabled = paint && (z < 2 || rotated);
		g.imageSmoothingQuality = 'high';
		if (o.onion) {
			const tint = (list: HTMLCanvasElement[], base: number) =>
				list.forEach((c, i) => {
					g.globalAlpha = o.onion!.opacity * Math.pow(0.6, i) * base;
					g.drawImage(c, ox, oy, dw, dh);
				});
			tint(o.onion.before, 1);
			tint(o.onion.after, 1);
			g.globalAlpha = 1;
		}
		g.drawImage(cache.canvas, ox, oy, dw, dh);
		g.imageSmoothingEnabled = false;

		g.save();
		g.beginPath();
		g.rect(ox, oy, dw, dh);
		g.clip();

		const skin =
			doc.meta.kind === 'skin' && doc.width === 64 && doc.height === 64
				? (doc.meta.skin?.model ?? 'classic')
				: null;

		if (skin && o.dimOverlay) {
			g.fillStyle = 'rgba(20,20,24,0.55)';
			for (const p of skinParts(skin).filter((p) => p.overlay))
				g.fillRect(ox + p.u * z, oy + p.v * z, (2 * p.d + 2 * p.w) * z, (p.d + p.h) * z);
		}

		// Pixel grid: only when pixels are big enough for lines not to become a grey wash.
		if (o.pixelGrid && z >= 6 && !paint) {
			g.strokeStyle = 'rgba(255,255,255,0.08)';
			g.lineWidth = 1;
			g.beginPath();
			for (let x = 1; x < doc.width; x++) {
				const sx = ox + x * z + 0.5;
				g.moveTo(sx, oy);
				g.lineTo(sx, oy + dh);
			}
			for (let y = 1; y < doc.height; y++) {
				const sy = oy + y * z + 0.5;
				g.moveTo(ox, sy);
				g.lineTo(ox + dw, sy);
			}
			g.stroke();
		}
		if (o.tileGrid > 0 && o.tileGrid * z >= 8) {
			g.strokeStyle = 'rgba(120,180,255,0.28)';
			g.lineWidth = 1;
			g.beginPath();
			for (let x = o.tileGrid; x < doc.width; x += o.tileGrid) {
				const sx = ox + x * z + 0.5;
				g.moveTo(sx, oy);
				g.lineTo(sx, oy + dh);
			}
			for (let y = o.tileGrid; y < doc.height; y += o.tileGrid) {
				const sy = oy + y * z + 0.5;
				g.moveTo(ox, sy);
				g.lineTo(ox + dw, sy);
			}
			g.stroke();
		}

		if (skin && o.guides) {
			const parts = new Map(skinParts(skin).map((p) => [p.id, p]));
			g.lineWidth = 1;
			g.font = `600 ${Math.max(9, Math.min(12, z * 1.4))}px Inter, system-ui, sans-serif`;
			g.textBaseline = 'top';
			for (const f of allFaces(skin)) {
				const part = parts.get(f.part)!;
				const color = PART_COLORS[part.limb];
				g.strokeStyle = color;
				g.globalAlpha = part.overlay ? 0.45 : 0.85;
				g.setLineDash(part.overlay ? [3, 3] : []);
				g.strokeRect(ox + f.x * z + 0.5, oy + f.y * z + 0.5, f.w * z - 1, f.h * z - 1);
				if (o.guideLabels && z >= 7 && f.w * z > 40) {
					g.globalAlpha = 0.9;
					g.fillStyle = color;
					const label = f.face === 'front' ? part.label : FACE_LABELS[f.face];
					g.fillText(label, ox + f.x * z + 3, oy + f.y * z + 3, f.w * z - 6);
				}
			}
			g.setLineDash([]);
			g.globalAlpha = 1;
		}

		if (o.hoverPixel && z >= 4) {
			g.strokeStyle = 'rgba(255,255,255,0.6)';
			g.lineWidth = 1;
			g.strokeRect(ox + o.hoverPixel.x * z + 0.5, oy + o.hoverPixel.y * z + 0.5, z - 1, z - 1);
		}
		g.restore();

		g.strokeStyle = 'rgba(255,255,255,0.1)';
		g.lineWidth = 1;
		g.strokeRect(ox - 0.5, oy - 0.5, dw + 1, dh + 1);

		// Selection: marching ants.
		if (sel.active) {
			const e = sel.edges();
			const off = overlay.selectionOffset ?? { x: 0, y: 0 };
			g.beginPath();
			for (let i = 0; i < e.length; i += 4) {
				g.moveTo(ox + (e[i] + off.x) * z + 0.5, oy + (e[i + 1] + off.y) * z + 0.5);
				g.lineTo(ox + (e[i + 2] + off.x) * z + 0.5, oy + (e[i + 3] + off.y) * z + 0.5);
			}
			g.lineWidth = 1;
			g.setLineDash([]);
			g.strokeStyle = '#000';
			g.stroke();
			g.setLineDash([4, 4]);
			g.lineDashOffset = -this.antsPhase;
			g.strokeStyle = '#fff';
			g.stroke();
			g.setLineDash([]);
		}

		if (overlay.rect) {
			const r = overlay.rect;
			g.save();
			g.setLineDash([4, 3]);
			g.strokeStyle = '#fff';
			g.lineWidth = 1;
			if (overlay.ellipse) {
				g.beginPath();
				g.ellipse(
					ox + (r.x + r.w / 2) * z,
					oy + (r.y + r.h / 2) * z,
					Math.max(0.5, (r.w * z) / 2),
					Math.max(0.5, (r.h * z) / 2),
					0,
					0,
					Math.PI * 2
				);
				g.stroke();
			} else g.strokeRect(ox + r.x * z + 0.5, oy + r.y * z + 0.5, r.w * z, r.h * z);
			g.restore();
		}
		if (overlay.path && overlay.path.length > 1) {
			g.save();
			g.beginPath();
			overlay.path.forEach((p, i) =>
				i ? g.lineTo(ox + p.x * z, oy + p.y * z) : g.moveTo(ox + p.x * z, oy + p.y * z)
			);
			g.setLineDash([4, 3]);
			g.strokeStyle = '#fff';
			g.stroke();
			g.restore();
		}
		if (overlay.marker) {
			const mx = ox + overlay.marker.x * z,
				my = oy + overlay.marker.y * z;
			g.strokeStyle = '#fff';
			g.lineWidth = 1.5;
			g.beginPath();
			g.arc(mx, my, 6, 0, Math.PI * 2);
			g.moveTo(mx - 10, my);
			g.lineTo(mx + 10, my);
			g.moveTo(mx, my - 10);
			g.lineTo(mx, my + 10);
			g.stroke();
		}

		if (o.brushCursor?.smooth) {
			const b = o.brushCursor;
			const cx = ox + b.x * z,
				cy = oy + b.y * z;
			const r = (b.size / 2) * z;
			g.lineWidth = 1;
			g.beginPath();
			if (r >= 3) {
				g.ellipse(
					cx,
					cy,
					r,
					Math.max(0.5, r * (b.roundness ?? 1)),
					((b.angle ?? 0) * Math.PI) / 180,
					0,
					Math.PI * 2
				);
			} else {
				// Too small to see as a circle: a crosshair instead.
				g.moveTo(cx - 6, cy);
				g.lineTo(cx + 6, cy);
				g.moveTo(cx, cy - 6);
				g.lineTo(cx, cy + 6);
			}
			// Two-tone so the outline reads on both light and dark paint.
			g.strokeStyle = 'rgba(0,0,0,0.6)';
			g.lineWidth = 3;
			g.stroke();
			g.strokeStyle = 'rgba(255,255,255,0.9)';
			g.lineWidth = 1;
			g.stroke();
		} else if (o.brushCursor && o.brushCursor.size * z >= 4) {
			const b = o.brushCursor;
			const odd = Math.round(b.size) % 2 === 1;
			const cx = odd ? Math.floor(b.x) + 0.5 : Math.round(b.x);
			const cy = odd ? Math.floor(b.y) + 0.5 : Math.round(b.y);
			g.lineWidth = 1;
			g.strokeStyle = 'rgba(255,255,255,0.85)';
			g.beginPath();
			if (b.square) g.rect(ox + (cx - b.size / 2) * z, oy + (cy - b.size / 2) * z, b.size * z, b.size * z);
			else g.arc(ox + cx * z, oy + cy * z, (b.size / 2) * z, 0, Math.PI * 2);
			g.stroke();
		}

		for (const p of o.peers) {
			const px = ox + p.x * z,
				py = oy + p.y * z;
			g.fillStyle = p.color;
			g.beginPath();
			g.moveTo(px, py);
			g.lineTo(px + 11, py + 4);
			g.lineTo(px + 4, py + 11);
			g.closePath();
			g.fill();
			g.font = '600 11px Inter, system-ui, sans-serif';
			const tw = g.measureText(p.name).width;
			g.fillRect(px + 10, py + 10, tw + 10, 17);
			g.fillStyle = '#111';
			g.textBaseline = 'middle';
			g.fillText(p.name, px + 15, py + 19);
		}
		g.restore();
	}
}

export function fitView(
	docW: number,
	docH: number,
	cssW: number,
	cssH: number,
	margin = Math.min(48, Math.min(cssW, cssH) * 0.04),
	integer = true
): ViewState {
	const zoom = Math.max(
		MIN_ZOOM,
		Math.min(MAX_ZOOM, Math.min((cssW - margin * 2) / docW, (cssH - margin * 2) / docH))
	);
	// Prefer integer zoom above 1 so pixels stay square and crisp (pixel art only).
	const z = integer && zoom >= 1 ? Math.max(1, Math.floor(zoom)) : zoom;
	return { zoom: z, ox: (cssW - docW * z) / 2, oy: (cssH - docH * z) / 2 };
}

export function zoomViewAt(v: ViewState, factor: number, sx: number, sy: number): ViewState {
	const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor));
	const k = zoom / v.zoom;
	return { ...v, zoom, ox: sx - (sx - v.ox) * k, oy: sy - (sy - v.oy) * k };
}

/**
 * Undo the view's rotation/flip: map a screen point into the unrotated screen space that ox/oy/zoom
 * describe. Rotation is about the viewport centre, so zooming about a point keeps it fixed on screen.
 */
export function unrotate(v: ViewState, sx: number, sy: number, cssW: number, cssH: number): [number, number] {
	if (!v.rot && !v.flip) return [sx, sy];
	const cx = cssW / 2,
		cy = cssH / 2;
	const a = (-(v.rot ?? 0) * Math.PI) / 180;
	const dx = sx - cx,
		dy = sy - cy;
	let ux = dx * Math.cos(a) - dy * Math.sin(a);
	const uy = dx * Math.sin(a) + dy * Math.cos(a);
	if (v.flip) ux = -ux;
	return [cx + ux, cy + uy];
}

/** Same, for a screen-space movement (pan deltas). */
export function unrotateDelta(v: ViewState, dx: number, dy: number): [number, number] {
	if (!v.rot && !v.flip) return [dx, dy];
	const a = (-(v.rot ?? 0) * Math.PI) / 180;
	let ux = dx * Math.cos(a) - dy * Math.sin(a);
	const uy = dx * Math.sin(a) + dy * Math.cos(a);
	if (v.flip) ux = -ux;
	return [ux, uy];
}
