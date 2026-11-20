// Saveform TIFF decoder worker: runs tiff.js (our own decoder) off the main thread and converts
// pixels with an embedded ICC profile (for example Adobe RGB scans) to sRGB with icc.js.
// Message in:  { id, buffer, page }                → { id, width, height, data, pages, colour }
//              { id, buffer, countPages: true }    → { id, pages }
//              (data is an RGBA ArrayBuffer, transferred) or { id, error }
/* global SaveformTiff, SaveformColor */
importScripts('./tiff.js', './icc.js');

self.onmessage = async ({ data: { id, buffer, page = 0, countPages } }) => {
  try {
    const pages = SaveformTiff.pages(buffer);
    if (countPages) { self.postMessage({ id, pages }); return; }
    const { width, height, data, icc } = await SaveformTiff.decode(buffer, page);
    let colour = 'srgb';
    if (icc) {
      const profile = SaveformColor.parseIcc(icc);
      if (!profile) colour = 'unmanaged';
      else if (!SaveformColor.isSrgb(profile)) { SaveformColor.toSrgb(data, profile); colour = 'converted'; }
    }
    self.postMessage({ id, width, height, data: data.buffer, pages, colour }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
