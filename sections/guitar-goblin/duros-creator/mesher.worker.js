// A module worker that meshes parts of the figure off the main thread (see jobs.js).
import { run, transferables } from './jobs.js';
self.onmessage = (e) => {
  const { id, job, args } = e.data;
  try {
    const out = run(job, args);
    self.postMessage({ id, ok: true, out }, transferables(out));
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
};
