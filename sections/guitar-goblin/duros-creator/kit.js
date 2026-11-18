// The outfit kit: what an outfit module builds with. An outfit is a list of pieces; each piece is a signed distance
// field, a material ('cloth', 'leather', 'metal', 'plastic' or 'light'), a colour, and a box to mesh it in. The kit
// fits pieces to the body: shells over the skin, bands, straps that follow the surface, and boxes set on it.
//
// Units are metres, y up, the figure faces +z, its left side is +x, the floor is y = 0, the eyes are at y = 1.665.
// Everything is mirrored with Math.abs(x) where an outfit wants both sides.
import { bodyField, handField, HEAD_AT } from './anatomy.js';
import { roundCone, smin, intersect, union, subtract, ssub, project, gradient, capsule, chain } from './sdf.js';

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function makeKit(build = 1) {
  const body = bodyField(build), H = HEAD_AT[1];
  // the neck as the clothes see it (the same for every head shape)
  const neck = roundCone([0, H - 0.07, -0.032], [0, H - 0.25, -0.03], 0.044, 0.051);
  const skin = smin(0.03, body.field, neck);
  const hands = [handField(1, build), handField(-1, build)];
  const b = build;

  const kit = {
    build: b,
    skin,                       // the bare figure below the head: body and neck
    hands: union(hands[0].field, hands[1].field),
    at: {                       // landmarks, figure's left side (mirror x for the right)
      neckBase: [0, 1.535, -0.012], throat: [0, 1.53, 0.045], chest: [0, 1.4, 0.1], sternum: [0, 1.46, 0.085],
      navel: [0, 1.16, 0.095], waistY: 1.07, hipY: 0.97,
      shoulder: body.shoulder, elbow: body.elbow, wrist: body.wrist, hand: hands[0].wrist,
    },
    // a box round the clothed torso, for a piece's meshing bounds
    torsoBox: (y0 = 0.56, y1 = 1.62, pad = 0.03) => [[-0.34 * b - pad, y0 - pad, -0.19 - pad], [0.34 * b + pad, y1 + pad, 0.19 + pad]],

    /* fields */
    // the skin pushed out by t (a garment's outer face), and a shell of that thickness
    offset: (t, base = skin) => (x, y, z) => base(x, y, z) - t,
    shell: (t, base = skin, tin = 0.002) => (x, y, z) => { const d = base(x, y, z); return Math.max(d - t, -d - tin); },
    // a garment: the skin pushed out by t, kept inside a region. It is solid down through the body, so only its outer
    // face is meshed; where the region cuts it (a hem, a cuff, an opening) the cut shows the cloth's thickness.
    garment: (t, region, base = skin) => (x, y, z) => Math.max(base(x, y, z) - t, region(x, y, z)),
    // keep the part of a field inside a region (both fields)
    clip: (f, region) => (x, y, z) => Math.max(f(x, y, z), region(x, y, z)),
    // regions: between two heights; the arms beyond a distance from the midline; the front opening of a jacket
    between: (y0, y1) => (x, y, z) => Math.max(y0 - y, y - y1),
    armsFrom: (ax) => (x, y, z) => ax - Math.abs(x),
    // a V (or straight) opening down the front from the neck: half-width w0 at y0 narrowing to w1 at y1
    opening: (y0, w0, y1, w1, zMin = 0.02) => (x, y, z) => {
      if (z < zMin) return 1;
      const t = Math.min(1, Math.max(0, (y0 - y) / (y0 - y1))), w = w0 + (w1 - w0) * t;
      return Math.max(Math.abs(x) - w, y - y0 - 0.2, y1 - y);
    },
    union, intersect, subtract, smin, ssub, capsule, chain,

    /* placing things on the surface */
    // the point on the (offset) surface nearest p, with its outward normal
    on: (p, t = 0, base = skin) => { const f = (x, y, z) => base(x, y, z) - t; const r = project(f, p, 8); return { p: r.p, n: r.n }; },
    // a path of points moved onto the (offset) surface, resampled every `step` metres
    path: (pts, t = 0, step = 0.012, base = skin) => {
      const f = (x, y, z) => base(x, y, z) - t, out = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], c = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(...sub3(c, a)) / step));
        for (let k = 0; k < n; k++) out.push(project(f, add3(a, mul3(sub3(c, a), k / n)), 8).p);
      }
      out.push(project(f, pts[pts.length - 1], 8).p);
      return out;
    },
    // a flat band (a strap, a seam tape, a scarf's end) along a surface path: width w, thickness th, round edges
    band: (pts, w, th, base = skin, r = 0.0015) => {
      const segs = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], c = pts[i + 1], mid = mul3(add3(a, c), 0.5), u = norm3(sub3(c, a));
        let n = gradient(base, ...mid); n = norm3(sub3(n, mul3(u, dot3(n, u))));
        const s = cross3(u, n), len = Math.hypot(...sub3(c, a)) / 2 + 0.0015;
        segs.push({ mid, u, n, s, len });
      }
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], pad = w / 2 + th;
      for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k] - pad); hi[k] = Math.max(hi[k], p[k] + pad); }
      for (const g of segs) g.R = Math.hypot(g.len, w / 2, th / 2);
      return (x, y, z) => {
        const out = Math.hypot(Math.max(lo[0] - x, x - hi[0], 0), Math.max(lo[1] - y, y - hi[1], 0), Math.max(lo[2] - z, z - hi[2], 0));
        if (out > 0.006) return out;
        let d = Infinity;
        for (const g of segs) {
          if (Math.hypot(x - g.mid[0], y - g.mid[1], z - g.mid[2]) - g.R >= d) continue;
          const qx = x - g.mid[0], qy = y - g.mid[1], qz = z - g.mid[2];
          const lx = Math.abs(qx * g.u[0] + qy * g.u[1] + qz * g.u[2]) - g.len + r, ly = Math.abs(qx * g.n[0] + qy * g.n[1] + qz * g.n[2]) - th / 2 + r, lz = Math.abs(qx * g.s[0] + qy * g.s[1] + qz * g.s[2]) - w / 2 + r;
          const v = Math.hypot(Math.max(lx, 0), Math.max(ly, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, ly, lz), 0) - r;
          if (v < d) d = v;
        }
        return d;
      };
    },
    // a rounded box sitting on the surface at p: `up` is roughly which way its height runs (default world up);
    // half sizes [width, height, depth]; it stands out of the surface by its depth
    boxOn: (p, half, r = 0.003, up = [0, 1, 0], t = 0, base = skin, tilt = 0) => {
      const s0 = kit.on(p, t, base), n = s0.n;
      let v = norm3(sub3(up, mul3(n, dot3(up, n)))), u = cross3(v, n);
      if (tilt) { const c = Math.cos(tilt), sn = Math.sin(tilt); const u2 = add3(mul3(u, c), mul3(v, sn)), v2 = add3(mul3(v, c), mul3(u, -sn)); u = u2; v = v2; }
      const c = add3(s0.p, mul3(n, half[2] - 0.001));
      const f = (x, y, z) => {
        const qx = x - c[0], qy = y - c[1], qz = z - c[2];
        const lx = Math.abs(qx * u[0] + qy * u[1] + qz * u[2]) - half[0] + r, ly = Math.abs(qx * v[0] + qy * v[1] + qz * v[2]) - half[1] + r, lz = Math.abs(qx * n[0] + qy * n[1] + qz * n[2]) - half[2] + r;
        return Math.hypot(Math.max(lx, 0), Math.max(ly, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, ly, lz), 0) - r;
      };
      f.centre = c; f.u = u; f.v = v; f.n = n;
      return f;
    },
    // a box round a centre with explicit axes (unit u, v, n) and half sizes
    box: (c, u, v, n, half, r = 0.002) => (x, y, z) => {
      const qx = x - c[0], qy = y - c[1], qz = z - c[2];
      const lx = Math.abs(qx * u[0] + qy * u[1] + qz * u[2]) - half[0] + r, ly = Math.abs(qx * v[0] + qy * v[1] + qz * v[2]) - half[1] + r, lz = Math.abs(qx * n[0] + qy * n[1] + qz * n[2]) - half[2] + r;
      return Math.hypot(Math.max(lx, 0), Math.max(ly, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, ly, lz), 0) - r;
    },
    // a box round a point (half size r), and the same box mirrored to the other side as well
    around: (c, r = 0.06) => [[c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r]],
    aroundBoth: (c, r = 0.06) => [[-Math.abs(c[0]) - r, c[1] - r, c[2] - r], [Math.abs(c[0]) + r, c[1] + r, c[2] + r]],
    // a mirrored copy (both sides of the figure)
    both: (f) => (x, y, z) => f(Math.abs(x), y, z),
    // the bounds of points, padded
    boundsOf: (pts, pad = 0.03) => {
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (const p of pts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
      return [lo.map((v) => v - pad), hi.map((v) => v + pad)];
    },
    v: { sub: sub3, add: add3, mul: mul3, dot: dot3, cross: cross3, norm: norm3 },
  };
  return kit;
}
