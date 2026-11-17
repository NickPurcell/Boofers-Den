// HoloTable combat (experimental branch): the engine (pure) and the server's fight actions.
// Every name here is invented. Dice are loaded so every outcome is known.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../sections/jpesus/holotable/combat/engine.js");
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;

// loaded dice: each roll() takes the next result and records the expression it was asked for
function dice(...results) {
  const asked = [];
  const roll = (expr) => {
    asked.push(expr);
    const r = results.shift();
    if (!r) throw new Error("ran out of loaded dice for " + expr);
    return Object.assign({ detail: "loaded" }, r);
  };
  return { roll, asked };
}
const unit = (o) => Object.assign({ size: 1, temp: 0, speed: 30, ac: 13, hp: 20, maxHp: 20 }, o);
function world(units, turnId, extra = {}) {
  return Object.assign({ active: true, round: 1, turnId, units: Object.fromEntries(units.map((u) => [u.id, u])), turn: null, reactions: {} }, extra);
}
const blade = { name: "Vibroblade", bonus: 5, damage: "1d8+3", crit: "2d8+3", type: "kinetic", melee: 5, range: null };
const rifle = { name: "Blaster rifle", bonus: 5, damage: "1d8+3", crit: "2d8+3", type: "energy", melee: 0, range: [100, 400] };

test("combat engine: distance in feet on the grid, diagonals count as one square", () => {
  const a = { x: 0, y: 0 }, b = { x: 1, y: 1 }, c = { x: 4, y: 1 }, big = { x: 2, y: 2, size: 2 };
  assert.equal(E.feetBetween(a, b), 5);
  assert.equal(E.feetBetween(a, c), 20);
  assert.equal(E.feetBetween(a, a), 0);
  assert.equal(E.feetBetween(a, big), 10, "a 2×2 creature is measured from its nearest square");
  assert.equal(E.feetBetween(big, { x: 4, y: 3 }), 5);
});

test("combat engine: reach and range from the weapon's properties", () => {
  assert.deepEqual(E.readRange(""), { melee: 5, range: null });
  assert.deepEqual(E.readRange("Finesse, Light, Thrown (20/60)"), { melee: 5, range: [20, 60] });
  assert.deepEqual(E.readRange("Ammunition (range 80/320), reload 12"), { melee: 0, range: [80, 320] });
  assert.deepEqual(E.readRange("Range (30/120), Burst 4"), { melee: 0, range: [30, 120] });
  assert.deepEqual(E.readRange("Reach, Two-handed"), { melee: 10, range: null });
});

test("combat engine: a sheet's attacks use HoloTable's own arithmetic (rules.js)", () => {
  const ch = { classes: [{ name: "Fighter", level: 1 }], abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    attacks: [
      { name: "Vibrosword", ab: "str", damage: "1d8", type: "kinetic", props: "Versatile (1d10)" },
      { name: "Vibroknife", ab: "finesse", damage: "1d4", type: "kinetic", props: "Finesse, Light, Thrown (20/60)" },
      { name: "Blaster pistol", ab: "dex", damage: "1d6", type: "energy", props: "Ammunition (range 40/160)", proficient: false },
    ] };
  const [sword, knife, pistol] = E.attacksOf(ch, R);
  assert.deepEqual([sword.bonus, sword.damage, sword.crit, sword.melee, sword.range], [R.attackBonus(ch, ch.attacks[0]), "1d8+3", "2d8+3", 5, null]);
  assert.equal(sword.bonus, 5, "Str +3 and proficiency +2");
  assert.deepEqual([knife.bonus, knife.melee, knife.range], [5, 5, [20, 60]]);
  assert.deepEqual([pistol.bonus, pistol.damage, pistol.melee, pistol.range], [2, "1d6+2", 0, [40, 160]]);
});

test("combat engine: a creature's attack from its stat block entry", () => {
  const shot = E.attackFromBehavior({ n: "Blaster carbine", atk: 4, dmg: "1d8 + 2", dt: "energy", rng: "", d: "Ranged Weapon Attack: +4 to hit, range 60/240 ft., one target." });
  assert.deepEqual([shot.bonus, shot.damage, shot.crit, shot.melee, shot.range, shot.type], [4, "1d8+2", "2d8+2", 0, [60, 240], "energy"]);
  const bite = E.attackFromBehavior({ n: "Bite", atk: 6, dmg: "2d6+4", d: "Melee Weapon Attack: +6 to hit, reach 10 ft., one target." });
  assert.deepEqual([bite.melee, bite.range], [10, null]);
  assert.equal(E.attackFromBehavior({ n: "Pack Tactics", atk: null, dmg: "" }), null, "a trait is not an attack");
});

test("combat engine: movement reaches 30 ft, passes allies, never stops on anyone, never passes enemies", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  const bo = unit({ id: "bo", name: "Bolt", side: "pc", x: 1, y: 0 });
  const raider = unit({ id: "r1", name: "Raider", side: "npc", x: 0, y: 2 });
  const w = world([ava, bo, raider], "ava");
  const reach = E.reachable(w, "ava", 30);
  assert.equal(reach["6,0"], 30);
  assert.equal(reach["7,0"], undefined, "31 ft is too far");
  assert.equal(reach["6,6"], 30, "diagonals cost one square");
  assert.equal(reach["1,0"], undefined, "an ally's square: may pass, may not stop");
  assert.equal(reach["2,0"], 10, "through the ally");
  assert.equal(reach["0,2"], undefined, "an enemy's square");
  assert.equal(E.reachable(w, "ava", 0)["1,1"], undefined);
  // a wall of three enemies: the square behind it costs the way round (20 ft), not the way through (15 ft)
  const wall = [-1, 0, 1].map((x) => unit({ id: "w" + x, name: "Guard", side: "npc", x, y: 2 }));
  assert.equal(E.reachable(world([ava, ...wall], "ava"), "ava", 30)["0,3"], 20);
});

test("combat engine: whose turn it is, and what the turn has left", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  const raider = unit({ id: "r1", name: "Raider", side: "npc", x: 8, y: 0 });
  let w = world([ava, raider], "ava");
  assert.equal(E.apply(w, { type: "move", unit: "r1", x: 7, y: 0 }, dice().roll).ok, false, "not the raider's turn");
  let r = E.apply(w, { type: "move", unit: "ava", x: 4, y: 0 }, dice().roll);
  assert.ok(r.ok);
  assert.deepEqual([r.world.units.ava.x, E.budget(r.world).moveLeft], [4, 10]);
  assert.equal(r.log[0].text, "Avery moves 20 ft.");
  r = E.apply(r.world, { type: "move", unit: "ava", x: 7, y: 0 }, dice().roll);
  assert.equal(r.ok, false, "15 ft is more than the 10 ft left");
  assert.match(r.why, /10 ft of movement left/);
  // the next turn (a new round for the same unit) starts fresh
  const next = Object.assign({}, E.apply(w, { type: "move", unit: "ava", x: 6, y: 0 }, dice().roll).world, { round: 2 });
  assert.equal(E.budget(next).moveLeft, 30);
  assert.equal(E.apply(world([ava], "ava", { active: false }), { type: "end", unit: "ava" }, dice().roll).ok, false, "no combat, no turns");
  assert.equal(E.apply(w, { type: "end", unit: "ava" }, dice().roll).endTurn, true);
});

test("combat engine: an attack against AC, damage from temporary hit points first", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  const raider = unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, ac: 14, hp: 15, temp: 4 });
  const w = world([ava, raider], "ava");
  const d = dice({ total: 14, nat: 9 }, { total: 7 });
  const r = E.apply(w, { type: "attack", unit: "ava", target: "r1", attack: blade }, d.roll);
  assert.ok(r.ok);
  assert.deepEqual(d.asked, ["1d20+5", "1d8+3"]);
  assert.deepEqual([r.world.units.r1.temp, r.world.units.r1.hp], [0, 12], "4 from temporary, 3 from hit points");
  assert.match(r.log[0].text, /14 against AC 14, a hit/);
  assert.match(r.log[1].text, /Raider takes 7 kinetic damage \(4 from temporary hit points\)/);
  assert.deepEqual(r.events, [{ kind: "hit", unit: "r1", amount: 7 }]);
  assert.equal(w.units.r1.hp, 15, "the world passed in is never changed");
  const again = E.apply(r.world, { type: "attack", unit: "ava", target: "r1", attack: blade }, dice().roll);
  assert.equal(again.ok, false, "one action a turn");
  assert.match(again.why, /already used the action/);
});

test("combat engine: natural 20s, natural 1s, misses and dropping to 0", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  const raider = () => unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, ac: 25, hp: 9 });
  let d = dice({ total: 25, nat: 20 }, { total: 12 });
  let r = E.apply(world([ava, raider()], "ava"), { type: "attack", unit: "ava", target: "r1", attack: blade }, d.roll);
  assert.deepEqual(d.asked, ["1d20+5", "2d8+3"], "a natural 20 hits whatever the AC and doubles the dice");
  assert.deepEqual([r.events[0].kind, r.world.units.r1.hp, r.world.units.r1.down], ["crit", 0, true]);
  assert.match(r.log[1].text, /drops to 0 hit points/);
  d = dice({ total: 26, nat: 1 });
  r = E.apply(world([ava, unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, ac: 5 })], "ava"), { type: "attack", unit: "ava", target: "r1", attack: Object.assign({}, blade, { bonus: 25 }) }, d.roll);
  assert.deepEqual([r.events[0].kind, d.asked.length], ["miss", 1], "a natural 1 misses and rolls no damage");
  d = dice({ total: 12, nat: 7 });
  r = E.apply(world([ava, raider()], "ava"), { type: "attack", unit: "ava", target: "r1", attack: blade }, d.roll);
  assert.equal(r.events[0].kind, "miss");
  // a creature whose hit points aren't known still takes the hit, and nothing is invented
  d = dice({ total: 20, nat: 15 }, { total: 6 });
  r = E.apply(world([ava, unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, hp: null, maxHp: null })], "ava"), { type: "attack", unit: "ava", target: "r1", attack: blade }, d.roll);
  assert.deepEqual([r.ok, r.world.units.r1.hp, r.events[0].amount], [true, null, 6]);
});

test("combat engine: reach, range, and what tilts the roll", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  const far = unit({ id: "r1", name: "Raider", side: "npc", x: 30, y: 0, ac: 12 });
  let w = world([ava, far], "ava");
  assert.match(E.apply(w, { type: "attack", unit: "ava", target: "r1", attack: blade }, dice().roll).why, /150 ft away: out of reach/);
  let pv = E.preview(w, "ava", "r1", rifle);
  assert.deepEqual([pv.legal, pv.mode, pv.expr], [true, "dis", "2d20kl1+5"], "past 100 ft: long range, disadvantage");
  assert.equal(pv.tilts[0].text, "long range");
  assert.equal(E.preview(world([ava, Object.assign({}, far, { x: 81 })], "ava"), "ava", "r1", rifle).legal, false, "beyond 400 ft");
  // a ranged attack with an enemy next to you is at disadvantage; choosing advantage too cancels out
  const near = unit({ id: "r2", name: "Thug", side: "npc", x: 1, y: 1 });
  w = world([ava, Object.assign({}, far, { x: 10 }), near], "ava");
  pv = E.preview(w, "ava", "r1", rifle);
  assert.deepEqual([pv.mode, pv.tilts.map((x) => x.text)], ["dis", ["an enemy within 5 ft"]]);
  assert.equal(E.preview(w, "ava", "r1", rifle, { adv: true }).mode, "normal");
  assert.equal(E.preview(w, "ava", "r2", blade, { adv: true }).expr, "2d20kh1+5", "melee: no penalty, advantage when chosen");
  // what you need to roll
  pv = E.preview(world([ava, unit({ id: "t", name: "T", side: "npc", x: 1, y: 0, ac: 15 })], "ava"), "ava", "t", blade);
  assert.deepEqual([pv.need, pv.chance], [10, 0.55]);
  assert.equal(E.preview(world([ava, unit({ id: "t", name: "T", side: "npc", x: 1, y: 0, ac: 40 })], "ava"), "ava", "t", blade).need, 20, "a 20 always hits");
  assert.equal(E.preview(world([ava, unit({ id: "t", name: "T", side: "npc", x: 1, y: 0, ac: 2 })], "ava"), "ava", "t", blade).need, 2, "a 1 always misses");
  assert.equal(E.preview(world([ava, unit({ id: "t", name: "T", side: "npc", x: 1, y: 0, ac: null })], "ava"), "ava", "t", blade).legal, false);
  assert.equal(E.preview(w, "ava", "ava", blade).legal, false);
});

test("combat engine: a world from the table (initiative, tokens, sheets)", () => {
  const table = {
    active: true, turn: 1, round: 2,
    entries: [{ id: "e1", name: "Avery", charId: "c1" }, { id: "e2", name: "Raider", charId: null, ac: 13, hp: 11, maxHp: 11 }, { id: "e3", name: "Lurker", ac: 12, hp: 5 }],
    characters: { c1: { owner: "p1", ac: 15, speed: 35, hp: { current: 18, max: 22, temp: 3 } } },
    tokens: [{ id: "t1", x: 2, y: 3, size: 1, charId: "c1" }, { id: "t2", x: 5, y: 3, size: 2 }],
    unitTokens: { e1: "t1", e2: "t2" }, npcSpeed: { e2: 40 },
  };
  const w = E.buildWorld(table);
  assert.deepEqual(Object.keys(w.units), ["e1", "e2"], "a combatant with no token on the map is not in the fight");
  assert.deepEqual([w.turnId, w.round, w.active], ["e2", 2, true]);
  assert.deepEqual([w.units.e1.ac, w.units.e1.hp, w.units.e1.temp, w.units.e1.speed, w.units.e1.owner, w.units.e1.side], [15, 18, 3, 35, "p1", "pc"]);
  assert.deepEqual([w.units.e2.ac, w.units.e2.hp, w.units.e2.speed, w.units.e2.size, w.units.e2.side], [13, 11, 40, 2, "npc"]);
});

/* ---------------------------------------------------------------- the server's fight actions, through the API */
const Module = require("module");
const HoloFake = require("./holotable-fake-redis.js");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === "ioredis" ? "ioredis-stub" : orig.call(this, req, ...rest); };
require.cache["ioredis-stub"] = { id: "ioredis-stub", filename: "ioredis-stub", loaded: true, exports: HoloFake };
process.env.REDIS_URL = "redis://stub";
const PLAYER_PW = "nerf-herder-77", GM_PW = "outer-rim-9";
process.env.HOLOTABLE_PLAYER_PASSWORD = PLAYER_PW;
process.env.HOLOTABLE_GM_PASSWORD = GM_PW;
const S = require("../api/_holotable-store.js");
const handler = require("../api/holotable.js");
let db = new HoloFake(), sub = null;
S.getClient = () => db;
S.getSub = () => (sub = sub || db.duplicate());
let ipn = 1;
function browser() {
  const b = { cookie: "", ip: `10.7.0.${ipn++}` };
  b.call = async (method, query, body) => {
    const headers = Object.assign({ "x-forwarded-for": b.ip, cookie: b.cookie }, method === "POST" ? { "x-holotable": "1" } : {});
    const res = { code: 0, headers: {}, data: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; }, send(d) { this.data = d; return this; } };
    await handler({ method, query, body, headers }, res);
    const sc = res.headers["set-cookie"];
    if (sc) { const m = /^ht_session=([^;]*)/.exec(sc); b.cookie = m && m[1] ? `ht_session=${m[1]}` : ""; }
    return res;
  };
  b.act = (type, payload) => b.call("POST", { op: "action" }, { type, payload });
  b.state = async () => (await b.call("GET", { op: "poll", v: "", wait: "50" })).data.state;
  b.login = (password, name) => b.call("POST", { op: "login" }, { password, name });
  return b;
}
// A table with two characters, a creature everyone sees and one hidden creature, in a fixed initiative order:
// Avery (Sam's) 20, Raider 15, Bolt (Rae's) 10, Lurker (hidden) 5.
async function fight() {
  db = new HoloFake(); sub = null;
  const gm = browser(), sam = browser(), rae = browser();
  await gm.login(GM_PW, "Dee"); await sam.login(PLAYER_PW, "Sam"); await rae.login(PLAYER_PW, "Rae");
  const sheet = (name, x) => ({ name, ac: 15, speed: 30, hp: { max: 20, current: 20, temp: 0 }, classes: [{ name: "Fighter", level: 1 }],
    abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    attacks: [{ name: "Vibrosword", ab: "str", damage: "1d8", type: "kinetic", props: "" }, { name: "Blaster pistol", ab: "dex", damage: "1d6", type: "energy", props: "Range (40/160)" }], x });
  const avery = (await sam.act("char.save", { char: sheet("Avery") })).data.id;
  const bolt = (await rae.act("char.save", { char: sheet("Bolt") })).data.id;
  await sam.act("token.add", { charId: avery, x: 0, y: 0 });
  await rae.act("token.add", { charId: bolt, x: 0, y: 4 });
  await gm.act("token.add", { name: "Raider", x: 6, y: 0 });
  await gm.act("token.add", { name: "Lurker", x: 1, y: 1, hidden: true });
  await sam.act("init.add", { charId: avery, name: "Avery", init: 20 });
  await gm.act("init.add", { name: "Raider", init: 15, hp: 30, ac: 2 });
  await rae.act("init.add", { charId: bolt, name: "Bolt", init: 10 });
  await gm.act("init.add", { name: "Lurker", init: 5, hp: 10, ac: 2, hidden: true });
  await gm.act("init.start", {});
  const st = await gm.state();
  const id = (n) => st.initiative.entries.find((e) => e.name === n).id;
  return { gm, sam, rae, avery, bolt, ids: { avery: id("Avery"), raider: id("Raider"), bolt: id("Bolt"), lurker: id("Lurker") } };
}
const tokenOf = (st, name) => st.map.tokens.find((t) => t.name === name);

test("combat view: off until the GM switches it on, and players never see hidden combatants", async () => {
  const { gm, sam, ids } = await fight();
  assert.equal((await sam.act("fight.move", { x: 1, y: 0 })).code, 400, "the view is off");
  assert.equal((await sam.act("fight.toggle", { on: true })).code, 403, "only the GM switches it");
  assert.equal((await gm.act("fight.toggle", { on: true })).code, 200);
  const pv = await sam.state(), gv = await gm.state();
  assert.equal(pv.fight.on, true);
  assert.equal(pv.fight.turn, ids.avery);
  assert.deepEqual(Object.keys(pv.fight.units).sort(), [ids.avery, ids.bolt, ids.raider].sort(), "the hidden Lurker isn't a unit for players");
  assert.ok(gv.fight.units[ids.lurker], "the GM sees it");
  assert.equal(pv.fight.units[ids.avery].mine, true);
  assert.equal(pv.fight.undo, null, "no undo stack for players");
  assert.ok(!JSON.stringify(pv).includes("Lurker"), "the name never reaches a player");
  assert.deepEqual([pv.fight.budget.moveLeft, pv.fight.budget.action], [30, true]);
  await gm.act("fight.toggle", { on: false });
  assert.deepEqual((await sam.state()).fight, { on: false });
});

test("combat view: only the owner moves, on their own turn, within their movement", async () => {
  const { gm, sam, rae, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  assert.equal((await rae.act("fight.move", { x: 1, y: 4 })).code, 403, "not Rae's turn");
  assert.equal((await sam.act("fight.move", { x: 7, y: 0 })).code, 400, "35 ft is too far");
  let r = await sam.act("fight.move", { x: 4, y: 0 });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  let st = await sam.state();
  assert.deepEqual([tokenOf(st, "Avery").x, st.fight.budget.moveLeft], [4, 10]);
  assert.equal((await sam.act("fight.move", { x: 6, y: 0 })).code, 400, "the Raider's square");
  // the hidden Lurker at (1,1) doesn't block a player's move, so it can't give itself away
  r = await sam.act("fight.move", { x: 3, y: 1 });
  assert.equal(r.code, 200);
  assert.equal((await sam.state()).fight.events.at(-1).kind, "move");
  void ids;
});

test("combat view: an attack rolls on the server, hits AC or misses, and damages the target", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  assert.equal((await sam.act("fight.attack", { attack: 0, target: ids.raider })).code, 400, "30 ft away: out of reach");
  assert.equal((await sam.act("fight.attack", { attack: 9, target: ids.raider })).code, 400, "no such attack on the sheet");
  assert.equal((await sam.act("fight.attack", { attack: 0, target: ids.lurker })).code, 400, "a hidden creature isn't a target");
  const nope = await sam.act("fight.attack", { attack: 0, target: "zzzzzzzzzz" });
  assert.equal((await sam.act("fight.attack", { attack: 0, target: ids.lurker })).data.error, nope.data.error, "same answer as a creature that doesn't exist");
  await sam.act("fight.move", { x: 5, y: 0 });
  const r = await sam.act("fight.attack", { attack: 0, target: ids.raider });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  const st = await gm.state();
  const rolls = st.chat.filter((m) => m.fight && m.roll);
  const atk = rolls.find((m) => m.roll.kind === "attack");
  assert.match(atk.roll.label, /Avery attacks Raider with Vibrosword/);
  assert.equal(atk.roll.expr, "1d20+5", "Str +3 and proficiency +2, from rules.js");
  const raider = st.initiative.entries.find((e) => e.id === ids.raider);
  const dmg = rolls.find((m) => m.roll.kind === "damage");
  if (atk.roll.nat === 1) assert.equal(raider.hp, 30, "a natural 1 misses");
  else assert.equal(raider.hp, Math.max(0, 30 - dmg.roll.total), "AC 2: anything but a 1 hits, and the damage comes off");
  assert.equal((await sam.act("fight.attack", { attack: 0, target: ids.raider })).code, 400, "the action is spent");
  assert.equal((await sam.state()).fight.budget.action, false);
});

test("combat view: ending the turn passes it on; creatures are the GM's; undo puts things back", async () => {
  const { gm, sam, rae, ids, avery } = await fight();
  await gm.act("fight.toggle", { on: true });
  assert.equal((await rae.act("fight.end", {})).code, 403, "only the turn's owner ends it");
  assert.equal((await sam.act("fight.end", {})).code, 200);
  let st = await sam.state();
  assert.equal(st.fight.turn, ids.raider);
  assert.deepEqual([st.fight.budget.moveLeft, st.fight.budget.action], [30, true], "a fresh turn");
  // the Raider's turn: players can't act for it; the GM can, with an attack from its stat block
  assert.equal((await sam.act("fight.move", { x: 1, y: 0 })).code, 403);
  assert.equal((await gm.act("fight.attack", { target: ids.avery, attack: { name: "Blaster", bonus: 30, damage: "rm -rf", range: [60, 240] } })).code, 400, "damage must be dice");
  assert.equal((await gm.act("fight.attack", { target: ids.avery, attack: { name: "Blaster", bonus: 30, damage: "2d6+2", type: "energy", range: [60, 240] } })).code, 200);
  st = await gm.state();
  const hp = st.characters[avery].hp.current;
  const last = st.chat.filter((m) => m.fight).at(-1);
  if (last.roll.kind === "damage") assert.equal(hp, 20 - Math.min(20, last.roll.total)); else assert.equal(hp, 20);
  // undo the attack: Avery's hit points come back
  assert.equal((await sam.act("fight.undo", {})).code, 403);
  assert.equal((await gm.act("fight.undo", {})).code, 200);
  st = await gm.state();
  assert.equal(st.characters[avery].hp.current, 20);
  assert.equal(st.fight.budget.action, true, "and the action is unspent again");
  assert.match(st.chat.at(-1).text, /undid the last combat step/);
  // undo the end of Avery's turn: it's Avery's turn again, with what was left
  await gm.act("fight.undo", {});
  assert.equal((await sam.state()).fight.turn, ids.avery);
  assert.equal((await gm.act("fight.undo", {})).code, 400, "nothing left to undo");
});

test("combat view: a hidden creature's turn stays hidden from players", async () => {
  const { gm, sam, rae, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  await sam.act("fight.end", {});           // to the Raider
  await gm.act("fight.end", {});            // to Bolt
  await rae.act("fight.end", {});           // to the Lurker
  const pv = await sam.state(), gv = await gm.state();
  assert.equal(pv.fight.turn, null, "players see that it's nobody's turn they know about");
  assert.equal(pv.fight.budget, null);
  assert.equal(gv.fight.turn, ids.lurker);
  const moved = await gm.act("fight.move", { x: 0, y: 1 });
  assert.equal(moved.code, 200, JSON.stringify(moved.data));
  const atk = await gm.act("fight.attack", { target: ids.avery, attack: { name: "Claw", bonus: 30, damage: "1d4", melee: 5 } });
  assert.equal(atk.code, 200, JSON.stringify(atk.data));
  const after = await sam.state();
  assert.ok(!JSON.stringify(after).includes("Lurker"), "no roll, event or name of the Lurker reaches a player");
  assert.ok(!after.fight.events.some((ev) => ev.kind === "move"), "its move isn't an event players get");
  assert.ok((await gm.state()).chat.some((m) => m.fight && m.private && /Lurker attacks Avery/.test(m.roll.label)), "the GM gets the roll");
});

test("combat view: GM tools: set hit points, creature speed, link a token", async () => {
  const { gm, sam, ids, avery } = await fight();
  await gm.act("fight.toggle", { on: true });
  assert.equal((await sam.act("fight.hp", { id: ids.avery, hp: 1 })).code, 403);
  assert.equal((await gm.act("fight.hp", { id: ids.avery, hp: 7, temp: 5 })).code, 200);
  let st = await gm.state();
  assert.deepEqual([st.characters[avery].hp.current, st.characters[avery].hp.temp], [7, 5]);
  assert.equal((await gm.act("fight.npc", { id: ids.raider, speed: 40 })).code, 200);
  assert.equal((await gm.act("fight.npc", { id: ids.avery, speed: 40 })).code, 400, "characters' speed is on their sheet");
  assert.equal((await gm.state()).fight.npcSpeed[ids.raider], 40);
  assert.deepEqual((await sam.state()).fight.npcSpeed, {}, "players don't get creature speeds");
  await gm.act("token.add", { name: "Raider's spare", x: 9, y: 9 });
  st = await gm.state();
  const spare = tokenOf(st, "Raider's spare").id;
  assert.equal((await gm.act("fight.link", { id: ids.raider, token: spare })).code, 200);
  assert.equal((await gm.state()).fight.units[ids.raider].token, spare);
  assert.equal((await gm.act("fight.link", { id: ids.raider, token: "nosuchtoken" })).code, 400);
});
