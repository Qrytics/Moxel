<script lang="ts">
	import { app } from '../../state/app.svelte';
	import { collab, type LiveMode } from '../../state/collab.svelte';
	import { createDocument, saveNewDocument } from '../../state/projects';
	import Icon from '../Icon.svelte';
	import Logo from '../Logo.svelte';

	let { room, mode }: { room: string; mode: LiveMode } = $props();

	let name = $state(app.settings.displayName);
	let startedHere = $state(false);
	const started = $derived(startedHere || collab.session?.room === room);
	const session = $derived(collab.session?.room === room ? collab.session : null);

	function start() {
		collab.join(room, mode, name.trim() || collab.displayName());
		startedHere = true;
	}

	// Together mode: once the host's canvas arrives, keep a local copy and open it.
	let opened = false;
	$effect(() => {
		const s = session;
		if (!s || mode !== 'together' || !s.docReady || !s.doc || opened) return;
		opened = true;
		const doc = s.doc;
		void (async () => {
			try {
				await app.store!.save(doc, { live: true });
				await app.refreshProjects();
			} catch {
				/* the editor keeps working from memory */
			}
			app.navigate({ name: 'editor', id: doc.meta.id });
		})();
	});

	async function openOwn(id: string) {
		app.navigate({ name: 'editor', id });
	}

	async function newForSide() {
		const doc = createDocument({ type: 'skin', name: 'Live skin', model: 'classic', template: 'starter' });
		await saveNewDocument(doc);
		app.navigate({ name: 'editor', id: doc.meta.id });
	}

	function cancel() {
		collab.leave();
		app.navigate({ name: 'home' });
	}
</script>

<div class="join">
	<div class="card">
		<p class="brand"><Logo size={26} /> Moxel live session</p>
		{#if !started}
			<h1>{mode === 'together' ? 'Draw together' : 'Work side by side'}</h1>
			<p class="muted">
				{mode === 'together'
					? "You've been invited to draw on a shared canvas. A copy is saved in this browser so you keep it after the session."
					: "You've been invited to work next to your friends. You'll each work on your own project and see everyone else's canvas live."}
			</p>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					start();
				}}
			>
				<label class="field"
					>Your name (shown to others) <input
						class="input"
						bind:value={name}
						maxlength="32"
						placeholder="Guest"
					/></label
				>
				<div class="row">
					<button type="button" class="btn" onclick={cancel}>Cancel</button>
					<button type="submit" class="btn primary">Join session</button>
				</div>
			</form>
			<p class="privacy">
				<Icon name="lock" size={14} /> Browsers connect directly to each other. Moxel's server only introduces you
				and never sees your artwork.
			</p>
		{:else if session?.status === 'error'}
			<h1>Couldn't join</h1>
			<p class="err">{session.error}</p>
			<p class="muted">
				The person who invited you needs to have Moxel open with the session running. Some strict networks
				(corporate or school) block direct browser connections.
			</p>
			<div class="row">
				<button class="btn" onclick={cancel}>Back to projects</button><button
					class="btn primary"
					onclick={() => ((startedHere = false), collab.leave())}>Try again</button
				>
			</div>
		{:else if mode === 'side' && session?.status === 'online'}
			<h1>Choose what you'll work on</h1>
			<p class="muted">Your friends will see this project live while you draw.</p>
			<div class="list scroll">
				<button class="item new" onclick={newForSide}><Icon name="plus" /> New skin</button>
				{#each app.projects as p (p.id)}
					<button class="item" onclick={() => openOwn(p.id)}>
						{#if p.thumbnail}<img src={p.thumbnail} alt="" />{:else}<span class="ph"></span>{/if}
						<span>{p.name}</span>
					</button>
				{/each}
			</div>
			<div class="row"><button class="btn" onclick={cancel}>Leave session</button></div>
		{:else}
			<h1>Connecting…</h1>
			<p class="muted" aria-live="polite">
				{session?.status === 'waiting'
					? 'Connected. Waiting for the shared canvas…'
					: 'Reaching the other browsers…'}
			</p>
			<div class="spinner" aria-hidden="true"></div>
			<div class="row"><button class="btn" onclick={cancel}>Cancel</button></div>
		{/if}
	</div>
</div>

<style>
	.join {
		min-height: 100%;
		display: grid;
		place-items: center;
		padding: 20px;
	}
	.card {
		width: min(460px, 100%);
		padding: 24px;
		border-radius: 12px;
		border: 1px solid var(--line-2);
		background: var(--bg-2);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		font-weight: 600;
		color: var(--text-2);
	}
	h1 {
		margin: 0;
		font-size: 20px;
	}
	p {
		margin: 0;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.row {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
	}
	.privacy {
		display: flex;
		gap: 8px;
		font-size: 12px;
		color: var(--text-3);
	}
	.privacy :global(svg) {
		flex: none;
		color: var(--ok);
	}
	.err {
		color: var(--err);
	}
	.spinner {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		border: 3px solid var(--bg-4);
		border-top-color: var(--accent);
		animation: s 0.8s linear infinite;
	}
	@keyframes s {
		to {
			transform: rotate(360deg);
		}
	}
	.list {
		max-height: 300px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid var(--line);
		background: var(--bg-1);
		text-align: left;
	}
	.item:hover {
		border-color: var(--accent);
	}
	.item img,
	.ph {
		width: 32px;
		height: 32px;
		image-rendering: pixelated;
		border-radius: 4px;
		background: var(--bg-3);
	}
	.item.new {
		color: var(--accent);
		font-weight: 600;
	}
</style>
