// Toolbar popup: list the images on the current page and save the chosen ones.
// The page is read only now, after the user clicked the toolbar button (activeTab).
// Saving runs in the background script so it survives the popup closing.
import { collectPageImages } from './lib/collect.js';
import { canEncode } from './lib/convert.js';
import { getSettings } from './lib/settings.js';

const $ = (id) => document.getElementById(id);
const message = (text) => { $('message').textContent = text; };
let images = [];
let tab = null;
let pageUrl = '';

$('settings').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); window.close(); });

const settings = await getSettings();
if (!(await canEncode('image/avif'))) $('avifOption').remove();
$('format').value = settings.batchFormat;
if (!$('format').value) $('format').value = 'png';
$('output').value = settings.batchOutput;
$('minSize').value = String(settings.batchMinSize);
if (!$('minSize').value) $('minSize').value = '100';
syncFormat();

const remember = (key, value) => chrome.storage.sync.set({ [key]: value }).catch(() => {});
$('format').addEventListener('change', () => remember('batchFormat', $('format').value));
$('output').addEventListener('change', () => { remember('batchOutput', $('output').value); syncFormat(); });
$('minSize').addEventListener('change', () => { remember('batchMinSize', Number($('minSize').value)); render(); });

function syncFormat() { $('format').disabled = $('output').value === 'pdf'; }

// ---------- reading the page ----------

async function load() {
  // ?tabId= lets the automated tests open this page in a normal tab (tests/batch.test.mjs).
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  if (forced) tab = await chrome.tabs.get(forced).catch(() => null);
  else [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { message('No tab to read.'); return; }
  let result;
  try {
    [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageImages });
  } catch {
    message('Saveform cannot read this page. Browsers do not let extensions into their own pages (settings, new tab, extension stores). Open a normal web page and click the button again.');
    return;
  }
  pageUrl = result.url || tab.url || '';
  images = result.images || [];
  if (!images.length) { message('No images found on this page.'); return; }
  $('picker').hidden = false;
  render();
}

function visible() {
  const min = Number($('minSize').value) || 0;
  // Unknown size (0): not loaded yet or a CSS background; keep it so nothing is hidden by mistake.
  return images.filter((im) => !min || (!im.width && !im.height) || Math.max(im.width, im.height) >= min);
}

function render() {
  const list = visible();
  const grid = $('grid');
  grid.replaceChildren();
  for (const im of list) {
    if (im.checked === undefined) im.checked = true;
    const li = document.createElement('li');
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = im.checked;
    box.addEventListener('change', () => { im.checked = box.checked; updateCount(); });
    const thumb = document.createElement('span');
    thumb.className = 'thumb';
    if (im.src.startsWith('blob:')) {
      const t = document.createElement('span'); t.textContent = 'preview not available'; thumb.append(t);
    } else {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.alt = im.alt || '';
      img.src = im.src;
      img.addEventListener('error', () => { const t = document.createElement('span'); t.textContent = 'no preview'; img.replaceWith(t); });
      thumb.append(img);
    }
    const meta = document.createElement('span');
    meta.className = 'meta';
    const size = im.width && im.height ? `${im.width}×${im.height}` : '';
    meta.textContent = [size, im.kind === 'background' ? 'background' : im.kind === 'poster' ? 'video poster' : '', nameOf(im.src)].filter(Boolean).join(' · ');
    meta.title = im.src.startsWith('data:') ? 'embedded image' : im.src;
    label.append(box, thumb, meta);
    li.append(label);
    grid.append(li);
  }
  updateCount();
}

function nameOf(src) {
  if (src.startsWith('data:')) return 'embedded';
  try { return decodeURIComponent(new URL(src).pathname.split('/').filter(Boolean).pop() || new URL(src).host); } catch { return ''; }
}

function selected() { return visible().filter((im) => im.checked); }

function updateCount() {
  const list = visible();
  const n = selected().length;
  $('count').textContent = `${n} of ${list.length} selected`;
  $('toggleAll').textContent = n ? 'Select none' : 'Select all';
  $('save').disabled = !n;
  $('save').textContent = n === 1 ? 'Save 1 image' : `Save ${n} images`;
  const hidden = images.length - list.length;
  message(hidden ? `${hidden} smaller image${hidden === 1 ? ' is' : 's are'} hidden.` : '');
}

$('toggleAll').addEventListener('click', () => {
  const on = !selected().length;
  for (const im of visible()) im.checked = on;
  render();
});

// ---------- saving (in the background) ----------

$('save').addEventListener('click', async () => {
  const items = selected().map(({ src, width, height }) => ({ src, width, height }));
  const res = await chrome.runtime.sendMessage({
    type: 'saveform:batch-start',
    request: { items, fmt: $('format').value, output: $('output').value, tabId: tab.id, pageUrl },
  });
  if (!res?.ok) { message(res?.error || 'Could not start.'); return; }
  showProgress(res.state);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'saveform:batch-state') showProgress(msg.state);
});

$('allow').addEventListener('click', async () => {
  const origins = [...$('origins').children].map((li) => li.dataset.origin);
  let granted = false;
  try { granted = await chrome.permissions.request({ origins }); } catch (e) { $('progressText').textContent = e.message; }
  if (!granted) { $('progressText').textContent = 'Access was not granted. Allow it, or skip those images.'; return; }
  showProgress(await chrome.runtime.sendMessage({ type: 'saveform:batch-continue', skip: false }));
});
$('skip').addEventListener('click', async () => {
  showProgress(await chrome.runtime.sendMessage({ type: 'saveform:batch-continue', skip: true }));
});
$('again').addEventListener('click', () => {
  $('progress').hidden = true;
  if (images.length) $('picker').hidden = false; else load();
});

function showProgress(s) {
  if (!s || s.status === 'idle') return;
  $('picker').hidden = true;
  message('');
  $('progress').hidden = false;
  const fetching = s.status === 'fetching';
  $('bar').max = s.total || 1;
  $('bar').value = fetching ? s.fetched : s.status === 'saving' ? s.done : s.total;
  const host = (o) => o.replace(/^\w+:\/\//, '').replace(/\/\*$/, '');
  $('permission').hidden = s.status !== 'needs-permission';
  $('doneRow').hidden = s.status !== 'done' && s.status !== 'error';
  let text = '';
  if (fetching) text = `Reading images: ${s.fetched} of ${s.total}…`;
  else if (s.status === 'needs-permission') text = 'Some images could not be read yet.';
  else if (s.status === 'saving') text = `Converting and saving: ${s.done} of ${s.total}…`;
  else if (s.status === 'error') text = `Something went wrong: ${s.error}`;
  else if (s.status === 'done') {
    const what = s.output === 'zip' ? 'into one ZIP file' : s.output === 'pdf' ? 'into one PDF' : 'as separate files';
    text = s.saved ? `Saved ${s.saved} of ${s.total} image${s.total === 1 ? '' : 's'} ${what}${s.filename ? ` (${s.filename})` : ''}.` : 'No images could be saved.';
  }
  $('progressText').textContent = text;
  if (s.status === 'needs-permission') {
    $('origins').replaceChildren(...s.origins.map((o) => {
      const li = document.createElement('li'); li.dataset.origin = o; li.textContent = host(o); return li;
    }));
  }
  const failed = s.failedCount || 0;
  $('failures').hidden = !failed || (s.status !== 'done' && s.status !== 'error');
  if (failed) {
    $('failures').querySelector('summary').textContent = `${failed} not saved`;
    $('failList').replaceChildren(...s.failed.map((f) => {
      const li = document.createElement('li'); li.textContent = `${f.src.startsWith('data:') ? 'embedded image' : f.src}: ${f.error}`; return li;
    }));
  }
}

// Reopened while a batch is still running (or waiting for permission)? Show it.
const current = await chrome.runtime.sendMessage({ type: 'saveform:batch-get' }).catch(() => null);
if (current && (current.status === 'fetching' || current.status === 'saving' || current.status === 'needs-permission')) {
  showProgress(current);
  load().then(() => { $('picker').hidden = true; });
} else {
  load();
}
