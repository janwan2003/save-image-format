// Tests for the TIFF-output converter pages (jpg/png/webp/heic-to-tiff) and the multi-page TIFF guide.
//   node --test tests/tiff-output-pages.test.mjs
// Builds dist/, serves it on a random localhost port and checks the pages in headless Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { converters, SITE_URL } from '../site/pages.mjs';
import { guides } from '../site/guides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE_PATH = '/save-image-format';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.wasm': 'application/wasm',
};
const TIFF_PAGES = ['jpg-to-tiff', 'png-to-tiff', 'webp-to-tiff', 'heic-to-tiff'];
const GUIDE = 'how-to-make-a-multi-page-tiff';

let server, origin, browser;

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
});

after(async () => {
  await browser?.close();
  await new Promise((r) => (server ? server.close(r) : r()));
});

async function open(path) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const resp = await page.goto(origin + path);
  await page.waitForLoadState('networkidle');
  return { page, resp, errors, close: () => context.close() };
}

// Every same-site link on the page resolves to a file in dist/.
async function assertLinksResolve(page, label) {
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.href));
  for (const href of hrefs) {
    const u = new URL(href);
    if (u.origin !== origin) continue;
    const rel = u.pathname.startsWith(`${BASE_PATH}/`) ? u.pathname.slice(BASE_PATH.length) : u.pathname;
    assert.ok(existsSync(join(DIST, rel.endsWith('/') ? `${rel}index.html` : rel)), `${label} links to missing ${u.pathname}`);
  }
}

test('the TIFF-output pages are defined like the other converters', () => {
  for (const slug of TIFF_PAGES) {
    const entry = converters.find((c) => c.slug === slug);
    assert.ok(entry, `${slug} is in site/pages.mjs`);
    assert.equal(entry.to, 'tiff');
    assert.equal(entry.from, slug.split('-')[0]);
    assert.match(entry.title, /\| Saveform$/);
    assert.ok(entry.title.length <= 65, `${slug} title is ${entry.title.length} chars`);
    assert.ok(entry.description.length >= 80 && entry.description.length <= 170, `${slug} description is ${entry.description.length} chars`);
    assert.equal(entry.explainer.length, 3, `${slug} has 3 explainer paragraphs`);
    assert.equal(entry.faq.length, 5, `${slug} has 5 FAQ entries`);
  }
  assert.equal(converters.find((c) => c.slug === 'pdf-to-tiff')?.from, 'pdf', 'pdf-to-tiff takes PDF input (session 11)');
});

test('each TIFF-output page returns 200 with its title, h1, canonical, sitemap entry and no console errors', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  for (const slug of TIFF_PAGES) {
    const entry = converters.find((c) => c.slug === slug);
    const url = new URL(`${slug}/`, SITE_URL).href;
    assert.ok(sitemap.includes(`<loc>${url}</loc>`), `${slug} in sitemap`);
    const { page, resp, errors, close } = await open(`/${slug}/`);
    assert.equal(resp.status(), 200, slug);
    assert.equal(await page.title(), entry.title);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('h1').textContent(), entry.h1);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), url);
    assert.equal(await page.locator('[data-tool]').count(), 1, `${slug} embeds the converter`);
    assert.equal(await page.locator('.links-grid a[aria-current="page"]').count(), 1, `${slug} marks itself in the converter list`);
    await assertLinksResolve(page, slug);
    assert.deepEqual(errors, [], `${slug}: no console errors`);
    await close();
  }
});

test('the reverse-direction TIFF pages link to the new pages', async () => {
  for (const [from, to] of [['tiff-to-jpg', 'jpg-to-tiff'], ['tiff-to-png', 'png-to-tiff'], ['tiff-to-pdf', GUIDE]]) {
    const html = await readFile(join(DIST, from, 'index.html'), 'utf8');
    const prose = html.slice(html.indexOf('id="about-formats"'), html.indexOf('id="faq"'));
    assert.ok(prose.includes(`href="../${to}/"`), `${from} explainer links ${to}`);
  }
});

test('the multi-page TIFF guide is built, listed on /guides/ and embeds the converter', async () => {
  const guide = guides.find((g) => g.slug === GUIDE);
  assert.ok(guide, `${GUIDE} is in site/guides.mjs`);
  const url = new URL(`${GUIDE}/`, SITE_URL).href;
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes(`<loc>${url}</loc>`), 'guide in sitemap');

  const { page, resp, errors, close } = await open(`/${GUIDE}/`);
  assert.equal(resp.status(), 200);
  assert.equal(await page.title(), guide.title);
  assert.equal(await page.locator('h1').textContent(), guide.h1);
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), url);
  assert.equal(await page.locator('[data-tool]').count(), 1, 'guide embeds the converter');
  const words = (await page.locator('article .prose').innerText()).split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 450 && words <= 1000, `guide has ${words} words`);
  await assertLinksResolve(page, GUIDE);
  assert.deepEqual(errors, [], 'guide: no console errors');
  await close();

  const index = await open('/guides/');
  const card = index.page.locator('.guide-card', { has: index.page.locator(`a[href="../${GUIDE}/"]`) });
  assert.equal(await card.count(), 1, 'one card on /guides/');
  assert.equal((await card.locator('h2').textContent()).trim(), guide.h1);
  const tiffGroup = index.page.locator('.by-source', { has: index.page.locator('h3', { hasText: 'From HEIC' }) });
  assert.equal(await tiffGroup.locator('a[href="../heic-to-tiff/"]').count(), 1, '/guides/ lists heic-to-tiff under HEIC');
  await index.close();
});

// Needs the engine change (TIFF in the format menu of scripts/build-site.mjs and extension/lib/convert.js).
test('the format menu starts on TIFF on every TIFF-output page and the guide, with Download one TIFF', async () => {
  for (const slug of [...TIFF_PAGES, GUIDE]) {
    const { page, close } = await open(`/${slug}/`);
    assert.equal(await page.locator('#format option[value="tiff"]').count(), 1, `${slug}: TIFF is in the format menu`);
    assert.equal(await page.locator('#format').inputValue(), 'tiff', `${slug} defaults to TIFF`);
    assert.equal(await page.locator('[data-tool] button', { hasText: 'Download one TIFF' }).count(), 1, `${slug}: Download one TIFF button`);
    await close();
  }
});
