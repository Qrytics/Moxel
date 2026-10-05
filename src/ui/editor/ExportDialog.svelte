<script lang="ts">
	import Dialog from '../Dialog.svelte';
	import Icon from '../Icon.svelte';
	import type { EditorState } from '../../state/editor.svelte';
	import { app } from '../../state/app.svelte';
	import { compositeFrame } from '../../core/render/composite';
	import { validateSkin, validateTexture, type ValidationIssue } from '../../minecraft/validate';
	import { downloadBytes, exportBrowserImage, type SheetLayout } from '../../io/export';
	import { exportInWorker } from '../../io/exportClient';
	import { MOXEL_EXT, safeFileName } from '../../io/moxelFile';

	type Format = 'png' | 'jpeg' | 'webp' | 'gif' | 'sheet' | 'mcanim' | 'moxel';
	let { ed, open = $bindable(false) }: { ed: EditorState; open?: boolean } = $props();

	let format = $state<Format>('png');
	let scale = $state(1);
	let layout = $state<SheetLayout>('horizontal');
	let busy = $state(false);
	let quality = $state(0.92);
	let lossyScale = $state(1);

	const isSkin = $derived(ed.doc.meta.kind === 'skin');
	const isPaint = $derived(ed.doc.meta.kind === 'paint');
	const lossy = $derived(format === 'jpeg' || format === 'webp');
	const multi = $derived(ed.doc.frames.length > 1);
	const issues = $derived.by<ValidationIssue[]>(() => {
		if (!open) return [];
		void ed.pixelsVersion;
		void ed.metaVersion;
		if (isPaint) return [];
		if (isSkin)
			return validateSkin(
				compositeFrame(ed.doc, ed.activeFrameId),
				ed.doc.width,
				ed.doc.height,
				ed.doc.meta.skin?.model
			);
		return validateTexture({
			width: ed.doc.width,
			height: ed.doc.height,
			frameCount: ed.doc.frames.length,
			textureType: ed.doc.meta.texture?.type
		});
	});
	const blocking = $derived(isSkin && format === 'png' && issues.some((i) => i.severity === 'error'));
	const effectiveScale = $derived(isSkin && format === 'png' ? 1 : scale);

	$effect(() => {
		if (open) {
			format = 'png';
			scale = isSkin || ed.doc.width >= 256 ? 1 : ed.doc.width <= 32 ? 8 : 4;
		}
	});

	const name = $derived(safeFileName(ed.doc.meta.name));

	async function run() {
		busy = true;
		// Let the button state paint before the (synchronous) encode.
		await new Promise((r) => setTimeout(r, 16));
		try {
			const s = effectiveScale;
			if (format === 'jpeg' || format === 'webp') {
				const type = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
				downloadBytes(
					await exportBrowserImage(ed.doc, ed.activeFrameId, type, quality, lossyScale),
					`${name}.${format === 'jpeg' ? 'jpg' : 'webp'}`,
					type
				);
			} else if (format === 'png')
				downloadBytes(
					await exportInWorker(ed.doc, { kind: 'png', frameId: ed.activeFrameId, scale: s }),
					`${name}${s > 1 ? `@${s}x` : ''}.png`,
					'image/png'
				);
			else if (format === 'gif')
				downloadBytes(await exportInWorker(ed.doc, { kind: 'gif', scale: s }), `${name}.gif`, 'image/gif');
			else if (format === 'sheet')
				downloadBytes(
					await exportInWorker(ed.doc, { kind: 'sheet', layout, scale: s }),
					`${name}-sheet.png`,
					'image/png'
				);
			else if (format === 'mcanim')
				downloadBytes(
					await exportInWorker(ed.doc, { kind: 'mcanim', baseName: name }),
					`${name}-animated.zip`,
					'application/zip'
				);
			else
				downloadBytes(
					await exportInWorker(ed.doc, { kind: 'moxel' }),
					`${name}${MOXEL_EXT}`,
					'application/zip'
				);
			app.toast('Exported. Your project is still saved locally.', 'success');
			open = false;
		} catch (e) {
			console.error(e);
			app.toast('Export failed. Your project is still saved locally.', 'error');
		} finally {
			busy = false;
		}
	}

	const formats = $derived<[Format, string, string][]>(
		isPaint
			? [
					['png', 'PNG image', 'Lossless, keeps transparency'],
					['jpeg', 'JPEG', 'Small files for sharing; transparency becomes white'],
					['webp', 'WebP', 'Small files, keeps transparency'],
					['moxel', 'Moxel project', 'Layers and settings — for backup or another device']
				]
			: [
					[
						'png',
						isSkin ? 'Minecraft skin PNG' : 'PNG image',
						isSkin
							? '64×64, ready to upload to Minecraft'
							: multi
								? 'Current frame, flattened'
								: 'Flattened image'
					],
					[
						'gif',
						'Animated GIF',
						multi ? `${ed.doc.frames.length} frames, transparent background` : 'Single-frame GIF'
					],
					['sheet', 'Sprite sheet', 'All frames in one PNG'],
					...(multi
						? ([['mcanim', 'Minecraft animated texture', 'Vertical strip + .png.mcmeta (zip)']] as [
								Format,
								string,
								string
							][])
						: []),
					['moxel', 'Moxel project', 'Layers, frames and settings — for backup or another device']
				]
	);
</script>

<Dialog title="Export" bind:open width={520}>
	<div class="formats" role="radiogroup" aria-label="Format">
		{#each formats as [id, label, sub] (id)}
			<button
				class="fmt"
				role="radio"
				aria-checked={format === id}
				class:on={format === id}
				onclick={() => (format = id)}
			>
				<strong>{label}</strong><small>{sub}</small>
			</button>
		{/each}
	</div>

	{#if lossy}
		<div class="row">
			<label class="field">
				Quality
				<input type="range" min="0.5" max="1" step="0.01" bind:value={quality} aria-label="Quality" />
				<span>{Math.round(quality * 100)}%</span>
			</label>
			<label class="field">
				Size
				<select class="input" bind:value={lossyScale}>
					{#each [1, 0.5, 0.25] as s (s)}
						<option value={s}
							>{s * 100}% ({Math.round(ed.doc.width * s)}×{Math.round(ed.doc.height * s)})</option
						>
					{/each}
				</select>
			</label>
		</div>
	{:else if format !== 'moxel' && format !== 'mcanim' && !isPaint}
		<div class="row">
			<label class="field">
				Scale
				<select class="input" bind:value={scale} disabled={isSkin && format === 'png'}>
					{#each [1, 2, 4, 8, 16] as s (s)}
						<option value={s} disabled={ed.doc.width * s > 4096 || ed.doc.height * s > 4096}
							>{s}× ({ed.doc.width * s}×{ed.doc.height * s})</option
						>
					{/each}
				</select>
			</label>
			{#if format === 'sheet'}
				<label class="field">
					Layout
					<select class="input" bind:value={layout}>
						<option value="horizontal">Horizontal strip</option>
						<option value="vertical">Vertical strip</option>
						<option value="grid">Grid</option>
					</select>
				</label>
			{/if}
		</div>
		{#if isSkin && format === 'png'}<p class="muted small">
				Skins are always exported at their real size so Minecraft accepts them.
			</p>{/if}
	{/if}

	{#if issues.length && format !== 'moxel'}
		<div class="issues" aria-live="polite">
			<h3>{isSkin ? 'Skin check' : 'Texture check'}</h3>
			<ul>
				{#each issues as i (i.code)}
					<li class={i.severity}>
						<Icon name={i.severity === 'info' ? 'info' : 'warn'} size={15} />
						<span>{i.message}</span>
					</li>
				{/each}
			</ul>
		</div>
	{:else if isSkin && format === 'png'}
		<p class="ok"><Icon name="check" size={15} /> This skin looks valid for Minecraft.</p>
	{/if}

	{#snippet footer()}
		<button class="btn" onclick={() => (open = false)}>Cancel</button>
		<button class="btn primary" disabled={busy || blocking} onclick={run}
			>{busy ? 'Exporting…' : 'Export'}</button
		>
	{/snippet}
</Dialog>

<style>
	.formats {
		display: grid;
		gap: 6px;
		margin-bottom: 14px;
	}
	.fmt {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		padding: 9px 12px;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		background: var(--bg-1);
		text-align: left;
	}
	.fmt.on {
		border-color: var(--accent);
		background: #1d2a38;
	}
	.fmt small {
		color: var(--text-3);
	}
	.row {
		display: flex;
		gap: 12px;
	}
	.small {
		font-size: 12px;
	}
	.issues h3 {
		font-size: 12px;
		margin: 16px 0 6px;
		color: var(--text-2);
		font-weight: 600;
	}
	.issues ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}
	.issues li {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		font-size: 12px;
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--bg-1);
	}
	.issues li :global(svg) {
		flex: none;
		margin-top: 1px;
	}
	.issues .error {
		color: #ffc4c4;
		background: #3a1f23;
	}
	.issues .warning :global(svg) {
		color: var(--warn);
	}
	.issues .info :global(svg) {
		color: var(--accent);
	}
	.ok {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--ok);
		margin: 14px 0 0;
	}
</style>
