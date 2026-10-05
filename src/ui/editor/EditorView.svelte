<script lang="ts">
	import { onMount } from 'svelte';
	import { app } from '../../state/app.svelte';
	import { collab } from '../../state/collab.svelte';
	import { EditorState } from '../../state/editor.svelte';
	import { resolveKey } from '../../state/shortcuts';
	import {
		createDocument,
		decodeImageFile,
		downloadBackup,
		exportProjectFile,
		importFiles,
		IMPORT_ACCEPT,
		pickFiles,
		saveNewDocument,
		type NewProjectSpec
	} from '../../state/projects';
	import type { MoxelDocument } from '../../core/document/document';
	import { scaleNearest } from '../../core/document/commands';
	import Icon from '../Icon.svelte';
	import Logo from '../Logo.svelte';
	import MenuBar from './MenuBar.svelte';
	import Toolbar from './Toolbar.svelte';
	import ToolOptions from './ToolOptions.svelte';
	import CanvasView from './CanvasView.svelte';
	import LayersPanel from './LayersPanel.svelte';
	import ColorPanel from './ColorPanel.svelte';
	import Timeline from './Timeline.svelte';
	import Preview3DPanel from './Preview3DPanel.svelte';
	import ExportDialog from './ExportDialog.svelte';
	import SizeDialogs from './SizeDialogs.svelte';
	import InfoDialogs from './InfoDialogs.svelte';
	import NewProjectDialog from '../home/NewProjectDialog.svelte';
	import LivePanel from '../collab/LivePanel.svelte';
	import FriendsPanel from '../collab/FriendsPanel.svelte';
	import { clockTime } from '../time';

	let { projectId }: { projectId: string } = $props();

	let ed = $state<EditorState | null>(null);
	let loadError = $state<string | null>(null);
	let exportOpen = $state(false);
	let sizeMode = $state<'canvas' | 'image' | 'selection' | null>(null);
	let info = $state<'shortcuts' | 'about' | null>(null);
	let newOpen = $state(false);
	let liveOpen = $state(false);
	let hoverLabel = $state<string | null>(null);
	let renaming = $state(false);
	let nameValue = $state('');
	let narrow = $state(false);
	let drawer = $state<'layers' | 'color' | null>(null);
	let expandedFriend = $state<string | null>(null);
	let tick = $state(0);

	onMount(() => {
		let disposed = false;
		(async () => {
			let doc: MoxelDocument | null = null;
			const s = collab.session;
			if (s?.doc && s.doc.meta.id === projectId) doc = s.doc;
			else {
				try {
					doc = (await app.store!.load(projectId)) ?? null;
				} catch (e) {
					loadError = `This project couldn't be opened: ${e instanceof Error ? e.message : e}`;
					return;
				}
			}
			if (disposed) return;
			if (!doc) {
				loadError =
					"This project doesn't exist in this browser. It may have been deleted, or it was created on another device or browser.";
				return;
			}
			const meta = app.projects.find((p) => p.id === projectId);
			const editor = new EditorState(doc, app.store!, { live: meta?.live || s?.doc === doc });
			ed = editor;
			if (s && (s.doc === doc || (s.mode === 'side' && (!s.doc || s.doc === doc || !s.docReady))))
				s.attach(editor);
			void app.saveSettings({ lastOpenProject: projectId });
		})();

		const mq = window.matchMedia('(max-width: 900px)');
		const onMq = () => (narrow = mq.matches);
		onMq();
		mq.addEventListener('change', onMq);
		const clock = setInterval(() => tick++, 15_000);

		// Never lose work: write immediately when the tab is hidden or closed.
		const flush = () => void ed?.autosave.flush();
		const onVis = () => document.visibilityState === 'hidden' && flush();
		const beforeUnload = (e: BeforeUnloadEvent) => {
			flush();
			if (ed && (app.storageError || ed.save.status === 'error')) {
				e.preventDefault();
				e.returnValue = '';
			}
		};
		document.addEventListener('visibilitychange', onVis);
		window.addEventListener('pagehide', flush);
		window.addEventListener('beforeunload', beforeUnload);
		return () => {
			disposed = true;
			flush();
			mq.removeEventListener('change', onMq);
			clearInterval(clock);
			document.removeEventListener('visibilitychange', onVis);
			window.removeEventListener('pagehide', flush);
			window.removeEventListener('beforeunload', beforeUnload);
			if (collab.session && ed && ed.remote) collab.session.detach();
			ed?.dispose();
		};
	});

	const isTyping = (t: EventTarget | null) => {
		const el = t as HTMLElement | null;
		return (
			!!el &&
			(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
		);
	};
	const anyDialog = () => !!document.querySelector('dialog[open]');

	function onKey(e: KeyboardEvent) {
		if (!ed || isTyping(e.target) || anyDialog()) return;
		// Let menus and focused buttons handle Enter/Space themselves.
		if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement)?.tagName === 'BUTTON') return;
		if (ed.tool === 'move' && e.key.startsWith('Arrow') && !e.metaKey && !e.ctrlKey) {
			e.preventDefault();
			const d = e.shiftKey ? 10 : 1;
			const [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[
				e.key
			] ?? [0, 0];
			ed.nudge(dx, dy);
			return;
		}
		const r = resolveKey(e);
		if (!r) return;
		e.preventDefault();
		if (r.type === 'tool') ed.setTool(r.tool);
		else run(r.cmd);
	}

	async function onPaste(e: ClipboardEvent) {
		if (!ed || isTyping(e.target)) return;
		const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
		if (!file) return; // Ctrl+V with no external image is handled by the keyboard shortcut.
		e.preventDefault();
		await pasteImageFile(file);
	}

	async function pasteImageFile(file: File) {
		if (!ed) return;
		try {
			const img = await decodeImageFile(file);
			let { width: w, height: h, data } = img;
			if (w > ed.doc.width * 4 || h > ed.doc.height * 4) {
				const k = Math.min(ed.doc.width / w, ed.doc.height / h);
				const nw = Math.max(1, Math.round(w * k)),
					nh = Math.max(1, Math.round(h * k));
				data = scaleNearest(data, w, h, nw, nh);
				w = nw;
				h = nh;
				ed.flashNotice('Large image scaled down to fit the canvas.');
			}
			ed.paste({ x: Math.round((ed.doc.width - w) / 2), y: Math.round((ed.doc.height - h) / 2), w, h, data });
		} catch {
			app.toast("That image couldn't be read.", 'error');
		}
	}

	function onDrop(e: DragEvent) {
		const files = [...(e.dataTransfer?.files ?? [])];
		if (!files.length || !ed) return;
		e.preventDefault();
		const img = files.find((f) => f.type.startsWith('image/'));
		if (img) void pasteImageFile(img);
		else
			void importFiles(files).then((ids) => {
				if (ids.length)
					app.toast('Imported. Find it in your project list.', 'success', {
						label: 'Open',
						run: () => app.navigate({ name: 'editor', id: ids[0] })
					});
			});
	}

	async function newProject(spec: NewProjectSpec) {
		const doc = createDocument(spec);
		await saveNewDocument(doc);
		app.navigate({ name: 'editor', id: doc.meta.id });
	}

	function run(cmd: string) {
		const e = ed;
		if (!e) return;
		switch (cmd) {
			case 'undo':
				return e.undo();
			case 'redo':
				return e.redo();
			case 'save':
				void e.autosave.flush().then(() => {
					if (e.save.status === 'saved') e.flashNotice('Saved locally ✓');
					else if (e.save.status === 'memory')
						e.flashNotice('Storage unavailable — export to keep your work');
				});
				if (e.save.status !== 'pending' && e.save.status !== 'saving')
					e.flashNotice(
						app.storageError ? 'Storage unavailable — export to keep your work' : 'Saved locally ✓'
					);
				return;
			case 'open':
				return void pickFiles(IMPORT_ACCEPT, true).then((f) =>
					importFiles(f).then((ids) => {
						if (ids.length === 1) app.navigate({ name: 'editor', id: ids[0] });
						else if (ids.length > 1) app.navigate({ name: 'home' });
					})
				);
			case 'importLayer':
				return void pickFiles('image/*').then((f) => f[0] && pasteImageFile(f[0]));
			case 'home':
				return app.navigate({ name: 'home' });
			case 'newProject':
				newOpen = true;
				return;
			case 'duplicateProject':
				return void (async () => {
					await e.autosave.flush();
					const copy = await app.store!.duplicate(e.doc.meta.id);
					await app.refreshProjects();
					if (copy)
						app.toast(`Created “${copy.name}”.`, 'success', {
							label: 'Open',
							run: () => app.navigate({ name: 'editor', id: copy.id })
						});
				})();
			case 'export':
				exportOpen = true;
				return;
			case 'exportProject':
				return void exportProjectFile(e.doc);
			case 'backup':
				return void e.autosave.flush().then(downloadBackup);
			case 'selectAll':
				return e.selection.selectAll();
			case 'deselect':
				return e.selection.clear();
			case 'invert':
				return e.selection.invert();
			case 'copy':
				return e.copy();
			case 'copyMerged':
				return e.copy(true);
			case 'cut':
				return e.cut();
			case 'paste':
				return e.paste();
			case 'delete':
				return e.deleteSelected();
			case 'newLayer':
				return e.setLayer(e.cmd.addLayer(undefined, e.activeLayerId));
			case 'duplicateLayer':
				return e.setLayer(e.cmd.duplicateNode(e.activeLayerId) ?? e.activeLayerId);
			case 'deleteLayer':
				if (!e.cmd.deleteNode(e.activeLayerId)) e.flashNotice('A document needs at least one layer.');
				return;
			case 'mergeDown':
				if (!e.cmd.mergeDown(e.activeLayerId))
					e.flashNotice('There is no layer directly below to merge into.');
				return;
			case 'groupLayer':
				return void e.cmd.groupNode(e.activeLayerId);
			case 'fit':
				return e.fit();
			case 'actual':
				return e.actualSize();
			case 'zoomIn':
				return e.zoomStep(1);
			case 'zoomOut':
				return e.zoomStep(-1);
			case 'brushSmaller':
			case 'brushBigger': {
				const b =
					e.tool === 'brush'
						? e.settings.brush
						: e.tool === 'eraser'
							? e.settings.eraser
							: e.tool === 'clone'
								? e.settings.clone
								: e.tool === 'pencil'
									? e.settings.pencil
									: null;
				const s = b ?? e.settings.shape;
				s.size = Math.max(1, Math.min(64, s.size + (cmd === 'brushBigger' ? 1 : -1)));
				e.flashNotice(`Size ${s.size}px`);
				return;
			}
			case 'swapColors':
				return e.swapColors();
			case 'resetColors':
				return e.resetColors();
			case 'prevFrame':
				return e.stepFrame(-1);
			case 'nextFrame':
				return e.stepFrame(1);
			case 'play':
				return e.togglePlay();
			case 'escape':
				if (e.playing) return e.stop();
				return e.selection.clear();
			case 'help':
			case 'shortcuts':
				info = 'shortcuts';
				return;
			case 'about':
				info = 'about';
				return;
			case 'flipH':
				return e.transform('flipH');
			case 'flipV':
				return e.transform('flipV');
			case 'canvasSize':
				sizeMode = 'canvas';
				return;
			case 'scaleImage':
				sizeMode = 'image';
				return;
			case 'scaleSelection':
				sizeMode = 'selection';
				return;
			case 'modelClassic':
			case 'modelSlim':
				e.cmd.setMeta({ skin: { model: cmd === 'modelSlim' ? 'slim' : 'classic' } }, 'Skin model');
				e.flashNotice(cmd === 'modelSlim' ? 'Slim model (3px arms)' : 'Classic model (4px arms)');
				return;
		}
	}

	function saveLabel(): { text: string; cls: string } {
		void tick;
		if (!ed) return { text: '', cls: '' };
		const s = ed.save;
		if (app.storageError || s.status === 'memory')
			return { text: 'Not saved — storage unavailable', cls: 'err' };
		if (s.status === 'error') return { text: 'Save failed — retry', cls: 'err' };
		if (s.status === 'pending' || s.status === 'saving') return { text: 'Saving…', cls: 'pending' };
		if (!app.online) return { text: 'Offline — saved locally', cls: 'ok' };
		if (s.lastSaved) return { text: `Saved locally ✓ ${clockTime(s.lastSaved)}`, cls: 'ok' };
		return { text: 'Saved locally ✓', cls: 'ok' };
	}

	function commitName() {
		renaming = false;
		const n = nameValue.trim();
		if (ed && n && n !== ed.doc.meta.name) ed.cmd.setMeta({ name: n.slice(0, 80) }, 'Rename project');
	}

	const docName = $derived.by(() => {
		void ed?.metaVersion;
		return ed?.doc.meta.name ?? '';
	});
	const show2d = $derived(!!ed && (ed.workspace !== '3d' || narrow));
	const show3d = $derived(!!ed && ed.workspace !== '2d');
	const selBounds = $derived.by(() => {
		void ed?.selectionVersion;
		return ed?.selection.bounds ?? null;
	});
	const live = $derived(collab.session && ed?.remote ? collab.session : null);
</script>

<svelte:window onkeydown={onKey} onpaste={onPaste} />

{#if loadError}
	<div class="error-page">
		<Logo size={32} />
		<h1>Project not found</h1>
		<p class="muted">{loadError}</p>
		<button class="btn primary" onclick={() => app.navigate({ name: 'home' })}>Back to my projects</button>
	</div>
{:else if !ed}
	<div class="error-page" aria-busy="true"><span class="muted">Opening project…</span></div>
{:else}
	{@const save = saveLabel()}
	<div
		class="editor"
		class:narrow
		role="application"
		aria-label="Moxel editor"
		ondragover={(e) => e.preventDefault()}
		ondrop={onDrop}
	>
		<header class="top">
			<button
				class="home-btn"
				aria-label="All projects"
				title="All projects"
				onclick={() => app.navigate({ name: 'home' })}><Logo /></button
			>
			{#if !narrow}<MenuBar {ed} {run} />{/if}
			<div class="doc-name">
				{#if renaming}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="input"
						bind:value={nameValue}
						autofocus
						onblur={commitName}
						onkeydown={(e) => {
							if (e.key === 'Enter') commitName();
							if (e.key === 'Escape') renaming = false;
						}}
						aria-label="Project name"
						maxlength="80"
					/>
				{:else}
					<button
						class="name"
						title="Rename project"
						onclick={() => ((renaming = true), (nameValue = docName))}>{docName}</button
					>
				{/if}
				<button
					class="save {save.cls}"
					title={ed.save.error ?? 'Projects are saved automatically in this browser'}
					onclick={() => (ed!.save.status === 'error' ? ed!.autosave.retry() : run('save'))}
				>
					{save.text}
				</button>
			</div>
			<div class="right">
				<button
					class="icon-btn"
					aria-label="Undo"
					title="Undo"
					disabled={!(ed.historyVersion >= 0 && ed.history.canUndo)}
					onclick={() => ed!.undo()}><Icon name="undo" /></button
				>
				<button
					class="icon-btn"
					aria-label="Redo"
					title="Redo"
					disabled={!(ed.historyVersion >= 0 && ed.history.canRedo)}
					onclick={() => ed!.redo()}><Icon name="redo" /></button
				>
				{#if !narrow}
					<div class="seg" role="group" aria-label="Workspace">
						<button
							aria-pressed={ed.workspace === '2d'}
							title="2D canvas"
							onclick={() => (ed!.workspace = '2d')}><Icon name="layout2d" size={15} /> 2D</button
						>
						<button
							aria-pressed={ed.workspace === 'split'}
							title="2D + 3D"
							onclick={() => (ed!.workspace = 'split')}><Icon name="split" size={15} /> Split</button
						>
						<button
							aria-pressed={ed.workspace === '3d'}
							title="3D preview"
							onclick={() => (ed!.workspace = '3d')}><Icon name="cube" size={15} /> 3D</button
						>
					</div>
				{/if}
				<button class="btn live-btn" class:on={!!live} onclick={() => (liveOpen = true)}>
					<Icon name="users" size={16} />
					{#if live}{live.peers.length + 1}{:else}{narrow ? '' : 'Live'}{/if}
				</button>
				<button class="btn primary" onclick={() => (exportOpen = true)}
					><Icon name="download" size={16} />{narrow ? '' : ' Export'}</button
				>
				{#if narrow}
					<button
						class="icon-btn"
						aria-label="Toggle 3D preview"
						aria-pressed={ed.workspace !== '2d'}
						onclick={() => (ed!.workspace = ed!.workspace === '2d' ? 'split' : '2d')}
						><Icon name="cube" /></button
					>
				{/if}
			</div>
		</header>

		{#if !narrow}<ToolOptions {ed} />{/if}

		<div class="body">
			{#if !narrow}<Toolbar {ed} />{/if}
			<main class="center">
				<div class="stage" class:split={show2d && show3d && !narrow}>
					{#if show2d}
						<div class="pane2d"><CanvasView {ed} onhover={(l) => (hoverLabel = l)} /></div>
					{/if}
					{#if show3d}
						<div class="pane3d" class:overlay={narrow}><Preview3DPanel {ed} /></div>
					{/if}
				</div>
				{#if ed.showTimeline || ed.doc.frames.length > 1}<Timeline {ed} />{/if}
				{#if collab.session?.mode === 'side' && live}<FriendsPanel bind:expanded={expandedFriend} />{/if}
			</main>
			{#if !narrow}
				<aside class="side scroll" aria-label="Panels">
					<ColorPanel {ed} />
					<LayersPanel {ed} />
				</aside>
			{/if}
		</div>

		{#if narrow}
			<ToolOptions {ed} />
			<div class="bottom">
				<Toolbar {ed} horizontal />
				<div class="drawer-btns">
					<button
						class="icon-btn"
						aria-label="Colours"
						aria-pressed={drawer === 'color'}
						onclick={() => (drawer = drawer === 'color' ? null : 'color')}><Icon name="palette" /></button
					>
					<button
						class="icon-btn"
						aria-label="Layers"
						aria-pressed={drawer === 'layers'}
						onclick={() => (drawer = drawer === 'layers' ? null : 'layers')}><Icon name="layers" /></button
					>
					<button
						class="icon-btn"
						aria-label="Timeline"
						aria-pressed={ed.showTimeline}
						onclick={() => (ed!.showTimeline = !ed!.showTimeline)}><Icon name="film" /></button
					>
					<button class="icon-btn" aria-label="Menu: more actions" onclick={() => (info = 'shortcuts')}
						><Icon name="info" /></button
					>
				</div>
			</div>
			{#if drawer}
				<div class="drawer scroll" role="dialog" aria-label={drawer === 'color' ? 'Colours' : 'Layers'}>
					<div class="drawer-head">
						<strong>{drawer === 'color' ? 'Colour' : 'Layers'}</strong>
						<button class="icon-btn" aria-label="Close panel" onclick={() => (drawer = null)}
							><Icon name="close" /></button
						>
					</div>
					{#if drawer === 'color'}<ColorPanel {ed} />{:else}<LayersPanel {ed} />{/if}
				</div>
			{/if}
		{:else}
			<footer class="status">
				<span>{ed.doc.width}×{ed.doc.height}</span>
				<span>{Math.round(ed.view.zoom * 100)}%</span>
				{#if ed.doc.meta.kind === 'skin'}<span
						>{ed.doc.meta.skin?.model === 'slim' ? 'Slim' : 'Classic'} skin</span
					>{/if}
				{#if ed.doc.frames.length > 1}<span
						>Frame {ed.doc.frameIndex(ed.activeFrameId) + 1}/{ed.doc.frames.length}</span
					>{/if}
				<span class="hover">{hoverLabel ?? ''}</span>
				<span class="spacer"></span>
				{#if selBounds}<span>Selection {selBounds.w}×{selBounds.h}</span>{/if}
				<span class="privacy" title="Projects are stored in this browser's IndexedDB"
					><Icon name="lock" size={12} /> Local only · nothing uploaded</span
				>
				<button class="link" onclick={() => (info = 'shortcuts')}>Shortcuts</button>
			</footer>
		{/if}
	</div>

	<ExportDialog {ed} bind:open={exportOpen} />
	<SizeDialogs {ed} bind:mode={sizeMode} />
	<InfoDialogs bind:which={info} />
	<NewProjectDialog bind:open={newOpen} oncreate={newProject} />
	<LivePanel {ed} bind:open={liveOpen} />
{/if}

<style>
	.editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		height: 100dvh;
		overflow: hidden;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 44px;
		padding: 0 8px;
		border-bottom: 1px solid var(--line);
		background: var(--bg);
		flex: none;
	}
	.home-btn {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: 6px;
		background: transparent;
	}
	.home-btn:hover {
		background: var(--bg-3);
	}
	.doc-name {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex: 1;
		justify-content: center;
	}
	.name {
		border: 0;
		background: transparent;
		font-weight: 600;
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 4px 6px;
		border-radius: 5px;
	}
	.name:hover {
		background: var(--bg-3);
	}
	.save {
		border: 0;
		background: transparent;
		font-size: 12px;
		color: var(--text-3);
		white-space: nowrap;
		padding: 3px 6px;
		border-radius: 4px;
	}
	.save.ok {
		color: #8fd7a8;
	}
	.save.pending {
		color: var(--text-2);
	}
	.save.err {
		color: var(--err);
		background: #3a1f23;
	}
	.right {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.seg button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.live-btn.on {
		border-color: #2f6b4f;
		color: #9ff0c0;
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
	}
	.center {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.stage {
		flex: 1;
		min-height: 0;
		display: flex;
		position: relative;
	}
	.pane2d,
	.pane3d {
		flex: 1;
		min-width: 0;
		min-height: 0;
		position: relative;
	}
	.stage.split .pane3d {
		flex: 0 0 38%;
		border-left: 1px solid var(--line);
	}
	.pane3d.overlay {
		position: absolute;
		right: 8px;
		top: 8px;
		width: min(46vw, 260px);
		height: min(46vw, 300px);
		border: 1px solid var(--line-2);
		border-radius: 10px;
		overflow: hidden;
		box-shadow: var(--shadow);
		z-index: 5;
	}
	.side {
		width: var(--panel-w);
		flex: none;
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--line);
		background: var(--bg-1);
	}
	.status {
		display: flex;
		align-items: center;
		gap: 14px;
		height: 24px;
		padding: 0 10px;
		border-top: 1px solid var(--line);
		background: var(--bg);
		font-size: 11px;
		color: var(--text-3);
		flex: none;
		white-space: nowrap;
		overflow: hidden;
		font-variant-numeric: tabular-nums;
	}
	.status .hover {
		color: var(--text-2);
	}
	.spacer {
		flex: 1;
	}
	.privacy {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.link {
		border: 0;
		background: none;
		color: var(--text-3);
		font-size: 11px;
		text-decoration: underline;
		padding: 0;
	}
	.bottom {
		display: flex;
		align-items: center;
		background: var(--bg-1);
		border-top: 1px solid var(--line);
		flex: none;
		padding-bottom: env(safe-area-inset-bottom);
	}
	.bottom :global(.toolbar) {
		flex: 1;
		min-width: 0;
		border-top: 0;
	}
	.drawer-btns {
		display: flex;
		gap: 2px;
		padding: 0 6px;
		border-left: 1px solid var(--line);
	}
	.drawer {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(48px + env(safe-area-inset-bottom));
		max-height: 62vh;
		background: var(--bg-1);
		border-top: 1px solid var(--line-2);
		border-radius: 12px 12px 0 0;
		box-shadow: var(--shadow);
		z-index: 30;
		display: flex;
		flex-direction: column;
		animation: up 0.16s ease-out;
	}
	@keyframes up {
		from {
			transform: translateY(16px);
			opacity: 0;
		}
	}
	.drawer-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 8px 0 14px;
	}
	.narrow .top {
		gap: 4px;
	}
	.narrow .name {
		max-width: 34vw;
	}
	.narrow .save {
		display: none;
	}
	.error-page {
		height: 100%;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 12px;
		text-align: center;
		padding: 20px;
	}
	.error-page h1 {
		margin: 0;
		font-size: 20px;
	}
	@media (max-width: 1180px) {
		.right .seg button {
			padding: 0 7px;
		}
	}
</style>
