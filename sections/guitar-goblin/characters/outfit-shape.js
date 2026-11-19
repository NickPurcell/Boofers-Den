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
    hips: ctx.hips || { rx: 0.17, rz: 0.12, zc: pv[2] },   // the hips' half-width and half-depth, and their middle front to back
    // a limb between two joints: near(x, y, z, r, t0, t1) is a region round it, from t0 to t1 of its length (negative inside)
    limb: (A, B) => { const a = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l = Math.hypot(...a), u = a.map((v) => v / l);
      return { A, B, u, l, near: (x, y, z, r, t0 = 0, t1 = 1) => { const px = x - A[0], py = y - A[1], pz = z - A[2], t = px * u[0] + py * u[1] + pz * u[2], tc = Math.max(0, Math.min(l, t)); return Math.max(Math.hypot(px - u[0] * tc, py - u[1] * tc, pz - u[2] * tc) - r, t0 * l - t, t - t1 * l); } }; },
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
  const M = measures(ctx), P = [], T = 0.011, top = M.neckY - 0.012, low = M.waistY - 0.03, J = ctx.J;   // (the gorget covers the top)
  // plate sits a finger off the body: on the body without its arms, bridging only the deeper hollows (ctx.torso)
  const hull = ctx.torso ? (x, y, z) => Math.min(ctx.body(x, y, z), ctx.torso(x, y, z)) : ctx.body;
  // the breastplate: a keel down the breast, three lames over the belly (each a step proud of the one above, a step a
  // mesh can show rather than a thin line), a lower edge rolled in, and a rolled rim round every edge
  const scoop = (x, y, z) => M.neckR + 0.012 - Math.hypot(x, (y - (M.neckY + 0.03)) * 1.1);
  const belly = M.chestY - 0.07, lame = Math.max(0.03, (belly - low) / 3);
  const topAt = (x, z) => top - 0.035 * sstep(M.cz + 0.02, M.cz - 0.06, z) - 0.035 * sstep(M.neckR - 0.025, M.neckR + 0.06, Math.abs(x));   // falling away from the gorget over the shoulders, from the scoop's own edge
  const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };   // rounded where two edges meet
  const edges = (x, y, z) => Math.max(low - y - 0.03 * sstep(0.04, 0.0, Math.abs(x)) * (z > M.cz ? 1 : 0), smax(y - topAt(x, z), scoop(x, y, z), 0.03), M.armBone(x, y, z, 0.035));
  const cuirass = (x, y, z) => {
    const a = hull(x, y, z); if (a > 0.05) return a - T;
    const e = edges(x, y, z), front = z > M.cz ? 1 : 0;
    const keel = 0.007 * Math.max(0, 1 - Math.abs(x) / 0.026) * sstep(M.neckY - 0.03, M.neckY - 0.1, y) * sstep(low + 0.02, belly, y) * front;
    const step = y < belly ? 0.003 * Math.min(3, Math.ceil((belly - y) / lame)) : 0, roll = 0.006 * sstep(low + 0.016, low - 0.004, y);
    const rim = 0.0035 * sstep(-0.014, -0.004, e) * (1 - sstep(-0.004, 0, e));   // the rolled rim, just inside each edge
    return Math.max(a - T - keel - step - rim + roll, e);
  };
  P.push({ name: 'cuirass', material: 'metal', role: 'main', field: cuirass, bounds: [[-(M.sx + 0.08), low - 0.05, M.cz - 0.24], [M.sx + 0.08, top + 0.03, M.cz + 0.26]], res: 0.0055 });
  // trim: a band in the second colour along every edge of the breastplate, standing just proud of its rim
  const trim = (x, y, z) => { const a = hull(x, y, z); if (a > 0.05) return a - T; const e = edges(x, y, z), roll = 0.006 * sstep(low + 0.016, low - 0.004, y); return Math.max(a - T - 0.0048 + roll, e, -0.011 - e); };
  P.push({ name: 'trim', material: 'metal', role: 'second', field: trim, bounds: [[-(M.sx + 0.08), low - 0.05, M.cz - 0.24], [M.sx + 0.08, top + 0.03, M.cz + 0.26]], res: 0.0045 });
  // a gorget: a plate collar standing round the base of the neck, over the breastplate's top
  // (lower than a knight's, and open in front in a V that widens upward, so tendrils hanging from the chin pass through)
  const gorget = (x, y, z) => {
    const a = ctx.all(x, y, z), r = Math.hypot(x, (z - M.neckZ) * 1.1), front = z > M.neckZ + 0.01 ? 0.016 + 0.035 * sstep(M.neckY - 0.03, M.neckY + 0.04, y) - Math.abs(x) : -1;
    return Math.max(a - 0.016 - 0.004 * sstep(M.neckY + 0.03, M.neckY + 0.005, y), M.neckY - 0.03 + 0.02 * sstep(M.neckR, M.neckR + 0.06, Math.abs(x)) - y, y - M.neckY - 0.035, r - M.neckR - 0.065, front);
  };
  P.push({ name: 'gorget', material: 'metal', role: 'second', field: gorget, bounds: [[-(M.neckR + 0.1), M.neckY - 0.06, M.neckZ - M.neckR - 0.11], [M.neckR + 0.1, M.neckY + 0.07, M.neckZ + M.neckR + 0.11]], res: 0.005 });
  // pauldrons: three lames over each shoulder, each a little larger, lower and further out than the one above, so their
  // lower edges step down the arm; each with a rim along its lower edge
  const capFor = (sd) => {
    const S = J[sd + '-shoulder'], E = J[sd + '-elbow'], ax = [E[0] - S[0], E[1] - S[1], E[2] - S[2]], al = Math.hypot(...ax), u = ax.map((v) => v / al), out = Math.sign(S[0]);
    const lame = (r, t, y0, reach) => (x, y, z) => {
      const a = ctx.all(x, y, z); if (a > 0.06) return a - t;
      const along = (x - S[0]) * u[0] + (y - S[1]) * u[1] + (z - S[2]) * u[2] - reach, e = Math.max(Math.hypot(x - S[0] - out * 0.004, y - S[1] - 0.015, z - S[2]) - r, y0 - y, along);
      return Math.max(a - t - 0.003 * sstep(-0.012, -0.003, along), e);
    };
    const L1 = lame(0.095, 0.02, S[1] - 0.02, 0.035), L2 = lame(0.12, 0.016, S[1] - 0.09, 0.085), L3 = lame(0.14, 0.012, S[1] - 0.15, 0.13);
    return (x, y, z) => Math.min(L1(x, y, z), L2(x, y, z), L3(x, y, z));
  };
  const PL = capFor('l'), PR = capFor('r'), caps = (x, y, z) => (x > 0 ? PL(x, y, z) : PR(x, y, z));
  P.push({ name: 'pauldrons', material: 'metal', role: 'second', parts: ['l', 'r'].map((sd) => { const S = J[sd + '-shoulder']; return { field: caps, bounds: [[S[0] - 0.18, S[1] - 0.22, S[2] - 0.18], [S[0] + 0.18, S[1] + 0.15, S[2] + 0.18]] }; }), res: 0.0055 });
  P.push(mantle(ctx, M, { hem: 0.2, off: 0.05 }));
  P.push(...lowerPlate(ctx, M));
  return P;
}

// a bell hung from the waist for a skirt or a robe to lie on: from inside the body at the top to (rx1, rz1) at the hem,
// round the hips' middle; joined softly to the body (without its arms, so hands hanging at the sides do not dent it)
export function belled(ctx, M, y0, y1, rx1, rz1) {
  const H = M.hips, rx0 = H.rx * 0.6, rz0 = H.rz * 0.6, k2 = 0.03;
  const bell = (x, y, z) => {
    const t = Math.max(0, Math.min(1, (y0 - y) / (y0 - y1))), e = t * (2 - t) * 0.35 + t * 0.65, rx = rx0 + (rx1 - rx0) * e, rz = rz0 + (rz1 - rz0) * e;
    return Math.max((Math.hypot(x / rx, (z - H.zc) / rz) - 1) * Math.min(rx, rz), y - y0 - 0.05, y1 - 0.03 - y);
  };
  return (x, y, z) => { const a = ctx.body(x, y, z), b = bell(x, y, z), h = Math.max(k2 - Math.abs(a - b), 0) / k2; return Math.min(a, b) - h * h * k2 * 0.25; };
}
// The plate's lower half: a cloth skirt to the shins, open in front, with two tassets over the hips and a belt with a
// buckle over it; bracers on the forearms; greaves on the shins with a knee cap; boots
function lowerPlate(ctx, M) {
  const P = [], J = ctx.J, H = M.hips, top = M.waistY - 0.03, hem = 0.2, garment2 = (t, region, base) => (x, y, z) => Math.max(base(x, y, z) - t, region(x, y, z));
  const base = belled(ctx, M, top, hem, H.rx * 1.18 + 0.02, H.rz * 1.25 + 0.035), fold = (x, z) => 0.005 * Math.sin(Math.atan2(x, z - H.zc) * 10);
  const skirt = (x, y, z) => Math.max(base(x, y, z) - 0.009 - fold(x, z) * sstep(top - 0.05, hem + 0.1, y), hem - y, y - top, z > H.zc ? 0.02 + 0.05 * sstep(top - 0.07, hem, y) - Math.abs(x) : -1);
  const W = H.rx * 1.18 + 0.06, D = H.rz * 1.25 + 0.07;
  P.push({ name: 'skirt', material: 'cloth', role: 'second', field: skirt, bounds: [[-W, hem - 0.02, H.zc - D], [W, top + 0.03, H.zc + D]], res: 0.011 });
  const tx = H.rx * 0.6, tw = H.rx * 0.38;
  const tasset = garment2(0.02, (x, y, z) => Math.max(top - 0.24 - y + 0.05 * Math.abs(Math.abs(x) - tx) / tw, y - top + 0.005, Math.abs(Math.abs(x) - tx) - tw, H.zc - 0.01 - z), base);
  P.push({ name: 'tassets', material: 'metal', role: 'main', field: tasset, bounds: [[-W, top - 0.3, H.zc - 0.02], [W, top + 0.02, H.zc + D]], res: 0.006 });
  const yc = top + 0.008, bh = 0.026;
  const band = garment2(0.022, (x, y, z) => Math.max(yc - bh - y, y - yc - bh), base);
  P.push({ name: 'belt', material: 'leather', role: 'leather', field: band, bounds: [[-W, yc - bh - 0.02, H.zc - D], [W, yc + bh + 0.02, H.zc + D]], res: 0.006 });
  // the buckle: a rounded plate on the belt's front
  { let z0 = H.zc + 0.4; for (let i = 0; i < 80; i++) { const d = base(0, yc, z0) - 0.022; if (d < 0.0005) break; z0 -= Math.max(d * 0.8, 0.0005); }
    const bx = 0.026, by = bh * 0.95, bz = 0.006, c = [0, yc, z0 + 0.004];
    const box = (x, y, z) => { const qx = Math.abs(x - c[0]) - bx + 0.004, qy = Math.abs(y - c[1]) - by + 0.004, qz = Math.abs(z - c[2]) - bz + 0.003; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - 0.003; };
    P.push({ name: 'buckle', material: 'metal', role: 'metal', field: box, bounds: [[c[0] - 0.05, c[1] - 0.045, c[2] - 0.03], [c[0] + 0.05, c[1] + 0.045, c[2] + 0.03]], res: 0.003 }); }
  // bracers: stiff cuffs from below the elbow to the wrist
  const fore = ['l', 'r'].map((sd) => M.limb(J[sd + '-elbow'], J[sd + '-hand']));
  const bracer = garment2(0.012, (x, y, z) => { const f = x > 0 ? fore[0] : fore[1]; return f.near(x, y, z, 0.085, 0.3, 0.94); }, ctx.all);
  P.push({ name: 'bracers', material: 'metal', role: 'main', parts: fore.map((f) => ({ field: bracer, bounds: boxAround([f.A, f.B], 0.09) })), res: 0.0055 });
  // greaves on the front of the shins, with a cap over each knee
  const shin = ['l', 'r'].map((sd) => M.limb(J[sd + '-knee'], J[sd + '-ankle']));
  const greave = garment2(0.013, (x, y, z) => {
    const g = x > 0 ? shin[0] : shin[1], front = g.A[2] + (g.B[2] - g.A[2]) * Math.max(0, Math.min(1, (g.A[1] - y) / (g.A[1] - g.B[1]))) - 0.015 - z;
    const knee = Math.hypot(x - g.A[0], y - g.A[1] - 0.01, z - g.A[2] - 0.03) - 0.07;
    return Math.min(Math.max(g.near(x, y, z, 0.11, 0.1, 0.82), front), knee);
  }, ctx.all);
  P.push({ name: 'greaves', material: 'metal', role: 'main', parts: shin.map((g) => ({ field: greave, bounds: boxAround([[g.A[0], g.A[1] + 0.08, g.A[2]], g.B], 0.1) })), res: 0.006 });
  // boots: the foot and ankle covered to just below the greaves, a cuff at the top, and a thicker sole
  const foot = ['l', 'r'].map((sd) => ({ A: J[sd + '-ankle'], T: J[sd + '-foot-1'] }));
  const btop = Math.max(foot[0].A[1] + 0.13, 0.2);
  const near = (x, y, z) => { const f = x > 0 ? foot[0] : foot[1]; return Math.hypot(x - f.A[0], z - (f.A[2] + f.T[2]) / 2) - 0.16; };
  const boot = (x, y, z) => {
    const a = ctx.all(x, y, z), upper = Math.max(a - 0.009, y - btop, near(x, y, z)), cuff = Math.max(a - 0.013, y - btop, btop - 0.028 - y, near(x, y, z)), sole = Math.max(a - 0.016, y - 0.022, near(x, y, z));
    return Math.min(upper, cuff, sole);
  };
  P.push({ name: 'boots', material: 'leather', role: 'leather', parts: foot.map((f) => ({ field: boot, bounds: [[f.A[0] - 0.11, -0.01, Math.min(f.A[2], f.T[2]) - 0.12], [f.A[0] + 0.11, btop + 0.02, Math.max(f.A[2], f.T[2]) + 0.12]] })), res: 0.0062 });
  return P;
}
const boxAround = (pts, m) => [[Math.min(...pts.map((p) => p[0])) - m, Math.min(...pts.map((p) => p[1])) - m, Math.min(...pts.map((p) => p[2])) - m], [Math.max(...pts.map((p) => p[0])) + m, Math.max(...pts.map((p) => p[1])) + m, Math.max(...pts.map((p) => p[2])) + m]];

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
    const d = sminv(free, (front ? ctx.all : ctx.body)(x, y, z) - off);   // a cloak falls over the arms; a cape hangs behind them
    const opening = front ? (z > cz + 0.02 ? 0.04 + 0.07 * Math.max(0, Math.min(1, (ny - 0.15 - y) / 0.9)) - Math.abs(x) : -1) : z - cz + 0.01;
    return Math.max(Math.abs(d) - T, y - top, hem - y, opening);
  };
  return { name: front ? 'cloak' : 'cape', material: 'cloth', role: o.role || 'second', field, bounds: [[-(sx + 0.26), hem - 0.02, cz - 0.27], [sx + 0.26, top + 0.03, front ? cz + 0.26 : cz + 0.06]], res: 0.0105 };
}

// A belted robe to the ankles: a full skirt on a bell from the waist with folds that deepen as it falls, sleeves over
// the hanging arms that widen toward the wrists, a V at the throat, a belt, and boots under it
export function robe(ctx) {
  const M = measures(ctx), P = [], J = ctx.J, H = M.hips, top = M.waistY - 0.01, hem = 0.09, T = 0.014;
  const bell = belled(ctx, M, top, hem, H.rx * 1.3 + 0.03, H.rz * 1.45 + 0.04);
  const fore = ['l', 'r'].map((sd) => M.limb(J[sd + '-elbow'], J[sd + '-hand'])), up = ['l', 'r'].map((sd) => M.limb(J[sd + '-shoulder'], J[sd + '-elbow']));
  // the robe lies on the bell below the waist and on the whole figure above it (so it has sleeves); the hands stay out
  // the figure with its hands taken off at the wrists: the sleeves end there, and the skirt beside the hands stays whole
  const handless = (x, y, z) => { const n = (x > 0 ? fore[0] : fore[1]).near(x, y, z, 0.16, 0.97, 2.0), a = ctx.all(x, y, z); return n < 0 ? Math.max(a, -n) : a; };
  const base = ctx.torso ? (x, y, z) => Math.min(bell(x, y, z), handless(x, y, z), ctx.torso(x, y, z)) : (x, y, z) => Math.min(bell(x, y, z), handless(x, y, z));   // cloth bridges the chest
  const sleeve = (x, y, z) => { const f = x > 0 ? fore[0] : fore[1], px = x - f.A[0], py = y - f.A[1], pz = z - f.A[2], t = (px * f.u[0] + py * f.u[1] + pz * f.u[2]) / f.l; return { t, wide: f.near(x, y, z, 0.13, -0.2, 0.97) < 0 && ctx.arms(x, y, z) < ctx.body(x, y, z) - 0.008 ? 0.032 * sstep(0.1, 0.95, t) : 0 }; };   // (stopping at the wrist, or it reaches over the hand)   // only where the arm is the nearest skin: no web to the waist
  const fold = (x, z) => 0.008 * Math.sin(Math.atan2(x, z - H.zc) * 9 + 0.5);
  const vee = (x, y, z) => { if (z < M.cz) return -1; const t = Math.max(0, Math.min(1, (M.neckY + 0.01 - y) / (M.neckY + 0.01 - (M.chestY - 0.06)))); return 0.05 * (1 - t) + 0.004 * t - Math.abs(x) + (y > M.neckY + 0.2 ? 1 : 0); };
  const field = (x, y, z) => {
    const sl = sleeve(x, y, z);
    return Math.max(base(x, y, z) - T - sl.wide - fold(x, z) * sstep(top - 0.04, hem + 0.1, y), hem - y, y - M.neckY - 0.012, Math.min(vee(x, y, z), 0.06) > 0 && y > M.chestY - 0.06 ? 0.01 : -1);
  };
  const W = M.sx + 0.22, D = Math.max(H.rz * 1.45 + 0.1, 0.3);
  P.push({ name: 'robe', material: 'cloth', role: 'main', parts: [{ field, bounds: [[-W, hem - 0.02, H.zc - D], [W, M.hipY, H.zc + D]] }, { field, bounds: [[-W, M.hipY, H.zc - D], [W, M.neckY + 0.04, H.zc + D]] }], res: 0.0095 });
  const yc = top - 0.005, bh = 0.024, band = (x, y, z) => Math.max(base(x, y, z) - T - 0.008, yc - bh - y, y - yc - bh, ctx.arms(x, y, z) < ctx.body(x, y, z) ? 1 : -1);   // on the robe itself, not round the arms
  P.push({ name: 'belt', material: 'leather', role: 'leather', field: band, bounds: [[-(H.rx + 0.12), yc - bh - 0.02, H.zc - D], [H.rx + 0.12, yc + bh + 0.02, H.zc + D]], res: 0.006 });
  P.push(boots(ctx, 0.18));
  return P;
}
// boots alone: the foot and ankle covered to `top` above the ankle, a cuff, a thicker sole
function boots(ctx, rise = 0.13) {
  const J = ctx.J, foot = ['l', 'r'].map((sd) => ({ A: J[sd + '-ankle'], T: J[sd + '-foot-1'] })), btop = foot[0].A[1] + rise;
  const near = (x, y, z) => { const f = x > 0 ? foot[0] : foot[1]; return Math.hypot(x - f.A[0], z - (f.A[2] + f.T[2]) / 2) - 0.16; };
  const boot = (x, y, z) => { const a = ctx.all(x, y, z), n = near(x, y, z); return Math.min(Math.max(a - 0.009, y - btop, n), Math.max(a - 0.013, y - btop, btop - 0.028 - y, n), Math.max(a - 0.016, y - 0.022, n)); };
  return { name: 'boots', material: 'leather', role: 'leather', parts: foot.map((f) => ({ field: boot, bounds: [[f.A[0] - 0.11, -0.01, Math.min(f.A[2], f.T[2]) - 0.12], [f.A[0] + 0.11, btop + 0.02, Math.max(f.A[2], f.T[2]) + 0.12]] })), res: 0.0062 };
}
// Sith robes: the robe under a long cloak, open in front (the hood is chosen apart)
export function cloak(ctx) { const M = measures(ctx), P = robe(ctx); P.push(mantle(ctx, M, { front: true, hem: 0.15, role: 'second', off: 0.035 })); return P; }

// the head as the hood sees it: its middle, and a size against the earlier head (eyes 64.4 mm apart)
function headOf(ctx) {
  const J = ctx.J, e = [(J['l-eye'][0] + J['r-eye'][0]) / 2, (J['l-eye'][1] + J['r-eye'][1]) / 2, (J['l-eye'][2] + J['r-eye'][2]) / 2], k = Math.abs(J['l-eye'][0] - J['r-eye'][0]) / 0.0644;
  return { e, k, c: [0, e[1] + 0.03 * k, e[2] - 0.075 * k] };
}
// a hood worn down: a roll of cloth round the neck and a short drape over the collarbones and the back of the neck
export function cowl(ctx, role = 'second') {
  const M = measures(ctx), ny = M.neckY + 0.025, R = M.neckR + 0.03;
  const roll = (x, y, z) => { const q = Math.hypot(x, z - M.neckZ - 0.005) - R; return Math.hypot(q, y - ny) - 0.026; };
  const fold = (x, z) => 0.0025 * Math.sin(Math.atan2(x, z - M.neckZ) * 8);
  const edge = (x, z) => ny - 0.06 + 0.03 * sstep(0.02, 0.12, Math.abs(x)) - (z < M.neckZ ? 0.05 : 0);
  const drape = (x, y, z) => Math.max(ctx.body(x, y, z) - 0.02 - fold(x, z) * sstep(ny, ny - 0.08, y), edge(x, z) - y, y - ny - 0.01, Math.abs(x) - R - 0.06);
  const k2 = 0.016, f = (x, y, z) => { const a = roll(x, y, z), b = drape(x, y, z), h = Math.max(k2 - Math.abs(a - b), 0) / k2; return Math.min(a, b) - h * h * k2 * 0.25; };
  return { name: 'cowl', material: 'cloth', role, field: f, bounds: [[-(R + 0.12), ny - 0.16, M.neckZ - R - 0.12], [R + 0.12, ny + 0.06, M.neckZ + R + 0.12]], res: 0.0058 };
}
// a hood worn up: a smooth shell over the head (ears and hair do not show through), open round the face and down the
// throat, running into the same drape
export function hood(ctx, role = 'second') {
  const M = measures(ctx), { e, k, c } = headOf(ctx), cw = cowl(ctx, role);
  const ell = (x, y, z) => { const rx = 0.1 * k, ry = 0.118 * k, rz = 0.122 * k, q = Math.hypot(x / rx, (y - c[1]) / ry, (z - c[2]) / rz); return (q - 1) * Math.min(rx, ry, rz); };
  const neck = (x, y, z) => { const t = Math.max(0, Math.min(1, (c[1] - 0.05 - y) / (c[1] - 0.05 - M.neckY))); return Math.max(Math.hypot(x, z - (c[2] + (M.neckZ - c[2]) * t)) - (0.09 * k + 0.01 * t), M.neckY - y, y - c[1]); };
  const k2 = 0.02, shell = (x, y, z) => { const a = ell(x, y, z), b = neck(x, y, z), h = Math.max(k2 - Math.abs(a - b), 0) / k2; return Math.min(a, b) - h * h * k2 * 0.25; };
  const open = (x, y, z) => (z < e[2] - 0.06 * k ? -1 : Math.max(1 - Math.hypot(x / (0.074 * k), (y - e[1] + 0.016) / (0.12 * k)), y < e[1] - 0.07 * k ? 1 - Math.abs(x) / (0.05 * k) : -1) * 0.07);
  const over = (x, y, z) => Math.max(shell(x, y, z), open(x, y, z), M.neckY - 0.01 - y);
  const k3 = 0.014, f = (x, y, z) => { const a = cw.field(x, y, z), b = over(x, y, z), h = Math.max(k3 - Math.abs(a - b), 0) / k3; return Math.min(a, b) - h * h * k3 * 0.25; };
  return { name: 'hood', material: 'cloth', role, field: f, bounds: [[-(M.sx + 0.04), M.neckY - 0.16, c[2] - 0.2], [M.sx + 0.04, c[1] + 0.16 * k, c[2] + 0.2]], res: 0.0068 };
}

export const OUTFITS = {
  none: { name: 'None', make: () => [] },
  plate: { name: "Guardian's plate", make: plate, suit: { torso: true, arms: 1, legs: 1 } },
  robe: { name: 'Belted robe', make: robe, suit: { torso: true, arms: 1, legs: 1 } },
  cloak: { name: 'Hooded cloak', make: cloak, suit: { torso: true, arms: 1, legs: 1 } },
};
export const HOODS = { none: { name: 'None' }, down: { name: 'Down' }, up: { name: 'Up' } };
