/**
 * Focus (and select) an input as soon as it mounts. The `autofocus` attribute only applies on page
 * load, so it does nothing for inputs that appear later (inline rename fields); without this, typing a
 * name would fall through to the editor's single-key tool shortcuts.
 */
export function focusOnMount(node: HTMLInputElement) {
	queueMicrotask(() => {
		node.focus({ preventScroll: true });
		node.select();
	});
}
