// Tests for HoloTable's books.js helpers that don't need a page: loaded in a sandbox with stand-in helpers.
// Run: node --test tests/holotable-books.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");

function loadBooks() {
  const el = { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], innerHTML: "", dataset: {} };   // stands in for the page's elements
  const H = { $: () => el, $$: () => [], esc: (s) => String(s), n0: (v) => +v || 0, R: {}, S: { st: null }, renderRules() {} };
  const sandbox = { window: { HT: H }, document: { addEventListener() {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../sections/jpesus/holotable/books.js"), "utf8"), sandbox);
  return sandbox.window.HTB;
}

test("creature saves and skills: every way SW5e's data writes them is read as name + bonus", () => {
  const B = loadBooks();
  const pick = (list) => JSON.parse(JSON.stringify(B.bonuses(list)));
  assert.deepEqual(pick(["Dex +5", "Insight+12", "Dex + 6", "* Dex +7"]),
    [{ name: "Dex", bonus: 5 }, { name: "Insight", bonus: 12 }, { name: "Dex", bonus: 6 }, { name: "Dex", bonus: 7 }]);
  assert.deepEqual(pick(["Stealth +14 Survival +8", "Sleight of Hand -1"]),
    [{ name: "Stealth", bonus: 14 }, { name: "Survival", bonus: 8 }, { name: "Sleight of Hand", bonus: -1 }], "two in one entry; multi-word names; minus");
  assert.deepEqual(pick(["Cha", "+7"]), [{ text: "Cha" }, { text: "+7" }], "entries without a name and a number stay as text");
});

test("creature saves: the listed bonus when it has one, otherwise the plain ability modifier", () => {
  const B = loadBooks();
  const m = { n: "Brain Walker", ab: { str: 1, dex: 11, con: 15, int: 16, wis: 12, cha: 16 }, saves: ["Int +6", "Wisdom +4", "Cha"] };
  assert.equal(B.saveBonus(m, "int"), 6);
  assert.equal(B.saveBonus(m, "wis"), 4, "full ability names work too");
  assert.equal(B.saveBonus(m, "str"), -5, "not proficient: Str 1 is -5");
  assert.equal(B.saveBonus(m, "cha"), 3, "a bare 'Cha' has no number, so the modifier is used");
});
