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
