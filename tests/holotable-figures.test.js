// HoloTable: 3D figures on the map (#65), against an in-memory Redis. The GM's switch, and what the 3D view may draw:
// a figure stands only on a token this player's browser was sent, so fog of war and hidden tokens hold. Every name
// is invented.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const HoloFake = require("./holotable-fake-redis.js");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === "ioredis" ? "ioredis-stub" : orig.call(this, req, ...rest); };
require.cache["ioredis-stub"] = { id: "ioredis-stub", filename: "ioredis-stub", loaded: true, exports: HoloFake };
process.env.REDIS_URL = "redis://stub";
const PLAYER_PW = "blue-milk-run", GM_PW = "kessel-in-12";
process.env.HOLOTABLE_PLAYER_PASSWORD = PLAYER_PW;
process.env.HOLOTABLE_GM_PASSWORD = GM_PW;

const S = require("../api/_holotable-store.js");
const G = require("../api/_holotable-game.js");
const handler = require("../api/holotable.js");
const FakeBlob = require("./holotable-fake-blob.js");
let db = new HoloFake();
let sub = null;
let store = new FakeBlob();   // the private Blob store
S.getClient = () => db;
S.getSub = () => (sub = sub || db.duplicate());
S.getBlob = () => store;
S.blobReady = () => true;
function fresh() { db = new HoloFake(); sub = null; store = new FakeBlob(); }

let ipn = 1;
// One "browser": keeps its cookie like a real one would.
function browser(ip) {
  const b = { cookie: "", ip: ip || `10.2.0.${ipn++}` };
  b.call = async (method, query, body, extraHeaders = {}) => {
    const headers = Object.assign({ "x-forwarded-for": b.ip, cookie: b.cookie }, method === "POST" ? { "x-holotable": "1" } : {}, extraHeaders);
    const req = { method, query, body, headers };
    const res = { code: 0, headers: {}, data: null,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; },
      json(d) { this.data = d; return this; }, send(d) { this.data = d; return this; } };
    await handler(req, res);
    const sc = res.headers["set-cookie"];
    if (sc) { const m = /^ht_session=([^;]*)/.exec(sc); b.cookie = m && m[1] ? `ht_session=${m[1]}` : ""; }
    return res;
  };
  b.post = (op, body) => b.call("POST", { op }, body);
  b.act = (type, payload) => b.post("action", { type, payload });
  b.poll = (v = "", wait = 50) => b.call("GET", { op: "poll", v, wait: String(wait) });
  b.login = (password, name) => b.post("login", { password, name });
  return b;
}
async function table() {
  fresh();
  const gm = browser(), p1 = browser(), p2 = browser();
  assert.equal((await gm.login(GM_PW, "Dee")).data.role, "gm");
  assert.equal((await p1.login(PLAYER_PW, "Sam")).data.role, "player");
  assert.equal((await p2.login(PLAYER_PW, "Rae")).data.role, "player");
  return { gm, p1, p2 };
}

const Look = require("../sections/guitar-goblin/human-base/look-parse.js");
const LOOK = Look.parseLook("species=" + Look.SCHEMA.speciesOrder[0]).look;

test("3D figures: off by default, only the GM switches them, every screen is told, and anything but true is off", async () => {
  const { gm, p1 } = await table();
  assert.equal((await p1.poll()).data.state.figures, undefined, "off on a new table");
  assert.equal((await p1.act("settings.figures", { on: true })).code, 403, "a player can't switch it");
  assert.equal((await gm.poll()).data.state.figures, undefined);
  assert.equal((await gm.act("settings.figures", { on: true })).code, 200);
  assert.equal((await p1.poll()).data.state.figures, true, "the players' screens see it on");
  for (const on of ["yes", 1, {}, null]) {
    await gm.act("settings.figures", { on: true });
    await gm.act("settings.figures", { on });
    assert.equal((await p1.poll()).data.state.figures, undefined, `on: ${JSON.stringify(on)} is off`);
  }
});

test("3D figures: a restore keeps the switch only when it is exactly true", async () => {
  const { gm } = await table();
  await gm.act("settings.figures", { on: true });
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  assert.equal(file.figures, true, "it is in the backup");
  for (const [v, want] of [[true, true], ["true", undefined], [1, undefined], [{ x: 1 }, undefined]]) {
    file.figures = v;
    assert.equal((await gm.post("restore", { campaign: file })).code, 200);
    assert.equal((await gm.poll()).data.state.figures, want, `figures: ${JSON.stringify(v)}`);
  }
  const g = G.blankCampaign("x"); g.figures = "__proto__"; G.cleanGame(g); assert.equal(g.figures, undefined);
});

test("3D figures: a figure can stand only on a token the player was sent (a hidden token, and its look, never reach them)", async () => {
  const { gm, p1 } = await table();
  await gm.act("settings.figures", { on: true });
  const mine = (await p1.act("char.save", { char: { name: "Kaira Vess" } })).data.id;
  assert.equal((await p1.act("char.look", { charId: mine, look: LOOK })).code, 200);
  const theirs = (await gm.act("char.save", { char: { name: "Ves Dorn" } })).data.id;
  await gm.act("char.look", { charId: theirs, look: LOOK });
  await p1.act("token.add", { charId: mine, x: 2, y: 2 });
  await gm.act("token.add", { charId: theirs, x: 5, y: 5 });
  let st = (await gm.poll()).data.state;
  const hid = st.map.tokens.find((t) => t.charId === theirs).id;
  await gm.act("token.update", { id: hid, fields: { hidden: true } });
  st = (await p1.poll()).data.state;
  assert.deepEqual(st.map.tokens.map((t) => t.charId), [mine], "the player is sent only their own token");
  assert.equal(st.characters[mine].look, LOOK, "with its look");
  assert.ok((await gm.poll()).data.state.map.tokens.some((t) => t.id === hid), "the GM still has the hidden one");
  // the name hidden instead: the token comes with no character, so no look to stand a figure by
  await gm.act("token.update", { id: hid, fields: { hidden: false } });
  await gm.act("token.update", { id: hid, fields: { nameHidden: true } });
  const t = (await p1.poll()).data.state.map.tokens.find((x) => x.id === hid);
  if (t) assert.equal(t.charId, null, "a hidden name: no character on the token");
});
