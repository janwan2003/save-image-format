export const DEFAULTS = {
  jpgQuality: 92,       // percent
  webpQuality: 90,
  avifQuality: 80,
  jpgBackground: '#ffffff',
  askWhere: true,       // show the Save As dialog
  svgMinSize: 1024,     // upscale small SVGs so the PNG is usable
  pdfPageSize: 'fit',   // 'fit' (page = image), 'a4' or 'letter'
  namePattern: '{name}', // see buildFilename() in filename.js
  subfolder: '',        // inside Downloads; '' = Downloads itself
};

export async function getSettings() {
  try {
    const s = await chrome.storage.sync.get(DEFAULTS);
    return { ...DEFAULTS, ...s };
  } catch {
    return { ...DEFAULTS };
  }
}

export function optionsFor(formatId, s) {
  const q = { jpg: s.jpgQuality, pdf: s.jpgQuality, webp: s.webpQuality, avif: s.avifQuality }[formatId];
  return { quality: q == null ? undefined : q / 100, background: s.jpgBackground, svgMinSize: s.svgMinSize, pageSize: s.pdfPageSize };
}
