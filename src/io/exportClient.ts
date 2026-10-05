import type { MoxelDocument } from '../core/document/document';
import { runExport, type ExportJob } from './runExport';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
	if (worker) return worker;
	if (typeof Worker === 'undefined') return null;
	try {
		worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
		worker.onmessage = (e: MessageEvent<{ id: number; bytes?: Uint8Array; error?: string }>) => {
			const p = pending.get(e.data.id);
			if (!p) return;
			pending.delete(e.data.id);
			if (e.data.bytes) p.resolve(e.data.bytes);
			else p.reject(new Error(e.data.error ?? 'Export failed'));
		};
		worker.onerror = () => {
			for (const p of pending.values()) p.reject(new Error('Export worker crashed'));
			pending.clear();
			worker = null;
		};
		return worker;
	} catch {
		return null;
	}
}

/** Encode an export in a worker, falling back to the main thread where workers are unavailable. */
export async function exportInWorker(doc: MoxelDocument, job: ExportJob): Promise<Uint8Array> {
	const w = getWorker();
	if (!w) {
		return runExport(doc, job);
	}
	const id = nextId++;
	// Copy the cels: the document keeps being edited while the worker encodes.
	const snapshot = doc.toSnapshot(true);
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		w.postMessage(
			{ id, snapshot, job },
			snapshot.cels.map(([, c]) => c.buffer as ArrayBuffer)
		);
	});
}
