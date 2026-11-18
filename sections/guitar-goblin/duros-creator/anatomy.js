// The Duros figure as signed distance shapes, in metres, y up, facing +z, the floor at y = 0.
// SW5e and the old lore describe Duros as tall, slender, hairless and smooth-skinned, blue to green, with large red
// eyes, no nose and a lipless-looking slit of a mouth. Everything here is our own shape-making.
import { sphere, ellipsoid, capsule, roundCone, roundBox, smin, ssub, mirrorX, chain, near } from './sdf.js';

export const HEAD_AT = [0, 1.715, 0];   // where the head goes: the point between the eyes

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
