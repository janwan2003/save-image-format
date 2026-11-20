// Saveform HEIC decoder worker. Decodes HEIC/HEIF photos with libheif (WebAssembly, vendored
// unmodified in ../vendor/libheif/) off the main thread, so the page stays responsive.
// Message in:  { id, buffer }            (ArrayBuffer of the file)
// Message out: { id, width, height, data } (RGBA ArrayBuffer, transferred) or { id, error }
// Nothing here makes a network request beyond loading the two library files from this site.
/* global libheif */
importScripts('../vendor/libheif/libheif.js');

const ready = new Promise((resolve, reject) => {
  const lib = libheif({
    locateFile: (file) => new URL(`../vendor/libheif/${file}`, self.location.href).href,
    // Initialisation can finish inside the factory call, before `lib` is assigned.
    onRuntimeInitialized: () => setTimeout(() => resolve(lib)),
  });
  if (lib && typeof lib.then === 'function') lib.catch(reject);
});

self.onmessage = async ({ data: { id, buffer } }) => {
  let images = [];
  try {
    const lib = await ready;
    const decoder = new lib.HeifDecoder();
    images = decoder.decode(new Uint8Array(buffer));
    if (!images.length) throw new Error('No image found in this HEIC file');
    // The primary image is the photo; others can be thumbnails or depth maps.
    const image = images.find((i) => i.is_primary()) || images[0];
    const width = image.get_width();
    const height = image.get_height();
    const rgba = await new Promise((resolve, reject) => {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (out) => {
        if (out) resolve(out.data); else reject(new Error('This HEIC file could not be decoded'));
      });
    });
    self.postMessage({ id, width, height, data: rgba.buffer }, [rgba.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  } finally {
    for (const i of images) i.free?.();
  }
};
