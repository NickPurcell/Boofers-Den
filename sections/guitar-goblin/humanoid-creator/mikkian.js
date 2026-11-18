// A Mikkian's head-tendrils: what the species wears in place of hair. From a study of many of them (never one
// person): dozens of slim, tapering, fleshy tendrils growing from the whole scalp behind the hairline, lying swept
// back in a mane, standing out short all round, hanging loose and wavy, or bound together behind the head.
// Built as signed distance shapes on the head as built, so they fit every face. Pure: the workers import it.
//
// Interface: tendrils(style, thick, head) -> { field, bounds, param(positions) }
//   style: a key of ARRANGE; thick: a key of THICK; head: the head's own field (metres from between the eyes).
//   param(positions) gives, for each vertex of the mesh, how far along its tendril it is (0 at the scalp, 1 at the
//   tip; 1.5 on the band that binds them), so the page can paint tips, bands and roots.
import { chain, ellipsoid, smin, cast, gradient } from '../duros-creator/sdf.js';
import { hairline } from './hair.js';

export const ARRANGE = { swept: { name: 'Swept back' }, short: { name: 'Short' }, loose: { name: 'Loose' }, bound: { name: 'Bound' } };
export const THICK = { slender: { name: 'Slender', r: 0.0064 }, medium: { name: 'Medium', r: 0.008 }, thick: { name: 'Thick', r: 0.0098 } };   // about a finger thick at the root
export const PATTERNS = { plain: { name: 'Plain' }, tips: { name: 'Tips' }, bands: { name: 'Bands' }, roots: { name: 'Roots' } };
const LEN = { swept: 0.21, short: 0.062, loose: 0.17, bound: 0.2 };
const hash = (i, j = 0) => { const s = Math.sin(i * 127.1 + j * 311.7 + 17.3) * 43758.5453; return s - Math.floor(s); };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// a smooth curve through points, with a point added between each pair, so a tendril bends without elbows
function smooth(pts) {
  const n = pts.length, out = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[i], c = pts[i + 1], d = pts[Math.min(i + 2, n - 1)];
    out.push(b, [0, 1, 2].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * 0.5 + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * 0.25 + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * 0.125)));
  }
  out.push(pts[n - 1]);
  return out;
}
// every tendril as a line of points from the scalp out, with its radius at each point
export function tendrilPaths(style, thick, head) {
  const C = [0, 0.03, -0.012], r0 = (THICK[thick] || THICK.medium).r, out = [], N = 6;
  let id = 0;
  for (const [elDeg, n] of [[10, 13], [26, 13], [42, 11], [58, 8], [74, 5], [90, 1]]) for (let k = 0; k < n; k++) {
    id++;
    const el = (elDeg * Math.PI) / 180, az = ((k + (elDeg === 26 || elDeg === 58 ? 0.5 : 0)) / n) * 2 * Math.PI - Math.PI + (hash(id, 1) - 0.5) * 0.22;
    const d = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const hit = cast(head, [C[0] + d[0] * 0.25, C[1] + d[1] * 0.25, C[2] + d[2] * 0.25], [-d[0], -d[1], -d[2]], 0.3);
    if (!hit || hit.p[1] < hairline(Math.atan2(hit.p[0], hit.p[2])) + 0.006) continue;   // only behind the hairline
    const p = hit.p, n0 = hit.n, L = (LEN[style] || LEN.swept) * (0.78 + 0.44 * hash(id, 2)), rad = (i) => Math.max(0.003, r0 * (style === 'bound' ? (i < 5 ? 0.72 : 0.5) : 1 - 0.55 * (i / N)) * (0.9 + 0.2 * hash(id, 7)));   // bound ones are pulled thin and even
    const pts = [[p[0] - n0[0] * 0.004, p[1] - n0[1] * 0.004, p[2] - n0[2] * 0.004]];
    // keep a point outside the head by the tendril's own thickness, so tendrils lie on the skull and never in it
    const clear = (q, r) => { const dd = head(q[0], q[1], q[2]); if (dd < r + 0.002) { const g = gradient(head, q[0], q[1], q[2]), m = r + 0.002 - dd; q[0] += g[0] * m; q[1] += g[1] * m; q[2] += g[2] * m; } return q; };
    if (style === 'bound') {
      const G = [0, 0.018, -0.132], o = [(hash(id, 3) - 0.5) * 0.03, (hash(id, 4) - 0.5) * 0.02, (hash(id, 5) - 0.5) * 0.02];
      for (const t of [0.3, 0.6, 0.85]) pts.push(clear([p[0] + (G[0] - p[0]) * t, p[1] + (G[1] - p[1]) * t, p[2] + (G[2] - p[2]) * t], rad(2) + 0.004));
      pts.push([G[0] + o[0] * 0.5, G[1] + o[1] * 0.5, G[2]], [o[0] * 1.3, G[1] - 0.065 + o[1], G[2] - 0.016 + o[2]], [o[0] * 2.4, G[1] - 0.07 - L * 0.55 + o[1] * 2, G[2] - 0.008 + o[2]]);
    } else {
      const sweep = norm([n0[0] * 0.3, -0.1, -1]), side = norm([n0[2], 0, -n0[0]]), back = n0[2] > 0 ? 0.55 * n0[2] : 0;   // nothing falls forward over the face
      let q = pts[0].slice();
      for (let i = 1; i <= N; i++) {
        const u = i / N; let v;
        if (style === 'short') v = [n0[0], n0[1] + 0.2, n0[2] - 0.35 * u - back];
        else if (style === 'loose') { const w = Math.sin(u * 5 + hash(id, 6) * 6.28) * 0.45, k = 1 - 0.55 * u; v = [n0[0] * k + side[0] * w, n0[1] * k - 1.25 * u, n0[2] * k + side[2] * w - 0.15 - back * 1.6]; }   // out, then down, with a wave
        else { const f = Math.min(1, u * 1.6), flick = u > 0.75 ? (u - 0.75) * 1.6 : 0; v = [n0[0] * (1 - f + flick) + sweep[0] * f, n0[1] * (1 - f) + sweep[1] * f - 1.0 * u * u + flick * 0.3, n0[2] * (1 - f) + sweep[2] * f]; }   // back over the skull, then down behind it, the tips turning out
        v = norm(v); q = clear([q[0] + (v[0] * L) / N, q[1] + (v[1] * L) / N, q[2] + (v[2] * L) / N], rad(i)); pts.push(q.slice());
      }
    }
    out.push({ pts: smooth(pts), rad: (j) => rad(j / 2) });
  }
  return out;
}

export function tendrils(style, thick, head) {
  const list = tendrilPaths(style, thick, head), ropes = list.map((t) => chain(t.pts, t.rad));
  const band = style === 'bound' ? ellipsoid(0, 0.008, -0.139, 0.031, 0.012, 0.027) : null;
  const all = (x, y, z) => { let d = Infinity; for (const f of ropes) { const v = f(x, y, z); if (v < d) d = v; } return d; };
  // they grow straight out of the scalp (their roots are sunk into the head), so there is no cap and no seam
  let field = all;
  if (band) field = smin(0.003, field, band);
  const lo = [-0.1, -0.05, -0.12], hi = [0.1, 0.14, 0.1];
  for (const t of list) for (const p of t.pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - 0.012); hi[k] = Math.max(hi[k], p[k] + 0.012); }
  // how far along its tendril each vertex is
  const param = (P) => {
    const n = P.length / 3, T = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      if (band && band(x, y, z) < 0.0025) { T[i] = 1.5; continue; }
      let best = 0.03, t = 0;
      for (const { pts } of list) for (let s = 0; s + 1 < pts.length; s++) {
        const a = pts[s], b = pts[s + 1], bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], h = Math.max(0, Math.min(1, ((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / (bx * bx + by * by + bz * bz)));
        const dd = Math.hypot(x - a[0] - bx * h, y - a[1] - by * h, z - a[2] - bz * h);
        if (dd < best) { best = dd; t = (s + h) / (pts.length - 1); }
      }
      T[i] = t;
    }
    return T;
  };
  return { field, bounds: [lo, hi], param };
}
