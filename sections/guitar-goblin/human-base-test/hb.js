// Human base test: the workbench for the human base library (../human-base/). Sliders for every morph, the skin and
// the eyes, and the species features, with presets. Linked from nowhere; the creator page proper is built on top of
// the same library.
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';
import { loadBase, SLIDERS, DEFAULTS } from '../human-base/base.js';
import { EYE_COLOURS } from '../human-base/eyes.js';
import { pureblood, PUREBLOOD } from '../human-base/species/pureblood.js';

const $ = (id) => document.getElementById(id);
const stage = makeStage($('scene'), { tall: 1.8, minDistance: 0.22, maxDistance: 6, environment: 0.55 });
stage.key.shadow.normalBias = 0.012; stage.key.shadow.bias = -0.0006;   // a bigger figure than the kit's default; keeps the chest clear of acne
const t0 = performance.now();
const base = await loadBase();
const fig = base.figure();
stage.scene.add(fig);
const loadMs = Math.round(performance.now() - t0);

/* ---------------- looks ---------------- */
const SKINS = { pale: '#ecd2c2', light: '#d9b49c', medium: '#b98e72', tan: '#9a7357', brown: '#6f4d39', deep: '#45302a', orangered: '#a63a24', scarlet: '#952a22', crimson: '#7c1f1e', brick: '#8a3a2c', maroon: '#5c1b1c', wine: '#3a1216', grey: '#8d949b' };
const LOOK0 = { skin: 'medium', eyes: 'brown', glow: 0, brows: 0.85, species: 'human', white: '#e6dfd6', iris: 1, lips: null, sockets: 0.4 };
const LOOK = { ...LOOK0 };
const PBDEF = Object.fromEntries(Object.entries(PUREBLOOD.options).map(([k, v]) => [k, v.def]));
const PB = { ...PBDEF };
// his build: about 180 cm, heavy and powerful, wide shoulders, a thick neck, a strong brow and jaw
const PRESETS = {
  neutral: { shape: {}, look: {} },
  pureblood: {
    shape: { gender: 1, age: 0.08, muscle: 0.82, weight: 0.86, height: 0.2, shoulders: 0.9, chest: 0.55, pecs: 0.45, lats: 0.6, belly: 0.45, heavyset: 0.55, arms: 0.45, armMuscle: 0.5,
      neck: 0.9, neckDepth: 0.6, doubleChin: 0.1, browh: -0.3, browr: 0.6, browa: -0.35, lids: -0.35, forehead: 0.1, eyesize: -0.2, eyebags: 0.15, nosew: 0.35, nosel: 0.1, nosehump: 0.3,
      nostrils: 0.2, mouthw: 0.15, lips: -0.1, corners: -0.2, cheekbones: 0.65, cheeks: -0.2, chinw: 0.55, chinjut: 0.3, chinh: 0.15, jaw: 0.9, headfat: 0.1, headage: 0.25, square: 0.45 },
    look: { skin: 'crimson', eyes: 'ember', glow: 0.35, brows: 0, species: 'pureblood', white: '#9a6a48', iris: 1.3, lips: '#2a0c0c', sockets: 0.6 },
  },
};
const shape = { ...DEFAULTS };
const pb = pureblood(fig, base); fig.features = pb;

function apply() {
  fig.set(shape);
  fig.skin.userData.set({ tone: SKINS[LOOK.skin], browAmount: LOOK.brows, lips: LOOK.lips, sockets: LOOK.sockets, suitCover: { torso: shape.gender < 0.75, arms: 0, legs: 0 } });
  fig.eyes.set({ colour: LOOK.eyes, glow: LOOK.glow, white: LOOK.white, iris: LOOK.iris });
  pb.set({ ...PB, on: LOOK.species === 'pureblood' });
  fig.update();
  showStats();
  stage.changed();
}

/* ---------------- the panel ---------------- */
const panel = $('options'), inputs = {};
function group(title, open) { const d = document.createElement('details'); d.className = 'group'; d.open = open; const s = document.createElement('summary'); s.textContent = title; d.appendChild(s); panel.appendChild(d); return d; }
function slider(parent, obj, k, label, lo, hi) {
  const row = document.createElement('label'); row.className = 'slide';
  const name = document.createElement('span'); name.textContent = label;
  const r = document.createElement('input'); r.type = 'range'; r.min = lo; r.max = hi; r.step = 0.01; r.value = obj[k];
  const out = document.createElement('output'); out.textContent = Number(obj[k]).toFixed(2);
  r.addEventListener('input', () => { obj[k] = Number(r.value); out.textContent = Number(r.value).toFixed(2); schedule(); });
  row.append(name, r, out); parent.appendChild(row); inputs[obj === shape ? k : `${k}@${panel.children.length}`] = [r, out, obj, k];
}
const choices = [];
function choice(parent, label, obj, key, items, swatch) {
  const fs = document.createElement('fieldset'); fs.className = 'opt'; const lg = document.createElement('legend'); lg.textContent = label; fs.appendChild(lg);
  const box = document.createElement('div'); box.className = swatch ? 'swatches' : 'seg wrap';
  for (const [k, v] of Object.entries(items)) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.key = k;
    if (swatch) { b.className = 'sw'; b.style.setProperty('--c', v); b.title = k; b.setAttribute('aria-label', k); } else b.textContent = v;
    b.addEventListener('click', () => { obj[key] = k; paint(); schedule(); }); box.appendChild(b);
  }
  fs.appendChild(box); parent.appendChild(fs); choices.push([box, obj, key]);
}
function paint() { for (const [box, obj, key] of choices) for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.key === obj[key])); }
const gl = group('Look', true);
choice(gl, 'Species', LOOK, 'species', { human: 'Human', pureblood: 'Sith Pureblood' });
choice(gl, 'Skin', LOOK, 'skin', SKINS, true);
choice(gl, 'Eyes', LOOK, 'eyes', EYE_COLOURS, true);
slider(gl, LOOK, 'glow', 'Eye glow', 0, 1); slider(gl, LOOK, 'brows', 'Brows', 0, 1);
const gp = group('Pureblood features', true);
for (const [k, v] of Object.entries(PUREBLOOD.options)) if (v.items) choice(gp, v.label, PB, k, v.items); else slider(gp, PB, k, v.label, v.min, v.max);
const gb = group('Body', false); for (const [k, l, lo, hi] of SLIDERS.body) slider(gb, shape, k, l, lo, hi);
const gf = group('Face', false); for (const [k, l, lo, hi] of SLIDERS.face) slider(gf, shape, k, l, lo, hi);
const gh = group('Head shape', false); for (const [k, l, lo, hi] of SLIDERS.head) slider(gh, shape, k, l, lo, hi);
{ const gt = group('Test', false), row = document.createElement('label'); row.className = 'slide';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.addEventListener('change', () => { marks.visible = cb.checked; stage.changed(); });
  const t = document.createElement('span'); t.textContent = 'Show landmarks'; t.style.gridColumn = '2 / 4'; row.append(cb, t); gt.appendChild(row); }
function sync() { for (const [r, out, obj, k] of Object.values(inputs)) { r.value = obj[k]; out.textContent = Number(obj[k]).toFixed(2); } paint(); }
let pending = 0;
function schedule() { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; apply(); }); }
function showStats() {
  const ft = fig.height / 0.3048, f = Math.floor(ft), inch = Math.round((ft - f) * 12), g = fig.geometry;
  $('stats').textContent = `${g.attributes.position.count.toLocaleString()} vertices, ${(g.index.count / 3).toLocaleString()} triangles (one level of subdivision). Loaded in ${loadMs} ms; a reshape takes ${fig.ms} ms. Height ${fig.height.toFixed(2)} m (${f}'${inch}").`;
}
function preset(name) {
  const P = PRESETS[name] || PRESETS.neutral;
  Object.assign(shape, DEFAULTS, P.shape); Object.assign(LOOK, LOOK0, P.look); Object.assign(PB, PBDEF);
  sync(); apply();
}
for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', () => preset(b.dataset.preset));
$('random').addEventListener('click', () => {
  const r = (a) => (Math.random() * 2 - 1) * a;
  for (const [k, , lo, hi] of [...SLIDERS.body, ...SLIDERS.face, ...SLIDERS.head]) shape[k] = Math.min(hi, Math.max(lo, (lo + hi) / 2 + r(((hi - lo) / 2) * 0.6)));
  shape.age = Math.random() * 0.6; for (const k of ['square', 'oval', 'round', 'heavyset']) shape[k] = Math.random() < 0.4 ? Math.random() * 0.7 : 0;
  const sk = Object.keys(SKINS), ey = Object.keys(EYE_COLOURS); LOOK.skin = sk[Math.floor(Math.random() * sk.length)]; LOOK.eyes = ey[Math.floor(Math.random() * ey.length)];
  sync(); apply();
});

/* ---------------- landmarks, for checking ---------------- */
const marks = new THREE.Group(); marks.visible = false; fig.add(marks);
const dotGeo = new THREE.SphereGeometry(0.004, 12, 8), dotMat = new THREE.MeshBasicMaterial({ color: 0x35f58a, toneMapped: false });
const dots = fig.landmarks.map((k) => { const m = new THREE.Mesh(dotGeo, dotMat); marks.add(m); return [k, m]; });
const placeDots = () => { for (const [k, m] of dots) { const l = fig.landmark(k); if (l) m.position.set(...l.p); } };
fig.addEventListener('shaped', placeDots); placeDots();

/* ---------------- views ---------------- */
function head() { const a = fig.eyes.l.position, b = fig.eyes.r.position; return new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5); }
const lens = (deg) => { stage.camera.fov = deg; stage.camera.updateProjectionMatrix(); };
// the portrait views: chest up through a long lens (about 90 mm on a full-frame camera), front, three-quarter, profile
const VIEWS = {
  pfront: () => { lens(20); const e = head(); return [[0, e.y - 0.1, e.z - 0.03], [0, e.y - 0.04, e.z + 1.75]]; },
  pthree: () => { lens(20); const e = head(); return [[0, e.y - 0.1, e.z - 0.03], [1.18, e.y + 0.01, e.z + 1.3]]; },
  pside: () => { lens(20); const e = head(); return [[0, e.y - 0.1, e.z - 0.03], [1.75, e.y - 0.04, e.z - 0.03]]; },
  full: () => { lens(30); const h = fig.height; return [[0, h * 0.53, 0], [h * 0.75, h * 0.68, h * 2.05]]; },
  face: () => { lens(30); const e = head(); return [[0, e.y - 0.035, e.z - 0.06], [0, e.y + 0.01, e.z + 0.74]]; },
  three: () => { lens(30); const e = head(); return [[0, e.y - 0.035, e.z - 0.06], [0.5, e.y + 0.04, e.z + 0.52]]; },
  profile: () => { lens(30); const e = head(); return [[0, e.y - 0.035, e.z - 0.06], [0.76, e.y + 0.01, e.z - 0.06]]; },
  bust: () => { lens(30); const e = head(); return [[0, e.y - 0.14, e.z - 0.06], [0.25, e.y - 0.05, e.z + 1.15]]; },
};
const view = (name) => { const [t, p] = VIEWS[name](); stage.view(t, p); };
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view(b.dataset.view));

/* ---------------- run ---------------- */
preset(location.hash.includes('pureblood') ? 'pureblood' : 'neutral'); view('full');
stage.controls.addEventListener('start', () => $('hint').classList.add('gone'));
$('status').classList.add('gone');
stage.start();
window.__hb = { THREE, stage, base, fig, pb, shape, LOOK, PB, apply, preset, view, VIEWS, marks, get height() { return fig.height; }, loadMs };
