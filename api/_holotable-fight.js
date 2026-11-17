// HoloTable combat view: the fight actions on the server. Not a route. Off until the GM switches it on: until then
// every fight.* action but the GM's switch is refused, nothing is written, and players and the GM see the table as before.
//
// The rules are in sections/jpesus/holotable/combat/engine.js (pure, shared with the browser). This file turns the
// table into the engine's "world", checks who may act, lets the engine decide, and writes the result back to the
// table through HoloTable's own actions where one exists (token.move, init.update, init.next). It also keeps an undo
// stack for the GM and builds what each person may see of the fight.
//
// Who may act: the player who owns the character whose turn it is, or the GM (who also plays every creature).
// A player's world leaves out hidden creatures and hidden tokens entirely, so they can't be targeted, can't block a
// move, can't tilt a roll, and are never named. Everything is decided here; the browser's preview is only a preview.
// Helpers from _holotable-game.js are passed in (no circular require).

const E = require("../sections/jpesus/holotable/combat/engine.js");
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;

const UNDO_MAX = 20, EVENTS_MAX = 30;
// the conditions the DM can set from the combat view: HoloTable's list, plus SW5e's levelled ones until #77 brings them to rules.js
const CONDS = new Set([...Object.keys((R && R.CONDITIONS) || {}), ...Object.keys(E.CONDITION_EFFECTS), "Deafened", "Diseased"]);
const ID = /^[a-z0-9]{6,20}$/;
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => Date.now() / 1000;
const plainObj = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});

// The fight's own state, with its shape checked every time (a backup restore can bring anything back).
function state(camp) {
  const f = plainObj(camp.fight);
  const ids = (o, ok) => Object.fromEntries(Object.entries(plainObj(o)).filter(([k, v]) => ID.test(k) && ok(v)));
  camp.fight = {
    on: !!f.on,
    links: ids(f.links, (v) => typeof v === "string" && ID.test(v)),
    // a creature's numbers from its stat block (the GM's screen sends them): speed, and save bonuses
    npc: Object.fromEntries(Object.entries(plainObj(f.npc)).filter(([k]) => ID.test(k)).map(([k, v]) => {
      const o = typeof v === "object" && v ? v : { speed: v };
      const abl = (x, lo, hi) => Object.fromEntries(Object.entries(plainObj(x)).filter(([ab, n]) => ["str", "dex", "con", "int", "wis", "cha"].includes(ab) && Number.isFinite(+n)).map(([ab, n]) => [ab, clamp(int(n), lo, hi)]));
      return [k, Object.assign({ speed: clamp(int(o.speed, 30), 0, 200), saves: abl(o.saves, -10, 30), mods: abl(o.mods, -5, 15) }, defences(o))];
    })),
    // a character's resistances, immunities and vulnerabilities (set by its owner or the GM in the combat view)
    defenses: Object.fromEntries(Object.entries(plainObj(f.defenses)).filter(([k]) => ID.test(k)).slice(0, 60).map(([k, v]) => [k, defences(plainObj(v))])),
    // the table's ability data, by power name (issue #73): the GM fills it in; a power without data works as before
    lib: Object.fromEntries(Object.entries(plainObj(f.lib)).slice(0, 300).map(([k, v]) => [str(k, 80).toLowerCase(), E.cleanAbility(v)]).filter(([k, v]) => k && v)),
    // what each unit has spent of its turn (movement in feet, action, bonus action, reaction), since its turn began
    spent: Object.fromEntries(Object.entries(plainObj(f.spent)).filter(([k, v]) => ID.test(k) && v && typeof v === "object")
      .map(([k, v]) => [k, { key: str(v.key, 40), move: clamp(int(v.move), 0, 1000), action: clamp(int(v.action), 0, 9), bonus: clamp(int(v.bonus), 0, 9), reaction: clamp(int(v.reaction), 0, 9) }])),
    undo: (Array.isArray(f.undo) ? f.undo : []).filter((x) => x && typeof x === "object").slice(-UNDO_MAX).map(cleanSnap),
    events: (Array.isArray(f.events) ? f.events : []).filter((x) => x && typeof x === "object").slice(-EVENTS_MAX).map((ev) => ({
      seq: int(ev.seq), at: +ev.at || 0, kind: ["move", "hit", "crit", "miss", "heal"].includes(ev.kind) ? ev.kind : "move",
      token: typeof ev.token === "string" && ID.test(ev.token) ? ev.token : null, amount: ev.amount == null ? null : clamp(int(ev.amount), 0, 100000),
      feet: ev.feet == null ? null : clamp(int(ev.feet), 0, 1000), hidden: !!ev.hidden })),
    seq: int(f.seq),
    // timed effects from abilities (a condition on a unit until the start or end of someone's turn, or a save) and
    // who is concentrating on what (issue #72, audit 4.6)
    effects: (Array.isArray(f.effects) ? f.effects : []).filter((x) => x && typeof x === "object" && ID.test(String(x.unit || ""))).slice(0, 200).map((x) => ({
      id: str(x.id, 120), unit: x.unit, condition: str(x.condition, 30), ends: ["start", "end", "never"].includes(x.ends) ? x.ends : "end", of: ID.test(String(x.of || "")) ? x.of : x.unit,
      level: clamp(int(x.level), 0, 4), amount: E.DICE.test(String(x.amount || "")) ? str(x.amount, 24) : "",
      rounds: clamp(int(x.rounds, 1), 1, 100), save: x.save && typeof x.save === "object" ? { ability: ["str", "dex", "con", "int", "wis", "cha"].includes(x.save.ability) ? x.save.ability : "con", dc: clamp(int(x.save.dc, 10), 1, 40) } : null,
      source: ID.test(String(x.source || "")) ? x.source : null, conc: !!x.conc })),
    conc: Object.fromEntries(Object.entries(plainObj(f.conc)).filter(([k, v]) => ID.test(k) && typeof v === "string").map(([k, v]) => [k, str(v, 80)])),
    lastTurn: str(f.lastTurn, 60),
  };
  return camp.fight;
}

// damage defences as the engine reads them: [{ type, only }], for resist / immune / vuln, plus condition immunities
function defences(o) {
  const list = (v) => (Array.isArray(v) ? v : []).slice(0, 13).filter((d) => d && E.DAMAGE.includes(d.type)).map((d) => ({ type: d.type, only: d.only === "unenhanced" ? "unenhanced" : null }));
  return { resist: list(o.resist), immune: list(o.immune), vuln: list(o.vuln), condImmune: (Array.isArray(o.condImmune) ? o.condImmune : []).slice(0, 20).map((c) => str(c, 30)) };
}
// an undo snapshot with every field reshaped (a backup restore could bring anything back)
function cleanSnap(x) {
  const num = (v, a, b) => clamp(Number.isFinite(+v) ? +v : 0, a, b);
  const nul = (v) => (v == null || v === "" ? null : num(v, -1000, 100000));
  const ini = plainObj(x.ini);
  return {
    label: str(x.label, 120), at: +x.at || 0, seq: int(x.seq),
    ini: { turnId: typeof ini.turnId === "string" && ID.test(ini.turnId) ? ini.turnId : null, round: Math.max(1, int(ini.round, 1)), active: !!ini.active },
    spent: plainObj(x.spent),
    tokens: (Array.isArray(x.tokens) ? x.tokens : []).slice(0, 300).filter((t) => Array.isArray(t) && typeof t[0] === "string").map((t) => [t[0], num(t[1], -500, 1000), num(t[2], -500, 1000)]),
    hp: (Array.isArray(x.hp) ? x.hp : []).slice(0, 300).filter((h) => Array.isArray(h) && typeof h[0] === "string")
      .map((h) => [h[0], nul(h[1]), Array.isArray(h[2]) ? [num(h[2][0], -1000, 100000), num(h[2][1], 0, 100000)] : null]),
    effects: Array.isArray(x.effects) ? state({ fight: { effects: x.effects } }).effects : [],
    conc: Object.fromEntries(Object.entries(plainObj(x.conc)).filter(([k, v]) => ID.test(k) && typeof v === "string").map(([k, v]) => [k, str(v, 80)])),
    lastTurn: str(x.lastTurn, 60),
    conds: (Array.isArray(x.conds) ? x.conds : []).slice(0, 300).filter((c) => Array.isArray(c) && typeof c[0] === "string")
      .map(([id, ec, cc]) => [id, (Array.isArray(ec) ? ec : []).slice(0, 20).map((c) => str(c, 30)), Array.isArray(cc) ? cc.slice(0, 20).map((c) => str(c, 30)) : null]),
    chars: (Array.isArray(x.chars) ? x.chars : []).slice(0, 60).filter((c) => Array.isArray(c) && typeof c[0] === "string" && c[1] && typeof c[1] === "object")
      .map(([id, r]) => [id, { resources: E.cleanResources(r.resources),
        force: { max: plainObj(r.force).max == null || plainObj(r.force).max === "" ? "" : num(plainObj(r.force).max, 0, 999), used: num(plainObj(r.force).used, 0, 999) },
        tech: { max: plainObj(r.tech).max == null || plainObj(r.tech).max === "" ? "" : num(plainObj(r.tech).max, 0, 999), used: num(plainObj(r.tech).used, 0, 999) },
        hitDiceUsed: num(r.hitDiceUsed, 0, 40) }]),
  };
}

// Which token is each combatant's: a character's own token; for a creature, the token the GM linked or, as HoloTable
// already does to mark the current turn on the map, the token with the creature's name.
function unitTokens(camp) {
  const links = plainObj((camp.fight || {}).links), tokens = camp.map.tokens || [], used = new Set(), out = {};
  for (const e of camp.initiative.entries) {
    let t = e.charId ? tokens.find((x) => x.charId === e.charId) : null;
    if (!t && !e.charId && links[e.id]) t = tokens.find((x) => x.id === links[e.id] && !x.charId);
    if (!t && !e.charId) t = tokens.find((x) => !x.charId && !used.has(x.id) && x.name === e.name);
    if (t) { out[e.id] = t.id; used.add(t.id); }
  }
  return out;
}
const hiddenEntry = (camp, e, tokenId) => !!e.hidden || !!((camp.map.tokens || []).find((t) => t.id === tokenId) || {}).hidden;

// The engine's world. For a player (forPlayer) hidden combatants are not in it at all.
function worldOf(camp, forPlayer) {
  const ini = camp.initiative, f = camp.fight || {};
  const ut = unitTokens(camp);
  const entries = forPlayer ? ini.entries.filter((e) => !hiddenEntry(camp, e, ut[e.id])) : ini.entries;
  const cur = ini.entries[ini.turn];
  return E.buildWorld({
    characters: camp.characters, entries, active: ini.active, turnId: cur && entries.includes(cur) ? cur.id : null, round: ini.round,
    tokens: camp.map.tokens, unitTokens: ut, spent: f.spent || {}, effects: f.effects || [], conc: f.conc || {},
    npcSpeed: Object.fromEntries(Object.entries(f.npc || {}).map(([k, v]) => [k, typeof v === "object" && v ? v.speed : v])),
    npcStats: Object.fromEntries(Object.entries(f.npc || {}).map(([k, v]) => [k, typeof v === "object" && v ? v : {}])),
    defenses: f.defenses || {},
  }, R);
}

function mayAct(camp, cid, gm, entry) {
  if (gm) return true;
  if (!entry || !entry.charId) return false;          // creatures are the GM's
  const ch = camp.characters[entry.charId];
  return !!ch && ch.owner === cid;
}

// A creature's attack comes from the GM's screen (its stat block), so it is checked like any GM input; the critical
// dice are worked out here, never taken from the request.
function cleanSpec(a, G) {
  if (!a || typeof a !== "object") throw new G.Invalid("Pick an attack.");
  const damage = str(a.damage, 40).replace(/\s+/g, "");
  if (!/^[0-9d+\-]{1,40}$/i.test(damage)) throw new G.Invalid("That damage isn't a dice expression.");
  G.rollDice(damage);   // throws Invalid if it can't be read
  const range = Array.isArray(a.range) && a.range.length === 2 ? [clamp(int(a.range[0]), 0, 2000), clamp(int(a.range[1]), 0, 2000)] : null;
  const spec = {
    name: str(a.name, 80) || "Attack", bonus: clamp(int(a.bonus), -10, 40), damage, type: str(a.type, 20),
    melee: clamp(int(a.melee), 0, 120), range: range && range[0] > 0 ? [range[0], Math.max(range[0], range[1])] : null,
  };
  if (!spec.melee && !spec.range) spec.melee = E.FT;
  spec.crit = damage.replace(/(\d*)d(\d+)/gi, (_, n, s) => (2 * (+n || 1)) + "d" + s);
  return spec;
}

// ---- undo: what one fight action can change (token squares, hit points, the turn and its budget)
function snapshot(camp, label) {
  const f = camp.fight, ini = camp.initiative, ut = unitTokens(camp), tok = new Set(Object.values(ut));
  f.undo.push({
    label: str(label, 120), at: now(), seq: f.seq,
    ini: { turnId: (ini.entries[ini.turn] || {}).id || null, round: ini.round, active: ini.active },
    spent: JSON.parse(JSON.stringify(f.spent || {})),
    effects: JSON.parse(JSON.stringify(f.effects || [])), conc: Object.assign({}, f.conc), lastTurn: f.lastTurn || "",
    conds: ini.entries.map((e) => [e.id, (e.conditions || []).slice(), e.charId && camp.characters[e.charId] ? (camp.characters[e.charId].conditions || []).slice() : null]),
    chars: Object.values(camp.characters).map((c) => [c.id, JSON.parse(JSON.stringify({ resources: c.resources || [], force: c.force, tech: c.tech, hitDiceUsed: c.hitDiceUsed }))]),
    tokens: (camp.map.tokens || []).filter((t) => tok.has(t.id)).map((t) => [t.id, t.x, t.y]),
    hp: ini.entries.map((e) => [e.id, e.hp, e.charId && camp.characters[e.charId] ? [camp.characters[e.charId].hp.current, camp.characters[e.charId].hp.temp] : null]),
  });
  if (f.undo.length > UNDO_MAX) f.undo.splice(0, f.undo.length - UNDO_MAX);
}
function restore(camp, s) {
  const f = camp.fight, ini = camp.initiative;
  for (const [id, x, y] of s.tokens || []) { const t = (camp.map.tokens || []).find((k) => k.id === id); if (t) { t.x = x; t.y = y; } }
  for (const [id, hp, ch] of s.hp || []) {
    const e = ini.entries.find((k) => k.id === id);
    if (!e) continue;
    e.hp = hp;
    if (ch && e.charId && camp.characters[e.charId]) { camp.characters[e.charId].hp.current = ch[0]; camp.characters[e.charId].hp.temp = ch[1]; }
  }
  const i = ini.entries.findIndex((k) => k.id === s.ini.turnId);
  if (i >= 0) ini.turn = i;
  ini.round = s.ini.round; ini.active = s.ini.active;
  f.spent = s.spent || {};
  for (const [id, r] of s.chars || []) if (camp.characters[id]) Object.assign(camp.characters[id], r);
  if (Array.isArray(s.effects)) f.effects = s.effects;
  if (s.conc) f.conc = s.conc;
  if (typeof s.lastTurn === "string") f.lastTurn = s.lastTurn;
  for (const [id, ec, cc] of s.conds || []) {
    const e = ini.entries.find((k) => k.id === id);
    if (e) e.conditions = ec;
    if (e && cc && e.charId && camp.characters[e.charId]) camp.characters[e.charId].conditions = cc;
  }
  f.events = f.events.filter((ev) => ev.seq <= s.seq);
}

// ---- writing the engine's answer back to the table
function writeBack(camp, cid, before, after, G) {
  const f = camp.fight;
  for (const [id, a] of Object.entries(after.units)) {
    const b = before.units[id];
    if (!b) continue;
    if (a.x !== b.x || a.y !== b.y) G.applyAction(camp, cid, true, "token.move", { id: a.tokenId, x: a.x, y: a.y });
    if (a.hp !== b.hp && a.hp != null) G.applyAction(camp, cid, true, "init.update", { id, fields: { hp: a.hp } });
    if (a.temp !== b.temp && a.charId && camp.characters[a.charId]) camp.characters[a.charId].hp.temp = a.temp;
    // points spent by an ability go back where the sheet keeps them
    if (a.charId && camp.characters[a.charId]) {
      for (const [key, pool] of Object.entries(a.pools || {})) {
        if (!b.pools[key] || b.pools[key].used === pool.used) continue;
        const ch = camp.characters[a.charId], next = E.setPoolUsed(ch, key, pool.used, R);
        Object.assign(ch, { resources: next.resources, force: next.force, tech: next.tech, hitDiceUsed: next.hitDiceUsed });
      }
    }
  }
  f.spent = after.spent || {};
  if (after.effects) f.effects = after.effects;
  if (after.conc) f.conc = after.conc;
  // conditions the engine gave or took away: on the tracker entry, and on the sheet for a character
  for (const [id, a] of Object.entries(after.units)) {
    const b = before.units[id];
    if (!b || JSON.stringify(a.conditions || []) === JSON.stringify(b.conditions || [])) continue;
    G.applyAction(camp, cid, true, "init.update", { id, fields: { conditions: a.conditions || [] } });
    if (a.charId && camp.characters[a.charId]) camp.characters[a.charId].conditions = (a.conditions || []).slice(0, 20);
  }
}
// The turn moved on since the last combat step (End turn, or the tracker's Next): effects that end now go, and
// save-ends effects roll their save. Done at the next combat action, never on a read, so a poll changes nothing.
function tick(camp, cid, G) {
  const f = camp.fight, ini = camp.initiative, cur = ini.entries[ini.turn];
  const key = ini.active && cur ? `${ini.round}:${cur.id}:${ini.turn}` : "";
  if (!key || key.split(":").slice(0, 2).join(":") === (f.lastTurn || "").split(":").slice(0, 2).join(":")) return;
  const [lr, prevId, lt] = (f.lastTurn || "").split(":");
  f.lastTurn = key;
  // the tracker stepped back (Prev): nothing ends, nothing is saved against; the DM undoes or edits what should come back
  if (lt !== undefined && (ini.round < +lr || (ini.round === +lr && ini.turn < +lt))) return;
  if (!f.effects.length && !Object.keys(f.conc).length) return;
  const before = worldOf(camp, false);
  const r = E.turnPassed(before, prevId || null, cur.id, (expr) => G.rollDice(expr));
  writeBack(camp, cid, before, r.world, G);
  for (const line of r.log) {
    const hidden = line.unit && hiddenEntry(camp, ini.entries.find((e) => e.id === line.unit) || {}, (before.units[line.unit] || {}).tokenId);
    const msg = line.roll ? { from: "Combat", fromId: "@gm", fight: true, roll: { total: line.roll.total, detail: line.roll.detail, nat: line.roll.nat == null ? null : line.roll.nat, expr: line.expr, label: str(line.text, 200), kind: line.kind } }
      : { system: true, text: str(line.text, 200) };
    if (hidden) { msg.to = ["@gm"]; msg.private = true; msg.fromId = "@gm"; }
    G.addChat(camp, msg);
  }
}

function apply(camp, cid, gm, type, p, G) {
  // off (the default): only the GM's switch does anything, and switching it off when it was never on writes nothing
  if (!camp.fight || !camp.fight.on) {
    if (type !== "fight.toggle") throw new G.Invalid("The combat view is off.");
    if (!gm) throw new G.Forbidden("GM only");
    if (!p.on && !camp.fight) return {};
  }
  const f = state(camp), ini = camp.initiative;
  const need = (ok, why = "GM only") => { if (!ok) throw new G.Forbidden(why); };
  const entry = (id) => ini.entries.find((e) => e.id === id);
  switch (type) {
    case "fight.toggle": {
      need(gm);
      f.on = !!p.on;
      G.addChat(camp, { system: true, text: f.on ? "The GM switched the combat view on." : "The GM switched the combat view off." });
      return {};
    }
    case "fight.npc": {      // a creature's speed and save bonuses, from its stat block
      need(gm);
      const e = entry(p.id);
      if (!e || e.charId) throw new G.Invalid("No such creature.");
      // defences arrive as the stat block's own lines ("Kinetic from unenhanced weapons") and are read here
      const lines = (v) => (Array.isArray(v) ? v : []).slice(0, 12).map((x) => str(x, 80));
      const abl = (x, lo, hi) => Object.fromEntries(Object.entries(plainObj(x)).filter(([ab, n]) => ["str", "dex", "con", "int", "wis", "cha"].includes(ab) && Number.isFinite(+n)).map(([ab, n]) => [ab, clamp(int(n), lo, hi)]));
      f.npc[e.id] = Object.assign({ speed: clamp(int(p.speed, 30), 0, 200), saves: abl(p.saves, -10, 30), mods: abl(p.mods, -5, 15) },
        defences({ resist: E.readDefenses(lines(p.resist)), immune: E.readDefenses(lines(p.immune)), vuln: E.readDefenses(lines(p.vuln)), condImmune: lines(p.condImmune) }));
      return {};
    }
    case "fight.defenses": { // a character's resistances, immunities and vulnerabilities (its owner or the GM)
      const ch = camp.characters[p.charId];
      if (!ch) throw new G.Invalid("No such character.");
      need(gm || ch.owner === cid, "not your character");
      const types = (v) => (Array.isArray(v) ? v : []).filter((x) => E.DAMAGE.includes(x)).map((type) => ({ type, only: null }));
      f.defenses[ch.id] = defences({ resist: types(p.resist), immune: types(p.immune), vuln: types(p.vuln) });
      return {};
    }
    case "fight.ability": {  // the GM teaches the table a power's numbers (or forgets them: data null)
      need(gm);
      const name = str(p.name, 80).trim().toLowerCase();
      if (!name) throw new G.Invalid("Which power?");
      if (p.data == null) { delete f.lib[name]; return {}; }
      const data = E.cleanAbility(p.data);
      if (!data) throw new G.Invalid("That ability needs an attack, a save, damage, healing or a condition.");
      if (!f.lib[name] && Object.keys(f.lib).length >= 300) throw new G.Invalid("That's the most powers the table can hold data for (300).");
      f.lib[name] = data;
      return {};
    }
    case "fight.link": {     // which token is this creature's (when names don't match)
      need(gm);
      const e = entry(p.id);
      if (!e || e.charId) throw new G.Invalid("No such creature.");
      if (p.token == null) delete f.links[e.id];
      else if ((camp.map.tokens || []).some((t) => t.id === p.token && !t.charId)) f.links[e.id] = p.token;
      else throw new G.Invalid("No such token.");
      return {};
    }
    case "fight.hp": {       // the GM sets anyone's hit points (and a character's temporary hit points)
      need(gm);
      const e = entry(p.id);
      if (!e) throw new G.Invalid("No such combatant.");
      snapshot(camp, `set ${e.name}'s hit points`);
      if (p.hp !== undefined && p.hp !== null && p.hp !== "") G.applyAction(camp, cid, true, "init.update", { id: e.id, fields: { hp: clamp(int(p.hp), -1000, 100000) } });
      if (p.temp !== undefined && e.charId && camp.characters[e.charId]) camp.characters[e.charId].hp.temp = clamp(int(p.temp), 0, 100000);
      return {};
    }
    case "fight.spend": {    // spend from a character's resource (its owner or the GM); undoable like a combat step
      const ch = camp.characters[p.charId];
      if (!ch) throw new G.Invalid("No such character.");
      need(gm || ch.owner === cid, "not your character");
      const r = E.spend(ch, String(p.key || ""), p.n == null ? 1 : p.n, R);
      if (!r.ok) throw new G.Invalid(r.why);
      snapshot(camp, `${ch.name} used ${r.res.name}`);
      Object.assign(ch, { resources: r.ch.resources, force: r.ch.force, tech: r.ch.tech, hitDiceUsed: r.ch.hitDiceUsed });
      G.addChat(camp, { system: true, text: `${ch.name} uses ${r.res.name}: ${r.res.max - r.res.used} of ${r.res.max} left.` });
      return {};
    }
    case "fight.resource": { // add, change or remove one of a character's own resources (its owner or the GM)
      const ch = camp.characters[p.charId];
      if (!ch) throw new G.Invalid("No such character.");
      need(gm || ch.owner === cid, "not your character");
      const list = E.cleanResources(ch.resources);
      const [res] = E.cleanResources([p.res]);
      if (p.op === "remove") ch.resources = list.filter((x) => x.key !== String(p.key || ""));
      else {
        if (!res) throw new G.Invalid("A resource needs a name, a maximum and a key.");
        const i = list.findIndex((x) => x.key === res.key);
        if (i >= 0) list[i] = res; else if (list.length >= 30) throw new G.Invalid("That's the most resources one character can have (30)."); else list.push(res);
        ch.resources = list;
      }
      return {};
    }
    case "fight.undo": {
      need(gm);
      const s = f.undo.pop();
      if (!s) throw new G.Invalid("Nothing to undo.");
      restore(camp, s);
      G.addChat(camp, { system: true, text: `The GM undid the last combat step (${s.label}).` });
      return {};
    }
    case "fight.condition": {   // the DM puts a condition on a combatant (a level, a damage amount, who caused it) or takes it off
      need(gm);
      if (!f.on) throw new G.Invalid("The combat view is off.");
      const name = str(p.condition, 30);
      if (!CONDS.has(name)) throw new G.Invalid("That isn't a condition HoloTable knows.");
      const world = worldOf(camp, false), unit = String(p.unit || "");
      const r = E.setCondition(world, { unit, condition: name, op: p.op === "remove" ? "remove" : "add", level: int(p.level), amount: str(p.amount, 24), source: p.source ? String(p.source) : null });
      if (!r.ok) throw new G.Invalid(r.why);
      snapshot(camp, `${name} ${p.op === "remove" ? "taken off" : "put on"} ${world.units[unit].name}`);
      writeBack(camp, cid, world, r.world, G);
      const ut = unitTokens(camp), isHidden = (id) => !!id && hiddenEntry(camp, entry(id) || {}, ut[id]);
      for (const line of r.log) G.addChat(camp, Object.assign({ system: true, text: str(line.text, 200) }, isHidden(line.unit) || isHidden(line.about) ? { to: ["@gm"], private: true } : {}));
      return {};
    }
    case "fight.move": case "fight.attack": case "fight.end": case "fight.use": case "fight.stand": case "fight.douse": {
      if (!f.on) throw new G.Invalid("The combat view is off.");
      const cur = ini.entries[ini.turn];
      if (!ini.active || !cur) throw new G.Invalid("Combat hasn't started: start initiative first.");
      need(mayAct(camp, cid, gm, cur), "It's not your turn.");
      tick(camp, cid, G);
      // an area catches whoever is in it, hidden or not; only its rolls about a hidden one stay with the GM
      const areaUse = type === "fight.use" && cur.charId && (() => {
        const ch = camp.characters[cur.charId];
        const ab = ch && E.abilitiesOf(ch, R, f.lib).find((a) => a.key === String(p.ability || ""));
        return !!(ab && ab.area);
      })();
      const world = worldOf(camp, !gm && !areaUse);
      if (type === "fight.end" && !world.units[cur.id]) {      // a combatant with no token can still pass the turn
        snapshot(camp, `${cur.name} ends the turn`);
        G.applyAction(camp, cid, true, "init.next", {});
        tick(camp, cid, G);
        return {};
      }
      let act;
      if (type === "fight.move") act = { type: "move", unit: cur.id, x: p.x, y: p.y };
      else if (type === "fight.end") act = { type: "end", unit: cur.id };
      else if (type === "fight.stand") act = { type: "stand", unit: cur.id };
      else if (type === "fight.douse") act = { type: "douse", unit: cur.id, target: String(p.target || "") };
      else if (type === "fight.use") {
        const ch = cur.charId && camp.characters[cur.charId];
        if (!ch) throw new G.Invalid("Creatures use their attacks for now.");
        const ability = E.abilitiesOf(ch, R, f.lib).find((a) => a.key === String(p.ability || ""));
        if (!ability) throw new G.Invalid("The table has no data for that ability on this sheet.");
        const point = p.point && Number.isFinite(+p.point.x) && Number.isFinite(+p.point.y) ? { x: clamp(+p.point.x, -500, 1000), y: clamp(+p.point.y, -500, 1000) } : null;
        act = { type: "use", unit: cur.id, ability, point, targets: Array.isArray(p.targets) ? p.targets.slice(0, 40).map(String) : [String(p.target || "")], upcast: clamp(int(p.upcast), 0, 9), adv: !!p.adv, dis: !!p.dis };
      }
      else {
        let spec;
        if (cur.charId) {
          const ch = camp.characters[cur.charId];
          spec = ch && E.attacksOf(ch, R).find((a) => a.key === String(p.attack));
          if (!spec) throw new G.Invalid("That attack isn't on the sheet.");
        } else spec = cleanSpec(p.attack, G);
        act = { type: "attack", unit: cur.id, target: String(p.target || ""), attack: spec, adv: !!p.adv, dis: !!p.dis };
      }
      const r = E.apply(world, act, (expr) => G.rollDice(expr));
      if (!r.ok) throw new G.Invalid(r.why);
      const label = type === "fight.douse" ? `${cur.name} put out flames` : type === "fight.stand" ? `${cur.name} stood up` : type === "fight.move" ? `${cur.name} moved` : type === "fight.end" ? `${cur.name} ended the turn` : type === "fight.use" ? `${cur.name} used ${act.ability.name}` : `${cur.name}'s attack`;
      snapshot(camp, label);
      writeBack(camp, cid, world, r.world, G);
      // the roll lines go to chat as rolls, the way HoloTable shows every roll; a hidden creature's go to the GM only
      const secret = hiddenEntry(camp, cur, unitTokens(camp)[cur.id]);
      const ch = cur.charId && camp.characters[cur.charId];
      const ut = unitTokens(camp), isHidden = (id) => !!id && hiddenEntry(camp, entry(id) || {}, ut[id]);
      for (const [i, line] of r.log.entries()) {
        if (!line.roll) {   // plain lines go to chat (a condition ending, concentration lost), but not "moves 10 ft." or "ends the turn."
          if (i === 0 && (type === "fight.move" || type === "fight.end")) continue;
          G.addChat(camp, Object.assign({ system: true, text: str(line.text, 200) }, secret || isHidden(line.unit) || isHidden(line.about) ? { to: ["@gm"], private: true } : {}));
          continue;
        }
        const msg = { from: G.playerName(camp, cid), fromId: cid, fight: true,
          roll: { total: line.roll.total, detail: line.roll.detail, nat: line.roll.nat == null ? null : line.roll.nat, expr: line.expr, label: str(line.text, 200), kind: line.kind } };
        if (ch) msg.charName = ch.name;
        const aboutHidden = line.unit && hiddenEntry(camp, entry(line.unit) || {}, (world.units[line.unit] || {}).tokenId);
        if (secret || aboutHidden) {
          msg.to = ["@gm"]; msg.private = true;
          // HoloTable shows a message to its sender too, so a line about a hidden creature can't come from the player
          if (!gm) { msg.fromId = "@gm"; msg.from = "Combat (GM only)"; delete msg.charName; }
        }
        G.addChat(camp, msg);
      }
      if (secret) {   // what everyone can see: the hit on someone they can see
        for (const ev of r.events) {
          const t = world.units[ev.unit];
          if (t && (ev.kind === "hit" || ev.kind === "crit") && !hiddenEntry(camp, entry(t.id) || {}, t.tokenId)) G.addChat(camp, { system: true, text: `${t.name} is hit for ${ev.amount} damage.` });
        }
      }
      for (const ev of r.events) {
        const u = r.world.units[ev.unit];
        f.events.push({ seq: ++f.seq, at: now(), kind: ev.kind, token: u ? u.tokenId : null, amount: ev.amount == null ? null : ev.amount, feet: ev.feet == null ? null : ev.feet,
          hidden: secret && ev.kind === "move" ? true : hiddenEntry(camp, entry(ev.unit) || {}, u && u.tokenId) });
      }
      if (f.events.length > EVENTS_MAX) f.events.splice(0, f.events.length - EVENTS_MAX);
      if (r.endTurn) { G.applyAction(camp, cid, true, "init.next", {}); tick(camp, cid, G); }
      return {};
    }
    default:
      throw new G.Invalid("unknown combat action");
  }
}

// What one person sees of the fight. Players get nothing about hidden combatants: not their turn, not their tokens'
// links, not their events. Only the GM gets the undo stack (as a count and a label) and creature speeds.
function view(camp, cid, gm) {
  const f = camp.fight;
  if (!f || !f.on) return { on: false };
  const ini = camp.initiative, ut = unitTokens(camp);
  const seen = (e) => gm || !hiddenEntry(camp, e, ut[e.id]);
  const units = {};
  for (const e of ini.entries) {
    if (!ut[e.id] || !seen(e)) continue;
    const ch = e.charId && camp.characters[e.charId];
    const hp = ch ? +ch.hp.current : e.hp;
    units[e.id] = { token: ut[e.id], side: e.charId ? "pc" : "npc", mine: !!ch && ch.owner === cid, down: hp != null && hp <= 0 };
  }
  const cur = ini.entries[ini.turn];
  const turn = ini.active && cur && seen(cur) ? cur.id : null;
  const world = worldOf(camp, !gm);
  const evs = (Array.isArray(f.events) ? f.events : []).filter((ev) => gm || !ev.hidden).slice(-15);
  return {
    on: true, active: !!ini.active, round: ini.round, turn, units,
    budget: turn ? E.budget(world) : null,
    // only for combatants this viewer can see: a hidden one's id, turn or movement never reaches a player
    spent: Object.fromEntries(Object.entries(f.spent || {}).filter(([id]) => units[id])),
    events: evs.map((ev) => ({ seq: ev.seq, at: ev.at, kind: ev.kind, token: ev.token, amount: ev.amount, feet: ev.feet })),
    undo: gm ? { n: (f.undo || []).length, last: ((f.undo || [])[(f.undo || []).length - 1] || {}).label || null } : null,
    npcSpeed: gm ? Object.fromEntries(Object.entries(f.npc || {}).map(([k, v]) => [k, typeof v === "object" && v ? v.speed : v])) : {},
    npcSaves: gm ? Object.fromEntries(Object.entries(f.npc || {}).map(([k, v]) => [k, (v && v.saves) || {}])) : {},
    npcMods: gm ? Object.fromEntries(Object.entries(f.npc || {}).map(([k, v]) => [k, (v && v.mods) || {}])) : {},
    npcDefenses: gm ? Object.fromEntries(Object.entries(f.npc || {}).map(([k, v]) => [k, defences(plainObj(v))])) : {},
    defenses: f.defenses || {},   // characters' own: as visible as their sheets
    lib: f.lib || {},
    effects: (f.effects || []).filter((ef) => units[ef.unit]).map((ef) => ({ unit: ef.unit, condition: ef.condition, ends: ef.ends, of: units[ef.of] ? ef.of : null, rounds: ef.rounds, save: ef.save, conc: ef.conc,
      level: ef.level || 0, amount: ef.amount || "", source: units[ef.source] ? ef.source : null })),   // a grappler or charmer the viewer can't see stays unnamed
    conc: Object.fromEntries(Object.entries(f.conc || {}).filter(([id]) => units[id])),
  };
}

// For the tracker's own Next and Prev (proposed on issue #72, not wired in): called right after HoloTable moves the
// turn, so effects end the moment the turn passes instead of at the next combat step. Does nothing while the view is off.
function turned(camp, cid, G) {
  if (!camp.fight || !camp.fight.on) return;
  state(camp);
  tick(camp, cid, G);
}

// A backup brought back: the record is checked like a live one, and what only made sense on the old table goes
// (the undo stack and the floating numbers).
function restored(g) {
  state(g);
  Object.assign(g.fight, { undo: [], events: [] });
}

module.exports = { apply, view, unitTokens, worldOf, state, turned, restored, cleanResources: E.cleanResources };
