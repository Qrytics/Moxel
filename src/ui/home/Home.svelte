<script lang="ts">
	import { onMount } from 'svelte';
	import { app } from '../../state/app.svelte';
	import {
		createDocument,
		downloadBackup,
		exportProjectById,
		importFiles,
		IMPORT_ACCEPT,
		pickFiles,
		saveNewDocument,
		type NewProjectSpec
	} from '../../state/projects';
	import type { ProjectMeta } from '../../persistence/store';
	import Icon from '../Icon.svelte';
	import Logo from '../Logo.svelte';
	import Menu from '../Menu.svelte';
	import Dialog from '../Dialog.svelte';
	import NewProjectDialog from './NewProjectDialog.svelte';
	import { relativeTime } from '../time';

	let newOpen = $state(false);
	let newTab = $state<'skin' | 'texture' | 'canvas' | 'animation'>('skin');
	let renaming = $state<ProjectMeta | null>(null);
	let renameValue = $state('');
	let deleting = $state<ProjectMeta | null>(null);
	let joinOpen = $state(false);
	let joinLink = $state('');
	let joinError = $state('');
	let dragging = $state(false);
	let usage = $state<string | null>(null);
	let now = $state(Date.now());

	const firstRun = $derived(app.projects.length === 0);
	const lastProject = $derived(app.projects.find((p) => p.id === app.settings.lastOpenProject));

	onMount(() => {
		const t = setInterval(() => (now = Date.now()), 30_000);
		navigator.storage
			?.estimate?.()
			.then((e) => {
				if (e.usage !== undefined) usage = formatBytes(e.usage);
			})
			.catch(() => {});
		return () => clearInterval(t);
	});

	function formatBytes(n: number) {
		if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
		return `${(n / 1024 / 1024).toFixed(1)} MB`;
	}

	function newProject(tab: typeof newTab) {
		newTab = tab;
		newOpen = true;
	}

	async function create(spec: NewProjectSpec) {
		const doc = createDocument(spec);
		try {
			await saveNewDocument(doc);
		} catch {
			app.toast(
				"Couldn't save the new project locally. You can still edit it, but export before closing.",
				'error'
			);
		}
		app.navigate({ name: 'editor', id: doc.meta.id });
	}

	async function doImport(accept: string, asSkin?: boolean) {
		const files = await pickFiles(accept, true);
		if (!files.length) return;
		const ids = await importFiles(files, { asSkin });
		if (ids.length === 1) app.navigate({ name: 'editor', id: ids[0] });
		else if (ids.length > 1) app.toast(`Imported ${ids.length} projects.`, 'success');
	}

	async function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (!e.dataTransfer?.files.length) return;
		const ids = await importFiles(e.dataTransfer.files);
		if (ids.length === 1) app.navigate({ name: 'editor', id: ids[0] });
	}

	async function duplicate(p: ProjectMeta) {
		const copy = await app.store!.duplicate(p.id);
		await app.refreshProjects();
		if (copy) app.toast(`Duplicated “${p.name}”.`, 'success');
	}

	async function confirmRename() {
		if (!renaming) return;
		const n = renameValue.trim();
		if (n) {
			await app.store!.rename(renaming.id, n.slice(0, 80));
			await app.refreshProjects();
		}
		renaming = null;
	}

	async function confirmDelete() {
		if (!deleting) return;
		await app.store!.delete(deleting.id);
		if (app.settings.lastOpenProject === deleting.id) void app.saveSettings({ lastOpenProject: null });
		app.toast(`Deleted “${deleting.name}”.`);
		deleting = null;
		await app.refreshProjects();
	}

	function join() {
		const m =
			joinLink.match(/#\/join\/([a-f0-9]{16,64})(?:\?mode=(side|together))?/) ??
			joinLink.match(/^([a-f0-9]{32})$/);
		if (!m) {
			joinError = 'Paste the full invite link your friend shared with you.';
			return;
		}
		joinOpen = false;
		app.navigate({ name: 'join', room: m[1], mode: m[2] === 'side' ? 'side' : 'together' });
	}

	function kindLabel(p: ProjectMeta) {
		if (p.kind === 'skin') return `Skin · ${p.model === 'slim' ? 'Slim' : 'Classic'}`;
		const size = `${p.width}×${p.height}`;
		if (p.frameCount > 1) return `Animation · ${size} · ${p.frameCount} frames`;
		return p.kind === 'texture' ? `Texture · ${size}` : `Canvas · ${size}`;
	}
</script>

<div
	class="home"
	role="region"
	aria-label="Projects"
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={(e) => {
		if (e.target === e.currentTarget) dragging = false;
	}}
	ondrop={onDrop}
>
	<header class="top">
		<div class="brand"><Logo /> <span>Moxel</span></div>
		<div class="top-actions">
			<button class="btn ghost" onclick={() => ((joinOpen = true), (joinError = ''), (joinLink = ''))}
				><Icon name="users" size={16} /> Join live session</button
			>
			<a class="btn ghost" href="https://www.mario-belmonte.com" rel="noopener">mario-belmonte.com</a>
		</div>
	</header>

	{#if app.storageError}
		<div class="banner err" role="alert"><Icon name="warn" size={16} /> {app.storageError}</div>
	{/if}

	<main>
		{#if firstRun}
			<section class="welcome">
				<h1>Welcome to Moxel</h1>
				<p class="lede">
					Create Minecraft skins, textures, pixel art and animations directly in your browser.
				</p>
				<div class="actions">
					<button class="action primary" onclick={() => newProject('skin')}>
						<Icon name="cube" size={22} />
						<strong>Create skin</strong><small>Classic or slim, with 3D preview</small>
					</button>
					<button class="action" onclick={() => newProject('texture')}>
						<Icon name="grid" size={22} />
						<strong>Create texture</strong><small>Blocks, items, GUI, mobs</small>
					</button>
					<button class="action" onclick={() => newProject('animation')}>
						<Icon name="film" size={22} />
						<strong>Pixel art & animation</strong><small>Any size, frame by frame</small>
					</button>
					<button class="action" onclick={() => doImport('image/png,image/gif,image/webp,image/jpeg,.png')}>
						<Icon name="image" size={22} />
						<strong>Import PNG</strong><small>Existing skins and images</small>
					</button>
					<button class="action" onclick={() => doImport('.moxel,.moxelbackup')}>
						<Icon name="upload" size={22} />
						<strong>Import Moxel project</strong><small>.moxel or backup file</small>
					</button>
				</div>
				<p class="privacy">
					<Icon name="lock" size={15} />
					<span>
						Your projects are automatically saved locally in this browser. Your artwork is not uploaded to our
						servers, and no account is needed.
					</span>
				</p>
			</section>
		{:else}
			<section class="list">
				<div class="list-head">
					<h1>My projects</h1>
					<div class="list-actions">
						<button class="btn primary" onclick={() => newProject('skin')}
							><Icon name="plus" size={16} /> New project</button
						>
						<button class="btn" onclick={() => doImport(IMPORT_ACCEPT)}
							><Icon name="upload" size={16} /> Import</button
						>
						<button class="btn" onclick={downloadBackup}
							><Icon name="download" size={16} /> Download backup</button
						>
					</div>
				</div>

				{#if lastProject}
					<button class="resume" onclick={() => app.navigate({ name: 'editor', id: lastProject.id })}>
						{#if lastProject.thumbnail}<img src={lastProject.thumbnail} alt="" />{/if}
						<span>
							<strong>Continue editing “{lastProject.name}”</strong>
							<small>Autosaved {relativeTime(lastProject.updatedAt, now)}</small>
						</span>
						<Icon name="chevron" />
					</button>
				{/if}

				<ul class="grid">
					{#each app.projects as p (p.id)}
						<li class="card">
							<button
								class="thumb checker"
								onclick={() => app.navigate({ name: 'editor', id: p.id })}
								aria-label="Open {p.name}"
							>
								{#if p.thumbnail}<img src={p.thumbnail} alt="" />{/if}
								{#if p.live}<span class="live">Live copy</span>{/if}
							</button>
							<div class="meta">
								<div class="text">
									<strong title={p.name}>{p.name}</strong>
									<small>{kindLabel(p)}</small>
									<small>Modified {relativeTime(p.updatedAt, now)}</small>
								</div>
								<div class="card-actions">
									<button class="btn sm" onclick={() => app.navigate({ name: 'editor', id: p.id })}
										>Open</button
									>
									<Menu
										label="More actions for {p.name}"
										align="right"
										triggerClass="icon-btn"
										items={[
											{ label: 'Rename…', action: () => ((renaming = p), (renameValue = p.name)) },
											{ label: 'Duplicate', action: () => duplicate(p) },
											{ label: 'Export project (.moxel)', action: () => exportProjectById(p.id) },
											{ separator: true, label: '' },
											{ label: 'Delete…', danger: true, action: () => (deleting = p) }
										]}
									>
										{#snippet trigger()}<Icon name="more" />{/snippet}
									</Menu>
								</div>
							</div>
						</li>
					{/each}
				</ul>
			</section>

			<p class="privacy small">
				<Icon name="lock" size={14} />
				<span>
					Saved locally in this browser{usage ? ` (${usage} used)` : ''}. Nothing is uploaded to our servers.
					Browser storage belongs to this device and browser — use
					<button class="link" onclick={downloadBackup}>Download backup</button> or export projects to keep a copy
					or move them to another device.
				</span>
			</p>
		{/if}
	</main>

	{#if dragging}<div class="drop" aria-hidden="true">Drop PNG images or .moxel files to import</div>{/if}
</div>

<NewProjectDialog bind:open={newOpen} initialTab={newTab} oncreate={create} />

<Dialog title="Rename project" open={!!renaming} onclose={() => (renaming = null)} width={380}>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			void confirmRename();
		}}
	>
		<label class="field">Name <input class="input" bind:value={renameValue} maxlength="80" /></label>
	</form>
	{#snippet footer()}
		<button class="btn" onclick={() => (renaming = null)}>Cancel</button>
		<button class="btn primary" onclick={confirmRename}>Rename</button>
	{/snippet}
</Dialog>

<Dialog title="Delete project?" open={!!deleting} onclose={() => (deleting = null)} width={400}>
	<p>
		“{deleting?.name}” will be permanently removed from this browser. This can't be undone — export it first
		if you might want it later.
	</p>
	{#snippet footer()}
		<button class="btn" onclick={() => (deleting = null)}>Cancel</button>
		<button class="btn primary danger-fill" onclick={confirmDelete}>Delete project</button>
	{/snippet}
</Dialog>

<Dialog title="Join a live session" bind:open={joinOpen} width={460}>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			join();
		}}
	>
		<label class="field">
			Invite link
			<input
				class="input"
				bind:value={joinLink}
				placeholder="https://www.mario-belmonte.com/Moxel/#/join/…"
			/>
		</label>
		{#if joinError}<p class="err">{joinError}</p>{/if}
		<p class="muted small-text">
			Live sessions connect browsers directly to each other. Moxel's server only introduces you; it never sees
			your artwork.
		</p>
	</form>
	{#snippet footer()}
		<button class="btn" onclick={() => (joinOpen = false)}>Cancel</button>
		<button class="btn primary" onclick={join}>Join</button>
	{/snippet}
</Dialog>

<style>
	.home {
		min-height: 100%;
		display: flex;
		flex-direction: column;
		position: relative;
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		height: 52px;
		padding: 0 20px;
		border-bottom: 1px solid var(--line);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
		font-size: 15px;
		letter-spacing: 0.01em;
	}
	.top-actions {
		display: flex;
		gap: 4px;
	}
	.top-actions a {
		text-decoration: none;
		color: var(--text-2);
	}
	.banner {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 20px;
	}
	.banner.err {
		background: #3a1f23;
		color: #ffd0d0;
	}
	main {
		flex: 1;
		width: min(1120px, 100%);
		margin: 0 auto;
		padding: 32px 20px 48px;
	}
	.welcome {
		max-width: 820px;
		margin: 6vh auto 0;
	}
	h1 {
		margin: 0;
		font-size: 26px;
		font-weight: 700;
		letter-spacing: -0.01em;
	}
	.lede {
		margin: 8px 0 28px;
		font-size: 15px;
		color: var(--text-2);
	}
	.actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px;
	}
	.action {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		padding: 16px;
		min-height: 120px;
		border-radius: 10px;
		border: 1px solid var(--line-2);
		background: var(--bg-2);
		text-align: left;
		transition:
			border-color 0.15s,
			transform 0.15s,
			background 0.15s;
	}
	.action :global(svg) {
		color: var(--accent);
		margin-bottom: auto;
	}
	.action:hover {
		border-color: #4b6c8f;
		background: #1f242c;
		transform: translateY(-1px);
	}
	.action.primary {
		border-color: #3a6a99;
		background: #1a2633;
	}
	.action strong {
		font-size: 14px;
		margin-top: 18px;
	}
	.action small {
		color: var(--text-3);
	}
	.privacy {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		margin-top: 28px;
		padding: 12px 14px;
		border-radius: 8px;
		background: var(--bg-1);
		border: 1px solid var(--line);
		color: var(--text-2);
	}
	.privacy :global(svg) {
		flex: none;
		margin-top: 1px;
		color: var(--ok);
	}
	.privacy.small {
		font-size: 12px;
		margin-top: 36px;
	}
	.link {
		border: 0;
		background: none;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
	}
	.list-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 20px;
	}
	.list-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.resume {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 14px 10px 10px;
		margin-bottom: 20px;
		border-radius: 10px;
		border: 1px solid #2e4a66;
		background: #182230;
		text-align: left;
	}
	.resume img {
		width: 44px;
		height: 44px;
		image-rendering: pixelated;
		border-radius: 6px;
		background: var(--bg-3);
	}
	.resume span {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
	.resume small {
		color: var(--text-2);
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		gap: 14px;
	}
	.card {
		border: 1px solid var(--line);
		border-radius: 10px;
		background: var(--bg-2);
		overflow: hidden;
		transition: border-color 0.15s;
	}
	.card:hover {
		border-color: var(--line-2);
	}
	.thumb {
		position: relative;
		display: grid;
		place-items: center;
		width: 100%;
		aspect-ratio: 4 / 3;
		border: 0;
		border-bottom: 1px solid var(--line);
		padding: 0;
	}
	.thumb img {
		max-width: 70%;
		max-height: 80%;
		image-rendering: pixelated;
	}
	.live {
		position: absolute;
		top: 8px;
		left: 8px;
		padding: 2px 6px;
		border-radius: 4px;
		background: #26443a;
		color: #9ff0c0;
		font-size: 11px;
	}
	.meta {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		padding: 10px 10px 10px 12px;
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.text strong {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.text small {
		color: var(--text-3);
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.card-actions {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.drop {
		position: fixed;
		inset: 12px;
		display: grid;
		place-items: center;
		border: 2px dashed var(--accent);
		border-radius: 14px;
		background: rgba(21, 22, 26, 0.85);
		font-size: 16px;
		pointer-events: none;
		z-index: 40;
	}
	.err {
		color: var(--err);
		font-size: 12px;
	}
	.small-text {
		font-size: 12px;
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	:global(.btn.danger-fill) {
		background: #c9474f;
		border-color: #c9474f;
		color: #fff;
	}
	@media (max-width: 640px) {
		.top-actions a {
			display: none;
		}
		main {
			padding-top: 20px;
		}
		.welcome {
			margin-top: 0;
		}
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		}
	}
</style>
