/**
 * Wire format for live sessions. Messages are JSON with binary payloads (typed arrays) lifted out
 * into a trailing blob section, then split into chunks small enough for any WebRTC data channel.
 *
 *   message  = u32 headerLength | header JSON (utf-8) | blob* (u32 length | bytes)
 *   chunk    = u32 messageId | u16 index | u16 count | bytes
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

type Bin = Uint8Array | Uint8ClampedArray;

export function encodeMessage(msg: unknown): Uint8Array {
	const blobs: Bin[] = [];
	const header = JSON.stringify(msg, (_k, v) => {
		if (v instanceof Uint8ClampedArray) {
			blobs.push(v);
			return { $c: blobs.length - 1 };
		}
		if (v instanceof Uint8Array) {
			blobs.push(v);
			return { $u: blobs.length - 1 };
		}
		return v;
	});
	const h = enc.encode(header);
	const total = 4 + h.length + blobs.reduce((s, b) => s + 4 + b.length, 0);
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, h.length);
	out.set(h, 4);
	let off = 4 + h.length;
	for (const b of blobs) {
		dv.setUint32(off, b.length);
		out.set(b, off + 4);
		off += 4 + b.length;
	}
	return out;
}

export function decodeMessage<T = unknown>(bytes: Uint8Array): T {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const hl = dv.getUint32(0);
	const header = dec.decode(bytes.subarray(4, 4 + hl));
	const blobs: Uint8Array[] = [];
	let off = 4 + hl;
	while (off < bytes.length) {
		const len = dv.getUint32(off);
		blobs.push(bytes.slice(off + 4, off + 4 + len));
		off += 4 + len;
	}
	return JSON.parse(header, (_k, v) => {
		if (v && typeof v === 'object') {
			if (typeof v.$c === 'number' && Object.keys(v).length === 1)
				return new Uint8ClampedArray(blobs[v.$c].buffer);
			if (typeof v.$u === 'number' && Object.keys(v).length === 1) return blobs[v.$u];
		}
		return v;
	}) as T;
}

export const CHUNK_SIZE = 15 * 1024;

export function chunk(bytes: Uint8Array, id: number, size = CHUNK_SIZE): Uint8Array[] {
	const count = Math.max(1, Math.ceil(bytes.length / size));
	if (count > 0xffff) throw new Error('Message too large');
	const out: Uint8Array[] = [];
	for (let i = 0; i < count; i++) {
		const part = bytes.subarray(i * size, (i + 1) * size);
		const c = new Uint8Array(8 + part.length);
		const dv = new DataView(c.buffer);
		dv.setUint32(0, id >>> 0);
		dv.setUint16(4, i);
		dv.setUint16(6, count);
		c.set(part, 8);
		out.push(c);
	}
	return out;
}

/** Reassembles chunks (which arrive in order on a reliable, ordered channel). */
export class Reassembler {
	private parts = new Map<number, { count: number; got: number; chunks: Uint8Array[] }>();
	/** Guard against a misbehaving peer exhausting memory. */
	constructor(private maxBytes = 64 * 1024 * 1024) {}

	push(c: Uint8Array): Uint8Array | null {
		if (c.length < 8) return null;
		const dv = new DataView(c.buffer, c.byteOffset, c.byteLength);
		const id = dv.getUint32(0),
			idx = dv.getUint16(4),
			count = dv.getUint16(6);
		if (count === 0 || idx >= count || count * CHUNK_SIZE > this.maxBytes) return null;
		if (count === 1) return c.slice(8);
		let p = this.parts.get(id);
		if (!p) {
			p = { count, got: 0, chunks: new Array(count) };
			this.parts.set(id, p);
		}
		if (!p.chunks[idx]) {
			p.chunks[idx] = c.slice(8);
			p.got++;
		}
		if (p.got < p.count) return null;
		this.parts.delete(id);
		const total = p.chunks.reduce((s, x) => s + x.length, 0);
		const out = new Uint8Array(total);
		let off = 0;
		for (const x of p.chunks) {
			out.set(x, off);
			off += x.length;
		}
		return out;
	}
}
