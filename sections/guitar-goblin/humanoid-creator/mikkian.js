// A Mikkian's head-tendrils: what the species wears in place of hair. From a study of many of them (never one
// person): dozens of tendrils growing from the whole scalp behind the hairline, worn as heavy locks hanging like
// dreads, swept back in a mane, standing out short all round, or bound together behind the head.
// Built as signed distance shapes on the head as built, so they fit every face. Pure: the workers import it.
//
// Interface: tendrils(style, thick, head, o) -> { field, bounds, param(positions) }
//   style: a key of ARRANGE; thick: a key of THICK; head: the head's own field (metres from between the eyes);
//   o.length: a key of LENGTHS; o.surface: a key of SURFACES (dreads only); o.line: a lower hairline (a height for each
//   angle round the head) to root them from, its front locks going to the sides at once (the characters page's choice);
//   o.lanes: long dreads fall in front of, over or behind the shoulder by where they are rooted, each keeping its place;
//   o.back: dreads lying back at rest: rising slim out of the scalp, the front ones lying back along the skull first; o.obstacle: what the locks must lie on and not pass through (the head, and the
//   shoulders and back in their clothes), in the same frame; the head alone if not given.
//   param(positions) gives, for each vertex of the mesh, how far along its tendril it is (0 at the scalp, 1 at the
//   tip; 1.5 on the band that binds them), so the page can paint tips, bands and roots; for dreads, fromTip(positions)
//   gives each vertex's distance from its tendril's tip in metres, so rings can be evenly spaced.
import { chain, ellipsoid, smin, cast, gradient } from '../duros-creator/sdf.js';
import { hairline } from './hair.js';

export const ARRANGE = { dreads: { name: 'Dreads' }, swept: { name: 'Swept back' }, short: { name: 'Short' }, bound: { name: 'Bound' } };
export const THICK = { slender: { name: 'Slender', r: 0.0064 }, medium: { name: 'Medium', r: 0.008 }, thick: { name: 'Thick', r: 0.0098 } };   // about a finger thick at the root
// dreads are heavier than the other arrangements: the same three choices, thicker
const DREAD_R = { slender: 0.0078, medium: 0.0098, thick: 0.0128 };
export const LENGTHS = { shoulder: { name: 'To the shoulders' }, long: { name: 'Long' } };
// smooth like a tentacle, or lumpy like a matted lock
export const SURFACES = { smooth: { name: 'Smooth' }, locked: { name: 'Locked' } };
export const PATTERNS = { plain: { name: 'Plain' }, tips: { name: 'Tips' }, bands: { name: 'Bands' }, roots: { name: 'Roots' } };
const LEN = { swept: 0.21, short: 0.062, bound: 0.2 };
const hash = (i, j = 0) => { const s = Math.sin(i * 127.1 + j * 311.7 + 17.3) * 43758.5453; return s - Math.floor(s); };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

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

// where the roots are: rings round the skull, kept to the scalp behind the hairline; `k` thins them out for thick locks
// (line: the hairline as a height for each angle round the head; a lower one adds a ring of roots across the front)
function roots(head, k = 1, line = hairline, nape = false) {
  const C = [0, 0.03, -0.012], out = [], front = line !== hairline;
  let id = 0;
  for (const [elDeg, n0] of [[-8, 13], [10, 13], [26, 13], [42, 11], [58, 8], [74, 5], [90, 1], ...(front ? [[17, 9]] : []), ...(nape ? [[-21, 8], [-33, 7]] : [])]) {
    const n = Math.max(1, Math.round(n0 * k)), arc = front && elDeg === 17, low = elDeg < -10;   // (the added rings run across the front only, or the back of the head only: down to the nape, where tendrils standing out leave it bare)
    for (let j = 0; j < n; j++) {
      id++;
      const el = (elDeg * Math.PI) / 180, az = low ? Math.PI - 1.15 + 2.3 * (j + 0.5) / n + (hash(id, 1) - 0.5) * 0.12 : arc ? -1.3 + 2.6 * (j + 0.5) / n + (hash(id, 1) - 0.5) * 0.12 : ((j + (elDeg === 26 || elDeg === 58 ? 0.5 : 0)) / n) * 2 * Math.PI - Math.PI + (hash(id, 1) - 0.5) * 0.22;
      const d = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
      const hit = cast(head, [C[0] + d[0] * 0.25, C[1] + d[1] * 0.25, C[2] + d[2] * 0.25], [-d[0], -d[1], -d[2]], 0.3);
      if (!hit || hit.p[1] < line(Math.atan2(hit.p[0], hit.p[2])) + 0.006) continue;   // only behind the hairline
      out.push({ id, p: hit.p, n: hit.n });
    }
  }
  return out;
}

// A dread: a heavy lock that leaves the scalp with only a short lift and falls at once under its own weight. It lies
// on the skull and slides off it (away from the crown, and never forward over the face), hangs straight down past
// the ears, and drapes over whatever it meets lower down, the shoulders front or back, until it ends at yEnd. A lock
// cut to the shoulders (rest) ends where it comes to rest on them.
// (back: lying back at rest, the characters page's way: each leaves the scalp low, the front ones lie back along the skull
// to behind the ears before they fall, and all lean back as they fall)
function dreadPath(p, n0, id, r, obstacle, yEnd, rest, fwd = false, lanes = false, back = false) {
  const seg = 0.018, pts = [[p[0] - n0[0] * 0.005, p[1] - n0[1] * 0.005, p[2] - n0[2] * 0.005]];
  // which way it slides off the head: out from the head's upright axis, turned back where that would be forward
  let rx = p[0], rz = p[2] + 0.012; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
  const front = Math.max(0, rz), off = norm([rx + (hash(id, 11) - 0.5) * 0.3, 0, rz - 1.6 * front - (back ? 0.5 : 0)]);
  const sway = [(hash(id, 12) - 0.5) * 0.08, 0, (hash(id, 13) - 0.5) * 0.08];   // no two hang quite alike
  const side = Math.sign(p[0]) || (hash(id, 14) < 0.5 ? -1 : 1);
  // keep a point clear of the head and body by the lock's own thickness; give the way the surface it touched faces
  // (null if it touched nothing)
  const clear = (q) => {
    let nrm = null;
    for (let k = 0; k < 3; k++) {
      const d = obstacle(q[0], q[1], q[2]);
      if (d >= r + 0.0015) break;
      const g = gradient(obstacle, q[0], q[1], q[2]), m = r + 0.0015 - d; q[0] += g[0] * m; q[1] += g[1] * m; q[2] += g[2] * m; nrm = g;
    }
    // and off the face: nothing hangs across the eyes, nose or mouth
    // (with a hairline brought forward, locks lie across the forehead above the brows on their way to the sides)
    if (q[2] > -0.008 && q[1] > -0.17 && q[1] < (fwd || back ? 0.032 : 0.072) && Math.abs(q[0]) < 0.083 + r) { q[0] = side * (0.083 + r); nrm = nrm || [side, 0, 0]; }
    return nrm;
  };
  // the way back along the skull from a point whose surface faces nn: back and a little out and down, laid on the surface
  const backAlong = (qq, nn) => { const g = [qq[0] * 0.9 + side * 0.08, -0.22, -1], k = g[0] * nn[0] + g[1] * nn[1] + g[2] * nn[2]; return norm([g[0] - nn[0] * k, g[1] - nn[1] * k, g[2] - nn[2] * k]); };
  const lie = back && p[2] > -0.045 && p[1] > -0.01;   // rooted on the front half of the scalp or above the ears: it lies back first
  // the short lift at the root; or, lying back, it starts under the skin at the hairline and surfaces at a shallow angle as
  // it goes back, so from the front there is a swell rising out of the scalp and no end to see
  let q;
  if (lie) { const bd = backAlong(p, n0); pts[0] = [p[0] - n0[0] * r * 1.1, p[1] - n0[1] * r * 1.1, p[2] - n0[2] * r * 1.1]; q = [p[0] + bd[0] * r * 1.8 + n0[0] * r * 0.2, p[1] + bd[1] * r * 1.8 + n0[1] * r * 0.2, p[2] + bd[2] * r * 1.8 + n0[2] * r * 0.2]; }
  else q = [p[0] + n0[0] * r * (back ? 0.3 : 0.7), p[1] + n0[1] * r * (back ? 0.3 : 0.7), p[2] + n0[2] * r * (back ? 0.3 : 0.7)];
  clear(q); pts.push(q.slice());
  let dir = lie ? backAlong(q, n0) : norm([n0[0] * 0.35 + off[0], n0[1] * 0.35 - 0.5, n0[2] * 0.35 + off[2]]), touching = true, shelf = false, fall = 0, xs = 1, lastN = n0, wasLying = lie;
  for (let i = 0; i < 44 && q[1] > yEnd; i++) {
    // over the shoulders a lock falls to the front or the back, whichever side of them it is on
    // (and not out along them: a lock does not ride along the top of a shoulder to its edge)
    const low = shelf || q[1] < -0.16;
    // decided once, where it first reaches the shoulders, so it cannot dither along them: those hanging beside the ears
    // and forward of them fall in front, as locks do, and those behind fall down the back
    // (with lanes: one clearly in front of the shoulders or behind them keeps going that way, so none is made to cross
    // them; one that lands on top goes by where it is rooted, from the front of the head to the front, the rest down the
    // back; so the few in front have room on the chest)
    if (low && !fall) { const b = Math.abs(Math.atan2(p[0], p[2] + 0.012)); fall = !lanes ? (q[2] > -0.015 ? 1 : -1) : q[2] > 0.03 ? 1 : q[2] < -0.03 ? -1 : b < 0.85 ? 1 : -1; xs = Math.abs(q[0]); }
    // (with lanes, each keeps its place across, front and back: drawn in to the middle they crowd, and pushed apart they wave)
    // (lying back and cut to the shoulders, a lock drapes gently onto the upper back rather than running out along it)
    const lean = low ? [lanes ? 0.03 * Math.sign(q[0]) : -0.25 * Math.sign(q[0]), 0, (rest && back ? 0.3 : 1.3) * fall] : off, w = touching ? (low ? 0.8 : back ? 0.22 : 0.6) : 0.12;   // (lying back, it mostly falls: slid out along the neck it ends in a stub)
    // one from the front of the scalp first climbs back over the skull, as hair pushed back does, and only then falls;
    // falling at once it would come down over the brow and be shoved aside by the guard over the face
    const climb = !fwd && p[2] > 0.035 && Math.abs(p[0]) < 0.058 && q[2] > -0.015 && q[1] > 0.0;   // rooted on the forehead, and not yet past the crown
    // or, with the hairline brought forward, one from the front of the head goes to the side at once, lying along the
    // skull above the brow, and falls at the temple in front of the ear
    const fringe = fwd && !back && p[2] > -0.01 && Math.abs(p[0]) < 0.07 && Math.abs(q[0]) < 0.074 && q[1] > 0.03;
    const lying = lie && q[2] > -0.065 && q[1] > -0.03;   // still lying back over the skull, not yet behind the ear
    if (lie && !lying && wasLying) dir = norm([dir[0] * 0.3, -1, dir[2] * 0.3]);   // done lying back: it turns down at once (carried on, it ran out sideways)
    wasLying = lying;
    const want = lying ? backAlong(q, lastN) : fringe ? norm([side, -0.32, -0.3]) : climb ? norm([p[0] * 2, 0.15, -1]) : norm([lean[0] * w + sway[0], -1, lean[2] * w + sway[2]]), s = lying ? 0.35 : i < 1 ? 0.5 : 0.22;
    dir = norm([dir[0] * s + want[0] * (1 - s), dir[1] * s + want[1] * (1 - s), dir[2] * s + want[2] * (1 - s)]);
    const nq = [q[0] + dir[0] * seg, q[1] + dir[1] * seg, q[2] + dir[2] * seg];
    if (lanes && fall < 0 && Math.abs(nq[0]) > xs) nq[0] = Math.sign(nq[0]) * xs;   // and never further out than where it left the shoulder
    if (lying) { const d0 = obstacle(nq[0], nq[1], nq[2]), g0 = gradient(obstacle, nq[0], nq[1], nq[2]), m = d0 - (r + 0.0015); nq[0] -= g0[0] * m; nq[1] -= g0[1] * m; nq[2] -= g0[2] * m; lastN = g0; }   // lying on the skull: kept at its surface
    const nrm = clear(nq); touching = !!nrm || lying;
    // a shelf: something below the jaw facing upward, the top of a shoulder or the slope up to the neck
    shelf = !!nrm && nrm[1] > 0.45 && nq[1] < -0.09;
    dir = norm([nq[0] - q[0], nq[1] - q[1], nq[2] - q[2]]); q = nq; pts.push(q.slice());
    if (rest && shelf && i > 2) break;   // cut to the shoulders: it ends where it lands on them
    if (rest && back && touching && nq[1] < -0.12 && dir[1] > -0.55 && i > 4) break;   // (lying back: or where it starts to slide along them, before it runs out in a stub)
  }
  return { pts, clear };   // the raw points: separated from the other locks, then smoothed, by tendrilPaths
}
// Every lock's surface at once: tubes along the paths whose radius changes along their length (narrower where they
// leave the scalp, tapering a little, lumpy as a matted lock is). Dozens of locks crowd round the head, so a query
// looks only at the segments registered in its cell of a grid: every segment is registered in each cell within reach
// of it (its half length, its widest radius, and M more), so a cell with nothing in it is at least M from any lock.
function lockGrid(locks, cell = 0.025, M = 0.022) {
  const S = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  locks.forEach((lk, li) => {
    let s = 0, rmax = 0; const n = lk.pts.length - 1, segs = [];
    for (let i = 0; i < n; i++) {
      const a = lk.pts[i], b = lk.pts[i + 1], bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], len = Math.hypot(bx, by, bz) || 1e-6;
      segs.push({ a, bx, by, bz, l2: len * len, len, s0: s, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, mz: (a[2] + b[2]) / 2, li, i, n, radAt: lk.radAt });
      s += len;
    }
    for (let t = 0; t <= s; t += 0.004) rmax = Math.max(rmax, lk.radAt(t));
    for (const g of segs) { g.L = s; g.R = g.len / 2 + rmax; S.push(g); for (const [c, k] of [[g.mx, 0], [g.my, 1], [g.mz, 2]]) { lo[k] = Math.min(lo[k], c - g.R - M); hi[k] = Math.max(hi[k], c + g.R + M); } }
  });
  const nx = Math.ceil((hi[0] - lo[0]) / cell), ny = Math.ceil((hi[1] - lo[1]) / cell), nz = Math.ceil((hi[2] - lo[2]) / cell), cells = new Array(nx * ny * nz);
  const at = (v, k, n) => Math.max(0, Math.min(n - 1, Math.floor((v - lo[k]) / cell)));
  S.forEach((g, si) => {
    const e = g.R + M;
    for (let k = at(g.mz - e, 2, nz); k <= at(g.mz + e, 2, nz); k++) for (let j = at(g.my - e, 1, ny); j <= at(g.my + e, 1, ny); j++) for (let i = at(g.mx - e, 0, nx); i <= at(g.mx + e, 0, nx); i++) {
      const o = i + nx * (j + ny * k); (cells[o] || (cells[o] = [])).push(si);
    }
  });
  const list = (x, y, z) => {
    const i = Math.floor((x - lo[0]) / cell), j = Math.floor((y - lo[1]) / cell), k = Math.floor((z - lo[2]) / cell);
    return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? null : cells[i + nx * (j + ny * k)];
  };
  const field = (x, y, z) => {
    const L = list(x, y, z);
    if (!L) return M + Math.hypot(Math.max(lo[0] - x, x - hi[0], 0), Math.max(lo[1] - y, y - hi[1], 0), Math.max(lo[2] - z, z - hi[2], 0));
    let d = M;
    for (let q = 0; q < L.length; q++) {
      const g = S[L[q]];
      if (Math.hypot(x - g.mx, y - g.my, z - g.mz) - g.R >= d) continue;
      const px = x - g.a[0], py = y - g.a[1], pz = z - g.a[2], h = Math.max(0, Math.min(1, (px * g.bx + py * g.by + pz * g.bz) / g.l2));
      const v = Math.hypot(px - g.bx * h, py - g.by * h, pz - g.bz * h) - g.radAt(g.s0 + g.len * h);
      if (v < d) d = v;
    }
    return d;
  };
  // how far along its lock the nearest axis point is (0 at the scalp, 1 at the tip), or with `tip` its distance from
  // the lock's tip in metres
  const along = (x, y, z, tip) => {
    const L = list(x, y, z); if (!L) return tip ? 1 : 0;
    let best = Infinity, t = 0;
    for (let q = 0; q < L.length; q++) {
      const g = S[L[q]], px = x - g.a[0], py = y - g.a[1], pz = z - g.a[2], h = Math.max(0, Math.min(1, (px * g.bx + py * g.by + pz * g.bz) / g.l2));
      const dd = Math.hypot(px - g.bx * h, py - g.by * h, pz - g.bz * h) - g.radAt(g.s0 + g.len * h);
      if (dd < best) { best = dd; t = tip ? g.L - (g.s0 + g.len * h) : (g.i + h) / g.n; }
    }
    return t;
  };
  return { field, along, bounds: [lo.map((v) => v + M - 0.004), hi.map((v) => v - M + 0.004)] };
}

// Locks that pass through one another merge into a single melted mass, which a glossy skin shows at once. So, after
// they have fallen, push apart any two points of different locks closer than their thicknesses allow (the first few
// points, at the scalp, stay put), keep the moved points clear of the head and body, and repeat until they settle.
function separate(locks, ITER = 40, fixed = 3, smoothing = 0) {
  const cell = 0.035, key = (x, y, z) => `${x},${y},${z}`;
  // the way a lock runs at its k-th point
  const along = (pts, k) => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)]; return norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]); };
  for (let it = 0; it < ITER; it++) {
    const grid = new Map();
    locks.forEach((lk, li) => lk.pts.forEach((p, k) => {
      if (k < fixed) return;
      const kk = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(li, k);
    }));
    let moved = 0;
    locks.forEach((lk, li) => {
      for (let k = fixed; k < lk.pts.length; k++) {
        const p = lk.pts[k], cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cz = Math.floor(p[2] / cell), t = along(lk.pts, k);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
          const L = grid.get(key(cx + a, cy + b, cz + c)); if (!L) continue;
          for (let m = 0; m < L.length; m += 2) {
            const lj = L[m]; if (lj <= li) continue;
            const q = locks[lj].pts[L[m + 1]], need = (lk.r + locks[lj].r) * 0.94;
            let dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
            if (Math.hypot(dx, dy, dz) >= need) continue;
            // apart sideways, across the way the lock runs: moving along it would only slide one point past the other
            const dt = dx * t[0] + dy * t[1] + dz * t[2]; dx -= t[0] * dt; dy -= t[1] * dt; dz -= t[2] * dt;
            let d = Math.hypot(dx, dy, dz);
            if (d < 1e-4) { const o = norm([p[0] || 1e-3, 0, p[2] + 0.012]); dx = o[0] * 1e-4; dy = 0; dz = o[2] * 1e-4; d = 1e-4; }   // one exactly over the other: part them outward from the head
            const push = ((need - d) / 2 / d) * 1.2;
            p[0] -= dx * push; p[1] -= dy * push; p[2] -= dz * push; q[0] += dx * push; q[1] += dy * push; q[2] += dz * push; moved++;
          }
        }
      }
    });
    // and each lock relaxed back toward a smooth curve, so a push moves a stretch of it rather than one point
    if (smoothing) for (const lk of locks) {
      const P = lk.pts, old = P.map((p) => p.slice());
      for (let k = fixed; k < P.length - 1; k++) for (let c = 0; c < 3; c++) P[k][c] = old[k][c] * (1 - smoothing) + (old[k - 1][c] + old[k + 1][c]) * smoothing * 0.5;
    }
    for (const lk of locks) for (let k = fixed; k < lk.pts.length; k++) lk.clear(lk.pts[k]);
    if (!moved && it > 4) break;
  }
}

// every tendril as a line of points from the scalp out, with its radius at each point (or, for dreads, its own field)
export function tendrilPaths(style, thick, head, o = {}) {
  const obstacle = o.obstacle || head, out = [], N = 6;
  if (style === 'dreads') {
    const r0 = DREAD_R[thick] || DREAD_R.medium, yEnd0 = o.length === 'long' ? -0.4 : -0.215;
    const fallen = roots(head, Math.max(0.55, Math.min(1, 0.0084 / r0)), o.line, !!o.nape).map(({ id, p, n }) => {
      const r = r0 * (0.86 + 0.26 * hash(id, 7)), { pts, clear } = dreadPath(p, n, id, r, obstacle, yEnd0 - 0.045 * hash(id, 2), o.length !== 'long', !!o.line, !!o.lanes && o.length === 'long', !!o.back);   // (lanes for the long length only: the shorter already lands right)
      return { id, r, pts, clear };
    });
    // smoothed first, so the points are close enough together that two locks cannot cross between them unseen; then
    // pushed apart and relaxed in turn until they settle
    for (const f of fallen) f.pts = smooth(f.pts);
    // (lying back, they crowd behind the head: pushed apart hard there they kink sideways, so gently, and straightened after)
    separate(fallen, o.back ? 16 : 60, 6, o.back ? 0.6 : 0.4);
    // with lanes, each long lock straightened below the shoulders afterwards: the pushes apart leave waves along it (a
    // wide moving average across and front to back keeps where it lies and takes out the waves), then laid back on the body
    // (lying back, at both lengths, from the jaw down: the shorter ones hooked at their ends otherwise)
    const yS = o.back ? -0.02 : -0.17;
    if ((o.lanes && o.length === 'long') || o.back) for (const f of fallen) {
      for (let pass = 0; pass < (o.back ? 6 : 4); pass++) {
        const P = f.pts, old = P.map((q) => q.slice());
        for (let k = 3; k < P.length - 1; k++) {
          if (old[k][1] > yS) continue;
          let sx = 0, sz = 0, n = 0; for (let j = Math.max(0, k - 3); j <= Math.min(P.length - 1, k + 3); j++) { sx += old[j][0]; sz += old[j][2]; n++; }
          P[k][0] = sx / n; P[k][2] = sz / n;
        }
        for (let k = 3; k < P.length; k++) if (P[k][1] < yS) f.clear(P[k]);
      }
      // and its tip carried on along its own line (left where the pushes put it, it ended in a hook)
      const P = f.pts, n = P.length;
      if (n > 8) {
        const a = P[n - 6], b = P[n - 4], d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
        for (let j = n - 3; j < n; j++) { const l = Math.hypot(P[j][0] - P[j - 1][0], P[j][1] - P[j - 1][1], P[j][2] - P[j - 1][2]) || 0.01; P[j] = [P[j - 1][0] + d[0] * l, P[j - 1][1] + d[1] * l, P[j - 1][2] + d[2] * l]; f.clear(P[j]); }
      }
      // lying back and hanging, every step below the skull goes down: nothing holds a resting tentacle out sideways there,
      // so a step flatter than about 50° is turned down (what follows moves with it); a shorter one that comes to rest
      // on the shoulders ends there
      if (o.back) {
        const D = P.map((p, k) => k ? [p[0] - P[k - 1][0], p[1] - P[k - 1][1], p[2] - P[k - 1][2]] : null);
        let L = 0;
        for (let k = 1; k < P.length; k++) {
          const a = P[k - 1], d = D[k], l = Math.hypot(d[0], d[1], d[2]), h = Math.hypot(d[0], d[2]);
          let dd = d;
          if (k > 3 && a[1] < -0.04 && d[1] > -0.77 * l) { const hk = Math.min(h, 0.64 * l) / (h || 1); dd = [d[0] * hk, -Math.sqrt(Math.max(0, l * l - (h * hk) ** 2)), d[2] * hk]; }
          P[k] = [a[0] + dd[0], a[1] + dd[1], a[2] + dd[2]];
          if (k > 3) { const y0 = P[k][1]; f.clear(P[k]); if (o.length !== 'long' && a[1] < -0.1 && P[k][1] - y0 > 0.5 * l && L > 0.1) { P.length = k + 1; break; } }
          L += l;
        }
      }
    }
    for (const { id, r, pts } of fallen) {
      let L = 0; for (let i = 0; i + 1 < pts.length; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1], pts[i + 1][2] - pts[i][2]);
      // smooth like a tentacle: as thick as a lock at the root, then a gentle taper to a rounded tip at a little over half
      // its width; or locked, lumpy as a matted lock is (three slow waves at unrelated lengths, so not a row of beads)
      const ph = hash(id, 8) * 6.28, ph2 = hash(id, 9) * 6.28, ph3 = hash(id, 10) * 6.28, k1 = 0.021 + 0.006 * hash(id, 15);
      const rise = o.back ? (s) => 0.82 + 0.18 * Math.min(1, s / 0.03) : () => 1;   // (lying back: a little slimmer where it surfaces)
      const radAt = o.surface !== 'locked' ? (s) => rise(s) * r * 1.1 * (0.93 + 0.07 * Math.min(1, s / 0.025)) * (1 - 0.45 * Math.pow(Math.min(1, s / L), 1.6))
        : (s) => rise(s) * r * (0.8 + 0.2 * Math.min(1, s / 0.03)) * (1 - 0.13 * (s / L)) * (1 + 0.04 * Math.sin((s / k1) * 6.283 + ph) + 0.04 * Math.sin((s / 0.053) * 6.283 + ph2) + 0.022 * Math.sin((s / 0.0127) * 6.283 + ph3));
      out.push({ pts, radAt });
    }
    return out;
  }
  const r0 = (THICK[thick] || THICK.medium).r, lenK = o.length === 'long' ? 1.45 : 1;
  for (const { id, p, n: n0 } of roots(head, 1, o.line)) {
    const L = (LEN[style] || LEN.swept) * (style === 'short' ? 1 : lenK) * (0.78 + 0.44 * hash(id, 2)), rad = (i) => Math.max(0.003, r0 * (style === 'bound' ? (i < 3.5 ? 0.7 : i < 5.5 ? 0.92 : 0.6) : 1 - 0.55 * (i / N)) * (0.9 + 0.2 * hash(id, 7)));   // bound ones are pulled thin over the skull, full again where they hang together behind it
    const pts = [[p[0] - n0[0] * 0.004, p[1] - n0[1] * 0.004, p[2] - n0[2] * 0.004]];
    // keep a point outside the head by the tendril's own thickness, so tendrils lie on the skull and never in it
    const clear = (q, r) => { const dd = obstacle(q[0], q[1], q[2]); if (dd < r + 0.002) { const g = gradient(obstacle, q[0], q[1], q[2]), m = r + 0.002 - dd; q[0] += g[0] * m; q[1] += g[1] * m; q[2] += g[2] * m; } return q; };
    if (style === 'bound') {
      const G = [0, 0.018, -0.132], off = [(hash(id, 3) - 0.5) * 0.03, (hash(id, 4) - 0.5) * 0.02, (hash(id, 5) - 0.5) * 0.02];
      for (const t of [0.3, 0.6, 0.85]) pts.push(clear([p[0] + (G[0] - p[0]) * t, p[1] + (G[1] - p[1]) * t, p[2] + (G[2] - p[2]) * t], rad(2) + 0.004));
      pts.push([G[0] + off[0] * 0.5, G[1] + off[1] * 0.5, G[2]], [off[0] * 1.6, G[1] - 0.07 + off[1], G[2] - 0.02 + off[2] * 1.5], [off[0] * 3.2, G[1] - 0.08 - L * 0.75 + off[1] * 2, G[2] - 0.012 + off[2] * 2.5]);
    } else {
      const sweep = norm([n0[0] * 0.3, -0.1, -1]), back = n0[2] > 0 ? 0.55 * n0[2] : 0;   // nothing falls forward over the face
      let q = pts[0].slice();
      for (let i = 1; i <= N; i++) {
        const u = i / N; let v;
        if (style === 'short') v = [n0[0], n0[1] + 0.2, n0[2] - 0.35 * u - back];
        else { const g = Math.min(1, u * 1.8), f = g * (1 - 0.75 * u), flick = u > 0.8 ? (u - 0.8) * 1.5 : 0; v = [n0[0] * (1 - g + flick) + sweep[0] * f, n0[1] * (1 - g) + sweep[1] * f - 1.7 * u, n0[2] * (1 - g) + sweep[2] * f - 0.12]; }   // out of the scalp, back over the skull, then hanging down behind it under its own weight, the tips turning out a little
        v = norm(v); q = clear([q[0] + (v[0] * L) / N, q[1] + (v[1] * L) / N, q[2] + (v[2] * L) / N], rad(i)); pts.push(q.slice());
      }
    }
    out.push({ pts: smooth(pts), rad: (j) => rad(j / 2) });
  }
  return out;
}

export function tendrils(style, thick, head, o = {}) {
  const list = tendrilPaths(style, thick, head, o);
  if (style === 'dreads') {
    const G = lockGrid(list);
    const param = (P) => { const n = P.length / 3, T = new Float32Array(n); for (let i = 0; i < n; i++) T[i] = G.along(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); return T; };
    const fromTip = (P) => { const n = P.length / 3, D = new Float32Array(n); for (let i = 0; i < n; i++) D[i] = G.along(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], true); return D; };
    return { field: G.field, bounds: G.bounds, param, fromTip };
  }
  const ropes = list.map((t) => chain(t.pts, t.rad));
  const band = style === 'bound' ? ellipsoid(0, 0.004, -0.142, 0.036, 0.014, 0.032) : null;
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
