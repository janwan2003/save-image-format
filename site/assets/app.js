// Saveform converter page. Uses the same conversion engine as the extension
// (lib/convert.js, copied from extension/lib at build time). Nothing here makes
// a network request: files are read, converted and offered for download locally.
import { FORMATS, canEncode, convertBlob, decode, sniffType } from '../lib/convert.js';
import { makePdf } from '../lib/pdf.js';
import { baseNameFromUrl } from '../lib/filename.js';
import { makeZip } from '../lib/zip.js';

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
  const downloadPdf = $('#download-pdf');
  const formatNote = $('#format-note');
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
  });

  function syncControls() {
    const fmt = FORMATS[formatSel.value];
    const keeping = !!keepJpeg?.checked && fmt.id === 'jpg';
    if (keepJpegCtl) keepJpegCtl.hidden = fmt.id !== 'jpg';
    qualityCtl.hidden = !fmt.lossy || keeping;
    bgCtl.hidden = !fmt.opaque || keeping;
    pageSizeCtl.hidden = fmt.id !== 'pdf';
    icoCtl.hidden = fmt.id !== 'ico';
    downloadPdf.hidden = fmt.id !== 'pdf';
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
      if (!(await canEncode(fmt.mime))) {
        opt.disabled = true;
        opt.textContent = `${fmt.label} (not available in this browser)`;
        unsupported.push(fmt.label);
      }
    }
    // The note matters on the general converter, or when this page's own format is unavailable;
    // elsewhere the disabled option's label already says so.
    const wantedLabel = FORMATS[formatSel.value].label;
    if (unsupported.length && (root.hasAttribute('data-general') || unsupported.includes(wantedLabel))) {
      const wanted = FORMATS[formatSel.value];
      let msg = `This browser cannot create ${unsupported.join(' or ')} files from a web page, so ${unsupported.length > 1 ? 'those options are' : 'that option is'} switched off.`;
      if (unsupported.includes(wanted.label)) {
        const fallback = [...formatSel.options].find((o) => !o.disabled);
        if (fallback) formatSel.value = fallback.value;
        msg += ` Output is set to ${FORMATS[formatSel.value].label} instead; a current version of Chrome, Edge or Firefox can create ${wanted.label}.`;
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
  bg.addEventListener('input', () => settingsChanged(300));
  svgSize?.addEventListener('change', () => settingsChanged());

  // ---- adding files -------------------------------------------------------
  function addFiles(files) {
    const added = [];
    for (const file of files) {
      if (!file || !file.size) continue;
      const item = { id: nextId++, file, state: 'queued', result: null, error: null, row: null };
      items.push(item);
      item.row = makeRow(item);
      list.append(item.row.li);
      added.push(item);
    }
    added.forEach(enqueue);
    updateBar();
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
        const r = opts.keepJpeg ? await keepJpegBytes(item.file) : await convertBlob(item.file, opts.format, opts);
        if (item.removed) continue;
        revoke(item);
        item.result = { ...r, format: opts.format, url: URL.createObjectURL(r.blob), name: outputName(item.file.name, opts.format) };
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
  }

  function forget(item) {
    item.removed = true;
    revoke(item);
    if (item.preview) URL.revokeObjectURL(item.preview);
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
    up.setAttribute('aria-label', `Move ${item.file.name} up`);
    const down = el('button', 'btn-icon move');
    down.type = 'button'; down.textContent = '↓'; down.title = 'Move down';
    down.setAttribute('aria-label', `Move ${item.file.name} down`);
    up.addEventListener('click', () => move(item, -1));
    down.addEventListener('click', () => move(item, 1));
    const remove = el('button', 'btn-icon');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Remove ${item.file.name}`);
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

  // Page order for "Download one PDF" is the list order.
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
    name.textContent = r ? r.name : item.file.name;
    name.title = item.file.name;
    if (item.state === 'done' && r) {
      // A PDF cannot be shown in an <img>, so its row previews the source image.
      thumb.src = r.format === 'pdf' ? (item.preview ||= URL.createObjectURL(item.file)) : r.url;
      const before = item.file.size, after = r.blob.size;
      const pct = Math.round(((after - before) / before) * 100);
      meta.replaceChildren(
        `${kindLabel(r.sourceKind, item.file)} ${fmtBytes(before)} → ${FORMATS[r.format].label} ${fmtBytes(after)} `,
        r.kept ? '(original JPEG data kept)' : Object.assign(el('span', pct < 0 ? 'smaller' : 'larger'), { textContent: `(${pct > 0 ? '+' : pct < 0 ? '−' : '±'}${Math.abs(pct)}%)` }),
        ` · ${r.width} × ${r.height} px`,
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
      saveFile(makeZip(entries), `saveform-${settings().format}-images.zip`);
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

  clearBtn.addEventListener('click', () => {
    for (const item of items) forget(item);
    items.length = 0;
    queue.length = 0;
    list.replaceChildren();
    updateBar();
    fileInput.focus();
  });

  syncControls();
  checkEncoders().finally(() => { root.dataset.ready = '1'; });
}

// ---- helpers --------------------------------------------------------------
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
  const labels = { png: 'PNG', jpeg: 'JPG', gif: 'GIF', webp: 'WebP', avif: 'AVIF', svg: 'SVG', bmp: 'BMP', ico: 'ICO' };
  if (labels[kind]) return labels[kind];
  const ext = file.name.split('.').pop();
  return ext && ext !== file.name ? ext.toUpperCase() : 'Image';
}

function friendlyError(err, file) {
  if (err?.kind === 'heic' || /\.hei[cf]$/i.test(file.name)) {
    return 'HEIC/HEIF photos cannot be decoded by this browser. On an iPhone, set Camera → Formats → Most Compatible, or export the photo as JPG.';
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
