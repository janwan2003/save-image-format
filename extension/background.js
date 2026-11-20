// Saveform background (Chrome: MV3 service worker; Firefox: event page).
// Flow: context-menu click -> fetch the image bytes -> convert locally -> download or copy.
import { FORMATS, convertBlob, canEncode, sniffType } from './lib/convert.js';
import { makePdf } from './lib/pdf.js';
import { makeZip } from './lib/zip.js';
import { collectPageImages } from './lib/collect.js';
import { buildFilename } from './lib/filename.js';
import { getSettings, optionsFor } from './lib/settings.js';
import { fetchImage, errorWith, dataUrlToBlob, blobToDataUrl } from './lib/fetch.js';

const PARENT = 'saveform';
const menuIds = [];

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  menuIds.length = 0;
  const create = (props) => { menuIds.push(props.id); chrome.contextMenus.create(props); };
  create({ id: PARENT, title: 'Save image as', contexts: ['image'] });
  for (const id of ['png', 'jpg', 'webp', 'avif', 'pdf']) {
    if (id !== 'png' && id !== 'jpg' && !(await canEncode(FORMATS[id].mime))) continue;
    create({ id: `save:${id}`, parentId: PARENT, title: FORMATS[id].label, contexts: ['image'] });
  }
  create({ id: 'sep', parentId: PARENT, type: 'separator', contexts: ['image'] });
  create({ id: 'copy:png', parentId: PARENT, title: 'Copy as PNG', contexts: ['image'] });
}

chrome.runtime.onInstalled.addListener(() => { buildMenus(); });
chrome.runtime.onStartup?.addListener(() => { buildMenus(); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleClick(info, tab);
});


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'saveform:run-job' && sender.id === chrome.runtime.id) {
    runPendingJob(msg.id).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.type === 'saveform:batch-start') { sendResponse(startBatch(msg.request)); return false; }
  if (msg?.type === 'saveform:batch-continue') { continueBatch({ skip: !!msg.skip }); sendResponse(batchState()); return false; }
  if (msg?.type === 'saveform:batch-get') { sendResponse(batchState()); return false; }
  return false;
});

export async function handleClick(info, tab) {
  const [action, fmt] = String(info.menuItemId).split(':');
  if ((action !== 'save' && action !== 'copy') || !FORMATS[fmt]) return { ok: false, error: 'unknown menu item' };
  const job = {
    action, fmt,
    src: info.srcUrl,
    pageUrl: info.pageUrl || tab?.url || '',
    tabId: tab?.id ?? -1,
    frameId: info.frameId ?? 0,
  };
  try {
    return await runJob(job, { allowGrant: true });
  } catch (e) {
    await notify(job.tabId, e.message || String(e), 'error');
    return { ok: false, error: e.message };
  }
}

export async function runJob(job, { allowGrant = false } = {}) {
  let blob;
  try {
    blob = await fetchImage(job);
  } catch (e) {
    if (e.code === 'needs-permission' && allowGrant) {
      await openGrantPage(job, e.origin);
      return { ok: false, pending: 'permission', origin: e.origin };
    }
    throw e;
  }
  const settings = await getSettings();
  const fmt = FORMATS[job.fmt];
  const out = await convertAny(blob, job.fmt, optionsFor(job.fmt, settings));
  if (job.action === 'copy') {
    await copyInPage(job, out.blob);
    await notify(job.tabId, 'Image copied as PNG');
    return { ok: true, copied: true, width: out.width, height: out.height };
  }
  const filename = buildFilename({
    src: job.src, pageUrl: job.pageUrl, ext: fmt.ext, pattern: settings.namePattern,
    subfolder: settings.subfolder, width: out.width, height: out.height,
  });
  const downloadId = await saveBlob(out.blob, filename, settings.askWhere);
  return { ok: true, downloadId, filename, width: out.width, height: out.height, bytes: out.blob.size, type: out.blob.type };
}

// ---------- converting ----------

export async function convertAny(blob, fmt, opts) {
  try {
    return await convertBlob(blob, fmt, opts);
  } catch (e) {
    if (e.code !== 'needs-dom' || !chrome.offscreen) throw e;
    return convertInOffscreen(blob, fmt, opts);
  }
}

async function convertInOffscreen(blob, fmt, opts) {
  const url = chrome.runtime.getURL('offscreen.html');
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
  if (!existing.length) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Render SVG images on a canvas so they can be saved as PNG, JPG or WebP.',
    });
  }
  const res = await chrome.runtime.sendMessage({ target: 'saveform-offscreen', type: 'convert', dataUrl: await blobToDataUrl(blob), fmt, opts });
  if (!res?.ok) throw errorWith(res?.error || 'Conversion failed.');
  return { blob: dataUrlToBlob(res.dataUrl), width: res.width, height: res.height, sourceKind: res.sourceKind };
}

// ---------- output ----------

export async function saveBlob(blob, filename, saveAs) {
  let url, revoke = null;
  if (typeof URL.createObjectURL === 'function') {
    url = URL.createObjectURL(blob);
    revoke = () => URL.revokeObjectURL(url);
  } else {
    url = await blobToDataUrl(blob); // Chrome service workers have no blob: URLs
  }
  try {
    return await chrome.downloads.download({ url, filename, saveAs: !!saveAs, conflictAction: 'uniquify' });
  } catch (e) {
    if (/cancel/i.test(e?.message || '')) return null; // user closed the Save dialog
    throw e;
  } finally {
    if (revoke) setTimeout(revoke, 120000);
  }
}

async function copyInPage(job, blob) {
  // Firefox: the background is an event page with clipboardWrite, so it can write directly.
  if (typeof document !== 'undefined' && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return;
    } catch { /* fall back to writing from the page */ }
  }
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: job.tabId, frameIds: [job.frameId || 0] },
    func: pageCopyPng,
    args: [await blobToDataUrl(blob)],
  });
  if (!res?.result?.ok) throw errorWith(`Could not copy to the clipboard: ${res?.result?.error || 'blocked by the browser'}`);
}

async function pageCopyPng(dataUrl) {
  try {
    const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    window.focus();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })]);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

async function notify(tabId, message, kind = 'info') {
  if (tabId == null || tabId < 0) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: pageToast, args: [message, kind] });
  } catch {
    // Pages such as the browser's own settings cannot be scripted; use the toolbar badge.
    try {
      await chrome.action.setBadgeText({ tabId, text: kind === 'error' ? '!' : 'ok' });
      await chrome.action.setTitle({ tabId, title: `Saveform: ${message}` });
    } catch { /* ignore */ }
  }
}

// Injected: a small self-removing notice in a closed shadow root, so page CSS cannot touch it.
function pageToast(message, kind) {
  const host = document.createElement('saveform-toast');
  const root = host.attachShadow({ mode: 'closed' });
  const box = document.createElement('div');
  box.textContent = `Saveform: ${message}`;
  box.setAttribute('role', 'status');
  box.style.cssText = [
    'position:fixed', 'z-index:2147483647', 'right:16px', 'bottom:16px', 'max-width:360px',
    'padding:10px 14px', 'border-radius:8px', 'font:14px/1.4 system-ui,sans-serif',
    'box-shadow:0 4px 16px rgba(0,0,0,.25)', 'color:#fff',
    `background:${kind === 'error' ? '#b42318' : '#1f2937'}`,
  ].join(';');
  root.appendChild(box);
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), kind === 'error' ? 6000 : 2500);
}

// ---------- save all images (toolbar popup) ----------
// The popup lists the page's images and sends the chosen ones here, so the work goes on
// even if the popup closes (it closes when it loses focus, e.g. when a download starts).
// Phase 1 fetches every image; if some sites refuse, the batch waits for the user to allow
// those sites (or skip them), so a ZIP or PDF still comes out as one file.

let batch = null;

function batchState() {
  if (!batch) return { status: 'idle' };
  const { id, status, total, fetched, done, saved, failed, origins, output, fmt, filename, error, downloadIds } = batch;
  return { id, status, total, fetched, done, saved, failed: failed.slice(0, 50), failedCount: failed.length, origins, output, fmt, filename, error, downloadIds };
}

function broadcast() {
  chrome.runtime.sendMessage({ type: 'saveform:batch-state', state: batchState() }).catch(() => { /* popup closed */ });
}

const EXT_OF = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', avif: 'avif', bmp: 'bmp', ico: 'ico', svg: 'svg', heic: 'heic', jxl: 'jxl' };

export function startBatch(request) {
  if (batch && (batch.status === 'fetching' || batch.status === 'saving')) return { ok: false, error: 'Saveform is still saving the previous set of images.' };
  const items = (request?.items || []).filter((it) => it && typeof it.src === 'string').slice(0, 500);
  if (!items.length) return { ok: false, error: 'No images selected.' };
  const output = ['files', 'zip', 'pdf'].includes(request.output) ? request.output : 'files';
  const fmt = request.fmt === 'original' || FORMATS[request.fmt] ? request.fmt : 'png';
  batch = {
    id: crypto.randomUUID(), status: 'fetching', items, output, fmt,
    tabId: request.tabId ?? -1, pageUrl: request.pageUrl || '',
    total: items.length, fetched: 0, done: 0, saved: 0, failed: [], origins: [], downloadIds: [], blobs: new Array(items.length), blocked: [],
  };
  runBatchFetch(batch).catch((e) => { batch.status = 'error'; batch.error = e.message; broadcast(); });
  return { ok: true, state: batchState() };
}

async function fetchOne(b, i) {
  const it = b.items[i];
  try {
    b.blobs[i] = await fetchImage({ src: it.src, pageUrl: b.pageUrl, tabId: b.tabId, frameId: 0 });
  } catch (e) {
    if (e.code === 'needs-permission') b.blocked.push({ i, origin: e.origin });
    else b.failed.push({ src: it.src, error: e.message });
  }
  b.fetched++;
  broadcast();
}

async function pool(indices, n, fn) {
  let next = 0;
  const worker = async () => { while (next < indices.length) await fn(indices[next++]); };
  await Promise.all(Array.from({ length: Math.min(n, indices.length) }, worker));
}

async function runBatchFetch(b) {
  await pool(b.items.map((_, i) => i), 4, (i) => fetchOne(b, i));
  if (b !== batch) return;
  if (b.blocked.length) {
    b.origins = [...new Set(b.blocked.map((x) => x.origin))];
    b.status = 'needs-permission';
    broadcast();
    return;
  }
  await finishBatch(b);
}

export async function continueBatch({ skip = false } = {}) {
  const b = batch;
  if (!b || b.status !== 'needs-permission') return;
  b.status = 'fetching';
  const blocked = b.blocked;
  b.blocked = [];
  b.origins = [];
  if (skip) {
    for (const x of blocked) b.failed.push({ src: b.items[x.i].src, error: 'Skipped: the site does not let extensions read its images.' });
  } else {
    b.fetched -= blocked.length;
    await pool(blocked.map((x) => x.i), 4, async (i) => {
      try { b.blobs[i] = await fetchImage({ src: b.items[i].src, pageUrl: b.pageUrl, tabId: b.tabId, frameId: 0 }); } catch (e) {
        b.failed.push({ src: b.items[i].src, error: e.code === 'needs-permission' ? 'No access to this site.' : e.message });
      }
      b.fetched++;
      broadcast();
    });
  }
  try { await finishBatch(b); } catch (e) { b.status = 'error'; b.error = e.message; broadcast(); }
}

// Firefox may close the popup while its permission prompt is open; continue from here then.
chrome.permissions?.onAdded?.addListener(async () => {
  const b = batch;
  if (!b || b.status !== 'needs-permission') return;
  const ok = await chrome.permissions.contains({ origins: b.origins }).catch(() => false);
  if (ok) continueBatch({ skip: false });
});

async function convertForBatch(blob, b, settings) {
  if (b.output === 'pdf') {
    const opts = optionsFor('pdf', settings);
    try {
      return await convertBlob(blob, 'pdf', opts);
    } catch (e) {
      if (e.code !== 'needs-dom') throw e;
      const png = await convertAny(blob, 'png', opts); // SVG: render in the offscreen document first
      return convertBlob(png.blob, 'pdf', opts);
    }
  }
  if (b.fmt === 'original') {
    const kind = sniffType(new Uint8Array(await blob.slice(0, 512).arrayBuffer()));
    const ext = EXT_OF[kind] || (blob.type.startsWith('image/') ? blob.type.slice(6).replace(/\+.*$/, '').replace('jpeg', 'jpg') : '');
    if (!ext) throw errorWith('This file is not an image.');
    return { blob, ext, width: '', height: '' };
  }
  return convertAny(blob, b.fmt, optionsFor(b.fmt, settings));
}

function uniqueName(name, taken) {
  if (!taken.has(name.toLowerCase())) { taken.add(name.toLowerCase()); return name; }
  const dot = name.lastIndexOf('.');
  for (let n = 2; ; n++) {
    const candidate = `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
    if (!taken.has(candidate.toLowerCase())) { taken.add(candidate.toLowerCase()); return candidate; }
  }
}

async function finishBatch(b) {
  b.status = 'saving';
  broadcast();
  const settings = await getSettings();
  const zipEntries = [];
  const pdfPages = [];
  const taken = new Set();
  for (let i = 0; i < b.items.length; i++) {
    const blob = b.blobs[i];
    if (!blob) continue;
    b.blobs[i] = null; // free memory as we go
    const it = b.items[i];
    try {
      const out = await convertForBatch(blob, b, settings);
      if (b.output === 'pdf') {
        pdfPages.push(out.pdfPage);
      } else {
        const ext = out.ext || FORMATS[b.fmt].ext;
        const common = { src: it.src, pageUrl: b.pageUrl, ext, pattern: settings.namePattern, width: out.width, height: out.height };
        if (b.output === 'zip') {
          zipEntries.push({ name: uniqueName(buildFilename(common), taken), data: new Uint8Array(await out.blob.arrayBuffer()) });
        } else {
          b.downloadIds.push(await saveBlob(out.blob, buildFilename({ ...common, subfolder: settings.subfolder }), false));
        }
      }
      b.saved++;
    } catch (e) {
      b.failed.push({ src: it.src, error: e.message || String(e) });
    }
    b.done++;
    broadcast();
  }
  if (b.output !== 'files' && b.saved) {
    const ext = b.output === 'zip' ? 'zip' : 'pdf';
    const blob = b.output === 'zip' ? makeZip(zipEntries) : makePdf(pdfPages, { pageSize: settings.pdfPageSize });
    b.filename = buildFilename({ src: b.pageUrl, pageUrl: b.pageUrl, ext, pattern: '{site} images {date}', subfolder: settings.subfolder });
    b.downloadIds.push(await saveBlob(blob, b.filename, settings.askWhere));
  }
  b.status = 'done';
  broadcast();
}

// ---------- per-site permission flow ----------

async function openGrantPage(job, origin) {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [`job:${id}`]: { job, origin, created: Date.now() } });
  const url = chrome.runtime.getURL(`grant.html?id=${encodeURIComponent(id)}`);
  try {
    await chrome.windows.create({ url, type: 'popup', width: 480, height: 380 });
  } catch {
    await chrome.tabs.create({ url });
  }
}

async function runPendingJob(id) {
  const key = `job:${id}`;
  const stored = (await chrome.storage.session.get(key))[key];
  if (!stored) return { ok: false, error: 'This request has expired. Right-click the image again.' };
  await chrome.storage.session.remove(key);
  try {
    return await runJob(stored.job, { allowGrant: false });
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Exposed for the automated tests (tests/extension.test.mjs). Not reachable by web pages.
globalThis.saveform = { menuIds, canEncode, handleClick, runJob, fetchImage, convertAny, saveBlob, startBatch, continueBatch, batchState, collectPageImages };
