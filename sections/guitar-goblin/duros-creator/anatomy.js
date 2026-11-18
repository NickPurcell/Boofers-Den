// The Duros figure as signed distance shapes, in metres, y up, facing +z, the floor at y = 0.
// SW5e and the old lore describe Duros as tall, slender, hairless and smooth-skinned, blue to green, with large red
// eyes, no nose and a lipless-looking slit of a mouth. Everything here is our own shape-making.
import { sphere, ellipsoid, capsule, roundCone, roundBox, smin, ssub, mirrorX, chain, near } from './sdf.js';

export const HEAD_AT = [0, 1.715, 0];   // the eye line, between the eyes

export const HEAD_SHAPES = {
  round: { crW: 0.088, crH: 0.112, crD: 0.100, crY: 0.050, crZ: -0.022, fw: 1.0, jaw: 1.0 },
  tall: { crW: 0.089, crH: 0.135, crD: 0.112, crY: 0.072, crZ: -0.040, fw: 1.0, jaw: 0.97 },
  narrow: { crW: 0.078, crH: 0.122, crD: 0.100, crY: 0.058, crZ: -0.026, fw: 0.9, jaw: 0.9 },
};
// expression: where the mouth corners sit, how the brow's inner ends move, how open the lids are
export const EXPRESSIONS = {
  neutral: { corner: 0, brow: 0, lid: 0, lower: 0 },
  smile: { corner: 0.0055, brow: 0.001, lid: 0.06, lower: 0.18 },
  stern: { corner: -0.0025, brow: -0.006, lid: 0.22, lower: 0.05 },
  wary: { corner: -0.001, brow: 0.004, lid: -0.12, lower: 0 },
};

// the head and neck in the head's own frame (origin between the eyes); returns the field and the face's landmarks
export function headField(shapeKey = 'round', exprKey = 'neutral', age = 0) {
  const S = HEAD_SHAPES[shapeKey] || HEAD_SHAPES.round, X = EXPRESSIONS[exprKey] || EXPRESSIONS.neutral, fw = S.fw;
  const eye = { x: 0.0385 * fw, y: 0.0, z: 0.069, r: 0.0258 };
  const cranium = ellipsoid(0, S.crY, S.crZ, S.crW, S.crH, S.crD);
  const forehead = ellipsoid(0, 0.022, 0.03, 0.079 * fw, 0.07, 0.07);
  const occiput = ellipsoid(0, -0.025, -0.06, 0.066 * fw, 0.06, 0.06);
  const midface = ellipsoid(0, -0.042, 0.026, 0.063 * fw, 0.052, 0.054);
  const jaw = roundCone([0, -0.035, -0.014], [0, -0.104, 0.04], 0.053 * fw * S.jaw, 0.018);
  const jawSide = mirrorX(capsule([0.056 * fw * S.jaw, -0.04, -0.03], [0.026 * fw, -0.1, 0.034], 0.014));
  const chin = ellipsoid(0, -0.106, 0.049, 0.016, 0.013, 0.014);
  const cheek = mirrorX(ellipsoid(0.05 * fw, -0.026, 0.049, 0.026, 0.017, 0.022));
  const cheekPlane = mirrorX(ellipsoid(0.042 * fw, -0.06, 0.05, 0.022, 0.03, 0.02));   // the flat planes down to the jaw
  const brow = mirrorX(capsule([0.009, 0.031 + X.brow, 0.086], [0.064 * fw, 0.038, 0.054], 0.0105));
  const muzzle = ellipsoid(0, -0.071, 0.053, 0.029, 0.019, 0.025);
  // the mouth: two thin lips round a slit, the corners moved by the expression
  const cy = X.corner, mz = 0.0725;
  const cornerL = [-0.024, -0.0785 + cy, mz], cornerR = [0.024, -0.0785 + cy, mz];
  const upper = near([0, -0.079, 0.08], 0.03, chain([cornerL, [-0.012, -0.0758 + cy * 0.3, 0.0786], [0, -0.0754, 0.0806], [0.012, -0.0758 + cy * 0.3, 0.0786], cornerR], 0.0024));
  const lower = near([0, -0.079, 0.08], 0.03, chain([cornerL, [-0.011, -0.0822 + cy * 0.4, 0.0776], [0, -0.0828, 0.0792], [0.011, -0.0822 + cy * 0.4, 0.0776], cornerR], 0.0029));
  const slit = near([0, -0.079, 0.08], 0.03, chain([[-0.0255, -0.0789 + cy, mz - 0.002], [-0.012, -0.079 + cy * 0.35, 0.0802], [0, -0.0791, 0.0826], [0.012, -0.079 + cy * 0.35, 0.0802], [0.0255, -0.0789 + cy, mz - 0.002]], 0.001));
  const slitDeep = near([0, -0.079, 0.075], 0.03, chain([[-0.018, -0.0789 + cy * 0.8, 0.067], [0, -0.079, 0.075], [0.018, -0.0789 + cy * 0.8, 0.067]], 0.0015));
  const cornerDimple = mirrorX(sphere(0.0262, -0.0785 + cy, 0.071, 0.0021));
  // the eye sockets, the ear holes, the neck and its two long muscles
  const socket = mirrorX(sphere(eye.x, eye.y + 0.0008, eye.z + 0.0015, eye.r + 0.0019));
  const earAt = [S.crW * 0.985, -0.014, S.crZ * 0.6 - 0.012];
  const earHole = mirrorX(near(earAt, 0.02, sphere(earAt[0] + 0.0045, earAt[1], earAt[2], 0.0058)));
  const earRim = mirrorX(near(earAt, 0.025, ellipsoid(earAt[0] - 0.003, earAt[1], earAt[2], 0.0045, 0.0105, 0.009)));
  const neck = roundCone([0, -0.06, -0.032], [0, -0.3, -0.026], 0.041 * fw, 0.05);
  const neckMuscle = mirrorX(capsule([0.052 * fw, -0.055, -0.04], [0.015, -0.262, 0.03], 0.0098));
  const nape = capsule([0, -0.07, -0.06], [0, -0.28, -0.06], 0.028);
  // age: a little sag under the eyes and at the jaw line, grooves from the mouth corners
  const bags = age > 0.2 ? mirrorX(ellipsoid(eye.x, eye.y - 0.025, eye.z + 0.006, 0.017, 0.006 + age * 0.003, 0.008)) : null;
  let skull = smin(0.03, cranium, forehead, occiput);
  skull = smin(0.028, skull, midface, jaw);
  skull = smin(0.018, skull, jawSide, chin, cheek, cheekPlane);
  skull = smin(0.016, skull, brow);
  skull = smin(0.014, skull, muzzle);
  if (bags) skull = smin(0.01, skull, bags);
  skull = smin(0.03, skull, neck, nape);
  skull = smin(0.016, skull, neckMuscle);
  skull = smin(0.006, skull, earRim);
  skull = ssub(0.004, skull, earHole);
  skull = ssub(0.006, skull, socket);
  skull = smin(0.0034, skull, upper, lower);
  skull = ssub(0.0026, skull, slitDeep);
  skull = ssub(0.0025, skull, cornerDimple);
  if (age > 0.35) {   // nasolabial grooves on an older face
    const groove = mirrorX(chain([[0.024 * fw, -0.045, 0.081], [0.03 * fw, -0.066, 0.076], [0.029 * fw, -0.088, 0.07]], 0.0014 + age * 0.0012));
    skull = ssub(0.004, skull, groove);
  }
  // the mouth line, corner to corner, for a thin dark tube laid where the lips meet
  const mouthLine = [[-0.0262, -0.0786 + cy, mz - 0.003], [-0.019, -0.0789 + cy * 0.7, 0.0775], [-0.01, -0.079 + cy * 0.3, 0.0815], [0, -0.0791, 0.0832], [0.01, -0.079 + cy * 0.3, 0.0815], [0.019, -0.0789 + cy * 0.7, 0.0775], [0.0262, -0.0786 + cy, mz - 0.003]];
  return {
    field: skull,
    mouthLine,
    eye, earAt,
    lid: { upper: 1.24 + X.lid * 0.4 + age * 0.06, lower: 0.86 + X.lower * 0.5 },   // how far (radians from the pole) each lid reaches
    bounds: [[-0.115, -0.31, -0.17], [0.115, S.crY + S.crH + 0.012, 0.12]],
  };
}

// the body below the head, in the figure's frame: shoulders, chest, arms down to the wrists, hips to mid-thigh
export function bodyField(build = 1) {
  const b = build, H = HEAD_AT[1];
  const chest = ellipsoid(0, 1.365, 0.0, 0.15 * b, 0.145, 0.092 + (b - 1) * 0.04);
  const pecs = mirrorX(ellipsoid(0.058 * b, 1.405, 0.04, 0.066 * b, 0.04, 0.028));   // a spacer's flat chest, not a strongman's
  const belly = ellipsoid(0, 1.19, 0.004, 0.126 * b, 0.15, 0.086 + (b - 1) * 0.03);
  const pelvis = ellipsoid(0, 1.0, -0.005, 0.145 * b, 0.11, 0.1);
  const traps = mirrorX(capsule([0.034, 1.53, -0.035], [0.165 * b, 1.49, -0.012], 0.028));
  const delt = mirrorX(sphere(0.188 * b, 1.462, -0.006, 0.044 + (b - 1) * 0.025));
  const clav = mirrorX(capsule([0.02, 1.505, 0.055], [0.15 * b, 1.495, 0.026], 0.0085));
  const neckBase = roundCone([0, 1.47, -0.02], [0, 1.53, -0.026], 0.06, 0.05);
  // relaxed arms, a little out from the sides, elbows soft
  const sh = [0.198 * b, 1.452, -0.008], el = [0.238 * b, 1.18, -0.022], wr = [0.262 * b, 0.94, 0.02];
  const upperArm = mirrorX(roundCone(sh, el, 0.043 + (b - 1) * 0.02, 0.033 + (b - 1) * 0.01));
  const biceps = mirrorX(ellipsoid(0.214 * b, 1.33, 0.01, 0.026, 0.07, 0.026));
  const forearm = mirrorX(roundCone(el, wr, 0.033 + (b - 1) * 0.01, 0.022));
  const forearmMass = mirrorX(ellipsoid(0.246 * b, 1.11, -0.004, 0.03, 0.07, 0.028));
  const thigh = mirrorX(roundCone([0.085 * b, 0.95, 0.0], [0.1 * b, 0.6, 0.012], 0.078, 0.06));
  let body = smin(0.05, chest, belly, pelvis);
  body = smin(0.025, body, pecs, clav);
  body = smin(0.04, body, traps, neckBase);
  body = smin(0.035, body, delt);
  body = smin(0.03, body, upperArm, biceps);
  body = smin(0.025, body, forearm, forearmMass);
  body = smin(0.04, body, thigh);
  return { field: body, shoulder: sh, elbow: el, wrist: wr, bounds: [[-0.33 * b - 0.03, 0.56, -0.17], [0.33 * b + 0.03, 1.585, 0.17]] };
}

// a hand at the end of the arm: a long palm, four long fingers and a thumb, relaxed and curled a little, palm in.
// Built in the hand's frame (x across the palm, thumb at +x; y down the hand is -y; z out of the palm), then hung
// from the wrist with the palm toward the thigh and the thumb forward.
export function handField(side, build = 1) {
  const s = side;   // +1 the figure's left (screen right), -1 its right
  const w = [0.262 * build * s, 0.936, 0.02];
  const parts = [];
  parts.push(roundBox(0, -0.047, -0.001, 0.033, 0.045, 0.0105, 0.0095));   // palm
  parts.push(ellipsoid(0.004, -0.012, 0, 0.025, 0.02, 0.0135));            // heel of the hand
  parts.push(ellipsoid(0.026, -0.04, 0.006, 0.014, 0.026, 0.01));           // the thumb's pad
  const fingers = [[0.024, 0.08, 0.0064], [0.008, 0.088, 0.0067], [-0.008, 0.084, 0.0064], [-0.023, 0.07, 0.0057]];
  for (const [fx, len, r] of fingers) {
    const k0 = [fx, -0.086, 0.001], k1 = [fx * 1.04, -0.086 - len * 0.44, 0.006], k2 = [fx * 1.07, -0.086 - len * 0.76, 0.017], k3 = [fx * 1.08, -0.086 - len * 0.98, 0.033];
    parts.push(chain([k0, k1, k2, k3], (i) => r * (1 - i * 0.13)));
    parts.push(sphere(k1[0], k1[1], k1[2] - 0.001, r * 1.1), sphere(k2[0], k2[1], k2[2] - 0.001, r * 0.98));   // knuckles
  }
  parts.push(chain([[0.026, -0.022, 0.004], [0.044, -0.05, 0.018], [0.05, -0.078, 0.032], [0.046, -0.098, 0.043]], (i) => 0.0088 - i * 0.0013));
  parts.push(roundCone([0, 0.0, 0], [-0.012, 0.069, 0.0069], 0.0205, 0.0215));   // the wrist, reaching up the forearm into the sleeve
  const local = smin(0.007, ...parts);
  // world -> hand: lx along +z (thumb forward), ly along y, lz toward the body's midline
  const field = (x, y, z) => local(z - w[2], y - w[1], -s * (x - w[0]));
  const lo = [w[0] - 0.065, w[1] - 0.215, w[2] - 0.04], hi = [w[0] + 0.065, w[1] + 0.1, w[2] + 0.08];
  return { field, bounds: [[Math.min(lo[0], hi[0]), lo[1], lo[2]], [Math.max(lo[0], hi[0]), hi[1], hi[2]]], wrist: w };
}
