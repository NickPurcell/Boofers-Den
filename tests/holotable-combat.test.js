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
  return Object.assign({ active: true, round: 1, turnId, units: Object.fromEntries(units.map((u) => [u.id, u])), spent: {} }, extra);
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

test("resources: a maximum read at the character's level in a class, or a plain number", () => {
  const ch = { classes: [{ name: "Fighter", level: 3 }, { name: "Scout", level: 2 }] };
  const table = { class: "Fighter", levels: [0, 0, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6] };
  assert.equal(E.atLevel(ch, table), 4);
  assert.equal(E.atLevel(ch, { class: "total", levels: Array.from({ length: 20 }, (_, i) => i + 1) }), 5);
  assert.equal(E.atLevel(ch, { class: "Monk", levels: table.levels }), null, "no levels in that class");
  assert.equal(E.atLevel(ch, 3), 3);
});

test("resources: cleaned to plain, bounded fields; built-in keys can't be redefined", () => {
  const c = E.cleanResources([
    { key: "Second Wind!", name: "Second Wind", max: 1, used: 0, refill: "short" },
    { key: "force", name: "Fake force", max: 99 },
    { key: "dice", name: "Dice", max: { class: "Fighter", levels: ["4", 5, "x"] }, die: "d7", used: -3, refill: "sometimes" },
    "junk", null,
  ]);
  assert.deepEqual(c, [
    { key: "secondwind", name: "Second Wind", max: 1, die: undefined, used: 0, refill: "short" },
    { key: "dice", name: "Dice", max: { class: "Fighter", levels: [4, 5, 0] }, die: "", used: 0, refill: "manual" },
  ]);
  assert.equal(E.cleanResources(Array.from({ length: 50 }, (_, i) => ({ key: "r" + i, max: 1 }))).length, 30);
});

const caster = () => ({ classes: [{ name: "Consular", level: 2 }], abilities: { str: 8, dex: 12, con: 12, int: 10, wis: 16, cha: 10 },
  force: { max: "", used: 2 }, tech: { max: "", used: 0 }, hitDiceUsed: 1,
  resources: [{ key: "focus", name: "Focus", max: 3, used: 1, refill: "short" }, { key: "boon", name: "Boon", max: 1, used: 1, refill: "long" }, { key: "luck", name: "Luck", max: 2, used: 2, refill: "manual" }] });

test("resources: the sheet's own list plus force points, tech points and hit dice, read where they live", () => {
  const ch = caster();
  const res = Object.fromEntries(E.resourcesOf(ch, R).map((r) => [r.key, r]));
  assert.equal(res.force.max, R.casterInfo(ch).forceMax, "force points from HoloTable's own caster arithmetic");
  assert.deepEqual([res.force.used, res.force.refill], [2, "long"]);
  assert.equal(res.tech, undefined, "no tech points for a Consular");
  assert.deepEqual([res.hitdice.max, res.hitdice.used, res.hitdice.regain], [2, 1, 1]);
  assert.deepEqual([res.focus.max, res.focus.used, res.focus.refill], [3, 1, "short"]);
  const manual = Object.fromEntries(E.resourcesOf(Object.assign(caster(), { force: { max: 9, used: 0 } }), R).map((r) => [r.key, r]));
  assert.equal(manual.force.max, 9, "a typed max overrides, as on the sheet");
});

test("resources: spending is checked and written back where the resource lives", () => {
  const ch = caster();
  let r = E.spend(ch, "force", 2, R);
  assert.ok(r.ok);
  assert.equal(r.ch.force.used, 4);
  assert.equal(ch.force.used, 2, "the character passed in is not changed");
  r = E.spend(ch, "focus", 2, R);
  assert.equal(r.ch.resources.find((x) => x.key === "focus").used, 3);
  assert.equal(E.spend(ch, "focus", 3, R).ok, false);
  assert.match(E.spend(ch, "focus", 3, R).why, /Not enough Focus: 2 of 3 left/);
  assert.equal(E.spend(ch, "hitdice", 1, R).ch.hitDiceUsed, 2);
  assert.equal(E.spend(ch, "nothing", 1, R).ok, false);
  assert.equal(E.spend(ch, "focus", 0, R).ok, false);
});

test("resources: a short rest refills short ones (and tech points); a long rest refills short and long, and half the hit dice", () => {
  const ch = Object.assign(caster(), { classes: [{ name: "Engineer", level: 4 }], tech: { max: "", used: 3 }, hitDiceUsed: 4 });
  const short = E.rest(ch, "short", R);
  assert.deepEqual([short.resources.map((x) => x.used), short.tech.used, short.hitDiceUsed], [[0, 1, 2], 0, 4]);
  const long = E.rest(ch, "long", R);
  assert.deepEqual([long.resources.map((x) => x.used), long.tech.used, long.hitDiceUsed], [[0, 0, 2], 0, 2], "manual ones stay; 2 of 4 hit dice back");
});

test("turn budget: each unit's own turn refills its movement, action, bonus action and reaction", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  const raider = unit({ id: "r1", name: "Raider", side: "npc", x: 9, y: 0 });
  // Avery used her reaction during the Raider's turn (as a later reaction rule will record it): it stays used until her own turn
  const w = world([ava, raider], "r1", { spent: { ava: { key: "1:ava", move: 30, action: 1, bonus: 0, reaction: 1 } } });
  assert.deepEqual([E.budget(w, "ava").reaction, E.budget(w, "ava").moveLeft], [false, 0]);
  const hers = Object.assign({}, w, { turnId: "ava", round: 2 });
  assert.deepEqual([E.budget(hers).reaction, E.budget(hers).moveLeft, E.budget(hers).action], [true, 30, true]);
  const r = E.apply(hers, { type: "move", unit: "ava", x: 2, y: 0 }, dice().roll);
  assert.deepEqual(r.world.spent.ava, { key: "2:ava", move: 10, action: 0, bonus: 0, reaction: 0 });
});

// a level-3 Consular with two powers; the table has data for one of them (numbers invented for the test)
const consular = () => ({ name: "Cass", classes: [{ name: "Consular", level: 3 }], abilities: { str: 8, dex: 12, con: 12, int: 10, wis: 16, cha: 12 },
  force: { max: "", used: 0 }, tech: { max: "", used: 0 }, hp: { max: 18, current: 18, temp: 0 }, attacks: [],
  powers: [{ name: "Mind Shove", level: 1, type: "force", alignment: "universal" }, { name: "Unknown Art", level: 1, type: "force" }] });
const SHOVE = { use: "action", range: [60, 60], save: { ability: "str", dc: "power", onSave: "half" }, damage: [{ dice: "2d6", type: "force" }], upcast: { damage: "1d6" } };

test("abilities: a power's cost, DC and attack come from HoloTable's own caster arithmetic", () => {
  const ch = consular(), ci = R.casterInfo(ch);
  const n = E.powerNumbers(ch, ch.powers[0], R);
  assert.deepEqual([n.pool, n.cost, n.dc, n.atk], ["force", 2, Math.max(ci.lightDC, ci.darkDC), Math.max(ci.lightAtk, ci.darkAtk)], "level 1: 2 points; universal: the better side");
  assert.equal(E.powerNumbers(ch, { level: 0, type: "tech" }, R).cost, 0, "at-will is free");
  assert.equal(E.powerNumbers(ch, { level: 2, type: "force", alignment: "dark" }, R).dc, ci.darkDC);
  const abs = E.abilitiesOf(ch, R, { "mind shove": SHOVE });
  assert.deepEqual(abs.map((a) => a.name), ["Mind Shove"], "a power with no data isn't offered (it still works from the sheet)");
  assert.deepEqual([abs[0].save.dc, abs[0].cost, abs[0].range], [n.dc, { force: 2 }, [60, 60]]);
});

test("abilities: data is checked field by field", () => {
  assert.equal(E.cleanAbility({ damage: [{ dice: "1d6;drop" }] }), null);
  assert.equal(E.cleanAbility(null), null);
  const c = E.cleanAbility({ use: "sometimes", targets: 99, save: { ability: "luck" }, damage: [{ dice: "3d8+2", type: "Fire!" }], range: [30, 10] });
  assert.deepEqual([c.use, c.targets, c.save, c.damage[0], c.range], ["action", 10, null, { dice: "3d8+2", add: null, type: "fire" }, [30, 30]]);
});

test("abilities: a save for half, paid from the pool, refused when the turn or the points can't cover it", () => {
  const ch = consular();
  const ab = E.abilitiesOf(ch, R, { "mind shove": SHOVE })[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((r) => [r.key, r])) });
  const raider = unit({ id: "r1", name: "Raider", side: "npc", x: 5, y: 0, hp: 20, saves: { str: 2 } });
  const w = world([me, raider], "cass");
  // save succeeds: half of 9
  let d = dice({ total: 15, nat: 13 }, { total: 9 });
  let r = E.apply(w, { type: "use", unit: "cass", ability: ab, target: "r1" }, d.roll);
  assert.ok(r.ok, r.why);
  assert.deepEqual(d.asked, ["1d20+2", "2d6"]);
  assert.deepEqual([r.world.units.r1.hp, r.world.units.cass.pools.force.used, E.budget(r.world).action], [16, 2, false]);
  assert.match(r.log[0].text, /Cass uses Mind Shove \(2 Force points\)/);
  assert.match(r.log[1].text, /STR save against DC \d+: 15, a success/);
  assert.match(r.log[2].text, /takes 4 force damage \(half, on a save\)/);
  assert.equal(E.apply(r.world, { type: "use", unit: "cass", ability: ab, target: "r1" }, dice().roll).ok, false, "the action is spent");
  // cast at level 2: one more point and one more die; refused above the caster's max level or beyond the pool
  d = dice({ total: 3, nat: 1 }, { total: 12 });
  r = E.apply(w, { type: "use", unit: "cass", ability: ab, target: "r1", upcast: 1 }, d.roll);
  assert.deepEqual([d.asked[1], r.world.units.cass.pools.force.used], ["2d6+1d6", 3]);
  assert.match(E.apply(w, { type: "use", unit: "cass", ability: ab, target: "r1", upcast: 5 }, dice().roll).why, /up to level/);
  assert.match(E.apply(w, { type: "use", unit: "cass", ability: Object.assign({}, ab, { level: ab.maxLevel + 1 }), target: "r1" }, dice().roll).why, /up to level/, "a power above the caster's level, even without casting it higher");
  const broke = world([Object.assign({}, me, { pools: { force: Object.assign({}, me.pools.force, { used: me.pools.force.max - 1 }) } }), raider], "cass");
  assert.match(E.apply(broke, { type: "use", unit: "cass", ability: ab, target: "r1" }, dice().roll).why, /Not enough Force points: 2 needed, 1 left/);
  assert.match(E.apply(world([me, Object.assign({}, raider, { x: 20 })], "cass"), { type: "use", unit: "cass", ability: ab, target: "r1" }, dice().roll).why, /out of range/);
  assert.match(E.apply(w, { type: "use", unit: "cass", ability: ab, targets: ["r1", "r1"] }, dice().roll).why, /one target/);
});

test("abilities: an attack roll, healing, and a creature whose save bonus isn't known", () => {
  const ch = consular();
  const lib = { "mind shove": { use: "bonus", reach: 5, attack: { bonus: "power" }, damage: [{ dice: "1d8", add: "wis", type: "force" }] }, "unknown art": { use: "action", range: [30, 30], heal: { dice: "1d4", add: "wis" } } };
  const [strike, mend] = E.abilitiesOf(ch, R, lib);
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((r) => [r.key, r])) });
  const pal = unit({ id: "pal", name: "Pal", side: "pc", x: 2, y: 0, hp: 5, maxHp: 20 });
  const raider = unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, ac: 10 });
  let d = dice({ total: 20, nat: 20 }, { total: 13 });
  let r = E.apply(world([me, pal, raider], "cass"), { type: "use", unit: "cass", ability: strike, target: "r1" }, d.roll);
  assert.deepEqual(d.asked, [`1d20+${E.powerNumbers(ch, ch.powers[0], R).atk}`, "2d8+3"], "a critical doubles the dice, not the modifier");
  assert.equal(E.budget(r.world).bonus, false, "it used the bonus action");
  d = dice({ total: 6 });
  r = E.apply(r.world, { type: "use", unit: "cass", ability: mend, target: "pal" }, d.roll);
  assert.deepEqual([d.asked[0], r.world.units.pal.hp, r.events[0].kind], ["1d4+3", 11, "heal"]);
  const shove = E.abilitiesOf(ch, R, { "mind shove": SHOVE })[0];
  d = dice({ total: 8, nat: 8 }, { total: 7 });
  r = E.apply(world([me, Object.assign({}, raider, { saves: {} })], "cass"), { type: "use", unit: "cass", ability: shove, target: "r1" }, d.roll);
  assert.equal(d.asked[0], "1d20+0");
  assert.match(r.log[1].text, /no save bonus known/);
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
  assert.ok(!JSON.stringify(after).includes(ids.lurker), "nor its id: not in the turn, the spending or the events");
  assert.ok(!(ids.lurker in after.fight.spent));
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

test("resources through the API: owners and the GM spend and edit; undo puts the spend back; sheet saves keep them", async () => {
  const { gm, sam, rae, avery } = await fight();
  const res = { key: "secondwind", name: "Second Wind", max: 1, used: 0, refill: "short" };
  assert.equal((await rae.act("fight.resource", { charId: avery, res })).code, 403, "not Rae's character");
  assert.equal((await sam.act("fight.resource", { charId: avery, res })).code, 200);
  assert.equal((await sam.act("fight.resource", { charId: avery, res: { key: "", name: "x", max: 1 } })).code, 400);
  let st = await sam.state();
  assert.deepEqual(st.characters[avery].resources, [{ key: "secondwind", name: "Second Wind", max: 1, used: 0, refill: "short" }]);
  // a normal sheet save carries the list and the server keeps it
  const ch = st.characters[avery];
  await sam.act("char.save", { char: Object.assign({}, ch, { name: "Avery" }) });
  assert.equal((await sam.state()).characters[avery].resources.length, 1);
  assert.equal((await rae.act("fight.spend", { charId: avery, key: "secondwind" })).code, 403);
  assert.equal((await sam.act("fight.spend", { charId: avery, key: "secondwind" })).code, 200);
  assert.equal((await sam.act("fight.spend", { charId: avery, key: "secondwind" })).code, 400, "none left");
  st = await gm.state();
  assert.equal(st.characters[avery].resources[0].used, 1);
  assert.match(st.chat.at(-1).text, /Avery uses Second Wind: 0 of 1 left/);
  await gm.act("fight.undo", {});
  assert.equal((await gm.state()).characters[avery].resources[0].used, 0);
  assert.equal((await sam.act("fight.resource", { charId: avery, op: "remove", key: "secondwind" })).code, 200);
  assert.deepEqual((await sam.state()).characters[avery].resources, []);
});

test("combat view: a crafted fight state is reshaped before it is used", async () => {
  const F = require("../api/_holotable-fight.js");
  const camp = { fight: { on: "yes", undo: [{ label: 5, tokens: [["abcdefgh", "x", 9e9]], hp: [["abcdefgh", "lots", ["a", -5]]], ini: { turnId: "<b>", round: "x" } }, "junk"],
    events: [{ kind: "<img src=x>", token: "../../x", amount: "9", seq: "3" }], spent: { abcdefgh: { move: "far" }, "<bad>": {} } } };
  const f = F.state(camp);
  assert.equal(f.on, true);
  assert.deepEqual(f.undo[0].tokens, [["abcdefgh", 0, 1000]]);
  assert.deepEqual(f.undo[0].hp, [["abcdefgh", 0, [0, 0]]]);
  assert.deepEqual([f.undo[0].ini.turnId, f.undo[0].ini.round, f.undo.length], [null, 1, 1]);
  assert.deepEqual(f.events[0], { seq: 3, at: 0, kind: "move", token: null, amount: 9, feet: null, hidden: false });
  assert.deepEqual(Object.keys(f.spent), ["abcdefgh"]);
  assert.equal(f.spent.abcdefgh.move, 0);
});

test("abilities through the API: the GM teaches the table a power; its caster uses it; points come off the sheet", async () => {
  const { gm, sam, rae, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  // Sam's Avery learns a power (a sheet save, as from the power picker)
  let st = await sam.state();
  const av = Object.values(st.characters).find((c) => c.name === "Avery");
  await sam.act("char.save", { char: Object.assign({}, av, { classes: [{ name: "Consular", level: 3 }], abilities: Object.assign({}, av.abilities, { wis: 16 }),
    powers: [{ name: "Mind Shove", level: 1, type: "force", alignment: "universal" }] }) });
  assert.equal((await sam.act("fight.ability", { name: "Mind Shove", data: SHOVE })).code, 403, "the GM teaches the table");
  assert.equal((await gm.act("fight.ability", { name: "Mind Shove", data: { damage: [{ dice: "lots" }] } })).code, 400);
  assert.equal((await sam.act("fight.use", { ability: "pw:mind shove", target: ids.raider })).code, 400, "no data yet");
  assert.equal((await gm.act("fight.ability", { name: "Mind Shove", data: SHOVE })).code, 200);
  st = await sam.state();
  assert.deepEqual(st.fight.lib["mind shove"].save, { ability: "str", dc: "power", onSave: "half" }, "everyone sees the table's data");
  await gm.act("fight.npc", { id: ids.raider, speed: 30, saves: { str: 3 } });
  assert.deepEqual((await gm.state()).fight.npcSaves[ids.raider], { str: 3 });
  assert.deepEqual((await sam.state()).fight.npcSaves, {}, "players don't get creature saves");
  assert.equal((await rae.act("fight.use", { ability: "pw:mind shove", target: ids.raider })).code, 403, "not Rae's turn");
  const r = await sam.act("fight.use", { ability: "pw:mind shove", target: ids.raider });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  st = await gm.state();
  assert.equal(st.characters[av.id].force.used, 2, "two force points came off the sheet");
  const save = st.chat.filter((m) => m.fight && m.roll && m.roll.kind === "save").at(-1);
  assert.equal(save.roll.expr, "1d20+3", "the creature's STR save from its stat block");
  assert.ok(st.chat.some((m) => m.system && /Avery uses Mind Shove \(2 Force points\)/.test(m.text)));
  await gm.act("fight.undo", {});
  assert.equal((await gm.state()).characters[av.id].force.used, 0, "undo gives the points back");
});
