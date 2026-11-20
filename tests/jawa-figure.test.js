// The Jawa as a table figure (sections/guitar-goblin/jawa-creator/bake.js): its skeleton is the human base's 38 bones,
// by name and parent, placed inside a metre-tall Jawa, so the same run, stand and clips (human-base/motion.js, clips.js)
// move it. The bake itself needs the page (it meshes in workers); this checks the skeleton and the motion on it.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const GG = join(__dirname, "..", "sections", "guitar-goblin");
const three = pathToFileURL(join(GG, "vendor", "three", "three.module.min.js")).href;
require("node:module").register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { return s === 'three' ? { url: ${JSON.stringify(three)}, shortCircuit: true } : next(s, c); }`));

async function load() {
  const B = await import(join(GG, "jawa-creator", "bake.js")), F = await import(join(GG, "jawa-creator", "figure.js"));
  const M = await import(join(GG, "human-base", "motion.js")), C = await import(join(GG, "human-base", "clips.js"));
  return { B, F, M, C };
}
const skeletonOf = (B, F, build, held) => { const b = F.BUILDS[build]; return B.jawaSkeleton(b, F.pose("rest", b, held)); };

test("the Jawa's skeleton is the human base's: the same 38 bones, names and parents", async () => {
  const { B, F } = await load(), human = JSON.parse(readFileSync(join(GG, "human-base", "data", "mesh.json"), "utf8")).skeleton;
  for (const build of Object.keys(F.BUILDS)) for (const held of [false, true]) {
    const sk = skeletonOf(B, F, build, held);
    assert.equal(sk.length, human.length);
    sk.forEach((b, i) => { assert.equal(b.name, human[i].name); assert.equal(b.parent, human[i].parent, b.name); assert.ok(b.head.every(Number.isFinite), b.name); });
  }
});

test("a Jawa's size: about a metre tall, short legs, feet on the ground, left and right mirrored", async () => {
  const { B, F, M } = await load();
  for (const build of Object.keys(F.BUILDS)) {
    const sk = skeletonOf(B, F, build, false), H = (n) => sk.find((b) => b.name === n).head, rig = M.makeRig(sk);
    assert.ok(H("head")[1] > 0.6 && H("head")[1] < 0.9, `${build}: the head bone at ${H("head")[1]} m`);
    assert.ok(rig.leg > 0.3 && rig.leg < 0.5, `${build}: a leg of ${rig.leg} m`);
    assert.ok(H("toe3-1.L")[1] >= 0 && H("toe3-1.L")[1] < 0.05 && H("foot.L")[1] < 0.1, `${build}: feet on the ground`);
    for (const n of ["upperleg01", "lowerleg01", "foot", "clavicle", "shoulder01"]) { const l = H(n + ".L"), r = H(n + ".R"); assert.ok(Math.abs(l[0] + r[0]) < 1e-6 && Math.abs(l[1] - r[1]) < 1e-6, `${build}: ${n} mirrored`); }
    assert.ok(rig.speed > 1 && rig.speed < 2, `${build}: runs at ${rig.speed} m/s (a human runs at 2.6)`);
  }
});

test("the run and the clips move a Jawa: planted feet hold, knees bend forward, nothing goes through the floor", async () => {
  const { B, F, M, C } = await load(), rig = M.makeRig(skeletonOf(B, F, "average", true)), T = rig.cycle.T;
  let prev = null, slip = 0, back = 0;
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * T, p = M.run(rig, t), W = p.world(), now = {};
    for (const s of ["L", "R"]) {
      const S = rig.side[s], u = s === "L" ? p.phase : (p.phase + 0.5) % 1, ball = W.P[S.toe], hip = W.P[S.thigh], knee = W.P[S.shin], ank = W.P[S.foot];
      const f = (knee[1] - hip[1]) / (ank[1] - hip[1]), zl = hip[2] + (ank[2] - hip[2]) * f; if (knee[2] < zl - 0.005) back++;
      now[s] = ball; if (prev && u > 0.01 && u < rig.cycle.duty - 0.01) slip = Math.max(slip, Math.abs((ball[2] - prev[s][2]) / (T / 120) + rig.speed));
    }
    prev = now;
  }
  assert.ok(slip < 0.01, `a planted foot slides ${slip} m/s`); assert.equal(back, 0, "a knee bends backward");
  const J = JSON.parse(readFileSync(join(GG, "human-base", "data", "clips.json"), "utf8"));
  for (const n of ["pistol-idle", "pistol-shoot", "rifle-fire", "hit-chest", "down", "get-up", "walk"]) {
    const c = J.clips[n], p = C.play(C.unpackClip(c), rig, { root: c.root });
    for (let i = 0; i <= 20; i++) { const W = p.sample((i / 20) * p.duration).world(); for (const P of W.P) assert.ok(P.every(Number.isFinite) && P[1] > -0.06, `${n}: a bone at ${P[1]} m`); }
  }
});
