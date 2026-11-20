// Decoder for Photoshop files (.psd, .psb) on the converter pages: no browser can open them. The
// work happens in psd-worker.js, loaded when the first Photoshop file is added.
let worker = null;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./psd-worker.js', import.meta.url));
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.error) job.reject(Object.assign(new Error(data.error), { code: 'decode-failed', kind: 'psd' }));
    else job.resolve(data);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    for (const job of pending.values()) job.reject(Object.assign(new Error('The Photoshop decoder could not be loaded'), { code: 'decode-failed', kind: 'psd' }));
    pending.clear();
    worker = null;
  };
  return worker;
}

async function ask(blob) {
  const buffer = await blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, buffer }, [buffer]);
  });
}

/**
 * Decode the flattened image of a PSD/PSB Blob into { source: ImageBitmap, width, height, kind,
 * approximate, close }. `approximate` is true when the file had no flattened copy and the image
 * was rebuilt from its layers (normal blending only).
 */
export async function decodePsd(blob) {
  const { width, height, data, approximate } = await ask(blob);
  const bmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(data), width, height));
  return { source: bmp, width, height, kind: 'psd', approximate, close: () => bmp.close() };
}
