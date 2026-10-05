import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Moxel is served from a subpath of the portfolio site (`/Moxel/`), never from `/`.
 * Every asset URL, the service worker scope and the PWA manifest derive from this one value, so
 * a different mount point is a single env var (`MOXEL_BASE=/ npm run build`) rather than a code change.
 */
const base = process.env.MOXEL_BASE ?? '/Moxel/';

/**
 * Live sessions talk to the signaling relay at `<base>signal` on the same origin — on the Pi, Caddy
 * proxies that path to the relay container. `vite dev` / `vite preview` mirror that with a proxy to a
 * local relay (`npm run signal`), so the client code has a single code path everywhere.
 */
const signalProxy = {
	[`${base}signal`]: {
		target: process.env.MOXEL_SIGNAL_TARGET ?? 'ws://localhost:8787',
		ws: true,
		changeOrigin: true
	}
};

export default defineConfig({
	base,
	plugins: [
		svelte(),
		VitePWA({
			registerType: 'autoUpdate',
			injectRegister: false,
			includeAssets: ['favicon.svg', 'icons/*.png'],
			manifest: {
				name: 'Moxel',
				short_name: 'Moxel',
				description:
					'Pixel art, animation and Minecraft skin & texture editor. Projects stay in your browser.',
				theme_color: '#15161a',
				background_color: '#15161a',
				display: 'standalone',
				start_url: base,
				scope: base,
				icons: [
					{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
				]
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
				navigateFallback: `${base}index.html`,
				// The signaling socket shares the /Moxel/ prefix on the Pi; never let the SW answer it.
				navigateFallbackDenylist: [/\/signal(\/|$)/],
				cleanupOutdatedCaches: true,
				maximumFileSizeToCacheInBytes: 4 * 1024 * 1024
			}
		})
	],
	server: { proxy: signalProxy },
	preview: { proxy: signalProxy },
	worker: { format: 'es' },
	build: {
		target: 'es2022',
		chunkSizeWarningLimit: 800
	}
});
