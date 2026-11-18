"use strict";
// The GM asking for a roll (audit 9.12): "everyone roll Perception", a group check, a secret Insight roll made for a
// player. Every roll is made on the server from the character's own sheet, so nobody types a bonus. Two ways:
//   - ask.roll: the GM rolls now for the chosen characters (a secret check, or to keep things moving);
//   - ask.open: each chosen character's player gets a Roll prompt; ask.answer rolls theirs; ask.close ends it.
// The GM decides who is asked, whether a DC is set, whether players see it, and whether the results are secret
// (then only the GM reads them; a player sees only that they rolled). One open request at a time.
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const int = (v, d = 0) => (Number.isFinite(+v) ? Math.trunc(+v) : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// what may be asked: a skill, a saving throw or an ability check, by its key
function checkOf(what, key) {
  key = String(key || "");
  if (what === "skill") { const s = R.SKILLS.find((x) => x.key === key); return s ? { what, key, name: s.name } : null; }
  if (what === "save" || what === "ability") {
    const a = R.ABILITIES.find((x) => x.key === key);
    return a ? { what, key, name: `${a.name} ${what === "save" ? "save" : "check"}` } : null;
  }
  return null;
}
const bonusOf = (ch, c) => (c.what === "skill" ? R.skillBonus(ch, c.key) : c.what === "save" ? R.saveBonus(ch, c.key) : R.abilityMod(ch, c.key));

// the characters the GM chose: a list of ids, or every character a player plays
function pick(camp, ids) {
  const chars = camp.characters || {};
  const gmIds = new Set(Object.entries(camp.players || {}).filter(([, p]) => p && p.role === "gm").map(([id]) => id));
  if (!Array.isArray(ids) || !ids.length) return Object.keys(chars).filter((id) => chars[id] && !gmIds.has(chars[id].owner)).slice(0, 30);
  return [...new Set(ids.map(String).filter((id) => ID.test(id) && own(chars, id)))].slice(0, 30);
}
function settings(p) {
  const dc = p.dc === "" || p.dc == null ? null : clamp(int(p.dc, 10), 1, 40);
  return { dc, showDc: !!p.showDc && dc != null, secret: !!p.secret };
}

const gmOwned = (camp, ch) => !ch.owner || ((camp.players || {})[ch.owner] || {}).role === "gm";

function rollOne(camp, ch, c, mode, G) {
  const b = bonusOf(ch, c), d = mode === "adv" ? "2d20kh1" : mode === "dis" ? "2d20kl1" : "1d20";
  const expr = `${d}${b >= 0 ? "+" : ""}${b}`;
  return Object.assign({}, G.rollDice(expr), { expr });
}
// one result line in chat: to everyone, or (secret) to the GM only; the DC's verdict only where the DC may be read
function post(camp, req, ch, res, G, by) {
  const ok = req.dc != null ? res.total >= req.dc : null;
  const label = `${req.check.name}${req.group ? " (group)" : ""}${req.dc != null && (req.showDc || req.secret) ? ` vs DC ${req.dc}: ${ok ? "success" : "fail"}` : ""}`;
  const msg = { from: by, fromId: "@gm", charName: ch.name, roll: Object.assign({}, res, { label: label.slice(0, 120), kind: "check" }) };
  if (req.secret || gmOwned(camp, ch)) Object.assign(msg, { to: ["@gm"], private: true });   // an NPC sheet of the GM's: its name stays the GM's
  G.addChat(camp, msg);
  // a secret request still tells the player that they rolled, without the number
  if (req.secret && ch.owner && !gmOwned(camp, ch)) G.addChat(camp, { system: true, to: ["@gm", ch.owner], private: true, text: `${ch.name} rolled ${req.check.name} for the GM.` });
  return ok;
}
// a group check (SW5e, as 5e): it succeeds if at least half the group succeeds
function groupLine(camp, req, G) {
  const res = Object.values(req.results);
  if (!req.group || req.dc == null || res.length < req.chars.length) return;
  const won = res.filter((r) => r.ok).length, ok = won * 2 >= res.length;
  const msg = { system: true, text: `Group ${req.check.name}: ${won} of ${res.length} succeeded, the group ${ok ? "succeeds" : "fails"}.` };
  if (req.secret || !req.showDc || req.chars.some((id) => gmOwned(camp, camp.characters[id] || {}))) Object.assign(msg, { to: ["@gm"], private: true });
  G.addChat(camp, msg);
}

function apply(camp, cid, gm, type, p, G) {
  p = p || {};
  if (type === "ask.answer") {   // a player (or the GM) rolls a character's answer to the open request
    const req = camp.ask;
    if (!req || String(p.id) !== req.id) throw new G.Invalid("That roll request has ended.");
    const id = String(p.charId || "");
    if (!ID.test(id) || !req.chars.includes(id) || !own(camp.characters, id)) throw new G.Invalid("That character wasn't asked.");
    const ch = camp.characters[id];
    if (!gm && ch.owner !== cid) throw new G.Forbidden("not your character");
    if (own(req.results, id)) throw new G.Invalid(`${ch.name} has already rolled.`);
    const res = rollOne(camp, ch, req.check, ["adv", "dis"].includes(p.mode) ? p.mode : "", G);
    const ok = post(camp, req, ch, res, G, G.playerName(camp, cid));
    req.results[id] = { total: res.total, ok };
    groupLine(camp, req, G);
    return { total: req.secret && !gm ? undefined : res.total };
  }
  if (!gm) throw new G.Forbidden("GM only");
  if (type === "ask.close") { camp.ask = null; return {}; }
  const check = checkOf(p.what, p.key);
  if (!check) throw new G.Invalid("Pick a skill, a save or an ability.");
  const chars = pick(camp, p.chars);
  if (!chars.length) throw new G.Invalid("No characters to ask.");
  const req = Object.assign({ id: require("crypto").randomBytes(5).toString("hex"), check, chars, results: {}, group: !!p.group && chars.length > 1 }, settings(p));
  if (type === "ask.roll") {   // the GM rolls for all of them now
    for (const id of chars) {
      const ch = camp.characters[id], res = rollOne(camp, ch, check, "", G);
      req.results[id] = { total: res.total, ok: post(camp, req, ch, res, G, "GM") };
    }
    groupLine(camp, req, G);
    return { results: req.results };
  }
  if (type === "ask.open") {
    camp.ask = req;
    const named = chars.filter((id) => !gmOwned(camp, camp.characters[id])), more = chars.length - named.length;
    const who = [...named.map((id) => camp.characters[id].name), ...(more ? [`${more} more`] : [])].join(", ");
    G.addChat(camp, { system: true, text: `The GM asks for ${check.name}${req.group ? " (a group check)" : ""}${req.showDc ? `, DC ${req.dc}` : ""}: ${who}.` });
    return { id: req.id };
  }
  throw new G.Invalid("Unknown request.");
}

// what each person sees of the open request: the GM all of it; a player only a request that names one of their
// characters, without the DC unless shown, and without others' results when it's secret
function view(camp, cid, gm) {
  const req = camp.ask;
  if (!req) return null;
  if (gm) return req;
  const mine = req.chars.filter((id) => own(camp.characters, id) && camp.characters[id].owner === cid);
  if (!mine.length) return null;
  // the GM's own NPC sheets aren't named or scored for players; a success or failure is sent only when the DC is
  // shown (each verdict would otherwise bracket a hidden DC); a secret request sends only that one's own roll is in
  const shown = req.chars.filter((id) => own(camp.characters, id) && !gmOwned(camp, camp.characters[id]));
  const results = {};
  for (const id of shown) {
    if (!own(req.results, id) || (req.secret && !mine.includes(id))) continue;
    const r = req.results[id];
    results[id] = req.secret ? { done: true } : Object.assign({ total: r.total }, req.showDc ? { ok: r.ok } : {});
  }
  return { id: req.id, check: req.check, chars: shown, mine, group: req.group, secret: req.secret,
    ...(req.showDc ? { dc: req.dc, showDc: true } : {}), results };
}

// a saved game's request, kept only if it still makes sense (restore, crafted saves)
function clean(a, chars) {
  if (!a || typeof a !== "object" || !ID.test(String(a.id || ""))) return null;
  const check = checkOf((a.check || {}).what, (a.check || {}).key);
  if (!check) return null;
  const ids = (Array.isArray(a.chars) ? a.chars : []).map(String).filter((id) => ID.test(id) && own(chars || {}, id)).slice(0, 30);
  if (!ids.length) return null;
  const results = {};
  for (const id of ids) if (own(a.results, id) && a.results[id] && typeof a.results[id] === "object") results[id] = { total: int(a.results[id].total), ok: a.results[id].ok == null ? null : !!a.results[id].ok };
  return Object.assign({ id: String(a.id), check, chars: [...new Set(ids)], results, group: !!a.group && ids.length > 1 }, settings(a));
}

module.exports = { apply, view, clean, checkOf };
