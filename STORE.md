# Store listing (Chrome Web Store / Edge Add-ons / Firefox AMO)

**Name:** Saveform: Save Image as PNG, JPG, WebP
**Category:** Tools / Photos
**Short description (≤132 chars):**
Right-click any image and save it as PNG, JPG or WebP. Converted on your device. No tracking, no network calls, open source.

**Long description:**

Saveform adds "Save image as" to the right-click menu for images, with a submenu:
PNG, JPG, WebP (and AVIF where the browser can write it), plus "Copy as PNG".

Useful when "Save image as…" gives you a .webp or .avif file that your editor, slide deck,
upload form or older system will not open.

• Converts on your device. The image is never uploaded anywhere.
• No analytics, no ads, no account, no remote code.
• Asks for almost nothing: no access to the pages you browse. If a server blocks extensions
  from reading an image, Saveform asks for access to that one site, and you can revoke it.
• Keeps transparency in PNG and WebP; fills it with white (or a colour you pick) for JPG.
• Renders SVG images at a usable size (1024 px by default).
• Choose JPG and WebP quality, and whether to see the Save dialog each time.
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
