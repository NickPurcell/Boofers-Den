// The sheet importer (audit 1.2): what it reads from the SW5e builder's character JSON, and what it flags for the
// table to fill in from SW5e's lists. Run: node --test tests/holotable-import.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
require("../sections/jpesus/holotable/rules.js");

function loadImporter() {
  const sandbox = { window: { SW5E: globalThis.SW5E }, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../sections/jpesus/holotable/importer.js"), "utf8"), sandbox);
  return sandbox.window.SheetImporter;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test("builder JSON: an AC the export didn't override is flagged for the sheet to work out; a custom weapon keeps its die", () => {
  const I = loadImporter();
  const doc = { name: "Imp", baseAbilityScores: { Strength: 10, Dexterity: 14 }, classes: [{ name: "Consular", levels: 3, forcePowers: ["Choke"] }],
    customEquipment: [{ name: "Vibro-axe", equipped: true, equipmentCategory: "Weapon", damageNumberOfDice: 1, damageDieType: "d10", damageType: "Kinetic" },
      { name: "Odd blade", equipped: true, equipmentCategory: "Weapon", damageNumberOfDice: 2, damageDieType: "d7" }] };
  const r = plain(I.importAny(JSON.stringify(doc)));
  assert.equal(r.acFromDex, true);
  assert.deepEqual(r.char.attacks.filter((a) => a.name !== "Unarmed strike").map((a) => [a.name, a.damage]), [["Vibro-axe", "1d10"], ["Odd blade", "2d6"]], "a die SW5e doesn't use falls back to d6");
  assert.deepEqual(r.char.powers.map((p) => [p.name, p.level]), [["Choke", 0]], "levels come from SW5e's list in the browser");
  const over = plain(I.importAny(JSON.stringify(Object.assign({}, doc, { tweaks: { armorClass: { override: 17 } } }))));
  assert.deepEqual([over.acFromDex, over.char.ac], [false, 17], "an AC the export overrides is kept");
});
