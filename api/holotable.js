// HoloTable API: jpesus's Star Wars 5e table, page at /sections/jpesus/holotable/.
// One Vercel function, routed by ?op=. One game for the group, behind two passwords set by the
// site owner in Vercel:
//
//   HOLOTABLE_PLAYER_PASSWORD   lets a player in
//   HOLOTABLE_GM_PASSWORD       lets the GM in
//
// If either is unset (or they are the same), every request is refused, so merging before they are
// configured is safe. A correct password is exchanged for a signed, expiring session in an HttpOnly
// cookie; the session carries the person's id and role, and the role decides who is GM. Every read,
// write and image needs a valid session. The game rules live in _holotable-game.js, storage in
// _holotable-store.js.
//
//   POST ?op=login {name, password}   POST ?op=logout   GET ?op=me
//   GET  ?op=poll&v                    long-poll: answers as soon as the game changes (or after ~8 s)
//   GET  ?img=<id> | ?a=<pack>.<n>     images        GET ?op=assets | ?op=pack&id   the asset library
//   GET  ?aud=<id> (byte ranges)       table audio   GET ?op=audios                 the track list
//   GET  ?op=export[&backup=n]         GM backup file
//   GET  ?op=files                     GM: what the file store holds, and what's left in Redis to move
//   POST ?op=action | upload | backups | restore | packstart | packadd | packdone | packdelete
//   POST ?op=audiostart | audiodone | audiodelete | filemove   (GM)
// Files live in the private Blob store (see _holotable-store.js) and are only ever sent through here.

const crypto = require("crypto");
const G = require("./_holotable-game.js");
const S = require("./_holotable-store.js");

// The campaign the table is on (audit 12.9). Every request reads it once and passes it along; "main" is today's
// campaign and the default, so a table that never makes a second campaign works exactly as before.
const CAMP_CODE = /^[a-z0-9]{4,20}$/;
async function liveCode() { const c = await S.getClient().get(S.K.live()); return CAMP_CODE.test(String(c || "")) ? String(c) : "main"; }
const POLL_MS = 8000;
const ONLINE_S = 30;
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_PACK_ITEMS = 3000;
// Table audio: the GM's browser uploads the file straight to the Blob store; it's streamed back in pieces,
// because a Vercel function's response is limited to about 4.5 MB. Tracks uploaded before the store are
// in Redis in 1 MiB parts (AUDIO_PART) until the GM's move.
const AUDIO_PART = 1024 * 1024;
const MAX_AUDIO = 30 * 1024 * 1024;     // one track
const MAX_AUDIO_TRACKS = 60;
const AUDIO_SEND = 4 * AUDIO_PART;      // at most this much per response; browsers ask for the rest by byte range
const AUDIO_ID = /^au[a-f0-9]{12}$/;
const SESSION_S = 30 * 24 * 3600;      // a session lasts 30 days
const COOKIE_S = 180 * 24 * 3600;      // the cookie lingers longer, so logging in again keeps your characters

const playerPw = () => process.env.HOLOTABLE_PLAYER_PASSWORD || "";
const gmPw = () => process.env.HOLOTABLE_GM_PASSWORD || "";
const configured = () => playerPw().length > 0 && gmPw().length > 0 && playerPw() !== gmPw();

const ipOf = (req) => String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "?").split(",")[0].trim();
const nowS = () => Date.now() / 1000;
function fail(res, code, error) { res.status(code).json({ error }); }

// ---------------------------------------------------------------- sessions
// The signing key mixes a random secret that only the server knows (made once, kept at ht:secret)
// with both passwords. Without the secret, a cookie gives no way to test password guesses offline
// or to sign a session; including the passwords means changing either one still signs everybody out.
let KEY = null;
async function loadKey() {
  const r = S.getClient();
  let secret = await r.get(S.K.secret());
  if (!secret) {
    await r.set(S.K.secret(), crypto.randomBytes(32).toString("hex"), "NX");
    secret = await r.get(S.K.secret());
  }
  if (!secret) throw new Error("no signing secret");
  KEY = crypto.createHash("sha256").update("holotable-session-v2\0" + secret + "\0" + gmPw() + "\0" + playerPw()).digest();
}
const signingKey = () => { if (!KEY) throw new Error("signing key not loaded"); return KEY; };
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + crypto.createHmac("sha256", signingKey()).update(body).digest("base64url");
}
function verify(token, allowExpired = false) {
  if (!token || token.length > 800) return null;
  const [body, mac] = String(token).split(".");
  if (!body || !mac) return null;
  const want = crypto.createHmac("sha256", signingKey()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!p || !/^[a-f0-9]{24}$/.test(p.pid) || (p.role !== "gm" && p.role !== "player")) return null;
  if (!allowExpired && !(p.exp > nowS())) return null;
  return p;
}
// constant-time: both sides are hashed to the same length first
const samePassword = (given, actual) => crypto.timingSafeEqual(
  crypto.createHash("sha256").update(String(given)).digest(), crypto.createHash("sha256").update(String(actual)).digest());

function cookieToken(req) {
  const m = /(?:^|;\s*)ht_session=([^;]+)/.exec(String((req.headers && req.headers.cookie) || ""));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(res, token, maxAge) {
  res.setHeader("Set-Cookie", `ht_session=${token}; Path=/api/holotable; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

async function rateLimit(bucket, max, windowS) {
  const r = S.getClient();
  const n = await r.incr(S.K.rl(bucket));
  if (n === 1) await r.expire(S.K.rl(bucket), windowS);
  return n <= max;
}
async function hits(bucket) { return +((await S.getClient().get(S.K.rl(bucket))) || 0); }

// ---------------------------------------------------------------- the game
// If the game is gone but there are signs it existed (a version counter or backups), something
// removed it, e.g. a full Redis evicting keys. Then changes are refused and the GM is offered a
// restore, instead of a blank table being saved over what's left. A true first visit starts fresh.
class Missing extends Error {}
async function gameWasLost(GAME) {
  const r = S.getClient();
  return !!(await r.get(S.K.ver(GAME))) || (await r.llen(S.K.bk(GAME))) > 0;
}
async function loadGame(GAME) {
  const camp = await S.getCampaign(GAME);
  if (camp) {
    camp.code = GAME;   // a save always lands in the campaign it was read from, whatever a stored code says (#208 review)
    // tables made before 70 px squares: move the old 50 px default to 70 (saved with the next change)
    if (camp.map && !camp.map.gridV2) { if (camp.map.gridSize === 50) camp.map.gridSize = 70; camp.map.gridV2 = true; }
    return camp;
  }
  if (await gameWasLost(GAME)) throw new Missing("The table's save is missing. GM: open the GM tab and restore the latest backup.");
  return Object.assign(G.blankCampaign("HoloTable"), { code: GAME });
}

// SW5e lists (force/tech powers, standard gear, enhanced items) come from SW5e's own public API
// (sw5e.com), trimmed to what the pickers and tooltips use. Only the server fetches them (players'
// browsers never contact another site), and every list goes through sw5eList() below, which:
//   - only ever asks one of three fixed addresses; nothing a player sends reaches the URL,
//   - stops reading a reply past a fixed size and keeps at most a fixed number of entries,
//   - lets one request at a time fetch a list (a short SET NX marker); others wait for its result,
//   - remembers a failure for a minute, answering 503 without calling SW5e again,
//   - caches a good list for a week.
// A failure here only ever fails the picker (503), never the game.
const SW5E_API = "https://sw5eapi.azurewebsites.net/api/";
const sw5eText = (v, n) => (v == null || v === "None" || v === "Unknown" ? "" : String(v).split(String.fromCharCode(13)).join("").slice(0, n));
const spaced = (v) => sw5eText(v, 60).replace(/([a-z])([A-Z])/g, "$1 $2");

function buildPowers(data) {
  return data.filter((p) => p && p.name && (p.powerType === "Force" || p.powerType === "Tech")).map((p) => ({
    n: sw5eText(p.name, 80), t: p.powerType === "Tech" ? "tech" : "force", l: Math.max(0, Math.min(9, parseInt(p.level, 10) || 0)),
    a: p.powerType === "Tech" ? "" : ({ Light: "light", Dark: "dark" })[p.forceAlignment] || "universal",
    ct: sw5eText(p.castingPeriodText, 160), r: sw5eText(p.range, 80), d: sw5eText(p.duration, 80), c: !!p.concentration,
    pre: sw5eText(p.prerequisite, 80), src: sw5eText(p.contentSource, 10), desc: sw5eText(p.description, 6000), hl: sw5eText(p.higherLevelDescription, 1500),
  })).sort((a, b) => a.l - b.l || a.n.localeCompare(b.n));
}
function buildEquipment(data) {
  const list = (x) => { try { const v = typeof x === "string" ? JSON.parse(x.replace(/'/g, '"')) : x; return Array.isArray(v) ? v.slice(0, 20).map((p) => sw5eText(p, 60)).filter(Boolean) : []; } catch { return []; } };
  return data.filter((e) => e && e.name).map((e) => {
    const isWeapon = e.equipmentCategory === "Weapon", isArmor = e.equipmentCategory === "Armor";
    const dice = Math.min(99, +e.damageNumberOfDice || 0), die = Math.min(100, +e.damageDieType || 0), mod = Math.max(-99, Math.min(99, +e.damageDieModifier || 0));
    return {
      n: sw5eText(e.name, 80), cat: spaced(e.equipmentCategory) || "Gear", src: sw5eText(e.contentSource, 10),
      cost: Number.isFinite(+e.cost) ? +e.cost : null, wt: sw5eText(e.weight, 12),
      dmg: isWeapon && dice && die ? `${dice}d${die}${mod ? (mod > 0 ? "+" : "") + mod : ""}` : isWeapon && mod ? String(mod) : "",
      dt: isWeapon ? sw5eText(e.damageType, 20).toLowerCase() : "", wc: isWeapon ? spaced(e.weaponClassification) : "",
      props: list(e.properties), ac: isArmor ? sw5eText(e.ac, 40) : "", accl: isArmor ? sw5eText(e.armorClassification, 20) : "",
      stealth: isArmor && String(e.stealthDisadvantage) === "true" || e.stealthDisadvantage === true, str: isArmor ? sw5eText(e.strengthRequirement, 20) : "",
      desc: sw5eText(e.description, 1500),
    };
  }).sort((a, b) => a.cat.localeCompare(b.cat) || a.n.localeCompare(b.n));
}
function buildEnhanced(data) {
  return data.filter((e) => e && e.name && !/^Ship/.test(e.type || "")).map((e) => ({
    n: sw5eText(e.name, 80), cat: spaced(e.type) || "Enhanced item", sub: sw5eText(e.subtype, 40), src: sw5eText(e.contentSource, 10),
    rar: sw5eText(e.searchableRarity, 20), att: !!e.requiresAttunement, pre: e.hasPrerequisite ? sw5eText(e.prerequisite, 120) : "",
    desc: sw5eText(e.text, 2200),
  })).sort((a, b) => a.cat.localeCompare(b.cat) || a.n.localeCompare(b.n));
}

const MB = 1024 * 1024;
// Today's sizes: powers ~0.56 MB / 465 entries, standard gear ~0.5 MB / ~700, enhanced items ~2.7 MB / ~1,900.
const SW5E_LISTS = {
  powers: { path: "power", maxBytes: 3 * MB, maxItems: 1500, build: buildPowers, key: () => S.K.powers() },
  standard: { path: "equipment", maxBytes: 3 * MB, maxItems: 2500, build: buildEquipment, key: () => S.K.equipment("standard") },
  enhanced: { path: "enhancedItem", maxBytes: 8 * MB, maxItems: 6000, build: buildEnhanced, key: () => S.K.equipment("enhanced") },
};
// The other books (species, archetypes, backgrounds, feats, class features, Scum and Villainy creatures,
// rule chapters, starship parts...) are defined in _holotable-sw5e-data.js and fetched the same way.
for (const [name, cfg] of Object.entries(require("./_holotable-sw5e-data.js").LISTS)) {
  SW5E_LISTS[name] = Object.assign({}, cfg, { key: () => S.K.sw5e(cfg.cacheAs || name) });   // cacheAs: a list whose shape changed starts a new cache
}
// All cached SW5e lists together stay under this total (today about 6.3 MB for every book). A list that
// would push the total over it isn't cached: that one picker answers 503, the game is untouched.
const SW5E_TOTAL_MAX = 15 * MB;
// The wider SW5e books (everything served by op=sw5e: species, archetypes, feats, creatures, rule chapters,
// starship parts...) have their own switch, separate from the power and equipment pickers. Set the
// HOLOTABLE_SW5E_BOOKS environment variable to "off" (or flip this) to turn just the books off.
const SW5E_BOOKS = { on: String(process.env.HOLOTABLE_SW5E_BOOKS || "").toLowerCase() !== "off" };
const SW5E_TIMEOUT_MS = 8000;
const SW5E_FAIL_S = 60;          // after a failure, don't call SW5e again for this long
const SW5E_LOCK_MS = 15000;      // the "someone is fetching" marker outlives the fetch timeout

// Read at most `max` bytes of a reply; anything longer is a failure, and the rest is never read.
async function readCapped(resp, max) {
  const declared = +(resp.headers && resp.headers.get && resp.headers.get("content-length"));
  if (declared > max) throw new Error("SW5e reply too large");
  if (resp.body && typeof resp.body.getReader === "function") {
    const reader = resp.body.getReader(), parts = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { try { await reader.cancel(); } catch {} throw new Error("SW5e reply too large"); }
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts).toString("utf8");
  }
  if (typeof resp.text !== "function") throw new Error("unreadable SW5e reply");
  const t = await resp.text();
  if (Buffer.byteLength(t) > max) throw new Error("SW5e reply too large");
  return t;
}

async function fetchSw5e(cfg) {
  const resp = await fetch(SW5E_API + cfg.path, { signal: AbortSignal.timeout(SW5E_TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!resp.ok) { try { await resp.body?.cancel?.(); } catch {} throw new Error("SW5e API " + resp.status); }
  const data = JSON.parse(await readCapped(resp, cfg.maxBytes));
  if (!Array.isArray(data)) throw new Error("unexpected SW5e data");
  if (data.length > cfg.maxItems) throw new Error("SW5e list too long");
  const raw = JSON.stringify(cfg.build(data));
  if (raw.length > cfg.maxBytes) throw new Error("SW5e list too large");
  return raw;
}

// Would caching `bytes` more for list `name` keep every cached SW5e list within SW5E_TOTAL_MAX?
// Sizes are kept in a small hash; entries whose list has since expired are dropped from it.
async function sw5eRoomFor(r, name, bytes) {
  const sizes = (await r.hgetall(S.K.sw5eSizes())) || {};
  let total = bytes;
  for (const [n, b] of Object.entries(sizes)) {
    if (n === name) continue;
    if (SW5E_LISTS[n] && (await r.exists(SW5E_LISTS[n].key()))) total += +b || 0;
    else await r.hdel(S.K.sw5eSizes(), n);
  }
  return total <= SW5E_TOTAL_MAX;
}

// The cached list as a JSON string, or null when it isn't available right now (caller answers 503).
// species name (lower case) -> its senses, built once per instance from the cached species list
let SPECIES_SENSES_MAP = null, SPECIES_SENSES_AT = 0;
async function speciesSenses(r, name) {
  if (!SPECIES_SENSES_MAP || Date.now() - SPECIES_SENSES_AT > 10 * 60 * 1000) {   // rebuilt at most every 10 minutes
    SPECIES_SENSES_MAP = null; SPECIES_SENSES_AT = Date.now();
    const raw = await sw5eList(r, "species").catch(() => null);
    if (!raw) return null;
    let list = []; try { list = JSON.parse(raw); } catch { return null; }
    SPECIES_SENSES_MAP = new Map(list.map((s) => [String(s.n || "").toLowerCase(), globalThis.SW5E.sensesFromTraits(s.traits)]));
  }
  return SPECIES_SENSES_MAP.get(String(name || "").trim().toLowerCase()) || [];
}
// Wretched Hives' downtime activities by key (11.1), from the cached list; rebuilt at most every 10 minutes
let DOWNTIME_MAP = null, DOWNTIME_AT = 0;
async function downtimeTables(r) {
  if (!DOWNTIME_MAP || Date.now() - DOWNTIME_AT > 10 * 60 * 1000) {
    DOWNTIME_MAP = null; DOWNTIME_AT = Date.now();
    const raw = await sw5eList(r, "downtime").catch(() => null);
    if (!raw) return null;
    let list = []; try { list = JSON.parse(raw); } catch { return null; }
    DOWNTIME_MAP = Object.fromEntries(list.filter((a) => a && typeof a.key === "string" && /^[a-z-]{1,30}$/.test(a.key)).map((a) => [a.key, a]));
  }
  return DOWNTIME_MAP;
}
// Sheets made before senses were on the sheet (#129) get their species' senses, once (#92): only where a sheet has a
// species and no senses, never over senses already set (the GM's or a species fill). SW5e's species list is read
// before the game is locked (warmSpeciesFill), never inside the lock: a slow SW5e must not hold the table (review of
// #132). Inside the lock the fill uses only the list already read; if there isn't one, nothing changes and a later
// action tries again. camp.sensesFilled marks it done, and an instance that has seen the mark stops reading the list.
let SPECIES_FILL_SEEN = false;
const needsSenses = (c) => !!(c && c.species && !(Array.isArray(c.senses) && c.senses.length));
async function warmSpeciesFill(r, GAME) {
  if (SPECIES_FILL_SEEN) return;
  const camp = await S.getCampaign(GAME).catch(() => null);   // a peek, unlocked: is there anything to fill at all?
  if (!camp || camp.sensesFilled) { if (camp) SPECIES_FILL_SEEN = true; return; }
  // builds the name -> senses map (null if SW5e is out), waiting at most a second: a cold cache with SW5e slow mustn't
  // hold every action; the read carries on, and a later action finds the map built
  if (Object.values(camp.characters || {}).some(needsSenses)) await Promise.race([speciesSenses(r, "").catch(() => null), new Promise((ok) => setTimeout(ok, 1000))]);
}
function fillSpeciesSenses(camp) {
  if (camp.sensesFilled) { SPECIES_FILL_SEEN = true; return; }
  SPECIES_FILL_SEEN = false;   // a game without the mark (an old backup restored): warm up again before later actions
  const need = Object.values(camp.characters || {}).filter(needsSenses);
  if (need.length && !SPECIES_SENSES_MAP) return;   // the list isn't read yet: try again on a later action
  for (const c of need) {
    const clean = globalThis.SW5E.cleanSenses(SPECIES_SENSES_MAP.get(String(c.species).trim().toLowerCase()) || []);
    if (clean.length) c.senses = clean;
  }
  camp.sensesFilled = true;   // done (or nothing was waiting for it)
  SPECIES_FILL_SEEN = true;
}
async function sw5eList(r, name) {
  const cfg = SW5E_LISTS[name], key = cfg.key(), failKey = S.K.sw5eFail(name), lockKey = S.K.sw5eLock(name);
  let raw = await r.get(key);
  if (raw) return raw;
  if (await r.get(failKey)) return null;
  if (!(await r.set(lockKey, "1", "PX", SW5E_LOCK_MS, "NX"))) {
    // someone else is fetching it: wait for their result instead of calling SW5e too
    for (let waited = 0; waited < SW5E_TIMEOUT_MS + 2000; waited += 400) {
      await new Promise((ok) => setTimeout(ok, 400));
      if ((raw = await r.get(key))) return raw;
      if (await r.get(failKey)) return null;
    }
    return null;
  }
  try {
    raw = await fetchSw5e(cfg);
    const bytes = Buffer.byteLength(raw);
    if (!(await sw5eRoomFor(r, name, bytes))) throw new Error("SW5e caches would go over their total");
    await r.set(key, raw, "EX", 7 * 24 * 3600);
    await r.hset(S.K.sw5eSizes(), name, String(bytes));
    return raw;
  } catch (e) {
    await r.set(failKey, "1", "EX", SW5E_FAIL_S);
    return null;
  } finally {
    await r.del(lockKey);
  }
}

// every uploaded image the table refers to (live map, saved scenes, sheets, handouts)
const imageRefs = (camp) => new Set(JSON.stringify(camp).match(/\/api\/holotable\?img=[a-f0-9]{16,40}/g) || []);

async function onlineList(camp, GAME) {
  const h = await S.getClient().hgetall(S.K.on(GAME));
  const t = nowS();
  const parse = (v) => { try { return JSON.parse(v); } catch { return {}; } };
  return Object.entries(h || {}).map(([id, v]) => [id, parse(v)]).filter(([, p]) => t - (+p.t || 0) < ONLINE_S)
    .map(([id, p]) => ({ clientId: id, name: (camp.players[id] && camp.players[id].name) || String(p.name || "Player").slice(0, 40), gm: p.role === "gm" }));
}

// mark this person online; bump the game if someone arrived or left so everyone's list updates
async function touchPresence(ses, GAME) {
  const r = S.getClient(), key = S.K.on(GAME), t = nowS();
  const h = (await r.hgetall(key)) || {};
  const ts = (id) => { try { return +JSON.parse(h[id]).t || 0; } catch { return 0; } };
  const stale = Object.keys(h).filter((id) => id !== ses.pid && t - ts(id) >= ONLINE_S);
  const arrived = !h[ses.pid] || t - ts(ses.pid) >= ONLINE_S;
  await r.hset(key, ses.pid, JSON.stringify({ t, role: ses.role, name: ses.name }));
  for (const id of stale) await r.hdel(key, id);
  if (arrived || stale.length) await S.bump(GAME);
}

// ---------------------------------------------------------------- GET
async function handleGet(req, res, q, ses) {
  const r = S.getClient();
  const GAME = await liveCode();
  const gm = ses.role === "gm";

  if (q.img || q.a) { // images are immutable (a new upload gets a new id); cached in this browser only
    let buf;
    if (q.img && /^[a-f0-9]{16,40}$/.test(q.img)) buf = await S.readImage(q.img);
    else if (q.a && /^[a-z0-9-]{3,60}\.\d{1,5}$/.test(q.a)) { const [id, n] = q.a.split("."); buf = await readAsset(id, +n); }
    else return fail(res, 400, "bad image id");
    if (!buf) return fail(res, 404, "image not found");
    res.setHeader("Content-Type", S.sniff(buf) || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    return res.status(200).send(buf);
  }

  if (q.aud) { // a table-audio track, in byte ranges (see AUDIO_SEND)
    const id = String(q.aud);
    const raw = AUDIO_ID.test(id) && (await r.hget(S.K.audios(), id));
    const t = raw && JSON.parse(raw);
    if (!t || !t.done) return fail(res, 404, "audio not found");
    let start = 0, end = t.bytes - 1;
    const m = /^bytes=(\d*)-(\d*)$/.exec(String((req.headers && req.headers.range) || ""));
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], t.bytes - 1); } else start = Math.max(0, t.bytes - +m[2]);
    }
    if (start >= t.bytes || start > end) { res.setHeader("Content-Range", `bytes */${t.bytes}`); return fail(res, 416, "range not satisfiable"); }
    end = Math.min(end, start + AUDIO_SEND - 1);
    const body = await readAudio(t, start, end);
    if (!body || body.length !== end - start + 1) return fail(res, 404, "audio not found");
    res.setHeader("Content-Type", t.type);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Range", `bytes ${start}-${end}/${t.bytes}`);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    return res.status(206).send(body);
  }

  res.setHeader("Cache-Control", "no-store");
  const op = q.op;

  if (op === "me") return res.status(200).json({ role: ses.role, name: ses.name, you: ses.pid });

  if (op === "poll") {
    if (!(await r.get(S.K.ver(GAME))) && !(await gameWasLost(GAME))) { // first visit ever: create the game
      await S.withLock(GAME, async () => { if (!(await S.getCampaign(GAME)) && !(await gameWasLost(GAME))) await S.saveCampaign(Object.assign(G.blankCampaign("HoloTable"), { code: GAME })); });
    }
    await touchPresence(ses, GAME);
    const deadline = Date.now() + Math.min(POLL_MS, +q.wait || POLL_MS);
    // the version a page holds names its campaign too (12.9), so a switch is always a change; "main" keeps plain numbers
    const tag = (n) => (GAME === "main" ? String(n || 0) : `${GAME}:${n || 0}`);
    for (;;) {
      const [v, lib] = await r.mget(S.K.ver(GAME), S.K.libver());
      if (tag(v) !== String(q.v || "")) {
        let camp, missing = false;
        try { camp = await loadGame(GAME); } catch (e) { if (!(e instanceof Missing)) throw e; camp = Object.assign(G.blankCampaign("HoloTable"), { code: GAME }); missing = true; }
        if (!camp.players[ses.pid]) camp.players[ses.pid] = { name: ses.name, role: ses.role }; // shown before their first save
        const state = G.viewFor(camp, ses.pid, gm, await onlineList(camp, GAME));
        if (missing) state.missing = true;
        state.sw5eBooks = SW5E_BOOKS.on;
        return res.status(200).json({ v: tag(v), lib: String(lib || 0), state });
      }
      const left = deadline - Date.now();
      if (left <= 0) return res.status(200).json({ v: tag(v), lib: String(lib || 0), same: true });
      await S.waitForChange(GAME, Math.min(left, 2500));
      if ((await liveCode()) !== GAME) return res.status(200).json({ v: "switch", lib: String(lib || 0), same: true });   // 12.9: the table moved; ask again
    }
  }

  if (op === "powers" || op === "equipment") {
    // "powers": every SW5e force and tech power, for the "+ force power" / "+ tech power" pickers.
    // "equipment": SW5e gear for the "+ from SW5e" picker, ?set=standard or ?set=enhanced.
    const name = op === "powers" ? "powers" : q.set === "enhanced" ? "enhanced" : "standard";
    const raw = await sw5eList(r, name);
    if (!raw) return fail(res, 503, op === "powers"
      ? "Couldn't reach the SW5e power list right now. Try again in a minute, or add the power by hand."
      : "Couldn't reach the SW5e equipment list right now. Try again in a minute, or add the item by hand.");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).send(raw);
  }

  if (op === "sw5e") { // ?list=<name>: one of the fixed lists above, nothing else
    const name = String(q.list || "");
    if (!Object.prototype.hasOwnProperty.call(SW5E_LISTS, name) || ["powers", "standard", "enhanced"].includes(name)) return fail(res, 404, "No such SW5e list.");
    if (!SW5E_BOOKS.on) return fail(res, 503, "The SW5e books aren't switched on for this table.");
    // creature stat blocks are the GM's to share (audit 9.17): with the GM's switch on, a player isn't sent them
    if (name === "monsters" && !gm && (await loadGame(GAME).catch(() => ({}))).statBlocksHidden) return fail(res, 403, "The GM keeps creature stat blocks to themselves at this table.");
    const raw = await sw5eList(r, name);
    if (!raw) return fail(res, 503, "Couldn't reach SW5e for that list right now. Try again in a minute.");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).send(raw);
  }

  if (op === "audios") { // the GM's uploaded tracks
    const list = Object.values((await r.hgetall(S.K.audios())) || {}).map((s) => { try { return JSON.parse(s); } catch { return null; } })
      .filter((t) => t && t.done).map((t) => ({ id: t.id, name: t.name, bytes: t.bytes, type: t.type, added: t.added }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ tracks: list, used: await S.used(), cap: S.STORAGE_CAP, maxTrack: MAX_AUDIO });
  }

  if (op === "assets") {
    const h = (await r.hgetall(S.K.packs())) || {};
    const packs = Object.values(h).map((s) => { try { return JSON.parse(s); } catch { return null; } })
      .filter((p) => p && p.done).map((p) => ({ id: p.id, name: p.name, author: p.author, count: p.count, bytes: p.bytes, categories: p.categories }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ packs, lib: String((await r.get(S.K.libver())) || 0), used: await S.used(), cap: S.STORAGE_CAP });
  }

  if (op === "pack") {
    const id = String(q.id || "");
    const raw = /^[a-z0-9-]{3,60}$/.test(id) && (await r.get(S.K.pack(id)));
    if (!raw) return fail(res, 404, "no such pack");
    const list = JSON.parse(raw);
    return res.status(200).json({ id, assets: list.map((a, i) => ({ n: a.n, c: a.c, w: a.w, h: a.h, src: `/api/holotable?a=${id}.${i}` })) });
  }

  if (op === "files") { // GM: what the store holds, what the table counts, and what's still waiting in Redis to be moved
    if (!gm) return fail(res, 403, "GM only");
    return res.status(200).json(await storageReport());
  }

  if (op === "campaigns") {   // the GM's campaigns (12.9): which is live, and each one's name and size
    if (!gm) return fail(res, 403, "GM only");
    const extra = (await r.hgetall(S.K.camps())) || {};
    const list = [];
    for (const code of ["main", ...Object.keys(extra).filter((c) => CAMP_CODE.test(c) && c !== "main")]) {
      const raw = await r.get(S.K.camp(code));
      let name = "HoloTable"; try { name = (JSON.parse(raw || "{}").name) || JSON.parse(extra[code] || "{}").name || name; } catch { /* the name stays */ }
      list.push({ code, name: String(name).slice(0, 80), bytes: raw ? raw.length : 0, live: code === GAME });
    }
    return res.status(200).json({ live: GAME, list, max: MAX_CAMPAIGNS });
  }

  if (op === "history") {   // the record of one sheet's changes (audit 12.5), the GM's, read only when opened
    if (!gm) return fail(res, 403, "GM only");
    const camp = await loadGame(GAME), id = String(q.char || "");
    const log = Object.prototype.hasOwnProperty.call(camp.sheetLog || {}, id) ? camp.sheetLog[id] : [];
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ log });
  }

  if (op === "chatlog") {   // a log of play (audit 12.4): the whole chat the table keeps, as text, for the GM
    if (!gm) return fail(res, 403, "GM only");
    const camp = await loadGame(GAME);
    const t = (ts) => new Date((+ts || 0) * 1000).toISOString().replace("T", " ").slice(0, 16);
    const line = (m) => {
      const who = m.system ? "" : `${m.charName ? m.charName + " (" + (m.from || "") + ")" : m.from || ""}${m.to ? " → " + (m.private ? "GM/private" : "whisper") : ""}: `;
      const body = m.roll ? `${m.roll.label || "roll"} = ${m.roll.total} [${m.roll.expr || ""} → ${m.roll.detail || ""}]` : String(m.text || "");
      return `[${t(m.ts)}] ${who}${body}`.replace(/\r?\n/g, " / ");
    };
    const text = `${camp.name || "HoloTable"} — chat log, ${camp.chat.length} messages, downloaded ${t(Date.now() / 1000)} UTC\n\n` + camp.chat.map(line).join("\n") + "\n";
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="holotable-chat-${new Date().toISOString().slice(0, 10)}.txt"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(text);
  }

  if (op === "export") {
    if (!gm) return fail(res, 403, "GM only");
    let camp = await loadGame(GAME);
    if (q.backup !== undefined) {
      const raw = await r.lindex(S.K.bk(GAME), Math.max(0, +q.backup | 0));
      if (!raw) return fail(res, 404, "no such backup");
      camp = JSON.parse(raw);
    }
    // carry the game's own uploaded images inside the file so a restore is complete
    const images = {};
    const ids = new Set([...JSON.stringify(camp).matchAll(/\/api\/holotable\?img=([a-f0-9]{16,40})/g)].map((x) => x[1]));
    for (const id of ids) { const b = await S.readImage(id); if (b) images[id] = b.toString("base64"); }
    const out = Object.assign({}, camp, { _format: "holotable-campaign", _images: images });
    const fname = `${String(camp.name || "HoloTable").replace(/[^\w\- ]/g, "") || "HoloTable"} ${new Date().toISOString().slice(0, 10)}.holotable.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    return res.status(200).send(JSON.stringify(out));
  }

  return fail(res, 404, "unknown op");
}

// ---------------------------------------------------------------- POST
async function handlePost(req, res, q, b, ses) {
  const op = q.op;
  const r = S.getClient();
  const GAME = await liveCode();
  if (op === "campaign") return campaignOp(res, b || {}, ses, GAME);
  const gm = ses.role === "gm";
  if (!gm && (op === "restore" || op === "backups" || op === "filemove" || String(op).startsWith("pack") || String(op).startsWith("audio"))) return fail(res, 403, "GM only");

  if (op === "action") {
    let result, drop;
    // a player choosing a species gets that species' senses, looked up here from SW5e's list (the client can't set them)
    if (!gm && String(b.type || "") === "char.save" && b.payload && b.payload.char && b.payload.char.species) {
      const ss = await speciesSenses(r, b.payload.char.species);
      if (ss) b.payload = Object.assign({}, b.payload, { [G.SPECIES_SENSES]: ss });
    }
    // rolling a downtime activity (11.1): its tables, from SW5e's Wretched Hives, read here, before the lock
    if (String(b.type || "") === "downtime.roll" && b.payload) {
      const acts = await downtimeTables(r);
      if (acts) b.payload = Object.assign({}, b.payload, { [G.DOWNTIME_ACTS]: acts });
    }
    await warmSpeciesFill(r, GAME);   // before the lock: SW5e's species list, for the one-time fill below
    const err = await S.withLock(GAME, async () => {
      const camp = await loadGame(GAME);
      fillSpeciesSenses(camp);   // once: species' senses for sheets made before #129, from the list already read
      const pl = camp.players[ses.pid] || (camp.players[ses.pid] = { name: ses.name });
      pl.role = ses.role;
      const before = imageRefs(camp);
      try {
        const out = G.applyAction(camp, ses.pid, gm, String(b.type || ""), b.payload || {});
        drop = [...(out.dropImages || []), ...[...before].filter((u) => !imageRefs(camp).has(u))]; // anything no longer shown anywhere
        delete out.dropImages;
        result = out;
      } catch (e) {
        if (e instanceof G.Forbidden) return [403, e.message];
        if (e instanceof G.Invalid) return [400, e.message];
        throw e;
      }
      await S.saveCampaign(camp);
      // an image is only deleted when nothing still shows it (another scene, a sheet, a handout, the map) and no
      // kept backup does either (#118); dropUnusedImages checks both
      if (drop && drop.length) await S.dropUnusedImages(drop, JSON.stringify(camp), GAME);
      return null;
    });
    if (err) return fail(res, ...err);
    return res.status(200).json(Object.assign({ ok: true }, result));
  }

  if (op === "upload") { // character photos (owner or GM); maps and handout images (GM)
    const purpose = b.purpose;
    if (purpose !== "photo" && !gm) return fail(res, 403, "GM only");
    const buf = S.decodeDataUrl(b.dataUrl, MAX_IMAGE);
    if (!buf) return fail(res, 400, "Please choose a PNG, JPG, WebP or GIF image under 3 MB.");
    if (!(await rateLimit("upload:" + ses.pid, 200, 3600))) return fail(res, 429, "Too many uploads, try again later.");
    if (purpose === "photo") {
      const kind = b.kind === "token" ? "tokenImage" : "image";
      let url, old;
      const err = await S.withLock(GAME, async () => {
        const camp = await loadGame(GAME);
        const ch = G.charById(camp, b.charId);   // own characters only: never an inherited name like "__proto__" (#111)
        if (!ch) return [404, "No such character."];
        if (!(gm || ch.owner === ses.pid)) return [403, "You can only change photos for your own characters."];
        ({ url } = await S.putImage(buf));
        old = ch[kind];
        ch[kind] = url;
        await S.saveCampaign(camp);
        if (old) await S.dropUnusedImages([old], JSON.stringify(camp), GAME);   // still kept if another place or a backup uses it
        return null;
      });
      if (err) return fail(res, ...err);
      return res.status(200).json({ url });
    }
    const { url } = await S.putImage(buf);
    return res.status(200).json({ url });
  }

  if (op === "backups") {
    const camp = await loadGame(GAME);
    const list = await r.lrange(S.K.bk(GAME), 0, S.BACKUP_KEEP - 1);
    return res.status(200).json({ backups: list.map((raw, i) => { try { return { i, at: JSON.parse(raw).updated }; } catch { return { i, at: null }; } }), updated: camp.updated });
  }

  if (op === "restore") { // the GM replaces the game with a backup file; the current game is kept as a backup first
    let file = b.campaign || {};
    if (b.backup !== undefined) {
      const raw = await r.lindex(S.K.bk(GAME), Math.max(0, +b.backup | 0));
      if (!raw) return fail(res, 404, "No such backup.");
      file = Object.assign(JSON.parse(raw), { _format: "holotable-campaign", _images: {} });
    }
    if (file._format !== "holotable-campaign" || !file.characters || typeof file.characters !== "object") return fail(res, 400, "That isn't a HoloTable backup file.");
    const images = file._images || {};
    for (const [id, data] of Object.entries(images).slice(0, 500)) {
      if (!/^[a-f0-9]{16,40}$/.test(id) || (await S.imageExists(id))) continue;
      const buf = Buffer.from(String(data), "base64");
      if (S.sniff(buf) && buf.length <= MAX_IMAGE) await S.putImage(buf, id);
    }
    await S.withLock(GAME, async () => {
      const cur = await S.getCampaign(GAME);
      if (cur) { await r.lpush(S.K.bk(GAME), JSON.stringify(cur)); await r.ltrim(S.K.bk(GAME), 0, S.BACKUP_KEEP - 1); }
      const g = Object.assign(G.blankCampaign(file.name), { code: GAME });   // a restore stays in the campaign it's made in (12.9)
      // every part of the game a backup holds (cleanGame checks each one below). sceneFx is left out on purpose:
      // a restored table shouldn't replay the last scene change's wipe and movements.
      for (const k of ["name", "players", "chat", "initiative", "map", "notes", "handouts", "levelUps", "created",
        "scenes", "activeScene", "ships", "variants", "hpMax", "fight", "sensesFilled",
        // and what came since (each cleaned by cleanGame like the rest): the space map, the stash, the clock, the GM's
        // switches and NPCs, the level undo, factions and rivals
        "space", "stash", "clock", "sheetLock", "statBlocksHidden", "npcs", "levelUndo", "factions", "rivals", "sheetLog"]) if (file[k] !== undefined) g[k] = file[k];
      if (g.sensesFilled !== undefined) g.sensesFilled = g.sensesFilled === true;   // the one-time senses fill (#132): done or not, nothing else
      // everything coming back in goes through the same checks as a live edit
      g.characters = {};
      for (const [id, ch] of Object.entries(file.characters).slice(0, 60)) {
        if (!/^[a-z0-9]{6,20}$/.test(id) || !ch || typeof ch !== "object") continue;
        g.characters[id] = Object.assign(G.cleanChar(Object.assign({}, ch, { id })), { owner: String(ch.owner || "").slice(0, 40) });
      }
      // players keep their name and colour theme; the role always comes from each person's signed session
      const prefs = (p) => {
        const pr = p && p.prefs;
        if (!pr || typeof pr !== "object" || !/^[a-z0-9-]{1,40}$/.test(String(pr.theme || ""))) return undefined;
        const custom = {};
        for (const k of ["bg", "panel", "text", "holo", "amber"]) { const v = G.validColor((pr.custom || {})[k], null); if (v) custom[k] = v; }
        return { theme: pr.theme, custom };
      };
      g.players = Object.fromEntries(Object.entries(g.players || {}).slice(0, 100).map(([id, p]) => [String(id).slice(0, 40),
        Object.assign({ name: String((p && p.name) || "Player").slice(0, 40) }, prefs(p) ? { prefs: prefs(p) } : {})]));
      G.cleanGame(g);
      g.lastBackup = 0;
      G.addChat(g, { system: true, text: "The table was restored from a backup." });
      await S.saveCampaign(g);
    });
    return res.status(200).json({ ok: true });
  }

  // ---- table audio (GM only): start, finish; or delete
  // The browser uploads the file straight to the store, on a URL that only accepts this one file: its
  // pathname, at most its declared size, for 10 minutes. Then audiodone reads back what arrived and
  // checks it before the track is listed. Nothing is served until then, and a file that fails the
  // check, or is never finished, is deleted from the store (sweepAbandoned).
  if (op === "audiostart") {
    await sweepAbandoned();
    if ((await r.hlen(S.K.audios())) >= MAX_AUDIO_TRACKS) return fail(res, 413, `A table can keep up to ${MAX_AUDIO_TRACKS} tracks. Delete one first.`);
    const bytes = Math.floor(+b.bytes || 0);
    if (bytes < 12 || bytes > MAX_AUDIO) return fail(res, 413, `Audio files can be up to ${MAX_AUDIO / 1048576} MB.`);
    if (!S.blobReady()) throw S.noStore();
    try { await S.reserve(bytes); } catch (e) {
      if (!(e instanceof S.Full)) throw e;
      return fail(res, 413, `Not enough room: ${Math.round((await S.used()) / 1048576)} of ${Math.round(S.STORAGE_CAP / 1048576)} MB used. Delete a track or an asset pack first.`);
    }
    const id = "au" + crypto.randomBytes(6).toString("hex");
    const name = String(b.name || "Track").replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 80) || "Track";
    const t = { id, name, bytes, reserved: bytes, blob: true, type: null, done: false, added: nowS() };
    await r.hset(S.K.audios(), id, JSON.stringify(t));
    let put;
    try { put = await uploadUrl(S.P.aud(id), bytes); } catch (e) { await removeAudio(t); throw e; }
    return res.status(200).json({ id, put });
  }
  if (op === "audiodone" || op === "audiodelete") {
    const id = String(b.id || "");
    const raw = AUDIO_ID.test(id) && (await r.hget(S.K.audios(), id));
    if (!raw) return fail(res, 404, "no such track");
    const t = JSON.parse(raw);
    if (op === "audiodelete") { await removeAudio(t); await r.incr(S.K.libver()); return res.status(200).json({ ok: true }); }
    if (t.done) return res.status(200).json({ ok: true, track: { id, name: t.name, bytes: t.bytes, type: t.type } });   // a retried done
    if (!t.blob) return fail(res, 409, "that upload was started before file storage; start it again");
    return S.withLock("audio-" + id, async () => {
      const fresh = JSON.parse((await r.hget(S.K.audios(), id)) || "null");
      if (!fresh) return fail(res, 404, "no such track");
      if (fresh.done) return res.status(200).json({ ok: true, track: { id, name: fresh.name, bytes: fresh.bytes, type: fresh.type } });
      const p = S.P.aud(id);
      let size = -1;
      try { size = (await S.getBlob().head(p)).size; } catch (e) { if (!S.isNotFound(e)) throw e; }
      if (size !== fresh.bytes) { await removeAudio(fresh); return fail(res, 400, "The upload didn't arrive whole. Try again."); }
      const type = S.sniffAudio(await S.readFile(p, [0, 63]));
      if (!type) { await removeAudio(fresh); return fail(res, 415, "That isn't an audio file HoloTable can play (MP3, OGG, WAV, FLAC, M4A or WebM)."); }
      // list it, and move its reservation onto the listing (removing the track gives the bytes back from there)
      await r.hset(S.K.files(), p, JSON.stringify({ b: size, t: type, at: Math.floor(nowS()) }));
      Object.assign(fresh, { type, done: true, reserved: 0 });
      await r.hset(S.K.audios(), id, JSON.stringify(fresh));
      await r.incr(S.K.libver());
      return res.status(200).json({ ok: true, track: { id, name: fresh.name, bytes: fresh.bytes, type } });
    });
  }

  // ---- moving files uploaded before the store out of Redis (GM). Each call moves what fits in a few
  // seconds and says whether more is left; the GM tab calls again until nothing is. Safe to stop and
  // run again: a file is written to the store and listed before its Redis copy is deleted. It also
  // tidies the store: unfinished uploads and files the table doesn't list are deleted.
  if (op === "filemove") {
    if (!S.blobReady()) throw S.noStore();
    return S.withLock("filemove", async () => {
      const deadline = Date.now() + MOVE_MS;
      await sweepAbandoned();
      const tidied = await tidyStore(deadline);
      return res.status(200).json(Object.assign({ tidied }, await moveFiles(deadline)));
    });
  }

  // ---- asset library (GM only; shared by the whole table)
  if (op === "packstart") {
    if (!S.blobReady()) throw S.noStore();
    await sweepAbandoned();
    const name = String(b.name || "Asset pack").slice(0, 80);
    const id = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pack") + "-" + crypto.randomBytes(3).toString("hex");
    const incoming = Math.max(0, +b.bytes || 0);
    if ((await S.used()) + incoming > S.STORAGE_CAP) return fail(res, 413, `Not enough room: ${Math.round((await S.used()) / 1048576)} of ${Math.round(S.STORAGE_CAP / 1048576)} MB used. Delete a pack first.`);
    await r.hset(S.K.packs(), id, JSON.stringify({ id, name, author: String(b.author || "").slice(0, 80), count: 0, bytes: 0, done: false, blob: true, added: nowS() }));
    await r.set(S.K.pack(id), "[]");
    return res.status(200).json({ packId: id });
  }
  if (op === "packadd" || op === "packdone" || op === "packdelete") {
    const id = String(b.packId || "");
    const sumRaw = /^[a-z0-9-]{3,60}$/.test(id) && (await r.hget(S.K.packs(), id));
    if (!sumRaw) return fail(res, 404, "no such pack");
    const summary = JSON.parse(sumRaw);

    if (op === "packadd") {
      return S.withLock("pack-" + id, async () => {
        // a retried batch (the browser resends after a timeout) is applied only once
        const seq = Number.isInteger(+b.seq) ? +b.seq : null;
        summary.seqs = Array.isArray(summary.seqs) ? summary.seqs : [];
        const list = JSON.parse((await r.get(S.K.pack(id))) || "[]");
        if (seq !== null && summary.seqs.includes(seq)) return res.status(200).json({ ok: true, count: list.length, repeat: true });
        const items = [];
        for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 400)) {
          const buf = Buffer.from(String(it.data || ""), "base64");
          if (S.sniff(buf) && buf.length <= MAX_IMAGE) items.push({ it, buf });
        }
        const room = Math.max(0, MAX_PACK_ITEMS - list.length);
        const keep = items.slice(0, room);
        const bytes = keep.reduce((s, x) => s + x.buf.length, 0);
        try { await S.reserve(bytes); } catch (e) {
          if (!(e instanceof S.Full)) throw e;
          await removePack(id, list.length, summary.bytes);
          return fail(res, 413, "The asset library is full, so this pack wasn't added. Delete a pack (or ask the site owner to raise HOLOTABLE_STORAGE_MB) and try again.");
        }
        // into the store, several at once: one by one can run past the function time limit
        const base = list.length;
        try {
          await eachLimit(keep, 8, ({ buf }, i) => S.putFile(S.P.asset(id, base + i), buf, S.sniff(buf)));
        } catch (e) { // e.g. the store refused a write: don't leave half a pack behind
          const freed = await S.dropFiles(keep.map((_, i) => S.P.asset(id, base + i)));
          await S.release(bytes - freed);
          await removePack(id, list.length, summary.bytes);
          throw e;
        }
        for (const { it, buf } of keep) {
          list.push({ n: String(it.n || "asset").slice(0, 80), c: /^[a-z]{1,20}$/.test(it.c) ? it.c : "props",
            w: Number.isFinite(+it.w) && +it.w > 0 ? Math.round(+it.w) : null, h: Number.isFinite(+it.h) && +it.h > 0 ? Math.round(+it.h) : null });
          summary.bytes += buf.length;
        }
        if (seq !== null) summary.seqs.push(seq);
        await r.set(S.K.pack(id), JSON.stringify(list));
        summary.count = list.length;
        await r.hset(S.K.packs(), id, JSON.stringify(summary));
        return res.status(200).json({ ok: true, count: list.length });
      });
    }
    if (op === "packdone") {
      const list = JSON.parse((await r.get(S.K.pack(id))) || "[]");
      const cats = {};
      for (const a of list) cats[a.c] = (cats[a.c] || 0) + 1;
      Object.assign(summary, { done: true, count: list.length, categories: cats });
      await r.hset(S.K.packs(), id, JSON.stringify(summary));
      await r.incr(S.K.libver());
      return res.status(200).json({ ok: true, pack: { id, name: summary.name, count: summary.count } });
    }
    // packdelete
    const list = JSON.parse((await r.get(S.K.pack(id))) || "[]");
    await removePack(id, list.length, summary.bytes);
    return res.status(200).json({ ok: true });
  }

  return fail(res, 404, "unknown op");
}

// Remove a track and give back its bytes, once: only the call that unlists it does the rest.
async function removeAudio(t) {
  const r = S.getClient();
  if (!(await r.hdel(S.K.audios(), t.id))) return;
  if (t.blob) {
    await S.dropFiles([S.P.aud(t.id)]);   // a finished track: its listing holds its bytes
    if (!t.done) {                        // an unfinished upload: whatever reached the store, and its reservation
      try { await S.getBlob().del(S.P.aud(t.id)); } catch { /* nothing arrived */ }
      await S.release(t.reserved || 0);
    }
    return;
  }
  // uploaded before the store: 1 MiB parts in Redis (and, if the move to the store was copying it just
  // then, that copy too; its bytes are the ones given back here)
  if (t.parts) await r.del(...Array.from({ length: t.parts }, (_, n) => S.K.audioPart(t.id, n)));
  if (await r.hdel(S.K.files(), S.P.aud(t.id))) { try { await S.getBlob().del(S.P.aud(t.id)); } catch { /* gone */ } }
  await S.release(t.got || 0);
}

// Uploads started over an hour ago and never finished (the browser was closed, the network dropped):
// whatever they sent is deleted and the room they reserved is given back.
const ABANDONED_S = 3600;
async function sweepAbandoned() {
  const r = S.getClient();
  for (const raw of Object.values((await r.hgetall(S.K.audios())) || {})) {
    try { const t = JSON.parse(raw); if (!t.done && nowS() - (t.added || 0) > ABANDONED_S) await removeAudio(t); } catch { /* skip */ }
  }
  for (const raw of Object.values((await r.hgetall(S.K.packs())) || {})) {
    try {
      const p = JSON.parse(raw);
      if (!p.done && nowS() - (p.added || 0) > ABANDONED_S) await removePack(p.id, JSON.parse((await r.get(S.K.pack(p.id))) || "[]").length, p.bytes);
    } catch { /* skip */ }
  }
}

// What the store really holds under this table's root (ht/ or htpv/), by kind, and how much of it the
// table doesn't list: left by an upload that failed halfway, waiting for the next tidy-up. Reads at most
// MAX_LIST files' worth of listings.
const MAX_LIST = 20000;
const kindOf = (pathname) => ({ img: "images", pack: "packArt", aud: "audio" })[String(pathname).split("/")[1]] || "other";
async function storeFiles(each, deadline) {
  let cursor, seen = 0;
  do {
    const page = await S.getBlob().list({ prefix: S.NS + "/", cursor, limit: 1000 });
    for (const b of page.blobs || []) await each(b);
    seen += (page.blobs || []).length;
    cursor = page.hasMore ? page.cursor : null;
  } while (cursor && seen < MAX_LIST && (!deadline || Date.now() < deadline));
  return !cursor;   // true when every file was seen
}
async function storageReport() {
  const r = S.getClient();
  const listed = (await r.hgetall(S.K.files())) || {};
  const out = { store: S.blobReady(), used: await S.used(), cap: S.STORAGE_CAP, left: await leftInRedis() };
  const zero = () => ({ images: { n: 0, b: 0 }, packArt: { n: 0, b: 0 }, audio: { n: 0, b: 0 }, other: { n: 0, b: 0 } });
  out.listed = zero();
  for (const [p, raw] of Object.entries(listed)) { const k = out.listed[kindOf(p)]; k.n++; try { k.b += JSON.parse(raw).b || 0; } catch { /* skip */ } }
  if (!out.store) return out;
  out.held = zero(); out.unlisted = { n: 0, b: 0 };
  const pending = await pendingUploads();
  out.complete = await storeFiles(async (b) => {
    const k = out.held[kindOf(b.pathname)]; k.n++; k.b += b.size || 0;
    if (!listed[b.pathname] && !pending.has(b.pathname)) { out.unlisted.n++; out.unlisted.b += b.size || 0; }
  });
  return out;
}
// pathnames of audio uploads still in progress: in the store, deliberately not listed yet
async function pendingUploads() {
  const out = new Set();
  for (const raw of Object.values((await S.getClient().hgetall(S.K.audios())) || {})) {
    try { const t = JSON.parse(raw); if (t.blob && !t.done) out.add(S.P.aud(t.id)); } catch { /* skip */ }
  }
  return out;
}
// Delete store files under this table's root that the table doesn't list and that are over an hour
// old (a file is listed within moments of being written, so an hour-old unlisted one is a leftover).
// They were never counted against the cap, so no bytes are given back. Returns how many went.
async function tidyStore(deadline) {
  const r = S.getClient(), pending = await pendingUploads(), old = Date.now() - ABANDONED_S * 1000;
  const cand = [];
  await storeFiles(async (b) => {
    if (!pending.has(b.pathname) && new Date(b.uploadedAt).getTime() < old) cand.push(b.pathname);
  }, deadline);
  let gone = 0;
  for (let i = 0; i < cand.length && Date.now() < deadline; i += 200) {
    const chunk = cand.slice(i, i + 200), infos = await r.hmget(S.K.files(), ...chunk);
    const drop = chunk.filter((_, j) => !infos[j]);
    if (drop.length) { await S.getBlob().del(drop); gone += drop.length; }
  }
  return gone;
}

// A presigned PUT for one file, for the browser: the URL and the headers to send with it. The store
// itself refuses anything but this pathname, anything over `bytes`, and anything after 10 minutes.
const UPLOAD_S = 10 * 60;
const UPLOAD_TYPE = "application/octet-stream";   // the real type is sniffed from what arrives
async function uploadUrl(pathname, bytes) {
  const B = S.getBlob();
  const validUntil = Date.now() + UPLOAD_S * 1000;
  const token = await B.issueSignedToken({ pathname, operations: ["put"], maximumSizeInBytes: bytes, allowedContentTypes: [UPLOAD_TYPE], validUntil });
  const { presignedUrl } = await B.presignUrl(token, {
    operation: "put", pathname, access: "private", maximumSizeInBytes: bytes, allowedContentTypes: [UPLOAD_TYPE],
    addRandomSuffix: false, allowOverwrite: false, validUntil,
  });
  return {
    url: presignedUrl, method: "PUT",
    // what @vercel/blob's own browser upload sends with a presigned PUT (API version of the pinned SDK)
    headers: { "content-type": UPLOAD_TYPE, "x-content-type": UPLOAD_TYPE, "x-vercel-blob-access": "private", "x-api-version": "13",
      "x-vercel-blob-store-id": String(process.env.BLOB_STORE_ID || "").replace(/^store_/, "") },
  };
}

// A pack's art can be in the store, in Redis (uploaded before the store), or part-way between the two
// while the GM's move runs. The store gives back what it held; whatever's left of the total was in Redis.
async function removePack(id, count, bytes) {
  const r = S.getClient();
  const freed = await S.dropFiles(Array.from({ length: count }, (_, n) => S.P.asset(id, n)));
  for (let i = 0; i < count; i += 200) await r.del(...Array.from({ length: Math.min(200, count - i) }, (_, j) => S.K.asset(id, i + j)));
  await r.del(S.K.pack(id));
  await r.hdel(S.K.packs(), id);
  await S.release(Math.max(0, (bytes || 0) - freed));
  await r.incr(S.K.libver());
}

// Run fn(item, index) over items, at most `limit` at a time; the first failure is thrown once all have settled.
async function eachLimit(items, limit, fn) {
  let next = 0, err = null;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { await fn(items[i], i); } catch (e) { if (!err) err = e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (err) throw err;
}

// ---------------------------------------------------------------- the move out of Redis
const MOVE_MS = 5000;   // stay well inside the function's time limit and the 8 s "filemove" lock
const legacyImageKeys = async (deadline) => {
  const r = S.getClient(), prefix = S.K.img(""), keys = [];
  let cursor = "0";
  do {
    const [next, found] = await r.scan(cursor, "MATCH", prefix + "*", "COUNT", 200);
    keys.push(...found);
    cursor = String(next);
  } while (cursor !== "0" && (!deadline || Date.now() < deadline));
  return keys.map((k) => k.slice(prefix.length)).filter((id) => /^[a-f0-9]{16,40}$/.test(id));
};
const packSummaries = async () => Object.values((await S.getClient().hgetall(S.K.packs())) || {})
  .map((v) => { try { return JSON.parse(v); } catch { return null; } }).filter((x) => x && x.done && !x.blob);
const trackSummaries = async () => Object.values((await S.getClient().hgetall(S.K.audios())) || {})
  .map((v) => { try { return JSON.parse(v); } catch { return null; } }).filter((x) => x && x.done && !x.blob);

async function leftInRedis() {
  return {
    images: (await legacyImageKeys()).length,
    packArt: (await packSummaries()).reduce((n, p) => n + Math.max(0, (p.count || 0) - (p.moved || 0)), 0),
    tracks: (await trackSummaries()).length,
  };
}

// Copy one Redis value into the store, then delete it from Redis. If something deleted it from Redis
// meanwhile (the image stopped being used, the pack was deleted), undo the copy: it's gone on purpose.
async function moveOne(key, pathname, buf, type) {
  const r = S.getClient();
  await S.putFile(pathname, buf, type, true);
  if (!(await r.del(key))) {
    await r.hdel(S.K.files(), pathname);
    await S.getBlob().del(pathname);
    return false;
  }
  return true;
}

async function moveFiles(deadline) {
  const r = S.getClient();
  let moved = 0;
  const time = () => Date.now() < deadline;
  // uploaded images
  for (const id of await legacyImageKeys(deadline)) {
    if (!time()) break;
    const buf = await r.getBuffer(S.K.img(id));
    if (buf && (await moveOne(S.K.img(id), S.P.img(id), buf, S.sniff(buf) || "application/octet-stream"))) moved++;
  }
  // pack art, 40 at a time; the summary remembers how far each pack got
  for (const p of await packSummaries()) {
    let n = p.moved || 0;
    while (n < p.count && time()) {
      const batch = Array.from({ length: Math.min(40, p.count - n) }, (_, j) => n + j);
      await eachLimit(batch, 8, async (i) => {
        const buf = await r.getBuffer(S.K.asset(p.id, i));
        if (buf && (await moveOne(S.K.asset(p.id, i), S.P.asset(p.id, i), buf, S.sniff(buf) || "application/octet-stream"))) moved++;
      });
      n += batch.length;
      await S.withLock("pack-" + p.id, async () => {
        const cur = JSON.parse((await r.hget(S.K.packs(), p.id)) || "null");
        if (cur) { cur.moved = n; if (n >= cur.count) cur.blob = true; await r.hset(S.K.packs(), p.id, JSON.stringify(cur)); }
      });
    }
    if (!time()) break;
  }
  // table audio: one whole track at a time, re-joined from its 1 MiB parts
  for (const t of await trackSummaries()) {
    if (!time()) break;
    const parts = [];
    for (let n = 0; n < t.parts; n++) parts.push(await r.getBuffer(S.K.audioPart(t.id, n)));
    if (parts.some((x) => !x)) continue;   // damaged: leave it where it is, still playable as far as it goes
    const buf = Buffer.concat(parts), p = S.P.aud(t.id);
    await S.putFile(p, buf, t.type, true);
    const ok = await S.withLock("audio-" + t.id, async () => {
      const cur = JSON.parse((await r.hget(S.K.audios(), t.id)) || "null");
      if (!cur) return false;
      Object.assign(cur, { blob: true, reserved: 0 });
      await r.hset(S.K.audios(), t.id, JSON.stringify(cur));
      return true;
    });
    if (!ok) { await r.hdel(S.K.files(), p); await S.getBlob().del(p); continue; }   // deleted meanwhile
    await r.del(...Array.from({ length: t.parts }, (_, n) => S.K.audioPart(t.id, n)));
    moved++;
  }
  const left = await leftInRedis();
  return { moved, left, more: left.images + left.packArt + left.tracks > 0 };
}

// Bytes start..end (inclusive) of a finished track: from the store, or from its 1 MiB parts in Redis if it
// was uploaded before the store and hasn't been moved yet.
async function readAudio(t, start, end) {
  if (t.blob) return S.readFile(S.P.aud(t.id), [start, end]);
  const r = S.getClient(), parts = [];
  for (let n = Math.floor(start / AUDIO_PART); n <= Math.floor(end / AUDIO_PART); n++) {
    const buf = await r.getBuffer(S.K.audioPart(t.id, n));
    if (!buf) return null;
    parts.push(buf);
  }
  const first = Math.floor(start / AUDIO_PART) * AUDIO_PART;
  return Buffer.concat(parts).subarray(start - first, end - first + 1);
}

// Asset n of a pack: from the store, or from Redis for a pack uploaded before the store and not moved yet.
async function readAsset(id, n) {
  if (await S.fileInfo(S.P.asset(id, n))) return S.readFile(S.P.asset(id, n));
  const old = await S.getClient().getBuffer(S.K.asset(id, n));
  if (old) return old;
  return (await S.fileInfo(S.P.asset(id, n))) ? S.readFile(S.P.asset(id, n)) : null;   // moved meanwhile
}

// ---------------------------------------------------------------- entry point
// ---------------------------------------------------------------- more than one campaign (audit 12.9)
// The same two passwords; the GM keeps up to five campaigns and puts the table on one of them. Players only ever get
// the live one (every read goes through liveCode()); the others are read by nobody until the GM switches to them.
const MAX_CAMPAIGNS = 5;
async function campaignOp(res, b, ses, GAME) {
  if (ses.role !== "gm") return fail(res, 403, "GM only");
  const r = S.getClient(), what = String(b.do || ""), code = String(b.code || "");
  const extra = (await r.hgetall(S.K.camps())) || {};
  const exists = (c) => c === "main" || (CAMP_CODE.test(c) && Object.prototype.hasOwnProperty.call(extra, c));
  const name = String(b.name || "").trim().slice(0, 80);
  if (what === "create") {
    if (1 + Object.keys(extra).length >= MAX_CAMPAIGNS) return fail(res, 400, `A table keeps ${MAX_CAMPAIGNS} campaigns at most. Delete one first.`);
    const c = crypto.randomBytes(5).toString("hex");
    await r.hset(S.K.camps(), c, JSON.stringify({ name: name || "New campaign", created: nowS() }));
    await S.withLock(c, async () => { await S.saveCampaign(Object.assign(G.blankCampaign(name || "New campaign"), { code: c })); });
    return res.status(200).json({ code: c });
  }
  if (!exists(code)) return fail(res, 400, "No such campaign.");
  if (what === "switch") {
    if (code === GAME) return res.status(200).json({ live: code });
    const to = await S.getCampaign(code);
    if (code === "main") await r.del(S.K.live()); else await r.set(S.K.live(), code);
    for (const c of [GAME, code]) {   // a line in both, then everyone's next update moves to the new one
      await S.withLock(c, async () => {
        const camp = await S.getCampaign(c);
        if (!camp) return;
        G.addChat(camp, { system: true, text: `📚 The GM put the table on "${(to && to.name) || "a campaign"}".` });
        await S.saveCampaign(camp);
      }).catch(() => {});
    }
    return res.status(200).json({ live: code });
  }
  if (what === "rename") {
    if (!name) return fail(res, 400, "A campaign needs a name.");
    await S.withLock(code, async () => { const camp = await S.getCampaign(code); if (camp) { camp.name = name; await S.saveCampaign(camp); } });
    if (code !== "main") await r.hset(S.K.camps(), code, JSON.stringify(Object.assign(JSON.parse(extra[code] || "{}"), { name })));
    return res.status(200).json({ ok: true });
  }
  if (what === "delete") {
    if (code === GAME) return fail(res, 400, "That's the campaign the table is on. Switch to another first.");
    if (code === "main") return fail(res, 400, "The first campaign stays (it's the table's own). Rename it instead.");
    const texts = [await r.get(S.K.camp(code)), ...(await r.lrange(S.K.bk(code), 0, S.BACKUP_KEEP - 1))].filter(Boolean);
    const urls = [...new Set(texts.join(" ").match(/\/api\/holotable\?img=[a-f0-9]{16,40}/g) || [])];
    await r.del(S.K.camp(code), S.K.ver(code), S.K.bk(code), S.K.on(code), S.K.refs(code));
    await r.hdel(S.K.camps(), code);
    if (urls.length) await S.dropUnusedImages(urls, "", code);   // only what no other campaign (or its backups) uses
    return res.status(200).json({ ok: true });
  }
  return fail(res, 400, "Unknown campaign request.");
}

async function login(req, res, b) {
  const ip = ipOf(req);
  // slow guessing down: 10 wrong passwords per address per 15 minutes
  if ((await hits("loginfail:" + ip)) >= 10) {
    return fail(res, 429, "Too many wrong passwords. Wait a few minutes and try again.");
  }
  const pw = String(b.password || "").slice(0, 200);
  const isGm = samePassword(pw, gmPw()), isPlayer = samePassword(pw, playerPw());
  if (!isGm && !isPlayer) {
    await rateLimit("loginfail:" + ip, 1e9, 900);
    return fail(res, 401, "That password isn't right.");
  }
  const role = isGm ? "gm" : "player";
  const name = String(b.name || "").trim().slice(0, 40) || (isGm ? "GM" : "Player");
  // logging in again from the same browser keeps the same person (and their characters)
  const prev = verify(cookieToken(req), true);
  const pid = prev ? prev.pid : crypto.randomBytes(12).toString("hex");
  setCookie(res, sign({ pid, role, name, exp: Math.floor(nowS() + SESSION_S) }), COOKIE_S);
  const GAME = await liveCode();
  try {
    await S.withLock(GAME, async () => {
      const camp = await loadGame(GAME);
      camp.players[pid] = { name, role };
      await S.saveCampaign(camp);
    });
  } catch (e) { if (!(e instanceof Missing)) throw e; } // signed in; the table shows the restore notice
  return res.status(200).json({ ok: true, role, name });
}

module.exports = async function handler(req, res) {
  if (!configured()) return fail(res, 503, "HoloTable isn't set up yet: the GM and player passwords haven't been configured.");
  if (!S.URL) return fail(res, 503, "Storage is not configured (no REDIS_URL).");
  const q = req.query || {};
  try {
    await loadKey();
    if (req.method === "POST") {
      // a custom header can't be sent cross-site without permission, so other sites can't post as you
      if ((req.headers || {})["x-holotable"] !== "1") return fail(res, 403, "missing X-HoloTable header");
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      if (q.op === "login") return await login(req, res, b);
      if (q.op === "logout") {
        // keep only an expired marker: useless as a session, but signing in again keeps the same person
        const prev = verify(cookieToken(req), true);
        if (prev) setCookie(res, sign({ pid: prev.pid, role: "player", name: prev.name, exp: 0 }), COOKIE_S); else setCookie(res, "", 0);
        return res.status(200).json({ ok: true });
      }
      const ses = verify(cookieToken(req));
      if (!ses) return fail(res, 401, "Please sign in.");
      return await handlePost(req, res, q, b, ses);
    }
    if (req.method === "GET") {
      const ses = verify(cookieToken(req));
      if (!ses) return fail(res, 401, "Please sign in.");
      return await handleGet(req, res, q, ses);
    }
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method not allowed");
  } catch (e) {
    if (e instanceof S.Busy) return fail(res, 503, e.message);
    if (e instanceof S.Full) return fail(res, 413, e.message);
    if (e instanceof S.NoStore) return fail(res, 503, e.message);
    if (S.isBlobError(e)) {   // the file store refused or failed
      console.error("holotable blob:", e && e.message);
      return fail(res, 502, "File storage didn't answer properly, so that wasn't saved. Try again in a moment.");
    }
    if (e instanceof Missing) return fail(res, 409, e.message);
    if (/\bOOM\b/.test(String(e && e.message))) return fail(res, 507, "The database is full, so that change wasn't saved. Delete an asset pack or old images, or ask the site owner to check the database plan.");
    if (e instanceof SyntaxError) return fail(res, 400, "bad JSON");
    console.error("holotable:", e && e.message);
    return fail(res, 500, "Something went wrong on the server.");
  }
};
module.exports.SW5E_BOOKS = SW5E_BOOKS;   // tests switch the books off and on
module.exports.SW5E_TOTAL_MAX = SW5E_TOTAL_MAX;
module.exports.resetSpeciesSenses = () => { SPECIES_SENSES_MAP = null; SPECIES_FILL_SEEN = false; };   // tests: forget the species list read so far
