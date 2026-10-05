import { chunk, decodeMessage, encodeMessage, Reassembler } from './codec';

export interface PeerInfo {
	id: string;
	name: string;
	color: string;
	joinedAt: number;
}

export type PeerState = 'connecting' | 'connected' | 'failed';

export interface MeshEvents {
	onPeers(peers: (PeerInfo & { state: PeerState })[]): void;
	onMessage(from: string, msg: unknown): void;
	onPeerConnected(id: string): void;
	onStatus(status: 'connecting' | 'online' | 'error', message?: string): void;
}

const ICE_SERVERS: RTCIceServer[] = [
	{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
];

/** Where the signaling relay lives. Override at build time with VITE_SIGNAL_URL. */
export function signalUrl(): string {
	const configured = import.meta.env.VITE_SIGNAL_URL as string | undefined;
	if (configured) return configured;
	const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
	return `${proto}//${location.host}${import.meta.env.BASE_URL}signal`;
}

interface Peer {
	info: PeerInfo;
	pc: RTCPeerConnection;
	dc: RTCDataChannel | null;
	state: PeerState;
	reasm: Reassembler;
	pendingIce: RTCIceCandidateInit[];
}

/**
 * Full-mesh WebRTC between up to six browsers. The newcomer offers to everyone already in the room
 * (so there is never offer "glare"); data channels are reliable and ordered.
 */
export class Mesh {
	private ws: WebSocket | null = null;
	private peers = new Map<string, Peer>();
	private msgId = 1;
	private closed = false;
	joinedAt = 0;

	constructor(
		readonly room: string,
		readonly self: { id: string; name: string; color: string },
		private ev: MeshEvents
	) {}

	connect() {
		this.ev.onStatus('connecting');
		let ws: WebSocket;
		try {
			ws = new WebSocket(signalUrl());
		} catch {
			this.ev.onStatus('error', 'Live sessions are unavailable right now.');
			return;
		}
		this.ws = ws;
		const timeout = setTimeout(() => {
			if (ws.readyState !== WebSocket.OPEN) {
				ws.close();
				this.ev.onStatus(
					'error',
					"Couldn't reach the live-session server. Check your connection and try again."
				);
			}
		}, 8000);
		ws.onopen = () => {
			clearTimeout(timeout);
			ws.send(JSON.stringify({ t: 'join', room: this.room, ...this.self }));
		};
		ws.onerror = () => {
			clearTimeout(timeout);
			if (!this.closed)
				this.ev.onStatus(
					'error',
					"Couldn't reach the live-session server. Check your connection and try again."
				);
		};
		ws.onclose = () => {
			if (!this.closed && this.peers.size === 0)
				this.ev.onStatus('error', 'Disconnected from the live-session server.');
		};
		ws.onmessage = (e) => {
			let msg: { t: string; [k: string]: unknown };
			try {
				msg = JSON.parse(e.data);
			} catch {
				return;
			}
			if (msg.t === 'joined') {
				this.joinedAt = (msg.self as { joinedAt: number }).joinedAt;
				this.ev.onStatus('online');
				for (const p of msg.peers as PeerInfo[]) this.addPeer(p, true);
				this.emitPeers();
			} else if (msg.t === 'peer-joined') {
				this.addPeer(msg.peer as PeerInfo, false);
				this.emitPeers();
			} else if (msg.t === 'peer-left') this.removePeer(msg.id as string);
			else if (msg.t === 'signal') void this.onSignal(msg.from as string, msg.data as SignalData);
			else if (msg.t === 'error') this.ev.onStatus('error', String(msg.message));
		};
	}

	private signal(to: string, data: SignalData) {
		this.ws?.send(JSON.stringify({ t: 'signal', to, data }));
	}

	private addPeer(info: PeerInfo, initiator: boolean) {
		if (this.peers.has(info.id)) return;
		const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
		const peer: Peer = { info, pc, dc: null, state: 'connecting', reasm: new Reassembler(), pendingIce: [] };
		this.peers.set(info.id, peer);
		pc.onicecandidate = (e) => {
			if (e.candidate) this.signal(info.id, { kind: 'ice', candidate: e.candidate.toJSON() });
		};
		pc.onconnectionstatechange = () => {
			if (pc.connectionState === 'failed') {
				peer.state = 'failed';
				this.emitPeers();
			} else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
				// Wait for the relay to confirm departure, but reflect it in the UI.
				peer.state = 'connecting';
				this.emitPeers();
			}
		};
		if (initiator) {
			this.setupChannel(peer, pc.createDataChannel('moxel', { ordered: true }));
			void (async () => {
				await pc.setLocalDescription(await pc.createOffer());
				this.signal(info.id, { kind: 'sdp', description: pc.localDescription!.toJSON() });
			})();
		} else pc.ondatachannel = (e) => this.setupChannel(peer, e.channel);
	}

	private setupChannel(peer: Peer, dc: RTCDataChannel) {
		dc.binaryType = 'arraybuffer';
		peer.dc = dc;
		dc.onopen = () => {
			peer.state = 'connected';
			this.emitPeers();
			this.ev.onPeerConnected(peer.info.id);
		};
		dc.onclose = () => {
			if (this.peers.get(peer.info.id) === peer) {
				peer.state = 'connecting';
				this.emitPeers();
			}
		};
		dc.onmessage = (e) => {
			if (!(e.data instanceof ArrayBuffer)) return;
			const whole = peer.reasm.push(new Uint8Array(e.data));
			if (!whole) return;
			try {
				this.ev.onMessage(peer.info.id, decodeMessage(whole));
			} catch (err) {
				console.warn('Bad message from peer', err);
			}
		};
	}

	private async onSignal(from: string, data: SignalData) {
		const peer = this.peers.get(from);
		if (!peer) return;
		const pc = peer.pc;
		try {
			if (data.kind === 'sdp') {
				await pc.setRemoteDescription(data.description);
				for (const c of peer.pendingIce.splice(0)) await pc.addIceCandidate(c);
				if (data.description.type === 'offer') {
					await pc.setLocalDescription(await pc.createAnswer());
					this.signal(from, { kind: 'sdp', description: pc.localDescription!.toJSON() });
				}
			} else if (data.kind === 'ice') {
				if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
				else peer.pendingIce.push(data.candidate);
			}
		} catch (e) {
			console.warn('Signaling error', e);
		}
	}

	private removePeer(id: string) {
		const p = this.peers.get(id);
		if (!p) return;
		p.dc?.close();
		p.pc.close();
		this.peers.delete(id);
		this.emitPeers();
	}

	private emitPeers() {
		this.ev.onPeers([...this.peers.values()].map((p) => ({ ...p.info, state: p.state })));
	}

	connectedIds(): string[] {
		return [...this.peers.values()].filter((p) => p.state === 'connected').map((p) => p.info.id);
	}

	peerInfo(id: string) {
		return this.peers.get(id)?.info;
	}

	allPeers(): PeerInfo[] {
		return [...this.peers.values()].map((p) => p.info);
	}

	send(to: string, msg: unknown) {
		const p = this.peers.get(to);
		if (!p?.dc || p.dc.readyState !== 'open') return;
		const bytes = encodeMessage(msg);
		for (const c of chunk(bytes, this.msgId++)) p.dc.send(c as Uint8Array<ArrayBuffer>);
	}

	broadcast(msg: unknown) {
		const ids = this.connectedIds();
		if (!ids.length) return;
		const bytes = encodeMessage(msg);
		const chunks = chunk(bytes, this.msgId++);
		for (const id of ids) {
			const dc = this.peers.get(id)!.dc!;
			for (const c of chunks) dc.send(c as Uint8Array<ArrayBuffer>);
		}
	}

	/** Bytes waiting to go out — used to back off cursor/mirror updates on slow links. */
	buffered(): number {
		let n = 0;
		for (const p of this.peers.values()) n = Math.max(n, p.dc?.bufferedAmount ?? 0);
		return n;
	}

	close() {
		this.closed = true;
		for (const id of [...this.peers.keys()]) this.removePeer(id);
		this.ws?.close();
		this.ws = null;
	}
}

type SignalData =
	{ kind: 'sdp'; description: RTCSessionDescriptionInit } | { kind: 'ice'; candidate: RTCIceCandidateInit };
