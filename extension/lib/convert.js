// Saveform conversion core. Runs in an MV3 service worker (OffscreenCanvas),
// an extension page, a Firefox background page, or a normal web page.
// No network access happens here: it takes bytes in and gives bytes out.
import { makePdf, pageFromCanvas } from './pdf.js';
import { encodeGif } from './gif.js';
import { makeTiff, tiffPage } from './tiff-write.js';
import { encodePng8 } from './png-quant.js';

export const FORMATS = {
  png: { id: 'png', mime: 'image/png', ext: 'png', label: 'PNG', lossy: false, opaque: false },
  jpg: { id: 'jpg', mime: 'image/jpeg', ext: 'jpg', label: 'JPG', lossy: true, opaque: true },
  webp: { id: 'webp', mime: 'image/webp', ext: 'webp', label: 'WebP', lossy: true, opaque: false },
  avif: { id: 'avif', mime: 'image/avif', ext: 'avif', label: 'AVIF', lossy: true, opaque: false },
  // Containers: the canvas encodes JPEG/PNG and Saveform wraps the result itself.
  pdf: { id: 'pdf', mime: 'application/pdf', ext: 'pdf', label: 'PDF', lossy: true, opaque: true, canvasMime: 'image/jpeg' },
  ico: { id: 'ico', mime: 'image/x-icon', ext: 'ico', label: 'ICO', lossy: false, opaque: false, canvasMime: 'image/png' },
  // Written entirely by Saveform (lib/gif.js) from the canvas pixels, so every browser can make it.
  // Not "lossy" in the quality-slider sense: the loss is the 256-colour palette, set by `dither`.
  gif: { id: 'gif', mime: 'image/gif', ext: 'gif', label: 'GIF', lossy: false, opaque: false, ownEncoder: true },
  // Lossless, written by lib/tiff-write.js (LZW or uncompressed; 1-bit, grey, RGB or RGBA as the pixels need).
  tiff: { id: 'tiff', mime: 'image/tiff', ext: 'tif', label: 'TIFF', lossy: false, opaque: false, ownEncoder: true },
};

/** Icon sizes written into an ICO file (each as an embedded PNG). */
export const ICO_SIZES = [16, 32, 48, 256];

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
    // Major brand, then the compatible brands listed after the minor version (box size from bytes 0-3).
    const size = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0);
    const brands = [ascii(8, 4)];
    for (let i = 16; i + 4 <= size; i += 4) brands.push(ascii(i, 4));
    if (brands.some((x) => x === 'avif' || x === 'avis')) return 'avif';
    if (brands.some((x) => ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(x))) return 'heic';
  }
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a) || at(0, 0x49, 0x49, 0x2b, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2b)) return 'tiff';
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
  if (Object.values(FORMATS).some((f) => f.mime === mime && f.ownEncoder)) return true;
  const container = Object.values(FORMATS).find((f) => f.mime === mime && f.canvasMime);
  if (container) return canEncode(container.canvasMime);
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
 * Decode a Blob into something drawable. Returns { source, width, height, kind, close }.
 * SVG needs a DOM (an <img>), so in a service worker it throws 'needs-dom'.
 * `fallbackDecoders` maps a sniffed kind to an async (blob) => same shape, tried when the
 * browser cannot decode it natively (the site uses this for HEIC and TIFF; the extension passes
 * none). `preferFallback` skips the browser's own decoder (a TIFF page other than the first).
 */
export async function decode(blob, { svgMinSize = 0, fallbackDecoders = null, preferFallback = false } = {}) {
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
  if (preferFallback && kind && fallbackDecoders?.[kind]) return fallbackDecoders[kind](blob);
  try {
    const bmp = await createImageBitmap(blob);
    return { source: bmp, width: bmp.width, height: bmp.height, kind, close: () => bmp.close && bmp.close() };
  } catch (err) {
    const fallback = kind && fallbackDecoders?.[kind];
    if (fallback) return fallback(blob);
    const e = new Error(kind ? `This browser cannot decode ${kind.toUpperCase()} images` : 'This file is not an image the browser can decode');
    e.code = 'decode-failed'; e.kind = kind; throw e;
  }
}

/**
 * Convert a Blob to the target format id ('png' | 'jpg' | 'webp' | 'avif' | 'pdf' | 'ico' | 'gif' | 'tiff').
 * options: quality (0..1, lossy formats; PDF at 1 = lossless), background (CSS color for
 * JPG/PDF), svgMinSize, pageSize ('fit' | 'a4' | 'letter', PDF), icoSizes (ICO),
 * dither (GIF, default true: Floyd–Steinberg when the image has more than 256 colours),
 * tiffCompression ('lzw' default | 'none'), preview (PDF/TIFF: also return a small PNG `preview`),
 * resize ({ mode: 'percent' | 'fit' | 'exact', width, height, percent }, see outputSize; not ICO),
 * targetBytes (JPG/WebP/AVIF/PNG: the best result of at most this many bytes, see fitToBytes),
 * pngColors (PNG: 0 = lossless, else a palette PNG with at most this many colours).
 * Results also carry sourceWidth/sourceHeight, resized, and with targetBytes: targetMet, quality or colors.
 * Returns { blob, width, height, sourceKind } and, for PDF, pdfPage / for TIFF, tiffPage (to combine pages later).
 */
const WEBP_MAX = 16383;

export async function convertBlob(input, formatId, options = {}) {
  const fmt = FORMATS[formatId];
  if (!fmt) throw new Error(`Unknown format ${formatId}`);
  const quality = fmt.lossy ? clamp(options.quality ?? (formatId === 'jpg' || formatId === 'pdf' ? 0.92 : 0.9), 0.01, 1) : undefined;
  const img = await decode(input, options);
  try {
    const out = formatId === 'ico' ? { width: img.width, height: img.height } : outputSize(img.width, img.height, options.resize);
    const resized = out.width !== img.width || out.height !== img.height;
    // The WebP format stores width and height in 14 bits; Chromium crops larger canvases silently.
    if (formatId === 'webp' && Math.max(out.width, out.height) > WEBP_MAX) {
      const e = new Error(`WebP images can be at most ${WEBP_MAX.toLocaleString('en-US')} pixels wide or tall, and ${resized ? 'the resized image would be' : 'this one is'} ${out.width} × ${out.height}. Choose ${resized ? 'a smaller size, or ' : ''}PNG or JPG instead.`);
      e.code = 'too-large'; throw e;
    }
    const render = (w, h) => {
      const c = makeCanvas(w, h);
      const g = c.getContext('2d');
      if (fmt.opaque) {
        g.fillStyle = options.background || '#ffffff';
        g.fillRect(0, 0, w, h);
      }
      drawScaled(g, img, w, h);
      return [c, g];
    };
    const [canvas, ctx] = render(out.width, out.height);
    const base = { width: out.width, height: out.height, sourceKind: img.kind, sourceWidth: img.width, sourceHeight: img.height, resized };
    const targetBytes = options.targetBytes > 0 && (fmt.lossy || formatId === 'png') && formatId !== 'pdf' ? Math.round(options.targetBytes) : 0;
    if (targetBytes) {
      const r = await fitToBytes(render, canvas, ctx, out, fmt, targetBytes, { ...options, quality });
      return { ...base, ...r, resized: r.width !== img.width || r.height !== img.height };
    }
    if (formatId === 'png' && options.pngColors > 0) {
      const { data } = ctx.getImageData(0, 0, out.width, out.height);
      const png = await encodePng8(data, out.width, out.height, { maxColors: options.pngColors, dither: options.dither !== false });
      return { ...base, blob: new Blob([png], { type: fmt.mime }), colors: options.pngColors };
    }
    if (formatId === 'pdf') {
      const pdfPage = await pageFromCanvas(canvas, ctx, quality, canvasToBlob);
      const blob = makePdf([pdfPage], { pageSize: options.pageSize });
      const preview = options.preview ? await previewOf(canvas) : undefined;
      return { ...base, blob, pdfPage, preview };
    }
    if (formatId === 'ico') {
      const blob = await makeIco(img, options.icoSizes || ICO_SIZES);
      return { ...base, blob };
    }
    if (formatId === 'tiff') {
      const { data } = ctx.getImageData(0, 0, out.width, out.height);
      const page = tiffPage(data, out.width, out.height, { compression: options.tiffCompression });
      const preview = options.preview ? await previewOf(canvas) : undefined;
      return { ...base, blob: makeTiff([page]), tiffPage: page, preview };
    }
    if (formatId === 'gif') {
      const { data } = ctx.getImageData(0, 0, out.width, out.height);
      const gif = encodeGif(data, out.width, out.height, { dither: options.dither !== false });
      return { ...base, blob: new Blob([gif], { type: fmt.mime }) };
    }
    const blob = await canvasToBlob(canvas, fmt.mime, quality);
    if (!blob) throw new Error('The browser could not encode the image');
    if (blob.type !== fmt.mime) {
      const e = new Error(`This browser cannot create ${fmt.label} files`);
      e.code = 'encode-unsupported'; throw e;
    }
    return { ...base, blob };
  } finally {
    img.close();
  }
}

// ---- resizing ---------------------------------------------------------------
export const MAX_OUTPUT_SIDE = 16384;

/**
 * Output size for a resize setting { mode, width, height, percent }:
 *   'percent' scales both sides; 'fit' shrinks to fit inside width × height (either may be empty)
 *   and never enlarges; 'exact' uses width × height, or keeps the aspect ratio when one is empty.
 * Anything else keeps the original size. Sides are at least 1 px; a resize may not go above
 * MAX_OUTPUT_SIDE on either side (an unresized image keeps whatever size it has).
 */
export function outputSize(w, h, resize) {
  const num = (v) => (Number(v) > 0 && Number.isFinite(Number(v)) ? Number(v) : 0);
  const rw = num(resize?.width), rh = num(resize?.height), pct = num(resize?.percent);
  let W = w, H = h;
  if (resize?.mode === 'percent' && pct) {
    W = (w * pct) / 100; H = (h * pct) / 100;
  } else if (resize?.mode === 'fit' && (rw || rh)) {
    const s = Math.min(1, rw ? rw / w : Infinity, rh ? rh / h : Infinity);
    W = w * s; H = h * s;
  } else if (resize?.mode === 'exact' && (rw || rh)) {
    W = rw || (w * rh) / h;
    H = rh || (h * rw) / w;
  } else {
    return { width: w, height: h };
  }
  W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
  if (Math.max(W, H) > MAX_OUTPUT_SIDE && Math.max(W, H) > Math.max(w, h)) {
    const e = new Error(`The resized image would be ${W} × ${H} pixels; the limit is ${MAX_OUTPUT_SIDE.toLocaleString('en-US')} on each side.`);
    e.code = 'too-large'; throw e;
  }
  return { width: W, height: H };
}

/**
 * Draw the decoded image at w × h. Large reductions go down in steps of at most 2×, which
 * keeps fine detail from aliasing where a browser's one-step downscale samples too sparsely.
 */
function drawScaled(ctx, img, w, h) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let src = img.source, sw = img.width, sh = img.height;
  if (sw === w && sh === h) { ctx.drawImage(src, 0, 0, w, h); return; }
  const temps = [];
  while (sw >= w * 2 * 1.02 && sh >= h * 2 * 1.02) {
    const nw = Math.max(w, Math.ceil(sw / 2)), nh = Math.max(h, Math.ceil(sh / 2));
    const c = makeCanvas(nw, nh);
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, sw, sh, 0, 0, nw, nh);
    temps.push(c);
    src = c; sw = nw; sh = nh;
  }
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
  for (const c of temps) { c.width = 0; c.height = 0; }
}

// ---- target file size -------------------------------------------------------
const MIN_TARGET_QUALITY = 0.3; // below this JPEG/WebP turn blocky; smaller dimensions look better
const QUALITY_STEPS = 7;
const SHRINK_QUALITY = 0.6;

/**
 * Find the largest output of at most `maxBytes`. JPG/WebP/AVIF: the highest quality (up to the
 * chosen one) that fits, by bisection; PNG: lossless if it fits, else a 256-colour palette. If even
 * that is too big, the dimensions shrink by the square root of the size ratio (measured at 60% quality
 * for JPG/WebP/AVIF, so the smaller image lands near 60% rather than at the floor) and it tries again.
 * Returns { blob, width, height, quality?, colors?, targetMet, targetBytes }.
 */
async function fitToBytes(render, canvas, ctx, size, fmt, maxBytes, options) {
  let { width, height } = size;
  let best = null;
  for (let round = 0; round < 14; round++) {
    if (round > 0) [canvas, ctx] = render(width, height);
    const r = fmt.id === 'png'
      ? await pngUnder(canvas, ctx, width, height, maxBytes, options, round === 0 ? (options.pngColors || 0) : 256)
      : await lossyUnder(canvas, fmt, maxBytes, options.quality);
    if (r.fits) return { blob: r.blob, width, height, quality: r.quality, colors: r.colors, targetMet: true, targetBytes: maxBytes };
    best = { blob: r.blob, width, height, quality: r.quality, colors: r.colors };
    if (width === 1 && height === 1) break;
    // Shrink so that the next round fits at a comfortable quality (60%), not only at the floor:
    // a slightly smaller picture at 60% looks better than a larger one at 30%.
    let ref = r.blob.size;
    if (fmt.id !== 'png') {
      const q = Math.min(SHRINK_QUALITY, options.quality ?? 0.92);
      ref = (await canvasToBlob(canvas, fmt.mime, q))?.size || ref;
    }
    const s = Math.min(0.9, Math.sqrt(maxBytes / ref) * 0.95);
    width = Math.max(1, Math.floor(width * s)); height = Math.max(1, Math.floor(height * s));
  }
  return { ...best, targetMet: false, targetBytes: maxBytes };
}

async function lossyUnder(canvas, fmt, maxBytes, maxQuality) {
  const encode = async (q) => {
    const blob = await canvasToBlob(canvas, fmt.mime, q);
    if (!blob) throw new Error('The browser could not encode the image');
    if (blob.type !== fmt.mime) { const e = new Error(`This browser cannot create ${fmt.label} files`); e.code = 'encode-unsupported'; throw e; }
    return blob;
  };
  const top = maxQuality ?? 0.92;
  const floor = Math.min(MIN_TARGET_QUALITY, top);
  const first = await encode(top);
  if (first.size <= maxBytes || floor === top) return { fits: first.size <= maxBytes, blob: first, quality: top };
  const bottom = await encode(floor);
  if (bottom.size > maxBytes) return { fits: false, blob: bottom, quality: floor };
  let lo = floor, hi = top, good = { blob: bottom, quality: lo };
  for (let i = 0; i < QUALITY_STEPS; i++) {
    const q = Math.round(((lo + hi) / 2) * 100) / 100;
    if (q <= lo || q >= hi) break;
    const b = await encode(q);
    if (b.size <= maxBytes) { lo = q; good = { blob: b, quality: q }; } else hi = q;
  }
  return { fits: true, ...good };
}

async function pngUnder(canvas, ctx, w, h, maxBytes, options, colors) {
  if (!colors) {
    const lossless = await canvasToBlob(canvas, 'image/png');
    if (lossless && lossless.size <= maxBytes) return { fits: true, blob: lossless };
    colors = 256;
  }
  const { data } = ctx.getImageData(0, 0, w, h);
  const png = new Blob([await encodePng8(data, w, h, { maxColors: colors, dither: options.dither !== false })], { type: 'image/png' });
  return { fits: png.size <= maxBytes, blob: png, colors };
}

/** A small PNG of the result, for formats an <img> cannot show (PDF, TIFF). */
async function previewOf(canvas, max = 128) {
  const s = Math.min(1, max / Math.max(canvas.width, canvas.height));
  const c = makeCanvas(Math.max(1, Math.round(canvas.width * s)), Math.max(1, Math.round(canvas.height * s)));
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(canvas, 0, 0, c.width, c.height);
  return (await canvasToBlob(c, 'image/png')) || undefined;
}

/**
 * ICO with one PNG-compressed entry per size (supported since Windows Vista and by all
 * current browsers). Non-square images are centred on a transparent square.
 */
async function makeIco(img, sizes) {
  const list = [...new Set(sizes.map((n) => Math.round(n)).filter((n) => n >= 1 && n <= 256))].sort((a, b) => a - b);
  if (!list.length) throw new Error('Pick at least one icon size');
  const pngs = [];
  for (const size of list) {
    const c = makeCanvas(size, size);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    const s = size / Math.max(img.width, img.height);
    const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
    g.drawImage(img.source, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
    const png = await canvasToBlob(c, 'image/png');
    if (!png) throw new Error('The browser could not encode the image');
    pngs.push({ size, data: new Uint8Array(await png.arrayBuffer()) });
  }
  const head = new DataView(new ArrayBuffer(6 + 16 * pngs.length));
  head.setUint16(0, 0, true); // reserved
  head.setUint16(2, 1, true); // type 1 = icon
  head.setUint16(4, pngs.length, true);
  let offset = head.byteLength;
  pngs.forEach((p, i) => {
    const e = 6 + i * 16;
    head.setUint8(e, p.size % 256); // 0 means 256
    head.setUint8(e + 1, p.size % 256);
    head.setUint8(e + 2, 0); // no palette
    head.setUint8(e + 3, 0);
    head.setUint16(e + 4, 1, true); // colour planes
    head.setUint16(e + 6, 32, true); // bits per pixel
    head.setUint32(e + 8, p.data.length, true);
    head.setUint32(e + 12, offset, true);
    offset += p.data.length;
  });
  return new Blob([head.buffer, ...pngs.map((p) => p.data)], { type: 'image/x-icon' });
}

function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, Number(x))); }
