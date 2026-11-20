// Tests for the input-format pages that read files browsers cannot open: camera RAW (raw/cr2/cr3/nef-to-jpg).
//   node --test tests/input-pages.test.mjs
// Builds dist/, serves it on a random localhost port and checks the pages in headless Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { converters, SITE_URL } from '../site/pages.mjs';
import { guides } from '../site/guides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE_PATH = '/save-image-format';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.wasm': 'application/wasm',
};

let server, origin, browser;

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
});

after(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
});

async function open(path) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const resp = await page.goto(origin + path);
  await page.waitForLoadState('networkidle');
  return { page, resp, errors, close: () => context.close() };
}

// Every same-site link on the page resolves to a file in dist/.
async function assertLinksResolve(page, label) {
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.href));
  for (const href of hrefs) {
    const u = new URL(href);
    if (u.origin !== origin) continue;
    const rel = u.pathname.startsWith(`${BASE_PATH}/`) ? u.pathname.slice(BASE_PATH.length) : u.pathname;
    assert.ok(existsSync(join(DIST, rel.endsWith('/') ? `${rel}index.html` : rel)), `${label} links to missing ${u.pathname}`);
  }
}

import { tiffRaw, cr3, raf, withExifOrientation, PREVIEW, losslessJpeg } from './raw-fixtures.mjs';
const RAW_PAGES = ['raw-to-jpg', 'cr2-to-jpg', 'cr3-to-jpg', 'nef-to-jpg'];

async function waitForRows(page, n) {
  await page.waitForFunction((n) => document.querySelectorAll('#results li[data-state="done"], #results li[data-state="error"]').length === n
    && !document.querySelector('#results li[data-state="queued"], #results li[data-state="working"]'), n, { timeout: 20000 });
}

/** Size and RGB at the four quadrant centres of result row `index` (its thumbnail is the output). */
async function resultInfo(page, index) {
  return page.evaluate(async (index) => {
    const img = document.querySelectorAll('#results .thumb')[index];
    await img.decode();
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    const at = (x, y) => [...g.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3);
    return { w, h, q: [at(w / 4, h / 4), at((3 * w) / 4, h / 4), at(w / 4, (3 * h) / 4), at((3 * w) / 4, (3 * h) / 4)] };
  }, index);
}
const RED = [255, 0, 0], LIME = [0, 255, 0], BLUE = [0, 0, 255], WHITE = [255, 255, 255];
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 40);
const file = (name, bytes) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });

test('the RAW pages are built, listed under "From camera RAW" and accept RAW files', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  for (const slug of RAW_PAGES) {
    assert.ok(converters.find((c) => c.slug === slug && c.group === 'raw'), slug);
    assert.ok(sitemap.includes(`${SITE_URL}${slug}/`), `${slug} in sitemap`);
    const { page, resp, errors, close } = await open(`${BASE_PATH}/${slug}/`);
    assert.equal(resp.status(), 200);
    assert.match(await page.locator('#file').getAttribute('accept'), /\.cr2,\.cr3,\.nef/);
    await assertLinksResolve(page, slug);
    assert.deepEqual(errors, [], slug);
    await close();
  }
  const { page, close } = await open(`${BASE_PATH}/guides/`); // "Converters by source format"
  const group = page.locator('.by-source', { hasText: 'From camera RAW' });
  assert.equal(await group.locator('a').count(), RAW_PAGES.length);
  await close();
});

test('nef-to-jpg: the camera JPEG inside a NEF is found, turned upright (orientation 6) and saved as JPG', async () => {
  const { page, errors, close } = await open(`${BASE_PATH}/nef-to-jpg/`);
  await page.setInputFiles('#file', file('DSC_0001.NEF', tiffRaw({ orientation: 6 })));
  await waitForRows(page, 1);
  const row = page.locator('#results li').first();
  assert.equal(await row.getAttribute('data-state'), 'done', await row.textContent());
  assert.match(await row.textContent(), /NEF .* → JPG .*48 × 64 px · from the camera’s built-in 48 × 64 JPEG/);
  assert.equal(await row.locator('a.btn').getAttribute('download'), 'DSC_0001.jpg');
  const r = await resultInfo(page, 0);
  assert.deepEqual([r.w, r.h], [48, 64]);
  // Stored red|lime over blue|white, turned 90° clockwise: blue|red over white|lime.
  [BLUE, RED, WHITE, LIME].forEach((rgb, i) => assert.ok(near(r.q[i], rgb), `quadrant ${i}: ${r.q[i]} ≈ ${rgb}`));
  assert.deepEqual(errors, []);
  await close();
});

test('raw-to-jpg: CR2 (one row, not TIFF pages), CR3, RAF with its own EXIF rotation, big-endian DNG; no preview → error row', async () => {
  const { page, close } = await open(`${BASE_PATH}/raw-to-jpg/`);
  const noPreview = new Uint8Array([...tiffRaw({ preview: null }).subarray(0, 26), ...losslessJpeg()]);
  await page.setInputFiles('#file', [
    file('IMG_0001.CR2', tiffRaw({ cr2: true })),
    file('IMG_0002.CR3', cr3({ orientation: 8 })),
    file('DSCF0003.RAF', raf({ preview: withExifOrientation(PREVIEW, 6) })),
    file('IMG_0004.DNG', tiffRaw({ le: false, orientation: 3 })),
    file('broken.dng', noPreview),
  ]);
  await waitForRows(page, 5);
  const states = await page.locator('#results li').evaluateAll((lis) => lis.map((li) => li.dataset.state));
  assert.deepEqual(states, ['done', 'done', 'done', 'done', 'error']);
  const cr2 = await resultInfo(page, 0);
  assert.deepEqual([cr2.w, cr2.h], [64, 48]);
  [RED, LIME, BLUE, WHITE].forEach((rgb, i) => assert.ok(near(cr2.q[i], rgb), `CR2 quadrant ${i}: ${cr2.q[i]}`));
  const cr3r = await resultInfo(page, 1); // orientation 8 = 90° counter-clockwise: lime|white over red|blue
  assert.deepEqual([cr3r.w, cr3r.h], [48, 64]);
  [LIME, WHITE, RED, BLUE].forEach((rgb, i) => assert.ok(near(cr3r.q[i], rgb), `CR3 quadrant ${i}: ${cr3r.q[i]}`));
  const rafr = await resultInfo(page, 2); // the JPEG's own EXIF 6, applied once
  assert.deepEqual([rafr.w, rafr.h], [48, 64]);
  [BLUE, RED, WHITE, LIME].forEach((rgb, i) => assert.ok(near(rafr.q[i], rgb), `RAF quadrant ${i}: ${rafr.q[i]}`));
  const dng = await resultInfo(page, 3); // orientation 3 = 180°: white|blue over lime|red
  [WHITE, BLUE, LIME, RED].forEach((rgb, i) => assert.ok(near(dng.q[i], rgb), `DNG quadrant ${i}: ${dng.q[i]}`));
  assert.match(await page.locator('#results li').nth(4).textContent(), /no embedded JPEG preview/);
  await close();
});
