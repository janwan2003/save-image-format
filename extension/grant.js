const id = new URLSearchParams(location.search).get('id');
const key = `job:${id}`;
const status = document.getElementById('status');
const stored = (await chrome.storage.session.get(key))[key];

if (!stored) {
  status.textContent = 'This request has expired. Right-click the image again.';
  for (const b of document.querySelectorAll('button:not(#cancel)')) b.disabled = true;
} else {
  document.getElementById('host').textContent = new URL(stored.origin.replace(/\/\*$/, '/')).host;
}

async function allow(origins) {
  status.className = 'status';
  status.textContent = 'Waiting for your browser…';
  let granted = false;
  try { granted = await chrome.permissions.request({ origins }); } catch (e) { status.textContent = e.message; }
  if (!granted) { status.textContent = 'Access was not granted, so the image was not saved.'; return; }
  status.textContent = 'Converting…';
  const res = await chrome.runtime.sendMessage({ type: 'saveform:run-job', id });
  if (res?.ok) { status.textContent = res.copied ? 'Copied.' : `Saved ${res.filename || ''}`; setTimeout(() => window.close(), 900); }
  else { status.className = 'status error'; status.textContent = res?.error || 'Something went wrong.'; }
}

document.getElementById('allow-site').addEventListener('click', () => allow([stored.origin]));
document.getElementById('allow-all').addEventListener('click', () => allow(['<all_urls>']));
document.getElementById('cancel').addEventListener('click', async () => { await chrome.storage.session.remove(key); window.close(); });
