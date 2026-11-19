// A Sith Pureblood's head: what the species grows on the shared human skull. From a study of 88 pictures of many of
// them (never one person; notes in the workspace): the skull is a human's, but the brow is a heavier, lower shelf and
// the cheekbones stand out high and sharp over hollow cheeks; long low folds run down the cheeks and up the forehead;
// spurs grow out of the bone with broad roots at the brow's end, the cheekbone and the jaw's angle; and fleshy
// tendrils grow from the chin, the jawline and the cheeks and hang under their own weight like a beard of flesh, while
// the jaw above them stays firm. All of it is built on the head as it stands, so it follows every face shape.
// Pure: the workers import it.
//
// Interface (see head-field.js `extra`): purebloodExtra(o) -> { add(P, head), cut(P, head), below(P), anchors(P, head) }
//   o.spurs: a key of SPURS; o.ridges: a key of RIDGES; o.tendrils: a key of TENDRILS; o.tlength: a key of TLENGTHS;
//   o.masc: 0 (feminine) to 1 (masculine); o.age: 0 to 1.
//   P: the face's landmarks (head-field.js landmarks()); head: the head's field so far, in the same frame (metres from the
//   point between the eyes, y up, facing +z, the figure's left at +x).
//   anchors(P, head) tells the page where jewellery can go: each tendril's path and radius, the spurs' roots, the chin,
//   the nose and a line across the brow for a circlet.
import { roundCone, capsule, ellipsoid, mirrorX, cast, gradient, project } from '../duros-creator/sdf.js';

export const SPURS = { none: { name: 'None' }, brow: { name: 'Brow' }, brow_cheek: { name: 'Brow and cheek' }, full: { name: 'Brow, cheek and jaw' } };
export const RIDGES = { smooth: { name: 'Smooth' }, brow: { name: 'Brow folds' }, cheek: { name: 'Cheek folds' }, corded: { name: 'Corded' } };
export const TENDRILS = { none: { name: 'None' }, chin: { name: 'Chin pair' }, fringe: { name: 'Jaw fringe' }, beard: { name: 'Full beard' }, cheek: { name: 'Cheek strands' } };
export const TLENGTHS = { short: { name: 'Short' }, long: { name: 'Long' } };

const hash = (i, j = 0) => { const s = Math.sin(i * 127.1 + j * 311.7 + 7.7) * 43758.5453; return s - Math.floor(s); };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
// a run of capsules through points, exact at any distance (so a soft join with the face stays a smooth fold)
const rope = (pts, r) => {
  const segs = []; let rm = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const rr = typeof r === 'function' ? r(i, pts.length - 1) : r; rm = Math.max(rm, rr); segs.push(capsule(pts[i], pts[i + 1], rr)); }
  const f = (x, y, z) => { let d = Infinity; for (const g of segs) { const v = g(x, y, z); if (v < d) d = v; } return d; };
  return boxed(f, pts, rm);
};
// a shape with a box round it: far outside the box only the distance to the box is worked out (the head is sampled
// hundreds of thousands of times, and most samples are nowhere near a fold or a spur)
function boxed(f, pts, r) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - r); hi[k] = Math.max(hi[k], p[k] + r); }
  return (x, y, z) => {
    const out = Math.hypot(Math.max(lo[0] - x, x - hi[0], 0), Math.max(lo[1] - y, y - hi[1], 0), Math.max(lo[2] - z, z - hi[2], 0));
    return out > 0.012 ? out : f(x, y, z);
  };
}
const both = (f) => mirrorX(f);
// a smooth curve through points, a point added between each pair
function smooth(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[i], c = pts[i + 1], d = pts[Math.min(i + 2, n - 1)];
    out.push(b, [0, 1, 2].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * 0.5 + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * 0.25 + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * 0.125)));
  }
  out.push(pts[n - 1]);
  return out;
}

// Where the tendrils grow, on the figure's left half (those at x = 0 are single, the rest mirrored): [x, y, z, length]
// in the face's measure. A rough place in front of the face; it is pressed onto the face as built.
function rootsFor(kind, P) {
  const Y = (y) => y * P.L, cw = P.cw, jw = P.jw, cz = P.chin[2], out = [];
  const jaw = [[0, Y(-0.113), cz - 0.006, 1.0], [0.014 * cw, Y(-0.11), cz - 0.01, 0.92], [0.028 * jw, Y(-0.101), 0.062, 0.78], [0.04 * jw, Y(-0.09), 0.042, 0.62]];
  if (kind === 'chin') out.push([0.009 * cw, Y(-0.11), cz - 0.004, 1.0]);
  if (kind === 'fringe') out.push(...jaw);
  if (kind === 'beard') out.push(...jaw, [0.047, Y(-0.072), 0.048, 0.66]);
  if (kind === 'cheek') out.push([0.045, Y(-0.06), 0.058, 0.85], [0.05, Y(-0.072), 0.046, 0.7], [0.04, Y(-0.08), 0.062, 0.95]);
  return out;
}

// A tendril: it leaves the face with a short lift and hangs under its own weight, a little forward and out, lying on the
// jaw where it meets it and passing in front of the neck and over the chest in its clothes, never through them.
function hang(root, n, len, r, head, side, id) {
  // the chest in its clothes (in the head's frame its top is 20 cm below the eyes), and the neck in a collar below 14 cm
  const chest = ellipsoid(0, -0.4, -0.01, 0.2, 0.2, 0.125);
  const obstacle = (x, y, z) => Math.min(head(x, y, z) - (y < -0.14 ? 0.022 : 0), chest(x, y, z) - 0.02);
  const clear = (q, rr) => {
    for (let k = 0; k < 3; k++) {
      const d = obstacle(q[0], q[1], q[2]);
      if (d >= rr + 0.001) break;
      const g = gradient(obstacle, q[0], q[1], q[2]), m = rr + 0.001 - d; q[0] += g[0] * m; q[1] += g[1] * m; q[2] += g[2] * m;
    }
  };
  const seg = 0.0055, pts = [[root[0] - n[0] * r * 0.7, root[1] - n[1] * r * 0.7, root[2] - n[2] * r * 0.7]];
  let q = [root[0] + n[0] * r * 0.4, root[1] + n[1] * r * 0.4 - r * 0.5, root[2] + n[2] * r * 0.4]; clear(q, r); pts.push(q.slice());
  let dir = norm([n[0] * 0.22, -1, n[2] * 0.22]);   // falling from the start: a tendril is too heavy to stand out from the face
  const lean = [side * (0.03 + 0.04 * hash(id, 3)), 0, 0.04 + 0.08 * hash(id, 4)];
  for (let s = 0; s < len; s += seg) {
    const want = norm([lean[0], -1, lean[2]]), k = s < 0.01 ? 0.55 : 0.3;
    dir = norm([dir[0] * k + want[0] * (1 - k), dir[1] * k + want[1] * (1 - k), dir[2] * k + want[2] * (1 - k)]);
    const nq = [q[0] + dir[0] * seg, q[1] + dir[1] * seg, q[2] + dir[2] * seg], rr = r * (1 - 0.75 * Math.min(1, s / len));
    clear(nq, rr); dir = norm([nq[0] - q[0], nq[1] - q[1], nq[2] - q[2]]); q = nq; pts.push(q.slice());
  }
  return smooth(pts);
}
// tubes along paths whose radius changes along their length: a box test first, so faraway points cost little
function tubes(list) {
  const items = list.map(({ pts, radAt }) => {
    const segs = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; let s = 0, rmax = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...ba) || 1e-6;
      segs.push({ a, ba, l2: len * len, len, s0: s }); s += len;
    }
    for (let t = 0; t <= s; t += 0.003) rmax = Math.max(rmax, radAt(t, s));
    for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - rmax); hi[k] = Math.max(hi[k], p[k] + rmax); }
    return { segs, lo, hi, L: s, radAt };
  });
  return (x, y, z) => {
    let d = Infinity;
    for (const it of items) {
      const out = Math.hypot(Math.max(it.lo[0] - x, x - it.hi[0], 0), Math.max(it.lo[1] - y, y - it.hi[1], 0), Math.max(it.lo[2] - z, z - it.hi[2], 0));
      if (out >= d) continue;
      if (out > 0.006) { d = Math.min(d, out); continue; }
      for (const g of it.segs) {
        const px = x - g.a[0], py = y - g.a[1], pz = z - g.a[2], h = Math.max(0, Math.min(1, (px * g.ba[0] + py * g.ba[1] + pz * g.ba[2]) / g.l2));
        const v = Math.hypot(px - g.ba[0] * h, py - g.ba[1] * h, pz - g.ba[2] * h) - it.radAt(g.s0 + g.len * h, it.L);
        if (v < d) d = v;
      }
    }
    return d;
  };
}

export function purebloodExtra(o) {
  const m = Math.max(0, Math.min(1, o.masc ?? 0.6)), age = Math.max(0, Math.min(1, o.age ?? 0.3));
  const spurs = SPURS[o.spurs] ? o.spurs : 'brow_cheek', ridges = RIDGES[o.ridges] ? o.ridges : 'cheek', kind = TENDRILS[o.tendrils] ? o.tendrils : 'fringe', long = o.tlength === 'long';
  let made = null;   // the tendrils, worked out once on the head as it stands and kept for below() and anchors()
  const tendrilsOn = (P, head) => {
    if (made) return made;
    const list = [];
    rootsFor(kind, P).forEach(([x, y, z, k], i) => {
      for (const side of x === 0 ? [0] : [1, -1]) {
        const id = i * 3 + (side + 1), pr = project(head, [side ? side * x : 0, y, z], 8), root = pr.p, n = pr.n;
        const r0 = (0.0052 + 0.0014 * m) * (0.85 + 0.3 * hash(id, 1)) * (kind === 'chin' ? 1.2 : 1);   // about a finger thick at the root
        const len = (long ? 0.11 + 0.05 * m : 0.055 + 0.022 * m) * k * (0.82 + 0.36 * hash(id, 2));
        const pts = hang(root, n, len, r0, head, side || (hash(id, 5) < 0.5 ? 1 : -1), id);
        // fleshy: a little narrower where it leaves the skin, full just below, then a long taper to a point
        const radAt = (s, L) => r0 * (0.9 + 0.1 * Math.min(1, s / 0.008)) * Math.max(0.16, 1 - Math.pow(Math.min(1, s / L), 1.5) * 0.84);   // tapering the whole way, to a point
        list.push({ pts, radAt, root, n, r0 });
      }
    });
    made = list;
    return made;
  };
  return {
    add(P, head) {
      const Y = (y) => y * P.L, fw = P.fw, out = [], mk = 0.7 + 0.3 * m;
      // the skull: a heavier, lower brow shelf, a stronger bridge between the brows, high sharp cheekbones, a firm chin
      out.push([0.008, both(rope([[0.005, 0.0195, 0.0855], [0.022 * fw, 0.0235, 0.0865], [0.04 * fw, 0.0225, 0.08], [0.054 * fw, 0.0175, 0.068]], (i) => (0.0058 + 0.0022 * m) * [1, 0.95, 0.85][i]))]);
      out.push([0.008, ellipsoid(0, 0.0185, 0.0835, 0.013, 0.0095, 0.009)]);
      out.push([0.01, both(ellipsoid(0.05 * fw, Y(-0.019), 0.059, 0.0175 * mk, 0.0085, 0.0125))]);
      out.push([0.008, ellipsoid(0, Y(-0.102), 0.079, 0.019 * P.cw, 0.012, 0.012)]);
      // a line laid on the face as built: points given from in front, pressed onto the surface and sunk a little
      const lay = (pts, sink) => pts.map(([x, y]) => { const hit = cast(head, [x, y, 0.3], [0, 0, -1], 0.5); return hit ? [hit.p[0] - hit.n[0] * sink, hit.p[1] - hit.n[1] * sink, hit.p[2] - hit.n[2] * sink] : [x, y, 0.07]; });
      // spurs: grown from the bone with a broad root, curving back to a point
      const sp = spurs === 'none' ? 0 : spurs === 'brow' ? 1 : spurs === 'brow_cheek' ? 2 : 3, sz = (0.62 + 0.38 * m) * (1 + 0.15 * age);
      // a spur grown from the bone at a rough place `at` on the face: its root sunk into the surface there, then out and
      // along `run` (back, up or down along the skull), curving in toward the head again at the tip, which ends `len` away
      const horn = (at, run, len, r0, stand = 0.55) => {
        const pr = project(head, at, 8), n = pr.n, p = pr.p, u = norm(run), out = (k) => [n[0] * k, n[1] * k, n[2] * k];
        const a = [p[0] - n[0] * r0 * 0.5, p[1] - n[1] * r0 * 0.5, p[2] - n[2] * r0 * 0.5];
        const b = [p[0] + u[0] * len * 0.5 + out(len * stand * 0.45)[0], p[1] + u[1] * len * 0.5 + out(len * stand * 0.45)[1], p[2] + u[2] * len * 0.5 + out(len * stand * 0.45)[2]];
        const c = [p[0] + u[0] * len + out(len * stand * 0.6)[0], p[1] + u[1] * len + out(len * stand * 0.6)[1], p[2] + u[2] * len + out(len * stand * 0.6)[2]];
        const s1 = roundCone(a, b, r0, r0 * 0.55), s2 = roundCone(b, c, r0 * 0.55, 0.001);
        return both(boxed((x, y, z) => Math.min(s1(x, y, z), s2(x, y, z)), [a, b, c], r0));
      };
      // the brow's end sweeps back over the temple; the cheekbone's back toward the ear; the jaw's down and back
      if (sp >= 1) out.push([0.008, horn([0.054 * fw, 0.022, 0.072], [0.35, 0.12, -1], 0.024 + 0.012 * sz, 0.0082 * sz, 1.15)]);
      if (sp >= 2) out.push([0.007, horn([0.058 * fw, Y(-0.02), 0.054], [0.3, 0.05, -1], 0.018 + 0.008 * sz, 0.0068 * sz, 1.1)]);
      if (sp >= 3) out.push([0.007, horn([0.052 * P.jw, Y(-0.074), 0.02], [0.2, -0.5, -1], 0.016 + 0.006 * sz, 0.0062 * sz, 1.0)]);
      // folds: long, low and rounded, a finger wide, grown into the face rather than drawn on it
      if (ridges !== 'smooth') {
        const r = 0.0042 + 0.0008 * m, sink = r * 0.62, fold = (pts, rr = r) => [0.007, rope(lay(pts, rr * 0.62), rr)];
        // up the forehead from between the brows
        out.push(fold([[0, 0.027], [0, 0.041], [0, 0.056]], r * 0.9), [0.007, both(rope(lay([[0.008, 0.026], [0.011, 0.04], [0.013, 0.053]], sink), r * 0.85))]);
        if (ridges === 'cheek' || ridges === 'corded') {
          // down each cheek from under the cheekbone, stopping above the jaw
          out.push([0.007, both(rope(lay([[0.049 * fw, Y(-0.031)], [0.048 * fw, Y(-0.047)], [0.044 * fw, Y(-0.064)]], sink), r))]);
          out.push([0.007, both(rope(lay([[0.039 * fw, Y(-0.04)], [0.038 * fw, Y(-0.055)], [0.035, Y(-0.069)]], sink), r * 0.9))]);
        }
        if (ridges === 'corded') {
          // more of them, and round the mouth and on the chin
          out.push([0.007, both(rope(lay([[0.056 * fw, Y(-0.034)], [0.054 * fw, Y(-0.05)], [0.05 * P.jw, Y(-0.066)]], sink), r * 0.85))]);
          out.push([0.007, both(rope(lay([[0.03, Y(-0.06)], [0.032, Y(-0.074)], [0.028, Y(-0.088)]], sink), r * 0.8))]);
          out.push([0.007, both(rope(lay([[0.021, 0.028], [0.025, 0.04], [0.027, 0.05]], sink), r * 0.8))]);
          out.push(fold([[0, Y(-0.091)], [0, Y(-0.104)]], r * 0.85));
        }
      }
      // tendrils: they grow from the face with a short, tight join, so the jaw above them keeps its shape
      const tl = tendrilsOn(P, head);
      if (tl.length) out.push([0.005, tubes(tl)]);
      // joined in a few groups of like blends rather than one by one: the same shapes, and far fewer steps per sample
      const groups = new Map();
      for (const [k, f] of out) { const kk = Math.round(k * 1000) / 1000; if (!groups.has(kk)) groups.set(kk, []); groups.get(kk).push(f); }
      return [...groups].sort((x, y) => y[0] - x[0]).map(([k, fs]) => [k, fs.length === 1 ? fs[0] : (x, y, z) => { let d = Infinity; for (const f of fs) { const v = f(x, y, z); if (v < d) d = v; } return d; }]);
    },
    cut(P, head) {
      const Y = (y) => y * P.L, fw = P.fw;
      // hollow under the cheekbones, deeper on a harder face and with age
      const d = 0.0032 + 0.0018 * m + 0.002 * age, hollow = both(ellipsoid(0.043 * fw, Y(-0.05), 0.066, 0.015, 0.018, 0.006));
      return [[0.012, (x, y, z) => hollow(x, y, z) + (0.006 - d)]];
    },
    // the parts of the tendrils that hang below the head's own mesh (cut 128 mm under the eyes), meshed on their own
    below(P) {
      if (!made || !made.length) return null;
      let lo = 0; for (const t of made) for (const p of t.pts) lo = Math.min(lo, p[1]);
      if (lo > -0.125) return null;
      const xs = made.flatMap((t) => t.pts.map((p) => p[0])), zs = made.flatMap((t) => t.pts.map((p) => p[2]));
      return { field: tubes(made), bounds: [[Math.min(...xs) - 0.015, lo - 0.012, Math.min(...zs) - 0.015], [Math.max(...xs) + 0.015, 0, Math.max(...zs) + 0.015]] };
    },
    anchors(P, head) {
      const Y = (y) => y * P.L, fw = P.fw, at = (x, y) => { const h = cast(head, [x, y, 0.3], [0, 0, -1], 0.5); return h ? { p: h.p, n: h.n } : null; };
      const tl = (made || []).map((t) => ({ pts: t.pts, r: t.pts.map((_, i) => { let s = 0; for (let k = 1; k <= i; k++) s += Math.hypot(t.pts[k][0] - t.pts[k - 1][0], t.pts[k][1] - t.pts[k - 1][1], t.pts[k][2] - t.pts[k - 1][2]); let L = s; for (let k = i + 1; k < t.pts.length; k++) L += Math.hypot(t.pts[k][0] - t.pts[k - 1][0], t.pts[k][1] - t.pts[k - 1][1], t.pts[k][2] - t.pts[k - 1][2]); return t.radAt(s, L); }) }));
      const circlet = []; for (let a = -1.05; a <= 1.0501; a += 0.07) { const h = cast(head, [Math.sin(a) * 0.3, 0.046 - 0.012 * a * a, Math.cos(a) * 0.3 - 0.012], [-Math.sin(a), 0, -Math.cos(a)], 0.4); if (h) circlet.push([h.p[0] + h.n[0] * 0.0015, h.p[1] + h.n[1] * 0.0015, h.p[2] + h.n[2] * 0.0015]); }
      return { tendrils: tl, chin: at(0, Y(-0.1)), nose: at(0.0115, Y(-0.044)), lip: at(0.0105, Y(-0.075)), brow: spurs === 'none' ? null : at(0.05 * fw, 0.024), circlet };
    },
  };
}
