// Runs the vector tracer (lib/trace.js) in trace-worker.js, a module worker started when the
// first image is traced. If the worker cannot start, tracing runs on the page instead.
import { traceImage } from '../lib/trace.js';

let worker = null;
let broken = false;
let nextId = 1;
const pending = new Map();

function getWorker() {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL('./trace-worker.js', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    if (data.error) job.reject(new Error(data.error));
    else job.resolve(data.result);
  };
  worker.onerror = (e) => {
    e.preventDefault?.();
    broken = true;
    worker = null;
    // Jobs already sent are traced here instead.
    for (const job of pending.values()) {
      try { job.resolve(traceImage(job.data, job.width, job.height, job.options)); } catch (err) { job.reject(err); }
    }
    pending.clear();
  };
  return worker;
}

/** Same as traceImage(data, width, height, options), off the main thread. Takes over `data`. */
export function traceInWorker(data, width, height, options) {
  const w = getWorker();
  if (!w) return Promise.resolve(traceImage(data, width, height, options));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    // A copy stays here only so that a worker that fails to load can be replaced by the page.
    pending.set(id, { resolve, reject, data: data.slice(), width, height, options });
    w.postMessage({ id, data: data.buffer, width, height, options }, [data.buffer]);
  });
}
