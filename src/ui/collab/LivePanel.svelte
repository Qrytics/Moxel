<script lang="ts">
	import Dialog from '../Dialog.svelte';
	import Icon from '../Icon.svelte';
	import type { EditorState } from '../../state/editor.svelte';
	import { collab, type LiveMode } from '../../state/collab.svelte';
	import { app } from '../../state/app.svelte';

	let { ed, open = $bindable(false) }: { ed: EditorState; open?: boolean } = $props();

	let mode = $state<LiveMode>('together');
	let name = $state(app.settings.displayName);
	const session = $derived(collab.session);
	const attachedHere = $derived(!!session && !!ed.remote);

	function start() {
		collab.host(ed, mode, name.trim() || collab.displayName());
	}

	async function copy() {
		if (!session) return;
		try {
			await navigator.clipboard.writeText(session.inviteLink);
			app.toast('Invite link copied.', 'success');
		} catch {
			app.toast('Select the link and copy it manually.');
		}
	}

	function leave() {
		collab.leave();
		ed.peerId = undefined;
		app.toast('You left the live session. Your copy stays saved in this browser.');
	}
</script>

<Dialog title="Live session" bind:open width={480}>
	{#if !attachedHere}
		<p class="muted">
			Invite friends with a link. Browsers connect directly to each other — your artwork never touches our
			servers.
		</p>
		<div class="modes" role="radiogroup" aria-label="Session type">
			<button
				role="radio"
				aria-checked={mode === 'together'}
				class:on={mode === 'together'}
				onclick={() => (mode = 'together')}
			>
				<Icon name="users" size={20} />
				<strong>Draw together</strong>
				<small
					>Everyone paints on this canvas. Live cursors; each person's undo only affects their own strokes.</small
				>
			</button>
			<button
				role="radio"
				aria-checked={mode === 'side'}
				class:on={mode === 'side'}
				onclick={() => (mode = 'side')}
			>
				<Icon name="split" size={20} />
				<strong>Side by side</strong>
				<small>Everyone works on their own project and sees the others' canvases update live.</small>
			</button>
		</div>
		<label class="field"
			>Your name <input class="input" bind:value={name} maxlength="32" placeholder="Guest" /></label
		>
	{:else if session}
		<div class="status">
			<span class="dot {session.status}"></span>
			{session.status === 'online'
				? session.mode === 'together'
					? 'Live · drawing together'
					: 'Live · side by side'
				: session.status === 'error'
					? session.error
					: 'Connecting…'}
		</div>
		<label class="field">
			Invite link
			<div class="link">
				<input class="input" readonly value={session.inviteLink} onfocus={(e) => e.currentTarget.select()} />
				<button class="btn" onclick={copy}><Icon name="link" size={15} /> Copy</button>
			</div>
		</label>
		<h3>People ({session.peers.length + 1}/6)</h3>
		<ul class="people">
			<li>
				<span class="sw" style:background={app.settings.cursorColor}></span>
				{session.name} (you){session.isHost ? ' · host' : ''}
			</li>
			{#each session.peers as p (p.id)}
				<li>
					<span class="sw" style:background={p.color}></span>
					{p.name}{p.isHost ? ' · host' : ''}
					<span class="state {p.state}"
						>{p.state === 'connected' ? '' : p.state === 'failed' ? "couldn't connect" : 'connecting…'}</span
					>
				</li>
			{/each}
		</ul>
		{#if session.peers.some((p) => p.state === 'failed')}
			<p class="warn small">
				A direct connection failed. Very strict networks (corporate, school, some mobile carriers) can block
				browser-to-browser connections.
			</p>
		{/if}
		{#if session.mode === 'together'}
			<p class="muted small">Tip: claim a layer from the layer menu (⋯) so nobody else draws on it.</p>
		{/if}
	{/if}

	{#snippet footer()}
		{#if !attachedHere}
			<button class="btn" onclick={() => (open = false)}>Cancel</button>
			<button class="btn primary" onclick={start}>Start session</button>
		{:else}
			{#if session?.mode === 'together' && !session.isHost}<button
					class="btn"
					onclick={() => session?.requestResync()}>Resync</button
				>{/if}
			<button class="btn danger" onclick={leave}>Leave session</button>
			<button class="btn primary" onclick={() => (open = false)}>Done</button>
		{/if}
	{/snippet}
</Dialog>

<style>
	.modes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin: 12px 0;
	}
	.modes button {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		padding: 12px;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		background: var(--bg-1);
		text-align: left;
	}
	.modes button.on {
		border-color: var(--accent);
		background: #1d2a38;
	}
	.modes :global(svg) {
		color: var(--accent);
	}
	.modes small {
		color: var(--text-3);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--warn);
	}
	.dot.online {
		background: var(--ok);
	}
	.dot.error {
		background: var(--err);
	}
	.link {
		display: flex;
		gap: 6px;
	}
	.link input {
		flex: 1;
		font-family: var(--mono);
		font-size: 11px;
	}
	h3 {
		font-size: 12px;
		color: var(--text-2);
		margin: 16px 0 6px;
	}
	.people {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 4px;
	}
	.people li {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.sw {
		width: 12px;
		height: 12px;
		border-radius: 3px;
	}
	.state {
		color: var(--text-3);
		font-size: 12px;
	}
	.state.failed {
		color: var(--err);
	}
	.small {
		font-size: 12px;
	}
	.warn {
		color: var(--warn);
	}
</style>
