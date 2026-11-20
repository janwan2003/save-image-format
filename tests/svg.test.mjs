// Tests for SVG output: the vector tracer (extension/lib/trace.js) and the png-to-svg,
// jpg-to-svg and image-to-svg pages.
//   node --test tests/svg.test.mjs
// Unit tests run in Node; accuracy is measured by rendering the traced SVG back in headless
// Chromium and comparing it with the source pixels. Page tests build dist/ and convert real files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { traceImage, otsu } from '../extension/lib/trace.js';
import { converters, SITE_URL } from '../site/pages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE_PATH = '/save-image-format';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.wasm': 'application/wasm',
};
const PAGES = ['png-to-svg', 'jpg-to-svg', 'image-to-svg'];

let server, origin, browser, scratch;

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
  scratch = await browser.newPage();
});

after(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
});

// ---- helpers --------------------------------------------------------------------------------

/** RGBA pixels of a w×h picture drawn by `draw` (a function source run in the page). */
async function drawPixels(w, h, draw) {
  const data = await scratch.evaluate(([w, h, src]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    new Function('g', 'w', 'h', src)(g, w, h);
    return Array.from(g.getImageData(0, 0, w, h).data);
  }, [w, h, draw]);
  return Uint8ClampedArray.from(data);
}

/** Render an SVG string at w×h over a colour (default: transparent) and return its RGBA. */
async function renderSvg(svg, w, h, under = null) {
  const data = await scratch.evaluate(async ([svg, w, h, under]) => {
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await img.decode();
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (under) { g.fillStyle = under; g.fillRect(0, 0, w, h); }
    g.drawImage(img, 0, 0, w, h);
    return Array.from(g.getImageData(0, 0, w, h).data);
  }, [svg, w, h, under]);
  return Uint8ClampedArray.from(data);
}

/** Share of pixels whose RGB differs by more than `limit` in some channel. */
function badShare(a, b, limit = 80) {
  let bad = 0;
  const n = a.length / 4;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (Math.max(Math.abs(a[p] - b[p]), Math.abs(a[p + 1] - b[p + 1]), Math.abs(a[p + 2] - b[p + 2])) > limit) bad++;
  }
  return bad / n;
}

const LOGO = `
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e63946'; g.beginPath(); g.arc(100, 110, 70, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#1d3557'; g.fillRect(200, 40, 150, 100);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(275, 90, 30, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2a9d8f'; g.beginPath(); g.moveTo(220, 280); g.lineTo(380, 280); g.lineTo(300, 160); g.closePath(); g.fill();
  g.fillStyle = '#111'; g.font = 'bold 44px sans-serif'; g.fillText('Saveform', 20, 260);`;

// ---- tracer unit tests ------------------------------------------------------------------------

test('traceImage: a square with a hole gives two exact-colour layers of paths, no bitmap', () => {
  const w = 20, h = 20, rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    const inSquare = x >= 4 && x < 16 && y >= 4 && y < 16, inHole = x >= 8 && x < 12 && y >= 8 && y < 12;
    const c = inSquare && !inHole ? [10, 20, 200] : [255, 255, 255];
    rgba.set([...c, 255], p);
  }
  const r = traceImage(rgba, w, h, { colors: 8, detail: 'high' });
  assert.equal(r.colors, 2);
  assert.equal(r.layers, 2);
  assert.match(r.svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="20" height="20" viewBox="0 0 20 20">/);
  assert.doesNotMatch(r.svg, /<image|base64/);
  const fills = [...r.svg.matchAll(/fill="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  assert.deepEqual(fills, ['#ffffff', '#0a14c8'], 'largest colour first, exact colours kept');
  // The blue layer is the square outline plus the hole's outline: two subpaths, sharp corners.
  const blue = r.svg.split('\n').find((l) => l.includes('#0a14c8'));
  assert.equal(blue.match(/M/g).length, 2);
  assert.match(blue, /L4 4|L16 4|L16 16|L4 16/, 'square corners restored exactly');
});

test('traceImage: transparent pixels are left out; black and white makes one black layer', () => {
  const w = 30, h = 30, rgba = new Uint8ClampedArray(w * h * 4); // all transparent
  for (let y = 5; y < 25; y++) for (let x = 5; x < 25; x++) rgba.set([200, 30, 30, 255], (y * w + x) * 4);
  const r = traceImage(rgba, w, h, { colors: 4 });
  assert.equal(r.colors, 1, 'transparent area is not a colour');
  assert.equal(r.paths, 1);
  const bw = traceImage(rgba, w, h, { colors: 'bw', outWidth: 300, outHeight: 300 });
  assert.equal(bw.layers, 1);
  assert.match(bw.svg, /fill="#000000"/);
  assert.match(bw.svg, /width="300" height="300" viewBox="0 0 30 30"/);
  const empty = traceImage(new Uint8ClampedArray(16), 2, 2, { colors: 8 });
  assert.equal(empty.paths, 0);
  assert.throws(() => traceImage(new Uint8ClampedArray(10), 2, 2), /bytes/);
  assert.throws(() => traceImage(new Uint8ClampedArray(0), 0, 2), /whole numbers/);
});

test('otsu picks a threshold between two brightness peaks', () => {
  const hist = new Float64Array(256);
  hist[40] = 500; hist[45] = 300; hist[210] = 700; hist[220] = 100;
  const t = otsu(hist, 1600);
  assert.ok(t >= 45 && t < 210, `threshold ${t}`);
});

test('specks smaller than the speckle size are merged away', () => {
  const w = 200, h = 200, rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let k = 0; k < 30; k++) { // 30 single dark pixels (JPEG-noise-like)
    const x = 7 + ((k * 37) % 186), y = 5 + ((k * 53) % 190);
    rgba.set([0, 0, 0, 255], (y * w + x) * 4);
  }
  for (let y = 50; y < 150; y++) for (let x = 50; x < 150; x++) rgba.set([0, 0, 0, 255], (y * w + x) * 4);
  const r = traceImage(rgba, w, h, { colors: 'bw' });
  assert.equal(r.paths, 1, 'only the big square survives');
});

test('a traced logo renders back within 1% of the source in every mode; no seams between colours', async () => {
  const w = 400, h = 300;
  const src = await drawPixels(w, h, LOGO);
  for (const [colors, detail, limit] of [[8, 'normal', 0.01], [4, 'high', 0.01], [16, 'low', 0.012], [32, 'normal', 0.01]]) {
    const r = traceImage(src, w, h, { colors, detail });
    const back = await renderSvg(r.svg, w, h, '#ff00ff'); // magenta shows through any gap
    const share = badShare(src, back);
    assert.ok(share <= limit, `${colors} colours, ${detail}: ${(share * 100).toFixed(2)}% of pixels off`);
    let magenta = 0;
    for (let p = 0; p < back.length; p += 4) if (back[p] > 200 && back[p + 1] < 60 && back[p + 2] > 200) magenta++;
    assert.equal(magenta, 0, `${colors} colours: background shows through ${magenta} pixels`);
  }
});

test('black and white keeps the dark shapes and leaves the rest transparent', async () => {
  const w = 400, h = 300;
  const src = await drawPixels(w, h, LOGO);
  const r = traceImage(src, w, h, { colors: 'bw' });
  const back = await renderSvg(r.svg, w, h);
  // Very dark source pixels (text, navy) must be solid, very light ones (background) transparent;
  // only anti-aliased edges may differ. The red and teal shapes are mid-grey: either is fine.
  let dark = 0, darkOff = 0, light = 0, lightOff = 0;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4, y = 0.2126 * src[p] + 0.7152 * src[p + 1] + 0.0722 * src[p + 2];
    if (y < 60) { dark++; if (back[p + 3] < 128) darkOff++; }
    if (y > 200) { light++; if (back[p + 3] >= 128) lightOff++; }
  }
  assert.ok(dark > 5000 && light > 50000);
  assert.ok(darkOff / dark < 0.02, `${darkOff} of ${dark} dark pixels not covered`);
  assert.ok(lightOff / light < 0.01, `${lightOff} of ${light} light pixels covered`);
  const at = (x, y) => back[(y * w + x) * 4 + 3];
  assert.equal(at(5, 5), 0, 'background transparent');
  assert.equal(at(220, 60), 255, 'navy rectangle is black');
  assert.equal(at(275, 90), 0, 'the hole in the rectangle stays open');
});

test('a 600×400 photo-like gradient traces in under 3 s', async () => {
  const w = 600, h = 400;
  const src = await drawPixels(w, h, `
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0b3d91'); gr.addColorStop(0.5, '#f4a261'); gr.addColorStop(1, '#2a9d8f');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) { g.fillStyle = 'hsl(' + (i * 37) % 360 + ',70%,50%)'; g.beginPath(); g.arc((i * 97) % w, (i * 61) % h, 10 + (i % 7) * 6, 0, 7); g.fill(); }`);
  const t0 = performance.now();
  const r = traceImage(src, w, h, { colors: 16 });
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `${ms.toFixed(0)} ms`);
  assert.ok(r.colors >= 8 && r.paths > 10);
  const back = await renderSvg(r.svg, w, h);
  assert.ok(badShare(src, back, 100) < 0.05, 'photo-like picture stays recognisable');
});

// ---- pages ----------------------------------------------------------------------------------

async function open(path) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  const external = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.hostname !== '127.0.0.1') external.push(r.url()); });
  const resp = await page.goto(origin + BASE_PATH + path);
  return { page, resp, errors, external, close: () => context.close() };
}

async function fixture(page, mime, w, h, draw) {
  const bytes = await page.evaluate(async ([mime, w, h, src]) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    new Function('g', 'w', 'h', src)(c.getContext('2d'), w, h);
    const blob = await new Promise((r) => c.toBlob(r, mime, 0.85));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, [mime, w, h, draw]);
  return Buffer.from(bytes);
}

async function waitForDone(page, n) {
  await page.waitForFunction((n) => document.querySelectorAll('#results li[data-state="done"]').length === n
    && !document.querySelector('#results li[data-state="queued"], #results li[data-state="working"]'), n, { timeout: 20000 });
}

async function downloadRow(page, index = 0) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#results li a[download]').nth(index).click()]);
  return { name: dl.suggestedFilename(), text: (await readFile(await dl.path())).toString('utf8') };
}

test('the SVG pages have their own title, h1, canonical and sitemap entry, with tracing controls', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  for (const slug of PAGES) {
    const e = converters.find((c) => c.slug === slug);
    assert.ok(e, slug);
    assert.equal(e.to, 'svg');
    assert.ok(e.title.length <= 65, `${slug} title ${e.title.length} chars`);
    assert.ok(e.description.length >= 80 && e.description.length <= 160, `${slug} description ${e.description.length} chars`);
    assert.ok(sitemap.includes(`<loc>${SITE_URL}${slug}/</loc>`), `${slug} in sitemap`);
    const { page, resp, errors, close } = await open(`/${slug}/`);
    assert.equal(resp.status(), 200);
    assert.equal(await page.locator('h1').textContent(), e.h1);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), `${SITE_URL}${slug}/`);
    assert.equal(await page.locator('#format').inputValue(), 'svg');
    assert.ok(await page.locator('#trace-control').isVisible(), 'tracing controls shown');
    assert.ok(await page.locator('#trace-detail-control').isVisible(), 'detail control shown');
    assert.equal(await page.locator('#trace-colors').inputValue(), String(e.traceColors));
    for (const id of ['#quality-control', '#bg-control', '#png-colors-control', '#dither-control']) {
      assert.equal(await page.locator(id).isVisible(), false, `${id} hidden for SVG`);
    }
    assert.deepEqual(errors, []);
    await close();
  }
});

test('png-to-svg traces a transparent PNG into paths; Black and white re-traces into one black shape', async () => {
  const { page, errors, external, close } = await open('/png-to-svg/');
  const png = await fixture(page, 'image/png', 240, 160, `
    g.fillStyle = '#ff7f00'; g.beginPath(); g.arc(70, 80, 50, 0, 7); g.fill();
    g.fillStyle = '#123456'; g.fillRect(140, 30, 80, 100);`);
  await page.setInputFiles('#file', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await waitForDone(page, 1);
  const meta = await page.locator('#results li .result-meta').first().textContent();
  assert.match(meta, /PNG .* → SVG .*240 × 160 px.*2 colours, 3 shapes/); // the bottom layer outlines both shapes (stacking)
  const out = await downloadRow(page);
  assert.equal(out.name, 'logo.svg');
  assert.match(out.text, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="240" height="160"/);
  assert.doesNotMatch(out.text, /<image|base64/);
  assert.equal((out.text.match(/<path /g) || []).length, 2, "one path per colour");
  const back = await renderSvg(out.text, 240, 160);
  const px = (x, y) => [...back.subarray((y * 240 + x) * 4, (y * 240 + x) * 4 + 4)];
  assert.deepEqual(px(70, 80), [255, 127, 0, 255]);
  assert.deepEqual(px(180, 80), [0x12, 0x34, 0x56, 255]);
  assert.equal(px(5, 5)[3], 0, 'transparent corner stays transparent');

  await page.selectOption('#trace-colors', 'bw');
  await page.waitForFunction(() => /1 colour,/.test(document.querySelector('#results li .result-meta')?.textContent || ''), null, { timeout: 15000 });
  const bw = await downloadRow(page);
  assert.equal((bw.text.match(/<path /g) || []).length, 1);
  assert.match(bw.text, /fill="#000000"/);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await close();
});

test('jpg-to-svg cleans JPEG noise; image-to-svg takes a WebP and traces large images at 2000 px', async () => {
  let { page, errors, close } = await open('/jpg-to-svg/');
  const jpg = await fixture(page, 'image/jpeg', 300, 200, `
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#c00'; g.font = 'bold 90px sans-serif'; g.fillText('SF', 60, 140);`);
  await page.setInputFiles('#file', { name: 'scan.jpg', mimeType: 'image/jpeg', buffer: jpg });
  await waitForDone(page, 1);
  const out = await downloadRow(page);
  assert.equal(out.name, 'scan.svg');
  const layers = out.text.match(/<path /g).length;
  assert.ok(layers <= 4, `${layers} layers`);
  const subpaths = (out.text.match(/M/g) || []).length;
  assert.ok(subpaths <= 12, `JPEG noise traced into ${subpaths} subpaths`); // white box, S, F (+ few)
  assert.deepEqual(errors, []);
  await close();

  ({ page, errors, close } = await open('/image-to-svg/'));
  const webp = await fixture(page, 'image/webp', 3000, 1000, `
    g.fillStyle = '#0a0'; g.fillRect(300, 200, 2400, 600);`);
  await page.setInputFiles('#file', { name: 'banner.webp', mimeType: 'image/webp', buffer: webp });
  await waitForDone(page, 1);
  const meta = await page.locator('#results li .result-meta').first().textContent();
  assert.match(meta, /WebP .* → SVG .*3000 × 1000 px.*traced at 2000 × 667 px/);
  const big = await downloadRow(page);
  assert.match(big.text, /width="3000" height="1000" viewBox="0 0 2000 667"/);
  assert.deepEqual(errors, []);
  await close();
});

test('the general converter offers SVG and shows the tracing controls only for it', async () => {
  const { page, close } = await open('/');
  assert.equal(await page.locator('#trace-control').isVisible(), false);
  await page.selectOption('#format', 'svg');
  assert.ok(await page.locator('#trace-control').isVisible());
  assert.equal(await page.locator('#quality-control').isVisible(), false);
  await page.selectOption('#format', 'png');
  assert.equal(await page.locator('#trace-control').isVisible(), false);
  await close();
});
