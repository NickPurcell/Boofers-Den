// API tests for HoloTable (jpesus's Star Wars 5e table), against an in-memory Redis.
// Run: node --test tests/holotable-api.test.js      Every person and character here is invented.
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const HoloFake = require("./holotable-fake-redis.js");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) { return req === "ioredis" ? "ioredis-stub" : orig.call(this, req, ...rest); };
require.cache["ioredis-stub"] = { id: "ioredis-stub", filename: "ioredis-stub", loaded: true, exports: HoloFake };
process.env.REDIS_URL = "redis://stub";

const S = require("../api/_holotable-store.js");
const G = require("../api/_holotable-game.js");
const handler = require("../api/holotable.js");
let db = new HoloFake();
let sub = null;
S.getClient = () => db;
S.getSub = () => (sub = sub || db.duplicate());
function fresh() { db = new HoloFake(); sub = null; }

let ipn = 1;
async function call(method, query, body) {
  const req = { method, query, body, headers: { "x-forwarded-for": `10.1.0.${ipn}` } };
  const res = { code: 0, headers: {}, data: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.code = c; return this; },
    json(d) { this.data = d; return this; }, send(d) { this.data = d; return this; } };
  await handler(req, res);
  return res;
}
const post = (op, body) => call("POST", { op }, body);
const act = (code, clientId, type, payload) => post("action", { code, clientId, type, payload });
const poll = (code, clientId, v, wait = 50) => call("GET", { op: "poll", code, clientId, v, wait: String(wait) });
// smallest valid PNG: 1x1 transparent
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PNG_URL = "data:image/png;base64," + PNG.toString("base64");

async function setup() {
  fresh(); ipn++;
  const c = await post("create", { clientId: "gm1", campaignName: "Outer Rim", playerName: "Dee" });
  assert.equal(c.code, 200);
  const code = c.data.code;
  assert.match(code, /^[A-Z0-9]{5}$/);
  assert.equal((await post("join", { clientId: "p1", code, playerName: "Sam" })).code, 200);
  return { code, gmToken: c.data.gmToken };
}

test("dice: keeps, drops, constants and natural 20s", () => {
  for (let i = 0; i < 200; i++) {
    const r = G.rollDice("2d20kh1+5");
    assert.ok(r.total >= 6 && r.total <= 25);
    assert.ok(r.nat >= 1 && r.nat <= 20);
    assert.equal(r.total, r.nat + 5);
  }
  assert.equal(G.rollDice("1d8+1d6-2").nat, null);
  const d = G.rollDice("4d6dl1");
  assert.equal((d.detail.match(/~/g) || []).length, 2);
  assert.equal(G.rollDice("3").total, 3);
  assert.throws(() => G.rollDice("1d20+abc"), G.Invalid);
  assert.throws(() => G.rollDice("500d6"), G.Invalid);
});

test("create, join and poll: players see the table, never the GM's secrets", async () => {
  const { code } = await setup();
  const gm = await poll(code, "gm1", "");
  assert.equal(gm.code, 200);
  assert.equal(gm.data.state.isGM, true);
  assert.ok(gm.data.state.gmToken);
  const p = await poll(code, "p1", "");
  assert.equal(p.data.state.isGM, false);
  assert.equal(p.data.state.gmToken, null);
  assert.equal(p.data.state.notes, null);
  assert.deepEqual(p.data.state.online.map((o) => o.name).sort(), ["Dee", "Sam"]);
  assert.equal((await poll(code, "stranger", "")).code, 403);
  assert.equal((await poll("NOPE9", "p1", "")).code, 404);
  assert.equal(await db.exists(S.K.on("NOPE9")), 0, "no presence record for a campaign that doesn't exist");
  assert.equal((await post("join", { clientId: "x", code: "ZZZZZ", playerName: "Nobody" })).code, 404);
});

test("long-poll wakes up as soon as something changes", async () => {
  const { code } = await setup();
  const first = await poll(code, "p1", "");
  const t0 = Date.now();
  const waiting = poll(code, "p1", first.data.v, 5000);
  setTimeout(() => act(code, "gm1", "chat", { text: "Hello there" }), 150);
  const r = await waiting;
  assert.ok(Date.now() - t0 < 900, `woke after ${Date.now() - t0} ms; pub/sub should wake it right away (the 2.5 s re-check is only a fallback)`);
  assert.ok(r.data.state, "returns the new state");
  assert.equal(r.data.state.chat.at(-1).text, "Hello there");
  const idle = await poll(code, "p1", r.data.v, 100);
  assert.equal(idle.data.same, true);
});

test("characters: only the owner or GM may edit; hidden things stay hidden", async () => {
  const { code } = await setup();
  const mine = await act(code, "p1", "char.save", { char: { name: "Kira", hp: { max: 20, current: 20 } } });
  assert.equal(mine.code, 200);
  const gmChar = await act(code, "gm1", "char.save", { char: { name: "Villain" } });
  assert.equal((await act(code, "p1", "char.save", { char: { id: gmChar.data.id, name: "HACKED" } })).code, 403);
  assert.equal((await act(code, "gm1", "char.save", { char: { id: mine.data.id, name: "Kira Vos" } })).code, 200);
  assert.equal((await act(code, "p1", "init.next", {})).code, 403);
  assert.equal((await act(code, "p1", "prop.add", { src: "/api/holotable?a=x-1.0" })).code, 403);
  await act(code, "gm1", "init.add", { name: "Sniper", bonus: 3, hp: 30, hidden: true });
  await act(code, "gm1", "init.add", { name: "Trooper", bonus: 1, hp: 13 });
  await act(code, "p1", "init.add", { charId: mine.data.id, name: "Kira", bonus: 2 });
  await act(code, "gm1", "chat", { text: "/w Sam psst" });
  await act(code, "gm1", "chat", { text: "/gmr 1d20" });
  const gmView = (await poll(code, "gm1", "")).data.state;
  const pView = (await poll(code, "p1", "")).data.state;
  assert.equal(gmView.initiative.entries.length, 3);
  assert.deepEqual(pView.initiative.entries.map((e) => e.name).sort(), ["Kira", "Trooper"]);
  assert.equal(pView.initiative.entries.find((e) => e.name === "Trooper").hp, null, "NPC HP hidden from players");
  assert.equal(pView.characters[mine.data.id].name, "Kira Vos");
  assert.ok(pView.chat.some((m) => m.text === "psst"), "whisper reaches its target");
  assert.ok(!pView.chat.some((m) => m.roll && m.roll.label === "GM roll"), "secret GM roll stays secret");
  assert.equal((await act(code, "p1", "char.delete", { id: gmChar.data.id })).code, 403);
});

test("photos: owners upload their own, nobody else's; replaced photos are deleted", async () => {
  const { code } = await setup();
  const mine = (await act(code, "p1", "char.save", { char: { name: "Kira" } })).data.id;
  const gmChar = (await act(code, "gm1", "char.save", { char: { name: "Villain" } })).data.id;
  const up = await post("upload", { clientId: "p1", code, purpose: "photo", charId: mine, kind: "token", dataUrl: PNG_URL });
  assert.equal(up.code, 200);
  const img = await call("GET", { img: up.data.url.split("=")[1] });
  assert.equal(img.headers["content-type"], "image/png");
  assert.ok(img.headers["cache-control"].includes("immutable"));
  const state = (await poll(code, "p1", "")).data.state;
  assert.equal(state.characters[mine].tokenImage, up.data.url);
  const again = await post("upload", { clientId: "p1", code, purpose: "photo", charId: mine, kind: "token", dataUrl: PNG_URL });
  assert.equal((await call("GET", { img: up.data.url.split("=")[1] })).code, 404, "old photo removed");
  assert.equal((await call("GET", { img: again.data.url.split("=")[1] })).code, 200);
  assert.equal((await post("upload", { clientId: "p1", code, purpose: "photo", charId: gmChar, kind: "profile", dataUrl: PNG_URL })).code, 403);
  assert.equal((await post("upload", { clientId: "p1", code, purpose: "bg", dataUrl: PNG_URL })).code, 403);
  assert.equal((await post("upload", { clientId: "p1", code, purpose: "photo", charId: mine, dataUrl: "data:text/html;base64,PGI+" })).code, 400);
});

test("asset packs: GM uploads in batches, everyone can load the images", async () => {
  const { code } = await setup();
  assert.equal((await post("packstart", { clientId: "p1", code, name: "Nope" })).code, 403);
  const start = await post("packstart", { clientId: "gm1", code, name: "Star Wars Props #1", bytes: 1000 });
  assert.equal(start.code, 200);
  const packId = start.data.packId;
  const items = [{ n: "Crate 4", c: "props", w: 350, h: 179, data: PNG.toString("base64") }, { n: "junk", c: "props", data: "bm90IGFuIGltYWdl" }];
  assert.equal((await post("packadd", { clientId: "gm1", code, packId, items })).data.count, 1, "non-images are skipped");
  assert.equal((await call("GET", { op: "assets" })).data.packs.length, 0, "unfinished packs are not listed");
  await post("packdone", { clientId: "gm1", code, packId });
  const lib = await call("GET", { op: "assets" });
  assert.equal(lib.data.packs[0].count, 1);
  const pack = await call("GET", { op: "pack", id: packId });
  assert.equal(pack.data.assets[0].n, "Crate 4");
  const asset = await call("GET", { a: pack.data.assets[0].src.split("a=")[1] });
  assert.equal(asset.code, 200);
  assert.equal(asset.headers["content-type"], "image/png");
  assert.equal((await act(code, "gm1", "prop.add", { src: pack.data.assets[0].src, x: 2, y: 2, w: 1.37, h: 0.7 })).code, 200);
  assert.equal((await act(code, "gm1", "prop.add", { src: "javascript:alert(1)" })).code, 400);
  await post("packdelete", { clientId: "gm1", code, packId });
  assert.equal((await call("GET", { op: "assets" })).data.packs.length, 0);
  assert.equal((await call("GET", { a: `${packId}.0` })).code, 404);
});

test("saving: export carries images, restore brings the game back under a GM", async () => {
  const { code } = await setup();
  const mine = (await act(code, "p1", "char.save", { char: { name: "Kira", hp: { max: 20, current: 7 } } })).data.id;
  await post("upload", { clientId: "p1", code, purpose: "photo", charId: mine, kind: "profile", dataUrl: PNG_URL });
  await act(code, "gm1", "notes.save", { notes: "the twist" });
  assert.equal((await call("GET", { op: "export", code, clientId: "p1" })).code, 403);
  const exp = await call("GET", { op: "export", code, clientId: "gm1" });
  assert.equal(exp.code, 200);
  const file = JSON.parse(exp.data);
  assert.equal(file._format, "holotable-campaign");
  assert.equal(Object.keys(file._images).length, 1);
  const backups = await post("backups", { clientId: "gm1", code });
  assert.ok(backups.data.backups.length >= 1);
  const rs = await post("restore", { clientId: "newgm", campaign: file, playerName: "Dee" });
  assert.equal(rs.code, 200);
  assert.notEqual(rs.data.code, code, "original still exists, so the copy gets a new code");
  const st = (await poll(rs.data.code, "newgm", "")).data.state;
  assert.equal(st.isGM, true);
  assert.equal(st.notes, "the twist");
  assert.equal(st.characters[mine].hp.current, 7);
  assert.equal((await post("restore", { clientId: "x", campaign: { hello: 1 } })).code, 400);
});

test("GM key lets the GM take over from another device", async () => {
  const { code, gmToken } = await setup();
  await post("join", { clientId: "laptop", code, playerName: "Dee", gmToken: "wrong-token-wrong-token" });
  assert.equal((await poll(code, "laptop", "")).data.state.isGM, false);
  await post("join", { clientId: "laptop", code, playerName: "Dee", gmToken });
  assert.equal((await poll(code, "laptop", "")).data.state.isGM, true);
});

test("two changes at once never lose either one", async () => {
  const { code } = await setup();
  await Promise.all(Array.from({ length: 12 }, (_, i) => act(code, i % 2 ? "gm1" : "p1", "chat", { text: "m" + i })));
  const chat = (await poll(code, "gm1", "")).data.state.chat.filter((m) => /^m\d+$/.test(m.text || ""));
  assert.equal(chat.length, 12);
});
