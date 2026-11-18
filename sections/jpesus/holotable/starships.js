/* HoloTable starships: the rules of Starships of the Galaxy that change a ship in a fight, as pure functions.
   No page code, no storage, no dice of its own. The server (api/_holotable-ships.js) uses it to apply every ship
   action; the ship sheet (books.js) uses the same code to show a ship's state and what its conditions do to a roll.

   In this file: damage by type against shields and hull (SotG chapter 9, "Damage Types" and "Starship Resistances
   and Immunities"), what dropping to 0 hull points does (destroyed, or disabled with a level of system damage;
   instant destruction; ion damage only disables; the attacker's choice to disable), destruction saving throws,
   stabilizing, damage taken at 0 hull, and the ship conditions of SotG Appendix A with what each does to speed, hull
   and shield maximums, and the ship's ability checks, saving throws and attack rolls (and to attacks against it).

   Also: power dice (reactors, power couplings and their stores), shield dice and regeneration, the start of a ship's
   turn, and the Boost and Regenerate Shields actions (SotG chapters 5 and 9).

   A ship's fight state lives in ship.status, owned by the server: { cond: [names], slowed: 0-4, system: 0-6,
   zero: { s: successes, f: failures, stable, destroyed }, power: { central, engines, ... }, sdUsed, hdUsed,
   tempShield, boost: this turn's boosts }. Every number here is SotG's own arithmetic; no rule
   text is copied. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HTShips = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const copy = (o) => JSON.parse(JSON.stringify(o));
  // a table's own entry, never one every object inherits ("constructor", "__proto__"): names here come from sheets
  const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

  // ---- damage types against a ship: the share of the damage that reaches shields and hull (SotG chapter 9)
  // Hull resists ion, lightning and necrotic; shields resist acid, cold, fire and necrotic; neither takes poison or
  // psychic; sonic does nothing in space (full damage in an atmosphere).
  const DAMAGE = {
    energy: { shield: 1, hull: 1 }, force: { shield: 1, hull: 1 }, kinetic: { shield: 1, hull: 1 }, true: { shield: 1, hull: 1 },
    acid: { shield: 0.5, hull: 1 }, cold: { shield: 0.5, hull: 1 }, fire: { shield: 0.5, hull: 1 },
    ion: { shield: 1, hull: 0.5 }, lightning: { shield: 1, hull: 0.5 },
    necrotic: { shield: 0.5, hull: 0.5 },
    poison: { shield: 0, hull: 0 }, psychic: { shield: 0, hull: 0 },
    sonic: { shield: 0, hull: 0 },
  };
  const DAMAGE_TYPES = Object.keys(DAMAGE);
  // a weapon's typed damage ("Energy", "ion", "kinetic damage") as one of the names above; anything else is energy,
  // the common case, so a homebrew word never makes a hit do nothing
  const damageType = (t) => { const k = String(t || '').trim().toLowerCase().replace(/\s*damage$/, ''); return own(DAMAGE, k) ? k : 'energy'; };
  function multOf(type, atmosphere) {
    const k = damageType(type);
    if (k === 'sonic' && atmosphere) return { shield: 1, hull: 1 };
    return DAMAGE[k];
  }

  // ---- conditions (SotG Appendix A)
  const CONDITIONS = ['Blinded', 'Disabled', 'Ionized', 'Invisible', 'Shocked', 'Stalled', 'Stunned', 'Tractored', 'Used'];
  // what each does, in a few words, for the sheet's chips (our words, not the book's)
  const CONDITION_NOTES = {
    Blinded: 'Fails checks that need sight or sensors. Attacks against it have advantage; its attacks have disadvantage.',
    Disabled: 'No actions or reactions, no communication past 1,000 ft, 4 slowed levels.',
    Ionized: 'Disadvantage on attack rolls and ability checks.',
    Invisible: 'Attacks against it have disadvantage; its attacks have advantage.',
    Shocked: 'No reactions; each crew member takes an action or a bonus action, not both.',
    Stalled: 'Disabled; its active features end; fails Strength and Dexterity saves; attacks against it have advantage.',
    Stunned: '4 slowed levels; fails Strength and Dexterity saves; attacks against it have advantage.',
    Tractored: '4 slowed levels, until the tractoring ship is disabled or it gets out of reach.',
    Used: 'Worth half. A crew member who rolls a 1 on a check, attack or save makes a destruction save: a failure is a level of system damage.',
  };
  const SLOWED_FEET = [0, 150, 250, 300];   // speed lost at slowed levels 1-3; level 4 is speed 0 and no bonus to speed
  const SYSTEM_NOTES = ['', 'Disadvantage on ability checks', '1 slowed level', 'Disadvantage on attack rolls and saving throws',
    'Hull and shield maximums and shield regeneration halved', 'Permanently used', 'Catastrophic power failure: all primary systems fail'];

  function cleanStatus(st) {
    st = st && typeof st === 'object' && !Array.isArray(st) ? st : {};
    const z = st.zero && typeof st.zero === 'object' && !Array.isArray(st.zero) ? st.zero : {};
    const b = st.boost && typeof st.boost === 'object' && !Array.isArray(st.boost) ? st.boost : {};
    const f = st.fx && typeof st.fx === 'object' && !Array.isArray(st.fx) ? st.fx : {};
    const out = {
      cond: [...new Set((Array.isArray(st.cond) ? st.cond : []).filter((c) => CONDITIONS.includes(c)))],
      slowed: clamp(int(st.slowed), 0, 4), system: clamp(int(st.system), 0, 6),
      zero: { s: clamp(int(z.s), 0, 3), f: clamp(int(z.f), 0, 99), stable: !!z.stable, destroyed: !!z.destroyed },
      power: Object.fromEntries(['central', 'engines', 'shields', 'weapons', 'sensors', 'comms'].map((k) => [k, clamp(int((st.power || {})[k]), 0, 99)])),
      sdUsed: clamp(int(st.sdUsed), 0, 200), hdUsed: clamp(int(st.hdUsed), 0, 200), tempShield: clamp(int(st.tempShield), 0, 1000),
      boost: { tries: clamp(int(b.tries), 0, 20), engines: clamp(int(b.engines), 0, 2), weapons: b.weapons === true, shields: b.shields === true, regen: b.regen === true },
      // the Helm and crew actions' effects: evade / fly count down at the start of the ship's turns (2: this turn and
      // until the start of the next; 1: through the next turn); helm: a Helm action taken this turn
      fx: { evade: clamp(int(f.evade), 0, 2), fly: clamp(int(f.fly), 0, 2), hardTurn: f.hardTurn === true, helm: f.helm === true,
        interfered: f.interfered === true, directed: f.directed === true,
        interferedBy: typeof f.interferedBy === 'string' && /^[a-z0-9]{6,20}$/.test(f.interferedBy) ? f.interferedBy : '' },   // the ship whose next turn ends it
      recharged: st.recharged === true,   // a recharge just finished: the crew may spend hull dice
      astro: clamp(int(st.astro), 0, 10), startup: clamp(int(st.startup), 0, 10),   // astrogation equations, start-up procedures done
      // the course choice the equations were worked for (rushes, careful): changing it restarts them (SotG ch. 8)
      course: { rush: clamp(int((st.course || {}).rush), 0, 10), careful: (st.course || {}).careful === true },
    };
    if (out.system >= 5 && !out.cond.includes('Used')) out.cond.push('Used');   // system damage 5 makes it used for good
    return out;
  }
  const statusOf = (ship) => cleanStatus(ship && ship.status);
  const has = (st, c) => st.cond.includes(c);
  // Stalled includes Disabled; system damage 5 makes the ship used for good
  const isDisabled = (st) => has(st, 'Disabled') || has(st, 'Stalled');
  const isUsed = (st) => has(st, 'Used') || st.system >= 5;
  const isLost = (st) => st.zero.destroyed || st.system >= 6;   // exploded, or every primary system failed

  // the slowed level the ship moves at: its own levels, one more from system damage 2, and 4 while disabled, stunned
  // or tractored
  function slowedLevel(ship) {
    const st = statusOf(ship);
    if (isDisabled(st) || has(st, 'Stunned') || has(st, 'Tractored')) return 4;
    return clamp(st.slowed + (st.system >= 2 ? 1 : 0), 0, 4);
  }
  function speedOf(ship) {
    const base = Math.max(0, int(ship && ship.speed)), lv = slowedLevel(ship);
    return lv >= 4 ? 0 : Math.max(0, base - SLOWED_FEET[lv]);
  }
  // system damage 4 halves the hull and shield maximums
  const halved = (ship) => statusOf(ship).system >= 4;
  const hullMax = (ship) => { const m = Math.max(0, int(ship && ship.hull && ship.hull.max)); return halved(ship) ? Math.floor(m / 2) : m; };
  const shieldMax = (ship) => { const m = Math.max(0, int(ship && ship.shield && ship.shield.max)); return halved(ship) ? Math.floor(m / 2) : m; };
  // keep current points inside the (possibly halved) maximums; a sheet with no maximum typed yet keeps what it has
  function capPoints(ship) {
    ship.hull = ship.hull || { current: 0, max: 0 }; ship.shield = ship.shield || { current: 0, max: 0 };
    const cap = (o, max) => { o.current = Math.max(0, int(o.current)); if (int(o.max) > 0) o.current = Math.min(o.current, max); };
    cap(ship.hull, hullMax(ship)); cap(ship.shield, shieldMax(ship));
    return ship;
  }

  // What the ship's conditions do to one of its rolls. kind: 'check' | 'save' | 'attack' | 'against' (an attack made
  // against the ship). ability: the ship ability ('str', 'dex', ...) for checks and saves.
  // Returns { adv: [reasons], dis: [reasons], fail: [reasons] }.
  function rollEffects(ship, kind, ability) {
    const st = statusOf(ship), out = { adv: [], dis: [], fail: [] };
    const add = (k, why) => out[k].push(why);
    const fx = st.fx;
    // Evade ends when the ship is incapacitated (disabled) or its speed drops to 0 (SotG ch. 9)
    const evade = isDisabled(st) || has(st, 'Stunned') || has(st, 'Tractored') || st.slowed >= 4 ? 0 : fx.evade;
    if (kind === 'check' || kind === 'attack') {   // Evade and Fly cost the whole ship its aim; Interfere the next roll
      if (evade >= 1) add('dis', 'Evade');
      if (fx.fly >= 1) add('dis', 'Fly');
      if (fx.interfered) add('dis', 'Interfered');
    }
    if (kind === 'attack' && fx.directed) add('adv', 'Directed');
    if (kind === 'save' && ability === 'dex' && evade >= 2) add('adv', 'Evade');
    if (kind === 'against' && evade >= 2) add('dis', 'Evading');
    if (kind === 'check') {
      if (st.system >= 1) add('dis', 'System damage ' + st.system);
      if (has(st, 'Ionized')) add('dis', 'Ionized');
    }
    if (kind === 'save') {
      if (st.system >= 3) add('dis', 'System damage ' + st.system);
      if ((ability === 'str' || ability === 'dex') && (has(st, 'Stalled') || has(st, 'Stunned'))) add('fail', has(st, 'Stalled') ? 'Stalled' : 'Stunned');
    }
    if (kind === 'attack') {
      if (st.system >= 3) add('dis', 'System damage ' + st.system);
      if (has(st, 'Ionized')) add('dis', 'Ionized');
      if (has(st, 'Blinded')) add('dis', 'Blinded');
      if (has(st, 'Invisible')) add('adv', 'Invisible');
    }
    if (kind === 'against') {
      for (const c of ['Blinded', 'Stalled', 'Stunned']) if (has(st, c)) add('adv', c);
      if (has(st, 'Invisible')) add('dis', 'Invisible');
    }
    return out;
  }
  // one roll mode from the conditions and the one the person asked for (shift-click and the like): any advantage and
  // any disadvantage cancel, as for creatures
  function rollMode(fx, asked) {
    const adv = fx.adv.length > 0 || asked === 'adv', dis = fx.dis.length > 0 || asked === 'dis';
    return adv && dis ? 'normal' : adv ? 'adv' : dis ? 'dis' : 'normal';
  }

  // ---- damage
  // Damage of one type against the ship: shields first at the shields' share, what gets through goes to the hull at
  // the hull's share, then the rules for 0 hull points.
  // opts: { crit: the hit was a critical, disable: the attacker chooses to disable rather than destroy (only with a
  // primary or secondary weapon, or ion or lightning damage: the caller says which), atmosphere: sonic counts }
  // Returns { ship, shieldLost, hullLost, outcome: null | 'disabled' | 'destroyed' | 'system', log: [lines] }.
  function takeDamage(ship, amount, type, opts = {}) {
    const s = capPoints(copy(ship)), st = statusOf(s), name = s.name || 'The ship', k = damageType(type), mult = multOf(k, opts.atmosphere);
    const raw = clamp(int(amount), 0, 1000000), log = [];
    let left = raw, shieldLost = 0, hullLost = 0, outcome = null;
    s.status = st;
    if (isLost(st)) return { ship: s, shieldLost, hullLost, outcome, log: [`${name} is already lost.`] };
    if (!raw) return { ship: s, shieldLost, hullLost, outcome, log };
    st.recharged = false;
    const temp = int(st.tempShield);
    if (temp > 0 && mult.shield > 0) {   // temporary shield points (Boost Shields) go first
      const wouldTake = Math.floor(left * mult.shield);
      if (wouldTake <= temp) { st.tempShield = temp - wouldTake; shieldLost += wouldTake; left = 0; }
      else { st.tempShield = 0; shieldLost += temp; left -= Math.ceil(temp / mult.shield); }
    }
    const shield = int(s.shield.current);
    if (left > 0 && shield > 0 && mult.shield > 0) {
      const wouldTake = Math.floor(left * mult.shield);
      const took = Math.min(shield, wouldTake);
      if (wouldTake <= shield) left = 0; else left -= Math.ceil(shield / mult.shield);
      shieldLost += took; s.shield.current = shield - took;
    }
    const toHull = Math.floor(Math.max(0, left) * mult.hull), wasHull = int(s.hull.current);
    if (toHull > 0) {
      hullLost = Math.min(wasHull, toHull);
      s.hull.current = wasHull - hullLost;
      const over = toHull - hullLost, max = hullMax(s), ion = k === 'ion';
      if (!max) { /* a sheet with no hull maximum yet: no rules for 0 hull points */ }
      else if (wasHull > 0 && s.hull.current === 0) {
        // dropping to 0: massive damage destroys it outright (never ion damage); otherwise disabled with a level of
        // system damage, and stable when the attacker chose to disable it or the damage was ion
        if (!ion && over >= max && !opts.disable) { st.zero.destroyed = true; outcome = 'destroyed'; }
        else {
          addCond(st, 'Disabled'); st.system = clamp(st.system + 1, 0, 6); st.zero.s = 0; st.zero.f = 0;
          st.zero.stable = ion || !!opts.disable; outcome = 'disabled';
        }
      } else if (wasHull === 0) {
        // already at 0: a level of system damage (two on a critical), and no longer stable; damage of at least the
        // hull maximum destroys it (never ion damage, which leaves it stable)
        if (!ion && toHull >= max) { st.zero.destroyed = true; outcome = 'destroyed'; }
        else { st.system = clamp(st.system + (opts.crit ? 2 : 1), 0, 6); st.zero.stable = ion; outcome = 'system'; }
      }
    }
    const typeWord = k === 'energy' ? '' : ` ${k}`;
    const parts = [];
    if (shieldLost) parts.push(`${shieldLost} to shields`);
    if (hullLost || (toHull && !parts.length)) parts.push(`${hullLost} to hull`);
    log.push(`${name} takes ${raw}${typeWord} damage${parts.length ? ': ' + parts.join(', ') : ' (no effect on a ship)'}.`);
    if (outcome === 'destroyed') log.push(`💥 ${name} is destroyed.`);
    if (outcome === 'disabled') log.push(`${name} is down to 0 hull points: disabled${st.zero.stable ? ' and stable' : ''}, system damage ${st.system}.`);
    if (outcome === 'system') log.push(`${name} takes damage at 0 hull points: system damage ${st.system}${st.zero.stable ? '' : ', not stable'}.`);
    if (st.system >= 6 && outcome !== 'destroyed') log.push(`${name}'s primary systems fail.`);
    capPoints(s);
    return { ship: s, shieldLost, hullLost, outcome, log };
  }

  // Hull or shield points back. Hull back above 0 ends what dropping to 0 did: the destruction saves reset and the
  // ship is no longer disabled by it (a Disabled the GM set for another reason can be cleared on the sheet).
  function restore(ship, what, amount) {
    const s = capPoints(copy(ship)), st = statusOf(s), n = clamp(int(amount), 0, 1000000);
    s.status = st;
    if (isLost(st) || !n) return { ship: s, gained: 0 };
    const key = what === 'shield' ? 'shield' : 'hull', max = key === 'shield' ? shieldMax(s) : hullMax(s);
    const was = int(s[key].current), now = Math.min(max, was + n);
    s[key].current = now;
    if (key === 'hull') revive(s, was);
    return { ship: s, gained: now - was };
  }
  // the ship's hull went from wasHull to what it is now: if it came up from 0, it is back in the fight
  function revive(ship, wasHull) {
    const st = ship.status = statusOf(ship);
    if (!(int(wasHull) <= 0 && int(ship.hull && ship.hull.current) > 0) || isLost(st)) return false;
    st.zero = { s: 0, f: 0, stable: false, destroyed: false };
    st.cond = st.cond.filter((c) => c !== 'Disabled');
    return true;
  }

  // Who needs a destruction save: a ship at 0 hull that is neither stable nor lost.
  const dying = (ship) => { const st = statusOf(ship); return int(ship && ship.hull && ship.hull.current) <= 0 && hullMax(ship) > 0 && !st.zero.stable && !isLost(st); };
  // A destruction saving throw with this d20: 10 or more succeeds and the third success makes the ship stable; a
  // failure is a level of system damage; a 1 counts as two failures (two levels); a 20 gives back 1 hull point.
  function destructionSave(ship, d20) {
    const s = capPoints(copy(ship)), st = statusOf(s), name = s.name || 'The ship', r = clamp(int(d20), 1, 20);
    s.status = st;
    if (!dying(s)) return { ship: s, result: 'none', log: [] };
    let result;
    if (r === 20) {
      s.hull.current = Math.min(hullMax(s), 1);
      revive(s, 0);
      result = 'up';
    } else if (r >= 10) {
      st.zero.s += 1; result = 'success';
      if (st.zero.s >= 3) { st.zero.stable = true; st.zero.s = 3; result = 'stable'; }
    } else {
      const n = r === 1 ? 2 : 1;
      st.zero.f += n; st.system = clamp(st.system + n, 0, 6); result = r === 1 ? 'fail2' : 'fail';
    }
    const z = s.status.zero, sys = s.status.system;
    const line = {
      up: `${name} rolls a 20 on its destruction save: back to 1 hull point.`,
      success: `${name}'s destruction save: ${r}, a success (${z.s} of 3).`,
      stable: `${name}'s destruction save: ${r}, a third success. The ship is stable.`,
      fail: `${name}'s destruction save: ${r}, a failure. System damage ${sys}.`,
      fail2: `${name}'s destruction save: a 1, two failures. System damage ${sys}.`,
    }[result];
    const log = [line];
    if (sys >= 6) log.push(`${name}'s primary systems fail.`);
    capPoints(s);
    return { ship: s, result, log };
  }
  // A crew member's successful DC 10 Intelligence (mechanic's kit) check (or any repair) makes a ship at 0 hull stable.
  function stabilize(ship) {
    const s = copy(ship), st = s.status = statusOf(s);
    if (!dying(s)) return { ship: s, done: false };
    st.zero.stable = true;
    return { ship: s, done: true };
  }

  function addCond(st, c) { if (!st.cond.includes(c)) st.cond.push(c); }
  // set or clear one condition, or set a level (slowed 0-4, system 0-6); system damage 5 adds Used for good
  function setCondition(ship, name, on) {
    const s = copy(ship), st = s.status = statusOf(s);
    if (name === 'slowed' || name === 'system') {
      st[name] = clamp(int(on), 0, name === 'slowed' ? 4 : 6);
      if (name === 'system' && st.system >= 5) addCond(st, 'Used');   // and it stays when the level comes down
    } else if (CONDITIONS.includes(name)) {
      if (on) addCond(st, name); else st.cond = st.cond.filter((c) => c !== name);
    }
    return capPoints(s);
  }


  // ---- power and shields (SotG chapter 5, "Armor and Shields" and "Ship Power"; chapter 9, Boost and Regenerate Shields)
  // Per size, from SW5e's own size data (starshipBaseSize): the hull and shield die, how many of each by tier, and each
  // role's reactor, power coupling, shields (Large and up), speed / turning speed, ability adjustment and armor.
  const SIZE_DATA = {
    Tiny: { die: 4, dice: [1, 2, 3, 4, 5, 6], roles: { "Droid": ["Fuel Cell", "Distributed", "", 450, 200, {"int": 1}, "Deflection"], "Munition": ["Fuel Cell", "Direct", "", 450, 200, {"con": 1}, "Reinforced"], "Predator": ["Ionization", "Direct", "", 350, 100, {"dex": 1}, "Lightweight"], "Probe": ["Ionization", "Direct", "", 400, 150, {"wis": 1}, "Lightweight"], "Satellite": ["Ionization", "Direct", "", 400, 150, {"cha": 1}, "Lightweight"], "Worker": ["Fuel Cell", "Direct", "", 350, 100, {"str": 1}, "Reinforced"] } },
    Small: { die: 6, dice: [3, 4, 5, 6, 7, 8], roles: { "Attack Fighter": ["Power Core", "Direct", "", 350, 100, {"str": 1}, "Reinforced"], "Bomber": ["Fuel Cell", "Hub & Spoke", "", 450, 200, {"wis": 1}, "Deflection"], "Scout": ["Ionization", "Distributed", "", 450, 200, {"int": 1}, "Lightweight"], "Scrambler": ["Power Core", "Direct", "", 400, 150, {"cha": 1}, "Deflection"], "Shuttle": ["Fuel Cell", "Direct", "", 350, 100, {"con": 1}, "Deflection"], "Superiority Fighter": ["Ionization", "Hub & Spoke", "", 400, 150, {"dex": 1}, "Lightweight"] } },
    Medium: { die: 8, dice: [5, 6, 7, 8, 9, 10], roles: { "Courier": ["Ionization", "Hub & Spoke", "", 400, 250, {"dex": 1}, "Lightweight"], "Freighter": ["Fuel Cell", "Hub & Spoke", "", 300, 150, {"con": 1}, "Deflection"], "Gunship": ["Power Core", "Hub & Spoke", "", 300, 150, {"str": 1}, "Reinforced"], "Missile Boat": ["Power Core", "Direct", "", 400, 250, {"wis": 1}, "Reinforced"], "Navigator": ["Ionization", "Distributed", "", 350, 200, {"int": 1}, "Deflection"], "Yacht": ["Fuel Cell", "Distributed", "", 350, 200, {"cha": 1}, "Lightweight"] } },
    Large: { die: 10, dice: [7, 8, 9, 10, 11, 12], roles: { "Ambassador": ["Ionization", "Hub & Spoke", "Fortress", 350, 250, {"cha": 1, "con": 1}, "Deflection"], "Corvette": ["Fuel Cell", "Direct", "Directional", 400, 300, {"str": 1, "dex": 1}, "Deflection"], "Cruiser": ["Power Core", "Distributed", "Fortress", 400, 300, {"wis": 1, "str": 1}, "Reinforced"], "Explorer": ["Ionization", "Distributed", "Directional", 350, 250, {"dex": 1, "int": 1}, "Lightweight"], "Picket Ship": ["Power Core", "Hub & Spoke", "Quick-Charge", 300, 200, {"dex": 1, "wis": 1}, "Deflection"], "Ship's Tender": ["Fuel Cell", "Direct", "Quick-Charge", 300, 200, {"con": 1, "str": 1}, "Reinforced"] } },
    Huge: { die: 12, dice: [9, 11, 13, 15, 17, 19], roles: { "Battleship": ["Power Core", "Hub & Spoke", "Directional", 200, 400, {"wis": 1, "str": 1}, "Reinforced"], "Carrier": ["Ionization", "Hub & Spoke", "Directional", 300, 500, {"cha": 1, "int": 1}, "Deflection"], "Colonizer": ["Ionization", "Distributed", "Quick-Charge", 400, 600, {"con": 1, "int": 1}, "Deflection"], "Command Ship": ["Fuel Cell", "Distributed", "Fortress", 300, 500, {"cha": 1, "wis": 1}, "Reinforced"], "Interdictor": ["Power Core", "Distributed", "Quick-Charge", 200, 400, {"dex": 1, "str": 1}, "Deflection"], "Juggernaut": ["Power Core", "Direct", "Fortress", 400, 600, {"con": 1, "str": 1}, "Reinforced"] } },
    Gargantuan: { die: 20, dice: [11, 13, 15, 17, 19, 21], roles: { "Blockade Ship": ["Fuel Cell", "Direct", "Directional", 100, 400, {"dex": 1, "str": 1}, "Reinforced"], "Flag Ship": ["Power Core", "Distributed", "Quick-Charge", 200, 500, {"cha": 1, "wis": 1}, "Reinforced"], "Industrial Center": ["Fuel Cell", "Hub & Spoke", "Quick-Charge", 300, 600, {"con": 1, "str": 1}, "Deflection"], "Mobile Metropolis": ["Ionization", "Distributed", "Directional", 300, 600, {"con": 1, "wis": 1}, "Deflection"], "Researcher": ["Fuel Cell", "Hub & Spoke", "Fortress", 100, 400, {"int": 1, "wis": 1}, "Deflection"], "Warship": ["Power Core", "Distributed", "Fortress", 200, 500, {"wis": 1, "str": 1}, "Reinforced"] } },
  };
  const SHIELD_TYPES = { Directional: { cap: 1, regen: 1 }, Fortress: { cap: 3 / 2, regen: 2 / 3 }, 'Quick-Charge': { cap: 2 / 3, regen: 3 / 2 } };
  // power dice back at the start of each of the ship's turns, by reactor; fuel use is chapter 8's (travel)
  const REACTORS = { 'Fuel Cell': { recover: '1', fuel: 1 }, Ionization: { recover: '1d2-1', fuel: 0.5 }, 'Power Core': { recover: '1d2', fuel: 1.5 } };
  // where power dice are kept, by power coupling: a central store any ability can draw on, and one per system
  const COUPLINGS = { Direct: { central: 4, system: 0 }, Distributed: { central: 0, system: 2 }, 'Hub & Spoke': { central: 2, system: 1 } };
  const SYSTEMS = ['engines', 'shields', 'weapons', 'sensors', 'comms'];   // also the order recovered dice fill them in
  const POOLS = ['central', ...SYSTEMS];   // every power store; checked against this list, never with `in` (a "__proto__" key is in every object)
  const SYSTEM_NAMES = { central: 'Central', engines: 'Engines', shields: 'Shields', weapons: 'Weapons', sensors: 'Sensors', comms: 'Communications' };
  const POWER_DIE = [1, 4, 6, 8, 10, 12];   // by tier; at tier 0 a power die is a flat 1

  const sizeOf = (ship) => own(SIZE_DATA, ship && ship.size) || SIZE_DATA.Small;
  const roleOf = (ship) => { const r = own(sizeOf(ship).roles, String((ship && ship.role) || '').trim()); return r ? { reactor: r[0], coupling: r[1], shields: r[2], speed: r[3], turn: r[4], adj: r[5] || {}, armor: r[6] || '' } : null; };
  const tierOf = (ship) => clamp(int(ship && ship.tier), 0, 5);
  // the ship's reactor, coupling and shields: what the sheet says, else what its equipment says, else its role's
  function pickFrom(ship, field, table) {
    if (own(table, ship && ship[field])) return ship[field];
    const names = ((ship && ship.equipment) || []).map((e) => String(e && e.name || '').toLowerCase());
    for (const k of Object.keys(table)) {
      const w = k.toLowerCase().replace(' & ', ' ').replace('-', ' ');
      if (names.some((n) => n.replace(/&|-/g, ' ').replace(/\s+/g, ' ').includes(w))) return k;
    }
    const r = roleOf(ship), key = field === 'shieldType' ? 'shields' : field;
    return r && own(table, r[key]) ? r[key] : '';
  }
  const reactorOf = (ship) => pickFrom(ship, 'reactor', REACTORS);
  const couplingOf = (ship) => pickFrom(ship, 'coupling', COUPLINGS);
  const shieldTypeOf = (ship) => pickFrom(ship, 'shieldType', SHIELD_TYPES);
  const powerDie = (ship) => POWER_DIE[tierOf(ship)];
  const powerDieText = (ship) => (powerDie(ship) === 1 ? '1' : 'd' + powerDie(ship));
  // how many dice each store holds
  function powerCaps(ship) {
    const c = own(COUPLINGS, couplingOf(ship)) || { central: 0, system: 0 }, out = { central: c.central };
    for (const k of SYSTEMS) out[k] = c.system;
    return out;
  }
  // "3d6" typed on the sheet, else the size and tier's own count and die
  function diceOf(ship, kind) {
    const m = /^\s*(\d{1,3})\s*d\s*(\d{1,3})\s*$/i.exec(String((ship && ship[kind === 'hull' ? 'hullDice' : 'shieldDice']) || ''));
    if (m) return { n: clamp(int(m[1]), 0, 200), die: clamp(int(m[2]), 1, 100) };
    const z = sizeOf(ship);
    return { n: z.dice[tierOf(ship)], die: z.die };
  }
  const diceLeft = (ship, kind) => Math.max(0, diceOf(ship, kind).n - int(statusOf(ship)[kind === 'hull' ? 'hdUsed' : 'sdUsed']));
  // shield regeneration per round: the shield die's maximum times the shields' coefficient, halved at system damage 4;
  // a number typed in the sheet's Regen box wins
  function regenRate(ship) {
    const typed = /^\s*(\d{1,5})\s*$/.exec(String((ship && ship.shieldRegen) || ''));
    const t = own(SHIELD_TYPES, shieldTypeOf(ship));
    const base = typed ? int(typed[1]) : t ? Math.floor(diceOf(ship, 'shield').die * t.regen) : 0;
    return statusOf(ship).system >= 4 ? Math.floor(base / 2) : base;
  }
  // the DC of the next Boost this turn: 10, and 5 more for each boost already tried
  const boostDC = (ship) => 10 + 5 * int(statusOf(ship).boost.tries);
  // Regenerate Shields: 10 or half the missing shield points, whichever is higher
  const regenDC = (ship) => Math.max(10, Math.floor((shieldMax(ship) - int(ship && ship.shield && ship.shield.current)) / 2));
  // speed with this turn's boosts
  const boostedSpeed = (ship) => { const lv = slowedLevel(ship); return speedOf(ship) + (lv < 4 && int(statusOf(ship).boost.engines) > 0 ? 50 : 0); };
  // the feet the ship may move this turn: its speed, twice over after Fly
  const moveBudget = (ship) => boostedSpeed(ship) * (statusOf(ship).fx.fly >= 2 ? 2 : 1);

  // The start of the ship's turn. roll(expr) -> { total } is the server's dice.
  // opts.regen: the crew regenerates shields this turn (it costs a shield die).
  // Power dice come back by reactor and fill the stores (central first, then the systems in order); passive shield
  // regeneration, if the shields aren't down; this turn's boosts and temporary shield points end; a ship at 0 hull
  // makes its destruction save.
  function startTurn(ship, roll, opts = {}) {
    let s = capPoints(copy(ship));
    const st = s.status = statusOf(s), name = s.name || 'The ship', log = [];
    if (isLost(st)) return { ship: s, log: [`${name} is lost.`] };
    st.tempShield = 0; st.boost = { tries: 0, engines: Math.max(0, int(st.boost.engines) - 1), weapons: false, shields: false, regen: false };
    // Direct lasts until the start of the directing ship's next turn (Interfere ends at the interfering ship's: the space map)
    st.fx = Object.assign(st.fx, { evade: Math.max(0, st.fx.evade - 1), fly: Math.max(0, st.fx.fly - 1), hardTurn: false, helm: false, directed: false });
    st.recharged = false;
    // power
    const rx = own(REACTORS, reactorOf(s));
    if (rx && !isDisabled(st)) {
      const got = Math.max(0, int(roll(rx.recover).total)), caps = powerCaps(s);
      let left = got;
      for (const k of ['central', ...SYSTEMS]) { const room = Math.max(0, caps[k] - int(st.power[k])), put = Math.min(room, left); st.power[k] = int(st.power[k]) + put; left -= put; }
      const placed = got - left;
      log.push(`${name}'s reactor gives ${got} power ${got === 1 ? 'die' : 'dice'}${left ? ` (${placed} stored, ${left} with nowhere to go)` : ''}.`);
    }
    // passive shield regeneration: a shield die spent without rolling
    const rate = regenRate(s), sh = int(s.shield.current), cap = shieldMax(s);
    if (opts.regen && rate > 0 && sh > 0 && sh < cap && diceLeft(s, 'shield') > 0 && !isDisabled(st)) {
      const gain = Math.min(cap - sh, rate);
      s.shield.current = sh + gain; st.sdUsed += 1;
      log.push(`${name} regenerates ${gain} shield point${gain === 1 ? '' : 's'} (a shield die spent).`);
    }
    return { ship: s, log };
  }

  // Spend one power die from a store: a number rolled on the die for the tier (a flat 1 at tier 0).
  function usePower(ship, pool, roll) {
    const s = copy(ship), st = s.status = statusOf(s);
    if (!POOLS.includes(pool) || int(st.power[pool]) <= 0) return { ship: s, value: null };
    st.power[pool] -= 1;
    const d = powerDie(s), value = d === 1 ? 1 : int(roll('1d' + d).total);
    return { ship: s, value };
  }
  // the sheet's + and - on a store: within its capacity
  function setPower(ship, pool, n) {
    const s = copy(ship), st = s.status = statusOf(s), caps = powerCaps(s);
    if (POOLS.includes(pool)) st.power[pool] = clamp(int(n), 0, caps[pool]);
    return s;
  }
  function setDiceUsed(ship, kind, n) {
    const s = copy(ship), st = s.status = statusOf(s), k = kind === 'hull' ? 'hdUsed' : 'sdUsed';
    st[k] = clamp(int(n), 0, diceOf(s, kind).n);
    return s;
  }

  // Boost (SotG chapter 9): a Strength (Boost) check against boostDC; each function once a turn.
  // check: the check's total (the server rolled it). engines: +50 ft until the end of the ship's next turn. shields: a
  // shield die rolled (not spent) as temporary shield points until the start of its next turn. weapons: advantage on
  // its next damage roll this turn.
  function boost(ship, what, check, roll) {
    const s = copy(ship), st = s.status = statusOf(s), name = s.name || 'The ship', dc = boostDC(s);
    if (!['engines', 'shields', 'weapons'].includes(what)) return { ship: s, ok: false, log: [] };
    if (st.boost[what] === true || (what === 'engines' && int(st.boost.engines) >= 2)) return { ship: s, ok: false, already: true, log: [`${name} has already boosted its ${what} this turn.`] };
    st.boost.tries += 1;
    const ok = int(check) >= dc, log = [];
    if (!ok) log.push(`${name} fails to boost its ${what} (${check} against DC ${dc}).`);
    else if (what === 'engines') { st.boost.engines = 2; log.push(`${name} boosts its engines: +50 ft of speed until the end of its next turn.`); }
    else if (what === 'weapons') { st.boost.weapons = true; log.push(`${name} boosts its weapons: advantage on its next damage roll this turn.`); }
    else {
      st.boost.shields = true;
      const d = diceOf(s, 'shield').die, got = int(roll('1d' + d).total);
      st.tempShield = Math.max(int(st.tempShield), got);
      log.push(`${name} boosts its shields: ${got} temporary shield point${got === 1 ? '' : 's'} until the start of its next turn.`);
    }
    if (what !== 'engines' && ok) st.boost[what] = true;
    return { ship: s, ok, dc, log };
  }
  // Regenerate Shields (the action): a Strength (Boost) check against regenDC, once a ship turn, spending a shield die:
  // rolled on a success, rolled twice and the lower kept on a failure; restores shields even when they are down.
  function regenerateShields(ship, check, roll) {
    const s = copy(ship), st = s.status = statusOf(s), name = s.name || 'The ship';
    if (st.boost.regen) return { ship: s, done: false, log: [`${name} has already regenerated its shields this turn.`] };
    if (diceLeft(s, 'shield') <= 0) return { ship: s, done: false, log: [`${name} has no shield dice left.`] };
    const dc = regenDC(s), ok = int(check) >= dc, d = diceOf(s, 'shield').die;
    const a = int(roll('1d' + d).total), b = ok ? a : int(roll('1d' + d).total), got = ok ? a : Math.min(a, b);
    st.boost.regen = true; st.sdUsed += 1;
    const sh = int(s.shield.current), gain = Math.max(0, Math.min(shieldMax(s) - sh, got));
    s.shield.current = sh + gain;
    return { ship: s, done: true, ok, dc, gain, log: [`${name} regenerates its shields: ${check} against DC ${dc}, ${ok ? 'a success' : 'a failure (the lower of two rolls)'}, +${gain} shield point${gain === 1 ? '' : 's'}.`] };
  }


  // ---- the space map (SotG chapter 9, "Variant: Playing on a Grid" and "Variant: Sizes on a Grid"; jpesus's call on
  // #146: ship fights on their own map at 50 ft a square, ship tokens at ship scale)
  const SQUARE_FT = 50;
  const SQUARES = { Tiny: 1, Small: 1, Medium: 2, Large: 4, Huge: 8, Gargantuan: 16 };   // squares a side
  const squaresOf = (ship) => own(SQUARES, ship && ship.size) || 1;
  // eight facings, clockwise from up the map: 0 up, 2 right, 4 down, 6 left
  const FACING_NAMES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  // distance on the grid: straight squares are 50 ft; diagonals alternate 50 ft and 100 ft (SotG's grid variant)
  function gridFeet(dx, dy) {
    const a = Math.abs(int(dx)), b = Math.abs(int(dy)), diag = Math.min(a, b), straight = Math.max(a, b) - diag;
    return SQUARE_FT * (straight + diag + Math.floor(diag / 2));
  }
  // turning: 90 degrees costs the turning speed, so each 45-degree step half of it
  const turnSteps = (f1, f2) => { const d = (((int(f2) - int(f1)) % 8) + 8) % 8; return Math.min(d, 8 - d); };
  const turnCost = (ship, f1, f2) => Math.ceil(turnSteps(f1, f2) * Math.max(0, int(ship && ship.turn)) / 2);
  // what a move from token a to token b costs in feet: the squares, then the turn
  const moveCost = (ship, a, b) => gridFeet(int(b.x) - int(a.x), int(b.y) - int(a.y)) + turnCost(ship, a.f, b.f);
  // a token's top-left square inside the map for its size (the board's edge stops it)
  function inBounds(tok, size, cols, rows) {
    return { x: clamp(int(tok.x), 0, Math.max(0, cols - size)), y: clamp(int(tok.y), 0, Math.max(0, rows - size)), f: ((int(tok.f) % 8) + 8) % 8 };
  }
  // the gap between two ships in feet: from the nearest square of one to the nearest of the other
  function shipGap(a, sa, b, sb) {
    const gap = (p, ps, q, qs) => (q >= p + ps ? q - (p + ps) + 1 : p >= q + qs ? p - (q + qs) + 1 : 0);
    return gridFeet(gap(a.x, sa, b.x, sb), gap(a.y, sa, b.y, sb));
  }
  // which firing arc of ship a (at its facing) ship b's centre is in: forward, starboard, aft or port (each 90 degrees)
  function arcOf(a, sa, b, sb) {
    const dx = (b.x + sb / 2) - (a.x + sa / 2), dy = (b.y + sb / 2) - (a.y + sa / 2);
    if (!dx && !dy) return 'forward';
    const ang = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, rel = (ang - int(a.f) * 45 + 360 + 45) % 360;
    return ['forward', 'starboard', 'aft', 'port'][Math.floor(rel / 90)];
  }
  // initiative: an NPC ship rolls a Dexterity check with its size's modifier (SotG chapter 10); a party ship goes at the
  // lowest of its crew's initiative rolls (chapter 9)
  const INIT_SIZE_MOD = { Tiny: 0, Small: -3, Medium: -7, Large: -9, Huge: -10, Gargantuan: -11 };
  const npcInitBonus = (ship) => Math.floor((int((ship && ship.abilities || {}).dex, 10) - 10) / 2) + (own(INIT_SIZE_MOD, ship && ship.size) || 0);


  // ---- firing a ship weapon (SotG chapter 5, "Weapons" and "Weapon Properties"; chapter 9, "Making an Attack")
  const WEAPON_CATS = ['primary', 'secondary', 'tertiary', 'quaternary'];
  const MOUNTS = ['forward', 'starboard', 'aft', 'port', 'turret'];   // a fixed hardpoint fires in one arc; a turret in any
  const SIZE_ORDER = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
  const sizeRank = (ship) => Math.max(0, SIZE_ORDER.indexOf(ship && ship.size));
  const catOf = (w) => (WEAPON_CATS.includes(w && w.cat) ? w.cat : 'primary');
  // "1200/4800", or the "(range 1200/4800)" in its properties
  function weaponRange(w) {
    const m = /(\d{1,6})\s*\/\s*(\d{1,6})/.exec(String((w && w.range) || '')) || /range\s*(\d{1,6})\s*\/\s*(\d{1,6})/i.exec(String((w && w.props) || ''));
    return m ? { a: int(m[1]), b: int(m[2]) } : null;
  }
  // a property from the weapon's list: its number ("keen 1", "vicious 2", "con. 15"), true when it has no number
  function weaponProp(w, name) {
    const text = String((w && w.props) || '').toLowerCase(), alias = name === 'constitution' ? '(?:constitution|con\\.?)' : name;
    const m = new RegExp(`(?:^|[,;(]\\s*|\\s)${alias}(?:\\s+(\\d{1,3}))?(?=\\s*(?:[,;)]|$))`).exec(text);
    return m ? (m[1] !== undefined ? int(m[1]) : true) : null;
  }
  const crewPbOf = (pb) => clamp(int(pb, 2), 0, 10);
  // the attack bonus (primary and secondary) and save DC (tertiary and quaternary): the ship's Wisdom, the gunner's
  // proficiency, the weapon's own bonus
  const wisMod = (ship) => Math.floor((int((ship && ship.abilities || {}).wis, 10) - 10) / 2);
  const strMod = (ship) => Math.floor((int((ship && ship.abilities || {}).str, 10) - 10) / 2);
  // saturate: the better of Strength and Wisdom
  const aimMod = (ship, w) => (weaponProp(w, 'saturate') ? Math.max(wisMod(ship), strMod(ship)) : wisMod(ship));
  const attackBonusOf = (ship, w, pb) => aimMod(ship, w) + crewPbOf(pb) + int(w && w.atkMisc);
  const saveDcOf = (ship, w, pb) => 8 + crewPbOf(pb) + aimMod(ship, w) + int(w && w.atkMisc);
  // Firing modes: a single shot, and rapid or burst for weapons with those properties (auto weapons fire only in those).
  // Rapid: one target saves (Dexterity, DC 8 + the attack bonus) or takes the damage plus its dice again; nothing on a
  // success. Burst: every ship in a 150-ft cube on the target saves or takes the damage; nothing on a success. Each
  // uses as many shots of heat or ammunition as its number.
  function weaponModes(w) {
    const out = weaponProp(w, 'auto') ? [] : ['single'];
    if (weaponProp(w, 'rapid')) out.push('rapid');
    if (weaponProp(w, 'burst')) out.push('burst');
    return out.length ? out : ['single'];
  }
  const shotCost = (w, mode) => (mode === 'rapid' || mode === 'burst' ? Math.max(1, typeof weaponProp(w, mode) === 'number' ? weaponProp(w, mode) : 1) : 1);
  // overheat N: shots before the weapon must be cooled (an action); null when it doesn't overheat
  const heatCap = (w) => (typeof weaponProp(w, 'overheat') === 'number' ? weaponProp(w, 'overheat') : null);
  const reloadOf = (w) => (typeof weaponProp(w, 'reload') === 'number' ? weaponProp(w, 'reload') : null);
  // the squares of a 150-ft cube (3 x 3) on a ship token, and whether a ship of n squares at t has a square in it
  function burstBox(t, n) { const c = { x: t.x + n / 2, y: t.y + n / 2 }; return { x0: c.x - 1.5, y0: c.y - 1.5, x1: c.x + 1.5, y1: c.y + 1.5 }; }
  const inBox = (box, t, n) => t.x < box.x1 && t.x + n > box.x0 && t.y < box.y1 && t.y + n > box.y0;
  // The damage of a hit: the weapon's dice (twice on a critical) plus the ship's Strength for primary and secondary
  // weapons, plus half of it (rounded up, at least 1) for a heavy weapon.
  function damageExpr(ship, w, crit) {
    const m = /^\s*(\d{1,2})d(\d{1,3})\s*([+-]\s*\d{1,3})?\s*$/i.exec(String((w && w.dmg) || ''));
    if (!m) return '';
    const n = int(m[1]) * (crit ? 2 : 1), flat = m[3] ? int(m[3].replace(/\s/g, '')) : 0, cat = catOf(w);
    let bonus = flat;
    if (cat === 'primary' || cat === 'secondary') bonus += strMod(ship);
    if (weaponProp(w, 'heavy')) bonus += Math.max(1, Math.ceil(strMod(ship) / 2));
    return `${n}d${m[2]}` + (bonus ? (bonus > 0 ? '+' : '') + bonus : '');
  }
  // Can this weapon fire at that ship from here, and how? a / ta: the two tokens (x, y, f); returns
  // { ok, why, feet, arc, kind: 'attack' | 'save', adv: [reasons], dis: [reasons] } where adv / dis are for the attack
  // roll, or (kind 'save') for the target's saving throw.
  function fireCheck(ship, a, w, target, ta) {
    const sa = squaresOf(ship), st = squaresOf(target), feet = shipGap(a, sa, ta, st), arc = arcOf(a, sa, ta, st), cat = catOf(w);
    const big = sizeRank(ship) >= 4;   // Huge or larger: its primary weapons (point-defense) call for a save, like tertiary ones
    const out = { ok: true, why: '', feet, arc, kind: cat === 'tertiary' || cat === 'quaternary' || (cat === 'primary' && big) ? 'save' : 'attack', adv: [], dis: [] };
    const no = (why) => Object.assign(out, { ok: false, why });
    if (w && w.arc && w.arc !== 'turret' && MOUNTS.includes(w.arc) && arc !== w.arc) return no(`it is in the ${arc} arc, and this weapon fires ${w.arc}`);
    if (cat === 'quaternary') return no('bombs and mines are dropped or launched, not fired at a ship');
    const r = weaponRange(w);
    // primary: past normal range, disadvantage on the attack (a Huge or larger ship's: advantage on the target's save)
    if (cat === 'primary' && r) { if (feet > r.b) return no(`${feet} ft is beyond its long range (${r.b} ft)`); if (feet > r.a) (big ? out.adv : out.dis).push('long range'); }
    if (cat === 'secondary') {
      if (big && sizeRank(target) <= 1) return no('a Huge or larger ship\'s secondary weapons can\'t target Small or Tiny ships');
      if (r) { if (feet > r.b) return no(`${feet} ft is beyond its range (${r.b} ft)`); if (feet <= r.a) out.dis.push('close range'); }
      if (big && sizeRank(target) <= 3) out.dis.push('a smaller target');
    }
    if (cat === 'tertiary') {
      if (r && feet > r.b) return no(`${feet} ft is beyond its long range (${r.b} ft)`);
      const homing = !!weaponProp(w, 'homing');
      if (r && feet > r.a && !homing) out.adv.push('long range');
      if (homing && (!r || feet <= r.a)) out.dis.push('homing');
      const d = sizeRank(target) - sizeRank(ship);
      if (d <= -2) out.adv.push('a much smaller ship'); if (d >= 2) out.dis.push('a much larger ship');
    }
    if (out.kind === 'attack') {
      if (feet <= 50) out.dis.push('within 50 ft');
      const mine = rollEffects(ship, 'attack'), theirs = rollEffects(target, 'against');
      out.adv.push(...mine.adv, ...theirs.adv); out.dis.push(...mine.dis, ...theirs.dis);
      const con = weaponProp(w, 'constitution');
      if (typeof con === 'number' && int((ship.abilities || {}).con, 10) < con) out.dis.push(`Constitution under ${con}`);
    }
    return out;
  }


  // ---- the Helm and crew actions (SotG chapter 9, "Actions in Combat")
  const HELM = ['evade', 'fly', 'hardturn', 'ram'];
  // a ship's skill check bonus with a crew member's proficiency bonus: the ability, plus pb once or twice (proficiently or
  // expertly equipped)
  const SKILL_ABILITY = { astrogation: 'int', boost: 'str', data: 'int', hide: 'dex', impress: 'cha', interfere: 'cha', maneuvering: 'dex', menace: 'cha',
    patch: 'con', probe: 'int', ram: 'str', regulation: 'con', scan: 'wis', swindle: 'cha' };
  function skillBonus(ship, skill, pb) {
    const ab = own(SKILL_ABILITY, skill); if (!ab) return 0;
    const mod = Math.floor((int((ship && ship.abilities || {})[ab], 10) - 10) / 2);
    return mod + clamp(int((ship && ship.skills || {})[skill]), 0, 2) * crewPbOf(pb);
  }
  // Evade, Fly or Hard Turn (one Helm action a turn): Evade gives attacks against it disadvantage and its Dexterity
  // saves advantage until the start of its next turn, and its own checks and attacks disadvantage until the end of
  // its next turn; Fly doubles this turn's movement at the same cost to its aim; Hard Turn makes its next turn of up
  // to 90 degrees cost nothing.
  function helm(ship, what) {
    const s = copy(ship), st = s.status = statusOf(s), name = s.name || 'The ship';
    if (!['evade', 'fly', 'hardturn'].includes(what)) return { ship: s, ok: false, log: [] };
    if (st.fx.helm) return { ship: s, ok: false, log: [`${name} has already taken a Helm action this turn.`] };
    st.fx.helm = true;
    if (what === 'evade') st.fx.evade = 2;
    if (what === 'fly') st.fx.fly = 2;
    if (what === 'hardturn') st.fx.hardTurn = true;
    const said = { evade: `${name} evades: attacks against it have disadvantage until its next turn, and its own rolls have disadvantage through it.`,
      fly: `${name} flies flat out: twice its speed this turn, and disadvantage on its rolls through its next turn.`,
      hardturn: `${name} makes a hard turn: its next turn of up to 90° costs no movement.` }[what];
    return { ship: s, ok: true, log: [said] };
  }
  // Patch (the action, any number a turn): a Constitution (Patch) check against 10 or half the missing hull points,
  // spending a hull die: rolled on a success, rolled twice and the lower kept on a failure.
  const patchDC = (ship) => Math.max(10, Math.floor((hullMax(ship) - int(ship && ship.hull && ship.hull.current)) / 2));
  function patch(ship, check, roll) {
    const s = capPoints(copy(ship)), st = s.status = statusOf(s), name = s.name || 'The ship';
    if (isLost(st)) return { ship: s, done: false, log: [`${name} is lost.`] };
    if (diceLeft(s, 'hull') <= 0) return { ship: s, done: false, log: [`${name} has no hull dice left.`] };
    if (int(s.hull.current) >= hullMax(s)) return { ship: s, done: false, log: [`${name}'s hull needs no patching.`] };
    const dc = patchDC(s), ok = int(check) >= dc, d = diceOf(s, 'hull').die;
    const a = int(roll('1d' + d).total), b = ok ? a : int(roll('1d' + d).total), got = ok ? a : Math.min(a, b);
    st.hdUsed += 1;
    const r = restore(s, 'hull', got);
    return { ship: r.ship, done: true, ok, dc, gain: r.gained, log: [`${name} is patched up: ${check} against DC ${dc}, ${ok ? 'a success' : 'a failure (the lower of two rolls)'}, +${r.gained} hull point${r.gained === 1 ? '' : 's'}.`] };
  }


  // ---- what size, tier and role give a ship (SotG chapters 1, 3 and 5; SW5e's size data)
  // armor: how much Dexterity counts toward AC, and the damage reduction against attack rolls
  const ARMORS = { Lightweight: { cap: 99, dr: 0 }, Deflection: { cap: 2, dr: 3 }, Reinforced: { cap: 0, dr: 6 } };
  const armorOf = (ship) => pickFrom(ship, 'armor', ARMORS);
  const SIZE_ADJ = { Tiny: { dex: 4, con: -4 }, Small: { dex: 2, con: -2 }, Medium: {}, Large: { dex: -2, con: 2 }, Huge: { dex: -4, con: 4 }, Gargantuan: { dex: -6, con: 6 } };
  const SLOTS = { Tiny: 10, Small: 20, Medium: 30, Large: 50, Huge: 60, Gargantuan: 70 };
  const SUITES = { Small: [-1, 1], Medium: [3, 1], Large: [3, 2], Huge: [6, 3], Gargantuan: [10, 4] };   // base + k x Con modifier, at least 0; Tiny: none
  const SAVES = { Tiny: ['dex', 'int'], Small: ['str', 'dex'], Medium: [], Large: ['wis'], Huge: ['wis'], Gargantuan: ['wis'] };
  const SAVE_NOTE = { Medium: 'your choice of two', Large: 'Wisdom and your choice of Strength or Constitution', Huge: 'Wisdom and your choice of Strength or Constitution', Gargantuan: 'Wisdom and your choice of Strength or Constitution' };
  const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
  const modOf = (ship, ab) => Math.floor((int((ship && ship.abilities || {})[ab], 10) - 10) / 2);
  const avgDie = (d) => Math.floor(d / 2) + 1;   // the fixed value for a die after the first (rounded up)
  // points from dice: the first die's maximum, the fixed value for each one after, and the ability modifier on each
  const dicePoints = (n, d, mod) => (n > 0 ? d + avgDie(d) * (n - 1) + mod * n : 0);
  // everything the rules work out from the ship's size, tier, role, armor, shields and ability scores
  function derive(ship) {
    const size = own(SIZE_DATA, ship && ship.size) ? ship.size : 'Small', tier = tierOf(ship), role = roleOf(ship);
    const hd = diceOf(Object.assign({}, ship, { hullDice: '' }), 'hull'), sd = diceOf(Object.assign({}, ship, { shieldDice: '' }), 'shield');
    const con = modOf(ship, 'con'), str = modOf(ship, 'str'), dex = modOf(ship, 'dex');
    const shieldType = own(SHIELD_TYPES, shieldTypeOf(ship)), shieldBase = dicePoints(sd.n, sd.die, str);
    const armor = armorOf(ship), cap = (own(ARMORS, armor) || ARMORS.Lightweight).cap;
    const suite = own(SUITES, size);
    return {
      size, tier, role: role ? ship.role : '', armor,
      hullDice: `${hd.n}d${hd.die}`, shieldDice: `${sd.n}d${sd.die}`,
      hull: Math.max(1, dicePoints(hd.n, hd.die, con)),
      shieldBase, shield: shieldType ? Math.floor(shieldBase * shieldType.cap) : 0, shieldType: shieldType ? shieldTypeOf(ship) : '',
      ac: 10 + Math.min(dex, cap) + Math.max(0, tier - 1),
      speed: role ? role.speed : null, turn: role ? role.turn : null,
      suites: suite ? Math.max(0, suite[0] + suite[1] * con) : 0, slots: own(SLOTS, size) || 0,
      saves: own(SAVES, size) || [], saveNote: own(SAVE_NOTE, size) || '',
      sizeAdj: own(SIZE_ADJ, size) || {}, roleAdj: role ? role.adj : {},
    };
  }
  // the armor's damage reduction against a hit from an attack roll; damage it would bring to 0 is 1 instead
  const armorDR = (ship) => (own(ARMORS, armorOf(ship)) || { dr: 0 }).dr;
  const afterDR = (ship, amount) => { const n = int(amount), dr = armorDR(ship); return n <= 0 || !dr ? n : Math.max(1, n - dr); };


  // ---- between fights: recharging and refitting (SotG chapter 8)
  const REFIT_TIME = { Tiny: '4 hours', Small: '8 hours', Medium: '1 day', Large: '3 days', Huge: '1 week', Gargantuan: '1 month' };
  const UPGRADE_COST = { Tiny: 0.5, Small: 1, Medium: 2, Large: 10, Huge: 100, Gargantuan: 1000 };
  const EQUIP_WORKFORCE = { Tiny: 1, Small: 1, Medium: 2, Large: 5, Huge: 50, Gargantuan: 500 };     // recharging
  const UPGRADE_WORKFORCE = { Tiny: 1, Small: 1, Medium: 5, Large: 50, Huge: 500, Gargantuan: 5000 }; // refitting
  const sizeKey = (ship) => (own(SIZE_DATA, ship && ship.size) ? ship.size : 'Small');
  // Recharging (an hour, with the crew for the size): shields back to full and half the shield dice back; then the crew
  // may spend hull dice (rechargeHullDie)
  function recharge(ship) {
    const s = capPoints(copy(ship)), st = s.status = statusOf(s), name = s.name || 'The ship';
    if (isLost(st)) return { ship: s, done: false, log: [`${name} is lost.`] };
    const back = Math.min(st.sdUsed, Math.floor(diceOf(s, 'shield').n / 2));
    st.sdUsed -= back; s.shield.current = shieldMax(s); st.recharged = true;
    return { ship: s, done: true, log: [`${name} recharges (an hour, a crew of ${own(EQUIP_WORKFORCE, sizeKey(s))}): shields full, ${back} shield ${back === 1 ? 'die' : 'dice'} back. Its crew can spend hull dice now.`] };
  }
  // after a recharge, a hull die spent with an Intelligence (mechanic's kit) check: 10 or less, the die twice and the
  // lower; 11 to 20, the die; 21 or more, the die twice and the higher; plus the ship's Constitution
  function rechargeHullDie(ship, check, roll) {
    const s = capPoints(copy(ship)), st = s.status = statusOf(s), name = s.name || 'The ship';
    if (!st.recharged) return { ship: s, done: false, log: [`${name} needs to recharge first.`] };
    if (diceLeft(s, 'hull') <= 0) return { ship: s, done: false, log: [`${name} has no hull dice left.`] };
    if (int(s.hull.current) >= hullMax(s)) return { ship: s, done: false, log: [`${name}'s hull is whole.`] };
    const d = diceOf(s, 'hull').die, c = int(check), a = int(roll('1d' + d).total);
    const got = c <= 10 ? Math.min(a, int(roll('1d' + d).total)) : c >= 21 ? Math.max(a, int(roll('1d' + d).total)) : a;
    st.hdUsed += 1;
    const r = restore(s, 'hull', Math.max(0, got + modOf(s, 'con')));
    r.ship.status.recharged = true;
    return { ship: r.ship, done: true, gain: r.gained, log: [`${name} spends a hull die (${c}: ${c <= 10 ? 'the lower of two' : c >= 21 ? 'the higher of two' : 'one roll'}): +${r.gained} hull point${r.gained === 1 ? '' : 's'}.`] };
  }
  // Refitting (docked at a spaceport or shipyard): hull and shields full, every hull and shield die back, system damage
  // one level lower (which also repairs failed primary systems); costs 100 credits per missing hull die times the size's
  // upgrade cost, and takes the size's time
  function refitCost(ship) { return Math.round(100 * Math.min(statusOf(ship).hdUsed, diceOf(ship, 'hull').n) * own(UPGRADE_COST, sizeKey(ship))); }
  function refit(ship) {
    const s = copy(ship), st = s.status = statusOf(s), name = s.name || 'The ship', cost = refitCost(ship), size = sizeKey(s);
    if (st.zero.destroyed) return { ship: s, done: false, log: [`${name} was destroyed.`] };
    const was = st.system;
    st.system = Math.max(0, st.system - 1); st.hdUsed = 0; st.sdUsed = 0; st.recharged = false;
    st.zero = { s: 0, f: 0, stable: false, destroyed: false }; st.cond = st.cond.filter((c) => c !== 'Disabled');
    capPoints(s); s.hull.current = hullMax(s); s.shield.current = shieldMax(s);
    return { ship: s, done: true, cost, log: [`${name} is refitted (${own(REFIT_TIME, size)}, a crew of ${own(UPGRADE_WORKFORCE, size).toLocaleString('en-US')}, ${cost.toLocaleString('en-US')} cr): hull and shields full, all dice back${was ? `, system damage ${st.system}` : ''}.`] };
  }


  // ---- modifications (SotG chapter 4): slots against capacity, suites against the maximum, grade against tier
  const MOD_TYPES = ['Engineering', 'Operation', 'Suite', 'Universal', 'Weapon'];
  const MOD_COST = { Engineering: 3500, Operation: 3500, Suite: 5000, Universal: 4000, Weapon: 3000 };
  const MOD_SIZE_COST = { Tiny: 0.5, Small: 1, Medium: 2, Large: 5, Huge: 50, Gargantuan: 500 };
  // the installation check's DC, by the modification's grade (rows) and the ship's tier (columns)
  const INSTALL_DC = [[10, 9, 8, 7, 6, 5], [17, 12, 11, 10, 9, 8], [24, 19, 14, 13, 12, 11], [31, 26, 21, 16, 15, 14], [38, 33, 28, 23, 18, 17], [45, 40, 35, 30, 25, 20]];
  const modGrade = (m) => clamp(int(m && m.grade), 0, 5);
  // a modification from a tier feature takes no slot and doesn't count against the suites; stock ones do
  const slotted = (ship) => ((ship && ship.mods) || []).filter((m) => m && !m.free);
  function modsSummary(ship) {
    const size = sizeKey(ship), used = slotted(ship).length, cap = own(SLOTS, size) || 0;
    const suites = slotted(ship).filter((m) => m.type === 'Suite').length, suiteMax = size === 'Tiny' ? 0 : derive(ship).suites;
    return { used, cap, over: Math.max(0, used - cap), suites, suiteMax };
  }
  // how far past capacity modification i is: 0 within it, 1 for the first past it, 2 for the second, and so on
  function pastCapacity(ship, i) {
    const m = ((ship && ship.mods) || [])[i]; if (!m || m.free) return 0;
    const before = ((ship.mods || []).slice(0, i + 1)).filter((x) => x && !x.free).length;
    return Math.max(0, before - (own(SLOTS, sizeKey(ship)) || 0));
  }
  // its cost: the category's base cost (50% more when it needs a slot added past capacity) x the size's modification
  // cost x the grade (grade 0 and 1 cost the same)
  function modCost(ship, m, i) {
    const base = (own(MOD_COST, m && m.type) || 4000) * (i != null && pastCapacity(ship, i) > 0 ? 1.5 : 1);
    return Math.round(base * own(MOD_SIZE_COST, sizeKey(ship)) * Math.max(1, modGrade(m)));
  }
  // the DC for installing modification i: the grade and tier table, plus a cumulative 2 for each modification past
  // capacity on a Tiny to Medium ship, 1 on a Large to Gargantuan one
  function installDC(ship, i) {
    const m = ((ship && ship.mods) || [])[i]; if (!m) return null;
    return INSTALL_DC[modGrade(m)][tierOf(ship)] + (sizeRank(ship) <= 2 ? 2 : 1) * pastCapacity(ship, i);
  }
  // its prerequisites: true (met), false (not met) or null (for the GM to judge), each with a reason
  function prereqs(ship, m) {
    const names = ((ship && ship.mods) || []).filter((x) => x && x !== m).map((x) => String(x.name || '').trim().toLowerCase());
    return String((m && m.pre) || '').split(/;\s*/).map((p) => p.trim()).filter(Boolean).map((p) => {
      const sz = /^ship size (tiny|small|medium|large|huge|gargantuan) or (larger|smaller)$/i.exec(p);
      if (sz) {
        const want = SIZE_ORDER.findIndex((x) => x.toLowerCase() === sz[1].toLowerCase()), have = sizeRank(ship);
        return { pre: p, ok: sz[2].toLowerCase() === 'larger' ? have >= want : have <= want };
      }
      const two = /^two (.+?)s?$/i.exec(p);
      if (two) return { pre: p, ok: names.filter((n) => n.includes(two[1].toLowerCase())).length >= 2 };
      if (names.includes(p.toLowerCase())) return { pre: p, ok: true };
      if (/^[A-Z][\w' ,-]*(Mk [IVX]+)?$/.test(p) && !/\b(weapon|that|with|or|deals)\b/i.test(p)) return { pre: p, ok: false };   // looks like another modification's name
      return { pre: p, ok: null };
    });
  }


  // ---- travel (SotG chapter 8): hyperspace times by region and hyperdrive class, fuel, astrogation, start-up
  const REGIONS = ['Deep Core', 'Core', 'Colonies', 'Inner Rim', 'Expansion Region', 'Mid Rim', 'Outer Rim', 'Wild Space', 'Unknown Regions'];
  // base hours with a class 1 hyperdrive, from (rows) to (columns)
  const HYPER_HOURS = [
    [12, 18, 24, 48, 72, 96, 120, 144, 168], [24, 6, 24, 36, 60, 84, 96, 120, 144], [48, 24, 12, 24, 48, 72, 96, 120, 96],
    [72, 36, 24, 18, 24, 48, 72, 96, 72], [96, 60, 48, 24, 24, 24, 48, 72, 96], [120, 84, 72, 48, 24, 36, 24, 48, 72],
    [144, 96, 96, 72, 48, 24, 48, 24, 60], [168, 120, 120, 96, 72, 48, 24, 12, 120], [192, 144, 96, 72, 60, 72, 96, 120, 48]];
  const START_UP = { Tiny: '1 minute', Small: '2 minutes', Medium: '5 minutes', Large: '10 minutes', Huge: '30 minutes', Gargantuan: '60 minutes' };
  // the hyperdrive's class from the sheet ("1", "2", ".5", "Class 0.5"); null with none
  // the hyperdrive's class from the sheet's Hyperdrive box, else from a hyperdrive in its equipment ("... class 2")
  function hyperClass(ship) {
    const read = (t) => { const m = /(\d*\.?\d+)/.exec(String(t || '')); const v = m ? parseFloat(m[1]) : NaN; return v > 0 && v <= 20 ? v : null; };
    const typed = read(ship && ship.hyper);
    if (typed) return typed;
    const eq = ((ship && ship.equipment) || []).find((e) => e && /hyperdrive/i.test(String(e.name || '') + ' ' + String(e.notes || '')) && /class\s*\d*\.?\d+/i.test(String(e.notes || '')));
    return eq ? read(/class\s*(\d*\.?\d+)/i.exec(String(eq.notes))[1]) : null;
  }
  // equations (or start-up procedures) completed by one check: 9 or lower none; 10-15 one; 16-20 two; 21-25 three;
  // 26-29 four; 30 or more five
  const stepsFor = (total) => { const t = int(total); return t >= 30 ? 5 : t >= 26 ? 4 : t >= 21 ? 3 : t >= 16 ? 2 : t >= 10 ? 1 : 0; };
  // a jump's travel time: the table's hours times the hyperdrive class; each "rush" (-5 on the checks) takes a day off,
  // or halves what's left under a day (at least an hour); "careful" (+5) doubles it
  function jumpHours(ship, from, to, rush, careful) {
    const a = REGIONS.indexOf(from), b = REGIONS.indexOf(to), c = hyperClass(ship);
    if (a < 0 || b < 0 || !c) return null;
    let h = HYPER_HOURS[a][b] * c;
    if (careful) h *= 2;
    for (let i = 0; i < clamp(int(rush), 0, 10); i++) h = h - 24 >= 24 ? h - 24 : Math.max(1, h / 2);
    return Math.round(h * 10) / 10;
  }
  // fuel for a jump: one unit for the jump and one for each day (or part) in hyperspace, times the reactor's fuel use
  const jumpFuel = (ship, hours) => { const rx = own(REACTORS, reactorOf(ship)); return Math.ceil((1 + Math.ceil(int(Math.ceil(hours)) / 24)) * (rx ? rx.fuel : 1)); };
  const fuelOf = (ship) => { const m = /(\d+(?:\.\d+)?)/.exec(String((ship && ship.fuel) || '')); return m ? parseFloat(m[1]) : null; };
  // a rushed jump's mishap: a d20 plus the equations completed (SotG's table)
  const MISHAPS = [
    [20, 'no adverse consequences'],
    [18, 'dumped cargo sets off the collision alarm: a DC 15 Constitution save or 3 hull dice of damage (half on a success); 10d10 tons of cargo to salvage'],
    [15, 'an uncharted dust cloud: Scan and Probe checks at disadvantage until it is refitted'],
    [12, 'too close to a supernova: Intelligence checks at disadvantage until it is refitted'],
    [9, 'an unexpected gravity field: maneuvering checks at disadvantage until it is refitted'],
    [6, 'intense gravity warps the hull: AC -2 until it is refitted'],
    [3, 'significant debris: kinetic damage of a tenth of its hull maximum, and shields regenerate at half rate until it is refitted'],
    [-99, 'catastrophic hyperdrive failure: no hyperdrive until it is refitted'],
  ];
  const mishapFor = (total) => MISHAPS.find(([lo]) => int(total) >= lo)[1];

  // what the sheet shows of a ship's state, in short phrases
  function summary(ship) {
    const st = statusOf(ship), hullNow = int(ship && ship.hull && ship.hull.current), out = [];
    if (st.zero.destroyed) out.push('Destroyed');
    else if (st.system >= 6) out.push('All primary systems failed');
    else if (hullNow <= 0 && hullMax(ship) > 0) out.push(st.zero.stable ? 'At 0 hull, stable' : `At 0 hull: destruction saves ${st.zero.s} of 3`);
    return out;
  }

  return { DAMAGE, DAMAGE_TYPES, damageType, CONDITIONS, CONDITION_NOTES, SLOWED_FEET, SYSTEM_NOTES, cleanStatus, statusOf, isDisabled, isUsed, isLost,
    slowedLevel, speedOf, hullMax, shieldMax, capPoints, rollEffects, rollMode, takeDamage, restore, revive, dying, destructionSave, stabilize,
    setCondition, summary, SIZE_DATA, SHIELD_TYPES, REACTORS, COUPLINGS, SYSTEMS, POOLS, SYSTEM_NAMES, POWER_DIE, sizeOf, roleOf, reactorOf, couplingOf,
    shieldTypeOf, powerDie, powerDieText, powerCaps, diceOf, diceLeft, regenRate, boostDC, regenDC, boostedSpeed, startTurn, usePower, setPower,
    setDiceUsed, boost, regenerateShields, SQUARE_FT, SQUARES, squaresOf, FACING_NAMES, DIRS, gridFeet, turnSteps, turnCost, moveCost, inBounds, shipGap,
    arcOf, INIT_SIZE_MOD, npcInitBonus, REGIONS, HYPER_HOURS, START_UP, hyperClass, stepsFor, jumpHours, jumpFuel, fuelOf, mishapFor, MOD_TYPES, modsSummary, modCost, installDC, pastCapacity, prereqs, REFIT_TIME, UPGRADE_COST, recharge, rechargeHullDie, refitCost, refit, weaponModes, shotCost, heatCap, reloadOf, burstBox, inBox, ARMORS, armorOf, SIZE_ADJ, STANDARD_ARRAY, avgDie, dicePoints, derive, armorDR, afterDR, moveBudget, HELM, SKILL_ABILITY, skillBonus, helm, patchDC, patch, WEAPON_CATS, MOUNTS, sizeRank, catOf, weaponRange, weaponProp, attackBonusOf, saveDcOf, damageExpr, fireCheck };
});
