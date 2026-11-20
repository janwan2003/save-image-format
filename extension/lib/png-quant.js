// Saveform indexed-colour PNG writer ("compress PNG"): RGBA in, PNG colour type 3 out, with
// PLTE + tRNS so every palette entry keeps its own alpha. Written for Saveform from the PNG
// specification (W3C, Third Edition: IHDR, PLTE, tRNS, IDAT, filter type 0, CRC-32) and
// RFC 1950 (zlib stream, made by the platform's CompressionStream('deflate')). No dependencies,
// no network, plain typed arrays.
//
//   encodePng8(rgba, width, height, { maxColors = 256, dither = true }) -> Promise<Uint8Array>
//
// Steps: 1. palette. An image with at most maxColors distinct RGBA values keeps them exactly
// (every fully transparent pixel counts as one value, 0,0,0,0). Otherwise colours are picked
// in premultiplied RGBA space, so a nearly transparent pixel's colour matters as little as it
// shows: a median cut over a histogram of up to ~1 M sampled pixels, then three k-means passes.
// Fully transparent pixels get one reserved entry (alpha 0) that the quantizer never moves.
// 2. Each pixel gets a palette index (nearest-colour answers cached per cell), with optional
// serpentine Floyd–Steinberg error diffusion in premultiplied RGBA. 3. Unused entries are
// dropped, entries with alpha < 255 go first so tRNS can stop after them, and the bit depth is
// the smallest of 1/2/4/8 that fits. Rows use filter 0 (None), as PNG advises for palettes.
//
// Colour distance: for two premultiplied colours, the error of each channel after compositing
// on black and on white, whichever is worse, weighted like gif.js (green most, blue least).

const WR = 3, WG = 4, WB = 2;
const WA = (WR + WG + WB) / 2; // alpha weight for choosing median-cut split axes only
const SAMPLE_TARGET = 1 << 20; // pixels looked at when building the palette
const KMEANS_PASSES = 3;

export async function encodePng8(rgba, width, height, { maxColors = 256, dither = true } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('PNG width and height must be whole numbers of at least 1');
  }
  if (width > 0x7fffffff || height > 0x7fffffff) throw new Error('PNG width and height must be below 2^31');
  const n = width * height;
  if (!rgba || !ArrayBuffer.isView(rgba) || rgba.length !== n * 4) {
    throw new Error(`Pixel data must be ${n * 4} bytes (width × height × 4 RGBA) for a ${width}×${height} image`);
  }
  if (!Number.isFinite(maxColors)) throw new Error('maxColors must be a number from 2 to 256');
  const limit = Math.max(2, Math.min(256, Math.round(maxColors)));

  let { palette, indices } = exactColors(rgba, n, limit) || quantize(rgba, width, height, limit, dither);
  ({ palette, indices } = tidyPalette(palette, indices));
  return writePng(width, height, palette, indices);
}

/**
 * Palette only, for the vector tracer (lib/trace.js): up to maxColors straight-RGBA entries
 * (Uint8Array, 4 bytes each) for `n` pixels of opaque RGBA. Exact colours when there are few
 * enough, otherwise the same median cut + k-means as encodePng8, without mapping or dithering.
 */
export function choosePalette(rgba, n, maxColors) {
  const limit = Math.max(1, Math.min(256, Math.round(maxColors)));
  const exact = exactColors(rgba, n, limit);
  if (exact) return exact.palette;
  if (limit === 1) {
    const sum = [0, 0, 0];
    for (let p = 0; p < n * 4; p += 4) for (let c = 0; c < 3; c++) sum[c] += rgba[p + c];
    return Uint8Array.from([...sum.map((v) => Math.round(v / n)), 255]);
  }
  return quantize(rgba, n, 1, limit, false).palette;
}

/** Distinct RGBA values (alpha-0 pixels merged), if at most `limit`. { palette, indices } or null. */
function exactColors(rgba, n, limit) {
  const seen = new Map();
  const indices = new Uint8Array(n);
  const palette = [];
  let lastKey = -1, lastIdx = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = rgba[p + 3];
    const key = a === 0 ? 0 : ((rgba[p] << 24) | (rgba[p + 1] << 16) | (rgba[p + 2] << 8) | a) >>> 0;
    if (key !== lastKey) {
      let idx = seen.get(key);
      if (idx === undefined) {
        if (seen.size >= limit) return null;
        idx = seen.size;
        seen.set(key, idx);
        if (a === 0) palette.push(0, 0, 0, 0);
        else palette.push(rgba[p], rgba[p + 1], rgba[p + 2], a);
      }
      lastKey = key; lastIdx = idx;
    }
    indices[i] = lastIdx;
  }
  return { palette: Uint8Array.from(palette), indices };
}

// ---- quantizing --------------------------------------------------------------------------

function quantize(rgba, width, height, limit, dither) {
  const n = width * height;
  let hasClear = false;
  for (let p = 3; p < n * 4; p += 4) if (rgba[p] === 0) { hasClear = true; break; }
  const pal = buildPalette(rgba, n, limit - (hasClear ? 1 : 0), hasClear);
  // Final palette as bytes (straight alpha); mapping works from these rounded values.
  const colors = pal.length / 4;
  const palette = new Uint8Array(colors * 4);
  for (let i = 0; i < colors; i++) {
    const a = Math.round(pal[i * 4 + 3]);
    palette[i * 4 + 3] = a;
    for (let c = 0; c < 3; c++) palette[i * 4 + c] = a ? clampByte(pal[i * 4 + c] * 255 / pal[i * 4 + 3]) : 0;
  }
  const clearIdx = hasClear ? colors - 1 : -1;
  const lookup = makeLookup(palette);
  const indices = dither ? mapDithered(rgba, width, height, palette, lookup, clearIdx) : mapPlain(rgba, n, lookup, clearIdx);
  return { palette, indices };
}

/**
 * Palette in premultiplied RGBA (Float64Array, 4 per entry). With `clear`, the last entry is
 * 0,0,0,0 and alpha-0 pixels are left out of the histogram.
 */
function buildPalette(rgba, n, room, clear) {
  // Histogram of sampled pixels in cells of 6 bits per premultiplied channel; each cell keeps its
  // pixel count and exact premultiplied sums, so entries are true averages, not cell centres.
  const step = Math.max(1, Math.floor(n / SAMPLE_TARGET));
  const cells = new Map();
  let cap = 4096, m = 0;
  let w = new Float64Array(cap), s0 = new Float64Array(cap), s1 = new Float64Array(cap), s2 = new Float64Array(cap), s3 = new Float64Array(cap);
  let seed = 0x9e3779b9, lastKey = -1, lastSlot = 0;
  for (let i = 0; i < n;) {
    const p = i * 4, a = rgba[p + 3];
    if (step === 1) i++;
    else { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; i += 1 + ((seed >>> 0) % (2 * step - 1)); }
    if (a === 0) continue;
    const k = a / 255;
    const r = rgba[p] * k, g = rgba[p + 1] * k, b = rgba[p + 2] * k;
    const key = ((r >> 2) << 18) | ((g >> 2) << 12) | ((b >> 2) << 6) | (a >> 2);
    let slot = lastSlot;
    if (key !== lastKey) {
      slot = cells.get(key);
      if (slot === undefined) {
        if (m === cap) {
          cap *= 2;
          [w, s0, s1, s2, s3] = [w, s0, s1, s2, s3].map((x) => { const y = new Float64Array(cap); y.set(x); return y; });
        }
        slot = m++;
        cells.set(key, slot);
      }
      lastKey = key; lastSlot = slot;
    }
    w[slot]++; s0[slot] += r; s1[slot] += g; s2[slot] += b; s3[slot] += a;
  }
  const P = [new Float64Array(m), new Float64Array(m), new Float64Array(m), new Float64Array(m)];
  for (let k = 0; k < m; k++) { P[0][k] = s0[k] / w[k]; P[1][k] = s1[k] / w[k]; P[2][k] = s2[k] / w[k]; P[3][k] = s3[k] / w[k]; }

  const pal = m ? medianCut(P, w, m, room) : new Float64Array(0);
  let colors = pal.length / 4;
  const all = new Float64Array((colors + (clear ? 1 : 0)) * 4);
  all.set(pal); // a reserved clear entry stays 0,0,0,0
  const fixed = clear ? colors : -1;
  if (clear) colors++;

  // k-means over the histogram cells; the clear entry attracts nearly transparent cells but stays put.
  for (let pass = 0; pass < KMEANS_PASSES && m; pass++) {
    const search = makeSearch(all, colors);
    const acc = new Float64Array(colors * 5);
    for (let k = 0; k < m; k++) {
      const i = search(P[0][k], P[1][k], P[2][k], P[3][k]) * 5, x = w[k];
      acc[i] += x; acc[i + 1] += x * P[0][k]; acc[i + 2] += x * P[1][k]; acc[i + 3] += x * P[2][k]; acc[i + 4] += x * P[3][k];
    }
    for (let i = 0; i < colors; i++) {
      if (i === fixed || !acc[i * 5]) continue; // keep an entry that lost all its cells
      for (let c = 0; c < 4; c++) all[i * 4 + c] = acc[i * 5 + 1 + c] / acc[i * 5];
    }
  }
  if (!colors) return Float64Array.of(0, 0, 0, 0); // cannot happen: no alpha-0 pixels means m > 0
  return all;
}

/** Median cut of weighted 4-D points P[axis][k] into at most `room` boxes; returns box means. */
function medianCut(P, w, m, room) {
  const order = new Int32Array(m);
  for (let k = 0; k < m; k++) order[k] = k;
  const axisWeight = [WR, WG, WB, WA];
  const stats = (start, end) => {
    let cw = 0;
    const s = [0, 0, 0, 0], ss = [0, 0, 0, 0];
    for (let j = start; j < end; j++) {
      const k = order[j], x = w[k];
      cw += x;
      for (let c = 0; c < 4; c++) { const v = P[c][k]; s[c] += x * v; ss[c] += x * v * v; }
    }
    let sse = 0, axis = 0, best = -1;
    for (let c = 0; c < 4; c++) {
      const v = axisWeight[c] * (ss[c] - (s[c] * s[c]) / cw);
      sse += v;
      if (v > best) { best = v; axis = c; }
    }
    return { start, end, sse: end - start > 1 ? sse : 0, axis };
  };

  const boxes = [stats(0, m)];
  const tmp = new Int32Array(m);
  while (boxes.length < room) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].sse > 0 && (best < 0 || boxes[i].sse > boxes[best].sse)) best = i;
    if (best < 0) break;
    const { start, end, axis } = boxes[best];
    const a = P[axis];
    // Counting sort of the box's points by the integer part of their coordinate on the split axis.
    const buckets = new Int32Array(257);
    for (let j = start; j < end; j++) buckets[(a[order[j]] | 0) + 1]++;
    for (let v = 1; v <= 256; v++) buckets[v] += buckets[v - 1];
    for (let j = start; j < end; j++) { const k = order[j]; tmp[start + buckets[a[k] | 0]++] = k; }
    order.set(tmp.subarray(start, end), start);
    // Split where the summed squared error along that axis of the two halves is smallest.
    let tw = 0, ts = 0;
    for (let j = start; j < end; j++) { const k = order[j]; tw += w[k]; ts += w[k] * a[k]; }
    let lw = 0, ls = 0, cut = start + 1, bestScore = -Infinity;
    for (let j = start; j < end - 1; j++) {
      const k = order[j];
      lw += w[k]; ls += w[k] * a[k];
      const rw = tw - lw, rs = ts - ls;
      const score = (ls * ls) / lw + (rs * rs) / rw; // max of this = min of SSE
      if (score > bestScore) { bestScore = score; cut = j + 1; }
    }
    boxes.splice(best, 1, stats(start, cut), stats(cut, end));
  }

  const pal = new Float64Array(boxes.length * 4);
  boxes.forEach((bx, i) => {
    let cw = 0;
    const s = [0, 0, 0, 0];
    for (let j = bx.start; j < bx.end; j++) { const k = order[j]; cw += w[k]; for (let c = 0; c < 4; c++) s[c] += w[k] * P[c][k]; }
    for (let c = 0; c < 4; c++) pal[i * 4 + c] = s[c] / cw;
  });
  return pal;
}

/**
 * Nearest palette entry to a premultiplied colour. Entries are sorted by green; the search walks
 * out from the closest green both ways and stops once green alone is further than the best match.
 */
function makeSearch(pal, colors) {
  const order = Array.from({ length: colors }, (_, i) => i).sort((x, y) => pal[x * 4 + 1] - pal[y * 4 + 1]);
  const R = new Float64Array(colors), G = new Float64Array(colors), B = new Float64Array(colors), A = new Float64Array(colors);
  const id = Int32Array.from(order);
  order.forEach((e, j) => { R[j] = pal[e * 4]; G[j] = pal[e * 4 + 1]; B[j] = pal[e * 4 + 2]; A[j] = pal[e * 4 + 3]; });
  const dist = (j, r, g, b, a) => {
    const dr = r - R[j], dg = g - G[j], db = b - B[j], da = a - A[j];
    const wr = dr - da, wg = dg - da, wb = db - da; // difference over white
    return WR * Math.max(dr * dr, wr * wr) + WG * Math.max(dg * dg, wg * wg) + WB * Math.max(db * db, wb * wb);
  };
  return (r, g, b, a) => {
    let lo = 0, hi = colors;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (G[mid] < g) lo = mid + 1; else hi = mid; }
    let best = 0, bestD = Infinity, up = lo, down = lo - 1;
    while (up < colors || down >= 0) {
      if (up < colors) {
        const dg = G[up] - g;
        if (WG * dg * dg >= bestD) up = colors;
        else { const d = dist(up, r, g, b, a); if (d < bestD) { bestD = d; best = up; } up++; }
      }
      if (down >= 0) {
        const dg = g - G[down];
        if (WG * dg * dg >= bestD) down = -1;
        else { const d = dist(down, r, g, b, a); if (d < bestD) { bestD = d; best = down; } down--; }
      }
    }
    return id[best];
  };
}

// ---- pixels to palette indices --------------------------------------------------------
// Nearest-colour answers are cached per cell of straight RGBA: opaque pixels in 6-bit-per-channel
// cells, translucent ones in 5-bit colour × 6-bit alpha cells (made only when needed).

function makeLookup(palette) {
  const colors = palette.length / 4;
  const pre = new Float64Array(colors * 4);
  for (let i = 0; i < colors * 4; i += 4) {
    const k = palette[i + 3] / 255;
    pre[i] = palette[i] * k; pre[i + 1] = palette[i + 1] * k; pre[i + 2] = palette[i + 2] * k; pre[i + 3] = palette[i + 3];
  }
  const search = makeSearch(pre, colors);
  const opaque = new Int16Array(1 << 18).fill(-1);
  let translucent = null;
  const lookup = (r, g, b, a) => {
    if (a === 255) {
      const c = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let idx = opaque[c];
      if (idx < 0) idx = opaque[c] = search((r & ~3) + 1.5, (g & ~3) + 1.5, (b & ~3) + 1.5, 255);
      return idx;
    }
    if (!translucent) translucent = new Int16Array(1 << 21).fill(-1);
    const c = ((r >> 3) << 16) | ((g >> 3) << 11) | ((b >> 3) << 6) | (a >> 2);
    let idx = translucent[c];
    if (idx < 0) {
      const ca = Math.min(254, (a & ~3) + 1.5), k = ca / 255;
      idx = translucent[c] = search(((r & ~7) + 3.5) * k, ((g & ~7) + 3.5) * k, ((b & ~7) + 3.5) * k, ca);
    }
    return idx;
  };
  lookup.pre = pre;
  return lookup;
}

function mapPlain(rgba, n, lookup, clearIdx) {
  const indices = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = rgba[p + 3];
    indices[i] = a === 0 && clearIdx >= 0 ? clearIdx : lookup(rgba[p], rgba[p + 1], rgba[p + 2], a);
  }
  return indices;
}

/** Floyd–Steinberg error diffusion in premultiplied RGBA, alternating direction on each row. */
function mapDithered(rgba, width, height, palette, lookup, clearIdx) {
  const pre = lookup.pre;
  const indices = new Uint8Array(width * height);
  // Error rows with one spare pixel on each side: cur = this row, next = the row below.
  let cur = new Float32Array((width + 2) * 4), next = new Float32Array((width + 2) * 4);
  for (let y = 0; y < height; y++) {
    const ltr = (y & 1) === 0;
    const dir = ltr ? 4 : -4;
    for (let s = 0; s < width; s++) {
      const x = ltr ? s : width - 1 - s;
      const i = y * width + x, p = i * 4, e = (x + 1) * 4;
      const a0 = rgba[p + 3];
      if (a0 === 0 && clearIdx >= 0) { indices[i] = clearIdx; continue; } // nothing to show, no error to pass on
      const k0 = a0 / 255;
      const a = clamp(a0 + cur[e + 3], 0, 255);
      const r = clamp(rgba[p] * k0 + cur[e], 0, a), g = clamp(rgba[p + 1] * k0 + cur[e + 1], 0, a), b = clamp(rgba[p + 2] * k0 + cur[e + 2], 0, a);
      const ai = Math.round(a);
      const idx = ai === 0 && clearIdx >= 0 ? clearIdx
        : lookup(straight(r, a), straight(g, a), straight(b, a), ai);
      indices[i] = idx;
      const q = idx * 4;
      const er = r - pre[q], eg = g - pre[q + 1], eb = b - pre[q + 2], ea = a - pre[q + 3];
      const ahead = e + dir, behindBelow = e - dir, aheadBelow = e + dir;
      cur[ahead] += er * 0.4375; cur[ahead + 1] += eg * 0.4375; cur[ahead + 2] += eb * 0.4375; cur[ahead + 3] += ea * 0.4375;
      next[behindBelow] += er * 0.1875; next[behindBelow + 1] += eg * 0.1875; next[behindBelow + 2] += eb * 0.1875; next[behindBelow + 3] += ea * 0.1875;
      next[e] += er * 0.3125; next[e + 1] += eg * 0.3125; next[e + 2] += eb * 0.3125; next[e + 3] += ea * 0.3125;
      next[aheadBelow] += er * 0.0625; next[aheadBelow + 1] += eg * 0.0625; next[aheadBelow + 2] += eb * 0.0625; next[aheadBelow + 3] += ea * 0.0625;
    }
    const t = cur; cur = next; next = t;
    next.fill(0);
  }
  return indices;
}

function straight(v, a) { return a > 0 ? clampByte((v * 255) / a) : 0; }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

// ---- palette order -------------------------------------------------------------------------

/** Drop unused entries; put entries with alpha < 255 first (tRNS may end after the last one). */
function tidyPalette(palette, indices) {
  const colors = palette.length / 4;
  const used = new Uint8Array(colors);
  for (let i = 0; i < indices.length; i++) used[indices[i]] = 1;
  const keep = [];
  for (let i = 0; i < colors; i++) if (used[i] && palette[i * 4 + 3] < 255) keep.push(i);
  for (let i = 0; i < colors; i++) if (used[i] && palette[i * 4 + 3] === 255) keep.push(i);
  const remap = new Uint8Array(colors);
  const out = new Uint8Array(keep.length * 4);
  keep.forEach((old, j) => { remap[old] = j; out.set(palette.subarray(old * 4, old * 4 + 4), j * 4); });
  let identity = true;
  for (let i = 0; i < colors && identity; i++) if (used[i] && remap[i] !== i) identity = false;
  if (!identity) for (let i = 0; i < indices.length; i++) indices[i] = remap[indices[i]];
  return { palette: out, indices };
}

// ---- PNG file ----------------------------------------------------------------------------

async function writePng(width, height, palette, indices) {
  const colors = palette.length / 4;
  const depth = colors <= 2 ? 1 : colors <= 4 ? 2 : colors <= 16 ? 4 : 8;
  const rowBytes = Math.ceil((width * depth) / 8);
  const raw = new Uint8Array(height * (rowBytes + 1)); // each row: filter byte 0, then packed indices
  const perByte = 8 / depth;
  for (let y = 0, o = 0, i = 0; y < height; y++, o += rowBytes + 1, i += width) {
    if (depth === 8) { raw.set(indices.subarray(i, i + width), o + 1); continue; }
    for (let x = 0; x < width; x++) {
      raw[o + 1 + ((x / perByte) | 0)] |= indices[i + x] << (8 - depth * ((x % perByte) + 1));
    }
  }
  const zlib = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = depth; ihdr[9] = 3; // colour type 3: indexed; compression, filter, interlace all 0
  const plte = new Uint8Array(colors * 3);
  let translucent = 0;
  for (let i = 0; i < colors; i++) {
    plte[i * 3] = palette[i * 4]; plte[i * 3 + 1] = palette[i * 4 + 1]; plte[i * 3 + 2] = palette[i * 4 + 2];
    if (palette[i * 4 + 3] < 255) translucent = i + 1;
  }
  const chunks = [chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (translucent) {
    const trns = new Uint8Array(translucent);
    for (let i = 0; i < translucent; i++) trns[i] = palette[i * 4 + 3];
    chunks.push(chunk('tRNS', trns));
  }
  chunks.push(chunk('IDAT', zlib), chunk('IEND', new Uint8Array(0)));
  const sig = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
  const out = new Uint8Array(sig.length + chunks.reduce((s, c) => s + c.length, 0));
  out.set(sig);
  let o = sig.length;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** length, type, data, CRC-32 of type + data. */
function chunk(type, data) {
  const c = new Uint8Array(12 + data.length);
  const dv = new DataView(c.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
  c.set(data, 8);
  dv.setUint32(8 + data.length, crc32(c.subarray(4, 8 + data.length)));
  return c;
}

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
