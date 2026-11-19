// Human base: what is worked out from the base mesh once, because it depends on the mesh's topology and rest shape
// and on nothing a slider does: the landmarks (named vertices), the regions, the hand mask, the rings round the eye
// openings, and the Pureblood's ridge targets and roots. This module is the one place that derives them. It runs at
// build time (scripts/mh/bake.mjs writes data/derived.json, and --check fails if the shipped table differs from a fresh
// derivation), and in the page only if the shipped table is missing or does not match the mesh. Pure: no three.js, no
// DOM, so node can run it.

// the data files, decoded: the mesh, the morph targets, the skin weights
export function decode(info, meshBuf, tBuf, skinBuf) {
  const N = info.vertices, rest = new Float32Array(meshBuf, 0, N * 3), quads = new Uint16Array(meshBuf, N * 12, info.quads * 4);
  const targets = new Map();
  for (const [name, m] of Object.entries(info.targets)) {
    const q = new Int16Array(tBuf, m.at, m.n * 3), d = new Float32Array(m.n * 3);
    for (let k = 0; k < d.length; k++) d[k] = q[k] * m.scale;
    targets.set(name, { d, idx: new Uint16Array(tBuf, m.at + m.n * 6, m.n) });
  }
  const inBody = new Uint8Array(N); for (let i = 0; i < quads.length; i++) inBody[quads[i]] = 1;
  const restN = quadNormals(rest, quads, N);
  // the lips: where the lip-fullness morph moves most
  const lip = new Float32Array(N); { const t = targets.get('lips-incr'); let big = 0; for (let k = 0; k < t.idx.length; k++) big = Math.max(big, Math.hypot(t.d[k * 3], t.d[k * 3 + 1], t.d[k * 3 + 2])); for (let k = 0; k < t.idx.length; k++) lip[t.idx[k]] = Math.hypot(t.d[k * 3], t.d[k * 3 + 1], t.d[k * 3 + 2]) / big; }
  return { info, N, rest, restN, quads, targets, inBody, lip, armW: new Uint8Array(skinBuf, 0, N), foreW: new Uint8Array(skinBuf, N, N), fingW: new Uint8Array(skinBuf, 2 * N, N), thumbW: new Uint8Array(skinBuf, 3 * N, N) };
}
// a fingerprint of the mesh, so a shipped table is never used with a mesh it was not made from
export function fingerprint(B) { let a = 0, b = 0; for (let i = 0; i < B.rest.length; i++) { a = (a + Math.round(B.rest[i] * 1e4)) | 0; b = (b * 31 + a) | 0; } let q = 0; for (let i = 0; i < B.quads.length; i++) q = (q * 17 + B.quads[i]) | 0; return `${B.N}:${B.quads.length}:${a}:${b}:${q}`; }

export function quadNormals(p, quads, N, out = new Float32Array(N * 3)) {
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

/* ---------------- landmarks and regions ---------------- */
export function findLandmarks(B) {
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
export function findRegions(B) {
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


/* ---------------- the hand, for a sleeve that stops at the wrist ---------------- */
// per vertex, 0..1: past the wrist along the forearm (rest pose), or on a finger or the thumb
export function handMask(B) {
  const out = new Float32Array(B.N), R = B.rest, J = (n) => { const l = B.info.joints[n], c = [0, 0, 0]; for (const i of l) for (let k = 0; k < 3; k++) c[k] += R[i * 3 + k] / l.length; return c; };
  const arms = ['l', 'r'].map((m) => { const E = J(m + '-elbow'), W = J(m + '-hand'), d = [W[0] - E[0], W[1] - E[1], W[2] - E[2]], L = Math.hypot(...d); return { E, W, d: d.map((v) => v / L), L, sx: Math.sign(W[0]) }; });
  for (let i = 0; i < B.N; i++) {
    if (!B.armW[i]) continue;
    const a = arms.find((q) => Math.sign(R[i * 3]) === q.sx) || arms[0], s2 = ((R[i * 3] - a.W[0]) * a.d[0] + (R[i * 3 + 1] - a.W[1]) * a.d[1] + (R[i * 3 + 2] - a.W[2]) * a.d[2]) / a.L;
    out[i] = Math.max(B.fingW[i] > 20 || B.thumbW[i] > 20 ? 1 : 0, Math.min(1, Math.max(0, (s2 + 0.06) / 0.06)));
  }
  return out;
}

/* ---------------- the eye openings, for liner and a surround ---------------- */
// each eye's lid edge as a ring of 36 points round its centre, in metres from the point between the eyes (rest pose)
export function eyeRings(B) {
  const R = B.rest, ec = [0, 0, 0]; for (const k of ['l', 'r']) for (const i of B.info.eyes[k]) for (let q = 0; q < 3; q++) ec[q] += R[i * 3 + q] / (B.info.eyes[k].length * 2);
  return ['l', 'r'].map((k) => {
    const c = [0, 0, 0]; for (const i of B.info.eyes[k]) for (let q = 0; q < 3; q++) c[q] += R[i * 3 + q] / B.info.eyes[k].length;
    // the lid's edge: the skin that lies against the front of the eyeball (the mesh is closed, so there is no hole edge)
    let r = 0; { const l = B.info.eyes[k]; for (const i of l) r += Math.hypot(R[i * 3] - c[0], R[i * 3 + 1] - c[1], R[i * 3 + 2] - c[2]) / l.length; }
    const pts = []; for (let i = 0; i < B.N; i++) { if (!B.inBody[i]) continue; const dx = R[i * 3] - c[0], dy = R[i * 3 + 1] - c[1], dz = R[i * 3 + 2] - c[2], dd = Math.hypot(dx, dy, dz); if (dz > r * 0.35 && dd < r * 1.12) pts.push([(R[i * 3] - ec[0]) / 10, (R[i * 3 + 1] - ec[1]) / 10]); }
    const cx = (c[0] - ec[0]) / 10, cy = (c[1] - ec[1]) / 10, NB = 36, best = new Array(NB).fill(null);
    // in each direction round the eye, the nearest skin point is the lid's edge; then smooth the ring a little
    for (const p of pts) { const a = Math.atan2(p[1] - cy, p[0] - cx), kk = Math.floor(((a + Math.PI) / (2 * Math.PI)) * NB) % NB, rr = Math.hypot(p[0] - cx, p[1] - cy); if (!best[kk] || rr < best[kk][2]) best[kk] = [p[0], p[1], rr]; }
    const ring = []; for (let kk = 0; kk < NB; kk++) { const a = -Math.PI + ((kk + 0.5) / NB) * 2 * Math.PI; let rr = best[kk]?.[2]; if (rr === undefined) { const prev = best[(kk + NB - 1) % NB], next = best[(kk + 1) % NB]; rr = ((prev?.[2] ?? 0.008) + (next?.[2] ?? 0.008)) / 2; } ring.push([a, rr]); }
    for (let it = 0; it < 2; it++) { const r0 = ring.map((q) => q[1]); for (let kk = 0; kk < NB; kk++) ring[kk][1] = 0.25 * r0[(kk + NB - 1) % NB] + 0.5 * r0[kk] + 0.25 * r0[(kk + 1) % NB]; }
    return { c: [cx, cy], pts: ring.map(([a, rr]) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]) };
  });
}

/* ---------------- the Pureblood: ridges and roots ---------------- */
function ridges(B, lines) {
  const { rest: p, N, inBody } = B, lift = new Float32Array(N), beside = new Float32Array(N);
  for (const { pts, w, h } of lines) {
    let total = 0; const seg = []; for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); seg.push([a, b, L, total]); total += L; }
    for (let i = 0; i < N; i++) {
      if (!inBody[i]) continue;
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]; let best = Infinity, along = 0;
      for (const [a, b, L, s0] of seg) {
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / (L * L || 1)));
        const dd = Math.hypot(x - a[0] - ab[0] * t, y - a[1] - ab[1] * t, z - a[2] - ab[2] * t); if (dd < best) { best = dd; along = (s0 + t * L) / total; }
      }
      if (best >= w) { if (best < w * 1.7) beside[i] = Math.max(beside[i], Math.sin(Math.PI * ((best - w) / (0.7 * w))) * Math.sin(Math.PI * along) ** 0.5); continue; }
      const q = best / w, crest = (1 - q * q) ** 2 * (0.6 + 0.4 * (1 - q)), ends = Math.sin(Math.PI * along) ** 0.5;
      lift[i] = Math.max(lift[i], h * crest * ends);
    }
  }
  return { lift, beside };   // the page turns these into a morph target (along the rest normals) and the crest and shade marks
}

// The Pureblood's bone folds (three groups of ridges, as morph targets with a crest and a shade value per vertex), its
// tendril roots and its spur roots, and the vertices jewellery sits on: all from the rest shape and the landmarks.
export function derivePureblood(B, marks) {
  const L = marks.L, R = B.rest, { d, ey, ez } = marks, at = (i) => [R[i * 3], R[i * 3 + 1], R[i * 3 + 2]];
  const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  // the nearest body vertex to a point in the base frame; a point on the front of the face at (x, y)
  const nearest = (c) => { let best = -1, bd = Infinity; for (let i = 0; i < B.N; i++) { if (!B.inBody[i]) continue; const q = (R[i * 3] - c[0]) ** 2 + (R[i * 3 + 1] - c[1]) ** 2 + (R[i * 3 + 2] - c[2]) ** 2; if (q < bd) { bd = q; best = i; } } return best; };
  const onFace = (x, y) => { let best = -1, bz = -Infinity; for (let i = 0; i < B.N; i++) { if (!B.inBody[i] || Math.abs(R[i * 3] - x) > 0.05 * d || Math.abs(R[i * 3 + 1] - y) > 0.05 * d) continue; if (R[i * 3 + 2] > bz) { bz = R[i * 3 + 2]; best = i; } } return best < 0 ? at(nearest([x, y, ez + d])) : at(best); };
  const line = (x0, y0, x1, y1, k = 6) => Array.from({ length: k + 1 }, (_, j) => onFace(x0 + (x1 - x0) * (j / k), y0 + (y1 - y0) * (j / k)));
  const ax = d / 2;
  // folds: three up the forehead from between the brows; two across each cheek from under the cheekbone toward the
  // mouth; "corded" adds two more on the forehead, a third on each cheek and one along each side of the chin
  const brow = [{ pts: line(0, ey + 0.42 * d, 0, ey + 1.5 * d), w: 0.17 * d, h: 0.15 * d }], cheek = [], cord = [];
  for (const s of [1, -1]) {
    brow.push({ pts: line(s * 0.3 * d, ey + 0.4 * d, s * 0.62 * d, ey + 1.4 * d), w: 0.16 * d, h: 0.135 * d });
    cheek.push({ pts: line(s * 1.62 * ax, ey - 0.62 * d, s * 1.0 * ax, ey - 1.18 * d), w: 0.2 * d, h: 0.2 * d });
    cheek.push({ pts: line(s * 1.82 * ax, ey - 0.86 * d, s * 1.28 * ax, ey - 1.38 * d), w: 0.18 * d, h: 0.17 * d });
    cord.push({ pts: line(s * 0.62 * d, ey + 0.38 * d, s * 1.0 * d, ey + 1.15 * d), w: 0.13 * d, h: 0.1 * d });
    cord.push({ pts: line(s * 1.95 * ax, ey - 1.12 * d, s * 1.5 * ax, ey - 1.55 * d), w: 0.14 * d, h: 0.12 * d });
    cord.push({ pts: line(s * 0.42 * d, ey - 1.55 * d, s * 0.3 * d, ey - 1.95 * d, 4), w: 0.11 * d, h: 0.09 * d });
  }
  const G = {}; for (const [k, lines] of Object.entries({ brow, cheek, cord })) { const { lift, beside } = ridges(B, lines); G[k] = { lift, beside }; }
  // tendril roots on the jaw's lower edge and the chin (vertex numbers, found once)
  const under = (c, k = 0.14) => nearest([c[0], c[1] - k * d, c[2] - 0.08 * d]);
  const chin = at(L.chin), R0 = { chin: [], jaw: [], jaw2: [], cheek: [], mid: [under(chin, 0.2)] };
  for (const S of ['L', 'R']) {
    const jm = at(L['jawMid' + S]), ja = at(L['jaw' + S]), mo = at(L['mouth' + S]);
    R0.chin.push(under(lerp(chin, jm, 0.16)));
    R0.jaw.push(under(lerp(chin, jm, 0.7), 0.05), under(lerp(jm, ja, 0.4), 0.03));
    R0.jaw2.push(under(lerp(jm, ja, 0.7), 0.03));
    R0.cheek.push(nearest(lerp(lerp(mo, jm, 0.55), ja, 0.2)));
  }
  const spur = {};
  for (const S of ['L', 'R']) { spur['brow' + S] = L['browOuter' + S]; spur['cheek' + S] = nearest(lerp(at(L['cheek' + S]), at(L['earFront' + S]), 0.62)); spur['jaw' + S] = L['jaw' + S]; }
  // where a lip stud, the circlet sit
  const lipStud = nearest(lerp(at(L.chin), at(L.noseTip), 0.42)), studs = [nearest(lerp(at(L.chin), at(L.noseTip), 0.08)), nearest(lerp(at(L.chin), at(L.noseTip), 0.4))];
  const noseRing = nearest([at(L.noseTip)[0] + 0.12 * d * marks.side, at(L.noseTip)[1] - 0.12 * d, at(L.noseTip)[2] - 0.08 * d]);
  const circlet = []; for (let k = 0; k <= 36; k++) { const a = (k / 36) * Math.PI * 2; circlet.push(nearest([Math.sin(a) * 3 * ax, ey + (0.8 - 0.3 * (1 - Math.cos(a)) * 0.5) * d, ez - 1.3 * d + Math.cos(a) * 2.2 * d])); }
  const circletFront = nearest([0, ey + 0.8 * d, ez + d]);
  const anchorCirclet = []; for (let k = -6; k <= 6; k++) anchorCirclet.push(nearest([Math.sin(k * 0.22) * 2.3 * ax, ey + 0.95 * d, ez + d * (Math.cos(k * 0.22) - 1.25)]));
  return { folds: G, roots: R0, spur, lipStud, studs, noseRing, circlet, circletFront, anchorCirclet };
}

/* ---------------- all of it, and how it travels ---------------- */
export function deriveAll(B) {
  const marks = findLandmarks(B), Bm = { ...B, marks };
  const regions = findRegions(Bm);
  return { fingerprint: fingerprint(B), marks: { L: marks.L, side: marks.side, ey: marks.ey, ez: marks.ez, d: marks.d }, regions, hand: handMask(B), eyeRings: eyeRings(Bm), pureblood: derivePureblood(B, marks) };
}
// typed arrays as base64 in JSON, and back
const KINDS = { Uint8Array, Uint16Array, Uint32Array, Float32Array, Int16Array };
const b64 = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64') : btoa(Array.from(u8, (c) => String.fromCharCode(c)).join('')));
const unb64 = (s) => { if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); } const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export function pack(v) {
  if (ArrayBuffer.isView(v)) {
    let a = v; if (v instanceof Uint32Array && v.every((x) => x < 65536)) a = Uint16Array.from(v);
    if (a instanceof Float32Array && a.every((x) => x === 0)) return { $t: 'Float32Array', zeros: a.length };
    if (a instanceof Float32Array) { const nz = []; for (let i = 0; i < a.length; i++) if (a[i] !== 0) nz.push(i); if (nz.length < a.length / 3) return { $t: 'Float32Array', n: a.length, idx: pack(Uint16Array.from(nz)), val: pack(Float32Array.from(nz.map((i) => a[i]))) }; }
    return { $t: a.constructor.name, b64: b64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) };
  }
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
  return v;
}
export function unpack(v) {
  if (v && typeof v === 'object' && v.$t) {
    const K = KINDS[v.$t];
    if (v.zeros !== undefined) return new K(v.zeros);
    if (v.idx) { const out = new K(v.n), idx = unpack(v.idx), val = unpack(v.val); for (let j = 0; j < idx.length; j++) out[idx[j]] = val[j]; return out; }
    const u = unb64(v.b64); return new K(u.buffer, u.byteOffset, u.byteLength / K.BYTES_PER_ELEMENT);
  }
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(x)]));
  return v;
}
