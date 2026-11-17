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
const ROOT = path.join(__dirname, "..");
const S = require("../api/_holotable-store.js");
const db = new HoloFake();
const sub = db.duplicate();
S.getClient = () => db;
S.getSub = () => sub;
const api = require("../api/holotable.js");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".mp3": "audio/mpeg" };

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
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
    return api(rq, rs);
  }
  let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("Content-Type", TYPES[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
}).listen(+process.argv[2] || 8788, () => console.log("HoloTable dev server on", +process.argv[2] || 8788));
