// HoloTable (jpesus's Star Wars 5e table): the game rules on the server. Pure functions, no storage,
// so they are easy to test. Not a route: the underscore keeps Vercel from serving it.
//
// The table is one JSON document (one game for the group). applyAction(camp, playerId, isGM, type,
// payload) changes it in place and returns a small result; viewFor() is what one person may see.
// Who is the GM is decided by the caller from the signed session, never from anything in here.
// Players never get GM notes, hidden NPCs, NPC hit points or other people's whispers.

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

// ---------------------------------------------------------------- the game
function blankCampaign(name) {
  return {
    code: "main", name: str(name, 80) || "HoloTable", created: now(), updated: now(),
    players: {}, characters: {}, chat: [],
    initiative: { entries: [], turn: 0, round: 1, active: false },
    map: { bgVersion: 0, bgUrl: null, floor: null, floorScale: 1, gridSize: 70, gridV2: true, cols: 24, rows: 16, tokens: [], props: [], showGrid: true },
    notes: "", handouts: [], levelUps: {},
  };
}

const playerName = (camp, cid) => (camp.players[cid] || {}).name || "Someone";

function addChat(camp, msg) {
  msg.id = msg.id || rid();
  msg.ts = msg.ts || now();
  camp.chat.push(msg);
  if (camp.chat.length > CHAT_LIMIT) camp.chat.splice(0, camp.chat.length - CHAT_LIMIT);
  return msg;
}

// Images may only be ones uploaded to this table (photos, maps, handouts) or asset-pack art, so
// nobody's browser is ever sent to an outside server.
const IMG_PREFIX = "/api/holotable?";
const IMG_RE = /^\/api\/holotable\?(img=[a-f0-9]{16,40}|a=[a-z0-9-]{3,60}\.\d{1,5})$/;
const validImg = (src) => (IMG_RE.test(String(src || "")) ? String(src) : null);
const validColor = (c, d = "#4fc3f7") => (/^#[0-9a-fA-F]{6}$/.test(String(c || "")) ? String(c) : d);
const numOr = (v, d) => (v === "" || v === null || v === undefined ? d : Number.isFinite(+v) ? +v : d);
const optNum = (v) => numOr(v, "");   // a number, or "" meaning "not set"
const nullNum = (v) => numOr(v, null);

// A character sheet as the server keeps it: every number really is a number, every list is a
// list of plain objects with string fields, images and colours are checked.
function cleanChar(ch) {
  const s = (v, n = 200) => str(v, n);
  const list = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === "object").map(fn) : []);
  const nums = (o, keys, d) => Object.fromEntries(keys.map((k) => [k, numOr((o || {})[k], d)]));
  const out = {
    _format: "holotable-sw5e", id: ch.id, name: s(ch.name, 80) || "Unnamed", species: s(ch.species, 60), background: s(ch.background, 60),
    alignment: s(ch.alignment, 60), xp: numOr(ch.xp, 0), credits: numOr(ch.credits, 0),
    classes: list(ch.classes, 6, (k) => ({ name: s(k.name, 40) || "Fighter", level: clamp(int(k.level, 1), 0, 20), archetype: s(k.archetype, 60) })),
    abilities: nums(ch.abilities, ABILS, 10),
    saves: Object.fromEntries(ABILS.map((a) => [a, !!(ch.saves || {})[a]])),
    skills: Object.fromEntries(Object.entries(ch.skills || {}).slice(0, 40).filter(([k]) => /^[a-zA-Z]{1,30}$/.test(k)).map(([k, v]) => [k, [0, 0.5, 1, 2].includes(+v) ? +v : 0])),
    skillMisc: Object.fromEntries(Object.entries(ch.skillMisc || {}).slice(0, 40).filter(([k]) => /^[a-zA-Z]{1,30}$/.test(k)).map(([k, v]) => [k, numOr(v, 0)])),
    saveMisc: nums(ch.saveMisc, ABILS, 0),
    ac: numOr(ch.ac, 10), speed: numOr(ch.speed, 30),
    hp: nums(ch.hp, ["max", "current", "temp"], 0), hitDiceUsed: numOr(ch.hitDiceUsed, 0),
    deathSaves: { s: clamp(int((ch.deathSaves || {}).s), 0, 3), f: clamp(int((ch.deathSaves || {}).f), 0, 3) },
    initMisc: numOr(ch.initMisc, 0), profOverride: optNum(ch.profOverride),
    force: { max: optNum((ch.force || {}).max), used: numOr((ch.force || {}).used, 0) },
    tech: { max: optNum((ch.tech || {}).max), used: numOr((ch.tech || {}).used, 0) },
    attacks: list(ch.attacks, 40, (a) => ({ name: s(a.name, 80), ab: ["str", "dex", "con", "int", "wis", "cha", "finesse"].includes(a.ab) ? a.ab : "str",
      damage: s(a.damage, 40), damageFull: a.damageFull ? s(a.damageFull, 60) : undefined, type: s(a.type, 30), props: s(a.props, 200),
      proficient: a.proficient !== false, magic: optNum(a.magic), bonus: optNum(a.bonus), noModDamage: !!a.noModDamage })),
    powers: list(ch.powers, 150, (pw) => ({ name: s(pw.name, 80), level: clamp(int(pw.level), 0, 9), type: pw.type === "tech" ? "tech" : "force",
      alignment: ["light", "dark"].includes(pw.alignment) ? pw.alignment : "universal", notes: s(pw.notes, 300), description: s(pw.description, 4000) })),
    features: list(ch.features, 150, (f) => ({ name: s(f.name, 80), text: s(f.text, 4000) })),
    equipment: list(ch.equipment, 200, (e) => ({ name: s(e.name, 80), qty: numOr(e.qty, 1), equipped: !!e.equipped, notes: s(e.notes, 200) })),
    conditions: (Array.isArray(ch.conditions) ? ch.conditions : []).slice(0, 20).map((c) => s(c, 30)),
    exhaustion: clamp(int(ch.exhaustion), 0, 6), inspiration: !!ch.inspiration,
    proficiencies: s(ch.proficiencies, 2000), languages: s(ch.languages, 500), notes: s(ch.notes, 20000),
    image: validImg(ch.image) || "", tokenImage: validImg(ch.tokenImage) || "", color: validColor(ch.color),
  };
  if (!out.classes.length) out.classes = [{ name: "Fighter", level: 1, archetype: "" }];
  return out;
}

function viewFor(camp, cid, gm, online) {
  const chat = camp.chat.filter((m) => !m.to || gm || m.to.includes(cid) || m.fromId === cid);
  const ini = Object.assign({}, camp.initiative);
  if (!gm) {
    ini.entries = ini.entries.filter((e) => !e.hidden)
      .map((e) => Object.assign({}, e, e.npc ? { hp: null, maxHp: null } : {}));
  }
  const map = Object.assign({}, camp.map);
  if (!gm) map.tokens = map.tokens.filter((t) => !t.hidden);
  return {
    name: camp.name, you: cid, isGM: !!gm, updated: camp.updated,
    players: camp.players, online: online || [], characters: camp.characters,
    chat: chat.slice(-200), initiative: ini, map,
    notes: gm ? camp.notes : null,
    handouts: (camp.handouts || []).filter((h) => gm || h.shared),
    levelUps: camp.levelUps || {},
  };
}

function doRoll(camp, cid, expr, label, charId, priv, kind) {
  const res = rollDice(expr);
  const msg = { from: playerName(camp, cid), fromId: cid, roll: Object.assign({}, res, { expr: str(expr, 120), label: str(label, 120), kind: kind || null }) };
  if (charId && camp.characters[charId]) msg.charName = camp.characters[charId].name;
  if (priv) { msg.to = ["@gm", cid]; msg.private = true; }
  addChat(camp, msg);
  return res;
}

// ---------------------------------------------------------------- levelling
// Hit die per SW5e class (custom / homebrew classes send their own die from the sheet).
const HIT_DIE = { berserker: 12, consular: 6, engineer: 8, fighter: 10, guardian: 10, monk: 8, operative: 8, scholar: 8, scout: 10, sentinel: 8 };
const ABILS = ["str", "dex", "con", "int", "wis", "cha"];
const totalLevel = (ch) => (ch.classes || []).reduce((a, k) => a + (int(k.level) || 0), 0);
const abMod = (ch, ab) => Math.floor((num((ch.abilities || {})[ab], 10) - 10) / 2);
const hitDieFor = (name, fallback) => HIT_DIE[String(name || "").toLowerCase()] || ([6, 8, 10, 12].includes(int(fallback)) ? int(fallback) : 8);

function applyLevelUp(camp, cid, gm, p) {
  const ch = camp.characters[p.charId];
  if (!ch) throw new Invalid("No such character.");
  if (!(gm || ch.owner === cid)) throw new Forbidden("not your character");
  const pend = (camp.levelUps || {})[ch.id];
  if (!pend || pend.count < 1) throw new Invalid("The GM hasn't granted this character a level up yet.");
  if (!Array.isArray(ch.classes)) ch.classes = [];
  const before = totalLevel(ch);
  if (before >= 20) throw new Invalid("Already level 20.");
  const clsName = str(p.className, 40).trim();
  if (!clsName) throw new Invalid("Pick a class to level up.");
  let k = ch.classes.find((x) => String(x.name || "").toLowerCase() === clsName.toLowerCase());
  const multiclass = !k;
  if (!k) { k = { name: clsName, level: 0, archetype: "" }; ch.classes.push(k); }
  if (!ch.abilities) ch.abilities = {};
  const oldCon = abMod(ch, "con");

  // ability score increase (+2 to one score or +1 to two, never above 20) or a feat
  if (p.asi) {
    let total = 0;
    for (const [ab, v] of Object.entries(p.asi)) {
      const inc = int(v);
      if (!ABILS.includes(ab) || inc < 0 || inc > 2) throw new Invalid("Bad ability score increase.");
      if (num(ch.abilities[ab], 10) + inc > 20) throw new Invalid("Ability scores can't go above 20.");
      total += inc;
    }
    if (total !== 2) throw new Invalid("An ability score increase is +2 to one score or +1 to two.");
  }
  const feat = p.feat && str(p.feat.name, 80).trim();

  // hit points: rolled on the server (shown in chat) or the fixed average; Con changes count for every level
  const hd = hitDieFor(k.name, p.hitDie);
  if (p.asi) for (const [ab, v] of Object.entries(p.asi)) ch.abilities[ab] = num(ch.abilities[ab], 10) + int(v);
  const newCon = abMod(ch, "con");
  const die = p.hpMode === "roll"
    ? doRoll(camp, cid, `1d${hd}`, `${ch.name}: level ${before + 1} hit points (d${hd})`, ch.id, false, "hp").total
    : hd / 2 + 1;
  const gain = Math.max(1, die + newCon) + (newCon - oldCon) * before;
  ch.hp = ch.hp || {};
  ch.hp.max = num(ch.hp.max) + gain;
  ch.hp.current = num(ch.hp.current) + gain;

  k.level = int(k.level) + 1;
  if (p.archetype) k.archetype = str(p.archetype, 60);
  ch.features = Array.isArray(ch.features) ? ch.features : [];
  ch.powers = Array.isArray(ch.powers) ? ch.powers : [];
  if (feat) ch.features.push({ name: feat, text: `Feat (level ${before + 1})` + (p.feat.text ? "\n" + str(p.feat.text, 4000) : "") });
  for (const f of (Array.isArray(p.features) ? p.features : []).slice(0, 20)) {
    if (f && str(f.name, 80).trim()) ch.features.push({ name: str(f.name, 80).trim(), text: str(f.text, 4000) });
  }
  for (const pw of (Array.isArray(p.powers) ? p.powers : []).slice(0, 20)) {
    if (!pw || !str(pw.name, 80).trim()) continue;
    ch.powers.push({ name: str(pw.name, 80).trim(), level: clamp(int(pw.level), 0, 9), type: pw.type === "tech" ? "tech" : "force",
      alignment: ["light", "dark"].includes(pw.alignment) ? pw.alignment : "universal", notes: str(pw.notes, 300) });
  }
  ch.updated = now();
  pend.count -= 1;
  if (pend.count < 1) delete camp.levelUps[ch.id];
  for (const e of camp.initiative.entries) if (e.charId === ch.id) { e.hp = ch.hp.current; e.maxHp = ch.hp.max; }

  const bits = [`HP +${gain}`];
  if (p.asi) bits.push(Object.entries(p.asi).filter(([, v]) => int(v)).map(([ab, v]) => `${ab.toUpperCase()} +${int(v)}`).join(", "));
  if (feat) bits.push(`feat: ${feat}`);
  addChat(camp, { levelup: true, text: `🎉 ${ch.name} reached level ${before + 1}! ${multiclass ? "Multiclassed into " : ""}${k.name} ${k.level}${k.archetype ? " (" + k.archetype + ")" : ""} · ${bits.join(" · ")}` });
  return { level: before + 1, hpGain: gain, die };
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
      if (!p.char || typeof p.char !== "object" || Array.isArray(p.char)) throw new Invalid("bad character");
      if (JSON.stringify(p.char).length > 400000) throw new Invalid("character sheet too large");
      const id = /^[a-z0-9]{6,20}$/.test(p.char.id || "") ? p.char.id : rid(12);
      need(canEditChar(camp, cid, gm, id), "not your character");
      if (!chars[id] && Object.keys(chars).length >= 60) throw new Invalid("too many characters at this table");
      const old = chars[id];
      const clean = cleanChar(Object.assign({}, p.char, { id }));
      clean.owner = old ? old.owner : (gm && p.owner && camp.players[p.owner] ? p.owner : cid);
      // photos change only through an upload (or char.photo.clear), never through a sheet save,
      // so a save carrying a stale copy can't undo or delete a photo that was just uploaded
      clean.image = old ? old.image || "" : "";
      clean.tokenImage = old ? old.tokenImage || "" : "";
      clean.updated = now();
      chars[id] = clean;
      const ch = clean;
      for (const e of ini.entries) if (e.charId === id) { e.name = ch.name || e.name; const hp = ch.hp || {}; e.hp = hp.current; e.maxHp = hp.max; }
      for (const t of mp.tokens) if (t.charId === id) t.name = ch.name || t.name;
      if (!old) addChat(camp, { system: true, text: `${playerName(camp, cid)} brought ${ch.name || "a character"} to the table.` });
      return { id };
    }
    case "char.photo.clear": {
      const ch = chars[p.charId];
      if (!ch) return {};
      need(gm || ch.owner === cid, "not your character");
      const k = p.kind === "token" ? "tokenImage" : "image";
      const old = ch[k];
      ch[k] = "";
      return { dropImages: [old] };
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
      // /w <player name | character name | gm> <message>: the longest name that matches wins, so
      // "Kira Vos" beats "Kira". Whispering a character reaches whoever plays it (the GM sees all whispers).
      if (/^\/(w|whisper|msg|tell) /.test(low)) {
        const rest = text.slice(text.indexOf(" ") + 1).trim();
        const targets = [];
        for (const [id, pl] of Object.entries(camp.players)) if (pl && pl.name) targets.push({ name: pl.name, ids: [id], label: pl.name });
        for (const ch of Object.values(camp.characters)) {
          if (ch && ch.name && ch.owner) targets.push({ name: ch.name, ids: [ch.owner], label: `${ch.name} (${playerName(camp, ch.owner)})` });
        }
        targets.push({ name: "gm", ids: ["@gm"], label: "GM" });
        targets.sort((x, y) => y.name.length - x.name.length);
        const lowRest = rest.toLowerCase();
        const t = targets.find((x) => lowRest.startsWith(x.name.toLowerCase()) && /^(\s|$)/.test(rest.slice(x.name.length)));
        if (!t) throw new Invalid("No player or character by that name. Use /w <name> <message>");
        const body = rest.slice(t.name.length).trim();
        if (!body) throw new Invalid(`What do you want to whisper to ${t.label}?`);
        addChat(camp, { from: playerName(camp, cid), fromId: cid, text: body, to: [...new Set([...t.ids, cid])], private: true, whisperTo: t.label,
          as: str(p.as, 80) || null });
        return {};
      }
      // /yell: a loud message for everyone at the table (shown big, with a pop-up on every screen)
      if (/^\/(y|yell|shout) /.test(low)) {
        const body = text.slice(text.indexOf(" ") + 1).trim();
        if (body) addChat(camp, { from: playerName(camp, cid), fromId: cid, text: str(body, 500), yell: true, as: str(p.as, 80) || null });
        return {};
      }
      // /ooc: out-of-character table talk
      if (/^\/(ooc|o) /.test(low)) {
        const body = text.slice(text.indexOf(" ") + 1).trim();
        if (body) addChat(camp, { from: playerName(camp, cid), fromId: cid, text: body, ooc: true });
        return {};
      }
      if (low.startsWith("/me ")) { addChat(camp, { from: str(p.as, 80) || playerName(camp, cid), fromId: cid, text: text.slice(4), emote: true }); return {}; }
      if (low.startsWith("/desc ") && gm) { addChat(camp, { from: "Narrator", fromId: cid, text: text.slice(6), narration: true }); return {}; }
      if (low.startsWith("/desc ")) throw new Invalid("Only the GM can narrate with /desc.");
      if (/^\/\S/.test(text)) throw new Invalid(`Unknown command ${text.split(/\s/)[0]}. Type / to see the list.`);
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
        hidden: !!p.hidden && gm, hp: nullNum(charId ? hp.current : p.hp), maxHp: nullNum(charId ? hp.max : p.hp),
        ac: nullNum(charId ? ch.ac : p.ac), dexTie: num(p.bonus) / 100, conditions: entry.conditions || [],
      });
      sortInit(ini);
      return {};
    }
    case "init.update": {
      const e = ini.entries.find((x) => x.id === p.id);
      if (!e) return {};
      need(gm || (e.charId && chars[e.charId] && chars[e.charId].owner === cid));
      const f = p.fields || {};
      if ("name" in f) e.name = str(f.name, 60);
      for (const k of ["hp", "maxHp", "ac"]) if (k in f) e[k] = nullNum(f[k]);
      if ("init" in f) e.init = num(f.init);
      if ("conditions" in f) e.conditions = (Array.isArray(f.conditions) ? f.conditions : []).slice(0, 20).map((c) => str(c, 30));
      if ("hidden" in f && gm) e.hidden = !!f.hidden;
      if ("hp" in f && e.charId && chars[e.charId]) (chars[e.charId].hp = chars[e.charId].hp || {}).current = numOr(f.hp, 0);
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
      t.x = clamp(int(p.x, t.x), -500, 1000); t.y = clamp(int(p.y, t.y), -500, 1000);
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
        id: rid(), name: str(p.name || ch.name || "Token", 40), color: validColor(p.color || ch.color),
        x: clamp(int(p.x, 1), -500, 1000), y: clamp(int(p.y, 1), -500, 1000), size: clamp(int(p.size, 1), 1, 4),
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
      if ("color" in f) t.color = validColor(f.color);
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
      if ((camp.handouts || []).length >= 100 && !(camp.handouts || []).some((x) => x.id === clean.id)) throw new Invalid("too many handouts");
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
    // ---- level ups: the GM grants, the player (or the GM for an absent player) picks how to level
    case "levelup.grant": {
      need(gm);
      const ids = (Array.isArray(p.charIds) ? p.charIds : []).filter((id) => chars[id]);
      if (!ids.length) throw new Invalid("Pick at least one character.");
      camp.levelUps = camp.levelUps || {};
      const names = [];
      for (const id of ids) {
        const pend = camp.levelUps[id] || { count: 0 };
        if (totalLevel(chars[id]) + pend.count >= 20) continue;
        pend.count += 1; pend.grantId = rid(); pend.at = now();
        camp.levelUps[id] = pend;
        names.push(chars[id].name || "Someone");
      }
      if (!names.length) throw new Invalid("Those characters are already level 20.");
      const reason = str(p.reason, 200).trim();
      addChat(camp, { levelup: true, text: `⬆ Level up! ${names.join(", ")} ${names.length > 1 ? "have" : "has"} earned a new level${reason ? ": " + reason : ""}.` });
      return { granted: names.length };
    }
    case "levelup.cancel": {
      need(gm);
      if (camp.levelUps && camp.levelUps[p.charId]) delete camp.levelUps[p.charId];
      return {};
    }
    case "levelup.apply":
      return applyLevelUp(camp, cid, gm, p);

    // ---- each person's own colour theme (only changes what they see)
    case "player.prefs": {
      const theme = String(p.theme || "holo-blue");
      if (!/^[a-z0-9-]{1,40}$/.test(theme)) throw new Invalid("bad theme");
      if (theme.startsWith("gm-") && !gm) throw new Forbidden("That theme is the GM's.");
      const custom = {};
      for (const k of ["bg", "panel", "text", "holo", "amber"]) {
        const v = (p.custom || {})[k];
        if (v !== undefined && v !== null && v !== "") custom[k] = validColor(v, null);
      }
      for (const k of Object.keys(custom)) if (!custom[k]) delete custom[k];
      (camp.players[cid] = camp.players[cid] || {}).prefs = { theme, custom };
      return {};
    }
    case "player.rename":
      (camp.players[cid] = camp.players[cid] || {}).name = str(p.name, 40) || "Player";
      return {};
    case "chat.clear": need(gm); camp.chat = []; return {};
  }
  throw new Invalid("unknown action " + str(type, 40));
}

// A whole game coming back from a backup file gets the same checks as live edits.
function cleanGame(g) {
  const m = g.map && typeof g.map === "object" ? g.map : {};
  const n = (v, d) => (Number.isFinite(+v) ? +v : d);
  g.map = {
    bgVersion: int(m.bgVersion) + 1, bgUrl: validImg(m.bgUrl), floor: validImg(m.floor), floorScale: clamp(n(m.floorScale, 1), 0.1, 8),
    gridSize: clamp(int(m.gridSize, 70), 5, 200), gridV2: true, cols: clamp(int(m.cols, 24), 5, 200), rows: clamp(int(m.rows, 16), 5, 200), showGrid: m.showGrid !== false,
    tokens: (Array.isArray(m.tokens) ? m.tokens : []).slice(0, 300).filter((t) => t && typeof t === "object").map((t) => ({
      id: /^[a-z0-9]{6,20}$/.test(t.id || "") ? t.id : rid(), name: str(t.name, 40), color: validColor(t.color), x: clamp(int(t.x), -500, 1000), y: clamp(int(t.y), -500, 1000),
      size: clamp(int(t.size, 1), 1, 4), charId: g.characters[t.charId] ? t.charId : null, owner: str(t.owner, 40), hidden: !!t.hidden, img: validImg(t.img) })),
    props: (Array.isArray(m.props) ? m.props : []).slice(0, 1500).filter((p) => p && validImg(p.src)).map((p) => ({
      id: /^[a-z0-9]{6,20}$/.test(p.id || "") ? p.id : rid(), src: p.src, name: str(p.name, 60), x: n(p.x, 0), y: n(p.y, 0), w: n(p.w, 1), h: n(p.h, 1), rot: n(p.rot, 0) })),
  };
  const ini = g.initiative && typeof g.initiative === "object" ? g.initiative : {};
  g.initiative = {
    turn: clamp(int(ini.turn), 0, 300), round: Math.max(1, int(ini.round, 1)), active: !!ini.active,
    entries: (Array.isArray(ini.entries) ? ini.entries : []).slice(0, 300).filter((e) => e && typeof e === "object").map((e) => ({
      id: /^[a-z0-9]{6,20}$/.test(e.id || "") ? e.id : rid(), name: str(e.name, 60), init: n(e.init, 0), charId: g.characters[e.charId] ? e.charId : null,
      npc: !!e.npc, hidden: !!e.hidden, hp: nullNum(e.hp), maxHp: nullNum(e.maxHp), ac: nullNum(e.ac), dexTie: n(e.dexTie, 0),
      conditions: (Array.isArray(e.conditions) ? e.conditions : []).slice(0, 20).map((c) => str(c, 30)) })),
  };
  g.handouts = (Array.isArray(g.handouts) ? g.handouts : []).slice(0, 100).filter((h) => h && typeof h === "object").map((h) => ({
    id: /^[a-z0-9]{6,20}$/.test(h.id || "") ? h.id : rid(), title: str(h.title, 200), text: str(h.text, 20000), img: validImg(h.img), shared: !!h.shared }));
  g.chat = (Array.isArray(g.chat) ? g.chat : []).slice(-CHAT_LIMIT).filter((c) => c && typeof c === "object");
  g.notes = str(g.notes, 500000);
  g.levelUps = Object.fromEntries(Object.entries(g.levelUps || {}).filter(([id]) => g.characters[id])
    .map(([id, v]) => [id, { count: clamp(int((v || {}).count), 0, 20), grantId: rid(), at: now() }]).filter(([, v]) => v.count > 0));
  return g;
}

module.exports = {
  cleanGame,
  rollDice, blankCampaign, playerName, addChat, viewFor, applyAction, validImg, validColor, cleanChar, rid,
  Forbidden, Invalid, IMG_PREFIX,
};
