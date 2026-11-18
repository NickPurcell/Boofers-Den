// Head B as signed distance shapes, on the same toolkit as Head A (sdf.js, anatomy.js), in metres from the point
// between the eyes, y up, facing +z. Pure: no DOM and no three.js, so the mesher worker can import it.
//
// B's look, kept from the sphere version: the inverted egg (a big high cranium swept back from the brow, wide across
// the eyes, tapering to a small chin), a face that stays fairly flat (no muzzle pushing forward), large wide-set eyes,
// and a lipless mouth: a thin slit with only a soft line above and below. Brought over from A: ear openings with a
// rim, the neck and its two long muscles, a jaw line, cheek planes and brow ridges. Age and expression move landmarks.
import { sphere, ellipsoid, capsule, roundCone, smin, ssub, mirrorX, chain, near, rotate, rotX } from './sdf.js';

export const HEAD_B_SHAPES = {
  round: { crW: 0.094, crH: 0.128, crD: 0.112, crY: 0.058, crZ: -0.035, fw: 1.0, jaw: 1.0, tilt: 0.28 },
  tall: { crW: 0.094, crH: 0.15, crD: 0.12, crY: 0.078, crZ: -0.052, fw: 1.0, jaw: 0.97, tilt: 0.34 },
  narrow: { crW: 0.083, crH: 0.138, crD: 0.11, crY: 0.064, crZ: -0.04, fw: 0.9, jaw: 0.9, tilt: 0.3 },
};
// mouth corners up (+) or down, the brows' inner ends up or down, how far each lid comes over the eye (radians), and
// for a smile the cheeks lifting
export const EXPRESSIONS_B = {
  neutral: { corner: 0, brow: 0, browOut: 0, lid: 0, lower: 0, cheek: 0, width: 1 },
  smile: { corner: 0.0065, brow: 0.0015, browOut: 0, lid: 0.04, lower: 0.2, cheek: 0.003, width: 1.08 },
  stern: { corner: -0.003, brow: -0.0075, browOut: 0.002, lid: 0.26, lower: 0.06, cheek: 0, width: 0.96 },
  wary: { corner: -0.0012, brow: 0.0055, browOut: -0.001, lid: -0.14, lower: 0.04, cheek: 0, width: 0.9 },
};

export function headBField(shapeKey = 'round', exprKey = 'neutral', age = 0) {
  const S = HEAD_B_SHAPES[shapeKey] || HEAD_B_SHAPES.round, X = EXPRESSIONS_B[exprKey] || EXPRESSIONS_B.neutral, fw = S.fw;
  age = Math.max(0, Math.min(1, +age || 0));
  // the eyes: large, wide-set, set a little back in the flat face
  const eye = { x: 0.0445 * fw, y: 0.0, z: 0.058, r: 0.0305 };

  // the skull: the cranium as a big ellipsoid tipped back from the brow, a broad forehead over the eyes, the back
  const cranium = rotate(ellipsoid(0, S.crY, S.crZ, S.crW, S.crH, S.crD), rotX(-S.tilt), [0, 0, 0]);
  const forehead = ellipsoid(0, 0.024, 0.022, 0.088 * fw, 0.072, 0.07);
  const occiput = ellipsoid(0, -0.02, -0.07, 0.07 * fw, 0.062, 0.062);
  // the face below the eyes: wide at the cheekbones, tapering to the chin, staying flat at the front
  const midface = ellipsoid(0, -0.036, 0.016, 0.072 * fw, 0.05, 0.05);
  const lowerFace = roundCone([0, -0.04, 0.0], [0, -0.112, 0.03], 0.058 * fw * S.jaw, 0.014);
  const jawSide = mirrorX(capsule([0.064 * fw * S.jaw, -0.03, -0.03], [0.022 * fw, -0.108, 0.03], 0.012 * (1 - 0.15 * age)));
  const chin = ellipsoid(0, -0.115, 0.036, 0.0135, 0.011, 0.012);
  const cheek = mirrorX(ellipsoid(0.058 * fw, -0.03 + X.cheek, 0.038, 0.025, 0.014, 0.02 * (1 - 0.25 * age)));
  const cheekPlane = mirrorX(ellipsoid(0.046 * fw, -0.064, 0.038, 0.022, 0.03, 0.018));
  // the brow: a soft ridge over each eye, its inner end moved by the expression, heavier with age
  const brow = mirrorX(capsule([0.011, 0.036 + X.brow, 0.078], [0.075 * fw, 0.041 + X.browOut, 0.04], 0.0095 + 0.0012 * age));
  // the mouth: a thin slit with a soft line above and below, no lips; the corners moved by the expression
  const cy = X.corner, mz = 0.0655, my = -0.086, w = 0.026 * X.width;
  const slitPts = [[-w, my + cy, mz - 0.006], [-w * 0.5, my + cy * 0.35, mz + 0.0012], [0, my - 0.0003, mz + 0.0028], [w * 0.5, my + cy * 0.35, mz + 0.0012], [w, my + cy, mz - 0.006]];
  const slit = near([0, my, mz], 0.034, chain(slitPts, 0.0011));
  const slitDeep = near([0, my, mz], 0.034, chain([[-w * 0.7, my + cy * 0.8, mz - 0.008], [0, my, mz - 0.003], [w * 0.7, my + cy * 0.8, mz - 0.008]], 0.0016));
  const lipUp = near([0, my, mz], 0.034, chain(slitPts.map(([x, y, z]) => [x * 0.92, y + 0.0052, z - 0.0004]), 0.0016));
  const lipLo = near([0, my, mz], 0.034, chain(slitPts.map(([x, y, z]) => [x * 0.88, y - 0.0058, z - 0.0006]), 0.0019));
  const cornerDimple = mirrorX(sphere(w + 0.0012, my + cy, mz - 0.0065, 0.0019));
  // the sockets the eyes sit in, the ear openings and their rims
  const socket = mirrorX(sphere(eye.x, eye.y + 0.0008, eye.z + 0.0012, eye.r + 0.0021));
  const earAt = [S.crW * 0.93, -0.024, -0.03];
  // a recessed opening with only a low rim (Duros have no outer ear, so the rim must not read as one)
  const earHole = mirrorX(near(earAt, 0.022, sphere(earAt[0] + 0.0048, earAt[1], earAt[2], 0.0062)));
  const earRim = mirrorX(near(earAt, 0.024, ellipsoid(earAt[0] - 0.0048, earAt[1], earAt[2], 0.0032, 0.0085, 0.0074)));
  // the neck, to the clothes' measurements (as A's), its two long muscles, the nape
  const neck = roundCone([0, -0.06, -0.032], [0, -0.3, -0.026], 0.041 * fw, 0.05);
  const neckMuscle = mirrorX(capsule([0.056 * fw, -0.05, -0.04], [0.015, -0.262, 0.03], 0.0095));
  const nape = capsule([0, -0.07, -0.062], [0, -0.28, -0.06], 0.028);
  // with age: bags under the eyes, hollows under the cheekbones and at the temples
  const bags = age > 0.2 ? mirrorX(ellipsoid(eye.x, eye.y - 0.03, eye.z + 0.003, 0.018, 0.006 + age * 0.003, 0.008)) : null;
  const hollow = age > 0.25 ? mirrorX(ellipsoid(0.05 * fw, -0.062, 0.05, 0.016, 0.02, 0.012 * age)) : null;
  const temple = mirrorX(ellipsoid(0.085 * fw, 0.03, 0.01, 0.012, 0.022, 0.012 + 0.004 * age));

  let skull = smin(0.034, cranium, forehead, occiput);
  skull = smin(0.03, skull, midface, lowerFace);
  skull = smin(0.02, skull, jawSide, chin, cheek, cheekPlane);
  skull = smin(0.016, skull, brow);
  if (bags) skull = smin(0.01, skull, bags);
  skull = smin(0.03, skull, neck, nape);
  skull = smin(0.016, skull, neckMuscle);
  skull = smin(0.006, skull, earRim);
  skull = ssub(0.004, skull, earHole);
  skull = ssub(0.012, skull, temple);
  if (hollow) skull = ssub(0.012, skull, hollow);
  skull = ssub(0.006, skull, socket);
  skull = smin(0.005, skull, lipUp, lipLo);
  skull = ssub(0.0024, skull, slit);
  skull = ssub(0.0026, skull, slitDeep);
  skull = ssub(0.0025, skull, cornerDimple);
  if (age > 0.35) {   // lines from beside the cheekbones down toward the mouth's corners
    const groove = mirrorX(chain([[0.028 * fw, -0.048, 0.07], [0.033 * fw, -0.07, 0.066], [0.031 * fw, -0.09, 0.06]], 0.0013 + age * 0.0012));
    skull = ssub(0.004, skull, groove);
  }
  // the mouth line, for a thin dark tube laid in the slit
  const mouthLine = slitPts.map(([x, y, z]) => [x * 1.01, y, z]);
  return {
    field: skull, mouthLine, eye, earAt,
    lid: { upper: 1.22 + X.lid * 0.4 + age * 0.07, lower: 0.84 + X.lower * 0.5 },
    bounds: [[-0.12, -0.31, -0.2], [0.12, S.crY + S.crH + 0.02, 0.11]],
  };
}
