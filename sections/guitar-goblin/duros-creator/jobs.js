// What the mesher worker does: turn one part of the figure into triangle arrays. Also imported directly as a
// fallback when a browser can't start a module worker.
import { mesh, project, cast } from './sdf.js';
import { bodyField, handField, HEAD_AT } from './anatomy.js';
import { headBField } from './head-b-field.js';   // head B (head-sculpt.js), on the same toolkit
import { outfitPieces } from './outfits.js';

export const RES = { headB: 0.0034, body: 0.008, hand: 0.003, cloth: 0.005, gear: 0.0028 };

export function run(job, a) {
  if (job === 'headB') {   // head B: the same meshing and mouth line as A's, from its own field
    const h = headBField(a.shape, a.expr, a.age);
    const m = mesh(h.field, h.bounds, RES.headB, { aoStep: 0.004, uvScale: 0.04 });
    // the mouth line: each point cast straight in from in front of the face, so it lands on the floor of the shallow
    // cut (or the face beside it) and never starts inside it; then pushed in a hair
    const mouth = h.mouthLine.map((p) => { const r = cast(h.field, [p[0], p[1], 0.2], [0, 0, -1], 0.3) || project(h.field, p, 10); return [r.p[0] - r.n[0] * 0.001, r.p[1] - r.n[1] * 0.001, r.p[2] - r.n[2] * 0.001]; });   // seated a millimetre in: the tube is 0.8 mm thick
    return { mesh: m, eye: h.eye, lid: h.lid, earAt: h.earAt, at: HEAD_AT, mouth };
  }
  if (job === 'body') {
    const b = bodyField(a.build);
    return { mesh: mesh(b.field, b.bounds, RES.body, { aoStep: 0.012, uvScale: 0.05 }) };
  }
  if (job === 'hand') {
    const h = handField(a.side, a.build);
    return { mesh: mesh(h.field, h.bounds, RES.hand, { aoStep: 0.003, uvScale: 0.03 }) };
  }
  if (job === 'outfit') {
    // a piece is one field and box, or several (`parts`), meshed apart and joined into one draw call
    // a share of the pieces when the outfit is split between workers (part `a.part` of `a.of`)
    const all = outfitPieces(a.key, a.build), mine = a.of ? all.filter((p, i) => i % a.of === a.part) : all;
    return { count: all.length, pieces: mine.map((p) => {
      const list = p.parts || [{ field: p.field, bounds: p.bounds, res: p.res }];
      const meshes = list.map((q) => mesh(q.field, q.bounds, q.res || p.res || RES.cloth, { aoStep: p.aoStep || 0.006, uvScale: p.uvScale || 0.03 }));
      return { name: p.name, index: p.index, material: p.material, colour: p.colour || null, mesh: join(meshes) };
    }) };
  }
  throw new Error('unknown job ' + job);
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

// the arrays a result holds, so a worker can hand them over without copying
export function transferables(out) {
  const list = [];
  const take = (m) => { if (m) for (const k of ['position', 'normal', 'ao', 'uv', 'index']) if (m[k]) list.push(m[k].buffer); };
  take(out.mesh);
  for (const p of out.pieces || []) take(p.mesh);
  return list;
}
