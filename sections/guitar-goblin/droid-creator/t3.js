// The Old Republic utility droid: a low four-footed unit with a flat disc of a head. It is built as the type, from a
// study of many pictures of such units (game models, drawings, toys, fan builds): from the side a wide letter A, a
// slab of a body rising forward from two rear pods to ball shoulders, with two flat-bar legs raked forward onto
// forked feet; a round flat head twice as wide as the body on a short neck, with one large eye lying on top of it
// like a barrel and looking over the rim; two open tool bays on the chest and a lift piston down the back. The
// proportions are the type's; every panel, fitting and paint scheme here is our own, and no unit's markings are copied.
//
// Pieces that move against each other: the rear pods, the body (it pivots on the rear axle), the two legs (they
// swing at the shoulders), the two feet, and the head on a ball neck, which stays level as the body tips.
// Everything is in metres. W is the width of the body's front face; most sizes are given in W, as they were studied.
import * as THREE from 'three';
import { Kit, ROLE, FLAG, M, rad, turned, profile, PLANE, rrect, ngon, inset, rng, context } from './hard.js';
import { U, V, walk } from './layout.js';
import { KINDS } from './utility.js';
import { lens } from './domes.js';
import { antennaAt, boltAt } from './fittings.js';

const { PI, sin, cos, hypot, max, min, acos } = Math;
const W = 0.32, w = (k) => k * W;
export const T3 = {
  W,
  axleY: w(0.40), ankleY: w(0.57),      // the rear axle and the ankles, above the ground
  S: w(1.76), lean0: rad(43),           // rear axle to shoulder, and how far forward of upright that line leans when standing level
  L: w(1.77),                           // shoulder to ankle
  xLeg: w(0.89), xBall: w(0.985), xPod: w(0.875),
  headR: w(1.0),
};
// the body's side: [forward, up] from the rear axle, standing level, counter-clockwise seen from its left
const A = [w(0.66), w(1.70)], B = [w(1.81), w(1.70)], C = [w(1.81), w(1.00)], D = [w(0.75), w(-0.12)], E = [w(-0.40), w(-0.12)];
const SIDE = [E, D, C, B, A];
const SHOULDER = [T3.S * sin(T3.lean0), T3.S * cos(T3.lean0)];
const NECK = [w(1.235), w(1.74)];       // where the head's ball sits

/* ---------------- frames ---------------- */
const basis = (X, Y, Z, P) => new THREE.Matrix4().makeBasis(new THREE.Vector3(...X), new THREE.Vector3(...Y), new THREE.Vector3(...Z)).setPosition(P[0], P[1], P[2]);
// for parts drawn side-on: local x runs forward, y up, and z out to the droid's left
const OUT = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
const UP = M.rx(-PI / 2);               // local z up, local y toward the back
const DOWN = M.rx(PI / 2);              // local z down
const ALONG_X = M.ry(PI / 2);           // local z out to the left
// a flat face between two points of a side outline, facing outward: local x across the droid, local y from p0 to p1.
// `back` is for faces whose outside is the other way (the back).
function face(p0, p1, back, x = 0) {
  const dz = p1[0] - p0[0], dy = p1[1] - p0[1], len = hypot(dz, dy), Y = [0, dy / len, dz / len], X = [back ? -1 : 1, 0, 0];
  const Z = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
  return [basis(X, Y, Z, [x, p0[1], p0[0]]), len];
}
// the droid's left side as a face: local x runs backward, y up, z out
const LEFT = (x) => basis([0, 0, -1], [0, 1, 0], [1, 0, 0], [x, 0, 0]);
// a rod from p to q: a frame with local z along it
function along(p, q) {
  const z = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]), len = z.length(); z.normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(z); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return [new THREE.Matrix4().makeBasis(x, y, z).setPosition(p[0], p[1], p[2]), len];
}
const rod = (b, p, q, r, role, n = 12) => { const [m, len] = along(p, q); b.at(m, (k) => k.cyl(r, 0, len, { role, n, bevel: min(0.0015, r * 0.3) })); };
const add = (p, d) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
// the part of a convex outline where a x + b y + c >= 0
function clip(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], dp = a * p[0] + b * p[1] + c, dq = a * q[0] + b * q[1] + c;
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
// a plate of any outline standing on a flat side, with a gap round it and a chamfered edge
function plate(b, outline, z0, z1, role, o = {}) {
  if (outline.length < 3) return;
  b.prism(inset(outline, o.gap ?? 0.0013), z0, z1, { role, bevel0: 0, bevel1: o.bevel ?? 0.0014, cap0: false, ...o });
}

/* ---------------- paint schemes ---------------- */
// What is this part painted? The answers are ours. `at.x` is how far off the centre line a part is.
const { primary: P, secondary: S2, metal: MT, steel: ST, dark: DK } = ROLE;
const mid = (at) => Math.abs(at.x ?? 9) < 0.07;
export const T3_SCHEMES = {
  // the second colour on what turns and what touches the ground
  service: { name: 'Service', role: (tag) => ({ rimhi: S2, ball: S2, toe: S2, pod: S2, block: S2, trim: MT, hub: DK, eye: DK, cap: MT, cuff: ST })[tag] ?? P },
  solid: { name: 'Solid', role: (tag) => ({ block: S2, cap: S2, trim: MT, hub: MT, eye: ST, cuff: MT })[tag] ?? P },
  // a stripe down the centre line, over the head and down the chest and the back
  stripe: { name: 'Stripe', role: (tag, at) => {
    if (tag === 'trim' || tag === 'hub' || tag === 'cuff') return MT;
    if (tag === 'eye') return DK;
    if (tag === 'cowl' || tag === 'cap' || tag === 'mid') return S2;
    if (['skin', 'door', 'rim', 'block', 'crown', 'rimhi', 'rimlo', 'top'].includes(tag) && mid(at)) return S2;
    return P;
  } },
  banded: { name: 'Banded', role: (tag) => ({ rimlo: S2, rim: S2, cuff: S2, sole: S2, podface: S2, cap: S2, trim: MT, hub: MT, eye: ST })[tag] ?? P },
  // head and shoulders in the second colour
  twotone: { name: 'Two-tone', role: (tag) => ({ rimhi: S2, rimlo: S2, crown: S2, cowl: S2, cap: S2, ball: S2, top: S2, trim: MT, hub: MT, eye: DK, cuff: MT })[tag] ?? P },
  bare: { name: 'Bare metal', role: (tag, at) => ({ block: S2, door: P, rim: P, cowl: P, podface: P, toe: ST, pod: ST, ball: ST, hub: DK, eye: DK, cap: S2, cuff: P, sole: ST })[tag] ?? MT },
};

/* ---------------- what stands in the tool bays ---------------- */
// Each is made in the bay's own frame: the origin at the top of the opening on the bay's back wall, x across, y up,
// z out of the bay.
const light = (K, p, col, size = 0.035) => { K.glow.color = col; K.glow.at(M.t(p[0], p[1], p[2]), (b) => b.cyl(0.0036, 0, 0.002, { n: 8, bevel: 0 })); K.halo([p[0], p[1], p[2] + 0.003], [0, 0, 1], col, size); };
// the computer spike: hanging from a pin, or swung out and run forward
function spikeBay(c, wd, hh, deep) {
  const m = c.K.main, out = c.on.has('spike'), py = -0.03, pz = deep * 0.52;
  m.at(M.mul(M.t(0, py, pz), ALONG_X), (b) => b.cyl(0.0058, -wd / 2 + 0.001, wd / 2 - 0.001, { role: ROLE.steel, n: 10, bevel: 0.001 }));
  for (const sx of [-1, 1]) m.at(M.t(sx * 0.024, py + 0.012, pz - 0.012), (b) => b.box(0.007, 0.042, 0.03, { role: ROLE.steel, bevel: 0.002 }));
  m.at(M.mul(M.t(0, py, pz), M.rx(out ? rad(-74) : rad(-3)), DOWN), (b) => {   // local z runs down the tool
    const run = out ? 0.085 : 0;
    b.at(ALONG_X, (q) => q.cyl(0.0125, -0.018, 0.018, { role: ROLE.steel, n: 14, bevel: 0.002 }));
    b.cyl(0.0105, 0.008, 0.02, { role: ROLE.steel, n: 14, bevel: 0.0015 });
    b.cyl(0.0155, 0.018, 0.074, { role: ROLE.metal, n: 18, bevel: 0.003 });
    for (const z of [0.026, 0.034, 0.042]) b.cyl(0.0168, z, z + 0.004, { role: ROLE.dark, n: 18, bevel: 0.001 });
    b.cyl(0.0164, 0.058, 0.066, { role: ROLE.brass, n: 18, bevel: 0.001 });
    if (out) { b.cyl(0.0105, 0.072, 0.074 + run * 0.55, { role: ROLE.metal, n: 14, bevel: 0.001 }); b.cyl(0.0125, 0.074 + run * 0.5, 0.074 + run * 0.6, { role: ROLE.steel, n: 14, bevel: 0.0015 }); }
    b.cyl(0.0078, 0.07, 0.084 + run, { role: ROLE.metal, n: 12, bevel: 0.001 });
    b.loft([{ o: ngon(0.0092, 12), z: 0.082 + run }, { o: ngon(0.0092, 12), z: 0.088 + run }, { o: ngon(0.0045, 12), z: 0.106 + run }, { o: ngon(0.0011, 12), z: 0.116 + run }], { role: ROLE.metal, cap0: false });
  });
}
// bare works: ribs on the back wall, conduits down it, a junction box
function worksBay(c, wd, hh, deep) {
  const K = c.K, m = K.main;
  for (let k = 0; k < 4; k++) { const x = -wd / 2 + 0.011 + (k * (wd - 0.022)) / 3; m.at(M.t(x, -hh / 2, 0.004), (b) => b.box(0.006, hh - 0.012, 0.008, { role: ROLE.steel, bevel: 0.001 })); }
  const pipe = (x, role, rr, wob, z) => m.tube([[x, -0.003, z], [x + wob, -hh * 0.3, z + 0.004], [x - wob, -hh * 0.62, z + 0.002], [x, -hh + 0.003, z]], rr, { role, sides: 7, n: 18 });
  pipe(-wd * 0.31, ROLE.brass, 0.0046, 0.004, 0.014); pipe(-wd * 0.13, ROLE.rubber, 0.0062, -0.004, 0.016); pipe(wd * 0.34, ROLE.metal, 0.0036, 0.002, 0.013);
  m.at(M.t(wd * 0.13, -hh * 0.7, 0.018), (b) => b.box(0.04, 0.046, 0.026, { role: ROLE.steel, rad: 0.003, bevel: 0.002 }));
  m.at(M.t(wd * 0.13, -hh * 0.7, 0.032), (b) => b.box(0.026, 0.03, 0.004, { role: ROLE.brass, rad: 0.002, bevel: 0.001 }));
  m.at(M.t(wd * 0.12, -hh * 0.3, 0.014), (b) => b.box(0.03, 0.03, 0.018, { role: ROLE.brass, rad: 0.002, bevel: 0.002 }));
  for (const y of [0.42, 0.52]) m.at(M.mul(M.t(0, -hh * y, 0.02), ALONG_X), (b) => b.cyl(0.0034, -wd * 0.42, wd * 0.42, { role: ROLE.steel, n: 8, bevel: 0.0008 }));
  light(K, [wd * 0.2, -hh * 0.12, 0.012], [0.2, 1, 0.4]); light(K, [wd * 0.31, -hh * 0.12, 0.012], [1, 0.6, 0.08]);
}
// an instrument rack: a logic display over two rows of sockets and a column of lights
function rackBay(c, wd, hh, deep) {
  const K = c.K, m = K.main, z = deep - 0.016;
  m.at(M.t(0, -hh / 2, z / 2), (b) => b.box(wd - 0.008, hh - 0.008, z, { role: ROLE.steel, rad: 0.004, bevel: 0.002 }));
  K.at(M.t(0, -hh / 2, z), () => {
    const lw = wd * 0.36, y0 = hh * 0.18, y1 = hh * 0.4;
    m.frame(PLANE, [-lw - 0.003, lw + 0.003, y0 - 0.003, y1 + 0.003], [-lw, lw, y0, y1], { h: 0.003, gap: 0, role: ROLE.metal, rad: 0.003, holeRad: 0.001, holeDrop: 0.002, drop: 0.003, bevel: 0.0008 });
    K.logic.panel(PLANE, -lw, lw, y0, y1, { h: 0.001, gap: 0, rad: 0.001, wall: null, edge: false, uv01: true });
    K.halo([0, (y0 + y1) / 2, 0.005], [0, 0, 1], [0.3, 0.6, 1.0], lw * 4);
    for (let j = 0; j < 2; j++) for (let i = 0; i < 3; i++) {
      const x = (i - 1) * wd * 0.26, y = -hh * 0.04 - j * hh * 0.17, s = 0.0105, q = s * 0.6;
      m.frame(PLANE, [x - s, x + s, y - s, y + s], [x - q, x + q, y - q, y + q], { h: 0.003, gap: 0, role: ROLE.metal, rad: 1, holeRad: 1, holeDrop: 0.003, drop: 0.003, bevel: 0.0008, cornerSegs: 4 });
      m.panel(PLANE, x - q * 0.36, x + q * 0.36, y - q * 0.36, y + q * 0.36, { h: 0.002, gap: 0, rad: 1, role: ROLE.brass, wall: { out: 0.0005, dh: -0.003 } });
    }
    const cols = [[1, 0.22, 0.1], [1, 0.6, 0.08], [0.2, 1, 0.4], [0.3, 0.6, 1]];
    for (let k = 0; k < 4; k++) light(K, [(k - 1.5) * wd * 0.2, -hh * 0.38, 0.001], cols[k], 0.032);
  });
}
// a shutter: the bay closed with a slatted door and a pull
function shutterBay(c, wd, hh, deep, at) {
  const m = c.K.main, z = deep - 0.012, n = 7, pitch = (hh - 0.012) / n;
  c.K.at(M.t(0, -hh / 2, z), () => {
    for (let k = 0; k < n; k++) { const y = -hh / 2 + 0.006 + pitch * (k + 0.5); m.panel(PLANE, -wd / 2 + 0.003, wd / 2 - 0.003, y - pitch * 0.44, y + pitch * 0.44, { h: 0.003, gap: 0, rad: 0.002, role: c.role('door', at), wall: { out: 0.001, dh: -0.006 }, seed: c.rnd() }); }
    m.at(M.t(0, -hh * 0.34, 0.006), (b) => b.box(wd * 0.4, 0.008, 0.008, { role: ROLE.steel, rad: 0.002, bevel: 0.002 }));
  });
}
// a tool arm reaching out of a bay: a turret, two links on ball joints, a three-fingered gripper
function toolArm(c, wd, hh, deep) {
  const b = c.K.main, P0 = [0, -0.05, deep * 0.45], P1 = add(P0, [0, -0.006, 0.075]), P2 = add(P1, [0.035, 0.07, 0.085]), P3 = add(P2, [-0.02, -0.075, 0.11]);
  b.at(M.t(P0[0], P0[1], P0[2] - 0.012), (k) => k.box(0.05, 0.05, 0.024, { role: ROLE.steel, rad: 0.006, bevel: 0.003 }));
  const [m0] = along(P0, P1); b.at(m0, (k) => k.cyl(0.019, -0.002, 0.014, { role: ROLE.steel, n: 18, bevel: 0.002 }));
  rod(b, P0, P1, 0.011, ROLE.metal); rod(b, P1, P2, 0.0088, ROLE.metal); rod(b, P2, P3, 0.0074, ROLE.metal);
  for (const [p, r] of [[P1, 0.0155], [P2, 0.0135], [P3, 0.0115]]) b.at(M.t(p[0], p[1], p[2]), (k) => k.ball(r, { role: ROLE.steel, n: 8, segs: 14 }));
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  rod(b, lerp(P1, P2, 0.25), lerp(P1, P2, 0.7), 0.0118, ROLE.brass, 10);
  rod(b, lerp(P2, P3, 0.3), lerp(P2, P3, 0.62), 0.0098, ROLE.dark, 10);
  const [mw] = along(P2, P3), wrist = M.mul(M.t(P3[0], P3[1], P3[2]), new THREE.Matrix4().extractRotation(mw));
  b.at(wrist, (k) => {
    k.cyl(0.0135, 0.006, 0.02, { role: ROLE.steel, n: 12, bevel: 0.002 });
    for (let i = 0; i < 3; i++) k.at(M.mul(M.rz((i / 3) * 2 * PI + 0.5), M.t(0.009, 0, 0.018), M.ry(0.42)), (f) => {
      f.prism(rrect(0.006, 0.009, 0.001, 1), 0, 0.03, { role: ROLE.metal, bevel: 0.001 });
      f.at(M.mul(M.t(0, 0, 0.03), M.ry(-0.95)), (g) => g.prism(rrect(0.005, 0.008, 0.001, 1), -0.002, 0.022, { role: ROLE.metal, bevel: 0.001 }));
    });
  });
}
const FILL = { spike: spikeBay, works: worksBay, rack: rackBay, shutter: shutterBay };

/* ---------------- the body's own fittings, beside the utility droid's (utility.js) ---------------- */
const FITS = {
  ...KINDS,
  // an open tool bay: a deep dark box in the chest with something standing in it
  bay(c, r, leaf, at) {
    const [Wd, H] = c.size(r), m = c.K.main, mg = 0.0075, deep = 0.04;
    const hole = c.sub(r, -Wd / 2 + mg, Wd / 2 - mg, -H / 2 + mg, H / 2 - mg), wd = hole[1] - hole[0], hh = hole[3] - hole[2];
    m.frame(c.map, r, hole, { role: c.role('skin', at), rad: 0.005, holeRad: 0.004, holeDrop: 0.016, seed: c.rnd() });
    m.panel(c.map, hole[0], hole[1], hole[2], hole[3], { h: -deep, rad: 0.004, gap: 0, role: ROLE.steel, wall: { out: 0, dh: deep - 0.012 } });
    c.K.at(M.t((hole[0] + hole[1]) / 2, hole[3], -deep), () => {
      FILL[leaf.fill](c, wd, hh, deep, at);
      if (leaf.arm && c.on.has('arm')) toolArm(c, wd, hh, leaf.fill === 'shutter' ? deep + 0.03 : deep);
    });
  },
  // the lift piston: a deep channel down the back with a ram standing in it (a cylinder, a bellows, a clevis)
  channel(c, r, leaf, at) {
    const [Wd, H] = c.size(r), K = c.K, m = K.main, deep = 0.046, g = 0.004, R = min(0.03, Wd * 0.3);
    m.panel(c.map, r[0], r[1], r[2], r[3], { h: -deep, rad: 0.006, gap: g, role: ROLE.dark, wall: { out: 0, dh: deep } });
    K.at(M.t((r[0] + r[1]) / 2, r[2] + g, -deep + R + 0.004), () => {   // local y runs up the back
      const pts = [[R * 0.78, 0.004], [R * 1.12, 0.004], [R * 1.12, H * 0.1], [R * 0.9, H * 0.1], [R * 0.9, H * 0.14]];
      const n = 9, b0 = H * 0.14, b1 = H * 0.44;
      for (let k = 0; k < n; k++) { const y = b0 + ((b1 - b0) * k) / n, dy = (b1 - b0) / n; pts.push([R * 1.16, y + dy * 0.5], [R * 0.84, y + dy]); }
      m.lathe(pts.slice(0, 5), { role: ROLE.steel, segs: 24 });
      m.lathe(pts.slice(4), { role: ROLE.rubber, segs: 24, wear: false });
      m.lathe([[R * 0.84, b1], [R * 1.08, b1], [R * 1.08, b1 + 0.016], [R * 0.86, b1 + 0.016], [R * 0.86, H * 0.9], [R * 1.04, H * 0.9], [R * 1.04, H * 0.93], [R * 0.6, H * 0.93], [R * 0.6, H - 0.012]], { role: ROLE.metal, segs: 24 });
      for (const y of [H * 0.56, H * 0.74]) m.at(M.t(0, y, -R * 0.4), (b) => b.box(Wd - 0.016, 0.014, R * 1.5, { role: ROLE.steel, rad: 0.002, bevel: 0.002 }));   // the straps that hold the ram
      m.at(M.t(0, H * 0.05, -R * 0.2), (b) => b.box(Wd - 0.014, H * 0.07, R * 1.9, { role: ROLE.steel, rad: 0.003, bevel: 0.003 }));
      for (const sx of [-1, 1]) m.tube([[sx * (Wd / 2 - 0.012), H * 0.16, -R * 0.6], [sx * (Wd / 2 - 0.014), H * 0.4, -R * 0.55], [sx * (Wd / 2 - 0.011), H * 0.62, -R * 0.6], [sx * (Wd / 2 - 0.013), H * 0.94, -R * 0.6]], 0.0042, { role: sx > 0 ? ROLE.brass : ROLE.rubber, sides: 7, n: 18 });
    });
  },
  // a plain strip with a seat for the restraining bolt
  seat(c, r, leaf, at) {
    KINDS.skin(c, r, leaf, at);
    if (c.on.has('bolt')) boltAt(c.K, M.t((r[0] + r[1]) / 2, (r[2] + r[3]) / 2, 0.0005));
  },
};
const Lf = (kind, o = {}) => ({ kind, ...o });
const skin = (o) => Lf('skin', o), door = (o) => Lf('door', o), rim = () => Lf('skin', { tag: 'rim' }), hatch = (o) => Lf('hatch', o);

/* ---------------- panel layouts: what is on the chest, the belly, the back ---------------- */
const chest = (right, left) => V(
  [10, U([1, rim()], [1, rim()])],
  [50, U([11, skin()], [35, Lf('bay', { fill: right })], [8, skin({ tag: 'mid' })], [35, Lf('bay', { fill: left, arm: true })], [11, skin()])],
  [10, U([1, skin()], [0.7, Lf('lights')], [1, skin()])],
);
export const T3_LAYOUTS = {
  // the works standard: both bays open, two hatches and a wide vent on the belly
  standard: {
    name: 'Standard',
    front: () => chest('spike', 'works'),
    under: () => V([12, U([1, skin()], [1.1, Lf('seat')], [1, skin()])], [36, U([1, hatch()], [1, hatch()])], [22, U([1, door({ drop: true })], [0.8, Lf('coupling')], [1, door()])], [18, U([0.14, skin()], [1, Lf('vent')], [0.14, skin()])], [12, U([1, rim()], [1, rim()])]),
    back: () => U(
      [1, V([8, rim()], [30, door()], [34, door({ tag: 'block', drop: true })], [10, Lf('lights')], [18, skin()])],
      [1.05, V([8, rim()], [74, Lf('channel')], [18, Lf('grille', { slats: 6 })])],
      [1, V([8, rim()], [44, door({ tag: 'block' })], [20, hatch()], [28, skin()])],
    ),
    side: { port: true, grille: 5, blocks: 3 },
  },
  // a technician's unit: an instrument rack in the second bay, more sockets and hatches
  technician: {
    name: 'Technician',
    front: () => chest('spike', 'rack'),
    under: () => V([12, U([1, skin()], [1.1, Lf('seat')], [1, skin()])], [26, U([1, Lf('port')], [1.3, hatch()], [1, Lf('coupling')])], [14, Lf('slots', { n: 7, across: true })], [22, U([1, hatch()], [1, door({ drop: true })])], [14, U([0.14, skin()], [1, Lf('vent')], [0.14, skin()])], [12, U([1, rim()], [1, rim()])]),
    back: () => U(
      [1, V([8, rim()], [22, hatch()], [12, Lf('lights')], [30, door({ drop: true })], [10, Lf('slots', { n: 3, across: true })], [18, skin()])],
      [1.05, V([8, rim()], [74, Lf('channel')], [18, Lf('grille', { slats: 6 })])],
      [1, V([8, rim()], [30, door({ tag: 'block' })], [22, hatch()], [14, Lf('port')], [26, skin()])],
    ),
    side: { port: true, grille: 7, blocks: 4 },
  },
  // a hauler: the second bay shuttered, big plain doors, little to break
  hauler: {
    name: 'Hauler',
    front: () => chest('spike', 'shutter'),
    under: () => V([12, U([1, skin()], [1.1, Lf('seat')], [1, skin()])], [48, U([1, door({ tag: 'block' })], [1, door({ tag: 'block', drop: true })])], [28, U([0.1, skin()], [1, Lf('grille', { slats: 9 })], [0.1, skin()])], [12, rim()]),
    back: () => U(
      [1, V([8, rim()], [64, door({ tag: 'block', drop: true })], [28, skin()])],
      [1.05, V([8, rim()], [74, Lf('channel')], [18, Lf('grille', { slats: 6 })])],
      [1, V([8, rim()], [64, door({ tag: 'block' })], [28, skin()])],
    ),
    side: { port: false, grille: 4, blocks: 2 },
  },
};

/* ---------------- the body ---------------- */
function buildBody(K, state, scheme, rnd, on, lay) {
  const m = K.main, hw = W / 2, sc = (part) => ({ role: (tag, at = {}) => scheme.role(tag, { ...at, part }) });
  const part = (fn) => { m.seed = rnd(); fn(m); m.seed = 0; };
  // What shows in the gaps: a dark core, standing back from the skin, and notched where a bay or the back's channel
  // is sunk into it. It is made in slices across the droid, because the notches are not the same all the way across.
  {
    const core = inset(SIDE, 0.018), hF = B[1] - C[1], f0 = C[1] + hF * (10 / 70) + 0.003, f1 = C[1] + hF * (60 / 70) - 0.003, zf = core[2][0];
    const sl = hypot(A[0] - E[0], A[1] - E[1]), tz = (A[0] - E[0]) / sl, ty = (A[1] - E[1]) / sl, nz = ty, ny = -tz;   // up the back, and into the body
    const onBack = (v, d) => [core[0][0] + tz * v + nz * d, core[0][1] + ty * v + ny * d], b0 = sl * 0.18 - 0.012, b1 = sl * 0.92 - 0.03;
    const slice = (x0, x1, front, back) => {
      const o = [core[0], core[1], core[2]];
      if (front) o.push([zf, f0], [zf - 0.05, f0], [zf - 0.05, f1], [zf, f1]);
      o.push(core[3], core[4]);
      if (back) o.push(onBack(b1, 0), onBack(b1, 0.05), onBack(b0, 0.05), onBack(b0, 0));
      m.at(OUT, (q) => q.prism(o, x0, x1, { role: ROLE.dark, wear: false, bevel: 0 }));
    };
    const e = hw - 0.006, r0 = w(0.39) - 0.003, r1 = w(0.04) + 0.003, ch = (W * 1.05) / 3.05 / 2 - 0.002;
    slice(-e, -r0, false, false); slice(-r0, -ch, true, false); slice(-ch, -r1, true, true); slice(-r1, r1, false, true);
    slice(r1, ch, true, true); slice(ch, r0, true, false); slice(r0, e, false, false);
  }
  // the four faces a layout covers
  const cover = (name, p0, p1, back, tree) => {
    const [mat, len] = face(p0, p1, back);
    K.at(mat, () => {
      const c = context(K, PLANE, sc(name), rnd), drops = [];
      walk(tree, [-hw, hw, 0, len], (leaf) => { if (leaf.drop) drops.push(leaf); });
      const gone = drops.length ? drops[Math.floor(rnd() * drops.length)] : null;
      c.flag = (leaf) => (leaf === gone ? FLAG.drop : 0) | ((leaf.kind === 'skin' || leaf.kind === 'door') && leaf.tag !== 'rim' && leaf.tag !== 'mid' && rnd() < 0.12 ? FLAG.odd : 0);
      c.on = on;
      let i = 0;
      walk(tree, [-hw, hw, 0, len], (leaf, r) => FITS[leaf.kind](c, r, leaf, { x: (r[0] + r[1]) / 2, i: i++ }));
    });
  };
  cover('front', C, B, false, lay.front());
  cover('under', D, C, false, lay.under());
  cover('back', E, A, true, lay.back());
  cover('under', E, D, false, U([1, skin()], [1.6, V([1, skin()], [1.4, Lf('grille', { slats: 8 })], [1, skin()])], [1, skin()]));   // the belly, seen only from the floor
  // the top: one plate, and the collar the neck's ball sits in
  const [topMat, topLen] = face(B, A, false);
  K.at(topMat, () => m.panel(PLANE, -hw, hw, 0, topLen, { role: scheme.role('top', { x: 0, part: 'top' }), rad: 0.016, seed: rnd() }));
  m.at(M.t(0, A[1], NECK[0]), (b) => {
    b.lathe([[w(0.47), 0], [w(0.47), w(0.035)], [w(0.44), w(0.06)], [w(0.365), w(0.06)], [w(0.335), w(0.035)], [w(0.335), 0.001]], { role: ROLE.steel, segs: 40 });
    for (let k = 0; k < 8; k++) b.at(M.mul(M.ry((k / 8) * 2 * PI + 0.39), M.t(w(0.405), w(0.06), 0), UP), (q) => q.cyl(0.0052, 0, 0.0035, { role: ROLE.metal, n: 8, bevel: 0.001 }));
  });
  // the sides: plates round the shoulder, a strip under the top, a stepped strip down the back edge
  const sl = hypot(A[0] - E[0], A[1] - E[1]), bn = [(A[1] - E[1]) / sl, -(A[0] - E[0]) / sl];   // the back edge's inward normal
  const bc = -(bn[0] * E[0] + bn[1] * E[1]), yRim = w(1.52), dBack = w(0.2), yLow = w(0.5);
  for (const side of [1, -1]) K.at(M.s(side, 1, 1), () => {
    const role = (tag, i = 0) => scheme.role(tag, { part: 'side', side, i, x: 9 });
    m.at(OUT, (b) => {
      const pl = (o, tag, i, t = 0.0045) => { m.seed = rnd(); m.flag = rnd() < 0.1 ? FLAG.odd : 0; plate(b, o, hw - 0.006, hw + (t - 0.0045), role(tag, i)); m.flag = 0; m.seed = 0; };
      const below = clip(SIDE, 0, -1, yRim), fore = clip(below, bn[0], bn[1], bc - dBack);
      pl(clip(SIDE, 0, 1, -yRim), 'rim', 0);                               // under the top
      pl(clip(below, -bn[0], -bn[1], -(bc - dBack)), 'skin', 1);           // down the back edge
      pl(clip(fore, 0, 1, -yLow), 'skin', 2);                              // round the shoulder
      pl(clip(fore, 0, -1, yLow), 'door', 3);                              // low, by the rear axle
      { const low = clip(fore, 0, -1, yLow); m.seed = rnd(); plate(b, inset(low, 0.012), hw - 0.001, hw + 0.0016, role('block', 3), { gap: 0, bevel: 0.001 }); m.seed = 0; }
      // stepped blocks on the back strip
      for (let k = 0; k < lay.side.blocks; k++) {
        const t = 0.2 + (0.62 * k) / max(1, lay.side.blocks - 1), cz = E[0] + (A[0] - E[0]) * t + bn[0] * dBack * 0.5, cy = E[1] + (A[1] - E[1]) * t + bn[1] * dBack * 0.5;
        b.at(M.mul(M.t(cz, cy, 0), M.rz(-rad(30.2))), (q) => part(() => q.prism(rrect(dBack * 0.62, w(0.2) - k * 0.006, 0.004, 2), hw - 0.002, hw + 0.005 + (k % 2) * 0.003, { role: k % 2 ? ROLE.steel : role('block', k), bevel: 0.002 })));
      }
    });
    // the shoulder's axle: a flange on the body, a ribbed stub out to the ball
    m.at(M.mul(M.t(0, SHOULDER[1], SHOULDER[0]), ALONG_X), (b) => {
      b.cyl(w(0.3), hw - 0.002, hw + 0.011, { role: ROLE.steel, n: 28, bevel: 0.003 });
      b.cyl(w(0.2), hw + 0.008, T3.xBall - w(0.14), { role: ROLE.dark, n: 24, bevel: 0.002 });
      for (let k = 0; k < 3; k++) { const x = hw + 0.022 + k * 0.019; b.cyl(w(0.228), x, x + 0.011, { role: ROLE.steel, n: 24, bevel: 0.003 }); }
      for (let k = 0; k < 6; k++) b.at(M.mul(M.rz((k / 6) * 2 * PI + 0.3), M.t(w(0.255), 0, hw + 0.011)), (q) => q.cyl(0.005, 0, 0.003, { role: ROLE.metal, n: 8, bevel: 0.001 }));
    });
    // the boss the rear axle runs through
    m.at(ALONG_X, (b) => { b.cyl(w(0.27), hw - 0.002, hw + 0.012, { role: ROLE.steel, n: 24, bevel: 0.003 }); b.cyl(w(0.19), hw + 0.01, hw + 0.02, { role: ROLE.dark, n: 20, bevel: 0.002 }); });
    // small things on the side plate
    K.at(LEFT(hw + 0.0004), () => {
      const c = context(K, PLANE, sc('side'), rnd), at = { x: 9, i: 0 };
      const rect = (z, y, sz, sy) => [-(z + sz / 2), -(z - sz / 2), y - sy / 2, y + sy / 2];   // a rectangle given by its centre [forward, up] and size
      if (lay.side.port) {   // a socket high up near the front
        const r = rect(w(1.56), w(1.27), w(0.17), w(0.21)), q = [r[0] + 0.007, r[1] - 0.007, r[2] + 0.007, r[3] - 0.007];
        m.frame(PLANE, r, q, { h: 0.0045, gap: 0, role: ROLE.steel, rad: 0.004, holeRad: 0.002, holeDrop: 0.0035, drop: 0.0045, bevel: 0.001, solid: true });
        m.panel(PLANE, q[0], q[1], q[2], q[3], { h: 0.001, gap: 0, rad: 0.002, role: ROLE.dark, wall: null, edge: false });
        m.panel(PLANE, (q[0] + q[1]) / 2 - 0.0045, (q[0] + q[1]) / 2 + 0.0045, q[2] + 0.009, q[3] - 0.009, { h: 0.0036, gap: 0, rad: 0.002, role: ROLE.brass, wall: { out: 0.0005, dh: -0.003 } });
      }
      // a slatted grille low behind the shoulder, lying along the back's slope
      K.at(M.mul(M.t(-w(0.62), w(0.76), 0), M.rz(rad(30.2))), () => {
        const gw = w(0.3), gh = w(0.36), n = lay.side.grille, pitch = gh / n;
        m.panel(PLANE, -gw / 2 - 0.008, gw / 2 + 0.008, -gh / 2 - 0.008, gh / 2 + 0.008, { h: 0.005, gap: 0, role: c.role('trim', at), rad: 0.007, wall: { out: 0.002, dh: -0.0055 }, solid: true, seed: rnd() });
        m.panel(PLANE, -gw / 2, gw / 2, -gh / 2, gh / 2, { h: 0.0054, gap: 0, rad: 0.003, role: ROLE.dark, wall: null, edge: false });
        for (let k = 0; k < n; k++) { const y = -gh / 2 + pitch * (k + 0.5); m.panel(PLANE, -gw / 2 + 0.003, gw / 2 - 0.003, y - pitch * 0.3, y + pitch * 0.3, { h: 0.008, gap: 0, rad: 0.0015, role: ROLE.metal, wall: { out: 0.0005, dh: -0.0026 }, seed: rnd() }); }
      });
      // a filler cap low down, and fasteners along the strip under the top and round the low plate
      m.at(M.t(-w(0.5), w(0.02), 0), (b) => { b.cyl(0.02, -0.002, 0.006, { role: ROLE.steel, n: 18, bevel: 0.002 }); b.cyl(0.013, 0.006, 0.0105, { role: ROLE.brass, n: 14, bevel: 0.0015 }); });
      const stud = (z, y) => m.at(M.t(-z, y, 0), (b) => b.cyl(0.0042, 0, 0.0026, { role: ROLE.metal, n: 8, bevel: 0.0008 }));
      for (let k = 0; k < 5; k++) stud(w(0.74) + k * w(0.25), w(1.61));
      for (const [z, y] of [[1.02, 0.42], [0.86, 0.02], [0.28, -0.05], [0.0, 0.42]]) stud(w(z), w(y));
    });
    // a hydraulic line from the shoulder down to the rear axle, in two clips
    const lx = hw + 0.011;
    m.tube([[lx - 0.004, SHOULDER[1] - w(0.24), SHOULDER[0] - w(0.2)], [lx, w(0.98), w(0.86)], [lx, w(0.62), w(0.6)], [lx, w(0.36), w(0.36)], [lx - 0.003, w(0.2), w(0.17)]], 0.0062, { role: ROLE.rubber, sides: 8, n: 24 });
    for (const [y, z] of [[0.9, 0.8], [0.45, 0.445]]) m.at(M.mul(M.t(lx - 0.004, w(y), w(z)), M.rx(rad(-34))), (b) => b.box(0.012, 0.014, 0.03, { role: ROLE.steel, rad: 0.002, bevel: 0.002 }));
  });
}

/* ---------------- the rear pods ---------------- */
const POD = [[w(-0.55), -T3.axleY + 0.012], [w(0.81), -T3.axleY + 0.012], [w(0.84), -T3.axleY + 0.05], [w(0.27), w(0.36)], [w(-0.15), w(0.38)], [w(-0.585), -T3.axleY + 0.06]];
function buildRear(K, scheme, rnd) {
  const m = K.main, x0 = T3.xPod - w(0.275), x1 = T3.xPod + w(0.275);
  const part = (fn) => { m.seed = rnd(); fn(); m.seed = 0; };
  for (const side of [1, -1]) K.at(M.s(side, 1, 1), () => {
    const role = (tag, i = 0) => scheme.role(tag, { part: 'pod', side, i, x: 9 });
    m.at(OUT, (b) => {
      part(() => b.prism(POD, x0, x1, { role: role('pod'), bevel: 0.007 }));
      // a sole strip, and the wheels that show under it
      part(() => b.prism([[w(-0.58), -T3.axleY + 0.004], [w(0.835), -T3.axleY + 0.004], [w(0.85), -T3.axleY + 0.03], [w(-0.6), -T3.axleY + 0.03]], x0 - 0.004, x1 + 0.004, { role: role('sole'), bevel: 0.003 }));
    });
    for (const z of [w(0.52), w(-0.3)]) m.at(M.mul(M.t(0, -T3.axleY + w(0.13), z), ALONG_X), (b) => b.cyl(w(0.13), x0 + 0.012, x1 - 0.012, { role: ROLE.rubber, n: 24, bevel: 0.004, wear: false }));
    // the outer face: a square panel, and the hub the axle ends in
    K.at(LEFT(x1), () => {
      part(() => m.panel(PLANE, -w(0.5), w(-0.02), w(-0.02), w(0.3), { h: 0.004, gap: 0, rad: 0.006, role: role('podface'), wall: { out: 0.002, dh: -0.0045 }, solid: true }));
      m.panel(PLANE, -w(0.42), w(-0.1), w(0.06), w(0.22), { h: 0.0052, gap: 0, rad: 0.004, role: role('podface', 1), drop: 0.0014, bevel: 0.001 });
    });
    const hub0 = m.n;   // the hub and the axle turn as the pod rolls: marked for a table bake (t3-bake.js), by bone
    m.at(ALONG_X, (b) => {
      b.cyl(w(0.2), x1 - 0.004, x1 + 0.014, { role: ROLE.steel, n: 28, bevel: 0.004 });
      b.cyl(w(0.145), x1 + 0.012, x1 + 0.03, { role: role('hub'), n: 24, bevel: 0.004 });
      b.cyl(w(0.06), x1 + 0.028, x1 + 0.036, { role: ROLE.metal, n: 14, bevel: 0.002 });
      for (let k = 0; k < 6; k++) b.at(M.mul(M.rz((k / 6) * 2 * PI), M.t(w(0.172), 0, x1 + 0.014)), (q) => q.cyl(0.0048, 0, 0.003, { role: ROLE.metal, n: 8, bevel: 0.001 }));
      // the cross axle and its flange on the pod's inner face
      b.cyl(w(0.11), W / 2 + 0.016, x0 + 0.002, { role: ROLE.steel, n: 20, bevel: 0.002 });
      b.cyl(w(0.17), x0 - 0.008, x0 + 0.002, { role: ROLE.dark, n: 22, bevel: 0.002 });
    });
    (K.marks ||= []).push({ bone: side > 0 ? 'hub.L' : 'hub.R', part: 'main', range: [hub0, m.n] });
    // ribs up the front slope
    const [fm, flen] = face(POD[2], POD[3], false, T3.xPod);
    K.at(fm, () => { for (const sx of [-1, 1]) part(() => m.panel(PLANE, sx * w(0.13) - w(0.07), sx * w(0.13) + w(0.07), flen * 0.1, flen * 0.9, { h: 0.005, gap: 0, rad: 0.004, role: role('podface', 2), wall: { out: 0.002, dh: -0.0055 }, solid: true })); m.panel(PLANE, -w(0.035), w(0.035), flen * 0.14, flen * 0.86, { h: 0.0008, gap: 0, rad: 0.002, role: ROLE.dark, wall: null, edge: false }); });
    const [tm, tlen] = face(POD[3], POD[4], false, T3.xPod);
    K.at(tm, () => {
      part(() => m.panel(PLANE, -w(0.2), w(0.2), tlen * 0.12, tlen * 0.88, { h: 0.004, gap: 0, rad: 0.004, role: ROLE.steel, wall: { out: 0.002, dh: -0.0045 }, solid: true }));
      for (let j = 0; j < 4; j++) { const x = (j - 1.5) * w(0.085); m.panel(PLANE, x - w(0.028), x + w(0.028), tlen * 0.22, tlen * 0.78, { h: 0.0044, gap: 0, rad: 0.002, role: ROLE.dark, wall: null, edge: false }); }
    });
  });
}

/* ---------------- a leg: the shoulder ball, the strut, the ankle block. Hangs from the shoulder axis. ---------------- */
function buildLeg(K, side, scheme, rnd) {
  const m = K.main, { L, xLeg, xBall } = T3, role = (tag, i = 0) => scheme.role(tag, { part: 'leg', side, i, x: 9 });
  const part = (fn) => { m.seed = rnd(); fn(); m.seed = 0; };
  K.at(M.s(side, 1, 1), () => {
    // the ball: flattened, four shells round a hub, on a dark core
    const Rb = w(0.425), tb = w(0.225), pts = [], N = 12;
    for (let i = 0; i <= N; i++) { const e = rad(-62) + (rad(152) * i) / N; pts.push([Rb * cos(e), tb * sin(e)]); }
    K.at(M.mul(M.t(xBall, 0, 0), M.rz(-PI / 2)), () => {   // local y runs out along the axle
      const core = pts.map(([r, y]) => [r * 0.965, y * 0.965]);
      m.lathe([[w(0.14), core[0][1]], ...core, [0, core[N][1]]], { role: ROLE.dark, smooth: true, wear: false, segs: 36 });
      const path = profile.path(pts), map = turned(path, { stepV: path.len / 9, uvR: Rb, deg: 9 });
      for (let k = 0; k < 4; k++) part(() => m.panel(map, rad(k * 90 + 45), rad(k * 90 + 135), 0.002, path.len * 0.86, { role: role('ball', k), rad: 0.012, gap: 0.0055, drop: 0.007, cornerSegs: 3 }));
      const e1 = rad(-62) + rad(152) * 0.88, r1 = Rb * cos(e1), y1 = tb * sin(e1);
      m.lathe([[r1 + 0.004, y1 - 0.006], [r1 + 0.004, y1 + 0.006], [r1 - 0.006, y1 + 0.011], [r1 * 0.55, y1 + 0.011], [r1 * 0.55, y1 + 0.019], [r1 * 0.3, y1 + 0.019], [r1 * 0.3, y1 + 0.013], [0, y1 + 0.013]], { role: role('hub'), segs: 28 });
    });
    m.at(OUT, (b) => {
      // the clevis under the ball, and the flat bar
      part(() => b.prism(rrect(w(0.46), w(0.2), 0.012, 3, 0, -w(0.46)), xLeg - w(0.118), xLeg + w(0.118), { role: ROLE.steel, bevel: 0.005 }));
      part(() => b.prism(rrect(w(0.4), L - w(0.62), 0.01, 3, 0, -(L + w(0.42)) / 2), xLeg - w(0.1), xLeg + w(0.1), { role: role('strut'), bevel: 0.005 }));
      part(() => b.prism(rrect(w(0.44), w(0.16), 0.008, 2, 0, -L + w(0.24)), xLeg - w(0.112), xLeg + w(0.112), { role: role('cuff'), bevel: 0.004 }));
      // the ankle block the foot's axle runs through
      b.prism([[w(-0.17), -L + w(0.2)], [w(-0.2), -L - w(0.02)], [w(-0.1), -L - w(0.19)], [w(0.1), -L - w(0.19)], [w(0.2), -L - w(0.02)], [w(0.17), -L + w(0.2)]], xLeg - w(0.075), xLeg + w(0.075), { role: ROLE.rubber, bevel: 0.006, wear: false });
    });
    m.at(M.mul(M.t(0, -L, 0), ALONG_X), (b) => { b.cyl(w(0.075), xLeg - w(0.36), xLeg + w(0.36), { role: ROLE.steel, n: 16, bevel: 0.002 }); for (const s of [-1, 1]) b.cyl(w(0.12), xLeg + s * w(0.085) - 0.004, xLeg + s * w(0.085) + 0.004, { role: ROLE.steel, n: 18, bevel: 0.0015 }); });
    // a long slot down the outer face with a ram in it; a plain sunk panel on the inner face
    const y0 = -L + w(0.4), y1 = -w(0.72), sw = w(0.105);
    K.at(LEFT(xLeg + w(0.1)), () => {
      m.frame(PLANE, [-sw - 0.008, sw + 0.008, y0 - 0.008, y1 + 0.008], [-sw, sw, y0, y1], { h: 0.0035, gap: 0, role: role('strut', 1), rad: 0.006, holeRad: 0.004, holeDrop: 0.012, drop: 0.004, bevel: 0.001, seed: rnd() });
      m.panel(PLANE, -sw, sw, y0, y1, { h: -0.0085, gap: 0, rad: 0.004, role: ROLE.dark, wall: null, edge: false });
      m.at(M.mul(M.t(0, y0 + 0.004, -0.002), UP), (b) => { b.cyl(0.0105, 0, (y1 - y0) * 0.5, { role: ROLE.steel, n: 12, bevel: 0.0015 }); b.cyl(0.0066, (y1 - y0) * 0.5, y1 - y0 - 0.008, { role: ROLE.metal, n: 10, bevel: 0.001 }); b.cyl(0.0125, (y1 - y0) * 0.46, (y1 - y0) * 0.52, { role: ROLE.brass, n: 12, bevel: 0.0015 }); });
    });
    K.at(M.mul(M.t(xLeg - w(0.1), 0, 0), M.ry(-PI / 2)), () => m.panel(PLANE, -sw, sw, y0, y1, { h: 0.0015, gap: 0, rad: 0.005, role: role('strut', 2), drop: 0.0018, bevel: 0.001, seed: rnd() }));
    // a hydraulic line up the front edge
    m.tube([[xLeg + w(0.04), -L + w(0.3), w(0.21)], [xLeg + w(0.04), -L + w(0.62), w(0.225)], [xLeg + w(0.04), -w(1.0), w(0.225)], [xLeg + w(0.04), -w(0.68), w(0.21)], [xLeg + w(0.04), -w(0.6), w(0.17)]], 0.0052, { role: ROLE.rubber, sides: 8, n: 22 });
    for (const y of [-L + w(0.66), -w(1.02)]) m.at(M.t(xLeg + w(0.04), y, w(0.214)), (b) => b.box(0.022, 0.012, 0.016, { role: ROLE.steel, rad: 0.002, bevel: 0.002 }));
  });
}

/* ---------------- a foot: two wedge toes either side of the ankle block. Built round the ankle axis. ---------------- */
const TOE = [[w(-0.3), -T3.ankleY + 0.012], [w(0.8), -T3.ankleY + 0.012], [w(0.815), -T3.ankleY + w(0.1)], [w(0.06), w(0.03)], [w(-0.15), w(0.03)], [w(-0.345), w(-0.24)]];
function buildFoot(K, side, scheme, rnd) {
  const m = K.main, { xLeg, ankleY } = T3, role = (tag, i = 0) => scheme.role(tag, { part: 'foot', side, i, x: 9 });
  const part = (fn) => { m.seed = rnd(); fn(); m.seed = 0; };
  K.at(M.s(side, 1, 1), () => {
    for (const k of [-1, 1]) {
      const xc = xLeg + k * w(0.22), x0 = xc - w(0.13), x1 = xc + w(0.13), outer = k > 0 ? x1 : x0;
      m.at(OUT, (b) => {
        part(() => b.prism(TOE, x0, x1, { role: role('toe', k), bevel: 0.007 }));
        part(() => b.prism([[w(-0.325), -ankleY + 0.004], [w(0.815), -ankleY + 0.004], [w(0.83), -ankleY + 0.026], [w(-0.345), -ankleY + 0.026]], x0 - 0.004, x1 + 0.004, { role: role('sole', k), bevel: 0.003 }));
      });
      m.at(M.mul(M.t(0, -ankleY + w(0.12), w(0.12)), ALONG_X), (b) => b.cyl(w(0.12), x0 + 0.01, x1 - 0.01, { role: ROLE.rubber, n: 22, bevel: 0.004, wear: false }));
      // a long sunk slot down the top of the toe
      const [tm, tlen] = face(TOE[2], TOE[3], false, xc);
      K.at(tm, () => {
        const hwd = w(0.07), v0 = tlen * 0.16, v1 = tlen * 0.86;
        m.frame(PLANE, [-hwd - 0.007, hwd + 0.007, v0 - 0.007, v1 + 0.007], [-hwd, hwd, v0, v1], { h: 0.003, gap: 0, role: role('toe', 2), rad: 0.007, holeRad: 0.005, holeDrop: 0.012, drop: 0.0035, bevel: 0.001, seed: rnd(), solid: true });
        m.panel(PLANE, -hwd, hwd, v0, v1, { h: -0.009, gap: 0, rad: 0.005, role: ROLE.dark, wall: null, edge: false });
        for (let j = 0; j < 4; j++) { const v = v0 + ((v1 - v0) * (j + 0.5)) / 4; m.panel(PLANE, -hwd + 0.003, hwd - 0.003, v - 0.006, v + 0.006, { h: -0.004, gap: 0, rad: 0.002, role: ROLE.steel, wall: { out: 0.0005, dh: -0.005 } }); }
      });
      // the hub ring on the toe's outer cheek
      m.at(M.mul(M.t(outer, w(-0.27), w(-0.03)), M.ry((k * PI) / 2)), (b) => {
        b.cyl(w(0.15), -0.002, 0.008, { role: ROLE.steel, n: 24, bevel: 0.003 });
        b.cyl(w(0.105), 0.006, 0.014, { role: role('hub'), n: 20, bevel: 0.003 });
        b.cyl(w(0.04), 0.012, 0.018, { role: ROLE.metal, n: 12, bevel: 0.0015 });
      });
    }
    // the bridge behind the ankle block that ties the toes together
    m.at(OUT, (b) => part(() => b.prism([[w(-0.33), -ankleY + 0.03], [w(-0.2), -ankleY + 0.03], [w(-0.2), w(-0.3)], [w(-0.33), w(-0.26)]], xLeg - w(0.1), xLeg + w(0.1), { role: ROLE.steel, bevel: 0.004 })));
  });
}

/* ---------------- the head: a flat disc on a ball neck. Built round the ball's centre. ---------------- */
// one large eye at the end of its barrel: a bezel, a dark well, lit rings behind a clear face
function bigEye(K, mat, r, rgb) {
  const m = K.main, mix = (t) => rgb.map((v) => v + (1 - v) * t);
  K.at(M.mul(mat, DOWN), () => {   // local y runs out of the face
    m.lathe([[r, 0.002], [r * 0.95, -r * 0.2], [0, -r * 0.2]], { role: ROLE.dark, wear: false, segs: 36 });
    const ring = (ro, ri, y, t, k = 1) => { K.glow.color = mix(t).map((v) => v * k); K.glow.lathe([[ro, y], [ri, y]], { segs: 36, wear: false }); };
    ring(r * 0.9, r * 0.82, -r * 0.18, 0.0, 0.45); ring(r * 0.74, r * 0.44, -r * 0.16, 0.08, 0.9); ring(r * 0.36, r * 0.2, -r * 0.13, 0.35); ring(r * 0.13, 0, -r * 0.11, 0.75);
    // the iris: fine dark blades across the bright ring, and a steel ring between the lit ones
    for (let k = 0; k < 12; k++) m.at(M.mul(M.ry((k / 12) * 2 * PI), M.t(r * 0.59, -r * 0.15, 0)), (b) => b.box(r * 0.3, 0.0012, r * 0.022, { role: ROLE.dark, bevel: 0, wear: false }));
    m.lathe([[r * 0.41, -r * 0.125], [r * 0.39, -r * 0.115], [r * 0.37, -r * 0.125]], { role: ROLE.steel, segs: 30, wear: false });
  });
  const p = new THREE.Vector3(0, 0, 0.012).applyMatrix4(mat), n = new THREE.Vector3(0, 0, 1).transformDirection(mat);
  K.halo([p.x, p.y, p.z], [n.x, n.y, n.z], rgb, r * 4.2);
}
function buildHead(K, state, scheme, rnd, on) {
  const m = K.main, R = T3.headR, eye = state.eyeRGB || [1, 0.6, 0.1];
  const role = (tag, at = {}) => scheme.role(tag, { part: 'head', x: 9, ...at });
  const part = (fn) => { m.seed = rnd(); fn(); m.seed = 0; };
  const y0 = w(0.25), yg0 = w(0.45), yg1 = w(0.488), ys = w(0.665), yt = w(0.765), Rl = w(0.985), Rt = w(0.865);
  // the neck: a ball in the body's collar, two rings, a flange under the disc
  m.lathe([[w(0.3) * cos(rad(-35)), w(0.3) * sin(rad(-35))], ...Array.from({ length: 9 }, (_, i) => { const e = rad(-35 + (i + 1) * 12); return [w(0.3) * cos(e), w(0.3) * sin(e)]; })], { role: ROLE.rubber, smooth: true, wear: false, segs: 36 });
  m.lathe([[w(0.3), w(0.085)], [w(0.36), w(0.085)], [w(0.36), w(0.125)], [w(0.31), w(0.125)], [w(0.31), w(0.16)], [w(0.385), w(0.16)], [w(0.385), w(0.205)], [w(0.33), w(0.205)], [w(0.33), y0 + 0.002]], { role: ROLE.steel, segs: 40 });
  // what shows in the gaps, and the underside
  m.lathe([[w(0.955), y0 + 0.004], [Rl - 0.006, y0 + w(0.03)], [Rl - 0.006, yg0], [w(0.925), yg0], [w(0.925), yg1], [R - 0.006, yg1], [R - 0.006, ys], [Rt - 0.004, yt - 0.006], [0, yt - 0.006]], { role: ROLE.dark, wear: false, segs: 64 });
  m.lathe([[w(0.33), y0], [w(0.5), y0], [w(0.5), y0 - 0.006], [w(0.62), y0 - 0.006], [w(0.62), y0], [w(0.95), y0], [w(0.975), y0 + w(0.022)]], { role: ROLE.steel, segs: 64 });
  // the lower band: twelve panels, the upper band and its chamfer: ten, each a little different
  const lo = turned(profile.cyl(Rl, y0 + w(0.026)), { deg: 6 }), hi = turned(profile.cyl(R, yg1), { deg: 6 });
  const cone = profile.cone(R, ys, Rt, yt), ch = turned(cone, { uvR: R, deg: 6 }), top = turned(profile.top(yt, Rt), { uvR: R, deg: 7.5 });
  const flag = () => (rnd() < 0.1 ? FLAG.odd : 0), xAt = (u0, u1) => ({ x: R * sin((u0 + u1) / 2), i: 0 });
  const lows = [34, 26, 30, 30, 30, 30, 30, 30, 30, 30, 26, 34];
  let u = -180;
  for (const d of lows) { const a0 = rad(u), a1 = rad(u + d); m.panel(lo, a0, a1, 0, yg0 - y0 - w(0.026), { role: role('rimlo', xAt(a0, a1)), rad: 0.005, seed: rnd(), flag: flag() }); u += d; }
  const his = [40, 32, 36, 36, 36, 36, 36, 36, 32, 40];
  u = -180;
  for (const d of his) {
    const a0 = rad(u), a1 = rad(u + d), at = xAt(a0, a1), f = flag(), sd = rnd();
    m.panel(hi, a0, a1, 0, ys - yg1, { role: role('rimhi', at), rad: 0.005, seed: sd, flag: f });
    m.panel(ch, a0, a1, 0, cone.len, { role: role('rimhi', at), rad: 0.005, seed: sd, flag: f });
    u += d;
  }
  // the top: a ring of plates, an inner ring, a cap
  u = -180;
  for (const d of [45, 45, 45, 45, 45, 45, 45, 45]) { const a0 = rad(u), a1 = rad(u + d); m.panel(top, a0, a1, 0, w(0.3), { role: role('crown', xAt(a0, a1)), rad: 0.006, seed: rnd(), flag: flag() }); u += d; }
  u = -180;
  for (const d of [90, 90, 90, 90]) { const a0 = rad(u + 45), a1 = rad(u + d + 45); m.panel(top, a0, a1, w(0.3), w(0.68), { role: role('crown', { x: 9, i: 1 }), rad: 0.006, seed: rnd(), flag: flag() }); u += d; }
  m.lathe([[w(0.19), yt - 0.004], [w(0.19), yt + 0.006], [w(0.16), yt + 0.012], [w(0.07), yt + 0.012], [w(0.07), yt + 0.007], [0, yt + 0.007]], { role: role('cap'), segs: 32 });
  // the eye: a ribbed barrel lying along the top from the centre to the rim and out past it, a saddle plate over
  // its back half, a heavy bezel
  const ye = w(0.55), rB = w(0.265), z0 = w(0.2), z1 = w(1.03), rL = rB * 0.84;
  m.at(M.t(0, ye, 0), (b) => {
    b.cyl(rB, z0, z1 - w(0.022), { role: ROLE.dark, n: 32, bevel: 0.006 });
    for (let k = 0; k < 5; k++) { const z = w(0.6) + k * w(0.074); b.cyl(rB + 0.0035, z, z + w(0.04), { role: ROLE.steel, n: 32, bevel: 0.002 }); }
  });
  K.at(M.mul(M.t(0, ye, 0), DOWN), () => {   // local y runs forward along the barrel
    const R2 = rB + w(0.055);
    part(() => m.lathe([[rB - 0.002, z1 - w(0.03)], [R2, z1 - w(0.03)], [R2, z1 + w(0.09)], [R2 - w(0.03), z1 + w(0.125)], [rL + 0.005, z1 + w(0.125)], [rL, z1 + w(0.108)], [rL, z1 + w(0.028)]], { role: role('eye'), segs: 40 }));
    m.lathe([[R2 + 0.003, z1 + w(0.012)], [R2 + 0.003, z1 + w(0.04)], [R2 - 0.001, z1 + w(0.04)]], { role: ROLE.steel, segs: 40 });
  });
  bigEye(K, M.t(0, ye, z1 + w(0.03)), rL, eye);
  // the saddle, and the plate on it (which lifts on a post to show a blaster when one is fitted)
  const saddle = []; for (let i = 0; i <= 12; i++) { const a = rad(12 + 156 * (i / 12)); saddle.push([(rB + 0.01) * cos(a), (rB + 0.01) * sin(a)]); }
  m.at(M.t(0, ye, 0), (b) => part(() => b.prism([...saddle, [-(rB + 0.01) * cos(rad(12)), -rB * 0.2], [(rB + 0.01) * cos(rad(12)), -rB * 0.2]], w(0.12), w(0.52), { role: role('cowl', { x: 0 }), bevel: 0.004 })));
  const lift = on.has('blaster'), py = ye + rB + 0.01 + (lift ? w(0.3) : 0.003), pz = w(0.32);   // (T3_MUZZLE follows these)
  m.at(M.mul(M.t(0, py, pz), UP), (b) => part(() => b.prism(rrect(w(0.46), w(0.34), 0.008, 3), 0, 0.009, { role: role('cowl', { x: 0, i: 1 }), bevel: 0.003 })));
  if (lift) {
    rod(m, [0, ye + rB, pz - w(0.08)], [0, py + 0.002, pz - w(0.08)], 0.0095, ROLE.steel);
    m.at(M.t(0, ye + rB + 0.012, pz - w(0.08)), (b) => b.box(0.05, 0.02, 0.04, { role: ROLE.steel, rad: 0.004, bevel: 0.003 }));
    m.at(M.t(0, py - 0.03, pz - w(0.02)), (b) => {   // the blaster slung under the plate
      b.box(0.034, 0.03, 0.07, { role: ROLE.dark, rad: 0.006, bevel: 0.003 });
      b.cyl(0.0085, 0.03, 0.12, { role: ROLE.steel, n: 12, bevel: 0.0015 });
      b.cyl(0.0125, 0.104, 0.124, { role: ROLE.dark, n: 12, bevel: 0.002 });
      b.at(M.t(0, -0.012, 0.02), (q) => q.cyl(0.0052, 0, 0.06, { role: ROLE.brass, n: 8, bevel: 0.001 }));
    });
    K.glow.color = [1, 0.3, 0.15]; K.glow.at(M.t(0, py - 0.03, pz - w(0.02) + 0.1245), (b) => b.cyl(0.006, 0, 0.001, { n: 10, bevel: 0 }));
  }
  // a chin block under the barrel
  m.at(M.t(0, y0 - w(0.055), w(0.7)), (b) => b.box(w(0.36), w(0.11), w(0.3), { role: ROLE.dark, rad: 0.006, bevel: 0.004 }));
  // two small lights on the groove, round on its left; a vent slot and a socket on its right; a box at the back
  const seat = (deg, y, Rr) => M.mul(M.ry(rad(deg)), M.t(0, y, Rr));
  const yl = (yg0 + yg1) / 2;
  for (const [deg, r, col] of [[35, 0.021, [0.75, 0.9, 1.0]], [58, 0.03, eye]]) {
    m.at(seat(deg, yl, R - 0.012), (b) => b.prism(ngon(r * 1.75, 8, PI / 8), 0, 0.016, { role: ROLE.dark, bevel: 0.003 }));
    lens(K, seat(deg, yl, R + 0.004), r, col, { h: 0.004, halo: 3.2 });
  }
  K.at(seat(-47, y0 + w(0.115), Rl - 0.002), () => {
    m.frame(PLANE, [-0.05, 0.05, -0.016, 0.016], [-0.042, 0.042, -0.009, 0.009], { h: 0.004, gap: 0, role: ROLE.steel, rad: 0.006, holeRad: 0.004, holeDrop: 0.008, drop: 0.004, bevel: 0.001 });
    m.panel(PLANE, -0.042, 0.042, -0.009, 0.009, { h: -0.004, gap: 0, rad: 0.004, role: ROLE.dark, wall: null, edge: false });
  });
  m.at(seat(180, yl, R - 0.014), (b) => b.box(0.07, 0.05, 0.05, { role: ROLE.steel, rad: 0.006, bevel: 0.004 }));
  m.at(seat(-76, yl, R - 0.008), (b) => { b.cyl(0.017, 0, 0.012, { role: ROLE.steel, n: 14, bevel: 0.002 }); b.cyl(0.009, 0.012, 0.016, { role: ROLE.brass, n: 10, bevel: 0.001 }); });
  // on the top: a small hatch with its fasteners, three cooling slots, a sensor stud
  m.panel(top, rad(-128), rad(-98), w(0.07), w(0.25), { h: 0.0016, gap: 0, rad: 0.004, role: role('crown', { x: 9, i: 2 }), drop: 0.0018, bevel: 0.001, seed: rnd() });
  for (const d of [-124, -102]) m.at(M.mul(M.ry(rad(d)), M.t(0, yt + 0.0016, Rt - w(0.2)), UP), (b) => b.cyl(0.0036, 0, 0.002, { role: ROLE.metal, n: 8, bevel: 0.0007 }));
  for (let k = 0; k < 3; k++) m.panel(top, rad(118 + k * 9), rad(124 + k * 9), w(0.36), w(0.6), { h: 0.0006, gap: 0, rad: 0.003, role: ROLE.dark, wall: null, edge: false });
  m.at(M.mul(M.t(w(-0.46), yt, w(0.3)), UP), (b) => { b.cyl(0.021, -0.002, 0.007, { role: ROLE.steel, n: 16, bevel: 0.002 }); b.cyl(0.014, 0.007, 0.012, { role: ROLE.dark, n: 14, bevel: 0.002 }); });
  lens(K, M.mul(M.t(w(-0.46), yt + 0.012, w(0.3)), UP), 0.0095, [0.6, 0.85, 1.0], { h: 0.003, halo: 2.4 });
  if (on.has('antenna')) antennaAt(K, [w(0.5), yt, w(-0.6)], 0.21);
}

// where a fitted blaster's bolt leaves it: the muzzle, in the head's own frame (buildHead's ye, rB, py, pz), pointing +z
export const T3_MUZZLE = [0, w(0.55) + w(0.265) + 0.01 + w(0.3) - 0.03, w(0.32) - w(0.02) + 0.124];

/* ---------------- the whole unit ---------------- */
// state: { layout, scheme, seed, eyeRGB, ... }; on: the attachments fitted. Returns the pieces as kits, by name.
export function buildT3(state, on = new Set()) {
  const scheme = T3_SCHEMES[state.scheme] || T3_SCHEMES.service, lay = T3_LAYOUTS[state.layout] || T3_LAYOUTS.standard, rnd = rng(state.seed || 1);
  const kits = { body: new Kit(), rear: new Kit(), head: new Kit(), legL: new Kit(), legR: new Kit(), footL: new Kit(), footR: new Kit() };
  buildBody(kits.body, state, scheme, rnd, on, lay);
  buildRear(kits.rear, scheme, rnd);
  buildHead(kits.head, state, scheme, rnd, on);
  buildLeg(kits.legL, 1, scheme, rnd); buildLeg(kits.legR, -1, scheme, rnd);
  buildFoot(kits.footL, 1, scheme, rnd); buildFoot(kits.footR, -1, scheme, rnd);
  return kits;
}

// Place the pieces. t: -1 crouched, 0 standing level, 1 raised; look: -1 to 1 turns the head.
// The stance has one freedom: how high the shoulders are. The body tips about the rear axle to reach it, the legs
// swing at the shoulders to keep the feet down, and the feet roll in or out. The head's ball joint keeps it level.
export function poseT3(g, t = 0, look = 0) {
  const { S, L, axleY, ankleY, lean0 } = T3, lean = lean0 - rad(t > 0 ? 13 * t : 12 * t);
  const sy = axleY + S * cos(lean), rake = acos(max(-1, min(1, (sy - ankleY) / L)));
  const span = S * sin(lean) + L * sin(rake), za = -w(0.13) - span / 2, sz = za + S * sin(lean), d = lean - lean0;
  g.rear.position.set(0, axleY, za);
  g.body.position.set(0, axleY, za); g.body.rotation.set(d, 0, 0);
  for (const [leg, foot] of [[g.legL, g.footL], [g.legR, g.footR]]) {
    leg.position.set(0, sy, sz); leg.rotation.set(-rake, 0, 0);
    foot.position.set(0, ankleY, sz + L * sin(rake));
  }
  const hy = axleY + NECK[1] * cos(d) - NECK[0] * sin(d), hz = za + NECK[1] * sin(d) + NECK[0] * cos(d);
  g.head.position.set(0, hy, hz); g.head.rotation.set(d * 0.3, (look || 0) * rad(38), 0);
  return { head: [0, hy, hz] };
}
