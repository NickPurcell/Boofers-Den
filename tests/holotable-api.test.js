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
let db = new HoloFake();
let sub = null;
S.getClient = () => db;
S.getSub = () => (sub = sub || db.duplicate());
function fresh() { db = new HoloFake(); sub = null; }

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
  for (const q of [{ op: "poll" }, { op: "assets" }, { op: "pack", id: "abc-123456" }, { op: "export" }, { op: "me" }, { img: imgId }, { a: "abc-123456.0" }]) {
    assert.equal((await anon.call("GET", q)).code, 401, JSON.stringify(q));
  }
  for (const op of ["action", "upload", "backups", "restore", "packstart", "packadd", "packdone", "packdelete"]) {
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

test("pack batches: written in one round trip, and a retried batch isn't added twice", async () => {
  const { gm } = await table();
  const packId = (await gm.post("packstart", { name: "Retry Pack", bytes: 10 })).data.packId;
  const items = [{ n: "a", c: "props", data: PNG.toString("base64") }, { n: "b", c: "props", data: PNG.toString("base64") }];
  let pipelines = 0;
  const realPipe = db.pipeline.bind(db);
  db.pipeline = () => { pipelines++; return realPipe(); };
  try {
    assert.equal((await gm.post("packadd", { packId, seq: 0, items })).data.count, 2);
    assert.equal(pipelines, 1, "the whole batch goes in one pipeline");
    const again = await gm.post("packadd", { packId, seq: 0, items }); // the browser retries after a timeout
    assert.equal(again.data.count, 2);
    assert.equal(again.data.repeat, true);
    assert.equal((await gm.post("packadd", { packId, seq: 1, items: items.slice(0, 1) })).data.count, 3);
  } finally { db.pipeline = realPipe; }
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
  const { p1 } = await table();
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
  sh.hull.current = 12;
  assert.equal((await p2.act("ship.save", { ship: sh })).code, 200, "anyone at the table can update a party ship");
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
