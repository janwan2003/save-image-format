# Store listing (Chrome Web Store / Edge Add-ons / Firefox AMO)

## Where it stands (2026-11-22)

| Store | Package | State | How |
|---|---|---|---|
| Firefox AMO | `packages/saveform-<version>-firefox.zip` | add-on id 3135549, status `nominated` (Mozilla review queue); latest version see `--status` and VENTURE.md `## Status`; will appear at https://addons.mozilla.org/firefox/addon/saveform-save-image-as-png-jpg/ | `python3 scripts/amo-submit.py` (`--status`, `--listing`, `--previews`, `--refresh-previews`) |
| Chrome Web Store | `packages/saveform-<version>-chrome.zip` | **live** since 2026-11-21: https://chromewebstore.google.com/detail/iimmananoageikphanfidapckaochlmn (0.4.4 public; 0.4.5 uploaded and submitted 2026-11-22). Updates: upload, then `--publish` (goes through Google review) | `python3 scripts/cws-upload.py` (`--publish`, `--status`) |
| Edge Add-ons | same Chrome zip | needs a Partner Center account (operator) | dashboard upload |

**Images** (`docs/store/`, rendered by `node scripts/store-assets.mjs`; `... popup` / `... options` re-render only screenshot 2 / 3):
screenshot 1 `screenshot-1280x800.png` (right-click menu) first, screenshot 2 `screenshot-2-1280x800.png`
(save-all popup: the real `extension/popup.html` with a stubbed `chrome` API and self-drawn sample images) second,
screenshot 3 `screenshot-3-1280x800.png` (the real `extension/options.html`: file names, Downloads folder, quality) third,
promo tile `promo-440x280.png`. Upload all three screenshots to every store. AMO: `amo-submit.py --refresh-previews`
replaces its set; the Chrome Web Store's screenshots can only be changed in the dashboard (operator).

Build both zips with `node scripts/pack-extension.mjs`. The AMO listing text lives in `scripts/amo-submit.py`
(it differs from the text below only in naming Firefox instead of Chrome and in leaving out AVIF).

**Name:** Saveform: Save Image as PNG, JPG, WebP, PDF
**Category:** Tools / Photos
**Short description (≤132 chars):**
Save any image as PNG, JPG, WebP or PDF from the right-click menu, or every image on a page at once. Converted on your device.

**Long description:**

Saveform adds "Save image as" to the right-click menu for images, with a submenu:
PNG, JPG, WebP, PDF (and AVIF where the browser can write it), plus "Copy as PNG".
Its toolbar button lists every image on the current page so you can save many at once:
as separate files, as one ZIP, or combined into one PDF.

Useful when "Save image as…" gives you a .webp or .avif file that your editor, slide deck,
upload form or older system will not open.

• Converts on your device. The image is never uploaded anywhere.
• No analytics, no ads, no account, no remote code.
• Asks for almost nothing: no access to the pages you browse. If a server blocks extensions
  from reading an image, Saveform asks for access to that one site, and you can revoke it.
• Save all images on a page: pick them in a grid, hide small icons, choose PNG/JPG/WebP or keep
  the original format, and get separate files, one ZIP or one PDF. Picks the largest version a
  page offers (srcset) and finds CSS background images too. Shortcut: Alt+Shift+S.
• Keeps transparency in PNG and WebP; fills it with white (or a colour you pick) for JPG and PDF.
• PDF: one page, either the size of the image or A4 / US Letter with the image fitted.
• Renders SVG images at a usable size (1024 px by default).
• Choose JPG, PDF and WebP quality, and whether to see the Save dialog each time.
• Name files your way ({site} {date} {name}, {width}x{height}, …) and save into a folder inside Downloads.
• Open source (MIT): every file in the store package can be checked against the GitHub source.

Website and free online converters: https://janwan2003.github.io/save-image-format/
Source: https://github.com/janwan2003/save-image-format

**Single purpose:** Save images from web pages in a format the user picks (one image from the right-click menu, or several from the toolbar button).

**Permission justifications:**
- contextMenus: adds the "Save image as" submenu on images.
- downloads: writes the converted image to the user's downloads.
- activeTab: reads the right-clicked image, or the page's images after the user clicks the toolbar button, from the current site.
- scripting: lists the page's image addresses when the user clicks the toolbar button, reads blob: images from inside the page, copies the result to the clipboard, shows a short status message.
- storage: stores the user's settings.
- offscreen: renders SVG images, which the service worker cannot decode.
- optional host permissions (<all_urls>): requested per site, only when an image server refuses cross-origin reads, so that one image can be downloaded.

**Data usage:** collects no user data. No remote code.
**Privacy policy URL:** https://janwan2003.github.io/save-image-format/privacy/
