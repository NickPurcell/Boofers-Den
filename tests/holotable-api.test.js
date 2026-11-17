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
