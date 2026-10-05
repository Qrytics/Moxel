<script lang="ts">
	import { onMount } from 'svelte';
	import { app } from '../state/app.svelte';
	import Home from './home/Home.svelte';
	import EditorView from './editor/EditorView.svelte';
	import JoinView from './collab/JoinView.svelte';
	import Toasts from './Toasts.svelte';

	onMount(() => {
		void app.init();
	});
</script>

{#if !app.ready}
	<div class="boot" aria-busy="true">
		<div class="mark" aria-hidden="true"></div>
		<span class="muted">Opening Moxel…</span>
	</div>
{:else if app.route.name === 'editor'}
	{#key app.route.id}
		<EditorView projectId={app.route.id} />
	{/key}
{:else if app.route.name === 'join'}
	{#key app.route.room}
		<JoinView room={app.route.room} mode={app.route.mode} />
	{/key}
{:else}
	<Home />
{/if}

<Toasts />

<style>
	.boot {
		height: 100%;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 14px;
	}
	.mark {
		width: 28px;
		height: 28px;
		background:
			linear-gradient(var(--accent) 0 0) 0 0 / 50% 50% no-repeat,
			linear-gradient(#7ee0a1 0 0) 100% 100% / 50% 50% no-repeat,
			var(--bg-3);
		border-radius: 4px;
		animation: spin 1.2s steps(4) infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
