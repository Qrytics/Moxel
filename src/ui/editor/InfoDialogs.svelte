<script lang="ts">
	import Dialog from '../Dialog.svelte';
	import Icon from '../Icon.svelte';
	import Logo from '../Logo.svelte';
	import { SHORTCUT_GROUPS } from '../../state/shortcuts';
	import { app } from '../../state/app.svelte';

	let { which = $bindable(null) }: { which?: 'shortcuts' | 'about' | null } = $props();
</script>

<Dialog title="Keyboard shortcuts" open={which === 'shortcuts'} onclose={() => (which = null)} width={720}>
	<div class="groups">
		{#each SHORTCUT_GROUPS as g (g.title)}
			<section>
				<h3>{g.title}</h3>
				<dl>
					{#each g.items as [k, label] (k + label)}
						<dt><kbd>{k}</kbd></dt>
						<dd>{label}</dd>
					{/each}
				</dl>
			</section>
		{/each}
	</div>
</Dialog>

<Dialog title="About Moxel" open={which === 'about'} onclose={() => (which = null)} width={480}>
	<div class="about">
		<p class="brand"><Logo size={28} /> <strong>Moxel</strong></p>
		<p>A browser-based pixel art, animation and Minecraft skin &amp; texture editor.</p>
		<h3><Icon name="lock" size={14} /> Your work stays on your device</h3>
		<ul>
			<li>
				Projects are saved automatically in this browser's local storage (IndexedDB). Nothing is uploaded to
				our servers.
			</li>
			<li>No account is needed. Moxel works offline once it has loaded.</li>
			<li>
				Browser storage belongs to this device and browser. Use <em>Export project</em> or
				<em>Download backup</em> to keep a copy or move to another device.
			</li>
			<li>
				Live sessions connect browsers directly to each other (WebRTC). The server only introduces peers and
				never sees your artwork.
			</li>
		</ul>
		{#if app.storageError}<p class="warn">{app.storageError}</p>{/if}
		<p class="muted small">
			Not affiliated with Mojang or Microsoft. Minecraft is a trademark of Mojang Synergies AB.
		</p>
	</div>
</Dialog>

<style>
	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 8px 28px;
	}
	h3 {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-3);
		margin: 10px 0 6px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 4px 14px;
		margin: 0;
	}
	dt {
		text-align: right;
	}
	dd {
		margin: 0;
		color: var(--text-2);
	}
	kbd {
		font-family: var(--mono);
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--bg-3);
		border: 1px solid var(--line-2);
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 16px;
	}
	.about ul {
		padding-left: 18px;
		color: var(--text-2);
		display: grid;
		gap: 6px;
	}
	.small {
		font-size: 11px;
	}
	.warn {
		color: var(--warn);
	}
</style>
