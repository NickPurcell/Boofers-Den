// A Duros head for the character creator's human base: our own, modelled from the species as references show it (notes
// in the engineer's workspace, never in the repository) and from no one's files. A signed distance field in the head's
// own frame, metres: the origin between the eyes, +y up, +z forward, symmetric in x. Meshed in a worker (jobs.js 'duros'),
// it comes back with a shade per vertex (a lighter face centre, darker round the eyes, a mottled dome) for the page to
// colour with the chosen skin, and two eyes. The page sets it on the body's head frame and hides the human head.
//   the species: a tall broad bulbous cranium widest high up, carried back behind the neck; a heavy brow, lower in the
//   middle, over deep-set eyes; wavy folds across the forehead; large slanted almond eyes of one colour; no nose, but a
//   long flat central plane down to the mouth with a crease each side; flat to hollow cheeks; a thin low downturned mouth;
//   a narrow jaw and a small chin; no outer ears, a small opening each side.
import { ellipsoid, capsule, roundCone, chain, smin, ssub, sintersect, union, subtract, mirrorX, rotate, rotZ, mesh } from '../duros-creator/sdf.js';

// the head's shapes: rounded (the default), a higher dome, or narrower
export const SHAPES = { round: { w: 1, h: 1, d: 1 }, tall: { w: 0.97, h: 1.1, d: 1.02 }, narrow: { w: 0.9, h: 1.03, d: 0.98 } };
// the eyes, for the page to draw (each an almond lens): centre, half sizes, the slant (outer corner up)
// (set into the head, its surface a little behind the brow and the cheek: from below it is under the brow)
export const EYE = { c: [0.043, 0.0, 0.027], r: [0.026, 0.0125, 0.0075], tilt: 0.17 };
// an almond, pointed at both corners: two tall ellipsoids offset up and down, overlapping
const almond = (cx, cy, cz, w, h, d, soft) => sintersect(soft, ellipsoid(cx, cy - h * 0.95, cz, w, h * 1.95, d), ellipsoid(cx, cy + h * 0.95, cz, w, h * 1.95, d));

export function durosField(shape = 'round') {
  const S = SHAPES[shape] || SHAPES.round, W = S.w, H = S.h, D = S.d;
  // the cranium: a broad ellipsoid set high and back, squared off a little by a second one above it (widest high up)
  const cranium = smin(0.03, ellipsoid(0, 0.05 * H, -0.045 * D, 0.088 * W, 0.098 * H, 0.112 * D), ellipsoid(0, 0.085 * H, -0.035 * D, 0.078 * W, 0.07 * H, 0.098 * D));
  // the face below the eyes, narrowing to a small chin; the jaw
  const face = smin(0.025, ellipsoid(0, -0.035, 0.0, 0.066 * W, 0.075, 0.07), roundCone([0, -0.02, 0.012], [0, -0.1, 0.024], 0.05 * W, 0.017));
  // the brow: a heavy ridge from temple to temple, lower in the middle (a shallow V)
  // (tapering toward the temples, where it fades into the dome rather than wrapping round it)
  const brow = mirrorX(smin(0.01, roundCone([0, 0.015, 0.055], [0.022 * W, 0.019, 0.052], 0.015, 0.014), roundCone([0.022 * W, 0.019, 0.052], [0.046 * W, 0.024, 0.043], 0.014, 0.01), roundCone([0.046 * W, 0.024, 0.043], [0.063 * W, 0.02, 0.028], 0.01, 0.004)));
  // the central plane: a long flat strip from between the eyes to above the mouth, narrowing, standing a little proud
  const plane = roundCone([0, -0.008, 0.047], [0, -0.07, 0.047], 0.012, 0.008);
  // the neck, reaching well down into the body's own so the join is hidden
  const neck = capsule([0, -0.06, -0.06], [0, -0.185, -0.078], 0.046);   // (set back under the skull, as a neck is, ending inside the collar)
  let f = smin(0.03, cranium, face);
  f = smin(0.022, f, brow);
  f = smin(0.016, f, plane);
  f = smin(0.03, f, neck);
  // (the forehead's folds are painted, in shadeAt: modelled, they read as a seam)
  // the eyes' sockets: slanted almonds, deep under the brow
  const socket = mirrorX(rotate(almond(EYE.c[0], EYE.c[1], EYE.c[2] + 0.012, EYE.r[0] * 1.12, EYE.r[1] * 1.35, 0.021, 0.003), rotZ(-EYE.tilt), EYE.c));
  f = ssub(0.009, f, socket);   // (a soft rim)
  // the creases down each side of the plane, from the inner eye toward the mouth's corner, and the hollow cheeks
  f = ssub(0.006, f, mirrorX(capsule([0.019, -0.048, 0.052], [0.022, -0.076, 0.049], 0.0018)));   // (short and low, toward the mouth: not a tear track)
  f = ssub(0.02, f, mirrorX(ellipsoid(0.056 * W, -0.045, 0.045, 0.02, 0.026, 0.02)));
  // the mouth: a thin low line, a little downturned at its corners, with the plane's end just overhanging it
  f = ssub(0.003, f, mirrorX(chain([[0, -0.083, 0.0565], [0.011, -0.0845, 0.0545], [0.019, -0.088, 0.0505]], 0.0035)));   // (a shallow line: the dark of it is painted, shadeAt)
  // the small chin, set just behind the line of the mouth
  f = smin(0.012, f, ellipsoid(0, -0.104, 0.03, 0.015, 0.012, 0.012));
  // no outer ears: a small opening each side at eye level, set back
  f = ssub(0.004, f, mirrorX(ellipsoid(0.083 * W, -0.006, -0.04, 0.006, 0.008, 0.007)));
  return f;
}

// a smooth noise for the dome's mottling (our own, a few octaves of value noise on a hashed lattice)
const hash3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi, s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf), L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return L(L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v), L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v), w);
}
// how light or dark the skin is at a point of the head (1 = the chosen colour)
export function shadeAt(x, y, z) {
  const ax = Math.abs(x);
  let k = 1;
  const dome = Math.max(0, Math.min(1, (y - 0.02) / 0.05));   // the cranium mottles
  k *= 1 - dome * 0.16 * (0.4 + 0.6 * noise3(x * 55, y * 55, z * 55)) - dome * 0.06 * noise3(x * 160, y * 160, z * 160);
  const centre = Math.max(0, 1 - ax / 0.03) * Math.max(0, Math.min(1, (0.02 - y) / 0.03)) * Math.max(0, Math.min(1, (z - 0.03) / 0.02));
  k *= 1 + 0.08 * centre;   // a lighter face centre
  if (z > 0.0 && y > 0.035 && y < 0.1) {   // the forehead's folds: three faint wavy darker lines across the front
    const front = Math.max(0, Math.min(1, (z - 0.0) / 0.03)) * Math.max(0, 1 - ax / 0.07);
    for (const [y0, ph] of [[0.045, 0.3], [0.06, 1.7], [0.076, 2.9]]) { const d = Math.abs(y - (y0 + 0.003 * Math.sin(ax * 90 + ph))); k *= 1 - 0.13 * front * Math.max(0, 1 - d / 0.0028); }
  }
  const ey = Math.hypot(ax - EYE.c[0], (y - EYE.c[1]) * 1.6, z - EYE.c[2]);
  k *= 1 - 0.22 * Math.max(0, 1 - ey / 0.04);   // darker round the eyes
  if (y < -0.075) k *= 0.97;
  // the mouth: a thin dark line, a little downturned at its corners
  if (z > 0.035 && ax < 0.022) { const ym = -0.083 - 0.0016 * (ax / 0.011) ** 2 * (ax > 0.011 ? 1 + (ax - 0.011) / 0.004 : 1); k *= 1 - 0.55 * Math.max(0, 1 - Math.abs(y - ym) / 0.0016) * Math.max(0, 1 - ax / 0.021); }
  return k;
}

// the worker's job: the head meshed, with its shade per vertex (positions in the head's frame, metres)
export function durosHead(a = {}) {
  const f = durosField(a.shape), h = a.h || 0.0026;
  const m = mesh(f, [[-0.11, -0.22, -0.18], [0.11, 0.19, 0.09]], h, { band: 4 });
  const P = m.position, shade = new Float32Array(P.length / 3);
  for (let i = 0; i < shade.length; i++) shade[i] = shadeAt(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
  return { position: P, normal: m.normal, index: m.index, shade, uv: m.uv };
}
