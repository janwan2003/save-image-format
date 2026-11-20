#!/usr/bin/env node
// Writes the HEIC test fixtures in tests/fixtures/ from images we draw ourselves.
//   node scripts/make-heic-fixtures.mjs
// Needs ffmpeg with libx265 (only to make the fixtures; the committed files are what the tests use).
// The HEIF container (ISO/IEC 23008-12) is written here by hand, because no tool on the build
// machine writes HEIC: ImageMagick only reads it. The result is checked by ImageMagick's libheif.
//
// quadrants.heic     64×48, one coded image: red top-left, green top-right, blue bottom-left, yellow bottom-right.
// grid-rotated.heic  a 128×96 picture stored as a 2×2 grid of 64×48 tiles (as iPhones store photos, in
//                    512×512 tiles) with an `irot` property of 90° anticlockwise, so it displays as 96×128.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');
const COLORS = ['red', 'lime', 'blue', 'yellow'];

/** HEVC bitstream (Annex B) for one still frame of solid quadrants, w×h. */
function encodeQuadrants(w, h, colors = COLORS) {
  const [a, b, c, d] = colors;
  const hw = w / 2, hh = h / 2;
  const graph = `color=${a}:s=${hw}x${hh}[a];color=${b}:s=${hw}x${hh}[b];color=${c}:s=${hw}x${hh}[c];color=${d}:s=${hw}x${hh}[d];`
    + '[a][b]hstack[t];[c][d]hstack[u];[t][u]vstack,format=yuv420p';
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', graph, '-frames:v', '1',
    '-c:v', 'libx265', '-x265-params', 'log-level=none:keyint=1:info=0', '-f', 'hevc', '-'], { maxBuffer: 1 << 24 });
}

/** Split an Annex B stream into NAL units (without start codes). */
function nalUnits(buf) {
  const starts = [];
  for (let i = 0; i + 3 <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) { starts.push(i + 3); i += 2; }
  }
  return starts.map((s, k) => {
    let end = k + 1 < starts.length ? starts[k + 1] - 3 : buf.length;
    while (end > s && buf[end - 1] === 0) end--; // the zero byte of a 4-byte start code
    return buf.subarray(s, end);
  });
}
const nalType = (n) => (n[0] >> 1) & 0x3f;

function unescapeRbsp(n) {
  const out = [];
  for (let i = 0; i < n.length; i++) {
    if (i >= 2 && n[i] === 3 && n[i - 1] === 0 && n[i - 2] === 0) continue;
    out.push(n[i]);
  }
  return Buffer.from(out);
}

/** HEVCDecoderConfigurationRecord built from the stream's VPS/SPS/PPS. */
function hvcC(nals) {
  const sps = unescapeRbsp(nals.find((n) => nalType(n) === 33));
  const ptl = sps.subarray(3, 15); // profile_tier_level: 1 + 4 + 6 + 1 bytes, after the 2-byte header and 1 byte of ids
  const head = Buffer.from([
    1, ptl[0], ...ptl.subarray(1, 5), ...ptl.subarray(5, 11), ptl[11],
    0xf0, 0x00, 0xfc, 0xfc | 1, 0xf8, 0xf8, 0, 0, 0x0f,
  ]);
  const arrays = [32, 33, 34].map((t) => {
    const list = nals.filter((n) => nalType(n) === t);
    const parts = [Buffer.from([0x80 | t, list.length >> 8, list.length & 255])];
    for (const n of list) parts.push(Buffer.from([n.length >> 8, n.length & 255]), n);
    return Buffer.concat(parts);
  });
  return box('hvcC', head, Buffer.from([arrays.length]), ...arrays);
}

/** Coded picture data: the non-parameter-set VCL NAL units, each with a 4-byte length. */
function sampleData(nals) {
  return Buffer.concat(nals.filter((n) => nalType(n) < 32).flatMap((n) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(n.length); return [len, n];
  }));
}

// ---- ISO-BMFF boxes ---------------------------------------------------------
const u8 = (v) => Buffer.from([v]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
const box = (type, ...payload) => {
  const body = Buffer.concat(payload);
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body]);
};
const fullBox = (type, version, flags, ...payload) => box(type, u8(version), u8(flags >> 16), u16(flags & 0xffff), ...payload);

/**
 * items: [{ id, type: 'hvc1' | 'grid', data: Buffer, props: [index into `props`, 1-based], hidden? }]
 * refs:  [{ type: 'dimg', from, to: [ids] }]
 */
function heif({ items, props, primary, refs = [] }) {
  const ftyp = box('ftyp', Buffer.from('heic', 'latin1'), u32(0), Buffer.from('mif1heic', 'latin1'));
  const build = (mdatStart) => {
    let offset = mdatStart + 8;
    const iloc = fullBox('iloc', 0, 0, u8(0x44), u8(0x00), u16(items.length), ...items.map((it) => {
      const entry = Buffer.concat([u16(it.id), u16(0), u16(1), u32(offset), u32(it.data.length)]);
      offset += it.data.length;
      return entry;
    }));
    const iinf = fullBox('iinf', 0, 0, u16(items.length),
      ...items.map((it) => fullBox('infe', 2, it.hidden ? 1 : 0, u16(it.id), u16(0), Buffer.from(it.type, 'latin1'), u8(0))));
    const iref = refs.length
      ? [fullBox('iref', 0, 0, ...refs.map((r) => box(r.type, u16(r.from), u16(r.to.length), ...r.to.map(u16))))]
      : [];
    const ipma = fullBox('ipma', 0, 0, u32(items.length),
      ...items.map((it) => Buffer.concat([u16(it.id), u8(it.props.length), ...it.props.map((p) => u8(0x80 | p))])));
    const meta = fullBox('meta', 0, 0,
      fullBox('hdlr', 0, 0, u32(0), Buffer.from('pict', 'latin1'), u32(0), u32(0), u32(0), u8(0)),
      fullBox('pitm', 0, 0, u16(primary)),
      iloc, iinf, ...iref,
      box('iprp', box('ipco', ...props), ipma));
    return meta;
  };
  const metaLength = build(0).length; // offsets do not change the length
  const meta = build(ftyp.length + metaLength);
  const mdat = box('mdat', ...items.map((it) => it.data));
  return Buffer.concat([ftyp, meta, mdat]);
}

const ispe = (w, h) => fullBox('ispe', 0, 0, u32(w), u32(h));

// ---- fixtures ---------------------------------------------------------------
mkdirSync(OUT, { recursive: true });

{
  const nals = nalUnits(encodeQuadrants(64, 48));
  const file = heif({
    primary: 1,
    props: [hvcC(nals), ispe(64, 48)],
    items: [{ id: 1, type: 'hvc1', data: sampleData(nals), props: [1, 2] }],
  });
  writeFileSync(join(OUT, 'quadrants.heic'), file);
  console.log(`quadrants.heic ${file.length} bytes`);
}

{
  // Each tile is itself one solid colour, so the grid shows the four colours as quadrants of 128×96.
  const tiles = COLORS.map((c) => nalUnits(encodeQuadrants(64, 48, [c, c, c, c])));
  const gridData = Buffer.concat([u8(0), u8(0), u8(1), u8(1), u16(128), u16(96)]); // version, flags, rows-1, cols-1, w, h
  const file = heif({
    primary: 1,
    props: [hvcC(tiles[0]), ispe(64, 48), ispe(128, 96), box('irot', u8(1))],
    items: [
      { id: 1, type: 'grid', data: gridData, props: [3, 4] },
      ...tiles.map((nals, i) => ({ id: 2 + i, type: 'hvc1', data: sampleData(nals), props: [1, 2], hidden: true })),
    ],
    refs: [{ type: 'dimg', from: 1, to: [2, 3, 4, 5] }],
  });
  writeFileSync(join(OUT, 'grid-rotated.heic'), file);
  console.log(`grid-rotated.heic ${file.length} bytes`);
}
