// HoloTable (jpesus's Star Wars 5e table): the game rules on the server. Pure functions, no storage,
// so they are easy to test. Not a route: the underscore keeps Vercel from serving it.
//
// The table is one JSON document (one game for the group). applyAction(camp, playerId, isGM, type,
// payload) changes it in place and returns a small result; viewFor() is what one person may see.
// Who is the GM is decided by the caller from the signed session, never from anything in here.
// Players never get GM notes, hidden NPCs, NPC hit points or other people's whispers.

const crypto = require("crypto");
const Fight = require("./_holotable-fight.js");   // the combat view (fight.*), off until the GM switches it on
const Ships = require("./_holotable-ships.js");   // a ship in a fight (ship.damage, destruction saves, ship conditions): Starships of the Galaxy
const Space = require("./_holotable-space.js");   // the space map (space.*): ship fights on their own map, jpesus's call on #146
const Ask = require("./_holotable-ask.js");   // the GM asking for a roll (audit 9.12)
const Downtime = require("./_holotable-downtime.js");   // downtime days and their log (audit 11.1, #202)
const Craft = require("./_holotable-craft.js");         // crafting (audit 11.2, #167): its requests, the GM's to approve
const Story = require("./_holotable-story.js");   // factions, rivals and lifestyle between fights (audit section 11)
const R = globalThis.SW5E;   // rules.js, loaded by the fight module (senses)

const CHAT_LIMIT = 400;
const rid = (n = 10) => crypto.randomBytes(16).toString("hex").slice(0, n);
const now = () => Date.now() / 1000;
const str = (v, max) => String(v == null ? "" : v).slice(0, max);
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

class Forbidden extends Error {}
class Invalid extends Error {}

// ---------------------------------------------------------------- dice
const MAX_DICE = 300;
const TERM = /([+-]?)\s*(?:(\d*)d(\d+)(?:(kh|kl|k|dh|dl)(\d+))?(?:min(\d+))?(!)?|(\d+))/iy;

// Roll "2d20kh1+5", "1d8+1d6-2", "4d6dl1", "1d6!", "1d12min5". nat = the kept d20 when there is exactly one d20 term.
// min N: a die that rolls under N counts as N (SW5e's minimum roll threshold, PHB chapter 7; shown as "3→5"). #150
// SW5e, as 5e: a creature at 0 hit points that regains any stops being unconscious, and its death saves reset (it
// stays Prone until it stands). Every way the sheet raises HP goes through char.save, so this runs there (and for the
// combat view's Second Wind); the combat view's own healing does the same in its engine. #138
function reviveChar(camp, ch, wasHp) {
  if (!ch || !(num(wasHp, 1) <= 0) || !(num((ch.hp || {}).current, 0) > 0)) return false;
  ch.deathSaves = { s: 0, f: 0 };
  ch.conditions = (ch.conditions || []).filter((c) => c !== "Unconscious");
  for (const e of (camp.initiative && camp.initiative.entries) || []) {
    if (e.charId === ch.id) e.conditions = (e.conditions || []).filter((c) => c !== "Unconscious");
  }
  return true;
}
function rollDice(expr) {
  const src = String(expr || "").replace(/\s+/g, "").toLowerCase();
  if (!src) throw new Invalid("empty dice expression");
  if (src.length > 120) throw new Invalid("dice expression too long");
  let pos = 0, total = 0, nat = null, d20s = 0, count = 0;
  const parts = [];
  while (pos < src.length) {
    TERM.lastIndex = pos;
    const m = TERM.exec(src);
    if (!m || m.index !== pos || TERM.lastIndex === pos) throw new Invalid(`can't read '${src.slice(pos)}'`);
    pos = TERM.lastIndex;
    const sign = m[1] === "-" ? -1 : 1;
    if (m[8] !== undefined) {
      total += sign * +m[8];
      parts.push((sign < 0 ? "-" : "+") + m[8]);
      continue;
    }
    const n = +(m[2] || 1), sides = +m[3];
    if (n < 1 || n > 100 || sides < 1 || sides > 1000) throw new Invalid("dice out of range");
    // at most MAX_DICE dice in one expression, explosions included: over it the roll is refused, never cut short (#152)
    const rolls = [], low = {}, floor = m[6] === undefined ? 0 : Math.min(+m[6], sides);
    const die = () => {   // the natural face decides an explosion; min lifts what counts afterwards
      if (++count > MAX_DICE) throw new Invalid(`Too many dice: at most ${MAX_DICE} in one roll, explosions included.`);
      const r = crypto.randomInt(1, sides + 1);
      if (r < floor) low[rolls.length] = r;
      rolls.push(Math.max(r, floor));
      return r;
    };
    for (let i = 0; i < n; i++) {
      let r = die();
      for (let g = 0; m[7] && r === sides && sides > 1 && g < 20; g++) r = die();
    }
    let kept = rolls.map((_, i) => i);
    const mode = m[4];
    if (mode) {
      const k = +m[5];
      const order = kept.slice().sort((a, b) => rolls[a] - rolls[b]);
      kept = mode === "kh" || mode === "k" ? order.slice(-k) : mode === "kl" ? order.slice(0, k)
        : mode === "dl" ? order.slice(k) : order.slice(0, order.length - k);
    }
    const keep = new Set(kept);
    const sub = rolls.reduce((a, r, i) => a + (keep.has(i) ? r : 0), 0);
    total += sign * sub;
    const shown = rolls.map((r, i) => { const v = low[i] !== undefined ? `${low[i]}→${r}` : r; return keep.has(i) ? v : `~${v}~`; }).join(",");
    parts.push(`${sign < 0 ? "-" : "+"}${n}d${sides}${mode ? mode + m[5] : ""}${floor ? "min" + floor : ""}[${shown}]`);
    if (sides === 20) { d20s++; if (keep.size === 1) { const k = [...keep][0]; nat = low[k] !== undefined ? low[k] : rolls[k]; } }
  }
  if (d20s !== 1) nat = null;
  return { total, detail: parts.join(" ").replace(/^\+/, ""), nat };
}

// ---------------------------------------------------------------- the game
function blankCampaign(name) {
  return {
    code: "main", name: str(name, 80) || "HoloTable", created: now(), updated: now(),
    players: {}, characters: {}, chat: [],
    initiative: { entries: [], turn: 0, round: 1, active: false },
    map: { bgVersion: 0, bgUrl: null, floor: null, floorScale: 1, gridSize: 70, gridV2: true, cols: 24, rows: 16, tokens: [], props: [], showGrid: true },
    notes: "", handouts: [], levelUps: {},
  };
}

const playerName = (camp, cid) => (camp.players[cid] || {}).name || "Someone";

function addChat(camp, msg) {
  msg.id = msg.id || rid();
  msg.ts = msg.ts || now();
  camp.chat.push(msg);
  if (camp.chat.length > CHAT_LIMIT) camp.chat.splice(0, camp.chat.length - CHAT_LIMIT);
  return msg;
}

// Images may only be ones uploaded to this table (photos, maps, handouts) or asset-pack art, so
// nobody's browser is ever sent to an outside server.
const IMG_PREFIX = "/api/holotable?";
const IMG_RE = /^\/api\/holotable\?(img=[a-f0-9]{16,40}|a=[a-z0-9-]{3,60}\.\d{1,5})$/;
const validImg = (src) => (IMG_RE.test(String(src || "")) ? String(src) : null);
const validColor = (c, d = "#4fc3f7") => (/^#[0-9a-fA-F]{6}$/.test(String(c || "")) ? String(c) : d);
const numOr = (v, d) => (v === "" || v === null || v === undefined ? d : Number.isFinite(+v) ? +v : d);
const optNum = (v) => numOr(v, "");   // a number, or "" meaning "not set"
const nullNum = (v) => numOr(v, null);

// ---------------------------------------------------------------- starships (Starships of the Galaxy)
const SHIP_SIZES = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const DEPLOYMENTS = ["", "Coordinator", "Gunner", "Mechanic", "Operator", "Pilot", "Technician"];
const SHIP_SKILLS = ["astrogation", "boost", "data", "hide", "impress", "interfere", "maneuvering", "menace", "patch", "probe", "ram", "regulation", "scan", "swindle"];
const MAX_SHIPS = 20;
function cleanShip(sh, chars) {
  const s = (v, n = 200) => str(v, n);
  const list = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === "object").map(fn) : []);
  const pts = (o) => ({ current: clamp(int((o || {}).current), 0, 100000), max: clamp(int((o || {}).max), 0, 100000) });
  return {
    id: /^[a-z0-9]{6,20}$/.test(sh.id || "") ? sh.id : rid(), name: s(sh.name, 60) || "Unnamed ship", owner: s(sh.owner, 40),
    hidden: !!sh.hidden, color: validColor(sh.color, "#90a4ae"),
    size: SHIP_SIZES.includes(sh.size) ? sh.size : "Small", tier: clamp(int(sh.tier), 0, 5), role: s(sh.role, 60), model: s(sh.model, 80),
    ac: clamp(int(sh.ac, 10), 0, 40), hull: pts(sh.hull), shield: pts(sh.shield),
    hullDice: s(sh.hullDice, 20), shieldDice: s(sh.shieldDice, 20), shieldRegen: s(sh.shieldRegen, 40),
    speed: clamp(int(sh.speed, 300), 0, 100000), turn: clamp(int(sh.turn, 0), 0, 10000), hyper: s(sh.hyper, 20),
    fuel: s(sh.fuel, 40), cargo: s(sh.cargo, 1000), suites: s(sh.suites, 200), slots: s(sh.slots, 40),
    abilities: Object.fromEntries(ABILS.map((a) => [a, clamp(int((sh.abilities || {})[a], 10), 1, 30)])),
    saves: Object.fromEntries(ABILS.map((a) => [a, !!(sh.saves || {})[a]])),
    skills: Object.fromEntries(SHIP_SKILLS.map((k) => [k, [0, 1, 2].includes(+(sh.skills || {})[k]) ? +(sh.skills || {})[k] : 0])),
    crew: list(sh.crew, 20, (c) => ({ charId: chars[c.charId] ? c.charId : null, name: s(c.name, 60), deployment: DEPLOYMENTS.includes(c.deployment) ? c.deployment : "",
      rank: clamp(int(c.rank), 0, 5), pb: clamp(int(c.pb, 2), 0, 10), ...Ships.cleanCrew(c) })),
    weapons: list(sh.weapons, 30, (w) => ({ name: s(w.name, 80), atkMisc: clamp(int(w.atkMisc), -20, 20), dmg: s(w.dmg, 40), type: s(w.type, 30),
      range: s(w.range, 40), props: s(w.props, 300), ...Ships.cleanWeapon(w) })),
    equipment: list(sh.equipment, 60, (e) => ({ name: s(e.name, 80), notes: s(e.notes, 300) })),
    mods: list(sh.mods, 80, (e) => ({ name: s(e.name, 80), notes: s(e.notes, 300), ...Ships.cleanMod(e) })),
    notes: s(sh.notes, 10000), ...Ships.cleanFields(sh), updated: now(),
  };
}
const cleanVariants = (v) => [...new Set((Array.isArray(v) ? v : []).slice(0, 80).map((x) => str(x, 80).trim()).filter(Boolean))];

// A character sheet as the server keeps it: every number really is a number, every list is a
// list of plain objects with string fields, images and colours are checked.
// set by the server (holotable.js) on a player's char.save: the senses of the species they chose, from SW5e's own list.
// A Symbol, so it can't arrive in a client's JSON.
const SPECIES_SENSES = Symbol("speciesSenses");
// set by holotable.js on levelup.apply: the abilities a feat's own +1 may go to (audit 2.5), from SW5e's feat list,
// never from a client. Missing when the list couldn't be read.
const FEAT_ASI = Symbol("featAsi");
function cleanChar(ch) {
  const s = (v, n = 200) => str(v, n);
  const list = (v, max, fn) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === "object").map(fn) : []);
  const nums = (o, keys, d) => Object.fromEntries(keys.map((k) => [k, numOr((o || {})[k], d)]));
  const out = {
    _format: "holotable-sw5e", id: ch.id, name: s(ch.name, 80) || "Unnamed", species: s(ch.species, 60), background: s(ch.background, 60),
    alignment: s(ch.alignment, 60), xp: numOr(ch.xp, 0), credits: numOr(ch.credits, 0),
    ...((d) => (d ? { downtime: d } : {}))(Downtime.clean(ch.downtime)),   // downtime days and log (11.1): the server's to write
    ...((c) => (c ? { craft: c } : {}))(Craft.clean(ch.craft)),             // crafting requests (11.2): the server's to write
    classes: list(ch.classes, 6, (k) => ({ name: s(k.name, 40) || "Fighter", level: clamp(int(k.level, 1), 0, 20), archetype: s(k.archetype, 60) })),
    abilities: nums(ch.abilities, ABILS, 10),
    saves: Object.fromEntries(ABILS.map((a) => [a, !!(ch.saves || {})[a]])),
    skills: Object.fromEntries(Object.entries(ch.skills || {}).slice(0, 40).filter(([k]) => /^[a-zA-Z]{1,30}$/.test(k)).map(([k, v]) => [k, [0, 0.5, 1, 2, 3, 4, 5].includes(+v) ? +v : 0])),
    skillMisc: Object.fromEntries(Object.entries(ch.skillMisc || {}).slice(0, 40).filter(([k]) => /^[a-zA-Z]{1,30}$/.test(k)).map(([k, v]) => [k, numOr(v, 0)])),
    saveMisc: nums(ch.saveMisc, ABILS, 0),
    ac: numOr(ch.ac, 10), speed: numOr(ch.speed, 30),
    ...(/^(attack|equipment):.{1,80}$/.test(String(ch.infused || "")) ? { infused: s(ch.infused, 100) } : {}),   // Infuse Item (Engineer)
    // AC worked out from armor (audit 5.3): kept only when switched on, so other sheets are as before
    ...(ch.acAuto ? { acAuto: true } : {}), ...(numOr(ch.acMisc, 0) ? { acMisc: clamp(numOr(ch.acMisc, 0), -20, 20) } : {}),
    hp: nums(ch.hp, ["max", "current", "temp"], 0), hitDiceUsed: Fight.cleanHitDiceUsed(ch.hitDiceUsed),   // per die size (audit 7.2), or an old single number
    deathSaves: { s: clamp(int((ch.deathSaves || {}).s), 0, 3), f: clamp(int((ch.deathSaves || {}).f), 0, 3) },
    initMisc: numOr(ch.initMisc, 0), profOverride: optNum(ch.profOverride),
    // temporary points (audit 4.9) are kept only when there are some
    force: Object.assign({ max: optNum((ch.force || {}).max), used: numOr((ch.force || {}).used, 0) }, Fight.cleanHigh((ch.force || {}).high), tempPts((ch.force || {}).temp)),   // high: levels cast once per long rest (#160)
    tech: Object.assign({ max: optNum((ch.tech || {}).max), used: numOr((ch.tech || {}).used, 0) }, Fight.cleanHigh((ch.tech || {}).high), tempPts((ch.tech || {}).temp)),
    ...(R.SIZES.includes(ch.size) ? { size: ch.size } : {}),   // size (audit 5.12), from the species or the GM
    // the combat view's resource tracker (audit 3.1): kept only on a sheet that has some, so other sheets are as before
    ...(Array.isArray(ch.resources) && ch.resources.length ? { resources: Fight.cleanResources(ch.resources) } : {}),
    ...(Array.isArray(ch.senses) && R.cleanSenses(ch.senses).length ? { senses: R.cleanSenses(ch.senses) } : {}),
    attacks: list(ch.attacks, 40, (a) => ({ name: s(a.name, 80), ab: ["str", "dex", "con", "int", "wis", "cha", "finesse"].includes(a.ab) ? a.ab : "str",
      damage: s(a.damage, 40), damageFull: a.damageFull ? s(a.damageFull, 60) : undefined, type: s(a.type, 30), props: s(a.props, 200),
      proficient: a.proficient !== false, magic: optNum(a.magic), bonus: optNum(a.bonus), noModDamage: !!a.noModDamage,
      ...(a.shots != null && a.shots !== "" && Number.isFinite(+a.shots) ? { shots: clamp(int(a.shots), 0, 999) } : {}),   // shots left in a Reload weapon (audit 6.6)
      ...(int(a.critRange, 20) < 20 ? { critRange: clamp(int(a.critRange, 20), 15, 20) } : {}) })),   // crits on this d20 or higher (19 = 19-20)
    powers: list(ch.powers, 150, (pw) => ({ name: s(pw.name, 80), level: clamp(int(pw.level), 0, 9), type: pw.type === "tech" ? "tech" : "force",
      alignment: ["light", "dark"].includes(pw.alignment) ? pw.alignment : "universal", notes: s(pw.notes, 300), description: s(pw.description, 4000),
      ...(s(pw.pre, 80).trim() ? { pre: s(pw.pre, 80).trim() } : {}) })),   // the power that must be known first (audit 2.11)
    features: list(ch.features, 150, (f) => ({ name: s(f.name, 80), text: s(f.text, 4000) })),
    equipment: list(ch.equipment, 200, (e) => ({ name: s(e.name, 80), qty: numOr(e.qty, 1), equipped: !!e.equipped, notes: s(e.notes, 200),
      ...(R.cleanArmor(e.armor) ? { armor: R.cleanArmor(e.armor) } : {}),   // with its speed properties (audit 5.11)
      // weight in pounds each (audit 6.5) and cost in credits each (6.8), from SW5e's gear or typed; kept only when set
      ...(+e.wt > 0 ? { wt: Math.min(10000, Math.round(+e.wt * 100) / 100) } : {}), ...(+e.cost > 0 ? { cost: Math.min(1e9, Math.round(+e.cost)) } : {}),
      // an enhanced item's rarity, whether it requires attunement, and whether it's attuned (audit 6.3), kept only when set
      ...(R.RARITIES.includes(e.rar) ? { rar: e.rar } : {}), ...(e.att ? { att: true } : {}), ...(e.att && e.attuned ? { attuned: true } : {}),
      ...(e.use && R.cleanUse(e.use) ? { use: R.cleanUse(e.use) } : {}),   // a consumable: what using it rolls (audit 6.7)
      ...(R.cleanBonus(e.bonus) ? { bonus: R.cleanBonus(e.bonus) } : {}),   // an enhanced item's +N (audit 6.2)
      ...(R.cleanChassis(e.chassis) ? { chassis: R.cleanChassis(e.chassis) } : {}), ...(R.cleanMod(e.mod) ? { mod: R.cleanMod(e.mod) } : {}),   // modification (6.4)
      ...(R.cleanImplant(e.implant) ? { implant: R.cleanImplant(e.implant) } : {}) })),   // a cybernetic augmentation or droid customization (6.4)
    // installed cybernetics and droid customizations, and a droid's motor slots past the two it starts with (6.4)
    ...(R.cleanImplants(ch.implants).length ? { implants: R.cleanImplants(ch.implants) } : {}), ...(R.motorSlots(ch) > 2 ? { motor: R.motorSlots(ch) } : {}),
    conditions: (Array.isArray(ch.conditions) ? ch.conditions : []).slice(0, 20).map((c) => s(c, 30)),
    exhaustion: clamp(int(ch.exhaustion), 0, 6), inspiration: !!ch.inspiration,
    // variant rules on the sheet (9.16): Simplified Forcecasting's one ability, and Hunted's disturbance points
    ...(ch.forceAbility === "wis" || ch.forceAbility === "cha" ? { forceAbility: ch.forceAbility } : {}),
    ...(int(ch.disturbance) > 0 ? { disturbance: clamp(int(ch.disturbance), 0, 999) } : {}),
    proficiencies: s(ch.proficiencies, 2000), languages: s(ch.languages, 500), notes: s(ch.notes, 20000),
    ...(Object.prototype.hasOwnProperty.call(Story.LIFESTYLES, ch.lifestyle) ? { lifestyle: ch.lifestyle } : {}),   // 11.5
    image: validImg(ch.image) || "", tokenImage: validImg(ch.tokenImage) || "", color: validColor(ch.color),
  };
  if (!out.classes.length) out.classes = [{ name: "Fighter", level: 1, archetype: "" }];
  if (out.acAuto) out.ac = R.armorClass(out).total;   // worked out here too, so the tracker and the combat view read the same AC
  return out;
}

// Tokens whose name the GM is hiding, looked up by sheet ("c:<charId>") or, for loose tokens, by name
// ("n:<name>"). The value is the token's id, or null when two loose tokens share the name.
function unknownNames(camp) {
  const m = new Map();
  for (const t of ((camp.map && camp.map.tokens) || [])) {
    if (!t.nameHidden || t.hidden) continue;
    const k = t.charId ? "c:" + t.charId : "n:" + t.name;
    m.set(k, m.has(k) ? null : t.id);
  }
  return m;
}
// undefined: this initiative entry isn't masked; otherwise the masked token's id (or null)
function unknownTokenFor(unk, e) {
  const k = e && (e.charId ? "c:" + e.charId : "n:" + e.name);
  return k && unk.has(k) ? unk.get(k) : undefined;
}
// The name players are shown for an initiative entry: "???" while the GM hides its token's name.
// For anything players can read (chat lines, the combat view); GM-only text keeps the real name.
function shownName(camp, entry) {
  return unknownTokenFor(unknownNames(camp), entry) === undefined ? (entry && entry.name) || "" : "???";
}

// A sheet whose token's name the GM is hiding isn't sent to other players at all (its name, photo and
// numbers would give it away); the player who owns it still gets it.
function sheetsFor(camp, cid) {
  const secret = new Set(((camp.map && camp.map.tokens) || []).filter((t) => t.nameHidden && t.charId).map((t) => t.charId));
  if (!secret.size) return camp.characters;
  const out = {};
  for (const [id, c] of Object.entries(camp.characters || {})) if (!secret.has(id) || c.owner === cid) out[id] = c;
  return out;
}

function viewFor(camp, cid, gm, online) {
  const chat = camp.chat.filter((m) => !m.to || gm || m.to.includes(cid) || m.fromId === cid);
  const ini = Object.assign({}, camp.initiative);
  if (!gm) {
    ini.entries = ini.entries.filter((e) => !e.hidden)
      .map((e) => Object.assign({}, e, e.npc ? { hp: null, maxHp: null, sb: undefined, tpl: undefined } : {}));
  }
  const map = Object.assign({}, camp.map);
  let fog = null;
  if (!gm) {
    // tokens whose name the GM hasn't revealed yet: players get "???" and no sheet link, and the
    // matching initiative entries are masked the same way (tok tells the client which token is up)
    const unk = unknownNames(camp);
    if (unk.size) ini.entries = ini.entries.map((e) => {
      const tok = unknownTokenFor(unk, e);
      if (tok === undefined) return e;
      return Object.assign({}, e, { name: "???", charId: null, sb: undefined, tpl: undefined, hp: null, maxHp: null, tok: tok || undefined });
    });
    delete map.walls;   // walls are the GM's: a player's browser never learns the shape of a room it hasn't seen (issue #93)
    delete map.fog;     // so is the fog's record; a player gets only their own squares
    delete map.light;   // and where the GM put the lights: a player sees only what they light
    fog = Fight.fogFor(camp, cid);   // fog of war (#93): tokens this player's characters can't see aren't sent, nor their tracker entries
    if (fog) {
      const curId = (camp.initiative.entries[camp.initiative.turn] || {}).id;
      map.tokens = map.tokens.filter((t) => !fog.tokens.has(t.id));
      ini.entries = ini.entries.filter((e) => !fog.entries.has(e.id));
      ini.turn = ini.entries.findIndex((e) => e.id === curId);   // the tracker marks the turn by place in the list; an unseen one marks none
    }
    map.tokens = map.tokens.filter((t) => !t.hidden).map((t) => {
      if (!t.moves && !t.nameHidden) return t;
      const v = Object.assign({}, t, { moves: undefined });
      if (t.nameHidden) Object.assign(v, { name: "???", charId: null, nameHidden: undefined });
      return v;
    });
  }
  if (!gm) map.props = (map.props || []).map((x) => (x.moves || x.blocksSight ? Object.assign({}, x, { moves: undefined, blocksSight: undefined }) : x));
  const shown = new Set([...map.tokens.map((t) => t.id), ...(map.props || []).map((x) => x.id)]);
  const fogState = Fight.fogView(camp, cid, gm, fog);
  const fxView = camp.sceneFx ? Object.assign({}, camp.sceneFx, { moves: (camp.sceneFx.moves || []).filter((m) => shown.has(m.id)) }) : null;
  return {
    name: camp.name, you: cid, isGM: !!gm, updated: camp.updated,
    players: camp.players, online: online || [], characters: gm ? camp.characters : sheetsFor(camp, cid),
    chat: chat.slice(-200), initiative: ini, map,
    notes: gm ? camp.notes : null,
    handouts: (camp.handouts || []).filter((h) => gm || h.shared),
    levelUps: camp.levelUps || {},
    ...(gm && camp.levelUndo && Object.keys(camp.levelUndo).length ? { levelUndo: Object.fromEntries(Object.entries(camp.levelUndo).map(([id, u]) => [id, u.level])) } : {}),   // 2.15
    variants: camp.variants || [],
    hpMax: camp.hpMax !== false,
    ...(camp.stash ? { stash: camp.stash } : {}),   // the party stash (6.9): everyone sees it
    ...(camp.clock ? { clock: camp.clock } : {}),   // in-game time (9.18)
    ...(camp.sheetLock ? { sheetLock: true } : {}), ...(camp.statBlocksHidden ? { statBlocksHidden: true } : {}),   // the GM's table rules (12.6, 9.17)
    audio: camp.audio ? Object.assign({}, camp.audio, { now: now() }) : null,   // "now" lets each screen line its clock up
    // a ship's crew row keeps its character's name: a player reads "???" while the GM hides that token's name
    ships: (camp.ships || []).filter((x) => gm || !x.hidden).map((x) => (gm || !Array.isArray(x.crew) ? x
      : Object.assign({}, x, { crew: x.crew.map((c) => (c && c.charId && shownName(camp, { charId: c.charId, name: c.name }) === "???" ? Object.assign({}, c, { name: "???" }) : c)) }))),
    ...(camp.space ? { space: Space.view(camp, gm) } : {}),   // the space map (#146)
    sceneFx: fxView,
    ...(gm && (camp.npcs || []).length ? { npcs: camp.npcs } : {}),   // the GM's NPC templates (9.9), the GM's only
    ...((pg) => (pg.length ? { pings: pg } : {}))((camp.pings || []).filter((q) => q && now() - q.ts < 10).map((q) => ({ id: q.id, x: q.x, y: q.y, gm: q.gm, name: playerName(camp, q.by) }))),
    ...(camp.fight && camp.fight.on ? { fight: Fight.view(camp, cid, gm, shownName) } : {}),
    // the sheet's Cast (#73), combat view on or off: which powers the table has data for, and who concentrates on what
    ...((sc) => (sc ? { sheetCast: sc } : {}))(Fight.sheetView(camp, gm ? camp.characters : sheetsFor(camp, cid))),
    ...((a) => (a ? { ask: a } : {}))(Ask.view(camp, cid, gm)),
    ...Story.view(camp, gm),   // factions and rivals the GM shows (11.3, 11.4)   // an open roll request (9.12), for whom it names
    ...(fogState ? { fog: fogState } : {}),   // the map's fog of war (#93), combat view or not: only while the GM has it on   // the combat view, only while it is on
    scene: (camp.scenes || []).filter((x) => x.id === camp.activeScene).map((x) => ({ id: x.id, name: x.name }))[0] || null,
    scenes: gm ? (camp.scenes || []).map((x) => ({ id: x.id, name: x.name, savedAt: x.savedAt })) : null,
  };
}

function doRoll(camp, cid, expr, label, charId, priv, kind) {
  const res = rollDice(expr);
  const msg = { from: playerName(camp, cid), fromId: cid, roll: Object.assign({}, res, { expr: str(expr, 120), label: str(label, 120), kind: kind || null }) };
  if (charById(camp, charId)) msg.charName = charById(camp, charId).name;
  if (priv) { msg.to = ["@gm", cid]; msg.private = true; }
  addChat(camp, msg);
  return res;
}

// ---------------------------------------------------------------- levelling
// Hit die per SW5e class (custom / homebrew classes send their own die from the sheet).
const HIT_DIE = { berserker: 12, consular: 6, engineer: 8, fighter: 10, guardian: 10, monk: 8, operative: 8, scholar: 8, scout: 10, sentinel: 8 };
const ABILS = ["str", "dex", "con", "int", "wis", "cha"];
// SW5e (as 5e): the XP a character needs to reach the next level, by current level (index 1-19)
const XP_FOR_LEVEL = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
const totalLevel = (ch) => (ch.classes || []).reduce((a, k) => a + (int(k.level) || 0), 0);
const abMod = (ch, ab) => Math.floor((num((ch.abilities || {})[ab], 10) - 10) / 2);
const hitDieFor = (name, fallback) => HIT_DIE[String(name || "").toLowerCase()] || ([6, 8, 10, 12].includes(int(fallback)) ? int(fallback) : 8);

// copy the live map into the active scene (returns false if no scene is active)
// The screen wipe everyone sees when the GM changes the scene: a fresh id (so each change plays once)
// and one of the wipe styles the page knows (left, right, down, up, diagonal, clock, iris, barn doors).
const SCENE_WIPES = 8;
// Combat starts (Start in initiative, or the combat view switched on): the movements the GM queued for it play
// now, without a wipe. Returns how many pieces move.
function combatMoves(camp) {
  const moves = playMoves(camp, "combat");
  if (moves.length) camp.sceneFx = { n: rid(), k: -1, moves };
  return moves.length;
}
const sceneWipe = (camp) => { camp.sceneFx = { n: rid(), k: crypto.randomInt(SCENE_WIPES) }; };

// Scene movements: the GM gives a token (or an asset piece, like a speeder) a scripted path (grid waypoints, like keyframes), an optional exit off
// one edge of the board, and a start delay. Each plays once: right after that scene is loaded, or (when: "combat")
// the moment combat starts, when the GM presses Start in initiative or switches the combat view on. "▶ Play
// movements" plays them all now. The server moves the pieces to where they end up and tells every screen the
// path to animate.
const EXITS = ["n", "s", "e", "w"];
function cleanMoves(m) {
  if (!m || typeof m !== "object") return undefined;
  const path = (Array.isArray(m.path) ? m.path : []).slice(0, 12).filter((q) => q && typeof q === "object")
    .map((q) => ({ x: clamp(int(q.x), -500, 1000), y: clamp(int(q.y), -500, 1000) }));
  const exit = EXITS.includes(m.exit) ? m.exit : "";
  if (!path.length && !exit) return undefined;
  const out = { path, exit, delay: clamp(Math.round(num(m.delay) * 2) / 2, 0, 20) };
  if (m.face) out.face = true;   // asset pieces: turn to face the way they're going
  if (m.when === "combat") out.when = "combat";   // waits for combat to start instead of the next scene change
  return out;
}
// when: "scene" plays the movements waiting for a scene change, "combat" those waiting for combat; none plays all
const playsNow = (m, when) => !!m && (!when || (m.when === "combat" ? "combat" : "scene") === when);
function playMoves(camp, when) {
  const mp = camp.map, out = [];
  for (const t of mp.tokens || []) {
    const m = t.moves;
    if (!playsNow(m, when)) continue;
    delete t.moves;                                   // each scripted move plays once
    const pts = (m.path || []).map((q) => ({ x: q.x, y: q.y }));
    const last = pts.length ? pts[pts.length - 1] : { x: t.x, y: t.y }, sz = t.size || 1;
    const off = { n: { x: last.x, y: -sz - 1 }, s: { x: last.x, y: (mp.rows || 16) + 1 }, w: { x: -sz - 1, y: last.y }, e: { x: (mp.cols || 24) + 1, y: last.y } }[m.exit];
    if (off) pts.push(off);
    if (!pts.length) continue;
    out.push({ id: t.id, from: { x: t.x, y: t.y }, path: pts, delay: m.delay || 0 });
    t.x = pts[pts.length - 1].x; t.y = pts[pts.length - 1].y;
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const heading = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  for (const pr of mp.props || []) {
    const m = pr.moves;
    if (!playsNow(m, when)) continue;
    delete pr.moves;
    const pw = num(pr.w, 1), ph = num(pr.h, 1);
    const pts = (m.path || []).map((q) => ({ x: r3(q.x + 0.5 - pw / 2), y: r3(q.y + 0.5 - ph / 2) }));
    const last = pts.length ? pts[pts.length - 1] : { x: pr.x, y: pr.y };
    const off = { n: { x: last.x, y: -ph - 1 }, s: { x: last.x, y: (mp.rows || 16) + 1 }, w: { x: -pw - 1, y: last.y }, e: { x: (mp.cols || 24) + 1, y: last.y } }[m.exit];
    if (off) pts.push(off);
    if (!pts.length) continue;
    const from = { x: pr.x, y: pr.y }, rot0 = num(pr.rot, 0);
    out.push({ id: pr.id, prop: true, from, path: pts, delay: m.delay || 0, face: !!m.face, rot0 });
    if (m.face) {   // keep the turn it made between its first and last legs
      const all = [from, ...pts].filter((q, i, a) => !i || q.x !== a[i - 1].x || q.y !== a[i - 1].y);
      if (all.length > 2) pr.rot = r3((((rot0 + heading(all[all.length - 2], all[all.length - 1]) - heading(all[0], all[1])) % 360) + 360) % 360);
    }
    pr.x = pts[pts.length - 1].x; pr.y = pts[pts.length - 1].y;
  }
  return out;
}

function stashScene(camp) {
  const sc = (camp.scenes || []).find((x) => x.id === camp.activeScene);
  if (!sc) return false;
  sc.map = JSON.parse(JSON.stringify(camp.map));
  sc.savedAt = now();
  return true;
}

const SKILL_KEYS = new Set(R.SKILLS.map((x) => x.key));   // the sheet's skills, for Expertise (audit 2.9)
function applyLevelUp(camp, cid, gm, p) {
  const ch = charById(camp, p.charId);
  if (!ch) throw new Invalid("No such character.");
  if (!(gm || ch.owner === cid)) throw new Forbidden("not your character");
  const pend = (camp.levelUps || {})[ch.id];
  if (!pend || pend.count < 1) throw new Invalid("The GM hasn't granted this character a level up yet.");
  if (!Array.isArray(ch.classes)) ch.classes = [];
  const before = totalLevel(ch);
  if (before >= 20) throw new Invalid("Already level 20.");
  const clsName = str(p.className, 40).trim();
  if (!clsName) throw new Invalid("Pick a class to level up.");
  let k = ch.classes.find((x) => String(x.name || "").toLowerCase() === clsName.toLowerCase());
  const multiclass = !k;
  // multiclassing prerequisites (audit 2.12): a player is held to them; the GM may let a character through (override)
  const unmet = multiclass ? R.multiclassUnmet(ch, clsName) : [];
  if (unmet.length && !(gm && p.override)) throw new Invalid(`Multiclassing into ${clsName}: ${unmet.join("; ")}. The GM can allow it.`);
  const snapshot = JSON.parse(JSON.stringify(ch));   // for the GM's undo of this level (audit 2.15)
  if (!k) { k = { name: clsName, level: 0, archetype: "" }; ch.classes.push(k); }
  if (!ch.abilities) ch.abilities = {};
  const oldCon = abMod(ch, "con");

  // ability score increase (+2 to one score or +1 to two, never above 20) or a feat
  if (p.asi) {
    let total = 0;
    for (const [ab, v] of Object.entries(p.asi)) {
      const inc = int(v);
      if (!ABILS.includes(ab) || inc < 0 || inc > 2) throw new Invalid("Bad ability score increase.");
      if (num(ch.abilities[ab], 10) + inc > 20) throw new Invalid("Ability scores can't go above 20.");
      total += inc;
    }
    if (total !== 2) throw new Invalid("An ability score increase is +2 to one score or +1 to two.");
  }
  const feat = p.feat && str(p.feat.name, 80).trim();
  // Expertise (audit 2.9): at most two skills at a time, each one the character is already proficient in
  if (Array.isArray(p.expertise) && p.expertise.length > 4) throw new Invalid("Expertise is two proficiencies at a time.");
  const expertise = Array.isArray(p.expertise) ? [...new Set(p.expertise.map((x) => str(x, 30)))] : [];
  if (expertise.length > 2) throw new Invalid("Expertise is two proficiencies at a time.");
  for (const sk of expertise) {   // one of the sheet's skills (SW5e's list), held at proficiency 1
    if (!SKILL_KEYS.has(sk) || !ch.skills || !Object.prototype.hasOwnProperty.call(ch.skills, sk) || +ch.skills[sk] !== 1) throw new Invalid("Expertise goes on a skill you're proficient in.");
  }
  // a half-feat's own +1 (audit 2.5): one ability, among the ones SW5e's feat list gives that feat, to at most 20
  let featAsi = null;
  if (feat && p.feat.asi) {
    const entries = p.feat.asi && typeof p.feat.asi === "object" ? Object.entries(p.feat.asi) : [];
    const ok = Array.isArray(p[FEAT_ASI]) ? p[FEAT_ASI] : null;
    if (!ok) throw new Invalid("Couldn't check that feat's ability increase just now. Try again in a moment.");
    if (entries.length !== 1 || int(entries[0][1]) !== 1 || !ok.includes(entries[0][0])) throw new Invalid("That feat doesn't raise that ability.");
    if (num(ch.abilities[entries[0][0]], 10) + 1 > 20) throw new Invalid("Ability scores can't go above 20.");
    featAsi = entries[0][0];
  }
  if (p.hpMode === "max" && camp.hpMax === false) throw new Invalid("The GM has turned off taking maximum hit points.");

  // hit points: rolled on the server (shown in chat), the fixed average, or the die's maximum (a table's choice);
  // Con changes count for every level
  const hd = hitDieFor(k.name, p.hitDie);
  if (p.asi) for (const [ab, v] of Object.entries(p.asi)) ch.abilities[ab] = num(ch.abilities[ab], 10) + int(v);
  if (featAsi) ch.abilities[featAsi] = num(ch.abilities[featAsi], 10) + 1;
  const newCon = abMod(ch, "con");
  const die = p.hpMode === "roll"
    ? doRoll(camp, cid, `1d${hd}`, `${ch.name}: level ${before + 1} hit points (d${hd})`, ch.id, false, "hp").total
    : p.hpMode === "max" ? hd : hd / 2 + 1;
  const gain = Math.max(1, die + newCon) + (newCon - oldCon) * before;
  ch.hp = ch.hp || {};
  ch.hp.max = num(ch.hp.max) + gain;
  ch.hp.current = num(ch.hp.current) + gain;

  k.level = int(k.level) + 1;
  // an archetype is chosen once per class, on reaching class level 3 (every SW5e class picks it then)
  if (p.archetype && k.level === 3 && !k.archetype) k.archetype = str(p.archetype, 60);
  ch.features = Array.isArray(ch.features) ? ch.features : [];
  ch.powers = Array.isArray(ch.powers) ? ch.powers : [];
  if (feat) ch.features.push({ name: feat, text: `Feat (level ${before + 1})` + (p.feat.text ? "\n" + str(p.feat.text, 4000) : "") });
  for (const f of (Array.isArray(p.features) ? p.features : []).slice(0, 20)) {
    const name = f && str(f.name, 80).trim();
    if (name && !ch.features.some((x) => String(x.name || "").toLowerCase() === name.toLowerCase())) ch.features.push({ name, text: str(f.text, 4000) });
  }
  for (const pw of (Array.isArray(p.powers) ? p.powers : []).slice(0, 20)) {
    if (!pw || !str(pw.name, 80).trim()) continue;
    ch.powers.push({ name: str(pw.name, 80).trim(), level: clamp(int(pw.level), 0, 9), type: pw.type === "tech" ? "tech" : "force",
      alignment: ["light", "dark"].includes(pw.alignment) ? pw.alignment : "universal", notes: str(pw.notes, 300), description: str(pw.description, 4000) });
  }
  for (const sk of expertise) ch.skills[sk] = 2;
  // a new class gives only its multiclass proficiencies (audit 2.13), noted on the sheet
  if (multiclass && R.mcProfs(k.name) && ch.classes.length > 1) ch.proficiencies = `${str(ch.proficiencies, 1800)}${ch.proficiencies ? "\n" : ""}Multiclass ${k.name}: ${R.mcProfs(k.name)}`.slice(0, 2000);
  ch.updated = now();
  pend.count -= 1;
  if (pend.count < 1) delete camp.levelUps[ch.id];
  camp.levelUndo = Object.assign({}, camp.levelUndo, { [ch.id]: { level: before + 1, at: now(), sheet: snapshot } });
  for (const e of camp.initiative.entries) if (e.charId === ch.id) { e.hp = ch.hp.current; e.maxHp = ch.hp.max; }

  const bits = [`HP +${gain}`];
  if (p.asi) bits.push(Object.entries(p.asi).filter(([, v]) => int(v)).map(([ab, v]) => `${ab.toUpperCase()} +${int(v)}`).join(", "));
  if (feat) bits.push(`feat: ${feat}${featAsi ? ` (${featAsi.toUpperCase()} +1)` : ""}`);
  if (expertise.length) bits.push(`expertise: ${expertise.join(", ")}`);
  addChat(camp, { levelup: true, text: `🎉 ${ch.name} reached level ${before + 1}! ${multiclass ? "Multiclassed into " : ""}${k.name} ${k.level}${k.archetype ? " (" + k.archetype + ")" : ""} · ${bits.join(" · ")}` });
  return { level: before + 1, hpGain: gain, die };
}

// a character by an id that came from a request or a file: only the table's own, never something every object inherits
// ("__proto__", "constructor"), which would pass a truthiness check and could be written to (#111)
const charById = (camp, id) => (typeof id === "string" && Object.prototype.hasOwnProperty.call(camp.characters || {}, id) ? camp.characters[id] : undefined);
const canEditChar = (camp, cid, gm, id) => { const ch = charById(camp, id); return !ch || gm || ch.owner === cid; };

function sortInit(ini) {
  const cur = ini.entries[ini.turn] && ini.entries[ini.turn].id;
  for (const e of ini.entries) e.init = num(e.init);
  ini.entries.sort((a, b) => (b.init + (b.dexTie || 0)) - (a.init + (a.dexTie || 0)));
  const i = ini.entries.findIndex((e) => e.id === cur);
  ini.turn = i < 0 ? 0 : i;
}

// Returns { result, images: [ids no longer used] } and may throw Forbidden / Invalid.
// Damage on a character, against its hit points at this moment: temporary hit points go first, hit points stop at 0
// (audit 8.7, issue #107). The sheet's Damage button and the tracker's -n both come here, as the combat view does in
// its engine, so all three spend temporary HP the same way; the tracker rows for that character follow.
function damageChar(camp, ch, amount) {
  const d = clamp(int(amount), 0, 100000), hp = ch.hp = ch.hp || {}, temp = Math.max(0, +hp.temp || 0), fromTemp = Math.min(temp, d);
  hp.temp = temp - fromTemp;
  hp.current = Math.max(0, (+hp.current || 0) - (d - fromTemp));
  for (const e of camp.initiative.entries) if (e.charId === ch.id) e.hp = hp.current;
}

// what the combat module is given to work with
const fightHelpers = () => ({ rollDice, addChat, playerName, applyAction, shownName, combatMoves, reviveChar, Forbidden, Invalid });

function applyAction(camp, cid, gm, type, p) {
  p = p || {};
  const chars = camp.characters, ini = camp.initiative, mp = camp.map;
  mp.props = mp.props || [];
  const need = (ok, why = "GM only") => { if (!ok) throw new Forbidden(why); };
  if (Story.handles(type)) return Story.apply(camp, cid, gm, type, p, { addChat, shownName, Forbidden, Invalid });
  if (type.startsWith("ask.")) return Ask.apply(camp, cid, gm, type, p, { rollDice, addChat, playerName, Forbidden, Invalid });
  if (type.startsWith("fight.")) return Fight.apply(camp, cid, gm, type, p, fightHelpers());
  if (Ships.handles(type)) return Ships.apply(camp, cid, gm, type, p, { rollDice, addChat, playerName, shownName, Forbidden, Invalid });
  if (Space.handles(type)) return Space.apply(camp, cid, gm, type, p, { rollDice, addChat, playerName, shownName, applyAction, rid, Forbidden, Invalid });
  if (Downtime.handles(type)) return Downtime.apply(camp, cid, gm, type, p, { addChat, shownName, applyAction, rollDice, Forbidden, Invalid });
  if (Craft.handles(type)) return Craft.apply(camp, cid, gm, type, p, { addChat, shownName, rollDice, Forbidden, Invalid });

  switch (type) {
    // ---- characters
    case "char.save": {
      if (!p.char || typeof p.char !== "object" || Array.isArray(p.char)) throw new Invalid("bad character");
      if (JSON.stringify(p.char).length > 400000) throw new Invalid("character sheet too large");
      const id = /^[a-z0-9]{6,20}$/.test(p.char.id || "") && !(p.char.id in Object.prototype) ? p.char.id : rid(12);   // never an inherited name ("constructor")
      need(canEditChar(camp, cid, gm, id), "not your character");
      if (!charById(camp, id) && Object.keys(chars).length >= 60) throw new Invalid("too many characters at this table");
      const old = charById(camp, id);
      const clean = cleanChar(Object.assign({}, p.char, { id }));
      clean.owner = old ? old.owner : (gm && p.owner && camp.players[p.owner] ? p.owner : cid);
      // photos change only through an upload (or char.photo.clear), never through a sheet save,
      // so a save carrying a stale copy can't undo or delete a photo that was just uploaded
      // senses shape what a player is shown under fog and lighting, so they're the GM's (jpesus's ruling on #92).
      // A player's save keeps the sheet's senses; choosing a different species takes that species' own senses,
      // which the server looks up itself (p[SPECIES_SENSES], set by holotable.js from SW5e's list, never by a client).
      // the GM's lock (audit 12.6): with it on, a player's save keeps the class levels, XP and hit point maximum the
      // sheet had. Those move by the GM's grant (levelup.apply) and the GM's own edits; an archetype pick still goes through.
      if (!gm && old && camp.sheetLock) {
        clean.classes = (old.classes || []).map((k, i) => Object.assign({}, k, { archetype: ((clean.classes || [])[i] || {}).archetype || k.archetype || "" }));
        clean.xp = old.xp;
        clean.hp = Object.assign({}, clean.hp, { max: (old.hp || {}).max });
      }
      // a player's brand-new sheet under the lock starts at 1st level with no XP and its class's 1st-level hit points
      // (the die's maximum + Con); the GM grants what comes after (follow-up to #191's review)
      if (!gm && !old && camp.sheetLock) {
        const k = (clean.classes || [])[0] || { name: "Fighter" };
        clean.classes = [{ name: k.name, level: 1, archetype: "" }];
        clean.xp = 0;
        const hp1 = Math.max(1, hitDieFor(k.name, k.hitDie) + abMod(clean, "con"));
        clean.hp = Object.assign({}, clean.hp, { max: Math.min(num((clean.hp || {}).max, hp1) || hp1, hp1) });
      }
      // and current hit points never above the maximum the GM holds
      if (!gm && camp.sheetLock && clean.hp) clean.hp.current = Math.min(num(clean.hp.current, 0), num(clean.hp.max, 0));
      if (!gm) {
        const lc = (v) => String(v || "").trim().toLowerCase();
        const newSpecies = !old || lc(old.species) !== lc(clean.species);
        const s = newSpecies && Array.isArray(p[SPECIES_SENSES]) ? R.cleanSenses(p[SPECIES_SENSES]) : (old && old.senses) || [];
        if (s.length) clean.senses = s; else delete clean.senses;
      }
      clean.image = old ? old.image || "" : "";
      clean.tokenImage = old ? old.tokenImage || "" : "";
      if (old && old.downtime) clean.downtime = old.downtime; else delete clean.downtime;   // only downtime actions change it (11.1)
      if (old && old.craft) clean.craft = old.craft; else delete clean.craft;               // only craft actions change it (11.2)
      clean.updated = now();
      if (!(camp.variants || []).includes("Simplified Forcecasting")) delete clean.forceAbility;   // only while the GM uses it
      chars[id] = clean;
      Fight.woundsHealed(camp, id, clean);   // back at its hit point maximum: no wounded levels (the Wounds variant, #233)
      if (old) {   // the record of changes (12.5)
        const changes = sheetDiff(old, clean);
        if (changes.length) {
          camp.sheetLog = camp.sheetLog || {};
          camp.sheetLog[id] = [...(camp.sheetLog[id] || []), { id: rid(), ts: now(), by: playerName(camp, cid) + (gm ? " (GM)" : ""), changes }].slice(-30);
        }
      }
      if (old) reviveChar(camp, clean, (old.hp || {}).current);   // healed up from 0: awake, death saves reset (#138)
      const ch = clean;
      for (const e of ini.entries) if (e.charId === id) { e.name = ch.name || e.name; const hp = ch.hp || {}; e.hp = hp.current; e.maxHp = hp.max; }
      for (const t of mp.tokens) if (t.charId === id) t.name = ch.name || t.name;
      // a player's new character is announced to all; the GM's is told to the GM only, since an NPC's name may be a
      // secret the GM hides once its token is down (#142)
      if (!old) addChat(camp, gm ? { system: true, to: ["@gm"], private: true, text: `You made ${ch.name || "a character"}. Players don't see this line.` }
        : { system: true, text: `${playerName(camp, cid)} brought ${ch.name || "a character"} to the table.` });
      return { id };
    }
    case "char.photo.clear": {
      const ch = charById(camp, p.charId);
      if (!ch) return {};
      need(gm || ch.owner === cid, "not your character");
      const k = p.kind === "token" ? "tokenImage" : "image";
      const old = ch[k];
      ch[k] = "";
      return { dropImages: [old] };
    }
    case "char.damage": {   // the sheet's Damage button: applied here, so a hit made on another screen at the same moment isn't overwritten
      const ch = charById(camp, p.id);
      if (!ch) return {};
      need(gm || ch.owner === cid, "not your character");
      damageChar(camp, ch, p.amount);
      Fight.afterDamage(camp, cid, ch, clamp(int(p.amount), 0, 100000), fightHelpers());   // concentration (audit 4.6)
      return {};
    }
    case "char.delete": {
      const ch = charById(camp, p.id);
      if (!ch) return {};
      need(gm || ch.owner === cid, "not your character");
      const said = shownName(camp, { charId: p.id, name: ch.name });   // before its token goes: a hidden name stays hidden
      delete chars[p.id];
      ini.entries = ini.entries.filter((e) => e.charId !== p.id);
      mp.tokens = mp.tokens.filter((t) => t.charId !== p.id);
      addChat(camp, { system: true, text: `${said === "???" ? "An unknown character" : said} left the table.` });
      return { dropImages: [ch.image, ch.tokenImage] };
    }
    case "char.rest": {   // the sheet says a character finished a short or long rest (it saves the numbers itself, through
      // char.save); this tells what else resets on a rest, such as the combat view's Wounds DC (#233), through Fight.onRest
      const id = String(p.charId || ""), ch = charById(camp, id), kind = p.kind === "long" ? "long" : p.kind === "short" ? "short" : "";
      if (!ch) throw new Invalid("No such character.");
      if (!kind) throw new Invalid("A short or a long rest.");
      if (!gm && ch.owner !== cid) throw new Forbidden("Not your character");
      if (typeof Fight.onRest === "function") Fight.onRest(camp, id, kind);
      return { rested: kind };
    }
    case "char.assign": {
      need(gm);
      const ch = charById(camp, p.id);
      if (ch && camp.players[p.owner]) ch.owner = p.owner;
      return {};
    }

    // ---- dice & chat
    case "roll":
      return { roll: doRoll(camp, cid, str(p.expr, 120), p.label, p.charId, !!p.private, p.kind) };
    case "chat": {
      const text = str(p.text, 2000).trim();
      if (!text) return {};
      const low = text.toLowerCase();
      // "as" (speaking as a character) only counts for a character the sender actually plays (any, for the GM);
      // the real sender always stays in `from`, so every message shows who sent it
      const wantAs = str(p.as, 80).trim().toLowerCase();
      const asCh = wantAs && Object.values(chars).find((c) => c && String(c.name || "").toLowerCase() === wantAs && (gm || c.owner === cid));
      // a character whose token's name the GM is hiding isn't named to the table: the line shows its sender instead (#187's review)
      const as = asCh && shownName(camp, { charId: asCh.id, name: asCh.name }) === asCh.name ? asCh.name : null;
      if (/^\/(r|roll) /.test(low)) {
        let expr = text.split(" ").slice(1).join(" "), label = "";
        if (expr.includes("#")) [expr, label] = [expr.slice(0, expr.indexOf("#")), expr.slice(expr.indexOf("#") + 1)];
        doRoll(camp, cid, expr.trim(), label.trim());
        return {};
      }
      if (/^\/(gmr|gr) /.test(low)) { doRoll(camp, cid, text.split(" ").slice(1).join(" ").trim(), "GM roll", null, true); return {}; }
      // /w <player name | character name | gm> <message>: the longest name that matches wins, so
      // "Kira Vos" beats "Kira". Whispering a character reaches whoever plays it (the GM sees all whispers).
      if (/^\/(w|whisper|msg|tell) /.test(low)) {
        const rest = text.slice(text.indexOf(" ") + 1).trim();
        const targets = [];
        for (const [id, pl] of Object.entries(camp.players)) if (pl && pl.name) targets.push({ name: pl.name, ids: [id], label: pl.name });
        for (const ch of Object.values(camp.characters)) {
          if (ch && ch.name && ch.owner) targets.push({ name: ch.name, ids: [ch.owner], label: `${ch.name} (${playerName(camp, ch.owner)})` });
        }
        targets.push({ name: "gm", ids: ["@gm"], label: "GM" });
        targets.sort((x, y) => y.name.length - x.name.length);
        const lowRest = rest.toLowerCase();
        const t = targets.find((x) => lowRest.startsWith(x.name.toLowerCase()) && /^(\s|$)/.test(rest.slice(x.name.length)));
        if (!t) throw new Invalid("No player or character by that name. Use /w <name> <message>");
        const body = rest.slice(t.name.length).trim();
        if (!body) throw new Invalid(`What do you want to whisper to ${t.label}?`);
        addChat(camp, { from: playerName(camp, cid), fromId: cid, text: body, to: [...new Set([...t.ids, cid])], private: true, whisperTo: t.label,
          as });
        return {};
      }
      // /yell: a loud message for everyone at the table (shown big, with a pop-up on every screen)
      if (/^\/(y|yell|shout) /.test(low)) {
        const body = text.slice(text.indexOf(" ") + 1).trim();
        if (!body) return {};
        // a few seconds between yells per person, so a stuck key can't flood everyone's screen
        camp.yellAt = camp.yellAt || {};
        if (now() - (camp.yellAt[cid] || 0) < 5) throw new Invalid("You just yelled. Give it a few seconds.");
        camp.yellAt[cid] = now();
        addChat(camp, { from: playerName(camp, cid), fromId: cid, text: str(body, 500), yell: true, as });
        return {};
      }
      // /ooc: out-of-character table talk
      if (/^\/(ooc|o) /.test(low)) {
        const body = text.slice(text.indexOf(" ") + 1).trim();
        if (body) addChat(camp, { from: playerName(camp, cid), fromId: cid, text: body, ooc: true });
        return {};
      }
      if (low.startsWith("/me ")) { addChat(camp, { from: playerName(camp, cid), fromId: cid, text: text.slice(4), emote: true, as }); return {}; }
      if (low.startsWith("/desc ") && gm) { addChat(camp, { from: "Narrator", fromId: cid, text: text.slice(6), narration: true }); return {}; }
      if (low.startsWith("/desc ")) throw new Invalid("Only the GM can narrate with /desc.");
      if (/^\/\S/.test(text)) throw new Invalid(`Unknown command ${text.split(/\s/)[0]}. Type / to see the list.`);
      addChat(camp, { from: playerName(camp, cid), fromId: cid, text, as });
      return {};
    }

    // ---- initiative
    case "init.add": {
      const charId = charById(camp, p.charId) ? p.charId : null;   // only a character the table has (#111)
      if (charId) need(canEditChar(camp, cid, gm, charId), "not your character"); else need(gm);
      let init = p.init;
      if (init === undefined || init === null || init === "") {
        const bonus = int(p.bonus);
        const expr = p.expr ? str(p.expr, 40) : `1d20${bonus >= 0 ? "+" : ""}${bonus}`;
        init = doRoll(camp, cid, expr, "Initiative: " + str(p.name, 60), charId, !!p.hidden && gm, "init").total;
      }
      let entry = charId && ini.entries.find((e) => e.charId === charId);
      if (!entry) { entry = { id: rid() }; ini.entries.push(entry); }
      const ch = charId ? charById(camp, charId) || {} : {};
      const hp = ch.hp || {};
      Object.assign(entry, {
        name: str(p.name || ch.name || "Combatant", 60), init: num(init), charId, npc: !charId,
        hidden: !!p.hidden && gm, hp: nullNum(charId ? hp.current : p.hp), maxHp: nullNum(charId ? hp.max : p.hp),
        ac: nullNum(charId ? ch.ac : p.ac), dexTie: num(p.bonus) / 100, conditions: entry.conditions || [],
        sb: !charId && gm && p.sb ? str(p.sb, 80) : undefined,
        tpl: !charId && gm && (camp.npcs || []).some((t) => t.id === String(p.tpl || "")) ? String(p.tpl) : undefined,   // the GM's NPC (9.9)
      });
      sortInit(ini);
      return {};
    }
    case "init.update": {
      const e = ini.entries.find((x) => x.id === p.id);
      if (!e) return {};
      need(gm || (e.charId && chars[e.charId] && chars[e.charId].owner === cid));
      const f = p.fields || {};
      if ("name" in f) e.name = str(f.name, 60);
      for (const k of ["hp", "maxHp", "ac"]) if (k in f) e[k] = nullNum(f[k]);
      if ("init" in f) e.init = num(f.init);
      if ("conditions" in f) e.conditions = (Array.isArray(f.conditions) ? f.conditions : []).slice(0, 20).map((c) => str(c, 30));
      if ("hidden" in f && gm) e.hidden = !!f.hidden;
      if ("hp" in f && e.charId && chars[e.charId]) (chars[e.charId].hp = chars[e.charId].hp || {}).current = numOr(f.hp, 0);
      if ("damage" in f) {   // the tracker's -n: a character's temporary hit points first, on the server (#107); a creature just loses it
        if (e.charId && chars[e.charId]) { damageChar(camp, chars[e.charId], f.damage); Fight.afterDamage(camp, cid, chars[e.charId], clamp(int(f.damage), 0, 100000), fightHelpers()); }
        else if (e.hp != null) e.hp = Math.max(0, e.hp - clamp(int(f.damage), 0, 100000));
      }
      if ("init" in f) sortInit(ini);
      return {};
    }
    case "init.remove": case "init.next": case "init.prev": case "init.start": case "init.clear": {
      need(gm);
      const n = ini.entries.length;
      if (type === "init.remove") {
        const i = ini.entries.findIndex((e) => e.id === p.id);
        if (i >= 0) { ini.entries.splice(i, 1); if (i < ini.turn) ini.turn--; ini.turn = clamp(ini.turn, 0, Math.max(0, ini.entries.length - 1)); }
      } else if (type === "init.next" && n) {
        ini.active = true; ini.turn++;
        if (ini.turn >= n) { ini.turn = 0; ini.round++; }
        const cur = ini.entries[ini.turn];
        // "???" while the GM hides the name; under fog, only to those who can see whose turn it is (#93, chat follows sight)
        if (!cur.hidden) { const to = Fight.sightTo(camp, null, [cur.id]); addChat(camp, Object.assign({ system: true, text: `Round ${ini.round} - ${shownName(camp, cur)}'s turn.` }, to ? { to } : {})); }
      } else if (type === "init.prev" && n) {
        ini.turn--;
        if (ini.turn < 0) { ini.turn = n - 1; ini.round = Math.max(1, ini.round - 1); }
      } else if (type === "init.start") {
        Object.assign(ini, { active: true, turn: 0, round: 1 });
        if (camp.fight) camp.fight.strenuousAt = "";   // a new fight: Strenuous Combat's saves can be made again (#233)
        addChat(camp, { system: true, text: "Combat begins! Roll initiative." });
        combatMoves(camp);
      } else if (type === "init.clear") {
        Object.assign(ini, { entries: [], turn: 0, round: 1, active: false });
        addChat(camp, { system: true, text: "Combat has ended." });
      }
      return {};
    }

    // ---- map: tokens
    case "token.move": {
      const t = mp.tokens.find((x) => x.id === p.id);
      if (!t) return {};
      need(gm || t.owner === cid || (t.charId && chars[t.charId] && chars[t.charId].owner === cid), "not your token");
      const tx = clamp(int(p.x, t.x), -500, 1000), ty = clamp(int(p.y, t.y), -500, 1000);
      if (!gm && !Fight.canWalk(camp, t, tx, ty)) throw new Invalid("A wall is in the way.");   // under fog, a player's drag can't peek through a wall (#93)
      t.x = tx; t.y = ty;
      return {};
    }
    case "token.add": {
      const charId = charById(camp, p.charId) ? p.charId : null;   // only a character the table has (#111)
      if (charId) {
        need(canEditChar(camp, cid, gm, charId), "not your character");
        if (mp.tokens.some((t) => t.charId === charId)) return {};
      } else need(gm);
      if (mp.tokens.length >= 300) throw new Invalid("too many tokens on this map");
      const ch = charId ? charById(camp, charId) || {} : {};
      mp.tokens.push({
        id: rid(), name: str(p.name || ch.name || "Token", 40), color: validColor(p.color || ch.color),
        // a character's token takes the sheet's size (audit 5.12) unless the request says otherwise
        x: clamp(int(p.x, 1), -500, 1000), y: clamp(int(p.y, 1), -500, 1000), size: clamp(int(p.size === undefined && ch.size ? R.tokenSquares(ch.size) : p.size, 1), 1, 4),
        charId, owner: cid, hidden: !!p.hidden && gm, img: validImg(p.img), nameHidden: !!p.nameHidden && gm,
        ...(p.size === undefined && ch.size === "Tiny" ? { tiny: true } : {}),   // a Tiny character's token is drawn small (8.15)
      });
      return {};
    }
    case "token.script": {   // the GM sets (or clears) a token's scene movement
      need(gm);
      const t = mp.tokens.find((x) => x.id === p.id);
      if (!t) throw new Invalid("No such token.");
      const m = cleanMoves(p.moves);
      if (m) t.moves = m; else delete t.moves;
      return {};
    }
    case "prop.script": {    // the GM sets (or clears) an asset piece's scene movement
      need(gm);
      const pr = (mp.props || []).find((x) => x.id === p.id);
      if (!pr) throw new Invalid("No such piece.");
      const m = cleanMoves(p.moves);
      if (m) pr.moves = m; else delete pr.moves;
      return {};
    }
    case "scene.play": {     // play the current board's scene movements now, without a wipe
      need(gm);
      const moves = playMoves(camp);
      if (!moves.length) throw new Invalid("Nothing on this board has a scene movement.");
      camp.sceneFx = { n: rid(), k: -1, moves };
      return { moved: moves.length };
    }
    case "token.remove": case "token.update": {
      const t = mp.tokens.find((x) => x.id === p.id);
      if (!t) return {};
      need(gm || t.owner === cid, "not your token");
      if (type === "token.remove") { mp.tokens.splice(mp.tokens.indexOf(t), 1); return {}; }
      const f = p.fields || {};
      if ("name" in f) t.name = str(f.name, 40);
      if ("color" in f) t.color = validColor(f.color);
      if ("size" in f) t.size = clamp(int(f.size, 1), 1, 4);
      // a Tiny creature (audit 8.15) still takes its square for walls, fog and the combat view; it's drawn smaller
      if ("tiny" in f) { if (f.tiny && (t.size || 1) === 1) t.tiny = true; else delete t.tiny; }
      if ((t.size || 1) > 1) delete t.tiny;
      // elevation or flying height in feet (audit 8.14), in 5-ft steps; 0 is the ground and isn't kept
      if ("elev" in f) { const e = Math.round(clamp(int(f.elev), -9995, 99995) / 5) * 5; if (e) t.elev = e; else delete t.elev; }
      if ("hidden" in f && gm) t.hidden = !!f.hidden;
      if ("nameHidden" in f && gm) t.nameHidden = !!f.nameHidden;
      if ("img" in f) t.img = validImg(f.img);
      return {};
    }

    // ---- map: settings, background, floor, props (GM)
    // ---- scenes (GM): named map setups. The live map always belongs to the active scene; switching
    // keeps the current map's changes in its scene first, then puts the chosen scene on everyone's screen.
    case "scene.saveAs": case "scene.new": {
      need(gm);
      camp.scenes = camp.scenes || [];
      if (camp.scenes.length >= 30) throw new Invalid("That's the most scenes a table can keep (30). Delete one first.");
      const name = str(p.name, 60).trim() || "Untitled scene";
      stashScene(camp);
      if (type === "scene.new") {   // a blank board with the same grid settings
        const old = mp;
        camp.map = { bgVersion: int(old.bgVersion) + 1, bgUrl: null, floor: null, floorScale: 1, gridSize: old.gridSize || 70, gridV2: true,
          cols: old.cols || 24, rows: old.rows || 16, tokens: [], props: [], showGrid: old.showGrid !== false };
      }
      const sc = { id: rid(), name, savedAt: now(), map: JSON.parse(JSON.stringify(camp.map)) };
      if (type === "scene.new") sceneWipe(camp);   // "save as" keeps the same board on screen, so no wipe
      camp.scenes.push(sc);
      camp.activeScene = sc.id;
      camp.map.sceneId = sc.id;
      return { id: sc.id };
    }
    case "scene.save": {
      need(gm);
      if (!stashScene(camp)) throw new Invalid("There's no scene to save into yet. Use \"Save as new scene\".");
      return {};
    }
    case "scene.load": {
      need(gm);
      const sc = (camp.scenes || []).find((x) => x.id === p.id);
      if (!sc) throw new Invalid("No such scene.");
      if (sc.id === camp.activeScene) return {};
      stashScene(camp);
      const bgv = int(mp.bgVersion) + 1;
      camp.map = JSON.parse(JSON.stringify(sc.map));
      camp.map.bgVersion = bgv;
      camp.map.sceneId = sc.id;
      camp.activeScene = sc.id;
      sceneWipe(camp);
      camp.sceneFx.moves = playMoves(camp, "scene");   // movements waiting for combat keep waiting
      addChat(camp, { system: true, text: `The scene changes: ${sc.name}.` });
      return {};
    }
    case "scene.rename": {
      need(gm);
      const sc = (camp.scenes || []).find((x) => x.id === p.id);
      if (sc) sc.name = str(p.name, 60).trim() || sc.name;
      return {};
    }
    case "scene.delete": {
      need(gm);
      const sc = (camp.scenes || []).find((x) => x.id === p.id);
      if (!sc) return {};
      camp.scenes = camp.scenes.filter((x) => x.id !== sc.id);
      if (camp.activeScene === sc.id) { camp.activeScene = null; delete mp.sceneId; }
      // the deleted scene's own images go too, unless something else still shows them (checked by the caller)
      return { dropImages: [sc.map.bgUrl, sc.map.floor] };
    }
    // "Look here" (audit 8.13): anyone's ping pulses on every map for a few seconds; one a second each
    case "map.ping": {
      const t = now(), x = Number(p.x), y = Number(p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Invalid("Where?");
      camp.pings = (Array.isArray(camp.pings) ? camp.pings : []).filter((q) => q && t - q.ts < 15);
      if (camp.pings.some((q) => q.by === cid && t - q.ts < 1)) return {};
      camp.pings.push({ id: rid(), x: clamp(x, -50, 300), y: clamp(y, -50, 300), by: cid, gm: !!gm, ts: t });
      camp.pings = camp.pings.slice(-8);
      return {};
    }
    case "map.draw": {   // the GM's freehand stroke
      need(gm);
      const [d] = cleanDrawings([{ pts: p.pts, c: p.c }]);
      if (!d) throw new Invalid("Nothing to draw.");
      mp.drawings = cleanDrawings([...(mp.drawings || []), d]);   // (a clear leaves none; cleanMap drops the empty list)
      return { id: d.id };
    }
    case "map.drawClear": { need(gm); const left = p.id ? (mp.drawings || []).filter((d) => d.id !== String(p.id)) : []; if (left.length) mp.drawings = left; else delete mp.drawings; return {}; }
    case "map.settings":
      need(gm);
      for (const k of ["gridSize", "cols", "rows"]) if (k in p) mp[k] = clamp(int(p[k], mp[k]), 5, 200);
      if ("showGrid" in p) mp.showGrid = !!p.showGrid;
      return {};
    case "map.bg": { // url is a library image or an image this server stored for us
      need(gm);
      const old = mp.bgUrl;
      mp.bgUrl = validImg(p.url);
      mp.bgVersion = int(mp.bgVersion) + 1;
      return { dropImages: [old] };
    }
    case "map.floor":
      need(gm);
      mp.floor = validImg(p.src);
      mp.floorScale = clamp(num(p.scale, mp.floorScale || 1), 0.1, 8);
      return {};
    case "prop.clear": need(gm); mp.props = []; return {};
    case "prop.add": {
      need(gm);
      const src = validImg(p.src);
      if (!src) throw new Invalid("pick an image from the asset library");
      if (mp.props.length >= 1500) throw new Invalid("too many props on this map");
      const pr = { id: rid(), src, name: str(p.name, 60) };
      for (const [k, d] of [["x", 0], ["y", 0], ["w", 1], ["h", 1], ["rot", 0]]) pr[k] = Math.round(num(p[k], d) * 1000) / 1000;
      if (p.blocksSight) pr.blocksSight = true;   // a duplicate keeps it
      mp.props.push(pr);
      return { id: pr.id };
    }
    case "prop.remove": case "prop.update": case "prop.order": {
      need(gm);
      const pr = mp.props.find((x) => x.id === p.id);
      if (!pr) return {};
      if (type === "prop.remove") mp.props.splice(mp.props.indexOf(pr), 1);
      else if (type === "prop.update") {
        for (const [k, v] of Object.entries(p.fields || {})) if (["x", "y", "w", "h", "rot"].includes(k)) pr[k] = Math.round(num(v, pr[k]) * 1000) / 1000;
        if ("blocksSight" in (p.fields || {})) { if (p.fields.blocksSight) pr.blocksSight = true; else delete pr.blocksSight; }
      } else { mp.props.splice(mp.props.indexOf(pr), 1); p.dir === "back" ? mp.props.unshift(pr) : mp.props.push(pr); }
      return {};
    }

    // ---- GM tools
    case "notes.save": need(gm); camp.notes = str(p.notes, 500000); return { quiet: true };
    case "campaign.rename": need(gm); camp.name = str(p.name, 80) || camp.name; return {};
    case "handout.save": {
      need(gm);
      const h = p.handout || {};
      const clean = { id: /^[a-z0-9]{6,20}$/.test(h.id || "") ? h.id : rid(), title: str(h.title, 200), text: str(h.text, 20000), img: validImg(h.img), shared: !!h.shared };
      if ((camp.handouts || []).length >= 100 && !(camp.handouts || []).some((x) => x.id === clean.id)) throw new Invalid("too many handouts");
      camp.handouts = (camp.handouts || []).filter((x) => x.id !== clean.id).concat(clean);
      if (clean.shared && p.announce) addChat(camp, { system: true, text: `New handout: ${clean.title || "Untitled"}` });
      return {};
    }
    case "handout.delete": {
      need(gm);
      const h = (camp.handouts || []).find((x) => x.id === p.id);
      camp.handouts = (camp.handouts || []).filter((x) => x.id !== p.id);
      return { dropImages: [h && h.img] };
    }
    // ---- level ups: the GM grants, the player (or the GM for an absent player) picks how to level
    // XP after an encounter (audit 9.8): the GM gives an amount, split evenly among the characters chosen. Nobody
    // levels by themselves: the GM is told who has reached the next level's XP and grants it when it suits the story.
    case "xp.award": {
      need(gm);
      const amount = clamp(int(p.amount), 0, 1000000);
      if (!amount) throw new Invalid("How much XP?");
      const ids = [...new Set((Array.isArray(p.chars) ? p.chars : []).map(String))].filter((id) => /^[a-z0-9]{6,20}$/.test(id) && charById(camp, id)).slice(0, 30);
      if (!ids.length) throw new Invalid("Pick who gets the XP.");
      const each = Math.floor(amount / ids.length), ready = [];
      const gmOwned = (ch) => !ch.owner || ((camp.players || {})[ch.owner] || {}).role === "gm";
      for (const id of ids) {
        const ch = charById(camp, id), lvl = totalLevel(ch);
        ch.xp = clamp(num(ch.xp, 0) + each, 0, 10000000);
        if (lvl >= 1 && lvl < 20 && ch.xp >= XP_FOR_LEVEL[lvl]) ready.push(`${ch.name} (${num(ch.xp, 0).toLocaleString("en-US")} XP, level ${lvl + 1} at ${XP_FOR_LEVEL[lvl].toLocaleString("en-US")})`);
      }
      const named = ids.map((id) => charById(camp, id)).filter((ch) => !gmOwned(ch)).map((ch) => ch.name), more = ids.length - named.length;
      const why = str(p.reason, 80).trim();
      addChat(camp, { system: true, text: `${why ? why + ": " : ""}${amount.toLocaleString("en-US")} XP, ${each.toLocaleString("en-US")} each for ${[...named, ...(more ? [`${more} more`] : [])].join(", ")}.` });
      if (ready.length) addChat(camp, { system: true, to: ["@gm"], private: true, text: `Enough XP for the next level: ${ready.join("; ")}. Grant it from the GM tab when it suits the story.` });
      return { each, ready: ready.length };
    }
    case "npc.save": {   // a new NPC template, or a change to one (same id)
      need(gm);
      const t = cleanNpc(p.npc);
      if (!t) throw new Invalid("An NPC needs a name.");
      const list = cleanNpcs(camp.npcs), at = list.findIndex((x) => x.id === t.id);
      if (at < 0 && list.length >= 100) throw new Invalid("That's the most NPCs a table can keep (100). Delete one first.");
      if (at < 0) list.push(t); else list[at] = t;
      camp.npcs = list;
      return { id: t.id };
    }
    case "npc.remove": need(gm); camp.npcs = cleanNpcs(camp.npcs).filter((x) => x.id !== String(p.id || "")); return {};
    case "levelup.grant": {
      need(gm);
      const ids = (Array.isArray(p.charIds) ? p.charIds : []).filter((id) => charById(camp, id));
      if (!ids.length) throw new Invalid("Pick at least one character.");
      camp.levelUps = camp.levelUps || {};
      const names = [];
      for (const id of ids) {
        const pend = camp.levelUps[id] || { count: 0 };
        if (totalLevel(chars[id]) + pend.count >= 20) continue;
        pend.count += 1; pend.grantId = rid(); pend.at = now();
        camp.levelUps[id] = pend;
        names.push(chars[id].name || "Someone");
      }
      if (!names.length) throw new Invalid("Those characters are already level 20.");
      const reason = str(p.reason, 200).trim();
      addChat(camp, { levelup: true, text: `⬆ Level up! ${names.join(", ")} ${names.length > 1 ? "have" : "has"} earned a new level${reason ? ": " + reason : ""}.` });
      return { granted: names.length };
    }
    // the GM takes back a character's last level (audit 2.15): the sheet goes back to just before it, and the level
    // is granted again so it can be taken properly. Anything changed on the sheet since is lost (the GM is asked first).
    case "levelup.undo": {
      need(gm);
      const id = String(p.charId || ""), u = Object.prototype.hasOwnProperty.call(camp.levelUndo || {}, id) && camp.levelUndo[id];
      const cur = charById(camp, id);
      if (!u || !cur) throw new Invalid("There's no level to undo for that character.");
      const back = cleanChar(Object.assign({}, u.sheet, { id }));
      back.owner = cur.owner; back.image = cur.image || ""; back.tokenImage = cur.tokenImage || ""; back.updated = now();
      if (cur.downtime) back.downtime = cur.downtime; else delete back.downtime;   // days granted and spent since stay (11.1, #226 review)
      if (cur.craft) back.craft = cur.craft; else delete back.craft;   // and the crafts asked for since, which spent them (11.2)
      chars[id] = back;
      for (const e of camp.initiative.entries) if (e.charId === id) { e.hp = (back.hp || {}).current; e.maxHp = (back.hp || {}).max; }
      camp.levelUps = camp.levelUps || {};
      const pend = camp.levelUps[id] || { count: 0 };
      pend.count += 1; pend.grantId = rid(); pend.at = now(); camp.levelUps[id] = pend;
      delete camp.levelUndo[id];
      addChat(camp, { levelup: true, text: `↶ The GM took back ${back.name}'s level ${u.level}. It's ready to take again.` });
      return { level: totalLevel(back) };
    }
    case "sheet.revert": {   // the GM puts back one recorded change's numbers (12.5); lists of things are shown, not undone
      need(gm);
      const id = String(p.charId || ""), ch = charById(camp, id);
      const e = ch && ((camp.sheetLog || {})[id] || []).find((x) => x.id === String(p.entry || ""));
      if (!e) throw new Invalid("That change isn't in the record any more.");
      const before = JSON.parse(JSON.stringify(ch));
      for (const c of e.changes) {
        if (c.view) continue;
        const path = c.k.split("."), last = path.pop();
        let o = ch; for (const k of path) { if (!o[k] || typeof o[k] !== "object") o[k] = {}; o = o[k]; }
        o[last] = c.from;
      }
      const back = cleanChar(Object.assign({}, ch, { id }));
      Object.assign(back, { owner: ch.owner, image: ch.image || "", tokenImage: ch.tokenImage || "", updated: now() });
      chars[id] = back;
      for (const en of camp.initiative.entries) if (en.charId === id) { en.hp = (back.hp || {}).current; en.maxHp = (back.hp || {}).max; }
      const changes = sheetDiff(before, back);
      if (changes.length) camp.sheetLog[id] = [...camp.sheetLog[id], { id: rid(), ts: now(), by: "GM (undo)", changes }].slice(-30);
      return { undone: changes.length };
    }
    case "levelup.cancel": {
      need(gm);
      if (camp.levelUps && camp.levelUps[p.charId]) delete camp.levelUps[p.charId];
      return {};
    }
    case "levelup.apply":
      return applyLevelUp(camp, cid, gm, p);

    // ---- each person's own colour theme (only changes what they see)
    case "player.prefs": {
      const theme = String(p.theme || "holo-blue");
      if (!/^[a-z0-9-]{1,40}$/.test(theme)) throw new Invalid("bad theme");
      if (theme.startsWith("gm-") && !gm) throw new Forbidden("That theme is the GM's.");
      const custom = {};
      for (const k of ["bg", "panel", "text", "holo", "amber"]) {
        const v = (p.custom || {})[k];
        if (v !== undefined && v !== null && v !== "") custom[k] = validColor(v, null);
      }
      for (const k of Object.keys(custom)) if (!custom[k]) delete custom[k];
      (camp.players[cid] = camp.players[cid] || {}).prefs = { theme, custom };
      return {};
    }
    case "player.rename":
      (camp.players[cid] = camp.players[cid] || {}).name = str(p.name, 40) || "Player";
      return {};
    case "player.remove": {   // the GM clears a stale entry from the player list (an old sign-in nobody uses any more)
      need(gm);
      const id = String(p.id || "");
      if (!Object.prototype.hasOwnProperty.call(camp.players, id)) throw new Invalid("No such player.");
      if (id === cid) throw new Invalid("That's you.");
      // nobody's character is left without an owner: the GM gives it to someone else first
      const owns = Object.values(chars).filter((c) => c && c.owner === id).map((c) => c.name || "a character");
      if (owns.length) throw new Invalid(`${playerName(camp, id)} still owns ${owns.join(", ")}. Give ${owns.length > 1 ? "them" : "it"} to someone else first (Owner, on the sheet).`);
      // chat keeps the names it was written with; someone still signed in comes back as the same person next time
      delete camp.players[id];
      return {};
    }
    case "chat.clear": need(gm); camp.chat = []; return {};

    // ---- the party stash (6.9) and loot (9.10)
    case "stash.add": {   // the GM puts items and/or credits in: loot rolled from SW5e's list, or anything by hand
      need(gm);
      const st = cleanStash(camp.stash) || { credits: 0, items: [] };
      const add = (Array.isArray(p.items) ? p.items : []).slice(0, 50).map((x) => cleanStashItem(Object.assign({}, x, { id: undefined }))).filter(Boolean);
      const cr = clamp(int(p.credits), 0, 1e9);
      if (!add.length && !cr) throw new Invalid("Nothing to put in.");
      if (st.items.length + add.length > 200) throw new Invalid("The stash holds 200 items at most.");
      st.items.push(...add); st.credits = clamp(st.credits + cr, 0, 1e9);
      camp.stash = st;
      if (!p.quiet) addChat(camp, { system: true, text: `🎒 Into the party stash: ${[...add.map(itemLabel), ...(cr ? [`${cr.toLocaleString("en-US")} credits`] : [])].join(", ")}.` });
      return { added: add.length };
    }
    case "stash.take": {   // an item onto a character's sheet: a player onto their own, the GM onto anyone
      const st = cleanStash(camp.stash), ch = charById(camp, p.charId);
      const at = st ? st.items.findIndex((x) => x.id === String(p.id || "")) : -1;
      if (at < 0) throw new Invalid("That's no longer in the stash.");
      if (!ch) throw new Invalid("No such character.");
      need(gm || ch.owner === cid, "not your character");
      if ((ch.equipment || []).length >= 200) throw new Invalid(`${ch.name}'s gear is full (200 items). Make room first; it stays in the stash.`);   // #195 review
      const [it] = st.items.splice(at, 1);
      const notes = [it.rar && `${it.rar}${it.att ? ", requires attunement" : ""}`, it.notes].filter(Boolean).join(" · ").slice(0, 200);
      chars[ch.id] = cleanChar(Object.assign({}, ch, { equipment: [...(ch.equipment || []), Object.assign({}, it, { id: undefined, equipped: false, notes })] }));
      Object.assign(chars[ch.id], { owner: ch.owner, image: ch.image || "", tokenImage: ch.tokenImage || "", updated: now() });
      camp.stash = cleanStash(st); if (!camp.stash) delete camp.stash;
      addChat(camp, { system: true, text: `🎒 ${shownName(camp, { charId: ch.id, name: ch.name })} takes ${itemLabel(it)} from the party stash.` });
      return {};
    }
    case "stash.split": {   // the GM shares the stash's credits evenly among the characters picked; what's left stays
      need(gm);
      const st = cleanStash(camp.stash);
      const ids = [...new Set((Array.isArray(p.chars) ? p.chars : []).map(String))].filter((id) => /^[a-z0-9]{6,20}$/.test(id) && charById(camp, id)).slice(0, 30);
      if (!st || !st.credits) throw new Invalid("No credits in the stash.");
      if (!ids.length) throw new Invalid("Pick who gets a share.");
      const each = Math.floor(st.credits / ids.length);
      if (!each) throw new Invalid("Not enough credits for a share each.");
      for (const id of ids) { const c = charById(camp, id); c.credits = clamp(num(c.credits, 0) + each, 0, 1e9); }
      st.credits -= each * ids.length;
      camp.stash = cleanStash(st); if (!camp.stash) delete camp.stash;
      addChat(camp, { system: true, text: `🎒 The stash's credits are shared out: ${each.toLocaleString("en-US")} each.` });
      return { each };
    }
    case "stash.remove": {
      need(gm);
      const st = cleanStash(camp.stash);
      if (st) { st.items = st.items.filter((x) => x.id !== String(p.id || "")); if (p.credits) st.credits = 0; }
      camp.stash = cleanStash(st); if (!camp.stash) delete camp.stash;
      return {};
    }

    // ---- in-game time (audit 9.18): a day count and the time of day, the GM's to set and move on; everyone sees it
    case "clock.set": {
      need(gm);
      if (p.off) { delete camp.clock; return {}; }
      camp.clock = cleanClock({ day: p.day, min: p.min });
      return { clock: camp.clock };
    }
    case "clock.advance": {
      need(gm);
      const mins = clamp(int(p.mins), 1, 365 * 1440);
      const c = cleanClock(camp.clock || { day: 1, min: 8 * 60 }), total = c.min + mins;
      camp.clock = cleanClock({ day: c.day + Math.floor(total / 1440), min: total % 1440 });
      if (p.announce !== false) {
        const span = mins % 1440 === 0 ? `${mins / 1440} day${mins === 1440 ? "" : "s"}` : mins % 60 === 0 ? `${mins / 60} hour${mins === 60 ? "" : "s"}` : `${mins} minutes`;
        const why = str(p.why, 60).trim();
        addChat(camp, { system: true, text: `🕑 ${span} pass${why ? ` (${why})` : ""}. It's now ${clockText(camp.clock)}.` });
      }
      return { clock: camp.clock };
    }

    // ---- which SW5e variant rules this table uses (the GM decides; everyone sees the list)
    case "variants.set": {
      need(gm); camp.variants = cleanVariants(p.variants);
      // a variant the GM stops using stops counting on the sheets too
      if (!camp.variants.includes("Simplified Forcecasting")) for (const c of Object.values(chars)) delete c.forceAbility;
      return {};
    }

    // ---- table audio: the GM plays an uploaded track for everyone; each screen keeps itself in step
    case "audio.play": {   // start (or resume) a track at a position
      need(gm);
      if (!/^au[a-f0-9]{12}$/.test(String(p.track || ""))) throw new Invalid("No such track.");
      const cur = camp.audio || {};
      camp.audio = { track: p.track, name: str(p.name, 80) || "Track", playing: true, pos: clamp(num(p.pos), 0, 86400), at: now(),
        loop: "loop" in p ? !!p.loop : !!cur.loop, vol: "vol" in p ? clamp(num(p.vol, 1), 0, 1) : clamp(num(cur.vol, 1), 0, 1) };
      return {};
    }
    case "audio.pause": {
      need(gm);
      if (!camp.audio) return {};
      Object.assign(camp.audio, { playing: false, pos: clamp(num(p.pos), 0, 86400), at: now() });
      return {};
    }
    case "audio.set": {    // loop and the table's master volume
      need(gm);
      if (!camp.audio) return {};
      if ("loop" in p) camp.audio.loop = !!p.loop;
      if ("vol" in p) camp.audio.vol = clamp(num(p.vol, 1), 0, 1);
      return {};
    }
    case "audio.stop": need(gm); camp.audio = null; return {};
    // whether players may take the hit die's maximum when levelling (the GM's table rule)
    case "settings.hpMax": need(gm); camp.hpMax = !!p.on; return {};
    case "settings.sheetLock": need(gm); if (p.on) camp.sheetLock = true; else delete camp.sheetLock; return {};   // 12.6
    case "settings.statBlocks": need(gm); if (p.hidden) camp.statBlocksHidden = true; else delete camp.statBlocksHidden; return {};   // 9.17

    // ---- starships: the party's ships can be edited by anyone at the table; hidden (enemy) ships only by the GM
    case "ship.save": {
      if (!p.ship || typeof p.ship !== "object" || Array.isArray(p.ship)) throw new Invalid("bad ship");
      camp.ships = camp.ships || [];
      const i = camp.ships.findIndex((x) => x.id === p.ship.id);
      const old = i >= 0 ? camp.ships[i] : null;
      if (old) need(gm || !old.hidden, "That ship is the GM's.");
      else if (camp.ships.length >= MAX_SHIPS) throw new Invalid(`A table can have up to ${MAX_SHIPS} ships.`);
      const sh = cleanShip(Object.assign({}, p.ship, { id: old ? old.id : rid(), owner: old ? old.owner : cid }), chars);
      Ships.keepStatus(sh, old, gm);   // the fight state (conditions, destruction saves) is the server's; points stay inside the maximums
      if (!gm) sh.hidden = old ? old.hidden : false;
      if (old) camp.ships[i] = sh; else camp.ships.push(sh);
      return { id: sh.id };
    }
    case "ship.delete": {
      camp.ships = camp.ships || [];
      const sh = camp.ships.find((x) => x.id === p.id);
      if (!sh) return {};
      need(gm || (sh.owner === cid && !sh.hidden), "Only the GM or the ship's creator can delete it.");
      camp.ships = camp.ships.filter((x) => x.id !== p.id);
      return {};
    }
  }
  throw new Invalid("unknown action " + str(type, 40));
}

// A whole game coming back from a backup file gets the same checks as live edits.
// Props the GM marked "Blocks sight" (a crate stack, a parked freighter, a pillar), as wall-like segments for line of
// sight: each one's rotated rectangle, four edges in grid squares ({ a: [x, y], b: [x, y] }, rounded to 0.01 like walls).
function propSightSegments(map) {
  const out = [], r2 = (v) => Math.round(v * 100) / 100;
  for (const p of (map && map.props) || []) {
    if (!p || !p.blocksSight) continue;
    const w = +p.w || 1, h = +p.h || 1, cx = (+p.x || 0) + w / 2, cy = (+p.y || 0) + h / 2, a = ((+p.rot || 0) * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([dx, dy]) => [r2(cx + dx * c - dy * s), r2(cy + dx * s + dy * c)]);
    for (let i = 0; i < 4; i++) out.push({ a: pts[i], b: pts[(i + 1) % 4], prop: p.id });
  }
  return out;
}

const tempPts = (v) => (clamp(int(v), 0, 999) ? { temp: clamp(int(v), 0, 999) } : {});   // temporary force/tech points (4.9)
// The GM's own NPCs (audit 9.9): saved templates that go into initiative like an SW5e creature. GM-only.
// attacks: { n: name, hit: attack bonus, dmg: a damage expression and type }, rolled GM-only from the tracker's card.
function cleanNpc(t) {
  if (!t || typeof t !== "object") return null;
  const name = str(t.name, 60).trim();
  if (!name) return null;
  return {
    id: /^[a-z0-9]{4,20}$/.test(String(t.id || "")) ? String(t.id) : rid(),
    name, bonus: clamp(int(t.bonus), -10, 20), hp: clamp(int(t.hp, 1), 1, 9999), ac: clamp(int(t.ac, 10), 0, 40),
    attacks: (Array.isArray(t.attacks) ? t.attacks : []).slice(0, 12).filter((a) => a && typeof a === "object" && str(a.n, 60).trim())
      .map((a) => ({ n: str(a.n, 60).trim(), hit: clamp(int(a.hit), -10, 30), dmg: str(a.dmg, 60).trim() })),
    notes: str(t.notes, 2000),
  };
}
const cleanNpcs = (list) => (Array.isArray(list) ? list : []).slice(0, 100).map(cleanNpc).filter(Boolean)
  .filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);
// The GM's quick drawings on the map (audit 8.13): freehand strokes in grid units, everyone sees them
const DRAW_COLORS = ["#ffd27a", "#4fc3f7", "#ef5350", "#66bb6a", "#ffffff"];
function cleanDrawings(list) {
  return (Array.isArray(list) ? list : []).slice(-60).filter((d) => d && typeof d === "object" && Array.isArray(d.pts)).map((d) => ({
    id: /^[a-z0-9]{4,20}$/.test(String(d.id || "")) ? String(d.id) : rid(),
    c: DRAW_COLORS.includes(d.c) ? d.c : DRAW_COLORS[0],
    pts: d.pts.slice(0, 600).map((v) => Math.round(clamp(Number.isFinite(+v) ? +v : 0, -50, 300) * 100) / 100).slice(0, d.pts.length - (d.pts.length % 2)),
  })).filter((d) => d.pts.length >= 4);
}
// The party stash (audit 6.9) and loot (9.10): items in the sheet's own shape (#167) plus the rarity and attunement
// SW5e gives an enhanced item, each with an id so two people moving things at once can't take the wrong one.
const RARITIES = ["Standard", "Premium", "Prototype", "Advanced", "Legendary", "Artifact"];
function cleanStashItem(e) {
  if (!e || typeof e !== "object") return null;
  const name = str(e.name, 80).trim();
  if (!name) return null;
  return {
    id: /^[a-z0-9]{4,20}$/.test(String(e.id || "")) ? String(e.id) : rid(),
    name, qty: clamp(int(e.qty, 1), 1, 999), notes: str(e.notes, 200),
    ...(RARITIES.includes(e.rar) ? { rar: e.rar } : {}), ...(e.att ? { att: true } : {}),
    ...(R.cleanArmor(e.armor) ? { armor: R.cleanArmor(e.armor) } : {}),
  };
}
function cleanStash(st) {
  if (!st || typeof st !== "object") return null;
  const items = (Array.isArray(st.items) ? st.items : []).slice(0, 200).map(cleanStashItem).filter(Boolean)
    .filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i);
  const credits = clamp(int(st.credits), 0, 1e9);
  return items.length || credits ? { credits, items } : null;
}
const itemLabel = (it) => `${it.qty > 1 ? it.qty + "× " : ""}${it.name}${it.rar ? ` (${it.rar})` : ""}`;
// in-game time (9.18): day 1 and up, minutes into the day 0-1439
function cleanClock(c) {
  if (!c || typeof c !== "object") return null;
  return { day: clamp(int(c.day, 1), 1, 999999), min: clamp(int(c.min), 0, 1439) };
}
const clockText = (c) => `Day ${c.day}, ${String(Math.floor(c.min / 60)).padStart(2, "0")}:${String(c.min % 60).padStart(2, "0")}`;
// A record of sheet changes (audit 12.5): each save that changes a tracked number notes who changed what, from and
// to. The GM reads it on the sheet and can put any one change's numbers back. The last 30 changes per character.
const TRACKED = [["name"], ["xp"], ["credits"], ["ac"], ["speed"], ["hp", "max"], ["hp", "current"], ["hp", "temp"],
  ["force", "used"], ["tech", "used"], ["exhaustion"], ["inspiration"], ...["str", "dex", "con", "int", "wis", "cha"].map((a) => ["abilities", a])];
const getIn = (o, p) => p.reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);
const levelsText = (c) => (c.classes || []).map((k) => `${k.name} ${k.level}`).join(" / ");
const prim = (v) => (typeof v === "number" || typeof v === "boolean" ? v : v == null ? null : String(v).slice(0, 80));
function sheetDiff(a, b) {
  const out = [];
  for (const p of TRACKED) { const x = prim(getIn(a, p)), y = prim(getIn(b, p)); if (x !== y) out.push({ k: p.join("."), from: x, to: y }); }
  for (const [k, f] of [["classes", levelsText], ["conditions", (c) => (c.conditions || []).join(", ")], ["equipment", (c) => (c.equipment || []).map((e) => `${e.qty > 1 ? e.qty + "× " : ""}${e.name}`).join(", ")]]) {
    const x = prim(f(a)), y = prim(f(b)); if (x !== y) out.push({ k, from: x, to: y, view: true });   // shown, not undone
  }
  return out;
}
const cleanHistory = (log, chars) => Object.fromEntries(Object.entries(log && typeof log === "object" ? log : {}).filter(([id, l]) => Object.prototype.hasOwnProperty.call(chars || {}, id) && Array.isArray(l))
  .map(([id, l]) => [id, l.slice(-30).filter((e) => e && Array.isArray(e.changes)).map((e) => ({ id: /^[a-z0-9]{4,20}$/.test(String(e.id || "")) ? String(e.id) : rid(), ts: num(e.ts), by: str(e.by, 40),
    changes: e.changes.slice(0, 30).filter((c) => c && typeof c.k === "string" && (TRACKED.some((p) => p.join(".") === c.k) || ["classes", "conditions", "equipment"].includes(c.k)))
      .map((c) => ({ k: c.k, from: prim(c.from), to: prim(c.to), ...(c.view ? { view: true } : {}) })) }))]).filter(([, l]) => l.length));
function cleanMap(g, raw) {
  const m = raw && typeof raw === "object" ? raw : {};
  const n = (v, d) => (Number.isFinite(+v) ? +v : d);
  return {
    bgVersion: int(m.bgVersion) + 1, bgUrl: validImg(m.bgUrl), floor: validImg(m.floor), floorScale: clamp(n(m.floorScale, 1), 0.1, 8),
    ...((dr) => (dr.length ? { drawings: dr } : {}))(cleanDrawings(m.drawings)),   // kept only when there are some
    gridSize: clamp(int(m.gridSize, 70), 5, 200), gridV2: true, cols: clamp(int(m.cols, 24), 5, 200), rows: clamp(int(m.rows, 16), 5, 200), showGrid: m.showGrid !== false,
    tokens: (Array.isArray(m.tokens) ? m.tokens : []).slice(0, 300).filter((t) => t && typeof t === "object").map((t) => ({
      id: /^[a-z0-9]{6,20}$/.test(t.id || "") ? t.id : rid(), name: str(t.name, 40), color: validColor(t.color), x: clamp(int(t.x), -500, 1000), y: clamp(int(t.y), -500, 1000),
      size: clamp(int(t.size, 1), 1, 4), ...(t.tiny && clamp(int(t.size, 1), 1, 4) === 1 ? { tiny: true } : {}),
      ...((e) => (e ? { elev: e } : {}))(Math.round(clamp(int(t.elev), -9995, 99995) / 5) * 5), charId: charById(g, t.charId) ? t.charId : null, owner: str(t.owner, 40), hidden: !!t.hidden, nameHidden: !!t.nameHidden, img: validImg(t.img), moves: cleanMoves(t.moves) })),
    ...(Array.isArray(m.walls) && m.walls.length ? { walls: Fight.cleanWalls(m.walls) } : {}),   // the combat view's walls (issue #93), only on a map that has some
    ...(m.fog && typeof m.fog === "object" ? { fog: Fight.cleanFog(m.fog) } : {}),   // fog of war (issue #93), only on a map the GM switched it on for
    ...(m.light && typeof m.light === "object" ? { light: Fight.cleanLight(m.light) } : {}),   // its light (#93 step 5), only on a map the GM dimmed or lit
    props: (Array.isArray(m.props) ? m.props : []).slice(0, 1500).filter((p) => p && validImg(p.src)).map((p) => ({
      id: /^[a-z0-9]{6,20}$/.test(p.id || "") ? p.id : rid(), src: p.src, name: str(p.name, 60), x: n(p.x, 0), y: n(p.y, 0), w: n(p.w, 1), h: n(p.h, 1), rot: n(p.rot, 0), moves: cleanMoves(p.moves), ...(p.blocksSight ? { blocksSight: true } : {}) })),
    sceneId: /^[a-z0-9]{6,20}$/.test(m.sceneId || "") ? m.sceneId : undefined,
  };
}
function cleanGame(g) {
  const n = (v, d) => (Number.isFinite(+v) ? +v : d);   // initiative numbers (cleanMap has its own copy)
  g.map = cleanMap(g, g.map);
  const ini = g.initiative && typeof g.initiative === "object" ? g.initiative : {};
  g.initiative = {
    turn: clamp(int(ini.turn), 0, 300), round: Math.max(1, int(ini.round, 1)), active: !!ini.active,
    entries: (Array.isArray(ini.entries) ? ini.entries : []).slice(0, 300).filter((e) => e && typeof e === "object").map((e) => ({
      id: /^[a-z0-9]{6,20}$/.test(e.id || "") ? e.id : rid(), name: str(e.name, 60), init: n(e.init, 0), charId: charById(g, e.charId) ? e.charId : null,
      npc: !!e.npc, hidden: !!e.hidden, hp: nullNum(e.hp), maxHp: nullNum(e.maxHp), ac: nullNum(e.ac), dexTie: n(e.dexTie, 0),
      sb: e.npc && e.sb ? str(e.sb, 80) : undefined,
      conditions: (Array.isArray(e.conditions) ? e.conditions : []).slice(0, 20).map((c) => str(c, 30)) })),
  };
  g.handouts = (Array.isArray(g.handouts) ? g.handouts : []).slice(0, 100).filter((h) => h && typeof h === "object").map((h) => ({
    id: /^[a-z0-9]{6,20}$/.test(h.id || "") ? h.id : rid(), title: str(h.title, 200), text: str(h.text, 20000), img: validImg(h.img), shared: !!h.shared }));
  g.chat = (Array.isArray(g.chat) ? g.chat : []).slice(-CHAT_LIMIT).filter((c) => c && typeof c === "object");
  g.notes = str(g.notes, 500000);
  g.variants = cleanVariants(g.variants);
  const au = g.audio && typeof g.audio === "object" ? g.audio : null;
  g.audio = au && /^au[a-f0-9]{12}$/.test(String(au.track || "")) ? { track: au.track, name: str(au.name, 80) || "Track", playing: !!au.playing,
    pos: clamp(num(au.pos), 0, 86400), at: num(au.at, now()), loop: !!au.loop, vol: clamp(num(au.vol, 1), 0, 1) } : null;
  g.hpMax = g.hpMax !== false;
  if (g.stash) g.stash = cleanStash(g.stash); if (!g.stash) delete g.stash;
  if (g.clock) g.clock = cleanClock(g.clock); if (!g.clock) delete g.clock;
  if (g.sheetLock !== true) delete g.sheetLock;
  if (g.statBlocksHidden !== true) delete g.statBlocksHidden;
  if (Array.isArray(g.npcs) && g.npcs.length) g.npcs = cleanNpcs(g.npcs); else delete g.npcs;
  g.ask = Ask.clean(g.ask, g.characters);
  Story.clean(g);
  g.ships = (Array.isArray(g.ships) ? g.ships : []).slice(0, MAX_SHIPS).filter((x) => x && typeof x === "object").map((x) => cleanShip(x, g.characters));
  if (g.space) g.space = Space.clean(g.space, g.ships);
  g.scenes = (Array.isArray(g.scenes) ? g.scenes : []).slice(0, 30).filter((x) => x && typeof x === "object")
    .map((x) => ({ id: /^[a-z0-9]{6,20}$/.test(x.id || "") ? x.id : rid(), name: str(x.name, 60) || "Scene", savedAt: num(x.savedAt, now()), map: cleanMap(g, x.map) }));
  if (!g.scenes.some((x) => x.id === g.activeScene)) g.activeScene = null;
  const fx = g.sceneFx && typeof g.sceneFx === "object" ? g.sceneFx : null;
  g.sceneFx = fx && /^[a-f0-9]{6,20}$/.test(fx.n || "") ? { n: fx.n, k: clamp(int(fx.k), -1, SCENE_WIPES - 1) } : null;
  if (g.fight !== undefined) Fight.restored(g);   // the combat view's own record, checked like a live one (absent: stays absent)
  // the GM's undo of a last level (2.15): one per character, the sheet cleaned like any other
  const lu = Object.entries(g.levelUndo && typeof g.levelUndo === "object" ? g.levelUndo : {}).filter(([id, u]) => charById(g, id) && u && u.sheet && typeof u.sheet === "object")
    .map(([id, u]) => [id, { level: clamp(int(u.level, 1), 1, 20), at: num(u.at), sheet: cleanChar(Object.assign({}, u.sheet, { id })) }]);
  if (lu.length) g.levelUndo = Object.fromEntries(lu); else delete g.levelUndo;
  const sl = cleanHistory(g.sheetLog, g.characters); if (Object.keys(sl).length) g.sheetLog = sl; else delete g.sheetLog;
  g.levelUps = Object.fromEntries(Object.entries(g.levelUps || {}).filter(([id]) => charById(g, id))
    .map(([id, v]) => [id, { count: clamp(int((v || {}).count), 0, 20), grantId: rid(), at: now() }]).filter(([, v]) => v.count > 0));
  return g;
}

module.exports = {
  cleanGame,
  rollDice, blankCampaign, playerName, addChat, viewFor, shownName, propSightSegments, SPECIES_SENSES, DOWNTIME_ACTS: Downtime.ACT_TABLES, FEAT_ASI, validImg, validColor, cleanChar, cleanShip, rid, charById,
  applyAction: (camp, ...a) => { const out = applyAction(camp, ...a); Fight.noteSeen(camp); return out; },   // fog of war: what players see now joins what they've explored
  Forbidden, Invalid, IMG_PREFIX,
};
