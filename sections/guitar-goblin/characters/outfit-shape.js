// Clothes on the human base, as signed distance fields (../duros-creator/sdf.js), placed from the base's joints and
// grown from the live body: a garment is the body pushed out by its thickness and kept inside a region. Pure: the
// workers build these. Designs carried over from the earlier creator's outfits (../humanoid-creator/outfits.js), with
// every height and width now taken from the figure itself instead of fixed numbers.
//
// ctx: { all, body, arms } fields (the whole body, signed; the body without the arms and the arms alone, as distances to
// their skin, unsigned except that the body's is negative inside the figure), J: joints by name,
// L: landmarks by name ({ p, n }), all in metres, y up, +z forward, the figure's left at +x.
import { smin, ssub } from '../duros-creator/sdf.js';

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the measures every piece works from
export function measures(ctx) {
  // (the base's spine joints run down from spine-1 at the chest to spine-4 below the waist; 'neck' is the neck's base)
  const J = ctx.J, L = ctx.L, sh = J['l-shoulder'], nk = J.neck, ch = J['spine-1'], wa = J['spine-3'], pv = J.pelvis;
  const nw = Math.abs(L.neckSideL.p[0] - L.neckSideR.p[0]);
  return {
    sh, sx: Math.abs(sh[0]), neckY: nk[1], neckZ: nk[2], neckR: nw / 2, chestY: ch[1], waistY: wa[1], hipY: pv[1],
    cz: (L.chestMid.p[2] + L.backMid.p[2]) / 2,   // the middle of the chest, front to back
    // regions: nearer the body than the arms (from the body's own fields), and the same said by the arms' bones alone:
    // past the shoulder joint along the arm and within reach of its line (smooth, where the fields' boundary is ragged)
    noArms: (x, y, z) => ctx.body(x, y, z) - ctx.arms(x, y, z), armsOnly: (x, y, z) => ctx.arms(x, y, z) - ctx.body(x, y, z),
    armBone: (() => {
      // each arm as two segments, shoulder to elbow and elbow to past the hand
      const seg = (A, B) => { const a = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(...a); return { A, u: a.map((v) => v / l), l }; };
      const sides = ['l', 'r'].map((sd) => { const S = J[sd + '-shoulder'], E = J[sd + '-elbow'], H = J[sd + '-hand'], X = [H[0] + (H[0] - E[0]) * 0.6, H[1] + (H[1] - E[1]) * 0.6, H[2] + (H[2] - E[2]) * 0.6]; return [seg(S, E), seg(E, X)]; });
      return (x, y, z, past = 0.03, reach = 0.11) => {
        let best = -1;
        for (const [up, low] of sides) {
          for (const [g, r, first] of [[up, reach, true], [low, reach * 0.85, false]]) {
            const px = x - g.A[0], py = y - g.A[1], pz = z - g.A[2], t = px * g.u[0] + py * g.u[1] + pz * g.u[2], tc = Math.max(0, Math.min(g.l, t));
            const perp = Math.hypot(px - g.u[0] * tc, py - g.u[1] * tc, pz - g.u[2] * tc);
            best = Math.max(best, first ? Math.min(t - past, r - perp) : r - perp);
          }
        }
        return best;   // > 0 on the arm
      };
    })(),
  };
}

// The Guardian's plate: a cuirass, layered pauldrons and a cape (more to come: the gorget, belt, tassets, skirt,
// bracers, greaves and boots)
// A garment: the base pushed out by t, kept inside a region. The region has a cheap part (heights, openings) and a
// costly one (where the arms are, from the body's own fields), and the costly part is worked out only near the skin:
// far outside the answer is already known, and deep inside the body the garment is hidden.
const garment = (t, cheap, costly, base) => (x, y, z) => {
  const a = base(x, y, z), g = a - t; if (g > 0.02) return g;
  const r = Math.max(g, cheap(x, y, z)); if (r > 0.02 || a < -0.03 || !costly) return r;
  return Math.max(r, costly(x, y, z));
};
export function plate(ctx) {
  const M = measures(ctx), P = [], T = 0.02, top = M.neckY + 0.03, low = M.waistY - 0.03, J = ctx.J;
  // plate does not follow muscle: over the chest and belly it lies on the smooth torso (ctx.torso) where that stands
  // out from the skin, so the hollows between the muscles are bridged
  const hull = ctx.torso ? (x, y, z) => Math.min(ctx.body(x, y, z), ctx.torso(x, y, z)) : ctx.body;   // (the body without its arms)
  // the cuirass: a breastplate rising to the neck, with a crest down the middle of the breast, and over the belly three
  // lames, each lower one standing a little proud of the one above (steps a mesh can show, rather than thin lines)
  const scoop = (x, y, z) => M.neckR + 0.018 - Math.hypot(x, (y - (M.neckY + 0.045)) * 1.1);
  const belly = M.chestY - 0.07, lame = Math.max(0.03, (belly - low) / 3);
  const shape = (x, y, z) => {
    const front = z > M.cz ? 1 : 0, crest = 0.006 * Math.max(0, 1 - Math.abs(x) / 0.035) * sstep(M.neckY - 0.02, M.neckY - 0.1, y) * sstep(low, belly, y) * front;
    const step = y < belly ? 0.003 * Math.min(3, Math.ceil((belly - y) / lame)) : 0, roll = 0.007 * sstep(low + 0.018, low - 0.004, y);   // the lower edge rolled in
    return hull(x, y, z) - crest - step + roll;
  };
  // the top: up the front of the neck's sides to the scoop, lower behind (under the cape) and over the shoulders (under the pauldrons)
  const topAt = (x, z) => top - 0.035 * sstep(M.cz + 0.02, M.cz - 0.06, z) - 0.03 * sstep(M.neckR + 0.03, M.neckR + 0.09, Math.abs(x));
  const cuirass = garment(T, (x, y, z) => Math.max(low - y - 0.03 * sstep(0.04, 0.0, Math.abs(x)) * (z > M.cz ? 1 : 0), y - topAt(x, z), scoop(x, y, z), M.armBone(x, y, z, 0.035)), null, shape);
  P.push({ name: 'cuirass', material: 'metal', role: 'main', field: cuirass, bounds: [[-(M.sx + 0.08), low - 0.05, M.cz - 0.24], [M.sx + 0.08, top + 0.03, M.cz + 0.26]], res: 0.006 });
  // pauldrons: two plates over each shoulder, the lower larger and reaching down the arm, cut square across the arm
  const capFor = (sd) => {
    const S = J[sd + '-shoulder'], E = J[sd + '-elbow'], ax = [E[0] - S[0], E[1] - S[1], E[2] - S[2]], al = Math.hypot(...ax), u = ax.map((v) => v / al);
    const cap = (r, t, y0, reach) => garment(t, (x, y, z) => Math.max(Math.hypot(x - S[0] - Math.sign(S[0]) * 0.004, y - S[1] - 0.015, z - S[2]) - r, y0 - y, (x - S[0]) * u[0] + (y - S[1]) * u[1] + (z - S[2]) * u[2] - reach), null, ctx.all);
    return smin(0.004, cap(0.1, 0.024, S[1] - 0.03, 0.06), cap(0.13, 0.018, S[1] - 0.12, 0.13));
  };
  const L = capFor('l'), R = capFor('r'), caps = (x, y, z) => (x > 0 ? L(x, y, z) : R(x, y, z));
  P.push({ name: 'pauldrons', material: 'metal', role: 'second', parts: ['l', 'r'].map((sd) => { const S = J[sd + '-shoulder']; return { field: caps, bounds: [[S[0] - 0.17, S[1] - 0.2, S[2] - 0.17], [S[0] + 0.17, S[1] + 0.15, S[2] + 0.17]] }; }), res: 0.006 });
  P.push(mantle(ctx, M, { hem: 0.2, off: 0.05 }));
  return P;
}

// A cape hung from the shoulders (or a cloak, open in front): a sheet over the envelope of a cone widening from the
// neck and the body itself (without the arms, so it does not wrap round them), flaring and folding toward the hem.
export function mantle(ctx, M, o = {}) {
  const hem = o.hem ?? 0.22, front = !!o.front, top = o.top ?? M.neckY - 0.004, T = 0.0095, sx = M.sx, off = o.off ?? 0.02, ny = M.neckY + 0.035;
  const k2 = 0.03, sminv = (a, b) => { const h = Math.max(k2 - Math.abs(a - b), 0) / k2; return Math.min(a, b) - h * h * k2 * 0.25; };
  const cz = M.cz + (front ? -0.01 : -0.004);
  const field = (x, y, z) => {
    const below = Math.max(0, ny - 0.055 - y), t = Math.max(0, Math.min(1, (top - y) / (top - hem))), up = Math.max(0, ny - y);
    const rx = Math.min(sx + 0.135, sx * 0.55 + up * 1.45) + 0.07 * t, rz = Math.min(0.17, 0.06 + up * 0.62) + 0.04 * t + (front ? 0.015 : 0);
    const ang = Math.atan2(x, -(z - cz)), fold = (0.008 * Math.sin(ang * 9 + 0.6) + 0.003 * Math.sin(ang * 23)) * Math.min(1, below * 2.5);
    const free = (Math.hypot(x / rx, (z - cz) / rz) - 1) * Math.min(rx, rz) - fold;
    const d = sminv(free, ctx.body(x, y, z) - off);
    const opening = front ? (z > cz + 0.02 ? 0.04 + 0.07 * Math.max(0, Math.min(1, (ny - 0.15 - y) / 0.9)) - Math.abs(x) : -1) : z - cz + 0.01;
    return Math.max(Math.abs(d) - T, y - top, hem - y, opening);
  };
  return { name: front ? 'cloak' : 'cape', material: 'cloth', role: o.role || 'second', field, bounds: [[-(sx + 0.26), hem - 0.02, cz - 0.27], [sx + 0.26, top + 0.03, front ? cz + 0.26 : cz + 0.06]], res: 0.0105 };
}

export const OUTFITS = { none: { name: 'None', make: () => [] }, plate: { name: "Guardian's plate", make: plate, suit: { torso: true, arms: 1, legs: 1 } } };
