// Unit tests for our Photoshop decoder (site/assets/psd.js) in Node, against pixels from
// ImageMagick or the source pixels of hand-written files (fixtures, expected RGBA and the reference
// used for each: scripts/make-psd-fixtures.py, tests/fixtures/psd/manifest.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

await import('../site/assets/psd.js');
const { SaveformPsd } = globalThis;
const DIR = new URL('./fixtures/psd/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', DIR)));
const load = (file) => { const b = readFileSync(new URL(file, DIR)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };

for (const [name, c] of Object.entries(manifest)) {
  test(`PSD ${name} (${c.note || c.file}) decodes like ${c.reference === 'magick' ? 'ImageMagick' : `its ${c.reference}`}`, async () => {
    const r = await SaveformPsd.decode(load(c.file));
    assert.deepEqual([r.width, r.height], [c.width, c.height]);
    assert.equal(!!r.approximate, c.reference === 'layers');
    const want = gunzipSync(readFileSync(new URL(c.expected, DIR)));
    assert.equal(r.data.length, want.length);
    let bad = 0, first = '';
    for (let i = 0; i < want.length; i += 4) {
      for (let k = 0; k < 4; k++) {
        // Colour under fully transparent pixels is meaningless.
        if (k < 3 && want[i + 3] === 0) continue;
        if (Math.abs(r.data[i + k] - want[i + k]) > c.tolerance) { bad++; first ||= `pixel ${i / 4}: got ${[...r.data.subarray(i, i + 4)]}, want ${[...want.subarray(i, i + 4)]}`; }
      }
    }
    assert.equal(bad, 0, first);
  });
}

test('the ICC profile (resource 1039) is handed over for RGB only', async () => {
  const r = await SaveformPsd.decode(load('rgb8-p3.psd'));
  assert.ok(r.icc && r.icc.length > 100, 'profile bytes returned');
  assert.equal(String.fromCharCode(...r.icc.subarray(36, 40)), 'acsp');
  assert.equal((await SaveformPsd.decode(load('rgb8-rle.psd'))).icc, null);
});

// Copy of a fixture with its header field at `offset` (big-endian, `size` bytes) set to `value`.
const patched = (file, offset, size, value) => {
  const buf = typeof file === 'string' ? load(file) : file;
  const dv = new DataView(buf);
  if (size === 2) dv.setUint16(offset, value); else dv.setUint32(offset, value);
  return buf;
};
const imageDataOffset = (buf) => {
  const dv = new DataView(buf);
  let p = 26;
  p += 4 + dv.getUint32(p);
  p += 4 + dv.getUint32(p);
  p += 4 + dv.getUint32(p); // PSD: 4-byte layer section length
  return p;
};

test('broken and unsupported Photoshop files give clear errors', async () => {
  await assert.rejects(SaveformPsd.decode(new TextEncoder().encode('not a psd at all, really not').buffer), /not a Photoshop/);
  await assert.rejects(SaveformPsd.decode(load('rgb8-rle.psd').slice(0, 20)), /PSD file is truncated/);
  // Cut inside the layer section, and inside the RLE image data.
  await assert.rejects(SaveformPsd.decode(load('rgb8-rle.psd').slice(0, 600)), /PSD file is truncated/);
  await assert.rejects(SaveformPsd.decode(load('rgb8-rle.psd').slice(0, -500)), /PSD file is truncated/);
  await assert.rejects(SaveformPsd.decode(load('rgb8-raw.psd').slice(0, -10)), /PSD file is truncated/);
  await assert.rejects(SaveformPsd.decode(load('rgb8.psb').slice(0, -10)), /PSB file is truncated/);
  // Unknown compression method 7.
  const raw = load('rgb8-raw.psd');
  new DataView(raw).setUint16(imageDataOffset(raw), 7);
  await assert.rejects(SaveformPsd.decode(raw), /unsupported compression method \(7\)/);
  // Damaged ZIP data.
  const zip = load('rgb8-zip.psd');
  new Uint8Array(zip).fill(0x55, imageDataOffset(zip) + 2, imageDataOffset(zip) + 40);
  await assert.rejects(SaveformPsd.decode(zip), /damaged/);
  // Version 3, colour mode 5 (none), 24-bit samples, too many pixels.
  await assert.rejects(SaveformPsd.decode(patched('rgb8-raw.psd', 4, 2, 3)), /unknown version \(3\)/);
  await assert.rejects(SaveformPsd.decode(patched('rgb8-raw.psd', 24, 2, 5)), /colour mode this converter does not support/);
  await assert.rejects(SaveformPsd.decode(patched('rgb8-raw.psd', 22, 2, 24)), /24-bit RGB PSD files are not supported/);
  const huge = patched(patched('rgb8-raw.psd', 14, 4, 20000), 18, 4, 20000);
  await assert.rejects(SaveformPsd.decode(huge), /20000 × 20000 pixels, too large/);
});

test('no real composite and no readable layers: tells the user to re-save with Maximize Compatibility', async () => {
  // no-composite.psd with its layer section emptied (length 0, the layers' bytes left as junk).
  const buf = load('no-composite.psd');
  const dv = new DataView(buf);
  let p = 26;
  p += 4 + dv.getUint32(p);
  p += 4 + dv.getUint32(p);
  const layerLen = dv.getUint32(p);
  const bytes = new Uint8Array(buf);
  const cut = new Uint8Array(bytes.length - layerLen);
  cut.set(bytes.subarray(0, p + 4));
  cut.set(bytes.subarray(p + 4 + layerLen), p + 4);
  new DataView(cut.buffer).setUint32(p, 0);
  await assert.rejects(SaveformPsd.decode(cut.buffer), /Maximize Compatibility/);
});
