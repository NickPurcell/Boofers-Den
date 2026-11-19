// (characters/) The body as a field for the clothes: see below. Pure: the workers import it.
// A signed distance to a triangle mesh (the base body), for growing clothes from it with the outfit kit: the triangles
// in buckets on a grid; the nearest triangle among those within reach, searched ring by ring outward; the sign from the
// skin's normal at the nearest point. Further than `reach` from the skin it answers +-reach, the sign from a coarse
// inside/outside grid. fieldFor(position, normal, index, pick?, reach?) -> f(x, y, z); pick(t) chooses the triangles.
export function fieldFor(P, Nn, I, pick = null, reach = 0.06, unsigned = false) {   // unsigned: the distance to these triangles alone (for a part of an open surface)
  const tris = []; for (let t = 0; t < I.length; t += 3) if (!pick || pick(t)) tris.push(t);
  if (!tris.length) return () => reach;   // nothing chosen: everywhere is far from it
  const q = search(P, Nn, I, tris, reach, null);
  return (x, y, z) => { const r = q(x, y, z); return unsigned ? r.u : r.s; };
}
// The body, the body without its arms, and the arms, from ONE search per point (the clothes ask all three, often at the
// same point): isArm[t / 3] says which triangles are arm. all: signed, the whole figure; body: the distance to the armless
// skin, negative inside the figure where that skin is nearer than the arms'; arms: the distance to the arms' skin.
export function bodyFields(P, Nn, I, isArm, reach = 0.06) {
  const tris = []; for (let t = 0; t < I.length; t += 3) tris.push(t);
  const q = search(P, Nn, I, tris, reach, isArm);
  let lx = NaN, ly = NaN, lz = NaN, last = null;
  const at = (x, y, z) => { if (x !== lx || y !== ly || z !== lz) { lx = x; ly = y; lz = z; last = q(x, y, z); } return last; };   // the last point asked, remembered
  return {
    all: (x, y, z) => at(x, y, z).s,
    body: (x, y, z) => { const r = at(x, y, z); return r.s < 0 && r.b <= r.a ? -r.b : r.b; },
    arms: (x, y, z) => at(x, y, z).a,
  };
}
// The search: triangles bucketed on a grid, the nearest among those within reach found ring by ring outward. Returns a
// query giving { s: signed distance, u: unsigned, a: nearest arm triangle, b: nearest other } (a and b only with tags).
function search(P, Nn, I, tris, reach, tags) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let k = 0; k < 3; k++) { const v = I[t + k] * 3; for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[v + a]); hi[a] = Math.max(hi[a], P[v + a]); } }
  for (let a = 0; a < 3; a++) { lo[a] -= reach + 0.02; hi[a] += reach + 0.02; }
  const C = 0.016, nx = Math.ceil((hi[0] - lo[0]) / C), ny = Math.ceil((hi[1] - lo[1]) / C), nz = Math.ceil((hi[2] - lo[2]) / C), NC = nx * ny * nz;
  const key = (i, j, k) => (k * ny + j) * nx + i, ci = (v, a) => Math.floor((v - lo[a]) / C);
  // the buckets, packed: the triangles of cell q are cellTris[start[q] .. start[q + 1])
  const count = new Int32Array(NC + 1), each = (t, fn) => {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const i0 = ci(Math.min(P[a], P[b], P[c]), 0), j0 = ci(Math.min(P[a + 1], P[b + 1], P[c + 1]), 1), k0 = ci(Math.min(P[a + 2], P[b + 2], P[c + 2]), 2);
    const i1 = ci(Math.max(P[a], P[b], P[c]), 0), j1 = ci(Math.max(P[a + 1], P[b + 1], P[c + 1]), 1), k1 = ci(Math.max(P[a + 2], P[b + 2], P[c + 2]), 2);
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(key(i, j, k));
  };
  for (const t of tris) each(t, (q) => count[q + 1]++);
  for (let q = 0; q < NC; q++) count[q + 1] += count[q];
  const start = count.slice(), fill = count.slice(), cellTris = new Int32Array(start[NC]);
  for (const t of tris) each(t, (q) => { cellTris[fill[q]++] = t; });
  // how many cells away the nearest cell with skin is (breadth first, the same in every direction)
  const R = Math.ceil(reach / C) + 1, ring = new Uint8Array(NC).fill(255);
  let front = []; for (let q = 0; q < NC; q++) if (start[q + 1] > start[q]) { ring[q] = 0; front.push(q); }
  for (let r = 0; r <= R && front.length; r++) {
    const next = [];
    for (const q of front) {
      const i = q % nx, j = Math.floor(q / nx) % ny, k = Math.floor(q / (nx * ny));
      for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
        const w = key(a, b, c); if (ring[w] <= r + 1) continue; ring[w] = r + 1; next.push(w);
      }
    }
    front = next;
  }
  // inside or out, for points out of reach: a flood from the box's edge through the cells with no skin
  const out = new Uint8Array(NC), stack = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if ((i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) && ring[key(i, j, k)] > 0) { out[key(i, j, k)] = 1; stack.push(i, j, k); }
  while (stack.length) {
    const k = stack.pop(), j = stack.pop(), i = stack.pop();
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue; const q = key(a, b, c); if (out[q] || ring[q] === 0) continue; out[q] = 1; stack.push(a, b, c); }
  }
  const stamp = new Int32Array(I.length / 3 + 1), S = new Float64Array(5), res = { s: 0, u: 0, a: reach, b: reach };
  let gen = 0, best2 = Infinity, bt = -1, bu = 0, bv = 0, qx = 0, qy = 0, qz = 0, X = 0, Yy = 0, Z = 0, ba2 = Infinity, bb2 = Infinity;
  const visit = (q) => {
    for (let s = start[q], e = start[q + 1]; s < e; s++) {
      const t = cellTris[s], ti = t / 3; if (stamp[ti] === gen) continue; stamp[ti] = gen;
      closest(P, I, t, X, Yy, Z, S); const dx = X - S[0], dy = Yy - S[1], dz = Z - S[2], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best2) { best2 = d2; bt = t; qx = S[0]; qy = S[1]; qz = S[2]; bu = S[3]; bv = S[4]; }
      if (tags) { if (tags[ti]) { if (d2 < ba2) ba2 = d2; } else if (d2 < bb2) bb2 = d2; }
    }
  };
  const SUB = 0.04;   // (the parts are searched this far; past it they count as far)
  return (x, y, z) => {
    const i0 = ci(x, 0), j0 = ci(y, 1), k0 = ci(z, 2);
    res.a = res.b = reach;
    if (i0 < 0 || j0 < 0 || k0 < 0 || i0 >= nx || j0 >= ny || k0 >= nz) { res.u = res.s = Math.hypot(Math.max(lo[0] - x, x - hi[0], 0), Math.max(lo[1] - y, y - hi[1], 0), Math.max(lo[2] - z, z - hi[2], 0)) + reach; return res; }
    const q0 = key(i0, j0, k0), r0 = ring[q0];
    if (r0 > R || (r0 - 1) * C > reach) { res.u = reach; res.s = (out[q0] ? 1 : -1) * reach; return res; }
    gen++; best2 = ba2 = bb2 = Infinity; bt = -1; X = x; Yy = y; Z = z;
    for (let r = Math.max(0, r0); r <= R; r++) {
      const bound = (r - 1) * C;
      // nothing in a further ring can be nearer (than the nearest, and with parts, than each part's nearest within SUB)
      if (bt >= 0 && Math.sqrt(best2) <= bound && (!tags || ((ba2 <= bound * bound || bound >= SUB) && (bb2 <= bound * bound || bound >= SUB)))) break;
      for (let k = k0 - r; k <= k0 + r; k++) {
        if (k < 0 || k >= nz) continue;
        const ek = k === k0 - r || k === k0 + r;
        for (let j = j0 - r; j <= j0 + r; j++) {
          if (j < 0 || j >= ny) continue;
          if (ek || j === j0 - r || j === j0 + r) { for (let i = Math.max(0, i0 - r); i <= Math.min(nx - 1, i0 + r); i++) visit(key(i, j, k)); }
          else { if (i0 - r >= 0) visit(key(i0 - r, j, k)); if (r > 0 && i0 + r < nx) visit(key(i0 + r, j, k)); }
        }
      }
    }
    if (tags) { res.a = Math.min(reach, Math.sqrt(ba2)); res.b = Math.min(reach, Math.sqrt(bb2)); }
    const best = Math.sqrt(best2);
    if (bt < 0 || best > reach) { res.u = reach; res.s = (out[q0] ? 1 : -1) * reach; return res; }
    res.u = best;
    const a = I[bt] * 3, b = I[bt + 1] * 3, c = I[bt + 2] * 3, w = 1 - bu - bv;
    const n0 = Nn[a] * w + Nn[b] * bu + Nn[c] * bv, n1 = Nn[a + 1] * w + Nn[b + 1] * bu + Nn[c + 1] * bv, n2 = Nn[a + 2] * w + Nn[b + 2] * bu + Nn[c + 2] * bv;
    res.s = ((x - qx) * n0 + (y - qy) * n1 + (z - qz) * n2) >= 0 ? best : -best;
    return res;
  };
}
function put(S, x, y, z, v, w) { S[0] = x; S[1] = y; S[2] = z; S[3] = v; S[4] = w; }
// the point of triangle t nearest p, and its weights for the triangle's second and third vertices, into S (Ericson)
function closest(P, I, t, px, py, pz, S) {
  const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
  const ax = P[a], ay = P[a + 1], az = P[a + 2], abx = P[b] - ax, aby = P[b + 1] - ay, abz = P[b + 2] - az, acx = P[c] - ax, acy = P[c + 1] - ay, acz = P[c + 2] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az, d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return put(S, ax, ay, az, 0, 0);
  const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2], d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return put(S, P[b], P[b + 1], P[b + 2], 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return put(S, ax + abx * v, ay + aby * v, az + abz * v, v, 0); }
  const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2], d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return put(S, P[c], P[c + 1], P[c + 2], 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return put(S, ax + acx * w, ay + acy * w, az + acz * w, 0, w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return put(S, P[b] + (P[c] - P[b]) * w, P[b + 1] + (P[c + 1] - P[b + 1]) * w, P[b + 2] + (P[c + 2] - P[b + 2]) * w, 1 - w, w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return put(S, ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w, v, w);
}
