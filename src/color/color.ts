import type { RGBA } from '../core/tools/types';

export function clamp(v: number, lo: number, hi: number) {
	return Math.min(hi, Math.max(lo, v));
}

export function toHex(c: RGBA, withAlpha = c[3] !== 255): string {
	const h = (n: number) =>
		Math.round(clamp(n, 0, 255))
			.toString(16)
			.padStart(2, '0');
	return `#${h(c[0])}${h(c[1])}${h(c[2])}${withAlpha ? h(c[3]) : ''}`;
}

/** Accepts #rgb, #rgba, #rrggbb, #rrggbbaa (with or without '#'). */
export function parseHex(s: string): RGBA | null {
	let h = s.trim().replace(/^#/, '');
	if (!/^[0-9a-f]+$/i.test(h)) return null;
	if (h.length === 3 || h.length === 4) h = [...h].map((ch) => ch + ch).join('');
	if (h.length !== 6 && h.length !== 8) return null;
	const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
	return [n(0), n(2), n(4), h.length === 8 ? n(6) : 255];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b),
		min = Math.min(r, g, b),
		d = max - min;
	let h = 0;
	if (d) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return [h, max ? d / max : 0, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	let r = 0,
		g = 0,
		b = 0;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b),
		min = Math.min(r, g, b);
	const l = (max + min) / 2;
	const d = max - min;
	let h = 0,
		s = 0;
	if (d) {
		s = d / (1 - Math.abs(2 * l - 1));
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const v = l + c / 2;
	return hsvToRgb(h % 360, v ? (2 * (v - l)) / v : 0, v);
}

export function sameColor(a: RGBA, b: RGBA) {
	return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Relative luminance, for picking legible text over a swatch. */
export function isLight(c: RGBA) {
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 150;
}

export interface Palette {
	id: string;
	name: string;
	colors: string[];
	builtin?: boolean;
}

/** Built-in palettes. Minecraft-inspired swatches are hand-picked approximations, not game assets. */
export const BUILTIN_PALETTES: Palette[] = [
	{
		id: 'mc-dyes',
		name: 'Minecraft dyes',
		builtin: true,
		colors: [
			'#f9fffe',
			'#9d9d97',
			'#474f52',
			'#1d1d21',
			'#835432',
			'#b02e26',
			'#f9801d',
			'#fed83d',
			'#80c71f',
			'#5e7c16',
			'#169c9c',
			'#3ab3da',
			'#3c44aa',
			'#8932b8',
			'#c74ebd',
			'#f38baa'
		]
	},
	{
		id: 'mc-skin',
		name: 'Skin & hair tones',
		builtin: true,
		colors: [
			'#ffdbc4',
			'#f1c6a6',
			'#e0ac85',
			'#c69c7c',
			'#a8775a',
			'#8d5a3c',
			'#6b4129',
			'#4a2c1a',
			'#f2e3a0',
			'#d4a35a',
			'#a0642e',
			'#6e3b1a',
			'#3d2412',
			'#1f1410',
			'#b7b7b7',
			'#e8e8e8'
		]
	},
	{
		id: 'mc-nature',
		name: 'Overworld',
		builtin: true,
		colors: [
			'#7cbd6b',
			'#5a9a46',
			'#3e7a33',
			'#866043',
			'#6b4a2f',
			'#9a9a9a',
			'#7a7a7a',
			'#5c5c5c',
			'#d9cf8f',
			'#c2b280',
			'#3d5fd6',
			'#2a3f9a',
			'#c4dfff',
			'#ffffff',
			'#e5533d',
			'#2b2b2b'
		]
	},
	{
		id: 'pico8',
		name: 'PICO-8',
		builtin: true,
		colors: [
			'#000000',
			'#1d2b53',
			'#7e2553',
			'#008751',
			'#ab5236',
			'#5f574f',
			'#c2c3c7',
			'#fff1e8',
			'#ff004d',
			'#ffa300',
			'#ffec27',
			'#00e436',
			'#29adff',
			'#83769c',
			'#ff77a8',
			'#ffccaa'
		]
	},
	{
		id: 'grays',
		name: 'Grayscale',
		builtin: true,
		colors: [
			'#000000',
			'#222222',
			'#444444',
			'#666666',
			'#888888',
			'#aaaaaa',
			'#cccccc',
			'#eeeeee',
			'#ffffff'
		]
	}
];

/** Distinct opaque colours in an image (for "palette from image"). */
export function extractColors(px: Uint8ClampedArray, max = 64): string[] {
	const counts = new Map<number, number>();
	for (let i = 0; i < px.length; i += 4) {
		if (px[i + 3] < 128) continue;
		const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, max)
		.map(([k]) => toHex([(k >> 16) & 255, (k >> 8) & 255, k & 255, 255], false));
}

/** Parse .hex (one colour per line) and GIMP .gpl palette files. */
export function parsePaletteFile(text: string): string[] {
	const out: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || t.startsWith('#') || /^(GIMP|Name:|Columns:)/.test(t)) {
			const hexOnly = parseHex(t);
			if (hexOnly && t.startsWith('#')) out.push(toHex(hexOnly));
			continue;
		}
		const gpl = t.match(/^(\d+)\s+(\d+)\s+(\d+)/);
		if (gpl) {
			out.push(toHex([+gpl[1], +gpl[2], +gpl[3], 255], false));
			continue;
		}
		const h = parseHex(t);
		if (h) out.push(toHex(h));
	}
	return [...new Set(out)].slice(0, 256);
}
