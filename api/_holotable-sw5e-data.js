// The rest of the SW5e books, as lists the HoloTable pickers, rules library, monster picker and
// starship sheets use. Each entry names one fixed SW5e API path and a function that trims a reply to
// the fields we show, with every string length-limited. Fetching, size caps, one-fetch-at-a-time and
// failure caching are all handled by sw5eList() in holotable.js; nothing here talks to the network.
//
// Books covered (contentSource in SW5e's data): Player's Handbook (PHB), Expanded Content (EC),
// Wretched Hives (WH), Scum and Villainy (SnV), Starships of the Galaxy (SotG), and the Variant Rules.

const CR = String.fromCharCode(13);
const t = (v, n) => (v == null || v === "None" || v === "Unknown" ? "" : String(v).split(CR).join("").slice(0, n));
const int = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || 0));
const num = (v) => (Number.isFinite(+v) ? +v : null);
const arr = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x != null).map(fn) : []);
const strs = (v, max, n) => arr(v, max, (x) => t(x, n)).filter(Boolean);
const named = (d) => (Array.isArray(d) ? d.filter((e) => e && typeof e === "object" && e.name) : []);
const byName = (a, b) => a.n.localeCompare(b.n);
// SW5e's rule text links to its own anchors ("[Rage](#Rage)"): keep the words, drop the link
const unlink = (s) => String(s || "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");

const ABIL = { Strength: "str", Dexterity: "dex", Constitution: "con", Intelligence: "int", Wisdom: "wis", Charisma: "cha" };
// A species' ability score increase, when it's one fixed choice (e.g. +2 Int, +1 Dex); null when the
// player chooses ("Any one", or several options), so the sheet doesn't guess.
function fixedAsi(opts) {
  if (!Array.isArray(opts) || opts.length !== 1 || !Array.isArray(opts[0])) return null;
  const out = {};
  for (const o of opts[0]) {
    const ab = o && Array.isArray(o.abilities) && o.abilities.length === 1 ? ABIL[o.abilities[0]] : null;
    if (!ab) return null;
    out[ab] = (out[ab] || 0) + int(o.amount, -5, 5);
  }
  return Object.keys(out).length ? out : null;
}

function species(d) {
  return named(d).map((e) => ({
    n: t(e.name, 60), src: t(e.contentSource, 10), size: t(e.size, 20), lang: t(e.language, 200), home: t(e.homeworld, 80),
    dist: t(e.distinctions, 200),
    traits: arr(e.traits, 30, (x) => ({ n: t(x && x.name, 80), d: t(x && x.description, 2500) })).filter((x) => x.n),
    asi: fixedAsi(e.abilitiesIncreased),
  })).sort(byName);
}
function archetypes(d) {
  return named(d).map((e) => ({
    n: t(e.name, 60), cls: t(e.className, 40), src: t(e.contentSource, 10), cast: t(e.casterType, 20),
    text: t(unlink(e.text), 1500),
  })).sort((a, b) => a.cls.localeCompare(b.cls) || a.n.localeCompare(b.n));
}
function backgrounds(d) {
  return named(d).map((e) => ({
    n: t(e.name, 60), src: t(e.contentSource, 10), skills: t(e.skillProficiencies, 200), tools: t(e.toolProficiencies, 200),
    langs: t(e.languages, 200), equip: t(e.equipment, 600), feature: t(e.featureName, 80), featureText: t(unlink(e.featureText), 3000),
    feats: arr(e.featOptions, 12, (x) => t(x && x.name, 60)).filter(Boolean),
  })).sort(byName);
}
// A class's 1st-level build data (audit 1.3, 1.7): hit die and 1st-level hit points, the two saving throws, how many
// skills and from which list ("Any" means every skill), proficiencies, and the starting equipment lines.
function classes(d) {
  const none = (v) => !/^none$/i.test(String(v || "").trim());
  return named(d).map((e) => ({
    n: t(e.name, 40), src: t(e.contentSource, 10), sum: t(e.summary, 200), primary: t(e.primaryAbility, 60),
    hd: int(e.hitDiceDieType, 4, 12), hp1: int(e.hitPointsAtFirstLevelNumber, 1, 20),
    saves: arr(e.savingThrows, 2, (x) => ABIL[x] || "").filter(Boolean),
    nSkills: int(e.numSkillChoices, 0, 6), skills: strs(e.skillChoicesList, 20, 40),
    armor: strs(e.armorProficiencies, 10, 80).filter(none), weapons: strs(e.weaponProficiencies, 10, 80).filter(none),
    tools: strs(e.toolProficiencies, 10, 120).filter(none), equip: strs(e.equipmentLines, 12, 300), wealth: t(e.startingWealthVariant, 40),
    lv: levelFeatureNames(e.levelChanges), opts: classOptions(e.classFeatureText),
  })).sort(byName);
}
// The Features column of a class's table, level 1 to 20 ("Expertise, Sneak Attack"): the level-up wizard reads it for
// the choices a feature brings at a level the feature list files under its first level (Expertise at Operative 6).
function levelFeatureNames(lc) {
  if (!lc || typeof lc !== "object") return [];
  return Array.from({ length: 20 }, (_, i) => t(lc[String(i + 1)] && lc[String(i + 1)].Features, 200)).map((x) => (/[a-z]/i.test(x) ? x : ""));
}
// The options a class picks from as it levels (Berserker Instincts, Monastic Vows, Operative Exploits, Fighter
// Strategies...): the last "### " section of the class's text, one "#### " heading per option, with any
// "Prerequisite: 7th level" as a number (audit 2.9).
function classOptions(text) {
  const s = String(text || "").split(CR).join(""), at = s.lastIndexOf("\n### ");
  if (at < 0) return null;
  const [head, ...parts] = s.slice(at + 5).split(/\n#### /);
  if (!parts.length) return null;
  const items = parts.slice(0, 40).map((part) => {
    const nl = part.indexOf("\n"), n = t(part.slice(0, nl < 0 ? undefined : nl).trim(), 80), body = nl < 0 ? "" : part.slice(nl + 1).trim();
    const pre = /^_\*\*Prerequisite:\*\*\s*(\d+)(?:st|nd|rd|th) level_/i.exec(body);
    return { n, pre: pre ? int(pre[1], 0, 20) : 0, text: t(unlink(body), 2500) };
  }).filter((x) => x.n);
  return items.length ? { title: t(head.split("\n")[0].trim(), 60), items } : null;
}
function feats(d) {
  return named(d).map((e) => ({
    n: t(e.name, 80), src: t(e.contentSource, 10), pre: t(e.prerequisite, 160), text: t(unlink(e.text), 4000),
    asi: strs(e.attributesIncreased, 6, 20),
  })).sort(byName);
}
function maneuvers(d) {
  return named(d).map((e) => ({ n: t(e.name, 80), src: t(e.contentSource, 10), type: t(e.type, 20), pre: t(e.prerequisite, 160), text: t(unlink(e.description), 3000) })).sort(byName);
}
const simple = (field) => (d) => named(d).map((e) => ({ n: t(e.name, 80), src: t(e.contentSource, 10), text: t(unlink(e[field]), 4000) })).sort(byName);
// class and archetype features, by level (species traits come with the species list)
function features(d) {
  return named(d).filter((e) => e.source === "Class" || e.source === "Archetype").map((e) => ({
    n: t(e.name, 80), lvl: int(e.level, 0, 20), k: e.source === "Class" ? "class" : "archetype", of: t(e.sourceName, 60), text: t(unlink(e.text), 4000),
  })).sort((a, b) => a.of.localeCompare(b.of) || a.lvl - b.lvl || a.n.localeCompare(b.n));
}

// Scum and Villainy creatures: a stat block, with each trait/action's attack bonus and damage roll
const BEHAVIOR = { Trait: "trait", Action: "action", Reaction: "reaction", Legendary: "legendary", Bonus: "bonus" };
function monsters(d) {
  const ab = (e) => Object.fromEntries(Object.entries(ABIL).map(([full, k]) => [k, int(e[full.toLowerCase()], 1, 40)]));
  return named(d).map((e) => ({
    n: t(e.name, 80), src: t(e.contentSource, 10), size: t(e.size, 20), types: strs(e.types, 4, 30), align: t(e.alignment, 40),
    ac: num(e.armorClass), at: t(e.armorType, 60), hp: num(e.hitPoints), hpr: t(e.hitPointRoll, 30), speed: t(e.speeds, 120),
    ab: ab(e), saves: strs(e.savingThrows, 6, 30), skills: strs(e.skills, 18, 40),
    imm: strs([].concat(e.damageImmunities || [], e.damageImmunitiesOther || []), 12, 60),
    res: strs([].concat(e.damageResistances || [], e.damageResistancesOther || []), 12, 60),
    vul: strs([].concat(e.damageVulnerabilities || [], e.damageVulnerabilitiesOther || []), 12, 60),
    cimm: strs([].concat(e.conditionImmunities || [], e.conditionImmunitiesOther || []), 12, 40),
    senses: strs(e.senses, 8, 60), langs: strs(e.languages, 10, 80), cr: t(e.challengeRating, 8), xp: num(e.experiencePoints),
    flavor: t(unlink(e.flavorText), 1200),
    b: arr(e.behaviors, 40, (x) => ({
      n: t(x && x.name, 80), k: BEHAVIOR[x && x.monsterBehaviorType] || "trait",
      d: t(unlink((x && (x.descriptionWithLinks || x.description)) || "").trim(), 2500),
      atk: x && x.attackType && x.attackType !== "None" ? int(x.attackBonus, -10, 40) : null,
      dmg: t(x && x.damageRoll, 40), dt: t(x && x.damageType, 20).toLowerCase(), rng: t(x && x.range, 60),
      r: t(x && x.restrictions, 60),   // "Recharge 5-6", "3/Day", "Recharges after a Short or Long Rest" (the combat view counts them, #76)
    })).filter((x) => x.n),
  })).sort(byName);
}

// A book's chapters (markdown), in chapter order
function chapters(d) {
  return (Array.isArray(d) ? d : []).filter((e) => e && e.chapterName && e.contentMarkdown).map((e) => ({
    n: t(e.chapterName, 80), num: int(e.chapterNumber, -5, 99), md: t(e.contentMarkdown, 600000),
  })).sort((a, b) => a.num - b.num || a.n.localeCompare(b.n));
}
const entries = (field) => (d) => named(d).map((e) => ({ n: t(e.name, 80), md: t(e[field], 20000) })).sort(byName);

// Starships of the Galaxy
function shipEquipment(d) {
  return named(d).map((e) => {
    const dice = int(e.damageNumberOfDice, 0, 40), die = int(e.damageDieType, 0, 100), mod = int(e.damageDieModifier, -40, 40);
    return {
      n: t(e.name, 80), src: t(e.contentSource, 10), type: t(e.type, 30), cost: num(e.cost),
      wcat: t(e.weaponCategory, 30), wsize: t(e.weaponSize, 20),
      dmg: dice && die ? `${dice}d${die}${mod ? (mod > 0 ? "+" : "") + mod : ""}` : "", dt: t(e.damageType, 20).toLowerCase(),
      atk: int(e.attackBonus, -10, 40), apr: int(e.attacksPerRound, 0, 20),
      rng: e.shortRange || e.longRange ? `${int(e.shortRange, 0, 1e6)}/${int(e.longRange, 0, 1e6)}` : "", reload: int(e.reload, 0, 1000),
      props: t(Array.isArray(e.properties) ? e.properties.join(", ") : e.properties, 300),
      acb: int(e.armorClassBonus, -10, 20), hyper: t(e.hyperDriveClass, 10), desc: t(unlink(e.description), 2000),
    };
  }).sort((a, b) => a.type.localeCompare(b.type) || a.n.localeCompare(b.n));
}
function shipMods(d) {
  return named(d).map((e) => ({
    n: t(e.name, 80).toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (m, a, c) => a + c.toUpperCase()), src: t(e.contentSource, 10),
    type: t(e.type, 30), grade: int(e.grade, 0, 10), pre: strs(e.prerequisites, 6, 120).join("; "), md: t(unlink(e.content), 4000),
  })).sort((a, b) => a.type.localeCompare(b.type) || a.grade - b.grade || a.n.localeCompare(b.n));
}
function deployments(d) {
  return named(d).map((e) => ({
    n: t(e.name, 40), desc: t(e.description, 300), md: t(unlink(e.featureText), 8000),
    features: arr(e.features, 30, (x) => ({ n: t(x && x.name, 80), md: t(unlink(x && x.content), 4000) })).filter((x) => x.n),
  })).sort(byName);
}
function ventures(d) {
  return named(d).map((e) => ({ n: t(e.name, 80), src: t(e.contentSource, 10), pre: strs(e.prerequisites, 4, 120).join("; "), md: t(unlink(e.content), 4000) })).sort(byName);
}

const MB = 1024 * 1024;
// name -> { path (fixed SW5e API path), build, maxBytes (largest reply we'll read), maxItems }
// Today's raw sizes are noted; the caps leave room for growth without accepting anything huge.
const LISTS = {
  species: { path: "species", build: species, maxBytes: 4 * MB, maxItems: 600 },                  // 0.97 MB, 141
  archetypes: { path: "archetype", build: archetypes, maxBytes: 4 * MB, maxItems: 600 },           // 0.81 MB, 137
  backgrounds: { path: "background", build: backgrounds, maxBytes: 3 * MB, maxItems: 400 },        // 0.59 MB, 61
  classes: { path: "class", build: classes, maxBytes: 2 * MB, maxItems: 40 },                       // 0.24 MB, 10
  feats: { path: "feat", build: feats, maxBytes: 2 * MB, maxItems: 1000 },                         // 0.11 MB, 119
  maneuvers: { path: "maneuvers", build: maneuvers, maxBytes: 2 * MB, maxItems: 1000 },            // 0.07 MB, 119
  styles: { path: "fightingStyle", build: simple("description"), maxBytes: 1 * MB, maxItems: 400 }, // 32
  masteries: { path: "fightingMastery", build: simple("text"), maxBytes: 1 * MB, maxItems: 400 },  // 32
  forms: { path: "lightsaberForm", build: simple("description"), maxBytes: 1 * MB, maxItems: 300 }, // 20
  features: { path: "feature", build: features, maxBytes: 6 * MB, maxItems: 12000 },               // 1.74 MB, 2,723 (1,130 kept)
  monsters: { path: "monster", build: monsters, maxBytes: 8 * MB, maxItems: 2000, cacheAs: "monsters-2" },   // 2.59 MB, 271; cacheAs: a new shape (r) is a new cache
  "rules-phb": { path: "playerHandbookRule", build: chapters, maxBytes: 3 * MB, maxItems: 60 },    // 0.47 MB
  "rules-wh": { path: "wretchedHivesRule", build: chapters, maxBytes: 3 * MB, maxItems: 60 },      // 0.41 MB
  "rules-sotg": { path: "starshipRule", build: chapters, maxBytes: 3 * MB, maxItems: 60 },         // 0.27 MB
  "rules-ec": { path: "expandedContent", build: chapters, maxBytes: 6 * MB, maxItems: 60 },        // 1.79 MB
  "rules-variant": { path: "variantRule", build: chapters, maxBytes: 2 * MB, maxItems: 300 },      // 0.15 MB, 40
  tables: { path: "referenceTable", build: entries("content"), maxBytes: 1 * MB, maxItems: 300 },
  "weapon-props": { path: "weaponProperty", build: entries("content"), maxBytes: 1 * MB, maxItems: 300 },
  "armor-props": { path: "armorProperty", build: entries("content"), maxBytes: 1 * MB, maxItems: 300 },
  "ship-equipment": { path: "starshipEquipment", build: shipEquipment, maxBytes: 2 * MB, maxItems: 1500 },
  "ship-mods": { path: "starshipModification", build: shipMods, maxBytes: 2 * MB, maxItems: 1500 },
  deployments: { path: "starshipDeployment", build: deployments, maxBytes: 1 * MB, maxItems: 100 },
  ventures: { path: "starshipVenture", build: ventures, maxBytes: 1 * MB, maxItems: 600 },
};

module.exports = { LISTS, fixedAsi, unlink };
