// HoloTable: a character's 3D look (char.look, #65), against an in-memory Redis. The look is the character creator's
// share link, written by players and the GM, so it is read only against the creator's whitelist. Every name is invented.
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
const SAFE = /^[A-Za-z0-9=&._\-]+$/;
const sp = Look.SCHEMA.speciesOrder[1] || Look.SCHEMA.speciesOrder[0];

test("char.look: the owner or the GM sets it, others can't, and it is stored as the parser writes it", async () => {
  const { gm, p1, p2 } = await table();
  const id = (await p1.act("char.save", { char: { name: "Tavo" } })).data.id;
  const link = `https://example.invalid/sections/guitar-goblin/characters/#species=${sp}&zzz=1&c.jaw=7`;
  const r = await p1.act("char.look", { charId: id, look: link });
  assert.equal(r.code, 200);
  const want = Look.parseLook(link).look;
  assert.equal(r.data.look, want);
  assert.ok(r.data.changed >= 2, "the unknown key and the clamped number are counted");
  assert.match(want, SAFE);
  assert.equal((await p1.poll()).data.state.characters[id].look, want);
  assert.equal((await p2.poll()).data.state.characters[id].look, want, "another player sees it, as they see the sheet");
  assert.equal((await p2.act("char.look", { charId: id, look: `species=${sp}` })).code, 403, "not their character");
  assert.equal((await gm.act("char.look", { charId: id, look: `species=${sp}` })).code, 200, "the GM may");
  assert.equal((await p1.poll()).data.state.characters[id].look, Look.parseLook(`species=${sp}`).look);
  assert.equal((await p1.act("char.look", { charId: id, look: "" })).data.look, "");
  assert.equal((await p1.poll()).data.state.characters[id].look, undefined, "\"\" takes it off");
});

test("char.look: a sheet save never carries a look in or out", async () => {
  const { p1 } = await table();
  const id = (await p1.act("char.save", { char: { name: "Ilsa", look: `species=${sp}&skin=<b>x</b>` } })).data.id;
  assert.equal((await p1.poll()).data.state.characters[id].look, undefined, "char.save doesn't take one");
  await p1.act("char.look", { charId: id, look: `species=${sp}` });
  await p1.act("char.save", { char: { id, name: "Ilsa", look: "species=__proto__" } });
  assert.equal((await p1.poll()).data.state.characters[id].look, Look.parseLook(`species=${sp}`).look, "a save keeps the look it had");
});

test("char.look: bad text is refused, prototype names reach nothing, the cap holds", async () => {
  const { gm, p1 } = await table();
  const id = (await p1.act("char.save", { char: { name: "Oro" } })).data.id;
  for (const bad of [42, {}, ["species=" + sp], null + "x", "<script>alert(1)</script>", "species=__proto__", "species=constructor", "x".repeat(Look.MAX + 1), `species=${sp}&` + "a=b&".repeat(Look.MAX)]) {
    const r = await p1.act("char.look", { charId: id, look: bad });
    assert.equal(r.code, 400, `refused: ${String(bad).slice(0, 40)}`);
  }
  assert.equal((await p1.poll()).data.state.characters[id].look, undefined);
  for (const cid of ["__proto__", "constructor", "toString", "", "x".repeat(30)]) {
    for (const who of [gm, p1]) assert.equal((await who.act("char.look", { charId: cid, look: `species=${sp}` })).code, 400, `no character ${cid}`);
  }
  const r = await p1.act("char.look", { charId: id, look: `species=${sp}&__proto__=x&constructor=y&skin=toString&c.__proto__=1` });
  assert.equal(r.code, 200);
  assert.match(r.data.look, SAFE);
  assert.ok(!/proto|constructor|toString/.test(r.data.look));
  assert.equal({}.x, undefined); assert.equal({}.skin, undefined);
});

test("char.look: a character whose name the GM hides keeps its look from the other players", async () => {
  const { gm, p2 } = await table();
  const id = (await gm.act("char.save", { char: { name: "Secret" } })).data.id;
  assert.equal((await gm.act("char.look", { charId: id, look: `species=${sp}` })).code, 200);
  assert.equal((await gm.act("token.add", { charId: id, x: 1, y: 1, nameHidden: true })).code, 200);
  assert.ok((await gm.poll()).data.state.characters[id].look, "the GM has it");
  const seen = (await p2.poll()).data.state;
  assert.equal(seen.characters[id], undefined, "the sheet, look and all, isn't sent");
  assert.ok(!JSON.stringify(seen).includes(Look.parseLook(`species=${sp}`).look), "nor the look anywhere else");
});
