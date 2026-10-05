<script lang="ts">
	import { toolsFor } from '../../core/tools/registry';
	import type { EditorState } from '../../state/editor.svelte';
	import Icon from '../Icon.svelte';
	import { toHex } from '../../color/color';

	let { ed, horizontal = false }: { ed: EditorState; horizontal?: boolean } = $props();

	const groups = ['select', 'paint', 'shape', 'color', 'view'] as const;
	const tools = $derived(toolsFor(ed.doc.meta.kind));
</script>

<div
	class="toolbar"
	class:horizontal
	role="toolbar"
	aria-label="Tools"
	aria-orientation={horizontal ? 'horizontal' : 'vertical'}
>
	{#each groups as g, gi (g)}
		{#if gi > 0}<div class="sep" aria-hidden="true"></div>{/if}
		{#each tools.filter((t) => t.group === g) as t (t.id)}
			<button
				class="icon-btn tool"
				aria-pressed={ed.tool === t.id}
				aria-label="{t.label}{t.key ? ` (${t.key})` : ''}"
				title="{t.label}{t.key ? ` (${t.key})` : ''} — {(ed.paintMode && t.paintHint) || t.hint}"
				onclick={() => ed.setTool(t.id)}
			>
				<Icon name={t.id} size={19} />
			</button>
		{/each}
	{/each}
	<div class="sep" aria-hidden="true"></div>
	<div class="swatches">
		<button
			class="sw bg"
			style:--c={toHex(ed.bg)}
			aria-label="Background colour {toHex(ed.bg)}. Click to swap (X)."
			title="Background colour — click to swap (X)"
			onclick={() => ed.swapColors()}
		></button>
		<button
			class="sw fg"
			style:--c={toHex(ed.fg)}
			aria-label="Foreground colour {toHex(ed.fg)}"
			title="Foreground colour"
			onclick={() => document.getElementById('color-hex')?.focus()}
		></button>
	</div>
</div>

<style>
	.toolbar {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 6px 4px;
		width: 44px;
		background: var(--bg-1);
		border-right: 1px solid var(--line);
		overflow-y: auto;
		scrollbar-width: none;
	}
	.toolbar.horizontal {
		flex-direction: row;
		width: auto;
		height: 48px;
		padding: 4px 8px;
		border-right: 0;
		border-top: 1px solid var(--line);
		overflow-x: auto;
		overflow-y: hidden;
	}
	.tool {
		width: 34px;
		height: 34px;
		flex: none;
	}
	.sep {
		width: 22px;
		height: 1px;
		margin: 4px 0;
		background: var(--line-2);
		flex: none;
	}
	.horizontal .sep {
		width: 1px;
		height: 22px;
		margin: 0 4px;
	}
	.swatches {
		position: relative;
		width: 34px;
		height: 34px;
		flex: none;
		margin-top: 2px;
	}
	.sw {
		position: absolute;
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: 4px;
		border: 2px solid var(--bg-1);
		box-shadow: 0 0 0 1px var(--line-2);
		background:
			linear-gradient(var(--c), var(--c)),
			repeating-conic-gradient(#555 0 25%, #888 0 50%) 0 0 / 8px 8px;
	}
	.sw.fg {
		top: 0;
		left: 0;
		z-index: 1;
	}
	.sw.bg {
		bottom: 0;
		right: 0;
	}
</style>
