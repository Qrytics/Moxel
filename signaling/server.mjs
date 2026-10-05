/**
 * Moxel live-session signaling relay.
 *
 * Its only job is to introduce browsers to each other: it forwards WebRTC offers/answers/ICE
 * candidates between members of a room. Artwork never passes through it — once peers are
 * connected, all drawing data flows directly between browsers over encrypted data channels.
 * Nothing is stored; rooms exist only while someone is connected.
 *
 *   PORT=8787 node signaling/server.mjs
 *
 * Accepts WebSocket upgrades on any path ending in `/signal` (the Pi serves it at
 * `/Moxel/signal`) and answers `GET /health`.
 */
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const MAX_PEERS = Number(process.env.MAX_PEERS ?? 6);
const MAX_ROOMS = Number(process.env.MAX_ROOMS ?? 500);
const MAX_MESSAGE = 64 * 1024;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 600;
const ROOM_RE = /^[a-f0-9]{16,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;

/** room id → Map<peer id, { ws, name, color, joinedAt }> */
const rooms = new Map();

export function createSignalingServer({ port = PORT, log = console.log } = {}) {
	const http = createServer((req, res) => {
		if (req.url?.endsWith('/health')) {
			res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
			res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
			return;
		}
		res.writeHead(404).end();
	});
	const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

	http.on('upgrade', (req, socket, head) => {
		const path = (req.url ?? '').split('?')[0];
		if (!(path === '/' || path.endsWith('/signal'))) {
			socket.destroy();
			return;
		}
		wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
	});

	wss.on('connection', (ws) => {
		let room = null;
		let id = null;
		let count = 0;
		let windowStart = Date.now();
		ws.isAlive = true;
		ws.on('pong', () => (ws.isAlive = true));

		const send = (target, msg) => {
			if (target.readyState === 1) target.send(JSON.stringify(msg));
		};

		ws.on('message', (raw, isBinary) => {
			if (isBinary) return;
			const now = Date.now();
			if (now - windowStart > RATE_WINDOW_MS) {
				windowStart = now;
				count = 0;
			}
			if (++count > RATE_MAX) return ws.close(1008, 'rate limit');
			let msg;
			try {
				msg = JSON.parse(raw.toString());
			} catch {
				return;
			}
			if (msg.t === 'join' && !room) {
				if (!ROOM_RE.test(msg.room ?? '') || !ID_RE.test(msg.id ?? ''))
					return send(ws, { t: 'error', message: 'Invalid room.' });
				let peers = rooms.get(msg.room);
				if (!peers) {
					if (rooms.size >= MAX_ROOMS)
						return send(ws, { t: 'error', message: 'The server is busy. Try again soon.' });
					peers = new Map();
					rooms.set(msg.room, peers);
				}
				if (peers.size >= MAX_PEERS)
					return send(ws, { t: 'error', message: `This session is full (${MAX_PEERS} people max).` });
				if (peers.has(msg.id)) return send(ws, { t: 'error', message: 'Already connected.' });
				room = msg.room;
				id = msg.id;
				const me = {
					ws,
					name: String(msg.name ?? 'Guest').slice(0, 32),
					color: /^#[0-9a-f]{6}$/i.test(msg.color ?? '') ? msg.color : '#6bd3ff',
					joinedAt: now
				};
				const existing = [...peers.entries()].map(([pid, p]) => ({
					id: pid,
					name: p.name,
					color: p.color,
					joinedAt: p.joinedAt
				}));
				peers.set(id, me);
				send(ws, { t: 'joined', self: { id, joinedAt: now }, peers: existing });
				for (const [pid, p] of peers)
					if (pid !== id)
						send(p.ws, { t: 'peer-joined', peer: { id, name: me.name, color: me.color, joinedAt: now } });
				log?.(`[signal] ${id} joined ${room.slice(0, 6)}… (${peers.size})`);
				return;
			}
			if (msg.t === 'signal' && room && typeof msg.to === 'string') {
				const target = rooms.get(room)?.get(msg.to);
				if (target) send(target.ws, { t: 'signal', from: id, data: msg.data });
			}
		});

		ws.on('close', () => {
			if (!room) return;
			const peers = rooms.get(room);
			if (!peers) return;
			peers.delete(id);
			for (const p of peers.values()) send(p.ws, { t: 'peer-left', id });
			if (peers.size === 0) rooms.delete(room);
		});
	});

	// Drop dead connections so rooms don't fill with ghosts.
	const heartbeat = setInterval(() => {
		for (const ws of wss.clients) {
			if (!ws.isAlive) {
				ws.terminate();
				continue;
			}
			ws.isAlive = false;
			ws.ping();
		}
	}, 30_000);

	return new Promise((resolve) => {
		http.listen(port, () => {
			const address = http.address();
			resolve({
				port: typeof address === 'object' && address ? address.port : port,
				close: () =>
					new Promise((r) => {
						clearInterval(heartbeat);
						for (const ws of wss.clients) ws.terminate();
						wss.close();
						http.close(() => r());
					})
			});
		});
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	createSignalingServer().then(({ port }) => console.log(`Moxel signaling relay listening on :${port}`));
}
