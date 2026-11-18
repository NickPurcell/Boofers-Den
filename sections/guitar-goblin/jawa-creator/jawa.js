// Jawa creator: the page. The figure's cloth is sculpted from signed distance shapes and meshed in workers
// (figure.js, straps.js, jobs.js on the shared mesher), woven and weathered by one material (cloth.js); its gear is
// built from the shared hard-surface kit (gear.js on ../droid-creator/hard.js and paint.js). The scene, lights,
// studio and picture export are the shared stage, and the workers the shared pool (../creator-kit/). This file puts
// the pieces together and runs the panel.
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';
import { createPool } from '../creator-kit/pool.js';
import { makeTextures, leatherMaterial } from '../duros-creator/materials.js';
import { noiseTexture, paintMaterial, glassMaterial, glowMaterial, halo } from '../droid-creator/paint.js';
import { M, ROLE } from '../droid-creator/hard.js';
import { BUILDS, HOODS, faceAt, skirtPoint } from './figure.js';
import { RIGS } from './straps.js';
import { weaveTexture, clothNoise, clothMaterial, fringeTexture, fringeMaterial, fringeGeometry, clothGeometry, MAX_PATCH } from './cloth.js';
import { GearKit, seat, inHand, ionBlaster, boltTool, salvage, restrainingBolt, goggles, hullPlate, scrapPack, buckle, stud, cell, woodMaterial } from './gear.js';

/* ---------------- the options ---------------- */
// Robe colours as the references show the species: dark warm browns first, then tans and rust reds, then the cloth
// of other clans (charcoal and grey-green from colder worlds, and a few dyes).
const ROBES = [
  { key: 'umber', name: 'Umber', c: '#4a2f1f' }, { key: 'earth', name: 'Dark earth', c: '#33231b' }, { key: 'chestnut', name: 'Chestnut', c: '#613420' },
  { key: 'rust', name: 'Rust red', c: '#75301c' }, { key: 'terracotta', name: 'Terracotta', c: '#8b4b2d' }, { key: 'tan', name: 'Tan', c: '#886946' },
  { key: 'sand', name: 'Sand', c: '#a38a63' }, { key: 'taupe', name: 'Pale taupe', c: '#8a7c6a' },
  { key: 'charcoal', name: 'Charcoal', c: '#2a2b30' }, { key: 'lichen', name: 'Grey-green', c: '#4b4d40' }, { key: 'plum', name: 'Plum', c: '#4c2a33' }, { key: 'ochre', name: 'Ochre', c: '#8f6a26' },
];
const EYES = [
  { key: 'amber', name: 'Amber', c: '#ffae2b' }, { key: 'yellow', name: 'Yellow', c: '#ffd93a' }, { key: 'orange', name: 'Orange', c: '#ff7d1c' }, { key: 'ember', name: 'Red-orange', c: '#ff4b22' },
  { key: 'pale', name: 'Pale gold', c: '#ffeeb0' }, { key: 'green', name: 'Yellow-green', c: '#c9f53c' }, { key: 'ice', name: 'Ice blue', c: '#8fd8ff' },
];
const LEATHERS = [{ key: 'tan', name: 'Tan', c: '#8a5a34', d: '#5e3c22' }, { key: 'red', name: 'Red-brown', c: '#6e3320', d: '#3f2219' }, { key: 'brown', name: 'Dark brown', c: '#3f2a1e', d: '#6b4a30' }, { key: 'black', name: 'Black', c: '#1a1614', d: '#4a3324' }];
const OPTIONS = {
  robe: { label: 'Robe', swatch: true, items: ROBES },
  cloth: { label: 'Cloth', items: [{ key: 'homespun', name: 'Homespun', pitch: 0.004 }, { key: 'ribbed', name: 'Ribbed', pitch: 0.0036 }, { key: 'burlap', name: 'Burlap', pitch: 0.0048 }] },
  wear: { label: 'Wear', items: [{ key: 'kept', name: 'Well kept', w: 0.12, d: 0.2 }, { key: 'worn', name: 'Worn', w: 0.42, d: 0.5 }, { key: 'ragged', name: 'Ragged', w: 0.8, d: 0.7 }, { key: 'sandblown', name: 'Sand-blown', w: 0.6, d: 1.15 }] },
  clan: { label: 'Clan marks', items: [{ key: 'none', name: 'Plain' }, { key: 'stripes', name: 'Hem stripes' }, { key: 'dipped', name: 'Dipped hem' }, { key: 'patched', name: 'Patched' }] },
  hood: { label: 'Hood', items: Object.entries(HOODS).map(([key, h]) => ({ key, name: h.name })) },
  eyes: { label: 'Eyes', swatch: true, items: EYES },
  gaze: { label: 'Eye shape', items: [{ key: 'points', name: 'Points', r: 0.0062 }, { key: 'round', name: 'Round', r: 0.0092 }, { key: 'wide', name: 'Wide', r: 0.0122 }] },
  glow: { label: 'Glow', items: [{ key: 'ember', name: 'Ember', g: 0.55 }, { key: 'bright', name: 'Bright', g: 1 }, { key: 'blazing', name: 'Blazing', g: 1.7 }] },
  build: { label: 'Build', items: [{ key: 'stout', name: 'Stout' }, { key: 'average', name: 'Average' }, { key: 'slight', name: 'Slight' }] },
  stance: { label: 'Stance', items: [{ key: 'rest', name: 'At rest' }, { key: 'ready', name: 'Ready' }, { key: 'haggle', name: 'Haggling' }, { key: 'utinni', name: 'Utinni!' }] },
  hands: { label: 'Hands', items: [{ key: 'black', name: 'Black gloves' }, { key: 'brown', name: 'Brown gloves' }, { key: 'wraps', name: 'Wrapped' }] },
  rig: { label: 'Straps', items: Object.entries(RIGS).map(([key, r]) => ({ key, name: r.name })) },
  leather: { label: 'Leather', swatch: true, items: LEATHERS },
  hold: { label: 'In hand', items: [{ key: 'none', name: 'Nothing' }, { key: 'blaster', name: 'Ion blaster' }, { key: 'bolt', name: 'Bolt tool' }, { key: 'salvage', name: 'Salvage' }] },
  extras: { label: 'Carries', multi: true, items: [{ key: 'goggles', name: 'Goggles' }, { key: 'satchel', name: 'Satchel' }, { key: 'scrap', name: 'Scrap pack' }] },
  keepsake: { label: 'Sandcrawler keepsake', items: [{ key: 'none', name: 'None' }, { key: 'talisman', name: 'Hull token' }, { key: 'shield', name: 'Hull-plate shield' }] },
};
// The page opens on a look of its own: a clan engineer with a bolt tool, goggles, and a token cut from the
// clan's sandcrawler.
const DEFAULT = { robe: 'rust', cloth: 'homespun', wear: 'worn', clan: 'stripes', hood: 'peaked', eyes: 'amber', gaze: 'round', glow: 'bright', build: 'average', stance: 'ready', hands: 'black', rig: 'toolbelt', leather: 'brown', hold: 'bolt', extras: 'goggles.satchel', keepsake: 'talisman', seed: '7' };
const state = {};
const pick = (opt, key) => OPTIONS[opt].items.find((o) => o.key === key) || OPTIONS[opt].items[0];
const multi = (opt) => new Set(String(state[opt] || '').split('.').filter((k) => OPTIONS[opt].items.some((o) => o.key === k)));
function settle(from = {}) {
  for (const [k, def] of Object.entries(OPTIONS)) {
    const v = from[k] ?? state[k] ?? DEFAULT[k];
    if (def.multi) { const ok = def.items.map((o) => o.key); state[k] = String(v || '').split('.').filter((x) => ok.includes(x)).join('.'); }
    else state[k] = def.items.some((o) => o.key === v) ? v : DEFAULT[k];
  }
  state.seed = /^\d{1,4}$/.test(from.seed ?? state.seed ?? '') ? String(from.seed ?? state.seed) : DEFAULT.seed;
}
settle(Object.fromEntries(new URLSearchParams(location.hash.slice(1))));
const writeHash = () => history.replaceState(null, '', '#' + new URLSearchParams(state).toString());

/* ---------------- the stage, the workers, the materials ---------------- */
const canvas = document.getElementById('scene');
const stage = makeStage(canvas, { tall: 1.0, minDistance: 0.3, maxDistance: 5, environment: 0.62, onNoGL: () => { document.getElementById('nogl').hidden = false; } });
const { scene, redraw, changed } = stage;
const VIEWS = { whole: { target: [0, 0.5, 0], pos: [0.82, 0.74, 2.7] }, hood: { target: [0, 0.8, 0.02], pos: [0.3, 0.87, 1.02] } };
const frameView = (which = 'whole') => { const v = VIEWS[which] || VIEWS.whole; stage.view(v.target, v.pos); };
frameView('whole');
changed();   // the first frame draws the shadow map, so nothing samples it before it exists
const pool = createPool(new URL('./jobs.js', import.meta.url));

makeTextures();
const WEAVE = {}, weaveOf = (k) => WEAVE[k] || (WEAVE[k] = weaveTexture(k));
const TEX = { weave: weaveOf(state.cloth), noise: clothNoise(256), fringe: fringeTexture() };
const noise = noiseTexture(256);
const MAT = {
  robe: clothMaterial(TEX), hand: clothMaterial(TEX, { pitch: 0.0017, sheen: 0.7, bump: 0.8 }), foot: clothMaterial(TEX, { pitch: 0.003, wrap: true, sheen: 0.3 }), canvas: clothMaterial(TEX, { pitch: 0.0034, sheen: 0.25 }),
  ties: clothMaterial(TEX, { side: THREE.DoubleSide }), fringe: fringeMaterial(TEX), face: new THREE.MeshBasicMaterial({ color: 0x000000, depthWrite: false }),   // drawn after the hood and without depth, so it never cuts the eyes' glow
  leather: [leatherMaterial('#3f2a1e'), leatherMaterial('#6b4a30')],
  gear: paintMaterial(noise), plate: paintMaterial(noise), wood: woodMaterial(), glass: glassMaterial(), glow: glowMaterial(),
  eye: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
};
MAT.hand.userData.u.uWeave.value = weaveOf('homespun'); MAT.canvas.userData.u.uWeave.value = weaveOf('burlap');
// the hull of a sandcrawler: rust-red plate over older brown, sand-scoured for generations
Object.assign(MAT.plate.userData.u, {}); MAT.plate.userData.u.uPrimary.value.set('#7a3622'); MAT.plate.userData.u.uSecondary.value.set('#5c4630'); MAT.plate.userData.u.uOdd.value.set('#8a6a3a'); MAT.plate.userData.u.uDirt.value.set('#a0683a'); MAT.plate.userData.u.uWear.value = 0.58;
MAT.gear.userData.u.uDirt.value.set('#8a7350');
const GEAR_PAINTS = ['#b59a5c', '#6f7d6a', '#8d4a2e', '#5d6b7c', '#a39a86', '#7a6a3a'];

const figure = new THREE.Group(); scene.add(figure);
// a patch of sand to stand on, fading into the studio floor
const sandBase = (() => {
  const g = new THREE.PlaneGeometry(1.5, 1.5, 110, 110).rotateX(-Math.PI / 2), pos = g.attributes.position, col = new Float32Array(pos.count * 4);
  const h = (x, z) => 0.0045 * (0.5 + 0.5 * Math.sin(x * 52 + Math.sin(z * 11 + x * 3) * 1.6)) + 0.003 * Math.sin(z * 9 + x * 4);   // wind ripples
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x);
    const edge = 0.6 + 0.03 * Math.sin(a * 3 + 1) + 0.015 * Math.sin(a * 7), al = Math.max(0, Math.min(1, (edge - r) / 0.34)), k = al * al * (3 - 2 * al);
    pos.setY(i, 0.0035 + h(x, z) * k);
    const sh = 0.86 + 0.14 * Math.sin(x * 52 + Math.sin(z * 11 + x * 3) * 1.6 + 0.9) + 0.06 * Math.sin(x * 131 + z * 97);
    col.set([0.25 * sh, 0.185 * sh, 0.11 * sh, k], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 1, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  m.receiveShadow = true; m.renderOrder = -1; scene.add(m);
  return m;
})();

/* ---------------- geometry helpers ---------------- */
// several mesher results as one (the robe comes from the workers in slabs)
function joinMeshes(ms) {
  if (ms.length === 1) return ms[0];
  let nv = 0, ni = 0; for (const m of ms) { nv += m.ao.length; ni += m.index.length; }
  const out = { position: new Float32Array(nv * 3), normal: new Float32Array(nv * 3), ao: new Float32Array(nv), uv: new Float32Array(nv * 2), mask: new Float32Array(nv), index: nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni) };
  let v = 0, i = 0;
  for (const m of ms) {
    out.position.set(m.position, v * 3); out.normal.set(m.normal, v * 3); out.ao.set(m.ao, v); out.uv.set(m.uv, v * 2); if (m.mask) out.mask.set(m.mask, v);
    for (let k = 0; k < m.index.length; k++) out.index[i + k] = m.index[k] + v;
    v += m.ao.length; i += m.index.length;
  }
  return out;
}
// a strap swept along a loop: a flat band with eased edges, lying on the body
function ribbonGeometry(R) {
  const N = R.pts.length / 3, P = [], Nn = [], U = [], C = [], I = [], prof = [[-1, 0, -0.5, -0.87], [-1, 0.72, -0.9, 0.44], [-0.86, 1, -0.3, 0.95], [0.86, 1, 0.3, 0.95], [1, 0.72, 0.9, 0.44], [1, 0, 0.5, -0.87]], K = prof.length;
  const at = (i, c) => R.pts[(((i % N) + N) % N) * 3 + c], nr = (i, c) => R.nrm[(((i % N) + N) % N) * 3 + c];
  let len = 0;
  for (let i = 0; i <= N; i++) {
    const p = [at(i, 0), at(i, 1), at(i, 2)], n = new THREE.Vector3(nr(i, 0), nr(i, 1), nr(i, 2));
    const u = new THREE.Vector3(at(i + 1, 0) - at(i - 1, 0), at(i + 1, 1) - at(i - 1, 1), at(i + 1, 2) - at(i - 1, 2)).normalize(), s = new THREE.Vector3().crossVectors(u, n).normalize();
    if (i > 0) len += Math.hypot(p[0] - at(i - 1, 0), p[1] - at(i - 1, 1), p[2] - at(i - 1, 2));
    for (const [a, b, na, nb] of prof) {
      P.push(p[0] + s.x * a * R.w / 2 + n.x * b * R.th, p[1] + s.y * a * R.w / 2 + n.y * b * R.th, p[2] + s.z * a * R.w / 2 + n.z * b * R.th);
      const q = new THREE.Vector3().addScaledVector(s, na).addScaledVector(n, nb).normalize(); Nn.push(q.x, q.y, q.z);
      U.push(len / 0.045, (a * R.w / 2) / 0.045); const sh = b > 0.9 ? 1 : b > 0.5 ? 0.82 : 0.5; C.push(sh, sh, sh);
    }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < K - 1; k++) { const a = i * K + k, b = a + K; I.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
  return g;
}
// a placement with local y along a direction (for things turned on a lathe: studs, bolts)
function upAlong(p, n, lift = 0) {
  const y = new THREE.Vector3(...n).normalize(), x = new THREE.Vector3(0, 1, 0).cross(y); if (x.lengthSq() < 1e-4) x.set(1, 0, 0); x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(p[0] + y.x * lift, p[1] + y.y * lift, p[2] + y.z * lift);
}
// the hood's ties: narrow strips of the same cloth hanging down the back, a little twisted, ends frayed
function tiesGeometry(ties, robeBack) {
  const P = [], N = [], I = [], AO = [], loops = [];
  let n = 0;
  for (const t of ties) {
    const segs = 14, w = 0.011, base = n, endPts = new Float32Array(6), endDir = new Float32Array(6);
    for (let i = 0; i <= segs; i++) {
      const k = i / segs, y = t.p[1] - t.len * k, sway = 0.006 * Math.sin(k * 5 + t.sx) * k;
      // it lies on the mantle at the top, then hangs clear of the back
      const z = Math.min(t.p[2] - 0.004 - 0.012 * k, robeBack(y) - 0.006), x = t.p[0] + sway + t.sx * 0.012 * k, tw = 0.5 * Math.sin(k * 3 + t.sx * 2) * k;
      const dx = Math.cos(tw) * w, dz = Math.sin(tw) * w;
      P.push(x - dx, y, z - dz, x + dx, y, z + dz); N.push(-Math.sin(tw), 0, -Math.cos(tw), -Math.sin(tw), 0, -Math.cos(tw)); AO.push(0.85, 0.85);
      if (i === segs) { endPts.set([x - dx, y, z - dz, x + dx, y, z + dz]); endDir.set([0, -1, 0, 0, -1, 0]); }
      n += 2;
    }
    for (let i = 0; i < segs; i++) { const a = base + i * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    loops.push({ pts: endPts, dir: endDir, closed: false, len: 0.022, seed: 41 + (t.sx > 0 ? 1 : 0) });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aAo', new THREE.Float32BufferAttribute(AO, 1)); g.setAttribute('aMask', new THREE.Float32BufferAttribute(new Float32Array(AO.length), 1));
  g.setIndex(I); g.computeBoundingSphere();
  return { g, loops };
}
const disposeIn = (o) => o.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.isSprite) c.material.dispose(); });

/* ---------------- the figure ---------------- */
// Each part of the figure is kept until a choice it depends on changes.
const slots = {}, eyeHalos = [];
function slot(name, key, make) {
  const s = slots[name];
  if (s && s.key === key) return s.object;
  if (s && s.object) { figure.remove(s.object); disposeIn(s.object); }
  const object = make(); slots[name] = { key, object };
  if (object) figure.add(object);
  return object;
}
const clothMesh = (m, mat) => { const o = new THREE.Mesh(clothGeometry(m), mat); o.castShadow = o.receiveShadow = true; return o; };

function gearGroup(A, hands) {
  const K = new GearKit(), ex = multi('extras'), B = BUILDS[state.build], seed = Number(state.seed), halos = [];
  // the leather's fittings: a stud on every pouch, a buckle on every strap, cells in their loops
  A.studs.forEach((st, i) => K.metal.at(upAlong(st.p, st.n, -0.0006), (b) => stud(b, st.r, i % 5 === 3 ? ROLE.steel : ROLE.brass)));
  A.buckles.forEach((bk, i) => K.metal.at(seat(bk), (b) => buckle(b, bk.w, i % 2 ? ROLE.steel : ROLE.brass)));
  for (const c of A.cells) cell(K.metal, c);
  if (A.goggles && ex.has('goggles')) goggles(K, A.goggles);
  if (A.belt) {   // a belt is for hanging things on: two spare bolts, and a flask
    for (const dx of [-0.017, 0.017]) K.metal.at(M.mul(upAlong(A.belt.right.p, A.belt.right.n, 0.004), M.t(dx, 0, 0)), (b) => restrainingBolt(b, 0.9));
    K.metal.at(M.mul(seat(A.belt.left, 0.02), M.t(0, -0.036, 0), M.rx(Math.PI / 2)), (b) => { b.lathe([[0, -0.03], [0.014, -0.03], [0.0165, -0.026], [0.0165, 0.02], [0.012, 0.027], [0.006, 0.03], [0.006, 0.037], [0.0075, 0.038], [0.0075, 0.043], [0, 0.043]], { segs: 18, role: ROLE.metal }); });
    K.metal.tube([A.belt.left.p, [A.belt.left.p[0] + A.belt.left.n[0] * 0.016, A.belt.left.p[1] - 0.004, A.belt.left.p[2] + A.belt.left.n[2] * 0.016], [A.belt.left.p[0] + A.belt.left.n[0] * 0.02, A.belt.left.p[1] - 0.03, A.belt.left.p[2] + A.belt.left.n[2] * 0.02]], 0.0016, { role: ROLE.steel, sides: 5, n: 8 });
  }
  // in the right hand
  const G = hands.grips.R, inH = inHand(G);
  if (state.hold === 'blaster') {
    let info; K.at(inH, (k) => { info = ionBlaster(k); });
    // its power lead runs back to the hip
    const a = new THREE.Vector3(...info.hose).applyMatrix4(inH), h = A.hip.p, mid = [(a.x + h[0]) / 2 + (A.hip.n ? A.hip.n[0] * 0.05 : -0.04), Math.min(a.y, h[1]) - 0.07, (a.z + h[2]) / 2 + 0.03];
    K.metal.tube([[a.x, a.y, a.z], [a.x, a.y - 0.03, a.z - 0.005], mid, [h[0] + (A.hip.n ? A.hip.n[0] * 0.012 : 0), h[1] - 0.01, h[2] + (A.hip.n ? A.hip.n[2] * 0.012 : 0)]], 0.0034, { role: ROLE.rubber, sides: 7, n: 26 });
    const mz = new THREE.Vector3(...info.muzzle).applyMatrix4(inH), dir = new THREE.Vector3(0, 0, 1).transformDirection(inH);
    halos.push({ p: mz.toArray(), n: dir.toArray(), color: 0x49b9ff, size: 0.07, k: 0.5 });
  } else if (state.hold === 'bolt') {
    let info; K.at(inH, (k) => { info = boltTool(k); });
    const lp = new THREE.Vector3(...info.light).applyMatrix4(inH);
    halos.push({ p: lp.toArray(), n: [0, 0, 0], color: 0xff9a2a, size: 0.035, k: 0.6 });
  } else if (state.hold === 'salvage') {
    // carried by its handle, hanging below the fist
    K.at(M.mul(inH, M.rx(-Math.PI / 2)), (k) => salvage(k, seed));
  }
  // a pack of scrap lashed to the back
  if (ex.has('scrap')) { const b = A.back, F = { p: b.p, n: b.n, v: [0, 1, 0], u: [-1, 0, 0] }; K.at(M.mul(seat(F, 0.006), M.t(0, 0.02, 0), M.rx(0.1)), (k) => scrapPack(k, seed + 2)); }
  // the keepsake: a plate cut from the clan's sandcrawler
  if (state.keepsake === 'talisman') {
    const c = A.chest, x = new THREE.Vector3(1, 0, 0), n = new THREE.Vector3(...c.n), v = new THREE.Vector3().crossVectors(n, x).normalize(), u = new THREE.Vector3().crossVectors(v, n);
    const F = { p: [c.p[0], c.p[1] - 0.03 * B.t, c.p[2]], u: u.toArray(), v: v.toArray(), n: c.n }, mt = M.mul(seat(F, 0.012), M.rz(0.12));
    K.at(mt, (k) => hullPlate(k, 0.064, 0.078, seed, { hole: true, thick: 0.0034 }));
    // hung on a cord from the neck, through the hole in its corner
    const hole = new THREE.Vector3(-0.3 * 0.064, 0.4 * 0.078, 0).applyMatrix4(mt), top = new THREE.Vector3(-0.3 * 0.064, 0.4 * 0.078 + 0.012, 0.002).applyMatrix4(mt);
    for (const nk of A.neck) K.leather.tube([nk, [(nk[0] + top.x) / 2, (nk[1] + top.y) / 2 + 0.004, (nk[2] + top.z) / 2 + 0.006], top.toArray(), hole.toArray()], 0.0013, { role: ROLE.primary, sides: 5, n: 16 });
  } else if (state.keepsake === 'shield') {
    // strapped along the left forearm: the plate's long side runs with the arm, its face turned outward
    const a = hands.arms.L, ax = new THREE.Vector3(...a.ax), out = new THREE.Vector3(...a.side).multiplyScalar(-1).addScaledVector(new THREE.Vector3(...a.up), 0.35).normalize();
    const y = ax.clone().multiplyScalar(-1), z = out.clone().addScaledVector(y, -out.dot(y)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
    const mid = new THREE.Vector3(...a.E).lerp(new THREE.Vector3(...a.W), 0.62).addScaledVector(z, 0.082).addScaledVector(new THREE.Vector3(0, -1, 0), 0.02);
    K.at(new THREE.Matrix4().makeBasis(x, y, z).setPosition(mid), (k) => {
      hullPlate(k, 0.2, 0.25, seed, { thick: 0.0045 });
      for (const dy of [-0.06, 0.06]) k.leather.at(M.t(0, dy, -0.02), (b) => b.box(0.11, 0.016, 0.03, { rad: 0.008, role: ROLE.primary, wear: false }));   // the arm straps behind it
    });
  }
  const g = new THREE.Group();
  const put = (b, mat, shadow = true) => { if (b.empty) return; const m = new THREE.Mesh(b.geometry(), mat); m.castShadow = shadow; m.receiveShadow = shadow; g.add(m); };
  put(K.metal, MAT.gear); put(K.plate, MAT.plate); put(K.wood, MAT.wood); put(K.glass, MAT.glass); put(K.glow, MAT.glow, false); put(K.leather, MAT.leather[1]);
  for (const h of halos) { const s = halo(h.color, h.size); s.position.set(...h.p); s.userData.n = new THREE.Vector3(...h.n); s.userData.k = h.k; g.add(s); }
  return g;
}

let building = 0;
const status = document.getElementById('status');
async function rebuild() {
  const ticket = ++building, t0 = performance.now();
  status.hidden = false;
  const ex = multi('extras'), n = pool.size(), nh = Math.min(3, n), b = state.build, held = state.hold !== 'none';
  const kRobe = `robe:${b}:${state.stance}`, kHood = `hood:${b}:${state.hood}`, kHands = `hands:${b}:${state.stance}:${held}`, kFeet = `feet:${b}`;
  const sArgs = { build: b, rig: state.rig, hood: state.hood, goggles: ex.has('goggles'), satchel: ex.has('satchel') }, kStraps = `straps:${b}:${state.rig}:${sArgs.goggles ? state.hood : ''}:${sArgs.satchel}`;
  const [robe, hood, hands, feet, straps] = await Promise.all([
    Promise.all(Array.from({ length: n }, (_, part) => pool.cached(`${kRobe}:${part}/${n}`, 'robe', { build: b, stance: state.stance, part, of: n }))),
    Promise.all(Array.from({ length: nh }, (_, part) => pool.cached(`${kHood}:${part}/${nh}`, 'hood', { build: b, hood: state.hood, part, of: nh }))), pool.cached(kHands, 'hands', { build: b, stance: state.stance, held }), pool.cached(kFeet, 'feet', { build: b }),
    pool.cached(kStraps, 'straps', sArgs),
  ]);
  if (ticket !== building) return;   // a newer choice is on its way
  const B = BUILDS[b], f = faceAt(B);
  slot('robe', kRobe, () => clothMesh(joinMeshes(robe.map((r) => r.mesh)), MAT.robe));
  slot('hood', kHood, () => clothMesh(joinMeshes(hood.map((h) => h.mesh)), MAT.robe));
  slot('fringe', kRobe + kHood, () => {
    const g = new THREE.Group(), back = (y) => skirtPoint(Math.PI, Math.min(y, 0.55 * B.t), B).p[2];
    const ties = tiesGeometry(hood[0].ties, back), tm = new THREE.Mesh(ties.g, MAT.ties); tm.castShadow = true; g.add(tm);
    const o = new THREE.Mesh(fringeGeometry([...robe[0].fringe, ...hood[0].fringe, ...ties.loops], 0.3, B.t), MAT.fringe); o.castShadow = true; g.add(o);
    return g;
  });
  slot('hands', kHands, () => { const g = new THREE.Group(); for (const h of hands.meshes) g.add(clothMesh(h, MAT.hand)); return g; });
  slot('feet', kFeet, () => clothMesh(feet.mesh, MAT.foot));
  slot('straps', kStraps, () => {
    const g = new THREE.Group();
    for (const p of straps.pieces) g.add(clothMesh(p.mesh, p.material === 'canvas' ? MAT.canvas : MAT.leather[p.tone ? 1 : 0]));
    for (const r of straps.anchors.ribbons) { const m = new THREE.Mesh(ribbonGeometry(r), MAT.leather[r.tone ? 1 : 0]); m.castShadow = m.receiveShadow = true; g.add(m); }
    return g;
  });
  // the face is a flat black nothing, set well back; the eyes are the only light in there
  slot('face', `face:${b}`, () => { const o = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), MAT.face); o.scale.set(...f.r); o.position.set(...f.c); o.renderOrder = 2; return o; });
  eyeHalos.length = 0;
  slot('eyes', `eyes:${b}:${state.gaze}`, () => {
    const g = new THREE.Group(), r = pick('gaze', state.gaze).r;
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12), MAT.eye); e.scale.set(1, 1, 0.45); e.position.set(s * f.eyeX, f.eyeY, f.eyeZ); e.renderOrder = 3; g.add(e);
      for (const [size, k] of [[r * 7.5, 1], [r * 19, 0.3]]) { const h = halo(0xffffff, size); h.position.set(s * f.eyeX, f.eyeY, f.eyeZ + 0.004); h.userData.n = new THREE.Vector3(0, 0, 1); h.userData.k = k; h.userData.eye = true; g.add(h); }
    }
    return g;
  });
  slots.eyes.object.traverse((o) => { if (o.isSprite) eyeHalos.push(o); });
  const kGear = [kStraps, kHands, state.hold, state.keepsake, state.extras, state.seed].join('|');
  slot('gear', kGear, () => gearGroup(straps.anchors, hands));
  slots.gear.object.traverse((o) => { if (o.isSprite) eyeHalos.push(o); });
  for (const u of [MAT.robe.userData.u, MAT.ties.userData.u, MAT.hand.userData.u, MAT.foot.userData.u, MAT.canvas.userData.u]) { u.uEyeL.value.set(f.eyeX, f.eyeY, f.eyeZ); u.uEyeR.value.set(-f.eyeX, f.eyeY, f.eyeZ); u.uTall.value = B.t; }
  patches(B);
  colours(); changed();
  status.hidden = true;
  let tris = 0; figure.traverse((o) => { if (o.isMesh && o.geometry.index) tris += o.geometry.index.count / 3; });
  info = { tris, ms: Math.round(performance.now() - t0) };
}
let info = { tris: 0, ms: 0 };

// squares of other cloth sewn on where the robe wore through: on the skirt, front and back
function patches(B) {
  const u = MAT.robe.userData.u, spots = [[0.5, 0.2, 0.034, 0.042, 0.3], [-0.75, 0.33, 0.03, 0.03, -0.2], [2.4, 0.16, 0.04, 0.034, 0.15], [-2.2, 0.3, 0.028, 0.04, 0.4], [1.5, 0.42, 0.026, 0.026, -0.3], [-0.15, 0.09, 0.03, 0.026, 0.1]];
  spots.slice(0, MAX_PATCH).forEach(([th, y, hu, hv, turn], i) => {
    const s = skirtPoint(th, y * B.t, B), n = new THREE.Vector3(...s.n), up = new THREE.Vector3(0, 1, 0), pu = new THREE.Vector3().crossVectors(up, n).normalize(), pv = new THREE.Vector3().crossVectors(n, pu);
    pu.applyAxisAngle(n, turn); pv.applyAxisAngle(n, turn);
    u.uPatchC.value[i].set(s.p[0], s.p[1], s.p[2], 0.03); u.uPatchU.value[i].set(pu.x, pu.y, pu.z, hu); u.uPatchV.value[i].set(pv.x, pv.y, pv.z, hv);
  });
}

// everything that changes without sculpting anything again
function colours() {
  const robe = new THREE.Color(pick('robe', state.robe).c), wear = pick('wear', state.wear), eye = new THREE.Color(pick('eyes', state.eyes).c), glow = pick('glow', state.glow).g, cl = pick('cloth', state.cloth);
  const hsl = {}; robe.getHSL(hsl);
  const u = MAT.robe.userData.u;
  u.uWeave.value = weaveOf(state.cloth); u.uPitch.value = cl.pitch;
  u.uCloth.value.copy(robe); u.uYarn.value.copy(robe).offsetHSL(0.015, -0.05, 0.07);
  u.uWear.value = wear.w; u.uDust.value = wear.d;
  // clan marks: stripes in a dye that stands off the cloth; a hem dipped dark (or pale, on dark cloth); patches of whatever was to hand
  const stripe = new THREE.Color().setHSL((hsl.h + (hsl.l < 0.2 ? 0.02 : 0.52)) % 1, hsl.l < 0.2 ? 0.45 : 0.5, hsl.l < 0.2 ? 0.42 : 0.12);
  if (state.robe === 'rust' || state.robe === 'terracotta' || state.robe === 'chestnut') stripe.set('#d8c49a');
  u.uStripe.value.copy(stripe); u.uStripes.value = state.clan === 'stripes' ? 1 : 0;
  if (hsl.l < 0.2) u.uDip.value.copy(robe).lerp(new THREE.Color('#b9a37c'), 0.6); else u.uDip.value.copy(robe).multiplyScalar(0.13).lerp(new THREE.Color('#1a0d08'), 0.3);
  u.uDipAmt.value = state.clan === 'dipped' ? 0.9 : 0;
  u.uPatches.value = state.clan === 'patched' ? MAX_PATCH : 0;
  const others = ROBES.filter((r) => r.key !== state.robe), seed = Number(state.seed);
  for (let i = 0; i < MAX_PATCH; i++) u.uPatchCol.value[i].set(others[(seed * 3 + i * 5) % others.length].c).lerp(robe, 0.25);
  u.uEyeCol.value.copy(eye); u.uGlow.value = glow;
  { const tu = MAT.ties.userData.u; tu.uWeave.value = u.uWeave.value; tu.uPitch.value = cl.pitch; tu.uCloth.value.copy(robe).multiplyScalar(0.92); tu.uYarn.value.copy(u.uYarn.value); tu.uWear.value = wear.w; tu.uDust.value = wear.d; }
  MAT.fringe.color.copy(robe).multiplyScalar(1.25).lerp(new THREE.Color('#b39a72'), 0.12 + 0.25 * Math.min(1, wear.d));
  // hands: knit gloves, or strips of the robe's own cloth wound round
  const hu = MAT.hand.userData.u, wraps = state.hands === 'wraps';
  hu.uCloth.value.set(wraps ? '#000000' : state.hands === 'brown' ? '#3e291c' : '#27221f'); if (wraps) hu.uCloth.value.copy(robe).multiplyScalar(0.8).lerp(new THREE.Color('#6a5a44'), 0.3);
  hu.uYarn.value.copy(hu.uCloth.value).multiplyScalar(1.5); hu.uWrap.value = wraps ? 1 : 0; hu.uPitch.value = wraps ? 0.0026 : 0.0017; hu.uDust.value = wear.d * 0.5; hu.uWear.value = wear.w * 0.6;
  const fu = MAT.foot.userData.u; fu.uCloth.value.copy(robe).multiplyScalar(0.7); fu.uYarn.value.copy(robe); fu.uDust.value = Math.min(1.3, wear.d * 1.5 + 0.2); fu.uWear.value = wear.w;
  const cu = MAT.canvas.userData.u; cu.uCloth.value.set('#7d6a4a'); cu.uYarn.value.set('#95805a'); cu.uDust.value = wear.d * 0.8; cu.uWear.value = wear.w;
  // leather: the chosen hide for the main strap, its partner for the second
  const lt = pick('leather', state.leather); MAT.leather[0].color.set(lt.c); MAT.leather[1].color.set(lt.d);
  // gear: service paint off whatever it was salvaged from, as worn as the robe
  const gu = MAT.gear.userData.u, seedN = Number(state.seed);
  gu.uPrimary.value.set(GEAR_PAINTS[seedN % GEAR_PAINTS.length]); gu.uSecondary.value.set(GEAR_PAINTS[(seedN * 5 + 2) % GEAR_PAINTS.length]); gu.uWear.value = 0.45 + 0.5 * wear.w;
  // the eyes: a hot core, the colour in the glow round it
  MAT.eye.color.copy(eye).lerp(new THREE.Color(1, 1, 1), 0.45).multiplyScalar(1.3 + 0.9 * glow);
  for (const h of eyeHalos) if (h.userData.eye) { h.material.color.copy(eye).multiplyScalar(0.55 + 0.6 * glow); h.userData.g = glow; }
  redraw();
}
// halos fade as their light turns away from the camera
const _wp = new THREE.Vector3();
stage.beforeRender = (cam) => {
  for (const s of eyeHalos) {
    const k = s.userData.k ?? 0.7, n = s.userData.n;
    if (!n || n.lengthSq() < 0.5) { s.material.opacity = k; continue; }
    s.getWorldPosition(_wp); const f = n.dot(_wp.sub(cam.position).normalize().negate());
    s.material.opacity = Math.max(0, Math.min(1, (f - 0.1) * 1.8)) * k * (s.userData.eye ? Math.min(1, 0.6 + 0.4 * (s.userData.g || 1)) : 1);
  }
};

/* ---------------- the panel ---------------- */
function summary() {
  const n = (k) => pick(k, state[k]).name.toLowerCase(), ex = [...multi('extras')].map((k) => pick('extras', k).name.toLowerCase());
  const carry = [state.hold !== 'none' ? (state.hold === 'salvage' ? 'a piece of salvage' : state.hold === 'blaster' ? 'an ion blaster' : 'a restraining-bolt tool') + ' in hand' : '', ...ex.map((e) => (e === 'goggles' ? 'goggles' : 'a ' + e)), state.keepsake !== 'none' ? (state.keepsake === 'shield' ? 'a shield' : 'a token') + " of the clan's sandcrawler plating" : ''].filter(Boolean);
  document.getElementById('summary').textContent = `${state.build === 'average' ? 'An' : 'A'} ${n('build')} Jawa in a ${n('wear')} ${n('robe')} ${n('cloth')} robe${state.clan !== 'none' ? ' (' + n('clan') + ')' : ''}, ${n('hood')} hood, ${n('glow')} ${n('eyes')} eyes; ${state.rig === 'none' ? 'no straps' : n('rig') + ' in ' + n('leather') + ' leather'}${carry.length ? '; carrying ' + carry.join(', ') : ''}.`;
}
function paint() {
  for (const el of document.querySelectorAll('[data-opt]')) {
    const on = OPTIONS[el.dataset.opt].multi ? multi(el.dataset.opt) : null;
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(on ? on.has(b.dataset.key) : b.dataset.key === state[el.dataset.opt]));
  }
  summary();
}
const SCULPTED = new Set(['build', 'stance', 'hood', 'rig', 'hold', 'extras', 'keepsake', 'gaze']);
function set(opt, k) {
  const def = OPTIONS[opt];
  if (def.multi) { const on = multi(opt); if (on.has(k)) on.delete(k); else on.add(k); state[opt] = def.items.map((o) => o.key).filter((x) => on.has(x)).join('.'); }
  else { if (state[opt] === k) return; state[opt] = k; }
  if (SCULPTED.has(opt)) rebuild(); else colours();
  paint(); writeHash();
}
const panelEl = document.getElementById('options');
for (const [opt, def] of Object.entries(OPTIONS)) {
  const fs = document.createElement('fieldset'); fs.className = 'opt';
  const lg = document.createElement('legend'); lg.textContent = def.label; fs.appendChild(lg);
  const box = document.createElement('div'); box.className = def.swatch ? 'swatches' : 'seg wrap'; box.dataset.opt = opt;
  for (const o of def.items) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.key = o.key;
    if (def.swatch) { b.className = 'sw'; b.style.setProperty('--c', o.c); b.setAttribute('aria-label', o.name); b.title = o.name; }
    else b.textContent = o.name;
    b.addEventListener('click', () => set(opt, o.key));
    box.appendChild(b);
  }
  fs.appendChild(box); panelEl.appendChild(fs);
}
document.getElementById('random').addEventListener('click', () => {
  const any = (k) => { const it = OPTIONS[k].items; return it[Math.floor(Math.random() * it.length)].key; };
  for (const [k, def] of Object.entries(OPTIONS)) state[k] = def.multi ? def.items.map((o) => o.key).filter(() => Math.random() < 0.4).join('.') : any(k);
  // most Jawas wear the browns, and most eyes are yellow to orange: the rarer cloths and eyes stay rare
  if (Math.random() < 0.5) state.robe = ROBES[Math.floor(Math.random() * 6)].key;
  if (Math.random() < 0.6) state.eyes = EYES[Math.floor(Math.random() * 4)].key;
  if (Math.random() < 0.5) state.keepsake = 'none';
  state.seed = String(1 + Math.floor(Math.random() * 999));
  rebuild(); paint(); writeHash();
});
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => frameView(b.dataset.view));

/* ---------------- pictures ---------------- */
const bgChoice = () => (document.querySelector('input[name=bg]:checked') || { value: 'studio' }).value;
// the sand it stands on belongs to the studio: a plain or transparent picture is the figure alone
function shot(size, bg, cam, ground) { sandBase.visible = bg === 'studio'; const url = stage.snapshot(size, bg, cam, ground); sandBase.visible = true; return url; }
document.getElementById('save').addEventListener('click', () => stage.download(shot(1024, bgChoice(), stage.squareCamera(), true), `jawa-${state.robe}-${state.hood}-${state.seed}.png`));
// the token: 512 px, the hood and shoulders from the front and a little to one side, so the eyes still read at map size
const tokenCam = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
function tokenShot(bg) {
  const t = BUILDS[state.build].t, top = Math.max(HOODS[state.hood].peak[0] * t, 0.97 * t) + 0.015, low = 0.585 * t, mid = (top + low) / 2, span = top - low + 0.05;
  tokenCam.position.set(0.16, mid + 0.03, span / 0.536 + 0.08); tokenCam.lookAt(0, mid, 0); tokenCam.updateProjectionMatrix();
  return shot(512, bg, tokenCam, false);
}
document.getElementById('token').addEventListener('click', () => stage.download(tokenShot(bgChoice() === 'studio' ? 'plain' : bgChoice()), `jawa-token-${state.robe}-${state.seed}.png`));

/* ---------------- run ---------------- */
const hint = document.getElementById('hint');
stage.controls.addEventListener('start', () => hint.classList.add('gone'));
paint();
const ready = rebuild();
stage.start();
// for checking from outside: set a whole look, and take a small picture from a given view
const apply = (look) => { settle({ ...DEFAULT, ...look }); paint(); writeHash(); return rebuild(); };
const thumb = (size, pos, target, bg = 'studio') => { const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 30); cam.position.set(...pos); cam.lookAt(...target); cam.updateProjectionMatrix(); return shot(size, bg, cam, true); };
window.__jawa = { THREE, stage, pool, state, set, ready, rebuild, colours, frameView, figure, MAT, apply, thumb, tokenShot, camera: stage.camera, controls: stage.controls, view: (pos, target) => stage.view(target, pos), stats: () => ({ ...stage.stats(), ...info }), get ms() { return info.ms; }, get tris() { return info.tris; }, tokenCam };
