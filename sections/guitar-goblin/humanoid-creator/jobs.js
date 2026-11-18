// What the worker pool does for the humanoid page: turn one part of the figure into triangle arrays.
import { mesh, gradient } from '../duros-creator/sdf.js';
import { skinField, handField, HEAD_AT } from './anatomy.js';
import { headField } from './head-field.js';
import { hairField } from './hair.js';
import { extraFor } from './features.js';
import { outfitPieces } from './outfits.js';
import { tendrils } from './mikkian.js';

export const RES = { head: 0.0027, bust: 0.008, hand: 0.0036, hair: 0.0034, cloth: 0.007, gear: 0.003 };
const CUT = -0.128;   // where the head mesh stops and the bust mesh takes over, below the eyes

// Skin wants smoother shading than the mesher's grid gives: take each normal from the shape itself, and judge how
// shut-in each point is by walking out along it (1 in the open, less in a crease). The same rule for every skin
// mesh, so two that overlap shade alike.
function refine(m, f) {
  const P = m.position, N = m.normal, n = m.ao.length, S = [0.003, 0.007, 0.013, 0.02];
  for (let i = 0; i < n; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], g = gradient(f, x, y, z, 0.0018);   // about three quarters of a cell: finer than that and thin creases speckle
    N[i * 3] = g[0]; N[i * 3 + 1] = g[1]; N[i * 3 + 2] = g[2];
    let a = 0; for (const s of S) a += Math.max(0, Math.min(1, f(x + g[0] * s, y + g[1] * s, z + g[2] * s) / s));
    m.ao[i] = a / S.length;
  }
  return m;
}

export function run(job, a) {
  const Q = a.coarse || 1;   // a phone asks for coarser meshes
  if (job === 'head') {   // the head and upper neck, finely; also what the page needs to place eyes, lids and paint
    const s = skinField(a), h = s.head, [hx, hy, hz] = HEAD_AT;
    const bounds = [[h.bounds[0][0], hy + CUT, h.bounds[0][2]], [h.bounds[1][0], hy + h.bounds[1][1], h.bounds[1][2]]];
    let m = refine(mesh(s.field, bounds, RES.head * Q, { aoStep: 0.006, uvScale: 0.035 }), s.field);
    // what hangs below the head's own box (a Pureblood's longer tendrils), meshed on its own and joined on
    const X = extraFor(a), low = X && X.below ? X.below(h.P) : null;
    if (low) {
      const lf = (x, y, z) => Math.max(low.field(x - hx, y - hy, z - hz), y - (hy + CUT));
      const lm = mesh(lf, [[low.bounds[0][0], hy + low.bounds[0][1], low.bounds[0][2]], [low.bounds[1][0], hy + CUT + 0.003, low.bounds[1][2]]], RES.head * Q, { aoStep: 0.006, uvScale: 0.035 });
      if (lm.index.length) m = join([m, refine(lm, lf)]);
    }
    return { mesh: m, eye: h.eye, lid: h.lid, P: h.P, at: HEAD_AT, tendrils: X && X.tendrils ? X.tendrils(h.P) : [] };
  }
  if (job === 'bust') {   // the lower neck, shoulders and upper chest, for open collars
    const s = skinField(a), sx = s.body.S.sx;
    return { mesh: refine(mesh(s.field, [[-(sx + 0.075), 1.16, -0.17], [sx + 0.075, HEAD_AT[1] + CUT + 0.008, 0.17]], RES.bust * Q, { aoStep: 0.006, uvScale: 0.035 }), s.field), seamY: HEAD_AT[1] + CUT };
  }
  if (job === 'hand') {
    const h = handField(a.side, a);
    return { mesh: mesh(h.field, h.bounds, RES.hand * Q, { aoStep: 0.003, uvScale: 0.03 }) };
  }
  if (job === 'hair' && a.species === 'mikkian') {   // a Mikkian's head-tendrils, with how far along its tendril each vertex is
    const T = tendrils(a.style, a.thick, headField(a).field), m = mesh(T.field, T.bounds, RES.hair * Q, { aoStep: 0.006, uvScale: 0.03 });
    return { mesh: m, t: T.param(m.position) };
  }
  if (job === 'hair') {   // in the head's own frame; the page sets it on the head
    const h = headField({ ...a, extra: extraFor(a) }), hair = hairField(a.style, h.field);
    if (!hair) return { mesh: null };
    return { mesh: mesh(hair.field, hair.bounds, RES.hair * Q, { aoStep: 0.006, uvScale: 0.03 }) };
  }
  if (job === 'outfit') {
    // a piece is one field and box, or several (`parts`), meshed apart and joined into one draw call; when the
    // outfit is shared between workers, this one takes every `of`-th piece starting at `part`
    const all = outfitPieces(a.key, a), mine = a.of ? all.filter((p, i) => i % a.of === a.part) : all;
    return { count: all.length, pieces: mine.map((p) => {
      const list = p.parts || [{ field: p.field, bounds: p.bounds, res: p.res }];
      const meshes = list.map((q) => mesh(q.field, q.bounds, (q.res || p.res || RES.cloth) * Q, { aoStep: p.aoStep || 0.006, uvScale: p.uvScale || 0.03 })).filter((m) => m.index.length);
      return { name: p.name, index: p.index, material: p.material, role: p.role, mesh: meshes.length ? join(meshes) : null };
    }).filter((p) => p.mesh) };
  }
  throw new Error('unknown job ' + job);
}

// the arrays a result holds, so a worker can hand them over without copying
export function transferables(out) {
  const list = [], take = (m) => { if (m) for (const k of ['position', 'normal', 'ao', 'uv', 'index']) if (m[k]) list.push(m[k].buffer); };
  take(out.mesh);
  if (out.t) list.push(out.t.buffer);
  for (const p of out.pieces || []) take(p.mesh);
  return list;
}

// several meshes as one
function join(ms) {
  if (ms.length === 1) return ms[0];
  let nv = 0, ni = 0;
  for (const m of ms) { nv += m.ao.length; ni += m.index.length; }
  const out = { position: new Float32Array(nv * 3), normal: new Float32Array(nv * 3), ao: new Float32Array(nv), uv: new Float32Array(nv * 2), index: nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni) };
  let v = 0, i = 0;
  for (const m of ms) {
    out.position.set(m.position, v * 3); out.normal.set(m.normal, v * 3); out.ao.set(m.ao, v); out.uv.set(m.uv, v * 2);
    for (let k = 0; k < m.index.length; k++) out.index[i + k] = m.index[k] + v;
    v += m.ao.length; i += m.index.length;
  }
  return out;
}
