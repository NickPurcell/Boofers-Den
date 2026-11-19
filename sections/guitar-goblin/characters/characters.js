// Character creator on the human base (in progress): the figure from ../human-base/ (engineer13's library: the body,
// its shapes, skin, eyes and the Pureblood's features), with this page's hair (hair.js) and, next, its clothes.
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';
import { loadBase, DEFAULTS } from '../human-base/base.js';
import { pureblood, PUREBLOOD } from '../human-base/species/pureblood.js';
import { makeHair } from './hair.js';
import { STYLES } from './hair-shape.js';
import { createPool } from '../creator-kit/pool.js';
import { makeTextures, clothMaterial, leatherMaterial, metalMaterial, plasticMaterial } from '../duros-creator/materials.js';
import { OUTFITS } from './outfit-shape.js';

const $ = (id) => document.getElementById(id);
const stage = makeStage($('scene'), { tall: 1.8, minDistance: 0.22, maxDistance: 6, onNoGL: () => { $('nogl').hidden = false; } });
const base = await loadBase();
const fig = base.figure(); stage.scene.add(fig);
const pb = pureblood(fig, base);
const hair = makeHair(base, fig);

// his character's look by default (a heavy, broad-shouldered man, red skin, orange-yellow eyes, black hair slicked back):
// the build and look are the base's own Pureblood preset (human-base-test), until the library exports one
const SHAPE = { gender: 1, age: 0.08, muscle: 0.82, weight: 0.86, height: 0.2, shoulders: 0.9, chest: 0.55, pecs: 0.45, lats: 0.6, belly: 0.45, heavyset: 0.55, arms: 0.45, armMuscle: 0.5,
  neck: 0.9, neckDepth: 0.6, doubleChin: 0.1, browh: -0.3, browr: 0.6, browa: -0.35, lids: -0.35, forehead: 0.1, eyesize: -0.2, eyebags: 0.15, nosew: 0.35, nosel: 0.1, nosehump: 0.3,
  nostrils: 0.2, mouthw: 0.15, lips: -0.1, corners: -0.2, cheekbones: 0.65, cheeks: -0.2, chinw: 0.55, chinjut: 0.3, chinh: 0.15, jaw: 0.9, headfat: 0.1, headage: 0.25, square: 0.45 };
const LOOK = { skin: '#952a22', eyes: 'ember', glow: 0.35, brows: 0, white: '#9a6a48', iris: 1.3, lips: '#2a0c0c', sockets: 0.6 };
const HAIRS = { black: '#16110e', dkbrown: '#2a1d14', redbrown: '#4a1a14', grey: '#8a8684', white: '#d8d4d0' };
const state = { style: 'slick', hair: 'black', outfit: 'plate', hood: 'none', main: '#34373e', second: '#6a2229' };
{ const q = new URLSearchParams(location.hash.slice(1)); if (STYLES[q.get('style')]) state.style = q.get('style'); if (HAIRS[q.get('hair')]) state.hair = q.get('hair'); if (OUTFITS[q.get('outfit')]) state.outfit = q.get('outfit'); if (['none', 'down', 'up'].includes(q.get('hood'))) state.hood = q.get('hood'); }

function apply() {
  fig.set({ ...DEFAULTS, ...SHAPE });
  fig.skin.userData.set({ tone: LOOK.skin, browAmount: LOOK.brows, lips: LOOK.lips, sockets: LOOK.sockets });
  // under armour, a dark close undersuit painted on the skin: the body, sleeves to the wrists, legs to the ankles
  const suit = OUTFITS[state.outfit]?.suit; fig.skin.userData.set(suit ? { suit: '#1f2126', suitOn: true, suitCover: suit } : { suitOn: false });
  fig.eyes.set({ colour: LOOK.eyes, glow: LOOK.glow, white: LOOK.white, iris: LOOK.iris });
  const on = Object.fromEntries(Object.entries(PUREBLOOD.options).map(([k, o]) => [k, o.def])); pb.set({ ...on, jewellery: 'gold', on: true });
  fig.update();
  hair.set(state.hood === 'up' ? 'bald' : state.style, HAIRS[state.hair]);   // a raised hood covers the hair
  stage.changed();
}

/* ---------------- clothes: meshed in workers from the live body ---------------- */
makeTextures();
const pool = createPool(new URL('./jobs.js', import.meta.url));
const tris = (() => { const q = base.quads, out = new Uint32Array(q.length / 4 * 6); for (let f = 0, o = 0; f < q.length; f += 4, o += 6) { out[o] = q[f]; out[o + 1] = q[f + 1]; out[o + 2] = q[f + 2]; out[o + 3] = q[f]; out[o + 4] = q[f + 2]; out[o + 5] = q[f + 3]; } return out; })();
// armour plate: painted steel, not mirror: some metal, a satin finish, a thin clear coat over it
const plateMaterial = (hex) => new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.45, roughness: 0.5, clearcoat: 0.35, clearcoatRoughness: 0.45, normalMap: metalMaterial(hex).normalMap || null, normalScale: new THREE.Vector2(0.15, 0.15) });
const MATS = { cloth: clothMaterial, leather: leatherMaterial, metal: plateMaterial, plastic: (hex) => { const m = plasticMaterial(hex); m.roughness = 0.46; m.clearcoat = 0.25; return m; } };
const clothes = new THREE.Group(); clothes.name = 'clothes'; fig.add(clothes);
let dressTicket = 0;
function clothGeometry(m) {   // mesher arrays -> geometry, with its occlusion as vertex colour
  const g = new THREE.BufferGeometry(), n = m.ao.length, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = 0.32 + 0.68 * Math.pow(m.ao[i], 1.4); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3)); g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(m.index, 1)); g.computeBoundingSphere(); return g;
}
async function dress() {
  const my = ++dressTicket, key = state.outfit;
  for (const c of [...clothes.children]) { clothes.remove(c); c.geometry.dispose(); c.material.dispose(); }
  if (!OUTFITS[key] || key === 'none') return;
  const J = Object.fromEntries(Object.keys(base.info.joints).map((k) => [k, fig.joint(k)]));
  const L = Object.fromEntries(['neckSideL', 'neckSideR', 'chestMid', 'backMid'].map((k) => { const l = fig.landmark(k); return [k, { p: l.p, n: l.n }]; }));
  const args = { key, hood: state.hood, surface: { position: fig.p0.slice(), normal: fig.n0.slice(), index: tris }, J, L }, n = pool.size(), t0 = performance.now();
  $('status').hidden = false; $('status').textContent = 'Dressing…';
  const rs = await Promise.all(Array.from({ length: n }, (_, part) => pool.mesh('outfit', { ...args, part, of: n })));
  if (my !== dressTicket) return;
  const cols = { main: state.main, second: state.second, dark: '#25272d', leather: '#46321f', metal: '#a4a9b0', trim: '#c9a24a' };
  for (const p of rs.flatMap((r) => r.pieces)) { const m = new THREE.Mesh(clothGeometry(p.mesh), (MATS[p.material] || clothMaterial)(cols[p.role] || '#777777')); m.material.vertexColors = true; m.castShadow = m.receiveShadow = true; m.name = p.name; clothes.add(m); }
  $('status').hidden = true; info.dress = Math.round(performance.now() - t0); stage.changed();
}
const info = {};

/* ---------------- views ---------------- */
const headAt = () => new THREE.Vector3().addVectors(fig.eyes.l.position, fig.eyes.r.position).multiplyScalar(0.5);
const VIEWS = {
  whole: () => [[0, 0.95, 0.05], [1.4, 1.3, 4.2]],
  bust: () => { const h = headAt(); return [[0, h.y - 0.18, h.z - 0.05], [0.35, h.y - 0.05, h.z + 1.25]]; },
  face: () => { const h = headAt(); return [[0, h.y - 0.03, h.z - 0.04], [0.22, h.y, h.z + 0.62]]; },
};
const view = (n) => { const [t, p] = VIEWS[n](); stage.view(t, p); };
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view(b.dataset.view));
stage.controls.addEventListener('start', () => $('hint').classList.add('gone'));

apply(); view('bust'); $('status').hidden = true;
const dressed = dress();
stage.start();
window.__fig = { fig, base, hair, state, stage, camera: stage.camera, controls: stage.controls, redraw: stage.redraw, get ready() { return dressed; }, views: VIEWS, info };
