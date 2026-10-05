declare module 'gifenc' {
	type Palette = number[][];
	interface WriteFrameOptions {
		palette?: Palette;
		delay?: number;
		transparent?: boolean;
		transparentIndex?: number;
		repeat?: number;
		dispose?: number;
		first?: boolean;
	}
	interface Encoder {
		writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
		finish(): void;
		bytes(): Uint8Array;
		bytesView(): Uint8Array;
		reset(): void;
	}
	export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder;
	export function quantize(
		rgba: Uint8Array | Uint8ClampedArray,
		maxColors: number,
		opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444'; oneBitAlpha?: boolean | number; clearAlpha?: boolean }
	): Palette;
	export function applyPalette(
		rgba: Uint8Array | Uint8ClampedArray,
		palette: Palette,
		format?: 'rgb565' | 'rgb444' | 'rgba4444'
	): Uint8Array;
}
