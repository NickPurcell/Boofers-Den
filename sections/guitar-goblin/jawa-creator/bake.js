// Jawa creator: the figure baked for a game table (HoloTable's 3D map), on the same skeleton as every other figure
// there (the human base's 38 bones, by name), so it runs, shoots and falls with the same clips
// (../human-base/motion.js, clips.js). The Jawa's own body is not the human base: its bones are placed inside it here
// (a metre-tall figure, short legs under the robe, the arms where the resting stance puts them), and each part of it
// hangs on them: the hood and the dark face on the head, the sleeves on the arms, the robe's skirt from the hips (as a
// skirt does: the legs move under it), the hands, feet and what is held on their bones, straps and gear on the body
// under them. Colours go into the vertices, worked out from the cloth's own settings (cloth.js) the way its shader does,
// without the weave and the noise, which a figure this small on a map cannot show. Our own code.
//
//   const figure = bakeJawa(group, { build, hold })   // after the page has built the figure in its resting stance
//   -> { v: 3, meshes: [{ name, position, normal, color, index, rough, metal, emissive?, skinIndex, skinWeight,
//        where? }], skeleton: [{ name, parent, head }], muzzle?: { bone, offset, dir } }   (as characters/ posts)
import * as THREE from 'three';
import { BUILDS, pose, robeField } from './figure.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const toByte = (v) => { v = clamp01(v); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ---------------- the skeleton, placed in a Jawa ---------------- */
// the human base's bones, in its order, with their parents (human-base/data/mesh.json's skeleton)
const CORE = ['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03', 'head'];
const SIDE = ['pelvis', 'upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot', 'toe3-1', 'clavicle', 'shoulder01', 'upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist'];
const SIDE_PARENT = { pelvis: 'root', upperleg01: 'pelvis', upperleg02: 'upperleg01', lowerleg01: 'upperleg02', lowerleg02: 'lowerleg01', foot: 'lowerleg02', 'toe3-1': 'foot', clavicle: 'spine01', shoulder01: 'clavicle', upperarm01: 'shoulder01', upperarm02: 'upperarm01', lowerarm01: 'upperarm02', lowerarm02: 'lowerarm01', wrist: 'lowerarm02' };
export const BONES = [...CORE, ...['L', 'R'].flatMap((s) => SIDE.map((b) => `${b}.${s}`))];
export function jawaSkeleton(B, arms) {
  const { w, t } = B, at = {};
  const core = [[0, 0.40 * t, -0.01], [0, 0.44 * t, -0.012], [0, 0.49 * t, -0.012], [0, 0.54 * t, -0.01], [0, 0.58 * t, -0.008], [0, 0.62 * t, -0.006], [0, 0.665 * t, -0.006], [0, 0.69 * t, -0.004], [0, 0.715 * t, -0.002], [0, 0.74 * t, 0]];
  CORE.forEach((n, k) => (at[n] = core[k]));
  for (const [S, s] of [['L', 1], ['R', -1]]) {
    const a = arms[S], hip = [s * 0.06 * w, 0.37 * t, 0], knee = [s * 0.06 * w, 0.21 * t, 0.035], ankle = [s * 0.058 * w, 0.055, 0.06 * w];
    Object.assign(at, {
      [`pelvis.${S}`]: [s * 0.03 * w, 0.40 * t, -0.005], [`upperleg01.${S}`]: hip, [`upperleg02.${S}`]: lerp3(hip, knee, 0.5), [`lowerleg01.${S}`]: knee, [`lowerleg02.${S}`]: lerp3(knee, ankle, 0.5),
      [`foot.${S}`]: ankle, [`toe3-1.${S}`]: [s * 0.058 * w, 0.018, 0.15 * w],
      [`clavicle.${S}`]: [s * 0.025 * w, 0.63 * t, -0.004], [`shoulder01.${S}`]: [s * 0.055 * w, 0.645 * t, -0.006], [`upperarm01.${S}`]: a.S, [`upperarm02.${S}`]: lerp3(a.S, a.E, 0.5),
      [`lowerarm01.${S}`]: a.E, [`lowerarm02.${S}`]: lerp3(a.E, a.W, 0.5), [`wrist.${S}`]: a.W,
    });
  }
  const index = Object.fromEntries(BONES.map((n, k) => [n, k]));
  return BONES.map((name) => { const base = name.split('.')[0], side = name.split('.')[1]; const parent = name === 'root' ? -1 : CORE.includes(name) ? index[CORE[CORE.indexOf(name) - 1]] : index[`${SIDE_PARENT[base]}${SIDE_PARENT[base] === 'root' || SIDE_PARENT[base] === 'spine01' ? '' : '.' + side}`]; return { name, parent, head: at[name] }; });
}

/* ---------------- what each point hangs on ---------------- */
// distance from p to the segment a-b
function weigher(sk, B, arms) {
  const ix = Object.fromEntries(sk.map((b, k) => [b.name, k])), H = (n) => sk[ix[n]].head, t = B.t, hipY = 0.4 * t;
  const one = (k) => [[k, 0, 0, 0], [255, 0, 0, 0]];
  const blend = (list) => {   // [[bone, weight]...] -> top four, bytes summing to 255
    const m = new Map(); for (const [b, w] of list) if (w > 0) m.set(b, (m.get(b) || 0) + w);
    const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 4), s = top.reduce((a, x) => a + x[1], 0) || 1;
    const idx = [0, 0, 0, 0], wt = [0, 0, 0, 0]; top.forEach(([b, w], i) => { idx[i] = b; wt[i] = Math.floor((255 * w) / s); }); wt[0] += 255 - wt.reduce((a, x) => a + x, 0);
    return [idx, wt];
  };
  // the trunk by height: between the two spine joints round a point, the hips below
  const spine = CORE.slice(0, 7).map((n) => [ix[n], H(n)[1]]);
  const trunk = (y) => {
    if (y <= spine[0][1]) return [[spine[0][0], 1]];
    for (let i = 0; i < spine.length - 1; i++) if (y <= spine[i + 1][1]) { const f = sstep(0, 1, (y - spine[i][1]) / (spine[i + 1][1] - spine[i][1])); return [[spine[i][0], 1 - f], [spine[i + 1][0], f]]; }
    return [[spine[spine.length - 1][0], 1]];
  };
  // an arm by where a point lies along it: the shoulder easing into the upper arm, the elbow into the forearm
  const arm = (p, S) => {
    const Sh = H(`upperarm01.${S}`), E = H(`lowerarm01.${S}`), Wr = H(`wrist.${S}`), along = (a, b) => { const ab = sub(b, a), ap = sub(p, a); return (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2); };
    const tu = along(Sh, E), tf = along(E, Wr), eb = sstep(-0.15, 0.15, tf);   // past the elbow, the forearm
    const sh = 1 - sstep(-0.05, 0.5, tu);   // up at the shoulder, the shoulder and the chest (eased over half the upper arm, so a raised arm does not pull the cloth at the joint)
    return [[ix[`upperarm01.${S}`], (1 - eb) * (1 - sh)], [ix[`lowerarm01.${S}`], eb], [ix[`shoulder01.${S}`], (1 - eb) * sh * 0.6], [ix.spine01, (1 - eb) * sh * 0.4]];
  };
  // the robe: a point on a sleeve's cloth follows that arm, on the body the trunk, below the hips the hips (a skirt);
  // which, by which of the robe's own shapes (figure.js) the point lies on
  const RF = robeField(B, arms);
  const body = (p) => {
    if (p[1] < hipY - 0.02 * t) return one(ix.root);
    const db = RF.body(p[0], p[1], p[2]), dl = RF.sleeves.L(p[0], p[1], p[2]), dr = RF.sleeves.R(p[0], p[1], p[2]), S = dl < dr ? 'L' : 'R', ds = Math.min(dl, dr);
    const k = sstep(-0.008, 0.008, db - ds);   // 1 on the sleeve
    const low = sstep(hipY - 0.02 * t, hipY + 0.05 * t, p[1]);
    return blend([...trunk(p[1]).map(([b, w]) => [b, w * (1 - k) * low]), [ix.root, (1 - k) * (1 - low)], ...arm(p, S).map(([b, w]) => [b, w * k])]);
  };
  // the robe meshed without its sleeves (the table's bake has them apart): the body's cloth only
  const robeBody = (p) => { if (p[1] < hipY - 0.02 * t) return one(ix.root); const low = sstep(hipY - 0.02 * t, hipY + 0.05 * t, p[1]); return blend([...trunk(p[1]).map(([b, w]) => [b, w * low]), [ix.root, 1 - low]]); };
  // a sleeve meshed on its own: the arm it is on (easing into the shoulder and chest at its top)
  const sleeve = (p) => arm(p, RF.sleeves.L(p[0], p[1], p[2]) < RF.sleeves.R(p[0], p[1], p[2]) ? 'L' : 'R');
  // straps and gear on the body: the trunk by height (below the hips, the hips)
  const worn = (p) => (p[1] < hipY ? one(ix.root) : blend(trunk(p[1])));
  // the hood on the head, its mantle settling onto the chest
  const hood = (p) => { const k = sstep(0.62 * t, 0.7 * t, p[1]); return blend([[ix.head, k], [ix.spine01, 1 - k]]); };
  const side = (p, n) => one(ix[`${n}.${p[0] >= 0 ? 'L' : 'R'}`]);
  return {
    robe: body, robeBody, sleeves: (p) => blend(sleeve(p)), straps: worn, gear: worn,
    hood, face: () => one(ix.head), eyes: () => one(ix.head),
    // the fringe: the hem's on the hips, the cuffs' on their arms, the hood's with the hood
    // (a cuff's threads hang a hand's breadth at most from their sleeve, by the hip: all of each thread on the arm, or
    // a raised arm would draw them out into strands down to the belt)
    fringe: (p) => { const dl = RF.sleeves.L(p[0], p[1], p[2]), dr = RF.sleeves.R(p[0], p[1], p[2]); if (Math.min(dl, dr) < 0.06) return blend(arm(p, dl < dr ? 'L' : 'R')); return p[1] < hipY ? one(ix.root) : hood(p); },
    hands: (p) => side(p, 'wrist'), feet: (p) => side(p, 'foot'),
    held: () => one(ix['wrist.R']), bone: (n) => one(ix[n]), index: ix,
  };
}

/* ---------------- colour ---------------- */
// the cloth's colour at a point, from its material's settings (cloth.js's shader, without its textures)
function clothColour(u, p, n, ao, mask, out) {
  const c = u.uCloth.value, sy = p[1] / (u.uTall.value || 1), up = Math.max(0, n[1]);
  let r = c.r, g = c.g, b = c.b;
  // a patch sewn over the worn place
  for (let i = 0; i < u.uPatches.value; i++) {
    const C = u.uPatchC.value[i], U = u.uPatchU.value[i], V = u.uPatchV.value[i], q = [p[0] - C.x, p[1] - C.y, p[2] - C.z];
    if (Math.abs(q[0] * U.x + q[1] * U.y + q[2] * U.z) < U.w && Math.abs(q[0] * V.x + q[1] * V.y + q[2] * V.z) < V.w && Math.hypot(...q) < 0.08) { const pc = u.uPatchCol.value[i]; r = pc.r; g = pc.g; b = pc.b; }
  }
  const band = (sstep(0.07, 0.074, sy) - sstep(0.098, 0.102, sy)) + (sstep(0.118, 0.121, sy) - sstep(0.131, 0.134, sy)) + (sstep(0.15, 0.152, sy) - sstep(0.157, 0.159, sy));
  const st = u.uStripes.value * clamp01(band) * (1 - mask), S = u.uStripe.value; r += (S.r - r) * st; g += (S.g - g) * st; b += (S.b - b) * st;
  const dp = u.uDipAmt.value * (1 - sstep(0.24, 0.275, sy)), D = u.uDip.value; r += (D.r - r) * dp; g += (D.g - g) * dp; b += (D.b - b) * dp;
  const fade = clamp01(u.uWear.value * (0.22 + 0.5 * up + 0.2) * 0.78) * 0.6, lum = 0.3 * r + 0.59 * g + 0.11 * b;
  r += ((r + lum) * 0.5 * 1.22 + 0.02 - r) * fade; g += ((g + lum) * 0.5 * 1.22 + 0.02 - g) * fade; b += ((b + lum) * 0.5 * 1.22 + 0.02 - b) * fade;
  const low = 1 - sstep(0.02, 0.36, sy), dust = clamp01(u.uDust.value * (low * 0.5 + 0.4 * (1 - sstep(0, 0.08, sy)) + 0.5 * up * 0.9)) * 0.8, Sd = u.uSand.value;
  r += (Sd.r * 0.92 - r) * dust; g += (Sd.g * 0.92 - g) * dust; b += (Sd.b * 0.92 - b) * dust;
  const L = u.uLining.value; r += (L.r - r) * mask; g += (L.g - g) * mask; b += (L.b - b) * mask;
  const k = (0.42 + 0.58 * Math.pow(ao, 1.25)) * 0.9; out[0] = r * k; out[1] = g * k; out[2] = b * k;
}
const ROLE_COL = [null, null, [[0.8, 0.81, 0.83], 0.3, 1], [[0.035, 0.038, 0.045], 0.55, 0.7], [[0.78, 0.52, 0.22], 0.36, 1], [[0.02, 0.02, 0.02], 0.88, 0], [[0.36, 0.38, 0.41], 0.42, 1]];

/* ---------------- the bake ---------------- */
// parts: { name: Object3D } as the page holds them; o: { build, eye: '#hex', glow, grid }
export function bakeJawa(parts, o) {
  const B = BUILDS[o.build] || BUILDS.average, arms = pose('rest', B, o.held), sk = jawaSkeleton(B, arms), W = weigher(sk, B, arms);
  const grid = o.grid ?? 0.018, buckets = new Map(), v = new THREE.Vector3(), nv = new THREE.Vector3(), nm = new THREE.Matrix3(), col = [0, 0, 0];
  const bucket = (name, rough, metal, where) => { const key = `${name} ${rough} ${metal}`; let b = buckets.get(key); if (!b) buckets.set(key, (b = { name, rough, metal, where, P: [], N: [], C: [], E: null, I: [], SI: [], SW: [] })); return b; };
  const eye = new THREE.Color(o.eye || '#ffae2b'), glow = o.glow ?? 1;
  for (const [part, root] of Object.entries(parts)) {
    if (!root) continue;
    root.updateMatrixWorld(true);
    root.traverse((m) => {
      if (!m.isMesh || !m.visible || !m.geometry || !m.geometry.attributes.position) return;
      const g = m.geometry, P = g.attributes.position, Nn = g.attributes.normal || (g.computeVertexNormals(), g.attributes.normal), A = g.attributes.aAo, K = g.attributes.aMask, VC = g.attributes.color;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material, u = mat && mat.userData && mat.userData.u, I = g.index ? g.index.array : Uint32Array.from({ length: P.count }, (_, i) => i);
      m.updateWorldMatrix(true, false); nm.getNormalMatrix(m.matrixWorld);
      // this mesh's finish and how a vertex is coloured
      let finish = ['cloth', 0.95, 0], colour;
      if (part === 'face') { finish = ['cloth', 1, 0]; colour = () => [0.004, 0.003, 0.003]; }
      else if (part === 'eyes') { finish = ['eyes', 0.3, 0]; colour = () => [eye.r, eye.g, eye.b]; }
      else if (u && u.uCloth) colour = (i, p, n) => { clothColour(u, p, n, A ? A.getX(i) : 1, K ? K.getX(i) : 0, col); return col; };
      else if (u && u.uPrimary && g.attributes.aData) {   // the droid kit's paint (gear): by role
        const D = g.attributes.aData.array, role = (i) => { const rf = Math.floor(D[i * 4] + 0.5); return rf - 8 * Math.floor(rf / 8); };
        colour = (i) => { const r = role(i), c = r < 2 ? (r ? u.uSecondary.value : u.uPrimary.value) : null; if (c) return [c.r, c.g, c.b]; const f = ROLE_COL[r] || ROLE_COL[6]; return f[0]; };
        finish = ['gear', 0.5, 0.25];
      } else { const c = mat && mat.color ? mat.color : new THREE.Color(1, 1, 1); colour = (i) => (VC ? [VC.getX(i) * c.r, VC.getY(i) * c.g, VC.getZ(i) * c.b] : [c.r, c.g, c.b]); finish = [part === 'gear' ? 'gear' : 'cloth', mat && mat.roughness != null ? Math.round(mat.roughness * 10) / 10 : 0.8, mat && mat.metalness ? Math.round(mat.metalness * 4) / 4 : 0]; }
      const emissive = part === 'eyes' ? [eye.r * glow, eye.g * glow, eye.b * glow] : mat && mat.emissive && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0 ? [mat.emissive.r, mat.emissive.g, mat.emissive.b] : null;
      // each vertex in the figure's frame, coloured, weighted; then merged in cells `grid` across (small parts finer)
      const n = P.count, tp = new Float32Array(n * 3), tc = new Float32Array(n * 3), tn = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); nv.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize();
        tp.set([v.x, v.y, v.z], i * 3); tn.set([nv.x, nv.y, nv.z], i * 3); tc.set(colour(i, [v.x, v.y, v.z], [nv.x, nv.y, nv.z]), i * 3);
      }
      const g0 = part === 'eyes' || part === 'face' ? 0 : part === 'hands' || part === 'feet' || part === 'gear' ? Math.min(grid, 0.006) : grid;
      // what rides a bone of its own: the page marks the held thing's vertices (and a shield's) by bone; a cell merges only
      // vertices of the same mark, so nothing held is ever joined to what is worn. Unmarked gear is worn on the body.
      const on = Array.isArray(m.userData.on) ? m.userData.on.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && Object.prototype.hasOwnProperty.call(W.index, x[0])) : [];
      const vtag = new Array(n).fill(null); if (on.length) for (let i = 0; i < n; i++) { const r = on.find((x) => i >= x[1] && i < x[2]); if (r) vtag[i] = r[0]; }
      const id = new Int32Array(n), cells = new Map(); let groups = 0;
      for (let i = 0; i < n; i++) { if (!g0) { id[i] = i; continue; } const key = `${Math.floor(tp[i * 3] / g0)},${Math.floor(tp[i * 3 + 1] / g0)},${Math.floor(tp[i * 3 + 2] / g0)},${vtag[i] || ''}`; let c = cells.get(key); if (c === undefined) cells.set(key, (c = groups++)); id[i] = c; }
      if (!g0) groups = n;
      const gp = new Float64Array(groups * 3), gc = new Float64Array(groups * 3), gn = new Float64Array(groups * 3), gk = new Uint32Array(groups);
      for (let i = 0; i < n; i++) { const k = id[i]; gk[k]++; for (let j = 0; j < 3; j++) { gp[k * 3 + j] += tp[i * 3 + j]; gc[k * 3 + j] += tc[i * 3 + j]; if (!g0) gn[k * 3 + j] += tn[i * 3 + j]; } }
      for (let k = 0; k < groups; k++) for (let j = 0; j < 3; j++) { gp[k * 3 + j] /= gk[k]; gc[k * 3 + j] /= gk[k]; }
      const tag = new Array(groups).fill(null); for (let i = 0; i < n; i++) if (vtag[i]) tag[id[i]] = vtag[i];
      const b = bucket(finish[0], finish[1], finish[2], null); if (emissive && !b.E) b.E = new Array(b.C.length).fill(0);
      const map = new Map(), tris = new Set(), added = [], wk = new Map();
      const weightOf = (k) => { let w = wk.get(k); if (!w) { const p = [gp[k * 3], gp[k * 3 + 1], gp[k * 3 + 2]]; w = tag[k] ? W.bone(tag[k]) : (part === 'robe' && o.split ? W.robeBody : W[part] || W.robe)(p); wk.set(k, w); } return w; };
      for (let t = 0; t + 2 < I.length; t += 3) {
        const g3 = [id[I[t]], id[I[t + 1]], id[I[t + 2]]]; if (g3[0] === g3[1] || g3[1] === g3[2] || g3[0] === g3[2]) continue;
        if (g0) { const s3 = [...g3].sort((a, c) => a - c).join(); if (tris.has(s3)) continue; tris.add(s3);
          const [a, c, d] = g3, ux = gp[c * 3] - gp[a * 3], uy = gp[c * 3 + 1] - gp[a * 3 + 1], uz = gp[c * 3 + 2] - gp[a * 3 + 2], vx = gp[d * 3] - gp[a * 3], vy = gp[d * 3 + 1] - gp[a * 3 + 1], vz = gp[d * 3 + 2] - gp[a * 3 + 2];
          const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx; for (const k of g3) { gn[k * 3] += fx; gn[k * 3 + 1] += fy; gn[k * 3 + 2] += fz; } }
        b.I.push(...g3.map((k) => { let q = map.get(k); if (q === undefined) {
          q = b.P.length / 3; map.set(k, q); const p = [gp[k * 3], gp[k * 3 + 1], gp[k * 3 + 2]];
          b.P.push(...p); b.N.push(0, 0, 0); b.C.push(gc[k * 3], gc[k * 3 + 1], gc[k * 3 + 2]); if (b.E) b.E.push(...(emissive || [0, 0, 0]));
          const [si, sw] = weightOf(k); b.SI.push(...si); b.SW.push(...sw); added.push([q, k]);
        } return q; }));
      }
      for (const [q, k] of added) { const l = Math.hypot(gn[k * 3], gn[k * 3 + 1], gn[k * 3 + 2]) || 1; b.N[q * 3] = gn[k * 3] / l; b.N[q * 3 + 1] = gn[k * 3 + 1] / l; b.N[q * 3 + 2] = gn[k * 3 + 2] / l; }
    });
  }
  const meshes = [];
  for (const b of buckets.values()) {
    if (!b.I.length) continue;
    const e = { name: b.name, position: Float32Array.from(b.P), normal: Float32Array.from(b.N), color: Uint8Array.from(b.C, toByte), index: Uint32Array.from(b.I), rough: b.rough, metal: b.metal, skinIndex: Uint8Array.from(b.SI), skinWeight: Uint8Array.from(b.SW) };
    if (b.E) e.emissive = Uint8Array.from(b.E, toByte);
    meshes.push(e);
  }
  const out = { v: 3, meshes, skeleton: sk };
  if (o.muzzle) { const w = sk[W.index['wrist.R']].head; out.muzzle = { bone: 'wrist.R', offset: sub(o.muzzle.point, w), dir: o.muzzle.dir }; }
  return out;
}
