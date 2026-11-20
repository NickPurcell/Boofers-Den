// Things a utility droid can carry: a tool arm folded out of the barrel, an antenna and a scope on the dome, and a
// restraining bolt on the chest. Each adds to the pieces utility.js built (the body or the dome), in that piece's frame.
import * as THREE from 'three';
import { ROLE, M, rad, ngon, rrect } from './hard.js';
import { DIM } from './utility.js';
import { lens } from './domes.js';

const { PI, sin, cos } = Math;
export const FITTINGS = {
  arm: { name: 'Tool arm' },
  antenna: { name: 'Antenna' },
  scope: { name: 'Scope' },
  bolt: { name: 'Restraining bolt' },
};
// where things stand on each dome: [x, y, z] in the dome's frame
const MOUNTS = {
  round: { antenna: [-0.062, 0.228, -0.058], scope: [0.07, 0.222, -0.062] },
  clear: { antenna: [-0.14, 0.098, -0.165], scope: [0.15, 0.098, -0.155] },
  flat: { antenna: [-0.092, 0.209, -0.062], scope: [0.088, 0.209, -0.058] },
  cone: { antenna: [-0.052, 0.303, -0.042], scope: [0.05, 0.303, -0.046] },
};
// a rod from p to q: a frame with local z along it
function along(p, q) {
  const z = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]), len = z.length(); z.normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(z); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return [new THREE.Matrix4().makeBasis(x, y, z).setPosition(p[0], p[1], p[2]), len];
}
const rod = (b, p, q, r, role, n = 12) => { const [m, len] = along(p, q); b.at(m, (k) => k.cyl(r, 0, len, { role, n, bevel: Math.min(0.0015, r * 0.3) })); };
const up = (p) => M.mul(M.t(p[0], p[1], p[2]), M.rx(-PI / 2));   // local z is up, standing at p

// an antenna standing at p in piece K
export function antennaAt(K, p, tall = 0.24) {
  K.main.at(up(p), (b) => {
    b.cyl(0.013, -0.02, 0.01, { role: ROLE.steel, n: 16, bevel: 0.002 });
    b.cyl(0.0075, 0.01, 0.03, { role: ROLE.metal, n: 12, bevel: 0.001 });
    b.loft([{ o: ngon(0.0034, 8), z: 0.03 }, { o: ngon(0.0018, 8), z: tall }], { role: ROLE.metal, wear: false });
    b.at(M.t(0, 0, tall * 0.4), (q) => q.ball(0.0058, { role: ROLE.brass, n: 6, segs: 10 }));
  });
  K.glow.color = [1, 0.25, 0.12];
  K.glow.at(M.t(p[0], p[1] + tall + 0.003, p[2]), (b) => b.ball(0.0042, { n: 6, segs: 10 }));
  K.halo([p[0], p[1] + tall + 0.003, p[2]], [0, 0, 0], [1, 0.25, 0.12], 0.045);
}
function antenna(kits, state) { antennaAt(kits.dome, (MOUNTS[state.dome] || MOUNTS.round).antenna); }
function scope(kits, state) {
  const K = kits.dome, p = (MOUNTS[state.dome] || MOUNTS.round).scope, hgt = 0.13;
  K.main.at(up(p), (b) => {
    b.cyl(0.017, -0.02, 0.008, { role: ROLE.steel, n: 18, bevel: 0.002 });
    b.cyl(0.0095, 0.008, hgt, { role: ROLE.metal, n: 14, bevel: 0.001 });
    b.cyl(0.012, hgt * 0.45, hgt * 0.45 + 0.012, { role: ROLE.steel, n: 14, bevel: 0.002 });
    b.prism(rrect(0.042, 0.05, 0.006, 3, 0, -0.004), hgt, hgt + 0.036, { role: ROLE.steel, bevel: 0.004 });   // the head (local y runs backward)
  });
  lens(K, M.mul(M.t(p[0], p[1] + hgt + 0.018, p[2] + 0.029), M.rx(-0.05)), 0.0115, [0.55, 0.8, 1.0], { h: 0.004, halo: 3.5 });
}
function arm(kits, state) {
  const K = kits.body, R = DIM.R, u = rad(27), y = 0.055, n = [sin(u), 0, cos(u)];
  const add = (p, d) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
  const P0 = [R * n[0], y, R * n[2]], P1 = add(P0, [n[0] * 0.05, 0.004, n[2] * 0.05]), P2 = add(P1, [0.05, 0.035, 0.12]), P3 = add(P2, [-0.04, -0.085, 0.085]);
  const b = K.main;
  // a collar on the barrel, two links with ball joints, a three-fingered gripper
  const [m0] = along(P0, P1); b.at(m0, (k) => k.cyl(0.021, -0.004, 0.012, { role: ROLE.steel, n: 18, bevel: 0.002 }));
  rod(b, P0, P1, 0.011, ROLE.metal); rod(b, P1, P2, 0.0085, ROLE.metal); rod(b, P2, P3, 0.0072, ROLE.metal);
  for (const [p, r] of [[P1, 0.0155], [P2, 0.0135], [P3, 0.0115]]) b.at(M.t(p[0], p[1], p[2]), (k) => k.ball(r, { role: ROLE.steel, n: 8, segs: 14 }));
  const mid = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  rod(b, mid(P1, P2, 0.25), mid(P1, P2, 0.7), 0.0115, ROLE.brass, 10);
  const [mw] = along(P2, P3), wrist = M.mul(M.t(P3[0], P3[1], P3[2]), new THREE.Matrix4().extractRotation(mw));
  b.at(wrist, (k) => {
    k.cyl(0.0135, 0.006, 0.02, { role: ROLE.steel, n: 12, bevel: 0.002 });
    for (let i = 0; i < 3; i++) k.at(M.mul(M.rz((i / 3) * 2 * PI), M.t(0.009, 0, 0.018), M.ry(0.42)), (f) => {
      f.prism(rrect(0.006, 0.009, 0.001, 1), 0, 0.03, { role: ROLE.metal, bevel: 0.001 });
      f.at(M.mul(M.t(0, 0, 0.03), M.ry(-0.95)), (g) => g.prism(rrect(0.005, 0.008, 0.001, 1), -0.002, 0.022, { role: ROLE.metal, bevel: 0.001 }));
    });
  });
}
// a restraining bolt seated at m (local z out of the surface) in piece K
export function boltAt(K, m) {
  K.main.at(m, (b) => {
    b.cyl(0.019, -0.002, 0.007, { role: ROLE.steel, n: 18, bevel: 0.002 });
    b.cyl(0.0145, 0.007, 0.019, { role: ROLE.dark, n: 16, bevel: 0.002 });
    b.cyl(0.0165, 0.01, 0.0135, { role: ROLE.brass, n: 16, bevel: 0.001 });
    b.cyl(0.008, 0.019, 0.022, { role: ROLE.steel, n: 10, bevel: 0.001 });
  });
  const p = new THREE.Vector3(0, 0, 0.0226).applyMatrix4(m), nn = new THREE.Vector3(0, 0, 1).transformDirection(m);
  K.glow.color = [1, 0.15, 0.08];
  K.glow.at(M.mul(m, M.t(0, 0, 0.0222)), (b) => b.cyl(0.0034, 0, 0.0012, { n: 8, bevel: 0 }));
  K.halo([p.x, p.y, p.z], [nn.x, nn.y, nn.z], [1, 0.15, 0.08], 0.05);
}
function bolt(kits, state) { boltAt(kits.body, M.mul(M.ry(rad(-33)), M.t(0, 0.04, DIM.R))); }
const MAKE = { arm, antenna, scope, bolt };
export function addFittings(kits, state, on) { for (const k of Object.keys(MAKE)) if (on.has(k)) MAKE[k](kits, state); }
