import { TOOL_INFO } from '../core/tools/registry';
import type { ToolId } from '../core/tools/types';

export const isMac =
	typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl+';
export const SHIFT = isMac ? '⇧' : 'Shift+';
export const ALT = isMac ? '⌥' : 'Alt+';

export function sc(keys: string, opts: { mod?: boolean; shift?: boolean; alt?: boolean } = {}) {
	return `${opts.mod ? MOD : ''}${opts.alt ? ALT : ''}${opts.shift ? SHIFT : ''}${keys}`;
}

/** Commands bound to keys. Single-letter tool keys come from the tool registry. */
export type CommandId =
	| 'undo'
	| 'redo'
	| 'save'
	| 'open'
	| 'export'
	| 'selectAll'
	| 'deselect'
	| 'invert'
	| 'copy'
	| 'copyMerged'
	| 'cut'
	| 'paste'
	| 'delete'
	| 'newLayer'
	| 'duplicateLayer'
	| 'mergeDown'
	| 'groupLayer'
	| 'fit'
	| 'actual'
	| 'zoomIn'
	| 'zoomOut'
	| 'brushSmaller'
	| 'brushBigger'
	| 'swapColors'
	| 'resetColors'
	| 'prevFrame'
	| 'nextFrame'
	| 'play'
	| 'escape'
	| 'help'
	| 'flipH'
	| 'flipV'
	| 'rotateLeft'
	| 'rotateRight'
	| 'flipView';

interface Binding {
	key: string;
	mod?: boolean;
	shift?: boolean;
	alt?: boolean;
	cmd: CommandId;
}

const BINDINGS: Binding[] = [
	{ key: 'z', mod: true, cmd: 'undo' },
	{ key: 'z', mod: true, shift: true, cmd: 'redo' },
	{ key: 'y', mod: true, cmd: 'redo' },
	{ key: 's', mod: true, cmd: 'save' },
	{ key: 's', mod: true, shift: true, cmd: 'export' },
	{ key: 'o', mod: true, cmd: 'open' },
	{ key: 'a', mod: true, cmd: 'selectAll' },
	{ key: 'd', mod: true, cmd: 'deselect' },
	{ key: 'i', mod: true, shift: true, cmd: 'invert' },
	{ key: 'c', mod: true, cmd: 'copy' },
	{ key: 'c', mod: true, shift: true, cmd: 'copyMerged' },
	{ key: 'x', mod: true, cmd: 'cut' },
	{ key: 'v', mod: true, cmd: 'paste' },
	{ key: 'delete', cmd: 'delete' },
	{ key: 'backspace', cmd: 'delete' },
	{ key: 'n', mod: true, shift: true, cmd: 'newLayer' },
	{ key: 'j', mod: true, cmd: 'duplicateLayer' },
	{ key: 'e', mod: true, cmd: 'mergeDown' },
	{ key: 'g', mod: true, cmd: 'groupLayer' },
	{ key: '0', mod: true, cmd: 'fit' },
	{ key: '1', mod: true, cmd: 'actual' },
	{ key: '=', mod: true, cmd: 'zoomIn' },
	{ key: '+', mod: true, cmd: 'zoomIn' },
	{ key: '-', mod: true, cmd: 'zoomOut' },
	{ key: '=', cmd: 'zoomIn' },
	{ key: '+', cmd: 'zoomIn' },
	{ key: '-', cmd: 'zoomOut' },
	{ key: '[', cmd: 'brushSmaller' },
	{ key: ']', cmd: 'brushBigger' },
	{ key: 'x', cmd: 'swapColors' },
	{ key: 'd', cmd: 'resetColors' },
	{ key: ',', cmd: 'prevFrame' },
	{ key: '.', cmd: 'nextFrame' },
	{ key: 'enter', cmd: 'play' },
	{ key: 'escape', cmd: 'escape' },
	{ key: '?', shift: true, cmd: 'help' },
	{ key: 'f1', cmd: 'help' },
	{ key: 'h', shift: true, cmd: 'flipH' },
	{ key: 'v', shift: true, cmd: 'flipV' },
	// Paint documents: rotate the view with Shift+, / Shift+. (the < and > keys), mirror it with Shift+M.
	{ key: '<', shift: true, cmd: 'rotateLeft' },
	{ key: '>', shift: true, cmd: 'rotateRight' },
	{ key: 'm', shift: true, cmd: 'flipView' }
];

const TOOL_KEYS = new Map<string, ToolId>(
	TOOL_INFO.filter((t) => t.key).map((t) => [t.key!.toLowerCase(), t.id])
);

export type KeyResult = { type: 'command'; cmd: CommandId } | { type: 'tool'; tool: ToolId } | null;

export function resolveKey(e: KeyboardEvent): KeyResult {
	const key = e.key.toLowerCase();
	const mod = isMac ? e.metaKey : e.ctrlKey;
	for (const b of BINDINGS) {
		if (b.key !== key) continue;
		if (!!b.mod !== mod) continue;
		// '?' and '+' need Shift to type; don't require an exact Shift match for them.
		if (key !== '?' && key !== '+' && !!b.shift !== e.shiftKey) continue;
		if (!!b.alt !== e.altKey) continue;
		return { type: 'command', cmd: b.cmd };
	}
	if (!mod && !e.altKey && !e.shiftKey) {
		const tool = TOOL_KEYS.get(key);
		if (tool) return { type: 'tool', tool };
	}
	return null;
}

export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
	{
		title: 'Tools',
		items: TOOL_INFO.filter((t) => t.key)
			.map((t) => [t.key!, t.label] as [string, string])
			.concat([
				['Space (hold)', 'Temporary hand / pan'],
				['Right-click', 'Pick colour']
			])
	},
	{
		title: 'Edit',
		items: [
			[sc('Z', { mod: true }), 'Undo'],
			[sc('Z', { mod: true, shift: true }), 'Redo'],
			[sc('C', { mod: true }), 'Copy'],
			[sc('C', { mod: true, shift: true }), 'Copy merged'],
			[sc('X', { mod: true }), 'Cut'],
			[sc('V', { mod: true }), 'Paste as new layer'],
			['Delete', 'Clear selection'],
			[sc('A', { mod: true }), 'Select all'],
			[sc('D', { mod: true }), 'Deselect'],
			[sc('I', { mod: true, shift: true }), 'Invert selection'],
			[sc('H', { shift: true }), 'Flip selection horizontally'],
			[sc('V', { shift: true }), 'Flip selection vertically'],
			['Arrow keys', 'Nudge (Move tool), Shift ×10']
		]
	},
	{
		title: 'File & layers',
		items: [
			[sc('S', { mod: true }), 'Save now (autosave is always on)'],
			[sc('S', { mod: true, shift: true }), 'Export…'],
			[sc('O', { mod: true }), 'Open / import file'],
			[sc('N', { mod: true, shift: true }), 'New layer'],
			[sc('J', { mod: true }), 'Duplicate layer'],
			[sc('E', { mod: true }), 'Merge down'],
			[sc('G', { mod: true }), 'Group layer']
		]
	},
	{
		title: 'View & colour',
		items: [
			[sc('0', { mod: true }), 'Fit to screen'],
			[sc('1', { mod: true }), 'Actual pixels'],
			['+ / −', 'Zoom in / out'],
			['[ / ]', 'Brush size'],
			[`${SHIFT}, / ${SHIFT}.`, 'Rotate view (paint)'],
			[sc('M', { shift: true }), 'Mirror view (paint)'],
			['X', 'Swap colours'],
			['D', 'Default colours'],
			[', / .', 'Previous / next frame'],
			['Enter', 'Play / pause animation']
		]
	}
];
