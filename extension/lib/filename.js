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
