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
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PNG_URL = "data:image/png;base64," + PNG.toString("base64");

test("dice: keeps, drops, constants and natural 20s", () => {
  for (let i = 0; i < 200; i++) {
    const r = G.rollDice("2d20kh1+5");
    assert.ok(r.total >= 6 && r.total <= 25);
    assert.equal(r.total, r.nat + 5);
  }
  assert.equal(G.rollDice("1d8+1d6-2").nat, null);
  assert.equal((G.rollDice("4d6dl1").detail.match(/~/g) || []).length, 2);
  assert.throws(() => G.rollDice("1d20+abc"), G.Invalid);
  assert.throws(() => G.rollDice("500d6"), G.Invalid);
});

test("dice: a minimum roll threshold (min N) counts a lower die as N and shows it (#150)", () => {
  for (let i = 0; i < 300; i++) {
    const r = G.rollDice("2d6min2+1d12min5+3");
    assert.ok(r.total >= 2 + 2 + 5 + 3 && r.total <= 6 + 6 + 12 + 3, r.detail);
  }
  const crypto = require("crypto"), real = crypto.randomInt;
  try {
    const faces = [1, 5, 2, 1];
    crypto.randomInt = () => faces.shift();
    const r = G.rollDice("4d6min2");
    assert.deepEqual([r.total, r.detail], [11, "4d6min2[1→2,5,2,1→2]"], "a 1 counts as 2, and shows it");
  } finally { crypto.randomInt = real; }
  const d = G.rollDice("1d20min8+5");
  assert.ok(d.total >= 13 && d.nat >= 1 && d.nat <= 20, "the natural d20 is the die as rolled");
  assert.match(G.rollDice("1d8min3").detail, /^1d8min3\[/);
  assert.equal(G.rollDice("1d4min9").total, 4, "never above the die's own size");
  assert.ok(G.rollDice("1d8").detail.indexOf("min") < 0, "an expression without min rolls as before");
});

test("dice, review of #152: ! explodes on the natural maximum only, and one roll is at most 300 dice (refused, never cut short)", () => {
  const crypto = require("crypto"), real = crypto.randomInt;
  try {
    const faces = [1, 6, 3];
    crypto.randomInt = () => faces.shift();
    const r = G.rollDice("2d6min6!");
    assert.deepEqual([r.total, r.detail], [18, "2d6min6[1→6,6,3→6]"], "a 1 lifted to 6 doesn't explode; a natural 6 does, once");
  } finally { crypto.randomInt = real; }
  // min at the die's size no longer forces every die to explode: natural 2, 1, 2, 1… is 100 explosions, not 2,000
  try {
    let k = 0;
    crypto.randomInt = () => (k++ % 2 ? 1 : 2);
    const r = G.rollDice("100d2min2!");
    assert.deepEqual([r.total, (r.detail.match(/,/g) || []).length + 1], [400, 200], "200 dice, each counting 2");
  } finally { crypto.randomInt = real; }
  assert.doesNotThrow(() => G.rollDice("100d6+100d6+100d6"));
  assert.throws(() => G.rollDice("100d6+100d6+100d6+1d6"), (e) => e instanceof G.Invalid && /Too many dice/.test(e.message));
  // explosions count: 100 d1000 that always explode would be 2,100 dice
  try {
    crypto.randomInt = (a, b) => b - 1;
    assert.throws(() => G.rollDice("100d1000!"), (e) => e instanceof G.Invalid && /Too many dice/.test(e.message));
  } finally { crypto.randomInt = real; }
});

test("unset or equal passwords: every request is refused", async () => {
  fresh();
  const saved = [process.env.HOLOTABLE_PLAYER_PASSWORD, process.env.HOLOTABLE_GM_PASSWORD];
  try {
    for (const [pl, gmv] of [["", GM_PW], [PLAYER_PW, ""], ["", ""], ["same", "same"]]) {
      process.env.HOLOTABLE_PLAYER_PASSWORD = pl; process.env.HOLOTABLE_GM_PASSWORD = gmv;
      const b = browser();
      assert.equal((await b.login(pl || "x", "Sam")).code, 503);
      assert.equal((await b.poll()).code, 503);
      assert.equal((await b.call("GET", { op: "assets" })).code, 503);
      assert.equal((await b.call("GET", { img: "a".repeat(24) })).code, 503);
    }
  } finally { [process.env.HOLOTABLE_PLAYER_PASSWORD, process.env.HOLOTABLE_GM_PASSWORD] = saved; }
});

test("no session, no data: every read, write and image needs a signed session", async () => {
  const { gm } = await table();
  const up = await gm.post("upload", { purpose: "bg", dataUrl: PNG_URL });
  const imgId = up.data.url.split("=")[1];
  const anon = browser();
  for (const q of [{ op: "poll" }, { op: "assets" }, { op: "pack", id: "abc-123456" }, { op: "export" }, { op: "me" }, { img: imgId }, { a: "abc-123456.0" },
    { op: "audios" }, { aud: "au000000000000" }, { op: "files" }]) {
    assert.equal((await anon.call("GET", q)).code, 401, JSON.stringify(q));
  }
  for (const op of ["action", "upload", "backups", "restore", "packstart", "packadd", "packdone", "packdelete",
    "audiostart", "audiodone", "audiodelete", "filemove"]) {
    assert.equal((await anon.post(op, { type: "chat", payload: { text: "hi" } })).code, 401, op);
  }
  // a forged or tampered cookie is no better than none
  anon.cookie = "ht_session=" + Buffer.from(JSON.stringify({ pid: "a".repeat(24), role: "gm", exp: 9e9 })).toString("base64url") + ".bm9wZQ";
  assert.equal((await anon.poll()).code, 401);
  const [body, mac] = gm.cookie.split("=")[1].split(".");
  const asPlayer = JSON.parse(Buffer.from(body, "base64url").toString()); asPlayer.role = "player";
  anon.cookie = "ht_session=" + Buffer.from(JSON.stringify(asPlayer)).toString("base64url") + "." + mac;
  assert.equal((await anon.poll()).code, 401, "changing the role breaks the signature");
  // a POST without the custom header (what another site could send) is refused even with a good cookie
  assert.equal((await gm.call("POST", { op: "action" }, { type: "chat", payload: { text: "x" } }, { "x-holotable": "" })).code, 403);
});

test("wrong passwords are refused and slowed down", async () => {
  fresh();
  const b = browser("10.9.9.9");
  for (let i = 0; i < 10; i++) assert.equal((await b.login("nope" + i, "x")).code, 401);
  assert.equal((await b.login(PLAYER_PW, "Sam")).code, 429, "even the right password waits after 10 misses");
  assert.equal((await browser("10.9.9.10").login(PLAYER_PW, "Sam")).code, 200, "other addresses unaffected");
});

test("the GM probe: nothing a player receives works as anyone else's credential", async () => {
  const { gm, p1, p2 } = await table();
  await gm.act("notes.save", { notes: "the twist" });
  const rae = (await p2.act("char.save", { char: { name: "Rook" } })).data.id;
  const st = (await p1.poll()).data.state;
  assert.equal(st.isGM, false);
  assert.equal(st.notes, null);
  assert.equal(st.gmId, undefined);
  assert.equal(st.gmToken, undefined);
  // try every id the player can see (people, owners, online list) as a "clientId" and as a cookie
  const ids = new Set([...Object.keys(st.players), ...st.online.map((o) => o.clientId), ...Object.values(st.characters).map((c) => c.owner)]);
  assert.ok(ids.size >= 3);
  for (const id of ids) {
    const thief = browser();
    thief.cookie = "ht_session=" + id;
    assert.equal((await thief.poll()).code, 401);
    const asP1 = browser(); asP1.cookie = p1.cookie;
    const r = await asP1.call("GET", { op: "poll", clientId: id, v: "" });
    assert.equal(r.data.state.isGM, false, "a clientId parameter changes nothing");
    assert.equal(r.data.state.notes, null);
    assert.equal((await asP1.post("action", { clientId: id, type: "char.save", payload: { char: { id: rae, name: "HACKED" } } })).code, 403);
  }
  assert.equal((await p1.call("GET", { op: "export" })).code, 403);
});

test("a player session can't do GM actions", async () => {
  const { p1 } = await table();
  for (const [type, payload] of [["init.next", {}], ["init.clear", {}], ["notes.save", { notes: "x" }], ["map.settings", { cols: 9 }],
    ["prop.add", { src: "/api/holotable?a=abc-123456.0" }], ["handout.save", { handout: { title: "x" } }], ["levelup.grant", { charIds: ["x"] }],
    ["chat.clear", {}], ["campaign.rename", { name: "x" }], ["map.bg", { url: null }]]) {
    assert.equal((await p1.act(type, payload)).code, 403, type);
  }
  for (const op of ["packstart", "packdelete", "backups", "restore"]) assert.equal((await p1.post(op, {})).code, 403, op);
  assert.equal((await p1.post("upload", { purpose: "bg", dataUrl: PNG_URL })).code, 403);
});

test("long-poll wakes up as soon as something changes", async () => {
  const { gm, p1 } = await table();
  const first = await p1.poll();
  const t0 = Date.now();
  const waiting = p1.poll(first.data.v, 5000);
  setTimeout(() => gm.act("chat", { text: "Hello there" }), 150);
  const r = await waiting;
  assert.ok(Date.now() - t0 < 900, `woke after ${Date.now() - t0} ms; pub/sub should wake it right away`);
  assert.equal(r.data.state.chat.at(-1).text, "Hello there");
  assert.equal((await p1.poll(r.data.v, 100)).data.same, true);
});

test("characters: owners edit their own; hidden things stay hidden; whispers stay private", async () => {
  const { gm, p1, p2 } = await table();
  const mine = (await p1.act("char.save", { char: { name: "Kira", hp: { max: 20, current: 20 } } })).data.id;
  const rook = (await p2.act("char.save", { char: { name: "Rook" } })).data.id;
  assert.equal((await p1.act("char.save", { char: { id: rook, name: "HACKED" } })).code, 403);
  assert.equal((await gm.act("char.save", { char: { id: mine, name: "Kira Vos" } })).code, 200);
  await gm.act("init.add", { name: "Sniper", bonus: 3, hp: 30, hidden: true });
  await gm.act("init.add", { name: "Trooper", bonus: 1, hp: 13 });
  await p1.act("init.add", { charId: mine, name: "Kira", bonus: 2 });
  await gm.act("chat", { text: "/w Sam psst" });
  await gm.act("chat", { text: "/gmr 1d20" });
  await p2.act("chat", { text: "/w gm only for you" });
  const gv = (await gm.poll()).data.state, pv = (await p1.poll()).data.state, rv = (await p2.poll()).data.state;
  assert.equal(gv.initiative.entries.length, 3);
  assert.deepEqual(pv.initiative.entries.map((e) => e.name).sort(), ["Kira", "Trooper"]);
  assert.equal(pv.initiative.entries.find((e) => e.name === "Trooper").hp, null);
  assert.ok(pv.chat.some((m) => m.text === "psst"));
  assert.ok(!rv.chat.some((m) => m.text === "psst"), "whisper to Sam isn't shown to Rae");
  assert.ok(!pv.chat.some((m) => m.roll && m.roll.label === "GM roll"));
  assert.ok(gv.chat.some((m) => m.text === "only for you"), "/w gm reaches the GM");
  assert.ok(!pv.chat.some((m) => m.text === "only for you"));
});

test("what players send is cleaned: numbers stay numbers, no outside images, colours are colours", async () => {
  const { gm, p1 } = await table();
  const evil = '<img src=x onerror=alert(1)>';
  const id = (await p1.act("char.save", { char: { name: "Kira", ac: evil, speed: evil, hp: { max: evil, current: "12", temp: {} },
    abilities: { str: evil }, skills: { stealth: evil, "bad key<": 1 }, color: 'red;background:url(//x)', image: "https://evil.example/x.png",
    tokenImage: "/api/holotable?img=../../etc", classes: [{ name: "Sentinel", level: evil }], attacks: [{ name: "a", bonus: evil, magic: "2" }],
    powers: [{ name: "p", level: evil }], deathSaves: { s: evil } } })).data.id;
  const ch = (await p1.poll()).data.state.characters[id];
  assert.equal(ch.ac, 10); assert.equal(ch.speed, 30); assert.equal(ch.hp.max, 0); assert.equal(ch.hp.current, 12); assert.equal(ch.hp.temp, 0);
  assert.equal(ch.abilities.str, 10); assert.equal(ch.skills.stealth, 0); assert.equal(ch.skills["bad key<"], undefined);
  assert.equal(ch.color, "#4fc3f7"); assert.equal(ch.image, ""); assert.equal(ch.tokenImage, "");
  assert.equal(ch.classes[0].level, 1); assert.equal(ch.attacks[0].bonus, ""); assert.equal(ch.attacks[0].magic, 2); assert.equal(ch.powers[0].level, 0);
  await p1.act("init.add", { charId: id, name: "Kira", bonus: 1 });
  await gm.act("init.add", { name: "x", bonus: 0, hp: evil, ac: evil });
  const e = (await gm.poll()).data.state.initiative.entries;
  for (const x of e) for (const k of ["init", "hp", "maxHp", "ac"]) assert.ok(x[k] === null || typeof x[k] === "number", `${k} is ${x[k]}`);
  const ent = e.find((x) => x.charId === id);
  assert.equal((await gm.act("init.update", { id: ent.id, fields: { maxHp: evil, init: evil, conditions: [evil] } })).code, 200);
  const e2 = (await gm.poll()).data.state.initiative.entries.find((x) => x.id === ent.id);
  assert.equal(e2.maxHp, null); assert.equal(typeof e2.init, "number");
  await gm.act("token.add", { name: "T", color: "javascript:x", img: "https://evil.example/t.png" });
  const t = (await gm.poll()).data.state.map.tokens[0];
  assert.equal(t.color, "#4fc3f7"); assert.equal(t.img, null);
  assert.equal((await gm.act("prop.add", { src: "https://evil.example/p.png" })).code, 400);
  await gm.act("handout.save", { handout: { title: "h", img: "https://evil.example/h.png", shared: true } });
  assert.equal((await p1.poll()).data.state.handouts[0].img, null);
});

test("photos: owners upload their own; replaced photos are deleted and storage freed", async () => {
  const { gm, p1, p2 } = await table();
  const mine = (await p1.act("char.save", { char: { name: "Kira" } })).data.id;
  const theirs = (await p2.act("char.save", { char: { name: "Rook" } })).data.id;
  const up = await p1.post("upload", { purpose: "photo", charId: mine, kind: "token", dataUrl: PNG_URL });
  assert.equal(up.code, 200);
  const img = await p2.call("GET", { img: up.data.url.split("=")[1] });
  assert.equal(img.headers["content-type"], "image/png");
  assert.match(img.headers["cache-control"], /^private/);
  assert.equal((await p1.poll()).data.state.characters[mine].tokenImage, up.data.url);
  const before = await S.used();
  const again = await p1.post("upload", { purpose: "photo", charId: mine, kind: "token", dataUrl: PNG_URL });
  assert.equal((await p1.call("GET", { img: up.data.url.split("=")[1] })).code, 404, "old photo removed");
  assert.equal(await S.used(), before, "storage counter unchanged after replace");
  assert.equal((await p1.call("GET", { img: again.data.url.split("=")[1] })).code, 200);
  assert.equal((await p1.post("upload", { purpose: "photo", charId: theirs, kind: "profile", dataUrl: PNG_URL })).code, 403);
  assert.equal((await p1.post("upload", { purpose: "photo", charId: mine, dataUrl: "data:text/html;base64,PGI+" })).code, 400);
  void gm;
});

test("storage has a hard cap across photos, maps and packs", async () => {
  const { gm, p1 } = await table();
  const mine = (await p1.act("char.save", { char: { name: "Kira" } })).data.id;
  await db.set(S.K.bytes(), String(S.STORAGE_CAP - 10));
  assert.equal((await p1.post("upload", { purpose: "photo", charId: mine, kind: "token", dataUrl: PNG_URL })).code, 413);
  assert.equal((await gm.post("upload", { purpose: "bg", dataUrl: PNG_URL })).code, 413);
  assert.equal((await gm.post("packstart", { name: "Big", bytes: 1000 })).code, 413);
  assert.equal(+(await db.get(S.K.bytes())), S.STORAGE_CAP - 10, "refused uploads don't count");
});

test("asset packs: GM uploads in batches, players can see the art, only the GM deletes", async () => {
  const { gm, p1 } = await table();
  const packId = (await gm.post("packstart", { name: "Star Wars Props #1", bytes: 1000 })).data.packId;
  const items = [{ n: "Crate 4", c: "props", w: 350, h: 179, data: PNG.toString("base64") },
    { n: "<b>x</b>", c: '"><img src=x onerror=1>', data: PNG.toString("base64") }, { n: "junk", c: "props", data: "bm90IGFuIGltYWdl" }];
  assert.equal((await gm.post("packadd", { packId, items })).data.count, 2, "non-images are skipped");
  assert.equal((await p1.call("GET", { op: "assets" })).data.packs.length, 0, "unfinished packs are not listed");
  await gm.post("packdone", { packId });
  const pack = (await p1.call("GET", { op: "pack", id: packId })).data;
  assert.equal(pack.assets[0].n, "Crate 4");
  assert.equal(pack.assets[1].c, "props", "category is a plain word");
  assert.equal((await p1.call("GET", { a: pack.assets[0].src.split("a=")[1] })).headers["content-type"], "image/png");
  assert.equal((await gm.act("prop.add", { src: pack.assets[0].src, x: 2, y: 2, w: 1.37, h: 0.7 })).code, 200);
  assert.equal((await p1.post("packdelete", { packId })).code, 403);
  const used = await S.used();
  await gm.post("packdelete", { packId });
  assert.equal((await p1.call("GET", { op: "assets" })).data.packs.length, 0);
  assert.equal(await S.used(), used - 2 * PNG.length, "deleting a pack frees its space");
});

test("saving: export carries images; restore brings the game back, cleaned", async () => {
  const { gm, p1 } = await table();
  const mine = (await p1.act("char.save", { char: { name: "Kira", hp: { max: 20, current: 7 } } })).data.id;
  await p1.post("upload", { purpose: "photo", charId: mine, kind: "profile", dataUrl: PNG_URL });
  await gm.act("notes.save", { notes: "the twist" });
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  assert.equal(file._format, "holotable-campaign");
  assert.equal(Object.keys(file._images).length, 1);
  assert.ok((await gm.post("backups", {})).data.backups.length >= 1);
  await gm.act("notes.save", { notes: "changed my mind" });
  file.map.tokens = [{ id: "tok123456", name: "x", color: "url(evil)", img: "https://evil.example/a.png", x: 1, y: 1 }];
  assert.equal((await gm.post("restore", { campaign: file })).code, 200);
  const st = (await gm.poll()).data.state;
  assert.equal(st.notes, "the twist");
  assert.equal(st.characters[mine].hp.current, 7);
  assert.equal(st.map.tokens[0].img, null); assert.equal(st.map.tokens[0].color, "#4fc3f7");
  assert.equal((await p1.poll()).data.state.characters[mine].owner, (await p1.call("GET", { op: "me" })).data.you, "ownership survives");
  assert.equal((await gm.post("restore", { campaign: { hello: 1 } })).code, 400);
});

test("signing in again from the same browser keeps your characters", async () => {
  const { p1 } = await table();
  const me1 = (await p1.call("GET", { op: "me" })).data.you;
  await p1.post("logout", {});
  assert.equal((await p1.poll()).code, 401);
  assert.equal((await p1.login(PLAYER_PW, "Sam")).code, 200);
  assert.equal((await p1.call("GET", { op: "me" })).data.you, me1);
});

test("level up: GM grants to everyone or one character; players level their own", async () => {
  const { gm, p1, p2 } = await table();
  const kira = (await p1.act("char.save", { char: { name: "Kira", classes: [{ name: "Sentinel", level: 3 }], abilities: { con: 14, cha: 15 }, hp: { max: 24, current: 20 } } })).data.id;
  const rook = (await p2.act("char.save", { char: { name: "Rook", classes: [{ name: "Fighter", level: 3 }], abilities: { con: 12 }, hp: { max: 28, current: 28 } } })).data.id;
  assert.equal((await p1.act("levelup.apply", { charId: kira, className: "Sentinel", hpMode: "average" })).code, 400, "no level without a grant");
  assert.equal((await gm.act("levelup.grant", { charIds: [kira, rook], reason: "survived the ambush" })).code, 200);
  let st = (await p1.poll()).data.state;
  assert.equal(st.levelUps[kira].count, 1);
  assert.match(st.chat.at(-1).text, /Kira, Rook have earned a new level: survived the ambush/);
  assert.equal((await p2.act("levelup.apply", { charId: kira, className: "Sentinel", hpMode: "average" })).code, 403);
  assert.equal((await p1.act("levelup.apply", { charId: kira, className: "Sentinel", hpMode: "average", asi: { cha: 3 } })).code, 400);
  assert.equal((await p1.act("levelup.apply", { charId: kira, className: "Sentinel", hpMode: "average", asi: { cha: 1 } })).code, 400);
  const ok = await p1.act("levelup.apply", { charId: kira, className: "Sentinel", hpMode: "average", asi: { con: 1, cha: 1 },
    features: [{ name: "Ability Score Improvement", text: "" }], powers: [{ name: "Force Jump", level: 1, type: "force" }] });
  assert.equal(ok.code, 200);
  assert.deepEqual([ok.data.level, ok.data.hpGain], [4, 7]);
  st = (await p1.poll()).data.state;
  const k = st.characters[kira];
  assert.deepEqual([k.classes[0].level, k.hp.max, k.hp.current, k.abilities.con, k.abilities.cha], [4, 31, 27, 15, 16]);
  assert.equal(k.powers.at(-1).name, "Force Jump");
  assert.equal(st.levelUps[kira], undefined);
  await gm.act("levelup.grant", { charIds: [rook] });
  assert.equal((await p2.poll()).data.state.levelUps[rook].count, 2, "grants stack");
  assert.equal((await p2.act("levelup.apply", { charId: rook, className: "Fighter", hpMode: "average", asi: { con: 2 } })).data.hpGain, 6 + 2 + 3);
  const r2 = await p2.act("levelup.apply", { charId: rook, className: "Scout", hpMode: "roll" });
  assert.ok(r2.data.die >= 1 && r2.data.die <= 10);
  st = (await p2.poll()).data.state;
  assert.deepEqual(st.characters[rook].classes.map((c) => `${c.name} ${c.level}`), ["Fighter 4", "Scout 1"]);
  assert.ok(st.chat.some((m) => m.roll && /Rook: level 5 hit points \(d10\)/.test(m.roll.label)));
});

test("level up: the GM can level an absent player's character, and cancel a grant", async () => {
  const { gm, p1 } = await table();
  const kira = (await p1.act("char.save", { char: { name: "Kira", classes: [{ name: "Consular", level: 1 }], abilities: { con: 10 }, hp: { max: 6, current: 6 } } })).data.id;
  await gm.act("levelup.grant", { charIds: [kira] });
  const r = await gm.act("levelup.apply", { charId: kira, className: "Consular", hpMode: "average", archetype: "Way of Lightning" });
  assert.equal(r.code, 200);
  assert.equal(r.data.hpGain, 4);
  await gm.act("levelup.grant", { charIds: [kira] });
  await gm.act("levelup.cancel", { charId: kira });
  assert.equal((await p1.poll()).data.state.levelUps[kira], undefined);
  assert.equal((await gm.act("levelup.grant", { charIds: [] })).code, 400);
});

test("two changes at once never lose either one", async () => {
  const { gm, p1 } = await table();
  await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? gm : p1).act("chat", { text: "m" + i })));
  assert.equal((await gm.poll()).data.state.chat.filter((m) => /^m\d+$/.test(m.text || "")).length, 12);
});

test("HoloTable's keys stay apart from Find time to hang's", async () => {
  const { gm, p1 } = await table();
  await p1.act("char.save", { char: { name: "Kira" } });
  await gm.post("upload", { purpose: "bg", dataUrl: PNG_URL });
  for (const k of db.kv.keys()) assert.match(k, /^htp?v?:/, k);
});

test("colour themes: each person saves their own; the GM theme is the GM's; colours are checked", async () => {
  const { gm, p1 } = await table();
  assert.equal((await p1.act("player.prefs", { theme: "sith", custom: { holo: "#ff0000", bg: "url(evil)", text: "red" } })).code, 200);
  const me = (await p1.call("GET", { op: "me" })).data.you;
  const prefs = (await p1.poll()).data.state.players[me].prefs;
  assert.deepEqual(prefs, { theme: "sith", custom: { holo: "#ff0000" } }, "only real #rrggbb colours are kept");
  assert.equal((await p1.act("player.prefs", { theme: "gm-green-silver" })).code, 403);
  assert.equal((await p1.act("player.prefs", { theme: "<script>" })).code, 400);
  assert.equal((await gm.act("player.prefs", { theme: "gm-green-silver" })).code, 200);
  const gmId = (await gm.call("GET", { op: "me" })).data.you;
  assert.equal((await gm.poll()).data.state.players[gmId].prefs.theme, "gm-green-silver");
});

test("the forge probe: knowing both passwords isn't enough to sign a session", async () => {
  const { p1 } = await table();
  const crypto = require("crypto");
  const me = (await p1.call("GET", { op: "me" })).data.you;
  // what a player could do offline before: rebuild the key from the passwords and sign a GM session
  const forge = (key) => {
    const body = Buffer.from(JSON.stringify({ pid: me, role: "gm", name: "x", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    return "ht_session=" + body + "." + crypto.createHmac("sha256", key).update(body).digest("base64url");
  };
  const v1 = crypto.createHash("sha256").update("holotable-session-v1\0" + GM_PW + "\0" + PLAYER_PW).digest();
  const v2noSecret = crypto.createHash("sha256").update("holotable-session-v2\0\0" + GM_PW + "\0" + PLAYER_PW).digest();
  for (const key of [v1, v2noSecret]) {
    const evil = browser(); evil.cookie = forge(key);
    assert.equal((await evil.poll()).code, 401, "a key from the passwords alone signs nothing");
  }
  // the secret lives only on the server, and is made once
  const secret = await db.get(S.K.secret());
  assert.match(secret, /^[a-f0-9]{64}$/);
  await p1.poll();
  assert.equal(await db.get(S.K.secret()), secret, "the secret is kept, not regenerated");
  // and a player's own cookie can't be used to check password guesses: it doesn't verify under any password-only key
  const [body, mac] = p1.cookie.split("=")[1].split(".");
  assert.notEqual(crypto.createHmac("sha256", v1).update(body).digest("base64url"), mac);
});

test("changing a password still signs everyone out", async () => {
  const { p1 } = await table();
  assert.equal((await p1.poll()).code, 200);
  const saved = process.env.HOLOTABLE_GM_PASSWORD;
  process.env.HOLOTABLE_GM_PASSWORD = "new-gm-password";
  try { assert.equal((await p1.poll()).code, 401); } finally { process.env.HOLOTABLE_GM_PASSWORD = saved; }
  assert.equal((await p1.poll()).code, 200, "and changing it back restores the old sessions");
});

test("one address's wrong guesses don't lock anyone else out", async () => {
  fresh();
  for (let n = 0; n < 25; n++) { const b = browser(`10.7.${n}.1`); for (let i = 0; i < 10; i++) await b.login("wrong" + i, "x"); }
  assert.equal((await browser("10.7.99.1").login(PLAYER_PW, "Sam")).code, 200, "250 failures from elsewhere don't block a new address");
});

test("a pack that runs out of room partway is removed and its space given back", async () => {
  const { gm } = await table();
  const before = await S.used();
  const packId = (await gm.post("packstart", { name: "Too Big", bytes: 10 })).data.packId;
  assert.equal((await gm.post("packadd", { packId, items: [{ n: "a", c: "props", data: PNG.toString("base64") }] })).code, 200);
  await db.set(S.K.bytes(), String(S.STORAGE_CAP - 5));            // the library fills up mid-upload
  const r = await gm.post("packadd", { packId, items: [{ n: "b", c: "props", data: PNG.toString("base64") }] });
  assert.equal(r.code, 413);
  assert.match(r.data.error, /library is full/);
  assert.equal(await db.hget(S.K.packs(), packId), null, "the half pack is gone");
  assert.equal(await db.get(S.K.asset(packId, 0)), null, "its images are gone");
  assert.equal(+(await db.get(S.K.bytes())), S.STORAGE_CAP - 5 - PNG.length, "the first batch's space was released");
  void before;
});

test("a missing save is never replaced by a blank table; the GM can restore", async () => {
  const { gm, p1 } = await table();
  await p1.act("char.save", { char: { name: "Kira" } });
  // ten minutes of play later, the next change makes an automatic backup that includes Kira
  const g = JSON.parse(await db.get(S.K.camp("main"))); g.lastBackup = 0; await db.set(S.K.camp("main"), JSON.stringify(g));
  await p1.act("chat", { text: "onwards" });
  await db.del(S.K.camp("main"));                                   // e.g. evicted by a full Redis
  const st = (await p1.poll()).data.state;
  assert.equal(st.missing, true);
  assert.equal(Object.keys(st.characters).length, 0);
  const r = await p1.act("char.save", { char: { name: "Rook" } });
  assert.equal(r.code, 409);
  assert.match(r.data.error, /restore/);
  assert.equal(await db.get(S.K.camp("main")), null, "nothing was saved over it");
  assert.equal((await gm.login(GM_PW, "Dee")).code, 200, "the GM can still sign in");
  assert.equal((await gm.post("restore", { backup: 0 })).code, 200);
  const back = (await p1.poll()).data.state;
  assert.equal(back.missing, undefined);
  assert.deepEqual(Object.values(back.characters).map((c) => c.name), ["Kira"]);
});

test("a full database says so", async () => {
  const { p1 } = await table();
  const realSet = db.set.bind(db);
  db.set = async (k, ...rest) => { if (String(k).includes(":camp:")) throw new Error("OOM command not allowed when used memory > 'maxmemory'."); return realSet(k, ...rest); };
  try {
    const r = await p1.act("chat", { text: "hello" });
    assert.equal(r.code, 507);
    assert.match(r.data.error, /database is full/);
  } finally { db.set = realSet; }
});

// The GM's ▲/▼ beside each initiative number send init.update with the shown value ± 1.
test("initiative: the GM's step buttons re-order the tracker for everyone; players can't nudge NPCs", async () => {
  const { gm, p1 } = await table();
  await gm.act("init.add", { name: "Trooper A", init: 12 });
  await gm.act("init.add", { name: "Trooper B", init: 12.5 });
  const order = (st) => st.initiative.entries.map((e) => e.name);
  let st = (await gm.poll()).data.state;
  assert.deepEqual(order(st), ["Trooper B", "Trooper A"]);
  const a = st.initiative.entries.find((e) => e.name === "Trooper A");
  assert.equal((await gm.act("init.update", { id: a.id, fields: { init: a.init + 1 } })).code, 200);   // ▲
  st = (await p1.poll()).data.state;
  assert.deepEqual(order(st), ["Trooper A", "Trooper B"], "the player sees the new order");
  assert.equal(st.initiative.entries[0].init, 13);
  assert.equal((await gm.act("init.update", { id: a.id, fields: { init: 13 - 1 } })).code, 200);        // ▼
  assert.deepEqual(order((await gm.poll()).data.state), ["Trooper B", "Trooper A"]);
  assert.equal((await p1.act("init.update", { id: a.id, fields: { init: 99 } })).code, 403, "players can't nudge an NPC");
  assert.equal((await gm.act("init.update", { id: a.id, fields: { init: "<b>14</b>" } })).code, 200);
  assert.equal(typeof (await gm.poll()).data.state.initiative.entries.find((e) => e.id === a.id).init, "number", "init stays a number");
});

test("pack batches: art goes to the file store, not Redis, and a retried batch isn't added twice", async () => {
  const { gm, p1 } = await table();
  const packId = (await gm.post("packstart", { name: "Retry Pack", bytes: 10 })).data.packId;
  const items = [{ n: "a", c: "props", data: PNG.toString("base64") }, { n: "b", c: "props", data: PNG.toString("base64") }];
  assert.equal((await gm.post("packadd", { packId, seq: 0, items })).data.count, 2);
  assert.deepEqual([...store.files.keys()].sort(), [`ht/pack/${packId}/0`, `ht/pack/${packId}/1`], "each asset is a file in the store");
  assert.equal(await db.getBuffer(S.K.asset(packId, 0)), null, "and none of it is in Redis");
  const again = await gm.post("packadd", { packId, seq: 0, items }); // the browser retries after a timeout
  assert.equal(again.data.count, 2);
  assert.equal(again.data.repeat, true);
  assert.equal((await gm.post("packadd", { packId, seq: 1, items: items.slice(0, 1) })).data.count, 3);
  assert.equal(store.files.size, 3);
  await gm.post("packdone", { packId });
  const art = await p1.call("GET", { a: `${packId}.2` });
  assert.equal(art.code, 200);
  assert.ok(Buffer.from(art.data).equals(PNG), "a player gets the art back through the function");
  assert.equal(art.headers["content-type"], "image/png");
});

test("pack batches: a store that fails partway leaves no half pack and gives every byte back", async () => {
  const { gm } = await table();
  const packId = (await gm.post("packstart", { name: "Flaky Pack", bytes: 10 })).data.packId;
  const items = Array.from({ length: 5 }, (_, i) => ({ n: "x" + i, c: "props", data: PNG.toString("base64") }));
  assert.equal((await gm.post("packadd", { packId, seq: 0, items })).code, 200);
  store.failPuts = 1;
  const r = await gm.post("packadd", { packId, seq: 1, items });
  assert.ok(r.code >= 500, `the failure is reported (${r.code})`);
  assert.equal(await db.hget(S.K.packs(), packId), null, "the pack is gone");
  assert.equal(store.files.size, 0, "and so is all of its art");
  assert.equal(await db.hlen(S.K.files()), 0);
  assert.equal(await S.used(), 0, "and the storage count is back to zero");
});

test("chat: whisper a character (reaches whoever plays it), yell to everyone, out-of-character talk", async () => {
  const { gm, p1, p2 } = await table();
  await p1.act("char.save", { char: { name: "Kira Vos" } });
  await p2.act("char.save", { char: { name: "Kira" } });            // a shorter name that is a prefix of the first
  assert.equal((await gm.act("chat", { text: "/w Kira Vos meet me at the cantina" })).code, 200);
  assert.equal((await gm.act("chat", { text: "/whisper kira the droid is a spy" })).code, 200);
  const sam = (await p1.poll()).data.state.chat, rae = (await p2.poll()).data.state.chat;
  assert.ok(sam.some((m) => m.text === "meet me at the cantina" && m.whisperTo === "Kira Vos (Sam)"), "longest name wins: Kira Vos's player gets it");
  assert.ok(!rae.some((m) => m.text === "meet me at the cantina"));
  assert.ok(rae.some((m) => m.text === "the droid is a spy" && m.whisperTo === "Kira (Rae)"));
  assert.ok(!sam.some((m) => m.text === "the droid is a spy"));
  assert.equal((await p1.act("chat", { text: "/w Nobody hi" })).code, 400);
  assert.equal((await p1.act("chat", { text: "/w Rae" })).code, 400, "an empty whisper is refused");
  await p1.act("chat", { text: "/yell Incoming fighters!", as: "Kira Vos" });
  await p2.act("chat", { text: "/ooc brb, pizza" });
  const all = (await gm.poll()).data.state.chat;
  assert.ok(all.some((m) => m.yell && m.text === "Incoming fighters!" && m.as === "Kira Vos" && !m.to));
  assert.ok(all.some((m) => m.ooc && m.text === "brb, pizza"));
  assert.equal((await p1.act("chat", { text: "/desc the room darkens" })).code, 400, "only the GM narrates");
  assert.match((await p1.act("chat", { text: "/frobnicate" })).data.error, /Unknown command/);
});

test("scenes: the GM saves named map setups and switches everyone between them", async () => {
  const { gm, p1 } = await table();
  const mapUrl = (await gm.post("upload", { purpose: "bg", dataUrl: PNG_URL })).data.url;
  await gm.act("map.bg", { url: mapUrl });
  await gm.act("token.add", { name: "Bartender", x: 3, y: 4 });
  assert.equal((await p1.act("scene.saveAs", { name: "Cantina" })).code, 403, "players can't manage scenes");
  const cantina = (await gm.act("scene.saveAs", { name: "Cantina" })).data.id;
  // a blank new scene for the next part of the session
  const hangar = (await gm.act("scene.new", { name: "Hangar Bay 7" })).data.id;
  let st = (await p1.poll()).data.state;
  assert.equal(st.scene.name, "Hangar Bay 7");
  assert.equal(st.scenes, null, "players don't get the scene list");
  assert.equal(st.map.tokens.length, 0); assert.equal(st.map.bgUrl, null);
  await gm.act("token.add", { name: "Stormtrooper", x: 1, y: 1 });          // changes to the hangar...
  await gm.act("scene.load", { id: cantina });                               // ...are kept when switching away
  st = (await p1.poll()).data.state;
  assert.equal(st.scene.name, "Cantina");
  assert.equal(st.map.bgUrl, mapUrl);
  assert.deepEqual(st.map.tokens.map((t) => t.name), ["Bartender"]);
  assert.match(st.chat.at(-1).text, /The scene changes: Cantina/);
  await gm.act("scene.load", { id: hangar });
  assert.deepEqual((await p1.poll()).data.state.map.tokens.map((t) => t.name), ["Stormtrooper"], "the hangar kept its trooper");
  const gmView = (await gm.poll()).data.state;
  assert.deepEqual(gmView.scenes.map((x) => x.name), ["Cantina", "Hangar Bay 7"]);
  await gm.act("scene.rename", { id: hangar, name: "Docking Bay 94" });
  assert.equal((await gm.poll()).data.state.scene.name, "Docking Bay 94");
  // the cantina's background is still shown by a saved scene, so replacing the live map's background keeps it
  await gm.act("scene.load", { id: cantina });
  await gm.act("map.bg", { url: null });
  assert.equal((await gm.call("GET", { img: mapUrl.split("=")[1] })).code, 200, "kept: the saved Cantina scene still uses it");
  await gm.act("scene.load", { id: hangar });                                 // cantina saved without its background now
  await gm.act("scene.delete", { id: cantina });
  assert.equal((await gm.call("GET", { img: mapUrl.split("=")[1] })).code, 404, "freed once nothing uses it");
  assert.deepEqual((await gm.poll()).data.state.scenes.map((x) => x.name), ["Docking Bay 94"]);
  assert.equal((await gm.act("scene.load", { id: "nosuchscene" })).code, 400);
});

test("the SW5e power list is fetched by the server once, trimmed, cached, and needs a session", async () => {
  const { p1 } = await table();
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    assert.match(String(url), /sw5eapi/);
    return { ok: true, text: async () => JSON.stringify([
      { name: "Force Push", powerType: "Force", level: 1, forceAlignment: "Universal", castingPeriodText: "1 action", range: "60 feet", duration: "Instantaneous", concentration: false, prerequisite: null, contentSource: "PHB", description: "Shove.\r\nHard.", higherLevelDescription: "None" },
      { name: "Shock", powerType: "Force", level: 0, forceAlignment: "Dark", castingPeriodText: "1 action", range: "Touch", duration: "Instantaneous", concentration: false, description: "Zap." },
      { name: "Encrypted Message", powerType: "Tech", level: 0, forceAlignment: "None", castingPeriodText: "1 action", range: "120 feet", duration: "1 round", description: "Beep." },
      { name: "Not a power", powerType: "Maneuver", level: 1 },
    ]) };
  };
  try {
    assert.equal((await browser().call("GET", { op: "powers" })).code, 401, "no session, no list");
    const r1 = await p1.call("GET", { op: "powers" });
    assert.equal(r1.code, 200);
    const list = JSON.parse(r1.data);
    assert.deepEqual(list.map((x) => `${x.l} ${x.t} ${x.a} ${x.n}`), ["0 tech  Encrypted Message", "0 force dark Shock", "1 force universal Force Push"]);
    assert.equal(list[2].desc, "Shove.\nHard.");
    assert.equal(list[2].hl, "", "SW5e's \"None\" becomes empty");
    await p1.call("GET", { op: "powers" });
    assert.equal(calls, 1, "served from the cache the second time");
    await db.del(S.K.powers());
    calls = 0;
    global.fetch = async () => { calls++; throw new Error("offline"); };
    assert.equal((await p1.call("GET", { op: "powers" })).code, 503, "a clear error when SW5e can't be reached");
  } finally { global.fetch = realFetch; }
});

test("chat: nobody can post as someone else; the real sender is always on the message", async () => {
  const { gm, p1, p2 } = await table();
  await p1.act("char.save", { char: { name: "Kira Vos" } });
  await p2.act("char.save", { char: { name: "Fly" } });
  // Clawcius's probe: Sam tries to emote and yell as someone else's character
  await p1.act("chat", { text: "/me declares the session over", as: "Fly" });
  await p1.act("chat", { text: "/yell We're done here", as: "Fly" });
  await p1.act("chat", { text: "plain talk", as: "Fly" });
  let chat = (await gm.poll()).data.state.chat;
  const emote = chat.find((m) => m.emote), yell = chat.find((m) => m.yell), talk = chat.find((m) => m.text === "plain talk");
  assert.equal(emote.from, "Sam"); assert.equal(emote.as, null, "can't speak as a character you don't play");
  assert.equal(yell.from, "Sam"); assert.equal(yell.as, null);
  assert.equal(talk.from, "Sam"); assert.equal(talk.as, null);
  // speaking as your own character works, with the player still recorded
  await p1.act("chat", { text: "/me draws her blaster", as: "kira vos" });
  chat = (await gm.poll()).data.state.chat;
  const own = chat.filter((m) => m.emote).at(-1);
  assert.deepEqual([own.from, own.as], ["Sam", "Kira Vos"]);
  // the GM may voice any character
  await gm.act("chat", { text: "/me shrugs", as: "Fly" });
  const gmEmote = (await gm.poll()).data.state.chat.filter((m) => m.emote).at(-1);
  assert.deepEqual([gmEmote.from, gmEmote.as], ["Dee", "Fly"]);
  // a short cooldown between yells
  assert.equal((await p1.act("chat", { text: "/yell again!" })).code, 400);
});

test("SW5e equipment: standard gear and enhanced items, trimmed, cached, behind sign-in", async () => {
  const { p1 } = await table();
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    const enhanced = /enhancedItem$/.test(String(url));
    return { ok: true, text: async () => JSON.stringify(enhanced ? [
      { name: "AB-75 Bo-Rifle", type: "Weapon", subtype: "bo-rifle", contentSource: "WH", searchableRarity: "Prototype", requiresAttunement: false, text: "+2 to attack." },
      { name: "Turbolaser", type: "ShipWeapon", contentSource: "WH", searchableRarity: "Standard", text: "Starship part." },
    ] : [
      { name: "Blaster pistol", equipmentCategory: "Weapon", contentSource: "PHB", cost: 175, weight: "2.5", damageNumberOfDice: 1, damageDieType: 6, damageDieModifier: 0, damageType: "Energy", weaponClassification: "SimpleBlaster", properties: ["Power cell (range 50/200)", "reload 16"], description: "None" },
      { name: "Combat suit", equipmentCategory: "Armor", contentSource: "PHB", cost: 100, weight: "10", armorClassification: "Light", ac: "11 + Dex modifier", stealthDisadvantage: false, description: "Light armor." },
      { name: "Medpac", equipmentCategory: "Medical", contentSource: "PHB", cost: 300, weight: "0.5", description: "Heals." },
    ]) };
  };
  try {
    assert.equal((await browser().call("GET", { op: "equipment" })).code, 401);
    const std = JSON.parse((await p1.call("GET", { op: "equipment", set: "standard" })).data);
    const pistol = std.find((x) => x.n === "Blaster pistol");
    assert.deepEqual([pistol.cat, pistol.dmg, pistol.dt, pistol.wc, pistol.cost, pistol.desc], ["Weapon", "1d6", "energy", "Simple Blaster", 175, ""]);
    assert.deepEqual(pistol.props, ["Power cell (range 50/200)", "reload 16"]);
    assert.equal(std.find((x) => x.n === "Combat suit").ac, "11 + Dex modifier");
    const enh = JSON.parse((await p1.call("GET", { op: "equipment", set: "enhanced" })).data);
    assert.deepEqual(enh.map((x) => `${x.cat}:${x.n}:${x.rar}`), ["Weapon:AB-75 Bo-Rifle:Prototype"], "starship parts are left out");
    await p1.call("GET", { op: "equipment", set: "standard" });
    assert.equal(calls.length, 2, "each list is fetched once, then served from the cache");
  } finally { global.fetch = realFetch; }
});

test("SW5e lists: an oversized reply fails cleanly and caches nothing", async () => {
  const { gm, p1 } = await table();
  const realFetch = global.fetch;
  let calls = 0, read = 0;
  const chunk = new Uint8Array(1024 * 1024).fill(32);   // 1 MB of spaces, over and over
  global.fetch = async () => {
    calls++;
    return { ok: true, headers: { get: () => null }, body: { getReader: () => ({
      read: async () => { read++; return read > 50 ? { done: true } : { done: false, value: chunk }; },
      cancel: async () => {},
    }) } };
  };
  try {
    assert.equal((await p1.call("GET", { op: "powers" })).code, 503, "too big: the picker fails");
    assert.ok(read <= 4, `stopped reading early (read ${read} MB)`);
    assert.equal(await db.get(S.K.powers()), null, "nothing cached");
    // a declared size over the cap isn't read at all
    await db.del(S.K.sw5eFail("standard"));
    read = 0;
    global.fetch = async () => ({ ok: true, headers: { get: (h) => (h === "content-length" ? String(500 * 1024 * 1024) : null) },
      body: { getReader: () => ({ read: async () => { read++; return { done: true }; }, cancel: async () => {} }) } });
    assert.equal((await p1.call("GET", { op: "equipment", set: "standard" })).code, 503);
    assert.equal(read, 0, "never read a reply that says it's too big");
    // too many entries also fails
    await db.del(S.K.sw5eFail("powers"));
    global.fetch = async () => ({ ok: true, text: async () => JSON.stringify(Array.from({ length: 5000 }, (_, i) => ({ name: "P" + i, powerType: "Force", level: 1 }))) });
    assert.equal((await p1.call("GET", { op: "powers" })).code, 503);
    assert.equal(await db.get(S.K.powers()), null);
    // the game is untouched
    assert.equal((await gm.poll()).code, 200);
  } finally { global.fetch = realFetch; }
});

test("SW5e lists: a failed fetch isn't retried for a minute, and only one request fetches at a time", async () => {
  const { p1, p2 } = await table();
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 500 }; };
  try {
    for (let i = 0; i < 5; i++) assert.equal((await p1.call("GET", { op: "equipment", set: "enhanced" })).code, 503);
    assert.equal(calls, 1, "four reopenings answered from the remembered failure");
    assert.equal(await db.get(S.K.sw5eFail("enhanced")), "1", "the failure is remembered (for 60 s)");
    await db.del(S.K.sw5eFail("enhanced"));
    await p1.call("GET", { op: "equipment", set: "enhanced" });
    assert.equal(calls, 2, "once it expires, the next request tries SW5e again");
    calls = 1;
    // other lists are separate
    await p1.call("GET", { op: "powers" });
    assert.equal(calls, 2);
    // two people opening the picker at once: one fetch, both get the list
    calls = 0;
    let release;
    const gate = new Promise((ok) => { release = ok; });
    global.fetch = async () => { calls++; await gate; return { ok: true, text: async () => JSON.stringify([{ name: "Medpac", equipmentCategory: "Medical", contentSource: "PHB" }]) }; };
    const a = p1.call("GET", { op: "equipment", set: "standard" }), b = p2.call("GET", { op: "equipment", set: "standard" });
    await new Promise((ok) => setTimeout(ok, 100));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    assert.deepEqual([ra.code, rb.code], [200, 200]);
    assert.equal(JSON.parse(rb.data)[0].n, "Medpac");
    assert.equal(calls, 1, "the second request waited for the first instead of fetching");
  } finally { global.fetch = realFetch; }
});

test("SW5e books: every other list comes through op=sw5e, trimmed, from fixed paths only", async () => {
  const { gm, p1 } = await table();
  const realFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    const path = String(url).split("/api/")[1];
    const data = {
      species: [{ name: "Bith", contentSource: "PHB", size: "Medium", language: "Bith", traits: [{ name: "Ability Score Increase", description: "+2 Int, +1 Dex" }, { name: "Speed", description: "Your base walking speed is 30 feet." }, { name: "Trance", description: "You meditate." }],
        abilitiesIncreased: [[{ abilities: ["Intelligence"], amount: 2 }, { abilities: ["Dexterity"], amount: 1 }]] },
        { name: "Human", contentSource: "PHB", traits: [], abilitiesIncreased: [[{ abilities: ["Any one"], amount: 2 }], [{ abilities: ["Any four"], amount: 1 }]] }],
      feature: [{ name: "Rage", level: 1, source: "Class", sourceName: "Berserker", text: "Rage.\r\nHard." }, { name: "Keen Senses", level: 1, source: "Species", sourceName: "Bith", text: "x" }],
      monster: [{ name: "Death Trooper", size: "Medium", types: ["humanoid"], armorClass: 16, hitPoints: 97, hitPointRoll: "15d8 + 30", speeds: "30 ft.", dexterity: 19, challengeRating: "6", contentSource: "SnV",
        behaviors: [{ name: "Blaster", monsterBehaviorType: "Action", attackType: "RangedWeapon", attackBonus: 7, damageRoll: "2d6 + 4", damageType: "Energy", descriptionWithLinks: "Ranged: [blaster](#blaster) shot." }] }],
      variantRule: [{ chapterName: "Flanking", chapterNumber: 0, contentMarkdown: "# Flanking\r\nText." }],
    }[path];
    return { ok: true, text: async () => JSON.stringify(data || []) };
  };
  try {
    assert.equal((await browser().call("GET", { op: "sw5e", list: "species" })).code, 401, "needs a session");
    assert.equal((await p1.call("GET", { op: "sw5e", list: "../power" })).code, 404, "only the fixed list names");
    assert.equal((await p1.call("GET", { op: "sw5e", list: "powers" })).code, 404, "the older lists keep their own routes");
    const sp = JSON.parse((await p1.call("GET", { op: "sw5e", list: "species" })).data);
    assert.deepEqual(sp.find((x) => x.n === "Bith").asi, { int: 2, dex: 1 }, "a fixed ability increase is recognised");
    assert.equal(sp.find((x) => x.n === "Human").asi, null, "a player's-choice increase is left to the player");
    const ft = JSON.parse((await p1.call("GET", { op: "sw5e", list: "features" })).data);
    assert.deepEqual(ft.map((x) => [x.n, x.lvl, x.k, x.of, x.text]), [["Rage", 1, "class", "Berserker", "Rage.\nHard."]], "class/archetype features only");
    const mon = JSON.parse((await p1.call("GET", { op: "sw5e", list: "monsters" })).data)[0];
    assert.deepEqual([mon.n, mon.ac, mon.hp, mon.ab.dex, mon.b[0].atk, mon.b[0].dmg, mon.b[0].d], ["Death Trooper", 16, 97, 19, 7, "2d6 + 4", "Ranged: blaster shot."]);
    await gm.act("settings.statBlocks", { hidden: true });   // 9.17: the GM keeps them
    assert.equal((await p1.call("GET", { op: "sw5e", list: "monsters" })).code, 403, "a player isn't sent the stat blocks");
    assert.equal((await gm.call("GET", { op: "sw5e", list: "monsters" })).code, 200, "the GM is");
    await gm.act("settings.statBlocks", { hidden: false });
    const vr = JSON.parse((await p1.call("GET", { op: "sw5e", list: "rules-variant" })).data);
    assert.equal(vr[0].n, "Flanking");
    await p1.call("GET", { op: "sw5e", list: "species" });
    assert.deepEqual(urls.map((u) => u.replace("https://sw5eapi.azurewebsites.net/api/", "")), ["species", "feature", "monster", "variantRule"], "each fetched once, from SW5e's fixed address");
  } finally { global.fetch = realFetch; }
});

test("variant rules and creature stat blocks: GM decides, players see only what they should", async () => {
  const { gm, p1 } = await table();
  assert.equal((await p1.act("variants.set", { variants: ["Flanking"] })).code, 403);
  await gm.act("variants.set", { variants: ["Flanking", "Flanking", "Called Shots", ""] });
  assert.deepEqual((await p1.poll()).data.state.variants, ["Flanking", "Called Shots"]);
  await gm.act("init.add", { name: "Trooper 1", bonus: 4, hp: 97, ac: 16, sb: "Death Trooper" });
  assert.equal((await gm.poll()).data.state.initiative.entries[0].sb, "Death Trooper");
  const seen = (await p1.poll()).data.state.initiative.entries[0];
  assert.equal(seen.sb, undefined, "players don't learn which creature it is");
  assert.equal(seen.hp, null);
  await p1.act("char.save", { char: { name: "Kira" } });
  const kira = Object.values((await p1.poll()).data.state.characters)[0];
  await p1.act("init.add", { charId: kira.id, name: "Kira", bonus: 2, sb: "Death Trooper" });
  assert.equal((await gm.poll()).data.state.initiative.entries.find((e) => e.charId).sb, undefined, "only GM NPCs carry a stat block");
});

test("starships: party ships are shared, hidden ships are the GM's, and everything is cleaned", async () => {
  const { gm, p1, p2 } = await table();
  const made = await p1.act("ship.save", { ship: { name: "Ebon Hawk", size: "Medium", tier: 9, ac: "15", hull: { current: 40, max: 50 }, hidden: true,
    abilities: { str: 14, dex: 99 }, skills: { boost: 2, hack: 1 }, crew: [{ charId: "nobody", name: "Kira", deployment: "Pilot", rank: 7 }, { deployment: "Smuggler" }],
    weapons: [{ name: "Quad laser", dmg: "2d4", type: "energy", atkMisc: 1 }], notes: "x".repeat(20000) } });
  assert.equal(made.code, 200);
  let sh = (await p2.poll()).data.state.ships[0];
  assert.deepEqual([sh.name, sh.size, sh.tier, sh.ac, sh.hull.current, sh.abilities.dex, sh.abilities.con, sh.hidden], ["Ebon Hawk", "Medium", 5, 15, 40, 30, 10, false], "players can't hide ships; numbers are clamped");
  assert.deepEqual([sh.skills.boost, sh.skills.hack, sh.crew[0].charId, sh.crew[0].rank, sh.crew[1].deployment, sh.notes.length], [2, undefined, null, 5, "", 10000]);
  sh.hull.current = 12; sh.model = "YT-2400";
  assert.equal((await p2.act("ship.save", { ship: sh })).code, 200, "anyone at the table can update a party ship");
  assert.deepEqual([(await gm.poll()).data.state.ships[0].model, (await gm.poll()).data.state.ships[0].hull.current], ["YT-2400", 40],
    "a sheet save keeps the server's current points (#151): they change through ship.points and the damage and repair actions");
  assert.equal((await p2.act("ship.points", { id: sh.id, what: "hull", current: 12 })).code, 200);
  assert.equal((await gm.poll()).data.state.ships[0].hull.current, 12);
  assert.equal((await p2.act("ship.delete", { id: sh.id })).code, 403, "only the GM or the ship's creator deletes it");
  await gm.act("ship.save", { ship: { name: "Imperial Interdictor", hidden: true } });
  assert.equal((await p1.poll()).data.state.ships.length, 1, "hidden ships stay with the GM");
  const enemy = (await gm.poll()).data.state.ships.find((x) => x.hidden);
  assert.equal((await p1.act("ship.save", { ship: Object.assign({}, enemy, { name: "mine now" }) })).code, 403);
  assert.equal((await p1.act("ship.delete", { id: sh.id })).code, 200);
  assert.deepEqual((await gm.poll()).data.state.ships.map((x) => x.name), ["Imperial Interdictor"]);
});

test("level-up wizard: maximum hit points, SW5e class features added once, picked powers keep their text", async () => {
  const { gm, p1 } = await table();
  const kira = (await p1.act("char.save", { char: { name: "Kira", classes: [{ name: "Fighter", level: 1 }], abilities: { con: 14 }, hp: { max: 12, current: 12 },
    features: [{ name: "Second Wind", text: "already here" }] } })).data.id;
  await gm.act("levelup.grant", { charIds: [kira] });
  const r = await p1.act("levelup.apply", { charId: kira, className: "Fighter", hpMode: "max",
    features: [{ name: "Action Surge", text: "Class feature (Fighter, level 2)" }, { name: "second wind", text: "duplicate" }],
    powers: [{ name: "Force Push", level: 1, type: "force", alignment: "universal", description: "Shove." }] });
  assert.equal(r.code, 200);
  assert.equal(r.data.hpGain, 10 + 2, "the full d10 plus Con");
  const ch = (await gm.poll()).data.state.characters[kira];
  assert.equal(ch.hp.max, 24);
  assert.deepEqual(ch.features.map((f) => f.name), ["Second Wind", "Action Surge"], "a feature already on the sheet isn't added twice");
  assert.equal(ch.powers[0].description, "Shove.");
});

test("SW5e caches: together they stay under a stated total; over it, that list answers 503 and nothing is cached", async () => {
  const { gm, p1 } = await table();
  const realFetch = global.fetch;
  // a feature list just under its own cap, but big enough to cross the total with the others
  const big = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ name: "F" + i, level: 1, source: "Class", sourceName: "Fighter", text: "x".repeat(3990) })));
  global.fetch = async (url) => ({ ok: true, text: async () => (/feature$/.test(String(url)) ? big(1300) : /monster$/.test(String(url)) ? big(1300).replace(/"source":"Class"/g, '"size":"Medium"') : "[]") });
  try {
    await db.set(S.K.sw5e("rules-ec"), "x", "EX", 100);
    await db.hset(S.K.sw5eSizes(), "rules-ec", String(handler.SW5E_TOTAL_MAX - 3 * 1024 * 1024));   // pretend most of the total is used
    const r = await p1.call("GET", { op: "sw5e", list: "features" });
    assert.equal(r.code, 503, "would go over the total");
    assert.equal(await db.get(S.K.sw5e("features")), null, "nothing cached");
    assert.equal((await gm.poll()).code, 200, "the game is untouched");
    await db.del(S.K.sw5e("rules-ec")); await db.del(S.K.sw5eFail("features"));
    assert.equal((await p1.call("GET", { op: "sw5e", list: "features" })).code, 200, "an expired list no longer counts");
    assert.ok(+(await db.hgetall(S.K.sw5eSizes())).features > 1024 * 1024);
    assert.equal((await db.hgetall(S.K.sw5eSizes()))["rules-ec"], undefined);
  } finally { global.fetch = realFetch; }
});

test("SW5e books switch: off turns off op=sw5e only; powers and equipment keep working", async () => {
  const { p1 } = await table();
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: true, text: async () => "[]" }; };
  handler.SW5E_BOOKS.on = false;
  try {
    const r = await p1.call("GET", { op: "sw5e", list: "species" });
    assert.equal(r.code, 503); assert.match(r.data.error, /switched on/);
    assert.equal(calls, 0, "nothing fetched for the books");
    assert.equal((await p1.poll()).data.state.sw5eBooks, false, "the page learns to hide the book buttons");
    assert.equal((await p1.call("GET", { op: "powers" })).code, 200, "the power picker is separate");
  } finally { handler.SW5E_BOOKS.on = true; global.fetch = realFetch; }
  assert.equal((await p1.poll()).data.state.sw5eBooks, true);
});

test("maximum hit points is the GM's table rule", async () => {
  const { gm, p1 } = await table();
  const kira = (await p1.act("char.save", { char: { name: "Kira", classes: [{ name: "Scout", level: 1 }] } })).data.id;
  assert.equal((await p1.poll()).data.state.hpMax, true, "on unless the GM turns it off");
  assert.equal((await p1.act("settings.hpMax", { on: false })).code, 403);
  await gm.act("settings.hpMax", { on: false });
  await gm.act("levelup.grant", { charIds: [kira] });
  assert.equal((await p1.act("levelup.apply", { charId: kira, className: "Scout", hpMode: "max" })).code, 400);
  assert.equal((await p1.act("levelup.apply", { charId: kira, className: "Scout", hpMode: "average" })).code, 200);
  assert.equal((await p1.poll()).data.state.hpMax, false);
});

test("archetypes: chosen once per class, on reaching class level 3, never before or after", async () => {
  const { gm, p1 } = await table();
  const kira = (await p1.act("char.save", { char: { name: "Kira", classes: [{ name: "Sentinel", level: 1 }] } })).data.id;
  const up = async (archetype) => { await gm.act("levelup.grant", { charIds: [kira] }); return p1.act("levelup.apply", { charId: kira, className: "Sentinel", hpMode: "average", archetype }); };
  const arch = async () => (await gm.poll()).data.state.characters[kira].classes[0].archetype;
  await up("Way of the Shield");
  assert.equal(await arch(), "", "not at level 2");
  await up("Way of the Shield");
  assert.equal(await arch(), "Way of the Shield", "picked at level 3");
  await up("Way of the Sword");
  assert.equal(await arch(), "Way of the Shield", "can't be changed by a later level up");
});

test("scene wipes: each scene change picks one wipe the whole table sees; saving doesn't", async () => {
  const { gm, p1 } = await table();
  await gm.act("scene.saveAs", { name: "Cantina" });
  assert.equal((await p1.poll()).data.state.sceneFx, null, "saving the board as a scene changes nothing on screen");
  const a = (await gm.act("scene.new", { name: "Hangar" })).data.id;
  const fx1 = (await p1.poll()).data.state.sceneFx;
  assert.match(fx1.n, /^[a-f0-9]{6,20}$/); assert.ok(fx1.k >= 0 && fx1.k < 8);
  assert.deepEqual((await gm.poll()).data.state.sceneFx, fx1, "the GM and players get the same wipe");
  const cantina = (await gm.poll()).data.state.scenes.find((s) => s.name === "Cantina").id;
  const seen = new Set([fx1.n]), kinds = new Set([fx1.k]);
  for (let i = 0; i < 30; i++) {
    await gm.act("scene.load", { id: i % 2 ? a : cantina });
    const fx = (await p1.poll()).data.state.sceneFx;
    seen.add(fx.n); kinds.add(fx.k);
  }
  assert.equal(seen.size, 31, "every change plays once");
  assert.ok(kinds.size > 3, "the wipe is random");
  await gm.act("scene.save", {});
  assert.ok(seen.has((await p1.poll()).data.state.sceneFx.n), "saving the current scene doesn't play a wipe");
});

test("scene movements: the GM scripts tokens; they play once after the scene loads; players never see the script", async () => {
  const { gm, p1 } = await table();
  await gm.act("map.settings", { cols: 20, rows: 12 });
  await gm.act("token.add", { name: "Bounty Hunter", x: 5, y: 5 });
  await gm.act("token.add", { name: "Lookout", x: 2, y: 2, hidden: true });
  await gm.act("token.add", { name: "Crate", x: 9, y: 9 });
  const toks = (await gm.poll()).data.state.map.tokens, hunter = toks[0].id, lookout = toks[1].id;
  assert.equal((await p1.act("token.script", { id: hunter, moves: { path: [{ x: 6, y: 5 }] } })).code, 403, "GM only");
  await gm.act("token.script", { id: hunter, moves: { path: [{ x: 8, y: 5 }, { x: 8, y: 9 }], exit: "e", delay: 1.3 } });
  await gm.act("token.script", { id: lookout, moves: { path: [{ x: 2, y: 4 }], exit: "nope", delay: 99 } });
  let gv = (await gm.poll()).data.state.map.tokens;
  assert.deepEqual(gv[0].moves, { path: [{ x: 8, y: 5 }, { x: 8, y: 9 }], exit: "e", delay: 1.5 });
  assert.deepEqual(gv[1].moves, { path: [{ x: 2, y: 4 }], exit: "", delay: 20 }, "cleaned");
  assert.equal((await p1.poll()).data.state.map.tokens[0].moves, undefined, "players can't see what's coming");
  // put it in a scene, switch away, come back: the movements play once
  const ambush = (await gm.act("scene.saveAs", { name: "Ambush" })).data.id;
  await gm.act("scene.new", { name: "Elsewhere" });
  await gm.act("scene.load", { id: ambush });
  const pv = (await p1.poll()).data.state;
  assert.deepEqual(pv.sceneFx.moves, [{ id: hunter, from: { x: 5, y: 5 }, path: [{ x: 8, y: 5 }, { x: 8, y: 9 }, { x: 21, y: 9 }], delay: 1.5 }], "exits off the right edge; the hidden lookout's move isn't sent to players");
  assert.ok(pv.sceneFx.k >= 0, "with a wipe");
  assert.deepEqual([pv.map.tokens[0].x, pv.map.tokens[0].y], [21, 9], "the server already put it where it ends");
  const gs = (await gm.poll()).data.state;
  assert.equal(gs.sceneFx.moves.length, 2, "the GM sees both");
  assert.deepEqual(gs.map.tokens.find((t) => t.id === lookout), Object.assign({}, gs.map.tokens.find((t) => t.id === lookout), { x: 2, y: 4 }));
  assert.ok(gs.map.tokens.every((t) => !t.moves), "played once");
  // switching away and back doesn't replay them
  await gm.act("scene.new", { name: "Elsewhere 2" });
  await gm.act("scene.load", { id: ambush });
  assert.deepEqual((await gm.poll()).data.state.sceneFx.moves, []);
  // ▶ Play on the current board, without a wipe
  assert.equal((await gm.act("scene.play", {})).code, 400, "nothing scripted");
  await gm.act("token.script", { id: hunter, moves: { path: [{ x: 20, y: 9 }] } });
  assert.equal((await p1.act("scene.play", {})).code, 403);
  assert.equal((await gm.act("scene.play", {})).data.moved, 1);
  const fx = (await p1.poll()).data.state.sceneFx;
  assert.equal(fx.k, -1, "no wipe for Play");
  assert.equal(fx.moves[0].from.x, 21);
});

test("scene movements work for asset pieces too, and a speeder can turn to face its path", async () => {
  const { gm, p1 } = await table();
  await gm.act("map.settings", { cols: 20, rows: 12 });
  const src = "/api/holotable?a=packone.1";
  await gm.act("prop.add", { src, name: "Speeder", x: 2, y: 4, w: 2, h: 1, rot: 0 });
  await gm.act("prop.add", { src, name: "Crate", x: 10, y: 10, w: 1, h: 1 });
  const sp = (await gm.poll()).data.state.map.props.find((x) => x.name === "Speeder");
  assert.ok(sp, "the test prop was placed");
  assert.equal((await p1.act("prop.script", { id: sp.id, moves: { path: [{ x: 6, y: 4 }] } })).code, 403, "GM only");
  await gm.act("prop.script", { id: sp.id, moves: { path: [{ x: 8, y: 4 }, { x: 8, y: 8 }], exit: "s", face: true } });
  assert.equal((await gm.poll()).data.state.map.props.find((x) => x.id === sp.id).moves.face, true);
  assert.equal((await p1.poll()).data.state.map.props.find((x) => x.id === sp.id).moves, undefined, "hidden from players");
  assert.equal((await gm.act("scene.play", {})).data.moved, 1);
  const st = (await p1.poll()).data.state, mv = st.sceneFx.moves[0];
  // its centre lands on each waypoint square's centre: x = 8 + 0.5 - 2/2
  assert.deepEqual([mv.prop, mv.from, mv.path], [true, { x: 2, y: 4 }, [{ x: 7.5, y: 4 }, { x: 7.5, y: 8 }, { x: 7.5, y: 13 }]]);
  const after = st.map.props.find((x) => x.id === sp.id);
  assert.deepEqual([after.x, after.y, after.rot], [7.5, 13, 90], "it ends off the bottom edge, turned to face down");
});

// #79: restoring a save that has initiative entries used to throw (n is not defined) and answer 500.
test("restore works when the saved table has people in initiative", async () => {
  const { gm, p1 } = await table();
  const kira = (await p1.act("char.save", { char: { name: "Kira", hp: { max: 20, current: 20 } } })).data.id;
  await p1.act("init.add", { charId: kira, name: "Kira", init: 14 });
  await gm.act("init.add", { name: "Trooper", init: "12", hp: 13 });
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  const fromFile = await gm.post("restore", { campaign: file });
  assert.equal(fromFile.code, 200, "restore from a file");
  const st = (await gm.poll()).data.state;
  assert.deepEqual(st.initiative.entries.map((e) => [e.name, e.init]), [["Kira", 14], ["Trooper", 12]]);
  assert.equal((await gm.post("restore", { backup: 0 })).code, 200, "restore the latest backup");
});


// #79 follow-up: one round trip on a fully populated table, so the next helper that moves out from under
// cleanGame() / cleanMap() / cleanChar() / cleanShip() is caught by a test instead of a 500 at the table.
test("restore round trip: a fully populated table comes back the same, from the file and from backup 0", async () => {
  const { gm, p1, p2 } = await table();
  const src = "/api/holotable?a=packone.1";
  // characters, one with conditions and powers
  const kira = (await p1.act("char.save", { char: { name: "Kira", classes: [{ name: "Sentinel", level: 3, archetype: "Path of Shadows" }],
    hp: { max: 24, current: 17, temp: 3 }, conditions: ["Slowed", "Shocked"], exhaustion: 1,
    powers: [{ name: "Force Push", level: 1, type: "force", alignment: "universal", description: "Shove." }],
    features: [{ name: "Cloak of Shadows", text: "Archetype feature" }], equipment: [{ name: "Medpac", qty: 2 }] } })).data.id;
  const rook = (await p2.act("char.save", { char: { name: "Rook", classes: [{ name: "Engineer", level: 2 }], tech: { max: "", used: 3 } } })).data.id;
  // initiative: a character and a creature with HP, conditions and a stat-block id
  await p1.act("init.add", { charId: kira, name: "Kira", init: 15 });
  await gm.act("init.add", { name: "Death Trooper 1", init: 12, hp: 97, ac: 16, sb: "Death Trooper", hidden: true });
  const trooper = (await gm.poll()).data.state.initiative.entries.find((e) => e.npc).id;
  await gm.act("init.update", { id: trooper, fields: { hp: 80, conditions: ["Ignited"] } });
  await gm.act("init.start", {});
  // map: tokens and props with scene movements, saved as a scene, then a second scene on screen
  await gm.act("map.settings", { cols: 20, rows: 12, showGrid: true });
  await gm.act("token.add", { charId: kira, x: 3, y: 4 });
  await gm.act("token.add", { name: "Vex", color: "#ef5350", x: 5, y: 4, hidden: true });
  await gm.act("prop.add", { src, name: "Speeder", x: 1, y: 6, w: 2, h: 1, rot: 0 });
  let mp = (await gm.poll()).data.state.map;
  await gm.act("token.script", { id: mp.tokens.find((t) => t.name === "Vex").id, moves: { path: [{ x: 8, y: 4 }], exit: "e", delay: 1 } });
  await gm.act("prop.script", { id: mp.props[0].id, moves: { path: [{ x: 9, y: 6 }], exit: "s", face: true } });
  await gm.act("scene.saveAs", { name: "Desert base" });
  await gm.act("scene.new", { name: "Cantina" });
  await gm.act("token.add", { name: "Bartender", x: 6, y: 3 });
  // a ship (party) and a hidden enemy ship
  await p1.act("ship.save", { ship: { name: "Ebon Hawk", size: "Medium", tier: 2, ac: 15, hull: { current: 30, max: 40 }, shield: { current: 10, max: 20 },
    abilities: { str: 14, wis: 12 }, skills: { boost: 1 }, crew: [{ charId: kira, deployment: "Pilot", rank: 2 }],
    weapons: [{ name: "Quad laser", dmg: "2d4", type: "energy", atkMisc: 1 }], mods: [{ name: "Hyperdrive" }] } });
  await gm.act("ship.save", { ship: { name: "Interdictor", hidden: true } });
  // handouts, notes, variants, the max-HP switch, a level-up grant, chat with a whisper
  await gm.act("handout.save", { handout: { title: "Holocron", text: "for the table", shared: true } });
  await gm.act("handout.save", { handout: { title: "Twist", text: "GM eyes only", shared: false } });
  await gm.act("notes.save", { notes: "the twist" });
  await gm.act("variants.set", { variants: ["Flanking", "Called Shots"] });
  await gm.act("settings.hpMax", { on: false });
  await gm.act("levelup.grant", { charIds: [rook] });
  await p1.act("chat", { text: "hello table" });
  await gm.act("chat", { text: "/w Sam a secret for you" });
  await p1.act("player.prefs", { theme: "jedi-temple", custom: { holo: "#00ffaa" } });

  // what must survive, as the GM sees it (ids, grant tokens and timestamps aside)
  const snapshot = (st) => ({
    name: st.name, notes: st.notes, variants: st.variants, hpMax: st.hpMax,
    characters: Object.values(st.characters).map((c) => ({ id: c.id, owner: c.owner, name: c.name, classes: c.classes, hp: c.hp, conditions: c.conditions,
      exhaustion: c.exhaustion, powers: c.powers, features: c.features, equipment: c.equipment, tech: c.tech })).sort((a, b) => a.name.localeCompare(b.name)),
    initiative: { active: st.initiative.active, round: st.initiative.round, turn: st.initiative.turn,
      entries: st.initiative.entries.map((e) => ({ name: e.name, init: e.init, hp: e.hp, maxHp: e.maxHp, ac: e.ac, hidden: e.hidden, conditions: e.conditions, sb: e.sb, charId: e.charId })) },
    map: { cols: st.map.cols, rows: st.map.rows, showGrid: st.map.showGrid, tokens: st.map.tokens.map((t) => ({ id: t.id, name: t.name, x: t.x, y: t.y, hidden: t.hidden, charId: t.charId, moves: t.moves })),
      props: st.map.props.map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, w: p.w, h: p.h, rot: p.rot, moves: p.moves })) },
    scene: st.scene, scenes: st.scenes.map((s) => s.name),
    ships: st.ships.map((s) => { const { updated, ...rest } = s; return rest; }),
    handouts: st.handouts.map((h) => ({ title: h.title, text: h.text, shared: h.shared })),
    levelUps: Object.fromEntries(Object.entries(st.levelUps).map(([id, v]) => [id, v.count])),
    chat: st.chat.filter((m) => m.text !== "The table was restored from a backup.").map((m) => ({ from: m.from, text: m.text, to: m.to, private: m.private })),
    players: Object.values(st.players).map((p) => ({ name: p.name, prefs: p.prefs })).sort((a, b) => a.name.localeCompare(b.name)),
  });
  const before = snapshot((await gm.poll()).data.state);
  // the populated table really is populated
  assert.equal(before.characters.length, 2); assert.equal(before.initiative.entries.length, 2); assert.equal(before.ships.length, 2);
  assert.equal(before.handouts.length, 2); assert.deepEqual(before.scenes, ["Desert base", "Cantina"]);
  assert.ok(before.chat.some((m) => m.to && m.text === "a secret for you"), "the whisper is there");
  assert.ok(before.players.some((p) => p.prefs && p.prefs.theme === "jedi-temple"), "a player's colour theme is set");
  // the saved scene keeps its scripted movements
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  const desert = file.scenes.find((s) => s.name === "Desert base").map;
  assert.ok(desert.tokens.some((t) => t.moves) && desert.props.some((p) => p.moves && p.moves.face), "scene movements are in the save");

  // 1. restore from the downloaded file, after changing things so we know the restore did something
  await gm.act("notes.save", { notes: "changed my mind" });
  await gm.act("variants.set", { variants: [] });
  assert.equal((await gm.post("restore", { campaign: file })).code, 200, "restore from the file");
  assert.deepEqual(snapshot((await gm.poll()).data.state), before, "everything is back after restoring the file");
  // players still see only what they should
  const pv = (await p1.poll()).data.state;
  assert.equal(pv.handouts.length, 1); assert.equal(pv.ships.length, 1); assert.equal(pv.notes, null);
  assert.ok(pv.map.tokens.every((t) => !t.moves && t.name !== "Vex"));

  // 2. restore the latest automatic backup (the restore above kept the table as backup 0 first)
  await gm.act("notes.save", { notes: "changed my mind again" });
  assert.equal((await gm.post("restore", { backup: 0 })).code, 200, "restore backup 0");
  assert.deepEqual(snapshot((await gm.poll()).data.state), before, "everything is back after restoring backup 0");
  // and the restored table still plays: the saved scene loads and its movements play
  const desertId = (await gm.poll()).data.state.scenes.find((s) => s.name === "Desert base").id;
  assert.equal((await gm.act("scene.load", { id: desertId })).code, 200);
  assert.equal((await gm.poll()).data.state.sceneFx.moves.length, 2);
});

test("token names: the GM can hide a name; players get ??? (and no sheet link), in initiative too", async () => {
  const { gm, p1 } = await table();
  await gm.act("token.add", { name: "Grand Inquisitor", x: 3, y: 3, nameHidden: true });
  await gm.act("token.add", { name: "Stormtrooper", x: 4, y: 3 });
  await gm.act("init.add", { name: "Grand Inquisitor", init: 18, hp: 90 });
  assert.equal((await p1.act("token.add", { name: "Me", nameHidden: true })).code, 403, "players can't place loose tokens");
  let gv = (await gm.poll()).data.state;
  const inq = gv.map.tokens.find((t) => t.name === "Grand Inquisitor");
  assert.equal(inq.nameHidden, true, "the GM still sees the name, marked hidden");
  let pv = (await p1.poll()).data.state;
  assert.deepEqual(pv.map.tokens.map((t) => t.name), ["???", "Stormtrooper"]);
  assert.equal(pv.map.tokens[0].nameHidden, undefined);
  const e = pv.initiative.entries.find((x) => x.init === 18);
  assert.equal(e.name, "???"); assert.equal(e.tok, inq.id, "the client can still ring the right token");
  assert.ok(!JSON.stringify(pv).includes("Inquisitor"), "the name isn't sent to players anywhere");
  assert.equal((await p1.act("token.update", { id: inq.id, fields: { nameHidden: false } })).code, 403);
  await gm.act("token.update", { id: inq.id, fields: { nameHidden: false } });
  pv = (await p1.poll()).data.state;
  assert.equal(pv.map.tokens[0].name, "Grand Inquisitor", "revealed");
  assert.equal(pv.initiative.entries.find((x) => x.init === 18).name, "Grand Inquisitor");
});

test("token names: shownName gives other code (chat lines, the combat view) the name players see", () => {
  const camp = { map: { tokens: [{ id: "t1", name: "Grand Inquisitor", nameHidden: true }, { id: "t2", name: "Vexx", charId: "c1", nameHidden: true }, { id: "t3", name: "Rook" }] } };
  assert.equal(G.shownName(camp, { name: "Grand Inquisitor" }), "???");
  assert.equal(G.shownName(camp, { name: "Darth Vexx", charId: "c1" }), "???", "matched by sheet, whatever the entry is called");
  assert.equal(G.shownName(camp, { name: "Rook" }), "Rook");
  camp.map.tokens[0].hidden = true;
  assert.equal(G.shownName(camp, { name: "Grand Inquisitor" }), "Grand Inquisitor", "a token hidden outright masks nothing (its entry is hidden on its own)");
});

// Table audio: the GM uploads a track in 1 MiB parts; everyone streams it by byte range; the GM controls playback.
test("table audio: the GM uploads straight to the store, checked by content, streamed in ranges, counted against storage", async () => {
  const { gm, p1 } = await table();
  const MiB = 1024 * 1024;
  // a fake MP3: an ID3 header, then filler, 5.5 MiB long (more than one 4 MiB response)
  const mp3 = Buffer.alloc(Math.floor(5.5 * MiB));
  mp3.write("ID3", 0, "latin1"); for (let i = 10; i < mp3.length; i++) mp3[i] = i % 251;
  const usedBefore = (await gm.call("GET", { op: "audios" })).data.used;
  for (const op of ["audiostart", "audiodone", "audiodelete"]) assert.equal((await p1.post(op, {})).code, 403, op);
  assert.equal((await gm.post("audiostart", { name: "big.mp3", bytes: 40 * MiB })).code, 413, "too big");
  const st = (await gm.post("audiostart", { name: "Cantina Band.mp3", bytes: mp3.length })).data;
  assert.match(st.id, /^au[a-f0-9]{12}$/);
  assert.equal(st.put.method, "PUT");
  assert.equal(st.put.headers["x-vercel-blob-access"], "private");
  // the URL only takes this one file, at most its declared size
  assert.equal((await store.presignedPut(st.put.url, Buffer.concat([mp3, Buffer.alloc(1)]), st.put.headers["content-type"]))[0], 413, "no more than declared");
  assert.equal((await gm.post("audioadd", { id: st.id, seq: 0, data: "AAAA" })).code, 404, "the old 1 MiB parts are gone");
  assert.equal((await store.presignedPut(st.put.url, mp3, st.put.headers["content-type"]))[0], 200);
  assert.ok(store.files.has(`ht/aud/${st.id}`), "the file went straight to the store");
  assert.equal((await p1.call("GET", { aud: st.id })).code, 404, "nothing plays until the server has checked it");
  assert.equal((await gm.post("audiodone", { id: st.id })).code, 200);
  assert.equal((await gm.post("audiodone", { id: st.id })).code, 200, "a retried done is harmless");
  const list = (await p1.call("GET", { op: "audios" })).data;
  assert.deepEqual(list.tracks.map((t) => [t.name, t.bytes, t.type]), [["Cantina Band", mp3.length, "audio/mpeg"]]);
  assert.equal(list.used - usedBefore, mp3.length, "counted against the storage cap, once");
  // streaming: needs a session; ranges; never more than 4 MiB per response
  assert.equal((await browser().call("GET", { aud: st.id })).code, 401);
  let r = await p1.call("GET", { aud: st.id });
  assert.equal(r.code, 206); assert.equal(r.headers["content-type"], "audio/mpeg", "the sniffed type, not what the upload said");
  assert.equal(r.headers["content-range"], `bytes 0-${4 * MiB - 1}/${mp3.length}`);
  assert.ok(Buffer.compare(r.data, mp3.subarray(0, 4 * MiB)) === 0, "the first 4 MiB come back intact");
  r = await p1.call("GET", { aud: st.id }, undefined, { range: `bytes=${4 * MiB}-` });
  assert.ok(Buffer.compare(r.data, mp3.subarray(4 * MiB)) === 0, "and the rest on the next range");
  r = await p1.call("GET", { aud: st.id }, undefined, { range: `bytes=${MiB - 5}-${MiB + 4}` });
  assert.equal(r.code, 206); assert.equal(r.headers["content-range"], `bytes ${MiB - 5}-${MiB + 4}/${mp3.length}`);
  assert.ok(Buffer.compare(r.data, mp3.subarray(MiB - 5, MiB + 5)) === 0, "a range in the middle");
  r = await p1.call("GET", { aud: st.id }, undefined, { range: "bytes=-10" });
  assert.ok(Buffer.compare(r.data, mp3.subarray(mp3.length - 10)) === 0, "a suffix range");
  assert.equal((await p1.call("GET", { aud: st.id }, undefined, { range: `bytes=${mp3.length}-` })).code, 416);
  assert.equal((await p1.call("GET", { aud: "au000000000000" })).code, 404);
  // not audio: refused when it's checked, and nothing kept
  const bad = (await gm.post("audiostart", { name: "notes.txt", bytes: 100 })).data;
  await store.presignedPut(bad.put.url, Buffer.alloc(100, 65), bad.put.headers["content-type"]);
  assert.equal((await gm.post("audiodone", { id: bad.id })).code, 415);
  assert.ok(!store.files.has(`ht/aud/${bad.id}`), "the rejected file is deleted from the store");
  // an upload that didn't arrive whole, or at all
  const short = (await gm.post("audiostart", { name: "short.mp3", bytes: 1000 })).data;
  await store.presignedPut(short.put.url, mp3.subarray(0, 900), short.put.headers["content-type"]);
  assert.equal((await gm.post("audiodone", { id: short.id })).code, 400);
  const none = (await gm.post("audiostart", { name: "never.mp3", bytes: 1000 })).data;
  assert.equal((await gm.post("audiodone", { id: none.id })).code, 400);
  let now = (await gm.call("GET", { op: "audios" })).data;
  assert.equal(now.tracks.length, 1); assert.equal(now.used - usedBefore, mp3.length, "failed uploads give their reservation back");
  // delete gives the space back
  assert.equal((await gm.post("audiodelete", { id: st.id })).code, 200);
  now = (await gm.call("GET", { op: "audios" })).data;
  assert.equal(now.tracks.length, 0); assert.equal(now.used, usedBefore);
  assert.equal((await p1.call("GET", { aud: st.id })).code, 404);
  assert.equal(store.files.size, 0, "the store is empty again");
});

test("table audio: room is reserved when an upload starts; an abandoned one is cleared after an hour", async () => {
  fresh();
  process.env.HOLOTABLE_STORAGE_MB = "";   // STORAGE_CAP is read at load; work against what's left of it instead
  const { gm } = await table();
  const cap = S.STORAGE_CAP;
  await db.set(S.K.bytes(), String(cap - 1000));
  const a = await gm.post("audiostart", { name: "a.mp3", bytes: 600 });
  assert.equal(a.code, 200);
  assert.equal((await gm.post("audiostart", { name: "b.mp3", bytes: 600 })).code, 413, "the first upload's room is already taken");
  // an hour later nobody finished it: the next start clears it away and its room comes back
  const t = JSON.parse(await db.hget(S.K.audios(), a.data.id)); t.added -= 3601; await db.hset(S.K.audios(), a.data.id, JSON.stringify(t));
  await store.presignedPut(a.data.put.url, Buffer.alloc(600), "application/octet-stream");
  assert.equal((await gm.post("audiostart", { name: "b.mp3", bytes: 600 })).code, 200);
  assert.ok(!store.files.has(`ht/aud/${a.data.id}`), "what the abandoned upload sent is deleted");
  assert.equal(await S.used(), cap - 1000 + 600);
});

// ---- the private Blob file store (#86)
// What a table uploaded before the store looks like: everything in Redis. One image, a three-image
// pack and a 2.5 MiB track in 1 MiB parts, counted against the storage cap as they were.
async function seedLegacy() {
  const MiB = 1024 * 1024;
  const imgId = "0123456789abcdef01234567", packId = "old-pack-abc123", trackId = "au0123456789ab";
  await db.set(S.K.img(imgId), PNG);
  await db.hset(S.K.packs(), packId, JSON.stringify({ id: packId, name: "Old Pack", author: "", count: 3, bytes: 3 * PNG.length, done: true, added: 1, categories: { props: 3 } }));
  await db.set(S.K.pack(packId), JSON.stringify(["a", "b", "c"].map((n) => ({ n, c: "props", w: null, h: null }))));
  for (let i = 0; i < 3; i++) await db.set(S.K.asset(packId, i), PNG);
  const mp3 = Buffer.alloc(Math.floor(2.5 * MiB));
  mp3.write("ID3", 0, "latin1"); for (let i = 10; i < mp3.length; i++) mp3[i] = (i * 7) % 253;
  for (let n = 0; n < 3; n++) await db.set(S.K.audioPart(trackId, n), mp3.subarray(n * MiB, Math.min(mp3.length, (n + 1) * MiB)));
  await db.hset(S.K.audios(), trackId, JSON.stringify({ id: trackId, name: "Old Track", bytes: mp3.length, parts: 3, got: mp3.length, type: "audio/mpeg", done: true, added: 1 }));
  const bytes = 4 * PNG.length + mp3.length;
  await S.reserve(bytes);
  return { imgId, packId, trackId, mp3, bytes };
}
// a whole track, read the way a browser does: range after range
async function readTrack(b, id) {
  const out = [];
  for (let at = 0; ;) {
    const r = await b.call("GET", { aud: id }, undefined, { range: `bytes=${at}-` });
    if (r.code !== 206) return r.code;
    out.push(Buffer.from(r.data));
    const m = /bytes (\d+)-(\d+)\/(\d+)/.exec(r.headers["content-range"]);
    at = +m[2] + 1;
    if (at >= +m[3]) return Buffer.concat(out);
  }
}
async function storedTrack(gm, name, bytes) {
  const st = (await gm.post("audiostart", { name, bytes: bytes.length })).data;
  assert.equal((await store.presignedPut(st.put.url, bytes, st.put.headers["content-type"]))[0], 200);
  assert.equal((await gm.post("audiodone", { id: st.id })).code, 200);
  return st.id;
}
async function storedPack(gm, name, n) {
  const packId = (await gm.post("packstart", { name, bytes: n * PNG.length })).data.packId;
  const items = Array.from({ length: n }, (_, i) => ({ n: "art" + i, c: "props", data: PNG.toString("base64") }));
  assert.equal((await gm.post("packadd", { packId, seq: 0, items })).code, 200);
  assert.equal((await gm.post("packdone", { packId })).code, 200);
  return packId;
}
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(1000, 7)]);

test("file store: nothing in it, or still in Redis, is readable without a session; storage ops are the GM's", async () => {
  const { gm, p1 } = await table();
  const img = (await gm.post("upload", { purpose: "bg", dataUrl: PNG_URL })).data.url.split("=")[1];
  const packId = await storedPack(gm, "Gate", 1);
  const track = await storedTrack(gm, "tone.wav", WAV);
  const old = await seedLegacy();
  assert.ok(store.files.has(`ht/img/${img}`) && store.files.has(`ht/pack/${packId}/0`) && store.files.has(`ht/aud/${track}`), "the new files are in the store");
  const anon = browser();
  for (const q of [{ img }, { a: `${packId}.0` }, { aud: track }, { img: old.imgId }, { a: `${old.packId}.0` }, { aud: old.trackId }]) {
    const mine = await p1.call("GET", q);
    assert.ok(mine.code === 200 || mine.code === 206, `a player reads ${JSON.stringify(q)} (${mine.code})`);
    assert.equal(mine.headers["x-content-type-options"], "nosniff");
    assert.match(String(mine.headers["cache-control"] || ""), /private/, "never cached by a CDN");
    assert.equal((await anon.call("GET", q)).code, 401, `no session: ${JSON.stringify(q)}`);
  }
  // a forged session is no better
  anon.cookie = "ht_session=" + Buffer.from(JSON.stringify({ pid: "a".repeat(24), role: "gm", exp: 9e9 })).toString("base64url") + ".bm9wZQ";
  assert.equal((await anon.call("GET", { img })).code, 401);
  assert.equal((await anon.call("GET", { aud: track })).code, 401);
  // the storage view and the move are the GM's
  assert.equal((await p1.call("GET", { op: "files" })).code, 403);
  for (const op of ["filemove", "audiostart", "audiodone", "audiodelete", "packstart"]) assert.equal((await p1.post(op, { id: track })).code, 403, op);
  // no store address, signed or not, reaches anyone who reads the table
  const seen = JSON.stringify([(await p1.poll()).data, (await gm.poll()).data, (await p1.call("GET", { op: "assets" })).data,
    (await p1.call("GET", { op: "pack", id: packId })).data, (await p1.call("GET", { op: "audios" })).data,
    (await gm.call("GET", { op: "files" })).data, (await gm.call("GET", { op: "export" })).data]);
  assert.ok(!/blob\.vercel-storage\.com|__fakeblob/.test(seen), "no store URL in any response");
});

test("a store that ignores byte ranges still serves the right bytes, and the log says so once", async () => {
  const { gm, p1 } = await table();
  const id = await storedTrack(gm, "tone.wav", WAV);
  const realGet = store.get.bind(store);
  store.get = async (p, o) => realGet(p, Object.assign({}, o, { headers: {} }));   // drops the Range header
  const warned = [], realWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(" "));
  try {
    for (const range of ["bytes=100-199", "bytes=500-"]) {
      const r = await p1.call("GET", { aud: id }, undefined, { range });
      const [, a, b] = /bytes=(\d+)-(\d*)/.exec(range);
      assert.equal(r.code, 206);
      assert.equal(Buffer.compare(Buffer.from(r.data), WAV.subarray(+a, b ? +b + 1 : WAV.length)), 0);
    }
  } finally { store.get = realGet; console.warn = realWarn; }
  assert.equal(warned.filter((w) => /ignored a byte range/.test(w)).length, 1, "said once, not on every request");
});

test("moving files out of Redis: everything arrives, nothing is lost, safe to stop part-way and to run again", async () => {
  const { gm, p1 } = await table();
  const old = await seedLegacy();
  await gm.act("map.bg", { url: `/api/holotable?img=${old.imgId}` });   // the game shows the old image
  const read = async () => ({
    img: Buffer.from((await p1.call("GET", { img: old.imgId })).data).toString("base64"),
    art: await Promise.all([0, 1, 2].map(async (n) => Buffer.from((await p1.call("GET", { a: `${old.packId}.${n}` })).data).toString("base64"))),
    aud: (await readTrack(p1, old.trackId)).toString("base64"),
  });
  const before = await read();
  assert.equal(before.aud, old.mp3.toString("base64"), "the old track plays from Redis");
  const used = await S.used();
  let rep = (await gm.call("GET", { op: "files" })).data;
  assert.deepEqual(rep.left, { images: 1, packArt: 3, tracks: 1 }, "the GM sees what's still in Redis");
  // the store fails part-way through the first run (the image is done, two of the pack's three images too)
  let puts = 0;
  const realPut = store.put.bind(store);
  store.put = async (...a) => { if (++puts === 3) throw new FakeBlob.BlobServiceNotAvailable("down"); return realPut(...a); };
  assert.equal((await gm.post("filemove", {})).code, 502, "the failure is reported");
  store.put = realPut;
  assert.deepEqual(await read(), before, "nothing is lost: every file still reads the same, from wherever it is");
  assert.equal(await S.used(), used, "and the storage count hasn't moved");
  rep = (await gm.call("GET", { op: "files" })).data;
  assert.equal(rep.left.images, 0); assert.ok(rep.left.packArt >= 1 && rep.left.tracks === 1, JSON.stringify(rep.left));
  // run again until it says it's finished
  let r, runs = 0;
  do { r = await gm.post("filemove", {}); assert.equal(r.code, 200); runs++; } while (r.data.more && runs < 10);
  assert.deepEqual(r.data.left, { images: 0, packArt: 0, tracks: 0 });
  assert.deepEqual(await read(), before, "every file reads the same from the store");
  assert.equal(await S.used(), used, "moving doesn't count anything twice");
  assert.equal(await db.getBuffer(S.K.img(old.imgId)), null, "the Redis copies are gone");
  for (let n = 0; n < 3; n++) { assert.equal(await db.getBuffer(S.K.asset(old.packId, n)), null); assert.equal(await db.getBuffer(S.K.audioPart(old.trackId, n)), null); }
  assert.deepEqual([...store.files.keys()].sort(), [`ht/aud/${old.trackId}`, `ht/img/${old.imgId}`, ...[0, 1, 2].map((n) => `ht/pack/${old.packId}/${n}`)].sort());
  assert.equal((await gm.call("GET", { op: "files" })).data.listed.audio.b, old.mp3.length);
  // a third run has nothing to do
  r = await gm.post("filemove", {});
  assert.equal(r.data.moved, 0); assert.equal(r.data.more, false);
  // and deleting the moved files gives back exactly what they took
  assert.equal((await gm.post("packdelete", { packId: old.packId })).code, 200);
  assert.equal((await gm.post("audiodelete", { id: old.trackId })).code, 200);
  await gm.act("map.bg", { url: null });
  assert.equal(await S.used(), used - old.bytes);
  assert.equal(store.files.size, 0, "the store is empty");
  assert.equal(await db.hlen(S.K.files()), 0, "and so is its index");
});

test("moving files: a file deleted while it's being moved stays deleted, and is counted once", async () => {
  const { gm } = await table();
  const old = await seedLegacy();
  const used = await S.used();
  // the GM deletes the pack and the track at the moment the move has copied them but not yet removed the Redis copies
  const realPut = store.put.bind(store);
  store.put = async (p, ...a) => {
    const out = await realPut(p, ...a);
    if (p === `ht/pack/${old.packId}/0`) await gm.post("packdelete", { packId: old.packId });
    if (p === `ht/aud/${old.trackId}`) await gm.post("audiodelete", { id: old.trackId });
    return out;
  };
  let r;
  do { r = await gm.post("filemove", {}); } while (r.code === 200 && r.data.more);
  store.put = realPut;
  assert.equal(r.code, 200);
  assert.deepEqual([...store.files.keys()], [`ht/img/${old.imgId}`], "only the image is left, nothing that was deleted");
  assert.equal(await S.used(), used - 3 * PNG.length - old.mp3.length, "what was deleted was given back once");
});

test("the GM's storage view shows what the store holds; tidying removes only old leftovers, only in this table's root", async () => {
  const { gm } = await table();
  await gm.post("upload", { purpose: "bg", dataUrl: PNG_URL });
  await storedPack(gm, "Two", 2);
  await storedTrack(gm, "tone.wav", WAV);
  const pending = (await gm.post("audiostart", { name: "slow.wav", bytes: WAV.length })).data;   // an upload in progress
  await store.presignedPut(pending.put.url, WAV, pending.put.headers["content-type"]);
  const hourAgo = new Date(Date.now() - 2 * 3600e3);
  const leftover = (p) => { store.files.set(p, { buf: PNG, contentType: "image/png", uploadedAt: hourAgo }); return p; };
  const oldOne = leftover(`ht/img/${"f".repeat(24)}`);           // an upload that failed halfway, long ago
  const newOne = `ht/img/${"e".repeat(24)}`;                       // written moments ago: it may be being listed right now
  store.files.set(newOne, { buf: PNG, contentType: "image/png", uploadedAt: new Date() });
  const preview = leftover(`htpv/img/${"d".repeat(24)}`);          // the previews' table: never touched from here
  store.files.get(`ht/aud/${pending.id}`).uploadedAt = hourAgo;
  const used = await S.used();
  const rep = (await gm.call("GET", { op: "files" })).data;
  assert.equal(rep.store, true); assert.equal(rep.complete, true);
  assert.deepEqual([rep.held.images.n, rep.held.packArt.n, rep.held.audio.n], [3, 2, 2], "what's really in the store under ht/");
  assert.deepEqual([rep.listed.images.n, rep.listed.packArt.n, rep.listed.audio.n], [1, 2, 1], "what the table lists");
  assert.equal(rep.listed.audio.b, WAV.length);
  assert.deepEqual(rep.unlisted, { n: 2, b: 2 * PNG.length }, "leftovers; the upload in progress isn't one");
  assert.equal(rep.used, used); assert.equal(rep.cap, S.STORAGE_CAP);
  const r = (await gm.post("filemove", {})).data;
  assert.equal(r.tidied, 1);
  assert.ok(!store.files.has(oldOne), "the old leftover is deleted");
  assert.ok(store.files.has(newOne) && store.files.has(preview) && store.files.has(`ht/aud/${pending.id}`), "nothing else is");
  assert.equal(await S.used(), used, "leftovers were never counted, so nothing is given back");
  assert.equal((await gm.post("audiodone", { id: pending.id })).code, 200, "the upload in progress still finishes");
});

test("no file store connected: new uploads are refused with a clear message, files already kept still read", async () => {
  const { gm, p1 } = await table();
  const old = await seedLegacy();
  const used = await S.used();
  S.blobReady = () => false;
  try {
    for (const [op, body] of [["upload", { purpose: "bg", dataUrl: PNG_URL }], ["audiostart", { name: "a.mp3", bytes: 100 }],
      ["packstart", { name: "P", bytes: 10 }], ["filemove", {}]]) {
      const r = await gm.post(op, body);
      assert.equal(r.code, 503, op); assert.match(r.data.error, /File storage isn't connected/);
    }
    assert.equal((await p1.call("GET", { img: old.imgId })).code, 200, "old files still read");
    assert.equal((await readTrack(p1, old.trackId)).length, old.mp3.length);
    const rep = (await gm.call("GET", { op: "files" })).data;
    assert.equal(rep.store, false); assert.equal(rep.held, undefined);
  } finally { S.blobReady = () => true; }
  assert.equal(store.files.size, 0); assert.equal(await S.used(), used);
});

test("file store round trip: a populated table's images go out in the export and come back into an empty store", async () => {
  let { gm, p1, p2 } = await table();
  const up = async (b, body) => { const r = await b.post("upload", Object.assign({ dataUrl: PNG_URL }, body)); assert.equal(r.code, 200); return r.data.url; };
  const kira = (await p1.act("char.save", { char: { name: "Kira", hp: { max: 20, current: 12 } } })).data.id;
  await p2.act("char.save", { char: { name: "Rook" } });
  const photo = await up(p1, { purpose: "photo", charId: kira, kind: "profile" });
  const token = await up(p1, { purpose: "photo", charId: kira, kind: "token" });
  const desertBg = await up(gm, { purpose: "bg" });
  await gm.act("map.bg", { url: desertBg });
  const packId = await storedPack(gm, "Props", 2);
  await gm.act("prop.add", { src: `/api/holotable?a=${packId}.1`, name: "Crate", x: 1, y: 1, w: 1, h: 1, rot: 0 });
  await gm.act("token.add", { charId: kira, x: 3, y: 4 });
  await gm.act("scene.saveAs", { name: "Desert" });
  await gm.act("scene.new", { name: "Cantina" });
  const cantinaBg = await up(gm, { purpose: "bg" });
  await gm.act("map.bg", { url: cantinaBg });
  const handoutImg = await up(gm, { purpose: "handout" });
  await gm.act("handout.save", { handout: { title: "Wanted poster", img: handoutImg, shared: true } });
  const secretImg = await up(gm, { purpose: "handout" });
  await gm.act("handout.save", { handout: { title: "The twist", img: secretImg, shared: false } });
  const track = await storedTrack(gm, "Cantina Band.wav", WAV);
  const images = [photo, token, desertBg, cantinaBg, handoutImg, secretImg];
  assert.equal(new Set(images).size, 6);
  for (const u of images) assert.ok(store.files.has(`ht/img/${u.split("=")[1]}`), "every upload is in the store");

  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  assert.deepEqual(Object.keys(file._images).sort(), images.map((u) => u.split("=")[1]).sort(), "the export carries every image the game uses, scenes and handouts included");
  for (const b64 of Object.values(file._images)) assert.equal(b64, PNG.toString("base64"));
  const snap = (st) => JSON.stringify({ c: Object.values(st.characters).map((c) => [c.name, c.image, c.tokenImage, c.hp]).sort(),
    bg: st.map.bgUrl, scenes: st.scenes.map((s) => s.name), handouts: st.handouts.map((h) => [h.title, h.img, h.shared]) });
  const before = snap((await gm.poll()).data.state);

  // 1. restore onto the same table: the library (pack, track) is the table's, untouched by a restore
  assert.equal((await gm.post("restore", { campaign: file })).code, 200);
  assert.equal(snap((await gm.poll()).data.state), before);
  assert.equal((await p1.call("GET", { a: `${packId}.1` })).code, 200, "the pack still serves");
  assert.equal(Buffer.compare(await readTrack(p1, track), WAV), 0, "the track still plays");

  // 2. a brand-new deployment: empty database, empty store, then restore the file
  ({ gm, p1, p2 } = await table());
  assert.equal(store.files.size, 0);
  assert.equal((await gm.post("restore", { campaign: file })).code, 200);
  const st = (await gm.poll()).data.state;
  assert.equal(snap(st), before.replace(/"Kira"/, '"Kira"'), "the game is back as it was");
  for (const u of images) {
    assert.ok(store.files.has(`ht/img/${u.split("=")[1]}`), "each image is back in the store");
    assert.equal(Buffer.compare(Buffer.from((await gm.call("GET", { img: u.split("=")[1] })).data), PNG), 0);
  }
  assert.equal(await S.used(), 6 * PNG.length, "and counted once");
  // players still see only what they should, and their images read
  const pv = (await p1.poll()).data.state;
  assert.deepEqual(pv.handouts.map((h) => h.title), ["Wanted poster"]);
  assert.equal((await p1.call("GET", { img: handoutImg.split("=")[1] })).code, 200);
  // restoring the same file again doesn't write anything twice
  const puts = store.calls.filter(([m]) => m === "put").length;
  assert.equal((await gm.post("restore", { campaign: file })).code, 200);
  assert.equal(store.calls.filter(([m]) => m === "put").length, puts);
  assert.equal(await S.used(), 6 * PNG.length);
});

test("table audio: the GM plays, pauses, loops and stops; everyone sees it with the server's clock", async () => {
  const { gm, p1 } = await table();
  const track = "au0123456789ab";
  assert.equal((await p1.act("audio.play", { track, name: "x" })).code, 403, "GM only");
  assert.equal((await gm.act("audio.play", { track: "../etc", name: "x" })).code, 400);
  await gm.act("audio.play", { track, name: "Mos Eisley", pos: 12, loop: true, vol: 0.6 });
  let au = (await p1.poll()).data.state.audio;
  assert.deepEqual([au.track, au.name, au.playing, au.pos, au.loop, au.vol], [track, "Mos Eisley", true, 12, true, 0.6]);
  assert.ok(Math.abs(au.now - au.at) < 5, "the view carries the server's time so screens can line up");
  await gm.act("audio.pause", { pos: 30.5 });
  au = (await p1.poll()).data.state.audio;
  assert.deepEqual([au.playing, au.pos], [false, 30.5]);
  await gm.act("audio.set", { loop: false, vol: 5 });
  au = (await p1.poll()).data.state.audio;
  assert.deepEqual([au.loop, au.vol], [false, 1], "volume is clamped");
  await gm.act("audio.stop", {});
  assert.equal((await p1.poll()).data.state.audio, null);
});

test("token names: a hidden name on a token linked to a sheet hides the sheet from other players", async () => {
  const { gm, p1 } = await table();
  const id = (await gm.act("char.save", { char: { name: "Darth Vexx" } })).data.id;
  await gm.act("token.add", { charId: id, x: 2, y: 2 });
  const tok = (await gm.poll()).data.state.map.tokens.find((t) => t.charId === id);
  await gm.act("token.update", { id: tok.id, fields: { nameHidden: true } });
  const pv = (await p1.poll()).data.state;
  assert.equal(pv.characters[id], undefined, "the sheet isn't sent");
  assert.ok(!JSON.stringify(Object.assign({}, pv, { chat: [] })).includes("Vexx"), "nor the name, outside the earlier chat line");
  assert.ok((await gm.poll()).data.state.characters[id], "the GM keeps it");
  await gm.act("token.update", { id: tok.id, fields: { nameHidden: false } });
  assert.equal((await p1.poll()).data.state.characters[id].name, "Darth Vexx", "back once revealed");
});

test("token names: chat's turn and leaving lines don't name a creature whose name is hidden (#90)", async () => {
  const { gm, p1 } = await table();
  await gm.act("token.add", { name: "Raider", x: 2, y: 2, nameHidden: true });
  await gm.act("init.add", { name: "Raider", init: 15, hp: 20 });
  await gm.act("init.add", { name: "Avery", init: 10, hp: 20 });
  await gm.act("init.next", {});   // Avery (the order starts on the Raider, so "next" moves to Avery)
  await gm.act("init.next", {});   // round 2: the Raider
  const vexx = (await gm.act("char.save", { char: { name: "Darth Vexx" } })).data.id;
  await gm.act("token.add", { charId: vexx, x: 4, y: 4 });
  const tok = (await gm.poll()).data.state.map.tokens.find((t) => t.charId === vexx);
  await gm.act("token.update", { id: tok.id, fields: { nameHidden: true } });
  const before = (await p1.poll()).data.state.chat.length;   // "brought Darth Vexx" came earlier, before the name was hidden
  await gm.act("char.delete", { id: vexx });
  const chat = (await p1.poll()).data.state.chat.map((m) => m.text || "");
  assert.ok(chat.includes("Round 1 - Avery's turn."), "names that aren't hidden still show");
  assert.ok(chat.includes("Round 2 - ???'s turn."), "the turn line says ???");
  assert.ok(!chat.some((t) => /Raider/.test(t)), "never the hidden name");
  assert.deepEqual(chat.slice(before), ["An unknown character left the table."]);
});

test("combat-start movements: they wait through scene changes, then play when combat starts (initiative or the combat view)", async () => {
  const { gm, p1 } = await table();
  await gm.act("map.settings", { cols: 20, rows: 12 });
  await gm.act("token.add", { name: "Bounty Hunter", x: 5, y: 5 });
  await gm.act("token.add", { name: "Sniper", x: 2, y: 2 });
  await gm.act("token.add", { name: "Courier", x: 9, y: 9 });
  const [bh, sn, co] = (await gm.poll()).data.state.map.tokens.map((t) => t.id);
  await gm.act("token.script", { id: bh, moves: { path: [{ x: 7, y: 5 }, { x: 7, y: 8 }], when: "combat" } });
  await gm.act("token.script", { id: co, moves: { path: [{ x: 10, y: 9 }], when: "nonsense" } });   // anything else: the next scene
  let gv = (await gm.poll()).data.state.map.tokens;
  assert.equal(gv[0].moves.when, "combat");
  assert.equal(gv[2].moves.when, undefined, "cleaned to the usual scene trigger");
  // a scene change plays only the scene movement
  const cantina = (await gm.act("scene.saveAs", { name: "Cantina" })).data.id;
  await gm.act("scene.new", { name: "Other" });
  await gm.act("scene.load", { id: cantina });
  gv = (await gm.poll()).data.state;
  assert.deepEqual(gv.sceneFx.moves.map((m) => m.id), [co], "the courier moves; the bounty hunter waits for combat");
  assert.equal(gv.map.tokens.find((t) => t.id === bh).moves.when, "combat");
  // Start in initiative plays it, once, with no wipe; players see it move but never the script
  await gm.act("init.add", { name: "Bounty Hunter", init: 14, hp: 30 });
  assert.equal((await p1.poll()).data.state.map.tokens.find((t) => t.id === bh).moves, undefined);
  await gm.act("init.start", {});
  const pv = (await p1.poll()).data.state;
  assert.equal(pv.sceneFx.k, -1, "no wipe");
  assert.deepEqual(pv.sceneFx.moves, [{ id: bh, from: { x: 5, y: 5 }, path: [{ x: 7, y: 5 }, { x: 7, y: 8 }], delay: 0 }]);
  assert.deepEqual([pv.map.tokens.find((t) => t.id === bh).x, pv.map.tokens.find((t) => t.id === bh).y], [7, 8]);
  // the combat view's switch starts combat too
  await gm.act("token.script", { id: sn, moves: { path: [{ x: 2, y: 0 }], when: "combat" } });
  assert.equal((await p1.act("fight.toggle", { on: true })).code, 403);
  await gm.act("fight.toggle", { on: true });
  gv = (await gm.poll()).data.state;
  assert.deepEqual(gv.sceneFx.moves.map((m) => m.id), [sn]);
  assert.equal(gv.map.tokens.find((t) => t.id === sn).moves, undefined, "each plays once");
  // switching it off and on again with nothing queued changes nothing
  const n = gv.sceneFx.n;
  await gm.act("fight.toggle", { on: false }); await gm.act("fight.toggle", { on: true });
  assert.equal((await gm.poll()).data.state.sceneFx.n, n);
});

test("the GM removes a stale player record: GM only, never one who owns a character, never themselves; nothing breaks", async () => {
  const { gm, p1, p2 } = await table();
  const stale = browser();
  await stale.login(PLAYER_PW, "Clawcius check");
  const staleId = (await stale.call("GET", { op: "me" })).data.you, samId = (await p1.call("GET", { op: "me" })).data.you;
  const gmId = (await gm.call("GET", { op: "me" })).data.you;
  await stale.act("chat", { text: "testing, ignore me" });
  // a fully populated table around it: Sam's character in initiative with a token, a scene, a handout
  const kira = (await p1.act("char.save", { char: { name: "Kira", hp: { max: 20, current: 20 } } })).data.id;
  await p1.act("token.add", { charId: kira, x: 1, y: 1 });
  await p1.act("init.add", { charId: kira, name: "Kira", init: 12 });
  await gm.act("init.add", { name: "Raider", init: 9, hp: 10 });
  await gm.act("init.start", {});
  await gm.act("scene.saveAs", { name: "Cantina" });
  await gm.act("handout.save", { handout: { title: "Map", text: "x", shared: true } });
  const players = async () => Object.keys((await gm.poll()).data.state.players);
  assert.ok((await players()).includes(staleId));

  assert.equal((await p2.act("player.remove", { id: staleId })).code, 403, "a player can't remove anyone");
  const owns = await gm.act("player.remove", { id: samId });
  assert.deepEqual([owns.code, /still owns Kira/.test(owns.data.error)], [400, true], "not while they own a character");
  assert.equal((await gm.act("player.remove", { id: gmId })).code, 400, "not yourself");
  for (const id of ["__proto__", "constructor", "", "nobody123"]) assert.equal((await gm.act("player.remove", { id })).code, 400, id);
  assert.equal((await gm.act("player.remove", { id: staleId })).code, 200);
  let st = (await gm.poll()).data.state;
  assert.ok(!(staleId in st.players) && samId in st.players && st.characters[kira].owner === samId, "only that record goes");
  assert.ok(st.chat.some((m) => m.from === "Clawcius check" && m.text === "testing, ignore me"), "chat keeps the name it was written with");
  // a full round trip still works, and still without the record
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  assert.equal((await gm.post("restore", { campaign: file })).code, 200);
  st = (await gm.poll()).data.state;
  assert.deepEqual([staleId in st.players, st.initiative.entries.length, st.scenes.length, st.handouts.length, st.characters[kira].owner], [false, 2, 1, 1, samId]);
  // someone still signed in just comes back as the same person, with no error
  assert.equal((await stale.poll()).code, 200);
  assert.equal((await stale.act("chat", { text: "back" })).code, 200);
  assert.equal((await gm.poll()).data.state.players[staleId].name, "Clawcius check");
});

test("class resources survive the server's sheet cleaning", async () => {
  const { p1 } = await table();
  require("../sections/jpesus/holotable/rules.js");
  const R = globalThis.SW5E;
  const ch = { name: "Vex", classes: [{ name: "Fighter", level: 5 }] };
  ch.resources = R.withClassResources(ch);
  ch.resources[0].used = 2;
  const id = (await p1.act("char.save", { char: ch })).data.id;
  const back = (await p1.poll()).data.state.characters[id];
  assert.deepEqual(R.resourceRows(back).map((r) => [r.key, r.max, r.die, r.used]), [["superiority", 3, "d6", 2], ["second-wind", 1, "", 0], ["action-surge", 1, "", 0]]);
});

test("props that block sight: GM-only flag, never sent to players, kept in backups, turned into sight segments", async () => {
  const { gm, p1 } = await table();
  const src = "/api/holotable?a=packone.1";
  await gm.act("prop.add", { src, name: "Freighter", x: 4, y: 2, w: 2, h: 1, rot: 0 });
  await gm.act("prop.add", { src, name: "Pillar", x: 10, y: 10, w: 1, h: 1, rot: 90 });
  let props = (await gm.poll()).data.state.map.props;
  const [ship, pillar] = props.map((x) => x.id);
  assert.equal((await p1.act("prop.update", { id: ship, fields: { blocksSight: true } })).code, 403, "GM only");
  await gm.act("prop.update", { id: ship, fields: { blocksSight: true } });
  await gm.act("prop.update", { id: pillar, fields: { blocksSight: "yes" } });
  props = (await gm.poll()).data.state.map.props;
  assert.deepEqual(props.map((x) => x.blocksSight), [true, true]);
  const pv = (await p1.poll()).data.state.map.props;
  assert.ok(pv.every((x) => x.blocksSight === undefined), "players get the effect, never the flag");
  // edges in grid squares: the freighter's rectangle, then the pillar (rotated 90°, still a 1×1 square)
  const segs = G.propSightSegments((await gm.poll()).data.state.map);
  assert.equal(segs.length, 8);
  assert.deepEqual(segs.slice(0, 4).map((s) => [s.a, s.b]), [[[4, 2], [6, 2]], [[6, 2], [6, 3]], [[6, 3], [4, 3]], [[4, 3], [4, 2]]]);
  const xs = segs.slice(4).flatMap((s) => [s.a[0], s.b[0]]), ys = segs.slice(4).flatMap((s) => [s.a[1], s.b[1]]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [10, 11, 10, 11]);
  // switching it off removes it; a duplicate keeps it; a restore keeps it
  await gm.act("prop.update", { id: pillar, fields: { blocksSight: false } });
  await gm.act("prop.add", { src, name: "Freighter", x: 7, y: 2, w: 2, h: 1, blocksSight: true });
  const g2 = G.cleanGame(JSON.parse(JSON.stringify((await gm.poll()).data.state)));
  assert.deepEqual(g2.map.props.map((x) => !!x.blocksSight), [true, false, true]);
  assert.equal(G.propSightSegments(g2.map).length, 8);
});

test("images a kept backup still uses aren't deleted until that backup rolls off (#118)", async () => {
  const { gm, p1 } = await table();
  const tenMinutesLater = async () => { const g = JSON.parse(await db.get(S.K.camp("main"))); g.lastBackup = 0; await db.set(S.K.camp("main"), JSON.stringify(g)); };
  const served = async (url) => (await gm.call("GET", { img: url.split("=")[1] })).code;
  const mapA = (await gm.post("upload", { purpose: "bg", dataUrl: PNG_URL })).data.url;
  await gm.act("map.bg", { url: mapA });
  await tenMinutesLater(); await gm.act("chat", { text: "the cantina" });   // an automatic backup with map A in it
  const used = await S.used();
  // a new map: A leaves the game, but a backup still shows it, so it stays
  const mapB = (await gm.post("upload", { purpose: "bg", dataUrl: PNG_URL })).data.url;
  await gm.act("map.bg", { url: mapB });
  assert.equal(await served(mapA), 200, "kept while a backup uses it");
  assert.deepEqual(await db.smembers(S.K.imgWait()), [mapA]);
  // restoring that backup shows map A, not a broken image
  const withA = (await db.lrange(S.K.bk("main"), 0, 9)).findIndex((raw) => raw.includes(mapA) && !raw.includes(mapB));
  assert.ok(withA >= 0);
  assert.equal((await gm.post("restore", { backup: withA })).code, 200);
  const st = (await p1.poll()).data.state;
  assert.equal(st.map.bgUrl, mapA);
  assert.equal(await served(mapA), 200, "the restored map is there");
  // a replaced photo waits the same way (it used to be deleted unchecked)
  const kira = (await p1.act("char.save", { char: { name: "Kira" } })).data.id;
  const photo1 = (await p1.post("upload", { purpose: "photo", charId: kira, kind: "token", dataUrl: PNG_URL })).data.url;
  await tenMinutesLater(); await p1.act("chat", { text: "a backup with the first photo" });
  await p1.post("upload", { purpose: "photo", charId: kira, kind: "token", dataUrl: PNG_URL });
  assert.equal(await served(photo1), 200, "the old photo stays while a backup has it");
  // back to map B, then ten more backups later nothing refers to A or the first photo: both go, and their bytes come back
  await gm.act("map.bg", { url: mapB });
  for (let k = 0; k < 10; k++) { await tenMinutesLater(); await gm.act("chat", { text: "later " + k }); }
  assert.equal(await served(mapA), 404, "deleted once the last backup using it rolled off");
  assert.equal(await served(photo1), 404);
  assert.deepEqual(await db.smembers(S.K.imgWait()), []);
  assert.ok(await S.used() < used + 3 * PNG.length, "storage given back");
});

test("senses on the sheet are the GM's: players get their species' senses, never their own edits (#92)", async () => {
  const { gm, p1 } = await table();
  await db.set(S.K.sw5e("species"), JSON.stringify([
    { n: "Advozse", traits: [{ n: "Darkvision", d: "You can see in dim light within 60 feet of you as if it were bright light." }] },
    { n: "Kaleesh", traits: [{ n: "Energy Sensors", d: "You have blindsight out to 30 feet." }] },
    { n: "Human", traits: [{ n: "Versatile", d: "Skill." }] },
  ]));
  handler.resetSpeciesSenses();
  const senses = async (id) => ((await gm.poll()).data.state.characters[id].senses || []);
  // a player can't give themselves senses by typing them
  const kira = (await p1.act("char.save", { char: { name: "Kira", species: "Human", senses: [{ kind: "truesight", range: 9999 }] } })).data.id;
  assert.deepEqual(await senses(kira), []);
  // choosing a species gives that species' senses, whatever the client sends with it
  let ch = (await p1.poll()).data.state.characters[kira];
  await p1.act("char.save", { char: Object.assign({}, ch, { species: "Advozse", senses: [{ kind: "darkvision", range: 9999 }] }) });
  assert.deepEqual(await senses(kira), [{ kind: "darkvision", range: 60 }]);
  // later saves keep them, even if a client tries to change them
  ch = (await p1.poll()).data.state.characters[kira];
  await p1.act("char.save", { char: Object.assign({}, ch, { hp: { current: 5, max: 10 }, senses: [] }) });
  assert.deepEqual(await senses(kira), [{ kind: "darkvision", range: 60 }]);
  // the GM sets them by hand, and a player's save keeps the GM's choice
  ch = (await gm.poll()).data.state.characters[kira];
  await gm.act("char.save", { char: Object.assign({}, ch, { senses: [{ kind: "darkvision", range: 120 }, { kind: "tremorsense", range: 30 }, { kind: "xray", range: 5 }] }) });
  assert.deepEqual(await senses(kira), [{ kind: "darkvision", range: 120 }, { kind: "tremorsense", range: 30 }], "only the four kinds");
  ch = (await p1.poll()).data.state.characters[kira];
  await p1.act("char.save", { char: Object.assign({}, ch, { notes: "x" }) });
  assert.deepEqual(await senses(kira), [{ kind: "darkvision", range: 120 }, { kind: "tremorsense", range: 30 }]);
  // switching species again takes the new species' senses
  ch = (await p1.poll()).data.state.characters[kira];
  await p1.act("char.save", { char: Object.assign({}, ch, { species: "Kaleesh" }) });
  assert.deepEqual(await senses(kira), [{ kind: "blindsight", range: 30 }]);
});

test("sheets made before #129 get their species' senses once; never over senses already set; nothing while the list is unreachable (#92)", async () => {
  const { gm } = await table();
  // a table from before #129: sheets with a species but no senses (the GM's saves keep what they're given)
  const make = async (name, species, senses) => (await gm.act("char.save", { char: Object.assign({ name, species }, senses ? { senses } : {}) })).data.id;
  // SW5e's species list unreachable at first: nothing changes, and the next action tries again
  await db.del(S.K.sw5e("species"));
  await db.set(S.K.sw5eFail("species"), "1");
  handler.resetSpeciesSenses();
  const vel = await make("Vel", "Sith Pureblood"), ana = await make("Ana", "Sith Pureblood", [{ kind: "truesight", range: 30 }]), hal = await make("Hal", "Human"), nos = await make("Nos", "");
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  delete file.sensesFilled;
  for (const c of Object.values(file.characters)) if (c.name === "Vel") delete c.senses;
  assert.equal((await gm.post("restore", { campaign: file })).code, 200);
  await gm.act("notes.save", { notes: "an action" });
  const senses = async (id) => (await gm.poll()).data.state.characters[id].senses;
  assert.equal(await senses(vel), undefined, "the list unreachable: left alone");
  // the list back: the next action fills Vel from its species; Ana keeps the GM's; Hal's species has none; Nos has no species
  await db.del(S.K.sw5eFail("species"));
  await db.set(S.K.sw5e("species"), JSON.stringify([
    { n: "Sith Pureblood", traits: [{ n: "Darkvision", d: "You can see in dim light within 60 feet of you as if it were bright light." }] },
    { n: "Human", traits: [{ n: "Versatile", d: "Skill." }] },
  ]));
  handler.resetSpeciesSenses();
  await gm.act("notes.save", { notes: "another action" });
  assert.deepEqual(await senses(vel), [{ kind: "darkvision", range: 60 }], "filled from its species");
  assert.deepEqual(await senses(ana), [{ kind: "truesight", range: 30 }], "never over senses already set");
  assert.deepEqual([await senses(hal), await senses(nos)], [undefined, undefined]);
  // once: the GM clearing Vel's senses afterwards stands
  const ch = (await gm.poll()).data.state.characters[vel];
  await gm.act("char.save", { char: Object.assign({}, ch, { senses: [] }) });
  await gm.act("notes.save", { notes: "a third action" });
  assert.equal(await senses(vel), undefined, "the fill ran once; the GM's clearing stands");
  // a backup restored later keeps the mark, so the GM's deliberate "none" survives it (review of #132)
  const back = JSON.parse((await gm.call("GET", { op: "export" })).data);
  assert.equal(back.sensesFilled, true);
  assert.equal((await gm.post("restore", { campaign: back })).code, 200);
  handler.resetSpeciesSenses();
  await gm.act("notes.save", { notes: "after the restore" });
  assert.equal(await senses(vel), undefined, "not filled again: the restore didn't forget it was done");
  // a crafted mark is only ever true or false
  const crafted = JSON.parse((await gm.call("GET", { op: "export" })).data);
  crafted.sensesFilled = { not: "a boolean" };
  await gm.post("restore", { campaign: crafted });
  assert.equal(JSON.parse((await gm.call("GET", { op: "export" })).data).sensesFilled, false);
});

test("the one-time senses fill never reads SW5e inside the game lock, and only reads it when a sheet needs filling (review of #132)", async () => {
  const { gm } = await table();
  await gm.act("char.save", { char: { name: "Vel", species: "Sith Pureblood" } });   // a sheet from before #129: a species, no senses
  const file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  delete file.sensesFilled;
  assert.equal((await gm.post("restore", { campaign: file })).code, 200);
  await db.del(S.K.sw5e("species"));
  await db.del(S.K.sw5eFail("species"));
  handler.resetSpeciesSenses();
  const realFetch = global.fetch;
  let inLock = 0, calls = 0, askedInLock = false;
  const realWith = S.withLock;
  S.withLock = async (k, fn) => realWith.call(S, k, async () => { inLock++; try { return await fn(); } finally { inLock--; } });
  global.fetch = async () => { calls++; if (inLock) askedInLock = true; throw new Error("offline"); };
  try {
    assert.equal((await gm.act("notes.save", { notes: "an action while SW5e is slow or out" })).code, 200);
    assert.equal(askedInLock, false, "SW5e is never asked while the table is locked");
    assert.ok(calls >= 1, "the list was asked for, before the lock");
  } finally { global.fetch = realFetch; S.withLock = realWith; }
  // a table with nothing to fill never asks SW5e: it's marked done at once
  const t2 = await table(); handler.resetSpeciesSenses();
  let asked = 0; global.fetch = async () => { asked++; throw new Error("offline"); };
  try { await t2.gm.act("notes.save", { notes: "nothing to fill" }); } finally { global.fetch = realFetch; }
  assert.equal(asked, 0);
  assert.equal(JSON.parse((await t2.gm.call("GET", { op: "export" })).data).sensesFilled, true);
});

test("the senses fill holds an action at most about a second while SW5e is slow, and fills a restored old backup again (notes on #132)", async () => {
  const { gm } = await table();
  await gm.act("char.save", { char: { name: "Vel", species: "Sith Pureblood" } });
  let file = JSON.parse((await gm.call("GET", { op: "export" })).data);
  delete file.sensesFilled;
  await gm.post("restore", { campaign: file });
  await db.del(S.K.sw5e("species")); await db.del(S.K.sw5eFail("species"));
  handler.resetSpeciesSenses();
  const realFetch = global.fetch;
  global.fetch = () => new Promise((ok, bad) => setTimeout(() => bad(new Error("slow, then out")), 2500));
  try {
    const t0 = Date.now();
    assert.equal((await gm.act("notes.save", { notes: "while SW5e is slow" })).code, 200);
    assert.ok(Date.now() - t0 < 1800, `held ${Date.now() - t0} ms`);
  } finally { await new Promise((ok) => setTimeout(ok, 2700)); global.fetch = realFetch; }
  // the list back: filled; then an old backup (no mark, no senses) restored on a warm instance is filled again
  await db.del(S.K.sw5eFail("species"));
  await db.set(S.K.sw5e("species"), JSON.stringify([{ n: "Sith Pureblood", traits: [{ n: "Darkvision", d: "You can see in dim light within 60 feet of you as if it were bright light." }] }]));
  handler.resetSpeciesSenses();
  await gm.act("notes.save", { notes: "filled" });
  const vel = () => gm.poll().then((r) => Object.values(r.data.state.characters).find((c) => c.name === "Vel").senses);
  assert.deepEqual(await vel(), [{ kind: "darkvision", range: 60 }]);
  for (const c of Object.values(file.characters)) delete c.senses;
  await gm.post("restore", { campaign: file });   // the warm instance has seen the mark before
  await gm.act("notes.save", { notes: "after an old backup" });
  await gm.act("notes.save", { notes: "and another" });
  assert.deepEqual(await vel(), [{ kind: "darkvision", range: 60 }], "filled again");
});

test("a character the GM makes is announced to the GM only; a player's to everyone (#142)", async () => {
  const { gm, p1 } = await table();
  await gm.act("char.save", { char: { name: "Darth Secret" } });
  await p1.act("char.save", { char: { name: "Kira" } });
  const pchat = JSON.stringify((await p1.poll()).data.state.chat);
  assert.ok(!pchat.includes("Darth Secret"), pchat);
  assert.ok(pchat.includes("brought Kira to the table"), "a player's own character is still announced");
  const gchat = (await gm.poll()).data.state.chat.map((m) => m.text || "");
  assert.ok(gchat.some((t) => t.includes("You made Darth Secret")), "the GM still gets the line");
});

test("healing up from 0 HP wakes a character and resets death saves, on the sheet and in initiative (#138)", async () => {
  const { gm, p1 } = await table();
  const id = (await p1.act("char.save", { char: { name: "Kira", hp: { current: 0, max: 28 }, conditions: ["Unconscious", "Prone"], deathSaves: { s: 1, f: 2 } } })).data.id;
  await p1.act("init.add", { charId: id, name: "Kira", init: 12 });
  await gm.act("init.update", { id: (await gm.poll()).data.state.initiative.entries[0].id, fields: { conditions: ["Unconscious", "Prone"] } });
  let st = (await p1.poll()).data.state;
  // a short rest's hit die, Heal or a typed number: every one is a sheet save with more HP
  await p1.act("char.save", { char: Object.assign({}, st.characters[id], { hp: { current: 9, max: 28 } }) });
  st = (await p1.poll()).data.state;
  assert.deepEqual(st.characters[id].conditions, ["Prone"], "awake, still prone until standing");
  assert.deepEqual(st.characters[id].deathSaves, { s: 0, f: 0 });
  assert.deepEqual(st.initiative.entries[0].conditions, ["Prone"]);
  // staying at 0 changes nothing; going down and up again works the same
  await p1.act("char.save", { char: Object.assign({}, st.characters[id], { hp: { current: 0, max: 28 }, conditions: ["Unconscious"], deathSaves: { s: 0, f: 1 } }) });
  await p1.act("char.save", { char: Object.assign({}, (await p1.poll()).data.state.characters[id], { notes: "still down" }) });
  assert.deepEqual((await p1.poll()).data.state.characters[id].conditions, ["Unconscious"], "no healing, no change");
  await gm.act("char.save", { char: Object.assign({}, (await gm.poll()).data.state.characters[id], { hp: { current: 28, max: 28 } }) });
  assert.deepEqual((await gm.poll()).data.state.characters[id].conditions, []);
});

test("Second Wind spent from the combat view heals 1d10 + fighter level", async () => {
  const { gm, p1 } = await table();
  require("../sections/jpesus/holotable/rules.js");
  const R = globalThis.SW5E;
  const ch = { name: "Rex", classes: [{ name: "Fighter", level: 5 }], hp: { current: 0, max: 44 }, conditions: ["Unconscious"] };
  ch.resources = R.withClassResources(ch);
  const id = (await p1.act("char.save", { char: ch })).data.id;
  await gm.act("fight.toggle", { on: true });
  assert.equal((await p1.act("fight.spend", { charId: id, key: "second-wind" })).code, 200);
  const st = (await p1.poll()).data.state, c = st.characters[id];
  assert.ok(c.hp.current >= 6 && c.hp.current <= 15, "1d10+5 healed from 0: " + c.hp.current);
  assert.deepEqual(c.conditions, [], "and woke up");
  assert.ok(st.chat.some((m) => m.roll && m.roll.label === "Second Wind (healing)" && m.roll.expr === "1d10+5"));
  assert.equal((await p1.act("fight.spend", { charId: id, key: "second-wind" })).code, 400, "one use, then it's spent");
});

test("Second Wind by a character whose name the GM hides names nobody in players' chat (#140)", async () => {
  const { gm, p1 } = await table();
  require("../sections/jpesus/holotable/rules.js");
  const R = globalThis.SW5E;
  const ch = { name: "Darth Secret", classes: [{ name: "Fighter", level: 5 }], hp: { current: 10, max: 44 } };
  ch.resources = R.withClassResources(ch);
  const id = (await gm.act("char.save", { char: ch })).data.id;
  await gm.act("token.add", { charId: id, x: 2, y: 2 });
  const tok = (await gm.poll()).data.state.map.tokens.find((t) => t.charId === id);
  await gm.act("token.update", { id: tok.id, fields: { nameHidden: true } });
  await gm.act("fight.toggle", { on: true });
  assert.equal((await gm.act("fight.spend", { charId: id, key: "second-wind" })).code, 200);
  const lines = (await p1.poll()).data.state.chat.filter((m) => (m.roll && /Second Wind/.test(m.roll.label)) || /Second Wind/.test(m.text || ""));
  assert.equal(lines.length, 2, "the use and the roll both reach the player");
  assert.ok(!JSON.stringify(lines).includes("Darth Secret"), JSON.stringify(lines));
  const gmRoll = (await gm.poll()).data.state.chat.find((m) => m.roll && m.roll.label === "Second Wind (healing)");
  assert.ok(gmRoll && gmRoll.roll.expr === "1d10+5");
});

// The GM asking for a roll (audit 9.12)
const askSheet = (name, wis) => ({ name, abilities: { str: 10, dex: 10, con: 10, int: 10, wis, cha: 10 }, skills: { perception: 1 } });

test("ask: the GM rolls Perception for everyone now, from their sheets; players can't ask", async () => {
  const { gm, p1, p2 } = await table();
  const kira = (await p1.act("char.save", { char: askSheet("Kira", 16) })).data.id;
  const rex = (await p2.act("char.save", { char: askSheet("Rex", 8) })).data.id;
  await gm.act("char.save", { char: askSheet("Darth Secret", 20) });
  assert.equal((await p1.act("ask.roll", { what: "skill", key: "perception" })).code, 403);
  const r = await gm.act("ask.roll", { what: "skill", key: "perception", dc: 12, showDc: true });
  assert.equal(r.code, 200);
  assert.deepEqual(Object.keys(r.data.results).sort(), [kira, rex].sort(), "every player's character, not the GM's own");
  const rolls = (await p1.poll()).data.state.chat.filter((m) => m.roll && /Perception/.test(m.roll.label));
  assert.equal(rolls.length, 2);
  const k = rolls.find((m) => m.charName === "Kira");
  assert.match(k.roll.expr, /^1d20\+5$/, "Wis +3 and proficiency +2, from the sheet");
  assert.match(k.roll.label, /vs DC 12: (success|fail)/);
  assert.ok(!JSON.stringify((await p1.poll()).data.state.chat).includes("Darth Secret"), "a GM sheet's name never reaches players");
  for (const [what, key] of [["skill", "__proto__"], ["save", "constructor"], ["nope", "dex"]])
    assert.equal((await gm.act("ask.roll", { what, key })).code, 400);
  assert.equal((await gm.act("ask.roll", { what: "save", key: "dex", chars: ["__proto__", "toString"] })).code, 400, "no such characters");
  assert.equal(Object.prototype.polluted, undefined);
});

test("ask: a secret DC'd request; each player rolls only their own; group result and close", async () => {
  const { gm, p1, p2 } = await table();
  const kira = (await p1.act("char.save", { char: askSheet("Kira", 16) })).data.id;
  const rex = (await p2.act("char.save", { char: askSheet("Rex", 8) })).data.id;
  const open = await gm.act("ask.open", { what: "skill", key: "insight", dc: 15, group: true, secret: true });
  assert.equal(open.code, 200);
  const id = open.data.id;
  let s1 = (await p1.poll()).data.state;
  assert.equal(s1.ask.dc, undefined, "the DC isn't sent unless shown");
  assert.deepEqual(s1.ask.mine, [kira]);
  assert.equal((await p1.act("ask.answer", { id, charId: rex })).code, 403, "not your character");
  assert.equal((await p1.act("ask.answer", { id: "nope", charId: kira })).code, 400);
  const a1 = await p1.act("ask.answer", { id, charId: kira, mode: "adv" });
  assert.equal(a1.code, 200);
  assert.equal(a1.data.total, undefined, "a secret roll's number isn't returned to the player");
  assert.equal((await p1.act("ask.answer", { id, charId: kira })).code, 400, "once each");
  s1 = (await p1.poll()).data.state;
  assert.deepEqual(s1.ask.results[kira], { done: true });
  assert.ok(!s1.chat.some((m) => m.roll && /Insight/.test(m.roll.label)), "the roll itself is the GM's");
  assert.ok(s1.chat.some((m) => /Kira rolled Insight for the GM/.test(m.text || "")));
  await p2.act("ask.answer", { id, charId: rex });
  const g = (await gm.poll()).data.state;
  assert.equal(Object.keys(g.ask.results).length, 2);
  assert.ok(g.chat.some((m) => m.roll && /Insight \(group\) vs DC 15/.test(m.roll.label) && m.roll.expr.startsWith("2d20kh1")), "advantage kept");
  assert.ok(g.chat.some((m) => /^Group Insight: \d of 2 succeeded/.test(m.text || "") && m.private));
  assert.equal((await p1.act("ask.close", {})).code, 403);
  await gm.act("ask.close", {});
  assert.equal((await p1.poll()).data.state.ask, undefined);
});

test("ask: a player not asked sees nothing of the request", async () => {
  const { gm, p1, p2 } = await table();
  const kira = (await p1.act("char.save", { char: askSheet("Kira", 16) })).data.id;
  await p2.act("char.save", { char: askSheet("Rex", 8) });
  await gm.act("ask.open", { what: "save", key: "wis", chars: [kira] });
  assert.equal((await p2.poll()).data.state.ask, undefined);
  assert.equal((await p1.poll()).data.state.ask.check.name, "Wisdom save");
});

test("ask: a hidden DC isn't bracketed by verdicts, and the GM's NPC isn't in a player's view (#170 review)", async () => {
  const { gm, p1, p2 } = await table();
  const kira = (await p1.act("char.save", { char: askSheet("Kira", 16) })).data.id;
  const rex = (await p2.act("char.save", { char: askSheet("Rex", 8) })).data.id;
  const npc = (await gm.act("char.save", { char: askSheet("Darth Secret", 20) })).data.id;
  const id = (await gm.act("ask.open", { what: "skill", key: "perception", dc: 15, chars: [kira, rex, npc] })).data.id;
  await p1.act("ask.answer", { id, charId: kira });
  await p2.act("ask.answer", { id, charId: rex });
  await gm.act("ask.answer", { id, charId: npc });
  const a = (await p1.poll()).data.state.ask;
  assert.deepEqual(a.chars.sort(), [kira, rex].sort(), "the GM's NPC isn't listed");
  assert.equal(a.results[npc], undefined, "nor its result");
  assert.ok(Object.values(a.results).every((r) => r.ok === undefined && Number.isFinite(r.total)), "totals, no verdicts, while the DC is hidden");
  assert.equal(a.dc, undefined, "the DC isn't there");
  await gm.act("ask.close", {});
  const id2 = (await gm.act("ask.open", { what: "skill", key: "perception", dc: 12, showDc: true, chars: [kira] })).data.id;
  await p1.act("ask.answer", { id: id2, charId: kira });
  const b = (await p1.poll()).data.state.ask;
  assert.equal(typeof b.results[kira].ok, "boolean", "with the DC shown, the verdict is too");
  assert.ok(Object.keys((await gm.poll()).data.state.ask.results).length === 1);
});

test("AC from armor, Unarmored Defense and misc (audit 5.3), crit range, misc boxes (#74)", async () => {
  require("../sections/jpesus/holotable/rules.js");
  const R = globalThis.SW5E;
  const ch = (o) => Object.assign({ classes: [{ name: "Fighter", level: 1 }], abilities: { str: 10, dex: 14, con: 16, int: 10, wis: 16, cha: 10 }, equipment: [] }, o);
  const arm = (name, kind, ac, equipped = true) => ({ name, equipped, armor: { kind, ac } });
  assert.equal(R.armorClass(ch()).total, 12, "unarmored 10 + Dex");
  assert.equal(R.armorClass(ch({ equipment: [arm("Combat suit", "light", 11)] })).total, 13, "light: ac + Dex");
  assert.equal(R.armorClass(ch({ abilities: { dex: 18 }, equipment: [arm("Composite armor", "medium", 15)] })).total, 17, "medium: Dex at most +2");
  assert.equal(R.armorClass(ch({ abilities: { dex: 18 }, equipment: [arm("Assault armor", "heavy", 17)] })).total, 17, "heavy: no Dex");
  assert.equal(R.armorClass(ch({ equipment: [arm("Combat suit", "light", 11), arm("Medium shield", "shield", 2)] })).total, 15, "a shield adds");
  assert.equal(R.armorClass(ch({ equipment: [arm("Assault armor", "heavy", 17, false)] })).total, 12, "armor not equipped doesn't count");
  assert.equal(R.armorClass(ch({ classes: [{ name: "Berserker", level: 1 }] })).total, 15, "Berserker: 10 + Dex + Con");
  assert.equal(R.armorClass(ch({ classes: [{ name: "Berserker", level: 1 }], equipment: [arm("Light shield", "shield", 1)] })).total, 16, "and keeps a shield");
  assert.equal(R.armorClass(ch({ classes: [{ name: "Monk", level: 1 }] })).total, 15, "Monk: 10 + Dex + Wis");
  assert.equal(R.armorClass(ch({ classes: [{ name: "Monk", level: 1 }], equipment: [arm("Light shield", "shield", 1)] })).total, 13, "not with a shield");
  assert.equal(R.armorClass(ch({ classes: [{ name: "Berserker", level: 1 }], equipment: [arm("Combat suit", "light", 11)] })).total, 13, "armor ends Unarmored Defense");
  assert.equal(R.armorClass(ch({ acMisc: 1 })).total, 13, "misc adds");
  assert.deepEqual(R.armorFromItem({ ac: "14 + Dex modifier (max 2)", accl: "Medium" }), { kind: "medium", ac: 14 });
  assert.deepEqual(R.armorFromItem({ ac: "+2", accl: "Shield" }), { kind: "shield", ac: 2 });
  assert.equal(R.armorFromItem({ ac: "", accl: "" }), null);
  assert.equal(R.critFrom("Keen 1, Finesse"), 19);
  assert.equal(R.critFrom("finesse"), 20);

  const { gm, p1 } = await table();
  const id = (await p1.act("char.save", { char: Object.assign(ch({ ac: 99, acAuto: true, acMisc: 1 }), { name: "Kira",
    equipment: [arm("Combat suit", "light", 11), arm("Medium shield", "shield", 2), { name: "Junk", equipped: true, armor: { kind: "__proto__", ac: 5 } }],
    attacks: [{ name: "Keen blade", critRange: 19 }, { name: "Plain", critRange: 20 }, { name: "Silly", critRange: 3 }],
    saveMisc: { dex: 2 }, skillMisc: { stealth: 1 } }) })).data.id;
  let c = (await gm.poll()).data.state.characters[id];
  assert.equal(c.ac, 16, "the server works out AC when auto is on (11 + 2 + 2 + misc 1), ignoring the typed 99");
  assert.equal(c.equipment[2].armor, undefined, "an unknown armor kind is dropped");
  assert.equal(c.attacks[0].critRange, 19);
  assert.equal(c.attacks[1].critRange, undefined, "20 is the default, not stored");
  assert.equal(c.attacks[2].critRange, 15, "clamped to 15-20");
  assert.equal(R.saveBonus(c, "dex"), 2 + 2, "save misc adds");
  const id2 = (await p1.act("char.save", { char: Object.assign(ch({ ac: 18 }), { name: "Typed", equipment: [arm("Combat suit", "light", 11)] }) })).data.id;
  c = (await gm.poll()).data.state.characters[id2];
  assert.equal(c.ac, 18, "without auto, the typed AC stands as before");
  assert.equal(c.acAuto, undefined);
  // the page fills every sheet it gets from a blank one, and imports start from one: neither may switch auto on (#165)
  assert.equal(R.blankCharacter().acAuto, undefined, "a blank sheet doesn't turn auto AC on");
  const old = Object.assign(R.blankCharacter(), { name: "Old", ac: 17, abilities: { dex: 12 }, equipment: [{ name: "Combat suit", equipped: true }] });
  const id3 = (await p1.act("char.save", { char: old })).data.id;
  c = (await gm.poll()).data.state.characters[id3];
  assert.equal(c.ac, 17, "an old sheet (or an import) filled from the blank keeps its typed AC");
});

test("temporary force/tech points are spent first (audit 4.9); size from the sheet sizes the token (audit 5.12)", async () => {
  require("../sections/jpesus/holotable/rules.js");
  const R = globalThis.SW5E;
  assert.deepEqual(R.pointsSpend({ used: 2, temp: 3 }, 4, 10), { temp: 0, used: 3, fromTemp: 3 }, "3 temp, then 1 of their own");
  assert.deepEqual(R.pointsSpend({ used: 0, temp: 5 }, 2, 10), { temp: 3, used: 0, fromTemp: 2 });
  assert.equal(R.pointsSpend({ used: 9, temp: 1 }, 3, 10), null, "only 2 left in all");
  assert.equal(R.pointsSpend({ used: 9 }, 1, 10).used, 10, "no temp: as before");
  assert.equal(R.tokenSquares("Huge"), 3);
  assert.equal(R.tokenSquares("Small"), 1);

  const { gm, p1 } = await table();
  const id = (await p1.act("char.save", { char: { name: "Grok", size: "Large", force: { used: 1, temp: 4 }, tech: { temp: -3 } } })).data.id;
  let c = (await gm.poll()).data.state.characters[id];
  assert.equal(c.size, "Large");
  assert.equal(c.force.temp, 4);
  assert.equal(c.tech.temp, undefined, "none kept when there are none");
  const id2 = (await p1.act("char.save", { char: { name: "Odd", size: "Colossal" } })).data.id;
  assert.equal((await gm.poll()).data.state.characters[id2].size, undefined, "only SW5e's sizes");
  await p1.act("token.add", { charId: id, x: 1, y: 1 });
  await gm.act("token.add", { charId: id2, x: 5, y: 1 });
  const toks = (await gm.poll()).data.state.map.tokens;
  assert.equal(toks.find((t) => t.charId === id).size, 2, "a Large character's token takes 2 squares");
  assert.equal(toks.find((t) => t.charId === id2).size, 1);
  const id3 = (await p1.act("char.save", { char: { name: "Mouse", size: "Tiny" } })).data.id;
  await p1.act("token.add", { charId: id3, x: 8, y: 1 });
  const mt = (await gm.poll()).data.state.map.tokens.find((t) => t.charId === id3);
  assert.deepEqual([mt.size, mt.tiny], [1, true], "a Tiny character's token is Tiny");
});

test("the GM awards XP after an encounter, split evenly; levelling stays the GM's grant (audit 9.8)", async () => {
  const { gm, p1, p2 } = await table();
  const kira = (await p1.act("char.save", { char: { name: "Kira", xp: 250, classes: [{ name: "Operative", level: 1 }] } })).data.id;
  const rex = (await p2.act("char.save", { char: { name: "Rex", xp: 0, classes: [{ name: "Fighter", level: 1 }] } })).data.id;
  const npc = (await gm.act("char.save", { char: { name: "Darth Secret" } })).data.id;
  assert.equal((await p1.act("xp.award", { amount: 100, chars: [kira] })).code, 403, "GM only");
  assert.equal((await gm.act("xp.award", { amount: 100, chars: ["__proto__", "constructor"] })).code, 400);
  const r = await gm.act("xp.award", { amount: 101, chars: [kira, rex, npc], reason: "The cantina fight" });
  assert.equal(r.code, 200);
  assert.equal(r.data.each, 33);
  const g = (await gm.poll()).data.state;
  assert.equal(g.characters[kira].xp, 283);
  assert.equal(g.characters[rex].xp, 33);
  assert.equal(g.characters[kira].classes[0].level, 1, "nobody levels by themselves");
  await gm.act("xp.award", { amount: 40, chars: [kira] });
  const pchat = (await p1.poll()).data.state.chat.map((m) => m.text || "");
  assert.ok(pchat.some((t) => /^The cantina fight: 101 XP, 33 each for Kira, Rex, 1 more\.$/.test(t)), pchat.join(" | "));
  assert.ok(!pchat.join(" ").includes("Darth Secret"), "the GM's NPC isn't named");
  assert.ok(!pchat.some((t) => /Enough XP/.test(t)), "the level note is the GM's");
  assert.ok((await gm.poll()).data.state.chat.some((m) => /Enough XP for the next level: Kira \(323 XP, level 2 at 300\)/.test(m.text || "")));
});

test("the GM's own NPC templates: saved, added to initiative, never sent to players (audit 9.9)", async () => {
  const { gm, p1 } = await table();
  assert.equal((await p1.act("npc.save", { npc: { name: "Thug" } })).code, 403);
  assert.equal((await gm.act("npc.save", { npc: { name: "  " } })).code, 400);
  const r = await gm.act("npc.save", { npc: { name: "Swoop Ganger", bonus: 3, hp: 22, ac: 13, notes: "Owes Kira money",
    attacks: [{ n: "Vibroknife", hit: 5, dmg: "1d4+3 kinetic" }, { n: "", hit: 1 }, "junk"] } });
  assert.equal(r.code, 200);
  const id = r.data.id;
  let g = (await gm.poll()).data.state;
  assert.equal(g.npcs.length, 1);
  assert.deepEqual(g.npcs[0].attacks, [{ n: "Vibroknife", hit: 5, dmg: "1d4+3 kinetic" }]);
  await gm.act("npc.save", { npc: Object.assign({}, g.npcs[0], { hp: 30 }) });
  g = (await gm.poll()).data.state;
  assert.equal(g.npcs.length, 1, "the same id edits it");
  assert.equal(g.npcs[0].hp, 30);
  await gm.act("init.add", { name: "Swoop Ganger 1", bonus: 3, hp: 30, ac: 13, tpl: id });
  await gm.act("init.add", { name: "Rando", tpl: "__proto__" });
  g = (await gm.poll()).data.state;
  assert.equal(g.initiative.entries.find((e) => e.name === "Swoop Ganger 1").tpl, id);
  assert.equal(g.initiative.entries.find((e) => e.name === "Rando").tpl, undefined, "only a template the table has");
  const ps = (await p1.poll()).data.state;
  assert.equal(ps.npcs, undefined, "templates are the GM's");
  assert.ok(ps.initiative.entries.every((e) => e.tpl === undefined));
  assert.ok(!JSON.stringify(ps).includes("Owes Kira money"));
  await gm.act("npc.remove", { id });
  assert.equal((await gm.poll()).data.state.npcs, undefined);
});

test("Reliable Talent, Brutal Critical, and shots for Reload weapons (#67, audit 6.6)", async () => {
  require("../sections/jpesus/holotable/rules.js");
  const R = globalThis.SW5E;
  const op = (lvl) => ({ classes: [{ name: "Operative", level: lvl }], abilities: { dex: 16 }, skills: { stealth: 2, acrobatics: 0, insight: 1 } });
  assert.deepEqual(R.skillRollExpr(op(11), "stealth"), { expr: "1d20min8+11", reliable: true }, "Dex +3, expertise 2 x +4");
  assert.equal(R.skillRollExpr(op(11), "acrobatics").reliable, false, "no proficiency, no Reliable Talent");
  assert.equal(R.skillRollExpr(op(10), "stealth").reliable, false, "from 11th level");
  const bz = (lvl) => ({ classes: [{ name: "Berserker", level: lvl }], abilities: { str: 16 } });
  const axe = { name: "Vibroaxe", ab: "str", damage: "1d12", props: "Heavy, Two-handed" };
  assert.deepEqual(R.critDamage(bz(8), axe), { expr: "2d12+3", brutal: 0 });
  assert.deepEqual(R.critDamage(bz(9), axe), { expr: "2d12+3+1d12", brutal: 1 });
  assert.deepEqual(R.critDamage(bz(17), axe), { expr: "2d12+3+3d12", brutal: 3 });
  assert.equal(R.critDamage(bz(17), { name: "Blaster rifle", ab: "dex", damage: "1d8", props: "Ammunition (range 100/400), Reload 12" }).brutal, 0, "melee only");
  const rifle = { name: "Blaster rifle", props: "Power Cell, Reload 12, Two-handed" };
  assert.equal(R.reloadOf(rifle), 12);
  assert.equal(R.ammoOf(rifle), "Power cell");
  assert.equal(R.ammoOf({ props: "Slug Cartridge, Reload 8" }), "Slug cartridge");
  assert.equal(R.shotsOf(rifle), 12, "a fresh weapon is loaded");
  assert.equal(R.shotsOf(Object.assign({}, rifle, { shots: 3 })), 3);
  assert.equal(R.shotsOf({ props: "Finesse" }), null, "no Reload, no count");

  const { gm, p1 } = await table();
  const id = (await p1.act("char.save", { char: { name: "Kira", attacks: [Object.assign({}, rifle, { shots: 5 }), Object.assign({}, rifle, { shots: -4 }), { name: "Knife" }] } })).data.id;
  const c = (await gm.poll()).data.state.characters[id];
  assert.equal(c.attacks[0].shots, 5);
  assert.equal(c.attacks[1].shots, 0, "clamped at 0");
  assert.equal(c.attacks[2].shots, undefined, "not stored when unset");
});

test("tokens: Tiny creatures and elevation (audit 8.14, 8.15)", async () => {
  const { gm, p1 } = await table();
  await gm.act("token.add", { name: "Mynock", x: 2, y: 2 });
  const tok = () => gm.poll().then((r) => r.data.state.map.tokens.find((t) => t.name === "Mynock"));
  const id = (await tok()).id;
  await gm.act("token.update", { id, fields: { tiny: true, elev: 32 } });
  let t = await tok();
  assert.equal(t.tiny, true);
  assert.equal(t.size, 1, "still one square for walls, fog and the combat view");
  assert.equal(t.elev, 30, "in 5-ft steps");
  await gm.act("token.update", { id, fields: { size: 2 } });
  t = await tok();
  assert.equal(t.tiny, undefined, "a bigger size isn't Tiny");
  await gm.act("token.update", { id, fields: { size: 1, tiny: true, elev: -999999 } });
  t = await tok();
  assert.equal(t.elev, -9995, "clamped");
  await gm.act("token.update", { id, fields: { elev: 0 } });
  t = await tok();
  assert.equal(t.elev, undefined, "the ground isn't kept");
  assert.equal(t.tiny, true);
  assert.equal((await p1.act("token.update", { id, fields: { elev: 10 } })).code, 403, "only the GM or the token's owner");
  assert.equal((await p1.poll()).data.state.map.tokens.find((x) => x.id === id).tiny, true, "players see it Tiny too");
});

test("map: anyone pings (once a second each); the GM draws and clears (audit 8.13)", async () => {
  const { gm, p1 } = await table();
  assert.equal((await p1.act("map.ping", { x: 3.5, y: 2.25 })).code, 200);
  await p1.act("map.ping", { x: 9, y: 9 });   // too soon: dropped
  let pings = (await gm.poll()).data.state.pings;
  assert.equal(pings.length, 1);
  assert.deepEqual([pings[0].x, pings[0].y, pings[0].name, pings[0].gm], [3.5, 2.25, "Sam", false]);
  assert.equal((await p1.act("map.ping", { x: "nope" })).code, 400);
  assert.equal((await p1.act("map.draw", { pts: [0, 0, 1, 1] })).code, 403, "drawing is the GM's");
  assert.equal((await gm.act("map.draw", { pts: [0, 0, 1, 1.5, 2, 9999], c: "#ef5350" })).code, 200);
  assert.equal((await gm.act("map.draw", { pts: [1] })).code, 400, "a stroke needs two points");
  await gm.act("map.draw", { pts: [5, 5, 6, 6], c: "javascript:alert(1)" });
  let d = (await p1.poll()).data.state.map.drawings;
  assert.equal(d.length, 2, "players see the drawings");
  assert.deepEqual(d[0].pts, [0, 0, 1, 1.5, 2, 300], "clamped to the board's reach");
  assert.equal(d[1].c, "#ffd27a", "only the palette's colours");
  await gm.act("map.drawClear", { id: d[0].id });
  assert.equal((await gm.poll()).data.state.map.drawings.length, 1);
  await gm.act("map.drawClear", {});
  assert.equal((await gm.poll()).data.state.map.drawings, undefined, "none left");
});

test("Infuse Item (Engineer): +1/+2/+3 to the infused weapon's attack and damage or the armor's AC (#67, 3.4)", async () => {
  require("../sections/jpesus/holotable/rules.js");
  const R = globalThis.SW5E;
  const eng = (lvl, o) => Object.assign({ classes: [{ name: "Engineer", level: lvl }], abilities: { str: 14, dex: 12 }, equipment: [] }, o);
  const blade = { name: "Vibrosword", ab: "str", damage: "1d8" };
  assert.deepEqual([1, 2, 9, 10, 15].map((l) => R.infuseBonus(eng(l))), [0, 1, 1, 2, 3]);
  const c = eng(10, { infused: "attack:Vibrosword", attacks: [blade] });
  assert.equal(R.attackBonus(c, blade), 2 + 4 + 2, "Str +2, proficiency +4, infused +2");
  assert.equal(R.damageExpr(c, blade), "1d8+4");
  assert.equal(R.attackBonus(eng(10, { attacks: [blade] }), blade), 6, "not infused: as before");
  const suit = { name: "Combat suit", equipped: true, armor: { kind: "light", ac: 11 } };
  assert.equal(R.armorClass(eng(15, { equipment: [suit], infused: "equipment:Combat suit" })).total, 15, "11 + Dex 1 + 3");
  assert.equal(R.armorClass(eng(15, { equipment: [Object.assign({}, suit, { equipped: false })], infused: "equipment:Combat suit" })).total, 11, "only while worn");
  assert.equal(R.armorClass(eng(2, { equipment: [{ name: "Light shield", equipped: true, armor: { kind: "shield", ac: 1 } }], infused: "equipment:Light shield" })).total, 13, "10 + 1 + shield 1 + infused 1");
  assert.equal(R.attackBonus({ classes: [{ name: "Fighter", level: 10 }], abilities: { str: 14 }, infused: "attack:Vibrosword" }, blade), 6, "only an Engineer's");

  const { gm, p1 } = await table();
  const id = (await p1.act("char.save", { char: eng(10, { name: "Tink", acAuto: true, infused: "equipment:Combat suit", equipment: [suit] }) })).data.id;
  let s = (await gm.poll()).data.state.characters[id];
  assert.equal(s.infused, "equipment:Combat suit");
  assert.equal(s.ac, 14, "the server's auto AC includes it");
  const id2 = (await p1.act("char.save", { char: eng(10, { name: "Odd", infused: "javascript:alert(1)" }) })).data.id;
  assert.equal((await gm.poll()).data.state.characters[id2].infused, undefined);
});

test("the GM's table rules: only the GM changes levels, XP and max HP (12.6); stat blocks kept from players (9.17)", async () => {
  const { gm, p1 } = await table();
  const sheet = { name: "Kira", xp: 300, classes: [{ name: "Operative", level: 3, archetype: "" }], hp: { max: 20, current: 20, temp: 0 } };
  const id = (await p1.act("char.save", { char: sheet })).data.id;
  assert.equal((await p1.act("settings.sheetLock", { on: true })).code, 403);
  await gm.act("settings.sheetLock", { on: true });
  assert.equal((await p1.poll()).data.state.sheetLock, true);
  const c0 = (await p1.poll()).data.state.characters[id];
  await p1.act("char.save", { char: Object.assign({}, c0, { xp: 99999, credits: 50, classes: [{ name: "Operative", level: 20, archetype: "Gunslinger Practice" }], hp: { max: 999, current: 15, temp: 0 } }) });
  let c = (await gm.poll()).data.state.characters[id];
  assert.deepEqual([c.xp, c.classes[0].level, c.hp.max], [300, 3, 20], "a player's save keeps them");
  assert.deepEqual([c.classes[0].archetype, c.credits, c.hp.current], ["Gunslinger Practice", 50, 15], "the rest is still the player's");
  await gm.act("char.save", { char: Object.assign({}, c, { xp: 900 }) });
  assert.equal((await gm.poll()).data.state.characters[id].xp, 900, "the GM's own edits go through");
  await gm.act("settings.sheetLock", { on: false });
  await p1.act("char.save", { char: Object.assign({}, (await p1.poll()).data.state.characters[id], { xp: 1000 }) });
  assert.equal((await gm.poll()).data.state.characters[id].xp, 1000, "off: as before");

  await gm.act("settings.statBlocks", { hidden: true });
  const st = (await p1.poll()).data.state;
  assert.equal(st.statBlocksHidden, true);
  await gm.act("settings.statBlocks", { hidden: false });
  assert.equal((await p1.poll()).data.state.statBlocksHidden, undefined);
});

test("the GM's lock also holds a player's new sheet and current HP (#191 review follow-up)", async () => {
  const { gm, p1 } = await table();
  await gm.act("settings.sheetLock", { on: true });
  const id = (await p1.act("char.save", { char: { name: "Overpowered", classes: [{ name: "Fighter", level: 20 }, { name: "Consular", level: 5 }], xp: 999999, abilities: { con: 14 }, hp: { max: 500, current: 500, temp: 0 } } })).data.id;
  let c = (await gm.poll()).data.state.characters[id];
  assert.deepEqual(c.classes.map((k) => [k.name, k.level]), [["Fighter", 1]], "a new sheet starts at 1st level");
  assert.deepEqual([c.xp, c.hp.max, c.hp.current], [0, 12, 12], "no XP; d10 max + Con 2; current capped");
  await p1.act("char.save", { char: Object.assign({}, c, { hp: { max: 12, current: 250, temp: 3 } }) });
  c = (await gm.poll()).data.state.characters[id];
  assert.deepEqual([c.hp.current, c.hp.temp], [12, 3], "current HP can't pass the max; temp has its own box");
  const gid = (await gm.act("char.save", { char: { name: "Boss", classes: [{ name: "Fighter", level: 15 }], hp: { max: 150, current: 150 } } })).data.id;
  assert.equal((await gm.poll()).data.state.characters[gid].classes[0].level, 15, "the GM's own sheets are the GM's");
  await gm.act("settings.sheetLock", { on: false });
  const id2 = (await p1.act("char.save", { char: { name: "Import", classes: [{ name: "Fighter", level: 7 }], xp: 23000 } })).data.id;
  assert.equal((await gm.poll()).data.state.characters[id2].classes[0].level, 7, "off: as before");
});
