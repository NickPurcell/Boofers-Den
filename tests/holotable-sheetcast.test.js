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
  // Sam's Cast at Rae's Bolt rolls and posts; Bolt's owner or the GM applies it
  let r = await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 2, targets: [tok.bolt] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  let gv = await gm.state();
  assert.equal(gv.characters[avery].force.used, 3, "level 2: three force points");
  assert.equal(gv.characters[bolt].hp.current, 20, "nothing applied to someone else's character");
  assert.ok(gv.chat.some((m) => m.system && /Avery casts Mind Shove at Bolt at level 2 \(3 force points\): STR save DC 13, half on a save\. Its owner or the GM applies it\./.test(m.text)));
  // the GM's Cast of Avery's power applies
  r = await gm.act("fight.cast", { charId: avery, power: "Mind Shove", level: 2, targets: [tok.bolt] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  gv = await gm.state();
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

test("sheet cast (the GM's): a creature token with a tracker entry uses it; without one it has no numbers and nothing changes", async () => {
  const { gm, sam, avery, tok } = await table();
  // a bare token: the save has no bonus and the damage lands nowhere
  let r = await gm.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: [tok.raider] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  let gv = await gm.state();
  assert.ok(gv.chat.some((m) => m.roll && m.roll.kind === "save" && /no save bonus known/.test(m.roll.label)));
  // in the tracker (no fight running): its hit points there take it
  await gm.act("init.add", { name: "Raider", init: 12, hp: 30, ac: 13 });
  r = await gm.act("fight.cast", { charId: avery, power: "Mind Shove", level: 1, targets: [tok.raider] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  gv = await gm.state();
  assert.ok(gv.initiative.entries.find((e) => e.name === "Raider").hp < 30);
});

test("sheet cast: no target rolls the damage once; healing your own character heals the sheet", async () => {
  const { gm, sam, avery, bolt, tok } = await table();
  let r = await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 2, targets: [] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  let gv = await gm.state();
  assert.equal(gv.characters[avery].force.used, 3);
  assert.ok(gv.chat.some((m) => m.system && /Avery casts Mind Shove at level 2 \(3 force points\): STR save DC 13, half on a save\./.test(m.text)));
  assert.equal(gv.chat.filter((m) => m.roll && m.roll.kind === "damage").at(-1).roll.expr, "2d6+1d6");
  // Avery is hurt; Sam's Mend on his own Avery heals the sheet
  await gm.act("char.damage", { id: avery, amount: 15 });
  r = await sam.act("fight.cast", { charId: avery, power: "Mend", level: 1, targets: [tok.avery] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  const healed = (await sheet(gm, avery)).hp.current;
  assert.ok(healed >= 5 + 2 + 3 && healed <= 5 + 8 + 3, `2d4 + Wis healed him on his sheet (${healed})`);
  assert.equal((await gm.state()).chat.filter((m) => m.roll && m.roll.kind === "heal").at(-1).roll.expr, "2d4+3");
});

test("sheet cast: concentration is recorded, a new one ends the old and frees its target, the ✕ ends it, and it carries into a fight", async () => {
  const { gm, sam, rae, avery, bolt, tok } = await table();
  assert.equal((await gm.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.bolt] })).code, 200);
  assert.equal((await rae.state()).sheetCast.conc[avery], "Hold", "everyone who sees Avery's sheet sees the concentration");
  assert.deepEqual((await sheet(gm, bolt)).conditions, ["Restrained"], "the condition goes on Bolt's sheet");
  // Hold again, on a creature in the tracker: the first one ends, and Bolt is free
  await gm.act("init.add", { name: "Raider", init: 12, hp: 30, ac: 13 });
  assert.equal((await gm.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.raider] })).code, 200);
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
  assert.ok(gv.chat.some((m) => m.system && /Avery stops concentrating: Hold ends/.test(m.text)));
  // again, then the fight starts: the combat view knows Avery is concentrating
  assert.equal((await gm.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.bolt] })).code, 200);
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

test("sheet cast reach (#156 review): a player's free at-will at others changes nothing; in a fight it's refused; the GM's applies", async () => {
  const { gm, sam, rae, avery, bolt, tok } = await table();
  const ZAP = { use: "action", range: [60, 60], save: { ability: "dex", dc: 40, onSave: "none" }, damage: [{ dice: "3d6", type: "lightning" }] };
  let av = await sheet(gm, avery);
  await sam.act("char.save", { char: Object.assign({}, av, { powers: av.powers.concat([{ name: "Zap", level: 0, type: "force", alignment: "dark" }]) }) });
  await gm.act("fight.toggle", { on: true }); await gm.act("fight.ability", { name: "Zap", data: ZAP }); await gm.act("fight.toggle", { on: false });
  await gm.act("init.add", { name: "Raider", init: 12, hp: 60, ac: 13 });
  const hp = async () => { const st = await gm.state(); return [st.characters[bolt].hp.current, st.initiative.entries.find((e) => e.name === "Raider").hp]; };
  // no fight: rolls and posts, three times each, and nobody's hit points move; it costs nothing
  for (let n = 0; n < 3; n++) {
    assert.equal((await sam.act("fight.cast", { charId: avery, power: "Zap", level: 0, targets: [tok.bolt] })).code, 200);
    assert.equal((await sam.act("fight.cast", { charId: avery, power: "Zap", level: 0, targets: [tok.raider] })).code, 200);
  }
  assert.deepEqual(await hp(), [20, 60]);
  assert.equal((await sheet(gm, avery)).force.used, 0, "an at-will is free");
  const st = await rae.state();
  assert.ok(st.chat.some((m) => m.system && /Avery casts Zap at Bolt: DEX save DC 40\. Its owner or the GM applies it\./.test(m.text)), "Rae reads what to apply");
  // aimed at your own character, it applies
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Zap", level: 0, targets: [tok.avery] })).code, 200);
  assert.ok((await sheet(gm, avery)).hp.current < 20);
  // a fight on the tracker that Avery isn't in, combat view off then on: refused at others
  await rae.act("init.add", { charId: bolt, name: "Bolt", init: 10 });
  await gm.act("init.start", {});
  for (const on of [false, true]) {
    await gm.act("fight.toggle", { on });
    const r = await sam.act("fight.cast", { charId: avery, power: "Zap", level: 0, targets: [tok.raider] });
    assert.deepEqual([r.code, r.data.error], [400, "A fight is on: cast it at others from the combat view, on your turn."]);
  }
  assert.deepEqual(await hp(), [20, 60]);
  // the GM's applies
  await gm.act("fight.toggle", { on: false });
  assert.equal((await gm.act("fight.cast", { charId: avery, power: "Zap", level: 0, targets: [tok.raider] })).code, 200);
  assert.ok((await hp())[1] < 60);
});

test("concentration after damage (audit 4.6): the sheet's Damage and the tracker's −n ask for the Con save; 0 hit points ends it", async () => {
  const { gm, sam, avery, bolt, tok } = await table();
  const concNow = async () => ((await gm.state()).sheetCast || { conc: {} }).conc[avery];
  // a small hit: DC 10, with Avery's Con save from the sheet (Con 12, not proficient: +1)
  assert.equal((await gm.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.bolt] })).code, 200);
  assert.equal((await sam.act("char.damage", { id: avery, amount: 4 })).code, 200);
  let gv = await gm.state();
  const save = gv.chat.filter((m) => m.roll && /concentration save/.test(m.roll.label)).at(-1);
  assert.equal(save.roll.expr, "1d20+1");
  assert.match(save.roll.label, /^Avery makes a concentration save \(CON, DC 10\)/);
  const kept = save.roll.total >= 10;
  assert.equal(await concNow(), kept ? "Hold" : undefined);
  assert.deepEqual(gv.characters[bolt].conditions, kept ? ["Restrained"] : [], "a lost concentration frees Bolt");
  // a hit to 0 hit points ends it, no save
  if (!kept) assert.equal((await gm.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.bolt] })).code, 200);
  const n = (await gm.state()).chat.filter((m) => m.roll && /concentration save/.test(m.roll.label)).length;
  assert.equal((await gm.act("char.damage", { id: avery, amount: 50 })).code, 200);
  gv = await gm.state();
  assert.equal(await concNow(), undefined);
  assert.equal(gv.chat.filter((m) => m.roll && /concentration save/.test(m.roll.label)).length, n, "no save at 0 hit points");
  assert.ok(gv.chat.some((m) => m.system && /Avery drops to 0 hit points: Hold ends/.test(m.text)));
  assert.deepEqual(gv.characters[bolt].conditions, []);
  // the tracker's −n: half of 30 is a DC 15 save
  await gm.act("char.save", { char: Object.assign({}, gv.characters[avery], { hp: { max: 60, current: 60, temp: 0 } }) });
  await sam.act("init.add", { charId: avery, name: "Avery", init: 20 });
  assert.equal((await gm.act("fight.cast", { charId: avery, power: "Hold", level: 1, targets: [tok.bolt] })).code, 200);
  const aid = (await gm.state()).initiative.entries.find((e) => e.name === "Avery").id;
  assert.equal((await gm.act("init.update", { id: aid, fields: { damage: 30 } })).code, 200);
  gv = await gm.state();
  assert.match(gv.chat.filter((m) => m.roll && /concentration save/.test(m.roll.label)).at(-1).roll.label, /DC 15/);
  // nobody concentrating: damage rolls nothing
  const before = gv.chat.length;
  await gm.act("char.damage", { id: bolt, amount: 3 });
  assert.equal((await gm.state()).chat.filter((m) => m.roll && /concentration save/.test(m.roll.label)).length,
    gv.chat.filter((m) => m.roll && /concentration save/.test(m.roll.label)).length);
  assert.ok((await gm.state()).chat.length >= before);
});

test("high-level casting (#160): a 6th-level power once per long rest, from the sheet and in the combat view", async () => {
  const { gm, sam, rae, avery, bolt, tok } = await table();
  const BLAST = { use: "action", range: [60, 60], save: { ability: "dex", dc: "power", onSave: "half" }, damage: [{ dice: "6d6", type: "force" }] };
  let av = await sheet(gm, avery);
  await gm.act("char.save", { char: Object.assign({}, av, { classes: [{ name: "Consular", level: 11 }], hp: { max: 80, current: 80, temp: 0 },
    powers: av.powers.concat([{ name: "Big Blast", level: 6, type: "force", alignment: "universal" }]) }) });
  await gm.act("fight.toggle", { on: true }); await gm.act("fight.ability", { name: "Big Blast", data: BLAST }); await gm.act("fight.toggle", { on: false });
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Big Blast", level: 6, targets: [tok.bolt] })).code, 200);
  assert.deepEqual((await sheet(gm, avery)).force.high, [6], "noted on the sheet");
  const again = await sam.act("fight.cast", { charId: avery, power: "Big Blast", level: 6, targets: [] });
  assert.deepEqual([again.code, again.data.error], [400, "Avery has already cast a 6th-level force power since the last long rest (6th level and up: once each per long rest)."]);
  assert.equal((await gm.act("fight.cast", { charId: avery, power: "Big Blast", level: 6, targets: [] })).code, 200, "the GM may go ahead");
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Mind Shove", level: 5, targets: [] })).code, 200, "5th isn't limited");
  // a long rest (the sheet's: a save without the record) clears it
  av = await sheet(gm, avery);
  assert.equal((await sam.act("char.save", { char: Object.assign({}, av, { force: { used: 0, max: av.force.max } }) })).code, 200);
  assert.equal("high" in (await sheet(gm, avery)).force, false);
  // in the combat view: the same rule, and Undo takes the note back
  await sam.act("init.add", { charId: avery, name: "Avery", init: 20 });
  await rae.act("init.add", { charId: bolt, name: "Bolt", init: 10 });
  await gm.act("init.start", {}); await gm.act("fight.toggle", { on: true });
  const bid = (await gm.state()).initiative.entries.find((e) => e.name === "Bolt").id;
  let r = await sam.act("fight.use", { ability: "pw:big blast", targets: [bid] });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  assert.deepEqual((await sheet(gm, avery)).force.high, [6]);
  r = await sam.act("fight.use", { ability: "pw:big blast", targets: [bid] });
  assert.equal(r.code, 400);
  assert.match(r.data.error, /already cast a 6th-level force power/);
  await gm.act("fight.undo", {});
  assert.equal("high" in (await sheet(gm, avery)).force, false, "Undo takes it back");
});

test("tech focus (audit 4.8): a tech power from the sheet or the combat view needs a wristpad worn; the GM may go ahead", async () => {
  const { gm, sam, rae, avery, bolt, tok } = await table();
  const JOLT = { use: "action", range: [60, 60], save: { ability: "dex", dc: "tech", onSave: "none" }, damage: [{ dice: "1d6", type: "lightning" }] };
  let av = await sheet(gm, avery);
  await sam.act("char.save", { char: Object.assign({}, av, { classes: [{ name: "Engineer", level: 3 }], abilities: Object.assign({}, av.abilities, { int: 16 }),
    powers: av.powers.concat([{ name: "Jolt", level: 1, type: "tech" }]), equipment: [{ name: "Wristpad", qty: 1, equipped: false }] }) });
  await gm.act("fight.toggle", { on: true }); await gm.act("fight.ability", { name: "Jolt", data: JOLT }); await gm.act("fight.toggle", { on: false });
  const r = await sam.act("fight.cast", { charId: avery, power: "Jolt", level: 1, targets: [] });
  assert.deepEqual([r.code, r.data.error], [400, "Avery needs a tech focus to cast tech powers: a wristpad, ticked as equipped."]);
  assert.equal((await gm.act("fight.cast", { charId: avery, power: "Jolt", level: 1, targets: [] })).code, 200, "the GM may go ahead");
  av = await sheet(gm, avery);
  av.equipment[0].equipped = true;
  await sam.act("char.save", { char: av });
  assert.equal((await sam.act("fight.cast", { charId: avery, power: "Jolt", level: 1, targets: [] })).code, 200, "with the wristpad worn");
  // the combat view's own action: the same rule
  av = await sheet(gm, avery); av.equipment[0].equipped = false; await sam.act("char.save", { char: av });
  await sam.act("init.add", { charId: avery, name: "Avery", init: 20 }); await rae.act("init.add", { charId: bolt, name: "Bolt", init: 10 });
  await gm.act("init.start", {}); await gm.act("fight.toggle", { on: true });
  const bid = (await gm.state()).initiative.entries.find((e) => e.name === "Bolt").id;
  const u = await sam.act("fight.use", { ability: "pw:jolt", targets: [bid] });
  assert.equal(u.code, 400);
  assert.match(u.data.error, /needs a tech focus/);
});
