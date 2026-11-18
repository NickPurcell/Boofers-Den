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

const TYPES = new Set(["space.on", "space.size", "space.place", "space.remove", "space.token", "space.init", "space.next", "space.prev", "space.end", "space.fire", "space.ram", "space.interfere"]);
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
  // the name players may read: a party ship's own; an enemy ship's once the GM names its token, "???" until then
  const shownOf = (s, t) => (!s.hidden || (t && t.named) ? s.name : "???");
  const putShip = (x) => { const i = camp.ships.findIndex((y) => y && y.id === x.id); if (i >= 0) { x.updated = Date.now() / 1000; camp.ships[i] = x; } };

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
      // in ship combat a player moves their ship on its own turn
      if (!Ships.onTurn(camp, gm, s)) throw new Invalid(`Not ${shownOf(s, from)}'s turn.`);
      if (s.id === curId()) {
        let cost = SR.moveCost(s, from, to);
        const st = SR.statusOf(s), steps = SR.turnSteps(from.f, to.f);
        if (st.fx.hardTurn && steps > 0 && steps <= 2) {   // Hard Turn: this turn of up to 90 degrees costs nothing
          cost -= SR.turnCost(s, from.f, to.f);
          st.fx.hardTurn = false; putShip(Object.assign({}, s, { status: st }));
        }
        sp.moved[s.id] = (sp.moved[s.id] || 0) + cost;
      }
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
    case "space.fire": {   // the Fire action: a ship weapon at a ship on the map, its arc and range checked, rolled here
      const s0 = shipOf(p.id), t0 = shipOf(p.target);
      if (!s0 || !t0) throw new Invalid("No such ship.");
      need(mayMove(s0), "That ship is the GM's.");
      if (s0.id === t0.id) throw new Invalid("A ship can't fire at itself.");
      const a = sp.tok.find((x) => x.id === s0.id), ta = sp.tok.find((x) => x.id === t0.id);
      if (!a || !ta || (!gm && ta.hidden)) throw new Invalid("Both ships need to be on the space map.");
      if (!Ships.onTurn(camp, gm, s0)) throw new Invalid(`Not ${shownOf(s0, a)}'s turn.`);
      if (SR.isDisabled(SR.statusOf(s0)) || SR.isLost(SR.statusOf(s0))) throw new Invalid(`${shownOf(s0, a)} can't take actions.`);
      const weapons = Array.isArray(s0.weapons) ? s0.weapons : [], wi = int(p.weapon, -1);
      if (!(wi >= 0 && wi < weapons.length)) throw new Invalid("No such weapon.");
      const w = weapons[wi], chk = SR.fireCheck(s0, a, w, t0, ta);
      if (!chk.ok) throw new Invalid(`${w.name} can't fire: ${chk.why}.`);
      // the firing mode (single, rapid, burst) and what it costs in heat or ammunition
      const modes = SR.weaponModes(w), fm = modes.includes(p.fireMode) ? p.fireMode : modes[0], cost = SR.shotCost(w, fm), cap = SR.heatCap(w);
      if (typeof w.ammo === "number" && w.ammo < cost) throw new Invalid(w.ammo <= 0 ? `${w.name} is out of ammunition.` : `${w.name} has ${w.ammo} shots left; ${fm} takes ${cost}.`);
      if (cap !== null && int(w.heat) + cost > cap) throw new Invalid(`${w.name} is too hot (${int(w.heat)} of ${cap}): cool it first (an action).`);
      const s = JSON.parse(JSON.stringify(s0)), sw = s.weapons[wi];
      if (typeof sw.ammo === "number") sw.ammo -= cost;
      if (cap !== null) sw.heat = int(sw.heat) + cost;
      const pb = Ships.crewPb(camp, s0, p.crew), A = shownOf(s0, a), T = shownOf(t0, ta);
      // jpesus (#65, 17 Nov): while a GM ship's token is off the players' map, its lines go to the GM only; a hit
      // still shows its damage on the party's own ship sheet. Here: every line and roll of this shot, including the
      // party ship's save and its damage lines, when either token is hidden.
      const secret = !!a.hidden || !!ta.hidden;
      // A roll in the chat. One about an enemy ship (the GM's) goes to the GM only, and carries no sender id: a message's
      // sender always receives it, and the player who fired must not read the enemy's name. The result lines below are
      // everyone's, with the names players may read.
      const roll2 = (roll, expr, label, kind, gmOnly0) => { const gmOnly = gmOnly0 || secret; return addChat(camp, Object.assign({ from: gmOnly ? "Ship combat (GM only)" : playerName(camp, cid),
        roll: Object.assign({}, roll, { expr, label: str(label, 120), kind }) }, gmOnly ? { to: ["@gm"], private: true } : { fromId: cid })); };
      const rollMsg = (roll, expr, label, kind) => roll2(roll, expr, label, kind, !!s0.hidden);
      const line = (text, gmOnly) => addChat(camp, Object.assign({ system: true, text: str(text, 400) }, gmOnly || secret ? { to: ["@gm"], private: true } : {}));
      const d20 = (mode, bonus) => (mode === "adv" ? "2d20kh1" : mode === "dis" ? "2d20kl1" : "1d20") + (bonus >= 0 ? "+" : "") + bonus;
      const why = (x) => (x.length ? ` [${x.join(", ")}]` : "");
      // the damage roll: advantage after Boost Weapons (two rolls, the higher kept), which it then uses up; crit (or a
      // rapid volley) rolls the dice twice
      const rollDamage = (crit, tag) => {
        const expr = SR.damageExpr(s0, w, crit);
        if (!expr) return { total: 0, expr: "" };
        let r = rollDice(expr);
        if (s.status && s.status.boost && s.status.boost.weapons) { const r2 = rollDice(expr); if (r2.total > r.total) r = r2; s.status.boost.weapons = false; }
        rollMsg(r, expr, `${s0.hidden ? s0.name : A}: ${w.name} damage${tag ? ` (${tag})` : crit ? " (critical)" : ""}`, "damage");
        return { total: Math.max(0, r.total), expr };
      };
      const hurtShip = (ship, amount, crit, tok) => {
        const r = SR.takeDamage(shipOf(ship.id), amount, w.type, { crit });
        putShip(r.ship);
        for (const l of r.log) line(l, !!ship.hidden || !!(tok && tok.hidden));   // its hull and shields: the GM's for an enemy ship or a hidden token
        return r;
      };
      const hurt = (amount, crit) => hurtShip(t0, amount, crit);
      // a ship's Dexterity save against this weapon: its own bonus, its conditions, and what the shot gives it
      const dexSave = (ship, tok, dc, adv, dis) => {
        const fx = SR.rollEffects(ship, "save", "dex"), name = shownOf(ship, tok), unseen = !!(tok && tok.hidden);
        if (fx.fail.length) { line(`${name} fails it automatically (${fx.fail.join(", ")}).`, unseen); return false; }
        const mode = SR.rollMode({ adv: [...adv, ...fx.adv], dis: [...dis, ...fx.dis] }, "normal");
        const bonus = Math.floor((int((ship.abilities || {}).dex, 10) - 10) / 2) + ((ship.saves || {}).dex ? Ships.crewPb(camp, ship, 0) : 0);
        const se = d20(mode, bonus), sr = rollDice(se);
        roll2(sr, se, `${ship.hidden ? ship.name : name}: Dexterity save (DC ${dc})`, "save", !!ship.hidden || unseen);
        return sr.total >= dc;
      };
      s.status = SR.statusOf(s);
      let result;
      if (fm === "rapid" || fm === "burst") {
        // rapid: the target saves or takes the damage plus its dice again; burst: every ship in a 150-ft cube on the
        // target saves or takes the damage; nothing on a success. Where the attack roll would have had disadvantage, the
        // ships save with advantage.
        const dc = 8 + SR.attackBonusOf(s0, w, pb), atk = SR.rollMode({ adv: chk.adv, dis: chk.dis }, "normal");
        const box = SR.burstBox(ta, SR.squaresOf(t0));
        const hit = fm === "rapid" ? [[t0, ta]] : sp.tok.filter((x) => x.id !== s0.id && shipOf(x.id) && SR.inBox(box, x, SR.squaresOf(shipOf(x.id)))).map((x) => [shipOf(x.id), x]);
        line(`${A} fires ${w.name} in ${fm} mode at ${T}: ${fm === "burst" ? "every ship in a 150-ft cube makes" : "a"} Dexterity save, DC ${dc}${atk === "dis" ? " (with advantage: the shot would have had disadvantage)" : ""}.`);
        const dmg = rollDamage(fm === "rapid", fm);
        result = { mode: fm, ships: [] };
        for (const [ship, tok] of hit) {
          const saved = dexSave(ship, tok, dc, atk === "dis" ? ["a shot at disadvantage"] : [], []);
          // a ship in the cube whose token is off the players' map: its save and its lines are the GM's (jpesus, #65)
          line(`${shownOf(ship, tok)} ${saved ? "saves: no damage" : `fails: ${dmg.total} ${SR.damageType(w.type)} damage`}.`, !!tok.hidden);
          if (!saved && dmg.total) hurtShip(ship, dmg.total, false, tok);
          result.ships.push({ saved, damage: saved ? 0 : dmg.total });
        }
      } else if (chk.kind === "attack") {
        const mode = SR.rollMode({ adv: chk.adv, dis: chk.dis }, ["adv", "dis"].includes(p.mode) ? p.mode : "normal");
        const bonus = SR.attackBonusOf(s0, w, pb), expr = d20(mode, bonus), roll = rollDice(expr);
        const keen = typeof SR.weaponProp(w, "keen") === "number" ? SR.weaponProp(w, "keen") : 0;
        const crit = roll.nat !== null && roll.nat >= 20 - keen, hit = roll.nat !== 1 && (crit || roll.total >= int(t0.ac, 10));
        rollMsg(roll, expr, `${s0.hidden ? s0.name : A} fires ${w.name} at ${s0.hidden ? t0.name : T}${why([...chk.adv, ...chk.dis])}`, "attack");
        if (!hit) { line(`${A} misses ${T} with ${w.name}.`); result = { hit: false }; }
        else {
          const dmg = rollDamage(crit), dealt = SR.afterDR(t0, dmg.total), dr = dmg.total - dealt;   // armor's damage reduction counts against attack rolls
          line(`${A} hits ${T} with ${w.name}${crit ? ", a critical" : ""}: ${dealt} ${SR.damageType(w.type)} damage${dr > 0 ? ` (${dr} stopped by its armor)` : ""}.`);
          hurt(dealt, crit);
          result = { hit: true, crit, damage: dealt };
          // ionizing: a DC 13 Constitution save or ionized; a larger target has advantage
          if (SR.weaponProp(w, "ionizing") && !SR.isLost(SR.statusOf(shipOf(t0.id)))) {
            const t1 = shipOf(t0.id), cb = Math.floor((int((t1.abilities || {}).con, 10) - 10) / 2) + ((t1.saves || {}).con ? Ships.crewPb(camp, t1, 0) : 0);
            const sm = SR.rollMode({ adv: SR.sizeRank(t1) > SR.sizeRank(s0) ? ["larger"] : [], dis: SR.rollEffects(t1, "save", "con").dis }, "normal");
            const se = d20(sm, cb), sr = rollDice(se);
            roll2(sr, se, `${t1.hidden ? t1.name : T}: Constitution save against ionizing (DC 13)`, "save", !!t1.hidden);
            if (sr.total < 13) { putShip(SR.setCondition(t1, "Ionized", true)); line(`${T} is ionized.`); result.ionized = true; }
            else line(`${T} shrugs off the ionizing hit.`);
          }
        }
      } else {
        // tertiary weapons, and a Huge or larger ship's primary weapons: the target's Dexterity save against the
        // weapon's DC; half damage on a success
        const dc = SR.saveDcOf(s0, w, pb);
        line(`${A} fires ${w.name} at ${T}: a Dexterity save, DC ${dc}${why([...chk.adv, ...chk.dis])}.`);
        const saved = dexSave(t0, ta, dc, chk.adv, chk.dis);
        const dmg = rollDamage(false), amount = saved ? Math.floor(dmg.total / 2) : dmg.total;
        line(`${T} ${saved ? "saves: half damage" : "fails"}: ${amount} ${SR.damageType(w.type)} damage.`);
        if (amount) hurt(amount, false);
        result = { saved, damage: amount };
      }
      const after = SR.statusOf(shipOf(s0.id));
      if (chk.kind === "attack" && fm === "single") Object.assign(after.fx, { directed: false, interfered: false });   // each lasts one attack roll
      putShip(Object.assign(shipOf(s0.id), { weapons: s.weapons, status: Object.assign(after, { boost: s.status.boost }) }));
      return result;
    }
    case "space.ram": case "space.interfere": {
      // Ram (a Helm action): within 50 ft, Strength (Ram) against the target's Dexterity (Maneuvering); on a success both
      // take kinetic damage of two of the rammer's hull dice + its Strength, the rammer half while its shields hold.
      // Interfere: within 1,000 ft, Charisma (Interfere) against the target's Wisdom (Scan); on a success the target's
      // next check or attack roll has disadvantage.
      const ram = type === "space.ram";
      const s0 = shipOf(p.id), t0 = shipOf(p.target);
      if (!s0 || !t0) throw new Invalid("No such ship.");
      need(mayMove(s0), "That ship is the GM's.");
      if (s0.id === t0.id) throw new Invalid(ram ? "A ship can't ram itself." : "A ship can't interfere with itself.");
      const a = sp.tok.find((x) => x.id === s0.id), ta = sp.tok.find((x) => x.id === t0.id);
      if (!a || !ta || (!gm && ta.hidden)) throw new Invalid("Both ships need to be on the space map.");
      if (!Ships.onTurn(camp, gm, s0)) throw new Invalid(`Not ${shownOf(s0, a)}'s turn.`);
      const st0 = SR.statusOf(s0);
      if (SR.isDisabled(st0) || SR.isLost(st0)) throw new Invalid(`${shownOf(s0, a)} can't take actions.`);
      if (ram && st0.fx.helm) throw new Invalid(`${shownOf(s0, a)} has already taken a Helm action this turn.`);
      const feet = SR.shipGap(a, SR.squaresOf(s0), ta, SR.squaresOf(t0));
      if (ram && feet > 50) throw new Invalid(`${feet} ft away: ramming takes flying into it (within 50 ft).`);
      if (!ram && feet > 1000) throw new Invalid(`${feet} ft away: Interfere reaches 1,000 ft.`);
      const A = shownOf(s0, a), T = shownOf(t0, ta);
      const secret = !!a.hidden || !!ta.hidden;   // a token off the players' map: every line and roll is the GM's (jpesus, #65)
      const [mySkill, theirSkill] = ram ? ["ram", "maneuvering"] : ["interfere", "scan"];
      const check = (ship, skill, crew, hidden, label) => {
        const ab = SR.SKILL_ABILITY[skill], fx = SR.rollEffects(ship, "check", ab), mode = SR.rollMode(fx, "normal");
        const bonus = SR.skillBonus(ship, skill, Ships.crewPb(camp, ship, crew));
        const expr = (mode === "adv" ? "2d20kh1" : mode === "dis" ? "2d20kl1" : "1d20") + (bonus >= 0 ? "+" : "") + bonus, r = rollDice(expr);
        addChat(camp, Object.assign({ from: hidden || secret ? "Ship combat (GM only)" : playerName(camp, cid), roll: Object.assign({}, r, { expr, label: str(label, 120), kind: "check" }) },
          hidden || secret ? { to: ["@gm"], private: true } : { fromId: cid }));
        return r.total;
      };
      const mine = check(s0, mySkill, p.crew, !!s0.hidden, `${s0.hidden ? s0.name : A}: ${ram ? "Strength (Ram)" : "Charisma (Interfere)"} against ${s0.hidden ? t0.name : T}`);
      const theirs = check(t0, theirSkill, 0, !!t0.hidden, `${t0.hidden ? t0.name : T}: ${ram ? "Dexterity (Maneuvering)" : "Wisdom (Scan)"}`);
      const won = mine > theirs;
      const s1 = JSON.parse(JSON.stringify(shipOf(s0.id))); s1.status = SR.statusOf(s1);
      s1.status.fx.interfered = false;   // its own check used up an Interfere on it
      if (ram) s1.status.fx.helm = true;
      putShip(s1);
      const line = (text, gmOnly) => addChat(camp, Object.assign({ system: true, text: str(text, 400) }, gmOnly || secret ? { to: ["@gm"], private: true } : {}));
      if (!won) { line(`${A} ${ram ? "tries to ram" : "tries to interfere with"} ${T}, and fails (${mine} against ${theirs}).`); return { ok: false }; }
      if (!ram) {
        const t1 = JSON.parse(JSON.stringify(shipOf(t0.id))); t1.status = SR.statusOf(t1);
        Object.assign(t1.status.fx, { interfered: true, interferedBy: s0.id }); putShip(t1);   // until its next roll, or the start of our next turn
        line(`${A} interferes with ${T}: its next check or attack roll has disadvantage.`);
        return { ok: true };
      }
      const hd = SR.diceOf(s0, "hull").die, sm = Math.floor((int((s0.abilities || {}).str, 10) - 10) / 2), expr = `2d${hd}` + (sm ? (sm > 0 ? "+" : "") + sm : "");
      const dr = rollDice(expr), dmg = Math.max(0, dr.total), mineDmg = int((shipOf(s0.id).shield || {}).current) > 0 ? Math.floor(dmg / 2) : dmg;
      line(`${A} rams ${T}: ${dmg} kinetic damage to it, ${mineDmg} to itself.`);
      for (const [id, n] of [[t0.id, dmg], [s0.id, mineDmg]]) {
        const x = shipOf(id), r = SR.takeDamage(x, n, "kinetic", {});
        putShip(r.ship);
        for (const l of r.log) line(l, !!x.hidden);
      }
      return { ok: true, damage: dmg };
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
  // an Interfere by this ship lasts until the start of its next turn
  for (let k = 0; k < camp.ships.length; k++) {
    const x = camp.ships[k], st = x && SR.statusOf(x);
    if (st && st.fx.interfered && st.fx.interferedBy === e.id) { Object.assign(st.fx, { interfered: false, interferedBy: "" }); camp.ships[k] = Object.assign({}, x, { status: st }); }
  }
  const s = camp.ships.find((x) => x && x.id === e.id);
  if (!s) return {};
  Ships.apply(camp, cid, true, "ship.turn", { id: s.id, regen: true }, h);   // the turn belongs to the table, not to whoever pressed Next
  return {};   // nothing of the next ship's turn (an enemy's save) goes back to whoever pressed Next
}

module.exports = { handles, apply, clean, view };
