// End-to-end test of the Firefox build (scripts/pack-extension.mjs buildFirefoxDir) in real
// Firefox, driven over WebDriver by geckodriver. Skipped when firefox or geckodriver is missing.
// As in extension.test.mjs, a context-menu click cannot be automated, so the test calls the
// handler the menu calls (saveform.handleClick on the background page) with the same arguments
// Firefox passes; a host permission for 127.0.0.1 stands in for the activeTab grant.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { buildFirefoxDir } from '../scripts/pack-extension.mjs';
import { inspectPdf } from './pdf-inspect.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const has = (bin) => { try { execFileSync('which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
const skip = !(has('firefox') && has('geckodriver')) && 'firefox or geckodriver not installed';

const ADDON_ID = 'saveform@save-image-format';
const UUID = randomUUID();
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#e11d48"/></svg>';
let server, cdn, pagePort, cdnPort, driver, base, tmp, downloads, pageHandle, extHandle;
const fixtures = {};

const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function wd(method, url, body) {
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json();
  if (j.value?.error) throw new Error(`${url}: ${j.value.error}: ${j.value.message}`);
  return j.value;
}
// Runs an async function body in the current browsing context and returns its result.
const run = (fnBody, ...args) => wd('POST', '/execute/async', {
  script: `const done = arguments[arguments.length - 1]; (async (...a) => { ${fnBody} })(...Array.from(arguments).slice(0, -1)).then(done, (e) => done({ error: String(e) }));`,
  args,
});

before(async () => {
  if (skip) return;
  // Snap Firefox can only write to non-hidden folders under $HOME, so keep the scratch dir in the repo.
  tmp = await mkdtemp(path.join(ROOT, 'tmp-firefox-test-'));
  downloads = path.join(tmp, 'downloads');
  await mkdir(downloads);
  const ext = await buildFirefoxDir(path.join(tmp, 'ext'));
  const mf = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
  mf.host_permissions = ['http://127.0.0.1/*']; // stand-in for activeTab (see top comment)
  await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(mf));
  const xpi = path.join(tmp, 'saveform.xpi');
  execFileSync('zip', ['-r', '-q', xpi, '.'], { cwd: ext });

  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/page.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><h1>test page</h1>'); return; }
    const f = fixtures[url.pathname.split('/').pop()];
    if (!f) { res.writeHead(404); res.end(); return; }
    const headers = { 'content-type': f.type };
    if (url.pathname.startsWith('/cors/')) headers['access-control-allow-origin'] = '*';
    res.writeHead(200, headers); res.end(f.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  pagePort = server.address().port;
  cdn = http.createServer((q, s) => server.emit('request', q, s));
  await new Promise((r) => cdn.listen(0, '127.0.0.1', r));
  cdnPort = cdn.address().port;

  const port = await freePort();
  driver = spawn('geckodriver', ['--port', String(port), '--allow-system-access'], { stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + '/status'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const s = await fetch(base + '/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': {
    args: ['-headless'],
    prefs: {
      'extensions.webextensions.uuids': JSON.stringify({ [ADDON_ID]: UUID }),
      'browser.download.folderList': 2, 'browser.download.dir': downloads, 'browser.download.useDownloadDir': true,
      'browser.download.always_ask_before_handling_new_types': false,
    },
  } } } }) }).then((r) => r.json());
  if (!s.value?.sessionId) throw new Error('no session: ' + JSON.stringify(s).slice(0, 300));
  base += `/session/${s.value.sessionId}`;
  await wd('POST', '/moz/addon/install', { path: xpi, temporary: true });

  await wd('POST', '/url', { url: `http://127.0.0.1:${pagePort}/page.html` });
  pageHandle = await wd('GET', '/window');
  // Real WebP fixture from Firefox's own encoder: 64x48, left half transparent.
  const webp = await run(`const c = document.createElement('canvas'); c.width = 64; c.height = 48;
    const g = c.getContext('2d'); g.fillStyle = '#16a34a'; g.fillRect(32, 0, 32, 48);
    const b = await new Promise((r) => c.toBlob(r, 'image/webp', 1));
    return Array.from(new Uint8Array(await b.arrayBuffer()));`);
  const buf = Buffer.from(webp);
  assert.equal(buf.subarray(8, 12).toString(), 'WEBP', 'Firefox encoded the WebP fixture');
  fixtures['same.webp'] = { body: buf, type: 'image/webp' };
  fixtures['photo.webp'] = { body: buf, type: 'image/webp' };
  fixtures['logo.svg'] = { body: Buffer.from(SVG), type: 'image/svg+xml' };

  // A second tab on an extension page, from which the test reaches the background page.
  // WebDriver refuses to navigate to moz-extension: URLs, so the browser chrome opens the tab.
  const before = await wd('GET', '/window/handles');
  await wd('POST', '/moz/context', { context: 'chrome' });
  await wd('POST', '/execute/sync', { script: `gBrowser.selectedTab = gBrowser.addTab(arguments[0],
    { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`, args: [`moz-extension://${UUID}/options.html`] });
  await wd('POST', '/moz/context', { context: 'content' });
  for (let i = 0; i < 50 && !extHandle; i++) {
    extHandle = (await wd('GET', '/window/handles')).find((h) => !before.includes(h));
    if (!extHandle) await new Promise((r) => setTimeout(r, 100));
  }
  await wd('POST', '/window', { handle: extHandle });
  for (let i = 0; i < 50 && !String(await wd('GET', '/url')).startsWith('moz-extension:'); i++) await new Promise((r) => setTimeout(r, 100));
  await run(`await browser.storage.sync.set({ askWhere: false });`);
});

after(async () => {
  if (skip) return;
  try { await fetch(base, { method: 'DELETE' }); } catch { /* ignore */ }
  driver?.kill();
  server?.close(); cdn?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

async function click(menuItemId, srcUrl) {
  return run(`const [menuItemId, srcUrl] = a;
    const [tab] = await browser.tabs.query({ url: 'http://127.0.0.1/*' });
    const bg = await browser.runtime.getBackgroundPage();
    return bg.saveform.handleClick({ menuItemId, srcUrl, frameId: 0 }, { id: tab.id });`, menuItemId, srcUrl);
}

async function savedFile(name) {
  for (let i = 0; i < 100; i++) {
    const files = (await readdir(downloads)).filter((f) => f === name);
    if (files.length) {
      const buf = await readFile(path.join(downloads, name));
      if (buf.length) return buf;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${name} not downloaded; have: ${(await readdir(downloads)).join(', ')}`);
}

function magic(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return 'unknown';
}

test('Firefox: background loads and builds the menu', { skip }, async () => {
  const r = await run(`const bg = await browser.runtime.getBackgroundPage(); return { ids: [...bg.saveform.menuIds], ua: navigator.userAgent };`);
  console.log('# ' + r.ua);
  for (const id of ['saveform', 'save:png', 'save:jpg', 'save:webp', 'save:pdf', 'copy:png']) assert.ok(r.ids.includes(id), id);
});

test('Firefox: same-site WebP -> PNG', { skip }, async () => {
  const res = await click('save:png', `http://127.0.0.1:${pagePort}/same.webp`);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(magic(await savedFile('same.png')), 'png');
});

test('Firefox: CORS CDN WebP -> JPG', { skip }, async () => {
  const res = await click('save:jpg', `http://localhost:${cdnPort}/cors/photo.webp`);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(magic(await savedFile('photo.jpg')), 'jpeg');
});

test('Firefox: SVG renders on the event page (no offscreen API) -> PNG', { skip }, async () => {
  const res = await click('save:png', `http://localhost:${cdnPort}/cors/logo.svg`);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(res.width >= 1024, `rendered width ${res.width}`);
  assert.equal(magic(await savedFile('logo.png')), 'png');
});

test('Firefox: same-site WebP -> PDF', { skip }, async () => {
  const res = await click('save:pdf', `http://127.0.0.1:${pagePort}/same.webp`);
  assert.equal(res.ok, true, JSON.stringify(res));
  const pages = inspectPdf(await savedFile('same.pdf'));
  assert.equal(pages.length, 1);
  assert.equal(pages[0].filter, 'DCTDecode');
});

test('Firefox: data: URL -> WebP', { skip }, async () => {
  const dataUrl = `data:image/svg+xml,${encodeURIComponent(SVG)}`;
  const res = await click('save:webp', dataUrl);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.type, 'image/webp');
});

test('Firefox: Copy as PNG writes the clipboard', { skip }, async () => {
  const res = await click('copy:png', `http://127.0.0.1:${pagePort}/same.webp`);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.copied, true);
});
