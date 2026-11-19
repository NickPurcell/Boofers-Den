// Hair on the human base (../human-base/base.js), as shapes: no three.js here, so a worker could build it too.
//
// A style is a hairline (a height for each angle round the head), a volume (how far the hair stands off the scalp at
// each point) and, for styles worn in locks, the comb's direction. It is built in the head's own frame (metres from the
// middle of the skull at eye height, y up, +z forward), the frame the earlier humanoid page's hair was tuned in, scaled
// to this head. Every point of the hair is bound once to a triangle of the base mesh in its rest shape (barycentric
// weights), so after any reshape it is rebuilt from the live skin: the skin point plus its normal times the hair's
// height there. Nothing is remeshed when the figure changes.
//
// The locks follow a published recipe for stylised hair in three.js, weighed as a method (the "img2threejs" skill's
// hair guide, Apache-2.0): each lock a ribbon carried along a smooth path with frames that do not flip, its width
// tapering 1 -> 0.8 -> 0.4 -> a point and its thickness 1 -> 0.75 -> 0.35 -> nearly nothing, its root sunk into a base
// that carries most of the volume. The numbers for the taper are adapted from it; the code is our own.
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function strands(u, n) { const t = u * n, i = Math.floor(t), w = 0.5 + 0.35 * (hash(i) - 0.5), f = t - i, d = f < w ? f / w : (1 - f) / (1 - w); return 1 - Math.pow(d, 0.55); }   // 0 on a lock's crest, 1 between
const hash = (i, j = 0) => { const s = Math.sin(i * 127.1 + j * 311.7 + 7.7) * 43758.5453; return s - Math.floor(s); };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// the hairline as hair grows (a little uneven): across the forehead, down the temple to the sideburn, up behind the ear
// and down to the nape; heights in metres from the eye line, angle 0 the front, positive toward the figure's left
export function hairline(a, wob = 0.5) {
  const b = Math.abs(a), w = b < 1.3 ? wob * (0.0026 * Math.sin(a * 19 + 0.7) + 0.0019 * Math.sin(a * 37 + 1.3)) : 0;
  if (b < 0.75) return 0.071 - 0.012 * (b / 0.75) ** 2 + w;
  if (b < 1.2) return 0.059 - 0.05 * ((b - 0.75) / 0.45) + w;
  if (b < 1.42) return 0.009 - 0.04 * ((b - 1.2) / 0.22);
  if (b < 1.9) return -0.031 + 0.045 * Math.sqrt((b - 1.42) / 0.48);
  return 0.014 - 0.075 * ((b - 1.9) / 1.24);
}
// combed lines: deep grooves between clumps of different widths, shallow within (u runs across the way the hair lies)
const locksOf = (u, n) => 0.42 * strands(u, n) * (0.5 + hash(Math.floor(u * n) + 71)) + 0.85 * strands(u + 0.137, n * 0.29);
const backU = (x, y) => Math.atan2(x, y - 0.03) / (2 * Math.PI) + 0.5;   // lines combed straight back
const capLine = (a) => hairline(a, 0.5);
export const STYLES = {
  bald: { name: 'Bald' },
  // shaved: a shadow of hair a fraction of a millimetre off the scalp (drawn see-through, as stubble is)
  shaved: { name: 'Shaved', line: capLine, ramp: 0.004, floor: 0.7, depth: 0, thick: () => 0.0008, stubble: true },
  // a crest: a strip over the top of the head from the brow to the nape, standing up along the middle and combed back,
  // the sides shaved
  crest: { name: 'Crest', line: (a) => { const sa = Math.abs(Math.sin(a)), w = 0.03, R = 0.095; return sa * R > w ? Math.max(hairline(a, 0.3), 0.03 + Math.sqrt(Math.max(0, R * R - (w / Math.max(sa, 1e-3)) ** 2))) : hairline(a, 0.3); },
    ramp: 0.008, floor: 0.3, depth: 0.007, under: 'shaved',
    // (standing up along the middle, tapering to the sides; combed into tufts from front to back)
    thick: (x, y, z) => 0.004 + 0.026 * Math.pow(Math.max(0, 1 - (x / 0.032) ** 2), 0.7) * sstep(-0.04, 0.05, y), groove: (x, y, z) => 0.6 * strands(Math.atan2(z + 0.012, y - 0.03) / (2 * Math.PI) + 0.5, 16) + 0.4 * strands(x * 8 + 0.5, 3) },
  crop: { name: 'Short crop', line: capLine, ramp: 0.022, floor: 0.16, depth: 0.0022,
    thick: (x, y, z) => 0.0065 + 0.006 * sstep(0.03, 0.09, y) + 0.004 * sstep(0.02, 0.07, z) * sstep(0.05, 0.08, y), groove: (x, y) => locksOf(backU(x, y), 54) / 1.27 },
  swept: { name: 'Swept back', line: capLine, ramp: 0.022, floor: 0.16, depth: 0.0034,
    thick: (x, y, z) => 0.009 + 0.011 * sstep(0.035, 0.1, y) + 0.008 * sstep(0.03, 0.075, z) * sstep(0.05, 0.085, y) - 0.003 * sstep(0.04, 0.075, Math.abs(x)) * (1 - sstep(0.06, 0.1, y)), groove: (x, y) => locksOf(backU(x, y), 38) / 1.27 },
  // tied back: a close cap combed back, and the hair gathered behind (a mass of its own, set in the head's frame)
  tail: { name: 'Tail', line: capLine, ramp: 0.022, floor: 0.16, depth: 0.0026, mass: 'tail',
    thick: (x, y, z) => 0.0075 + 0.005 * sstep(0.03, 0.09, y), groove: (x, y) => locksOf(backU(x, y), 44) / 1.27 },
  knot: { name: 'Topknot', line: capLine, ramp: 0.022, floor: 0.16, depth: 0.0026, mass: 'knot',
    thick: (x, y, z) => 0.0075 + 0.005 * sstep(0.03, 0.09, y), groove: (x, y) => locksOf(backU(x, y), 44) / 1.27 },
  braid: { name: 'Long braid', line: capLine, ramp: 0.022, floor: 0.16, depth: 0.0026, mass: 'braid',
    thick: (x, y, z) => 0.0075 + 0.005 * sstep(0.03, 0.09, y), groove: (x, y) => locksOf(backU(x, y), 44) / 1.27 },
  slick: {
    name: 'Slicked back', locks: true, gloss: true,
    // a clean line: a little lower at the front, short sideburns that stop level with the eyes, an arch over each ear,
    // and a rounded nape
    line: (a) => { const b = Math.abs(a), ear = b > 1.44 && b < 2.04 ? 0.03 * (1 - ((b - 1.74) / 0.3) ** 2) : -1; return Math.max(b < 1.9 ? Math.max(hairline(a, 0.12) - 0.009 * Math.max(0, 1 - b / 1.1), -0.004) : 0.014 - 0.08 * Math.sin(Math.min(1, (b - 1.9) / 1.0) * Math.PI / 2), ear); },
    // fullest on top and a little raised at the front, close at the sides and the nape
    thick: (x, y, z) => 0.0042 + 0.0125 * sstep(0.035, 0.1, y) * (1 - 0.55 * sstep(0.03, 0.065, Math.abs(x))) + 0.004 * sstep(0.03, 0.07, z) * sstep(0.055, 0.09, y) + 0.0025 * sstep(-0.02, -0.08, z) * sstep(-0.03, 0.04, y),
    ramp: 0.009, floor: 0.35,   // the hair rises out of the skin over 9 mm from the line, starting at 35 % of its height
    comb: [0, -0.42, -1],       // combed back, and down where the skull turns down
    // comb lines in the base too, where no lock lies (behind the crown): lines round the front-to-back axis
    groove: (x, y) => { const u = Math.atan2(x, y - 0.03) / (2 * Math.PI) + 0.5; return 0.65 * strands(u, 18) + 0.35 * strands(u + 0.013, 54); }, depth: 0.0017,
  },
};
const BASE = 0.72;   // the share of the volume the base carries under the locks

// the rest shape in metres, feet on the floor, with normals, and the head's frame from the eye helpers
export function restShape(base, surface) {
  const R = surface.rest, n = R.length / 3, P = new Float32Array(R.length);
  let lo = Infinity; for (let i = 1; i < base.rest.length; i += 3) if (base.inBody[(i - 1) / 3]) lo = Math.min(lo, base.rest[i]);
  for (let i = 0; i < n; i++) { P[i * 3] = R[i * 3] * 0.1; P[i * 3 + 1] = (R[i * 3 + 1] - lo) * 0.1; P[i * 3 + 2] = R[i * 3 + 2] * 0.1; }
  const eye = (s) => { const c = [0, 0, 0], L = base.info.eyes[s]; for (const i of L) { c[0] += base.rest[i * 3] * 0.1 / L.length; c[1] += (base.rest[i * 3 + 1] - lo) * 0.1 / L.length; c[2] += base.rest[i * 3 + 2] * 0.1 / L.length; } return c; };
  return { position: P, normal: normals(P, surface.index), index: surface.index, eyes: { l: eye('l'), r: eye('r') } };
}
export function normals(p, idx, out = new Float32Array(p.length)) {
  out.fill(0);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3, ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz; out[b] += nx; out[b + 1] += ny; out[b + 2] += nz; out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) { const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1; out[i] /= l; out[i + 1] /= l; out[i + 2] /= l; }
  return out;
}
// the head's frame on the rest shape: from the eyes and the skull's front and back a little above them
function headFrame(sh) {
  const P = sh.position, e = sh.eyes, ey = (e.l[1] + e.r[1]) / 2, ez = (e.l[2] + e.r[2]) / 2, gap = Math.abs(e.l[0] - e.r[0]);
  let zf = -Infinity, zb = Infinity, top = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    if (Math.abs(x) < 0.012 && Math.abs(y - (ey + 0.035)) < 0.006) { zf = Math.max(zf, z); zb = Math.min(zb, z); }
    if (Math.abs(x) < 0.03 && Math.abs(z - ez) < 0.2 && y > ey) top = Math.max(top, y);
  }
  return { o: [0, ey, (zf + zb) / 2], s: gap / 0.0644, sy: (top - ey) / 0.121 };   // against the old head: eyes 64.4 mm apart, crown 121 mm above them
}
// rays from one point C against the mesh: the triangles binned by the directions they cover as seen from C, so a ray
// tests only those in its bin
export function caster(P, I, C, near, BT = 72, BA = 144) {
  const bins = Array.from({ length: BT * BA }, () => []);
  const dirOf = (i) => { const x = P[i * 3] - C[0], y = P[i * 3 + 1] - C[1], z = P[i * 3 + 2] - C[2], r = Math.hypot(x, y, z) || 1; return [Math.acos(Math.max(-1, Math.min(1, y / r))), Math.atan2(x, z)]; };
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2]; if (!near(P[a * 3], P[a * 3 + 1], P[a * 3 + 2])) continue;
    const ds = [dirOf(a), dirOf(b), dirOf(c)], th0 = Math.min(ds[0][0], ds[1][0], ds[2][0]), th1 = Math.max(ds[0][0], ds[1][0], ds[2][0]);
    let as = ds.map((d) => d[1]); if (Math.max(...as) - Math.min(...as) > Math.PI) as = as.map((v) => (v < 0 ? v + 2 * Math.PI : v));
    const i0 = Math.max(0, Math.floor(th0 / Math.PI * BT) - 1), i1 = Math.min(BT - 1, Math.floor(th1 / Math.PI * BT) + 1), pole = th0 < 0.12;   // near the crown every direction round is close
    const j0 = pole ? 0 : Math.floor((Math.min(...as) + Math.PI) / (2 * Math.PI) * BA) - 1, j1 = pole ? BA - 1 : Math.floor((Math.max(...as) + Math.PI) / (2 * Math.PI) * BA) + 1;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) bins[i * BA + ((j % BA) + BA) % BA].push(t);
  }
  return (d) => {
    const th = Math.acos(Math.max(-1, Math.min(1, d[1]))), a = Math.atan2(d[0], d[2]), list = bins[Math.min(BT - 1, Math.floor(th / Math.PI * BT)) * BA + Math.min(BA - 1, Math.floor((a + Math.PI) / (2 * Math.PI) * BA))];
    let best = Infinity, hit = null;
    for (const t of list) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-14) continue;
      const inv = 1 / det, tx = C[0] - P[a], ty = C[1] - P[a + 1], tz = C[2] - P[a + 2], u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv; if (dist > 0 && dist < best) { best = dist; hit = { t, u, v, p: [C[0] + d[0] * dist, C[1] + d[1] * dist, C[2] + d[2] * dist] }; }
    }
    return hit;
  };
}

// Bind a style to the rest shape (once per style): the base (a grid from the crown down to the hairline) and the locks.
export function bindStyle(style, rest) {
  const S = STYLES[style]; if (!S || !S.line) return null;
  const F = headFrame(rest), P = rest.position, I = rest.index, Nn = rest.normal, [ox, oy, oz] = F.o, C = [ox, oy + 0.03 * F.sy, oz];
  const cast = caster(P, I, C, (x, y, z) => y > oy - 0.11 && Math.abs(z - oz) < 0.16 && Math.abs(x) < 0.12);
  const local = (p) => [(p[0] - ox) / F.s, (p[1] - oy) / F.sy, (p[2] - oz) / F.s];
  const along = (th, a) => cast([Math.sin(th) * Math.sin(a), Math.cos(th), Math.sin(th) * Math.cos(a)]);
  const height = (q, share = 1) => { const e = S.line(Math.atan2(q[0], q[2])) - q[1]; return share * S.thick(...q) * (S.floor + (1 - S.floor) * sstep(0, S.ramp, -e)); };
  const grooved = (q, share) => { const t = height(q, share); return S.groove ? t - S.depth * S.groove(q[0], q[1], q[2]) * Math.min(1, t / 0.006) : t; };
  // the polar angle at angle a round the head where the skin is `inset` above the hairline (bisection)
  const lineAt = (a, inset = 0) => { let lo = 0.02, hi = 2.6, best = null; for (let k = 0; k < 26; k++) { const th = (lo + hi) / 2, h = along(th, a); if (h && local(h.p)[1] > S.line(a) + inset / F.sy) { lo = th; best = h; } else hi = th; } return { th: hi, h: best }; };

  /* the base: rings from the crown to the line */
  const M = 168, K = 56, bt = [], bw = [], bh = [], rows = [];
  const put = (h, th) => { bt.push(h.t); bw.push(h.u, h.v); bh.push(th); return bt.length - 1; };
  const top = along(0.0001, 0), pole = put(top, grooved(local(top.p), S.locks ? BASE : 1) * F.s);
  for (let j = 0; j < M; j++) {
    const a = -Math.PI + (j + 0.5) * (2 * Math.PI / M), edge = lineAt(a).th, row = [];
    for (let i = 1; i <= K; i++) { const h = along(edge * (i / K), a); if (h) row.push(put(h, grooved(local(h.p), S.locks ? BASE : 1) * F.s)); }
    const h = along(edge, a); if (h) row.push(put(h, -0.0012));   // one more on the line, sunk into the skin: a small wall, not an open rim
    rows.push(row);
  }
  const bi = [];
  for (let j = 0; j < M; j++) { const A = rows[j], B = rows[(j + 1) % M], n = Math.min(A.length, B.length); if (!n) continue; bi.push(pole, A[0], B[0]); for (let i = 0; i + 1 < n; i++) bi.push(A[i], B[i + 1], B[i], A[i], A[i + 1], B[i + 1]); }   // wound to face outward
  const baseBind = { tri: Uint32Array.from(bt), w: Float32Array.from(bw), h: Float32Array.from(bh), index: Uint32Array.from(bi) };
  // where a tied style's mass is rooted: a point on the scalp, bound like the rest, in the direction its root lies
  let root = null;
  if (S.mass) { const dir = { tail: [0, 0.32, -1], braid: [0, 0.28, -1], knot: [0, 1, -0.5] }[S.mass], h = cast(norm(dir)); if (h) root = { t: h.t, u: h.u, v: h.v, lift: height(local(h.p)) * F.s * 0.8 }; }
  if (!S.locks) return { style, base: baseBind, locks: [], root };

  /* the locks: streamlines of the comb's direction over the skin, from seeds along the hairline and two rows behind */
  const nrmAt = (h) => { const a = I[h.t] * 3, b = I[h.t + 1] * 3, c = I[h.t + 2] * 3, w = 1 - h.u - h.v; return norm([Nn[a] * w + Nn[b] * h.u + Nn[c] * h.v, Nn[a + 1] * w + Nn[b + 1] * h.u + Nn[c + 1] * h.v, Nn[a + 2] * w + Nn[b + 2] * h.u + Nn[c + 2] * h.v]); };
  const flow = (h) => { const n = nrmAt(h), g = S.comb, k = g[0] * n[0] + g[1] * n[1] + g[2] * n[2]; return norm([g[0] - n[0] * k, g[1] - n[1] * k, g[2] - n[2] * k]); };
  const onSkin = (p) => cast(norm([p[0] - C[0], p[1] - C[1], p[2] - C[2]]));
  const inHair = (p) => { const q = local(p); return q[1] > S.line(Math.atan2(q[0], q[2])) - 0.001; };
  const seeds = [];
  for (let k = 0, n = 34; k < n; k++) { const a = -1.95 + 3.9 * (k + 0.5) / n + (hash(k, 1) - 0.5) * 0.04, h = lineAt(a, 0.006).h; if (h) seeds.push({ h, row: 0, id: k }); }
  for (let k = 0, n = 18; k < n; k++) { const a = -0.95 + 1.9 * (k + 0.5) / n, h = lineAt(a, 0.03 + 0.012 * hash(k, 2)).h; if (h) seeds.push({ h, row: 1, id: 100 + k }); }
  for (let k = 0, n = 12; k < n; k++) { const a = -0.8 + 1.6 * (k + 0.5) / n, h = lineAt(a, 0.065 + 0.01 * hash(k, 3)).h; if (h) seeds.push({ h, row: 2, id: 200 + k }); }
  const locks = [];
  for (const sd of seeds) {
    const pts = [sd.h]; let h = sd.h, len = 0; const step = 0.006, Lmax = (sd.row ? 0.17 : 0.24) * (0.85 + 0.3 * hash(sd.id, 8)) * F.s;
    // back over the head, ending behind it at different places, above the nape: the combed lines would all meet low on
    // the back of the head, and the base covers it there
    while (len < Lmax) {
      const f = flow(h), nh = onSkin([h.p[0] + f[0] * step, h.p[1] + f[1] * step, h.p[2] + f[2] * step]);
      if (!nh || !inHair(nh.p)) break;
      const q = local(nh.p); if (q[2] < -0.035 && q[1] < 0.01 + 0.02 * hash(sd.id, 9)) break;
      len += Math.hypot(nh.p[0] - h.p[0], nh.p[1] - h.p[1], nh.p[2] - h.p[2]); pts.push(nh); h = nh;
    }
    if (pts.length < 4) continue;
    const n = pts.length, w0 = (0.022 + 0.008 * hash(sd.id, 5)) * F.s, t0 = (0.0036 + 0.0016 * hash(sd.id, 6)) * F.s, w = [], th = [], lift = [];
    pts.forEach((p, i) => {
      const s = i / (n - 1), q = local(p.p), root = sstep(0, 0.12, s);
      const taper = (a) => (s < 0.5 ? 1 - (1 - a[1]) * (s / 0.5) : s < 0.85 ? a[1] - (a[1] - a[2]) * ((s - 0.5) / 0.35) : a[2] - (a[2] - a[3]) * ((s - 0.85) / 0.15));
      w.push(w0 * taper([1, 0.8, 0.4, 0.05]) * (0.4 + 0.6 * root));
      th.push(t0 * taper([1, 0.75, 0.35, 0.08]) * root);
      // it lies on the base, sunk into it a little (the root deeper); rows further back ride a little higher
      lift.push(Math.max(0.0004, height(q, BASE) * F.s - t0 * (0.35 + 0.4 * (1 - root)) + (sd.row === 2 ? 0.0008 : sd.row === 1 ? 0.0004 : 0)));
    });
    locks.push({ tri: Uint32Array.from(pts.map((p) => p.t)), w: Float32Array.from(pts.flatMap((p) => [p.u, p.v])), width: Float32Array.from(w), th: Float32Array.from(th), lift: Float32Array.from(lift), shade: 0.85 + 0.3 * hash(sd.id, 7) });
  }
  return { style, base: baseBind, locks, root };
}
// the root's place on the live skin: [point, normal]
export function rootAt(bind, surface) { if (!bind.root) return null; const s = new Float64Array(6), r = bind.root; skinAt(surface.position, surface.normal, surface.index, r.t, r.u, r.v, s); return [[s[0] + s[3] * r.lift, s[1] + s[4] * r.lift, s[2] + s[5] * r.lift], [s[3], s[4], s[5]]]; }

// a bound point on the live skin: position and normal
function skinAt(P, Nn, I, t, u, v, out) {
  const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3, w = 1 - u - v;
  out[0] = P[a] * w + P[b] * u + P[c] * v; out[1] = P[a + 1] * w + P[b + 1] * u + P[c + 1] * v; out[2] = P[a + 2] * w + P[b + 2] * u + P[c + 2] * v;
  let nx = Nn[a] * w + Nn[b] * u + Nn[c] * v, ny = Nn[a + 1] * w + Nn[b + 1] * u + Nn[c + 1] * v, nz = Nn[a + 2] * w + Nn[b + 2] * u + Nn[c + 2] * v; const l = Math.hypot(nx, ny, nz) || 1;
  out[3] = nx / l; out[4] = ny / l; out[5] = nz / l;
}
// the base's positions on the live skin, into pos
export function placeBase(bind, surface, pos) {
  const P = surface.position, Nn = surface.normal, I = surface.index, s = new Float64Array(6), B = bind.base;
  for (let k = 0; k < B.h.length; k++) { skinAt(P, Nn, I, B.tri[k], B.w[k * 2], B.w[k * 2 + 1], s); const h = B.h[k]; pos[k * 3] = s[0] + s[3] * h; pos[k * 3 + 1] = s[1] + s[4] * h; pos[k * 3 + 2] = s[2] + s[5] * h; }
}
export const SEG = 8;   // points round a lock's section
// the locks on the live skin: an elliptical section (across: width; out: thickness, fuller on top) carried along each
// path with frames from the path and the skin's normal. Sizes, and the index, are the same for every shape.
export function lockCounts(bind) { let v = 0, t = 0; for (const L of bind.locks) { v += L.th.length * SEG; t += (L.th.length - 1) * SEG * 2; } return { v, t }; }
export function lockIndex(bind) {
  const idx = new Uint32Array(lockCounts(bind).t * 3); let o = 0, v0 = 0;
  for (const L of bind.locks) { const n = L.th.length; for (let i = 0; i + 1 < n; i++) for (let k = 0; k < SEG; k++) { const a = v0 + i * SEG + k, b = v0 + i * SEG + ((k + 1) % SEG); idx[o++] = a; idx[o++] = a + SEG; idx[o++] = b; idx[o++] = b; idx[o++] = a + SEG; idx[o++] = b + SEG; } v0 += n * SEG; }
  return idx;
}
// uv (across the section, along the lock) and a shade (lighter on top, a little varied lock to lock)
export function lockStatic(bind) {
  const { v } = lockCounts(bind), uv = new Float32Array(v * 2), shade = new Float32Array(v); let o = 0;
  for (const L of bind.locks) { const n = L.th.length; for (let i = 0; i < n; i++) for (let k = 0; k < SEG; k++) { const sa = Math.sin((k / SEG) * Math.PI * 2); uv[o * 2] = k / SEG; uv[o * 2 + 1] = i * 0.18; shade[o] = L.shade * (0.5 + 0.5 * Math.max(0, sa)) * (0.75 + 0.25 * (i / (n - 1))); o++; } }
  return { uv, shade };
}
export function placeLocks(bind, surface, pos, nrm) {
  const P = surface.position, Nn = surface.normal, I = surface.index; let o = 0;
  const sk = bind.locks.map((L) => { const n = L.th.length, a = new Float64Array(n * 6), s = new Float64Array(6); for (let i = 0; i < n; i++) { skinAt(P, Nn, I, L.tri[i], L.w[i * 2], L.w[i * 2 + 1], s); a.set(s, i * 6); } return a; });
  bind.locks.forEach((L, li) => {
    const n = L.th.length, S = sk[li];
    for (let i = 0; i < n; i++) {
      const p = [S[i * 6], S[i * 6 + 1], S[i * 6 + 2]], nn = [S[i * 6 + 3], S[i * 6 + 4], S[i * 6 + 5]], j1 = Math.min(n - 1, i + 1) * 6, j0 = Math.max(0, i - 1) * 6;
      const t = norm([S[j1] - S[j0], S[j1 + 1] - S[j0 + 1], S[j1 + 2] - S[j0 + 2]]), b = norm([nn[1] * t[2] - nn[2] * t[1], nn[2] * t[0] - nn[0] * t[2], nn[0] * t[1] - nn[1] * t[0]]);
      const up = L.lift[i] + L.th[i] / 2, c = [p[0] + nn[0] * up, p[1] + nn[1] * up, p[2] + nn[2] * up], hw = L.width[i] / 2, ht = Math.max(1e-5, L.th[i] / 2);
      for (let k = 0; k < SEG; k++) {
        const ang = (k / SEG) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang), hk = ht * (sa > 0 ? 1 : 0.6);
        pos[o * 3] = c[0] + b[0] * ca * hw + nn[0] * sa * hk; pos[o * 3 + 1] = c[1] + b[1] * ca * hw + nn[1] * sa * hk; pos[o * 3 + 2] = c[2] + b[2] * ca * hw + nn[2] * sa * hk;
        const en = norm([b[0] * ca / Math.max(1e-4, hw) + nn[0] * sa / hk, b[1] * ca / Math.max(1e-4, hw) + nn[1] * sa / hk, b[2] * ca / Math.max(1e-4, hw) + nn[2] * sa / hk]);
        nrm[o * 3] = en[0]; nrm[o * 3 + 1] = en[1]; nrm[o * 3 + 2] = en[2]; o++;
      }
    }
  });
}

// The masses tied styles gather behind the head, in the head's frame (base.js headFrame(): origin between the eyes, x to
// the figure's left, y toward the crown, z forward; metres at an eye spacing of 64.4 mm): paths of [x, y, z, radius] to
// be drawn as grooved tubes (a knot is a short fat one, a braid a run of knuckles turned against each other)
export function massPaths(kind) {
  if (kind === 'tail') return [{ pts: [[0, 0.064, -0.112, 0.022], [0, 0.03, -0.128, 0.03], [0, -0.02, -0.136, 0.032], [0, -0.07, -0.132, 0.026], [0, -0.115, -0.12, 0.015], [0, -0.14, -0.114, 0.005]], lines: 14, tie: 1 }];
  if (kind === 'knot') return [{ pts: [[0, 0.094, -0.05, 0.02], [0, 0.104, -0.052, 0.032], [0, 0.118, -0.053, 0.038], [0, 0.132, -0.052, 0.035], [0, 0.143, -0.05, 0.026], [0, 0.149, -0.049, 0.012], [0, 0.151, -0.049, 0.002]], lines: 12, twist: 5, tie: 1 }];   // a round bun
  if (kind === 'braid') {
    const pts = [[0, 0.066, -0.104, 0.022], [0, 0.035, -0.118, 0.022]];
    for (let k = 0; k < 9; k++) pts.push([(k % 2 ? 1 : -1) * 0.004, 0.02 - k * 0.031, -0.122 - 0.012 * Math.sin(k * 0.5), 0.019 - k * 0.0011]);
    pts.push([0, 0.02 - 9 * 0.031, -0.12, 0.006]);
    return [{ pts, lines: 10, knuckle: 0.031, tie: 2 }];
  }
  return [];
}
