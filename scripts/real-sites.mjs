// Field check: open real pages, pick the largest visible <img>, and run Saveform's menu handler
// on it (PNG). Prints one line per site: which fetch path worked or why it failed.
// activeTab is simulated with host access to the page's own origin only (as a real right-click grants).
// Usage: node scripts/real-sites.mjs [url ...]
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const SITES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://en.wikipedia.org/wiki/WebP',
  'https://commons.wikimedia.org/wiki/Main_Page',
  'https://www.bbc.com/news',
  'https://www.theguardian.com/international',
  'https://unsplash.com/',
  'https://www.pexels.com/',
  'https://github.com/',
  'https://news.ycombinator.com/',
  'https://www.reddit.com/r/pics/',
  'https://www.ikea.com/us/en/',
  'https://www.etsy.com/',
  'https://www.nasa.gov/',
  'https://www.flickr.com/explore',
  'https://www.amazon.com/',
  'https://www.nytimes.com/',
  'https://imgur.com/',
  'https://www.pinterest.com/ideas/',
  'https://dribbble.com/shots',
  'https://www.behance.net/',
  'https://www.shopify.com/',
];

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(tmpdir(), 'saveform-field-'));
const ext = path.join(tmp, 'ext');
await cp(path.join(root, 'extension'), ext, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...new Set(SITES.map((s) => `${new URL(s).origin}/*`))];
await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: path.join(tmp, 'dl'),
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Safari/537.36',
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
await sw.evaluate(() => chrome.storage.sync.set({ askWhere: false }));
const rows = [];
for (const site of SITES) {
  const page = await ctx.newPage();
  let row = { site: new URL(site).host };
  try {
    await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2500);
    const src = await page.evaluate(() => {
      const imgs = [...document.images].filter((i) => i.complete && i.naturalWidth > 60 && i.currentSrc);
      imgs.sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight);
      return imgs[0]?.currentSrc || null;
    });
    if (!src) { row.result = 'no loaded <img> found'; }
    else {
      row.img = src.length > 90 ? `${src.slice(0, 87)}...` : src;
      row.sameSite = new URL(src).origin === new URL(page.url()).origin;
      await page.bringToFront();
      const res = await sw.evaluate(async (srcUrl) => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        return globalThis.saveform.handleClick({ menuItemId: 'save:png', srcUrl, frameId: 0 }, { id: tab.id });
      }, src);
      row.result = res.ok ? `ok ${res.width}x${res.height} -> ${res.filename}` : res.pending ? `asks permission for ${res.origin}` : `error: ${res.error}`;
    }
  } catch (e) { row.result = `page failed: ${e.message.split('\n')[0]}`; }
  rows.push(row);
  console.log(JSON.stringify(row));
  for (const p of ctx.pages()) if (p !== page && p.url().includes('grant.html')) await p.close();
  await page.close();
}
await ctx.close();
await rm(tmp, { recursive: true, force: true });
const ok = rows.filter((r) => r.result.startsWith('ok')).length;
const perm = rows.filter((r) => r.result.startsWith('asks')).length;
console.log(`\nsummary: ${ok} saved directly, ${perm} needed one-site permission, ${rows.length - ok - perm} other, of ${rows.length}`);
