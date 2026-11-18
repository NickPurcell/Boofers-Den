/* HoloTable starships: the rules of Starships of the Galaxy that change a ship in a fight, as pure functions.
   No page code, no storage, no dice of its own. The server (api/_holotable-ships.js) uses it to apply every ship
   action; the ship sheet (books.js) uses the same code to show a ship's state and what its conditions do to a roll.

   In this file: damage by type against shields and hull (SotG chapter 9, "Damage Types" and "Starship Resistances
   and Immunities"), what dropping to 0 hull points does (destroyed, or disabled with a level of system damage;
   instant destruction; ion damage only disables; the attacker's choice to disable), destruction saving throws,
   stabilizing, damage taken at 0 hull, and the ship conditions of SotG Appendix A with what each does to speed, hull
   and shield maximums, and the ship's ability checks, saving throws and attack rolls (and to attacks against it).

   A ship's fight state lives in ship.status, owned by the server: { cond: [names], slowed: 0-4, system: 0-6,
   zero: { s: successes, f: failures, stable, destroyed } }. Every number here is SotG's own arithmetic; no rule
   text is copied. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HTShips = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const copy = (o) => JSON.parse(JSON.stringify(o));

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
  const damageType = (t) => { const k = String(t || '').trim().toLowerCase().replace(/\s*damage$/, ''); return DAMAGE[k] ? k : 'energy'; };
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
    const out = {
      cond: [...new Set((Array.isArray(st.cond) ? st.cond : []).filter((c) => CONDITIONS.includes(c)))],
      slowed: clamp(int(st.slowed), 0, 4), system: clamp(int(st.system), 0, 6),
      zero: { s: clamp(int(z.s), 0, 3), f: clamp(int(z.f), 0, 99), stable: !!z.stable, destroyed: !!z.destroyed },
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
    const shield = int(s.shield.current);
    if (shield > 0 && mult.shield > 0) {
      const wouldTake = Math.floor(left * mult.shield);
      if (wouldTake <= shield) { shieldLost = wouldTake; left = 0; }
      else { shieldLost = shield; left -= Math.ceil(shield / mult.shield); }
      s.shield.current = shield - shieldLost;
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
    setCondition, summary };
});
