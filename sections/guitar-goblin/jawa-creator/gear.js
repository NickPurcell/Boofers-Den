// Jawa creator: the hard things a Jawa carries and wears, built from the shared hard-surface kit
// (../droid-creator/hard.js) so they have crisp edges and take the shared weathering paint: an ion blaster cut down
// from an old rifle, a restraining-bolt tool with a bolt in it, a piece of salvage, goggles, a plate of sandcrawler
// hull kept as a clan keepsake, a pack of scrap, and the small fittings of the leather (buckles, studs, cells).
// Every maker draws into a kit of builders in its own local frame; the page puts it where it goes.
import * as THREE from 'three';
import { Builder, M, ROLE, rrect, ngon, rng } from '../droid-creator/hard.js';

const { PI, sin, cos } = Math;
export class GearKit {
  constructor() { this.metal = new Builder(); this.wood = new Builder(); this.glass = new Builder(); this.glow = new Builder(); this.plate = new Builder(); this.leather = new Builder(); }
  get all() { return [this.metal, this.wood, this.glass, this.glow, this.plate, this.leather]; }
  at(m, fn) { for (const b of this.all) b.push(m); try { fn(this); } finally { for (const b of this.all) b.pop(); } return this; }
}
// a frame from the sculpt (p where, u and v along the surface, n out of it) as a placement: local x = u, y = v, z = n
export const seat = (F, lift = 0) => new THREE.Matrix4().makeBasis(new THREE.Vector3(...F.u), new THREE.Vector3(...F.v), new THREE.Vector3(...F.n)).setPosition(F.p[0] + F.n[0] * lift, F.p[1] + F.n[1] * lift, F.p[2] + F.n[2] * lift);
// a hand's grip as a placement: local z along the forearm (where a barrel points), local y toward the thumb
export function inHand(grip) {
  const z = new THREE.Vector3(...grip.a), y = new THREE.Vector3(...grip.b), x = new THREE.Vector3().crossVectors(y, z).normalize();
  y.crossVectors(z, x).normalize();
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(...grip.at);
}

/* ---------------- things held in the hand ---------------- */
// An ion blaster: an old bolt-action rifle cut down to the grip and forend, with a fat emitter can on the barrel.
// Origin at the grip (where the hand closes), barrel along +z, top +y. About 34 cm long: big in a Jawa's hands.
export function ionBlaster(K) {
  const m = K.metal, w = K.wood;
  // the cut-down stock: a hand grip that sweeps down and back, sawn off flat
  w.role = ROLE.primary;
  w.at(M.mul(M.t(0, -0.018, -0.012), M.rx(-0.42)), (b) => b.loft([{ o: rrect(0.017, 0.026, 0.008, 3), z: -0.055 }, { o: rrect(0.021, 0.031, 0.009, 3), z: -0.02 }, { o: rrect(0.02, 0.028, 0.009, 3), z: 0.03 }]));
  // the forend under the barrel
  w.at(M.t(0, 0.004, 0), (b) => b.loft([{ o: rrect(0.021, 0.022, 0.008, 3), z: 0.04 }, { o: rrect(0.023, 0.024, 0.009, 3), z: 0.09 }, { o: rrect(0.02, 0.02, 0.008, 3), z: 0.168 }]));
  // receiver, bolt and its knob
  m.at(M.t(0, 0.022, 0.012), (b) => b.box(0.021, 0.024, 0.11, { rad: 0.006, role: ROLE.steel }));
  m.at(M.t(0, 0.034, 0), (b) => b.cyl(0.0078, -0.05, 0.03, { n: 14, role: ROLE.metal }));
  m.at(M.mul(M.t(0.004, 0.036, -0.03), M.ry(PI / 2), M.rx(0.5)), (b) => { b.cyl(0.0032, 0, 0.026, { n: 8, role: ROLE.metal }); b.at(M.t(0, 0, 0.03), (q) => q.ball(0.0062, { role: ROLE.metal })); });
  // the box magazine and the trigger in its guard
  m.at(M.t(0, -0.012, 0.045), (b) => b.box(0.015, 0.03, 0.03, { rad: 0.003, role: ROLE.dark }));
  m.tube([[0, 0.006, 0.006], [0, -0.014, 0.004], [0, -0.019, 0.016], [0, -0.012, 0.03]], 0.0019, { role: ROLE.steel, sides: 6, n: 14 });
  m.at(M.mul(M.t(0, -0.004, 0.014), M.rx(0.4)), (b) => b.box(0.003, 0.012, 0.003, { role: ROLE.dark }));
  // the barrel, bound to the forend with tape, and a sight
  m.at(M.t(0, 0.026, 0), (b) => b.cyl(0.0058, 0.06, 0.232, { n: 14, role: ROLE.dark }));
  for (const z of [0.1, 0.152]) m.at(M.t(0, 0.015, 0), (b) => b.cyl(0.0185, z, z + 0.012, { n: 18, role: ROLE.rubber, bevel: 0.002 }));
  m.at(M.t(0, 0.038, 0.2), (b) => b.box(0.003, 0.009, 0.01, { role: ROLE.steel }));
  // the emitter: a fat ribbed can with a brass collar, open at the mouth
  m.at(M.mul(M.t(0, 0.026, 0.222), M.rx(PI / 2)), (b) => {
    const p = [[0.0058, 0], [0.011, 0.002], [0.011, 0.01], [0.0215, 0.016]];
    for (let i = 0; i < 5; i++) { const y = 0.02 + i * 0.012; p.push([0.0215, y], [0.0195, y + 0.002], [0.0195, y + 0.005], [0.0215, y + 0.007]); }
    p.push([0.0215, 0.083], [0.0235, 0.086], [0.0235, 0.094], [0.02, 0.096], [0.016, 0.088], [0.016, 0.03], [0, 0.03]);
    b.lathe(p, { segs: 28, role: ROLE.dark });
    b.lathe([[0.0112, 0.0095], [0.0125, 0.0095], [0.0125, 0.0155], [0.0112, 0.0155]], { segs: 20, role: ROLE.brass });
  });
  // the emitter's faint charge, deep in the can
  K.glow.color = [0.25, 0.75, 1.0];
  K.glow.at(M.mul(M.t(0, 0.026, 0.2535), M.rx(-PI / 2)), (b) => b.lathe([[0.0001, 0], [0.011, 0]], { segs: 16, wear: false }));
  return { hose: [0, -0.03, -0.052], muzzle: [0, 0.026, 0.3] };
}

// A restraining bolt: a squat stepped cylinder with a knurled base ring and concentric discs on top. Stands on y = 0.
export function restrainingBolt(b, s = 1) {
  const p = [[0, 0], [0.0125 * s, 0], [0.0125 * s, 0.004 * s], [0.0112 * s, 0.0048 * s], [0.0112 * s, 0.009 * s], [0.0098 * s, 0.0102 * s], [0.0098 * s, 0.0122 * s], [0.0072 * s, 0.0122 * s], [0.0072 * s, 0.0108 * s], [0.0046 * s, 0.0108 * s], [0.0046 * s, 0.0138 * s], [0.0022 * s, 0.0138 * s], [0.0022 * s, 0.012 * s], [0, 0.012 * s]];
  b.lathe(p, { segs: 22, role: ROLE.steel });
  // the knurled ring round the base
  for (let i = 0; i < 18; i++) b.at(M.mul(M.ry((i / 18) * 2 * PI), M.t(0.0126 * s, 0.002 * s, 0)), (q) => q.box(0.0012 * s, 0.0036 * s, 0.0022 * s, { role: ROLE.dark, wear: false }));
}
// The tool that sets a restraining bolt: a pistol grip under a stubby driver with a magnet cup, a bolt riding in it.
// Origin at the grip, the cup along +z.
export function boltTool(K) {
  const m = K.metal;
  m.at(M.mul(M.t(0, -0.016, -0.004), M.rx(-0.3)), (b) => b.box(0.018, 0.05, 0.022, { rad: 0.006, role: ROLE.rubber }));
  m.at(M.t(0, 0.02, 0), (b) => { b.cyl(0.0165, -0.03, 0.05, { n: 20, role: ROLE.secondary, bevel: 0.003 }); b.cyl(0.0125, 0.05, 0.078, { n: 18, role: ROLE.steel }); b.cyl(0.0178, 0.078, 0.094, { n: 20, role: ROLE.dark, bevel: 0.002 }); });
  for (let i = 0; i < 4; i++) m.at(M.t(0, 0.02, -0.02 + i * 0.014), (b) => b.cyl(0.0178, 0, 0.004, { n: 20, role: ROLE.dark, bevel: 0.001 }));
  m.at(M.mul(M.t(0.0, 0.041, 0.02), M.rx(-0.25)), (b) => b.box(0.006, 0.006, 0.03, { role: ROLE.brass }));   // the setting lever
  m.at(M.mul(M.t(0, -0.002, 0.02), M.rx(0.35)), (b) => b.box(0.004, 0.014, 0.004, { role: ROLE.steel }));   // trigger
  m.at(M.mul(M.t(0, 0.02, 0.0935), M.rx(PI / 2)), (b) => restrainingBolt(b, 1.05));
  K.glow.color = [1.0, 0.55, 0.12];
  K.glow.at(M.t(0, 0.0385, -0.018), (b) => b.ball(0.0034, { segs: 10, n: 6 }));
  return { light: [0, 0.042, -0.018] };
}
// A piece of salvage worth carrying off: some droid's power unit, with its fins bent and two leads hanging.
// Origin at the carrying handle, the unit hanging below along -y... held by the handle with the body forward (+z).
export function salvage(K, seed = 3) {
  const m = K.metal, r = rng(seed);
  m.tube([[0, 0.0, -0.03], [0, 0.004, -0.012], [0, 0.004, 0.012], [0, 0.0, 0.03]], 0.0042, { role: ROLE.steel, sides: 8, n: 12 });   // the handle the hand closes on
  m.at(M.t(0, -0.046, 0), (b) => {
    b.at(M.rx(0), (q) => q.cyl(0.03, -0.055, 0.055, { n: 22, role: ROLE.primary, bevel: 0.004 }));
    for (let i = 0; i < 6; i++) b.cyl(0.034, -0.04 + i * 0.014, -0.036 + i * 0.014, { n: 22, role: ROLE.metal, bevel: 0.001 });
    b.cyl(0.022, 0.055, 0.072, { n: 18, role: ROLE.dark, bevel: 0.002 }); b.cyl(0.012, 0.072, 0.082, { n: 12, role: ROLE.brass });
    b.cyl(0.024, -0.066, -0.055, { n: 18, role: ROLE.steel, bevel: 0.002 });
    b.at(M.t(0.0, 0.031, 0.01), (q) => q.box(0.022, 0.006, 0.04, { rad: 0.004, role: ROLE.secondary }));   // an access plate
    for (const sx of [-1, 1]) b.at(M.t(sx * 0.018, 0.03, 0), (q) => q.box(0.005, 0.014, 0.008, { role: ROLE.steel }));   // lugs the handle is welded to
  });
  // two leads torn from wherever it came from
  for (const sx of [-1, 1]) m.tube([[sx * 0.012, -0.046, -0.066], [sx * 0.02, -0.06, -0.085], [sx * (0.03 + 0.02 * r()), -0.1, -0.08], [sx * 0.022, -0.13 - 0.03 * r(), -0.06]], 0.0026, { role: sx > 0 ? ROLE.rubber : ROLE.brass, sides: 6, n: 14 });
}

/* ---------------- worn ---------------- */
// Goggles pushed up on the brow: two cups with dark lenses on the strap. L and R are frames from the sculpt.
export function goggles(K, A) {
  for (const F of [A.L, A.R]) K.at(seat(F, 0.003), (k) => {
    k.at(M.rx(PI / 2), (q) => {
      q.metal.lathe([[0.0155, 0], [0.0185, 0.001], [0.0185, 0.008], [0.0165, 0.0125], [0.0142, 0.0125], [0.0142, 0.0095]], { segs: 24, role: ROLE.brass });
      q.metal.lathe([[0.019, 0.002], [0.0202, 0.002], [0.0202, 0.0058], [0.019, 0.0058]], { segs: 24, role: ROLE.dark });
      q.glass.lathe([[0.0143, 0.0092], [0.009, 0.0108], [0.0001, 0.0114]], { segs: 20, smooth: true, wear: false });
    });
  });
  // the bridge between the cups
  K.at(seat(A.M, 0.007), (k) => k.metal.box(0.012, 0.005, 0.004, { rad: 0.0015, role: ROLE.steel }));
}

// A plate of sandcrawler hull: rust-red patchwork plating with rivets, a stiffening rib, one corner torn away.
// It lies in the local xy plane facing +z, centred, w wide and h high.
export function hullPlate(K, w, h, seed = 5, opts = {}) {
  const b = K.plate, r = rng(seed), t = opts.thick ?? Math.max(0.0028, w * 0.022);
  const jit = () => (r() - 0.5) * 0.06;
  // the outline: a rough rectangle, one corner sheared off where it was cut from the hull, one edge bitten
  const o = [[-0.5 + jit() * 0.3, -0.5], [0.18, -0.5 + jit() * 0.2], [0.5, -0.3 + jit()], [0.5 + jit() * 0.2, 0.22], [0.4, 0.5 + jit() * 0.3], [0.06, 0.47], [-0.02, 0.5], [-0.5 + jit() * 0.3, 0.5 + jit() * 0.3], [-0.47, 0.08], [-0.52, 0.02]].map(([x, y]) => [x * w, y * h]);
  const part = (k) => (seed * 0.37 + k) % 1;   // the paint wants a number from 0 to 1 for each part
  b.role = ROLE.primary; b.seed = part(0);
  b.prism(o, -t, 0, { bevel: t * 0.3 });
  // plates laid over it, as the hull was patched: each a little proud, with a gap all round
  const patches = [[-0.26, 0.16, 0.4, 0.5, ROLE.secondary], [0.2, -0.2, 0.42, 0.44, ROLE.primary], [0.22, 0.27, 0.3, 0.26, ROLE.secondary]];
  let k = 0;
  for (const [cx, cy, pw, ph, role] of patches) { b.seed = part(0.21 * ++k); b.at(M.t(cx * w, cy * h, 0), (q) => q.prism(rrect(pw * w, ph * h, 0.004 * (w / 0.2), 2), 0, t * 0.45, { role, bevel: t * 0.14 })); }
  // a stiffening rib, and rivets along the edges of the patches
  b.seed = part(0.9);
  b.at(M.mul(M.t(-0.06 * w, -0.3 * h, 0), M.rz(0.05)), (q) => q.box(0.74 * w, 0.07 * h, t * 1.5, { rad: 0.002, role: ROLE.steel }));
  const rv = (x, y) => b.at(M.t(x * w, y * h, t * 0.45), (q) => q.cyl(Math.max(0.0016, w * 0.014), 0, Math.max(0.0008, w * 0.007), { n: 8, role: ROLE.steel, bevel: 0.0004 }));
  for (const [cx, cy, pw, ph] of patches) for (const sx of [-1, 1]) for (const sy of [-1, 1]) rv(cx + sx * (pw / 2 - 0.045), cy + sy * (ph / 2 - 0.05));
  for (let i = 0; i < 5; i++) rv(-0.4 + i * 0.17, -0.3);
  if (opts.hole) b.at(M.t(-0.3 * w, 0.4 * h, -t), (q) => q.cyl(w * 0.07, 0, t * 0.6, { n: 12, role: ROLE.dark, wear: false }));
  return { t };
}
// a pack of scrap on the back: pipes, a coil of cable and a housing, lashed together. Local z out of the back.
export function scrapPack(K, seed = 9) {
  const m = K.metal, r = rng(seed);
  for (let i = 0; i < 4; i++) {
    const x = -0.04 + i * 0.027, len = 0.2 + 0.1 * r(), rad = 0.0085 + 0.004 * r(), y0 = -0.11 - 0.02 * r();
    m.at(M.mul(M.t(x, y0, 0.016 + 0.006 * (i % 2)), M.rz((r() - 0.5) * 0.14), M.rx(-PI / 2)), (b) => { b.cyl(rad, 0, len, { n: 12, role: [ROLE.steel, ROLE.dark, ROLE.metal, ROLE.primary][i], bevel: 0.0015 }); b.cyl(rad * 0.72, len - 0.004, len + 0.002, { n: 10, role: ROLE.dark, wear: false }); });
  }
  m.at(M.t(0.012, -0.03, 0.048), (b) => b.box(0.075, 0.062, 0.04, { rad: 0.006, role: ROLE.secondary }));   // a housing off some machine
  m.at(M.t(0.012, -0.03, 0.069), (b) => { b.box(0.05, 0.036, 0.004, { rad: 0.004, role: ROLE.dark }); for (const sx of [-1, 1]) b.at(M.t(sx * 0.014, 0, 0.002), (q) => q.cyl(0.0075, 0, 0.004, { n: 10, role: ROLE.brass })); });
  // a coil of cable hung on the side
  const coil = []; for (let i = 0; i <= 44; i++) { const a = (i / 44) * 2 * PI * 2.6, rr = 0.03 + 0.0018 * (i % 2); coil.push([-0.062 + 0.0045 * (i / 44), 0.03 + rr * cos(a), 0.03 + rr * sin(a) * 0.55]); }
  m.tube(coil, 0.0034, { role: ROLE.rubber, sides: 6, n: 110 });
  // two lashings of cord round the lot
  for (const y of [-0.085, 0.05]) {
    const loop = []; for (let i = 0; i <= 20; i++) { const a = (i / 20) * 2 * PI; loop.push([0.004 + 0.066 * cos(a), y + 0.004 * sin(a * 2), 0.026 + 0.034 * sin(a)]); }
    K.leather.tube(loop, 0.0026, { role: ROLE.primary, sides: 6, n: 40 }); K.leather.tube(loop.map(([x, yy, z]) => [x, yy + 0.006, z]), 0.0026, { role: ROLE.primary, sides: 6, n: 40 });
  }
}

/* ---------------- the leather's fittings ---------------- */
// a frame buckle with its prong, on a strap `w` wide; local x along the strap, z out
export function buckle(b, w, role = ROLE.brass) {
  const hw = w / 2 + 0.0035, hl = 0.0085, t = 0.0026;
  for (const sy of [-1, 1]) b.at(M.t(0, sy * hw, 0.0018), (q) => q.box(2 * hl + t, t, t, { rad: 0.001, role }));
  for (const sx of [-1, 1]) b.at(M.t(sx * hl, 0, 0.0018), (q) => q.box(t, 2 * hw + t, t, { rad: 0.001, role }));
  b.at(M.mul(M.t(0, 0, 0.0034), M.rz(0.08)), (q) => q.box(2 * hl + 0.004, 0.0016, 0.0016, { role: ROLE.steel }));
}
export const stud = (b, r, role = ROLE.brass) => b.lathe([[0, 0], [r * 1.25, 0], [r * 1.25, r * 0.3], [r * 0.9, r * 0.85], [0.0001, r * 1.0]], { segs: 12, role, smooth: [false, false, true, true, true] });
// a power cell in its loop: from a to b (world points), radius r
export function cell(b, c) {
  const a = new THREE.Vector3(...c.a), d = new THREE.Vector3(...c.b).sub(a), len = d.length(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  b.at(new THREE.Matrix4().compose(a, q, new THREE.Vector3(1, 1, 1)), (k) => k.lathe([[0, 0], [c.r, 0], [c.r, len * 0.74], [c.r * 0.82, len * 0.8], [c.r * 0.82, len * 0.94], [c.r * 0.5, len], [0.0001, len]], { segs: 12, role: ROLE.brass }));
}

/* ---------------- wood ---------------- */
let woodTex = null;
export function woodMaterial() {
  if (!woodTex) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#6a4326'; g.fillRect(0, 0, 64, 256);
    let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 90; i++) { g.strokeStyle = `rgba(${rnd() < 0.5 ? '30,16,8' : '150,105,62'},${0.08 + 0.2 * rnd()})`; g.lineWidth = 0.6 + 1.6 * rnd(); const x = rnd() * 64; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6 * (rnd() - 0.5), 80, x + 6 * (rnd() - 0.5), 170, x + 4 * (rnd() - 0.5), 256); g.stroke(); }
    woodTex = new THREE.CanvasTexture(c); woodTex.colorSpace = THREE.SRGBColorSpace; woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping; woodTex.repeat.set(26, 9);
  }
  return new THREE.MeshStandardMaterial({ map: woodTex, color: 0xc8b8a8, roughness: 0.62, metalness: 0 });
}
