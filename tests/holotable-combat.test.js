// HoloTable combat view: the engine (pure) and the server's fight actions, and proof that with the view off nothing changes.
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

test("combat engine: distance by SW5e's grid rule, diagonals alternating 5 ft and 10 ft", () => {
  const a = { x: 0, y: 0 }, big = { x: 3, y: 3, size: 2 };
  assert.equal(E.feetBetween(a, { x: 1, y: 1 }), 5, "the first diagonal is 5 ft");
  assert.equal(E.feetBetween(a, { x: 2, y: 2 }), 15, "the second is 10 ft");
  assert.equal(E.feetBetween(a, { x: 3, y: 3 }), 20);
  assert.equal(E.feetBetween(a, { x: 4, y: 1 }), 20, "three straight and one diagonal");
  assert.equal(E.feetBetween(a, a), 0);
  assert.equal(E.feetBetween(a, big), 20, "a 2×2 creature is measured from its nearest square: three diagonals");
  assert.equal(E.feetBetween(big, { x: 5, y: 4 }), 5);
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
  assert.equal(reach["5,0"], 30, "round the ally diagonally (5 + 10), then three straight");
  assert.equal(reach["6,0"], undefined, "35 ft: the ally in the way costs extra either way");
  assert.equal(E.reachable(world([ava], "ava"), "ava", 30)["6,0"], 30, "with nobody in the way, six straight squares");
  assert.equal(reach["4,4"], 30, "four diagonals: 5 + 10 + 5 + 10");
  assert.equal(reach["5,5"], undefined, "five diagonals cost 35 ft");
  assert.equal(reach["1,0"], undefined, "an ally's square: may pass, may not stop");
  assert.equal(reach["2,0"], 15, "past the ally: its space is difficult terrain (or round it, diagonally)");
  assert.equal(reach["0,2"], undefined, "an enemy's square");
  assert.equal(E.reachable(w, "ava", 0)["1,1"], undefined);
  // a wall of three enemies: the square behind it costs the way round (20 ft), not the way through (15 ft)
  const wall = [-1, 0, 1].map((x) => unit({ id: "w" + x, name: "Guard", side: "npc", x, y: 2 }));
  assert.equal(E.reachable(world([ava, ...wall], "ava"), "ava", 30)["0,3"], 25);
  // prone: crawling costs double
  assert.equal(E.reachable(world([Object.assign({}, ava, { conditions: ["Prone"] })], "ava"), "ava", 30)["3,0"], 30);
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
  assert.deepEqual(E.spend(ch, "hitdice", 1, R).ch.hitDiceUsed, { d6: 2 }, "hit dice per die size (audit 7.2)");
  assert.equal(E.spend(ch, "nothing", 1, R).ok, false);
  assert.equal(E.spend(ch, "focus", 0, R).ok, false);
});

test("resources: a short rest refills short ones (and tech points); a long rest refills short and long, and half the hit dice", () => {
  const ch = Object.assign(caster(), { classes: [{ name: "Engineer", level: 4 }], tech: { max: "", used: 3 }, hitDiceUsed: 4 });
  const short = E.rest(ch, "short", R);
  assert.deepEqual([short.resources.map((x) => x.used), short.tech.used, short.hitDiceUsed], [[0, 1, 2], 0, 4]);
  const long = E.rest(ch, "long", R);
  assert.deepEqual([long.resources.map((x) => x.used), long.tech.used, long.hitDiceUsed], [[0, 0, 2], 0, { d8: 2 }], "manual ones stay; 2 of 4 hit dice back");
  // tech points come back on a short rest only for an Engineer or a Scout
  const consularTech = Object.assign(caster(), { tech: { max: 4, used: 3 } });
  assert.equal(E.rest(consularTech, "short", R).tech.used, 3);
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
  assert.deepEqual(r.world.spent.ava, { key: "2:ava", move: 10, action: 0, bonus: 0, reaction: 0, diag: 0, dash: 0, disengage: 0, dodge: 0, ds: 0 });
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

test("measuring: a ruler by the same grid rule as movement", () => {
  assert.equal(E.ruler({ x: 0.5, y: 0.5 }, { x: 4.5, y: 2.5 }), 25, "two straight, two diagonal (5 + 10)");
  assert.equal(E.ruler({ x: 3.2, y: 1.9 }, { x: 3.7, y: 1.1 }), 0, "the same square");
});

test("areas: the squares a template covers (centres inside)", () => {
  const set = (sq) => new Set(sq.map(([x, y]) => `${x},${y}`));
  const sphere = E.areaSquares({ shape: "sphere", size: 10 }, { x: 4, y: 4 }, { x: 5, y: 4 });
  assert.equal(sphere.length, 12, "a 10 ft radius around a corner: 4×4 without its corners");
  assert.ok(!set(sphere).has("2,2") && set(sphere).has("3,3"));
  assert.equal(E.areaSquares({ shape: "line", size: 30, width: 5 }, { x: 1, y: 4.5 }, { x: 9, y: 4.5 }).length, 6);
  assert.deepEqual([...set(E.areaSquares({ shape: "cube", size: 10 }, { x: 4, y: 4 }, { x: 6, y: 6 }))].sort(), ["4,4", "4,5", "5,4", "5,5"]);
  const cone = set(E.areaSquares({ shape: "cone", size: 15 }, { x: 1, y: 4.5 }, { x: 9, y: 4.5 }));
  assert.ok(cone.has("1,4") && cone.has("3,3") && cone.has("3,5") && !cone.has("4,4") && !cone.has("0,4"), "it widens away from the caster, and stops at 15 ft");
});

test("areas: an area power catches everyone in the template and each of them saves", () => {
  const ch = consular();
  const lib = { "mind shove": { use: "action", range: [60, 60], area: { shape: "sphere", size: 10, from: "point" }, save: { ability: "dex", dc: "power", onSave: "half" }, damage: [{ dice: "2d6", type: "fire" }] } };
  const ab = E.abilitiesOf(ch, R, lib)[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((r) => [r.key, r])) });
  const a = unit({ id: "a", name: "A", side: "npc", x: 6, y: 6, saves: { dex: 1 } }), b = unit({ id: "b", name: "B", side: "npc", x: 7, y: 7, saves: { dex: 1 } });
  const far = unit({ id: "c", name: "C", side: "npc", x: 12, y: 12 });
  const w = world([me, a, b, far], "cass");
  const hits = E.areaHits(w, "cass", ab, { x: 7, y: 7 });
  assert.deepEqual(hits.units.sort(), ["a", "b"]);
  assert.match(E.areaHits(w, "cass", ab, { x: 30, y: 30 }).why, /out of range/);
  const d = dice({ total: 4, nat: 3 }, { total: 8 }, { total: 20, nat: 19 }, { total: 8 });
  const r = E.apply(w, { type: "use", unit: "cass", ability: ab, point: { x: 7, y: 7 } }, d.roll);
  assert.ok(r.ok, r.why);
  assert.deepEqual([r.world.units.a.hp, r.world.units.b.hp, r.world.units.c.hp], [12, 16, 20], "a fails (8), b saves (4), c is outside");
  assert.ok(r.log.slice(1).every((l) => l.unit), "every line about a target says which one");
  // a cone from the caster leaves the caster out
  const cone = E.abilitiesOf(ch, R, { "mind shove": { use: "action", area: { shape: "cone", size: 15, from: "self" }, save: { ability: "dex", dc: 10 }, damage: [{ dice: "1d6" }] } })[0];
  const near = unit({ id: "n", name: "N", side: "npc", x: 1, y: 0 });
  assert.deepEqual(E.areaHits(world([me, near], "cass"), "cass", cone, { x: 5.5, y: 0.5 }).units, ["n"]);
});

test("conditions: they tilt attack rolls both ways, and Prone depends on distance", () => {
  const ava = (c) => unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0, conditions: c || [] });
  const r1 = (x, c) => unit({ id: "r1", name: "Raider", side: "npc", x, y: 0, conditions: c || [] });
  const pv = (a, t, atk) => E.preview(world([a, t], "ava"), "ava", "r1", atk);
  assert.deepEqual([pv(ava(["Poisoned"]), r1(1), blade).mode, pv(ava(["Poisoned"]), r1(1), blade).tilts[0].text], ["dis", "Avery is poisoned"]);
  assert.equal(pv(ava(), r1(1, ["Restrained"]), blade).mode, "adv");
  assert.equal(pv(ava(["Invisible"]), r1(1), blade).mode, "adv");
  assert.equal(pv(ava(), r1(1, ["Prone"]), blade).mode, "adv", "prone, within 5 ft: advantage");
  assert.equal(pv(ava(), r1(6, ["Prone"]), rifle).mode, "dis", "prone, at range: disadvantage");
  assert.equal(pv(ava(["Poisoned"]), r1(1, ["Restrained"]), blade).mode, "normal", "advantage and disadvantage cancel out");
  assert.equal(pv(ava(["Charmed"]), r1(1), blade).mode, "normal", "a condition with no listed effect is a label");
});

test("conditions: speed, actions and saves", () => {
  const w = (c) => world([unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0, conditions: c }), unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, hp: 20 })], "ava");
  assert.equal(E.budget(w(["Restrained"])).moveLeft, 0);
  assert.deepEqual([E.budget(w(["Shocked"])).moveLeft, E.budget(w(["Shocked"])).reaction], [30, false], "shocked: no reactions; speed is not affected");
  // shocked: an action or a bonus action, not both
  const sh = Object.assign({}, w(["Shocked"]), { spent: { ava: { key: "1:ava", move: 0, action: 1, bonus: 0, reaction: 0 } } });
  assert.deepEqual([E.budget(sh).action, E.budget(sh).bonus], [false, false]);
  assert.deepEqual([E.budget(w(["Stunned"])).action, E.budget(w(["Stunned"])).moveLeft], [false, 0]);
  assert.match(E.apply(w(["Stunned"]), { type: "attack", unit: "ava", target: "r1", attack: blade }, dice().roll).why, /stunned and can't act/);
  // a melee hit against a paralyzed creature within 5 ft is a critical
  const d = dice({ total: 15, nat: 10 }, { total: 11 });
  const r = E.apply(world([unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }), unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, conditions: ["Paralyzed"] })], "ava"), { type: "attack", unit: "ava", target: "r1", attack: blade }, d.roll);
  assert.deepEqual([d.asked, r.events[0].kind], [["2d20kh1+5", "2d8+3"], "crit"]);
  // a paralyzed creature fails a DEX save outright; a restrained one rolls it with disadvantage
  const ch = consular();
  const lib = { "mind shove": { use: "action", range: [60, 60], save: { ability: "dex", dc: 10 }, damage: [{ dice: "1d6" }] } };
  const ab = E.abilitiesOf(ch, R, lib)[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  let dd = dice({ total: 30, nat: 20 }, { total: 4 });
  let rr = E.apply(world([me, unit({ id: "r1", name: "Raider", side: "npc", x: 2, y: 0, conditions: ["Paralyzed"] })], "cass"), { type: "use", unit: "cass", ability: ab, target: "r1" }, dd.roll);
  assert.match(rr.log[1].text, /an automatic failure \(paralyzed\)/);
  dd = dice({ total: 15, nat: 15 });
  rr = E.apply(world([me, unit({ id: "r1", name: "Raider", side: "npc", x: 2, y: 0, conditions: ["Restrained"], saves: { dex: 0 } })], "cass"), { type: "use", unit: "cass", ability: ab, target: "r1" }, dd.roll);
  assert.equal(dd.asked[0], "2d20kl1+0");
});

test("conditions: an ability puts one on, and it ends by itself (after its rounds, or on a save)", () => {
  const ch = consular();
  const lib = { "mind shove": { use: "action", range: [60, 60], save: { ability: "str", dc: 12 }, applies: [{ condition: "Prone", until: { ends: "end", of: "target", rounds: 1 } }] },
    "unknown art": { use: "action", range: [60, 60], save: { ability: "wis", dc: 14 }, applies: [{ condition: "Restrained", until: { ends: "end", of: "target", rounds: 10, save: true } }] } };
  const [shove, hold] = E.abilitiesOf(ch, R, lib);
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const raider = unit({ id: "r1", name: "Raider", side: "npc", x: 2, y: 0, saves: { str: 0, wis: 1 } });
  let r = E.apply(world([me, raider], "cass"), { type: "use", unit: "cass", ability: shove, target: "r1" }, dice({ total: 5, nat: 5 }).roll);
  assert.deepEqual(r.world.units.r1.conditions, ["Prone"]);
  assert.equal(r.world.effects.length, 1);
  assert.match(r.log.at(-1).text, /Raider is prone/);
  // Cass's turn ends: nothing yet. The Raider's turn ends: the prone effect is over.
  let t = E.turnPassed(r.world, "cass", "r1", dice().roll);
  assert.deepEqual(t.world.units.r1.conditions, ["Prone"]);
  t = E.turnPassed(t.world, "r1", "cass", dice().roll);
  assert.deepEqual([t.world.units.r1.conditions, t.world.effects.length], [[], 0]);
  assert.match(t.log[0].text, /Raider is no longer prone/);
  // a save-ends effect: the Raider tries at the end of each of its turns
  r = E.apply(world([me, raider], "cass"), { type: "use", unit: "cass", ability: hold, target: "r1" }, dice({ total: 3, nat: 2 }).roll);
  t = E.turnPassed(r.world, "r1", "cass", dice({ total: 9, nat: 8 }).roll);
  assert.deepEqual(t.world.units.r1.conditions, ["Restrained"], "9 against DC 14: still restrained");
  t = E.turnPassed(t.world, "r1", "cass", dice({ total: 16, nat: 15 }).roll);
  assert.deepEqual(t.world.units.r1.conditions, []);
});

test("concentration: one power at a time; damage asks for a Con save; dropping to 0 ends it", () => {
  const ch = consular();
  const hold = { use: "action", range: [60, 60], save: { ability: "wis", dc: 14 }, applies: [{ condition: "Restrained", until: { ends: "end", of: "self", rounds: 10 } }], concentration: true };
  const lib = { "mind shove": hold, "unknown art": Object.assign({}, hold, { applies: [{ condition: "Blinded", until: { ends: "end", of: "self", rounds: 10 } }] }) };
  const [a1, a2] = E.abilitiesOf(ch, R, lib);
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, hp: 40, maxHp: 40, saves: { con: 1 }, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const raider = unit({ id: "r1", name: "Raider", side: "npc", x: 2, y: 0, saves: { wis: 0 } });
  let r = E.apply(world([me, raider], "cass"), { type: "use", unit: "cass", ability: a1, target: "r1" }, dice({ total: 2, nat: 2 }).roll);
  assert.deepEqual([r.world.conc.cass, r.world.units.r1.conditions], ["Mind Shove", ["Restrained"]]);
  // a new concentration power (next round) ends the first, and its condition goes with it
  r = E.apply(Object.assign({}, r.world, { round: 2 }), { type: "use", unit: "cass", ability: a2, target: "r1" }, dice({ total: 2, nat: 2 }).roll);
  assert.deepEqual([r.world.conc.cass, r.world.units.r1.conditions], ["Unknown Art", ["Blinded"]]);
  // the Raider hits Cass for 24: a DC 12 Con save; 8 fails and the power ends
  const hit = E.apply(Object.assign({}, r.world, { turnId: "r1" }), { type: "attack", unit: "r1", target: "cass", attack: Object.assign({}, blade, { bonus: 9, melee: 10 }) }, dice({ total: 25, nat: 16 }, { total: 24 }, { total: 8, nat: 7 }).roll);
  assert.match(hit.log.find((l) => /concentration save/.test(l.text)).text, /DC 12\): 8, a failure/);
  assert.deepEqual([hit.world.conc.cass, hit.world.units.r1.conditions], [undefined, []]);
  assert.match(hit.log.at(-1).text, /Cass loses concentration: Unknown Art ends/);
});

test("defences: read from a stat block's lines; halved, ignored or doubled by damage type", () => {
  assert.deepEqual(E.readDefenses(["Kinetic, Energy", "Kinetic from unenhanced weapons", "Sonic", "nothing"]), [
    { type: "energy", only: null }, { type: "kinetic", only: null }, { type: "kinetic", only: "unenhanced" }, { type: "sonic", only: null }]);
  const t = { resist: [{ type: "kinetic", only: "unenhanced" }, { type: "fire", only: null }], immune: [{ type: "poison", only: null }], vuln: [{ type: "ion", only: null }] };
  assert.deepEqual(E.defended(t, 9, "kinetic", "weapon"), { amount: 4, note: "resisted" });
  assert.deepEqual(E.defended(t, 9, "kinetic", "enhanced"), { amount: 9, note: "" }, "an enhanced weapon gets through");
  assert.deepEqual(E.defended(t, 9, "kinetic", "power"), { amount: 9, note: "" }, "so does a power");
  assert.deepEqual(E.defended(t, 9, "fire", "power"), { amount: 4, note: "resisted" });
  assert.deepEqual(E.defended(t, 9, "poison", "weapon"), { amount: 0, note: "immune" });
  assert.deepEqual(E.defended(t, 9, "ion", "weapon"), { amount: 18, note: "vulnerable" });
  assert.deepEqual(E.defended(t, 9, "", "weapon"), { amount: 9, note: "" });
});

test("defences: in an attack, in a power, and against a condition", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  const tough = unit({ id: "r1", name: "Droid", side: "npc", x: 1, y: 0, hp: 30, resist: [{ type: "kinetic", only: null }], immune: [{ type: "poison", only: null }], condImmune: ["Poisoned"], saves: { con: 0 } });
  let r = E.apply(world([ava, tough], "ava"), { type: "attack", unit: "ava", target: "r1", attack: blade }, dice({ total: 20, nat: 15 }, { total: 9 }).roll);
  assert.deepEqual([r.world.units.r1.hp, r.events[0].amount], [26, 4]);
  assert.match(r.log[1].text, /takes 4 kinetic damage \(resisted\)/);
  const ch = consular();
  const ab = E.abilitiesOf(ch, R, { "mind shove": { use: "action", range: [60, 60], save: { ability: "con", dc: 30 }, damage: [{ dice: "2d6", type: "poison" }], applies: [{ condition: "Poisoned" }] } })[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  r = E.apply(world([me, tough], "cass"), { type: "use", unit: "cass", ability: ab, target: "r1" }, dice({ total: 2, nat: 2 }, { total: 8 }).roll);
  assert.deepEqual([r.world.units.r1.hp, r.world.units.r1.conditions || []], [30, []]);
  assert.ok(r.log.some((l) => /can't be poisoned/.test(l.text)));
  assert.ok(r.log.some((l) => /takes 0 poison damage \(immune\)/.test(l.text)));
});

test("SW5e's conditions, checked against its appendix: prone, the helpless, petrified, exhaustion, weakened, charmed", () => {
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }, o));
  const r1 = (o) => unit(Object.assign({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0 }, o));
  // prone: melee at disadvantage; ranged only against a target within 30 ft
  assert.equal(E.preview(world([ava({ conditions: ["Prone"] }), r1()], "ava"), "ava", "r1", blade).mode, "dis");
  assert.equal(E.preview(world([ava({ conditions: ["Prone"] }), r1({ x: 5 })], "ava"), "ava", "r1", rifle).mode, "dis", "25 ft away");
  assert.equal(E.preview(world([ava({ conditions: ["Prone"] }), r1({ x: 8 })], "ava"), "ava", "r1", rifle).mode, "normal", "40 ft away");
  // standing up costs half your speed
  let r = E.apply(world([ava({ conditions: ["Prone"] }), r1({ x: 9 })], "ava"), { type: "stand", unit: "ava" }, dice().roll);
  assert.deepEqual([r.world.units.ava.conditions, E.budget(r.world).moveLeft], [[], 15]);
  // any hit from within 5 ft of an unconscious target is a critical, a ranged one too
  const d = dice({ total: 15, nat: 9 }, { total: 9 });
  r = E.apply(world([ava(), r1({ conditions: ["Unconscious"] })], "ava"), { type: "attack", unit: "ava", target: "r1", attack: Object.assign({}, rifle, { range: [100, 400] }) }, d.roll);
  assert.equal(r.events[0].kind, "crit");
  // petrified: resistance to all damage, immune to poison
  assert.deepEqual(E.defended({ conditions: ["Petrified"] }, 9, "fire", "power"), { amount: 4, note: "resisted" });
  assert.deepEqual(E.defended({ conditions: ["Petrified"] }, 9, "poison", "power"), { amount: 0, note: "immune" });
  // exhaustion from the sheet: level 2 slows 15 ft, level 3 adds disadvantage on attacks, level 5 stops movement
  assert.equal(E.budget(world([ava({ exhaustion: 2 })], "ava")).moveLeft, 15);
  assert.equal(E.preview(world([ava({ exhaustion: 3 }), r1()], "ava"), "ava", "r1", blade).mode, "dis");
  assert.equal(E.budget(world([ava({ exhaustion: 5 })], "ava")).moveLeft, 0);
  // a ranged attack next to an incapacitated or blinded enemy is not at disadvantage for it
  assert.equal(E.preview(world([ava(), r1({ x: 1, conditions: ["Stunned"] }), unit({ id: "t", name: "T", side: "npc", x: 8, y: 0 })], "ava"), "ava", "t", rifle).mode, "normal");
  // charmed by someone: can't attack them
  const w = Object.assign(world([ava({ conditions: ["Charmed"] }), r1()], "ava"), { effects: [{ unit: "ava", condition: "Charmed", source: "r1" }] });
  assert.match(E.preview(w, "ava", "r1", blade).why, /charmed by Raider/);
});

test("SW5e: weakened halves healing", () => {
  const ch = consular();
  const ab = E.abilitiesOf(ch, R, { "mind shove": { use: "action", range: [30, 30], heal: { dice: "2d4" } } })[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const pal = unit({ id: "pal", name: "Pal", side: "pc", x: 1, y: 0, hp: 5, maxHp: 20, conditions: ["Weakened"] });
  const r = E.apply(world([me, pal], "cass"), { type: "use", unit: "cass", ability: ab, target: "pal" }, dice({ total: 7 }).roll);
  assert.equal(r.world.units.pal.hp, 8, "7 healing, halved to 3");
});

test("the DM's defaults: Slowed and Corroded by level, a bare one a label; slowing from exhaustion adds up", () => {
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }, o));
  const r1 = (o) => unit(Object.assign({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0 }, o));
  const slowed = (lv, o) => world([ava(Object.assign({ conditions: ["Slowed"] }, o))], "ava", { effects: lv ? [{ unit: "ava", condition: "Slowed", ends: "never", level: lv }] : [] });
  assert.deepEqual([1, 2, 3, 4].map((lv) => E.budget(slowed(lv)).speed), [15, 5, 0, 0], "−15, −25, −30 ft, then 0");
  assert.equal(E.budget(slowed(0)).speed, 30, "a bare Slowed set by hand is a label");
  assert.equal(E.budget(slowed(1, { exhaustion: 2 })).speed, 5, "exhaustion's slowed level and Slowed 1 make level 2");
  // the DM's form: levels add up to the top level; taking it off clears it
  let r = E.setCondition(world([ava(), r1()], "ava"), { unit: "ava", condition: "Slowed", level: 3 });
  r = E.setCondition(r.world, { unit: "ava", condition: "Slowed", level: 2 });
  assert.deepEqual([E.levelOf(r.world, r.world.units.ava, "Slowed"), E.budget(r.world).speed, r.log[0].text], [4, 0, "Avery is slowed (level 4)."]);
  r = E.setCondition(r.world, { unit: "ava", condition: "Slowed", op: "remove" });
  assert.deepEqual([r.world.units.ava.conditions, r.world.effects, E.budget(r.world).speed], [[], [], 30]);
  // corroded: one more damage from weapons for each level, none from powers
  r = E.setCondition(world([ava(), r1()], "ava"), { unit: "r1", condition: "Corroded", level: 2 });
  const hit = E.apply(r.world, { type: "attack", unit: "ava", target: "r1", attack: blade }, dice({ total: 18, nat: 13 }, { total: 6 }).roll);
  assert.equal(hit.world.units.r1.hp, 12, "6 + 2");
  assert.match(hit.log[1].text, /takes 8 kinetic damage \(2 more from corrosion\)/);
  assert.equal(E.setCondition(world([ava({ condImmune: ["Corroded"] })], "ava"), { unit: "ava", condition: "Corroded", level: 1 }).ok, false, "immune");
});

test("the DM's defaults: Ignited burns at the end of its own turn until someone puts it out", () => {
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }, o));
  const pal = (o) => unit(Object.assign({ id: "pal", name: "Pal", side: "pc", x: 1, y: 0 }, o));
  let r = E.setCondition(world([ava(), pal()], "ava"), { unit: "ava", condition: "Ignited", amount: "1d6" });
  assert.equal(r.log[0].text, "Avery is ignited (1d6 fire damage at the end of each of its turns).");
  assert.equal(E.setCondition(world([ava()], "ava"), { unit: "ava", condition: "Ignited", amount: "lots" }).ok, false);
  const d = dice({ total: 4 });
  let t = E.turnPassed(r.world, "pal", "ava", d.roll);
  assert.deepEqual([t.world.units.ava.hp, d.asked], [20, []], "not at the end of someone else's turn");
  t = E.turnPassed(r.world, "ava", "pal", d.roll);
  assert.deepEqual([t.world.units.ava.hp, d.asked, t.log[0].text], [16, ["1d6"], "Avery burns for 4 fire damage."]);
  const res = E.turnPassed(Object.assign({}, r.world, { units: Object.assign({}, r.world.units, { ava: Object.assign({}, r.world.units.ava, { resist: [{ type: "fire", only: null }] }) }) }), "ava", "pal", dice({ total: 5 }).roll);
  assert.equal(res.world.units.ava.hp, 18, "resistance to fire halves it");
  // Pal, next to Avery, puts the flames out with its action; from 10 ft it can't
  r.world.turnId = "pal";
  assert.equal(E.apply(Object.assign({}, r.world, { units: Object.assign({}, r.world.units, { pal: pal({ x: 2 }) }) }), { type: "douse", unit: "pal", target: "ava" }, dice().roll).ok, false);
  const out = E.apply(r.world, { type: "douse", unit: "pal", target: "ava" }, dice().roll);
  assert.deepEqual([out.world.units.ava.conditions, out.world.effects, E.budget(out.world).action, out.log[0].text], [[], [], false, "Pal puts out the flames on Avery."]);
});

test("the DM's defaults: a grapple or a charm with a recorded cause ends properly; without one it stays", () => {
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }, o));
  const r1 = (o) => unit(Object.assign({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0 }, o));
  let r = E.setCondition(world([ava(), r1()], "r1"), { unit: "ava", condition: "Grappled", source: "r1" });
  assert.equal(r.log[0].text, "Avery is grappled by Raider.");
  // the grappler walks away: it ends
  let m = E.apply(r.world, { type: "move", unit: "r1", x: 3, y: 0 }, dice().roll);
  assert.deepEqual([m.world.units.ava.conditions, m.log.map((l) => l.text)], [[], ["Raider moves 10 ft.", "Avery is no longer grappled."]]);
  // the grappler is stunned: it ends
  const s = E.setCondition(r.world, { unit: "r1", condition: "Stunned" });
  assert.deepEqual([s.world.units.ava.conditions, s.log[1].text], [[], "Avery is no longer grappled."]);
  // no cause recorded: the grapple stays when the Raider leaves
  r = E.setCondition(world([ava(), r1()], "r1"), { unit: "ava", condition: "Grappled" });
  m = E.apply(r.world, { type: "move", unit: "r1", x: 3, y: 0 }, dice().roll);
  assert.deepEqual(m.world.units.ava.conditions, ["Grappled"]);
  // a grappler the world can't see (hidden from a player) leaves the grapple alone
  const hidden = Object.assign({}, world([ava()], "ava"), { effects: [{ unit: "ava", condition: "Grappled", ends: "never", source: "lurk" }] });
  hidden.units.ava.conditions = ["Grappled"];
  assert.deepEqual(E.apply(hidden, { type: "end", unit: "ava" }, dice().roll).world.units.ava.conditions, ["Grappled"]);
  // charmed with a cause: no attack and no harmful power at the charmer
  const c = E.setCondition(world([ava(), r1()], "ava"), { unit: "ava", condition: "Charmed", source: "r1" });
  assert.equal(E.apply(c.world, { type: "attack", unit: "ava", target: "r1", attack: blade }, dice().roll).ok, false);
});

test("the DM's defaults: weakened counts half a positive modifier on attacks and saves; exhaustion 4 caps healing at half", () => {
  const ch = { classes: [{ name: "Fighter", level: 1 }], abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, attacks: [{ name: "Vibrosword", ab: "str", damage: "1d8", type: "kinetic", props: "" }] };
  const [sword] = E.attacksOf(ch, R);
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0, conditions: ["Weakened"], mods: { str: 3, dex: 2, con: 1, int: 0, wis: 0, cha: -1 } });
  const r1 = unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, ac: 12 });
  const pv = E.preview(world([ava, r1], "ava"), "ava", "r1", sword);
  assert.deepEqual([sword.abil, pv.weak, pv.bonus, pv.expr], ["str", 2, 3, "1d20+3"], "Str +3 counts as +1");
  const atk = E.apply(world([ava, r1], "ava"), { type: "attack", unit: "ava", target: "r1", attack: sword }, dice({ total: 9, nat: 6 }).roll);
  assert.match(atk.log[0].text, /\(weakened, −2\)/);
  assert.equal(E.weakPenalty(ava, "dex"), 1); assert.equal(E.weakPenalty(ava, "cha"), 0, "a negative modifier stays as it is");
  // a save while weakened (a power's save, against Avery)
  const cass = consular();
  const ab = E.abilitiesOf(cass, R, { "mind shove": { use: "action", range: [30, 30], save: { ability: "dex", dc: 13 } } })[0];
  const me = unit({ id: "cass", name: "Cass", side: "npc", x: 2, y: 0, pools: Object.fromEntries(E.resourcesOf(cass, R).map((x) => [x.key, x])) });
  const d = dice({ total: 12, nat: 10 });
  E.apply(world([me, Object.assign({}, ava, { saves: { dex: 2 } })], "cass"), { type: "use", unit: "cass", ability: ab, target: "ava" }, d.roll);
  assert.deepEqual(d.asked, ["1d20+1"], "Dex save +2 counts as +1");
  // exhaustion 4: healing stops at half the maximum
  const h = E.abilitiesOf(cass, R, { "mind shove": { use: "action", range: [30, 30], heal: { dice: "2d4" } } })[0];
  const tired = unit({ id: "pal", name: "Pal", side: "pc", x: 1, y: 0, hp: 6, maxHp: 20, exhaustion: 4 });
  const healed = E.apply(world([unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: me.pools }), tired], "cass"), { type: "use", unit: "cass", ability: h, target: "pal" }, dice({ total: 8 }).roll);
  assert.equal(healed.world.units.pal.hp, 10, "6 + 8 would be 14; the maximum is halved to 10");
});

test("step 6: moving through an enemy two sizes larger or smaller; the path a move takes", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  // a wall of three enemies in the next column: Large ones (one size up) block it, Huge ones (two up) can be passed
  // through, each step into one costing 5 ft more
  const wall = (sizeCat) => [-1, 0, 1].map((y) => unit({ id: "big" + (y + 1), name: "Big", side: "npc", x: 1, y, sizeCat }));
  assert.equal(E.reachable(world([ava, ...wall(3)], "ava"), "ava", 15)["2,0"], undefined, "Large: no way through with 15 ft");
  assert.equal(E.reachable(world([ava, ...wall(4)], "ava"), "ava", 15)["2,0"], 15, "Huge: straight through it (10 + 5)");
  assert.equal(E.reachable(world([ava, ...wall(4)], "ava"), "ava", 30)["1,0"], undefined, "but not stopping in it");
  assert.equal(E.sizeCat({ size: 3 }), 4, "a 3×3 token with no stat block is Huge");
  assert.deepEqual(E.pathTo(world([ava], "ava"), "ava", 30, 3, 0), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
});

test("step 6: Dash, Disengage and Dodge", () => {
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }, o));
  const r1 = (o) => unit(Object.assign({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0 }, o));
  let r = E.apply(world([ava(), r1({ x: 9 })], "ava"), { type: "common", unit: "ava", key: "dash" }, dice().roll);
  assert.deepEqual([E.budget(r.world).total, E.budget(r.world).moveLeft, E.budget(r.world).action, r.log[0].text], [60, 60, false, "Avery takes the Dash action."]);
  assert.equal(E.apply(r.world, { type: "common", unit: "ava", key: "dodge" }, dice().roll).ok, false, "one action a turn");
  // Disengage: walking away from the Raider provokes nothing
  r = E.apply(world([ava(), r1()], "ava"), { type: "common", unit: "ava", key: "disengage" }, dice().roll);
  assert.deepEqual(E.apply(r.world, { type: "move", unit: "ava", x: 0, y: 3 }, dice().roll).reactions, []);
  // Dodge: attacks against Avery at disadvantage until its next turn, Dex saves at advantage; not while stunned
  r = E.apply(world([ava(), r1()], "ava"), { type: "common", unit: "ava", key: "dodge" }, dice().roll);
  const later = Object.assign({}, r.world, { turnId: "r1" });
  assert.deepEqual([E.preview(later, "r1", "ava", blade).mode, E.preview(later, "r1", "ava", blade).tilts[0].text], ["dis", "Avery is dodging"]);
  const stunned = JSON.parse(JSON.stringify(later)); stunned.units.ava.conditions = ["Stunned"];
  assert.equal(E.preview(stunned, "r1", "ava", blade).mode, "adv", "stunned: no dodging, and attacks have advantage");
  const cass = consular();
  const ab = E.abilitiesOf(cass, R, { "mind shove": { use: "action", range: [30, 30], save: { ability: "dex", dc: 13 } } })[0];
  const caster = unit({ id: "cass", name: "Cass", side: "npc", x: 2, y: 0, pools: Object.fromEntries(E.resourcesOf(cass, R).map((x) => [x.key, x])) });
  const d = dice({ total: 15, nat: 15 });
  const w2 = Object.assign({}, later, { turnId: "cass", units: Object.assign({}, later.units, { cass: caster }) });
  E.apply(w2, { type: "use", unit: "cass", ability: ab, target: "ava" }, d.roll);
  assert.deepEqual(d.asked, ["2d20kh1+0"], "a Dex save with advantage");
});

test("step 6: opportunity attacks: who may react, where, and what the reaction does", () => {
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }, o));
  const r1 = (o) => unit(Object.assign({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, reach: 5 }, o));
  let m = E.apply(world([ava(), r1()], "ava"), { type: "move", unit: "ava", x: 0, y: 3 }, dice().roll);
  assert.deepEqual(m.reactions, [{ reactor: "r1", against: "ava", kind: "opportunity", at: { x: 0, y: 1 } }], "the last square still within 5 ft");
  assert.deepEqual(E.apply(world([ava(), r1()], "ava"), { type: "move", unit: "ava", x: 1, y: 1 }, dice().roll).reactions, [], "staying in reach");
  assert.deepEqual(E.apply(world([ava(), r1({ reach: 10 })], "ava"), { type: "move", unit: "ava", x: 0, y: 2 }, dice().roll).reactions, [], "a 10 ft reach still covers it");
  assert.deepEqual(E.apply(world([ava(), r1({ conditions: ["Blinded"] })], "ava"), { type: "move", unit: "ava", x: 0, y: 3 }, dice().roll).reactions, [], "it can't see Avery go");
  assert.deepEqual(E.apply(world([ava({ conditions: ["Invisible"] }), r1()], "ava"), { type: "move", unit: "ava", x: 0, y: 3 }, dice().roll).reactions, []);
  const spentR = world([ava(), r1()], "ava", { spent: { r1: { key: "", move: 0, action: 0, bonus: 0, reaction: 1 } } });
  assert.deepEqual(E.apply(spentR, { type: "move", unit: "ava", x: 0, y: 3 }, dice().roll).reactions, [], "its reaction is already spent");
  // the Raider takes it: rolled where Avery left its reach; Avery carries on to where it went
  const hit = E.react(m.world, { reactor: "r1", against: "ava", at: { x: 0, y: 1 }, attack: blade }, dice({ total: 18, nat: 13 }, { total: 6 }).roll);
  assert.ok(hit.ok, hit.why);
  assert.deepEqual([hit.world.units.ava.hp, hit.world.units.ava.y, E.budget(hit.world, "r1").reaction], [14, 3, false]);
  assert.match(hit.log[0].text, /^Raider makes an opportunity attack against Avery with Vibroblade: 18 against AC 13, a hit\./);
  assert.equal(E.react(hit.world, { reactor: "r1", against: "ava", at: { x: 0, y: 1 }, attack: blade }, dice().roll).ok, false, "one reaction until its next turn");
  // a hit that drops Avery ends its movement where it was struck
  const drop = E.react(m.world, { reactor: "r1", against: "ava", at: { x: 0, y: 1 }, attack: blade }, dice({ total: 18, nat: 13 }, { total: 25 }).roll);
  assert.deepEqual([drop.world.units.ava.hp, drop.world.units.ava.y], [0, 1]);
  assert.equal(E.react(m.world, { reactor: "r1", against: "ava", at: { x: 0, y: 1 }, attack: rifle }, dice().roll).ok, false, "a ranged weapon can't");
});

test("review #89: diagonals split over several moves cost what one move would (5, 10, 5, 10)", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  let w = world([ava, unit({ id: "r1", name: "Raider", side: "npc", x: 9, y: 9 })], "ava");
  const costs = [];
  for (let i = 1; i <= 4; i++) {
    const r = E.apply(w, { type: "move", unit: "ava", x: i, y: i }, dice().roll);
    assert.ok(r.ok, r.why);
    costs.push(r.events[0].feet); w = r.world;
  }
  assert.deepEqual(costs, [5, 10, 5, 10]);
  assert.equal(E.apply(w, { type: "move", unit: "ava", x: 5, y: 5 }, dice().roll).ok, false, "30 ft used: no fifth diagonal");
  assert.equal(E.reachable(world([ava], "ava"), "ava", 30)["4,4"], 30, "the same as one long move");
  // a straight step in between keeps the count: diagonal 5, straight 5, diagonal 10
  w = world([ava], "ava");
  w = E.apply(w, { type: "move", unit: "ava", x: 1, y: 1 }, dice().roll).world;
  w = E.apply(w, { type: "move", unit: "ava", x: 2, y: 1 }, dice().roll).world;
  assert.equal(E.apply(w, { type: "move", unit: "ava", x: 3, y: 2 }, dice().roll).events[0].feet, 10);
});

test("review #89: an at-will power's upcast is capped at the caster's highest level; a power's attack needs an AC", () => {
  const ch = consular();
  const lib = { "mind shove": { use: "action", range: [30, 30], attack: { bonus: "power" }, damage: [{ dice: "1d6", type: "force" }], upcast: { damage: "1d6" } } };
  const ab = Object.assign(E.abilitiesOf(ch, R, lib)[0], { level: 0, cost: {} });   // as an at-will power
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const w = world([me, unit({ id: "r1", name: "Raider", side: "npc", x: 2, y: 0 })], "cass");
  const top = ab.maxLevel;
  assert.match(E.apply(w, { type: "use", unit: "cass", ability: ab, target: "r1", upcast: top + 1 }, dice().roll).why, /up to level/);
  assert.ok(E.apply(w, { type: "use", unit: "cass", ability: ab, target: "r1", upcast: top }, dice({ total: 15, nat: 12 }, { total: 9 }).roll).ok);
  const noAc = world([me, unit({ id: "r1", name: "Raider", side: "npc", x: 2, y: 0, ac: null })], "cass");
  assert.equal(E.apply(noAc, { type: "use", unit: "cass", ability: ab, target: "r1" }, dice().roll).why, "Raider has no AC set.");
});

test("review #89: a power's attack roll tilts for the same reasons the preview shows", () => {
  const ch = consular();
  const ab = E.abilitiesOf(ch, R, { "mind shove": { use: "action", range: [30, 60], attack: { bonus: "power" }, damage: [{ dice: "1d6", type: "force" }] } })[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const w = world([me, unit({ id: "r1", name: "Raider", side: "npc", x: 3, y: 0, conditions: ["Restrained"] })], "cass");
  const pv = E.preview(w, "cass", "r1", { name: ab.name, bonus: ab.attack.bonus, abil: ab.attack.abil, damage: "x", melee: 0, range: ab.range });
  const d = dice({ total: 15, nat: 12 }, { total: 3 });
  const r = E.apply(w, { type: "use", unit: "cass", ability: ab, target: "r1" }, d.roll);
  assert.deepEqual([pv.mode, d.asked[0]], ["adv", pv.expr], "the preview's roll is the server's roll");
  assert.match(r.log[1].text, /\(advantage: Raider is restrained\)/);
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
  assert.equal((await sam.state()).fight, undefined, "switched off: no combat view in anyone's state");
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
  // 1d6+2: even a critical hit (2d6+2) can't take Avery's 20 hit points, so no "falls unconscious" line follows (a crit
  // with 2d6+2 doubled could, and that made this test fail about once in 400 runs)
  assert.equal((await gm.act("fight.attack", { target: ids.avery, attack: { name: "Blaster", bonus: 30, damage: "1d6+2", type: "energy", range: [60, 240] } })).code, 200);
  st = await gm.state();
  const hp = st.characters[avery].hp.current;
  const dmg = st.chat.filter((m) => m.fight && m.roll && m.roll.kind === "damage").at(-1);   // none on a natural 1
  assert.equal(hp, dmg ? 20 - dmg.roll.total : 20);
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
  await gm.act("fight.toggle", { on: true });
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

test("areas through the API: a blast catches a hidden creature without telling the player", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  let st = await sam.state();
  const av = Object.values(st.characters).find((c) => c.name === "Avery");
  await sam.act("char.save", { char: Object.assign({}, av, { classes: [{ name: "Consular", level: 5 }], abilities: Object.assign({}, av.abilities, { wis: 16 }),
    powers: [{ name: "Blast Wave", level: 1, type: "force", alignment: "universal" }] }) });
  await gm.act("fight.ability", { name: "Blast Wave", data: { use: "action", range: [60, 60], area: { shape: "sphere", size: 10, from: "point" }, save: { ability: "dex", dc: 30, onSave: "none" }, damage: [{ dice: "1d4+10" }] } });
  // the hidden Lurker stands at (1,1), right next to Avery at (0,0); aim the blast at the corner between them
  const r = await sam.act("fight.use", { ability: "pw:blast wave", point: { x: 1, y: 1 } });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  const gv = await gm.state(), pv = await sam.state();
  const lurker = gv.initiative.entries.find((e) => e.id === ids.lurker);
  assert.ok(lurker.hp < 10, "the hidden creature was caught and took the damage");
  assert.ok(gv.chat.some((m) => m.fight && m.private && /Lurker/.test(m.roll.label)), "the GM sees its save");
  assert.ok(!JSON.stringify(pv).includes("Lurker") && !JSON.stringify(pv).includes(ids.lurker), "the player learns nothing of it");
});

test("conditions through the API: a power restrains, the tracker shows it, the turn change ends it, undo brings it back", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  let st = await sam.state();
  const av = Object.values(st.characters).find((c) => c.name === "Avery");
  await sam.act("char.save", { char: Object.assign({}, av, { classes: [{ name: "Consular", level: 3 }], abilities: Object.assign({}, av.abilities, { wis: 16 }),
    powers: [{ name: "Hold", level: 1, type: "force", alignment: "universal" }] }) });
  await gm.act("fight.ability", { name: "Hold", data: { use: "action", range: [60, 60], save: { ability: "wis", dc: 40 }, applies: [{ condition: "Restrained", until: { ends: "end", of: "target", rounds: 1 } }], concentration: true } });
  assert.equal((await sam.act("fight.use", { ability: "pw:hold", target: ids.raider })).code, 200);
  st = await sam.state();
  assert.deepEqual(st.initiative.entries.find((e) => e.id === ids.raider).conditions, ["Restrained"], "the tracker shows it");
  assert.equal(st.fight.conc[ids.avery], "Hold");
  assert.equal(st.fight.effects[0].condition, "Restrained");
  // End turn: the Raider's turn begins; its turn ends: the effect goes (at the next combat step after it)
  await sam.act("fight.end", {});
  assert.deepEqual((await sam.state()).initiative.entries.find((e) => e.id === ids.raider).conditions, ["Restrained"]);
  await gm.act("fight.end", {});
  st = await sam.state();
  assert.deepEqual(st.initiative.entries.find((e) => e.id === ids.raider).conditions, [], "gone at the end of the Raider's turn");
  assert.ok(st.chat.some((m) => m.system && /Raider is no longer restrained/.test(m.text)));
  // undo the Raider's End turn: restrained again
  await gm.act("fight.undo", {});
  assert.deepEqual((await gm.state()).initiative.entries.find((e) => e.id === ids.raider).conditions, ["Restrained"]);
});

test("concentration: dropping to 0 hit points ends it without a save", () => {
  const ch = consular();
  const ab = E.abilitiesOf(ch, R, { "mind shove": { use: "action", range: [60, 60], save: { ability: "wis", dc: 14 }, applies: [{ condition: "Restrained" }], concentration: true } })[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, hp: 10, maxHp: 10, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const r = E.apply(world([me, unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, saves: { wis: 0 } })], "cass"), { type: "use", unit: "cass", ability: ab, target: "r1" }, dice({ total: 2, nat: 2 }).roll);
  const d = dice({ total: 25, nat: 16 }, { total: 12 });
  const hit = E.apply(Object.assign({}, r.world, { turnId: "r1" }), { type: "attack", unit: "r1", target: "cass", attack: blade }, d.roll);
  assert.equal(d.asked.length, 2, "no concentration save is rolled");
  assert.deepEqual([hit.world.conc.cass, hit.world.units.r1.conditions], [undefined, []]);
  assert.match(hit.log.at(-1).text, /Cass drops: Mind Shove ends/);
});

test("defences through the API: a creature's from its stat block (GM), a character's from its owner", async () => {
  const { gm, sam, rae, ids, avery } = await fight();
  await gm.act("fight.toggle", { on: true });
  assert.equal((await gm.act("fight.npc", { id: ids.raider, speed: 30, resist: ["Kinetic from unenhanced weapons"], immune: ["Poison"], condImmune: ["Poisoned"] })).code, 200);
  const gv = await gm.state();
  assert.deepEqual(gv.fight.npcDefenses[ids.raider].resist, [{ type: "kinetic", only: "unenhanced" }]);
  assert.deepEqual((await sam.state()).fight.npcDefenses, {}, "a creature's defences are the GM's");
  // Avery's vibrosword is an unenhanced kinetic weapon: against the Raider (AC 2) the damage is halved
  await sam.act("fight.move", { x: 5, y: 0 });
  await sam.act("fight.attack", { attack: 0, target: ids.raider });
  const dmg = (await gm.state()).chat.filter((m) => m.fight && m.roll && m.roll.kind === "damage").at(-1);
  if (dmg) assert.match(dmg.roll.label, /\(resisted\)/);
  // a character's own defences
  assert.equal((await rae.act("fight.defenses", { charId: avery, resist: ["fire"] })).code, 403);
  assert.equal((await sam.act("fight.defenses", { charId: avery, resist: ["fire", "plasma"], vuln: ["ion"] })).code, 200);
  assert.deepEqual((await rae.state()).fight.defenses[avery], { resist: [{ type: "fire", only: null }], immune: [], vuln: [{ type: "ion", only: null }], condImmune: [], senses: [] });
});

test("standing up through the API: a prone character stands for half its speed", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  await gm.act("init.update", { id: ids.avery, fields: { conditions: ["Prone"] } });
  assert.equal((await sam.act("fight.stand", {})).code, 200);
  const st = await sam.state();
  assert.deepEqual([st.initiative.entries.find((e) => e.id === ids.avery).conditions, st.fight.budget.moveLeft], [[], 15]);
  assert.equal((await sam.act("fight.stand", {})).code, 400, "not prone any more");
});

test("the tracker's Prev never ends an effect: only moving forward does", async () => {
  const { gm, sam, rae, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  let st = await sam.state();
  const av = Object.values(st.characters).find((c) => c.name === "Avery");
  await sam.act("char.save", { char: Object.assign({}, av, { classes: [{ name: "Consular", level: 3 }], abilities: Object.assign({}, av.abilities, { wis: 16 }),
    powers: [{ name: "Hold", level: 1, type: "force", alignment: "universal" }] }) });
  await gm.act("fight.ability", { name: "Hold", data: { use: "action", range: [60, 60], save: { ability: "wis", dc: 40 }, applies: [{ condition: "Restrained", until: { ends: "start", of: "self", rounds: 1 } }] } });
  assert.equal((await sam.act("fight.use", { ability: "pw:hold", target: ids.raider })).code, 200);
  await sam.act("fight.end", {});                        // the Raider's turn
  await gm.act("init.prev", {});                         // back to Avery's turn, going backwards
  assert.equal((await sam.act("fight.end", {})).code, 200, "Avery's turn action sees the step back first");
  st = await gm.state();
  assert.deepEqual(st.initiative.entries.find((e) => e.id === ids.raider).conditions, ["Restrained"], "still restrained after Prev");
  await gm.act("fight.end", {}); await rae.act("fight.end", {}); await gm.act("fight.end", {});   // Raider, Bolt, Lurker
  st = await gm.state();
  assert.deepEqual([st.initiative.round, st.initiative.entries[st.initiative.turn].name], [2, "Avery"]);
  assert.deepEqual(st.initiative.entries.find((e) => e.id === ids.raider).conditions, [], "ends at the start of Avery's next turn");
});

test("the proposed tracker hook (issue #72): with it, the tracker's Next ends an effect straight away", async () => {
  const Game = require("../api/_holotable-game.js"), Fight = require("../api/_holotable-fight.js");
  const orig = Game.applyAction;
  // the one line proposed for init.next / init.prev in _holotable-game.js, simulated around the handler's call
  Game.applyAction = (camp, pid, gm, type, p) => { const out = orig(camp, pid, gm, type, p);
    if (type === "init.next" || type === "init.prev") Fight.turned(camp, pid, Game); return out; };
  try {
    const { gm, sam, ids } = await fight();
    await gm.act("fight.toggle", { on: true });
    let st = await sam.state();
    const av = Object.values(st.characters).find((c) => c.name === "Avery");
    await sam.act("char.save", { char: Object.assign({}, av, { classes: [{ name: "Consular", level: 3 }], abilities: Object.assign({}, av.abilities, { wis: 16 }),
      powers: [{ name: "Hold", level: 1, type: "force", alignment: "universal" }] }) });
    await gm.act("fight.ability", { name: "Hold", data: { use: "action", range: [60, 60], save: { ability: "wis", dc: 40 }, applies: [{ condition: "Restrained", until: { ends: "end", of: "target", rounds: 1 } }] } });
    assert.equal((await sam.act("fight.use", { ability: "pw:hold", target: ids.raider })).code, 200);
    await gm.act("init.next", {});                       // the Raider's turn, from the tracker
    await gm.act("init.prev", {}); await gm.act("init.next", {});   // a slip back and forth ends nothing
    assert.deepEqual((await gm.state()).initiative.entries.find((e) => e.id === ids.raider).conditions, ["Restrained"]);
    await gm.act("init.next", {});                       // the Raider's turn ends: gone now, with no combat step
    st = await sam.state();
    assert.deepEqual(st.initiative.entries.find((e) => e.id === ids.raider).conditions, []);
    assert.ok(st.chat.some((m) => m.system && /Raider is no longer restrained/.test(m.text)));
    await gm.act("fight.toggle", { on: false });
    await gm.act("init.update", { id: ids.raider, fields: { conditions: ["Prone"] } });
    await gm.act("init.next", {});                       // view off: the hook does nothing
    assert.deepEqual((await gm.state()).initiative.entries.find((e) => e.id === ids.raider).conditions, ["Prone"]);
  } finally { Game.applyAction = orig; }
});

test("the DM's condition form through the API: GM only, levels, undo, and a hidden cause stays hidden", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  assert.equal((await sam.act("fight.condition", { unit: ids.avery, condition: "Slowed", level: 2 })).code, 403, "players can't");
  assert.equal((await gm.act("fight.condition", { unit: ids.avery, condition: "Sleepy" })).code, 400, "not a condition");
  assert.equal((await gm.act("fight.condition", { unit: ids.avery, condition: "Slowed", level: 2 })).code, 200);
  let st = await sam.state();
  assert.deepEqual([st.initiative.entries.find((e) => e.id === ids.avery).conditions, st.fight.budget.speed], [["Slowed"], 5]);
  assert.deepEqual(st.fight.effects.map((e) => [e.condition, e.level, e.ends]), [["Slowed", 2, "never"]]);
  assert.ok(st.chat.some((m) => m.system && m.text === "Avery is slowed (level 2)."));
  await gm.act("fight.undo", {});
  st = await sam.state();
  assert.deepEqual([st.initiative.entries.find((e) => e.id === ids.avery).conditions, st.fight.budget.speed], [[], 30]);
  // grappled by the hidden Lurker: the GM sees who; the player sees a grapple with no cause and no line naming it
  assert.equal((await gm.act("fight.condition", { unit: ids.avery, condition: "Grappled", source: ids.lurker })).code, 200);
  st = await sam.state();
  assert.deepEqual(st.fight.effects.map((e) => [e.condition, e.source]), [["Grappled", null]]);
  assert.ok(!JSON.stringify(st).includes("Lurker"), "the hidden creature is never named");
  assert.ok((await gm.state()).chat.some((m) => m.text === "Avery is grappled by Lurker."));
  // Avery's own turn: the grapple stays (its cause is out of the player's sight, not gone); speed 0
  assert.equal((await sam.state()).fight.budget.speed, 0);
  assert.equal((await sam.act("fight.end", {})).code, 200);
  assert.deepEqual((await gm.state()).initiative.entries.find((e) => e.id === ids.avery).conditions, ["Grappled"]);
  // the GM takes it off
  assert.equal((await gm.act("fight.condition", { unit: ids.avery, condition: "Grappled", op: "remove" })).code, 200);
  assert.deepEqual((await gm.state()).initiative.entries.find((e) => e.id === ids.avery).conditions, []);
});

test("putting out the flames through the API: Avery, on fire, uses the action on itself", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  await gm.act("fight.condition", { unit: ids.avery, condition: "Ignited", amount: "1d4" });
  assert.equal((await sam.act("fight.douse", { target: ids.avery })).code, 200);
  const st = await sam.state();
  assert.deepEqual([st.initiative.entries.find((e) => e.id === ids.avery).conditions, st.fight.budget.action], [[], false]);
  assert.ok(st.chat.some((m) => m.system && m.text === "Avery puts out the flames."));
  assert.equal((await sam.act("fight.douse", { target: ids.avery })).code, 400, "nothing burning now");
});

/* ---------------------------------------------------------------- off by default: nothing differs until the GM switches it on */
// The keys every state had before the combat view existed (main at 9db7fbb: viewFor's, then the poll's sw5eBooks).
const VIEW_KEYS = ["name", "you", "isGM", "updated", "players", "online", "characters", "chat", "initiative", "map", "notes", "handouts", "levelUps",
  "variants", "hpMax", "audio", "ships", "sceneFx", "scene", "scenes", "sw5eBooks"];
const FIGHT_ACTIONS = ["fight.move", "fight.attack", "fight.end", "fight.use", "fight.stand", "fight.douse", "fight.condition", "fight.npc", "fight.link",
  "fight.hp", "fight.undo", "fight.ability", "fight.defenses", "fight.spend", "fight.resource"];

test("off by default: a whole session with the combat view never switched on leaves no trace", async () => {
  const { gm, sam, rae, ids, avery } = await fight();
  let st = await sam.state();
  // ordinary play: moving a token, the tracker, hit points and conditions, the turn going round, chat, a sheet save
  await sam.act("token.move", { id: tokenOf(st, "Avery").id, x: 3, y: 2 });
  await gm.act("init.update", { id: ids.raider, fields: { hp: 25, conditions: ["Prone"] } });
  await gm.act("init.next", {}); await gm.act("init.next", {});
  await sam.act("chat", { text: "hello table" });
  await sam.act("char.save", { char: Object.assign({}, st.characters[avery], { hp: { max: 20, current: 14, temp: 0 } }) });
  // every view has exactly the keys it had before the combat view existed
  for (const b of [gm, sam, rae]) assert.deepEqual(Object.keys(await b.state()), VIEW_KEYS);
  // every combat action but the GM's switch is refused, for the GM and players alike, and writes nothing
  for (const type of FIGHT_ACTIONS) for (const b of [gm, sam]) {
    const r = await b.act(type, {});
    assert.deepEqual([r.code, r.data.error], [400, "The combat view is off."], type);
  }
  assert.equal((await sam.act("fight.toggle", { on: true })).code, 403, "only the GM switches it on");
  assert.equal((await gm.act("fight.toggle", { on: false })).code, 200, "switching off what was never on");
  // the saved game: no combat record, no new field on any sheet, no combat lines in chat
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  assert.equal("fight" in file, false);
  assert.ok(Object.values(file.characters).every((c) => !("resources" in c)));
  assert.ok(!file.chat.some((m) => m.fight), "no combat lines");
  for (const b of [gm, sam, rae]) assert.deepEqual(Object.keys(await b.state()), VIEW_KEYS);
});

test("backup and restore: the combat view's record comes back checked; a backup without one restores without one", async () => {
  const { gm, sam, ids, avery } = await fight();
  const post = (op, body) => gm.call("POST", { op }, body);
  await gm.act("fight.toggle", { on: true });
  await gm.act("fight.ability", { name: "Mind Shove", data: SHOVE });
  await gm.act("fight.npc", { id: ids.raider, speed: 40 });
  await sam.act("fight.defenses", { charId: avery, resist: ["fire"] });
  await sam.act("fight.resource", { charId: avery, res: { key: "secondwind", name: "Second Wind", max: 1, used: 0, refill: "short" } });
  assert.equal((await sam.act("fight.move", { x: 2, y: 0 })).code, 200);    // an undo step and a floating number
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  assert.ok(file.fight.on && file.fight.undo.length && file.fight.events.length);
  // 1. the file comes back: what the GM taught the table, creature numbers, character defences and resources;
  //    not the undo stack or the floating numbers, which belonged to the table before the restore
  await gm.act("fight.ability", { name: "Mind Shove", data: null });
  assert.equal((await post("restore", { campaign: file })).code, 200);
  let st = await gm.state();
  assert.deepEqual([st.fight.on, !!st.fight.lib["mind shove"], st.fight.npcSpeed[ids.raider], st.fight.defenses[avery].resist[0].type, st.fight.undo.n, st.fight.events.length,
    st.characters[avery].resources[0].name], [true, true, 40, "fire", 0, 0, "Second Wind"]);
  assert.equal((await sam.state()).fight.on, true);
  // 2. a backup made before the combat view existed: no record, and none appears
  const plain = Object.assign({}, file);
  delete plain.fight;
  for (const c of Object.values(plain.characters)) delete c.resources;
  assert.equal((await post("restore", { campaign: plain })).code, 200);
  for (const b of [gm, sam]) assert.deepEqual(Object.keys(await b.state()), VIEW_KEYS);
  assert.equal("fight" in JSON.parse((await gm.call("GET", { op: "export" })).data), false);
  // 3. a hand-edited record is checked, not trusted: the table still loads for everyone
  const broken = Object.assign({}, file, { fight: { on: true, npc: { [ids.raider]: "fast", x: null }, effects: "lots", lib: 7, undo: [null, 3], spent: { a: 1 }, conc: [1] } });
  assert.equal((await post("restore", { campaign: broken })).code, 200);
  st = await gm.state();
  assert.deepEqual([st.fight.on, st.fight.effects, st.fight.lib, st.fight.undo.n], [true, [], {}, 0]);
  assert.equal((await sam.state()).fight.on, true);
});

test("names the GM hides (#87): every line the combat view writes for players says ???, and nothing else gives it away", async () => {
  const { gm, sam, rae, ids, avery } = await fight();
  await gm.act("fight.toggle", { on: true });
  let st = await gm.state();
  await gm.act("token.update", { id: tokenOf(st, "Raider").id, fields: { nameHidden: true } });
  await gm.act("token.update", { id: tokenOf(st, "Avery").id, fields: { nameHidden: true } });
  await sam.act("fight.defenses", { charId: avery, resist: ["fire"] });
  await sam.act("fight.resource", { charId: avery, res: { key: "stim", name: "Stim pack", max: 2, used: 0, refill: "long" } });
  // Avery (name hidden) walks up to the Raider (name hidden), attacks it, uses a stim pack; the GM knocks the Raider
  // prone and undoes it
  assert.equal((await sam.act("fight.move", { x: 5, y: 0 })).code, 200);
  assert.equal((await sam.act("fight.attack", { target: ids.raider, attack: "0" })).code, 200);
  assert.equal((await sam.act("fight.spend", { charId: avery, key: "stim" })).code, 200);
  assert.equal((await gm.act("fight.condition", { unit: ids.raider, condition: "Prone" })).code, 200);
  assert.equal((await gm.act("fight.undo", {})).code, 200);
  const pv = await rae.state();
  const since = pv.chat.findIndex((m) => m.text === "The GM switched the combat view on.");
  const lines = pv.chat.slice(since).filter((m) => !/^Round \d+ - /.test(m.text || ""));   // HoloTable's own turn lines aren't the combat view's
  const text = JSON.stringify(lines);
  assert.ok(lines.some((m) => m.roll && /^\?\?\? attacks \?\?\? with Vibrosword/.test(m.roll.label)), text);
  assert.ok(lines.some((m) => m.text === "??? uses Stim pack: 1 of 2 left."), text);
  assert.ok(lines.some((m) => m.text === "??? is prone."), text);
  assert.ok(!/Raider|Avery|Sam/.test(text), "no real name, and no player's name on a masked combatant's roll");
  // the combat view itself: Avery is just another creature to Rae; its defences aren't sent to her; Sam still knows
  assert.deepEqual([pv.fight.units[ids.avery].side, avery in pv.fight.defenses], ["npc", false]);
  const own = await sam.state();
  assert.deepEqual([own.fight.units[ids.avery].side, own.fight.units[ids.avery].mine, avery in own.fight.defenses], ["pc", true, true]);
  // the GM's own copy keeps the real names
  assert.equal((await gm.state()).fight.units[ids.avery].side, "pc");
});

test("step 6 through the API: an opportunity attack waits for its answer; only the reactor (or the GM) answers", async () => {
  const { gm, sam, rae, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  // Avery walks up to the Raider (leaving the hidden Lurker's reach: it never reacts, and is never named)
  assert.equal((await sam.act("fight.move", { x: 5, y: 0 })).code, 200);
  let st = await sam.state();
  assert.deepEqual(st.fight.pending, []);
  // then steps away from the Raider: the Raider may react; Avery's turn waits
  assert.equal((await sam.act("fight.move", { x: 4, y: 0 })).code, 200);
  st = await sam.state();
  assert.deepEqual(st.fight.pending.map((x) => [x.reactor, x.against, x.mine]), [[ids.raider, ids.avery, false]]);
  assert.ok(st.chat.some((m) => m.text === "Avery leaves Raider's reach: Raider can make an opportunity attack."));
  const wait = await sam.act("fight.end", {});
  assert.deepEqual([wait.code, /Waiting for Raider/.test(wait.data.error)], [400, true]);
  const id = st.fight.pending[0].id;
  assert.equal((await sam.act("fight.react", { id, take: true, attack: "0" })).code, 403, "not Sam's reaction");
  assert.equal((await gm.act("fight.react", { id, take: true, attack: { name: "Claw", bonus: 40, damage: "1d4", type: "kinetic", melee: 5, range: null } })).code, 200);
  st = await gm.state();
  const line = st.chat.filter((m) => m.fight && m.roll && m.roll.kind === "attack").pop();
  assert.match(line.roll.label, /^Raider makes an opportunity attack against Avery with Claw/);
  assert.deepEqual([st.fight.pending, tokenOf(st, "Avery").x], [[], 4], "answered; Avery stays where it went");
  // undo brings the question back
  await gm.act("fight.undo", {});
  assert.equal((await gm.state()).fight.pending.length, 1);
  await gm.act("fight.react", { id, take: false });
  assert.ok((await sam.state()).chat.some((m) => m.text === "Raider lets Avery go."));
  assert.equal((await sam.act("fight.end", {})).code, 200);
  // the Raider's turn: it steps next to Avery, then away; now Sam answers for Avery
  await gm.act("fight.move", { x: 5, y: 1 });
  await gm.act("fight.move", { x: 7, y: 1 });
  st = await sam.state();
  assert.deepEqual(st.fight.pending.map((x) => [x.reactor, x.mine]), [[ids.avery, true]]);
  assert.equal((await rae.act("fight.react", { id: st.fight.pending[0].id, take: false })).code, 403, "not Rae's");
  assert.equal((await sam.act("fight.react", { id: st.fight.pending[0].id, take: true, attack: "0" })).code, 200);
  st = await sam.state();
  assert.deepEqual([st.fight.pending, st.fight.spent[ids.avery].reaction], [[], 1]);
  // a question nobody answers lapses when the turn moves on: Bolt is next to the Raider, the Raider walks off
  await gm.act("token.move", { id: tokenOf(st, "Bolt").id, x: 8, y: 1 });
  assert.equal((await gm.act("fight.move", { x: 9, y: 3 })).code, 200);
  assert.deepEqual((await rae.state()).fight.pending.map((x) => [x.reactor, x.mine]), [[ids.bolt, true]]);
  await gm.act("init.next", {});                       // the GM moves on with the tracker; Bolt's turn
  assert.deepEqual((await rae.state()).fight.pending, [], "gone from the screen at once");
  assert.equal((await rae.act("fight.common", { key: "dash" })).code, 200);
  st = await rae.state();
  assert.deepEqual([st.fight.pending, st.fight.budget.total], [[], 60]);
});

/* ---------------------------------------------------------------- senses (audit 5.12) */
test("senses: read from a stat block's line; a sense in range takes the bite out of Blinded and Invisible, and says so", () => {
  assert.deepEqual(E.readSenses(["blindsight 30 ft. (blind beyond this radius)", "Darkvision 60 Ft.", "passive Perception 13"]), [{ kind: "blindsight", range: 30 }, { kind: "darkvision", range: 60 }]);
  assert.deepEqual(E.readSenses("Tremorsense 60 ft., truesight 120 ft."), [{ kind: "tremorsense", range: 60 }, { kind: "truesight", range: 120 }]);
  assert.deepEqual(E.readSenses(["-", "X"]), []);
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }, o));
  const r1 = (o) => unit(Object.assign({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0 }, o));
  // a blinded Raider with blindsight: no advantage against it within range, and its own attacks aren't at disadvantage
  let pv = E.preview(world([ava(), r1({ conditions: ["Blinded"], senses: [{ kind: "blindsight", range: 10 }] })], "ava"), "ava", "r1", blade);
  assert.deepEqual([pv.mode, pv.notes], ["normal", ["Raider's blindsight (10 ft): blinded doesn't count"]]);
  pv = E.preview(world([ava({ x: 0 }), r1({ x: 4, conditions: ["Blinded"], senses: [{ kind: "blindsight", range: 10 }] })], "ava"), "ava", "r1", rifle);
  assert.equal(pv.mode, "adv", "15 ft away: out of its blindsight");
  pv = E.preview(world([ava(), r1({ conditions: ["Blinded"], senses: [{ kind: "tremorsense", range: 30 }] })], "r1"), "r1", "ava", blade);
  assert.equal(pv.mode, "normal", "tremorsense works like blindsight here");
  // truesight finds an invisible Avery; darkvision doesn't
  pv = E.preview(world([ava({ conditions: ["Invisible"] }), r1({ senses: [{ kind: "truesight", range: 60 }] })], "r1"), "r1", "ava", blade);
  assert.deepEqual([pv.mode, pv.notes], ["normal", ["Raider's truesight (60 ft): invisible doesn't count"]]);
  assert.equal(E.preview(world([ava({ conditions: ["Invisible"] }), r1({ senses: [{ kind: "darkvision", range: 60 }] })], "r1"), "r1", "ava", blade).mode, "dis");
  assert.equal(E.preview(world([ava({ conditions: ["Invisible"] }), r1({ senses: [{ kind: "truesight", range: 60 }] })], "ava"), "ava", "r1", blade).mode, "normal", "and Avery's attacks get no advantage from it either");
  // opportunity attacks: an invisible mover is found by truesight; a blinded reactor reacts with blindsight
  let m = E.apply(world([ava({ conditions: ["Invisible"] }), r1({ senses: [{ kind: "truesight", range: 30 }] })], "ava"), { type: "move", unit: "ava", x: 0, y: 3 }, dice().roll);
  assert.equal(m.reactions.length, 1);
  m = E.apply(world([ava(), r1({ conditions: ["Blinded"] })], "ava"), { type: "move", unit: "ava", x: 0, y: 3 }, dice().roll);
  assert.equal(m.reactions.length, 0, "blinded, no sense: it doesn't notice");
  m = E.apply(world([ava(), r1({ conditions: ["Blinded"], senses: [{ kind: "blindsight", range: 10 }] })], "ava"), { type: "move", unit: "ava", x: 0, y: 3 }, dice().roll);
  assert.equal(m.reactions.length, 1);
  // the attack line says why
  const hit = E.apply(world([ava(), r1({ conditions: ["Blinded"], senses: [{ kind: "blindsight", range: 10 }] })], "ava"), { type: "attack", unit: "ava", target: "r1", attack: blade }, dice({ total: 15, nat: 10 }, { total: 4 }).roll);
  assert.match(hit.log[0].text, /Avery attacks Raider with Vibroblade \(Raider's blindsight \(10 ft\): blinded doesn't count\): 15/);
});

test("powers' attack rolls tilt for the same reasons as weapons: conditions, dodging, senses", () => {
  const ch = consular();
  const ab = E.abilitiesOf(ch, R, { "mind shove": { use: "action", range: [30, 60], attack: { bonus: "power" }, damage: [{ dice: "1d6", type: "force" }] } })[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const d = dice({ total: 15, nat: 12 }, { total: 3 });
  const r = E.apply(world([me, unit({ id: "r1", name: "Raider", side: "npc", x: 3, y: 0, conditions: ["Restrained"] })], "cass"), { type: "use", unit: "cass", ability: ab, target: "r1" }, d.roll);
  assert.deepEqual([d.asked[0].slice(0, 7), /advantage: Raider is restrained/.test(r.log[1].text)], ["2d20kh1", true]);
});

test("senses through the API: a creature's from its stat block stay the GM's; a character's are set by its owner", async () => {
  const { gm, sam, rae, ids, avery } = await fight();
  await gm.act("fight.toggle", { on: true });
  assert.equal((await gm.act("fight.npc", { id: ids.raider, speed: 30, senses: ["blindsight 30 ft. (blind beyond this radius)", "passive Perception 12"] })).code, 200);
  assert.deepEqual((await gm.state()).fight.npcDefenses[ids.raider].senses, [{ kind: "blindsight", range: 30 }]);
  assert.ok(!JSON.stringify((await sam.state()).fight).includes("blindsight"), "a creature's senses aren't sent to players");
  assert.equal((await rae.act("fight.defenses", { charId: avery, senses: [{ kind: "darkvision", range: 60 }] })).code, 403);
  assert.equal((await sam.act("fight.defenses", { charId: avery, senses: [{ kind: "darkvision", range: 60 }, { kind: "x-ray", range: 9 }] })).code, 200);
  assert.deepEqual((await rae.state()).fight.defenses[avery].senses, [{ kind: "darkvision", range: 60 }]);
});

test("review #89 through the API: one diagonal step at a time is 5, 10, 5, 10 ft, kept between requests", async () => {
  const { gm, sam } = await fight();
  await gm.act("fight.toggle", { on: true });
  const left = [];
  for (const [x, y] of [[1, 1], [2, 2], [3, 3], [4, 4]]) {
    assert.equal((await sam.act("fight.move", { x, y })).code, 200);
    left.push((await sam.state()).fight.budget.moveLeft);
  }
  assert.deepEqual(left, [25, 15, 10, 0]);
  assert.equal((await sam.act("fight.move", { x: 5, y: 5 })).code, 400);
});

/* ---------------------------------------------------------------- 0 hit points (audit 7.6) */
test("0 hit points: a character falls unconscious, or dies outright from damage left over at its maximum; creatures just drop", () => {
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0, hp: 6, maxHp: 12, deathSaves: { s: 1, f: 1 } }, o));
  const r1 = (o) => unit(Object.assign({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0 }, o));
  let r = E.apply(world([ava(), r1()], "r1"), { type: "attack", unit: "r1", target: "ava", attack: blade }, dice({ total: 18, nat: 13 }, { total: 9 }).roll);
  assert.deepEqual([r.world.units.ava.hp, r.world.units.ava.conditions, r.world.units.ava.deathSaves], [0, ["Unconscious", "Prone"], { s: 0, f: 0 }]);
  assert.equal(r.log[2].text, "Avery falls unconscious.");
  r = E.apply(world([ava(), r1()], "r1"), { type: "attack", unit: "r1", target: "ava", attack: blade }, dice({ total: 18, nat: 13 }, { total: 18 }).roll);
  assert.deepEqual([r.world.units.ava.deathSaves.f, E.isDead(r.world.units.ava)], [3, true], "6 to 0 with 12 left over: dead");
  r = E.apply(world([ava(), r1({ hp: 5 })], "ava"), { type: "attack", unit: "ava", target: "r1", attack: blade }, dice({ total: 18, nat: 13 }, { total: 9 }).roll);
  assert.deepEqual([r.world.units.r1.hp, r.world.units.r1.conditions || []], [0, []], "a creature at 0 is the GM's to call");
});

test("0 hit points: damage while dying is a failure, two on a critical; at the maximum it kills; a stable character starts dying again", () => {
  const down = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0, hp: 0, maxHp: 12, deathSaves: { s: 1, f: 0 }, conditions: ["Unconscious", "Prone"] }, o));
  const r1 = unit({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0 }), far = unit({ id: "r1", name: "Raider", side: "npc", x: 4, y: 0 });
  let r = E.apply(world([down(), far], "r1"), { type: "attack", unit: "r1", target: "ava", attack: rifle }, dice({ total: 25, nat: 13 }, { total: 3 }).roll);
  assert.deepEqual(r.world.units.ava.deathSaves, { s: 1, f: 1 }, "a hit from 20 ft: one failure");
  r = E.apply(world([down(), r1], "r1"), { type: "attack", unit: "r1", target: "ava", attack: blade }, dice({ total: 25, nat: 13 }, { total: 3 }).roll);
  assert.deepEqual(r.world.units.ava.deathSaves, { s: 1, f: 2 }, "a hit from within 5 ft on the unconscious is a critical: two failures");
  r = E.apply(world([down(), far], "r1"), { type: "attack", unit: "r1", target: "ava", attack: rifle }, dice({ total: 25, nat: 13 }, { total: 12 }).roll);
  assert.equal(E.isDead(r.world.units.ava), true);
  r = E.apply(world([down({ deathSaves: { s: 3, f: 1 } }), far], "r1"), { type: "attack", unit: "r1", target: "ava", attack: rifle }, dice({ total: 25, nat: 13 }, { total: 2 }).roll);
  assert.deepEqual(r.world.units.ava.deathSaves, { s: 0, f: 2 }, "stable no longer");
});

test("0 hit points: the death save on the dying character's turn; End turn rolls it if forgotten; healing wakes, but not the dead", () => {
  const down = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0, hp: 0, maxHp: 12, deathSaves: { s: 2, f: 2 }, conditions: ["Unconscious", "Prone"] }, o));
  const save = (n, o) => E.apply(world([down(o)], "ava"), { type: "deathsave", unit: "ava" }, dice({ total: n, nat: n }).roll);
  assert.deepEqual([save(12).world.units.ava.deathSaves, save(12).log[0].text], [{ s: 3, f: 2 }, "Avery makes a death save: 12, a success: Avery is stable."]);
  assert.equal(E.isDead(save(4).world.units.ava), true);
  assert.deepEqual(save(1, { deathSaves: { s: 0, f: 0 } }).world.units.ava.deathSaves, { s: 0, f: 2 });
  const twenty = save(20).world.units.ava;
  assert.deepEqual([twenty.hp, twenty.conditions, twenty.deathSaves], [1, ["Prone"], { s: 0, f: 0 }]);
  const once = save(12, { deathSaves: { s: 0, f: 0 } });
  assert.match(E.apply(once.world, { type: "deathsave", unit: "ava" }, dice().roll).why, /already made this turn's death save/);
  assert.equal(E.apply(world([down()], "ava"), { type: "attack", unit: "ava", target: "x", attack: blade }, dice().roll).ok, false, "unconscious: no attack");
  const ended = E.apply(world([down({ deathSaves: { s: 0, f: 0 } })], "ava"), { type: "end", unit: "ava" }, dice({ total: 15, nat: 15 }).roll);
  assert.deepEqual([ended.world.units.ava.deathSaves, ended.log[1].text], [{ s: 1, f: 0 }, "Avery makes a death save: 15, a success (1 of 3)."]);
  // healing: wakes the dying, not the dead
  const ch = consular();
  const heal = E.abilitiesOf(ch, R, { "mind shove": { use: "action", range: [30, 30], heal: { dice: "1d4" } } })[0];
  const cass = unit({ id: "cass", name: "Cass", side: "pc", x: 1, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  let r = E.apply(world([down(), cass], "cass"), { type: "use", unit: "cass", ability: heal, target: "ava" }, dice({ total: 3 }).roll);
  assert.deepEqual([r.world.units.ava.hp, r.world.units.ava.conditions, r.world.units.ava.deathSaves, r.log[1].text], [3, ["Prone"], { s: 0, f: 0 }, "Avery regains 3 hit points and wakes."]);
  r = E.apply(world([down({ deathSaves: { s: 0, f: 3 } }), cass], "cass"), { type: "use", unit: "cass", ability: heal, target: "ava" }, dice({ total: 3 }).roll);
  assert.equal(r.world.units.ava.hp, 0);
});

test("0 hit points through the API: the death saves land on the sheet, and undo takes them back", async () => {
  const { gm, sam, avery } = await fight();
  await gm.act("fight.toggle", { on: true });
  let st = await sam.state();
  await sam.act("char.save", { char: Object.assign({}, st.characters[avery], { hp: { max: 20, current: 0, temp: 0 }, conditions: ["Unconscious"] }) });
  assert.equal((await sam.act("fight.attack", { target: "x", attack: "0" })).code, 400, "unconscious");
  assert.equal((await sam.act("fight.deathsave", {})).code, 200);
  st = await sam.state();
  const ds = st.characters[avery].deathSaves;
  assert.equal(ds.s + ds.f + (st.characters[avery].hp.current > 0 ? 1 : 0) >= 1, true, "a success, a failure (or two), or a 20");
  assert.equal((await sam.act("fight.deathsave", {})).code, 400, "one a turn");
  await gm.act("fight.undo", {});
  assert.deepEqual((await sam.state()).characters[avery].deathSaves, { s: 0, f: 0 });
});

/* ---------------------------------------------------------------- walls and line of sight (issue #93) */
test("walls: segments cross; line of sight goes round a wall's end, not through it; doors and windows", () => {
  assert.equal(E.crosses([0, 0], [4, 4], [0, 4], [4, 0]), true);
  assert.equal(E.crosses([0, 0], [1, 1], [2, 0], [2, 4]), false);
  assert.equal(E.crosses([0, 2], [4, 2], [2, 2], [2, 6]), true, "touching a wall's end counts");
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }), r1 = unit({ id: "r1", name: "Raider", side: "npc", x: 4, y: 0 });
  const wall = (o) => Object.assign({ a: [2, -3], b: [2, 3], kind: "wall" }, o);
  assert.equal(E.sees(world([ava, r1], "ava"), ava, r1), true, "no walls: everyone sees everyone");
  assert.equal(E.sees(world([ava, r1], "ava", { walls: [wall()] }), ava, r1), false);
  assert.equal(E.sees(world([ava, r1], "ava", { walls: [wall({ b: [2, 0.5] })] }), ava, r1), true, "past the end of a short wall");
  assert.equal(E.sees(world([ava, r1], "ava", { walls: [wall({ kind: "door", open: false })] }), ava, r1), false);
  assert.equal(E.sees(world([ava, r1], "ava", { walls: [wall({ kind: "door", open: true })] }), ava, r1), true);
  assert.equal(E.sees(world([ava, r1], "ava", { walls: [wall({ kind: "window" })] }), ava, r1), true, "a window doesn't block sight");
  assert.deepEqual(E.cleanWalls([{ a: [1.234, 2], b: [1.234, 5], kind: "door", open: 1 }, { a: [1, 1], b: [1, 1] }, { a: [0, 0], b: [3, 0], kind: "lava" }]),
    [{ id: "", a: [1.23, 2], b: [1.23, 5], kind: "door", open: true }]);
});

test("walls: movement can't cross a wall, a window or a closed door; it goes round, or through an open door", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  const w = (walls) => world([ava], "ava", { walls });
  assert.equal(E.reachable(w([]), "ava", 30)["3,0"], 15);
  assert.equal(E.reachable(w([{ a: [2, -9], b: [2, 9], kind: "wall" }]), "ava", 30)["3,0"], undefined, "a long wall in the way");
  assert.equal(E.reachable(w([{ a: [2, -9], b: [2, 9], kind: "window" }]), "ava", 30)["3,0"], undefined, "a window too");
  const doorway = (open) => [{ a: [2, -9], b: [2, 0], kind: "wall" }, { a: [2, 0], b: [2, 1], kind: "door", open }, { a: [2, 1], b: [2, 9], kind: "wall" }];
  assert.equal(E.reachable(w(doorway(true)), "ava", 30)["3,0"], 15, "through the open door");
  assert.equal(E.reachable(w(doorway(false)), "ava", 30)["3,0"], undefined, "not through the closed one");
  assert.equal(E.reachable(w([{ a: [2, 1], b: [2, 9], kind: "wall" }]), "ava", 30)["3,1"] > 10, true, "round the wall's end costs more than straight");
  const r = E.apply(w([{ a: [2, -9], b: [2, 9], kind: "wall" }]), { type: "move", unit: "ava", x: 3, y: 0 }, dice().roll);
  assert.equal(r.ok, false);
});

test("walls: Frightened counts only while its source is in sight; in sight, no moving closer to it", () => {
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0, conditions: ["Frightened"] }, o));
  const r1 = unit({ id: "r1", name: "Raider", side: "npc", x: 6, y: 0 }), r2 = unit({ id: "r2", name: "Thug", side: "npc", x: 0, y: 3 });
  const fx = [{ unit: "ava", condition: "Frightened", ends: "never", source: "r1" }];
  const wall = [{ a: [3, -9], b: [3, 2], kind: "wall" }];
  // in sight: disadvantage on attacks; behind the wall: none, and the preview says why
  assert.equal(E.preview(world([ava(), r1, r2], "ava", { effects: fx }), "ava", "r2", rifle).mode, "dis");
  const hidden = E.preview(world([ava(), r1, r2], "ava", { effects: fx, walls: wall }), "ava", "r2", rifle);
  assert.deepEqual([hidden.mode, hidden.notes], ["normal", ["frightened, but Raider is out of sight"]]);
  // a Frightened set by hand, with no source: it always counts (the earlier default)
  assert.equal(E.preview(world([ava(), r1, r2], "ava", { walls: wall }), "ava", "r2", rifle).mode, "dis");
  // in sight: stepping toward the Raider is refused, stepping away is fine; behind the wall, toward is fine
  assert.match(E.apply(world([ava(), r1], "ava", { effects: fx }), { type: "move", unit: "ava", x: 1, y: 0 }, dice().roll).why, /frightened of Raider/);
  assert.ok(E.apply(world([ava({ x: 2 }), r1], "ava", { effects: fx }), { type: "move", unit: "ava", x: 1, y: 0 }, dice().roll).ok);
  assert.ok(E.apply(world([ava({ y: 0 }), r1], "ava", { effects: fx, walls: [{ a: [2, -9], b: [2, 9], kind: "wall" }] }), { type: "move", unit: "ava", x: 1, y: 0 }, dice().roll).ok);
});

test("walls through the API: the GM's alone; players never receive them; movement and the squares a player is sent respect them; scenes keep them", async () => {
  const { gm, sam, ids } = await fight();
  // walls are the map's (#93): the GM draws them with the combat view off too, and the view's record isn't touched
  assert.equal((await gm.act("fight.wall", { op: "add", a: [2, -5], b: [2, 5] })).code, 200, "walls work with the combat view off");
  assert.equal((await sam.act("fight.wall", { op: "add", a: [2, -5], b: [2, 5] })).code, 403);
  let off = await gm.state();
  assert.equal(off.fight, undefined, "the combat view stays off");
  await gm.act("fight.wall", { op: "clear" });
  assert.equal((await gm.state()).map.walls, undefined, "cleared: the map's exact shape again");
  await gm.act("fight.toggle", { on: true });
  assert.equal((await gm.act("fight.wall", { op: "add", a: [2, -5], b: [2, 0] })).code, 200);
  assert.equal((await gm.act("fight.wall", { op: "add", a: [2, 0], b: [2, 1], kind: "door" })).code, 200);
  assert.equal((await gm.act("fight.wall", { op: "add", a: [2, 1], b: [2, 9] })).code, 200);
  assert.equal((await gm.act("fight.wall", { op: "add", a: [3, 3], b: [3, 3] })).code, 400, "two different ends");
  const gv = await gm.state();
  assert.equal(gv.map.walls.length, 3);
  // Sam's browser gets no walls at all, only the squares Avery can reach (not past the wall)
  let pv = await sam.state();
  assert.equal("walls" in pv.map, false);
  assert.ok(!JSON.stringify(pv).includes('"kind":"door"'));
  assert.ok(pv.fight.reach && pv.fight.reach["1,0"] === 5 && pv.fight.reach["3,0"] === undefined, "the closed door stops it");
  assert.equal((await sam.act("fight.move", { x: 3, y: 0 })).code, 400);
  // the GM opens the door: through it
  const door = gv.map.walls.find((w) => w.kind === "door");
  assert.equal((await gm.act("fight.wall", { op: "door", id: door.id, open: true })).code, 200);
  pv = await sam.state();
  assert.equal(pv.fight.reach["3,0"], 15);
  assert.equal((await sam.act("fight.move", { x: 3, y: 0 })).code, 200);
  // Rae, whose turn it isn't, is sent no squares
  // a scene keeps its walls: save it, open a blank one (no walls), come back
  const sc = (await gm.act("scene.saveAs", { name: "Bunker" })).data.id;
  await gm.act("scene.new", { name: "Open field" });
  assert.equal("walls" in (await gm.state()).map, false);
  await gm.act("scene.load", { id: sc });
  assert.equal((await gm.state()).map.walls.length, 3);
  // erase one, clear the rest
  assert.equal((await gm.act("fight.wall", { op: "remove", id: door.id })).code, 200);
  assert.equal((await gm.state()).map.walls.length, 2);
  await gm.act("fight.wall", { op: "clear" });
  assert.equal("walls" in (await gm.state()).map, false, "no walls left: the map is as it was");
});

test("walls through the API: Frightened only while its source is in sight", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  // a Thug next to Avery; the Raider frightens Avery from across the room
  await gm.act("token.add", { name: "Thug", x: 0, y: 1 });
  await gm.act("init.add", { name: "Thug", init: 1, hp: 20, ac: 2 });
  const thug = (await gm.state()).initiative.entries.find((e) => e.name === "Thug").id;
  await gm.act("fight.condition", { unit: ids.avery, condition: "Frightened", source: ids.raider });
  const swing = async () => {
    assert.equal((await sam.act("fight.attack", { target: thug, attack: "0" })).code, 200);
    return (await gm.state()).chat.filter((m) => m.fight && m.roll && m.roll.kind === "attack").pop().roll.label;
  };
  assert.match(await swing(), /disadvantage \(Avery is frightened\)/, "the Raider in sight");
  await gm.act("fight.undo", {});
  await gm.act("fight.wall", { op: "add", a: [3, -9], b: [3, 9] });   // a wall between Avery (0,0) and the Raider (6,0)
  const line = await swing();
  assert.match(line, /frightened, but Raider is out of sight/);
  assert.ok(!/disadvantage/.test(line), line);
});

test("cover (issue #93, step 2): from walls by the grid method, from creatures by size; total cover can't be targeted; no walls, no cover", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 2 });
  const r1 = (o) => unit(Object.assign({ id: "r1", name: "Raider", side: "npc", x: 4, y: 2, ac: 12 }, o));
  const w = (walls, extra = []) => world([ava, r1(), ...extra], "ava", { walls });
  // a wall right across: total; one stopping halfway down the Raider's square: half (two of its corners hidden)
  assert.equal(E.coverOf(w([{ a: [3, -9], b: [3, 9], kind: "wall" }]), ava, r1()).name, "total");
  assert.equal(E.preview(w([{ a: [3, -9], b: [3, 9], kind: "wall" }]), "ava", "r1", rifle).why, "Raider has total cover.");
  const half = E.preview(w([{ a: [3.9, 0], b: [3.9, 2.5], kind: "wall" }, { a: [3.9, 2.5], b: [4.1, 2.5], kind: "wall" }]), "ava", "r1", rifle);
  assert.ok(half.legal && half.cover, JSON.stringify(half));
  assert.equal(half.ac, 12 + half.cover.bonus);
  assert.ok(half.notes.some((n) => /cover, \+\d AC/.test(n)));
  // an open door doesn't cover; no walls on the map: no cover at all, not even from a creature in the way
  assert.equal(E.coverOf(w([{ a: [3, -9], b: [3, 9], kind: "door", open: true }]), ava, r1()), null);
  const thug = unit({ id: "th", name: "Thug", side: "npc", x: 2, y: 2 });
  assert.equal(E.coverOf(world([ava, r1(), thug], "ava"), ava, r1()), null, "no walls: the GM handles cover by hand");
  // with walls somewhere on the map, a same-size creature in the line gives half cover
  assert.equal(E.coverOf(w([{ a: [20, 20], b: [21, 20], kind: "wall" }], [thug]), ava, r1()).name, "half");
  // a power can't be aimed at a creature behind total cover
  const ch = consular();
  const ab = E.abilitiesOf(ch, R, { "mind shove": { use: "action", range: [60, 60], save: { ability: "dex", dc: 13 } } })[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 2, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const blocked = world([me, r1()], "cass", { walls: [{ a: [3, -9], b: [3, 9], kind: "wall" }] });
  assert.equal(E.apply(blocked, { type: "use", unit: "cass", ability: ab, target: "r1" }, dice().roll).why, "Raider has total cover.");
});

test("review #94: a reaction prompt survives the tracker's index moving, and lapses once either side is hidden", async () => {
  const setup = async () => {
    const t = await fight();
    await t.gm.act("fight.toggle", { on: true });
    await t.sam.act("fight.move", { x: 5, y: 0 });
    await t.sam.act("fight.move", { x: 4, y: 0 });   // away from the Raider: its prompt
    return t;
  };
  // A: the GM adds a reinforcement above Avery in the order: the prompt stays, for both, and still blocks
  let { gm, sam, rae, ids } = await setup();
  await gm.act("init.add", { name: "Reinforcement", init: 25, hp: 5, ac: 10 });
  assert.equal((await gm.state()).fight.pending.length, 1, "the GM still sees it");
  assert.equal((await sam.state()).fight.pending.length, 1, "so does Sam");
  assert.equal((await sam.act("fight.end", {})).code, 400);
  const id = (await gm.state()).fight.pending[0].id;
  assert.equal((await gm.act("fight.react", { id, take: false })).code, 200, "and it can be answered");
  assert.equal((await sam.act("fight.end", {})).code, 200);
  // B: a player raises their own initiative mid-prompt: same
  ({ gm, sam, rae, ids } = await setup());
  assert.equal((await rae.act("init.update", { id: ids.bolt, fields: { init: 30 } })).code, 200);
  assert.equal((await sam.state()).fight.pending.length, 1);
  // C: the GM hides the Raider while its prompt is up: lapsed, the turn goes on, and nothing names it
  ({ gm, sam, rae, ids } = await setup());
  await gm.act("init.update", { id: ids.raider, fields: { hidden: true } });
  assert.equal((await sam.state()).fight.pending.length, 0);
  const r = await sam.act("fight.end", {});
  assert.equal(r.code, 200, JSON.stringify(r.data));
  assert.ok(!(await sam.state()).chat.some((m) => /lets Avery go|Waiting for Raider/.test(m.text || "")));
});


/* ---------------------------------------------------------------- rests (audit 7.2, 7.4, 7.5; issue #71) */
test("rests: hit dice by size from the classes; an old single number reads as the largest dice; Force Recovery's numbers", () => {
  const multi = { classes: [{ name: "Fighter", level: 3 }, { name: "Consular", level: 2 }], abilities: { str: 14, dex: 12, con: 14, int: 10, wis: 16, cha: 10 } };
  assert.deepEqual(R.hitDice(Object.assign({}, multi, { hitDiceUsed: 0 })).map((d) => [d.die, d.total, d.used, d.classes.join()]), [[10, 3, 0, "Fighter 3"], [6, 2, 0, "Consular 2"]]);
  assert.deepEqual(R.hitDice(Object.assign({}, multi, { hitDiceUsed: 4 })).map((d) => d.used), [3, 1], "an old number: the largest dice first");
  assert.deepEqual(R.hitDice(Object.assign({}, multi, { hitDiceUsed: { d6: 2, d10: 1, d4: 9 } })).map((d) => d.used), [1, 2]);
  assert.equal(R.hitDiceUsedTotal(Object.assign({}, multi, { hitDiceUsed: { d6: 2, d10: 1 } })), 3);
  assert.equal(R.forceRecovery(multi), 1 + 3, "half of Consular 2 (1) + Wis +3");
  assert.equal(R.forceRecovery({ classes: [{ name: "Consular", level: 1 }], abilities: { wis: 8, cha: 8 } }), 1, "at least 1");
  assert.equal(R.forceRecovery({ classes: [{ name: "Fighter", level: 5 }] }), 0, "not a Consular");
  // a long rest gives back half the total (here 2 of 5), the largest dice first
  const back = E.rest(Object.assign({}, multi, { hitDiceUsed: { d10: 3, d6: 2 } }), "long", R).hitDiceUsed;
  assert.deepEqual(back, { d10: 1, d6: 2 });
});

test("rests through the API: a sheet keeps its hit dice per size, and an old number still saves", async () => {
  const { sam, avery } = await fight();
  let st = await sam.state();
  await sam.act("char.save", { char: Object.assign({}, st.characters[avery], { hitDiceUsed: { d10: 1, d7: 4, __proto__x: 2 } }) });
  st = await sam.state();
  assert.deepEqual(st.characters[avery].hitDiceUsed, { d10: 1 });
  await sam.act("char.save", { char: Object.assign({}, st.characters[avery], { hitDiceUsed: 2 }) });
  assert.equal((await sam.state()).characters[avery].hitDiceUsed, 2);
});

test("rests through the API: the combat view's undo keeps every sheet's hit dice per size (review of #103)", async () => {
  const { gm, sam, rae, avery, bolt } = await fight();
  let st = await sam.state();
  const multi = [{ name: "Fighter", level: 3 }, { name: "Consular", level: 1 }];
  await sam.act("char.save", { char: Object.assign({}, st.characters[avery], { classes: multi, hitDiceUsed: { d10: 2, d6: 1 } }) });
  await rae.act("char.save", { char: Object.assign({}, st.characters[bolt], { classes: multi, hitDiceUsed: { d10: 1 } }) });
  await gm.act("fight.toggle", { on: true });
  assert.equal((await sam.act("fight.move", { x: 1, y: 0 })).code, 200);
  assert.equal((await gm.act("fight.undo", {})).code, 200);
  st = await gm.state();
  assert.deepEqual([st.characters[avery].hitDiceUsed, st.characters[bolt].hitDiceUsed], [{ d10: 2, d6: 1 }, { d10: 1 }], "the one who acted and the one who didn't");
  // a crafted undo record is cleaned with the sheet's own rules, not read as a number
  assert.deepEqual(R.cleanHitDiceUsed({ d10: "2", d7: 4, d6: -3 }), { d10: 2, d6: 0 });
  assert.deepEqual([R.cleanHitDiceUsed(3), R.cleanHitDiceUsed(""), R.cleanHitDiceUsed("x"), R.cleanHitDiceUsed(null)], [3, 0, 0, 0], "an old number reads as before");
});

/* ---------------------------------------------------------------- creatures' limited abilities (audit 9.5, issue #76) */
test("creature resources through the API: recharge rolls at the start of its turn, per day and legendary counts, all the GM's", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  const res = [
    { key: "plasma-cannon", name: "Plasma Cannon", max: 1, refill: "manual", recharge: 5 },
    { key: "rockets", name: "Rocket Launchers", max: 2, refill: "long" },
    { key: "legendary", name: "Legendary actions", max: 3, refill: "turn" },
  ];
  assert.equal((await sam.act("fight.npcres", { id: ids.raider, op: "set", res })).code, 403);
  assert.equal((await gm.act("fight.npcres", { id: ids.raider, op: "set", res })).code, 200);
  assert.equal((await gm.act("fight.npcres", { id: ids.avery, op: "set", res })).code, 400, "creatures only");
  assert.deepEqual((await sam.state()).fight.npcRes, {}, "players never see a creature's abilities");
  // legendary actions on Avery's turn: 2, then 2 more is too many
  assert.equal((await gm.act("fight.npcres", { id: ids.raider, op: "use", key: "legendary", n: 2 })).code, 200);
  assert.equal((await gm.act("fight.npcres", { id: ids.raider, op: "use", key: "legendary", n: 2 })).code, 400);
  assert.equal((await sam.act("fight.end", {})).code, 200);
  // the Raider's turn: legendary actions back; the cannon (a limited attack) fires once
  let gv = await gm.state();
  assert.equal(gv.fight.npcRes[ids.raider].find((r) => r.key === "legendary").used, 0);
  const cannon = { name: "Plasma Cannon", bonus: 40, damage: "2d10", type: "energy", melee: 0, range: [100, 400], res: "plasma-cannon" };
  assert.equal((await gm.act("fight.attack", { target: ids.avery, attack: cannon })).code, 200);
  gv = await gm.state();
  assert.equal(gv.fight.npcRes[ids.raider].find((r) => r.key === "plasma-cannon").used, 1);
  // undo gives it back; do it again; spent now for the rest of the turn (the action's gone too, so test via the guard by resetting the action)
  await gm.act("fight.undo", {});
  assert.equal((await gm.state()).fight.npcRes[ids.raider].find((r) => r.key === "plasma-cannon").used, 0);
  await gm.act("fight.attack", { target: ids.avery, attack: cannon });
  // per day: use both rockets, the third is refused; reset brings them back
  await gm.act("fight.npcres", { id: ids.raider, op: "use", key: "rockets" });
  await gm.act("fight.npcres", { id: ids.raider, op: "use", key: "rockets" });
  assert.equal((await gm.act("fight.npcres", { id: ids.raider, op: "use", key: "rockets" })).code, 400);
  await gm.act("fight.npcres", { id: ids.raider, op: "reset", key: "rockets" });
  assert.equal((await gm.state()).fight.npcRes[ids.raider].find((r) => r.key === "rockets").used, 0);
  // round the table to the Raider's next turn: the spent cannon rolls a d6 to recharge, to the GM only
  await gm.act("fight.end", {});
  for (let i = 0; i < 3; i++) { const st = await gm.state(); const cur = st.initiative.entries[st.initiative.turn]; if (cur.id === ids.raider) break; await gm.act("init.next", {}); }
  await gm.act("fight.npcres", { id: ids.raider, op: "use", key: "legendary", n: 1 });   // any combat step runs the turn's start
  gv = await gm.state();
  const line = gv.chat.filter((m) => m.roll && m.roll.kind === "recharge").pop();
  assert.ok(line && /Plasma Cannon \(recharge 5-6\)/.test(line.roll.label), JSON.stringify(line));
  assert.deepEqual(line.to, ["@gm"]);
  assert.ok(!(await sam.state()).chat.some((m) => m.roll && m.roll.kind === "recharge"), "players don't see it");
  assert.equal(gv.fight.npcRes[ids.raider].find((r) => r.key === "plasma-cannon").used, line.roll.total >= 5 ? 0 : 1);
});

test("areas stopped by walls (issue #93, step 3): no clear line from the origin, not in the area; cover from the origin helps a Dex save", () => {
  const ch = consular();
  const lib = { "blast wave": { use: "action", range: [60, 60], area: { shape: "sphere", size: 15, from: "point" }, save: { ability: "dex", dc: 14, onSave: "half" }, damage: [{ dice: "2d6", type: "fire" }] } };
  const ab = E.abilitiesOf(Object.assign({}, ch, { powers: [{ name: "Blast Wave", level: 1, type: "force", alignment: "universal" }] }), R, lib)[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const near = unit({ id: "r1", name: "Raider", side: "npc", x: 5, y: 5 }), behind = unit({ id: "r2", name: "Scout", side: "npc", x: 8, y: 5 });
  const open = world([me, near, behind], "cass");
  assert.deepEqual(E.areaHits(open, "cass", ab, { x: 6, y: 6 }).units.sort(), ["r1", "r2"]);
  const walled = world([me, near, behind], "cass", { walls: [{ a: [7.5, -9], b: [7.5, 20], kind: "wall" }] });
  assert.deepEqual(E.areaHits(walled, "cass", ab, { x: 6, y: 6 }).units, ["r1"], "the Scout is behind the wall");
  // a half wall across part of the Raider's square: a Dex save with cover from the origin
  const partial = world([me, near], "cass", { walls: [{ a: [5.2, 5.6], b: [5.2, 6.2], kind: "wall" }] });   // hides one of its corners from the origin
  const d = dice({ total: 10, nat: 10 }, { total: 6 });
  const r = E.apply(partial, { type: "use", unit: "cass", ability: ab, point: { x: 7, y: 4 } }, d.roll);
  assert.ok(r.ok, r.why);
  const save = r.log.find((l) => l.kind === "save");
  assert.match(save.text, /one-quarter cover, \+2\)/, save.text);
});

test("walls through the API: a whole map's walls set at once (an import), checked and capped", async () => {
  const { gm, sam } = await fight();
  await gm.act("fight.toggle", { on: true });
  assert.equal((await sam.act("fight.wall", { op: "set", walls: [] })).code, 403);
  assert.equal((await gm.act("fight.wall", { op: "set" })).code, 400);
  const many = Array.from({ length: 2100 }, (_, i) => ({ a: [i % 50, 1], b: [i % 50, 2], kind: i % 7 ? "wall" : "door", open: i % 2 === 0 }));
  many.push({ a: [1, 1], b: [1, 1] }, { a: [0, 0], b: [3, 0], kind: "lava" });
  assert.equal((await gm.act("fight.wall", { op: "set", walls: many })).code, 200);
  const w = (await gm.state()).map.walls;
  assert.equal(w.length, 2000, "capped");
  assert.ok(w.every((x) => /^[a-f0-9]{10}$/.test(x.id) && ["wall", "door"].includes(x.kind)), "fresh ids, known kinds");
  assert.equal("walls" in (await sam.state()).map, false);
  assert.equal((await gm.act("fight.wall", { op: "set", walls: [] })).code, 200);
  assert.equal("walls" in (await gm.state()).map, false, "an empty set leaves no walls key");
});

/* ---------------------------------------------------------------- temporary HP in the tracker and the sheet (audit 8.7, issue #107) */
test("damage from the tracker's -n and the sheet's Damage button: temporary HP first, on the server; +n and typed numbers as before", async () => {
  const { gm, sam, rae, avery, ids } = await fight();
  let st = await sam.state();
  await sam.act("char.save", { char: Object.assign({}, st.characters[avery], { hp: { max: 20, current: 20, temp: 5 } }) });
  // the tracker: -8 takes the 5 temporary first, then 3
  assert.equal((await sam.act("init.update", { id: ids.avery, fields: { damage: 8 } })).code, 200);
  st = await gm.state();
  assert.deepEqual([st.characters[avery].hp.current, st.characters[avery].hp.temp, st.initiative.entries.find((e) => e.id === ids.avery).hp], [17, 0, 17]);
  // two hits at once from two screens: both count, neither overwrites the other
  await Promise.all([gm.act("init.update", { id: ids.avery, fields: { damage: 4 } }), sam.act("char.damage", { id: avery, amount: 3 })]);
  st = await gm.state();
  assert.equal(st.characters[avery].hp.current, 10);
  // the sheet's Damage with temporary HP; stops at 0
  await sam.act("char.save", { char: Object.assign({}, st.characters[avery], { hp: { max: 20, current: 10, temp: 2 } }) });
  await sam.act("char.damage", { id: avery, amount: 50 });
  st = await gm.state();
  assert.deepEqual([st.characters[avery].hp.current, st.characters[avery].hp.temp], [0, 0]);
  // only the owner or the GM
  assert.equal((await rae.act("char.damage", { id: avery, amount: 1 })).code, 403);
  assert.equal((await rae.act("init.update", { id: ids.avery, fields: { damage: 1 } })).code, 403);
  // a creature just loses it; a typed number still sets HP
  await gm.act("init.update", { id: ids.raider, fields: { damage: 8 } });
  assert.equal((await gm.state()).initiative.entries.find((e) => e.id === ids.raider).hp, 30 - 8);
  await gm.act("init.update", { id: ids.raider, fields: { hp: 25 } });
  assert.equal((await gm.state()).initiative.entries.find((e) => e.id === ids.raider).hp, 25);
  // nonsense amounts do nothing harmful
  await gm.act("init.update", { id: ids.raider, fields: { damage: -40 } });
  await gm.act("init.update", { id: ids.raider, fields: { damage: "x" } });
  assert.equal((await gm.state()).initiative.entries.find((e) => e.id === ids.raider).hp, 25);
});

/* ---------------------------------------------------------------- fog of war (issue #93, step 4): the engine part */
test("fog: the squares a unit can see through walls; packed for the browser; fast on a big map", () => {
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 1, y: 1 });
  const show = (vis, cols) => Array.from({ length: vis.length / cols }, (_, y) => Array.from(vis.slice(y * cols, y * cols + cols)).join("")).join("/");
  // an empty 6x3 board: all of it
  assert.equal(show(E.visibleSquares(world([ava], "ava"), ["ava"], 6, 3), 6), "111111/111111/111111");
  // a wall across x=3, all the way down: the right half is dark
  const walled = world([ava], "ava", { walls: [{ a: [3, 0], b: [3, 3], kind: "wall" }] });
  assert.equal(show(E.visibleSquares(walled, ["ava"], 6, 3), 6), "111000/111000/111000");
  // an open door in it lets the eye through, a closed one doesn't
  const door = (open) => world([ava], "ava", { walls: [{ a: [3, 0], b: [3, 1], kind: "wall" }, { a: [3, 1], b: [3, 2], kind: "door", open }, { a: [3, 2], b: [3, 3], kind: "wall" }] });
  assert.equal(show(E.visibleSquares(door(false), ["ava"], 6, 3), 6), "111000/111000/111000");
  assert.equal(E.visibleSquares(door(true), ["ava"], 6, 3)[1 * 6 + 5], 1, "through the open door");
  // seen: a unit with any square in sight
  const vis = E.visibleSquares(walled, ["ava"], 6, 3);
  assert.deepEqual([E.seenIn(vis, 6, 3, { x: 2, y: 2 }), E.seenIn(vis, 6, 3, { x: 4, y: 0 }), E.seenIn(vis, 6, 3, { x: 2, y: 0, size: 2 })], [true, false, true]);
  // packed and back
  assert.deepEqual(Array.from(E.unpackSquares(E.packSquares(vis), 18)), Array.from(vis));
  // 200 x 200 with 2,000 walls: quick
  const walls = Array.from({ length: 2000 }, (_, i) => ({ a: [(i * 7) % 200, (i * 13) % 200], b: [((i * 7) % 200) + 1, ((i * 13) % 200) + 1], kind: "wall" }));
  const t0 = Date.now();
  E.visibleSquares(world([unit({ id: "ava", name: "Avery", side: "pc", x: 100, y: 100 })], "ava", { walls }), ["ava"], 200, 200);
  const took = Date.now() - t0;
  assert.ok(took < 1500, `took ${took} ms`);
});

/* ---------------------------------------------------------------- variant rules (audit 9.16) */
test("variants, only when the GM marks them: Crueler Criticals, Critical Saving Throws, Compound Advantage, Flanking", () => {
  const ava = (o) => unit(Object.assign({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 }, o));
  const r1 = (o) => unit(Object.assign({ id: "r1", name: "Raider", side: "npc", x: 1, y: 0, ac: 13 }, o));
  const V = (...names) => ({ variants: names });
  // Crueler Criticals: 1d8+3 on a critical is 1d8+3+8, not 2d8+3
  let d = dice({ total: 20, nat: 20 }, { total: 15 });
  E.apply(world([ava(), r1()], "ava", V("Crueler Criticals")), { type: "attack", unit: "ava", target: "r1", attack: blade }, d.roll);
  assert.equal(d.asked[1], "1d8+3+8");
  d = dice({ total: 20, nat: 20 }, { total: 15 });
  E.apply(world([ava(), r1()], "ava"), { type: "attack", unit: "ava", target: "r1", attack: blade }, d.roll);
  assert.equal(d.asked[1], "2d8+3", "without the variant, as before");
  // Compound Advantage: two sources stack to three d20s; two against one is plain advantage
  const two = world([ava(), r1({ conditions: ["Restrained"] })], "ava", V("Compound Advantage"));
  assert.deepEqual([E.preview(two, "ava", "r1", blade, { adv: true }).expr, E.modeName(E.preview(two, "ava", "r1", blade, { adv: true }))], ["3d20kh1+5", "superadvantage"]);
  assert.equal(E.preview(two, "ava", "r1", blade, { adv: true, dis: true }).expr, "2d20kh1+5");
  assert.equal(E.preview(world([ava(), r1({ conditions: ["Restrained"] })], "ava"), "ava", "r1", blade, { adv: true }).expr, "2d20kh1+5", "without it, two sources are plain advantage");
  // Flanking: Avery and Bolt on opposite sides of the Raider: half flanked, -3 AC against them; not from 20 ft away
  const bolt = unit({ id: "bolt", name: "Bolt", side: "pc", x: 2, y: 0 });
  const fl = world([ava(), r1(), bolt], "ava", V("Flanking"));
  const pv = E.preview(fl, "ava", "r1", blade);
  assert.deepEqual([pv.ac, pv.notes], [10, ["Raider is flanked, -3 AC"]]);
  assert.equal(E.preview(world([ava({ x: -3 }), r1(), bolt], "ava", V("Flanking")), "ava", "r1", rifle).ac, 13, "a source 20 ft away isn't flanking");
  assert.equal(E.preview(world([ava(), r1()], "ava", V("Flanking")), "ava", "r1", blade).ac, 13, "one enemy alone doesn't flank");
  assert.equal(E.preview(world([ava(), r1(), bolt], "ava"), "ava", "r1", blade).ac, 13, "without the variant");
  // Critical Saving Throws: a 20 saves whatever the total (damage at its minimum, halved); a 1 fails (damage at its maximum)
  const ch = consular();
  const ab = E.abilitiesOf(ch, R, { "mind shove": { use: "action", range: [30, 30], save: { ability: "dex", dc: 30, onSave: "half" }, damage: [{ dice: "2d6", type: "force" }] } })[0];
  const me = unit({ id: "cass", name: "Cass", side: "pc", x: 0, y: 0, pools: Object.fromEntries(E.resourcesOf(ch, R).map((x) => [x.key, x])) });
  const cs = (nat, total) => E.apply(world([me, r1({ x: 3, hp: 30, maxHp: 30 })], "cass", V("Critical Saving Throws")), { type: "use", unit: "cass", ability: ab, target: "r1" }, dice({ total, nat }).roll);
  let r = cs(20, 20);
  assert.match(r.log[1].text, /a success/);
  assert.equal(r.world.units.r1.hp, 30 - 1, "2d6 at its minimum (2), halved");
  r = cs(1, 35);
  assert.match(r.log[1].text, /a failure/);
  assert.equal(r.world.units.r1.hp, 30 - 12, "2d6 at its maximum");
});

test("review #105: a hidden creature never counts toward Flanking on a line players read; it does on the GM's own", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("variants.set", { variants: ["Flanking"] });
  await gm.act("fight.toggle", { on: true });
  // Avery at (5,5) with the Raider to the east and the hidden Lurker to the west
  const st0 = await gm.state(), tok = (n) => st0.map.tokens.find((t) => t.name === n).id;
  await gm.act("token.move", { id: tok("Avery"), x: 5, y: 5 });
  await gm.act("token.move", { id: tok("Raider"), x: 6, y: 5 });
  await gm.act("token.move", { id: tok("Lurker"), x: 4, y: 5 });
  assert.equal((await sam.act("fight.end", {})).code, 200);
  const claw = { name: "Claw", bonus: 40, damage: "1d4", type: "kinetic", melee: 5 };
  const lastAttack = async (who) => (await who.state()).chat.filter((m) => m.fight && m.roll && m.roll.kind === "attack").pop().roll.label;
  const gv = await gm.state();
  assert.equal(gv.fight.units[ids.lurker].hidden, true, "the GM's view marks the hidden unit, for the GM's own preview");
  assert.equal((await sam.state()).fight.units[ids.lurker], undefined);
  assert.equal((await gm.act("fight.attack", { target: ids.avery, attack: claw })).code, 200);
  assert.doesNotMatch(await lastAttack(sam), /flanked/, "with only the Raider visibly beside Avery, players read no flanking");
  // revealed, the Lurker counts: Avery is flanked from two sides
  await gm.act("fight.undo", {});
  await gm.act("token.update", { id: tok("Lurker"), fields: { hidden: false } });
  await gm.act("init.update", { id: ids.lurker, fields: { hidden: false } });
  assert.equal((await gm.act("fight.attack", { target: ids.avery, attack: claw })).code, 200);
  assert.match(await lastAttack(sam), /Avery is flanked, -3 AC/);
  // hidden again, and the Lurker itself attacks: that line is the GM's alone, so the Raider beside Avery counts with it
  await gm.act("fight.undo", {});
  await gm.act("token.update", { id: tok("Lurker"), fields: { hidden: true } });
  await gm.act("init.update", { id: ids.lurker, fields: { hidden: true } });
  const E2 = require("../sections/jpesus/holotable/combat/engine.js"), Fight = require("../api/_holotable-fight.js");
  const camp = JSON.parse(JSON.stringify((await gm.state())));
  const w = Fight.worldOf(Object.assign(camp, { fight: camp.fight && { spent: {}, effects: [], conc: {}, npc: {} } }), false);
  assert.equal(w.units[ids.lurker].hidden, true);
  assert.equal(E2.flankOf(w, w.units[ids.avery], w.units[ids.lurker]), 3, "hidden attacker: a GM-only line, both flankers count");
  assert.equal(E2.flankOf(w, w.units[ids.avery], w.units[ids.raider]), 0, "visible attacker: the hidden Lurker doesn't count");
});

test("review #102: walls without a usable id get their own on the way in; erasing or opening needs an id; a big map's far walls cost nothing", async () => {
  const Fight = require("../api/_holotable-fight.js");
  const w = Fight.cleanWalls([{ a: [0, 0], b: [1, 0] }, { id: "same", a: [0, 1], b: [1, 1] }, { id: "same", a: [0, 2], b: [1, 2] }, { id: "", a: [0, 3], b: [1, 3], kind: "door" }]);
  assert.equal(new Set(w.map((x) => x.id)).size, 4, "four walls, four ids");
  assert.ok(w.every((x) => x.id), "none empty");
  const { gm } = await fight();
  await gm.act("fight.toggle", { on: true });
  await gm.act("fight.wall", { op: "add", a: [3, 0], b: [3, 5] });
  assert.equal((await gm.act("fight.wall", { op: "remove", id: "" })).code, 400);
  assert.equal((await gm.act("fight.wall", { op: "door", id: "", open: true })).code, 400);
  assert.equal((await gm.state()).map.walls.length, 1);
  // 2,000 walls far away: the reachable squares are the same as with none, and quick to find
  const far = Array.from({ length: 2000 }, (_, i) => ({ a: [100 + (i % 40), 100 + Math.floor(i / 40)], b: [101 + (i % 40), 100 + Math.floor(i / 40)], kind: "wall" }));
  const ava = unit({ id: "ava", name: "Avery", side: "pc", x: 0, y: 0 });
  const t0 = Date.now();
  const lots = E.reachable(world([ava], "ava", { walls: far }), "ava", 60);
  const took = Date.now() - t0;
  assert.deepEqual(Object.keys(lots).length, Object.keys(E.reachable(world([ava], "ava"), "ava", 60)).length);
  assert.ok(took < 400, `took ${took} ms`);
});

test("review of #109 (and #111): an id that every object inherits (__proto__, constructor) is never taken for a character", async () => {
  const { gm, sam } = await fight();
  const before = JSON.stringify(Object.getOwnPropertyNames(Object.prototype).sort());
  for (const bad of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    for (const [who, type, p] of [
      [gm, "char.damage", { id: bad, amount: 5 }], [sam, "char.damage", { id: bad, amount: 5 }],
      [gm, "char.assign", { id: bad, owner: "x" }], [gm, "char.photo.clear", { charId: bad }], [gm, "char.delete", { id: bad }],
      [gm, "levelup.grant", { charIds: [bad] }], [gm, "levelup.apply", { charId: bad }],
      [sam, "init.add", { charId: bad, name: "X", init: 3 }], [sam, "token.add", { charId: bad, x: 1, y: 1 }],
      [sam, "roll", { expr: "1d20", charId: bad }], [sam, "char.save", { char: { id: bad, name: "Sneaky" } }],
    ]) {
      const r = await who.act(type, p);
      assert.ok(r.code < 500, `${type} ${bad}: ${r.code}`);
    }
  }
  // the combat view's character actions and the photo upload (review of #109)
  await gm.act("fight.toggle", { on: true });
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  for (const bad of ["__proto__", "constructor", "toString"]) {
    for (const [type, p] of [["fight.spend", { charId: bad, key: "hitdice", n: 1 }], ["fight.resource", { charId: bad, op: "add", res: { key: "x", name: "X", max: 2, refill: "long" } }],
      ["fight.defenses", { charId: bad, resist: ["fire"] }]]) {
      const r = await gm.act(type, p);
      assert.ok(r.code === 400 || r.code === 404, `${type} ${bad}: ${r.code}`);
    }
    const up = await gm.call("POST", { op: "upload" }, { purpose: "photo", charId: bad, kind: "profile", dataUrl: png });
    assert.equal(up.code, 404, `photo upload ${bad}`);
  }
  for (const k of ["image", "tokenImage", "resources", "force", "tech", "hitDiceUsed"]) assert.equal(({})[k], undefined, `nothing set ${k} on Object.prototype`);
  const after = await gm.state();
  assert.deepEqual(Object.keys(after.fight.defenses || {}).filter((k) => !Object.prototype.hasOwnProperty.call(after.characters, k)), []);
  assert.equal(({}).hp, undefined, "nothing was written onto Object.prototype");
  assert.equal(({}).owner, undefined);
  assert.ok(!Object.keys((await gm.state()).characters).some((k) => k in Object.prototype), "no character is saved under an inherited name");
  assert.equal(JSON.stringify(Object.getOwnPropertyNames(Object.prototype).sort()), before);
  const st = await gm.state();
  assert.ok(!st.map.tokens.some((t) => t.charId && !Object.prototype.hasOwnProperty.call(st.characters, t.charId)), "no token linked to an inherited name");
  assert.ok(!st.initiative.entries.some((e) => e.charId && !Object.prototype.hasOwnProperty.call(st.characters, e.charId)));
  assert.ok(!st.chat.some((m) => m.charName === "Object" || (typeof m.charName === "string" && /function/.test(m.charName))));
  assert.deepEqual(Object.keys(st.levelUps || {}).filter((k) => !Object.prototype.hasOwnProperty.call(st.characters, k)), []);
});

/* ---------------------------------------------------------------- fog of war (issue #93, step 4) */
test("fog of war through the API: the GM's switch; a player isn't sent what their characters can't see; doors, explored squares, shared sight", async () => {
  const { gm, sam, rae, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  assert.equal((await sam.act("fight.fog", { on: true })).code, 403, "the GM's switch");
  // a wall down x = 3 with a closed door at y 2-3: Avery (0,0) and Bolt (0,4) on one side, the Raider (6,0) on the other
  await gm.act("fight.wall", { op: "add", a: [3, 0], b: [3, 2] });
  await gm.act("fight.wall", { op: "add", a: [3, 2], b: [3, 3], kind: "door" });
  await gm.act("fight.wall", { op: "add", a: [3, 3], b: [3, 16] });
  let sv = await sam.state();
  await gm.act("token.move", { id: tokenOf(sv, "Raider").id, x: 6, y: 5 });   // in line with the door, as seen from Avery
  sv = await sam.state();
  assert.ok(tokenOf(sv, "Raider"), "fog off: everything as before");
  const before = JSON.stringify(Object.keys(sv.fight).sort());
  assert.equal((await gm.act("fight.fog", { on: true })).code, 200);
  sv = await sam.state();
  assert.equal(tokenOf(sv, "Raider"), undefined, "the Raider's token isn't sent");
  assert.ok(!sv.initiative.entries.some((e) => e.id === ids.raider), "nor its tracker entry");
  assert.equal(sv.fight.units[ids.raider], undefined, "nor its unit");
  assert.ok(tokenOf(sv, "Avery") && tokenOf(sv, "Bolt"), "the party's side of the wall");
  assert.equal(sv.map.fog, undefined, "the fog's record is the GM's");
  assert.equal(sv.map.walls, undefined);
  const { cols, rows } = sv.fog, n = cols * rows, vis = E.unpackSquares(sv.fog.vis, n), at = (x, y) => vis[y * cols + x];
  assert.deepEqual([at(0, 0), at(2, 5), at(4, 0), at(6, 0)], [1, 1, 0, 0], "Avery's side lit, the far side dark");
  assert.equal(JSON.stringify(Object.keys(sv.fight).sort()), before, "the combat view's state is as before: the fog is the map's, at the top of the state");
  // the reachable squares stop at what Avery sees: none on the far side of the wall
  assert.ok(Object.keys(sv.fight.reach).length > 0);
  assert.ok(Object.keys(sv.fight.reach).every((k) => { const [x, y] = k.split(",").map(Number); return x >= 0 && y >= 0 && vis[y * cols + x]; }), "only lit squares are offered");
  // what a player can't see can't be targeted: its id isn't in their world
  assert.equal((await sam.act("fight.attack", { target: ids.raider, attack: "1" })).code, 400);
  // the GM sees everything, with a veil where no player sees
  const gv = await gm.state();
  assert.ok(tokenOf(gv, "Raider") && gv.map.fog.on);
  const any = E.unpackSquares(gv.fog.any, n);
  assert.deepEqual([any[0], any[6]], [1, 0]);
  // the door opens: the Raider is in sight through it
  const door = gv.map.walls.find((w) => w.kind === "door");
  await gm.act("fight.wall", { op: "door", id: door.id, open: true });
  sv = await sam.state();
  assert.ok(tokenOf(sv, "Raider"), "seen through the open door");
  assert.ok(sv.initiative.entries.some((e) => e.id === ids.raider));
  // explored: once seen, the far side stays dim after the door shuts
  await gm.act("fight.wall", { op: "door", id: door.id, open: false });
  sv = await sam.state();
  const seen = E.unpackSquares(sv.fog.seen, n), vis2 = E.unpackSquares(sv.fog.vis, n);
  assert.equal(tokenOf(sv, "Raider"), undefined);
  assert.deepEqual([vis2[5 * cols + 6], seen[5 * cols + 6]], [0, 1], "the Raider's square: not seen now, explored");
  // Rae's Bolt: sees only Bolt's own sight; with shared sight, Avery's too
  await gm.act("token.move", { id: tokenOf(gv, "Avery").id, x: 5, y: 0 });   // the GM drags Avery through the wall
  let rv = await rae.state();
  assert.equal(tokenOf(rv, "Avery"), undefined, "Avery is out of Bolt's sight");
  assert.equal(tokenOf(rv, "Raider"), undefined);
  await gm.act("fight.fog", { shared: true });
  rv = await rae.state();
  assert.ok(tokenOf(rv, "Avery") && tokenOf(rv, "Raider"), "shared: what Avery sees, Bolt's player sees");
  // the GM resets what's explored; switching fog off sends everything again
  await gm.act("fight.fog", { shared: false });
  await gm.act("fight.fog", { reset: true });
  assert.deepEqual(Object.keys((await gm.state()).map.fog.explored).length, 2, "reset, then this action's sight is noted again");
  await gm.act("fight.fog", { on: false });
  sv = await sam.state();
  assert.ok(tokenOf(sv, "Raider") && !sv.fog);
});

test("fog of war: the tracker's turn marker follows the visible list, and marks nothing while an unseen creature acts", async () => {
  const { gm, sam, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  await gm.act("fight.wall", { op: "add", a: [3, 0], b: [3, 16] });
  await gm.act("fight.fog", { on: true });
  let sv = await sam.state();
  assert.equal(sv.initiative.entries[sv.initiative.turn].id, ids.avery, "Avery's turn, at Avery's place in Sam's list");
  await sam.act("fight.end", {});
  sv = await sam.state();
  assert.equal(sv.initiative.turn, -1, "the unseen Raider's turn: no row marked");
  assert.equal(sv.fight.turn, null);
  await gm.act("fight.end", {});
  sv = await sam.state();
  assert.equal(sv.initiative.entries[sv.initiative.turn].id, ids.bolt, "Bolt's turn: Bolt's row, though an entry above it isn't sent");
});

test("fog of war: a crafted fog record is cleaned; visibility on a big map with many walls stays quick", () => {
  const Fight = require("../api/_holotable-fight.js");
  assert.deepEqual(Fight.cleanFog({ on: 1, shared: 0, size: "24x16", explored: { "abcdef0123456789abcdef01": "AAE=", "../x": "AAE=", bad01234: "<script>" } }),
    { on: true, shared: false, size: "24x16", explored: { "abcdef0123456789abcdef01": "AAE=" } });
  assert.equal(Fight.cleanFog("x"), undefined);
  const walls = Array.from({ length: 2000 }, (_, i) => ({ a: [i % 200, Math.floor(i / 200) * 20 + 1], b: [(i % 200) + 1, Math.floor(i / 200) * 20 + 1], kind: "wall" }));
  const t0 = Date.now();
  E.visibleSquares({ walls, units: { a: { id: "a", x: 100, y: 0, size: 1 } } }, ["a"], 200, 200);
  assert.ok(Date.now() - t0 < 2000, "2,000 walls on 200 x 200 squares");
});

test("fog of war outside the combat view (#93): walls and fog are the map's; a split party explores with the view off", async () => {
  const { gm, sam, rae, ids } = await fight();
  let st0 = await gm.state();
  await gm.act("token.move", { id: tokenOf(st0, "Raider").id, x: 6, y: 5 });
  assert.equal((await gm.act("fight.wall", { op: "add", a: [3, 0], b: [3, 16] })).code, 200);
  assert.equal((await sam.act("fight.fog", { on: true })).code, 403, "the GM's switch");
  assert.equal((await gm.act("fight.fog", { on: true })).code, 200, "fog works with the combat view off");
  let sv = await sam.state(), gv = await gm.state();
  assert.equal(sv.fight, undefined, "the combat view is still off");
  assert.equal(gv.fight, undefined);
  assert.ok(sv.fog && sv.fog.vis && sv.fog.seen, "the player's squares, at the top of the state");
  assert.ok(gv.fog && gv.fog.any, "the GM's veil");
  assert.equal(tokenOf(sv, "Raider"), undefined, "behind the wall: not sent");
  assert.ok(!sv.initiative.entries.some((e) => e.id === ids.raider));
  assert.equal(sv.map.walls, undefined);
  assert.equal(sv.map.fog, undefined);
  // the party splits: the GM drags Avery past the wall; Sam sees the Raider through Avery, Rae (Bolt) doesn't
  await gm.act("token.move", { id: tokenOf(gv, "Avery").id, x: 5, y: 0 });
  sv = await sam.state();
  let rv = await rae.state();
  assert.ok(tokenOf(sv, "Raider"), "Avery sees it");
  assert.equal(tokenOf(rv, "Raider"), undefined, "Bolt, on the other side of the wall, doesn't");
  assert.equal(tokenOf(rv, "Avery"), undefined, "nor where Avery went");
  // explored follows the drag, with no combat view at all
  const n = sv.fog.cols * sv.fog.rows, seen = E.unpackSquares(sv.fog.seen, n);
  assert.equal(seen[5 * sv.fog.cols + 6], 1, "the Raider's square is explored for Sam");
  // fog off: everything again, and no fog key
  await gm.act("fight.fog", { on: false });
  sv = await sam.state();
  assert.ok(tokenOf(sv, "Raider") && sv.fog === undefined);
});

test("fog of war: chat follows sight; a player blind to the shooter gets the hit on the one they see, unnamed (#93)", async () => {
  const { gm, sam, rae, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  const st0 = await gm.state();
  // a wall at x = 3 from y 0 to 3: Avery (0,0) can't see the Raider (6,0); Bolt, moved to (1,6), sees both
  await gm.act("token.move", { id: tokenOf(st0, "Bolt").id, x: 1, y: 6 });
  await gm.act("fight.wall", { op: "add", a: [3, 0], b: [3, 3] });
  await gm.act("fight.fog", { on: true });
  assert.equal(tokenOf(await sam.state(), "Raider"), undefined, "Avery can't see the Raider");
  assert.ok(tokenOf(await rae.state(), "Raider"), "Bolt can");
  await sam.act("fight.end", {});
  const n0 = (await gm.state()).chat.length;
  assert.equal((await gm.act("fight.attack", { target: ids.bolt, attack: { name: "Blaster", bonus: 30, damage: "1d4", type: "energy", range: [60, 240] } })).code, 200);
  const g = (await gm.state()).chat.slice(n0), sv = (await sam.state()).chat, rv = (await rae.state()).chat;
  const text = (m) => (m.text || (m.roll && m.roll.label) || "");
  const full = g.filter((m) => /Raider attacks Bolt/.test(text(m)));
  assert.equal(full.length, 1, "the GM reads the attack");
  assert.ok(rv.some((m) => /Raider attacks Bolt/.test(text(m))), "Bolt's player, who sees the Raider, reads it");
  assert.ok(!sv.some((m) => /Raider/.test(text(m)) && /attacks|takes|hit/.test(text(m))), "Avery's player reads nothing naming the unseen Raider");
  const hit = g.some((m) => m.roll && m.roll.kind === "damage");
  if (hit) {   // (a natural 1 misses: then there's nothing to tell)
    assert.ok(sv.some((m) => /^Bolt is hit for \d+ damage\.$/.test(text(m))), "the hit on Bolt, whom Avery sees, unnamed");
    assert.ok(!rv.some((m) => /^Bolt is hit for/.test(text(m))), "Bolt's player has the full line instead");
  }
  const ev = (await sam.state()).fight.events || [];
  assert.ok(!ev.some((e) => e.token === tokenOf(st0, "Raider").id), "no floating numbers on the unseen Raider's token");
  // the tracker's turn line (review of #115): "Round N - Raider's turn." only to those who see the Raider
  await gm.act("fight.end", {});   // to Bolt
  await rae.act("fight.end", {});   // to the Lurker (GM-hidden: no line at all)
  await gm.act("fight.end", {});   // round 2: Avery
  await sam.act("fight.end", {});   // the Raider's turn again
  const turnLine = (c) => c.some((m) => /Round 2 - Raider's turn\./.test(m.text || ""));
  assert.equal(turnLine((await sam.state()).chat), false, "Avery's player isn't told the unseen Raider's turn");
  assert.equal(turnLine((await rae.state()).chat), true, "Bolt's player, who sees it, is");
  assert.equal(turnLine((await gm.state()).chat), true);
  assert.ok(!JSON.stringify(await sam.state()).includes("Raider"), "nowhere in Sam's state");
  // fog off: lines are for everyone again
  await gm.act("fight.fog", { on: false });
  await gm.act("fight.attack", { target: ids.bolt, attack: { name: "Blaster", bonus: 30, damage: "1d4", type: "energy", range: [60, 240] } });   // the Raider's fresh turn
  assert.ok((await sam.state()).chat.slice(-6).some((m) => /Raider attacks Bolt/.test(text(m))), "fog off: everyone reads it");
});

test("fog of war (review of #113): an unseen creature's move, hit or heal sends no floating number to a player who can't see it", async () => {
  const { gm, sam, rae, ids } = await fight();
  await gm.act("fight.toggle", { on: true });
  const st0 = await gm.state(), raider = tokenOf(st0, "Raider").id;
  await gm.act("fight.wall", { op: "add", a: [3, -1], b: [3, 16] });
  await gm.act("fight.fog", { on: true });
  await sam.act("fight.end", {});   // the Raider's turn
  assert.equal((await gm.act("fight.move", { x: 7, y: 0 })).code, 200);
  const sv = await sam.state(), gv = await gm.state();
  assert.ok(gv.fight.events.some((e) => e.token === raider && e.kind === "move"), "the GM sees the move");
  assert.ok(!(sv.fight.events || []).some((e) => e.token === raider), "Sam isn't told something unseen moved");
  assert.ok(!JSON.stringify(sv).includes(raider), "nor the Raider's token id, anywhere");
  // with the wall gone the Raider is in sight, and its next move shows
  await gm.act("fight.wall", { op: "clear" });
  await gm.act("fight.move", { x: 8, y: 0 });
  assert.ok((await sam.state()).fight.events.some((e) => e.token === raider), "in sight: the move shows");
});

test("under fog a player's drag can't cross a wall (#93): refused with 'A wall is in the way'; around through a door is fine; the GM and fog-off are unchanged", async () => {
  const { gm, sam } = await fight();
  const st0 = await gm.state(), avery = tokenOf(st0, "Avery").id;
  // a wall down x = 3 with a closed door at y 2-3; Avery at (0,0)
  await gm.act("fight.wall", { op: "add", a: [3, 0], b: [3, 2] });
  await gm.act("fight.wall", { op: "add", a: [3, 2], b: [3, 3], kind: "door" });
  await gm.act("fight.wall", { op: "add", a: [3, 3], b: [3, 16] });
  assert.equal((await sam.act("token.move", { id: avery, x: 5, y: 0 })).code, 200, "fog off: drags as before");
  await gm.act("token.move", { id: avery, x: 0, y: 0 });
  await gm.act("fight.fog", { on: true });
  const r = await sam.act("token.move", { id: avery, x: 5, y: 0 });
  assert.equal(r.code, 400);
  assert.match(JSON.stringify(r.data), /A wall is in the way/);
  assert.equal(tokenOf(await gm.state(), "Avery").x, 0, "it stays put");
  assert.equal((await sam.act("token.move", { id: avery, x: 2, y: 9 })).code, 200, "anywhere on this side, however far");
  // the door open: through it, to the far side
  const door = (await gm.state()).map.walls.find((w) => w.kind === "door");
  await gm.act("fight.wall", { op: "door", id: door.id, open: true });
  assert.equal((await sam.act("token.move", { id: avery, x: 8, y: 12 })).code, 200, "around through the open door");
  // the GM's drags are never checked
  await gm.act("fight.wall", { op: "door", id: door.id, open: false });
  assert.equal((await gm.act("token.move", { id: avery, x: 0, y: 0 })).code, 200);
  // review of #125: no way round a wall's end off the board, and no jump far off it (the board's edge is a wall too)
  await gm.act("map.settings", { cols: 20, rows: 12 });
  await gm.act("fight.wall", { op: "clear" });
  await gm.act("fight.wall", { op: "add", a: [10, 0], b: [10, 12] });
  await gm.act("token.move", { id: avery, x: 2, y: 5 });
  for (const [x, y] of [[14, 5], [14, -1], [10, -1], [1000, 1000], [-3, 5]]) {
    const r2 = await sam.act("token.move", { id: avery, x, y });
    assert.equal(r2.code, 400, `a drag to (${x},${y}) is refused`);
  }
  assert.deepEqual([tokenOf(await gm.state(), "Avery").x, tokenOf(await gm.state(), "Avery").y], [2, 5], "still where it was");
  // objects that block sight don't stop a drag
  const crate = (await gm.act("prop.add", { src: "/api/holotable?a=packone.1", x: 3, y: 4, w: 1, h: 3 })).data.id;
  await gm.act("prop.update", { id: crate, fields: { blocksSight: true } });
  assert.equal((await sam.act("token.move", { id: avery, x: 5, y: 5 })).code, 200, "a player can climb over the crates");
});
