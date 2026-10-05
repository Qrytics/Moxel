import { mount } from 'svelte';
import './app.css';
import App from './ui/App.svelte';

const app = mount(App, { target: document.getElementById('app')! });

// Offline support: the service worker precaches the app shell so Moxel keeps working (and keeps
// saving to IndexedDB) without a connection once it has been loaded.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
	import('virtual:pwa-register')
		.then(({ registerSW }) => registerSW({ immediate: true }))
		.catch(() => {
			/* offline support is a progressive enhancement */
		});
}

export default app;
