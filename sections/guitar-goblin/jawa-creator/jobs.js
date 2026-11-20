// What the Jawa creator's mesher workers do: turn one part of the figure into triangle arrays. Also imported
// directly as a fallback when a browser can't start a module worker.
import { mesh } from '../duros-creator/sdf.js';
import { BUILDS, pose, robeField, hoodField, handField, feetField, skirtEdge, V } from './figure.js';
import { strapPieces, exitPoint } from './straps.js';

export const RES = { robe: 0.0052, hood: 0.004, hand: 0.0025, feet: 0.003, strap: 0.0026 };

// One slab of a tall field, so several workers can share it. The slabs' grids line up and each samples a margin
// beyond its own share, so the vertices where two slabs meet are the same points; a slab keeps only its own triangles.
function slab(field, bounds, h, part, of, opts) {
  if (!of || of < 2) return mesh(field, bounds, h, opts);
  const [mn, mx] = bounds, ny = Math.ceil((mx[1] - mn[1]) / h), M = 6;
  const j0 = Math.floor((part * ny) / of), j1 = Math.floor(((part + 1) * ny) / of);
  const lo = mn[1] + Math.max(0, j0 - M) * h, hi = mn[1] + Math.min(ny, j1 + M) * h;
  const m = mesh(field, [[mn[0], lo, mn[2]], [mx[0], hi, mx[2]]], h, opts);
  const ya = part === 0 ? -Infinity : j0, yb = part === of - 1 ? Infinity : j1, P = m.position, I = m.index;
  const keep = new Int32Array(P.length / 3).fill(-1), idx = [];
  for (let k = 0; k < I.length; k += 3) {
    const c = ((P[I[k] * 3 + 1] + P[I[k + 1] * 3 + 1] + P[I[k + 2] * 3 + 1]) / 3 - mn[1]) / h;
    if (c >= ya && c < yb) idx.push(I[k], I[k + 1], I[k + 2]);
  }
  let n = 0; for (const v of idx) if (keep[v] < 0) keep[v] = n++;
  const out = { position: new Float32Array(n * 3), normal: new Float32Array(n * 3), ao: new Float32Array(n), uv: new Float32Array(n * 2), index: n > 65535 ? new Uint32Array(idx.length) : new Uint16Array(idx.length) };
  for (let v = 0; v < keep.length; v++) {
    const t = keep[v]; if (t < 0) continue;
    out.position.set(P.subarray(v * 3, v * 3 + 3), t * 3); out.normal.set(m.normal.subarray(v * 3, v * 3 + 3), t * 3); out.ao[t] = m.ao[v]; out.uv.set(m.uv.subarray(v * 2, v * 2 + 2), t * 2);
  }
  for (let k = 0; k < idx.length; k++) out.index[k] = keep[idx[k]];
  return out;
}
// a number per vertex from a function of position (which cloth is lining, and so on)
function masked(m, f) { const n = m.ao.length, a = new Float32Array(n), P = m.position; for (let i = 0; i < n; i++) a[i] = f(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); m.mask = a; return m; }
export function run(job, a) {
  const B = BUILDS[a.build] || BUILDS.average;
  if (job === 'robe') {
    const arms = pose(a.stance, B), r = robeField(B, arms);
    const out = { mesh: masked(slab(r.field, r.bounds, RES.robe, a.part, a.of, { aoStep: 0.007, band: 1.5 }), r.lining) };
    if (!a.part) {   // the frayed edges: where the threads start, and which way they hang
      out.fringe = [];
      // the hem, all the way round
      const N = 260, pts = new Float32Array(N * 3), dir = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const th = (i / N - 0.5) * Math.PI * 2, e = skirtEdge(th, B); pts.set(e.p, i * 3); dir.set([e.n[0] * 0.3, -1, e.n[2] * 0.3], i * 3); }
      out.fringe.push({ pts, dir, closed: true, len: 0.02, seed: 3 });
      // each cuff: a ring round the sleeve's mouth, a little way inside the cut
      for (const arm of [arms.L, arms.R]) {
        const M = 72, cp = new Float32Array(M * 3), cd = new Float32Array(M * 3), level = 1 - Math.abs(arm.ax[1]), drop = 0.046 + 0.05 * level;
        let u = V.cross(arm.ax, [0, 1, 0]); if (Math.hypot(...u) < 0.2) u = [1, 0, 0]; u = V.norm(u); const v = V.cross(arm.ax, u);
        const o = V.add(V.add(arm.cuff, V.mul(arm.ax, -0.016)), [0, -drop * 0.45, 0]);
        for (let i = 0; i < M; i++) {
          const ang = (i / M) * Math.PI * 2, d = V.add(V.mul(u, Math.cos(ang)), V.mul(v, Math.sin(ang)));
          cp.set(exitPoint(r.field, o, d), i * 3); cd.set([arm.ax[0] + d[0] * 0.25, arm.ax[1] + d[1] * 0.25 - 0.45, arm.ax[2] + d[2] * 0.25], i * 3);
        }
        out.fringe.push({ pts: cp, dir: cd, closed: true, len: 0.026, seed: arm.s > 0 ? 11 : 17 });
      }
    }
    return out;
  }
  if (job === 'hood') {
    const hd = hoodField(a.hood, B);
    const out = { mesh: masked(slab(hd.field, hd.bounds, RES.hood, a.part, a.of, { aoStep: 0.005, band: 1.8 }), hd.lining), open: hd.open };
    if (a.part) return out;
    // the mantle's ragged edge
    const N = 150, pts = new Float32Array(N * 3), dir = new Float32Array(N * 3), my = hd.mantle.y1 + 0.016;
    for (let i = 0; i < N; i++) {
      const th = (i / N - 0.5) * Math.PI * 2, d = [Math.sin(th), 0, Math.cos(th) * 0.84], o = [0, my + 0.012 - 0.014 * Math.max(0, Math.cos(th)), 0];
      pts.set(exitPoint(hd.field, o, V.norm(d)), i * 3); dir.set([d[0] * 0.45, -1, d[2] * 0.45], i * 3);
    }
    out.fringe = [{ pts, dir, closed: true, len: 0.018, seed: 29 }];
    out.ties = [-1, 1].map((sx) => { const o = [sx * 0.034, hd.mantle.y0 - 0.035, 0], p = exitPoint(hd.field, o, V.norm([sx * 0.12, 0, -1])); return { p, len: 0.2 + 0.06 * (sx > 0 ? 1 : 0), sx }; });
    return out;
  }
  if (job === 'hands') {
    const arms = pose(a.stance, B, !!a.held), out = { meshes: [], grips: {}, arms: { L: { E: arms.L.E, W: arms.L.W, ax: arms.L.ax, side: arms.L.side, up: arms.L.up }, R: { E: arms.R.E, W: arms.R.W, ax: arms.R.ax, side: arms.R.side, up: arms.R.up } } };
    for (const k of ['L', 'R']) { const hf = handField(arms[k]); out.meshes.push(mesh(hf.field, hf.bounds, RES.hand, { aoStep: 0.0028, band: 1.5 })); out.grips[k] = hf.grip; }
    return out;
  }
  if (job === 'feet') { const f = feetField(B); return { mesh: mesh(f.field, f.bounds, RES.feet, { aoStep: 0.0035, band: 1.6 }) }; }
  if (job === 'straps') {
    // the leather and canvas: straps, pouches, a satchel. A share of the pieces when split between workers.
    const all = strapPieces(a, B), mine = a.of ? all.filter((p, i) => i % a.of === a.part) : all;
    return { count: all.length, pieces: mine.map((p) => ({ name: p.name, index: p.index, material: p.material, tone: p.tone || 0, mesh: mesh(p.field, p.bounds, p.res || RES.strap, { aoStep: 0.003, band: 1.6 }), at: p.at || null })), anchors: a.part ? null : all.anchors };
  }
  throw new Error('unknown job ' + job);
}

// the arrays a result holds, so a worker can hand them over without copying
export function transferables(out) {
  const list = [], seen = new Set();
  const take = (m) => { if (m) for (const k of ['position', 'normal', 'ao', 'uv', 'index', 'mask', 'pts', 'dir']) if (m[k] && m[k].buffer && !seen.has(m[k].buffer)) { seen.add(m[k].buffer); list.push(m[k].buffer); } };
  take(out.mesh);
  for (const m of out.meshes || []) take(m);
  for (const p of out.pieces || []) take(p.mesh);
  for (const f of out.fringe || []) take(f);
  for (const r of (out.anchors && out.anchors.ribbons) || []) { for (const k of ['pts', 'nrm']) if (r[k] && !seen.has(r[k].buffer)) { seen.add(r[k].buffer); list.push(r[k].buffer); } }
  return list;
}
