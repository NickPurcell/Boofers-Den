// The sheet's Cast through the combat engine (#73, audit 4.4-4.7 outside the combat view): fight.cast and
// fight.unconc in api/_holotable-fight.js, through the real handler on an in-memory Redis.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");
const HoloFake = require("./holotable-fake-redis.js");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === "ioredis" ? "ioredis-stub" : orig.call(this, req, ...rest); };
require.cache["ioredis-stub"] = { id: "ioredis-stub", filename: "ioredis-stub", loaded: true, exports: HoloFake };
process.env.REDIS_URL = "redis://stub";
const PLAYER_PW = "nerf-herder-77", GM_PW = "outer-rim-9";
process.env.HOLOTABLE_PLAYER_PASSWORD = PLAYER_PW;
process.env.HOLOTABLE_GM_PASSWORD = GM_PW;
const S = require("../api/_holotable-store.js");
const handler = require("../api/holotable.js");
let db = new HoloFake(), sub = null;
S.getClient = () => db;
S.getSub = () => (sub = sub || db.duplicate());
let ipn = 1;
function browser() {
  const b = { cookie: "", ip: `10.9.0.${ipn++}` };
  b.call = async (method, query, body) => {
    const headers = Object.assign({ "x-forwarded-for": b.ip, cookie: b.cookie }, method === "POST" ? { "x-holotable": "1" } : {});
    const res = { code: 0, headers: {}, data: null, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; }, send(d) { this.data = d; return this; } };
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
// Sam's Avery, a Consular 3 (Wis 16: force DC 13, max power level 2), and Rae's Bolt, a Fighter, on the map; the GM's
// Raider token and a hidden Lurker token. No initiative: this is play outside a fight.
const SHOVE = { use: "action", range: [60, 60], save: { ability: "str", dc: "power", onSave: "half" }, damage: [{ dice: "2d6", type: "force" }], upcast: { damage: "1d6" } };
const HOLD = { use: "action", range: [60, 60], save: { ability: "wis", dc: 40 }, applies: [{ condition: "Restrained", until: { ends: "end", of: "target", rounds: 1 } }], concentration: true };
const MEND = { use: "action", range: [30, 30], heal: { dice: "2d4", add: "wis" } };
async function table({ teach = true } = {}) {
  db = new HoloFake(); sub = null;
  const gm = browser(), sam = browser(), rae = browser();
  await gm.login(GM_PW, "Dee"); await sam.login(PLAYER_PW, "Sam"); await rae.login(PLAYER_PW, "Rae");
  const avery = (await sam.act("char.save", { char: { name: "Avery", ac: 12, speed: 30, hp: { max: 20, current: 20, temp: 0 }, classes: [{ name: "Consular", level: 3 }],
    abilities: { str: 8, dex: 12, con: 12, int: 10, wis: 16, cha: 10 },
    powers: [{ name: "Mind Shove", level: 1, type: "force", alignment: "universal" }, { name: "Hold", level: 1, type: "force", alignment: "universal" },
      { name: "Mend", level: 1, type: "force", alignment: "light" }, { name: "Plain Light", level: 1, type: "force", alignment: "light" }] } })).data.id;
  const bolt = (await rae.act("char.save", { char: { name: "Bolt", ac: 15, speed: 30, hp: { max: 20, current: 20, temp: 0 }, classes: [{ name: "Fighter", level: 1 }],
    abilities: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 } } })).data.id;
  await sam.act("token.add", { charId: avery, x: 0, y: 0 });
  await rae.act("token.add", { charId: bolt, x: 0, y: 4 });
  await gm.act("token.add", { name: "Raider", x: 6, y: 0 });
  await gm.act("token.add", { name: "Lurker", x: 1, y: 1, hidden: true });
  if (teach) {   // the GM teaches the table the powers in the combat view, then switches it off again
    await gm.act("fight.toggle", { on: true });
    for (const [name, data] of [["Mind Shove", SHOVE], ["Hold", HOLD], ["Mend", MEND]]) assert.equal((await gm.act("fight.ability", { name, data })).code, 200);
    await gm.act("fight.toggle", { on: false });
  }
  const st = await gm.state();
  const tok = (n) => st.map.tokens.find((t) => t.name === n).id;
  return { gm, sam, rae, avery, bolt, tok: { avery: tok("Avery"), bolt: tok("Bolt"), raider: tok("Raider"), lurker: tok("Lurker") } };
}
const sheet = async (b, id) => (await b.state()).characters[id];

test("sheet cast: never switched on, there's no data, and nothing is written", async () => {
  const { gm, sam, avery, tok } = await table({ teach: false });
  const r = await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: [tok.bolt] });
  assert.equal(r.code, 400);
  assert.equal((await gm.act("fight.unconc", { charId: avery })).code, 200, "nothing to end");
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  assert.equal("fight" in file, false, "no combat record made");
  assert.equal("sheetCast" in (await sam.state()), false);
});

test("sheet cast: with the view off, the table's data reaches the sheet, and a save power rolls, upcast, against a character", async () => {
  const { gm, sam, rae, avery, bolt, tok } = await table();
  const st = await sam.state();
  assert.equal(st.fight, undefined, "the combat view is off");
  assert.deepEqual(Object.keys(st.sheetCast.lib).sort(), ["hold", "mend", "mind shove"]);
  assert.equal((await rae.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: [tok.bolt] })).code, 403, "not Rae's character");
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Plain Light", level: 1, targets: [tok.bolt] })).code, 400, "no data for that power");
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Force Lightning", level: 1, targets: [tok.bolt] })).code, 400, "not on the sheet");
  const r = await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 2, targets: [tok.bolt] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  const gv = await gm.state();
  assert.equal(gv.characters[avery].force.used, 3, "level 2: three force points");
  assert.ok(gv.characters[bolt].hp.current < 20, "Bolt took the damage on the sheet (half on a save, at least 1)");
  assert.ok(gv.chat.some((m) => m.system && /Avery uses Mind Shove at level 2 \(3 Force points\)/.test(m.text)));
  const save = gv.chat.filter((m) => m.roll && m.roll.kind === "save").at(-1);
  assert.equal(save.roll.expr, "1d20+3", "Bolt's STR save from his sheet");
  assert.match(save.roll.label, /DC 13/);
  const dmg = gv.chat.filter((m) => m.roll && m.roll.kind === "damage").at(-1);
  assert.equal(dmg.roll.expr, "2d6+1d6", "the upcast adds its die");
});

test("sheet cast: the max power level refuses a player and lets the GM through; a player can't aim at a hidden token", async () => {
  const { gm, sam, avery, tok } = await table();
  const r = await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 3, targets: [tok.raider] });
  assert.deepEqual([r.code, r.data.error], [400, "Avery can cast powers up to level 2."]);
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: [tok.lurker] })).code, 400, "the hidden Lurker isn't the player's to pick");
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: ["nosuchtoken"] })).code, 400);
  const g = await gm.act("fight.cast", { charId: avery, power: "Mind Shove", level: 3, targets: [tok.lurker] });
  assert.equal(g.code, 200, JSON.stringify(g.data));
  const gv = await gm.state(), pv = await sam.state();
  assert.equal(gv.characters[avery].force.used, 4);
  assert.ok(gv.chat.some((m) => m.private && m.roll && /Lurker/.test(m.roll.label)), "the GM sees the hidden creature's save");
  assert.ok(!JSON.stringify(pv.chat).includes("Lurker"), "the player never reads its name");
});

test("sheet cast: a creature token with a tracker entry uses it; without one it has no numbers and nothing changes", async () => {
  const { gm, sam, avery, tok } = await table();
  // a bare token: the save has no bonus and the damage lands nowhere
  let r = await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: [tok.raider] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  let gv = await gm.state();
  assert.ok(gv.chat.some((m) => m.roll && m.roll.kind === "save" && /no save bonus known/.test(m.roll.label)));
  // in the tracker (no fight running): its hit points there take it
  await gm.act("init.add", { name: "Raider", init: 12, hp: 30, ac: 13 });
  r = await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: [tok.raider] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  gv = await gm.state();
  assert.ok(gv.initiative.entries.find((e) => e.name === "Raider").hp < 30);
});

test("sheet cast: no target rolls the damage once; healing a character heals the sheet", async () => {
  const { gm, sam, avery, bolt, tok } = await table();
  let r = await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 2, targets: [] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  let gv = await gm.state();
  assert.equal(gv.characters[avery].force.used, 3);
  assert.ok(gv.chat.some((m) => m.system && /Avery casts Mind Shove at level 2 \(3 force points\): STR save DC 13, half on a save\./.test(m.text)));
  assert.equal(gv.chat.filter((m) => m.roll && m.roll.kind === "damage").at(-1).roll.expr, "2d6+1d6");
  // Bolt is hurt; Mend heals him on his sheet
  const b = gv.characters[bolt];
  await gm.act("char.save", { char: Object.assign({}, b, { hp: { max: 20, current: 5, temp: 0 } }) });
  r = await sam.act("fight.cast", { charId: avery, power: "Mend", level: 1, targets: [tok.bolt] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  const healed = (await sheet(gm, bolt)).hp.current;
  assert.ok(healed >= 5 + 2 + 3 && healed <= 5 + 8 + 3, `2d4 + Wis healed him on his sheet (${healed})`);
  assert.equal((await gm.state()).chat.filter((m) => m.roll && m.roll.kind === "heal").at(-1).roll.expr, "2d4+3");
});

test("sheet cast: concentration is recorded, a new one ends the old and frees its target, the ✕ ends it, and it carries into a fight", async () => {
  const { gm, sam, rae, avery, bolt, tok } = await table();
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.bolt] })).code, 200);
  assert.equal((await rae.state()).sheetCast.conc[avery], "Hold", "everyone who sees Avery's sheet sees the concentration");
  assert.deepEqual((await sheet(gm, bolt)).conditions, ["Restrained"], "the condition goes on Bolt's sheet");
  // Hold again, on a creature in the tracker: the first one ends, and Bolt is free
  await gm.act("init.add", { name: "Raider", init: 12, hp: 30, ac: 13 });
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.raider] })).code, 200);
  let gv = await gm.state();
  assert.deepEqual(gv.characters[bolt].conditions, [], "Bolt is no longer held");
  assert.deepEqual(gv.initiative.entries.find((e) => e.name === "Raider").conditions, ["Restrained"]);
  assert.ok(gv.chat.some((m) => m.system && /stops concentrating/.test(m.text)));
  // the ✕: its owner or the GM ends it, and the Raider is free
  assert.equal((await rae.act("fight.unconc", { charId: avery })).code, 403, "not Rae's to end");
  assert.equal((await sam.act("fight.unconc", { charId: avery })).code, 200);
  gv = await gm.state();
  assert.equal((gv.sheetCast || { conc: {} }).conc[avery], undefined);
  assert.deepEqual(gv.initiative.entries.find((e) => e.name === "Raider").conditions, []);
  assert.ok(gv.chat.some((m) => m.system && /Avery stops concentrating on Hold/.test(m.text)));
  // again, then the fight starts: the combat view knows Avery is concentrating
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.bolt] })).code, 200);
  await sam.act("init.add", { charId: avery, name: "Avery", init: 20 });
  await rae.act("init.add", { charId: bolt, name: "Bolt", init: 10 });
  await gm.act("init.start", {});
  await gm.act("fight.toggle", { on: true });
  gv = await gm.state();
  const aid = gv.initiative.entries.find((e) => e.name === "Avery").id, bid = gv.initiative.entries.find((e) => e.name === "Bolt").id;
  assert.equal(gv.fight.conc[aid], "Hold", "the combat view shows it");
  // in the fight the sheet sends the combat view's own action; fight.cast says so
  const r = await sam.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.bolt] });
  assert.deepEqual([r.code, r.data.error], [400, "Avery is in the fight: cast it from the combat view on Avery's turn."]);
  assert.equal((await sam.act("fight.use", { ability: "pw:hold", targets: [bid] })).code, 200);
  gv = await gm.state();
  assert.equal(gv.fight.conc[aid], "Hold");
  assert.equal(gv.sheetCast.conc[avery], "Hold");
});

test("sheet cast: ids from the request are checked; a prototype key is nobody", async () => {
  const { gm, sam, avery, tok } = await table();
  for (const bad of ["__proto__", "constructor", "toString"]) {
    assert.equal((await gm.act("fight.cast", { charId: bad, power: "Mind Shove", level: 1, targets: [] })).code, 400, bad);
    assert.equal((await gm.act("fight.unconc", { charId: bad })).code, 400, bad);
    assert.equal((await gm.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: [bad] })).code, 400, bad);
    assert.equal((await sam.act("fight.cast", { charId: avery, power: bad, level: 1, targets: [tok.bolt] })).code, 400, bad);
  }
  assert.equal({}.conditions, undefined, "nothing reached Object.prototype");
  assert.equal({}.hp, undefined);
});

test("sheet cast: a name the GM hides stays hidden from other players", async () => {
  const { gm, sam, rae, avery, tok } = await table();
  await gm.act("token.update", { id: tok.avery, fields: { nameHidden: true } });
  await gm.act("token.update", { id: tok.raider, fields: { nameHidden: true } });
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: [tok.raider] })).code, 200);
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [] })).code, 200);
  const rv = await rae.state();
  const lines = JSON.stringify(rv.chat.filter((m) => m.fight));
  assert.ok(!lines.includes("Avery") && !lines.includes("Raider"), "Rae reads neither name");
  assert.ok(lines.includes("???"));
  assert.ok(!lines.includes('"from":"Sam"'), "nor who plays the hidden character");
});
