// The power droid: a walking battery. Two stacked boxes with a belt between them, on two short legs with bellows
// and blocky feet; about a metre tall. The type is from a study of many such units (a squat box, a small face of
// sockets and lights, ribbed sides, heavy feet); this casing, its panels and its fittings are our own.
// It is panelled with the same layout trees and fittings as the utility droid's barrel, laid on flat faces.
import { Kit, ROLE, M, rad, turned, profile, PLANE, rrect, ngon, rng, context } from './hard.js';
import { SCHEMES, U, V, walk } from './layout.js';
import { KINDS } from './utility.js';
import { lens } from './domes.js';

const { PI } = Math;
export const BOX = { W: 0.5, D: 0.62, RC: 0.045, hip: 0.31, belt: 0.665, lid: 0.697, top: 0.955, legX: 0.125 };
const L = (kind, o = {}) => ({ kind, ...o });
const skin = (o) => L('skin', o), door = (o) => L('door', o), rim = () => L('skin', { tag: 'rim' });
const UP = M.rx(-PI / 2);   // local z up, local y toward the back

// two more fittings, for flat faces
const FITS = {
  ...KINDS,
  // heavy upright ribs on a plain panel
  ribs(c, r, leaf, at) {
    KINDS.skin(c, r, leaf, at);
    const [W, H] = c.size(r), n = leaf.n || 4, pitch = (W - 0.03) / n;
    for (let k = 0; k < n; k++) { const x = -W / 2 + 0.015 + pitch * (k + 0.5); c.K.main.panel(c.map, ...c.sub(r, x - pitch * 0.3, x + pitch * 0.3, -H / 2 + 0.016, H / 2 - 0.016), { h: 0.0065, gap: 0, rad: 0.005, role: c.role(leaf.tag || 'skin', at), wall: { out: 0.003, dh: -0.0068 }, seed: c.rnd() }); }
  },
  // the face: a recessed instrument panel with one photoreceptor, two sockets and a row of lights
  face(c, r, leaf, at) {
    const [W, H] = c.size(r), m = c.K.main, mg = 0.014, hole = c.sub(r, -W / 2 + mg, W / 2 - mg, -H / 2 + mg, H / 2 - mg);
    m.frame(c.map, r, hole, { h: 0.004, role: c.role('trim', at), rad: 0.012, holeRad: 0.008, holeDrop: 0.008, drop: 0.009, seed: c.rnd() });
    m.panel(c.map, hole[0], hole[1], hole[2], hole[3], { h: -0.012, rad: 0.008, gap: 0, role: ROLE.dark, wall: { out: 0, dh: 0.009 } });
    const uc = (r[0] + r[1]) / 2, vc = (r[2] + r[3]) / 2, er = Math.min(0.03, H * 0.22);
    lens(c.K, M.t(uc - W * 0.2, vc + H * 0.1, -0.011), er, leaf.eye, { h: 0.006, halo: 3.4 });
    for (const dy of [0.5, -0.5]) {   // two sockets
      const x = uc + W * 0.2, y = vc + H * 0.1 + dy * er * 1.25, s = er * 0.52;
      m.frame(c.map, [x - s, x + s, y - s, y + s], [x - s * 0.6, x + s * 0.6, y - s * 0.6, y + s * 0.6], { h: -0.006, gap: 0, role: ROLE.metal, rad: 1, holeRad: 1, holeDrop: 0.004, wall: { out: 0.001, dh: -0.006 }, cornerSegs: 5 });
      m.panel(c.map, x - s * 0.22, x + s * 0.22, y - s * 0.22, y + s * 0.22, { h: -0.007, gap: 0, rad: 1, role: ROLE.brass, wall: { out: 0.0005, dh: -0.004 } });
    }
    const cols = [[1, 0.22, 0.1], [1, 0.6, 0.08], [0.2, 1, 0.4], [0.3, 0.6, 1]];
    for (let k = 0; k < 4; k++) {   // a row of lights along the bottom
      const x = uc + (k - 1.5) * Math.min(0.028, W * 0.16), y = vc - H * 0.27, rr = 0.0058, q = [x - rr, x + rr, y - rr, y + rr];
      m.frame(c.map, [x - rr - 0.002, x + rr + 0.002, y - rr - 0.002, y + rr + 0.002], q, { h: -0.0075, gap: 0, role: ROLE.metal, rad: 1, holeRad: 1, holeDrop: 0.0015, drop: 0.004, bevel: 0.0007 });
      c.K.glow.color = cols[k];
      c.K.glow.panel(c.map, q[0], q[1], q[2], q[3], { h: -0.0085, gap: 0, rad: 1, wall: null, edge: false });
      c.K.halo([x, y, -0.004], [0, 0, 1], cols[k], 0.04);
    }
  },
};

// one box of the casing, from y0 to y1: a dark core, a panelled face on each side, rounded corner posts
function shell(K, y0, y1, faces, scheme, rnd, cornerTag) {
  const { W, D, RC } = BOX, H = y1 - y0, m = K.main;
  m.at(M.mul(M.t(0, y0, 0), UP), (b) => b.prism(rrect(W - 0.03, D - 0.03, RC, 4), 0.001, H - 0.001, { role: ROLE.dark, wear: false, bevel: 0 }));
  const sides = [[faces.front, M.t(0, y0, D / 2), W - 2 * RC, 0], [faces.back, M.mul(M.t(0, y0, -D / 2), M.ry(PI)), W - 2 * RC, 180],
    [faces.left, M.mul(M.t(W / 2, y0, 0), M.ry(PI / 2)), D - 2 * RC, 90], [faces.right, M.mul(M.t(-W / 2, y0, 0), M.ry(-PI / 2)), D - 2 * RC, -90]];
  let i = 0;
  for (const [tree, mat, w, deg] of sides) K.at(mat, () => {
    const c = context(K, PLANE, scheme, rnd), drops = [];
    walk(tree, [-w / 2, w / 2, 0, H], (leaf) => { if (leaf.drop) drops.push(leaf); });
    const gone = drops.length && rnd() < 0.5 ? drops[Math.floor(rnd() * drops.length)] : null;
    c.flag = (leaf) => (leaf === gone ? 2 : 0) | ((leaf.kind === 'skin' || leaf.kind === 'door') && leaf.tag !== 'rim' && rnd() < 0.14 ? 1 : 0);
    walk(tree, [-w / 2, w / 2, 0, H], (leaf, r) => FITS[leaf.kind](c, r, leaf, { deg: deg + (((r[0] + r[1]) / 2) / w) * 60, i: i++ }));
  });
  const post = turned(profile.cyl(RC, 0), { deg: 11 });
  for (const [sx, sz, a0] of [[1, 1, 0], [1, -1, 90], [-1, -1, 180], [-1, 1, 270]])
    m.at(M.t(sx * (W / 2 - RC), y0, sz * (D / 2 - RC)), (b) => b.panel(post, rad(a0), rad(a0 + 90), 0, H, { role: scheme.role(cornerTag, { deg: 999, i: 0 }), rad: 0.004, seed: rnd() }));
}

function casing(K, state, scheme, rnd) {
  const { W, D, RC, hip, belt, lid, top } = BOX, m = K.main, eye = state.eyeRGB;
  const lower = {
    front: V([50, U([1, rim()], [1, rim()])], [190, U([1, L('ribs', { n: 3 })], [1.25, V([1, L('vent')], [1, L('vent')])], [1, L('ribs', { n: 3 })])], [120, U([1, L('coupling')], [1.1, L('slots', { n: 4, across: true })], [1, L('port')])]),
    back: V([50, U([1, rim()], [1, rim()])], [190, U([1, door({ drop: true })], [1, door({ tag: 'block' })])], [120, U([1.4, L('grille', { slats: 9 })], [1, L('hatch')])]),
    left: V([50, U([1, rim()], [1, rim()], [1, rim()])], [190, U([1, L('ribs', { n: 3 })], [1.2, door({ tag: 'block', drop: true })], [1, L('ribs', { n: 3 })])], [120, U([1, L('grille', { slats: 6 })], [1, L('coupling')], [1, L('hatch')])]),
    right: V([50, U([1, rim()], [1, rim()], [1, rim()])], [190, U([1, L('ribs', { n: 3 })], [1.2, door({ tag: 'block' })], [1, L('ribs', { n: 3 })])], [120, U([1, L('hatch')], [1, L('port')], [1, L('grille', { slats: 6 })])]),
  };
  const dskin = (o) => L('skin', { tag: 'domeskin', ...o }), ddoor = (o) => L('door', { tag: 'domeskin', ...o });
  const upper = {
    front: V([60, U([1, dskin()], [1, dskin()])], [218, U([1, ddoor()], [2.6, L('face', { eye })], [1, ddoor()])]),
    back: V([60, U([1, dskin()], [1, dskin()])], [218, U([1, ddoor()], [2.2, V([1, L('grille', { slats: 10 })], [0.5, L('lights')])], [1, ddoor()])]),
    left: V([60, U([1, dskin()], [1, dskin()], [1, dskin()])], [218, U([1, ddoor()], [2, L('ribs', { n: 5, tag: 'domeskin' })], [1, ddoor()])]),
    right: V([60, U([1, dskin()], [1, dskin()], [1, dskin()])], [218, U([1, ddoor()], [2, L('ribs', { n: 5, tag: 'domeskin' })], [1, ddoor()])]),
  };
  shell(K, hip, belt, lower, scheme, rnd, 'rim');
  shell(K, lid, top, upper, scheme, rnd, 'domeskin');
  // the belt between the boxes, and the underside
  m.at(M.mul(M.t(0, belt, 0), UP), (b) => {
    b.prism(rrect(W - 0.05, D - 0.05, RC, 4), -0.004, lid - belt + 0.004, { role: ROLE.steel, bevel: 0 });
    b.prism(rrect(W - 0.022, D - 0.022, RC, 4), 0.009, lid - belt - 0.009, { role: scheme.role('band', { i: 0 }), bevel: 0.003 });
  });
  m.at(M.mul(M.t(0, hip - 0.012, 0), UP), (b) => b.prism(rrect(W - 0.04, D - 0.04, RC, 4), 0, 0.013, { role: ROLE.dark, bevel: 0.004 }));
  // the roof: one plate, a raised deck, a carrying handle and a filler cap
  K.at(M.mul(M.t(0, top, 0), UP), () => {
    m.panel(PLANE, -W / 2, W / 2, -D / 2, D / 2, { role: scheme.role('domeskin', { i: 0 }), rad: RC, seed: rnd() });
    m.prism(rrect(0.33, 0.43, 0.03, 4), 0, 0.022, { role: scheme.role('crown', { i: 0 }), bevel: 0.005 });
    m.at(M.t(0, 0, 0.022), (b) => b.panel(PLANE, -0.12, 0.12, -0.02, 0.16, { h: 0.0014, gap: 0, rad: 0.006, role: scheme.role('crown', { i: 1 }), drop: 0.0017, bevel: 0.001 }));
    for (const sx of [-1, 1]) m.at(M.t(sx * 0.095, 0.105, 0.022), (b) => b.cyl(0.012, 0, 0.012, { role: ROLE.steel, n: 12, bevel: 0.002 }));
    m.tube([[-0.095, 0.105, 0.03], [-0.092, 0.105, 0.062], [-0.06, 0.105, 0.078], [0.06, 0.105, 0.078], [0.092, 0.105, 0.062], [0.095, 0.105, 0.03]], 0.0075, { role: ROLE.steel, sides: 8, n: 24 });
    m.at(M.t(0.085, -0.135, 0.022), (b) => { b.cyl(0.03, 0, 0.012, { role: ROLE.steel, n: 20, bevel: 0.003 }); b.cyl(0.022, 0.012, 0.02, { role: ROLE.brass, n: 16, bevel: 0.003 }); });
  });
}

// a leg: a sleeve that slides in the casing, a bellows, a blocky foot. Built hanging from y = 0 (the hip).
function leg(K, side, scheme, rnd) {
  const m = K.main, role = (t) => scheme.role(t, { deg: side * 90, i: 0 }), hip = BOX.hip;
  m.push(M.s(side, 1, 1));
  m.at(UP, (b) => {
    b.prism(rrect(0.17, 0.2, 0.026, 3), -0.075, 0.06, { role: role('legskin'), bevel: 0.004 });
    b.prism(rrect(0.178, 0.208, 0.028, 3), -0.066, -0.046, { role: ROLE.steel, bevel: 0.003 });
  });
  // the bellows
  const pl = [[0.066, -0.225]];
  for (let k = 0; k < 5; k++) { const y = -0.225 + (0.15 * k) / 5; pl.push([0.09, y + 0.015], [0.066, y + 0.03]); }
  m.lathe(pl, { role: ROLE.rubber, segs: 28, wear: false });
  // the foot: longer in front than behind, with a steel toe and a valve on each side
  m.at(M.mul(M.t(0, -hip, 0), UP), (b) => {
    const S = (wx, ly, z, cy) => ({ o: rrect(wx, ly, 0.02, 3, 0, cy), z });
    b.loft([S(0.194, 0.294, 0, -0.03), S(0.2, 0.3, 0.005, -0.03), S(0.2, 0.3, 0.05, -0.03), S(0.178, 0.228, 0.088, -0.008), S(0.17, 0.218, 0.093, -0.008)], { role: role('footskin') });
    b.prism(rrect(0.206, 0.05, 0.012, 3, 0, -0.161), 0.002, 0.04, { role: ROLE.steel, bevel: 0.004 });
    b.prism(rrect(0.14, 0.16, 0.012, 3, 0, -0.005), 0.09, 0.1, { role: ROLE.steel, bevel: 0.003 });
    for (const sx of [-1, 1]) b.at(M.mul(M.t(sx * 0.101, 0.03, 0.03), M.ry((sx * PI) / 2)), (q) => { q.cyl(0.014, -0.006, 0.012, { role: ROLE.brass, n: 12, bevel: 0.002 }); q.cyl(0.008, 0.012, 0.02, { role: ROLE.steel, n: 10, bevel: 0.001 }); });
  });
  m.pop();
}

export function buildPower(state) {
  const scheme = SCHEMES[state.scheme] || SCHEMES.solid, rnd = rng(state.seed || 1);
  const kits = { body: new Kit(), legL: new Kit(), legR: new Kit() };
  casing(kits.body, state, scheme, rnd);
  leg(kits.legL, 1, scheme, rnd); leg(kits.legR, -1, scheme, rnd);
  return kits;
}
// t: 0 standing square, 1 caught mid-step (one foot forward and lifted, the casing rocked onto the other)
export function posePower(g, t) {
  const e = t * t * (3 - 2 * t), { hip, legX } = BOX;
  g.body.position.set(0, 0.012 * e, 0.012 * e); g.body.rotation.set(-0.035 * e, 0, 0.03 * e);
  g.legL.position.set(legX, hip + 0.034 * e, 0.085 * e); g.legL.rotation.set(-0.16 * e, 0, 0);
  g.legR.position.set(-legX, hip, -0.045 * e); g.legR.rotation.set(0.05 * e, 0, 0);
  return {};
}
