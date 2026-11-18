// Outfits for the Duros creator. Each outfit is { key, name, colours, build(kit) }, where build returns pieces:
//   { name, material: 'cloth' | 'leather' | 'metal' | 'plastic' | 'light', field, bounds, res?, colour? }
// `field` is a signed distance function in the figure's frame (metres; see kit.js), `bounds` the box to mesh it in,
// `res` the grid spacing (default 5 mm; small gear wants 2.5 to 3 mm). A piece's colour comes from `colour`, or
// from the outfit's `colours[name]`. One piece is one draw call, so keep an outfit to about a dozen pieces.
import { makeKit } from './kit.js';

const JACKET_T = 0.013;

function scout(k) {
  const b = k.build, P = [], T = JACKET_T;
  const sleeveLine = 0.205 * b;
  // under it all: a dark shirt (only where the jacket's neck opens) and plain trousers below the jacket
  P.push({ name: 'shirt', material: 'cloth', field: k.garment(0.004, (x, y, z) => Math.max(1.3 - y, y - 1.556, Math.abs(x) - 0.075, 0.0 - z)), bounds: [[-0.09, 1.28, -0.02], [0.09, 1.6, 0.17]] });
  P.push({ name: 'trousers', material: 'cloth', field: k.garment(0.007, (x, y) => y - 0.95), bounds: k.torsoBox(0.56, 0.96), res: 0.007 });
  // the field jacket: open at the neck in a V, to the hip, sleeves to just above the wrist
  const open = k.opening(1.575, 0.05, 1.34, 0.004);
  const region = (x, y, z) => Math.max(0.925 - y, y - 1.56, Math.abs(x) > sleeveLine ? 0.982 - y : -1, -open(x, y, z));
  let jacket = k.garment(T, region);
  // seams pressed into it: over the shoulders, round the armholes, down the sides, and a yoke across the back
  const seam = (pts) => k.chain(k.path(pts, T, 0.01), 0.0014);
  const seams = k.union(
    k.both(seam([[0.06, 1.545, -0.01], [0.13 * b, 1.515, -0.005], [0.19 * b, 1.49, -0.004]])),
    k.both(seam([[0.19 * b, 1.5, -0.01], [0.215 * b, 1.44, 0.06], [0.2 * b, 1.38, 0.0], [0.215 * b, 1.44, -0.07], [0.19 * b, 1.5, -0.01]])),
    k.both(seam([[0.15 * b, 1.32, 0.0], [0.145 * b, 1.1, 0.0], [0.15 * b, 0.94, 0.0]])),
    seam([[-0.17 * b, 1.43, -0.09], [0, 1.445, -0.11], [0.17 * b, 1.43, -0.09]]),
  );
  jacket = k.ssub(0.0025, jacket, seams);
  P.push({ name: 'jacket', material: 'cloth', field: jacket, bounds: k.torsoBox(0.9, 1.6), res: 0.0062 });
  // a stand collar, open at the throat, and cuffs
  const collar = k.garment(0.016, (x, y, z) => Math.max(1.53 - y, y - 1.556, z > 0.03 ? 0.03 - Math.abs(x) : -1));
  const cuff = k.garment(0.018, (x, y) => Math.max(0.978 - y, y - 1.008, sleeveLine + 0.01 - Math.abs(x)));
  const wr = k.at.wrist;
  P.push({ name: 'collar', material: 'cloth', parts: [
    { field: collar, bounds: [[-0.1, 1.5, -0.1], [0.1, 1.62, 0.1]] },
    { field: cuff, bounds: [[wr[0] - 0.07, 0.95, wr[2] - 0.07], [wr[0] + 0.07, 1.04, wr[2] + 0.07]] },
    { field: cuff, bounds: [[-wr[0] - 0.07, 0.95, wr[2] - 0.07], [-wr[0] + 0.07, 1.04, wr[2] + 0.07]] },
  ], res: 0.004 });
  // four flapped pockets with a snap each
  const pocketParts = [], snaps = [];
  for (const [px, py, w, h] of [[0.068, 1.392, 0.026, 0.03], [0.095, 1.09, 0.036, 0.04]]) {
    const pocket = k.boxOn([px * b, py, 0.2], [w, h, 0.0045], 0.004, [0, 1, 0], T);
    const flap = k.boxOn([px * b, py + h + 0.004, 0.2], [w + 0.003, 0.011, 0.0065], 0.004, [0, 1, 0], T);
    const f = k.both(k.union(pocket, flap));
    pocketParts.push({ field: f, bounds: k.around(pocket.centre, 0.06) }, { field: f, bounds: k.around([-pocket.centre[0], pocket.centre[1], pocket.centre[2]], 0.06) });
    snaps.push(k.on([px * b, py + h - 0.002, 0.2], T + 0.012).p);
  }
  P.push({ name: 'pockets', material: 'cloth', parts: pocketParts, res: 0.0026 });
  // the scarf: a thick wrap round the neck, a knot to one side and two ends hanging down the chest
  // two loose turns round the neck (tori tilted a little forward), a soft knot, and two ends down the chest
  const turn = (y, R, r, tilt) => { const c = Math.cos(tilt), sn = Math.sin(tilt); return (x, yy, z) => {
    const py = yy - y, pz = z + 0.022, ry = py * c - pz * sn, rz = py * sn + pz * c;   // tilt about x
    const q = Math.hypot(x, rz * 1.08) - R; return Math.hypot(q, ry) - r; }; };
  const wrap = k.smin(0.012, turn(1.566, 0.06, 0.0165, 0.2), turn(1.541, 0.069, 0.0185, 0.28));
  const knot = k.boxOn([0.028, 1.52, 0.2], [0.02, 0.017, 0.014], 0.013, [0, 1, 0], 0.034);
  const end1 = k.band(k.path([[0.03, 1.505, 0.12], [0.042, 1.43, 0.15], [0.05, 1.34, 0.15]], 0.024, 0.012), 0.056, 0.008);
  const end2 = k.band(k.path([[0.016, 1.505, 0.12], [0.008, 1.44, 0.15], [0.002, 1.38, 0.15]], 0.03, 0.012), 0.05, 0.008);
  P.push({ name: 'scarf', material: 'cloth', field: k.smin(0.01, wrap, knot, end1, end2), bounds: [[-0.12, 1.3, -0.13], [0.12, 1.6, 0.17]], res: 0.0036 });
  // leather: a bandolier from the right shoulder to the left hip (front and back), a belt, a satchel, a holster
  const front = k.path([[-0.12 * b, 1.53, 0.0], [-0.08 * b, 1.46, 0.12], [0.02, 1.3, 0.14], [0.12 * b, 1.1, 0.12], [0.16 * b, 0.98, 0.05]], T + 0.004, 0.022);
  const back = k.path([[-0.12 * b, 1.53, 0.0], [-0.08 * b, 1.45, -0.12], [0.03, 1.28, -0.13], [0.15 * b, 1.04, -0.08]], T + 0.004, 0.022);
  const strapF = k.band(front, 0.036, 0.005), strapB = k.band(back, 0.036, 0.005);
  const belt = k.clip(k.shell(0.024, k.skin, -0.009), (x, y) => Math.max(1.035 - y, y - 1.072, Math.abs(x) - 0.19 * b));
  const satchel = k.union(k.boxOn([0.13 * b, 0.94, 0.2], [0.07, 0.055, 0.026], 0.012, [0, 1, 0], T + 0.003, k.skin, 0.06),
    k.boxOn([0.13 * b, 0.975, 0.2], [0.072, 0.032, 0.03], 0.012, [0, 1, 0], T + 0.004, k.skin, 0.06));
  const holster = k.boxOn([-0.155 * b, 0.95, 0.12], [0.026, 0.062, 0.02], 0.01, [0, 1, 0], T + 0.002);
  const sat0 = k.on([0.13 * b, 0.94, 0.2], T).p;
  P.push({ name: 'leather', material: 'leather', parts: [
    { field: strapF, bounds: k.boundsOf(front, 0.03), res: 0.0038 }, { field: strapB, bounds: k.boundsOf(back, 0.03), res: 0.0038 },
    { field: belt, bounds: k.torsoBox(1.02, 1.085, 0.02), res: 0.005 },
    { field: satchel, bounds: k.around(sat0, 0.1) }, { field: holster, bounds: k.around(holster.centre, 0.09) },
  ], res: 0.004 });
  // the blaster's grip out of the holster
  const h = holster;
  const gripC = k.v.add(h.centre, k.v.add(k.v.mul(h.v, 0.072), k.v.mul(h.n, 0.004)));
  const grip = k.box(gripC, h.u, k.v.norm(k.v.add(h.v, k.v.mul(h.n, -0.25))), h.n, [0.013, 0.034, 0.016], 0.005);
  const guard = k.box(k.v.add(gripC, k.v.mul(h.v, -0.03)), h.u, h.v, h.n, [0.016, 0.006, 0.02], 0.003);
  P.push({ name: 'blaster', material: 'plastic', field: k.union(grip, guard), bounds: k.around(gripC, 0.06), res: 0.0022 });
  // metal: the belt buckle, a buckle on the bandolier, the pocket snaps
  const buckleF = k.ssub(0.001, k.boxOn([0, 1.054, 0.2], [0.024, 0.018, 0.004], 0.003, [0, 1, 0], 0.023), k.boxOn([0.004, 1.054, 0.2], [0.014, 0.009, 0.01], 0.002, [0, 1, 0], 0.023));
  const sbI = Math.floor(front.length * 0.32), sb = front[sbI];
  const strapBuckle = k.boxOn(sb, [0.022, 0.017, 0.003], 0.003, k.v.norm(k.v.sub(front[sbI - 2], sb)), T + 0.009);
  const snapF = (x, y, z) => { let d = Infinity; for (const s of snaps) d = Math.min(d, Math.hypot(Math.abs(x) - s[0], y - s[1], z - s[2]) - 0.0042); return d; };
  P.push({ name: 'metal', material: 'metal', parts: [
    { field: buckleF, bounds: k.around(k.on([0, 1.054, 0.2], 0.024).p, 0.04) }, { field: strapBuckle, bounds: k.around(sb, 0.04) },
    ...snaps.flatMap((s) => [{ field: snapF, bounds: k.around(s, 0.012) }, { field: snapF, bounds: k.around([-s[0], s[1], s[2]], 0.012) }]),
  ], res: 0.002 });
  return P;
}

function pilot(k) {
  const b = k.build, P = [], T = 0.009, wr = k.at.wrist;
  const sleeveLine = 0.205 * b;
  // a one-piece flight suit: body, arms and legs, with panel seams and a zip down the front
  let suit = k.garment(T, (x, y) => Math.max(y - 1.555, Math.abs(x) > sleeveLine ? 0.975 - y : -1));
  const seam = (pts) => k.chain(k.path(pts, T, 0.012), 0.0013);
  suit = k.ssub(0.0022, suit, k.union(
    k.both(seam([[0.06, 1.545, -0.01], [0.13 * b, 1.515, -0.005], [0.19 * b, 1.49, -0.004]])),
    k.both(seam([[0.19 * b, 1.5, -0.01], [0.215 * b, 1.44, 0.06], [0.2 * b, 1.38, 0.0], [0.215 * b, 1.44, -0.07], [0.19 * b, 1.5, -0.01]])),
    k.both(seam([[0.05 * b, 1.5, 0.15], [0.07 * b, 1.38, 0.15], [0.06 * b, 1.25, 0.15]])),
    k.both(seam([[0.15 * b, 1.32, 0.0], [0.145 * b, 1.1, 0.0], [0.15 * b, 0.94, 0.0]])),
  ));
  P.push({ name: 'suit', material: 'cloth', field: suit, bounds: k.torsoBox(0.56, 1.6), res: 0.0062 });
  // the padded collar ring and quilted cuffs
  const ring = k.garment(0.024, (x, y) => Math.max(1.522 - y, y - 1.578));
  const cuff = k.garment(0.016, (x, y) => Math.max(0.972 - y, y - 1.0, sleeveLine + 0.01 - Math.abs(x)));
  P.push({ name: 'padding', material: 'cloth', parts: [
    { field: ring, bounds: [[-0.11, 1.5, -0.11], [0.11, 1.6, 0.11]] },
    { field: cuff, bounds: [[wr[0] - 0.07, 0.95, wr[2] - 0.07], [wr[0] + 0.07, 1.03, wr[2] + 0.07]] },
    { field: cuff, bounds: [[-wr[0] - 0.07, 0.95, wr[2] - 0.07], [-wr[0] + 0.07, 1.03, wr[2] + 0.07]] },
  ], res: 0.004 });
  // the harness: shoulder straps to a chest unit, on to a waist belt; the same down the back; loops round the thighs
  const H = T + 0.005;
  const chestAt = k.on([0, 1.33, 0.2], H).p;
  const strapsF = [], strapsB = [];
  for (const s of [1, -1]) {
    strapsF.push(k.path([[s * 0.1 * b, 1.535, -0.01], [s * 0.095 * b, 1.46, 0.12], [s * 0.04, 1.36, 0.15], [s * 0.03, 1.31, 0.15]], H, 0.02));
    strapsF.push(k.path([[s * 0.03, 1.31, 0.15], [s * 0.06 * b, 1.2, 0.14], [s * 0.08 * b, 1.1, 0.13]], H, 0.02));
    strapsB.push(k.path([[s * 0.1 * b, 1.535, -0.01], [s * 0.09 * b, 1.45, -0.12], [s * 0.08 * b, 1.25, -0.13], [s * 0.09 * b, 1.1, -0.11]], H, 0.02));
  }
  const belt = k.clip(k.shell(H + 0.006, k.skin, -(T + 0.001)), (x, y) => Math.max(1.08 - y, y - 1.112, Math.abs(x) - 0.19 * b));
  const loop = k.clip(k.shell(T + 0.008, k.skin, -(T + 0.001)), (x, y) => Math.max(0.84 - y, y - 0.866, 0.02 - Math.abs(x), Math.abs(x) - 0.19 * b));
  P.push({ name: 'harness', material: 'leather', parts: [
    ...strapsF.map((pts) => ({ field: k.band(pts, 0.04, 0.005), bounds: k.boundsOf(pts, 0.03) })),
    ...strapsB.map((pts) => ({ field: k.band(pts, 0.04, 0.005), bounds: k.boundsOf(pts, 0.03) })),
    { field: belt, bounds: k.torsoBox(1.06, 1.13, 0.02) },
    { field: loop, bounds: k.torsoBox(0.82, 0.89, 0.02) },
  ], res: 0.005 });
  // the chest unit: a moulded box with a raised panel, and three status lights
  const unit = k.boxOn([0, 1.33, 0.2], [0.052, 0.036, 0.016], 0.006, [0, 1, 0], H);
  const panel = k.boxOn([0.0, 1.338, 0.2], [0.036, 0.02, 0.0215], 0.003, [0, 1, 0], H);
  P.push({ name: 'unit', material: 'plastic', field: k.union(unit, panel), bounds: k.around(chestAt, 0.07), res: 0.0022 });
  const lamp = (dx) => k.boxOn([dx, 1.318, 0.2], [0.0045, 0.0035, 0.0235], 0.0015, [0, 1, 0], H);
  P.push({ name: 'lampA', material: 'light', field: k.union(lamp(-0.018), lamp(0.0)), bounds: k.around(chestAt, 0.05), res: 0.0015 });
  P.push({ name: 'lampB', material: 'light', field: lamp(0.018), bounds: k.around(chestAt, 0.05), res: 0.0015 });
  // pockets: on both thighs and the left sleeve; a mission patch on the right shoulder
  const pockets = [];
  for (const sx of [1, -1]) {
    const pk = k.boxOn([sx * 0.11 * b, 0.76, 0.2], [0.042, 0.05, 0.007], 0.005, [0, 1, 0], T);
    const fl = k.boxOn([sx * 0.11 * b, 0.818, 0.2], [0.045, 0.012, 0.0095], 0.004, [0, 1, 0], T);
    pockets.push({ field: k.union(pk, fl), bounds: k.around(pk.centre, 0.08) });
  }
  const sleevePk = k.boxOn([0.24 * b, 1.32, 0.08], [0.024, 0.032, 0.006], 0.004, [0, 1, 0], T);
  pockets.push({ field: sleevePk, bounds: k.around(sleevePk.centre, 0.05) });
  P.push({ name: 'pockets', material: 'cloth', parts: pockets, res: 0.0028 });
  const patch = k.boxOn([-0.225 * b, 1.4, 0.06], [0.021, 0.021, 0.0028], 0.006, [0, 1, 0], T);
  P.push({ name: 'patch', material: 'cloth', field: patch, bounds: k.around(patch.centre, 0.04), res: 0.0018 });
  // metal: the zip down the front and two harness buckles
  const zip = k.path([[0, 1.53, 0.2], [0, 1.42, 0.2], [0, 1.3, 0.2], [0, 1.12, 0.2]], T, 0.02);
  const buckles = [1, -1].map((s) => { const pts = strapsF[s > 0 ? 0 : 2]; const i = Math.floor(pts.length * 0.45); return k.boxOn(pts[i], [0.024, 0.016, 0.003], 0.002, k.v.norm(k.v.sub(pts[i - 1], pts[i + 1])), H + 0.004); });
  P.push({ name: 'metal', material: 'metal', parts: [
    { field: k.band(zip, 0.007, 0.0035), bounds: k.boundsOf(zip, 0.02) },
    ...buckles.map((f) => ({ field: f, bounds: k.around(f.centre, 0.04) })),
  ], res: 0.002 });
  // flight gloves over the hands
  const glove = k.garment(0.0028, (x, y) => y - 0.985, k.hands);
  P.push({ name: 'gloves', material: 'leather', parts: [1, -1].map((s) => ({ field: glove, bounds: [[s * wr[0] - 0.07, 0.7, wr[2] - 0.05], [s * wr[0] + 0.07, 1.0, wr[2] + 0.09]] })), res: 0.003 });
  return P;
}

function trader(k) {
  const b = k.build, P = [], wr = k.at.wrist;
  const sleeveLine = 0.205 * b;
  // a pale shirt, seen at the throat, with a stand collar
  P.push({ name: 'shirt', material: 'cloth', field: k.garment(0.004, (x, y, z) => Math.max(1.33 - y, y - 1.592, Math.abs(x) - 0.08, z < 0.0 && y < 1.55 ? 1 : -1, z < 0.03 && y > 1.55 ? 0.03 - z : -1)), bounds: [[-0.1, 1.3, -0.1], [0.1, 1.62, 0.17]], res: 0.004 });
  // a waistcoat, buttoned, in a V
  const vOpen = k.opening(1.56, 0.032, 1.36, 0.0);
  P.push({ name: 'waistcoat', material: 'cloth', field: k.garment(0.009, (x, y, z) => Math.max(0.99 - y, y - 1.53, Math.abs(x) - 0.2 * b, -vOpen(x, y, z))), bounds: k.torsoBox(0.95, 1.57), res: 0.0055 });
  // the long coat: open down the front, the skirt hanging clear of the legs, sleeves to the wrist
  const skirt = (x, y, z) => { const t = Math.min(1, Math.max(0, (1.05 - y) / 0.5)); const rx = (0.17 + 0.05 * t) * b, rz = 0.13 + 0.03 * t; return y > 1.05 ? 1 : (Math.hypot(x / rx, z / rz) - 1) * Math.min(rx, rz); };
  const drape = k.smin(0.05, k.skin, skirt);
  const coatOpen = (x, y, z) => { if (z < 0.02) return 1; const w = y > 1.08 ? 0.072 : 0.072 + (1.08 - y) * 0.18; return Math.abs(x) - w; };
  const coat = k.garment(0.017, (x, y, z) => Math.max(0.58 - y, y - 1.56, Math.abs(x) > sleeveLine ? 0.975 - y : -1, -coatOpen(x, y, z)), drape);
  P.push({ name: 'coat', material: 'cloth', field: coat, bounds: k.torsoBox(0.56, 1.6), res: 0.0065 });
  // a high collar standing up behind the neck, wide lapels folded back, deep cuffs
  const collar = k.garment(0.024, (x, y, z) => Math.max(1.52 - y, y - 1.64 + Math.max(0, z) * 0.6, z - 0.035));
  const lapel = k.both((x, y, z) => {
    const t = Math.min(1, Math.max(0, (1.55 - y) / 0.32)), w = 0.072 + 0.058 * Math.sin(t * Math.PI) * (1 - t * 0.4);
    return Math.max(drape(x, y, z) - 0.021, Math.abs(x - (0.072 + w) / 2) - (w - 0.072) / 2, 1.22 - y, y - 1.555, 0.03 - z);
  });
  const cuff = k.garment(0.024, (x, y) => Math.max(0.975 - y, y - 1.03, sleeveLine + 0.01 - Math.abs(x)), drape);
  P.push({ name: 'lapels', material: 'cloth', parts: [
    { field: collar, bounds: [[-0.12, 1.49, -0.13], [0.12, 1.66, 0.06]] },
    { field: lapel, bounds: [[-0.17, 1.2, -0.02], [0.17, 1.58, 0.19]] },
    { field: cuff, bounds: [[wr[0] - 0.08, 0.95, wr[2] - 0.08], [wr[0] + 0.08, 1.05, wr[2] + 0.08]] },
    { field: cuff, bounds: [[-wr[0] - 0.08, 0.95, wr[2] - 0.08], [-wr[0] + 0.08, 1.05, wr[2] + 0.08]] },
  ], res: 0.0042 });
  // a sash round the waist with two ends hanging at the left hip
  const sash = k.clip(k.shell(0.026, drape, -0.012), (x, y) => Math.max(1.04 - y, y - 1.09, Math.abs(x) - 0.2 * b));
  const tail1 = k.band(k.path([[0.1 * b, 1.06, 0.13], [0.12 * b, 0.96, 0.14], [0.125 * b, 0.86, 0.15]], 0.03, 0.02, drape), 0.05, 0.007, drape);
  const tail2 = k.band(k.path([[0.12 * b, 1.06, 0.12], [0.145 * b, 0.97, 0.12], [0.15 * b, 0.9, 0.12]], 0.034, 0.02, drape), 0.045, 0.007, drape);
  P.push({ name: 'sash', material: 'cloth', parts: [{ field: sash, bounds: k.torsoBox(1.01, 1.12, 0.03) }, { field: k.union(tail1, tail2), bounds: [[0.0, 0.8, 0.0], [0.26 * b, 1.1, 0.22]] }], res: 0.0045 });
  // gilt: piping down the lapel edges, waistcoat buttons, a pendant on a chain
  const edge = (s) => k.chain(k.path([[s * 0.074, 1.55, 0.2], [s * 0.074, 1.4, 0.2], [s * 0.074, 1.1, 0.2], [s * 0.074 * 1.4, 0.8, 0.2], [s * 0.074 * 1.9, 0.6, 0.2]], 0.017, 0.02, drape), 0.0028);
  const buttons = [1.47, 1.42, 1.37, 1.32, 1.27, 1.22, 1.17, 1.12].map((y) => k.on([0, y, 0.2], 0.0115).p);
  const buttonF = (x, y, z) => { let d = Infinity; for (const p of buttons) d = Math.min(d, Math.hypot(x - p[0], (y - p[1]) * 1.0, (z - p[2]) * 1.6) - 0.0055); return d; };
  const chainPts = k.path([[-0.05, 1.53, -0.02], [-0.05, 1.47, 0.11], [0, 1.39, 0.15], [0.05, 1.47, 0.11], [0.05, 1.53, -0.02]], 0.012, 0.02);
  const pend = k.boxOn([0, 1.375, 0.2], [0.016, 0.02, 0.004], 0.006, [0, 1, 0], 0.012);
  P.push({ name: 'gilt', material: 'metal', parts: [
    { field: edge(1), bounds: [[0.05, 0.56, 0.05], [0.18, 1.58, 0.22]], res: 0.003 }, { field: edge(-1), bounds: [[-0.18, 0.56, 0.05], [-0.05, 1.58, 0.22]], res: 0.003 },
    { field: buttonF, bounds: [[-0.03, 1.1, 0.03], [0.03, 1.5, 0.2]] },
    { field: k.union(k.chain(chainPts, 0.0018), pend), bounds: k.boundsOf(chainPts.concat([pend.centre]), 0.03) },
  ], res: 0.0021 });
  return P;
}

export const OUTFITS = [
  { key: 'scout', name: "Scout's jacket & scarf", build: scout,
    colours: { shirt: '#2e3833', trousers: '#3a3934', jacket: '#7a6446', collar: '#6c583c', pockets: '#755f42', scarf: '#9a4630', leather: '#4b3323', blaster: '#2b2d31', metal: '#b19a6e' } },
  { key: 'pilot', name: 'Flight suit', build: pilot,
    colours: { suit: '#5b634d', padding: '#41473a', harness: '#2c2e2f', unit: '#2a2d31', lampA: '#ffb347', lampB: '#55e08a', pockets: '#545c47', patch: '#c4672e', metal: '#9da3a8', gloves: '#3f4246' } },
  { key: 'trader', name: "Trader's coat", build: trader,
    colours: { shirt: '#d8cdb3', waistcoat: '#7a5a2e', coat: '#3c2340', lapels: '#55304f', sash: '#b4893a', gilt: '#d2a84e' } },
];
export function outfitPieces(key, build) {
  const o = OUTFITS.find((x) => x.key === key) || OUTFITS[0];
  return o.build(makeKit(build)).map((p, i) => Object.assign({ colour: o.colours[p.name], index: i }, p));
}
