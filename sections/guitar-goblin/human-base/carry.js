// Human base: what a character carries, as the old page offered it: a saber hilt hung at the left hip, a double-bladed
// hilt across the small of the back, or a fighting staff slung across the back over one shoulder. Unlit (no blades).
// Hard-surface things, built with the droid page's kit (../droid-creator/hard.js, imported read-only) and painted by its
// material, in designs of our own: no real prop's, and no likeness of any one character's weapon.
//
//   const c = carry(fig);  c.set({ item: 'hilt' | 'double' | 'staff' | 'none', accent: '#hex', worn, wornKey });
//
// Each is placed from the figure's own surface after every reshape (the hip, the small of the back, between the
// shoulder blades), so it follows every build and the arms-down pose, and is pushed out past the body and past whatever
// is worn (worn(x, y, z): the signed distance in metres to the outside of the garments, as for the Pureblood's tendrils).
import * as THREE from 'three';
import { Builder, ROLE, M } from '../droid-creator/hard.js';
import { noiseTexture, paintMaterial } from '../droid-creator/paint.js';

export const ITEMS = { none: { name: 'Nothing' }, hilt: { name: 'Saber hilt' }, double: { name: 'Double-bladed hilt' }, staff: { name: 'Staff' } };

/* ---------------- the things themselves, along local y, centred ---------------- */
const ring = (b, r, y, w, role, rise = 0.0022) => b.lathe([[r, y - w / 2], [r + rise, y - w / 2 + 0.0015], [r + rise, y + w / 2 - 0.0015], [r, y + w / 2]], { role, segs: 28 });
// a saber hilt, 27 cm: a rounded pommel with a lanyard ring, a ribbed grip, a control box with its switch, a flared
// emitter shroud with vents, a clip on the back to hang it by. The emitter is at +y.
function saber(b, len = 0.27) {
  const h = len / 2, r = 0.0165;
  b.lathe([[0, -h], [0.011, -h], [0.0175, -h + 0.004], [0.0195, -h + 0.012], [0.0195, -h + 0.022], [0.0155, -h + 0.026], [0.0155, -h + 0.03], [r, -h + 0.032],
    [r, h - 0.082], [0.0182, h - 0.08], [0.0182, h - 0.05], [0.0168, h - 0.047], [0.0168, h - 0.042], [0.022, h - 0.036], [0.0245, h - 0.02], [0.0245, h - 0.006], [0.022, h], [0.0135, h], [0.0135, h - 0.012], [0, h - 0.012]], { role: ROLE.metal, segs: 32 });
  for (let k = 0; k < 7; k++) ring(b, r, -h + 0.045 + k * 0.0135, 0.0085, ROLE.dark);   // the grip's ribs
  ring(b, 0.0182, h - 0.065, 0.006, ROLE.brass, 0.0012);
  b.at(M.t(0, h - 0.068, 0.0175), (q) => { q.box(0.012, 0.03, 0.004, { role: ROLE.dark, rad: 0.002, bevel: 0.001 }); q.at(M.t(0, 0.004, 0.003), (s) => s.box(0.006, 0.01, 0.004, { role: ROLE.brass, rad: 0.0015, bevel: 0.001 })); });   // the switch
  for (let k = 0; k < 4; k++) b.at(M.mul(M.ry((k / 4) * Math.PI * 2 + Math.PI / 4), M.t(0, h - 0.018, 0.0242)), (q) => q.box(0.005, 0.014, 0.003, { role: ROLE.dark, rad: 0.0012, bevel: 0.0006 }));   // vents in the shroud
  b.at(M.mul(M.t(0, -h, 0), M.rx(Math.PI / 2)), (q) => { q.cyl(0.0042, -0.002, 0.004, { role: ROLE.steel, n: 12, bevel: 0.001 }); });
  b.at(M.t(0, -h + 0.006, 0), (q) => q.lathe([[0.0062, -0.009], [0.0078, -0.009], [0.0078, -0.007], [0.0062, -0.007]], { role: ROLE.steel, segs: 16 }));   // the lanyard ring's seat
  b.at(M.t(0, -h + 0.06, -r - 0.004), (q) => q.box(0.014, 0.034, 0.007, { role: ROLE.steel, rad: 0.003, bevel: 0.0015 }));   // the belt clip
}
// a double-bladed hilt, 50 cm: two emitter shrouds, a wrapped grip each side of a centre coupling with its seam, a
// switch on each half
function double(b, len = 0.5) {
  const h = len / 2, r = 0.0165;
  const half = (s) => {
    const pts = [[r, s * 0.012], [r, s * (h - 0.08)], [0.0185, s * (h - 0.078)], [0.0185, s * (h - 0.05)], [0.017, s * (h - 0.046)], [0.0225, s * (h - 0.036)], [0.0245, s * (h - 0.02)], [0.0245, s * (h - 0.006)], [0.022, s * h], [0.0135, s * h], [0.0135, s * (h - 0.012)], [0, s * (h - 0.012)]];
    b.lathe(s > 0 ? pts : pts.map(([x, y]) => [x, y]).reverse(), { role: ROLE.metal, segs: 32 });
    for (let k = 0; k < 4; k++) b.at(M.mul(M.ry((k / 4) * Math.PI * 2 + Math.PI / 4), M.t(0, s * (h - 0.018), 0.0242)), (q) => q.box(0.005, 0.014, 0.003, { role: ROLE.dark, rad: 0.0012, bevel: 0.0006 }));
    b.at(M.t(0, s * (h - 0.066), 0.0182), (q) => { q.box(0.011, 0.024, 0.004, { role: ROLE.dark, rad: 0.002, bevel: 0.001 }); q.at(M.t(0, 0, 0.003), (t) => t.box(0.005, 0.009, 0.004, { role: ROLE.brass, rad: 0.0015, bevel: 0.001 })); });
    for (let k = 0; k < 8; k++) ring(b, r, s * (0.03 + k * 0.0145), 0.011, ROLE.secondary, 0.0016);   // the wrap
  };
  half(1); half(-1);
  b.lathe([[r, -0.012], [0.0195, -0.01], [0.0195, -0.0015], [0.0175, -0.0015], [0.0175, 0.0015], [0.0195, 0.0015], [0.0195, 0.01], [r, 0.012]], { role: ROLE.steel, segs: 32 });   // the coupling and its seam
  b.at(M.t(0, 0, -0.0195), (q) => q.box(0.016, 0.018, 0.006, { role: ROLE.steel, rad: 0.003, bevel: 0.0015 }));   // what it hangs by
}
// a fighting staff, about head-high: a wooden shaft tapering a little to each end, metal ferrules and bands, a bound
// grip at the middle and a narrower binding toward each end
function staff(b, len) {
  const h = len / 2;
  b.lathe([[0, -h], [0.0135, -h], [0.0155, -h + 0.008], [0.0128, -h + 0.06], [0.0142, -0.25], [0.0148, 0], [0.0142, 0.25], [0.0128, h - 0.06], [0.0155, h - 0.008], [0.0135, h], [0, h]], { role: ROLE.primary, segs: 18, smooth: [false, false, false, true, true, true, true, true, false, false, false] });
  for (const s of [1, -1]) {
    const pts = [[0.0136, h - 0.11], [0.0166, h - 0.106], [0.0166, h - 0.012], [0.0158, h - 0.004], [0.0, h + 0.002]].map(([x, y]) => [x, s * y]);
    b.lathe(s > 0 ? pts : pts.slice().reverse(), { role: ROLE.metal, segs: 18 });   // the ferrule
    ring(b, 0.0145, s * 0.27, 0.01, ROLE.brass, 0.0016);
    for (let k = 0; k < 5; k++) ring(b, 0.0132, s * (h - 0.16 - k * 0.012), 0.009, ROLE.secondary, 0.0014);   // a binding toward the end
  }
  for (let k = -9; k <= 9; k++) ring(b, 0.0148, k * 0.022, 0.017, ROLE.secondary, 0.0016);   // the bound grip
}

/* ---------------- where they go ---------------- */
let mat = null;
function material() { if (!mat) { mat = paintMaterial(noiseTexture(128)); const u = mat.userData.u; u.uWear.value = 0.28; u.uPrimary.value.set('#3a2c20'); u.uSecondary.value.set('#5a1c1c'); } return mat; }

export function carry(fig) {
  const B = fig.B, group = new THREE.Group(); group.name = 'carry'; fig.add(group);
  const opt = { item: 'none', accent: '#5a1c1c' }; let worn = null, built = null, builtFor = '';
  const side = B.marks.side;   // +x is the figure's left
  // surface points by rule, on the posed base mesh (metres): the most outward vertex in direction d at height y
  const extreme = (y, dx, dz, band = 0.015) => {
    const P = fig.p0; let best = -1, bv = -Infinity;
    for (let i = 0; i < B.N; i++) { if (!B.inBody[i] || B.armW[i] > 40 || Math.abs(P[i * 3 + 1] - y) > band) continue; const v = P[i * 3] * dx + P[i * 3 + 2] * dz; if (v > bv) { bv = v; best = i; } }
    return best;
  };
  const pn = (i) => [[fig.p0[i * 3], fig.p0[i * 3 + 1], fig.p0[i * 3 + 2]], new THREE.Vector3(fig.n0[i * 3], fig.n0[i * 3 + 1], fig.n0[i * 3 + 2]).normalize()];
  // the body near a point, as the distance along the nearest vertex's normal (for the push past it)
  const bodyD = (x, y, z) => {
    const P = fig.p0, N = fig.n0; let best = -1, bd = Infinity;
    for (let i = 0; i < B.N; i++) { if (!B.inBody[i]) continue; const dx = x - P[i * 3], dy = y - P[i * 3 + 1], dz = z - P[i * 3 + 2], d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; best = i; } }
    return (x - P[best * 3]) * N[best * 3] + (y - P[best * 3 + 1]) * N[best * 3 + 1] + (z - P[best * 3 + 2]) * N[best * 3 + 2];
  };
  // how far along `out` the thing must move so that every sample along its axis clears the body and what is worn
  const clearance = (centre, axis, out, half, radius) => {
    let need = 0;
    for (let k = -4; k <= 4; k++) {
      const t = (k / 4) * half, p = centre.clone().addScaledVector(axis, t);
      for (let it = 0; it < 24; it++) { const q = p.clone().addScaledVector(out, need), d = Math.min(bodyD(q.x, q.y, q.z), worn ? worn(q.x, q.y, q.z) : 1); if (d >= radius + 0.004) break; need += Math.max(0.002, radius + 0.004 - d); }
    }
    return need;
  };
  const frame = (axis, out, centre) => { const y = axis.clone().normalize(), z = out.clone().addScaledVector(y, -out.dot(y)).normalize(), x = new THREE.Vector3().crossVectors(y, z); return new THREE.Matrix4().makeBasis(x, y, z).setPosition(centre); };

  function place() {
    if (!built) return;
    const J = (n) => new THREE.Vector3(...fig.joint(n)), H = fig.height;
    let m;
    if (opt.item === 'hilt') {
      // at the left hip, a little forward of the side, hung from the belt by its clip, emitter down and tipped forward
      const yb = J('l-upper-leg').y + 0.075 * (H / 1.75), i = extreme(yb, side * Math.cos(0.68), Math.sin(0.68)), [p, n] = pn(i);
      const axis = new THREE.Vector3(side * 0.1, 1, -0.22).normalize(), out = new THREE.Vector3(n.x, 0, n.z).normalize(), centre = new THREE.Vector3(...p).addScaledVector(axis, -0.27 / 2 + 0.05);
      centre.addScaledVector(out, clearance(centre, axis, out, 0.135, 0.022));
      m = frame(axis.clone().negate(), out, centre);   // emitter (+y) down
    } else if (opt.item === 'double') {
      // across the small of the back, tipped a little, hung from its centre
      const yb = fig.landmark('backLow').p[1], i = extreme(yb, 0, -1, 0.02), [p] = pn(i), tilt = 0.26;   // (spine joints count from the top)
      const axis = new THREE.Vector3(Math.cos(tilt), Math.sin(tilt), 0), out = new THREE.Vector3(0, 0, -1), centre = new THREE.Vector3(...p);
      centre.addScaledVector(out, clearance(centre, axis, out, 0.25, 0.025));
      m = frame(axis, out, centre);
    } else {
      // slung across the back, from low on the right to over the left shoulder
      const yb = fig.landmark('backMid').p[1], i = extreme(yb, 0, -1, 0.02), [p] = pn(i), tilt = 0.22;
      const axis = new THREE.Vector3(side * Math.sin(tilt), Math.cos(tilt), -0.05).normalize(), out = new THREE.Vector3(0, 0, -1), centre = new THREE.Vector3(...p).add(new THREE.Vector3(0, 0.07, 0));
      centre.addScaledVector(out, clearance(centre, axis, out, built.len / 2, 0.019));
      m = frame(axis, out, centre);
    }
    built.mesh.matrix.copy(m); built.mesh.matrixWorldNeedsUpdate = true;
  }
  function build() {
    const key = `${opt.item}|${opt.item === 'staff' ? Math.round(fig.height * 50) : 0}`;
    if (key === builtFor) return; builtFor = key;
    if (built) { group.remove(built.mesh); built.mesh.geometry.dispose(); built = null; }
    if (opt.item === 'none' || !ITEMS[opt.item]) return;
    const b = new Builder(), len = opt.item === 'staff' ? Math.min(1.75, fig.height * 0.92) : 0;
    if (opt.item === 'hilt') saber(b); else if (opt.item === 'double') double(b); else staff(b, len);
    const mesh = new THREE.Mesh(b.geometry(), material()); mesh.castShadow = mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; group.add(mesh);
    built = { mesh, len };
  }
  fig.addEventListener('shaped', () => { build(); place(); });
  const api = {
    group, items: ITEMS,
    set(o = {}) {
      if ('worn' in o) worn = o.worn || null;
      if (o.item !== undefined) opt.item = o.item;
      if (o.accent) { opt.accent = o.accent; material().userData.u.uSecondary.value.set(o.accent); }
      build(); place(); return api;
    },
  };
  return api;
}
