// Minimal PDF writer for Saveform: one image per page, no dependencies.
// Pages carry either JPEG bytes (DCTDecode) or zlib-compressed pixels (FlateDecode, lossless:
// RGB, 8-bit grey, or 1-bit black and white). Output is plain PDF 1.4 that every viewer opens.
import { analyse } from './tiff-write.js';

const enc = new TextEncoder();

/** Page sizes in PDF points (1/72 inch), portrait. 'fit' means "page = image size". */
export const PAGE_SIZES = {
  fit: null,
  a4: [595.28, 841.89],
  letter: [612, 792],
};

const PX_TO_PT = 0.75; // CSS pixels are 1/96 inch, PDF points are 1/72 inch.

/**
 * Turn pixels on a canvas into a PDF page image.
 * Pure black-and-white pages (scans, faxes) are always stored losslessly as 1 bit per pixel:
 * smaller than any JPEG and exact. Otherwise quality < 1 -> JPEG at that quality;
 * quality >= 1 -> lossless Flate (8-bit grey when the image is grey, else RGB).
 * Returns { width, height, filter, data: Uint8Array, colorSpace, bpc }.
 */
export async function pageFromCanvas(canvas, ctx, quality, toBlob) {
  const width = canvas.width, height = canvas.height;
  const canFlate = typeof CompressionStream !== 'undefined';
  const rgba = canFlate ? ctx.getImageData(0, 0, width, height).data : null;
  const kind = rgba ? analyse(rgba) : {};
  if (kind.bilevel) {
    const rowBytes = Math.ceil(width / 8);
    const bits = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) if (rgba[(y * width + x) * 4]) bits[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
    return { width, height, filter: 'FlateDecode', data: await deflate(bits), colorSpace: 'DeviceGray', bpc: 1 };
  }
  if (quality < 1) {
    const jpeg = await toBlob(canvas, 'image/jpeg', quality);
    if (!jpeg || jpeg.type !== 'image/jpeg') throw new Error('The browser could not encode the image');
    return { width, height, filter: 'DCTDecode', data: new Uint8Array(await jpeg.arrayBuffer()) };
  }
  if (!canFlate) {
    // Very old browsers: fall back to near-lossless JPEG rather than an uncompressed page.
    return pageFromCanvas(canvas, ctx, 0.98, toBlob);
  }
  if (kind.grey) {
    const grey = new Uint8Array(width * height);
    for (let i = 0, j = 0; j < grey.length; i += 4, j++) grey[j] = rgba[i];
    return { width, height, filter: 'FlateDecode', data: await deflate(grey), colorSpace: 'DeviceGray', bpc: 8 };
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2];
  }
  return { width, height, filter: 'FlateDecode', data: await deflate(rgb), colorSpace: 'DeviceRGB', bpc: 8 };
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const num = (x) => {
  const s = (Math.round(x * 100) / 100).toFixed(2);
  return s.replace(/\.?0+$/, '') || '0';
};

/** Where the image goes on the page: { pageW, pageH, x, y, w, h } in points. */
export function layout(imgW, imgH, pageSize = 'fit', margin = 36) {
  const natW = imgW * PX_TO_PT, natH = imgH * PX_TO_PT;
  const size = PAGE_SIZES[pageSize];
  if (!size) return { pageW: natW, pageH: natH, x: 0, y: 0, w: natW, h: natH };
  let [pageW, pageH] = size;
  if (imgW > imgH) [pageW, pageH] = [pageH, pageW]; // landscape image -> landscape page
  const availW = pageW - 2 * margin, availH = pageH - 2 * margin;
  // Shrink to fit; never enlarge past the image's natural size (small images would blur).
  const s = Math.min(1, availW / natW, availH / natH);
  const w = natW * s, h = natH * s;
  return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}

/**
 * Build a PDF with one page per image.
 * pages: [{ width, height, filter, data }]. Returns a Blob (application/pdf).
 */
export function makePdf(pages, { pageSize = 'fit', margin = 36 } = {}) {
  if (!pages.length) throw new Error('A PDF needs at least one page');
  const chunks = [];
  const offsets = [];
  let offset = 0;
  const push = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    chunks.push(b);
    offset += b.length;
  };
  const obj = (n, ...parts) => {
    offsets[n] = offset;
    push(`${n} 0 obj\n`);
    parts.forEach(push);
    push('\nendobj\n');
  };

  // Header; the second line's high bytes mark the file as binary for transfer tools.
  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // Objects: 1 catalog, 2 page tree, then 3 per page (page, content, image), then info.
  const pageObj = (i) => 3 + i * 3;
  const infoObj = 3 + pages.length * 3;
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] >>`);
  pages.forEach((p, i) => {
    const n = pageObj(i);
    const L = layout(p.width, p.height, pageSize, margin);
    const content = `q ${num(L.w)} 0 0 ${num(L.h)} ${num(L.x)} ${num(L.y)} cm /Im0 Do Q`;
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(L.pageW)} ${num(L.pageH)}] `
      + `/Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    obj(n + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} `
      + `/ColorSpace /${p.colorSpace || 'DeviceRGB'} /BitsPerComponent ${p.bpc || 8} /Filter /${p.filter} /Length ${p.data.length} >>\nstream\n`,
    p.data, '\nendstream');
  });
  obj(infoObj, '<< /Producer (Saveform) /Creator (Saveform image converter) >>');

  const xrefAt = offset;
  const size = infoObj + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let n = 1; n < size; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
