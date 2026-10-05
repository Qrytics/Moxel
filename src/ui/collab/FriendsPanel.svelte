<script lang="ts">
	import type { Mirror } from '../../state/collab.svelte';
	import { collab } from '../../state/collab.svelte';

	let { expanded = $bindable<string | null>(null) }: { expanded?: string | null } = $props();
	const mirrors = $derived(collab.session?.mirrors ?? []);

	function paint(canvas: HTMLCanvasElement, p: { m: Mirror; v: number }) {
		const draw = (m: Mirror) => {
			const box = canvas.parentElement!.getBoundingClientRect();
			const k = Math.max(
				1,
				Math.floor(Math.min(box.width / Math.max(1, m.w), box.height / Math.max(1, m.h)))
			);
			canvas.width = m.w * k;
			canvas.height = m.h * k;
			const g = canvas.getContext('2d')!;
			g.imageSmoothingEnabled = false;
			g.clearRect(0, 0, canvas.width, canvas.height);
			g.drawImage(m.canvas, 0, 0, canvas.width, canvas.height);
			if (m.cursor) {
				g.fillStyle = m.color;
				g.beginPath();
				g.arc(m.cursor.x * k, m.cursor.y * k, 4, 0, Math.PI * 2);
				g.fill();
			}
		};
		draw(p.m);
		return { update: (np: { m: Mirror; v: number }) => draw(np.m) };
	}
</script>

{#if mirrors.length}
	<section class="friends" aria-label="Friends' canvases">
		{#each mirrors as m (m.id)}
			<figure class="tile" class:big={expanded === m.id}>
				<button
					class="frame checker"
					aria-label="{m.name}'s canvas. Click to {expanded === m.id ? 'shrink' : 'enlarge'}."
					onclick={() => (expanded = expanded === m.id ? null : m.id)}
				>
					<canvas use:paint={{ m, v: m.version }}></canvas>
				</button>
				<figcaption>
					<span class="sw" style:background={m.color}></span>{m.name} <small>{m.w}×{m.h}</small>
				</figcaption>
			</figure>
		{/each}
	</section>
{:else if collab.session?.mode === 'side'}
	<section class="friends empty">
		<p>Waiting for friends to join… Share the invite link from the Live button.</p>
	</section>
{/if}

<style>
	.friends {
		display: flex;
		gap: 8px;
		padding: 8px;
		overflow-x: auto;
		border-top: 1px solid var(--line);
		background: var(--bg-1);
		flex: none;
	}
	.friends.empty p {
		margin: 4px;
		color: var(--text-3);
		font-size: 12px;
	}
	.tile {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: none;
	}
	.frame {
		width: 150px;
		height: 150px;
		display: grid;
		place-items: center;
		padding: 0;
		border-radius: 8px;
		border: 1px solid var(--line-2);
		overflow: hidden;
	}
	.tile.big .frame {
		width: 340px;
		height: 340px;
	}
	canvas {
		max-width: 100%;
		max-height: 100%;
		image-rendering: pixelated;
	}
	figcaption {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}
	figcaption small {
		color: var(--text-3);
	}
	.sw {
		width: 10px;
		height: 10px;
		border-radius: 3px;
	}
</style>
