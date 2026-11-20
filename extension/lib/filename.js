// Build a safe download filename from an image URL.
const KNOWN_EXT = /\.(png|jpe?g|jfif|pjpeg|gif|webp|avif|bmp|ico|svgz?|tiff?|heic|heif|jxl)$/i;

export function baseNameFromUrl(src, fallback = 'image') {
  let name = '';
  try {
    const u = new URL(src);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') {
      const parts = u.pathname.split('/').filter(Boolean);
      name = parts.length ? parts[parts.length - 1] : '';
      try { name = decodeURIComponent(name); } catch { /* keep raw */ }
    }
  } catch { /* not a URL */ }
  // Strip stacked image extensions too: CDNs often serve 'photo.jpg.webp'.
  while (KNOWN_EXT.test(name)) name = name.replace(KNOWN_EXT, '');
  // Names like "image.php" or "download" are not useful but still better than nothing.
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_')
    .replace(/\s+/g, ' ').replace(/^[.\s_]+|[.\s]+$/g, '');
  if (name.length > 100) name = name.slice(0, 100).replace(/[.\s]+$/g, '');
  // Windows reserved device names.
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name)) name = `${name}_`;
  return name || fallback;
}

export function targetFilename(src, ext, fallback = 'image') {
  return `${baseNameFromUrl(src, fallback)}.${ext}`;
}

// Characters that are invalid in a filename on Windows, macOS or Linux, plus control characters.
const BAD = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;
const pad = (n) => String(n).padStart(2, '0');

function siteFrom(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.hostname.replace(/^www\./, '');
  } catch { /* fall through */ }
  return '';
}

// Clean one path segment; returns '' for segments that must be dropped.
function cleanSegment(s) {
  s = String(s).replace(BAD, '_').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '');
  if (s.length > 100) s = s.slice(0, 100).replace(/[.\s]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `${s}_`;
  return s;
}

/**
 * Download path (relative to the Downloads folder) from the user's pattern and subfolder settings.
 * Pattern tokens: {name} (from the image URL), {site} (page host without www.), {date} (YYYY-MM-DD),
 * {time} (HH-MM-SS), {width}, {height}. Unknown tokens are left as typed (then sanitised).
 * The subfolder may contain "/" for nested folders; ".." and empty segments are dropped.
 */
export function buildFilename({ src, pageUrl = '', ext, pattern = '{name}', subfolder = '', now = new Date(), width = '', height = '' }) {
  const values = {
    name: baseNameFromUrl(src),
    site: siteFrom(pageUrl) || siteFrom(src),
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
    width: String(width), height: String(height),
  };
  const filled = String(pattern || '{name}').replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
  const base = cleanSegment(filled) || values.name;
  const folders = String(subfolder || '').split(/[\\/]+/).map(cleanSegment).filter((s) => s && s !== '..');
  return [...folders, `${base}.${ext}`].join('/');
}
