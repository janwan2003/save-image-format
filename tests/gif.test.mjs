// Unit tests for the GIF writer (extension/lib/gif.js).
//   node --test tests/gif.test.mjs
// Each GIF is checked twice: by a small reference reader below (structure, sub-block sizes,
// LZW clear codes) and by headless Chromium's own GIF decoder (pixels).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { encodeGif } from '../extension/lib/gif.js';

let browser, page;

before(async () => {
  try {
    browser = await chromium.launch();
  } catch {
    browser = await chromium.launch({ channel: 'chromium' });
  }
  page = await browser.newPage();
});

after(async () => { await browser?.close(); });

/** Decode GIF bytes with Chromium; returns RGBA as a Uint8Array plus the size. */
async function chromiumDecode(gif) {
  const r = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/gif' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const data = g.getImageData(0, 0, bmp.width, bmp.height).data;
    let s = '';
    for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return { width: bmp.width, height: bmp.height, b64: btoa(s) };
  }, Buffer.from(gif).toString('base64'));
  return { width: r.width, height: r.height, data: new Uint8Array(Buffer.from(r.b64, 'base64')) };
}

/** Minimal GIF reader written from the GIF89a spec, for checking structure. */
function readGif(b) {
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  const u16 = (i) => b[i] | (b[i + 1] << 8);
  assert.equal(ascii(0, 6), 'GIF89a');
  const width = u16(6), height = u16(8), packed = b[10];
  assert.ok(packed & 0x80, 'has a global colour table');
  const tableSize = 2 << (packed & 7);
  const palette = b.subarray(13, 13 + tableSize * 3);
  let i = 13 + tableSize * 3, transparentIndex = -1;
  while (b[i] === 0x21) {
    if (b[i + 1] === 0xf9) {
      assert.equal(b[i + 2], 4);
      if (b[i + 3] & 1) transparentIndex = b[i + 6];
      i += 8;
    } else {
      i += 2;
      while (b[i]) i += b[i] + 1;
      i++;
    }
  }
  assert.equal(b[i], 0x2c, 'image descriptor');
  assert.equal(u16(i + 5), width); assert.equal(u16(i + 7), height);
  assert.equal(b[i + 9] & 0x80, 0, 'no local colour table');
  const minCodeSize = b[i + 10];
  i += 11;
  const chunks = [];
  const blockSizes = [];
  while (b[i]) { blockSizes.push(b[i]); chunks.push(b.subarray(i + 1, i + 1 + b[i])); i += b[i] + 1; }
  i++;
  assert.equal(b[i], 0x3b, 'trailer');
  assert.equal(i, b.length - 1, 'nothing after the trailer');
  const data = Buffer.concat(chunks);
  const { indices, clears, maxCodeSize } = lzwDecode(data, minCodeSize, width * height);
  return { width, height, tableSize, palette, transparentIndex, minCodeSize, blockSizes, indices, clears, maxCodeSize };
}

function lzwDecode(data, minCodeSize, n) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize, next, prev;
  let table;
  const reset = () => {
    codeSize = minCodeSize + 1; next = eoi + 1; prev = -1;
    table = [];
    for (let k = 0; k < clear; k++) table[k] = [k];
  };
  reset();
  const out = [];
  let bitPos = 0, clears = 0, maxCodeSize = codeSize;
  const read = () => {
    let v = 0;
    for (let k = 0; k < codeSize; k++, bitPos++) {
      if ((bitPos >> 3) >= data.length) throw new Error('ran out of data before the end code');
      v |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << k;
    }
    return v;
  };
  for (;;) {
    const code = read();
    if (code === clear) { clears++; reset(); continue; }
    if (code === eoi) break;
    let entry;
    if (code < next && table[code]) entry = table[code];
    else if (code === next && prev >= 0) entry = [...table[prev], table[prev][0]];
    else throw new Error(`bad code ${code} (next ${next})`);
    out.push(...entry);
    if (prev >= 0 && next < 4096) {
      table[next++] = [...table[prev], entry[0]];
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    maxCodeSize = Math.max(maxCodeSize, codeSize);
    prev = code;
  }
  assert.equal(out.length, n, 'decoded pixel count');
  return { indices: out, clears, maxCodeSize };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Smooth photo-like test picture: gradients, a soft blob, mild noise. More than 256 colours. */
function photo(w, h, seed = 1) {
  const rand = rng(seed);
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    const blob = Math.exp(-(((x - w * 0.6) ** 2) + ((y - h * 0.4) ** 2)) / (2 * (w * 0.18) ** 2));
    d[p] = 40 + 180 * (x / w) + 30 * blob + rand() * 6;
    d[p + 1] = 70 + 120 * (y / h) + 60 * Math.sin(x / 37) * 0.5 + rand() * 6;
    d[p + 2] = 200 - 150 * blob + rand() * 6;
    d[p + 3] = 255;
  }
  return d;
}

function meanAbsError(a, b, { blur = 0, w, h } = {}) {
  // With blur > 0, compares (2·blur+1)² box averages, which is how a dithered image is seen.
  let sum = 0, count = 0;
  for (let y = blur; y < h - blur; y += 1 + blur) for (let x = blur; x < w - blur; x += 1 + blur) {
    for (let c = 0; c < 3; c++) {
      let sa = 0, sb = 0;
      for (let dy = -blur; dy <= blur; dy++) for (let dx = -blur; dx <= blur; dx++) {
        const p = ((y + dy) * w + x + dx) * 4 + c;
        sa += a[p]; sb += b[p];
      }
      sum += Math.abs(sa - sb) / (2 * blur + 1) ** 2; count++;
    }
  }
  return sum / count;
}

test('256 random colours in noise: lossless, many LZW table resets, sub-blocks of at most 255 bytes', async () => {
  const w = 300, h = 200, rand = rng(7);
  const colours = Array.from({ length: 256 }, () => [rand() * 256 | 0, rand() * 256 | 0, rand() * 256 | 0]);
  // Make sure all 256 are distinct so the writer must use every palette slot.
  colours.forEach((c, i) => { c[0] = i; });
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const c = colours[i < 256 ? i : rand() * 256 | 0];
    d.set([c[0], c[1], c[2], 255], i * 4);
  }
  const gif = encodeGif(d, w, h);
  const info = readGif(gif);
  assert.equal(info.tableSize, 256);
  assert.equal(info.minCodeSize, 8);
  assert.equal(info.transparentIndex, -1, 'no transparency block for an opaque image');
  assert.equal(info.maxCodeSize, 12);
  assert.ok(info.clears > 10, `table was reset ${info.clears} times`);
  assert.ok(info.blockSizes.every((s) => s >= 1 && s <= 255));
  assert.ok(info.blockSizes.slice(0, -1).every((s) => s === 255), 'all but the last sub-block are full');
  // The reference reader's indices map back to the exact source colours.
  for (let i = 0; i < w * h; i += 97) {
    const k = info.indices[i];
    assert.deepEqual([...info.palette.subarray(k * 3, k * 3 + 3)], [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]]);
  }
  const dec = await chromiumDecode(gif);
  assert.equal(dec.width, w); assert.equal(dec.height, h);
  assert.ok(Buffer.from(dec.data).equals(Buffer.from(d)), 'Chromium decodes every pixel exactly');
});

test('long runs of one colour build long LZW strings and still decode exactly', async () => {
  // Stripes widen as they go down, so the table fills with long strings and then resets.
  const w = 512, h = 512;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.floor(x / (1 + (y >> 3))) % 5;
    d.set([v * 60, 255 - v * 50, (v * 97) % 256, 255], (y * w + x) * 4);
  }
  const gif = encodeGif(d, w, h);
  const info = readGif(gif);
  assert.equal(info.tableSize, 8);
  assert.equal(info.minCodeSize, 3);
  const dec = await chromiumDecode(gif);
  assert.ok(Buffer.from(dec.data).equals(Buffer.from(d)));
});

test('small images: 1×1, two colours (minimum code size 2), and a fully transparent image', async () => {
  let gif = encodeGif(new Uint8ClampedArray([10, 20, 30, 255]), 1, 1);
  let info = readGif(gif);
  assert.equal(info.minCodeSize, 2);
  assert.deepEqual([...(await chromiumDecode(gif)).data], [10, 20, 30, 255]);

  const two = new Uint8ClampedArray(5 * 3 * 4);
  for (let i = 0; i < 15; i++) two.set(i % 3 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  gif = encodeGif(two, 5, 3);
  info = readGif(gif);
  assert.equal(info.tableSize, 2);
  assert.equal(info.minCodeSize, 2);
  assert.deepEqual([...(await chromiumDecode(gif)).data], [...two]);

  gif = encodeGif(new Uint8ClampedArray(4 * 4 * 4), 4, 4);
  info = readGif(gif);
  assert.ok(info.transparentIndex >= 0);
  assert.ok(info.indices.every((k) => k === info.transparentIndex));
  const dec = await chromiumDecode(gif);
  assert.ok(dec.data.every((v, i) => i % 4 !== 3 || v === 0), 'every pixel decodes as transparent');
});

test('transparency: alpha below 128 becomes the transparent index, the rest stays opaque with its colour', async () => {
  // Few colours (exact palette) and many colours (quantised) with the same alpha pattern.
  for (const many of [false, true]) {
    const w = 120, h = 80;
    const d = many ? photo(w, h, 3) : new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (!many) d.set(x < 90 ? [220, 30, 30] : [30, 30, 220], p);
      d[p + 3] = Math.round((x / (w - 1)) * 255); // 0 on the left to 255 on the right
    }
    const gif = encodeGif(d, w, h);
    const info = readGif(gif);
    assert.ok(info.transparentIndex >= 0, 'has a transparent index');
    if (!many) assert.equal(info.tableSize, 4, 'two colours + transparent fit in 4 entries');
    else assert.equal(info.tableSize, 256);
    const dec = await chromiumDecode(gif);
    let opaqueErr = 0, opaque = 0;
    for (let i = 0; i < w * h; i++) {
      const a = d[i * 4 + 3];
      assert.equal(dec.data[i * 4 + 3], a < 128 ? 0 : 255, `alpha at pixel ${i} (source ${a})`);
      if (a >= 128) {
        opaque++;
        for (let c = 0; c < 3; c++) opaqueErr += Math.abs(dec.data[i * 4 + c] - d[i * 4 + c]);
      }
    }
    const mean = opaqueErr / (opaque * 3);
    if (!many) assert.equal(mean, 0, 'exact colours kept (alpha dropped, not blended)');
    else assert.ok(mean < 12, `quantised colours close to the source (mean error ${mean.toFixed(2)})`);
  }
});

test('photo-like image with more than 256 colours: quantised close to the source, dithering on by default', async () => {
  const w = 400, h = 300;
  const d = photo(w, h);
  const dithered = encodeGif(d, w, h);
  const plain = encodeGif(d, w, h, { dither: false });
  assert.ok(!Buffer.from(dithered).equals(Buffer.from(plain)), 'dither option changes the output');
  assert.ok(Buffer.from(dithered).equals(Buffer.from(encodeGif(d, w, h, { dither: true }))), 'dither defaults to on');
  const a = await chromiumDecode(dithered);
  const b = await chromiumDecode(plain);
  const plainErr = meanAbsError(d, b.data, { w, h });
  const ditherErr = meanAbsError(d, a.data, { w, h, blur: 1 });
  const ditherRaw = meanAbsError(d, a.data, { w, h });
  console.log(`# photo 400x300: plain ${plain.length} B, mean error ${plainErr.toFixed(2)}; dithered ${dithered.length} B, mean error ${ditherRaw.toFixed(2)} per pixel, ${ditherErr.toFixed(2)} over 3x3 areas`);
  assert.ok(plainErr < 4, `undithered mean error ${plainErr}`);
  assert.ok(ditherErr < 3, `dithered 3x3-average error ${ditherErr}`);
  assert.ok(ditherRaw < 8, `dithered per-pixel error ${ditherRaw}`);
  assert.equal(readGif(plain).tableSize, 256);
});

test('a 2000×2000 photo-like image encodes in a few seconds', () => {
  const w = 2000, h = 2000;
  const d = photo(w, h, 11);
  for (const dither of [true, false]) {
    const t = performance.now();
    const gif = encodeGif(d, w, h, { dither });
    const ms = performance.now() - t;
    console.log(`# 2000x2000 dither=${dither}: ${(gif.length / 1048576).toFixed(2)} MB in ${ms.toFixed(0)} ms`);
    assert.ok(ms < 5000, `took ${ms} ms`);
    assert.equal(Buffer.from(gif.subarray(0, 6)).toString('latin1'), 'GIF89a');
    assert.equal(gif[gif.length - 1], 0x3b);
  }
});

test('rejects sizes GIF cannot store and short pixel buffers', () => {
  assert.throws(() => encodeGif(new Uint8ClampedArray(0), 0, 1), /between 1 and 65535/);
  assert.throws(() => encodeGif(new Uint8ClampedArray(4), 70000, 1), /between 1 and 65535/);
  assert.throws(() => encodeGif(new Uint8ClampedArray(4), 2, 2), /Not enough pixel data/);
});
