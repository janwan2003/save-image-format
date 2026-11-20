// Saveform background (Chrome: MV3 service worker; Firefox: event page).
// Flow: context-menu click -> fetch the image bytes -> convert locally -> download or copy.
import { FORMATS, convertBlob, canEncode } from './lib/convert.js';
import { targetFilename } from './lib/filename.js';
import { getSettings, optionsFor } from './lib/settings.js';

const PARENT = 'saveform';
const menuIds = [];

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  menuIds.length = 0;
  const create = (props) => { menuIds.push(props.id); chrome.contextMenus.create(props); };
  create({ id: PARENT, title: 'Save image as', contexts: ['image'] });
  for (const id of ['png', 'jpg', 'webp', 'avif']) {
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

chrome.action?.onClicked.addListener(() => chrome.runtime.openOptionsPage());

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'saveform:run-job' && sender.id === chrome.runtime.id) {
    runPendingJob(msg.id).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  return false;
});

export async function handleClick(info, tab) {
  const [action, fmt] = String(info.menuItemId).split(':');
  if ((action !== 'save' && action !== 'copy') || !FORMATS[fmt]) return { ok: false, error: 'unknown menu item' };
  const job = {
    action, fmt,
    src: info.srcUrl,
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
  const filename = targetFilename(job.src, fmt.ext);
  const downloadId = await saveBlob(out.blob, filename, settings.askWhere);
  return { ok: true, downloadId, filename, width: out.width, height: out.height, bytes: out.blob.size, type: out.blob.type };
}

// ---------- fetching ----------

function errorWith(message, extra) { return Object.assign(new Error(message), extra); }

export async function fetchImage(job) {
  const url = job.src;
  if (!url) throw errorWith('This image has no address Saveform can read.');
  if (url.startsWith('data:')) return dataUrlToBlob(url);
  if (url.startsWith('blob:')) return fetchInPage(job);
  let parsed;
  try { parsed = new URL(url); } catch { throw errorWith('This image address is not valid.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // file:// and others: only the page itself might be able to read it.
    return fetchInPage(job);
  }
  let status = 0;
  // 1. From the extension. Works when the server allows cross-site reads (many CDNs do),
  //    when the image is on the page's own site (activeTab), or when per-site access was granted.
  try {
    const r = await fetch(url, { cache: 'force-cache', credentials: 'include' });
    if (r.ok) return await r.blob();
    status = r.status;
  } catch { /* CORS refusal or network error; try the page next */ }
  try {
    const r = await fetch(url, { cache: 'force-cache' });
    if (r.ok) return await r.blob();
    status = r.status;
  } catch { /* fall through */ }
  // 2. From inside the page: same cookies and referrer as the page itself.
  try { return await fetchInPage(job); } catch { /* fall through */ }
  // 3. Ask for read access to just this image's site.
  const origin = `${parsed.origin}/*`;
  let granted = false;
  try { granted = await chrome.permissions.contains({ origins: [origin] }); } catch { /* ignore */ }
  if (!granted) throw errorWith('needs permission', { code: 'needs-permission', origin });
  throw errorWith(status ? `The image server refused the download (HTTP ${status}).` : 'The image could not be downloaded (network error).');
}

export async function fetchInPage(job) {
  if (job.tabId == null || job.tabId < 0) throw errorWith('No page to read the image from.');
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: job.tabId, frameIds: [job.frameId || 0] },
    func: pageFetchAsDataUrl,
    args: [job.src],
  });
  const r = res?.result;
  if (!r || !r.ok) throw errorWith(r?.error || 'The page could not read the image.');
  return dataUrlToBlob(r.dataUrl);
}

// Injected into the page. Must be self-contained.
async function pageFetchAsDataUrl(src) {
  try {
    const resp = await fetch(src, { credentials: 'include' });
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const blob = await resp.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    return { ok: true, dataUrl };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw errorWith('Malformed data URL.');
  const meta = dataUrl.slice(5, comma);
  const body = dataUrl.slice(comma + 1);
  const type = meta.split(';')[0] || 'application/octet-stream';
  if (/;base64/i.test(meta)) {
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }
  return new Blob([decodeURIComponent(body)], { type });
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
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
globalThis.saveform = { menuIds, canEncode, handleClick, runJob, fetchImage, convertAny, saveBlob };
