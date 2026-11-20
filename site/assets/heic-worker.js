// Saveform HEIC decoder worker. Decodes HEIC/HEIF photos with libheif (WebAssembly, vendored
// unmodified in ../vendor/libheif/) off the main thread, so the page stays responsive.
// Message in:  { id, buffer }            (ArrayBuffer of the file)
// Message out: { id, width, height, data, colour } (RGBA ArrayBuffer, transferred) or { id, error }
//   colour: 'srgb' (no conversion needed), 'converted' (wide gamut such as iPhone Display P3 → sRGB,
//   see icc.js) or 'unmanaged' (a profile we do not handle; pixels passed through unchanged).
// Nothing here makes a network request beyond loading the two library files from this site.
/* global libheif */
importScripts('../vendor/libheif/libheif.js', './icc.js');

const fourcc = (s) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;

// Read the colour profile attached to an image handle with libheif's C API. Functions returning
// `struct heif_error` take a pointer for it as their first argument (wasm32 C ABI).
function colourProfile(lib, image) {
  const handle = image.handle?.$$?.ptr;
  if (!handle || !lib._heif_image_handle_get_color_profile_type) return null;
  const type = lib._heif_image_handle_get_color_profile_type(handle) >>> 0;
  const err = lib._malloc(16);
  try {
    if (type === fourcc('prof') || type === fourcc('rICC')) {
      const size = lib._heif_image_handle_get_raw_color_profile_size(handle);
      if (!size) return null;
      const buf = lib._malloc(size);
      try {
        lib._heif_image_handle_get_raw_color_profile(err, handle, buf);
        if (lib.HEAP32[err >> 2] !== 0) return null;
        return SaveformColor.parseIcc(lib.HEAPU8.slice(buf, buf + size)) || 'unmanaged';
      } finally {
        lib._free(buf);
      }
    }
    if (type === fourcc('nclx')) {
      const out = lib._malloc(4);
      try {
        lib._heif_image_handle_get_nclx_color_profile(err, handle, out);
        if (lib.HEAP32[err >> 2] !== 0) return null;
        const nclx = lib.HEAP32[out >> 2];
        // struct heif_color_profile_nclx: uint8 version; enum primaries; enum transfer; ...
        const profile = SaveformColor.nclxProfile(lib.HEAP32[(nclx + 4) >> 2], lib.HEAP32[(nclx + 8) >> 2]);
        lib._heif_nclx_color_profile_free(nclx);
        return profile;
      } finally {
        lib._free(out);
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    lib._free(err);
  }
}

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
    let colour = 'srgb';
    const profile = colourProfile(lib, image);
    if (profile === 'unmanaged') colour = 'unmanaged';
    else if (profile && !SaveformColor.isSrgb(profile)) {
      SaveformColor.toSrgb(rgba, profile);
      colour = 'converted';
    }
    self.postMessage({ id, width, height, data: rgba.buffer, colour }, [rgba.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  } finally {
    for (const i of images) i.free?.();
  }
};
