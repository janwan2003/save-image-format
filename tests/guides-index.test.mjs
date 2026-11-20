// Tests for the /guides/ index page and the compact footer that links to it.
//   node --test tests/guides-index.test.mjs
// Builds dist/, serves it on a random localhost port and checks the page in headless Chromium.
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

async function open(path, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const resp = await page.goto(origin + path);
  return { page, resp, errors, close: () => context.close() };
}

test('/guides/ exists with its own title, description, canonical, one h1 and a card per guide', async () => {
  const { page, resp, errors, close } = await open('/guides/');
  assert.equal(resp.status(), 200);
  assert.equal(await page.locator('h1').count(), 1);
  assert.match(await page.locator('h1').textContent(), /Guides/);
  assert.match(await page.title(), /Guides.*\| Saveform$/);
  const description = await page.locator('meta[name=description]').getAttribute('content');
  assert.ok(description.length >= 80 && description.length <= 170, `description length ${description.length}`);
  assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), new URL('guides/', SITE_URL).href);
  for (const ld of await page.locator('script[type="application/ld+json"]').allTextContents()) {
    const data = JSON.parse(ld);
    assert.equal(data['@type'], 'CollectionPage');
    assert.equal(data.hasPart.length, guides.length);
  }

  assert.equal(await page.locator('.guide-card').count(), guides.length, 'one card per guide');
  for (const g of guides) {
    const card = page.locator('.guide-card', { has: page.locator(`a[href="../${g.slug}/"]`) });
    assert.equal(await card.count(), 1, `card for ${g.slug}`);
    assert.equal((await card.locator('h2').textContent()).trim(), g.h1);
    assert.equal((await card.locator('p').textContent()).trim(), g.lede);
  }

  // Converters grouped by source format: every converter appears exactly once.
  const convHrefs = await page.locator('.by-source a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  assert.equal(convHrefs.length, converters.length);
  for (const c of converters) assert.ok(convHrefs.includes(c.slug ? `../${c.slug}/` : '../'), `links converter ${c.slug || 'index'}`);
  const groups = new Set(converters.map((c) => c.from));
  assert.equal(await page.locator('.by-source').count(), groups.size, 'one group per source format');

  assert.equal(await page.locator('nav a[aria-current="page"]').textContent(), 'Guides');
  assert.deepEqual(errors, [], 'no console errors (CSP, missing assets)');
  await close();
});

test('/guides/ is in sitemap.xml', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes(`<loc>${new URL('guides/', SITE_URL).href}</loc>`));
  const locs = [...sitemap.matchAll(/<loc>/g)].length;
  assert.equal(locs, converters.length + guides.length + 3, 'converters, guides, guides index, extension, privacy');
});

test('every page links /guides/ from the header and a compact footer', async () => {
  const pages = ['', ...converters.map((c) => c.slug).filter(Boolean), ...guides.map((g) => g.slug), 'guides', 'extension', 'privacy'];
  for (const slug of pages) {
    const html = await readFile(join(DIST, slug, 'index.html'), 'utf8');
    const root = slug ? '../' : './';
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    const footer = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
    assert.ok(header.includes(`href="${root}guides/"`), `${slug || 'index'} header links /guides/`);
    assert.ok(footer.includes(`href="${root}guides/">All guides →</a>`), `${slug || 'index'} footer links /guides/`);
    const footerGuideLinks = guides.filter((g) => footer.includes(`href="${root}${g.slug}/"`)).length;
    assert.ok(footerGuideLinks >= 1 && footerGuideLinks <= 3, `${slug || 'index'} footer lists ${footerGuideLinks} guides`);
  }
  const notFound = await readFile(join(DIST, '404.html'), 'utf8');
  assert.ok(notFound.includes(`href="${BASE_PATH}/guides/">All guides →</a>`), '404 footer uses the absolute path');
});

test('no broken internal links from /guides/, and the header fits a 390 px screen', async () => {
  const { page, close } = await open('/guides/', { width: 390, height: 844 });
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.href));
  let checked = 0;
  for (const href of hrefs) {
    const u = new URL(href);
    if (u.origin !== origin) continue;
    const rel = u.pathname.startsWith(`${BASE_PATH}/`) ? u.pathname.slice(BASE_PATH.length) : u.pathname;
    const target = join(DIST, rel.endsWith('/') ? `${rel}index.html` : rel);
    assert.ok(existsSync(target), `/guides/ links to missing ${u.pathname}`);
    checked++;
  }
  assert.ok(checked >= guides.length + converters.length, `checked ${checked} internal links`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `no horizontal scroll at 390 px (overflow ${overflow} px)`);
  const navRows = await page.locator('.site-header nav a').evaluateAll((as) => new Set(as.map((a) => Math.round(a.getBoundingClientRect().top))).size);
  assert.equal(navRows, 1, 'header nav links sit on one row at 390 px');
  await close();
});
