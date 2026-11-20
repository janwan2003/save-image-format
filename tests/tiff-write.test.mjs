// Unit tests for our TIFF writer (extension/lib/tiff-write.js) in Node.
//   node --test tests/tiff-write.test.mjs
// Every file is read back by our own decoder (site/assets/tiff.js) and, when python3 with Pillow
// (libtiff) is installed, by an independent reader; both must give the exact source pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyse, lzwEncode, makeTiff, tiffPage } from '../extension/lib/tiff-write.js';

await import('../site/assets/tiff.js');
const { SaveformTiff } = globalThis;

let hasPillow;
try { execFileSync('python3', ['-I', '-c', 'import PIL'], { stdio: 'pipe' }); hasPillow = true; } catch { hasPillow = false; }

/** RGBA of every page as Pillow (libtiff) decodes it, or null without Pillow. */
function pillowPages(bytes) {
  if (!hasPillow) return null;
  const dir = mkdtempSync(join(tmpdir(), 'saveform-tiff-'));
  try {
    const file = join(dir, 'a.tif');
    writeFileSync(file, bytes);
    const script = 'import sys, json\nfrom PIL import Image, ImageSequence\nim = Image.open(sys.argv[1])\n'
      + 'out = [{"w": f.size[0], "h": f.size[1], "mode": f.mode, "hex": f.convert("RGBA").tobytes().hex()} for f in ImageSequence.Iterator(im)]\n'
      + 'print(json.dumps(out))';
    const out = JSON.parse(execFileSync('python3', ['-I', '-c', script, file], { maxBuffer: 256 * 1024 * 1024 }).toString());
    return out.map((p) => ({ ...p, data: Buffer.from(p.hex, 'hex') }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function image(w, h, kind) {
  const d = new Uint8ClampedArray(w * h * 4);
  let s = 7;
  const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s & 255; }; // xorshift: no LCG low-bit patterns
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    d[i + 3] = 255;
    if (kind === 'noise') { d[i] = rnd(); d[i + 1] = rnd(); d[i + 2] = rnd(); }
    else if (kind === 'photo') { d[i] = (x * 255 / w) | 0; d[i + 1] = (y * 255 / h) | 0; d[i + 2] = 128 + ((x ^ y) & 63); }
    else if (kind === 'alpha') { d[i] = x & 255; d[i + 1] = 80; d[i + 2] = y & 255; d[i + 3] = (x * 3 + y) & 255; }
    else if (kind === 'grey') { d[i] = d[i + 1] = d[i + 2] = (x * 7 + y * 3) & 255; }
    else if (kind === 'bw') { d[i] = d[i + 1] = d[i + 2] = ((x >> 2) + (y >> 3)) % 3 ? 255 : 0; }
  }
  return d;
}

const CASES = [
  ['photo', 640, 480, { spp: 3, bps: 8 }],
  ['noise', 301, 203, { spp: 3, bps: 8 }], // incompressible: many LZW table resets per strip
  ['alpha', 257, 129, { spp: 4, bps: 8 }],
  ['grey', 999, 77, { spp: 1, bps: 8 }],
  ['bw', 1001, 333, { spp: 1, bps: 1 }], // width not a multiple of 8
  ['bw', 7, 5, { spp: 1, bps: 1 }],
];

for (const compression of ['lzw', 'none']) {
  for (const [kind, w, h, want] of CASES) {
    test(`TIFF writer: ${kind} ${w}×${h}, ${compression} → exact pixels in our decoder${hasPillow ? ' and Pillow/libtiff' : ''}`, async () => {
      const px = image(w, h, kind);
      const page = tiffPage(px, w, h, { compression });
      assert.equal(page.spp, want.spp, 'samples per pixel');
      assert.equal(page.bps, want.bps, 'bits per sample');
      assert.equal(page.compression, compression === 'lzw' ? 5 : 1);
      const bytes = new Uint8Array(await makeTiff([page]).arrayBuffer());
      assert.deepEqual([...bytes.subarray(0, 4)], [0x49, 0x49, 42, 0]);
      const r = await SaveformTiff.decode(bytes.buffer, 0);
      assert.deepEqual([r.width, r.height], [w, h]);
      assert.ok(Buffer.from(r.data).equals(Buffer.from(px)), 'our decoder: exact pixels');
      const pil = pillowPages(bytes);
      if (pil) {
        assert.equal(pil.length, 1);
        assert.deepEqual([pil[0].w, pil[0].h], [w, h]);
        assert.equal(pil[0].mode, { 4: 'RGBA', 3: 'RGB', 1: want.bps === 1 ? '1' : 'L' }[want.spp]);
        assert.ok(pil[0].data.equals(Buffer.from(px)), 'Pillow/libtiff: exact pixels');
      }
      if (compression === 'lzw' && kind !== 'noise' && w * h > 10000) assert.ok(bytes.length < w * h * want.spp * want.bps / 8 / 2, `compressed (${bytes.length} bytes)`);
    });
  }
}

test('TIFF writer: three pages of different kinds in one file, PageNumber set, read back in order', async () => {
  const specs = [['photo', 64, 48], ['bw', 30, 20], ['alpha', 50, 50]];
  const pages = specs.map(([k, w, h]) => tiffPage(image(w, h, k), w, h));
  const bytes = new Uint8Array(await makeTiff(pages).arrayBuffer());
  assert.equal(SaveformTiff.pages(bytes.buffer), 3);
  for (const [i, [k, w, h]] of specs.entries()) {
    const r = await SaveformTiff.decode(bytes.buffer, i);
    assert.ok(Buffer.from(r.data).equals(Buffer.from(image(w, h, k))), `page ${i + 1}`);
  }
  const pil = pillowPages(bytes);
  if (pil) assert.deepEqual(pil.map((p) => `${p.w}x${p.h} ${p.mode}`), ['64x48 RGB', '30x20 1', '50x50 RGBA']);
});

test('LZW encoder: empty input, one byte, long runs and a 4,094-entry table reset round-trip', async () => {
  const runs = new Uint8Array(200000); // one value: codes grow to 12 bits without filling the table
  const ramp = Uint8Array.from({ length: 300000 }, (_, i) => (i * 7 + (i >> 9)) & 255);
  for (const src of [new Uint8Array(0), Uint8Array.of(42), runs, ramp]) {
    const enc = lzwEncode(src);
    const out = SaveformTiff._internal.lzw(enc, src.length);
    assert.ok(Buffer.from(out).equals(Buffer.from(src)), `${src.length} bytes`);
    assert.equal(enc[0] >> 7, 1, 'starts with Clear (256 as 9 bits)');
  }
});

test('analyse: opaque / grey / black-and-white detection', () => {
  assert.deepEqual(analyse(Uint8ClampedArray.of(0, 0, 0, 255, 255, 255, 255, 255)), { opaque: true, grey: true, bilevel: true });
  assert.deepEqual(analyse(Uint8ClampedArray.of(0, 0, 0, 255, 128, 128, 128, 255)), { opaque: true, grey: true, bilevel: false });
  assert.deepEqual(analyse(Uint8ClampedArray.of(0, 0, 1, 255, 255, 255, 255, 255)), { opaque: true, grey: false, bilevel: false });
  assert.deepEqual(analyse(Uint8ClampedArray.of(0, 0, 0, 254)), { opaque: false, grey: false, bilevel: false });
});

test('an unmarked small IFD after a page (camera thumbnail) is not a page; a marked one is', async () => {
  const big = tiffPage(image(640, 480, 'photo'), 640, 480);
  const thumb = tiffPage(image(160, 120, 'photo'), 160, 120);
  const bytes = new Uint8Array(await makeTiff([big, thumb]).arrayBuffer());
  assert.equal(SaveformTiff.pages(bytes.buffer), 2, 'our writer marks every page with NewSubfileType 0');
  // Turn the second IFD's NewSubfileType (254) into an unknown tag 253, like cameras that omit it.
  const dv = new DataView(bytes.buffer);
  const ifd2 = dv.getUint32(dv.getUint32(4, true) + 2 + dv.getUint16(dv.getUint32(4, true), true) * 12, true);
  assert.equal(dv.getUint16(ifd2 + 2, true), 254);
  dv.setUint16(ifd2 + 2, 253, true);
  assert.equal(SaveformTiff.pages(bytes.buffer), 1);
  // Same-size pages without the tag stay pages (scanner output).
  const two = new Uint8Array(await makeTiff([big, big]).arrayBuffer());
  const dv2 = new DataView(two.buffer);
  const second = dv2.getUint32(dv2.getUint32(4, true) + 2 + dv2.getUint16(dv2.getUint32(4, true), true) * 12, true);
  dv2.setUint16(second + 2, 253, true);
  assert.equal(SaveformTiff.pages(two.buffer), 2);
});
