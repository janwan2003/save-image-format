// Saveform converter page. Uses the same conversion engine as the extension
// (lib/convert.js, copied from extension/lib at build time). Nothing here makes
// a network request: files are read, converted and offered for download locally.
import { FORMATS, canEncode, convertBlob, decode, sniffType } from '../lib/convert.js';
import { makePdf } from '../lib/pdf.js';
import { makeTiff } from '../lib/tiff-write.js';
import { baseNameFromUrl } from '../lib/filename.js';
import { makeZip } from '../lib/zip.js';
import { decodeHeic } from './heic.js';
import { decodeTiff, tiffPageCount } from './tiff-client.js';
import { decodePdf, pdfPageCount, closePdf } from './pdf-client.js';
import { isRaw, decodeRaw } from './raw.js';
import { decodePsd } from './psd-client.js';
import { traceInWorker } from './trace-client.js';

// Formats the browser may not decode itself. HEIC (iPhone photos) goes to a WebAssembly
// decoder that is only downloaded when the first HEIC file is added; TIFF to our own decoder.
const FALLBACK_DECODERS = { heic: decodeHeic, tiff: decodeTiff, pdf: (b) => decodePdf(b, 0), psd: decodePsd };
const MAX_TIFF_PAGES = 500;
const MAX_PDF_PAGES = 500;

// Formats that "Max file size" works for (quality search, palette PNG, then smaller dimensions).
const TARGET_FORMATS = new Set(['jpg', 'webp', 'avif', 'png', 'same']);
const SAME = { id: 'same', label: 'Same as original', lossy: true, opaque: false };
const formatOf = (id) => FORMATS[id] || SAME;
// Output format for "Same as original": the input's own format where the page can write it.
const KIND_OF = { jpg: 'jpeg', png: 'png', webp: 'webp', avif: 'avif', tiff: 'tiff', gif: 'gif' };

const tool = document.querySelector('[data-tool]');
if (tool) init(tool);

function init(root) {
  const $ = (sel) => root.querySelector(sel);
  const fileInput = $('#file');
  const drop = $('#drop');
  const formatSel = $('#format');
  const quality = $('#quality');
  const qualityOut = $('#quality-out');
  const qualityCtl = $('#quality-control');
  const bg = $('#bg');
  const bgCtl = $('#bg-control');
  const svgSize = $('#svg-size');
  const pageSize = $('#page-size');
  const pageSizeCtl = $('#page-size-control');
  const icoCtl = $('#ico-control');
  const icoBoxes = [...root.querySelectorAll('input[name="ico-size"]')];
  const keepJpeg = $('#keep-jpeg');
  const keepJpegCtl = $('#keep-jpeg-control');
  const dither = $('#dither');
  const ditherCtl = $('#dither-control');
  const downloadPdf = $('#download-pdf');
  const downloadTiff = $('#download-tiff');
  const tiffCompression = $('#tiff-compression');
  const tiffCtl = $('#tiff-control');
  const formatNote = $('#format-note');
  const resizeMode = $('#resize-mode');
  const resizeW = $('#resize-width');
  const resizeH = $('#resize-height');
  const resizePct = $('#resize-percent');
  const resizeDims = $('#resize-dims');
  const resizePctWrap = $('#resize-pct');
  const resizeCtl = $('#resize-control');
  const targetOn = $('#target-on');
  const targetKb = $('#target-kb');
  const targetCtl = $('#target-control');
  const pngColors = $('#png-colors');
  const pngColorsCtl = $('#png-colors-control');
  const traceColors = $('#trace-colors');
  const traceDetail = $('#trace-detail');
  const traceCtls = [$('#trace-control'), $('#trace-detail-control')].filter(Boolean);
  const pdfDpi = $('#pdf-dpi');
  const pdfDpiCtl = $('#pdf-dpi-control');
  const bar = $('#results-bar');
  const status = $('#status');
  const list = $('#results');
  const downloadAll = $('#download-all');
  const clearBtn = $('#clear');

  const items = [];
  const queue = [];
  let running = false;
  let nextId = 1;
  let pasteCount = 0;

  // ---- settings -----------------------------------------------------------
  const settings = () => ({
    format: formatSel.value,
    quality: Number(quality.value) / 100,
    background: bg.value,
    svgMinSize: svgSize ? clampInt(svgSize.value, 16, 8192, 1024) : 0,
    pageSize: pageSize.value,
    icoSizes: icoBoxes.filter((b) => b.checked).map((b) => Number(b.value)),
    keepJpeg: !!keepJpeg?.checked && formatSel.value === 'jpg',
    dither: dither ? dither.checked : true,
    tiffCompression: tiffCompression?.value || 'lzw',
    resize: resizeMode && resizeMode.value !== 'none' && formatSel.value !== 'ico'
      ? { mode: resizeMode.value, width: Number(resizeW.value) || 0, height: Number(resizeH.value) || 0, percent: clampInt(resizePct.value, 1, 400, 100) }
      : null,
    targetBytes: targetOn?.checked && TARGET_FORMATS.has(formatSel.value) ? clampInt(targetKb.value, 1, 1e5, 100) * 1024 : 0,
    pngColors: pngColors ? Number(pngColors.value) || 0 : 0,
    pdfDpi: pdfDpi ? clampInt(pdfDpi.value, 36, 600, 150) : 150,
    traceColors: traceColors ? (traceColors.value === 'bw' ? 'bw' : Number(traceColors.value) || 8) : 8,
    traceDetail: traceDetail?.value || 'normal',
  });

  function syncControls() {
    const fmt = formatOf(formatSel.value);
    const keeping = !!keepJpeg?.checked && fmt.id === 'jpg';
    const palette = (fmt.id === 'png' || fmt.id === 'same') && Number(pngColors?.value) > 0;
    if (resizeCtl) {
      resizeCtl.hidden = fmt.id === 'ico' || keeping;
      resizeDims.hidden = resizeMode.value !== 'fit' && resizeMode.value !== 'exact';
      resizePctWrap.hidden = resizeMode.value !== 'percent';
    }
    if (targetCtl) {
      targetCtl.hidden = !TARGET_FORMATS.has(fmt.id) || keeping;
      targetKb.disabled = !targetOn.checked;
    }
    if (pngColorsCtl) pngColorsCtl.hidden = !(fmt.id === 'png' || fmt.id === 'same');
    if (keepJpegCtl) keepJpegCtl.hidden = fmt.id !== 'jpg';
    // PDF resolution: shown on the PDF pages, and elsewhere once a PDF has been added.
    if (pdfDpiCtl) pdfDpiCtl.hidden = !(root.hasAttribute('data-pdf-input') || items.some((i) => i.pdf));
    qualityCtl.hidden = !fmt.lossy || keeping;
    bgCtl.hidden = !fmt.opaque || keeping;
    pageSizeCtl.hidden = fmt.id !== 'pdf';
    icoCtl.hidden = fmt.id !== 'ico';
    if (ditherCtl) ditherCtl.hidden = fmt.id !== 'gif' && !palette;
    downloadPdf.hidden = fmt.id !== 'pdf';
    if (tiffCtl) tiffCtl.hidden = fmt.id !== 'tiff';
    for (const c of traceCtls) c.hidden = fmt.id !== 'svg';
    if (downloadTiff) downloadTiff.hidden = fmt.id !== 'tiff';
    root.dataset.format = fmt.id;
    showQuality();
  }

  function showQuality() {
    qualityOut.value = formatSel.value === 'pdf' && quality.value === '100' ? '100% (lossless)' : `${quality.value}%`;
  }

  async function checkEncoders() {
    const unsupported = [];
    for (const opt of formatSel.options) {
      const fmt = FORMATS[opt.value];
      if (!fmt) continue; // Same as original
      if (!(await canEncode(fmt.mime))) {
        opt.disabled = true;
        opt.textContent = `${fmt.label} (not available in this browser)`;
        unsupported.push(fmt.label);
      }
    }
    // The note matters on the general converter, or when this page's own format is unavailable;
    // elsewhere the disabled option's label already says so.
    const wantedLabel = formatOf(formatSel.value).label;
    if (unsupported.length && (root.hasAttribute('data-general') || unsupported.includes(wantedLabel))) {
      const wanted = formatOf(formatSel.value);
      let msg = `This browser cannot create ${unsupported.join(' or ')} files from a web page, so ${unsupported.length > 1 ? 'those options are' : 'that option is'} switched off.`;
      if (unsupported.includes(wanted.label)) {
        const fallback = [...formatSel.options].find((o) => !o.disabled);
        if (fallback) formatSel.value = fallback.value;
        msg += ` Output is set to ${formatOf(formatSel.value).label} instead; a current version of Chrome, Edge or Firefox can create ${wanted.label}.`;
      }
      formatNote.textContent = msg;
      formatNote.hidden = false;
      syncControls();
    }
  }

  let debounce = 0;
  function settingsChanged(delay = 0) {
    syncControls();
    clearTimeout(debounce);
    debounce = setTimeout(() => items.forEach(enqueue), delay);
  }
  formatSel.addEventListener('change', () => settingsChanged());
  quality.addEventListener('input', () => { showQuality(); settingsChanged(300); });
  pageSize.addEventListener('change', () => settingsChanged());
  icoBoxes.forEach((b) => b.addEventListener('change', () => settingsChanged(300)));
  keepJpeg?.addEventListener('change', () => settingsChanged());
  dither?.addEventListener('change', () => settingsChanged());
  tiffCompression?.addEventListener('change', () => settingsChanged());
  bg.addEventListener('input', () => settingsChanged(300));
  svgSize?.addEventListener('change', () => settingsChanged());
  resizeMode?.addEventListener('change', () => settingsChanged());
  for (const input of [resizeW, resizeH, resizePct, targetKb]) input?.addEventListener('input', () => settingsChanged(500));
  targetOn?.addEventListener('change', () => settingsChanged());
  pngColors?.addEventListener('change', () => settingsChanged());
  traceColors?.addEventListener('change', () => settingsChanged());
  traceDetail?.addEventListener('change', () => settingsChanged());
  pdfDpi?.addEventListener('change', () => {
    items.filter((i) => i.pdf).forEach(enqueue); // only PDF pages depend on it
  });

  // ---- adding files -------------------------------------------------------
  // A multi-page TIFF (scans, faxes) or a PDF becomes one row per page, in page order.
  async function expand(file) {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    // Camera RAW first: CR2, NEF, ARW, DNG, ... look like TIFF but must not be split into pages.
    if (isRaw(head, file.name)) return [{ file, label: file.name, raw: true, outName: file.name.replace(/\.[^.]*$/, '') || 'photo' }];
    const kind = sniffType(head);
    if (kind === 'psd') return [{ file, label: file.name, outName: file.name.replace(/\.ps[db]$/i, '') || 'image' }];
    if (kind !== 'tiff' && kind !== 'pdf') return [{ file, label: file.name }];
    const pdf = kind === 'pdf';
    let pages = 1;
    try {
      pages = pdf ? Math.min(MAX_PDF_PAGES, await pdfPageCount(file)) : Math.min(MAX_TIFF_PAGES, await tiffPageCount(file));
    } catch { /* the conversion reports the error */ }
    if (pages < 2) return [{ file, label: file.name, ...(pdf ? { pdf, page: 0 } : {}) }];
    const stem = file.name.replace(/\.[^.]*$/, '') || 'image';
    return Array.from({ length: pages }, (_, page) => ({ file, page, pages, pdf, label: `${file.name} (page ${page + 1} of ${pages})`, outName: `${stem}-page-${page + 1}` }));
  }

  let adding = Promise.resolve();
  function addFiles(files) {
    files = files.filter((f) => f && f.size);
    // Chained so that rows keep the order in which files were added.
    adding = adding.then(async () => {
      const added = [];
      for (const file of files) {
        for (const entry of await expand(file)) {
          const item = { id: nextId++, ...entry, state: 'queued', result: null, error: null, row: null };
          items.push(item);
          item.row = makeRow(item);
          list.append(item.row.li);
          added.push(item);
        }
      }
      if (added.some((i) => i.pdf)) syncControls();
      added.forEach(enqueue);
      updateBar();
    });
    return adding;
  }

  fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files]);
    fileInput.value = '';
  });

  // Dropping anywhere on the page works; the drop zone highlights.
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; drop.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.classList.remove('dragging'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    drop.classList.remove('dragging');
    addFiles([...e.dataTransfer.files]);
  });

  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files.map((f) => {
      pasteCount++;
      const ext = (f.type.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
      return new File([f], `pasted-image-${pasteCount}.${ext}`, { type: f.type });
    }));
  });

  // ---- conversion queue (one at a time keeps memory use predictable) ------
  function enqueue(item) {
    if (item.removed || queue.includes(item)) return;
    item.state = 'queued';
    queue.push(item);
    renderRow(item);
    pump();
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const item = queue.shift();
      if (item.removed) continue;
      const opts = settings();
      item.state = 'working';
      renderRow(item);
      updateBar();
      try {
        const decoders = item.page != null
          ? { ...FALLBACK_DECODERS, tiff: (b) => decodeTiff(b, item.page), pdf: () => decodePdf(item.file, item.page, { dpi: opts.pdfDpi }) }
          : FALLBACK_DECODERS;
        const format = opts.format === 'same' ? (item.raw ? 'jpg' : await sameFormat(item)) : opts.format;
        let r = opts.keepJpeg && !item.raw ? await keepJpegBytes(item.file) : await convertBlob(item.file, format, { ...opts, preview: true, tracer: traceInWorker, fallbackDecoders: decoders, preferFallback: item.page != null, decoder: item.raw ? decodeRaw : null });
        // "Same as original" is for making files smaller: if re-encoding did not help, keep the file.
        if (opts.format === 'same' && !r.resized && item.page == null && r.blob.size >= item.file.size && r.sourceKind === KIND_OF[format]) {
          r = { ...r, blob: new Blob([item.file], { type: FORMATS[format].mime }), keptOriginal: true, targetMet: r.targetBytes ? item.file.size <= r.targetBytes : undefined };
        }
        if (item.removed) continue;
        revoke(item);
        item.result = { ...r, format, url: URL.createObjectURL(r.blob), name: outputName(item.outName || item.file.name, format) };
        item.error = null;
        item.state = 'done';
      } catch (err) {
        revoke(item);
        item.result = null;
        item.error = friendlyError(err, item.file);
        item.state = 'error';
      }
      renderRow(item);
    }
    running = false;
    updateBar();
  }

  function revoke(item) {
    if (item.result?.url) URL.revokeObjectURL(item.result.url);
    if (item.pdfThumb) { URL.revokeObjectURL(item.pdfThumb); item.pdfThumb = null; }
  }

  function forget(item) {
    item.removed = true;
    revoke(item);
    if (item.preview) URL.revokeObjectURL(item.preview);
    if (item.pdf && !items.some((i) => i !== item && !i.removed && i.file === item.file)) closePdf(item.file);
  }

  // ---- result rows --------------------------------------------------------
  function makeRow(item) {
    const li = el('li', 'result');
    const thumb = el('img', 'thumb');
    thumb.alt = '';
    thumb.width = 64; thumb.height = 64;
    const info = el('div', 'result-info');
    const name = el('p', 'result-name');
    const meta = el('p', 'result-meta');
    info.append(name, meta);
    const actions = el('div', 'result-actions');
    const dl = el('a', 'btn');
    dl.textContent = 'Download';
    const up = el('button', 'btn-icon move');
    up.type = 'button'; up.textContent = '↑'; up.title = 'Move up';
    up.setAttribute('aria-label', `Move ${item.label} up`);
    const down = el('button', 'btn-icon move');
    down.type = 'button'; down.textContent = '↓'; down.title = 'Move down';
    down.setAttribute('aria-label', `Move ${item.label} down`);
    up.addEventListener('click', () => move(item, -1));
    down.addEventListener('click', () => move(item, 1));
    const remove = el('button', 'btn-icon');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${item.label}`);
    remove.addEventListener('click', () => {
      forget(item);
      li.remove();
      items.splice(items.indexOf(item), 1);
      updateBar();
    });
    actions.append(dl, up, down, remove);
    li.append(thumb, info, actions);
    return { li, thumb, name, meta, dl };
  }

  // Page order for "Download one PDF" / "Download one TIFF" is the list order.
  function move(item, delta) {
    const i = items.indexOf(item), j = i + delta;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    list.replaceChildren(...items.map((it) => it.row.li));
    item.row.li.querySelector(delta < 0 ? '.move' : '.move + .move')?.focus();
  }

  function renderRow(item) {
    const { thumb, name, meta, dl, li } = item.row;
    li.dataset.state = item.state;
    const r = item.result;
    name.textContent = r ? r.name : item.label;
    name.title = item.label;
    if (item.state === 'done' && r) {
      // A PDF or TIFF cannot be shown in an <img> (TIFF only in Safari), so its row previews the
      // page's JPEG data, or else the source file (not for HEIC/TIFF, which most browsers cannot show).
      if (r.format !== 'pdf' && r.format !== 'tiff') thumb.src = r.url;
      else if (r.preview) thumb.src = (item.pdfThumb ||= URL.createObjectURL(r.preview));
      else if (r.pdfPage?.filter === 'DCTDecode') thumb.src = (item.pdfThumb ||= URL.createObjectURL(new Blob([r.pdfPage.data], { type: 'image/jpeg' })));
      else if (['heic', 'tiff', 'pdf', 'raw', 'psd'].includes(r.sourceKind)) thumb.removeAttribute('src');
      else thumb.src = (item.preview ||= URL.createObjectURL(item.file));
      const before = item.file.size, after = r.blob.size;
      const pct = Math.round(((after - before) / before) * 100);
      const extra = [];
      if (r.quality != null && r.targetBytes && !r.keptOriginal) extra.push(` · quality ${Math.round(r.quality * 100)}%`);
      if (r.colors && !r.keptOriginal) extra.push(` · ${r.colors} colours`);
      if (r.traced) {
        extra.push(` · ${r.traced.colors === 1 ? '1 colour' : `${r.traced.colors} colours`}, ${r.traced.paths === 1 ? '1 shape' : `${r.traced.paths.toLocaleString('en-US')} shapes`}`);
        if (r.traced.width < r.width) extra.push(` · traced at ${r.traced.width} × ${r.traced.height} px`);
      }
      if (r.approximate) extra.push(' · ', Object.assign(el('span', 'warn'), { textContent: 'rebuilt from the layers (saved without Maximize Compatibility): effects and blend modes may be missing' }));
      if (r.sourceKind === 'raw') extra.push(' · ', Object.assign(el('span', 'raw-note'), { textContent: `from the camera’s built-in ${r.sourceWidth} × ${r.sourceHeight} JPEG`, title: 'RAW files carry a JPEG made by the camera; this page converts that picture and does not develop the sensor data.' }));
      if (r.targetBytes && r.targetMet === false) {
        extra.push(' · ', Object.assign(el('span', 'warn'), { textContent: `could not get under ${fmtBytes(r.targetBytes)}; this is the smallest version` }));
      }
      // One page of a multi-page file: comparing with the whole file's size would mislead.
      const partOf = item.pages > 1;
      meta.replaceChildren(
        partOf ? `${kindLabel(r.sourceKind, item.file)} page ${item.page + 1} → ${FORMATS[r.format].label} ${fmtBytes(after)}` : `${kindLabel(r.sourceKind, item.file)} ${fmtBytes(before)} → ${FORMATS[r.format].label} ${fmtBytes(after)} `,
        partOf ? '' : r.kept ? '(original JPEG data kept)' : r.keptOriginal ? '(original kept: re-saving did not make it smaller)' : Object.assign(el('span', pct < 0 ? 'smaller' : 'larger'), { textContent: `(${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)}%)` }),
        r.resized ? ` · ${r.sourceWidth} × ${r.sourceHeight} → ${r.width} × ${r.height} px` : ` · ${r.width} × ${r.height} px`,
        ...extra,
      );
      dl.href = r.url;
      dl.download = r.name;
      dl.hidden = false;
      dl.setAttribute('aria-label', `Download ${r.name}`);
    } else {
      thumb.removeAttribute('src');
      dl.hidden = true;
      dl.removeAttribute('href');
      if (item.state === 'error') {
        meta.replaceChildren(Object.assign(el('span', 'result-error'), { textContent: item.error }));
      } else {
        meta.textContent = item.state === 'working' ? 'Converting…' : 'Waiting…';
      }
    }
  }

  function updateBar() {
    bar.hidden = items.length === 0;
    const done = items.filter((i) => i.state === 'done').length;
    const failed = items.filter((i) => i.state === 'error').length;
    const busy = items.length - done - failed;
    downloadAll.disabled = done === 0 || busy > 0;
    downloadPdf.disabled = done === 0 || busy > 0;
    downloadPdf.textContent = done > 1 ? `Download one PDF (${done} pages)` : 'Download one PDF';
    if (downloadTiff) {
      downloadTiff.disabled = done === 0 || busy > 0;
      downloadTiff.textContent = done > 1 ? `Download one TIFF (${done} pages)` : 'Download one TIFF';
    }
    let text = `${done} of ${items.length} image${items.length === 1 ? '' : 's'} converted`;
    if (failed) text += `, ${failed} failed`;
    if (busy) text += ' (working…)';
    status.textContent = text + '.';
  }

  downloadAll.addEventListener('click', async () => {
    const done = items.filter((i) => i.state === 'done' && i.result);
    if (!done.length) return;
    downloadAll.disabled = true;
    try {
      const used = new Set();
      const entries = [];
      for (const item of done) {
        entries.push({ name: uniqueName(item.result.name, used), data: new Uint8Array(await item.result.blob.arrayBuffer()) });
      }
      const f = settings().format;
      saveFile(makeZip(entries), f === 'same' ? 'saveform-images.zip' : `saveform-${f}-images.zip`);
    } finally {
      updateBar();
    }
  });

  downloadPdf.addEventListener('click', () => {
    const pages = items.filter((i) => i.state === 'done' && i.result?.pdfPage);
    if (!pages.length) return;
    const pdf = makePdf(pages.map((i) => i.result.pdfPage), { pageSize: settings().pageSize });
    const name = pages.length === 1 ? pages[0].result.name : `${pages[0].result.name.replace(/\.pdf$/, '')}-and-${pages.length - 1}-more.pdf`;
    saveFile(pdf, name);
  });

  // Multi-page TIFF: the pages already encoded for each row, joined in list order.
  downloadTiff?.addEventListener('click', () => {
    const pages = items.filter((i) => i.state === 'done' && i.result?.tiffPage);
    if (!pages.length) return;
    const tiff = makeTiff(pages.map((i) => i.result.tiffPage));
    const name = pages.length === 1 ? pages[0].result.name : `${pages[0].result.name.replace(/\.tif$/, '')}-and-${pages.length - 1}-more.tif`;
    saveFile(tiff, name);
  });

  clearBtn.addEventListener('click', () => {
    for (const item of items) forget(item);
    items.length = 0;
    queue.length = 0;
    list.replaceChildren();
    updateBar();
    syncControls();
    fileInput.focus();
  });

  syncControls();
  checkEncoders().finally(() => { root.dataset.ready = '1'; });
}

// ---- helpers --------------------------------------------------------------
async function sameFormat(item) {
  const kind = sniffType(new Uint8Array(await item.file.slice(0, 512).arrayBuffer()));
  if (kind === 'jpeg' || kind === 'heic') return 'jpg';
  if (kind === 'webp' && (await canEncode('image/webp'))) return 'webp';
  if (kind === 'avif') return (await canEncode('image/avif')) ? 'avif' : 'jpg';
  if (kind === 'tiff') return 'tiff';
  if (kind === 'pdf') return 'jpg'; // pages are mostly scans or text: JPG keeps them small
  return 'png'; // PNG, GIF (first frame), SVG, BMP, ICO
}

function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// JFIF and .jpeg files are already JPEG: keep the bytes (and quality) and only rename.
// Other inputs are converted normally.
async function keepJpegBytes(file) {
  const kind = sniffType(new Uint8Array(await file.slice(0, 512).arrayBuffer()));
  if (kind !== 'jpeg') return convertBlob(file, 'jpg', {});
  const img = await decode(file);
  img.close();
  return { blob: new Blob([file], { type: 'image/jpeg' }), width: img.width, height: img.height, sourceKind: 'jpeg', kept: true };
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function outputName(original, formatId) {
  // Reuse the extension's filename sanitiser by treating the name as a path segment.
  const base = baseNameFromUrl(`file:///${encodeURIComponent(original)}`, 'image');
  return `${base}.${FORMATS[formatId].ext}`;
}

function uniqueName(name, used) {
  let candidate = name;
  const dot = name.lastIndexOf('.');
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

function kindLabel(kind, file) {
  if (kind === 'jpeg' && /\.jfif$/i.test(file.name)) return 'JFIF';
  const labels = { png: 'PNG', jpeg: 'JPG', gif: 'GIF', webp: 'WebP', avif: 'AVIF', svg: 'SVG', bmp: 'BMP', ico: 'ICO', heic: 'HEIC', tiff: 'TIFF', pdf: 'PDF' };
  if (labels[kind]) return labels[kind];
  const ext = file.name.split('.').pop();
  return ext && ext !== file.name ? ext.toUpperCase() : 'Image';
}

function friendlyError(err, file) {
  if (err?.code !== 'too-large' && (err?.kind === 'heic' || /\.hei[cf]$/i.test(file.name))) {
    return `${err?.message || 'This HEIC file could not be converted.'} If it came from an iPhone, try exporting it again, or set Camera → Formats → Most Compatible for future photos.`;
  }
  return err?.message || 'This file could not be converted.';
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10485760 ? 2 : 1)} MB`;
}

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}
