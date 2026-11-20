// The state after a user clicks "Allow for this site" on the grant page: the image server sends
// no CORS headers, and the extension holds host access to it. Chrome cannot show its permission
// prompt under automation, so access is pre-granted in a temporary manifest copy; with access
// already held, chrome.permissions.request() resolves true without a prompt, which lets the test
// drive the real grant page: click "Allow for this site" -> background re-runs the job -> file saved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '..');
let server, port, context, sw, tmp, webp;

before(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), 'saveform-granted-'));
  const ext = path.join(tmp, 'ext');
  await cp(path.join(ROOT, 'extension'), ext, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://localhost/*'];
  await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: path.join(tmp, 'dl'),
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const p = await context.newPage();
  webp = Buffer.from(await p.evaluate(async () => {
    const c = new OffscreenCanvas(30, 20); c.getContext('2d').fillRect(0, 0, 30, 20);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/webp' })).arrayBuffer()));
  }));
  await p.close();
  server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'image/webp' }); res.end(webp); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  await sw.evaluate(() => chrome.storage.sync.set({ askWhere: false }));
});

after(async () => { await context?.close(); server?.close(); if (tmp) await rm(tmp, { recursive: true, force: true }); });

test('grant page: Allow for this site -> image without CORS headers is saved', async () => {
  const src = `http://localhost:${port}/no-cors/locked.webp`;
  await sw.evaluate(({ src, port }) => chrome.storage.session.set({
    'job:t1': { job: { action: 'save', fmt: 'png', src, tabId: -1, frameId: 0 }, origin: `http://localhost:${port}/*`, created: Date.now() },
  }), { src, port });
  const extId = new URL(sw.url()).host;
  const grant = await context.newPage();
  await grant.goto(`chrome-extension://${extId}/grant.html?id=t1`);
  assert.equal(await grant.textContent('#host'), `localhost:${port}`);
  const closed = grant.waitForEvent('close', { timeout: 10000 });
  await grant.click('#allow-site');
  await grant.waitForFunction(() => /^Saved/.test(document.getElementById('status').textContent));
  assert.equal(await grant.textContent('#status'), 'Saved locked.png');
  await closed; // the page closes itself after a successful save
  // Playwright stores downloads under GUID names, so find it by download record instead.
  const item = await sw.evaluate(async () => {
    for (let i = 0; i < 100; i++) {
      const [d] = await chrome.downloads.search({ mime: 'image/png', state: 'complete' });
      if (d) return d;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  });
  assert.ok(item, 'a PNG download completed');
  const buf = await readFile(item.filename);
  assert.equal(buf[0], 0x89); assert.equal(buf.subarray(1, 4).toString(), 'PNG');
});

test('an expired grant request says so instead of failing silently', async () => {
  const extId = new URL(sw.url()).host;
  const grant = await context.newPage();
  await grant.goto(`chrome-extension://${extId}/grant.html?id=nope`);
  assert.match(await grant.textContent('#status'), /expired/);
  assert.equal(await grant.isDisabled('#allow-site'), true);
});

test('settings page loads, saves a change, and lists granted sites', async () => {
  const extId = new URL(sw.url()).host;
  const opts = await context.newPage();
  const errors = [];
  opts.on('pageerror', (e) => errors.push(e.message));
  opts.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await opts.goto(`chrome-extension://${extId}/options.html`);
  await opts.waitForSelector('#sites li');
  assert.match(await opts.textContent('#sites'), /localhost/);
  assert.equal(await opts.isChecked('#askWhere'), false);
  await opts.check('#askWhere');
  await opts.waitForFunction(() => document.getElementById('status').textContent === 'Saved');
  assert.equal(await sw.evaluate(async () => (await chrome.storage.sync.get('askWhere')).askWhere), true);
  const avif = await sw.evaluate(() => globalThis.saveform.canEncode('image/avif'));
  assert.equal(await opts.isVisible('#avifRow'), avif, 'AVIF setting only shown when AVIF can be written');
  if (process.env.SHOTS) await opts.screenshot({ path: path.join(process.env.SHOTS, 'options.png'), fullPage: true });
  assert.deepEqual(errors, []);
});
