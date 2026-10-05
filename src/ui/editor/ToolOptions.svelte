<script lang="ts">
	import { TOOL_INFO } from '../../core/tools/registry';
	import type { BrushSettings, SymmetryMode } from '../../core/tools/types';
	import type { EditorState } from '../../state/editor.svelte';
	import Icon from '../Icon.svelte';

	let { ed }: { ed: EditorState } = $props();

	const info = $derived(TOOL_INFO.find((t) => t.id === ed.tool)!);
	const brush = $derived<BrushSettings | null>(
		ed.tool === 'brush'
			? ed.settings.brush
			: ed.tool === 'pencil'
				? ed.settings.pencil
				: ed.tool === 'eraser'
					? ed.settings.eraser
					: ed.tool === 'clone'
						? ed.settings.clone
						: null
	);
	const isSkin = $derived(ed.doc.meta.kind === 'skin');
	const symmetryOptions = $derived<[SymmetryMode, string][]>([
		['off', 'Off'],
		...(isSkin ? ([['character', 'Character L/R']] as [SymmetryMode, string][]) : []),
		['horizontal', 'Horizontal'],
		['vertical', 'Vertical'],
		['both', 'Both']
	]);
	const hasSelection = $derived.by(() => {
		void ed.selectionVersion;
		return ed.selection.active;
	});
	const paints = $derived(
		['brush', 'pencil', 'eraser', 'clone', 'line', 'rect', 'ellipse'].includes(ed.tool)
	);
</script>

<div class="opts" role="group" aria-label="{info.label} options">
	<span class="name"><Icon name={ed.tool} size={16} /> {info.label}</span>

	{#if brush}
		<label class="o" title="Brush size ([ and ])">
			Size
			<input
				type="range"
				min="1"
				max={ed.tool === 'brush' ? 64 : 32}
				step="1"
				bind:value={brush.size}
				aria-label="Size"
			/>
			<input
				class="input num"
				type="number"
				min="1"
				max="64"
				bind:value={brush.size}
				aria-label="Size in pixels"
			/>
		</label>
		<label class="o">
			Opacity
			<input type="range" min="0.01" max="1" step="0.01" bind:value={brush.opacity} aria-label="Opacity" />
			<span class="v">{Math.round(brush.opacity * 100)}%</span>
		</label>
		{#if ed.tool === 'brush' || ed.tool === 'clone'}
			<label class="o" title="1 = crisp pixel edge, lower = soft">
				Hardness
				<input type="range" min="0" max="1" step="0.05" bind:value={brush.hardness} aria-label="Hardness" />
				<span class="v">{Math.round(brush.hardness * 100)}%</span>
			</label>
			<label class="o" title="Distance between dabs, as a percentage of size">
				Spacing
				<input type="range" min="0.05" max="1" step="0.05" bind:value={brush.spacing} aria-label="Spacing" />
				<span class="v">{Math.round(brush.spacing * 100)}%</span>
			</label>
		{/if}
		<label class="o">
			Shape
			<select class="input" bind:value={brush.shape} aria-label="Brush shape">
				<option value="round">Round</option>
				<option value="square">Square</option>
				<option value="custom" disabled={!ed.settings.customTip} title="Edit › Define brush from selection"
					>Custom</option
				>
			</select>
		</label>
		{#if ed.tool === 'eraser'}
			<label class="check"
				><input type="checkbox" bind:checked={ed.settings.eraser.aliased} /> Hard edge</label
			>
		{/if}
		{#if ed.tool === 'pencil'}
			<label class="check" title="Removes doubled corner pixels so lines stay 1px wide">
				<input type="checkbox" bind:checked={brush.pixelPerfect} /> Pixel-perfect
			</label>
		{/if}
		<label class="check" title="Pen pressure controls size (Pointer Events)">
			<input type="checkbox" bind:checked={brush.pressureSize} /> Pressure size
		</label>
		{#if ed.tool !== 'pencil'}
			<label class="check"
				><input type="checkbox" bind:checked={brush.pressureOpacity} /> Pressure opacity</label
			>
		{/if}
	{:else if ed.tool === 'line' || ed.tool === 'rect' || ed.tool === 'ellipse'}
		<label class="o">
			Width
			<input
				class="input num"
				type="number"
				min="1"
				max="32"
				bind:value={ed.settings.shape.size}
				aria-label="Line width"
			/>
		</label>
		<label class="o">
			Opacity
			<input
				type="range"
				min="0.01"
				max="1"
				step="0.01"
				bind:value={ed.settings.shape.opacity}
				aria-label="Opacity"
			/>
			<span class="v">{Math.round(ed.settings.shape.opacity * 100)}%</span>
		</label>
		{#if ed.tool !== 'line'}
			<label class="check"><input type="checkbox" bind:checked={ed.settings.shape.filled} /> Filled</label>
		{/if}
	{:else if ed.tool === 'fill'}
		<label class="o" title="How different a colour may be and still be filled">
			Tolerance
			<input type="range" min="0" max="255" bind:value={ed.settings.fill.tolerance} aria-label="Tolerance" />
			<span class="v">{ed.settings.fill.tolerance}</span>
		</label>
		<label class="o">
			Opacity
			<input
				type="range"
				min="0.01"
				max="1"
				step="0.01"
				bind:value={ed.settings.fill.opacity}
				aria-label="Opacity"
			/>
			<span class="v">{Math.round(ed.settings.fill.opacity * 100)}%</span>
		</label>
		<label class="check"
			><input type="checkbox" bind:checked={ed.settings.fill.contiguous} /> Contiguous</label
		>
		<label class="check"
			><input type="checkbox" bind:checked={ed.settings.fill.sampleAll} /> Sample all layers</label
		>
	{:else if ed.tool === 'wand'}
		<label class="o">
			Tolerance
			<input type="range" min="0" max="255" bind:value={ed.settings.wand.tolerance} aria-label="Tolerance" />
			<span class="v">{ed.settings.wand.tolerance}</span>
		</label>
		<label class="check"
			><input type="checkbox" bind:checked={ed.settings.wand.contiguous} /> Contiguous</label
		>
		<label class="check"
			><input type="checkbox" bind:checked={ed.settings.wand.sampleAll} /> Sample all layers</label
		>
	{:else if ed.tool === 'eyedropper'}
		<label class="check"
			><input type="checkbox" bind:checked={ed.settings.eyedropper.sampleAll} /> Sample all layers</label
		>
	{:else if ed.tool === 'select-rect' || ed.tool === 'select-ellipse' || ed.tool === 'lasso' || ed.tool === 'move'}
		<span class="hint">{info.hint}</span>
		{#if hasSelection}
			<button class="btn sm" onclick={() => ed.transform('flipH')}>Flip H</button>
			<button class="btn sm" onclick={() => ed.transform('flipV')}>Flip V</button>
			<button class="btn sm" onclick={() => ed.transform('rotateCCW')}>⟲ 90°</button>
			<button class="btn sm" onclick={() => ed.transform('rotateCW')}>⟳ 90°</button>
		{/if}
	{:else}
		<span class="hint">{info.hint}</span>
	{/if}

	{#if paints}
		<label class="o sym" title="Mirror strokes while drawing">
			<Icon name="symmetry" size={16} />
			<select class="input" bind:value={ed.settings.symmetry} aria-label="Symmetry">
				{#each symmetryOptions as [v, label] (v)}<option value={v}>{label}</option>{/each}
			</select>
		</label>
	{/if}
</div>

<style>
	.opts {
		display: flex;
		align-items: center;
		gap: 14px;
		height: 38px;
		padding: 0 12px;
		border-bottom: 1px solid var(--line);
		background: var(--bg-1);
		overflow-x: auto;
		overflow-y: hidden;
		white-space: nowrap;
		scrollbar-width: none;
		flex: none;
	}
	.name {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
		padding-right: 12px;
		border-right: 1px solid var(--line-2);
	}
	.name :global(svg) {
		color: var(--accent);
	}
	.o {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
	}
	.o input[type='range'] {
		width: 80px;
	}
	.o select {
		width: auto;
	}
	.v {
		min-width: 34px;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.hint {
		color: var(--text-3);
	}
	.sym {
		margin-left: auto;
	}
</style>
