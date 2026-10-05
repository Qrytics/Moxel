<script lang="ts" module>
	/** 20×20 stroke icons, drawn for Moxel. */
	export const ICONS = {
		move: 'M10 2v16M2 10h16M10 2l-2.5 2.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5',
		'select-rect': 'M3 3h3M8 3h4M14 3h3v3M17 8v4M17 14v3h-3M12 17H8M6 17H3v-3M3 12V8M3 6V3',
		'select-ellipse': 'M10 3c4 0 7 3 7 7M17 10c0 4-3 7-7 7M10 17c-4 0-7-3-7-7M3 10c0-4 3-7 7-7',
		lasso: 'M10 3c4.4 0 7 2.2 7 5s-3 5-7 5-7-2.2-7-5 2.6-5 7-5zM5.5 12c-.8 1-1 2.3-.2 3.3.9 1 2.4 1 3.2.2',
		wand: 'M3 17l9-9M12 8l2 2M13 3v2M17 7h-2M15.5 4.5L14 6M8 3l.5 1.5M17 12l-1.5-.5',
		pencil: 'M3 17l1-4L13.5 3.5a1.4 1.4 0 012 0l1 1a1.4 1.4 0 010 2L7 16zM12 5l3 3',
		brush: 'M14 3l3 3-7.5 7.5-3-3zM6.5 10.5c-2 0-3 1.5-3 3 0 1.3-.5 2.3-1.5 3 3 .5 6-.5 6.5-3',
		eraser: 'M7 17h10M3.5 12.5l7-7a1.5 1.5 0 012 0l3 3a1.5 1.5 0 010 2L10 16H7z M7.5 8.5l4 4',
		fill: 'M4 9l6-6 6 6-6 6zM4 9h12M17 13s1.5 1.8 1.5 3a1.5 1.5 0 01-3 0c0-1.2 1.5-3 1.5-3z',
		clone: 'M7 3h6v4H7zM10 7v3M4 10h12v3H4zM6 13l-1 4h10l-1-4',
		smudge:
			'M8 17.5V9a1.5 1.5 0 013 0v3.5M11 11a1.5 1.5 0 013 0v2.5c0 2.4-1.8 4-4 4H9.5M3 5.5c2.2-1.6 4.3-1.6 6.5 0s4.3 1.6 6.5 0',
		blur: 'M10 2.5s5.5 5.8 5.5 9.5a5.5 5.5 0 01-11 0c0-3.7 5.5-9.5 5.5-9.5zM7.5 12.5A2.5 2.5 0 0010 15',
		gradient: 'M3.5 3.5h13v13h-13zM3.5 12l8.5-8.5M3.5 7.5l4-4M8 16.5L16.5 8M12.5 16.5l4-4',
		line: 'M4 16L16 4',
		rect: 'M3.5 5.5h13v9h-13z',
		ellipse: 'M10 4.5c3.9 0 7 2.5 7 5.5s-3.1 5.5-7 5.5S3 13 3 10s3.1-5.5 7-5.5z',
		eyedropper: 'M3 17l1.5-.5 7-7M11.5 4.5l4 4M13 3l4 4-2 2-4-4zM4.5 12l3.5 3.5',
		hand: 'M7 10V4.5a1.2 1.2 0 012.4 0V9M9.4 9V3.5a1.2 1.2 0 012.4 0V9M11.8 9V4.5a1.2 1.2 0 012.4 0V10M14.2 8.5a1.2 1.2 0 012.4 0V12c0 3-2.3 5.5-5.5 5.5H10c-2 0-3.4-1-4.4-2.6L3.3 11a1.2 1.2 0 012-1.3L7 12',
		zoom: 'M8.5 3.5a5 5 0 110 10 5 5 0 010-10zM12.5 12.5L17 17M6.5 8.5h4M8.5 6.5v4',
		undo: 'M7 5L3 9l4 4M3 9h9a5 5 0 010 10h-2',
		redo: 'M13 5l4 4-4 4M17 9H8a5 5 0 000 10h2',
		plus: 'M10 4v12M4 10h12',
		minus: 'M4 10h12',
		trash: 'M4 6h12M8 6V4h4v2M5.5 6l.8 10.5h7.4L14.5 6M8.5 9v5M11.5 9v5',
		copy: 'M7 7h9v9H7zM4 13V4h9',
		folder: 'M3 6V4.5h5l1.5 2H17V16H3z',
		eye: 'M2 10s3-5.5 8-5.5 8 5.5 8 5.5-3 5.5-8 5.5S2 10 2 10zM10 7.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z',
		'eye-off':
			'M3 3l14 14M8 5c.6-.2 1.3-.3 2-.3 5 0 8 5.3 8 5.3a14 14 0 01-2.4 2.9M5 6.8C3.2 8.2 2 10 2 10s3 5.3 8 5.3c1.2 0 2.3-.3 3.2-.7',
		lock: 'M5.5 9h9v8h-9zM7 9V6.5a3 3 0 016 0V9',
		unlock: 'M5.5 9h9v8h-9zM7 9V6.5a3 3 0 015.8-1',
		group: 'M3 6V4.5h5l1.5 2H17V16H3zM3 8h14',
		merge: 'M6 3v4l4 4 4-4V3M10 11v6M7 14l3 3 3-3',
		up: 'M10 15V5M5.5 9.5L10 5l4.5 4.5',
		down: 'M10 5v10M5.5 10.5L10 15l4.5-4.5',
		chevron: 'M7.5 5l5 5-5 5',
		'chevron-down': 'M5 7.5l5 5 5-5',
		close: 'M5 5l10 10M15 5L5 15',
		more: 'M5 10h.01M10 10h.01M15 10h.01',
		play: 'M6 4l10 6-10 6z',
		pause: 'M6 4h3v12H6zM11 4h3v12h-3z',
		prev: 'M14 5l-6 5 6 5M6 5v10',
		next: 'M6 5l6 5-6 5M14 5v10',
		onion: 'M10 3c3 3 5 5.5 5 8a5 5 0 01-10 0c0-2.5 2-5 5-8zM7.5 12a2.5 2.5 0 005 0',
		grid: 'M3 3h14v14H3zM3 7.7h14M3 12.3h14M7.7 3v14M12.3 3v14',
		cube: 'M10 2.5l7 4v7l-7 4-7-4v-7zM3 6.5l7 4 7-4M10 10.5v7',
		layout2d: 'M3 3.5h14v13H3z',
		split: 'M3 3.5h14v13H3zM10 3.5v13',
		users:
			'M7.5 9a3 3 0 100-6 3 3 0 000 6zM2 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5M13 3.3a3 3 0 010 5.4M15.5 12.5c1.5.7 2.5 2.3 2.5 4.5',
		link: 'M8.5 11.5l3-3M7 9l-1.8 1.8a3 3 0 004.2 4.2L11 13.3M13 11l1.8-1.8a3 3 0 00-4.2-4.2L9 6.7',
		download: 'M10 3v10M6 9l4 4 4-4M4 16h12',
		upload: 'M10 13V3M6 7l4-4 4 4M4 16h12',
		image: 'M3 4h14v12H3zM3 13l4-4 3 3 2-2 5 5M13 7.5a1 1 0 110 .1',
		check: 'M4 10.5l4 4 8-9',
		warn: 'M10 3l8 14H2zM10 8v4M10 14.5v.01',
		info: 'M10 2.5a7.5 7.5 0 110 15 7.5 7.5 0 010-15zM10 9v5M10 6.5v.01',
		swap: 'M5 7h10l-3-3M15 13H5l3 3',
		symmetry: 'M10 2v16M7 5L3 10l4 5zM13 5l4 5-4 5z',
		menu: 'M3 5h14M3 10h14M3 15h14',
		layers: 'M10 3l7 4-7 4-7-4zM3 10.5l7 4 7-4M3 14l7 4 7-4',
		palette:
			'M10 3a7 7 0 100 14c1 0 1.5-.7 1.5-1.5 0-1.2-1-1.5-1-2.5 0-.8.7-1.5 1.5-1.5H14a3 3 0 003-3c0-3-3-5.5-7-5.5zM6.5 9.5h.01M8 6.5h.01M12 6.5h.01',
		film: 'M3 4h14v12H3zM3 7.5h14M3 12.5h14M6.5 4v3.5M10 4v3.5M13.5 4v3.5M6.5 12.5V16M10 12.5V16M13.5 12.5V16',
		wifi: 'M2.5 8a11 11 0 0115 0M5 11a7 7 0 0110 0M7.5 14a3 3 0 015 0M10 16.5v.01',
		save: 'M4 3h10l3 3v11H4zM7 3v4h6V3M7 17v-5h7v5',
		paint: 'M4 16c2.5 0 4-1.5 4-3.5S6.5 10 5 10c-2 0-2 3-1 6zM8 12L16 4',
		reset: 'M4 10a6 6 0 1 0 2-4.5M4 4v4h4',
		sun: 'M10 6.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4',
		camera: 'M3 6h3l1.5-2h5L14 6h3v10H3zM10 8.5a3 3 0 110 6 3 3 0 010-6z'
	} as const;
	export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
	let { name, size = 18, stroke = 1.6 }: { name: IconName; size?: number; stroke?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 20 20"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<path d={ICONS[name]} />
</svg>
