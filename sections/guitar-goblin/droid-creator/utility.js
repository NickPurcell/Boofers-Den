// The utility droid: an astromech-style chassis. A barrel hung between two slab legs on wedge feet, a dome that
// turns on top, and a third leg that comes down from the skirt when it leans back to roll. Proportions are from a
// study of many such units (about 1.09 m tall, the barrel about as tall as it is wide); the panelling, fittings and
// paint are our own. Everything is built with the kit in hard.js, in metres.
//
// The droid is made of pieces that move against each other (body, dome, two legs, two feet, the third leg and its
// foot). Each piece is built in its own frame; pose() places them for a stance.
import * as THREE from 'three';
import { Kit, ROLE, FLAG, M, rad, turned, profile, PLANE, rrect, rng, context } from './hard.js';
import { LAYOUTS, SCHEMES, walk } from './layout.js';
import { buildDome } from './domes.js';

const { PI } = Math;
export const DIM = {
  R: 0.232,                      // the barrel's radius
  top: 0.118, bottom: -0.372,    // the barrel's ends, measured from the shoulder axis
  skirt: 0.068, ring: 0.014,     // the tapered skirt under it and the bright ring the dome turns on
  legGap: 0.012, leg: 0.575,     // the gap between barrel and leg; shoulder axis down to ankle axis
  ankleY: 0.13, midAnkleY: 0.105,
  lean: rad(18),                 // how far the barrel leans back on three legs
};

/* ---------------- the barrel's fittings, one maker per kind of leaf in a layout ---------------- */
export const KINDS = {
  skin(c, r, leaf, at) {
    const flag = c.flag ? c.flag(leaf) : 0;
    c.K.main.panel(c.map, r[0], r[1], r[2], r[3], { role: c.role(leaf.tag || 'skin', at), seed: c.rnd(), flag, rad: 0.005 });
    return flag;
  },
  // a door: a panel with a second, slightly raised panel inside it (a line inside a line)
  door(c, r, leaf, at) {
    const block = leaf.tag === 'block', flag = KINDS.skin(c, r, { ...leaf, tag: block ? 'skin' : leaf.tag }, at), [W, H] = c.size(r);
    if (W > 0.045 && H > 0.045) c.K.main.panel(c.map, ...c.sub(r, -W / 2 + 0.0105, W / 2 - 0.0105, -H / 2 + 0.0105, H / 2 - 0.0105),
      { h: 0.0013, gap: 0, rad: 0.004, bevel: 0.001, drop: 0.0017, role: c.role(block ? 'block' : 'door', at), seed: c.rnd(), flag });
    if (flag & FLAG.drop) innards(c, r);
  },
  // a tool arm lying in its slot: a long piece and a short one
  bar(c, r, leaf, at) {
    const [W, H] = c.size(r), m = c.K.main, g = 0.004;
    m.panel(c.map, r[0], r[1], r[2], r[3], { h: -0.007, rad: H / 2, gap: g, role: ROLE.dark, wall: { out: 0, dh: 0.007 } });
    const L = W - g - 0.012, hh = H - g - 0.009, long = L * 0.6, short = L - long - 0.011, s = leaf.flip ? -1 : 1;
    const piece = (x0, x1) => m.panel(c.map, ...c.sub(r, Math.min(x0, x1), Math.max(x0, x1), -hh / 2, hh / 2),
      { h: 0.0015, gap: 0, rad: hh * 0.34, role: c.role('trim', at), wall: { out: 0.0012, dh: -0.0085 }, seed: c.rnd() });
    piece(s * (-L / 2), s * (-L / 2 + long)); piece(s * (L / 2 - short), s * (L / 2));
  },
  // an oblong vent with louvres, in a raised surround
  vent(c, r, leaf, at) {
    const [W, H] = c.size(r), m = c.K.main, mg = Math.min(0.016, H * 0.2), hw = W / 2 - mg, hh = H / 2 - mg, rr = Math.min(hw, hh);
    const hole = c.sub(r, -hw, hw, -hh, hh);
    m.frame(c.map, r, hole, { h: 0.0025, role: c.role('trim', at), rad: 0.009, holeRad: rr, holeDrop: 0.005, drop: 0.0075, seed: c.rnd() });
    m.panel(c.map, hole[0], hole[1], hole[2], hole[3], { h: -0.013, rad: rr, gap: 0, role: ROLE.dark, wall: { out: 0, dh: 0.0115 } });
    const n = Math.max(3, Math.round((2 * hh) / 0.014)), pitch = (2 * hh) / n;
    for (let k = 0; k < n; k++) {
      const y = -hh + pitch * (k + 0.5), cy = Math.max(Math.abs(y) + pitch * 0.3 - (hh - rr), 0), half = hw - rr + Math.sqrt(Math.max(rr * rr - cy * cy, 0)) - 0.003;
      if (half > 0.004) m.panel(c.map, ...c.sub(r, -half, half, y - pitch * 0.3, y + pitch * 0.3), { h: -0.004, rad: 0.0015, gap: 0, role: ROLE.metal, wall: { out: 0.0005, dh: -0.008 }, seed: c.rnd() });
    }
  },
  // a column (or a row) of small sockets
  slots(c, r, leaf, at) {
    KINDS.skin(c, r, leaf, at);
    const [W, H] = c.size(r), n = leaf.n || 5, m = c.K.main, across = !!leaf.across;
    const sw = across ? 0.011 : Math.min(0.03, W - 0.022), sh = across ? Math.min(0.034, H - 0.03) : 0.0095;
    const span = across ? Math.min(W - 0.03, n * 0.026) : Math.min(H - 0.03, n * 0.023);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5, x = across ? t * span : 0, y = across ? 0 : t * span, q = 0.0024;
      const o = c.sub(r, x - sw / 2, x + sw / 2, y - sh / 2, y + sh / 2), hole = c.sub(r, x - sw / 2 + q, x + sw / 2 - q, y - sh / 2 + q, y + sh / 2 - q);
      m.frame(c.map, o, hole, { h: 0.003, gap: 0, role: ROLE.metal, rad: 0.003, holeRad: 0.0012, holeDrop: 0.0025, drop: 0.0034, bevel: 0.0008 });
      m.panel(c.map, hole[0], hole[1], hole[2], hole[3], { h: 0.0007, gap: 0, rad: 0.0012, role: ROLE.dark, wall: null, edge: false });
    }
  },
  // a round power coupling in a square surround
  coupling(c, r, leaf, at) {
    KINDS.skin(c, r, leaf, at);
    const [W, H] = c.size(r), m = c.K.main, s = Math.min(W, H) / 2 - 0.009, hr = s - 0.008;
    const hole = c.sub(r, -hr, hr, -hr, hr), ro = hr * 0.86, ri = hr * 0.62;
    m.frame(c.map, c.sub(r, -s, s, -s, s), hole, { h: 0.0026, gap: 0, role: c.role('trim', at), rad: 0.005, holeRad: hr, holeDrop: 0.0022, drop: 0.003, cornerSegs: 6, seed: c.rnd() });
    m.panel(c.map, hole[0], hole[1], hole[2], hole[3], { h: 0.0005, gap: 0, rad: hr, role: ROLE.dark, wall: null, edge: false });
    m.frame(c.map, c.sub(r, -ro, ro, -ro, ro), c.sub(r, -ri, ri, -ri, ri), { h: 0.0042, gap: 0, role: ROLE.steel, rad: ro, holeRad: ri, holeDrop: 0.0035, drop: 0.004, bevel: 0.001 });
    for (const [bw, bh] of [[ri * 1.02, 0.0028], [0.0028, ri * 1.02]]) m.panel(c.map, ...c.sub(r, -bw, bw, -bh, bh), { h: 0.003, gap: 0, rad: 0.001, role: ROLE.steel, drop: 0.0027, bevel: 0.0006 });
    m.panel(c.map, ...c.sub(r, -hr * 0.3, hr * 0.3, -hr * 0.3, hr * 0.3), { h: 0.0058, gap: 0, rad: hr * 0.3, role: ROLE.metal, wall: { out: 0.0015, dh: -0.0055 } });
  },
  // a round data port: a metal collar, a dark well, a brass pin
  port(c, r, leaf, at) {
    KINDS.skin(c, r, leaf, at);
    const [W, H] = c.size(r), m = c.K.main, s = Math.min(W, H) / 2 - 0.012, q = s * 0.66;
    m.frame(c.map, c.sub(r, -s, s, -s, s), c.sub(r, -q, q, -q, q), { h: 0.006, gap: 0, role: ROLE.metal, rad: s, holeRad: q, holeDrop: 0.005, wall: { out: 0.003, dh: -0.0063 } });
    m.panel(c.map, ...c.sub(r, -q, q, -q, q), { h: 0.0012, gap: 0, rad: q, role: ROLE.dark, wall: null, edge: false });
    m.panel(c.map, ...c.sub(r, -s * 0.24, s * 0.24, -s * 0.24, s * 0.24), { h: 0.0045, gap: 0, rad: s, role: ROLE.brass, wall: { out: 0.001, dh: -0.004 } });
  },
  // a small access hatch: a door with a finger slot and two fasteners
  hatch(c, r, leaf, at) {
    KINDS.door(c, r, leaf, at);
    const [W, H] = c.size(r), m = c.K.main;
    if (W < 0.05 || H < 0.05) return;
    const hw = Math.min(0.018, W * 0.22), y = H / 2 - 0.025;
    m.panel(c.map, ...c.sub(r, -hw, hw, y - 0.0045, y + 0.0045), { h: 0.0017, gap: 0, rad: 0.004, role: ROLE.dark, wall: null, edge: false });
    for (const sx of [-1, 1]) m.panel(c.map, ...c.sub(r, sx * (W / 2 - 0.02) - 0.003, sx * (W / 2 - 0.02) + 0.003, -H / 2 + 0.017, -H / 2 + 0.023), { h: 0.0026, gap: 0, rad: 0.003, role: ROLE.metal, drop: 0.0015, bevel: 0.0007 });
  },
  // a recessed grille of upright slats
  grille(c, r, leaf, at) {
    const [W, H] = c.size(r), m = c.K.main, g = 0.006, n = leaf.slats || 6;
    m.panel(c.map, r[0], r[1], r[2], r[3], { h: -0.013, rad: 0.006, gap: g, role: ROLE.dark, wall: { out: 0, dh: 0.013 } });
    const w = W - g - 0.008, hh = (H - g) / 2 - 0.004, pitch = w / n;
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + pitch * (k + 0.5);
      m.panel(c.map, ...c.sub(r, x - pitch * 0.3, x + pitch * 0.3, -hh, hh), { h: -0.003, gap: 0, rad: 0.0015, role: c.role('skin', at), wall: { out: 0.0005, dh: -0.01 }, seed: c.rnd() });
    }
  },
  // three small status lights
  lights(c, r, leaf, at) {
    KINDS.skin(c, r, leaf, at);
    const [W, H] = c.size(r), m = c.K.main, upright = H > W, span = Math.min((upright ? H : W) - 0.03, 0.06), rr = Math.min(0.0055, (upright ? W : H) / 2 - 0.007);
    const cols = [[1, 0.22, 0.1], [1, 0.6, 0.08], [0.2, 1, 0.4]];
    for (let k = 0; k < 3; k++) {
      const t = ((k + 0.5) / 3 - 0.5) * span, x = upright ? 0 : t, y = upright ? t : 0, lens = c.sub(r, x - rr, x + rr, y - rr, y + rr);
      m.frame(c.map, c.sub(r, x - rr - 0.002, x + rr + 0.002, y - rr - 0.002, y + rr + 0.002), lens, { h: 0.0022, gap: 0, role: ROLE.metal, rad: 1, holeRad: 1, holeDrop: 0.0015, drop: 0.0025, bevel: 0.0007 });
      c.K.glow.color = cols[k];
      c.K.glow.panel(c.map, lens[0], lens[1], lens[2], lens[3], { h: 0.0012, gap: 0, rad: 1, wall: null, edge: false });
      c.halo(lens, cols[k], 0.04);
    }
  },
  shoulder(c, r, leaf, at) { KINDS.skin(c, r, { tag: 'side' }, at); },
};
// what shows where a panel has gone missing: a dark bay, two pipes and a box
function innards(c, r) {
  const [W, H] = c.size(r), m = c.K.main;
  m.panel(c.map, r[0], r[1], r[2], r[3], { h: -0.016, rad: 0.004, gap: 0.004, role: ROLE.dark, wall: { out: 0, dh: 0.014 } });
  const pipe = (v, role, rr) => { const pts = []; for (let i = 0; i <= 6; i++) pts.push(c.point(r[0] + (r[1] - r[0]) * (0.08 + (0.84 * i) / 6), r[2] + H * v + Math.sin(i * 1.3) * 0.004, -0.011)[0]); m.tube(pts, rr, { role, sides: 6 }); };
  pipe(0.72, ROLE.brass, 0.0036); pipe(0.62, ROLE.rubber, 0.0045); pipe(0.2, ROLE.rubber, 0.003);
  m.panel(c.map, ...c.sub(r, -W * 0.3, W * 0.02, -H * 0.22, H * 0.06), { h: -0.006, gap: 0, rad: 0.002, role: ROLE.steel, wall: { out: 0.0005, dh: -0.01 } });
  m.panel(c.map, ...c.sub(r, W * 0.1, W * 0.32, -H * 0.3, -H * 0.12), { h: -0.008, gap: 0, rad: 0.002, role: ROLE.brass, wall: { out: 0.0005, dh: -0.008 } });
}

function barrel(K, scheme, layout, rnd) {
  const { R, top, bottom, skirt } = DIM, m = K.main, map = turned(profile.cyl(R, bottom)), c = context(K, map, scheme, rnd);
  m.lathe([[R - 0.02, bottom - 0.002], [R - 0.02, top + 0.002]], { role: ROLE.dark, wear: false, segs: 48 });   // what shows in the gaps
  // one of the doors marked in the layout may be missing on a scavenged unit; a few panels may be from another unit
  const tree = layout.tree(), drops = [];
  walk(tree, [-PI, PI, 0, top - bottom], (leaf) => { if (leaf.drop) drops.push(leaf); });
  const gone = drops.length ? drops[Math.floor(rnd() * drops.length)] : null;
  c.flag = (leaf) => (leaf === gone ? FLAG.drop : 0) | ((leaf.kind === 'skin' || leaf.kind === 'door') && leaf.tag !== 'rim' && rnd() < 0.12 ? FLAG.odd : 0);
  let i = 0;
  walk(tree, [-PI, PI, 0, top - bottom], (leaf, r) => KINDS[leaf.kind](c, r, leaf, { deg: (((r[0] + r[1]) / 2) * 180) / PI, i: i++ }));
  // the bright ring the dome turns on
  m.lathe([[R - 0.03, top + 0.0005], [R + 0.0012, top + 0.0005], [R + 0.0012, top + 0.0052], [R - 0.0035, top + 0.0052], [R - 0.0035, top + 0.0088], [R + 0.0008, top + 0.0088], [R + 0.0008, top + DIM.ring], [R - 0.03, top + DIM.ring]], { role: ROLE.metal, segs: 72 });
  // the skirt, with its ribs
  const yb = bottom - skirt, r1 = 0.166, cone = profile.cone(r1, yb + 0.004, R - 0.007, bottom - 0.006), cmap = turned(cone, { uvR: R });
  m.lathe([[0, yb], [r1 - 0.004, yb], [r1, yb + 0.004], [R - 0.007, bottom - 0.006], [R - 0.007, bottom - 0.0005], [R - 0.03, bottom - 0.0005]], { role: ROLE.dark, segs: 72 });
  for (let k = 0; k < 12; k++) { const a = rad(k * 30 - 165); m.panel(cmap, a - rad(13.4), a + rad(13.4), 0.007, cone.len - 0.007, { h: 0.0035, gap: 0, rad: 0.004, role: c.role('skirt', { deg: k * 30 - 165, i: k }), wall: { out: 0.002, dh: -0.0037 }, seed: rnd() }); }
  // the shoulder axles
  for (const sx of [-1, 1]) m.at(M.ry((sx * PI) / 2), (b) => { b.cyl(0.052, R - 0.012, R + DIM.legGap + 0.004, { role: ROLE.steel, n: 28, bevel: 0.002 }); b.cyl(0.07, R - 0.012, R + 0.0055, { role: ROLE.metal, n: 32, bevel: 0.003 }); });
}

/* ---------------- legs and feet ---------------- */
// for parts drawn side-on: local x runs forward, y up, and z outward from the body
const OUT = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
// for parts drawn from above: local z runs up and local y backward
const UP = M.rx(-PI / 2);

function leg(K, side, scheme) {
  const m = K.main, role = (t) => scheme.role(t, { deg: side * 90, i: 0 }), L = DIM.leg;
  m.push(M.s(side, 1, 1)); m.push(OUT);
  // the shoulder: a thick horseshoe-topped slab with a raised border and a round hub
  const ra = 0.096, arc = (r) => { const o = []; for (let i = 0; i <= 14; i++) { const a = (PI * i) / 14; o.push([r * Math.cos(a), r * Math.sin(a)]); } return o; };
  const cap = [...arc(ra), [-ra, -0.105], [-0.072, -0.172], [0.072, -0.172], [ra, -0.105]];
  m.prism(cap, 0.002, 0.082, { bevel: 0.005, role: role('shoulder') });
  m.at(M.t(0, 0, 0.082), (b) => {
    b.frame(PLANE, [-0.06, 0.06, -0.06, 0.06], [-0.043, 0.043, -0.043, 0.043], { h: 0.005, gap: 0, role: role('hub'), rad: 1, holeRad: 1, holeDrop: 0.0045, wall: { out: 0.0025, dh: -0.0052 }, cornerSegs: 8 });
    b.panel(PLANE, -0.043, 0.043, -0.043, 0.043, { h: 0.0006, gap: 0, rad: 1, role: role('shoulder'), wall: null, cornerSegs: 8 });
    b.frame(PLANE, [-0.031, 0.031, -0.031, 0.031], [-0.022, 0.022, -0.022, 0.022], { h: 0.0034, gap: 0, role: ROLE.steel, rad: 1, holeRad: 1, holeDrop: 0.003, wall: { out: 0.001, dh: -0.003 }, cornerSegs: 6 });
    b.panel(PLANE, -0.017, 0.017, -0.017, 0.017, { h: 0.007, gap: 0, rad: 1, role: ROLE.metal, wall: { out: 0.002, dh: -0.0066 }, cornerSegs: 6 });
    for (let k = 0; k < 6; k++) { const a = (k / 6) * 2 * PI + 0.26, x = 0.0515 * Math.cos(a), y = 0.0515 * Math.sin(a); b.panel(PLANE, x - 0.0042, x + 0.0042, y - 0.0042, y + 0.0042, { h: 0.0068, gap: 0, rad: 1, role: ROLE.steel, drop: 0.002, bevel: 0.0008 }); }
    // two small covers low on the shoulder
    for (const sx of [-1, 1]) b.panel(PLANE, sx * 0.043 - 0.016, sx * 0.043 + 0.016, -0.128, -0.086, { h: 0.0014, gap: 0, rad: 0.004, role: role('shoulder'), drop: 0.0017, bevel: 0.001 });
  });
  // the leg below it: a channel down its outer face with a strut in it
  m.prism(rrect(0.126, 0.35, 0.008, 2, 0, -0.31), 0.008, 0.07, { bevel: 0.0035, role: role('legskin') });
  m.at(M.t(0, 0, 0.07), (b) => {
    for (const sx of [-1, 1]) b.panel(PLANE, sx * 0.044 - 0.0145, sx * 0.044 + 0.0145, -0.468, -0.2, { h: 0.006, gap: 0, rad: 0.004, role: role('legskin'), wall: { out: 0.0025, dh: -0.0062 }, solid: true });
    b.panel(PLANE, -0.024, 0.024, -0.468, -0.2, { h: 0.0004, gap: 0, rad: 0.002, role: ROLE.dark, wall: null, edge: false });
  });
  m.prism(rrect(0.03, 0.262, 0.007, 3, 0, -0.335), 0.068, 0.0815, { bevel: 0.003, role: role('strut') });
  m.prism(rrect(0.066, 0.052, 0.008, 3, 0, -0.18), 0.066, 0.092, { bevel: 0.0045, role: ROLE.steel });
  m.at(M.t(0, -0.335, 0), (b) => b.cyl(0.0075, 0.07, 0.0865, { role: ROLE.metal, n: 10, bevel: 0.001 }));
  m.at(M.mul(M.t(0, -0.19, 0.052), M.ry(PI / 2)), (b) => b.cyl(0.0135, -0.07, 0.07, { role: ROLE.steel, bevel: 0.002, n: 14 }));
  // the ankle: a wider block and the axle the foot hangs on
  m.prism([[0.063, -0.47], [-0.063, -0.47], [-0.09, -0.5], [-0.09, -0.548], [-0.07, -0.568], [0.07, -0.568], [0.09, -0.548], [0.09, -0.5]], 0, 0.084, { bevel: 0.0045, role: role('legskin') });
  m.at(M.t(0, -L, 0), (b) => { b.cyl(0.031, -0.01, 0.096, { role: ROLE.steel, bevel: 0.003, n: 20 }); b.cyl(0.019, 0.094, 0.104, { role: ROLE.metal, bevel: 0.002, n: 14 }); });
  for (const sx of [-1, 1]) {
    m.prism(rrect(0.024, 0.034, 0.003, 2, sx * 0.06, -0.522), 0.082, 0.094, { bevel: 0.0025, role: ROLE.steel });
    m.at(M.mul(M.t(sx * 0.084, -0.524, 0.042), M.rx(PI / 2)), (b) => b.cyl(0.0115, -0.03, 0.03, { role: ROLE.metal, bevel: 0.002, n: 12 }));   // a small cylinder on each side of the ankle
  }
  m.pop(); m.pop();
}

function foot(K, side, scheme) {
  const m = K.main, role = (t) => scheme.role(t, { deg: side * 90, i: 0 });
  m.push(M.s(side, 1, 1)); m.push(M.mul(M.t(0.042, -DIM.ankleY, 0), UP));
  const S = (wx, ly, z, r = 0.014) => ({ o: rrect(wx, ly, r, 3), z });
  // a wedge, wider at the ground, on a stepped base strip
  m.loft([S(0.164, 0.3, 0), S(0.17, 0.306, 0.004), S(0.17, 0.306, 0.026), S(0.158, 0.294, 0.0265), S(0.158, 0.294, 0.032), S(0.118, 0.138, 0.104), S(0.111, 0.131, 0.109)], { role: role('footskin') });
  m.prism(rrect(0.1, 0.104, 0.008, 3), 0.107, 0.128, { role: role('footskin'), bevel: 0.004 });
  for (const sx of [-1, 1]) {
    m.prism(rrect(0.013, 0.08, 0.004, 2, sx * 0.0515, 0), 0.105, 0.16, { role: ROLE.steel, bevel: 0.003 });                  // the cheeks the axle runs through
    m.at(M.mul(M.t(sx * 0.07, 0, 0.054), M.rx(PI / 2)), (b) => b.cyl(0.034, -0.076, 0.076, { role: role('foottrim'), bevel: 0.01, n: 20 }));   // a pod on each side
    m.at(M.mul(M.t(sx * 0.07, 0, 0.054), M.rx(PI / 2)), (b) => b.cyl(0.0365, -0.012, 0.012, { role: ROLE.steel, bevel: 0.002, n: 20 }));       // its strap
  }
  // a toe plate on the front slope
  m.prism(rrect(0.07, 0.012, 0.003, 2, 0, -0.151), 0.006, 0.03, { role: ROLE.steel, bevel: 0.002 });
  // two braided hoses loop out of the outer pod's front and down into the toe
  for (const dz of [0.012, -0.008]) m.tube([[0.074, -0.07, 0.056 + dz], [0.094, -0.105, 0.062 + dz], [0.104, -0.142, 0.046 + dz * 0.6], [0.094, -0.162, 0.024 + dz * 0.3], [0.07, -0.153, 0.013]], 0.0066, { role: ROLE.brass, sides: 8, n: 24 });
  m.pop(); m.pop();
}

// the third leg: a column that slides out of the skirt, and its smaller foot
function midLeg(K, scheme) {
  const m = K.main, role = (t) => scheme.role(t, { deg: 0, i: 0 });
  m.at(UP, (b) => { b.prism(rrect(0.09, 0.075, 0.012, 3), 0.012, 0.3, { role: role('legskin'), bevel: 0.004 }); b.prism(rrect(0.07, 0.095, 0.01, 3), -0.03, 0.03, { role: ROLE.steel, bevel: 0.004 }); });
  m.at(M.ry(PI / 2), (b) => b.cyl(0.024, -0.056, 0.056, { role: ROLE.steel, bevel: 0.003, n: 16 }));
}
function midFoot(K, scheme) {
  const m = K.main, role = (t) => scheme.role(t, { deg: 0, i: 0 });
  m.push(M.mul(M.t(0, -DIM.midAnkleY, 0), UP));
  const S = (wx, ly, z, r = 0.01) => ({ o: rrect(wx, ly, r, 3), z });
  m.loft([S(0.124, 0.214, 0), S(0.13, 0.22, 0.004), S(0.13, 0.22, 0.02), S(0.121, 0.211, 0.0205), S(0.121, 0.211, 0.026), S(0.09, 0.104, 0.078), S(0.085, 0.099, 0.082)], { role: role('footskin') });
  for (const sx of [-1, 1]) m.prism(rrect(0.012, 0.07, 0.004, 2, sx * 0.049, 0), 0.08, 0.13, { role: ROLE.steel, bevel: 0.003 });
  for (const sy of [-1, 1]) m.at(M.mul(M.t(0, sy * 0.07, 0.034), M.ry(PI / 2)), (b) => b.cyl(0.02, -0.045, 0.045, { role: role('foottrim'), bevel: 0.006, n: 14 }));
  m.pop();
}

/* ---------------- the whole unit ---------------- */
// state: { layout, scheme, dome, seed, ... }. Returns the pieces as kits, by name.
export function buildUtility(state) {
  const scheme = SCHEMES[state.scheme] || SCHEMES.service, layout = LAYOUTS[state.layout] || LAYOUTS.standard, rnd = rng(state.seed || 1);
  const kits = { body: new Kit(), dome: new Kit(), legL: new Kit(), legR: new Kit(), footL: new Kit(), footR: new Kit(), midLeg: new Kit(), midFoot: new Kit() };
  barrel(kits.body, scheme, layout, rnd);
  buildDome(kits.dome, state, scheme, rnd, DIM.R);
  leg(kits.legL, 1, scheme); leg(kits.legR, -1, scheme);
  foot(kits.footL, 1, scheme); foot(kits.footR, -1, scheme);
  midLeg(kits.midLeg, scheme); midFoot(kits.midFoot, scheme);
  return kits;
}

// Place the pieces. t runs from 0 (upright on two legs) to 1 (leaning back on three); a2 turns the dome (-1 to 1).
// g maps names to objects.
export function poseUtility(g, t, a2) {
  const { R, legGap, leg: L, ankleY, midAnkleY, top, ring, bottom, skirt, lean } = DIM, e = t * t * (3 - 2 * t), a = lean * e;
  const sy = ankleY + L * Math.cos(a), x = R + legGap;
  g.body.position.set(0, sy, 0); g.body.rotation.set(-a, 0, 0);
  g.dome.position.set(0, top + ring, 0); g.dome.rotation.set(0, (a2 || 0) * rad(32), 0);
  g.legL.position.set(x, sy, 0); g.legL.rotation.set(a, 0, 0);
  g.legR.position.set(-x, sy, 0); g.legR.rotation.set(a, 0, 0);
  g.footL.position.set(x, ankleY, -L * Math.sin(a)); g.footR.position.set(-x, ankleY, -L * Math.sin(a));
  const reach = (ankleY + L * Math.cos(lean) - midAnkleY) / Math.cos(lean) + (bottom - skirt), tuck = -0.2;
  g.midLeg.position.set(0, bottom - skirt - (tuck + (reach - tuck) * e), 0);
  g.midFoot.rotation.set(a, 0, 0);
  g.midLeg.visible = e > 0.03;
  return { shoulder: sy };
}
