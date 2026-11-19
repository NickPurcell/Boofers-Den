// Human base test: the workbench for the human base library (../human-base/). Sliders for every morph, the skin and
// the eyes, and the species features, with presets. Linked from nowhere; the creator page proper is built on top of
// the same library.
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';
import { loadBase, SLIDERS, DEFAULTS } from '../human-base/base.js';
import { SPECIES, LINERS, MARKS, GLOWS, lookParams } from '../human-base/species/looks.js';
import { pureblood, PUREBLOOD } from '../human-base/species/pureblood.js';
import { CONTROLS, CONTROL_DEFAULTS, PRESETS as PEOPLE, toShape, randomControls } from '../human-base/controls.js';

const $ = (id) => document.getElementById(id);
const stage = makeStage($('scene'), { tall: 1.8, minDistance: 0.22, maxDistance: 6, environment: 0.55 });
stage.key.shadow.normalBias = 0.012; stage.key.shadow.bias = -0.0006;   // a bigger figure than the kit's default; keeps the chest clear of acne
const t0 = performance.now();
const base = await loadBase();
const fig = base.figure();
stage.scene.add(fig);
const loadMs = Math.round(performance.now() - t0);

/* ---------------- looks: by species (../human-base/species/looks.js) ---------------- */
const LOOK = { species: 'human' }, PBDEF = Object.fromEntries(Object.entries(PUREBLOOD.options).map(([k, v]) => [k, v.def])), PB = { ...PBDEF };
function speciesLook(sp) { const S = SPECIES[sp]; for (const k of Object.keys(LOOK)) delete LOOK[k]; Object.assign(LOOK, { species: sp, glow: 'none', liner: 'none', marks: 'none', tattoo: '', shape: 'diamond', ink: 'black' }, S.defaults); }
speciesLook('human');
// presets: a person (controls.js) in a species' look
const PRESETS = { neutral: { person: null, species: 'human' }, pureblood: { person: 'powerful', species: 'pureblood' } };
const ctrl = { ...CONTROL_DEFAULTS };
const shape = toShape(ctrl);
const pb = pureblood(fig, base); fig.features = pb;

function apply() {
  const P = lookParams(LOOK.species, { ...LOOK, gender: shape.gender });
  fig.set(shape);
  fig.skin.userData.set({ ...P.skin, suitCover: { torso: shape.gender < 0.75, arms: 0, legs: 0 } });
  fig.eyes.set(P.eyes);
  pb.set({ ...PB, on: LOOK.species === 'pureblood' });
  fig.update();
  showStats();
  stage.changed();
}

/* ---------------- the panel ---------------- */
const panel = $('options'), inputs = {};
let nIn = 0;
function group(title, open) { const d = document.createElement('details'); d.className = 'group'; d.open = open; const s = document.createElement('summary'); s.textContent = title; d.appendChild(s); panel.appendChild(d); return d; }
function slider(parent, obj, k, label, lo, hi) {
  const row = document.createElement('label'); row.className = 'slide';
  const name = document.createElement('span'); name.textContent = label;
  const r = document.createElement('input'); r.type = 'range'; r.min = lo; r.max = hi; r.step = 0.01; r.value = obj[k];
  const out = document.createElement('output'); out.textContent = Number(obj[k]).toFixed(2);
  r.addEventListener('input', () => { obj[k] = Number(r.value); out.textContent = Number(r.value).toFixed(2); if (obj === ctrl) { Object.assign(shape, toShape(ctrl)); sync(); } schedule(); });
  row.append(name, r, out); parent.appendChild(row); inputs[`${k}@${nIn++}`] = [r, out, obj, k];
}
const choices = [];
function choice(parent, label, obj, key, items, swatch, multi = false) {
  const fs = document.createElement('fieldset'); fs.className = 'opt'; const lg = document.createElement('legend'); lg.textContent = label; fs.appendChild(lg);
  const box = document.createElement('div'); box.className = swatch ? 'swatches' : 'seg wrap';
  for (const [k, v] of Object.entries(items)) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.key = k;
    if (swatch) { b.className = 'sw'; b.style.setProperty('--c', v); b.title = k; b.setAttribute('aria-label', k); } else b.textContent = v;
    b.addEventListener('click', () => { if (obj === LOOK && key === 'species') { speciesLook(k); lookPanel(); schedule(); return; } if (multi) { const on = new Set(String(obj[key] || '').split('.').filter(Boolean)); if (on.has(k)) on.delete(k); else on.add(k); obj[key] = [...on].join('.'); } else obj[key] = k; paint(); schedule(); }); box.appendChild(b);
  }
  fs.appendChild(box); parent.appendChild(fs); choices.push([box, obj, key]);
}
function paint() { for (const [box, obj, key] of choices) for (const b of box.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.key === obj[key] || String(obj[key] || '').split('.').includes(b.dataset.key))); }
// the look: species, then its palettes and marks; groups that belong to one species show only for it
const gl = group('Look', true), lookBox = document.createElement('div'); gl.appendChild(lookBox);
const gp = group('Pureblood features', true), gm = group('Mirialan tattoos', true), gk = group('Mikkian', true);
for (const [k, v] of Object.entries(SPECIES.mikkian.options)) choice(gk, v.label, LOOK, k, Object.fromEntries(Object.entries(v.items).map(([q, o]) => [q, o.c])), true);
for (const [k, v] of Object.entries(PUREBLOOD.options)) if (v.items) choice(gp, v.label, PB, k, v.items, false, !!v.multi); else slider(gp, PB, k, v.label, v.min, v.max);
for (const [k, v] of Object.entries(SPECIES.mirialan.options)) choice(gm, v.label, LOOK, k, v.swatch ? Object.fromEntries(Object.entries(v.items).map(([q, o]) => [q, o.c])) : v.items, !!v.swatch, !!v.multi);
function lookPanel() {
  lookBox.textContent = ''; for (let i = choices.length - 1; i >= 0; i--) if (lookBox.contains(choices[i][0]) || !choices[i][0].isConnected) choices.splice(i, 1);
  const S = SPECIES[LOOK.species], names = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.name])), cols = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.c]));
  choice(lookBox, 'Species', LOOK, 'species', names(SPECIES)); choice(lookBox, 'Skin', LOOK, 'skin', cols(S.skins), true); choice(lookBox, 'Eyes', LOOK, 'eyes', cols(S.eyes), true);
  choice(lookBox, 'Eye glow', LOOK, 'glow', names(GLOWS)); choice(lookBox, 'Liner', LOOK, 'liner', names(LINERS)); choice(lookBox, 'Marks', LOOK, 'marks', names(MARKS));
  gp.style.display = LOOK.species === 'pureblood' ? '' : 'none'; gm.style.display = LOOK.species === 'mirialan' ? '' : 'none'; gk.style.display = LOOK.species === 'mikkian' ? '' : 'none';
  paint();
}
// the controls a person uses: plain names, safe ranges (controls.js); the raw morphs are below, for checking
const gpp = group('People', true);
{ const box = document.createElement('div'); box.className = 'seg wrap'; for (const [k, p] of Object.entries(PEOPLE)) { const b = document.createElement('button'); b.type = 'button'; b.textContent = p.name; b.addEventListener('click', () => person(k)); box.appendChild(b); } gpp.appendChild(box); }
const gcb = group('Build', true); for (const c of CONTROLS.build) slider(gcb, ctrl, c.key, c.label, c.min, c.max);
const gcf = group('Face', true); for (const c of CONTROLS.head) slider(gcf, ctrl, c.key, c.label, c.min, c.max);
const graw = group('All morphs (raw)', false);
for (const [k, l, lo, hi] of [...SLIDERS.body, ...SLIDERS.face, ...SLIDERS.head]) slider(graw, shape, k, l, lo, hi);
{ const gt = group('Test', false), row = document.createElement('label'); row.className = 'slide';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.addEventListener('change', () => { marks.visible = cb.checked; stage.changed(); });
  const t = document.createElement('span'); t.textContent = 'Show landmarks'; t.style.gridColumn = '2 / 4'; row.append(cb, t); gt.appendChild(row); }
function sync() { for (const [r, out, obj, k] of Object.values(inputs)) { r.value = obj[k]; out.textContent = Number(obj[k]).toFixed(2); } paint(); }
let pending = 0;
function schedule() { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; apply(); }); }
function showStats() {
  const tin = Math.round(fig.height / 0.0254), f = Math.floor(tin / 12), inch = tin % 12, g = fig.geometry;
  $('stats').textContent = `${g.attributes.position.count.toLocaleString()} vertices, ${(g.index.count / 3).toLocaleString()} triangles (one level of subdivision). Loaded in ${loadMs} ms; a reshape takes ${fig.ms} ms. Height ${fig.height.toFixed(2)} m (${f}'${inch}").`;
}
function person(name) { Object.assign(ctrl, CONTROL_DEFAULTS, (PEOPLE[name] || {}).controls || {}); Object.assign(shape, toShape(ctrl)); sync(); apply(); }
function preset(name) {
  const P = PRESETS[name] || PRESETS.neutral;
  Object.assign(ctrl, CONTROL_DEFAULTS, P.person ? PEOPLE[P.person].controls : {}); Object.assign(shape, toShape(ctrl)); speciesLook(P.species); Object.assign(PB, PBDEF);
  lookPanel(); sync(); apply();
}
for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', () => preset(b.dataset.preset));
$('random').addEventListener('click', () => {
  Object.assign(ctrl, randomControls()); Object.assign(shape, toShape(ctrl));
  const S = SPECIES[LOOK.species], pickKey = (o) => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
  LOOK.skin = pickKey(S.skins); LOOK.eyes = pickKey(S.eyes);
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
window.__hb = { THREE, stage, base, fig, pb, shape, ctrl, LOOK, PB, apply, preset, person, toShape, speciesLook, lookPanel, randomControlsFn: randomControls, view, VIEWS, marks, get height() { return fig.height; }, loadMs };
