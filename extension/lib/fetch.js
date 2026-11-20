// Saveform: read an image's bytes from the address a page uses for it.
// Used by the background (menu clicks, batch saves). Needs the chrome.scripting API for the
// in-page fallback. No other network access.

export function errorWith(message, extra) { return Object.assign(new Error(message), extra); }

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

export function dataUrlToBlob(dataUrl) {
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

export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

