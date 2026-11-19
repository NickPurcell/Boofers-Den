// Hair worn down (the bob and long hair) as locks, like the slicked-back style's. Each lock is combed over the scalp
// away from a centre parting (streamlines on the live head found by rays from the skull's middle, as the slicked style's
// are, so they run smooth), and where it leaves the scalp, at the hairline round the face or low on the back of the head,
// it falls: a short steady curve out and down, kept clear of the face and of the figure in its clothes, to the jaw for a
// bob or below the shoulders for long hair. Each is drawn as a flat ribbon, wide across and thin outward, its frame carried
// along it so it does not twist (the lock recipe weighed from the img2threejs hair guide, as in hair-shape.js), tapering
// to its end. Worked out in a worker against the live figure; the earlier head's frame (as in tentacles.js) gives the
// parting, the hairline and the lengths. Pure.
import { fieldFor } from './bodyfield.js';
import { gradient } from '../duros-creator/sdf.js';
import { hairline, caster, STYLES } from './hair-shape.js';

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const hash = (i, j = 0) => { const s = Math.sin(i * 127.1 + j * 311.7 + 3.3) * 43758.5453; return s - Math.floor(s); };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function smooth(pts) {   // a point between each pair, on a Catmull-Rom curve
  const n = pts.length, out = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = pts[Math.max(i - 1, 0)], b = pts[i], c = pts[i + 1], d = pts[Math.min(i + 2, n - 1)];
    out.push(b, [0, 1, 2].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * 0.5 + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * 0.25 + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * 0.125)));
  }
  out.push(pts[n - 1]); return out;
}

// a: { mesh: { position, normal, index }, frame: { origin, x, up, fw, k }, style: 'bob' | 'long' }
export function hairLocks(a) {
  const { position: P, normal: N, index: I } = a.mesh, F = a.frame, k = F.k, long = a.style === 'long';
  const toW = (q) => [F.origin[0] + k * (q[0] * F.x[0] + q[1] * F.up[0] + q[2] * F.fw[0]), F.origin[1] + k * (q[0] * F.x[1] + q[1] * F.up[1] + q[2] * F.fw[1]), F.origin[2] + k * (q[0] * F.x[2] + q[1] * F.up[2] + q[2] * F.fw[2])];
  const dirW = (d) => [d[0] * F.x[0] + d[1] * F.up[0] + d[2] * F.fw[0], d[0] * F.x[1] + d[1] * F.up[1] + d[2] * F.fw[1], d[0] * F.x[2] + d[1] * F.up[2] + d[2] * F.fw[2]];
  const toL = (p) => { const d = [p[0] - F.origin[0], p[1] - F.origin[1], p[2] - F.origin[2]]; return [dot(d, F.x) / k, dot(d, F.up) / k, dot(d, F.fw) / k]; };
  const C = toW([0, 0.03, -0.012]);
  const cast = caster(P, I, C, (x, y, z) => { const q = toL([x, y, z]); return q[1] > -0.14 && Math.hypot(q[0], q[2] + 0.012) < 0.15; });
  const all = fieldFor(P, N, I, null, 0.08);
  const nrmAt = (h) => { const a0 = I[h.t] * 3, b = I[h.t + 1] * 3, c = I[h.t + 2] * 3, w = 1 - h.u - h.v; return norm([N[a0] * w + N[b] * h.u + N[c] * h.v, N[a0 + 1] * w + N[b + 1] * h.u + N[c + 1] * h.v, N[a0 + 2] * w + N[b + 2] * h.u + N[c + 2] * h.v]); };
  const capT = (q) => STYLES.crop.thick(...q) * k;   // the close cap the locks lie on (the page puts the crop under them)
  const endY = long ? -0.29 : -0.085, locks = [];
  // seeds: [local direction from the skull's middle, which side, kind]
  const seeds = [];
  for (let i = 0; i < 16; i++) { const t = i / 15, th = -0.28 + 1.38 * t; for (const s of [1, -1]) seeds.push([[s * 0.025, Math.cos(th), Math.sin(th)], s, 'part']); }
  for (let i = 0; i < 18; i++) { const az = Math.PI * (0.55 + 0.9 * (i / 17)); seeds.push([[Math.sin(az) * 0.8, 0.55, Math.cos(az) * 0.8], Math.sign(Math.sin(az)) || 1, 'back']); }
  for (let i = 0; i < 9; i++) { const az = Math.PI * (0.7 + 0.6 * (i / 8)); seeds.push([[Math.sin(az) * 0.5, 0.86, Math.cos(az) * 0.5], Math.sign(Math.sin(az)) || 1, 'back']); }   // and nearer the crown
  for (let i = 0; i < 14; i++) { const s = i % 2 ? 1 : -1, az = s * (0.75 + 1.25 * ((i >> 1) / 6)); seeds.push([[Math.sin(az) * 0.92, 0.32, Math.cos(az) * 0.92], s, 'side']); }
  seeds.forEach(([dl, side, kind], id) => {
    let h = cast(norm(dirW(norm(dl)))); if (!h) return;
    let ql = toL(h.p); if (ql[1] < hairline(Math.atan2(ql[0], ql[2])) + 0.004) return;
    const layer = kind === 'part' ? 2 : kind === 'side' ? 1 : 0, pts = [], ns = [];
    const lift = (hh) => { const n = nrmAt(hh), q = toL(hh.p), t = capT(q) + (0.0018 + 0.0012 * layer) * k; return [[hh.p[0] + n[0] * t, hh.p[1] + n[1] * t, hh.p[2] + n[2] * t], n]; };
    // over the scalp: away from the parting and down (those from the front of the parting sweep back over the temple;
    // those behind the crown fall straight down the back of the head)
    for (let n = 0; n < 80; n++) {
      const [p, nn] = lift(h); pts.push(p); ns.push(nn);
      const q = toL(h.p), wantL = kind === 'back' ? [q[0] * 1.5, -1, -0.25] : [side * 1.0, -1, q[2] > 0.02 ? -1.0 : -0.3];
      const w = norm(dirW(wantL)), t = norm([w[0] - nn[0] * dot(w, nn), w[1] - nn[1] * dot(w, nn), w[2] - nn[2] * dot(w, nn)]), st = 0.006 * k;
      const h2 = cast(norm([h.p[0] + t[0] * st - C[0], h.p[1] + t[1] * st - C[1], h.p[2] + t[2] * st - C[2]])); if (!h2) break;
      const q2 = toL(h2.p), stop = Math.max(hairline(Math.atan2(q2[0], q2[2])) + 0.002, kind === 'back' ? -0.06 : -0.02);
      if (q2[1] < stop) break;
      h = h2;
    }
    if (pts.length < 3) return;
    const exit = toL(h.p), atBrow = exit[2] > 0.02 && Math.abs(exit[0]) < 0.07;   // a lock that reaches the hairline over the brow ends there, tucked (it would fall across the face)
    // falling: from where it leaves the scalp, out and then down, each lock at its own lean
    const clearOf = (p, r) => {   // out of the figure (and its clothes below the jaw), and never across the face
      for (let i = 0; i < 4; i++) { const ql2 = toL(p), m = r + (ql2[1] < -0.12 ? 0.02 * k * Math.min(1, (-0.12 - ql2[1]) / 0.04) : 0), d = all(...p); if (d >= m) break; const g = gradient(all, ...p); p[0] += g[0] * (m - d); p[1] += g[1] * (m - d); p[2] += g[2] * (m - d); }
      const ql = toL(p); if (ql[2] > -0.012 && ql[1] > -0.15 && ql[1] < 0.07 && Math.abs(ql[0]) < 0.086) { ql[0] = (Math.sign(ql[0]) || side) * 0.086; const w = toW(ql); p[0] = w[0]; p[1] = w[1]; p[2] = w[2]; }
      return p;
    };
    let p = pts[pts.length - 1], t0 = norm([p[0] - pts[pts.length - 3][0], p[1] - pts[pts.length - 3][1], p[2] - pts[pts.length - 3][2]]), dir = t0;
    const lean = 0.04 + 0.06 * hash(id, 3), ey = endY - (long ? 0.035 : 0.01) * hash(id, 4) + (kind === 'back' ? 0 : long ? 0.02 : 0.006), seg = 0.016 * k, fall = [];
    let fb = 0;   // below the jaw a lock falls to the front of the shoulder or down the back, decided once
    for (let n = 0; n < 50 && !atBrow; n++) {
      const ql = toL(p); if (ql[1] < ey) break;
      if (!fb && ql[1] < -0.12) fb = ql[2] > -0.02 ? 1 : -1;
      // (past the shoulders it is drawn in toward the body's middle, so it drapes down the back or the chest instead of
      // fanning out along the shoulders)
      const out = norm(dirW(norm([ql[0], 0, ql[2] + 0.012]))), fz = dirW([0, 0, fb * 0.55]), lw = fb ? -0.35 * sstep(-0.12, -0.2, ql[1]) : lean;
      const down = norm([-F.up[0] + out[0] * lw + fz[0], -F.up[1] + out[1] * lw + fz[1], -F.up[2] + out[2] * lw + fz[2]]);
      dir = norm([dir[0] * 0.6 + down[0] * 0.4, dir[1] * 0.6 + down[1] * 0.4, dir[2] * 0.6 + down[2] * 0.4]);
      const np = clearOf([p[0] + dir[0] * seg, p[1] + dir[1] * seg, p[2] + dir[2] * seg], (0.004 + 0.0012 * layer) * k);
      dir = norm([np[0] - p[0], np[1] - p[1], np[2] - p[2]]); p = np; fall.push(np);
    }
    // thin the scalp part to every other point, join, and smooth (twice: no elbows where it leaves the scalp)
    const path = smooth(smooth([...pts.filter((_, i) => i % 2 === 0 || i === pts.length - 1), ...fall]));
    locks.push({ id, path, n0: ns[0], w: (0.024 + 0.008 * hash(id, 1)) * k, layer });
  });
  // ribbons, frames carried along (parallel transport): wide across the hair's surface, thin outward
  const S = 6, pos = [], nrm = [], idx = [], shade = [], uv = [];
  for (const L of locks) {
    const pts = L.path, n = pts.length, s = [0]; for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const len = s[n - 1] || 1e-6, v0 = pos.length / 3; let o = L.n0;
    for (let i = 0; i < n; i++) {
      const j0 = Math.max(0, i - 1), j1 = Math.min(n - 1, i + 1), t = norm([pts[j1][0] - pts[j0][0], pts[j1][1] - pts[j0][1], pts[j1][2] - pts[j0][2]]);
      o = norm([o[0] - t[0] * dot(o, t), o[1] - t[1] * dot(o, t), o[2] - t[2] * dot(o, t)]); const b = cross(t, o);
      const u = s[i] / len, taper = u < 0.75 ? 1 : 1 - 0.8 * ((u - 0.75) / 0.25), root = sstep(0, 0.04, u), W = L.w * taper * (0.5 + 0.5 * root), T = 0.0032 * k * taper * (0.5 + 0.5 * root);
      for (let j = 0; j < S; j++) {
        const an = (j / S) * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an), hk = T * (sa > 0 ? 1 : 0.4);
        pos.push(pts[i][0] + b[0] * ca * W / 2 + o[0] * sa * hk, pts[i][1] + b[1] * ca * W / 2 + o[1] * sa * hk, pts[i][2] + b[2] * ca * W / 2 + o[2] * sa * hk);
        nrm.push(...norm([b[0] * ca / W + o[0] * sa / hk, b[1] * ca / W + o[1] * sa / hk, b[2] * ca / W + o[2] * sa / hk]));
        shade.push((0.55 + 0.45 * Math.max(0, sa)) * (0.8 + 0.35 * hash(L.id, 7)) * (0.8 + 0.2 * L.layer / 2)); uv.push(j / S, s[i] * 6);
      }
    }
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j < S; j++) { const p0 = v0 + i * S + j, p1 = v0 + i * S + ((j + 1) % S); idx.push(p0, p0 + S, p1, p1, p0 + S, p1 + S); }
  }
  return { position: Float32Array.from(pos), normal: Float32Array.from(nrm), index: Uint32Array.from(idx), shade: Float32Array.from(shade), uv: Float32Array.from(uv), count: locks.length };
}
