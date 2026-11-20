// Tiny synthetic camera RAW containers for the RAW tests. Real RAW files are 15–60 MB, so the
// tests wrap two small real JPEGs (made by ImageMagick, tests/fixtures/raw/) in the container
// structures our reader relies on: a TIFF IFD0 with an Orientation tag (CR2/NEF/ARW/DNG/ORF/RW2),
// Canon CR3's ISO-BMFF boxes with a CMT1 TIFF block, and Fujifilm RAF's text header. Each also
// holds a larger lossless (SOF3) JPEG, standing in for the sensor data that must be skipped.
import { readFileSync } from 'node:fs';

const DIR = new URL('./fixtures/raw/', import.meta.url);
export const PREVIEW = new Uint8Array(readFileSync(new URL('preview-64x48.jpg', DIR))); // red|lime / blue|white quadrants
export const PROGRESSIVE = new Uint8Array(readFileSync(new URL('preview-progressive.jpg', DIR)));
export const THUMB = new Uint8Array(readFileSync(new URL('thumb-16x12.jpg', DIR))); // 16×12 grey

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const str = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const be32 = (n) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

// TIFF header + IFD0 holding just Orientation (and CR2's "CR" marker), little- or big-endian.
function tiffHeader({ le = true, orientation = 1, cr2 = false } = {}) {
  const b = new Uint8Array(cr2 ? 34 : 26);
  const dv = new DataView(b.buffer);
  b.set(str(le ? 'II' : 'MM'));
  dv.setUint16(2, 42, le);
  const ifd = cr2 ? 16 : 8;
  dv.setUint32(4, ifd, le);
  if (cr2) b.set(str('CR'), 8), (b[10] = 2);
  dv.setUint16(ifd, 1, le); // one entry
  dv.setUint16(ifd + 2, 0x112, le); dv.setUint16(ifd + 4, 3, le); dv.setUint32(ifd + 6, 1, le); dv.setUint16(ifd + 10, orientation, le);
  dv.setUint32(ifd + 14, 0, le); // no next IFD
  return b;
}

/** A lossless (SOF3) JPEG frame like the sensor data in CR2/DNG: valid markers, not displayable. */
export function losslessJpeg(width = 4000, height = 3000, bytes = 4096) {
  const sof = [0xff, 0xc3, 0, 11, 14, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0];
  const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 1, 0, 0];
  const data = [];
  let x = 12345;
  for (let i = 0; i < bytes; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    const v = (x >>> 16) & 255;
    data.push(v);
    if (v === 0xff) data.push(0); // byte stuffing
  }
  return new Uint8Array([0xff, 0xd8, ...sof, ...sos, ...data, 0xff, 0xd9]);
}

/** Insert an EXIF APP1 segment with this orientation right after a JPEG's SOI. */
export function withExifOrientation(jpeg, orientation) {
  const tiff = tiffHeader({ le: false, orientation });
  const app1 = cat(new Uint8Array([0xff, 0xe1, (tiff.length + 8) >> 8, (tiff.length + 8) & 255]), str('Exif\0\0'), tiff);
  return cat(jpeg.subarray(0, 2), app1, jpeg.subarray(2));
}

/** TIFF-based RAW (NEF/ARW/DNG-like; CR2 with cr2: true): header, thumbnail, sensor data, preview. */
export function tiffRaw({ le = true, orientation = 1, cr2 = false, preview = PREVIEW, junk = true } = {}) {
  // Random bytes with a stray FF D8 FF that is not a JPEG, as found inside real sensor data.
  const stray = junk ? new Uint8Array([0x00, 0xff, 0xd8, 0xff, 0x12, 0x34, 0xff, 0xd8, 0x00]) : new Uint8Array();
  return cat(tiffHeader({ le, orientation, cr2 }), THUMB, stray, losslessJpeg(), preview ? preview : new Uint8Array());
}

/** Canon CR3-like file: ftyp "crx ", a moov box holding CMT1 (TIFF IFD0 with Orientation), mdat. */
export function cr3({ orientation = 1, preview = PREVIEW } = {}) {
  const box = (type, ...body) => { const b = cat(...body); return cat(be32(b.length + 8), str(type), b); };
  const ftyp = box('ftyp', str('crx '), be32(1), str('crx isom'));
  const moov = box('moov', box('uuid', new Uint8Array(16), box('CMT1', tiffHeader({ orientation }))));
  return cat(ftyp, moov, box('mdat', THUMB, preview, losslessJpeg(6000, 4000)));
}

/** Fujifilm RAF-like file: text header, then the embedded JPEG (with its own EXIF), then sensor data. */
export function raf({ preview = withExifOrientation(PREVIEW, 1) } = {}) {
  const header = new Uint8Array(148);
  header.set(str('FUJIFILMCCD-RAW 0201FF383501'));
  return cat(header, preview, new Uint8Array(512));
}
