<script lang="ts">
	import type { EditorState } from '../../state/editor.svelte';
	import Icon from '../Icon.svelte';

	let { ed }: { ed: EditorState } = $props();

	const frames = $derived.by(() => {
		void ed.structureVersion;
		return [...ed.doc.frames];
	});
	const anim = $derived.by(() => {
		void ed.metaVersion;
		return ed.doc.meta.animation;
	});
	const index = $derived(frames.findIndex((f) => f.id === ed.activeFrameId));
	const current = $derived(frames[index]);
	let dragId = $state<string | null>(null);

	function setAnim(p: Partial<typeof anim>) {
		ed.cmd.setMeta({ animation: { ...ed.doc.meta.animation, ...p } }, 'Animation settings', 'anim');
	}

	function thumb(canvas: HTMLCanvasElement, p: { id: string; v: string }) {
		let id = p.id;
		const draw = () => {
			const src = ed.cache.frameCanvas(id);
			const g = canvas.getContext('2d')!;
			const k = Math.min(canvas.width / src.width, canvas.height / src.height);
			g.clearRect(0, 0, canvas.width, canvas.height);
			g.imageSmoothingEnabled = k < 1;
			g.drawImage(
				src,
				(canvas.width - src.width * k) / 2,
				(canvas.height - src.height * k) / 2,
				src.width * k,
				src.height * k
			);
		};
		draw();
		return {
			update(np: { id: string; v: string }) {
				id = np.id;
				draw();
			}
		};
	}

	function dropOn(targetId: string) {
		if (!dragId || dragId === targetId) return;
		ed.cmd.moveFrame(dragId, ed.doc.frameIndex(targetId));
		dragId = null;
	}
</script>

<section class="timeline" aria-label="Timeline">
	<div class="controls">
		<button
			class="icon-btn"
			aria-label="Previous frame (,)"
			title="Previous frame (,)"
			onclick={() => ed.stepFrame(-1)}><Icon name="prev" size={16} /></button
		>
		<button
			class="icon-btn play"
			aria-label={ed.playing ? 'Pause (Enter)' : 'Play (Enter)'}
			title={ed.playing ? 'Pause (Enter)' : 'Play (Enter)'}
			disabled={frames.length < 2}
			onclick={() => ed.togglePlay()}><Icon name={ed.playing ? 'pause' : 'play'} size={16} /></button
		>
		<button
			class="icon-btn"
			aria-label="Next frame (.)"
			title="Next frame (.)"
			onclick={() => ed.stepFrame(1)}><Icon name="next" size={16} /></button
		>
		<span class="pos">{index + 1} / {frames.length}</span>
		<span class="div"></span>
		<label class="o" title="Frames per second (sets every frame's duration)">
			FPS
			<input
				class="input num"
				type="number"
				min="1"
				max="60"
				value={anim.fps}
				onchange={(e) => ed.cmd.setFps(+e.currentTarget.value)}
			/>
		</label>
		{#if current}
			<label class="o" title="This frame's duration">
				Frame
				<input
					class="input num"
					type="number"
					min="10"
					max="10000"
					step="10"
					value={current.duration}
					onchange={(e) => ed.cmd.setFrameDuration(current.id, +e.currentTarget.value)}
				/>
				ms
			</label>
		{/if}
		<label class="check"
			><input
				type="checkbox"
				checked={anim.loop}
				onchange={(e) => setAnim({ loop: e.currentTarget.checked })}
			/> Loop</label
		>
		<span class="div"></span>
		<label class="check" title="Show neighbouring frames faintly while drawing">
			<input
				type="checkbox"
				checked={anim.onionSkin}
				onchange={(e) => setAnim({ onionSkin: e.currentTarget.checked })}
			/>
			<Icon name="onion" size={15} /> Onion skin
		</label>
		{#if anim.onionSkin}
			<label class="o">
				Before <input
					class="input num tiny"
					type="number"
					min="0"
					max="5"
					value={anim.onionBefore}
					onchange={(e) => setAnim({ onionBefore: +e.currentTarget.value })}
				/>
			</label>
			<label class="o">
				After <input
					class="input num tiny"
					type="number"
					min="0"
					max="5"
					value={anim.onionAfter}
					onchange={(e) => setAnim({ onionAfter: +e.currentTarget.value })}
				/>
			</label>
			<label class="o">
				<span class="sr-only">Onion skin opacity</span>
				<input
					type="range"
					min="0.05"
					max="0.8"
					step="0.05"
					value={anim.onionOpacity}
					oninput={(e) => setAnim({ onionOpacity: +e.currentTarget.value })}
				/>
			</label>
		{/if}
		<span class="spacer"></span>
		<button
			class="btn sm"
			onclick={() => ed.setFrame(ed.cmd.addFrame(ed.activeFrameId, false))}
			title="Insert an empty frame after this one"
		>
			<Icon name="plus" size={14} /> Frame
		</button>
		<button
			class="btn sm"
			onclick={() => ed.setFrame(ed.cmd.addFrame(ed.activeFrameId, true))}
			title="Duplicate this frame"
		>
			<Icon name="copy" size={14} /> Duplicate
		</button>
		<button
			class="icon-btn"
			aria-label="Delete frame"
			title="Delete frame"
			disabled={frames.length < 2}
			onclick={() => current && ed.cmd.deleteFrame(current.id)}><Icon name="trash" size={16} /></button
		>
	</div>
	<ol class="frames scroll" aria-label="Frames">
		{#each frames as f, i (f.id)}
			<li>
				<button
					class="frame checker"
					class:active={f.id === ed.activeFrameId}
					class:drag={dragId === f.id}
					draggable="true"
					aria-label="Frame {i + 1}, {f.duration} ms"
					aria-current={f.id === ed.activeFrameId}
					onclick={() => ed.setFrame(f.id)}
					ondragstart={() => (dragId = f.id)}
					ondragover={(e) => e.preventDefault()}
					ondrop={() => dropOn(f.id)}
					ondragend={() => (dragId = null)}
				>
					<canvas
						width="56"
						height="56"
						use:thumb={{ id: f.id, v: `${ed.pixelsVersion}:${ed.structureVersion}` }}
					></canvas>
					<span class="n">{i + 1}</span>
				</button>
			</li>
		{/each}
	</ol>
</section>

<style>
	.timeline {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line);
		background: var(--bg-1);
		flex: none;
	}
	.controls {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 38px;
		padding: 0 8px;
		overflow-x: auto;
		scrollbar-width: none;
		white-space: nowrap;
	}
	.play {
		color: var(--accent);
	}
	.pos {
		font-variant-numeric: tabular-nums;
		color: var(--text-2);
		min-width: 44px;
	}
	.div {
		width: 1px;
		height: 18px;
		background: var(--line-2);
	}
	.o {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--text-2);
	}
	.tiny {
		width: 44px;
	}
	.spacer {
		flex: 1;
	}
	.frames {
		display: flex;
		gap: 6px;
		list-style: none;
		margin: 0;
		padding: 4px 10px 10px;
		overflow-x: auto;
	}
	.frame {
		position: relative;
		width: 60px;
		height: 60px;
		padding: 0;
		border-radius: 6px;
		border: 2px solid var(--line-2);
		overflow: hidden;
	}
	.frame canvas {
		display: block;
		width: 56px;
		height: 56px;
		image-rendering: pixelated;
	}
	.frame.active {
		border-color: var(--accent);
	}
	.frame.drag {
		opacity: 0.4;
	}
	.n {
		position: absolute;
		left: 3px;
		bottom: 2px;
		font-size: 10px;
		padding: 0 3px;
		border-radius: 3px;
		background: rgba(0, 0, 0, 0.6);
	}
</style>
