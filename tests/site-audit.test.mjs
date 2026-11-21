// Quality gates for the whole built site:
//   node --test tests/site-audit.test.mjs
// 1. scripts/site-audit.mjs over every sitemap page at 390 px (touch) and 1280 px: no console errors,
//    no failed or external requests, no horizontal overflow, alt text, accessible names, tap targets,
//    no placeholder text.
// 2. The extension page follows the studio's store rule: the install button goes to a live store
//    listing (a disabled "Coming soon" button while none is live), and no page tells visitors to
//    install the extension by hand (ZIP download, developer mode, "Load unpacked").
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

before(() => {
  execFileSync(process.execPath, [join(ROOT, 'scripts/build-site.mjs')], { stdio: 'pipe' });
});

test('every page passes the phone and desktop audit', { timeout: 600_000 }, () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/site-audit.mjs')], { encoding: 'utf8' });
  if (r.status !== 0) console.log(r.stdout, r.stderr);
  assert.equal(r.status, 0, `site audit found problems:\n${r.stdout.slice(-3000)}`);
  assert.match(r.stdout, /\d+ pages × 2 widths, 0 problem\(s\)/);
});

async function htmlFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() && e.name !== 'vendor') out.push(...await htmlFiles(p));
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

test('extension page: store button (or a disabled "Coming soon" one), screenshots, no manual install steps anywhere', async () => {
  const ext = await readFile(join(DIST, 'extension/index.html'), 'utf8');
  const storeLinks = ext.match(/href="https:\/\/(chromewebstore\.google\.com|addons\.mozilla\.org)[^"]*"/g) || [];
  assert.ok(storeLinks.some((l) => l.includes('chromewebstore.google.com/detail/saveform-save-image-as-pn/iimmananoageikphanfidapckaochlmn')),
    'Chrome Web Store listing is live since 2026-11-21: the extension page links to it');
  assert.doesNotMatch(ext, /disabled>Coming soon/, 'no "Coming soon" button once a listing is live');
  assert.match(ext, /assets\/ext-menu\.webp/);
  assert.match(ext, /assets\/ext-save-all\.webp/);
  for (const f of await htmlFiles(DIST)) {
    const html = await readFile(f, 'utf8');
    assert.doesNotMatch(html, /Load unpacked|Developer mode|Download ZIP|install it from source|load it from its open source/i, f);
  }
});
