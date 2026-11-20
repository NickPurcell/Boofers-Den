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
