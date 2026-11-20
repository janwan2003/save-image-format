// Saveform: list the images on a page. `collectPageImages` is injected into the page with
// chrome.scripting.executeScript, only after the user clicks the Saveform toolbar button
// (activeTab). It must be self-contained: no imports, no closures over module scope.
// It reads image addresses and sizes only; nothing leaves the browser.

export function collectPageImages(limit = 500) {
  const out = [];
  const seen = new Set();
  const abs = (u) => { try { return new URL(u, document.baseURI).href; } catch { return null; } };

  // srcset parser (HTML spec, simplified): "url 640w, url2 2x". URLs may contain commas
  // (e.g. "w_400,h_300"), so a URL is a run of non-spaces and only a trailing comma ends it.
  function parseSrcset(s) {
    const list = [];
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /[\s,]/.test(s[i])) i++;
      if (i >= s.length) break;
      let j = i;
      while (j < s.length && !/\s/.test(s[j])) j++;
      let url = s.slice(i, j);
      let desc = '';
      if (url.endsWith(',')) { url = url.replace(/,+$/, ''); i = j; } else {
        let k = s.indexOf(',', j);
        if (k < 0) k = s.length;
        desc = s.slice(j, k).trim();
        i = k + 1;
      }
      const w = /^(\d+)w$/.exec(desc);
      const x = /^([\d.]+)x$/.exec(desc);
      list.push({ url, w: w ? Number(w[1]) : 0, x: x ? Number(x[1]) : (desc ? 0 : 1) });
    }
    return list;
  }

  function add(src, width, height, kind, alt) {
    if (!src || seen.has(src) || out.length >= limit) return;
    if (!/^(https?:|data:image\/|blob:)/i.test(src)) return;
    seen.add(src);
    out.push({ src, width: Math.round(width) || 0, height: Math.round(height) || 0, kind, alt: (alt || '').slice(0, 120) });
  }

  for (const img of document.images) {
    let src = img.currentSrc || img.src;
    let w = img.naturalWidth, h = img.naturalHeight;
    // Prefer the largest candidate the page offers (srcset "w" descriptors) over the one the
    // browser picked for the current screen. Only for plain <img>; <picture> sources may
    // switch format, so the browser's pick is kept there.
    if (img.srcset && !(img.parentElement && img.parentElement.tagName === 'PICTURE')) {
      const best = parseSrcset(img.srcset).filter((c) => c.w).sort((a, b) => b.w - a.w)[0];
      if (best && best.w > w) {
        const u = abs(best.url);
        if (u) { if (w) h = (h * best.w) / w; w = best.w; src = u; }
      }
    }
    add(src, w, h, 'img', img.alt);
  }
  for (const el of document.querySelectorAll('input[type=image][src], video[poster]')) {
    const u = abs(el.tagName === 'VIDEO' ? el.getAttribute('poster') : el.getAttribute('src'));
    add(u, el.videoWidth || el.clientWidth, el.videoHeight || el.clientHeight, el.tagName === 'VIDEO' ? 'poster' : 'img', el.alt);
  }
  for (const el of document.querySelectorAll('svg image')) {
    const u = abs(el.getAttribute('href') || el.getAttribute('xlink:href') || '');
    const r = el.getBoundingClientRect();
    add(u, r.width, r.height, 'img', '');
  }
  // CSS background images (hero banners, galleries). Rendered box size only; the real size
  // is known once the image is fetched. Capped so huge pages stay fast.
  const all = document.body ? document.body.getElementsByTagName('*') : [];
  const n = Math.min(all.length, 5000);
  for (let i = 0; i < n; i++) {
    const el = all[i];
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none' || !bg.includes('url(')) continue;
    for (const m of bg.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)) add(abs(m[2]), el.clientWidth, el.clientHeight, 'background', '');
  }
  return { url: location.href, title: document.title, images: out };
}
