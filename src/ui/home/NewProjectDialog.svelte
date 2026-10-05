<script lang="ts">
	import Dialog from '../Dialog.svelte';
	import { TEXTURE_PRESETS } from '../../minecraft/templates';
	import { MAX_CANVAS_SIZE, MAX_PAINT_SIZE, type SkinModel } from '../../core/document/types';
	import type { NewProjectSpec } from '../../state/projects';

	type Tab = 'paint' | 'skin' | 'texture' | 'canvas' | 'animation';

	let {
		open = $bindable(false),
		initialTab = 'paint',
		oncreate
	}: { open?: boolean; initialTab?: Tab; oncreate: (spec: NewProjectSpec) => void } = $props();

	let tab = $state<Tab>('paint');
	let name = $state('');
	let model = $state<SkinModel>('classic');
	let template = $state<'starter' | 'blank'>('starter');
	let preset = $state(TEXTURE_PRESETS[0].id);
	let width = $state(32);
	let height = $state(32);
	let frames = $state(4);
	let fps = $state(8);
	let paintW = $state(1920);
	let paintH = $state(1080);
	let background = $state<'white' | 'transparent'>('white');

	$effect(() => {
		if (open) {
			tab = initialTab;
			name = '';
		}
	});

	const placeholder = $derived(
		tab === 'paint'
			? 'Untitled painting'
			: tab === 'skin'
				? model === 'slim'
					? 'Slim skin'
					: 'Classic skin'
				: tab === 'texture'
					? `${TEXTURE_PRESETS.find((p) => p.id === preset)?.label} texture`
					: tab === 'animation'
						? 'Animation'
						: 'Untitled canvas'
	);

	const validSize = (w: number, h: number, max: number) =>
		Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= max && h <= max;
	const sizeValid = $derived(validSize(width, height, MAX_CANVAS_SIZE));
	const paintValid = $derived(validSize(paintW, paintH, MAX_PAINT_SIZE));
	const canCreate = $derived(
		tab === 'paint' ? paintValid : tab === 'canvas' || tab === 'animation' ? sizeValid : true
	);

	function create() {
		const n = name.trim() || placeholder;
		let spec: NewProjectSpec;
		if (tab === 'paint') spec = { type: 'paint', name: n, width: paintW, height: paintH, background };
		else if (tab === 'skin') spec = { type: 'skin', name: n, model, template };
		else if (tab === 'texture') {
			const p = TEXTURE_PRESETS.find((x) => x.id === preset)!;
			spec = { type: 'texture', name: n, textureType: p.type, width: p.width, height: p.height };
		} else if (tab === 'animation')
			spec = { type: 'canvas', name: n, width, height, frames: Math.max(1, Math.min(120, frames)), fps };
		else spec = { type: 'canvas', name: n, width, height, frames: 1, fps: 8 };
		open = false;
		oncreate(spec);
	}

	const CANVAS_PRESETS = [
		[16, 16],
		[32, 32],
		[64, 64],
		[128, 128],
		[256, 256],
		[320, 180]
	];

	const PAINT_PRESETS: [number, number, string][] = [
		[1920, 1080, 'HD'],
		[1080, 1080, 'Square'],
		[1080, 1920, 'Portrait'],
		[2560, 1440, 'QHD'],
		[2048, 2048, 'Large square'],
		[3000, 2000, '3:2 print']
	];
</script>

<Dialog title="New project" bind:open width={560}>
	<div class="tabs" role="tablist" aria-label="Project type">
		{#each [['paint', 'Paint'], ['skin', 'Minecraft skin'], ['texture', 'Texture'], ['canvas', 'Pixel canvas'], ['animation', 'Animation']] as [id, label] (id)}
			<button role="tab" aria-selected={tab === id} class:on={tab === id} onclick={() => (tab = id as Tab)}
				>{label}</button
			>
		{/each}
	</div>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			if (canCreate) create();
		}}
	>
		<label class="field">
			Name
			<input class="input" bind:value={name} {placeholder} maxlength="80" />
		</label>

		{#if tab === 'paint'}
			<fieldset>
				<legend>Size</legend>
				<div class="row">
					<label class="field"
						>Width <input
							class="input num"
							type="number"
							min="1"
							max={MAX_PAINT_SIZE}
							bind:value={paintW}
						/></label
					>
					<span class="x">×</span>
					<label class="field"
						>Height <input
							class="input num"
							type="number"
							min="1"
							max={MAX_PAINT_SIZE}
							bind:value={paintH}
						/></label
					>
				</div>
				<div class="presets paint-presets">
					{#each PAINT_PRESETS as [w, h, label] (`${w}x${h}`)}
						<button
							type="button"
							class="preset"
							class:on={paintW === w && paintH === h}
							aria-pressed={paintW === w && paintH === h}
							onclick={() => ((paintW = w), (paintH = h))}
						>
							<strong>{label}</strong><small>{w}×{h}</small>
						</button>
					{/each}
				</div>
				{#if !paintValid}<p class="err">
						Width and height must be whole numbers from 1 to {MAX_PAINT_SIZE}.
					</p>{/if}
			</fieldset>
			<fieldset>
				<legend>Background</legend>
				<div class="seg">
					<button type="button" aria-pressed={background === 'white'} onclick={() => (background = 'white')}
						>White</button
					>
					<button
						type="button"
						aria-pressed={background === 'transparent'}
						onclick={() => (background = 'transparent')}>Transparent</button
					>
				</div>
			</fieldset>
			<p class="muted hint">
				Smooth brushes with pen pressure, presets like pencil, ink and airbrush, plus smudge, blur and
				gradients. For pixel art, choose Pixel canvas.
			</p>
		{:else if tab === 'skin'}
			<fieldset>
				<legend>Model</legend>
				<div class="cards">
					<button
						type="button"
						class="card"
						class:on={model === 'classic'}
						aria-pressed={model === 'classic'}
						onclick={() => (model = 'classic')}
					>
						<span class="fig classic" aria-hidden="true"><i></i><b></b><i></i></span>
						<strong>Classic</strong><small>4px-wide arms (“Steve”)</small>
					</button>
					<button
						type="button"
						class="card"
						class:on={model === 'slim'}
						aria-pressed={model === 'slim'}
						onclick={() => (model = 'slim')}
					>
						<span class="fig slim" aria-hidden="true"><i></i><b></b><i></i></span>
						<strong>Slim</strong><small>3px-wide arms (“Alex”)</small>
					</button>
				</div>
			</fieldset>
			<fieldset>
				<legend>Start from</legend>
				<div class="seg">
					<button type="button" aria-pressed={template === 'starter'} onclick={() => (template = 'starter')}
						>Starter character</button
					>
					<button type="button" aria-pressed={template === 'blank'} onclick={() => (template = 'blank')}
						>Blank skin</button
					>
				</div>
			</fieldset>
			<p class="muted hint">
				64×64 Minecraft Java & Bedrock layout with outer layer. UV guides and a 3D preview are included.
			</p>
		{:else if tab === 'texture'}
			<fieldset>
				<legend>Preset</legend>
				<div class="presets">
					{#each TEXTURE_PRESETS as p (p.id)}
						<button
							type="button"
							class="preset"
							class:on={preset === p.id}
							aria-pressed={preset === p.id}
							onclick={() => (preset = p.id)}
						>
							<strong>{p.label}</strong><small>{p.hint}</small>
						</button>
					{/each}
				</div>
			</fieldset>
			<p class="muted hint">
				Add frames later in the timeline to make an animated texture (exported as a strip with .mcmeta).
			</p>
		{:else}
			<fieldset>
				<legend>Size</legend>
				<div class="row">
					<label class="field"
						>Width <input
							class="input num"
							type="number"
							min="1"
							max={MAX_CANVAS_SIZE}
							bind:value={width}
						/></label
					>
					<span class="x">×</span>
					<label class="field"
						>Height <input
							class="input num"
							type="number"
							min="1"
							max={MAX_CANVAS_SIZE}
							bind:value={height}
						/></label
					>
					<div class="chips">
						{#each CANVAS_PRESETS as [w, h] (`${w}x${h}`)}
							<button type="button" class="btn sm" onclick={() => ((width = w), (height = h))}>{w}×{h}</button
							>
						{/each}
					</div>
				</div>
				{#if !sizeValid}<p class="err">
						Width and height must be whole numbers from 1 to {MAX_CANVAS_SIZE}.
					</p>{/if}
			</fieldset>
			{#if tab === 'animation'}
				<fieldset>
					<legend>Animation</legend>
					<div class="row">
						<label class="field"
							>Frames <input class="input num" type="number" min="1" max="120" bind:value={frames} /></label
						>
						<label class="field"
							>Frames per second <input
								class="input num"
								type="number"
								min="1"
								max="60"
								bind:value={fps}
							/></label
						>
					</div>
				</fieldset>
			{/if}
		{/if}
		<button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
	</form>

	{#snippet footer()}
		<button class="btn" onclick={() => (open = false)}>Cancel</button>
		<button class="btn primary" disabled={!canCreate} onclick={create}>Create</button>
	{/snippet}
</Dialog>

<style>
	.tabs {
		display: flex;
		gap: 2px;
		margin-bottom: 16px;
		border-bottom: 1px solid var(--line);
	}
	.tabs button {
		border: 0;
		background: transparent;
		color: var(--text-2);
		padding: 8px 12px;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		font-weight: 500;
	}
	.tabs button.on {
		color: var(--text);
		border-color: var(--accent);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	fieldset {
		border: 0;
		margin: 0;
		padding: 0;
	}
	legend {
		font-size: 12px;
		color: var(--text-2);
		margin-bottom: 6px;
	}
	.cards {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.card,
	.preset {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		padding: 12px;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		background: var(--bg-1);
		text-align: left;
	}
	.card.on,
	.preset.on {
		border-color: var(--accent);
		background: #1d2a38;
	}
	.card small,
	.preset small {
		color: var(--text-3);
	}
	.fig {
		display: flex;
		gap: 2px;
		margin-bottom: 8px;
		align-items: flex-start;
		height: 36px;
	}
	.fig b {
		width: 16px;
		height: 36px;
		background: #3f7f8c;
		border-top: 12px solid #c69c7c;
	}
	.fig i {
		height: 24px;
		margin-top: 12px;
		background: #c69c7c;
		width: 8px;
	}
	.fig.slim i {
		width: 6px;
	}
	.presets {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 8px;
	}
	.row {
		display: flex;
		align-items: flex-end;
		flex-wrap: wrap;
		gap: 10px;
	}
	.x {
		padding-bottom: 6px;
		color: var(--text-3);
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.input.num {
		width: 84px;
	}
	.hint {
		margin: 0;
		font-size: 12px;
	}
	.err {
		color: var(--err);
		font-size: 12px;
		margin: 6px 0 0;
	}
</style>
