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
//   GET  ?op=export[&backup=n]         GM backup file
//   POST ?op=action | upload | backups | restore | packstart | packadd | packdone | packdelete

const crypto = require("crypto");
const G = require("./_holotable-game.js");
const S = require("./_holotable-store.js");

const GAME = "main";
const POLL_MS = 8000;
const ONLINE_S = 30;
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_PACK_ITEMS = 3000;
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
async function gameWasLost() {
  const r = S.getClient();
  return !!(await r.get(S.K.ver(GAME))) || (await r.llen(S.K.bk(GAME))) > 0;
}
async function loadGame() {
  const camp = await S.getCampaign(GAME);
  if (camp) {
    // tables made before 70 px squares: move the old 50 px default to 70 (saved with the next change)
    if (camp.map && !camp.map.gridV2) { if (camp.map.gridSize === 50) camp.map.gridSize = 70; camp.map.gridV2 = true; }
    return camp;
  }
  if (await gameWasLost()) throw new Missing("The table's save is missing. GM: open the GM tab and restore the latest backup.");
  return G.blankCampaign("HoloTable");
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
// TEMPORARY HOLD (Boofers-Den #55): the site owner hasn't yet OK'd the server calling SW5e's API, so the
// three SW5e lists are switched off: the routes answer 503 before any outbound request is made, and the
// picker buttons are hidden (style.css). The fetch code below is intact. Reverting this commit turns them on.
const SW5E_HOLD = { on: true };
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

// The cached list as a JSON string, or null when it isn't available right now (caller answers 503).
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
    await r.set(key, raw, "EX", 7 * 24 * 3600);
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

async function onlineList(camp) {
  const h = await S.getClient().hgetall(S.K.on(GAME));
  const t = nowS();
  const parse = (v) => { try { return JSON.parse(v); } catch { return {}; } };
  return Object.entries(h || {}).map(([id, v]) => [id, parse(v)]).filter(([, p]) => t - (+p.t || 0) < ONLINE_S)
    .map(([id, p]) => ({ clientId: id, name: (camp.players[id] && camp.players[id].name) || String(p.name || "Player").slice(0, 40), gm: p.role === "gm" }));
}

// mark this person online; bump the game if someone arrived or left so everyone's list updates
async function touchPresence(ses) {
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
  const gm = ses.role === "gm";

  if (q.img || q.a) { // images are immutable (a new upload gets a new id); cached in this browser only
    let key;
    if (q.img && /^[a-f0-9]{16,40}$/.test(q.img)) key = S.K.img(q.img);
    else if (q.a && /^[a-z0-9-]{3,60}\.\d{1,5}$/.test(q.a)) { const [id, n] = q.a.split("."); key = S.K.asset(id, n); }
    if (!key) return fail(res, 400, "bad image id");
    const buf = await r.getBuffer(key);
    if (!buf) return fail(res, 404, "image not found");
    res.setHeader("Content-Type", S.sniff(buf) || "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    return res.status(200).send(buf);
  }

  res.setHeader("Cache-Control", "no-store");
  const op = q.op;

  if (op === "me") return res.status(200).json({ role: ses.role, name: ses.name, you: ses.pid });

  if (op === "poll") {
    if (!(await r.get(S.K.ver(GAME))) && !(await gameWasLost())) { // first visit ever: create the game
      await S.withLock(GAME, async () => { if (!(await S.getCampaign(GAME)) && !(await gameWasLost())) await S.saveCampaign(G.blankCampaign("HoloTable")); });
    }
    await touchPresence(ses);
    const deadline = Date.now() + Math.min(POLL_MS, +q.wait || POLL_MS);
    for (;;) {
      const [v, lib] = await r.mget(S.K.ver(GAME), S.K.libver());
      if (String(v || 0) !== String(q.v || "")) {
        let camp, missing = false;
        try { camp = await loadGame(); } catch (e) { if (!(e instanceof Missing)) throw e; camp = G.blankCampaign("HoloTable"); missing = true; }
        if (!camp.players[ses.pid]) camp.players[ses.pid] = { name: ses.name, role: ses.role }; // shown before their first save
        const state = G.viewFor(camp, ses.pid, gm, await onlineList(camp));
        if (missing) state.missing = true;
        return res.status(200).json({ v: String(v || 0), lib: String(lib || 0), state });
      }
      const left = deadline - Date.now();
      if (left <= 0) return res.status(200).json({ v: String(v || 0), lib: String(lib || 0), same: true });
      await S.waitForChange(GAME, Math.min(left, 2500));
    }
  }

  if (op === "powers" || op === "equipment") {
    if (SW5E_HOLD.on) return fail(res, 503, "The SW5e lists aren't switched on yet: they're waiting for the site owner's OK. Use “custom” to add it by hand for now.");
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

  if (op === "export") {
    if (!gm) return fail(res, 403, "GM only");
    let camp = await loadGame();
    if (q.backup !== undefined) {
      const raw = await r.lindex(S.K.bk(GAME), Math.max(0, +q.backup | 0));
      if (!raw) return fail(res, 404, "no such backup");
      camp = JSON.parse(raw);
    }
    // carry the game's own uploaded images inside the file so a restore is complete
    const images = {};
    const ids = new Set([...JSON.stringify(camp).matchAll(/\/api\/holotable\?img=([a-f0-9]{16,40})/g)].map((x) => x[1]));
    for (const id of ids) { const b = await r.getBuffer(S.K.img(id)); if (b) images[id] = b.toString("base64"); }
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
  const gm = ses.role === "gm";
  if (!gm && (op === "restore" || op === "backups" || String(op).startsWith("pack"))) return fail(res, 403, "GM only");

  if (op === "action") {
    let result, drop;
    const err = await S.withLock(GAME, async () => {
      const camp = await loadGame();
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
      // an image is only deleted when nothing still shows it (another scene, a sheet, a handout, the map)
      if (drop && drop.length) { const json = JSON.stringify(camp); drop = drop.filter((u) => u && !json.includes(u)); }
      return null;
    });
    if (err) return fail(res, ...err);
    if (drop && drop.length) await S.dropImages(drop);
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
        const camp = await loadGame();
        const ch = camp.characters[b.charId];
        if (!ch) return [404, "No such character."];
        if (!(gm || ch.owner === ses.pid)) return [403, "You can only change photos for your own characters."];
        ({ url } = await S.putImage(buf));
        old = ch[kind];
        ch[kind] = url;
        await S.saveCampaign(camp);
        return null;
      });
      if (err) return fail(res, ...err);
      if (old) await S.dropImages([old]);
      return res.status(200).json({ url });
    }
    const { url } = await S.putImage(buf);
    return res.status(200).json({ url });
  }

  if (op === "backups") {
    const camp = await loadGame();
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
      if (!/^[a-f0-9]{16,40}$/.test(id) || (await r.exists(S.K.img(id)))) continue;
      const buf = Buffer.from(String(data), "base64");
      if (S.sniff(buf) && buf.length <= MAX_IMAGE) await S.putImage(buf, id);
    }
    await S.withLock(GAME, async () => {
      const cur = await S.getCampaign(GAME);
      if (cur) { await r.lpush(S.K.bk(GAME), JSON.stringify(cur)); await r.ltrim(S.K.bk(GAME), 0, S.BACKUP_KEEP - 1); }
      const g = G.blankCampaign(file.name);
      for (const k of ["name", "players", "chat", "initiative", "map", "notes", "handouts", "levelUps", "created"]) if (file[k] !== undefined) g[k] = file[k];
      // everything coming back in goes through the same checks as a live edit
      g.characters = {};
      for (const [id, ch] of Object.entries(file.characters).slice(0, 60)) {
        if (!/^[a-z0-9]{6,20}$/.test(id) || !ch || typeof ch !== "object") continue;
        g.characters[id] = Object.assign(G.cleanChar(Object.assign({}, ch, { id })), { owner: String(ch.owner || "").slice(0, 40) });
      }
      g.players = Object.fromEntries(Object.entries(g.players || {}).slice(0, 100).map(([id, p]) => [String(id).slice(0, 40), { name: String((p && p.name) || "Player").slice(0, 40) }]));
      G.cleanGame(g);
      g.lastBackup = 0;
      G.addChat(g, { system: true, text: "The table was restored from a backup." });
      await S.saveCampaign(g);
    });
    return res.status(200).json({ ok: true });
  }

  // ---- asset library (GM only; shared by the whole table)
  if (op === "packstart") {
    for (const raw of Object.values((await r.hgetall(S.K.packs())) || {})) {
      try {
        const p = JSON.parse(raw);
        if (!p.done && nowS() - (p.added || 0) > 3600) await removePack(p.id, JSON.parse((await r.get(S.K.pack(p.id))) || "[]").length, p.bytes);
      } catch { /* skip */ }
    }
    const name = String(b.name || "Asset pack").slice(0, 80);
    const id = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pack") + "-" + crypto.randomBytes(3).toString("hex");
    const incoming = Math.max(0, +b.bytes || 0);
    if ((await S.used()) + incoming > S.STORAGE_CAP) return fail(res, 413, `Not enough room: ${Math.round((await S.used()) / 1048576)} of ${Math.round(S.STORAGE_CAP / 1048576)} MB used. Delete a pack first.`);
    await r.hset(S.K.packs(), id, JSON.stringify({ id, name, author: String(b.author || "").slice(0, 80), count: 0, bytes: 0, done: false, added: nowS() }));
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
        // one round trip for the whole batch: sending images one by one can run past the
        // function time limit when the database is a few milliseconds away
        const pl = r.pipeline();
        keep.forEach(({ buf }, i) => pl.set(S.K.asset(id, list.length + i), buf));
        const results = (await pl.exec()) || [];
        const failed = results.find(([err]) => err);
        if (failed) { // e.g. the database refused writes because it's full: don't leave half a pack behind
          await S.release(bytes);
          await r.del(...keep.map((_, i) => S.K.asset(id, list.length + i)));
          await removePack(id, list.length, summary.bytes);
          throw failed[0];
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

async function removePack(id, count, bytes) {
  const r = S.getClient();
  for (let i = 0; i < count; i += 200) await r.del(...Array.from({ length: Math.min(200, count - i) }, (_, j) => S.K.asset(id, i + j)));
  await r.del(S.K.pack(id));
  await r.hdel(S.K.packs(), id);
  await S.release(bytes || 0);
  await r.incr(S.K.libver());
}

// ---------------------------------------------------------------- entry point
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
  try {
    await S.withLock(GAME, async () => {
      const camp = await loadGame();
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
    if (e instanceof Missing) return fail(res, 409, e.message);
    if (/\bOOM\b/.test(String(e && e.message))) return fail(res, 507, "The database is full, so that change wasn't saved. Delete an asset pack or old images, or ask the site owner to check the database plan.");
    if (e instanceof SyntaxError) return fail(res, 400, "bad JSON");
    console.error("holotable:", e && e.message);
    return fail(res, 500, "Something went wrong on the server.");
  }
};
module.exports.SW5E_HOLD = SW5E_HOLD;   // tests turn the hold off to keep exercising the fetch code underneath (#55)
