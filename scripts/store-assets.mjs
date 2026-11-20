// Renders store images into docs/store/: a 1280x800 screenshot illustrating the menu and a
// 440x280 promo tile. The right-click menu is drawn in HTML (native menus cannot be captured).
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
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, html, w, h] of [['screenshot-1280x800.png', shot, 1280, 800], ['promo-440x280.png', tile, 440, 280]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.screenshot({ path: path.join(out, name) });
}
await browser.close();
console.log('written to', out);
