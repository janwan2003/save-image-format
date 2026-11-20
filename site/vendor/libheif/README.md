# libheif (WebAssembly build), vendored unmodified

Used only by the HEIC converter pages to decode HEIC/HEIF photos, which most browsers cannot
open. Loaded by `assets/heic-worker.js` in a Web Worker, and only after a HEIC file is added.

- `libheif.js`, `libheif.wasm`: copied byte for byte from the npm package
  [`libheif-js` 1.23.5](https://www.npmjs.com/package/libheif-js/v/1.23.5), folder `libheif-wasm/`
  (source: https://github.com/catdad-experiments/libheif-js, built from
  [libheif](https://github.com/strukturag/libheif) with the [libde265](https://github.com/strukturag/libde265) HEVC decoder).
- `LICENSE`: the licence file shipped with that build (libheif: GNU LGPL v3).
- `LICENSE-libheif-js`: the licence of the npm package (LGPL-3.0).

These files are separate from Saveform's own code (MIT) and can be replaced with any compatible
build of the same library. SHA-256:

```
376c0bb483c23ac458cd22d718074693748ea75eddc3e4929353d4153e365a2e  libheif.js
184d3d20f8323877f13e9f5254f9c6a0ce272c9a3a2f823b0b2bcd2ee9f73f80  libheif.wasm
```
