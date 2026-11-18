// Jawa creator: the figure as signed distance shapes. Everything soft is here: the robe and how it hangs, the hood
// and its hollow, the hands and the wrapped feet. A shape is a function (x, y, z) -> distance in metres, negative
// inside, meshed by the shared surface-nets mesher (../duros-creator/sdf.js). Nothing here touches the DOM or three.js,
// so it runs in a worker.
//
// Units are metres, y up, the figure faces +z, its left side is +x, the floor is y = 0. A Jawa stands about a metre
// tall to the top of the hood; the hood is about a fifth of that.
import { ellipsoid, capsule, roundCone } from '../duros-creator/sdf.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const mix = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const sminv = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smaxv = (a, b, k) => -sminv(-a, -b, k);
// a shape that lives inside a sphere: well outside it (further than any blend reaches), the distance to the sphere will do
const within = (c, r, f, pad = 0.06) => (x, y, z) => { const d = Math.hypot(x - c[0], y - c[1], z - c[2]) - r; return d > pad ? d : f(x, y, z); };
const { sin, cos, atan2, hypot, exp, abs, PI, max, min, sqrt, floor } = Math;
const TAU = PI * 2;

// repeatable noise along a line, wrapping every `period` cells
export function hash1(i, seed) { let h = Math.imul(i | 0, 374761393) ^ Math.imul((seed | 0) + 101, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
export function noise1(x, period, seed) {
  const i = floor(x), f = x - i, a = hash1(((i % period) + period) % period, seed), b = hash1((((i + 1) % period) + period) % period, seed);
  return a + (b - a) * f * f * (3 - 2 * f);
}
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const V = { sub: sub3, add: add3, mul: mul3, dot: dot3, cross: cross3, norm: norm3 };

/* ---------------- builds, hoods and stances ---------------- */
// w scales widths, t heights. Stout is wider and a little shorter; slight is narrow and a little taller.
export const BUILDS = { stout: { w: 1.13, t: 0.955 }, average: { w: 1, t: 1 }, slight: { w: 0.89, t: 1.035 } };

// where the arms are, for a stance: shoulder, elbow, wrist for each side (side +1 is the figure's left)
export function pose(stance, B, held = false) {
  const { w, t } = B;
  const S = (s) => [s * 0.078 * w, 0.648 * t, -0.006];
  const rest = (s) => ({ E: [s * 0.132 * w, 0.53 * t, 0.018], W: [s * 0.13 * w, 0.432 * t, 0.085], curl: 0.45, roll: s < 0 ? 1.25 : 0.6 });
  const arms = {
    rest: { L: rest(1), R: rest(-1) },
    // the right hand holds something out in front at the hip; the left steadies it
    ready: { L: { E: [0.13 * w, 0.525 * t, 0.025], W: [0.118 * w, 0.44 * t, 0.115], curl: 0.5, roll: 0.8 }, R: { E: [-0.14 * w, 0.52 * t, 0.012], W: [-0.132 * w, 0.488 * t, 0.17], curl: 0.55, roll: 1.5708 } },
    // haggling: the left hand up and open, the right at the chest
    haggle: { L: { E: [0.14 * w, 0.535 * t, 0.06], W: [0.17 * w, 0.62 * t, 0.16], curl: 0.05, roll: 3.0 }, R: { E: [-0.12 * w, 0.515 * t, 0.035], W: [-0.078 * w, 0.505 * t, 0.16], curl: 0.5, roll: 1.5708 } },
    // both arms up: found something
    utinni: { L: { E: [0.175 * w, 0.65 * t, 0.04], W: [0.215 * w, 0.795 * t, 0.095], curl: 0.1, roll: 1.1 }, R: { E: [-0.175 * w, 0.65 * t, 0.04], W: [-0.215 * w, 0.795 * t, 0.095], curl: 0.1, roll: 1.5708 } },
  };
  const a = arms[stance] || arms.rest, out = {};
  for (const [k, s] of [['L', 1], ['R', -1]]) {
    const Sh = S(s), E = a[k].E, W = a[k].W, ax = norm3(sub3(W, E));
    // a frame at the wrist: `ax` along the forearm, `up` as near world up as it can be, `out` away from the body
    let side = cross3(ax, [0, 1, 0]); if (hypot(...side) < 0.2) side = [s, 0, 0]; side = norm3(side);
    const up = norm3(cross3(side, ax));
    out[k] = { s, S: Sh, E, W, ax, side, up, curl: held && s < 0 ? 1 : a[k].curl, roll: a[k].roll || 0, cuff: add3(W, mul3(ax, 0.004)) };
  }
  return out;
}

/* ---------------- the robe ---------------- */
// The robe is one heavy garment from the yoke to the floor, with wide sleeves that hang open at the cuff. Below the
// chest it is a cone of cloth, and cloth hanging in a cone falls into long folds that widen and deepen toward the
// hem: here that is the radius of the cone changing with the angle round the body.
const HEM_SEED = 7;
// how high the ragged hem is cut at an angle round the body (th in radians)
export function hemHeight(th, B) {
  const k = (th / TAU + 0.5) * 64;
  const rag = 0.006 + 0.012 * noise1(k, 64, HEM_SEED) + 0.006 * noise1(k * 4, 256, HEM_SEED + 1);
  const n = noise1(k * 0.5 + 3.3, 32, HEM_SEED + 2), tear = n > 0.7 ? (n - 0.7) * 0.2 * sstep(0.0, 1.0, noise1(k * 3, 192, HEM_SEED + 3) * 1.6) : 0;
  return rag + tear;
}
function folds(th, u) {
  // long tube folds; their phases drift a little with height so no fold is a ruled line
  const a = 0.26 * sin(3 * th + 2.1) + 0.42 * sin(7 * th + 1.3 + 0.9 * u) + 0.26 * sin(12 * th + 4.1 - 1.5 * u) + 0.1 * sin(19 * th + 0.7 + 2.3 * u);
  // heavy cloth hangs in rounded ridges with pinched valleys between them
  return a + 0.3 * (0.55 - abs(sin(4.5 * th + 0.4 + 0.6 * u))) + 0.22 * (0.55 - abs(sin(8 * th + 2.6 - 0.8 * u)));
}
// the cone of cloth: its radius at height y and angle th (before the squash front to back)
function skirtRadius(th, y, B, belt) {
  const { w, t } = B, yTop = 0.565 * t, u = clamp(1 - y / yTop, 0, 1);
  let R = 0.112 * w + (0.196 * w - 0.112 * w) * Math.pow(u, 1.22) - max(0, y - yTop) * 0.55;
  let amp = 0.0035 + 0.0255 * sstep(0.02, 0.95, u);
  if (belt) {   // a belt gathers the cloth: a waist, and the folds start hard below it
    const by = 0.43 * t, g = exp(-(((y - by) / 0.03) ** 2));
    R -= 0.012 * g;
    amp += 0.0065 * exp(-(((y - by + 0.045) / 0.05) ** 2)) - 0.002 * g;
  }
  // a little more cloth in front where the knees push it, a flatter back
  R += 0.008 * w * sstep(0.2, 0.8, u) * max(0, cos(th)) * (1 - 0.5 * u);
  return R + amp * folds(th, u);
}
const ZS = 0.9;   // the skirt is a little flatter front to back than it is wide

function sleeveParts(arm, B) {
  const { S, E, W, ax, s } = arm, w = B.w;
  const upper = roundCone(S, E, 0.05 * w, 0.056);
  const fore = roundCone(E, add3(W, mul3(ax, 0.012)), 0.056, 0.07);
  // the cloth hanging below the forearm: a bell sleeve hangs as a triangle, and the more level the arm the more hangs
  const level = 1 - abs(ax[1]), drop = 0.046 + 0.05 * level;
  const hang = roundCone(add3(E, [0, -0.35 * drop, 0]), add3(add3(W, mul3(ax, 0.02)), [0, -drop, 0]), 0.043, 0.06);
  // and under the upper arm, when that is raised level: the triangle of cloth between a lifted arm and the body
  const ua = norm3(sub3(E, S)), levelU = sstep(0.35, 0.95, 1 - abs(ua[1])) * sstep(-0.2, 0.3, ua[1] + 0.25), dropU = 0.075 * levelU;
  const hangU = roundCone(add3(S, [s * 0.02, -0.03 - 0.5 * dropU, 0]), add3(E, [0, -dropU - 0.3 * drop, 0]), 0.05, 0.046);
  // a frame round the forearm, for the ragged cuff and the creases at the elbow
  let u = cross3(ax, [0, 1, 0]); if (hypot(...u) < 0.2) u = [1, 0, 0]; u = norm3(u); const v = cross3(ax, u);
  const C = arm.cuff, seed = s > 0 ? 21 : 37, elbowLen = hypot(...sub3(W, E));
  const solid = (x, y, z) => {
    let d = sminv(sminv(upper(x, y, z), fore(x, y, z), 0.03), hang(x, y, z), 0.035);
    if (levelU > 0.05) d = sminv(d, hangU(x, y, z), 0.04);
    // creases where the elbow bends the cloth
    const h = (x - E[0]) * ax[0] + (y - E[1]) * ax[1] + (z - E[2]) * ax[2];
    return d - 0.0032 * sin(h * 74 + 2 * s) * exp(-((h / (0.55 * elbowLen)) ** 2));
  };
  // beyond the cuff there is no cloth; the cut is ragged
  const cut = (x, y, z) => {
    const qx = x - C[0], qy = y - C[1], qz = z - C[2], h = qx * ax[0] + qy * ax[1] + qz * ax[2];
    const ang = atan2(qx * v[0] + qy * v[1] + qz * v[2], qx * u[0] + qy * u[1] + qz * u[2]), k = (ang / TAU + 0.5) * 40;
    return h - 0.011 * noise1(k, 40, seed) - 0.005 * noise1(k * 3, 120, seed + 1) + 0.008;
  };
  // the hollow of the sleeve, a hand's length deep
  const hollow = (x, y, z) => {
    const h = (x - C[0]) * ax[0] + (y - C[1]) * ax[1] + (z - C[2]) * ax[2];
    return max(solid(x, y, z) + 0.0105, -h - 0.085);
  };
  const bound = [mul3(add3(S, add3(W, [0, -drop * 0.5 - dropU * 0.5, 0])), 0.5), hypot(...sub3(W, S)) / 2 + 0.11 + dropU * 0.5];
  return { solid, cut, hollow, bound };
}

// the whole robe for a build and a stance. `belt`: a belt gathers the waist.
export function robeField(B, arms, belt = false) {
  const { w, t } = B, yTop = 0.565 * t;
  const chest = ellipsoid(0, 0.565 * t, 0.004, 0.118 * w, 0.15 * t, 0.104 * w);
  const yoke = capsule([-0.058 * w, 0.655 * t, -0.006], [0.058 * w, 0.655 * t, -0.006], 0.05);
  const L = sleeveParts(arms.L, B), R = sleeveParts(arms.R, B);
  const sl = (p) => within(p.bound[0], p.bound[1], (x, y, z) => max(p.solid(x, y, z), p.cut(x, y, z)));
  const sleeveL = sl(L), sleeveR = sl(R), holL = within(L.bound[0], L.bound[1], L.hollow), holR = within(R.bound[0], R.bound[1], R.hollow);
  const body = (x, y, z) => {
    let d = sminv(chest(x, y, z), yoke(x, y, z), 0.05);
    if (y < yTop + 0.09) {
      const zz = z / ZS, r = hypot(x, zz), th = atan2(x, zz);
      d = sminv(d, (r - skirtRadius(th, y, B, belt)) * 0.7, 0.07);
      d = max(d, (hemHeight(th, B) - y) * 0.8);
    }
    return d;
  };
  const field = (x, y, z) => {
    let d = sminv(sminv(body(x, y, z), sleeveL(x, y, z), 0.034), sleeveR(x, y, z), 0.034);
    return max(d, -holL(x, y, z), -holR(x, y, z));
  };
  // 1 inside a sleeve's hollow (its lining), 0 on the outside of the cloth
  // (not quite 1: inside a sleeve the cloth is in deep shade but still the robe's own, so a dark glove shows against it)
  const lining = (x, y, z) => 0.78 * (1 - sstep(0.0015, 0.0075, min(L.hollow(x, y, z), R.hollow(x, y, z))));
  const reach = max(abs(arms.L.W[0]), abs(arms.R.W[0]), 0.2 * w) + 0.11;
  const top = max(arms.L.W[1], arms.R.W[1], 0.72 * t) + 0.1;
  return { field, lining, bounds: [[-reach, -0.01, -0.2 * w - 0.05], [reach, top, max(arms.L.W[2], arms.R.W[2], 0.2 * w) + 0.13]], body };
}

/* ---------------- the hood ---------------- */
// A hood is a deep bag of cloth stuffed to hold its shape: a rounded shell with a peak at the back, a thick rolled
// rim round the opening, and a mantle that sits on the shoulders. The hollow goes well back, so the face is in shadow.
export const HOODS = {
  //         the peak (y, z, tip radius)      the opening (half width, half height, how far forward, tilt, lift)
  round: { peak: [0.985, -0.105, 0.04], open: [0.074, 0.088, 0.096, 0.14, 0.004], crown: [0.124, 0.142, 0.132], wraps: 1, mantle: [0.64, 0.14], name: 'Rounded' },
  peaked: { peak: [1.09, -0.115, 0.016], open: [0.072, 0.09, 0.094, 0.18, 0.006], crown: [0.12, 0.142, 0.128], wraps: 1, mantle: [0.63, 0.142], name: 'Peaked' },
  cowl: { peak: [1.06, -0.06, 0.02], open: [0.068, 0.096, 0.1, 0.1, 0.008], crown: [0.118, 0.146, 0.126], wraps: 3, mantle: [0.585, 0.16], name: 'Wrapped cowl' },
  slouch: { peak: [0.93, -0.19, 0.045], open: [0.08, 0.076, 0.102, 0.3, -0.004], crown: [0.128, 0.132, 0.14], wraps: 1, mantle: [0.635, 0.142], name: 'Slouched' },
};
export const HEAD_Y = 0.8;   // the middle of the face, for an average build (times t)
export function hoodField(style, B) {
  const H = HOODS[style] || HOODS.round, { w, t } = B, hy = HEAD_Y * t;
  const [ow, oh, oz, tilt, lift] = H.open, [cx, cy, cz] = H.crown;
  const crown = ellipsoid(0, hy + 0.028, -0.014, cx, cy, cz);
  const peak = roundCone([0, hy + 0.085, -0.045], [0, H.peak[0] * t, H.peak[1]], 0.078, H.peak[2]);
  const chin = ellipsoid(0, hy - 0.07, -0.004, 0.104, 0.075, 0.104);   // the cloth bunched under the chin and round the neck
  // the rolled rim: an ellipse of thick cloth in a plane leaning forward at the brow
  const ct = cos(tilt), st = sin(tilt), oc = [0, hy + lift, oz], tube = 0.0205;
  const rim = (x, y, z) => {
    const qy0 = y - oc[1], qz0 = z - oc[2], qy = qy0 * ct - qz0 * st, qz = qy0 * st + qz0 * ct;
    const k = hypot(x / (ow + tube), qy / (oh + tube)) || 1e-6, e = (k - 1) * min(ow, oh) * 1.0;
    // a roll of cloth is never even: fatter here, pinched there, heaviest at the brow
    const ang = atan2(x, qy), fat = tube * (1 + 0.16 * sin(ang * 3 + 0.7) + 0.1 * sin(ang * 7 + 2.1) + 0.12 * cos(ang));
    return hypot(e, qz * 0.85) - fat;
  };
  const hollow = (x, y, z) => {   // the opening and the space behind it
    const qy0 = y - oc[1], qz0 = z - oc[2], qy = qy0 * ct - qz0 * st, qz = qy0 * st + qz0 * ct + 0.012;
    const px = x / (ow + 0.008), py = qy / (oh + 0.008), pz = qz / 0.078;
    const k0 = sqrt(px * px + py * py + pz * pz), k1 = sqrt((px / (ow + 0.008)) ** 2 + (py / (oh + 0.008)) ** 2 + (pz / 0.078) ** 2);
    return k1 === 0 ? -0.05 : (k0 * (k0 - 1)) / k1;
  };
  // the mantle: the hood's skirt, lying on the shoulders
  const my0 = 0.745 * t, my1 = H.mantle[0] * t;
  const mantle = (x, y, z) => {
    const u = clamp((my0 - y) / (my0 - my1), -0.3, 1.25), zz = z / 0.84, r = hypot(x, zz), th = atan2(x, zz);
    const R = 0.1 + (H.mantle[1] * w - 0.1) * Math.pow(clamp(u, 0, 1.25), 0.75) + 0.0055 * sstep(0.2, 1, u) * (0.6 * sin(7 * th + 0.6) + 0.4 * sin(12 * th + 2.2 + u));
    const k = (th / TAU + 0.5) * 48, edge = my1 + 0.012 * noise1(k, 48, 53) + 0.006 * noise1(k * 3, 144, 54) - 0.014 * max(0, cos(th));
    return max((r - R) * 0.75, (edge - y) * 0.8, (y - my0 - 0.03) * 0.8);
  };
  // cloth wrapped across under the chin, one fold over another
  const wraps = [];
  for (let i = 0; i < H.wraps; i++) {
    const yy = hy - oh - 0.012 - i * 0.021, rr = 0.019 + i * 0.002, lean = (i % 2 ? -1 : 1) * 0.012;
    wraps.push((x, y, z) => {
      const zz = (z + 0.012) / 0.9, R = 0.092 + i * 0.011;
      return hypot(hypot(x, zz) - R, y - yy - lean * (x / 0.1) - 0.012 * (1 - max(0, zz) / 0.1)) - rr;
    });
  }
  const shell = (x, y, z) => {
    let d = sminv(sminv(crown(x, y, z), peak(x, y, z), 0.07), rim(x, y, z), 0.022);
    d = sminv(sminv(d, chin(x, y, z), 0.04), mantle(x, y, z), 0.05);
    for (const f of wraps) d = sminv(d, f(x, y, z), 0.018);
    // a stuffed bag of cloth is never smooth: soft, uneven lumps all over the crown
    d -= 0.0028 * sin(x * 31 + 1.3 + y * 9) * sin(y * 27 + z * 17 + 0.6) * sstep(hy - 0.03, hy + 0.04, y);
    return d;
  };
  const field = (x, y, z) => smaxv(shell(x, y, z), -hollow(x, y, z), 0.012);
  // 1 on the lining (inside the hollow), 0 outside
  // 1 on the lining: on the wall of the hollow, which is inside the hood's outer shape (where the wall is thin, the
  // outside is near the hollow too, and must not be taken for lining)
  const lining = (x, y, z) => (1 - sstep(0.002, 0.012, hollow(x, y, z))) * sstep(-0.0015, -0.007, shell(x, y, z));
  const top = max(H.peak[0] * t, hy + cy + 0.03) + 0.05;
  return { field, shell, lining, bounds: [[-0.2 * w - 0.03, my1 - 0.05, -0.24], [0.2 * w + 0.03, top, 0.16]], open: { c: oc, w: ow, h: oh, tilt }, mantle: { y0: my0, y1: my1 } };
}
// where the face and the eyes are (the dark head inside the hood)
export function faceAt(B) {
  const hy = HEAD_Y * B.t;
  // (a flat plate, not a ball: nothing in there has a shape)
  return { c: [0, hy, 0.022], r: [0.112, 0.125, 0.012], eyeY: hy + 0.022, eyeZ: 0.037, eyeX: 0.027 };
}

/* ---------------- hands and feet ---------------- */
// A small four-fingered hand in a thick glove. `curl` 0 is open, 1 a fist round a grip.
export function handField(arm) {
  const { W, ax, side, up, s, curl, roll } = arm;
  // local frame: a along the fingers, b across the palm (toward the thumb), n out of the back of the hand. With no
  // roll the palm is down and the thumb points to the body's middle; a quarter turn brings the thumb up.
  const a = ax, b0 = mul3(side, s), cr = cos(roll), sr = sin(roll);
  const b = add3(mul3(b0, cr), mul3(up, sr)), n = sub3(mul3(up, cr), mul3(b0, sr));
  const P = (la, lb, ln) => [W[0] + a[0] * la + b[0] * lb + n[0] * ln, W[1] + a[1] * la + b[1] * lb + n[1] * ln, W[2] + a[2] * la + b[2] * lb + n[2] * ln];
  const wrist = roundCone(P(-0.03, 0, 0), P(0.02, 0, 0), 0.02, 0.022);
  const palmC = P(0.042, 0, 0), parts = [wrist];
  const palm = (x, y, z) => {
    const qx = x - palmC[0], qy = y - palmC[1], qz = z - palmC[2];
    const la = qx * a[0] + qy * a[1] + qz * a[2], lb = qx * b[0] + qy * b[1] + qz * b[2], ln = qx * n[0] + qy * n[1] + qz * n[2];
    const px = la / 0.027, py = lb / 0.026, pz = ln / 0.0135, k0 = sqrt(px * px + py * py + pz * pz), k1 = sqrt((px / 0.027) ** 2 + (py / 0.026) ** 2 + (pz / 0.0135) ** 2);
    return k1 === 0 ? -0.01 : (k0 * (k0 - 1)) / k1;
  };
  parts.push(palm);
  // four fingers and a thumb; a finger is two joints that fold toward the palm as the hand curls
  const c1 = curl * 1.25, c2 = curl * 1.5;
  for (let i = 0; i < 4; i++) {
    const lb = (i - 1.5) * 0.0122 - 0.002, len = 0.0235 - abs(i - 1.3) * 0.0028, r = 0.0064 - (i === 3 ? 0.0006 : 0);
    const k0 = P(0.064, lb, 0.001), d1 = [cos(c1), -sin(c1)], k1 = P(0.064 + len * d1[0], lb, 0.001 + len * d1[1]);
    const d2 = [cos(c1 + c2), -sin(c1 + c2)], k2 = P(0.064 + len * d1[0] + len * 0.85 * d2[0], lb, 0.001 + len * d1[1] + len * 0.85 * d2[1]);
    parts.push(capsule(k0, k1, r), capsule(k1, k2, r * 0.94));
  }
  const tc = curl * 0.9, t0 = P(0.03, 0.022, -0.002), t1 = P(0.048, 0.04 - 0.012 * curl, -0.004 - 0.012 * tc), t2 = P(0.066 - 0.006 * curl, 0.044 - 0.03 * curl, -0.008 - 0.026 * tc);
  parts.push(capsule(t0, t1, 0.0088), capsule(t1, t2, 0.008));
  const field = (x, y, z) => { let d = parts[0](x, y, z); for (let i = 1; i < parts.length; i++) d = sminv(d, parts[i](x, y, z), 0.0055); return d; };
  const c = P(0.03, 0, 0);
  return { field, bounds: [[c[0] - 0.09, c[1] - 0.09, c[2] - 0.09], [c[0] + 0.09, c[1] + 0.09, c[2] + 0.09]], grip: { at: P(0.058, 0.002, -0.021), a, b, n } };
}
// the toes of two wrapped feet, just showing under the hem
export function feetField(B) {
  const w = B.w;
  const one = (s) => {
    const c = [s * 0.058 * w, 0.016, 0.132 * w];
    return (x, y, z) => {
      const px = (x - c[0]) / 0.034, py = (y - c[1]) / 0.024, pz = (z - c[2]) / 0.058, k0 = sqrt(px * px + py * py + pz * pz), k1 = sqrt((px / 0.034) ** 2 + (py / 0.024) ** 2 + (pz / 0.058) ** 2);
      const d = k1 === 0 ? -0.02 : (k0 * (k0 - 1)) / k1;
      // strips of cloth wound round the foot
      return max(d - 0.0022 * sin((z - c[2]) * 300 + (x - c[0]) * 90 * s) , -y + 0.001);
    };
  };
  const l = one(1), r = one(-1);
  return { field: (x, y, z) => min(l(x, y, z), r(x, y, z)), bounds: [[-0.13 * w, -0.004, 0.06], [0.13 * w, 0.07, 0.24 * w + 0.03]] };
}
// a point on the hem at an angle round the body, just above the cut, and the way out from the body there
export function skirtEdge(th, B, belt) {
  const y = hemHeight(th, B) + 0.004, R = skirtRadius(th, y, B, belt);
  return { p: [R * sin(th), y, R * cos(th) * ZS], n: [sin(th), 0, cos(th)] };
}
// a point on the skirt at an angle round the body and a height, and the way out of the cloth there (for patches)
export function skirtPoint(th, y, B) {
  const R = skirtRadius(th, y, B, false), R2 = skirtRadius(th, y + 0.01, B, false), slope = (R - R2) / 0.01;
  const n = norm3([sin(th), slope, cos(th) / ZS]);
  return { p: [R * sin(th), y, R * cos(th) * ZS], n };
}
