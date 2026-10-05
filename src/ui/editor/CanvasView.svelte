<script lang="ts">
	import { onMount } from 'svelte';
	import { CanvasRenderer } from '../../core/render/canvasRenderer';
	import { TOOLS } from '../../core/tools/registry';
	import type { PointerInfo, ToolId } from '../../core/tools/types';
	import type { EditorState } from '../../state/editor.svelte';
	import { hitTest, FACE_LABELS } from '../../minecraft/uv';

	let { ed, onhover }: { ed: EditorState; onhover?: (label: string | null) => void } = $props();

	let host: HTMLDivElement | undefined = $state();
	let canvas: HTMLCanvasElement | undefined = $state();
	let renderer: CanvasRenderer | null = null;
	let raf = 0;
	let spaceHeld = $state(false);
	let activePointer: number | null = null;
	let activeTool: ToolId | null = null;
	let panning: { x: number; y: number } | null = null;
	const touches = new Map<number, { x: number; y: number }>();
	let pinch: { dist: number; cx: number; cy: number } | null = null;

	function requestDraw() {
		if (raf) return;
		raf = requestAnimationFrame(draw);
	}

	function onionFrames() {
		const a = ed.doc.meta.animation;
		if (!a.onionSkin || ed.doc.frames.length < 2 || ed.playing) return null;
		const i = ed.doc.frameIndex(ed.activeFrameId);
		const pick = (dir: number, n: number) => {
			const out: HTMLCanvasElement[] = [];
			for (let k = 1; k <= n; k++) {
				const j = i + dir * k;
				if (j < 0 || j >= ed.doc.frames.length) break;
				out.push(ed.cache.frameCanvas(ed.doc.frames[j].id));
			}
			return out;
		};
		return { before: pick(-1, a.onionBefore), after: pick(1, a.onionAfter), opacity: a.onionOpacity };
	}

	function brushCursor() {
		if (!ed.hover || spaceHeld) return null;
		const t = ed.tool;
		const s = ed.settings;
		const b =
			t === 'brush'
				? s.brush
				: t === 'pencil'
					? s.pencil
					: t === 'eraser'
						? s.eraser
						: t === 'clone'
							? s.clone
							: null;
		if (!b) return null;
		return { x: ed.hover.x, y: ed.hover.y, size: b.size, square: b.shape === 'square' };
	}

	function draw() {
		raf = 0;
		if (!renderer) return;
		ed.cache.flush();
		renderer.draw(ed.doc, ed.cache, ed.view, ed.selection, ed.overlay, {
			...ed.display,
			guides: ed.display.guides && ed.doc.meta.kind === 'skin',
			onion: onionFrames(),
			brushCursor: brushCursor(),
			hoverPixel:
				ed.hover && ['pencil', 'eraser', 'fill', 'eyedropper', 'wand'].includes(ed.tool)
					? { x: Math.floor(ed.hover.x), y: Math.floor(ed.hover.y) }
					: null,
			peers: ed.peers
		});
	}

	// Redraw on anything visual. Reading the counters subscribes this effect to them.
	$effect(() => {
		void ed.view;
		void ed.overlayVersion;
		void ed.selectionVersion;
		void ed.structureVersion;
		void ed.metaVersion;
		void ed.hover;
		void ed.tool;
		void ed.peers;
		void JSON.stringify(ed.display);
		void ed.activeFrameId;
		requestDraw();
	});

	$effect(() => {
		const unsub = ed.cache.subscribe(() => requestDraw());
		return unsub;
	});

	onMount(() => {
		renderer = new CanvasRenderer(canvas!);
		const ro = new ResizeObserver(() => {
			const r = host!.getBoundingClientRect();
			renderer!.resize(r.width, r.height);
			ed.setViewport(r.width, r.height);
			requestDraw();
		});
		ro.observe(host!);
		// Marching ants: animate only while there is a selection.
		const ants = setInterval(() => {
			if (ed.selection.active && renderer) {
				renderer.antsPhase = (renderer.antsPhase + 1) % 8;
				requestDraw();
			}
		}, 120);
		const keydown = (e: KeyboardEvent) => {
			// Only hijack Space when it isn't activating a focused control.
			const t = e.target as HTMLElement | null;
			const onControl =
				!!t &&
				t !== document.body &&
				t !== canvas &&
				!!t.closest('button, a, [role=button], [role=menuitem], [role=radio], [role=tab], select, summary');
			if (e.code === 'Space' && !isTyping(e) && !onControl) {
				if (!spaceHeld) spaceHeld = true;
				e.preventDefault();
			}
		};
		const keyup = (e: KeyboardEvent) => {
			if (e.code === 'Space') spaceHeld = false;
		};
		window.addEventListener('keydown', keydown);
		window.addEventListener('keyup', keyup);
		return () => {
			ro.disconnect();
			clearInterval(ants);
			cancelAnimationFrame(raf);
			window.removeEventListener('keydown', keydown);
			window.removeEventListener('keyup', keyup);
		};
	});

	function isTyping(e: Event) {
		const t = e.target as HTMLElement | null;
		return (
			!!t &&
			(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
		);
	}

	function info(e: PointerEvent): PointerInfo {
		const r = canvas!.getBoundingClientRect();
		const sx = e.clientX - r.left,
			sy = e.clientY - r.top;
		return {
			x: (sx - ed.view.ox) / ed.view.zoom,
			y: (sy - ed.view.oy) / ed.view.zoom,
			sx,
			sy,
			pressure: e.pressure,
			pointerType: e.pointerType,
			button: e.button,
			shift: e.shiftKey,
			alt: e.altKey,
			mod: e.ctrlKey || e.metaKey
		};
	}

	function updateHover(p: PointerInfo) {
		const inside = p.x >= 0 && p.y >= 0 && p.x < ed.doc.width && p.y < ed.doc.height;
		ed.hover = inside ? { x: p.x, y: p.y } : null;
		if (inside) ed.remote?.onCursor(p.x, p.y);
		if (!onhover) return;
		if (!inside) return onhover(null);
		const px = Math.floor(p.x),
			py = Math.floor(p.y);
		let label = `${px}, ${py}`;
		if (ed.doc.meta.kind === 'skin' && ed.doc.width === 64 && ed.doc.height === 64) {
			const hit = hitTest(ed.doc.meta.skin?.model ?? 'classic', px, py);
			label += hit ? ` · ${hit.part.label} — ${FACE_LABELS[hit.face.face]}` : ' · unused area';
		}
		onhover(label);
	}

	function pointerdown(e: PointerEvent) {
		canvas!.focus({ preventScroll: true });
		if (e.pointerType === 'touch') {
			touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (touches.size === 2) {
				// Second finger: abandon the stroke and start pinch-zoom.
				if (activeTool) {
					TOOLS[activeTool].cancel?.(ed.ctx);
					activeTool = null;
				}
				startPinch();
				return;
			}
			if (touches.size > 2) return;
		}
		if (activePointer !== null) return;
		const p = info(e);
		canvas!.setPointerCapture(e.pointerId);
		activePointer = e.pointerId;
		if (e.button === 1 || spaceHeld || (e.button === 0 && ed.tool === 'hand')) {
			panning = { x: e.clientX, y: e.clientY };
			e.preventDefault();
			return;
		}
		if (e.button === 2) {
			// Right-click samples a colour, like most pixel editors.
			TOOLS.eyedropper.onDown(ed.ctx, p);
			return;
		}
		if (e.button !== 0) return;
		if (ed.playing) ed.stop();
		activeTool = ed.tool;
		TOOLS[activeTool].onDown(ed.ctx, p);
		e.preventDefault();
	}

	function pointermove(e: PointerEvent) {
		if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
			touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pinch && touches.size === 2) return movePinch();
		}
		const p = info(e);
		updateHover(p);
		if (e.pointerId !== activePointer) return;
		if (panning) {
			ed.pan(e.clientX - panning.x, e.clientY - panning.y);
			panning = { x: e.clientX, y: e.clientY };
			return;
		}
		if (!activeTool) return;
		// Coalesced events give smooth strokes even when the main thread is busy.
		const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
		if (events.length > 1) for (const ce of events) TOOLS[activeTool].onMove(ed.ctx, info(ce));
		else TOOLS[activeTool].onMove(ed.ctx, p);
	}

	function pointerup(e: PointerEvent) {
		touches.delete(e.pointerId);
		if (touches.size < 2) pinch = null;
		if (e.pointerId !== activePointer) return;
		activePointer = null;
		if (panning) {
			panning = null;
			return;
		}
		if (activeTool) {
			const t = activeTool;
			activeTool = null;
			if (e.type === 'pointercancel') TOOLS[t].cancel?.(ed.ctx);
			else TOOLS[t].onUp(ed.ctx, info(e));
		}
	}

	function startPinch() {
		const [a, b] = [...touches.values()];
		pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
		activePointer = null;
	}

	function movePinch() {
		const [a, b] = [...touches.values()];
		const dist = Math.hypot(a.x - b.x, a.y - b.y);
		const cx = (a.x + b.x) / 2,
			cy = (a.y + b.y) / 2;
		const r = canvas!.getBoundingClientRect();
		ed.pan(cx - pinch!.cx, cy - pinch!.cy);
		if (pinch!.dist > 0) ed.zoomAt(dist / pinch!.dist, cx - r.left, cy - r.top);
		pinch = { dist, cx, cy };
	}

	function wheel(e: WheelEvent) {
		e.preventDefault();
		const r = canvas!.getBoundingClientRect();
		const sx = e.clientX - r.left,
			sy = e.clientY - r.top;
		const mouseWheel =
			e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
		if (e.ctrlKey || e.metaKey || mouseWheel) {
			const k = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : e.ctrlKey && !mouseWheel ? 0.01 : 0.0025));
			ed.zoomAt(k, sx, sy);
		} else ed.pan(-e.deltaX, -e.deltaY);
	}

	const cursor = $derived(
		spaceHeld || panning ? 'grab' : ed.tool === 'zoom' ? 'zoom-in' : TOOLS[ed.tool].cursor
	);
</script>

<div class="host" bind:this={host}>
	<canvas
		bind:this={canvas}
		tabindex="0"
		aria-label="Drawing canvas, {ed.doc.width} by {ed.doc
			.height} pixels. Use the toolbar or keyboard shortcuts to choose a tool."
		style:cursor
		onpointerdown={pointerdown}
		onpointermove={pointermove}
		onpointerup={pointerup}
		onpointercancel={pointerup}
		onpointerleave={() => {
			if (activePointer === null) {
				ed.hover = null;
				onhover?.(null);
			}
		}}
		onwheel={wheel}
		oncontextmenu={(e) => e.preventDefault()}
	></canvas>
	{#if ed.notice}
		<div class="notice" role="status">{ed.notice}</div>
	{/if}
</div>

<style>
	.host {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #1b1c20;
	}
	canvas {
		display: block;
		touch-action: none;
		outline: none;
	}
	canvas:focus-visible {
		box-shadow: inset 0 0 0 2px var(--accent);
	}
	.notice {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		padding: 6px 12px;
		border-radius: 999px;
		background: rgba(40, 41, 48, 0.95);
		border: 1px solid var(--line-2);
		font-size: 12px;
		pointer-events: none;
		animation: fade 0.15s ease-out;
		white-space: nowrap;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
