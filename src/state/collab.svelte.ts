import type { MoxelDocument } from '../core/document/document';
import type { CommitKind } from '../core/history/history';
import type { Op } from '../core/document/ops';
import { roomToken, uid } from '../core/id';
import { Mesh, type PeerInfo, type PeerState } from '../collab/mesh';
import {
	reconcileStructure,
	structureOf,
	SyncState,
	type NetPatch,
	type StructureSnapshot
} from '../collab/sync';
import { decodeMoxel, encodeMoxel } from '../io/moxelFile';
import { decodePNG, encodePNG } from '../io/png';
import type { EditorState } from './editor.svelte';
import { app } from './app.svelte';

export type LiveMode = 'together' | 'side';

type Msg =
	| { t: 'hello'; name: string; color: string; mode: LiveMode; docName?: string }
	| { t: 'snapshot-request' }
	| { t: 'snapshot'; bytes: Uint8Array; lamport: number }
	| { t: 'ops'; patches: NetPatch[]; ops: Op[] }
	| { t: 'structure'; s: StructureSnapshot }
	| { t: 'cursor'; x: number; y: number }
	| { t: 'mirror'; name: string; w: number; h: number; png: Uint8Array; kind: string };

export interface PeerView extends PeerInfo {
	state: PeerState;
	isHost: boolean;
}

export interface Mirror {
	id: string;
	name: string;
	color: string;
	docName: string;
	w: number;
	h: number;
	canvas: HTMLCanvasElement;
	cursor: { x: number; y: number } | null;
	version: number;
}

/**
 * One live session. "Together" mode shares a single canvas between everyone; "side" mode has each
 * person working on their own project while live mirrors of everyone else's canvas tile alongside.
 */
export class LiveSession {
	readonly selfId = uid('u');
	status = $state<'connecting' | 'online' | 'error' | 'waiting'>('connecting');
	error = $state<string | null>(null);
	peers = $state<PeerView[]>([]);
	mirrors = $state<Mirror[]>([]);
	/** The shared document (together mode) or the user's own document (side mode). */
	doc: MoxelDocument | null = null;
	docReady = $state(false);
	private mesh: Mesh;
	private sync: SyncState | null = null;
	private ed: EditorState | null = null;
	private structureTimer: ReturnType<typeof setTimeout> | null = null;
	private mirrorTimer: ReturnType<typeof setTimeout> | null = null;
	private cursorTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingCursor: { x: number; y: number } | null = null;
	private unsubCache: (() => void) | null = null;
	private snapshotRequested = false;

	constructor(
		readonly room: string,
		readonly mode: LiveMode,
		readonly name: string,
		readonly color: string,
		doc: MoxelDocument | null
	) {
		this.doc = doc;
		if (doc) {
			this.sync = new SyncState(doc, this.selfId);
			this.docReady = true;
		}
		this.mesh = new Mesh(
			room,
			{ id: this.selfId, name, color },
			{
				onStatus: (s, message) => {
					this.status = s === 'online' && !this.docReady && mode === 'together' ? 'waiting' : s;
					if (s === 'error') this.error = message ?? 'Live session error.';
				},
				onPeers: (peers) => this.updatePeers(peers),
				onPeerConnected: (id) => this.onPeerConnected(id),
				onMessage: (from, msg) => this.onMessage(from, msg as Msg)
			}
		);
		this.mesh.connect();
	}

	get inviteLink() {
		const base = `${location.origin}${import.meta.env.BASE_URL}`;
		return `${base}#/join/${this.room}?mode=${this.mode}`;
	}

	/** The participant who joined first is the authority for layer structure and snapshots. */
	get isHost() {
		const others = this.mesh.allPeers();
		if (!this.mesh.joinedAt) return false;
		return others.every(
			(p) => p.joinedAt > this.mesh.joinedAt || (p.joinedAt === this.mesh.joinedAt && p.id > this.selfId)
		);
	}

	private hostId(): string {
		const all = [{ id: this.selfId, joinedAt: this.mesh.joinedAt || Infinity }, ...this.mesh.allPeers()];
		all.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
		return all[0].id;
	}

	private updatePeers(peers: (PeerInfo & { state: PeerState })[]) {
		const host = this.hostId();
		const prev = new Set(this.peers.map((p) => p.id));
		this.peers = peers.map((p) => ({ ...p, isHost: p.id === host }));
		const now = new Set(peers.map((p) => p.id));
		for (const id of prev) if (!now.has(id)) this.onPeerLeft(id);
		this.mirrors = this.mirrors.filter((m) => now.has(m.id));
		this.syncCursors();
	}

	private onPeerLeft(id: string) {
		const p = this.peers.find((x) => x.id === id);
		if (p) app.toast(`${p.name} left the session.`);
		// Release layers the departed peer had claimed.
		if (this.mode === 'together' && this.isHost && this.doc) {
			const ops: Op[] = [];
			for (const n of this.doc.nodes.values())
				if (n.owner === id) ops.push({ t: 'setNode', id: n.id, props: { owner: undefined } });
			for (const op of ops) this.sync?.applyRemoteOp(op);
			if (ops.length) {
				this.mesh.broadcast({ t: 'ops', patches: [], ops } satisfies Msg);
				this.scheduleStructure();
			}
		}
	}

	private onPeerConnected(id: string) {
		this.mesh.send(id, {
			t: 'hello',
			name: this.name,
			color: this.color,
			mode: this.mode,
			docName: this.doc?.meta.name
		} satisfies Msg);
		if (this.mode === 'together' && !this.docReady && !this.snapshotRequested && id === this.hostId()) {
			this.snapshotRequested = true;
			this.mesh.send(id, { t: 'snapshot-request' } satisfies Msg);
		}
		if (this.mode === 'side') this.sendMirror(id);
	}

	private onMessage(from: string, msg: Msg) {
		switch (msg.t) {
			case 'hello': {
				const p = this.peers.find((x) => x.id === from);
				if (p && msg.mode === this.mode) app.toast(`${msg.name} joined the session.`, 'success');
				// If our first choice of host wasn't connected yet, ask whoever greets us first.
				if (this.mode === 'together' && !this.docReady && !this.snapshotRequested) {
					this.snapshotRequested = true;
					this.mesh.send(from, { t: 'snapshot-request' } satisfies Msg);
				}
				break;
			}
			case 'snapshot-request':
				if (this.doc && this.docReady && this.mode === 'together')
					this.mesh.send(from, {
						t: 'snapshot',
						bytes: encodeMoxel(this.doc),
						lamport: this.sync!.lamport
					} satisfies Msg);
				break;
			case 'snapshot':
				this.loadSnapshot(msg.bytes, msg.lamport);
				break;
			case 'ops':
				if (!this.sync || this.mode !== 'together') return;
				for (const op of msg.ops) this.sync.applyRemoteOp(op);
				for (const p of msg.patches) this.sync.applyRemotePatch(p);
				if (msg.ops.length && this.isHost) this.scheduleStructure();
				break;
			case 'structure':
				if (this.doc && this.mode === 'together' && from === this.hostId())
					reconcileStructure(this.doc, msg.s);
				break;
			case 'cursor':
				this.onCursor(from, msg.x, msg.y);
				break;
			case 'mirror':
				this.onMirror(from, msg);
				break;
		}
	}

	private loadSnapshot(bytes: Uint8Array, lamport: number) {
		try {
			const incoming = decodeMoxel(bytes);
			if (this.doc && this.docReady) {
				// Resync: replace contents in place so the open editor stays attached.
				const d = this.doc;
				d.meta = { ...incoming.meta, id: d.meta.id };
				d.nodes = incoming.nodes;
				d.root = incoming.root;
				d.frames = incoming.frames;
				d.cels = incoming.cels;
				d.emit({ type: 'reset' });
				this.sync!.setDocument(d);
				app.toast('Resynced with the host.', 'success');
			} else {
				this.doc = incoming;
				this.sync = new SyncState(incoming, this.selfId);
				this.docReady = true;
				if (this.status === 'waiting') this.status = 'online';
			}
			this.sync!.lamport = Math.max(this.sync!.lamport, lamport);
		} catch {
			this.error = "The shared canvas couldn't be loaded.";
			this.status = 'error';
		}
	}

	requestResync() {
		const host = this.hostId();
		if (host === this.selfId) return app.toast("You're the host — everyone else syncs to your canvas.");
		this.mesh.send(host, { t: 'snapshot-request' } satisfies Msg);
	}

	// ── editor integration ────────────────────────────────────────────────

	attach(ed: EditorState) {
		this.ed = ed;
		ed.peerId = this.selfId;
		if (this.mode === 'side') {
			this.doc = ed.doc;
			this.docReady = true;
		}
		ed.remote = {
			onLocalOps: (ops, kind, inverses) => this.onLocalOps(ops, kind, inverses),
			onCursor: (x, y) => this.queueCursor(x, y)
		};
		this.unsubCache?.();
		if (this.mode === 'side') {
			this.unsubCache = ed.cache.subscribe(() => this.scheduleMirror());
			this.scheduleMirror();
		}
		this.syncCursors();
	}

	detach() {
		if (this.ed) {
			this.ed.remote = null;
			this.ed.peers = [];
		}
		this.unsubCache?.();
		this.unsubCache = null;
		this.ed = null;
	}

	private onLocalOps(ops: Op[], _kind: CommitKind, inverses: Op[]) {
		if (this.mode !== 'together' || !this.sync) return;
		const patches: NetPatch[] = [];
		const structural: Op[] = [];
		ops.forEach((op, i) => {
			const inv = inverses[i];
			if (op.t === 'patch' && inv?.t === 'patch') {
				const np = this.sync!.localPatch(inv);
				if (np) patches.push(np);
			} else if (op.t !== 'patch') structural.push(op);
		});
		if (!patches.length && !structural.length) return;
		this.mesh.broadcast({ t: 'ops', patches, ops: structural } satisfies Msg);
		if (structural.length && this.isHost) this.scheduleStructure();
	}

	private scheduleStructure() {
		if (this.structureTimer) return;
		this.structureTimer = setTimeout(() => {
			this.structureTimer = null;
			if (this.doc && this.isHost)
				this.mesh.broadcast({ t: 'structure', s: structureOf(this.doc) } satisfies Msg);
		}, 250);
	}

	private queueCursor(x: number, y: number) {
		this.pendingCursor = { x, y };
		if (this.cursorTimer) return;
		this.cursorTimer = setTimeout(() => {
			this.cursorTimer = null;
			if (this.pendingCursor && this.mesh.buffered() < 256 * 1024)
				this.mesh.broadcast({ t: 'cursor', ...this.pendingCursor } satisfies Msg);
		}, 50);
	}

	private cursors = new Map<string, { x: number; y: number }>();
	private onCursor(from: string, x: number, y: number) {
		this.cursors.set(from, { x, y });
		const m = this.mirrors.find((mm) => mm.id === from);
		if (m) {
			m.cursor = { x, y };
			m.version++;
		}
		this.syncCursors();
	}

	private syncCursors() {
		if (!this.ed || this.mode !== 'together') return;
		this.ed.peers = this.peers
			.filter((p) => this.cursors.has(p.id))
			.map((p) => ({ id: p.id, name: p.name, color: p.color, ...this.cursors.get(p.id)! }));
	}

	private scheduleMirror() {
		if (this.mirrorTimer) return;
		const big = (this.doc?.width ?? 0) * (this.doc?.height ?? 0) > 256 * 256;
		this.mirrorTimer = setTimeout(
			() => {
				this.mirrorTimer = null;
				this.sendMirror();
			},
			big ? 900 : 250
		);
	}

	private sendMirror(to?: string) {
		if (!this.ed) return;
		const ed = this.ed;
		const data = ed.cache.frameData(ed.activeFrameId);
		const msg: Msg = {
			t: 'mirror',
			name: this.name,
			w: ed.doc.width,
			h: ed.doc.height,
			kind: ed.doc.meta.kind,
			png: encodePNG(data, ed.doc.width, ed.doc.height)
		};
		if (to) this.mesh.send(to, msg);
		else if (this.mesh.buffered() < 1024 * 1024) this.mesh.broadcast(msg);
		else this.scheduleMirror();
	}

	private onMirror(from: string, msg: Extract<Msg, { t: 'mirror' }>) {
		let img;
		try {
			img = decodePNG(msg.png);
		} catch {
			return;
		}
		const peer = this.peers.find((p) => p.id === from);
		let m = this.mirrors.find((x) => x.id === from);
		if (!m) {
			const canvas = document.createElement('canvas');
			m = {
				id: from,
				name: msg.name,
				color: peer?.color ?? '#6bd3ff',
				docName: '',
				w: 0,
				h: 0,
				canvas,
				cursor: null,
				version: 0
			};
			this.mirrors = [...this.mirrors, m];
			m = this.mirrors.at(-1)!;
		}
		m.canvas.width = img.width;
		m.canvas.height = img.height;
		m.canvas
			.getContext('2d')!
			.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
		m.w = img.width;
		m.h = img.height;
		m.name = msg.name;
		m.version++;
	}

	leave() {
		this.detach();
		this.mesh.close();
		for (const t of [this.structureTimer, this.mirrorTimer, this.cursorTimer]) if (t) clearTimeout(t);
	}
}

class CollabStore {
	session = $state<LiveSession | null>(null);

	displayName() {
		return app.settings.displayName.trim() || `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
	}

	/** Start a session from the open editor. */
	host(ed: EditorState, mode: LiveMode, name: string): LiveSession {
		this.session?.leave();
		void app.saveSettings({ displayName: name });
		const s = new LiveSession(roomToken(), mode, name, app.settings.cursorColor, ed.doc);
		s.attach(ed);
		this.session = s;
		return s;
	}

	join(room: string, mode: LiveMode, name: string): LiveSession {
		if (this.session?.room === room) return this.session;
		this.session?.leave();
		void app.saveSettings({ displayName: name });
		const s = new LiveSession(room, mode, name, app.settings.cursorColor, null);
		this.session = s;
		return s;
	}

	leave() {
		this.session?.leave();
		this.session = null;
	}
}

export const collab = new CollabStore();
