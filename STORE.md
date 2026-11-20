# Store listing (Chrome Web Store / Edge Add-ons / Firefox AMO)

## Where it stands (2026-11-20)

| Store | Package | State | How |
|---|---|---|---|
| Firefox AMO | `packages/saveform-0.3.0-firefox.zip` | 0.3.0 submitted, add-on id 3135549, status `nominated` (in Mozilla's review queue); will appear at https://addons.mozilla.org/firefox/addon/saveform-save-image-as-png-jpg/ | `python3 scripts/amo-submit.py` (`--status` to check) |
| Chrome Web Store | `packages/saveform-0.3.0-chrome.zip` | 0.3.0 uploaded as draft item `iimmananoageikphanfidapckaochlmn`; publishing waits for the operator to fill the dashboard (`store/chrome-privacy.md`) | `python3 scripts/cws-upload.py` (`--publish`, `--status`) |
| Edge Add-ons | same Chrome zip | needs a Partner Center account (operator) | dashboard upload |

Build both zips with `node scripts/pack-extension.mjs`. The AMO listing text lives in `scripts/amo-submit.py`
(it differs from the text below only in naming Firefox instead of Chrome and in leaving out AVIF).

**Name:** Saveform: Save Image as PNG, JPG, WebP, PDF
**Category:** Tools / Photos
**Short description (≤132 chars):**
Right-click any image and save it as PNG, JPG, WebP or PDF. Converted on your device. No tracking, no network calls, open source.

**Long description:**

Saveform adds "Save image as" to the right-click menu for images, with a submenu:
PNG, JPG, WebP, PDF (and AVIF where the browser can write it), plus "Copy as PNG".

Useful when "Save image as…" gives you a .webp or .avif file that your editor, slide deck,
upload form or older system will not open.

• Converts on your device. The image is never uploaded anywhere.
• No analytics, no ads, no account, no remote code.
• Asks for almost nothing: no access to the pages you browse. If a server blocks extensions
  from reading an image, Saveform asks for access to that one site, and you can revoke it.
• Keeps transparency in PNG and WebP; fills it with white (or a colour you pick) for JPG and PDF.
• PDF: one page, either the size of the image or A4 / US Letter with the image fitted.
• Renders SVG images at a usable size (1024 px by default).
• Choose JPG, PDF and WebP quality, and whether to see the Save dialog each time.
• Name files your way ({site} {date} {name}, {width}x{height}, …) and save into a folder inside Downloads.
• Open source (MIT): every file in the store package can be checked against the GitHub source.

Website and free online converters: https://janwan2003.github.io/save-image-format/
Source: https://github.com/janwan2003/save-image-format

**Single purpose:** Save images from web pages in a different image format.

**Permission justifications:**
- contextMenus: adds the "Save image as" submenu on images.
- downloads: writes the converted image to the user's downloads.
- activeTab: reads the right-clicked image from the current site after the user clicks the menu.
- scripting: reads blob: images from inside the page, copies the result to the clipboard, shows a short status message.
- storage: stores the user's settings.
- offscreen: renders SVG images, which the service worker cannot decode.
- optional host permissions (<all_urls>): requested per site, only when an image server refuses cross-origin reads, so that one image can be downloaded.

**Data usage:** collects no user data. No remote code.
**Privacy policy URL:** https://janwan2003.github.io/save-image-format/privacy/
