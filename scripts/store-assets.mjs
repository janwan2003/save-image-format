// Renders store images into docs/store/: a 1280x800 screenshot illustrating the menu, a second
// 1280x800 screenshot of the "save all images" popup, and a 440x280 promo tile (plus the site's
// og-image). The right-click menu is drawn in HTML (native menus cannot be captured). The popup is
// the real extension/popup.html, loaded with a stubbed `chrome` API that returns sample images
// drawn here as SVG (no third-party pictures).
//   node scripts/store-assets.mjs          all images
//   node scripts/store-assets.mjs popup    only docs/store/screenshot-2-1280x800.png
import { chromium } from 'playwright-core';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'docs/store');
await mkdir(out, { recursive: true });
const icon = `data:image/svg+xml;base64,${(await readFile(path.join(root, 'extension/icons/icon.svg'))).toString('base64')}`;
const css = `body{margin:0;font-family:system-ui,"Segoe UI",Roboto,sans-serif}`;
const menuItem = (t, hl, arrow) => `<div style="padding:7px 28px 7px 32px;display:flex;justify-content:space-between;${hl ? 'background:#e8f0fe' : ''}">${t}${arrow ? '<span>›</span>' : ''}</div>`;
const shot = `<style>${css}</style>
<div style="width:1280px;height:800px;background:linear-gradient(135deg,#1e3a8a,#2563eb);position:relative;overflow:hidden">
  <div style="position:absolute;left:60px;top:70px;width:520px;color:#fff">
    <img src="${icon}" width="72"><h1 style="font-size:48px;margin:18px 0 10px">Saveform</h1>
    <p style="font-size:26px;line-height:1.35;margin:0 0 26px;opacity:.95">Right-click any image.<br>Save it as PNG, JPG or WebP.</p>
    <ul style="font-size:20px;line-height:1.9;padding-left:22px;opacity:.95;margin:0">
      <li>Converted on your device</li><li>No tracking, no network calls</li><li>No access to the pages you visit</li><li>Open source</li></ul>
  </div>
  <div style="position:absolute;left:640px;top:110px;width:560px;height:600px;background:#fff;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35);overflow:hidden">
    <div style="height:40px;background:#f1f3f4;display:flex;align-items:center;padding:0 14px;gap:8px"><span style="width:12px;height:12px;border-radius:50%;background:#f87171"></span><span style="width:12px;height:12px;border-radius:50%;background:#fbbf24"></span><span style="width:12px;height:12px;border-radius:50%;background:#34d399"></span><span style="margin-left:12px;background:#fff;border-radius:14px;padding:4px 14px;font-size:13px;color:#555;flex:1">shop.example/products/lamp</span></div>
    <div style="padding:24px"><div style="height:300px;border-radius:8px;background:radial-gradient(circle at 30% 35%,#fde68a,#f59e0b 35%,#b45309 70%,#78350f)"></div>
    <div style="margin-top:18px;height:16px;width:70%;background:#e5e7eb;border-radius:4px"></div><div style="margin-top:10px;height:16px;width:45%;background:#e5e7eb;border-radius:4px"></div></div>
  </div>
  <div style="position:absolute;left:820px;top:290px;width:230px;background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:15px;color:#202124;padding:6px 0">
    ${menuItem('Open image in new tab')}${menuItem('Save image as…')}${menuItem('Copy image')}<div style="border-top:1px solid #e5e7eb;margin:6px 0"></div>${menuItem('<span style="display:flex;gap:8px;align-items:center;margin-left:-24px"><img src="' + icon + '" width="16">Save image as</span>', true, true)}
  </div>
  <div style="position:absolute;left:1046px;top:442px;width:170px;background:#fff;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:15px;color:#202124;padding:6px 0">
    ${menuItem('PNG', true)}${menuItem('JPG')}${menuItem('WebP')}<div style="border-top:1px solid #e5e7eb;margin:6px 0"></div>${menuItem('Copy as PNG')}
  </div>
</div>`;
const tile = `<style>${css}</style><div style="width:440px;height:280px;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;display:flex;flex-direction:column;justify-content:center;padding:0 36px;box-sizing:border-box">
  <div style="display:flex;align-items:center;gap:14px"><img src="${icon}" width="56"><span style="font-size:34px;font-weight:700">Saveform</span></div>
  <p style="font-size:20px;line-height:1.35;margin:16px 0 0">Save any image as<br><b>PNG, JPG or WebP</b>.<br><span style="opacity:.85;font-size:16px">Private. Local. Open source.</span></p></div>`;
let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ channel: 'chromium' }); // no headless shell installed
}
const only = process.argv[2];
if (!only || only === 'popup') await popupScreenshot();
if (only) { await browser.close(); process.exit(0); }
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, html, w, h] of [['screenshot-1280x800.png', shot, 1280, 800], ['promo-440x280.png', tile, 440, 280]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.screenshot({ path: path.join(out, name) });
}
// Social preview for the website (og:image), 1200x630: the screenshot scene, cropped.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<div style="transform:scale(0.9375);transform-origin:0 0;margin-top:-30px">${shot}</div>`);
await page.screenshot({ path: path.join(root, 'site/og-image.png') });
await browser.close();
console.log('written to', out);

// ---------- screenshot 2: the "save all images on a page" popup ----------

// Sample pictures for a made-up lamp shop, drawn as SVG. [file name, width, height, svg body, extra]
function sampleImages() {
  const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
  const lamp = (w, h, bg1, bg2, glow) => svg(w, h, `<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
    <radialGradient id="g" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#fff7d6"/><stop offset=".35" stop-color="${glow}"/><stop offset="1" stop-color="#7c2d12"/></radialGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#b)"/><rect x="${w / 2 - 3}" y="0" width="6" height="${h * 0.3}" fill="#1f2937"/>
    <path d="M${w / 2 - h * 0.22} ${h * 0.55} Q${w / 2} ${h * 0.2} ${w / 2 + h * 0.22} ${h * 0.55} Z" fill="#111827"/>
    <circle cx="${w / 2}" cy="${h * 0.6}" r="${h * 0.12}" fill="url(#g)"/>
    <ellipse cx="${w / 2}" cy="${h * 0.93}" rx="${h * 0.35}" ry="${h * 0.04}" fill="#000" opacity=".18"/>`);
  const landscape = (w, h) => svg(w, h, `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e40af"/><stop offset=".6" stop-color="#f472b6"/><stop offset="1" stop-color="#fdba74"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#s)"/><circle cx="${w * 0.7}" cy="${h * 0.55}" r="${h * 0.12}" fill="#fef3c7"/>
    <path d="M0 ${h * 0.75} L${w * 0.25} ${h * 0.45} L${w * 0.45} ${h * 0.7} L${w * 0.65} ${h * 0.5} L${w} ${h * 0.8} V${h} H0Z" fill="#312e81"/>
    <path d="M0 ${h * 0.88} L${w * 0.35} ${h * 0.7} L${w * 0.7} ${h * 0.9} L${w} ${h * 0.78} V${h} H0Z" fill="#1e1b4b"/>`);
  const chair = (w, h) => svg(w, h, `<rect width="${w}" height="${h}" fill="#e7e5e4"/>
    <rect x="${w * 0.25}" y="${h * 0.2}" width="${w * 0.5}" height="${h * 0.42}" rx="${w * 0.08}" fill="#0f766e"/>
    <rect x="${w * 0.18}" y="${h * 0.5}" width="${w * 0.64}" height="${h * 0.17}" rx="${w * 0.05}" fill="#14b8a6"/>
    <rect x="${w * 0.24}" y="${h * 0.66}" width="${w * 0.04}" height="${h * 0.2}" fill="#92400e"/><rect x="${w * 0.72}" y="${h * 0.66}" width="${w * 0.04}" height="${h * 0.2}" fill="#92400e"/>`);
  const swatch = (w, h) => svg(w, h, `<rect width="${w}" height="${h}" fill="#fde68a"/>${Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) =>
    `<circle cx="${(i + 0.5) * w / 6}" cy="${(j + 0.5) * h / 6}" r="${w / 16}" fill="${(i + j) % 2 ? '#ea580c' : '#be123c'}"/>`).join('')).join('')}`);
  const banner = (w, h) => svg(w, h, `<defs><linearGradient id="k" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs>
    <rect width="${w}" height="${h}" fill="url(#k)"/><circle cx="${w * 0.8}" cy="${h * 0.3}" r="${h * 0.5}" fill="#fff" opacity=".12"/><circle cx="${w * 0.15}" cy="${h}" r="${h * 0.6}" fill="#fff" opacity=".1"/>`);
  const vase = (w, h) => svg(w, h, `<rect width="${w}" height="${h}" fill="#dbeafe"/>
    <path d="M${w * 0.4} ${h * 0.2} H${w * 0.6} V${h * 0.3} Q${w * 0.8} ${h * 0.45} ${w * 0.7} ${h * 0.8} H${w * 0.3} Q${w * 0.2} ${h * 0.45} ${w * 0.4} ${h * 0.3}Z" fill="#1d4ed8"/>
    <rect x="${w * 0.2}" y="${h * 0.8}" width="${w * 0.6}" height="${h * 0.03}" fill="#94a3b8"/>`);
  const icon = (w, color) => svg(w, w, `<rect width="${w}" height="${w}" rx="${w / 5}" fill="${color}"/>`);
  return [
    ['pendant-lamp-amber.webp', 1600, 1200, lamp(1600, 1200, '#fef3c7', '#fcd34d', '#f59e0b')],
    ['pendant-lamp-side.webp', 1200, 1200, lamp(1200, 1200, '#ccfbf1', '#5eead4', '#fb923c')],
    ['lakeside-evening.avif', 2000, 1333, landscape(2000, 1333)],
    ['armchair-teal.jpg', 1000, 1000, chair(1000, 1000)],
    ['hero-banner.webp', 1920, 600, banner(1920, 600), { kind: 'background' }],
    ['ceramic-vase.webp', 900, 1200, vase(900, 1200), { checked: false }],
    ['fabric-swatch.png', 800, 800, swatch(800, 800)],
    ['pendant-lamp-night.webp', 1200, 900, lamp(1200, 900, '#1e293b', '#0f172a', '#fbbf24')],
    ['cart.svg', 24, 24, icon(24, '#475569')],
    ['star.svg', 16, 16, icon(16, '#f59e0b')],
    ['logo-small.png', 64, 64, icon(64, '#2563eb')],
  ];
}

async function popupScreenshot() {
  const EXT = 'https://saveform.test/'; // extension files, served from disk
  const SHOP = 'https://shop.example/img/';
  const samples = sampleImages();
  const images = samples.map(([name, width, height, , extra]) => ({ src: SHOP + name, width, height, kind: 'img', alt: '', ...extra }));
  const ctx = await browser.newContext({ viewport: { width: 560, height: 600 }, deviceScaleFactor: 2, colorScheme: 'light' });
  await ctx.route(`${EXT}**`, async (route) => {
    const rel = new URL(route.request().url()).pathname.slice(1);
    const types = { js: 'text/javascript', css: 'text/css', html: 'text/html', png: 'image/png', svg: 'image/svg+xml' };
    try {
      route.fulfill({ body: await readFile(path.join(root, 'extension', rel)), contentType: types[rel.split('.').pop()] || 'application/octet-stream' });
    } catch { route.fulfill({ status: 404, body: '' }); }
  });
  await ctx.route(`${SHOP}**`, (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    const hit = samples.find((x) => x[0] === name);
    route.fulfill(hit ? { body: hit[3], contentType: 'image/svg+xml' } : { status: 404, body: '' });
  });
  // The popup's only view of the browser is the `chrome` API: answer with the sample page.
  await ctx.addInitScript((imgs) => {
    const noop = () => {};
    globalThis.chrome = {
      storage: { sync: { get: async (d) => ({ ...d, batchFormat: 'png', batchOutput: 'zip', batchMinSize: 100 }), set: async () => {} } },
      tabs: { query: async () => [{ id: 1, url: 'https://shop.example/lamps/pendant' }], get: async () => ({ id: 1 }) },
      scripting: { executeScript: async () => [{ result: { url: 'https://shop.example/lamps/pendant', images: imgs } }] },
      runtime: { sendMessage: async () => ({ status: 'idle' }), onMessage: { addListener: noop }, openOptionsPage: noop },
      permissions: { request: async () => false },
    };
  }, images);
  const pp = await ctx.newPage();
  await pp.goto(`${EXT}popup.html`);
  await pp.waitForSelector('#picker:not([hidden]) .grid img');
  await pp.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
  const popupPng = (await pp.locator('body').screenshot()).toString('base64');
  const popupBox = await pp.locator('body').boundingBox();
  await ctx.close();

  // Behind the popup: the same made-up shop page, so the list visibly matches the page.
  const pic = (i, style) => `<img src="data:image/svg+xml;base64,${Buffer.from(samples[i][3]).toString('base64')}" style="display:block;object-fit:cover;border-radius:6px;${style}">`;
  const popupW = 560, popupH = Math.round(popupBox.height);
  const scene = `<style>${css}</style>
<div style="width:1280px;height:800px;background:linear-gradient(135deg,#1e3a8a,#2563eb);position:relative;overflow:hidden">
  <div style="position:absolute;left:60px;top:110px;width:470px;color:#fff">
    <img src="${icon}" width="64">
    <h1 style="font-size:44px;line-height:1.12;margin:18px 0 14px">Save every image<br>on a page</h1>
    <p style="font-size:24px;line-height:1.35;margin:0 0 26px;opacity:.95">As separate files, one ZIP<br>or one PDF.</p>
    <ul style="font-size:20px;line-height:1.9;padding-left:22px;opacity:.95;margin:0">
      <li>Takes the largest size the page offers</li><li>Finds lazy-loaded and background images</li><li>PNG, JPG, WebP or the original format</li><li>Converted on your device</li></ul>
  </div>
  <div style="position:absolute;left:560px;top:95px;width:680px;height:610px;background:#fff;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35);overflow:hidden">
    <div style="height:44px;background:#f1f3f4;display:flex;align-items:center;padding:0 14px;gap:8px"><span style="width:12px;height:12px;border-radius:50%;background:#f87171"></span><span style="width:12px;height:12px;border-radius:50%;background:#fbbf24"></span><span style="width:12px;height:12px;border-radius:50%;background:#34d399"></span>
      <span style="margin-left:12px;background:#fff;border-radius:14px;padding:4px 14px;font-size:13px;color:#555;flex:1">shop.example/lamps/pendant</span>
      <span style="width:30px;height:30px;border-radius:50%;background:#dbe4ff;display:grid;place-items:center"><img src="${icon}" width="20"></span></div>
    <div style="padding:22px;display:grid;grid-template-columns:2fr 1fr;gap:14px">
      ${pic(0, 'width:100%;height:300px')}<div style="display:grid;gap:14px">${pic(1, 'width:100%;height:143px')}${pic(7, 'width:100%;height:143px')}</div>
      <div style="grid-column:1/-1;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">${pic(2, 'width:100%;height:120px')}${pic(3, 'width:100%;height:120px')}${pic(5, 'width:100%;height:120px')}${pic(6, 'width:100%;height:120px')}</div>
      <div><div style="height:16px;width:70%;background:#e5e7eb;border-radius:4px"></div><div style="margin-top:10px;height:16px;width:45%;background:#e5e7eb;border-radius:4px"></div></div>
    </div>
  </div>
  <img src="data:image/png;base64,${popupPng}" width="${popupW}" height="${popupH}" style="position:absolute;left:${1240 - 12 - popupW}px;top:143px;border-radius:8px;box-shadow:0 12px 36px rgba(0,0,0,.4)">
</div>`;
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 } });
  await page.setContent(scene);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: path.join(out, 'screenshot-2-1280x800.png') });
  await page.close();
}
