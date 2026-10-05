<script lang="ts">
	import { focusOnMount } from '../actions';
	import type { EditorState } from '../../state/editor.svelte';
	import { BLEND_MODES, type BlendMode, type DocNode } from '../../core/document/types';
	import { compositeRect } from '../../core/render/composite';
	import Icon from '../Icon.svelte';
	import Menu from '../Menu.svelte';

	let { ed }: { ed: EditorState } = $props();

	const rows = $derived.by(() => {
		void ed.structureVersion;
		return ed.doc.displayRows();
	});
	const active = $derived.by(() => {
		void ed.structureVersion;
		return ed.doc.getNode(ed.activeLayerId) ?? null;
	});
	const canMerge = $derived.by(() => {
		void ed.structureVersion;
		return active?.type === 'layer' && !!ed.cmd.layerBelow(active.id) && active.visible;
	});

	let editing = $state<string | null>(null);
	let editValue = $state('');
	let dragId = $state<string | null>(null);
	let dropTarget = $state<{ id: string; pos: 'above' | 'below' | 'into' } | null>(null);

	function startRename(n: DocNode) {
		editing = n.id;
		editValue = n.name;
	}
	function commitRename() {
		if (editing) ed.cmd.rename(editing, editValue);
		editing = null;
	}

	/** Draw a layer (or a group's composite) into its thumbnail. */
	function thumb(canvas: HTMLCanvasElement, param: { id: string; v: string }) {
		let id = param.id;
		const draw = () => {
			const n = ed.doc.getNode(id);
			if (!n) return;
			const { width: w, height: h } = ed.doc;
			const k = Math.min(canvas.width / w, canvas.height / h);
			const g = canvas.getContext('2d')!;
			g.clearRect(0, 0, canvas.width, canvas.height);
			let data: Uint8ClampedArray | undefined;
			if (n.type === 'layer') data = ed.doc.getCel(id, ed.activeFrameId);
			else
				data = compositeRect(
					ed.doc,
					ed.activeFrameId,
					{ x: 0, y: 0, w, h },
					{
						include: (lid) => ed.doc.isAncestor(id, lid),
						ignoreVisibility: false
					}
				);
			if (!data) return;
			const tmp = document.createElement('canvas');
			tmp.width = w;
			tmp.height = h;
			tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
			g.imageSmoothingEnabled = k < 1;
			g.drawImage(tmp, (canvas.width - w * k) / 2, (canvas.height - h * k) / 2, w * k, h * k);
		};
		draw();
		return {
			update(p: { id: string; v: string }) {
				id = p.id;
				draw();
			}
		};
	}

	function dragStart(e: DragEvent, id: string) {
		dragId = id;
		e.dataTransfer!.effectAllowed = 'move';
		e.dataTransfer!.setData('text/plain', id);
	}

	function dragOver(e: DragEvent, n: DocNode) {
		if (!dragId || dragId === n.id) return;
		e.preventDefault();
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const y = (e.clientY - r.top) / r.height;
		const pos = n.type === 'group' && y > 0.3 && y < 0.7 ? 'into' : y < 0.5 ? 'above' : 'below';
		dropTarget = { id: n.id, pos };
	}

	function drop(e: DragEvent) {
		e.preventDefault();
		if (!dragId || !dropTarget) return reset();
		const target = ed.doc.getNode(dropTarget.id);
		if (!target || dragId === target.id || ed.doc.isAncestor(dragId, target.id)) return reset();
		if (dropTarget.pos === 'into' && target.type === 'group') {
			ed.cmd.moveNode(dragId, target.id, target.children.length);
		} else {
			const parentId = ed.doc.parentOf(target.id);
			if (parentId === undefined) return reset();
			const sib = ed.doc.childrenOf(parentId).filter((x) => x !== dragId);
			const ti = sib.indexOf(target.id);
			// Rows are listed top-first but children are stored bottom-first.
			ed.cmd.moveNode(dragId, parentId, dropTarget.pos === 'above' ? ti + 1 : ti);
		}
		reset();
	}

	function reset() {
		dragId = null;
		dropTarget = null;
	}

	function rowKey(e: KeyboardEvent, i: number) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			const j = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
			ed.setLayer(rows[j].node.id);
			(document.querySelector(`[data-row="${rows[j].node.id}"]`) as HTMLElement | null)?.focus();
		} else if (e.key === 'F2') startRename(rows[i].node);
	}

	function setOpacity(v: number) {
		if (active) ed.cmd.setNodeProps(active.id, { opacity: v / 100 }, 'Layer opacity', `opacity:${active.id}`);
	}

	function moreItems() {
		const a = active;
		if (!a) return [];
		const claimed = !!a.owner;
		return [
			{ label: 'Rename…', action: () => startRename(a), shortcut: 'F2' },
			{ label: 'Duplicate', action: () => ed.setLayer(ed.cmd.duplicateNode(a.id) ?? a.id) },
			{
				label: a.type === 'group' ? 'Ungroup' : 'Put in a group',
				action: () => (a.type === 'group' ? ed.cmd.ungroup(a.id) : ed.cmd.groupNode(a.id))
			},
			{ label: 'Merge down', action: () => ed.cmd.mergeDown(a.id), disabled: !canMerge },
			{ label: 'Flatten image', action: () => ed.setLayer(ed.cmd.flatten()) },
			{ separator: true, label: '' },
			{
				label: 'Select layer pixels',
				action: () => ed.selectLayerPixels(a.id),
				disabled: a.type !== 'layer'
			},
			{
				label: 'Clear layer',
				action: () => ed.cmd.clearLayer(a.id, ed.activeFrameId),
				disabled: a.type !== 'layer'
			},
			...(ed.remote && ed.peerId
				? [
						{ separator: true, label: '' },
						{
							label: claimed
								? a.owner === ed.peerId
									? 'Release my claim'
									: 'Claimed by a collaborator'
								: 'Claim layer (others can’t draw on it)',
							disabled: claimed && a.owner !== ed.peerId,
							action: () =>
								ed.cmd.setNodeProps(
									a.id,
									{ owner: claimed ? undefined : ed.peerId },
									claimed ? 'Release layer' : 'Claim layer'
								)
						}
					]
				: [])
		];
	}
</script>

<section class="layers" aria-label="Layers">
	<div class="panel-title">
		Layers
		<span class="count">{rows.filter((r) => r.node.type === 'layer').length}</span>
	</div>

	{#if active}
		<div class="props">
			<label class="o" title="Blend mode">
				<span class="sr-only">Blend mode</span>
				<select
					class="input"
					value={active.blend}
					onchange={(e) =>
						ed.cmd.setNodeProps(active.id, { blend: e.currentTarget.value as BlendMode }, 'Blend mode')}
				>
					{#each BLEND_MODES as m (m)}<option value={m}>{m[0].toUpperCase() + m.slice(1)}</option>{/each}
				</select>
			</label>
			<label class="o op">
				<span>Opacity</span>
				<input
					type="range"
					min="0"
					max="100"
					value={Math.round(active.opacity * 100)}
					oninput={(e) => setOpacity(+e.currentTarget.value)}
					aria-label="Layer opacity"
				/>
				<span class="v">{Math.round(active.opacity * 100)}%</span>
			</label>
		</div>
	{/if}

	<ul class="list scroll" role="listbox" aria-label="Layer list">
		{#each rows as row, i (row.node.id)}
			{@const n = row.node}
			{@const dt = dropTarget?.id === n.id ? dropTarget.pos : null}
			<li
				id="row-{n.id}"
				class="row"
				class:active={n.id === ed.activeLayerId}
				class:hidden={!n.visible}
				class:drop-above={dt === 'above'}
				class:drop-below={dt === 'below'}
				class:drop-into={dt === 'into'}
				class:dragging={dragId === n.id}
				style:--depth={row.depth}
				role="option"
				aria-selected={n.id === ed.activeLayerId}
				draggable={editing !== n.id}
				ondragstart={(e) => dragStart(e, n.id)}
				ondragover={(e) => dragOver(e, n)}
				ondragleave={() => dropTarget?.id === n.id && (dropTarget = null)}
				ondrop={drop}
				ondragend={reset}
			>
				<button
					class="vis icon-btn"
					aria-label={n.visible ? `Hide ${n.name}` : `Show ${n.name}`}
					title={n.visible ? 'Hide' : 'Show'}
					onclick={() =>
						ed.cmd.setNodeProps(n.id, { visible: !n.visible }, n.visible ? 'Hide layer' : 'Show layer')}
				>
					<Icon name={n.visible ? 'eye' : 'eye-off'} size={15} />
				</button>
				{#if n.type === 'group'}
					<button
						class="twist icon-btn"
						aria-label={n.collapsed ? 'Expand group' : 'Collapse group'}
						aria-expanded={!n.collapsed}
						onclick={() => ed.cmd.setNodeProps(n.id, { collapsed: !n.collapsed }, 'Toggle group')}
					>
						<Icon name={n.collapsed ? 'chevron' : 'chevron-down'} size={14} />
					</button>
				{/if}
				<button
					class="main"
					data-row={n.id}
					onclick={(e) => {
						if (e.metaKey || e.ctrlKey) ed.selectLayerPixels(n.id);
						ed.setLayer(n.id);
					}}
					ondblclick={() => startRename(n)}
					onkeydown={(e) => rowKey(e, i)}
					title="Double-click to rename. {n.type === 'layer'
						? 'Ctrl/⌘-click to select its pixels. '
						: ''}Drag to reorder."
				>
					<canvas
						class="thumb checker"
						width="32"
						height="32"
						use:thumb={{ id: n.id, v: `${ed.pixelsVersion}:${ed.structureVersion}:${ed.activeFrameId}` }}
					></canvas>
					{#if editing === n.id}
						<input
							class="input rename"
							bind:value={editValue}
							use:focusOnMount
							onblur={commitRename}
							onclick={(e) => e.stopPropagation()}
							onkeydown={(e) => {
								e.stopPropagation();
								if (e.key === 'Enter') commitRename();
								if (e.key === 'Escape') editing = null;
							}}
							aria-label="Layer name"
						/>
					{:else}
						<span class="name">
							{#if n.type === 'group'}<Icon name="folder" size={13} />{/if}
							{n.name}
						</span>
					{/if}
					{#if n.opacity < 1}<span class="badge">{Math.round(n.opacity * 100)}%</span>{/if}
					{#if n.owner}<span class="badge claim" title="Claimed in the live session"
							>{n.owner === ed.peerId ? 'You' : 'Claimed'}</span
						>{/if}
				</button>
				<button
					class="lock icon-btn"
					class:on={n.locked}
					aria-label={n.locked ? `Unlock ${n.name}` : `Lock ${n.name}`}
					title={n.locked ? 'Unlock' : 'Lock'}
					onclick={() =>
						ed.cmd.setNodeProps(n.id, { locked: !n.locked }, n.locked ? 'Unlock layer' : 'Lock layer')}
				>
					<Icon name={n.locked ? 'lock' : 'unlock'} size={14} />
				</button>
			</li>
		{/each}
	</ul>

	<div class="actions">
		<button
			class="icon-btn"
			aria-label="New layer"
			title="New layer (⇧⌘N)"
			onclick={() => ed.setLayer(ed.cmd.addLayer(undefined, ed.activeLayerId))}
		>
			<Icon name="plus" size={16} />
		</button>
		<button
			class="icon-btn"
			aria-label="New group"
			title="New group"
			onclick={() => ed.setLayer(ed.cmd.addGroup(undefined, ed.activeLayerId))}
		>
			<Icon name="group" size={16} />
		</button>
		<button
			class="icon-btn"
			aria-label="Duplicate layer"
			title="Duplicate (⌘J)"
			disabled={!active}
			onclick={() => active && ed.setLayer(ed.cmd.duplicateNode(active.id) ?? active.id)}
		>
			<Icon name="copy" size={16} />
		</button>
		<button
			class="icon-btn"
			aria-label="Move layer up"
			title="Move up"
			disabled={!active}
			onclick={() => active && ed.cmd.nudge(active.id, 1)}
		>
			<Icon name="up" size={16} />
		</button>
		<button
			class="icon-btn"
			aria-label="Move layer down"
			title="Move down"
			disabled={!active}
			onclick={() => active && ed.cmd.nudge(active.id, -1)}
		>
			<Icon name="down" size={16} />
		</button>
		<button
			class="icon-btn"
			aria-label="Merge down"
			title="Merge down (⌘E)"
			disabled={!canMerge}
			onclick={() => active && ed.cmd.mergeDown(active.id)}
		>
			<Icon name="merge" size={16} />
		</button>
		<span class="spacer"></span>
		<Menu label="More layer actions" align="right" triggerClass="icon-btn" items={moreItems}>
			{#snippet trigger()}<Icon name="more" size={16} />{/snippet}
		</Menu>
		<button
			class="icon-btn"
			aria-label="Delete layer"
			title="Delete layer"
			disabled={!active}
			onclick={() => {
				if (active && !ed.cmd.deleteNode(active.id)) ed.flashNotice('A document needs at least one layer.');
			}}
		>
			<Icon name="trash" size={16} />
		</button>
	</div>
</section>

<style>
	.layers {
		display: flex;
		flex-direction: column;
		min-height: 0;
		flex: 1;
	}
	.count {
		color: var(--text-3);
		font-weight: 500;
	}
	.props {
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 8px 10px;
		border-bottom: 1px solid var(--line);
	}
	.props select {
		width: 92px;
		flex: none;
	}
	.o {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-2);
		font-size: 12px;
	}
	.op {
		flex: 1;
		min-width: 0;
	}
	.op input {
		flex: 1;
		min-width: 0;
		width: 100%;
	}
	.v {
		width: 34px;
		text-align: right;
		font-variant-numeric: tabular-nums;
		color: var(--text);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 4px;
		flex: 1;
		min-height: 80px;
	}
	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 2px;
		padding-left: calc(var(--depth) * 14px);
		border-radius: 6px;
		margin-bottom: 1px;
	}
	.row:hover {
		background: var(--bg-2);
	}
	.row.active {
		background: #1e3047;
	}
	.row.hidden .main {
		opacity: 0.5;
	}
	.row.dragging {
		opacity: 0.4;
	}
	.row.drop-above::before,
	.row.drop-below::after {
		content: '';
		position: absolute;
		left: 6px;
		right: 6px;
		height: 2px;
		background: var(--accent);
		border-radius: 1px;
	}
	.row.drop-above::before {
		top: -1px;
	}
	.row.drop-below::after {
		bottom: -1px;
	}
	.row.drop-into {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.vis,
	.lock,
	.twist {
		width: 24px;
		height: 24px;
		flex: none;
	}
	.lock {
		opacity: 0;
	}
	.row:hover .lock,
	.lock.on,
	.lock:focus-visible {
		opacity: 1;
	}
	.lock.on {
		color: var(--warn);
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 40px;
		padding: 0 4px;
		border: 0;
		background: transparent;
		text-align: left;
		border-radius: 5px;
	}
	.thumb {
		width: 32px;
		height: 32px;
		border-radius: 3px;
		flex: none;
		border: 1px solid var(--line-2);
		image-rendering: pixelated;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.name :global(svg) {
		color: var(--text-3);
		flex: none;
	}
	.rename {
		flex: 1;
		min-width: 0;
		height: 24px;
	}
	.badge {
		font-size: 10px;
		color: var(--text-3);
		padding: 1px 4px;
		border-radius: 3px;
		background: var(--bg-3);
	}
	.badge.claim {
		color: #9ff0c0;
		background: #1f3b31;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px 6px;
		border-top: 1px solid var(--line);
	}
	.spacer {
		flex: 1;
	}
</style>
