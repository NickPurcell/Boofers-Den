"use strict";
// Downtime between adventures (audit 11.1, #202). The GM grants days; activities spend them. Each character keeps
//   downtime: { days, log: [{ id, act, days, cr, text, at }] }
// (days granted and not yet spent; the log newest last, the last 100 kept). Only the server writes it: a sheet save
// keeps what the sheet had. Crafting (11.2) spends days through spend() too, with act "crafting".
const crypto = require("crypto");
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;

// Wretched Hives' activities (keys as SW5e's list builds them from the chapter's headings), and "other" for anything
// the GM allows that isn't one of them (it has no tables: the GM writes the result). Crafting is 11.2's.
const ACTS = R.DOWNTIME_ACTS;
// set by holotable.js on downtime.roll: SW5e's activity tables, by key, read before the game lock; never from a client
const ACT_TABLES = Symbol("downtimeActs");

const ID = /^[a-z0-9]{6,20}$/;
const ACT = /^[a-z][a-z-]{0,29}$/;
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const int = (v, d = 0) => (Number.isFinite(+v) ? Math.trunc(+v) : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const MAX_DAYS = 3650, LOG = 100;

// a stored or restored downtime record, or undefined when there's nothing in it
function clean(d) {
  if (!d || typeof d !== "object") return undefined;
  const log = (Array.isArray(d.log) ? d.log : []).filter((e) => e && typeof e === "object" && ACT.test(String(e.act || ""))).slice(-LOG).map((e) => ({
    id: ID.test(String(e.id || "")) ? String(e.id) : crypto.randomBytes(6).toString("hex"), act: String(e.act),
    days: clamp(int(e.days), 0, MAX_DAYS), cr: clamp(int(e.cr), -10000000, 10000000), text: str(e.text, 500), at: Math.max(0, int(e.at)),
  }));
  const days = clamp(int(d.days), 0, MAX_DAYS);
  // requests (jpesus: "GM approves first"): waiting for the GM (ok false), or approved and waiting for the roll (ok true)
  const pending = (Array.isArray(d.pending) ? d.pending : []).filter((x) => x && typeof x === "object" && own(ACTS, String(x.act || ""))).slice(0, 5).map((x) => ({
    id: ID.test(String(x.id || "")) ? String(x.id) : crypto.randomBytes(6).toString("hex"), act: String(x.act), days: clamp(int(x.days), 1, MAX_DAYS),
    note: str(x.note, 200), at: Math.max(0, int(x.at)), ok: !!x.ok,
    ...(x.ok ? { entry: str(x.entry, 20), check: checkOf(x.check), prof: !!x.prof, bonus: clamp(int(x.bonus), -10, 10), extra: clamp(int(x.extra), -50, 50), rarity: clamp(int(x.rarity, -1), -1, 7) } : {}),
  }));
  return days || log.length || pending.length ? { days, log, ...(pending.length ? { pending } : {}) } : undefined;
}
// what's rolled for an approved activity: a skill check or an ability check, by key
function checkOf(c) {
  const what = c && c.what, key = String((c && c.key) || "");
  if (what === "skill") { const k = R.SKILLS.find((x) => x.key === key); return k ? { what, key, name: k.name } : null; }
  if (what === "ability") { const a = R.ABILITIES.find((x) => x.key === key); return a ? { what, key, name: `${a.name} check` } : null; }
  return null;
}

// spend days (and credits) on an activity; throws when there aren't enough days. cr < 0 is a cost, never taking
// credits below 0 (a cost the character can't pay is refused); cr > 0 is earned.
function spend(ch, entry, h, at) {
  const d = clean(ch.downtime) || { days: 0, log: [] };
  const days = clamp(int(entry.days), 0, MAX_DAYS), cr = clamp(int(entry.cr), -10000000, 10000000);
  if (!ACT.test(String(entry.act || ""))) throw new h.Invalid("Which activity?");
  if (days > d.days) throw new h.Invalid(`${ch.name || "That character"} has ${d.days} day${d.days === 1 ? "" : "s"} of downtime, not ${days}.`);
  const have = Number.isFinite(+ch.credits) ? +ch.credits : 0;
  if (cr < 0 && have + cr < 0) throw new h.Invalid(`${ch.name || "That character"} has ${have} cr, not ${-cr}.`);
  const e = { id: crypto.randomBytes(6).toString("hex"), act: String(entry.act), days, cr, text: str(entry.text, 500), at: at || Math.floor(Date.now() / 1000) };
  ch.credits = have + cr;
  ch.downtime = Object.assign({}, d, { days: d.days - days, log: [...d.log, e].slice(-LOG) });
  return e;
}

// Rolling an approved activity, with the dice given (so it can be tested): the check's total picks the d100 modifier
// (the highest DC met), then d100 + that + the GM's extra picks the Results line. Buying's modifiers carry a rarity:
// below its lowest DC no seller is found. Selling's rarity (the GM's pick) adds its modifier. Returns the words.
function resolve(act, total, d100, extra) {
  const met = (act.mods || []).filter((m) => total >= m.dc).sort((a, b) => b.dc - a.dc)[0];
  if (!met && (act.mods || []).some((m) => m.label)) return { text: "No seller found this time.", mod: null, final: null };
  const mod = met ? met.mod : 0, final = d100 + mod + extra;
  const row = (act.results || []).find((r) => final >= r.lo && final <= r.hi);
  return { text: row ? row.text : "", mod, final, label: met && met.label };
}

const handles = (type) => ["downtime.grant", "downtime.request", "downtime.decide", "downtime.roll"].includes(type);

function apply(camp, cid, gm, type, p, h) {
  if (type === "downtime.grant") return grant(camp, cid, gm, p, h);
  const id = String(p.charId || ""), ch = ID.test(id) && own(camp.characters, id) ? camp.characters[id] : null;
  if (!ch) throw new h.Invalid("No such character.");
  const mine = gm || ch.owner === cid;
  const gmOwned = !ch.owner || ((camp.players || {})[ch.owner] || {}).role === "gm";
  const shown = h.shownName(camp, { charId: id, name: ch.name });
  const say = (text, toOwner) => h.addChat(camp, gmOwned ? { system: true, to: ["@gm"], private: true, text } : toOwner ? { system: true, to: ["@gm", ch.owner], private: true, text } : { system: true, text });
  const d = clean(ch.downtime) || { days: 0, log: [] }, pend = d.pending || [];
  const find = () => { const x = pend.find((q) => q.id === String(p.id || "")); if (!x) throw new h.Invalid("No such request."); return x; };

  if (type === "downtime.request") {   // the player asks; nothing is spent or rolled until the GM says yes
    if (!mine) throw new h.Forbidden("not your character");
    const act = String(p.act || ""), days = clamp(int(p.days), 0, MAX_DAYS);
    if (!own(ACTS, act)) throw new h.Invalid("Which activity?");
    if (!days) throw new h.Invalid("How many days?");
    const asked = pend.reduce((n, q) => n + q.days, 0);
    if (days + asked > d.days) throw new h.Invalid(`${ch.name} has ${d.days - asked} day${d.days - asked === 1 ? "" : "s"} of downtime to ask for.`);
    if (pend.length >= 5) throw new h.Invalid("Five requests are waiting already.");
    const q = { id: crypto.randomBytes(6).toString("hex"), act, days, note: str(p.note, 200).trim(), at: Math.floor(Date.now() / 1000), ok: false };
    ch.downtime = Object.assign({}, d, { pending: [...pend, q] });
    h.addChat(camp, { system: true, to: ["@gm"], private: true, text: `🕰 ${ch.name} asks for ${days} day${days === 1 ? "" : "s"} of ${ACTS[act].toLowerCase()}${q.note ? `: "${q.note}"` : ""}. Approve it on the GM tab.` });
    return { id: q.id };
  }

  if (type === "downtime.decide") {   // the GM: no, or yes with the check to roll, the cost, and any modifiers
    if (!gm) throw new h.Forbidden("GM only");
    const q = find();
    if (q.ok) throw new h.Invalid("Already approved.");
    if (!p.ok) {
      ch.downtime = Object.assign({}, d, { pending: pend.filter((x) => x !== q) });
      if (!ch.downtime.pending.length) delete ch.downtime.pending;
      say(`🕰 The GM turned down ${shown}'s ${q.days} day${q.days === 1 ? "" : "s"} of ${ACTS[q.act].toLowerCase()}.`, true);
      return { ok: false };
    }
    const cr = clamp(int(p.cr), 0, 10000000), check = q.act === "other" ? null : checkOf(p.check);
    if (q.act !== "other" && !check) throw new h.Invalid("Which check does it roll?");
    const e = spend(ch, { act: q.act, days: q.days, cr: -cr, text: q.act === "other" ? str(p.text || q.note, 500) : "Approved; waiting for the roll." }, h);
    const rest = (clean(ch.downtime).pending || []).filter((x) => x.id !== q.id);
    if (q.act !== "other") rest.push(Object.assign({}, q, { ok: true, entry: e.id, check, prof: !!p.prof, bonus: clamp(int(p.bonus), -10, 10), extra: clamp(int(p.extra), -50, 50), rarity: clamp(int(p.rarity, -1), -1, 7) }));
    ch.downtime = Object.assign({}, clean(ch.downtime), { pending: rest });
    if (!rest.length) delete ch.downtime.pending;
    say(`🕰 ${shown}: ${q.days} day${q.days === 1 ? "" : "s"} of ${ACTS[q.act].toLowerCase()} approved${cr ? ` (−${cr.toLocaleString("en-US")} cr)` : ""}.${check ? ` ${shown} rolls ${check.name}.` : ""}`);
    return { ok: true };
  }

  if (type === "downtime.roll") {   // jpesus: the character doing the activity rolls (from the sheet, on the server)
    if (!mine) throw new h.Forbidden("not your character");
    const q = find();
    if (!q.ok) throw new h.Invalid("The GM hasn't approved this yet.");
    const tables = p[ACT_TABLES];
    if (!tables) throw new h.Invalid("Couldn't read the activity's tables just now. Try again in a moment.");
    const act = own(tables, q.act) ? tables[q.act] : null;
    if (!act) throw new h.Invalid("That activity's tables aren't in SW5e's list.");
    const c = q.check, b = (c.what === "skill" ? R.skillBonus(ch, c.key) : R.abilityMod(ch, c.key)) + (q.prof ? R.profBonus(ch) : 0) + q.bonus;
    const roll = h.rollDice(`1d20${b >= 0 ? "+" : ""}${b}`);
    h.addChat(camp, Object.assign({ from: shown, fromId: gmOwned ? "@gm" : ch.owner, roll: Object.assign({}, roll, { expr: `1d20${b >= 0 ? "+" : ""}${b}`, label: `${act.n}: ${c.name}${q.prof ? " (with tools)" : ""}`.slice(0, 120), kind: "check" }) },
      shown === ch.name ? { charName: ch.name } : {}, gmOwned ? { to: ["@gm"], private: true } : {}));
    const sellMod = act.rarity && q.rarity >= 0 && act.rarity[q.rarity] ? act.rarity[q.rarity].mod : 0;   // selling: the item's rarity, the GM's pick
    const d100 = h.rollDice("1d100").total, res = resolve(act, roll.total, d100, q.extra + sellMod);
    const how = res.final == null ? res.text : `${c.name} ${roll.total}${res.label ? ` (${res.label})` : ""} → ${res.mod >= 0 ? "+" : ""}${res.mod}; d100 ${d100}${res.mod || q.extra + sellMod ? ` → ${res.final}` : ""}: ${res.text}`;
    const now = clean(ch.downtime);
    ch.downtime = Object.assign({}, now, { log: now.log.map((e) => (e.id === q.entry ? Object.assign({}, e, { text: how.slice(0, 500) }) : e)), pending: (now.pending || []).filter((x) => x.id !== q.id) });
    if (!ch.downtime.pending.length) delete ch.downtime.pending;
    say(`🕰 ${shown} (${act.n.toLowerCase()}): ${how}`);
    // a complication: its chance, then its table; the GM's to play out (WH: "complications you can throw at the characters")
    if (act.complPct && h.rollDice("1d100").total <= act.complPct) {
      const n = act.compls && act.compls.length ? act.compls[(h.rollDice(`1d${act.dieN || act.compls.length}`).total - 1) % act.compls.length] : "";
      h.addChat(camp, { system: true, to: ["@gm"], private: true, text: `🕰 A complication for ${ch.name}'s ${act.n.toLowerCase()}${n ? `: ${n}` : " (yours to decide)"}.` });
    }
    return { total: roll.total, final: res.final };
  }
  throw new h.Invalid("Unknown action.");
}

// the GM gives the characters they pick N days of downtime ("ten days pass in port"); with `living`, the same days of
// each one's lifestyle are charged through the story module's lifestyle.charge (11.5), so nothing is counted twice
function grant(camp, cid, gm, p, h) {
  if (!gm) throw new h.Forbidden("GM only");
  const days = clamp(int(p.days), 0, MAX_DAYS);
  if (!days) throw new h.Invalid("How many days?");
  const ids = [...new Set((Array.isArray(p.chars) ? p.chars : []).map(String))].filter((id) => ID.test(id) && own(camp.characters, id)).slice(0, 30);
  if (!ids.length) throw new h.Invalid("Pick who gets the days.");
  const why = str(p.reason, 80).trim(), at = Math.floor(Date.now() / 1000);
  for (const id of ids) {
    const ch = camp.characters[id], d = clean(ch.downtime) || { days: 0, log: [] };
    ch.downtime = { days: clamp(d.days + days, 0, MAX_DAYS), log: [...d.log, { id: crypto.randomBytes(6).toString("hex"), act: "grant", days, cr: 0, text: why, at }].slice(-LOG) };
  }
  const names = ids.map((id) => h.shownName(camp, { charId: id, name: camp.characters[id].name }));
  h.addChat(camp, { system: true, text: `🕰 ${days} day${days === 1 ? "" : "s"} of downtime${why ? ` (${why})` : ""} for ${names.join(", ")}.` });
  let living = null;
  if (p.living) {
    try { living = h.applyAction(camp, cid, gm, "lifestyle.charge", { days: Math.min(days, 365), chars: ids }).charged || 0; }
    catch (e) { if (!(e instanceof h.Invalid)) throw e; living = 0; h.addChat(camp, { system: true, to: ["@gm"], private: true, text: `No living costs charged: ${e.message}` }); }
  }
  return { granted: ids.length, living };
}

module.exports = { handles, apply, clean, spend, resolve, checkOf, ACTS, ACT_TABLES, MAX_DAYS };
