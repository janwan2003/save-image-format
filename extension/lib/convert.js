// Saveform conversion core. Runs in an MV3 service worker (OffscreenCanvas),
// an extension page, a Firefox background page, or a normal web page.
// No network access happens here: it takes bytes in and gives bytes out.

export const FORMATS = {
  png: { id: 'png', mime: 'image/png', ext: 'png', label: 'PNG', lossy: false, opaque: false },
  jpg: { id: 'jpg', mime: 'image/jpeg', ext: 'jpg', label: 'JPG', lossy: true, opaque: true },
  webp: { id: 'webp', mime: 'image/webp', ext: 'webp', label: 'WebP', lossy: true, opaque: false },
  avif: { id: 'avif', mime: 'image/avif', ext: 'avif', label: 'AVIF', lossy: true, opaque: false },
};

/** Identify an image from its first bytes. Returns a short name or null. */
export function sniffType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (ascii(0, 4) === 'GIF8') return 'gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'webp';
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1') return 'heic';
  }
  if (at(0, 0x42, 0x4d)) return 'bmp';
  if (at(0, 0x00, 0x00, 0x01, 0x00)) return 'ico';
  if (at(0, 0xff, 0x0a) || ascii(4, 4) === 'JXL ') return 'jxl';
  const head = ascii(0, Math.min(b.length, 512)).replace(/^﻿/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg')) || head.includes('<svg')) return 'svg';
  return null;
}

/** True if this browser's canvas can encode the given MIME type. */
const encodeCache = new Map();
export async function canEncode(mime) {
  if (encodeCache.has(mime)) return encodeCache.get(mime);
  let ok = false;
  try {
    const c = makeCanvas(2, 2);
    const g = c.getContext('2d'); // convertToBlob throws on a canvas with no context
    g.fillStyle = '#808080'; g.fillRect(0, 0, 2, 2);
    const blob = await canvasToBlob(c, mime, 0.8);
    ok = !!blob && blob.type === mime;
  } catch { ok = false; }
  encodeCache.set(mime, ok);
  return ok;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Decode a Blob into something drawable. Returns { source, width, height, close }.
 * SVG needs a DOM (an <img>), so in a service worker it throws 'needs-dom'.
 */
export async function decode(blob, { svgMinSize = 0 } = {}) {
  const head = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
  const kind = sniffType(head) || (blob.type.includes('svg') ? 'svg' : null);
  if (kind === 'svg') {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      const e = new Error('SVG needs a DOM to render'); e.code = 'needs-dom'; throw e;
    }
    const svgBlob = blob.type === 'image/svg+xml' ? blob : new Blob([blob], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const img = new Image();
      img.decoding = 'sync';
      img.src = url;
      await img.decode();
      let w = img.naturalWidth || 300, h = img.naturalHeight || 150;
      if (svgMinSize && Math.max(w, h) < svgMinSize) {
        const s = svgMinSize / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s);
      }
      return { source: img, width: w, height: h, kind, close() {} };
    } finally {
      // keep URL alive until drawn: revoke on next tick
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
  }
  try {
    const bmp = await createImageBitmap(blob);
    return { source: bmp, width: bmp.width, height: bmp.height, kind, close: () => bmp.close && bmp.close() };
  } catch (err) {
    const e = new Error(kind ? `This browser cannot decode ${kind.toUpperCase()} images` : 'This file is not an image the browser can decode');
    e.code = 'decode-failed'; e.kind = kind; throw e;
  }
}

/**
 * Convert a Blob to the target format id ('png' | 'jpg' | 'webp' | 'avif').
 * options: quality (0..1, lossy formats), background (CSS color for JPG), svgMinSize.
 * Returns { blob, width, height, sourceKind }.
 */
export async function convertBlob(input, formatId, options = {}) {
  const fmt = FORMATS[formatId];
  if (!fmt) throw new Error(`Unknown format ${formatId}`);
  const quality = fmt.lossy ? clamp(options.quality ?? (formatId === 'jpg' ? 0.92 : 0.9), 0.01, 1) : undefined;
  const img = await decode(input, options);
  try {
    const canvas = makeCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    if (fmt.opaque) {
      ctx.fillStyle = options.background || '#ffffff';
      ctx.fillRect(0, 0, img.width, img.height);
    }
    ctx.drawImage(img.source, 0, 0, img.width, img.height);
    const blob = await canvasToBlob(canvas, fmt.mime, quality);
    if (!blob) throw new Error('The browser could not encode the image');
    if (blob.type !== fmt.mime) {
      const e = new Error(`This browser cannot create ${fmt.label} files`);
      e.code = 'encode-unsupported'; throw e;
    }
    return { blob, width: img.width, height: img.height, sourceKind: img.kind };
  } finally {
    img.close();
  }
}

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, Number(x))); }
