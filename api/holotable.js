// HoloTable API (jpesus's Star Wars 5e table, page at /sections/jpesus/holotable/).
// One Vercel function, routed by ?op=. Campaigns live in the project's Redis (see _holotable-store.js),
// the rules live in _holotable-game.js.
//
//   GET  ?op=poll&code&clientId&v   long-poll: answers as soon as the campaign changes (or after ~8 s)
//   GET  ?img=<id>                  an uploaded image          GET ?a=<packId>.<n>  an asset-pack image
//   GET  ?op=assets | ?op=pack&id   the shared asset library    GET ?op=export&code&clientId  GM backup file
//   POST ?op=create | join | action | upload | backups | restore | packstart | packadd | packdone | packdelete

const crypto = require("crypto");
const G = require("./_holotable-game.js");
const S = require("./_holotable-store.js");

const POLL_MS = 8000;
const ONLINE_S = 30;
const MAX_PHOTO = 3 * 1024 * 1024;
const MAX_LIBRARY = (+process.env.HOLOTABLE_LIBRARY_MB || 150) * 1024 * 1024;
const MAX_PACK_ITEMS = 3000;

const ipOf = (req) => String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "?").split(",")[0].trim();
const cid = (v) => String(v || "").slice(0, 64);
const nowS = () => Date.now() / 1000;

function fail(res, code, error) { res.status(code).json({ error }); }

async function rateLimit(bucket, max, windowS) {
  const r = S.getClient();
  const n = await r.incr(S.K.rl(bucket));
  if (n === 1) await r.expire(S.K.rl(bucket), windowS);
  return n <= max;
}

async function membership(code, clientId) {
  const camp = await S.getCampaign(code);
  if (!camp) return { error: [404, "No campaign with that code."] };
  if (!clientId || !camp.players[clientId]) return { error: [403, "Join the campaign first."] };
  return { camp, gm: G.isGM(camp, clientId) };
}

async function onlineList(camp) {
  const h = await S.getClient().hgetall(S.K.on(camp.code));
  const t = nowS();
  return Object.entries(h || {}).filter(([, ts]) => t - +ts < ONLINE_S)
    .map(([id]) => ({ clientId: id, name: G.playerName(camp, id), gm: id === camp.gmId }));
}

// mark this client online; bump the campaign if someone arrived or left so everyone's list updates
async function touchPresence(code, clientId) {
  const r = S.getClient(), key = S.K.on(code), t = nowS();
  const h = (await r.hgetall(key)) || {};
  const stale = Object.keys(h).filter((id) => id !== clientId && t - +h[id] >= ONLINE_S);
  const arrived = !h[clientId] || t - +h[clientId] >= ONLINE_S;
  await r.hset(key, clientId, String(t));
  for (const id of stale) await r.hdel(key, id);
  if (arrived || stale.length) await S.bump(code);
}

async function stateFor(code, clientId) {
  const camp = await S.getCampaign(code);
  if (!camp || !camp.players[clientId]) return null;
  return G.viewFor(camp, clientId, await onlineList(camp));
}

// ---------------------------------------------------------------- GET
async function handleGet(req, res, q) {
  const r = S.getClient();

  if (q.img || q.a) { // images are immutable (new upload = new id), so the CDN may cache them forever
    let key;
    if (q.img && /^[a-f0-9]{16,40}$/.test(q.img)) key = S.K.img(q.img);
    else if (q.a && /^[a-z0-9-]{3,60}\.\d{1,5}$/.test(q.a)) { const [id, n] = q.a.split("."); key = S.K.asset(id, n); }
    if (!key) return fail(res, 400, "bad image id");
    const buf = await r.getBuffer(key);
    if (!buf) return fail(res, 404, "image not found");
    res.setHeader("Content-Type", S.sniff(buf) || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    return res.status(200).send(buf);
  }

  res.setHeader("Cache-Control", "no-store");
  const op = q.op;

  if (op === "poll") {
    const code = G.cleanCode(q.code), clientId = cid(q.clientId);
    if (!code || !clientId) return fail(res, 400, "missing code or clientId");
    // every saved campaign has a version; without one there is nothing to watch (and no presence to record)
    if (!(await r.get(S.K.ver(code)))) return fail(res, 404, "No campaign with that code.");
    await touchPresence(code, clientId);
    const deadline = Date.now() + Math.min(POLL_MS, +q.wait || POLL_MS);
    for (;;) {
      const [v, lib] = await r.mget(S.K.ver(code), S.K.libver());
      if (String(v || 0) !== String(q.v || "")) {
        const state = await stateFor(code, clientId);
        if (!state) return fail(res, 403, "Join the campaign first.");
        return res.status(200).json({ v: String(v || 0), lib: String(lib || 0), state });
      }
      const left = deadline - Date.now();
      if (left <= 0) return res.status(200).json({ v: String(v || 0), lib: String(lib || 0), same: true });
      await S.waitForChange(code, Math.min(left, 2500));
    }
  }

  if (op === "assets") {
    const h = (await r.hgetall(S.K.packs())) || {};
    const packs = Object.values(h).map((s) => { try { return JSON.parse(s); } catch { return null; } })
      .filter((p) => p && p.done).sort((a, b) => a.name.localeCompare(b.name));
    return res.status(200).json({ packs, lib: String((await r.get(S.K.libver())) || 0) });
  }

  if (op === "pack") {
    const id = String(q.id || "");
    const raw = /^[a-z0-9-]{3,60}$/.test(id) && (await r.get(S.K.pack(id)));
    if (!raw) return fail(res, 404, "no such pack");
    const list = JSON.parse(raw);
    return res.status(200).json({ id, assets: list.map((a, i) => ({ n: a.n, c: a.c, w: a.w, h: a.h, src: `/api/holotable?a=${id}.${i}` })) });
  }

  if (op === "export") {
    const code = G.cleanCode(q.code), clientId = cid(q.clientId);
    const m = await membership(code, clientId);
    if (m.error) return fail(res, ...m.error);
    if (!m.gm) return fail(res, 403, "GM only");
    let camp = m.camp;
    if (q.backup !== undefined) {
      const raw = await r.lindex(S.K.bk(code), Math.max(0, +q.backup | 0));
      if (!raw) return fail(res, 404, "no such backup");
      camp = JSON.parse(raw);
    }
    // carry the campaign's own uploaded images inside the file so a restore is complete
    const images = {};
    const ids = new Set([...JSON.stringify(camp).matchAll(/\/api\/holotable\?img=([a-f0-9]{16,40})/g)].map((x) => x[1]));
    for (const id of ids) { const b = await r.getBuffer(S.K.img(id)); if (b) images[id] = b.toString("base64"); }
    const out = Object.assign({}, camp, { _format: "holotable-campaign", _images: images });
    const fname = `${String(camp.name || code).replace(/[^\w\- ]/g, "") || code} ${new Date().toISOString().slice(0, 10)}.holotable.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    return res.status(200).send(JSON.stringify(out));
  }

  return fail(res, 404, "unknown op");
}

// ---------------------------------------------------------------- POST
async function handlePost(req, res, q, b) {
  const op = q.op || b.op;
  const clientId = cid(b.clientId);
  if (!clientId) return fail(res, 400, "missing clientId");
  const r = S.getClient();

  if (op === "create") {
    if (!(await rateLimit("create:" + ipOf(req), 20, 3600))) return fail(res, 429, "Too many new campaigns from here, try again later.");
    let code;
    for (let i = 0; i < 20 && !code; i++) { const c = G.newCode(); if (!(await r.exists(S.K.camp(c)))) code = c; }
    if (!code) return fail(res, 503, "Couldn't find a free room code, try again.");
    const camp = G.blankCampaign(code, b.campaignName, clientId, b.playerName);
    G.addChat(camp, { system: true, text: `Campaign "${camp.name}" created. Share code ${code} with your players.` });
    await S.saveCampaign(camp);
    return res.status(200).json({ code, gmToken: camp.gmToken });
  }

  if (op === "join") {
    const code = G.cleanCode(b.code);
    if (!(await rateLimit("join:" + ipOf(req), 120, 600))) return fail(res, 429, "Slow down a little.");
    const out = await S.withLock(code, async () => {
      const camp = await S.getCampaign(code);
      if (!camp) return null;
      // the GM key lets the GM take over from a new browser or device (constant-time compare)
      const tok = String(b.gmToken || "");
      if (tok && tok.length === camp.gmToken.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(camp.gmToken))) camp.gmId = clientId;
      (camp.players[clientId] = camp.players[clientId] || {}).name = String(b.playerName || "").trim().slice(0, 40) || "Player";
      await S.saveCampaign(camp);
      return camp;
    });
    if (!out) return fail(res, 404, "No campaign with that code.");
    return res.status(200).json({ ok: true, code });
  }

  if (op === "action") {
    const code = G.cleanCode(b.code);
    let result, drop;
    const err = await S.withLock(code, async () => {
      const camp = await S.getCampaign(code);
      if (!camp) return [404, "No such campaign."];
      if (!camp.players[clientId]) return [403, "Join the campaign first."];
      try {
        const out = G.applyAction(camp, clientId, G.isGM(camp, clientId), String(b.type || ""), b.payload || {});
        drop = out.dropImages; delete out.dropImages;
        result = out;
      } catch (e) {
        if (e instanceof G.Forbidden) return [403, e.message];
        if (e instanceof G.Invalid) return [400, e.message];
        throw e;
      }
      await S.saveCampaign(camp);
      return null;
    });
    if (err) return fail(res, ...err);
    if (drop) await S.dropImages(drop);
    return res.status(200).json(Object.assign({ ok: true }, result));
  }

  if (op === "upload") { // character photos (owner or GM) and map / handout images (GM)
    const code = G.cleanCode(b.code);
    const m = await membership(code, clientId);
    if (m.error) return fail(res, ...m.error);
    const purpose = b.purpose;
    if (purpose !== "photo" && !m.gm) return fail(res, 403, "GM only");
    const buf = S.decodeDataUrl(b.dataUrl, MAX_PHOTO);
    if (!buf) return fail(res, 400, "Please choose a PNG, JPG, WebP or GIF image under 3 MB.");
    if (!(await rateLimit("upload:" + clientId, 120, 3600))) return fail(res, 429, "Too many uploads, try again later.");
    if (purpose === "photo") {
      const kind = b.kind === "token" ? "tokenImage" : "image";
      let url, old;
      const err = await S.withLock(code, async () => {
        const camp = await S.getCampaign(code);
        const ch = camp && camp.characters[b.charId];
        if (!ch) return [404, "No such character."];
        if (!(G.isGM(camp, clientId) || ch.owner === clientId)) return [403, "You can only change photos for your own characters."];
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
    const code = G.cleanCode(b.code);
    const m = await membership(code, clientId);
    if (m.error) return fail(res, ...m.error);
    if (!m.gm) return fail(res, 403, "GM only");
    const list = await r.lrange(S.K.bk(code), 0, S.BACKUP_KEEP - 1);
    return res.status(200).json({ backups: list.map((raw, i) => { try { return { i, at: JSON.parse(raw).updated }; } catch { return { i, at: null }; } }), updated: m.camp.updated });
  }

  if (op === "restore") {
    if (!(await rateLimit("create:" + ipOf(req), 20, 3600))) return fail(res, 429, "Too many new campaigns from here, try again later.");
    const camp = b.campaign || {};
    if (camp._format !== "holotable-campaign" || typeof camp.characters !== "object") return fail(res, 400, "That isn't a HoloTable campaign backup.");
    const images = camp._images || {};
    delete camp._images; delete camp._format;
    let code = G.cleanCode(camp.code);
    if (!code || (await r.exists(S.K.camp(code)))) {
      code = null;
      for (let i = 0; i < 20 && !code; i++) { const c = G.newCode(); if (!(await r.exists(S.K.camp(c)))) code = c; }
    }
    for (const [id, data] of Object.entries(images)) {
      if (/^[a-f0-9]{16,40}$/.test(id)) { const buf = Buffer.from(String(data), "base64"); if (S.sniff(buf)) await r.set(S.K.img(id), buf, "NX"); }
    }
    const fresh = G.blankCampaign(code, camp.name, clientId, b.playerName);
    const restored = Object.assign(fresh, camp, { code, gmId: clientId, gmToken: fresh.gmToken, lastBackup: 0 });
    restored.players = Object.assign({}, camp.players || {}, { [clientId]: { name: String(b.playerName || "GM").slice(0, 40) } });
    G.addChat(restored, { system: true, text: "Campaign restored from a backup." });
    await S.saveCampaign(restored);
    return res.status(200).json({ code, gmToken: restored.gmToken, name: restored.name });
  }

  // ---- asset library (GM of any campaign may add packs; they are shared by every campaign)
  if (op && op.startsWith("pack")) {
    const m = await membership(G.cleanCode(b.code), clientId);
    if (m.error) return fail(res, ...m.error);
    if (!m.gm) return fail(res, 403, "Only the GM can change the asset library.");

    if (op === "packstart") {
      const name = String(b.name || "Asset pack").slice(0, 80);
      const id = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "pack") + "-" + crypto.randomBytes(3).toString("hex");
      const h = (await r.hgetall(S.K.packs())) || {};
      const used = Object.values(h).reduce((s, x) => { try { return s + (JSON.parse(x).bytes || 0); } catch { return s; } }, 0);
      const incoming = +b.bytes || 0;
      if (used + incoming > MAX_LIBRARY) return fail(res, 413, `The asset library is full (${Math.round(used / 1048576)} of ${Math.round(MAX_LIBRARY / 1048576)} MB used). Delete a pack first.`);
      await r.hset(S.K.packs(), id, JSON.stringify({ id, name, author: String(b.author || "").slice(0, 80), count: 0, bytes: 0, done: false, added: nowS() }));
      await r.set(S.K.pack(id), "[]");
      return res.status(200).json({ packId: id });
    }
    const id = String(b.packId || "");
    const sumRaw = /^[a-z0-9-]{3,60}$/.test(id) && (await r.hget(S.K.packs(), id));
    if (!sumRaw) return fail(res, 404, "no such pack");
    const summary = JSON.parse(sumRaw);

    if (op === "packadd") {
      return S.withLock("pack-" + id, async () => {
        const list = JSON.parse((await r.get(S.K.pack(id))) || "[]");
        let bytes = 0;
        for (const it of Array.isArray(b.items) ? b.items : []) {
          if (list.length >= MAX_PACK_ITEMS) break;
          const buf = Buffer.from(String(it.data || ""), "base64");
          if (!S.sniff(buf) || buf.length > MAX_PHOTO) continue;
          await r.set(S.K.asset(id, list.length), buf);
          list.push({ n: String(it.n || "asset").slice(0, 80), c: String(it.c || "props").slice(0, 20), w: +it.w || null, h: +it.h || null });
          bytes += buf.length;
        }
        if (summary.bytes + bytes > MAX_LIBRARY) return fail(res, 413, "The asset library is full.");
        await r.set(S.K.pack(id), JSON.stringify(list));
        summary.count = list.length; summary.bytes += bytes;
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
      return res.status(200).json({ ok: true, pack: summary });
    }
    if (op === "packdelete") {
      const list = JSON.parse((await r.get(S.K.pack(id))) || "[]");
      for (let i = 0; i < list.length; i += 200) await r.del(...list.slice(i, i + 200).map((_, j) => S.K.asset(id, i + j)));
      await r.del(S.K.pack(id));
      await r.hdel(S.K.packs(), id);
      await r.incr(S.K.libver());
      return res.status(200).json({ ok: true });
    }
  }
  return fail(res, 404, "unknown op");
}

module.exports = async function handler(req, res) {
  if (!S.URL) return fail(res, 500, "Storage is not configured (no REDIS_URL).");
  const q = req.query || {};
  try {
    if (req.method === "GET") return await handleGet(req, res, q);
    if (req.method === "POST") {
      const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
      return await handlePost(req, res, q, b);
    }
    res.setHeader("Allow", "GET, POST");
    return fail(res, 405, "method not allowed");
  } catch (e) {
    if (e instanceof S.Busy) return fail(res, 503, e.message);
    if (e instanceof SyntaxError) return fail(res, 400, "bad JSON");
    console.error("holotable:", e);
    return fail(res, 500, "Something went wrong on the server.");
  }
};
