import { DEFAULT_PAINT_BRUSH, type PaintBrushSettings, type PaintToolId } from './types';

export interface BrushPreset {
	id: string;
	name: string;
	tool: PaintToolId;
	/** Only the fields that differ from the default brush. */
	settings: Partial<PaintBrushSettings>;
}

/** Built-in looks for paint documents. Applying one replaces the tool's settings except colour. */
export const BRUSH_PRESETS: BrushPreset[] = [
	{ id: 'soft-round', name: 'Soft round', tool: 'brush', settings: { size: 24, hardness: 0.3 } },
	{ id: 'hard-round', name: 'Hard round', tool: 'brush', settings: { size: 16, hardness: 0.95 } },
	{
		id: 'ink',
		name: 'Ink pen',
		tool: 'brush',
		settings: { size: 6, hardness: 0.9, spacing: 0.05, stabilizer: 0.55, pressureCurve: 'soft', taper: true }
	},
	{
		id: 'pencil',
		name: 'Pencil',
		tool: 'brush',
		settings: {
			size: 4,
			hardness: 0.7,
			opacity: 0.85,
			spacing: 0.1,
			grain: 0.7,
			grainScale: 1,
			stabilizer: 0.1,
			pressureSize: false,
			pressureOpacity: true
		}
	},
	{
		id: 'airbrush',
		name: 'Airbrush',
		tool: 'brush',
		settings: {
			size: 80,
			hardness: 0,
			flow: 0.06,
			spacing: 0.05,
			stabilizer: 0,
			pressureSize: false,
			pressureFlow: true
		}
	},
	{
		id: 'marker',
		name: 'Marker',
		tool: 'brush',
		settings: { size: 18, hardness: 0.85, opacity: 0.6, roundness: 0.55, angle: 35, pressureSize: false }
	},
	{
		id: 'chalk',
		name: 'Chalk',
		tool: 'brush',
		settings: {
			size: 22,
			hardness: 0.6,
			grain: 0.85,
			grainScale: 2,
			scatter: 0.15,
			sizeJitter: 0.2,
			opacityJitter: 0.3,
			pressureOpacity: true
		}
	},
	{
		id: 'calligraphy',
		name: 'Calligraphy',
		tool: 'brush',
		settings: { size: 20, hardness: 0.9, roundness: 0.2, angle: 45, spacing: 0.04, stabilizer: 0.4 }
	},
	{
		id: 'watercolor',
		name: 'Wash',
		tool: 'brush',
		settings: {
			size: 60,
			hardness: 0.15,
			flow: 0.25,
			opacity: 0.5,
			grain: 0.3,
			grainScale: 3,
			sizeJitter: 0.15
		}
	},
	{ id: 'soft-eraser', name: 'Soft eraser', tool: 'eraser', settings: { size: 40, hardness: 0.3 } },
	{ id: 'hard-eraser', name: 'Hard eraser', tool: 'eraser', settings: { size: 16, hardness: 0.95 } },
	{
		id: 'smudge',
		name: 'Finger',
		tool: 'smudge',
		settings: { size: 40, hardness: 0.2, strength: 0.75, stabilizer: 0 }
	},
	{
		id: 'smear',
		name: 'Long smear',
		tool: 'smudge',
		settings: { size: 30, hardness: 0.4, strength: 0.92, stabilizer: 0 }
	},
	{
		id: 'blur',
		name: 'Soft blur',
		tool: 'blur',
		settings: { size: 48, hardness: 0.1, strength: 0.5, stabilizer: 0 }
	},
	{
		id: 'sharpen',
		name: 'Sharpen',
		tool: 'blur',
		settings: { size: 32, hardness: 0.3, strength: -0.4, stabilizer: 0 }
	}
];

export const presetsFor = (tool: PaintToolId) => BRUSH_PRESETS.filter((p) => p.tool === tool);

export const presetSettings = (p: BrushPreset): PaintBrushSettings => ({
	...DEFAULT_PAINT_BRUSH,
	...p.settings
});
