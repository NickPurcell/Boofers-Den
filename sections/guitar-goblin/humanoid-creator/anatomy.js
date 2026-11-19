// The humanoid figure below the head, as signed distance shapes: torso, arms, legs and hands, in metres, y up,
// facing +z, the floor at y = 0 and the eyes at y = 1.63. Three numbers shape it: how masculine the frame is (0 to 1:
// narrower shoulders, a bust and wider hips at 0; broad shoulders and a flat chest at 1), how strongly built (0 slight,
// 1 strong, up to 1.3 heavy: a big man's deep chest, thick neck and arms, and some belly) and how much wider the
// shoulders are than the frame and build make them (metres, either way). Pure: a worker can import it.
import { sphere, ellipsoid, capsule, roundCone, roundBox, smin, mirrorX, chain } from '../duros-creator/sdf.js';
import { headField } from './head-field.js';
import { extraFor } from './features.js';

export const HEAD_AT = [0, 1.63, 0];   // where the head goes: the point between the eyes (9 cm of neck shows under the chin)
const c01 = (v, d) => Math.max(0, Math.min(1, v ?? d));

// the joints and landmarks of a frame, on the figure's left (mirror x for the right)
export function skeleton(o = {}) {
  const m = c01(o.masc, 0.5), b = Math.max(0, Math.min(1.4, o.build ?? 0.5)), hv = Math.max(0, b - 1) / 0.3, sx = 0.166 + 0.032 * m + 0.01 * Math.min(b, 1) + 0.012 * hv + (+o.shoulders || 0);
  return {
    m, b, hv, sx,
    shoulder: [sx + 0.006, 1.37, -0.008], elbow: [sx + 0.046, 1.1, -0.02], wrist: [sx + 0.073, 0.865, 0.02],
    hip: [0.088 + 0.006 * (1 - m), 0.86, 0], knee: [0.094, 0.49, 0.012], ankle: [0.1, 0.09, -0.014],
    neckBase: [0, 1.44, -0.014], throat: [0, 1.425, 0.05], sternum: [0, 1.36, 0.085 + 0.012 * m + 0.012 * b], chest: [0, 1.29, 0.1],
    navel: [0, 1.08, 0.088], waistY: 1.07 + 0.02 * (1 - m), hipY: 0.95, crotchY: 0.8, kneeY: 0.49, ankleY: 0.09,
  };
}

export function bodyField(o = {}) {
  const S = skeleton(o), { m, b, hv, sx } = S, f = 1 - m, nk = 1 + 0.18 * Math.max(0, b - 0.5);   // hv: how far past strong toward heavy
  const chest = ellipsoid(0, 1.3, -0.004, 0.127 + 0.027 * m + 0.012 * b + 0.012 * hv, 0.135 + 0.005 * hv, 0.087 + 0.014 * m + 0.014 * b + 0.016 * hv);
  const belly = ellipsoid(0, 1.13, 0.002, 0.108 + 0.022 * m + 0.018 * b - 0.01 * f + 0.018 * hv, 0.15, 0.082 + 0.01 * m + 0.018 * b + 0.026 * hv);
  const pelvis = ellipsoid(0, 0.95, -0.006, 0.143 - 0.004 * m + 0.008 * b + 0.016 * f + 0.008 * hv, 0.115, 0.098 + 0.008 * b + 0.006 * f + 0.01 * hv);
  const glutes = mirrorX(ellipsoid(0.07, 0.905, -0.062, 0.074, 0.082, 0.058 + 0.01 * f + 0.006 * b));
  // shoulders slope from the neck down to the point of the shoulder, which is 23 cm below the eyes
  const traps = mirrorX(capsule([0.035, 1.452 + 0.006 * hv, -0.03], [sx - 0.035, 1.392, -0.012], 0.026 + 0.008 * m + 0.006 * b + 0.012 * hv));
  const delt = mirrorX(sphere(sx, 1.376, -0.006, 0.044 + 0.012 * m + 0.01 * b + 0.012 * hv));
  const clav = mirrorX(capsule([0.02, 1.43, 0.05], [sx - 0.035, 1.404, 0.02], 0.0085));
  const neckBase = roundCone([0, 1.4, -0.018], [0, 1.47, -0.022], (0.063 + 0.006 * m) * nk, (0.052 + 0.005 * m) * nk);
  let body = smin(0.05, chest, belly, pelvis);
  body = smin(0.04, body, glutes);
  if (m > 0.3) body = smin(0.025, body, mirrorX(ellipsoid(0.06 + 0.006 * m, 1.33, 0.046, 0.066, 0.045, 0.024 + 0.012 * m * (0.5 + b * 0.6))));          // a man's flat chest muscles
  if (f > 0.3) { const g = 0.62 + 0.42 * ((f - 0.3) / 0.7) * (0.85 + 0.3 * b); body = smin(0.022, body, mirrorX(ellipsoid(0.062, 1.262, 0.054 + 0.016 * g, 0.05 * g, 0.047 * g, 0.043 * g))); }   // a bust
  body = smin(0.025, body, clav);
  body = smin(0.04, body, traps, neckBase);
  body = smin(0.035, body, delt);
  // relaxed arms, a little out from the sides, elbows soft
  const sh = S.shoulder, el = S.elbow, wr = S.wrist, ar = 0.008 * m + 0.01 * b + 0.012 * hv;
  body = smin(0.03, body, mirrorX(roundCone(sh, el, 0.042 + ar, 0.033 + ar * 0.6)), mirrorX(ellipsoid(sx + 0.022, 1.25, 0.008, 0.026 + ar * 0.5, 0.07, 0.027 + ar * 0.5)));
  body = smin(0.025, body, mirrorX(roundCone(el, wr, 0.034 + ar * 0.6, 0.0235 + 0.003 * m)), mirrorX(ellipsoid(sx + 0.055, 1.03, -0.004, 0.03 + ar * 0.4, 0.07, 0.029)));
  // legs standing a little apart, and a foot for a boot to be built round
  const hp = S.hip, kn = S.knee, an = S.ankle, lr = 0.008 * b + 0.012 * hv;
  body = smin(0.045, body, mirrorX(roundCone(hp, kn, 0.084 + lr + 0.007 * f, 0.056 + lr * 0.6)));
  body = smin(0.03, body, mirrorX(roundCone(kn, an, 0.055 + lr * 0.6, 0.037)), mirrorX(ellipsoid(0.097, 0.36, -0.03, 0.045 + lr * 0.5, 0.1, 0.045)));
  body = smin(0.02, body, mirrorX(roundCone([0.1, 0.045, -0.035], [0.104, 0.03, 0.14], 0.043, 0.03)));
  return { field: body, S, bounds: [[-(sx + 0.16), 0, -0.2], [sx + 0.16, 1.5, 0.2]] };
}

// A hand at the end of the arm: a palm, four fingers and a thumb, relaxed and curled a little, palm toward the thigh.
// Built in the hand's own frame (x across the palm, thumb at +x; -y down the hand; z out of the palm).
export function handField(side, o = {}) {
  const S = skeleton(o), s = side, k = 0.94 + 0.08 * S.m + 0.03 * S.b;   // a hand's size
  const w = [S.wrist[0] * s, S.wrist[1] - 0.004, S.wrist[2]], parts = [];
  parts.push(roundBox(0, -0.045 * k, -0.001, 0.034 * k, 0.043 * k, 0.0115 * k, 0.0105 * k));    // palm
  parts.push(ellipsoid(0.004, -0.012 * k, 0, 0.026 * k, 0.02, 0.0145 * k));                     // heel of the hand
  parts.push(ellipsoid(0.027 * k, -0.04 * k, 0.006, 0.015 * k, 0.026 * k, 0.011 * k));          // the thumb's pad
  const fingers = [[0.0245, 0.066, 0.0078], [0.0085, 0.074, 0.0082], [-0.0085, 0.069, 0.0078], [-0.0235, 0.055, 0.0069]];
  for (const [fx0, len0, r0] of fingers) {
    const fx = fx0 * k, len = len0 * k, r = r0 * k, y0 = -0.084 * k;
    const k0 = [fx, y0, 0.001], k1 = [fx * 1.04, y0 - len * 0.44, 0.007], k2 = [fx * 1.07, y0 - len * 0.76, 0.019], k3 = [fx * 1.08, y0 - len * 0.98, 0.034];
    parts.push(chain([k0, k1, k2, k3], (i) => r * (1 - i * 0.11)));
    parts.push(sphere(k1[0], k1[1], k1[2] - 0.001, r * 1.08), sphere(k2[0], k2[1], k2[2] - 0.001, r * 0.98));
  }
  parts.push(chain([[0.027 * k, -0.022 * k, 0.004], [0.045 * k, -0.048 * k, 0.018], [0.051 * k, -0.074 * k, 0.031], [0.047 * k, -0.092 * k, 0.041]], (i) => (0.0102 - i * 0.0014) * k));
  parts.push(roundCone([0, 0, 0], [-0.012, 0.07, 0.007], 0.0225 * k, 0.0235 * k));   // the wrist, reaching up into the sleeve
  const local = smin(0.007, ...parts);
  // world -> hand: the hand's x along +z (thumb forward), its y up, its z toward the body's midline
  const field = (x, y, z) => local(z - w[2], y - w[1], -s * (x - w[0]));
  return { field, wrist: w, bounds: [[w[0] - 0.066, w[1] - 0.2, w[2] - 0.045], [w[0] + 0.066, w[1] + 0.1, w[2] + 0.085]] };
}

// the whole bare figure as one surface: the head, its neck and the body, joined softly
export function skinField(o = {}) {
  const head = headField({ ...o, extra: extraFor(o) }), body = bodyField(o), [hx, hy, hz] = HEAD_AT, hf = head.field;
  // above the jaw the body is too far away to matter, and below the collar the head is; skip whichever it is
  const k = 0.03, bf = body.field;
  const field = (x, y, z) => {
    if (y > hy - 0.03) return hf(x - hx, y - hy, z - hz);
    if (y < hy - 0.33) return bf(x, y, z);
    const a = hf(x - hx, y - hy, z - hz), b = bf(x, y, z), t = Math.max(k - Math.abs(a - b), 0) / k;
    return Math.min(a, b) - t * t * k * 0.25;
  };
  return { field, head, body };
}
