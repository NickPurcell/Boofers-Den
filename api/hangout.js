// Find time to hang v2: events, the people in them, and their weekly rules and day entries.
// Public and unauthenticated by design (no accounts; anyone with the link can edit), so every
// write is rate-limited per IP, size-capped, validated field by field, and stored as plain text.
// The rules themselves are worked out in the browser by hang/engine.js; this file only checks
// their shape. Storage layout: api/_hang-store.js.

const crypto = require("crypto");
const E = require("../hang/engine.js");
const S = require("./_hang-store.js");

const CAP = { name: 60, person: 30, roster: 30, people: 40, rules: 12, days: 80, entrySpan: 180, log: 60, sessions: 20, body: 24000 };
const DAY = 86400000;
const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";

function clean(s, max) {
  return String(s == null ? "" : s).normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f<>‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}
const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const randomChars = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % 32]).join("");
function slug(name) {
  const s = String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let out = "";
  for (const w of s.split("-")) { if (!w) continue; if ((out ? out.length + 1 : 0) + w.length > 32) break; out += (out ? "-" : "") + w; }
  return out || (s.slice(0, 32).replace(/-+$/g, "")) || "hang";
}

class Bad extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const bad = (msg, status) => { throw new Bad(msg, status); };

async function limited(r, req, bucket, max, windowSec) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim().slice(0, 64);
  const key = `${S.K.rl(bucket)}:${ip}:${Math.floor(Date.now() / 1000 / windowSec)}`;
  const n = await r.incr(key);
  if (n === 1) await r.expire(key, windowSec + 5);
  return n > max;
}

/* ---------- validation ---------- */
const todayKey = () => E.localKey(Date.now(), "UTC");
function vDate(k, what) {
  if (k == null || k === "") return null;
  if (!E.isKey(k)) bad(`bad ${what}`);
  const t = E.keyUtc(k), now = Date.now();
  if (t < now - 120 * DAY || t > now + 420 * DAY) bad(`${what} out of range`);
  return k;
}
const vHM = (s, what) => {
  if (s == null || s === "") return null;
  if (typeof s !== "string" || !E.HM_RE.test(s)) bad(`bad ${what}`);
  return s;
};
const vLvl = (l) => (l === "maybe" ? "maybe" : "yes");
function vZone(tz) { return E.validZone(tz) ? tz : "UTC"; }

function vRoster(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) bad("bad roster");
  const seen = new Set(), out = [];
  for (const x of list.slice(0, CAP.roster * 2)) {
    const name = clean(typeof x === "string" ? x : x && x.name, CAP.person);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, req: !!(x && x.req) });
    if (out.length >= CAP.roster) break;
  }
  return out;
}

function vSettings(b, base) {
  const ev = Object.assign({}, base);
  if ("name" in b || !base) { ev.name = clean(b.name, CAP.name); if (!ev.name) bad("give it a name"); }
  if ("tz" in b || !base) ev.tz = vZone(b.tz);
  if ("len" in b || !base) {
    const len = b.len == null || b.len === "" ? 120 : Number(b.len);
    if (!Number.isInteger(len) || len < 30 || len > 720 || len % 15) bad("bad session length");
    ev.len = len;
  }
  if ("roster" in b || !base) ev.roster = vRoster(b.roster);
  if ("quorum" in b || !base) {
    const q = b.quorum == null || b.quorum === "" ? 0 : Number(b.quorum);
    if (!Number.isInteger(q) || q < 0 || q > CAP.people) bad("bad quorum");
    ev.quorum = q;
  }
  if ("from" in b || "to" in b || !base) {
    ev.from = vDate("from" in b ? b.from : ev.from, "start date");
    ev.to = vDate("to" in b ? b.to : ev.to, "end date");
    if (ev.from && ev.to && ev.to < ev.from) bad("the end date is before the start");
    if (ev.from && ev.to && E.daysBetween(ev.from, ev.to) > 366) bad("that range is too long");
  }
  return ev;
}

function vRule(x) {
  if (!x || typeof x !== "object" || !Array.isArray(x.wd)) bad("bad rule");
  const wd = [...new Set(x.wd.map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!wd.length) bad("a weekly time needs at least one day");
  const from = vHM(x.from, "time"), to = vHM(x.to, "time");
  if (from && to && from === to) bad("the start and end time are the same");
  return { wd, from, to, lvl: vLvl(x.lvl) };
}
function vEntry(x) {
  if (!x || typeof x !== "object") bad("bad day");
  const d1 = vDate(x.d1, "date");
  if (!d1) bad("bad date");
  let d2 = vDate(x.d2, "date");
  if (d2 && d2 < d1) bad("the end date is before the start");
  if (d2 && E.daysBetween(d1, d2) > CAP.entrySpan) bad("that stretch is too long");
  if (d2 === d1) d2 = null;
  if (!["away", "only", "add"].includes(x.kind)) bad("bad day kind");
  const from = vHM(x.from, "time"), to = vHM(x.to, "time");
  if (from && to && from === to) bad("the start and end time are the same");
  const out = { d1, kind: x.kind };
  if (d2) out.d2 = d2;
  if (from) out.from = from;
  if (to) out.to = to;
  if (x.kind !== "away") out.lvl = vLvl(x.lvl);
  return out;
}
function vPerson(b) {
  const name = clean(b.name, CAP.person);
  if (!name) bad("name required");
  if (!Array.isArray(b.rules || []) || !Array.isArray(b.days || [])) bad("bad times");
  if ((b.rules || []).length > CAP.rules) bad(`at most ${CAP.rules} weekly times`);
  // finished stretches are dropped rather than refused, so an old list never blocks a save
  const days = E.pruneDays((b.days || []).filter((x) => x && E.isKey(x.d1)), E.addDays(todayKey(), -60));
  if (days.length > CAP.days) bad(`at most ${CAP.days} changed days`);
  return { name, tz: vZone(b.tz), rules: (b.rules || []).map(vRule), days: days.map(vEntry) };
}

/* ---------- reading ---------- */
function publicEvent(ev) {
  const { key, ...rest } = ev;
  return rest;
}
async function readAll(r, id) {
  const ev = await S.readEvent(r, id);
  if (!ev) return null;
  const rows = (await r.hgetall(S.K.pp(id))) || {};
  const people = [];
  for (const f of Object.keys(rows)) {
    try { const p = JSON.parse(rows[f]); people.push({ name: p.name, tz: p.tz, rules: p.rules || [], days: p.days || [], updated: p.updated }); } catch { /* skip junk */ }
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  const log = ((await r.lrange(S.K.log(id), 0, CAP.log - 1)) || []).map((s) => { try { const { before, ...x } = JSON.parse(s); return x; } catch { return null; } }).filter(Boolean);
  return { event: publicEvent(ev), people, log, now: Date.now() };
}

/* ---------- writing ---------- */
async function touch(r, id) {
  await Promise.all([S.K.ev(id), S.K.pp(id), S.K.log(id), S.K.n(id)].map((k) => r.expire(k, S.TTL)));
}
async function logChange(r, id, who, name, what, before) {
  const n = await r.incr(S.K.n(id));
  await r.lpush(S.K.log(id), JSON.stringify({ n, who, name, what, at: Date.now(), before }));
  await r.ltrim(S.K.log(id), 0, CAP.log - 1);
}
async function saveEvent(r, ev) {
  ev.updated = Date.now();
  await r.set(S.K.ev(ev.id), JSON.stringify(ev), "EX", S.TTL);
}

async function create(r, req, b) {
  if (await limited(r, req, "create", 12, 3600)) bad("too many new events from here, try again later", 429);
  const ev = vSettings(b, null);
  const key = randomChars(24);
  const now = Date.now();
  const base = slug(ev.name);
  for (let tries = 0; tries < 5; tries++) {
    const id = `${base}-${randomChars(6)}`;
    const rec = Object.assign({ id }, ev, { sessions: [], created: now, updated: now, key: hash(key) });
    if (await r.set(S.K.ev(id), JSON.stringify(rec), "EX", S.TTL, "NX")) return { id, key };
  }
  bad("could not allocate an id", 500);
}

async function undo(r, id, n) {
  const list = (await r.lrange(S.K.log(id), 0, CAP.log - 1)) || [];
  const items = list.map((s) => { try { return { raw: s, x: JSON.parse(s) }; } catch { return null; } }).filter(Boolean);
  const idx = items.findIndex((it) => it.x.n === n);
  if (idx < 0) bad("that change can no longer be undone", 404);
  const it = items[idx].x;
  if (items.slice(0, idx).some((o) => o.x.who === it.who)) bad("undo the newer change first", 409);
  if (it.who === "@") {
    if (!it.before) bad("nothing to undo", 409);
    const cur = await S.readEvent(r, id);
    const prev = JSON.parse(it.before);
    prev.key = cur.key; // never change who may delete it
    await saveEvent(r, prev);
  } else if (it.before) {
    if (!(await r.hexists(S.K.pp(id), it.who)) && (await r.hlen(S.K.pp(id))) >= CAP.people) bad("this event is full", 409);
    await r.hset(S.K.pp(id), it.who, it.before);
  } else {
    await r.hdel(S.K.pp(id), it.who);
  }
  await r.lrem(S.K.log(id), 1, items[idx].raw);
}

async function handlePost(r, req, res, b) {
  if (JSON.stringify(b).length > CAP.body) bad("that is too much at once", 413);
  if (b.action === "create") return res.status(200).json(await create(r, req, b));

  const id = String(b.id || "");
  if (!S.validId(id)) bad("bad id");
  if (await limited(r, req, "write", 90, 60)) bad("slow down a little", 429);
  if (await limited(r, req, "write-ev:" + id, 600, 3600)) bad("this event is changing too fast, try again later", 429);
  const ev = await S.readEvent(r, id);
  if (!ev) bad("not found", 404);

  switch (b.action) {
    case "settings": {
      const next = vSettings(b.set || {}, ev);
      await logChange(r, id, "@", ev.name, "settings", JSON.stringify(ev));
      await saveEvent(r, next);
      break;
    }
    case "me": {
      const p = vPerson(b);
      const field = p.name.toLowerCase();
      const before = await r.hget(S.K.pp(id), field);
      if (!before && (await r.hlen(S.K.pp(id))) >= CAP.people) bad("this event is full", 409);
      const same = (() => { try { const o = JSON.parse(before); return JSON.stringify([o.name, o.tz, o.rules, o.days]) === JSON.stringify([p.name, p.tz, p.rules, p.days]); } catch { return false; } })();
      if (!same) {
        await logChange(r, id, field, p.name, "times", before || null);
        await r.hset(S.K.pp(id), field, JSON.stringify(Object.assign(p, { updated: Date.now() })));
      }
      break;
    }
    case "forget": {
      const name = clean(b.name, CAP.person), field = name.toLowerCase();
      const before = await r.hget(S.K.pp(id), field);
      if (before) {
        await logChange(r, id, field, name, "removed", before);
        await r.hdel(S.K.pp(id), field);
      }
      break;
    }
    case "lock": {
      // a locked-in session; an event can hold several (session 0, session 1, the next one...)
      const start = Number(b.start), end = Number(b.end), now = Date.now();
      if (!Number.isInteger(start) || !Number.isInteger(end) || start % 60000 || end % 60000 || end <= start || end - start > DAY) bad("bad time");
      if (start < now - 7 * DAY || start > now + 420 * DAY) bad("that time is out of range");
      const kept = (ev.sessions || []).filter((x) => x.end > now - 30 * DAY);
      if (kept.length >= CAP.sessions) bad(`at most ${CAP.sessions} sessions`, 409);
      if (kept.some((x) => x.start === start && x.end === end)) bad("that session is already locked in", 409);
      await logChange(r, id, "@", ev.name, "locked", JSON.stringify(ev));
      kept.push({ sid: randomChars(6), start, end, label: clean(b.label, 40) });
      ev.sessions = kept.sort((x, y) => x.start - y.start);
      await saveEvent(r, ev);
      break;
    }
    case "unlock": {
      const sid = String(b.sid || "");
      const hit = (ev.sessions || []).find((x) => x.sid === sid);
      if (!hit) bad("no such session", 404);
      await logChange(r, id, "@", ev.name, "unlocked", JSON.stringify(ev));
      ev.sessions = ev.sessions.filter((x) => x.sid !== sid);
      await saveEvent(r, ev);
      break;
    }
    case "undo": {
      const n = Number(b.n);
      if (!Number.isInteger(n) || n < 1) bad("bad change");
      await undo(r, id, n);
      break;
    }
    case "delete": {
      if (!ev.key || typeof b.key !== "string" || hash(b.key.slice(0, 64)) !== ev.key) bad("only the device that made this event can delete it", 403);
      await r.del(S.K.ev(id), S.K.pp(id), S.K.log(id), S.K.n(id));
      return res.status(200).json({ deleted: true });
    }
    default:
      bad("unknown action");
  }
  await touch(r, id);
  res.status(200).json(await readAll(r, id));
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!S.URL) { res.status(503).json({ error: "store not connected" }); return; }
  try {
    const r = S.getClient();
    if (req.method === "GET") {
      const id = String((req.query && req.query.id) || "");
      if (!S.validId(id)) bad("bad id");
      if (req.query.ics != null) {
        const ev = await S.readEvent(r, id);
        const ses = ev && (ev.sessions || []).find((x) => x.sid === String(req.query.ics));
        if (!ses) bad("no such session", 404);
        const host = String(req.headers["x-forwarded-host"] || req.headers.host || "boofers-den.vercel.app").replace(/[^a-z0-9.:-]/gi, "");
        const body = E.ics({ uid: `${id}-${ses.sid}@boofers-den`, name: ses.label ? `${ev.name}: ${ses.label}` : ev.name, start: ses.start, end: ses.end, url: `https://${host}/hang/${id}` });
        res.setHeader("Content-Type", "text/calendar; charset=utf-8");
        res.setHeader("Content-Disposition", `inline; filename="${id}-${ses.sid}.ics"`);
        res.status(200).send(body);
        return;
      }
      const data = await readAll(r, id);
      if (!data) bad("not found", 404);
      res.status(200).json(data);
      return;
    }
    if (req.method !== "POST") { res.setHeader("Allow", "GET, POST"); bad("method not allowed", 405); }
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || typeof body !== "object" || Array.isArray(body)) bad("bad request");
    await handlePost(r, req, res, body);
  } catch (err) {
    if (err instanceof Bad) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: "server error" });
  }
};

module.exports._test = { clean, slug, vSettings, vPerson, vRule, vEntry, vRoster };
