#!/usr/bin/env node
// Writes the PDF test fixtures in tests/fixtures/ (hand-written PDF syntax, no dependencies):
//   pages.pdf      2 pages: A4 with coloured quadrants and Helvetica text (a standard font that
//                  is not embedded, so PDF.js has to load it from vendor/pdfjs/standard_fonts),
//                  and US Letter with /Rotate 90 and a blue square in the unrotated bottom-left.
//   not-a-pdf.pdf  a PDF header followed by junk.
// The password-protected fixture (locked.pdf) is made from pages.pdf with MuPDF:
//   mutool clean -E aes-128 -U secret -O owner tests/fixtures/pages.pdf tests/fixtures/locked.pdf
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures');

function pdf(objects) {
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
const stream = (s) => `<< /Length ${Buffer.byteLength(s, 'latin1')} >>\nstream\n${s}\nendstream`;

// Page 1, A4 595 x 842 pt: red top-left, green bottom-right quadrant (PDF y grows upwards).
const page1 = [
  '1 0 0 rg 0 421 297.5 421 re f',
  '0 0.6 0 rg 297.5 0 297.5 421 re f',
  'BT /F1 48 Tf 0 0 0 rg 330 700 Td (Saveform) Tj ET',
].join('\n');
// Page 2, Letter 612 x 792 pt, shown rotated 90 degrees clockwise.
const page2 = '0 0 1 rg 0 0 200 200 re f';

await writeFile(join(OUT, 'pages.pdf'), pdf([
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>',
  stream(page1),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Rotate 90 /Contents 6 0 R /Resources << >> >>',
  stream(page2),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
]));
await writeFile(join(OUT, 'not-a-pdf.pdf'), Buffer.from('%PDF-1.7\nthis is not really a PDF document, just text\n', 'latin1'));
console.log('wrote pages.pdf, not-a-pdf.pdf');
