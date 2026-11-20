// Unit tests for our TIFF decoder (site/assets/tiff.js) in Node, against pixels decoded by
// ImageMagick (fixtures and expected RGBA from scripts/make-tiff-fixtures.py).
// JPEG-in-TIFF needs createImageBitmap, so it is checked in Chromium by tests/site.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

await import('../site/assets/tiff.js');
const { SaveformTiff } = globalThis;
const DIR = new URL('./fixtures/tiff/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR)));
const load = (file) => { const b = readFileSync(new URL(file, DIR)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };

for (const [name, c] of Object.entries(manifest)) {
  if (name.startsWith('jpeg')) continue;
  test(`TIFF ${name}${c.note ? ` (${c.note})` : ''} decodes like ImageMagick`, async () => {
    const r = await SaveformTiff.decode(load(c.file), c.page);
    assert.deepEqual([r.width, r.height], [c.width, c.height]);
    const want = gunzipSync(readFileSync(new URL(c.expected, DIR)));
    assert.equal(r.data.length, want.length);
    let bad = 0, first = '';
    for (let i = 0; i < want.length; i += 4) {
      // Premultiplied pixels with very low alpha cannot be un-premultiplied exactly; skip them.
      if (name === 'rgba8-assoc' && want[i + 3] < 32) continue;
      for (let k = 0; k < 4; k++) {
        if (Math.abs(r.data[i + k] - want[i + k]) > c.tolerance) { bad++; first ||= `pixel ${i / 4}: got ${[...r.data.subarray(i, i + 4)]}, want ${[...want.subarray(i, i + 4)]}`; }
      }
    }
    assert.equal(bad, 0, first);
  });
}

test('page count: three pages, thumbnails are not pages', async () => {
  assert.equal(SaveformTiff.pages(load('multipage.tif')), 3);
  assert.equal(SaveformTiff.pages(load('rgb8-lzw.tif')), 1);
  // Mark page 2 (second IFD) as a reduced-resolution image: it no longer counts.
  const buf = load('multipage.tif');
  const dv = new DataView(buf);
  const le = dv.getUint8(0) === 0x49;
  const ifd1 = dv.getUint32(4, le);
  const n1 = dv.getUint16(ifd1, le);
  const ifd2 = dv.getUint32(ifd1 + 2 + n1 * 12, le);
  const n2 = dv.getUint16(ifd2, le);
  let patched = false;
  for (let i = 0; i < n2; i++) {
    const e = ifd2 + 2 + i * 12;
    if (dv.getUint16(e, le) === 254) { dv.setUint32(e + 8, 1, le); patched = true; }
  }
  assert.ok(patched, 'fixture has NewSubfileType');
  assert.equal(SaveformTiff.pages(buf), 2);
});

test('the ICC profile is handed over for colour management', async () => {
  const r = await SaveformTiff.decode(load('quadrants-p3.tif'));
  assert.ok(r.icc && r.icc.length > 100, 'profile bytes returned');
  assert.equal((await SaveformTiff.decode(load('quadrants-untagged.tif'))).icc, null);
});

test('broken and unsupported TIFF files give clear errors', async () => {
  await assert.rejects(SaveformTiff.decode(new Uint8Array([0x49, 0x49, 0x2a, 0x00]).buffer), /truncated/);
  await assert.rejects(SaveformTiff.decode(new TextEncoder().encode('not a tiff at all').buffer), /not a TIFF/);
  // Same file, compression tag changed to LZMA (34925).
  const buf = load('rgb8-none.tif');
  const dv = new DataView(buf);
  const le = dv.getUint8(0) === 0x49;
  const ifd = dv.getUint32(4, le);
  for (let i = 0; i < dv.getUint16(ifd, le); i++) {
    const e = ifd + 2 + i * 12;
    if (dv.getUint16(e, le) === 259) dv.setUint16(e + 8, 34925, le);
  }
  await assert.rejects(SaveformTiff.decode(buf), /LZMA compression/);
  // Pillow writes the directory after the pixels: cutting the file loses it.
  await assert.rejects(SaveformTiff.decode(load('pil-rgb-lzw-le.tif').slice(0, 4000)), /truncated or damaged/);
  // ImageMagick writes it first: a cut file still decodes, with the missing rows left black.
  const partial = await SaveformTiff.decode(load('rgb8-lzw.tif').slice(0, 4000));
  assert.deepEqual([partial.width, partial.height], [96, 64]);
});
