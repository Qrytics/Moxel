<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		title,
		open = $bindable(false),
		width = 440,
		onclose,
		children,
		footer
	}: {
		title: string;
		open?: boolean;
		width?: number;
		onclose?: () => void;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	function close() {
		open = false;
		onclose?.();
	}
</script>

<!-- Native <dialog>: focus trapping, Escape and inert background for free. -->
<dialog
	bind:this={dialog}
	style:width="min({width}px, calc(100vw - 24px))"
	aria-labelledby="dlg-title"
	onclose={() => {
		if (open) close();
	}}
	onclick={(e) => {
		if (e.target === dialog) close();
	}}
>
	{#if open}
		<header>
			<h2 id="dlg-title">{title}</h2>
			<button class="icon-btn" aria-label="Close" onclick={close}><Icon name="close" /></button>
		</header>
		<div class="body">{@render children()}</div>
		{#if footer}<footer>{@render footer()}</footer>{/if}
	{/if}
</dialog>

<style>
	dialog {
		padding: 0;
		border: 1px solid var(--line-2);
		border-radius: 10px;
		background: var(--bg-2);
		color: var(--text);
		box-shadow: var(--shadow);
		max-height: calc(100vh - 32px);
	}
	dialog[open] {
		display: flex;
		flex-direction: column;
		animation: pop 0.14s ease-out;
	}
	dialog::backdrop {
		background: rgba(8, 9, 12, 0.6);
		backdrop-filter: blur(2px);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.985);
		}
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 14px 10px 18px;
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	.body {
		padding: 4px 18px 16px;
		overflow: auto;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 12px 18px;
		border-top: 1px solid var(--line);
		background: var(--bg-1);
		border-radius: 0 0 10px 10px;
	}
</style>
