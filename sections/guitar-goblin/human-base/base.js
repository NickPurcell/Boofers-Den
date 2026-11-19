// Human base: a sculpted human figure for the creator pages, shaped by numbers.
//
// The mesh and its morph targets are MakeHuman's public-domain (CC0) assets, converted to compact files in data/ (see
// data/NOTICE.md). Everything here is our own: the loader, the way the morphs are blended, the one-level Catmull-Clark
// subdivision, the landmarks, and the hooks the skin, the eyes and the species features use.
//
//   import { loadBase } from '../human-base/base.js';
//   const base = await loadBase();
//   const fig = base.figure();                 // a THREE.Group: the body and the eyes
//   fig.set({ gender: 1, weight: 0.9 }).update();
//   fig.addEventListener('shaped', () => ...); // after every update(): re-place anything attached
//   fig.landmark('jawL')                       // { p, n, up, s } in metres, after the morphs
//   fig.region('scalp'), fig.surface           // vertex numbers on the live mesh; the live mesh itself
//
// Frame: metres, y up, the figure faces +z, its left is +x, feet on y = 0, centred on x = 0. The base pose has the
// arms out at about 45 degrees.
import * as THREE from 'three';
import { skinMaterial } from './skin.js';
import { makeEyes } from './eyes.js';

const DATA = new URL('./data/', import.meta.url);
const ARM_DEG = 9, ELBOW_DEG = 10, CURL = 1.15;   // the arms-down pose: the upper arm this far out from the side, the elbow bent this much, the fingers curled this far (radians at the tips)

/* ---------------- what can be set ---------------- */
// Each slider: [key, label, min, max, default, low target, high target]. Macro sliders (no targets) are blended below.
export const SLIDERS = {
  body: [
    ['gender', 'Gender', 0, 1, 0.5], ['age', 'Age', 0, 1, 0], ['muscle', 'Muscle', 0, 1, 0.5], ['weight', 'Weight', 0, 1, 0.5], ['height', 'Height', -1, 1, 0],
    ['shoulders', 'Shoulders', -1, 1, 0, 'vshape-decr', 'vshape-incr'], ['chest', 'Chest depth', -1, 1, 0, 'chestdepth-decr', 'chestdepth-incr'],
    ['pecs', 'Chest muscle', -1, 1, 0, 'pecs-decr', 'pecs-incr'], ['lats', 'Back muscle', -1, 1, 0, 'lats-decr', 'lats-incr'],
    ['belly', 'Belly', -1, 1, 0, 'belly-decr', 'belly-incr'], ['heavyset', 'Heavyset', 0, 1, 0, null, 'heavyset'],
    ['arms', 'Arm bulk', -1, 1, 0, 'armfat-decr', 'armfat-incr'], ['armMuscle', 'Arm muscle', -1, 1, 0, 'armmuscle-decr', 'armmuscle-incr'],
    ['neck', 'Neck width', -1, 1, 0, 'neck-decr', 'neck-incr'], ['neckDepth', 'Neck depth', -1, 1, 0, 'neckdepth-decr', 'neckdepth-incr'],
    ['doubleChin', 'Under the chin', -1, 1, 0, 'doublechin-decr', 'doublechin-incr'],
    ['armsDown', 'Arms down', 0, 1, 1],
  ],
  face: [
    ['browh', 'Brow height', -1, 1, 0, 'brow-down', 'brow-up'], ['browr', 'Brow ridge', -1, 1, 0, 'brow-back', 'brow-forward'], ['browa', 'Brow angle', -1, 1, 0, 'browangle-down', 'browangle-up'],
    ['forehead', 'Forehead', -1, 1, 0, 'forehead-back', 'forehead-forward'], ['eyesize', 'Eye size', -1, 1, 0, 'eyesize-decr', 'eyesize-incr'], ['eyespace', 'Eye spacing', -1, 1, 0, 'eyespace-in', 'eyespace-out'],
    ['eyebags', 'Under the eyes', -1, 1, 0, 'eyebag-decr', 'eyebag-incr'], ['lids', 'Eye opening', -1, 1, 0, 'lids-decr', 'lids-incr'], ['nosew', 'Nose width', -1, 1, 0, 'nosewidth-decr', 'nosewidth-incr'], ['nosel', 'Nose length', -1, 1, 0, 'noselength-decr', 'noselength-incr'],
    ['nosehump', 'Nose bridge', -1, 1, 0, 'nosehump-decr', 'nosehump-incr'], ['nostrils', 'Nostrils', -1, 1, 0, 'noseflare-decr', 'noseflare-incr'], ['mouthw', 'Mouth width', -1, 1, 0, 'mouthwidth-decr', 'mouthwidth-incr'],
    ['lips', 'Lips', -1, 1, 0, 'lips-decr', 'lips-incr'], ['corners', 'Mouth corners', -1, 1, 0, 'mouthcorners-down', 'mouthcorners-up'], ['cheekbones', 'Cheekbones', -1, 1, 0, 'cheekbones-decr', 'cheekbones-incr'],
    ['cheeks', 'Cheeks', -1, 1, 0, 'cheeks-decr', 'cheeks-incr'], ['chinw', 'Chin width', -1, 1, 0, 'chinwidth-decr', 'chinwidth-incr'], ['chinjut', 'Chin forward', -1, 1, 0, 'chinjut-decr', 'chinjut-incr'],
    ['chinh', 'Chin height', -1, 1, 0, 'chinheight-decr', 'chinheight-incr'], ['jaw', 'Jaw', -1, 1, 0, 'jaw-decr', 'jaw-incr'],
    ['earsize', 'Ear size', -1, 1, 0, 'earsize-decr', 'earsize-incr'], ['earflap', 'Ears out', -1, 1, 0, 'earflap-decr', 'earflap-incr'], ['earlobe', 'Ear lobes', -1, 1, 0, 'earlobe-decr', 'earlobe-incr'], ['earpoint', 'Pointed ears', 0, 1, 0, null, 'earpoint'],
  ],
  head: [
    ['headfat', 'Head fullness', -1, 1, 0, 'headfat-decr', 'headfat-incr'], ['headage', 'Head age', -1, 1, 0, 'headage-decr', 'headage-incr'],
    ['square', 'Square', 0, 1, 0, null, 'head-square'], ['oval', 'Oval', 0, 1, 0, null, 'head-oval'], ['round', 'Round', 0, 1, 0, null, 'head-round'],
  ],
};
const ALL = [...SLIDERS.body, ...SLIDERS.face, ...SLIDERS.head];
const FACE_KEYS = new Set([...SLIDERS.face, ...SLIDERS.head].map((x) => x[0]));
export const DEFAULTS = Object.fromEntries(ALL.map((s) => [s[0], s[4]]));

// muscle and weight each run min .. average .. max; a value between two gives each its share
const thirds = (v) => (v < 0.5 ? [['min', 1 - v * 2], ['average', v * 2]] : [['average', 2 - v * 2], ['max', v * 2 - 1]]);
function weights(s, extra) {
  const W = new Map(), add = (n, w) => { if (n && Math.abs(w) > 1e-4) W.set(n, (W.get(n) || 0) + w); };
  for (const [g, gw] of [['female', 1 - s.gender], ['male', s.gender]]) {
    add(`${g}-young`, gw * (1 - s.age)); add(`${g}-old`, gw * s.age);
    for (const [m, mw] of thirds(s.muscle)) for (const [w, ww] of thirds(s.weight)) if (!(m === 'average' && w === 'average')) add(`${g}-${m}muscle-${w}weight`, gw * mw * ww);
    add(`${g}-${s.height < 0 ? 'min' : 'max'}height`, gw * Math.abs(s.height) * 0.5);
  }
  for (const [k, , , , , lo, hi] of ALL) if (hi) { const v = s[k] ?? 0; add(v < 0 ? lo : hi, Math.abs(v)); }
  for (const [k] of extra) add(k, s[k] ?? 0);
  return W;
}

/* ---------------- subdivision: one level of Catmull-Clark on the quads ---------------- */
// The new mesh keeps the old vertices first (moved to their smoothed places), then one new vertex per edge, then one
// per face, so a vertex number from the base is the same vertex after subdivision.
function topology(N, quads) {
  const F = quads.length / 4, key = new Map(), ev = [], ef = [], fe = new Uint32Array(F * 4);
  for (let f = 0; f < F; f++) for (let k = 0; k < 4; k++) {
    const a = quads[f * 4 + k], b = quads[f * 4 + ((k + 1) & 3)], lo = Math.min(a, b), hi = Math.max(a, b), id0 = key.get(lo * 65536 + hi);
    if (id0 === undefined) { const id = ev.length / 2; key.set(lo * 65536 + hi, id); ev.push(lo, hi); ef.push(f, -1); fe[f * 4 + k] = id; }
    else { ef[id0 * 2 + 1] = f; fe[f * 4 + k] = id0; }
  }
  const E = ev.length / 2, EV = Uint32Array.from(ev), EF = Int32Array.from(ef);
  const csr = (count, fill) => { const off = new Uint32Array(N + 1); count(off); for (let i = 0; i < N; i++) off[i + 1] += off[i]; const at = off.slice(0, N), out = new Uint32Array(off[N]); fill((v, x) => { out[at[v]++] = x; }); return [off, out]; };
  const [vfo, vf] = csr((o) => { for (let i = 0; i < F * 4; i++) o[quads[i] + 1]++; }, (put) => { for (let f = 0; f < F; f++) for (let k = 0; k < 4; k++) put(quads[f * 4 + k], f); });
  const [veo, ve] = csr((o) => { for (let e = 0; e < E; e++) { o[EV[e * 2] + 1]++; o[EV[e * 2 + 1] + 1]++; } }, (put) => { for (let e = 0; e < E; e++) { put(EV[e * 2], e); put(EV[e * 2 + 1], e); } });
  // each boundary vertex's two neighbours along the boundary (-2 where it is not a simple boundary)
  const bnd = new Int32Array(N * 2).fill(-1), onB = new Uint8Array(N);
  for (let e = 0; e < E; e++) if (EF[e * 2 + 1] < 0) {
    const a = EV[e * 2], b = EV[e * 2 + 1];
    for (const [v, u] of [[a, b], [b, a]]) { onB[v] = 1; if (bnd[v * 2] === -1) bnd[v * 2] = u; else if (bnd[v * 2 + 1] === -1) bnd[v * 2 + 1] = u; else bnd[v * 2] = -2; }
  }
  const M = N + E + F, index = new Uint32Array(F * 24);
  for (let f = 0; f < F; f++) {
    const c = [quads[f * 4], quads[f * 4 + 1], quads[f * 4 + 2], quads[f * 4 + 3]], e = [N + fe[f * 4], N + fe[f * 4 + 1], N + fe[f * 4 + 2], N + fe[f * 4 + 3]], fp = N + E + f;
    const q = [[c[0], e[0], fp, e[3]], [c[1], e[1], fp, e[0]], [c[2], e[2], fp, e[1]], [c[3], e[3], fp, e[2]]];
    for (let k = 0; k < 4; k++) { const [a, b, cc, d] = q[k], o = f * 24 + k * 6; index[o] = a; index[o + 1] = b; index[o + 2] = cc; index[o + 3] = a; index[o + 4] = cc; index[o + 5] = d; }
  }
  return { N, E, F, M, quads, EV, EF, vfo, vf, veo, ve, bnd, onB, index };
}
// src: N values of `dim` numbers; out: M values
function subdivide(T, src, dim, out = new Float32Array(T.M * dim)) {
  const { N, E, F, quads, EV, EF, vfo, vf, veo, ve, bnd, onB } = T, FP = (N + E) * dim;
  for (let f = 0; f < F; f++) for (let c = 0; c < dim; c++) out[FP + f * dim + c] = 0.25 * (src[quads[f * 4] * dim + c] + src[quads[f * 4 + 1] * dim + c] + src[quads[f * 4 + 2] * dim + c] + src[quads[f * 4 + 3] * dim + c]);
  for (let e = 0; e < E; e++) {
    const a = EV[e * 2], b = EV[e * 2 + 1], f1 = EF[e * 2], f2 = EF[e * 2 + 1], o = (N + e) * dim;
    for (let c = 0; c < dim; c++) out[o + c] = f2 < 0 ? 0.5 * (src[a * dim + c] + src[b * dim + c]) : 0.25 * (src[a * dim + c] + src[b * dim + c] + out[FP + f1 * dim + c] + out[FP + f2 * dim + c]);
  }
  for (let v = 0; v < N; v++) {
    const o = v * dim, nE = veo[v + 1] - veo[v];
    if (nE === 0 || (onB[v] && (bnd[v * 2] < 0 || bnd[v * 2 + 1] < 0))) { for (let c = 0; c < dim; c++) out[o + c] = src[o + c]; continue; }
    if (onB[v]) { const a = bnd[v * 2] * dim, b = bnd[v * 2 + 1] * dim; for (let c = 0; c < dim; c++) out[o + c] = 0.125 * (src[a + c] + src[b + c]) + 0.75 * src[o + c]; continue; }
    const nF = vfo[v + 1] - vfo[v];
    for (let c = 0; c < dim; c++) {
      let Q = 0, R = 0;
      for (let k = vfo[v]; k < vfo[v + 1]; k++) Q += out[FP + vf[k] * dim + c];
      for (let k = veo[v]; k < veo[v + 1]; k++) { const e = ve[k], u = EV[e * 2] === v ? EV[e * 2 + 1] : EV[e * 2]; R += 0.5 * (src[o + c] + src[u * dim + c]); }
      Q /= nF; R /= nE;
      out[o + c] = (Q + 2 * R + (nE - 3) * src[o + c]) / nE;
    }
  }
  return out;
}

/* ---------------- load ---------------- */
let loading = null;
export function loadBase() { return (loading ||= load()); }
async function load() {
  const t0 = performance.now();
  const get = (f, as) => fetch(new URL(f, DATA)).then((r) => { if (!r.ok) throw new Error(`human-base: ${f} ${r.status}`); return r[as](); });
  const [info, meshBuf, tBuf, skinBuf] = await Promise.all([get('mesh.json', 'json'), get('mesh.bin', 'arrayBuffer'), get('targets.bin', 'arrayBuffer'), get('skin.bin', 'arrayBuffer')]);
  const N = info.vertices, rest = new Float32Array(meshBuf, 0, N * 3), quads = new Uint16Array(meshBuf, N * 12, info.quads * 4);
  const targets = new Map();
  for (const [name, m] of Object.entries(info.targets)) {
    const q = new Int16Array(tBuf, m.at, m.n * 3), d = new Float32Array(m.n * 3);
    for (let k = 0; k < d.length; k++) d[k] = q[k] * m.scale;
    targets.set(name, { d, idx: new Uint16Array(tBuf, m.at + m.n * 6, m.n) });
  }
  const T = topology(N, quads);
  const inBody = new Uint8Array(N); for (let i = 0; i < quads.length; i++) inBody[quads[i]] = 1;
  const restN = quadNormals(rest, quads, N);
  // the lips: where the lip-fullness morph moves most
  const lip = new Float32Array(N); { const t = targets.get('lips-incr'); let big = 0; for (let k = 0; k < t.idx.length; k++) big = Math.max(big, Math.hypot(t.d[k * 3], t.d[k * 3 + 1], t.d[k * 3 + 2])); for (let k = 0; k < t.idx.length; k++) lip[t.idx[k]] = Math.hypot(t.d[k * 3], t.d[k * 3 + 1], t.d[k * 3 + 2]) / big; }
  const B = { info, N, rest, restN, quads, targets, T, inBody, lip, loadMs: 0, armW: new Uint8Array(skinBuf, 0, N), foreW: new Uint8Array(skinBuf, N, N), fingW: new Uint8Array(skinBuf, 2 * N, N), thumbW: new Uint8Array(skinBuf, 3 * N, N) };
  B.marks = findLandmarks(B);
  B.regions = findRegions(B);
  B.loadMs = Math.round(performance.now() - t0);
  B.figure = (o) => new Figure(B, o);
  return B;
}
function quadNormals(p, quads, N, out = new Float32Array(N * 3)) {
  out.fill(0);
  for (let f = 0; f < quads.length; f += 4) {
    const a = quads[f] * 3, b = quads[f + 1] * 3, c = quads[f + 2] * 3, d = quads[f + 3] * 3;
    const ux = p[c] - p[a], uy = p[c + 1] - p[a + 1], uz = p[c + 2] - p[a + 2], vx = p[d] - p[b], vy = p[d + 1] - p[b + 1], vz = p[d + 2] - p[b + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c, d]) { out[i] += nx; out[i + 1] += ny; out[i + 2] += nz; }
  }
  for (let i = 0; i < N * 3; i += 3) { const l = Math.sqrt(out[i] * out[i] + out[i + 1] * out[i + 1] + out[i + 2] * out[i + 2]) || 1; out[i] /= l; out[i + 1] /= l; out[i + 2] /= l; }
  return out;
}

/* ---------------- landmarks: named vertices, found once on the unmorphed mesh ---------------- */
// The vertex order never changes, so a landmark is a vertex number and every morph carries it along. Head points are
// found by simple rules relative to the eyes; body points from the joint helpers the targets also move.
function findLandmarks(B) {
  const { rest: p, N, inBody, info } = B, L = {};
  const centre = (list) => { const c = [0, 0, 0]; for (const i of list) for (let k = 0; k < 3; k++) c[k] += p[i * 3 + k] / list.length; return c; };
  const eL = centre(info.eyes.l), eR = centre(info.eyes.r), side = Math.sign(eL[0]) || 1;   // the base's "l" side, in x
  const ey = (eL[1] + eR[1]) / 2, ez = (eL[2] + eR[2]) / 2, d = Math.abs(eL[0] - eR[0]), ax = d / 2;
  const each = (ok, f) => { let best = -1, bv = -Infinity; for (let i = 0; i < N; i++) { if (!inBody[i]) continue; const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]; if (ok(x, y, z)) { const v = f(x, y, z); if (v > bv) { bv = v; best = i; } } } return best; };
  const nearest = (c) => each(() => true, (x, y, z) => -((x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2));
  const mid = (x) => Math.abs(x) < 0.08 * d;
  const J = (n) => centre(info.joints[n]);
  L.noseTip = each((x, y) => mid(x) && y < ey && y > ey - d, (x, y, z) => z);
  L.chin = each((x, y, z) => mid(x) && y < ey - 1.5 * d && y > ey - 2.3 * d && z > ez - 0.5 * d, (x, y, z) => z);
  L.crown = each((x) => mid(x), (x, y) => y);
  L.browMid = nearest([0, ey + 0.32 * d, ez + 0.6 * d]);
  L.nape = each((x, y) => mid(x) && Math.abs(y - (ey - 1.3 * d)) < 0.15 * d, (x, y, z) => -z);
  L.neckFront = each((x, y) => mid(x) && Math.abs(y - J('neck')[1]) < 0.12 * d, (x, y, z) => z);
  L.neckBack = each((x, y) => mid(x) && Math.abs(y - J('neck')[1]) < 0.12 * d, (x, y, z) => -z);
  // (the base's spine joints count from the top: spine-1 is at the chest, spine-4 just above the pelvis)
  L.chestMid = each((x, y) => mid(x) && Math.abs(y - (J('spine-1')[1] - 0.3)) < 0.15 * d, (x, y, z) => z);
  L.navel = each((x, y) => mid(x) && Math.abs(y - (J('spine-3')[1] - 0.3)) < 0.15 * d, (x, y, z) => z);
  for (const [S, mh] of [['L', 'l'], ['R', 'r']]) {
    const s = mh === 'l' ? side : -side;   // +1 toward this side, in x
    L['eye' + S] = info.eyes[mh][0];
    L['browInner' + S] = nearest([s * ax * 0.45, ey + 0.3 * d, ez + 0.6 * d]);
    L['brow' + S] = nearest([s * ax, ey + 0.32 * d, ez + 0.6 * d]);
    L['browOuter' + S] = each((x, y, z) => Math.abs(y - (ey + 0.22 * d)) < 0.1 * d && s * x > ax * 1.4 && s * x < ax * 1.9, (x, y, z) => z + s * x * 0.2);
    L['cheek' + S] = each((x, y, z) => Math.abs(y - (ey - 0.42 * d)) < 0.12 * d && s * x > ax * 1.15 && s * x < ax * 1.9, (x, y, z) => s * x * 0.75 + z * 0.66);
    L['temple' + S] = each((x, y, z) => Math.abs(y - (ey + 0.3 * d)) < 0.12 * d && z < ez - 0.15 * d && z > ez - 0.9 * d, (x, y, z) => s * x);
    L['jaw' + S] = each((x, y, z) => y < ey - 1.15 * d && y > ey - 1.55 * d && z < ez - 0.35 * d && z > ez - 1.2 * d, (x, y, z) => s * x);
    L['jawMid' + S] = each((x, y, z) => y < ey - 1.5 * d && y > ey - 1.85 * d && s * x > ax * 0.9 && s * x < ax * 1.45 && z > ez - 0.9 * d, (x, y, z) => s * x * 0.45 + z * 0.9);   // the jawline, halfway from the angle to the chin
    L['earTop' + S] = each((x, y, z) => s * x > ax * 2.2 && z < ez - 0.6 * d && z > ez - 1.6 * d, (x, y) => y);
    const sh = J(mh + '-shoulder'), r2 = (c, x, y, z, r) => (x - c[0]) ** 2 + (y - c[1]) ** 2 + (z - c[2]) ** 2 < r * r;
    L['shoulder' + S] = each((x, y, z) => r2(sh, x, y, z, 1.3), (x, y) => y);
    L['armpit' + S] = each((x, y, z) => r2(sh, x, y, z, 1.4) && s * x < s * sh[0], (x, y) => -y);
    const hip = J(mh + '-upper-leg'); L['hip' + S] = each((x, y, z) => r2(hip, x, y, z, 1.6), (x) => s * x);
    for (const [nm, j] of [['elbow', 'elbow'], ['wrist', 'hand'], ['knee', 'knee'], ['ankle', 'ankle']]) L[nm + S] = nearest(J(mh + '-' + j));
    L['kneeFront' + S] = each((x, y, z) => r2(J(mh + '-knee'), x, y, z, 0.9), (x, y, z) => z);
    L['shoulderTop' + S] = L['shoulder' + S];
    L['neckSide' + S] = each((x, y) => Math.abs(y - J('neck')[1]) < 0.12 * d && Math.abs(x) < 2.4 * d, (x) => s * x);
    L['earFront' + S] = each((x, y, z) => s * x > ax * 1.9 && s * x < ax * 2.7 && y > ey - 0.75 * d && y < ey - 0.05 * d && z < ez - 0.55 * d, (x, y, z) => z);
    const an = J(mh + '-ankle');
    L['heel' + S] = each((x, y, z) => Math.abs(x - an[0]) < 0.5 && y < an[1] + 0.2, (x, y, z) => -z);
    L['toe' + S] = each((x, y, z) => Math.abs(x - an[0]) < 0.9 && y < an[1], (x, y, z) => z);
  }
  L.backMid = each((x, y) => mid(x) && Math.abs(y - (J('spine-1')[1] - 0.2)) < 0.15 * d, (x, y, z) => -z);   // between the shoulder blades
  L.backLow = each((x, y) => mid(x) && Math.abs(y - (J('spine-3')[1] - 0.2)) < 0.15 * d, (x, y, z) => -z);   // the small of the back
  L.crotch = each((x) => Math.abs(x) < 0.12, (x, y) => -y);
  // the mouth corners: the lip vertices furthest out to each side
  for (const [S, mh] of [['L', 'l'], ['R', 'r']]) { const s = mh === 'l' ? side : -side; let best = -1, bv = -Infinity; for (let i = 0; i < N; i++) if (inBody[i] && B.lip[i] > 0.25 && s * p[i * 3] > bv) { bv = s * p[i * 3]; best = i; } L['mouth' + S] = best; }
  return { L, side, ey, ez, d, J: Object.fromEntries(Object.keys(info.joints).map((k) => [k, info.joints[k]])) };
}
// regions: sets of base vertices by rule, in the unmorphed mesh (decimetres)
function findRegions(B) {
  const { rest: p, N, inBody, marks } = B, { ey, ez, d } = marks, R = {};
  const neckY = p[marks.L.chin * 3 + 1] - 0.35 * d;
  const pick = (ok) => { const out = []; for (let i = 0; i < N; i++) if (inBody[i] && ok(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])) out.push(i); return Uint32Array.from(out); };
  R.head = pick((x, y) => y > neckY);
  R.scalp = pick((x, y, z) => y > neckY && (y > ey + 0.62 * d - Math.max(0, ez - 0.7 * d - z) * 0.9) && Math.abs(x) < 2.4 * d);
  R.face = pick((x, y, z) => y > neckY && z > ez - 0.55 * d && y < ey + 0.62 * d);
  R.ears = pick((x, y, z) => y > neckY && Math.abs(x) > 2.1 * d && z < ez - 0.5 * d && y < ey + 0.3 * d && y > ey - 1.2 * d);
  // body parts: each vertex goes to the nearest bone, a segment between joint centres (the joints ride every morph)
  const J = (n) => { const l = B.info.joints[n], c = [0, 0, 0]; for (const i of l) for (let k = 0; k < 3; k++) c[k] += p[i * 3 + k] / l.length; return c; };
  const bones = [['torso', J('pelvis'), J('neck')], ['torso', J('neck'), J('l-shoulder')], ['torso', J('neck'), J('r-shoulder')], ['head', J('neck'), J('head-2')]];
  for (const [S, s] of [['L', 'l'], ['R', 'r']]) {
    const sh = J(s + '-shoulder'), el = J(s + '-elbow'), wr = J(s + '-hand'), tip = wr.map((v, k) => v + (wr[k] - el[k]) * 0.5);
    const hp = J(s + '-upper-leg'), kn = J(s + '-knee'), an = J(s + '-ankle'), ft = J(s + '-foot-1');
    bones.push(['upperArm' + S, sh, el], ['forearm' + S, el, wr], ['hand' + S, wr, tip], ['thigh' + S, hp, kn], ['shin' + S, kn, an], ['foot' + S, an, ft], ['torso', J('pelvis'), hp]);
  }
  const segD = (x, y, z, a, b) => { const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2))); return Math.hypot(x - a[0] - ab[0] * t, y - a[1] - ab[1] * t, z - a[2] - ab[2] * t); };
  const parts = {};
  for (let i = 0; i < N; i++) {
    if (!inBody[i]) continue;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]; let best = Infinity, who = 'torso';
    for (const [name, a, b] of bones) { const dd = segD(x, y, z, a, b); if (dd < best) { best = dd; who = name; } }
    (parts[who] ||= []).push(i);
  }
  for (const [k, v] of Object.entries(parts)) R[k] = Uint32Array.from(v);
  R.arms = Uint32Array.from(['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR'].flatMap((k) => [...(R[k] || [])]));
  R.legs = Uint32Array.from(['thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'].flatMap((k) => [...(R[k] || [])]));
  return R;
}

/* ---------------- a figure ---------------- */
const _v = new THREE.Vector3();
class Figure extends THREE.Group {
  constructor(B, o = {}) {
    super();
    this.B = B; this.sub = o.subdivide !== false; this.state = { ...DEFAULTS }; this.extra = new Map(); this.height = 0;
    const T = B.T, M = this.sub ? T.M : B.N;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
    geo.setIndex(new THREE.BufferAttribute(this.sub ? T.index : quadIndex(B.quads), 1));
    const up = (src, dim) => (this.sub ? subdivide(T, src, dim) : src.slice());
    geo.setAttribute('aRest', new THREE.BufferAttribute(up(B.rest, 3), 3));
    geo.setAttribute('aLip', new THREE.BufferAttribute(up(B.lip, 1), 1));
    geo.setAttribute('aCav', new THREE.BufferAttribute(new Float32Array(M * 2), 2));
    geo.setAttribute('aMark', new THREE.BufferAttribute(new Float32Array(M * 2), 2));   // painted marks a species sets: x, a lit bone crest
    { const aw = new Float32Array(B.N * 2); for (let i = 0; i < B.N; i++) { aw[i * 2] = B.armW[i] / 255; aw[i * 2 + 1] = B.foreW[i] / 255; } geo.setAttribute('aArm', new THREE.BufferAttribute(up(aw, 2), 2)); }   // how much of each vertex is arm, and forearm
    this.geometry = geo;
    this.skin = skinMaterial(B, o.skin);
    this.body = new THREE.Mesh(geo, this.skin); this.body.castShadow = this.body.receiveShadow = true; this.body.frustumCulled = false;
    this.eyes = makeEyes(o.eyes); this.add(this.body, this.eyes.l, this.eyes.r);
    this.work = new Float32Array(B.N * 3); this.p0 = new Float32Array(B.N * 3); this.n0 = new Float32Array(B.N * 3);
    this.cav0 = new Float32Array(B.N * 2); this.tmp = new Float32Array(B.N);
    this.update();
  }
  set(o) { Object.assign(this.state, o); return this; }
  // two numbers per base vertex for the skin to paint by (x: a bone crest to light); carried through the subdivision
  setMark(src) { const a = this.geometry.attributes.aMark; if (this.sub) subdivide(this.B.T, src, 2, a.array); else a.array.set(src); a.needsUpdate = true; return this; }
  // the head's own frame after the morphs: origin between the eyes, x to the figure's left, y up, z forward (metres)
  headFrame() {
    const l = this.eyes.l.position, r = this.eyes.r.position, o = new THREE.Vector3().addVectors(l, r).multiplyScalar(0.5);
    const x = new THREE.Vector3().subVectors(l, r), scale = x.length(); x.normalize();
    const c = this.landmark('crown'), y = new THREE.Vector3(c.p[0] - o.x, c.p[1] - o.y, c.p[2] - o.z); y.addScaledVector(x, -y.dot(x)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    return { origin: o.toArray(), x: x.toArray(), y: y.toArray(), z: z.toArray(), scale };
  }
  // our own targets (species bone, for instance): offsets in decimetres in the base mesh's frame, weighted by state[key]
  addTarget(key, t) { this.extra.set(key, t); return this; }
  update() {
    const t0 = performance.now(), B = this.B, w = this.work, N = B.N, tm = (this.timing = {}), lap = (k) => { const t = performance.now(); tm[k] = Math.round((t - (lap.t ?? t0)) * 10) / 10; lap.t = t; };
    w.set(B.rest);
    for (const [name, wt] of weights(this.state, this.extra)) {
      const tg = B.targets.get(name) || this.extra.get(name); if (!tg) continue;
      const { d, idx } = tg;
      for (let k = 0; k < idx.length; k++) { const i = idx[k] * 3, j = k * 3; w[i] += wt * d[j]; w[i + 1] += wt * d[j + 1]; w[i + 2] += wt * d[j + 2]; }
    }
    lap('morphs');
    // the cloth under the undersuit and the arms' pose depend only on the body: when only a face or head slider has
    // moved, the covered and posed vertices are where they were, so their last result is reused
    const cov = this.skin.userData.cover || {}, bodyKey = JSON.stringify([...Object.entries(this.state).filter(([k]) => !FACE_KEYS.has(k)), cov.on, cov.torso, cov.arms, cov.legs]);
    const keep = (this._keep ||= { key: null, idx: null, pos: null });
    if (keep.key === bodyKey && keep.idx) { const { idx, pos } = keep; for (let j = 0; j < idx.length; j++) { const i = idx[j] * 3; w[i] = pos[j * 3]; w[i + 1] = pos[j * 3 + 1]; w[i + 2] = pos[j * 3 + 2]; } lap('cloth'); lap('pose'); }
    else {
      this.clothe(w); lap('cloth');
      if ((this.state.armsDown ?? 0) > 0) this.pose(w, this.state.armsDown); lap('pose');
      if (!keep.idx) { const hs = this._headSet(), ids = []; for (let i = 0; i < N; i++) if (!hs.has(i)) ids.push(i); keep.idx = Uint32Array.from(ids); keep.pos = new Float32Array(keep.idx.length * 3); }
      for (let j = 0; j < keep.idx.length; j++) { const i = keep.idx[j] * 3; keep.pos[j * 3] = w[i]; keep.pos[j * 3 + 1] = w[i + 1]; keep.pos[j * 3 + 2] = w[i + 2]; }
      keep.key = bodyKey;
    }
    // decimetres to metres, feet on the floor
    let lo = Infinity, hi = -Infinity; for (let i = 0; i < N; i++) if (B.inBody[i]) { const y = w[i * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
    const p0 = this.p0; for (let i = 0; i < N * 3; i += 3) { p0[i] = w[i] * 0.1; p0[i + 1] = (w[i + 1] - lo) * 0.1; p0[i + 2] = w[i + 2] * 0.1; }
    this.height = (hi - lo) * 0.1;
    this.cavity(); lap('cavity');
    const g = this.geometry, pos = g.attributes.position.array;
    if (this.sub) { subdivide(B.T, p0, 3, pos); subdivide(B.T, this.cav0, 2, g.attributes.aCav.array); } else { pos.set(p0); g.attributes.aCav.array.set(this.cav0); }
    g.attributes.position.needsUpdate = true; g.attributes.aCav.needsUpdate = true;
    lap('subdivide');
    // normals: the base mesh's, carried through the same subdivision and renormalised (far cheaper than recomputing
    // them over the subdivided triangles, and just as smooth)
    if (this.sub) { const nb = quadNormals(p0, B.quads, N, this.n0), na = g.attributes.normal.array; subdivide(B.T, nb, 3, na); for (let i = 0; i < na.length; i += 3) { const l = Math.sqrt(na[i] * na[i] + na[i + 1] * na[i + 1] + na[i + 2] * na[i + 2]) || 1; na[i] /= l; na[i + 1] /= l; na[i + 2] /= l; } g.attributes.normal.needsUpdate = true; }
    else g.computeVertexNormals();
    g.computeBoundingSphere(); lap('normals');
    this.eyes.place(B.info.eyes, p0);
    this.ms = Math.round(performance.now() - t0);
    this.dispatchEvent({ type: 'shaped' }); lap('listeners');
    return this;
  }
  // Under the undersuit the body reads as cloth, not paint: the covered skin is smoothed so small modelled detail does
  // not show through, and stands a hair proud of the body. The
  // covered region follows the skin's coverage (skin.set({ suitOn, suitCover })), with a soft edge.
  clothe(w) {
    const B = this.B, T = B.T, cov = this.skin.userData.cover || {}, N = B.N, R = B.rest, J = this.skin.userData.u.uJoints.value;
    if (!cov.on) return;
    const mask = (this._mask ||= new Float32Array(N)), key = `${cov.torso}|${cov.arms}|${cov.legs}`;
    if (this._maskKey !== key) {
      this._maskKey = key;
      const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      for (let i = 0; i < N; i++) {
        if (!B.inBody[i]) { mask[i] = 0; continue; }
        const x = Math.abs(R[i * 3]), y = R[i * 3 + 1], arm = B.armW[i] / 255;
        const top = 1.05 - 0.12 * ss(0, 1.2, x), hem = cov.legs >= 1 ? J.z : -2.35 + 0.18 * ss(0.4, 1.6, x);
        let m = ss(hem - 0.1, hem + 0.1, y) * (1 - ss(top - 0.1, top + 0.1, y)) * (1 - ss(0.25, 0.6, arm));
        if (cov.torso) m = Math.max(m, ss(top - 0.15, top, y) * (1 - ss(J.w - 0.1, J.w + 0.05, y)) * (1 - ss(1.6, 1.78, x)) * (1 - ss(0.5, 0.7, arm)));
        if (cov.arms > 0) { const end = cov.arms >= 0.75 ? J.y - 0.25 : J.x + 0.2; m = Math.max(m, ss(0.25, 0.6, arm) * (1 - ss(end - 0.1, end + 0.05, x))); }
        mask[i] = m;
      }
      // reach: only vertices with some cover are worked; collect them once
      const list = []; for (let i = 0; i < N; i++) if (mask[i] > 0.01) list.push(i); this._maskList = Uint32Array.from(list);
    }
    // Smooth over a fixed reach in the body's own units, not over mesh neighbours: an average of the surface round each
    // covered point, every point weighted by the area it stands for and by a Gaussian of its distance, applied along the
    // normal only. Mesh density then makes no difference (neighbour smoothing shrinks coarse areas faster than fine
    // ones, which leaves fine detail standing proud). Details a few centimetres across go; bigger forms stay.
    const list = this._maskList, sig = cov.torso ? 0.17 : 0.13, reach = sig * 2.2, cell = reach;   // decimetres
    for (let pass = 0; pass < (cov.torso ? 2 : 1); pass++) {
    const nrm = quadNormals(w, B.quads, N, this.n0), area = (this._area ||= new Float32Array(N));
    area.fill(0);
    for (let f = 0; f < B.quads.length; f += 4) { const a = B.quads[f] * 3, b2 = B.quads[f + 1] * 3, c = B.quads[f + 2] * 3, d2 = B.quads[f + 3] * 3; const ux = w[c] - w[a], uy = w[c + 1] - w[a + 1], uz = w[c + 2] - w[a + 2], vx = w[d2] - w[b2], vy = w[d2 + 1] - w[b2 + 1], vz = w[d2 + 2] - w[b2 + 2]; const cxx = uy * vz - uz * vy, cyy = uz * vx - ux * vz, czz = ux * vy - uy * vx, A = 0.125 * Math.sqrt(cxx * cxx + cyy * cyy + czz * czz); area[B.quads[f]] += A; area[B.quads[f + 1]] += A; area[B.quads[f + 2]] += A; area[B.quads[f + 3]] += A; }
    const grid = new Map(), K = (a, b, c) => ((a + 512) * 1024 + (b + 512)) * 1024 + (c + 512), keyOf = (x, y, z) => K(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell));
    for (let i = 0; i < N; i++) if (B.inBody[i] && B.armW[i] < 140) { const k = keyOf(w[i * 3], w[i * 3 + 1], w[i * 3 + 2]); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i); }
    const out = (this._out ||= new Float32Array(N)), sn = (this._sn ||= new Float32Array(N * 3));
    for (const v of list) {
      const px = w[v * 3], py = w[v * 3 + 1], pz = w[v * 3 + 2], nx = nrm[v * 3], ny = nrm[v * 3 + 1], nz = nrm[v * 3 + 2], cx = Math.floor(px / cell), cy = Math.floor(py / cell), cz = Math.floor(pz / cell);
      let sw = 0, qx = 0, qy = 0, qz = 0, mx = 0, my = 0, mz = 0;
      for (let a = -1; a <= 1; a++) for (let b3 = -1; b3 <= 1; b3++) for (let c = -1; c <= 1; c++) {
        const arr = grid.get(K(cx + a, cy + b3, cz + c)); if (!arr) continue;
        for (const u of arr) {
          const dx = w[u * 3] - px, dy = w[u * 3 + 1] - py, dz = w[u * 3 + 2] - pz, r2 = dx * dx + dy * dy + dz * dz; if (r2 > reach * reach) continue;
          if (nx * nrm[u * 3] + ny * nrm[u * 3 + 1] + nz * nrm[u * 3 + 2] < 0.2) continue;   // not the far side of a thin part
          const wt = area[u] * Math.exp(-r2 / (2 * sig * sig)); sw += wt; qx += wt * dx; qy += wt * dy; qz += wt * dz; mx += wt * nrm[u * 3]; my += wt * nrm[u * 3 + 1]; mz += wt * nrm[u * 3 + 2];
        }
      }
      // project onto the local plane: through the weighted centroid, square to the weighted normal (a tiny feature's
      // faces all land on one plane, so nothing folds)
      const ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1; mx /= ml; my /= ml; mz /= ml;
      const dd = sw > 0 ? (qx * mx + qy * my + qz * mz) / sw : 0;
      out[v] = dd; sn[v * 3] = mx; sn[v * 3 + 1] = my; sn[v * 3 + 2] = mz;
    }
    for (const v of list) { const a = mask[v] * out[v]; w[v * 3] += sn[v * 3] * a; w[v * 3 + 1] += sn[v * 3 + 1] * a; w[v * 3 + 2] += sn[v * 3 + 2] * a; }
    }
    const n = quadNormals(w, B.quads, N, this.n0);
    for (const v of list) { const a = 0.012 * mask[v]; w[v * 3] += n[v * 3] * a; w[v * 3 + 1] += n[v * 3 + 1] * a; w[v * 3 + 2] += n[v * 3 + 2] * a; }   // about 1 mm proud
  }
  // Lower the arms from the base's A-pose: our own skinning on the CC0 skeleton weights (data/skin.bin says how much of
  // each vertex follows the upper arm, the forearm, the fingers and the thumb). The upper arm swings down about the
  // shoulder to hang ARM_DEG from the side; the forearm hangs with the elbow soft (ELBOW_DEG forward) and turns so the
  // palm faces the thigh, the turn spread along the forearm; the fingers curl loosely toward the palm. k blends from
  // the A-pose (0) to that (1).
  pose(w, k) {
    const B = this.B, ctr = (n) => { const l = B.info.joints[n], c = new THREE.Vector3(); for (const i of l) c.x += w[i * 3] / l.length, c.y += w[i * 3 + 1] / l.length, c.z += w[i * 3 + 2] / l.length; return c; };
    const I = new THREE.Quaternion(), v = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), rad = Math.PI / 180;
    for (const [mh, sx] of [['l', B.marks.side], ['r', -B.marks.side]]) {
      const S = ctr(mh + '-shoulder'), E = ctr(mh + '-elbow'), Wr = ctr(mh + '-hand'), u = E.clone().sub(S).normalize();
      const t = new THREE.Vector3(sx * Math.sin(ARM_DEG * rad), -Math.cos(ARM_DEG * rad), 0.04).normalize();
      const q1 = new THREE.Quaternion().slerpQuaternions(I, new THREE.Quaternion().setFromUnitVectors(u, t), k);
      const E1 = E.clone().sub(S).applyQuaternion(q1).add(S), W1 = Wr.clone().sub(S).applyQuaternion(q1).add(S), f = W1.clone().sub(E1).normalize();
      const ft = new THREE.Vector3(sx * Math.sin(3 * rad), -Math.cos(ELBOW_DEG * rad), Math.sin(ELBOW_DEG * rad)).normalize();
      const q2 = new THREE.Quaternion().slerpQuaternions(I, new THREE.Quaternion().setFromUnitVectors(f, ft), k);
      const Lf = E.distanceTo(Wr), W2 = E1.clone().addScaledVector(ft.clone().lerp(f, 1 - k).normalize(), Lf);
      // the palm: the flat direction of the hand in the rest pose (palm down there), carried through the two turns
      // (measured on the current shape, before posing, so it holds for every build)
      const hp = (() => {
        const pts = []; for (let i = 0; i < B.N; i++) if (B.foreW[i] > 250 && B.rest[i * 3] * sx > 0) { const dx = w[i * 3] - Wr.x, dy = w[i * 3 + 1] - Wr.y, dz = w[i * 3 + 2] - Wr.z; if (dx * (Wr.x - E.x) + dy * (Wr.y - E.y) + dz * (Wr.z - E.z) > 0) pts.push([w[i * 3], w[i * 3 + 1], w[i * 3 + 2]]); }
        const c = [0, 0, 0]; for (const q of pts) for (let j = 0; j < 3; j++) c[j] += q[j] / pts.length;
        const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; for (const q of pts) for (let a = 0; a < 3; a++) for (let b2 = 0; b2 < 3; b2++) C[a][b2] += (q[a] - c[a]) * (q[b2] - c[b2]);
        const tr = C[0][0] + C[1][1] + C[2][2]; let x = [0.3, 1, 0.2];   // the smallest axis: the largest of (tr - C)
        for (let it = 0; it < 60; it++) { const y = [0, 1, 2].map((a) => tr * x[a] - (C[a][0] * x[0] + C[a][1] * x[1] + C[a][2] * x[2])); const l = Math.hypot(...y); x = y.map((q) => q / l); }
        const n = new THREE.Vector3(...x); if (n.y > 0) n.negate(); return n;   // palm down in the rest pose
      })();
      const n1 = hp.clone().applyQuaternion(q1).applyQuaternion(q2), axisT = ft.clone().lerp(f, 1 - k).normalize();
      const want = new THREE.Vector3(-sx, 0, 0.15).normalize(), tw0 = this.state.twist ?? 1, proj = (a) => a.clone().addScaledVector(axisT, -a.dot(axisT)).normalize();
      const a0 = proj(n1), a1 = proj(want), twist = Math.atan2(new THREE.Vector3().crossVectors(a0, a1).dot(axisT), a0.dot(a1)) * k * tw0;
      const palmN = n1.clone().applyAxisAngle(axisT, twist); palmN.addScaledVector(axisT, -palmN.dot(axisT)).normalize();
      // the knuckle line: where the fingers begin along the hand
      // the knuckle line, measured on the current shape: a little way into the fingers' own vertices (their first tenth)
      const sf = []; for (let i = 0; i < B.N; i++) if (B.fingW[i] > 200 && B.rest[i * 3] * sx > 0) sf.push(((w[i * 3] - Wr.x) * (Wr.x - E.x) + (w[i * 3 + 1] - Wr.y) * (Wr.y - E.y) + (w[i * 3 + 2] - Wr.z) * (Wr.z - E.z)) / Lf);
      sf.sort((a, b2) => a - b2); const s0 = sf.length ? sf[Math.floor(sf.length * 0.1)] : 0.9;
      const K = W2.clone().addScaledVector(axisT, s0), kap = (CURL * (this.state.curl ?? 1)) / 0.75;   // curvature, per decimetre past the knuckles
      const tq = new THREE.Quaternion();
      for (let i = 0; i < B.N; i++) {
        const aw = B.armW[i]; if (!aw || B.rest[i * 3] * sx <= 0) continue;
        const A = aw / 255, F = B.foreW[i] / 255; v.set(w[i * 3], w[i * 3 + 1], w[i * 3 + 2]);
        p1.copy(v).sub(S).applyQuaternion(q1).add(S); p2.copy(p1).sub(E1).applyQuaternion(q2).add(E1);
        let x = v.x * (1 - A) + p1.x * (A - F) + p2.x * F, y = v.y * (1 - A) + p1.y * (A - F) + p2.y * F, z = v.z * (1 - A) + p1.z * (A - F) + p2.z * F;
        if (F > 0) {   // the forearm's turn, growing from the elbow to the wrist
          const along = Math.min(1, Math.max(0, ((x - E1.x) * axisT.x + (y - E1.y) * axisT.y + (z - E1.z) * axisT.z) / Lf)), ang = twist * F * Math.min(1, along * 1.15);
          if (Math.abs(ang) > 1e-4) { tq.setFromAxisAngle(axisT, ang); p1.set(x - E1.x, y - E1.y, z - E1.z).applyQuaternion(tq); x = p1.x + E1.x; y = p1.y + E1.y; z = p1.z + E1.z; }
        }
        const cw = (B.fingW[i] + 0.35 * B.thumbW[i]) / 255;
        if (cw > 0 && k > 0) {   // the fingers bend toward the palm, more the further past the knuckles
          const dx = x - K.x, dy = y - K.y, dz = z - K.z, s = dx * axisT.x + dy * axisT.y + dz * axisT.z;
          if (s > 0) {
            const h = dx * palmN.x + dy * palmN.y + dz * palmN.z, th = kap * s * cw * k, ca = Math.cos(th), sa = Math.sin(th);
            const sAlong = (s - 0) * (th > 1e-5 ? sa / th : 1), sUp = th > 1e-5 ? (s * (1 - ca)) / th : 0;
            const rx = dx - s * axisT.x - h * palmN.x, ry = dy - s * axisT.y - h * palmN.y, rz = dz - s * axisT.z - h * palmN.z;   // across the hand: unchanged
            x = K.x + rx + axisT.x * (sAlong - h * sa) + palmN.x * (sUp + h * ca);
            y = K.y + ry + axisT.y * (sAlong - h * sa) + palmN.y * (sUp + h * ca);
            z = K.z + rz + axisT.z * (sAlong - h * sa) + palmN.z * (sUp + h * ca);
          }
        }
        w[i * 3] = x; w[i * 3 + 1] = y; w[i * 3 + 2] = z;
      }
    }
  }
  // the head's vertices (anything a face or head target moves), found once
  _headSet() { if (!this.__head) { const h = new Set(); for (const [, , , , , lo, hi] of [...SLIDERS.face, ...SLIDERS.head]) for (const n of [lo, hi]) { const t = n && this.B.targets.get(n); if (t) for (const i of t.idx) h.add(i); } for (const t of this.extra.values()) for (const i of t.idx) h.add(i); for (const i of this.B.regions.head) h.add(i); this.__head = h; } return this.__head; }
  // how hollow or proud the surface is round each vertex, fine and broad: creases and hollows shade, ridges catch light
  cavity() {
    const B = this.B, T = B.T, p = this.p0, n = quadNormals(p, B.quads, B.N, this.n0), c = this.cav0, N = B.N, tmp = this.tmp;
    for (let v = 0; v < N; v++) {
      let s = 0, k0 = T.veo[v], k1 = T.veo[v + 1];
      for (let k = k0; k < k1; k++) { const e = T.ve[k], u = T.EV[e * 2] === v ? T.EV[e * 2 + 1] : T.EV[e * 2]; const dx = p[u * 3] - p[v * 3], dy = p[u * 3 + 1] - p[v * 3 + 1], dz = p[u * 3 + 2] - p[v * 3 + 2]; s += (n[v * 3] * dx + n[v * 3 + 1] * dy + n[v * 3 + 2] * dz) / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1); }
      c[v * 2] = k1 > k0 ? s / (k1 - k0) : 0;
    }
    for (let v = 0; v < N; v++) tmp[v] = c[v * 2];
    for (let it = 0; it < 12; it++) {   // the broad one: the fine one, spread out
      for (let v = 0; v < N; v++) { let s = tmp[v], m = 1; for (let k = T.veo[v]; k < T.veo[v + 1]; k++) { const e = T.ve[k]; s += tmp[T.EV[e * 2] === v ? T.EV[e * 2 + 1] : T.EV[e * 2]]; m++; } c[v * 2 + 1] = s / m; }
      for (let v = 0; v < N; v++) tmp[v] = c[v * 2 + 1];
    }
  }
  // a named point after the morphs: position, outward normal, a tangent toward the crown, and a local scale (metres)
  landmark(name) {
    const B = this.B, i = B.marks.L[name]; if (i === undefined || i < 0) return null;
    const g = this.geometry, P = g.attributes.position.array, Nn = g.attributes.normal.array;
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], n = [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]];
    const c = B.marks.L.crown, toC = [P[c * 3] - p[0], P[c * 3 + 1] - p[1], P[c * 3 + 2] - p[2]], dn = toC[0] * n[0] + toC[1] * n[1] + toC[2] * n[2];
    _v.set(toC[0] - dn * n[0], toC[1] - dn * n[1], toC[2] - dn * n[2]); if (_v.lengthSq() < 1e-10) _v.set(0, 1, 0); _v.normalize();
    const tl = B.marks.L.templeL, tr = B.marks.L.templeR, s = Math.hypot(P[tl * 3] - P[tr * 3], P[tl * 3 + 1] - P[tr * 3 + 1], P[tl * 3 + 2] - P[tr * 3 + 2]);
    return { p, n, up: [_v.x, _v.y, _v.z], s, i };
  }
  joint(name) { const list = this.B.marks.J[name]; if (!list) return null; const c = [0, 0, 0]; for (const i of list) for (let k = 0; k < 3; k++) c[k] += this.p0[i * 3 + k] / list.length; return c; }
  get landmarks() { return Object.keys(this.B.marks.L); }
  get regions() { return Object.keys(this.B.regions); }
  // the vertex numbers of a region on the live mesh (subdivided: a new vertex belongs when all its parents do)
  region(name) {
    const base = this.B.regions[name]; if (!base) return null;
    if (!this.sub) return base;
    const T = this.B.T, inR = new Uint8Array(T.N); for (const i of base) inR[i] = 1;
    const out = [...base];
    for (let e = 0; e < T.E; e++) if (inR[T.EV[e * 2]] && inR[T.EV[e * 2 + 1]]) out.push(T.N + e);
    for (let f = 0; f < T.F; f++) if (inR[T.quads[f * 4]] && inR[T.quads[f * 4 + 1]] && inR[T.quads[f * 4 + 2]] && inR[T.quads[f * 4 + 3]]) out.push(T.N + T.E + f);
    return Uint32Array.from(out);
  }
  get surface() { const g = this.geometry; return { position: g.attributes.position.array, normal: g.attributes.normal.array, index: g.index.array, rest: g.attributes.aRest.array }; }
}
function quadIndex(q) { const out = new Uint32Array(q.length / 4 * 6); for (let f = 0, o = 0; f < q.length; f += 4, o += 6) { out[o] = q[f]; out[o + 1] = q[f + 1]; out[o + 2] = q[f + 2]; out[o + 3] = q[f]; out[o + 4] = q[f + 2]; out[o + 5] = q[f + 3]; } return out; }
