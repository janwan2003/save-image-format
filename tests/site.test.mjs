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
import { crc32, gunzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { converters } from '../site/pages.mjs';
import { guides } from '../site/guides.mjs';
import { inspectPdf, inspectIco, popplerAvailable, renderFirstPage } from './pdf-inspect.mjs';
import '../site/assets/tiff.js'; // our TIFF decoder (globalThis.SaveformTiff), to read back TIFF output

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE_PATH = '/save-image-format';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain',
  '.wasm': 'application/wasm',
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
    // No headless shell for this Playwright version: use the full Chromium build in new headless mode.
    browser = await chromium.launch({ channel: 'chromium' });
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
  await page.locator('#svg-size').blur(); // fires the native change once, before files are added
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

/** 24-bit bottom-up BMP: left half red, right half blue. */
function makeBmp(w, h) {
  const row = Math.ceil((w * 3) / 4) * 4;
  const b = Buffer.alloc(54 + row * h);
  b.write('BM', 0, 'latin1');
  b.writeUInt32LE(b.length, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  b.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = 54 + y * row + x * 3; // BGR
      if (x < w / 2) b[o + 2] = 255; else b[o] = 255;
    }
  }
  return b;
}

/** ICO container with a single embedded PNG image. */
function makeIco(png, w, h) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head[6] = w >= 256 ? 0 : w; head[7] = h >= 256 ? 0 : h;
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

test('bmp-to-png and bmp-to-jpg decode a real BMP and write the right type and size', async () => {
  const bmp = makeBmp(30, 20);
  const { page } = await openPage('/bmp-to-png/');
  assert.equal(await page.locator('#format').inputValue(), 'png');
  await page.setInputFiles('#file', { name: 'scan.bmp', mimeType: 'image/bmp', buffer: bmp });
  await waitForDone(page, 1);
  assert.match(await page.locator('#results .result-meta').first().textContent(), /BMP .* → PNG .*30 × 20 px/);
  let out = await downloadBytes(page, '#results a.btn');
  assert.equal(out.name, 'scan.png');
  assert.deepEqual(out.bytes.subarray(0, 8), PNG_MAGIC);
  assert.deepEqual([out.bytes.readUInt32BE(16), out.bytes.readUInt32BE(20)], [30, 20]);
  assert.deepEqual(await pixelOfResult(page, 0, 2, 2), [255, 0, 0, 255], 'left half red');
  assert.deepEqual(await pixelOfResult(page, 0, 27, 17), [0, 0, 255, 255], 'right half blue');
  await page.close();

  const jpgPage = (await openPage('/bmp-to-jpg/')).page;
  assert.equal(await jpgPage.locator('#format').inputValue(), 'jpg');
  await jpgPage.setInputFiles('#file', { name: 'scan.bmp', mimeType: 'image/bmp', buffer: bmp });
  await waitForDone(jpgPage, 1);
  out = await downloadBytes(jpgPage, '#results a.btn');
  assert.equal(out.name, 'scan.jpg');
  assert.deepEqual([...out.bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.deepEqual(jpegSize(out.bytes), { width: 30, height: 20 });
  await jpgPage.close();
});

test('ico-to-png extracts the icon with transparency', async () => {
  const { page } = await openPage('/ico-to-png/');
  assert.equal(await page.locator('#format').inputValue(), 'png');
  const ico = makeIco(await makeFixture(page, 'image/png', 32, 32), 32, 32);
  await page.setInputFiles('#file', { name: 'favicon.ico', mimeType: 'image/x-icon', buffer: ico });
  await waitForDone(page, 1);
  assert.match(await page.locator('#results .result-meta').first().textContent(), /ICO .* → PNG .*32 × 32 px/);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'favicon.png');
  assert.deepEqual(bytes.subarray(0, 8), PNG_MAGIC);
  assert.equal((await pixelOfResult(page, 0, 3, 3))[3], 0, 'transparent half kept');
  assert.equal((await pixelOfResult(page, 0, 28, 3))[3], 255, 'opaque half kept');
  await page.close();
});

test('svg-to-jpg renders on a solid background; gif-to-jpg writes a JPEG', async () => {
  const { page } = await openPage('/svg-to-jpg/');
  assert.equal(await page.locator('#format').inputValue(), 'jpg');
  assert.equal(await page.locator('#svg-size').count(), 1, 'SVG size option shown');
  await page.fill('#svg-size', '100');
  await page.locator('#svg-size').blur(); // fires the native change once, before files are added
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect x="10" width="10" height="10" fill="#000"/></svg>');
  await page.setInputFiles('#file', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: svg });
  await waitForDone(page, 1);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'logo.jpg');
  assert.deepEqual(jpegSize(bytes), { width: 100, height: 50 });
  const [r, g, b] = await pixelOfResult(page, 0, 10, 25);
  assert.ok(r > 240 && g > 240 && b > 240, `empty SVG area is white, got ${[r, g, b]}`);
  await page.close();

  const gifPage = (await openPage('/gif-to-jpg/')).page;
  const gif = Buffer.from('R0lGODlhAQABAIAAAP8AAAAAACwAAAAAAQABAAACAkQBADs=', 'base64');
  await gifPage.setInputFiles('#file', { name: 'dot.gif', mimeType: 'image/gif', buffer: gif });
  await waitForDone(gifPage, 1);
  const out = await downloadBytes(gifPage, '#results a.btn');
  assert.equal(out.name, 'dot.jpg');
  assert.deepEqual([...out.bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  await gifPage.close();
});

test('jpg-to-pdf: one PDF per image, reorder, then Download one PDF with A4 pages', async () => {
  const { page } = await openPage('/jpg-to-pdf/');
  assert.equal(await page.locator('#format').inputValue(), 'pdf');
  assert.equal(await page.locator('#page-size').inputValue(), 'a4');
  assert.equal(await page.locator('#page-size-control').isVisible(), true);
  assert.equal(await page.locator('#bg-control').isVisible(), true, 'background colour applies to PDF pages');
  const wide = await makeFixture(page, 'image/jpeg', 300, 200);
  const tall = await makeFixture(page, 'image/jpeg', 120, 160);
  await page.setInputFiles('#file', [
    { name: 'wide.jpg', mimeType: 'image/jpeg', buffer: wide },
    { name: 'tall.jpg', mimeType: 'image/jpeg', buffer: tall },
  ]);
  await waitForDone(page, 2);
  assert.match(await page.locator('#download-pdf').textContent(), /2 pages/);

  const single = await downloadBytes(page, '#results li:first-child a.btn');
  assert.equal(single.name, 'wide.pdf');
  const [p1] = inspectPdf(single.bytes);
  assert.deepEqual(p1.mediaBox, [0, 0, 841.89, 595.28], 'landscape image -> landscape A4');
  assert.equal(p1.filter, 'DCTDecode');
  assert.deepEqual(jpegSize(p1.data), { width: 300, height: 200 });

  // Move the second image up, then combine: page order follows the list.
  await page.click('#results li:nth-child(2) .move');
  assert.equal(await page.locator('#results li:first-child .result-name').textContent(), 'tall.pdf');
  const combined = await downloadBytes(page, '#download-pdf');
  assert.equal(combined.name, 'tall-and-1-more.pdf');
  const pages = inspectPdf(combined.bytes);
  assert.deepEqual(pages.map((p) => [p.width, p.height]), [[120, 160], [300, 200]]);
  assert.deepEqual(pages[0].mediaBox, [0, 0, 595.28, 841.89], 'portrait image -> portrait A4');

  // Page size "Same as image": 1 px = 0.75 pt.
  await page.selectOption('#page-size', 'fit');
  await waitForDone(page, 2);
  const fit = inspectPdf((await downloadBytes(page, '#download-pdf')).bytes);
  assert.deepEqual(fit.map((p) => p.mediaBox), [[0, 0, 90, 120], [0, 0, 225, 150]]);

  if (popplerAvailable()) {
    // Independent renderer (poppler): the 120×160 image sits centred at natural size on a white A4 page.
    // (The JPEG fixture's left half is black: JPEG cannot store the canvas's transparency.)
    const r = renderFirstPage(combined.bytes);
    assert.deepEqual([r.width, r.height], [794, 1123], 'A4 at 96 dpi');
    const cx = Math.round(r.width / 2), cy = Math.round(r.height / 2);
    const right = r.rgb(cx + 30, cy), left = r.rgb(cx - 30, cy), margin = r.rgb(cx - 80, cy);
    assert.ok(right[2] > 180 && right[0] < 80, `blue half drawn right of centre, got ${right}`);
    assert.ok(left.every((v) => v < 40), `black half drawn left of centre, got ${left}`);
    assert.ok(margin.every((v) => v > 240), `page outside the image is white, got ${margin}`);
  } else {
    console.log('# pdftoppm not installed: PDF rendering check skipped');
  }
  await page.close();
});

test('png-to-pdf at 100% stores pixels losslessly (FlateDecode) with the chosen background', async () => {
  const { page } = await openPage('/png-to-pdf/');
  assert.equal(await page.locator('#page-size').inputValue(), 'fit');
  await page.fill('#quality', '100');
  await page.dispatchEvent('#quality', 'input');
  assert.equal(await page.locator('#quality-out').textContent(), '100% (lossless)');
  await page.fill('#bg', '#00ff00');
  const png = await makeFixture(page, 'image/png', 10, 4);
  await page.setInputFiles('#file', { name: 'shot.png', mimeType: 'image/png', buffer: png });
  await waitForDone(page, 1);
  const thumbOk = await page.evaluate(() => document.querySelector('#results .thumb').decode().then(() => true, () => false));
  assert.equal(thumbOk, true, 'PDF row shows a preview of the source image');
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'shot.pdf');
  const [p] = inspectPdf(bytes);
  assert.equal(p.filter, 'FlateDecode');
  const px = p.pixels();
  assert.equal(px.length, 10 * 4 * 3);
  assert.deepEqual([...px.subarray(0, 3)], [0, 255, 0], 'transparent pixel -> background colour, exactly');
  assert.deepEqual([...px.subarray(9 * 3, 9 * 3 + 3)], [0x1e, 0x88, 0xe5], 'opaque pixel kept exactly');
  await page.close();
});

test('png-to-ico writes a multi-size icon with embedded PNGs and transparency', async () => {
  const { page } = await openPage('/png-to-ico/');
  assert.equal(await page.locator('#format').inputValue(), 'ico');
  assert.equal(await page.locator('#ico-control').isVisible(), true);
  await page.uncheck('input[name="ico-size"][value="256"]');
  await page.check('input[name="ico-size"][value="64"]');
  const png = await makeFixture(page, 'image/png', 80, 40); // not square: centred on a square
  await page.setInputFiles('#file', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await waitForDone(page, 1);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'logo.ico');
  const entries = inspectIco(bytes);
  assert.deepEqual(entries.map((e) => e.size), [16, 32, 48, 64]);
  for (const e of entries) {
    assert.deepEqual(e.bytes.subarray(0, 8), PNG_MAGIC, `${e.size}px entry is a PNG`);
    assert.equal(e.bytes.readUInt32BE(16), e.size);
    assert.equal(e.bytes.readUInt32BE(20), e.size);
  }
  // The browser itself can decode the icon, with transparency (top rows are padding).
  assert.equal((await pixelOfResult(page, 0, 40, 2))[3], 0, 'padding is transparent');
  await page.close();
});

/** RGBA at each [x, y] of a PNG, decoded by the browser (used for PNG entries inside an ICO). */
async function pngPixels(page, png, points) {
  return page.evaluate(async ({ bytes, points }) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    return points.map(([x, y]) => [...g.getImageData(x, y, 1, 1).data]);
  }, { bytes: [...png], points });
}

const NEW_PAGES = ['image-to-pdf', 'favicon-generator', 'jpg-to-ico', 'svg-to-ico', 'webp-to-ico'];

test('image-to-pdf, favicon-generator and the jpg/svg/webp-to-ico pages build with their own title, h1, canonical and sitemap entry', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  for (const slug of NEW_PAGES) {
    const entry = converters.find((c) => c.slug === slug);
    assert.ok(entry, `${slug} is in site/pages.mjs`);
    assert.ok(existsSync(join(DIST, slug, 'index.html')), `${slug}/index.html built`);
    assert.ok(sitemap.includes(`<loc>https://janwan2003.github.io/save-image-format/${slug}/</loc>`), `${slug} in sitemap`);
    const { page, resp } = await openPage(`/${slug}/`);
    assert.equal(resp.status(), 200);
    assert.equal(await page.title(), entry.title);
    assert.equal(await page.locator('h1').textContent(), entry.h1);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), `https://janwan2003.github.io/save-image-format/${slug}/`);
    assert.equal(await page.locator('#format').inputValue(), entry.to, `${slug} defaults to ${entry.to}`);
    assert.equal(await page.locator('.links-grid a[aria-current="page"]').count(), 1, `${slug} marks itself in the converter list`);
    const ticked = await page.locator('input[name="ico-size"]:checked').evaluateAll((bs) => bs.map((b) => Number(b.value)));
    assert.deepEqual(ticked, slug === 'favicon-generator' ? [16, 32, 48] : [16, 32, 48, 256]);
    await page.close();
  }
  const { page } = await openPage('/');
  const labels = await page.locator('.links-grid a').allTextContents();
  for (const l of ['Image to PDF', 'Favicon generator', 'JPG to ICO', 'SVG to ICO', 'WebP to ICO']) assert.ok(labels.includes(l), `index links "${l}"`);
  await page.close();
});

test('favicon-generator writes a 16/32/48 px favicon.ico from a PNG, and adds 256 px when ticked', async () => {
  const { page } = await openPage('/favicon-generator/');
  assert.equal(await page.locator('#ico-control').isVisible(), true);
  const png = await makeFixture(page, 'image/png', 64, 64); // left half transparent, right half blue
  await page.setInputFiles('#file', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await waitForDone(page, 1);
  let { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'logo.ico');
  let entries = inspectIco(bytes);
  assert.deepEqual(entries.map((e) => [e.size, e.height]), [[16, 16], [32, 32], [48, 48]]);
  for (const e of entries) {
    assert.deepEqual(e.bytes.subarray(0, 8), PNG_MAGIC, `${e.size}px entry is a PNG`);
    assert.deepEqual([e.bytes.readUInt32BE(16), e.bytes.readUInt32BE(20)], [e.size, e.size]);
  }
  const [left, right] = await pngPixels(page, entries[1].bytes, [[4, 16], [28, 16]]);
  assert.equal(left[3], 0, '32px entry keeps the transparent half');
  assert.deepEqual(right, [0x1e, 0x88, 0xe5, 255], '32px entry keeps the opaque colour');

  const oldHref = await page.locator('#results a.btn').getAttribute('href');
  await page.check('input[name="ico-size"][value="256"]');
  // Settings changes re-convert after a short debounce; wait for the new blob URL.
  await page.waitForFunction((old) => { const a = document.querySelector('#results a.btn'); return a?.getAttribute('href') && a.getAttribute('href') !== old; }, oldHref);
  await waitForDone(page, 1);
  ({ name, bytes } = await downloadBytes(page, '#results a.btn'));
  entries = inspectIco(bytes);
  assert.deepEqual(entries.map((e) => e.size), [16, 32, 48, 256]);
  assert.equal(bytes[6 + 3 * 16], 0, 'ICO directory stores 256 as 0');
  assert.equal(entries[3].bytes.readUInt32BE(16), 256);
  await page.close();
});

test('image-to-pdf combines a PNG and a WebP into one 2-page PDF in list order', async () => {
  const { page } = await openPage('/image-to-pdf/');
  assert.equal(await page.locator('#format').inputValue(), 'pdf');
  assert.equal(await page.locator('#page-size').inputValue(), 'a4');
  assert.equal(await page.locator('#download-pdf').evaluate((b) => b.hidden), false, 'Download one PDF button is not hidden on a PDF page');
  assert.equal(await page.locator('#svg-size').count(), 1, 'SVG size option shown for any-format input');
  assert.match(await page.locator('#how').textContent(), /combine images into one PDF/);
  const png = await makeFixture(page, 'image/png', 300, 200);
  const webp = await makeFixture(page, 'image/webp', 120, 160);
  assert.equal(webp.subarray(8, 12).toString('latin1'), 'WEBP');
  await page.setInputFiles('#file', [
    { name: 'chart.png', mimeType: 'image/png', buffer: png },
    { name: 'photo.webp', mimeType: 'image/webp', buffer: webp },
  ]);
  await waitForDone(page, 2);
  assert.match(await page.locator('#download-pdf').textContent(), /2 pages/);
  const metas = await page.locator('#results .result-meta').allTextContents();
  assert.match(metas[0], /^PNG .* → PDF .*300 × 200 px/);
  assert.match(metas[1], /^WebP .* → PDF .*120 × 160 px/);

  const { name, bytes } = await downloadBytes(page, '#download-pdf');
  assert.equal(name, 'chart-and-1-more.pdf');
  const pages = inspectPdf(bytes);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map((p) => [p.width, p.height]), [[300, 200], [120, 160]], 'pages follow list order');
  assert.deepEqual(pages.map((p) => p.mediaBox), [[0, 0, 841.89, 595.28], [0, 0, 595.28, 841.89]], 'landscape then portrait A4');
  assert.deepEqual(pages.map((p) => p.filter), ['DCTDecode', 'DCTDecode']);
  assert.deepEqual(jpegSize(pages[1].data), { width: 120, height: 160 });

  // Reorder: the WebP becomes page 1.
  await page.click('#results li:nth-child(2) .move');
  const swapped = inspectPdf((await downloadBytes(page, '#download-pdf')).bytes);
  assert.deepEqual(swapped.map((p) => [p.width, p.height]), [[120, 160], [300, 200]]);
  if (popplerAvailable()) {
    const r = renderFirstPage(bytes); // page 1 of the first PDF: the PNG, landscape A4
    assert.deepEqual([r.width, r.height], [1123, 794], 'landscape A4 at 96 dpi');
    const cx = Math.round(r.width / 2), cy = Math.round(r.height / 2);
    const right = r.rgb(cx + 60, cy), left = r.rgb(cx - 60, cy);
    assert.ok(right[2] > 180 && right[0] < 80, `blue half right of centre, got ${right}`);
    assert.ok(left.every((v) => v > 240), `transparent half filled with the white background, got ${left}`);
  } else {
    console.log('# pdftoppm not installed: PDF rendering check skipped');
  }
  await page.close();
});

test('svg-to-ico draws each size from the vector; webp-to-ico keeps alpha; jpg-to-ico writes PNG entries', async () => {
  const { page } = await openPage('/svg-to-ico/');
  // Declared 16×16, left half black: the 256 px entry must still have a hard edge at x = 128.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="8" height="16" fill="#000"/></svg>');
  await page.setInputFiles('#file', { name: 'mark.svg', mimeType: 'image/svg+xml', buffer: svg });
  await waitForDone(page, 1);
  let out = await downloadBytes(page, '#results a.btn');
  assert.equal(out.name, 'mark.ico');
  let entries = inspectIco(out.bytes);
  assert.deepEqual(entries.map((e) => e.size), [16, 32, 48, 256]);
  const alphas = (await pngPixels(page, entries[3].bytes, [[126, 50], [127, 50], [128, 50], [129, 50]])).map((p) => p[3]);
  assert.deepEqual(alphas, [255, 255, 0, 0], `256px entry has a sharp vector edge, got ${alphas}`);
  await page.close();

  const webpPage = (await openPage('/webp-to-ico/')).page;
  const webp = await makeFixture(webpPage, 'image/webp', 48, 48);
  await webpPage.setInputFiles('#file', { name: 'site-logo.webp', mimeType: 'image/webp', buffer: webp });
  await waitForDone(webpPage, 1);
  out = await downloadBytes(webpPage, '#results a.btn');
  assert.equal(out.name, 'site-logo.ico');
  entries = inspectIco(out.bytes);
  const [l, r] = await pngPixels(webpPage, entries.find((e) => e.size === 48).bytes, [[5, 24], [42, 24]]);
  assert.equal(l[3], 0, 'transparent WebP pixels stay transparent');
  assert.equal(r[3], 255);
  await webpPage.close();

  const jpgPage = (await openPage('/jpg-to-ico/')).page;
  const jpeg = await makeFixture(jpgPage, 'image/jpeg', 100, 50);
  await jpgPage.setInputFiles('#file', { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg });
  await waitForDone(jpgPage, 1);
  out = await downloadBytes(jpgPage, '#results a.btn');
  entries = inspectIco(out.bytes);
  assert.deepEqual(entries.map((e) => e.size), [16, 32, 48, 256]);
  for (const e of entries) assert.deepEqual(e.bytes.subarray(0, 8), PNG_MAGIC);
  const [pad, photo] = await pngPixels(jpgPage, entries[2].bytes, [[24, 2], [24, 24]]);
  assert.equal(pad[3], 0, 'padding around a wide JPG is transparent');
  assert.equal(photo[3], 255, 'the JPG itself is opaque');
  await jpgPage.close();
});

test('jfif-to-jpg keeps the JPEG bytes unchanged; unticking re-encodes', async () => {
  const { page } = await openPage('/jfif-to-jpg/');
  assert.equal(await page.locator('#keep-jpeg').isChecked(), true);
  assert.equal(await page.locator('#quality-control').isVisible(), false, 'quality hidden while keeping data');
  const jpeg = await makeFixture(page, 'image/jpeg', 50, 30);
  await page.setInputFiles('#file', { name: 'Photo.jfif', mimeType: 'image/jpeg', buffer: jpeg });
  await waitForDone(page, 1);
  assert.match(await page.locator('#results .result-meta').first().textContent(), /JFIF .* → JPG .*original JPEG data kept.*50 × 30 px/);
  const kept = await downloadBytes(page, '#results a.btn');
  assert.equal(kept.name, 'Photo.jpg');
  assert.ok(kept.bytes.equals(jpeg), 'identical bytes');

  await page.uncheck('#keep-jpeg');
  assert.equal(await page.locator('#quality-control').isVisible(), true);
  await page.waitForFunction(() => /\(/.test(document.querySelector('#results .result-meta')?.textContent || '') && !/kept/.test(document.querySelector('#results .result-meta').textContent));
  await waitForDone(page, 1);
  const redone = await downloadBytes(page, '#results a.btn');
  assert.equal(redone.name, 'Photo.jpg');
  assert.ok(!redone.bytes.equals(jpeg), 're-encoded');
  assert.deepEqual(jpegSize(redone.bytes), { width: 50, height: 30 });
  await page.close();
});

test('guide pages with an embedded converter convert a pasted image', async () => {
  for (const g of guides.filter((x) => x.tool)) {
    const { page } = await openPage(`/${g.slug}/`);
    assert.equal(await page.locator('#format').inputValue(), g.tool.to, `${g.slug} defaults to ${g.tool.to}`);
    await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 12; c.height = 8;
      c.getContext('2d').fillRect(0, 0, 12, 8);
      const blob = await new Promise((r) => c.toBlob(r, 'image/webp'));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], 'image.webp', { type: 'image/webp' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await waitForDone(page, 1);
    assert.match(await page.locator('#results .result-meta').textContent(), /12 × 8 px/);
    assert.match(await page.locator('#results a.btn').getAttribute('download'), new RegExp(`\\.${{ tiff: 'tif' }[g.tool.to] || g.tool.to}$`));
    await page.close();
  }
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
  if (!canAvif) {
    assert.match(await page.locator('#format option[value="avif"]').textContent(), /not available in this browser/);
    assert.equal(await page.locator('#format-note').isVisible(), false, 'no standing note on the general converter');
  }
  console.log(`# note: this Chromium ${canAvif ? 'can' : 'cannot'} encode AVIF; option ${disabled ? 'disabled' : 'enabled'}`);
  await page.close();
});

const GIF_PAGES = ['png-to-gif', 'jpg-to-gif', 'webp-to-gif'];

/** Width, height and colour-table size from a GIF's header; asserts the GIF89a signature and trailer. */
function gifInfo(b) {
  assert.equal(b.subarray(0, 6).toString('latin1'), 'GIF89a');
  assert.equal(b[b.length - 1], 0x3b, 'ends with the GIF trailer');
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8), tableSize: 2 << (b[10] & 7), transparent: b.includes(Buffer.from([0x21, 0xf9, 0x04, 0x01])) };
}

/** A photo-like JPEG (smooth gradients, more than 256 colours) drawn and encoded in the page. */
async function makePhotoJpeg(page, w, h) {
  const bytes = await page.evaluate(async ({ w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#0b3d91'); g.addColorStop(0.5, '#f4a259'); g.addColorStop(1, '#5b8e7d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const r = ctx.createRadialGradient(w * 0.7, h * 0.3, 2, w * 0.7, h * 0.3, w * 0.4);
    r.addColorStop(0, 'rgba(255,255,230,0.9)'); r.addColorStop(1, 'rgba(255,255,230,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, w, h);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, { w, h });
  return Buffer.from(bytes);
}

/** Mean absolute RGB difference between two encoded images, both decoded by the browser. */
async function meanDifference(page, a, b) {
  return page.evaluate(async ({ a, b }) => {
    const px = async (bytes) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const [x, y] = [await px(a), await px(b)];
    let sum = 0;
    for (let i = 0; i < x.length; i += 4) sum += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
    return sum / (x.length / 4) / 3;
  }, { a: [...a], b: [...b] });
}

test('png-to-gif, jpg-to-gif and webp-to-gif build with their own title, h1, canonical, sitemap entry and GIF controls', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  assert.equal([...sitemap.matchAll(/<loc>/g)].length, converters.length + guides.length + 3, 'sitemap lists every page (converters, guides, extension, privacy, guides index)');
  for (const slug of GIF_PAGES) {
    const entry = converters.find((c) => c.slug === slug);
    assert.ok(entry, `${slug} is in site/pages.mjs`);
    assert.ok(sitemap.includes(`<loc>https://janwan2003.github.io/save-image-format/${slug}/</loc>`), `${slug} in sitemap`);
    const { page, resp } = await openPage(`/${slug}/`);
    assert.equal(resp.status(), 200);
    assert.equal(await page.title(), entry.title);
    assert.equal(await page.locator('h1').textContent(), entry.h1);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), `https://janwan2003.github.io/save-image-format/${slug}/`);
    assert.equal(await page.locator('#format').inputValue(), 'gif');
    await page.waitForSelector('[data-tool][data-ready="1"]', { state: 'attached' });
    assert.equal(await page.locator('#format option[value="gif"]').evaluate((o) => o.disabled), false, 'GIF is never switched off');
    assert.equal(await page.locator('#dither-control').isVisible(), true, 'dither option shown for GIF');
    assert.equal(await page.locator('#dither').isChecked(), true, 'dither on by default');
    for (const id of ['#quality-control', '#bg-control', '#ico-control', '#page-size-control']) {
      assert.equal(await page.locator(id).isVisible(), false, `${id} hidden for GIF`);
    }
    assert.equal(await page.locator('.links-grid a[aria-current="page"]').count(), 1);
    await page.close();
  }
  // The general converter offers GIF in its format menu and links the new pages.
  const { page } = await openPage('/');
  assert.ok((await page.locator('#format option').allTextContents()).includes('GIF'));
  await page.selectOption('#format', 'gif');
  assert.equal(await page.locator('#dither-control').isVisible(), true);
  await page.selectOption('#format', 'png');
  assert.equal(await page.locator('#dither-control').isVisible(), false, 'dither hidden for other formats');
  const labels = await page.locator('.links-grid a').allTextContents();
  for (const l of ['PNG to GIF', 'JPG to GIF', 'WebP to GIF']) assert.ok(labels.includes(l), `index links "${l}"`);
  await page.close();
  // Reverse pages link to the new ones in their text.
  const gifToPng = await readFile(join(DIST, 'gif-to-png/index.html'), 'utf8');
  assert.match(gifToPng, /<a href="\.\.\/png-to-gif\/">PNG to GIF<\/a>/);
});

test('png-to-gif keeps exact colours and turns transparent pixels into GIF transparency', async () => {
  const { page } = await openPage('/png-to-gif/');
  const png = await makeFixture(page, 'image/png', 40, 30); // left half transparent, right half #1e88e5
  await page.setInputFiles('#file', { name: 'logo.png', mimeType: 'image/png', buffer: png });
  await waitForDone(page, 1);
  assert.match(await page.locator('#results .result-meta').first().textContent(), /PNG .* → GIF .*40 × 30 px/);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'logo.gif');
  const info = gifInfo(bytes);
  assert.deepEqual([info.width, info.height], [40, 30]);
  assert.equal(info.transparent, true, 'has a Graphic Control Extension with the transparency flag');
  assert.equal(info.tableSize, 2, 'one colour + transparent');
  assert.equal((await pixelOfResult(page, 0, 5, 5))[3], 0, 'left half transparent');
  assert.deepEqual(await pixelOfResult(page, 0, 35, 5), [0x1e, 0x88, 0xe5, 255], 'right half keeps its exact colour');
  await page.close();
});

test('jpg-to-gif quantises a photo close to the source; unticking Dither re-converts to a different, valid GIF', async () => {
  const { page } = await openPage('/jpg-to-gif/');
  const jpg = await makePhotoJpeg(page, 240, 160);
  await page.setInputFiles('#file', { name: 'sunset.jpeg', mimeType: 'image/jpeg', buffer: jpg });
  await waitForDone(page, 1);
  const dithered = await downloadBytes(page, '#results a.btn');
  assert.equal(dithered.name, 'sunset.gif');
  const info = gifInfo(dithered.bytes);
  assert.deepEqual([info.width, info.height, info.tableSize, info.transparent], [240, 160, 256, false]);
  const errDithered = await meanDifference(page, jpg, dithered.bytes);

  const oldHref = await page.locator('#results a.btn').getAttribute('href');
  await page.uncheck('#dither');
  await page.waitForFunction((old) => {
    const href = document.querySelector('#results a.btn')?.getAttribute('href');
    return document.querySelector('#results li')?.dataset.state === 'done' && href && href !== old;
  }, oldHref);
  const plain = await downloadBytes(page, '#results a.btn');
  gifInfo(plain.bytes);
  assert.ok(!plain.bytes.equals(dithered.bytes), 'Dither off gives different output');
  const errPlain = await meanDifference(page, jpg, plain.bytes);
  console.log(`# jpg-to-gif 240x160: JPG ${jpg.length} B; GIF dithered ${dithered.bytes.length} B (mean error ${errDithered.toFixed(2)}), plain ${plain.bytes.length} B (mean error ${errPlain.toFixed(2)})`);
  assert.ok(errDithered < 8 && errPlain < 5, `colours close to the JPG (${errDithered}, ${errPlain})`);
  await page.close();
});

test('webp-to-gif converts a transparent WebP', async () => {
  const { page } = await openPage('/webp-to-gif/');
  const webp = await makeFixture(page, 'image/webp', 50, 20);
  await page.setInputFiles('#file', { name: 'sticker.webp', mimeType: 'image/webp', buffer: webp });
  await waitForDone(page, 1);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'sticker.gif');
  const info = gifInfo(bytes);
  assert.deepEqual([info.width, info.height, info.transparent], [50, 20, true]);
  assert.equal((await pixelOfResult(page, 0, 3, 10))[3], 0);
  const [r, g, b, a] = await pixelOfResult(page, 0, 45, 10);
  assert.ok(a === 255 && Math.abs(r - 0x1e) < 8 && Math.abs(g - 0x88) < 8 && Math.abs(b - 0xe5) < 8, `opaque half stays blue, got ${[r, g, b, a]}`);
  await page.close();
});

// HEIC fixtures made by scripts/make-heic-fixtures.mjs (our own HEIF writer around x265 output).
// quadrants.heic: 64×48, red / green / blue / yellow quadrants (TL, TR, BL, BR).
// grid-rotated.heic: 128×96 as a 2×2 tile grid with irot 90° anticlockwise, so it displays as 96×128
// with green / yellow / red / blue quadrants.
const HEIC_QUADRANTS = join(ROOT, 'tests/fixtures/quadrants.heic');
const HEIC_GRID = join(ROOT, 'tests/fixtures/grid-rotated.heic');
const near = (px, rgb, tol = 24) => rgb.every((v, i) => Math.abs(px[i] - v) <= tol);

async function quadrantColours(page, w, h) {
  const out = [];
  for (const [x, y] of [[w / 4, h / 4], [(3 * w) / 4, h / 4], [w / 4, (3 * h) / 4], [(3 * w) / 4, (3 * h) / 4]]) {
    out.push((await pixelOfResult(page, 0, x, y)).slice(0, 3));
  }
  return out;
}

test('heic-to-jpg decodes an HEIC photo with the WebAssembly decoder and writes a JPG with the right colours', async () => {
  const requests = [];
  const { page } = await openPage('/heic-to-jpg/');
  page.on('request', (r) => requests.push(new URL(r.url()).pathname));
  assert.equal(await page.locator('#format').inputValue(), 'jpg');
  assert.ok(!requests.some((p) => p.includes('libheif')), 'decoder not loaded before a HEIC file is added');
  await page.setInputFiles('#file', HEIC_QUADRANTS);
  await waitForDone(page, 1);
  assert.ok(requests.some((p) => p.endsWith('/vendor/libheif/libheif.wasm')), 'decoder loaded from this site');
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'quadrants.jpg');
  assert.deepEqual(bytes.subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff]));
  assert.deepEqual(jpegSize(bytes), { width: 64, height: 48 });
  const colours = await quadrantColours(page, 64, 48);
  [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]].forEach((rgb, i) => assert.ok(near(colours[i], rgb), `quadrant ${i}: ${colours[i]} ≈ ${rgb}`));
  assert.match(await page.locator('#results li').first().textContent(), /HEIC .* → JPG/);
  await page.close();
});

test('a Display P3 HEIC (as iPhones write) is converted to sRGB, matching Chromium\'s own colour management', async () => {
  // Same picture twice: untagged, and tagged with a Display P3 ICC profile (scripts/make-heic-fixtures.mjs).
  const { page } = await openPage('/heic-to-png/');
  await page.setInputFiles('#file', [join(ROOT, 'tests/fixtures/quadrants-p3-untagged.heic'), join(ROOT, 'tests/fixtures/quadrants-p3.heic')]);
  await waitForDone(page, 2);
  const points = [[16, 12], [48, 12], [16, 36], [48, 36]];
  const raw = [], tagged = [];
  for (const [x, y] of points) {
    raw.push((await pixelOfResult(page, 0, x, y)).slice(0, 3));
    tagged.push((await pixelOfResult(page, 1, x, y)).slice(0, 3));
  }
  // Reference: Chromium converting the same numbers, read as Display P3, to its sRGB canvas.
  const expected = await page.evaluate((raw) => raw.map(([r, g, b]) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.fillStyle = `color(display-p3 ${r / 255} ${g / 255} ${b / 255})`;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }), raw);
  expected.forEach((want, i) => {
    assert.ok(want.some((v, k) => Math.abs(v - raw[i][k]) >= 8), `quadrant ${i}: test colour must differ between P3 and sRGB`);
    assert.ok(want.every((v, k) => Math.abs(v - tagged[i][k]) <= 2), `quadrant ${i}: got ${tagged[i]}, Chromium says ${want} (untagged ${raw[i]})`);
  });
  await page.close();
});

test('heic-to-png applies the tile grid and the stored rotation (iPhone-style HEIC)', async () => {
  const { page } = await openPage('/heic-to-png/');
  await page.setInputFiles('#file', HEIC_GRID);
  await waitForDone(page, 1);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'grid-rotated.png');
  assert.deepEqual(bytes.subarray(0, 8), PNG_MAGIC);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [96, 128], 'rotated to portrait');
  const colours = await quadrantColours(page, 96, 128);
  [[0, 255, 0], [255, 255, 0], [255, 0, 0], [0, 0, 255]].forEach((rgb, i) => assert.ok(near(colours[i], rgb), `quadrant ${i}: ${colours[i]} ≈ ${rgb}`));
  await page.close();
});

test('WebP output wider than 16,383 px is refused with a clear message instead of being cropped', async () => {
  const { page } = await openPage('/png-to-webp/');
  const wide = await makeFixture(page, 'image/png', 16384, 4);
  await page.setInputFiles('#file', { name: 'panorama.png', mimeType: 'image/png', buffer: wide });
  await page.waitForSelector('#results li[data-state="error"]', { timeout: 15000 });
  const text = await page.locator('#results li[data-state="error"]').textContent();
  assert.match(text, /at most 16,383 pixels/);
  assert.match(text, /16384 × 4/);
  // 16,383 px is still allowed.
  await page.setInputFiles('#file', { name: 'edge.png', mimeType: 'image/png', buffer: await makeFixture(page, 'image/png', 16383, 4) });
  await waitForDone(page, 1);
  const { bytes } = await downloadBytes(page, '#results li[data-state="done"] a.btn');
  assert.equal(bytes.toString('latin1', 8, 12), 'WEBP');
  await page.close();
});

test('heic-to-pdf combines two HEIC photos into one 2-page PDF; a broken HEIC shows an error row', async () => {
  const { page } = await openPage('/heic-to-pdf/');
  assert.equal(await page.locator('#format').inputValue(), 'pdf');
  await page.setInputFiles('#file', [HEIC_QUADRANTS, HEIC_GRID]);
  await waitForDone(page, 2);
  const { name, bytes } = await downloadBytes(page, '#download-pdf');
  assert.equal(name, 'quadrants-and-1-more.pdf');
  const pages = inspectPdf(bytes);
  assert.equal(pages.length, 2);
  assert.deepEqual(jpegSize(pages[0].data), { width: 64, height: 48 });
  assert.deepEqual(jpegSize(pages[1].data), { width: 96, height: 128 });

  const broken = (await readFile(HEIC_QUADRANTS)).subarray(0, 300); // container intact, image data cut off
  await page.setInputFiles('#file', { name: 'broken.heic', mimeType: 'image/heic', buffer: broken });
  await page.waitForSelector('#results li[data-state="error"]', { timeout: 15000 });
  assert.match(await page.locator('#results li[data-state="error"]').textContent(), /iPhone/);
  await page.close();
});

test('the HEIC guide embeds a HEIC to JPG converter that decodes a HEIC file', async () => {
  const { page } = await openPage('/how-to-open-heic-files-on-windows/');
  assert.equal(await page.locator('#format').inputValue(), 'jpg');
  await page.setInputFiles('#file', HEIC_GRID);
  await waitForDone(page, 1);
  assert.match(await page.locator('#results .result-meta').textContent(), /HEIC .*96 × 128 px/);
  await page.close();
});

test('the general converter also accepts HEIC', async () => {
  const { page } = await openPage('/');
  assert.match(await page.locator('#file').getAttribute('accept'), /\.heic/);
  await page.setInputFiles('#file', HEIC_QUADRANTS);
  await waitForDone(page, 1);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'quadrants.png');
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [64, 48]);
  await page.close();
});

/** Width and height from a WebP header (lossy VP8, lossless VP8L or extended VP8X); asserts RIFF/WEBP. */
function webpSize(b) {
  assert.equal(b.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(b.subarray(8, 12).toString('latin1'), 'WEBP');
  const chunk = b.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3), extended: true };
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff, extended: false };
  if (chunk === 'VP8L') { const v = b.readUInt32LE(21); return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff), extended: false }; }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

// AVIF fixture (ImageMagick 7.1.2 with libheif 1.21.2):
//   magick -size 64x48 xc:none -fill '#ff0000' -draw 'rectangle 0,0 31,23' -fill '#00ff00' -draw 'rectangle 32,0 63,23'
//     -fill '#0000ff' -draw 'rectangle 0,24 31,47' -quality 90 tests/fixtures/quadrants-alpha.avif
// 64×48: red / green / blue quadrants (TL, TR, BL), bottom-right quadrant fully transparent.
const AVIF_QUADRANTS = join(ROOT, 'tests/fixtures/quadrants-alpha.avif');
const WEBP_PAGES = ['heic-to-webp', 'avif-to-webp'];
const DOWNLOAD_ALL_GUIDE = 'how-to-download-all-images-from-a-page';

test('heic-to-webp, avif-to-webp and the download-all guide build with their own title, h1, canonical, sitemap entry and links', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  const entries = [
    ...WEBP_PAGES.map((slug) => ({ slug, entry: converters.find((c) => c.slug === slug) })),
    { slug: DOWNLOAD_ALL_GUIDE, entry: guides.find((g) => g.slug === DOWNLOAD_ALL_GUIDE) },
  ];
  for (const { slug, entry } of entries) {
    assert.ok(entry, `${slug} is defined`);
    assert.ok(sitemap.includes(`<loc>https://janwan2003.github.io/save-image-format/${slug}/</loc>`), `${slug} in sitemap`);
    const { page, resp } = await openPage(`/${slug}/`);
    assert.equal(resp.status(), 200);
    assert.equal(await page.title(), entry.title);
    assert.equal(await page.locator('h1').textContent(), entry.h1);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), `https://janwan2003.github.io/save-image-format/${slug}/`);
    if (WEBP_PAGES.includes(slug)) {
      assert.equal(await page.locator('#format').inputValue(), 'webp', `${slug} defaults to WebP`);
      assert.equal(await page.locator('.links-grid a[aria-current="page"]').textContent(), slug === 'heic-to-webp' ? 'HEIC to WebP' : 'AVIF to WebP');
    } else {
      assert.equal(await page.locator('[data-tool]').count(), 0, 'the guide has no embedded converter');
      const ext = page.locator('article .prose a[href="../extension/"]');
      assert.ok(await ext.count() >= 1, 'the guide links the extension page');
      assert.ok(await page.locator('article .prose a[href^="https://chromewebstore.google.com/detail/"]').count() >= 1, 'the guide links the live Chrome Web Store listing');
    }
    await page.close();
  }
  // Linked from the other pages: converter grids and the footer guide list.
  const { page } = await openPage('/webp-to-png/');
  const labels = await page.locator('.links-grid a').allTextContents();
  for (const l of ['HEIC to WebP', 'AVIF to WebP']) assert.ok(labels.includes(l), `converter grid links "${l}"`);
  assert.equal(await page.locator(`footer a[href="../${DOWNLOAD_ALL_GUIDE}/"]`).count(), 1, 'footer links the new guide');
  await page.close();
});

test('heic-to-webp decodes HEIC photos (plain and iPhone-style grid + rotation) into WebP files with the right size and colours', async () => {
  const { page } = await openPage('/heic-to-webp/');
  await page.setInputFiles('#file', [HEIC_QUADRANTS, HEIC_GRID]);
  await waitForDone(page, 2);
  const rows = page.locator('#results li');

  const [dl1] = await Promise.all([page.waitForEvent('download'), rows.nth(0).locator('a.btn').click()]);
  const first = await readFile(await dl1.path());
  assert.equal(dl1.suggestedFilename(), 'quadrants.webp');
  assert.deepEqual((({ width, height }) => ({ width, height }))(webpSize(first)), { width: 64, height: 48 });
  const colours = await quadrantColours(page, 64, 48);
  [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]].forEach((rgb, i) => assert.ok(near(colours[i], rgb), `quadrant ${i}: ${colours[i]} ≈ ${rgb}`));
  assert.match(await rows.nth(0).textContent(), /HEIC .* → WebP/);

  const [dl2] = await Promise.all([page.waitForEvent('download'), rows.nth(1).locator('a.btn').click()]);
  const second = await readFile(await dl2.path());
  assert.equal(dl2.suggestedFilename(), 'grid-rotated.webp');
  assert.deepEqual((({ width, height }) => ({ width, height }))(webpSize(second)), { width: 96, height: 128 }, 'tiles joined and rotated to portrait');
  await page.close();
});

test('avif-to-webp converts an AVIF with transparency into a WebP that keeps the alpha channel', async () => {
  const { page } = await openPage('/avif-to-webp/');
  assert.equal(await page.locator('#format').inputValue(), 'webp');
  await page.setInputFiles('#file', AVIF_QUADRANTS);
  await waitForDone(page, 1);
  const { name, bytes } = await downloadBytes(page, '#results a.btn');
  assert.equal(name, 'quadrants-alpha.webp');
  const size = webpSize(bytes);
  assert.deepEqual([size.width, size.height], [64, 48]);
  assert.ok(size.extended && bytes.includes(Buffer.from('ALPH')), 'WebP carries an alpha chunk');
  assert.match(await page.locator('#results li').first().textContent(), /AVIF .* → WebP/);
  const opaque = await quadrantColours(page, 64, 48);
  [[255, 0, 0], [0, 255, 0], [0, 0, 255]].forEach((rgb, i) => assert.ok(near(opaque[i], rgb), `quadrant ${i}: ${opaque[i]} ≈ ${rgb}`));
  assert.equal((await pixelOfResult(page, 0, 48, 36))[3], 0, 'bottom-right quadrant stays transparent');
  assert.equal((await pixelOfResult(page, 0, 16, 12))[3], 255, 'top-left quadrant stays opaque');
  await page.close();
});

const TIFF_DIR = join(ROOT, 'tests/fixtures/tiff');
// File names in a ZIP, from the central directory.
function zipEntryNames(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const n = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    names.push(buf.subarray(p + 46, p + 46 + n).toString('utf8'));
    p += 46 + n + extra + comment;
  }
  return names;
}
const tiffManifest = JSON.parse(await readFile(join(TIFF_DIR, 'manifest.json'), 'utf8'));

/** Every pixel of the n-th result thumbnail (PNG output) compared with ImageMagick's RGBA. */
async function compareResult(page, index, expected, tolerance) {
  return page.evaluate(async ({ index, expected, tolerance }) => {
    const img = document.querySelectorAll('#results .thumb')[index];
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const got = ctx.getImageData(0, 0, c.width, c.height).data;
    // The canvas keeps pixels premultiplied, so colour in semi-transparent pixels is only exact
    // to about 255/alpha; fully transparent pixels have no colour at all. (tiff.test.mjs checks
    // the decoder's own output exactly.)
    let bad = 0, max = 0;
    for (let i = 0; i < expected.length; i++) {
      const a = expected[i | 3];
      if (a === 0 && (i & 3) !== 3) continue;
      const tol = (i & 3) === 3 || a === 255 ? tolerance : Math.max(tolerance, Math.ceil(255 / a));
      const d = Math.abs(got[i] - expected[i]);
      if (d > tol) { bad++; max = Math.max(max, d); }
    }
    return { width: c.width, height: c.height, bad, max };
  }, { index, expected: [...gunzipSync(await readFile(join(TIFF_DIR, expected)))], tolerance });
}

test('tiff-to-png decodes JPEG-in-TIFF, LZW with alpha, tiles, CMYK, fax G4 and 16-bit TIFFs like ImageMagick', async () => {
  const { page } = await openPage('/tiff-to-png/');
  assert.equal(await page.locator('#format').inputValue(), 'png');
  const names = ['jpeg-ycbcr', 'rgba8-lzw', 'gray8-tiled', 'cmyk8', 'bilevel-g4', 'rgb16-be-deflate', 'orient6'];
  await page.setInputFiles('#file', names.map((n) => join(TIFF_DIR, `${n}.tif`)));
  await waitForDone(page, names.length);
  for (const [i, n] of names.entries()) {
    const c = tiffManifest[n];
    const r = await compareResult(page, i, c.expected, c.tolerance);
    assert.deepEqual([r.width, r.height], [c.width, c.height], n);
    assert.equal(r.bad, 0, `${n}: ${r.bad} channel values off by more than ${c.tolerance} (max ${r.max})`);
  }
  assert.match(await page.locator('#results .result-meta').first().textContent(), /^TIFF .* → PNG .*96 × 64 px/);
  await page.close();
});

test('tiff-to-pdf splits a multi-page TIFF into rows and combines them with a fax page into one PDF', async () => {
  const { page } = await openPage('/tiff-to-pdf/');
  assert.equal(await page.locator('#format').inputValue(), 'pdf');
  await page.setInputFiles('#file', [join(TIFF_DIR, 'multipage.tif'), join(TIFF_DIR, 'bilevel-g3.tif')]);
  await waitForDone(page, 4);
  const labels = await page.locator('#results .result-name').allTextContents();
  assert.deepEqual(labels, ['multipage-page-1.pdf', 'multipage-page-2.pdf', 'multipage-page-3.pdf', 'bilevel-g3.pdf']);
  assert.equal(await page.locator('#results .thumb[src]').count(), 4, 'every PDF row shows a preview of its page');
  const { name, bytes } = await downloadBytes(page, '#download-pdf');
  assert.equal(name, 'multipage-page-1-and-3-more.pdf');
  const pages = inspectPdf(bytes);
  assert.equal(pages.length, 4);
  assert.deepEqual(jpegSize(pages[0].data), { width: 40, height: 30 });
  // The fax page is pure black and white: stored losslessly at 1 bit per pixel, not as JPEG.
  assert.deepEqual([pages[3].filter, pages[3].colorSpace, pages[3].bpc, pages[3].width, pages[3].height], ['FlateDecode', 'DeviceGray', 1, 96, 64]);
  const bits = pages[3].pixels();
  const want = gunzipSync(await readFile(join(TIFF_DIR, tiffManifest['bilevel-g3'].expected)));
  let wrong = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 96; x++) {
    const white = (bits[y * 12 + (x >> 3)] >> (7 - (x & 7))) & 1;
    if (white * 255 !== want[(y * 96 + x) * 4]) wrong++;
  }
  assert.equal(wrong, 0, 'fax page pixels exact');
  assert.ok(pages[3].data.length < 2000, `fax page is small (${pages[3].data.length} bytes)`);
  // Pages keep their own colours: decode each page's JPEG and read its centre.
  const centres = await page.evaluate(async (jpegs) => Promise.all(jpegs.map(async (b) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(b)], { type: 'image/jpeg' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    return [...g.getImageData(bmp.width >> 1, bmp.height >> 1, 1, 1).data.slice(0, 3)];
  })), pages.slice(0, 3).map((p) => [...p.data]));
  [[0xd0, 0x20, 0x20], [0x20, 0xa0, 0x40], [0x20, 0x40, 0xc0]].forEach((rgb, i) => assert.ok(near(centres[i], rgb, 12), `page ${i + 1}: ${centres[i]} ≈ ${rgb}`));
  await page.close();
});

test('tiff-to-jpg: multi-page TIFF gives numbered JPGs in a ZIP; a broken TIFF shows an error row', async () => {
  const { page } = await openPage('/tiff-to-jpg/');
  await page.setInputFiles('#file', join(TIFF_DIR, 'multipage.tif'));
  await waitForDone(page, 3);
  const { name, bytes } = await downloadBytes(page, '#download-all');
  assert.equal(name, 'saveform-jpg-images.zip');
  const entries = zipEntryNames(bytes);
  assert.deepEqual(entries, ['multipage-page-1.jpg', 'multipage-page-2.jpg', 'multipage-page-3.jpg']);
  const broken = (await readFile(join(TIFF_DIR, 'pil-rgb-lzw-le.tif'))).subarray(0, 4000);
  await page.setInputFiles('#file', { name: 'scan.tif', mimeType: 'image/tiff', buffer: broken });
  await page.waitForSelector('#results li[data-state="error"]', { timeout: 15000 });
  assert.match(await page.locator('#results li[data-state="error"]').textContent(), /truncated or damaged/);
  await page.close();
});

test('a Display P3 tagged TIFF is converted to sRGB like Chromium does it; the general converter takes TIFF', async () => {
  const { page } = await openPage('/');
  await page.selectOption('#format', 'png');
  await page.setInputFiles('#file', [join(TIFF_DIR, 'quadrants-untagged.tif'), join(TIFF_DIR, 'quadrants-p3.tif')]);
  await waitForDone(page, 2);
  const points = [[16, 12], [48, 12], [16, 36], [48, 36]];
  const raw = [], tagged = [];
  for (const [x, y] of points) {
    raw.push((await pixelOfResult(page, 0, x, y)).slice(0, 3));
    tagged.push((await pixelOfResult(page, 1, x, y)).slice(0, 3));
  }
  const expected = await page.evaluate((raw) => raw.map(([r, g, b]) => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d');
    ctx.fillStyle = `color(display-p3 ${r / 255} ${g / 255} ${b / 255})`;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  }), raw);
  expected.forEach((want, i) => {
    assert.ok(want.some((v, k) => Math.abs(v - raw[i][k]) >= 8), `quadrant ${i}: test colour must differ between P3 and sRGB`);
    assert.ok(want.every((v, k) => Math.abs(v - tagged[i][k]) <= 2), `quadrant ${i}: got ${tagged[i]}, Chromium says ${want} (untagged ${raw[i]})`);
  });
  await page.close();
});

test('every page loads with one h1, unique title/description, valid JSON-LD and working internal links', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname.slice(BASE_PATH.length));
  const expected = converters.length + guides.length + 3; // + extension, privacy, guides index
  assert.equal(urls.length, expected);
  for (const g of guides) assert.ok(urls.includes(`/${g.slug}/`), `sitemap lists guide ${g.slug}`);
  for (const c of converters) assert.ok(urls.includes(c.slug ? `/${c.slug}/` : '/'), `sitemap lists converter ${c.slug || 'index'}`);
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
    const isConverter = converters.some((c) => (c.slug ? `/${c.slug}/` : '/') === path);
    if (isConverter) {
      const faq = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()));
      assert.equal(faq['@type'], 'FAQPage');
      assert.ok(faq.mainEntity.length >= 4 && faq.mainEntity.length <= 5, `${path} FAQ has 4-5 questions`);
      assert.equal(await page.locator('.links-grid a').count(), converters.length, `${path} links to all converters`);
      assert.equal(await page.locator('.guide-links a').count(), guides.length, `${path} links to all guides`);
    }
    const guide = guides.find((g) => `/${g.slug}/` === path);
    if (guide) {
      const article = JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent());
      assert.equal(article['@type'], 'Article');
      assert.equal(article.headline, await page.locator('h1').textContent());
      const words = (await page.locator('article .prose').innerText()).split(/\s+/).filter(Boolean).length;
      assert.ok(words >= 450 && words <= 1000, `${path} has ${words} words of guide text`);
      assert.equal(await page.locator('.guide-links a').count(), guide.related.length, `${path} links its related guides`);
      assert.equal(await page.locator('[data-tool]').count(), guide.tool ? 1 : 0, `${path} embeds the converter only when configured`);
    }
    const footerHrefs = await page.locator('footer a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    assert.ok(footerHrefs.some((h) => h.endsWith('guides/')), `${path} footer links the guides index`);
    // Every same-site link resolves to a file in dist/.
    for (const href of await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.href))) {
      const u = new URL(href);
      if (u.origin !== origin) continue;
      const target = join(DIST, u.pathname.endsWith('/') ? `${u.pathname}index.html` : u.pathname);
      assert.ok(existsSync(target), `${path} links to missing ${u.pathname}`);
    }
    await page.close();
  }
  assert.equal(titles.size, expected, 'titles are unique');
  assert.equal(descriptions.size, expected, 'descriptions are unique');

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
  assert.equal(await readFile(join(DIST, 'lib/gif.js'), 'utf8'), await readFile(join(ROOT, 'extension/lib/gif.js'), 'utf8'));
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

// ---- TIFF output ---------------------------------------------------------------------------
async function tiffPixels(bytes, page = 0) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
  return globalThis.SaveformTiff.decode(buf, page);
}

test('TIFF output: PNG with alpha and a JPG become exact TIFFs; Download one TIFF joins them in list order', async () => {
  const { page } = await openPage('/');
  await page.selectOption('#format', 'tiff');
  assert.equal(await page.locator('#tiff-control').isVisible(), true);
  assert.equal(await page.locator('#quality-control').isVisible(), false, 'TIFF is lossless: no quality slider');
  const png = await makeFixture(page, 'image/png', 40, 20);
  const jpg = await makePhotoJpeg(page, 64, 48);
  await page.setInputFiles('#file', [
    { name: 'logo.png', mimeType: 'image/png', buffer: png },
    { name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpg },
  ]);
  await waitForDone(page, 2);
  assert.deepEqual(await page.locator('#results .result-name').allTextContents(), ['logo.tif', 'photo.tif']);
  assert.equal(await page.locator('#download-tiff').isVisible(), true);
  assert.equal(await page.locator('#download-pdf').isVisible(), false);
  assert.equal(await page.locator('#results .thumb[src]').count(), 2, 'TIFF rows show a preview');
  const one = await downloadBytes(page, '#results li:first-child a.btn');
  assert.equal(one.name, 'logo.tif');
  const logo = await tiffPixels(one.bytes);
  assert.deepEqual([logo.width, logo.height], [40, 20]);
  assert.deepEqual([...logo.data.subarray(0, 4)], [0, 0, 0, 0], 'transparent pixel kept');
  assert.deepEqual([...logo.data.subarray(39 * 4, 40 * 4)], [0x1e, 0x88, 0xe5, 255], 'opaque pixel exact');
  // Reorder: photo first, then Download one TIFF.
  await page.click('#results li:nth-child(2) .move');
  assert.match(await page.locator('#download-tiff').textContent(), /2 pages/);
  const multi = await downloadBytes(page, '#download-tiff');
  assert.equal(multi.name, 'photo-and-1-more.tif');
  const buf = multi.bytes.buffer.slice(multi.bytes.byteOffset, multi.bytes.byteOffset + multi.bytes.length);
  assert.equal(globalThis.SaveformTiff.pages(buf), 2);
  const p1 = await tiffPixels(multi.bytes, 0), p2 = await tiffPixels(multi.bytes, 1);
  assert.deepEqual([p1.width, p1.height, p2.width, p2.height], [64, 48, 40, 20]);
  // The photo page holds exactly the pixels the browser decodes from the JPEG.
  const decoded = await page.evaluate(async (b) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(b)], { type: 'image/jpeg' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
    return [...g.getImageData(0, 0, bmp.width, bmp.height).data];
  }, [...jpg]);
  assert.ok(Buffer.from(p1.data).equals(Buffer.from(decoded)), 'JPG → TIFF is lossless after decoding');
  await page.close();
});

test('TIFF output: a fax TIFF stays 1-bit, a multi-page TIFF round-trips, Compression None writes uncompressed strips', async () => {
  const { page } = await openPage('/');
  await page.selectOption('#format', 'tiff');
  await page.setInputFiles('#file', [join(TIFF_DIR, 'bilevel-g4.tif'), join(TIFF_DIR, 'multipage.tif')]);
  await waitForDone(page, 4);
  const fax = await downloadBytes(page, '#results li:first-child a.btn');
  const faxPx = await tiffPixels(fax.bytes);
  const want = gunzipSync(await readFile(join(TIFF_DIR, tiffManifest['bilevel-g4'].expected)));
  assert.ok(Buffer.from(faxPx.data).equals(want), 'fax pixels exact');
  const bps = fax.bytes.readUInt16LE(fax.bytes.indexOf(Buffer.from([0x02, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00])) + 8);
  assert.equal(bps, 1, 'BitsPerSample 1');
  const all = await downloadBytes(page, '#download-tiff');
  const buf = all.bytes.buffer.slice(all.bytes.byteOffset, all.bytes.byteOffset + all.bytes.length);
  assert.equal(globalThis.SaveformTiff.pages(buf), 4);
  for (const k of [0, 1, 2]) {
    const got = await tiffPixels(all.bytes, k + 1);
    const exp = gunzipSync(await readFile(join(TIFF_DIR, tiffManifest[`multipage-p${k}`]?.expected || `multipage-p${k}.rgba.gz`)));
    assert.ok(Buffer.from(got.data).equals(exp), `page ${k + 2} exact`);
  }
  await page.selectOption('#tiff-compression', 'none');
  await waitForDone(page, 4);
  const raw = await downloadBytes(page, '#results li:nth-child(2) a.btn');
  // Compression tag (259) = 1 and the file is at least width × height × 3 bytes.
  const comp = raw.bytes.indexOf(Buffer.from([0x03, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00]));
  assert.equal(raw.bytes.readUInt16LE(comp + 8), 1);
  assert.ok(raw.bytes.length >= 40 * 30 * 3);
  await page.close();
});
