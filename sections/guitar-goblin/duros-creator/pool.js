// A small pool of module workers that mesh parts of the figure (see jobs.js), with a fallback to the page itself.
const pool = [], waiting = new Map(), queue = [];
let seq = 0, workersOk = true;
try {
  const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./mesher.worker.js', import.meta.url), { type: 'module' });
    w.busy = false;
    w.onmessage = (e) => { const { id, ok, out, error } = e.data, cb = waiting.get(id); waiting.delete(id); w.busy = false; pump(); if (cb) (ok ? cb.res(out) : cb.rej(new Error(error))); };
    w.onerror = (e) => { workersOk = false; console.warn('mesher worker failed; meshing on the page instead', e.message); };
    pool.push(w);
  }
} catch (e) { workersOk = false; }
function pump() {
  for (const w of pool) if (!w.busy && queue.length) { const j = queue.shift(); w.busy = true; waiting.set(j.id, j); w.postMessage({ id: j.id, job: j.job, args: j.args }); }
}
let local = null;
export const poolSize = () => (workersOk ? pool.length : 1);
export async function mesh(job, args) {
  if (!workersOk || !pool.length) { local = local || await import('./jobs.js'); return local.run(job, args); }
  return new Promise((res, rej) => { queue.push({ id: ++seq, job, args, res, rej }); pump(); }).catch(async (e) => {
    console.warn(e); workersOk = false; local = local || await import('./jobs.js'); return local.run(job, args);
  });
}
const cache = new Map();
export const cached = (key, job, args) => { if (!cache.has(key)) cache.set(key, mesh(job, args)); return cache.get(key); };
export const cache_ = cache;
