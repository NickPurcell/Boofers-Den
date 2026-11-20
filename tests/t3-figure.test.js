// The T3-type droid as a table figure: its skeleton (droid-creator/t3-bake.js t3Skeleton, where the page stands the
// unit) and its own motion (droid-creator/t3-motion.js): a walk whose planted front foot holds and never sinks, pods that
// roll at the ground's rate, a level head that turns to aim, a stand and a fall. The bake itself needs the page.
const test = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const GG = join(__dirname, "..", "sections", "guitar-goblin");
const three = pathToFileURL(join(GG, "vendor", "three", "three.module.min.js")).href;
require("node:module").register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, next) { return s === 'three' ? { url: ${JSON.stringify(three)}, shortCircuit: true } : next(s, c); }`));
async function load() {
  const B = await import(join(GG, "droid-creator", "t3-bake.js")), M = await import(join(GG, "droid-creator", "t3-motion.js"));
  const sk = B.t3Skeleton(); return { B, M, sk, rig: M.makeT3Rig(sk) };
}
const upOf = (q) => [2 * (q[0] * q[1] - q[3] * q[2]), 1 - 2 * (q[0] * q[0] + q[2] * q[2]), 2 * (q[1] * q[2] + q[3] * q[0])];
const fwdOf = (q) => [2 * (q[0] * q[2] + q[3] * q[1]), 2 * (q[1] * q[2] - q[3] * q[0]), 1 - 2 * (q[0] * q[0] + q[1] * q[1])];

test("the T3's skeleton: ten bones, the feet on the ground, the legs and hubs mirrored", async () => {
  const { M, sk, rig } = await load(), H = (n) => sk.find((b) => b.name === n).head;
  assert.deepEqual(sk.map((b) => b.name), M.T3_BONES);
  assert.deepEqual(sk.map((b) => b.parent), [-1, 0, 1, 1, 0, 4, 4, 5, 6, 4]);
  for (const b of sk) assert.ok(b.head.every(Number.isFinite), b.name);
  assert.ok(H("foot.L")[1] > 0.1 && H("foot.L")[1] < 0.25, "the ankles stand at the unit's ankle height");
  for (const n of ["leg", "foot", "hub"]) { const l = H(n + ".L"), r = H(n + ".R"); assert.ok(l[0] > 0 && Math.abs(l[0] + r[0]) < 1e-6 && Math.abs(l[1] - r[1]) < 1e-6 && Math.abs(l[2] - r[2]) < 1e-6, n); }
  assert.ok(H("head")[1] > 0.55 && H("head")[1] < 0.9, `the head at ${H("head")[1]} m`);
  assert.ok(rig.speed > 0.4 && rig.speed < 1.5, `walks at ${rig.speed} m/s`);
  // the bind pose is the stand with the head ahead
  const W = M.standT3(rig, 0).world(); for (const s of ["L", "R"]) assert.ok(Math.abs(W.P[rig.at["foot." + s]][1] - H("foot." + s)[1]) < 1e-6);
});

test("the walk: a planted front foot holds on the ground, no foot sinks, the pods roll, the head stays level", async () => {
  const { M, rig } = await load(), { T, duty } = rig.walk, N = 400, ground = rig.g.ankleY;
  let slip = 0, lift = 0, sink = 0, maxUp = 0, tilt = 0, prev = null, down = 0;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * 2 * T, p = M.walkT3(rig, t), W = p.world(), now = {};
    for (const s of ["L", "R"]) {
      const u = s === "L" ? p.phase : (p.phase + 0.5) % 1, f = W.P[rig.at["foot." + s]];
      sink = Math.max(sink, ground - f[1]); maxUp = Math.max(maxUp, f[1] - ground); now[s] = f;
      if (u > 0.01 && u < duty - 0.01) { down++; lift = Math.max(lift, Math.abs(f[1] - ground)); if (prev) slip = Math.max(slip, Math.abs((f[2] - prev[s][2]) / ((2 * T) / N) + rig.speed)); }
    }
    const up = upOf(W.R[rig.at.head]); tilt = Math.max(tilt, Math.acos(Math.min(1, up[1])) / (Math.PI / 180));
    prev = now;
  }
  assert.ok(down > 100);
  assert.ok(lift < 1e-6, `a planted foot leaves the ground by ${lift} m`);
  assert.ok(slip < 0.005, `a planted foot slides by ${slip} m/s`);
  assert.ok(sink < 1e-6, `a foot goes ${sink} m into the ground`);
  assert.ok(maxUp > 0.01 && maxUp < 0.12, `a swinging foot lifts ${maxUp} m`);
  assert.ok(tilt < 8, `the head tips ${tilt.toFixed(1)}° as the body rocks`);
  // the hubs turn so a wheel of their rate rolls at the ground's speed
  const a = M.walkT3(rig, 0.1).q, b = M.walkT3(rig, 0.2).q, k = rig.at["hub.L"] * 4, ang = (q) => 2 * Math.atan2(q[k], q[k + 3]);
  const rate = (((ang(b) - ang(a)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / 0.1;
  assert.ok(Math.abs(rate * rig.g.wheel - rig.speed) < 0.02, `the hubs turn at ${rate} rad/s`);
});

test("aiming turns the head to the target; the stand stays put; a fall settles low, all finite", async () => {
  const { M, rig } = await load();
  for (const yaw of [0.6, -1.2, 2.0]) {
    const p = M.aimT3(rig, M.walkT3(rig, 0.37), yaw), f = fwdOf(p.world().R[rig.at.head]);
    assert.ok(Math.abs(Math.atan2(f[0], f[2]) - yaw) < 0.02, `aimed ${yaw}, looks ${Math.atan2(f[0], f[2])}`);
  }
  for (let i = 0; i < 20; i++) { const W = M.standT3(rig, i * 0.4).world(); for (const s of ["L", "R"]) assert.ok(Math.abs(W.P[rig.at["foot." + s]][1] - rig.g.ankleY) < 1e-6); }
  const lo = M.downT3(rig, 2).world(), st = M.standT3(rig, 0).world();
  assert.ok(lo.P[rig.at.head][1] < st.P[rig.at.head][1] - 0.05, "the head comes down");
  for (const P of lo.P) assert.ok(P.every(Number.isFinite) && P[1] > -0.01);
});
