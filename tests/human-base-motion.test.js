// The human base's run and stand (sections/guitar-goblin/human-base/motion.js), on the skeleton in the data (its rest
// shape, feet on the ground): what a person would see at once if it were wrong.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const HB = join(__dirname, "..", "sections", "guitar-goblin", "human-base");

async function rigOf() {
  const D = await import(join(HB, "derive.js")), M = await import(join(HB, "motion.js"));
  const ab = (f) => { const b = readFileSync(join(HB, "data", f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const B = D.decode(JSON.parse(readFileSync(join(HB, "data", "mesh.json"), "utf8")), ab("mesh.bin"), ab("targets.bin"), ab("skin.bin"), ab("bones.bin"));
  let lo = Infinity; for (let i = 0; i < B.N; i++) if (B.inBody[i]) lo = Math.min(lo, B.rest[i * 3 + 1]);
  const sk = B.skeleton.bones.map((b) => { const c = [0, 0, 0]; for (const i of b.head) for (let k = 0; k < 3; k++) c[k] += B.rest[i * 3 + k] / b.head.length; c[1] -= lo; return { name: b.name, parent: b.parent, head: c.map((x) => x * 0.1) }; });
  return { M, rig: M.makeRig(sk) };
}

test("the run: a planted foot stays on the ground and moves with it, the knees bend only forward", async () => {
  const { M, rig } = await rigOf(), T = rig.cycle.T, N = 240, duty = rig.cycle.duty;
  assert.ok(rig.speed > 2 && rig.speed < 4, `a jog: ${rig.speed} m/s`);
  let prev = null, slip = 0, lift = 0, back = 0, n = 0;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * T, p = M.run(rig, t), W = p.world(), now = {};
    for (const s of ["L", "R"]) {
      const S = rig.side[s], u = s === "L" ? p.phase : (p.phase + 0.5) % 1, ball = W.P[S.toe], hip = W.P[S.thigh], knee = W.P[S.shin], ank = W.P[S.foot];
      const f = (knee[1] - hip[1]) / (ank[1] - hip[1]), zl = hip[2] + (ank[2] - hip[2]) * f;
      if (knee[2] < zl - 0.005) back++;
      now[s] = ball;
      if (u > 0.01 && u < duty - 0.01) {
        n++; lift = Math.max(lift, Math.abs(ball[1] - S.ball[1]));
        if (prev) slip = Math.max(slip, Math.abs((ball[2] - prev[s][2]) / (T / N) + rig.speed));
      }
    }
    prev = now;
  }
  assert.ok(n > 100);
  assert.ok(lift < 0.001, `a planted foot leaves the ground by ${lift} m`);
  assert.ok(slip < 0.01, `a planted foot slides by ${slip} m/s`);
  assert.equal(back, 0, "a knee bends backward");
});

test("the run: the hips rise and fall twice a cycle, the arms swing against the legs, the head stays level", async () => {
  const { M, rig } = await rigOf(), T = rig.cycle.T, ys = [], ang = [];
  for (let i = 0; i < 64; i++) {
    const p = M.run(rig, (i / 64) * T), W = p.world(); ys.push(p.root[1]);
    const L = rig.side.L, R = rig.side.R, z = (k) => W.P[k][2];
    ang.push([z(L.wrist) - z(L.arm), z(R.foot) - W.P[R.thigh][2]]);
    const up = W.R[rig.at.head], y = [2 * (up[0] * up[1] + up[3] * up[2]), 1 - 2 * (up[0] * up[0] + up[2] * up[2]), 2 * (up[1] * up[2] - up[3] * up[0])];
    assert.ok(y[1] > 0.995, "the head stays upright");
  }
  const range = Math.max(...ys) - Math.min(...ys);
  assert.ok(range > 0.03 && range < 0.09, `the hips rise and fall ${range} m`);
  let ups = 0; for (let i = 0; i < 64; i++) if (ys[i] > ys[(i + 63) % 64] && ys[i] >= ys[(i + 1) % 64]) ups++;
  assert.equal(ups, 2, "two high points a cycle (one each flight)");
  // the left arm forward when the right foot is forward
  const ma = ang.reduce((t, x) => t + x[0], 0) / 64, ml = ang.reduce((t, x) => t + x[1], 0) / 64;
  let r = 0; for (const [a, l] of ang) r += (a - ma) * (l - ml); assert.ok(r > 0, "the left arm swings with the right leg");
});

test("the stand: the feet stay where they are, and it breathes", async () => {
  const { M, rig } = await rigOf();
  let moved = 0; const chest = [];
  for (let i = 0; i < 40; i++) {
    const p = M.stand(rig, i * 0.25), W = p.world();
    for (const s of ["L", "R"]) { const S = rig.side[s]; moved = Math.max(moved, Math.hypot(...W.P[S.foot].map((v, k) => v - S.ankle[k]))); }
    chest.push(W.P[rig.at.neck01][1]);
  }
  assert.ok(moved < 0.002, `a standing foot moves ${moved} m`);
  assert.ok(Math.max(...chest) - Math.min(...chest) > 0.001, "the chest moves with the breath");
});
