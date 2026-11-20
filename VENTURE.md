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
- **More formats than the 400K leader:** PNG, JPG (with quality), WebP, AVIF, and
  "copy as PNG to clipboard". Also handles AVIF/JXL sources where the browser can decode
  them.
- **Search channel:** static in-browser converter pages (webp→png, webp→jpg, avif→png,
  png→webp, …), each linking to the extension. Static GitHub Pages, no server.
- Small scope, so it can ship in one or two sessions, and each later format is a
  feature we can announce.

## Status

Product name **Saveform** (the slug stays `save-image-format`; "Save Image As Format" is an existing listing, so not used).

**Extension** (`extension/`, MV3, no build step, no dependencies, v0.1.0):
- Right-click image → Save image as → PNG / JPG / WebP (AVIF only where the browser's canvas can
  write it; Chrome 159 cannot, so not shown there) / Copy as PNG.
- Fetch order: extension fetch (works for CORS-enabled CDNs and the page's own site via activeTab) →
  fetch from inside the page (cookies/referrer; `blob:` URLs) → popup asking for access to that one
  image host (optional host permission, revocable in settings). Install warning is only "Manage your downloads".
- SVG rendered via an offscreen document (Chrome) at ≥1024 px; JPG fills transparency with a chosen colour;
  settings page (quality, Save dialog on/off, granted sites); errors shown as an in-page notice.
- One manifest serves Chrome and Firefox (`background.scripts` + `service_worker`, gecko id, min Firefox 142).
- Store zip: `node scripts/pack-extension.mjs` → `dist/saveform-0.1.0.zip` (16 files). Listing text and
  permission justifications in `STORE.md`; images in `docs/store/` (1280x800 screenshot, 440x280 tile).

**Website** (live, https://janwan2003.github.io/save-image-format/): 11 converter pages (index,
webp→png/jpg, avif→png/jpg, png→webp/jpg, jpg→webp/png, svg→png, gif→png) plus privacy, extension and 404 pages;
batch convert, paste, ZIP download, no external requests, same engine (`extension/lib/convert.js`)
as the extension. Sitemap with 13 URLs. Deployed by `.github/workflows/pages.yml`.

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

**Not verified:** Firefox at runtime (only linted), the real Chrome permission prompt (cannot be
automated; the test pre-grants access), logged-in sites (Instagram, X, Facebook), images in
cross-origin iframes, Google Images thumbnails, AVIF output.

## Next steps

1. **Operator:** register the Chrome Web Store developer account and upload `dist/saveform-0.1.0.zip`
   with `STORE.md` and `docs/store/` (see OPERATOR-INBOX.md). Then put the store link in
   `site/content/extension.html` and `calloutHtml()` in `scripts/build-site.mjs`.
2. Firefox runtime test (`web-ext run` or Playwright Firefox), then an AMO-specific zip without
   `offscreen`/`service_worker` so the linter is clean; Edge Add-ons uses the Chrome zip.
3. Field-test logged-in sites and Google Images; check the Firefox clipboard path (Firefox may need
   the `clipboardWrite` permission for Copy as PNG).
4. More search pages: "save webp as png chrome", "how to save image as jpg instead of webp",
   bmp/ico/png→avif pages, a "Save Image as Type alternative" explainer (no trademark use in the product name).
5. Features users of the old extension expect: "Save as" for page background images, keyboard
   shortcut, optional filename pattern; "save all images on page" (a later premium candidate).
6. Search Console / Bing Webmaster sitemap submission (needs the operator's account).

## Monetization plan

None until the operator enables it (charter rule 4). Later options: optional paid "pro"
batch mode (save every image on a page, resize/rename rules), or donations. Do **not**
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
