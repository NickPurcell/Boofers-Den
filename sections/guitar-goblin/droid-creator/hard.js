// A small hard-surface mesh kit for the droid creator: everything a droid is made of here is built by these few
// makers, in metres, y up. Unlike the Duros page's sculpted shapes, a droid wants crisp edges, so nothing is meshed
// from a field: panels are laid on curved surfaces with real gaps between them and a bevel round each one, and solid
// parts are lofted or turned with chamfered corners.
//
// Every vertex carries what the paint needs (paint.js): which material it is (its role), how far it is from the
// nearest hard edge, whether that edge is a seam (a panel's border: grime gathers there) or an outside corner (paint
// only chips there), a random number for its part, and flags.
import * as THREE from 'three';

const { sin, cos, PI, hypot, abs, max, min, sign, ceil } = Math;
export const rad = (deg) => (deg * PI) / 180;
export const ROLE = { primary: 0, secondary: 1, metal: 2, dark: 3, brass: 4, rubber: 5, steel: 6 };
export const FLAG = { odd: 1, drop: 2 };   // on a scavenged unit, odd: a panel from another unit; drop: a panel gone missing
const EDGE = 0.008;   // how far in from a hard edge the "near an edge" value runs, in metres
const FAR = 1;        // "nowhere near an edge"

export const M = {
  t: (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z),
  rx: (a) => new THREE.Matrix4().makeRotationX(a),
  ry: (a) => new THREE.Matrix4().makeRotationY(a),
  rz: (a) => new THREE.Matrix4().makeRotationZ(a),
  s: (x, y, z) => new THREE.Matrix4().makeScale(x, y, z),
  mul: (...ms) => ms.reduce((a, b) => a.clone().multiply(b)),
};

/* ---------------- outlines: closed polygons in the local xy plane, counter-clockwise ---------------- */
export function rrect(w, h, r = 0, n = 4, cx = 0, cy = 0) {
  r = min(r, w / 2, h / 2);
  if (r <= 0) return [[cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2], [cx - w / 2, cy - h / 2]];
  const out = [], hx = w / 2 - r, hy = h / 2 - r;
  for (const [sx, sy, a0] of [[1, -1, -PI / 2], [1, 1, 0], [-1, 1, PI / 2], [-1, -1, PI]])
    for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (PI / 2); out.push([cx + sx * hx + r * cos(a), cy + sy * hy + r * sin(a)]); }
  return out;
}
export function ngon(r, n, rot = 0, cx = 0, cy = 0) {
  return Array.from({ length: n }, (_, i) => { const a = rot + (i / n) * 2 * PI; return [cx + r * cos(a), cy + r * sin(a)]; });
}
// pull an outline in by d (out for negative d), mitred at the corners
export function inset(outline, d) {
  const N = outline.length, out = [];
  for (let i = 0; i < N; i++) {
    const p = outline[(i + N - 1) % N], q = outline[i], s = outline[(i + 1) % N];
    let ax = q[1] - p[1], ay = -(q[0] - p[0]), bx = s[1] - q[1], by = -(s[0] - q[0]);
    const la = hypot(ax, ay) || 1, lb = hypot(bx, by) || 1; ax /= la; ay /= la; bx /= lb; by /= lb;
    let mx = ax + bx, my = ay + by; const lm = hypot(mx, my) || 1; mx /= lm; my /= lm;
    const k = d / max(mx * ax + my * ay, 0.35);
    out.push([q[0] - mx * k, q[1] - my * k]);
  }
  return out;
}

/* ---------------- surfaces a panel can lie on ---------------- */
// A surface of revolution about the y axis. `profile(s)` gives [r, y, nr, ny] at s metres along the profile, where
// (nr, ny) is the outward normal in the profile's plane. A panel's u is the angle round the axis (0 is the front, +z;
// positive toward +x) and its v is s.
export function turned(profile, o = {}) {
  const uvR = o.uvR ?? profile(0)[0], uvS = o.uvS ?? 0, deg = o.deg ?? 5;
  return {
    pt(u, s, h, out) {
      const [r, y, nr, ny] = profile(s), rr = r + nr * h, su = sin(u), cu = cos(u);
      out[0] = rr * su; out[1] = y + ny * h; out[2] = rr * cu; out[3] = nr * su; out[4] = ny; out[5] = nr * cu;
      return out;
    },
    su: (s) => max(profile(s)[0], 1e-4),
    stepU: (s) => max(profile(s)[0], 0.03) * rad(deg),
    stepV: o.stepV ?? Infinity,
    uv: (u, s) => [u * uvR, s + uvS],
  };
}
export const profile = {
  cyl: (R, y0 = 0) => (s) => [R, y0 + s, 1, 0],
  cone: (r0, y0, r1, y1) => { const L = hypot(r1 - r0, y1 - y0), dr = (r1 - r0) / L, dy = (y1 - y0) / L; const f = (s) => [r0 + dr * s, y0 + dy * s, dy, -dr]; f.len = L; return f; },
  // part of a sphere of radius R centred at height yc, from the equator (s = 0) up to the pole
  sphere: (R, yc = 0) => { const f = (s) => { const e = s / R; return [R * cos(e), yc + R * sin(e), cos(e), sin(e)]; }; f.len = (R * PI) / 2; return f; },
  // a flat top at height y, from its rim (s = 0) in to the centre
  top: (y, r1) => { const f = (s) => [r1 - s, y, 0, 1]; f.len = r1; return f; },
  // a smooth curve through points [[r, y], ...], walked with the outside on the right. f.sAt(y) gives s at a height
  // (for curves that only climb).
  path: (pts) => {
    const K = pts.length, cum = [0], nrm = [], seg = [];
    for (let i = 0; i < K - 1; i++) { const dr = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1], L = hypot(dr, dy) || 1e-9; seg.push([dy / L, -dr / L]); cum.push(cum[i] + L); }
    for (let i = 0; i < K; i++) { const a = seg[max(i - 1, 0)], b = seg[min(i, K - 2)], x = a[0] + b[0], y = a[1] + b[1], l = hypot(x, y) || 1; nrm.push([x / l, y / l]); }
    const f = (s) => {
      s = max(0, min(cum[K - 1], s)); let i = 0; while (i < K - 2 && cum[i + 1] < s) i++;
      const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1e-9), nx = nrm[i][0] + (nrm[i + 1][0] - nrm[i][0]) * t, ny = nrm[i][1] + (nrm[i + 1][1] - nrm[i][1]) * t, l = hypot(nx, ny) || 1;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, nx / l, ny / l];
    };
    f.len = cum[K - 1];
    f.sAt = (y) => { let i = 0; while (i < K - 2 && pts[i + 1][1] < y) i++; const t = (y - pts[i][1]) / (pts[i + 1][1] - pts[i][1] || 1e-9); return cum[i] + (cum[i + 1] - cum[i]) * max(0, min(1, t)); };
    f.pts = pts;
    return f;
  },
};
// the local xy plane, facing +z: u is x and v is y, both in metres. Put it where it is wanted with the builder's transform.
export const PLANE = {
  pt(u, v, h, out) { out[0] = u; out[1] = v; out[2] = h; out[3] = 0; out[4] = 0; out[5] = 1; return out; },
  su: () => 1, stepU: () => Infinity, stepV: Infinity, uv: (u, v) => [u, v],
};

// where to put grid lines across a panel L wide with corner radius r: close together round the corners, then no
// further apart than `step`, with one on the centre line
const arcSegs = (r) => (r < 0.0015 ? (r > 0 ? 1 : 0) : r < 0.006 ? 2 : r < 0.015 ? 3 : r < 0.04 ? 5 : 8);
function lines(L, r, step, segs) {
  const a = [-L / 2], k = r > 0 && segs ? segs : arcSegs(r);
  for (let i = 1; i <= k; i++) a.push(-L / 2 + (r * i) / k);
  const inner = L - 2 * r;
  if (inner > 1e-5) {
    const n = max(2, 2 * ceil(inner / step / 2));
    for (let i = 1; i < n; i++) a.push(-L / 2 + r + (inner * i) / n);
    for (let i = k; i >= 1; i--) a.push(L / 2 - (r * i) / k);
  } else for (let i = k - 1; i >= 1; i--) a.push(L / 2 - (r * i) / k);
  a.push(L / 2);
  return a;
}

const _t = new Float32Array(6), _p = new THREE.Vector3(), _q = new THREE.Vector3();

export class Builder {
  constructor() {
    this.P = []; this.N = []; this.U = []; this.D = []; this.C = []; this.I = []; this.n = 0;
    this.mat = new THREE.Matrix4(); this.nmat = new THREE.Matrix3(); this.flip = false; this.stack = [];
    this.role = ROLE.primary; this.seed = 0; this.flag = 0; this.color = [1, 1, 1];
    this.kind = 1;   // 1: edges are outside corners (solid parts); 0: edges are seams (panels)
  }
  /* ---- placing things ---- */
  push(m) { this.stack.push([this.mat, this.flip]); this.mat = this.mat.clone().multiply(m); this.nmat.getNormalMatrix(this.mat); this.flip = this.mat.determinant() < 0; return this; }
  pop() { [this.mat, this.flip] = this.stack.pop(); this.nmat.getNormalMatrix(this.mat); return this; }
  at(m, fn) { this.push(m); try { fn(this); } finally { this.pop(); } return this; }
  /* ---- the raw mesh ---- */
  v(x, y, z, nx, ny, nz, u, w, edge = FAR, role = this.role, seed = this.seed, flag = this.flag) {
    _p.set(x, y, z).applyMatrix4(this.mat); _q.set(nx, ny, nz).applyMatrix3(this.nmat).normalize();
    this.P.push(_p.x, _p.y, _p.z); this.N.push(_q.x, _q.y, _q.z); this.U.push(u, w); this.D.push(role + 8 * flag, edge, seed, this.kind);
    this.C.push(this.color[0], this.color[1], this.color[2]);
    return this.n++;
  }
  tri(a, b, c) { if (this.flip) this.I.push(a, c, b); else this.I.push(a, b, c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  get empty() { return this.I.length === 0; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    const uv = new THREE.Float32BufferAttribute(this.U, 2);
    g.setAttribute('uv', uv); g.setAttribute('aUv', uv);
    g.setAttribute('aData', new THREE.Float32BufferAttribute(this.D, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setIndex(this.I);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }

  /* ---- a panel: a rounded rectangle lying on a surface, with a bevelled edge ---- */
  // It covers u0..u1 by v0..v1 less half the gap on each side, stands h proud of the surface, and its edge falls away
  // over `bevel` to `drop` below its face (so a gap between two panels reads as a dark line with two lit edges).
  // wall: { out, dh } replaces that edge: out 0 and dh > 0 makes the floor of a recess with walls up to the surface.
  panel(map, u0, u1, v0, v1, o = {}) {
    const h = o.h ?? 0, gap = o.gap ?? 0.0025, role = o.role ?? this.role, seed = o.seed ?? this.seed, flag = o.flag ?? this.flag;
    const vm = (v0 + v1) / 2, uc = (u0 + u1) / 2, su = map.su(vm);
    const W = abs(u1 - u0) * su - gap, H = abs(v1 - v0) - gap;
    if (W < 0.0008 || H < 0.0008) return null;
    const r = min(o.rad ?? 0.004, W / 2, H / 2), hx = W / 2 - r, hy = H / 2 - r;
    const xs = lines(W, r, map.stepU(vm), o.cornerSegs), ys = lines(H, r, map.stepV, o.cornerSegs), nx = xs.length, ny = ys.length, base = this.n;
    const X = new Float32Array(nx * ny), Y = new Float32Array(nx * ny), useEdge = o.edge !== false, kind = this.kind;
    this.kind = o.solid ? 1 : 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let x = xs[i], y = ys[j], px = abs(x) - hx, py = abs(y) - hy;
      if (r > 0 && px > 0 && py > 0) { const m = max(px, py) / hypot(px, py); x = sign(x) * (hx + px * m); y = sign(y) * (hy + py * m); px = abs(x) - hx; py = abs(y) - hy; }
      X[j * nx + i] = x; Y[j * nx + i] = y;
      const d = -(hypot(max(px, 0), max(py, 0)) + min(max(px, py), 0) - r), u = uc + x / su, v = vm + y;
      map.pt(u, v, h, _t);
      const w = o.uv01 ? [x / W + 0.5, y / H + 0.5] : map.uv(u, v);
      this.v(_t[0], _t[1], _t[2], _t[3], _t[4], _t[5], w[0], w[1], useEdge ? max(d, 0) : FAR, role, seed, flag);
    }
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = base + j * nx + i; this.quad(a, a + 1, a + nx + 1, a + nx); }
    const wall = o.wall === null ? null : o.wall || { out: o.bevel ?? 0.0012, dh: -(o.drop ?? 0.005) };
    if (wall) {
      const ring = [];
      for (let i = 0; i < nx; i++) ring.push(i);
      for (let j = 1; j < ny; j++) ring.push(j * nx + nx - 1);
      for (let i = nx - 2; i >= 0; i--) ring.push((ny - 1) * nx + i);
      for (let j = ny - 2; j >= 1; j--) ring.push(j * nx);
      const m = ring.length, A = new Float32Array(m * 3), B = new Float32Array(m * 3), UV = [];
      for (let k = 0; k < m; k++) {
        const x = X[ring[k]], y = Y[ring[k]], px = abs(x) - hx, py = abs(y) - hy;
        let ox, oy;
        if (px > 1e-7 && py > 1e-7) { const l = hypot(px, py); ox = (sign(x) * px) / l; oy = (sign(y) * py) / l; }
        else if (px > py) { ox = sign(x); oy = 0; } else { ox = 0; oy = sign(y); }
        const u = uc + x / su, v = vm + y;
        map.pt(u, v, h, _t); A.set([_t[0], _t[1], _t[2]], k * 3);
        map.pt(u + (ox * wall.out) / su, v + oy * wall.out, h + wall.dh, _t); B.set([_t[0], _t[1], _t[2]], k * 3);
        UV.push(o.uv01 ? [x / W + 0.5, y / H + 0.5] : map.uv(u, v));
      }
      const ia = [], ib = [];
      for (let k = 0; k < m; k++) {
        const kn = (k + 1) % m, kp = (k + m - 1) % m;
        const tx = A[kn * 3] - A[kp * 3], ty = A[kn * 3 + 1] - A[kp * 3 + 1], tz = A[kn * 3 + 2] - A[kp * 3 + 2];
        const wx = B[k * 3] - A[k * 3], wy = B[k * 3 + 1] - A[k * 3 + 1], wz = B[k * 3 + 2] - A[k * 3 + 2];
        const nxx = wy * tz - wz * ty, nyy = wz * tx - wx * tz, nzz = wx * ty - wy * tx;
        ia.push(this.v(A[k * 3], A[k * 3 + 1], A[k * 3 + 2], nxx, nyy, nzz, UV[k][0], UV[k][1], 0, role, seed, flag));
        ib.push(this.v(B[k * 3], B[k * 3 + 1], B[k * 3 + 2], nxx, nyy, nzz, UV[k][0], UV[k][1], 0, role, seed, flag));
      }
      for (let k = 0; k < m; k++) { const kn = (k + 1) % m; this.quad(ia[k], ib[k], ib[kn], ia[kn]); }
    }
    this.kind = kind;
    return { uc, vm, W, H, su };
  }

  /* ---- a frame: a panel with a hole in it (a bezel, a vent's surround, a skin panel round a recess) ---- */
  // O and Hh are [u0, u1, v0, v1] for the outside and the hole. The outside edge is bevelled like a panel's; the
  // hole's wall drops straight down by holeDrop.
  frame(map, O, Hh, o = {}) {
    const h = o.h ?? 0, gap = o.gap ?? 0.0025, role = o.role ?? this.role, seed = o.seed ?? this.seed, flag = o.flag ?? this.flag;
    const vm = (O[2] + O[3]) / 2, uc = (O[0] + O[1]) / 2, su = map.su(vm);
    const ox0 = (O[0] - uc) * su + gap / 2, ox1 = (O[1] - uc) * su - gap / 2, oy0 = O[2] - vm + gap / 2, oy1 = O[3] - vm - gap / 2;
    const hx0 = (Hh[0] - uc) * su, hx1 = (Hh[1] - uc) * su, hy0 = Hh[2] - vm, hy1 = Hh[3] - vm;
    if (ox1 - ox0 < 0.001 || oy1 - oy0 < 0.001 || hx1 - hx0 < 0.0005 || hy1 - hy0 < 0.0005) return null;
    const ro = min(o.rad ?? 0.004, (ox1 - ox0) / 2, (oy1 - oy0) / 2), rh = min(o.holeRad ?? 0.003, (hx1 - hx0) / 2, (hy1 - hy0) / 2);
    const kc = max(o.cornerSegs ?? 0, arcSegs(max(ro, rh)), 1), nU = max(1, ceil((ox1 - ox0) / map.stepU(vm))), nV = map.stepV === Infinity ? 1 : max(1, ceil((oy1 - oy0) / map.stepV));
    const outline = (x0, x1, y0, y1, r) => {
      const pts = [], cs = [[x1 - r, y0 + r, -PI / 2], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, PI / 2], [x0 + r, y0 + r, PI]], side = [nV, nU, nV, nU];
      for (let c = 0; c < 4; c++) {
        const [cx, cy, a0] = cs[c];
        for (let i = 0; i <= kc; i++) { const a = a0 + (i / kc) * (PI / 2); pts.push([cx + r * cos(a), cy + r * sin(a), cos(a), sin(a)]); }
        const [nx_, ny_, na] = cs[(c + 1) % 4], ex = cx + r * cos(a0 + PI / 2), ey = cy + r * sin(a0 + PI / 2), fx = nx_ + r * cos(na), fy = ny_ + r * sin(na);
        for (let i = 1; i < side[c]; i++) pts.push([ex + ((fx - ex) * i) / side[c], ey + ((fy - ey) * i) / side[c], cos(a0 + PI / 2), sin(a0 + PI / 2)]);
      }
      return pts;
    };
    const Op = outline(ox0, ox1, oy0, oy1, ro), Hp = outline(hx0, hx1, hy0, hy1, rh), N = Op.length;
    let wmax = 0; const wd = Op.map((p, i) => { const w = hypot(p[0] - Hp[i][0], p[1] - Hp[i][1]); wmax = max(wmax, w); return w; });
    const nr = max(1, ceil(wmax / map.stepU(vm))), kind = this.kind, base = this.n, S = nr + 3;
    this.kind = o.solid ? 1 : 0;
    const uvOf = (x, y, u, v) => (o.uv01 ? [(x - ox0) / (ox1 - ox0), (y - oy0) / (oy1 - oy0)] : map.uv(u, v));
    for (let i = 0; i < N; i++) {
      const w = wd[i], a = min(EDGE, w / 3) / max(w, 1e-6);
      for (let s = 0; s < S; s++) {
        const t = s === 0 ? 0 : s === S - 1 ? 1 : a + ((1 - 2 * a) * (s - 1)) / nr;
        const x = Op[i][0] + (Hp[i][0] - Op[i][0]) * t, y = Op[i][1] + (Hp[i][1] - Op[i][1]) * t, u = uc + x / su, v = vm + y;
        map.pt(u, v, h, _t); const q = uvOf(x, y, u, v);
        this.v(_t[0], _t[1], _t[2], _t[3], _t[4], _t[5], q[0], q[1], w * min(t, 1 - t), role, seed, flag);
      }
    }
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; for (let s = 0; s < S - 1; s++) this.quad(base + i * S + s, base + j * S + s, base + j * S + s + 1, base + i * S + s + 1); }
    // the walls: the outside edge falls away outward, the hole's drops straight down
    const wall = o.wall === null ? null : o.wall || { out: o.bevel ?? 0.0012, dh: -(o.drop ?? 0.005) }, holeDrop = o.holeDrop ?? 0.005;
    for (const inner of [false, true]) {
      if (inner ? holeDrop <= 0 : !wall) continue;
      const src = inner ? Hp : Op, A = [], B = [], UV = [];
      for (let k = 0; k < N; k++) {
        const [x, y, nx_, ny_] = src[k], u = uc + x / su, v = vm + y, out = inner ? 0 : wall.out, dh = inner ? -holeDrop : wall.dh;
        map.pt(u, v, h, _t); A.push([_t[0], _t[1], _t[2]]);
        map.pt(u + (nx_ * out) / su, v + ny_ * out, h + dh, _t); B.push([_t[0], _t[1], _t[2]]);
        UV.push(uvOf(x, y, u, v));
      }
      const ia = [], ib = [];
      for (let k = 0; k < N; k++) {
        const kn = (k + 1) % N, kp = (k + N - 1) % N, sg = inner ? -1 : 1;
        const tx = A[kn][0] - A[kp][0], ty = A[kn][1] - A[kp][1], tz = A[kn][2] - A[kp][2], wx = B[k][0] - A[k][0], wy = B[k][1] - A[k][1], wz = B[k][2] - A[k][2];
        const nx_ = sg * (wy * tz - wz * ty), ny_ = sg * (wz * tx - wx * tz), nz_ = sg * (wx * ty - wy * tx);
        ia.push(this.v(A[k][0], A[k][1], A[k][2], nx_, ny_, nz_, UV[k][0], UV[k][1], 0, role, seed, flag));
        ib.push(this.v(B[k][0], B[k][1], B[k][2], nx_, ny_, nz_, UV[k][0], UV[k][1], 0, role, seed, flag));
      }
      for (let k = 0; k < N; k++) { const kn = (k + 1) % N; if (inner) this.quad(ia[k], ia[kn], ib[kn], ib[k]); else this.quad(ia[k], ib[k], ib[kn], ia[kn]); }
    }
    this.kind = kind;
    return { uc, vm, su };
  }

  /* ---- a turned part: a profile [[r, y], ...] swept round the y axis ---- */
  // The outside is on the right as the profile is walked. Corners are hard unless o.smooth says otherwise (true, or
  // one flag per point).
  lathe(pts, o = {}) {
    const segs = o.segs ?? 64, a0 = o.a0 ?? 0, a1 = o.a1 ?? 2 * PI, role = o.role ?? this.role, wear = o.wear !== false;
    const isSmooth = (i) => (Array.isArray(o.smooth) ? !!o.smooth[i] : !!o.smooth);
    const uvR = o.uvR ?? pts.reduce((m, p) => max(m, p[0]), 0.01), K = pts.length;
    const sn = [];
    for (let k = 0; k < K - 1; k++) { const dr = pts[k + 1][0] - pts[k][0], dy = pts[k + 1][1] - pts[k][1], L = hypot(dr, dy); sn.push(L > 1e-9 ? [dy / L, -dr / L, L] : null); }
    const nAt = (i, own) => {
      if (!isSmooth(i)) return own;
      const p = i > 0 ? sn[i - 1] : null, q = i < K - 1 ? sn[i] : null;
      if (!p || !q) return own;
      const x = p[0] + q[0], y = p[1] + q[1], l = hypot(x, y) || 1; return [x / l, y / l];
    };
    let s = o.uvS ?? 0;
    for (let k = 0; k < K - 1; k++) {
      const n = sn[k]; if (!n) continue;
      const L = n[2], [r0, y0] = pts[k], [r1, y1] = pts[k + 1], na = nAt(k, n), nb = nAt(k + 1, n);
      const ea = isSmooth(k) || !wear ? FAR : 0, eb = isSmooth(k + 1) || !wear ? FAR : 0, st = [[0, ea]];
      if (wear && L > 3 * EDGE) { if (!isSmooth(k)) st.push([EDGE / L, EDGE]); if (!isSmooth(k + 1)) st.push([1 - EDGE / L, EDGE]); }
      st.push([1, eb]);
      let prev = -1;
      for (const [t, e] of st) {
        const r = r0 + (r1 - r0) * t, y = y0 + (y1 - y0) * t;
        let nr = na[0] + (nb[0] - na[0]) * t, ny = na[1] + (nb[1] - na[1]) * t; const l = hypot(nr, ny) || 1; nr /= l; ny /= l;
        const ring = this.n;
        for (let i = 0; i <= segs; i++) { const a = a0 + ((a1 - a0) * i) / segs, sa = sin(a), ca = cos(a); this.v(r * sa, y, r * ca, nr * sa, ny, nr * ca, a * uvR, s + t * L, e, role); }
        if (prev >= 0) {
          const rp = pts[k][0] + (r1 - r0) * this._lt;
          for (let i = 0; i < segs; i++) {
            const a = prev + i, b = prev + i + 1, c = ring + i + 1, d = ring + i;
            if (rp > 1e-7) this.tri(a, b, c);
            if (r > 1e-7) this.tri(a, c, d);
          }
        }
        prev = ring; this._lt = t;
      }
      s += L;
    }
    return this;
  }

  /* ---- a lofted part: outlines at heights along local z, joined by walls, capped at both ends ---- */
  // secs: [{ o: outline, z }], every outline with the same number of points, counter-clockwise seen from +z.
  loft(secs, o = {}) {
    const role = o.role ?? this.role, N = secs[0].o.length, E = o.edgeIn ?? EDGE, wear = o.wear !== false;
    // which corners of the outline are hard, judged on the widest section
    let big = secs[0]; const span = (s) => { let a = 1e9, b = -1e9; for (const p of s.o) { a = min(a, p[0]); b = max(b, p[0]); } return b - a; };
    for (const s of secs) if (span(s) > span(big)) big = s;
    const hardAt = [];
    for (let i = 0; i < N; i++) {
      const p = big.o[(i + N - 1) % N], q = big.o[i], r = big.o[(i + 1) % N];
      const ax = q[0] - p[0], ay = q[1] - p[1], bx = r[0] - q[0], by = r[1] - q[1], la = hypot(ax, ay), lb = hypot(bx, by);
      hardAt.push(o.smooth ? false : la < 1e-9 || lb < 1e-9 ? false : (ax * bx + ay * by) / (la * lb) < 0.76);
    }
    let zuv = 0;
    for (let b = 0; b < secs.length - 1; b++) {
      const A = secs[b], Cc = secs[b + 1];
      let Lb = 0; for (let i = 0; i < N; i++) Lb += hypot(Cc.o[i][0] - A.o[i][0], Cc.o[i][1] - A.o[i][1], Cc.z - A.z); Lb /= N;
      if (Lb < 1e-7) continue;
      const st = wear && Lb > 3 * E ? [[0, 0], [E / Lb, E], [1 - E / Lb, E], [1, 0]] : [[0, wear ? 0 : FAR], [1, wear ? 0 : FAR]];
      // the wall's normal on each edge of the outline
      const fn = [];
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        let ex = A.o[j][0] - A.o[i][0], ey = A.o[j][1] - A.o[i][1];
        const fx = Cc.o[j][0] - Cc.o[i][0], fy = Cc.o[j][1] - Cc.o[i][1];
        if (hypot(fx, fy) > hypot(ex, ey)) { ex = fx; ey = fy; }
        const bx = (Cc.o[i][0] - A.o[i][0] + Cc.o[j][0] - A.o[j][0]) / 2, by = (Cc.o[i][1] - A.o[i][1] + Cc.o[j][1] - A.o[j][1]) / 2, bz = Cc.z - A.z;
        let x = ey * bz, y = -ex * bz, z = ex * by - ey * bx; const l = hypot(x, y, z) || 1;
        fn.push([x / l, y / l, z / l]);
      }
      let perim = 0;
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N, len = hypot(big.o[j][0] - big.o[i][0], big.o[j][1] - big.o[i][1]);
        if (len < 1e-9) continue;
        const ni = hardAt[i] ? fn[i] : avg(fn[(i + N - 1) % N], fn[i]), nj = hardAt[j] ? fn[i] : avg(fn[i], fn[j]);
        const cols = [[0, hardAt[i] && wear ? 0 : FAR]];
        if (wear && len > 3 * E) { if (hardAt[i]) cols.push([E / len, E]); if (hardAt[j]) cols.push([1 - E / len, E]); }
        cols.push([1, hardAt[j] && wear ? 0 : FAR]);
        const base = this.n, nc = cols.length;
        for (const [t, ez] of st) for (const [c, ep] of cols) {
          const ax = A.o[i][0] + (A.o[j][0] - A.o[i][0]) * c, ay = A.o[i][1] + (A.o[j][1] - A.o[i][1]) * c;
          const bx = Cc.o[i][0] + (Cc.o[j][0] - Cc.o[i][0]) * c, by = Cc.o[i][1] + (Cc.o[j][1] - Cc.o[i][1]) * c;
          this.v(ax + (bx - ax) * t, ay + (by - ay) * t, A.z + (Cc.z - A.z) * t,
            ni[0] + (nj[0] - ni[0]) * c, ni[1] + (nj[1] - ni[1]) * c, ni[2] + (nj[2] - ni[2]) * c,
            perim + c * len, zuv + t * Lb, min(ez, ep), role);
        }
        for (let a = 0; a < st.length - 1; a++) for (let c = 0; c < nc - 1; c++) { const q = base + a * nc + c; this.quad(q, q + 1, q + nc + 1, q + nc); }
        perim += len;
      }
      zuv += Lb;
    }
    if (o.cap0 !== false) this._cap(secs[0].o, secs[0].z, false, E, role, wear);
    if (o.cap1 !== false) this._cap(secs[secs.length - 1].o, secs[secs.length - 1].z, true, E, role, wear);
    return this;
  }
  _cap(outline, z, up, E, role, wear) {
    const N = outline.length, nz = up ? 1 : -1;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const p of outline) { x0 = min(x0, p[0]); x1 = max(x1, p[0]); y0 = min(y0, p[1]); y1 = max(y1, p[1]); }
    if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return;
    const small = min(x1 - x0, y1 - y0) < 4 * E;
    const put = (pl, e) => pl.map((p) => this.v(p[0], p[1], z, 0, 0, nz, p[0], p[1], wear ? e : FAR, role));
    const tri3 = (a, b, c, pa, pb, pc) => {
      const area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      if (abs(area) < 1e-12) return;
      if (area > 0 === up) this.tri(a, b, c); else this.tri(a, c, b);
    };
    let inner = outline, ii;
    if (small) ii = put(outline, E / 2);
    else {
      inner = inset(outline, E);
      const io = put(outline, 0); ii = put(inner, E);
      for (let i = 0; i < N; i++) { const j = (i + 1) % N; tri3(io[i], io[j], ii[j], outline[i], outline[j], inner[j]); tri3(io[i], ii[j], ii[i], outline[i], inner[j], inner[i]); }
    }
    const faces = THREE.ShapeUtils.triangulateShape(inner.map((p) => new THREE.Vector2(p[0], p[1])), []);
    for (const [a, b, c] of faces) tri3(ii[a], ii[b], ii[c], inner[a], inner[b], inner[c]);
  }
  // a prism with chamfered ends: the outline pushed from z0 to z1
  prism(outline, z0, z1, o = {}) {
    const c = min(o.bevel ?? 0.0015, (z1 - z0) / 2.2), c0 = o.bevel0 ?? c, c1 = o.bevel1 ?? c, secs = [];
    if (c0 > 0) secs.push({ o: inset(outline, c0), z: z0 });
    secs.push({ o: outline, z: z0 + c0 }, { o: outline, z: z1 - c1 });
    if (c1 > 0) secs.push({ o: inset(outline, c1), z: z1 });
    return this.loft(secs, o);
  }
  // a block w by h by d, centred, with rounded upright corners (rad) and chamfered front and back
  box(w, h, d, o = {}) { return this.prism(rrect(w, h, o.rad ?? 0, o.n ?? 3), -d / 2, d / 2, o); }
  // a cylinder along local z
  cyl(r, z0, z1, o = {}) { return this.prism(ngon(r, o.n ?? 20, PI / (o.n ?? 20)), z0, z1, o); }
  // a ball, turned about local y
  ball(R, o = {}) {
    const n = o.n ?? 8, pts = [];
    for (let i = 0; i <= n; i++) { const e = -PI / 2 + (PI * i) / n; pts.push([i === 0 || i === n ? 0 : R * cos(e), R * sin(e)]); }
    return this.lathe(pts, { segs: o.segs ?? 16, smooth: true, wear: false, role: o.role });
  }
  // a hose through the points
  tube(points, r, o = {}) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    const n = o.n ?? (points.length - 1) * 6, sides = o.sides ?? 8, fr = curve.computeFrenetFrames(n, false), role = o.role ?? this.role, base = this.n;
    for (let i = 0; i <= n; i++) {
      const c = curve.getPointAt(i / n), Nn = fr.normals[i], Bn = fr.binormals[i];
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * 2 * PI, x = cos(a) * Nn.x + sin(a) * Bn.x, y = cos(a) * Nn.y + sin(a) * Bn.y, z = cos(a) * Nn.z + sin(a) * Bn.z;
        this.v(c.x + r * x, c.y + r * y, c.z + r * z, x, y, z, (k / sides) * 2 * PI * r, (i / n) * curve.getLength(), FAR, role);
      }
    }
    for (let i = 0; i < n; i++) for (let k = 0; k < sides; k++) { const a = base + i * (sides + 1) + k; this.quad(a, a + 1, a + sides + 2, a + sides + 1); }
    return this;
  }
}
function avg(a, b) { const x = a[0] + b[0], y = a[1] + b[1], z = a[2] + b[2], l = hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }

// the builders for one moving piece of a droid: the painted mesh, dark lenses, lit parts, logic displays, clear
// parts, and where its lights' halos go
const _h = new THREE.Vector3();
export class Kit {
  constructor() { this.main = new Builder(); this.glass = new Builder(); this.glow = new Builder(); this.logic = new Builder(); this.clear = new Builder(); this.halos = []; }
  get all() { return [this.main, this.glass, this.glow, this.logic, this.clear]; }
  // place everything made inside fn, whichever builder makes it
  at(m, fn) { for (const b of this.all) b.push(m); try { fn(this); } finally { for (const b of this.all) b.pop(); } return this; }
  // a halo at point p facing along n (a zero n shines every way), given in the frame things are being made in
  halo(p, n, color, size) {
    _h.set(p[0], p[1], p[2]).applyMatrix4(this.main.mat); const q = [_h.x, _h.y, _h.z];
    _h.set(n[0], n[1], n[2]); if (_h.lengthSq() > 0) _h.transformDirection(this.main.mat);
    this.halos.push({ p: q, n: [_h.x, _h.y, _h.z], color, size });
  }
}

// a random number source that gives the same run for the same seed, so a link rebuilds the same unit
export function rng(seed) {
  let a = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// What the maker of a fitting needs: the kit, the surface it sits on, the paint scheme and the dice. Rectangles are
// [u0, u1, v0, v1] on the surface.
export function context(K, map, scheme, rnd) {
  const t = new Float32Array(6);
  return {
    K, map, rnd,
    role: (tag, at = {}) => scheme.role(tag, at),
    size: (r) => [(r[1] - r[0]) * map.su((r[2] + r[3]) / 2), r[3] - r[2]],
    // a rectangle given in metres from the centre of r
    sub: (r, x0, x1, y0, y1) => { const uc = (r[0] + r[1]) / 2, vc = (r[2] + r[3]) / 2, su = map.su(vc); return [uc + x0 / su, uc + x1 / su, vc + y0, vc + y1]; },
    point: (u, v, h = 0) => { map.pt(u, v, h, t); return [[t[0], t[1], t[2]], [t[3], t[4], t[5]]]; },
    halo(r, color, size) { const [p, n] = this.point((r[0] + r[1]) / 2, (r[2] + r[3]) / 2, 0.004); K.halo(p, n, color, size); },
    // a frame of reference seated on the surface at (u, v): local z out along the normal, local y up the surface
    seat(u, v, h = 0) {
      const [p, n] = this.point(u, v, h), [q] = this.point(u, v + 0.002, h);
      const N = new THREE.Vector3(...n), Y = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize(), X = new THREE.Vector3().crossVectors(Y, N).normalize();
      Y.crossVectors(N, X);
      return new THREE.Matrix4().makeBasis(X, Y, N).setPosition(p[0], p[1], p[2]);
    },
  };
}
