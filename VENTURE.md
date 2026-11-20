---
slug: save-image-format
stage: launched
priority: 4
url: https://janwan2003.github.io/save-image-format/
repo: https://github.com/janwan2003/save-image-format
updated: 2026-11-20
---

# save-image-format (product name: Saveform)

## Thesis

**Who:** People who right-click "Save image as…" on the web and get a `.webp` or `.avif`
file that their editor, slide deck, marketplace upload form or older OS will not open.

**What:** A Chrome (later Firefox/Edge) extension that adds a right-click menu entry,
"Save image as → PNG / JPG / WebP / AVIF / PDF". It converts the image locally on a
canvas and needs no network access, no remote code and no account. A companion static
site ("WebP to PNG", "AVIF to JPG", … converters that run in the browser) gives the
extension a search channel and works for people who will not install anything.

**Why now:** The category leader, *Save Image as Type* (1M+ users, Google "Featured"
badge), was sold in November 2025, used to hijack affiliate links, and **disabled by
Google as malware in March 2026**. About a million people lost a tool they used daily, and the
replacements are small, stale or upsell-heavy (see below). Trust is now the main way to
stand out in this category.

## Market evidence

Demand (the incumbent's users and search volume):
- Original *Save Image as Type* had at least 1M users and was removed as malware:
  [9to5Google, 2026-03-16](https://9to5google.com/2026/03/16/image-saving-chrome-extension-removed-as-malware/),
  [Windows Central](https://www.windowscentral.com/software-apps/google-promoted-a-malicious-chrome-extension-after-microsoft-banned-it),
  [PCWorld](https://www.pcworld.com/article/3092299/my-most-useful-chrome-extension-was-stealing-my-data-for-years.html),
  [TechSpot thread](https://www.techspot.com/community/topics/popular-chrome-extension-save-image-as-type-was-hijacked-impacting-over-1-million-users.296830/).
  Its listing `gabfmnliflodkdafenbcpjdlppllnemd` now resolves to "empty-title" (queried live 2026-11-20).
- Search: "webp to png" ≈110,000/mo and "webp to jpg" ≈130,000/mo in a Semrush keyword
  list for tiny-img.com ([Semrush](https://ko.semrush.com/website/tiny-img.com/overview));
  this is a third-party estimate and the country is not stated.
- HEIC (session 6): "heic to jpg" ≈246,000/mo, "convert heic to jpg" ≈60,500, "heic to jpg converter" ≈27,100, "heic to jpeg"
  ≈18,100 in Semrush's overview of heictojpg.com ([Semrush, updated 2025-06-12](https://sv.semrush.com/website/heictojpg.com/overview));
  third-party estimate, country not stated, ~17 months old. Bigger than the webp terms above, and the field is crowded with upload-based sites.
- SVG (session 13): "png to svg" ≈540,500/mo in Semrush's overview of picsvg.com ([Semrush, updated 2026-02-12](https://tr.semrush.com/website/picsvg.com/overview);
  read from a web-search summary, Turkish locale, so "540.500" was read as 540,500; third-party estimate, country not stated). Not re-checked
  on the page itself. Competitors seen in that space: picsvg.com, vectorizer.ai (paid), svgtrace.com; several "PNG to SVG" sites only wrap the
  bitmap in an SVG file (general knowledge, not measured this session).
- Vendors are already writing articles to capture these searches, e.g. [MConverter blog](https://mconverter.eu/blog/why-save-image-as-type-removed).

Competitors (Chrome Web Store, queried live with curl on 2026-11-20):
| Extension | Users | Rating | Last update | Note |
|---|---|---|---|---|
| [Save Image As PNG](https://chromewebstore.google.com/detail/save-image-as-png/nkokmeaibnajheohncaamjggkanfbphi) | 400,000 | 4.0 (444) | 2024-06-03 | PNG only, stale; the replacement 9to5Google suggested |
| [Save Image as Type — JPG PNG WebP PDF, Resize & Remove Background](https://chromewebstore.google.com/detail/cgbkfninjjcfllibdoecfdojodhgidbn) | 40,000 | 4.8 (222) | 2026-10-31 | grabbed the name after the takedown; adds extra features |
| [Save Image As Type - WebP to JPG, PNG, PDF](https://chromewebstore.google.com/detail/cdbiiebbmakabndhlnmafglhljenfood) | 9,000 | 4.2 (16) | 2026-10-31 | |
| [Convert WebP to PNG / JPG](https://chromewebstore.google.com/detail/egmjalgmmolinfenecmfaeognbjbiipi) | ~70,000 | 3.4 (186) | ? | figures from search snippet, not re-verified |
- Firefox: [f*ckwebp](https://addons.mozilla.org/firefox/addon/f-ckwebp/), [Save webP as PNG or JPEG](https://addons.mozilla.org/addon/save-webp-as-png-or-jpeg).

- Builder re-check 2026-11-20 (web search "Saveform chrome extension image", "save image as png jpg"):
  the field is more crowded than the table shows: at least ~12 more small listings target the
  same users, e.g. [Save Image As PNG/JPG](https://chromewebstore.google.com/detail/aikgeijonilcajmobmdlcbepalbncoal),
  [Save Image As Format](https://chromewebstore.google.com/detail/fobfijkojkkialaegfcagpadjdikpgdi),
  [Save Image As](https://chromewebstore.google.com/detail/oighgmkmcofpknggipldbmihbjblkgia) (claims AVIF),
  [Save Image As… (JPG/PNG/WebP)](https://chromewebstore.google.com/detail/mfpijellblgblfdkjgfihjipplocpche).
  User counts for these were not fetched. Demand is real, but it is split across many small clones, so the
  store listing alone will not stand out; the site and the trust story have to.

Takeaway: the old leader's ~1M users have split, and no replacement has more than about 400K
users. The biggest one has not been updated in 2.5 years and only does PNG.

## Our edge

- **Easy to check that it is trustworthy:** open source on GitHub, minimal permissions (`contextMenus`,
  `downloads`, and `activeTab`; no `<all_urls>` host access if we can avoid it), no
  network calls, no analytics in the extension. Store builds are reproducible from tagged
  source. The listing and site say all of this in plain words, which is exactly what
  the incumbent got wrong.
- **Save every image on a page** (0.4.0): grid picker, files / ZIP / one PDF, largest srcset version, CSS backgrounds.
  None of the competitors in the table above advertises this in its listing name (checked only by name, not by installing them).
- **More formats than the 400K leader:** PNG, JPG (with quality), WebP, AVIF, and
  "copy as PNG to clipboard". Also handles AVIF/JXL sources where the browser can decode
  them.
- **Search channel:** static in-browser converter pages (webp→png, webp→jpg, avif→png,
  png→webp, …), each linking to the extension. Static GitHub Pages, no server.
- Small scope, so it can ship in one or two sessions, and each later format is a
  feature we can announce.

## Status

Product name **Saveform** (the slug stays `save-image-format`; "Save Image As Format" is an existing listing, so not used).

**Extension** (`extension/`, MV3, no build step, no dependencies, v0.4.4 (= 0.4.3 behaviour; ships the shared `lib/trace.js` and the extended `png-quant.js` because `convert.js` imports them; SVG is not in the extension menu); 0.4.2 = 0.4.1 + WebP outputs above 16,383 px refused with a clear message instead of Chromium silently cropping them; 0.4.3 = PDF pages that are pure black and white stored losslessly at 1 bit, grey pages at 8-bit grey (shared `lib/pdf.js`), plus `lib/tiff-write.js` shipped because `convert.js` imports it; TIFF is not in the extension menu):
- Right-click image → Save image as → PNG / JPG / WebP / PDF (AVIF only where the browser's canvas can
  write it; Chrome 159 cannot, so not shown there) / Copy as PNG. PDF (added in v0.2.0) = one page, page size
  set in settings (same as image by default, or A4 / US Letter), JPEG quality shared with JPG.
- **Save all images on a page (v0.4.0, session 5):** toolbar button / Alt+Shift+S opens a popup (`popup.html/js/css`) that
  lists the page's images (`lib/collect.js`: `<img>` with the largest `srcset` w-candidate, SVG `<image>`, video posters, CSS
  backgrounds; since 0.4.1 also lazy-loaded `<img>` not loaded yet: `data-src`, `data-lazy-src`, `data-original`, `data-lazy`,
  `data-srcset`, `data-lazy-srcset`, `<picture><source>`; up to 500), with a size filter (0×0 = unknown size, never hidden) (default: hide < 100 px), select all/none, format PNG/JPG/WebP/(AVIF)/original,
  output separate files / one ZIP / one PDF. The batch runs in the background (`startBatch`/`continueBatch` in `background.js`)
  so it survives the popup closing; sites that refuse extension reads are listed once with Allow / Skip so a ZIP or PDF stays
  one file (Firefox: `permissions.onAdded` continues the batch if the popup closed during the prompt). Shared code moved to
  `lib/fetch.js` and `lib/zip.js` (the site imports `lib/zip.js` too). Popup previews load the image URLs with no referrer.
- PDF and ICO are written by our own code (`extension/lib/pdf.js`, `makeIco` in `extension/lib/convert.js`):
  PDF 1.4 with JPEG (DCTDecode) or, at 100% quality, lossless zlib RGB (FlateDecode) pages; ICO with PNG entries.
- Fetch order: extension fetch (works for CORS-enabled CDNs and the page's own site via activeTab) →
  fetch from inside the page (cookies/referrer; `blob:` URLs) → popup asking for access to that one
  image host (optional host permission, revocable in settings). Install warning is only "Manage your downloads".
- SVG rendered via an offscreen document (Chrome) at ≥1024 px; JPG fills transparency with a chosen colour;
  settings page (quality, Save dialog on/off, file name pattern, Downloads subfolder, granted sites); errors shown as an in-page notice.
- One manifest serves Chrome and Firefox (`background.scripts` + `service_worker`, gecko id, min Firefox 142).
- Store zips: `node scripts/pack-extension.mjs` → `packages/saveform-0.4.4-chrome.zip` and
  `packages/saveform-0.4.4-firefox.zip` (Firefox: manifest without `service_worker`/`offscreen`, plus `clipboardWrite`;
  offscreen files left out). Listing text and permission justifications in `STORE.md`; images in `docs/store/`.
- **Firefox AMO: submitted 2026-11-20** with `scripts/amo-submit.py` (AMO API v5): add-on id 3135549, slug
  `saveform-save-image-as-png-jpg`, status `nominated` (Mozilla review queue), version 0.1.0 file `unreviewed`,
  AMO validation 0 errors / 1 warning (guarded `offscreen` call), 1 screenshot. Check with `python3 scripts/amo-submit.py --status`.
  **v0.2.0 (PDF) submitted 2026-11-20** (AMO version id 6737926, file `unreviewed`, add-on still `nominated`; the
  superseded unreviewed 0.1.0 file is now `disabled`). The first attempt got HTTP 429 (throttled ~45 min); the retry worked.
  `amo-submit.py` now also PATCHes the listing summary/description when it adds a version.
- **Chrome Web Store: uploaded as a draft, waiting for the operator.** The API works since 2026-11-20 (session 4):
  item id `iimmananoageikphanfidapckaochlmn` (`store/cws-item-id.txt`), package 0.4.4 uploaded in session 13 (`--status`: crxVersion 0.4.4).
  `cws-upload.py --publish` returns 400 listing exactly what the dashboard still needs (contact email + verification,
  language, category, icon, screenshot, description, Privacy practices). Text and files for every field: `store/chrome-privacy.md` (inbox line filed).
- **AMO v0.3.0 submitted 2026-11-20** (version id 6737975, file `unreviewed`; 0.2.0 file now `disabled`). The listing-text PATCH
  that follows was throttled (429, ~23 h); retry with `python3 scripts/amo-submit.py --listing`.
- **AMO v0.4.0–0.4.4 NOT yet submitted** (0.4.4 is the one to submit; 0.4.0 never reached AMO): upload validated (0 errors, 1 warning) but the version POST got 429 "available in 80669 s"
  (≈ 2026-11-21 12:25 UTC). Re-run `python3 scripts/amo-submit.py` (it adds the version and PATCHes the new listing text).
- **v0.3.0 (session 4):** settings for a file name pattern (`{name}`, `{site}`, `{date}`, `{time}`, `{width}`, `{height}`;
  default `{name}`) and a folder inside Downloads (`buildFilename()` in `extension/lib/filename.js`; separators, `..` and
  reserved names are cleaned).
- **Search:** site verified in Google Search Console on 2026-11-20 (`scripts/gsc.py verify`: siteOwner) and `sitemap.xml`
  submitted (`gsc.py sitemap`; state pending). Ownership file and IndexNow key live in `site/verify/` and are copied to the
  site root. `scripts/indexnow.py` pushes every sitemap URL to IndexNow (Bing, Yandex, Seznam, Naver; no account).
  the Chrome Web Store API is not enabled in the operator's Google Cloud project (inbox request filed 2026-11-20).

**HEIC input (session 6):** the site decodes HEIC/HEIF (iPhone photos) with libheif compiled to WebAssembly (`site/vendor/libheif/`,
unmodified `libheif-js` 1.23.5 wasm build, LGPL-3.0, licences + SHA-256 in its README) in a Web Worker (`site/assets/heic-worker.js`,
`heic.js`), downloaded only when the first HEIC file is added (live: wasm 490 KB gzipped). `decode()` in `extension/lib/convert.js`
takes per-kind `fallbackDecoders` (the extension passes none, so the extension is unchanged). Pages: /heic-to-jpg/, /heic-to-png/,
/heic-to-pdf/ and the guide /how-to-open-heic-files-on-windows/; HEIC also works on every other converter page. Test fixtures are made
by `scripts/make-heic-fixtures.mjs` (own HEIF writer around x265 output, since nothing here writes HEIC): `tests/fixtures/quadrants.heic`
(single image) and `grid-rotated.heic` (2×2 tile grid + `irot`, like iPhone files).
**Colour management (session 7):** iPhone HEICs carry a Display P3 ICC profile (5 of 7 real files tried; Display P3 = Apple's wider-than-sRGB
colour space). The worker now reads the primary image's profile via libheif's C API (`colourProfile()` in `heic-worker.js`) and
`site/assets/icc.js` converts ICC matrix/TRC profiles and nclx tags (P3, BT.2020, DCI-P3) to sRGB; sRGB profiles are skipped; LUT-only ICC
and PQ/HLG HDR are passed through unchanged (not tone-mapped). Fixtures `quadrants-p3.heic` / `-untagged.heic` (our own P3 ICC profile).

**TIFF input (session 8):** the site decodes TIFF with our own decoder (`site/assets/tiff.js`, no dependencies; run in
`tiff-worker.js`, loaded via `tiff-client.js` when the first TIFF is added; `sniffType` in `extension/lib/convert.js` now returns
`tiff`, and `decode()` takes `preferFallback`). It covers TIFF and BigTIFF; strips and tiles (including tile offsets stored in the strip
tags); no compression, PackBits, LZW (also old-style LZW), Deflate, JPEG (compression 7), CCITT G3/G4 fax; 1–32-bit integer and 32-bit
float samples; bilevel, grey, RGB, palette, CMYK, YCbCr (with JPEG, or subsampled without it); associated and unassociated alpha;
Orientation; an ICC profile is converted to sRGB with `icc.js`. A **multi-page TIFF becomes one row per page** (`name (page k of N)`,
output `name-page-k.ext`); PDF rows now preview the page's own JPEG. Not supported (clear error): old-style JPEG (6), LogLuv,
ThunderScan, LZMA/ZSTD/WebP/JPEG 2000, CIELab, 64-bit float, floating-point predictor. Pages: /tiff-to-jpg/, /tiff-to-png/, /tiff-to-pdf/.
**TIFF output (session 9):** our own writer `extension/lib/tiff-write.js` (baseline TIFF 6.0, little-endian): LZW with the horizontal
predictor (8-bit) or uncompressed; picks 1-bit black/white, 8-bit grey, RGB or RGB + unassociated alpha from the pixels; 72 dpi; strips
of ~64 KB; multi-page files with PageNumber. Site: "TIFF" in every format menu, a Compression select (LZW (smaller) / None (uncompressed)),
**Download one TIFF** joins all rows in list order (↑/↓ now shown for TIFF as well as PDF), files named `.tif`; PDF and TIFF rows get a
128 px PNG preview (`preview` option of `convertBlob`). Pages (subagent): /jpg-to-tiff/, /png-to-tiff/, /webp-to-tiff/, /heic-to-tiff/ and
the guide /how-to-make-a-multi-page-tiff/ (combine and split; ImageMagick/tiffcp/tiffsplit commands run by the subagent). Session 8's two TIFF
defects are fixed: fax/bilevel PDF pages are 1-bit Flate (libtiff's g3test.tif: 49 KB TIFF → 44 KB PDF, was 529 KB), and an IFD with no
NewSubfileType tag that is ≤ 1/3 of the previous page's size, same aspect, ≤ 512 px is a thumbnail (dscf0013.tif: 1 page, was 2).
`npm test` now runs test files one at a time (`--test-concurrency=1`): each file rebuilds `dist/`, and in parallel they collided.
**Resize, max file size, PNG compression (session 10):** every converter page now has **Resize** (Original size / Fit within W × H, never
enlarges / Exact size, one side may be empty to keep proportions / Percent; large reductions step down 2× at a time so fine detail does not
alias), **Max file size** (KB; JPG/WebP/AVIF: bisection for the highest quality ≤ the slider that fits, floor 30%; if none fits, the dimensions
shrink so the next round lands near 60% quality; PNG: lossless, else 256 colours, else smaller; the row shows the quality used or warns when the
target was not reached) and **Colours** for PNG (Lossless / 256…16: our own indexed-colour PNG writer `extension/lib/png-quant.js`, subagent:
RGBA-aware median cut + k-means, Floyd–Steinberg, PLTE + tRNS, 1/2/4/8-bit). Pages with `sameFormat` offer **Same as original** (JPG→JPG,
PNG→PNG, WebP→WebP, HEIC→JPG, others→PNG) and keep the input file untouched when re-saving would not make it smaller. Engine options:
`resize`, `targetBytes`, `pngColors` in `convertBlob` (`outputSize()` exported). New pages (subagent content): /compress-image/, /compress-jpg/,
/compress-png/, /resize-image/, /compress-image-to-100kb/, /-50kb/, /-20kb/, listed under "Compress and resize" on /guides/. The extension
does not use the new options; its `convert.js` now imports `png-quant.js` (extension tests passed with it in CI; not repacked or uploaded).
**SVG output = vector tracing (session 13):** every converter page offers "SVG (traced vector)", with **Colours** (Black and white
/ 2 / 4 / 8 / 16 / 32) and **Detail** (High / Normal / Low). Own tracer `extension/lib/trace.js` (no dependencies): palette from "flat"
pixels when ≥ 50% are flat (logos; anti-aliased edges ignored) else all pixels (photos), via `choosePalette` (new export in
`png-quant.js`); entries within ~20 levels of a more common one merged (JPEG noise); despeckle (regions < max(4, n/40000) px at Normal);
colours stacked largest-first as cumulative layers (no seams); contours along pixel edges → unit-edge midpoints; corners found first
(±3 points, ≥ 60°), Douglas–Peucker split at corners + pruning, least-squares refit of each segment, short-chamfer restore, quadratic
curves (corners ≥ 70° stay sharp); `fill-rule="evenodd"`. Black and white = Otsu threshold, one black path, transparent background.
Traced with the longer side between 512 px (small images upscaled ≤ 8×; colours then picked from the unscaled pixels) and 2,000 px; the
SVG declares the output size. Runs in a module Web Worker on the site (`site/assets/trace-worker.js` + `trace-client.js`; falls back to
the page if the worker fails). Rows show "N colours, M shapes" (M = subpaths, inflated by stacking). Pages: /png-to-svg/, /jpg-to-svg/,
/image-to-svg/ (sitemap 67 → 70). Measured (Node, `traceImage` direct, this machine): 256 px icons 7–20 ms at native size; a 2000×1125
photo at 8 colours 0.5–3.2 s and 185 KB–4.4 MB of SVG; at 32 colours up to 7.6 s / 13.8 MB (busy forest photo) — which is why it runs in
a worker. Accuracy: synthetic logo rendered back in Chromium differs in ≤ 1% of pixels (8/4/16/32 colours), no background showing
between colours. Visual check on Firefox, Inkscape, LibreOffice Calc, Debian and htop icons from `/usr/share` and two JPG wallpapers.
**Not verified (session 13):** SVGs opened in Inkscape/Illustrator/Figma or cutting-machine software (only Chromium and Firefox rendered
them); Safari (module workers need Safari 15+); pixel art (upscaling rounds it, by design); the main-thread fallback path; SVG size
limits in other tools for 10+ MB photo traces; "32 colours" on photos often yields 13–16 after merging (the row shows the real count).
**Camera RAW input (session 12):** every converter page takes RAW files (CR2, CR3, NEF/NRW, ARW, DNG, RAF, ORF, RW2, PEF, SRW and
other TIFF-shaped RAW by extension). `site/assets/raw.js` (own code) does **not** develop sensor data: it walks every `FF D8 FF` in the
file, parses markers to the frame header, keeps baseline/progressive 8-bit frames (lossless SOF3 = sensor data, skipped), takes the one
with most pixels, and applies the container's EXIF orientation (TIFF IFD0, or CR3's CMT1 box) only when that JPEG has none. RAW is
detected in `app.js` *before* `sniffType` (CR2/NEF/… have TIFF magic and would otherwise become TIFF page rows); rows say "from the
camera's built-in W × H JPEG". `convert.js` `decode()` gained a `decoder` override for this. Checked against LibRaw (rawpy 0.28,
`extract_thumb`) on 12 real files from raw.pixls.us: same size on all 12 — full size for Canon 5D III/7D CR2, R10 CR3, Nikon D750/Z 6 NEF,
Pentax K-1 PEF, iPhone 12 Pro DNG (portrait, upright); smaller for Fuji X-T3 RAF 4416×2944, Olympus E-M10 ORF 3200×2400, Panasonic GH4 RW2
1920×1920, Sony A7 III ARW 1616×1080, Pixel 4a DNG 672×504. All 12 (≈360 MB) converted in 3.4 s in headless Chromium. New pages:
/raw-to-jpg/, /cr2-to-jpg/, /cr3-to-jpg/, /nef-to-jpg/ (group "From camera RAW"); no /arw-to-jpg/ or /dng-to-jpg/ because those
previews can be small.
**PSD input (session 12, subagent decoder):** `site/assets/psd.js` + `psd-worker.js` + `psd-client.js` (own code, same shape as the TIFF
decoder): PSD and PSB; raw / PackBits / ZIP (with prediction); 1/8/16/32-bit; Bitmap, Grey, Duotone, Multichannel, Indexed, RGB, CMYK
(simple formula, no profile), Lab; ICC (1039) → sRGB; merged alpha only when the layer count is negative or an `Mtrn`/`Mt16`/`Mt32` block
exists (spot channels/selections are not alpha), Photoshop's white matte removed. Without a flattened copy (resource 1057) it rebuilds
from visible pixel layers (normal blend, opacity; no masks/effects) and the row warns "rebuilt from the layers". `sniffType` returns `psd`
for `8BPS`. Cross-checked by the subagent on 348 Photoshop files from the psd-tools corpus (313 within 2 of ImageMagick; the rest are
ImageMagick errors on 32-bit/Lab/grey-alpha, files with no composite, 1 truncated, 1 masked layer file). New pages /psd-to-png/, /psd-to-jpg/.
**Not verified (session 12):** RAW/PSD in Firefox and Safari (Chromium only); RAW with an Adobe RGB preview (would look muted; untested);
CR3 shot in HDR PQ / HEIF mode (preview may be HEIF, not JPEG → probably the 1620 px or 160 px JPEG or an error); NRW, SRW, X3F, MRW
(no samples); real Photoshop CMYK files with transparency; PSD files of hundreds of MB (whole file held in memory, plus RGBA).
Search demand for the 6 pages was not sourced (web search returned competitor pages, no volumes).
**PDF input (session 11):** every converter page now takes PDF files: each page becomes one row (`name (page k of N)`, output
`name-page-k.ext`, up to 500 pages), drawn by **PDF.js** (Mozilla's PDF engine, the one inside Firefox's viewer; npm `pdfjs-dist`
6.5.438, Apache-2.0, vendored unmodified in `site/vendor/pdfjs/` with SHA-256 in its README; the two `.mjs` files renamed `.js` for
MIME types) via `site/assets/pdf-client.js`, downloaded only when the first PDF is added (live size: about 510 KB gzipped for the two
scripts). A **PDF resolution** select (72 / 150 default / 200 / 300 dpi) is shown on PDF pages and elsewhere once a PDF is added;
changing it redraws only PDF rows. Pages are drawn on white with the 14 standard fonts from PDF.js's bundled font files
(`useSystemFonts: false`, so output does not depend on the computer), capped at 16,384 px a side and 50 MP. Password-protected and
invalid PDFs give clear error rows. `sniffType` in `extension/lib/convert.js` returns `pdf` (`%PDF-` in the first 1 KB); the extension
itself only gets a clearer error for a PDF. New pages: /pdf-to-jpg/, /pdf-to-png/, /pdf-to-tiff/ (own content); the index page and
/jpg-to-pdf/ link to them. Fixtures: `scripts/make-pdf-fixtures.mjs` (hand-written 2-page PDF with a non-embedded Helvetica and a
`/Rotate 90` page; junk PDF) and `locked.pdf` (MuPDF `mutool clean -E aes-128`). Field check script: `scripts/real-pdfs.mjs`
(our PNG vs poppler's `pdftoppm` at the same dpi).
**/guides/ index (session 8, subagent):** one card per guide plus converters grouped by source format; footer shows 3 guides + "All guides →";
"Guides" in the header nav. **Store screenshot 2** (`docs/store/screenshot-2-1280x800.png`, the real save-all popup with stubbed data,
made by `scripts/store-assets.mjs`) is listed in `store/chrome-privacy.md` and `STORE.md` for the operator to upload.

**Website** (live, https://janwan2003.github.io/save-image-format/): 51 converter pages plus the index (counted from `converters` in site/pages.mjs; 48 in session 10, +3 PDF pages in session 11) (+7 compress/resize pages in session 10, +3 TIFF pages in session 8, +4 →TIFF pages in session 9), (+3 HEIC pages in session 6, +heic→webp and avif→webp in session 7) (png/jpg/webp→gif added in session 5, with
our own GIF89a encoder `extension/lib/gif.js`: median-cut palette, optional Floyd–Steinberg dithering, 1-bit transparency, LZW; GIF
is also on the index format menu, not in the extension menu) (index,
webp→png/jpg/pdf/ico, avif→png/jpg, png→webp/jpg/pdf/ico, jpg→webp/png/pdf/ico, svg→png/jpg/ico, gif→png/jpg, bmp→png/jpg, ico→png,
jfif→jpg/png, image→pdf, favicon generator),
5 guides (/how-to-save-webp-as-png/, /why-images-save-as-webp/, /save-image-as-type-alternative/, /how-to-open-heic-files-on-windows/, /how-to-download-all-images-from-a-page/ (session 7)), plus privacy, extension and 404 pages;
batch convert, paste, ZIP download, no external requests, same engine (`extension/lib/convert.js`)
as the extension. Every converter page can also output PDF (page size A4 / US Letter / same as image; "Download one PDF"
combines all rows in list order; ↑/↓ buttons reorder) and ICO (pick sizes 16–256 px). jfif→jpg keeps the JPEG bytes
unchanged by default (rename only). Sitemap with 67 URLs (session 12: +4 RAW, +2 PSD pages; session 11: +3 PDF pages; session 8: +3 TIFF pages, +/guides/; session 9: +4 →TIFF pages, +1 guide; session 10: +7 compress/resize pages). Deployed by `.github/workflows/pages.yml`.

**Verified (2026-11-20):**
- `npm test`: 24/24 pass locally and in GitHub Actions (run 44731849970, ubuntu, Chromium 159):
  12 extension end-to-end cases (same-site, CORS CDN, SVG, data:, blob:, CORS-blocked → grant page,
  grant → save, broken image, clipboard, no extra requests, menu entries), 3 settings/grant tests,
  2 unit tests, 9 site tests (the site agent's count; npm test total 24 covers them all).
- Field test on 20 real sites (`scripts/real-sites.mjs`, results in `docs/field-test-2026-11-20.md`):
  17 saved directly, 1 (Pinterest's i.pinimg.com) needs the one-site permission, 2 had no `<img>`.
- `web-ext lint` (Mozilla's add-on linter): 0 errors, warnings only for the Chrome-only `offscreen` API (guarded at runtime).
- Live site: Pages deploy run 44731849996 succeeded; `/`, `/webp-to-png/`, `/privacy/`, `/extension/`,
  `/sitemap.xml`, `/og-image.png` return 200; a WebP converted on the live page downloaded as a valid
  PNG, with 0 console errors and no requests to hosts other than github.io.

**Verified (2026-11-20, session 2):** `npm test` 34/34 locally, including `tests/firefox.test.mjs` (6 cases in real
Firefox 158 via geckodriver 0.37.1: menu built, same-site WebP→PNG, CORS WebP→JPG, SVG→PNG on the event page, data:→WebP,
Copy as PNG reports success; clipboard contents not read back). `web-ext lint` on the Firefox zip: 0 errors, 1 warning.

**Verified (2026-11-20, session 3):** `npm test` 41/41 locally and in GitHub Actions run 44737512237 (Chromium + Firefox 160,
poppler installed so the PDF render check ran). New cases: jpg→pdf (A4 orientation, reorder, combine, "fit" size, rendered by
poppler `pdftoppm` with image centred and white margins), png→pdf lossless (exact pixel values after inflate), png→ico (4 PNG
entries, sizes, transparent padding), jfif→jpg (identical bytes; re-encode when unticked), extension Save as PDF in Chromium
(same-site and SVG via offscreen) and in Firefox 158. `web-ext lint` on the 0.2.0 Firefox zip: 0 errors, 1 warning (offscreen).
Live after Pages run 44737512247: `/`, the 6 new pages, `/lib/pdf.js`, `/extension/` return 200 (`/png-to-ico/` once 503, then
200 on 3 retries); sitemap has 27 <loc>; live /jpg-to-pdf/ in headless Chromium combined two JPGs into a 2-page PDF
(portrait + landscape A4, rendered by poppler), 0 console errors, 0 requests outside github.io.
Visual check: screenshots of /jpg-to-pdf/ (light) and /png-to-ico/ (dark) with two files added looked right.

**Verified (2026-11-20, session 4):** `npm test` 48/48 in GitHub Actions run 44746561369 (0 skipped; Chromium + Firefox) on
commit a79877a. New cases: file name pattern + subfolder (unit test of `buildFilename`; Chromium returns
`Saveform/web/127.0.0.1 64x48 photo.png`; in real Firefox 158 the file landed on disk at `Saveform/web/64x48 same.png`),
settings page saves the two new text fields, the 5 new pages (title/h1/canonical/sitemap; favicon 16/32/48 + 256; PNG + WebP
combined into a 2-page PDF rendered by poppler; svg/webp/jpg→ico). `web-ext lint` on the 0.3.0 Firefox zip: 0 errors, 1 warning
(offscreen). Live after Pages run 44746561233: the 5 new URLs, `/sitemap.xml` (32 <loc>), the Google ownership file and the
IndexNow key return 200; live /favicon-generator/ in headless Chromium wrote `logo.ico` with 16/32/48 entries and live
/image-to-pdf/ combined two PNGs into a 2-page `a-and-1-more.pdf`, 0 console errors, 0 requests outside github.io.
Visual check: settings page screenshot (light) looked right; the subagent checked /favicon-generator/ (light) and /image-to-pdf/
(390 px, dark).

**Verified (2026-11-20, session 5):** `npm test` 65/65 locally and in GitHub Actions run 44748850979 (0 skipped; Chromium +
Firefox) on commit baa719a. New: `tests/batch.test.mjs` (collector finds `<img>`, largest srcset candidate incl. a URL with a comma,
SVG, CSS background; ZIP of 4 PNGs with sizes checked and the non-CORS CDN image asking for access then skipped; one 3-page PDF;
original-format files byte-identical; the popup lists 6 images, hides the 1×1, saves 2 as JPG and remembers the choice), a Firefox
case (ZIP of 3 PNGs from the event page, read back from disk), `tests/gif.test.mjs` (7 encoder cases decoded by Chromium and an
independent reader, incl. LZW table resets) and 4 GIF site tests (subagent). Field check `scripts/real-sites-batch.mjs` on 10 real
sites (Chromium, ZIP of up to 12 PNGs each): Wikipedia 6/6, BBC 12/12, Guardian 11/11, IKEA 12/12, NASA 12/12, Flickr 12/12,
Dribbble 11/12 (1 site blocked extension reads → skipped), Shopify 12/12; Unsplash listed 0 images and Pexels 1 (headless page,
as in the earlier field test). Popup screenshot looked right after fixing a grid overflow. `web-ext lint` on the 0.4.0 Firefox zip:
0 errors, 1 warning (offscreen). Live after Pages run 44748850990: the 3 GIF pages, `/lib/gif.js`, `/lib/zip.js`, `/privacy/`
(mentions the toolbar list), `/extension/` return 200; sitemap 35 <loc>; live /webp-to-gif/ in headless Chromium wrote
`grad.gif` (GIF89a, 120×80, transparent half kept), 0 console errors, no requests outside github.io.

**Verified (2026-11-20, session 6):** `npm test` 72/72 in GitHub Actions run 44751383003 on commit 87b043e (0 skipped; Chromium +
Firefox; run 44750918433 on 3264307: 69/69), and 74/74 locally on the merged tree with 0.4.1 (adds the lazy-image collector test
and a popup test for 0×0 images). New HEIC cases: heic→jpg colours of 4 quadrants, decoder fetched only after a HEIC is added;
tile grid + `irot` gives 96×128 with the right quadrant colours (Chromium and real Firefox 158/160 via `tests/firefox-site.test.mjs`);
2 HEICs → 2-page PDF; truncated HEIC → error row; the index page and the guide's embedded converter take HEIC. Fixtures checked
independently: ffmpeg 8.0.1 decodes `quadrants.heic` to the 4 colours and each grid tile in order (its own grid composition is
wrong, see memory). A real HEIC (libheif's `examples/example.heic`, 1280×854, 2 images + thumbnails): primary image picked, 342 ms
locally, RMSE 0.68% against ffmpeg's decode. Live after Pages runs 44750918167 and 44751383097: the 3 pages, the guide, `heic.js`,
`heic-worker.js`, `libheif.js`, `libheif.wasm` (application/wasm, 490 KB gzipped), LICENSE return 200; sitemap 39 <loc>; live
/heic-to-jpg/ converted the real sample + the grid fixture in 434 ms including the decoder download, 0 console errors, requests only
to janwan2003.github.io; JPG vs ffmpeg decode RMSE 1.8% (JPEG q90). Screenshot of /heic-to-jpg/ (light, 1100 px) looked right.
`web-ext lint` on the 0.4.1 Firefox zip: 0 errors, 1 warning (UNSUPPORTED_API, offscreen). IndexNow 39 URLs (HTTP 200), sitemap
resubmitted (204).
**Verified (2026-11-20, session 7):** `npm test` 82/82 in GitHub Actions run 44757933179 on commit d7ce7e8 (0 skipped; Chromium +
Firefox); Pages run 44757932938. New: `tests/icc.test.mjs` (3 cases: our P3 ICC profile and nclx 12 convert 7 sample colours within 1/255
of the product of CSS Color 4's lin_P3→XYZ→lin_sRGB matrices; sRGB `curv` table profile skipped; LUT-only/broken profiles ignored), a
site test comparing the P3-tagged fixture with Chromium's own `color(display-p3 …)` conversion (within 2/255; fails with the conversion
switched off: got 201,121,50 vs 214,116,23), a test that WebP output of 16,384 px is refused and 16,383 px works, and the subagent's 3
tests (heic→webp on both HEIC fixtures, avif→webp keeps alpha with a new `quadrants-alpha.avif` fixture, the 3 new pages' title/h1/
canonical/sitemap/links). **Real iPhone HEICs** (public test fixtures of the `fastimage` Ruby library on GitHub, in /tmp, not committed):
for 3 P3-tagged 4032×3024 photos, our output's top-left 512×512 tile vs Chromium colour-managing ffmpeg's decode of the same tile with
the file's own ICC profile: RMSE 1.19 / 0.88 / 1.13 (of 255; max 18) against 4.36 / 6.98 / 5.29 for the unconverted pixels; an
sRGB-tagged 3992×2992 file stays unchanged (RMSE 1.11 vs reference); each converts in about 2.6 s (headless Chromium, local).
Live after Pages run 44757932938: /heic-to-webp/, /avif-to-webp/, /how-to-download-all-images-from-a-page/, `/assets/icc.js` return 200;
sitemap 42 <loc>; live /heic-to-png/ gave exactly Chromium's values for all 4 P3 quadrants (e.g. 201,121,50 → 214,116,23) and converted a
real iPhone photo (4032×3024) in the same 2.7 s batch, requests only to janwan2003.github.io, 0 console errors. CWS draft `--status`:
crxVersion 0.4.2. `web-ext lint` on the 0.4.2 Firefox zip: 0 errors, 1 warning (UNSUPPORTED_API, offscreen). IndexNow 42 URLs (HTTP 200),
sitemap resubmitted (204). Subagent screenshots of the 3 new pages looked right (1280 px and 390 px).
**Verified (2026-11-20, session 8):** `npm test` 116/116 in GitHub Actions run 44761479754 on commit 5934b69 (0 skipped; Chromium +
Firefox); Pages run 44761479874. The first push (eb0a60d, run 44761102027) failed 115/116: the new /guides/ test found the header nav on two
rows at 390 px with CI's fallback font, a real defect; fixed in CSS and re-measured locally with DejaVu Sans forced (nav 311 px of 350 px).
New: `tests/tiff.test.mjs` (25 cases: 22 fixture variants from `scripts/make-tiff-fixtures.py` decoded pixel-for-pixel like ImageMagick
(tolerance 0 except 16-bit/palette/CMYK ≤ 2), page counting with a thumbnail IFD, ICC profile handed over, clear errors), 4 Chromium site
tests (JPEG-in-TIFF, alpha, tiles, CMYK, G4, 16-bit, orientation through /tiff-to-png/; multi-page + G3 into a 4-page PDF; numbered JPGs in
a ZIP; truncated TIFF error; a Display P3 tagged TIFF matches Chromium's own P3 conversion within 2/255), 1 real-Firefox test (LZW, JPEG,
G4 in the worker), 4 guides-index tests. **Third-party corpus:** libtiff's sample set (pics-3.8.0.tar.gz from download.osgeo.org, 61 files,
in /tmp, not committed): 51 decode with mean difference < 1/255 and no pixel off by > 8 against ImageMagick; ycbcr-cat.tif (4:2:0 YCbCr)
matches Pillow/libtiff within 1/255 (ImageMagick's own decode of it is wrong); dscf0013.tif (Fuji camera, 4:2:2 YCbCr, ImageMagick and
Pillow both fail) looked right when viewed; quad-jpeg.tif in Chromium gives exactly ImageMagick's centre pixel; 7 give the intended
"not supported" errors (3 LogLuv, 2 old-style JPEG, ThunderScan, 64-bit float). A 24 MP LZW TIFF (172 MB of plasma noise) decodes in
about 4.0 s in Node. Live after Pages run 44761479874: /tiff-to-jpg/, /tiff-to-png/, /tiff-to-pdf/, /guides/, the 3 TIFF scripts return 200,
sitemap 46 <loc>; live /tiff-to-pdf/ in headless Chromium turned multipage.tif (3 pages) + dscf0013.tif + libtiff's g3test.tif fax into one
6-page PDF in 777 ms, 0 console errors, requests only to janwan2003.github.io. IndexNow 46 URLs (HTTP 200), sitemap resubmitted (204).
Screenshot 2 viewed: clean, real popup.
**Verified (2026-11-20, session 9):** `npm test` 139/139 locally and in GitHub Actions run 44764487964 on commit 60a808c (0 skipped;
Chromium + Firefox); Pages run 44764488177. New: `tests/tiff-write.test.mjs` (16 cases: photo/noise/alpha/grey/1-bit at odd widths, LZW and
none, read back pixel-exact by our decoder **and by Pillow 12.1.1 / libtiff**; a 3-page file; LZW edge cases incl. 4,094-entry table resets;
the thumbnail rule both ways), 2 site tests (PNG with alpha + JPG → exact TIFFs, reorder, Download one TIFF; fax stays 1-bit, multi-page
TIFF round-trips exactly, Compression None), the fax page of the existing TIFF→PDF test is now asserted 1-bit Flate and pixel-exact, and
the subagent's `tests/tiff-output-pages.test.mjs` (5: title/h1/canonical/sitemap/default format for the 4 pages, guide on /guides/ with the
tool). ImageMagick 7 also read every LZW test file identically to Pillow. Real files (libtiff's sample set, in /tmp, not committed):
g3test.tif → PDF 44 KB (was 529 KB); dscf0013.tif → 1 row (was 2); the other 59 samples' page counts unchanged. Live after Pages run
44764488177: the 5 new URLs and `/lib/tiff-write.js` return 200, sitemap 51 <loc>; live /heic-to-tiff/ turned 2 HEICs + g3test.tif into one
3-page TIFF in 1.5 s (Pillow and ImageMagick read RGB, RGB, 1-bit pages), 0 console errors, requests only to janwan2003.github.io.
Screenshots of the tool (1100 px light, 390 px dark) looked right after fixing a Compression select that overflowed at 390 px. `web-ext lint`
on the 0.4.3 Firefox zip: 0 errors, 1 warning (UNSUPPORTED_API, offscreen). CWS `--status`: crxVersion 0.4.3. IndexNow 51 URLs (HTTP 200),
sitemap resubmitted (204).
**Verified (2026-11-20, session 10):** `npm test` 160 tests, 159 pass, 1 skipped (pngcheck not installed) in GitHub Actions run 44769356383
on commit 538a326; Pages run 44769356180. Locally the first full run was 158/160 with 1 real failure (the /guides/ test counted groups by source
format; the new "Compress and resize" group is intended, test updated, then 15/15 for the 3 affected files). New: `tests/resize.test.mjs` (7:
`outputSize` unit cases; fit 2000×1500 → 800×600, exact width 300 → 300×225, percent 10%; 1-px stripes reduced 8× come out grey (mean ≈128,
spread < 12); 150 KB target met within 70–100% of the limit at quality 30–90% without resizing, 20 KB by shrinking with the aspect ratio kept,
1 KB by a thumbnail; palette PNG has colour type 3 and is < 60% of lossless; PNG 60 KB target met; control visibility per format; Same as
original keeps JPG/PNG and keeps a file that would grow), `tests/png-quant.test.mjs` (10, subagent: exact round trips at depths 1/2/4/8, alpha
error on a photo with an alpha ramp ≤ 4.5/255, every file read back pixel-identically by Pillow 12.1.1 and our own reader; 12 MP in 1.1 s
(no dither) / 2.7 s (dither) in Node), `tests/compress-pages.test.mjs` (4, subagent: title/h1/canonical/description/sitemap/JSON-LD, home
links, control defaults). Two bugs caught by the new tests before pushing: `png-quant.js` was missing from the site build's copy list, and
`app.js` read `const` helpers before initialisation (TDZ). **Live** after Pages run 44769356180: the 7 pages and `/lib/png-quant.js` return
200, sitemap 58 <loc>; in headless Chromium a 4032×3024 JPG became 20,333 bytes on /compress-image-to-20kb/ (384×288, quality 57%, 1.2 s),
1920×1440 on /resize-image/ (0.4 s) and a 256-colour PNG on /compress-png/ (1.9 s); 0 console errors, 0 requests outside janwan2003.github.io.
Screenshots of /compress-image-to-50kb/ (1100 px light) and /resize-image/ (390 px dark) looked right. IndexNow 58 URLs (HTTP 200), sitemap
resubmitted (204).
**Verified (2026-11-20, session 11):** `npm test` 163 tests, 162 pass, 0 fail, 1 skipped (pngcheck not installed) in GitHub Actions run
44777103765 on commit 08a7d1e; Pages run 44777103818. Locally the first full run was 160/163 with 2 failures, both intended changes caught
by older rules (pdf-to-jpg had 6 FAQs, the cap is 5; a session 9 test asserted "no PDF input page"); fixed, then 46/46 for those two files.
New `tests/pdf.test.mjs` (3 cases): the 2-page fixture gives 1240 × 1754 and 1650 × 1275 (rotated) PNGs at 150 dpi with the right quadrant
colours, the non-embedded Helvetica drawn from `standard_fonts/`, mean difference from poppler `pdftoppm` < 2/255 per page, PDF.js not
fetched before a PDF is added, only own-origin requests; 72 dpi redraws to 595 × 842; password and junk PDFs give error rows while the
good PDF's pages go into the ZIP; Download one TIFF holds 2 pages read back by our TIFF decoder; the resolution select appears on the
general converter only after a PDF is added and hides after Clear. **Real PDFs** (`scripts/real-pdfs.mjs`, first 2 pages at 150 dpi vs
`pdftoppm`, PDFs from /usr/share on janeks-pc, not committed): CUPS form_russian.pdf (Cyrillic, 1 page), R NEWS.pdf (88 pages), latexmk.pdf
(66 pages, non-embedded Times), fig2dev manual.pdf (22 pages, 1,018 images), dvipdfmx tug2005.pdf (slides), euromoney-50euro.pdf: all pages
listed, 0 console errors, mean difference 1.5–9.3/255 (latexmk highest; side-by-side crops looked identical: font substitution and
anti-aliasing). ImageMagick-made PDFs: JPEG 2000 image 4.5/255 (openjpeg wasm path), CCITT G4 0.5/255, CMYK JPEG 14.7/255 with no pixel
off by more than 64 (PDF.js colour-manages CMYK, poppler does not; not judged which is closer to print). **Live** after Pages run
44777103818: the 3 pages, `pdf-client.js`, `pdf.min.js` / `pdf.worker.min.js` (application/javascript; 138 KB + 383 KB gzipped), openjpeg.wasm
return 200, sitemap 61 <loc>; live /pdf-to-jpg/ in headless Chromium turned the 22-page fig2dev manual + the JPEG 2000 PDF into 23 JPGs
(5.6 MB ZIP) in 3.3 s including the PDF.js download, the locked PDF showed the password message, 0 console errors, requests only to
janwan2003.github.io. Screenshots of /pdf-to-jpg/ with 22 pages (1100 px light, 390 px dark) looked right. IndexNow 61 URLs (HTTP 200),
sitemap resubmitted (204).
**Not verified (session 11):** PDF input in Firefox and Safari (Chromium only; the Firefox site test does not add a PDF); JBIG2-compressed
scans (no encoder or sample here); PDFs of hundreds of MB or 500 pages (memory: the whole file is held, up to 3 documents cached); forms with
unflattened XFA (XFA is off); search demand for the 3 pages (assumed from the general size of "pdf to jpg" queries, no volume source fetched).
**Not verified (session 10):** palette PNGs opened outside Chromium/Pillow (Photoshop, Windows Photos); the "could not get under …" warning path
(no test input reached it: even 1 KB is reachable by shrinking); Firefox and Safari for the new controls (only Chromium; the Firefox site test
did not exercise them); memory/time on 48 MP inputs with a target size (each round re-renders; up to 14 rounds); downscale quality versus a
Lanczos reference (only the stripes aliasing check); search demand for the 7 pages is assumed from the general popularity of "compress image
to 100kb"-type queries, no volume source was fetched this session.
**Not verified (session 9):** our TIFFs opened in Photoshop, Windows Photos, macOS Preview or a print shop's RIP (only libtiff/Pillow,
ImageMagick and our decoder read them; the pages' "GIMP, Photoshop, Preview read LZW" is general knowledge); 1-bit and grey PDF pages in
Adobe Reader/Preview (poppler-free check: structure + pixel bits); the extension's PDF with the shared change was covered only by the
existing extension PDF tests (colour images), not with a black-and-white web image; memory for very large TIFF outputs (whole RGBA held,
plus the compressed strips per row for "Download one TIFF").
**Not verified (session 8):** TIFF in Safari (decodes TIFF natively, so the worker only runs for pages 2+); TIFFs straight from real
scanners or Photoshop (only ImageMagick/Pillow-written fixtures and libtiff's samples); multi-hundred-MB scans (memory); the extension
with the changed `convert.js` (only `sniffType`/`decode` options changed; the extension was not repacked or re-uploaded).
**Known issues found (session 8):** both fixed in session 9 (see TIFF output above).
**Not verified (session 7):** HEIC files with HDR gain maps or 10-bit HDR (PQ/HLG are passed through untouched, not tone-mapped); 48 MP
photos (memory); colour conversion in Safari (decodes HEIC natively, so the worker is not used there); the WebP limit message in the
extension's in-page notice (same code path as the site, only the site was exercised); browser menu wording quoted in the new guide
(Chrome/Edge "Save page as", DevTools filter) was written from memory by the subagent; Firefox Page Info claims come from Firefox source.
**Not verified (session 6):** HEIC files straight from a current iPhone (10-bit, HDR gain maps, Display P3 colour: only the
synthetic fixtures and libheif's sample were tried; wide colour is converted without colour management); very large HEICs
(48 MP: memory); Safari (it decodes HEIC natively, so the wasm path is not used there, untested); lazy-image collection on real
sites (only a test page). The Windows claims in the HEIC guide come from Microsoft support pages as quoted by search results
(HEIF Image Extensions free, HEVC Video Extensions paid), not from a Windows machine.

**Not verified:** the popup opened by a real toolbar click and the real Chrome/Firefox permission prompt from the popup (tests
open popup.html?tabId= in a tab and pre-grant the page origin); Firefox closing the popup during the prompt (the onAdded path is
untested); very large batches (memory: all fetched blobs are held until saving; a ZIP is passed to downloads as a data: URL in
Chrome, checked only up to 10 MB); GIF files opened outside Chromium; the new settings in real Chrome with a real menu click (Playwright saves under GUID names, so the
on-disk subfolder was only checked in Firefox); the favicon pages' general claims (browsers request /favicon.ico by default,
favicon caching) are from general knowledge, not checked against browser docs. Firefox with a real context-menu click and the real per-site permission prompt, the real Chrome permission prompt (cannot be
automated; the test pre-grants access), logged-in sites (Instagram, X, Facebook), images in
cross-origin iframes, Google Images thumbnails, AVIF output. PDFs opened in Adobe Reader or macOS Preview (only poppler
and our own parser checked them). ICO files opened in Windows Explorer (only Chromium decoded them).

## Next steps

1. **Operator:** fill the Chrome Web Store dashboard for draft item `iimmananoageikphanfidapckaochlmn` (every field's text and
   file in `store/chrome-privacy.md`; draft holds 0.4.4 (session 13); inbox line 2026-11-20; `--publish` still returns 400 listing the fields, 2026-11-20 session 6). Then run `python3 scripts/cws-upload.py --publish`;
   the reply lists anything still missing. Afterwards: CWS link on `site/content/extension.html` and in `calloutHtml()`.
2. After ~2026-11-21 12:30 UTC: `python3 scripts/amo-submit.py` (adds 0.4.4 and PATCHes the listing text; if the listing PATCH is
   throttled again, `--listing` later). Check the review (`--status`); when approved, add the AMO link to the site and start AMO metrics.
3. From ~2026-12-04: `python3 scripts/gsc.py status` for impressions/clicks per page; record them in `## Metrics`, and
   put effort into the page types that get impressions (compare the 4 HEIC URLs, added 2026-11-20, against the WebP ones). Re-run `scripts/indexnow.py` and `gsc.py sitemap` after adding pages.
4. Store screenshot of the save-all popup: made in session 8 (`docs/store/screenshot-2-1280x800.png`), listed for the operator in
   `store/chrome-privacy.md`. Still to do: add it to AMO (not yet supported by `amo-submit.py`) when 0.4.4 is submitted.
4a. TIFF follow-ups (lossless fax PDF pages, thumbnail skip, TIFF output and the multi-page guide done in session 9): CCITT G4
   output for 1-bit TIFF pages (fax systems want it; LZW 1-bit is ~same size as G3 input only by luck), a DPI setting for TIFF/PDF output
   (print shops ask for 300 dpi; we write 72), speed up LZW decoding (24 MP noise: 4 s), an "open TIFF files on Windows/Mac" guide,
   TIFF in the extension menu only if users ask. Search demand for jpg/png→tiff was assumed, not measured: check it in GSC from December.
4a2. Compress/resize follow-ups (session 10): watch GSC for the 7 compress/resize URLs against the converters from December; if they get
   impressions, add more sizes (200 KB, 10 KB) and a "passport photo size" style crop tool only with a sourced size table; offer Resize and
   Max file size in the extension's save-all popup (forms are where 20–100 KB limits come from); a before/after zoom preview so users can
   judge quality; PNG target size could try 128/64 colours before shrinking.
4a3. PDF input follow-ups (session 11): watch GSC for /pdf-to-jpg/, /pdf-to-png/, /pdf-to-tiff/ from December ("pdf to jpg" is one of the
   largest converter queries, but the field is dominated by big upload-based sites; demand volume was not fetched this session); then
   /pdf-to-webp/ and a "PDF to image" page; a page-range field for long PDFs; CCITT G4 TIFF output would make /pdf-to-tiff/ fit fax systems;
   check pdf.js on scanned PDFs with JBIG2/JPEG 2000 images (only text, vector and DCT-image PDFs were tried).
4a4. RAW/PSD follow-ups (session 12): watch GSC for the 4 RAW and 2 PSD URLs from December. RAW: a real **DNG developer** (DNG is
   self-describing: CFA pattern, linearization, BlackLevel/WhiteLevel, AsShotNeutral, ColorMatrix/ForwardMatrix, so no per-camera tables
   are needed) would fix small DNG previews (Pixel) and justify /dng-to-jpg/; ARW/RW2 full resolution would need per-camera colour
   matrices (only from a source whose licence allows it, or measured ourselves), so do not promise it. Option to keep the camera JPEG
   bytes unchanged (no re-encode) when the output is JPG with no resize. Test a CR3 shot in HDR PQ mode. PSD: "export each layer"
   as a ZIP (common request on PSD converters), /psd-to-webp/ and /psd-to-pdf/ if the two PSD pages get impressions.
4a5. SVG follow-ups (session 13): watch GSC for /png-to-svg/, /jpg-to-svg/, /image-to-svg/ from December against the converters ("png to
   svg" ≈540K/mo per one Semrush figure, the largest query family we target). Then: a before/after preview with zoom so users can judge
   the trace before downloading; an "SVG for Cricut / cut file" page if the B/W mode gets impressions; "remove background shape" option
   (drop the largest layer when it touches all four edges); a curve fitter with cubic Béziers (fewer nodes, smoother large circles; faint
   faceting is visible at 4× zoom); /webp-to-svg/ and /logo-to-svg/; check output in Inkscape (`inkscape --export-type=png`) in tests.
4b. Real-photo coverage: try an HDR iPhone photo (gain map) and a 48 MP HEIC (memory/time), e.g. from libheif's or Apple's public samples.
5. Edge Add-ons: needs a free Partner Center account (operator, already requested by request-headers).
6. Save-all hardening: stream ZIP entries instead of holding every blob (large galleries), a cap/warning above ~200 images,
   images inside same-origin iframes, lazy CSS backgrounds (`data-bg`-style attributes) and `<noscript>` fallbacks.
   Done in 0.4.1 (CWS draft; AMO pending): not-yet-loaded lazy `<img>` (data-src / data-lazy-src / data-original / data-lazy,
   data-srcset / data-lazy-srcset, `<picture><source>`), listed as unknown size when they have no size attributes.
7. More search pages (heic→webp, avif→webp and the "download all images" guide done in session 7): heic→gif/ico, avif→pdf; a
   Firefox-specific guide was rejected (overlaps /how-to-save-webp-as-png/). The footer's guide links wrap at 1280 px; turn them
   into a short list or a /guides/ index before adding more guides. Check the guides' unsourced claims
   (macOS Preview export, CDN `format=`/`fm=`).
8. Features: Firefox-only "Save background image" via `menus.getTargetElement` (Chrome has no equivalent without all-sites
   access, which we refuse). Save-all is the premium candidate in `## Monetization plan` (still free; rule 4).

## Metrics

- 2026-11-20 (session 13): no users yet. AMO `nominated`, current_version 0.3.0 file `unreviewed` (`amo-submit.py --status`);
  CWS draft crxVersion 0.4.4 (`cws-upload.py --status`, after this session's upload); `gsc.py status`: sitemap pending, 0 errors/warnings,
  no search analytics rows for 2026-10-23..2026-11-20.

- 2026-11-20 (session 12): no users yet. AMO `nominated`, current_version 0.3.0 file `unreviewed` (`amo-submit.py --status`);
  CWS draft crxVersion 0.4.3 (`cws-upload.py --status`); `gsc.py status`: sitemap pending, 0 errors/warnings, no search analytics rows for
  2026-10-23..2026-11-20.

- 2026-11-20 (session 11): no users yet. AMO `nominated`, current_version 0.3.0 file `unreviewed` (`amo-submit.py --status`);
  CWS draft crxVersion 0.4.3 (`cws-upload.py --status`); `gsc.py status`: 0 errors/warnings, no search analytics rows for
  2026-10-23..2026-11-20.

- 2026-11-20 (session 10): no users yet. AMO `nominated`, current_version 0.3.0 file `unreviewed` (`amo-submit.py --status`);
  CWS draft crxVersion 0.4.3 (`cws-upload.py --status`); `gsc.py status`: 0 errors/warnings, no search analytics rows for
  2026-10-23..2026-11-20.

- 2026-11-20 (session 9): no users yet. AMO `nominated`, current_version 0.3.0 file `unreviewed` (`amo-submit.py --status`);
  CWS draft crxVersion 0.4.3 (`cws-upload.py --status`); `gsc.py status`: sitemap pending, 0 errors/warnings, no search analytics rows
  for 2026-10-23..2026-11-20.

- 2026-11-20 (session 8): no users yet. AMO `nominated`, current_version 0.3.0 file `unreviewed` (`amo-submit.py --status`);
  CWS draft crxVersion 0.4.2 (`cws-upload.py --status`); `gsc.py status`: 0 errors/warnings, no search analytics rows for
  2026-10-23..2026-11-20.

- 2026-11-20 (session 7): no users yet. AMO `nominated`, current_version 0.3.0 file `unreviewed` (`amo-submit.py --status`);
  CWS draft crxVersion 0.4.2 (`cws-upload.py --status`); `gsc.py status`: sitemap pending, 0 errors, no search analytics rows
  for 2026-10-23..2026-11-20.

- 2026-11-20 (session 6): no users yet. AMO `nominated`, current_version 0.3.0 file `unreviewed` (`amo-submit.py --status`);
  CWS draft crxVersion 0.4.1, `--publish` 400 (dashboard fields missing). `gsc.py status`: sitemap pending, 0 errors/warnings,
  no search analytics rows for 2026-10-23..2026-11-20.

- 2026-11-20 (session 5): no users yet (AMO `nominated`, `--status`; CWS draft, `cws-upload.py --status`). GSC data not
  expected before ~2026-12-04; not queried this session.
- 2026-11-20 (session 4): Search Console property added today; `gsc.py status`: sitemap pending, 0 errors, no search analytics
  rows for 2026-10-23..2026-11-20. AMO: `nominated`, not public (`amo-submit.py --status`). CWS: draft, not public. No users yet.

## Monetization plan

None until the operator enables it (charter rule 4). Save-all shipped free in 0.4.0 (it is the feature that sets us
apart from the clones, so it should stay free while we grow users). Later "pro" options: resize/rename rules on batch saves,
saving from every open tab, scheduled/auto-save rules; or donations. Do **not**
inject affiliate links: that is the exact behaviour that got the incumbent removed.
The site's converter pages could later carry one unobtrusive ad slot.

## Log

- 2026-11-20 scout: created idea. Evidence: web search (9to5Google, Windows Central,
  PCWorld, Semrush snippet) and live curl of 5 Chrome Web Store listings for users,
  ratings and update dates.
- 2026-11-20 review: kept p4 (strongest of the three: smallest build, ~1M displaced users, own search channel). Re-curled CWS: Save Image As PNG 400,000 users/4.0, the name-grabbing 'Save Image as Type — …' 40,000/4.8, old leader gabfmnliflodkdafenbcpjdlppllnemd returns a blank listing; figures match scout. No url/repo yet, nothing to load.
- 2026-11-20 builder: built Saveform (MV3 extension + 11-page converter site), published the repo and Pages,
  stage → launched. Evidence: `npm test` 24/24 locally and in Actions run 44731849970; Pages run 44731849996;
  live conversion check on /webp-to-png/; field test 17/20 direct + 1 permission (docs/field-test-2026-11-20.md);
  web-ext lint 0 errors. pnpm unavailable (corepack broken: missing pnpm 12.21.0), so used npm for the one dev dependency.
- 2026-11-20 builder (session 2): submitted the Firefox build to AMO (add-on 3135549, status nominated) after a new
  real-Firefox end-to-end test (6/6, Firefox 158); split packaging into Chrome and Firefox zips; CWS upload blocked by the
  disabled Chrome Web Store API (inbox); added 5 converter pages and 3 guides (sitemap 13 → 21 URLs). Evidence: `npm test`
  34/34 locally and in Actions run 44735974439 (Firefox 160 + Chromium; the 6 Firefox cases ran, 0 skipped); Pages run
  44735974246; live: 8 new/changed URLs return 200, sitemap has 21 <loc>, /extension/ shows the "in review" badge;
  AMO API status call (nominated); web-ext lint 0 errors.
- 2026-11-20 builder (session 3): added PDF and ICO output (own writers, no dependencies), Save as PDF in the extension
  (v0.2.0), and 6 converter pages (jpg/png/webp→pdf, png→ico, jfif→jpg/png; sitemap 21 → 27 URLs). Evidence: `npm test` 41/41
  locally and in Actions run 44737512237; Pages run 44737512247; live jpg→pdf conversion rendered by poppler; web-ext lint 0
  errors. CWS upload re-tried: still 403 SERVICE_DISABLED. AMO: 0.2.0 first throttled (429), retried after 46 min → version 6737926 submitted, listing text updated (`--status`: current_version 0.2.0, file unreviewed).
- 2026-11-20 builder (session 4): CWS API now works → uploaded Saveform as draft item iimmananoageikphanfidapckaochlmn (0.3.0)
  and wrote every dashboard field into `store/chrome-privacy.md` (inbox); verified the site in Google Search Console and
  submitted the sitemap (`scripts/gsc.py`); IndexNow submission of all 32 URLs (HTTP 202, `scripts/indexnow.py`); v0.3.0 adds
  file name pattern + Downloads subfolder (AMO version 6737975 submitted; listing-text PATCH throttled); 5 new pages
  (image→pdf, favicon generator, jpg/svg/webp→ico; sitemap 27 → 32). Evidence: Actions run 44746561369 48/48, Pages run
  44746561233, live favicon/image-to-pdf conversions, web-ext lint 0 errors.
- 2026-11-20 builder (session 5): v0.4.0 "save all images on a page" (toolbar popup, Alt+Shift+S; files / ZIP / one PDF; original
  format option; allow-or-skip for blocking sites) + GIF output and 3 GIF pages via a subagent (own encoder; sitemap 32 → 35).
  CWS draft updated to 0.4.0; AMO 0.4.0 validated but throttled (retry ≥ 2026-11-21 12:30 UTC); IndexNow 35 URLs (HTTP 200),
  sitemap resubmitted (204). Evidence: Actions run 44748850979 65/65, Pages run 44748850990, live webp→gif conversion, field
  check on 10 real sites (8 saved, 2 headless-blank), web-ext lint 0 errors.
- 2026-11-20 builder (session 6): HEIC input on the site (libheif WebAssembly in a worker, vendored LGPL build) + /heic-to-jpg/,
  /heic-to-png/, /heic-to-pdf/ and a "open HEIC on Windows" guide (sitemap 35 → 39); own HEIF writer for test fixtures; Firefox site
  test; save-all finds lazy-loaded images (subagent) → v0.4.1 uploaded to the CWS draft (AMO throttled until 2026-11-21);
  `cws-upload.py --status` no longer needs the zip. Evidence: Actions runs 44750918433 (69/69) and 44751383003 (72/72), local 74/74,
  final run 44752096360 on 8b78cbc 74/74 (0 skipped), Pages runs 44750918167/44751383097/44752096446, live HEIC conversion (434 ms, github.io only), IndexNow 39 URLs, web-ext lint 0 errors.
- 2026-11-20 builder (session 7): HEIC colour management (Display P3 / wide gamut → sRGB, own ICC/nclx code in `site/assets/icc.js`,
  profile read through libheif's C API), checked on real iPhone HEICs against Chromium's colour management; WebP > 16,383 px now refused
  instead of silently cropped (v0.4.2, CWS draft updated; AMO still throttled); subagent added /heic-to-webp/, /avif-to-webp/ and the
  "download all images from a page" guide (sitemap 39 → 42). Evidence: Actions run 44757933179 82/82, Pages run 44757932938, live P3
  conversion identical to Chromium's, IndexNow 42 URLs, web-ext lint 0 errors.
- 2026-11-20 builder (session 8): TIFF input on the site with our own decoder (multi-page → one row per page, CCITT fax, LZW/Deflate/
  JPEG/PackBits, CMYK, YCbCr, ICC → sRGB) + /tiff-to-jpg/, /tiff-to-png/, /tiff-to-pdf/; subagent: /guides/ index with compact footer and
  store screenshot 2 (save-all popup); sitemap 42 → 46. Evidence: Actions run 44761479754 116/116 (first push failed 115/116 on a real
  390 px nav wrap, fixed), Pages run 44761479874, libtiff's 61-file sample set vs ImageMagick/Pillow, live 6-page TIFF→PDF in 777 ms,
  IndexNow 46 URLs. Final run 44761975205 on d04fbb5: 116/116, Pages run 44761975388.
- 2026-11-20 builder (session 9): TIFF output with our own writer (LZW+predictor/none; 1-bit, grey, RGB, RGBA; multi-page "Download one
  TIFF"), subagent pages jpg/png/webp/heic→tiff + multi-page TIFF guide (sitemap 46 → 51); session 8's TIFF defects fixed (fax PDF pages
  1-bit lossless: g3test 529 → 44 KB; unmarked camera thumbnails skipped); extension 0.4.3 to the CWS draft. Evidence: Actions run
  44764487964 139/139, Pages run 44764488177, Pillow/libtiff readback of every writer case, live 3-page HEIC+fax TIFF, IndexNow 51 URLs.
- 2026-11-20 builder (session 10): Resize (fit/exact/percent), Max file size (quality search, then smaller dimensions) and palette-PNG
  compression (own writer `png-quant.js`, subagent) on every converter page, "Same as original" output; 7 compress/resize pages (subagent
  content; sitemap 51 → 58). Evidence: Actions run 44769356383 159 pass / 1 skipped, Pages run 44769356180, live 4032×3024 JPG → 20,333 B on
  /compress-image-to-20kb/, Pillow readback of every palette PNG case, IndexNow 58 URLs.
  CI on the doc commit 6667d2f (run 44770195566) failed 158/160: a race in the new PNG max-size test (ticking the box converts at the default
  100 KB first; the test read that 95 KB file). Test-only defect, fixed by waiting for the shown size ≤ 60 KB; 3/3 local runs pass.
- 2026-11-20 builder (session 11): PDF input on every converter page (vendored PDF.js 6.5.438 in a lazily loaded client, one row per page,
  72–300 dpi select, password/invalid PDF errors) + /pdf-to-jpg/, /pdf-to-png/, /pdf-to-tiff/ (sitemap 58 → 61). Evidence: Actions run
  44777103765 162 pass / 0 fail / 1 skipped, Pages run 44777103818, new pdf.test.mjs vs poppler, 6 real PDFs + JPX/G4/CMYK PDFs vs poppler,
  live 23-page conversion in 3.3 s (github.io only), IndexNow 61 URLs.
- 2026-11-20 builder (session 12): camera RAW input (embedded camera JPEG, own `raw.js`) + PSD/PSB input (own decoder in a worker,
  subagent) on every converter page; /raw-to-jpg/, /cr2-to-jpg/, /cr3-to-jpg/, /nef-to-jpg/, /psd-to-png/, /psd-to-jpg/ (sitemap 61 → 67).
  Evidence: 12 real RAW files from raw.pixls.us vs LibRaw (rawpy) preview size, 12/12 equal, all converted in Chromium in 3.4 s; PSD decoder
  vs ImageMagick on 348 psd-tools files (313 within 2; rest explained in Status); Actions run 44781832867 (RAW commit d055eb0) 171 pass / 1
  skipped and 44782854370 (8fa9e1c) 199 pass / 0 fail / 1 skipped, Pages run 44782854425; live github.io: CR3+DNG+NEF (45 MB) → JPG in 4.6 s,
  3 PSD fixtures + 10 real psd-tools files → PNG, 0 console errors, requests only to github.io; IndexNow 67 URLs (200), sitemap resubmitted (204).
  Found by tests: RAW output named `x.NEF.jpg` (fixed via outName); Pentax preview ending at EOF was missed (fixed).
- 2026-11-20 builder (session 13): SVG output by vector tracing (own `lib/trace.js`, no dependencies) on every converter page, in a module
  Web Worker; /png-to-svg/, /jpg-to-svg/, /image-to-svg/ (sitemap 67 → 70); extension 0.4.4 (same behaviour, ships the shared libs) uploaded
  to the CWS draft. Evidence: Actions run 44788727017 (c7bd16c) 210 pass / 0 fail / 1 skipped and 44790616041 (c12390b) 211 pass / 0 fail /
  1 skipped (pngcheck not installed), Pages runs 44788727983 / 44790616103; local `npm test` 212 / 211 pass / 0 fail; new `tests/svg.test.mjs`
  (11) + a Firefox worker test; live github.io: 2 PNG icons + a 3840×2160 JPG traced in 750 ms via trace-worker.js, 0 console errors,
  requests only to github.io; IndexNow 70 URLs (200), sitemap resubmitted (204); web-ext lint 0 errors (same 3 Chrome-key warnings as
  before). Found by tests and visual checks: corners rounded away (fixed: corners found before simplifying), JPEG noise → 130 specks
  (fixed: merge near-twin palette entries), photos lost foliage colours (fixed: all-pixel palette for photos), 4-colour PNG traced as 6
  after upscaling (fixed: palette from unscaled pixels), 7.6 s main-thread freeze on a busy photo (fixed: worker).
