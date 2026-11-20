// The worker behind pool.js: it loads the page's jobs module once, then runs one job per message.
let jobs = null, ready = null;
self.onmessage = async (e) => {
  const d = e.data;
  if (d.init) { ready = import(d.init).then((m) => { jobs = m; }); return; }
  try {
    await ready;
    const out = await jobs.run(d.job, d.args);   // (a page's run() may return a promise: a job whose code it loads only when needed)
    self.postMessage({ id: d.id, ok: true, out }, jobs.transferables ? jobs.transferables(out) : []);
  } catch (err) {
    self.postMessage({ id: d.id, ok: false, error: String((err && err.stack) || err) });
  }
};
