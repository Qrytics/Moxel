/** Short random ids. Collision-safe enough for layers/frames shared between a handful of peers. */
export function uid(prefix = ''): string {
	const bytes = new Uint8Array(9);
	crypto.getRandomValues(bytes);
	let s = '';
	for (const b of bytes) s += (b % 36).toString(36);
	return prefix + s;
}

/** 128-bit url-safe token, used for live-session room ids where the link itself is the key. */
export function roomToken(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
