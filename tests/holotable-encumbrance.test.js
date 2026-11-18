// The encumbrance variant in the combat view (audit 6.5, #167): a character's load slows it, and a heavy load gives
// disadvantage on its Strength, Dexterity and Constitution attacks, saves and checks. Every name here is invented; the
// dice are loaded so every outcome is known.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../sections/jpesus/holotable/combat/engine.js");
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;

function dice(...results) {
  const asked = [];
  const roll = (expr) => { asked.push(expr); const r = results.shift(); if (!r) throw new Error("ran out of loaded dice for " + expr); return Object.assign({ detail: "loaded" }, r); };
  return { roll, asked };
}
// Kell (Str 10: encumbered over 50 lb, heavily over 100) with a vibroblade, against a raider
const kell = (load) => ({ id: "c1", name: "Kell", owner: "p1", speed: 30, ac: 12, hp: { max: 30, current: 30, temp: 0 }, classes: [{ name: "Fighter", level: 1 }],
  abilities: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 }, saves: {}, skills: {},
  attacks: [{ name: "Vibroblade", ab: "str", damage: "1d8", type: "kinetic", props: "" }, { name: "Mind spike", ab: "wis", damage: "1d6", type: "psychic", props: "" }],
  equipment: [{ name: "Crate", qty: 1, wt: load }] });
const table = (load, variants) => ({
  characters: { c1: kell(load) }, entries: [{ id: "e1kell", charId: "c1", name: "Kell" }, { id: "e2raider", name: "Raider", hp: 20, ac: 10 }],
  active: true, turnId: "e1kell", round: 1, tokens: [{ id: "t1", x: 0, y: 0 }, { id: "t2", x: 1, y: 0 }], unitTokens: { e1kell: "t1", e2raider: "t2" },
  spent: {}, effects: [], conc: {}, npcSpeed: {}, npcStats: {}, defenses: {}, walls: [], variants,
});

test("encumbrance in the combat view: off by default; with the variant, speed -10 or -20", () => {
  assert.deepEqual([E.buildWorld(table(120, []), R).units.e1kell.speed, E.buildWorld(table(120, []), R).units.e1kell.encumbered], [30, ""], "the variant is off: no effect");
  const at = (load) => { const u = E.buildWorld(table(load, ["Encumbrance"]), R).units.e1kell; return [u.speed, u.encumbered, E.budget(E.buildWorld(table(load, ["Encumbrance"]), R)).moveLeft]; };
  assert.deepEqual(at(50), [30, "", 30]);
  assert.deepEqual(at(60), [20, "encumbered", 20]);
  assert.deepEqual(at(120), [10, "heavy", 10]);
  assert.deepEqual(at(200), [10, "heavy", 10], "over the capacity counts as heavy too");
});

test("heavily encumbered: disadvantage on a Str attack, not on a Wis one", () => {
  const w = E.buildWorld(table(120, ["Encumbrance"]), R);
  const atk = E.attacksOf(w.units.e1kell && table(120).characters.c1, R);
  const blade = atk.find((a) => a.name === "Vibroblade"), spike = atk.find((a) => a.name === "Mind spike");
  let d = dice({ total: 15, nat: 13 }, { total: 4, nat: null });
  let r = E.apply(w, { type: "attack", unit: "e1kell", target: "e2raider", attack: blade }, d.roll);
  assert.ok(r.ok, r.why);
  assert.match(d.asked[0], /^2d20kl1/, "disadvantage on the d20");
  assert.match(r.log[0].text, /heavily encumbered/);
  d = dice({ total: 15, nat: 13 }, { total: 4, nat: null });
  r = E.apply(E.buildWorld(table(120, ["Encumbrance"]), R), { type: "attack", unit: "e1kell", target: "e2raider", attack: spike }, d.roll);
  assert.ok(r.ok, r.why);
  assert.match(d.asked[0], /^1d20/, "a Wisdom attack is as usual");
});

test("heavily encumbered: disadvantage on a Dex save against a power", () => {
  const t = table(120, ["Encumbrance"]);
  // the raider's turn: a save power at Kell
  t.turnId = "e2raider";
  const w = E.buildWorld(t, R);
  const ab = { key: "x", name: "Blast", kind: "power", level: 0, use: "action", cost: {}, reach: null, range: [60, 60], area: null, targets: 1,
    attack: null, save: { ability: "dex", dc: 13, onSave: "none" }, damage: [{ dice: "1d6", add: 0, type: "fire" }], applies: [], concentration: false };
  const d = dice({ total: 9, nat: 7 }, { total: 3, nat: null });
  const r = E.apply(w, { type: "use", unit: "e2raider", ability: ab, targets: ["e1kell"] }, d.roll);
  assert.ok(r.ok, r.why);
  assert.match(d.asked[0], /^2d20kl1/, "the Dex save at disadvantage");
});

test("speed in the combat view (5.11): heavy armor a character is too weak for, and cumbersome armor, slow it", () => {
  const t = table(0, []);
  t.characters.c1.equipment = [{ name: "Assault armor", equipped: true, armor: { kind: "heavy", ac: 17, str: 15, cumbersome: true } }];
  const w = E.buildWorld(t, R);
  assert.equal(w.units.e1kell.speed, 15, "Str 10 under Str 15: -10; cumbersome: -5");
  assert.equal(E.budget(w).moveLeft, 15);
  assert.equal(E.buildWorld(table(0, []), R).units.e1kell.speed, 30, "carried, not worn: no change");
});
