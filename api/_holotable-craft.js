"use strict";
// Crafting (audit 11.2, #167), Wretched Hives' "Crafting", in the shape of downtime (#202, jpesus: "GM approves first"):
//   1. craft.request: a character asks to make an item. The sheet sends the item as it would land in the inventory and
//      a suggested value; nothing is spent.
//   2. craft.decide: the GM turns it down, or approves it with the value, the days, the materials' cost and the tool.
//      Approving spends the days and the credits through Downtime.spend (act "crafting").
//   3. craft.roll: the character rolls, on the server. An Intelligence check with the tool (#218's tier and dice) meets
//      a DC for a d100 modifier; d100 + that + the item's rarity modifier reads Crafting Results, whose line sets what
//      the materials really cost (twice, one and a half, as planned, half, a quarter): the difference is charged or
//      refunded. The item lands in the inventory. A complication may come up for each workweek (the GM's, as downtime's).
// The tables are SW5e's own (Wretched Hives, read before the lock by holotable.js), never from a client.
// Each character keeps craft: { pending: [...] }, written only by the server (a sheet save keeps what was there).
const crypto = require("crypto");
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;
const Downtime = require("./_holotable-downtime.js");

const ID = /^[a-z0-9]{6,20}$/;
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const int = (v, d = 0) => (Number.isFinite(+v) ? Math.trunc(+v) : d);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const MAX_VALUE = 10000000, MAX_DAYS = 3650, PENDING = 5;

// the item as it lands in the inventory: the fields of the item shape agreed on #167 that a crafted item can have
function cleanItem(it) {
  const name = str(it && it.name, 80).trim();
  if (!name) return null;
  return Object.assign({ name, qty: 1, equipped: false, notes: str(it.notes, 200) },
    +it.wt > 0 ? { wt: Math.min(10000, Math.round(+it.wt * 100) / 100) } : {}, +it.cost > 0 ? { cost: Math.min(1e9, Math.round(+it.cost)) } : {},
    R.cleanArmor(it.armor) ? { armor: R.cleanArmor(it.armor) } : {},
    R.RARITIES.includes(it.rar) ? { rar: it.rar } : {}, it.att ? { att: true } : {},
    it.use && R.cleanUse(it.use) ? { use: R.cleanUse(it.use) } : {}, R.cleanBonus(it.bonus) ? { bonus: R.cleanBonus(it.bonus) } : {});   // as the sheet keeps them (6.7, 6.2)
}
function clean(c) {
  if (!c || typeof c !== "object") return undefined;
  const pending = (Array.isArray(c.pending) ? c.pending : []).filter((x) => x && typeof x === "object" && cleanItem(x.item)).slice(0, PENDING).map((x) => Object.assign({
    id: ID.test(String(x.id || "")) ? String(x.id) : crypto.randomBytes(6).toString("hex"), item: cleanItem(x.item),
    value: clamp(int(x.value), 0, MAX_VALUE), note: str(x.note, 200), at: Math.max(0, int(x.at)), ok: !!x.ok, tool: str(x.tool, 60),
  }, x.ok ? { days: clamp(int(x.days), 0, MAX_DAYS), cost: clamp(int(x.cost), 0, MAX_VALUE), entry: str(x.entry, 20) } : {}));
  return pending.length ? { pending } : undefined;
}
// what the materials really cost, by the Crafting Results line: its words, as SW5e writes them
function materialsFactor(text) {
  const t = String(text || "").toLowerCase();
  if (/twice/.test(t)) return 2;
  if (/one and a half/.test(t)) return 1.5;
  if (/quarter/.test(t)) return 0.25;
  if (/\bhalf\b/.test(t)) return 0.5;
  return 1;
}

const ACT_TABLES = Downtime.ACT_TABLES;   // set by holotable.js on craft.roll, as for downtime.roll
const handles = (type) => ["craft.request", "craft.decide", "craft.roll", "craft.cancel"].includes(type);

function apply(camp, cid, gm, type, p, h) {
  const id = String(p.charId || ""), ch = ID.test(id) && own(camp.characters, id) ? camp.characters[id] : null;
  if (!ch) throw new h.Invalid("No such character.");
  const mine = gm || ch.owner === cid;
  const gmOwned = !ch.owner || ((camp.players || {})[ch.owner] || {}).role === "gm";
  const shown = h.shownName(camp, { charId: id, name: ch.name });
  const say = (text, toOwner) => h.addChat(camp, gmOwned ? { system: true, to: ["@gm"], private: true, text } : toOwner ? { system: true, to: ["@gm", ch.owner], private: true, text } : { system: true, text });
  const c = clean(ch.craft) || { pending: [] }, pend = c.pending;
  const save = (list) => { if (list.length) ch.craft = { pending: list }; else delete ch.craft; };
  const find = () => { const x = pend.find((q) => q.id === String(p.id || "")); if (!x) throw new h.Invalid("No such request."); return x; };

  if (type === "craft.request") {   // the player asks; nothing is spent until the GM approves
    if (!mine) throw new h.Forbidden("not your character");
    const item = cleanItem(p.item);
    if (!item) throw new h.Invalid("Which item?");
    if (pend.length >= PENDING) throw new h.Invalid("Five crafts are waiting already.");
    const q = { id: crypto.randomBytes(6).toString("hex"), item, value: clamp(int(p.value), 0, MAX_VALUE), note: str(p.note, 200).trim(), at: Math.floor(Date.now() / 1000), ok: false,
      tool: str(p.tool, 60).trim() };   // the sheet's suggestion from the Item Specific Tools table; the GM's to change
    save([...pend, q]);
    h.addChat(camp, { system: true, to: ["@gm"], private: true, text: `🔨 ${ch.name} asks to craft ${item.name} (about ${q.value.toLocaleString("en-US")} cr)${q.note ? `: "${q.note}"` : ""}. Approve it on ${ch.name}'s gear tab.` });
    return { id: q.id };
  }
  if (type === "craft.cancel") {    // the player withdraws a request the GM hasn't approved yet
    if (!mine) throw new h.Forbidden("not your character");
    const q = find();
    if (q.ok) throw new h.Invalid("It's approved: roll it.");
    save(pend.filter((x) => x !== q));
    return {};
  }
  if (type === "craft.decide") {    // the GM: no, or yes with the value, days, materials and tool (the book's by default)
    if (!gm) throw new h.Forbidden("GM only");
    const q = find();
    if (q.ok) throw new h.Invalid("Already approved.");
    if (!p.ok) {
      save(pend.filter((x) => x !== q));
      say(`🔨 The GM turned down ${shown}'s request to craft ${q.item.name}.`, true);
      return { ok: false };
    }
    const value = clamp(int(p.value, q.value), 0, MAX_VALUE);
    const days = clamp(int(p.days, Math.max(1, Math.ceil(value / 250))), 0, MAX_DAYS), cost = clamp(int(p.cost, Math.floor(value / 2)), 0, MAX_VALUE);
    const tool = str(p.tool, 60).trim() || q.tool || "the appropriate tools";
    const e = Downtime.spend(ch, { act: "crafting", days, cr: -cost, text: `Crafting ${q.item.name}: approved, waiting for the roll.` }, h);
    const now = (clean(ch.craft) || { pending: [] }).pending.map((x) => (x.id === q.id ? Object.assign({}, x, { ok: true, value, days, cost, tool, entry: e.id }) : x));
    save(now);
    say(`🔨 ${shown}: crafting ${q.item.name} approved (${days} day${days === 1 ? "" : "s"}, −${cost.toLocaleString("en-US")} cr in materials). ${shown} rolls Intelligence with ${tool}.`);
    return { ok: true };
  }
  if (type === "craft.roll") {      // the character rolls (from the sheet, on the server)
    if (!mine) throw new h.Forbidden("not your character");
    const q = find();
    if (!q.ok) throw new h.Invalid("The GM hasn't approved this yet.");
    const tables = p[ACT_TABLES], act = tables && own(tables, "crafting") ? tables.crafting : null;
    if (!act) throw new h.Invalid("Couldn't read SW5e's crafting tables just now. Try again in a moment.");
    const tier = R.toolTierFromText ? R.toolTierFromText(ch, q.tool) : 0, b = R.toolBonus ? R.toolBonus(ch, "int", tier) : R.abilityMod(ch, "int");
    const expr = R.checkRollExpr ? R.checkRollExpr(ch, tier, b).expr : `1d20${b >= 0 ? "+" : ""}${b}`;
    const roll = h.rollDice(expr);
    h.addChat(camp, Object.assign({ from: shown, fromId: gmOwned ? "@gm" : ch.owner, roll: Object.assign({}, roll, { expr, label: `Crafting ${q.item.name}: Intelligence (${q.tool})`.slice(0, 120), kind: "check" }) },
      shown === ch.name ? { charName: ch.name } : {}, gmOwned ? { to: ["@gm"], private: true } : {}));
    const rar = (act.rarity || []).find((r) => r.r === (q.item.rar || "Standard"));
    const d100 = h.rollDice("1d100").total, res = Downtime.resolve(act, roll.total, d100, rar ? rar.mod : 0);
    const factor = materialsFactor(res.text), extra = Math.round(q.cost * factor) - q.cost;
    const have = Number.isFinite(+ch.credits) ? +ch.credits : 0, charged = extra > 0 ? Math.min(extra, have) : extra;
    ch.credits = have - charged;
    ch.equipment = (Array.isArray(ch.equipment) ? ch.equipment : []).concat([Object.assign({}, q.item, { notes: q.item.notes || "crafted" })]);
    const how = `Intelligence ${roll.total} → ${res.mod >= 0 ? "+" : ""}${res.mod}; d100 ${d100}${rar && rar.mod ? ` ${rar.mod >= 0 ? "+" : ""}${rar.mod} (${rar.r})` : ""} → ${res.final}: ${res.text}`
      + (charged > 0 ? ` (−${charged.toLocaleString("en-US")} cr more${charged < extra ? `; ${(extra - charged).toLocaleString("en-US")} cr short` : ""})` : charged < 0 ? ` (+${(-charged).toLocaleString("en-US")} cr back)` : "");
    const d = Downtime.clean(ch.downtime);
    if (d) ch.downtime = Object.assign({}, d, { log: d.log.map((e) => (e.id === q.entry ? Object.assign({}, e, { cr: e.cr - charged, text: `Crafted ${q.item.name}. ${how}`.slice(0, 500) }) : e)) });
    save((clean(ch.craft) || { pending: [] }).pending.filter((x) => x.id !== q.id));
    say(`🔨 ${shown} crafts ${q.item.name}. ${how}`);
    // complications: Wretched Hives' chance for each workweek (five days) spent, the GM's to play out
    for (let w = 0; w < Math.max(1, Math.ceil(q.days / 5)); w++) {
      if (!act.complPct || h.rollDice("1d100").total > act.complPct) continue;
      const n = act.compls && act.compls.length ? act.compls[(h.rollDice(`1d${act.dieN || act.compls.length}`).total - 1) % act.compls.length] : "";
      h.addChat(camp, { system: true, to: ["@gm"], private: true, text: `🔨 A complication for ${ch.name}'s crafting${n ? `: ${n}` : " (yours to decide)"}.` });
      break;
    }
    return { total: roll.total, final: res.final, factor };
  }
  throw new h.Invalid("Unknown action.");
}

module.exports = { clean, cleanItem, materialsFactor, handles, apply, ACT_TABLES };
