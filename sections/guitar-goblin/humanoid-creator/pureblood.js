// A Sith Pureblood's head: what the species adds to the shared human head. From a study of many of them (never one
// person): the brow runs out past the eye into a bone spur that sweeps back toward the temple; a smaller spur stands
// on the cheekbone; low ridges run down the cheek to the jaw and up the forehead between the brows; and pointed
// fleshy tendrils hang from the chin and along the jaw. All of it is joined softly onto the head as built, so it
// follows the face's shape. Pure: the workers import it.
//
// Interface (see head-field.js): purebloodExtra(o) -> { add(P, head), below(P), tendrils(P) }
//   o.spurs: 'none' | 'small' | 'large';  o.tendrils: 'none' | 'chin' | 'jaw' | 'long';  o.ridges: 'none' | 'light' | 'heavy'
//   P: the face's landmarks (head-field.js landmarks()), head: the head's field so far.
import { roundCone, capsule, smin, mirrorX, cast } from '../duros-creator/sdf.js';

export const SPURS = { none: { name: 'None' }, small: { name: 'Small' }, large: { name: 'Large' } };
export const TENDRILS = { none: { name: 'None' }, chin: { name: 'Chin pair' }, jaw: { name: 'Jaw fringe' }, long: { name: 'Long' } };
export const RIDGES = { none: { name: 'Smooth' }, light: { name: 'Light' }, heavy: { name: 'Heavy' } };

// the tendrils on the figure's left half, root to tip: [{ a, b, r0, r1 }]; x = 0 ones are single, the rest mirrored
export function tendrilList(P, kind) {
  if (!kind || kind === 'none') return [];
  const Y = (y) => y * P.L, cw = P.cw, jw = P.jw, out = [], T = (x, y, z, len, r, lean = 0) => out.push({ a: [x, Y(y), z], b: [x * 1.06, Y(y) - len, z + 0.004 - lean], r0: r, r1: 0.0019 });   // fleshy: broad where it grows from the jaw
  const big = kind === 'long';
  T(0.0135 * cw, -0.108, 0.07, big ? 0.058 : 0.03, big ? 0.0084 : 0.0076);
  if (kind === 'jaw' || big) { T(0.03 * jw, -0.103, 0.054, big ? 0.038 : 0.025, 0.007, 0.002); T(0.043 * jw, -0.092, 0.034, big ? 0.028 : 0.02, 0.0064, 0.003); }
  if (kind === 'jaw') T(0, -0.111, 0.076, 0.016, 0.006);
  return out;
}
const cone = (t) => roundCone(t.a, t.b, t.r0, t.r1);
const both = (list) => { const fs = list.map((t) => (t.a[0] === 0 ? cone(t) : mirrorX(cone(t)))); return (x, y, z) => { let d = Infinity; for (const f of fs) { const v = f(x, y, z); if (v < d) d = v; } return d; }; };
const rope = (pts, r) => { const segs = []; for (let i = 0; i + 1 < pts.length; i++) segs.push(capsule(pts[i], pts[i + 1], r)); return (x, y, z) => { let d = Infinity; for (const f of segs) { const v = f(x, y, z); if (v < d) d = v; } return d; }; };

export function purebloodExtra(o) {
  const spurs = o.spurs || 'small', ridges = o.ridges || 'light';
  return {
    add(P, head) {
      const Y = (y) => y * P.L, fw = P.fw, out = [];
      // a line laid on the face as built: points given from in front, pressed onto the surface and sunk a little
      const lay = (pts, sink) => pts.map(([x, y]) => { const hit = cast(head, [x, y, 0.3], [0, 0, -1], 0.5); return hit ? [hit.p[0], hit.p[1], hit.p[2] - sink] : [x, y, 0.07]; });
      if (spurs !== 'none') {
        const L = spurs === 'large' ? 1 : 0.6;
        // the brow, heavier, running out into its spur
        out.push([0.007, mirrorX(rope([[0.012, 0.0195, 0.0835], [0.03 * fw, 0.0235, 0.0825], [0.049 * fw, 0.022, 0.0735]], 0.0052 + 0.0016 * L))]);
        out.push([0.005, mirrorX(roundCone([0.046 * fw, 0.0215, 0.073], [(0.074 + 0.02 * L) * fw, 0.026 + 0.012 * L, 0.056 - 0.02 * L], 0.0074, 0.0015))]);   // it stands out from the temple, clear of the hair
        // and the smaller one on the cheekbone
        out.push([0.005, mirrorX(roundCone([0.052 * fw, Y(-0.024), 0.058], [(0.071 + 0.014 * L) * fw, Y(-0.018) + 0.004 * L, 0.04 - 0.01 * L], 0.0056, 0.0013))]);
      }
      if (ridges !== 'none') {
        const r = ridges === 'heavy' ? 0.0031 : 0.0024, sink = r * 0.45;
        // down the cheek to the jaw, two a side
        out.push([0.005, mirrorX(rope(lay([[0.046 * fw, Y(-0.034)], [0.045 * fw, Y(-0.052)], [0.041 * fw, Y(-0.07)]], sink), r))]);   // they stop above the jaw, clear of the tendrils
        out.push([0.005, mirrorX(rope(lay([[0.037 * fw, Y(-0.048)], [0.0355 * fw, Y(-0.062)], [0.033, Y(-0.074)]], sink), r * 0.85))]);
        // up the forehead from between the brows, and one down the chin
        out.push([0.004, rope(lay([[0, 0.026], [0, 0.04], [0, 0.055]], sink), r)]);
        out.push([0.004, mirrorX(rope(lay([[0.0085, 0.024], [0.0115, 0.038], [0.013, 0.05]], sink), r * 0.9))]);
        if (ridges === 'heavy') { out.push([0.004, mirrorX(rope(lay([[0.021, 0.028], [0.025, 0.04], [0.027, 0.05]], sink), r * 0.8))]); out.push([0.004, rope(lay([[0, Y(-0.09)], [0, Y(-0.104)]], sink), r)]); }
      }
      const tl = tendrilList(P, o.tendrils);
      if (tl.length) out.push([0.012, both(tl)]);   // a wide soft join: they grow out of the jaw
      return out;
    },
    // the parts of the tendrils that hang below the head's own mesh
    below(P) {
      const tl = tendrilList(P, o.tendrils);
      if (!tl.length || Math.min(...tl.map((t) => t.b[1])) > -0.124) return null;
      return { field: both(tl), bounds: [[-0.07, Math.min(...tl.map((t) => t.b[1])) - 0.006, 0.0], [0.07, 0, 0.1]] };
    },
    // every tendril on both sides, for the page to hang jewellery on
    tendrils(P) { const out = []; for (const t of tendrilList(P, o.tendrils)) { out.push(t); if (t.a[0] !== 0) out.push({ a: [-t.a[0], t.a[1], t.a[2]], b: [-t.b[0], t.b[1], t.b[2]], r0: t.r0, r1: t.r1 }); } return out; },
  };
}
