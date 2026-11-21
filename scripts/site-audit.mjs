// Quality audit of the built site in headless Chromium, at phone and desktop width.
//   node scripts/build-site.mjs && node scripts/site-audit.mjs [--shots DIR] [--only /path/]
// For every page in dist/sitemap.xml plus /privacy/, /extension/ and the 404 page, at 390×844 (touch) and
// 1280×800, it reports: console errors and uncaught exceptions, failed or non-local requests, horizontal
// overflow (and the widest offending elements), images without alt text, links or buttons with no
// accessible name, tap targets under 24 px at phone width, and text that looks like a placeholder.
// Exits 1 when any page has a problem. With --shots it also saves a full-page screenshot of every page.
import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE = '/save-image-format';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.xml': 'application/xml', '.txt': 'text/plain', '.wasm': 'application/wasm', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const shots = arg('--shots');
const only = arg('--only');

export async function serve(dist = DIST) {
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.startsWith(`${BASE}/`)) p = p.slice(BASE.length);
    let file = normalize(join(dist, p));
    if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
    } catch {
      res.writeHead(404, { 'content-type': TYPES['.html'] }).end(await readFile(join(dist, '404.html')));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// Runs inside the page: returns a list of problem strings.
function inspect(mobile) {
  const out = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) {
    const wide = [...document.querySelectorAll('body *')]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && getComputedStyle(e).position !== 'fixed'; })
      .filter((e) => !e.closest('[hidden]'))
      .slice(0, 4)
      .map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''} right=${Math.round(e.getBoundingClientRect().right)}`);
    out.push(`horizontal overflow: scrollWidth ${document.documentElement.scrollWidth} > ${vw} (${wide.join(', ')})`);
  }
  for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) out.push(`img without alt: ${img.src.slice(-60)}`);
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden'; };
  for (const e of document.querySelectorAll('a[href], button, select, input:not([type=hidden]), summary, [role=button]')) {
    if (!visible(e)) continue;
    const name = (e.getAttribute('aria-label') || e.textContent || e.title || e.getAttribute('alt') || '').trim()
      || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent.trim()) || e.closest('label')?.textContent.trim()
      || [...e.querySelectorAll('img[alt], svg title')].map((x) => x.getAttribute?.('alt') || x.textContent).join('').trim();
    if (!name && e.type !== 'file') out.push(`no accessible name: <${e.tagName.toLowerCase()} ${e.className || ''}>`);
    if (mobile) {
      const label = e.closest('label') || (e.id && document.querySelector(`label[for="${e.id}"]`));
      const r = label ? label.getBoundingClientRect() : e.getBoundingClientRect();
      const inline = e.tagName === 'A' && getComputedStyle(e).display === 'inline' && e.closest('p, li, td, figcaption, dd');
      if (!inline && e.type !== 'file' && (r.height < 24 || r.width < 24)) out.push(`small tap target ${Math.round(r.width)}×${Math.round(r.height)}: <${e.tagName.toLowerCase()}> "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
    }
  }
  const text = document.body.innerText;
  for (const re of [/lorem ipsum/i, /\bTODO\b/, /\bTBD\b/, /\bFIXME\b/, /\{\{|\}\}/, /\bundefined\b/, /\bNaN\b/, /\[object Object\]/])
    if (re.test(text)) out.push(`placeholder-like text: ${re}`);
  return out;
}

async function main() {
  const { server, origin } = await serve();
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  let paths = [...sitemap.matchAll(/<loc>[^<]*?\/save-image-format(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  for (const extra of ['/privacy/', '/extension/', '/no-such-page/']) if (!paths.includes(extra)) paths.push(extra);
  if (only) paths = paths.filter((p) => p === only);
  if (shots) await mkdir(shots, { recursive: true });
  let browser;
  try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: 'chromium' }); }
  const widths = [
    { label: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { label: 'desktop', viewport: { width: 1280, height: 800 } },
  ];
  let problems = 0;
  for (const w of widths) {
    const context = await browser.newContext({ viewport: w.viewport, isMobile: !!w.isMobile, hasTouch: !!w.hasTouch, deviceScaleFactor: w.deviceScaleFactor || 1 });
    for (const p of paths) {
      const page = await context.newPage();
      const found = [];
      page.on('console', (m) => { if (m.type() === 'error' && !(p === '/no-such-page/' && /404/.test(m.text()))) found.push(`console: ${m.text().slice(0, 200)}`); });
      page.on('pageerror', (e) => found.push(`exception: ${e.message}`));
      page.on('requestfailed', (r) => found.push(`request failed: ${r.url()}`));
      page.on('request', (r) => { if (!r.url().startsWith(origin) && !/^(data|blob):/.test(r.url())) found.push(`external request: ${r.url()}`); });
      page.on('response', (r) => { if (r.status() >= 400 && !(p === '/no-such-page/' && r.url().endsWith(p))) found.push(`HTTP ${r.status()}: ${r.url()}`); });
      await page.goto(origin + BASE + p, { waitUntil: 'networkidle' });
      found.push(...await page.evaluate(inspect, !!w.isMobile));
      if (shots) await page.screenshot({ path: join(shots, `${w.label}${p.replace(/\//g, '_') || '_'}.png`), fullPage: true });
      if (found.length) {
        problems += found.length;
        console.log(`${w.label} ${p}`);
        for (const f of [...new Set(found)]) console.log(`   - ${f}`);
      }
      await page.close();
    }
    await context.close();
  }
  await browser.close();
  server.close();
  console.log(`${paths.length} pages × ${widths.length} widths, ${problems} problem(s)`);
  process.exit(problems ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
