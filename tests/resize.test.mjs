// Resize, "Max file size" and PNG colour reduction on the converter pages (session 10).
//   node --test tests/resize.test.mjs
// Builds dist/, serves it on a random localhost port and drives the pages in headless Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { outputSize } from '../extension/lib/convert.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE_PATH = '/save-image-format';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.wasm': 'application/wasm',
};

let server, origin, browser, context;
const consoleErrors = [];

before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-site.mjs')], { stdio: 'pipe' });
  server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith(`${BASE_PATH}/`)) path = path.slice(BASE_PATH.length);
    let file = normalize(join(DIST, path));
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.html'] }).end(await readFile(join(DIST, '404.html')));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ channel: 'chromium' });
  }
  context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
});

after(async () => {
  await context?.close();
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
  assert.deepEqual(consoleErrors, []);
});

async function openPage(path) {
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${path}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${path}: ${e.message}`));
  await page.goto(origin + path);
  await page.waitForSelector('[data-tool][data-ready]');
  return page;
}

/** A photo-like image with noise (hard to compress), encoded in the page. */
async function makeNoisyPhoto(page, w, h, mime = 'image/png', quality = 0.92) {
  const bytes = await page.evaluate(async ({ w, h, mime, quality }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b3d91'); g.addColorStop(0.5, '#f4a259'); g.addColorStop(1, '#5b8e7d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const n = ((seed >>> 16) & 63) - 32;
      img.data[i] += n; img.data[i + 1] += n >> 1; img.data[i + 2] -= n;
    }
    ctx.putImageData(img, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, mime, quality));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, { w, h, mime, quality });
  return Buffer.from(bytes);
}

/** 1-px black and white vertical stripes: aliases badly if a big reduction samples too sparsely. */
async function makeStripes(page, w, h) {
  const bytes = await page.evaluate(async ({ w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#000';
    for (let x = 0; x < w; x += 2) ctx.fillRect(x, 0, 1, h);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, { w, h });
  return Buffer.from(bytes);
}

async function waitForDone(page, n, timeout = 30000) {
  await page.waitForFunction((n) => document.querySelectorAll('#results li[data-state="done"]').length === n
    && !document.querySelector('#results li[data-state="queued"], #results li[data-state="working"]'), n, { timeout });
}

async function downloadRow(page, index = 0) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#results li[data-state="done"] a.btn').nth(index).click()]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

/** Width, height, and mean / standard deviation of the grey level, decoded by the browser. */
async function stats(page, bytes) {
  return page.evaluate(async (arr) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(arr)]));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let sum = 0, sq = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; sum += v; sq += v * v; }
    const mean = sum / n;
    return { width: bmp.width, height: bmp.height, mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
  }, [...bytes]);
}

const pngColourType = (b) => b[25];

test('outputSize: percent, fit (never enlarges), exact with one side kept in proportion, limits', () => {
  assert.deepEqual(outputSize(4000, 3000, null), { width: 4000, height: 3000 });
  assert.deepEqual(outputSize(4000, 3000, { mode: 'none', width: 10 }), { width: 4000, height: 3000 });
  assert.deepEqual(outputSize(4000, 3000, { mode: 'percent', percent: 25 }), { width: 1000, height: 750 });
  assert.deepEqual(outputSize(4000, 3000, { mode: 'fit', width: 800, height: 800 }), { width: 800, height: 600 });
  assert.deepEqual(outputSize(3000, 4000, { mode: 'fit', width: 800, height: 800 }), { width: 600, height: 800 });
  assert.deepEqual(outputSize(400, 300, { mode: 'fit', width: 800, height: 800 }), { width: 400, height: 300 });
  assert.deepEqual(outputSize(4000, 3000, { mode: 'fit', width: 0, height: 300 }), { width: 400, height: 300 });
  assert.deepEqual(outputSize(4000, 3000, { mode: 'exact', width: 300 }), { width: 300, height: 225 });
  assert.deepEqual(outputSize(4000, 3000, { mode: 'exact', width: 500, height: 500 }), { width: 500, height: 500 });
  assert.deepEqual(outputSize(40, 30, { mode: 'exact', height: 600 }), { width: 800, height: 600 });
  assert.deepEqual(outputSize(1000, 1, { mode: 'percent', percent: 1 }), { width: 10, height: 1 });
  assert.throws(() => outputSize(10000, 100, { mode: 'percent', percent: 200 }), /limit is 16,384/);
  // An image that is already bigger than the limit may still be made smaller.
  assert.deepEqual(outputSize(20000, 100, { mode: 'percent', percent: 50 }), { width: 10000, height: 50 });
});

test('resize: fit within 800×800 and exact width on the converter, with the size change shown in the row', async () => {
  const page = await openPage('/webp-to-jpg/');
  assert.equal(await page.locator('#resize-mode').inputValue(), 'none');
  assert.equal(await page.locator('#resize-dims').isHidden(), true);
  await page.selectOption('#resize-mode', 'fit');
  assert.equal(await page.locator('#resize-dims').isVisible(), true);
  await page.fill('#resize-width', '800');
  await page.fill('#resize-height', '800');
  await page.setInputFiles('#file', { name: 'wide.png', mimeType: 'image/png', buffer: await makeNoisyPhoto(page, 2000, 1500) });
  await waitForDone(page, 1);
  let { name, bytes } = await downloadRow(page);
  assert.equal(name, 'wide.jpg');
  let s = await stats(page, bytes);
  assert.deepEqual([s.width, s.height], [800, 600]);
  assert.match(await page.locator('#results li .result-meta').textContent(), /2000 × 1500 → 800 × 600 px/);

  // Exact width, empty height: keeps the aspect ratio. Changing the setting re-converts the row.
  await page.selectOption('#resize-mode', 'exact');
  await page.fill('#resize-height', '');
  await page.fill('#resize-width', '300');
  await page.waitForFunction(() => /→ 300 × 225 px/.test(document.querySelector('#results li .result-meta')?.textContent || ''), null, { timeout: 15000 });
  ({ bytes } = await downloadRow(page));
  s = await stats(page, bytes);
  assert.deepEqual([s.width, s.height], [300, 225]);

  // Percentage.
  await page.selectOption('#resize-mode', 'percent');
  await page.fill('#resize-percent', '10');
  await page.waitForFunction(() => /→ 200 × 150 px/.test(document.querySelector('#results li .result-meta')?.textContent || ''), null, { timeout: 15000 });
  await page.close();
});

test('resize: an 8× reduction of 1-px stripes comes out as even grey, not aliased black/white bands', async () => {
  const page = await openPage('/');
  await page.selectOption('#format', 'png');
  await page.selectOption('#resize-mode', 'percent');
  await page.fill('#resize-percent', '12.5');
  // 12.5 is rounded to 13 by the control; use exact width instead for a clean 8×.
  await page.selectOption('#resize-mode', 'exact');
  await page.fill('#resize-width', '256');
  await page.setInputFiles('#file', { name: 'stripes.png', mimeType: 'image/png', buffer: await makeStripes(page, 2048, 256) });
  await waitForDone(page, 1);
  const { bytes } = await downloadRow(page);
  const s = await stats(page, bytes);
  assert.deepEqual([s.width, s.height], [256, 32]);
  assert.ok(Math.abs(s.mean - 128) < 12, `mean grey ${s.mean.toFixed(1)}`);
  assert.ok(s.sd < 12, `grey level spread ${s.sd.toFixed(1)} (aliasing would give ~128)`);
  await page.close();
});

test('max file size: JPG search finds a quality under the limit; an impossible limit shrinks the image and says so', async () => {
  const page = await openPage('/png-to-jpg/');
  assert.equal(await page.locator('#target-kb').isDisabled(), true);
  await page.check('#target-on');
  await page.fill('#target-kb', '150');
  await page.setInputFiles('#file', { name: 'photo.png', mimeType: 'image/png', buffer: await makeNoisyPhoto(page, 1600, 1200) });
  await waitForDone(page, 1);
  let { bytes } = await downloadRow(page);
  assert.ok(bytes.length <= 150 * 1024, `${bytes.length} bytes`);
  let s = await stats(page, bytes);
  const meta = await page.locator('#results li .result-meta').textContent();
  const q = Number(meta.match(/quality (\d+)%/)?.[1]);
  assert.ok(q >= 30 && q < 90, meta);
  // Close to the limit, not far below it (the search keeps the best quality that fits).
  assert.ok(bytes.length > 150 * 1024 * 0.7, `${bytes.length} bytes is far below the limit`);
  assert.deepEqual([s.width, s.height], [1600, 1200], 'quality alone was enough, so the size stays');

  // 20 KB for a 1600×1200 noisy photo needs smaller dimensions.
  await page.fill('#target-kb', '20');
  await page.waitForFunction(() => /→ \d+ × \d+ px/.test(document.querySelector('#results li[data-state="done"] .result-meta')?.textContent || ''), null, { timeout: 30000 });
  ({ bytes } = await downloadRow(page));
  assert.ok(bytes.length <= 20 * 1024, `${bytes.length} bytes`);
  s = await stats(page, bytes);
  assert.ok(s.width < 1600 && s.width > 100 && Math.abs(s.width / s.height - 4 / 3) < 0.02, `${s.width}×${s.height}`);

  // 1 KB: still reachable, by a thumbnail-sized image (a JPEG's headers alone take ~0.6 KB).
  await page.fill('#target-kb', '1');
  await page.waitForFunction(() => /→ \d{1,2} × \d{1,2} px/.test(document.querySelector('#results li[data-state="done"] .result-meta')?.textContent || ''), null, { timeout: 30000 });
  ({ bytes } = await downloadRow(page));
  assert.ok(bytes.length <= 1024, `${bytes.length} bytes`);
  assert.equal(await page.locator('#results li .warn').count(), 0);
  await page.close();
});

test('PNG colours: a 256-colour palette PNG is much smaller than lossless; max file size works for PNG', async () => {
  const page = await openPage('/webp-to-png/');
  await page.setInputFiles('#file', { name: 'photo.png', mimeType: 'image/png', buffer: await makeNoisyPhoto(page, 600, 400) });
  await waitForDone(page, 1);
  const lossless = (await downloadRow(page)).bytes;
  assert.ok([2, 6].includes(pngColourType(lossless)), 'truecolour from the canvas');
  await page.selectOption('#png-colors', '256');
  assert.equal(await page.locator('#dither-control').isVisible(), true);
  await page.waitForFunction(() => /256 colours/.test(document.querySelector('#results li[data-state="done"] .result-meta')?.textContent || ''), null, { timeout: 30000 });
  const palette = (await downloadRow(page)).bytes;
  assert.equal(pngColourType(palette), 3, 'indexed colour');
  assert.ok(palette.length < lossless.length * 0.6, `${palette.length} vs ${lossless.length}`);
  const s = await stats(page, palette);
  assert.deepEqual([s.width, s.height], [600, 400]);

  await page.selectOption('#png-colors', '0');
  await page.check('#target-on');
  await page.fill('#target-kb', '60');
  // Ticking the box already re-converts with the default 100 KB, and the 60 KB conversion follows after a
  // debounce, so wait until the row is idle and its current file is within 60 KB (times out if never).
  // (The page's CSP blocks fetch() of blob: URLs, so read the size the row shows; the bytes are checked below.)
  await page.waitForFunction(() => {
    if (document.querySelector('#results li[data-state="working"], #results li[data-state="queued"]')) return false;
    const m = (document.querySelector('#results li[data-state="done"] .result-meta')?.textContent || '').match(/→ PNG ([\d.]+) (B|KB|MB)/);
    return !!m && (m[2] === 'B' || (m[2] === 'KB' && Number(m[1]) <= 60));
  }, null, { timeout: 30000, polling: 250 });
  const small = (await downloadRow(page)).bytes;
  assert.ok(small.length <= 60 * 1024, `${small.length} bytes`);
  await page.close();
});

test('Max file size is hidden for formats it does not apply to, and resize is hidden for ICO', async () => {
  const page = await openPage('/');
  for (const [fmt, target, resize] of [['jpg', true, true], ['png', true, true], ['webp', true, true], ['pdf', false, true], ['gif', false, true], ['tiff', false, true], ['ico', false, false]]) {
    await page.selectOption('#format', fmt);
    assert.equal(await page.locator('#target-control').isVisible(), target, `${fmt} target`);
    assert.equal(await page.locator('#resize-control').isVisible(), resize, `${fmt} resize`);
    assert.equal(await page.locator('#png-colors-control').isVisible(), fmt === 'png', `${fmt} colours`);
  }
  await page.close();
});

test('Same as original (/compress-image/): JPG stays JPG, PNG stays PNG, and a file that would grow is kept as it was', async () => {
  const page = await openPage('/compress-image/');
  assert.equal(await page.locator('#format').inputValue(), 'same');
  const smallJpeg = await makeNoisyPhoto(page, 800, 600, 'image/jpeg', 0.5);
  const png = await makeNoisyPhoto(page, 400, 300, 'image/png');
  await page.setInputFiles('#file', [
    { name: 'already-small.jpg', mimeType: 'image/jpeg', buffer: smallJpeg },
    { name: 'shot.png', mimeType: 'image/png', buffer: png },
  ]);
  await waitForDone(page, 2);
  const a = await downloadRow(page, 0);
  const b = await downloadRow(page, 1);
  assert.equal(a.name, 'already-small.jpg');
  assert.equal(b.name, 'shot.png');
  const metaA = await page.locator('#results li .result-meta').nth(0).textContent();
  if (/original kept/.test(metaA)) assert.ok(a.bytes.equals(smallJpeg));
  else assert.ok(a.bytes.length < smallJpeg.length, metaA);
  assert.equal(b.bytes.toString('latin1', 1, 4), 'PNG');
  await page.close();
});
