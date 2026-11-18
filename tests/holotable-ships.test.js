// Tests for HoloTable's starship rules (sections/jpesus/holotable/starships.js) and the ship actions on the server
// (api/_holotable-ships.js), against an in-memory Redis. Every ship and person here is invented.
// Run: node --test tests/holotable-ships.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const SR = require("../sections/jpesus/holotable/starships.js");

// ---------------------------------------------------------------- the rules, with no table
const ship = (o = {}) => Object.assign({ name: "Dawn Skiff", hull: { current: 30, max: 40 }, shield: { current: 3, max: 20 }, speed: 300 }, o);

test("ship damage by type: shields first at their share, the hull at its share (SotG damage types)", () => {
  let r = SR.takeDamage(ship(), 10, "fire");   // shields take half of fire: 3 shield points stop 6 of it, 4 reach the hull
  assert.deepEqual([r.ship.shield.current, r.ship.hull.current, r.shieldLost, r.hullLost], [0, 26, 3, 4]);
  r = SR.takeDamage(ship({ shield: { current: 0, max: 20 } }), 9, "ion");   // the hull takes half of ion
  assert.equal(r.ship.hull.current, 26);
  r = SR.takeDamage(ship({ shield: { current: 0, max: 20 } }), 9, "lightning");
  assert.equal(r.ship.hull.current, 26, "and half of lightning");
  r = SR.takeDamage(ship(), 10, "necrotic");   // half to both: 3 shield points stop 6, 4 left, half of that to the hull
  assert.deepEqual([r.ship.shield.current, r.ship.hull.current], [0, 28]);
  for (const t of ["poison", "psychic", "sonic"]) {
    r = SR.takeDamage(ship(), 25, t);
    assert.deepEqual([r.ship.shield.current, r.ship.hull.current], [3, 30], `${t} does nothing to a ship in space`);
  }
  r = SR.takeDamage(ship({ shield: { current: 20, max: 20 } }), 8, "kinetic");
  assert.deepEqual([r.ship.shield.current, r.ship.hull.current], [12, 30], "shields soak a hit that fits");
  assert.equal(SR.damageType("Energy"), "energy"); assert.equal(SR.damageType("Ion damage"), "ion"); assert.equal(SR.damageType("plasma"), "energy", "an unknown word counts as energy");
  assert.equal(SR.takeDamage(ship(), 12, "acid").ship.hull.current, 24, "acid: 3 shields stop 6, 6 to the hull");
});

test("dropping to 0 hull: disabled with a level of system damage, or destroyed by massive damage; ion only disables", () => {
  let r = SR.takeDamage(ship(), 40, "energy");   // 3 to shields, 30 to the hull, 7 over: not enough to destroy
  let st = SR.statusOf(r.ship);
  assert.equal(r.outcome, "disabled"); assert.equal(r.ship.hull.current, 0);
  assert.deepEqual([st.cond, st.system, st.zero.stable, st.zero.destroyed], [["Disabled"], 1, false, false]);
  assert.ok(SR.dying(r.ship), "it makes destruction saves");
  assert.equal(SR.speedOf(r.ship), 0, "disabled: 4 slowed levels, speed 0");
  r = SR.takeDamage(ship(), 73, "energy");   // 30 to the hull and 40 over: the hull maximum
  assert.equal(r.outcome, "destroyed"); assert.ok(SR.isLost(SR.statusOf(r.ship)));
  assert.ok(r.log.some((l) => /destroyed/.test(l)));
  r = SR.takeDamage(ship(), 500, "ion");
  st = SR.statusOf(r.ship);
  assert.equal(r.outcome, "disabled", "ion damage never destroys");
  assert.ok(st.zero.stable, "ion leaves the ship disabled and stable");
  r = SR.takeDamage(ship(), 500, "energy", { disable: true });
  assert.equal(r.outcome, "disabled", "the attacker may choose to disable"); assert.ok(SR.statusOf(r.ship).zero.stable);
  assert.equal(SR.takeDamage(ship({ hull: { current: 0, max: 0 } }), 10, "energy").outcome, null, "a sheet with no hull maximum has no 0-hull rules");
});

test("damage at 0 hull: a level of system damage (two on a critical), no longer stable; the hull maximum destroys it", () => {
  const down = SR.takeDamage(ship(), 40, "energy", { disable: true }).ship;   // disabled, stable, system 1
  let r = SR.takeDamage(down, 5, "energy");
  assert.deepEqual([SR.statusOf(r.ship).system, SR.statusOf(r.ship).zero.stable, r.outcome], [2, false, "system"]);
  r = SR.takeDamage(down, 5, "energy", { crit: true });
  assert.equal(SR.statusOf(r.ship).system, 3, "a critical is two levels");
  r = SR.takeDamage(down, 40, "kinetic");
  assert.equal(r.outcome, "destroyed");
  r = SR.takeDamage(down, 400, "ion");
  assert.deepEqual([r.outcome, SR.statusOf(r.ship).zero.stable], ["system", true], "ion at 0 hull: system damage, still stable, never destroyed");
});

test("destruction saves: 10+ succeeds and three make it stable; a failure is system damage, a 1 is two; a 20 is 1 hull point", () => {
  let s = SR.takeDamage(ship(), 40, "energy").ship;   // system 1
  s = SR.destructionSave(s, 12).ship; s = SR.destructionSave(s, 10).ship;
  assert.equal(SR.statusOf(s).zero.s, 2);
  let r = SR.destructionSave(s, 19);
  assert.equal(r.result, "stable"); assert.ok(!SR.dying(r.ship), "a stable ship makes no more saves");
  assert.equal(SR.destructionSave(r.ship, 3).result, "none");
  r = SR.destructionSave(s, 9);
  assert.deepEqual([r.result, SR.statusOf(r.ship).system, SR.statusOf(r.ship).zero.f], ["fail", 2, 1]);
  r = SR.destructionSave(s, 1);
  assert.deepEqual([r.result, SR.statusOf(r.ship).system, SR.statusOf(r.ship).zero.f], ["fail2", 3, 2]);
  r = SR.destructionSave(s, 20);
  assert.equal(r.result, "up"); assert.equal(r.ship.hull.current, 1);
  assert.ok(!SR.statusOf(r.ship).cond.includes("Disabled"), "back above 0 hull: no longer disabled by it");
  assert.equal(SR.statusOf(r.ship).system, 1, "system damage stays until maintenance");
  // failures up to system damage 6: every primary system fails, and the ship is lost
  let t = SR.setCondition(s, "system", 5);
  t = SR.destructionSave(t, 4).ship;
  assert.ok(SR.isLost(SR.statusOf(t))); assert.ok(!SR.dying(t));
  assert.equal(SR.stabilize(s).done, true); assert.ok(SR.statusOf(SR.stabilize(s).ship).zero.stable);
});

test("ship conditions: slowed levels, system damage levels, and what they do to rolls", () => {
  assert.equal(SR.speedOf(SR.setCondition(ship(), "slowed", 1)), 150);
  assert.equal(SR.speedOf(SR.setCondition(ship({ speed: 400 }), "slowed", 2)), 150);
  assert.equal(SR.speedOf(SR.setCondition(ship(), "slowed", 3)), 0);
  assert.equal(SR.speedOf(SR.setCondition(ship(), "system", 2)), 150, "system damage 2 is a slowed level");
  for (const c of ["Stunned", "Tractored", "Stalled", "Disabled"]) assert.equal(SR.speedOf(SR.setCondition(ship(), c, true)), 0, c);
  let s = SR.setCondition(ship({ hull: { current: 40, max: 40 }, shield: { current: 20, max: 20 } }), "system", 4);
  assert.deepEqual([SR.hullMax(s), SR.shieldMax(s), s.hull.current, s.shield.current], [20, 10, 20, 10], "system damage 4 halves the maximums");
  s = SR.setCondition(ship(), "system", 5);
  assert.ok(SR.statusOf(s).cond.includes("Used"));
  assert.ok(SR.statusOf(SR.setCondition(s, "system", 0)).cond.includes("Used"), "used stays when the system damage is repaired");
  const fx = (o, kind, ab) => SR.rollEffects(o, kind, ab);
  assert.deepEqual(fx(SR.setCondition(ship(), "system", 1), "check").dis, ["System damage 1"]);
  assert.deepEqual(fx(SR.setCondition(ship(), "Ionized", true), "attack").dis, ["Ionized"]);
  assert.deepEqual(fx(SR.setCondition(ship(), "Stunned", true), "save", "dex").fail, ["Stunned"]);
  assert.deepEqual(fx(SR.setCondition(ship(), "Stunned", true), "save", "con").fail, [], "only Strength and Dexterity saves fail");
  assert.deepEqual(fx(SR.setCondition(ship(), "Invisible", true), "against").dis, ["Invisible"]);
  assert.deepEqual(fx(SR.setCondition(ship(), "Blinded", true), "against").adv, ["Blinded"]);
  const both = SR.setCondition(SR.setCondition(ship(), "Invisible", true), "Ionized", true);
  assert.equal(SR.rollMode(fx(both, "attack"), "normal"), "normal", "advantage and disadvantage cancel");
  assert.equal(SR.rollMode(fx(SR.setCondition(ship(), "system", 3), "save", "wis"), "adv"), "normal", "a shift-click advantage cancels it too");
  assert.equal(SR.rollMode(fx(ship(), "attack"), "dis"), "dis");
  assert.deepEqual(SR.cleanStatus({ cond: ["Hungry", "Ionized", "Ionized"], slowed: 9, system: -2, zero: "x" }),
    { cond: ["Ionized"], slowed: 4, system: 0, zero: { s: 0, f: 0, stable: false, destroyed: false }, power: { central: 0, engines: 0, shields: 0, weapons: 0, sensors: 0, comms: 0 },
      sdUsed: 0, hdUsed: 0, tempShield: 0, boost: { tries: 0, engines: 0, weapons: false, shields: false, regen: false } }, "anything else is cleaned away");
  assert.deepEqual(SR.capPoints({ hull: { current: 30, max: 0 }, shield: { current: 5, max: 4 } }).hull.current, 30, "no maximum typed yet: current stays");
});

test("repairs: up to the maximum, and hull back above 0 ends the destruction saves", () => {
  const down = SR.destructionSave(SR.takeDamage(ship(), 40, "energy").ship, 14).ship;
  let r = SR.restore(down, "hull", 100);
  assert.deepEqual([r.gained, r.ship.hull.current], [40, 40]);
  const st = SR.statusOf(r.ship);
  assert.deepEqual([st.cond, st.zero.s, st.system], [[], 0, 1]);
  r = SR.restore(ship(), "shield", 50);
  assert.equal(r.ship.shield.current, 20);
  const dead = SR.takeDamage(ship(), 999, "energy").ship;
  assert.equal(SR.restore(dead, "hull", 10).gained, 0, "a destroyed ship can't be repaired");
});

test("power: die size by tier, stores by coupling, recovery by reactor; reactor, coupling and shields from the sheet, equipment or role", () => {
  const med = ship({ size: "Medium", role: "Freighter", tier: 2 });   // SotG: a Medium freighter is fuel cell, hub & spoke
  assert.deepEqual([SR.reactorOf(med), SR.couplingOf(med), SR.shieldTypeOf(med)], ["Fuel Cell", "Hub & Spoke", ""], "Medium roles leave the shields to equipment");
  assert.deepEqual(SR.powerCaps(med), { central: 2, engines: 1, shields: 1, weapons: 1, sensors: 1, comms: 1 });
  assert.deepEqual(SR.powerCaps(ship({ coupling: "Direct" })).central, 4);
  assert.deepEqual(SR.powerCaps(ship({ coupling: "Distributed" })), { central: 0, engines: 2, shields: 2, weapons: 2, sensors: 2, comms: 2 });
  assert.equal(SR.powerDieText(med), "d6"); assert.equal(SR.powerDieText(ship({ tier: 0 })), "1"); assert.equal(SR.powerDie(ship({ tier: 5 })), 12);
  assert.equal(SR.shieldTypeOf(ship({ size: "Large", role: "Cruiser" })), "Fortress", "Large and up: the role's shields");
  const eq = ship({ equipment: [{ name: "Power Core Reactor" }, { name: "Distributed Power Coupling" }, { name: "Quick-Charge Shield" }] });
  assert.deepEqual([SR.reactorOf(eq), SR.couplingOf(eq), SR.shieldTypeOf(eq)], ["Power Core", "Distributed", "Quick-Charge"], "equipment picked from SotG names them");
  assert.equal(SR.reactorOf(Object.assign({}, eq, { reactor: "Ionization" })), "Ionization", "the sheet's own choice wins");
  for (const k of ["constructor", "__proto__", "toString"]) {   // names typed on a sheet never reach an inherited entry (#111)
    assert.equal(SR.damageType(k), "energy");
    assert.equal(SR.reactorOf(ship({ role: k, reactor: k, coupling: k })), "");
    assert.equal(SR.couplingOf(ship({ role: k, coupling: k })), "");
  }
  // dice: typed on the sheet, else the size and tier's
  assert.deepEqual(SR.diceOf(med, "shield"), { n: 7, die: 8 }, "a tier 2 Medium ship: 7d8");
  assert.deepEqual(SR.diceOf(ship({ shieldDice: "4d10" }), "shield"), { n: 4, die: 10 });
  assert.deepEqual(SR.diceOf(ship({ size: "Gargantuan", tier: 0 }), "hull"), { n: 11, die: 20 });
  // regeneration: the shield die's maximum times the coefficient (SotG's own example: a d8 fortress shield regenerates 5)
  assert.equal(SR.regenRate(ship({ size: "Medium", shieldType: "Fortress" })), 5);
  assert.equal(SR.regenRate(ship({ size: "Small", shieldType: "Directional" })), 6);
  assert.equal(SR.regenRate(ship({ size: "Small", shieldType: "Quick-Charge" })), 9);
  assert.equal(SR.regenRate(ship({ shieldRegen: "7" })), 7, "a number typed in Regen wins");
  assert.equal(SR.regenRate(SR.setCondition(ship({ size: "Medium", shieldType: "Directional" }), "system", 4)), 4, "halved at system damage 4");
});

test("the start of a ship's turn: power dice back and stored, passive shield regeneration, boosts end", () => {
  const dice = (vals) => (e) => ({ total: e === "1" ? 1 : vals.shift() });
  let s = ship({ size: "Small", reactor: "Power Core", coupling: "Hub & Spoke", shieldType: "Directional", shield: { current: 5, max: 20 } });
  let r = SR.startTurn(s, dice([2]), { regen: true });
  let st = SR.statusOf(r.ship);
  assert.deepEqual([st.power.central, st.power.engines], [2, 0], "1d2 rolled 2: both into central storage");
  assert.equal(r.ship.shield.current, 11, "regenerates 6 (a d6, directional)"); assert.equal(st.sdUsed, 1, "for a shield die");
  r = SR.startTurn(r.ship, dice([2]), { regen: false });
  st = SR.statusOf(r.ship);
  assert.deepEqual([st.power.central, st.power.engines, st.power.shields, r.ship.shield.current, st.sdUsed], [2, 1, 1, 11, 1], "central full: the systems in order; no regeneration unticked");
  const down = Object.assign(SR.capPoints(JSON.parse(JSON.stringify(r.ship))), { shield: { current: 0, max: 20 } });
  assert.equal(SR.startTurn(down, dice([1]), { regen: true }).ship.shield.current, 0, "shields that are down don't regenerate passively");
  const full = SR.setPower(SR.setPower(ship({ coupling: "Direct", reactor: "Fuel Cell" }), "central", 4), "central", 9);
  assert.equal(SR.statusOf(full).power.central, 4, "a store holds no more than its capacity");
  r = SR.startTurn(full, dice([]), {});
  assert.match(r.log[0], /1 with nowhere to go/);
  // spending
  const u = SR.usePower(SR.setPower(ship({ coupling: "Direct", tier: 3 }), "central", 2), "central", (e) => ({ total: e === "1d8" ? 7 : 0 }));
  assert.deepEqual([u.value, SR.statusOf(u.ship).power.central], [7, 1], "a tier 3 power die is a d8");
  assert.equal(SR.usePower(ship({ coupling: "Direct" }), "central", () => ({ total: 1 })).value, null, "an empty store");
  assert.equal(SR.startTurn(SR.takeDamage(ship({ reactor: "Fuel Cell", coupling: "Direct" }), 40, "energy").ship, dice([]), {}).log.length, 0, "a disabled ship gets no power");
});

test("Boost and Regenerate Shields: DC 10, 5 more for each try this turn; each function once; temporary shields soak first", () => {
  const d = (n) => () => ({ total: n });
  let s = ship({ size: "Medium", shieldType: "Directional", shield: { current: 4, max: 30 } });
  let r = SR.boost(s, "engines", 12, d(0));
  assert.ok(r.ok); assert.equal(SR.boostedSpeed(r.ship), 350, "+50 ft");
  assert.equal(SR.boostDC(r.ship), 15, "the next boost is DC 15");
  assert.ok(SR.boost(r.ship, "engines", 30, d(0)).already, "engines once a turn");
  r = SR.boost(r.ship, "shields", 14, d(6));
  assert.ok(!r.ok, "14 misses DC 15"); assert.equal(SR.boostDC(r.ship), 20);
  r = SR.boost(r.ship, "shields", 21, d(6));
  assert.ok(r.ok); assert.equal(SR.statusOf(r.ship).tempShield, 6, "a shield die rolled, not spent");
  assert.equal(SR.statusOf(r.ship).sdUsed, 0);
  const hit = SR.takeDamage(r.ship, 8, "energy");
  assert.deepEqual([SR.statusOf(hit.ship).tempShield, hit.ship.shield.current], [0, 2], "6 temporary, then 2 from the shields");
  r = SR.boost(r.ship, "weapons", 25, d(0)); assert.ok(SR.statusOf(r.ship).boost.weapons);
  // the next turn: boosts end, engines last through it
  let t = SR.startTurn(r.ship, () => ({ total: 0 }), {});
  let st = SR.statusOf(t.ship);
  assert.deepEqual([st.tempShield, st.boost.tries, st.boost.weapons, SR.boostedSpeed(t.ship)], [0, 0, false, 350], "engines boosted until the end of the next turn");
  t = SR.startTurn(t.ship, () => ({ total: 0 }), {});
  assert.equal(SR.boostedSpeed(t.ship), 300);
  // Regenerate Shields: DC is 10 or half the missing shield points
  s = ship({ size: "Medium", shield: { current: 0, max: 30 } });
  assert.equal(SR.regenDC(s), 15);
  const two = [7, 3];
  r = SR.regenerateShields(s, 12, () => ({ total: two.shift() }));
  assert.deepEqual([r.ok, r.gain, r.ship.shield.current, SR.statusOf(r.ship).sdUsed], [false, 3, 3, 1], "a failure keeps the lower of two rolls; down shields come back");
  assert.equal(SR.regenerateShields(r.ship, 30, () => ({ total: 8 })).done, false, "once a ship turn");
  r = SR.regenerateShields(s, 15, () => ({ total: 8 }));
  assert.deepEqual([r.ok, r.gain], [true, 8]);
});

// ---------------------------------------------------------------- the actions on the server
const HoloFake = require("./holotable-fake-redis.js");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === "ioredis" ? "ioredis-stub" : orig.call(this, req, ...rest); };
require.cache["ioredis-stub"] = { id: "ioredis-stub", filename: "ioredis-stub", loaded: true, exports: HoloFake };
process.env.REDIS_URL = "redis://stub";
const PLAYER_PW = "dune-sea-tea", GM_PW = "outer-rim-42";
process.env.HOLOTABLE_PLAYER_PASSWORD = PLAYER_PW;
process.env.HOLOTABLE_GM_PASSWORD = GM_PW;
const S = require("../api/_holotable-store.js");
const G = require("../api/_holotable-game.js");
const handler = require("../api/holotable.js");
const FakeBlob = require("./holotable-fake-blob.js");
let db = new HoloFake(), sub = null, store = new FakeBlob();
S.getClient = () => db; S.getSub = () => (sub = sub || db.duplicate()); S.getBlob = () => store; S.blobReady = () => true;
let ipn = 1;
function browser() {
  const b = { cookie: "", ip: `10.7.0.${ipn++}` };
  b.call = async (method, query, body) => {
    const headers = Object.assign({ "x-forwarded-for": b.ip, cookie: b.cookie }, method === "POST" ? { "x-holotable": "1" } : {});
    const res = { code: 0, headers: {}, data: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; },
      json(d) { this.data = d; return this; }, send(d) { this.data = d; return this; } };
    await handler({ method, query, body, headers }, res);
    const sc = res.headers["set-cookie"];
    if (sc) { const m = /^ht_session=([^;]*)/.exec(sc); b.cookie = m && m[1] ? `ht_session=${m[1]}` : ""; }
    return res;
  };
  b.act = (type, payload) => b.call("POST", { op: "action" }, { type, payload });
  b.state = async () => (await b.call("GET", { op: "poll", v: "", wait: "50" })).data.state;
  b.login = (password, name) => b.call("POST", { op: "login" }, { password, name });
  return b;
}
async function table() {
  db = new HoloFake(); sub = null; store = new FakeBlob();
  const gm = browser(), p1 = browser(), p2 = browser();
  await gm.login(GM_PW, "Dee"); await p1.login(PLAYER_PW, "Sam"); await p2.login(PLAYER_PW, "Rae");
  const party = (await p1.act("ship.save", { ship: { name: "Dawn Skiff", size: "Small", hull: { current: 30, max: 40 }, shield: { current: 3, max: 20 }, speed: 300 } })).data.id;
  const enemy = (await gm.act("ship.save", { ship: { name: "Black Lance", hidden: true, hull: { current: 20, max: 20 }, shield: { current: 0, max: 0 } } })).data.id;
  return { gm, p1, p2, party, enemy };
}
const shipIn = (st, id) => st.ships.find((x) => x.id === id);

test("ship actions: damage by type, 0 hull, destruction saves rolled on the server, stabilizing, repairs", async () => {
  const { gm, p1, p2, party } = await table();
  let res = await p2.act("ship.damage", { id: party, amount: 10, type: "fire" });
  assert.equal(res.code, 200);
  let sh = shipIn(await p1.state(), party);
  assert.deepEqual([sh.shield.current, sh.hull.current], [0, 26], "anyone at the table can damage a party ship; fire is halved on shields");
  await p2.act("ship.damage", { id: party, amount: 30, type: "energy" });
  sh = shipIn(await gm.state(), party);
  assert.deepEqual([sh.hull.current, sh.status.cond, sh.status.system], [0, ["Disabled"], 1]);
  const chat = (await p1.state()).chat.map((m) => m.text || "").join("\n");
  assert.match(chat, /Dawn Skiff takes 10 fire damage: 3 to shields, 4 to hull\./);
  assert.match(chat, /down to 0 hull points: disabled, system damage 1/);
  // the save is rolled here, never by a browser
  res = await p1.act("ship.dsave", { id: party, d20: 20 });
  assert.equal(res.code, 200);
  const r = res.data;
  assert.ok(r.d20 >= 1 && r.d20 <= 20 && ["success", "fail", "fail2", "up", "stable"].includes(r.result));
  const st = await p2.state();
  assert.ok(st.chat.some((m) => m.roll && m.roll.label === "Dawn Skiff: destruction save" && m.roll.nat === r.d20), "everyone sees the roll");
  sh = shipIn(st, party);
  if (sh.hull.current === 0) {
    assert.equal((await p1.act("ship.stabilize", { id: party })).code, 200);
    sh = shipIn(await p1.state(), party);
    assert.ok(sh.status.zero.stable);
    assert.equal((await p1.act("ship.dsave", { id: party })).code, 400, "a stable ship makes no destruction saves");
  }
  await p1.act("ship.restore", { id: party, what: "hull", amount: 15 });
  sh = shipIn(await p1.state(), party);
  assert.ok(sh.hull.current >= 15 && !sh.status.cond.includes("Disabled"), "repaired above 0: back in the fight");
  await p1.act("ship.restore", { id: party, what: "shield", amount: 99 });
  assert.equal(shipIn(await p1.state(), party).shield.current, 20);
});

test("ship actions: the fight state and current points are the server's; a stale sheet save can't undo them; typed hull brings a ship back", async () => {
  const { p1, party } = await table();
  const stale = shipIn(await p1.state(), party);
  await p1.act("ship.damage", { id: party, amount: 40, type: "energy" });
  await p1.act("ship.condition", { id: party, name: "Ionized", on: true });
  await p1.act("ship.condition", { id: party, name: "slowed", level: 2 });
  // a save from a browser that hadn't seen any of that, carrying its own idea of the status
  await p1.act("ship.save", { ship: Object.assign({}, stale, { notes: "fuel low", hull: { current: 0, max: 40 }, status: { cond: [], system: 0, zero: { destroyed: false } } }) });
  let sh = shipIn(await p1.state(), party);
  assert.deepEqual([sh.notes, sh.status.cond, sh.status.slowed, sh.status.system, sh.hull.current, sh.shield.current], ["fuel low", ["Disabled", "Ionized"], 2, 1, 0, 0],
    "conditions, system damage and the points stay");
  await p1.act("ship.points", { id: party, what: "hull", current: 12 });   // a player types the hull back up after a repair at a station
  sh = shipIn(await p1.state(), party);
  assert.deepEqual([sh.hull.current, sh.status.cond, sh.status.zero.s], [12, ["Ionized"], 0], "no longer disabled by 0 hull");
  await p1.act("ship.points", { id: party, what: "hull", current: 999 });
  assert.equal(shipIn(await p1.state(), party).hull.current, 40, "never above the maximum");
  await p1.act("ship.points", { id: party, what: "shield", current: 7 });
  assert.equal(shipIn(await p1.state(), party).shield.current, 7);
  assert.equal((await p1.act("ship.points", { id: "__proto__", what: "hull", current: 5 })).code, 400);
  // system damage 4 halves the maximums, and the points follow
  await p1.act("ship.condition", { id: party, name: "system", level: 4 });
  sh = shipIn(await p1.state(), party);
  assert.deepEqual([sh.hull.current, sh.hull.max], [20, 40], "the stored maximum stays; current stays inside the halved one");
  assert.equal((await p1.act("ship.condition", { id: party, name: "Hungry", on: true })).code, 400);
  assert.equal((await p1.act("ship.damage", { id: "nosuchship1", amount: 4 })).code, 400);
  assert.equal((await p1.act("ship.damage", { id: "__proto__", amount: 4 })).code, 400);
});

test("ship actions: hidden ships are the GM's, and their lines in the chat reach only the GM", async () => {
  const { gm, p1, enemy } = await table();
  assert.equal((await p1.act("ship.damage", { id: enemy, amount: 5 })).code, 403);
  assert.equal((await p1.act("ship.condition", { id: enemy, name: "Ionized", on: true })).code, 403);
  assert.equal((await p1.act("ship.dsave", { id: enemy })).code, 403);
  assert.equal((await gm.act("ship.damage", { id: enemy, amount: 25, type: "kinetic" })).code, 200);
  await gm.act("ship.dsave", { id: enemy });
  const mine = (await p1.state()).chat;
  assert.ok(!mine.some((m) => /Black Lance/.test((m.text || "") + ((m.roll || {}).label || ""))), "players never read the hidden ship's name");
  const gms = (await gm.state()).chat;
  assert.ok(gms.some((m) => /Black Lance takes 25 kinetic damage/.test(m.text || "")));
  assert.ok(gms.some((m) => m.roll && /Black Lance: destruction save/.test(m.roll.label)));
});

test("ship actions: only the GM undoes a destruction; the status survives a backup and restore", async () => {
  const { gm, p1, party } = await table();
  await p1.act("ship.damage", { id: party, amount: 200, type: "energy" });
  let sh = shipIn(await p1.state(), party);
  assert.ok(sh.status.zero.destroyed);
  assert.equal((await p1.act("ship.restore", { id: party, what: "hull", amount: 10 })).data.gained, 0, "no repairing a destroyed ship");
  assert.equal((await p1.act("ship.points", { id: party, what: "hull", current: 25 })).code, 400, "nor typing its hull back");
  await p1.act("ship.save", { ship: Object.assign({}, sh, { hull: { current: 25, max: 40 } }) });
  assert.equal(shipIn(await p1.state(), party).hull.current, 0, "nor saving a sheet that says otherwise");
  assert.equal((await p1.act("ship.reset", { id: party })).code, 403);
  assert.equal((await gm.act("ship.reset", { id: party })).code, 200);
  sh = shipIn(await p1.state(), party);
  assert.ok(!sh.status.zero.destroyed && SR.dying(sh), "back to 0 hull and making saves");
  // a game file round trip (what backups and restores go through) keeps the ship's status
  const g = G.cleanGame(Object.assign(G.blankCampaign("Test"), { ships: [JSON.parse(JSON.stringify(sh))] }));
  assert.deepEqual(g.ships[0].status, sh.status);
  const clean = G.cleanShip(JSON.parse(JSON.stringify(sh)), {});
  assert.deepEqual(clean.status, sh.status, "cleanShip keeps a stored status");
});

test("ship actions: start of turn, power dice, Boost and Regenerate Shields on the server", async () => {
  const { gm, p1, p2, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { reactor: "Fuel Cell", coupling: "Direct", shieldType: "Directional", reactorX: "?" }) });
  sh = shipIn(await p1.state(), party);
  assert.deepEqual([sh.reactor, sh.coupling, sh.shieldType, sh.reactorX], ["Fuel Cell", "Direct", "Directional", undefined]);
  assert.equal((await p1.act("ship.save", { ship: Object.assign({}, sh, { reactor: "constructor" }) })).code, 200);
  assert.equal(shipIn(await p1.state(), party).reactor, "", "only SotG's reactors");
  await p1.act("ship.save", { ship: sh });
  await p1.act("ship.turn", { id: party, regen: true });
  sh = shipIn(await p2.state(), party);
  assert.equal(sh.status.power.central, 1, "a fuel cell gives one die");
  assert.equal(sh.shield.current, 9, "3 + a d6's 6");
  assert.equal(sh.status.sdUsed, 1);
  let res = await p2.act("ship.poweruse", { id: party, pool: "central" });
  assert.equal(res.code, 200); assert.equal(res.data.value, 1, "tier 0: a flat 1");
  assert.equal((await p2.act("ship.poweruse", { id: party, pool: "central" })).code, 400, "the store is empty");
  assert.equal((await p2.act("ship.poweruse", { id: party, pool: "__proto__" })).code, 400);
  await p2.act("ship.power", { id: party, pool: "central", n: 99 });
  assert.equal(shipIn(await p2.state(), party).status.power.central, 4, "within the coupling's capacity");
  res = await p1.act("ship.boost", { id: party, what: "engines", bonus: 30 });
  assert.equal(res.code, 200);
  if (res.data.ok) assert.equal((await p1.act("ship.boost", { id: party, what: "engines" })).code, 400, "once a turn");
  assert.equal((await p1.act("ship.boost", { id: party, what: "hyperdrive" })).code, 400);
  res = await p1.act("ship.regen", { id: party });
  assert.equal(res.code, 200);
  sh = shipIn(await p1.state(), party);
  assert.ok(sh.shield.current > 9 && sh.status.sdUsed === 2 && sh.status.boost.regen);
  assert.equal((await p1.act("ship.regen", { id: party })).code, 400, "once a ship turn");
  const chat = (await p2.state()).chat;
  assert.ok(chat.some((m) => m.roll && /^Dawn Skiff: Boost engines \(DC 10\)/.test(m.roll.label) && m.roll.expr === "1d20+0"), "the bonus is the sheet's (Strength 10, no Boost proficiency), not the request's +30");
  assert.ok(chat.some((m) => /spends a central power die on Dawn Skiff: 1/.test(m.text || "")));
  // the bonus: ship Strength + the rolling crew member's proficiency times the Boost equipment; the request only picks the row
  sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { abilities: Object.assign({}, sh.abilities, { str: 16 }), skills: Object.assign({}, sh.skills, { boost: 2 }),
    crew: [{ name: "Ione", pb: 4 }, { name: "Tam", pb: 3 }] }) });
  await p1.act("ship.turn", { id: party });
  await p1.act("ship.boost", { id: party, what: "shields", crew: 1, bonus: 900 });
  await p1.act("ship.boost", { id: party, what: "weapons", crew: "__proto__" });
  const exprs = (await p2.state()).chat.filter((m) => m.roll && m.roll.kind === "boost").map((m) => m.roll.expr);
  assert.deepEqual(exprs.slice(-2), ["1d20+9", "1d20+11"], "+3 Str + 2 x 3 for Tam; a bad row reads as the first (+3 + 2 x 4)");
  assert.equal((await p1.act("ship.turn", { id: enemy })).code, 403);
  assert.equal((await p1.act("ship.boost", { id: enemy, what: "engines" })).code, 403);
  // a disabled ship can't act; its turn rolls its destruction save
  await gm.act("ship.damage", { id: enemy, amount: 25, type: "kinetic" });
  assert.equal((await gm.act("ship.boost", { id: enemy, what: "engines", bonus: 5 })).code, 400);
  await gm.act("ship.turn", { id: enemy });
  assert.ok((await gm.state()).chat.some((m) => m.roll && m.roll.label === "Black Lance: destruction save"), "the start of its turn rolls the save");
  assert.ok(!(await p1.state()).chat.some((m) => /Black Lance/.test((m.text || "") + ((m.roll || {}).label || ""))));
});

// ---------------------------------------------------------------- the space map (jpesus's call on #146)
test("space map geometry: 50 ft squares with alternating diagonals, turning, ship sizes, gaps and firing arcs", () => {
  assert.deepEqual([SR.gridFeet(3, 0), SR.gridFeet(1, 1), SR.gridFeet(2, 2), SR.gridFeet(4, 3)], [150, 50, 150, 250], "diagonals: 50, then 100, and so on");
  assert.deepEqual([SR.turnCost({ turn: 100 }, 0, 2), SR.turnCost({ turn: 100 }, 0, 1), SR.turnCost({ turn: 100 }, 1, 7), SR.turnCost({ turn: 150 }, 0, 4)], [100, 50, 100, 300]);
  assert.equal(SR.moveCost({ turn: 100 }, { x: 0, y: 0, f: 0 }, { x: 0, y: 4, f: 4 }), 400, "4 squares and an about-turn");
  assert.deepEqual(["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"].map((size) => SR.squaresOf({ size })), [1, 1, 2, 4, 8, 16], "SotG's sizes on a grid");
  assert.deepEqual(SR.inBounds({ x: 50, y: -3, f: 9 }, 4, 40, 28), { x: 36, y: 0, f: 1 }, "the board's edge stops a token");
  assert.equal(SR.shipGap({ x: 0, y: 0 }, 2, { x: 2, y: 0 }, 1), 50, "side by side: 50 ft");
  assert.equal(SR.shipGap({ x: 0, y: 0 }, 2, { x: 5, y: 0 }, 1), 200);
  const a = { x: 10, y: 10, f: 0 };
  assert.deepEqual([[10, 5], [15, 10], [10, 15], [5, 10]].map(([x, y]) => SR.arcOf(a, 1, { x, y }, 1)), ["forward", "starboard", "aft", "port"]);
  assert.equal(SR.arcOf({ x: 10, y: 10, f: 2 }, 1, { x: 15, y: 10 }, 1), "forward", "facing east, a ship to the east is ahead");
  assert.equal(SR.npcInitBonus({ size: "Medium", abilities: { dex: 14 } }), -5, "Dex +2 and Medium's -7");
});

test("space map: the GM switches the table to it; ships on the map, moved and turned inside it; who may move what", async () => {
  const { gm, p1, p2, party, enemy } = await table();
  assert.equal((await p1.act("space.on", { on: true })).code, 403, "only the GM switches the table");
  assert.equal((await gm.act("space.on", { on: true })).code, 200);
  let sp = (await p1.state()).space;
  assert.ok(sp.on && /^[a-z0-9]{6,20}$/.test(sp.n), "every screen learns it, with a fresh id to turn to it once");
  assert.equal((await p1.act("space.place", { id: party, x: 5, y: 5, f: 2 })).code, 200, "a player puts a party ship on the map");
  assert.equal((await p1.act("space.place", { id: enemy, x: 9, y: 9 })).code, 403, "not the GM's ship");
  for (const id of ["__proto__", "constructor", "toString"]) {
    assert.equal((await p1.act("space.place", { id, x: 1, y: 1 })).code, 400, id);
    assert.equal((await gm.act("space.token", { id, hidden: true })).code, 400, id);
  }
  assert.equal(({}).x, undefined, "nothing reached Object.prototype");
  assert.equal((await gm.act("space.place", { id: enemy, x: 999, y: -40, f: 13 })).code, 200);
  sp = (await gm.state()).space;
  const e = sp.tok.find((t) => t.id === enemy);
  assert.deepEqual([e.x, e.y, e.f], [39, 0, 5], "kept inside a 40 x 28 map for a 1-square ship; facing wraps");
  // players: an enemy ship is on their map as "???" until the GM names it, and gone while the GM hides its token
  let mine = (await p2.state()).space.tok;
  assert.deepEqual(mine.map((t) => t.name).sort(), ["???", "Dawn Skiff"]);
  assert.ok(!JSON.stringify((await p2.state()).space).includes("Black Lance"), "the enemy's name isn't sent at all");
  await gm.act("space.token", { id: enemy, named: true });
  assert.ok((await p2.state()).space.tok.some((t) => t.name === "Black Lance"));
  await gm.act("space.token", { id: enemy, hidden: true });
  assert.deepEqual((await p2.state()).space.tok.map((t) => t.id), [party], "a hidden token isn't sent");
  assert.equal((await p1.act("space.token", { id: party, hidden: true })).code, 403);
  await gm.act("space.size", { cols: 5, rows: 500 });
  sp = (await gm.state()).space;
  assert.deepEqual([sp.cols, sp.rows], [10, 120], "between 10 and 120 squares");
  assert.ok(sp.tok.every((t) => t.x <= sp.cols - 1), "a smaller map pulls tokens inside it");
  // deleting a ship takes it off the map
  await p1.act("ship.delete", { id: party });
  assert.deepEqual((await gm.state()).space.tok.map((t) => t.id), [enemy]);
  assert.equal((await gm.act("space.on", { on: false })).code, 200);
  assert.equal((await p1.state()).space.on, false);
});

test("space map: initiative, the order, a ship's turn starting its power and shields, and movement in feet", async () => {
  const { gm, p1, p2, party, enemy } = await table();
  // a crew with sheets: the party ship goes at their lowest roll
  const kira = (await p1.act("char.save", { char: { name: "Kira", abilities: { dex: 30 } } })).data.id;
  const tobin = (await p2.act("char.save", { char: { name: "Tobin", abilities: { dex: 1 } } })).data.id;
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { reactor: "Fuel Cell", coupling: "Direct", turn: 100, crew: [{ charId: kira }, { charId: tobin }] }) });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.place", { id: enemy, x: 20, y: 2, f: 6 });
  assert.equal((await p1.act("space.init", {})).code, 403);
  assert.equal((await gm.act("space.init", {})).code, 200);
  let st = await gm.state();
  const ini = st.space.order;
  assert.equal(ini.length, 2); assert.ok(ini[0].init >= ini[1].init, "highest first");
  const line = st.chat.find((m) => /Dawn Skiff: initiative \(the lowest of its crew: Kira \d+, Tobin -?\d+\)/.test(m.text || ""));
  assert.ok(line, "the party ship's line names its crew's rolls");
  const tobinRoll = +/Tobin (-?\d+)/.exec(line.text)[1], kiraRoll = +/Kira (\d+)/.exec(line.text)[1];
  assert.equal(ini.find((x) => x.id === party).init, Math.min(tobinRoll, kiraRoll));
  assert.ok(!(await p1.state()).chat.some((m) => /Black Lance/.test(m.text || "")), "the enemy's initiative line is the GM's");
  assert.ok(st.chat.some((m) => /Black Lance: initiative \(Dexterity -3 with its size\)/.test(m.text || "")), "an enemy ship: Dexterity +0 and Small's -3");
  // whoever is first has started its turn
  const first = ini[0].id;
  // play to the party ship's turn and check its turn started: a fuel cell's power die
  if (first !== party) await gm.act("space.next", {});
  st = await p1.state();
  assert.equal(st.space.turnId, party);
  assert.equal(shipIn(st, party).status.power.central, 1, "its turn started: the reactor's die");
  // movement this turn, in feet: 3 squares east and a 90-degree turn
  await p1.act("space.place", { id: party, x: 5, y: 2, f: 4 });
  assert.equal((await p1.state()).space.moved[party], 250, "150 ft and a 100 ft turn");
  assert.equal((await p2.act("space.place", { id: party, x: 5, y: 2, f: 4 })).code, 200, "anyone at the table moves a party ship");
  // the party's crew ends its own turn; they can't end the enemy's
  assert.equal((await p1.act("space.next", {})).code, 200);
  st = await p1.state();
  assert.notEqual(st.space.turnId, party);
  assert.equal((await p1.act("space.next", {})).code, 403, "not the enemy's turn");
  assert.equal((await p1.act("space.prev", {})).code, 403);
  await gm.act("space.next", {});
  st = await gm.state();
  assert.equal(st.space.turnId, party); assert.equal(st.space.moved[party], 0, "a new turn, no feet moved yet");
  assert.equal((await gm.act("space.end", {})).code, 200);
  st = await p1.state();
  assert.deepEqual([st.space.active, st.space.order.length, st.space.turnId], [false, 0, null]);
  // the space map survives a backup and restore
  const g = G.cleanGame(Object.assign(G.blankCampaign("Test"), { ships: st.ships, space: { on: true, n: "abcdef12", tok: [{ id: party, x: -5, y: 3, f: 2 }, { id: "__proto__", x: 1, y: 1 }, { id: party, x: 1, y: 1 }] } }));
  assert.deepEqual(g.space.tok, [{ x: 0, y: 3, f: 2, id: party, hidden: false, named: false }], "cleaned: inside the map, only real ships, once each");
});
