// Field check for "save all images" (toolbar popup): open real pages, list their images with the
// popup's collector, then save up to 12 of the >=100 px ones as one ZIP of PNGs through the same
// background batch the popup uses. Prints one line per site. Sites that refuse extension reads
// are skipped (the user would see "Allow these sites"), and counted as "blocked".
// activeTab is simulated with host access to the page's own origin only.
// Usage: node scripts/real-sites-batch.mjs [url ...]
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';

const SITES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://en.wikipedia.org/wiki/WebP',
  'https://www.bbc.com/news',
  'https://www.theguardian.com/international',
  'https://unsplash.com/',
  'https://www.pexels.com/',
  'https://www.ikea.com/us/en/',
  'https://www.nasa.gov/',
  'https://www.flickr.com/explore',
  'https://dribbble.com/shots',
  'https://www.shopify.com/',
];

const root = path.resolve(import.meta.dirname, '..');
const tmp = await mkdtemp(path.join(tmpdir(), 'saveform-field-batch-'));
const ext = path.join(tmp, 'ext');
await cp(path.join(root, 'extension'), ext, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = [...new Set(SITES.map((s) => `${new URL(s).origin}/*`))];
await writeFile(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  channel: 'chromium', headless: true, acceptDownloads: true, downloadsPath: path.join(tmp, 'dl'),
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
await sw.evaluate(() => chrome.storage.sync.set({ askWhere: false }));
const page = await ctx.newPage();
for (const url of SITES) {
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(1500);
    const r = await sw.evaluate(async (url) => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: globalThis.saveform.collectPageImages });
      const big = result.images.filter((x) => Math.max(x.width, x.height) >= 100);
      const items = big.slice(0, 12);
      const kinds = {};
      for (const x of result.images) kinds[x.kind] = (kinds[x.kind] || 0) + 1;
      if (!items.length) return { found: result.images.length, kinds, big: 0 };
      const t0 = Date.now();
      globalThis.saveform.startBatch({ items, fmt: 'png', output: 'zip', tabId: tab.id, pageUrl: result.url });
      let s;
      for (let i = 0; i < 1200; i++) {
        s = globalThis.saveform.batchState();
        if (s.status === 'needs-permission') { await globalThis.saveform.continueBatch({ skip: true }); continue; }
        if (s.status === 'done' || s.status === 'error') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      return { found: result.images.length, kinds, big: big.length, tried: items.length, saved: s.saved, failed: s.failed.map((f) => f.error.slice(0, 60)), status: s.status, ms: Date.now() - t0, file: s.filename };
    }, url);
    const blocked = (r.failed || []).filter((e) => e.startsWith('Skipped')).length;
    console.log(`${new URL(url).host.padEnd(24)} found ${String(r.found).padStart(3)} ${JSON.stringify(r.kinds)} >=100px ${r.big}; saved ${r.saved ?? 0}/${r.tried ?? 0} (blocked ${blocked}, other failures ${(r.failed?.length || 0) - blocked}) ${r.ms ?? ''}ms ${r.status ?? ''}${(r.failed || []).filter((e) => !e.startsWith('Skipped')).slice(0, 2).map((e) => ` | ${e}`).join('')}`);
  } catch (e) {
    console.log(`${new URL(url).host.padEnd(24)} ERROR ${e.message.split('\n')[0].slice(0, 100)}`);
  }
}
await ctx.close();
await rm(tmp, { recursive: true, force: true });
