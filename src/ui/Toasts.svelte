<script lang="ts">
	import { app } from '../state/app.svelte';
	import Icon from './Icon.svelte';
</script>

<div class="toasts" role="status" aria-live="polite">
	{#each app.toasts as t (t.id)}
		<div class="toast {t.kind}">
			<Icon name={t.kind === 'error' ? 'warn' : t.kind === 'success' ? 'check' : 'info'} size={16} />
			<span>{t.message}</span>
			{#if t.action}
				<button
					class="btn sm"
					onclick={() => {
						t.action!.run();
						app.dismiss(t.id);
					}}>{t.action.label}</button
				>
			{/if}
			<button class="icon-btn" aria-label="Dismiss" onclick={() => app.dismiss(t.id)}
				><Icon name="close" size={14} /></button
			>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 100;
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: center;
		pointer-events: none;
		width: min(560px, calc(100vw - 24px));
	}
	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 8px 8px 12px;
		border-radius: 8px;
		background: var(--bg-3);
		border: 1px solid var(--line-2);
		box-shadow: var(--shadow);
		animation: in 0.16s ease-out;
	}
	.toast span {
		flex: 1;
	}
	.toast.error {
		border-color: #6b3036;
		color: #ffd0d0;
	}
	.toast.error :global(svg) {
		color: var(--err);
	}
	.toast.success :global(svg) {
		color: var(--ok);
	}
	@keyframes in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
	}
</style>
