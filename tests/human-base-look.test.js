// The look parser (sections/guitar-goblin/human-base/look-parse.js): a look on the table is written by other people,
// so whatever text arrives, the parser keeps only whitelisted keys and values, clamps numbers, never touches
// Object.prototype, never throws, and a bad look gives the species default. No real names here.
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const L = require("../sections/guitar-goblin/human-base/look-parse.js");
const S = L.SCHEMA;

const SAFE = /^[A-Za-z0-9=&._\-]+$/;   // everything a canonical look may contain
const def = (sp) => L.parseLook("species=" + sp);
const protoClean = () => {
  const o = {};
  for (const k of ["polluted", "x", "skin", "people", "jaw", "items", "def", "range", "multi"]) assert.equal(o[k], undefined, `Object.prototype.${k} was set`);
};

test("every species' default reads back as itself, and a clean look is unchanged", () => {
  for (const sp of S.speciesOrder) {
    const a = def(sp);
    assert.equal(a.species, sp);
    assert.equal(a.changed, 0);
    assert.match(a.look, SAFE);
    const b = L.parseLook(a.look);
    assert.equal(b.look, a.look);
    assert.equal(b.changed, 0);
    for (const k of S.species[sp].order) assert.ok(Object.prototype.hasOwnProperty.call(b.values, k), `${sp} has ${k}`);
  }
});

test("a share link, with its address and controls, reads the same as the bare look", () => {
  const sp = S.speciesOrder[S.speciesOrder.length - 1], c = S.controlOrder[0], C = S.controls[c];
  const mid = Math.round(((C.min + C.max) / 2) * 100) / 100;
  const bare = `species=${sp}&c.${c}=${mid.toFixed(2)}`;
  const link = L.parseLook("https://example.invalid/sections/guitar-goblin/characters/#" + bare);
  assert.equal(link.look, L.parseLook(bare).look);
  assert.equal(link.controls[c], mid);
});

test("prototype keys and names never reach Object.prototype or the result", () => {
  const nasty = ["__proto__", "constructor", "prototype", "toString", "hasOwnProperty", "valueOf", "__defineGetter__"];
  for (const n of nasty) {
    for (const text of [`species=${n}`, `${n}=x&species=human`, `species=human&people=${n}`, `species=human&skin=${n}`,
      `species=human&c.${n}=1`, `species=human&${n}.polluted=1`, `species=pureblood&jewel=${n}.rings`, `species=human&__proto__[polluted]=1`,
      `species=human&constructor.prototype.polluted=1`, `species=human&${encodeURIComponent(n)}=1`]) {
      const r = L.parseLook(text);
      protoClean();
      assert.ok(S.speciesOrder.includes(r.species));
      assert.match(r.look, SAFE);
      assert.ok(!r.look.includes(n), `${text} -> ${r.look}`);
      for (const k of Object.keys(r.values)) assert.ok(S.species[r.species].order.includes(k));
      for (const k of Object.keys(r.controls)) assert.ok(S.controlOrder.includes(k));
    }
  }
  // an unknown species is the default look of the default species, whole
  assert.equal(L.parseLook("species=__proto__&skin=crimson").look, def(S.speciesOrder[0]).look);
});

test("markup, paths and script never come out; an unknown value takes the species default", () => {
  const sp = "human", base = def(sp);
  for (const bad of ['<img src=x onerror=alert(1)>', '"><script>alert(1)</script>', "javascript:alert(1)", "../../etc/passwd", "a b", "%00", "x".repeat(300), "' OR 1=1 --", "${1+1}", "{{7*7}}"]) {
    for (const k of ["skin", "outfit", "people", "zzz"]) {
      const r = L.parseLook(`species=${sp}&${k}=${encodeURIComponent(bad)}`);
      assert.match(r.look, SAFE);
      assert.equal(r.look, base.look, `${k}=${bad}`);
      assert.ok(r.changed >= 1);
    }
  }
});

test("numbers are read strictly, clamped and rounded", () => {
  const k = S.controlOrder.find((c) => S.controls[c].min < 0) || S.controlOrder[0], C = S.controls[k];
  const read = (v) => L.parseLook(`species=human&c.${k}=${encodeURIComponent(v)}`).controls[k];
  const person = def("human").controls[k];
  assert.equal(read("1e309"), person);       // not a plain decimal: ignored
  assert.equal(read("Infinity"), person);
  assert.equal(read("NaN"), person);
  assert.equal(read("0x10"), person);
  assert.equal(read(" 0.3"), person);
  assert.equal(read("999"), C.max);
  assert.equal(read("-999"), C.min);
  assert.equal(read(String(C.min + 0.123456)), Math.round((C.min + 0.123456) * 100) / 100);
  if (S.species.pureblood && S.species.pureblood.keys.ridges) {
    const R = S.species.pureblood.keys.ridges;
    assert.equal(L.parseLook("species=pureblood&ridges=5").values.ridges, R.range[1]);
    assert.equal(L.parseLook("species=pureblood&ridges=-5").values.ridges, R.range[0]);
    assert.equal(L.parseLook("species=pureblood&ridges=lots").values.ridges, R.def);
  }
});

test("a choice of several keeps only known ones, in a fixed order", () => {
  const sp = S.speciesOrder.find((s) => S.species[s].order.some((k) => S.species[s].keys[k].multi));
  if (!sp) return;
  const k = S.species[sp].order.find((x) => S.species[sp].keys[x].multi), items = S.species[sp].keys[k].items;
  const r = L.parseLook(`species=${sp}&${k}=${[items[1], "bogus", items[0], items[1]].join(".")}`);
  assert.equal(r.values[k], [items[0], items[1]].join("."));
  assert.equal(r.changed, 1);
  assert.equal(L.parseLook(`species=${sp}&${k}=${[items[1], items[0]].join(".")}`).look, L.parseLook(`species=${sp}&${k}=${[items[0], items[1]].join(".")}`).look);
});

test("not text, too long, broken escapes: the default, never an error", () => {
  const d0 = def(S.speciesOrder[0]).look;
  for (const v of [null, undefined, 42, {}, [], ["species=human"], { toString: () => "species=human" }, Symbol("x"), () => "species=human"]) assert.equal(L.parseLook(v).look, d0);
  assert.equal(L.parseLook("species=human&" + "a=b&".repeat(1000)).look, d0);   // longer than the cap
  assert.ok(L.parseLook("species=human&skin=%E0%A4%A").look.startsWith("species=human&"));
  assert.ok(L.parseLook("species=human&%=1&=&&&=x&skin").look.startsWith("species=human&"));
});

test("random text never throws and never leaves the whitelist", () => {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const bits = ["species=", "human", "pureblood", "mikkian", "&", "=", "c.", "jaw", "%", "%2", "%26", "+", ".", "__proto__", "constructor", "#", "<", ">", "\"", "1", "-", "0.5", "e9", "skin", "people", "\u0000", "\ud800", "é"];
  for (let i = 0; i < 3000; i++) {
    let t = ""; const n = 1 + Math.floor(rnd() * 30); for (let j = 0; j < n; j++) t += bits[Math.floor(rnd() * bits.length)];
    const r = L.parseLook(t);
    assert.ok(S.speciesOrder.includes(r.species));
    assert.match(r.look, SAFE);
    assert.equal(L.parseLook(r.look).look, r.look, "the canonical form reads back as itself");
  }
  protoClean();
});

test("the whitelist is the creator's own lists (when the creator is in this checkout)", { skip: !existsSync(join(__dirname, "..", "sections", "guitar-goblin", "characters", "looks-page.js")) && "the creator's lists (characters/looks-page.js) are not in this checkout yet" }, () => {
  const r = spawnSync(process.execPath, ["--import", join(__dirname, "human-base", "three-hook.mjs"), join(__dirname, "human-base", "look-schema.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

test("a look naming a blaster keeps it: every carried item in the creator's list survives the round trip", async () => {
  const { ITEMS } = await import("../sections/guitar-goblin/human-base/carry.js").catch(() => ({ ITEMS: null }));
  const items = ["none", "hilt", "double", "staff", "pistol", "rifle"];
  for (const sp of S.speciesOrder) {
    assert.deepEqual(S.species[sp].keys.gear.items, items, `${sp}: the Carries list`);
    for (const g of ["pistol", "rifle"]) {
      const r = L.parseLook(`species=${sp}&gear=${g}`);
      assert.equal(r.values.gear, g); assert.equal(r.changed, 0);
      assert.equal(L.parseLook(r.look).values.gear, g);
    }
  }
  assert.ok(ITEMS === null || items.every((k) => k in ITEMS));
});

// A look says which kind of figure it is. No kind (every look made before there were kinds) or kind=humanoid is a
// person on the human base; kind=jawa is read against the Jawa creator's own lists only. Nothing of one kind's list may
// reach another kind's figure, and an unknown kind gives the humanoid default.
test("kinds: an old look with no kind is still a humanoid, read exactly as before", () => {
  for (const sp of S.speciesOrder) {
    const a = def(sp), b = L.parseLook("kind=humanoid&species=" + sp);
    assert.equal(a.kind, "humanoid"); assert.equal(b.kind, "humanoid");
    assert.equal(b.look, a.look, "kind=humanoid writes back as the plain look"); assert.equal(b.changed, 0);
  }
  assert.equal(L.parseLook("species=human&outfit=coat&c.jaw=0.3").kind, "humanoid");
});

test("kinds: a Jawa look keeps only the Jawa's keys, in its own order, and reads back as itself", () => {
  const J = S.kinds.jawa;
  assert.ok(J && J.order.includes("robe") && J.order.includes("hold") && J.order.includes("seed"));
  const d = L.parseLook("kind=jawa");
  assert.equal(d.kind, "jawa"); assert.equal(d.species, null); assert.equal(d.controls, null); assert.equal(d.changed, 0);
  assert.match(d.look, SAFE); assert.ok(d.look.startsWith("kind=jawa&"));
  assert.equal(L.parseLook(d.look).look, d.look);
  for (const k of J.order) assert.ok(Object.prototype.hasOwnProperty.call(d.values, k), `the Jawa has ${k}`);
  // each choice the creator offers survives the round trip
  for (const k of J.order) if (J.keys[k].items) for (const v of J.keys[k].items) {
    const r = L.parseLook(`kind=jawa&${k}=${v}`); assert.equal(r.changed, 0, `${k}=${v}`);
    assert.equal(L.parseLook(r.look).values[k], r.values[k]);
  }
});

test("kinds: no smuggling — a humanoid's keys never reach a Jawa, a Jawa's never reach a humanoid", () => {
  const j = L.parseLook("kind=jawa&species=pureblood&c.jaw=0.9&outfit=plate&gear=rifle&glow=bright&robe=plum");
  assert.equal(j.kind, "jawa"); assert.equal(j.values.robe, "plum");
  for (const k of ["species", "c.jaw", "outfit", "gear"]) assert.ok(!Object.prototype.hasOwnProperty.call(j.values, k), `${k} reached the Jawa`);
  assert.ok(!/species|outfit|gear|c\./.test(j.look)); assert.equal(j.changed, 4);
  const h = L.parseLook("species=human&robe=plum&hold=blaster&rig=toolbelt&extras=goggles");
  assert.equal(h.kind, "humanoid");
  for (const k of ["robe", "hold", "rig", "extras"]) assert.ok(!Object.prototype.hasOwnProperty.call(h.values, k), `${k} reached the humanoid`);
  assert.ok(!/robe|hold|rig|extras/.test(h.look));
  // the whole look is read as one kind (the last kind= wins, as for every key): never a mix
  const m = L.parseLook("kind=jawa&robe=plum&kind=humanoid&species=human");
  assert.equal(m.kind, "humanoid"); assert.ok(!Object.prototype.hasOwnProperty.call(m.values, "robe"));
});

test("kinds: an unknown kind, a prototype name or a bad value gives a default, never an error", () => {
  const d0 = def(S.speciesOrder[0]).look;
  for (const k of ["droid", "__proto__", "constructor", "toString", "hasOwnProperty", "JAWA", "jawa.", ""]) {
    const r = L.parseLook(`kind=${k}&species=human&robe=plum`); assert.equal(r.kind, "humanoid"); assert.equal(r.look, d0, `kind=${k}`); assert.equal(r.fallback, true);
  }
  // a kind that is not even readable text is dropped like any bad pair: no kind, so a humanoid, with no Jawa keys
  for (const k of ["jawa ", "%00", "<b>"]) { const r = L.parseLook(`kind=${k}&species=human&robe=plum`); assert.equal(r.kind, "humanoid"); assert.ok(!/robe/.test(r.look)); }
  const b = L.parseLook("kind=jawa&robe=<script>&seed=12.6&build=__proto__&extras=goggles.nope.satchel.goggles&eyes=%E0%A4%A");
  assert.equal(b.kind, "jawa"); assert.match(b.look, SAFE);
  assert.equal(b.values.robe, S.kinds.jawa.keys.robe.def); assert.equal(b.values.build, S.kinds.jawa.keys.build.def);
  assert.equal(b.values.seed, 13); assert.equal(b.values.extras, "goggles.satchel");
  for (const s of ["-4", "99999", "1e3", "0x10", "NaN", ""]) { const v = L.parseLook("kind=jawa&seed=" + s).values.seed; assert.ok(Number.isInteger(v) && v >= 0 && v <= 9999, `seed=${s} gave ${v}`); }
  protoClean();
});

test("kinds: random text with kinds in it never throws and never leaves its kind's whitelist", () => {
  let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const bits = ["kind=", "jawa", "humanoid", "droid", "&", "=", "species=", "human", "robe", "plum", "seed", "hold", "blaster", "extras", "goggles", ".", "%", "%26", "__proto__", "constructor", "c.jaw", "1", "0.5", "<", "\u0000"];
  for (let i = 0; i < 3000; i++) {
    let t = ""; const n = 1 + Math.floor(rnd() * 24); for (let j = 0; j < n; j++) t += bits[Math.floor(rnd() * bits.length)];
    const r = L.parseLook(t);
    assert.ok(r.kind === "humanoid" || r.kind === "jawa"); assert.match(r.look, SAFE);
    if (r.kind === "jawa") for (const k of Object.keys(r.values)) assert.ok(S.kinds.jawa.order.includes(k), k);
    else assert.ok(S.speciesOrder.includes(r.species));
    assert.equal(L.parseLook(r.look).look, r.look);
  }
  protoClean();
});
