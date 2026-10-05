export function relativeTime(t: number, now = Date.now()): string {
	const s = Math.round((now - t) / 1000);
	if (s < 10) return 'just now';
	if (s < 60) return `${s} seconds ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
	const d = Math.round(h / 24);
	if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
	return new Date(t).toLocaleDateString();
}

export function clockTime(t: number) {
	return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
