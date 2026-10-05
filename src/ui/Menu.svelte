<script lang="ts" module>
	export interface MenuItem {
		label: string;
		action?: () => void;
		shortcut?: string;
		disabled?: boolean;
		checked?: boolean;
		danger?: boolean;
		separator?: boolean;
		/** Sub-heading inside the menu. */
		heading?: boolean;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		items,
		label,
		trigger,
		align = 'left',
		triggerClass = 'menu-trigger'
	}: {
		items: MenuItem[] | (() => MenuItem[]);
		label: string;
		trigger: Snippet;
		align?: 'left' | 'right';
		triggerClass?: string;
	} = $props();

	let open = $state(false);
	let root: HTMLDivElement | undefined = $state();
	let list: HTMLDivElement | undefined = $state();
	let resolved = $derived(open ? (typeof items === 'function' ? items() : items) : []);

	function focusItem(dir: 1 | -1 | 0) {
		const els = [...(list?.querySelectorAll<HTMLButtonElement>('[role^=menuitem]:not(:disabled)') ?? [])];
		if (!els.length) return;
		const i = els.indexOf(document.activeElement as HTMLButtonElement);
		const next = dir === 0 ? 0 : (i + dir + els.length) % els.length;
		els[next].focus();
	}

	function toggle() {
		open = !open;
		if (open) queueMicrotask(() => focusItem(0));
	}

	function run(item: MenuItem) {
		if (item.disabled) return;
		open = false;
		(root?.querySelector('button') as HTMLButtonElement | null)?.focus();
		item.action?.();
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			open = false;
			(root?.querySelector('button') as HTMLButtonElement | null)?.focus();
			e.stopPropagation();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			focusItem(1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			focusItem(-1);
		}
	}

	$effect(() => {
		if (!open) return;
		const away = (e: PointerEvent) => {
			if (root && !root.contains(e.target as Node)) open = false;
		};
		window.addEventListener('pointerdown', away, true);
		return () => window.removeEventListener('pointerdown', away, true);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="menu" bind:this={root} {onkeydown}>
	<button class={triggerClass} aria-haspopup="menu" aria-expanded={open} aria-label={label} onclick={toggle}>
		{@render trigger()}
	</button>
	{#if open}
		<div class="list" class:right={align === 'right'} role="menu" aria-label={label} bind:this={list}>
			{#each resolved as item, i (i)}
				{#if item.separator}
					<div class="sep" role="separator"></div>
				{:else if item.heading}
					<div class="heading">{item.label}</div>
				{:else}
					<button
						role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
						aria-checked={item.checked === undefined ? undefined : item.checked}
						class="item"
						class:danger={item.danger}
						disabled={item.disabled}
						onclick={() => run(item)}
					>
						<span class="tick">{item.checked ? '✓' : ''}</span>
						<span class="label">{item.label}</span>
						{#if item.shortcut}<span class="kbd">{item.shortcut}</span>{/if}
					</button>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.menu {
		position: relative;
		display: inline-flex;
	}
	.list {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 50;
		min-width: 230px;
		padding: 5px;
		background: var(--bg-2);
		border: 1px solid var(--line-2);
		border-radius: 8px;
		box-shadow: var(--shadow);
		animation: drop 0.1s ease-out;
		max-height: 75vh;
		overflow: auto;
	}
	.list.right {
		left: auto;
		right: 0;
	}
	@keyframes drop {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
	}
	.item {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 28px;
		padding: 0 10px 0 4px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		text-align: left;
	}
	.item:hover:not(:disabled),
	.item:focus-visible {
		background: var(--accent-2);
		color: #fff;
		box-shadow: none;
	}
	.item:hover .kbd,
	.item:focus-visible .kbd {
		color: #dfeeff;
	}
	.item:disabled {
		color: var(--text-3);
		cursor: default;
	}
	.item.danger {
		color: var(--err);
	}
	.item.danger:hover {
		color: #fff;
		background: #b8434a;
	}
	.tick {
		width: 16px;
		text-align: center;
		color: var(--accent);
	}
	.item:hover .tick {
		color: #fff;
	}
	.label {
		flex: 1;
	}
	.sep {
		height: 1px;
		margin: 5px 6px;
		background: var(--line-2);
	}
	.heading {
		padding: 6px 10px 2px 26px;
		font-size: 11px;
		color: var(--text-3);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	:global(.menu-trigger) {
		height: 28px;
		padding: 0 9px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--text-2);
		font-weight: 500;
	}
	:global(.menu-trigger:hover),
	:global(.menu-trigger[aria-expanded='true']) {
		background: var(--bg-3);
		color: var(--text);
	}
</style>
