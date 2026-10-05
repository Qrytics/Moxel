import { unzlibSync, zlibSync } from 'fflate';

/**
 * Minimal, dependency-light PNG codec (zlib via fflate). Pure JS so encoding/decoding works the same
 * in the browser, in a worker, in tests, and is byte-for-byte deterministic for exports.
 *
 * Encoder: 8-bit RGBA, non-interlaced. Decoder: 8-bit greyscale / RGB / RGBA / grey+alpha and
 * palette (1/2/4/8-bit) images, non-interlaced — everything Moxel writes and nearly every skin in
 * the wild. Anything else falls back to the browser decoder at import time.
 */

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
	if (!crcTable) {
		crcTable = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			crcTable[n] = c >>> 0;
		}
	}
	let c = 0xffffffff;
	for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
	return out;
}

export function encodePNG(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
	if (rgba.length !== width * height * 4) throw new Error('encodePNG: buffer size mismatch');
	const ihdr = new Uint8Array(13);
	const dv = new DataView(ihdr.buffer);
	dv.setUint32(0, width);
	dv.setUint32(4, height);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	// Filter: "Up" for every row except the first. Cheap and compresses pixel art well.
	const stride = width * 4;
	const raw = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		const o = y * (stride + 1);
		const r = y * stride;
		if (y === 0) {
			raw[o] = 0;
			raw.set(rgba.subarray(r, r + stride), o + 1);
		} else {
			raw[o] = 2;
			for (let i = 0; i < stride; i++) raw[o + 1 + i] = (rgba[r + i] - rgba[r - stride + i]) & 0xff;
		}
	}
	const idat = zlibSync(raw, { level: 9 });
	const parts = [
		new Uint8Array(SIG),
		chunk('IHDR', ihdr),
		chunk('IDAT', idat),
		chunk('IEND', new Uint8Array(0))
	];
	const total = parts.reduce((s, p) => s + p.length, 0);
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

export interface DecodedImage {
	width: number;
	height: number;
	data: Uint8ClampedArray;
}

export class PNGDecodeError extends Error {}

export function isPNG(bytes: Uint8Array) {
	return SIG.every((b, i) => bytes[i] === b);
}

export function decodePNG(bytes: Uint8Array): DecodedImage {
	if (!isPNG(bytes)) throw new PNGDecodeError('Not a PNG file');
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let off = 8;
	let width = 0,
		height = 0,
		depth = 0,
		colorType = 0,
		interlace = 0;
	let palette: Uint8Array | null = null;
	let trns: Uint8Array | null = null;
	const idat: Uint8Array[] = [];
	while (off + 8 <= bytes.length) {
		const len = dv.getUint32(off);
		const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
		const data = bytes.subarray(off + 8, off + 8 + len);
		if (type === 'IHDR') {
			width = dv.getUint32(off + 8);
			height = dv.getUint32(off + 12);
			depth = bytes[off + 16];
			colorType = bytes[off + 17];
			interlace = bytes[off + 20];
		} else if (type === 'PLTE') palette = data;
		else if (type === 'tRNS') trns = data;
		else if (type === 'IDAT') idat.push(data);
		else if (type === 'IEND') break;
		off += 12 + len;
	}
	if (!width || !height) throw new PNGDecodeError('PNG has no header');
	if (width * height > 4096 * 4096) throw new PNGDecodeError('Image is too large');
	if (interlace) throw new PNGDecodeError('Interlaced PNGs are not supported by the fast decoder');
	const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
	if (!channels) throw new PNGDecodeError(`Unsupported PNG color type ${colorType}`);
	if (colorType === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8)
		throw new PNGDecodeError(`Unsupported PNG bit depth ${depth}`);

	const compressed = new Uint8Array(idat.reduce((s, c) => s + c.length, 0));
	let p = 0;
	for (const c of idat) {
		compressed.set(c, p);
		p += c.length;
	}
	const raw = unzlibSync(compressed);
	const bpp = Math.max(1, (channels * depth) >> 3);
	const stride = Math.ceil((width * channels * depth) / 8);
	const lines = new Uint8Array(stride * height);
	let prev = new Uint8Array(stride);
	for (let y = 0; y < height; y++) {
		const ft = raw[y * (stride + 1)];
		const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const cur = lines.subarray(y * stride, (y + 1) * stride);
		for (let i = 0; i < stride; i++) {
			const a = i >= bpp ? cur[i - bpp] : 0;
			const b = prev[i];
			const c = i >= bpp ? prev[i - bpp] : 0;
			let v = src[i];
			if (ft === 1) v += a;
			else if (ft === 2) v += b;
			else if (ft === 3) v += (a + b) >> 1;
			else if (ft === 4) {
				const pa = Math.abs(b - c),
					pb = Math.abs(a - c),
					pc = Math.abs(a + b - 2 * c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			cur[i] = v & 0xff;
		}
		prev = cur;
	}

	const out = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		const row = lines.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < width; x++) {
			const o = (y * width + x) * 4;
			if (colorType === 6) out.set(row.subarray(x * 4, x * 4 + 4), o);
			else if (colorType === 2) {
				out[o] = row[x * 3];
				out[o + 1] = row[x * 3 + 1];
				out[o + 2] = row[x * 3 + 2];
				out[o + 3] =
					trns &&
					trns.length >= 6 &&
					row[x * 3] === trns[1] &&
					row[x * 3 + 1] === trns[3] &&
					row[x * 3 + 2] === trns[5]
						? 0
						: 255;
			} else if (colorType === 0) {
				out[o] = out[o + 1] = out[o + 2] = row[x];
				out[o + 3] = trns && trns.length >= 2 && row[x] === trns[1] ? 0 : 255;
			} else if (colorType === 4) {
				out[o] = out[o + 1] = out[o + 2] = row[x * 2];
				out[o + 3] = row[x * 2 + 1];
			} else {
				const per = 8 / depth;
				const idx = (row[Math.floor(x / per)] >> ((per - 1 - (x % per)) * depth)) & ((1 << depth) - 1);
				if (!palette) throw new PNGDecodeError('Palette PNG without PLTE');
				out[o] = palette[idx * 3];
				out[o + 1] = palette[idx * 3 + 1];
				out[o + 2] = palette[idx * 3 + 2];
				out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
			}
		}
	}
	return { width, height, data: out };
}
