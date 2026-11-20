// Unit tests for site/assets/icc.js (wide-gamut → sRGB for decoded HEIC photos).
//   node --test tests/icc.test.mjs
// The browser-level check (a P3-tagged HEIC compared with Chromium's own colour management) is in
// tests/site.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../site/assets/icc.js';

const { parseIcc, nclxProfile, isSrgb, toSrgb } = globalThis.SaveformColor;

// Pull the ICC profile out of our P3 fixture (colr 'prof' box), so the parser is tested on the
// bytes libheif hands over.
function iccFromFixture() {
  const file = readFileSync(new URL('./fixtures/quadrants-p3.heic', import.meta.url));
  const at = file.indexOf(Buffer.from('colrprof', 'latin1'));
  const size = file.readUInt32BE(at - 4);
  return new Uint8Array(file.subarray(at + 8, at - 4 + size));
}

// Reference: linear Display P3 → linear sRGB (both D65): the product of CSS Color 4's sample
// conversion matrices (lin_P3 → XYZ → lin_sRGB), rounded to 4 places. Independent of the
// D50/ICC route icc.js takes.
const P3_TO_SRGB = [
  [1.2249, -0.2247, 0],
  [-0.0420, 1.0419, 0],
  [-0.0196, -0.0786, 1.0979],
];
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
function reference([r, g, b]) {
  const l = [r, g, b].map((v) => lin(v / 255));
  return P3_TO_SRGB.map((row) => Math.round(Math.min(1, Math.max(0, enc(row[0] * l[0] + row[1] * l[1] + row[2] * l[2]))) * 255));
}

const SAMPLES = [[200, 120, 48], [48, 176, 64], [48, 112, 200], [176, 64, 144], [128, 128, 128], [250, 250, 250], [10, 10, 10]];

test('a Display P3 ICC profile is parsed and converts like the published P3 → sRGB matrix', () => {
  const profile = parseIcc(iccFromFixture());
  assert.ok(profile, 'profile parsed');
  assert.equal(isSrgb(profile), false);
  const px = new Uint8ClampedArray(SAMPLES.flatMap((c) => [...c, 255]));
  toSrgb(px, profile);
  SAMPLES.forEach((c, i) => {
    const got = Array.from(px.subarray(i * 4, i * 4 + 3));
    const want = reference(c);
    assert.ok(got.every((v, k) => Math.abs(v - want[k]) <= 1), `${c} → ${got}, expected ≈ ${want}`);
    assert.equal(px[i * 4 + 3], 255, 'alpha kept');
  });
  // Greys stay grey.
  assert.deepEqual(Array.from(px.subarray(16, 19)), [128, 128, 128]);
});

test('nclx Display P3 (primaries 12) converts the same way; sRGB, unknown and HDR tags are left alone', () => {
  const px = new Uint8ClampedArray(SAMPLES.flatMap((c) => [...c, 255]));
  toSrgb(px, nclxProfile(12, 13));
  SAMPLES.forEach((c, i) => {
    const want = reference(c);
    assert.ok(Array.from(px.subarray(i * 4, i * 4 + 3)).every((v, k) => Math.abs(v - want[k]) <= 1), `${c}`);
  });
  assert.equal(isSrgb(nclxProfile(1, 13)), true, 'BT.709 primaries = sRGB');
  assert.equal(nclxProfile(2, 2), null, 'unspecified primaries');
  assert.equal(nclxProfile(9, 16), null, 'PQ (HDR) is not tone-mapped');
  assert.equal(nclxProfile(9, 18), null, 'HLG (HDR) is not tone-mapped');
});

test('an sRGB ICC profile (gamma table) counts as sRGB; broken or LUT-only profiles are not used', () => {
  // Build an sRGB-like profile with a 1024-entry curv table to exercise the table path.
  const icc = iccFromFixture().slice();
  const dv = new DataView(icc.buffer);
  const s15 = (o, v) => dv.setInt32(o, Math.round(v * 65536));
  const tagOffset = (sig) => {
    for (let k = 0; k < dv.getUint32(128); k++) {
      const o = 132 + k * 12;
      if (String.fromCharCode(...icc.subarray(o, o + 4)) === sig) return dv.getUint32(o + 4);
    }
    throw new Error(sig);
  };
  [['rXYZ', [0.4360747, 0.2225045, 0.0139322]], ['gXYZ', [0.3850649, 0.7168786, 0.0971045]], ['bXYZ', [0.1430804, 0.0606169, 0.7141733]]]
    .forEach(([sig, v]) => v.forEach((x, k) => s15(tagOffset(sig) + 8 + k * 4, x)));
  const curv = new Uint8Array(12 + 1024 * 2);
  const cdv = new DataView(curv.buffer);
  curv.set([0x63, 0x75, 0x72, 0x76]); // 'curv'
  cdv.setUint32(8, 1024);
  for (let k = 0; k < 1024; k++) cdv.setUint16(12 + k * 2, Math.round(lin(k / 1023) * 65535));
  const withCurv = new Uint8Array(icc.length + curv.length);
  withCurv.set(icc);
  withCurv.set(curv, icc.length);
  const wdv = new DataView(withCurv.buffer);
  for (let k = 0; k < wdv.getUint32(128); k++) {
    const o = 132 + k * 12;
    if (/[rgb]TRC/.test(String.fromCharCode(...withCurv.subarray(o, o + 4)))) {
      wdv.setUint32(o + 4, icc.length);
      wdv.setUint32(o + 8, curv.length);
    }
  }
  const profile = parseIcc(withCurv);
  assert.ok(profile);
  assert.equal(isSrgb(profile), true);

  assert.equal(parseIcc(new Uint8Array(64)), null, 'too short');
  const noMatrix = iccFromFixture().slice();
  noMatrix.set([0x41, 0x32, 0x42, 0x30], 132 + 12); // rename rXYZ → A2B0: a LUT profile we do not handle
  assert.equal(parseIcc(noMatrix), null);
});
