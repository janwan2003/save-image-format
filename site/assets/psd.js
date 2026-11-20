// Saveform Photoshop decoder (own implementation, no dependencies): reads the merged (composite)
// image that Photoshop stores after the layers in PSD and PSB files, inside psd-worker.js.
// Classic script: exposes globalThis.SaveformPsd = { decode }.
//
// Covered: PSD (version 1) and PSB (version 2, large document); raw, PackBits RLE and ZIP (with or
// without prediction) image data; 1-bit Bitmap, 8/16-bit and 32-bit float samples (16-bit keeps the
// high byte, 32-bit is linear light and is encoded with the sRGB curve); Bitmap, Grayscale,
// Duotone and Multichannel (shown as grey), Indexed (with its transparent index), RGB, CMYK and
// Lab colour modes; merged transparency; the ICC profile (image resource 1039).
// Files saved without "Maximize Compatibility" have no real composite (image resource 1057): those
// are rebuilt from their visible layers (normal blending and opacity only, see compositeLayers) and
// flagged `approximate: true`; when the layers cannot be read either, the error says how to re-save.
(function () {
  'use strict';

  const MAX_PIXELS = 268e6; // same limit as tiff.js
  const MODES = { 0: 'Bitmap', 1: 'Grayscale', 2: 'Indexed', 3: 'RGB', 4: 'CMYK', 7: 'Multichannel', 8: 'Duotone', 9: 'Lab' };
  const COLOUR_CHANNELS = { 0: 1, 1: 1, 2: 1, 3: 3, 4: 4, 7: 1, 8: 1, 9: 3 };

  function fail(message) {
    const e = new Error(message);
    e.code = 'decode-failed'; e.kind = 'psd';
    return e;
  }

  // ---- structure -------------------------------------------------------------------------
  function parse(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    if (bytes.length >= 4 && !(bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53)) {
      throw fail('This is not a Photoshop (PSD) file');
    }
    if (bytes.length < 26) throw fail('This PSD file is truncated');
    const version = dv.getUint16(4);
    if (version !== 1 && version !== 2) throw fail(`This Photoshop file has an unknown version (${version})`);
    const psb = version === 2;
    const label = psb ? 'PSB' : 'PSD';
    const header = {
      psb, label,
      channels: dv.getUint16(12), height: dv.getUint32(14), width: dv.getUint32(18),
      depth: dv.getUint16(22), mode: dv.getUint16(24),
    };
    const need = (end) => { if (end > bytes.length) throw fail(`This ${label} file is truncated`); };
    const len = (o, eight) => (eight ? Number(dv.getBigUint64(o)) : dv.getUint32(o));
    let p = 26;
    const section = (eight) => {
      need(p + (eight ? 8 : 4));
      const n = len(p, eight), start = p + (eight ? 8 : 4);
      need(start + n);
      p = start + n;
      return [start, n];
    };
    const [cmStart, cmLen] = section(false);
    const [resStart, resLen] = section(false);
    const [lmStart, lmLen] = section(psb);
    need(p + 2);
    return {
      bytes, dv, header, need, len,
      colourData: bytes.subarray(cmStart, cmStart + cmLen),
      resources: readResources(bytes, dv, resStart, resStart + resLen),
      layerSection: [lmStart, lmLen],
      imageData: p,
    };
  }

  function readResources(bytes, dv, start, end) {
    const out = new Map();
    let q = start;
    while (q + 12 <= end) {
      const id = dv.getUint16(q + 4);
      q += 6 + ((bytes[q + 6] + 2) & ~1); // Pascal name, padded to an even length
      if (q + 4 > end) break;
      const size = dv.getUint32(q);
      q += 4;
      if (q + size > end) break;
      if (!out.has(id)) out.set(id, bytes.subarray(q, q + size));
      q += (size + 1) & ~1;
    }
    return out;
  }

  // The layer info block: in 8-bit files it opens the layer section; 16- and 32-bit files from
  // Photoshop leave it empty and store it in an "Lr16"/"Lr32" tagged block further on.
  // Returns { at, end } of the block (`at` is its layer count; -1 when the file has no layers) and
  // whether an "Mtrn"/"Mt16"/"Mt32" block says the merged image has transparency.
  const LONG_KEYS = new Set(['LMsk', 'Lr16', 'Lr32', 'Layr', 'Mt16', 'Mt32', 'Mtrn', 'Alph', 'FMsk', 'lnk2', 'FEid', 'FXid', 'PxSD']);
  function findLayerInfo({ bytes, dv, header, len, layerSection: [start, n] }) {
    const found = { at: -1, end: -1, mergedAlpha: false };
    if (n < 4) return found;
    const L = header.psb ? 8 : 4;
    const end = start + n;
    const infoLen = len(start, header.psb);
    if (infoLen >= 2) { found.at = start + L; found.end = Math.min(end, start + L + infoLen); }
    let q = start + L + infoLen;
    if (q + 4 > end) return found;
    q += 4 + dv.getUint32(q); // global layer mask info
    const str = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    while (q + 12 <= end) {
      let sig = str(q);
      let skip = 0;
      while (sig !== '8BIM' && sig !== '8B64' && skip < 3 && q + 13 <= end) { q++; skip++; sig = str(q); }
      if (sig !== '8BIM' && sig !== '8B64') break;
      const key = str(q + 4);
      const eight = header.psb && LONG_KEYS.has(key);
      const size = len(q + 8, eight);
      const data = q + 8 + (eight ? 8 : 4);
      if ((key === 'Lr16' || key === 'Lr32' || key === 'Layr') && size >= 2 && found.at < 0) { found.at = data; found.end = Math.min(end, data + size); }
      if (key === 'Mtrn' || key === 'Mt16' || key === 'Mt32') found.mergedAlpha = true;
      q = data + size + (size & 1);
    }
    return found;
  }

  // ---- decompression ---------------------------------------------------------------------
  function packBits(src, out, o, expected) {
    const stop = o + expected;
    let i = 0;
    while (i < src.length && o < stop) {
      const n = (src[i++] << 24) >> 24;
      if (n >= 0) {
        const count = Math.min(n + 1, stop - o, src.length - i);
        out.set(src.subarray(i, i + count), o); i += n + 1; o += count;
      } else if (n !== -128) {
        const count = Math.min(1 - n, stop - o);
        out.fill(src[i++], o, o + count); o += count;
      }
    }
  }

  async function inflate(src, label) {
    if (typeof DecompressionStream !== 'function') throw fail(`This ${label} file uses ZIP compression, which this browser cannot decompress`);
    const stream = new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); total += value.length;
      }
    } catch {
      if (!total) throw fail(`The compressed data in this ${label} file is damaged`);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // ZIP with prediction: each row is delta-coded. 16-bit rows as big-endian words; 32-bit rows
  // are first split into four byte planes (high bytes, then the next ...) and delta-coded as bytes.
  function unpredict(data, rowBytes, rows, depth, width) {
    for (let r = 0; r < rows; r++) {
      const o = r * rowBytes;
      if (depth === 16) {
        for (let i = 2; i + 1 < rowBytes; i += 2) {
          const v = (((data[o + i] << 8) | data[o + i + 1]) + ((data[o + i - 2] << 8) | data[o + i - 1])) & 0xffff;
          data[o + i] = v >> 8; data[o + i + 1] = v & 255;
        }
      } else {
        for (let i = 1; i < rowBytes; i++) data[o + i] = (data[o + i] + data[o + i - 1]) & 255;
        if (depth === 32) {
          const row = data.slice(o, o + rowBytes);
          for (let x = 0; x < width; x++) {
            for (let k = 0; k < 4; k++) data[o + x * 4 + k] = row[k * width + x];
          }
        }
      }
    }
  }

  // Reads `count` planar channels of `rows` × `rowBytes` stored with the given compression at
  // `at`; channel offsets of RLE data come from the row byte count table that covers all `total`
  // channels. Returns one Uint8Array per channel.
  async function readPlanes(ctx, { at, end, compression, total, count, rowBytes, rows, depth, width, what }) {
    const { bytes, dv, header: { psb, label } } = ctx;
    const planeBytes = rowBytes * rows;
    const planes = [];
    if (compression === 0) {
      if (at + count * planeBytes > end) throw fail(`This ${label} file is truncated`);
      for (let c = 0; c < count; c++) planes.push(bytes.subarray(at + c * planeBytes, at + (c + 1) * planeBytes));
    } else if (compression === 1) {
      const w = psb ? 4 : 2;
      const table = at;
      let q = table + total * rows * w;
      if (q > end) throw fail(`This ${label} file is truncated`);
      for (let c = 0; c < count; c++) {
        const plane = new Uint8Array(planeBytes);
        for (let r = 0; r < rows; r++) {
          const e = table + (c * rows + r) * w;
          const n = psb ? dv.getUint32(e) : dv.getUint16(e);
          if (q + n > end) throw fail(`This ${label} file is truncated`);
          packBits(bytes.subarray(q, q + n), plane, r * rowBytes, rowBytes);
          q += n;
        }
        planes.push(plane);
      }
    } else if (compression === 2 || compression === 3) {
      const data = await inflate(bytes.subarray(at, end), label);
      if (data.length < count * planeBytes) throw fail(`The ${what} in this ${label} file is truncated or damaged`);
      for (let c = 0; c < count; c++) {
        const plane = data.subarray(c * planeBytes, (c + 1) * planeBytes);
        if (compression === 3) unpredict(plane, rowBytes, rows, depth, width);
        planes.push(plane);
      }
    } else {
      throw fail(`This ${label} file uses an unsupported compression method (${compression})`);
    }
    return planes;
  }

  // ---- samples → 8 bits ------------------------------------------------------------------
  const linearToSrgb8 = (() => {
    let lut = null;
    return () => {
      if (lut) return lut;
      lut = new Uint8Array(65536);
      for (let i = 0; i < 65536; i++) {
        const v = i / 65535;
        lut[i] = Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
      }
      return lut;
    };
  })();

  // One plane of 8/16/32-bit big-endian samples → 8-bit values (32-bit: linear light, so the
  // colour channels get the sRGB curve; alpha does not).
  function to8(plane, n, depth, linear) {
    if (depth === 8) return plane;
    const out = new Uint8Array(n);
    if (depth === 16) {
      for (let i = 0; i < n; i++) out[i] = plane[i * 2];
    } else {
      const dv = new DataView(plane.buffer, plane.byteOffset, plane.byteLength);
      const lut = linearToSrgb8();
      for (let i = 0; i < n; i++) {
        const v = dv.getFloat32(i * 4);
        const c = v > 0 ? (v < 1 ? v : 1) : 0; // NaN → 0
        out[i] = linear ? lut[Math.round(c * 65535)] : Math.round(c * 255);
      }
    }
    return out;
  }

  // CIE Lab (D50, as Photoshop uses) → sRGB, via the Bradford-adapted sRGB matrix of ICC profiles.
  const XYZ50_TO_SRGB = (() => {
    const [a, b, c, d, e, f, g, h, i] = [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  })();
  function labToRgb(L8, a8, b8, out, d) {
    const L = (L8 * 100) / 255, A = a8 - 128, B = b8 - 128;
    const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
    const inv = (t) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));
    const X = 0.9642 * inv(fx), Y = inv(fy), Z = 0.8249 * inv(fz);
    const m = XYZ50_TO_SRGB;
    const lut = linearToSrgb8();
    const enc = (v) => lut[Math.round((v > 0 ? (v < 1 ? v : 1) : 0) * 65535)];
    out[d] = enc(m[0] * X + m[1] * Y + m[2] * Z);
    out[d + 1] = enc(m[3] * X + m[4] * Y + m[5] * Z);
    out[d + 2] = enc(m[6] * X + m[7] * Y + m[8] * Z);
  }

  // Colour planes (already 8-bit) → RGBA. `alpha` is an 8-bit plane or null.
  function toRgba(ctx, planes, alpha, n, rgba, matted) {
    const { header: { mode, width }, colourData, resources } = ctx;
    const [p0, p1, p2, p3] = planes;
    if (mode === 0) {
      // Bitmap: 1 bit per pixel, rows padded to bytes, 1 = black.
      const rowBytes = (width + 7) >> 3;
      for (let i = 0, d = 0; i < n; i++, d += 4) {
        const x = i % width, y = (i - x) / width;
        const v = (p0[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
        rgba[d] = rgba[d + 1] = rgba[d + 2] = v; rgba[d + 3] = 255;
      }
      return;
    }
    if (mode === 2) {
      const pal = colourData;
      const t = resources.get(1047);
      const transparent = t && t.length >= 2 ? (t[0] << 8) | t[1] : -1;
      for (let i = 0, d = 0; i < n; i++, d += 4) {
        const k = p0[i];
        if (pal.length >= 768) { rgba[d] = pal[k]; rgba[d + 1] = pal[256 + k]; rgba[d + 2] = pal[512 + k]; } else rgba[d] = rgba[d + 1] = rgba[d + 2] = k;
        rgba[d + 3] = k === transparent ? 0 : 255;
      }
      return;
    }
    for (let i = 0, d = 0; i < n; i++, d += 4) {
      switch (mode) {
        case 3: rgba[d] = p0[i]; rgba[d + 1] = p1[i]; rgba[d + 2] = p2[i]; break;
        case 4: {
          // Photoshop stores CMYK inverted (0 = full ink): the same naive conversion as tiff.js.
          // A transparent composite is matted towards no ink (255); undo that per ink first.
          let c = p0[i], m = p1[i], y = p2[i], k = p3[i];
          const a = alpha ? alpha[i] : 255;
          if (matted && a > 0 && a < 255) {
            const un = (v) => Math.max(0, Math.min(255, ((v - (255 - a)) * 255) / a));
            c = un(c); m = un(m); y = un(y); k = un(k);
          }
          rgba[d] = (c * k) / 255; rgba[d + 1] = (m * k) / 255; rgba[d + 2] = (y * k) / 255; rgba[d + 3] = a;
          continue;
        }
        case 9: labToRgb(p0[i], p1[i], p2[i], rgba, d); break;
        default: rgba[d] = rgba[d + 1] = rgba[d + 2] = p0[i]; // grey, duotone, multichannel
      }
      const a = alpha ? alpha[i] : 255;
      rgba[d + 3] = a;
      // Photoshop mattes a transparent composite against white; undo that (as ImageMagick does).
      if (matted && a > 0 && a < 255) {
        for (let k = 0; k < 3; k++) rgba[d + k] = ((rgba[d + k] - (255 - a)) * 255) / a;
      }
    }
  }

  // ---- decoding ----------------------------------------------------------------------------
  async function decode(buffer) {
    const ctx = parse(buffer);
    const { bytes, dv, header, resources } = ctx;
    const { width, height, depth, mode, channels, label } = header;
    if (!width || !height) throw fail(`This ${label} file has no image size`);
    if (width * height > MAX_PIXELS) throw fail(`This ${label} image is ${width} × ${height} pixels, too large to convert in a browser`);
    if (!(mode in MODES)) throw fail(`This ${label} file uses a colour mode this converter does not support (${mode})`);
    if (![1, 8, 16, 32].includes(depth) || (depth === 1) !== (mode === 0) || (mode === 2 && depth !== 8)) {
      throw fail(`${depth}-bit ${MODES[mode]} ${label} files are not supported`);
    }
    const colourCount = COLOUR_CHANNELS[mode];
    if (channels < colourCount) throw fail(`This ${MODES[mode]} ${label} file has too few channels`);

    // Version info (resource 1057): no real merged image when saved without Maximize Compatibility.
    const info = resources.get(1057);
    const hasMerged = !(info && info.length >= 5 && info[4] === 0);
    const layerInfo = findLayerInfo(ctx);
    const layerCount = layerInfo.at >= 0 ? dv.getInt16(layerInfo.at) : 0;
    if (!hasMerged) {
      const composite = await compositeLayers(ctx, layerInfo).catch(() => null);
      if (composite) return { width, height, data: composite, icc: iccFor(ctx), approximate: true };
      throw fail(`This ${label} file was saved without “Maximize Compatibility”, so it has no flattened image to convert. Open it in Photoshop and save it again with Maximize PSD and PSB File Compatibility turned on (Preferences › File Handling), or export a flat copy`);
    }

    // The first extra channel is the merged transparency only when the layer count is negative or
    // an Mtrn/Mt16/Mt32 block is present (Adobe's file format spec; 32-bit files use the latter);
    // otherwise extra channels are saved selections or spot colours.
    const hasAlpha = (layerCount < 0 || layerInfo.mergedAlpha) && channels > colourCount && mode !== 0 && mode !== 2;
    const count = colourCount + (hasAlpha ? 1 : 0);
    const rowBytes = depth === 1 ? (width + 7) >> 3 : width * (depth / 8);
    const at = ctx.imageData;
    const compression = dv.getUint16(at);
    const planes = await readPlanes(ctx, {
      at: at + 2, end: bytes.length, compression, total: channels, count, rowBytes, rows: height, depth, width, what: 'image data',
    });
    const n = width * height;
    const p8 = depth === 1 ? planes : planes.map((p, c) => to8(p, n, depth, c < colourCount));
    const rgba = new Uint8ClampedArray(n * 4);
    toRgba(ctx, p8.slice(0, colourCount), hasAlpha ? p8[colourCount] : null, n, rgba, hasAlpha);
    return { width, height, data: rgba, icc: iccFor(ctx) };
  }

  // The embedded profile is handed over for RGB and indexed images (as tiff.js does). 32-bit
  // images are already encoded with the sRGB curve here, so their (linear) profile is dropped.
  function iccFor({ header: { mode, depth }, resources }) {
    if ((mode !== 3 && mode !== 2) || depth === 32) return null;
    return resources.get(1039) || null;
  }

  // ---- layers (only for files without a real composite) --------------------------------------
  // A plain composite: visible pixel layers inside visible groups, normal blending, layer opacity
  // and transparency. No masks, clipping, blend modes, effects, adjustment or text re-rendering.
  async function compositeLayers(ctx, layerInfo) {
    const { bytes, dv, header: { psb, width, height, depth, mode }, len } = ctx;
    if (layerInfo.at < 0) return null;
    if (mode === 0 || mode === 2) return null;
    const colourCount = COLOUR_CHANNELS[mode];
    const count = Math.abs(dv.getInt16(layerInfo.at));
    const end = layerInfo.end;
    const str = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    let q = layerInfo.at + 2;
    const layers = [];
    for (let i = 0; i < count; i++) {
      if (q + 18 > end) return null;
      const top = dv.getInt32(q), left = dv.getInt32(q + 4), bottom = dv.getInt32(q + 8), right = dv.getInt32(q + 12);
      const nch = dv.getUint16(q + 16);
      q += 18;
      const chans = [];
      for (let c = 0; c < nch; c++) {
        chans.push({ id: dv.getInt16(q), length: len(q + 2, psb) });
        q += psb ? 10 : 6;
      }
      if (q + 16 > end || str(q) !== '8BIM') return null;
      const blend = str(q + 4), opacity = bytes[q + 8], flags = bytes[q + 10];
      const extraLen = dv.getUint32(q + 12);
      const extraStart = q + 16;
      q = extraStart + extraLen;
      // Section dividers (group start/end) are tagged "lsct" in the extra data.
      let divider = 0;
      let e = extraStart;
      e += 4 + dv.getUint32(e); // layer mask data
      e += 4 + dv.getUint32(e); // blending ranges
      e += (bytes[e] + 4) & ~3; // name, padded to 4
      while (e + 12 <= q) {
        const sig = str(e);
        if (sig !== '8BIM' && sig !== '8B64') break;
        const key = str(e + 4);
        const eight = psb && LONG_KEYS.has(key);
        const size = len(e + 8, eight);
        const data = e + 8 + (eight ? 8 : 4);
        if ((key === 'lsct' || key === 'lsdk') && size >= 4) divider = dv.getUint32(data);
        e = data + size;
      }
      layers.push({ top, left, bottom, right, chans, blend, opacity, hidden: (flags & 2) !== 0, divider });
    }
    // Channel image data follows the records, layer by layer, channel by channel.
    const out = new Float32Array(width * height * 4); // premultiplied 8-bit colour, alpha 0–1
    for (const layer of layers) {
      for (const ch of layer.chans) {
        ch.at = q; q += ch.length;
        if (q > bytes.length) return null;
      }
    }
    // Records run top to bottom in reverse: the first record is the bottom layer. Groups are a
    // "bounding section divider" record (divider 3) below their members and an open/closed folder
    // record (divider 1/2) above them; a hidden folder hides everything inside.
    const hiddenStack = [];
    for (const layer of layers) {
      if (layer.divider === 3) { hiddenStack.push(null); continue; }
      if (layer.divider === 1 || layer.divider === 2) {
        // Close the group: its visibility applies to the layers already drawn inside it, so the
        // members were collected and are composited now.
        const members = hiddenStack.length ? popGroup(hiddenStack) : [];
        if (!layer.hidden) hiddenStack.push(...members);
        continue;
      }
      hiddenStack.push(layer);
    }
    const visible = hiddenStack.filter(Boolean);
    for (const layer of visible) {
      if (layer.hidden) continue;
      const w = layer.right - layer.left, h = layer.bottom - layer.top;
      if (w <= 0 || h <= 0) continue;
      const rowBytes = w * (depth / 8);
      const get = async (id) => {
        const ch = layer.chans.find((c) => c.id === id);
        if (!ch || ch.length < 2) return null;
        const comp = dv.getUint16(ch.at);
        const [plane] = await readPlanes(ctx, {
          at: ch.at + 2, end: ch.at + ch.length, compression: comp, total: 1, count: 1, rowBytes, rows: h, depth, width: w, what: 'layer data',
        });
        return to8(plane, w * h, depth, id >= 0);
      };
      const colour = [];
      for (let c = 0; c < colourCount; c++) {
        const plane = await get(c);
        if (!plane) return null;
        colour.push(plane);
      }
      const alpha = await get(-1);
      const rgba = new Uint8ClampedArray(w * h * 4);
      toRgba({ ...ctx, header: { ...ctx.header, width: w } }, colour, alpha, w * h, rgba, false);
      const opacity = layer.opacity / 255;
      for (let y = 0; y < h; y++) {
        const Y = layer.top + y;
        if (Y < 0 || Y >= height) continue;
        for (let x = 0; x < w; x++) {
          const X = layer.left + x;
          if (X < 0 || X >= width) continue;
          const s = (y * w + x) * 4, d = (Y * width + X) * 4;
          const a = (rgba[s + 3] / 255) * opacity;
          if (a <= 0) continue;
          for (let k = 0; k < 3; k++) out[d + k] = rgba[s + k] * a + out[d + k] * (1 - a);
          out[d + 3] = a + out[d + 3] * (1 - a);
        }
      }
    }
    const result = new Uint8ClampedArray(width * height * 4);
    let any = false;
    for (let i = 0; i < out.length; i += 4) {
      const a = out[i + 3];
      result[i + 3] = Math.round(a * 255);
      if (a > 0) { any = true; for (let k = 0; k < 3; k++) result[i + k] = Math.round(out[i + k] / a); }
    }
    // Nothing drawn (only fill, shape or text layers, which store no pixels): not worth showing.
    return any ? result : null;
  }
  // Group bookkeeping for compositeLayers: `null` marks where an open group started.
  function popGroup(stack) {
    const members = [];
    while (stack.length) {
      const top = stack.pop();
      if (top === null) break;
      members.unshift(top);
    }
    return members;
  }

  globalThis.SaveformPsd = { decode, _internal: { packBits, findLayerInfo, parse, compositeLayers } };
})();
