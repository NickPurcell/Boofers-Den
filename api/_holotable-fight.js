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
const SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
// the conditions the DM can set from the combat view: HoloTable's list, plus SW5e's levelled ones until #77 brings them to rules.js
const CONDS = new Set([...Object.keys((R && R.CONDITIONS) || {}), ...Object.keys(E.CONDITION_EFFECTS), "Deafened", "Diseased"]);
const ID = /^[a-z0-9]{6,20}$/;
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => Date.now() / 1000;
const plainObj = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});
// a character by an id from a request or a stored record: the table's own only, never an inherited name ("__proto__") (#111)
const charOf = (camp, id) => (typeof id === "string" && Object.prototype.hasOwnProperty.call(camp.characters || {}, id) ? camp.characters[id] : undefined);

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
      return [k, Object.assign({ speed: clamp(int(o.speed, 30), 0, 200), saves: abl(o.saves, -10, 30), mods: abl(o.mods, -5, 15),
        sizeCat: o.sizeCat == null || o.sizeCat === "" ? null : clamp(int(o.sizeCat, 2), 0, 5), reach: clamp(int(o.reach, 5), 5, 30) }, defences(o))];
    })),
    // a character's resistances, immunities and vulnerabilities (set by its owner or the GM in the combat view)
    defenses: Object.fromEntries(Object.entries(plainObj(f.defenses)).filter(([k]) => ID.test(k)).slice(0, 60).map(([k, v]) => [k, defences(plainObj(v))])),
    // the table's ability data, by power name (issue #73): the GM fills it in; a power without data works as before
    lib: Object.fromEntries(Object.entries(plainObj(f.lib)).slice(0, 300).map(([k, v]) => [str(k, 80).toLowerCase(), E.cleanAbility(v)]).filter(([k, v]) => k && v)),
    // what each unit has spent of its turn (movement in feet, action, bonus action, reaction), since its turn began
    spent: Object.fromEntries(Object.entries(plainObj(f.spent)).filter(([k, v]) => ID.test(k) && v && typeof v === "object")
      .map(([k, v]) => [k, { key: str(v.key, 40), move: clamp(int(v.move), 0, 1000), action: clamp(int(v.action), 0, 9), bonus: clamp(int(v.bonus), 0, 9), reaction: clamp(int(v.reaction), 0, 9), diag: v.diag ? 1 : 0,
        dash: clamp(int(v.dash), 0, 9), disengage: v.disengage ? 1 : 0, dodge: v.dodge ? 1 : 0, ds: v.ds ? 1 : 0 }])),
    // reactions waiting for an answer: an opportunity attack someone may take (the turn waits until it's answered)
    pending: (Array.isArray(f.pending) ? f.pending : []).slice(0, 12).map(cleanPending).filter(Boolean),
    // a creature's limited abilities from its stat block (audit 9.5, issue #76): recharge, per day, legendary actions
    npcres: Object.fromEntries(Object.entries(plainObj(f.npcres)).filter(([k, v]) => ID.test(k) && Array.isArray(v)).slice(0, 300).map(([k, v]) => [k, cleanNpcRes(v)])),
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

// { key, name, max, used, refill: 'turn' | 'short' | 'long' | 'manual', recharge: 2..6 or null, cost }
// a creature's limited abilities; a points pool (a forcecaster's or techcaster's force or tech points, audit 9.5) holds
// up to 300 and is spent several at a time, a power's level + 1
function cleanNpcRes(list) {
  return (Array.isArray(list) ? list : []).slice(0, 40).filter((r) => r && typeof r === "object").map((r) => {
    const points = !!r.points, max = clamp(int(r.max, 1), 1, points ? 300 : 20);
    return { key: str(r.key, 40).toLowerCase().replace(/[^a-z0-9-]/g, ""), name: str(r.name, 80), max, used: clamp(int(r.used), 0, max),
      refill: ["turn", "short", "long", "manual"].includes(r.refill) ? r.refill : "manual", recharge: r.recharge == null ? null : clamp(int(r.recharge, 6), 2, 6),
      ...(points ? { points: true } : {}) };
  }).filter((r) => r.key && r.name);
}
function cleanPending(x) {
  if (!x || typeof x !== "object" || !ID.test(String(x.reactor || "")) || !ID.test(String(x.against || ""))) return null;
  const at = plainObj(x.at);
  return { id: str(x.id, 30), kind: "opportunity", reactor: x.reactor, against: x.against, at: { x: clamp(int(at.x), -500, 1000), y: clamp(int(at.y), -500, 1000) }, turn: str(x.turn, 60) };
}
// damage defences as the engine reads them: [{ type, only }], for resist / immune / vuln, plus condition immunities
function defences(o) {
  const list = (v) => (Array.isArray(v) ? v : []).slice(0, 13).filter((d) => d && E.DAMAGE.includes(d.type)).map((d) => ({ type: d.type, only: d.only === "unenhanced" ? "unenhanced" : null }));
  return { resist: list(o.resist), immune: list(o.immune), vuln: list(o.vuln), condImmune: (Array.isArray(o.condImmune) ? o.condImmune : []).slice(0, 20).map((c) => str(c, 30)),
    senses: E.cleanSenses(o.senses) };
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
    pending: (Array.isArray(x.pending) ? x.pending : []).slice(0, 12).map(cleanPending).filter(Boolean),
    npcres: x.npcres && typeof x.npcres === "object" ? state({ fight: { npcres: x.npcres } }).npcres : undefined,
    conds: (Array.isArray(x.conds) ? x.conds : []).slice(0, 300).filter((c) => Array.isArray(c) && typeof c[0] === "string")
      .map(([id, ec, cc]) => [id, (Array.isArray(ec) ? ec : []).slice(0, 20).map((c) => str(c, 30)), Array.isArray(cc) ? cc.slice(0, 20).map((c) => str(c, 30)) : null]),
    chars: (Array.isArray(x.chars) ? x.chars : []).slice(0, 60).filter((c) => Array.isArray(c) && typeof c[0] === "string" && c[1] && typeof c[1] === "object")
      .map(([id, r]) => [id, { resources: E.cleanResources(r.resources),
        force: { max: plainObj(r.force).max == null || plainObj(r.force).max === "" ? "" : num(plainObj(r.force).max, 0, 999), used: num(plainObj(r.force).used, 0, 999) },
        tech: { max: plainObj(r.tech).max == null || plainObj(r.tech).max === "" ? "" : num(plainObj(r.tech).max, 0, 999), used: num(plainObj(r.tech).used, 0, 999) },
        hitDiceUsed: R.cleanHitDiceUsed(r.hitDiceUsed),   // the sheet's own cleaner: per die size or an old number
        deathSaves: { s: num(plainObj(r.deathSaves).s, 0, 3), f: num(plainObj(r.deathSaves).f, 0, 3) } }]),
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

// Map objects the GM marked "Blocks sight" (#110), as the engine's 'sight' segments: each one's rotated rectangle
// from HoloTable's own propSightSegments (required when first used: that file requires this one). They block sight,
// cover and fog; never movement or an area.
function propWalls(camp) {
  if (!((camp.map && camp.map.props) || []).some((x) => x && x.blocksSight)) return [];
  const G = require("./_holotable-game.js");
  return (G.propSightSegments ? G.propSightSegments(camp.map) : []).map((w, i) => ({ id: `p${i}`, a: w.a, b: w.b, kind: "sight" }));
}
const mapWalls = (camp) => ((camp.map && camp.map.walls) || []).concat(propWalls(camp));

// The engine's world. For a player (forPlayer) hidden combatants are not in it at all. With G, every unit carries the
// name players are shown (HoloTable's shownName: "???" while the GM hides a token's name), so every line the engine
// writes is fit for players; hidden combatants are never masked, so lines that go only to the GM keep their names.
function worldOf(camp, forPlayer, G, cid) {
  const ini = camp.initiative, f = camp.fight || {};
  const ut = unitTokens(camp);
  const fog = forPlayer && cid ? fogFor(camp, cid) : null;   // fog of war: what this player's characters can't see isn't in their world either
  const entries = forPlayer ? ini.entries.filter((e) => !hiddenEntry(camp, e, ut[e.id]) && !(fog && fog.entries.has(e.id))) : ini.entries;
  const cur = ini.entries[ini.turn];
  const w = E.buildWorld({
    characters: camp.characters, entries, active: ini.active, turnId: cur && entries.includes(cur) ? cur.id : null, round: ini.round,
    tokens: camp.map.tokens, unitTokens: ut, spent: f.spent || {}, effects: f.effects || [], conc: f.conc || {},
    npcSpeed: Object.fromEntries(Object.entries(f.npc || {}).map(([k, v]) => [k, typeof v === "object" && v ? v.speed : v])),
    npcStats: Object.fromEntries(Object.entries(f.npc || {}).map(([k, v]) => [k, typeof v === "object" && v ? v : {}])),
    defenses: f.defenses || {}, walls: mapWalls(camp), variants: camp.variants || [],
  }, R);
  if (G && G.shownName) for (const e of entries) if (w.units[e.id]) w.units[e.id].name = G.shownName(camp, e);
  // the GM's world keeps hidden combatants; the engine is told which they are, so they never count toward what a public line says (Flanking)
  if (!forPlayer) for (const e of entries) if (w.units[e.id] && hiddenEntry(camp, e, ut[e.id])) w.units[e.id].hidden = true;
  // the dark matters in a fight where it matters to fog: a dimmed or dark map with fog on (step 5)
  if (fogOn(camp) && lightOn(camp)) { const { cols, rows } = sizeOf(camp); w.light = { lit: litOf(camp), cols, rows }; }
  return w;
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
    effects: JSON.parse(JSON.stringify(f.effects || [])), conc: Object.assign({}, f.conc), lastTurn: f.lastTurn || "", pending: JSON.parse(JSON.stringify(f.pending || [])),
    npcres: JSON.parse(JSON.stringify(f.npcres || {})),
    conds: ini.entries.map((e) => [e.id, (e.conditions || []).slice(), e.charId && camp.characters[e.charId] ? (camp.characters[e.charId].conditions || []).slice() : null]),
    chars: Object.values(camp.characters).map((c) => [c.id, JSON.parse(JSON.stringify({ resources: c.resources || [], force: c.force, tech: c.tech, hitDiceUsed: c.hitDiceUsed, deathSaves: c.deathSaves }))]),
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
  for (const [id, r] of s.chars || []) if (charOf(camp, id)) Object.assign(charOf(camp, id), r);
  if (Array.isArray(s.effects)) f.effects = s.effects;
  if (s.conc) f.conc = s.conc;
  if (typeof s.lastTurn === "string") f.lastTurn = s.lastTurn;
  if (Array.isArray(s.pending)) f.pending = s.pending;
  if (s.npcres) f.npcres = s.npcres;
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
    // death saves go back where the sheet keeps them
    if (a.charId && camp.characters[a.charId] && a.deathSaves && JSON.stringify(a.deathSaves) !== JSON.stringify(b.deathSaves))
      camp.characters[a.charId].deathSaves = { s: clamp(int(a.deathSaves.s), 0, 3), f: clamp(int(a.deathSaves.f), 0, 3) };
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
// A creature's turn begins: its legendary actions come back, and each spent "Recharge X-6" ability rolls a d6 to come
// back (on X or more). The rolls and lines go to the GM only: a creature's abilities are the GM's.
function startOfTurn(camp, cur, G) {
  const list = cur && (camp.fight.npcres || {})[cur.id];
  if (!list || !list.length) return;
  for (const r of list) {
    if (r.refill === "turn") r.used = 0;
    else if (r.recharge && r.used > 0) {
      const d = G.rollDice("1d6"), back = d.total >= r.recharge;
      if (back) r.used = 0;
      G.addChat(camp, { from: "Combat", fromId: "@gm", fight: true, to: ["@gm"], private: true,
        roll: { total: d.total, detail: d.detail, nat: null, expr: "1d6", label: str(`${cur.name}'s ${r.name} (recharge ${r.recharge}-6): ${back ? "it's back" : "not yet"}.`, 200), kind: "recharge" } });
    }
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
  f.pending = [];   // a reaction nobody answered lapses when the turn moves on
  const going = lt !== undefined && (ini.round < +lr || (ini.round === +lr && ini.turn < +lt));
  if (!going) startOfTurn(camp, cur, G);
  // the tracker stepped back (Prev): nothing ends, nothing is saved against; the DM undoes or edits what should come back
  if (lt !== undefined && (ini.round < +lr || (ini.round === +lr && ini.turn < +lt))) return;
  if (!f.effects.length && !Object.keys(f.conc).length) return;
  const before = worldOf(camp, false, G);
  const r = E.turnPassed(before, prevId || null, cur.id, (expr) => G.rollDice(expr));
  writeBack(camp, cid, before, r.world, G);
  for (const line of r.log) {
    const hidden = line.unit && hiddenEntry(camp, ini.entries.find((e) => e.id === line.unit) || {}, (before.units[line.unit] || {}).tokenId);
    const msg = line.roll ? { from: "Combat", fromId: "@gm", fight: true, roll: { total: line.roll.total, detail: line.roll.detail, nat: line.roll.nat == null ? null : line.roll.nat, expr: line.expr, label: str(line.text, 200), kind: line.kind } }
      : { system: true, fight: true, text: str(line.text, 200) };
    if (hidden) { msg.to = ["@gm"]; msg.private = true; msg.fromId = "@gm"; }
    say(camp, G, msg, null, [line.unit, line.about]);
  }
}

// A reaction waiting for an answer is live only during the turn it was asked in (the round and the combatant, whatever
// the tracker's index does meanwhile: an entry added or removed above, an initiative edited) and only while both
// sides are visible to everyone. Anything else has lapsed. One rule for the view, the turn's guard and the answer.
function liveReactions(camp) {
  const f = camp.fight, ini = camp.initiative, cur = ini.entries[ini.turn];
  if (!f || !Array.isArray(f.pending) || !f.pending.length || !ini.active || !cur) return [];
  const ut = unitTokens(camp), turn = `${ini.round}:${cur.id}`;
  const hidden = (id) => { const e = ini.entries.find((x) => x.id === id); return !e || hiddenEntry(camp, e, ut[id]); };
  return f.pending.filter((x) => String(x.turn || "").split(":").slice(0, 2).join(":") === turn && !hidden(x.reactor) && !hidden(x.against));
}

// What an action did, into chat (the roll lines as rolls, the way HoloTable shows every roll) and into the floating
// numbers on the map. Lines about a hidden creature, or by one, go to the GM only.
function report(camp, cid, gm, G, actor, world, r, skipFirst) {
  const f = camp.fight, ut = unitTokens(camp);
  const entry = (id) => camp.initiative.entries.find((e) => e.id === id);
  const isHidden = (id) => !!id && hiddenEntry(camp, entry(id) || {}, ut[id]);
  const secret = isHidden(actor.id);
  const ch = actor.charId && camp.characters[actor.charId];
  for (const [i, line] of r.log.entries()) {
    if (!line.roll) {   // plain lines go to chat (a condition ending, concentration lost), but not "moves 10 ft." or "ends the turn."
      if (i === 0 && skipFirst) continue;
      say(camp, G, Object.assign({ system: true, fight: true, text: str(line.text, 200) }, secret || isHidden(line.unit) || isHidden(line.about) ? { to: ["@gm"], private: true } : {}), cid, [actor.id, line.unit, line.about]);
      continue;
    }
    // a combatant whose name the GM is hiding: its roll says neither its sheet's name nor its player's
    const masked = G.shownName(camp, actor) !== actor.name;
    const msg = { from: masked ? "Combat" : G.playerName(camp, cid), fromId: cid, fight: true,
      roll: { total: line.roll.total, detail: line.roll.detail, nat: line.roll.nat == null ? null : line.roll.nat, expr: line.expr, label: str(line.text, 200), kind: line.kind } };
    if (ch && !masked) msg.charName = ch.name;
    if (secret || isHidden(line.unit)) {
      msg.to = ["@gm"]; msg.private = true;
      // HoloTable shows a message to its sender too, so a line about a hidden creature can't come from the player
      if (!gm) { msg.fromId = "@gm"; msg.from = "Combat (GM only)"; delete msg.charName; }
    }
    say(camp, G, msg, cid, [actor.id, line.unit, line.about]);
  }
  if (secret) {   // what everyone can see: the hit on someone they can see
    for (const ev of r.events) {
      const t = world.units[ev.unit];
      if (t && (ev.kind === "hit" || ev.kind === "crit") && !isHidden(t.id)) say(camp, G, { system: true, fight: true, text: `${t.name} is hit for ${ev.amount} damage.` }, null, [t.id]);
    }
  } else {   // under fog: whoever sees the one hit but not the one who hit gets the hit, unnamed
    for (const ev of r.events) {
      const t = world.units[ev.unit];
      if (!t || t.id === actor.id || !(ev.kind === "hit" || ev.kind === "crit") || isHidden(t.id)) continue;
      const to = seeOnly(camp, t.id, actor.id);
      if (to.length) G.addChat(camp, { system: true, fight: true, text: `${t.name} is hit for ${ev.amount} damage.`, to });
    }
  }
  for (const ev of r.events) {
    const u = r.world.units[ev.unit];
    f.events.push({ seq: ++f.seq, at: now(), kind: ev.kind, token: u ? u.tokenId : null, amount: ev.amount == null ? null : ev.amount, feet: ev.feet == null ? null : ev.feet,
      hidden: secret && ev.kind === "move" ? true : isHidden(ev.unit) });
  }
  if (f.events.length > EVENTS_MAX) f.events.splice(0, f.events.length - EVENTS_MAX);
}

// The map's walls and fog (issue #93): the GM's tools whether the combat view is on or off, since a party explores
// outside fights too. They write only to the map, never to the combat view's record.
function mapTools(camp, cid, gm, type, p, G) {
  if (!gm) throw new G.Forbidden("GM only");
  switch (type) {
    case "fight.wall": {   // the GM draws, erases, opens and closes walls on the map (issue #93); players never receive them
      let list = cleanWalls(camp.map.walls);
      if (p.op === "add") {
        const [w] = E.cleanWalls([{ id: require("crypto").randomBytes(5).toString("hex"), a: p.a, b: p.b, kind: p.kind || "wall", open: false }]);
        if (!w) throw new G.Invalid("A wall needs two different ends.");
        if (list.length >= 2000) throw new G.Invalid("That's the most walls one map can have (2000).");
        list.push(w);
      } else if ((p.op === "remove" || p.op === "door") && !String(p.id || "")) {
        throw new G.Invalid("Which wall?");
      } else if (p.op === "remove") {
        list = list.filter((w) => w.id !== String(p.id || ""));
      } else if (p.op === "door") {
        const w = list.find((x) => x.id === String(p.id || "") && x.kind === "door");
        if (!w) throw new G.Invalid("No such door.");
        w.open = !!p.open;
      } else if (p.op === "clear") list = [];
      else if (p.op === "set") {   // a whole map's walls at once (an import from Dungeondraft's Universal VTT export)
        if (!Array.isArray(p.walls)) throw new G.Invalid("No walls to set.");
        list = E.cleanWalls(p.walls.slice(0, 2000).map((w) => Object.assign({}, w, { id: require("crypto").randomBytes(5).toString("hex") })));
      } else throw new G.Invalid("Unknown wall action.");
      if (list.length) camp.map.walls = list; else delete camp.map.walls;
      return {};
    }
    case "fight.light": {   // the map's light (#93 step 5): its level, and the lights the GM places
      const light = camp.map.light = cleanLight(camp.map.light) || { level: "bright", lights: [] };
      if (p.level !== undefined) {
        if (!Object.prototype.hasOwnProperty.call(E.LIGHT_LEVELS, p.level)) throw new G.Invalid("Bright, dim or dark.");
        light.level = p.level;
      } else if (p.op === "add") {
        if (light.lights.length >= 200) throw new G.Invalid("That's the most lights one map can have (200).");
        const [l] = cleanLight({ lights: [{ x: p.x, y: p.y, bright: p.bright, dim: p.dim }] }).lights;
        if (!l) throw new G.Invalid("A light needs a bright or dim radius.");
        light.lights.push(l);
      } else if (p.op === "remove") light.lights = light.lights.filter((l) => l.id !== String(p.id || ""));
      else if (p.op === "set") light.lights = cleanLight({ lights: Array.isArray(p.lights) ? p.lights.map((l) => Object.assign({}, l, { id: "" })) : [] }).lights;
      else if (p.op === "clear") light.lights = [];
      else throw new G.Invalid("Unknown light action.");
      if (light.level === "bright" && !light.lights.length) delete camp.map.light;   // back to the map's exact shape
      return {};
    }
    case "fight.fog": {   // the GM switches fog of war on or off for this map, shares the party's sight, or resets what's explored (#93)
      const fog = camp.map.fog = cleanFog(camp.map.fog) || { on: false, shared: false, size: "", explored: {} };
      if (p.on !== undefined) fog.on = !!p.on;
      if (p.shared !== undefined) fog.shared = !!p.shared;
      if (p.reset) fog.explored = {};
      G.addChat(camp, { system: true, fight: true, text: p.on !== undefined ? (fog.on ? "The GM brought down the fog: each of you sees what your characters see." : "The GM lifted the fog.")
        : p.shared !== undefined ? (fog.shared ? "The party now shares its sight." : "Each of you sees only what your own characters see.") : "The GM reset what's been explored on this map." });
      return {};
    }
  }
  return {};
}

// Every character's senses at a glance, for the GM, with the combat view on or off (the coordinator's ruling, 17 Nov:
// players set their own, as they do HP and AC; the GM sees them all and corrects any, at any time). "get" reads them
// without writing anything; "set" changes one character's senses and leaves its resistances as they are.
function gmSenses(camp, gm, p, G) {
  if (!gm) throw new G.Forbidden("GM only");
  if (p.op !== "set") throw new G.Invalid("Set a character's senses.");
  const ch = charOf(camp, p.charId);
  if (!ch) throw new G.Invalid("No such character.");
  sheetSenses(camp);
  setSheetSenses(ch, p.senses);   // on the sheet (#92): the one place, the GM the one writer
  return {};
}

function apply(camp, cid, gm, type, p, G) {
  if (type === "fight.wall" || type === "fight.fog" || type === "fight.light") return mapTools(camp, cid, gm, type, p, G);
  if (type === "fight.senses") return gmSenses(camp, gm, p, G);
  // off (the default): only the GM's switch does anything, and switching it off when it was never on writes nothing
  if (!camp.fight || !camp.fight.on) {
    if (type !== "fight.toggle") throw new G.Invalid("The combat view is off.");
    if (!gm) throw new G.Forbidden("GM only");
    if (!p.on && !camp.fight) return {};
  }
  sheetSenses(camp);   // senses the combat view kept before #92 move onto the sheet, once
  const f = state(camp), ini = camp.initiative;
  const need = (ok, why = "GM only") => { if (!ok) throw new G.Forbidden(why); };
  const entry = (id) => ini.entries.find((e) => e.id === id);
  switch (type) {
    case "fight.toggle": {
      need(gm);
      const was = !!f.on;
      f.on = !!p.on;
      G.addChat(camp, { system: true, fight: true, text: f.on ? "The GM switched the combat view on." : "The GM switched the combat view off." });
      if (f.on && !was && G.combatMoves) G.combatMoves(camp);   // the movements the GM queued for combat play now
      return {};
    }
    case "fight.npc": {      // a creature's speed and save bonuses, from its stat block
      need(gm);
      const e = entry(p.id);
      if (!e || e.charId) throw new G.Invalid("No such creature.");
      // defences arrive as the stat block's own lines ("Kinetic from unenhanced weapons") and are read here
      const lines = (v) => (Array.isArray(v) ? v : []).slice(0, 12).map((x) => str(x, 80));
      const abl = (x, lo, hi) => Object.fromEntries(Object.entries(plainObj(x)).filter(([ab, n]) => ["str", "dex", "con", "int", "wis", "cha"].includes(ab) && Number.isFinite(+n)).map(([ab, n]) => [ab, clamp(int(n), lo, hi)]));
      const sizeAt = SIZES.indexOf(str(p.size, 12));
      f.npc[e.id] = Object.assign({ speed: clamp(int(p.speed, 30), 0, 200), saves: abl(p.saves, -10, 30), mods: abl(p.mods, -5, 15), sizeCat: sizeAt >= 0 ? sizeAt : null, reach: clamp(int(p.reach, 5), 5, 30) },
        defences({ resist: E.readDefenses(lines(p.resist)), immune: E.readDefenses(lines(p.immune)), vuln: E.readDefenses(lines(p.vuln)), condImmune: lines(p.condImmune), senses: E.readSenses(lines(p.senses)) }));
      return {};
    }
    case "fight.defenses": { // a character's resistances, immunities and vulnerabilities (its owner or the GM)
      const ch = charOf(camp, p.charId);
      if (!ch) throw new G.Invalid("No such character.");
      need(gm || ch.owner === cid, "not your character");
      const types = (v) => (Array.isArray(v) ? v : []).filter((x) => E.DAMAGE.includes(x)).map((type) => ({ type, only: null }));
      // senses live on the sheet now (#92) and are the GM's (jpesus's ruling): a player's save never touches them; the GM's
      // senses from this dialog go to the sheet
      if (gm && Array.isArray(p.senses)) setSheetSenses(ch, p.senses);
      else if (p.senses !== undefined) {   // a player sending different senses is refused, not quietly ignored
        const sig = (l) => R.cleanSenses(l).map((x) => `${x.kind}:${x.range}`).sort().join();
        if (sig(p.senses) !== sig(ch.senses)) throw new G.Forbidden("Only the GM sets senses.");
      }
      f.defenses[ch.id] = defences({ resist: types(p.resist), immune: types(p.immune), vuln: types(p.vuln), senses: [] });
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
      snapshot(camp, `set ${G.shownName(camp, e)}'s hit points`);
      if (p.hp !== undefined && p.hp !== null && p.hp !== "") G.applyAction(camp, cid, true, "init.update", { id: e.id, fields: { hp: clamp(int(p.hp), -1000, 100000) } });
      if (p.temp !== undefined && e.charId && camp.characters[e.charId]) camp.characters[e.charId].hp.temp = clamp(int(p.temp), 0, 100000);
      return {};
    }
    case "fight.spend": {    // spend from a character's resource (its owner or the GM); undoable like a combat step
      const ch = charOf(camp, p.charId);
      if (!ch) throw new G.Invalid("No such character.");
      need(gm || ch.owner === cid, "not your character");
      const r = E.spend(ch, String(p.key || ""), p.n == null ? 1 : p.n, R);
      if (!r.ok) throw new G.Invalid(r.why);
      snapshot(camp, `${G.shownName(camp, { charId: ch.id, name: ch.name })} used ${r.res.name}`);
      Object.assign(ch, { resources: r.ch.resources, force: r.ch.force, tech: r.ch.tech, hitDiceUsed: r.ch.hitDiceUsed });
      G.addChat(camp, { system: true, fight: true, text: `${G.shownName(camp, { charId: ch.id, name: ch.name })} uses ${r.res.name}: ${r.res.max - r.res.used} of ${r.res.max} left.` });
      return {};
    }
    case "fight.resource": { // add, change or remove one of a character's own resources (its owner or the GM)
      const ch = charOf(camp, p.charId);
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
      G.addChat(camp, { system: true, fight: true, text: `The GM undid the last combat step (${s.label}).` });
      return {};
    }
    case "fight.npcres": {   // a creature's limited abilities (GM): set from its stat block, use some, or reset one
      need(gm);
      if (!f.on) throw new G.Invalid("The combat view is off.");
      tick(camp, cid, G);   // a turn that began since the last combat step begins now (legendary actions back, recharge rolls)
      const e = entry(String(p.id || ""));
      if (!e || e.charId) throw new G.Invalid("No such creature.");
      const list = f.npcres[e.id] || [];
      if (p.op === "set") {   // keeps what's already been used of an ability with the same key
        f.npcres[e.id] = cleanNpcRes(p.res).map((r) => { const old = list.find((o) => o.key === r.key); return old ? Object.assign(r, { used: Math.min(r.max, old.used) }) : r; });
        return {};
      }
      const r = list.find((x) => x.key === String(p.key || ""));
      if (!r) throw new G.Invalid("No such ability on that creature.");
      snapshot(camp, `${G.shownName(camp, e)}: ${r.name}`);
      if (p.op === "reset") r.used = 0;
      else {
        const n = clamp(int(p.n, 1), 1, r.max);
        if (r.max - r.used < n) throw new G.Invalid(`${r.name}: ${r.max - r.used} of ${r.max} left.`);
        r.used += n;
        G.addChat(camp, { system: true, fight: true, to: ["@gm"], private: true, text: str(r.points ? `${e.name} spends ${n} ${r.name.toLowerCase()}: ${r.max - r.used} of ${r.max} left.` : `${e.name} uses ${r.name}${n > 1 ? ` (${n})` : ""}: ${r.max - r.used} of ${r.max} left.`, 200) });
      }
      return {};
    }
    case "fight.condition": {   // the DM puts a condition on a combatant (a level, a damage amount, who caused it) or takes it off
      need(gm);
      if (!f.on) throw new G.Invalid("The combat view is off.");
      const name = str(p.condition, 30);
      if (!CONDS.has(name)) throw new G.Invalid("That isn't a condition HoloTable knows.");
      const world = worldOf(camp, false, G), unit = String(p.unit || "");
      const r = E.setCondition(world, { unit, condition: name, op: p.op === "remove" ? "remove" : "add", level: int(p.level), amount: str(p.amount, 24), source: p.source ? String(p.source) : null });
      if (!r.ok) throw new G.Invalid(r.why);
      snapshot(camp, `${name} ${p.op === "remove" ? "taken off" : "put on"} ${world.units[unit].name}`);
      writeBack(camp, cid, world, r.world, G);
      const ut = unitTokens(camp), isHidden = (id) => !!id && hiddenEntry(camp, entry(id) || {}, ut[id]);
      for (const line of r.log) say(camp, G, Object.assign({ system: true, fight: true, text: str(line.text, 200) }, isHidden(line.unit) || isHidden(line.about) ? { to: ["@gm"], private: true } : {}), null, [line.unit, line.about]);
      return {};
    }
    case "fight.react": {   // an answer to a reaction prompt: take the opportunity attack, or let it go (the GM can answer any)
      if (!f.on) throw new G.Invalid("The combat view is off.");
      tick(camp, cid, G);
      f.pending = liveReactions(camp);
      const pend = f.pending.find((x) => x.id === String(p.id || ""));
      if (!pend) throw new G.Invalid("That reaction has already been answered or has lapsed.");
      const re = entry(pend.reactor), against = entry(pend.against);
      need(re && mayAct(camp, cid, gm, re), "That reaction isn't yours to take.");
      if (!p.take) {
        f.pending = f.pending.filter((x) => x !== pend);
        say(camp, G, { system: true, fight: true, text: str(`${G.shownName(camp, re)} lets ${against ? G.shownName(camp, against) : "them"} go.`, 200) }, cid, [re.id, against && against.id]);
        return {};
      }
      const world = worldOf(camp, !gm, G, cid);
      let spec;
      if (re.charId) {
        const ch = camp.characters[re.charId];
        spec = ch && E.attacksOf(ch, R).find((a) => a.key === String(p.attack));
        if (!spec) throw new G.Invalid("That attack isn't on the sheet.");
      } else spec = cleanSpec(p.attack, G);
      const r = E.react(world, { reactor: re.id, against: pend.against, at: pend.at, attack: spec, adv: !!p.adv, dis: !!p.dis }, (expr) => G.rollDice(expr));
      if (!r.ok) throw new G.Invalid(r.why);
      snapshot(camp, `${G.shownName(camp, re)}'s opportunity attack`);
      f.pending = f.pending.filter((x) => x !== pend);
      writeBack(camp, cid, world, r.world, G);
      report(camp, cid, gm, G, re, world, r, false);
      return {};
    }
    case "fight.move": case "fight.attack": case "fight.end": case "fight.use": case "fight.stand": case "fight.douse": case "fight.common": case "fight.deathsave": {
      if (!f.on) throw new G.Invalid("The combat view is off.");
      const cur = ini.entries[ini.turn];
      if (!ini.active || !cur) throw new G.Invalid("Combat hasn't started: start initiative first.");
      need(mayAct(camp, cid, gm, cur), "It's not your turn.");
      tick(camp, cid, G);
      f.pending = liveReactions(camp);   // a lapsed question never blocks a turn
      if (f.pending.length) {
        const who = f.pending.map((x) => entry(x.reactor)).filter(Boolean).map((e) => G.shownName(camp, e));
        throw new G.Invalid(`Waiting for ${who.join(" and ") || "a reaction"}: an opportunity attack to take or let go.`);   // names players can see
      }
      // an area catches whoever is in it, hidden or not; only its rolls about a hidden one stay with the GM
      const areaUse = type === "fight.use" && cur.charId && (() => {
        const ch = camp.characters[cur.charId];
        const ab = ch && E.abilitiesOf(ch, R, f.lib).find((a) => a.key === String(p.ability || ""));
        return !!(ab && ab.area);
      })();
      const world = worldOf(camp, !gm && !areaUse, G, cid);
      if (type === "fight.end" && !world.units[cur.id]) {      // a combatant with no token can still pass the turn
        snapshot(camp, `${G.shownName(camp, cur)} ends the turn`);
        G.applyAction(camp, cid, true, "init.next", {});
        tick(camp, cid, G);
        return {};
      }
      let act;
      if (type === "fight.move") act = { type: "move", unit: cur.id, x: p.x, y: p.y };
      else if (type === "fight.end") act = { type: "end", unit: cur.id };
      else if (type === "fight.stand") act = { type: "stand", unit: cur.id };
      else if (type === "fight.douse") act = { type: "douse", unit: cur.id, target: String(p.target || "") };
      else if (type === "fight.common") act = { type: "common", unit: cur.id, key: String(p.key || "") };
      else if (type === "fight.deathsave") act = { type: "deathsave", unit: cur.id };
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
      const limited = act.type === "attack" && !cur.charId && p.attack && p.attack.res && ((f.npcres || {})[cur.id] || []).find((x) => x.key === String(p.attack.res));
      if (limited && limited.used >= limited.max) throw new G.Invalid(`${limited.name} is spent${limited.recharge ? ` until it recharges (${limited.recharge}-6 at the start of ${cur.name}'s turn)` : ""}.`);
      const r = E.apply(world, act, (expr) => G.rollDice(expr));
      if (!r.ok) throw new G.Invalid(r.why);
      const label = type === "fight.deathsave" ? `${G.shownName(camp, cur)}'s death save` : type === "fight.common" ? `${G.shownName(camp, cur)} took ${String(p.key || "an action")}` : type === "fight.douse" ? `${G.shownName(camp, cur)} put out flames` : type === "fight.stand" ? `${G.shownName(camp, cur)} stood up` : type === "fight.move" ? `${G.shownName(camp, cur)} moved` : type === "fight.end" ? `${G.shownName(camp, cur)} ended the turn` : type === "fight.use" ? `${G.shownName(camp, cur)} used ${act.ability.name}` : `${G.shownName(camp, cur)}'s attack`;
      snapshot(camp, label);
      if (limited) limited.used += 1;   // after the snapshot, so Undo gives it back
      writeBack(camp, cid, world, r.world, G);
      report(camp, cid, gm, G, cur, world, r, type === "fight.move" || type === "fight.end");
      // a move out of someone's reach: they may take an opportunity attack, and the turn waits for their answer.
      // Only between combatants everyone can see: a hidden creature never gives itself away by reacting.
      const ut = unitTokens(camp), isHidden = (id) => !!id && hiddenEntry(camp, entry(id) || {}, ut[id]);
      for (const re of r.reactions || []) {
        if (isHidden(re.reactor) || isHidden(re.against)) continue;
        f.pending.push({ id: String(++f.seq), kind: "opportunity", reactor: re.reactor, against: re.against, at: re.at, turn: f.lastTurn });
        say(camp, G, { system: true, fight: true, text: str(`${G.shownName(camp, cur)} leaves ${G.shownName(camp, entry(re.reactor))}'s reach: ${G.shownName(camp, entry(re.reactor))} can make an opportunity attack.`, 200) }, cid, [cur.id, re.reactor]);
      }
      if (r.endTurn) { G.applyAction(camp, cid, true, "init.next", {}); tick(camp, cid, G); }
      return {};
    }
    default:
      throw new G.Invalid("unknown combat action");
  }
}

// What one person sees of the fight. Players get nothing about hidden combatants: not their turn, not their tokens'
// links, not their events. Only the GM gets the undo stack (as a count and a label) and creature speeds.
function view(camp, cid, gm, shownName) {
  const f = camp.fight;
  if (!f || !f.on) return { on: false };
  const ini = camp.initiative, ut = unitTokens(camp), fog = gm ? null : fogFor(camp, cid);
  const seen = (e) => gm || (!hiddenEntry(camp, e, ut[e.id]) && !(fog && fog.entries.has(e.id)));
  const units = {};
  for (const e of ini.entries) {
    if (!ut[e.id] || !seen(e)) continue;
    const ch = e.charId && camp.characters[e.charId];
    const hp = ch ? +ch.hp.current : e.hp;
    // a character whose name the GM is hiding looks like any creature to other players, as HoloTable's own view has it
    const masked = !gm && shownName && shownName(camp, e) !== e.name && !(ch && ch.owner === cid);
    units[e.id] = { token: ut[e.id], side: e.charId && !masked ? "pc" : "npc", mine: !!ch && ch.owner === cid, down: hp != null && hp <= 0 };
    if (gm && hiddenEntry(camp, e, ut[e.id])) units[e.id].hidden = true;   // for the GM's previews (Flanking); players never get these units
  }
  const cur = ini.entries[ini.turn];
  const turn = ini.active && cur && seen(cur) ? cur.id : null;
  const world = worldOf(camp, !gm, null, cid);
  // floating numbers: never on a token this player isn't sent (hidden by the GM, or out of their sight under fog)
  const evs = (Array.isArray(f.events) ? f.events : []).filter((ev) => gm || (!ev.hidden && !(fog && ev.token && fog.tokens.has(ev.token)))).slice(-15);
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
    ...(gm ? { propWalls: propWalls(camp) } : {}),   // the GM's previews see what the server sees (#110's sight-blocking objects)
    npcRes: gm ? f.npcres || {} : {},   // a creature's limited abilities: the GM's
    npcDefenses: gm ? Object.fromEntries(Object.entries(f.npc || {}).map(([k, v]) => [k, defences(plainObj(v))])) : {},
    // characters' own: as visible as their sheets (not a sheet whose token's name the GM is hiding, except to its owner)
    defenses: gm || !shownName ? f.defenses || {} : Object.fromEntries(Object.entries(f.defenses || {}).filter(([id]) => {
      const c = charOf(camp, id);
      return c && (c.owner === cid || shownName(camp, { charId: id, name: c.name }) === c.name);
    })),
    lib: f.lib || {},
    effects: (f.effects || []).filter((ef) => units[ef.unit]).map((ef) => ({ unit: ef.unit, condition: ef.condition, ends: ef.ends, of: units[ef.of] ? ef.of : null, rounds: ef.rounds, save: ef.save, conc: ef.conc,
      level: ef.level || 0, amount: ef.amount || "", source: units[ef.source] ? ef.source : null })),   // a grappler or charmer the viewer can't see stays unnamed
    conc: Object.fromEntries(Object.entries(f.conc || {}).filter(([id]) => units[id])),
    // with walls on the map, the squares this viewer can move to on their own turn: their browser has no walls to work
    // them out with (players never receive walls)
    reach: (camp.map.walls || []).length && turn && (gm || (units[turn] || {}).mine) ? fogReach(camp, cid, fog, E.reachable(world, turn, E.budget(world).moveLeft)) : null,
    // a creature's size and reach, for the ones this viewer can see (both show on the map anyway)
    npcBody: Object.fromEntries(Object.entries(f.npc || {}).filter(([k]) => units[k]).map(([k, v]) => [k, { sizeCat: v.sizeCat == null ? null : v.sizeCat, reach: v.reach || 5 }])),
    // reactions waiting: who may react to whom; `mine` when this viewer is the one to answer
    pending: liveReactions(camp).filter((x) => units[x.reactor] && units[x.against]).map((x) => {   // lapsed ones are never shown
      const re = ini.entries.find((e) => e.id === x.reactor);
      return { id: x.id, kind: x.kind, reactor: x.reactor, against: x.against, mine: !!re && mayAct(camp, cid, gm, re) };
    }),
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
// (the undo stack, the floating numbers, reactions waiting for an answer).
function restored(g) {
  state(g);
  Object.assign(g.fight, { undo: [], events: [], pending: [] });
}

/* ---------------- fog of war (issue #93, step 4) ----------------
   The GM switches it on for a map (map.fog.on, kept by the map, so each scene has its own). It applies while the
   combat view is on. A player sees what their own characters' tokens see through the walls (the whole party's with
   map.fog.shared); tokens outside that, and their tracker entries, aren't sent to them, and their world leaves those
   combatants out, as it does hidden ones. Squares a player has seen stay "explored" (drawn dim) on that map until the
   GM resets them. The GM sees everything, with what the players see between them outlined. */
const PID = /^[a-z0-9]{6,40}$/;
const sizeOf = (camp) => ({ cols: clamp(int(camp.map.cols, 20), 1, 400), rows: clamp(int(camp.map.rows, 15), 1, 400) });
function cleanFog(x) {
  if (!x || typeof x !== "object") return undefined;
  const explored = {};
  for (const [k, v] of Object.entries(plainObj(x.explored)).slice(0, 60)) if (PID.test(k) && typeof v === "string" && v.length <= 30000 && /^[A-Za-z0-9+/=]*$/.test(v)) explored[k] = v;
  return { on: !!x.on, shared: !!x.shared, size: str(x.size, 12), explored };
}
const fogOn = (camp) => !!(camp.map && camp.map.fog && camp.map.fog.on);   // the map's, combat view or not
// whose eyes a player sees through: their own characters' tokens (and tokens they own), or with shared vision every character's
function eyesOf(camp, cid) {
  const chars = camp.characters || {}, shared = !!camp.map.fog.shared;
  return (camp.map.tokens || []).filter((t) => !t.hidden && (t.charId && chars[t.charId] ? (shared || chars[t.charId].owner === cid) : t.owner === cid));
}
// the squares some tokens see, remembered for the last few boards asked about: the answer only changes when a wall,
// a door, the board or one of those tokens does, and each player's screen asks every few seconds
/* light (issue #93, step 5): the map's level and its lights, kept by the map as map.light = { level, lights } */
const LIGHT_ID = /^[a-z0-9]{1,20}$/;
function cleanLight(x) {
  if (!x || typeof x !== "object") return undefined;
  const lights = (Array.isArray(x.lights) ? x.lights : []).slice(0, 200).filter((l) => l && typeof l === "object").map((l) => ({
    id: LIGHT_ID.test(String(l.id || "")) ? String(l.id) : require("crypto").randomBytes(4).toString("hex"),
    x: clamp(Math.round((+l.x || 0) * 100) / 100, -500, 1000), y: clamp(Math.round((+l.y || 0) * 100) / 100, -500, 1000),
    bright: clamp(int(l.bright), 0, 300), dim: clamp(int(l.dim), 0, 300) })).filter((l) => l.bright + l.dim > 0);
  return { level: Object.prototype.hasOwnProperty.call(E.LIGHT_LEVELS, x.level) ? x.level : "bright", lights };
}
// lighting matters only when the GM has dimmed or darkened the map (bright, the default, changes nothing)
const lightOn = (camp) => !!(camp.map && camp.map.light && camp.map.light.level && camp.map.light.level !== "bright");
// the map's lights plus any a token carries (token.light, if HoloTable's tokens get one), at the token's centre
function lightsOf(camp) {
  const out = ((camp.map.light || {}).lights || []).slice();
  for (const t of camp.map.tokens || []) if (t.light && (+t.light.bright || +t.light.dim)) {
    const s = clamp(int(t.size, 1), 1, 4);
    out.push({ x: (+t.x || 0) + s / 2, y: (+t.y || 0) + s / 2, bright: clamp(int(t.light.bright), 0, 300), dim: clamp(int(t.light.dim), 0, 300) });
  }
  return out;
}
const sightWallsOf = (camp) => mapWalls(camp).filter((w) => w.kind === "wall" || w.kind === "sight" || (w.kind === "door" && !w.open));
// each square's light, remembered like the squares seen
const LIT_CACHE = new Map();
function litOf(camp) {
  const { cols, rows } = sizeOf(camp), walls = sightWallsOf(camp), lights = lightsOf(camp), level = camp.map.light.level;
  const key = JSON.stringify([cols, rows, level, lights.map((l) => [l.x, l.y, l.bright, l.dim]), walls.map((w) => [w.a, w.b])]);
  let lit = LIT_CACHE.get(key);
  if (!lit) {
    lit = E.lightSquares(walls, lights, level, cols, rows);
    LIT_CACHE.set(key, lit);
    if (LIT_CACHE.size > 20) LIT_CACHE.delete(LIT_CACHE.keys().next().value);
  }
  return lit;
}
// a token's senses: its character's, from the sheet (#92), which only the GM changes; the combat view keeps no copy
function sensesOf(camp, t) {
  const ch = t && charOf(camp, t.charId);
  return (ch && Array.isArray(ch.senses) && ch.senses) || [];
}
// Senses the combat view kept for characters before they lived on the sheet (#94 to #128) are dropped, once: players
// could write them, so they don't move into the GM's field; the GM sets senses on the sheet (or a species fills them)
function sheetSenses(camp) {
  const defs = plainObj(plainObj(camp.fight).defenses);
  for (const [id, d] of Object.entries(defs)) if (d && Array.isArray(d.senses) && d.senses.length) defs[id] = Object.assign({}, d, { senses: [] });
}
// the GM sets a character's senses on its sheet, with the sheet's own cleaning (an empty list takes them off)
function setSheetSenses(ch, list) {
  const s = R.cleanSenses(list);
  if (s.length) ch.senses = s; else delete ch.senses;
}
const senseRange = (camp, t, kinds) => Math.max(0, ...sensesOf(camp, t).filter((x) => x && kinds.includes(x.kind)).map((x) => +x.range || 0));
// the squares some tokens see, remembered for the last few boards asked about: the answer only changes when a wall,
// a door, a light, the board or one of those tokens does, and each player's screen asks every few seconds
const SEEN_CACHE = new Map();
function squaresSeen(camp, eyes, noLight) {
  const { cols, rows } = sizeOf(camp), walls = sightWallsOf(camp), lighting = !noLight && lightOn(camp);
  const dark = lighting ? Object.fromEntries(eyes.map((t, i) => ["e" + i, senseRange(camp, t, ["darkvision"])])) : null;
  const key = JSON.stringify([cols, rows, eyes.map((t) => [t.x, t.y, t.size || 1]), walls.map((w) => [w.a, w.b]),
    lighting ? [camp.map.light.level, lightsOf(camp).map((l) => [l.x, l.y, l.bright, l.dim]), dark] : 0]);
  let vis = SEEN_CACHE.get(key);
  if (!vis) {
    const units = Object.fromEntries(eyes.map((t, i) => ["e" + i, { id: "e" + i, x: +t.x || 0, y: +t.y || 0, size: clamp(int(t.size, 1), 1, 4) }]));
    vis = E.visibleSquares({ walls, units }, Object.keys(units), cols, rows, lighting ? { lit: litOf(camp), dark } : undefined);
    SEEN_CACHE.set(key, vis);
    if (SEEN_CACHE.size > 40) SEEN_CACHE.delete(SEEN_CACHE.keys().next().value);
  }
  return vis;
}
// A player's drag under fog (issue #93): only where the token can walk without crossing a wall, a window or a closed
// door, however far; otherwise a drag would peek into the next room. The GM's drags, and maps without fog or walls,
// aren't checked. Objects that block sight don't stop it: a player can climb over crates (the GM walls in what can't
// be passed).
function canWalk(camp, t, x, y) {
  if (!fogOn(camp) || !t || !((camp.map.walls || []).length)) return true;
  const { cols, rows } = sizeOf(camp);
  return E.walkable(camp.map.walls, cols, rows, { x: int(t.x), y: int(t.y), size: clamp(int(t.size, 1), 1, 4) }, x, y);
}
// What fog hides from one player: null for the GM or with fog off; otherwise the squares they see and the tokens and
// tracker entries they can't. A player's own tokens are never hidden from them. In the dark, a creature within a
// character's blindsight or tremorsense (and not behind a wall from it) is still perceived, though its square isn't lit.
function fogFor(camp, cid) {
  if (!fogOn(camp) || !cid) return null;
  const { cols, rows } = sizeOf(camp), eyes = eyesOf(camp, cid), mine = new Set(eyes.map((t) => t.id));
  const vis = squaresSeen(camp, eyes), tokens = new Set(), box = (t) => ({ x: +t.x || 0, y: +t.y || 0, size: clamp(int(t.size, 1), 1, 4) });
  const feelers = lightOn(camp) ? eyes.map((e) => [e, senseRange(camp, e, ["blindsight", "tremorsense"])]).filter(([, r]) => r > 0) : [];
  const felt = (t) => feelers.some(([e, r]) => {
    const a = box(e), b = box(t), dx = Math.max(0, a.x - (b.x + b.size - 1), b.x - (a.x + a.size - 1)), dy = Math.max(0, a.y - (b.y + b.size - 1), b.y - (a.y + a.size - 1));
    return E.sqFeet(dx, dy) <= r && E.seenIn(squaresSeen(camp, [e], true), cols, rows, b);
  });
  for (const t of camp.map.tokens || []) if (!mine.has(t.id) && !E.seenIn(vis, cols, rows, box(t)) && !felt(t)) tokens.add(t.id);
  const ut = unitTokens(camp), entries = new Set(camp.initiative.entries.filter((e) => ut[e.id] && tokens.has(ut[e.id])).map((e) => e.id));
  return { vis, tokens, entries, cols, rows };
}
function exploredOf(camp, cid, cols, rows) {
  const fog = camp.map.fog, packed = fog.size === `${cols}x${rows}` && (fog.explored || {})[cid];
  return packed ? E.unpackSquares(packed, cols * rows) : new Uint8Array(cols * rows);
}
// under fog, a player's reachable squares are only those they see or have explored: the rest of the floor stays unknown
function fogReach(camp, cid, fog, reach) {
  if (!fog || !reach) return reach;
  const seen = exploredOf(camp, cid, fog.cols, fog.rows);
  return Object.fromEntries(Object.entries(reach).filter(([k]) => {
    const [x, y] = k.split(",").map(Number), i = y * fog.cols + x;
    return x >= 0 && y >= 0 && x < fog.cols && y < fog.rows && (fog.vis[i] || seen[i]);
  }));
}
// what the browser draws: a player gets their visible and explored squares; the GM, what any player sees
function fogView(camp, cid, gm, fog) {
  if (!fogOn(camp)) return null;
  const { cols, rows } = sizeOf(camp), on = { shared: !!camp.map.fog.shared, cols, rows };
  if (!gm) {
    fog = fog || fogFor(camp, cid);
    const seen = exploredOf(camp, cid, cols, rows);
    for (let i = 0; i < seen.length; i++) if (fog.vis[i]) seen[i] = 1;
    if (lightOn(camp)) {   // the squares seen only dimly: dim light, or darkness seen through darkvision
      const lit = litOf(camp), dim = new Uint8Array(cols * rows);
      for (let i = 0; i < dim.length; i++) if (fog.vis[i] && lit[i] < 2) dim[i] = 1;
      on.dim = E.packSquares(dim);
    }
    return Object.assign(on, { vis: E.packSquares(fog.vis), seen: E.packSquares(seen) });
  }
  if (lightOn(camp)) {   // the GM sees where the light falls: dark and dim squares
    const lit = litOf(camp), dark = new Uint8Array(cols * rows), dim = new Uint8Array(cols * rows);
    for (let i = 0; i < lit.length; i++) { if (lit[i] === 0) dark[i] = 1; else if (lit[i] === 1) dim[i] = 1; }
    Object.assign(on, { dark: E.packSquares(dark), dimLit: E.packSquares(dim) });
  }
  const any = new Uint8Array(cols * rows);
  for (const pid of Object.keys(camp.players || {})) {
    if ((camp.players[pid] || {}).role === "gm") continue;
    const v = squaresSeen(camp, eyesOf(camp, pid));
    for (let i = 0; i < any.length; i++) if (v[i]) any[i] = 1;
  }
  return Object.assign(on, { any: E.packSquares(any) });
}
// Chat follows sight (#93): with fog on, a combat line about creatures some players can't see goes only to the GM,
// the person whose action it was, and the players who see every creature in it. null when everyone may read it
// (fog off, or nobody is blind to any of them). Lines already kept to the GM are left as they are.
function sightTo(camp, cid, ids) {
  if (!fogOn(camp)) return null;
  const ut = unitTokens(camp), toks = [...new Set(ids.filter(Boolean).map((id) => ut[id]).filter(Boolean))];
  if (!toks.length) return null;
  const pids = Object.keys(camp.players || {}).filter((pid) => (camp.players[pid] || {}).role !== "gm");
  const sees = (pid) => { const fog = fogFor(camp, pid); return !fog || toks.every((t) => !fog.tokens.has(t)); };
  const seeing = pids.filter(sees);
  if (seeing.length === pids.length) return null;
  return ["@gm", ...new Set([cid, ...seeing].filter((x) => x && x !== "@gm"))];
}
// players who see one creature but not another (the target of a hit, not the shooter): they get the hit, unnamed
function seeOnly(camp, seen, unseen) {
  if (!fogOn(camp)) return [];
  const ut = unitTokens(camp), a = ut[seen], b = ut[unseen];
  if (!a || !b) return [];
  return Object.keys(camp.players || {}).filter((pid) => (camp.players[pid] || {}).role !== "gm")
    .filter((pid) => { const fog = fogFor(camp, pid); return fog && !fog.tokens.has(a) && fog.tokens.has(b); });
}
// a combat line into chat, routed by sight while fog is on
function say(camp, G, msg, cid, ids) {
  if (!msg.to) { const to = sightTo(camp, cid, ids); if (to) msg.to = to; }
  G.addChat(camp, msg);
}

// After every action (a token dragged, a door opened, a move in combat): what each player sees now joins what they
// have explored on this map. Nothing is written while fog is off.
function noteSeen(camp) {
  if (!fogOn(camp)) return;
  const { cols, rows } = sizeOf(camp), fog = camp.map.fog, size = `${cols}x${rows}`;
  if (fog.size !== size) { fog.size = size; fog.explored = {}; }   // a resized board starts unexplored
  for (const pid of Object.keys(camp.players || {})) {
    if ((camp.players[pid] || {}).role === "gm") continue;
    const eyes = eyesOf(camp, pid);
    if (!eyes.length) continue;
    const was = exploredOf(camp, pid, cols, rows), v = squaresSeen(camp, eyes);
    let grew = false;
    for (let i = 0; i < was.length; i++) if (v[i] && !was[i]) { was[i] = 1; grew = true; }
    if (grew) fog.explored[pid] = E.packSquares(was);
  }
}

// walls as a map keeps them: checked by the engine, and every one with its own id (a restored or hand-made map may bring
// walls with none, or the same one twice; erasing or opening by id must only ever touch one)
function cleanWalls(list) {
  const seen = new Set();
  return E.cleanWalls(list).map((w) => {
    let id = w.id;
    while (!id || seen.has(id)) id = require("crypto").randomBytes(5).toString("hex");
    seen.add(id);
    return id === w.id ? w : Object.assign({}, w, { id });
  });
}

module.exports = { apply, view, canWalk, fogFor, fogView, cleanFog, cleanLight, noteSeen, sightTo, unitTokens, worldOf, state, turned, restored, cleanResources: E.cleanResources, cleanWalls,
  cleanHitDiceUsed: R.cleanHitDiceUsed };   // for cleanChar: the sheet and the undo record clean hit dice the same way
