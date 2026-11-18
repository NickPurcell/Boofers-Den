// What a character carries: a saber hilt hung at the hip, a longer double-bladed hilt across the small of the back,
// or a fighting staff slung over one shoulder. Hard-edged things, so they are built with the droid page's
// hard-surface kit (../droid-creator/hard.js) and painted by its material, with our own shapes: no real prop's.
import * as THREE from 'three';
import { Builder, ROLE, M } from '../droid-creator/hard.js';
import { noiseTexture, paintMaterial } from '../droid-creator/paint.js';
import { skeleton } from './anatomy.js';

export const GEAR = { none: { name: 'Nothing' }, hilt: { name: 'Saber hilt' }, double: { name: 'Double-bladed hilt' }, staff: { name: 'Staff' } };
// how far the clothes stand out at the hip and the back, per outfit, so the thing hangs on them and not in them
const OUT = { wraps: [0.028, 0.03], armour: [0.02, 0.03], plate: [0.04, 0.04], jacket: [0.024, 0.03], coat: [0.045, 0.05], robe: [0.04, 0.045] };
let mat = null;
export function gearMaterial() { if (!mat) { mat = paintMaterial(noiseTexture(128)); mat.userData.u.uWear.value = 0.3; mat.userData.u.uPrimary.value.set('#2a2c31'); mat.userData.u.uSecondary.value.set('#7a1f1f'); } return mat; }

// a hilt along local y, centred, `len` long: grip rings, a flared emitter at the top (and at the bottom if double)
function hilt(b, len, double) {
  const h = len / 2, r = 0.0165, pts = [];
  const end = (s) => [[0.012, s * h], [0.021, s * h], [0.0225, s * (h - 0.006)], [0.0225, s * (h - 0.03)], [0.0185, s * (h - 0.034)], [0.0185, s * (h - 0.05)]];
  if (double) pts.push(...end(-1)); else pts.push([0.0, -h], [0.019, -h], [0.021, -h + 0.006], [0.021, -h + 0.02], [r, -h + 0.024]);
  pts.push([r, -h + (double ? 0.05 : 0.024) + 0.001], [r, h - 0.051]);
  pts.push(...end(1).reverse());
  b.lathe(pts, { role: ROLE.metal, segs: 24 });
  // grip rings and a switch
  const n = double ? 9 : 5, g0 = double ? -0.06 : -h + 0.04;
  for (let k = 0; k < n; k++) { const y = g0 + k * 0.0145; b.lathe([[r, y], [r + 0.0028, y + 0.002], [r + 0.0028, y + 0.0085], [r, y + 0.0105]], { role: ROLE.dark, segs: 24 }); }
  b.at(M.t(0, h - 0.075, r + 0.001), (q) => q.box(0.009, 0.022, 0.006, { role: ROLE.brass, rad: 0.002, bevel: 0.0015 }));
  for (const s of double ? [1, -1] : [1]) b.at(M.mul(M.t(0, s * (h - 0.001), 0), M.rx(-s * Math.PI / 2)), (q) => q.cyl(0.011, -0.004, 0.0, { role: ROLE.dark, n: 14, bevel: 0 }));
  // the ring it hangs by
  b.at(M.t(0, double ? 0 : h - 0.062, -r - 0.004), (q) => q.box(0.016, 0.02, 0.01, { role: ROLE.steel, rad: 0.003, bevel: 0.002 }));
}
function staff(b, len) {
  const h = len / 2;
  b.lathe([[0, -h], [0.014, -h], [0.016, -h + 0.01], [0.0125, -h + 0.05], [0.0115, -0.2], [0.0135, -0.19], [0.0135, 0.19], [0.0115, 0.2], [0.0125, h - 0.05], [0.016, h - 0.01], [0.014, h], [0, h]], { role: ROLE.primary, segs: 16 });
  for (const s of [1, -1]) { b.lathe([[0.0128, s * (h - 0.12)], [0.0165, s * (h - 0.118)], [0.0165, s * (h - 0.06)], [0.0128, s * (h - 0.058)]].sort((p, q) => p[1] - q[1]), { role: ROLE.metal, segs: 16 }); b.lathe([[0.0138, s * 0.205 - 0.006], [0.0162, s * 0.205 - 0.004], [0.0162, s * 0.205 + 0.004], [0.0138, s * 0.205 + 0.006]], { role: ROLE.brass, segs: 16 }); }
  for (let k = -6; k <= 6; k++) b.lathe([[0.0135, k * 0.027 - 0.008], [0.0152, k * 0.027 - 0.006], [0.0152, k * 0.027 + 0.006], [0.0135, k * 0.027 + 0.008]], { role: ROLE.secondary, segs: 16 });   // a bound grip
}
// kind: a key of GEAR; o: the figure's { masc, build }; outfit: the outfit's key. Returns a mesh placed on the figure, or null.
export function makeGear(kind, o, outfit) {
  if (!kind || kind === 'none' || !GEAR[kind]) return null;
  const S = skeleton(o), [hipOut, backOut] = OUT[outfit] || OUT.wraps, b = new Builder();
  if (kind === 'hilt') b.at(M.mul(M.t(S.hip[0] + 0.07 + hipOut, S.waistY - 0.15, 0.03), M.ry(Math.PI / 2), M.rx(0.06)), (q) => hilt(q, 0.27, false));
  else if (kind === 'double') b.at(M.mul(M.t(0, S.waistY - 0.035, -(0.105 + backOut)), M.rz(Math.PI / 2 - 0.32), M.ry(Math.PI)), (q) => hilt(q, 0.5, true));
  else b.at(M.mul(M.t(0.02, 1.02, -(0.125 + backOut)), M.rz(-0.42)), (q) => staff(q, 1.62));
  const m = new THREE.Mesh(b.geometry(), gearMaterial()); m.castShadow = m.receiveShadow = true; m.name = 'gear';
  return m;
}
