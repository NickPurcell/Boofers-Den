// HoloTable (jpesus's Star Wars 5e table): the game rules on the server. Pure functions, no storage,
// so they are easy to test. Not a route: the underscore keeps Vercel from serving it.
//
// A campaign is one JSON document. applyAction(camp, clientId, isGM, type, payload) changes it in
// place and returns a small result; viewFor() is what one player is allowed to see (the GM sees
// everything, players never get the GM key, GM notes, hidden NPCs or other people's whispers).

const crypto = require("crypto");

const CHAT_LIMIT = 400;
const rid = (n = 10) => crypto.randomBytes(16).toString("hex").slice(0, n);
const now = () => Date.now() / 1000;
const str = (v, max) => String(v == null ? "" : v).slice(0, max);
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Forbidden extends Error {}
class Invalid extends Error {}

// ---------------------------------------------------------------- dice
const TERM = /([+-]?)\s*(?:(\d*)d(\d+)(?:(kh|kl|k|dh|dl)(\d+))?(!)?|(\d+))/iy;

// Roll "2d20kh1+5", "1d8+1d6-2", "4d6dl1", "1d6!". nat = the kept d20 when there is exactly one d20 term.
function rollDice(expr) {
  const src = String(expr || "").replace(/\s+/g, "").toLowerCase();
  if (!src) throw new Invalid("empty dice expression");
  if (src.length > 120) throw new Invalid("dice expression too long");
  let pos = 0, total = 0, nat = null, d20s = 0;
  const parts = [];
  while (pos < src.length) {
    TERM.lastIndex = pos;
    const m = TERM.exec(src);
    if (!m || m.index !== pos || TERM.lastIndex === pos) throw new Invalid(`can't read '${src.slice(pos)}'`);
    pos = TERM.lastIndex;
    const sign = m[1] === "-" ? -1 : 1;
    if (m[7] !== undefined) {
      total += sign * +m[7];
      parts.push((sign < 0 ? "-" : "+") + m[7]);
      continue;
    }
    const n = +(m[2] || 1), sides = +m[3];
    if (n < 1 || n > 100 || sides < 1 || sides > 1000) throw new Invalid("dice out of range");
    const rolls = [];
    for (let i = 0; i < n; i++) {
      let r = crypto.randomInt(1, sides + 1);
      rolls.push(r);
      for (let g = 0; m[6] && r === sides && sides > 1 && g < 20; g++) { r = crypto.randomInt(1, sides + 1); rolls.push(r); }
    }
    let kept = rolls.map((_, i) => i);
    const mode = m[4];
    if (mode) {
      const k = +m[5];
      const order = kept.slice().sort((a, b) => rolls[a] - rolls[b]);
      kept = mode === "kh" || mode === "k" ? order.slice(-k) : mode === "kl" ? order.slice(0, k)
        : mode === "dl" ? order.slice(k) : order.slice(0, order.length - k);
    }
    const keep = new Set(kept);
    const sub = rolls.reduce((a, r, i) => a + (keep.has(i) ? r : 0), 0);
    total += sign * sub;
    const shown = rolls.map((r, i) => (keep.has(i) ? r : `~${r}~`)).join(",");
    parts.push(`${sign < 0 ? "-" : "+"}${n}d${sides}${mode ? mode + m[5] : ""}[${shown}]`);
    if (sides === 20) { d20s++; if (keep.size === 1) nat = rolls[[...keep][0]]; }
  }
  if (d20s !== 1) nat = null;
  return { total, detail: parts.join(" ").replace(/^\+/, ""), nat };
}

// ---------------------------------------------------------------- campaigns
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 5 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join("");
const cleanCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

function blankCampaign(code, name, gmId, gmName) {
  return {
    code, name: str(name, 80) || "Untitled Campaign", created: now(), updated: now(),
    gmId, gmToken: crypto.randomBytes(16).toString("base64url"),
    players: { [gmId]: { name: str(gmName, 40) || "GM" } },
    characters: {}, chat: [],
    initiative: { entries: [], turn: 0, round: 1, active: false },
    map: { bgVersion: 0, bgUrl: null, floor: null, floorScale: 1, gridSize: 50, cols: 24, rows: 16, tokens: [], props: [], showGrid: true },
    notes: "", handouts: [],
  };
}

const isGM = (camp, cid) => !!cid && cid === camp.gmId;
const playerName = (camp, cid) => (camp.players[cid] || {}).name || "Someone";

function addChat(camp, msg) {
  msg.id = msg.id || rid();
  msg.ts = msg.ts || now();
  camp.chat.push(msg);
  if (camp.chat.length > CHAT_LIMIT) camp.chat.splice(0, camp.chat.length - CHAT_LIMIT);
  return msg;
}

// images may come from this site's own store, or any http(s) URL
const IMG_PREFIX = "/api/holotable?";
function validImg(src) {
  src = str(src, 1000);
  return src.startsWith(IMG_PREFIX) || /^https?:\/\//.test(src) ? src : null;
}

function viewFor(camp, cid, online) {
  const gm = isGM(camp, cid);
  const chat = camp.chat.filter((m) => !m.to || gm || m.to.includes(cid) || m.fromId === cid);
  const ini = Object.assign({}, camp.initiative);
  if (!gm) {
    ini.entries = ini.entries.filter((e) => !e.hidden)
      .map((e) => Object.assign({}, e, e.npc ? { hp: null, maxHp: null } : {}));
  }
  const map = Object.assign({}, camp.map);
  if (!gm) map.tokens = map.tokens.filter((t) => !t.hidden);
  return {
    code: camp.code, name: camp.name, gmId: camp.gmId, you: cid, isGM: gm, updated: camp.updated,
    players: camp.players, online: online || [], characters: camp.characters,
    chat: chat.slice(-200), initiative: ini, map,
    notes: gm ? camp.notes : null, gmToken: gm ? camp.gmToken : null,
    handouts: (camp.handouts || []).filter((h) => gm || h.shared),
  };
}

function doRoll(camp, cid, expr, label, charId, priv, kind) {
  const res = rollDice(expr);
  const msg = { from: playerName(camp, cid), fromId: cid, roll: Object.assign({}, res, { expr: str(expr, 120), label: str(label, 120), kind: kind || null }) };
  if (charId && camp.characters[charId]) msg.charName = camp.characters[charId].name;
  if (priv) { msg.to = [...new Set([camp.gmId, cid])]; msg.private = true; }
  addChat(camp, msg);
  return res;
}

const canEditChar = (camp, cid, gm, id) => { const ch = camp.characters[id]; return !ch || gm || ch.owner === cid; };

function sortInit(ini) {
  const cur = ini.entries[ini.turn] && ini.entries[ini.turn].id;
  for (const e of ini.entries) e.init = num(e.init);
  ini.entries.sort((a, b) => (b.init + (b.dexTie || 0)) - (a.init + (a.dexTie || 0)));
  const i = ini.entries.findIndex((e) => e.id === cur);
  ini.turn = i < 0 ? 0 : i;
}

// Returns { result, images: [ids no longer used] } and may throw Forbidden / Invalid.
function applyAction(camp, cid, gm, type, p) {
  p = p || {};
  const chars = camp.characters, ini = camp.initiative, mp = camp.map;
  mp.props = mp.props || [];
  const need = (ok, why = "GM only") => { if (!ok) throw new Forbidden(why); };

  switch (type) {
    // ---- characters
    case "char.save": {
      const ch = p.char;
      if (!ch || typeof ch !== "object" || Array.isArray(ch)) throw new Invalid("bad character");
      if (JSON.stringify(ch).length > 400000) throw new Invalid("character sheet too large");
      const id = /^[a-z0-9]{6,20}$/.test(ch.id || "") ? ch.id : rid(12);
      need(canEditChar(camp, cid, gm, id), "not your character");
      const old = chars[id];
      ch.id = id;
      ch.owner = old ? old.owner : (gm && p.owner && camp.players[p.owner] ? p.owner : cid);
      ch.updated = now();
      for (const k of ["image", "tokenImage"]) if (ch[k] && !validImg(ch[k])) ch[k] = "";
      chars[id] = ch;
      for (const e of ini.entries) if (e.charId === id) { e.name = ch.name || e.name; const hp = ch.hp || {}; e.hp = hp.current; e.maxHp = hp.max; }
      for (const t of mp.tokens) if (t.charId === id) t.name = ch.name || t.name;
      if (!old) addChat(camp, { system: true, text: `${playerName(camp, cid)} brought ${ch.name || "a character"} to the table.` });
      return { id };
    }
    case "char.delete": {
      const ch = chars[p.id];
      if (!ch) return {};
      need(gm || ch.owner === cid, "not your character");
      delete chars[p.id];
      ini.entries = ini.entries.filter((e) => e.charId !== p.id);
      mp.tokens = mp.tokens.filter((t) => t.charId !== p.id);
      addChat(camp, { system: true, text: `${ch.name} left the table.` });
      return { dropImages: [ch.image, ch.tokenImage] };
    }
    case "char.assign": {
      need(gm);
      const ch = chars[p.id];
      if (ch && camp.players[p.owner]) ch.owner = p.owner;
      return {};
    }

    // ---- dice & chat
    case "roll":
      return { roll: doRoll(camp, cid, str(p.expr, 120), p.label, p.charId, !!p.private, p.kind) };
    case "chat": {
      const text = str(p.text, 2000).trim();
      if (!text) return {};
      const low = text.toLowerCase();
      if (/^\/(r|roll) /.test(low)) {
        let expr = text.split(" ").slice(1).join(" "), label = "";
        if (expr.includes("#")) [expr, label] = [expr.slice(0, expr.indexOf("#")), expr.slice(expr.indexOf("#") + 1)];
        doRoll(camp, cid, expr.trim(), label.trim());
        return {};
      }
      if (/^\/(gmr|gr) /.test(low)) { doRoll(camp, cid, text.split(" ").slice(1).join(" ").trim(), "GM roll", null, true); return {}; }
      if (low.startsWith("/w ")) {
        const rest = text.slice(3).trim();
        const names = [...new Set(Object.values(camp.players).map((x) => x.name || ""))].sort((a, b) => b.length - a.length);
        let target = names.find((n) => n && rest.toLowerCase().startsWith(n.toLowerCase()));
        let ids, body;
        if (target) {
          ids = Object.keys(camp.players).filter((id) => (camp.players[id].name || "").toLowerCase() === target.toLowerCase());
          body = rest.slice(target.length);
        } else if (rest.toLowerCase().startsWith("gm ")) { ids = [camp.gmId]; body = rest.slice(3); target = "GM"; }
        else throw new Invalid("No player by that name. Use /w <name> <message>");
        addChat(camp, { from: playerName(camp, cid), fromId: cid, text: body.trim(), to: [...new Set([...ids, cid])], private: true, whisperTo: target });
        return {};
      }
      if (low.startsWith("/me ")) { addChat(camp, { from: playerName(camp, cid), fromId: cid, text: text.slice(4), emote: true }); return {}; }
      if (low.startsWith("/desc ") && gm) { addChat(camp, { from: "Narrator", fromId: cid, text: text.slice(6), narration: true }); return {}; }
      addChat(camp, { from: playerName(camp, cid), fromId: cid, text, as: str(p.as, 80) || null });
      return {};
    }

    // ---- initiative
    case "init.add": {
      const charId = p.charId || null;
      if (charId) need(canEditChar(camp, cid, gm, charId), "not your character"); else need(gm);
      let init = p.init;
      if (init === undefined || init === null || init === "") {
        const bonus = int(p.bonus);
        const expr = p.expr ? str(p.expr, 40) : `1d20${bonus >= 0 ? "+" : ""}${bonus}`;
        init = doRoll(camp, cid, expr, "Initiative: " + str(p.name, 60), charId, !!p.hidden && gm, "init").total;
      }
      let entry = charId && ini.entries.find((e) => e.charId === charId);
      if (!entry) { entry = { id: rid() }; ini.entries.push(entry); }
      const ch = charId ? chars[charId] || {} : {};
      const hp = ch.hp || {};
      Object.assign(entry, {
        name: str(p.name || ch.name || "Combatant", 60), init: num(init), charId, npc: !charId,
        hidden: !!p.hidden && gm, hp: charId ? hp.current : (p.hp ?? null), maxHp: charId ? hp.max : (p.hp ?? null),
        ac: charId ? ch.ac : (p.ac ?? null), dexTie: num(p.bonus) / 100, conditions: entry.conditions || [],
      });
      sortInit(ini);
      return {};
    }
    case "init.update": {
      const e = ini.entries.find((x) => x.id === p.id);
      if (!e) return {};
      need(gm || (e.charId && chars[e.charId] && chars[e.charId].owner === cid));
      const f = p.fields || {};
      for (const k of ["name", "init", "hp", "maxHp", "ac", "conditions", "notes"]) if (k in f) e[k] = f[k];
      if ("hidden" in f && gm) e.hidden = !!f.hidden;
      if ("hp" in f && e.charId && chars[e.charId]) (chars[e.charId].hp = chars[e.charId].hp || {}).current = f.hp;
      if ("init" in f) sortInit(ini);
      return {};
    }
    case "init.remove": case "init.next": case "init.prev": case "init.start": case "init.clear": {
      need(gm);
      const n = ini.entries.length;
      if (type === "init.remove") {
        const i = ini.entries.findIndex((e) => e.id === p.id);
        if (i >= 0) { ini.entries.splice(i, 1); if (i < ini.turn) ini.turn--; ini.turn = clamp(ini.turn, 0, Math.max(0, ini.entries.length - 1)); }
      } else if (type === "init.next" && n) {
        ini.active = true; ini.turn++;
        if (ini.turn >= n) { ini.turn = 0; ini.round++; }
        const cur = ini.entries[ini.turn];
        if (!cur.hidden) addChat(camp, { system: true, text: `Round ${ini.round} - ${cur.name}'s turn.` });
      } else if (type === "init.prev" && n) {
        ini.turn--;
        if (ini.turn < 0) { ini.turn = n - 1; ini.round = Math.max(1, ini.round - 1); }
      } else if (type === "init.start") {
        Object.assign(ini, { active: true, turn: 0, round: 1 });
        addChat(camp, { system: true, text: "Combat begins! Roll initiative." });
      } else if (type === "init.clear") {
        Object.assign(ini, { entries: [], turn: 0, round: 1, active: false });
        addChat(camp, { system: true, text: "Combat has ended." });
      }
      return {};
    }

    // ---- map: tokens
    case "token.move": {
      const t = mp.tokens.find((x) => x.id === p.id);
      if (!t) return {};
      need(gm || t.owner === cid || (t.charId && chars[t.charId] && chars[t.charId].owner === cid), "not your token");
      t.x = clamp(int(p.x, t.x), 0, 400); t.y = clamp(int(p.y, t.y), 0, 400);
      return {};
    }
    case "token.add": {
      const charId = p.charId || null;
      if (charId) {
        need(canEditChar(camp, cid, gm, charId), "not your character");
        if (mp.tokens.some((t) => t.charId === charId)) return {};
      } else need(gm);
      if (mp.tokens.length >= 300) throw new Invalid("too many tokens on this map");
      const ch = charId ? chars[charId] || {} : {};
      mp.tokens.push({
        id: rid(), name: str(p.name || ch.name || "Token", 40), color: str(p.color || ch.color || "#4fc3f7", 20),
        x: clamp(int(p.x, 1), 0, 400), y: clamp(int(p.y, 1), 0, 400), size: clamp(int(p.size, 1), 1, 4),
        charId, owner: cid, hidden: !!p.hidden && gm, img: validImg(p.img),
      });
      return {};
    }
    case "token.remove": case "token.update": {
      const t = mp.tokens.find((x) => x.id === p.id);
      if (!t) return {};
      need(gm || t.owner === cid, "not your token");
      if (type === "token.remove") { mp.tokens.splice(mp.tokens.indexOf(t), 1); return {}; }
      const f = p.fields || {};
      if ("name" in f) t.name = str(f.name, 40);
      if ("color" in f) t.color = str(f.color, 20);
      if ("size" in f) t.size = clamp(int(f.size, 1), 1, 4);
      if ("hidden" in f && gm) t.hidden = !!f.hidden;
      if ("img" in f) t.img = validImg(f.img);
      return {};
    }

    // ---- map: settings, background, floor, props (GM)
    case "map.settings":
      need(gm);
      for (const k of ["gridSize", "cols", "rows"]) if (k in p) mp[k] = clamp(int(p[k], mp[k]), 5, 200);
      if ("showGrid" in p) mp.showGrid = !!p.showGrid;
      return {};
    case "map.bg": { // url is a library image or an image this server stored for us
      need(gm);
      const old = mp.bgUrl;
      mp.bgUrl = validImg(p.url);
      mp.bgVersion = int(mp.bgVersion) + 1;
      return { dropImages: [old] };
    }
    case "map.floor":
      need(gm);
      mp.floor = validImg(p.src);
      mp.floorScale = clamp(num(p.scale, mp.floorScale || 1), 0.1, 8);
      return {};
    case "prop.clear": need(gm); mp.props = []; return {};
    case "prop.add": {
      need(gm);
      const src = validImg(p.src);
      if (!src) throw new Invalid("pick an image from the asset library");
      if (mp.props.length >= 1500) throw new Invalid("too many props on this map");
      const pr = { id: rid(), src, name: str(p.name, 60) };
      for (const [k, d] of [["x", 0], ["y", 0], ["w", 1], ["h", 1], ["rot", 0]]) pr[k] = Math.round(num(p[k], d) * 1000) / 1000;
      mp.props.push(pr);
      return { id: pr.id };
    }
    case "prop.remove": case "prop.update": case "prop.order": {
      need(gm);
      const pr = mp.props.find((x) => x.id === p.id);
      if (!pr) return {};
      if (type === "prop.remove") mp.props.splice(mp.props.indexOf(pr), 1);
      else if (type === "prop.update") {
        for (const [k, v] of Object.entries(p.fields || {})) if (["x", "y", "w", "h", "rot"].includes(k)) pr[k] = Math.round(num(v, pr[k]) * 1000) / 1000;
      } else { mp.props.splice(mp.props.indexOf(pr), 1); p.dir === "back" ? mp.props.unshift(pr) : mp.props.push(pr); }
      return {};
    }

    // ---- GM tools
    case "notes.save": need(gm); camp.notes = str(p.notes, 500000); return { quiet: true };
    case "campaign.rename": need(gm); camp.name = str(p.name, 80) || camp.name; return {};
    case "handout.save": {
      need(gm);
      const h = p.handout || {};
      const clean = { id: /^[a-z0-9]{6,20}$/.test(h.id || "") ? h.id : rid(), title: str(h.title, 200), text: str(h.text, 20000), img: validImg(h.img), shared: !!h.shared };
      camp.handouts = (camp.handouts || []).filter((x) => x.id !== clean.id).concat(clean);
      if (clean.shared && p.announce) addChat(camp, { system: true, text: `New handout: ${clean.title || "Untitled"}` });
      return {};
    }
    case "handout.delete": {
      need(gm);
      const h = (camp.handouts || []).find((x) => x.id === p.id);
      camp.handouts = (camp.handouts || []).filter((x) => x.id !== p.id);
      return { dropImages: [h && h.img] };
    }
    case "player.rename":
      (camp.players[cid] = camp.players[cid] || {}).name = str(p.name, 40) || "Player";
      return {};
    case "chat.clear": need(gm); camp.chat = []; return {};
  }
  throw new Invalid("unknown action " + str(type, 40));
}

module.exports = {
  rollDice, newCode, cleanCode, blankCampaign, isGM, playerName, addChat, viewFor, applyAction, validImg, rid,
  Forbidden, Invalid, IMG_PREFIX,
};
