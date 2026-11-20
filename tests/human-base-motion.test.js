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
    for (const s of ["L", "R"]) { const S = rig.side[s]; moved = Math.max(moved, Math.hypot(...W.P[S.foot].map((v, k) => v - S.stance[k]))); }
    chest.push(W.P[rig.at.neck01][1]);
  }
  assert.ok(moved < 0.002, `a standing foot moves ${moved} m`);
  assert.ok(Math.max(...chest) - Math.min(...chest) > 0.001, "the chest moves with the breath");
});

// Seen from the front, a natural run keeps each leg in one plane: hip, knee and ankle in a line, the feet landing on two
// lines close under the body (narrower than the hips, not wider), toes and knees pointing the way it goes. The knee is
// measured off the hip-to-ankle line, sideways to the way the foot points (for a foot pointing ahead: from the front).
function kneeOff(S, W) {
  const hip = W.P[S.thigh], knee = W.P[S.shin], ank = W.P[S.foot], ball = W.P[S.toe];
  let f = [ball[0] - ank[0], 0, ball[2] - ank[2]]; const fl = Math.hypot(...f) || 1; f = f.map((x) => x / fl);
  const side = [f[2], 0, -f[0]], at = (p) => [p[0] * side[0] + p[2] * side[2], p[1]];   // the leg seen along the foot
  const h = at(hip), k = at(knee), a = at(ank), d = [a[0] - h[0], a[1] - h[1]], t = ((k[0] - h[0]) * d[0] + (k[1] - h[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
  return Math.abs(k[0] - (h[0] + d[0] * t));
}
test("the run and the stand, from the front: knees over the feet, the feet under the body, pointing ahead", async () => {
  const { M, rig } = await rigOf(), T = rig.cycle.T, mid = rig.bones[rig.at.root].head[0];
  let off = 0, wide = -Infinity, turn = 0;
  for (let i = 0; i < 120; i++) {
    const p = M.run(rig, (i / 120) * T), W = p.world();
    for (const s of ["L", "R"]) {
      const S = rig.side[s], hip = W.P[S.thigh], ank = W.P[S.foot], ball = W.P[S.toe];
      off = Math.max(off, kneeOff(S, W));
      if (ball[1] < S.ball[1] + 0.005) { wide = Math.max(wide, (ank[0] - mid) * S.s - (hip[0] - mid) * S.s); turn = Math.max(turn, Math.abs(Math.atan2(ball[0] - ank[0], ball[2] - ank[2]))); }
    }
  }
  assert.ok(off < 0.01, `a running knee is ${(off * 100).toFixed(1)} cm off the line from hip to ankle`);
  assert.ok(wide < -0.03, `a planted foot lands only ${(-wide * 100).toFixed(1)} cm inside its hip`);
  assert.ok(turn < 2 * Math.PI / 180, `a planted foot points ${(turn * 180 / Math.PI).toFixed(1)}° off the way it runs`);
  for (let i = 0; i < 20; i++) {
    const W = M.stand(rig, i * 0.5).world();
    for (const s of ["L", "R"]) {
      const S = rig.side[s], out = (W.P[S.foot][0] - mid) * S.s - (W.P[S.thigh][0] - mid) * S.s;
      assert.ok(kneeOff(S, W) < 0.01, "a standing knee points over its foot");
      assert.ok(out > -0.01 && out < 0.03, `a standing foot is ${(out * 100).toFixed(1)} cm outside its hip`);
    }
  }
});
