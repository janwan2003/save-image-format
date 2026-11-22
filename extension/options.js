import { DEFAULTS, getSettings } from './lib/settings.js';
import { canEncode } from './lib/convert.js';

const s = await getSettings();
const status = document.getElementById('status');
document.getElementById('version').textContent = chrome.runtime.getManifest().version;

function flash(text) { status.textContent = text; clearTimeout(flash.t); flash.t = setTimeout(() => { status.textContent = ''; }, 1500); }

for (const key of Object.keys(DEFAULTS)) {
  const el = document.getElementById(key);
  if (!el) continue;
  const out = document.querySelector(`output[for="${key}"]`);
  if (el.type === 'checkbox') el.checked = !!s[key]; else el.value = s[key];
  if (out) out.textContent = `${el.value}%`;
  el.addEventListener('input', () => { if (out) out.textContent = `${el.value}%`; });
  el.addEventListener('change', async () => {
    const v = el.type === 'checkbox' ? el.checked : (el.type === 'color' || el.type === 'text' || el.tagName === 'SELECT') ? el.value : Number(el.value);
    await chrome.storage.sync.set({ [key]: v });
    flash('Saved');
  });
}

async function renderSites() {
  const list = document.getElementById('sites');
  const { origins = [] } = await chrome.permissions.getAll();
  list.replaceChildren();
  if (!origins.length) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'None yet. Saveform asks the first time a site blocks it.'; list.append(li); return;
  }
  for (const o of origins) {
    const li = document.createElement('li');
    const name = document.createElement('code');
    name.textContent = o === '<all_urls>' ? 'All sites' : o.replace(/\/\*$/, '');
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => { await chrome.permissions.remove({ origins: [o] }); renderSites(); flash('Removed'); });
    li.append(name, btn);
    list.append(li);
  }
}
renderSites();
// Chrome's canvas cannot write AVIF yet; only show the setting where the menu offers AVIF.
if (!(await canEncode('image/avif'))) document.getElementById('avifRow').hidden = true;
