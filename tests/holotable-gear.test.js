// Equipment (audit section 6, #167): what an item keeps on the sheet (weight, cost, ...) and what the table does with it,
// through the real handler on an in-memory Redis. Every person and character here is invented.
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
require("../sections/jpesus/holotable/rules.js");
let db = new HoloFake(), sub = null;
S.getClient = () => db;
S.getSub = () => (sub = sub || db.duplicate());
let ipn = 1;
function browser() {
  const b = { cookie: "", ip: `10.11.0.${ipn++}` };
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
async function table() {
  db = new HoloFake(); sub = null;
  const gm = browser(), sam = browser();
  await gm.login(GM_PW, "Dee"); await sam.login(PLAYER_PW, "Sam");
  const avery = (await sam.act("char.save", { char: { name: "Avery", abilities: { str: 8 }, equipment: [] } })).data.id;
  return { gm, sam, avery };
}
const sheet = async (b, id) => (await b.state()).characters[id];

test("carrying (6.5): an item keeps its weight and cost; bad values are dropped; the GM switches the encumbrance variant", async () => {
  const { gm, sam, avery } = await table();
  const av = await sheet(sam, avery);
  const r = await sam.act("char.save", { char: Object.assign({}, av, { equipment: [
    { name: "Backpack", qty: 1, wt: 5, cost: 50 }, { name: "Ration bar", qty: 10, wt: 0.25, cost: 5 },
    { name: "Mystery", qty: 1, wt: "heavy", cost: -40 }, { name: "Huge", qty: 1, wt: 1e9, cost: 1e12 }, { name: "Feather", qty: 1, wt: 0.123 },
  ] }) });
  assert.equal(r.code, 200, JSON.stringify(r.data));
  const eq = (await sheet(gm, avery)).equipment;
  assert.deepEqual(eq.map((e) => [e.name, e.wt, e.cost]), [["Backpack", 5, 50], ["Ration bar", 0.25, 5], ["Mystery", undefined, undefined], ["Huge", 10000, 1e9], ["Feather", 0.12, undefined]]);
  assert.ok(!("wt" in eq[2]) && !("cost" in eq[2]), "nothing stored when unset");
  // Avery (Str 8) carries 5 + 2.5 + 10000 + 0.12: over the capacity of 120
  const c = await sheet(gm, avery);
  assert.equal(globalThis.SW5E.carrying(c).capacity, 120);
  assert.equal(globalThis.SW5E.carrying(c).state, "over");
  // the variant is the GM's switch for the whole table
  assert.equal((await sam.act("variants.set", { variants: ["Encumbrance"] })).code, 403);
  assert.equal((await gm.act("variants.set", { variants: ["Encumbrance"] })).code, 200);
  assert.deepEqual((await sam.state()).variants, ["Encumbrance"]);
});

test("buying and selling (6.8): a line spoken as a character whose token name the GM hides doesn't name it", async () => {
  const { gm, sam } = await table();
  const npc = (await gm.act("char.save", { char: { name: "Grand Inquisitor", credits: 500, equipment: [{ name: "Backpack", qty: 1, cost: 50 }] } })).data.id;
  await gm.act("token.add", { charId: npc, x: 2, y: 2 });
  const tok = (await gm.state()).map.tokens.find((t) => t.charId === npc).id;
  await gm.act("token.update", { id: tok, fields: { nameHidden: true } });
  assert.equal((await gm.act("chat", { text: "*sells Backpack for 25 cr.*", as: "Grand Inquisitor" })).code, 200);
  const line = (await sam.state()).chat.filter((m) => /sells Backpack/.test(m.text || "")).at(-1);
  assert.ok(line, "the line is posted");
  assert.ok(!JSON.stringify((await sam.state()).chat).includes("Grand Inquisitor"), "Sam never reads the hidden name");
  // revealed, the line speaks as the character again
  await gm.act("token.update", { id: tok, fields: { nameHidden: false } });
  await gm.act("chat", { text: "*buys Backpack for 50 cr.*", as: "Grand Inquisitor" });
  assert.equal((await sam.state()).chat.filter((m) => /buys Backpack/.test(m.text || "")).at(-1).as, "Grand Inquisitor");
});

test("attunement (6.3): an item keeps its rarity and attunement; attuned only when it requires it; bad values dropped", async () => {
  const { gm, sam, avery } = await table();
  const av = await sheet(sam, avery);
  await sam.act("char.save", { char: Object.assign({}, av, { equipment: [
    { name: "Focus crystal", qty: 1, rar: "Prototype", att: true, attuned: true },
    { name: "Plain thing", qty: 1, rar: "Shiny", attuned: true },
    { name: "Proto", qty: 1, rar: "__proto__", att: "yes" },
  ] }) });
  const eq = (await sheet(gm, avery)).equipment;
  assert.deepEqual(eq.map((e) => [e.rar, e.att, e.attuned]), [["Prototype", true, true], [undefined, undefined, undefined], [undefined, true, undefined]]);
});
