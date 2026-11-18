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
// an ability's key from SW5e's full name, only for the six: never something every object inherits ("constructor")
const abil = (name) => (typeof name === "string" && Object.prototype.hasOwnProperty.call(ABIL, name) ? ABIL[name] : null);
// A species' ability score increase as choices (audit 1.6): one list per alternative (Human has two), each a list of
// grants { from, n, amount }: n different abilities from `from` (null: any ability) each go up by amount. A fixed
// grant is { from: ["con"], n: 1 }. SW5e's data writes "Strength or Dexterity" and "Strength, Constitution, and
// Intelligence" the same way (a list of names), so the species' own Ability Score Increase text decides: a list
// is a choice only where that text says "or" or "choice"; otherwise each named ability goes up.
const ANY = { "any one": 1, "any two": 2, "any three": 3, "any four": 4, "any other": 1 };
function asiChoices(opts, traits) {
  if (!Array.isArray(opts)) return null;
  const tr = (Array.isArray(traits) ? traits : []).find((x) => x && /ability score increase/i.test(String(x.name || "")));
  const choosy = /\bor\b|choice/i.test(String((tr && tr.description) || ""));
  const alts = opts.slice(0, 4).filter(Array.isArray).map((alt) => {
    const grants = [];
    for (const o of alt.slice(0, 6)) {
      const names = o && Array.isArray(o.abilities) ? o.abilities.slice(0, 6).map((x) => String(x)) : [], amount = int(o && o.amount, -5, 5);
      if (!names.length || !amount) continue;
      const any = names.length === 1 ? ANY[names[0].trim().toLowerCase()] : 0;
      if (any) { grants.push({ from: null, n: any, amount }); continue; }
      const keys = names.map(abil);
      if (keys.some((k) => !k)) return null;   // a name we don't know: no choice offered, the player types it
      if (keys.length > 1 && choosy) grants.push({ from: keys, n: 1, amount });
      else for (const k of keys) grants.push({ from: [k], n: 1, amount });
    }
    return grants.length ? grants : null;
  }).filter(Boolean);
  return alts.length ? alts : null;
}
// the increase when nothing is chosen: one alternative of fixed grants only
function fixedAsi(alts) {
  if (!alts || alts.length !== 1 || alts[0].some((g) => !g.from || g.from.length !== 1)) return null;
  const out = {};
  for (const g of alts[0]) out[g.from[0]] = (out[g.from[0]] || 0) + g.amount;
  return out;
}

function species(d) {
  return named(d).map((e) => ({
    n: t(e.name, 60), src: t(e.contentSource, 10), size: t(e.size, 20), lang: t(e.language, 200), home: t(e.homeworld, 80),
    dist: t(e.distinctions, 200),
    traits: arr(e.traits, 30, (x) => ({ n: t(x && x.name, 80), d: t(x && x.description, 2500) })).filter((x) => x.n),
    ...((alts) => ({ asi: fixedAsi(alts), asiChoices: fixedAsi(alts) ? null : alts }))(asiChoices(e.abilitiesIncreased, e.traits)),
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
    saves: arr(e.savingThrows, 2, (x) => abil(x) || "").filter(Boolean),
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
const improvements = (d) => named(d).map((e) => ({ n: t(e.name, 40), pre: t(e.prerequisite, 120), text: t(unlink(e.description), 3000) })).sort(byName);
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
// Wretched Hives' downtime activities (audit 11.1, #202), from its chapter 2, "Entertainment and Downtime". Each
// activity (a "## " heading, before its "### Uptime") has a Roll Modifier table (the ability check DC met gives a d100
// modifier), a d100 Results table, a complication chance ("a 10 percent chance") and a Complications table (dN). Buying,
// selling and crafting add a rarity table (its d100 modifier). Rivals isn't an activity, and crafting is 11.2's.
const cells = (line) => line.split("|").slice(1, -1).map((c) => c.trim());
function mdTable(md, title) {
  const at = md.search(new RegExp(`^#####\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"));
  if (at < 0) return null;
  const rows = md.slice(at).split("\n").slice(1).filter((l) => l.trim()).reduce((acc, l) => (acc.done || !l.trim().startsWith("|") ? Object.assign(acc, { done: acc.rows.length > 0 }) : (acc.rows.push(cells(l)), acc)), { rows: [], done: false }).rows;
  return rows.length > 2 ? { head: rows[0], rows: rows.slice(2) } : null;   // past the header and the |:--:| line
}
const range = (txt) => {   // "40 or lower", "41-70", "111 or higher", "05"
  const s = String(txt).replace(/\s+/g, " ").trim(), n = (x) => parseInt(x, 10);
  let m = /^(\d+) or (lower|less)$/i.exec(s); if (m) return [-999, n(m[1])];
  m = /^(\d+) or (higher|more)$/i.exec(s); if (m) return [n(m[1]), 999];
  m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(s); if (m) return [n(m[1]), n(m[2])];
  m = /^(\d+)$/.exec(s); if (m) return [n(m[1]), n(m[1])];
  return null;
};
function downtimeActs(d) {
  const ch = (Array.isArray(d) ? d : []).find((e) => e && /entertainment and downtime/i.test(String(e.chapterName || "")));
  const md = String((ch && ch.contentMarkdown) || "").split(CR).join("");
  return md.split(/\n## /).slice(1).map((part) => {
    const n = part.split("\n")[0].trim(), up = part.search(/\n### Uptime/), body = up > 0 ? part.slice(0, up) : part;
    if (!n || /^rivals$/i.test(n) || /^crafting$/i.test(n)) return null;
    const titles = [...body.matchAll(/^#####\s+(.+?)\s*$/gm)].map((m) => m[1]);
    const find = (re) => titles.find((x) => re.test(x));
    const modT = mdTable(body, find(/roll modifier$/i) || "\u0000"), resT = mdTable(body, find(/results$|^(buying|selling) an /i) || "\u0000");
    const compT = mdTable(body, find(/complications$/i) || "\u0000"), rarT = mdTable(body, find(/^(purchasable|salable) /i) || "\u0000");
    // the check's DC met gives the d100 modifier; for buying, the rarity table's "DC to Find Seller" does (with its rarity)
    const dcRarity = rarT && /dc/i.test(String(rarT.head[1] || ""));
    const mods = modT ? modT.rows.map((r) => ({ dc: int(r[0], 0, 99), mod: int(String(r[1]).replace("+", ""), -99, 99) })).filter((r) => r.dc > 0)
      : dcRarity ? rarT.rows.map((r) => ({ dc: int(r[1], 0, 99), mod: int(String(r[2]).replace("+", ""), -99, 99), label: t(r[0], 20) })).filter((r) => r.dc > 0) : [];
    const results = resT ? resT.rows.map((r) => [range(r[0]), t(unlink(r[1]), 400)]).filter((r) => r[0] && r[1]).map(([[lo, hi], text]) => ({ lo, hi, text })) : [];
    const dieN = compT ? int(String(compT.head[0]).replace(/^d/i, ""), 0, 100) : 0;
    const compls = compT ? compT.rows.map((r) => t(unlink(r[1]), 400)).filter(Boolean).slice(0, 20) : [];
    const rarity = rarT && !dcRarity ? rarT.rows.map((r) => ({ r: t(r[0], 20), note: t(r[1], 30), mod: int(String(r[r.length - 1]).replace("+", ""), -99, 99) })).slice(0, 8) : [];
    const pct = /(\d+) percent chance/i.exec(body);
    const key = n.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    const section = (h) => { const m = new RegExp(`### ${h}[ \\t]*\\n([\\s\\S]*?)(?=\\n#{2,5} |$)`).exec(body); return m ? t(unlink(m[1].trim()), 1500) : ""; };
    return { key, n: t(n, 40), resources: section("Resources"), resolution: section("Resolution"), mods, results, complPct: pct ? int(pct[1], 0, 100) : 0, dieN, compls, rarity };
  }).filter((a) => a && a.results.length);
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
    n: t(e.name, 40), desc: t(e.description, 300), md: t(unlink(e.featureText), 12000),   // the longest (Operator) is about 8,900: all its techniques
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
  species: { path: "species", build: species, maxBytes: 4 * MB, maxItems: 600, cacheAs: "species-2" },   // 0.97 MB, 141; species-2: asiChoices (1.6)
  archetypes: { path: "archetype", build: archetypes, maxBytes: 4 * MB, maxItems: 600 },           // 0.81 MB, 137
  backgrounds: { path: "background", build: backgrounds, maxBytes: 3 * MB, maxItems: 400 },        // 0.59 MB, 61
  classes: { path: "class", build: classes, maxBytes: 2 * MB, maxItems: 40, cacheAs: "classes-2" },   // 0.24 MB, 10; classes-2: lv and opts (2.9, #188)
  feats: { path: "feat", build: feats, maxBytes: 2 * MB, maxItems: 1000 },                         // 0.11 MB, 119
  // the options the Class, Multiclass and Splashclass Improvement feats open (audit 2.17), one per class
  "improvements-class": { path: "classImprovement", build: improvements, maxBytes: 1 * MB, maxItems: 40 },
  "improvements-multi": { path: "multiclassImprovement", build: improvements, maxBytes: 1 * MB, maxItems: 40 },
  "improvements-splash": { path: "splashclassImprovement", build: improvements, maxBytes: 1 * MB, maxItems: 40 },
  maneuvers: { path: "maneuvers", build: maneuvers, maxBytes: 2 * MB, maxItems: 1000 },            // 0.07 MB, 119
  styles: { path: "fightingStyle", build: simple("description"), maxBytes: 1 * MB, maxItems: 400 }, // 32
  masteries: { path: "fightingMastery", build: simple("text"), maxBytes: 1 * MB, maxItems: 400 },  // 32
  forms: { path: "lightsaberForm", build: simple("description"), maxBytes: 1 * MB, maxItems: 300 }, // 20
  features: { path: "feature", build: features, maxBytes: 6 * MB, maxItems: 12000 },               // 1.74 MB, 2,723 (1,130 kept)
  monsters: { path: "monster", build: monsters, maxBytes: 8 * MB, maxItems: 2000, cacheAs: "monsters-2" },   // 2.59 MB, 271; cacheAs: a new shape (r) is a new cache
  "rules-phb": { path: "playerHandbookRule", build: chapters, maxBytes: 3 * MB, maxItems: 60 },    // 0.47 MB
  "rules-wh": { path: "wretchedHivesRule", build: chapters, maxBytes: 3 * MB, maxItems: 60 },      // 0.41 MB
  downtime: { path: "wretchedHivesRule", build: downtimeActs, maxBytes: 3 * MB, maxItems: 40 },    // 13 activities (11.1)
  "rules-sotg": { path: "starshipRule", build: chapters, maxBytes: 3 * MB, maxItems: 60 },         // 0.27 MB
  "rules-ec": { path: "expandedContent", build: chapters, maxBytes: 6 * MB, maxItems: 60 },        // 1.79 MB
  "rules-variant": { path: "variantRule", build: chapters, maxBytes: 2 * MB, maxItems: 300 },      // 0.15 MB, 40
  tables: { path: "referenceTable", build: entries("content"), maxBytes: 1 * MB, maxItems: 300 },
  "weapon-props": { path: "weaponProperty", build: entries("content"), maxBytes: 1 * MB, maxItems: 300 },
  "armor-props": { path: "armorProperty", build: entries("content"), maxBytes: 1 * MB, maxItems: 300 },
  "ship-equipment": { path: "starshipEquipment", build: shipEquipment, maxBytes: 2 * MB, maxItems: 1500 },
  "ship-mods": { path: "starshipModification", build: shipMods, maxBytes: 2 * MB, maxItems: 1500 },
  deployments: { path: "starshipDeployment", build: deployments, maxBytes: 1 * MB, maxItems: 100, cacheAs: "deployments2" },   // 2: the full text (was cut at 8,000)
  ventures: { path: "starshipVenture", build: ventures, maxBytes: 1 * MB, maxItems: 600 },
};

module.exports = { LISTS, fixedAsi, unlink };
