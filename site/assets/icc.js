// Colour conversion for decoded HEIC photos: wide-gamut RGB (Display P3 from iPhones, BT.2020,
// Adobe RGB, ...) to sRGB, so converted files look the same in every program. Output files carry
// no colour profile, and programs show untagged images as sRGB, so P3 pixels written as-is would
// look washed out.
//
// Supports ICC v2/v4 matrix/TRC profiles (rXYZ/gXYZ/bXYZ + rTRC/gTRC/bTRC with `curv` or `para`)
// and HEIF `nclx` colour tags (primaries only; the tone curve is kept, so only the gamut changes).
// Anything else (LUT-based ICC, PQ/HLG HDR) is left unconverted rather than guessed.
//
// Classic script: loaded with importScripts() in heic-worker.js, and with import in Node tests.
// Exposes globalThis.SaveformColor = { parseIcc, nclxProfile, isSrgb, toSrgb }.
(() => {
  // ---- 3×3 matrix helpers (row-major arrays of 9 numbers) ----
  const mul = (a, b) => {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
    return r;
  };
  const inv = (m) => {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
  };
  const apply = (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

  // RGB → XYZ for given chromaticities (x, y of R, G, B and white).
  function primariesMatrix([rx, ry, gx, gy, bx, by, wx, wy]) {
    const col = (x, y) => [x / y, 1, (1 - x - y) / y];
    const [R, G, B] = [col(rx, ry), col(gx, gy), col(bx, by)];
    const P = [R[0], G[0], B[0], R[1], G[1], B[1], R[2], G[2], B[2]];
    const S = apply(inv(P), col(wx, wy));
    return [P[0] * S[0], P[1] * S[1], P[2] * S[2], P[3] * S[0], P[4] * S[1], P[5] * S[2], P[6] * S[0], P[7] * S[1], P[8] * S[2]];
  }

  const D65 = [0.3127, 0.329];
  const SRGB_PRIMARIES = [0.64, 0.33, 0.3, 0.6, 0.15, 0.06, ...D65];
  const SRGB_D65 = primariesMatrix(SRGB_PRIMARIES);
  // sRGB colorants adapted to D50 (Bradford), as stored in sRGB ICC profiles.
  const SRGB_D50 = [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733];

  const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const linearToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

  // ---- ICC parsing ----
  function parseIcc(bytes) {
    try {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const str = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
      if (bytes.length < 132 || str(36) !== 'acsp' || str(16) !== 'RGB ' || str(20) !== 'XYZ ') return null;
      const tags = {};
      const count = dv.getUint32(128);
      for (let k = 0; k < count && 132 + k * 12 + 12 <= bytes.length; k++) {
        const o = 132 + k * 12;
        tags[str(o)] = { off: dv.getUint32(o + 4), size: dv.getUint32(o + 8) };
      }
      const s15 = (o) => dv.getInt32(o) / 65536;
      const xyz = (sig) => {
        const t = tags[sig];
        if (!t || str(t.off) !== 'XYZ ') return null;
        return [s15(t.off + 8), s15(t.off + 12), s15(t.off + 16)];
      };
      const trc = (sig) => {
        const t = tags[sig];
        if (!t) return null;
        const o = t.off;
        if (str(o) === 'curv') {
          const n = dv.getUint32(o + 8);
          if (n === 0) return (x) => x;
          if (n === 1) { const g = dv.getUint16(o + 12) / 256; return (x) => x ** g; }
          const table = new Float64Array(n);
          for (let k = 0; k < n; k++) table[k] = dv.getUint16(o + 12 + k * 2) / 65535;
          return (x) => {
            const p = x * (n - 1), k = Math.min(n - 2, Math.floor(p));
            return table[k] + (table[k + 1] - table[k]) * (p - k);
          };
        }
        if (str(o) === 'para') {
          const type = dv.getUint16(o + 8);
          const nParams = [1, 3, 4, 5, 7][type];
          if (nParams === undefined) return null;
          const [g, a, b, c, d, e, f] = Array.from({ length: nParams }, (_, k) => s15(o + 12 + k * 4));
          switch (type) {
            case 0: return (x) => x ** g;
            case 1: return (x) => (x >= -b / a ? (a * x + b) ** g : 0);
            case 2: return (x) => (x >= -b / a ? (a * x + b) ** g + c : c);
            case 3: return (x) => (x >= d ? (a * x + b) ** g : c * x);
            default: return (x) => (x >= d ? (a * x + b) ** g + e : c * x + f);
          }
        }
        return null;
      };
      const r = xyz('rXYZ'), g = xyz('gXYZ'), b = xyz('bXYZ');
      const curves = [trc('rTRC'), trc('gTRC'), trc('bTRC')];
      if (!r || !g || !b || curves.some((c) => !c)) return null;
      return {
        toXyz: [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]],
        white: 'D50',
        curves,
      };
    } catch {
      return null;
    }
  }

  // HEIF/ISO 23091-2 colour primaries codes we convert from.
  const NCLX_PRIMARIES = {
    1: SRGB_PRIMARIES, // BT.709 = sRGB
    9: [0.708, 0.292, 0.17, 0.797, 0.131, 0.046, ...D65], // BT.2020
    11: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06, 0.314, 0.351], // DCI-P3 (DCI white)
    12: [0.68, 0.32, 0.265, 0.69, 0.15, 0.06, ...D65], // Display P3
  };
  /** Profile for an nclx tag, or null when it should be left alone (unknown primaries, PQ/HLG). */
  function nclxProfile(primaries, transfer) {
    const p = NCLX_PRIMARIES[primaries];
    if (!p || transfer === 16 || transfer === 18) return null;
    return { toXyz: primariesMatrix(p), white: 'D65', curves: [srgbToLinear, srgbToLinear, srgbToLinear], keepTone: true };
  }

  /** True when converting would change nothing visible (the profile is sRGB already). */
  function isSrgb(profile) {
    const ref = profile.white === 'D50' ? SRGB_D50 : SRGB_D65;
    if (profile.toXyz.some((v, k) => Math.abs(v - ref[k]) > 0.003)) return false;
    if (profile.keepTone) return true;
    for (const curve of profile.curves) {
      for (let v = 0; v <= 255; v += 5) {
        if (Math.abs(curve(v / 255) - srgbToLinear(v / 255)) > 0.002) return false;
      }
    }
    return true;
  }

  /**
   * Convert interleaved RGBA pixels (Uint8ClampedArray or Uint8Array) from `profile` to sRGB in
   * place. Out-of-gamut colours are clipped per channel. Alpha is untouched.
   */
  function toSrgb(rgba, profile) {
    const toLinearSrgb = mul(inv(profile.white === 'D50' ? SRGB_D50 : SRGB_D65), profile.toXyz);
    const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = toLinearSrgb;
    const lin = profile.curves.map((curve) => {
      const lut = new Float32Array(256);
      for (let v = 0; v < 256; v++) lut[v] = curve(v / 255);
      return lut;
    });
    const [lr, lg, lb] = lin;
    const STEPS = 16383;
    const enc = new Uint8Array(STEPS + 1);
    for (let k = 0; k <= STEPS; k++) enc[k] = Math.round(linearToSrgb(k / STEPS) * 255);
    const out = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : enc[(v * STEPS + 0.5) | 0]);
    for (let p = 0; p < rgba.length; p += 4) {
      const r = lr[rgba[p]], g = lg[rgba[p + 1]], b = lb[rgba[p + 2]];
      rgba[p] = out(m0 * r + m1 * g + m2 * b);
      rgba[p + 1] = out(m3 * r + m4 * g + m5 * b);
      rgba[p + 2] = out(m6 * r + m7 * g + m8 * b);
    }
    return rgba;
  }

  globalThis.SaveformColor = { parseIcc, nclxProfile, isSrgb, toSrgb };
})();
