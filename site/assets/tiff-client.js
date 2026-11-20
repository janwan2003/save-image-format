// Fallback decoder for TIFF files on the converter pages (Chrome, Edge and Firefox cannot open
// TIFF; Safari can). The work happens in tiff-worker.js, loaded when the first TIFF is added.
let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./tiff-worker.js', import.meta.url));
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.error) job.reject(Object.assign(new Error(data.error), { code: 'decode-failed', kind: 'tiff' }));
    else job.resolve(data);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    for (const job of pending.values()) job.reject(Object.assign(new Error('The TIFF decoder could not be loaded'), { code: 'decode-failed', kind: 'tiff' }));
    pending.clear();
    worker = null;
  };
  return worker;
}

async function ask(blob, message) {
  const buffer = await blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, buffer, ...message }, [buffer]);
  });
}

/** Number of pages (images) in a TIFF file; thumbnails are not counted. */
export async function tiffPageCount(blob) {
  return (await ask(blob, { countPages: true })).pages;
}

/** Decode one page of a TIFF Blob into { source: ImageBitmap, width, height, kind, close }. */
export async function decodeTiff(blob, page = 0) {
  const { width, height, data } = await ask(blob, { page });
  const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(data), width, height));
  return { source: bmp, width, height, kind: 'tiff', close: () => bmp.close() };
}
