// The converter site in real Firefox, driven over WebDriver by geckodriver: HEIC decoding
// (Web Worker + WebAssembly under the page CSP), single image and tile grid with rotation.
// Skipped when firefox or geckodriver is missing. site.test.mjs covers the site in Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');
const has = (bin) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
const skip = !(has('firefox') && has('geckodriver')) && 'firefox or geckodriver not installed';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };

let server, origin, driver, base;
const requests = [];

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function wd(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (j.value?.error) throw new Error(`${url}: ${j.value.error}: ${j.value.message}`);
  return j.value;
}
const run = (fnBody, ...args) => wd('POST', '/execute/async', {
  script: `const done = arguments[arguments.length - 1]; (async (...a) => { ${fnBody} })(...Array.from(arguments).slice(0, -1)).then(done, (e) => done({ error: String(e) }));`,
  args,
});

before(async () => {
  if (skip) return;
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-site.mjs')], { stdio: 'pipe' });
  server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/save-image-format/, '');
    requests.push(p);
    let file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}/save-image-format`;

  const port = await freePort();
  driver = spawn('geckodriver', ['--port', String(port)], { stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/status'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const s = await fetch(base + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { args: ['-headless'] } } } }) }).then((r) => r.json());
  if (!s.value?.sessionId) throw new Error('no session: ' + JSON.stringify(s).slice(0, 300));
  base += `/session/${s.value.sessionId}`;
});

after(async () => {
  if (skip) return;
  try { await fetch(base, { method: 'DELETE' }); } catch { /* ignore */ }
  driver?.kill();
  server?.close();
});

/** Open a converter page, hand it a file through the real file input, wait for the row to finish. */
async function convert(slug, file) {
  await wd('POST', '/url', { url: `${origin}/${slug}/` });
  const input = await wd('POST', '/element', { using: 'css selector', value: '#file' });
  await wd('POST', `/element/${Object.values(input)[0]}/value`, { text: file });
  return run(`
    for (let i = 0; i < 200; i++) {
      const li = document.querySelector('#results li');
      if (li && (li.dataset.state === 'done' || li.dataset.state === 'error')) {
        const img = li.querySelector('.thumb');
        const out = { state: li.dataset.state, text: li.innerText.replace(/\\s+/g, ' ') };
        if (img) {
          await img.decode();
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
          const g = c.getContext('2d'); g.drawImage(img, 0, 0);
          const w = c.width, h = c.height;
          out.size = [w, h];
          out.quadrants = [[w / 4, h / 4], [3 * w / 4, h / 4], [w / 4, 3 * h / 4], [3 * w / 4, 3 * h / 4]]
            .map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)));
        }
        return out;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { state: 'timeout' };`);
}

const near = (px, rgb, tol = 24) => rgb.every((v, i) => Math.abs(px[i] - v) <= tol);

test('Firefox: heic-to-jpg decodes a HEIC photo with the WebAssembly decoder', { skip }, async () => {
  const r = await convert('heic-to-jpg', path.join(ROOT, 'tests/fixtures/quadrants.heic'));
  assert.equal(r.state, 'done', JSON.stringify(r));
  assert.match(r.text, /HEIC .* → JPG/);
  assert.deepEqual(r.size, [64, 48]);
  [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]].forEach((rgb, i) => assert.ok(near(r.quadrants[i], rgb), `quadrant ${i}: ${r.quadrants[i]}`));
  assert.ok(requests.includes('/vendor/libheif/libheif.wasm'), 'decoder fetched from this site');
});

test('Firefox: heic-to-png applies the tile grid and rotation', { skip }, async () => {
  const r = await convert('heic-to-png', path.join(ROOT, 'tests/fixtures/grid-rotated.heic'));
  assert.equal(r.state, 'done', JSON.stringify(r));
  assert.deepEqual(r.size, [96, 128]);
  [[0, 255, 0], [255, 255, 0], [255, 0, 0], [0, 0, 255]].forEach((rgb, i) => assert.ok(near(r.quadrants[i], rgb), `quadrant ${i}: ${r.quadrants[i]}`));
});

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

test('Firefox: tiff-to-png decodes LZW, JPEG-in-TIFF and fax G4 TIFFs in the worker', { skip }, async () => {
  const lzw = await convert('tiff-to-png', path.join(ROOT, 'tests/fixtures/tiff/quadrants-untagged.tif'));
  assert.equal(lzw.state, 'done', JSON.stringify(lzw));
  assert.match(lzw.text, /TIFF .* → PNG/);
  assert.deepEqual(lzw.size, [64, 48]);
  ['#c87830', '#30b040', '#3070c8', '#b04090'].forEach((h, i) => assert.ok(near(lzw.quadrants[i], hex(h), 1), `quadrant ${i}: ${lzw.quadrants[i]} ≈ ${h}`));
  assert.ok(requests.includes('/assets/tiff-worker.js'), 'decoder worker fetched from this site');
  const jpeg = await convert('tiff-to-png', path.join(ROOT, 'tests/fixtures/tiff/jpeg-ycbcr.tif'));
  assert.equal(jpeg.state, 'done', JSON.stringify(jpeg));
  assert.deepEqual(jpeg.size, [96, 64]);
  const fax = await convert('tiff-to-png', path.join(ROOT, 'tests/fixtures/tiff/bilevel-g4.tif'));
  assert.equal(fax.state, 'done', JSON.stringify(fax));
  assert.deepEqual(fax.size, [96, 64]);
});
