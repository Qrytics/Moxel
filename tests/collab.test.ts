// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { chunk, decodeMessage, encodeMessage, Reassembler } from '../src/collab/codec';
import { reconcileStructure, structureOf, SyncState } from '../src/collab/sync';
import { MoxelDocument } from '../src/core/document/document';
import { DocCommands } from '../src/core/document/commands';
import { History } from '../src/core/history/history';
import type { Op } from '../src/core/document/ops';
import { createSignalingServer } from '../signaling/server.mjs';

describe('wire codec', () => {
	it('round-trips JSON with binary payloads', () => {
		const msg = {
			t: 'ops',
			a: new Uint8ClampedArray([1, 2, 255]),
			nested: { b: new Uint8Array([9, 8]) },
			n: 3
		};
		const back = decodeMessage<typeof msg>(encodeMessage(msg));
		expect(back.t).toBe('ops');
		expect(back.a).toBeInstanceOf(Uint8ClampedArray);
		expect(Array.from(back.a)).toEqual([1, 2, 255]);
		expect(back.nested.b).toBeInstanceOf(Uint8Array);
		expect(Array.from(back.nested.b)).toEqual([9, 8]);
	});

	it('chunks and reassembles large messages', () => {
		const big = new Uint8Array(100_000).map((_, i) => i % 251);
		const parts = chunk(big, 7, 4096);
		expect(parts.length).toBe(Math.ceil(100_000 / 4096));
		const r = new Reassembler();
		let out: Uint8Array | null = null;
		for (const p of parts) out = r.push(p) ?? out;
		expect(out!.length).toBe(big.length);
		expect(out![99_999]).toBe(big[99_999]);
	});
});

/** Two simulated peers sharing a document through the same paths the live session uses. */
function makePeer(seed: MoxelDocument, id: string) {
	const doc = MoxelDocument.fromSnapshot(seed.toSnapshot());
	const history = new History(doc);
	const sync = new SyncState(doc, id);
	const outbox: { patches: ReturnType<SyncState['localPatch']>[]; ops: Op[] }[] = [];
	history.onApplied = (ops, _k, _l, inverses) => {
		const patches = ops
			.map((op, i) =>
				op.t === 'patch' && inverses[i].t === 'patch'
					? sync.localPatch(inverses[i] as Extract<Op, { t: 'patch' }>)
					: null
			)
			.filter(Boolean);
		outbox.push({ patches, ops: ops.filter((o) => o.t !== 'patch') });
	};
	return { doc, history, sync, outbox, cmd: new DocCommands(doc, history) };
}

function deliver(from: ReturnType<typeof makePeer>, to: ReturnType<typeof makePeer>) {
	for (const m of from.outbox.splice(0)) {
		for (const op of m.ops) to.sync.applyRemoteOp(op);
		for (const p of m.patches) to.sync.applyRemotePatch(p!);
	}
}

function paint(peer: ReturnType<typeof makePeer>, x: number, y: number, rgba: number[]) {
	const layer = peer.doc.root[0];
	const frame = peer.doc.frames[0].id;
	peer.history.transact('paint', (tx) =>
		tx.apply({
			t: 'patch',
			layerId: layer,
			frameId: frame,
			rect: { x, y, w: 1, h: 1 },
			data: new Uint8ClampedArray(rgba)
		})
	);
}

const px = (doc: MoxelDocument, x: number, y: number) =>
	Array.from(
		doc.getCel(doc.root[0], doc.frames[0].id)!.subarray((y * doc.width + x) * 4, (y * doc.width + x) * 4 + 4)
	);

describe('shared canvas convergence', () => {
	it('converges when concurrent strokes hit the same pixel in different orders', () => {
		const seed = MoxelDocument.create({ name: 's', kind: 'canvas', width: 4, height: 4 });
		const a = makePeer(seed, 'alice');
		const b = makePeer(seed, 'bob');
		paint(a, 1, 1, [255, 0, 0, 255]);
		paint(b, 1, 1, [0, 0, 255, 255]);
		// Each receives the other's stroke after making its own.
		deliver(a, b);
		deliver(b, a);
		expect(px(a.doc, 1, 1)).toEqual(px(b.doc, 1, 1));
	});

	it("doesn't erase a friend's pixels outside your stroke", () => {
		const seed = MoxelDocument.create({ name: 's', kind: 'canvas', width: 4, height: 4 });
		const a = makePeer(seed, 'alice');
		const b = makePeer(seed, 'bob');
		paint(a, 0, 0, [255, 0, 0, 255]);
		paint(b, 3, 3, [0, 255, 0, 255]);
		deliver(a, b);
		deliver(b, a);
		for (const d of [a.doc, b.doc]) {
			expect(px(d, 0, 0)).toEqual([255, 0, 0, 255]);
			expect(px(d, 3, 3)).toEqual([0, 255, 0, 255]);
		}
	});

	it('per-user undo only removes your own stroke and propagates', () => {
		const seed = MoxelDocument.create({ name: 's', kind: 'canvas', width: 4, height: 4 });
		const a = makePeer(seed, 'alice');
		const b = makePeer(seed, 'bob');
		paint(a, 0, 0, [255, 0, 0, 255]);
		paint(b, 1, 0, [0, 255, 0, 255]);
		deliver(a, b);
		deliver(b, a);
		a.history.undo();
		deliver(a, b);
		for (const d of [a.doc, b.doc]) {
			expect(px(d, 0, 0)[3]).toBe(0);
			expect(px(d, 1, 0)).toEqual([0, 255, 0, 255]);
		}
	});

	it('replicates structural changes and adopts the host structure', () => {
		const seed = MoxelDocument.create({ name: 's', kind: 'canvas', width: 4, height: 4 });
		const host = makePeer(seed, 'host');
		const guest = makePeer(seed, 'guest');
		const l1 = host.cmd.addLayer('Hair');
		const l2 = guest.cmd.addLayer('Eyes');
		deliver(host, guest);
		deliver(guest, host);
		expect(new Set(guest.doc.root)).toEqual(new Set(host.doc.root));
		// Concurrent adds can land in different orders; the host snapshot settles it.
		reconcileStructure(guest.doc, structureOf(host.doc));
		expect(guest.doc.root).toEqual(host.doc.root);
		expect(guest.doc.getNode(l1)?.name).toBe('Hair');
		expect(host.doc.getNode(l2)?.name).toBe('Eyes');
	});

	it('ignores patches for layers that no longer exist', () => {
		const seed = MoxelDocument.create({ name: 's', kind: 'canvas', width: 4, height: 4 });
		const a = makePeer(seed, 'a');
		const ok = a.sync.applyRemotePatch({
			layerId: 'nope',
			frameId: a.doc.frames[0].id,
			rect: { x: 0, y: 0, w: 1, h: 1 },
			after: new Uint8ClampedArray(4),
			changed: new Uint8Array([1]),
			stamp: 99
		});
		expect(ok).toBe(false);
	});
});

describe('signaling relay', () => {
	let server: Awaited<ReturnType<typeof createSignalingServer>>;
	beforeAll(async () => {
		server = await createSignalingServer({ port: 0, log: null });
	});
	afterAll(() => server.close());

	function client() {
		const ws = new WebSocket(`ws://localhost:${server.port}/Moxel/signal`);
		const inbox: Record<string, unknown>[] = [];
		const waiters: ((m: Record<string, unknown>) => void)[] = [];
		ws.on('message', (d) => {
			const m = JSON.parse(String(d));
			const w = waiters.shift();
			if (w) w(m);
			else inbox.push(m);
		});
		const next = () =>
			new Promise<Record<string, unknown>>((r) => (inbox.length ? r(inbox.shift()!) : waiters.push(r)));
		const open = new Promise((r) => ws.on('open', r));
		return { ws, next, open };
	}

	it('introduces peers and forwards signals only within a room', async () => {
		const room = 'ab'.repeat(16);
		const a = client();
		await a.open;
		a.ws.send(JSON.stringify({ t: 'join', room, id: 'peerA1', name: 'A', color: '#ff0000' }));
		expect((await a.next()).t).toBe('joined');

		const b = client();
		await b.open;
		b.ws.send(JSON.stringify({ t: 'join', room, id: 'peerB1', name: 'B', color: '#00ff00' }));
		const joined = await b.next();
		expect((joined.peers as { id: string }[]).map((p) => p.id)).toEqual(['peerA1']);
		expect(((await a.next()).peer as { id: string }).id).toBe('peerB1');

		b.ws.send(
			JSON.stringify({
				t: 'signal',
				to: 'peerA1',
				data: { kind: 'sdp', description: { type: 'offer', sdp: 'x' } }
			})
		);
		const sig = await a.next();
		expect(sig).toMatchObject({ t: 'signal', from: 'peerB1' });

		b.ws.close();
		expect(await a.next()).toMatchObject({ t: 'peer-left', id: 'peerB1' });
		a.ws.close();
	});

	it('rejects invalid rooms', async () => {
		const c = client();
		await c.open;
		c.ws.send(JSON.stringify({ t: 'join', room: '../etc', id: 'peerC1' }));
		expect((await c.next()).t).toBe('error');
		c.ws.close();
	});
});
