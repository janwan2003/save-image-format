// Minimal TIFF writer for Saveform: baseline TIFF 6.0, no dependencies.
// Each page is stored as strips, LZW-compressed (with the horizontal-differencing predictor for
// 8-bit samples) or uncompressed. The writer picks the smallest exact representation of the
// pixels: 1-bit black and white, 8-bit grey, RGB, or RGB + unassociated alpha. Pages are built
// one at a time (tiffPage) and joined later (makeTiff), like PDF pages in lib/pdf.js.

const STRIP_TARGET = 64 * 1024; // uncompressed bytes per strip (libtiff's tools use ~8 KB; larger is fine)

/** What the pixels need: { opaque, grey, bilevel } (bilevel implies grey implies opaque). */
export function analyse(rgba) {
  let opaque = true, grey = true, bilevel = true;
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i];
    if (rgba[i + 3] !== 255) { opaque = false; break; }
    if (grey && (rgba[i + 1] !== r || rgba[i + 2] !== r)) { grey = false; bilevel = false; }
    else if (bilevel && r !== 0 && r !== 255) bilevel = false;
  }
  if (!opaque) { grey = false; bilevel = false; }
  return { opaque, grey, bilevel };
}

/**
 * Encode one page from RGBA pixels (canvas ImageData order, not premultiplied).
 * compression: 'lzw' (default) or 'none'. Returns a page object for makeTiff.
 */
export function tiffPage(rgba, width, height, { compression = 'lzw' } = {}) {
  if (!(width > 0 && height > 0)) throw new Error('A TIFF page needs a size');
  const { opaque, grey, bilevel } = analyse(rgba);
  const spp = bilevel || grey ? 1 : opaque ? 3 : 4;
  const bps = bilevel ? 1 : 8;
  const rowBytes = bilevel ? Math.ceil(width / 8) : width * spp;
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(STRIP_TARGET / rowBytes)));
  const lzw = compression !== 'none';
  const predictor = lzw && bps === 8 ? 2 : 1;
  const strips = [];
  for (let y0 = 0; y0 < height; y0 += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, height - y0);
    const raw = new Uint8Array(rows * rowBytes);
    for (let r = 0; r < rows; r++) {
      const src = (y0 + r) * width * 4, dst = r * rowBytes;
      if (bilevel) {
        // BlackIsZero, MSB first: a set bit is white. Rows are padded to whole bytes.
        for (let x = 0; x < width; x++) if (rgba[src + x * 4]) raw[dst + (x >> 3)] |= 0x80 >> (x & 7);
      } else if (spp === 1) {
        for (let x = 0; x < width; x++) raw[dst + x] = rgba[src + x * 4];
      } else if (spp === 3) {
        for (let x = 0, s = src, d = dst; x < width; x++, s += 4, d += 3) { raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; }
      } else {
        raw.set(rgba.subarray(src, src + width * 4), dst);
      }
      if (predictor === 2) {
        // Horizontal differencing: each sample minus the same sample of the pixel to its left.
        for (let i = dst + rowBytes - 1; i >= dst + spp; i--) raw[i] = (raw[i] - raw[i - spp]) & 255;
      }
    }
    strips.push(lzw ? lzwEncode(raw) : raw);
  }
  return {
    width, height, spp, bps, rowsPerStrip, strips, predictor,
    compression: lzw ? 5 : 1,
    photometric: spp >= 3 ? 2 : 1, // RGB, or BlackIsZero
    alpha: spp === 4,
  };
}

/**
 * TIFF LZW (as libtiff writes it): MSB-first codes of 9–12 bits, Clear (256) first, the code width
 * grows one code early, Clear again when the table reaches 4094 entries, End of Information (257).
 */
export function lzwEncode(src) {
  let out = new Uint8Array(Math.max(64, (src.length * 1.4) | 0) + 16);
  let o = 0, acc = 0, nacc = 0;
  const put = (code, width) => {
    acc = (acc << width) | code; nacc += width;
    while (nacc >= 8) {
      if (o >= out.length) { const g = new Uint8Array(out.length * 2); g.set(out); out = g; }
      nacc -= 8; out[o++] = (acc >>> nacc) & 255;
    }
    acc &= (1 << nacc) - 1;
  };
  // Table lookup by (prefix code, next byte): direct index, entries valid for the current generation only.
  const codes = new Uint16Array(4096 * 256);
  const stamp = new Uint32Array(4096 * 256);
  let gen = 1, next = 258, width = 9;
  put(256, 9);
  if (!src.length) { put(257, 9); }
  else {
    let w = src[0];
    for (let i = 1; i < src.length; i++) {
      const c = src[i];
      const key = (w << 8) | c;
      if (stamp[key] === gen) { w = codes[key]; continue; }
      put(w, width);
      if (next === 4094) {
        put(256, width);
        gen++; next = 258; width = 9;
      } else {
        codes[key] = next; stamp[key] = gen; next++;
        if (next >= (1 << width) && width < 12) width++;
      }
      w = c;
    }
    put(w, width);
    next++;
    if (next >= (1 << width) && width < 12) width++;
    put(257, width);
  }
  if (nacc) put(0, 8 - nacc);
  return out.subarray(0, o);
}

/** Join pages into one TIFF file (little-endian, one IFD per page). Returns a Blob (image/tiff). */
export function makeTiff(pages, { software = 'Saveform' } = {}) {
  if (!pages.length) throw new Error('A TIFF needs at least one page');
  const chunks = [];
  let offset = 0;
  const push = (b) => { chunks.push(b); offset += b.length; };
  const header = new Uint8Array(8);
  const hv = new DataView(header.buffer);
  header[0] = 0x49; header[1] = 0x49; hv.setUint16(2, 42, true);
  push(header);
  let linkAt = { view: hv, pos: 4 }; // where the next IFD's offset is written
  const ascii = new TextEncoder().encode(`${software}\0`);

  pages.forEach((p, n) => {
    // Strip data first, each starting on a word boundary.
    const stripOffsets = [], stripCounts = [];
    for (const s of p.strips) {
      if (offset & 1) push(new Uint8Array(1));
      stripOffsets.push(offset); stripCounts.push(s.length);
      push(s);
    }
    if (offset & 1) push(new Uint8Array(1));
    const entries = [
      [254, 4, [0]], // NewSubfileType: a full-resolution page
      [256, 4, [p.width]],
      [257, 4, [p.height]],
      [258, 3, Array(p.spp).fill(p.bps)],
      [259, 3, [p.compression]],
      [262, 3, [p.photometric]],
      [273, 4, stripOffsets],
      [277, 3, [p.spp]],
      [278, 4, [p.rowsPerStrip]],
      [279, 4, stripCounts],
      [282, 5, [72, 1]], // XResolution 72/1
      [283, 5, [72, 1]],
      [284, 3, [1]], // PlanarConfiguration: chunky
      [296, 3, [2]], // ResolutionUnit: inch
      ...(pages.length > 1 ? [[297, 3, [n, pages.length]]] : []), // PageNumber
      [305, 2, ascii],
      ...(p.predictor === 2 ? [[317, 3, [2]]] : []),
      ...(p.alpha ? [[338, 3, [2]]] : []), // ExtraSamples: unassociated alpha
    ];
    const ifdAt = offset;
    const ifdSize = 2 + entries.length * 12 + 4;
    const size = { 2: 1, 3: 2, 4: 4, 5: 8 };
    const valueBytes = (t, v) => (t === 2 ? v.length : t === 5 ? 8 * (v.length / 2) : size[t] * v.length);
    let extra = 0;
    for (const [, t, v] of entries) { const b = valueBytes(t, v); if (b > 4) extra += b + (b & 1); }
    const ifd = new Uint8Array(ifdSize + extra);
    const dv = new DataView(ifd.buffer);
    dv.setUint16(0, entries.length, true);
    let ext = ifdSize;
    entries.forEach(([tag, type, v], i) => {
      const e = 2 + i * 12;
      dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true);
      dv.setUint32(e + 4, type === 5 ? v.length / 2 : v.length, true);
      const b = valueBytes(type, v);
      let pos = e + 8;
      if (b > 4) { dv.setUint32(e + 8, ifdAt + ext, true); pos = ext; ext += b + (b & 1); }
      v.forEach((x, k) => {
        if (type === 2) dv.setUint8(pos + k, x);
        else if (type === 3) dv.setUint16(pos + 2 * k, x, true);
        else dv.setUint32(pos + 4 * k, x, true); // LONG, and RATIONAL as two LONGs
      });
    });
    linkAt.view.setUint32(linkAt.pos, ifdAt, true);
    linkAt = { view: dv, pos: ifdSize - 4 };
    push(ifd);
    if (offset > 0xffffffff) throw new Error('This TIFF would be larger than 4 GB, the limit of the format');
  });
  return new Blob(chunks, { type: 'image/tiff' });
}
