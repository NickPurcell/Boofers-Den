// What the worker pool does for the characters page: turn an outfit on the live body into triangle arrays.
// a: { key, surface: { position, normal, index }, J (joints), L (landmarks), part, of }
import { mesh } from '../duros-creator/sdf.js';
import { bodyFields } from './bodyfield.js';
import { OUTFITS, cowl, hood } from './outfit-shape.js';
import { mikkianTendrils } from './tentacles.js';

// which triangles are the arms: near the line from the shoulder joint through the elbow to past the hand, and past the
// top of the shoulder (the shoulder's cap stays with the body, for the cuirass and the pauldrons)
export function armTriangles(P, I, J) {
  const out = new Uint8Array(I.length / 3);
  const seg = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L2)); return [Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t), t * Math.sqrt(L2)]; };
  for (const s of ['l', 'r']) {
    const S = J[s + '-shoulder'], E = J[s + '-elbow'], H = J[s + '-hand'], X = [H[0] + (H[0] - E[0]) * 0.6, H[1] + (H[1] - E[1]) * 0.6, H[2] + (H[2] - E[2]) * 0.6];
    for (let t = 0; t < I.length; t += 3) {
      const c = [0, 1, 2].map((k) => (P[I[t] * 3 + k] + P[I[t + 1] * 3 + k] + P[I[t + 2] * 3 + k]) / 3);
      const [d1, a1] = seg(c, S, E), [d2] = seg(c, E, H), [d3] = seg(c, H, X);
      if ((d1 < 0.1 && a1 > 0.05) || d2 < 0.085 || d3 < 0.12) out[t / 3] = 1;   // (the hand wider: spread fingers are arm too)
    }
  }
  return out;
}
// The torso smoothed: at each height (1.5 cm apart, from the hips to the neck) the body without its arms measured
// across and front to back, and a rounded box (a superellipse) of those sizes; its field, for plate to lie on
export function torsoField(P, I, arm, J) {
  const y0 = J['spine-3'][1] - 0.06, y1 = J.neck[1] + 0.01, B = 0.015, n = Math.ceil((y1 - y0) / B) + 1;   // from just below the waist (the hips' width stays out of it)
  const xm = new Float32Array(n), z0 = new Float32Array(n).fill(Infinity), z1 = new Float32Array(n).fill(-Infinity), onArm = new Uint8Array(P.length / 3);
  for (let t = 0; t < I.length; t += 3) if (arm[t / 3]) { onArm[I[t]] = onArm[I[t + 1]] = onArm[I[t + 2]] = 1; }
  const sx = Math.abs(J['l-shoulder'][0]) + 0.01;
  for (let i = 0; i < P.length / 3; i++) {
    if (onArm[i] || Math.abs(P[i * 3]) > sx) continue;   // the torso only: within the shoulders' joints
    const k = Math.round((P[i * 3 + 1] - y0) / B); if (k < 0 || k >= n) continue;
    xm[k] = Math.max(xm[k], Math.abs(P[i * 3])); z0[k] = Math.min(z0[k], P[i * 3 + 2]); z1[k] = Math.max(z1[k], P[i * 3 + 2]);
  }
  // the outermost over 6 cm up and down, then evened out: it touches the tops of the muscles and bridges between them
  const grow = (a, sign) => a.map((_, k) => { let m = a[k] * sign; for (let j = Math.max(0, k - 2); j <= Math.min(n - 1, k + 2); j++) m = Math.max(m, a[j] * sign); return m * sign; });
  const sm = (a) => a.map((_, k) => { let s = 0, w = 0; for (let j = Math.max(0, k - 2); j <= Math.min(n - 1, k + 2); j++) { const q = 3 - Math.abs(j - k); s += a[j] * q; w += q; } return s / w; });
  // (a light touch: the body's own extents at each height, evened out and drawn in a little, so the plate bridges the
  // deeper hollows but sits close on everything else)
  const X = sm(xm), Zf = sm(grow(z1, 1).map((v, k) => (v + z1[k]) / 2)), Zb = sm(z0);
  const RX = X.map((v) => v * 0.96), ZC = Zf.map((v, k) => (v + Zb[k]) / 2), RZ = Zf.map((v, k) => (v - Zb[k]) / 2 * 0.975);
  const p = 3.2;   // a rounded box: a flat front that bridges the chest
  return (x, y, z) => {
    const f = Math.max(0, Math.min(n - 1.001, (y - y0) / B)), k = Math.floor(f), u = f - k;
    const rx = RX[k] * (1 - u) + RX[k + 1] * u, rz = RZ[k] * (1 - u) + RZ[k + 1] * u, zc = ZC[k] * (1 - u) + ZC[k + 1] * u;
    const e = Math.pow(Math.pow(Math.abs(x) / rx, p) + Math.pow(Math.abs(z - zc) / rz, p), 1 / p) - 1;
    return Math.max(e * Math.min(rx, rz), y0 - y, y - y1);
  };
}
// the hips' half-width and half-depth, and their middle front to back: the body (not the arms) at the hip joints' height
function hipsOf(P, I, arm, J) {
  const y = J['l-upper-leg'][1] + 0.02, onArm = new Uint8Array(P.length / 3);
  for (let t = 0; t < I.length; t += 3) if (arm[t / 3]) { onArm[I[t]] = onArm[I[t + 1]] = onArm[I[t + 2]] = 1; }
  let rx = 0, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < P.length / 3; i++) { if (onArm[i] || Math.abs(P[i * 3 + 1] - y) > 0.02) continue; rx = Math.max(rx, Math.abs(P[i * 3])); z0 = Math.min(z0, P[i * 3 + 2]); z1 = Math.max(z1, P[i * 3 + 2]); }
  return { rx, rz: (z1 - z0) / 2, zc: (z0 + z1) / 2 };
}
export function run(job, a) {
  if (job === 'outfit') {
    const t0 = performance.now(), began = Date.now();
    // (the base mesh before subdivision: a quarter of the triangles, and clothes stand clear of the 1-2 mm difference)
    const { position: P, normal: N, index: I } = a.surface, arm = armTriangles(P, I, a.J);
    // the whole figure, the body without its arms (negative inside where its own skin is nearer than the arms', so a hand
    // is not body) and the arms, all three from one search per point (bodyfield.js)
    const { all, body, arms } = bodyFields(P, N, I, arm);
    const ctx = { all, body, arms, torso: torsoField(P, I, arm, a.J), hips: hipsOf(P, I, arm, a.J), J: a.J, L: a.L };
    const pieces = (OUTFITS[a.key] || OUTFITS.none).make(ctx);
    if (a.key !== 'none' && a.hood === 'down') pieces.push(cowl(ctx, a.key === 'robe' ? 'main' : 'second')); else if (a.key !== 'none' && a.hood === 'up') pieces.push(hood(ctx, a.key === 'robe' ? 'main' : 'second'));
    // shared between the workers part by part (a piece in several parts may be split), each part's cost guessed from
    // its box and cell size, the largest first to whichever worker has least so far: every worker gets the same deal
    const res = (p) => (p.res || 0.008) * (a.coarse || 1);
    const items = pieces.flatMap((p) => (p.parts || [{ field: p.field, bounds: p.bounds }]).map((q) => ({ p, q, cost: ((q.bounds[1][0] - q.bounds[0][0]) * (q.bounds[1][1] - q.bounds[0][1]) * (q.bounds[1][2] - q.bounds[0][2])) / res(p) ** 3 })));
    const load = new Array(a.of || 1).fill(0), bin = new Map();
    for (const it of [...items].sort((x, y) => y.cost - x.cost)) { let k = 0; for (let j = 1; j < load.length; j++) if (load[j] < load[k]) k = j; load[k] += it.cost; bin.set(it, k); }
    const mine = items.filter((it) => (bin.get(it) || 0) === (a.of ? a.part : 0));
    const tSetup = performance.now() - t0;
    return { count: items.length, setup: Math.round(tSetup), pieces: mine.map(({ p, q }) => {
      const m = mesh(q.field, q.bounds, res(p), { aoStep: 0.006, uvScale: 0.03 });
      return { name: p.name, material: p.material, role: p.role, mesh: m.index.length ? m : null };
    }).filter((p) => p.mesh), ms: Math.round(performance.now() - t0), began, ended: Date.now() };
  }
  if (job === 'mikkian') return mikkianTendrils(a);   // a Mikkian's head-tendrils (tentacles.js)
  throw new Error('unknown job ' + job);
}
export function transferables(out) { const list = []; if (out.t) for (const k of ['position', 'normal', 'index', 't', 'd']) list.push(out[k].buffer); for (const p of out.pieces || []) for (const k of ['position', 'normal', 'ao', 'uv', 'index']) if (p.mesh[k]) list.push(p.mesh[k].buffer); return list; }
function join(ms) {
  if (ms.length === 1) return ms[0];
  let nv = 0, ni = 0; for (const m of ms) { nv += m.ao.length; ni += m.index.length; }
  const out = { position: new Float32Array(nv * 3), normal: new Float32Array(nv * 3), ao: new Float32Array(nv), uv: new Float32Array(nv * 2), index: nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni) };
  let v = 0, i = 0;
  for (const m of ms) { out.position.set(m.position, v * 3); out.normal.set(m.normal, v * 3); out.ao.set(m.ao, v); out.uv.set(m.uv, v * 2); for (let k = 0; k < m.index.length; k++) out.index[i + k] = m.index[k] + v; v += m.ao.length; i += m.index.length; }
  return out;
}
