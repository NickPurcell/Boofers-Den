// Storage for Find time to hang v2, shared by api/hangout.js (the API) and api/hang-page.js
// (the page, with the event's name in its link preview). Not a route: the underscore keeps
// Vercel from serving it.
//
//   hang2:ev:<id>    the event, JSON
//   hang2:pp:<id>    a hash, one field per person (lowercased name -> JSON), so two people
//                    saving at once never clobber each other
//   hang2:log:<id>   recent changes, newest first, each with what it replaced, for undo
//   hang2:n:<id>     counter numbering the changes
// Everything expires 90 days after the last write.
//
// Version-one calendars (hang:cal:<7 chars>, hang:people:<7 chars>) are copied into a v2 event
// with the same id the first time they are opened; the old keys are left to expire.

const Redis = require("ioredis");
const E = require("../hang/engine.js");

const URL = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL || null;
const TTL = 90 * 24 * 3600;
const OLD_ID = /^[a-z0-9]{7}$/;
const NEW_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{6}$/;
const validId = (id) => typeof id === "string" && id.length <= 48 && (OLD_ID.test(id) || NEW_ID.test(id));

let client = null;
function getClient() {
  if (!client) {
    client = new Redis(URL, { maxRetriesPerRequest: 3, connectTimeout: 8000, enableReadyCheck: true });
    client.on("error", () => { /* a blip must not crash the function */ });
  }
  return client;
}

const K = {
  ev: (id) => `hang2:ev:${id}`,
  pp: (id) => `hang2:pp:${id}`,
  log: (id) => `hang2:log:${id}`,
  n: (id) => `hang2:n:${id}`,
  oldCal: (id) => `hang:cal:${id}`,
  oldPeople: (id) => `hang:people:${id}`,
};

// A version-one calendar started at the creator's local midnight; its offset names a likely zone.
function zoneForOffset(start) {
  const mins = -Math.round(((start % 86400000) + 86400000) % 86400000 / 60000);
  const off = mins <= -720 ? mins + 1440 : mins; // minutes east of UTC
  const candidates = ["America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago", "America/New_York", "Europe/London", "Europe/Berlin", "UTC"];
  for (const tz of candidates) if (E.offset(start, tz) === off) return tz;
  return "UTC";
}

async function migrate(r, id) {
  const raw = await r.get(K.oldCal(id));
  if (!raw) return null;
  let cal;
  try { cal = JSON.parse(raw); } catch { return null; }
  const now = Date.now();
  const ev = {
    id, name: String(cal.title || "Let's hang").slice(0, 60), tz: zoneForOffset(Number(cal.start) || 0), len: 120,
    roster: [], quorum: 0, from: null, to: null, sessions: [], created: cal.created || now, updated: now, v1: true,
  };
  if (!(await r.set(K.ev(id), JSON.stringify(ev), "EX", TTL, "NX"))) return JSON.parse(await r.get(K.ev(id)));
  // painted hours become one-day "add" entries in UTC; '.' and no-go both mean not free now
  const rows = (await r.hgetall(K.oldPeople(id))) || {};
  for (const field of Object.keys(rows)) {
    let p;
    try { p = JSON.parse(rows[field]); } catch { continue; }
    const days = [];
    const cells = String(p.cells || "");
    for (let k = 0; k < cells.length && days.length < 80; k++) {
      if (cells[k] !== "g") continue;
      let j = k;
      while (j + 1 < cells.length && cells[j + 1] === "g") j++;
      let s = cal.start + k * 3600000;
      const e = cal.start + (j + 1) * 3600000;
      while (s < e && days.length < 80) {
        const key = E.localKey(s, "UTC");
        const midnight = E.toUtc(E.addDays(key, 1), "00:00", "UTC");
        const stop = Math.min(e, midnight);
        days.push({ d1: key, kind: "add", from: E.localHM(s, "UTC"), to: stop === midnight ? null : E.localHM(stop, "UTC"), lvl: "yes" });
        s = stop;
      }
      k = j;
    }
    if (!days.length) continue;
    await r.hset(K.pp(id), field, JSON.stringify({ name: String(p.name || field).slice(0, 30), tz: "UTC", rules: [], days, updated: p.updated || now }));
  }
  await r.expire(K.pp(id), TTL);
  return ev;
}

async function readEvent(r, id) {
  const raw = await r.get(K.ev(id));
  if (raw) { try { return JSON.parse(raw); } catch { return null; } }
  if (OLD_ID.test(id)) return migrate(r, id);
  return null;
}

module.exports = { URL, TTL, OLD_ID, NEW_ID, validId, getClient, K, readEvent, migrate, zoneForOffset };
