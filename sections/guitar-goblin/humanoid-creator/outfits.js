// Outfits for the humanoid creator. An outfit is a function of the kit (../duros-creator/kit.js, fitted here to the
// humanoid figure) that returns pieces:
//   { name, material: 'cloth' | 'leather' | 'metal' | 'plastic', role, field | parts, bounds, res? }
// `role` says which of the wearer's colours a piece takes: 'main', 'second', 'dark' (an undersuit), 'leather',
// 'metal' or 'trim'. Garments are the figure's surface pushed out by a thickness and kept inside a region, so every
// piece fits whatever the build; skirts and coats hang from a bell laid over the hips. One piece is one draw call.
// Pure: no DOM and no three.js, so the workers build these.
import { kitFor } from '../duros-creator/kit.js';
import { union, smin, ssub, ellipsoid, capsule, roundCone, roundBox, torusY } from '../duros-creator/sdf.js';
import { skinField, handField, HEAD_AT } from './anatomy.js';

const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const both = (f) => (x, y, z) => f(Math.abs(x), y, z);
const NECK = 1.462;   // where a neckline sits

export function makeKit(o) {
  const sk = skinField(o), S = sk.body.S, hl = handField(1, o), hr = handField(-1, o);
  const k = kitFor({ skin: sk.field, hands: union(hl.field, hr.field), build: 1, halfWidth: S.sx + 0.17, at: { ...S, hand: hl.wrist } });
  k.S = S; k.o = o;
  // how far out from the midline the body ends and the arms begin, at each height (they join at the armpit)
  const inner = S.sx - 0.03;
  const armLine = (y) => (y > 1.32 ? S.sx + 0.012 : y > 1.25 ? inner + ((y - 1.25) / 0.07) * 0.042 : y > 1.13 ? inner : y > 0.98 ? inner + ((1.13 - y) / 0.15) * Math.max(0, 0.195 - inner) : Math.max(inner, 0.195));
  k.noArms = (x, y) => Math.abs(x) - armLine(y);                 // a region: the body and legs without the arms
  k.armsOnly = (x, y) => armLine(y) - Math.abs(x);               // a region: the arms alone
  // the figure with a bell hung from the waist, for a skirt, a robe or a coat to lie on: half-widths (rx, rz) at the
  // waist (inside the body there, so the waist stays the body's own) and at the hem
  k.belled = (y0, y1, rx1, rz1) => {
    const rx0 = 0.1, rz0 = 0.07, bell = (x, y, z) => {
      const t = Math.max(0, Math.min(1, (y0 - y) / (y0 - y1))), e = t * (2 - t) * 0.35 + t * 0.65, rx = rx0 + (rx1 - rx0) * e, rz = rz0 + (rz1 - rz0) * e;
      return Math.max((Math.hypot(x / rx, (z + 0.004) / rz) - 1) * Math.min(rx, rz), y - y0 - 0.05, y1 - 0.03 - y);
    };
    return smin(0.03, k.skin, bell);
  };
  return k;
}

/* ---------------- pieces many outfits share ---------------- */
function trousers(k, role = 'second', t = 0.006, top = null, bottom = null) {
  const S = k.S, y1 = top ?? S.waistY + 0.012, y0 = bottom ?? S.ankleY + 0.03;
  return { name: 'trousers', material: 'cloth', role, field: k.garment(t, (x, y, z) => Math.max(y0 - y, y - y1, k.noArms(x, y))), bounds: [[-0.23, y0 - 0.02, -0.2], [0.23, y1 + 0.02, 0.2]], res: 0.008 };
}
function boots(k, top = 0.33, role = 'leather') {
  const upper = k.garment(0.008, (x, y, z) => Math.max(y - top, -y));
  const sole = both(roundBox(0.102, 0.007, 0.05, 0.047, 0.009, 0.118, 0.006));
  const cuff = k.garment(0.0125, (x, y, z) => Math.max(top - 0.032 - y, y - top));
  const strap = k.garment(0.0115, (x, y, z) => Math.max(0.105 - y, y - 0.125));
  return { name: 'boots', material: 'leather', role, field: union(upper, sole, cuff, strap), bounds: [[-0.2, -0.004, -0.12], [0.2, top + 0.02, 0.2]], res: 0.0072 };
}
// a belt round the waist with a buckle, lying on `base` (the figure, or the figure in its coat) at thickness t
function belt(k, base, t, y = null, h = 0.02, role = 'leather') {
  const S = k.S, yc = y ?? S.waistY - 0.02;
  const band = k.garment(t + 0.007, (x, yy, z) => Math.max(yc - h - yy, yy - yc - h, k.noArms(x, yy)), base);
  const buckle = k.boxOn([0, yc, 0.25], [0.02, h * 0.95, 0.006], 0.004, [0, 1, 0], t + 0.007, base);
  return [{ name: 'belt', material: 'leather', role, field: band, bounds: [[-0.24, yc - h - 0.02, -0.2], [0.24, yc + h + 0.02, 0.21]], res: 0.006 },
    { name: 'buckle', material: 'metal', role: 'metal', field: buckle, bounds: k.around(buckle.centre, 0.04), res: 0.003 }];
}
// pouches on the belt: [x, z, half width, half height] each
function pouches(k, base, t, yc, list, role = 'leather') {
  const parts = list.map(([x, z, w, h]) => { const f = k.boxOn([x, yc - h * 0.4, z], [w, h, 0.015], 0.006, [0, 1, 0], t + 0.006, base); return { field: f, bounds: k.around(f.centre, Math.max(w, h) + 0.025) }; });
  return { name: 'pouches', material: 'leather', role, parts, res: 0.0036 };
}
// a hood worn down: a roll of cloth round the neck and a short drape over the collar bones and the back of the neck
function cowl(k, role = 'second') {
  const S = k.S, roll = torusY(0, 1.456, -0.012, 0.068, 0.024);
  const fold = (x, z) => 0.0025 * Math.sin(Math.atan2(x, z + 0.02) * 8);
  const edge = (x, z) => 1.405 + 0.03 * sstep(0.02, 0.12, Math.abs(x)) - (z < 0 ? 0.05 : 0);   // a short fall in front, longer behind   // lowest in the middle, rising to the shoulders
  const drape = (x, y, z) => Math.max(k.skin(x, y, z) - 0.019 - fold(x, z) * sstep(1.46, 1.38, y), edge(x, z) - y, y - 1.468, Math.abs(x) - 0.135);
  return { name: 'cowl', material: 'cloth', role, field: smin(0.016, roll, drape), bounds: [[-(S.sx + 0.03), 1.3, -0.2], [S.sx + 0.03, 1.52, 0.2]], res: 0.0058 };
}
// a hood worn up: a smooth shell over the head (so ears and hair don't show through), open round the face and down
// the throat, running into the same drape
function hood(k, role = 'second') {
  const hy = HEAD_AT[1], c = cowl(k, role);
  const shell = smin(0.02, ellipsoid(0, hy + 0.03, -0.02, 0.098, 0.112, 0.118), roundCone([0, hy - 0.05, -0.035], [0, 1.45, -0.02], 0.088, 0.085));
  const peak = (x, y, z) => shell(x, y, z) - 0.004 * sstep(hy + 0.04, hy + 0.12, y) * sstep(0.0, 0.06, z);   // a little brim over the brow
  const open = (x, y, z) => (z < -0.004 ? -1 : Math.max(1 - Math.hypot(x / 0.071, (y - hy + 0.014) / 0.116), y < hy - 0.06 ? 1 - Math.abs(x) / 0.05 : -1) * 0.07);
  const over = (x, y, z) => Math.max(peak(x, y, z), open(x, y, z), 1.44 - y);
  return { name: 'hood', material: 'cloth', role, field: smin(0.014, c.field, over), bounds: [[-(k.S.sx + 0.03), 1.27, -0.2], [k.S.sx + 0.03, hy + 0.17, 0.2]], res: 0.0068 };
}
// windings of cloth round a limb: a garment whose thickness steps like overlapping bands
const wound = (k, t, pitch) => (x, y, z) => k.skin(x, y, z) - t - 0.0024 * (1 - Math.abs(2 * (((y / pitch) % 1 + 1) % 1) - 1));
function wraps(k, role = 'second', shin = true) {
  const S = k.S, w = wound(k, 0.0065, 0.024), parts = [];
  const arm = (x, y, z) => Math.max(w(x, y, z), S.wrist[1] + 0.012 - y, y - S.elbow[1] + 0.035, k.armsOnly(x, y));
  for (const s of [1, -1]) parts.push({ field: arm, bounds: [[s * S.wrist[0] - 0.075, S.wrist[1] - 0.01, -0.09], [s * S.wrist[0] + 0.075, S.elbow[1], 0.1]] });
  if (shin) { const leg = (x, y, z) => Math.max(w(x, y, z), 0.3 - y, y - 0.455, k.noArms(x, y)); parts.push({ field: leg, bounds: [[-0.19, 0.28, -0.12], [0.19, 0.47, 0.12]] }); }
  return { name: 'wraps', material: 'cloth', role, parts, res: 0.0052 };
}
// bracers: stiff cuffs from wrist to below the elbow
function bracers(k, role = 'main', material = 'leather', t = 0.011) {
  const S = k.S, f = k.garment(t, (x, y, z) => Math.max(S.wrist[1] + 0.014 - y, y - S.elbow[1] + 0.05, k.armsOnly(x, y)));
  return { name: 'bracers', material, role, parts: [1, -1].map((s) => ({ field: f, bounds: [[s * S.wrist[0] - 0.08, S.wrist[1], -0.09], [s * S.wrist[0] + 0.08, S.elbow[1], 0.1]] })), res: 0.0052 };
}
// a V of shirt at the neck, under whatever is worn over it
const shirt = (k, role = 'dark') => ({ name: 'shirt', material: 'cloth', role, field: k.garment(0.004, (x, y, z) => Math.max(1.2 - y, y - NECK - 0.006, Math.abs(x) - 0.09, 0.0 - z)), bounds: [[-0.1, 1.18, -0.02], [0.1, 1.5, 0.17]], res: 0.007 });
// a close suit from neck to wrist and ankle, to wear armour over
const undersuit = (k, role = 'dark') => {   // (its legs and arms are all that show)
  const S = k.S, f = k.garment(0.0045, (x, y, z) => Math.max(S.ankleY + 0.04 - y, y - NECK - 0.012, y < S.wrist[1] + 0.012 && Math.abs(x) > 0.2 ? 1 : -1));
  return { name: 'undersuit', material: 'cloth', role, parts: [{ field: f, bounds: [[-(S.sx + 0.13), 0.1, -0.2], [S.sx + 0.13, 0.82, 0.2]] }, { field: f, bounds: [[-(S.sx + 0.13), 0.82, -0.2], [S.sx + 0.13, 1.5, 0.2]] }], res: 0.0115 };
};
// a seam pressed into a garment along a path given on the bare figure
const seam = (k, pts, t, base) => k.chain(k.path(pts, t, 0.012, base), 0.0016);

/* ---------------- the outfits ---------------- */
// Fitted fighting clothes: a short-skirted tunic with long sleeves, wound forearms and shins, a wide sash
function wrapsOutfit(k) {
  const S = k.S, P = [], T = 0.0085, hem = 0.74, base = k.belled(S.waistY, hem, 0.185, 0.15);
  const open = k.opening(NECK + 0.01, 0.045, 1.31, 0.003);
  const fold = (x, z) => 0.0035 * Math.sin(Math.atan2(x, z) * 11);
  const tunic = (x, y, z) => Math.max(base(x, y, z) - T - fold(x, z) * sstep(S.waistY - 0.05, hem, y), hem - y, y - NECK, -open(x, y, z), Math.abs(x) > 0.2 && y < S.elbow[1] - 0.04 ? 1 : -1);   // its sleeves end where the wraps begin
  P.push({ name: 'tunic', material: 'cloth', role: 'main', field: tunic, bounds: [[-(S.sx + 0.13), hem - 0.02, -0.2], [S.sx + 0.13, 1.5, 0.2]], res: 0.0085 });
  P.push(shirt(k, 'second'));
  P.push(trousers(k, 'main', 0.0055, hem + 0.03, 0.44));
  P.push(wraps(k, 'second'));
  // the sash: wide, ridged where it is wound, its ends hanging flat down the left hip
  const sy = S.waistY - 0.012, sash = k.garment(T + 0.0055, (x, y, z) => Math.max(sy - 0.044 - y, y - sy - 0.044, k.noArms(x, y)), base), ridge = (x, y, z) => sash(x, y, z) - 0.0022 * Math.max(0, Math.sin((y - sy) * 110));
  const tailPath = k.path([[0.15, sy - 0.02, 0.07], [0.165, sy - 0.12, 0.075], [0.175, sy - 0.23, 0.08]], T + 0.009, 0.02, base);
  P.push({ name: 'sash', material: 'cloth', role: 'second', parts: [{ field: ridge, bounds: [[-0.24, sy - 0.07, -0.2], [0.24, sy + 0.07, 0.2]] }, { field: k.band(tailPath, 0.05, 0.009, base, 0.003), bounds: k.boundsOf(tailPath, 0.04) }], res: 0.0058 });
  P.push(boots(k, 0.31));
  return P;
}
// A long belted robe with wide sleeves
function robeOutfit(k) {
  const S = k.S, P = [], hem = 0.1, T = 0.014, base = k.belled(S.waistY - 0.01, hem, 0.235, 0.195);
  const open = k.opening(NECK + 0.01, 0.05, 1.25, 0.004);
  const fold = (x, z) => 0.006 * Math.sin(Math.atan2(x, z) * 9 + 0.5);
  const wide = (x, y) => (Math.abs(x) > S.sx + 0.02 ? 0.026 * sstep(S.elbow[1] + 0.06, S.wrist[1], y) : 0);   // sleeves widen toward the wrist
  const robe = (x, y, z) => Math.max(base(x, y, z) - T - wide(x, y) - fold(x, z) * sstep(S.waistY - 0.04, hem + 0.1, y), hem - y, y - NECK, -open(x, y, z), y < S.wrist[1] + 0.03 && Math.abs(x) > 0.2 ? 1 : -1);
  const box = [[-(S.sx + 0.18), hem - 0.02, -0.25], [S.sx + 0.18, 1.5, 0.25]], mid = 0.8;
  P.push({ name: 'robe', material: 'cloth', role: 'main', parts: [{ field: robe, bounds: [box[0], [box[1][0], mid, box[1][2]]] }, { field: robe, bounds: [[box[0][0], mid, box[0][2]], box[1]] }], res: 0.0095 });
  P.push(shirt(k, 'second'));
  P.push(...belt(k, base, T, S.waistY - 0.015, 0.024));
  P.push(pouches(k, base, T, S.waistY - 0.05, [[-0.11, 0.2, 0.026, 0.03], [0.125, 0.2, 0.022, 0.027]]));
  P.push(boots(k, 0.26));
  return P;
}
// A long coat, open down the front over a tunic and trousers, with a stand collar
function coatOutfit(k) {
  const S = k.S, P = [], hem = 0.42, T = 0.0155, base = k.belled(S.waistY - 0.02, hem, 0.205, 0.17);
  const gap = (x, y, z) => (z > 0 ? 0.01 + 0.055 * sstep(1.36, hem, y) - Math.abs(x) : -1);   // it falls open below the chest
  const coat = (x, y, z) => Math.max(base(x, y, z) - T, hem - y, y - NECK + 0.004, gap(x, y, z), y < S.wrist[1] + 0.02 && Math.abs(x) > 0.2 ? 1 : -1);
  const lapel = k.both(seam(k, [[0.03, 1.4, 0.2], [0.05, 1.2, 0.2], [0.075, 0.9, 0.2], [0.085, 0.5, 0.2]], T, base));
  const box = [[-(S.sx + 0.15), hem - 0.02, -0.23], [S.sx + 0.15, 1.5, 0.23]], mid = 0.95, cf = ssub(0.003, coat, lapel);
  P.push({ name: 'coat', material: 'cloth', role: 'main', parts: [{ field: cf, bounds: [box[0], [box[1][0], mid, box[1][2]]] }, { field: cf, bounds: [[box[0][0], mid, box[0][2]], box[1]] }], res: 0.009 });
  const collar = k.garment(0.021, (x, y, z) => Math.max(1.437 - y, y - 1.49, z > 0.02 ? 0.024 - Math.abs(x) : -1));
  P.push({ name: 'collar', material: 'cloth', role: 'main', field: collar, bounds: [[-0.11, 1.42, -0.11], [0.11, 1.51, 0.11]], res: 0.005 });
  // under it: a tunic to the hip, a belt, trousers and boots
  P.push({ name: 'tunic', material: 'cloth', role: 'second', field: k.garment(0.0065, (x, y, z) => Math.max(0.84 - y, y - NECK - 0.004, k.noArms(x, y), z < -0.02 ? 1 : -1)), bounds: [[-0.22, 0.82, -0.03], [0.22, 1.5, 0.2]], res: 0.0085 });
  P.push(...belt(k, k.skin, 0.0065, S.waistY - 0.03, 0.02));
  P.push(trousers(k, 'dark', 0.0055, 0.87));
  P.push(boots(k, 0.4));
  return P;
}
// A hip-length fitted jacket with a harness strap, a belt of pouches, and bracers: a scout's or an operative's
function jacketOutfit(k) {
  const S = k.S, P = [], T = 0.0115, hem = S.waistY - 0.135;
  const open = k.opening(NECK + 0.01, 0.04, 1.33, 0.003);
  let jacket = k.garment(T, (x, y, z) => Math.max(hem - y, y - NECK, -open(x, y, z), y < S.wrist[1] + 0.02 && Math.abs(x) > 0.2 ? 1 : -1));
  const seams = k.union(k.both(seam(k, [[0.14, 1.33, 0.2], [0.125, 1.1, 0.2], [0.13, hem + 0.01, 0.2]], T, k.skin)), seam(k, [[0, 1.32, 0.2], [0, 1.1, 0.2], [0, hem + 0.01, 0.2]], T, k.skin), seam(k, [[-S.sx + 0.02, 1.36, -0.2], [0, 1.38, -0.2], [S.sx - 0.02, 1.36, -0.2]], T, k.skin));
  jacket = ssub(0.003, jacket, seams);
  P.push({ name: 'jacket', material: 'leather', role: 'main', field: jacket, bounds: [[-(S.sx + 0.13), hem - 0.02, -0.2], [S.sx + 0.13, 1.5, 0.2]], res: 0.0078 });
  P.push(shirt(k, 'second'));
  const collar = k.garment(0.0185, (x, y, z) => Math.max(1.44 - y, y - 1.482, z > 0.02 ? 0.03 - Math.abs(x) : -1));
  P.push({ name: 'collar', material: 'leather', role: 'main', field: collar, bounds: [[-0.11, 1.42, -0.11], [0.11, 1.5, 0.11]], res: 0.005 });
  // a strap from the left shoulder to the right hip, front and back, with a small case on it
  const fr = k.path([[0.105, 1.425, 0.03], [0.06, 1.33, 0.2], [-0.02, 1.2, 0.2], [-0.105, 1.07, 0.2], [-0.15, 0.99, 0.03]], T + 0.004, 0.015), bk = k.path([[0.105, 1.425, 0.0], [0.05, 1.32, -0.2], [-0.04, 1.18, -0.2], [-0.12, 1.05, -0.2], [-0.15, 0.99, 0.0]], T + 0.004, 0.015);
  const strap = union(k.band(fr, 0.03, 0.006, k.skin, 0.002), k.band(bk, 0.03, 0.006, k.skin, 0.002)), box = k.boxOn([0.02, 1.27, 0.2], [0.03, 0.022, 0.012], 0.004, [0.5, 1, 0], T + 0.006);
  P.push({ name: 'harness', material: 'leather', role: 'leather', parts: [{ field: strap, bounds: [[-0.2, 0.96, -0.2], [0.16, 1.46, 0.2]], res: 0.0055 }, { field: box, bounds: k.around(box.centre, 0.05), res: 0.0034 }] });
  P.push(...belt(k, k.skin, T, S.waistY - 0.07, 0.022));
  P.push(pouches(k, k.skin, T, S.waistY - 0.1, [[-0.1, 0.2, 0.024, 0.03], [-0.045, 0.2, 0.02, 0.026], [0.1, 0.2, 0.026, 0.032], [0.16, 0.0, 0.022, 0.034]]));
  P.push(bracers(k, 'second', 'leather'));
  P.push(trousers(k, 'second', 0.006, hem + 0.03));
  P.push(boots(k, 0.36));
  return P;
}
// Armour over a close undersuit: light (a fitted breastplate, shoulder caps, bracers, greaves) or heavy (a gorget,
// layered pauldrons and tassets added, over a long skirt of cloth)
function armourOutfit(k, heavy) {
  const S = k.S, P = [], T = heavy ? 0.021 : 0.016, top = 1.432, low = heavy ? S.waistY + 0.02 : S.waistY + 0.045;
  P.push(undersuit(k, heavy ? 'dark' : 'second'));
  // the cuirass: front and back plates, scooped at the neck and the arms, with a ridge down the breast
  const scoop = (x, y, z) => 0.075 - Math.hypot(x, (y - 1.475) * 1.15);
  let plate = k.garment(T, (x, y, z) => Math.max(low - y - 0.025 * sstep(0.03, 0.0, Math.abs(x)) * (z > 0 ? 1 : 0), y - top, k.noArms(x, y) + 0.012, scoop(x, y, z)));
  const lines = k.union(k.both(seam(k, [[0.03, 1.4, 0.2], [0.09, 1.3, 0.2], [0.11, 1.2, 0.2]], T, k.skin)), seam(k, [[-0.12, 1.21, 0.2], [0, 1.19, 0.2], [0.12, 1.21, 0.2]], T, k.skin), k.both(seam(k, [[S.sx - 0.045, 1.3, 0.0], [S.sx - 0.04, 1.2, 0.0], [S.sx - 0.045, low + 0.01, 0.0]], T, k.skin)));
  plate = ssub(0.003, plate, lines);
  P.push({ name: 'cuirass', material: 'plastic', role: 'main', field: plate, bounds: [[-0.24, low - 0.05, -0.2], [0.24, top + 0.02, 0.21]], res: 0.0062 });
  // shoulder caps (and on heavy armour a second, larger plate under each)
  const sh = S.shoulder, cap = (r, t, y0) => k.garment(t, (x, y, z) => Math.max(Math.hypot(Math.abs(x) - sh[0] - 0.004, y - sh[1] - 0.012, z - sh[2]) - r, y0 - y, k.armsOnly(x, y) - 0.035));
  const caps = heavy ? smin(0.004, cap(0.084, 0.022, sh[1] - 0.04), cap(0.112, 0.016, sh[1] - 0.1)) : cap(0.07, 0.0125, sh[1] - 0.035);
  P.push({ name: 'pauldrons', material: 'plastic', role: heavy ? 'second' : 'main', parts: [1, -1].map((s) => ({ field: caps, bounds: [[s * sh[0] - 0.14, sh[1] - 0.14, -0.14], [s * sh[0] + 0.14, sh[1] + 0.12, 0.14]] })), res: 0.006 });
  P.push(bracers(k, 'main', 'plastic', 0.012));
  // greaves on the shins, with a knee cap
  const greave = k.garment(0.0125, (x, y, z) => Math.max((heavy ? 0.255 : 0.215) - y, y - 0.46 - 0.05 * sstep(-0.02, 0.05, z), k.noArms(x, y), -0.045 - z));
  P.push({ name: 'greaves', material: 'plastic', role: 'main', field: greave, bounds: [[-0.19, 0.13, -0.07], [0.19, 0.54, 0.13]], res: 0.0062 });
  if (heavy) {
    // a gorget round the neck, tassets over the hips, and a long skirt of cloth under them
    const gorget = k.garment(0.019, (x, y, z) => Math.max(1.405 - y + 0.03 * sstep(0.03, 0.12, Math.abs(x)), y - 1.478, Math.abs(x) - 0.125));
    P.push({ name: 'gorget', material: 'plastic', role: 'second', field: gorget, bounds: [[-0.14, 1.38, -0.12], [0.14, 1.51, 0.13]], res: 0.0055 });
    const hem = 0.2, base = k.belled(S.waistY - 0.03, hem, 0.215, 0.18), fold = (x, z) => 0.005 * Math.sin(Math.atan2(x, z) * 10);
    const skirt = (x, y, z) => Math.max(base(x, y, z) - 0.009 - fold(x, z) * sstep(S.waistY - 0.08, hem + 0.1, y), hem - y, y - S.waistY - 0.03, z > 0 ? 0.02 + 0.05 * sstep(S.waistY - 0.1, hem, y) - Math.abs(x) : -1);
    P.push({ name: 'skirt', material: 'cloth', role: 'second', field: skirt, bounds: [[-0.26, hem - 0.02, -0.22], [0.26, S.waistY + 0.05, 0.22]], res: 0.011 });
    const tasset = k.garment(0.02, (x, y, z) => Math.max(S.waistY - 0.26 - y + 0.05 * Math.abs(Math.abs(x) - 0.105) / 0.07, y - S.waistY + 0.03, Math.abs(Math.abs(x) - 0.105) - 0.07, 0.0 - z), base);
    P.push({ name: 'tassets', material: 'plastic', role: 'main', field: tasset, bounds: [[-0.2, S.waistY - 0.3, -0.01], [0.2, S.waistY, 0.22]], res: 0.006 });
    P.push(...belt(k, base, 0.014, S.waistY - 0.02, 0.026));
  } else {
    P.push(...belt(k, k.skin, 0.008, S.waistY - 0.03, 0.022));
    P.push(pouches(k, k.skin, 0.008, S.waistY - 0.06, [[0.11, 0.2, 0.024, 0.03]]));
  }
  P.push(boots(k, heavy ? 0.24 : 0.2));
  return P;
}

// name, the builder, and the colours it opens in; a species may open an outfit in colours of its own (species.js)
export const OUTFITS = {
  wraps: { name: "Fighter's wraps", make: wrapsOutfit, colours: { main: 'bone', second: 'ash' } },
  armour: { name: 'Light armour', make: (k) => armourOutfit(k, false), colours: { main: 'ash', second: 'slate' } },
  plate: { name: "Guardian's plate", make: (k) => armourOutfit(k, true), colours: { main: 'charcoal', second: 'wine' } },
  jacket: { name: "Operative's jacket", make: jacketOutfit, colours: { main: 'umber', second: 'slate' } },
  coat: { name: 'Long coat', make: coatOutfit, colours: { main: 'slate', second: 'bone' } },
  robe: { name: 'Belted robe', make: robeOutfit, colours: { main: 'umber', second: 'sand' } },
};
export const HOODS = { none: { name: 'None' }, down: { name: 'Down' }, up: { name: 'Up' } };
// the pieces of an outfit, and the hood if one is worn (it takes the outfit's second colour, or the robe's own)
export function outfitPieces(key, o) {
  const k = makeKit(o), pieces = (OUTFITS[key] || OUTFITS.wraps).make(k), role = key === 'robe' || key === 'coat' ? 'main' : 'second';
  if (o.hood === 'down') pieces.push(cowl(k, role)); else if (o.hood === 'up') pieces.push(hood(k, role));
  pieces.forEach((p, i) => { p.index = i; });
  return pieces;
}
