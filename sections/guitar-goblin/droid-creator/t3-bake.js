// The T3-type utility droid baked for a game table (HoloTable's 3D map): the unit the droid creator builds (t3.js),
// standing level, as plain arrays on a skeleton of its own, so t3-motion.js can walk it. Each piece rides one bone (the
// rear pods, the body, each leg and foot, the head), the pods' hubs their own (they turn as the pods roll). Colours go
// into the vertices, worked out from the paint's own settings the way its shader does (paint.js), without its noise
// texture, which a figure this small on a map cannot show. Our own code.
//
//   const figure = bakeT3(pieces, droidGroup, { blaster })   // after the page has built and placed the unit, standing level
//   -> { v: 3, kind: 'droid', meshes: [{ name, position, normal, color, index, rough, metal, emissive?, skinIndex,
//        skinWeight }], skeleton: [{ name, parent, head }], muzzle?: { bone, offset, dir } }
import * as THREE from 'three';
import { T3, poseT3, T3_MUZZLE } from './t3.js';
import { T3_BONES } from './t3-motion.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x), sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const toByte = (v) => { v = clamp01(v); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)); };
const hash = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

/* ---------------- the skeleton, where the page stands the unit ---------------- */
const PIECE = { rear: 'rear', body: 'body', head: 'head', legL: 'leg.L', legR: 'leg.R', footL: 'foot.L', footR: 'foot.R' };
const PARENT = { root: null, rear: 'root', 'hub.L': 'rear', 'hub.R': 'rear', body: 'root', 'leg.L': 'body', 'leg.R': 'body', 'foot.L': 'leg.L', 'foot.R': 'leg.R', head: 'body' };
export function t3Skeleton() {
  // where poseT3 puts each piece standing level, looking ahead (it only sets positions and turns)
  const at = {}, stub = (n) => ({ position: { set: (x, y, z) => (at[n] = [x, y, z]) }, rotation: { set() {} } });
  poseT3(Object.fromEntries(Object.keys(PIECE).map((n) => [n, stub(n)])), 0, 0);
  const W = T3.W, xHub = T3.xPod + 0.275 * W, z0 = at.rear[2];
  const head = {
    root: [0, 0, z0], rear: at.rear, 'hub.L': [xHub, at.rear[1], z0], 'hub.R': [-xHub, at.rear[1], z0], body: at.body,
    'leg.L': [T3.xLeg, at.legL[1], at.legL[2]], 'leg.R': [-T3.xLeg, at.legR[1], at.legR[2]],
    'foot.L': [T3.xLeg, at.footL[1], at.footL[2]], 'foot.R': [-T3.xLeg, at.footR[1], at.footR[2]], head: at.head,
  };
  return T3_BONES.map((name) => ({ name, parent: PARENT[name] ? T3_BONES.indexOf(PARENT[name]) : -1, head: head[name].map((v) => +v.toFixed(5)) }));
}

/* ---------------- colour: paint.js's shader, per vertex ---------------- */
// role (hard.js ROLE): 0 primary, 1 secondary, 2 bright metal, 3 dark, 4 brass, 5 rubber, 6 steel. Each comes out with its
// finish: painted parts take the unit's (metallic or not), metals theirs.
const FIXED = { 2: [[0.80, 0.81, 0.83], 1, 0.3], 3: [[0.035, 0.038, 0.045], 0.7, 0.55], 4: [[0.78, 0.52, 0.22], 1, 0.36], 5: [[0.02, 0.02, 0.02], 0, 0.88], 6: [[0.36, 0.38, 0.41], 1, 0.42] };
function paintColour(u, D, i, p, out) {
  const rf = Math.floor(D[i * 4] + 0.5), flag = Math.floor(rf / 8), role = rf - flag * 8, edge = D[i * 4 + 1], seed = D[i * 4 + 2], corner = D[i * 4 + 3] >= 0.5 ? 1 : 0;
  const wear = u.uWear.value, fin = u.uFinish.value, n1 = hash(p[0] * 31 + seed, p[1] * 31, p[2] * 31), n2 = hash(p[0] * 97, p[1] * 97 + seed, p[2] * 97);
  let r, g, b;
  if (role < 2) {
    const c = flag % 2 === 1 && wear > 0.85 ? u.uOdd.value : role === 0 ? u.uPrimary.value : u.uSecondary.value;
    [r, g, b] = [c.r, c.g, c.b];
    const fade = wear * (0.25 + 0.5 * n1 + 0.25 * seed), lum = 0.3 * r + 0.59 * g + 0.11 * b, k = fade * 0.7;
    [r, g, b] = [mix(r, mix(r, lum, 0.45) * 1.08 + 0.015, k), mix(g, mix(g, lum, 0.45) * 1.08 + 0.015, k), mix(b, mix(b, lum, 0.45) * 1.08 + 0.015, k)];
    // chips, thickest along the edges
    const e = 1 - sstep(0, 0.007, edge), n = n1 * 0.62 + n2 * 0.3 + (n2 - 0.5) * 0.25, th = mix(1.25, 0.56, wear) - e * mix(0.06, 0.44, wear) * (1 + 0.25 * corner), chip = sstep(th, th + 0.025, n);
    const bare = [mix(0.62, 0.11, fin), mix(0.63, 0.1, fin), mix(0.65, 0.095, fin)];
    [r, g, b] = [mix(r, bare[0], chip), mix(g, bare[1], chip), mix(b, bare[2], chip)];
  } else [r, g, b] = (FIXED[role] || FIXED[6])[0];
  // grime in the seams, dust thrown up from the ground, a little shade in every seam
  const dirt = u.uDirt.value, cav = (1 - sstep(0.0004, 0.004, edge)) * (1 - corner);
  const grime = clamp01(wear * 0.8 * cav + wear * wear * 0.3 * sstep(0.42, 0.75, n1)), dust = clamp01(wear * 1.15 * (1 - sstep(0.03, 0.5, p[1])) * (0.3 + 0.9 * n2));
  const gk = mix(0.4, 0.2, cav);
  [r, g, b] = [mix(r, dirt.r * gk, grime), mix(g, dirt.g * gk, grime), mix(b, dirt.b * gk, grime)];
  [r, g, b] = [mix(r, dirt.r, dust * 0.85), mix(g, dirt.g, dust * 0.85), mix(b, dirt.b, dust * 0.85)];
  const shade = mix(1, mix(0.6, 1, sstep(0, 0.0022, edge)), 1 - corner);
  out[0] = r * shade; out[1] = g * shade; out[2] = b * shade;
  return role < 2 ? ['paint', 0.5, fin] : ['m' + role, (FIXED[role] || FIXED[6])[2], (FIXED[role] || FIXED[6])[1]];
}

/* ---------------- the bake ---------------- */
// pieces: the page's groups by name (t3: rear, body, head, legL, legR, footL, footR), placed under `root` standing level
export function bakeT3(pieces, root, o = {}) {
  const sk = t3Skeleton(), ix = Object.fromEntries(sk.map((b, k) => [b.name, k])), grid = o.grid ?? 0.006;
  const buckets = new Map(), v = new THREE.Vector3(), nv = new THREE.Vector3(), nm = new THREE.Matrix3(), rel = new THREE.Matrix4(), inv = new THREE.Matrix4(), col = [0, 0, 0];
  const bucket = (name, rough, metal, glow) => { const key = `${name} ${rough} ${metal}`; let b = buckets.get(key); if (!b) buckets.set(key, (b = { name, rough, metal, P: [], N: [], C: [], E: glow ? [] : null, I: [], SI: [], SW: [] })); return b; };
  root.updateMatrixWorld(true); inv.copy(root.matrixWorld).invert();
  for (const [piece, bone] of Object.entries(PIECE)) {
    const grp = pieces[piece]; if (!grp) continue;
    grp.traverse((m) => {
      if (!m.isMesh || !m.visible || !m.geometry || !m.geometry.attributes.position) return;
      const part = m.userData.part || 'main'; if (part === 'clear') return;   // the clear covers: nothing at this size
      const g = m.geometry, P = g.attributes.position, Nn = g.attributes.normal, Dd = g.attributes.aData ? g.attributes.aData.array : null, VC = g.attributes.color, I = g.index ? g.index.array : Uint32Array.from({ length: P.count }, (_, i) => i);
      rel.multiplyMatrices(inv, m.matrixWorld); nm.getNormalMatrix(rel);
      const u = m.material && m.material.userData && m.material.userData.u;
      // what rides another bone: the page marks the hubs' vertices by bone (t3.js buildRear)
      const on = Array.isArray(m.userData.on) ? m.userData.on.filter((x) => Array.isArray(x) && Object.prototype.hasOwnProperty.call(ix, x[0])) : [];
      const n = P.count, tp = new Float32Array(n * 3), tc = new Float32Array(n * 3), fk = new Array(n), boneOf = new Int32Array(n).fill(ix[bone]);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(rel); tp.set([v.x, v.y, v.z], i * 3);
        let finish;
        if (part === 'main' && u && Dd) finish = paintColour(u, Dd, i, [v.x, v.y, v.z], col);
        else if (part === 'glow' && VC) { col[0] = VC.getX(i); col[1] = VC.getY(i); col[2] = VC.getZ(i); finish = ['glow', 1, 0]; }
        else if (part === 'logic') { col[0] = 0.12; col[1] = 0.32; col[2] = 0.36; finish = ['logic', 0.6, 0]; }
        else { const c = m.material && m.material.color ? m.material.color : new THREE.Color(0.03, 0.03, 0.04); col[0] = c.r; col[1] = c.g; col[2] = c.b; finish = ['glass', 0.1, 0]; }
        tc.set(col, i * 3); fk[i] = finish;
        for (const r of on) if (i >= r[1] && i < r[2]) boneOf[i] = ix[r[0]];
      }
      // merged in cells `grid` across (each cell keeps its first vertex's bone and finish); faces that collapse dropped
      const id = new Int32Array(n), cells = new Map(); let groups = 0;
      for (let i = 0; i < n; i++) {
        if (!grid) { id[i] = i; continue; }
        const key = `${Math.floor(tp[i * 3] / grid)},${Math.floor(tp[i * 3 + 1] / grid)},${Math.floor(tp[i * 3 + 2] / grid)},${boneOf[i]},${fk[i][0]}`;
        let c = cells.get(key); if (c === undefined) cells.set(key, (c = groups++)); id[i] = c;
      }
      if (!grid) groups = n;
      const gp = new Float64Array(groups * 3), gc = new Float64Array(groups * 3), gn = new Float64Array(groups * 3), gk = new Uint32Array(groups), gb = new Int32Array(groups), gf = new Array(groups);
      for (let i = 0; i < n; i++) { const k = id[i]; if (!gk[k]) { gb[k] = boneOf[i]; gf[k] = fk[i]; } gk[k]++; for (let j = 0; j < 3; j++) { gp[k * 3 + j] += tp[i * 3 + j]; gc[k * 3 + j] += tc[i * 3 + j]; } }
      for (let k = 0; k < groups; k++) for (let j = 0; j < 3; j++) { gp[k * 3 + j] /= gk[k]; gc[k * 3 + j] /= gk[k]; }
      if (!grid) for (let i = 0; i < n; i++) { nv.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize(); gn[i * 3] = nv.x; gn[i * 3 + 1] = nv.y; gn[i * 3 + 2] = nv.z; }
      const maps = new Map(), tris = new Set(), added = [];
      for (let t = 0; t + 2 < I.length; t += 3) {
        const g3 = [id[I[t]], id[I[t + 1]], id[I[t + 2]]]; if (g3[0] === g3[1] || g3[1] === g3[2] || g3[0] === g3[2]) continue;
        if (grid) {
          const s3 = [...g3].sort((a, c) => a - c).join(); if (tris.has(s3)) continue; tris.add(s3);
          const [a, c, d] = g3, ux = gp[c * 3] - gp[a * 3], uy = gp[c * 3 + 1] - gp[a * 3 + 1], uz = gp[c * 3 + 2] - gp[a * 3 + 2], vx = gp[d * 3] - gp[a * 3], vy = gp[d * 3 + 1] - gp[a * 3 + 1], vz = gp[d * 3 + 2] - gp[a * 3 + 2];
          const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx; for (const k of g3) { gn[k * 3] += fx; gn[k * 3 + 1] += fy; gn[k * 3 + 2] += fz; }
        }
        const f = gf[g3[0]], b = bucket(f[0], f[1], f[2], f[0] === 'glow'); let map = maps.get(b); if (!map) maps.set(b, (map = new Map()));
        b.I.push(...g3.map((k) => {
          let q = map.get(k); if (q !== undefined) return q;
          q = b.P.length / 3; map.set(k, q);
          b.P.push(gp[k * 3], gp[k * 3 + 1], gp[k * 3 + 2]); b.N.push(0, 0, 0); b.C.push(gc[k * 3], gc[k * 3 + 1], gc[k * 3 + 2]);
          if (b.E) b.E.push(gc[k * 3], gc[k * 3 + 1], gc[k * 3 + 2]);
          b.SI.push(gb[k], 0, 0, 0); b.SW.push(255, 0, 0, 0); added.push([b, q, k]);
          return q;
        }));
      }
      for (const [b, q, k] of added) { const l = Math.hypot(gn[k * 3], gn[k * 3 + 1], gn[k * 3 + 2]) || 1; b.N[q * 3] = gn[k * 3] / l; b.N[q * 3 + 1] = gn[k * 3 + 1] / l; b.N[q * 3 + 2] = gn[k * 3 + 2] / l; }
    });
  }
  const meshes = [];
  for (const b of buckets.values()) {
    if (!b.I.length) continue;
    const nV = b.P.length / 3, e = {
      name: b.name, position: Float32Array.from(b.P), normal: Float32Array.from(b.N), color: Uint8Array.from(b.C, toByte),
      index: nV < 65536 ? Uint16Array.from(b.I) : Uint32Array.from(b.I), rough: b.rough, metal: b.metal,
      skinIndex: Uint8Array.from(b.SI), skinWeight: Uint8Array.from(b.SW),
    };
    if (b.E) e.emissive = Uint8Array.from(b.E, toByte);
    meshes.push(e);
  }
  const out = { v: 3, kind: 'droid', meshes, skeleton: sk };
  if (o.blaster) out.muzzle = { bone: 'head', offset: T3_MUZZLE.slice(), dir: [0, 0, 1] };
  return out;
}
