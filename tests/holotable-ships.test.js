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
      sdUsed: 0, hdUsed: 0, tempShield: 0, boost: { tries: 0, engines: 0, weapons: false, shields: false, regen: false },
      fx: { evade: 0, fly: 0, hardTurn: false, helm: false, interfered: false, directed: false, interferedBy: "", dogfightVs: "", dogfightDis: false, dogfightAdv: false,
        runVs: "", runFeet: 0, concealed: false, harassWeapon: -1, harassedBy: "", harassedWeapon: -1 }, zones: [], recharged: false, astro: 0, startup: 0,
      course: { rush: 0, careful: false }, pace: "normal" }, "anything else is cleaned away");
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
  // #266: an item counts only for its own kind, and names match as whole words: a Directional Shield isn't a Direct coupling
  const eqs = (...names) => ship({ size: "Medium", equipment: names.map((name) => ({ name })) });
  assert.equal(SR.couplingOf(eqs("Directional Shield", "Distributed Power Coupling")), "Distributed");
  assert.equal(SR.couplingOf(eqs("Directional Shield", "Hub & Spoke Power Coupling")), "Hub & Spoke");
  assert.equal(SR.couplingOf(eqs("Directional Shield")), "", "no coupling picked: none (not Direct)");
  assert.equal(SR.couplingOf(Object.assign(eqs("Directional Shield"), { role: "Freighter" })), "Hub & Spoke", "the role's coupling, not Direct");
  assert.deepEqual(SR.powerCaps(eqs("Directional Shield", "Distributed Power Coupling")).central, 0, "so its stores are the distributed coupling's");
  assert.equal(SR.shieldTypeOf(eqs("Directional Shield", "Direct Power Coupling")), "Directional", "and the shield still reads as directional");
  assert.equal(SR.couplingOf(eqs("Direct Power Coupling")), "Direct");
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
  // a player's Next can start an enemy ship's turn: its destruction save at 0 hull stays the GM's (no sender id on it)
  await gm.act("ship.damage", { id: enemy, amount: 25, type: "kinetic" });
  if ((await gm.state()).space.turnId !== party) await gm.act("space.next", {});
  const nx = await p1.act("space.next", {});
  assert.equal(nx.code, 200, "the party ends its turn; the enemy's starts");
  assert.deepEqual(nx.data, { ok: true }, "nothing of the enemy's turn comes back to the player");
  assert.ok((await gm.state()).chat.some((m) => m.roll && m.roll.label === "Black Lance: destruction save" && m.from === "Ship combat (GM only)" && !m.fromId), "the enemy's turn rolled its save, the GM's alone");
  for (const who of [p1, p2]) assert.ok(!JSON.stringify((await who.state()).chat).includes("Black Lance"), "not even the player who pressed Next reads it");
  assert.equal((await gm.act("space.end", {})).code, 200);
  st = await p1.state();
  assert.deepEqual([st.space.active, st.space.order.length, st.space.turnId], [false, 0, null]);
  // the space map survives a backup and restore
  const g = G.cleanGame(Object.assign(G.blankCampaign("Test"), { ships: st.ships, space: { on: true, n: "abcdef12", tok: [{ id: party, x: -5, y: 3, f: 2 }, { id: "__proto__", x: 1, y: 1 }, { id: party, x: 1, y: 1 }] } }));
  assert.deepEqual(g.space.tok, [{ x: 0, y: 3, f: 2, id: party, hidden: false, named: false }], "cleaned: inside the map, only real ships, once each");
});

// ---------------------------------------------------------------- firing (SotG chapter 5's weapons, chapter 9's attacks)
test("fire rules: arcs and turrets, ranges by category, properties, damage, and what changes the roll", () => {
  const laser = { name: "Quad laser", dmg: "2d4", type: "energy", range: "800/3200", props: "Power (range 800/3200), overheat 8", cat: "primary", arc: "forward" };
  const me = { size: "Small", abilities: { str: 14, wis: 16, con: 10 } }, them = { size: "Medium" };
  const a = { x: 0, y: 0, f: 2 };   // facing east
  let c = SR.fireCheck(me, a, laser, them, { x: 10, y: 0 });
  assert.deepEqual([c.ok, c.feet, c.arc, c.kind, c.dis], [true, 500, "forward", "attack", []], "10 squares to its square: 500 ft");
  assert.match(SR.fireCheck(me, a, laser, them, { x: 0, y: 10 }).why, /starboard arc/, "a forward mount can't fire to starboard");
  assert.ok(SR.fireCheck(me, a, Object.assign({}, laser, { arc: "turret" }), them, { x: 0, y: 10 }).ok, "a turret fires in any arc");
  assert.ok(SR.fireCheck(me, a, Object.assign({}, laser, { arc: "" }), them, { x: 0, y: 10 }).ok, "no mount set: any arc");
  assert.deepEqual(SR.fireCheck(me, a, laser, them, { x: 20, y: 0 }).dis, ["long range"], "primary: beyond normal range");
  assert.match(SR.fireCheck(me, a, laser, them, { x: 70, y: 0 }).why, /beyond its long range/);
  assert.deepEqual(SR.fireCheck(me, a, laser, them, { x: 1, y: 0 }).dis, ["within 50 ft"]);
  const rail = Object.assign({}, laser, { cat: "secondary", range: "400/1600" });
  assert.deepEqual(SR.fireCheck(me, a, rail, them, { x: 5, y: 0 }).dis, ["close range"], "secondary: within close range");
  assert.ok(SR.fireCheck(me, a, rail, them, { x: 12, y: 0 }).ok);
  const big = { size: "Huge", abilities: {} };
  assert.match(SR.fireCheck(big, a, rail, { size: "Small" }, { x: 20, y: 0 }).why, /can't target Small or Tiny/);
  assert.deepEqual(SR.fireCheck(big, a, rail, { size: "Medium" }, { x: 20, y: 0 }).dis, ["a smaller target"]);
  c = SR.fireCheck(big, a, laser, them, { x: 30, y: 0 });
  assert.deepEqual([c.kind, c.adv, c.dis], ["save", ["long range"], []], "a Huge ship's primary weapons call for a save; past normal range the target has advantage");
  const torp = { name: "Torpedo", dmg: "4d10", type: "kinetic", range: "1000/4000", props: "Ammunition, homing", cat: "tertiary", arc: "forward" };
  c = SR.fireCheck(me, a, torp, them, { x: 10, y: 0 });
  assert.deepEqual([c.kind, c.dis], ["save", ["homing"]], "tertiary: a save; homing gives the target disadvantage");
  assert.deepEqual(SR.fireCheck(me, a, Object.assign({}, torp, { props: "Ammunition" }), { size: "Gargantuan" }, { x: 30, y: 0 }).adv, ["long range"]);
  assert.deepEqual(SR.fireCheck(me, a, Object.assign({}, torp, { props: "Ammunition" }), { size: "Huge" }, { x: 10, y: 0 }).dis, ["a much larger ship"]);
  assert.match(SR.fireCheck(me, a, Object.assign({}, torp, { cat: "quaternary" }), them, { x: 10, y: 0 }).why, /dropped or launched/);
  // conditions and properties
  assert.deepEqual(SR.fireCheck(SR.setCondition(me, "Ionized", true), a, laser, SR.setCondition(them, "Stunned", true), { x: 10, y: 0 }).dis, ["Ionized"]);
  assert.deepEqual(SR.fireCheck(me, a, laser, SR.setCondition(them, "Stunned", true), { x: 10, y: 0 }).adv, ["Stunned"], "attacks against a stunned ship have advantage");
  assert.deepEqual(SR.fireCheck(me, a, Object.assign({}, laser, { props: "constitution 15" }), them, { x: 10, y: 0 }).dis, ["Constitution under 15"]);
  assert.deepEqual([SR.weaponProp({ props: "Power (range 1000/4000), con. 17, heavy, ionizing, keen 1" }, "constitution"), SR.weaponProp({ props: "heavy, keen 1" }, "keen"),
    SR.weaponProp({ props: "heavy" }, "heavy"), SR.weaponProp({ props: "overheat 8" }, "heavy")], [17, 1, true, null]);
  assert.equal(SR.attackBonusOf(me, laser, 3), 6, "Wis +3 and the gunner's +3");
  assert.equal(SR.saveDcOf(me, torp, 3), 14);
  assert.deepEqual([SR.damageExpr(me, laser, false), SR.damageExpr(me, laser, true), SR.damageExpr(me, torp, false), SR.damageExpr(me, Object.assign({}, laser, { props: "heavy" }), false)],
    ["2d4+2", "4d4+2", "4d10", "2d4+3"], "Strength on primary and secondary; dice doubled on a critical; heavy adds half Strength");
});

test("space.fire: the attack against AC, damage through the ship rules, ammunition, ionizing, a torpedo's save, and who may fire", async () => {
  const { gm, p1, p2, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { abilities: Object.assign({}, sh.abilities, { wis: 30 }), weapons: [
    { name: "Quad laser", dmg: "2d4", type: "energy", range: "800/3200", cat: "primary", arc: "forward", atkMisc: 20 },
    { name: "Ion cannon", dmg: "1d4", type: "ion", range: "800/3200", props: "ionizing", cat: "primary", arc: "turret", atkMisc: 20, ammo: 1 },
    { name: "Torpedo", dmg: "1d4", type: "kinetic", range: "1000/4000", cat: "tertiary", arc: "forward", atkMisc: 20 },
  ] }) });
  sh = shipIn(await p1.state(), party);
  assert.deepEqual(sh.weapons.map((w) => [w.cat, w.arc, w.ammo]), [["primary", "forward", ""], ["primary", "turret", 1], ["tertiary", "forward", ""]], "the mount fields are kept");
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 5, f: 2 });     // facing east
  await gm.act("space.place", { id: enemy, x: 10, y: 5, f: 6 });   // 7 squares east of it
  let res = await p1.act("space.fire", { id: party, target: enemy, weapon: 0, bonus: 99 });
  assert.equal(res.code, 200);
  let st = await p1.state();
  const atk = st.chat.find((m) => m.roll && m.roll.kind === "attack");
  assert.equal(res.data.hit, atk.roll.nat !== 1, "+10 Wis, +2, +20 against AC 10: a hit unless a 1");
  assert.equal(atk.roll.expr, "1d20+32", "the bonus is the sheet's, not the request's");
  assert.equal(atk.roll.label, "Dawn Skiff fires Quad laser at ???", "the enemy is ??? to the table until the GM names it");
  assert.ok(!JSON.stringify(st.chat).includes("Black Lance"), "its name and its hull lines stay the GM's");
  const gst = await gm.state();
  if (res.data.hit) {
    assert.ok(gst.chat.some((m) => /^Black Lance takes \d+ damage/.test(m.text || "")), "the GM reads what the hit did");
    assert.equal(shipIn(gst, enemy).hull.current, 20 - res.data.damage, "through the ship rules: no shields, all to the hull");
  }
  // ammunition and ionizing; a turret fires whatever the arc
  await gm.act("space.place", { id: enemy, x: 2, y: 12, f: 0 });   // now off its starboard side
  assert.equal((await p1.act("space.fire", { id: party, target: enemy, weapon: 0 })).code, 400, "the forward laser can't reach it");
  res = await p1.act("space.fire", { id: party, target: enemy, weapon: 1 });
  assert.equal(res.code, 200);
  assert.equal(shipIn(await p1.state(), party).weapons[1].ammo, 0, "one shot of ammunition spent");
  assert.equal((await p1.act("space.fire", { id: party, target: enemy, weapon: 1 })).code, 400, "out of ammunition");
  if (res.data.hit) assert.ok((await gm.state()).chat.some((m) => m.roll && /Constitution save against ionizing \(DC 13\)/.test(m.roll.label)), "ionizing: a DC 13 Constitution save");
  // a torpedo: the target's Dexterity save, half on a success
  await gm.act("space.place", { id: enemy, x: 12, y: 5, f: 6 });
  res = await p2.act("space.fire", { id: party, target: enemy, weapon: 2 });
  assert.equal(res.code, 200); assert.equal(typeof res.data.saved, "boolean");
  assert.ok((await p1.state()).chat.some((m) => /Dawn Skiff fires Torpedo at \?\?\?: a Dexterity save, DC 40/.test(m.text || "")));
  // who may fire what; ids and indexes from the request
  assert.equal((await p1.act("space.fire", { id: enemy, target: party, weapon: 0 })).code, 403, "the GM's ship");
  for (const bad of [{ target: "__proto__" }, { target: "constructor" }, { weapon: "__proto__" }, { weapon: 7 }, { weapon: -1 }, { target: party }]) {
    assert.equal((await p1.act("space.fire", Object.assign({ id: party, target: enemy, weapon: 0 }, bad))).code, 400, JSON.stringify(bad));
  }
  assert.equal(({}).hull, undefined);
  // after a laser, an ion cannon and a torpedo at it, neither player has read the enemy's name: its saves (Constitution
  // against ionizing, Dexterity against the torpedo) and its hull lines went to the GM alone, with no sender id
  for (const who of [p1, p2]) assert.ok(!JSON.stringify((await who.state()).chat).includes("Black Lance"), "no player reads the enemy's name");
  assert.ok((await gm.state()).chat.some((m) => m.roll && /^Black Lance: Dexterity save \(DC 40\)/.test(m.roll.label) && m.from === "Ship combat (GM only)" && !m.fromId));
  await gm.act("space.token", { id: enemy, hidden: true });
  assert.equal((await p1.act("space.fire", { id: party, target: enemy, weapon: 2 })).code, 400, "players can't fire at a token they can't see");
  // the GM fires back: its roll is the GM's, the result is everyone's
  await gm.act("space.token", { id: enemy, hidden: false });
  sh = shipIn(await gm.state(), enemy);
  await gm.act("ship.save", { ship: Object.assign({}, sh, { weapons: [{ name: "Turbolaser", dmg: "1d6", type: "energy", range: "800/3200", cat: "primary", arc: "turret", atkMisc: 30 }] }) });
  res = await gm.act("space.fire", { id: enemy, target: party, weapon: 0 });
  assert.equal(res.code, 200);
  st = await p1.state();
  assert.ok(!st.chat.some((m) => m.roll && /Turbolaser/.test(m.roll.label)), "the enemy's attack roll isn't the players'");
  assert.ok(st.chat.some((m) => /^\?\?\? (hits|misses) Dawn Skiff with Turbolaser/.test(m.text || "")), "but they read what happened to them");
});

// ---------------------------------------------------------------- Helm and crew actions (SotG chapter 9)
test("helm and crew rules: Evade, Fly, Hard Turn, one Helm action a turn, Patch, skill bonuses", () => {
  const s = ship({ size: "Medium", speed: 300, turn: 100, hull: { current: 10, max: 40 }, abilities: { con: 14, dex: 14, str: 12 }, skills: { patch: 1, maneuvering: 2 } });
  let r = SR.helm(s, "evade");
  assert.ok(r.ok);
  assert.deepEqual([SR.rollEffects(r.ship, "against").dis, SR.rollEffects(r.ship, "attack").dis, SR.rollEffects(r.ship, "check").dis, SR.rollEffects(r.ship, "save", "dex").adv],
    [["Evading"], ["Evade"], ["Evade"], ["Evade"]]);
  assert.equal(SR.helm(r.ship, "fly").ok, false, "one Helm action a turn");
  let t = SR.startTurn(r.ship, () => ({ total: 0 }), {});
  assert.deepEqual([SR.rollEffects(t.ship, "against").dis, SR.rollEffects(t.ship, "attack").dis], [[], ["Evade"]], "the next turn: no more defence, still the penalty");
  assert.ok(SR.helm(t.ship, "fly").ok, "a new turn, a new Helm action");
  t = SR.startTurn(t.ship, () => ({ total: 0 }), {});
  assert.deepEqual(SR.rollEffects(t.ship, "attack").dis, [], "and the turn after, nothing");
  assert.equal(SR.moveBudget(SR.helm(s, "fly").ship), 600, "Fly: twice its speed this turn");
  assert.ok(SR.statusOf(SR.helm(s, "hardturn").ship).fx.hardTurn);
  assert.equal(SR.helm(s, "warp").ok, false);
  assert.deepEqual([SR.skillBonus(s, "patch", 3), SR.skillBonus(s, "maneuvering", 3), SR.skillBonus(s, "ram", 3), SR.skillBonus(s, "__proto__", 3)], [5, 8, 1, 0]);
  // Patch: DC 10 or half the missing hull; a hull die, the lower of two on a failure
  assert.equal(SR.patchDC(s), 15);
  r = SR.patch(s, 15, () => ({ total: 6 }));
  assert.deepEqual([r.ok, r.gain, r.ship.hull.current, SR.statusOf(r.ship).hdUsed], [true, 6, 16, 1]);
  const two = [7, 2];
  r = SR.patch(s, 3, () => ({ total: two.shift() }));
  assert.deepEqual([r.ok, r.gain], [false, 2]);
  r = SR.patch(SR.takeDamage(ship({ size: "Medium" }), 40, "energy").ship, 20, () => ({ total: 5 }));
  assert.ok(!SR.statusOf(r.ship).cond.includes("Disabled"), "patched up from 0 hull: back in the fight");
  assert.equal(SR.patch(SR.setDiceUsed(ship({ size: "Small", tier: 0 }), "hull", 3), 20, () => ({ total: 5 })).done, false, "no hull dice left");
  assert.equal(SR.patch(ship({ hull: { current: 40, max: 40 } }), 20, () => ({ total: 5 })).done, false, "a whole hull needs no patching (and spends no die)");
});

test("helm and crew actions on the server: Evade, Hard Turn on the map, Patch, Direct, Interfere and Ram", async () => {
  const { gm, p1, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { turn: 100, abilities: Object.assign({}, sh.abilities, { str: 30, cha: 30, con: 30 }), crew: [{ name: "Ione", pb: 4 }],
    skills: Object.assign({}, sh.skills, { ram: 2, interfere: 2, patch: 2 }), weapons: [{ name: "Laser", dmg: "1d4", type: "energy", range: "800/3200", cat: "primary", atkMisc: 30 }] }) });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.place", { id: enemy, x: 4, y: 2, f: 6 });
  await gm.act("space.init", {});
  if ((await gm.state()).space.turnId !== party) await gm.act("space.next", {});
  // Evade, then no second Helm action this turn
  assert.equal((await p1.act("ship.helm", { id: party, what: "evade" })).code, 200);
  assert.equal((await p1.act("ship.helm", { id: party, what: "fly" })).code, 400);
  assert.equal((await p1.act("space.ram", { id: party, target: enemy })).code, 400, "Ram is a Helm action too");
  assert.equal((await p1.act("ship.helm", { id: party, what: "__proto__" })).code, 400);
  assert.equal((await p1.act("ship.helm", { id: enemy, what: "evade" })).code, 403);
  // Direct: the next attack has advantage, and is used up by it
  await p1.act("ship.direct", { id: party });
  await p1.act("space.fire", { id: party, target: enemy, weapon: 0 });
  let st = await p1.state();
  const atk = st.chat.filter((m) => m.roll && m.roll.kind === "attack").pop();
  assert.match(atk.roll.label, /\[Evade, Directed\]|\[Directed, Evade\]/, "Evade's penalty and Direct's advantage both count");
  assert.equal(atk.roll.expr, "1d20+24", "they cancel: one d20, + Wis 0 + Ione's 4 + the weapon's bonus, which the sheet caps at 20");
  assert.equal(shipIn(st, party).status.fx.directed, false, "used up");
  // Patch, with the sheet's bonus: Con 30 (+10) and expertly equipped (2 x 4)
  await p1.act("ship.damage", { id: party, amount: 20, type: "kinetic" });
  const before = shipIn(await p1.state(), party).hull.current;
  assert.equal((await p1.act("ship.patch", { id: party, bonus: 99 })).code, 200);
  st = await p1.state();
  assert.ok(st.chat.some((m) => m.roll && m.roll.kind === "patch" && m.roll.expr.endsWith("+18")), "Con +10, expertly equipped 2 x 4: +18, not the request's");
  assert.ok(shipIn(st, party).hull.current > before && shipIn(st, party).status.hdUsed === 1);
  // the next turn: Hard Turn makes a 90-degree turn free
  await p1.act("space.next", {}); await gm.act("space.next", {});
  assert.equal((await p1.state()).space.turnId, party);
  await p1.act("ship.helm", { id: party, what: "hardturn" });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 4 });
  assert.equal((await p1.state()).space.moved[party], 0, "a 90-degree hard turn costs nothing");
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 6 });
  assert.equal((await p1.state()).space.moved[party], 100, "the next turn costs as usual");
  // Interfere: Cha +10 + 2 x 4 against the enemy's Wisdom (Scan) +0; then its next roll has disadvantage
  let res = await p1.act("space.interfere", { id: party, target: enemy, bonus: 99 });
  assert.equal(res.code, 200);
  if (res.data.ok) assert.ok(shipIn(await gm.state(), enemy).status.fx.interfered);
  assert.ok(!JSON.stringify((await p1.state()).chat).includes("Black Lance"), "the enemy's check and name are the GM's");
  // Ram: within 50 ft; both take damage, the rammer half while its shields hold
  await gm.act("space.place", { id: enemy, x: 30, y: 2, f: 6 });
  await p1.act("space.next", {}); await gm.act("space.next", {});
  assert.equal((await p1.act("space.ram", { id: party, target: enemy })).code, 400, "too far to ram");
  await gm.act("space.place", { id: enemy, x: 3, y: 2, f: 6 });
  res = await p1.act("space.ram", { id: party, target: enemy });
  assert.equal(res.code, 200);
  for (const bad of ["__proto__", "constructor", party]) assert.equal((await p1.act("space.interfere", { id: party, target: bad })).code, 400, bad);
  assert.ok(!JSON.stringify((await p1.state()).chat).includes("Black Lance"));
});

test("ship combat turns: a player's ship acts only on its own turn; the GM is free; Interfere and Direct end at the actor's next turn; Evade ends when disabled", async () => {
  // Evade ends when the ship is disabled or its speed drops to 0
  const ev = SR.helm(ship(), "evade").ship;
  assert.deepEqual(SR.rollEffects(ev, "against").dis, ["Evading"]);
  assert.deepEqual(SR.rollEffects(SR.setCondition(ev, "Disabled", true), "against").dis, [], "disabled: no more evading");
  assert.deepEqual(SR.rollEffects(SR.setCondition(ev, "slowed", 4), "against").dis, [], "speed 0: no more evading");
  assert.equal(SR.statusOf(SR.startTurn(SR.setCondition(ship(), "Ionized", false), () => ({ total: 0 }), {}).ship).fx.directed, false);
  const { gm, p1, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { abilities: Object.assign({}, sh.abilities, { cha: 30 }), skills: Object.assign({}, sh.skills, { interfere: 2 }),
    weapons: [{ name: "Laser", dmg: "1d4", type: "energy", range: "800/3200", cat: "primary", atkMisc: 20 }] }) });
  await p1.act("ship.damage", { id: party, amount: 10, type: "kinetic" });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.place", { id: enemy, x: 4, y: 2, f: 6 });
  // before combat starts, nothing is turn-bound
  assert.equal((await p1.act("ship.patch", { id: party })).code, 200, "Patch between fights");
  await gm.act("space.init", {});
  if ((await gm.state()).space.turnId !== enemy) await gm.act("space.next", {});
  assert.equal((await gm.state()).space.turnId, enemy, "the enemy's turn");
  for (const [type, payload] of [["ship.helm", { what: "evade" }], ["ship.direct", {}], ["ship.patch", {}], ["ship.boost", { what: "engines" }], ["ship.regen", {}],
    ["space.interfere", { target: enemy }], ["space.ram", { target: enemy }], ["space.fire", { target: enemy, weapon: 0 }], ["space.place", { x: 3, y: 3, f: 2 }]]) {
    const r = await p1.act(type, Object.assign({ id: party }, payload));
    assert.equal(r.code, 400, `${type} on the enemy's turn`); assert.match(r.data.error || "", /Not Dawn Skiff's turn/);
  }
  assert.equal(SR.statusOf(shipIn(await p1.state(), party)).fx.helm, false, "no Helm action was spent");
  assert.equal((await gm.act("ship.helm", { id: party, what: "evade" })).code, 200, "the GM is free to act or fix things");
  assert.equal((await gm.act("ship.helm", { id: enemy, what: "evade" })).code, 200);
  // the party's turn: Interfere works, and lasts until the start of the party's next turn if no roll uses it
  await gm.act("space.next", {});
  assert.equal((await p1.state()).space.turnId, party);
  let r;
  for (let i = 0; i < 8; i++) { r = await p1.act("space.interfere", { id: party, target: enemy }); if (r.code !== 200 || r.data.ok) break; await gm.act("space.next", {}); await gm.act("space.next", {}); }
  assert.equal(r.code, 200);
  if (r.data.ok) {
    let en = shipIn(await gm.state(), enemy);
    assert.deepEqual([en.status.fx.interfered, en.status.fx.interferedBy], [true, party]);
    await p1.act("space.next", {});   // the enemy's turn: it takes no roll
    assert.equal(shipIn(await gm.state(), enemy).status.fx.interfered, true, "still on during its turn");
    await gm.act("space.next", {});   // the party's next turn starts
    en = shipIn(await gm.state(), enemy);
    assert.deepEqual([en.status.fx.interfered, en.status.fx.interferedBy], [false, ""], "ended at the start of the interfering ship's next turn");
  }
});

// ---------------------------------------------------------------- what size, tier and role give a ship (10.5)
test("size, tier and role: SotG's own worked example, AC with armor and tier, suites, saves, armor damage reduction", () => {
  // Starships of the Galaxy, chapter 1: a tier 0 Medium freighter with Str 15, Dex 14, Con 12 and fortress shields has
  // 33 hull points, 38 base shield points and a capacity of 57; at tier 1 with Str 17, 76
  const f = { size: "Medium", tier: 0, role: "Freighter", shieldType: "Fortress", abilities: { str: 15, dex: 14, con: 12 } };
  const d = SR.derive(f);
  assert.deepEqual([d.hullDice, d.hull, d.shieldDice, d.shieldBase, d.shield, d.armor, d.ac, d.speed, d.turn, d.suites, d.slots],
    ["5d8", 33, "5d8", 38, 57, "Deflection", 12, 300, 150, 4, 30]);
  assert.deepEqual(d.roleAdj, { con: 1 }, "a freighter: +1 Constitution");
  assert.equal(SR.derive(Object.assign({}, f, { tier: 1, abilities: { str: 17, dex: 14, con: 12 } })).shield, 76);
  assert.equal(SR.derive(Object.assign({}, f, { abilities: { dex: 20 } })).ac, 12, "deflection armor: at most +2 from Dexterity");
  assert.equal(SR.derive(Object.assign({}, f, { tier: 5, armor: "Lightweight", abilities: { dex: 20 } })).ac, 19, "lightweight: all of it; +4 at tier 5");
  assert.equal(SR.derive({ size: "Small", role: "Attack Fighter", abilities: { dex: 18 } }).ac, 10, "reinforced: none of it");
  assert.deepEqual([SR.derive({ size: "Gargantuan", abilities: { con: 20 } }).suites, SR.derive({ size: "Small", abilities: { con: 8 } }).suites], [30, 0], "suites: 10 + 4 x Con; never below 0");
  assert.deepEqual([SR.derive({ size: "Tiny" }).saves, SR.derive({ size: "Small" }).saves, SR.derive({ size: "Huge" }).saves], [["dex", "int"], ["str", "dex"], ["wis"]]);
  assert.deepEqual([SR.derive({ size: "Gargantuan" }).hullDice, SR.derive({ size: "Tiny", tier: 5 }).hullDice], ["11d20", "6d4"]);
  // armor damage reduction, against attack rolls: never below 1
  const fighter = { size: "Small", role: "Attack Fighter" };
  assert.deepEqual([SR.armorDR(fighter), SR.afterDR(fighter, 10), SR.afterDR(fighter, 4), SR.afterDR(fighter, 0), SR.afterDR({ armor: "Deflection" }, 10), SR.afterDR({}, 10)], [6, 4, 1, 0, 7, 10]);
  assert.equal(SR.armorOf({ role: "constructor", armor: "__proto__" }), "", "inherited names never reach a table");
});

test("space.fire: a hit from an attack roll is reduced by the target's armor; the sheet keeps only SotG's armors", async () => {
  const { gm, p1, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { armor: "__proto__", weapons: [{ name: "Laser", dmg: "1d4", type: "energy", range: "800/3200", cat: "primary", atkMisc: 20 }] }) });
  assert.equal(shipIn(await p1.state(), party).armor, "");
  const en = shipIn(await gm.state(), enemy);
  await gm.act("ship.save", { ship: Object.assign({}, en, { armor: "Reinforced" }) });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.place", { id: enemy, x: 8, y: 2, f: 6 });
  for (let i = 0; i < 6; i++) {
    const r = await p1.act("space.fire", { id: party, target: enemy, weapon: 0 });
    if (r.data.hit) { assert.equal(r.data.damage, r.data.crit ? r.data.damage : 1, "1d4 against reinforced armor's 6: 1"); assert.ok(r.data.damage >= 1 && r.data.damage <= 2, "even a critical's 2d4"); break; }
  }
});

test("a GM ship whose token is off the players' map: its Fire, Ram and Interfere reach the GM only (jpesus, #65)", async () => {
  const { gm, p1, p2, party, enemy } = await table();
  const third = (await gm.act("ship.save", { ship: { name: "Grey Wake", hidden: true, hull: { current: 20, max: 20 } } })).data.id;
  let en = shipIn(await gm.state(), enemy);
  await gm.act("ship.save", { ship: Object.assign({}, en, { hull: { current: 20, max: 500 }, abilities: Object.assign({}, en.abilities, { str: 30, cha: 30 }),
    weapons: [{ name: "Turbolaser", dmg: "1d6", type: "energy", range: "800/3200", cat: "primary", atkMisc: 20 }, { name: "Torpedo", dmg: "1d6", type: "kinetic", range: "1000/4000", cat: "tertiary" }] }) });
  await gm.act("ship.points", { id: enemy, what: "hull", current: 500 });   // its own Ram can't knock it out mid-test
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.place", { id: enemy, x: 3, y: 2, f: 6, hidden: true });   // off the players' map: an ambush
  await gm.act("space.place", { id: third, x: 3, y: 4, f: 0 });
  const before = { p1: (await p1.state()).chat.length, p2: (await p2.state()).chat.length };
  const hull0 = shipIn(await p1.state(), party).hull.current;
  for (const [type, payload] of [["space.fire", { target: party, weapon: 0 }], ["space.fire", { target: party, weapon: 1 }], ["space.interfere", { target: party }],
    ["space.ram", { target: party }], ["space.fire", { target: third, weapon: 0 }], ["space.interfere", { target: third }]]) {
    const r = await gm.act(type, Object.assign({ id: enemy }, payload));
    assert.equal(r.code, 200, type);
    if (type === "space.ram") await gm.act("space.place", { id: enemy, x: 3, y: 2, f: 6 });
  }
  // the GM ships also act on each other with the hidden one as the target
  await gm.act("space.fire", { id: third, target: enemy, weapon: 0 }).catch(() => {});
  const st1 = await p1.state(), st2 = await p2.state();
  assert.deepEqual(st1.chat.slice(before.p1).map((m) => m.text || (m.roll || {}).label), [], "not one line or roll reaches the first player");
  assert.deepEqual(st2.chat.slice(before.p2).map((m) => m.text || (m.roll || {}).label), [], "nor the other");
  const gmChat = (await gm.state()).chat;
  assert.ok(gmChat.some((m) => /Black Lance: Strength \(Ram\)/.test((m.roll || {}).label || "") && m.from === "Ship combat (GM only)" && !m.fromId));
  assert.ok(gmChat.some((m) => /Dawn Skiff: (Dexterity \(Maneuvering\)|Wisdom \(Scan\))/.test((m.roll || {}).label || "") && m.to && m.to.join() === "@gm"), "the party ship's own opposed roll is the GM's too");
  // the hits still land on the party's own sheet
  assert.ok(shipIn(st1, party).hull.current <= hull0);
  // once the GM shows the token, the lines are the table's again (with "???" until it's named)
  await gm.act("space.token", { id: enemy, hidden: false });
  await gm.act("space.fire", { id: enemy, target: party, weapon: 0 });
  assert.ok((await p1.state()).chat.some((m) => /^\?\?\? (hits|misses) Dawn Skiff with Turbolaser/.test(m.text || "")));
});

// ---------------------------------------------------------------- weapon properties: rapid, burst, overheat, reload, saturate (10.15)
test("weapon property rules: modes, shots, heat, reload, saturate, the burst cube", () => {
  const quad = { props: "Power (range 800/3200), overheat 8, rapid 4" }, burstLaser = { props: "Power (range 200/800), auto, burst 1, overheat 2, saturate" };
  assert.deepEqual([SR.weaponModes(quad), SR.weaponModes(burstLaser), SR.weaponModes({ props: "" })], [["single", "rapid"], ["burst"], ["single"]], "auto weapons fire only in burst or rapid");
  assert.deepEqual([SR.shotCost(quad, "single"), SR.shotCost(quad, "rapid"), SR.shotCost(burstLaser, "burst")], [1, 4, 1]);
  assert.deepEqual([SR.heatCap(quad), SR.heatCap({ props: "" }), SR.reloadOf({ props: "Ammunition, reload 8" }), SR.reloadOf(quad)], [8, null, 8, null]);
  assert.equal(SR.attackBonusOf({ abilities: { str: 18, wis: 10 } }, burstLaser, 2), 6, "saturate: Strength +4 instead of Wisdom +0");
  assert.equal(SR.attackBonusOf({ abilities: { str: 18, wis: 10 } }, quad, 2), 2);
  const box = SR.burstBox({ x: 10, y: 10 }, 1);
  assert.deepEqual([SR.inBox(box, { x: 11, y: 11 }, 1), SR.inBox(box, { x: 12, y: 10 }, 1), SR.inBox(box, { x: 8, y: 8 }, 2)], [true, false, true], "a 3 x 3 square cube on the target");
});

test("weapon properties: dire, piercing and melt trade accuracy for damage; vicious; explosive asks for concentration saves", async () => {
  const w = { props: "Power (range 600/2400), dire 2, piercing 1, vicious 1, melt" };
  assert.deepEqual(SR.weaponTrade(w, { dire: 9 }, 3, "attack"), { atk: -2, dc: 0, dmg: 2, onFail: 0, notes: ["dire 2"] }, "capped at the weapon's number");
  assert.deepEqual(SR.weaponTrade(w, { piercing: 1, melt: true }, 3, "attack"), { atk: -2, dc: 0, dmg: 2, onFail: 0, notes: ["piercing 1", "melt 3"] });
  assert.deepEqual(SR.weaponTrade(w, { dire: 2, piercing: 1, melt: true }, 3, "save"), { atk: 0, dc: -3, dmg: 3, onFail: 0, notes: ["melt 3"] }, "dire and piercing are for attack rolls; melt lowers a save DC");
  assert.deepEqual(SR.weaponTrade({ props: "rapid 2" }, { dire: 2, melt: true }, 3, "attack").notes, [], "only what the weapon has");
  assert.deepEqual(SR.weaponTrade(w, { melt: "true" }, 3, "attack").notes, [], "melt is a real true");
  assert.deepEqual(["1d8[8]+2", "2d8[3,7]", "2d8kh1[~8~,3]", "2d6min3[2→3,6]"].map((d) => SR.viciousBonus(w, d)), [1, 0, 0, 1], "a top die, once a roll; struck dice don't count");
  assert.equal(SR.viciousBonus({ props: "dire 1" }, "1d8[8]"), 0);
  // on the server
  const { gm, p1, party, enemy } = await table();
  await p1.act("ship.save", { ship: Object.assign({}, shipIn(await p1.state(), party), { weapons: [
    { name: "Slug cannon", dmg: "1d8", type: "kinetic", range: "600/2400", props: "Power (range 600/2400), dire 2, vicious 1", cat: "primary", atkMisc: 20 },
    { name: "Needle gun", dmg: "1d8", type: "energy", range: "600/2400", props: "Power (range 600/2400), piercing 1", cat: "primary", atkMisc: 20 },
    { name: "Thermite torpedoes", dmg: "4d10", type: "fire", range: "1000/4000", props: "Ammunition, melt, explosive", cat: "tertiary", atkMisc: 20, ammo: 10 },
  ] }) });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 5, f: 2 });
  await gm.act("space.place", { id: enemy, x: 8, y: 5, f: 6 });
  // enough hull that no run of dice (a critical with dire and vicious, then the torpedo) takes it to 0 before the
  // explosive check: a ship at 0 hull takes no more hull damage, so there'd be no blast line (engineer7: a rare flake)
  await gm.act("ship.save", { ship: Object.assign({}, shipIn(await gm.state(), enemy), { hull: { current: 20, max: 100000 } }) });
  await gm.act("ship.points", { id: enemy, what: "hull", current: 100000 });
  let r, st;
  for (let i = 0; i < 6; i++) {   // until a hit (a natural 1 misses)
    r = await p1.act("space.fire", { id: party, target: enemy, weapon: 0, dire: 2 });
    assert.equal(r.code, 200);
    if (r.data.hit) break;
  }
  st = await p1.state();
  assert.ok(st.chat.some((m) => m.roll && m.roll.kind === "attack" && m.roll.expr === "1d20+20" && /\[dire 2\]/.test(m.roll.label)), "+22 less dire 2, and the label says so");
  if (r.data.hit) assert.ok(st.chat.some((m) => m.roll && m.roll.kind === "damage" && /\[(vicious \+1; )?dire 2: \+2\]/.test(m.roll.label)), "dire's 2 onto the damage");
  await p1.act("space.fire", { id: party, target: enemy, weapon: 1, piercing: 5 });
  assert.ok((await p1.state()).chat.some((m) => m.roll && m.roll.kind === "attack" && m.roll.expr === "1d20+23" && /\[piercing 1\]/.test(m.roll.label)), "piercing capped at 1");
  // melt on a weapon the target saves against: the DC drops by the proficiency bonus (2 with no crew), the damage gains it;
  // explosive: the enemy's crew save for concentration, a line for the GM only (it's the GM's ship)
  const n0 = (await gm.state()).chat.length;
  await p1.act("space.fire", { id: party, target: enemy, weapon: 2, melt: true });
  const gmNew = (await gm.state()).chat.slice(n0), pl = (await p1.state()).chat;
  assert.ok(pl.some((m) => /fires Thermite torpedoes at \?\?\?: a Dexterity save, DC 28 \[melt 2\]/.test(m.text || "")), "30 - 2");
  const blast = gmNew.find((m) => /The blast shakes Black Lance: anyone aboard keeping concentration makes a Constitution save, DC \d+/.test(m.text || ""));
  assert.ok(blast && blast.to && blast.to[0] === "@gm" && !blast.fromId, "the enemy's concentration line is the GM's");
  assert.ok(!pl.some((m) => /keeping concentration/.test(m.text || "")), "the player doesn't see it");
  // a shot between two GM ships on hidden tokens: every line the GM's, naming both ships (not "???")
  const g2 = (await gm.act("ship.save", { ship: { name: "Grey Wake", hidden: true, size: "Small", weapons: [{ name: "Gun", dmg: "1d4", type: "energy", range: "600/2400", cat: "primary" }] } })).data.id;
  await gm.act("space.token", { id: enemy, hidden: true });
  await gm.act("space.place", { id: g2, x: 4, y: 5, f: 2, hidden: true });
  await gm.act("space.fire", { id: g2, target: enemy, weapon: 0 });
  const shot = (await gm.state()).chat.filter((m) => /Grey Wake (misses|hits) Black Lance/.test(m.text || ""));
  assert.ok(shot.length === 1 && shot[0].to[0] === "@gm", "named for the GM, and the GM's only");
  assert.ok(!JSON.stringify((await p1.state()).chat).includes("Grey Wake"));
});

test("zone: on with an action, off for free; difficult terrain in its arc and normal range; advantage against tertiary from outside", async () => {
  const pd = { name: "Laser point-defense", dmg: "3d6", type: "energy", range: "300/1200", props: "Power (range 300/1200), saturate, zone", cat: "primary", arc: "forward" };
  const me = { weapons: [{ name: "Gun", dmg: "1d8" }, pd], status: { zones: [1, 0, 1, "__proto__", 99] } };
  assert.deepEqual(SR.statusOf(me).zones, [1, 0], "weapon indices, once each");
  assert.deepEqual(SR.zonesOf(me), [{ wi: 1, name: "Laser point-defense", arc: "forward", range: 300 }], "only weapons with zone");
  const zt = { x: 10, y: 10, f: 2 }, z = SR.zonesOf(me)[0];   // facing east
  assert.equal(SR.inZone(z, zt, 1, { x: 14, y: 10 }, 1), true, "ahead, 150 ft");
  assert.equal(SR.inZone(z, zt, 1, { x: 18, y: 10 }, 1), false, "ahead, past 300 ft");
  assert.equal(SR.inZone(z, zt, 1, { x: 6, y: 10 }, 1), false, "behind it");
  assert.equal(SR.zoneExtra(1, { x: 15, y: 1 }, { x: 15, y: 4 }, [{ z, tok: zt, sq: 1 }]), 0, "a path that stays outside");
  assert.ok(SR.zoneExtra(1, { x: 13, y: 6 }, { x: 13, y: 14 }, [{ z, tok: zt, sq: 1 }]) > 0, "a path through it costs more");
  assert.equal(SR.zoneExtra(1, { x: 12, y: 10 }, { x: 14, y: 10 }, [{ z, tok: zt, sq: 1 }]), 100, "all inside: each foot twice");
  // on the server
  const { gm, p1, p2, party, enemy } = await table();
  await gm.act("ship.save", { ship: Object.assign({}, shipIn(await gm.state(), enemy), { weapons: [pd] }) });
  await p1.act("ship.save", { ship: Object.assign({}, shipIn(await p1.state(), party), { speed: 1000, weapons: [
    { name: "Torpedoes", dmg: "2d10", type: "explosive", range: "1000/4000", props: "Ammunition", cat: "tertiary", ammo: 9, arc: "forward" }] }) });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 10, f: 2 });
  await gm.act("space.place", { id: enemy, x: 12, y: 10, f: 6 });   // facing west, at the party
  await gm.act("space.init", {});
  if ((await gm.state()).space.turnId === party) await gm.act("space.next", {});
  assert.equal((await gm.act("space.zone", { id: enemy, weapon: 0, on: "yes" })).code, 200, "not a real true: nothing switched on");
  assert.deepEqual(shipIn(await gm.state(), enemy).status.zones, []);
  assert.equal((await gm.act("space.zone", { id: enemy, weapon: 0, on: true })).code, 200);
  assert.equal((await p1.act("space.zone", { id: enemy, weapon: 0, on: false })).code, 403, "the GM's ship");
  assert.equal((await p1.act("space.zone", { id: party, weapon: 0, on: true })).code, 400, "no zone on torpedoes");
  let st = await p1.state();
  assert.deepEqual(st.space.tok.find((t) => t.id === enemy).zones, [{ arc: "forward", range: 300 }], "the player's map shows where the zone is");
  assert.ok(!JSON.stringify(st).includes("Black Lance"), "and still not whose");
  await gm.act("space.next", {});
  assert.equal((await gm.state()).space.turnId, party);
  // the party flies 300 ft east: its last three squares are within 300 ft ahead of the enemy, so they cost twice
  await p1.act("space.place", { id: party, x: 8, y: 10, f: 2 });
  assert.equal((await p1.state()).space.moved[party], 300 + 150, "300 ft, 150 of them through difficult terrain");
  // torpedoes from inside the zone's range: no advantage; from outside: the enemy saves with advantage
  await p1.act("space.fire", { id: party, target: enemy, weapon: 0 });
  assert.ok(!(await gm.state()).chat.some((m) => /launched outside its zone/.test(m.text || "")), "inside its range");
  await p1.act("space.place", { id: party, x: 2, y: 10, f: 2 });
  await p1.act("space.fire", { id: party, target: enemy, weapon: 0 });
  const save = (await gm.state()).chat.filter((m) => m.roll && /Dexterity save/.test(m.roll.label)).pop();
  assert.ok((await p1.state()).chat.some((m) => /a Dexterity save, DC \d+ \[launched outside its zone\]/.test(m.text || "")));
  assert.ok(!JSON.stringify((await p1.state()).chat).includes("Laser point-defense"), "nor which weapon the enemy has");
  assert.match(save.roll.expr, /^2d20kh1/, "advantage");
  // a hidden token's zone isn't difficult terrain for anyone; switching off is free, on anyone's turn
  await gm.act("space.token", { id: enemy, hidden: true });
  const m0 = (await p1.state()).space.moved[party];
  await p1.act("space.place", { id: party, x: 8, y: 10, f: 2 });
  assert.equal((await p1.state()).space.moved[party] - m0, 300);
  assert.equal((await gm.act("space.zone", { id: enemy, weapon: 0, on: false })).code, 200);
  assert.deepEqual(shipIn(await gm.state(), enemy).status.zones, []);
  assert.ok(!(await p2.state()).chat.some((m) => /switches (on|off)/.test(m.text || "")), "the GM ship's zone lines are the GM's");
  assert.ok((await gm.state()).chat.some((m) => /Black Lance switches off Laser point-defense's zone/.test(m.text || "") && m.to[0] === "@gm"));
});

test("tertiary ammunition: a launcher fires its round (damage by size), reload by size, a natural 1 on the save takes the maximum", async () => {
  const L = { name: "Torpedo launcher", cat: "tertiary", props: "Ammunition reload 4", dmg: "", load: "Proton torpedo" };
  const small = SR.loadedWeapon({ size: "Small" }, L), huge = SR.loadedWeapon({ size: "Huge" }, L);
  assert.deepEqual([small.dmg, small.type, small.range, huge.dmg], ["2d10", "energy", "1200/4800", "4d10"], "SotG's table, the bracketed number for Huge");
  assert.deepEqual([SR.weaponProp(small, "keen"), SR.weaponProp(small, "explosive"), SR.weaponProp(small, "reload")], [1, true, 4], "the round's properties and the launcher's own");
  assert.equal(SR.loadedWeapon({ size: "Small" }, Object.assign({}, L, { load: "Cluster missile" })).dmg, "", "a torpedo launcher doesn't take cluster missiles");
  assert.deepEqual(SR.ammoFor({ name: "Assault cluster pod launcher" }), ["Adv. cluster missile", "Adv. homing cluster missile", "Cluster missile", "Homing cluster missile", "Nano cluster rocket"]);
  assert.deepEqual(["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"].map((size) => SR.reloadFor({ size }, { cat: "tertiary", props: "Ammunition, reload 12" })), [6, 12, 24, 48, 12, 24], "SotG's scaling");
  assert.equal(SR.reloadFor({ size: "Large" }, { cat: "primary", props: "reload 4" }), 4, "only tertiary and quaternary weapons scale");
  assert.deepEqual([SR.maxOf("2d10"), SR.maxOf("4d12+3"), SR.maxOf("")], [20, 51, 0]);
  // on the server
  const { gm, p1, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { size: "Medium", weapons: [{ name: "Torpedo launcher", dmg: "", type: "", range: "", props: "Ammunition reload 4", cat: "tertiary", ammo: 999, load: "__proto__" }] }) });
  sh = shipIn(await p1.state(), party);
  assert.equal(sh.weapons[0].load, "", "only a round from the table");
  await gm.act("ship.save", { ship: Object.assign({}, shipIn(await gm.state(), enemy), { size: "Medium", hull: { current: 20, max: 100000 } }) });
  await gm.act("ship.points", { id: enemy, what: "hull", current: 100000 });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 5, f: 2 });
  await gm.act("space.place", { id: enemy, x: 8, y: 5, f: 6 });
  assert.match((await p1.act("space.fire", { id: party, target: enemy, weapon: 0 })).data.error || "", /no round loaded/);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { weapons: [Object.assign({}, sh.weapons[0], { load: "Proton torpedo" })] }) });
  let found = false;
  for (let i = 0; i < 200 && !found; i++) {
    const r = await p1.act("space.fire", { id: party, target: enemy, weapon: 0 });
    assert.equal(r.code, 200);
    found = (await gm.state()).chat.some((m) => /A natural 1 on the save: the damage counts as its maximum, 20\./.test(m.text || ""));
  }
  const st = await gm.state();
  assert.ok(st.chat.some((m) => m.roll && m.roll.kind === "damage" && m.roll.expr === "2d10"), "a proton torpedo from a Medium ship: 2d10");
  assert.ok(found, "a natural 1 on the save: 20, the most 2d10 can roll");
  // reload: 4 for a Small ship's launcher, twice that on a Medium one
  assert.equal((await p1.act("ship.reload", { id: party, weapon: 0 })).code, 200);
  assert.equal(shipIn(await p1.state(), party).weapons[0].ammo, 8);
});

test("ventures, gunning styles and masteries (SotG ch. 6): picks by rank, their effects on Fire, multispecializing", async () => {
  const g = { deployment: "Gunner", rank: 4, styles: ["Cannoneer", "Heavy Gunner", "Payload Delivery"], masteries: ["Payload Mastery", "Cannon Mastery"], ventures: ["Gunning Stylist", "Keen Eye"] };
  assert.deepEqual(SR.gunningAllowed(g), { styles: 3, masteries: 1 }, "2nd and 4th rank, and a Gunning Stylist venture");
  assert.deepEqual([SR.activeStyles(g).length, SR.activeMasteries(g)], [3, ["Payload Mastery"]], "first picked first");
  assert.deepEqual(SR.gunningAllowed({ deployment: "Pilot", rank: 5, ventures: ["Gunning Mastery"] }), { styles: 0, masteries: 1 }, "a venture gives a pilot a mastery");
  assert.equal(SR.venturesAllowed({ rank: 3 }), 3);
  assert.deepEqual(SR.cleanGunning({ ventures: ["A", "A", "Gunning Mastery", "Gunning Mastery"], styles: ["Cannoneer", "__proto__", "Cannoneer"], masteries: "x" }),
    { ventures: ["A", "Gunning Mastery", "Gunning Mastery"], styles: ["Cannoneer"], masteries: [] }, "only SotG's styles; only the two repeatable ventures repeat");
  const can = { deployment: "Gunner", rank: 4, styles: ["Cannoneer"], masteries: ["Cannon Mastery"] };
  assert.deepEqual(SR.weaponTrade({ cat: "primary" }, {}, 3, "attack", can), { atk: 0, dc: 0, dmg: 2, onFail: 0, notes: ["cannoneer"] }, "Cannoneer: +2 damage");
  assert.deepEqual(SR.weaponTrade({ cat: "primary", props: "melt" }, { mastery: true, melt: true }, 3, "attack", can).atk, -3, "the proficiency bonus is forgone only once");
  assert.deepEqual(SR.weaponTrade({ cat: "secondary" }, { mastery: true }, 3, "attack", { deployment: "Gunner", rank: 4, styles: ["Heavy Gunner"], masteries: ["Heavy Gun Mastery"] }),
    { atk: 5, dc: 0, dmg: -3, onFail: 0, notes: ["heavy gunner", "heavy gun mastery"] });
  assert.deepEqual(SR.weaponTrade({ cat: "tertiary" }, { mastery: true }, 3, "save", g), { atk: 0, dc: -3, dmg: 0, onFail: 6, notes: ["payload mastery"] });
  assert.deepEqual(SR.weaponTrade({ cat: "tertiary" }, { mastery: true }, 3, "save", { deployment: "Gunner", rank: 2, masteries: ["Payload Mastery"] }).notes, [], "a mastery takes 4th rank");
  assert.deepEqual(SR.lowDice("3d4[1,4,~2~]+2"), [{ sides: 4, v: 1 }], "struck dice don't count");
  assert.deepEqual(SR.multispec({ crew: [{ charId: "abc123", deployment: "Pilot", rank: 2 }, { charId: "abc123", deployment: "Gunner", rank: 1 }] }, { charId: "abc123" }).rank, 3, "pilot 2 / gunner 1: 3rd rank");
  // on the server: the picks are stored, cleaned; the gunner's Payload Mastery and Payload Delivery reach the shot
  const { gm, p1, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { crew: [{ name: "Ione", deployment: "Gunner", rank: 4, pb: 3, ventures: ["Keen Eye", "Keen Eye", "Gunning Stylist"], styles: ["Payload Delivery", "nope"], masteries: ["Payload Mastery"] }],
    weapons: [{ name: "Missiles", dmg: "20d4", type: "kinetic", range: "1000/4000", props: "Ammunition", cat: "tertiary", ammo: 99 }] }) });
  sh = shipIn(await p1.state(), party);
  assert.deepEqual([sh.crew[0].ventures, sh.crew[0].styles, sh.crew[0].masteries], [["Keen Eye", "Gunning Stylist"], ["Payload Delivery"], ["Payload Mastery"]]);
  await gm.act("ship.save", { ship: Object.assign({}, shipIn(await gm.state(), enemy), { hull: { current: 20, max: 100000 } }) });
  await gm.act("ship.points", { id: enemy, what: "hull", current: 100000 });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 5, f: 2 });
  await gm.act("space.place", { id: enemy, x: 8, y: 5, f: 6 });
  const r = await p1.act("space.fire", { id: party, target: enemy, weapon: 0, crew: 0, mastery: true });
  assert.equal(r.code, 200);
  const st = await p1.state();
  const dc = 8 + 3 + 0 - 3;   // 8 + the gunner's 3 + Wisdom 0, less 3 for Payload Mastery
  assert.ok(st.chat.some((m) => new RegExp(`a Dexterity save, DC ${dc} \\[payload mastery\\]`).test(m.text || "")), "the DC is lowered");
  const dmg = st.chat.filter((m) => m.roll && m.roll.kind === "damage").pop();
  assert.match(dmg.roll.label, /payload delivery: \d+ rolled again/, "twenty d4s: some showed 1 or 2 and were rolled again");
  if (!r.data.saved) assert.ok(st.chat.some((m) => /fails: \d+ kinetic damage/.test(m.text || "")));
});

test("space.fire modes on the server: rapid, a burst over three ships, heat and Cool, ammunition and Reload", async () => {
  const { gm, p1, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { weapons: [
    { name: "Quad laser", dmg: "1d4", type: "energy", range: "800/3200", props: "Power (range 800/3200), overheat 6, rapid 4", cat: "primary", atkMisc: 20 },
    { name: "Burst laser", dmg: "1d4", type: "energy", range: "200/800", props: "auto, burst 1, overheat 2", cat: "primary", atkMisc: 20 },
    { name: "Missiles", dmg: "1d4", type: "kinetic", range: "1000/4000", props: "Ammunition, reload 3, rapid 2", cat: "tertiary", atkMisc: 20, ammo: 3 },
  ] }) });
  const third = (await gm.act("ship.save", { ship: { name: "Grey Wake", hidden: true, hull: { current: 20, max: 20 } } })).data.id;
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 5, f: 2 });
  await gm.act("space.place", { id: enemy, x: 8, y: 5, f: 6 });
  await gm.act("space.place", { id: third, x: 9, y: 6, f: 6 });   // in the cube on the enemy
  // rapid: one target, a save at DC 8 + 22 = 30, the damage dice twice; 4 shots of heat
  let r = await p1.act("space.fire", { id: party, target: enemy, weapon: 0, fireMode: "rapid" });
  assert.equal(r.code, 200); assert.equal(r.data.mode, "rapid"); assert.equal(r.data.ships.length, 1);
  let st = await p1.state();
  assert.ok(st.chat.some((m) => /Dawn Skiff fires Quad laser in rapid mode at \?\?\?: a Dexterity save, DC 30/.test(m.text || "")));
  assert.ok(st.chat.some((m) => m.roll && m.roll.kind === "damage" && m.roll.expr === "2d4"), "the dice twice");
  assert.equal(shipIn(st, party).weapons[0].heat, 4);
  assert.equal((await p1.act("space.fire", { id: party, target: enemy, weapon: 0, fireMode: "rapid" })).code, 400, "4 + 4 is past overheat 6");
  assert.equal((await p1.act("space.fire", { id: party, target: enemy, weapon: 0, fireMode: "single" })).code, 200, "a single shot still fits");
  assert.equal(shipIn(await p1.state(), party).weapons[0].heat, 5);
  assert.equal((await p1.act("ship.cool", { id: party, weapon: 0 })).code, 200);
  assert.equal(shipIn(await p1.state(), party).weapons[0].heat, 0, "cooled");
  assert.equal((await p1.act("ship.cool", { id: party, weapon: 0 })).code, 400, "nothing to cool");
  // burst: auto, so burst whatever the request says; every ship in the cube saves
  r = await p1.act("space.fire", { id: party, target: enemy, weapon: 1, fireMode: "single" });
  assert.equal(r.code, 200); assert.equal(r.data.mode, "burst"); assert.equal(r.data.ships.length, 2, "the enemy and the ship beside it");
  assert.ok(!JSON.stringify((await p1.state()).chat).match(/Black Lance|Grey Wake/), "neither enemy is named to the players");
  // ammunition: rapid 2 takes two rounds; then one left is too few; Reload fills it to 3
  r = await p1.act("space.fire", { id: party, target: enemy, weapon: 2, fireMode: "rapid" });
  assert.equal(r.code, 200);
  assert.equal(shipIn(await p1.state(), party).weapons[2].ammo, 1);
  assert.equal((await p1.act("space.fire", { id: party, target: enemy, weapon: 2, fireMode: "rapid" })).code, 400, "1 round left, rapid takes 2");
  assert.equal((await p1.act("ship.reload", { id: party, weapon: 2 })).code, 200);
  assert.equal(shipIn(await p1.state(), party).weapons[2].ammo, 3);
  assert.equal((await p1.act("ship.reload", { id: party, weapon: 0 })).code, 400, "a power weapon doesn't reload");
  for (const w of ["__proto__", -1, 9]) assert.equal((await p1.act("ship.cool", { id: party, weapon: w })).code, 400);
  assert.equal((await p1.act("ship.cool", { id: enemy, weapon: 0 })).code, 403);
});

test("burst over a hidden token, and Cool and Reload on the ship's own turn", async () => {
  const { gm, p1, p2, party, enemy } = await table();
  const ambush = (await gm.act("ship.save", { ship: { name: "Grey Wake", hidden: true, hull: { current: 20, max: 20 } } })).data.id;
  const sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { weapons: [{ name: "Burst laser", dmg: "1d4", type: "energy", range: "200/800", props: "auto, burst 1, overheat 2", cat: "primary", atkMisc: 20 },
    { name: "Missiles", dmg: "1d4", type: "kinetic", range: "1000/4000", props: "Ammunition, reload 3", cat: "tertiary", ammo: 0 }] }) });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 5, f: 2 });
  await gm.act("space.place", { id: enemy, x: 6, y: 5, f: 6 });
  await gm.act("space.place", { id: ambush, x: 7, y: 6, f: 6, hidden: true });   // in the cube, off the players' map
  const before = (await p2.state()).chat.length;
  const r = await p1.act("space.fire", { id: party, target: enemy, weapon: 0 });
  assert.equal(r.code, 200); assert.equal(r.data.ships.length, 1, "the response to the player lists only the ship they can see");
  assert.ok(shipIn(await gm.state(), ambush).hull.current < 20 || (await gm.state()).chat.some((m) => /Grey Wake: Dexterity save/.test((m.roll || {}).label || "")), "but the burst caught the unseen ship too");
  const seen = (await p2.state()).chat.slice(before);
  assert.equal(seen.filter((m) => /saves|fails/.test(m.text || "")).length, 1, "players read one ship's result: the one they can see");
  assert.ok(!JSON.stringify(seen).includes("Grey Wake"));
  // Cool and Reload in ship combat: on the ship's own turn
  await gm.act("space.init", {});
  if ((await gm.state()).space.turnId === party) await gm.act("space.next", {});
  assert.match((await p1.act("ship.cool", { id: party, weapon: 0 })).data.error || "", /Not Dawn Skiff's turn/);
  assert.match((await p1.act("ship.reload", { id: party, weapon: 1 })).data.error || "", /Not Dawn Skiff's turn/);
  while ((await gm.state()).space.turnId !== party) await gm.act("space.next", {});
  assert.equal((await p1.act("ship.cool", { id: party, weapon: 0 })).code, 200);
});

// ---------------------------------------------------------------- recharging and refitting (10.8)
test("recharging and refitting: shields and half the shield dice; hull dice by the mechanic's check; a refit's cost, time and system damage", async () => {
  const s = ship({ size: "Medium", hull: { current: 10, max: 40 }, shield: { current: 0, max: 30 }, abilities: { con: 14 }, status: { sdUsed: 5, hdUsed: 2, system: 2 } });
  let r = SR.recharge(s);
  assert.deepEqual([r.ship.shield.current, SR.statusOf(r.ship).sdUsed, SR.statusOf(r.ship).recharged], [30, 3, true], "5 shield dice for a Medium ship: 2 back");
  assert.equal(SR.rechargeHullDie(s, 15, () => ({ total: 5 })).done, false, "not before a recharge");
  const seq = (...v) => () => ({ total: v.shift() });
  assert.equal(SR.rechargeHullDie(r.ship, 8, seq(6, 2)).gain, 4, "10 or less: the lower of two, + Con 2");
  assert.equal(SR.rechargeHullDie(r.ship, 15, seq(6, 2)).gain, 8, "11 to 20: one roll");
  assert.equal(SR.rechargeHullDie(r.ship, 25, seq(3, 7)).gain, 9, "21 or more: the higher of two");
  assert.equal(SR.statusOf(SR.takeDamage(r.ship, 1, "energy").ship).recharged, false, "a hit ends the quiet");
  assert.equal(SR.refitCost(s), 400, "2 missing hull dice x 100 x Medium's 2");
  const f = SR.refit(s);
  assert.deepEqual([f.ship.hull.current, f.ship.shield.current, SR.statusOf(f.ship).system, SR.statusOf(f.ship).hdUsed, SR.statusOf(f.ship).sdUsed], [40, 30, 1, 0, 0]);
  assert.match(f.log[0], /1 day, a crew of 5, 400 cr/);
  assert.equal(SR.statusOf(SR.refit(SR.setCondition(s, "system", 6)).ship).system, 5, "a refit repairs failed primary systems");
  // on the server: the check comes from the crew's sheet
  const { gm, p1, party, enemy } = await table();
  await p1.act("ship.damage", { id: party, amount: 20, type: "kinetic" });
  assert.equal((await p1.act("ship.hulldie", { id: party })).code, 400, "recharge first");
  assert.equal((await p1.act("ship.recharge", { id: party })).code, 200);
  let st = await p1.state();
  assert.equal(shipIn(st, party).shield.current, 20);
  assert.equal((await p1.act("ship.hulldie", { id: party, bonus: 99 })).code, 200);
  st = await p1.state();
  assert.ok(st.chat.some((m) => m.roll && /mechanic's kit/.test(m.roll.label) && m.roll.expr === "1d20+2"), "no crew sheet: +2, not the request's");
  const r2 = await p1.act("ship.refit", { id: party });
  assert.equal(r2.code, 200); assert.equal(typeof r2.data.cost, "number");
  assert.equal(shipIn(await p1.state(), party).hull.current, 40);
  assert.equal((await p1.act("ship.refit", { id: enemy })).code, 403);
  // not in the middle of a ship fight (the GM stays free)
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.init", {});
  for (const t of ["ship.recharge", "ship.refit", "ship.hulldie"]) assert.match((await p1.act(t, { id: party })).data.error || "", /Not during ship combat/, t);
  await gm.act("space.end", {});
  assert.equal((await p1.act("ship.recharge", { id: party })).code, 200, "once it's over");
  await gm.act("ship.recharge", { id: enemy });
  assert.ok(!JSON.stringify((await p1.state()).chat).includes("Black Lance"), "an enemy's recharge is the GM's");
});

// ---------------------------------------------------------------- modifications (10.13)
test("modifications: slots against capacity, suites, the installation DC by grade and tier, cost, prerequisites", async () => {
  const mods = [{ name: "Hardpoint", type: "Weapon" }, { name: "Hardpoint", type: "Weapon" }, { name: "Broadside Mounting", type: "Weapon", grade: 2, pre: "Two Hardpoints" },
    { name: "Automated Protocols", type: "Universal", grade: 1, pre: "Damage Control System" }, { name: "Boarding Pods", type: "Suite", pre: "Ship size Large or larger" },
    { name: "Blinding Rounds", type: "Weapon", pre: "Weapon that deals fire damage" }, { name: "Barracks", type: "Suite", free: true }];
  const s = { size: "Small", tier: 0, abilities: { con: 14 }, mods };
  assert.deepEqual(SR.modsSummary(s), { used: 6, cap: 20, over: 0, suites: 1, suiteMax: 1 }, "a tier feature's modification takes no slot and isn't counted as a suite");
  assert.deepEqual(mods.map((m, i) => SR.installDC(s, i)), [10, 10, 24, 17, 10, 10, 10], "the grade and tier table");
  assert.equal(SR.installDC(Object.assign({}, s, { tier: 3 }), 2), 13);
  assert.deepEqual([SR.modCost(s, mods[0]), SR.modCost(s, mods[2]), SR.modCost({ size: "Huge" }, mods[0])], [3000, 6000, 150000], "SotG's own: a hardpoint is 3,000 on a Small ship, 150,000 on a Huge one");
  assert.deepEqual(mods.slice(2, 6).map((m) => SR.prereqs(s, m)[0].ok), [true, false, false, null]);
  const tiny = { size: "Tiny", tier: 0, mods: Array.from({ length: 12 }, (_, i) => ({ name: "M" + i, type: "Universal" })) };
  assert.deepEqual(SR.modsSummary(tiny), { used: 12, cap: 10, over: 2, suites: 0, suiteMax: 0 });
  assert.deepEqual([SR.installDC(tiny, 9), SR.installDC(tiny, 10), SR.installDC(tiny, 11)], [10, 12, 14], "each one past capacity: 2 more, cumulative (Tiny to Medium)");
  const large = { size: "Large", tier: 0, mods: Array.from({ length: 52 }, (_, i) => ({ name: "M" + i, type: "Universal" })) };
  assert.deepEqual([SR.installDC(large, 49), SR.installDC(large, 50), SR.installDC(large, 51)], [10, 11, 12], "Large to Gargantuan: 1 more, cumulative");
  assert.deepEqual([SR.modCost(tiny, tiny.mods[9], 9), SR.modCost(tiny, tiny.mods[10], 10), SR.modCost(large, large.mods[51], 51)], [2000, 3000, 30000],
    "a slot added past capacity: 50% more on the category's base (Universal 4,000 x Tiny's 0.5; x Large's 5)");
  // on the server: the fields are kept, cleaned; the check comes from the sheet
  const { gm, p1, party, enemy } = await table();
  const sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { mods: [{ name: "Hardpoint", type: "Weapon", grade: 9, pre: "x".repeat(500), free: "yes" }, { name: "Odd", type: "__proto__" }] }) });
  const m = shipIn(await p1.state(), party).mods;
  assert.deepEqual([m[0].type, m[0].grade, m[0].pre.length, m[0].free, m[1].type], ["Weapon", 5, 200, false, ""]);
  const r = await p1.act("ship.install", { id: party, mod: 0, bonus: 99 });
  assert.equal(r.code, 200); assert.equal(r.data.dc, 45, "grade 5 at tier 0");
  assert.ok((await p1.state()).chat.some((x) => x.roll && /installing Hardpoint \(DC 45\)/.test(x.roll.label) && x.roll.expr === "1d20+2"));
  for (const bad of ["__proto__", -1, 5]) assert.equal((await p1.act("ship.install", { id: party, mod: bad })).code, 400);
  assert.equal((await p1.act("ship.install", { id: enemy, mod: 0 })).code, 403);
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.init", {});
  assert.match((await p1.act("ship.install", { id: party, mod: 0 })).data.error || "", /Not during ship combat/, "days of work: not mid-fight");
});

// ---------------------------------------------------------------- travel (10.16)
test("travel: hyperspace times by region and class, rushing and care, fuel by reactor, equations, mishaps", async () => {
  const c2 = { hyper: "Class 2", reactor: "Power Core" };
  assert.deepEqual([SR.hyperClass(c2), SR.hyperClass({ hyper: ".5" }), SR.hyperClass({ hyper: "" })], [2, 0.5, null]);
  assert.equal(SR.hyperClass({ hyper: "", equipment: [{ name: "Class 3 Hyperdrive", notes: "Hyperdrive · class 3" }] }), 3, "from a hyperdrive picked from SotG's equipment");
  assert.equal(SR.jumpHours(c2, "Core", "Outer Rim", 0, false), 192, "96 hours with a class 1 drive, twice that with class 2");
  assert.equal(SR.jumpHours(c2, "Core", "Outer Rim", 2, false), 144, "each rush takes a day off");
  assert.equal(SR.jumpHours({ hyper: "1" }, "Core", "Core", 1, false), 3, "under a day: half of what's left");
  assert.equal(SR.jumpHours({ hyper: "1" }, "Core", "Core", 0, true), 12, "careful: twice as long");
  assert.equal(SR.jumpHours({ hyper: "1" }, "Core", "Atlantis", 0, false), null);
  assert.equal(SR.jumpFuel(c2, 192), 14, "1 for the jump + 8 days, x1.5 for a power core");
  assert.equal(SR.jumpFuel({ reactor: "Ionization" }, 30), 2, "1 + 2 days, x0.5");
  assert.deepEqual([9, 10, 16, 21, 26, 30].map(SR.stepsFor), [0, 1, 2, 3, 4, 5]);
  assert.match(SR.mishapFor(20), /no adverse/); assert.match(SR.mishapFor(4), /debris/); assert.match(SR.mishapFor(1), /hyperdrive failure/);
  // on the server
  const { gm, p1, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { hyper: "1", fuel: "20", reactor: "Fuel Cell" }) });
  assert.equal((await p1.act("ship.jump", { id: party, from: "Core", to: "Narnia" })).code, 400);
  let r = await p1.act("ship.astro", { id: party, age: "fresh", bonus: 99 });
  assert.equal(r.code, 200);
  let st = await p1.state();
  assert.ok(st.chat.some((m) => m.roll && /astrogation \[data under a day old\]/.test(m.roll.label) && m.roll.expr === "2d20kh1+0"), "the sheet's bonus (Int 10, no proficiency), advantage for fresh data");
  assert.equal(shipIn(st, party).status.astro, r.data.done);
  await p1.act("ship.plot", { id: party });
  assert.equal(shipIn(await p1.state(), party).status.astro, 10);
  r = await p1.act("ship.jump", { id: party, from: "Core", to: "Mid Rim" });
  assert.deepEqual([r.code, r.data.hours, r.data.fuel], [200, 84, 5], "84 hours: 1 + 4 days of fuel");
  sh = shipIn(await p1.state(), party);
  assert.deepEqual([sh.fuel, sh.status.astro], ["15", 0], "the fuel is spent and the course used");
  r = await p1.act("ship.jump", { id: party, from: "Mid Rim", to: "Outer Rim", rush: 1 });
  assert.equal(r.code, 200);
  assert.ok((await p1.state()).chat.some((m) => /Rushed with 0 of 10 equations: mishap roll/.test(m.text || "")), "a rushed jump rolls a mishap");
  await p1.act("ship.save", { ship: Object.assign({}, shipIn(await p1.state(), party), { fuel: "1" }) });
  assert.equal((await p1.act("ship.jump", { id: party, from: "Core", to: "Wild Space" })).code, 400, "not enough fuel");
  // the course choice holds from the first check to the jump: careful checks, then a jump asking for a rush, keep careful
  await p1.act("ship.save", { ship: Object.assign({}, shipIn(await p1.state(), party), { fuel: "100" }) });
  r = await p1.act("ship.astro", { id: party, careful: true });
  let cst = shipIn(await p1.state(), party).status;
  assert.deepEqual(cst.course, { rush: 0, careful: true });
  assert.ok((await p1.state()).chat.some((m) => m.roll && /astrogation \[careful \(\+5\)\]/.test(m.roll.label)), "the claim is in the label");
  if (cst.astro > 0) {
    r = await p1.act("ship.astro", { id: party, rush: 3 });   // a different choice: the calculations start over
    assert.ok((await p1.state()).chat.some((m) => /changed its course choice: the calculations start over/.test(m.text || "")));
    cst = shipIn(await p1.state(), party).status;
    assert.deepEqual(cst.course, { rush: 3, careful: false }); assert.equal(cst.astro, r.data.steps, "only this check's equations count");
  }
  if (shipIn(await p1.state(), party).status.astro > 0) {
    r = await p1.act("ship.jump", { id: party, from: "Core", to: "Outer Rim", rush: 0, careful: true });
    assert.equal(r.data.hours, 24, "the jump keeps the rush 3 the equations were worked for (96 - 72), not the request's careful");
  }
  await p1.act("ship.plot", { id: party });
  r = await p1.act("ship.jump", { id: party, from: "Core", to: "Outer Rim", rush: 3 });
  assert.equal(r.data.hours, 96, "a course plotted with care is a normal one: the request's rush doesn't apply");
  r = await p1.act("ship.startup", { id: party, crewSize: "half" });
  assert.equal(r.code, 200);
  assert.ok((await p1.state()).chat.some((m) => m.roll && /emergency start-up \[half the crew \(-5\)/.test(m.roll.label) && /-5$/.test(m.roll.expr)), "half the crew: -5, and the label says so");
  assert.equal((await p1.act("ship.astro", { id: enemy })).code, 403);
  // in ship combat: astrogation, start-up and the jump on the ship's own turn; no careful plotting mid-fight
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.place", { id: enemy, x: 9, y: 2, f: 6 });
  await gm.act("space.init", {});
  if ((await gm.state()).space.turnId === party) await gm.act("space.next", {});
  for (const t of ["ship.astro", "ship.startup", "ship.jump"]) assert.match((await p1.act(t, { id: party, from: "Core", to: "Core" })).data.error || "", /Not Dawn Skiff's turn/, t);
  assert.match((await p1.act("ship.plot", { id: party })).data.error || "", /Not during ship combat/);
  await gm.act("space.next", {});
  assert.equal((await p1.act("ship.astro", { id: party })).code, 200, "on its own turn");
});

test("realspace: pace (speed, Probe and Scan), sample times, fuel by the day or the hour; GM-only for a hidden ship; not mid-fight", async () => {
  const fast = { speed: 300, status: { pace: "fast" } }, slow = { speed: 300, status: { pace: "slow" } };
  assert.deepEqual([SR.travelSpeed(fast), SR.travelSpeed(slow), SR.travelSpeed({ speed: 300 })], [600, 150, 300], "fast doubles, slow halves");
  assert.equal(SR.statusOf({ status: { pace: "__proto__" } }).pace, "normal", "only the three paces");
  assert.deepEqual(SR.rollEffects(fast, "check", "wis", "scan").dis, ["Fast pace"]);
  assert.deepEqual(SR.rollEffects(fast, "check", "int", "probe").dis, ["Fast pace"]);
  assert.deepEqual(SR.rollEffects(fast, "check", "int", "data").dis, [], "only Probe and Scan");
  assert.deepEqual(SR.rollEffects(slow, "check", "wis", "scan").dis, []);
  assert.deepEqual(SR.REALSPACE_TIMES.map((r) => SR.realspaceTime(r, "normal")), ["1 to 5 minutes", "1 minute", "10 to 30 minutes", "2 to 6 hours", "12 to 24 hours"], "SotG's sample table");
  assert.equal(SR.realspaceTime(SR.REALSPACE_TIMES[0], "fast"), "30 seconds to 2.5 minutes");
  assert.equal(SR.realspaceTime(SR.REALSPACE_TIMES[4], "slow"), "24 to 48 hours");
  assert.deepEqual([SR.flyFuel({ reactor: "Fuel Cell" }, 3), SR.flyFuel({ reactor: "Ionization" }, 3), SR.flyFuel({ reactor: "Power Core" }, 2)], [3, 1.5, 3], "a unit a day, times the reactor's use");
  // on the server
  const { gm, p1, party, enemy } = await table();
  await p1.act("ship.save", { ship: Object.assign({}, shipIn(await p1.state(), party), { fuel: "10", reactor: "Ionization" }) });
  assert.equal((await p1.act("ship.pace", { id: party, pace: "constructor" })).code, 400);
  assert.equal((await p1.act("ship.pace", { id: party, pace: "fast" })).code, 200);
  let st = await p1.state();
  assert.equal(shipIn(st, party).status.pace, "fast");
  assert.ok(st.chat.some((m) => /Dawn Skiff travels at a fast pace: speed \d+ ft; disadvantage on Probe and Scan/.test(m.text || "")));
  await p1.act("ship.save", { ship: Object.assign({}, shipIn(await p1.state(), party), { status: { pace: "slow" } }) });
  assert.equal(shipIn(await p1.state(), party).status.pace, "fast", "a sheet save keeps the stored pace");
  let r = await p1.act("ship.fly", { id: party, where: "realspace", n: 4 });
  assert.deepEqual([r.code, r.data.fuel], [200, 2], "4 days x0.5 for an ionization reactor");
  st = await p1.state();
  assert.equal(shipIn(st, party).fuel, "8");
  assert.ok(st.chat.some((m) => /flies 4 days in realspace: 2 units of fuel, 8 left/.test(m.text || "")));
  r = await p1.act("ship.fly", { id: party, where: "atmosphere", n: 3 });
  assert.equal(shipIn(await p1.state(), party).fuel, "6.5", "an hour in atmosphere is a unit");
  assert.equal((await p1.act("ship.fly", { id: party, n: 20 })).code, 400, "not enough fuel");
  assert.equal((await p1.act("ship.pace", { id: enemy, pace: "slow" })).code, 403);
  // a hidden ship's travel lines reach the GM only
  const n0 = (await gm.state()).chat.length;
  await gm.act("ship.pace", { id: enemy, pace: "slow" }); await gm.act("ship.fly", { id: enemy, n: 1 });
  const lines = (await gm.state()).chat.slice(n0);
  assert.equal(lines.length, 2);
  assert.ok(lines.every((m) => m.to && m.to.length === 1 && m.to[0] === "@gm" && !m.fromId));
  assert.ok(!(await p1.state()).chat.some((m) => /slow pace|flies 1 day/.test(m.text || "")), "the player sees neither");
  // ship combat: travel waits for players; rolling initiative puts every ship on the map back to a normal pace
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.place", { id: enemy, x: 9, y: 2, f: 6 });
  await gm.act("space.init", {});
  st = await gm.state();
  assert.deepEqual([shipIn(st, party).status.pace, shipIn(st, enemy).status.pace], ["normal", "normal"]);
  for (const t of ["ship.pace", "ship.fly"]) assert.match((await p1.act(t, { id: party, pace: "fast", n: 1 })).data.error || "", /Not during ship combat/, t);
});

// ---------------------------------------------------------------- buying, building, upgrading, docking, crew (10.17)
test("costs: SotG's own figures for buying, building, upgrading, docking and the minimum crew", () => {
  let c = SR.costs({ size: "Small", tier: 0 });
  assert.deepEqual([c.stock, c.bankDown, c.bankMonthly, c.build, c.buildDays[0], c.nextTier], [25000, 5000, 500, 12500, 10, 3900], "SotG: a Small ship is 25,000 cr; tier 1 costs 3,900");
  c = SR.costs({ size: "Huge", tier: 2 });
  assert.deepEqual([c.nextTier, c.upgradeDays, c.buildDays[0]], [29700000, 118.8, 200], "SotG's own example: Huge, tier 2 to 3: 29,700,000 cr, 118.8 days with 500");
  assert.equal(SR.costs({ size: "Gargantuan", tier: 5 }).nextTier, null);
  assert.deepEqual([SR.costs({ size: "Small" }).docking, SR.costs({ size: "Medium" }).docking, SR.costs({ size: "Huge" }).docking], [20, 40, 1000]);
  assert.deepEqual([SR.minCrew({ size: "Tiny" }), SR.minCrew({ size: "Small" }), SR.minCrew({ size: "Medium", abilities: { int: 10 } }), SR.minCrew({ size: "Large", abilities: { int: 14 } }),
    SR.minCrew({ size: "Gargantuan", abilities: { int: 30 } }), SR.minCrew({ size: "Huge", abilities: { int: 30 } })], [0, 1, 4, 120, 10000, 1000]);
});

// ---------------------------------------------------------------- deployments: rank features and techniques (10.12)
test("deployments: rank features and techniques read from SW5e's text; using a technique spends the right die", async () => {
  // the shape of SW5e's deployment text (made-up names)
  const md = "##### The Gunner\r\n| Rank | Feature |\r\n|:---:|:---|\r\n| 1st | Venture, Gunner Techniques |\r\n| 2nd | Gunning Style, Improved Critical |\r\n\r\n### Gambits\r\nThe gambits are presented in alphabetical order.\r\n\r\n#### Pinning Shot\r\n_**Power Die Location:** Weapons_\r\nAdd the power die.\r\n\r\n#### Comms Ping\r\n_**Power Die Location:** Comms_\r\nText.\r\n\r\n#### Tune Up\r\nNo die location.";
  const info = SR.deploymentInfo(md);
  assert.deepEqual(info.ranks, [[1, ["Venture", "Gunner Techniques"]], [2, ["Gunning Style", "Improved Critical"]]]);
  assert.deepEqual(info.techniques.map((t) => [t.name, t.loc]), [["Pinning Shot", "weapons"], ["Comms Ping", "comms"], ["Tune Up", null]]);
  assert.deepEqual([SR.techniquesKnown(0), SR.techniquesKnown(1), SR.techniquesKnown(5), SR.techDie(1), SR.techDie(5)], [0, 2, 6, 4, 12]);
  // on the server
  const { gm, p1, party, enemy } = await table();
  const sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { coupling: "Hub & Spoke", tier: 2, crew: [
    { name: "Ione", deployment: "Gunner", rank: 1, known: ["Pinning Shot", "Pinning Shot", "x".repeat(99), "a", "b", "c", "d", "e"] },
    { name: "Tam", deployment: "Mechanic", rank: 3, known: ["Tune Up"] }] }) });
  let crew = shipIn(await p1.state(), party).crew;
  assert.deepEqual([crew[0].known.length, crew[0].known[0], crew[0].known[1].length], [6, "Pinning Shot", 60], "unique, at most six, each cut to 60");
  assert.equal((await p1.act("ship.technique", { id: party, crew: 0, name: "Pinning Shot", pool: "weapons" })).code, 400, "no weapons power die yet");
  await p1.act("ship.power", { id: party, pool: "weapons", n: 1 });
  let r = await p1.act("ship.technique", { id: party, crew: 0, name: "Pinning Shot", pool: "weapons" });
  assert.equal(r.code, 200); assert.ok(r.data.value >= 1 && r.data.value <= 6, "a tier 2 power die: d6");
  assert.equal(shipIn(await p1.state(), party).status.power.weapons, 0, "spent");
  assert.ok((await p1.state()).chat.some((m) => /Ione \(Gunner\) uses Pinning Shot: a weapons power die/.test(m.text || "")));
  assert.equal((await p1.act("ship.technique", { id: party, crew: 0, name: "Comms Ping", pool: "central" })).code, 400, "not one they know");
  r = await p1.act("ship.technique", { id: party, crew: 1, name: "Tune Up" });
  assert.equal(r.code, 200); assert.ok(r.data.value >= 1 && r.data.value <= 8, "a 3rd-rank mechanic's tech die: d8, not spent");
  for (const bad of [{ crew: "__proto__" }, { crew: 7 }, { pool: "__proto__" }, { name: "constructor" }]) {
    assert.equal((await p1.act("ship.technique", Object.assign({ id: party, crew: 0, name: "Pinning Shot", pool: "weapons" }, bad))).code, 400, JSON.stringify(bad));
  }
  assert.equal((await p1.act("ship.technique", { id: enemy, crew: 0, name: "x" })).code, 403);
});

test("a crew member whose token's name the GM hides is '???' in ship lines: techniques and initiative (jpesus: keep it hidden)", async () => {
  const { gm, p1, p2, party } = await table();
  const inq = (await gm.act("char.save", { char: { name: "Grand Inquisitor", abilities: { dex: 14 } } })).data.id;
  await gm.act("token.add", { charId: inq, x: 3, y: 3, nameHidden: true });
  const sh = shipIn(await gm.state(), party);
  await gm.act("ship.save", { ship: Object.assign({}, sh, { coupling: "Direct", crew: [{ charId: inq, name: "Grand Inquisitor", deployment: "Gunner", rank: 1, known: ["Steady Aim"] }] }) });
  await gm.act("ship.power", { id: party, pool: "central", n: 2 });
  assert.equal((await gm.act("ship.technique", { id: party, crew: 0, name: "Steady Aim", pool: "central" })).code, 200);
  await gm.act("space.on", { on: true });
  await gm.act("space.place", { id: party, x: 2, y: 2, f: 2 });
  await gm.act("space.init", {});
  for (const who of [p1, p2]) {
    assert.ok(!JSON.stringify(await who.state()).includes("Grand Inquisitor"), "no player's state holds the hidden name: chat, ship crew rows, anything");
  }
  assert.equal(shipIn(await gm.state(), party).crew[0].name, "Grand Inquisitor", "the GM's copy keeps it");
  // a player's ordinary save sends the masked row back: the stored name stays
  const seen = shipIn(await p1.state(), party);
  assert.equal(seen.crew[0].name, "???");
  assert.equal((await p1.act("ship.save", { ship: Object.assign({}, seen, { notes: "fuel low" }) })).code, 200);
  const back = shipIn(await gm.state(), party);
  assert.deepEqual([back.notes, back.crew[0].name], ["fuel low", "Grand Inquisitor"], "the save took the notes, not the ???");
  const lines = (await p1.state()).chat.map((m) => m.text || "");
  assert.ok(lines.some((t) => /^\?\?\? \(Gunner\) uses Steady Aim: a central power die/.test(t)), "the technique line says ???");
  assert.ok(lines.some((t) => /initiative \(the lowest of its crew: \?\?\? -?\d+\)/.test(t)), "so does the initiative line");
});

// ---------------------------------------------------------------- the rarer Helm actions (10.11): Dogfight, Harass, Attack Run, Conceal
test("helm rules: firing from the helm, Dogfight, Attack Run and Conceal change the attack roll", () => {
  const w = { cat: "primary", range: "800/3200", arc: "forward" };
  const me = { id: "aaaaaa1", size: "Small" }, foe = { id: "bbbbbb1", size: "Small" }, other = { id: "cccccc1", size: "Small" };
  const a = { x: 0, y: 0, f: 2 }, ta = { x: 5, y: 0 };
  assert.deepEqual(SR.fireCheck(me, a, w, foe, ta, { fromHelm: true }).dis, ["firing from the helm"], "a pilot firing a primary weapon");
  assert.deepEqual(SR.fireCheck(me, a, w, foe, ta, {}).dis, [], "a gunner: no");
  const dog = Object.assign({}, me, { status: { fx: { dogfightVs: foe.id, dogfightDis: true, dogfightAdv: true } } });
  assert.deepEqual(SR.fireCheck(dog, a, w, foe, ta, { fromHelm: true }).dis, [], "dogfighting it: forward primary fire without the helm's disadvantage");
  const back = { x: 5, y: 0, f: 6 };   // facing west, at us
  assert.deepEqual(SR.fireCheck(foe, back, w, dog, a).dis, ["dogfight"], "its next attack on us: disadvantage");
  assert.deepEqual(SR.fireCheck(other, back, w, dog, a).adv, ["dogfight"], "another ship's: advantage");
  const run = Object.assign({}, me, { status: { fx: { runVs: foe.id, runFeet: 300 } } });
  assert.deepEqual(SR.fireCheck(run, a, w, foe, ta, { fromHelm: true }).dis, [], "an attack run at it: no helm disadvantage");
  const hid = Object.assign({}, me, { status: { fx: { concealed: true } } });
  assert.deepEqual([SR.fireCheck(hid, a, w, foe, ta).adv, SR.fireCheck(foe, back, w, hid, a).dis], [["unseen"], ["an unseen target"]]);
  const st = SR.statusOf(SR.startTurn(Object.assign({}, dog, { status: { fx: { dogfightVs: foe.id, runVs: foe.id, runFeet: 200, harassWeapon: 1, concealed: true } } }), () => ({ total: 0 }), {}).ship).fx;
  assert.deepEqual([st.dogfightVs, st.runVs, st.harassWeapon, st.concealed], ["", "", -1, true], "a new turn ends the turn's helm work; concealment lasts");
});

test("Dogfight, Harass, Attack Run and Conceal on the server", async () => {
  const { gm, p1, p2, party, enemy } = await table();
  let sh = shipIn(await p1.state(), party);
  await p1.act("ship.save", { ship: Object.assign({}, sh, { abilities: Object.assign({}, sh.abilities, { dex: 30, str: 20, con: 20 }), skills: Object.assign({}, sh.skills, { maneuvering: 2, hide: 2 }),
    crew: [{ name: "Ione", deployment: "Pilot", pb: 4 }, { name: "Tam", deployment: "Gunner", pb: 4 }],
    weapons: [{ name: "Laser", dmg: "1d4", type: "energy", range: "800/3200", cat: "primary", arc: "forward", atkMisc: 20 }] }) });
  const en = shipIn(await gm.state(), enemy);
  await gm.act("ship.save", { ship: Object.assign({}, en, { hull: { current: 20, max: 500 }, weapons: [{ name: "Gun", dmg: "1d4", type: "energy", range: "800/3200", cat: "primary", atkMisc: 20 }] }) });
  await gm.act("ship.points", { id: enemy, what: "hull", current: 500 });
  await gm.act("space.on", { on: true });
  await p1.act("space.place", { id: party, x: 2, y: 5, f: 2 });
  await gm.act("space.place", { id: enemy, x: 6, y: 5, f: 6 });
  await gm.act("space.init", {});
  if ((await gm.state()).space.turnId !== party) await gm.act("space.next", {});
  // firing from the helm: the pilot's shot carries the disadvantage, the gunner's doesn't
  await p1.act("space.fire", { id: party, target: enemy, weapon: 0, crew: 0 });
  let atk = (await p1.state()).chat.filter((m) => m.roll && m.roll.kind === "attack").pop();
  assert.match(atk.roll.label, /firing from the helm/);
  await p1.act("space.fire", { id: party, target: enemy, weapon: 0, crew: 1 });
  atk = (await p1.state()).chat.filter((m) => m.roll && m.roll.kind === "attack").pop();
  assert.doesNotMatch(atk.roll.label, /firing from the helm/);
  // Dogfight (a Helm action): then no second Helm action this turn
  let r = await p1.act("space.dogfight", { id: party, target: enemy });
  assert.equal(r.code, 200);
  assert.equal((await p1.act("space.conceal", { id: party })).code, 400, "one Helm action a turn");
  if (r.data.ok) {
    sh = shipIn(await gm.state(), party);
    assert.deepEqual([sh.status.fx.dogfightVs, sh.status.fx.dogfightDis], [enemy, true]);
    await p1.act("space.next", {});   // the enemy's turn: its attack on the dogfighting party ship has disadvantage
    await gm.act("space.fire", { id: enemy, target: party, weapon: 0 });
    const g = (await gm.state()).chat.filter((m) => m.roll && m.roll.kind === "attack").pop();
    assert.match(g.roll.label, /dogfight/);
    assert.equal(shipIn(await gm.state(), party).status.fx.dogfightDis, false, "used up");
    await gm.act("space.next", {});
  } else await p1.act("space.next", {});   // a failed Dogfight still spent the Helm action
  while ((await gm.state()).space.turnId !== party) await gm.act("space.next", {});
  // Harass with the forward laser: it can't fire this turn; the enemy breaking away takes a critical
  r = await p1.act("space.harass", { id: party, target: enemy, weapon: 0 });
  assert.equal(r.code, 200);
  assert.match((await p1.act("space.fire", { id: party, target: enemy, weapon: 0, crew: 1 })).data.error || "", /used to harass/);
  if (r.data.ok) {
    await p1.act("space.next", {});
    const hull0 = shipIn(await gm.state(), enemy).hull.current;
    await gm.act("space.place", { id: enemy, x: 12, y: 5, f: 6 });
    assert.ok((await gm.state()).chat.some((m) => /breaks away from Dawn Skiff's harassment/.test(m.text || "")));
    assert.ok(shipIn(await gm.state(), enemy).hull.current < hull0, "the critical lands");
    assert.ok(!JSON.stringify((await p2.state()).chat).includes("Black Lance"), "and the enemy stays ??? to the players");
    await gm.act("space.next", {});
  } else await p1.act("space.next", {});   // a failed Harass still spent this turn's Helm action
  while ((await gm.state()).space.turnId !== party) await gm.act("space.next", {});
  // Attack Run: only after 150 ft this turn
  assert.match((await p1.act("space.run", { id: party, target: enemy })).data.error || "", /150 ft or more/);
  await p1.act("space.place", { id: party, x: 2, y: 2, f: 2 });   // 150 ft north: sideways, away from the target
  assert.match((await p1.act("space.run", { id: party, target: enemy })).data.error || "", /moved 0 ft toward \?\?\? this turn/, "movement that doesn't close on the target doesn't count");
  await p1.act("space.place", { id: party, x: 2, y: 5, f: 2 });   // back: closes 50 ft
  await p1.act("space.place", { id: party, x: 5, y: 5, f: 2 });   // 150 ft east
  r = await p1.act("space.run", { id: party, target: enemy });
  assert.equal(r.code, 200);
  sh = shipIn(await gm.state(), party);
  assert.deepEqual([sh.status.fx.runVs, sh.status.fx.runFeet >= 150], [enemy, true]);
  await p1.act("space.fire", { id: party, target: enemy, weapon: 0, crew: 0 });
  atk = (await p1.state()).chat.filter((m) => m.roll && m.roll.kind === "attack").pop();
  assert.doesNotMatch(atk.roll.label, /firing from the helm/, "the run takes the helm's disadvantage off");
  assert.equal(shipIn(await gm.state(), party).status.fx.runVs, "", "and is spent");
  // Conceal on the next turn: a success hides the ship until it attacks
  await p1.act("space.next", {}); while ((await gm.state()).space.turnId !== party) await gm.act("space.next", {});
  r = await p1.act("space.conceal", { id: party });
  assert.equal(r.code, 200);
  const hideLine = (await gm.state()).chat.find((m) => /Dawn Skiff's Hide \d+ against the opposing side's best passive Scan, \d+/.test(m.text || ""));
  assert.ok(hideLine && hideLine.to[0] === "@gm" && !hideLine.fromId, "the numbers are the GM's");
  assert.ok(!(await p1.state()).chat.some((m) => /passive Scan|spotted \(/.test(m.text || "")), "a player sees no passive Scan");
  if (r.data.ok) {
    assert.equal(shipIn(await gm.state(), party).status.fx.concealed, true);
    await p1.act("space.fire", { id: party, target: enemy, weapon: 0, crew: 1 });
    assert.equal(shipIn(await gm.state(), party).status.fx.concealed, false, "firing gives it away");
  }
  for (const bad of [{ target: "__proto__" }, { target: party }, { target: "constructor" }]) assert.equal((await p1.act("space.dogfight", Object.assign({ id: party }, bad))).code >= 400, true);
  // a line only the GM reads names the GM's ships (not "???"): two GM ships, one on a hidden token
  const g2 = (await gm.act("ship.save", { ship: { name: "Grey Wake", hidden: true, size: "Small" } })).data.id;
  await gm.act("space.place", { id: g2, x: 12, y: 9, f: 6, hidden: true });
  await gm.act("space.conceal", { id: g2 });
  const gl = (await gm.state()).chat.filter((m) => /Grey Wake (slips out of sight|tries to conceal itself)/.test(m.text || ""));
  assert.ok(gl.length === 1 && gl[0].to[0] === "@gm", "named for the GM, and the GM's only");
  assert.ok(!JSON.stringify((await p2.state()).chat).includes("Grey Wake"));
  assert.equal((await p1.act("space.harass", { id: party, target: enemy, weapon: "__proto__" })).code, 400);
});
