// Human base: what is worked out from the base mesh once, because it depends on the mesh's topology and rest shape
// and on nothing a slider does: the landmarks (named vertices), the regions, the hand mask, the rings round the eye
// openings, and the Pureblood's ridge targets and roots. This module is the one place that derives them. It runs at
// build time (tests/human-base/bake.mjs writes data/derived.json, and --check fails if the shipped table differs from a fresh
// derivation), and in the page only if the shipped table is missing or does not match the mesh. Pure: no three.js, no
// DOM, so node can run it.

// the data files, decoded: the mesh, the morph targets, the skin weights
export function decode(info, meshBuf, tBuf, skinBuf, bonesBuf) {
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
  // the skeleton (a cut of the CC0 default skeleton; tests/human-base/convert.py): its bones, and per vertex four bone
  // numbers and four weights (bytes summing to 255)
  const skeleton = info.skeleton && bonesBuf ? { bones: info.skeleton, idx: new Uint8Array(bonesBuf, 0, N * 4), w: new Uint8Array(bonesBuf, N * 4, N * 4) } : null;
  return { info, N, rest, restN, quads, targets, inBody, lip, skeleton, armW: new Uint8Array(skinBuf, 0, N), foreW: new Uint8Array(skinBuf, N, N), fingW: new Uint8Array(skinBuf, 2 * N, N), thumbW: new Uint8Array(skinBuf, 3 * N, N) };
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
/* ---------------- a coarser body, for figures drawn small (the table's) ---------------- */
// The order to fold the body's vertices away in: quadric error edge collapses on the rest shape, each vertex folded into
// a neighbour that stays where it is. A coarser body is then the same vertices, fewer of them, so every morph and the
// pose still apply, and any level is had at once: into[i] is the vertex i was folded into, step[i] when (65535: never).
// The face counts for more than the rest and the hands for less. The body is closed, and a fold that would tear it or
// turn a face over is refused, so every level is closed too (tests/human-base.test.js checks two).
export function collapseOrder(B, regions, stopAt = 500) {
  const N = B.N, P = B.rest, q = B.quads, nT = (q.length / 4) * 2, T = new Int32Array(nT * 3), alive = new Uint8Array(nT).fill(1);
  for (let f = 0, t = 0; f < q.length; f += 4, t += 6) { T[t] = q[f]; T[t + 1] = q[f + 1]; T[t + 2] = q[f + 2]; T[t + 3] = q[f]; T[t + 4] = q[f + 2]; T[t + 5] = q[f + 3]; }
  const vt = Array.from({ length: N }, () => []);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) vt[T[t * 3 + k]].push(t);
  const W = new Float32Array(N).fill(1);
  for (const k of ['handL', 'handR']) for (const i of regions[k] || []) W[i] = 0.4;
  for (const i of regions.head || []) W[i] = 3;
  for (const i of regions.face || []) W[i] = 150;   // (what makes a face is its colour as much as its form: lips, liner, brows want vertices to sit on)
  const Q = new Float64Array(N * 10);
  const addPlane = (i, a, b, c, d, w) => { const o = i * 10; Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d; Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d; Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d; };
  const nrm = (a, b, c, out) => { const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2]; out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx; return out; };
  const n0 = [0, 0, 0], n1 = [0, 0, 0];
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2]; nrm(a, b, c, n0); const l = Math.hypot(n0[0], n0[1], n0[2]); if (!l) continue;
    const nx = n0[0] / l, ny = n0[1] / l, nz = n0[2] / l, d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
    for (const v of [a, b, c]) addPlane(v, nx, ny, nz, d, (l / 2) * W[v]);
  }
  // an open edge, if the mesh ever has one: a plane through it, square to its face, heavily weighted, holds the line
  const ecount = new Map(), key = (a, b) => (a < b ? a * N + b : b * N + a), isB = new Uint8Array(N);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const e = key(T[t * 3 + k], T[t * 3 + ((k + 1) % 3)]); ecount.set(e, (ecount.get(e) || 0) + 1); }
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const a = T[t * 3 + k], b = T[t * 3 + ((k + 1) % 3)]; if (ecount.get(key(a, b)) !== 1) continue;
    isB[a] = isB[b] = 1; nrm(T[t * 3], T[t * 3 + 1], T[t * 3 + 2], n0);
    const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2];
    let mx = ey * n0[2] - ez * n0[1], my = ez * n0[0] - ex * n0[2], mz = ex * n0[1] - ey * n0[0]; const ml = Math.hypot(mx, my, mz); if (!ml) continue; mx /= ml; my /= ml; mz /= ml;
    const d = -(mx * P[a * 3] + my * P[a * 3 + 1] + mz * P[a * 3 + 2]), w = 200 * (ex * ex + ey * ey + ez * ez);
    addPlane(a, mx, my, mz, d, w); addPlane(b, mx, my, mz, d, w);
  }
  const cost = (u, v) => {
    const o = u * 10, p = v * 10, x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], s = (k) => Q[o + k] + Q[p + k];
    return s(0) * x * x + 2 * s(1) * x * y + 2 * s(2) * x * z + 2 * s(3) * x + s(4) * y * y + 2 * s(5) * y * z + 2 * s(6) * y + s(7) * z * z + 2 * s(8) * z + s(9);
  };
  const live = (u) => { const l = vt[u]; let j = 0; for (const t of l) if (alive[t]) l[j++] = t; l.length = j; return l; };
  const ring = (u) => { const s = new Set(); for (const t of live(u)) for (let k = 0; k < 3; k++) s.add(T[t * 3 + k]); s.delete(u); return s; };
  const shared = (u, v) => { let n = 0; for (const t of vt[u]) if (alive[t] && (T[t * 3] === v || T[t * 3 + 1] === v || T[t * 3 + 2] === v)) n++; return n; };
  // a small binary heap of [cost, vertex, version]
  const H = [], ver = new Uint32Array(N), best = new Int32Array(N).fill(-1), no = new Map();
  const up = (i) => { while (i) { const p = (i - 1) >> 1; if (H[p][0] <= H[i][0]) break; [H[p], H[i]] = [H[i], H[p]]; i = p; } };
  const down = (i) => { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < H.length && H[l][0] < H[m][0]) m = l; if (r < H.length && H[r][0] < H[m][0]) m = r; if (m === i) return; [H[m], H[i]] = [H[i], H[m]]; i = m; } };
  const pop = () => { const top = H[0], last = H.pop(); if (H.length) { H[0] = last; down(0); } return top; };
  const consider = (u) => {
    ver[u]++; best[u] = -1; let bc = Infinity; const skip = no.get(u);
    for (const v of ring(u)) { if (skip && skip.has(v)) continue; if (isB[u] && shared(u, v) !== 1) continue; const c = cost(u, v); if (c < bc) { bc = c; best[u] = v; } }
    if (best[u] >= 0) { H.push([bc, u, ver[u]]); up(H.length - 1); }
  };
  const into = new Uint16Array(N), step = new Uint16Array(N).fill(65535), gone = new Uint8Array(N);
  let count = 0; for (let i = 0; i < N; i++) { into[i] = i; if (B.inBody[i]) { count++; consider(i); } }
  let s = 0;
  while (H.length && count > stopAt) {
    const [, u, vv] = pop(); if (vv !== ver[u] || gone[u]) continue;
    const v = best[u]; if (v < 0 || gone[v]) { consider(u); continue; }
    // refuse a fold that turns a face over, or that would join two sheets (more than the two shared neighbours)
    let bad = false; const ru = ring(u), rv = ring(v); let common = 0; for (const x of ru) if (rv.has(x)) common++;
    if (common > (shared(u, v) === 1 ? 1 : 2)) bad = true;
    if (!bad) for (const t of vt[u]) {
      if (!alive[t]) continue; const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2]; if (a === v || b === v || c === v) continue;
      nrm(a, b, c, n0); nrm(a === u ? v : a, b === u ? v : b, c === u ? v : c, n1);
      const d = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2], l0 = Math.hypot(n0[0], n0[1], n0[2]), l1 = Math.hypot(n1[0], n1[1], n1[2]);
      if (l1 < 1e-9 || d < 0.2 * l0 * l1) { bad = true; break; }
    }
    if (bad) { let set = no.get(u); if (!set) no.set(u, (set = new Set())); set.add(v); consider(u); continue; }
    for (const t of vt[u]) {
      if (!alive[t]) continue; const o = t * 3;
      if (T[o] === v || T[o + 1] === v || T[o + 2] === v) { alive[t] = 0; continue; }
      for (let k = 0; k < 3; k++) if (T[o + k] === u) T[o + k] = v;
      vt[v].push(t);
    }
    vt[u].length = 0;
    for (let k = 0; k < 10; k++) Q[v * 10 + k] += Q[u * 10 + k];
    gone[u] = 1; into[u] = v; step[u] = s++; count--; no.delete(v);
    consider(v); for (const x of ring(v)) consider(x);
  }
  return { into, step, steps: s };
}
// the body at a level: which vertex stands for each (rep), and how many stay. Pick a level by the vertices to keep.
export function coarser(B, keep) {
  const { into, step, steps } = B.derived.lod, N = B.N; let body = 0; for (let i = 0; i < N; i++) if (B.inBody[i]) body++;
  const c = Math.max(0, Math.min(steps, body - keep)), rep = new Int32Array(N);
  for (let i = 0; i < N; i++) { let j = i; while (step[j] < c) j = into[j]; rep[i] = j; }
  return { rep, folds: c, kept: body - c };
}
export function deriveAll(B) {
  const marks = findLandmarks(B), Bm = { ...B, marks };
  const regions = findRegions(Bm);
  return { fingerprint: fingerprint(B), marks: { L: marks.L, side: marks.side, ey: marks.ey, ez: marks.ez, d: marks.d }, regions, hand: handMask(B), eyeRings: eyeRings(Bm), pureblood: derivePureblood(B, marks), lod: collapseOrder(B, regions) };
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
