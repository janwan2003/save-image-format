# Field test, 2026-11-20

Command: `node scripts/real-sites.mjs` (Chrome for Testing 159.0.8154.6, headless, via playwright-core 1.65.1).
For each site: load the page, wait 2.5 s, pick the largest loaded `<img>`, run Saveform's menu handler
(`save:png`) on it. activeTab was simulated with host access to the page's own origin only.

**Result: 17 of 20 saved directly, 1 needed one-site permission (Pinterest CDN), 2 had no loaded `<img>`.**

| Site | Image host | Result |
|---|---|---|
| en.wikipedia.org | thumb.wikimedia.org (WebP) | ok 250x228 |
| commons.wikimedia.org | thumb.wikimedia.org | ok 500x246 |
| www.bbc.com | ichef.bbci.co.uk (`.jpg.webp`) | ok 640x360 (filename showed `.jpg.png`, fixed the same session) |
| www.theguardian.com | i.guim.co.uk | ok 700x560 |
| unsplash.com | images.unsplash.com | ok 400x600 |
| www.pexels.com | images.pexels.com | ok 400x711 |
| github.com | github.githubassets.com | ok 480x300 |
| news.ycombinator.com | none | no loaded `<img>` large enough (page has none) |
| www.reddit.com | inline `data:` SVG | ok 1024x287 (SVG via offscreen document) |
| www.ikea.com | same site | ok 750x1000 |
| www.etsy.com | none | no loaded `<img>` (likely bot wall in headless) |
| www.nasa.gov | science.nasa.gov | ok 6016x4016 |
| www.flickr.com | live.staticflickr.com | ok 640x360 |
| www.amazon.com | m.media-amazon.com (AVIF) | ok 855x1368 |
| www.nytimes.com | static01.nyt.com | ok 600x400 |
| imgur.com | i.imgur.com (WebP) | ok 435x613 |
| www.pinterest.com | i.pinimg.com | asks permission for `https://i.pinimg.com/*` (no CORS headers; page fetch blocked too) |
| dribbble.com | cdn.dribbble.com | ok 1200x900 |
| www.behance.net | mir-s3-cdn-cf.behance.net (WebP) | ok 808x632 |
| www.shopify.com | shopify-assets.shopifycdn.com | ok 1440x810 |

Not covered: logged-in pages (Instagram, Facebook, X), Google Images result thumbnails, CSS
background images (no right-click "image" context), images inside cross-origin iframes, Firefox.
