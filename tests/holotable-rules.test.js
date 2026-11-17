// HoloTable's SW5e rules (sections/jpesus/holotable/rules.js), checked against SW5e's own class tables
// and the Player's Handbook's Appendix A.
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;

const char = (classes) => ({ classes: classes.map(([name, level]) => ({ name, level })), abilities: {} });
const maxLevels = (cls, key) => Array.from({ length: 20 }, (_, i) => R.casterInfo(char([[cls, i + 1]]))[key]);

test("max power level matches each SW5e class table at all twenty levels", () => {
  // Sentinel (audit 3.12): 1st at 1, 2nd at 3, 3rd at 6, 4th at 9, 5th at 11, 6th at 14, 7th at 17
  assert.deepEqual(maxLevels("Sentinel", "forceMaxLevel"), [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 7]);
  // full casters: a new level every odd class level, up to 9th
  for (const c of ["Consular", "Engineer"]) {
    const key = c === "Consular" ? "forceMaxLevel" : "techMaxLevel";
    assert.deepEqual(maxLevels(c, key), [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9, 9], c);
  }
  // half casters, up to 5th; the Scout's tech casting starts at 2nd level
  assert.deepEqual(maxLevels("Guardian", "forceMaxLevel"), [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]);
  assert.deepEqual(maxLevels("Scout", "techMaxLevel"), [0, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5]);
});

test("Engineers and Scouts get tech points back on a short rest; others don't", () => {
  assert.equal(R.techOnShortRest(char([["Engineer", 1]])), true);
  assert.equal(R.techOnShortRest(char([["Scout", 2]])), true);
  assert.equal(R.techOnShortRest(char([["Scout", 1]])), false, "no tech casting yet at Scout 1");
  assert.equal(R.techOnShortRest(char([["Consular", 5]])), false);
  assert.equal(R.techOnShortRest(char([["Fighter", 4], ["Engineer", 1]])), true, "a multiclass with Engineer levels");
  assert.match(R.REFERENCE.find((r) => r.title === "Tech powers").body, /short or long rest/);
});

test("all 21 conditions from the Player's Handbook, with SW5e's exhaustion and shocked", () => {
  assert.deepEqual(Object.keys(R.CONDITIONS).sort(), ["Blinded", "Charmed", "Corroded", "Deafened", "Diseased", "Exhaustion", "Frightened",
    "Grappled", "Ignited", "Incapacitated", "Invisible", "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Shocked", "Slowed",
    "Stunned", "Unconscious", "Weakened"]);
  assert.match(R.CONDITIONS.Exhaustion, /2 one slowed level/);
  assert.match(R.CONDITIONS.Exhaustion, /5 four slowed levels/);
  assert.doesNotMatch(R.CONDITIONS.Exhaustion, /speed halved/, "that's the D&D table, not SW5e's");
  assert.doesNotMatch(R.CONDITIONS.Shocked, /speed/i);
});

test("class resources (audit 3.2-3.11): SW5e's class tables at each level", () => {
  const at = (cls, L) => {
    const c = char([[cls, L]]); c.resources = R.withClassResources(c);
    return Object.fromEntries(R.resourceRows(c).map((r) => [r.key, r.die ? `${r.max}${r.die}` : r.max]));
  };
  assert.deepEqual(at("Berserker", 1), { rage: 2 });
  assert.deepEqual(at("Berserker", 20), { rage: 99 }, "unlimited rages");
  assert.deepEqual(at("Fighter", 1), { "second-wind": 1 }, "no superiority dice or Action Surge at 1st");
  assert.deepEqual(at("Fighter", 2), { superiority: "2d4", "second-wind": 1, "action-surge": 1 });
  assert.deepEqual(at("Fighter", 17), { superiority: "6d12", "second-wind": 1, "action-surge": 2, indomitable: 3 });
  assert.deepEqual(at("Monk", 1), {}, "focus starts at 2nd");
  assert.deepEqual(at("Monk", 11), { focus: 11 });
  assert.deepEqual(at("Scholar", 1), { "superiority-scholar": "3d4" });
  assert.deepEqual(at("Guardian", 5), { "channel-the-force": 3 });
  assert.deepEqual(at("Engineer", 9), { "potent-aptitude": "4d8" });
  assert.deepEqual(at("Consular", 1), {}, "Force Shield at 2nd");
  assert.deepEqual(at("Consular", 17), { "force-shield": 6 });
  assert.deepEqual(at("Sentinel", 9), { "ideal-manifests": 3 });
  assert.deepEqual(at("Operative", 10), {}, "Operatives have nothing to spend");
});

test("class resources: adding keeps the player's own resources and used counts; levels change the numbers", () => {
  const c = char([["Fighter", 2], ["scholar", 1]]);
  c.resources = [{ key: "lucky", name: "Lucky charm", max: 2, used: 1, refill: "manual" }, { key: "second-wind", name: "old", max: 1, used: 1, refill: "short" }];
  assert.deepEqual(R.missingClassResources(c).map((p) => p.key), ["superiority", "action-surge", "superiority-scholar"]);
  c.resources = R.withClassResources(c);
  assert.deepEqual(R.missingClassResources(c), [], "nothing left to add");
  const rows = Object.fromEntries(R.resourceRows(c).map((r) => [r.key, [r.max, r.used]]));
  assert.deepEqual(rows, { lucky: [2, 1], "second-wind": [1, 1], superiority: [2, 0], "action-surge": [1, 0], "superiority-scholar": [3, 0] });
  c.classes[0].level = 9;   // the table moves with the level; nothing to re-add except what's new
  assert.deepEqual(R.missingClassResources(c).map((p) => p.key), ["indomitable"]);
  assert.equal(R.resourceRows(c).find((r) => r.key === "superiority").max, 4);
  // the class table's other columns at that level
  const t = R.classTableAt(char([["Operative", 5], ["Monk", 6]]));
  assert.deepEqual(t.map((x) => [x.cls, Object.fromEntries(x.cols)["Sneak Attack"] || Object.fromEntries(x.cols)["Martial Arts"]]), [["Operative", "3d6"], ["Monk", "d6"]]);
});
