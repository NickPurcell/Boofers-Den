// The utility droid's head, in four shapes: a round dome, a flat-topped "flowerpot", a tall cone, and a clear dome
// with the works showing. Each is built in its own frame, sitting on y = 0 (the ring on top of the barrel), facing +z.
// All carry the same few things in their own arrangement: one large photoreceptor, a holoprojector, a pair of logic
// displays and an indicator light.
import * as THREE from 'three';
import { ROLE, M, rad, turned, profile, PLANE, rrect, ngon, context } from './hard.js';

const { PI, sin, cos } = Math;
export const DOMES = {
  round: { name: 'Round', height: 0.252 },
  flat: { name: 'Flat top', height: 0.222 },
  cone: { name: 'Conical', height: 0.31 },
  clear: { name: 'Clear', height: 0.252 },
};
const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

/* ---------------- the fittings every dome shares ---------------- */
// A photoreceptor seated at `mat` (local z out of the surface): a metal bezel, a dark glass lens, and a thin lit ring
// in the unit's eye colour.
export function lens(K, mat, r, color, o = {}) {
  const bez = o.bezel ?? ROLE.steel, hb = o.h ?? 0.005;
  K.main.at(mat, (b) => b.frame(PLANE, [-r * 1.3, r * 1.3, -r * 1.3, r * 1.3], [-r * 1.08, r * 1.08, -r * 1.08, r * 1.08], { h: hb, gap: 0, role: bez, rad: 1, holeRad: 1, holeDrop: hb * 0.8, wall: { out: 0.0015, dh: -hb - 0.001 }, cornerSegs: 7, solid: true }));
  const cap = [], hc = r * 0.36, rho = (r * r + hc * hc) / (2 * hc);
  for (let i = 0; i <= 7; i++) { const a = Math.asin(r / rho) * (1 - i / 7); cap.push([i === 7 ? 0 : rho * sin(a), rho * cos(a) - (rho - hc)]); }
  K.glass.at(M.mul(mat, M.rx(PI / 2)), (b) => b.lathe(cap, { smooth: true, segs: 28, wear: false }));
  K.glow.color = color;
  K.glow.at(mat, (b) => b.frame(PLANE, [-r * 1.08, r * 1.08, -r * 1.08, r * 1.08], [-r * 0.985, r * 0.985, -r * 0.985, r * 0.985], { h: 0.0008, gap: 0, rad: 1, holeRad: 1, holeDrop: 0, wall: null, cornerSegs: 7 }));
  const p = new THREE.Vector3(0, 0, hc + 0.004).applyMatrix4(mat), n = new THREE.Vector3(0, 0, 1).transformDirection(mat);
  K.halo([p.x, p.y, p.z], [n.x, n.y, n.z], color, r * (o.halo ?? 2.9));
}
// a holoprojector: a collar, a ball and a short nozzle with a pale lens
function projector(K, mat, tilt = 0) {
  K.main.at(mat, (b) => {
    b.cyl(0.022, -0.002, 0.006, { role: ROLE.metal, bevel: 0.002, n: 20 });
    b.at(M.mul(M.t(0, 0, 0.014), M.rx(-tilt)), (q) => {
      q.ball(0.0145, { role: ROLE.steel });
      q.loft([{ o: ngon(0.0105, 16), z: 0.006 }, { o: ngon(0.013, 16), z: 0.024 }, { o: ngon(0.014, 16), z: 0.026 }, { o: ngon(0.014, 16), z: 0.03 }, { o: ngon(0.0115, 16), z: 0.031 }], { role: ROLE.metal, cap0: false });
    });
  });
  const m2 = M.mul(mat, M.t(0, 0, 0.014), M.rx(-tilt), M.t(0, 0, 0.0312));
  K.glow.color = [0.55, 0.8, 1.0];
  K.glow.at(m2, (b) => b.panel(PLANE, -0.0115, 0.0115, -0.0115, 0.0115, { rad: 1, gap: 0, wall: null, edge: false, cornerSegs: 5 }));
  const p = new THREE.Vector3(0, 0, 0.003).applyMatrix4(m2), n = new THREE.Vector3(0, 0, 1).transformDirection(m2);
  K.halo([p.x, p.y, p.z], [n.x, n.y, n.z], [0.4, 0.7, 1.0], 0.06);
}
// a logic display in a metal bezel, lying on the surface in rectangle r
function logic(c, r) {
  const [W, H] = c.size(r), q = 0.0022, inner = c.sub(r, -W / 2 + q, W / 2 - q, -H / 2 + q, H / 2 - q);
  c.K.main.frame(c.map, r, inner, { h: 0.0028, gap: 0, role: ROLE.metal, rad: 0.0025, holeRad: 0.001, holeDrop: 0.002, drop: 0.0032, bevel: 0.0008 });
  c.K.logic.panel(c.map, inner[0], inner[1], inner[2], inner[3], { h: 0.0009, gap: 0, rad: 0.001, wall: null, edge: false, uv01: true });
  c.halo(inner, [0.3, 0.6, 1.0], Math.max(W, H) * 2.2);
}
// a round indicator light
function indicator(c, r, color) {
  const [W, H] = c.size(r), rr = Math.min(W, H) / 2, lensR = c.sub(r, -rr * 0.74, rr * 0.74, -rr * 0.74, rr * 0.74);
  c.K.main.frame(c.map, c.sub(r, -rr, rr, -rr, rr), lensR, { h: 0.003, gap: 0, role: ROLE.metal, rad: 1, holeRad: 1, holeDrop: 0.002, drop: 0.0034, bevel: 0.0008 });
  c.K.glow.color = color;
  c.K.glow.panel(c.map, lensR[0], lensR[1], lensR[2], lensR[3], { h: 0.0014, gap: 0, rad: 1, wall: null, edge: false });
  c.halo(lensR, color, rr * 7);
}
// the raised housing the main eye sits in: a thick surround on rectangle r with a round window
function housing(c, r, lensR, tag = 'eye', h = 0.011) {
  const hole = c.sub(r, -lensR * 1.34, lensR * 1.34, -lensR * 1.34, lensR * 1.34);
  c.K.main.frame(c.map, r, hole, { h, gap: 0, role: c.role(tag, { deg: 0, i: 0 }), rad: 0.012, holeRad: 1, holeDrop: h * 0.7, wall: { out: 0.0035, dh: -h - 0.0005 }, cornerSegs: 7, seed: c.rnd() });
  c.K.main.panel(c.map, hole[0], hole[1], hole[2], hole[3], { h: h * 0.3, gap: 0, rad: 1, role: ROLE.dark, wall: null, edge: false, cornerSegs: 7 });
}
// a row of panels round the dome between v0 and v1: widths in degrees starting from the back, each drawn by `each`
function row(c, v0, v1, widths, each) {
  let u = -180, i = 0;
  for (const w of widths) { each([rad(u), rad(u + w), v0, v1], { deg: u + w / 2, i: i++ }); u += w; }
}
const plain = (c, tag, o = {}) => (r, at) => c.K.main.panel(c.map, r[0], r[1], r[2], r[3], { role: c.role(tag, at), seed: c.rnd(), rad: 0.005, flag: c.rnd() < 0.1 ? 1 : 0, ...o });

/* ---------------- round ---------------- */
function round(K, state, scheme, rnd, R0, clear = false) {
  const R = R0 - 0.0015, yc = 0.02, m = K.main, sph = profile.sphere(R, yc), map = turned(sph, { stepV: R * rad(6), uvR: R }), c = context(K, map, scheme, rnd);
  const el = (deg) => R * rad(deg), eye = lin(state.eyeColor || '#e53a2b');
  // what shows in the gaps, and the upright band the dome starts with
  const core = []; for (let i = 0; i <= 12; i++) { const e = (PI / 2) * (i / 12) * (clear ? 0.24 : 1); core.push([(R - 0.012) * cos(e), yc + (R - 0.012) * sin(e)]); }
  m.lathe([[R - 0.012, 0.002], ...core], { role: ROLE.dark, wear: false, smooth: true, segs: 48 });
  m.lathe([[R - 0.03, 0.0015], [R - 0.001, 0.0015], [R + 0.0005, 0.003], [R + 0.0005, yc - 0.0005], [R - 0.004, yc - 0.0005]], { role: c.role('hub'), segs: 72 });
  // the band round the base: sixteen panels, two of them given over to the logic displays and one to the indicator
  row(c, el(2), el(19), Array(16).fill(22.5), (r, at) => {
    plain(c, 'band')(r, at);
    if (at.i === 6) { const [W, H] = c.size(r); logic(c, c.sub(r, -W * 0.36, -W * 0.02, -H * 0.3, H * 0.3)); logic(c, c.sub(r, W * 0.04, W * 0.38, -H * 0.3, H * 0.3)); }
    if (at.i === 9) indicator(c, c.sub(r, -0.011, 0.011, -0.011, 0.011), eye);
  });
  if (clear) return clearTop(K, state, scheme, rnd, R, yc, eye, c);
  // six broad panels, the front one under the eye
  row(c, el(21.5), el(50), [30, 60, 60, 60, 60, 60, 30], plain(c, 'domeskin'));
  // six wedges and a cap
  row(c, el(52.5), el(78.5), Array(6).fill(60), plain(c, 'crown'));
  const cap = [[R * cos(rad(81)) - 0.002, yc + R * sin(rad(81)) - 0.006]];
  for (let i = 0; i <= 5; i++) { const e = rad(81 + 9 * (i / 5)); cap.push([i === 5 ? 0 : R * cos(e), yc + R * sin(e) + 0.0006]); }
  m.lathe(cap, { role: c.role('cap', { i: 0 }), smooth: [false, false, true, true, true, true, true], segs: 40 });
  // the eye, in a raised housing; the holoprojector off to one side; a small sensor up top
  housing(c, [rad(-12.5), rad(12.5), el(24), el(48)], 0.03);
  lens(K, c.seat(0, el(36), 0.0035), 0.03, eye);
  projector(K, c.seat(rad(40), el(27)), rad(8));
  projector(K, c.seat(rad(-118), el(62)), 0);
  lens(K, c.seat(rad(-36), el(38)), 0.011, lin('#9fd4ff'), { h: 0.004, halo: 3 });
}

/* ---------------- clear: the round dome's base with a glass top and the works inside ---------------- */
function clearTop(K, state, scheme, rnd, R, yc, eye, c) {
  const m = K.main, e0 = rad(20.5), y0 = yc + R * sin(e0), r0 = R * cos(e0);
  // the rim the glass sits in, and the glass
  m.lathe([[r0 - 0.012, y0 - 0.004], [r0 + 0.001, y0 - 0.004], [r0 + 0.001, y0 + 0.003], [r0 - 0.004, y0 + 0.005], [r0 - 0.012, y0 + 0.005]], { role: ROLE.metal, segs: 72 });
  const glass = []; for (let i = 0; i <= 14; i++) { const e = e0 + (PI / 2 - e0) * (i / 14); glass.push([i === 14 ? 0 : (R - 0.002) * cos(e), yc + (R - 0.002) * sin(e)]); }
  K.clear.lathe(glass, { smooth: true, segs: 56, wear: false });
  // the deck inside
  const yd = y0 - 0.002;
  m.lathe([[r0 - 0.008, yd - 0.01], [r0 - 0.008, yd], [0, yd]], { role: ROLE.dark, segs: 48, wear: false });
  m.at(M.mul(M.t(0, yd, 0), M.rx(-PI / 2)), (b) => {   // local z is up from the deck
    // the processor stack in the middle
    b.cyl(0.062, 0, 0.012, { role: ROLE.steel, n: 28, bevel: 0.002 });
    b.cyl(0.05, 0.012, 0.05, { role: ROLE.dark, n: 24, bevel: 0.002 });
    for (let k = 0; k < 4; k++) b.cyl(0.058, 0.016 + k * 0.009, 0.0205 + k * 0.009, { role: ROLE.brass, n: 28, bevel: 0.001 });
    b.cyl(0.03, 0.05, 0.085, { role: ROLE.metal, n: 20, bevel: 0.003 });
    b.cyl(0.04, 0.085, 0.092, { role: ROLE.steel, n: 24, bevel: 0.002 });
    b.at(M.t(0, 0, 0.104), (q) => q.ball(0.017, { role: ROLE.brass }));
    // three circuit towers round it
    for (const [a, hh, w] of [[2.2, 0.075, 0.03], [3.5, 0.058, 0.038], [4.9, 0.09, 0.026]]) {
      const x = 0.118 * cos(a), y = 0.118 * sin(a);
      b.at(M.mul(M.t(x, y, 0), M.rz(a)), (q) => { q.prism(rrect(0.022, w, 0.003, 2), 0, hh, { role: ROLE.steel, bevel: 0.002 }); q.prism(rrect(0.026, w * 0.7, 0.002, 2), hh * 0.3, hh * 0.38, { role: ROLE.brass, bevel: 0.001 }); q.prism(rrect(0.026, w * 0.7, 0.002, 2), hh * 0.62, hh * 0.7, { role: ROLE.metal, bevel: 0.001 }); });
    }
    // cables from the stack out to the towers and the rim
    for (const [a, role, rr] of [[2.2, ROLE.rubber, 0.0038], [3.5, ROLE.brass, 0.003], [4.9, ROLE.rubber, 0.0038], [0.7, ROLE.brass, 0.003], [5.7, ROLE.rubber, 0.003]])
      b.tube([[0.03 * cos(a), 0.03 * sin(a), 0.07], [0.07 * cos(a + 0.2), 0.07 * sin(a + 0.2), 0.082], [0.105 * cos(a + 0.1), 0.105 * sin(a + 0.1), 0.05], [0.125 * cos(a), 0.125 * sin(a), 0.012]], rr, { role, sides: 6 });
    // the eye's own housing on a short post, looking out through the glass
    b.prism(rrect(0.03, 0.03, 0.004, 2, 0, -0.105), 0, 0.03, { role: ROLE.steel, bevel: 0.002 });
    b.prism(rrect(0.082, 0.062, 0.008, 3, 0, -0.112), 0.028, 0.088, { role: c.role('eye', { deg: 0, i: 0 }), bevel: 0.004 });
  });
  lens(K, M.mul(M.t(0, yd + 0.058, 0.143), M.rx(-0.06)), 0.024, eye, { h: 0.005 });
  // small lights among the works
  for (const [x, y, z, col] of [[0.045, 0.058, -0.04, [0.3, 0.6, 1]], [-0.06, 0.04, 0.03, [1, 0.5, 0.1]], [0.0, 0.11, 0.0, [0.5, 0.8, 1]], [-0.03, 0.075, -0.08, [0.2, 1, 0.5]]]) {
    K.glow.color = col; K.glow.at(M.t(x, yd + y, z), (b) => b.ball(0.0055, { n: 6, segs: 10 }));
    K.halo([x, yd + y, z], [0, 0, 0], col, 0.05);
  }
  projector(K, c.seat(rad(40), R * rad(11)), rad(-6));
}

/* ---------------- flat top ---------------- */
function flat(K, state, scheme, rnd, R0) {
  const m = K.main, eye = lin(state.eyeColor || '#e53a2b');
  // a collar of small blocks under the head
  const rc = R0 - 0.026, yk = 0.04, cmap = turned(profile.cyl(rc, 0.002), { uvR: R0 }), cc = context(K, cmap, scheme, rnd);
  m.lathe([[rc - 0.02, 0.0015], [rc, 0.0015], [rc, yk], [rc - 0.02, yk]], { role: ROLE.dark, segs: 64, wear: false });
  for (let k = 0; k < 24; k++) { const u0 = rad(-180 + k * 15), wide = k % 3 !== 2; m.panel(cmap, u0 + rad(wide ? 1 : 3.5), u0 + rad(wide ? 14 : 11.5), 0.006, yk - 0.008, { h: wide ? 0.0045 : 0.007, gap: 0, rad: 0.002, role: wide ? ROLE.metal : ROLE.steel, wall: { out: 0.001, dh: -0.006 }, seed: rnd() }); }
  // the head: a short cone, narrower at the top, with a flat lid
  const r0 = R0 - 0.008, r1 = 0.172, yt = 0.208, cone = profile.cone(r0, yk, r1, yt), map = turned(cone, { uvR: R0 }), c = context(K, map, scheme, rnd), Ls = cone.len;
  m.lathe([[r0 - 0.012, yk - 0.004], [r0 - 0.012, yk], [r1 - 0.012, yt], [0, yt]], { role: ROLE.dark, segs: 48, wear: false });
  m.lathe([[r0 - 0.02, yk - 0.003], [r0 + 0.001, yk - 0.003], [r0 + 0.002, yk + 0.002], [r0 - 0.004, yk + 0.004]], { role: c.role('hub'), segs: 72 });
  row(c, 0.006, Ls * 0.27, Array(12).fill(30), (r, at) => {
    plain(c, 'band')(r, at);
    if (at.i === 4) { const [W, H] = c.size(r); logic(c, c.sub(r, -W * 0.4, -W * 0.03, -H * 0.28, H * 0.28)); logic(c, c.sub(r, W * 0.03, W * 0.4, -H * 0.28, H * 0.28)); }
    if (at.i === 7) indicator(c, c.sub(r, -0.01, 0.01, -0.01, 0.01), eye);
  });
  row(c, Ls * 0.27, Ls - 0.004, [36, 72, 72, 72, 72, 36], plain(c, 'domeskin'));
  // the lid: a rim, wedge panels and a raised centre
  const tmap = turned(profile.top(yt + 0.001, r1), { uvR: R0 }), tc = context(K, tmap, scheme, rnd);
  m.lathe([[r1 - 0.012, yt - 0.004], [r1 + 0.0015, yt - 0.004], [r1 + 0.0015, yt + 0.002], [r1 - 0.002, yt + 0.0045], [r1 - 0.012, yt + 0.0045]], { role: c.role('hub'), segs: 72 });
  row(tc, 0.012, r1 - 0.058, Array(5).fill(72), plain(tc, 'crown'));
  m.lathe([[0.052, yt - 0.002], [0.052, yt + 0.008], [0.047, yt + 0.012], [0, yt + 0.012]], { role: c.role('cap', { i: 0 }), segs: 36 });
  // one main eye and two small sensors beside it, in a low wide housing; a slot on the other side
  const ve = Ls * 0.63;
  housing(c, [rad(-21), rad(21), Ls * 0.38, Ls * 0.88], 0.026, 'eye', 0.009);
  lens(K, c.seat(0, ve, 0.003), 0.026, eye);
  lens(K, c.seat(rad(14.5), ve + 0.017, 0.009), 0.009, lin('#9fd4ff'), { h: 0.003, halo: 3 });
  lens(K, c.seat(rad(14.5), ve - 0.017, 0.009), 0.009, eye, { h: 0.003, halo: 3 });
  projector(K, c.seat(rad(47), Ls * 0.6), rad(4));
  m.panel(map, rad(-52), rad(-44), Ls * 0.36, Ls * 0.86, { h: 0.0016, gap: 0, rad: 0.004, role: ROLE.dark, wall: null, edge: false });
}

/* ---------------- conical ---------------- */
function cone(K, state, scheme, rnd, R0) {
  const m = K.main, eye = lin(state.eyeColor || '#e53a2b'), R = R0 - 0.0015, yk = 0.036, r1 = 0.108, yt = 0.298;
  // an upright band, then the cone
  const bmap = turned(profile.cyl(R, 0.003), { uvR: R0 }), bc = context(K, bmap, scheme, rnd);
  m.lathe([[R - 0.012, 0.002], [R - 0.012, yk], [r1 - 0.012, yt], [0, yt]], { role: ROLE.dark, segs: 48, wear: false });
  row(bc, 0.001, yk - 0.004, Array(12).fill(30), (r, at) => {
    plain(bc, 'band', { rad: 0.003 })(r, at);
  });
  const prof = profile.cone(R, yk, r1, yt), map = turned(prof, { uvR: R0 }), c = context(K, map, scheme, rnd), Ls = prof.len;
  row(c, 0.002, Ls * 0.46, [22.5, 45, 45, 45, 45, 45, 45, 45, 22.5], (r, at) => {
    plain(c, 'domeskin')(r, at);
    const [W, H] = c.size(r);
    if (at.i === 3) { logic(c, c.sub(r, -W * 0.3, W * 0.02, -H * 0.4, -H * 0.2)); logic(c, c.sub(r, -W * 0.3, W * 0.02, -H * 0.14, H * 0.06)); }
    if (at.i === 5) indicator(c, c.sub(r, -0.011, 0.011, -H * 0.25 - 0.011, -H * 0.25 + 0.011), eye);
  });
  row(c, Ls * 0.46, Ls - 0.004, Array(8).fill(45), plain(c, 'crown'));
  // the lid
  m.lathe([[r1 - 0.012, yt - 0.004], [r1 + 0.0015, yt - 0.004], [r1 + 0.0015, yt + 0.002], [r1 - 0.003, yt + 0.006], [0.03, yt + 0.006], [0.03, yt + 0.011], [0, yt + 0.011]], { role: c.role('cap', { i: 0 }), segs: 56 });
  // the eye low on the cone, a second lens near the top
  housing(c, [rad(-13), rad(13), Ls * 0.1, Ls * 0.42], 0.028, 'eye', 0.012);
  lens(K, c.seat(0, Ls * 0.26, 0.004), 0.028, eye);
  lens(K, c.seat(0, Ls * 0.78, 0.0005), 0.014, lin('#9fd4ff'), { h: 0.006, halo: 3 });
  projector(K, c.seat(rad(38), Ls * 0.2), rad(6));
}
export function buildDome(K, state, scheme, rnd, R) {
  if (state.dome === 'flat') flat(K, state, scheme, rnd, R);
  else if (state.dome === 'cone') cone(K, state, scheme, rnd, R);
  else round(K, state, scheme, rnd, R, state.dome === 'clear');
}
