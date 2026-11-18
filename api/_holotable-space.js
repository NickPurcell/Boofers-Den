// HoloTable starships: the space map, on the server. Not a route.
//
// jpesus's call (#146): ship fights happen on their own map, 50 ft a square, with ship tokens at ship scale (SotG's
// grid variant: Tiny and Small 1 square, Medium 2, Large 4, Huge 8, Gargantuan 16). Character-scale maps stay as they
// are. The GM switches the table to the space map and back, as the GM starts combat.
//
// camp.space = { on, n (a fresh id each time the GM switches it on, so every screen turns to it once), cols, rows,
//   tok: [{ id: ship id, x, y, f: facing 0-7, hidden: the GM keeps it off players' maps, named: players may read an enemy
//     ship's name (otherwise "???") }],
//   order: [{ id, init }], turn, round, active, moved: { ship id: feet moved this turn } }
//
// Who may act: the GM on any ship; a player on a party ship (not hidden), as with the ship sheet. A hidden (enemy)
// ship's token is on everyone's map unless the GM hides the token; players get its size, colour and place, its name only
// once the GM names it ("???" until then), never its sheet. Rolls and lines about a hidden ship go to the GM only.
// Helpers from _holotable-game.js are passed in (no circular require).

const SR = require("../sections/jpesus/holotable/starships.js");
const Ships = require("./_holotable-ships.js");
require("../sections/jpesus/holotable/rules.js");
const R = globalThis.SW5E;

const ID = /^[a-z0-9]{6,20}$/;
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const plain = (o) => (o && typeof o === "object" && !Array.isArray(o) ? o : {});

const TYPES = new Set(["space.on", "space.size", "space.place", "space.remove", "space.token", "space.init", "space.next", "space.prev", "space.end"]);
const handles = (type) => TYPES.has(type);

// the space map's state, with its shape checked every time (a backup restore can bring anything back)
function clean(sp, ships) {
  sp = plain(sp);
  const byId = new Map((ships || []).filter((s) => s && typeof s === "object").map((s) => [s.id, s]));
  const cols = clamp(int(sp.cols, 40), 10, 120), rows = clamp(int(sp.rows, 28), 10, 120);
  const seen = new Set();
  const tok = (Array.isArray(sp.tok) ? sp.tok : []).slice(0, 40).filter((t) => t && typeof t === "object" && ID.test(t.id) && byId.has(t.id) && !seen.has(t.id) && seen.add(t.id))
    .map((t) => Object.assign(SR.inBounds(t, SR.squaresOf(byId.get(t.id)), cols, rows), { id: t.id, hidden: !!t.hidden, named: !!t.named }));
  const onMap = new Set(tok.map((t) => t.id)), inOrder = new Set();
  const order = (Array.isArray(sp.order) ? sp.order : []).slice(0, 40).filter((e) => e && typeof e === "object" && onMap.has(e.id) && !inOrder.has(e.id) && inOrder.add(e.id))
    .map((e) => ({ id: e.id, init: clamp(int(e.init), -50, 99) }));
  const moved = {};
  for (const [k, v] of Object.entries(plain(sp.moved))) if (onMap.has(k)) moved[k] = clamp(int(v), 0, 100000);
  return {
    on: !!sp.on, n: ID.test(sp.n || "") ? sp.n : "", cols, rows, tok, order,
    turn: order.length ? clamp(int(sp.turn), 0, order.length - 1) : 0, round: clamp(int(sp.round, 1), 1, 9999), active: !!sp.active && order.length > 0, moved,
  };
}

// What one person is sent: the GM everything; a player the tokens the GM hasn't hidden, each with the ship's name, size
// and colour (a hidden ship's sheet stays the GM's), and the order without ships they can't see.
function view(camp, gm) {
  const sp = clean(camp.space, camp.ships);
  const byId = new Map((camp.ships || []).map((s) => [s.id, s]));
  const tok = sp.tok.filter((t) => gm || !t.hidden).map((t) => { const s = byId.get(t.id);
    return Object.assign({}, t, { name: gm || !s.hidden || t.named ? s.name : "???", size: s.size, color: s.color, enemy: !!s.hidden }); });
  const shown = new Set(tok.map((t) => t.id)), cur = sp.order[sp.turn] && sp.order[sp.turn].id;
  const order = sp.order.filter((e) => shown.has(e.id));
  return Object.assign({}, sp, { tok, order, turn: Math.max(0, order.findIndex((e) => e.id === cur)), turnId: sp.active && shown.has(cur) ? cur : null,
    moved: gm ? sp.moved : Object.fromEntries(Object.entries(sp.moved).filter(([k]) => shown.has(k))) });
}

function apply(camp, cid, gm, type, p, h) {
  const { rollDice, addChat, playerName, applyAction, rid, Forbidden, Invalid } = h;
  const need = (ok, why = "GM only") => { if (!ok) throw new Forbidden(why); };
  camp.ships = camp.ships || [];
  const sp = camp.space = clean(camp.space, camp.ships);
  const shipOf = (id) => { if (typeof id !== "string" || !ID.test(id)) return null; return camp.ships.find((s) => s && s.id === id) || null; };
  const mayMove = (s) => gm || (s && !s.hidden);
  const say = (s, text) => addChat(camp, Object.assign({ system: true, text: str(text, 400) }, s && s.hidden ? { to: ["@gm"], private: true } : {}));
  const curId = () => (sp.active && sp.order[sp.turn] ? sp.order[sp.turn].id : null);

  switch (type) {
    case "space.on": {     // the GM switches the table to the space map, or back
      need(gm);
      sp.on = !!p.on;
      if (sp.on) sp.n = rid();
      addChat(camp, { system: true, text: sp.on ? "The GM switched the table to the space map." : "The GM switched the table back from the space map." });
      return {};
    }
    case "space.size": {
      need(gm);
      sp.cols = clamp(int(p.cols, sp.cols), 10, 120); sp.rows = clamp(int(p.rows, sp.rows), 10, 120);
      camp.space = clean(sp, camp.ships);
      return {};
    }
    case "space.place": {  // put a ship on the map, move it, or turn it (a move in the ship's turn counts its feet)
      const s = shipOf(p.id);
      if (!s) throw new Invalid("No such ship.");
      need(mayMove(s), "That ship is the GM's.");
      const size = SR.squaresOf(s), i = sp.tok.findIndex((t) => t.id === s.id);
      const to = SR.inBounds({ x: p.x, y: p.y, f: p.f }, size, sp.cols, sp.rows);
      if (i < 0) {
        if (sp.tok.length >= 40) throw new Invalid("The space map holds up to 40 ships.");
        sp.tok.push(Object.assign(to, { id: s.id, hidden: !!s.hidden && gm && !!p.hidden, named: false }));
        return {};
      }
      const from = sp.tok[i];
      if (s.id === curId()) sp.moved[s.id] = (sp.moved[s.id] || 0) + SR.moveCost(s, from, to);
      sp.tok[i] = Object.assign({}, from, to);
      return { moved: sp.moved[s.id] || 0 };
    }
    case "space.remove": {
      const s = shipOf(p.id);
      if (!s) throw new Invalid("No such ship.");
      need(mayMove(s), "That ship is the GM's.");
      const cur = curId();
      sp.tok = sp.tok.filter((t) => t.id !== s.id);
      camp.space = clean(Object.assign(sp, { order: sp.order.filter((e) => e.id !== s.id) }), camp.ships);
      const j = camp.space.order.findIndex((e) => e.id === cur);
      if (j >= 0) camp.space.turn = j;
      return {};
    }
    case "space.token": {  // the GM keeps a token off players' maps (an ambush) or shows it, and names an enemy ship or not
      need(gm);
      const t = sp.tok.find((x) => ID.test(String(p.id || "")) && x.id === p.id);
      if (!t) throw new Invalid("That ship isn't on the space map.");
      if (p.hidden !== undefined) t.hidden = !!p.hidden;
      if (p.named !== undefined) t.named = !!p.named;
      return {};
    }
    case "space.init": {   // roll initiative for every ship on the map and start the fight
      need(gm);
      if (!sp.tok.length) throw new Invalid("Put ships on the space map first.");
      const order = [];
      for (const t of sp.tok) {
        const s = shipOf(t.id); if (!s) continue;
        // a party ship goes at the lowest of its crew's initiative rolls; an enemy ship (or one with no crew sheets)
        // rolls a Dexterity check with its size's modifier
        const crew = (s.hidden ? [] : (s.crew || [])).map((c) => (typeof c.charId === "string" && Object.prototype.hasOwnProperty.call(camp.characters || {}, c.charId) ? camp.characters[c.charId] : null)).filter(Boolean);
        let init, label;
        if (crew.length && R) {
          const rolls = crew.map((ch) => ({ ch, r: rollDice("1d20" + (R.initiative(ch) >= 0 ? "+" : "") + R.initiative(ch)) }));
          const low = rolls.reduce((a, b) => (b.r.total < a.r.total ? b : a));
          init = low.r.total;
          label = `${s.name}: initiative (the lowest of its crew: ${rolls.map((x) => `${x.ch.name} ${x.r.total}`).join(", ")})`;
        } else {
          const b = SR.npcInitBonus(s), r = rollDice("1d20" + (b >= 0 ? "+" : "") + b);
          init = r.total; label = `${s.name}: initiative (Dexterity ${b >= 0 ? "+" : ""}${b} with its size)`;
        }
        order.push({ id: s.id, init });
        say(s, `${str(label, 300)}: ${init}.`);
      }
      order.sort((a, b) => b.init - a.init);
      Object.assign(sp, { order, turn: 0, round: 1, active: true, moved: {} });
      camp.space = clean(sp, camp.ships);
      addChat(camp, { system: true, text: "Ship combat starts: round 1." });
      return startTurn(camp, cid, gm, h);
    }
    case "space.next": case "space.prev": {
      const cur = shipOf(curId());
      need(gm || (type === "space.next" && cur && !cur.hidden), "Only the GM, or the crew of the ship whose turn it is.");
      if (!sp.active || !sp.order.length) throw new Invalid("Ship combat hasn't started.");
      if (type === "space.next") { sp.turn += 1; if (sp.turn >= sp.order.length) { sp.turn = 0; sp.round += 1; addChat(camp, { system: true, text: `Ship combat: round ${sp.round}.` }); } }
      else { sp.turn -= 1; if (sp.turn < 0) { sp.turn = sp.order.length - 1; sp.round = Math.max(1, sp.round - 1); } return {}; }
      return startTurn(camp, cid, gm, h);
    }
    case "space.end": {
      need(gm);
      Object.assign(sp, { order: [], turn: 0, round: 1, active: false, moved: {} });
      addChat(camp, { system: true, text: "Ship combat ends." });
      return {};
    }
  }
  return {};
}

// The ship whose turn it now is starts it: power dice, shield regeneration, boosts end, a destruction save at 0 hull
// (Ships' "ship.turn"), and its movement this turn starts at 0.
function startTurn(camp, cid, gm, h) {
  const sp = camp.space, e = sp.order[sp.turn];
  if (!e) return {};
  sp.moved[e.id] = 0;
  const s = camp.ships.find((x) => x && x.id === e.id);
  if (!s) return {};
  return Ships.apply(camp, cid, true, "ship.turn", { id: s.id, regen: true }, h);   // the turn belongs to the table, not to whoever pressed Next
}

module.exports = { handles, apply, clean, view };
