/**
 * Generates the PWA icons and favicon from the Moxel voxel mark.
 *   node scripts/gen-icons.mjs
 * Output: public/favicon.svg, public/icons/icon-192.png, public/icons/icon-512.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const MARK = [
	{
		fill: [143, 208, 255],
		pts: [
			[12, 2],
			[21, 7],
			[12, 12],
			[3, 7]
		]
	},
	{
		fill: [61, 143, 224],
		pts: [
			[3, 7],
			[12, 12],
			[12, 22],
			[3, 17]
		]
	},
	{
		fill: [95, 179, 255],
		pts: [
			[21, 7],
			[12, 12],
			[12, 22],
			[21, 17]
		]
	},
	{
		fill: [126, 224, 161],
		pts: [
			[12, 12],
			[16.5, 9.5],
			[16.5, 14.5],
			[12, 17]
		]
	}
];
const BG = [21, 22, 26];

function inside(pts, x, y) {
	let c = false;
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const [xi, yi] = pts[i],
			[xj, yj] = pts[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
	}
	return c;
}

function render(size) {
	const px = Buffer.alloc(size * size * 4);
	const pad = size * 0.16;
	const scale = (size - pad * 2) / 24;
	const radius = size * 0.22;
	const SS = 4; // supersampling for smooth edges
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			let r = 0,
				g = 0,
				b = 0,
				a = 0;
			for (let sy = 0; sy < SS; sy++)
				for (let sx = 0; sx < SS; sx++) {
					const fx = x + (sx + 0.5) / SS,
						fy = y + (sy + 0.5) / SS;
					// Rounded-square background (full-bleed for maskable icons).
					const cx = Math.max(radius, Math.min(size - radius, fx)),
						cy = Math.max(radius, Math.min(size - radius, fy));
					if ((fx - cx) ** 2 + (fy - cy) ** 2 > radius ** 2) continue;
					let col = BG;
					const ux = (fx - pad) / scale,
						uy = (fy - pad) / scale;
					for (const f of MARK) if (inside(f.pts, ux, uy)) col = f.fill;
					r += col[0];
					g += col[1];
					b += col[2];
					a += 255;
				}
			const n = SS * SS;
			const o = (y * size + x) * 4;
			const cov = a / n;
			px[o] = cov ? (r / n) * (255 / cov) : 0;
			px[o + 1] = cov ? (g / n) * (255 / cov) : 0;
			px[o + 2] = cov ? (b / n) * (255 / cov) : 0;
			px[o + 3] = cov;
		}
	return px;
}

function crc32(buf) {
	let c,
		crc = 0xffffffff;
	for (let n = 0; n < buf.length; n++) {
		c = (crc ^ buf[n]) & 0xff;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		crc = (crc >>> 8) ^ c;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function png(size, rgba) {
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(td));
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const raw = Buffer.alloc((size * 4 + 1) * size);
	for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

mkdirSync('public/icons', { recursive: true });
for (const s of [192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s, render(s)));

const svgPaths = MARK.map(
	(f) => `<path d="M${f.pts.map((p) => p.join(' ')).join('L')}Z" fill="rgb(${f.fill.join(',')})"/>`
).join('');
writeFileSync(
	'public/favicon.svg',
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="5" fill="rgb(${BG.join(',')})"/><g transform="translate(2.4 2.4) scale(0.8)">${svgPaths}</g></svg>\n`
);
console.log('Icons written to public/');
