// The T3-type utility droid as a figure that moves (t3.js is its body; t3-bake.js bakes it for a game table). Our own
// code; no motion data. No three.js here: a pose is plain numbers, as in ../human-base/motion.js, whose quaternion
// helpers and forward pass it shares.
//
//   const rig = makeT3Rig(figure.skeleton);   // bones: root, rear, hub.L, hub.R, body, leg.L, leg.R, foot.L, foot.R, head
//   const p = walkT3(rig, t);                 // or standT3(rig, t), downT3(rig, t); then aimT3(rig, p, yaw) to turn the head
//   p.root: [x, y, z]  p.q: Float32Array(n * 4) (each bone's own turn, in its parent's frame)   p.world(): where each bone is
//   rig.speed                                 the ground speed the walk is made for (m/s): phase it by distance travelled
//                                             (t = metres / rig.speed) and the feet hold whatever the speed on the map
//
// How it walks. The unit is a slab of a body pivoting on a rear axle whose two pods roll on wheels, with two straight
// legs (no knee) swung at the shoulders onto forked feet. A straight leg cannot shorten, so a front foot on the ground
// fixes how high the shoulders are: as the body passes over a planted foot the leg comes upright and the body tips up
// about the axle; then that foot lifts, the body settles forward onto the pods for a moment, and the other foot, swung
// forward meanwhile, lands as it comes down. So it rocks as it goes, as such units do. The pods roll (their hubs turn
// at the wheels' rate); the planted front foot does not move on the ground. The head stays level on its ball joint and
// turns on its own to look where it goes or what it shoots.
import { Q, poseWorld } from '../human-base/motion.js';

const { sin, cos, acos, atan2, hypot, max, min, PI } = Math;
const D = PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x), smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const X = [1, 0, 0], Y = [0, 1, 0];
export const T3_BONES = ['root', 'rear', 'hub.L', 'hub.R', 'body', 'leg.L', 'leg.R', 'foot.L', 'foot.R', 'head'];
// the wheels under a pod, as a share of the axle's height (t3.js: wheels of w(0.13) under an axle at w(0.40))
const WHEEL = 0.325;

/* ---------------- the rig: the unit's shape, measured once from its bones ---------------- */
export function makeT3Rig(skeleton) {
  const bones = skeleton.map((b) => ({ name: b.name, parent: b.parent, head: b.head.slice() })), at = Object.fromEntries(bones.map((b, k) => [b.name, k]));
  for (const n of T3_BONES) if (!(n in at)) throw new Error('t3-motion: the skeleton has no ' + n);
  const H = (n) => bones[at[n]].head, axle = H('body'), sh = H('leg.L'), an = H('foot.L');
  const g = {
    axleY: axle[1], za: axle[2], ankleY: an[1],
    S: hypot(sh[1] - axle[1], sh[2] - axle[2]), lean0: atan2(sh[2] - axle[2], sh[1] - axle[1]),
    L: hypot(sh[1] - an[1], an[2] - sh[2]), rake0: atan2(an[2] - sh[2], sh[1] - an[1]),
  };
  g.wheel = WHEEL * g.axleY;
  const k = g.S / 0.563;   // made for the unit as t3.js builds it, scaled to this one
  // the walk: each front foot down for `duty` of the cycle, its leg sweeping from `dr` past the standing rake to `dr`
  // short of it; between the two times down, a moment on the pods alone
  const dr = 4.5 * D, duty = 0.32, T = 0.62 * Math.sqrt(k);
  const rig = { bones, at, n: bones.length, g, k };
  const zMax = groundZ(g, g.rake0 + dr), zMin = groundZ(g, g.rake0 - dr);
  rig.walk = { T, duty, zMax, zMin, rMax: g.rake0 + dr, rMin: g.rake0 - dr };
  rig.speed = (zMax - zMin) / (duty * T);
  return rig;
}
// a foot on the ground with its leg at rake r: how far ahead of the axle it is (the body tipped to bring it down)
function groundZ(g, r) { const c = clamp((g.ankleY + g.L * cos(r) - g.axleY) / g.S, -1, 1), lean = acos(c); return g.S * sin(lean) + g.L * sin(r); }
// the body's lean (and the shoulder) that puts a foot `zrel` ahead of the axle on the ground: where the circle the
// shoulder can be on (about the axle) meets the one the foot allows (about the foot); the upper of the two
function leanFor(g, zrel) {
  const ax = [0, g.axleY], f = [zrel, g.ankleY], dz = f[0] - ax[0], dy = f[1] - ax[1], d = hypot(dz, dy);
  const a = (g.S * g.S - g.L * g.L + d * d) / (2 * d), h = Math.sqrt(max(0, g.S * g.S - a * a));
  const px = ax[0] + (a * dz) / d, py = ax[1] + (a * dy) / d, c1 = [px - (h * dy) / d, py + (h * dz) / d], c2 = [px + (h * dy) / d, py - (h * dz) / d];
  const s = c1[1] > c2[1] ? c1 : c2;
  return atan2(s[0], s[1] - g.axleY);
}
const shoulderOf = (g, lean) => [g.za + g.S * sin(lean), g.axleY + g.S * cos(lean)];   // [z, y]

/* ---------------- putting a pose together ---------------- */
// lean: the body's lean from upright about the axle; rake.L/R: each leg's rake forward from straight down; pitch.L/R: each
// foot's own toe-up turn; spin: the hubs' turn; head: { yaw, tilt } (its turn in the unit's frame)
function compose(rig, { lean, rake, pitch = { L: 0, R: 0 }, spin = 0, yaw = 0, tilt = 0, root = [0, 0, 0] }) {
  const { g, at, n } = rig, q = new Float32Array(n * 4);
  for (let b = 0; b < n; b++) q[b * 4 + 3] = 1;
  const put = (name, r) => q.set(r, at[name] * 4);
  const body = Q.axis(X, lean - g.lean0);
  put('body', body);
  put('hub.L', Q.axis(X, spin)); put('hub.R', Q.axis(X, spin));
  for (const s of ['L', 'R']) {
    const legW = Q.axis(X, -(rake[s] - g.rake0));                   // the leg's turn in the unit's frame
    put('leg.' + s, Q.mul(Q.inv(body), legW));
    put('foot.' + s, Q.mul(Q.inv(legW), Q.axis(X, -pitch[s])));      // the foot level, or tipped toe-up by pitch
  }
  // the head: level whatever the body does (its ball joint), but for a little of the body's tip, as the page shows it
  put('head', Q.mul(Q.inv(body), Q.mul(Q.axis(Y, yaw), Q.axis(X, tilt + (lean - g.lean0) * 0.3))));
  return { root, q, lean, rake, world: () => poseWorld(rig, root, q) };
}

/* ---------------- the walk ---------------- */
export function walkT3(rig, t) {
  const { g } = rig, { T, duty, zMax, zMin } = rig.walk, ph = (((t / T) % 1) + 1) % 1;
  const zAt = (u) => zMax - (zMax - zMin) * (u / duty);   // a planted foot, carried back at the ground's speed
  const uL = ph, uR = (ph + 0.5) % 1;
  // the body: set by whichever front foot is down; between them, settling from the one's lift to the other's landing
  let lean;
  if (uL < duty) lean = leanFor(g, zAt(uL));
  else if (uR < duty) lean = leanFor(g, zAt(uR));
  else { const u = uL < 0.5 ? uL : uR, e = smooth((u - duty) / (0.5 - duty)); lean = leanFor(g, zMin) + (leanFor(g, zMax) - leanFor(g, zMin)) * e; }
  const [shz, shy] = shoulderOf(g, lean), rake = {}, pitch = {};
  for (const [s, u] of [['L', uL], ['R', uR]]) {
    if (u < duty) { rake[s] = atan2(g.za + zAt(u) - shz, shy - g.ankleY); pitch[s] = 0; continue; }
    // in the air. A straight leg's foot is only as high as its rake allows, and as the body settles onto the other foot
    // the rake that would touch the ground grows to the landing rake: so the foot swings forward to that rake while the
    // body settles (a quick flick), is carried there, a little up, while the other foot is down, and comes down with
    // the body onto the ground where it lands. Kept above the touching rake throughout; the toes up a little.
    const f = (u - duty) / (1 - duty), fd = (0.5 - duty) / (1 - duty), { rMin, rMax } = rig.walk;
    const touch = acos(clamp((shy - g.ankleY) / g.L, -1, 1)), lift = 5 * D * sin(PI * f);
    rake[s] = max(rMin + (rMax - rMin) * smooth(f / fd), touch) + lift;
    pitch[s] = 14 * D * sin(PI * min(1, f * 1.2));
  }
  const spin = (t * rig.speed) / g.wheel;   // the pods roll: their wheels (and hubs) turn at the ground's rate
  return { ...compose(rig, { lean, rake, pitch, spin }), phase: ph };
}

/* ---------------- standing, falling, looking ---------------- */
// still: both feet down where they stand, the head looking slowly about
export function standT3(rig, t) {
  const { g } = rig, yaw = 9 * D * sin((2 * PI * t) / 7.5) + 4 * D * sin((2 * PI * t) / 3.1);
  return compose(rig, { lean: g.lean0, rake: { L: g.rake0, R: g.rake0 }, yaw, tilt: 2 * D * sin((2 * PI * t) / 5.3) });
}
// down (disabled, knocked out): over `fall` seconds the body sinks forward as low as its legs allow, the feet sliding
// out ahead (it is falling, not walking), the head dropping and turning aside; held there after
export function downT3(rig, t, fall = 0.7) {
  const { g } = rig, e = smooth(t / fall), lean = g.lean0 + 30 * D * e;
  const [shz, shy] = shoulderOf(g, lean), rake = acos(clamp((shy - g.ankleY) / g.L, -1, 1));
  return compose(rig, { lean, rake: { L: rake, R: rake }, tilt: 24 * D * e, yaw: 18 * D * e });
}
// turn the head to look `yaw` radians round from straight ahead (positive: to its left), and `pitch` up; returns the
// pose with the head turned (its ball joint turns it any way; the eye leads)
export function aimT3(rig, p, yaw = 0, pitch = 0) {
  const { g, at } = rig, lean = p.lean ?? g.lean0, body = Q.axis(X, lean - g.lean0), q = new Float32Array(p.q);
  q.set(Q.mul(Q.inv(body), Q.mul(Q.axis(Y, clamp(yaw, -2.6, 2.6)), Q.axis(X, -clamp(pitch, -0.6, 0.6)))), at.head * 4);
  return { ...p, q, world: () => poseWorld(rig, p.root, q) };
}
