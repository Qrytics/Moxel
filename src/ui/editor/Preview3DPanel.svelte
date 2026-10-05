<script lang="ts">
	import { onMount } from 'svelte';
	import type { EditorState } from '../../state/editor.svelte';
	import type {
		Limb,
		PreviewAnimation,
		Preview3D as Preview3DType,
		PreviewOptions
	} from '../../preview3d/preview';
	import { StrokeSession, stampDab } from '../../core/tools/stroke';
	import { canEdit } from '../../core/tools/paintTools';
	import { sampleColor } from '../../core/tools/otherTools';
	import { app } from '../../state/app.svelte';
	import Icon from '../Icon.svelte';
	import Menu from '../Menu.svelte';

	let { ed }: { ed: EditorState } = $props();

	let host: HTMLDivElement | undefined = $state();
	let preview: Preview3DType | null = null;
	let failed = $state<string | null>(null);
	let loading = $state(true);
	let paintMode = $state(false);
	let opts = $state<PreviewOptions>({
		parts: { head: true, body: true, rightArm: true, leftArm: true, rightLeg: true, leftLeg: true },
		overlay: true,
		grid: true,
		lighting: true,
		background: 'transparent',
		animation: 'none'
	});
	const isSkin = $derived.by(() => {
		void ed.metaVersion;
		return ed.doc.meta.kind === 'skin';
	});

	onMount(() => {
		let disposed = false;
		// three.js is loaded on demand so the 2D editor starts fast.
		import('../../preview3d/preview')
			.then(({ Preview3D }) => {
				if (disposed) return;
				try {
					preview = new Preview3D(host!, ed.doc, ed.cache);
					preview.setOptions($state.snapshot(opts));
				} catch (e) {
					failed = 'The 3D preview needs WebGL, which is unavailable in this browser.';
					console.warn(e);
				}
				loading = false;
			})
			.catch(() => {
				failed = "The 3D preview couldn't be loaded. Check your connection and reload.";
				loading = false;
			});
		return () => {
			disposed = true;
			preview?.dispose();
		};
	});

	// Model type or kind changed (classic ↔ slim): rebuild geometry.
	let lastModel = '';
	$effect(() => {
		void ed.metaVersion;
		void ed.structureVersion;
		const key = `${ed.doc.meta.kind}:${ed.doc.meta.skin?.model}:${ed.doc.width}x${ed.doc.height}:${ed.doc.meta.texture?.type}`;
		if (preview && key !== lastModel) {
			if (lastModel) preview.rebuild();
			lastModel = key;
		}
	});

	$effect(() => {
		preview?.setOptions($state.snapshot(opts));
	});

	$effect(() => {
		preview?.setPaintMode(paintMode);
	});

	function toggleLimb(l: Limb) {
		opts.parts[l] = !opts.parts[l];
	}

	// ── painting directly on the model ─────────────────────────────────────
	let stroke: StrokeSession | null = null;
	let lastTexel: string | null = null;

	function paintAt(e: PointerEvent, phase: 'down' | 'move') {
		if (!preview) return;
		const hit = preview.pick(e.clientX, e.clientY, e.shiftKey);
		if (!hit) return;
		const key = `${hit.x},${hit.y}`;
		if (phase === 'move' && key === lastTexel) return;
		lastTexel = key;
		const ctx = ed.ctx;
		if (ed.tool === 'eyedropper' || e.altKey) {
			const c = sampleColor(ctx, hit.x, hit.y, true);
			if (c && c[3] > 0) ed.setColor(c, 'fg');
			return;
		}
		if (phase === 'down') {
			if (!['pencil', 'brush', 'eraser'].includes(ed.tool)) ed.setTool('pencil');
			if (!canEdit(ctx)) return;
			const b =
				ed.tool === 'eraser'
					? ed.settings.eraser
					: ed.tool === 'brush'
						? ed.settings.brush
						: ed.settings.pencil;
			stroke = new StrokeSession(
				ed.doc,
				ed.activeLayerId,
				ed.activeFrameId,
				ed.tool === 'eraser' ? 'erase' : 'paint',
				ctx.fg,
				b.opacity,
				ed.selection.active ? ed.selection : null,
				ed.settings.symmetry === 'off' ? null : (i) => ed.mirror(i)
			);
		}
		if (!stroke) return;
		const size =
			ed.tool === 'brush'
				? ed.settings.brush.size
				: ed.tool === 'eraser'
					? ed.settings.eraser.size
					: ed.settings.pencil.size;
		// Brushes larger than a texel would spill across UV seams, so 3D painting is per texel.
		stampDab(stroke, hit.x + 0.5, hit.y + 0.5, Math.min(size, 2), 1, 'square', true, 1, null);
		stroke.flush();
	}

	function onPointerDown(e: PointerEvent) {
		if (!paintMode || e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		lastTexel = null;
		paintAt(e, 'down');
	}
	function onPointerMove(e: PointerEvent) {
		if (!paintMode || !(e.buttons & 1)) return;
		e.stopPropagation();
		paintAt(e, 'move');
	}
	function onPointerUp(e: PointerEvent) {
		if (!paintMode) return;
		e.stopPropagation();
		if (stroke && stroke.commit(ed.history, 'Paint on model')) ed.pushRecent(ed.ctx.fg);
		stroke = null;
	}

	async function saveRender() {
		const blob = await preview?.snapshot();
		if (!blob) return app.toast("Couldn't capture the 3D view.", 'error');
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `${ed.doc.meta.name || 'moxel'}-render.png`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 5000);
	}

	const limbs: [Limb, string][] = [
		['head', 'Head'],
		['body', 'Body'],
		['rightArm', 'Right arm'],
		['leftArm', 'Left arm'],
		['rightLeg', 'Right leg'],
		['leftLeg', 'Left leg']
	];
	const animations: [PreviewAnimation, string][] = [
		['none', 'Still'],
		['idle', 'Idle'],
		['walk', 'Walk'],
		['spin', 'Turntable']
	];
</script>

<section class="p3d" aria-label="3D preview">
	<div class="bar">
		<span class="title"><Icon name="cube" size={15} /> 3D preview</span>
		<div class="views">
			{#each ['front', 'back', 'left', 'right'] as v (v)}
				<button class="btn sm ghost" onclick={() => preview?.setView(v as 'front')}
					>{v[0].toUpperCase() + v.slice(1)}</button
				>
			{/each}
			<button
				class="icon-btn"
				aria-label="Reset camera"
				title="Reset camera"
				onclick={() => preview?.setView('reset')}><Icon name="reset" size={15} /></button
			>
		</div>
		<span class="spacer"></span>
		<button
			class="icon-btn"
			class:on={paintMode}
			aria-pressed={paintMode}
			aria-label="Paint on the model"
			title="Paint on the model (uses Pencil/Brush/Eraser colour; Alt-click picks a colour; Shift paints the outer layer)"
			onclick={() => (paintMode = !paintMode)}><Icon name="paint" size={16} /></button
		>
		<Menu
			label="3D preview options"
			align="right"
			triggerClass="icon-btn"
			items={() => [
				...(isSkin
					? [
							{ label: 'Body parts', heading: true },
							...limbs.map(([l, label]) => ({ label, checked: opts.parts[l], action: () => toggleLimb(l) })),
							{ label: 'Outer layer', checked: opts.overlay, action: () => (opts.overlay = !opts.overlay) },
							{ separator: true, label: '' },
							{ label: 'Animation', heading: true },
							...animations.map(([a, label]) => ({
								label,
								checked: opts.animation === a,
								action: () => (opts.animation = a)
							})),
							{ separator: true, label: '' }
						]
					: [
							{
								label: 'Turntable',
								checked: opts.animation === 'spin',
								action: () => (opts.animation = opts.animation === 'spin' ? 'none' : 'spin')
							},
							{ separator: true, label: '' }
						]),
				{ label: 'Grid', checked: opts.grid, action: () => (opts.grid = !opts.grid) },
				{ label: 'Lighting', checked: opts.lighting, action: () => (opts.lighting = !opts.lighting) },
				{ label: 'Background', heading: true },
				{
					label: 'Transparent',
					checked: opts.background === 'transparent',
					action: () => (opts.background = 'transparent')
				},
				{
					label: 'Dark',
					checked: opts.background === '#202127',
					action: () => (opts.background = '#202127')
				},
				{ label: 'Sky', checked: opts.background === '#7fb2ff', action: () => (opts.background = '#7fb2ff') },
				{
					label: 'Grass',
					checked: opts.background === '#6aa84f',
					action: () => (opts.background = '#6aa84f')
				},
				{
					label: 'White',
					checked: opts.background === '#ffffff',
					action: () => (opts.background = '#ffffff')
				},
				{ separator: true, label: '' },
				{ label: 'Save render as PNG', action: saveRender }
			]}
		>
			{#snippet trigger()}<Icon name="more" size={16} />{/snippet}
		</Menu>
	</div>
	<div
		class="stage"
		class:checker={opts.background === 'transparent'}
		class:painting={paintMode}
		bind:this={host}
		onpointerdowncapture={onPointerDown}
		onpointermovecapture={onPointerMove}
		onpointerupcapture={onPointerUp}
	>
		{#if loading}<div class="msg">Loading 3D preview…</div>{/if}
		{#if failed}<div class="msg err">{failed}</div>{/if}
		{#if isSkin && !loading && !failed}
			<div class="chips" role="group" aria-label="Show body parts">
				{#each limbs as [l, label] (l)}
					<button class="chip" aria-pressed={opts.parts[l]} onclick={() => toggleLimb(l)}>{label}</button>
				{/each}
				<button class="chip" aria-pressed={opts.overlay} onclick={() => (opts.overlay = !opts.overlay)}
					>Outer layer</button
				>
			</div>
		{/if}
		{#if paintMode}<div class="hint">
				Painting on model · drag empty space with the right mouse button to orbit
			</div>{/if}
	</div>
</section>

<style>
	.p3d {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		background: #1d1e23;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 6px 0 10px;
		border-bottom: 1px solid var(--line);
		background: var(--bg-1);
		overflow-x: auto;
		scrollbar-width: none;
		flex: none;
	}
	.title {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		white-space: nowrap;
	}
	.title :global(svg) {
		color: var(--accent);
	}
	.views {
		display: flex;
		gap: 1px;
		margin-left: 6px;
	}
	.spacer {
		flex: 1;
	}
	.stage {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	.stage.checker {
		background-size: 16px 16px;
		background-position:
			0 0,
			0 8px,
			8px -8px,
			-8px 0;
	}
	.stage.painting {
		cursor: crosshair;
	}
	.stage :global(.preview3d-canvas) {
		display: block;
		position: absolute;
		inset: 0;
		touch-action: none;
	}
	.msg {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		color: var(--text-2);
		padding: 20px;
		text-align: center;
	}
	.msg.err {
		color: var(--warn);
	}
	.chips {
		position: absolute;
		left: 8px;
		bottom: 8px;
		right: 8px;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		pointer-events: none;
		z-index: 2;
	}
	.chip {
		pointer-events: auto;
		height: 22px;
		padding: 0 8px;
		border-radius: 999px;
		border: 1px solid var(--line-2);
		background: rgba(27, 28, 33, 0.85);
		color: var(--text-3);
		font-size: 11px;
	}
	.chip[aria-pressed='true'] {
		color: var(--text);
		border-color: #3d5f82;
		background: rgba(30, 48, 71, 0.9);
	}
	.hint {
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		padding: 4px 10px;
		border-radius: 999px;
		background: rgba(27, 28, 33, 0.9);
		font-size: 11px;
		color: var(--text-2);
		white-space: nowrap;
		pointer-events: none;
		z-index: 2;
	}
	.msg {
		z-index: 1;
	}
</style>
