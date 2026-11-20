// End-to-end tests for the static converter site.
//   node --test tests/site.test.mjs
// Builds dist/, serves it on a random localhost port, and drives headless
// Chromium through real conversions (file input, paste, ZIP download).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFile, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { crc32 } from 'node:zlib';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE_PATH = '/save-image-format';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain',
};

let server, origin, browser, context;
const consoleErrors = [];
const externalRequests = [];

before(async () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-site.mjs')], { stdio: 'pipe' });

  server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.startsWith(`${BASE_PATH}/`)) path = path.slice(BASE_PATH.length); // like GitHub Pages
    let file = normalize(join(DIST, path));
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.html'] }).end(await readFile(join(DIST, '404.html')));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;

  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({
      executablePath: join(homedir(), '.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell'),
    });
  }
  context = await browser.newContext({ acceptDownloads: true });
  context.on('request', (r) => {
    const u = new URL(r.url());
    if ((u.protocol === 'http:' || u.protocol === 'https:') && !['127.0.0.1', 'localhost'].includes(u.hostname)) {
      externalRequests.push(r.url());
    }
  });
});

after(async () => {
  await context?.close();
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
});

async function openPage(path, { allow = [] } = {}) {
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !allow.some((re) => re.test(m.text()))) consoleErrors.push(`${path}: ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`${path}: ${e.message}`));
  const resp = await page.goto(origin + path);
  return { page, resp };
}

/** Draw a w×h image whose left half is fully transparent, encode it in the page. */
async function makeFixture(page, mime, w, h) {
  const bytes = await page.evaluate(async ({ mime, w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1e88e5';
    ctx.fillRect(Math.floor(w / 2), 0, w - Math.floor(w / 2), h);
    const blob = await new Promise((r) => c.toBlob(r, mime, 0.9));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, { mime, w, h });
  return Buffer.from(bytes);
}

async function waitForDone(page, n) {
  await page.waitForFunction((n) => document.querySelectorAll('#results li[data-state="done"]').length === n
    && !document.querySelector('#results li[data-state="queued"], #results li[data-state="working"]'), n, { timeout: 15000 });
}

async function downloadBytes(page, selector) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(selector)]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

/** RGBA of the converted image (the row thumbnail is the output blob) at x, y. */
async function pixelOfResult(page, index, x, y) {
  return page.evaluate(async ({ index, x, y }) => {
    const img = document.querySelectorAll('#results .thumb')[index];
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(x, y, 1, 1).data];
  }, { index, x, y });
}

function jpegSize(b) {
  for (let i = 2; i < b.length - 9;) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('webp-to-png converts a transparent WebP into a PNG with the same size and alpha', async () => {
  const { page } = await openPage('/webp-to-png/');
  assert.equal(await page.locator('#format').inputValue(), 'png');
  const webp = await makeFixture(page, 'image/webp', 40, 30);
  assert.equal(webp.subarray(8, 12).toString('latin1'), 'WEBP', 'fixture should be a real WebP');

  await page.setInputFiles('#file', { name: 'photo.webp', mimeType: 'image/webp', buffer: webp });
  await waitForDone(page, 1);
  assert.match(await page.locator('#results .result-meta').first().textContent(), /WebP .* → PNG .*40 × 30 px/);

  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'photo.png');
  assert.deepEqual(bytes.subarray(0, 8), PNG_MAGIC, 'output starts with PNG signature');
  assert.equal(bytes.readUInt32BE(16), 40, 'IHDR width');
  assert.equal(bytes.readUInt32BE(20), 30, 'IHDR height');
  assert.equal(bytes[25], 6, 'IHDR colour type 6 = RGBA');
  assert.equal((await pixelOfResult(page, 0, 5, 5))[3], 0, 'left half stays transparent');
  assert.equal((await pixelOfResult(page, 0, 35, 5))[3], 255, 'right half stays opaque');
  await page.close();
});

test('png-to-jpg produces JPEG bytes and fills transparency with the chosen background', async () => {
  const { page } = await openPage('/png-to-jpg/');
  assert.equal(await page.locator('#format').inputValue(), 'jpg');
  assert.equal(await page.locator('#quality-control').isVisible(), true, 'quality slider shown for JPG');
  await page.fill('#bg', '#ff0000');
  const png = await makeFixture(page, 'image/png', 33, 21);

  await page.setInputFiles('#file', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await waitForDone(page, 1);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'logo.jpg');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], 'output starts with JPEG SOI marker');
  assert.deepEqual(jpegSize(bytes), { width: 33, height: 21 });
  const [r, g, b, a] = await pixelOfResult(page, 0, 3, 10);
  assert.ok(r > 230 && g < 30 && b < 30 && a === 255, `transparent area became red background, got ${[r, g, b, a]}`);

  // Switching to PNG hides JPG-only controls and re-converts the existing file.
  await page.selectOption('#format', 'png');
  assert.equal(await page.locator('#bg-control').isVisible(), false);
  assert.equal(await page.locator('#quality-control').isVisible(), false);
  await page.waitForFunction(() => document.querySelector('#results a.btn')?.download === 'logo.png');
  await page.close();
});

test('Download all builds a valid stored ZIP with one entry per file and unique names', async () => {
  const { page } = await openPage('/webp-to-png/');
  const files = [];
  for (const [name, w, h] of [['a.webp', 10, 12], ['b.webp', 20, 8], ['a.webp', 7, 7]]) {
    files.push({ name, mimeType: 'image/webp', buffer: await makeFixture(page, 'image/webp', w, h) });
  }
  await page.setInputFiles('#file', files);
  await waitForDone(page, 3);
  assert.equal(await page.locator('#download-all').isEnabled(), true);
  assert.match(await page.locator('#status').textContent(), /3 of 3 images converted/);

  const { name, bytes } = await downloadBytes(page, '#download-all');
  assert.equal(name, 'saveform-png-images.zip');
  assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'starts with PK\\x03\\x04');

  const eocd = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(eocd), 0x06054b50, 'end of central directory at the end');
  const count = bytes.readUInt16LE(eocd + 10);
  assert.equal(count, 3, 'three entries');

  const names = [];
  let p = bytes.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(p), 0x02014b50, 'central directory entry signature');
    const crc = bytes.readUInt32LE(p + 16), size = bytes.readUInt32LE(p + 20);
    const nameLen = bytes.readUInt16LE(p + 28);
    const localOff = bytes.readUInt32LE(p + 42);
    names.push(bytes.subarray(p + 46, p + 46 + nameLen).toString('utf8'));
    assert.equal(bytes.readUInt32LE(localOff), 0x04034b50, 'local header signature');
    assert.equal(bytes.readUInt16LE(localOff + 8), 0, 'stored (no compression)');
    const dataStart = localOff + 30 + bytes.readUInt16LE(localOff + 26) + bytes.readUInt16LE(localOff + 28);
    const data = bytes.subarray(dataStart, dataStart + size);
    assert.deepEqual(data.subarray(0, 8), PNG_MAGIC, 'entry is a PNG');
    assert.equal(crc32(data), crc, 'CRC-32 matches');
    p += 46 + nameLen + bytes.readUInt16LE(p + 30) + bytes.readUInt16LE(p + 32);
  }
  assert.deepEqual(names, ['a.png', 'b.png', 'a-2.png']);
  await page.close();
});

test('svg-to-png scales small SVGs up to the chosen size; gif-to-png converts a GIF', async () => {
  const { page } = await openPage('/svg-to-png/');
  await page.fill('#svg-size', '200');
  await page.locator('#svg-size').dispatchEvent('change');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="20" height="20" fill="#0a0"/></svg>');
  await page.setInputFiles('#file', { name: 'icon.svg', mimeType: 'image/svg+xml', buffer: svg });
  await waitForDone(page, 1);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'icon.png');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [200, 100], 'scaled so the long side is 200 px');
  assert.equal((await pixelOfResult(page, 0, 150, 50))[3], 0, 'empty SVG area is transparent');
  await page.close();

  const gifPage = (await openPage('/gif-to-png/')).page;
  // 1×1 red GIF89a, hand-assembled.
  const gif = Buffer.from('R0lGODlhAQABAIAAAP8AAAAAACwAAAAAAQABAAACAkQBADs=', 'base64');
  await gifPage.setInputFiles('#file', { name: 'dot.gif', mimeType: 'image/gif', buffer: gif });
  await waitForDone(gifPage, 1);
  const out = await downloadBytes(gifPage, '#results a.btn');
  assert.deepEqual(out.bytes.subarray(0, 8), PNG_MAGIC);
  assert.deepEqual((await pixelOfResult(gifPage, 0, 0, 0)).slice(0, 3), [255, 0, 0]);
  await gifPage.close();
});

test('pasting an image from the clipboard converts it', async () => {
  const { page } = await openPage('/');
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 9;
    c.getContext('2d').fillRect(0, 0, 16, 9);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await waitForDone(page, 1);
  assert.match(await page.locator('#results .result-meta').textContent(), /16 × 9 px/);
  assert.equal(await page.locator('#results a.btn').getAttribute('download'), 'pasted-image-1.png');
  await page.close();
});

test('AVIF output option matches what the browser can encode', async () => {
  const { page } = await openPage('/');
  await page.waitForSelector('[data-tool][data-ready="1"]', { state: 'attached' });
  const canAvif = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const b = await new Promise((r) => c.toBlob(r, 'image/avif'));
    return b?.type === 'image/avif';
  });
  const disabled = await page.locator('#format option[value="avif"]').evaluate((o) => o.disabled);
  assert.equal(disabled, !canAvif);
  if (!canAvif) assert.match(await page.locator('#format-note').textContent(), /cannot create AVIF files/);
  console.log(`# note: this Chromium ${canAvif ? 'can' : 'cannot'} encode AVIF; option ${disabled ? 'disabled' : 'enabled'}`);
  await page.close();
});

test('every page loads with one h1, unique title/description, valid JSON-LD and working internal links', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.slice(BASE_PATH.length));
  assert.equal(urls.length, 13);
  const titles = new Set(), descriptions = new Set();
  for (const path of urls) {
    const { page, resp } = await openPage(path);
    assert.equal(resp.status(), 200, path);
    assert.equal(await page.locator('h1').count(), 1, `${path} has one h1`);
    titles.add(await page.title());
    descriptions.add(await page.locator('meta[name=description]').getAttribute('content'));
    const canonical = await page.locator('link[rel=canonical]').getAttribute('href');
    assert.equal(new URL(canonical).pathname, BASE_PATH + path, `${path} canonical`);
    for (const ld of await page.locator('script[type="application/ld+json"]').allTextContents()) JSON.parse(ld);
    const isConverter = await page.locator('[data-tool]').count();
    if (isConverter) {
      const faq = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()));
      assert.equal(faq['@type'], 'FAQPage');
      assert.ok(faq.mainEntity.length >= 4 && faq.mainEntity.length <= 5, `${path} FAQ has 4-5 questions`);
      assert.equal(await page.locator('.links-grid a').count(), 11, `${path} links to all converters`);
    }
    // Every same-site link resolves to a file in dist/.
    for (const href of await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.href))) {
      const u = new URL(href);
      if (u.origin !== origin) continue;
      const target = join(DIST, u.pathname.endsWith('/') ? `${u.pathname}index.html` : u.pathname);
      assert.ok(existsSync(target), `${path} links to missing ${u.pathname}`);
    }
    await page.close();
  }
  assert.equal(titles.size, 13, 'titles are unique');
  assert.equal(descriptions.size, 13, 'descriptions are unique');

  // The 404 page uses absolute /save-image-format/ paths (served at any depth on GitHub Pages).
  const { page, resp } = await openPage('/no-such-page/', { allow: [/status of 404/] });
  assert.equal(resp.status(), 404);
  assert.equal(await page.locator('h1').textContent(), 'Page not found');
  assert.equal(await page.locator('link[rel=stylesheet]').evaluate((l) => !!l.sheet), true, '404 stylesheet loads');
  await page.close();
});

test('built output: robots, sitemap, shared engine copied, no external URLs in assets', async () => {
  assert.match(await readFile(join(DIST, 'robots.txt'), 'utf8'), /Sitemap: https:\/\/janwan2003\.github\.io\/save-image-format\/sitemap\.xml/);
  assert.equal(await readFile(join(DIST, 'lib/convert.js'), 'utf8'), await readFile(join(ROOT, 'extension/lib/convert.js'), 'utf8'));
  assert.equal(await readFile(join(DIST, 'lib/filename.js'), 'utf8'), await readFile(join(ROOT, 'extension/lib/filename.js'), 'utf8'));
  for (const f of await readdir(join(DIST, 'assets'))) {
    const src = await readFile(join(DIST, 'assets', f), 'utf8');
    assert.doesNotMatch(src, /https?:\/\//, `${f} references no external URL`);
  }
  const html = await readFile(join(DIST, 'index.html'), 'utf8');
  assert.match(html, /http-equiv="Content-Security-Policy" content="default-src 'self'/);
  assert.doesNotMatch(html, /<script(?![^>]*(type="module" src=|type="application\/ld\+json"))/, 'no inline scripts');
  assert.doesNotMatch(html, /\sstyle="/, 'no inline style attributes (CSP style-src self)');
});

test('no console errors and no requests to non-localhost hosts across all tests', () => {
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(externalRequests, []);
});
