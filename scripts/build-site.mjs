#!/usr/bin/env node
// Builds the static Saveform site into dist/. Plain Node 22, no dependencies.
//   node scripts/build-site.mjs
// Pages come from site/pages.mjs (converters), site/guides.mjs (articles), a generated /guides/
// index, plus site/content/*.html (privacy, extension, 404), all rendered through site/template.html.
// The conversion engine is copied from extension/lib so the site and the
// extension run the exact same code.
import { mkdir, readFile, readdir, writeFile, copyFile, rm, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { converters, SITE_URL, REPO_URL, FORMAT_LABEL } from '../site/pages.mjs';
import { guides } from '../site/guides.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const DIST = join(ROOT, 'dist');
const BASE_PATH = new URL(SITE_URL).pathname; // "/save-image-format/"
const UPDATED = process.env.SITE_UPDATED || new Date().toISOString().slice(0, 10);

const CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "script-src 'self' 'wasm-unsafe-eval'", // WebAssembly: the HEIC decoder (vendor/libheif), PDF.js image decoders (vendor/pdfjs)
  "style-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`Template variable {{${k}}} has no value`);
    return vars[k];
  });
}

function jsonLd(obj) {
  // JSON-LD is data, not script, so the CSP allows it; escape "<" so text can never close the tag.
  return `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>\n`;
}

// Link text for a converter page: "WebP to PNG", or the page's own label (e.g. "Favicon generator").
const linkLabel = (p) => p.linkLabel || `${FORMAT_LABEL[p.from]} to ${FORMAT_LABEL[p.to]}`;

// Guides shown in the footer of every page (the rest are one click away on /guides/).
const FOOTER_GUIDES = ['how-to-save-webp-as-png', 'how-to-download-all-images-from-a-page', 'how-to-open-heic-files-on-windows'];
const GUIDES_SLUG = 'guides';

const pagePath = (slug) => (slug ? `${slug}/` : '');
const pageUrl = (slug) => new URL(pagePath(slug), SITE_URL).href;

const ICON_UPLOAD = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

function toolHtml(page) {
  const opts = Object.entries({ ...(page.sameFormat ? { same: 'Same as original' } : {}), png: 'PNG', jpg: 'JPG', webp: 'WebP', avif: 'AVIF', pdf: 'PDF', ico: 'ICO (icon)', gif: 'GIF', tiff: 'TIFF' })
    .map(([id, label]) => `<option value="${id}"${id === page.to ? ' selected' : ''}>${label}</option>`).join('');
  // Resize, target file size and PNG colours: on every page; a page's `resize`, `targetKb` and
  // `pngColors` fields only set the starting values.
  const rz = page.resize || {};
  const resizeModes = Object.entries({ none: 'Original size', fit: 'Fit within', exact: 'Exact size', percent: 'Percent' })
    .map(([id, label]) => `<option value="${id}"${id === (rz.mode || 'none') ? ' selected' : ''}>${label}</option>`).join('');
  const pngColors = [[0, 'Lossless'], [256, '256 (smaller file)'], [128, '128'], [64, '64'], [32, '32'], [16, '16']]
    .map(([n, label]) => `<option value="${n}"${n === (page.pngColors || 0) ? ' selected' : ''}>${label}</option>`).join('');
  const resize = `
      <span class="control" id="resize-control"><label for="resize-mode">Resize</label><select id="resize-mode">${resizeModes}</select>
        <span class="resize-dims" id="resize-dims"><input type="number" id="resize-width" min="1" max="16384" step="1" placeholder="width" aria-label="Width in pixels" value="${rz.width || ''}"><span aria-hidden="true">×</span><input type="number" id="resize-height" min="1" max="16384" step="1" placeholder="height" aria-label="Height in pixels" value="${rz.height || ''}"> px</span>
        <span class="resize-pct" id="resize-pct"><input type="number" id="resize-percent" min="1" max="400" step="1" aria-label="Percentage of the original size" value="${rz.percent || 50}"> %</span></span>
      <span class="control" id="target-control"><label for="target-on"><input type="checkbox" id="target-on"${page.targetKb ? ' checked' : ''}> Max file size</label><input type="number" id="target-kb" min="1" max="100000" step="1" aria-label="Maximum file size in KB" value="${page.targetKb || 100}"> KB</span>
      <label class="control" id="png-colors-control" for="png-colors"><span>Colours</span><select id="png-colors">${pngColors}</select></label>`;
  const fromLabel = page.from === 'any' ? 'images' : `${FORMAT_LABEL[page.from]} files`;
  const pageSizes = Object.entries({ a4: 'A4', letter: 'US Letter', fit: 'Same as image' })
    .map(([id, label]) => `<option value="${id}"${id === (page.pageSize || 'a4') ? ' selected' : ''}>${label}</option>`).join('');
  const icoSizes = [16, 32, 48, 64, 128, 256]
    .map((n) => `<label class="chip"><input type="checkbox" name="ico-size" value="${n}"${(page.icoSizes || [16, 32, 48, 256]).includes(n) ? ' checked' : ''}>${n}</label>`).join('');
  const keepJpeg = page.keepJpegOption ? `
      <label class="control" id="keep-jpeg-control" for="keep-jpeg"><input type="checkbox" id="keep-jpeg" checked><span>Keep the original JPEG data (rename only, no quality loss)</span></label>` : '';
  const dither = `
      <label class="control" id="dither-control" for="dither"><input type="checkbox" id="dither" checked><span>Dither (smoother photos and gradients)</span></label>`;
  const dpis = [[72, '72 dpi (screen)'], [150, '150 dpi'], [200, '200 dpi'], [300, '300 dpi (print)']]
    .map(([n, label]) => `<option value="${n}"${n === (page.pdfDpi || 150) ? ' selected' : ''}>${label}</option>`).join('');
  const pdfDpi = `
      <label class="control" id="pdf-dpi-control" for="pdf-dpi"${page.from === 'pdf' ? '' : ' hidden'}><span>PDF resolution</span><select id="pdf-dpi">${dpis}</select></label>`;
  const svg = page.svgOption ? `
      <label class="control" for="svg-size"><span>SVG size</span><input type="number" id="svg-size" min="16" max="8192" step="1" value="1024"> px</label>` : '';
  return `<div class="tool" data-tool${page.slug === '' ? ' data-general' : ''}${page.from === 'pdf' ? ' data-pdf-input' : ''}>
    <label class="drop" id="drop" for="file">
      ${ICON_UPLOAD}
      <span class="drop-title">Drop ${esc(fromLabel)} here</span>
      <span class="drop-sub"><span class="linkish">or choose files</span> · or paste with <kbd>Ctrl</kbd>+<kbd>V</kbd></span>
      <input type="file" id="file" class="visually-hidden" multiple accept="image/*,.webp,.avif,.svg,.gif,.png,.jpg,.jpeg,.jfif,.bmp,.ico,.heic,.heif,.tif,.tiff,.pdf,application/pdf,.cr2,.cr3,.nef,.nrw,.arw,.dng,.raf,.orf,.rw2,.pef,.srw">
    </label>
    <div class="controls">
      <label class="control" for="format"><span>Convert to</span><select id="format">${opts}</select></label>
      <label class="control" id="quality-control" for="quality"><span>Quality</span><input type="range" id="quality" min="10" max="100" step="1" value="${page.quality || 90}"><output id="quality-out" for="quality">${page.quality || 90}%</output></label>
      <label class="control" id="bg-control" for="bg"><span>Background</span><input type="color" id="bg" value="#ffffff"></label>
      <label class="control" id="page-size-control" for="page-size"><span>Page size</span><select id="page-size">${pageSizes}</select></label>
      <label class="control" id="tiff-control" for="tiff-compression"><span>Compression</span><select id="tiff-compression"><option value="lzw" selected>LZW (smaller)</option><option value="none">None (uncompressed)</option></select></label>
      <fieldset class="control" id="ico-control"><legend>Icon sizes (px)</legend>${icoSizes}</fieldset>${pdfDpi}${keepJpeg}${resize}${dither}${svg}
    </div>
    <p class="note" id="format-note" role="status" hidden></p>
    <p class="local-note">${ICON_LOCK}Converted on your device. Nothing is uploaded.</p>
    <div class="results-bar" id="results-bar" hidden>
      <p id="status" role="status" aria-live="polite"></p>
      <button type="button" class="btn" id="download-pdf" hidden disabled>Download one PDF</button>
      <button type="button" class="btn" id="download-tiff" hidden disabled>Download one TIFF</button>
      <button type="button" class="btn" id="download-all" disabled>Download all (ZIP)</button>
      <button type="button" class="btn secondary" id="clear">Clear</button>
    </div>
    <ul class="results" id="results" aria-label="Converted images"></ul>
  </div>`;
}

function stepsHtml(page) {
  const from = page.from === 'any' ? 'your images' : `your ${FORMAT_LABEL[page.from]} files`;
  const to = page.to === 'same' ? 'image' : FORMAT_LABEL[page.to];
  const lossyHint = {
    jpg: page.keepJpegOption ? 'Leave “Keep the original JPEG data” ticked to rename the file without re-compressing it. Untick it to re-save at a chosen quality.' : 'Set the quality and, if the images have transparent areas, the background colour.',
    webp: 'Set the quality; around 85% is a good start.',
    png: 'PNG is lossless, so there is nothing to tune. You can still pick another output format.',
    pdf: 'Pick a page size (A4, US Letter, or the size of the image) and the quality; 100% stores the pixels losslessly. Use the arrows to put the pages in order.',
    ico: 'Tick the icon sizes to include. 16, 32 and 48 px cover browser tabs and Windows; 256 px is for high-resolution displays.',
    tiff: 'TIFF is lossless. LZW compression makes smaller files that image editors, print shops and scanning software read; choose None only for very old software. Use the arrows to set the page order for a multi-page TIFF.',
    gif: 'Leave Dither ticked for photos and gradients. Untick it for flat graphics, screenshots and pixel art: edges stay clean and the file gets smaller.',
  }[page.to];
  const lastStep = page.to === 'pdf'
    ? '<li><strong>Download</strong>Click Download one PDF to get every image as a page of a single file, or save each page as its own PDF.</li>'
    : page.to === 'tiff'
    ? '<li><strong>Download</strong>Save each TIFF with its Download button or all of them as a ZIP, or click Download one TIFF to get every image as a page of a single multi-page TIFF.</li>'
    : `<li><strong>Download</strong>Save each ${esc(to)} with its Download button, or all of them at once with Download all (ZIP).</li>`;
  return `<section class="section" aria-labelledby="how">
  <h2 id="how">${esc(page.howTitle || `How to convert ${page.from === 'any' ? 'an image' : `${FORMAT_LABEL[page.from]} to ${to}`}`)}</h2>
  <ol class="steps">
    <li><strong>Add ${esc(from)}</strong>Drop them on the box above, click to choose them, or paste an image from the clipboard. You can add many at once.</li>
    <li><strong>Check the settings</strong>${page.settingsHint ? esc(page.settingsHint) : `${page.slug === '' ? 'Pick the output format. ' : ''}${esc(lossyHint)}`}</li>
    ${lastStep}
  </ol>
</section>`;
}

function faqHtml(page) {
  const items = page.faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n  ');
  return `<section class="section faq" aria-labelledby="faq">
  <h2 id="faq">Questions and answers</h2>
  ${items}
</section>`;
}

function converterLinks(root, currentSlug) {
  const links = converters.filter((p) => p.slug).map((p) => {
    const cur = p.slug === currentSlug ? ' aria-current="page"' : '';
    return `<li><a href="${root}${p.slug}/"${cur}>${esc(linkLabel(p))}</a></li>`;
  });
  links.push(`<li><a href="${root}"${currentSlug === '' ? ' aria-current="page"' : ''}>Any image to any format</a></li>`);
  return `<ul class="links-grid">\n  ${links.join('\n  ')}\n</ul>`;
}

function guideLinks(root, slugs = guides.map((g) => g.slug)) {
  const items = slugs.map((slug) => {
    const g = guides.find((x) => x.slug === slug);
    if (!g) throw new Error(`Unknown guide ${slug}`);
    return `<li><a href="${root}${g.slug}/">${esc(g.h1)}</a></li>`;
  });
  return `<ul class="guide-links">\n  ${items.join('\n  ')}\n</ul>`;
}

function guideMain(guide, root, logo) {
  const tool = guide.tool ? `<section class="section" aria-labelledby="tool-title">
  <h2 id="tool-title">${esc(guide.toolTitle)}</h2>
  ${toolHtml(guide.tool)}
</section>` : '';
  const convs = guide.converters.map((slug) => {
    const c = converters.find((x) => x.slug === slug);
    if (!c) throw new Error(`Unknown converter ${slug}`);
    return `<li><a href="${root}${c.slug}/">${esc(linkLabel(c))}</a></li>`;
  }).join('\n  ');
  return `<article>
<section class="hero">
  <h1>${esc(guide.h1)}</h1>
  <p class="lede">${esc(guide.lede)}</p>
</section>
${tool}
<div class="section prose">
${guide.body(root).trim()}
</div>
</article>
<section class="section" aria-labelledby="related">
  <h2 id="related">Related guides</h2>
  ${guideLinks(root, guide.related)}
  <h3>Converters</h3>
  <ul class="links-grid">
  ${convs}
  </ul>
</section>
${calloutHtml(root, logo)}`;
}

function calloutHtml(root, logo) {
  return `<aside class="callout" aria-labelledby="ext-callout">
  ${logo}
  <div>
    <h2 id="ext-callout">Skip the converter next time</h2>
    <p>The free Saveform browser extension adds <strong>Save as PNG / JPG / WebP / PDF</strong> to the right-click menu on any image on the web, and saves every image on a page at once as files, a ZIP or one PDF. Same local conversion, no upload, no tracking.</p>
    <a class="btn" href="${root}extension/">Get the extension</a>
  </div>
</aside>`;
}

// Converter links grouped by the format they read: "WebP: WebP to PNG · WebP to JPG …".
function convertersBySource(root) {
  const groups = new Map();
  for (const c of converters) {
    const key = c.group || c.from;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const items = [...groups].map(([from, list]) => {
    const label = from === 'compress' ? 'Compress and resize' : from === 'raw' ? 'From camera RAW' : from === 'any' ? 'Any image' : `From ${FORMAT_LABEL[from] || from.toUpperCase()}`;
    const links = list.map((c) => `<li><a href="${root}${pagePath(c.slug)}">${esc(c.slug ? linkLabel(c) : 'Any image to any format')}</a></li>`).join('');
    return `<div class="by-source"><h3>${esc(label)}</h3><ul>${links}</ul></div>`;
  });
  return `<div class="by-source-grid">\n  ${items.join('\n  ')}\n</div>`;
}

function guidesIndexMain(root, logo) {
  const cards = guides.map((g) => `<li class="guide-card">
    <h2><a href="${root}${g.slug}/">${esc(g.h1)}</a></h2>
    <p>${esc(g.lede)}</p>
  </li>`).join('\n  ');
  return `<section class="hero">
  <h1>Guides to saving and converting images</h1>
  <p class="lede">Short, practical articles about the image formats browsers and phones hand you, and how to turn them into files your other software accepts. Each one explains what is going on and walks through several ways to deal with it, including ways that need no extension at all.</p>
</section>
<ul class="guide-cards" aria-label="Guides">
  ${cards}
</ul>
<section class="section" aria-labelledby="by-source">
  <h2 id="by-source">Converters by source format</h2>
  <p class="muted">Every converter runs in your browser. Pick the format you have; the page converts it on your device.</p>
  ${convertersBySource(root)}
</section>
${calloutHtml(root, logo)}`;
}

function converterMain(page, root, logo) {
  const explainer = page.explainer.map((p) => `<p>${p}</p>`).join('\n  ');
  return `<section class="hero">
  <h1>${esc(page.h1)}</h1>
  <p class="lede">${esc(page.lede)}</p>
  ${toolHtml(page)}
</section>
${stepsHtml(page)}
<section class="section prose" aria-labelledby="about-formats">
  <h2 id="about-formats">${esc(page.explainerTitle)}</h2>
  ${explainer}
</section>
${faqHtml(page)}
<section class="section" aria-labelledby="more">
  <h2 id="more">More converters</h2>
  ${converterLinks(root, page.slug)}
</section>
<section class="section" aria-labelledby="guides">
  <h2 id="guides">Guides</h2>
  ${guideLinks(root)}
</section>
${calloutHtml(root, logo)}`;
}

async function main() {
  const [template, favicon, privacy, extension, notFound] = await Promise.all([
    readFile(join(SITE, 'template.html'), 'utf8'),
    readFile(join(SITE, 'favicon.svg'), 'utf8'),
    readFile(join(SITE, 'content/privacy.html'), 'utf8'),
    readFile(join(SITE, 'content/extension.html'), 'utf8'),
    readFile(join(SITE, 'content/404.html'), 'utf8'),
  ]);
  // Inline logo: the favicon artwork, decorative (the brand name is next to it).
  const logo = favicon.trim().replace('<svg ', '<svg aria-hidden="true" focusable="false" ').replace(/ width="32" height="32"/, '');

  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, 'assets'), { recursive: true });
  await mkdir(join(DIST, 'lib'), { recursive: true });

  const written = [];
  async function emit(relPath, html) {
    const out = join(DIST, relPath);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, html);
    written.push(relPath);
  }

  function render({ slug, title, description, main, head = '', scripts = '', nav = '', root, canonical, noindex = false }) {
    const navAttr = (k) => (nav === k ? ' aria-current="page"' : '');
    return fill(template, {
      csp: CSP,
      title: esc(title),
      description: esc(description),
      canonical: esc(canonical ?? pageUrl(slug)),
      robotsMeta: noindex ? '<meta name="robots" content="noindex">\n' : '',
      root,
      repo: REPO_URL,
      logo,
      head,
      scripts,
      main,
      navConvert: navAttr('convert'),
      navExtension: navAttr('extension'),
      navPrivacy: navAttr('privacy'),
      navGuides: navAttr('guides'),
      footerGuides: FOOTER_GUIDES.map((slug) => {
        const g = guides.find((x) => x.slug === slug);
        if (!g) throw new Error(`Unknown footer guide ${slug}`);
        return `<a href="${root}${g.slug}/">${esc(g.footer)}</a>`;
      }).join(' ') + ` <a href="${root}${GUIDES_SLUG}/">All guides →</a>`,
    });
  }

  // Converter pages.
  for (const page of converters) {
    const root = page.slug ? '../' : './';
    const faqLd = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    };
    const appLd = {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: page.appName || (page.slug ? `Saveform ${linkLabel(page)} converter` : 'Saveform image converter'),
      url: pageUrl(page.slug),
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any (runs in a web browser)',
      isAccessibleForFree: true,
      browserRequirements: 'Requires JavaScript and a modern browser',
    };
    const html = render({
      slug: page.slug,
      title: page.title,
      description: page.description,
      root,
      nav: page.slug ? '' : 'convert',
      head: jsonLd(faqLd) + jsonLd(appLd),
      scripts: `<script type="module" src="${root}assets/app.js"></script>\n`,
      main: converterMain(page, root, logo),
    });
    await emit(join(pagePath(page.slug), 'index.html'), html);
  }

  // Guide pages.
  for (const guide of guides) {
    const root = '../';
    const articleLd = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: guide.h1,
      description: guide.description,
      url: pageUrl(guide.slug),
      dateModified: UPDATED,
      inLanguage: 'en',
      publisher: { '@type': 'Organization', name: 'Saveform', url: SITE_URL },
    };
    await emit(join(guide.slug, 'index.html'), render({
      slug: guide.slug, root,
      title: guide.title,
      description: guide.description,
      head: jsonLd(articleLd),
      scripts: guide.tool ? `<script type="module" src="${root}assets/app.js"></script>\n` : '',
      main: guideMain(guide, root, logo),
    }));
  }

  // Guides index.
  {
    const root = '../';
    const listLd = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Saveform guides',
      url: pageUrl(GUIDES_SLUG),
      inLanguage: 'en',
      hasPart: guides.map((g) => ({ '@type': 'Article', headline: g.h1, url: pageUrl(g.slug) })),
    };
    await emit(join(GUIDES_SLUG, 'index.html'), render({
      slug: GUIDES_SLUG, root, nav: 'guides',
      title: 'Guides: Saving and Converting WebP, AVIF, HEIC and Other Images | Saveform',
      description: 'Practical guides to saving images from websites in the format you need, opening iPhone HEIC photos on Windows, and downloading every image on a page at once.',
      head: jsonLd(listLd),
      main: guidesIndexMain(root, logo),
    }));
  }

  // Static content pages.
  const contentVars = (root) => ({ root, repo: REPO_URL, updated: UPDATED, converterLinks: converterLinks(root, null) });
  await emit('privacy/index.html', render({
    slug: 'privacy', root: '../', nav: 'privacy',
    title: 'Privacy Policy | Saveform',
    description: 'Saveform collects no data. Images are converted on your device, nothing is uploaded, and there are no analytics or cookies on the site or in the extension.',
    main: fill(privacy, contentVars('../')),
  }));
  await emit('extension/index.html', render({
    slug: 'extension', root: '../', nav: 'extension',
    title: 'Saveform Extension: Save Images as PNG, JPG, WebP or PDF | Saveform',
    description: 'Right-click any image and save it as PNG, JPG, WebP or PDF. Converted locally, open source, minimal permissions explained in plain words.',
    main: fill(extension, contentVars('../')),
  }));
  // 404 is served by GitHub Pages at arbitrary depths, so it uses absolute paths.
  await emit('404.html', render({
    slug: '404', root: BASE_PATH, noindex: true, canonical: SITE_URL,
    title: 'Page not found | Saveform',
    description: 'This page does not exist. Try the Saveform image converters.',
    main: fill(notFound, contentVars(BASE_PATH)),
  }));

  // Assets and the shared conversion engine.
  await Promise.all([
    copyFile(join(SITE, 'assets/style.css'), join(DIST, 'assets/style.css')),
    copyFile(join(SITE, 'assets/app.js'), join(DIST, 'assets/app.js')),
    copyFile(join(SITE, 'assets/heic.js'), join(DIST, 'assets/heic.js')),
    copyFile(join(SITE, 'assets/heic-worker.js'), join(DIST, 'assets/heic-worker.js')),
    copyFile(join(SITE, 'assets/tiff.js'), join(DIST, 'assets/tiff.js')),
    copyFile(join(SITE, 'assets/tiff-worker.js'), join(DIST, 'assets/tiff-worker.js')),
    copyFile(join(SITE, 'assets/tiff-client.js'), join(DIST, 'assets/tiff-client.js')),
    copyFile(join(SITE, 'assets/pdf-client.js'), join(DIST, 'assets/pdf-client.js')),
    copyFile(join(SITE, 'assets/raw.js'), join(DIST, 'assets/raw.js')),
    copyFile(join(SITE, 'assets/icc.js'), join(DIST, 'assets/icc.js')),
    copyFile(join(ROOT, 'extension/lib/zip.js'), join(DIST, 'lib/zip.js')),
    copyFile(join(SITE, 'favicon.svg'), join(DIST, 'favicon.svg')),
    copyFile(join(SITE, 'og-image.png'), join(DIST, 'og-image.png')),
    copyFile(join(ROOT, 'extension/lib/convert.js'), join(DIST, 'lib/convert.js')),
    copyFile(join(ROOT, 'extension/lib/filename.js'), join(DIST, 'lib/filename.js')),
    copyFile(join(ROOT, 'extension/lib/pdf.js'), join(DIST, 'lib/pdf.js')),
    copyFile(join(ROOT, 'extension/lib/gif.js'), join(DIST, 'lib/gif.js')),
    copyFile(join(ROOT, 'extension/lib/tiff-write.js'), join(DIST, 'lib/tiff-write.js')),
    copyFile(join(ROOT, 'extension/lib/png-quant.js'), join(DIST, 'lib/png-quant.js')),
  ]);
  // HEIC decoder (LGPL, vendored unmodified; see site/vendor/libheif/README.md).
  await mkdir(join(DIST, 'vendor/libheif'), { recursive: true });
  for (const f of await readdir(join(SITE, 'vendor/libheif'))) {
    await copyFile(join(SITE, 'vendor/libheif', f), join(DIST, 'vendor/libheif', f));
  }
  // PDF renderer (Apache-2.0, vendored unmodified; see site/vendor/pdfjs/README.md).
  await cp(join(SITE, 'vendor/pdfjs'), join(DIST, 'vendor/pdfjs'), { recursive: true });
  await writeFile(join(DIST, '.nojekyll'), '');
  // Search Console ownership files (scripts/gsc.py token), served from the site root.
  for (const f of await readdir(join(SITE, 'verify')).catch(() => [])) {
    await copyFile(join(SITE, 'verify', f), join(DIST, f));
  }

  // Search engine files.
  const indexable = [...converters.map((p) => p.slug), ...guides.map((g) => g.slug), GUIDES_SLUG, 'extension', 'privacy'];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexable.map((s) => `  <url><loc>${pageUrl(s)}</loc><lastmod>${UPDATED}</lastmod></url>`).join('\n')}
</urlset>
`;
  await writeFile(join(DIST, 'sitemap.xml'), sitemap);
  await writeFile(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${new URL('sitemap.xml', SITE_URL).href}\n`);

  console.log(`Built ${written.length} pages into ${DIST}`);
  for (const p of written) console.log(`  ${p}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
