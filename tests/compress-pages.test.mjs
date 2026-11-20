// Tests for the compress/resize pages (compress-image, compress-jpg, compress-png, resize-image,
// compress-image-to-100kb/-50kb/-20kb).
//   node --test tests/compress-pages.test.mjs
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const BASE_PATH = '/save-image-format';
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.wasm': 'application/wasm',
};
const PAGES = ['compress-image', 'compress-jpg', 'compress-png', 'resize-image', 'compress-image-to-100kb', 'compress-image-to-50kb', 'compress-image-to-20kb'];
const entryOf = (slug) => converters.find((c) => c.slug === slug);

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

test('the compress/resize pages are defined with complete content', () => {
  const slugs = converters.map((c) => c.slug);
  const at = slugs.indexOf(PAGES[0]);
  assert.deepEqual(slugs.slice(at, at + PAGES.length), PAGES, 'the seven pages sit together, in order');
  assert.ok(at > slugs.indexOf('jfif-to-png'), 'placed after the JFIF pages');
  for (const slug of PAGES) {
    const e = entryOf(slug);
    assert.equal(e.from, 'any', slug);
    assert.equal(e.group, 'compress', slug);
    assert.match(e.title, /\| Saveform$/);
    assert.ok(e.title.length <= 65, `${slug} title is ${e.title.length} chars`);
    assert.ok(e.description.length >= 80 && e.description.length <= 160, `${slug} description is ${e.description.length} chars`);
    for (const k of ['h1', 'lede', 'linkLabel', 'howTitle', 'settingsHint', 'explainerTitle']) assert.ok(e[k], `${slug} has ${k}`);
    assert.equal(e.explainer.length, 3, `${slug} has 3 explainer paragraphs`);
    assert.equal(e.faq.length, 5, `${slug} has 5 FAQ entries`);
    assert.ok(e.faq.some((f) => f.q === 'Are my images uploaded anywhere?'), `${slug} includes the shared no-upload FAQ`);
  }
  const want = {
    'compress-image': { to: 'same', sameFormat: true },
    'compress-jpg': { to: 'jpg' },
    'compress-png': { to: 'png', pngColors: 256 },
    'resize-image': { to: 'same', sameFormat: true, resize: { mode: 'fit', width: 1920, height: 1920 } },
    'compress-image-to-100kb': { to: 'jpg', targetKb: 100 },
    'compress-image-to-50kb': { to: 'jpg', targetKb: 50 },
    'compress-image-to-20kb': { to: 'jpg', targetKb: 20 },
  };
  for (const [slug, fields] of Object.entries(want)) {
    for (const [k, v] of Object.entries(fields)) assert.deepEqual(entryOf(slug)[k], v, `${slug}.${k}`);
  }
  assert.equal(entryOf('compress-image').targetKb, undefined, 'compress-image has no default target size');
});

test('each compress/resize page returns 200 with its title, h1, canonical, description, sitemap entry and FAQ JSON-LD', async () => {
  const sitemap = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  for (const slug of PAGES) {
    const e = entryOf(slug);
    const url = new URL(`${slug}/`, SITE_URL).href;
    assert.ok(sitemap.includes(`<loc>${url}</loc>`), `${slug} in sitemap`);
    const { page, resp, errors, close } = await open(`/${slug}/`);
    assert.equal(resp.status(), 200, slug);
    assert.equal(await page.title(), e.title);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.locator('h1').textContent(), e.h1);
    assert.equal(await page.locator('link[rel=canonical]').getAttribute('href'), url);
    const desc = await page.locator('meta[name=description]').getAttribute('content');
    assert.equal(desc, e.description);
    assert.ok(desc.length <= 160, `${slug} meta description is ${desc.length} chars`);
    assert.equal(await page.locator('[data-tool]').count(), 1, `${slug} embeds the converter`);
    assert.equal(await page.locator('.links-grid a[aria-current="page"]').count(), 1, `${slug} marks itself in the converter list`);
    const lds = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((s) => JSON.parse(s));
    const faq = lds.find((ld) => ld['@type'] === 'FAQPage');
    assert.ok(faq, `${slug} has FAQ JSON-LD`);
    assert.deepEqual(faq.mainEntity.map((q) => q.name), e.faq.map((f) => f.q), `${slug} FAQ JSON-LD matches the entry`);
    // Same-site links (explainers link each other) resolve to built pages.
    for (const href of await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.href))) {
      const u = new URL(href);
      if (u.origin !== origin) continue;
      const rel = u.pathname.startsWith(`${BASE_PATH}/`) ? u.pathname.slice(BASE_PATH.length) : u.pathname;
      assert.ok(existsSync(join(DIST, rel.endsWith('/') ? `${rel}index.html` : rel)), `${slug} links to missing ${u.pathname}`);
    }
    assert.deepEqual(errors, [], `${slug}: no console errors`);
    await close();
  }
});

test('the home page links every compress/resize page', async () => {
  const { page, close } = await open('/');
  const hrefs = await page.locator('main a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  for (const slug of PAGES) assert.ok(hrefs.includes(`./${slug}/`) || hrefs.includes(`${slug}/`), `home links ${slug}`);
  await close();
});

// Needs the controls change (Same as original, Resize, Target file size, PNG colours in
// scripts/build-site.mjs and site/assets/app.js).
test('control defaults on the compress/resize pages', async () => {
  for (const slug of PAGES) {
    const e = entryOf(slug);
    const { page, close } = await open(`/${slug}/`);
    assert.equal(await page.locator('#format').inputValue(), e.to, `${slug}: #format`);
    assert.equal(await page.locator('#format option[value="same"]').count(), e.sameFormat ? 1 : 0, `${slug}: Same as original offered only with sameFormat`);
    assert.equal(await page.locator('#target-on').isChecked(), !!e.targetKb, `${slug}: #target-on`);
    if (e.targetKb) assert.equal(Number(await page.locator('#target-kb').inputValue()), e.targetKb, `${slug}: #target-kb`);
    if (e.to === 'png') assert.equal(Number(await page.locator('#png-colors').inputValue()), e.pngColors ?? 0, `${slug}: #png-colors`);
    assert.equal(await page.locator('#resize-mode').inputValue(), e.resize?.mode ?? 'none', `${slug}: #resize-mode`);
    if (e.resize?.width) assert.equal(Number(await page.locator('#resize-width').inputValue()), e.resize.width, `${slug}: #resize-width`);
    if (e.resize?.height) assert.equal(Number(await page.locator('#resize-height').inputValue()), e.resize.height, `${slug}: #resize-height`);
    const step2 = await page.locator('ol.steps li').nth(1).textContent();
    assert.ok(step2.includes(e.settingsHint), `${slug}: step 2 shows settingsHint`);
    await close();
  }
});
