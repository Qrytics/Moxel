<script lang="ts">
	let { size = 22 }: { size?: number } = $props();
</script>

<!-- Isometric voxel mark: a "moxel" is a Moxel pixel with depth. -->
<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
	<path d="M12 2 21 7 12 12 3 7Z" fill="#8fd0ff" />
	<path d="M3 7 12 12 12 22 3 17Z" fill="#3d8fe0" />
	<path d="M21 7 12 12 12 22 21 17Z" fill="#5fb3ff" />
	<path d="M12 12 16.5 9.5 16.5 14.5 12 17Z" fill="#7ee0a1" />
</svg>
