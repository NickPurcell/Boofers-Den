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
//   ht:audios          hash trackId -> table-audio track summary JSON
//   ht:files           hash pathname -> {b: bytes, t: sniffed type, at} for every file in the Blob store (below)
//   ht:bytes           total bytes of stored images, pack art and audio, checked against the storage cap
//
// The files themselves (uploaded images, pack art, table audio) live in the project's PRIVATE Vercel Blob
// store, not in Redis:
//   ht/img/<id>        an uploaded image (character photo, token, map, handout)
//   ht/pack/<id>/<n>   one asset image of a pack
//   ht/aud/<id>        one table-audio track
// (htpv/... on preview deployments, like the htpv: keys.) The store is private: only these functions can
// read it, so every file still goes out through /api/holotable after the session check, and no store URL
// is ever handed to a browser. Files uploaded before the store existed are still in Redis under
// ht:img:<id>, ht:a:<pack>:<n> and ht:aud:<id>:<n>; they're read from there until the GM moves them
// (op=filemove). A file is in the store when ht:files lists it, and only then.
//
// Nothing here touches Find time to hang's hang:/hang2: keys. The game and files never expire:
// it is meant to be picked up again next session. Size limits: files <= HOLOTABLE_STORAGE_MB
// (default 1000), the game document <= 1.5 MB, and 10 backups of it.

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
  audios: () => `${NS}:audios`,                     // hash id -> table-audio track summary JSON (GM's uploads)
  audioPart: (id, n) => `${NS}:aud:${id}:${n}`,     // one 1 MiB part of a track uploaded before the Blob store, raw bytes
  files: () => `${NS}:files`,                       // hash pathname -> JSON {b, t, at}: what is in the Blob store
  bytes: () => `${NS}:bytes`,
  secret: () => `${NS}:secret`,                 // random session-signing secret, made once; never sent anywhere
  powers: () => `${NS}:powers`,                 // the SW5e power list, fetched from SW5e's own API and cached for a week
  equipment: (set) => `${NS}:equip:${set}`,      // SW5e standard gear / enhanced items, fetched and cached the same way
  sw5e: (name) => `${NS}:sw5e:list:${name}`,     // the other SW5e lists (species, feats, monsters, rules...), cached the same way
  sw5eSizes: () => `${NS}:sw5e:sizes`,          // bytes cached per SW5e list, for the total cap
  sw5eLock: (name) => `${NS}:sw5e:lock:${name}`,  // short marker: one request at a time fetches that SW5e list
  sw5eFail: (name) => `${NS}:sw5e:fail:${name}`,  // set for a minute after a failed fetch, so SW5e isn't called again
};
// pathnames in the Blob store, same production / preview split as the Redis keys
const P = {
  img: (id) => `${NS}/img/${id}`,
  asset: (id, n) => `${NS}/pack/${id}/${n}`,
  aud: (id) => `${NS}/aud/${id}`,
};
const STORAGE_CAP = (+process.env.HOLOTABLE_STORAGE_MB || 1000) * 1024 * 1024;
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
class NoStore extends Error {}   // the Blob store isn't connected to this deployment: no new files can be kept

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
// The audio formats browsers play, by their first bytes (never by the name or type the upload claims).
function sniffAudio(buf) {
  if (!buf || buf.length < 12) return null;
  const s4 = buf.toString("latin1", 0, 4);
  if (buf.toString("latin1", 0, 3) === "ID3") return "audio/mpeg";                     // MP3 with an ID3 tag
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return ((buf[1] >> 1) & 3) === 0 ? "audio/aac" : "audio/mpeg";   // a bare MPEG / ADTS frame
  if (s4 === "OggS") return "audio/ogg";
  if (s4 === "RIFF" && buf.toString("latin1", 8, 12) === "WAVE") return "audio/wav";
  if (s4 === "fLaC") return "audio/flac";
  if (buf.toString("latin1", 4, 8) === "ftyp") return "audio/mp4";                    // M4A / AAC in MP4
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "audio/webm";
  return null;
}

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
// ---- the Blob store
// @vercel/blob is loaded on first use; tests and the dev server swap getBlob for an in-memory fake.
// On Vercel the connected store authenticates by OIDC (BLOB_STORE_ID plus a per-request token).
let blobSdk = null;
function getBlob() { return blobSdk || (blobSdk = require("@vercel/blob")); }
const blobReady = () => !!(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
const noStore = () => new NoStore("File storage isn't connected to this deployment, so uploads are off. The site owner can connect the Blob store in Vercel.");

// @vercel/blob's errors are classes named Blob...Error (BlobNotFoundError, BlobAccessError, ...)
const errName = (e) => String((e && e.constructor && e.constructor.name) || (e && e.name) || "");
const isBlobError = (e) => /^Blob/.test(errName(e));
const isNotFound = (e) => errName(e) === "BlobNotFoundError";
async function fileInfo(pathname) {
  const raw = await module.exports.getClient().hget(K.files(), pathname);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
// Write a file to the store, then list it. The caller has reserved its bytes. Ids are random, so a
// file is never written twice except by the move from Redis, which may retry one it half-finished.
// If the listing can't be written (the database is full), the new file is deleted again rather than
// left in the store uncounted; a retried move keeps its file, since its Redis copy is still there.
async function putFile(pathname, buf, type, overwrite = false) {
  if (!module.exports.blobReady()) throw noStore();
  await module.exports.getBlob().put(pathname, buf, {
    access: "private", contentType: type, addRandomSuffix: false, allowOverwrite: overwrite,
    cacheControlMaxAge: 365 * 24 * 3600, multipart: buf.length > 8 * 1024 * 1024,
  });
  try {
    await module.exports.getClient().hset(K.files(), pathname, JSON.stringify({ b: buf.length, t: type, at: Math.floor(Date.now() / 1000) }));
  } catch (e) {
    if (!overwrite) { try { await module.exports.getBlob().del(pathname); } catch { /* the tidy-up gets it */ } }
    throw e;
  }
}
// Read a listed file, or one byte range of it ([start, end] inclusive), into a Buffer. Responses are at
// most a few MB (images <= 3 MB, audio is sent 4 MiB at a time), so reading it whole is fine.
// null when the store no longer has it.
async function readFile(pathname, range) {
  const got = await module.exports.getBlob().get(pathname, Object.assign({ access: "private" },
    range ? { headers: { Range: `bytes=${range[0]}-${range[1]}` } } : {}));
  if (!got || !got.stream) return null;
  const chunks = [];
  for await (const c of got.stream) chunks.push(Buffer.from(c));
  let buf = Buffer.concat(chunks);
  // a store that ignored the range sends the whole file: cut the range out here. That's correct but slow
  // (a 30 MB track read whole for every 4 MiB piece), so say so in the log, once per instance.
  const ranged = got.headers && typeof got.headers.get === "function" && got.headers.get("content-range");
  if (range && !ranged) {
    if (!rangeWarned) { rangeWarned = true; console.warn("holotable: the file store ignored a byte range; reading whole files to serve audio"); }
    buf = buf.subarray(range[0], range[1] + 1);
  }
  return buf;
}
let rangeWarned = false;
// Unlist first, so nothing serves a file the CDN is still forgetting, then delete it and give back its
// bytes. Returns the bytes given back. Looks up 200 at a time: a pack can have thousands of files.
async function dropFiles(pathnames) {
  const r = module.exports.getClient();
  const all = [...new Set(pathnames)];
  let freed = 0;
  const gone = [];
  for (let i = 0; i < all.length; i += 200) {
    const chunk = all.slice(i, i + 200);
    const infos = await r.hmget(K.files(), ...chunk);
    const found = chunk.filter((_, j) => infos[j]);
    if (!found.length) continue;
    await r.hdel(K.files(), ...found);
    chunk.forEach((p, j) => { if (infos[j]) { try { freed += JSON.parse(infos[j]).b || 0; } catch { /* skip */ } } });
    gone.push(...found);
  }
  for (let i = 0; i < gone.length; i += 100) await module.exports.getBlob().del(gone.slice(i, i + 100));
  await release(freed);
  return freed;
}

// ---- images
async function putImage(buf, id) {
  id = id || crypto.randomBytes(12).toString("hex");
  if (!module.exports.blobReady()) throw noStore();
  await reserve(buf.length);
  try { await putFile(P.img(id), buf, sniff(buf)); } catch (e) { await release(buf.length); throw e; }
  return { id, url: `/api/holotable?img=${id}` };
}
// An image's bytes, from the store, or from Redis if it was uploaded before the store and not moved yet.
async function readImage(id) {
  if (await fileInfo(P.img(id))) return readFile(P.img(id));
  const old = await module.exports.getClient().getBuffer(K.img(id));
  if (old) return old;
  // moved between the two looks: it's in the store now
  return (await fileInfo(P.img(id))) ? readFile(P.img(id)) : null;
}
async function imageExists(id) {
  return !!(await fileInfo(P.img(id))) || !!(await module.exports.getClient().exists(K.img(id)));
}
const imgIdFromUrl = (u) => { const m = /^\/api\/holotable\?img=([a-f0-9]{16,40})$/.exec(String(u || "")); return m && m[1]; };
async function dropImages(urls) {
  const r = module.exports.getClient();
  const ids = [...new Set((urls || []).map(imgIdFromUrl).filter(Boolean))];
  const inStore = [];
  for (const id of ids) {
    if (await fileInfo(P.img(id))) { inStore.push(P.img(id)); continue; }
    const buf = await r.getBuffer(K.img(id));
    if (buf && (await r.del(K.img(id)))) await release(buf.length);
  }
  if (inStore.length) await dropFiles(inStore);
}

module.exports = {
  getClient, getSub, K, P, NS, URL, waitForChange, withLock, getCampaign, saveCampaign, bump, Busy, Full, NoStore,
  sniff, sniffAudio, decodeDataUrl, putImage, readImage, imageExists, dropImages, imgIdFromUrl, BACKUP_KEEP, reserve, release, used, STORAGE_CAP,
  getBlob, blobReady, noStore, fileInfo, putFile, readFile, dropFiles, isBlobError, isNotFound,
};
