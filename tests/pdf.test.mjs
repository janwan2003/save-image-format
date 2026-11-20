// PDF input on the converter pages (session 11): every page of a PDF becomes a row, drawn by the
// vendored PDF.js and compared with poppler's pdftoppm where it is installed.
//   node --test tests/pdf.test.mjs
// Builds dist/, serves it on a random localhost port and drives the pages in headless Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import '../site/assets/tiff.js'; // globalThis.SaveformTiff, to read back TIFF output

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE_PATH = '/save-image-format';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.mjs': 'text/javascript', '.xml': 'application/xml', '.txt': 'text/plain', '.wasm': 'application/wasm',
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

const FIX = join(ROOT, 'tests/fixtures');
const hasPdftoppm = (() => { try { execFileSync('pdftoppm', ['-v'], { stdio: 'pipe' }); return true; } catch { return false; } })();

async function waitForDone(page, n, timeout = 30000) {
  await page.waitForFunction((n) => document.querySelectorAll('#results li[data-state="done"]').length === n
    && !document.querySelector('#results li[data-state="queued"], #results li[data-state="working"]'), n, { timeout });
}

async function downloadRow(page, index = 0) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#results li[data-state="done"] a.btn').nth(index).click()]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

async function downloadButton(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

/** Decode an image in the page: { width, height, data: RGBA array }. */
async function pixels(page, bytes) {
  return page.evaluate(async (arr) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(arr)]));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return { width: bmp.width, height: bmp.height, data: [...g.getImageData(0, 0, bmp.width, bmp.height).data] };
  }, [...bytes]);
}

const at = (img, x, y) => img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3);
const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('pdf-to-png: each page becomes a row at 150 dpi, rotation applied, standard font drawn, matches poppler', async () => {
  const page = await openPage('/pdf-to-png/');
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  assert.equal(await page.locator('#pdf-dpi-control').isVisible(), true, 'resolution shown on a PDF page');
  assert.equal(await page.locator('#pdf-dpi').inputValue(), '150');
  assert.match(await page.getAttribute('#file', 'accept'), /\.pdf/);
  assert.ok(!requests.some((u) => u.includes('/vendor/pdfjs/')), 'PDF.js is not loaded before a PDF is added');

  await page.setInputFiles('#file', join(FIX, 'pages.pdf'));
  await waitForDone(page, 2);
  const names = await page.locator('#results .result-name').allTextContents();
  assert.deepEqual(names, ['pages-page-1.png', 'pages-page-2.png']);
  assert.match(await page.locator('#results .result-meta').first().textContent(), /^PDF page 1 → PNG .* · 1240 × 1754 px/);

  const p1 = await pixels(page, (await downloadRow(page, 0)).bytes);
  const p2 = await pixels(page, (await downloadRow(page, 1)).bytes);
  assert.deepEqual([p1.width, p1.height], [1240, 1754], 'A4 at 150 dpi');
  assert.deepEqual([p2.width, p2.height], [1650, 1275], 'US Letter rotated 90°');
  assert.ok(near(at(p1, 300, 400), [255, 0, 0], 2), `top-left red: ${at(p1, 300, 400)}`);
  assert.ok(near(at(p1, 940, 1300), [0, 153, 0], 2), `bottom-right green: ${at(p1, 940, 1300)}`);
  assert.ok(near(at(p1, 300, 1300), [255, 255, 255], 0), 'bottom-left is white page background');
  assert.ok(near(at(p2, 200, 200), [0, 0, 255], 2), `rotated page: blue square now top-left: ${at(p2, 200, 200)}`);
  assert.ok(near(at(p2, 200, 1100), [255, 255, 255], 0), 'rotated page: bottom-left white');
  // "Saveform" in Helvetica (not embedded) at x 330 pt, baseline 142 pt from the top: dark pixels must be there.
  let dark = 0;
  for (let y = Math.round(100 * 150 / 72); y < Math.round(150 * 150 / 72); y++) {
    for (let x = Math.round(330 * 150 / 72); x < Math.round(560 * 150 / 72); x++) if (at(p1, x, y)[0] < 80) dark++;
  }
  assert.ok(dark > 2000, `text drawn (${dark} dark pixels)`);
  assert.ok(requests.some((u) => /\/vendor\/pdfjs\/standard_fonts\//.test(u)), 'the non-embedded font was loaded from this site');
  assert.ok(requests.every((u) => u.startsWith(origin) || u.startsWith('blob:') || u.startsWith('data:')), `only own origin: ${requests.filter((u) => !u.startsWith(origin))}`);

  if (hasPdftoppm) {
    const dir = await mkdtemp(join(tmpdir(), 'saveform-pdf-'));
    try {
      execFileSync('pdftoppm', ['-r', '150', '-png', join(FIX, 'pages.pdf'), join(dir, 'ref')]);
      for (const [k, ours] of [[1, p1], [2, p2]]) {
        const ref = await pixels(page, await readFile(join(dir, `ref-${k}.png`)));
        // poppler rounds sizes up (1240 × 1755); compare the common area.
        let sum = 0, n = 0;
        for (let y = 0; y < Math.min(ours.height, ref.height); y += 2) {
          for (let x = 0; x < Math.min(ours.width, ref.width); x += 2) {
            const a = at(ours, x, y), b = at(ref, x, y);
            sum += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); n += 3;
          }
        }
        assert.ok(sum / n < 2, `page ${k}: mean difference from poppler ${(sum / n).toFixed(2)} / 255`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  // Changing the resolution redraws the pages.
  await page.selectOption('#pdf-dpi', '72');
  await page.waitForFunction(() => /595 × 842 px/.test(document.querySelector('#results li .result-meta')?.textContent || ''), null, { timeout: 15000 });
  await waitForDone(page, 2);
  const small = await pixels(page, (await downloadRow(page, 1)).bytes);
  assert.deepEqual([small.width, small.height], [792, 612]);
  await page.close();
});

test('pdf-to-jpg: password-protected and broken PDFs show clear errors; pages go into a ZIP', async () => {
  const page = await openPage('/pdf-to-jpg/');
  await page.setInputFiles('#file', [join(FIX, 'locked.pdf'), join(FIX, 'not-a-pdf.pdf'), join(FIX, 'pages.pdf')]);
  await page.waitForFunction(() => document.querySelectorAll('#results li[data-state="error"]').length === 2
    && document.querySelectorAll('#results li[data-state="done"]').length === 2, null, { timeout: 30000 });
  const errors = await page.locator('#results li[data-state="error"] .result-meta').allTextContents();
  assert.match(errors[0], /protected by a password/);
  assert.match(errors[1], /not a valid PDF|could not be read/);
  const { name, bytes } = await downloadButton(page, '#download-all');
  assert.equal(name, 'saveform-jpg-images.zip');
  const entries = [];
  for (let i = 0; i + 30 < bytes.length; i++) {
    if (bytes.readUInt32LE(i) === 0x02014b50) entries.push(bytes.subarray(i + 46, i + 46 + bytes.readUInt16LE(i + 28)).toString());
  }
  assert.deepEqual(entries, ['pages-page-1.jpg', 'pages-page-2.jpg']);
  await page.close();
});

test('pdf-to-tiff: Download one TIFF joins the PDF pages; the general converter takes a PDF and shows the resolution', async () => {
  let page = await openPage('/pdf-to-tiff/');
  await page.selectOption('#pdf-dpi', '72');
  await page.setInputFiles('#file', join(FIX, 'pages.pdf'));
  await waitForDone(page, 2);
  const { name, bytes } = await downloadButton(page, '#download-tiff');
  assert.equal(name, 'pages-page-1-and-1-more.tif');
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  assert.equal(globalThis.SaveformTiff.pages(buf), 2);
  const t1 = await globalThis.SaveformTiff.decode(buf.slice(0), 0), t2 = await globalThis.SaveformTiff.decode(buf.slice(0), 1);
  assert.deepEqual([t1.width, t1.height, t2.width, t2.height], [595, 842, 792, 612]);
  await page.close();

  page = await openPage('/');
  assert.equal(await page.locator('#pdf-dpi-control').isVisible(), false, 'hidden until a PDF is added');
  await page.selectOption('#format', 'jpg');
  await page.setInputFiles('#file', join(FIX, 'pages.pdf'));
  await waitForDone(page, 2);
  assert.equal(await page.locator('#pdf-dpi-control').isVisible(), true);
  await page.click('#clear');
  assert.equal(await page.locator('#pdf-dpi-control').isVisible(), false, 'hidden again after Clear');
  await page.close();
});
