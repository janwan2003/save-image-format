// Saveform Photoshop decoder worker: runs psd.js (our own decoder) off the main thread and converts
// pixels with an embedded ICC profile (for example Adobe RGB documents) to sRGB with icc.js.
// Message in:  { id, buffer } → { id, width, height, data, colour, approximate }
//              (data is an RGBA ArrayBuffer, transferred) or { id, error }
/* global SaveformPsd, SaveformColor */
importScripts('./psd.js', './icc.js');

self.onmessage = async ({ data: { id, buffer } }) => {
  try {
    const { width, height, data, icc, approximate = false } = await SaveformPsd.decode(buffer);
    let colour = 'srgb';
    if (icc) {
      const profile = SaveformColor.parseIcc(icc);
      if (!profile) colour = 'unmanaged';
      else if (!SaveformColor.isSrgb(profile)) { SaveformColor.toSrgb(data, profile); colour = 'converted'; }
    }
    self.postMessage({ id, width, height, data: data.buffer, colour, approximate }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
