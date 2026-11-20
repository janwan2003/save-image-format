// Test helpers: check a PDF's structure byte by byte, and (when poppler's pdftoppm is
// installed) render it with an independent PDF engine to read back real pixels.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { inflateSync } from 'node:zlib';

/** Validates header, xref offsets and trailer; returns the pages in order. */
export function inspectPdf(buf) {
  const text = buf.toString('latin1');
  assert.ok(text.startsWith('%PDF-1.'), 'PDF header');
  assert.ok(text.trimEnd().endsWith('%%EOF'), 'PDF ends with %%EOF');
  const startxref = Number(/startxref\n(\d+)\n%%EOF\s*$/.exec(text)?.[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref', 'startxref points at the xref table');
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(text.slice(startxref));
  assert.equal(Number(first), 0);
  const objects = {};
  for (let n = 1; n < Number(count); n++) {
    const entryAt = startxref + `xref\n0 ${count}\n`.length + n * 20;
    const off = Number(text.slice(entryAt, entryAt + 10));
    assert.ok(text.startsWith(`${n} 0 obj\n`, off), `xref entry ${n} points at object ${n}`);
    objects[n] = off;
  }
  const objText = (n) => text.slice(objects[n], text.indexOf('\nendobj', objects[n]));
  const root = Number(/\/Root (\d+) 0 R/.exec(text.slice(startxref))[1]);
  const pagesRef = Number(/\/Pages (\d+) 0 R/.exec(objText(root))[1]);
  const kids = [...objText(pagesRef).matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  return kids.map((k) => {
    const pageObj = objText(k);
    const mediaBox = /\/MediaBox \[([^\]]+)\]/.exec(pageObj)[1].split(' ').map(Number);
    const im = objText(Number(/\/Im0 (\d+) 0 R/.exec(pageObj)[1]));
    const dict = im.slice(0, im.indexOf('stream\n'));
    const len = Number(/\/Length (\d+)/.exec(dict)[1]);
    const start = objects[Number(/\/Im0 (\d+) 0 R/.exec(pageObj)[1])] + im.indexOf('stream\n') + 7;
    const data = buf.subarray(start, start + len);
    assert.equal(buf.toString('latin1', start + len, start + len + 10), '\nendstream', 'image /Length matches its stream');
    return {
      mediaBox,
      width: Number(/\/Width (\d+)/.exec(dict)[1]),
      height: Number(/\/Height (\d+)/.exec(dict)[1]),
      filter: /\/Filter \/(\w+)/.exec(dict)[1],
      colorSpace: /\/ColorSpace \/(\w+)/.exec(dict)[1],
      bpc: Number(/\/BitsPerComponent (\d+)/.exec(dict)[1]),
      data,
      pixels: () => inflateSync(data), // FlateDecode pages only
    };
  });
}

let hasPoppler;
export function popplerAvailable() {
  if (hasPoppler === undefined) {
    try { execFileSync('pdftoppm', ['-v'], { stdio: 'pipe' }); hasPoppler = true; } catch { hasPoppler = false; }
  }
  return hasPoppler;
}

/** Renders page 1 at 96 dpi with poppler; returns { width, height, rgb(x, y) }. */
export function renderFirstPage(buf) {
  const ppm = execFileSync('pdftoppm', ['-r', '96', '-f', '1', '-l', '1', '-'], { input: buf, maxBuffer: 64 * 1024 * 1024 });
  const header = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.toString('latin1', 0, 40));
  const width = Number(header[1]), height = Number(header[2]);
  const off = header[0].length;
  return { width, height, rgb: (x, y) => [...ppm.subarray(off + (y * width + x) * 3, off + (y * width + x) * 3 + 3)] };
}

/** Parses an ICO directory: [{ size, bytes (embedded image) }]. */
export function inspectIco(buf) {
  assert.equal(buf.readUInt16LE(0), 0);
  assert.equal(buf.readUInt16LE(2), 1, 'ICO type 1');
  const n = buf.readUInt16LE(4);
  return Array.from({ length: n }, (_, i) => {
    const e = 6 + i * 16;
    const size = buf[e] || 256;
    const len = buf.readUInt32LE(e + 8), off = buf.readUInt32LE(e + 12);
    return { size, height: buf[e + 1] || 256, bytes: buf.subarray(off, off + len) };
  });
}
