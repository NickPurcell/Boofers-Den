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
    { cond: ["Ionized"], slowed: 4, system: 0, zero: { s: 0, f: 0, stable: false, destroyed: false } }, "anything else is cleaned away");
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
