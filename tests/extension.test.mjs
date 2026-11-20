// End-to-end test of the unpacked extension in real Chromium (Chrome for Testing via playwright-core).
// A context-menu click cannot be automated, so the test calls the same handler the menu calls
// (globalThis.saveform.handleClick in the service worker) with the same arguments Chrome passes.
// activeTab is granted by a real right-click; the test stands in for it with a host permission
// for the page's origin only (127.0.0.1), added to a temporary copy of the manifest.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, cp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { inspectPdf } from './pdf-inspect.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
let server, pagePort, cdnPort, context, sw, page, tmp, downloadsDir;
const fixtures = {}; // name -> { body, type }
const requests = [];

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#e11d48"/></svg>';

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const port = Number(req.headers.host.split(':')[1]);
      const url = new URL(req.url, `http://${req.headers.host}`);
      requests.push(`${req.headers.host}${url.pathname}`);
      if (url.pathname === '/page.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<!doctype html><body><h1>test page</h1>
          <img id="same" src="/same.webp">
          <img id="cors" src="http://localhost:${cdnPort}/cors/photo.webp">
          <img id="nocors" src="http://localhost:${cdnPort}/nocors/locked.webp">
          <img id="svg" src="http://localhost:${cdnPort}/cors/logo.svg"></body>`);
        return;
      }
      const name = url.pathname.split('/').pop();
      const f = fixtures[name];
      if (!f) { res.writeHead(404); res.end(); return; }
      const headers = { 'content-type': f.type };
      if (port === cdnPort && url.pathname.startsWith('/cors/')) headers['access-control-allow-origin'] = '*';
      res.writeHead(200, headers);
      res.end(f.body);
    });
    server.listen(0, '127.0.0.1', () => {
      pagePort = server.address().port;
      // second listener = second origin ("CDN"), reached as localhost:<port>
      const cdn = http.createServer((req, res) => server.emit('request', req, res));
      cdn.listen(0, '127.0.0.1', () => { cdnPort = cdn.address().port; server.cdn = cdn; resolve(); });
    });
  });
}

before(async () => {
  await startServer();
  tmp = await mkdtemp(path.join(tmpdir(), 'saveform-test-'));
  const ext = path.join(tmp, 'ext');
  downloadsDir = path.join(tmp, 'downloads');
  await cp(path.join(ROOT, 'extension'), ext, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*']; // stand-in for activeTab (see top comment)
  await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest));

  context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    downloadsPath: downloadsDir,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  page = await context.newPage();

  // Make real WebP fixtures with the browser's own encoder: 64x48, left half transparent.
  await page.goto('about:blank');
  const webp = await page.evaluate(async () => {
    const c = new OffscreenCanvas(64, 48); const g = c.getContext('2d');
    g.fillStyle = '#16a34a'; g.fillRect(32, 0, 32, 48);
    const b = await c.convertToBlob({ type: 'image/webp', quality: 1 });
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  const webpBuf = Buffer.from(webp);
  fixtures['same.webp'] = { body: webpBuf, type: 'image/webp' };
  fixtures['photo.webp'] = { body: webpBuf, type: 'image/webp' };
  fixtures['locked.webp'] = { body: webpBuf, type: 'image/webp' };
  fixtures['logo.svg'] = { body: Buffer.from(SVG), type: 'image/svg+xml' };

  await page.goto(`http://127.0.0.1:${pagePort}/page.html`);
  await sw.evaluate(() => chrome.storage.sync.set({ askWhere: false }));
});

after(async () => {
  await context?.close();
  server?.cdn?.close(); server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function click(menuItemId, srcUrl) {
  return sw.evaluate(async ({ menuItemId, srcUrl }) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return globalThis.saveform.handleClick({ menuItemId, srcUrl, frameId: 0 }, { id: tab.id });
  }, { menuItemId, srcUrl });
}

async function downloaded(id) {
  // Wait for the download to finish, then decode the saved file in the page to check it.
  const item = await sw.evaluate(async (id) => {
    for (let i = 0; i < 100; i++) {
      const [d] = await chrome.downloads.search({ id });
      if (d && (d.state === 'complete' || d.state === 'interrupted')) return d;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }, id);
  assert.ok(item, 'download finished');
  assert.equal(item.state, 'complete', `download state ${item.state} ${item.error || ''}`);
  return item;
}

async function inspect(bytes) {
  return page.evaluate(async (arr) => {
    const b = new Blob([new Uint8Array(arr)]);
    const bmp = await createImageBitmap(b);
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data);
    return { w: bmp.width, h: bmp.height, left: px(2, 2), right: px(60, 2) };
  }, Array.from(bytes));
}

function magic(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (buf.subarray(4, 12).toString() === 'ftypavif') return 'avif';
  return 'unknown';
}

async function fileOf(res) {
  // Chrome reports the real path; Playwright may also keep a GUID-named copy.
  const item = await downloaded(res.downloadId);
  return readFile(item.filename);
}

test('menu is registered with PNG, JPG, WebP, PDF and Copy', async () => {
  const r = await sw.evaluate(async () => {
    const { canEncode, menuIds } = globalThis.saveform;
    return { avif: await canEncode('image/avif'), webp: await canEncode('image/webp'), menuIds: [...menuIds] };
  });
  console.log('# encoder support in this Chromium:', JSON.stringify(r));
  assert.equal(r.webp, true);
  for (const id of ['saveform', 'save:png', 'save:jpg', 'save:webp', 'save:pdf', 'copy:png']) assert.ok(r.menuIds.includes(id), id);
  assert.equal(r.menuIds.includes('save:avif'), r.avif, 'AVIF entry shown only when the browser can encode AVIF');
});

test('same-site WebP -> PNG keeps transparency and size', async () => {
  const res = await click('save:png', `http://127.0.0.1:${pagePort}/same.webp`);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.filename, 'same.png');
  const buf = await fileOf(res);
  assert.equal(magic(buf), 'png');
  const info = await inspect(buf);
  assert.deepEqual([info.w, info.h], [64, 48]);
  assert.equal(info.left[3], 0, 'left half stays transparent');
  assert.equal(info.right[3], 255);
});

test('cross-site WebP from a CORS-enabled CDN -> JPG with white background', async () => {
  const res = await click('save:jpg', `http://localhost:${cdnPort}/cors/photo.webp`);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.filename, 'photo.jpg');
  const buf = await fileOf(res);
  assert.equal(magic(buf), 'jpeg');
  const info = await inspect(buf);
  assert.ok(info.left.slice(0, 3).every((v) => v > 245), `transparent area became white, got ${info.left}`);
});

test('SVG -> PNG renders via the offscreen document and is upscaled', async () => {
  const res = await click('save:png', `http://localhost:${cdnPort}/cors/logo.svg`);
  assert.equal(res.ok, true, JSON.stringify(res));
  const buf = await fileOf(res);
  assert.equal(magic(buf), 'png');
  const info = await inspect(buf);
  assert.deepEqual([info.w, info.h], [1024, 512]);
});

test('same-site WebP -> PDF: one page the size of the image (default setting)', async () => {
  const res = await click('save:pdf', `http://127.0.0.1:${pagePort}/same.webp`);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.filename, 'same.pdf');
  assert.equal(res.type, 'application/pdf');
  const pages = inspectPdf(await fileOf(res));
  assert.equal(pages.length, 1);
  assert.deepEqual(pages[0].mediaBox, [0, 0, 48, 36], '64×48 px at 96 dpi = 48×36 pt');
  assert.equal(pages[0].filter, 'DCTDecode');
});

test('SVG -> PDF goes through the offscreen document too', async () => {
  const res = await click('save:pdf', `http://localhost:${cdnPort}/cors/logo.svg`);
  assert.equal(res.ok, true, JSON.stringify(res));
  const [p] = inspectPdf(await fileOf(res));
  assert.deepEqual([p.width, p.height], [1024, 512]);
});

test('data: URL image -> WebP', async () => {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`;
  const res = await click('save:webp', dataUrl);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.filename, 'image.webp');
  assert.equal(magic(await fileOf(res)), 'webp');
});

test('blob: URL created by the page is read from inside the page', async () => {
  const blobUrl = await page.evaluate(async () => {
    const r = await fetch('/same.webp');
    return URL.createObjectURL(await r.blob());
  });
  const res = await click('save:png', blobUrl);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(magic(await fileOf(res)), 'png');
});

test('server that blocks cross-site reads -> asks for access to that one site', async () => {
  const before = context.pages().length;
  const res = await click('save:png', `http://localhost:${cdnPort}/nocors/locked.webp`);
  assert.equal(res.pending, 'permission', JSON.stringify(res));
  assert.equal(res.origin, `http://localhost:${cdnPort}/*`);
  const grant = context.pages().length > before ? context.pages().at(-1) : await context.waitForEvent('page');
  await grant.waitForLoadState();
  assert.match(grant.url(), /grant\.html\?id=/);
  await grant.waitForFunction(() => document.getElementById('host').textContent !== '…');
  assert.equal(await grant.textContent('#host'), `localhost:${cdnPort}`);
  await grant.close();
});

test('broken image reports an error instead of saving garbage', async () => {
  fixtures['broken.webp'] = { body: Buffer.from('not an image'), type: 'image/webp' };
  const res = await click('save:png', `http://127.0.0.1:${pagePort}/broken.webp`);
  assert.equal(res.ok, false);
  assert.match(res.error, /decode/i);
});

test('copy as PNG puts an image/png on the clipboard', async () => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://127.0.0.1:${pagePort}` });
  await page.bringToFront();
  const res = await click('copy:png', `http://127.0.0.1:${pagePort}/same.webp`);
  assert.equal(res.ok, true, JSON.stringify(res));
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
  assert.ok(types.includes('image/png'), `clipboard types: ${types}`);
});

test('the extension made no requests other than the images it was asked for', () => {
  const unexpected = requests.filter((r) => !/\/(page\.html|same\.webp|photo\.webp|locked\.webp|logo\.svg|broken\.webp|favicon\.ico)$/.test(r));
  assert.deepEqual(unexpected, []);
});
