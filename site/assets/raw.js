// Camera RAW input (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PEF, ...) for the converter pages.
//
// We do not develop the sensor data. Every RAW format embeds a JPEG made by the camera (the same
// picture the camera shows on its screen); this module finds the largest one and decodes it with
// the browser. For Canon, Nikon, Pentax and iPhone files that JPEG is full size; some cameras
// (Sony ARW, Panasonic RW2, Pixel DNG) store a smaller one, and the page says which size it used.
//
// Search is format-agnostic: walk every JPEG start (FF D8 FF) in the file, parse its markers to
// the frame header, keep baseline/progressive frames (lossless SOF3 frames are the raw data
// itself), and take the one with the most pixels. Works for TIFF-based files, CR3 (ISO BMFF) and
// RAF alike. Pure functions here run in Node too (tests/raw.test.mjs).

/** File-name extensions of camera RAW formats whose header alone looks like a plain TIFF. */
export const RAW_EXTENSIONS = ['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'raw', 'rwl', 'pef', 'srw', 'erf', '3fr', 'fff', 'iiq', 'kdc', 'dcr', 'mos', 'mef', 'mrw', 'x3f'];

const ascii = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));

/**
 * True if these first bytes (≥ 64 is enough) and file name are a camera RAW file. Formats with
 * their own signature are found by it; NEF, ARW, PEF and friends are plain TIFF on the outside, so
 * for those the extension decides (or a DNGVersion tag in the first IFD).
 */
export function isRaw(head, name = '') {
  const b = head instanceof Uint8Array ? head : new Uint8Array(head);
  if (b.length < 16) return false;
  const tiffLE = b[0] === 0x49 && b[1] === 0x49, tiffBE = b[0] === 0x4d && b[1] === 0x4d;
  if (tiffLE && b[2] === 0x2a && b[3] === 0 && b[8] === 0x43 && b[9] === 0x52) return true; // CR2: "CR" after the header
  if (ascii(b, 4, 8) === 'ftypcrx ') return true; // CR3
  if (ascii(b, 0, 15) === 'FUJIFILMCCD-RAW') return true; // RAF
  if (ascii(b, 0, 4) === 'IIRO' || ascii(b, 0, 4) === 'IIRS' || ascii(b, 0, 4) === 'MMOR') return true; // Olympus ORF
  if (tiffLE && b[2] === 0x55 && b[3] === 0) return true; // Panasonic RW2 / RWL
  if (ascii(b, 0, 4) === 'FOVb' || ascii(b, 0, 4) === '\0MRM') return true; // Sigma X3F, Minolta MRW
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if ((tiffLE || tiffBE) && RAW_EXTENSIONS.includes(ext)) return true;
  if ((tiffLE || tiffBE) && ifdTag(b, 0xc612) != null) return true; // DNGVersion in IFD0 (a .tif-named DNG)
  return false;
}

// Value (first SHORT/LONG) of a tag in the TIFF IFD0 at `base`, or null. Bounds-checked.
function ifdTag(b, tag, base = 0) {
  if (base + 8 > b.length) return null;
  const le = b[base] === 0x49;
  const u16 = (i) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const u32 = (i) => (le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);
  const ifd = base + u32(base + 4);
  if (ifd + 2 > b.length) return null;
  const n = u16(ifd);
  for (let k = 0; k < n && k < 1000; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > b.length) return null;
    if (u16(e) === tag) return u16(e + 2) === 3 ? u16(e + 8) : u32(e + 8);
  }
  return null;
}

/**
 * EXIF orientation (1–8) that the RAW container records for the picture, or 1. Read from IFD0 of
 * TIFF-like files (incl. ORF/RW2 headers) and from CR3's CMT1 box (a TIFF IFD0).
 */
export function containerOrientation(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let base = -1;
  const sig = ascii(b, 0, 4);
  if (sig === 'II*\0' || sig === 'MM\0*' || sig === 'IIRO' || sig === 'IIRS' || sig === 'MMOR' || sig === 'IIU\0') base = 0;
  else if (ascii(b, 4, 8) === 'ftypcrx ') {
    const limit = Math.min(b.length - 12, 1 << 16);
    for (let i = 8; i < limit; i++) {
      if (b[i] === 0x43 && ascii(b, i, 4) === 'CMT1') { base = i + 4; break; }
    }
  }
  if (base < 0) return 1;
  const o = ifdTag(b, 0x112, base);
  return o >= 1 && o <= 8 ? o : 1;
}

/**
 * Every embedded baseline/progressive JPEG: [{ offset, length, width, height, orientation }],
 * where orientation is the JPEG's own EXIF orientation tag or 0 when it has none.
 */
export function findJpegs(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const found = [];
  let i = 0;
  while ((i = b.indexOf(0xff, i)) !== -1 && i + 4 < b.length) {
    if (b[i + 1] !== 0xd8 || b[i + 2] !== 0xff) { i++; continue; }
    const j = parseJpeg(b, i);
    if (!j) { i++; continue; }
    if (j.usable) found.push({ offset: i, length: j.end - i, width: j.width, height: j.height, orientation: j.orientation });
    i = j.end; // skip its body (nested EXIF thumbnails live inside APP1 and are skipped too)
  }
  return found;
}

// Parse one JPEG starting at SOI; null if the markers are not a valid JPEG.
function parseJpeg(b, start) {
  let p = start + 2, width = 0, height = 0, usable = false, sawFrame = false, orientation = 0;
  const u16 = (k) => (b[k] << 8) | b[k + 1];
  for (let guard = 0; guard < 100000; guard++) {
    if (p + 2 > b.length || b[p] !== 0xff) return null;
    let m = b[p + 1];
    while (m === 0xff && p + 2 < b.length) { p++; m = b[p + 1]; } // fill bytes
    if (m === 0xd9) return sawFrame ? { end: p + 2, width, height, usable, orientation } : null;
    if (p + 4 > b.length) return null;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    if (m < 0xc0) return null; // not a marker a JPEG may contain here
    const len = u16(p + 2);
    if (len < 2 || p + 2 + len > b.length) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 8) return null;
      height = u16(p + 5); width = u16(p + 7);
      const comps = b[p + 9];
      sawFrame = true;
      // SOF0/1/2 with 8-bit samples and 1 or 3 components: what browsers decode. SOF3 = lossless raw data.
      usable = (m === 0xc0 || m === 0xc1 || m === 0xc2) && b[p + 4] === 8 && (comps === 1 || comps === 3) && width > 0 && height > 0;
    } else if (m === 0xe1 && !orientation && ascii(b, p + 4, 6) === 'Exif\0\0') {
      const tiff = b.subarray(p + 10, p + 2 + len);
      orientation = ifdTag(tiff, 0x112) || 0;
    }
    p += 2 + len;
    if (m === 0xda) {
      if (!sawFrame) return null;
      // Entropy-coded data runs until a marker other than stuffing (FF 00) or a restart (FF D0-D7).
      for (;;) {
        p = b.indexOf(0xff, p);
        if (p < 0 || p + 1 >= b.length) return null;
        const n = b[p + 1];
        if (n === 0x00 || (n >= 0xd0 && n <= 0xd7) || n === 0xff) { p += n === 0xff ? 1 : 2; continue; }
        break;
      }
    }
  }
  return null;
}

/** The embedded JPEG with the most pixels, or null. */
export function largestJpeg(bytes) {
  let best = null;
  for (const j of findJpegs(bytes)) if (!best || j.width * j.height > best.width * best.height) best = j;
  return best;
}

/**
 * Decode a RAW Blob to { source, width, height, kind: 'raw', close, rawPreview }. The camera's
 * orientation is applied when the embedded JPEG does not carry its own.
 */
export async function decodeRaw(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const jpeg = largestJpeg(bytes);
  if (!jpeg) {
    throw Object.assign(new Error('This RAW file has no embedded JPEG preview that we can read, so it cannot be converted here.'), { code: 'decode-failed', kind: 'raw' });
  }
  const data = new Blob([bytes.subarray(jpeg.offset, jpeg.offset + jpeg.length)], { type: 'image/jpeg' });
  let bmp = await createImageBitmap(data); // applies the JPEG's own EXIF orientation
  const rot = jpeg.orientation > 1 ? 1 : containerOrientation(bytes);
  if (rot > 1) {
    const turned = await orient(bmp, rot);
    bmp.close();
    bmp = turned;
  }
  return { source: bmp, width: bmp.width, height: bmp.height, kind: 'raw', close: () => bmp.close(), rawPreview: { width: bmp.width, height: bmp.height } };
}

// Apply EXIF orientation 2–8 to a bitmap by drawing it on a canvas.
async function orient(bmp, o) {
  const swap = o >= 5;
  const w = swap ? bmp.height : bmp.width, h = swap ? bmp.width : bmp.height;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d');
  const W = bmp.width, H = bmp.height;
  // Standard EXIF transforms (maps stored pixels to the displayed picture).
  const t = { 2: [-1, 0, 0, 1, W, 0], 3: [-1, 0, 0, -1, W, H], 4: [1, 0, 0, -1, 0, H], 5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, H, 0], 7: [0, -1, -1, 0, H, W], 8: [0, -1, 1, 0, 0, W] }[o];
  g.setTransform(...t);
  g.drawImage(bmp, 0, 0);
  return createImageBitmap(c);
}
