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
    const tilts = REASONS.filter((r) => r.when(ctx)).map((r) => ({ dis: !!r.dis, adv: !!r.adv, text: r.text }));
    if (opts.adv) tilts.push({ adv: true, text: 'chosen' });
    if (opts.dis) tilts.push({ dis: true, text: 'chosen' });
    const adv = tilts.some((x) => x.adv), dis = tilts.some((x) => x.dis);
    const mode = adv && !dis ? 'adv' : dis && !adv ? 'dis' : 'normal';
    const need = Math.min(20, Math.max(2, t.ac - attack.bonus));   // the d20 needed; a 20 always hits, a 1 always misses
    const p = (21 - need) / 20;
    const chance = mode === 'adv' ? 1 - (1 - p) ** 2 : mode === 'dis' ? p * p : p;
    return { legal: true, feet, ranged, mode, tilts, need, chance, expr: (mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20') + sgn(attack.bonus) };
  }

  /* ---------------- turns ---------------- */
  const turnKey = (world) => `${world.round}:${world.turnId}`;
  // what the current turn has left; a new turn (a new key) starts fresh
  function budget(world) {
    const u = world.units[world.turnId];
    const same = world.turn && world.turn.key === turnKey(world);
    const t = same ? world.turn : { key: turnKey(world), moved: 0, action: false, bonus: false };
    const speed = u ? Math.max(0, +u.speed || 0) : 0;
    return {
      key: t.key, moved: t.moved, speed, moveLeft: Math.max(0, speed - t.moved), action: !t.action, bonus: !t.bonus,
      reaction: !same || !(world.reactions || {})[world.turnId],
    };
  }
  // a new turn starts with full movement, an action and a bonus action, and gives its unit its reaction back
  function fresh(world) {
    const w = clone(world);
    w.reactions = w.reactions || {};
    if (!w.turn || w.turn.key !== turnKey(w)) {
      w.turn = { key: turnKey(w), moved: 0, action: false, bonus: false };
      delete w.reactions[w.turnId];
    }
    return w;
  }

  /* ---------------- applying one action ---------------- */
  const no = (why) => ({ ok: false, why });
  function apply(world, act, roll) {
    if (!world.active) return no('Combat has not started: start initiative first.');
    const u = world.units[act.unit];
    if (!u) return no('That combatant is not on the map.');
    if (act.unit !== world.turnId) return no(`It's not ${u.name}'s turn.`);
    const w = fresh(world), me = w.units[u.id], b = budget(w);
    switch (act.type) {
      case 'move': {
        const x = Math.round(+act.x), y = Math.round(+act.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return no('Bad square.');
        if (x === me.x && y === me.y) return no('Already there.');
        const cost = reachable(w, me.id, b.moveLeft)[`${x},${y}`];
        if (cost === undefined) return no(b.moveLeft ? `${me.name} can't reach that square with ${b.moveLeft} ft of movement left.` : `${me.name} has no movement left this turn.`);
        me.x = x; me.y = y; w.turn.moved += cost;
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
        const nat = r.nat, crit = nat === 20, fumble = nat === 1;
        const hit = crit || (!fumble && r.total >= t.ac);
        w.turn.action = true;
        const tilt = pv.mode === 'normal' ? '' : ` with ${pv.mode === 'adv' ? 'advantage' : 'disadvantage'} (${pv.tilts.map((x) => x.text).join(', ')})`;
        const log = [{ kind: 'attack', roll: r, expr: pv.expr, text: `${me.name} attacks ${t.name} with ${attack.name}${tilt}: ${r.total} against AC ${t.ac}, ${crit ? 'a critical hit!' : hit ? 'a hit.' : fumble ? 'a natural 1, a miss.' : 'a miss.'}` }];
        const events = [];
        if (!hit) { events.push({ kind: 'miss', unit: t.id }); return { ok: true, world: w, log, events }; }
        const expr = crit ? attack.crit || attack.damage : attack.damage;
        const d = roll(expr);
        const amount = Math.max(0, d.total);
        const took = takeDamage(t, amount);
        log.push({ kind: 'damage', roll: d, expr, text: `${t.name} takes ${amount}${attack.type ? ' ' + attack.type : ''} damage${took.fromTemp ? ` (${took.fromTemp} from temporary hit points)` : ''}${t.hp != null && t.hp <= 0 ? ' and drops to 0 hit points.' : '.'}` });
        events.push({ kind: crit ? 'crit' : 'hit', unit: t.id, amount });
        return { ok: true, world: w, log, events };
      }
      case 'end':
        return { ok: true, world: w, log: [{ text: `${me.name} ends the turn.` }], events: [], endTurn: true };
      default:
        return no('Unknown combat action.');
    }
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
  //          npcSpeed: { entryId: feet }, turnState, reactions }
  function buildWorld(table) {
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
      };
      if (units[e.id].hp != null && units[e.id].hp <= 0) units[e.id].down = true;
    }
    const cur = table.turnId !== undefined ? (table.entries || []).find((e) => e.id === table.turnId) : (table.entries || [])[table.turn];
    return {
      active: !!table.active && !!cur, round: table.round || 1, turnId: cur ? cur.id : null, units,
      turn: table.turnState || null, reactions: table.reactions || {},
    };
  }

  return { FT, squaresBetween, feetBetween, reachable, readRange, attacksOf, attackFromBehavior, REASONS, preview, budget, apply, takeDamage, buildWorld, turnKey };
});
