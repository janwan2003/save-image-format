// Unit tests for camera RAW reading (site/assets/raw.js) in Node: which files count as RAW, which
// embedded JPEG is picked, and which orientation applies. Decoding to pixels needs a browser and is
// covered by tests/site.test.mjs. Checked by hand against 12 real files (session 12, VENTURE.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRaw, findJpegs, largestJpeg, containerOrientation } from '../site/assets/raw.js';
import { sniffType } from '../extension/lib/convert.js';
import { PREVIEW, PROGRESSIVE, THUMB, tiffRaw, cr3, raf, losslessJpeg, withExifOrientation } from './raw-fixtures.mjs';

test('RAW detection: own signatures, TIFF-shaped RAW by extension or DNGVersion, plain TIFF/JPEG are not RAW', () => {
  assert.equal(isRaw(tiffRaw({ cr2: true }), 'IMG_0001.CR2'), true);
  assert.equal(isRaw(tiffRaw({ cr2: true }), 'renamed.tif'), true, 'CR2 marker wins over the name');
  assert.equal(isRaw(cr3(), 'IMG_0001.CR3'), true);
  assert.equal(isRaw(raf(), 'DSCF0001.RAF'), true);
  for (const name of ['DSC_0001.NEF', 'DSC00001.ARW', 'IMG_1.dng', 'IMGP1.PEF', 'x.nrw']) assert.equal(isRaw(tiffRaw(), name), true, name);
  assert.equal(isRaw(tiffRaw(), 'scan.tif'), false, 'a plain TIFF stays a TIFF');
  assert.equal(isRaw(PREVIEW, 'photo.jpg'), false);
  const orf = tiffRaw(); orf.set([0x49, 0x49, 0x52, 0x4f]); // "IIRO"
  assert.equal(isRaw(orf, 'P1.ORF'), true);
  const rw2 = tiffRaw(); rw2.set([0x49, 0x49, 0x55, 0x00]); // "IIU\0"
  assert.equal(isRaw(rw2, 'P1.RW2'), true);
  // The converter's own sniffer must not claim CR3/RAF as AVIF/HEIC.
  assert.equal(sniffType(cr3().subarray(0, 512)), null);
});

test('largest displayable JPEG wins; lossless sensor data, thumbnails and stray FF D8 FF are skipped', () => {
  const file = tiffRaw();
  const all = findJpegs(file);
  assert.deepEqual(all.map((j) => `${j.width}x${j.height}`), ['16x12', '64x48']);
  const best = largestJpeg(file);
  assert.deepEqual([best.width, best.height], [64, 48]);
  assert.deepEqual(file.subarray(best.offset, best.offset + best.length), PREVIEW, 'exact preview bytes');
});

test('a preview ending exactly at the end of the file is found (Pentax PEF layout)', () => {
  const file = new Uint8Array([...tiffRaw({ preview: null }), ...PREVIEW]);
  assert.deepEqual([largestJpeg(file).width, largestJpeg(file).height], [64, 48]);
});

test('progressive previews count; a file with only sensor data has no usable JPEG', () => {
  assert.equal(largestJpeg(tiffRaw({ preview: PROGRESSIVE })).width, 64);
  const none = new Uint8Array([...tiffRaw({ preview: null }).subarray(0, 26), ...losslessJpeg()]);
  assert.equal(largestJpeg(none), null);
});

test('orientation: TIFF IFD0 (both byte orders), CR3 CMT1, and the JPEG’s own EXIF', () => {
  assert.equal(containerOrientation(tiffRaw({ orientation: 6 })), 6);
  assert.equal(containerOrientation(tiffRaw({ le: false, orientation: 8 })), 8);
  assert.equal(containerOrientation(tiffRaw({ cr2: true, orientation: 3 })), 3);
  assert.equal(containerOrientation(cr3({ orientation: 6 })), 6);
  assert.equal(containerOrientation(raf()), 1);
  assert.equal(largestJpeg(raf({ preview: withExifOrientation(PREVIEW, 6) })).orientation, 6);
  assert.equal(largestJpeg(tiffRaw()).orientation, 0, 'no EXIF in the preview → 0');
});

test('truncated files and garbage do not throw', () => {
  const file = tiffRaw();
  for (const n of [0, 3, 10, 30, file.length - 200, file.length - 1]) {
    assert.doesNotThrow(() => largestJpeg(file.subarray(0, n)));
    assert.doesNotThrow(() => containerOrientation(file.subarray(0, n)));
  }
  assert.equal(largestJpeg(new Uint8Array(1000).fill(0xff)), null);
  assert.equal(THUMB[0], 0xff);
});
