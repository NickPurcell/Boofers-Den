// The Duros head as signed distance shapes (sdf.js), in metres from the point between the eyes, y up, facing +z.
// Pure: no DOM and no three.js, so the mesher worker can import it.
//
// Proportions from engineer7's measurements of three reference sources (#65; a head about 0.285 m chin to crown,
// the eye line 40% of the way up), built in our own code:
//  - front half-widths: 0.094 at the cranium's widest (high up, y 0.09-0.11), still ~0.07 at y 0.15 (a box with big
//    corner radii), 0.080 at the eyes, 0.062 at the jaw hinge (y -0.04), 0.034 at the mouth, 0.018 at the chin;
//  - profile: the brow is the most forward point (z 0.085), the face front nearly vertical, the chin ~10 mm back;
//    the forehead rises nearly straight ~4 cm above the brow, then curves back; the back of the skull at z -0.135;
//  - eyes: a slanted almond 0.050 x 0.024, centres at x 0.050, set 7-9 mm behind the brow, which overhangs them;
//  - a heavy brow, its crest lower at the centre (a shallow V); three low rolls across the forehead;
//  - a long flat central plane from between the brows (y 0.012) to just above the mouth, proud of the cheeks, with a
//    crease down each side; cheekbones under the eyes' outer halves, flat-to-hollow below;
//  - the mouth a thin line at y -0.088, half-width 0.022, corners 2 mm low, under the plane's overhang; no lips;
//  - the ear opening just below eye level at z -0.03; the neck to the clothes' measurements.
import { sphere, ellipsoid, capsule, roundCone, roundBox, smin, ssub, mirrorX, chain, near, rotate, rotY, rotZ, cast } from './sdf.js';

export const HEAD_B_SHAPES = {
  // fw: the face's and skull's width (narrow = x0.9); crown: the skull's top; folds: rolls across the forehead
  round: { fw: 1.0, crown: 0.171, folds: 3 },
  tall: { fw: 1.0, crown: 0.19, folds: 3 },
  narrow: { fw: 0.9, crown: 0.176, folds: 3 },
};
// the mouth's corners (up +), the brow's inner and outer ends (up +), the lids (how far over the eye, radians), the
// cheeks lifting, the mouth's width
export const EXPRESSIONS_B = {
  neutral: { corner: 0, brow: 0, browOut: 0, lid: 0, lower: 0, cheek: 0, width: 1 },
  smile: { corner: 0.0045, brow: 0.0015, browOut: 0.001, lid: 0.02, lower: 0.16, cheek: 0.003, width: 1.1 },
  stern: { corner: -0.0025, brow: -0.005, browOut: 0.002, lid: 0.2, lower: 0.05, cheek: 0, width: 0.95 },
  wary: { corner: -0.001, brow: 0.005, browOut: -0.001, lid: -0.12, lower: 0.05, cheek: 0, width: 0.9 },
};
const translateIn = (f, d) => (x, y, z) => f(x, y, z) + d;   // shrink a shape by d (a cut with it goes d less deep)

export function headBField(shapeKey = 'round', exprKey = 'neutral', age = 0) {
  const S = HEAD_B_SHAPES[shapeKey] || HEAD_B_SHAPES.round, X = EXPRESSIONS_B[exprKey] || EXPRESSIONS_B.neutral, fw = S.fw;
  age = Math.max(0, Math.min(1, +age || 0));
  const old = Math.max(0, (age - 0.5) / 0.5);
  // the eye: a squashed ball (x radius 0.026, 0.5 as tall, 0.55 as deep), rolled by the slant, yawed outward
  const eye = { x: 0.05 * fw, y: 0.0, z: 0.061, r: 0.026, sy: 0.6, sz: 0.55, slant: 0.175, yaw: 0.31 };

  /* ---- the skull: a box with big corner radii, widest high up, carried well back ---- */
  // the box from y -0.029 up to the crown (less what the blends add), its big corner radius rounding it over late
  const top = S.crown - 0.008, crY = (top - 0.029) / 2, hy = (top + 0.029) / 2;
  const cranium = roundBox(0, crY, -0.036, 0.096 * fw, hy, 0.094, 0.07);   // corner radius under the half-width: broad high up, still bulbous
  const crownBack = ellipsoid(0, top - 0.045, -0.045, 0.06 * fw, 0.042, 0.07);       // the crown's high point, over the neck
  const back = ellipsoid(0, 0.045, -0.068, 0.074 * fw, 0.1, 0.058);                        // the back of the skull at z -0.135
  const forehead = roundBox(0, 0.048, 0.03, 0.07 * fw, 0.042, 0.045, 0.034);             // rising almost straight over the brow
  const occiput = ellipsoid(0, -0.025, -0.08, 0.064 * fw, 0.055, 0.055);

  /* ---- the face ---- */
  // the brow: a heavy ridge per side, crest at y 0.016 inside and 0.026 outside, the most forward point of the face
  const brow = mirrorX(chain([[0.006, 0.016 + X.brow, 0.077], [0.026 * fw, 0.019 + X.brow * 0.6, 0.077], [0.05 * fw, 0.024 + X.browOut * 0.5, 0.072], [0.07 * fw, 0.026 + X.browOut, 0.056], [0.078 * fw, 0.021 + X.browOut, 0.038]], 0.0095 + 0.001 * age));   // the outer end tucked in: no ledge past the skull
  const browPlate = ellipsoid(0, 0.022, 0.058, 0.07 * fw, 0.02, 0.022);
  // the face below the eyes: 0.080 at the eyes, 0.062 at the jaw hinge, tapering hard to the chin
  const midface = ellipsoid(0, -0.016, 0.018, 0.068 * fw, 0.045, 0.05);
  const lowerFace = roundCone([0, -0.03, 0.012], [0, -0.098, 0.043], 0.05 * fw, 0.017 * fw);
  const jawSide = mirrorX(capsule([0.054 * fw, -0.035, -0.028], [0.012 * fw, -0.104, 0.042], 0.008));
  const chin = ellipsoid(0, -0.104, 0.046, 0.017 * fw, 0.011, 0.013);                      // bottom at -0.114, behind the mouth
  const cheekbone = mirrorX(ellipsoid(0.055 * fw, -0.022 + X.cheek, 0.052, 0.02, 0.011, 0.016));
  // the long flat central plane, between the brows to just above the mouth, its lower end overhanging the line
  const plane = roundCone([0, 0.006, 0.07], [0, -0.066, 0.058], 0.02 * fw, 0.017 * fw);   // its lower end sinks into the muzzle above the mouth
  const planeFlat = (x, y, z) => Math.max(plane(x, y, z), z - 0.079);                      // flat across the front

  // the mouth's own plate: as wide as the mouth, a little behind the plane, so the line lies on it under the overhang
  const mouthPlate = ellipsoid(0, -0.087, 0.054, 0.038 * fw, 0.02, 0.0115);   // a broad, shallow muzzle, wide enough for a smile's corners

  /* ---- carved in ---- */
  // the socket: the same slanted, yawed almond as the eye, a little larger, under the brow
  const socketShape = rotate(rotate(ellipsoid(0, 0, 0, eye.r + 0.0025, eye.r * eye.sy + 0.0025, eye.r * eye.sz + 0.003), rotZ(eye.slant)), rotY(eye.yaw));
  const socket = mirrorX((x, y, z) => socketShape(x - eye.x, y - eye.y - 0.001, z - eye.z - 0.002));
  // the creases down each side of the plane, from the inner eye corner to just outside the mouth's corner
  const crease = mirrorX(chain([[0.024 * fw, -0.008, 0.071], [0.023 * fw, -0.04, 0.073], [0.021 * fw, -0.07, 0.071], [0.022 * fw, -0.082, 0.066]], 0.0026));
  // flat-to-hollow below the cheekbones, a little more with age
  const hollow = mirrorX(ellipsoid(0.05 * fw, -0.052, 0.056, 0.017, 0.018, 0.002 + 0.0025 * old));
  const temple = mirrorX(ellipsoid(0.099 * fw, 0.03, 0.012, 0.0035 + 0.003 * age, 0.03, 0.026));
  const bags = old > 0 ? mirrorX(ellipsoid(eye.x, eye.y - 0.022, eye.z + 0.006, 0.026, 0.005, 0.0022 + 0.0012 * old)) : null;

  /* ---- the neck (to the clothes' measurements), its long muscles, the nape ---- */
  const neck = roundCone([0, -0.06, -0.032], [0, -0.3, -0.026], 0.047 * fw, 0.05);
  const neckMuscle = mirrorX(capsule([0.057 * fw, -0.046, -0.04], [0.015, -0.262, 0.03], 0.0105));
  const nape = roundCone([0, -0.07, -0.064], [0, -0.21, -0.056], 0.031, 0.022);

  let skull = smin(0.03, cranium, crownBack, back, forehead, occiput);
  skull = smin(0.024, skull, browPlate, midface, lowerFace);
  skull = smin(0.01, skull, jawSide, chin, cheekbone);
  skull = smin(0.01, skull, brow);
  skull = smin(0.018, skull, mouthPlate);
  skull = smin(0.008, skull, planeFlat);
  if (bags) skull = smin(0.02, skull, bags);
  skull = smin(0.03, skull, neck, nape);
  skull = smin(0.016, skull, neckMuscle);
  skull = ssub(0.02, skull, temple);
  skull = ssub(0.02, skull, hollow);
  skull = ssub(0.007, skull, translateIn(crease, 0.0018));
  skull = ssub(0.005, skull, socket);

  // the forehead's rolls: low (1.5-2 mm) and broad (~5 mm), laid on the surface as built and dipping a little at the
  // centre with the brow's V; rolls rather than cut lines, so the grid holds them
  for (let k = 0; k < S.folds; k++) {
    const yb = 0.045 + k * 0.02 * (S.crown / 0.171), pts = [];
    for (let t = -1; t <= 1.0001; t += 0.125) {
      const x = t * 0.06 * fw, y = yb - 0.005 * (1 - t * t) + 0.003 * Math.sin(t * Math.PI * 2.3 + k * 1.7);
      const hit = cast(skull, [x, y, 0.3], [0, 0, -1], 0.5);
      if (hit) pts.push([hit.p[0] - hit.n[0] * 0.0012, hit.p[1] - hit.n[1] * 0.0012, hit.p[2] - hit.n[2] * 0.0012]);
    }
    if (pts.length > 4) skull = smin(0.003, skull, chain(pts, 0.0026 + 0.0003 * age));
  }

  // the mouth: a thin line at y -0.088 under the plane's overhang, found on the face as built (so it's never in the
  // air), corners 2 mm lower than the centre; a shallow closed cut under 2 mm
  const my = -0.088, w = 0.022 * X.width * fw, cy = X.corner - 0.002;
  const onFace = (x, y) => { const h = cast(skull, [x, y, 0.3], [0, 0, -1], 0.5); return h ? h.p : [x, y, 0.06]; };
  const slitPts = [[-w, my + cy], [-w * 0.5, my + cy * 0.35], [0, my], [w * 0.5, my + cy * 0.35], [w, my + cy]].map(([x, y]) => onFace(x, y));
  skull = ssub(0.0016, skull, chain(slitPts, 0.0009));
  skull = ssub(0.0022, skull, mirrorX(sphere(slitPts[4][0] + 0.001, slitPts[4][1], slitPts[4][2] - 0.001, 0.0016)));

  // the ear openings: just below eye level at z -0.03, a 6 mm hole with a low rim, set on the surface as built
  let earAt;
  {
    const hit = cast(skull, [0.3, -0.01, -0.03], [-1, 0, 0], 0.5);
    earAt = hit ? hit.p : [0.09 * fw, -0.01, -0.03];
    const n = hit ? hit.n : [1, 0, 0], at = (k) => [earAt[0] + n[0] * k, earAt[1] + n[1] * k, earAt[2] + n[2] * k];
    const holeC = at(0.0022), rimC = at(-0.0016);
    skull = smin(0.004, skull, mirrorX(near(earAt, 0.018, ellipsoid(rimC[0], rimC[1], rimC[2], 0.0022, 0.0055, 0.005))));
    skull = ssub(0.003, skull, mirrorX(near(earAt, 0.016, sphere(holeC[0], holeC[1], holeC[2], 0.003))));
  }
  if (old > 0) {   // an elder's lines beside the plane toward the mouth: broad and shallow
    const groove = mirrorX(chain([[0.032 * fw, -0.045, 0.066], [0.033 * fw, -0.065, 0.064], [0.031 * fw, -0.08, 0.06]], 0.0032));
    skull = ssub(0.016, skull, translateIn(groove, 0.0026 - 0.0008 * old));
  }

  // the mouth line, dense, for a thin dark tube laid in the cut
  const mouthLine = [];
  for (let k = 0; k + 1 < slitPts.length; k++) for (let t = 0; t < 1; t += 0.25) {
    const a = slitPts[k], b = slitPts[k + 1];
    mouthLine.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  }
  mouthLine.push(slitPts[slitPts.length - 1]);
  return {
    field: skull, mouthLine, eye, earAt,
    // the lids on the squashed eye: the almond's opening comes from the eye's own shape, the lids just frame it
    lid: { upper: 0.9 + X.lid * 0.5 + age * 0.08, lower: 0.9 + X.lower * 0.5 },   // about 20 mm of eye showing: twice as wide as tall
    bounds: [[-0.13, -0.31, -0.16], [0.13, S.crown + 0.02, 0.11]],
  };
}
