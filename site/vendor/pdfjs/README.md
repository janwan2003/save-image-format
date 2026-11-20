# PDF.js, vendored unmodified

Used only by the converter pages to draw the pages of a PDF the user adds (PDF to JPG, PNG, TIFF, …).
Loaded by `assets/pdf-client.js`, and only after a PDF is added; parsing runs in the PDF.js worker.

Copied from the npm package [`pdfjs-dist` 6.5.438](https://www.npmjs.com/package/pdfjs-dist/v/6.5.438)
(source: https://github.com/mozilla/pdf.js), licence Apache-2.0 (`LICENSE`):

- `pdf.min.js`, `pdf.worker.min.js`: `build/pdf.min.mjs` and `build/pdf.worker.min.mjs`, byte for byte,
  renamed to `.js` so every static host serves them with a JavaScript MIME type.
- `cmaps/`, `standard_fonts/`, `iccs/`: the package folders of the same names (CJK character maps,
  replacement fonts for the 14 standard PDF fonts with their own licences, a CMYK profile).
- `wasm/`: `openjpeg.wasm` (JPEG 2000), `jbig2.wasm` (JBIG2), `qcms_bg.wasm` (colour management) with their
  no-wasm fallbacks and licence files. The QuickJS files (PDF scripting) are left out: the site never runs PDF scripts.

These files are separate from Saveform's own code (MIT) and can be replaced with any later build. SHA-256:

```
3a88402882cfa3e7e72c2c9b5149f52f0f88baf1c5b62aa11a41abdbc2072440  pdf.min.js
1e64c8240e54735ec5913b37acd5134747799cb8c6bb3777c70adbc01232d2aa  pdf.worker.min.js
466f45c2a61a698152fb5400c27e56ff2ceb73dcb71fde3fc366a502308eaab0  wasm/jbig2.wasm
7ea4b2b04613370ad4e9c1162da750cc88b4b176eac0d0c164b3caff23fc0a46  wasm/openjpeg.wasm
663d86126d5f5fcb1c61490f94353e2a8375660b8c5498ab3ebab5a34b08800e  wasm/qcms_bg.wasm
```
