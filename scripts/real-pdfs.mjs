#!/usr/bin/env node
// Field check for PDF input: converts the first pages of real PDFs on /pdf-to-png/ (local dist/, headless
// Chromium) and compares each page with poppler's pdftoppm at the same resolution.
//   node scripts/build-site.mjs && node scripts/real-pdfs.mjs [--dpi 150] [--pages 3] file.pdf ...
// Prints, per page: size, time, mean absolute difference from poppler (0-255) and share of pixels off by > 64.
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); if (i < 0) return dflt; const v = args[i + 1]; args.splice(i, 2); return Number(v); };
const DPI = opt('--dpi', 150), PAGES = opt('--pages', 3);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/save-image-format/, '');
  let file = normalize(join(DIST, path));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
const context = await browser.newContext({ acceptDownloads: true });
const tmp = await mkdtemp(join(tmpdir(), 'saveform-real-pdf-'));

for (const pdf of args) {
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${origin}/save-image-format/pdf-to-png/`);
  await page.waitForSelector('[data-tool][data-ready]');
  await page.selectOption('#pdf-dpi', String(DPI));
  const t0 = Date.now();
  await page.setInputFiles('#file', pdf);
  await page.waitForFunction((n) => {
    const rows = [...document.querySelectorAll('#results li')];
    return rows.length && rows.slice(0, n).every((r) => r.dataset.state === 'done' || r.dataset.state === 'error');
  }, PAGES, { timeout: 120000 });
  const ms = Date.now() - t0;
  const rows = await page.locator('#results li').count();
  const refBase = join(tmp, basename(pdf, '.pdf'));
  execFileSync('pdftoppm', ['-r', String(DPI), '-f', '1', '-l', String(PAGES), '-png', pdf, refBase]);
  const out = [];
  for (let k = 0; k < Math.min(PAGES, rows); k++) {
    const row = page.locator('#results li').nth(k);
    if ((await row.getAttribute('data-state')) !== 'done') { out.push(`p${k + 1}: ${await row.locator('.result-meta').textContent()}`); continue; }
    const [dl] = await Promise.all([page.waitForEvent('download'), row.locator('a.btn').click()]);
    const ours = await readFile(await dl.path());
    const digits = String(Math.min(PAGES, rows)).length;
    let ref;
    for (const d of [digits, 1, 2, 3]) { try { ref = await readFile(`${refBase}-${String(k + 1).padStart(d, '0')}.png`); break; } catch {} }
    const r = await page.evaluate(async ([a, b]) => {
      const dec = async (x) => { const bmp = await createImageBitmap(new Blob([new Uint8Array(x)])); const c = new OffscreenCanvas(bmp.width, bmp.height); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data }; };
      const A = await dec(a), B = await dec(b);
      const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h);
      let sum = 0, big = 0, n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * A.w + x) * 4, j = (y * B.w + x) * 4;
        const dd = Math.max(Math.abs(A.d[i] - B.d[j]), Math.abs(A.d[i + 1] - B.d[j + 1]), Math.abs(A.d[i + 2] - B.d[j + 2]));
        sum += dd; if (dd > 64) big++; n++;
      }
      return { ours: `${A.w}x${A.h}`, ref: `${B.w}x${B.h}`, mean: sum / n, big: big / n };
    }, [[...ours], [...ref]]);
    out.push(`p${k + 1} ${r.ours} (poppler ${r.ref}) mean ${r.mean.toFixed(2)} >64: ${(r.big * 100).toFixed(2)}%`);
  }
  console.log(`${basename(pdf)}: ${rows} rows, first ${PAGES} in ${ms} ms, console errors ${errors.length}${errors.length ? ` (${errors[0]})` : ''}\n  ${out.join('\n  ')}`);
  await page.close();
}
await browser.close();
server.close();
await rm(tmp, { recursive: true, force: true });
