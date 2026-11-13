// Local dev server for Find time to hang: static files, /api/hangout and /hang/<id>, on an
// in-memory Redis. node tests/devserver.js [port]. Not deployed (.vercelignore).
const http = require('http');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const FakeRedis = require('./fake-redis.js');
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === 'ioredis' ? 'ioredis-stub' : orig.call(this, req, ...rest); };
require.cache['ioredis-stub'] = { id: 'ioredis-stub', filename: 'ioredis-stub', loaded: true, exports: FakeRedis };
process.env.REDIS_URL = 'redis://stub';
const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const S = require('../api/_hang-store.js');
const db = new FakeRedis();
S.getClient = () => db;
const api = require('../api/hangout.js');
const page = require('../api/hang-page.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function adapt(req, res, query, body) {
  const out = { statusCode: 200, headers: {} };
  return {
    rq: { method: req.method, query, body, headers: Object.assign({ 'x-forwarded-for': '127.0.0.1' }, req.headers) },
    rs: {
      setHeader(k, v) { res.setHeader(k, v); },
      status(c) { out.statusCode = c; res.statusCode = c; return this; },
      json(d) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(d)); return this; },
      send(d) { res.end(d); return this; },
    },
  };
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const query = Object.fromEntries(u.searchParams);
  let body = '';
  for await (const c of req) body += c;
  let parsed = body;
  try { parsed = body ? JSON.parse(body) : undefined; } catch { /* leave as string */ }
  if (u.pathname === '/api/hangout') { const { rq, rs } = adapt(req, res, query, parsed); return api(rq, rs); }
  const m = u.pathname.match(/^\/hang\/([a-z0-9-]{7,48})$/);
  if (m) { const { rq, rs } = adapt(req, res, { id: m[1] }, undefined); return page(rq, rs); }
  let f = path.join(ROOT, decodeURIComponent(u.pathname));
  if (!f.startsWith(ROOT)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(+process.argv[2] || 8787, () => console.log('dev server on', +process.argv[2] || 8787));
