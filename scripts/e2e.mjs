/**
 * End-to-end check of the production build, served under the real /Moxel/ base path.
 *
 *   npm run build
 *   npm i --no-save playwright && npx playwright install chromium   # once; not a devDependency
 *   node scripts/e2e.mjs            # add --headed to watch
 *
 * Starts `vite preview` and the signaling relay itself, then walks the "definition of done":
 * create a skin → draw → layers → undo/redo → 3D preview → autosave → reload persists →
 * export a valid PNG → .moxel round trip → paint mode (brush, smudge, undo, reload, PNG/JPEG export)
 * → offline reload → live session between two browsers.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createSignalingServer } from '../signaling/server.mjs';

const PORT = 4174;
const BASE = `http://localhost:${PORT}/Moxel/`;
const headed = process.argv.includes('--headed');
let failures = 0;
let passes = 0;

function check(cond, label) {
	if (cond) {
		passes++;
		console.log(`  ✓ ${label}`);
	} else {
		failures++;
		console.log(`  ✗ ${label}`);
	}
}

async function waitForServer(url, ms = 15000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		try {
			const r = await fetch(url);
			if (r.ok) return;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`Server did not start: ${url}`);
}

/** Read one pixel of the active project's base layer straight from IndexedDB. */
async function storedPixel(page, x, y) {
	return page.evaluate(
		async ([x, y]) => {
			const id = decodeURIComponent(location.hash.split('/')[2] ?? '');
			const db = await new Promise((res, rej) => {
				const r = indexedDB.open('moxel');
				r.onsuccess = () => res(r.result);
				r.onerror = () => rej(r.error);
			});
			const row = await new Promise((res) => {
				const r = db.transaction('docs').objectStore('docs').get(id);
				r.onsuccess = () => res(r.result);
			});
			db.close();
			if (!row) return null;
			const s = row.snapshot;
			// Flatten: last non-transparent value across layers, good enough for single-colour checks.
			let out = [0, 0, 0, 0];
			for (const [, data] of s.cels) {
				const i = (y * s.meta.width + x) * 4;
				if (data[i + 3]) out = [data[i], data[i + 1], data[i + 2], data[i + 3]];
			}
			return out;
		},
		[x, y]
	);
}

async function canvasPoint(page, docX, docY) {
	const box = await page.locator('canvas[aria-label^="Drawing canvas"]').boundingBox();
	const view = await page.evaluate(() => null);
	void view;
	// The editor fits the doc centred at an integer zoom; recover it from the status bar.
	const zoomText = await page.locator('footer.status span').nth(1).textContent();
	const zoom = parseInt(zoomText, 10) / 100;
	const w = 64 * zoom,
		h = 64 * zoom;
	const ox = (box.width - w) / 2,
		oy = (box.height - h) / 2;
	return { x: box.x + ox + (docX + 0.5) * zoom, y: box.y + oy + (docY + 0.5) * zoom };
}

/** Paint documents fit at a fractional zoom; recompute the view the same way the editor does. */
async function paintPoint(page, docX, docY, docW = 1920, docH = 1080) {
	const box = await page.locator('canvas[aria-label^="Drawing canvas"]').boundingBox();
	const margin = Math.min(48, Math.min(box.width, box.height) * 0.04);
	const zoom = Math.min((box.width - margin * 2) / docW, (box.height - margin * 2) / docH);
	const ox = (box.width - docW * zoom) / 2,
		oy = (box.height - docH * zoom) / 2;
	return { x: box.x + ox + docX * zoom, y: box.y + oy + docY * zoom };
}

async function stroke(page, from, to, steps = 20) {
	const a = await paintPoint(page, ...from),
		b = await paintPoint(page, ...to);
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(b.x, b.y, { steps });
	await page.mouse.up();
}

const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
const signal = await createSignalingServer({ port: 8787, log: null });
const browser = await chromium.launch({ headless: !headed });

try {
	await waitForServer(BASE);
	console.log('Moxel e2e against', BASE);

	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
	const page = await context.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

	console.log('First run');
	await page.goto(BASE);
	await page.getByRole('heading', { name: 'Welcome to Moxel' }).waitFor();
	check(
		await page.getByRole('heading', { name: 'Welcome to Moxel' }).isVisible(),
		'welcome screen shown at /Moxel/'
	);
	check(await page.getByText('Your artwork is not uploaded').isVisible(), 'privacy message visible');

	console.log('Create a skin');
	await page.getByRole('button', { name: /Create skin/ }).click();
	await page.getByRole('button', { name: /Slim/ }).click();
	await page.getByRole('button', { name: 'Blank skin' }).click();
	await page.locator('dialog input').first().fill('E2E Skin');
	await page.getByRole('button', { name: 'Create', exact: true }).click();
	await page.waitForSelector('canvas[aria-label^="Drawing canvas"]');
	check(page.url().includes('/Moxel/#/p/'), 'editor route under the base path');
	check(await page.getByText('Slim skin').isVisible(), 'slim model selected');

	console.log('Draw');
	await page.keyboard.press('p');
	await page.locator('#color-hex').fill('#ff0000');
	await page.locator('#color-hex').press('Enter');
	const a = await canvasPoint(page, 10, 10);
	const b = await canvasPoint(page, 13, 10);
	await page.mouse.move(a.x, a.y);
	await page.mouse.down();
	await page.mouse.move(b.x, b.y, { steps: 6 });
	await page.mouse.up();
	await page.waitForSelector('text=Saved locally ✓', { timeout: 5000 });
	check((await storedPixel(page, 12, 10))?.[0] === 255, 'stroke autosaved to IndexedDB');

	console.log('Undo / redo');
	await page.keyboard.press('ControlOrMeta+z');
	await page.waitForTimeout(1300);
	check((await storedPixel(page, 12, 10))?.[3] === 0, 'undo removed the whole stroke');
	await page.keyboard.press('ControlOrMeta+Shift+z');
	await page.waitForTimeout(1300);
	check((await storedPixel(page, 12, 10))?.[0] === 255, 'redo restored it');

	console.log('Layers');
	await page.getByRole('button', { name: 'New layer' }).click();
	check((await page.locator('.layers li.row').count()) === 2, 'new layer added');
	await page.locator('.layers .main').first().dblclick();
	await page.keyboard.type('Hair');
	await page.keyboard.press('Enter');
	check(
		(await page.locator('.layers .name').first().textContent())?.trim() === 'Hair',
		'layer renamed inline (typing does not trigger tool shortcuts)'
	);
	await page.locator('#color-hex').fill('#00ff00');
	await page.locator('#color-hex').press('Enter');
	const c = await canvasPoint(page, 20, 20);
	await page.mouse.click(c.x, c.y);
	await page.getByRole('button', { name: 'Move layer down' }).click();
	await page
		.getByRole('button', { name: /^Hide / })
		.first()
		.click();
	check((await page.locator('.layers li.row.hidden').count()) === 1, 'layer hidden');

	console.log('3D preview');
	check(await page.locator('.preview3d-canvas').isVisible(), 'WebGL preview rendered in split view');
	await page.getByRole('button', { name: 'Back', exact: true }).click();
	await page.getByRole('button', { name: 'Right arm' }).click();
	check(
		(await page.getByRole('button', { name: 'Right arm' }).getAttribute('aria-pressed')) === 'false',
		'body part toggle'
	);

	console.log('Persistence across reload');
	await page.waitForTimeout(1200);
	const projectUrl = page.url();
	await page.reload();
	await page.waitForSelector('canvas[aria-label^="Drawing canvas"]');
	check((await page.locator('.layers li.row').count()) === 2, 'layers restored after reload');
	check((await storedPixel(page, 10, 10))?.[0] === 255, 'pixels restored after reload');
	await page.goto(BASE);
	check(await page.getByText('E2E Skin').first().isVisible(), 'project listed on the home screen');
	check(await page.getByText(/Continue editing/).isVisible(), 'recover / continue banner shown');
	await page.goto(projectUrl);
	await page.waitForSelector('canvas[aria-label^="Drawing canvas"]');

	console.log('Export');
	await page
		.getByRole('button', { name: /Export/ })
		.first()
		.click();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.locator('dialog').getByRole('button', { name: 'Export', exact: true }).click()
	]);
	const png = readFileSync(await download.path());
	check(png.subarray(1, 4).toString() === 'PNG', 'downloaded a PNG');
	check(png.readUInt32BE(16) === 64 && png.readUInt32BE(20) === 64, 'exported skin is 64×64');

	await page
		.getByRole('button', { name: /Export/ })
		.first()
		.click();
	await page.getByRole('radio', { name: /Moxel project/ }).click();
	const [proj] = await Promise.all([
		page.waitForEvent('download'),
		page.locator('dialog').getByRole('button', { name: 'Export', exact: true }).click()
	]);
	check(proj.suggestedFilename().endsWith('.moxel'), 'exported a .moxel project');
	const projPath = await proj.path();

	console.log('Import an existing skin PNG');
	const pngPath = await download.path();
	const fresh = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const p3 = await fresh.newPage();
	await p3.goto(BASE);
	const [pngChooser] = await Promise.all([
		p3.waitForEvent('filechooser'),
		p3.getByRole('button', { name: /Import PNG/ }).click()
	]);
	await pngChooser.setFiles({ name: 'my-skin.png', mimeType: 'image/png', buffer: readFileSync(pngPath) });
	await p3.waitForSelector('canvas[aria-label^="Drawing canvas"]');
	check(await p3.getByText('Slim skin').isVisible(), 'PNG imported as a skin with the slim model detected');
	await fresh.close();

	console.log('Import .moxel in a fresh browser profile');
	const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const p2 = await other.newPage();
	await p2.goto(BASE);
	const [chooser] = await Promise.all([
		p2.waitForEvent('filechooser'),
		p2.getByRole('button', { name: /Import Moxel project/ }).click()
	]);
	await chooser.setFiles(projPath);
	await p2.waitForSelector('canvas[aria-label^="Drawing canvas"]');
	check((await p2.locator('.layers li.row').count()) === 2, 'imported project keeps its layers');
	await other.close();

	console.log('Paint mode');
	const paintCtx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		acceptDownloads: true
	});
	const pp = await paintCtx.newPage();
	pp.on('pageerror', (e) => errors.push('paint: ' + e.message));
	await pp.goto(BASE);
	await pp
		.getByRole('button', { name: /New project|Start painting/ })
		.first()
		.click();
	check(
		(await pp.getByRole('tab', { name: 'Paint' }).getAttribute('aria-selected')) === 'true',
		'new-project dialog opens on Paint'
	);
	await pp.locator('dialog input').first().fill('E2E Painting');
	await pp.getByRole('button', { name: 'Create', exact: true }).click();
	await pp.waitForSelector('canvas[aria-label^="Drawing canvas"]');
	check(await pp.getByRole('button', { name: /^Smudge/ }).isVisible(), 'paint tools in the toolbar');
	check(
		(await pp.getByRole('button', { name: /^Pencil/ }).count()) === 0,
		'pixel pencil hidden in paint mode'
	);
	await pp.locator('#color-hex').fill('#ff0000');
	await pp.locator('#color-hex').press('Enter');
	await stroke(pp, [400, 500], [1400, 500]);
	await pp.waitForSelector('text=Saved locally ✓', { timeout: 8000 });
	const painted = await storedPixel(pp, 900, 500);
	check(painted?.[0] === 255 && painted?.[1] < 60, 'smooth brush stroke autosaved');

	await pp.keyboard.press('f');
	await stroke(pp, [900, 490], [900, 640], 30);
	await pp.waitForTimeout(1300);
	const smudged = await storedPixel(pp, 900, 540);
	check(smudged?.[1] < 250, 'smudge dragged paint off the stroke');
	await pp.keyboard.press('ControlOrMeta+z');
	await pp.waitForTimeout(1300);
	check((await storedPixel(pp, 900, 540))?.[1] === 255, 'undo removed the smudge');
	await pp.keyboard.press('ControlOrMeta+Shift+z');
	await pp.waitForTimeout(1300);

	await pp.reload();
	await pp.waitForSelector('canvas[aria-label^="Drawing canvas"]');
	check((await storedPixel(pp, 900, 500))?.[0] === 255, 'painting restored after reload');
	check(await pp.getByRole('button', { name: /^Smudge/ }).isVisible(), 'still a paint project after reload');

	// Paint on a rotated view: the dab must land under the pointer, not where it would be unrotated.
	await pp.keyboard.press('b');
	await pp.locator('canvas[aria-label^="Drawing canvas"]').focus();
	await pp.keyboard.press('Shift+Period');
	await pp.keyboard.press('Shift+Period');
	const cbox = await pp.locator('canvas[aria-label^="Drawing canvas"]').boundingBox();
	const u = await paintPoint(pp, 1500, 850);
	const cx = cbox.x + cbox.width / 2,
		cy = cbox.y + cbox.height / 2;
	const ang = (30 * Math.PI) / 180;
	const rx = cx + (u.x - cx) * Math.cos(ang) - (u.y - cy) * Math.sin(ang),
		ry = cy + (u.x - cx) * Math.sin(ang) + (u.y - cy) * Math.cos(ang);
	await pp.mouse.click(rx, ry);
	await pp.waitForTimeout(1300);
	check((await storedPixel(pp, 1500, 850))?.[1] < 60, 'brush lands under the pointer on a rotated view');
	await pp.keyboard.press('ControlOrMeta+0');

	await pp
		.getByRole('button', { name: /Export/ })
		.first()
		.click();
	const [paintPng] = await Promise.all([
		pp.waitForEvent('download'),
		pp.locator('dialog').getByRole('button', { name: 'Export', exact: true }).click()
	]);
	const pbuf = readFileSync(await paintPng.path());
	check(pbuf.readUInt32BE(16) === 1920 && pbuf.readUInt32BE(20) === 1080, 'painting exports at 1920×1080');
	await pp
		.getByRole('button', { name: /Export/ })
		.first()
		.click();
	await pp.getByRole('radio', { name: /JPEG/ }).click();
	const [jpg] = await Promise.all([
		pp.waitForEvent('download'),
		pp.locator('dialog').getByRole('button', { name: 'Export', exact: true }).click()
	]);
	const jbuf = readFileSync(await jpg.path());
	check(jpg.suggestedFilename().endsWith('.jpg') && jbuf[0] === 0xff && jbuf[1] === 0xd8, 'exported a JPEG');
	await paintCtx.close();

	console.log('Offline');
	await page.waitForTimeout(500);
	await context.setOffline(true);
	await page.reload();
	await page.waitForSelector('canvas[aria-label^="Drawing canvas"]', { timeout: 10000 });
	check(true, 'app shell loads offline (service worker)');
	await page.keyboard.press('p');
	const d = await canvasPoint(page, 30, 30);
	await page.mouse.click(d.x, d.y);
	await page.waitForSelector('text=Offline — saved locally', { timeout: 5000 });
	check(true, 'edits save locally while offline');
	await context.setOffline(false);

	console.log('Live session (two browsers)');
	await page.getByRole('button', { name: /Live/ }).click();
	await page.locator('dialog input').first().fill('Host');
	await page.getByRole('button', { name: 'Start session' }).click();
	const invite = await page.locator('dialog input[readonly]').inputValue();
	check(invite.includes('/Moxel/#/join/'), 'invite link generated');
	await page.getByRole('button', { name: 'Done' }).click();

	const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const guest = await guestCtx.newPage();
	guest.on('pageerror', (e) => errors.push('guest: ' + e.message));
	await guest.goto(invite);
	await guest.locator('input').first().fill('Guest');
	await guest.getByRole('button', { name: 'Join session' }).click();
	await guest.waitForSelector('canvas[aria-label^="Drawing canvas"]', { timeout: 20000 });
	check(true, 'guest joined and received the shared canvas');
	check((await storedPixel(guest, 10, 10))?.[0] === 255, "guest's local copy contains the host's pixels");

	await page.locator('#color-hex').fill('#0000ff');
	await page.locator('#color-hex').press('Enter');
	await page.locator('.layers .main').last().click();
	const e = await canvasPoint(page, 40, 12);
	await page.mouse.click(e.x, e.y);
	await guest.waitForTimeout(2500);
	const gp = await storedPixel(guest, 40, 12);
	check(gp?.[2] === 255, "host's stroke appeared on the guest's canvas");

	await guest.keyboard.press('p');
	await guest.locator('#color-hex').fill('#ffff00');
	await guest.locator('#color-hex').press('Enter');
	const f = await canvasPoint(guest, 44, 12);
	await guest.mouse.click(f.x, f.y);
	await page.waitForTimeout(2500);
	const hp = await storedPixel(page, 44, 12);
	check(hp?.[0] === 255 && hp?.[1] === 255, "guest's stroke appeared on the host's canvas");
	await guestCtx.close();

	console.log('Live session: side by side');
	await page.getByRole('button', { name: /Live session/ }).click();
	await page.getByRole('button', { name: 'Leave session' }).click();
	await page.getByRole('button', { name: /Live session/ }).click();
	await page.getByRole('radio', { name: /Side by side/ }).click();
	await page.getByRole('button', { name: 'Start session' }).click();
	const sideInvite = await page.locator('dialog input[readonly]').inputValue();
	check(sideInvite.includes('mode=side'), 'side-by-side invite link');
	await page.getByRole('button', { name: 'Done' }).click();
	const sideCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const side = await sideCtx.newPage();
	await side.goto(sideInvite);
	await side.locator('input').first().fill('Friend');
	await side.getByRole('button', { name: 'Join session' }).click();
	await side.getByRole('button', { name: 'New skin' }).click({ timeout: 20000 });
	await side.waitForSelector('canvas[aria-label^="Drawing canvas"]');
	await side.waitForSelector('.friends figure', { timeout: 15000 });
	check(true, "friend sees the host's canvas tile");
	await page.waitForSelector('.friends figure', { timeout: 15000 });
	check(
		await page
			.locator('.friends figcaption')
			.first()
			.textContent()
			.then((t) => t.includes('Friend')),
		"host sees the friend's canvas tile"
	);
	await sideCtx.close();

	check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
	await context.close();
} catch (e) {
	failures++;
	console.error(e);
} finally {
	await browser.close();
	await signal.close();
	preview.kill();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
