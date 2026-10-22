// Shared "find time to hang" calendars.
// A calendar is a run of one-hour slots starting at a UTC instant. Each person
// is one field in a Redis hash: their name and a string with one character per
// slot ('.' unknown, 'g' good, 'n' no-go), so two people saving at once never
// clobber each other. Everything expires 90 days after the last write.

const Redis = require("ioredis");
const crypto = require("crypto");

const URL = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL || null;
const TTL = 90 * 24 * 3600;
const MAX_DAYS = 42;
const MAX_PEOPLE = 40;
const MAX_TITLE = 60;
const MAX_NAME = 30;
const ID_RE = /^[a-z0-9]{7}$/;
const HOUR = 3600 * 1000;

let client = null;
function getClient() {
  if (!client) {
    client = new Redis(URL, { maxRetriesPerRequest: 3, connectTimeout: 8000, enableReadyCheck: true });
    client.on("error", () => { /* a blip must not crash the function */ });
  }
  return client;
}

const calKey = (id) => `hang:cal:${id}`;
const peopleKey = (id) => `hang:people:${id}`;

// Plain text only: no control characters, collapsed whitespace, length-capped.
function clean(s, max) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
const hashToken = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

async function limited(r, req, bucket, max, windowSec) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const key = `hang:rl:${bucket}:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, windowSec + 5);
  return n > max;
}

async function readCalendar(r, id) {
  const raw = await r.get(calKey(id));
  if (!raw) return null;
  const cal = JSON.parse(raw);
  const rows = (await r.hgetall(peopleKey(id))) || {};
  const people = [];
  for (const f of Object.keys(rows)) {
    try { const p = JSON.parse(rows[f]); people.push({ name: p.name, cells: p.cells, updated: p.updated }); } catch { /* skip junk */ }
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  return { cal, people };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!URL) { res.status(503).json({ error: "store not connected" }); return; }
  try {
    const r = getClient();

    if (req.method === "GET") {
      const id = String((req.query && req.query.id) || "");
      if (!ID_RE.test(id)) { res.status(400).json({ error: "bad id" }); return; }
      const data = await readCalendar(r, id);
      if (!data) { res.status(404).json({ error: "not found" }); return; }
      res.status(200).json(data);
      return;
    }

    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); res.status(405).json({ error: "method not allowed" }); return; }

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    if (body.action === "create") {
      if (await limited(r, req, "create", 12, 3600)) { res.status(429).json({ error: "too many new calendars, try again later" }); return; }
      const title = clean(body.title, MAX_TITLE) || "Let's hang";
      const days = Math.max(1, Math.min(MAX_DAYS, parseInt(body.days, 10) || 21));
      const start = Number(body.start);
      const now = Date.now();
      // the creator's local midnight, as a UTC instant on a 15-minute boundary
      if (!Number.isFinite(start) || start < now - 3 * 24 * HOUR || start > now + 366 * 24 * HOUR || start % (15 * 60 * 1000) !== 0) {
        res.status(400).json({ error: "bad start" }); return;
      }
      let id = "";
      for (let tries = 0; tries < 5 && !id; tries++) {
        const cand = Array.from(crypto.randomBytes(7), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
        const cal = { id: cand, title, start, slots: days * 24, created: now };
        if (await r.set(calKey(cand), JSON.stringify(cal), "EX", TTL, "NX")) id = cand;
      }
      if (!id) { res.status(500).json({ error: "could not allocate an id" }); return; }
      res.status(200).json({ id });
      return;
    }

    const id = String(body.id || "");
    if (!ID_RE.test(id)) { res.status(400).json({ error: "bad id" }); return; }
    if (await limited(r, req, "write", 90, 60)) { res.status(429).json({ error: "slow down a little" }); return; }
    const calRaw = await r.get(calKey(id));
    if (!calRaw) { res.status(404).json({ error: "not found" }); return; }
    const cal = JSON.parse(calRaw);
    const name = clean(body.name, MAX_NAME);
    if (!name) { res.status(400).json({ error: "name required" }); return; }
    const field = name.toLowerCase();
    const token = String(body.token || "").slice(0, 64);
    if (token.length < 16) { res.status(400).json({ error: "token required" }); return; }
    const existingRaw = await r.hget(peopleKey(id), field);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;
    if (existing && existing.token !== hashToken(token) && body.force !== true) {
      res.status(409).json({ error: "name in use", name: existing.name }); return;
    }

    if (body.action === "remove") {
      await r.hdel(peopleKey(id), field);
    } else if (body.action === "save") {
      const cells = String(body.cells || "");
      if (cells.length !== cal.slots || /[^.gn]/.test(cells)) { res.status(400).json({ error: "bad cells" }); return; }
      if (!existing && (await r.hlen(peopleKey(id))) >= MAX_PEOPLE) { res.status(409).json({ error: "this calendar is full" }); return; }
      await r.hset(peopleKey(id), field, JSON.stringify({ name, cells, token: hashToken(token), updated: Date.now() }));
    } else {
      res.status(400).json({ error: "unknown action" }); return;
    }
    await r.expire(calKey(id), TTL);
    await r.expire(peopleKey(id), TTL);
    res.status(200).json(await readCalendar(r, id));
  } catch (err) {
    res.status(500).json({ error: "server error" });
  }
};
