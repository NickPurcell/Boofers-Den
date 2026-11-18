// Crafting (audit 11.2, #167): the request, the GM's approval, the roll, against Wretched Hives' crafting tables as SW5e's
// data gives them (built by the downtime list's builder from SW5e's chapter, here a small copy of its shape), with
// loaded dice. Every person and item here is invented.
const test = require("node:test");
const assert = require("node:assert/strict");
const Craft = require("../api/_holotable-craft.js");
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;

class Invalid extends Error {}
class Forbidden extends Error {}
function harness(rolls) {
  const chat = [], left = rolls.slice();
  const h = { Invalid, Forbidden, addChat: (_, m) => chat.push(m), shownName: (_, e) => e.name,
    rollDice: (expr) => { const n = left.length ? left.shift() : 1; return { total: n, detail: "loaded", nat: null, expr }; } };
  return { h, chat };
}
// the crafting tables' shape (mods by DC, results by d100, rarity modifiers, complications), as downtimeActs builds it
const TABLES = { crafting: { n: "Crafting", mods: [10, 15, 20, 25, 30].map((dc, i) => ({ dc, mod: 5 * (i + 1) })),
  results: [{ lo: -999, hi: 40, text: "inefficiently, expending twice the materials" }, { lo: 41, hi: 70, text: "inefficiently, one and a half times the materials" },
    { lo: 71, hi: 100, text: "no significant issue" }, { lo: 101, hi: 110, text: "efficiently, using only half the materials" }, { lo: 111, hi: 999, text: "expertly, one-quarter the materials" }],
  complPct: 10, dieN: 6, compls: ["a", "b", "c", "d", "e", "f"], rarity: [{ r: "Standard", mod: 10 }, { r: "Premium", mod: 0 }] } };
function camp() {
  return { players: { p1: { name: "Sam", role: "player" }, gm1: { name: "Dee", role: "gm" } },
    characters: { abc123def0: { id: "abc123def0", name: "Kel", owner: "p1", credits: 1000, abilities: { int: 16 }, classes: [{ name: "Engineer", level: 5 }],
      proficiencies: "Armstech's implements", equipment: [], downtime: { days: 10, log: [] } } } };
}
const roll = (c, cid, gm, type, p, h) => Craft.apply(c, cid, gm, type, Object.assign({ charId: "abc123def0" }, p), h);

test("crafting (11.2): ask, the GM approves (days and materials through downtime), roll, and the item lands", () => {
  const c = camp(), { h, chat } = harness([12, 75]);   // Int check 12 (DC 10: +5), d100 75 (+5 +10 Standard = 90: as planned)
  const { id } = roll(c, "p1", false, "craft.request", { item: { name: "Blaster pistol", cost: 500, wt: 2 }, value: 500, note: "for the job" }, h);
  const ch = c.characters.abc123def0;
  assert.equal(ch.credits, 1000, "nothing spent on asking");
  assert.ok(chat.at(-1).to.includes("@gm"));
  assert.throws(() => roll(c, "p1", false, "craft.decide", { id, ok: true }, h), Forbidden, "the GM approves");
  assert.throws(() => roll(c, "p1", false, "craft.roll", { id, [Craft.ACT_TABLES]: TABLES }, h), Invalid, "not before approval");
  roll(c, "gm1", true, "craft.decide", { id, ok: true, value: 500, tool: "Armstech's implements" }, h);
  assert.deepEqual([ch.downtime.days, ch.credits], [8, 750], "500 cr: 2 days, 250 cr of materials");
  assert.equal(ch.craft.pending[0].ok, true);
  const r = roll(c, "p1", false, "craft.roll", { id, [Craft.ACT_TABLES]: TABLES }, h);
  assert.deepEqual([r.total, r.final, r.factor], [12, 90, 1]);
  assert.deepEqual(ch.equipment.map((e) => [e.name, e.cost, e.wt]), [["Blaster pistol", 500, 2]]);
  assert.equal(ch.credits, 750, "as planned: no change");
  assert.equal("craft" in ch, false, "done");
  assert.match(ch.downtime.log.at(-1).text, /^Crafted Blaster pistol/);
  // the check rolled with the tool the sheet is proficient in: Int +3, proficiency +3
  assert.equal(chat.find((m) => m.roll && m.roll.kind === "check").roll.expr, "1d20+6");
});

test("crafting (11.2): the Crafting Results line sets what the materials really cost; refused when there aren't the days", () => {
  const c = camp(), { h } = harness([5, 10, 30, 99]);   // Int 5 (no DC met: +0), d100 10 + 10 = 20: twice the materials
  const ch = c.characters.abc123def0;
  const { id } = roll(c, "p1", false, "craft.request", { item: { name: "Vibroblade", cost: 400 }, value: 400 }, h);
  roll(c, "gm1", true, "craft.decide", { id, ok: true }, h);   // the book's numbers: 2 days, 200 cr
  assert.deepEqual([ch.downtime.days, ch.credits], [8, 800]);
  const r = roll(c, "p1", false, "craft.roll", { id, [Craft.ACT_TABLES]: TABLES }, h);
  assert.equal(r.factor, 2);
  assert.equal(ch.credits, 600, "another 200 cr of materials");
  // more days than the character has: the GM's approval is refused by downtime
  const q = roll(c, "p1", false, "craft.request", { item: { name: "Speeder" }, value: 10000 }, h).id;
  assert.throws(() => roll(c, "gm1", true, "craft.decide", { id: q, ok: true }, h), Invalid);
  roll(c, "gm1", true, "craft.decide", { id: q, ok: false }, h);
  assert.equal("craft" in ch, false, "turned down");
});

test("crafting (11.2): only the owner or the GM; ids and items checked; the factors read from SW5e's words", () => {
  const c = camp(), { h } = harness([]);
  assert.throws(() => roll(c, "p2", false, "craft.request", { item: { name: "X" } }, h), Forbidden);
  assert.throws(() => roll(c, "p1", false, "craft.request", { item: { name: "" } }, h), Invalid);
  assert.throws(() => Craft.apply(c, "gm1", true, "craft.request", { charId: "__proto__", item: { name: "X" } }, h), Invalid);
  assert.throws(() => roll(c, "p1", false, "craft.roll", { id: "nosuchrequest" }, h), Invalid);
  assert.deepEqual(Craft.cleanItem({ name: " Kit ", wt: -1, cost: "abc", rar: "Shiny", armor: { kind: "__proto__" }, extra: 1 }), { name: "Kit", qty: 1, equipped: false, notes: "" });
  // what the sheet keeps on an item, as "+ from SW5e" adds it: a medpac's use, an enhanced item's +N, armor's speed properties
  assert.deepEqual(Craft.cleanItem({ name: "Medpac", use: { hd: 1, heal: "rm -rf" }, bonus: { hit: 9, dmg: 1 }, armor: { kind: "heavy", ac: 17, str: 15, cumbersome: 1 } }),
    { name: "Medpac", qty: 1, equipped: false, notes: "", armor: { kind: "heavy", ac: 17, str: 15, cumbersome: true }, use: { hd: 1 }, bonus: { dmg: 1 } });
  assert.deepEqual(["expending twice", "one and a half times", "no significant issue", "using only half", "one-quarter"].map(Craft.materialsFactor), [2, 1.5, 1, 0.5, 0.25]);
  assert.equal(Craft.clean({ pending: [{ item: { name: "" } }, "x"] }), undefined);
  // the sheet's suggestions
  assert.deepEqual([R.craftValue({ cost: 500 }, false), R.craftValue({ rar: "Premium", cat: "Weapon" }, true), R.craftValue({ rar: "Premium", cat: "Consumable" }, true)], [500, 5000, 2500]);
  assert.deepEqual([R.craftDays(500), R.craftDays(1), R.craftDays(0)], [2, 1, 1]);
  assert.deepEqual([R.craftTool({ cat: "Weapon", wc: "Simple Blaster" }), R.craftTool({ cat: "Armor" }), R.craftTool({ cat: "Explosive", n: "Grenade" })],
    ["Armstech's implements", "Armormech's implements", "Demolitions kit"]);
});
