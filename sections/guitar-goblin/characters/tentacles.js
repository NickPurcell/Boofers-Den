// A Mikkian's head-tendrils on the human base. The paths are the earlier creator's own (../humanoid-creator/mikkian.js
// tendrilPaths: roots behind the hairline, dreads that fall under their own weight, lie on the skull and drape over
// the shoulders, then are pushed apart so no two melt together), worked out against this figure: its live surface as a
// distance field (bodyfield.js), seen in the earlier head's frame (metres from between the eyes, upright, scaled by the
// eyes' spacing). Each tendril is then drawn directly as a smooth tapered tube, with how far along it each point is
// (for tips, bands and roots in the accent colour). Pure: the workers build these.
import { tendrilPaths } from '../humanoid-creator/mikkian.js';
import { fieldFor } from './bodyfield.js';

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// a: { mesh: { position, normal, index } (the live figure), frame: { origin, x, up, fw, k }, style, thick, length, surface (smooth or locked) }
export function mikkianTendrils(a) {
  const { position: P, normal: N, index: I } = a.mesh, F = a.frame, all = fieldFor(P, N, I, null, 0.08), k = F.k;
  const toWorld = (p) => [F.origin[0] + k * (p[0] * F.x[0] + p[1] * F.up[0] + p[2] * F.fw[0]), F.origin[1] + k * (p[0] * F.x[1] + p[1] * F.up[1] + p[2] * F.fw[1]), F.origin[2] + k * (p[0] * F.x[2] + p[1] * F.up[2] + p[2] * F.fw[2])];
  const head = (x, y, z) => all(...toWorld([x, y, z])) / k;
  // below the jaw the dreads lie on the body in its clothes: allow for cloth there
  const obstacle = (x, y, z) => { const d = head(x, y, z); return y < -0.14 ? d - 0.026 * Math.min(1, (-0.14 - y) / 0.04) : d; };
  // (the dreads rooted right at the front of the hairline climb back over the skull and show from the front as a row of
  // knobs on the brow; their neighbours cover the scalp there, so they are left out)
  const list = tendrilPaths(a.style || 'dreads', a.thick || 'thick', head, { length: a.length, surface: a.surface === 'locked' ? 'locked' : 'smooth', obstacle })
    .filter((t) => (a.style || 'dreads') !== 'dreads' || !(t.pts[0][2] > 0.03 && Math.abs(t.pts[0][0]) < 0.06));
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
    // a rounded tip: a ring a little past the end, closing to a point
    const e = pts[n - 1], tv = tan, rt = rad(n - 1), ring = pos.length / 3;
    for (let j = 0; j < R; j++) { const an = (j / R) * Math.PI * 2, bx = cross(tv, nx), d = [nx[0] * Math.cos(an) + bx[0] * Math.sin(an), nx[1] * Math.cos(an) + bx[1] * Math.sin(an), nx[2] * Math.cos(an) + bx[2] * Math.sin(an)];
      pos.push(e[0] + tv[0] * rt * 0.6 + d[0] * rt * 0.75, e[1] + tv[1] * rt * 0.6 + d[1] * rt * 0.75, e[2] + tv[2] * rt * 0.6 + d[2] * rt * 0.75); nrm.push(...norm([d[0] + tv[0], d[1] + tv[1], d[2] + tv[2]])); T.push(1); D.push(0); }
    const tip = pos.length / 3; pos.push(e[0] + tv[0] * rt, e[1] + tv[1] * rt, e[2] + tv[2] * rt); nrm.push(...tv); T.push(1); D.push(0);
    const last = v0 + (n - 1) * R;
    for (let j = 0; j < R; j++) { const a0 = last + j, a1 = last + ((j + 1) % R), b0 = ring + j, b1 = ring + ((j + 1) % R); idx.push(a0, a1, b0, a1, b1, b0, b0, b1, tip); }
  }
  return { position: Float32Array.from(pos), normal: Float32Array.from(nrm), index: Uint32Array.from(idx), t: Float32Array.from(T), d: Float32Array.from(D), count: list.length };
}
