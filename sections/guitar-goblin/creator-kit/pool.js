// A pool of module workers that run a page's meshing jobs off the main thread, with a fallback to the page itself
// when a browser can't start a module worker.
//
//   const pool = createPool(new URL('./jobs.js', import.meta.url));
//   const out = await pool.mesh('body', { build: 1 });          // one job (a third argument names the cache entry it feeds)
//   const out = await pool.cached('body:1', 'body', { build: 1 });   // the same, remembered by key
//   pool.cancelQueued();   // when a newer choice replaces what was asked for: drop whatever has not started
//
// The jobs module exports run(job, args), which returns plain objects and typed arrays, and may export
// transferables(out), the list of array buffers to hand over without copying. It runs in a worker, so nothing it
// imports may touch the page or import three.js (workers can't see the page's import map).
export function createPool(jobsUrl, o = {}) {
  const url = String(jobsUrl), workers = [], waiting = new Map(), queue = [], cache = new Map();
  let seq = 0, ok = true, local = null;
  const here = async (job, args) => { local = local || (await import(url)); return local.run(job, args); };
  function pump() { for (const w of workers) if (!w.busy && queue.length) { const j = queue.shift(); w.busy = true; waiting.set(j.id, j); w.postMessage({ id: j.id, job: j.job, args: j.args }); } }
  try {
    const n = o.size ?? Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./mesher.worker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => { const { id, ok: good, out, error } = e.data, cb = waiting.get(id); waiting.delete(id); w.busy = false; pump(); if (cb) (good ? cb.res(out) : cb.rej(new Error(error))); };
      w.onerror = (e) => { ok = false; console.warn('mesher worker failed; meshing on the page instead', e.message); for (const [id, cb] of waiting) { waiting.delete(id); cb.rej(new Error('worker failed')); } };
      w.postMessage({ init: url });
      workers.push(w);
    }
  } catch (e) { ok = false; }
  // key: the cache entry this job feeds, if any, so that cancelling the job forgets the entry at once
  const mesh = (job, args, key) => {
    if (!ok || !workers.length) return here(job, args);
    return new Promise((res, rej) => { queue.push({ id: ++seq, job, args, res, rej, key }); pump(); }).catch((e) => { if (e && e.cancelled) throw e; console.warn(e); ok = false; return here(job, args); });
  };
  // forget a result that failed or was cancelled, so asking again runs it again
  const keep = (key, p) => { cache.set(key, p); p.catch(() => { if (cache.get(key) === p) cache.delete(key); }); return p; };
  return {
    mesh, cache, keep, size: () => (ok ? workers.length : 1),
    cached: (key, job, args) => (cache.has(key) ? cache.get(key) : keep(key, mesh(job, args, key))),
    // drop every job that has not started yet (the choice it was for has been replaced); their promises reject with
    // an error marked `cancelled`
    cancelQueued() { for (const j of queue.splice(0)) { if (j.key !== undefined) cache.delete(j.key); const e = new Error('cancelled'); e.cancelled = true; j.rej(e); } },
  };
}
