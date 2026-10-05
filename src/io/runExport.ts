import type { MoxelDocument } from '../core/document/document';
import { exportFlattenedPNG, exportGIF, minecraftAnimation, spriteSheet, type SheetLayout } from './export';
import { encodeMoxel } from './moxelFile';

export type ExportJob =
	| { kind: 'png'; frameId: string; scale: number }
	| { kind: 'gif'; scale: number }
	| { kind: 'sheet'; layout: SheetLayout; scale: number }
	| { kind: 'mcanim'; baseName: string }
	| { kind: 'moxel' };

/** Every export, as one pure function of the document — shared by the worker and its fallback. */
export function runExport(doc: MoxelDocument, job: ExportJob): Uint8Array {
	switch (job.kind) {
		case 'png':
			return exportFlattenedPNG(doc, job.frameId, job.scale);
		case 'gif':
			return exportGIF(doc, job.scale);
		case 'sheet':
			return spriteSheet(doc, job.layout, job.scale).png;
		case 'mcanim':
			return minecraftAnimation(doc, job.baseName).zip;
		case 'moxel':
			return encodeMoxel(doc);
	}
}
