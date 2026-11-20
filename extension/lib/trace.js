// Saveform vector tracer ("PNG to SVG", "JPG to SVG"). Turns pixels into filled SVG paths, so
// the result is a real vector drawing (scales without blur, editable in Inkscape/Illustrator,
// usable by cutting machines), not a bitmap wrapped in an SVG file. Written for Saveform; no
// dependencies, no network, plain typed arrays.
//
//   traceImage(rgba, width, height, { colors = 8, detail = 'normal', outWidth, outHeight })
//     -> { svg, colors, paths, layers }
//
// colors: 'bw' (one black shape on a transparent background, e.g. for cutting machines) or
// 2..64 colours. detail: 'high' | 'normal' | 'low' (how far edges may be simplified and how big
// a blob must be to be kept).
//
// Steps:
// 1. Colours. Pixels with alpha < 128 are transparent and never traced. The palette is chosen
//    (lib/png-quant.js choosePalette) from "flat" pixels only, ones that match their four
//    neighbours, so the in-between colours of anti-aliased edges do not get palette entries of
//    their own; entries within ~20 levels of a more common one are merged (JPEG noise otherwise
//    splits one white into several); every pixel then takes the nearest palette colour. 'bw' uses Otsu's threshold on
//    luminance (composited on white).
// 2. Despeckle. Connected regions (4-neighbour) smaller than the speckle size join the colour
//    that surrounds them most.
// 3. Layers. Colours are sorted by area, largest first. Layer k is the union of every colour
//    from rank k on, filled with colour k, and later layers are drawn on top. Each visible
//    pixel ends up under its own colour, and neighbouring colours overlap instead of meeting at
//    an edge, so no hairline gaps show between shapes when the SVG is rendered.
// 4. Contours. Each layer's outline is followed along pixel edges (inside on the right; at a
//    vertex where two pixels touch diagonally the walk turns right, so they stay separate). The
//    midpoints of the unit edges turn 1-pixel staircases into straight lines.
// 5. Curves. Corners are found first (the direction over 3 points either side turns by 60° or
//    more), because a pixel corner shifts the edge midpoints by less than the tolerance. Then
//    Douglas–Peucker, split at the corners, simplifies each closed outline to within the detail
//    tolerance; remaining cut-off corners (a short segment between two long ones, turning the
//    same way) are restored to their sharp point. Vertices that turn by 70° or more stay
//    corners; the rest become quadratic Béziers between segment midpoints, with the vertex as
//    control point, so curves are smooth. Before that, every simplified segment is refitted as
//    the least-squares line through the outline points it covers and vertices move to where
//    neighbouring lines meet: the polygon then hugs the shape instead of its staircase extremes.
//    Paths use fill-rule evenodd, so holes need no special handling.

import { choosePalette } from './png-quant.js';

/** Longest side the tracer works at; larger images are scaled down first (by the caller). */
export const TRACE_MAX_SIDE = 2000;
/**
 * Smaller images are scaled up (smoothly, at most TRACE_MAX_UPSCALE times) to this longest side
 * before tracing, so outlines follow the anti-aliased edges instead of the coarse pixel grid
 * (a 48 px logo traced as is loses thin strokes). Pixel art comes out rounded as a result.
 */
export const TRACE_MIN_SIDE = 512;
export const TRACE_MAX_UPSCALE = 8;

const DETAIL = {
  high: { tol: 0.5, speckleMin: 2, speckleDiv: 250000 },
  normal: { tol: 0.8, speckleMin: 4, speckleDiv: 40000 },
  low: { tol: 1.3, speckleMin: 12, speckleDiv: 8000 },
};
const CORNER_TURN = (70 * Math.PI) / 180;
const WR = 3, WG = 4, WB = 2; // colour distance weights (as in gif.js / png-quant.js)

export function traceImage(rgba, width, height, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Width and height must be whole numbers of at least 1');
  }
  const n = width * height;
  if (!rgba || rgba.length !== n * 4) throw new Error(`Pixel data must be ${n * 4} bytes for a ${width}×${height} image`);
  const bw = options.colors === 'bw';
  const maxColors = bw ? 1 : Math.max(2, Math.min(64, Math.round(Number(options.colors) || 8)));
  const det = DETAIL[options.detail] || DETAIL.normal;
  const speckle = Math.max(det.speckleMin, Math.round(n / det.speckleDiv));

  // 1. labels: 0 = transparent, 1..k = palette entry k-1
  const { labels, palette } = bw ? labelBw(rgba, n) : labelColors(rgba, width, height, maxColors);
  // 2. despeckle
  despeckle(labels, width, height, speckle);
  despeckle(labels, width, height, speckle);
  // 3. layers, largest colour first
  const k = palette.length / 4;
  const area = new Float64Array(k + 1);
  for (let i = 0; i < n; i++) area[labels[i]]++;
  const order = [];
  for (let c = 1; c <= k; c++) if (area[c] > 0) order.push(c);
  order.sort((a, b) => area[b] - area[a]);
  const rank = new Uint16Array(k + 1); // 0 = transparent; 1.. = position in order + 1
  order.forEach((c, i) => { rank[c] = i + 1; });
  const rk = new Uint16Array(n);
  for (let i = 0; i < n; i++) rk[i] = rank[labels[i]];

  const parts = [];
  let paths = 0;
  for (let li = 0; li < order.length; li++) {
    const loops = traceLayer(rk, width, height, li + 1);
    let d = '';
    for (const loop of loops) {
      const s = loopPath(loop, det.tol);
      if (s) { d += s; paths++; }
    }
    if (!d) continue;
    const c = order[li] - 1;
    parts.push(`<path fill="${hex(palette, c)}" fill-rule="evenodd" d="${d}"/>`);
  }
  const ow = options.outWidth || width, oh = options.outHeight || height;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ow}" height="${oh}" viewBox="0 0 ${width} ${height}">\n${parts.join('\n')}\n</svg>\n`;
  return { svg, colors: order.length, paths, layers: parts.length };
}

// ---- 1. colours -----------------------------------------------------------------------------

function labelBw(rgba, n) {
  const lum = new Uint8Array(n);
  const hist = new Float64Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = rgba[p + 3];
    const y = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    const v = Math.round(255 - (a / 255) * (255 - y)); // on white
    lum[i] = v;
    hist[v]++;
  }
  const t = otsu(hist, n);
  const labels = new Uint16Array(n);
  for (let i = 0; i < n; i++) labels[i] = lum[i] <= t ? 1 : 0;
  return { labels, palette: Uint8Array.from([0, 0, 0, 255]) };
}

/** Otsu's threshold: the level that best separates the histogram into two classes. */
export function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = -1, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i; }
  }
  return t;
}

function labelColors(rgba, width, height, maxColors) {
  const n = width * height;
  const opaque = (p) => rgba[p + 3] >= 128;
  const close = (p, q) => Math.abs(rgba[p] - rgba[q]) <= 12 && Math.abs(rgba[p + 1] - rgba[q + 1]) <= 12 && Math.abs(rgba[p + 2] - rgba[q + 2]) <= 12;
  let opaqueCount = 0, flatCount = 0;
  const flat = new Uint8Array(n);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const p = i * 4;
      if (!opaque(p)) continue;
      opaqueCount++;
      let ok = true;
      if (x > 0) ok = ok && opaque(p - 4) && close(p, p - 4);
      if (x < width - 1) ok = ok && opaque(p + 4) && close(p, p + 4);
      if (y > 0) ok = ok && opaque(p - width * 4) && close(p, p - width * 4);
      if (y < height - 1) ok = ok && opaque(p + width * 4) && close(p, p + width * 4);
      if (ok) { flat[i] = 1; flatCount++; }
    }
  }
  const labels = new Uint16Array(n);
  if (!opaqueCount) return { labels, palette: new Uint8Array(0) };
  // Photos and gradients have few flat pixels; then every opaque pixel counts.
  const useFlat = flatCount >= 64 && flatCount >= opaqueCount * 0.05;
  const m = useFlat ? flatCount : opaqueCount;
  const sample = new Uint8Array(m * 4);
  for (let i = 0, j = 0; i < n; i++) {
    const p = i * 4;
    if (useFlat ? !flat[i] : !opaque(p)) continue;
    sample[j++] = rgba[p]; sample[j++] = rgba[p + 1]; sample[j++] = rgba[p + 2]; sample[j++] = 255;
  }
  const palette = mergeClose(choosePalette(sample, m, maxColors), sample, m);
  const k = palette.length / 4;
  // Nearest palette entry, cached per 6-bit-per-channel cell (looked up for the cell's centre).
  const cache = new Int16Array(1 << 18).fill(-1);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (rgba[p + 3] < 128) continue;
    const key = ((rgba[p] >> 2) << 12) | ((rgba[p + 1] >> 2) << 6) | (rgba[p + 2] >> 2);
    let best = cache[key];
    if (best < 0) {
      const r = (rgba[p] & 0xfc) | 2, g = (rgba[p + 1] & 0xfc) | 2, b = (rgba[p + 2] & 0xfc) | 2;
      let bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = r - palette[c * 4], dg = g - palette[c * 4 + 1], db = b - palette[c * 4 + 2];
        const dd = WR * dr * dr + WG * dg * dg + WB * db * db;
        if (dd < bd) { bd = dd; best = c; }
      }
      cache[key] = best;
    }
    labels[i] = best + 1;
  }
  return { labels, palette };
}

/**
 * Asking for more colours than a picture has makes the palette split one colour into near twins
 * (JPEG noise gives several whites); pixels would then flip between them and trace into specks.
 * Entries closer than MERGE_DIST to a more common entry are dropped.
 */
const MERGE_DIST = (WR + WG + WB) * 20 * 20; // about 20 levels in every channel
function mergeClose(palette, sample, m) {
  const k = palette.length / 4;
  if (k < 2) return palette;
  const dist = (i, j) => {
    const dr = palette[i * 4] - palette[j * 4], dg = palette[i * 4 + 1] - palette[j * 4 + 1], db = palette[i * 4 + 2] - palette[j * 4 + 2];
    return WR * dr * dr + WG * dg * dg + WB * db * db;
  };
  const count = new Float64Array(k);
  const step = Math.max(1, Math.floor(m / 200000));
  for (let i = 0; i < m; i += step) {
    const p = i * 4;
    let best = 0, bd = Infinity;
    for (let c = 0; c < k; c++) {
      const dr = sample[p] - palette[c * 4], dg = sample[p + 1] - palette[c * 4 + 1], db = sample[p + 2] - palette[c * 4 + 2];
      const d = WR * dr * dr + WG * dg * dg + WB * db * db;
      if (d < bd) { bd = d; best = c; }
    }
    count[best]++;
  }
  const order = [...Array(k).keys()].sort((a, b) => count[b] - count[a]);
  const kept = [];
  for (const c of order) if (count[c] > 0 && kept.every((j) => dist(c, j) >= MERGE_DIST)) kept.push(c);
  const out = new Uint8Array(kept.length * 4);
  kept.forEach((c, j) => out.set(palette.subarray(c * 4, c * 4 + 4), j * 4));
  return out;
}

// ---- 2. despeckle -----------------------------------------------------------------------------

function despeckle(labels, width, height, minArea) {
  if (minArea <= 1) return;
  const n = width * height;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const counts = new Map();
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const lab = labels[s];
    let top = 0, size = 0;
    stack[top++] = s; seen[s] = 1;
    // The region's pixels are collected at the front of `stack` (read index `size`).
    while (size < top) {
      const i = stack[size++];
      const x = i % width;
      if (x > 0 && !seen[i - 1] && labels[i - 1] === lab) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < width - 1 && !seen[i + 1] && labels[i + 1] === lab) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (i >= width && !seen[i - width] && labels[i - width] === lab) { seen[i - width] = 1; stack[top++] = i - width; }
      if (i + width < n && !seen[i + width] && labels[i + width] === lab) { seen[i + width] = 1; stack[top++] = i + width; }
    }
    if (size >= minArea) continue;
    counts.clear();
    const bump = (j) => { const l = labels[j]; if (l !== lab) counts.set(l, (counts.get(l) || 0) + 1); };
    for (let t = 0; t < size; t++) {
      const i = stack[t];
      const x = i % width;
      if (x > 0) bump(i - 1);
      if (x < width - 1) bump(i + 1);
      if (i >= width) bump(i - width);
      if (i + width < n) bump(i + width);
    }
    let to = -1, most = 0;
    for (const [l, c] of counts) if (c > most) { most = c; to = l; }
    if (to < 0) continue; // the whole image is one region
    for (let t = 0; t < size; t++) labels[stack[t]] = to;
  }
}

// ---- 4. contours ------------------------------------------------------------------------------

const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // +x, +y (down), -x, -y

/**
 * Outlines of the pixels with rk >= level, as loops of points (x, y pairs in a Float64Array):
 * the midpoints of the boundary's unit edges.
 */
function traceLayer(rk, width, height, level) {
  const W = width + 1;
  const out = new Uint8Array(W * (height + 1)); // bit d = an edge leaves this vertex in direction d
  let any = false;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      if (rk[i] < level) continue;
      any = true;
      const v = y * W + x;
      if (y === 0 || rk[i - width] < level) out[v] |= 1; // top edge, going +x
      if (x === width - 1 || rk[i + 1] < level) out[v + 1] |= 2; // right edge, going +y
      if (y === height - 1 || rk[i + width] < level) out[v + W + 1] |= 4; // bottom edge, going -x
      if (x === 0 || rk[i - 1] < level) out[v + W] |= 8; // left edge, going -y
    }
  }
  if (!any) return [];
  const loops = [];
  const pts = [];
  for (let v0 = 0; v0 < out.length; v0++) {
    while (out[v0]) {
      pts.length = 0;
      let v = v0, d = 31 - Math.clz32(out[v0] & -out[v0]); // lowest set bit
      for (;;) {
        out[v] &= ~(1 << d);
        const x = v % W, y = (v - x) / W;
        pts.push(x + DX[d] / 2, y + DY[d] / 2, d);
        v += DX[d] + DY[d] * W;
        if (v === v0) break;
        const o = out[v];
        const r = (d + 1) & 3, l = (d + 3) & 3;
        d = o & (1 << r) ? r : o & (1 << d) ? d : l;
        if (!(o & (1 << d))) break; // cannot happen on a well-formed outline
      }
      loops.push(compact(pts));
    }
  }
  return loops;
}

function compact(pts) {
  const m = pts.length / 3;
  const a = new Float64Array(m * 2);
  for (let i = 0; i < m; i++) { a[i * 2] = pts[i * 3]; a[i * 2 + 1] = pts[i * 3 + 1]; }
  return a;
}

// ---- 5. simplify and fit curves ---------------------------------------------------------------

const CORNER_SPAN = 3; // outline points looked at on each side when finding corners
const CORNER_FIND = (60 * Math.PI) / 180;

function loopPath(loop, tol) {
  const m = loop.length / 2;
  if (m < 4) return '';
  const anchors = findCorners(loop);
  const keep = simplifyClosed(loop, tol, anchors);
  if (keep.length < 3) return '';
  const isAnchor = new Uint8Array(m);
  for (const i of anchors) isAnchor[i] = 1;
  const fitted = fitVertices(loop, keep, isAnchor, tol);
  const { pts, corner } = restoreCorners(fitted.pts, fitted.corner);
  const k = pts.length;
  if (k < 3) return '';
  const X = (i) => pts[((i % k) + k) % k][0], Y = (i) => pts[((i % k) + k) % k][1];
  const midX = (i) => (X(i) + X(i + 1)) / 2, midY = (i) => (Y(i) + Y(i + 1)) / 2;
  let s = `M${num(midX(-1))} ${num(midY(-1))}`;
  for (let i = 0; i < k; i++) {
    const isCorner = corner[i] || turnAngle(X(i - 1), Y(i - 1), X(i), Y(i), X(i + 1), Y(i + 1)) >= CORNER_TURN;
    if (isCorner) s += `L${num(X(i))} ${num(Y(i))}L${num(midX(i))} ${num(midY(i))}`;
    else s += `Q${num(X(i))} ${num(Y(i))} ${num(midX(i))} ${num(midY(i))}`;
  }
  return s + 'Z';
}

/**
 * Corners of an outline: points where the direction over CORNER_SPAN points before and after
 * turns by CORNER_FIND or more, keeping only the sharpest point of each bend. A pixel corner
 * moves the edge midpoints by only ~0.35 px, less than the simplification tolerance, so corners
 * have to be found before simplifying or they get rounded away.
 */
function findCorners(loop) {
  const m = loop.length / 2;
  const k = Math.min(CORNER_SPAN, Math.floor(m / 4));
  if (k < 1) return [];
  const at = (i) => (((i % m) + m) % m) * 2;
  const ang = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const a = at(i - k), b = at(i), c = at(i + k);
    ang[i] = turnAngle(loop[a], loop[a + 1], loop[b], loop[b + 1], loop[c], loop[c + 1]);
  }
  const out = [];
  for (let i = 0; i < m; i++) {
    if (ang[i] < CORNER_FIND) continue;
    let max = true;
    for (let j = -k; j <= k && max; j++) {
      if (!j) continue;
      const v = ang[(((i + j) % m) + m) % m];
      if (v > ang[i] || (v === ang[i] && j < 0)) max = false; // ties: the earlier point wins
    }
    if (max) out.push(i);
  }
  return out;
}

/**
 * Douglas–Peucker on a closed loop, split at the corners (or, without corners, at a point and the
 * point farthest from it). Then any kept point that is not a corner is dropped if its neighbours
 * can be joined directly within the tolerance. Returns the indices of the points kept, ascending.
 */
function simplifyClosed(loop, tol, anchors) {
  const m = loop.length / 2;
  const x = (i) => loop[(i % m) * 2], y = (i) => loop[(i % m) * 2 + 1];
  const tol2 = tol * tol;
  const keep = new Uint8Array(m);
  let splits;
  if (anchors.length >= 2) splits = anchors;
  else {
    const s0 = anchors.length ? anchors[0] : 0;
    let far = s0, fd = -1;
    for (let i = 1; i < m; i++) {
      const d = (x(s0 + i) - x(s0)) ** 2 + (y(s0 + i) - y(s0)) ** 2;
      if (d > fd) { fd = d; far = (s0 + i) % m; }
    }
    splits = [s0, far].sort((a, b) => a - b);
  }
  const stack = [];
  for (let j = 0; j < splits.length; j++) {
    keep[splits[j]] = 1;
    stack.push([splits[j], j + 1 < splits.length ? splits[j + 1] : splits[0] + m]);
  }
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const ax = x(a), ay = y(a), bx = x(b), by = y(b);
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, bd = tol2;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (len2 === 0) d = (x(i) - ax) ** 2 + (y(i) - ay) ** 2;
      else { const c = dx * (y(i) - ay) - dy * (x(i) - ax); d = (c * c) / len2; }
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0) { keep[best % m] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < m; i++) if (keep[i]) out.push(i);
  const fixed = new Uint8Array(m);
  for (const i of anchors) fixed[i] = 1;
  const within = (a, b) => {
    const ax = x(a), ay = y(a), dx = x(b) - ax, dy = y(b) - ay, len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const d = len2 === 0 ? (x(i) - ax) ** 2 + (y(i) - ay) ** 2 : (dx * (y(i) - ay) - dy * (x(i) - ax)) ** 2 / len2;
      if (d > tol2) return false;
    }
    return true;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < out.length && out.length > 3; ) {
      const k = out.length;
      if (fixed[out[j]]) { j++; continue; }
      const a = out[(j + k - 1) % k];
      const next = out[(j + 1) % k];
      const b = next <= a ? next + m : next;
      if (within(a, b)) out.splice(j, 1);
      else j++;
    }
  }
  return out;
}

/**
 * Each simplified segment becomes the least-squares line through the outline points strictly
 * inside it (all of them if there are fewer than two), and each vertex moves to where its two
 * lines meet: unless that is farther than tol + 0.5 px (3 px at a corner), as when the lines are
 * nearly parallel. Returns { pts: [[x, y], ...], corner: [bool, ...] }.
 */
function fitVertices(loop, keep, isAnchor, tol) {
  const m = loop.length / 2, k = keep.length;
  const lines = [];
  for (let j = 0; j < k; j++) {
    let a = keep[j], b = j + 1 < k ? keep[j + 1] : keep[0] + m;
    if (b - a - 1 >= 2) { a++; b--; }
    let sx = 0, sy = 0, c = 0;
    for (let i = a; i <= b; i++) { sx += loop[(i % m) * 2]; sy += loop[(i % m) * 2 + 1]; c++; }
    const cx = sx / c, cy = sy / c;
    let xx = 0, xy = 0, yy = 0;
    for (let i = a; i <= b; i++) {
      const dx = loop[(i % m) * 2] - cx, dy = loop[(i % m) * 2 + 1] - cy;
      xx += dx * dx; xy += dx * dy; yy += dy * dy;
    }
    const ang = 0.5 * Math.atan2(2 * xy, xx - yy); // principal direction
    lines.push([[cx, cy], [cx + Math.cos(ang), cy + Math.sin(ang)]]);
  }
  const pts = [], corner = [];
  for (let j = 0; j < k; j++) {
    const o = [loop[keep[j] * 2], loop[keep[j] * 2 + 1]];
    const L1 = lines[(j + k - 1) % k], L2 = lines[j];
    const X = intersect(L1[0], L1[1], L2[0], L2[1]);
    const maxMove = isAnchor[keep[j]] ? 3 : tol + 0.5;
    pts.push(X && Math.hypot(X[0] - o[0], X[1] - o[1]) <= maxMove ? X : o);
    corner.push(!!isAnchor[keep[j]]);
  }
  return { pts, corner };
}

/**
 * Put back sharp corners that were not found as corners: a short segment (≤ 1.5 px) between two
 * long ones (≥ 2.5 px), turning the same way at both ends by 60° or more in total, is replaced
 * by the point where the two long segments' lines meet, if that point is within 2.5 px of it.
 */
function restoreCorners(P, cornerIn) {
  const k = P.length;
  const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Rotate so the closing segment (P[k-1] → P[0]) is the longest; it is never the short one.
  let li = 0, ll = -1;
  for (let i = 0; i < k; i++) { const l = len(P[i], P[(i + 1) % k]); if (l > ll) { ll = l; li = i; } }
  const order = [];
  for (let i = 0; i < k; i++) order.push((li + 1 + i) % k);
  const at = (i) => P[order[((i % k) + k) % k]];
  const pts = [], corner = [];
  for (let i = 0; i < k; i++) {
    if (i < k - 1) {
      const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
      if (len(b, c) <= 1.5 && len(a, b) >= 2.5 && len(c, d) >= 2.5) {
        const t1 = signedTurn(a, b, c), t2 = signedTurn(b, c, d);
        if (Math.sign(t1) === Math.sign(t2) && Math.abs(t1 + t2) >= Math.PI / 3) {
          const X = intersect(a, b, c, d);
          if (X && Math.hypot(X[0] - (b[0] + c[0]) / 2, X[1] - (b[1] + c[1]) / 2) <= 2.5) {
            pts.push(X); corner.push(true); i++; continue;
          }
        }
      }
    }
    pts.push(at(i)); corner.push(cornerIn[order[i]]);
  }
  return { pts, corner };
}

function signedTurn(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}
function turnAngle(ax, ay, bx, by, cx, cy) {
  const ux = bx - ax, uy = by - ay, vx = cx - bx, vy = cy - by;
  return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
}
function intersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

function num(v) {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}
function hex(palette, c) {
  return '#' + [0, 1, 2].map((j) => palette[c * 4 + j].toString(16).padStart(2, '0')).join('');
}
