// Renders extension/icons/icon.svg to the PNG sizes the manifest needs.
// Usage: node scripts/make-icons.mjs   (needs playwright-core and its Chromium)
import { chromium } from 'playwright-core';
import { readFile, writeFile } from 'node:fs/promises';

const svg = await readFile(new URL('../extension/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}">`);
  const png = await page.locator('img').screenshot({ omitBackground: true });
  await writeFile(new URL(`../extension/icons/icon${size}.png`, import.meta.url), png);
}
await browser.close();
console.log('icons written');
