<script lang="ts">
	import { BRUSH_PRESETS, presetSettings, presetsFor, type BrushPreset } from '../../core/tools/brushPresets';
	import { renderBrushPreview } from '../../core/tools/brushPreview';
	import type { PaintBrushSettings, PaintToolId, PressureCurve } from '../../core/tools/types';
	import { uid } from '../../core/id';
	import type { EditorState } from '../../state/editor.svelte';
	import { app } from '../../state/app.svelte';

	let { ed, tool }: { ed: EditorState; tool: PaintToolId } = $props();

	const b = $derived<PaintBrushSettings>(ed.settings.paint[tool]);
	const presets = $derived<BrushPreset[]>([
		...presetsFor(tool),
		...app.settings.paintPresets.filter((p) => p.tool === tool)
	]);
	const activePreset = $derived(presets.find((p) => p.id === ed.settings.paint.preset[tool]));
	const isCustom = (p: BrushPreset) => !BRUSH_PRESETS.includes(p);

	let presetPop: HTMLDivElement | undefined = $state();
	let morePop: HTMLDivElement | undefined = $state();

	/** Size slider is logarithmic: fine control for small brushes, still reaches 500px. */
	const MAX_SIZE = 500;
	const sizeToSlider = (s: number) => Math.log(Math.max(1, s)) / Math.log(MAX_SIZE);
	const sliderToSize = (v: number) => Math.max(1, Math.round(Math.pow(MAX_SIZE, v)));

	function apply(p: BrushPreset) {
		ed.settings.paint[tool] = presetSettings(p);
		ed.settings.paint.preset[tool] = p.id;
		presetPop?.hidePopover();
	}

	async function saveCurrent() {
		const name = prompt('Name this brush', activePreset ? `${activePreset.name} copy` : 'My brush');
		if (!name?.trim()) return;
		const preset: BrushPreset = { id: uid('br'), name: name.trim().slice(0, 40), tool, settings: { ...b } };
		await app.saveSettings({ paintPresets: [...app.settings.paintPresets, preset] });
		ed.settings.paint.preset[tool] = preset.id;
		app.toast(`Saved “${preset.name}”. It's available in every paint project.`, 'success');
	}

	async function remove(p: BrushPreset) {
		await app.saveSettings({ paintPresets: app.settings.paintPresets.filter((q) => q.id !== p.id) });
	}

	/** Place a popover under the button that opened it (the options bar scrolls, so no CSS anchoring). */
	function place(pop: HTMLElement | undefined, e: Event) {
		const btn = e.currentTarget as HTMLElement;
		const r = btn.getBoundingClientRect();
		if (!pop) return;
		pop.style.top = `${r.bottom + 6}px`;
		pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 340))}px`;
	}

	/** Svelte action: draw a live preview of a preset with the real paint engine. */
	function preview(canvas: HTMLCanvasElement, p: BrushPreset) {
		const draw = (preset: BrushPreset) => {
			const w = (canvas.width = 132),
				h = (canvas.height = 40);
			const px = renderBrushPreview(preset.tool, presetSettings(preset), w, h);
			canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
		};
		draw(p);
		return { update: draw };
	}

	const curves: [PressureCurve, string][] = [
		['soft', 'Soft'],
		['linear', 'Linear'],
		['firm', 'Firm']
	];
</script>

<button
	class="btn sm preset-btn"
	popovertarget="paint-presets"
	onclick={(e) => place(presetPop, e)}
	aria-haspopup="dialog"
	title="Brush presets"
>
	{activePreset?.name ?? 'Custom'} ▾
</button>

<div
	id="paint-presets"
	class="pop"
	popover="auto"
	bind:this={presetPop}
	role="dialog"
	aria-label="Brush presets"
>
	<div class="grid">
		{#each presets as p (p.id)}
			<div class="preset" class:on={p.id === activePreset?.id}>
				<button class="pick" onclick={() => apply(p)} aria-label="Use {p.name}">
					<canvas use:preview={p} aria-hidden="true"></canvas>
					<span>{p.name}</span>
				</button>
				{#if isCustom(p)}
					<button class="del" onclick={() => remove(p)} aria-label="Delete {p.name}" title="Delete">×</button>
				{/if}
			</div>
		{/each}
	</div>
	<button class="btn sm save" onclick={saveCurrent}>Save current brush…</button>
</div>

<label class="o" title="Brush size ([ and ])">
	Size
	<input
		type="range"
		min="0"
		max="1"
		step="0.001"
		value={sizeToSlider(b.size)}
		oninput={(e) => (b.size = sliderToSize(+e.currentTarget.value))}
		aria-label="Size"
	/>
	<input
		class="input num"
		type="number"
		min="1"
		max={MAX_SIZE}
		bind:value={b.size}
		aria-label="Size in pixels"
	/>
</label>

{#if tool === 'brush' || tool === 'eraser'}
	<label class="o" title="The most one stroke can cover">
		Opacity
		<input type="range" min="0.01" max="1" step="0.01" bind:value={b.opacity} aria-label="Opacity" />
		<span class="v">{Math.round(b.opacity * 100)}%</span>
	</label>
	<label class="o" title="How much each dab adds. Low flow builds up gradually, like an airbrush.">
		Flow
		<input type="range" min="0.01" max="1" step="0.01" bind:value={b.flow} aria-label="Flow" />
		<span class="v">{Math.round(b.flow * 100)}%</span>
	</label>
{:else}
	<label
		class="o"
		title={tool === 'smudge' ? 'How far paint is dragged' : 'Positive blurs, negative sharpens'}
	>
		Strength
		<input
			type="range"
			min={tool === 'blur' ? -1 : 0}
			max="1"
			step="0.01"
			bind:value={b.strength}
			aria-label="Strength"
		/>
		<span class="v">{Math.round(b.strength * 100)}%</span>
	</label>
{/if}
<label class="o" title="1 = crisp edge, lower = soft">
	Hardness
	<input type="range" min="0" max="1" step="0.01" bind:value={b.hardness} aria-label="Hardness" />
	<span class="v">{Math.round(b.hardness * 100)}%</span>
</label>
{#if tool === 'brush' || tool === 'eraser'}
	<label class="o" title="Smooths shaky lines by trailing the pointer">
		Smoothing
		<input type="range" min="0" max="1" step="0.01" bind:value={b.stabilizer} aria-label="Smoothing" />
		<span class="v">{Math.round(b.stabilizer * 100)}%</span>
	</label>
{/if}

<button class="btn sm" popovertarget="paint-more" onclick={(e) => place(morePop, e)} aria-haspopup="dialog">
	More…
</button>
<div
	id="paint-more"
	class="pop more"
	popover="auto"
	bind:this={morePop}
	role="dialog"
	aria-label="More brush settings"
>
	<h4>Tip</h4>
	<label
		>Spacing <input type="range" min="0.02" max="1" step="0.01" bind:value={b.spacing} />
		<span class="v">{Math.round(b.spacing * 100)}%</span></label
	>
	<label
		>Angle <input type="range" min="0" max="180" step="1" bind:value={b.angle} />
		<span class="v">{b.angle}°</span></label
	>
	<label
		>Roundness <input type="range" min="0.05" max="1" step="0.01" bind:value={b.roundness} />
		<span class="v">{Math.round(b.roundness * 100)}%</span></label
	>
	<h4>Texture</h4>
	<label
		>Grain <input type="range" min="0" max="1" step="0.01" bind:value={b.grain} />
		<span class="v">{Math.round(b.grain * 100)}%</span></label
	>
	<label
		>Grain scale <input type="range" min="0.5" max="6" step="0.1" bind:value={b.grainScale} />
		<span class="v">{b.grainScale.toFixed(1)}×</span></label
	>
	<label
		>Scatter <input type="range" min="0" max="1" step="0.01" bind:value={b.scatter} />
		<span class="v">{Math.round(b.scatter * 100)}%</span></label
	>
	<label
		>Size jitter <input type="range" min="0" max="1" step="0.01" bind:value={b.sizeJitter} />
		<span class="v">{Math.round(b.sizeJitter * 100)}%</span></label
	>
	<label
		>Opacity jitter <input type="range" min="0" max="1" step="0.01" bind:value={b.opacityJitter} />
		<span class="v">{Math.round(b.opacityJitter * 100)}%</span></label
	>
	<h4>Pen pressure</h4>
	<div class="checks">
		<label class="check"><input type="checkbox" bind:checked={b.pressureSize} /> Size</label>
		<label class="check"><input type="checkbox" bind:checked={b.pressureOpacity} /> Opacity</label>
		<label class="check"><input type="checkbox" bind:checked={b.pressureFlow} /> Flow</label>
	</div>
	<label>
		Curve
		<select class="input" bind:value={b.pressureCurve} aria-label="Pressure curve">
			{#each curves as [v, label] (v)}<option value={v}>{label}</option>{/each}
		</select>
	</label>
	<label class="check" title="Mouse strokes start thin and swell, standing in for pen pressure">
		<input type="checkbox" bind:checked={b.taper} /> Taper mouse strokes
	</label>
	{#if tool === 'smudge' || tool === 'blur'}
		<label
			>Smoothing <input type="range" min="0" max="1" step="0.01" bind:value={b.stabilizer} />
			<span class="v">{Math.round(b.stabilizer * 100)}%</span></label
		>
	{/if}
</div>

<style>
	.o {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
	}
	.o input[type='range'] {
		width: 80px;
	}
	.v {
		min-width: 34px;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.preset-btn {
		min-width: 110px;
		justify-content: space-between;
	}
	.pop {
		position: fixed;
		inset: auto;
		margin: 0;
		width: 320px;
		max-height: min(70vh, 520px);
		overflow: auto;
		padding: 10px;
		border: 1px solid var(--line-2);
		border-radius: 10px;
		background: var(--bg-1);
		color: var(--text);
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
		white-space: normal;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.preset {
		position: relative;
	}
	.pick {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 3px;
		width: 100%;
		padding: 5px;
		border: 1px solid var(--line);
		border-radius: 8px;
		background: var(--bg-2, #26272d);
		color: var(--text-2);
		font: inherit;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
	}
	.pick canvas {
		width: 100%;
		height: 40px;
		border-radius: 4px;
		background: #1b1c20;
	}
	.preset.on .pick {
		border-color: var(--accent);
		color: var(--text);
	}
	.pick:focus-visible {
		outline: 2px solid var(--accent);
	}
	.del {
		position: absolute;
		top: 2px;
		right: 4px;
		border: 0;
		background: none;
		color: var(--text-3);
		font-size: 16px;
		cursor: pointer;
	}
	.save {
		margin-top: 8px;
		width: 100%;
	}
	.more {
		display: none;
	}
	.more:popover-open {
		display: grid;
		gap: 6px;
	}
	.more h4 {
		margin: 6px 0 0;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-3);
	}
	.more > label {
		display: grid;
		grid-template-columns: 96px 1fr 40px;
		align-items: center;
		gap: 8px;
		color: var(--text-2);
	}
	.more > label.check {
		display: flex;
	}
	.checks {
		display: flex;
		gap: 14px;
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
	}
</style>
