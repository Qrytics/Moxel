import { brushTool, cloneTool, eraserTool, pencilTool } from './paintTools';
import {
	ellipseTool,
	eyedropperTool,
	fillTool,
	handTool,
	lassoTool,
	lineTool,
	moveTool,
	rectTool,
	selectEllipseTool,
	selectRectTool,
	wandTool,
	zoomTool
} from './otherTools';
import type { Tool, ToolId } from './types';

export const TOOLS: Record<ToolId, Tool> = {
	brush: brushTool,
	pencil: pencilTool,
	eraser: eraserTool,
	fill: fillTool,
	eyedropper: eyedropperTool,
	line: lineTool,
	rect: rectTool,
	ellipse: ellipseTool,
	'select-rect': selectRectTool,
	'select-ellipse': selectEllipseTool,
	lasso: lassoTool,
	wand: wandTool,
	move: moveTool,
	clone: cloneTool,
	hand: handTool,
	zoom: zoomTool
};

export interface ToolInfo {
	id: ToolId;
	label: string;
	key?: string;
	group: 'select' | 'paint' | 'shape' | 'color' | 'view';
	hint: string;
}

/** Toolbar order, labels and single-key shortcuts. */
export const TOOL_INFO: ToolInfo[] = [
	{
		id: 'move',
		label: 'Move',
		key: 'V',
		group: 'select',
		hint: 'Drag selected pixels or the whole layer. Alt-drag moves a copy; arrow keys nudge.'
	},
	{
		id: 'select-rect',
		label: 'Rectangle select',
		key: 'M',
		group: 'select',
		hint: 'Shift adds, Alt subtracts, Shift+Alt intersects.'
	},
	{ id: 'select-ellipse', label: 'Ellipse select', group: 'select', hint: 'Shift adds, Alt subtracts.' },
	{ id: 'lasso', label: 'Lasso', key: 'L', group: 'select', hint: 'Draw a freeform selection.' },
	{ id: 'wand', label: 'Magic wand', key: 'W', group: 'select', hint: 'Select pixels of similar colour.' },
	{
		id: 'pencil',
		label: 'Pencil',
		key: 'P',
		group: 'paint',
		hint: 'Hard pixel strokes. Shift-click draws a straight line.'
	},
	{
		id: 'brush',
		label: 'Brush',
		key: 'B',
		group: 'paint',
		hint: 'Soft or hard brush with size, hardness, spacing and pressure.'
	},
	{ id: 'eraser', label: 'Eraser', key: 'E', group: 'paint', hint: 'Erase to transparency.' },
	{
		id: 'fill',
		label: 'Fill',
		key: 'G',
		group: 'paint',
		hint: 'Fill similar connected pixels. Shift fills every matching pixel.'
	},
	{
		id: 'clone',
		label: 'Clone stamp',
		key: 'S',
		group: 'paint',
		hint: 'Alt-click to pick a source, then paint.'
	},
	{ id: 'line', label: 'Line', key: 'U', group: 'shape', hint: 'Shift snaps to 45°.' },
	{
		id: 'rect',
		label: 'Rectangle',
		key: 'R',
		group: 'shape',
		hint: 'Shift for a square, Alt draws from the centre.'
	},
	{
		id: 'ellipse',
		label: 'Ellipse',
		key: 'O',
		group: 'shape',
		hint: 'Shift for a circle, Alt draws from the centre.'
	},
	{
		id: 'eyedropper',
		label: 'Eyedropper',
		key: 'I',
		group: 'color',
		hint: 'Pick a colour. Alt picks the background colour.'
	},
	{ id: 'hand', label: 'Hand', key: 'H', group: 'view', hint: 'Pan the canvas. Hold Space with any tool.' },
	{ id: 'zoom', label: 'Zoom', key: 'Z', group: 'view', hint: 'Click to zoom in, Alt-click to zoom out.' }
];
