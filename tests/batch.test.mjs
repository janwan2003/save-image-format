// "Save all images on this page" (toolbar popup + background batch) in real Chromium.
// The toolbar click grants activeTab; the test stands in for it with host access to the page's
// origin (127.0.0.1) in a temporary manifest copy, as tests/extension.test.mjs does. The CDN
// origin (localhost:<port>) gets no access, so its non-CORS image exercises the "allow sites" step.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { inspectPdf } from './pdf-inspect.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let server, cdn, pagePort, cdnPort, context, sw, page, tmp, extId;
const fixtures = {};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#2563eb"/></svg>';

function handler(req, res) {
  const port = Number(req.headers.host.split(':')[1]);
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/gallery.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Gallery</title><body>
      <img id="a" src="/img/one.webp" alt="one">
      <img id="b" src="http://localhost:${cdnPort}/cors/two.webp">
      <img id="c" src="http://localhost:${cdnPort}/nocors/three.webp">
      <img id="d" src="/img/small.webp" srcset="/img/small.webp 200w, /img/big,crop.webp 800w, /img/mid.webp 400w" sizes="100px">
      <img id="e" src="/img/logo.svg">
      <img id="tiny" src="/img/pixel.webp">
      <div id="hero" style="width:300px;height:100px;background-image:url('/img/hero.webp')"></div>
    </body>`);
    return;
  }
  if (url.pathname === '/lazy.html') {
    // Lazy-loading patterns: placeholders in src, the real address in data-* attributes.
    const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const svg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'/%3E";
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><title>Lazy</title><body>
      <img id="real" src="/img/one.webp" alt="loaded">
      <img id="ds" src="${gif}" data-src="/img/lazy-one.webp" width="320" height="240" alt="data-src">
      <img id="dss" src="${gif}" data-srcset="/img/lz-s.webp 300w, /img/lz-l.webp 1200w, /img/lz-m.webp 600w">
      <picture id="pic">
        <source type="image/avif" data-srcset="/img/pic-s.avif 400w, /img/pic-l.avif 1600w">
        <source type="image/webp" data-srcset="/img/pic-m.webp 900w">
        <img src="${svg}" data-src="/img/pic-fallback.jpg" alt="picture">
      </picture>
      <img id="icon" src="${gif}" data-original="/img/icon.webp" width="40" height="40">
      <img id="unknown" src="" data-src="/img/unknown.webp">
      <img id="empty" src="" alt="no address, no lazy attribute">
      <img id="lss" src="${gif}" data-lazy-srcset="/img/ls-1x.webp 1x, /img/ls-2x.webp 2x">
      <img id="dup1" src="${gif}" data-lazy-src="/img/one.webp">
      <img id="dup2" data-lazy="/img/lazy-one.webp">
      <div style="height:6000px"></div>
      <img id="below" loading="lazy" src="/img/below.webp" width="500" height="300" alt="below the fold">
    </body>`);
    return;
  }
  const f = fixtures[url.pathname.split('/').pop()];
  if (!f) { res.writeHead(404); res.end(); return; }
  const headers = { 'content-type': f.type };
  if (port === cdnPort && url.pathname.startsWith('/cors/')) headers['access-control-allow-origin'] = '*';
  res.writeHead(200, headers);
  res.end(f.body);
}

before(async () => {
  server = http.createServer(handler);
  cdn = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => cdn.listen(0, '127.0.0.1', r));
  pagePort = server.address().port;
  cdnPort = cdn.address().port;

  tmp = await mkdtemp(path.join(tmpdir(), 'saveform-batch-'));
  const ext = path.join(tmp, 'ext');
  await cp(path.join(ROOT, 'extension'), ext, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
  await mkdir(path.join(tmp, 'dl'));
  context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: path.join(tmp, 'dl'),
    viewport: { width: 600, height: 640 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  extId = new URL(sw.url()).host;
  page = await context.newPage();
  await page.goto('about:blank');
  const make = (w, h, color) => page.evaluate(async ({ w, h, color }) => {
    const c = new OffscreenCanvas(w, h); const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/webp', quality: 1 })).arrayBuffer()));
  }, { w, h, color });
  const webp = async (name, w, h, color) => { fixtures[name] = { body: Buffer.from(await make(w, h, color)), type: 'image/webp' }; };
  await webp('one.webp', 160, 120, '#16a34a');
  await webp('two.webp', 200, 100, '#dc2626');
  await webp('three.webp', 140, 140, '#9333ea');
  await webp('small.webp', 200, 150, '#000000');
  await webp('mid.webp', 400, 300, '#444444');
  await webp('big,crop.webp', 800, 600, '#888888');
  await webp('pixel.webp', 1, 1, '#ffffff');
  await webp('hero.webp', 300, 100, '#f59e0b');
  fixtures['logo.svg'] = { body: Buffer.from(SVG), type: 'image/svg+xml' };
  await page.goto(`http://127.0.0.1:${pagePort}/gallery.html`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await sw.evaluate(() => chrome.storage.sync.set({ askWhere: false }));
});

after(async () => {
  await context?.close();
  server?.close(); cdn?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

const tabId = () => sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, `http://127.0.0.1:${pagePort}/gallery.html`);

async function collect() {
  return sw.evaluate(async (id) => {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: id }, func: globalThis.saveform.collectPageImages });
    return result;
  }, await tabId());
}

async function runBatch(request, { expectPermission = false, skip = true } = {}) {
  const id = await tabId();
  const started = await sw.evaluate((req) => globalThis.saveform.startBatch(req), { ...request, tabId: id, pageUrl: `http://127.0.0.1:${pagePort}/gallery.html` });
  assert.equal(started.ok, true, JSON.stringify(started));
  const waitFor = (statuses) => sw.evaluate(async (statuses) => {
    for (let i = 0; i < 400; i++) {
      const s = globalThis.saveform.batchState();
      if (statuses.includes(s.status)) return s;
      await new Promise((r) => setTimeout(r, 25));
    }
    return globalThis.saveform.batchState();
  }, statuses);
  let state = await waitFor(['needs-permission', 'done', 'error']);
  if (expectPermission) {
    assert.equal(state.status, 'needs-permission', JSON.stringify(state));
    assert.deepEqual(state.origins, [`http://localhost:${cdnPort}/*`]);
    await sw.evaluate((skip) => globalThis.saveform.continueBatch({ skip }), skip);
    state = await waitFor(['done', 'error']);
  }
  assert.equal(state.status, 'done', JSON.stringify(state));
  return state;
}

// Playwright stores downloads under GUID names, so files are found by download id.
async function downloadedFiles(state) {
  const items = await sw.evaluate(async (ids) => {
    const out = [];
    for (const id of ids) {
      for (let i = 0; i < 200; i++) {
        const [d] = await chrome.downloads.search({ id });
        if (d && d.state !== 'in_progress') { out.push(d); break; }
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    return out;
  }, state.downloadIds);
  assert.equal(items.length, state.downloadIds.length);
  for (const d of items) assert.equal(d.state, 'complete', `${d.state} ${d.error || ''}`);
  return Promise.all(items.map(async (d) => ({ item: d, buf: await readFile(d.filename) })));
}

// Reads a ZIP of stored (uncompressed) entries, as written by extension/lib/zip.js.
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const localNameLen = buf.readUInt16LE(local + 26), extra = buf.readUInt16LE(local + 28);
    const dataAt = local + 30 + localNameLen + extra;
    entries.push({ name, data: buf.subarray(dataAt, dataAt + size) });
    p += 46 + nameLen;
  }
  return entries;
}

async function dims(bytes) {
  return page.evaluate(async (arr) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(arr)]));
    return [bmp.width, bmp.height];
  }, Array.from(bytes));
}

test('collects <img>, the largest srcset candidate, SVG and CSS backgrounds', async () => {
  const r = await collect();
  assert.equal(r.title, 'Gallery');
  const by = (end) => r.images.find((x) => x.src.endsWith(end));
  assert.deepEqual([by('/one.webp').width, by('/one.webp').height], [160, 120]);
  assert.ok(by('/two.webp') && by('/three.webp') && by('/logo.svg'));
  const big = by('/big,crop.webp');
  assert.ok(big, `largest srcset candidate chosen (URL with a comma): ${JSON.stringify(r.images.map((x) => x.src))}`);
  assert.equal(big.width, 800);
  assert.ok(!by('/small.webp') && !by('/mid.webp'), 'only one entry for the srcset image');
  assert.equal(by('/hero.webp').kind, 'background');
  assert.deepEqual([by('/pixel.webp').width, by('/pixel.webp').height], [1, 1]);
});

async function openLazyPage() {
  const p = await context.newPage();
  await p.goto(`http://127.0.0.1:${pagePort}/lazy.html`);
  const id = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, `http://127.0.0.1:${pagePort}/lazy.html`);
  return { p, id };
}

test('collects lazy-loaded images that have not loaded yet (data-src, data-srcset, picture, loading=lazy)', async () => {
  const { p, id } = await openLazyPage();
  try {
    // The scenario is real: the loading=lazy image below the fold has not been fetched.
    assert.equal(await p.evaluate(() => document.getElementById('below').currentSrc), '');
    const r = await sw.evaluate(async (id) => {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: id }, func: globalThis.saveform.collectPageImages });
      return result;
    }, id);
    const srcs = r.images.map((x) => x.src);
    const by = (end) => r.images.filter((x) => x.src.endsWith(end));
    const one = (end) => { const m = by(end); assert.equal(m.length, 1, `${end} once in ${JSON.stringify(srcs)}`); return m[0]; };
    const size = (end) => { const x = one(end); return [x.width, x.height]; };
    assert.ok(!srcs.some((s) => s.startsWith('data:')), `no data: placeholders: ${JSON.stringify(srcs)}`);
    assert.ok(!srcs.some((s) => s.endsWith('/lazy.html')), 'src="" is not listed as the page address');
    // Loaded image and a lazy duplicate of it (data-lazy-src): listed once, with the decoded size.
    assert.deepEqual(size('/img/one.webp'), [160, 120]);
    // data-src behind a data: GIF; size from the width/height attributes. data-lazy duplicate: once.
    assert.deepEqual(size('/img/lazy-one.webp'), [320, 240]);
    assert.equal(one('/img/lazy-one.webp').alt, 'data-src');
    // data-srcset: largest w candidate only.
    assert.deepEqual(size('/img/lz-l.webp'), [1200, 0]);
    assert.ok(!by('/lz-s.webp').length && !by('/lz-m.webp').length);
    // <picture>: largest candidate across the sources (AVIF is fine), not the img's own fallback.
    assert.deepEqual(size('/img/pic-l.avif'), [1600, 0]);
    assert.ok(!by('/pic-s.avif').length && !by('/pic-m.webp').length && !by('/pic-fallback.jpg').length);
    assert.deepEqual(size('/img/icon.webp'), [40, 40]); // data-original
    assert.deepEqual(size('/img/unknown.webp'), [0, 0]); // empty src, no size attributes
    assert.deepEqual(size('/img/ls-2x.webp'), [0, 0]); // data-lazy-srcset with x descriptors: highest
    assert.ok(!by('/ls-1x.webp').length);
    // loading="lazy" below the fold: listed with its src address, size from the attributes.
    assert.deepEqual(size('/img/below.webp'), [500, 300]);
    assert.equal(r.images.length, 8, JSON.stringify(srcs));
  } finally {
    await p.close();
  }
});

test('popup shows unknown-size (0x0) lazy images with the size filter on', async () => {
  const { p, id } = await openLazyPage();
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${id}`);
    await popup.waitForSelector('#grid li');
    assert.equal(await popup.inputValue('#minSize'), '100');
    const titles = await popup.locator('#grid .meta').evaluateAll((els) => els.map((e) => e.title));
    const shown = (end) => titles.some((t) => t.endsWith(end));
    assert.ok(shown('/img/unknown.webp'), `0x0 image shown: ${JSON.stringify(titles)}`);
    assert.ok(shown('/img/ls-2x.webp') && shown('/img/lz-l.webp') && shown('/img/pic-l.avif') && shown('/img/below.webp'));
    // A lazy image whose attributes say it is small (40x40) is still filtered.
    assert.ok(!shown('/img/icon.webp'));
    assert.equal(titles.length, 7);
    assert.match(await popup.textContent('#message'), /1 smaller image is hidden/);
  } finally {
    await popup.close();
    await p.close();
  }
});

test('ZIP of PNGs: same-site, CORS CDN, srcset and SVG; non-CORS site asks, then is skipped', async () => {
  const items = (await collect()).images.filter((x) => !x.src.endsWith('pixel.webp') && !x.src.endsWith('hero.webp'));
  assert.equal(items.length, 5);
  const state = await runBatch({ items, fmt: 'png', output: 'zip' }, { expectPermission: true, skip: true });
  assert.equal(state.saved, 4);
  assert.equal(state.failedCount, 1);
  assert.match(state.failed[0].src, /three\.webp$/);
  assert.match(state.filename, /^127\.0\.0\.1 images \d{4}-\d\d-\d\d\.zip$/);
  const [{ buf }] = await downloadedFiles(state);
  const entries = readZip(buf);
  assert.deepEqual(entries.map((e) => e.name).sort(), ['big,crop.png', 'logo.png', 'one.png', 'two.png']);
  for (const e of entries) assert.equal(e.data.subarray(1, 4).toString(), 'PNG', `${e.name} is a PNG`);
  assert.deepEqual(await dims(entries.find((e) => e.name === 'big,crop.png').data), [800, 600]);
  assert.deepEqual(await dims(entries.find((e) => e.name === 'one.png').data), [160, 120]);
  // SVG rendered at the extension's minimum size (1024 px on the long side), via the offscreen document.
  assert.deepEqual(await dims(entries.find((e) => e.name === 'logo.png').data), [1024, 512]);
});

test('one PDF with a page per image, in page order', async () => {
  const all = (await collect()).images;
  const items = ['one.webp', 'two.webp', 'logo.svg'].map((n) => all.find((x) => x.src.endsWith(n)));
  const state = await runBatch({ items, fmt: 'png', output: 'pdf' });
  assert.equal(state.saved, 3);
  const [{ buf }] = await downloadedFiles(state);
  const pages = inspectPdf(buf);
  assert.equal(pages.length, 3);
});

test('separate files in the original format, no conversion', async () => {
  const all = (await collect()).images;
  const items = ['one.webp', 'hero.webp'].map((n) => all.find((x) => x.src.endsWith(n)));
  const state = await runBatch({ items, fmt: 'original', output: 'files' });
  assert.equal(state.saved, 2);
  const files = await downloadedFiles(state);
  assert.equal(files.length, 2);
  assert.ok(files[1].buf.equals(fixtures['hero.webp'].body), 'bytes unchanged');
  assert.ok(files[0].buf.equals(fixtures['one.webp'].body));
});

test('popup lists the page images, hides tiny ones, and saves the selection', async () => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html?tabId=${await tabId()}`);
  await popup.waitForSelector('#grid li');
  // Default filter hides images whose longer side is under 100 px (the 1x1 pixel).
  assert.equal(await popup.locator('#grid li').count(), 6);
  assert.match(await popup.textContent('#message'), /1 smaller image is hidden/);
  await popup.selectOption('#minSize', '0');
  assert.equal(await popup.locator('#grid li').count(), 7);
  await popup.selectOption('#minSize', '100');
  await popup.screenshot({ path: path.join(ROOT, 'tests', '.popup.png') }).catch(() => {});
  // Keep only the first two, save as JPG files.
  await popup.click('#toggleAll'); // select none
  assert.equal(await popup.textContent('#save'), 'Save 0 images');
  const boxes = popup.locator('#grid input');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await popup.selectOption('#format', 'jpg');
  await popup.selectOption('#output', 'files');
  await popup.click('#save');
  await popup.waitForFunction(() => /^Saved 2 of 2 images as separate files/.test(document.getElementById('progressText').textContent));
  const saved = await sw.evaluate(() => chrome.storage.sync.get(['batchFormat', 'batchOutput']));
  assert.deepEqual(saved, { batchFormat: 'jpg', batchOutput: 'files' });
  const files = await downloadedFiles(await sw.evaluate(() => globalThis.saveform.batchState()));
  assert.equal(files.length, 2);
  for (const { buf } of files) { assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8); }
  await popup.click('#again');
  assert.equal(await popup.isVisible('#picker'), true);
  await popup.close();
});
