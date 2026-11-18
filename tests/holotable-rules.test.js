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

test("archetypes that cast (audit 3.13): points and max power level from each one's SW5e table", () => {
  const arch = (cls, archetype, L, abilities = {}) => R.casterInfo({ classes: [{ name: cls, level: L, archetype }], abilities });
  const series = (cls, archetype, key) => Array.from({ length: 20 }, (_, i) => arch(cls, archetype, i + 1)[key]);
  // force archetypes: 1 force point per class level from 3rd (plus Wis or Cha); 1st at 3, 2nd at 7, 3rd at 13, 4th at 17
  const forceAt = [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4];
  for (const [cls, a] of [["Operative", "Beguiler Practice"], ["Berserker", "Marauder Approach"], ["Fighter", "Adept Specialist"],
    ["Monk", "Aing-Tii Order"], ["Scholar", "Archaeologist Pursuit"]]) {
    assert.deepEqual(series(cls, a, "forceMaxLevel"), forceAt, a);
    assert.deepEqual(series(cls, a, "forceMax"), [0, 0, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], a);
    assert.equal(arch(cls, a, 10).techMax, 0, a);
  }
  // tech archetypes: half the class level rounded up, from 3rd (plus Int); the same max power levels
  for (const [cls, a] of [["Fighter", "Shield Specialist"], ["Berserker", "Industrial Approach"], ["Operative", "Saboteur Practice"], ["Scholar", "Slicer Pursuit"]]) {
    assert.deepEqual(series(cls, a, "techMaxLevel"), forceAt, a);
    assert.deepEqual(series(cls, a, "techMax"), [0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10], a);
    assert.equal(R.techOnShortRest({ classes: [{ name: cls, level: 3, archetype: a }] }), true, `${a}: tech points back on a short rest`);
  }
  // the modifier is added once: Marauder 5 with Cha 16 has 5 + 3 force points
  assert.equal(arch("Berserker", "Marauder Approach", 5, { cha: 16, wis: 10 }).forceMax, 8);
  assert.equal(arch("Fighter", "Shield Specialist", 5, { int: 14 }).techMax, 5);
  // an archetype that doesn't cast, the wrong class for the archetype, or no archetype: nothing
  assert.equal(arch("Berserker", "Juyo Approach", 10).forceMax, 0);
  assert.equal(arch("Fighter", "Marauder Approach", 10).forceMax, 0, "Marauder is a Berserker archetype");
  assert.equal(arch("Fighter", "", 10).forceMaxLevel, 0);
  // the three that give a caster powers of the other kind bring no pool of their own
  assert.equal(arch("Engineer", "Artificer Engineering", 10).forceMax, 0);
  assert.equal(arch("Sentinel", "Path of Synthesis", 10).techMax, 0);
  // names typed or imported without their last word, and in any case
  assert.equal(arch("berserker", "marauder", 7).forceMaxLevel, 2);
  assert.equal(arch("Monk", "Aing-Tii", 3).forceMaxLevel, 1);
  // an Archaeologist may cast with Intelligence: light side the better of Int and Wis, dark side of Int and Cha
  const ar = arch("Scholar", "Archaeologist Pursuit", 5, { int: 18, wis: 12, cha: 8 });
  assert.equal(ar.lightDC, 8 + 3 + 4);
  assert.equal(ar.darkDC, 8 + 3 + 4);
  assert.equal(ar.forceMax, 5 + 4);
  const bg = arch("Operative", "Beguiler Practice", 5, { int: 18, wis: 12, cha: 8 });
  assert.equal(bg.lightDC, 8 + 3 + 1, "other force archetypes use Wisdom for light side");
});

test("Mechanist Technique and Rakatan Order (#160's review): their Techcasting tables in SW5e's feature data", () => {
  const ci = (cls, L, archetype, abilities = {}) => R.casterInfo({ classes: [{ name: cls, level: L, archetype }], abilities });
  const series = (cls, a, key) => Array.from({ length: 20 }, (_, i) => ci(cls, i + 1, a)[key]);
  // Mechanist Technique improves the Scout's own casting from 3rd: 1.5 points per level (rounded up), 2nd at 3 ... 7th at 17
  assert.deepEqual(series("Scout", "Mechanist Technique", "techMax"), [0, 2, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18, 20, 21, 23, 24, 26, 27, 29, 30]);
  assert.deepEqual(series("Scout", "Mechanist Technique", "techMaxLevel"), [0, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 7]);
  assert.equal(R.highCastFrom({ classes: [{ name: "Scout", level: 17, archetype: "Mechanist Technique" }] }, "tech"), 5, "5th to 7th once per long rest");
  assert.equal(R.highCastFrom({ classes: [{ name: "Scout", level: 17, archetype: "" }] }, "tech"), 4);
  assert.equal(ci("Scout", 9, "Mechanist").techMaxLevel, 4, "without its last word");
  // Rakatan Order (Monk): a tech archetype like the others, casting with Int, Wis or Cha
  assert.deepEqual(series("Monk", "Rakatan Order", "techMax"), [0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10]);
  assert.deepEqual(series("Monk", "Rakatan Order", "techMaxLevel"), [0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  const rk = ci("Monk", 5, "Rakatan Order", { int: 10, wis: 16, cha: 8 });
  assert.deepEqual([rk.techDC, rk.techAtk, rk.techMax], [8 + 3 + 3, 3 + 3, 3 + 3]);
  assert.equal(R.techOnShortRest({ classes: [{ name: "Monk", level: 3, archetype: "Rakatan Order" }] }), true);
  assert.equal(R.highCastFrom({ classes: [{ name: "Monk", level: 17, archetype: "Rakatan Order" }] }, "tech"), 4);
});

test("multiclass max power level (audit 3.14): the PHB's weighted caster level and its table", () => {
  const mc = (...classes) => R.casterInfo({ classes: classes.map(([name, level, archetype]) => ({ name, level, archetype: archetype || "" })), abilities: {} });
  // the PHB's own example: Marauder Approach berserker 4 (4/9 x 4 = 1.77) + guardian 3 (5/9 x 3 = 1.67) = 3rd: 2nd-level powers
  assert.equal(mc(["Berserker", 4, "Marauder Approach"], ["Guardian", 3]).forceMaxLevel, 2);
  assert.equal(mc(["Berserker", 4, "Marauder Approach"], ["Guardian", 3]).forceMax, 4 + 6, "points add up as before");
  // consular 3 + sentinel 3 = 3 + 2.33, counts as 5th: 3rd-level powers (the highest single class alone is 2nd)
  assert.equal(mc(["Consular", 3], ["Sentinel", 3]).forceMaxLevel, 3);
  // guardian 4 (2.22) + sentinel 1 (0.78) counts as 3rd: 2nd (each alone is 1st)
  assert.equal(mc(["Guardian", 4], ["Sentinel", 1]).forceMaxLevel, 2);
  // engineer 5 + scout 6 = 5 + 3.33, counts as 8th: 4th (engineer 5 alone is 3rd)
  assert.equal(mc(["Engineer", 5], ["Scout", 6]).techMaxLevel, 4);
  // a scout's first level has no tech casting, so it adds nothing
  assert.equal(mc(["Engineer", 5], ["Scout", 1]).techMaxLevel, 3);
  // force and tech are counted separately; one source of each kind keeps its own table
  const both = mc(["Consular", 5], ["Scout", 4]);
  assert.equal(both.forceMaxLevel, 3);
  assert.equal(both.techMaxLevel, 1);
  // a non-casting class adds nothing
  assert.equal(mc(["Guardian", 5], ["Fighter", 10]).forceMaxLevel, 2);
  // never lower than one class's own table: sentinel 3 + guardian 1 is 2.9, 1st, but sentinel 3 alone casts at 2nd
  assert.equal(mc(["Sentinel", 3], ["Guardian", 1]).forceMaxLevel, 2);
  // capped at 9th
  assert.equal(mc(["Consular", 18], ["Sentinel", 2]).forceMaxLevel, 9);
  // where it comes from, for the sheet
  assert.deepEqual(mc(["Berserker", 4, "Marauder Approach"], ["Guardian", 3]).sources.map((s) => [s.of, s.caster, s.maxLevel]),
    [["Marauder Approach", "force", 1], ["Guardian", "force", 1]]);
});

test("max power level check (audit 4.5): above it is reported, at or below it isn't", () => {
  const kira = { name: "Kira", classes: [{ name: "Consular", level: 5 }], abilities: {} };   // force up to 3rd, no tech
  assert.equal(R.overMaxPowerLevel(kira, { level: 3, type: "force" }), null);
  assert.equal(R.overMaxPowerLevel(kira, { level: 0, type: "tech" }), null, "at-will powers are always fine");
  assert.deepEqual(R.overMaxPowerLevel(kira, { level: 4, type: "force" }),
    { level: 4, max: 3, text: "Level 4 is above Kira's max force power level (3)." });
  assert.equal(R.overMaxPowerLevel(kira, { level: 1, type: "tech" }).text, "Kira can't cast leveled tech powers yet (no max tech power level).");
  // checked against a given casterInfo instead (the level-up wizard passes the level being gained)
  const after = R.casterInfo({ classes: [{ name: "Consular", level: 7 }], abilities: {} });
  assert.equal(R.overMaxPowerLevel(kira, { level: 4, type: "force" }, after), null);
});

test("high-level casting (#160): from which level each level goes once per long rest; a used one is blocked", () => {
  const from = (classes, kind = "force") => R.highCastFrom({ classes: classes.map(([name, level, archetype]) => ({ name, level, archetype })) }, kind);
  assert.equal(from([["Consular", 11]]), 6);
  assert.equal(from([["Engineer", 17]], "tech"), 6);
  assert.equal(from([["Sentinel", 11]]), 5);
  assert.equal(from([["Guardian", 13]]), 4);
  assert.equal(from([["Scout", 13]], "tech"), 4);
  assert.equal(from([["Berserker", 17, "Marauder Approach"]]), 4);
  assert.equal(from([["Fighter", 10]]), 0, "no casting, no rule");
  assert.equal(from([["Consular", 11]], "tech"), 0);
  // multiclassed: the class with the most levels; on a tie, the later threshold
  assert.equal(from([["Guardian", 10], ["Consular", 5]]), 4);
  assert.equal(from([["Consular", 10], ["Guardian", 10]]), 6);
  const kira = { name: "Kira", classes: [{ name: "Consular", level: 11 }], force: { used: 0, high: [6] } };
  assert.equal(R.highCastBlocked(kira, { type: "force" }, 5), null, "below the threshold");
  assert.equal(R.highCastBlocked(kira, { type: "force" }, 7), null, "7th not cast yet");
  assert.equal(R.highCastBlocked(kira, { type: "force" }, 6).text, "Kira has already cast a 6th-level force power since the last long rest (6th level and up: once each per long rest).");
  assert.deepEqual(R.highCastUsed({ force: { high: [9, "6", 12, 0] } }, "force"), [9, 6]);
});

test("carrying (audit 6.5): weight times quantity against Str x 15; the encumbrance variant at 5x and 10x Str", () => {
  const c = (str, items) => ({ abilities: { str }, equipment: items.map(([qty, wt]) => ({ name: "x", qty, wt })) });
  assert.deepEqual(R.carrying(c(10, [[1, 12], [2, 3.5], [3, 0], [1, undefined]])), { weight: 19, capacity: 150, variant: false, state: "", slow: 0, text: "" });
  // without the variant, only the capacity matters
  assert.equal(R.carrying(c(10, [[1, 140]])).state, "");
  assert.equal(R.carrying(c(10, [[1, 151]])).state, "over");
  // with it: over 50 lb encumbered, over 100 heavily
  const v = [R.ENCUMBRANCE];
  assert.deepEqual([R.carrying(c(10, [[1, 50]]), v).state, R.carrying(c(10, [[1, 51]]), v).slow], ["", 10]);
  assert.deepEqual([R.carrying(c(10, [[1, 101]]), v).state, R.carrying(c(10, [[1, 101]]), v).slow], ["heavy", 20]);
  assert.match(R.carrying(c(10, [[1, 101]]), v).text, /disadvantage on Str, Dex and Con/);
  assert.equal(R.carrying(c(10, [[2, 80]]), v).state, "over");
  // a negative quantity or weight counts as nothing
  assert.equal(R.carrying(c(10, [[-3, 10], [1, -5]])).weight, 0);
  // the sheet's size (#185): doubled per size above Medium, halved for Tiny, Small as Medium
  const sized = (size) => R.carrying(Object.assign(c(10, []), { size })).capacity;
  assert.deepEqual(["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan", undefined].map(sized), [75, 150, 150, 300, 600, 1200, 150]);
});

test("selling (audit 6.8): half the cost, rounded down; no cost, nothing", () => {
  assert.deepEqual([R.sellPrice({ cost: 50 }), R.sellPrice({ cost: 75 }), R.sellPrice({ cost: 1 }), R.sellPrice({}), R.sellPrice({ cost: -10 })], [25, 37, 0, 0, 0]);
});

test("attunement (audit 6.3): slots as the proficiency bonus; advanced and up take two; the simpler variant three of one", () => {
  const c = (level, items) => ({ name: "Vee", classes: [{ name: "Operative", level }], equipment: items.map(([rar, attuned, att = true]) => ({ name: rar + " item", rar, att, attuned })) });
  assert.deepEqual([R.attunement(c(1, [])).max, R.attunement(c(5, [])).max, R.attunement(c(17, [])).max], [2, 3, 6]);
  const vee = c(1, [["Premium", true], ["Advanced", false], ["Standard", false], ["Legendary", true, false]]);
  assert.equal(R.attunement(vee).used, 1, "an item that doesn't need attunement doesn't count");
  assert.equal(R.attuneBlocked(vee, 2), null, "a second one-slot item fits in two");
  assert.equal(R.attuneBlocked(vee, 1).text, "Vee has 1 of 2 attunement slots free; Advanced item takes 2.");
  assert.equal(R.attuneBlocked(vee, 1, [R.SIMPLE_ATTUNEMENT]), null, "the simpler variant: three slots, one each");
  vee.equipment[1].name = "Focus Lens";
  assert.equal(R.attuneBlocked(vee, 1).text, "Vee has 1 of 2 attunement slots free; Focus Lens (Advanced) takes 2.");
  assert.equal(R.attunement(vee, [R.SIMPLE_ATTUNEMENT]).max, 3);
});

test("consumables (audit 6.7): what using one rolls, read from its text; checked; a medpac's Hit Die", () => {
  // the shapes of SW5e's own consumable text, in our words
  assert.deepEqual(R.consumableUse("Each creature nearby must make a DC 14 Dexterity saving throw. A creature takes 2d6 fire and 2d10 kinetic damage on a failed save, or half as much on a success."),
    { save: { ab: "dex", dc: 14 }, dmg: [["2d6", "fire"], ["2d10", "kinetic"]], half: true });
  assert.deepEqual(R.consumableUse("must make a DC 13 Constitution saving throw, taking 2d4 poison damage on a failed save"), { save: { ab: "con", dc: 13 }, dmg: [["2d4", "poison"]] });
  assert.deepEqual(R.consumableUse("The creature rolls two dice equal to the size of their Hit Die and regains hit points"), { hd: 2 });
  assert.deepEqual(R.consumableUse("You regain 2d4 + 2 hit points."), { heal: "2d4+2" });
  assert.deepEqual(R.consumableUse("A kit has five charges."), {});
  // only this shape survives
  assert.deepEqual(R.cleanUse({ hd: "x", heal: "2d4; drop", save: { ab: "__proto__", dc: 9 }, dmg: [["1d6", "fire"], ["lots", "fire"], ["1d4", "<b>"]], half: true }), { dmg: [["1d6", "fire"]] });
  assert.equal(R.cleanUse("nope"), null);
  // the Hit Die a creature has most of
  assert.equal(R.commonHitDie({ classes: [{ name: "Fighter", level: 3 }, { name: "Consular", level: 5 }] }), 6);
  assert.equal(R.commonHitDie({ classes: [{ name: "Fighter", level: 2 }, { name: "Scholar", level: 2 }] }), 10, "a tie: the larger");
});

test("enhanced items (audit 6.2): a +N to attack and damage, or to AC, read from the text; the AC counts it when worn", () => {
  assert.deepEqual(R.enhancedBonus("You have a +2 bonus to attack and damage rolls with this enhanced weapon."), { hit: 2, dmg: 2 });
  assert.deepEqual(R.enhancedBonus("You have a +1 bonus to attack rolls made with it."), { hit: 1 });
  assert.deepEqual(R.enhancedBonus("You have a +3 bonus to AC while wearing this armor."), { ac: 3 });
  assert.equal(R.enhancedBonus("Resistance to one type of damage."), null);
  assert.equal(R.cleanBonus({ hit: 9, ac: "x", dmg: 0 }), null);
  const c = { abilities: { dex: 14 }, classes: [{ name: "Fighter", level: 1 }], equipment: [
    { name: "Combat suit", equipped: true, armor: { kind: "light", ac: 11 } },
    { name: "Armor (Fine)", equipped: true, bonus: { ac: 1 } },
    { name: "Shield (Fine)", equipped: true, att: true, bonus: { ac: 2 } },      // needs attunement, not attuned: no bonus
    { name: "Armor (Superior)", equipped: false, bonus: { ac: 3 } } ] };        // not worn
  assert.deepEqual(R.armorClass(c), { total: 14, text: "Combat suit (light) 13 · Armor (Fine) +1" });
  c.equipment[2].attuned = true;
  assert.equal(R.armorClass(c).total, 16);
});

test("item modification (audit 6.4): chassis kinds, slots by rarity, what fits, the DC, and the chassis's own +N", () => {
  assert.deepEqual(["Blaster Chassis (Premium)", "Tunic Chassis (Standard)", "Focus Generator Chassis (Advanced)", "Reinforced Chassis (Premium)", "Blaster"].map(R.chassisKind),
    ["blaster", "clothing", "focus generator", null, null]);
  assert.deepEqual(["Standard", "Premium", "Prototype", "Advanced", "Legendary", "Artifact"].map((r) => R.modSlots(r).aug), [0, 0, 1, 1, 2, 2]);
  assert.deepEqual(["Standard", "Artifact", undefined].map(R.modDC), [10, 30, 10]);
  const chassis = (rar, mods = []) => ({ name: `Blaster Chassis (${rar})`, rar, chassis: { kind: "blaster", mods } });
  const mod = (name, kind, rar, extra) => Object.assign({ name, rar, mod: { kind } }, extra);
  assert.equal(R.installBlocked(chassis("Premium"), mod("Accuracy Focus Mk II", "blaster", "Premium")), null);
  assert.match(R.installBlocked(chassis("Premium"), mod("Edge", "vibroweapon", "Standard")), /a vibroweapon modification; Blaster Chassis \(Premium\) is a blaster chassis/);
  assert.match(R.installBlocked(chassis("Standard"), mod("Accuracy Focus Mk II", "blaster", "Premium")), /holds modifications up to Standard/);
  assert.match(R.installBlocked(chassis("Premium"), mod("Charisma Augment (Basic)", "augment", "Standard")), /has no augment slot/);
  assert.equal(R.installBlocked(chassis("Prototype"), mod("Charisma Augment (Basic)", "augment", "Standard")), null);
  assert.match(R.installBlocked(chassis("Legendary", [{ name: "Charisma Augment (Basic)", aug: true }]), mod("Charisma Augment (Basic)", "augment", "Standard")), /No two of the same augment/);
  const full = chassis("Premium", [1, 2, 3, 4].map((n) => ({ name: `M${n}` })));
  assert.match(R.installBlocked(full, mod("Accuracy Focus Mk II", "blaster", "Premium")), /No modification slot is free/);
  assert.match(R.installBlocked({ name: "Rock" }, mod("X", "blaster", "Standard")), /isn't a chassis/);
  // the chassis's own +N: its modifications' added up
  assert.deepEqual(R.chassisBonus(chassis("Premium", [{ name: "A", bonus: { hit: 1 } }, { name: "B", bonus: { hit: 1, dmg: 2 } }])), { hit: 2, dmg: 2 });
  assert.equal(R.chassisBonus(chassis("Premium", [{ name: "A" }])), null);
  // only this shape is kept
  assert.deepEqual(R.cleanChassis({ kind: "blaster", mods: [{ name: " A ", rar: "Premium", aug: 1, bonus: { hit: 9 } }, { name: "" }, "x"] }), { kind: "blaster", mods: [{ name: "A", rar: "Premium", aug: true }] });
  assert.equal(R.cleanChassis({ kind: "__proto__", mods: [] }), null);
  assert.deepEqual([R.cleanMod({ kind: "augment" }), R.cleanMod({ kind: "toaster" })], [{ kind: "augment" }, null]);
  assert.deepEqual(R.cleanChassis({ kind: "blaster", mods: [], att0: false }), { kind: "blaster", mods: [], att0: false });
  assert.deepEqual(R.cleanChassis({ kind: "blaster", mods: [], att0: "yes" }), { kind: "blaster", mods: [] });
});

test("installing and removing a modification (audit 6.4, #236's review): the list's order doesn't matter, and attunement goes back", () => {
  const barrel = () => ({ name: "Barrel Mod", qty: 1, rar: "Standard", mod: { kind: "blaster" }, bonus: { hit: 1 } });
  const chassis = () => ({ name: "Blaster Chassis (Premium)", qty: 1, rar: "Premium", chassis: { kind: "blaster", mods: [] } });
  const blade = () => ({ name: "Vibroblade +2", qty: 1, bonus: { hit: 2, dmg: 2 }, att: false, chassis: { kind: "vibroweapon", mods: [] } });
  // the modification listed above the chassis, and another chassis after it: the right one gets it, and the other is untouched
  const c = { equipment: [barrel(), chassis(), blade()] };
  assert.equal(R.installMod(c, 1, 0), null);
  assert.deepEqual(c.equipment.map((e) => e.name), ["Blaster Chassis (Premium)", "Vibroblade +2"]);
  assert.deepEqual(c.equipment[0].chassis.mods, [{ name: "Barrel Mod", rar: "Standard", bonus: { hit: 1 } }]);
  assert.deepEqual([c.equipment[0].bonus, c.equipment[0].att], [{ hit: 1 }, true]);
  assert.deepEqual(c.equipment[1], blade());
  // listed below it: the same
  const d = { equipment: [chassis(), barrel()] };
  assert.equal(R.installMod(d, 0, 1), null);
  assert.deepEqual([d.equipment.length, d.equipment[0].bonus], [1, { hit: 1 }]);
  // two in the pack: one goes in, one stays
  const e = { equipment: [Object.assign(barrel(), { qty: 2 }), chassis()] };
  assert.equal(R.installMod(e, 1, 0), null);
  assert.deepEqual([e.equipment[0].qty, e.equipment[1].chassis.mods.length], [1, 1]);
  // what doesn't fit is refused, and nothing moves
  const f = { equipment: [barrel(), blade()] };
  assert.match(R.installMod(f, 1, 0), /a blaster modification/);
  assert.equal(f.equipment.length, 2);
  // salvaged: back in the pack, and the chassis needs no attunement again; destroyed: gone
  assert.equal(R.removeMod(c, 0, 0, true), null);
  assert.deepEqual([c.equipment[0].chassis.mods, c.equipment[0].bonus, c.equipment[0].att, "att0" in c.equipment[0].chassis], [[], undefined, undefined, false]);
  assert.deepEqual(c.equipment[2], { name: "Barrel Mod", qty: 1, equipped: false, notes: "Standard modification", rar: "Standard", mod: { kind: "blaster" }, bonus: { hit: 1 } });
  assert.equal(R.removeMod(d, 0, 0, false), null);
  assert.deepEqual(d.equipment.map((x) => x.name), ["Blaster Chassis (Premium)"]);
  // a chassis that needed attunement anyway still does with everything out
  const g = { equipment: [Object.assign(chassis(), { att: true }), barrel()] };
  R.installMod(g, 0, 1); R.removeMod(g, 0, 0, false);
  assert.equal(g.equipment[0].att, true);
  assert.match(R.removeMod(g, 0, 0, true), /gone/);
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

test("senses: species traits read as senses; the GM's typing parsed; only the four kinds", () => {
  assert.deepEqual(R.sensesFromTraits([{ n: "Superior Darkvision", d: "within 120 feet" }, { n: "Speed", d: "30 feet" }]), [{ kind: "darkvision", range: 120 }]);
  assert.deepEqual(R.sensesFromTraits([{ n: "Montral Reception", d: "You have tremorsense out to 30 feet." }]), [{ kind: "tremorsense", range: 30 }]);
  assert.deepEqual(R.parseSenses("darkvision 60, Blindsight 30 ft; xray 10"), [{ kind: "darkvision", range: 60 }, { kind: "blindsight", range: 30 }]);
  assert.deepEqual(R.cleanSenses([{ kind: "truesight", range: 99999 }, { kind: "darkvision", range: 0 }]), [{ kind: "truesight", range: 9999 }]);
  assert.equal(R.sensesText([{ kind: "darkvision", range: 60 }, { kind: "blindsight", range: 10 }]), "Darkvision 60 ft · Blindsight 10 ft");
});

test("ability scores (audit 1.4): SW5e's standard set, and point buy's 27 points from 8 to 15", () => {
  assert.deepEqual(R.STANDARD_ARRAY, [15, 14, 13, 12, 10, 8]);
  assert.deepEqual(R.POINT_COST, { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 });
  assert.equal(R.POINT_BUDGET, 27);
  const sc = (str, dex, con, int, wis, cha) => ({ str, dex, con, int, wis, cha });
  assert.equal(R.pointBuyCost(sc(15, 15, 15, 8, 8, 8)), 27, "the PHB's three high, three low example");
  assert.equal(R.pointBuyCost(sc(13, 13, 13, 12, 12, 12)), 27, "and its nearly equal example");
  assert.equal(R.pointBuyCost(sc(8, 8, 8, 8, 8, 8)), 0);
  assert.equal(R.pointBuyCost(sc(16, 8, 8, 8, 8, 8)), Infinity, "above 15 can't be bought");
  assert.equal(R.pointBuyCost(sc(7, 8, 8, 8, 8, 8)), Infinity, "nor below 8");
  assert.ok(R.usesEachOnce(sc(8, 15, 12, 13, 10, 14), R.STANDARD_ARRAY), "the PHB's Han Solo placement");
  assert.ok(!R.usesEachOnce(sc(15, 15, 12, 13, 10, 8), R.STANDARD_ARRAY), "a number used twice");
  assert.ok(R.usesEachOnce(sc(9, 17, 12, 12, 6, 14), [17, 14, 12, 12, 9, 6]), "rolled numbers, repeats allowed once each");
  assert.ok(!R.usesEachOnce(sc(9, 17, 12, 12, 6, 14), [17, 14, 12, 9, 6]), "five numbers for six abilities");
});

test("downtime spend (audit 11.1): days from the balance, credits never below zero, a log entry", () => {
  const D = require("../api/_holotable-downtime.js");
  class Invalid extends Error {}
  const h = { Invalid };
  const ch = { name: "Kira", credits: 100, downtime: { days: 7, log: [] } };
  const e = D.spend(ch, { act: "work", days: 5, cr: 55, text: "Earned 55 cr" }, h, 1000);
  assert.deepEqual([ch.downtime.days, ch.credits, e.act, e.days, e.cr, e.at], [2, 155, "work", 5, 55, 1000]);
  assert.equal(ch.downtime.log.length, 1);
  assert.throws(() => D.spend(ch, { act: "crafting", days: 3 }, h), Invalid, "only 2 days left");
  assert.throws(() => D.spend(ch, { act: "carousing", days: 1, cr: -200 }, h), Invalid, "155 cr, not 200");
  assert.throws(() => D.spend(ch, { act: "__proto__", days: 1 }, h), Invalid);
  D.spend(ch, { act: "crafting", days: 2, cr: -150, text: "Vibroblade, 2 of 4 days" }, h);
  assert.deepEqual([ch.downtime.days, ch.credits, ch.downtime.log.map((x) => x.act)], [0, 5, ["work", "crafting"]]);
  assert.equal(D.clean({ days: -5, log: [{ act: "x y" }, null, { act: "work", days: 99999 }] }).log.length, 1);
  assert.equal(D.clean({ days: 0, log: [] }), undefined);
});

test("level-up choice counts come from the class table (audit 2.9)", () => {
  const at = (c, L) => Object.fromEntries(R.choiceCounts(c, L).map((x) => [x.col, [x.kind, x.prev, x.total]]));
  // SW5e's Operative: "You've adopted two exploits ... You adopt an additional exploit at 7th, 13th, and 17th level."
  assert.deepEqual(at("Operative", 2), { "Operative Exploits": ["opts", 0, 2] });
  assert.deepEqual(at("Operative", 6), { "Operative Exploits": ["opts", 2, 2] });
  assert.deepEqual(at("Operative", 7), { "Operative Exploits": ["opts", 2, 3] });
  assert.deepEqual(at("operative", 17)["Operative Exploits"], ["opts", 4, 5], "any case");
  assert.deepEqual(at("Fighter", 3), { "Maneuvers Known": ["maneuvers", 1, 2], "Strategies Known": ["opts", 0, 1] });
  assert.deepEqual(at("Consular", 2)["Force Powers Known"], ["powers", 9, 11]);
  assert.deepEqual(at("Monk", 1), {}, "nothing counted yet");
  assert.deepEqual(R.choiceCounts("Jedi", 3), []);
  assert.deepEqual(R.choiceCounts("Fighter", 0), []);
});

test("downtime activities (audit 11.1): Wretched Hives' tables, parsed, and a roll resolved by them", () => {
  const D = require("../api/_holotable-downtime.js"), L = require("../api/_holotable-sw5e-data.js");
  const md = ["# Chapter 2: Entertainment and Downtime", "", "## Rivals", "Not an activity.", "",
    "## Work", "When all else fails.", "", "### Resources", "Taking on a job requires one workweek of work.", "", "### Resolution ", "Make a check.", "",
    "##### Work Roll Modifier", "|Ability Check DC|d100 Roll Modifier|", "|:--:|:--:|", "|10|+5|", "|15|+10|", "|20|+15|", "",
    "##### Work Results", "|d100|Result|", "|:--:|:--|", "|40 or lower  |Poor, with 10 cr left over.|", "|41-70        |Modest, with 50 cr left over.|", "|71 or higher|Comfortable.|", "",
    "### Complications", "A character spending a week working has a 10 percent chance of triggering a complication.", "",
    "##### Work Complications", "|d8|Complication|", "|:--:|:--|", "|1|A rival.|", "|2|A [scar](#x).|", "",
    "### Uptime", "##### Work Results (Uptime)", "|AbilityCheck DC|Result|", "|:--:|:--|", "|10|Not this one.|", "",
    "## Buying Enhanced Items", "Purchasing.", "### Resources", "Five days and 1,000 cr.", "### Resolution", "An Investigation check.",
    "##### Purchasable Enhanced Items", "|Rarity|DC to Find Seller|d100 Roll Modifier|", "|:--:|:--:|:--:|", "|Standard|10|+10|", "|Premium|15|+0|", "|Prototype|20|-10|", "",
    "##### Buying an Enhanced Item", "|d100|Result|", "|:--:|:--|", "|40 or lower|Nothing good.|", "|41 or higher|A fair deal.|"].join("\r\n");
  const acts = L.LISTS.downtime.build([{ chapterName: "Entertainment and Downtime", contentMarkdown: md }, { chapterName: "Equipment", contentMarkdown: "## Work\nnope" }]);
  assert.deepEqual(acts.map((a) => a.key), ["work", "buying-enhanced-items"], "Rivals isn't an activity; only chapter 2");
  const work = acts[0];
  assert.deepEqual(work.mods, [{ dc: 10, mod: 5 }, { dc: 15, mod: 10 }, { dc: 20, mod: 15 }]);
  assert.deepEqual(work.results.map((r) => [r.lo, r.hi]), [[-999, 40], [41, 70], [71, 999]], "the uptime table isn't read");
  assert.deepEqual([work.complPct, work.dieN, work.compls], [10, 8, ["A rival.", "A scar."]]);
  assert.equal(work.resources, "Taking on a job requires one workweek of work.");
  assert.equal(work.resolution, "Make a check.", "a heading with a trailing space");
  // Athletics 17 meets DC 15: +10; d100 52 + 10 = 62: modest
  assert.deepEqual(D.resolve(work, 17, 52, 0), { text: "Modest, with 50 cr left over.", mod: 10, final: 62, label: undefined });
  assert.equal(D.resolve(work, 7, 30, 0).final, 30, "below DC 10: no modifier");
  assert.equal(D.resolve(work, 25, 60, 5).text, "Comfortable.", "the GM's extra counts");
  const buy = acts[1];
  assert.deepEqual(buy.mods.map((m) => [m.dc, m.mod, m.label]), [[10, 10, "Standard"], [15, 0, "Premium"], [20, -10, "Prototype"]]);
  assert.equal(D.resolve(buy, 8, 99, 0).text, "No seller found this time.");
  assert.deepEqual([D.resolve(buy, 22, 45, 0).label, D.resolve(buy, 22, 45, 0).final, D.resolve(buy, 22, 45, 0).text], ["Prototype", 35, "Nothing good."]);
  assert.deepEqual(D.checkOf({ what: "skill", key: "athletics" }), { what: "skill", key: "athletics", name: "Athletics" });
  assert.equal(D.checkOf({ what: "skill", key: "__proto__" }), null);
  assert.equal(D.checkOf({ what: "save", key: "str" }), null);
});

test("Sage Advice (3.9): once from Scholar 2, back on a long rest, and on a short rest from 13th level", () => {
  const c = char([["Scholar", 1]]);
  assert.ok(!R.missingClassResources(c).some((p) => p.key === "sage-advice"), "not at 1st level");
  c.classes[0].level = 2;
  c.resources = R.withClassResources(c);
  let row = R.resourceRows(c).find((r) => r.key === "sage-advice");
  assert.deepEqual([row.max, row.refill], [1, "long"]);
  assert.equal(c.resources.find((r) => r.key === "sage-advice").refill, "long", "stored as a word the server keeps");
  c.classes[0].level = 13;   // no re-adding needed: the refill follows the level
  row = R.resourceRows(c).find((r) => r.key === "sage-advice");
  assert.equal(row.refill, "short");
  assert.equal(R.refillOf(c, { key: "lucky", refill: "manual" }), "manual", "a player's own resource keeps its own");
});

test("Wretched Hives' proficiency tiers (5.7), tool checks (6.10) and the tech focus (4.8)", () => {
  const c = char([["Operative", 5]]);   // proficiency +3
  c.abilities = { dex: 16, int: 14 };
  const tiers = [0.5, 1, 2, 3, 4, 5].map((lv) => { c.skills = { stealth: lv }; return [R.skillBonus(c, "stealth"), R.skillRollExpr(c, "stealth").expr, R.skillRollExpr(c, "stealth").tier]; });
  assert.deepEqual(tiers, [[4, "1d20+4", undefined], [6, "1d20+6", undefined], [9, "1d20+9", undefined],
    [9, "2d20kh1+9", "mastery"], [9, "3d20kh1+9", "high mastery"], [9, "3d20kh1+9", "grand mastery"]]);
  c.classes[0].level = 11;   // Reliable Talent keeps its floor at every tier
  assert.equal(R.skillRollExpr(c, "stealth").expr, "3d20kh1min8+11");
  c.equipment = [{ name: "Slicer's kit" }, { name: "Blaster pistol" }];
  c.proficiencies = "Light armor, Security kit; Slicer's kit";
  assert.deepEqual(R.toolNames(c), ["Slicer's kit", "Security kit"]);
  assert.equal(R.toolTierFromText(c, "slicer's KIT"), 1);
  assert.equal(R.toolTierFromText(c, "Demolitions kit"), 0);
  assert.equal(R.toolBonus(c, "int", 2, 1), 2 + 8 + 1);
  assert.equal(R.checkRollExpr(c, 0, 2).expr, "1d20+2", "no Reliable Talent without proficiency");
  assert.equal(R.hasTechFocus(c), false);
  c.equipment.push({ name: "Wristpad" });
  assert.equal(R.hasTechFocus(c), true);
});

test("feat prerequisites (audit 2.5), read from SW5e's own wording", () => {
  const ch = { classes: [{ name: "Fighter", level: 3 }], abilities: { str: 14, dex: 13, con: 12, int: 10, wis: 10, cha: 8 }, features: [{ name: "Lucky" }], size: "Medium" };
  const pr = (c, p) => R.featPrereq(c, p);
  assert.deepEqual(pr(ch, "None"), { ok: true, unmet: [], unknown: [] });
  assert.deepEqual(pr(ch, "4th level").unmet, ["4th level"]);
  assert.equal(pr(Object.assign({}, ch, { classes: [{ name: "Fighter", level: 4 }] }), "4th level, Lucky feat").ok, true);
  assert.deepEqual(pr(ch, "4th level, Durable feat").unmet, ["4th level", "the Durable feat"]);
  assert.deepEqual(pr(ch, "4th level; Dexterity, Intelligence, Wisdom, or Charisma 13").unmet, ["4th level"], "any one of the four at 13: Dex 13 counts");
  assert.deepEqual(pr(ch, "Charisma 13").unmet, ["Charisma 13"]);
  assert.equal(pr(ch, "Strength 13, size Medium").ok, true);
  assert.deepEqual(pr(ch, "Strength 13, size Small").unmet, ["size Small"]);
  assert.deepEqual(pr({ classes: [], abilities: { str: 13 } }, "Strength 13, size Small"), { ok: null, unmet: [], unknown: ["size Small"] }, "no size on the sheet: unknown");
  assert.deepEqual(pr(ch, "Type droid"), { ok: null, unmet: [], unknown: ["type droid"] }, "the GM's call");
  const con = { classes: [{ name: "Consular", level: 5 }], abilities: { wis: 16 } };
  assert.equal(pr(con, "The ability to cast 3rd-level force powers").ok, true, "a Consular 5 casts 3rd-level powers");
  assert.equal(pr(con, "The ability to cast 4th-level force powers").ok, false);
  assert.equal(pr(con, "The ability to cast tech powers").ok, false);
  assert.equal(pr(ch, "4th level, the ability to cast force or tech powers").unmet.length, 2);
  assert.deepEqual(pr(ch, "12th level, Dexterity 20").unmet, ["12th level", "Dexterity 20"]);
});
