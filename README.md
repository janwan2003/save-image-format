# Saveform: save any image as PNG, JPG, WebP or PDF

Right-click an image → **Save image as** → **PNG / JPG / WebP / PDF** (and **AVIF** in browsers that can
write it), or **Copy as PNG**. Or click the toolbar button (Alt+Shift+S) to see every image on the page and save
the ones you pick as separate files, one ZIP or one PDF. The conversion happens on your device, inside the browser.

Website with free in-browser converters (WebP to PNG, HEIC to JPG, PDF to JPG, AVIF to JPG, JPG to PDF, PNG to ICO, PNG to GIF, …):
https://janwan2003.github.io/save-image-format/

## Why trust it

- **No network calls of its own.** The only requests Saveform makes are for the images you
  ask it to save (and, in the toolbar popup, their previews). There is no analytics, no remote code, no server and no account.
- **Minimal permissions.** It has no access to the pages you visit. On install it asks only for
  "Manage your downloads". Some image servers block extensions from reading images; only then does Saveform
  ask for access to that **one** site, and you can revoke it in settings.
- **Small and readable.** No build step and no dependencies: the files in [`extension/`](extension/)
  are exactly what ships. `node scripts/pack-extension.mjs` makes the store zip from them.
- **Tested.** `tests/` drives the real extension in Chromium: same-site, cross-site, CORS-blocked,
  SVG, `data:` and `blob:` images, broken files, clipboard, and a check that nothing else is requested.

## Permissions, in plain words

| Permission | Why |
|---|---|
| `contextMenus` | adds the "Save image as" entry to the right-click menu |
| `downloads` | saves the converted file |
| `activeTab` | when you click the menu or the toolbar button, lets Saveform read the current site's images |
| `scripting` | lists the page's images (toolbar button), reads `blob:` images from inside the page, shows a short notice, copies to the clipboard |
| `storage` | remembers your settings (quality, Save dialog, file name pattern, folder) |
| `offscreen` | Chrome only: renders SVG images, which the background worker cannot draw |
| optional host access | asked per site, only when an image server blocks cross-site reads |

## Install from source (until the store listings are live)

1. Download this repository (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the
   `extension` folder.

Firefox (142+): `about:debugging` → This Firefox → Load Temporary Add-on → `extension/manifest.json`.
Firefox: submitted to addons.mozilla.org on 2026-11-20 and waiting for Mozilla's review. The Firefox build passes the same end-to-end checks in real Firefox (`tests/firefox.test.mjs`).

## Develop

```
npm install            # playwright-core, used by the tests only
npx playwright-core install chromium
npm test               # unit + end-to-end tests in headless Chromium (and Firefox, if firefox + geckodriver are installed)
node scripts/build-site.mjs        # builds the website into dist/
node scripts/pack-extension.mjs    # builds packages/saveform-<version>-chrome.zip and -firefox.zip
python3 scripts/amo-submit.py      # uploads the Firefox zip to AMO (keys from the studio .env)
python3 scripts/cws-upload.py      # uploads the Chrome zip to the Chrome Web Store
```

## Known limits

- Chrome cannot write AVIF from a canvas yet, so the AVIF entry only appears where the browser supports it.
- Animated GIF/WebP: the first frame is saved.
- Images drawn on a `<canvas>` or set as CSS backgrounds are not "images" to the browser's
  right-click menu, so they get no menu entry.

## License

MIT, except `site/vendor/libheif/`: an unmodified WebAssembly build of [libheif](https://github.com/strukturag/libheif)
(LGPL-3.0, from the npm package `libheif-js` 1.23.5) that the website loads only to decode HEIC photos. It is not part
of the extension. Details and checksums in [`site/vendor/libheif/README.md`](site/vendor/libheif/README.md).
Also `site/vendor/pdfjs/`: an unmodified build of Mozilla's [PDF.js](https://github.com/mozilla/pdf.js) (Apache-2.0,
npm `pdfjs-dist` 6.5.438) that the website loads only when a PDF is added, to draw its pages. Not part of the extension
either; details and checksums in [`site/vendor/pdfjs/README.md`](site/vendor/pdfjs/README.md).
`node scripts/make-pdf-fixtures.mjs` rebuilds the PDF test files.
`node scripts/make-heic-fixtures.mjs` rebuilds the two HEIC test files in `tests/fixtures/` (needs ffmpeg with libx265).
