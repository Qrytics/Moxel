<script lang="ts">
	import type { EditorState } from '../../state/editor.svelte';
	import { app } from '../../state/app.svelte';
	import {
		extractColors,
		hslToRgb,
		hsvToRgb,
		parseHex,
		parsePaletteFile,
		rgbToHsl,
		rgbToHsv,
		sameColor,
		toHex,
		type Palette
	} from '../../color/color';
	import type { RGBA } from '../../core/tools/types';
	import { compositeFrame } from '../../core/render/composite';
	import { uid } from '../../core/id';
	import { pickFiles, decodeImageFile } from '../../state/projects';
	import { downloadBytes } from '../../io/export';
	import Icon from '../Icon.svelte';
	import Menu from '../Menu.svelte';

	let { ed }: { ed: EditorState } = $props();

	let target = $state<'fg' | 'bg'>('fg');
	const current = $derived<RGBA>(target === 'fg' ? ed.fg : ed.bg);

	// Keep HSV locally so hue survives desaturating to grey.
	let h = $state(0),
		s = $state(0),
		v = $state(0);
	let lastSynced: RGBA | null = null;
	$effect(() => {
		const c = current;
		if (lastSynced && sameColor(lastSynced, c)) return;
		const [hh, ss, vv] = rgbToHsv(c[0], c[1], c[2]);
		if (ss > 0 && vv > 0) h = hh;
		if (vv > 0) s = ss;
		v = vv;
		lastSynced = [...c] as RGBA;
	});

	let hexInput = $derived(toHex(current));

	function set(c: RGBA) {
		lastSynced = c;
		ed.setColor(c, target);
	}

	function setHsv(nh = h, ns = s, nv = v) {
		h = nh;
		s = ns;
		v = nv;
		const [r, g, b] = hsvToRgb(h, s, v);
		set([r, g, b, current[3]]);
	}

	let sv: HTMLDivElement | undefined = $state();
	function svPointer(e: PointerEvent) {
		if (e.type === 'pointerdown') (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		else if (!(e.buttons & 1)) return;
		const r = sv!.getBoundingClientRect();
		setHsv(
			h,
			Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
			Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
		);
	}
	function svKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.1 : 0.02;
		const map: Record<string, [number, number]> = {
			ArrowLeft: [-step, 0],
			ArrowRight: [step, 0],
			ArrowUp: [0, step],
			ArrowDown: [0, -step]
		};
		const d = map[e.key];
		if (!d) return;
		e.preventDefault();
		setHsv(h, Math.min(1, Math.max(0, s + d[0])), Math.min(1, Math.max(0, v + d[1])));
	}

	const hsl = $derived(rgbToHsl(current[0], current[1], current[2]));

	function setChannel(i: number, val: number) {
		const c = [...current] as RGBA;
		c[i] = Math.max(0, Math.min(255, Math.round(val) || 0));
		set(c);
	}
	function setHsl(i: number, val: number) {
		const x = [...hsl] as [number, number, number];
		x[i] = i === 0 ? ((val % 360) + 360) % 360 : Math.max(0, Math.min(100, val)) / 100;
		const [r, g, b] = hslToRgb(x[0], x[1], x[2]);
		set([r, g, b, current[3]]);
	}

	function commitHex() {
		const c = parseHex(hexInput);
		if (c) set(c);
		else hexInput = toHex(current);
	}

	// ── palettes ──────────────────────────────────────────────────────────
	const DOC_PALETTE = '__doc';
	let paletteId = $state(DOC_PALETTE);
	const palettes = $derived(app.palettes);
	const docPalette = $derived.by(() => {
		void ed.metaVersion;
		return ed.doc.meta.palette;
	});
	const active = $derived<Palette>(
		paletteId === DOC_PALETTE
			? { id: DOC_PALETTE, name: 'Project palette', colors: docPalette }
			: (palettes.find((p) => p.id === paletteId) ?? {
					id: DOC_PALETTE,
					name: 'Project palette',
					colors: docPalette
				})
	);
	const editable = $derived(active.id === DOC_PALETTE || !active.builtin);

	function updateActive(colors: string[]) {
		if (active.id === DOC_PALETTE) ed.cmd.setMeta({ palette: colors }, 'Edit palette');
		else
			void app.saveSettings({
				palettes: app.settings.palettes.map((p) => (p.id === active.id ? { ...p, colors } : p))
			});
	}

	function addCurrent() {
		const hex = toHex(current);
		if (!active.colors.includes(hex)) updateActive([...active.colors, hex].slice(0, 256));
	}

	function removeColor(hex: string) {
		updateActive(active.colors.filter((c) => c !== hex));
	}

	function newPalette(colors: string[] = [], name = 'My palette') {
		const p: Palette = { id: uid('pal'), name, colors };
		void app.saveSettings({ palettes: [...app.settings.palettes, p] });
		paletteId = p.id;
	}

	function renamePalette() {
		const n = prompt('Palette name', active.name)?.trim();
		if (!n) return;
		void app.saveSettings({
			palettes: app.settings.palettes.map((p) => (p.id === active.id ? { ...p, name: n.slice(0, 40) } : p))
		});
	}

	function deletePalette() {
		if (!confirm(`Delete the palette “${active.name}”?`)) return;
		void app.saveSettings({ palettes: app.settings.palettes.filter((p) => p.id !== active.id) });
		paletteId = DOC_PALETTE;
	}

	function fromCanvas() {
		const colors = extractColors(compositeFrame(ed.doc, ed.activeFrameId), 64);
		if (!colors.length) return app.toast('The canvas has no painted pixels yet.');
		if (active.id === DOC_PALETTE) updateActive(colors);
		else newPalette(colors, `${ed.doc.meta.name} colours`);
	}

	async function importPalette() {
		const [file] = await pickFiles('.hex,.gpl,.txt,image/png,image/gif');
		if (!file) return;
		try {
			const colors = file.type.startsWith('image/')
				? extractColors((await decodeImageFile(file)).data, 256)
				: parsePaletteFile(await file.text());
			if (!colors.length) throw new Error();
			newPalette(colors, file.name.replace(/\.[^.]+$/, ''));
		} catch {
			app.toast("That file doesn't contain a palette Moxel can read (.hex, .gpl or an image).", 'error');
		}
	}

	function exportPalette() {
		const text = active.colors.map((c) => c.replace('#', '')).join('\n');
		downloadBytes(
			new TextEncoder().encode(text),
			`${active.name.replace(/[^\w-]+/g, '_')}.hex`,
			'text/plain'
		);
	}

	function savePaletteToLibrary() {
		newPalette([...active.colors], `${ed.doc.meta.name} palette`);
		app.toast('Saved to your palettes. It is available in every project.', 'success');
	}

	const recent = $derived(app.settings.recentColors);
</script>

<section class="color" aria-label="Colour">
	<div class="panel-title">
		Colour
		<div class="seg small" role="radiogroup" aria-label="Edit colour">
			<button aria-pressed={target === 'fg'} onclick={() => (target = 'fg')}>Foreground</button>
			<button aria-pressed={target === 'bg'} onclick={() => (target = 'bg')}>Background</button>
		</div>
	</div>
	<div class="pad">
		<div
			class="sv"
			bind:this={sv}
			style:--hue={h}
			role="slider"
			tabindex="0"
			aria-label="Saturation and brightness"
			aria-valuetext="Saturation {Math.round(s * 100)}%, brightness {Math.round(v * 100)}%"
			aria-valuenow={Math.round(s * 100)}
			onpointerdown={svPointer}
			onpointermove={svPointer}
			onkeydown={svKey}
		>
			<span class="knob" style:left="{s * 100}%" style:top="{(1 - v) * 100}%"></span>
		</div>
		<input
			class="hue"
			type="range"
			min="0"
			max="359"
			value={Math.round(h)}
			oninput={(e) => setHsv(+e.currentTarget.value)}
			aria-label="Hue"
		/>
		<input
			class="alpha"
			type="range"
			min="0"
			max="255"
			value={current[3]}
			style:--c={toHex(current, false)}
			oninput={(e) => setChannel(3, +e.currentTarget.value)}
			aria-label="Alpha (opacity)"
		/>

		<div class="row">
			<span class="preview checker"><i style:background={toHex(current)}></i></span>
			<label class="hex">
				<span class="sr-only">Hex colour</span>
				<input
					id="color-hex"
					class="input"
					bind:value={hexInput}
					onchange={commitHex}
					onkeydown={(e) => e.key === 'Enter' && commitHex()}
					spellcheck="false"
					maxlength="9"
				/>
			</label>
			<button
				class="icon-btn"
				aria-label="Swap foreground and background (X)"
				title="Swap (X)"
				onclick={() => ed.swapColors()}
			>
				<Icon name="swap" size={16} />
			</button>
			<button
				class="icon-btn"
				class:on={ed.tool === 'eyedropper'}
				aria-label="Eyedropper (I)"
				title="Eyedropper (I)"
				onclick={() => ed.setTool('eyedropper')}><Icon name="eyedropper" size={16} /></button
			>
		</div>
		<div class="channels">
			{#each ['R', 'G', 'B', 'A'] as ch, i (ch)}
				<label>
					<span>{ch}</span>
					<input
						class="input"
						type="number"
						min="0"
						max="255"
						value={current[i]}
						onchange={(e) => setChannel(i, +e.currentTarget.value)}
					/>
				</label>
			{/each}
			{#each ['H', 'S', 'L'] as ch, i (ch)}
				<label>
					<span>{ch}</span>
					<input
						class="input"
						type="number"
						min="0"
						max={i === 0 ? 359 : 100}
						value={Math.round(i === 0 ? hsl[0] : hsl[i] * 100)}
						onchange={(e) => setHsl(i, +e.currentTarget.value)}
					/>
				</label>
			{/each}
		</div>

		{#if recent.length}
			<div class="label">Recent</div>
			<div class="swatches" role="group" aria-label="Recent colours">
				{#each recent.slice(0, 16) as c (c)}
					<button
						class="swatch"
						style:--c={c}
						aria-label="Use {c}"
						title={c}
						onclick={() => ed.setColorHex(c, target)}
					></button>
				{/each}
			</div>
		{/if}

		<div class="pal-head">
			<label class="sr-only" for="palette-select">Palette</label>
			<select id="palette-select" class="input" bind:value={paletteId}>
				<option value={DOC_PALETTE}>Project palette</option>
				<optgroup label="Built-in">
					{#each palettes.filter((p) => p.builtin) as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</optgroup>
				{#if app.settings.palettes.length}
					<optgroup label="My palettes">
						{#each app.settings.palettes as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</optgroup>
				{/if}
			</select>
			<button
				class="icon-btn"
				aria-label="Add current colour to palette"
				title="Add current colour"
				disabled={!editable}
				onclick={addCurrent}
			>
				<Icon name="plus" size={16} />
			</button>
			<Menu
				label="Palette actions"
				align="right"
				triggerClass="icon-btn"
				items={() => [
					{ label: 'New empty palette', action: () => newPalette() },
					{
						label: 'Duplicate as new palette',
						action: () => newPalette([...active.colors], `${active.name} copy`)
					},
					{ label: 'Extract colours from canvas', action: fromCanvas },
					{
						label: 'Save project palette to library',
						action: savePaletteToLibrary,
						disabled: active.id !== DOC_PALETTE || !active.colors.length
					},
					{ separator: true, label: '' },
					{ label: 'Import palette (.hex, .gpl, image)…', action: importPalette },
					{ label: 'Export palette as .hex', action: exportPalette, disabled: !active.colors.length },
					{ separator: true, label: '' },
					{
						label: 'Rename palette…',
						action: renamePalette,
						disabled: active.id === DOC_PALETTE || !!active.builtin
					},
					{
						label: 'Delete palette…',
						action: deletePalette,
						danger: true,
						disabled: active.id === DOC_PALETTE || !!active.builtin
					}
				]}
			>
				{#snippet trigger()}<Icon name="more" />{/snippet}
			</Menu>
		</div>
		{#if active.colors.length}
			<div class="swatches pal" role="group" aria-label="{active.name} colours">
				{#each active.colors as c (c)}
					<button
						class="swatch"
						class:sel={toHex(current) === c || toHex(current, false) === c}
						style:--c={c}
						aria-label="Use {c}{editable ? '. Alt-click or right-click to remove.' : ''}"
						title="{c}{editable ? ' — Alt-click to remove' : ''}"
						onclick={(e) => (e.altKey && editable ? removeColor(c) : ed.setColorHex(c, target))}
						oncontextmenu={(e) => {
							if (!editable) return;
							e.preventDefault();
							removeColor(c);
						}}
					></button>
				{/each}
			</div>
		{:else}
			<p class="empty">
				{active.id === DOC_PALETTE
					? 'This project has no palette yet. Press + to add the current colour, or extract colours from the canvas.'
					: 'Empty palette. Press + to add the current colour.'}
			</p>
		{/if}
	</div>
</section>

<style>
	.color {
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--line);
	}
	.seg.small button {
		height: 22px;
		padding: 0 7px;
		font-size: 11px;
		text-transform: none;
		letter-spacing: 0;
	}
	.pad {
		padding: 10px 12px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.sv {
		position: relative;
		height: 120px;
		border-radius: 6px;
		background:
			linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(var(--hue) 100% 50%));
		cursor: crosshair;
		touch-action: none;
	}
	.knob {
		position: absolute;
		width: 12px;
		height: 12px;
		margin: -6px 0 0 -6px;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}
	.hue,
	.alpha {
		appearance: none;
		width: 100%;
		height: 12px;
		border-radius: 6px;
		margin: 0;
	}
	.hue {
		background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
	}
	.alpha {
		background:
			linear-gradient(to right, transparent, var(--c)),
			repeating-conic-gradient(#555 0 25%, #888 0 50%) 0 0 / 8px 8px;
	}
	.hue::-webkit-slider-thumb,
	.alpha::-webkit-slider-thumb {
		appearance: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: transparent;
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
	}
	.hue::-moz-range-thumb,
	.alpha::-moz-range-thumb {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: transparent;
		border: 2px solid #fff;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.preview {
		width: 28px;
		height: 28px;
		border-radius: 5px;
		overflow: hidden;
		flex: none;
		border: 1px solid var(--line-2);
	}
	.preview i {
		display: block;
		width: 100%;
		height: 100%;
	}
	.hex {
		flex: 1;
	}
	.hex input {
		width: 100%;
		font-family: var(--mono);
	}
	.channels {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	.channels label {
		display: flex;
		align-items: center;
		gap: 3px;
		font-size: 11px;
		color: var(--text-3);
	}
	.channels input {
		width: 100%;
		height: 24px;
		padding: 0 4px;
		font-size: 12px;
	}
	.label {
		font-size: 11px;
		color: var(--text-3);
	}
	.swatches {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20px, 1fr));
		gap: 3px;
	}
	.swatches.pal {
		max-height: 132px;
		overflow: auto;
	}
	.swatch {
		aspect-ratio: 1;
		padding: 0;
		border-radius: 3px;
		border: 1px solid rgba(0, 0, 0, 0.4);
		background:
			linear-gradient(var(--c), var(--c)),
			repeating-conic-gradient(#555 0 25%, #888 0 50%) 0 0 / 6px 6px;
	}
	.swatch:hover {
		transform: scale(1.12);
		z-index: 1;
	}
	.swatch.sel {
		box-shadow: 0 0 0 2px var(--text);
	}
	.pal-head {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 4px;
	}
	.pal-head select {
		flex: 1;
	}
	.empty {
		margin: 0;
		font-size: 12px;
		color: var(--text-3);
	}
</style>
