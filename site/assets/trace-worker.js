// Saveform vector tracer worker: runs lib/trace.js off the main thread, so tracing a large photo
// (seconds) does not freeze the page.
// Message in:  { id, data, width, height, options }  (data: RGBA ArrayBuffer, transferred)
//         out: { id, result: { svg, colors, paths, layers } } or { id, error }
import { traceImage } from '../lib/trace.js';

self.onmessage = ({ data: { id, data, width, height, options } }) => {
  try {
    self.postMessage({ id, result: traceImage(new Uint8ClampedArray(data), width, height, options) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
