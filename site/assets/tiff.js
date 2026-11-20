// Saveform TIFF decoder (own implementation, no dependencies). Chrome, Edge and Firefox cannot
// display TIFF, so the converter pages decode it here, inside tiff-worker.js.
// Classic script: exposes globalThis.SaveformTiff = { pages, decode }.
//
// Covered: little/big-endian TIFF and BigTIFF; strips and tiles; chunky and planar samples;
// no compression, PackBits, LZW, Deflate (zlib), JPEG ("new-style", compression 7), CCITT
// Group 3/4 fax (compression 2/3/4); horizontal predictor; 1/2/4/8/16-bit integer and
// 32-bit float samples; bilevel, greyscale, RGB, palette, CMYK and YCbCr (JPEG or 1×1
// subsampling); associated/unassociated alpha; Orientation; multi-page files (one IFD each).
// Not covered (clear error instead): old-style JPEG (6), LZMA/ZSTD/WebP-in-TIFF, CIELab, LogLuv,
// floating-point predictor.
(function () {
  'use strict';

  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };
  const COMPRESSION_NAMES = {
    6: 'old-style JPEG', 34712: 'JPEG 2000', 34925: 'LZMA', 50000: 'Zstandard', 50001: 'WebP',
    34887: 'LERC', 32809: 'ThunderScan', 34676: 'SGI LogLuv', 34677: 'SGI LogLuv', 32946: 'Deflate',
  };

  function fail(message) {
    const e = new Error(message);
    e.code = 'decode-failed'; e.kind = 'tiff';
    return e;
  }

  // ---- structure -------------------------------------------------------------------------
  function parse(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    if (bytes.length < 8) throw fail('This TIFF file is truncated');
    const le = bytes[0] === 0x49 && bytes[1] === 0x49;
    if (!le && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) throw fail('This is not a TIFF file');
    const u16 = (o) => dv.getUint16(o, le);
    const u32 = (o) => dv.getUint32(o, le);
    const u64 = (o) => Number(dv.getBigUint64(o, le));
    const version = u16(2);
    const big = version === 43;
    if (version !== 42 && !big) throw fail('This is not a TIFF file');
    const off = big ? (o) => u64(o) : u32;
    const read = (type, o) => {
      switch (type) {
        case 1: case 2: case 7: return bytes[o];
        case 3: return u16(o);
        case 4: case 13: return u32(o);
        case 5: return u32(o) / (u32(o + 4) || 1);
        case 6: return dv.getInt8(o);
        case 8: return dv.getInt16(o, le);
        case 9: return dv.getInt32(o, le);
        case 10: return dv.getInt32(o, le) / (dv.getInt32(o + 4, le) || 1);
        case 11: return dv.getFloat32(o, le);
        case 12: return dv.getFloat64(o, le);
        case 16: case 18: return u64(o);
        case 17: return Number(dv.getBigInt64(o, le));
        default: return 0;
      }
    };
    const ifds = [];
    const seen = new Set();
    let pos = big ? u64(8) : u32(4);
    while (pos && !seen.has(pos) && ifds.length < 10000) {
      seen.add(pos);
      if (pos + (big ? 8 : 2) > bytes.length) {
        if (!ifds.length) throw fail('This TIFF file is truncated or damaged');
        break;
      }
      const n = big ? u64(pos) : u16(pos);
      const entrySize = big ? 20 : 12;
      const first = pos + (big ? 8 : 2);
      if (first + n * entrySize > bytes.length) throw fail('This TIFF file is truncated');
      const tags = new Map();
      for (let i = 0; i < n; i++) {
        const e = first + i * entrySize;
        const tag = u16(e), type = u16(e + 2);
        const count = big ? u64(e + 4) : u32(e + 4);
        const size = TYPE_SIZE[type];
        if (!size) continue;
        const inline = count * size <= (big ? 8 : 4);
        const at = inline ? e + (big ? 12 : 8) : off(e + (big ? 12 : 8));
        if (at + count * size > bytes.length) continue; // broken entry: ignore the tag
        if (type === 7 || (type === 1 && count > 64)) tags.set(tag, bytes.subarray(at, at + count));
        else {
          const values = new Array(count);
          for (let k = 0; k < count; k++) values[k] = read(type, at + k * size);
          tags.set(tag, values);
        }
      }
      ifds.push(tags);
      const next = first + n * entrySize;
      pos = next + (big ? 8 : 4) <= bytes.length ? off(next) : 0;
    }
    if (!ifds.length) throw fail('This TIFF file has no images');
    // Reduced-resolution copies (thumbnails, NewSubfileType bit 0) are not pages.
    // Some cameras store an unmarked thumbnail right after the image (e.g. a 160×120 copy of a
    // 640×480 photo, with no NewSubfileType tag at all): such an IFD, at most a third of the previous
    // page's size and the same shape, is treated as a thumbnail too.
    const dims = (t) => [t.get(256)?.[0] || 0, t.get(257)?.[0] || 0];
    const isThumbOf = (t, prev) => {
      if (t.has(254)) return false; // marked as a page (our own writer and most scanners write 0)
      const [w, h] = dims(t), [pw, ph] = dims(prev);
      return w > 0 && h > 0 && Math.max(w, h) <= 512 && w * 3 <= pw && h * 3 <= ph && Math.abs(w / h - pw / ph) <= 0.03 * (pw / ph);
    };
    const marked = ifds.filter((t) => !((t.get(254)?.[0] ?? 0) & 1) && t.has(256));
    const full = marked.filter((t, i) => i === 0 || !isThumbOf(t, marked[i - 1]));
    return { bytes, le, pages: full.length ? full : ifds.filter((t) => t.has(256)) };
  }

  // ---- decompression ---------------------------------------------------------------------
  function packBits(src, expected) {
    const out = new Uint8Array(expected);
    let i = 0, o = 0;
    while (i < src.length && o < expected) {
      const n = (src[i++] << 24) >> 24;
      if (n >= 0) {
        const len = Math.min(n + 1, expected - o, src.length - i);
        out.set(src.subarray(i, i + len), o); i += n + 1; o += len;
      } else if (n !== -128) {
        const len = Math.min(1 - n, expected - o);
        out.fill(src[i++], o, o + len); o += len;
      }
    }
    return out;
  }

  // TIFF LZW: MSB-first codes, 9–12 bits, code width grows one code early, 256 = clear, 257 = end.
  // Old-style LZW (libtiff before 1991, recognised by its first bytes): LSB-first codes, no early change.
  function lzw(src, expected, oldStyle = false) {
    const out = new Uint8Array(expected);
    const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), length = new Int32Array(4096), first = new Uint8Array(4096);
    for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; length[i] = 1; first[i] = i; }
    let next = 258, width = 9, prev = -1, o = 0, bitPos = 0;
    const totalBits = src.length * 8;
    const emit = (code) => {
      const len = length[code];
      let p = o + len - 1, c = code;
      while (c >= 0) { if (p < expected) out[p] = suffix[c]; p--; c = prefix[c]; }
      o += len;
    };
    while (o < expected && bitPos + width <= totalBits) {
      let code = 0;
      if (oldStyle) for (let k = 0; k < width; k++, bitPos++) code |= ((src[bitPos >> 3] >> (bitPos & 7)) & 1) << k;
      else for (let k = 0; k < width; k++, bitPos++) code = (code << 1) | ((src[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
      if (code === 257) break;
      if (code === 256) { next = 258; width = 9; prev = -1; continue; }
      if (prev < 0) {
        if (code > 255) break;
        emit(code); prev = code; continue;
      }
      if (code < next) {
        emit(code);
        if (next < 4096) { prefix[next] = prev; suffix[next] = first[code]; length[next] = length[prev] + 1; first[next] = first[prev]; next++; }
      } else if (code === next && next < 4096) {
        // The code being defined right now (KwKwK): previous string plus its own first byte.
        prefix[next] = prev; suffix[next] = first[prev]; length[next] = length[prev] + 1; first[next] = first[prev]; next++;
        emit(code);
      } else break; // corrupt
      prev = code;
      if (next + (oldStyle ? 0 : 1) >= (1 << width) && width < 12) width++;
    }
    return out;
  }

  async function inflate(src) {
    const ds = new DecompressionStream('deflate');
    const stream = new Blob([src]).stream().pipeThrough(ds);
    const chunks = [];
    let total = 0;
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); total += value.length;
      }
    } catch (err) {
      if (!total) throw fail('The compressed data in this TIFF file is damaged');
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  const REVERSE = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { let r = 0; for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 0x80 >> b; REVERSE[i] = r; }

  // ---- CCITT fax (T.4 / T.6) ---------------------------------------------------------------
  // Run-length code tables from ITU-T T.4: [code bits as a string, run length].
  const faxTables = (() => {
    const white = [
      ['00110101', 0], ['000111', 1], ['0111', 2], ['1000', 3], ['1011', 4], ['1100', 5], ['1110', 6], ['1111', 7],
      ['10011', 8], ['10100', 9], ['00111', 10], ['01000', 11], ['001000', 12], ['000011', 13], ['110100', 14], ['110101', 15],
      ['101010', 16], ['101011', 17], ['0100111', 18], ['0001100', 19], ['0001000', 20], ['0010111', 21], ['0000011', 22], ['0000100', 23],
      ['0101000', 24], ['0101011', 25], ['0010011', 26], ['0100100', 27], ['0011000', 28], ['00000010', 29], ['00000011', 30], ['00011010', 31],
      ['00011011', 32], ['00010010', 33], ['00010011', 34], ['00010100', 35], ['00010101', 36], ['00010110', 37], ['00010111', 38], ['00101000', 39],
      ['00101001', 40], ['00101010', 41], ['00101011', 42], ['00101100', 43], ['00101101', 44], ['00000100', 45], ['00000101', 46], ['00001010', 47],
      ['00001011', 48], ['01010010', 49], ['01010011', 50], ['01010100', 51], ['01010101', 52], ['00100100', 53], ['00100101', 54], ['01011000', 55],
      ['01011001', 56], ['01011010', 57], ['01011011', 58], ['01001010', 59], ['01001011', 60], ['00110010', 61], ['00110011', 62], ['00110100', 63],
      ['11011', 64], ['10010', 128], ['010111', 192], ['0110111', 256], ['00110110', 320], ['00110111', 384], ['01100100', 448], ['01100101', 512],
      ['01101000', 576], ['01100111', 640], ['011001100', 704], ['011001101', 768], ['011010010', 832], ['011010011', 896], ['011010100', 960],
      ['011010101', 1024], ['011010110', 1088], ['011010111', 1152], ['011011000', 1216], ['011011001', 1280], ['011011010', 1344],
      ['011011011', 1408], ['010011000', 1472], ['010011001', 1536], ['010011010', 1600], ['011000', 1664], ['010011011', 1728],
    ];
    const black = [
      ['0000110111', 0], ['010', 1], ['11', 2], ['10', 3], ['011', 4], ['0011', 5], ['0010', 6], ['00011', 7],
      ['000101', 8], ['000100', 9], ['0000100', 10], ['0000101', 11], ['0000111', 12], ['00000100', 13], ['00000111', 14], ['000011000', 15],
      ['0000010111', 16], ['0000011000', 17], ['0000001000', 18], ['00001100111', 19], ['00001101000', 20], ['00001101100', 21], ['00000110111', 22], ['00000101000', 23],
      ['00000010111', 24], ['00000011000', 25], ['000011001010', 26], ['000011001011', 27], ['000011001100', 28], ['000011001101', 29], ['000001101000', 30], ['000001101001', 31],
      ['000001101010', 32], ['000001101011', 33], ['000011010010', 34], ['000011010011', 35], ['000011010100', 36], ['000011010101', 37], ['000011010110', 38], ['000011010111', 39],
      ['000001101100', 40], ['000001101101', 41], ['000011011010', 42], ['000011011011', 43], ['000001010100', 44], ['000001010101', 45], ['000001010110', 46], ['000001010111', 47],
      ['000001100100', 48], ['000001100101', 49], ['000001010010', 50], ['000001010011', 51], ['000000100100', 52], ['000000110111', 53], ['000000111000', 54], ['000000100111', 55],
      ['000000101000', 56], ['000001011000', 57], ['000001011001', 58], ['000000101011', 59], ['000000101100', 60], ['000001011010', 61], ['000001100110', 62], ['000001100111', 63],
      ['0000001111', 64], ['000011001000', 128], ['000011001001', 192], ['000001011011', 256], ['000000110011', 320], ['000000110100', 384], ['000000110101', 448],
      ['0000001101100', 512], ['0000001101101', 576], ['0000001001010', 640], ['0000001001011', 704], ['0000001001100', 768], ['0000001001101', 832],
      ['0000001110010', 896], ['0000001110011', 960], ['0000001110100', 1024], ['0000001110101', 1088], ['0000001110110', 1152], ['0000001110111', 1216],
      ['0000001010010', 1280], ['0000001010011', 1344], ['0000001010100', 1408], ['0000001010101', 1472], ['0000001011010', 1536], ['0000001011011', 1600],
      ['0000001100100', 1664], ['0000001100101', 1728],
    ];
    const extended = [
      ['00000001000', 1792], ['00000001100', 1856], ['00000001101', 1920], ['000000010010', 1984], ['000000010011', 2048], ['000000010100', 2112],
      ['000000010101', 2176], ['000000010110', 2240], ['000000010111', 2304], ['000000011100', 2368], ['000000011101', 2432], ['000000011110', 2496],
      ['000000011111', 2560],
    ];
    const build = (list) => {
      const m = new Map();
      for (const [code, run] of [...list, ...extended]) m.set(`${code.length}:${parseInt(code, 2)}`, run);
      return m;
    };
    return { white: build(white), black: build(black) };
  })();

  function faxDecode(src, width, height, { mode, t4Options = 0, fillOrder = 1 }) {
    // Returns 1-bit rows (MSB first, 1 = black) as a Uint8Array, rows padded to bytes.
    if (fillOrder === 2) src = src.map((b) => REVERSE[b]);
    const rowBytes = (width + 7) >> 3;
    const out = new Uint8Array(rowBytes * height);
    let bit = 0;
    const total = src.length * 8;
    const peek = (n) => {
      let v = 0;
      for (let k = 0; k < n; k++) { const p = bit + k; v = (v << 1) | (p < total ? (src[p >> 3] >> (7 - (p & 7))) & 1 : 0); }
      return v;
    };
    const peek1 = (p) => (src[p >> 3] >> (7 - (p & 7))) & 1;
    const readRun = (black) => {
      const table = black ? faxTables.black : faxTables.white;
      let run = 0;
      for (;;) {
        let found = -1;
        for (let n = 2; n <= 13; n++) {
          const r = table.get(`${n}:${peek(n)}`);
          if (r !== undefined) { found = r; bit += n; break; }
        }
        if (found < 0) throw fail('The fax-compressed data in this TIFF file is damaged');
        run += found;
        if (found < 64) return run;
      }
    };
    const twoD = mode === 4 || (mode === 3 && (t4Options & 1));
    let ref = [width, width]; // changing elements of the reference line (all white)
    for (let y = 0; y < height && bit < total; y++) {
      const cur = [];
      let rowIs2D = mode === 4;
      if (mode === 3) {
        // Optional fill bits and an EOL (000000000001) precede each row; RTC ends the strip.
        let z = 0;
        while (bit + z < total && peek1(bit + z) === 0) z++;
        if (z >= 11 && bit + z < total) bit += z + 1;
        if (twoD) { rowIs2D = peek(1) === 0; bit++; }
      } else if (mode === 2) {
        // Modified Huffman (compression 2): each row starts on a byte boundary.
        bit = (bit + 7) & ~7;
      }
      if (!rowIs2D) {
        let a = 0, black = false;
        while (a < width) {
          const run = readRun(black);
          a += run;
          cur.push(Math.min(a, width));
          black = !black;
          if (bit >= total) break;
        }
      } else {
        let a0 = -1, colour = 0; // 0 white, 1 black
        while (a0 < width) {
          // b1: first changing element on ref line right of a0 with colour opposite to current colour.
          let i = 0;
          while (i < ref.length && (ref[i] <= a0 || (i & 1) !== colour)) i++;
          const b1 = i < ref.length ? ref[i] : width;
          const b2 = i + 1 < ref.length ? ref[i + 1] : width;
          if (peek(1) === 1) { bit += 1; a0 = b1; cur.push(a0); colour ^= 1; continue; } // V0
          const p3 = peek(3);
          if (p3 === 0b011) { bit += 3; a0 = b1 + 1; cur.push(a0); colour ^= 1; continue; } // VR1
          if (p3 === 0b010) { bit += 3; a0 = b1 - 1; cur.push(a0); colour ^= 1; continue; } // VL1
          if (p3 === 0b001) { // horizontal
            bit += 3;
            const start = Math.max(a0, 0);
            const r1 = readRun(colour === 1), r2 = readRun(colour !== 1);
            cur.push(Math.min(start + r1, width), Math.min(start + r1 + r2, width));
            a0 = start + r1 + r2;
            continue;
          }
          const p4 = peek(4);
          if (p4 === 0b0001) { bit += 4; a0 = b2; continue; } // pass
          const p6 = peek(6);
          if (p6 === 0b000011) { bit += 6; a0 = b1 + 2; cur.push(a0); colour ^= 1; continue; }
          if (p6 === 0b000010) { bit += 6; a0 = b1 - 2; cur.push(a0); colour ^= 1; continue; }
          const p7 = peek(7);
          if (p7 === 0b0000011) { bit += 7; a0 = b1 + 3; cur.push(a0); colour ^= 1; continue; }
          if (p7 === 0b0000010) { bit += 7; a0 = b1 - 3; cur.push(a0); colour ^= 1; continue; }
          if (peek(12) === 1) break; // EOL / EOFB
          throw fail('The fax-compressed data in this TIFF file is damaged');
        }
      }
      // Paint black runs: changing elements alternate white→black, black→white.
      const row = y * rowBytes;
      let x = 0, black = false;
      for (const c of cur) {
        const end = Math.min(Math.max(c, 0), width);
        if (black) for (let p = x; p < end; p++) out[row + (p >> 3)] |= 0x80 >> (p & 7);
        x = Math.max(x, end); black = !black;
      }
      if (black) for (let p = x; p < width; p++) out[row + (p >> 3)] |= 0x80 >> (p & 7);
      const clean = cur.filter((c) => c < width);
      ref = [...clean, width, width];
    }
    return out;
  }

  // ---- decoding a page ----------------------------------------------------------------------
  async function decode(buffer, pageIndex = 0) {
    const { bytes, le, pages } = parse(buffer);
    const t = pages[Math.min(Math.max(pageIndex, 0), pages.length - 1)];
    const one = (tag, d) => (t.has(tag) ? t.get(tag)[0] : d);
    const width = one(256, 0), height = one(257, 0);
    if (!width || !height) throw fail('This TIFF file has no image size');
    if (width * height > 268e6) throw fail(`This TIFF image is ${width} × ${height} pixels, too large to convert in a browser`);
    const compression = one(259, 1);
    const photometric = one(262, t.has(320) ? 3 : 1);
    const spp = one(277, 1);
    const bpsList = t.get(258) || [1];
    const bps = bpsList[0];
    const planar = one(284, 1);
    const predictor = one(317, 1);
    const sampleFormat = one(339, 1);
    const fillOrder = one(266, 1);
    const extra = t.get(338) || [];
    // Some early writers put tile offsets in the strip tags; libtiff accepts that, so do we.
    const tiled = t.has(322) && (t.has(324) || t.has(273));
    const cw = tiled ? one(322, width) : width;
    const ch = tiled ? one(323, height) : Math.min(one(278, height), height) || height;
    const offsets = (tiled && t.get(324)) || t.get(273);
    const counts = (tiled && t.get(325)) || t.get(279);
    if (!offsets) throw fail('This TIFF file has no image data');
    if (COMPRESSION_NAMES[compression] && ![32946].includes(compression)) throw fail(`This TIFF file uses ${COMPRESSION_NAMES[compression]} compression, which this converter does not support yet`);
    if (![1, 2, 3, 4, 5, 7, 8, 32773, 32946].includes(compression)) throw fail(`This TIFF file uses an unsupported compression method (${compression})`);
    if (![0, 1, 2, 3, 5, 6].includes(photometric)) throw fail('This TIFF file uses a colour model this converter does not support (for example CIELab)');
    if (predictor === 3) throw fail('This TIFF file stores floating-point data with a predictor this converter does not support');
    if (sampleFormat === 3 && bps !== 32) throw fail(`${bps}-bit floating-point TIFF images are not supported`);
    if (!(bps >= 1 && bps <= 32) || (sampleFormat === 3 && bps !== 32)) throw fail(`${bps}-bit TIFF images are not supported`);
    const subsampling = t.get(530) || [2, 2];
    const subsampled = photometric === 6 && compression !== 7 && (subsampling[0] !== 1 || subsampling[1] !== 1);
    if (subsampled && (bps !== 8 || planar !== 1 || spp !== 3 || ![1, 2, 4].includes(subsampling[0]) || ![1, 2, 4].includes(subsampling[1]))) {
      throw fail('This TIFF file uses a YCbCr layout this converter does not support');
    }

    const across = Math.ceil(width / cw), down = Math.ceil(height / ch);
    const perPlane = across * down;
    const planes = planar === 2 ? spp : 1;
    const chunkSpp = planar === 2 ? 1 : spp;
    const [sh, sv] = subsampled ? subsampling : [1, 1];
    // Subsampled YCbCr is stored in blocks of sh×sv luma samples followed by one Cb and one Cr.
    const rowBytes = subsampled ? Math.ceil(cw / sh) * (sh * sv + 2) : Math.ceil((cw * chunkSpp * bps) / 8);
    const rgba = new Uint8ClampedArray(width * height * 4);

    const chunkBytes = (i) => {
      const o = offsets[i] ?? 0, n = counts?.[i] ?? (bytes.length - o);
      return bytes.subarray(o, Math.min(bytes.length, o + n));
    };
    const chunkPos = (i) => { const k = i % perPlane; return [(k % across) * cw, Math.floor(k / across) * ch]; };

    if (compression === 7) {
      await decodeJpegChunks({ t, bytes: chunkBytes, count: Math.min(offsets.length, perPlane), pos: chunkPos, rgba, width, height, photometric });
      return finish(rgba, width, height, t);
    }

    // Collect samples into a per-image buffer (scaled to 8 bits, or raw palette indices).
    const nsamp = spp;
    const S = photometric === 3 && bps > 8 ? new Uint16Array(width * height * nsamp) : new Uint8Array(width * height * nsamp);
    const maxVal = 2 ** bps - 1;
    const scale = photometric === 3 ? 1 : 255 / maxVal;
    const total = Math.min(offsets.length, perPlane * planes);
    for (let i = 0; i < total; i++) {
      const plane = planar === 2 ? Math.floor(i / perPlane) : 0;
      const [x0, y0] = chunkPos(i);
      const rows = tiled ? ch : Math.min(ch, height - y0);
      const expected = subsampled ? rowBytes * Math.ceil(rows / sv) : rowBytes * rows;
      let src = chunkBytes(i);
      let data;
      if (compression === 2 || compression === 3 || compression === 4) {
        data = faxDecode(src, cw, rows, { mode: compression, t4Options: compression === 3 ? one(292, 0) : one(293, 0), fillOrder });
        // Fax data is 1 = black; with WhiteIsZero (the norm) that is what the bits already mean.
      } else {
        if (fillOrder === 2) src = src.map((b) => REVERSE[b]);
        if (compression === 1) data = src;
        else if (compression === 32773) data = packBits(src, expected);
        else if (compression === 5) data = lzw(src, expected, src[0] === 0 && (src[1] & 1) === 1);
        else data = await inflate(src);
      }
      if (data.length < expected) { const d = new Uint8Array(expected); d.set(data); data = d; }
      if (subsampled) {
        const blocksAcross = Math.ceil(cw / sh), unit = sh * sv + 2;
        for (let by = 0; by * sv < rows; by++) {
          for (let bx = 0; bx < blocksAcross; bx++) {
            const o = (by * blocksAcross + bx) * unit;
            const cb = data[o + sh * sv], cr = data[o + sh * sv + 1];
            for (let k = 0; k < sh * sv; k++) {
              const x = x0 + bx * sh + (k % sh), y = y0 + by * sv + Math.floor(k / sh);
              if (x >= width || y >= height || x >= x0 + cw) continue;
              const d = (y * width + x) * 3;
              S[d] = data[o + k]; S[d + 1] = cb; S[d + 2] = cr;
            }
          }
        }
        continue;
      }
      if (predictor === 2) undoPredictor(data, cw, rows, chunkSpp, bps, le, rowBytes);
      if (bps === 8 && planar === 1 && photometric !== 3) {
        // Common case (8-bit chunky): copy whole rows.
        const xEnd = Math.min(cw, width - x0);
        for (let r = 0; r < rows && y0 + r < height; r++) S.set(data.subarray(r * rowBytes, r * rowBytes + xEnd * spp), ((y0 + r) * width + x0) * nsamp);
        continue;
      }
      const readSample = sampleReader(data, bps, sampleFormat, le);
      for (let r = 0; r < rows; r++) {
        const y = y0 + r;
        if (y >= height) break;
        const rowBit = r * rowBytes * 8;
        const xEnd = Math.min(cw, width - x0);
        for (let x = 0; x < xEnd; x++) {
          const dst = ((y * width) + x0 + x) * nsamp;
          if (planar === 2) {
            const v = readSample(rowBit + x * bps);
            S[dst + plane] = photometric === 3 ? v : Math.round(v * scale);
          } else {
            const base = rowBit + x * spp * bps;
            for (let s = 0; s < spp; s++) {
              const v = readSample(base + s * bps);
              S[dst + s] = photometric === 3 && s === 0 ? v : Math.round(v * (photometric === 3 ? 255 / maxVal : scale));
            }
          }
        }
      }
    }

    // Colour model → RGBA.
    const colourSamples = photometric === 2 || photometric === 6 ? 3 : photometric === 5 ? 4 : 1;
    const alphaIndex = extra.length && (extra[0] === 1 || extra[0] === 2) && spp > colourSamples ? colourSamples : -1;
    const associated = alphaIndex >= 0 && extra[0] === 1;
    const map = t.get(320);
    // YCbCr: TIFF 6.0 defaults are the BT.601 coefficients and full-range codes.
    const [lr, lg, lb] = t.get(529)?.length === 3 ? t.get(529) : [0.299, 0.587, 0.114];
    const rbw = t.get(532)?.length === 6 ? t.get(532) : [0, 255, 128, 255, 128, 255];
    const mapN = 1 << bps;
    if (photometric === 5 && spp < 4) throw fail('This CMYK TIFF file has too few channels');
    for (let p = 0, s = 0, d = 0; p < width * height; p++, s += nsamp, d += 4) {
      let r, g, b;
      switch (photometric) {
        case 0: r = g = b = 255 - S[s]; break;
        case 1: r = g = b = S[s]; break;
        case 2: r = S[s]; g = S[s + 1]; b = S[s + 2]; break;
        case 3: {
          const i = S[s];
          if (map && i < mapN) { r = map[i] >> 8; g = map[mapN + i] >> 8; b = map[2 * mapN + i] >> 8; } else r = g = b = 0;
          break;
        }
        case 5: {
          const k = 255 - S[s + 3];
          r = ((255 - S[s]) * k) / 255; g = ((255 - S[s + 1]) * k) / 255; b = ((255 - S[s + 2]) * k) / 255;
          break;
        }
        case 6: {
          const Y = (S[s] - rbw[0]) * 255 / (rbw[1] - rbw[0] || 1);
          const cb = (S[s + 1] - rbw[2]) * 127 / (rbw[3] - rbw[2] || 1), cr = (S[s + 2] - rbw[4]) * 127 / (rbw[5] - rbw[4] || 1);
          r = Y + cr * (2 - 2 * lr); b = Y + cb * (2 - 2 * lb); g = (Y - lb * b - lr * r) / lg;
          break;
        }
        default: r = g = b = 0;
      }
      let a = 255;
      if (alphaIndex >= 0) {
        a = S[s + alphaIndex];
        if (associated && a > 0 && a < 255) { const f = 255 / a; r *= f; g *= f; b *= f; }
      }
      rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
    }
    return finish(rgba, width, height, t, photometric);
  }

  function sampleReader(data, bps, sampleFormat, le) {
    if (bps === 8) return (bit) => data[bit >> 3];
    if (bps === 16) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      return sampleFormat === 2 ? (bit) => dv.getInt16(bit >> 3, le) + 32768 : (bit) => dv.getUint16(bit >> 3, le);
    }
    if (bps === 32) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (sampleFormat === 3) return (bit) => Math.max(0, Math.min(1, dv.getFloat32(bit >> 3, le))) * 0xffffffff;
      return sampleFormat === 2 ? (bit) => dv.getInt32(bit >> 3, le) + 2147483648 : (bit) => dv.getUint32(bit >> 3, le);
    }
    if (bps < 8 && 8 % bps === 0) {
      const mask = (1 << bps) - 1;
      return (bit) => (data[bit >> 3] >> (8 - bps - (bit & 7))) & mask;
    }
    // Other depths (6, 10, 12, 14, 24 bits…) can cross byte boundaries: read bit by bit, MSB first.
    return (bit) => {
      let v = 0;
      for (let k = 0; k < bps; k++) { const p = bit + k; v = v * 2 + ((data[p >> 3] >> (7 - (p & 7))) & 1); }
      return v;
    };
  }

  function undoPredictor(data, w, rows, spp, bps, le, rowBytes) {
    if (bps === 8) {
      for (let r = 0; r < rows; r++) {
        const o = r * rowBytes;
        for (let i = spp; i < w * spp; i++) data[o + i] = (data[o + i] + data[o + i - spp]) & 255;
      }
    } else if (bps === 16) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let r = 0; r < rows; r++) {
        const o = r * rowBytes;
        for (let i = spp; i < w * spp; i++) dv.setUint16(o + i * 2, (dv.getUint16(o + i * 2, le) + dv.getUint16(o + (i - spp) * 2, le)) & 0xffff, le);
      }
    } else if (bps === 32) {
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let r = 0; r < rows; r++) {
        const o = r * rowBytes;
        for (let i = spp; i < w * spp; i++) dv.setUint32(o + i * 4, (dv.getUint32(o + i * 4, le) + dv.getUint32(o + (i - spp) * 4, le)) >>> 0, le);
      }
    } else {
      throw fail(`The horizontal predictor with ${bps}-bit samples is not supported`);
    }
  }

  async function decodeJpegChunks({ t, bytes, count, pos, rgba, width, height }) {
    const tables = t.get(347);
    const tablesBody = tables && tables.length > 4 ? tables.subarray(2, tables.length - 2) : null; // without SOI/EOI
    for (let i = 0; i < count; i++) {
      let chunk = bytes(i);
      if (chunk.length < 4) continue;
      if (tablesBody) {
        const merged = new Uint8Array(chunk.length + tablesBody.length);
        merged.set(chunk.subarray(0, 2), 0); // SOI
        merged.set(tablesBody, 2);
        merged.set(chunk.subarray(2), 2 + tablesBody.length);
        chunk = merged;
      }
      let bmp;
      try {
        bmp = await createImageBitmap(new Blob([chunk], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      } catch {
        throw fail('A JPEG-compressed part of this TIFF file could not be decoded');
      }
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
      const [x0, y0] = pos(i);
      const w = Math.min(bmp.width, width - x0), h = Math.min(bmp.height, height - y0);
      for (let y = 0; y < h; y++) {
        rgba.set(data.subarray((y * bmp.width) * 4, (y * bmp.width + w) * 4), ((y0 + y) * width + x0) * 4);
      }
      bmp.close();
    }
  }

  // Orientation (tag 274) and the ICC profile (tag 34675, applied by the worker).
  function finish(rgba, width, height, t, photometric = 2) {
    const orientation = t.get(274)?.[0] || 1;
    const icc = photometric === 2 || photometric === 6 || photometric === 3 ? t.get(34675) || null : null;
    if (orientation === 1 || orientation > 8) return { width, height, data: rgba, icc };
    const swap = orientation >= 5;
    const W = swap ? height : width, H = swap ? width : height;
    const out = new Uint8ClampedArray(W * H * 4);
    const src32 = new Uint32Array(rgba.buffer), dst32 = new Uint32Array(out.buffer);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let X, Y;
        switch (orientation) {
          case 2: X = width - 1 - x; Y = y; break;
          case 3: X = width - 1 - x; Y = height - 1 - y; break;
          case 4: X = x; Y = height - 1 - y; break;
          case 5: X = y; Y = x; break;
          case 6: X = height - 1 - y; Y = x; break;
          case 7: X = height - 1 - y; Y = width - 1 - x; break;
          case 8: X = y; Y = width - 1 - x; break;
        }
        dst32[Y * W + X] = src32[y * width + x];
      }
    }
    return { width: W, height: H, data: out, icc };
  }

  function pages(buffer) {
    return parse(buffer).pages.length;
  }

  globalThis.SaveformTiff = { pages, decode, _internal: { lzw, packBits, faxDecode } };
})();
