// The human head the humanoid species share, as signed distance shapes (../duros-creator/sdf.js), in metres from the
// point between the eyes, y up, facing +z, the figure's left at +x. Pure: no DOM and no three.js, so a worker can
// import it.
//
// Proportions are an adult's: about 0.23 m from chin to crown with the eyes halfway, 0.15 wide, 0.19 deep; the eyes
// 63 mm apart; the nose ending 48 mm below the eye line and the mouth 68 mm below it; the ears from brow to nose base.
// Three numbers shape a face: its outline (FACES), how masculine the bones are (0 to 1), and age (0 to 1).
// Species add to it through `extra` (shapes joined on, and shapes cut away) without changing anything here.
import { sphere, ellipsoid, capsule, roundCone, smin, ssub, mirrorX, chain, near, rotate, rotY, rotZ, rotX, cast } from '../duros-creator/sdf.js';

export const FACES = {
  // fw: skull and cheek width; jw: jaw width; cw: chin width; len: how long the face is below the eyes; cheek: fullness
  oval: { name: 'Oval', fw: 1.0, jw: 1.0, cw: 1.0, len: 1.0, cheek: 1.0 },
  round: { name: 'Round', fw: 1.045, jw: 1.07, cw: 1.12, len: 0.955, cheek: 1.3 },
  square: { name: 'Square', fw: 1.03, jw: 1.15, cw: 1.22, len: 1.0, cheek: 0.95 },
  long: { name: 'Long', fw: 0.95, jw: 0.96, cw: 0.95, len: 1.065, cheek: 0.88 },
  heart: { name: 'Heart', fw: 1.02, jw: 0.9, cw: 0.78, len: 1.0, cheek: 1.12 },
};
const clamp01 = (v) => Math.max(0, Math.min(1, +v || 0));
const sunk = (f, d) => (x, y, z) => f(x, y, z) + d;   // a shape shrunk by d, so a cut with it is d shallower
// a run of capsules through points, exact at any distance (sdf.js's chain cuts corners far from itself, which shows
// as a faint box when it is blended softly into a face)
const rope = (pts, r) => {
  const segs = []; for (let i = 0; i + 1 < pts.length; i++) segs.push(capsule(pts[i], pts[i + 1], typeof r === 'function' ? r(i) : r));
  return (x, y, z) => { let d = Infinity; for (const f of segs) { const v = f(x, y, z); if (v < d) d = v; } return d; };
};

// Where things are on the face, for whoever adds to it (species features, the face paint, hair): [x, y, z] on the
// figure's left; mirror x for the right. Heights below the eyes are already scaled by the face's length.
export function landmarks(o = {}) {
  const F = FACES[o.face] || FACES.oval, m = clamp01(o.masc ?? 0.5), L = F.len * (0.975 + 0.045 * m), fw = F.fw * (0.975 + 0.05 * m), jw = F.jw * (0.86 + 0.26 * m), cw = F.cw * (0.74 + 0.5 * m);
  const Y = (y) => y * L;
  return {
    L, fw, jw, cw, masc: m,
    eye: [0.0322 * fw, 0, 0.0672], eyeR: 0.0137 - 0.0012 * m,
    browIn: [0.008, 0.019, 0.089], browMid: [0.03 * fw, 0.0235, 0.087], browOut: [0.052 * fw, 0.019, 0.072], temple: [0.066 * fw, 0.03, 0.045],
    cheekbone: [0.052 * fw, Y(-0.022), 0.066], jawHinge: [0.056 * jw, Y(-0.06), 0.0], jawMid: [0.04 * jw, Y(-0.092), 0.04],
    chin: [0, Y(-0.104), 0.086 + 0.003 * m], chinSide: [0.017 * cw, Y(-0.106), 0.074],
    noseTip: [0, Y(-0.0375), 0.1095], noseBase: [0, Y(-0.0485), 0.09], mouth: [0, Y(-0.0678), 0.09], mouthCorner: [0.0255, Y(-0.0682), 0.078],
    ear: [0.0765 * fw, -0.011, -0.014], crown: [0, 0.121, -0.012], hairline: [0, 0.072, 0.074], nape: [0, Y(-0.075), -0.085],
  };
}

export function headField(o = {}) {
  const F = FACES[o.face] || FACES.oval, P = landmarks(o), { L, fw, jw, cw, masc: m } = P;
  const age = clamp01(o.age ?? 0.3), old = Math.max(0, (age - 0.5) / 0.5), Y = (y) => y * L;
  const eye = { x: P.eye[0], y: 0, z: P.eye[2], r: P.eyeR }, es = P.eyeR / 0.013;

  /* ---- the skull ---- */
  const cranium = ellipsoid(0, 0.038, -0.012, 0.0755 * fw, 0.077, 0.093);
  const forehead = ellipsoid(0, 0.03, 0.023, 0.0655 * fw, 0.062, 0.06);
  const occiput = ellipsoid(0, 0.008, -0.046, 0.066 * fw, 0.068, 0.057);

  /* ---- the face's masses ---- */
  const midface = ellipsoid(0, Y(-0.03), 0.025, 0.06 * fw, 0.058, 0.067);
  const cheekPad = mirrorX(ellipsoid(0.031 * fw, Y(-0.05), 0.04, 0.019, 0.026, 0.02 * F.cheek * (1.1 - 0.2 * m)));
  const jawFill = mirrorX(ellipsoid(0.033 * jw, Y(-0.073), 0.028, 0.017, 0.022, 0.03));   // so the cheek runs smoothly down onto the jaw   // the soft of the cheek, between cheekbone, jaw and mouth
  const cheek = mirrorX(ellipsoid(0.044 * fw, Y(-0.021), 0.04, 0.018, 0.012 * F.cheek, 0.016));
  const jawMass = roundCone([0, Y(-0.05), 0.012], [0, Y(-0.094), 0.05], 0.042 * jw, 0.024 * cw);
  const jawLine = mirrorX(capsule([0.04 * jw, Y(-0.077), -0.002], [0.011 * cw, Y(-0.105), 0.062], 0.0098));
  const jawAngle = mirrorX(ellipsoid(0.041 * jw, Y(-0.066), -0.002, 0.009, 0.022, 0.016));
  const chin = ellipsoid(0, Y(-0.1), 0.0735 + 0.003 * m, 0.021 * cw, 0.0145, 0.0165);
  const muzzle = ellipsoid(0, Y(-0.066), 0.061, 0.035, 0.027, 0.0285);
  const masseter = mirrorX(ellipsoid(0.045 * jw, Y(-0.05), 0.008, 0.009, 0.028, 0.024));   // the side of the face between cheekbone and jaw
  const brow = mirrorX(rope([[0.007, 0.0185, 0.0805], [0.026 * fw, 0.0225, 0.08], [0.044 * fw, 0.0218, 0.073], [0.054 * fw, 0.0175, 0.064]], (i) => (0.0028 + 0.003 * m) * [1, 0.92, 0.66][i]));   // thinning to its tail, so it leaves no ledge over the temple
  const glabella = ellipsoid(0, 0.02, 0.0765, 0.016, 0.0095, 0.0092 + 0.002 * m);

  /* ---- the nose ---- */
  const ns = 0.9 + 0.18 * m;
  const bridge = roundCone([0, 0.0, 0.0745], [0, Y(-0.03), 0.0945], 0.0064 * ns, 0.009 * ns);
  const tip = ellipsoid(0, Y(-0.0365), 0.0992, 0.0102 * ns, 0.0086 * ns, 0.0098 * ns);
  const alae = mirrorX(ellipsoid(0.0128 * ns, Y(-0.0418), 0.0878, 0.0078 * ns, 0.0072 * ns, 0.0098));
  const colum = capsule([0, Y(-0.0438), 0.0955], [0, Y(-0.0468), 0.0865], 0.0038);
  const noseSide = mirrorX(capsule([0.008, Y(-0.004), 0.0765], [0.0135, Y(-0.033), 0.082], 0.0075));

  /* ---- the lips: two rolls that meet at the mouth line ---- */
  const lf = (1.3 - 0.5 * m) * (1 - 0.22 * old);
  const upperLip = mirrorX(rope([[0, Y(-0.0628), 0.0902], [0.0085, Y(-0.0621), 0.0894], [0.0175, Y(-0.0647), 0.0852], [0.0248, Y(-0.0674), 0.0788]], (i) => [0.0046, 0.0041, 0.0024][i] * lf));
  const lowerLip = mirrorX(rope([[0, Y(-0.0748), 0.0888], [0.009, Y(-0.0744), 0.0876], [0.018, Y(-0.0716), 0.0842], [0.0248, Y(-0.0684), 0.0788]], (i) => [0.0062, 0.0054, 0.0028][i] * lf));

  let h = smin(0.03, cranium, forehead, occiput);
  h = smin(0.03, h, midface);
  h = smin(0.017, h, cheek, jawMass);
  h = smin(0.02, h, cheekPad, masseter, jawFill);
  h = smin(0.012, h, jawLine, jawAngle, chin);
  h = smin(0.015, h, muzzle);
  h = smin(0.01, h, brow, glabella);
  h = smin(0.0065, h, bridge, noseSide);
  h = smin(0.0042, h, tip, alae, colum);
  h = smin(0.003, h, upperLip, lowerLip);

  /* ---- carved in ---- */
  // the hollow the eye sits in, under the brow and beside the nose; then the opening itself, an almond tipped up a
  // little at the outer corner
  const orbit = mirrorX(ellipsoid(eye.x + 0.001, 0.003, eye.z + 0.012, 0.0205, 0.012, 0.0052));
  h = ssub(0.012, h, orbit);
  const almond = rotate(ellipsoid(0, 0, 0, 0.0166 * es, 0.0079 * es, 0.0098 * es), rotZ(0.09));
  h = ssub(0.0025, h, mirrorX((x, y, z) => almond(x - eye.x, y + 0.0006, z - eye.z - 0.0058)));
  h = ssub(0.0025, h, mirrorX(ellipsoid(0.0062 * ns, Y(-0.0486), 0.0872, 0.003, 0.0026, 0.0046)));                // nostrils, opening downward
  h = ssub(0.004, h, sunk(capsule([0, Y(-0.0505), 0.092], [0, Y(-0.0575), 0.0945], 0.0032), 0.0016));           // the dip under the nose
  h = ssub(0.012, h, sunk(ellipsoid(0, Y(-0.0868), 0.0905, 0.021, 0.0058, 0.0065), 0.003));                     // the crease above the chin
  // the mouth line, laid on the face as built so it is never in the air
  const onFace = (x, y) => { const hit = cast(h, [x, y, 0.3], [0, 0, -1], 0.5); return hit ? hit.p : [x, y, 0.09]; };
  const my = Y(-0.0679), line = [[-0.0255, my - 0.0006], [-0.0135, my - 0.0003], [0, my + 0.0003], [0.0135, my - 0.0003], [0.0255, my - 0.0006]].map(([x, y]) => { const p = onFace(x, y); return [p[0], p[1], p[2] - 0.0006]; });
  h = ssub(0.0014, h, chain(line, 0.0009));
  if (age > 0.35) {   // lines from the nose to the mouth's corners, deeper with the years
    const fold = mirrorX(rope([[0.0185 * ns, Y(-0.04), 0.086], [0.0265, Y(-0.055), 0.082], [0.031, Y(-0.07), 0.0755]], 0.0034));
    h = ssub(0.012, h, sunk(fold, 0.0031 - 0.0016 * (age - 0.35)));
  }
  if (old > 0) {   // an elder's hollow cheeks and the pouches under the eyes
    h = ssub(0.02, h, sunk(mirrorX(ellipsoid(0.043 * fw, Y(-0.052), 0.0635, 0.016, 0.02, 0.006)), 0.0045 - 0.003 * old));
    h = smin(0.008, h, mirrorX(ellipsoid(eye.x, -0.0155, eye.z + 0.0045, 0.013, 0.0042, 0.003 * old)));
  }

  /* ---- the ears: a tilted shell with a rolled rim, a hollow and a lobe ---- */
  const ear = (() => {
    const c = P.ear, R = (f) => rotate(rotate(f, rotY(-0.3), c), rotX(-0.14), c);   // the back edge stands out from the head, the top tips back
    const shell = R(ellipsoid(c[0] + 0.004, c[1] + 0.002, c[2], 0.0048, 0.0295, 0.0165));
    const rimPts = []; for (let i = 0; i <= 10; i++) { const a = -1.9 + (i / 10) * 4.3; rimPts.push([c[0] + 0.0055, c[1] + 0.003 + 0.0275 * Math.sin(a), c[2] - 0.0002 - 0.015 * Math.cos(a)]); }
    const rim = R(chain(rimPts, 0.0027));
    const lobe = R(ellipsoid(c[0] + 0.003, c[1] - 0.0265, c[2] + 0.003, 0.0045, 0.0075, 0.0068));
    const tragus = R(sphere(c[0] + 0.003, c[1] - 0.003, c[2] + 0.0135, 0.0038));
    const hollow = R(ellipsoid(c[0] + 0.0085, c[1] - 0.001, c[2] + 0.003, 0.0048, 0.014, 0.0078));
    const one = ssub(0.003, smin(0.003, shell, rim, lobe, tragus), hollow);
    return mirrorX(near([c[0] + 0.004, c[1], c[2]], 0.036, one));
  })();
  h = smin(0.0045, h, ear);

  /* ---- the neck, with its two long muscles and (on a man) the throat ---- */
  const nw = 0.8 + 0.3 * m;
  const neck = roundCone([0, Y(-0.075), -0.022], [0, -0.215, -0.012], 0.049 * nw, 0.0545 * nw);
  const cords = mirrorX(capsule([0.052 * fw, Y(-0.05), -0.03], [0.013, -0.21, 0.036], 0.0085));
  const under = ellipsoid(0, Y(-0.092), 0.028, 0.034 * jw, 0.018, 0.038);   // the floor of the mouth, from chin back to the neck
  h = smin(0.02, h, under);
  h = smin(0.028, h, neck);
  h = smin(0.012, h, cords);
  if (m > 0.55) h = smin(0.01, h, sphere(0, -0.152, 0.036 * nw, 0.0085 * (m - 0.3)));

  // what a species adds (joined on softly) and takes away (cut in)
  const X = o.extra;
  if (X && X.add) for (const [k, f] of X.add(P, h)) h = smin(k, h, f);
  if (X && X.cut) for (const [k, f] of X.cut(P, h)) h = ssub(k, h, f);

  return {
    field: h, eye, P,
    // the lids: how far each comes over the eye, in radians from the top and from the bottom; older lids hang lower
    lid: { upper: 1.17 + 0.1 * old, lower: 1.2, tilt: 0.09 },
    bounds: [[-0.105, -0.23, -0.115], [0.105, 0.13, 0.125]],
  };
}
