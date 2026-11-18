// HoloTable starships: the ship actions that change a ship in a fight, on the server. Not a route.
//
// The rules are in sections/jpesus/holotable/starships.js (pure, shared with the ship sheet). This file finds the
// ship, checks who may act, rolls the dice, lets the rules decide, writes the ship back and says what happened in
// the chat. A ship's fight state (ship.status: conditions, slowed and system damage levels, destruction saves) is
// the server's: a sheet save keeps what is stored (see keepStatus), so a stale copy in someone's browser can't undo
// a hit or a failed save.
//
// Who may act: anyone at the table on a party ship, as with the rest of its sheet; only the GM on a hidden ship,
// whose lines in the chat only the GM sees.
// Helpers from _holotable-game.js are passed in (no circular require).

const SR = require("../sections/jpesus/holotable/starships.js");
require("../sections/jpesus/holotable/rules.js");   // the sheet's rules (proficiency bonus by level), as globalThis.SW5E
const R = globalThis.SW5E;

const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// A ship's Strength (Boost) bonus, worked out here from the ship sheet: the ship's Strength modifier, plus the
// proficiency bonus of the crew member making the check (their character's, else the number on the crew row) times the
// ship's Boost equipment (0, 1 proficiently, 2 expertly). The request only says which crew row is rolling.
// The proficiency bonus of a crew row, worked out from the stored sheets: the crew member's character's, else the number
// on the row, else 2. A row number from a request picks a row; anything else reads as the first.
function crewPb(camp, ship, crewIndex) {
  const crew = Array.isArray(ship.crew) ? ship.crew : [], c = crew[clamp(int(crewIndex), 0, Math.max(0, crew.length - 1))];
  const chars = camp.characters || {};
  const ch = c && typeof c.charId === "string" && Object.prototype.hasOwnProperty.call(chars, c.charId) ? chars[c.charId] : null;
  return ch && R ? R.profBonus(ch) : (c && int(c.pb)) || 2;
}
function boostBonus(camp, ship, crewIndex) {
  const str = Math.floor((int((ship.abilities || {}).str, 10) - 10) / 2), lv = clamp(int((ship.skills || {}).boost), 0, 2);
  return str + lv * crewPb(camp, ship, crewIndex);
}

// During ship combat on the space map, a player's ship takes its actions on its own turn (SotG ch. 9: one Helm action
// a turn; Boost once a turn; Patch, Interfere and Direct on the ship's turn). The GM stays free, to run enemies and fix
// things. Outside ship combat (the sheet between fights) nothing is turn-bound.
const TURN_ACTIONS = new Set(["ship.helm", "ship.direct", "ship.patch", "ship.boost", "ship.regen"]);
function onTurn(camp, gm, ship) {
  const sp = camp.space;
  if (gm || !sp || !sp.active || !Array.isArray(sp.order)) return true;
  const e = sp.order[int(sp.turn)];
  return !!e && e.id === ship.id;
}

const TYPES = new Set(["ship.damage", "ship.restore", "ship.points", "ship.dsave", "ship.stabilize", "ship.condition", "ship.reset",
  "ship.turn", "ship.power", "ship.poweruse", "ship.dice", "ship.boost", "ship.regen", "ship.helm", "ship.patch", "ship.direct"]);
const handles = (type) => TYPES.has(type);

// On a sheet save: the fight state and the current hull and shield points stay as stored (they change only through
// the actions below, so a stale copy of the sheet in someone's browser can't undo a hit), and points stay inside the
// (possibly halved) maximums. A new ship takes the points it is made with.
function keepStatus(clean, old) {
  clean.status = SR.cleanStatus(old ? old.status : null);
  if (old) {
    clean.hull.current = Math.max(0, int((old.hull || {}).current));
    clean.shield.current = Math.max(0, int((old.shield || {}).current));
  }
  return SR.capPoints(clean);
}

function apply(camp, cid, gm, type, p, h) {
  const { rollDice, addChat, playerName, Forbidden, Invalid } = h;
  camp.ships = camp.ships || [];
  const i = camp.ships.findIndex((x) => x && x.id === p.id);
  if (i < 0) throw new Invalid("No such ship.");
  const ship = camp.ships[i];
  if (!(gm || !ship.hidden)) throw new Forbidden("That ship is the GM's.");
  if (TURN_ACTIONS.has(type) && !onTurn(camp, gm, ship)) throw new Invalid(`Not ${ship.name}'s turn.`);
  const say = (lines) => {
    for (const text of lines.filter(Boolean)) {
      const msg = { system: true, text: str(text, 400) };
      if (ship.hidden) Object.assign(msg, { to: ["@gm"], private: true });
      addChat(camp, msg);
    }
  };
  const put = (s) => { s.updated = Date.now() / 1000; camp.ships[i] = s; return s; };

  switch (type) {
    case "ship.damage": {   // damage of one type: shields first at their share, the rest to the hull, then the 0-hull rules
      const amount = clamp(int(p.amount), 0, 100000);
      if (!amount) return {};
      const r = SR.takeDamage(ship, amount, str(p.type, 30), { crit: !!p.crit, disable: !!p.disable });
      put(r.ship); say(r.log);
      return { outcome: r.outcome, shieldLost: r.shieldLost, hullLost: r.hullLost };
    }
    case "ship.restore": {  // repairs (hull) or restored shields, up to the maximum
      const r = SR.restore(ship, p.what === "shield" ? "shield" : "hull", clamp(int(p.amount), 0, 100000));
      put(r.ship);
      if (r.gained) say([`${ship.name} ${p.what === "shield" ? "restores" : "repairs"} ${r.gained} ${p.what === "shield" ? "shield" : "hull"} point${r.gained === 1 ? "" : "s"}.`]);
      return { gained: r.gained };
    }
    case "ship.points": {   // current hull or shield points typed on the sheet: up to the maximum; hull up from 0 brings it back
      const key = p.what === "shield" ? "shield" : "hull";
      if (SR.isLost(SR.statusOf(ship))) throw new Invalid(`${ship.name} is lost; the GM can undo that.`);
      const s = SR.capPoints(JSON.parse(JSON.stringify(ship))), was = int(s[key].current);
      s[key].current = clamp(int(p.current), 0, 100000);
      SR.capPoints(s);
      if (key === "hull") SR.revive(s, was);
      put(s);
      return {};
    }
    case "ship.dsave": {    // a destruction saving throw, rolled here
      if (!SR.dying(ship)) throw new Invalid(`${ship.name} doesn't need a destruction save (it needs 0 hull points and not to be stable).`);
      const roll = rollDice("1d20");
      const r = SR.destructionSave(ship, roll.nat);
      put(r.ship);
      // a hidden ship's roll is the GM's alone, with no sender id (a message's sender always receives it, and a player's
      // Next on the space map can start a hidden ship's turn)
      const msg = { from: ship.hidden ? "Ship combat (GM only)" : playerName(camp, cid), roll: Object.assign({}, roll, { expr: "1d20", label: str(`${ship.name}: destruction save`, 120), kind: "dsave" }) };
      Object.assign(msg, ship.hidden ? { to: ["@gm"], private: true } : { fromId: cid });
      addChat(camp, msg);
      say(r.log);
      return { result: r.result, d20: roll.nat };
    }
    case "ship.stabilize": {   // after a crew member's DC 10 Intelligence (mechanic's kit) check succeeds
      const r = SR.stabilize(ship);
      if (!r.done) return {};
      put(r.ship); say([`${playerName(camp, cid)} stabilizes ${ship.name}.`]);
      return {};
    }
    case "ship.condition": {   // a condition on or off, or a level of slowed (0-4) or system damage (0-6)
      const name = str(p.name, 30);
      if (!(SR.CONDITIONS.includes(name) || name === "slowed" || name === "system")) throw new Invalid("No such ship condition.");
      const before = SR.statusOf(ship);
      const s = put(SR.setCondition(ship, name, name === "slowed" || name === "system" ? clamp(int(p.level), 0, 6) : !!p.on));
      const after = SR.statusOf(s);
      if (name === "system" && after.system !== before.system) say([`${ship.name}: system damage ${after.system}${after.system ? " (" + SR.SYSTEM_NOTES[after.system].toLowerCase() + ")" : ""}.`]);
      else if (name === "slowed" && after.slowed !== before.slowed) say([`${ship.name}: slowed ${after.slowed}.`]);
      else if (before.cond.includes(name) !== after.cond.includes(name)) say([`${ship.name} is ${after.cond.includes(name) ? "now" : "no longer"} ${name.toLowerCase()}.`]);
      return {};
    }
    case "ship.turn": {     // the start of the ship's turn: power dice back, shields regenerate, boosts end, a destruction save at 0 hull
      const dying = SR.dying(ship);
      const r = SR.startTurn(ship, (e) => rollDice(e), { regen: p.regen !== false });
      put(r.ship); say([`${ship.name}'s turn starts.`, ...r.log]);
      if (dying) return apply(camp, cid, gm, "ship.dsave", { id: ship.id }, h);
      return {};
    }
    case "ship.power": {    // the sheet's + and - on a power store
      const pool = str(p.pool, 20);
      if (!SR.POOLS.includes(pool)) throw new Invalid("No such power store.");
      put(SR.setPower(ship, pool, int(p.n)));
      return {};
    }
    case "ship.poweruse": { // spend a power die from a store, rolled here
      const pool = str(p.pool, 20);
      if (!SR.POOLS.includes(pool)) throw new Invalid("No such power store.");
      const r = SR.usePower(ship, pool, (e) => rollDice(e));
      if (r.value === null) throw new Invalid(`No power dice in ${SR.SYSTEM_NAMES[pool].toLowerCase()}.`);
      put(r.ship);
      say([`${playerName(camp, cid)} spends a ${SR.SYSTEM_NAMES[pool].toLowerCase()} power die on ${ship.name}: ${r.value}.`]);
      return { value: r.value };
    }
    case "ship.dice": {     // shield or hull dice spent, set on the sheet
      put(SR.setDiceUsed(ship, p.kind === "hull" ? "hull" : "shield", int(p.used)));
      return {};
    }
    case "ship.boost": case "ship.regen": {   // Boost Engines / Shields / Weapons, or Regenerate Shields: a Strength (Boost) check rolled here
      const what = type === "ship.regen" ? "regen" : str(p.what, 10);
      if (what !== "regen" && !["engines", "shields", "weapons"].includes(what)) throw new Invalid("Boost engines, shields or weapons.");
      if (SR.isDisabled(SR.statusOf(ship)) || SR.isLost(SR.statusOf(ship))) throw new Invalid(`${ship.name} can't take actions.`);
      // the Boost bonus comes from the ship sheet, worked out here; the ship's conditions set the mode
      const bonus = boostBonus(camp, ship, p.crew), fx = SR.rollEffects(ship, "check", "str"), mode = SR.rollMode(fx, ["adv", "dis"].includes(p.mode) ? p.mode : "normal");
      const expr = (mode === "adv" ? "2d20kh1" : mode === "dis" ? "2d20kl1" : "1d20") + (bonus >= 0 ? "+" : "") + bonus;
      const roll = rollDice(expr);
      const label = what === "regen" ? `${ship.name}: Regenerate Shields (DC ${SR.regenDC(ship)})` : `${ship.name}: Boost ${what} (DC ${SR.boostDC(ship)})`;
      const r = what === "regen" ? SR.regenerateShields(ship, roll.total, (e) => rollDice(e)) : SR.boost(ship, what, roll.total, (e) => rollDice(e));
      if (r.already || r.done === false) throw new Invalid(r.log[0] || "Not now.");
      r.ship.status.fx.interfered = false;   // Interfere lasts one roll
      const msg = { from: ship.hidden ? "Ship combat (GM only)" : playerName(camp, cid), roll: Object.assign({}, roll, { expr, label: str(label + ([...fx.adv, ...fx.dis].length ? ` [${[...fx.adv, ...fx.dis].join(", ")}]` : ""), 120), kind: "boost" }) };
      Object.assign(msg, ship.hidden ? { to: ["@gm"], private: true } : { fromId: cid });
      put(r.ship); addChat(camp, msg); say(r.log);
      return { ok: !!r.ok, total: roll.total };
    }
    case "ship.helm": {     // Evade, Fly or Hard Turn: one Helm action a turn
      const what = str(p.what, 10);
      if (!["evade", "fly", "hardturn"].includes(what)) throw new Invalid("Evade, Fly or Hard Turn.");
      if (SR.isDisabled(SR.statusOf(ship)) || SR.isLost(SR.statusOf(ship))) throw new Invalid(`${ship.name} can't take actions.`);
      const r = SR.helm(ship, what);
      if (!r.ok) throw new Invalid(r.log[0] || "Not now.");
      put(r.ship); say(r.log);
      return {};
    }
    case "ship.patch": {    // Patch: a Constitution (Patch) check rolled here, with the bonus from the sheet, spending a hull die
      if (SR.isDisabled(SR.statusOf(ship)) || SR.isLost(SR.statusOf(ship))) throw new Invalid(`${ship.name} can't take actions.`);
      if (SR.diceLeft(ship, "hull") <= 0) throw new Invalid(`${ship.name} has no hull dice left.`);
      if (int((ship.hull || {}).current) >= SR.hullMax(ship)) throw new Invalid(`${ship.name}'s hull needs no patching.`);
      const bonus = SR.skillBonus(ship, "patch", crewPb(camp, ship, p.crew)), fx = SR.rollEffects(ship, "check", "con");
      const mode = SR.rollMode(fx, ["adv", "dis"].includes(p.mode) ? p.mode : "normal");
      const expr = (mode === "adv" ? "2d20kh1" : mode === "dis" ? "2d20kl1" : "1d20") + (bonus >= 0 ? "+" : "") + bonus, roll = rollDice(expr);
      const r = SR.patch(ship, roll.total, (e) => rollDice(e));
      const msg = { from: ship.hidden ? "Ship combat (GM only)" : playerName(camp, cid), roll: Object.assign({}, roll, { expr, label: str(`${ship.name}: Patch (DC ${r.dc})${[...fx.adv, ...fx.dis].length ? ` [${[...fx.adv, ...fx.dis].join(", ")}]` : ""}`, 120), kind: "patch" }) };
      Object.assign(msg, ship.hidden ? { to: ["@gm"], private: true } : { fromId: cid });
      r.ship.status.fx.interfered = false;   // Interfere lasts one roll
      put(r.ship); addChat(camp, msg); say(r.log);
      return { ok: !!r.ok, gain: r.gain };
    }
    case "ship.direct": {   // Direct: the next attack roll from this ship has advantage
      if (SR.isDisabled(SR.statusOf(ship)) || SR.isLost(SR.statusOf(ship))) throw new Invalid(`${ship.name} can't take actions.`);
      const s = JSON.parse(JSON.stringify(ship)); s.status = SR.statusOf(s); s.status.fx.directed = true;
      put(s); say([`${playerName(camp, cid)} directs ${ship.name}'s gunners: its next attack has advantage.`]);
      return {};
    }
    case "ship.reset": {    // the GM undoes a destruction (a mistake, or a story reason): saves cleared, not destroyed
      if (!gm) throw new Forbidden("GM only");
      const s = JSON.parse(JSON.stringify(ship));
      s.status = SR.cleanStatus(s.status);
      s.status.zero = { s: 0, f: 0, stable: false, destroyed: false };
      if (p.system !== undefined) s.status.system = clamp(int(p.system), 0, 6);
      put(SR.capPoints(s));
      return {};
    }
  }
  return {};
}

// the ship sheet fields this subsystem owns, cleaned for cleanShip: its fight state, and the reactor, power coupling and
// shields the crew picked ("" means: from its equipment or role)
const pick = (v, table) => (Object.prototype.hasOwnProperty.call(table, v) ? v : "");
const cleanFields = (sh) => ({ status: SR.cleanStatus(sh.status), reactor: pick(sh.reactor, SR.REACTORS), coupling: pick(sh.coupling, SR.COUPLINGS), shieldType: pick(sh.shieldType, SR.SHIELD_TYPES) });
// a weapon row's fields this subsystem owns: its category (primary to quaternary), its mount (a fixed arc, or a turret;
// "" means not set, and fires in any arc), and its ammunition ("" means not counted)
const cleanWeapon = (w) => ({ cat: SR.WEAPON_CATS.includes(w.cat) ? w.cat : "", arc: SR.MOUNTS.includes(w.arc) ? w.arc : "",
  ammo: w.ammo === "" || w.ammo === null || w.ammo === undefined || !Number.isFinite(parseInt(w.ammo, 10)) ? "" : clamp(int(w.ammo), 0, 999) });

module.exports = { handles, apply, onTurn, keepStatus, cleanStatus: SR.cleanStatus, cleanFields, cleanWeapon, boostBonus, crewPb };
