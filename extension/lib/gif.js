// Saveform GIF writer: one still frame, GIF89a. Written for Saveform from the GIF89a
// specification; no dependencies, no network, plain typed arrays.
//
//   encodeGif(rgba, width, height, { dither = true, maxColors = 256 }) -> Uint8Array
//
// Steps: 1. palette. An image with few enough distinct colours keeps them exactly; otherwise
// a median cut over a 6-bit-per-channel colour histogram, refined by two k-means passes,
// picks the colours. 2. Each pixel gets a palette index, with optional Floyd–Steinberg
// error diffusion (serpentine). 3. Variable-length LZW, packed into 255-byte sub-blocks.
// Pixels with alpha < 128 become one transparent index (Graphic Control Extension); the
// colour of every other pixel is kept as is (alpha is dropped, not blended with anything).

const TRANSPARENT_ALPHA = 128;
// Channel weights for colour distances: green matters most to the eye, blue least.
const WR = 3, WG = 4, WB = 2;

export function encodeGif(rgba, width, height, { dither = true, maxColors = 256 } = {}) {
  width = Math.round(width); height = Math.round(height);
  if (!(width >= 1 && height >= 1 && width <= 65535 && height <= 65535)) {
    throw new Error('GIF images must be between 1 and 65535 pixels wide and high');
  }
  const n = width * height;
  if (!rgba || rgba.length < n * 4) throw new Error('Not enough pixel data for the image size');

  let hasTransparent = false;
  for (let i = 3; i < n * 4; i += 4) if (rgba[i] < TRANSPARENT_ALPHA) { hasTransparent = true; break; }
  const room = Math.max(2, Math.min(256, Math.round(maxColors))) - (hasTransparent ? 1 : 0);

  let palette, indices;
  const exact = exactColors(rgba, n, room);
  if (exact) {
    palette = exact.palette;
    indices = exact.indices;
  } else {
    palette = medianCut(rgba, n, room);
    indices = dither ? mapDithered(rgba, width, height, palette) : mapPlain(rgba, n, palette);
  }
  let colors = palette.length / 3;
  let transparentIndex = -1;
  if (hasTransparent) {
    transparentIndex = colors++;
    for (let i = 0; i < n; i++) if (rgba[i * 4 + 3] < TRANSPARENT_ALPHA) indices[i] = transparentIndex;
  }

  // Colour table: 2^bits entries, bits 1..8. LZW minimum code size is at least 2.
  let bits = 1;
  while ((1 << bits) < colors) bits++;
  const out = new ByteWriter(1024 + (n >> 1));
  out.ascii('GIF89a');
  out.u16(width); out.u16(height);
  out.byte(0x80 | (7 << 4) | (bits - 1)); // global colour table, 8-bit colour resolution
  out.byte(0); out.byte(0); // background index, pixel aspect ratio
  for (let i = 0; i < 1 << bits; i++) {
    if (i * 3 < palette.length) { out.byte(palette[i * 3]); out.byte(palette[i * 3 + 1]); out.byte(palette[i * 3 + 2]); }
    else { out.byte(0); out.byte(0); out.byte(0); }
  }
  if (transparentIndex >= 0) {
    // Graphic Control Extension: no disposal, no delay, transparency flag set.
    out.byte(0x21); out.byte(0xf9); out.byte(4); out.byte(0x01); out.u16(0); out.byte(transparentIndex); out.byte(0);
  }
  out.byte(0x2c); out.u16(0); out.u16(0); out.u16(width); out.u16(height); out.byte(0); // image descriptor
  const minCodeSize = Math.max(2, bits);
  out.byte(minCodeSize);
  writeLzw(out, indices, minCodeSize);
  out.byte(0x3b); // trailer
  return out.result();
}

/** Distinct opaque colours, if there are at most `limit`. Returns { palette, indices } or null. */
function exactColors(rgba, n, limit) {
  const seen = new Map();
  const indices = new Uint8Array(n);
  const palette = [];
  let lastKey = -1, lastIdx = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (rgba[p + 3] < TRANSPARENT_ALPHA) continue;
    const key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
    if (key !== lastKey) {
      let idx = seen.get(key);
      if (idx === undefined) {
        if (seen.size >= limit) return null;
        idx = seen.size;
        seen.set(key, idx);
        palette.push(rgba[p], rgba[p + 1], rgba[p + 2]);
      }
      lastKey = key; lastIdx = idx;
    }
    indices[i] = lastIdx;
  }
  if (!palette.length) palette.push(0, 0, 0); // fully transparent image
  return { palette: Uint8Array.from(palette), indices };
}

// ---- palette by median cut --------------------------------------------------------------
// Histogram cells hold 6 bits per channel (262,144 cells); each cell keeps the count and the
// exact colour sums of its pixels, so palette entries are true averages, not cell centres.

function medianCut(rgba, n, maxColors) {
  const CELLS = 1 << 18;
  const count = new Uint32Array(CELLS);
  const sr = new Float64Array(CELLS), sg = new Float64Array(CELLS), sb = new Float64Array(CELLS);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (rgba[p + 3] < TRANSPARENT_ALPHA) continue;
    const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
    const c = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    count[c]++; sr[c] += r; sg[c] += g; sb[c] += b;
  }
  // Non-empty cells as weighted points.
  let m = 0;
  for (let c = 0; c < CELLS; c++) if (count[c]) m++;
  const w = new Float64Array(m), pr = new Float64Array(m), pg = new Float64Array(m), pb = new Float64Array(m);
  const cell = new Int32Array(m);
  for (let c = 0, k = 0; c < CELLS; c++) {
    if (!count[c]) continue;
    w[k] = count[c]; pr[k] = sr[c] / count[c]; pg[k] = sg[c] / count[c]; pb[k] = sb[c] / count[c]; cell[k] = c; k++;
  }
  const order = new Int32Array(m);
  for (let k = 0; k < m; k++) order[k] = k;
  const coord = [pr, pg, pb];
  const cellShift = [12, 6, 0];

  const stats = (start, end) => {
    let cw = 0, r = 0, g = 0, b = 0, rr = 0, gg = 0, bb = 0;
    for (let j = start; j < end; j++) {
      const k = order[j], x = w[k];
      cw += x; r += x * pr[k]; g += x * pg[k]; b += x * pb[k];
      rr += x * pr[k] * pr[k]; gg += x * pg[k] * pg[k]; bb += x * pb[k] * pb[k];
    }
    const vr = WR * (rr - (r * r) / cw), vg = WG * (gg - (g * g) / cw), vb = WB * (bb - (b * b) / cw);
    const axis = vr >= vg && vr >= vb ? 0 : vg >= vb ? 1 : 2;
    return { start, end, sse: end - start > 1 ? vr + vg + vb : 0, axis };
  };

  const boxes = [stats(0, m)];
  const tmp = new Int32Array(m);
  while (boxes.length < maxColors) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].sse > 0 && (best < 0 || boxes[i].sse > boxes[best].sse)) best = i;
    if (best < 0) break;
    const { start, end, axis } = boxes[best];
    // Counting sort of the box's points by their 6-bit cell coordinate on the split axis.
    const buckets = new Int32Array(65);
    const shift = cellShift[axis];
    for (let j = start; j < end; j++) buckets[((cell[order[j]] >> shift) & 63) + 1]++;
    for (let v = 1; v <= 64; v++) buckets[v] += buckets[v - 1];
    for (let j = start; j < end; j++) { const k = order[j]; tmp[start + buckets[(cell[k] >> shift) & 63]++] = k; }
    order.set(tmp.subarray(start, end), start);
    // Split where the summed squared error along that axis of the two halves is smallest.
    const a = coord[axis];
    let tw = 0, ts = 0;
    for (let j = start; j < end; j++) { const k = order[j]; tw += w[k]; ts += w[k] * a[k]; }
    let lw = 0, ls = 0, cut = start + 1, bestScore = -Infinity;
    for (let j = start; j < end - 1; j++) {
      const k = order[j];
      lw += w[k]; ls += w[k] * a[k];
      // Minimising SSE is the same as maximising ls²/lw + rs²/rw.
      const rw = tw - lw, rs = ts - ls;
      const score = (ls * ls) / lw + (rs * rs) / rw;
      if (score > bestScore) { bestScore = score; cut = j + 1; }
    }
    boxes.splice(best, 1, stats(start, cut), stats(cut, end));
  }

  // Palette = weighted mean of each box, then a few k-means passes over the histogram points.
  let pal = new Float64Array(boxes.length * 3);
  boxes.forEach((bx, i) => {
    let cw = 0, r = 0, g = 0, b = 0;
    for (let j = bx.start; j < bx.end; j++) { const k = order[j]; cw += w[k]; r += w[k] * pr[k]; g += w[k] * pg[k]; b += w[k] * pb[k]; }
    pal[i * 3] = r / cw; pal[i * 3 + 1] = g / cw; pal[i * 3 + 2] = b / cw;
  });
  const colors = boxes.length;
  for (let pass = 0; pass < 2; pass++) {
    const acc = new Float64Array(colors * 4);
    for (let k = 0; k < m; k++) {
      const i = nearest(pal, colors, pr[k], pg[k], pb[k]);
      acc[i * 4] += w[k]; acc[i * 4 + 1] += w[k] * pr[k]; acc[i * 4 + 2] += w[k] * pg[k]; acc[i * 4 + 3] += w[k] * pb[k];
    }
    for (let i = 0; i < colors; i++) {
      if (!acc[i * 4]) continue; // keep an entry that lost all its points
      pal[i * 3] = acc[i * 4 + 1] / acc[i * 4]; pal[i * 3 + 1] = acc[i * 4 + 2] / acc[i * 4]; pal[i * 3 + 2] = acc[i * 4 + 3] / acc[i * 4];
    }
  }
  const out = new Uint8Array(colors * 3);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(pal[i]);
  return out;
}

function nearest(pal, colors, r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0, j = 0; i < colors; i++, j += 3) {
    const dr = pal[j] - r, dg = pal[j + 1] - g, db = pal[j + 2] - b;
    const d = WR * dr * dr + WG * dg * dg + WB * db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// ---- pixels to palette indices --------------------------------------------------------
// Nearest-colour answers are cached per 6-bit cell, so each cell is searched at most once.

function makeLookup(palette) {
  const colors = palette.length / 3;
  const cache = new Int16Array(1 << 18).fill(-1);
  return (r, g, b) => {
    const c = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let idx = cache[c];
    if (idx < 0) idx = cache[c] = nearest(palette, colors, (r & ~3) + 1.5, (g & ~3) + 1.5, (b & ~3) + 1.5);
    return idx;
  };
}

function mapPlain(rgba, n, palette) {
  const lookup = makeLookup(palette);
  const indices = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) indices[i] = lookup(rgba[p], rgba[p + 1], rgba[p + 2]);
  return indices;
}

/** Floyd–Steinberg error diffusion, alternating direction on each row. */
function mapDithered(rgba, width, height, palette) {
  const lookup = makeLookup(palette);
  const indices = new Uint8Array(width * height);
  // Error rows with one spare pixel on each side: cur = this row, next = the row below.
  let cur = new Float32Array((width + 2) * 3), next = new Float32Array((width + 2) * 3);
  for (let y = 0; y < height; y++) {
    const ltr = (y & 1) === 0;
    const dir = ltr ? 1 : -1;
    for (let s = 0; s < width; s++) {
      const x = ltr ? s : width - 1 - s;
      const i = y * width + x, p = i * 4, e = (x + 1) * 3;
      if (rgba[p + 3] < TRANSPARENT_ALPHA) continue; // transparent: no colour, no error to pass on
      const r = clampByte(rgba[p] + cur[e]), g = clampByte(rgba[p + 1] + cur[e + 1]), b = clampByte(rgba[p + 2] + cur[e + 2]);
      const idx = lookup(r, g, b);
      indices[i] = idx;
      const er = r - palette[idx * 3], eg = g - palette[idx * 3 + 1], eb = b - palette[idx * 3 + 2];
      const ahead = e + dir * 3, behindBelow = e - dir * 3, aheadBelow = e + dir * 3;
      cur[ahead] += er * 0.4375; cur[ahead + 1] += eg * 0.4375; cur[ahead + 2] += eb * 0.4375;
      next[behindBelow] += er * 0.1875; next[behindBelow + 1] += eg * 0.1875; next[behindBelow + 2] += eb * 0.1875;
      next[e] += er * 0.3125; next[e + 1] += eg * 0.3125; next[e + 2] += eb * 0.3125;
      next[aheadBelow] += er * 0.0625; next[aheadBelow + 1] += eg * 0.0625; next[aheadBelow + 2] += eb * 0.0625;
    }
    const t = cur; cur = next; next = t;
    next.fill(0);
  }
  return indices;
}

function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

// ---- LZW ---------------------------------------------------------------------------------
// Codes start at minCodeSize + 1 bits and grow to 12. When all 4096 codes are taken, a clear
// code is sent and the table starts again. The table is a flat array indexed by
// (prefix code << 8 | next index); a generation number per slot makes "start again" O(1).

function writeLzw(out, indices, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  const slots = 4096 << 8;
  const codeAt = new Uint16Array(slots);
  const genAt = new Uint32Array(slots);
  let gen = 1;
  let codeSize = minCodeSize + 1, nextCode = eoi + 1;
  const blocks = new SubBlockWriter(out);
  let bitBuf = 0, bitCount = 0;
  const emit = (code) => {
    bitBuf |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) { blocks.byte(bitBuf & 0xff); bitBuf >>>= 8; bitCount -= 8; }
  };

  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const slot = (prefix << 8) | k;
    if (genAt[slot] === gen) { prefix = codeAt[slot]; continue; }
    emit(prefix);
    if (nextCode < 4096) {
      codeAt[slot] = nextCode; genAt[slot] = gen;
      nextCode++;
      // The decoder adds its entry one code later, so widen once the code it is about to add needs it.
      if (nextCode > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      gen++;
      codeSize = minCodeSize + 1; nextCode = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bitCount > 0) blocks.byte(bitBuf & 0xff);
  blocks.end();
}

/** Image data goes out in sub-blocks: a length byte (1..255) then that many bytes; 0 ends. */
class SubBlockWriter {
  constructor(out) { this.out = out; this.buf = new Uint8Array(255); this.len = 0; }
  byte(b) {
    this.buf[this.len++] = b;
    if (this.len === 255) this.flush();
  }
  flush() {
    if (!this.len) return;
    this.out.byte(this.len);
    this.out.bytes(this.buf.subarray(0, this.len));
    this.len = 0;
  }
  end() { this.flush(); this.out.byte(0); }
}

class ByteWriter {
  constructor(size) { this.buf = new Uint8Array(Math.max(256, size)); this.len = 0; }
  ensure(extra) {
    if (this.len + extra <= this.buf.length) return;
    const bigger = new Uint8Array(Math.max(this.buf.length * 2, this.len + extra));
    bigger.set(this.buf.subarray(0, this.len));
    this.buf = bigger;
  }
  byte(b) { this.ensure(1); this.buf[this.len++] = b; }
  bytes(a) { this.ensure(a.length); this.buf.set(a, this.len); this.len += a.length; }
  u16(v) { this.byte(v & 0xff); this.byte((v >> 8) & 0xff); }
  ascii(s) { for (const ch of s) this.byte(ch.charCodeAt(0)); }
  result() { return this.buf.slice(0, this.len); }
}
