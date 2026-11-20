// Human base: a figure that moves. A run and a stand, written as joint turns over a cycle (our own code; no motion
// data), for the skeleton a table bake carries (table.js: list.skeleton, bound in the arms-down pose with every bone's
// own turn the identity). No three.js here: a pose is plain numbers, so it can be worked out anywhere.
//
//   const rig = makeRig(list.skeleton);
//   const p = run(rig, t);          // t in seconds; or stand(rig, t)
//   p.root: [x, y, z]               the hips' offset from where they are bound (metres)
//   p.q:    Float32Array(n * 4)     each bone's own turn (x, y, z, w), in its parent's frame, in skeleton order
//   rig.speed                       the ground speed the run is made for (m/s): move the figure at that speed and its
//                                   planted foot stays where it was put
//
// The run: the hips rise and fall (lowest with a foot under them, highest in flight) and turn a little with the legs; the
// trunk leans forward and turns against the hips; each foot is planted, carried back at the ground's speed, rolled off
// the ball of the foot and swung through high behind and forward to land again, the legs set by their own two-bone
// reach to where the foot must be, so the knees bend only forward; the arms swing against the legs with the elbows
// bent; the head is kept level and looking ahead. The stand: weight on both feet, a slow breath, a slower sway.

/* ---------------- quaternions, as [x, y, z, w] ---------------- */
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (a) => [-a[0], -a[1], -a[2], a[3]];
const qaxis = (ax, ang) => { const l = Math.hypot(ax[0], ax[1], ax[2]) || 1, s = Math.sin(ang / 2) / l; return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; };
const qrot = (q, v) => { const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };
const qfrom = (u, v) => {   // the least turn taking direction u to direction v
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  if (d < -0.999999) { const a = Math.abs(u[0]) < 0.9 ? cross([1, 0, 0], u) : cross([0, 1, 0], u); return qaxis(a, Math.PI); }
  const c = cross(u, v), q = [c[0], c[1], c[2], 1 + d], l = Math.hypot(...q); return q.map((x) => x / l);
};
const I = [0, 0, 0, 1];
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]), norm = (a) => mul(a, 1 / (len(a) || 1)), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x), lerp = (a, b, t) => a + (b - a) * t, smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const D = Math.PI / 180;

/* ---------------- the rig: the skeleton's shape, measured once ---------------- */
// how far a moving figure's fingers curl (the base's arms-down pose takes it as state.curl): loose half-closed fists.
// Set it before baking a figure that will run: fig.set({ curl: FIST }).update()
export const FIST = 1.9;
export function makeRig(skeleton) {
  const bones = skeleton.map((b) => ({ name: b.name, parent: b.parent, head: b.head.slice() })), at = Object.fromEntries(bones.map((b, k) => [b.name, k]));
  const H = (n) => bones[at[n]].head, need = (n) => { if (!(n in at)) throw new Error('motion: the skeleton has no ' + n); return at[n]; };
  ['root', 'spine05', 'spine01', 'neck01', 'head'].forEach(need);
  const side = {};
  for (const s of ['L', 'R']) {
    const hip = H('upperleg01.' + s), knee = H('lowerleg01.' + s), ankle = H('foot.' + s), ball = H('toe3-1.' + s);
    const sh = H('upperarm01.' + s), el = H('lowerarm01.' + s), wr = H('wrist.' + s);
    const up = norm(sub(el, sh)), fo = norm(sub(wr, el));
    // the elbow's hinge: square to the upper arm and to straight ahead (the arm hangs nearly straight, so the bend it
    // is bound with says little about its plane); its sense is the one that brings the forearm forward and up
    let hinge = norm(cross(up, Z));
    if (qrot(qaxis(hinge, 0.3), fo)[2] < fo[2]) hinge = mul(hinge, -1);
    side[s] = { s: Math.sign(hip[0]) || (s === 'L' ? 1 : -1), hip, knee, ankle, ball, L1: len(sub(knee, hip)), L2: len(sub(ankle, knee)), heelToBall: sub(ankle, ball), hinge,
      thigh: need('upperleg01.' + s), shin: need('lowerleg01.' + s), foot: need('foot.' + s), toe: need('toe3-1.' + s), pelvis: need('pelvis.' + s),
      clav: need('clavicle.' + s), arm: need('upperarm01.' + s), fore: need('lowerarm01.' + s), wrist: need('wrist.' + s) };
  }
  const leg = (side.L.L1 + side.L.L2 + side.R.L1 + side.R.L2) / 2 + (side.L.ankle[1] + side.R.ankle[1]) / 2;   // hip joint to the ground
  const k = leg / 0.86;   // the run is made for a leg of 0.86 m and scaled to this one (the period by its root)
  const rig = { bones, at, side, leg, n: bones.length };
  rig.cycle = { T: 0.7 * Math.sqrt(k), duty: 0.34, k };
  rig.speed = 2.6 * k;   // the stride grows with the leg, the cadence with its root
  return rig;
}

/* ---------------- forward: where each bone is, from the turns ---------------- */
function world(rig, root, q) {
  const n = rig.n, R = new Array(n), P = new Array(n);
  for (let b = 0; b < n; b++) {
    const B = rig.bones[b], l = q.slice(b * 4, b * 4 + 4);
    if (B.parent < 0) { R[b] = l; P[b] = add(B.head, root); continue; }
    const pr = R[B.parent]; R[b] = qmul(pr, l); P[b] = add(P[B.parent], qrot(pr, sub(B.head, rig.bones[B.parent].head)));
  }
  return { R, P };
}
// set bone b's own turn so that its turn in the world is w (its parent's already set in q)
function setWorld(rig, q, b, w) {
  const p = rig.bones[b].parent, pw = p < 0 ? I : world(rig, [0, 0, 0], q).R[p];
  const l = qmul(qinv(pw), w); q.set(l, b * 4);
}
const put = (q, b, r) => q.set(r, b * 4);

/* ---------------- a leg reaching for its ankle ---------------- */
// hip: the hip joint in the world; A: where the ankle must be; pole: which way the knee points. Returns the thigh's and
// the shin's turns in the world (the least turns from how they are bound).
function reach(S, hip, A, pole) {
  const t0 = norm(sub(S.knee, S.hip)), s0 = norm(sub(S.ankle, S.knee));
  let d = sub(A, hip), dl = len(d); const u = norm(d);
  dl = clamp(dl, Math.abs(S.L1 - S.L2) + 1e-4, S.L1 + S.L2 - 1e-4);
  const ca = clamp((S.L1 * S.L1 + dl * dl - S.L2 * S.L2) / (2 * S.L1 * dl), -1, 1), sa = Math.sqrt(1 - ca * ca);
  const w = norm(sub(pole, mul(u, dot(pole, u))));
  const t = norm(add(mul(u, ca), mul(w, sa))), K = add(hip, mul(t, S.L1)), s = norm(sub(add(hip, mul(u, dl)), K));
  const Qt = qfrom(t0, t), Qs = qmul(qfrom(qrot(Qt, s0), s), Qt);
  return { Qt, Qs, reached: len(sub(A, hip)) <= S.L1 + S.L2 - 1e-4 };
}

/* ---------------- the run ---------------- */
// one foot's place over the cycle, for phase u (0: it lands; duty: it leaves the ground), in the hips' frame without
// their rise: the ball of the foot on the ground carried back at the ground's speed, the heel rolling up off it, then
// the swing through, high behind and forward to land
function footAt(rig, S, u) {
  const { T, duty, k } = rig.cycle, v = rig.speed, stride = v * T * duty;   // how far the ground moves under a planted foot
  const land = 0.44 * stride + 0.03 * k, off = land - stride;   // where the ball of the foot lands and leaves, ahead of the hip
  const ballY = S.ball[1], heel = S.heelToBall, x = S.ball[0];
  if (u < duty) {
    const f = u / duty, z = lerp(land, off, f);
    const roll = 48 * D * Math.pow(smooth((f - 0.4) / 0.6), 1.3);   // the heel comes up off the ball over the last part
    const ball = [x, ballY, S.hip[2] + z], pitch = qaxis(X, roll);
    return { ball, ankle: add(ball, qrot(pitch, heel)), pitch, toe: qinv(pitch), planted: true };
  }
  const s = (u - duty) / (1 - duty), e = smooth(s);
  // the ankle's path through the air: from where it left to where it lands, kicked up and back first
  const p0 = footAt(rig, S, duty - 1e-6), z0 = p0.ankle[2], y0 = p0.ankle[1];
  const zl = S.hip[2] + land + heel[2], yl = ballY + heel[1];
  const z = lerp(z0, zl, smooth(Math.pow(s, 1.25))) - 0.09 * k * Math.sin(Math.PI * Math.min(1, s / 0.75)) * (1 - s);
  const y = lerp(y0, yl, e) + 0.38 * k * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.7)), 1.2);
  const toes = s < 0.35 ? lerp(48, 50, s / 0.35) : s < 0.85 ? lerp(50, -8, smooth((s - 0.35) / 0.5)) : lerp(-8, 0, (s - 0.85) / 0.15);
  const pitch = qaxis(X, toes * D);
  return { ankle: [x, y, z], pitch, toe: qaxis(X, -0.4 * Math.max(0, toes) * D * (1 - s)), planted: false };
}

export function run(rig, t, o = {}) {
  const { T, duty, k } = rig.cycle, n = rig.n, q = new Float32Array(n * 4);
  for (let b = 0; b < n; b++) q[b * 4 + 3] = 1;
  const ph = (((t / T) % 1) + 1) % 1;   // 0: the left foot lands; 0.5: the right
  const uL = ph, uR = (ph + 0.5) % 1;
  // the hips: lowest with a foot under them (mid-stance), highest in flight; a little toward the planted foot
  const mid = duty / 2, rise = -0.044 * k - 0.028 * k * Math.cos(4 * Math.PI * (ph - mid));
  const sway = 0.008 * k * Math.cos(2 * Math.PI * (ph - mid)) * rig.side.L.s;
  const root = [sway, rise, 0];
  // the hips turn with the leg that swings forward, and roll a little down on the side of the swinging leg
  const yaw = 7 * D * Math.cos(2 * Math.PI * ph) * -rig.side.L.s, roll = 3 * D * Math.sin(2 * Math.PI * (ph - mid)) * rig.side.L.s;
  const qRoot = qmul(qaxis(Y, yaw), qaxis(Z, roll));
  put(q, rig.at.root, qRoot);
  // the trunk: leaning forward from the hips, and turning back against them so the shoulders go with the arms
  const lean = (o.lean ?? 11) * D;
  put(q, rig.at.spine05, qmul(qaxis(X, lean * 0.6), qaxis(Y, -yaw * 0.5)));
  put(q, rig.at.spine04, qaxis(Y, -yaw * 0.4));
  put(q, rig.at.spine03, qmul(qaxis(X, lean * 0.4), qaxis(Y, -yaw * 0.5)));
  put(q, rig.at.spine02, qmul(qaxis(Y, -yaw * 0.6), qaxis(Z, -roll * 0.8)));
  // the legs: each reaching for where its foot must be
  const W0 = world(rig, root, q);
  for (const [s, u] of [['L', uL], ['R', uR]]) {
    const S = rig.side[s], f = footAt(rig, S, u);
    const hip = W0.P[S.thigh], A = add(f.ankle, [0, 0, 0]);
    const pole = norm(qrot(qRoot, [0.12 * S.s, 0, 1]));   // the knee points forward, a touch out
    const r = reach(S, hip, A, pole);
    setWorld(rig, q, S.thigh, r.Qt);
    setWorld(rig, q, S.shin, r.Qs);
    setWorld(rig, q, S.foot, f.pitch);
    put(q, S.toe, f.toe);
  }
  // the arms: against the legs (the left arm forward as the right leg is), elbows bent, swung a little across
  for (const s of ['L', 'R']) {
    const S = rig.side[s], u = s === 'L' ? uL : uR, fwd = -Math.cos(2 * Math.PI * u);   // 1: this arm fully forward
    // the upper arm drives back as far as it comes forward (the elbow passes behind the trunk and the hand passes the
    // hip), the elbow a little more open behind than in front
    const swing = (-8 + 36 * fwd) * D, across = (2 + 3 * Math.max(0, fwd)) * D * S.s;
    put(q, S.arm, qmul(qaxis(Z, -across * 0.5), qaxis(X, -swing)));
    put(q, S.fore, qaxis(S.hinge, (84 + 12 * fwd) * D));
    put(q, S.clav, qaxis(X, -swing * 0.12));
  }
  // the head: level and looking ahead whatever the trunk does
  setWorld(rig, q, rig.at.head, qaxis(X, 2 * D));
  return { root, q, phase: ph, world: () => world(rig, root, q) };
}

/* ---------------- the stand ---------------- */
export function stand(rig, t) {
  const n = rig.n, q = new Float32Array(n * 4);
  for (let b = 0; b < n; b++) q[b * 4 + 3] = 1;
  const br = Math.sin((2 * Math.PI * t) / 4.2), sw = Math.sin((2 * Math.PI * t) / 9.5);
  const root = [0.004 * sw, -0.004 + 0.0015 * br, 0];
  put(q, rig.at.root, qaxis(Z, 0.6 * D * sw));
  put(q, rig.at.spine02, qaxis(X, -1.2 * D * br));
  put(q, rig.at.spine01, qaxis(X, -0.8 * D * br));
  for (const s of ['L', 'R']) {
    const S = rig.side[s];
    put(q, S.clav, qaxis(Z, 0.8 * D * br * S.s));
    put(q, S.arm, qaxis(X, -2 * D));
    put(q, S.fore, qaxis(S.hinge, 6 * D));
  }
  // the feet stay where they stand: each leg reaches for its own ankle as bound
  const W0 = world(rig, root, q);
  for (const s of ['L', 'R']) {
    const S = rig.side[s], r = reach(S, W0.P[S.thigh], S.ankle, norm([0.1 * S.s, 0, 1]));
    setWorld(rig, q, S.thigh, r.Qt); setWorld(rig, q, S.shin, r.Qs); setWorld(rig, q, S.foot, I);
  }
  setWorld(rig, q, rig.at.head, I);
  return { root, q, world: () => world(rig, root, q) };
}

// from one pose toward another (k from 0 to 1), for starting and stopping
export function blend(a, b, k) {
  const q = new Float32Array(a.q.length);
  for (let i = 0; i < q.length; i += 4) {
    let d = a.q[i] * b.q[i] + a.q[i + 1] * b.q[i + 1] + a.q[i + 2] * b.q[i + 2] + a.q[i + 3] * b.q[i + 3], s = d < 0 ? -1 : 1;
    const v = [0, 1, 2, 3].map((j) => lerp(a.q[i + j], s * b.q[i + j], k)), l = Math.hypot(...v);
    q.set(v.map((x) => x / l), i);
  }
  return { root: [0, 1, 2].map((j) => lerp(a.root[j], b.root[j], k)), q };
}
export { world as poseWorld };
