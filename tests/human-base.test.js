// The human base (sections/guitar-goblin/human-base/): the shipped derived tables still match the data they were
// derived from, and the data files are the ones the NOTICE describes.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const DATA = join(__dirname, "..", "sections", "guitar-goblin", "human-base", "data");

test("derived.json matches a fresh derivation from the mesh", () => {
  const r = spawnSync(process.execPath, [join(__dirname, "human-base", "bake.mjs"), DATA, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /matches a fresh derivation/);
});

test("the NOTICE keeps its source and licence lines", () => {
  const n = readFileSync(join(DATA, "NOTICE.md"), "utf8");
  assert.match(n, /makehumancommunity\/makehuman/);
  assert.match(n, /a8bc2d54ff0ac92e78ff71431b1023eda42bf482/);
  assert.match(n, /CC0 1\.0 Universal/);
  assert.match(n, /none of it is used, copied or adapted here/);
});

test("the mesh header agrees with the binaries", () => {
  const M = JSON.parse(readFileSync(join(DATA, "mesh.json"), "utf8"));
  assert.ok(Object.keys(M.targets).length > 100, "targets listed");
  assert.equal(readFileSync(join(DATA, "mesh.bin")).length, M.vertices * 12 + M.quads * 8, "mesh.bin: positions then quads");
  assert.equal(readFileSync(join(DATA, "skin.bin")).length, M.vertices * 4, "skin.bin: four weights per vertex");
});

test("the table's coarser body: the level asked for, every eye-rim vertex kept, no vertex folded into a gone one", async () => {
  const D = await import("../sections/guitar-goblin/human-base/derive.js");
  const ab = (f) => { const b = readFileSync(join(DATA, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const B = D.decode(JSON.parse(readFileSync(join(DATA, "mesh.json"), "utf8")), ab("mesh.bin"), ab("targets.bin"), ab("skin.bin"));
  B.derived = D.unpack(JSON.parse(readFileSync(join(DATA, "derived.json"), "utf8")));
  for (const keep of [3500, 1500]) {
    const { rep, kept } = D.coarser(B, keep);
    assert.equal(kept, keep);
    const stay = new Set(); for (let i = 0; i < B.N; i++) if (B.inBody[i]) stay.add(rep[i]);
    assert.equal(stay.size, keep);
    for (const v of stay) assert.equal(rep[v], v, "a vertex that stays stands for itself");
  }
  // the edges round the eyes (used by one quad only) keep their line: their vertices fold only along it
  const { rep } = D.coarser(B, 3500), edge = new Map(), key = (a, b) => (a < b ? a + "," + b : b + "," + a), q = B.quads;
  for (let f = 0; f < q.length; f += 4) for (let k = 0; k < 4; k++) { const e = key(q[f + k], q[f + ((k + 1) % 4)]); edge.set(e, (edge.get(e) || 0) + 1); }
  const rim = new Set(); for (const [e, n] of edge) if (n === 1) for (const v of e.split(",")) rim.add(+v);
  assert.ok(rim.size > 20, "the mesh has its eye openings");
  for (const v of rim) assert.ok(rim.has(rep[v]), "a rim vertex folds into a rim vertex");
});
