// Signed distance shapes and a surface-nets mesher, for the Duros creator's worker (and its main-thread fallback).
// A shape is a function (x, y, z) -> distance in metres, negative inside. Nothing here touches the DOM or three.js.

const hypot3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ---------------- primitives ---------------- */
export const sphere = (cx, cy, cz, r) => (x, y, z) => hypot3(x - cx, y - cy, z - cz) - r;
// an ellipsoid (Quilez's bound: good near the surface, which is all the mesher needs)
export const ellipsoid = (cx, cy, cz, rx, ry, rz) => (x, y, z) => {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz);
  const k1 = Math.sqrt((px / rx) ** 2 + (py / ry) ** 2 + (pz / rz) ** 2);
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
};
// a capsule between two points
export const capsule = (a, b, r) => {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], bb = bax * bax + bay * bay + baz * baz || 1e-12;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const h = clamp((pax * bax + pay * bay + paz * baz) / bb, 0, 1);
    return hypot3(pax - bax * h, pay - bay * h, paz - baz * h) - r;
  };
};
// a cone with round ends, radius r1 at a and r2 at b (Quilez's exact round cone)
export const roundCone = (a, b, r1, r2) => {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  return (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * bax + pay * bay + paz * baz, zz = yy - l2;
    const qx = pax * l2 - bax * yy, qy = pay * l2 - bay * yy, qz = paz * l2 - baz * yy;
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
};
// an axis-aligned rounded box (half sizes hx, hy, hz, corner radius r)
export const roundBox = (cx, cy, cz, hx, hy, hz, r) => (x, y, z) => {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r, qz = Math.abs(z - cz) - hz + r;
  return hypot3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
// a torus round the y axis
export const torusY = (cx, cy, cz, R, r) => (x, y, z) => {
  const qx = Math.hypot(x - cx, z - cz) - R;
  return Math.hypot(qx, y - cy) - r;
};
// a half-space: everything below the plane through p with normal n (unit) is inside
export const plane = (p, n) => (x, y, z) => (x - p[0]) * n[0] + (y - p[1]) * n[1] + (z - p[2]) * n[2];
// a slab between two heights
export const slabY = (y0, y1) => (x, y, z) => Math.max(y0 - y, y - y1);
// a chain of capsules through points (a strap, a lip, a seam)
export const chain = (pts, r) => {
  const segs = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let rmax = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const rr = typeof r === 'function' ? r(i) : r, a = pts[i], b = pts[i + 1];
    rmax = Math.max(rmax, rr);
    segs.push({ f: capsule(a, b, rr), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], R: hypot3(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + rr });
    for (const p of [a, b]) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  }
  return (x, y, z) => {
    // far from the whole chain: the distance to its box is enough
    const ox = Math.max(lo[0] - rmax - x, x - hi[0] - rmax, 0), oy = Math.max(lo[1] - rmax - y, y - hi[1] - rmax, 0), oz = Math.max(lo[2] - rmax - z, z - hi[2] - rmax, 0);
    const out = hypot3(ox, oy, oz);
    if (out > 0.006) return out;
    let d = Infinity;
    for (const s of segs) {
      const lb = hypot3(x - s.c[0], y - s.c[1], z - s.c[2]) - s.R;
      if (lb >= d) continue;
      const v = s.f(x, y, z); if (v < d) d = v;
    }
    return d;
  };
};

/* ---------------- combining ---------------- */
// a local feature inside a sphere (centre c, radius r): far outside it, only the distance to the sphere is computed
export const near = (c, r, f) => (x, y, z) => { const d = hypot3(x - c[0], y - c[1], z - c[2]) - r; return d > 0.01 ? d : f(x, y, z); };
export const union = (...fs) => (x, y, z) => { let d = Infinity; for (const f of fs) { const v = f(x, y, z); if (v < d) d = v; } return d; };
export const intersect = (...fs) => (x, y, z) => { let d = -Infinity; for (const f of fs) { const v = f(x, y, z); if (v > d) d = v; } return d; };
export const subtract = (a, b) => (x, y, z) => Math.max(a(x, y, z), -b(x, y, z));
const sminv = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const smin = (k, ...fs) => (x, y, z) => { let d = fs[0](x, y, z); for (let i = 1; i < fs.length; i++) d = sminv(d, fs[i](x, y, z), k); return d; };
export const ssub = (k, a, b) => (x, y, z) => -sminv(-a(x, y, z), b(x, y, z), k);
export const sintersect = (k, a, b) => (x, y, z) => -sminv(-a(x, y, z), -b(x, y, z), k);
export const mirrorX = (f) => (x, y, z) => f(Math.abs(x), y, z);
export const translate = (f, tx, ty, tz) => (x, y, z) => f(x - tx, y - ty, z - tz);
// a shell of thickness t outside a body (and a little inside it, so its cut edges are thin, like cloth)
export const shell = (body, t, tin = 0.002) => (x, y, z) => { const d = body(x, y, z); return Math.max(d - t, -d - tin); };
// rotate a shape: m is a 3x3 rotation (row-major) taking world into the shape's frame, about centre c
export const rotate = (f, m, c = [0, 0, 0]) => (x, y, z) => {
  const px = x - c[0], py = y - c[1], pz = z - c[2];
  return f(c[0] + m[0] * px + m[1] * py + m[2] * pz, c[1] + m[3] * px + m[4] * py + m[5] * pz, c[2] + m[6] * px + m[7] * py + m[8] * pz);
};
export const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, s, 0, -s, c]; };
export const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 1, 0, s, 0, c]; };
export const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, -s, c, 0, 0, 0, 1]; };

/* ---------------- surface queries ---------------- */
export function gradient(f, x, y, z, e = 0.0005) {
  const gx = f(x + e, y, z) - f(x - e, y, z), gy = f(x, y + e, z) - f(x, y - e, z), gz = f(x, y, z + e) - f(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}
// the nearest point on the surface to p (a few Newton steps), and its normal
export function project(f, p, steps = 6) {
  let [x, y, z] = p;
  for (let i = 0; i < steps; i++) { const d = f(x, y, z), n = gradient(f, x, y, z); x -= n[0] * d; y -= n[1] * d; z -= n[2] * d; }
  return { p: [x, y, z], n: gradient(f, x, y, z) };
}
// march a ray from o along dir (unit) to the surface
export function cast(f, o, dir, max = 1) {
  let t = 0;
  for (let i = 0; i < 160 && t < max; i++) {
    const d = f(o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t);
    if (d < 0.0002) { const p = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t]; return { p, n: gradient(f, ...p) }; }
    t += Math.max(d * 0.8, 0.0004);
  }
  return null;
}

/* ---------------- the mesher ---------------- */
// Naive surface nets over a grid of spacing h inside bounds [min, max], with a coarse pass first so that only cells
// near the surface are sampled finely. Returns positions, normals (from the field's gradient), indices, a baked
// ambient occlusion per vertex (from the field itself) and box-projected uvs (scale metres per uv unit).
export function mesh(f, bounds, h, opts = {}) {
  const [min, max] = bounds;
  const nx = Math.ceil((max[0] - min[0]) / h) + 1, ny = Math.ceil((max[1] - min[1]) / h) + 1, nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const C = 4, cnx = Math.ceil(nx / C) + 1, cny = Math.ceil(ny / C) + 1, cnz = Math.ceil(nz / C) + 1, H = h * C;
  const coarse = new Float32Array(cnx * cny * cnz);
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++)
    coarse[i + cnx * (j + cny * k)] = f(min[0] + i * H, min[1] + j * H, min[2] + k * H);
  const band = H * (opts.band || 1.3);
  // which coarse cells the surface may pass near: any corner within the band, or corners of both signs
  const need = new Uint8Array(cnx * cny * cnz), sgn = new Int8Array(cnx * cny * cnz);
  for (let k = 0; k < cnz - 1; k++) for (let j = 0; j < cny - 1; j++) for (let i = 0; i < cnx - 1; i++) {
    let near = false, pos0 = false, neg0 = false;
    for (let c = 0; c < 8; c++) {
      const v = coarse[(i + (c & 1)) + cnx * ((j + ((c >> 1) & 1)) + cny * (k + ((c >> 2) & 1)))];
      if (v < band && v > -band) near = true;
      if (v < 0) neg0 = true; else pos0 = true;
    }
    const o = i + cnx * (j + cny * k);
    need[o] = near || (pos0 && neg0) ? 1 : 0;
    sgn[o] = neg0 ? -1 : 1;
  }
  const vals = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) {
    const ck = Math.min(cnz - 2, (k / C) | 0), z = min[2] + k * h;
    for (let j = 0; j < ny; j++) {
      const cj = Math.min(cny - 2, (j / C) | 0), y = min[1] + j * h, row = cnx * (cj + cny * ck);
      for (let i = 0; i < nx; i++) {
        const o = Math.min(cnx - 2, (i / C) | 0) + row;
        vals[i + nx * (j + ny * k)] = need[o] ? f(min[0] + i * h, y, z) : sgn[o] * band;
      }
    }
  }
  // one vertex per cell the surface crosses, at the average of its edges' crossings
  const ncx = nx - 1, ncy = ny - 1, ncz = nz - 1;
  const cellVert = new Int32Array(ncx * ncy * ncz).fill(-1);
  let pos = new Float32Array(4096), np = 0;
  const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
  const cv = new Float32Array(8);
  const sx_ = nx, sz_ = nx * ny;
  for (let k = 0; k < ncz; k++) for (let j = 0; j < ncy; j++) {
    const base = nx * (j + ny * k);
    for (let i = 0; i < ncx; i++) {
      const o = base + i;
      cv[0] = vals[o]; cv[1] = vals[o + 1]; cv[2] = vals[o + sx_]; cv[3] = vals[o + sx_ + 1];
      cv[4] = vals[o + sz_]; cv[5] = vals[o + sz_ + 1]; cv[6] = vals[o + sz_ + sx_]; cv[7] = vals[o + sz_ + sx_ + 1];
      let neg = 0;
      for (let c = 0; c < 8; c++) if (cv[c] < 0) neg++;
      if (neg === 0 || neg === 8) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let e = 0; e < 12; e++) {
        const a = EA[e], b = EB[e], va = cv[a], vb = cv[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t; n++;
      }
      if (np + 3 > pos.length) { const g = new Float32Array(pos.length * 2); g.set(pos); pos = g; }
      cellVert[i + ncx * (j + ncy * k)] = np / 3;
      pos[np++] = min[0] + (i + sx / n) * h; pos[np++] = min[1] + (j + sy / n) * h; pos[np++] = min[2] + (k + sz / n) * h;
    }
  }
  // a quad for every grid edge with a sign change, joining the four cells round it
  let idx = new Uint32Array(8192), ni = 0;
  const cell = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= ncx || j >= ncy || k >= ncz ? -1 : cellVert[i + ncx * (j + ncy * k)]);
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (ni + 6 > idx.length) { const g = new Uint32Array(idx.length * 2); g.set(idx); idx = g; }
    if (flip) { idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d; }
    else { idx[ni++] = a; idx[ni++] = c; idx[ni++] = b; idx[ni++] = a; idx[ni++] = d; idx[ni++] = c; }
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const o = i + nx * (j + ny * k), in0 = vals[o] < 0;
    if (i < ncx && j > 0 && k > 0 && in0 !== (vals[o + 1] < 0)) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), in0);
    if (j < ncy && i > 0 && k > 0 && in0 !== (vals[o + sx_] < 0)) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), in0);
    if (k < ncz && i > 0 && j > 0 && in0 !== (vals[o + sz_] < 0)) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), in0);
  }
  // each vertex's normal and occlusion come from the sampled grid itself (trilinear), so they cost no more evaluations
  const grid = (x, y, z) => {
    let gx = (x - min[0]) / h, gy = (y - min[1]) / h, gz = (z - min[2]) / h;
    gx = clamp(gx, 0, nx - 1.001); gy = clamp(gy, 0, ny - 1.001); gz = clamp(gz, 0, nz - 1.001);
    const i = gx | 0, j = gy | 0, k = gz | 0, fx = gx - i, fy = gy - j, fz = gz - k;
    const o = i + nx * (j + ny * k), sx = 1, sy = nx, sz = nx * ny;
    const c00 = vals[o] * (1 - fx) + vals[o + sx] * fx, c10 = vals[o + sy] * (1 - fx) + vals[o + sy + sx] * fx;
    const c01 = vals[o + sz] * (1 - fx) + vals[o + sz + sx] * fx, c11 = vals[o + sz + sy] * (1 - fx) + vals[o + sz + sy + sx] * fx;
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  };
  const count = np / 3, P = pos.slice(0, np), N = new Float32Array(count * 3), AO = new Float32Array(count), UV = new Float32Array(count * 2);
  const aoStep = opts.aoStep || 0.006, uvScale = opts.uvScale || 0.05, e = h * 0.75;
  for (let v = 0; v < count; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    let gx = grid(x + e, y, z) - grid(x - e, y, z), gy = grid(x, y + e, z) - grid(x, y - e, z), gz = grid(x, y, z + e) - grid(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1; gx /= l; gy /= l; gz /= l;
    N[v * 3] = gx; N[v * 3 + 1] = gy; N[v * 3 + 2] = gz;
    let occ = 0, w = 0.5;
    for (let s = 1; s <= 4; s++) { const t = aoStep * s; occ += w * (t - grid(x + gx * t, y + gy * t, z + gz * t)) / aoStep; w *= 0.5; }
    AO[v] = clamp(1 - occ * 0.9, 0, 1);
    const ax = Math.abs(gx), ay = Math.abs(gy), az = Math.abs(gz);
    if (ax >= ay && ax >= az) { UV[v * 2] = z / uvScale; UV[v * 2 + 1] = y / uvScale; }
    else if (ay >= az) { UV[v * 2] = x / uvScale; UV[v * 2 + 1] = z / uvScale; }
    else { UV[v * 2] = x / uvScale; UV[v * 2 + 1] = y / uvScale; }
  }
  return { position: P, normal: N, ao: AO, uv: UV, index: count > 65535 ? idx.slice(0, ni) : Uint16Array.from(idx.subarray(0, ni)) };
}
