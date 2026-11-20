// Jawa creator: the leather and canvas a Jawa wears over the robe. Straps run round the body in a slanted plane and
// lie on the cloth; pouches sit along them; a belt hangs loose and low; a strap holds goggles on the hood; a sack
// hangs at the hip. All of it is signed distance shapes fitted to the robe's own surface (figure.js), meshed by the
// shared mesher. Small hard things (studs, buckles, the goggles themselves) are made on the page from the anchors
// this returns: where they go and which way they face.
import { gradient } from '../duros-creator/sdf.js';
import { robeField, hoodField, pose, V, clamp, noise1 } from './figure.js';

const { sin, cos, hypot, abs, max, min, PI } = Math, TAU = PI * 2;
const sminv = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// walk outward from a point inside a shape until the surface
export function exitPoint(f, o, d, far = 0.4) {
  let t = 0;
  for (let i = 0; i < 240 && t < far; i++) { const v = f(o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t); if (v > -0.0002) break; t += max(-v * 0.7, 0.0005); }
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}
// points round a body in the plane through c spanned by e1 and e2 (unit, at right angles), on its surface pushed out by t
function loop(body, c, e1, e2, t, n = 110) {
  const f = (x, y, z) => body(x, y, z) - t, pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU, d = V.norm(V.add(V.mul(e1, cos(a)), V.mul(e2, sin(a)))); pts.push(exitPoint(f, c, d)); }
  // a strap pulled tight bridges the folds rather than following each one: smooth the loop a little
  for (let pass = 0; pass < 3; pass++) { const q = pts.map((p) => p.slice()); for (let i = 0; i < n; i++) { const a = q[(i + n - 1) % n], b = q[(i + 1) % n]; for (let k = 0; k < 3; k++) pts[i][k] = q[i][k] * 0.5 + (a[k] + b[k]) * 0.25; } }
  return pts;
}
// the frame at a point of a loop: u along it, n out of the body, v across it (whichever way is more up)
function frameAt(pts, i, body) {
  const N = pts.length; i = ((i % N) + N) % N;
  const p = pts[i], a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
  const u = V.norm(V.sub(b, a)); let n = gradient(body, p[0], p[1], p[2], 0.002); n = V.norm(V.sub(n, V.mul(u, V.dot(n, u))));
  let v = V.cross(n, u); let uu = u; if (v[1] < 0) { v = V.mul(v, -1); uu = V.mul(u, -1); }
  return { p, u: uu, v, n };
}
// a box with round edges in a frame: half sizes along u, v, n; centre given in the frame's own coordinates
function boxIn(F, cu, cv, cn, hu, hv, hn, r = 0.002, spin = 0) {
  const c = [F.p[0] + F.u[0] * cu + F.v[0] * cv + F.n[0] * cn, F.p[1] + F.u[1] * cu + F.v[1] * cv + F.n[1] * cn, F.p[2] + F.u[2] * cu + F.v[2] * cv + F.n[2] * cn];
  let u = F.u, v = F.v; const n = F.n;
  if (spin) { const cs = cos(spin), sn = sin(spin); u = V.add(V.mul(F.u, cs), V.mul(F.v, sn)); v = V.add(V.mul(F.v, cs), V.mul(F.u, -sn)); }
  const f = (x, y, z) => {
    const qx = x - c[0], qy = y - c[1], qz = z - c[2];
    const lx = abs(qx * u[0] + qy * u[1] + qz * u[2]) - hu + r, ly = abs(qx * v[0] + qy * v[1] + qz * v[2]) - hv + r, lz = abs(qx * n[0] + qy * n[1] + qz * n[2]) - hn + r;
    return hypot(max(lx, 0), max(ly, 0), max(lz, 0)) + min(max(lx, ly, lz), 0) - r;
  };
  f.c = c; return f;
}
const pointIn = (F, cu, cv, cn) => [F.p[0] + F.u[0] * cu + F.v[0] * cv + F.n[0] * cn, F.p[1] + F.u[1] * cu + F.v[1] * cv + F.n[1] * cn, F.p[2] + F.u[2] * cu + F.v[2] * cv + F.n[2] * cn];
// a strap as the page will sweep it: the loop's points, the way out of the body at each, and the strap's size
function ribbon(pts, body, w, th, tone, name) {
  const N = pts.length, P = new Float32Array(N * 3), Nn = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const F = frameAt(pts, i, body); P.set(pts[i], i * 3); Nn.set(F.n, i * 3); }
  return { name, pts: P, nrm: Nn, w, th, tone, closed: true };
}
const boundsOf = (pts, pad) => { const lo = [9, 9, 9], hi = [-9, -9, -9]; for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = min(lo[k], p[k]); hi[k] = max(hi[k], p[k]); } return [lo.map((v) => v - pad), hi.map((v) => v + pad)]; };

/* ---------------- pouches ---------------- */
// Each maker takes the frame on the strap and returns the leather (a field), where its studs go, and anything of
// another material. Sizes are for a hand about five centimetres wide.
const POUCH = {
  // a flap that comes to a point, closed on one stud
  flap(F, k) {
    const s = 1 + 0.08 * (k % 2), body = boxIn(F, 0, -0.004, 0.0125, 0.0185 * s, 0.021, 0.0105, 0.004);
    const lid = boxIn(F, 0, 0.0085, 0.0138, 0.0198 * s, 0.0105, 0.0118, 0.003), tip = boxIn(F, 0, -0.0005, 0.0138, 0.0112 * s, 0.0112, 0.0118, 0.0025, PI / 4);
    return { field: (x, y, z) => sminv(body(x, y, z), min(lid(x, y, z), tip(x, y, z)), 0.0025), studs: [{ p: pointIn(F, 0, -0.0075, 0.0262), n: F.n, r: 0.0031 }], c: body.c, R: 0.04 };
  },
  // a box pouch: a lid, a strap down the front through a keeper, a stud at the top
  box(F, k) {
    const s = 1 + 0.06 * ((k + 1) % 2), body = boxIn(F, 0, -0.003, 0.0135, 0.021 * s, 0.0235, 0.0118, 0.0045);
    const lid = boxIn(F, 0, 0.0165, 0.0142, 0.0222 * s, 0.0078, 0.0128, 0.003), strap = boxIn(F, 0, -0.002, 0.0152, 0.0048, 0.0262, 0.0125, 0.0016), keep = boxIn(F, 0, -0.0105, 0.0158, 0.0112, 0.0036, 0.0125, 0.0014);
    return { field: (x, y, z) => min(sminv(body(x, y, z), lid(x, y, z), 0.002), strap(x, y, z), keep(x, y, z)), studs: [{ p: pointIn(F, 0, 0.0135, 0.0282), n: F.n, r: 0.003 }], c: body.c, R: 0.042 };
  },
  // a row of cells in loops under a cover flap held by two tabs
  cartridge(F) {
    const back = boxIn(F, 0, -0.002, 0.0045, 0.03, 0.0215, 0.0045, 0.002), flap = boxIn(F, 0, 0.0125, 0.0125, 0.031, 0.0082, 0.0085, 0.003);
    const loops = boxIn(F, 0, -0.008, 0.0082, 0.0285, 0.0052, 0.0052, 0.002), tabs = [boxIn(F, -0.017, 0.003, 0.0135, 0.0042, 0.0125, 0.0095, 0.0015), boxIn(F, 0.017, 0.003, 0.0135, 0.0042, 0.0125, 0.0095, 0.0015)];
    const cells = [];
    for (let i = 0; i < 5; i++) { const cu = (i - 2) * 0.0108, a = pointIn(F, cu, -0.0165, 0.0098), b = pointIn(F, cu, 0.004, 0.0098); cells.push({ a, b, r: 0.0043 }); }
    return { field: (x, y, z) => min(sminv(back(x, y, z), flap(x, y, z), 0.002), loops(x, y, z), tabs[0](x, y, z), tabs[1](x, y, z)), studs: [{ p: pointIn(F, -0.017, -0.004, 0.0242), n: F.n, r: 0.0026 }, { p: pointIn(F, 0.017, -0.004, 0.0242), n: F.n, r: 0.0026 }], cells, c: back.c, R: 0.05 };
  },
};

/* ---------------- the rigs ---------------- */
// What each layout is made of. side +1: a strap from the figure's left shoulder to the right hip.
export const RIGS = {
  none: { name: 'Bare robe', parts: [] },
  bandolier: { name: 'Bandolier', parts: [{ kind: 'cross', side: 1, pouch: 'flap', count: 5, tone: 0 }] },
  crossed: { name: 'Crossed straps', parts: [{ kind: 'cross', side: 1, pouch: 'box', count: 4, tone: 0 }, { kind: 'cross', side: -1, pouch: 'cartridge', count: 3, tone: 1, out: 0.0055 }] },
  toolbelt: { name: 'Tool belt', parts: [{ kind: 'belt', pouch: 'box', count: 3, tone: 0 }, { kind: 'cross', side: -1, pouch: null, tone: 1, thin: true }] },
  scavenger: { name: "Scavenger's rig", parts: [{ kind: 'cross', side: -1, pouch: 'flap', count: 4, tone: 0 }, { kind: 'belt', pouch: 'cartridge', count: 2, tone: 1 }] },
};

// the pieces for a set of choices: { rig, hood, goggles, satchel } on a build
export function strapPieces(a, B) {
  const { w, t } = B, arms = pose('rest', B), body = robeField(B, arms).body;
  const pieces = [], anchors = { ribbons: [], studs: [], buckles: [], cells: [], goggles: null, hip: null, satchel: null, back: null, chest: null, belt: null };
  let index = 0;
  const add = (name, material, tone, shape, res) => pieces.push({ name, index: index++, material, tone, field: shape.field, bounds: shape.bounds, res });
  const rig = RIGS[a.rig] || RIGS.none;
  for (const part of rig.parts) {
    const out = 0.0025 + (part.out || 0);
    let pts, front;   // the loop, and the stretch of it (as fractions of the way round) where pouches can sit
    if (part.kind === 'cross') {
      const s = part.side, hi = [s * 0.082 * w, 0.672 * t, -0.004], lo = [-s * 0.168 * w, 0.405 * t, 0.0];
      const c = [0, 0.545 * t, 0], e1 = V.norm(V.sub(hi, lo));
      pts = loop(body, c, e1, [0, 0, 1], out); front = [0.115, 0.4];
    } else {
      // a belt slung loose: low on the right hip, higher on the left
      const c = [0, 0.395 * t, 0], e1 = V.norm([1, 0.2, 0]);
      pts = loop(body, c, e1, [0, 0, 1], out + 0.003); front = part.pouch === 'cartridge' ? [0.2, 0.36] : [0.1, 0.33];
      anchors.belt = { right: frameAt(pts, Math.round(pts.length * 0.42), body), left: frameAt(pts, Math.round(pts.length * 0.06), body), back: frameAt(pts, Math.round(pts.length * 0.75), body) };
    }
    const N = pts.length, wide = part.thin ? 0.016 : part.kind === 'belt' ? 0.023 : 0.027;
    anchors.ribbons.push(ribbon(pts, body, wide, 0.0046, part.tone, part.kind + (part.side || '')));
    // a frame buckle on the chest (or at the front of a belt), and where its strap end tucks through
    const bi = Math.round(N * (part.kind === 'belt' ? 0.265 : 0.07)), bf = frameAt(pts, bi, body);
    anchors.buckles.push({ p: pointIn(bf, 0, 0, 0.0052), u: bf.u, v: bf.v, n: bf.n, w: wide });
    if (part.pouch) {
      const made = [];
      for (let k = 0; k < part.count; k++) {
        const f = front[0] + ((front[1] - front[0]) * (k + 0.5)) / part.count + 0.004 * (noise1(k * 3.3, 16, 77) - 0.5);
        const F = frameAt(pts, Math.round(N * f), body);
        // a pouch hangs a little below the strap's middle, and no two sit quite alike
        const tilt = 0.09 * (noise1(k * 2.1 + 5, 16, 78) - 0.5), Ft = { p: V.add(F.p, V.mul(F.n, 0.0036)), u: V.add(V.mul(F.u, cos(tilt)), V.mul(F.v, sin(tilt))), v: V.add(V.mul(F.v, cos(tilt)), V.mul(F.u, -sin(tilt))), n: F.n };
        const P = POUCH[part.pouch](Ft, k); made.push(P);
        for (const st of P.studs) anchors.studs.push(st);
        for (const cell of P.cells || []) anchors.cells.push(cell);
      }
      const field = (x, y, z) => { let d = 1; for (let i = 0; i < made.length; i++) { const P = made[i], far = hypot(x - P.c[0], y - P.c[1], z - P.c[2]) - P.R; if (far >= d) continue; const v = P.field(x, y, z); if (v < d) d = v; } return d; };
      add('pouches' + (part.side || 'b'), 'leather', part.tone, { field, bounds: boundsOf(made.map((P) => P.c), 0.046) }, 0.0023);
    }
    if (part.kind === 'cross' && !anchors.hip) anchors.hip = frameAt(pts, Math.round(N * 0.47), body);
  }
  // where things hang on the body whatever is worn: the chest (a keepsake on a cord), the back (a pack), the hip
  const on = (o, d) => { const p = exitPoint((x, y, z) => body(x, y, z) - 0.004, o, V.norm(d)); let n = gradient(body, p[0], p[1], p[2], 0.002); return { p, n }; };
  anchors.chest = on([0, 0.6 * t, 0], [0.02, -0.05, 1]);
  anchors.neck = [on([0, 0.655 * t, 0], [0.55, 0.25, 1]).p, on([0, 0.655 * t, 0], [-0.55, 0.25, 1]).p];
  anchors.back = on([0, 0.54 * t, 0], [0, 0, -1]);
  if (!anchors.hip) anchors.hip = (() => { const o = on([0, 0.42 * t, 0], [-1, 0, 0.5]); return { p: o.p, n: o.n, u: [0, 0, -1], v: [0, 1, 0] }; })();

  if (a.goggles) {
    // a strap round the hood at the brow; the goggles sit on it above the opening
    // (on the hood's outer shape, not through its hollow: the strap crosses the brow above the opening)
    const hd = hoodField(a.hood, B), c = [0, hd.open.c[1] + hd.open.h + 0.012, -0.035], e1 = [0, 0.3, 0.954], e2 = [1, 0, 0];
    const hp = loop(hd.shell, c, V.norm(e1), e2, 0.0015, 96);
    anchors.ribbons.push(ribbon(hp, hd.shell, 0.014, 0.004, 1, 'gogglestrap'));
    const N = hp.length, L = frameAt(hp, Math.round(N * 0.06), hd.shell), R = frameAt(hp, Math.round(N * -0.06), hd.shell), M = frameAt(hp, 0, hd.shell);
    anchors.goggles = { L, R, M };
  }
  if (a.satchel) {
    // a sack of coarse cloth at the left hip on its own thin strap from the right shoulder
    const hi = [-0.08 * w, 0.672 * t, -0.004], lo = [0.17 * w, 0.4 * t, -0.01], c = [0, 0.545 * t, 0];
    const pts = loop(body, c, V.norm(V.sub(hi, lo)), [0, 0, 1], 0.009), N = pts.length;
    anchors.ribbons.push(ribbon(pts, body, 0.012, 0.004, 1, 'satchelstrap'));
    const F = frameAt(pts, Math.round(N * 0.56), body), sc = pointIn(F, 0.01, -0.062, 0.03);
    const sack = (x, y, z) => {
      const qx = x - sc[0], qy = y - sc[1], qz = z - sc[2], lu = qx * F.u[0] + qy * F.u[1] + qz * F.u[2], lv = qx * F.v[0] + qy * F.v[1] + qz * F.v[2], ln = qx * F.n[0] + qy * F.n[1] + qz * F.n[2];
      // a soft bag: full at the bottom, gathered toward the top
      const g = 1 - 0.32 * clamp((lv + 0.02) / 0.09, 0, 1), px = lu / (0.062 * g), py = lv / 0.074, pz = ln / (0.034 * g);
      const k0 = Math.sqrt(px * px + py * py + pz * pz), k1 = Math.sqrt((px / (0.062 * g)) ** 2 + (py / 0.074) ** 2 + (pz / (0.034 * g)) ** 2);
      const d = k1 === 0 ? -0.03 : (k0 * (k0 - 1)) / k1;
      return d - 0.003 * sin(lu * 95 + lv * 30) * clamp((lv + 0.03) / 0.08, 0, 1);
    };
    const flap = boxIn(F, 0.01, -0.02, 0.05, 0.05, 0.03, 0.022, 0.012);
    add('satchel', 'canvas', 0, { field: (x, y, z) => sminv(sack(x, y, z), flap(x, y, z), 0.012) * 0.8, bounds: [[sc[0] - 0.1, sc[1] - 0.1, sc[2] - 0.1], [sc[0] + 0.1, sc[1] + 0.1, sc[2] + 0.1]] }, 0.0034);
    anchors.satchel = { p: sc, u: F.u, v: F.v, n: F.n };
    anchors.studs.push({ p: pointIn(F, 0.01, -0.043, 0.0728), n: F.n, r: 0.0034 });
  }
  pieces.anchors = anchors;
  return pieces;
}
