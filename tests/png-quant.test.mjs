// Unit tests for the indexed-colour PNG writer (extension/lib/png-quant.js).
//   node --test tests/png-quant.test.mjs
// Every PNG is read twice: by a small reader below (written from the PNG spec: chunk CRCs,
// IHDR/PLTE/tRNS rules, zlib via node:zlib, filter bytes, sub-byte packing and row padding) and,
// when python3 with Pillow is present, by Pillow (libpng-independent, its own PNG decoder).
// pngcheck is run as well when it is installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync, deflateSync, crc32 as zlibCrc32 } from 'node:zlib';
import { encodePng8 } from '../extension/lib/png-quant.js';

let hasPillow = false;
try { execFileSync('python3', ['-I', '-c', 'import PIL'], { stdio: 'pipe' }); hasPillow = true; } catch { hasPillow = false; }
let pngcheck = null;
try { pngcheck = execFileSync('which', ['pngcheck'], { stdio: 'pipe' }).toString().trim() || null; } catch { pngcheck = null; }

const tmp = mkdtempSync(join(tmpdir(), 'png-quant-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
let fileNo = 0;

/** Decode with Pillow; returns { w, h, mode, data: RGBA Buffer } or null without Pillow. */
function pillowDecode(png) {
  if (!hasPillow) return null;
  const src = join(tmp, `in${++fileNo}.png`), dst = join(tmp, `out${fileNo}.rgba`);
  writeFileSync(src, png);
  const script = 'import sys, json\nfrom PIL import Image\nim = Image.open(sys.argv[1])\nim.load()\n'
    + 'mode = im.mode\nopen(sys.argv[2], "wb").write(im.convert("RGBA").tobytes())\n'
    + 'print(json.dumps({"w": im.width, "h": im.height, "mode": mode}))';
  const info = JSON.parse(execFileSync('python3', ['-I', '-c', script, src, dst]).toString());
  return { ...info, data: readFileSync(dst) };
}

function runPngcheck(png) {
  if (!pngcheck) return null;
  const f = join(tmp, `check${++fileNo}.png`);
  writeFileSync(f, png);
  return execFileSync(pngcheck, ['-q', f], { stdio: 'pipe' }).toString();
}

/** Minimal PNG reader for colour type 3; checks structure while reading. */
function readPng(b) {
  b = Buffer.from(b);
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'signature');
  const chunks = [];
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8);
    const data = b.subarray(o + 8, o + 8 + len);
    assert.equal(b.readUInt32BE(o + 8 + len), zlibCrc32(b.subarray(o + 4, o + 8 + len)), `${type} CRC`);
    chunks.push({ type, data });
    o += 12 + len;
  }
  const types = chunks.map((c) => c.type);
  assert.equal(types[0], 'IHDR');
  assert.equal(types.at(-1), 'IEND');
  const ihdr = chunks[0].data;
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), depth = ihdr[8];
  assert.equal(ihdr[9], 3, 'colour type 3');
  assert.deepEqual([...ihdr.subarray(10, 13)], [0, 0, 0], 'compression, filter, interlace');
  assert.ok([1, 2, 4, 8].includes(depth), 'bit depth');
  const plte = chunks.find((c) => c.type === 'PLTE').data;
  const colors = plte.length / 3;
  assert.ok(Number.isInteger(colors) && colors >= 1 && colors <= 1 << depth, 'PLTE size fits the depth');
  const trns = chunks.find((c) => c.type === 'tRNS')?.data ?? Buffer.alloc(0);
  assert.ok(trns.length <= colors, 'tRNS not longer than PLTE');
  const iPlte = types.indexOf('PLTE'), iTrns = types.indexOf('tRNS'), iIdat = types.indexOf('IDAT');
  assert.ok(iPlte < iIdat && (iTrns < 0 || (iPlte < iTrns && iTrns < iIdat)), 'chunk order');
  const z = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  assert.equal(z[0] & 0x0f, 8, 'zlib: deflate');
  assert.equal(((z[0] << 8) | z[1]) % 31, 0, 'zlib: header check');
  const raw = inflateSync(z);
  const rowBytes = Math.ceil((width * depth) / 8);
  assert.equal(raw.length, height * (rowBytes + 1), 'inflated size');
  const indices = new Uint8Array(width * height);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const o = y * (rowBytes + 1);
    assert.equal(raw[o], 0, 'filter type 0');
    const row = raw.subarray(o + 1, o + 1 + rowBytes);
    for (let x = 0; x < width; x++) {
      const bit = x * depth;
      const idx = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      assert.ok(idx < colors, 'index inside the palette');
      indices[y * width + x] = idx;
      rgba.set([plte[idx * 3], plte[idx * 3 + 1], plte[idx * 3 + 2], idx < trns.length ? trns[idx] : 255], (y * width + x) * 4);
    }
    const padBits = rowBytes * 8 - width * depth;
    if (padBits) assert.equal(row[rowBytes - 1] & ((1 << padBits) - 1), 0, 'row padding bits are zero');
  }
  return { width, height, depth, colors, trns, plte, indices, rgba, types };
}

/** Read with both decoders, check they agree, and run pngcheck; returns our reader's result. */
function decodeBoth(png) {
  const ours = readPng(png);
  const pil = pillowDecode(png);
  if (pil) {
    assert.deepEqual([pil.w, pil.h], [ours.width, ours.height], 'Pillow size');
    assert.equal(pil.mode, 'P', 'Pillow sees a palette image');
    assert.ok(pil.data.equals(Buffer.from(ours.rgba)), 'Pillow and our reader decode the same RGBA');
  }
  runPngcheck(png);
  return ours;
}

/** Fully transparent pixels compare as 0,0,0,0 whatever their colour. */
function normalised(px) {
  const out = Uint8Array.from(px);
  for (let i = 0; i < out.length; i += 4) if (out[i + 3] === 0) out[i] = out[i + 1] = out[i + 2] = 0;
  return out;
}

function assertExact(px, got, msg) {
  assert.ok(Buffer.from(normalised(px)).equals(Buffer.from(got)), msg);
}

/** Palette entries with alpha < 255 come first, and tRNS ends at the last of them. */
function assertTrnsOrder(r) {
  const alpha = (i) => (i < r.trns.length ? r.trns[i] : 255);
  if (r.trns.length) assert.ok(r.trns[r.trns.length - 1] < 255, 'tRNS has no trailing 255');
  for (let i = 1; i < r.colors; i++) assert.ok(!(alpha(i - 1) === 255 && alpha(i) < 255), 'translucent entries first');
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/** Photo-like: smooth gradients + noise; alpha ramps 0→255 across x, with a fully clear border. */
function photo(w, h, { alpha = true, seed = 7 } = {}) {
  const rnd = rng(seed);
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, u = x / w, v = y / h;
    d[i] = 255 * u * (0.6 + 0.4 * Math.sin(v * 7)) + (rnd() - 0.5) * 24;
    d[i + 1] = 90 + 120 * v + 40 * Math.sin(u * 9 + v * 3) + (rnd() - 0.5) * 24;
    d[i + 2] = 200 - 150 * u * v + (rnd() - 0.5) * 24;
    d[i + 3] = !alpha ? 255 : x < 4 || y < 4 ? 0 : Math.min(255, Math.round(u * 320));
  }
  return d;
}

/** Composite error: mean abs difference of premultiplied RGB and of alpha, over all pixels. */
function errors(src, got) {
  let ec = 0, ea = 0;
  for (let i = 0; i < src.length; i += 4) {
    const a = src[i + 3] / 255, b = got[i + 3] / 255;
    for (let c = 0; c < 3; c++) ec += Math.abs(src[i + c] * a - got[i + c] * b);
    ea += Math.abs(src[i + 3] - got[i + 3]);
  }
  const n = src.length / 4;
  return { colour: ec / (n * 3), alpha: ea / n };
}

/** Baseline: the same pixels as an RGBA PNG (colour type 6), filter 0, zlib default level. */
function rgbaPngSize(px, w, h) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return 8 + 25 + 12 + deflateSync(raw).length + 12;
}

// ---- lossless cases --------------------------------------------------------------------------

test('3 colours + transparent (23×9): exact round trip at bit depth 2, clear entry first in tRNS', () => {
  return (async () => {
    const w = 23, h = 9, px = new Uint8ClampedArray(w * h * 4);
    const cols = [[200, 30, 40, 255], [20, 160, 60, 255], [250, 250, 250, 255], [9, 99, 199, 0]]; // clear pixel has a stray colour
    for (let i = 0; i < w * h; i++) px.set(cols[(i * 7 + (i >> 3)) % 4], i * 4);
    const r = decodeBoth(await encodePng8(px, w, h));
    assert.equal(r.depth, 2);
    assert.equal(r.colors, 4);
    assert.deepEqual([...r.trns], [0], 'tRNS: one entry, alpha 0');
    assertTrnsOrder(r);
    assertExact(px, r.rgba, 'exact pixels');
  })();
});

test('256 distinct RGBA values (some translucent): exact round trip at depth 8', async () => {
  const w = 16, h = 16, px = new Uint8Array(w * h * 4);
  for (let i = 0; i < 256; i++) px.set([i, (i * 37) & 255, 255 - i, i % 3 === 0 ? 40 + (i % 200) : 255], i * 4);
  const r = decodeBoth(await encodePng8(px, w, h));
  assert.equal(r.depth, 8);
  assert.equal(r.colors, 256);
  assertTrnsOrder(r);
  assert.equal(r.trns.length, [...Array(256).keys()].filter((i) => i % 3 === 0 && 40 + (i % 200) < 255).length);
  assertExact(px, r.rgba, 'exact pixels');
});

test('1×1 images (opaque, translucent, clear) and 7×3 at depths 1, 2, 4 and 8: exact, row padding zero', async () => {
  for (const one of [[1, 2, 3, 255], [10, 20, 30, 128], [0, 0, 0, 0]]) {
    const r = decodeBoth(await encodePng8(Uint8ClampedArray.from(one), 1, 1));
    assert.deepEqual([r.width, r.height, r.depth, r.colors], [1, 1, 1, 1]);
    assert.deepEqual([...r.rgba], one);
    assert.equal(r.trns.length, one[3] < 255 ? 1 : 0);
  }
  for (const [k, depth] of [[2, 1], [3, 2], [4, 2], [5, 4], [16, 4], [17, 8], [21, 8]]) {
    const w = 7, h = 3, px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { const c = (i * 8) % 21 % k; /* 8 is coprime with 21: every value 0..k-1 appears */ px.set([c * 11, 255 - c * 9, (c * 53) & 255, c === 1 ? 77 : 255], i * 4); }
    const r = decodeBoth(await encodePng8(px, w, h));
    assert.equal(r.colors, k, `${k} colours`);
    assert.equal(r.depth, depth, `${k} colours → depth ${depth}`);
    assertTrnsOrder(r);
    assertExact(px, r.rgba, `7×3, ${k} colours`);
  }
});

// ---- quantized cases -------------------------------------------------------------------------

const PW = 512, PH = 384;
for (const dither of [true, false]) {
  test(`photo-like ${PW}×${PH} with alpha ramp, dither ${dither}: ≤ 256 colours, small error, smaller than RGBA PNG`, async (t) => {
    const px = photo(PW, PH);
    const png = await encodePng8(px, PW, PH, { dither });
    const r = decodeBoth(png);
    assert.equal(r.depth, 8);
    assert.ok(r.colors <= 256 && r.colors > 128, `${r.colors} palette entries`);
    assertTrnsOrder(r);
    assert.ok(r.trns.length > 1, 'several translucent entries');
    const e = errors(px, r.rgba);
    // Thresholds (of 255): the source adds ±12 noise per channel that 256 colours cannot follow,
    // so its noise floor alone is ~3. Measured 2026-11-20: colour 3.73 plain / 4.46 dithered,
    // alpha 2.40 / 2.98. Limits 6 and 4.5 leave ~35 % headroom. With alpha left out of the colour distance
    // (mutation tried 2026-11-20) alpha error was 6.99 / 8.49, so this check catches that.
    assert.ok(e.colour < 6, `mean composite colour error ${e.colour.toFixed(2)}`);
    assert.ok(e.alpha < 4.5, `mean alpha error ${e.alpha.toFixed(2)}`);
    let clearOk = true, clearIdx = new Set();
    for (let i = 0; i < PW * PH; i++) if (px[i * 4 + 3] === 0) { clearIdx.add(r.indices[i]); if (r.rgba[i * 4 + 3] !== 0) clearOk = false; }
    assert.ok(clearOk, 'fully transparent pixels stay fully transparent');
    assert.equal(clearIdx.size, 1, 'one palette entry for all fully transparent pixels');
    assert.equal([...r.trns].filter((a) => a === 0).length, 1, 'exactly one alpha-0 entry');
    const base = rgbaPngSize(px, PW, PH);
    assert.ok(png.length < base * 0.25, /* measured ~0.08–0.10 */ `${png.length} bytes vs RGBA PNG ${base} (raw ${PW * PH * 4})`);
    t.diagnostic(`${r.colors} colours, error colour ${e.colour.toFixed(2)} alpha ${e.alpha.toFixed(2)}, ${png.length} B vs RGBA PNG ${base} B`);
  });
}

test('anti-aliased logo with drop shadow on transparent, 64 colours: edge and shadow alpha kept', async (t) => {
  const w = 200, h = 160, px = new Uint8ClampedArray(w * h * 4);
  const cover = (dx, dy, rad) => Math.min(1, Math.max(0, rad - Math.hypot(dx, dy) + 0.5));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const logo = cover(x - 95, y - 75, 60);
    const shadow = 0.5 * Math.min(1, Math.max(0, (66 - Math.hypot(x - 103, y - 83)) / 12)); // soft, 50 % max
    const a = logo + shadow * (1 - logo);
    if (a <= 0) continue; // left 0,0,0,0
    // Logo: a red→orange gradient (hundreds of colours); shadow: black. Straight colour = premultiplied mix / a.
    const lr = 220, lg = 40 + (x / w) * 120 + (y / h) * 40, lb = 30 + (y / h) * 60;
    px[i] = (lr * logo) / a; px[i + 1] = (lg * logo) / a; px[i + 2] = (lb * logo) / a; px[i + 3] = Math.round(a * 255);
  }
  for (const dither of [false, true]) {
    const r = decodeBoth(await encodePng8(px, w, h, { maxColors: 64, dither }));
    assert.ok(r.colors <= 64);
    assertTrnsOrder(r);
    let edgeErr = 0, edges = 0, clearBad = 0;
    for (let i = 0; i < w * h; i++) {
      const a = px[i * 4 + 3];
      if (a === 0) { if (r.rgba[i * 4 + 3] !== 0) clearBad++; continue; }
      if (a < 255) { edgeErr += Math.abs(a - r.rgba[i * 4 + 3]); edges++; }
    }
    assert.equal(clearBad, 0, 'transparent background stays transparent');
    assert.ok(edges > 1000, `${edges} translucent pixels in the source`);
    // Shadow alpha runs 0..128 and edge alpha 0..255; 64 entries leave room for ~half on alpha,
    // so an average alpha error under 6 (of 255) is a plausible, visible-edge-preserving result.
    assert.ok(edgeErr / edges < 6, `mean alpha error on translucent pixels ${(edgeErr / edges).toFixed(2)}`);
    t.diagnostic(`dither ${dither}: ${r.colors} colours, ${r.trns.length} in tRNS, translucent-pixel alpha error ${(edgeErr / edges).toFixed(2)}`);
  }
});

test('maxColors 16 → at most 16 entries at depth 4; maxColors 2 with transparency → depth 1', async () => {
  const px = photo(97, 61, { seed: 3 });
  const r16 = decodeBoth(await encodePng8(px, 97, 61, { maxColors: 16 }));
  assert.ok(r16.colors <= 16 && r16.colors > 4, `${r16.colors} entries`);
  assert.equal(r16.depth, 4);
  assertTrnsOrder(r16);
  const r2 = decodeBoth(await encodePng8(px, 97, 61, { maxColors: 2, dither: false }));
  assert.equal(r2.colors, 2);
  assert.equal(r2.depth, 1);
  assert.ok(r2.trns.includes(0), 'the clear entry is one of the two');
  const opaque = photo(97, 61, { alpha: false, seed: 3 });
  const r4 = decodeBoth(await encodePng8(opaque, 97, 61, { maxColors: 4 }));
  assert.ok(r4.colors <= 4 && r4.depth <= 2);
  assert.equal(r4.trns.length, 0, 'opaque image: no tRNS');
});

test('bad input throws plain errors', async () => {
  const px = new Uint8ClampedArray(16);
  await assert.rejects(encodePng8(px, 0, 4), /width and height/);
  await assert.rejects(encodePng8(px, 4, -1), /width and height/);
  await assert.rejects(encodePng8(px, 2.5, 2), /width and height/);
  await assert.rejects(encodePng8(px, 2, 3), /must be 24 bytes/);
  await assert.rejects(encodePng8(new Uint8ClampedArray(15), 2, 2), /must be 16 bytes/);
  await assert.rejects(encodePng8(null, 1, 1), /Pixel data/);
  await assert.rejects(encodePng8([0, 0, 0, 0], 1, 1), /Pixel data/);
  await assert.rejects(encodePng8(px, 2, 2, { maxColors: NaN }), /maxColors/);
});

test('pngcheck', { skip: pngcheck ? false : 'pngcheck is not installed; structure is checked by our reader and Pillow instead' }, async () => {
  const out = runPngcheck(await encodePng8(photo(64, 48), 64, 48));
  assert.match(out, /OK/);
});

test('12 MP (4000×3000) photo-like image with alpha: timing', async (t) => {
  const w = 4000, h = 3000, px = photo(w, h, { seed: 11 });
  for (const dither of [false, true]) {
    const t0 = performance.now();
    const png = await encodePng8(px, w, h, { dither });
    const ms = performance.now() - t0;
    const r = readPng(png);
    assert.ok(r.colors <= 256);
    t.diagnostic(`dither ${dither}: ${(ms / 1000).toFixed(2)} s, ${r.colors} colours, ${(png.length / 1e6).toFixed(1)} MB (raw RGBA ${(w * h * 4 / 1e6).toFixed(0)} MB)`);
    assert.ok(ms < 30000, 'well under 30 s');
  }
});
