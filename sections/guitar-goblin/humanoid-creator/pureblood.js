// A Sith Pureblood's head: what the species grows on the shared human skull. From a study of 88 pictures of many of
// them (never one person; notes in the workspace): the skull is a human's, but the brow is a heavier, lower shelf of
// bone that shades the eyes, and its outer end runs on back along the temple into a spur; the cheekbones stand high and
// firm; the jaw is square and the chin strong; short raised ridges, bone under the skin, angle across the cheeks and up
// the forehead; and fleshy tendrils grow out of the chin and the jawline, each swelling from the skin, tapering slowly to
// a rounded end and hanging under its own weight with a slight curve. All of it is built on the head as it stands, so it
// follows every face shape. Pure: the workers import it.
//
// Interface (see head-field.js `extra`): purebloodExtra(o) -> { add(P, head), cut(P, head), below(P), anchors(P, head), lid }
//   o.spurs: a key of SPURS; o.ridges: a key of RIDGES; o.tendrils: a key of TENDRILS; o.tlength: a key of TLENGTHS;
//   o.masc: 0 (feminine) to 1 (masculine); o.age: 0 to 1; o.build: 0 (slight) and up (heavy, over 1).
//   P: the face's landmarks (head-field.js landmarks()); head: the head's field so far, in the same frame (metres from the
//   point between the eyes, y up, facing +z, the figure's left at +x).
//   anchors(P, head) tells the page where jewellery can go: each tendril's path and radius, the spurs' roots, the chin,
//   the nose and a line across the brow for a circlet.
import { capsule, ellipsoid, mirrorX, cast, gradient, project } from '../duros-creator/sdf.js';

export const SPURS = { none: { name: 'None' }, brow: { name: 'Brow' }, brow_cheek: { name: 'Brow and cheek' }, full: { name: 'Brow, cheek and jaw' } };
export const RIDGES = { smooth: { name: 'Smooth' }, brow: { name: 'Brow folds' }, cheek: { name: 'Cheek ridges' }, corded: { name: 'Corded' } };
export const TENDRILS = { none: { name: 'None' }, chin: { name: 'Chin pair' }, fringe: { name: 'Chin and jaw' }, cheek: { name: 'Cheek and chin' }, beard: { name: 'Full beard' } };
export const TLENGTHS = { short: { name: 'Short' }, long: { name: 'Long' } };

const hash = (i, j = 0) => { const s = Math.sin(i * 127.1 + j * 311.7 + 7.7) * 43758.5453; return s - Math.floor(s); };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const c01 = (v) => Math.max(0, Math.min(1, v));
// a run of capsules through points, exact at any distance (so a soft join with the face stays a smooth fold)
const rope = (pts, r) => {
  const segs = []; let rm = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const rr = typeof r === 'function' ? r(i, pts.length - 1) : r; rm = Math.max(rm, rr); segs.push(capsule(pts[i], pts[i + 1], rr)); }
  const f = (x, y, z) => { let d = Infinity; for (const g of segs) { const v = g(x, y, z); if (v < d) d = v; } return d; };
  return boxed(f, pts, rm);
};
// a shape with a box round it: far outside the box only the distance to the box is worked out (the head is sampled
// hundreds of thousands of times, and most samples are nowhere near a ridge or a spur)
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
// tubes along paths whose radius changes along their length: a box test first, so faraway points cost little
function tubes(list, margin = 0.009) {   // margin: past this distance from a path's box, the box's distance stands in (keep it above the blend it is joined with)
  const items = list.map(({ pts, radAt }) => {
    const segs = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; let s = 0, rmax = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...ba) || 1e-6;
      segs.push({ a, ba, l2: len * len, len, s0: s }); s += len;
    }
    for (const g of segs) { g.ra = radAt(g.s0, s); g.rb = radAt(g.s0 + g.len, s); }   // the radius at each end, worked out once: along a segment it is taken as straight between them
    for (let t = 0; t <= s + 1e-9; t += 0.002) rmax = Math.max(rmax, radAt(Math.min(t, s), s));
    for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - rmax); hi[k] = Math.max(hi[k], p[k] + rmax); }
    return { segs, lo, hi, L: s, radAt };
  });
  return (x, y, z) => {
    let d = Infinity;
    for (const it of items) {
      const out = Math.hypot(Math.max(it.lo[0] - x, x - it.hi[0], 0), Math.max(it.lo[1] - y, y - it.hi[1], 0), Math.max(it.lo[2] - z, z - it.hi[2], 0));
      if (out >= d) continue;
      if (out > margin) { d = Math.min(d, out); continue; }
      for (const g of it.segs) {
        const px = x - g.a[0], py = y - g.a[1], pz = z - g.a[2], h = Math.max(0, Math.min(1, (px * g.ba[0] + py * g.ba[1] + pz * g.ba[2]) / g.l2));
        const v = Math.hypot(px - g.ba[0] * h, py - g.ba[1] * h, pz - g.ba[2] * h) - (g.ra + (g.rb - g.ra) * h);
        if (v < d) d = v;
      }
    }
    return d;
  };
}
// a path on the head as built: rough points pressed onto its surface ([x, y] from in front, [x, y, z] to the nearest
// point), drawn into a smooth curve that lies on the surface; each point comes with the surface's normal there
function onHead(head, guide) {
  const first = guide.map((g) => (g.length === 2 ? cast(head, [g[0], g[1], 0.3], [0, 0, -1], 0.5) || project(head, [g[0], g[1], 0.07], 10) : project(head, g, 10)).p);
  const curve = first.length > 2 ? smooth(smooth(first)) : [first[0], ...[1, 2, 3].map((k) => first[0].map((v, i) => v + (first[1][i] - v) * k / 4)), first[1]];
  return curve.map((q) => project(head, q, 4));
}
const lengths = (pts) => { const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])); return s; };
// a raised ridge along a path on the head: round in section, fullest in the middle and fading at both ends, standing
// `rise` of its radius proud of the skin (the soft join then gives it a skirt), so it reads as bone under the skin
function ridge(head, guide, r0, rise = 0.5, prof = (t) => Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * t)), 0.75)) {
  const on = onHead(head, guide), s = lengths(on.map((o) => o.p)), L = s[s.length - 1] || 1e-6;
  const pts = on.map((o, i) => { const k = r0 * prof(s[i] / L) * (rise - 1); return [o.p[0] + o.n[0] * k, o.p[1] + o.n[1] * k, o.p[2] + o.n[2] * k]; });
  return { pts, radAt: (q, LL) => r0 * prof(Math.min(1, q / (LL || 1e-6))) };
}
// a spur: bone grown from the skull along a path on it, its root sunk into the surface like the end of a ridge, then
// rising off the skin as it tapers to a blunt point that stands `lift` clear at the tip
function spur(head, guide, r0, lift) {
  const on = onHead(head, guide), s = lengths(on.map((o) => o.p)), L = s[s.length - 1] || 1e-6;
  const rad = (t) => r0 * (1 - 0.84 * Math.pow(t, 0.9));
  const pts = on.map((o, i) => { const t = s[i] / L, k = rad(t) * (-0.4 + 1.4 * t) + lift * t * t; return [o.p[0] + o.n[0] * k, o.p[1] + o.n[1] * k, o.p[2] + o.n[2] * k]; });
  return { pts, radAt: (q, LL) => rad(Math.min(1, q / (LL || 1e-6))) };
}

// The ridges each set of folds has, on the figure's left half (mid: a single one on the midline): rough paths on the
// face ([x, y] seen from in front, [x, y, z] pressed onto the nearest point) and their radius as a share of a fold's.
// The face's paint lights the same paths along their crests (ridgeMarks below), so they read as raised.
function ridgePaths(ridges, P) {
  const Y = (y) => y * P.L, fw = P.fw, jw = P.jw, out = [];
  if (ridges === 'smooth') return out;
  out.push({ mid: true, pts: [[0, 0.029], [0, 0.041], [0, 0.054]], k: 0.95 }, { pts: [[0.009, 0.028], [0.0115, 0.039], [0.014, 0.05]], k: 0.85 });   // up the forehead from between the brows
  if (ridges === 'cheek' || ridges === 'corded') {   // short ridges across each cheek, from under the cheekbone toward the mouth, stopping well above the jaw
    out.push({ pts: [[0.048 * fw, Y(-0.035)], [0.042 * fw, Y(-0.045)], [0.036, Y(-0.053)]], k: 1.15 }, { pts: [[0.057 * fw, Y(-0.041)], [0.052 * fw, Y(-0.051)], [0.046, Y(-0.06)]], k: 1.1 });
  }
  if (ridges === 'corded') {
    out.push({ pts: [[0.062 * fw, Y(-0.047), 0.03], [0.058 * fw, Y(-0.06), 0.03], [0.052 * jw, Y(-0.072), 0.03]], k: 0.9 }, { pts: [[0.029, Y(-0.056)], [0.032, Y(-0.066)], [0.031, Y(-0.075)]], k: 0.8 }, { pts: [[0.021, 0.029], [0.025, 0.04], [0.028, 0.05]], k: 0.8 });
  }
  return out;
}
// the face's paint for those ridges: a soft light along each crest (a `marks` hook for face-paint.js)
export function ridgeMarks(o) {
  return ({ g, path, soft, both, mm, P, css, mix, skin }) => {
    const light = css(mix(skin, '#ffd2b0', 0.4)), r = 0.0032 + 0.0008 * P.masc;
    for (const rp of ridgePaths(o.ridges, P)) {
      const draw = (s) => soft(1.6, light, () => { g.globalAlpha = 0.32; g.lineWidth = r * 1000 * mm * rp.k * 0.9; g.lineCap = 'round'; g.lineJoin = 'round'; path(rp.pts.map((p) => [s * p[0], p[1]]), false); g.stroke(); });
      if (rp.mid) draw(1); else both(draw);
    }
  };
}

// Where the tendrils grow, on the figure's left half (those at x = 0 are single, the rest mirrored): [x, y, z, length,
// thickness], rough places on the jaw and chin pressed onto the face as built. They grow from the front and side of the
// jaw a little above its edge, and from the lower cheek; never from underneath.
function rootsFor(kind, P) {
  const Y = (y) => y * P.L, cw = P.cw, jw = P.jw, cz = P.chin[2], out = [];
  const chin = [0.0085 * cw, Y(-0.106), cz - 0.002, 1.0, 1.08], wide = [0.0135 * cw, Y(-0.106), cz - 0.004, 1.0, 1.05];
  const jaw1 = [0.024 * cw, Y(-0.102), 0.064, 0.86, 1.0], jaw2 = [0.037 * jw, Y(-0.095), 0.044, 0.74, 0.94], jaw3 = [0.046 * jw, Y(-0.087), 0.026, 0.62, 0.88];
  const cheek1 = [0.038, Y(-0.08), 0.062, 0.84, 0.92], cheek2 = [0.047 * jw, Y(-0.073), 0.045, 0.7, 0.86];
  if (kind === 'chin') out.push(chin);
  if (kind === 'fringe') out.push(chin, jaw1, jaw2);
  if (kind === 'cheek') out.push(chin, cheek1, cheek2);
  if (kind === 'beard') out.push([0, Y(-0.108), cz - 0.002, 1.12, 1.1], wide, jaw1, jaw2, jaw3, cheek1);
  return out;
}

// A tendril's path: it leaves the jaw outward and down, then bends under its own weight until it hangs, a little
// forward and out, each one at its own angle; it lies on the jaw and neck where it meets them and passes in front of
// the chest in its clothes, never through them.
function hang(root, n, len, rad, head, side, id) {
  const chest = ellipsoid(0, -0.4, -0.01, 0.2, 0.2, 0.125);   // in the head's frame the chest's top is 20 cm below the eyes
  const obstacle = (x, y, z) => Math.min(head(x, y, z) - (y < -0.14 ? 0.022 : 0), chest(x, y, z) - 0.02);   // and a collar below 14 cm
  const clear = (q, rr) => {
    for (let k = 0; k < 3; k++) {
      const d = obstacle(q[0], q[1], q[2]);
      if (d >= rr + 0.001) break;
      const g = gradient(obstacle, q[0], q[1], q[2]), m = rr + 0.001 - d; q[0] += g[0] * m; q[1] += g[1] * m; q[2] += g[2] * m;
    }
  };
  const r = rad(0), seg = 0.004, pts = [[root[0] - n[0] * r * 0.8, root[1] - n[1] * r * 0.8, root[2] - n[2] * r * 0.8]];
  let q = [root[0] + n[0] * r * 0.3, root[1] + n[1] * r * 0.3 - r * 0.2, root[2] + n[2] * r * 0.3]; pts.push(q.slice());
  let dir = norm([n[0] * 0.3, n[1] * 0.3 - 1, n[2] * 0.3]);
  const lean = [side * (0.01 + 0.05 * hash(id, 3)), 0.03 + 0.1 * hash(id, 4)], bend = 0.72 + 0.1 * hash(id, 6);
  // and sways a little along its length, each its own way, so no two hang like rods side by side
  const sway = [(hash(id, 7) - 0.5) * 0.5, (hash(id, 8) - 0.5) * 0.36], ph = hash(id, 9) * 2;
  for (let s = 0; s < len; s += seg) {
    const w = Math.sin(ph + (s / Math.max(len, 0.03)) * 2.6), want = norm([lean[0] + sway[0] * w, -1, lean[1] + sway[1] * w]);
    dir = norm([dir[0] * bend + want[0] * (1 - bend), dir[1] * bend + want[1] * (1 - bend), dir[2] * bend + want[2] * (1 - bend)]);
    const nq = [q[0] + dir[0] * seg, q[1] + dir[1] * seg, q[2] + dir[2] * seg];
    if (s > 0.012) clear(nq, rad(s + r) * 0.85);   // near the root it is still growing out of the jaw
    dir = norm([nq[0] - q[0], nq[1] - q[1], nq[2] - q[2]]); q = nq; pts.push(q.slice());
  }
  return smooth(pts);
}

export function purebloodExtra(o) {
  const m = c01(o.masc ?? 0.6), age = c01(o.age ?? 0.3), heft = c01(((o.build ?? 0.5) - 0.5) / 0.8);
  const spurs = SPURS[o.spurs] ? o.spurs : 'brow_cheek', ridges = RIDGES[o.ridges] ? o.ridges : 'cheek', kind = TENDRILS[o.tendrils] ? o.tendrils : 'fringe', long = o.tlength === 'long';
  let made = null;   // the tendrils, worked out once on the head as it stands and kept for below() and anchors()
  const tendrilsOn = (P, head) => {
    if (made) return made;
    const list = [];
    rootsFor(kind, P).forEach(([x, y, z, k, th], i) => {
      for (const side of x === 0 ? [0] : [1, -1]) {
        const id = i * 3 + (side + 1), pr = project(head, [side ? side * x : 0, y, z], 10), root = pr.p, n = pr.n;
        const r0 = (0.0056 + 0.0018 * m) * th * (0.92 + 0.16 * hash(id, 1));   // a finger thick where it leaves the skin
        const len = (long ? 0.1 + 0.04 * m : 0.042 + 0.012 * m) * k * (0.84 + 0.32 * hash(id, 2));   // short: about a thumb's length
        const s0 = r0 * 0.8;   // the path starts this far inside the jaw
        // fleshy: swollen where it leaves the skin, then a slow taper to a rounded end half as thick as the root
        const radAt = (s, L) => r0 * (1 + 0.24 * Math.pow(c01(1 - Math.max(0, s - s0) / 0.012), 2)) * (1 - (long ? 0.56 : 0.48) * Math.pow(c01(s / L), 1.25));
        const pts = hang(root, n, len, (s) => radAt(s, len + s0), head, side || (hash(id, 5) < 0.5 ? 1 : -1), id);
        list.push({ pts, radAt, root, n, r0 });
      }
    });
    made = list;
    return made;
  };
  return {
    // heavier lids than a human's: the upper comes well down over the iris, the lower up to its edge
    eyeInset: 0.0028,   // deep-set, under the shelf of the brow
    lid: (old) => ({ upper: 1.52 + 0.06 * old, lower: 1.31, tilt: 0.1 }),
    add(P, head) {
      const Y = (y) => y * P.L, fw = P.fw, jw = P.jw, cw = P.cw, out = [], side = [], mid = [];
      // the skull: a heavier, lower brow shelf with a stronger bridge between the brows; high firm cheekbones; a square
      // jaw and a strong chin; and on a heavy frame, full cheeks
      // (lower toward the nose than at its outer end: a stern brow, drawn down over the eyes)
      out.push([0.008, both(rope([[0.005, 0.0158, 0.0864], [0.021 * fw, 0.0192, 0.088], [0.038 * fw, 0.0212, 0.0825], [0.052 * fw, 0.0185, 0.07]], (i) => (0.0058 + 0.0022 * m) * [1, 0.94, 0.8][i]))]);
      out.push([0.008, ellipsoid(0, 0.016, 0.0835, 0.013, 0.0095, 0.009)]);
      out.push([0.01, ellipsoid(0, Y(-0.1), 0.081 + 0.003 * m, 0.017 * cw, 0.012, 0.012)]);
      out.push([0.014, both(ellipsoid(0.043 * jw, Y(-0.08), 0.006, 0.0075 + 0.0012 * m, 0.014, 0.014))]);
      out.push([0.012, both(ellipsoid(0.049 * fw, Y(-0.022), 0.058, 0.0155, 0.0085, 0.0125))]);   // the cheekbone's front, high and firm
      out.push([0.016, both(ellipsoid(0.046 * fw, Y(-0.05), 0.046, 0.019, 0.022, 0.008 + 0.006 * heft))]);
      // bone ridges and spurs, laid on the head as built
      const sz = (0.66 + 0.34 * m) * (1 + 0.12 * age), at = (root, pts) => pts.map((p) => p.map((v, i) => root[i] + (v - root[i]) * sz));
      out.push([0.014, both(tubes([ridge(head, [[0.052 * fw, Y(-0.022), 0.056], [0.061 * fw, Y(-0.017), 0.04], [0.067 * fw, Y(-0.012), 0.02]], 0.0062 + 0.0014 * m, 0.22)], 0.02))]);   // and its arch back toward the ear
      const sp = spurs === 'none' ? 0 : spurs === 'brow' ? 1 : spurs === 'brow_cheek' ? 2 : 3;
      if (sp >= 1) { const r = [0.051 * fw, 0.018, 0.071]; side.push(spur(head, [r, ...at(r, [[0.059 * fw, 0.0215, 0.06], [0.065 * fw, 0.025, 0.048]])], (0.0068 + 0.0018 * m) * sz, 0.0085 * sz)); }   // the brow's end, back along the temple
      if (sp >= 2) { const r = [0.063 * fw, Y(-0.016), 0.04]; side.push(spur(head, [r, ...at(r, [[0.067 * fw, Y(-0.014), 0.03], [0.07 * fw, Y(-0.012), 0.02]])], (0.0048 + 0.0012 * m) * sz, 0.005 * sz)); }   // the cheekbone's end
      if (sp >= 3) { const r = [0.05 * jw, Y(-0.074), 0.014]; side.push(spur(head, [r, ...at(r, [[0.053 * jw, Y(-0.082), 0.004], [0.054 * jw, Y(-0.089), -0.006]])], (0.0044 + 0.001 * m) * sz, 0.0045 * sz)); }   // the jaw's angle
      const r = 0.0032 + 0.0008 * m;
      for (const rp of ridgePaths(ridges, P)) (rp.mid ? mid : side).push(ridge(head, rp.pts, r * rp.k, 0.48));
      if (side.length) out.push([0.006, both(tubes(side))]);
      if (mid.length) out.push([0.006, tubes(mid)]);
      // tendrils: they grow from the face with a short, tight join, so the jaw above them keeps its shape
      const tl = tendrilsOn(P, head);
      if (tl.length) out.push([0.005, tubes(tl)]);
      // joined in a few groups of like blends rather than one by one: the same shapes, and far fewer steps per sample
      const groups = new Map();
      for (const [k, f] of out) { const kk = Math.round(k * 1000) / 1000; if (!groups.has(kk)) groups.set(kk, []); groups.get(kk).push(f); }
      return [...groups].sort((x, y) => y[0] - x[0]).map(([k, fs]) => [k, fs.length === 1 ? fs[0] : (x, y, z) => { let d = Infinity; for (const f of fs) { const v = f(x, y, z); if (v < d) d = v; } return d; }]);
    },
    cut() { return []; },
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
      const tl = (made || []).map((t) => { const s = lengths(t.pts), L = s[s.length - 1]; return { pts: t.pts, r: s.map((v) => t.radAt(v, L)) }; });
      const circlet = []; for (let a = -1.05; a <= 1.0501; a += 0.07) { const h = cast(head, [Math.sin(a) * 0.3, 0.046 - 0.012 * a * a, Math.cos(a) * 0.3 - 0.012], [-Math.sin(a), 0, -Math.cos(a)], 0.4); if (h) circlet.push([h.p[0] + h.n[0] * 0.0015, h.p[1] + h.n[1] * 0.0015, h.p[2] + h.n[2] * 0.0015]); }
      return { tendrils: tl, chin: at(0, Y(-0.1)), nose: at(0.0115, Y(-0.044)), lip: at(0.0105, Y(-0.075)), brow: spurs === 'none' ? null : at(0.05 * fw, 0.022), circlet };
    },
  };
}
