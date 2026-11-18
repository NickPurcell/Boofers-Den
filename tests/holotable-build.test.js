// The guided level-1 build (audit 1.3, 1.7): SW5e's class list as the server serves it, and books.js's buildLevel1,
// which turns the guide's choices into a character. Run: node --test tests/holotable-build.test.js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const D = require("../api/_holotable-sw5e-data.js");
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;

function loadBooks() {
  const el = { addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], innerHTML: "", dataset: {} };
  const H = { $: () => el, $$: () => [], esc: (s) => String(s), n0: (v) => +v || 0, R, S: { st: null }, renderRules() {} };
  const sandbox = { window: { HT: H }, document: { addEventListener() {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../sections/jpesus/holotable/books.js"), "utf8"), sandbox);
  return sandbox.window.HTB;
}
// two entries shaped like SW5e's /api/class (fields trimmed to what the list reads)
const CLASS_DATA = [
  { name: "Fighter", contentSource: "PHB", summary: "Versatile combatant", primaryAbility: "Strength", hitDiceDieType: 10, hitPointsAtFirstLevelNumber: 10,
    savingThrows: ["Strength", "Constitution"], numSkillChoices: 2, skillChoicesList: ["Acrobatics", "Animal Handling", "Athletics", "Lore", "Insight", "Intimidation", "Perception", "Survival"],
    armorProficiencies: ["All armor"], weaponProficiencies: ["All blasters", "all vibroweapons"], toolProficiencies: ["None"],
    equipmentLines: ["- *(a)* mesh armor or *(b)* a combat suit"], startingWealthVariant: "8d4 x 100 cr" },
  { name: "Operative", contentSource: "PHB", summary: "Controller", primaryAbility: "Dexterity", hitDiceDieType: 8, hitPointsAtFirstLevelNumber: 8,
    savingThrows: ["Dexterity", "Intelligence"], numSkillChoices: 4, skillChoicesList: ["Any"],
    armorProficiencies: ["Light armor"], weaponProficiencies: ["Simple blasters"], toolProficiencies: ["One specialist's kit of your choice"], equipmentLines: [] },
];

test("SW5e's class list: hit die and 1st-level HP, saves as ability keys, skill count and list, proficiencies without 'None'", () => {
  const list = D.LISTS.classes.build(CLASS_DATA);
  assert.equal(D.LISTS.classes.path, "class");
  const f = list.find((c) => c.n === "Fighter"), o = list.find((c) => c.n === "Operative");
  assert.deepEqual([f.hd, f.hp1, f.saves, f.nSkills], [10, 10, ["str", "con"], 2]);
  assert.equal(f.skills.length, 8); assert.deepEqual(f.tools, [], "'None' is dropped");
  assert.deepEqual([o.nSkills, o.skills], [4, ["Any"]]);
  assert.equal(D.LISTS.classes.build([{ name: "Bad", hitDiceDieType: 99, numSkillChoices: 50, savingThrows: ["Luck"] }])[0].hd, 12, "numbers are clamped");
});

test("a background's 'Choose two from …' becomes two choices from four sheet skills", () => {
  const B = loadBooks();
  const c = (t) => JSON.parse(JSON.stringify(B.skillChoice(t)));
  assert.deepEqual(c("Choose two from Deception, Investigation, Lore, and Persuasion"), { n: 2, from: ["deception", "investigation", "lore", "persuasion"] });
  assert.deepEqual(c("Choose two from Investigation, Lore, Perception, or Survival"), { n: 2, from: ["investigation", "lore", "perception", "survival"] });
  assert.deepEqual(c("Choose two from Athletics, Lore, Sleight of Hand and Survival"), { n: 2, from: ["athletics", "lore", "sleightOfHand", "survival"] }, "no comma before 'and'");
  assert.deepEqual(c(""), { n: 0, from: [] });
});

test("buildLevel1: species, class, scores and background make one level-1 character, as SW5e's steps do", () => {
  const B = loadBooks();
  const fighter = D.LISTS.classes.build(CLASS_DATA).find((c) => c.n === "Fighter");
  const species = { n: "Zabrak", size: "Medium", asi: { con: 2, wis: 1 }, traits: [
    { n: "Ability Score Increase", d: "Your Constitution score increases by 2, and your Wisdom score increases by 1." },
    { n: "Speed", d: "Your base walking speed is 30 feet." }, { n: "Languages", d: "You can speak, read, and write Galactic Basic and Zabraki." },
    { n: "Iron Constitution", d: "You have advantage on saving throws against poison." }] };
  const bg = { n: "Agent", skills: "Choose two from Deception, Insight, Persuasion, and Stealth", tools: "One type of gaming set", langs: "One of your choice",
    equip: "A disguise kit", feature: "Second Identity", featureText: "You have a second identity.", feats: ["Silver-Tongued", "Empathic"] };
  const c = JSON.parse(JSON.stringify(B.buildLevel1({ name: "Vex", species, asi: true, cls: fighter, classSkills: ["athletics", "perception", "__proto__"],
    classFeatures: [{ n: "Second Wind", text: "Regain 1d10 + fighter level." }],
    scores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, bg, bgSkills: ["deception", "stealth"], feat: { n: "Silver-Tongued", text: "Deception and Persuasion." } })));   // across the sandbox: compare plain data
  assert.equal(c.name, "Vex"); assert.equal(c.species, "Zabrak"); assert.equal(c.background, "Agent");
  assert.deepEqual(c.classes, [{ name: "Fighter", level: 1, archetype: "" }]);
  assert.deepEqual(c.abilities, { str: 15, dex: 13, con: 16, int: 8, wis: 13, cha: 10 }, "Zabrak's +2 Con, +1 Wis on top of the scores");
  assert.deepEqual(c.hp, { max: 13, current: 13, temp: 0 }, "1st level: 10 + Con +3");
  assert.deepEqual(c.saves, { str: true, con: true });
  assert.deepEqual(Object.keys(c.skills).sort(), ["athletics", "deception", "perception", "stealth"], "class and background skills, nothing else");
  assert.ok(!Object.prototype.hasOwnProperty.call(c.skills, "__proto__"), "a key outside the sheet's skills is dropped");
  assert.equal(c.ac, 11, "10 + Dex +1, unarmored");
  assert.equal(c.acAuto, true, "brand-new: the sheet works its AC out from worn armor (#165)");
  assert.equal(c.speed, 30);
  assert.equal(c.size, "Medium", "the species' size, as the species picker sets it (#185)");
  assert.equal(B.buildLevel1({ species: Object.assign({}, species, { size: "Small" }), cls: fighter, scores: {} }).size, "Small");
  assert.equal(B.buildLevel1({ species: Object.assign({}, species, { size: "Enormous" }), cls: fighter, scores: {} }).size, undefined, "only SW5e's sizes");
  const names = c.features.map((f) => f.name);
  assert.ok(names.includes("Iron Constitution") && !names.includes("Speed") && !names.includes("Ability Score Increase"), "traits, not the bookkeeping ones");
  assert.ok(names.includes("Second Wind") && names.includes("Second Identity") && names.includes("Silver-Tongued"), "class feature, background feature and feat");
  assert.match(c.proficiencies, /Armor: All armor/); assert.match(c.proficiencies, /Weapons: All blasters/);
  assert.match(c.languages, /Zabraki/); assert.match(c.notes, /mesh armor/); assert.match(c.notes, /disguise kit/);
  const noAsi = B.buildLevel1({ species, asi: false, cls: fighter, scores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } });
  assert.equal(noAsi.abilities.con, 14, "an increase the player chooses isn't applied"); assert.equal(noAsi.hp.max, 12);
});

// audit 2.9: what a class asks for as it levels
const OPERATIVE = { name: "Operative", hitDiceDieType: 8, savingThrows: ["Dexterity"],
  levelChanges: { 1: { Features: "Expertise, Sneak Attack" }, 2: { Features: "Cunning Action, Operative Exploits" }, 6: { Features: "Expertise" }, 7: { Features: "Evasion" }, 9: { Features: "—" } },
  classFeatureText: "### Expertise\n_**Operative:** 1st and 6th level_\nChoose two.\r\n\n### Operative Exploits\nThe exploits are presented in alphabetical order.\n\n" +
    "#### Commander's Exploit\nYou learn [three maneuvers](#Maneuvers).\n\n#### Fate's Exploit\n_**Prerequisite:** 7th level_\nYou gain an [inspiration](#x) die.\n\n#### Skill's Exploit\nOne more skill." };

test("SW5e's class list: the Features column by level, and the class's own options with their prerequisite levels", () => {
  const [o] = D.LISTS.classes.build([OPERATIVE]);
  assert.equal(o.lv.length, 20);
  assert.deepEqual([o.lv[0], o.lv[5], o.lv[7], o.lv[8]], ["Expertise, Sneak Attack", "Expertise", "", ""], "a dash or a gap is no feature");
  assert.equal(o.opts.title, "Operative Exploits");
  assert.deepEqual(o.opts.items.map((x) => [x.n, x.pre]), [["Commander's Exploit", 0], ["Fate's Exploit", 7], ["Skill's Exploit", 0]]);
  assert.equal(o.opts.items[0].text, "You learn three maneuvers.", "links unwrapped");
  assert.ok(!o.opts.items[0].text.includes("\r"));
  assert.equal(D.LISTS.classes.build([{ name: "Engineer", classFeatureText: "### Tech Mastery\nNo options here." }])[0].opts, null);
  assert.equal(D.LISTS.classes.cacheAs, "classes-2", "lv and opts are a new shape, so a new cache: a list cached before them has neither");
  assert.deepEqual(D.LISTS.classes.build([{ name: "X" }])[0].lv, []);
});

test("the level-up wizard's choices: counted against the class table, what the sheet has, and prerequisites", () => {
  const B = loadBooks(), [op] = D.LISTS.classes.build([OPERATIVE]);
  const fighter = { n: "Fighter", lv: ["Fighting Style, Second Wind", "Action Surge", "Fighter Strategies"], opts: { title: "Fighter Strategies", items: [{ n: "Cover Strategist", pre: 0, text: "Cover." }] } };
  const lists = { classes: [op, fighter], maneuvers: [{ n: "Riposte", type: "Physical", pre: "", text: "r" }, { n: "Feint", type: "General", pre: "", text: "f" }, { n: "Rally", type: "Mental", pre: "Fighter 3rd level", text: "y" }],
    styles: [{ n: "Dueling", text: "d" }, { n: "Defense", text: "a" }] };
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const ved = { features: [{ name: "Skill's Exploit" }], skills: { stealth: 1, insight: 2, perception: 1 } };
  // Operative 2: two exploits; the sheet already has one, so one more, from what's left below 7th level
  let g = plain(B.levelChoices(ved, "Operative", 2, lists));
  assert.deepEqual(g.map((x) => [x.kind, x.min, x.max, x.have]), [["opts", 1, 1, 1]]);
  assert.deepEqual(g[0].items.map((x) => x.n), ["Commander's Exploit"], "Fate's Exploit waits for 7th; Skill's is on the sheet");
  assert.match(g[0].items[0].text, /^Operative Exploits \(Operative\)\nYou learn three maneuvers/);
  // Operative 6: Expertise again (the Features column), from proficient skills not already expertise; no new exploit
  g = plain(B.levelChoices({ features: [{ name: "Skill's Exploit" }, { name: "Commander's Exploit" }], skills: ved.skills }, "Operative", 6, lists));
  assert.deepEqual(g.map((x) => [x.kind, x.min, x.max]), [["expertise", 2, 2]]);
  assert.deepEqual(g[0].items.map((x) => x.key), ["perception", "stealth"]);
  // Operative 7: the third exploit, and Fate's Exploit is open now
  g = plain(B.levelChoices({ features: [{ name: "Skill's Exploit" }, { name: "Commander's Exploit" }], skills: {} }, "Operative", 7, lists));
  assert.deepEqual([g[0].min, g[0].max, g[0].items.map((x) => x.n)], [1, 1, ["Fate's Exploit"]]);
  // a sheet that's behind may catch up: Fighter 3 knows 2 maneuvers and 1 strategy; this sheet has none
  g = plain(B.levelChoices({ features: [], skills: {} }, "Fighter", 3, lists));
  assert.deepEqual(g.map((x) => [x.kind, x.min, x.max]), [["maneuvers", 1, 2], ["opts", 1, 1]]);
  assert.equal(g[0].items.find((x) => x.n === "Rally").pre, "Fighter 3rd level", "a maneuver's prerequisite is shown, not judged");
  // Fighter 1 (a multiclass): a fighting style, not one the sheet has
  g = plain(B.levelChoices({ features: [{ name: "Defense" }], skills: {} }, "Fighter", 1, lists));
  assert.deepEqual(g.map((x) => [x.kind, x.min, x.max, x.items.map((i) => i.n).join()]), [["style", 1, 1, "Dueling"]]);
  // a class with no data (books off, or a homebrew name) asks for nothing
  assert.deepEqual(plain(B.levelChoices({ features: [] }, "Jedi", 3, lists)), []);
});

test("the ◈ background on a sheet (audit 1.8): chosen skills become ticked dots, the chosen feat is added, re-choosing replaces both", () => {
  const B = loadBooks();
  const agent = { n: "Agent", skills: "Choose two from Deception, Insight, Persuasion, and Stealth", tools: "Gaming set", langs: "One of your choice", equip: "A disguise kit",
    feature: "Second Identity", featureText: "You have a second identity.", feats: ["Silver-Tongued"] };
  const c = R.blankCharacter(); c.skills = { athletics: 1, stealth: 2 };
  let x = JSON.parse(JSON.stringify(B.applyBackground(c, agent, ["deception", "stealth", "__proto__"], { n: "Silver-Tongued", text: "Deception and Persuasion." })));
  assert.deepEqual(x.skills, { athletics: 1, stealth: 2, deception: 1 }, "ticked; expertise kept; an unknown key dropped");
  assert.equal(x.background, "Agent");
  assert.deepEqual(x.features.map((f) => f.name), ["Second Identity", "Silver-Tongued"]);
  assert.match(x.proficiencies, /^Background \(Agent\): Skills: Deception, Stealth\. Tools: Gaming set$/m);
  assert.match(x.notes, /disguise kit/);
  // choose another background: its feature and feat replace the old ones; the equipment isn't added twice
  const soldier = { n: "Soldier", skills: "Choose two from Athletics, Intimidation, Piloting, and Survival", tools: "", langs: "", equip: "",
    feature: "Military Rank", featureText: "Rank.", feats: ["Brawny"] };
  x = JSON.parse(JSON.stringify(B.applyBackground(x, soldier, ["piloting", "survival"], { n: "Brawny", text: "" })));
  assert.deepEqual(x.features.map((f) => f.name), ["Military Rank", "Brawny"]);
  assert.equal((x.proficiencies.match(/^Background \(/gm) || []).length, 1, "one background line");
  assert.equal(x.skills.piloting, 1); assert.equal(x.skills.deception, 1, "dots already ticked stay");
  assert.equal(JSON.parse(JSON.stringify(B.applyBackground(x, agent, [], null))).notes.match(/disguise kit/g).length, 1, "the same equipment isn't noted twice");
});

test("SW5e ability names map only to the six: an inherited name like 'constructor' is dropped", () => {
  assert.deepEqual(D.LISTS.classes.build([{ name: "X", savingThrows: ["constructor", "Strength"] }])[0].saves, ["str"]);
  assert.equal(D.LISTS.species.build([{ name: "Y", abilitiesIncreased: [[{ abilities: ["__proto__"], amount: 2 }]] }])[0].asi, null);
  assert.deepEqual(D.LISTS.species.build([{ name: "Z", abilitiesIncreased: [[{ abilities: ["Wisdom"], amount: 2 }]] }])[0].asi, { wis: 2 });
});

test("a background skill already held can be traded for any other skill, one trade per held skill (SW5e, Backgrounds)", () => {
  const B = loadBooks(), plain = (x) => JSON.parse(JSON.stringify(x));
  const agent = { skills: "Choose two from Deception, Investigation, Lore, and Persuasion" };
  // an Operative who took Deception: one of the other three listed, plus at most one of any other skill
  let o = plain(B.backgroundSkillOptions(agent, ["deception", "stealth"]));
  assert.deepEqual([o.n, o.swaps, o.from], [2, 1, ["investigation", "lore", "persuasion"]]);
  assert.ok(o.other.includes("athletics") && !o.other.includes("stealth") && !o.other.includes("deception") && !o.other.includes("lore"));
  // nothing held from the list: no trades, no other skills offered
  o = plain(B.backgroundSkillOptions(agent, ["athletics"]));
  assert.deepEqual([o.n, o.swaps, o.other.length], [2, 0, 0]);
  // three of the four held: one listed left, two trades allowed but only two picks in all
  o = plain(B.backgroundSkillOptions(agent, ["deception", "investigation", "lore"]));
  assert.deepEqual([o.n, o.swaps, o.from], [2, 2, ["persuasion"]]);
  // a half step (0.5) isn't the proficiency, so it isn't held; 1 and 2 (expertise) are
  assert.deepEqual(plain(B.heldSkills({ deception: 0.5, lore: 1, insight: 2, stealth: 0 })), ["lore", "insight"]);
  assert.deepEqual(plain(B.heldSkills(undefined)), []);
});

test("changing an archetype takes the old one's added features off the sheet, and nothing typed by hand", () => {
  const B = loadBooks();
  const c = { features: [
    { name: "Forcecasting", text: "Archetype feature (Adept Specialist, level 3)\nYou learn..." },
    { name: "Growing Momentum", text: "Archetype feature (Adept Specialist, level 3)\n..." },
    { name: "Second Wind", text: "Class feature (Fighter, level 1)\n..." },
    { name: "My note", text: "Archetype feature (Adept Specialist is cool)" },
    { name: "Other", text: "Archetype feature (Adept Specialist Two, level 3)" },
  ] };
  assert.equal(B.dropArchetypeFeatures(c, "Adept Specialist"), 2);
  assert.deepEqual(c.features.map((f) => f.name), ["Second Wind", "My note", "Other"]);
  assert.equal(B.dropArchetypeFeatures({}, "X"), 0);
});
