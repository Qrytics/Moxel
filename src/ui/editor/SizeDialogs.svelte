<script lang="ts">
	import Dialog from '../Dialog.svelte';
	import type { EditorState } from '../../state/editor.svelte';
	import { MAX_CANVAS_SIZE } from '../../core/document/types';

	let { ed, mode = $bindable(null) }: { ed: EditorState; mode?: 'canvas' | 'image' | 'selection' | null } =
		$props();

	let w = $state(0);
	let h = $state(0);
	let ax = $state(0.5);
	let ay = $state(0.5);
	let lock = $state(true);
	let base = { w: 1, h: 1 };

	$effect(() => {
		if (!mode) return;
		const b = mode === 'selection' ? ed.selection.bounds : null;
		base = b ? { w: b.w, h: b.h } : { w: ed.doc.width, h: ed.doc.height };
		w = base.w;
		h = base.h;
		ax = ay = 0.5;
	});

	function setW(v: number) {
		w = v;
		if (lock) h = Math.max(1, Math.round((v * base.h) / base.w));
	}
	function setH(v: number) {
		h = v;
		if (lock) w = Math.max(1, Math.round((v * base.w) / base.h));
	}

	const valid = $derived(
		Number.isInteger(w) &&
			Number.isInteger(h) &&
			w >= 1 &&
			h >= 1 &&
			w <= MAX_CANVAS_SIZE &&
			h <= MAX_CANVAS_SIZE
	);
	const skinWarn = $derived(ed.doc.meta.kind === 'skin' && mode !== 'selection' && (w !== 64 || h !== 64));

	function apply() {
		if (!valid) return;
		if (mode === 'canvas') ed.cmd.resizeCanvas(w, h, ax, ay);
		else if (mode === 'image') ed.cmd.scaleImage(w, h);
		else if (mode === 'selection') ed.transform({ scale: [w, h] });
		mode = null;
	}

	const title = $derived(
		mode === 'canvas' ? 'Canvas size' : mode === 'image' ? 'Scale image' : 'Scale selection'
	);
</script>

<Dialog {title} open={!!mode} onclose={() => (mode = null)} width={400}>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			apply();
		}}
	>
		<p class="muted small">
			{#if mode === 'canvas'}Add or crop space around the artwork. Pixels are not resampled.
			{:else if mode === 'image'}Resample every layer and frame with nearest-neighbour scaling (keeps pixels
				crisp).
			{:else}Resize the selected pixels with nearest-neighbour scaling.{/if}
		</p>
		<div class="row">
			<label class="field"
				>Width <input
					class="input num"
					type="number"
					min="1"
					max={MAX_CANVAS_SIZE}
					value={w}
					oninput={(e) => setW(+e.currentTarget.value)}
				/></label
			>
			<span class="x">×</span>
			<label class="field"
				>Height <input
					class="input num"
					type="number"
					min="1"
					max={MAX_CANVAS_SIZE}
					value={h}
					oninput={(e) => setH(+e.currentTarget.value)}
				/></label
			>
			<label class="check"><input type="checkbox" bind:checked={lock} /> Keep proportions</label>
		</div>
		<div class="presets">
			{#each [0.5, 2, 3, 4] as k (k)}
				<button
					type="button"
					class="btn sm"
					onclick={() => (
						(w = Math.max(1, Math.round(base.w * k))),
						(h = Math.max(1, Math.round(base.h * k)))
					)}>{k * 100}%</button
				>
			{/each}
		</div>
		{#if mode === 'canvas'}
			<fieldset>
				<legend>Anchor</legend>
				<div class="anchor" role="radiogroup" aria-label="Anchor">
					{#each [0, 0.5, 1] as y (y)}
						{#each [0, 0.5, 1] as x (x)}
							<button
								type="button"
								role="radio"
								aria-checked={ax === x && ay === y}
								aria-label="Anchor {y === 0 ? 'top' : y === 1 ? 'bottom' : 'middle'} {x === 0
									? 'left'
									: x === 1
										? 'right'
										: 'centre'}"
								class:on={ax === x && ay === y}
								onclick={() => ((ax = x), (ay = y))}
							></button>
						{/each}
					{/each}
				</div>
			</fieldset>
		{/if}
		{#if !valid}<p class="err">Sizes must be whole numbers from 1 to {MAX_CANVAS_SIZE}.</p>{/if}
		{#if skinWarn}<p class="warn">
				Minecraft skins must be 64×64. Changing the size will make this skin invalid until you change it back.
			</p>{/if}
	</form>
	{#snippet footer()}
		<button class="btn" onclick={() => (mode = null)}>Cancel</button>
		<button class="btn primary" disabled={!valid} onclick={apply}>Apply</button>
	{/snippet}
</Dialog>

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.small {
		font-size: 12px;
		margin: 0;
	}
	.row {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		flex-wrap: wrap;
	}
	.x {
		padding-bottom: 6px;
		color: var(--text-3);
	}
	.input.num {
		width: 80px;
	}
	.presets {
		display: flex;
		gap: 4px;
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
	.anchor {
		display: grid;
		grid-template-columns: repeat(3, 22px);
		gap: 3px;
	}
	.anchor button {
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: 4px;
		border: 1px solid var(--line-2);
		background: var(--bg-1);
	}
	.anchor button.on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.err {
		color: var(--err);
		font-size: 12px;
		margin: 0;
	}
	.warn {
		color: var(--warn);
		font-size: 12px;
		margin: 0;
	}
</style>
