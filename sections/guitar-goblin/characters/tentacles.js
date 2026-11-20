// A Mikkian's head-tendrils on the human base. The paths are the earlier creator's own (../humanoid-creator/mikkian.js
// tendrilPaths: roots behind the hairline, dreads that fall under their own weight, lie on the skull and drape over
// the shoulders, then are pushed apart so no two melt together), worked out against this figure: its live surface as a
// distance field (bodyfield.js), seen in the earlier head's frame (metres from between the eyes, upright, scaled by the
// eyes' spacing). Each tendril is then drawn directly as a smooth tapered tube, with how far along it each point is
// (for tips, bands and roots in the accent colour). Pure: the workers build these.
import { tendrilPaths } from '../humanoid-creator/mikkian.js';
import { fieldFor } from './bodyfield.js';
import { hairline } from '../humanoid-creator/hair.js';

// the hairline brought forward: lower across the forehead and coming round the temples (the earlier creator's, raised)
const forward = (a) => hairline(a) - 0.024 * Math.max(0, 1 - (Math.abs(a) / 1.4) ** 2);

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Flared: under stress a Mikkian stands its tendrils straight out from the head, in every direction (SES Stallion,
// 19 Nov: "minor muscular control of them with the ability to stick them strait out during times of intense stress").
// Each keeps its root, thickness and surface; from the root it leaves the scalp square, straight out along the
// head's outward normal there, and only its outer part sags a little under its own weight. Out from a rounded head
// they spread apart, so they need no pushing apart; the lowest, at the nape, are lifted clear of the neck.
const hash = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
function flared(t, head, long, style) {
  const P0 = t.pts, root = P0[0], e = 0.002;
  let Lr = 0; for (let i = 1; i < P0.length; i++) Lr += Math.hypot(P0[i][0] - P0[i - 1][0], P0[i][1] - P0[i - 1][1], P0[i][2] - P0[i - 1][2]);
  const g = (q) => norm([head(q[0] + e, q[1], q[2]) - head(q[0] - e, q[1], q[2]), head(q[0], q[1] + e, q[2]) - head(q[0], q[1] - e, q[2]), head(q[0], q[1], q[2] + e) - head(q[0], q[1], q[2] - e)]);
  const id = Math.round((root[0] * 997 + root[1] * 577 + root[2] * 331) * 1000), h = hash(id, 1);
  let n = g(root); if (n[1] < -0.25) n = norm([n[0], -0.25, n[2] + (n[2] < 0 ? -0.2 : 0)]);   // (none down into the neck)
  const fore = Math.max(0, n[2]); if (fore > 0.2) n = norm([n[0], n[1] + 0.6 * fore, n[2]]);   // (the front ones up off the brow, and they hold, not sag over the face)
  // (a set length: lying back some ended early where they came to rest)
  const L = (style === 'short' ? 0.07 : long ? 0.26 : 0.16) * (0.85 + 0.3 * h), sag = (long ? 0.55 : 0.3) * (0.8 + 0.4 * hash(id, 2)) * (1 - 0.8 * fore), step = 0.008;
  const side = norm([(hash(id, 3) - 0.5), (hash(id, 4) - 0.5), (hash(id, 5) - 0.5)]), curl = 0.12 * (hash(id, 6) - 0.5);
  const pts = [root.slice()]; let q = root.slice();
  for (let s = step; s <= L + 1e-6; s += step) {
    const u = s / L, droop = sag * u * u, d = norm([n[0] + side[0] * curl * u, n[1] - droop, n[2] + side[2] * curl * u]);
    q = [q[0] + d[0] * step, q[1] + d[1] * step, q[2] + d[2] * step];
    // clear of the head and body by its own thickness
    const r = (t.radAt ? t.radAt(Math.min(Lr, s * Lr / L)) : 0.008) + 0.002, dd = head(q[0], q[1], q[2]);
    if (s > 0.02 && dd < r) { const gg = g(q); q = [q[0] + gg[0] * (r - dd), q[1] + gg[1] * (r - dd), q[2] + gg[2] * (r - dd)]; }
    pts.push(q);
  }
  if (t.radAt) return { pts, radAt: (s) => t.radAt(s * Lr / L) };
  const m = P0.length - 1; return { pts, rad: (i) => t.rad((i / Math.max(1, pts.length - 1)) * m) };
}

// a: { mesh: { position, normal, index } (the live figure), frame: { origin, x, up, fw, k }, style, thick, length, surface (smooth or locked),
//   front: 'forward' (the hairline brought forward; the default) or 'high', tpose: 'rest' (lying back; the default) or 'flare' }
export function mikkianTendrils(a) {
  const { position: P, normal: N, index: I } = a.mesh, F = a.frame, all = fieldFor(P, N, I, null, 0.08), k = F.k;
  const toWorld = (p) => [F.origin[0] + k * (p[0] * F.x[0] + p[1] * F.up[0] + p[2] * F.fw[0]), F.origin[1] + k * (p[0] * F.x[1] + p[1] * F.up[1] + p[2] * F.fw[1]), F.origin[2] + k * (p[0] * F.x[2] + p[1] * F.up[2] + p[2] * F.fw[2])];
  const head = (x, y, z) => all(...toWorld([x, y, z])) / k;
  // below the jaw the dreads lie on the body in its clothes: allow for cloth there
  const obstacle = (x, y, z) => { const d = head(x, y, z); return y < -0.14 ? d - 0.026 * Math.min(1, (-0.14 - y) / 0.04) : d; };
  // (the dreads rooted right at the front of the hairline climb back over the skull and show from the front as a row of
  // knobs on the brow; their neighbours cover the scalp there, so they are left out)
  // (swept back shows the forehead by its nature, and a lock rooted low on it falls over the face: it keeps the higher line)
  const fwd = a.front !== 'high' && a.style !== 'swept';
  const list = tendrilPaths(a.style || 'dreads', a.thick || 'thick', head, { length: a.length, surface: a.surface === 'locked' ? 'locked' : 'smooth', obstacle, line: fwd ? forward : undefined, lanes: true, back: true, nape: a.tpose === 'flare' && (a.style || 'dreads') === 'dreads' })   // (relaxed, they lie back: SES Stallion, 19 Nov)
    .filter((t) => fwd || (a.style || 'dreads') !== 'dreads' || !(t.pts[0][2] > 0.03 && Math.abs(t.pts[0][0]) < 0.06))
    .map((t) => (a.tpose === 'flare' && a.style !== 'bound' ? flared(t, head, a.length === 'long', a.style || 'dreads') : t));
  // tubes
  const R = 12, pos = [], nrm = [], idx = [], T = [], D = [];
  for (const t of list) {
    const pts = t.pts.map(toWorld), n = pts.length; if (n < 2) continue;
    const s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const L = s[n - 1] || 1e-6, rad = (i) => k * (t.radAt ? t.radAt(s[i] / k) : t.rad(i));
    // frames carried along the path so the tube does not twist
    let tan = norm([pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]]), nx = norm(cross(tan, Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const v0 = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const j0 = Math.max(0, i - 1), j1 = Math.min(n - 1, i + 1), nt = norm([pts[j1][0] - pts[j0][0], pts[j1][1] - pts[j0][1], pts[j1][2] - pts[j0][2]]);
      const dd = nx[0] * nt[0] + nx[1] * nt[1] + nx[2] * nt[2]; nx = norm([nx[0] - nt[0] * dd, nx[1] - nt[1] * dd, nx[2] - nt[2] * dd]); tan = nt;
      const bx = cross(tan, nx), r = rad(i);
      for (let j = 0; j < R; j++) {
        const an = (j / R) * Math.PI * 2, c = Math.cos(an), sn = Math.sin(an), d = [nx[0] * c + bx[0] * sn, nx[1] * c + bx[1] * sn, nx[2] * c + bx[2] * sn];
        pos.push(pts[i][0] + d[0] * r, pts[i][1] + d[1] * r, pts[i][2] + d[2] * r); nrm.push(...d); T.push(s[i] / L); D.push(L - s[i]);
      }
    }
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j < R; j++) { const p0 = v0 + i * R + j, p1 = v0 + i * R + ((j + 1) % R); idx.push(p0, p1, p0 + R, p1, p1 + R, p0 + R); }
    // the root closed too (an open end shows as a dark ring where the root stands out from the scalp)
    { const t0 = norm([pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]]), r0 = rad(0), c = pos.length / 3; pos.push(pts[0][0] - t0[0] * r0 * 0.5, pts[0][1] - t0[1] * r0 * 0.5, pts[0][2] - t0[2] * r0 * 0.5); nrm.push(-t0[0], -t0[1], -t0[2]); T.push(0); D.push(L);
      for (let j = 0; j < R; j++) idx.push(c, v0 + ((j + 1) % R), v0 + j); }
    // a rounded tip: a ring a little past the end, closing to a point
    const e = pts[n - 1], tv = tan, rt = rad(n - 1), ring = pos.length / 3;
    for (let j = 0; j < R; j++) { const an = (j / R) * Math.PI * 2, bx = cross(tv, nx), d = [nx[0] * Math.cos(an) + bx[0] * Math.sin(an), nx[1] * Math.cos(an) + bx[1] * Math.sin(an), nx[2] * Math.cos(an) + bx[2] * Math.sin(an)];
      pos.push(e[0] + tv[0] * rt * 0.6 + d[0] * rt * 0.75, e[1] + tv[1] * rt * 0.6 + d[1] * rt * 0.75, e[2] + tv[2] * rt * 0.6 + d[2] * rt * 0.75); nrm.push(...norm([d[0] + tv[0], d[1] + tv[1], d[2] + tv[2]])); T.push(1); D.push(0); }
    const tip = pos.length / 3; pos.push(e[0] + tv[0] * rt, e[1] + tv[1] * rt, e[2] + tv[2] * rt); nrm.push(...tv); T.push(1); D.push(0);
    const last = v0 + (n - 1) * R;
    for (let j = 0; j < R; j++) { const a0 = last + j, a1 = last + ((j + 1) % R), b0 = ring + j, b1 = ring + ((j + 1) % R); idx.push(a0, a1, b0, a1, b1, b0, b0, b1, tip); }
  }
  // bound: the band round the bundle behind the head, a flattened ring (painted as the band: t 1.5)
  if (a.style === 'bound') {
    const c = toWorld([0, 0.004, -0.142]), RX = 0.036 * k, RZ = 0.032 * k, TH = 0.008 * k, N = 32, M = 10, b0 = pos.length / 3;
    for (let i = 0; i <= N; i++) { const u = (i / N) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
      for (let j = 0; j <= M; j++) { const v = (j / M) * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v), rx = RX + TH * cv, rz = RZ + TH * cv;
        const w = [rx * cu, TH * 1.4 * sv, rz * su], wn = norm([cv * cu, sv, cv * su]);
        pos.push(c[0] + w[0] * F.x[0] + w[1] * F.up[0] + w[2] * F.fw[0], c[1] + w[0] * F.x[1] + w[1] * F.up[1] + w[2] * F.fw[1], c[2] + w[0] * F.x[2] + w[1] * F.up[2] + w[2] * F.fw[2]);
        nrm.push(wn[0] * F.x[0] + wn[1] * F.up[0] + wn[2] * F.fw[0], wn[0] * F.x[1] + wn[1] * F.up[1] + wn[2] * F.fw[1], wn[0] * F.x[2] + wn[1] * F.up[2] + wn[2] * F.fw[2]); T.push(1.5); D.push(1); } }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const q = b0 + i * (M + 1) + j, r = q + M + 1; idx.push(q, r, q + 1, r, r + 1, q + 1); }
  }
  return { position: Float32Array.from(pos), normal: Float32Array.from(nrm), index: Uint32Array.from(idx), t: Float32Array.from(T), d: Float32Array.from(D), count: list.length };
}
