// The worker behind pool.js: it loads the page's jobs module once, then runs one job per message.
let jobs = null, ready = null;
self.onmessage = async (e) => {
  const d = e.data;
  if (d.init) { ready = import(d.init).then((m) => { jobs = m; }); return; }
  try {
    await ready;
    const out = jobs.run(d.job, d.args);
    self.postMessage({ id: d.id, ok: true, out }, jobs.transferables ? jobs.transferables(out) : []);
  } catch (err) {
    self.postMessage({ id: d.id, ok: false, error: String((err && err.stack) || err) });
  }
};
