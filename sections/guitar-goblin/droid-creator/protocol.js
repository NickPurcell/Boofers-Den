// The protocol frame: a slim, plated humanoid about 1.72 m tall. The type is from a study of many such droids (a
// rounded mask of a head with round lit eyes or a visor, a plated chest with a round boss, a bare midriff of cables,
// limbs as plated tubes with open joints); this one's plating, face and fittings are our own.
// It is built of the same panels as the others, wrapped round turned shapes: a dark core with shells over it, so every
// plate has a real seam.
import * as THREE from 'three';
import { Kit, ROLE, M, rad, turned, profile, PLANE, rrect, ngon, rng, context } from './hard.js';
import { SCHEMES } from './layout.js';
import { lens } from './domes.js';
import { KINDS } from './utility.js';

const { PI, sin, cos } = Math;
export const BODY = { shoulder: [0.226, 1.385, 0], hip: [0.096, 0.92, 0], knee: [0.1, 0.5, 0.012], ankle: [0.102, 0.085, -0.008], neck: 1.482, upper: 0.275, fore: 0.25, flat: 0.68 };
const UP = M.rx(-PI / 2);   // local z up, local y toward the back
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// a frame for a limb running from `low` up to `high`: local y along it, local z as near to the front as it can be
function limbFrame(low, high) {
  const y = new THREE.Vector3(high[0] - low[0], high[1] - low[1], high[2] - low[2]), len = y.length(); y.normalize();
  const z = new THREE.Vector3(0, 0, 1); z.addScaledVector(y, -z.dot(y)).normalize();
  return [new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z).setPosition(low[0], low[1], low[2]), len];
}
// one plated length of limb, from y = 0 up to len in the frame it is made in: a dark core, a front shell and a back
// shell with seams down the sides
function plated(K, len, r0, r1, front, back, rnd, o = {}) {
  const m = K.main, e = o.end ?? 0.012, cone = profile.cone(r0, e, r1, len - e), map = turned(cone, { deg: 12, uvR: 0.05 });
  m.lathe([[r0 - 0.008, 0.002], [r1 - 0.008, len - 0.002]], { role: ROLE.dark, wear: false, segs: 18 });
  m.panel(map, rad(-(o.split ?? 96)), rad(o.split ?? 96), 0, cone.len, { role: front, rad: 0.009, seed: rnd(), h: o.h ?? 0 });
  m.panel(map, rad(o.split ?? 96), rad(360 - (o.split ?? 96)), 0, cone.len, { role: back, rad: 0.009, seed: rnd() });
  return map;
}
// an open joint: a short axle across the limb with a brass washer each side
function joint(b, r, w) {
  b.at(M.ry(PI / 2), (q) => { q.cyl(r, -w / 2, w / 2, { role: ROLE.steel, n: 18, bevel: 0.003 }); for (const s of [-1, 1]) q.cyl(r * 0.62, s > 0 ? w / 2 : -w / 2 - 0.004, s > 0 ? w / 2 + 0.004 : -w / 2, { role: ROLE.brass, n: 14, bevel: 0.001 }); });
}

/* ---------------- the head ---------------- */
function head(K, state, scheme, rnd) {
  const m = K.main, eye = state.eyeRGB, S = M.s(1.05, 1.1, 1.19), role = (t, i = 0) => scheme.role(t, { deg: 0, i });
  const pf = profile.path([[0.036, 0], [0.056, 0.012], [0.074, 0.045], [0.0845, 0.095], [0.086, 0.13], [0.08, 0.168], [0.063, 0.2], [0.036, 0.218], [0.003, 0.2245]]);
  K.at(S, () => {
    const map = turned(pf, { deg: 8, stepV: 0.013, uvR: 0.086 }), c = context(K, map, scheme, rnd), y = (v) => pf.sAt(v);
    m.lathe(pf.pts.map(([r, v]) => [Math.max(r - 0.006, 0.001), v]), { role: ROLE.dark, wear: false, smooth: true, segs: 28 });
    // the skull: a shell each side and one behind, a cap on top with a crest running over it
    m.panel(map, rad(56), rad(124), y(0.012), y(0.19), { role: role('domeskin', 0), rad: 0.01, seed: rnd() });
    m.panel(map, rad(-124), rad(-56), y(0.012), y(0.19), { role: role('domeskin', 1), rad: 0.01, seed: rnd() });
    m.panel(map, rad(124), rad(236), y(0.012), y(0.19), { role: role('domeskin', 2), rad: 0.01, seed: rnd() });
    const cap = [[pf(y(0.194))[0] - 0.003, 0.189]];
    for (let i = 0; i <= 8; i++) { const [r, v] = pf(y(0.194) + ((pf.len - y(0.194)) * i) / 8); cap.push([i === 8 ? 0 : r, v + 0.0003]); }
    m.lathe(cap, { role: role('crown', 0), smooth: cap.map((_, i) => i > 1), segs: 36 });
    m.panel(map, rad(-7), rad(7), y(0.172), pf.len - 0.012, { h: 0.005, gap: 0, rad: 0.005, role: role('crown', 1), wall: { out: 0.002, dh: -0.0052 }, seed: rnd() });
    // the face: a mask plate with a mouth slot and a ridge down the middle
    m.panel(map, rad(-56), rad(56), y(0.014), y(0.166), { h: 0.0032, role: role('face'), rad: 0.014, seed: rnd(), drop: 0.008 });
    m.panel(map, rad(-56), rad(56), y(0.166), y(0.19), { role: role('domeskin', 3), rad: 0.008, seed: rnd() });   // the forehead
    const mouth = [rad(-13), rad(13), y(0.042), y(0.058)], q = 0.0032, su = map.su((mouth[2] + mouth[3]) / 2), slot = [mouth[0] + q / su, mouth[1] - q / su, mouth[2] + q, mouth[3] - q];
    m.frame(map, mouth, slot, { h: 0.0062, gap: 0, role: ROLE.steel, rad: 0.004, holeRad: 0.002, holeDrop: 0.003, wall: { out: 0.001, dh: -0.0032 } });
    m.panel(map, slot[0], slot[1], slot[2], slot[3], { h: 0.0036, gap: 0, rad: 0.002, role: ROLE.dark, wall: null, edge: false });
    m.panel(map, rad(-2.4), rad(2.4), y(0.068), y(0.104), { h: 0.0058, gap: 0, rad: 0.002, role: role('face'), wall: { out: 0.0015, dh: -0.0028 }, seed: rnd() });
    if (state.form === 'visor') {
      // one band of dark glass with a lit line behind it
      const vo = [rad(-62), rad(62), y(0.099), y(0.143)], vi = [rad(-55), rad(55), y(0.106), y(0.136)];
      m.frame(map, vo, vi, { h: 0.0075, gap: 0, role: role('crown', 0), rad: 0.012, holeRad: 0.008, holeDrop: 0.004, wall: { out: 0.002, dh: -0.0046 }, seed: rnd() });
      K.glass.panel(map, vi[0], vi[1], vi[2], vi[3], { h: 0.0042, gap: 0, rad: 0.008, wall: null, edge: false });
      K.glow.color = eye;
      K.glow.panel(map, rad(-44), rad(44), y(0.1185), y(0.1235), { h: 0.0048, gap: 0, rad: 0.002, wall: null, edge: false });
      for (const a of [-24, 24]) c.halo([rad(a), rad(a), y(0.121), y(0.121)], eye, 0.075);
    } else {
      // two round eyes under a brow
      m.panel(map, rad(-50), rad(50), y(0.1415), y(0.156), { h: 0.0068, gap: 0, rad: 0.006, role: role('crown', 0), wall: { out: 0.002, dh: -0.0038 }, seed: rnd() });
      for (const a of [-23.5, 23.5]) lens(K, c.seat(rad(a), y(0.117), 0.0028), 0.0205, eye, { h: 0.0052, halo: 3.1 });
    }
    // an ear each side
    for (const a of [-90, 90]) m.at(c.seat(rad(a), y(0.108), 0), (b) => { b.cyl(0.027, -0.006, 0.01, { role: ROLE.steel, n: 20, bevel: 0.003 }); b.cyl(0.017, 0.01, 0.015, { role: ROLE.brass, n: 16, bevel: 0.002 }); b.cyl(0.007, 0.015, 0.019, { role: ROLE.dark, n: 10, bevel: 0.001 }); });
    if (state.comm) {   // a comlink aerial on one ear
      m.at(M.mul(c.seat(rad(-90), y(0.108), 0.012), M.rx(-PI / 2)), (b) => b.loft([{ o: ngon(0.003, 8), z: 0 }, { o: ngon(0.0016, 8), z: 0.13 }], { role: ROLE.metal, wear: false }));
      const [p] = c.point(rad(-90), y(0.108), 0.012);
      K.glow.color = [1, 0.25, 0.12]; K.glow.at(M.t(p[0], p[1] + 0.133, p[2]), (b) => b.ball(0.0036, { n: 6, segs: 8 }));
      K.halo([p[0], p[1] + 0.133, p[2]], [0, 0, 0], [1, 0.25, 0.12], 0.04);
    }
  });
}

/* ---------------- the trunk and legs ---------------- */
function trunk(K, state, scheme, rnd, spare) {
  const m = K.main, S = M.s(1, 1, BODY.flat), role = (t, i = 0, deg = 0) => scheme.role(t, { deg, i });
  // the chest: plates wrapped round a flattened barrel, with a round boss on the breastbone
  const pf = profile.path([[0.108, 1.13], [0.134, 1.158], [0.163, 1.24], [0.181, 1.33], [0.179, 1.385], [0.153, 1.424], [0.09, 1.442], [0.05, 1.444]]);
  K.at(S, () => {
    const map = turned(pf, { deg: 6, stepV: 0.02, uvR: 0.18 }), c = context(K, map, scheme, rnd), y = (v) => pf.sAt(v);
    m.lathe(pf.pts.map(([r, v]) => [Math.max(r - 0.008, 0.001), v]), { role: ROLE.dark, wear: false, smooth: true, segs: 40 });
    const lo = y(1.134), hi = y(1.392), top = pf.len - 0.006;
    const plates = [[-30, 30, 'trim'], [30, 92, 'skin'], [92, 128, 'side'], [128, 162, 'skin'], [-162, -128, 'skin'], [-128, -92, 'side'], [-92, -30, 'skin']];
    plates.forEach(([a, b, tag], i) => m.panel(map, rad(a), rad(b), lo, hi, { role: role(tag, i, (a + b) / 2), rad: 0.012, seed: rnd(), flag: tag === 'skin' && rnd() < 0.2 ? 1 : 0 }));
    // down the spine: a plate, a cooling grille, a plate
    m.panel(map, rad(162), rad(198), y(1.318), hi, { role: role('rim', 9, 180), rad: 0.008, seed: rnd() });
    KINDS.grille(c, [rad(162), rad(198), y(1.225), y(1.318)], { slats: 6 }, { deg: 180, i: 0 });
    m.panel(map, rad(162), rad(198), lo, y(1.225), { role: role('rim', 9, 180), rad: 0.008, seed: rnd() });
    [[-45, 45], [45, 135], [135, 225], [225, 315]].forEach(([a, b], i) => m.panel(map, rad(a), rad(b), hi, top, { role: role('rim', i, a + 45), rad: 0.008, seed: rnd() }));
    const boss = (r0, r1, h, rl) => { const v = y(1.3), su = map.su(v); m.frame(map, [-r0 / su, r0 / su, v - r0, v + r0], [-r1 / su, r1 / su, v - r1, v + r1], { h, gap: 0, role: rl, rad: 1, holeRad: 1, holeDrop: h * 0.8, wall: { out: 0.0015, dh: -h }, cornerSegs: 6 }); };
    boss(0.037, 0.029, 0.004, ROLE.steel); boss(0.023, 0.016, 0.0055, ROLE.brass);
    { const v = y(1.3), su = map.su(v), r = 0.009; m.panel(map, -r / su, r / su, v - r, v + r, { h: 0.007, gap: 0, rad: 1, role: ROLE.metal, wall: { out: 0.0015, dh: -0.007 } }); }
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) m.panel(map, rad(sx * 17 - 6), rad(sx * 17 + 6), y(1.168 + k * 0.022), y(1.182 + k * 0.022), { h: 0.0022, gap: 0, rad: 0.003, role: ROLE.steel, drop: 0.0025, bevel: 0.0008 });
    if (state.bolt) K.bolt = M.mul(S, c.seat(rad(-21), y(1.36), 0));
  });
  // the neck: a dark column, a brass collar and four thin rods
  m.at(M.mul(M.t(0, 1.43, 0), UP), (b) => {
    b.cyl(0.034, 0, 0.07, { role: ROLE.dark, n: 18, bevel: 0 }); b.cyl(0.05, 0.008, 0.02, { role: ROLE.brass, n: 22, bevel: 0.003 }); b.cyl(0.041, 0.04, 0.052, { role: ROLE.steel, n: 20, bevel: 0.002 });
    for (let k = 0; k < 4; k++) { const a = (k / 4) * 2 * PI + PI / 4; b.at(M.t(0.039 * cos(a), 0.039 * sin(a), 0), (q) => q.cyl(0.0048, 0.015, 0.064, { role: ROLE.metal, n: 8, bevel: 0.0005 })); }
  });
  // the midriff: cables round a dark column, between two rings
  m.at(M.mul(S, M.t(0, 1.02, 0), UP), (b) => {
    b.cyl(0.078, 0, 0.125, { role: ROLE.dark, n: 24, bevel: 0 }); b.cyl(0.104, 0.004, 0.018, { role: ROLE.steel, n: 30, bevel: 0.003 }); b.cyl(0.1, 0.1, 0.113, { role: ROLE.steel, n: 30, bevel: 0.003 });
    const kinds = [[ROLE.rubber, 0.0062], [ROLE.brass, 0.0045], [ROLE.rubber, 0.005], [ROLE.secondary, 0.0045], [ROLE.steel, 0.0038]];
    for (let k = 0; k < 18; k++) { const a = (k / 18) * 2 * PI + 0.1, [rl, rr] = kinds[k % kinds.length], r = 0.086, w = 0.006 * sin(k * 2.3); b.tube([[r * cos(a), r * sin(a), 0.012], [(r + 0.004) * cos(a + w * 3), (r + 0.004) * sin(a + w * 3), 0.058], [r * cos(a), r * sin(a), 0.106]], rr, { role: rl, sides: 6, n: 6 }); }
  });
  // the pelvis
  const pp = profile.path([[0.064, 0.892], [0.116, 0.914], [0.143, 0.958], [0.142, 1.0], [0.118, 1.026], [0.084, 1.034]]);
  K.at(S, () => {
    const map = turned(pp, { deg: 7, stepV: 0.02, uvR: 0.134 }), y = (v) => pp.sAt(v);
    m.lathe([[0.001, 0.894], ...pp.pts.map(([r, v]) => [Math.max(r - 0.008, 0.001), v])], { role: ROLE.dark, wear: false, smooth: true, segs: 36 });
    [[-36, 36, 'trim'], [36, 144, 'skin'], [144, 216, 'rim'], [216, 324, 'skin']].forEach(([a, b, tag], i) => m.panel(map, rad(a), rad(b), y(0.9), pp.len - 0.004, { role: role(tag, i, (a + b) / 2), rad: 0.012, seed: rnd() }));
  });
  // the legs: hip ball, plated thigh, open knee, plated shin with a guard, ankle, foot
  for (const side of [1, -1]) {
    const P = (p) => [p[0] * side, p[1], p[2]], hip = P(BODY.hip), knee = P(BODY.knee), ankle = P(BODY.ankle);
    const odd = spare && side === -1, rl = (t) => (odd ? ROLE.metal : role(t, 0, side * 90));
    m.at(M.t(...hip), (b) => b.ball(0.058, { role: ROLE.steel, n: 8, segs: 16 }));
    const [mt, lt] = limbFrame(knee, hip); m.at(mt, () => plated(K, lt, 0.056, 0.075, rl('legskin'), rl('legskin'), rnd, { end: 0.04 }));
    m.at(M.t(...knee), (b) => { joint(b, 0.044, 0.1); b.at(M.t(0, 0.004, 0.042), (q) => q.box(0.08, 0.078, 0.022, { role: rl('hub'), rad: 0.024, bevel: 0.005 })); });
    const [ms, ls] = limbFrame(ankle, knee); m.at(ms, () => {
      const map = plated(K, ls, 0.04, 0.06, rl('legskin'), rl('legskin'), rnd, { end: 0.034 });
      m.panel(map, rad(-52), rad(52), 0.05, ls - 0.1, { h: 0.0045, gap: 0, rad: 0.014, role: rl('strut'), wall: { out: 0.002, dh: -0.0047 }, seed: rnd() });   // the shin guard
    });
    m.at(M.t(...ankle), (b) => joint(b, 0.033, 0.08));
    m.at(M.mul(M.t(ankle[0], 0, ankle[2] + 0.04), UP), (b) => {
      const Sx = (wx, ly, z, cy) => ({ o: rrect(wx, ly, 0.028, 4, 0, cy), z });
      b.loft([Sx(0.1, 0.254, 0, 0), Sx(0.106, 0.26, 0.004, 0), Sx(0.106, 0.26, 0.018, 0), Sx(0.094, 0.218, 0.05, 0.012), Sx(0.074, 0.128, 0.074, 0.04), Sx(0.066, 0.116, 0.078, 0.04)], { role: rl('footskin') });
      b.prism(rrect(0.108, 0.05, 0.02, 3, 0, -0.105), 0.002, 0.03, { role: ROLE.steel, bevel: 0.004 });
    });
  }
}

/* ---------------- the arms ---------------- */
// the upper arm, hanging from the shoulder at the origin
function upperArm(K, side, scheme, rnd) {
  const m = K.main, role = (t) => scheme.role(t, { deg: side * 90, i: 0 }), L = BODY.upper;
  m.push(M.s(side, 1, 1));
  m.ball(0.062, { role: ROLE.steel, n: 8, segs: 16 });
  // a cap over the shoulder
  const sp = profile.sphere(0.069, 0), smap = turned(sp, { deg: 10, stepV: 0.012, uvR: 0.069 });
  m.at(M.rz(-0.5), (b) => { b.panel(smap, rad(-180), rad(0), 0.069 * rad(-8), sp.len - 0.004, { role: role('shoulder'), rad: 0.012, seed: rnd() }); b.panel(smap, rad(0), rad(180), 0.069 * rad(-8), sp.len - 0.004, { role: role('shoulder'), rad: 0.012, seed: rnd() }); });
  m.at(M.t(0, -L, 0), () => plated(K, L, 0.04, 0.052, role('legskin'), role('legskin'), rnd, { end: 0.034 }));
  m.at(M.t(0, -L, 0), (b) => joint(b, 0.035, 0.074));
  m.pop();
}
// the forearm and hand, hanging from the elbow at the origin
function foreArm(K, side, scheme, rnd, open) {
  const m = K.main, role = (t) => scheme.role(t, { deg: side * 90, i: 0 }), L = BODY.fore;
  m.push(M.s(side, 1, 1));
  m.at(M.t(0, -L, 0), () => {
    const map = plated(K, L, 0.032, 0.045, role('legskin'), role('legskin'), rnd, { end: 0.026 });
    m.panel(map, rad(40), rad(140), 0.03, L - 0.07, { h: 0.004, gap: 0, rad: 0.012, role: role('strut'), wall: { out: 0.002, dh: -0.0042 }, seed: rnd() });   // a guard on the outside
  });
  // a piston along the inside of the forearm
  m.at(M.mul(M.t(-0.038, -L + 0.03, -0.012), UP), (b) => { b.cyl(0.0075, 0, 0.1, { role: ROLE.steel, n: 10, bevel: 0.001 }); b.cyl(0.0042, 0.1, 0.185, { role: ROLE.metal, n: 8, bevel: 0.0005 }); });
  m.at(M.mul(M.t(0, -L, 0), UP), (b) => b.cyl(0.033, -0.012, 0.006, { role: ROLE.steel, n: 16, bevel: 0.003 }));   // the wrist
  // the hand: a palm facing the body, four fingers and a thumb
  m.at(M.t(0, -L - 0.052, 0), (b) => {
    b.box(0.022, 0.082, 0.072, { role: role('legskin'), rad: 0.007, bevel: 0.004 });
    const curl = open ? 0.12 : 0.42;
    for (let k = 0; k < 4; k++) b.at(M.mul(M.t(0, -0.041, 0.027 - k * 0.018), M.rz(-curl * (0.8 + k * 0.1))), (f) => {
      f.at(M.t(0, -0.021, 0), (g) => g.box(0.014, 0.042, 0.0145, { role: ROLE.steel, rad: 0.004, bevel: 0.002 }));
      f.at(M.mul(M.t(0, -0.043, 0), M.rz(-curl * 1.3)), (g) => { g.ball(0.0078, { role: ROLE.brass, n: 5, segs: 8 }); g.at(M.t(0, -0.018, 0), (h) => h.box(0.0125, 0.034, 0.013, { role: role('legskin'), rad: 0.004, bevel: 0.002 })); });
    });
    b.at(M.mul(M.t(-0.004, -0.008, 0.038), M.rx(0.75), M.rz(-0.3)), (f) => { f.at(M.t(0, -0.02, 0), (g) => g.box(0.014, 0.04, 0.015, { role: ROLE.steel, rad: 0.004, bevel: 0.002 })); f.at(M.mul(M.t(0, -0.042, 0), M.rz(-0.35)), (g) => g.at(M.t(0, -0.014, 0), (h) => h.box(0.0125, 0.028, 0.0135, { role: role('legskin'), rad: 0.004, bevel: 0.002 }))); });
  });
  m.pop();
}

export function buildProtocol(state, on) {
  const scheme = SCHEMES[state.scheme] || SCHEMES.solid, rnd = rng(state.seed || 1), st = { ...state, bolt: on.has('bolt'), comm: on.has('comm') };
  const kits = { body: new Kit(), head: new Kit(), armL: new Kit(), armR: new Kit(), foreL: new Kit(), foreR: new Kit() };
  trunk(kits.body, st, scheme, rnd, on.has('limb'));
  head(kits.head, st, scheme, rnd);
  upperArm(kits.armL, 1, scheme, rnd); upperArm(kits.armR, -1, scheme, rnd);
  foreArm(kits.foreL, 1, scheme, rnd, false); foreArm(kits.foreR, -1, scheme, rnd, true);
  return kits;
}
// a: { attend, greet, look }. At ease the arms hang a little bent; attending, both forearms come forward; greeting,
// the right hand goes up.
export function poseProtocol(g, a) {
  const ez = (t) => t * t * (3 - 2 * t), at = ez(a.attend || 0), gr = ez(a.greet || 0), [sx, sy] = BODY.shoulder;
  g.head.position.set(0, BODY.neck, 0); g.head.rotation.set(0.04 * at - 0.05 * gr, (a.look || 0) * rad(34), 0.05 * gr);
  g.armL.position.set(sx, sy, 0); g.armL.rotation.set(-0.08 - 0.22 * at, 0, 0.11 - 0.04 * at);
  g.foreL.position.set(0, -BODY.upper, 0); g.foreL.rotation.set(-0.3 - 1.12 * at, 0, 0);
  g.armR.position.set(-sx, sy, 0); g.armR.rotation.set(-0.08 - 0.22 * at - 0.5 * gr, 0, -(0.11 - 0.04 * at + 0.32 * gr));
  g.foreR.position.set(0, -BODY.upper, 0); g.foreR.rotation.set(-0.3 - 1.12 * at - 1.85 * gr, 0, 0);
  return {};
}
