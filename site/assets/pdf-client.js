// PDF input for the converter pages: each page of a PDF becomes one row and is rendered to pixels
// by PDF.js (Mozilla, Apache-2.0, vendored unmodified in vendor/pdfjs/, see its README). The
// library is only downloaded when the first PDF is added; parsing runs in its own worker.
const BASE = new URL('../vendor/pdfjs/', import.meta.url);
const MAX_SIDE = 16384; // canvas limit in Chromium/Firefox
const MAX_PIXELS = 50e6; // about 200 MB of RGBA; an A0 poster at 300 dpi would be 140 MP

let libPromise = null;
function lib() {
  libPromise ??= import(new URL('pdf.min.js', BASE).href).then((m) => {
    m.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', BASE).href;
    return m;
  }).catch((err) => {
    libPromise = null;
    throw pdfError('The PDF reader could not be loaded. Check your connection and add the file again.', err);
  });
  return libPromise;
}

// The documents used most recently, keyed by File, so a 40-page PDF is parsed once, not 40 times.
const open = new Map();
const KEEP_OPEN = 3;

function load(file) {
  let doc = open.get(file);
  if (doc) {
    open.delete(file);
    open.set(file, doc); // most recently used last
    return doc;
  }
  doc = (async () => {
    const pdfjs = await lib();
    const data = new Uint8Array(await file.arrayBuffer());
    try {
      return await pdfjs.getDocument({
        data,
        cMapUrl: new URL('cmaps/', BASE).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('standard_fonts/', BASE).href,
        wasmUrl: new URL('wasm/', BASE).href,
        iccUrl: new URL('iccs/', BASE).href,
        isEvalSupported: false, // the site's CSP forbids eval
        useSystemFonts: false, // draw the 14 standard fonts from standard_fonts/, the same on every computer
        enableXfa: false,
        verbosity: 0,
      }).promise;
    } catch (err) {
      if (err?.name === 'PasswordException') throw pdfError('This PDF is protected by a password, so its pages cannot be read here. Open it in a PDF reader, then save or print a copy without the password and add that instead.', err, 'password');
      if (err?.name === 'InvalidPDFException') throw pdfError('This file is not a valid PDF, or it is damaged.', err);
      throw pdfError(`This PDF could not be read (${err?.message || err}).`, err);
    }
  })();
  doc.catch(() => open.delete(file));
  open.set(file, doc);
  while (open.size > KEEP_OPEN) {
    const [oldest, oldDoc] = open.entries().next().value;
    open.delete(oldest);
    oldDoc.then((d) => d.destroy()).catch(() => {});
  }
  return doc;
}

function pdfError(message, cause, reason) {
  return Object.assign(new Error(message), { code: 'decode-failed', kind: 'pdf', reason, cause });
}

/** Number of pages in a PDF File. */
export async function pdfPageCount(file) {
  return (await load(file)).numPages;
}

/** Forget a PDF that is no longer listed (frees the parsed document). */
export function closePdf(file) {
  const doc = open.get(file);
  if (!doc) return;
  open.delete(file);
  doc.then((d) => d.destroy()).catch(() => {});
}

/** Size in pixels of a page rendered at `dpi`, capped to what a canvas can hold. */
export function pageSize(widthPt, heightPt, dpi) {
  let scale = dpi / 72;
  scale = Math.min(scale, MAX_SIDE / widthPt, MAX_SIDE / heightPt, Math.sqrt(MAX_PIXELS / (widthPt * heightPt)));
  return { scale, width: Math.max(1, Math.round(widthPt * scale)), height: Math.max(1, Math.round(heightPt * scale)) };
}

/**
 * Render page `page` (0-based) of a PDF File at `dpi` on a white background.
 * Returns { source: ImageBitmap, width, height, kind: 'pdf', close } like decode() in lib/convert.js.
 */
export async function decodePdf(file, page = 0, { dpi = 150 } = {}) {
  const doc = await load(file);
  if (page >= doc.numPages) throw pdfError(`This PDF has only ${doc.numPages} page${doc.numPages === 1 ? '' : 's'}.`);
  const p = await doc.getPage(page + 1);
  try {
    const base = p.getViewport({ scale: 1 }); // in points, with the page's own rotation applied
    const { scale, width, height } = pageSize(base.width, base.height, dpi);
    const viewport = p.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    // Passing canvasContext keeps rendering on this thread (no separate renderer worker needed).
    await p.render({ canvasContext: ctx, viewport, background: '#ffffff', annotationMode: 1 /* ENABLE: form field appearances */ }).promise;
    const bmp = await createImageBitmap(canvas);
    canvas.width = canvas.height = 0; // release the canvas memory now, not at the next GC
    return { source: bmp, width, height, kind: 'pdf', close: () => bmp.close() };
  } catch (err) {
    if (err?.code === 'decode-failed') throw err;
    throw pdfError(`Page ${page + 1} of this PDF could not be drawn (${err?.message || err}).`, err);
  } finally {
    p.cleanup();
  }
}
