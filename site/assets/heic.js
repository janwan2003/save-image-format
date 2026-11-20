// Fallback decoder for HEIC/HEIF photos on the converter pages. Browsers other than Safari
// cannot decode HEIC, so the page hands such files to a worker running libheif (WebAssembly).
// The worker and the ~1.5 MB library are only downloaded when the first HEIC file is added.
let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./heic-worker.js', import.meta.url));
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.error) job.reject(Object.assign(new Error(data.error), { code: 'decode-failed', kind: 'heic' }));
    else job.resolve(data);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    for (const job of pending.values()) job.reject(Object.assign(new Error('The HEIC decoder could not be loaded'), { code: 'decode-failed', kind: 'heic' }));
    pending.clear();
    worker = null;
  };
  return worker;
}

/** Decode a HEIC/HEIF Blob into { source: ImageBitmap, width, height, kind, close }. */
export async function decodeHeic(blob) {
  const buffer = await blob.arrayBuffer();
  const { width, height, data } = await new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, buffer }, [buffer]);
  });
  const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(data), width, height));
  return { source: bmp, width, height, kind: 'heic', close: () => bmp.close() };
}
