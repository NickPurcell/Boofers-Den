/* HoloTable combat engine: the rules of a fight, as pure functions. No page code, no storage, no dice of its own.
   The server (api/_holotable-fight.js) uses it to decide and apply every action; the combat view (view.js) uses the
   same code to show what is possible before anyone clicks. Experimental branch only.

   A fight is a "world": the units in the initiative order that have a token on the map, the grid, whose turn it is,
   and what that turn has spent. apply(world, action, roll) says whether one action is legal and, if it is, returns
   the new world, the log lines and the events to show on the board. roll(expr) is passed in (the server's dice), so
   the engine never decides a number by itself and tests can use loaded dice.

   What it knows in this slice: turn order, each turn's movement / action / bonus action / reaction, distance on the
   grid in feet, reach and range, weapon attacks against AC with advantage and disadvantage, natural 20s and 1s, and
   damage taken from temporary hit points first. Later rules belong in the tables below (REASONS, the attack spec,
   the budget) and in new action types, not in rewrites.

   The arithmetic HoloTable already does (attack bonus, damage expression, critical dice) is not repeated here:
   attacksOf() calls rules.js (window.SW5E / globalThis.SW5E), which the sheet uses too. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HTCombatEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FT = 5;                      // feet per square
  const no = (why) => ({ ok: false, why });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sgn = (n) => (n >= 0 ? '+' : '') + n;

  /* ---------------- geometry: a unit fills size×size squares from its top-left square (x, y) ---------------- */
  // squares between two footprints, counting diagonals as one square (adjacent = 1, overlapping = 0)
  function squaresBetween(a, b) {
    const as = a.size || 1, bs = b.size || 1;
    const dx = Math.max(0, b.x - (a.x + as - 1), a.x - (b.x + bs - 1));
    const dy = Math.max(0, b.y - (a.y + as - 1), a.y - (b.y + bs - 1));
    return Math.max(dx, dy);
  }
  const feetBetween = (a, b) => squaresBetween(a, b) * FT;
  const overlaps = (ax, ay, as, b) => ax < b.x + (b.size || 1) && b.x < ax + as && ay < b.y + (b.size || 1) && b.y < ay + as;
  const hostile = (a, b) => a.side !== b.side;

  // Every square the unit could move its top-left corner to with `feet` of movement: { "x,y": feet spent }.
  // Each step to any of the 8 neighbours is one square. A unit may pass through allies but not through enemies, and
  // may not stop where another unit stands. Units the mover can't see (hidden ones, for a player) are not in the world
  // at all, so they never give themselves away by blocking.
  function reachable(world, unitId, feet) {
    const u = world.units[unitId];
    if (!u) return {};
    const others = Object.values(world.units).filter((o) => o.id !== u.id && !o.down);
    const size = u.size || 1, steps = Math.floor(Math.max(0, feet) / FT);
    const blocked = (x, y) => others.some((o) => hostile(u, o) && overlaps(x, y, size, o));
    const occupied = (x, y) => others.some((o) => overlaps(x, y, size, o));
    const seen = { [`${u.x},${u.y}`]: 0 }, out = {};
    let frontier = [[u.x, u.y]];
    for (let s = 1; s <= steps && frontier.length; s++) {
      const next = [];
      for (const [x, y] of frontier) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy, k = `${nx},${ny}`;
          if (k in seen || nx < -500 || ny < -500 || nx > 1000 || ny > 1000 || blocked(nx, ny)) continue;
          seen[k] = s * FT;
          next.push([nx, ny]);
          if (!occupied(nx, ny)) out[k] = s * FT;
        }
      }
      frontier = next;
    }
    return out;
  }

  /* ---------------- attacks ---------------- */
  // An attack spec: { name, bonus, damage, crit, type, melee: reach in feet or 0, range: [normal, long] or null }.
  // Reach and range come from the weapon's properties text: "Reach" adds 5 ft; "Thrown (20/60)", "Range (80/320)",
  // "Ammunition (range 80/320)" give a range. A weapon with no range is melee with 5 ft reach.
  function readRange(props) {
    const p = String(props || '');
    const m = /(?:range|thrown)[^0-9]{0,12}(\d+)\s*\/\s*(\d+)/i.exec(p) || /\((\d+)\s*\/\s*(\d+)\)/.exec(p);
    const range = m ? [+m[1], +m[2]] : null;
    const thrown = /thrown/i.test(p), reach = /\breach\b/i.test(p);
    const melee = !range || thrown ? (reach ? 2 * FT : FT) : 0;
    return { melee, range };
  }
  // the attacks on a character sheet, with HoloTable's own arithmetic (rules.js)
  function attacksOf(ch, rules) {
    return (ch.attacks || []).map((a, i) => {
      const damage = rules.damageExpr(ch, a);
      return Object.assign({ key: String(i), name: a.name || 'Attack', bonus: rules.attackBonus(ch, a), damage, crit: rules.critExpr(damage), type: a.type || '' }, readRange(a.props));
    }).filter((a) => a.melee || a.range);
  }
  // a creature's attack from its stat block entry ({ n, atk, dmg, dt, rng, d } as HoloTable's creature list keeps it)
  function attackFromBehavior(b) {
    if (!b || b.atk == null || !b.dmg) return null;
    const text = `${b.rng || ''} ${b.d || ''}`;
    const reach = /reach\s*(\d+)\s*f/i.exec(text), range = /range\s*(\d+)(?:\s*\/\s*(\d+))?\s*f/i.exec(text);
    const damage = String(b.dmg).replace(/\s+/g, '');
    return {
      name: b.n, bonus: +b.atk, damage, crit: damage.replace(/(\d*)d(\d+)/gi, (_, n, s) => (2 * (+n || 1)) + 'd' + s), type: b.dt || '',
      melee: reach ? +reach[1] : range ? 0 : FT, range: range ? [+range[1], +(range[2] || range[1])] : null,
    };
  }
  // Reasons that tilt a roll. Each is data: who it applies to and which way. Conditions and features join this list later.
  const REASONS = [
    { id: 'long', dis: true, text: 'long range', when: (c) => c.ranged && c.feet > c.attack.range[0] },
    { id: 'close', dis: true, text: 'an enemy within 5 ft', when: (c) => c.ranged && c.enemyClose },
  ];
  /* ---------------- conditions that take effect (issue #72) ---------------- */
  // What each condition does to the arithmetic, following HoloTable's own descriptions in rules.js (CONDITIONS).
  // Only the plainly mechanical parts are here; a condition with no entry is a label, as it is today. Later
  // conditions (levels of Slowed or Exhaustion, Ignited's damage) are new entries, not new code.
  const CONDITION_EFFECTS = {
    Blinded: { attacks: 'dis', attacked: 'adv' },
    Frightened: { attacks: 'dis' },
    Grappled: { speed0: true },
    Incapacitated: { noActions: true },
    Invisible: { attacks: 'adv', attacked: 'dis' },
    Paralyzed: { noActions: true, speed0: true, autoFail: ['str', 'dex'], attacked: 'adv', meleeCrit: true },
    Petrified: { noActions: true, speed0: true, autoFail: ['str', 'dex'], attacked: 'adv' },
    Poisoned: { attacks: 'dis' },
    Prone: { attacks: 'dis', attacked: 'near' },          // near: advantage within 5 ft, disadvantage beyond
    Restrained: { speed0: true, attacks: 'dis', attacked: 'adv', saveDis: ['dex'] },
    Shocked: { speedHalf: true, noReactions: true },
    Stunned: { noActions: true, speed0: true, autoFail: ['str', 'dex'], attacked: 'adv' },
    Unconscious: { noActions: true, speed0: true, autoFail: ['str', 'dex'], attacked: 'adv', meleeCrit: true },
  };
  const effectsOf = (u) => (u.conditions || []).map((c) => [c, CONDITION_EFFECTS[c]]).filter(([, e]) => e);
  const has = (u, flag) => effectsOf(u).find(([, e]) => e[flag]);
  const INCAPACITATING = (u) => !!has(u, 'noActions');
  // conditions join the reasons a roll tilts: the attacker's own, then the target's
  REASONS.push(
    { id: 'self', when: (c) => effectsOf(c.actor).some(([, e]) => e.attacks), each: (c) => effectsOf(c.actor).filter(([, e]) => e.attacks).map(([n, e]) => ({ [e.attacks]: true, text: `you are ${n.toLowerCase()}` })) },
    { id: 'target', when: (c) => effectsOf(c.target).some(([, e]) => e.attacked), each: (c) => effectsOf(c.target).filter(([, e]) => e.attacked).map(([n, e]) => {
      const way = e.attacked === 'near' ? (c.feet <= FT ? 'adv' : 'dis') : e.attacked;
      return { [way]: true, text: `${c.target.name} is ${n.toLowerCase()}` };
    }) },
  );

  // Can `actorId` hit `targetId` with `attack` right now, and what would it take?
  function preview(world, actorId, targetId, attack, opts = {}) {
    const a = world.units[actorId], t = world.units[targetId];
    if (!a || !t) return { legal: false, why: 'No such target.' };
    if (a.id === t.id) return { legal: false, why: "You can't attack yourself." };
    if (t.ac == null || t.ac === '') return { legal: false, why: `${t.name} has no AC set.` };
    const feet = feetBetween(a, t);
    const inReach = attack.melee && feet <= attack.melee;
    const inRange = attack.range && feet <= attack.range[1];
    if (!inReach && !inRange) return { legal: false, why: `${t.name} is ${feet} ft away: out of ${attack.range ? 'range' : 'reach'}.`, feet };
    const ranged = !inReach;
    const enemyClose = Object.values(world.units).some((o) => o.id !== a.id && hostile(a, o) && !o.down && feetBetween(a, o) <= FT);
    const ctx = { feet, ranged, enemyClose, attack, actor: a, target: t };
    const tilts = REASONS.filter((r) => r.when(ctx)).flatMap((r) => (r.each ? r.each(ctx) : [{ dis: !!r.dis, adv: !!r.adv, text: r.text }]))
      .map((x) => ({ dis: !!x.dis, adv: !!x.adv, text: x.text }));
    if (opts.adv) tilts.push({ adv: true, text: 'chosen' });
    if (opts.dis) tilts.push({ dis: true, text: 'chosen' });
    const adv = tilts.some((x) => x.adv), dis = tilts.some((x) => x.dis);
    const mode = adv && !dis ? 'adv' : dis && !adv ? 'dis' : 'normal';
    const need = Math.min(20, Math.max(2, t.ac - attack.bonus));   // the d20 needed; a 20 always hits, a 1 always misses
    const p = (21 - need) / 20;
    const chance = mode === 'adv' ? 1 - (1 - p) ** 2 : mode === 'dis' ? p * p : p;
    return { legal: true, feet, ranged, mode, tilts, need, chance, expr: (mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20') + sgn(attack.bonus) };
  }

  /* ---------------- resources (audit 3.1) ---------------- */
  // One shape for everything that has a maximum and is spent and refilled:
  //   { key, name, max, die?, used, refill: 'turn' | 'short' | 'long' | 'manual' }
  // max and die are a plain value or { class, levels: [20 values] } read at the character's level in that class
  // ('total' = total level), so a level-up changes them with no code. Force points, tech points and hit dice stay
  // where the sheet keeps them (force.used, tech.used, hitDiceUsed) and are read and written in place.
  const REFILLS = ['turn', 'short', 'long', 'manual'];
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const totalLevel = (ch) => (ch.classes || []).reduce((a, k) => a + (+k.level || 0), 0);
  function levelIn(ch, cls) {
    if (String(cls).toLowerCase() === 'total') return totalLevel(ch);
    const k = (ch.classes || []).find((c) => String(c.name).toLowerCase() === String(cls).toLowerCase());
    return k ? +k.level || 0 : 0;
  }
  function atLevel(ch, v) {
    if (v == null || typeof v !== 'object') return v;
    const L = Math.min(20, levelIn(ch, v.class));
    return L >= 1 && Array.isArray(v.levels) ? v.levels[L - 1] : null;
  }
  // a resource list as the server keeps it: plain fields, bounded sizes, nothing else
  function cleanResources(list) {
    const lv = (v, ok) => (v && typeof v === 'object' && !Array.isArray(v)
      ? { class: String(v.class || '').slice(0, 30), levels: (Array.isArray(v.levels) ? v.levels : []).slice(0, 20).map(ok) }
      : ok(v));
    const num = (x) => clampN(Math.round(+x) || 0, 0, 999);
    const die = (x) => (/^d(4|6|8|10|12|20)$/.test(String(x || '')) ? String(x) : '');
    return (Array.isArray(list) ? list : []).slice(0, 30).filter((r) => r && typeof r === 'object').map((r) => ({
      key: String(r.key || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30), name: String(r.name || '').slice(0, 60),
      max: lv(r.max, num), die: r.die ? lv(r.die, die) : undefined, used: num(r.used), refill: REFILLS.includes(r.refill) ? r.refill : 'manual',
    })).filter((r) => r.key && !['force', 'tech', 'hitdice', 'move', 'action', 'bonus', 'reaction'].includes(r.key));
  }
  // every resource a character has, resolved to numbers for their level
  function resourcesOf(ch, rules) {
    const out = [];
    for (const r of ch.resources || []) {
      const max = +atLevel(ch, r.max) || 0;
      if (!r.key || max <= 0) continue;
      out.push({ key: r.key, name: r.name || r.key, max, die: atLevel(ch, r.die) || null, used: clampN(+r.used || 0, 0, max), refill: REFILLS.includes(r.refill) ? r.refill : 'manual', from: 'sheet' });
    }
    if (rules && rules.casterInfo) {
      const ci = rules.casterInfo(ch);
      const set = (o) => o && o.max !== '' && o.max != null;
      const fm = set(ch.force) ? +ch.force.max : ci.forceMax, tm = set(ch.tech) ? +ch.tech.max : ci.techMax;
      if (fm > 0) out.push({ key: 'force', name: 'Force points', max: fm, used: clampN(+(ch.force || {}).used || 0, 0, fm), refill: 'long', from: 'force' });
      // tech points come back on a short rest too (audit 7.3)
      if (tm > 0) out.push({ key: 'tech', name: 'Tech points', max: tm, used: clampN(+(ch.tech || {}).used || 0, 0, tm), refill: 'short', from: 'tech' });
    }
    const L = totalLevel(ch);
    if (L > 0) out.push({ key: 'hitdice', name: 'Hit dice', max: L, used: clampN(+ch.hitDiceUsed || 0, 0, L), refill: 'long', regain: Math.max(1, Math.floor(L / 2)), from: 'hitdice' });
    return out;
  }
  // write one resource's used count back where it lives (a new character; the one passed in is not changed)
  function withUsed(ch, res, used) {
    const c = clone(ch);
    if (res.from === 'force') c.force = Object.assign({}, c.force, { used });
    else if (res.from === 'tech') c.tech = Object.assign({}, c.tech, { used });
    else if (res.from === 'hitdice') c.hitDiceUsed = used;
    else c.resources = (c.resources || []).map((r) => (r.key === res.key ? Object.assign({}, r, { used }) : r));
    return c;
  }
  function spend(ch, key, n, rules) {
    const res = resourcesOf(ch, rules).find((r) => r.key === key);
    n = Math.round(+n);
    if (!res) return no(`No ${key} to spend.`);
    if (!(n > 0)) return no('Spend at least one.');
    if (res.used + n > res.max) return no(`Not enough ${res.name}: ${res.max - res.used} of ${res.max} left.`);
    return { ok: true, ch: withUsed(ch, res, res.used + n), res: Object.assign({}, res, { used: res.used + n }) };
  }
  // a rest refills what each resource says: 'short' refills short; 'long' refills short and long (hit dice: half back)
  function rest(ch, kind, rules) {
    let c = ch;
    for (const res of resourcesOf(ch, rules)) {
      const due = res.refill === 'short' || (kind === 'long' && res.refill === 'long');
      if (!due || !res.used) continue;
      c = withUsed(c, res, res.regain ? Math.max(0, res.used - res.regain) : 0);
    }
    return c;
  }

  /* ---------------- abilities as data (issue #73) ---------------- */
  // An ability, as the table stores it (the format posted on #73). Numbers that depend on the caster are written as
  // references ("force", "tech", "weapon", an ability like "str") and resolved here for one character:
  //   { key, name, kind, level, use: action|bonus|reaction|free, cost: { pool: n }, reach, range: [n, l], area,
  //     targets: n|'self'|'area', attack: { bonus }, save: { ability, dc, onSave: half|none },
  //     damage: [{ dice, add, type }], heal: { dice, add }, applies: [...], concentration, upcast: { damage } }
  const ABILS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const USES = ['action', 'bonus', 'reaction', 'free'];
  // A power's cost and numbers, as HoloTable's sheet works them out (app.js 'cast' and the power card): the cost is
  // its level plus one (at-will: free); tech uses tech numbers; force uses the side it belongs to, universal the better.
  function powerNumbers(ch, pw, rules) {
    const ci = rules.casterInfo(ch), lvl = +pw.level || 0, tech = pw.type === 'tech';
    const pick = (light, dark, t) => (tech ? t : pw.alignment === 'dark' ? dark : pw.alignment === 'light' ? light : Math.max(light, dark));
    return { pool: tech ? 'tech' : 'force', cost: lvl ? lvl + 1 : 0, level: lvl, dc: pick(ci.lightDC, ci.darkDC, ci.techDC), atk: pick(ci.lightAtk, ci.darkAtk, ci.techAtk), maxLevel: tech ? ci.techMaxLevel : ci.forceMaxLevel };
  }
  // the table's data for a power, with this character's numbers filled in; null when the table has no data for it
  function resolvePower(ch, pw, data, rules) {
    if (!data) return null;
    const n = powerNumbers(ch, pw, rules), mod = (ab) => (ABILS.includes(ab) ? rules.abilityMod(ch, ab) : +ab || 0);
    const num = (v) => (v === 'force' || v === 'tech' || v === 'power' ? n.atk : v === 'weapon' ? n.atk : Number.isFinite(+v) ? +v : 0);
    const dc = (v) => (v === 'force' || v === 'tech' || v === 'power' ? n.dc : Number.isFinite(+v) ? +v : n.dc);
    return {
      key: 'pw:' + String(pw.name).toLowerCase(), name: pw.name, kind: 'power', level: n.level, maxLevel: n.maxLevel,
      use: USES.includes(data.use) ? data.use : 'action', cost: n.cost ? { [n.pool]: n.cost } : {}, pool: n.pool,
      reach: data.reach == null ? null : +data.reach, range: Array.isArray(data.range) ? [+data.range[0], +data.range[1] || +data.range[0]] : null,
      area: data.area || null, targets: data.targets === 'self' ? 'self' : data.targets === 'area' ? 'area' : Math.max(1, +data.targets || 1),
      attack: data.attack ? { bonus: num(data.attack.bonus == null ? 'power' : data.attack.bonus) } : null,
      save: data.save ? { ability: ABILS.includes(data.save.ability) ? data.save.ability : 'dex', dc: dc(data.save.dc), onSave: data.save.onSave === 'half' ? 'half' : 'none' } : null,
      damage: (data.damage || []).map((d) => ({ dice: String(d.dice || ''), add: d.add == null ? 0 : mod(d.add), type: d.type || '' })).filter((d) => d.dice),
      heal: data.heal && data.heal.dice ? { dice: String(data.heal.dice), add: data.heal.add == null ? 0 : mod(data.heal.add) } : null,
      applies: Array.isArray(data.applies) ? data.applies : [], concentration: !!data.concentration,
      upcast: data.upcast && data.upcast.damage ? { damage: String(data.upcast.damage) } : null,
    };
  }
  // a weapon attack row as an ability (its arithmetic still comes from rules.js through attacksOf)
  const weaponAbility = (a) => ({ key: 'atk:' + a.key, name: a.name, kind: 'weapon', use: 'action', cost: {}, reach: a.melee || null, range: a.range, targets: 1,
    attack: { bonus: a.bonus }, save: null, damage: [{ dice: a.damage, add: 0, type: a.type }], crit: a.crit, applies: [], concentration: false });
  // everything a character can use in the combat view: weapon attacks, and the powers on the sheet the table has data for
  function abilitiesOf(ch, rules, library) {
    const lib = library || {};
    return attacksOf(ch, rules).map(weaponAbility)
      .concat((ch.powers || []).map((pw) => resolvePower(ch, pw, lib[String(pw.name || '').toLowerCase()], rules)).filter(Boolean));
  }
  // ability data as the table keeps it: only the fields of the format, each checked; null if nothing usable is left
  const DICE = /^(\d{0,2}d(4|6|8|10|12|20|100)|\d{1,3})([+-](\d{0,2}d(4|6|8|10|12|20|100)|\d{1,3})){0,5}$/i;
  const SHAPES = ['cone', 'cube', 'cylinder', 'line', 'sphere'];
  function cleanAbility(d) {
    if (!d || typeof d !== 'object') return null;
    const ft = (v) => (v == null || v === '' ? null : clampN(Math.round(+v) || 0, 0, 2000));
    const ref = (v, extra) => (ABILS.includes(v) || extra.includes(v) ? v : Number.isFinite(+v) && v !== '' && v != null ? clampN(Math.round(+v), -10, 40) : null);
    const dice = (v) => { const x = String(v || '').replace(/\s+/g, ''); return DICE.test(x) ? x : ''; };
    const out = {
      use: USES.includes(d.use) ? d.use : 'action',
      reach: ft(d.reach), range: Array.isArray(d.range) && ft(d.range[0]) ? [ft(d.range[0]), Math.max(ft(d.range[0]), ft(d.range[1]) || 0)] : null,
      area: d.area && SHAPES.includes(d.area.shape) ? { shape: d.area.shape, size: ft(d.area.size) || 5, width: ft(d.area.width) || 5, from: d.area.from === 'point' ? 'point' : 'self' } : null,
      targets: d.targets === 'self' || d.targets === 'area' ? d.targets : clampN(Math.round(+d.targets) || 1, 1, 10),
      attack: d.attack ? { bonus: ref(d.attack.bonus, ['power', 'force', 'tech', 'weapon']) ?? 'power' } : null,
      save: d.save && ABILS.includes(d.save.ability) ? { ability: d.save.ability, dc: ref(d.save.dc, ['power', 'force', 'tech']) ?? 'power', onSave: d.save.onSave === 'half' ? 'half' : 'none' } : null,
      damage: (Array.isArray(d.damage) ? d.damage : []).slice(0, 4).map((x) => ({ dice: dice(x && x.dice), add: x && ABILS.includes(x.add) ? x.add : null, type: String((x && x.type) || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20) })).filter((x) => x.dice),
      heal: d.heal && dice(d.heal.dice) ? { dice: dice(d.heal.dice), add: ABILS.includes(d.heal.add) ? d.heal.add : null } : null,
      applies: (Array.isArray(d.applies) ? d.applies : []).slice(0, 4).filter((x) => x && x.condition).map((x) => ({ condition: String(x.condition).slice(0, 30),
        until: x.until && typeof x.until === 'object' ? { ends: x.until.ends === 'start' ? 'start' : 'end', of: x.until.of === 'self' ? 'self' : 'target', rounds: clampN(Math.round(+x.until.rounds) || 1, 1, 100), save: !!x.until.save } : null })),
      concentration: !!d.concentration,
      upcast: d.upcast && dice(d.upcast.damage) ? { damage: dice(d.upcast.damage) } : null,
    };
    if (out.targets !== 'self' && !out.reach && !out.range && !out.area) out.reach = FT;
    if (!out.attack && !out.save && !out.damage.length && !out.heal && !out.applies.length) return null;
    return out;
  }
  // set one resource's used count where it lives (force points, tech points, hit dice, or the sheet's own list)
  function setPoolUsed(ch, key, used, rules) {
    const res = resourcesOf(ch, rules).find((r) => r.key === key);
    return res ? withUsed(ch, res, clampN(Math.round(+used) || 0, 0, res.max)) : ch;
  }
  const diceExpr = (d, add) => (add ? `${d}${add > 0 ? '+' : ''}${add}` : d);
  const doubleDice = (e) => e.replace(/(\d*)d(\d+)/gi, (_, n, s) => (2 * (+n || 1)) + 'd' + s);
  // can this ability reach that target from here?
  function inReachOf(world, a, t, ab) {
    const feet = feetBetween(a, t);
    if (ab.targets === 'self') return a.id === t.id ? { ok: true, feet: 0 } : { ok: false, why: `${ab.name} only affects its user.` };
    if (ab.reach && feet <= ab.reach) return { ok: true, feet, melee: true };
    if (ab.range && feet <= ab.range[1]) return { ok: true, feet, long: feet > ab.range[0] };
    return { ok: false, why: `${t.name} is ${feet} ft away: out of ${ab.range ? 'range' : 'reach'}.` };
  }

  /* ---------------- measuring and areas (issue #70) ---------------- */
  // Points are in squares and may sit on a corner or a centre (x.0 or x.5). A square is inside a template when its
  // centre is. Cones open to the same width as their length (a half-angle whose tangent is 1/2); spheres and
  // cylinders are a radius around the point; cubes run from the point away from the caster; lines have a width.
  const HALF_CONE = Math.atan(0.5);
  function ruler(a, b) { // feet between two points, by the same diagonal rule as movement
    return Math.max(Math.abs(Math.floor(b.x) - Math.floor(a.x)), Math.abs(Math.floor(b.y) - Math.floor(a.y))) * FT;
  }
  function areaSquares(area, origin, aim) {
    const n = Math.max(1, Math.round((area.size || FT) / FT)), out = [];
    const dx = aim.x - origin.x, dy = aim.y - origin.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
    const box = (x0, y0, x1, y1, test) => {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) if (test(x + 0.5, y + 0.5)) out.push([x, y]);
    };
    if (area.shape === 'sphere' || area.shape === 'cylinder') {
      box(origin.x - n - 1, origin.y - n - 1, origin.x + n, origin.y + n, (cx, cy) => Math.hypot(cx - origin.x, cy - origin.y) <= n + 1e-9);
    } else if (area.shape === 'cube') {
      const sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1;
      const x0 = Math.round(origin.x), y0 = Math.round(origin.y);
      box(Math.min(x0, x0 + sx * n), Math.min(y0, y0 + sy * n), Math.max(x0, x0 + sx * n) - 1, Math.max(y0, y0 + sy * n) - 1, () => true);
    } else if (area.shape === 'cone') {
      box(origin.x - n - 1, origin.y - n - 1, origin.x + n, origin.y + n, (cx, cy) => {
        const vx = cx - origin.x, vy = cy - origin.y, d = Math.hypot(vx, vy);
        return d > 0 && d <= n + 1e-9 && Math.acos(Math.max(-1, Math.min(1, (vx * ux + vy * uy) / d))) <= HALF_CONE + 1e-9;
      });
    } else if (area.shape === 'line') {
      const half = Math.max(1, Math.round((area.width || FT) / FT)) / 2;
      box(origin.x - n - 1, origin.y - n - 1, origin.x + n, origin.y + n, (cx, cy) => {
        const vx = cx - origin.x, vy = cy - origin.y, along = vx * ux + vy * uy;
        return along > 0 && along <= n + 1e-9 && Math.abs(vx * uy - vy * ux) <= half + 1e-9;
      });
    }
    return out;
  }
  // where an area starts: the point aimed at (it must be in range), or the caster's edge toward the aim (cones, lines)
  function areaOrigin(world, u, ab, point) {
    const size = u.size || 1, cx = u.x + size / 2, cy = u.y + size / 2;
    if (ab.area.from === 'point') {
      const feet = Math.max(0, squaresBetween(u, { x: Math.floor(point.x), y: Math.floor(point.y), size: 1 }) * FT);
      const reach = ab.range ? ab.range[1] : ab.reach || 0;
      if (feet > reach) return { ok: false, why: `That point is ${feet} ft away: out of range (${reach} ft).` };
      return { ok: true, origin: { x: point.x, y: point.y }, aim: point };
    }
    const dx = point.x - cx, dy = point.y - cy, len = Math.hypot(dx, dy) || 1;
    return { ok: true, origin: { x: cx + (dx / len) * size / 2, y: cy + (dy / len) * size / 2 }, aim: { x: cx + dx * 10, y: cy + dy * 10 } };
  }
  // the squares and the combatants an area ability would catch, aimed at a point
  function areaHits(world, unitId, ab, point) {
    const u = world.units[unitId];
    if (!u || !ab.area || !point || !Number.isFinite(+point.x) || !Number.isFinite(+point.y)) return { ok: false, why: 'Pick where to aim it.' };
    const o = areaOrigin(world, u, ab, { x: +point.x, y: +point.y });
    if (!o.ok) return o;
    const squares = areaSquares(ab.area, o.origin, o.aim), set = new Set(squares.map(([x, y]) => `${x},${y}`));
    const caught = Object.values(world.units).filter((t) => !t.down && (ab.area.from === 'point' || t.id !== u.id) && (() => {
      for (let x = t.x; x < t.x + (t.size || 1); x++) for (let y = t.y; y < t.y + (t.size || 1); y++) if (set.has(`${x},${y}`)) return true;
      return false;
    })());
    return { ok: true, squares, units: caught.map((t) => t.id), origin: o.origin };
  }

  /* ---------------- turns: the turn budget is resources too, refilled at the start of the unit's own turn ---------------- */
  const turnKey = (world) => `${world.round}:${world.turnId}`;
  const TURN = ['move', 'action', 'bonus', 'reaction'];
  function spentOf(world, id) {
    const s = (world.spent || {})[id];
    return s && (id !== world.turnId || s.key === turnKey(world)) ? s : { key: id === world.turnId ? turnKey(world) : '', move: 0, action: 0, bonus: 0, reaction: 0 };
  }
  // what a unit's turn has left (by default, the unit whose turn it is)
  function budget(world, id) {
    id = id || world.turnId;
    const u = world.units[id], s = spentOf(world, id);
    let speed = u ? Math.max(0, +u.speed || 0) : 0;
    if (u && has(u, 'speed0')) speed = 0; else if (u && has(u, 'speedHalf')) speed = Math.floor(speed / 2 / FT) * FT;
    const out = has(u || {}, 'noActions'), noReact = out || has(u || {}, 'noReactions');
    return { key: s.key, moved: s.move, speed, moveLeft: Math.max(0, speed - s.move), action: !out && s.action < 1, bonus: !out && s.bonus < 1, reaction: !noReact && s.reaction < 1 };
  }
  // a new turn gives its unit full movement, an action, a bonus action and its reaction back
  function fresh(world) {
    const w = clone(world);
    w.spent = w.spent || {}; w.effects = w.effects || []; w.conc = w.conc || {};
    if (w.turnId && (!w.spent[w.turnId] || w.spent[w.turnId].key !== turnKey(w))) w.spent[w.turnId] = { key: turnKey(w), move: 0, action: 0, bonus: 0, reaction: 0 };
    return w;
  }

  /* ---------------- applying one action ---------------- */
  function apply(world, act, roll) {
    if (!world.active) return no('Combat has not started: start initiative first.');
    const u = world.units[act.unit];
    if (!u) return no('That combatant is not on the map.');
    if (act.unit !== world.turnId) return no(`It's not ${u.name}'s turn.`);
    const w = fresh(world), me = w.units[u.id], b = budget(w);
    if (act.type !== 'end' && act.type !== 'move' && INCAPACITATING(me)) return no(`${me.name} is ${String((has(me, 'noActions') || [''])[0]).toLowerCase()} and can't act.`);
    switch (act.type) {
      case 'move': {
        const x = Math.round(+act.x), y = Math.round(+act.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return no('Bad square.');
        if (x === me.x && y === me.y) return no('Already there.');
        const cost = reachable(w, me.id, b.moveLeft)[`${x},${y}`];
        if (cost === undefined) return no(b.moveLeft ? `${me.name} can't reach that square with ${b.moveLeft} ft of movement left.` : `${me.name} has no movement left this turn.`);
        me.x = x; me.y = y; w.spent[me.id].move += cost;
        return { ok: true, world: w, log: [{ text: `${me.name} moves ${cost} ft.` }], events: [{ kind: 'move', unit: me.id, feet: cost }] };
      }
      case 'attack': {
        if (!b.action) return no(`${me.name} has already used the action this turn.`);
        const attack = act.attack;
        if (!attack || !Number.isFinite(+attack.bonus) || !attack.damage) return no('Pick an attack.');
        const t = w.units[act.target];
        const pv = preview(w, me.id, act.target, attack, { adv: !!act.adv, dis: !!act.dis });
        if (!pv.legal) return no(pv.why);
        const r = roll(pv.expr);
        const nat = r.nat, fumble = nat === 1;
        let crit = nat === 20;
        const hit = crit || (!fumble && r.total >= t.ac);
        if (hit && !pv.ranged && pv.feet <= FT && has(t, 'meleeCrit')) crit = true;   // a melee hit on the helpless is a critical
        w.spent[me.id].action += 1;
        const tilt = pv.mode === 'normal' ? '' : ` with ${pv.mode === 'adv' ? 'advantage' : 'disadvantage'} (${pv.tilts.map((x) => x.text).join(', ')})`;
        const log = [{ kind: 'attack', roll: r, expr: pv.expr, text: `${me.name} attacks ${t.name} with ${attack.name}${tilt}: ${r.total} against AC ${t.ac}, ${crit ? 'a critical hit!' : hit ? 'a hit.' : fumble ? 'a natural 1, a miss.' : 'a miss.'}` }];
        const events = [];
        if (!hit) { events.push({ kind: 'miss', unit: t.id }); return { ok: true, world: w, log, events }; }
        const expr = crit ? attack.crit || attack.damage : attack.damage;
        const d = roll(expr);
        const amount = Math.max(0, d.total);
        const took = takeDamage(t, amount);
        log.push({ unit: t.id, kind: 'damage', roll: d, expr, text: `${t.name} takes ${amount}${attack.type ? ' ' + attack.type : ''} damage${took.fromTemp ? ` (${took.fromTemp} from temporary hit points)` : ''}${t.hp != null && t.hp <= 0 ? ' and drops to 0 hit points.' : '.'}` });
        events.push({ kind: crit ? 'crit' : 'hit', unit: t.id, amount });
        concentrationCheck(w, t, amount, roll, log);
        return { ok: true, world: w, log, events };
      }
      case 'use': {
        // an ability from the table's data: its turn cost, its point cost, then an attack roll or a save for each target
        const ab = act.ability;
        if (!ab || !ab.name) return no('Pick an ability.');
        const slot = ab.use || 'action';
        if (slot !== 'free' && !b[slot]) return no(`${me.name} has already used the ${slot === 'bonus' ? 'bonus action' : slot} this turn.`);
        const up = Math.max(0, Math.round(+act.upcast || 0));
        if (ab.kind === 'power' && ab.level && ab.maxLevel != null && ab.level + up > ab.maxLevel) return no(ab.maxLevel ? `${me.name} can cast powers up to level ${ab.maxLevel}.` : `${me.name} can't cast leveled powers yet.`);
        const cost = Object.assign({}, ab.cost || {});
        if (up && ab.pool) cost[ab.pool] = (cost[ab.pool] || 0) + up;
        for (const [pool, n] of Object.entries(cost)) {
          const p = (me.pools || {})[pool];
          if (!p || p.max - p.used < n) return no(`Not enough ${p ? p.name : pool}: ${n} needed${p ? `, ${p.max - p.used} left` : ''}.`);
        }
        let ids;
        if (ab.area) {   // everyone the template catches, aimed at a point
          const hits = areaHits(w, me.id, ab, act.point);
          if (!hits.ok) return no(hits.why);
          ids = hits.units;
        } else {
          ids = ab.targets === 'self' ? [me.id] : (Array.isArray(act.targets) ? act.targets : [act.target]).filter(Boolean).map(String);
          const max = ab.targets === 'self' ? 1 : ab.targets;
          if (!ids.length) return no('Pick a target.');
          if (new Set(ids).size !== ids.length || ids.length > max) return no(`${ab.name} affects ${max === 1 ? 'one target' : `up to ${max} targets`}.`);
          for (const id of ids) {
            const t = w.units[id];
            if (!t) return no('No such target.');
            const r = inReachOf(w, me, t, ab);
            if (!r.ok) return no(r.why);
          }
        }
        // pay first: the turn slot and the points; a new concentration power ends the old one
        if (slot !== 'free') w.spent[me.id][slot] += 1;
        if (ab.concentration && w.conc[me.id]) endConcentration(w, me.id, `${me.name} starts concentrating on ${ab.name}`, null);
        if (ab.concentration) w.conc[me.id] = ab.name;
        for (const [pool, n] of Object.entries(cost)) if (n) me.pools[pool] = Object.assign({}, me.pools[pool], { used: me.pools[pool].used + n });
        const costText = Object.entries(cost).filter(([, n]) => n).map(([pool, n]) => `${n} ${(me.pools[pool] || {}).name || pool}`).join(', ');
        const log = [{ text: `${me.name} uses ${ab.name}${up ? ` at level ${ab.level + up}` : ''}${costText ? ` (${costText})` : ''}.` }], events = [];   // never says who or how many: a hidden creature may be among them
        const extra = up && ab.upcast ? Array.from({ length: up }, () => ab.upcast.damage).join('+') : '';
        const dmgExpr = (crit) => ab.damage.map((d) => diceExpr(crit ? doubleDice(d.dice) : d.dice, d.add)).join('+') + (extra ? '+' + (crit ? doubleDice(extra) : extra) : '');
        const dtype = (ab.damage[0] || {}).type || '';
        for (const id of ids) {
          const t = w.units[id];
          let hit = true, crit = false, half = false;
          if (ab.attack) {
            const r0 = inReachOf(w, me, t, ab);
            const tilts = [];
            if (!r0.melee && r0.long) tilts.push('long range');
            if (!r0.melee && Object.values(w.units).some((o) => o.id !== me.id && hostile(me, o) && !o.down && feetBetween(me, o) <= FT)) tilts.push('an enemy within 5 ft');
            const adv = !!act.adv, dis = !!act.dis || tilts.length > 0;
            const expr = (adv && !dis ? '2d20kh1' : dis && !adv ? '2d20kl1' : '1d20') + sgn(ab.attack.bonus);
            const r = roll(expr);
            crit = r.nat === 20; hit = crit || (r.nat !== 1 && r.total >= t.ac);
            log.push({ unit: t.id, kind: 'attack', roll: r, expr, text: `${ab.name} against ${t.name}${dis && !adv && tilts.length ? ` (disadvantage: ${tilts.join(', ')})` : ''}: ${r.total} against AC ${t.ac}, ${crit ? 'a critical hit!' : hit ? 'a hit.' : 'a miss.'}` });
          } else if (ab.save) {
            const bonus = (t.saves || {})[ab.save.ability];
            const fail = effectsOf(t).find(([, e]) => (e.autoFail || []).includes(ab.save.ability));
            const sdis = effectsOf(t).some(([, e]) => (e.saveDis || []).includes(ab.save.ability));
            const sexpr = (sdis ? '2d20kl1' : '1d20') + sgn(+bonus || 0);
            const r = roll(sexpr);
            const saved = !fail && r.total >= ab.save.dc;
            hit = !saved || ab.save.onSave === 'half'; half = saved && ab.save.onSave === 'half';
            log.push({ unit: t.id, kind: 'save', roll: r, expr: sexpr, text: `${t.name} makes a ${ab.save.ability.toUpperCase()} save against DC ${ab.save.dc}${bonus == null ? ' (no save bonus known)' : ''}${sdis ? ' with disadvantage' : ''}: ${r.total}, ${fail ? `an automatic failure (${fail[0].toLowerCase()})` : saved ? 'a success' : 'a failure'}.` });
          }
          if (!hit) { events.push({ kind: 'miss', unit: t.id }); continue; }
          // conditions the ability puts on its target, with how long they last
          if (!half) for (const ap of ab.applies || []) {
            if (!ap.condition) continue;
            t.conditions = Array.from(new Set((t.conditions || []).concat(ap.condition)));
            const until = ap.until || { ends: 'end', of: 'self', rounds: 1 };
            w.effects.push({ id: `${me.id}-${ab.key}-${t.id}-${w.effects.length}`, unit: t.id, condition: ap.condition, ends: until.ends, of: until.of === 'target' ? t.id : me.id,
              rounds: until.rounds || 1, save: until.save && ab.save ? { ability: ab.save.ability, dc: ab.save.dc } : null, source: me.id, conc: !!ab.concentration });
            log.push({ unit: t.id, text: `${t.name} is ${String(ap.condition).toLowerCase()}${ab.concentration ? ` while ${me.name} concentrates` : ''}.` });
          }
          if (ab.damage.length) {
            const expr = dmgExpr(crit);
            const d = roll(expr);
            const amount = Math.max(0, half ? Math.floor(d.total / 2) : d.total);
            const took = takeDamage(t, amount);
            log.push({ unit: t.id, kind: 'damage', roll: d, expr, text: `${t.name} takes ${amount}${dtype ? ' ' + dtype : ''} damage${half ? ' (half, on a save)' : ''}${took.fromTemp ? ` (${took.fromTemp} from temporary hit points)` : ''}${t.hp != null && t.hp <= 0 ? ' and drops to 0 hit points.' : '.'}` });
            events.push({ kind: crit ? 'crit' : 'hit', unit: t.id, amount });
            concentrationCheck(w, t, amount, roll, log);
          } else if (ab.heal) {
            const expr = diceExpr(ab.heal.dice, ab.heal.add);
            const d = roll(expr);
            const amount = Math.max(0, d.total);
            if (t.hp != null) { t.hp = t.maxHp != null ? Math.min(t.maxHp, t.hp + amount) : t.hp + amount; if (t.hp > 0) delete t.down; }
            log.push({ unit: t.id, kind: 'heal', roll: d, expr, text: `${t.name} regains ${amount} hit points.` });
            events.push({ kind: 'heal', unit: t.id, amount });
          } else events.push({ kind: 'hit', unit: t.id, amount: 0 });
        }
        return { ok: true, world: w, log, events, spentPools: cost };
      }
      case 'end':
        return { ok: true, world: w, log: [{ text: `${me.name} ends the turn.` }], events: [], endTurn: true };
      default:
        return no('Unknown combat action.');
    }
  }
  // a unit's concentration ends: its effects (and the conditions they gave) go
  function endConcentration(w, id, why, log) {
    const name = w.conc[id];
    if (!name) return;
    delete w.conc[id];
    const gone = w.effects.filter((ef) => ef.source === id && ef.conc);
    w.effects = w.effects.filter((ef) => !(ef.source === id && ef.conc));
    for (const ef of gone) dropCondition(w, ef);
    if (log) log.push({ text: `${why}: ${name} ends.` });
  }
  // a condition given by an effect goes when the effect does (unless another effect still gives it)
  function dropCondition(w, ef) {
    const u = w.units[ef.unit];
    if (!u || w.effects.some((o) => o.unit === ef.unit && o.condition === ef.condition)) return;
    u.conditions = (u.conditions || []).filter((c) => c !== ef.condition);
  }
  // after damage: concentration needs a Con save (DC 10 or half the damage, whichever is higher); 0 hp ends it
  function concentrationCheck(w, t, amount, roll, log) {
    if (!w.conc || !w.conc[t.id] || amount <= 0) return;
    if (t.hp != null && t.hp <= 0) return endConcentration(w, t.id, `${t.name} drops`, log);
    const dc = Math.max(10, Math.floor(amount / 2)), bonus = +((t.saves || {}).con) || 0;
    const r = roll('1d20' + sgn(bonus));
    log.push({ unit: t.id, kind: 'save', roll: r, expr: '1d20' + sgn(bonus), text: `${t.name} makes a concentration save (CON, DC ${dc}): ${r.total}, ${r.total >= dc ? 'a success' : 'a failure'}.` });
    if (r.total < dc) endConcentration(w, t.id, `${t.name} loses concentration`, log);
  }
  // A turn passed from one unit to the next: effects that end at the end of the first one's turn or the start of
  // the next one's go (after their rounds), and an effect that a save can end gives its unit that save at the end of
  // its own turn. Returns the new world and the log; the world passed in is not changed.
  function turnPassed(world, prevId, nextId, roll) {
    const w = clone(world), log = [];
    w.effects = w.effects || []; w.conc = w.conc || {};
    const keep = [];
    for (const ef of w.effects) {
      let ends = false;
      if (ef.save && ef.unit === prevId) {
        const u = w.units[ef.unit], bonus = +((u && u.saves) || {})[ef.save.ability] || 0;
        const r = roll('1d20' + sgn(bonus));
        log.push({ unit: ef.unit, kind: 'save', roll: r, expr: '1d20' + sgn(bonus), text: `${u ? u.name : 'Someone'} tries to shake off ${ef.condition.toLowerCase()} (${ef.save.ability.toUpperCase()}, DC ${ef.save.dc}): ${r.total}, ${r.total >= ef.save.dc ? 'a success' : 'a failure'}.` });
        if (r.total >= ef.save.dc) ends = true;
      }
      if (!ends && ((ef.ends === 'end' && ef.of === prevId) || (ef.ends === 'start' && ef.of === nextId))) {
        ef.rounds = (ef.rounds || 1) - 1;
        if (ef.rounds <= 0) ends = true;
      }
      if (ends) { const u = w.units[ef.unit]; log.push({ unit: ef.unit, text: `${u ? u.name : 'Someone'} is no longer ${ef.condition.toLowerCase()}.` }); w.endedEffects = (w.endedEffects || []).concat(ef); }
      else keep.push(ef);
    }
    const ended = w.effects.filter((ef) => !keep.includes(ef));
    w.effects = keep;
    for (const ef of ended) dropCondition(w, ef);
    // incapacitated casters stop concentrating
    for (const id of Object.keys(w.conc)) if (w.units[id] && INCAPACITATING(w.units[id])) endConcentration(w, id, `${w.units[id].name} is incapacitated`, log);
    return { world: w, log };
  }
  // temporary hit points go first; hit points stop at 0; a creature whose hit points aren't known just takes the hit
  function takeDamage(t, amount) {
    const fromTemp = Math.min(Math.max(0, +t.temp || 0), amount);
    t.temp = (+t.temp || 0) - fromTemp;
    if (t.hp != null) t.hp = Math.max(0, t.hp - (amount - fromTemp));
    if (t.hp === 0) t.down = true;
    return { fromTemp };
  }

  /* ---------------- building a world from the table ---------------- */
  // table: { characters, entries (initiative, in order), active, turn (index) or turnId, round, tokens, unitTokens: { entryId: tokenId },
  //          npcSpeed: { entryId: feet }, spent: { unitId: { key, move, action, bonus, reaction } } }
  function buildWorld(table, rules) {
    const tokens = Object.fromEntries((table.tokens || []).map((t) => [t.id, t]));
    const units = {};
    for (const e of table.entries || []) {
      const tok = tokens[(table.unitTokens || {})[e.id]];
      if (!tok) continue;
      const ch = e.charId && (table.characters || {})[e.charId];
      const hp = ch ? ch.hp || {} : null;
      units[e.id] = {
        id: e.id, name: e.name, side: e.charId ? 'pc' : 'npc', charId: e.charId || null, owner: ch ? ch.owner : null, tokenId: tok.id,
        x: tok.x, y: tok.y, size: tok.size || 1,
        ac: ch ? +ch.ac : e.ac == null || e.ac === '' ? null : +e.ac,
        hp: ch ? +hp.current : e.hp == null || e.hp === '' ? null : +e.hp, maxHp: ch ? +hp.max : e.maxHp == null ? null : +e.maxHp,
        temp: ch ? +hp.temp || 0 : 0,
        speed: ch ? +ch.speed || 30 : +((table.npcSpeed || {})[e.id]) || 30,
        pools: ch ? Object.fromEntries(resourcesOf(ch, rules).map((r) => [r.key, r])) : {},
        conditions: Array.from(new Set([].concat(e.conditions || [], ch ? ch.conditions || [] : []))),
        saves: ch && rules ? Object.fromEntries(ABILS.map((ab) => [ab, rules.saveBonus(ch, ab)])) : Object.assign({}, ((table.npcStats || {})[e.id] || {}).saves),
      };
      if (units[e.id].hp != null && units[e.id].hp <= 0) units[e.id].down = true;
    }
    const cur = table.turnId !== undefined ? (table.entries || []).find((e) => e.id === table.turnId) : (table.entries || [])[table.turn];
    return {
      active: !!table.active && !!cur, round: table.round || 1, turnId: cur ? cur.id : null, units,
      spent: table.spent || {}, effects: table.effects || [], conc: table.conc || {},
    };
  }

  return { FT, TURN, squaresBetween, feetBetween, reachable, readRange, attacksOf, attackFromBehavior, REASONS, preview, budget, apply, takeDamage, buildWorld, turnKey,
    cleanResources, resourcesOf, atLevel, spend, rest, powerNumbers, resolvePower, weaponAbility, abilitiesOf, inReachOf, cleanAbility, setPoolUsed,
    ruler, areaSquares, areaHits, CONDITION_EFFECTS, turnPassed, endConcentration };
});
