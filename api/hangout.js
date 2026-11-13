// Find time to hang v2: events, the people in them, and their weekly rules and day entries.
// Public and unauthenticated by design (no accounts; anyone with the link can edit), so every
// write is rate-limited (per address, and per event across all addresses), byte-budgeted per
// address per day, size-capped, validated field by field, and stored as plain text.
// Every change is logged with what it replaced, so it can be undone; an undo is logged too, so
// it can be redone; a removed person is also kept aside, so a flood of later changes pushing the
// log past its cap cannot lose them. The rules are worked out in the browser by hang/engine.js;
// this file only checks their shape. Storage layout: api/_hang-store.js.

const crypto = require("crypto");
const E = require("../hang/engine.js");
const S = require("./_hang-store.js");

const CAP = {
  name: 60, person: 30, label: 40, roster: 30, people: 40, gone: 40, rules: 12, days: 60, entrySpan: 120, entryDays: 300,
  log: 100, sessions: 20, body: 16000, bytesPerDay: 2000000, createsPerHour: 12, createsPerDay: 40,
  writesPerMinute: 90, eventWritesPerHour: 300,
};
const DAY = 86400000;
const ALPHA = "abcdefghijkmnpqrstuvwxyz23456789";

const clean = (s, max) => E.cleanText(s, max);
const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const randomChars = (n) => Array.from(crypto.randomBytes(n), (b) => ALPHA[b % 32]).join("");
function slug(name) {
  const s = String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  let out = "";
  for (const w of s.split("-")) { if (!w) continue; if ((out ? out.length + 1 : 0) + w.length > 32) break; out += (out ? "-" : "") + w; }
  return out || (s.slice(0, 32).replace(/-+$/g, "")) || "hang";
}
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);

class Bad extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }
const bad = (msg, status) => { throw new Bad(msg, status); };

// the caller's address; IPv6 grouped by /64, since one connection usually holds a whole /64
function addr(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim().slice(0, 64);
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip;
}
async function bump(r, key, by, windowSec) {
  const n = by === 1 ? await r.incr(key) : await r.incrby(key, by);
  if (n === by) await r.expire(key, windowSec + 5);
  return n;
}
const slot = (windowSec) => Math.floor(Date.now() / 1000 / windowSec);
async function limited(r, req, bucket, max, windowSec) {
  return (await bump(r, `${S.K.rl(bucket)}:${addr(req)}:${slot(windowSec)}`, 1, windowSec)) > max;
}

/* ---------- validation ---------- */
const todayKey = () => E.localKey(Date.now(), "UTC");
function vDate(k, what) {
  if (k == null || k === "") return null;
  if (!E.isKey(k)) bad(`bad ${what}`);
  const t = E.keyUtc(k), now = Date.now();
  if (t < now - 400 * DAY || t > now + 420 * DAY) bad(`${what} out of range`);
  return k;
}
const vHM = (s, what) => {
  if (s == null || s === "") return null;
  if (typeof s !== "string" || !E.HM_RE.test(s)) bad(`bad ${what}`);
  return s;
};
const vLvl = (l) => (l === "maybe" ? "maybe" : "yes");
const vZone = (tz) => E.canonZone(tz) || "UTC";
function vHours(from, to) {
  if (from && to && from === to) bad("the start and end time are the same");
  if (!from && to === "00:00") bad("before midnight is no time at all");
}

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

// b: the fields to set; base: the event as stored (null when creating). Unchanged dates are not
// re-checked, so an event that started long ago can still be renamed.
function vSettings(b, base) {
  if (!isObj(b)) bad("bad settings");
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
  for (const [f, what] of [["from", "start date"], ["to", "end date"]]) {
    if (!(f in b) && base) continue;
    const v = b[f] == null || b[f] === "" ? null : b[f];
    ev[f] = base && v === base[f] ? base[f] : vDate(v, what);
  }
  if (ev.from && ev.to && ev.to < ev.from) bad("the end date is before the start");
  if (ev.from && ev.to && E.daysBetween(ev.from, ev.to) > 400) bad("that range is too long");
  return ev;
}

function vRule(x) {
  if (!isObj(x) || !Array.isArray(x.wd)) bad("bad rule");
  const wd = [...new Set(x.wd.slice(0, 7).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!wd.length) bad("a weekly time needs at least one day");
  const from = vHM(x.from, "time"), to = vHM(x.to, "time");
  vHours(from, to);
  return { wd, from, to, lvl: vLvl(x.lvl) };
}
function vEntry(x) {
  if (!isObj(x)) bad("bad day");
  const d1 = vDate(x.d1, "date");
  if (!d1) bad("bad date");
  let d2 = vDate(x.d2, "date");
  if (d2 && d2 < d1) bad("the end date is before the start");
  if (d2 && E.daysBetween(d1, d2) > CAP.entrySpan) bad("that stretch is too long");
  if (d2 === d1) d2 = null;
  if (!["away", "only", "add"].includes(x.kind)) bad("bad day kind");
  const from = vHM(x.from, "time"), to = vHM(x.to, "time");
  vHours(from, to);
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
  // stretches that ended over 60 days ago are dropped rather than refused, so an old list never blocks a save
  const days = E.pruneDays((b.days || []).filter((x) => isObj(x) && E.isKey(x.d1)), E.addDays(todayKey(), -60));
  if (days.length > CAP.days) bad(`at most ${CAP.days} changed days`);
  const out = { name, tz: vZone(b.tz), rules: (b.rules || []).map(vRule), days: days.map(vEntry) };
  const total = out.days.reduce((n, x) => n + (x.d2 ? E.daysBetween(x.d1, x.d2) + 1 : 1), 0);
  if (total > CAP.entryDays) bad(`at most ${CAP.entryDays} changed days in all`);
  return out;
}

/* ---------- reading ---------- */
function publicEvent(ev) {
  const { key, ...rest } = ev;
  return rest;
}
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
async function readAll(r, id) {
  const ev = await S.readEvent(r, id);
  if (!ev) return null;
  const rows = (await r.hgetall(S.K.pp(id))) || {};
  const people = [];
  for (const f of Object.keys(rows)) {
    const p = parse(rows[f]);
    if (p && p.name) people.push({ name: p.name, tz: p.tz, rules: p.rules || [], days: p.days || [], updated: p.updated });
  }
  people.sort((a, b) => a.name.localeCompare(b.name));
  const gone = Object.values((await r.hgetall(S.K.gone(id))) || {}).map(parse).filter((g) => g && g.rec && g.rec.name)
    .filter((g) => !rows[g.rec.name.toLowerCase()]).map((g) => ({ name: g.rec.name, at: g.at })).sort((a, b) => b.at - a.at);
  const log = ((await r.lrange(S.K.log(id), 0, CAP.log - 1)) || []).map(parse).filter(Boolean).map(({ before, ...x }) => x);
  return { event: publicEvent(ev), people, removed: gone, log, now: Date.now() };
}

/* ---------- writing ---------- */
async function touch(r, id) {
  await Promise.all([S.K.ev(id), S.K.pp(id), S.K.log(id), S.K.n(id), S.K.gone(id)].map((k) => r.expire(k, S.TTL)));
}
async function logChange(r, id, entry) {
  const n = await r.incr(S.K.n(id));
  await r.lpush(S.K.log(id), JSON.stringify(Object.assign({ n, at: Date.now() }, entry)));
  await r.ltrim(S.K.log(id), 0, CAP.log - 1);
}
async function saveEvent(r, ev) {
  ev.updated = Date.now();
  await r.set(S.K.ev(ev.id), JSON.stringify(ev), "EX", S.TTL);
}
// a person's current record moves aside rather than vanishing
async function putAside(r, id, who, rec) {
  if (!rec) return;
  const g = S.K.gone(id);
  await r.hset(g, who, JSON.stringify({ rec: parse(rec), at: Date.now() }));
  if ((await r.hlen(g)) > CAP.gone) {
    const all = Object.entries((await r.hgetall(g)) || {}).map(([f, v]) => [f, (parse(v) || {}).at || 0]).sort((a, b) => a[1] - b[1]);
    for (const [f] of all.slice(0, all.length - CAP.gone)) await r.hdel(g, f);
  }
}
// set a person's record to `rec` (a JSON string) or remove them (null), keeping what was there aside
async function setPerson(r, id, who, rec) {
  const cur = await r.hget(S.K.pp(id), who);
  if (rec) {
    if (!cur && (await r.hlen(S.K.pp(id))) >= CAP.people) bad("this event is full", 409);
    await r.hset(S.K.pp(id), who, rec);
    await r.hdel(S.K.gone(id), who);
  } else if (cur) {
    await putAside(r, id, who, cur);
    await r.hdel(S.K.pp(id), who);
  }
  return cur;
}

async function create(r, req, b) {
  if (await limited(r, req, "create", CAP.createsPerHour, 3600)) bad("too many new events from here, try again later", 429);
  if (await limited(r, req, "create-day", CAP.createsPerDay, 86400)) bad("too many new events from here today", 429);
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

// Undo the change numbered n: put back what it replaced. Only the newest change to a person (or
// to the event) can be undone, so nobody undoes over somebody else's later edit; undos already
// done do not count as newer. The undo is logged with what it replaced; undoing that is a redo,
// logged as the change it brings back, so it can be undone again.
async function undo(r, id, n) {
  const list = (await r.lrange(S.K.log(id), 0, CAP.log - 1)) || [];
  const items = list.map((raw) => ({ raw, x: parse(raw) })).filter((it) => it.x);
  const idx = items.findIndex((it) => it.x.n === n);
  if (idx < 0) bad("that change can no longer be undone", 404);
  const it = items[idx].x;
  const newer = items.slice(0, idx).filter((o) => o.x.who === it.who);
  if (it.what === "undo" ? newer.length : newer.some((o) => o.x.what !== "undo")) bad("undo the newer change first", 409);
  let replaced;
  if (it.who === "@") {
    if (!it.before) bad("nothing to undo", 409);
    const cur = await S.readEvent(r, id);
    const prev = JSON.parse(it.before);
    prev.key = cur.key; // never change who may delete it
    replaced = JSON.stringify(cur);
    await saveEvent(r, prev);
  } else {
    replaced = await setPerson(r, id, it.who, it.before || null);
  }
  await r.lrem(S.K.log(id), 1, items[idx].raw);
  // an undo is logged as one; a redo (undoing an undo) is logged as the change it brings back
  if (it.what !== "undo") await logChange(r, id, { who: it.who, name: it.name, what: "undo", undid: it.what, before: replaced || null });
  else await logChange(r, id, { who: it.who, name: it.name, what: it.undid || "times", before: replaced || null });
}

async function handlePost(r, req, res, b) {
  const size = JSON.stringify(b).length;
  if (size > CAP.body) bad("that is too much at once", 413);
  if ((await bump(r, `${S.K.rl("bytes")}:${addr(req)}:${slot(86400)}`, size, 86400)) > CAP.bytesPerDay) bad("too much from here today, try again tomorrow", 429);
  if (b.action === "create") return res.status(200).json(await create(r, req, b));

  const id = String(b.id || "");
  if (!S.validId(id)) bad("bad id");
  if (await limited(r, req, "write", CAP.writesPerMinute, 60)) bad("slow down a little", 429);
  if ((await bump(r, `${S.K.rl("event")}:${id}:${slot(3600)}`, 1, 3600)) > CAP.eventWritesPerHour) bad("this event is changing too fast, try again later", 429);
  const ev = await S.readEvent(r, id);
  if (!ev) bad("not found", 404);

  switch (b.action) {
    case "settings": {
      const next = vSettings(b.set, ev);
      await logChange(r, id, { who: "@", name: ev.name, what: "settings", before: JSON.stringify(ev) });
      await saveEvent(r, next);
      break;
    }
    case "me": {
      const p = vPerson(b);
      const who = p.name.toLowerCase();
      const before = await r.hget(S.K.pp(id), who);
      const o = before && parse(before);
      const same = o && JSON.stringify([o.name, o.tz, o.rules, o.days]) === JSON.stringify([p.name, p.tz, p.rules, p.days]);
      if (!same) {
        await setPerson(r, id, who, JSON.stringify(Object.assign(p, { updated: Date.now() })));
        await logChange(r, id, { who, name: p.name, what: "times", before: before || null });
      }
      break;
    }
    case "forget": {
      const name = clean(b.name, CAP.person), who = name.toLowerCase();
      const before = await setPerson(r, id, who, null);
      if (before) await logChange(r, id, { who, name: (parse(before) || {}).name || name, what: "removed", before });
      break;
    }
    case "restore": {
      const name = clean(b.name, CAP.person), who = name.toLowerCase();
      const g = parse(await r.hget(S.K.gone(id), who));
      if (!g || !g.rec) bad("nobody by that name was removed", 404);
      if (await r.hexists(S.K.pp(id), who)) bad("someone is using that name now", 409);
      await setPerson(r, id, who, JSON.stringify(g.rec));
      await logChange(r, id, { who, name: g.rec.name, what: "restored", before: null });
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
      await logChange(r, id, { who: "@", name: ev.name, what: "locked", before: JSON.stringify(ev) });
      kept.push({ sid: randomChars(6), start, end, label: clean(b.label, CAP.label) });
      ev.sessions = kept.sort((x, y) => x.start - y.start);
      await saveEvent(r, ev);
      break;
    }
    case "unlock": {
      const sid = String(b.sid || "");
      if (!(ev.sessions || []).some((x) => x.sid === sid)) bad("no such session", 404);
      await logChange(r, id, { who: "@", name: ev.name, what: "unlocked", before: JSON.stringify(ev) });
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
      await r.del(S.K.ev(id), S.K.pp(id), S.K.log(id), S.K.n(id), S.K.gone(id));
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
    if (!isObj(body)) bad("bad request");
    await handlePost(r, req, res, body);
  } catch (err) {
    if (err instanceof Bad) { res.status(err.status).json({ error: err.message }); return; }
    res.status(500).json({ error: "server error" });
  }
};

module.exports._test = { clean, slug, vSettings, vPerson, vRule, vEntry, vRoster, CAP };
