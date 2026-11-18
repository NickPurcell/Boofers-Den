// Head B as signed distance shapes, on the same toolkit as Head A (sdf.js, anatomy.js), in metres from the point
// between the eyes, y up, facing +z. Pure: no DOM and no three.js, so the mesher worker can import it.
//
// Shaped to what the reference pictures of the species agree on (engineer7's reference pass, #65), in our own code:
//  - a tall, broad, bulbous cranium, widest high up and almost a rounded box, carried well back; in profile the
//    forehead rises nearly straight over a heavy brow;
//  - below the eyes the face tapers hard to a narrow jaw and a small chin;
//  - long, slightly slanted almond eyes hooded by the brow (the almond is made by the lids and the socket; the eye
//    itself is a squashed sphere, see head-sculpt.js), about an eye-width apart;
//  - a heavy brow, lower at the centre in a shallow V, and two to four wavy folds across the forehead;
//  - a long flat central plane from between the eyes to the mouth with a crease down each side; flat-to-hollow cheeks
//    under the cheekbones;
//  - a small thin mouth set low, slightly downturned, under a slight overhang; no lips, no nose;
//  - an ear opening near eye level; a neck of ordinary thickness (to the clothes' measurements, as A's).
import { sphere, ellipsoid, capsule, roundCone, roundBox, smin, ssub, mirrorX, chain, near, rotate, rotZ, cast } from './sdf.js';

export const HEAD_B_SHAPES = {
  // cranium half-width / half-height / half-depth, its centre's height and how far back it sits, the face's width
  round: { crW: 0.098, crH: 0.112, crD: 0.112, crY: 0.07, crZ: -0.038, fw: 1.0, jaw: 1.0, folds: 3 },
  tall: { crW: 0.098, crH: 0.132, crD: 0.118, crY: 0.09, crZ: -0.05, fw: 1.0, jaw: 0.97, folds: 4 },
  narrow: { crW: 0.088, crH: 0.12, crD: 0.11, crY: 0.078, crZ: -0.042, fw: 0.9, jaw: 0.9, folds: 3 },
};
// the mouth's corners (up +), the brow's inner ends (up +) and outer ends, the lids (how far over the eye, radians),
// the cheeks lifting, the mouth's width
export const EXPRESSIONS_B = {
  neutral: { corner: 0, brow: 0, browOut: 0, lid: 0, lower: 0, cheek: 0, width: 1 },
  smile: { corner: 0.0055, brow: 0.0015, browOut: 0.001, lid: 0.02, lower: 0.18, cheek: 0.003, width: 1.1 },
  stern: { corner: -0.003, brow: -0.006, browOut: 0.002, lid: 0.22, lower: 0.06, cheek: 0, width: 0.95 },
  wary: { corner: -0.0012, brow: 0.005, browOut: -0.001, lid: -0.12, lower: 0.05, cheek: 0, width: 0.9 },
};
const translateIn = (f, d) => (x, y, z) => f(x, y, z) + d;   // shrink a shape by d, so a cut with it goes d less deep

export function headBField(shapeKey = 'round', exprKey = 'neutral', age = 0) {
  const S = HEAD_B_SHAPES[shapeKey] || HEAD_B_SHAPES.round, X = EXPRESSIONS_B[exprKey] || EXPRESSIONS_B.neutral, fw = S.fw;
  age = Math.max(0, Math.min(1, +age || 0));
  const old = Math.max(0, (age - 0.5) / 0.5);
  // the eyes: an almond about twice as wide as tall, tilted up at the outer corner, an eye-width apart
  const eye = { x: 0.0525 * fw, y: 0.0, z: 0.05, r: 0.0235, sx: 1.32, sy: 0.82, tilt: 0.2 };

  /* ---- the skull: broad and bulbous, widest high up, carried back; the forehead rising almost straight ---- */
  const cranium = roundBox(0, S.crY, S.crZ, S.crW, S.crH, S.crD, 0.085);                         // the rounded box
  const crown = mirrorX(ellipsoid(0.042 * fw, S.crY + S.crH * 0.35, S.crZ - 0.005, 0.07, 0.075, 0.1));   // width high up
  const back = ellipsoid(0, S.crY - 0.01, S.crZ - 0.035, 0.085 * fw, 0.1, 0.085);                 // carried well back
  const forehead = roundBox(0, 0.06, 0.02, 0.078 * fw, 0.055, 0.045, 0.04);                       // the near-upright front
  const occiput = ellipsoid(0, -0.02, -0.075, 0.066 * fw, 0.06, 0.06);

  /* ---- the face: a heavy brow over the eyes, then a hard taper to a narrow jaw and small chin ---- */
  const browPlate = ellipsoid(0, 0.024, 0.056, 0.074 * fw, 0.024, 0.024);
  const brow = mirrorX(chain([[0.004, 0.017 + X.brow, 0.074], [0.03 * fw, 0.025 + X.brow * 0.5, 0.072], [0.062 * fw, 0.032 + X.browOut, 0.06], [0.085 * fw, 0.03 + X.browOut, 0.036]], 0.0115 + 0.0012 * age));
  const midface = ellipsoid(0, -0.03, 0.022, 0.07 * fw, 0.045, 0.048);
  const lowerFace = roundCone([0, -0.035, 0.004], [0, -0.118, 0.03], 0.055 * fw * S.jaw, 0.011);
  const jawSide = mirrorX(capsule([0.066 * fw * S.jaw, -0.028, -0.03], [0.018 * fw, -0.116, 0.026], 0.011));
  const chin = ellipsoid(0, -0.122, 0.032, 0.011, 0.009, 0.01);
  const cheekbone = mirrorX(ellipsoid(0.062 * fw, -0.03 + X.cheek, 0.032, 0.022, 0.012, 0.018));
  // the long flat central plane from between the eyes down to the mouth
  const plane = roundBox(0, -0.045, 0.054, 0.019 * fw, 0.048, 0.01, 0.009);
  // the mouth's slight overhang
  const overhang = ellipsoid(0, -0.092, 0.05, 0.02, 0.008, 0.012);

  /* ---- carved in ---- */
  // the sockets: the almond, tilted, under the brow
  const socket = mirrorX(rotate(ellipsoid(eye.x, eye.y + 0.001, eye.z + 0.002, eye.r * eye.sx + 0.0025, eye.r * eye.sy + 0.0025, eye.r + 0.002), rotZ(-eye.tilt), [eye.x, eye.y, eye.z]));
  // the creases down each side of the central plane
  const crease = mirrorX(chain([[0.024 * fw, -0.012, 0.066], [0.025 * fw, -0.04, 0.066], [0.022 * fw, -0.07, 0.062], [0.019 * fw, -0.085, 0.058]], 0.0028));
  // flat-to-hollow cheeks under the cheekbones (a little deeper with age)
  const hollow = mirrorX(ellipsoid(0.058 * fw, -0.062, 0.04, 0.02, 0.022, 0.0035 + 0.0025 * old));
  const temple = mirrorX(ellipsoid(0.09 * fw, 0.035, 0.0, 0.024, 0.034, 0.003 + 0.003 * age));
  // the mouth: small, thin, set low, slightly downturned; a shallow closed cut (under 2 mm)
  const cy = X.corner - 0.0022, mz = 0.052, my = -0.1, w = 0.018 * X.width;
  const slitPts = [[-w, my + cy, mz - 0.006], [-w * 0.5, my + cy * 0.3 + 0.0005, mz + 0.0008], [0, my + 0.0008, mz + 0.0022], [w * 0.5, my + cy * 0.3 + 0.0005, mz + 0.0008], [w, my + cy, mz - 0.006]];
  const slit = near([0, my, mz], 0.028, chain(slitPts, 0.0009));
  const lipLo = near([0, my, mz], 0.028, chain(slitPts.map(([x, y, z]) => [x * 0.85, y - 0.0052, z - 0.0008]), 0.0016));
  const cornerDimple = mirrorX(sphere(w + 0.001, my + cy, mz - 0.0065, 0.0017));

  /* ---- the neck (to the clothes' measurements, as A's), its long muscles, the nape ---- */
  const neck = roundCone([0, -0.06, -0.032], [0, -0.3, -0.026], 0.041 * fw, 0.05);
  const neckMuscle = mirrorX(capsule([0.056 * fw, -0.05, -0.04], [0.015, -0.262, 0.03], 0.0095));
  const nape = capsule([0, -0.07, -0.062], [0, -0.28, -0.06], 0.028);
  const bags = old > 0 ? mirrorX(ellipsoid(eye.x, eye.y - 0.027, eye.z - 0.004, 0.028, 0.005, 0.0022 + 0.0012 * old)) : null;

  let skull = smin(0.04, cranium, crown, back, forehead, occiput);
  skull = smin(0.026, skull, browPlate, midface, lowerFace);
  skull = smin(0.016, skull, jawSide, chin, cheekbone);
  skull = smin(0.012, skull, brow);
  skull = smin(0.012, skull, plane);
  skull = smin(0.01, skull, overhang);
  if (bags) skull = smin(0.022, skull, bags);
  skull = smin(0.03, skull, neck, nape);
  skull = smin(0.016, skull, neckMuscle);
  skull = ssub(0.026, skull, temple);
  skull = ssub(0.026, skull, hollow);
  skull = ssub(0.008, skull, translateIn(crease, 0.0016));
  skull = ssub(0.006, skull, socket);
  skull = smin(0.005, skull, lipLo);
  skull = ssub(0.0018, skull, slit);
  skull = ssub(0.0022, skull, cornerDimple);

  // the forehead's wavy folds: shallow grooves laid on the surface as built, from temple to temple above the brow
  {
    const folds = [];
    for (let k = 0; k < S.folds; k++) {
      const yb = 0.05 + k * 0.016, pts = [];
      for (let t = -1; t <= 1.0001; t += 0.125) {
        const x = t * 0.058 * fw * (1 - k * 0.06), y = yb + 0.004 * Math.sin(t * Math.PI * 2.2 + k) - 0.006 * (1 - t * t);
        const hit = cast(skull, [x, y, 0.25], [0, 0, -1], 0.4);
        if (hit) pts.push(hit.p);
      }
      if (pts.length > 3) folds.push(chain(pts, 0.0026 - k * 0.0002));
    }
    for (const f of folds) skull = ssub(0.006, skull, translateIn(f, 0.0017 - 0.0007 * age));
  }
  // the ear openings, near eye level and back, set onto the surface as built: small holes with a low rim
  let earAt;
  {
    const hit = cast(skull, [0.25, -0.008, -0.036], [-1, 0, 0], 0.4);
    earAt = hit ? hit.p : [S.crW * 0.95, -0.008, -0.036];
    const n = hit ? hit.n : [1, 0, 0], at = (k) => [earAt[0] + n[0] * k, earAt[1] + n[1] * k, earAt[2] + n[2] * k];
    const holeC = at(0.0022), rimC = at(-0.0016);
    skull = smin(0.004, skull, mirrorX(near(earAt, 0.018, ellipsoid(rimC[0], rimC[1], rimC[2], 0.0022, 0.0058, 0.0052))));
    skull = ssub(0.003, skull, mirrorX(near(earAt, 0.016, sphere(holeC[0], holeC[1], holeC[2], 0.0036))));
  }
  if (old > 0) {   // an elder's lines beside the central plane toward the mouth: broad and shallow
    const groove = mirrorX(chain([[0.034 * fw, -0.05, 0.058], [0.036 * fw, -0.07, 0.054], [0.034 * fw, -0.086, 0.05]], 0.0032));
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
    // the almond: the lids come well over the eye from above and below
    lid: { upper: 1.02 + X.lid * 0.4 + age * 0.06, lower: 1.0 + X.lower * 0.5 },
    bounds: [[-0.13, -0.31, -0.2], [0.13, S.crY + S.crH + 0.02, 0.1]],
  };
}
