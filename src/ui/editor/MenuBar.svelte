<script lang="ts">
	import type { EditorState } from '../../state/editor.svelte';
	import { app } from '../../state/app.svelte';
	import { sc } from '../../state/shortcuts';
	import Menu, { type MenuItem } from '../Menu.svelte';

	let {
		ed,
		run
	}: {
		ed: EditorState;
		run: (cmd: string) => void;
	} = $props();

	const hasSel = () => ed.selection.active;
	const isSkin = () => ed.doc.meta.kind === 'skin';

	const menus: [string, () => MenuItem[]][] = [
		[
			'File',
			() => [
				{ label: 'New project…', action: () => run('newProject') },
				{ label: 'Open / import file…', shortcut: sc('O', { mod: true }), action: () => run('open') },
				{ label: 'Import image as layer…', action: () => run('importLayer') },
				{ label: 'All projects', action: () => run('home') },
				{ separator: true, label: '' },
				{ label: 'Save now', shortcut: sc('S', { mod: true }), action: () => run('save') },
				{ label: 'Duplicate project', action: () => run('duplicateProject') },
				{ separator: true, label: '' },
				{ label: 'Export…', shortcut: sc('S', { mod: true, shift: true }), action: () => run('export') },
				{ label: 'Export project (.moxel)', action: () => run('exportProject') },
				{ label: 'Download backup of all projects', action: () => run('backup') }
			]
		],
		[
			'Edit',
			() => [
				{
					label: ed.history.undoLabel ? `Undo ${ed.history.undoLabel}` : 'Undo',
					shortcut: sc('Z', { mod: true }),
					disabled: !ed.history.canUndo,
					action: () => ed.undo()
				},
				{
					label: ed.history.redoLabel ? `Redo ${ed.history.redoLabel}` : 'Redo',
					shortcut: sc('Z', { mod: true, shift: true }),
					disabled: !ed.history.canRedo,
					action: () => ed.redo()
				},
				{ separator: true, label: '' },
				{ label: 'Cut', shortcut: sc('X', { mod: true }), action: () => ed.cut() },
				{ label: 'Copy', shortcut: sc('C', { mod: true }), action: () => ed.copy() },
				{ label: 'Copy merged', shortcut: sc('C', { mod: true, shift: true }), action: () => ed.copy(true) },
				{
					label: 'Paste as new layer',
					shortcut: sc('V', { mod: true }),
					disabled: !ed.clipboard,
					action: () => ed.paste()
				},
				{ label: 'Clear', shortcut: 'Delete', action: () => ed.deleteSelected() },
				{ separator: true, label: '' },
				{ label: 'Flip horizontal', shortcut: sc('H', { shift: true }), action: () => ed.transform('flipH') },
				{ label: 'Flip vertical', shortcut: sc('V', { shift: true }), action: () => ed.transform('flipV') },
				{ label: 'Rotate 90° clockwise', action: () => ed.transform('rotateCW') },
				{ label: 'Rotate 90° counter-clockwise', action: () => ed.transform('rotateCCW') },
				{ label: 'Rotate 180°', action: () => ed.transform('rotate180') },
				{ label: 'Scale selection…', disabled: !hasSel(), action: () => run('scaleSelection') },
				{ separator: true, label: '' },
				{ label: 'Define brush from selection', disabled: !hasSel(), action: () => ed.defineBrush() }
			]
		],
		[
			'Select',
			() => [
				{ label: 'All', shortcut: sc('A', { mod: true }), action: () => ed.selection.selectAll() },
				{
					label: 'Deselect',
					shortcut: sc('D', { mod: true }),
					disabled: !hasSel(),
					action: () => ed.selection.clear()
				},
				{
					label: 'Invert',
					shortcut: sc('I', { mod: true, shift: true }),
					action: () => ed.selection.invert()
				},
				{ label: 'Layer pixels', action: () => ed.selectLayerPixels() }
			]
		],
		[
			'Image',
			() => [
				...(isSkin()
					? [
							{ label: 'Skin model', heading: true },
							{
								label: 'Classic (4px arms)',
								checked: ed.doc.meta.skin?.model !== 'slim',
								action: () => run('modelClassic')
							},
							{
								label: 'Slim (3px arms)',
								checked: ed.doc.meta.skin?.model === 'slim',
								action: () => run('modelSlim')
							},
							{ separator: true, label: '' }
						]
					: []),
				{ label: 'Canvas size…', action: () => run('canvasSize') },
				{ label: 'Scale image…', action: () => run('scaleImage') },
				{ separator: true, label: '' },
				{ label: 'Flip canvas horizontally', action: () => ed.cmd.flipCanvas('h') },
				{ label: 'Flip canvas vertically', action: () => ed.cmd.flipCanvas('v') },
				{ label: 'Rotate canvas 90° clockwise', action: () => ed.cmd.rotateCanvas(1) },
				{ label: 'Rotate canvas 90° counter-clockwise', action: () => ed.cmd.rotateCanvas(3) },
				{ label: 'Rotate canvas 180°', action: () => ed.cmd.rotateCanvas(2) },
				{ separator: true, label: '' },
				{ label: 'Check for problems…', action: () => run('export') }
			]
		],
		[
			'Layer',
			() => [
				{ label: 'New layer', shortcut: sc('N', { mod: true, shift: true }), action: () => run('newLayer') },
				{ label: 'New group', action: () => ed.setLayer(ed.cmd.addGroup(undefined, ed.activeLayerId)) },
				{ label: 'Duplicate layer', shortcut: sc('J', { mod: true }), action: () => run('duplicateLayer') },
				{ label: 'Delete layer', action: () => run('deleteLayer') },
				{ separator: true, label: '' },
				{
					label: 'Merge down',
					shortcut: sc('E', { mod: true }),
					disabled: !ed.cmd.layerBelow(ed.activeLayerId),
					action: () => run('mergeDown')
				},
				{ label: 'Group layer', shortcut: sc('G', { mod: true }), action: () => run('groupLayer') },
				{ label: 'Flatten image', action: () => ed.setLayer(ed.cmd.flatten()) },
				{ separator: true, label: '' },
				{ label: 'Clear layer', action: () => ed.cmd.clearLayer(ed.activeLayerId, ed.activeFrameId) }
			]
		],
		[
			'Animation',
			() => [
				{
					label: ed.playing ? 'Pause' : 'Play',
					shortcut: 'Enter',
					disabled: ed.doc.frames.length < 2,
					action: () => ed.togglePlay()
				},
				{ label: 'Previous frame', shortcut: ',', action: () => ed.stepFrame(-1) },
				{ label: 'Next frame', shortcut: '.', action: () => ed.stepFrame(1) },
				{ separator: true, label: '' },
				{ label: 'New frame', action: () => ed.setFrame(ed.cmd.addFrame(ed.activeFrameId, false)) },
				{ label: 'Duplicate frame', action: () => ed.setFrame(ed.cmd.addFrame(ed.activeFrameId, true)) },
				{
					label: 'Delete frame',
					disabled: ed.doc.frames.length < 2,
					action: () => ed.cmd.deleteFrame(ed.activeFrameId)
				},
				{ separator: true, label: '' },
				{
					label: 'Onion skin',
					checked: ed.doc.meta.animation.onionSkin,
					action: () =>
						ed.cmd.setMeta(
							{ animation: { ...ed.doc.meta.animation, onionSkin: !ed.doc.meta.animation.onionSkin } },
							'Onion skin'
						)
				},
				{
					label: 'Show timeline',
					checked: ed.showTimeline,
					action: () => (ed.showTimeline = !ed.showTimeline)
				}
			]
		],
		[
			'View',
			() => [
				{ label: 'Workspace', heading: true },
				{ label: '2D canvas', checked: ed.workspace === '2d', action: () => (ed.workspace = '2d') },
				{
					label: 'Split (2D + 3D)',
					checked: ed.workspace === 'split',
					action: () => (ed.workspace = 'split')
				},
				{ label: '3D preview', checked: ed.workspace === '3d', action: () => (ed.workspace = '3d') },
				{ separator: true, label: '' },
				{ label: 'Zoom in', shortcut: '+', action: () => ed.zoomStep(1) },
				{ label: 'Zoom out', shortcut: '−', action: () => ed.zoomStep(-1) },
				{ label: 'Fit to screen', shortcut: sc('0', { mod: true }), action: () => ed.fit() },
				{ label: 'Actual pixels', shortcut: sc('1', { mod: true }), action: () => ed.actualSize() },
				{ separator: true, label: '' },
				{
					label: 'Pixel grid',
					checked: ed.display.pixelGrid,
					action: () => (ed.display.pixelGrid = !ed.display.pixelGrid)
				},
				{
					label: '8px tile grid',
					checked: ed.display.tileGrid === 8,
					action: () => (ed.display.tileGrid = ed.display.tileGrid === 8 ? 0 : 8)
				},
				{
					label: '16px tile grid',
					checked: ed.display.tileGrid === 16,
					action: () => (ed.display.tileGrid = ed.display.tileGrid === 16 ? 0 : 16)
				},
				{
					label: 'Transparency checkerboard',
					checked: ed.display.transparency === 'checker',
					action: () =>
						(ed.display.transparency = ed.display.transparency === 'checker' ? 'solid' : 'checker')
				},
				...(isSkin()
					? [
							{ separator: true, label: '' },
							{ label: 'Skin guides', heading: true },
							{
								label: 'Show UV guides',
								checked: ed.display.guides,
								action: () => (ed.display.guides = !ed.display.guides)
							},
							{
								label: 'Guide labels',
								checked: ed.display.guideLabels,
								action: () => (ed.display.guideLabels = !ed.display.guideLabels)
							},
							{
								label: 'Dim outer-layer areas',
								checked: ed.display.dimOverlay,
								action: () => (ed.display.dimOverlay = !ed.display.dimOverlay)
							}
						]
					: [])
			]
		],
		[
			'Help',
			() => [
				{ label: 'Keyboard shortcuts', shortcut: '?', action: () => run('shortcuts') },
				{ label: 'About Moxel & privacy', action: () => run('about') },
				{ separator: true, label: '' },
				{
					label: app.storageError
						? 'Storage: not available (memory only)'
						: 'Storage: saved locally in this browser',
					disabled: true
				}
			]
		]
	];
</script>

<nav class="menubar" aria-label="Main menu">
	{#each menus as [label, items] (label)}
		<Menu {label} {items}>
			{#snippet trigger()}{label}{/snippet}
		</Menu>
	{/each}
</nav>

<style>
	.menubar {
		display: flex;
		align-items: center;
		gap: 1px;
	}
</style>
