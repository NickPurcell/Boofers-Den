// HoloTable storage on the project's Redis. Not a route: the underscore keeps Vercel from serving it.
//
//   ht:camp:main       the group's one game, JSON (htpv:... on preview deployments, like hang2pv)
//   ht:ver:<CODE>      change counter; bumped and PUBLISHed on ht:ch:<CODE> after every change
//   ht:on:<CODE>       hash clientId -> last poll time (who is online)
//   ht:bk:<CODE>       list of recent backups (one every 10 minutes of play, newest first, last 10 kept)
//   ht:lock:<CODE>     short lock so two changes to one campaign never overwrite each other
//   ht:img:<id>        an uploaded image (character photo, map, handout), raw bytes
//   ht:packs           hash packId -> pack summary JSON (asset library, shared by all campaigns)
//   ht:pack:<id>       the pack's asset list, JSON
//   ht:a:<id>:<n>      one asset image, raw bytes
//   ht:libver          bumped when the library changes
//   ht:rl:<bucket>     rate-limit counters
//   ht:secret          random secret for signing sessions (only the server reads it)
//   ht:powers, ht:equip:<set>   SW5e lists, cached for a week; ht:sw5e:lock|fail:<list> short fetch markers
//   ht:bytes           total bytes of stored images and pack art, checked against the storage cap
// Nothing here touches Find time to hang's hang:/hang2: keys. The game and images never expire:
// it is meant to be picked up again next session. Size limits: images + packs <= HOLOTABLE_STORAGE_MB
// (default 250), the game document <= 1.5 MB, and 10 backups of it.

const crypto = require("crypto");
const Redis = require("ioredis");

const URL = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL || null;
// Preview deployments share production's Redis, so they keep to their own prefix.
const NS = process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" ? "htpv" : "ht";
const K = {
  camp: (c) => `${NS}:camp:${c}`,
  ver: (c) => `${NS}:ver:${c}`,
  ch: (c) => `${NS}:ch:${c}`,
  on: (c) => `${NS}:on:${c}`,
  bk: (c) => `${NS}:bk:${c}`,
  lock: (c) => `${NS}:lock:${c}`,
  img: (id) => `${NS}:img:${id}`,
  packs: () => `${NS}:packs`,
  pack: (id) => `${NS}:pack:${id}`,
  asset: (id, n) => `${NS}:a:${id}:${n}`,
  libver: () => `${NS}:libver`,
  rl: (b) => `${NS}:rl:${b}`,
  bytes: () => `${NS}:bytes`,
  secret: () => `${NS}:secret`,                 // random session-signing secret, made once; never sent anywhere
  powers: () => `${NS}:powers`,                 // the SW5e power list, fetched from SW5e's own API and cached for a week
  equipment: (set) => `${NS}:equip:${set}`,      // SW5e standard gear / enhanced items, fetched and cached the same way
  sw5e: (name) => `${NS}:sw5e:list:${name}`,     // the other SW5e lists (species, feats, monsters, rules...), cached the same way
  sw5eSizes: () => `${NS}:sw5e:sizes`,          // bytes cached per SW5e list, for the total cap
  sw5eLock: (name) => `${NS}:sw5e:lock:${name}`,  // short marker: one request at a time fetches that SW5e list
  sw5eFail: (name) => `${NS}:sw5e:fail:${name}`,  // set for a minute after a failed fetch, so SW5e isn't called again
};
const STORAGE_CAP = (+process.env.HOLOTABLE_STORAGE_MB || 250) * 1024 * 1024;
const MAX_GAME_BYTES = 1.5 * 1024 * 1024;

let client = null;
let sub = null;
const waiters = new Map(); // channel -> Set of callbacks

function getClient() {
  if (!client) {
    client = new Redis(URL, { maxRetriesPerRequest: 3, connectTimeout: 8000, enableReadyCheck: true });
    client.on("error", () => { /* a blip must not crash the function */ });
  }
  return client;
}

// A second connection in subscriber mode, shared by every request on this instance.
function getSub() {
  if (!sub) {
    sub = module.exports.getClient().duplicate();
    sub.on("error", () => {});
  }
  return sub;
}
// attach the message router once to whichever subscriber connection is in use
const routed = new WeakSet();
function subscriber() {
  const s = module.exports.getSub();
  if (!routed.has(s)) {
    routed.add(s);
    s.on("message", (channel) => { for (const fn of [...(waiters.get(channel) || [])]) fn(); });
  }
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves true when the campaign changes, false after ms. Callers re-check the version either
// way, so a missed message only costs a little latency.
async function waitForChange(code, ms) {
  const channel = K.ch(code);
  let s;
  try { s = subscriber(); } catch { await sleep(ms); return false; }
  let set = waiters.get(channel);
  if (!set) {
    set = new Set();
    waiters.set(channel, set);
    s.subscribe(channel).catch(() => {});
  }
  return new Promise((resolve) => {
    const done = (v) => {
      clearTimeout(timer);
      set.delete(fn);
      if (!set.size && waiters.get(channel) === set) { waiters.delete(channel); s.unsubscribe(channel).catch(() => {}); }
      resolve(v);
    };
    const fn = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    set.add(fn);
  });
}

class Busy extends Error {}
class Full extends Error {}

// Hard cap on stored images and pack art: reserve before writing, release after deleting.
async function reserve(n) {
  const r = module.exports.getClient();
  const total = await r.incrby(K.bytes(), n);
  if (total > STORAGE_CAP) {
    await r.incrby(K.bytes(), -n);
    throw new Full(`HoloTable's storage is full (${Math.round(STORAGE_CAP / 1048576)} MB). Delete an asset pack or old images first.`);
  }
}
async function release(n) { if (n > 0) await module.exports.getClient().incrby(K.bytes(), -n); }
async function used() { return +((await module.exports.getClient().get(K.bytes())) || 0); }

async function withLock(code, fn) {
  const r = module.exports.getClient();
  const key = K.lock(code), token = crypto.randomBytes(8).toString("hex");
  for (let i = 0; i < 60; i++) {
    if (await r.set(key, token, "PX", 8000, "NX")) {
      try { return await fn(); }
      finally { if ((await r.get(key)) === token) await r.del(key); }
    }
    await sleep(40 + Math.random() * 80);
  }
  throw new Busy("The table is busy, try again.");
}

async function getCampaign(code) {
  const raw = await module.exports.getClient().get(K.camp(code));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function bump(code) {
  const r = module.exports.getClient();
  const v = await r.incr(K.ver(code));
  await r.publish(K.ch(code), String(v));
  return v;
}

const BACKUP_EVERY = 600, BACKUP_KEEP = 10;
async function saveCampaign(camp) {
  const r = module.exports.getClient();
  const t = Date.now() / 1000;
  camp.updated = t;
  const backup = !camp.lastBackup || t - camp.lastBackup >= BACKUP_EVERY;
  if (backup) camp.lastBackup = t;
  const json = JSON.stringify(camp);
  if (json.length > MAX_GAME_BYTES) throw new Full("The table has grown too large to save. Clear the chat or remove some characters and handouts.");
  await r.set(K.camp(camp.code), json);
  if (backup) {
    await r.lpush(K.bk(camp.code), json);
    await r.ltrim(K.bk(camp.code), 0, BACKUP_KEEP - 1);
  }
  return bump(camp.code);
}

// ---- images
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.slice(0, 3).toString() === "GIF") return "image/gif";
  return null;
}
function decodeDataUrl(dataUrl, maxBytes) {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (!sniff(buf) || buf.length > maxBytes) return null;
  return buf;
}
async function putImage(buf, id) {
  id = id || crypto.randomBytes(12).toString("hex");
  await reserve(buf.length);
  await module.exports.getClient().set(K.img(id), buf);
  return { id, url: `/api/holotable?img=${id}` };
}
const imgIdFromUrl = (u) => { const m = /^\/api\/holotable\?img=([a-f0-9]{16,40})$/.exec(String(u || "")); return m && m[1]; };
async function dropImages(urls) {
  const r = module.exports.getClient();
  for (const id of new Set((urls || []).map(imgIdFromUrl).filter(Boolean))) {
    const buf = await r.getBuffer(K.img(id));
    if (buf && (await r.del(K.img(id)))) await release(buf.length);
  }
}

module.exports = {
  getClient, getSub, K, NS, URL, waitForChange, withLock, getCampaign, saveCampaign, bump, Busy, Full,
  sniff, decodeDataUrl, putImage, dropImages, imgIdFromUrl, BACKUP_KEEP, reserve, release, used, STORAGE_CAP,
};
