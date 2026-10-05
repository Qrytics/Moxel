import type { MoxelDocument } from '../document/document';
import { applyOp, opBytes, type Op } from '../document/ops';

export interface HistoryEntry {
	label: string;
	/** Forward ops, in application order. */
	ops: Op[];
	/** Inverses in the order they were captured; undo applies them reversed. */
	inverse: Op[];
	bytes: number;
	time: number;
	mergeKey?: string;
}

export type CommitKind = 'do' | 'undo' | 'redo';

export interface HistoryOptions {
	maxEntries?: number;
	maxBytes?: number;
	/**
	 * Called with the ops actually applied to the document and their inverses (index-aligned) —
	 * what a live session broadcasts. Patch inverses carry both before (`data`) and after (`expect`).
	 */
	onApplied?: (ops: Op[], kind: CommitKind, label: string, inverses: Op[]) => void;
}

export class Transaction {
	readonly ops: Op[] = [];
	readonly inverse: Op[] = [];
	constructor(private doc: MoxelDocument) {}

	/** Apply an op now and record it. Returns false if it no longer applied. */
	apply(op: Op): boolean {
		const inv = applyOp(this.doc, op);
		if (!inv) return false;
		this.ops.push(op);
		this.inverse.push(inv);
		return true;
	}

	/** Record an op whose effect is already on the document (e.g. a live brush stroke). */
	recordApplied(op: Op, inverse: Op): void {
		this.ops.push(op);
		this.inverse.push(inverse);
	}
}

/**
 * Command-based undo/redo. One user gesture = one entry: a brush stroke, a layer reorder, a fill.
 * Memory is bounded by both entry count and bytes, since a stroke on a 1024² canvas can carry
 * megabytes of before/after pixels.
 */
export class History {
	private undoStack: HistoryEntry[] = [];
	private redoStack: HistoryEntry[] = [];
	private listeners = new Set<() => void>();
	private bytes = 0;
	readonly maxEntries: number;
	readonly maxBytes: number;
	onApplied?: HistoryOptions['onApplied'];

	constructor(
		private doc: MoxelDocument,
		opts: HistoryOptions = {}
	) {
		this.maxEntries = opts.maxEntries ?? 200;
		this.maxBytes = opts.maxBytes ?? 256 * 1024 * 1024;
		this.onApplied = opts.onApplied;
	}

	get canUndo() {
		return this.undoStack.length > 0;
	}
	get canRedo() {
		return this.redoStack.length > 0;
	}
	get undoLabel() {
		return this.undoStack.at(-1)?.label;
	}
	get redoLabel() {
		return this.redoStack.at(-1)?.label;
	}
	get size() {
		return this.undoStack.length;
	}

	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	private notify() {
		for (const fn of this.listeners) fn();
	}

	/** Run `fn` as a single undoable step. Nothing is recorded if it applied no ops. */
	transact(label: string, fn: (tx: Transaction) => void, mergeKey?: string): boolean {
		const tx = new Transaction(this.doc);
		fn(tx);
		return this.commit(label, tx, mergeKey);
	}

	commit(label: string, tx: Transaction, mergeKey?: string): boolean {
		if (tx.ops.length === 0) return false;
		const bytes = tx.ops.reduce((s, o) => s + opBytes(o), 0) + tx.inverse.reduce((s, o) => s + opBytes(o), 0);
		const last = this.undoStack.at(-1);
		if (mergeKey && last && last.mergeKey === mergeKey && Date.now() - last.time < 1500) {
			last.ops.push(...tx.ops);
			last.inverse.push(...tx.inverse);
			last.bytes += bytes;
			last.time = Date.now();
		} else {
			this.undoStack.push({ label, ops: tx.ops, inverse: tx.inverse, bytes, time: Date.now(), mergeKey });
		}
		this.bytes += bytes;
		this.clearRedo();
		this.trim();
		this.onApplied?.(tx.ops, 'do', label, tx.inverse);
		this.notify();
		return true;
	}

	undo(): boolean {
		const e = this.undoStack.pop();
		if (!e) return false;
		this.bytes -= e.bytes;
		const applied: Op[] = [];
		const redoInverse: Op[] = [];
		for (let i = e.inverse.length - 1; i >= 0; i--) {
			const inv = applyOp(this.doc, e.inverse[i]);
			if (inv) {
				applied.push(e.inverse[i]);
				redoInverse.push(inv);
			}
		}
		// Redo re-applies the forward ops; applying `redoInverse` reversed is exactly that.
		const redo: HistoryEntry = {
			label: e.label,
			ops: applied,
			inverse: redoInverse,
			bytes: e.bytes,
			time: Date.now()
		};
		this.redoStack.push(redo);
		this.bytes += redo.bytes;
		this.onApplied?.(applied, 'undo', e.label, redoInverse);
		this.notify();
		return true;
	}

	redo(): boolean {
		const e = this.redoStack.pop();
		if (!e) return false;
		this.bytes -= e.bytes;
		const ops: Op[] = [];
		const inverse: Op[] = [];
		for (let i = e.inverse.length - 1; i >= 0; i--) {
			const inv = applyOp(this.doc, e.inverse[i]);
			if (inv) {
				ops.push(e.inverse[i]);
				inverse.push(inv);
			}
		}
		this.undoStack.push({ label: e.label, ops, inverse, bytes: e.bytes, time: Date.now() });
		this.bytes += e.bytes;
		this.onApplied?.(ops, 'redo', e.label, inverse);
		this.notify();
		return true;
	}

	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.bytes = 0;
		this.notify();
	}

	private clearRedo() {
		for (const e of this.redoStack) this.bytes -= e.bytes;
		this.redoStack = [];
	}

	private trim() {
		while (
			this.undoStack.length > 1 &&
			(this.undoStack.length > this.maxEntries || this.bytes > this.maxBytes)
		) {
			const e = this.undoStack.shift()!;
			this.bytes -= e.bytes;
		}
	}
}
