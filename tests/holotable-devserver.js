// Local dev server for HoloTable: the whole site's static files plus /api/holotable, on an
// in-memory Redis. node tests/holotable-devserver.js [port], then open /sections/jpesus/holotable/.
// Not deployed (.vercelignore).
const http = require("http");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const HoloFake = require("./holotable-fake-redis.js");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === "ioredis" ? "ioredis-stub" : orig.call(this, req, ...rest); };
require.cache["ioredis-stub"] = { id: "ioredis-stub", filename: "ioredis-stub", loaded: true, exports: HoloFake };
process.env.REDIS_URL = "redis://stub";
// local-only passwords (the real ones live in Vercel's environment settings, never in the repo)
process.env.HOLOTABLE_PLAYER_PASSWORD = process.env.HOLOTABLE_PLAYER_PASSWORD || "dev-player";
process.env.HOLOTABLE_GM_PASSWORD = process.env.HOLOTABLE_GM_PASSWORD || "dev-gm";
const ROOT = path.join(__dirname, "..");
const S = require("../api/_holotable-store.js");
const db = new HoloFake();
const sub = db.duplicate();
// --slow: behave like the real thing, with every database call a little way off (default 40 ms)
// and Vercel's 10-second limit per request, to catch work that only fails when deployed
const slowArg = process.argv.find((a) => a.startsWith("--slow"));
const LATENCY = slowArg ? +(slowArg.split("=")[1] || 40) : 0;
if (LATENCY) {
  const delay = () => new Promise((r) => setTimeout(r, LATENCY));
  for (const name of ["get", "set", "getBuffer", "mget", "exists", "llen", "lindex", "hget", "hset", "hdel", "hgetall", "incr", "incrby", "expire", "del", "lpush", "ltrim", "lrange", "publish"]) {
    const orig = db[name].bind(db);
    db[name] = async (...a) => { await delay(); return orig(...a); };
  }
  const origPipe = db.pipeline.bind(db);
  db.pipeline = () => { const p = origPipe(); const exec = p.exec; return new Proxy(p, { get: (t, k) => (k === "exec" ? async () => { await delay(); return exec(); } : t[k]) }); };
}
S.getClient = () => db;
S.getSub = () => sub;
const api = require("../api/holotable.js");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".mp3": "audio/mpeg" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  // dev-only: simulate the save being evicted, to try the "missing save" banner and restore
  if (u.pathname === "/__dev/drop-game" && req.method === "POST") {
    const g = await db.get(S.K.camp("main"));
    if (g) { const c = JSON.parse(g); c.lastBackup = 0; await db.set(S.K.camp("main"), JSON.stringify(c)); }
    await db.del(S.K.camp("main"));
    await S.bump("main");
    return res.end("dropped");
  }
  if (u.pathname === "/api/holotable") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    if (raw.length > 4.5 * 1024 * 1024) { res.statusCode = 413; return res.end("Request Entity Too Large"); } // same limit as Vercel
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = raw; }
    const rq = { method: req.method, query: Object.fromEntries(u.searchParams), body, headers: Object.assign({ "x-forwarded-for": "127.0.0.1" }, req.headers) };
    const rs = {
      setHeader(k, v) { res.setHeader(k, v); },
      status(c) { res.statusCode = c; return this; },
      json(d) { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(d)); return this; },
      send(d) { res.end(d); return this; },
    };
    if (!LATENCY) return api(rq, rs);
    let finished = false;
    const timer = setTimeout(() => { if (!finished) { finished = true; res.statusCode = 504; res.end("FUNCTION_INVOCATION_TIMEOUT"); } }, 10000);
    const guard = (fn) => (...a) => { if (finished) return rs; return fn(...a); };
    rs.json = guard(rs.json.bind(rs)); rs.send = guard(rs.send.bind(rs));
    try { await api(rq, rs); } finally { finished = true; clearTimeout(timer); }
    return;
  }
  let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(+process.argv[2] || 8788, () => console.log("HoloTable dev server on", +process.argv[2] || 8788,
  "- dev passwords: player 'dev-player', GM 'dev-gm'" + (LATENCY ? ` - SLOW MODE: ${LATENCY} ms per database call, 10 s request limit` : "")));
