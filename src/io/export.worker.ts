/// <reference lib="webworker" />
import { MoxelDocument } from '../core/document/document';
import type { DocSnapshot } from '../core/document/types';
import { runExport, type ExportJob } from './runExport';

/**
 * Off-main-thread encoding. The worker rebuilds the document from a snapshot and runs the same
 * export code the tests cover, so the UI stays responsive while a long animation becomes a GIF.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<{ id: number; snapshot: DocSnapshot; job: ExportJob }>) => {
	const { id, snapshot, job } = e.data;
	try {
		const bytes = runExport(MoxelDocument.fromSnapshot(snapshot), job);
		scope.postMessage({ id, bytes }, [bytes.buffer]);
	} catch (err) {
		scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
	}
};
