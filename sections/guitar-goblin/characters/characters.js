// Character creator on the human base (in progress): the figure from ../human-base/ (engineer13's library: the body,
// its controls, skin, eyes, species looks and the Pureblood's features), with this page's hair (hair.js) and clothes
// (outfit-shape.js, meshed in workers by jobs.js), the panel, Randomise, the link, and pictures.
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';
import { loadBase } from '../human-base/base.js';
import { CONTROLS, CONTROL_DEFAULTS, PRESETS, toShape, randomControls } from '../human-base/controls.js';
import { SPECIES as LOOKS, LINERS, MARKS, GLOWS, painters } from '../human-base/species/looks.js';
import { pureblood, PUREBLOOD } from '../human-base/species/pureblood.js';
import { makeHair } from './hair.js';
import { STYLES } from './hair-shape.js';
import { createPool } from '../creator-kit/pool.js';
import { makeTextures, clothMaterial, leatherMaterial, metalMaterial, plasticMaterial } from '../duros-creator/materials.js';
import { OUTFITS, HOODS } from './outfit-shape.js';
import { fieldFor } from './bodyfield.js';

const $ = (id) => document.getElementById(id);
const stage = makeStage($('scene'), { tall: 1.8, minDistance: 0.22, maxDistance: 6, onNoGL: () => { $('nogl').hidden = false; } });
stage.key && stage.key.shadow && Object.assign(stage.key.shadow, { normalBias: 0.012, bias: -0.0006 });   // (the base's own advice for this figure)
const base = await loadBase();
const fig = base.figure(); stage.scene.add(fig);
const pb = pureblood(fig, base);
const hair = makeHair(base, fig);

/* ---------------- what each species offers on this page ---------------- */
const sw = (...l) => l.map(([key, name, c]) => ({ key, name, c }));
const BLACK = ['black', 'Black', '#16110e'], DKBROWN = ['dkbrown', 'Dark brown', '#2a1d14'];
const CLOTH = sw(['bone', 'Bone white', '#e4e0d6'], ['ash', 'Ash grey', '#9aa0a8'], ['steel', 'Steel blue', '#5b6f86'], ['slate', 'Slate', '#3f4a58'], ['charcoal', 'Charcoal', '#34373e'], ['black', 'Black', '#18191c'],
  ['umber', 'Umber', '#4d3a2c'], ['sand', 'Sand', '#b9a47c'], ['ochre', 'Ochre', '#b0812c'], ['rust', 'Rust', '#8a4324'], ['wine', 'Wine', '#6a2229'], ['crimson', 'Crimson', '#8f1f22'],
  ['forest', 'Forest', '#2f4a34'], ['teal', 'Teal', '#22585a'], ['navy', 'Navy', '#1e2f52'], ['violet', 'Violet', '#473462']);
// the opening person (a preset of the base's controls), hair colours, the outfits that suit (their own first), and the look it opens in
const PAGE = {
  pureblood: { people: 'powerful', hairs: sw(BLACK, DKBROWN, ['redbrown', 'Red-brown', '#4a1a14'], ['grey', 'Iron grey', '#8a8684'], ['white', 'White', '#d8d4d0']),
    outfits: ['plate', 'cloak', 'robe'], defaults: { style: 'slick', hair: 'black', outfit: 'plate', hood: 'none', main: 'charcoal', second: 'wine' } },
  human: { people: 'man', hairs: sw(BLACK, DKBROWN, ['brown', 'Brown', '#4a3020'], ['auburn', 'Auburn', '#6a2e1a'], ['blond', 'Blond', '#b89858'], ['grey', 'Grey', '#8c8c8c'], ['white', 'White', '#dcdcdc']),
    outfits: ['robe', 'cloak', 'plate'], defaults: { style: 'slick', hair: 'dkbrown', outfit: 'robe', hood: 'none', main: 'umber', second: 'sand' } },
  echani: { people: 'athlete', hairs: sw(['white', 'White', '#e4e4e8'], ['silver', 'Silver', '#bfc4cb'], ['ash', 'Ash', '#a6a6a2'], ['gold', 'Pale gold', '#d6cdaa'], ['steel', 'Steel', '#8b939c']),
    outfits: ['robe', 'plate', 'cloak'], defaults: { style: 'slick', hair: 'white', outfit: 'robe', hood: 'none', main: 'bone', second: 'ash' } },
  mirialan: { people: 'woman', hairs: sw(BLACK, ['blueblack', 'Blue-black', '#131928'], DKBROWN, ['redbrown', 'Red-brown', '#5a2a1a'], ['grey', 'Grey', '#8c8c8c']),
    outfits: ['robe', 'cloak', 'plate'], defaults: { style: 'slick', hair: 'black', outfit: 'robe', hood: 'down', main: 'navy', second: 'sand' } },
};
const ORDER = ['pureblood', 'human', 'echani', 'mirialan'];
const asItems = (o) => Object.entries(o).map(([key, v]) => ({ key, name: typeof v === 'string' ? v : v.name, c: v.c }));

/* ---------------- the state: choices, and the body and face as the base's control values ---------------- */
const state = {}, ctrl = { ...CONTROL_DEFAULTS };
function options() {
  const sp = state.species, L = LOOKS[sp], P = PAGE[sp], o = {
    species: { label: 'Species', items: ORDER.map((k) => ({ key: k, name: LOOKS[k].name })) },
    people: { label: 'Start from', items: asItems(PRESETS) },
    skin: { label: 'Skin', swatch: true, items: asItems(L.skins) }, eyes: { label: 'Eyes', swatch: true, items: asItems(L.eyes) },
  };
  if (sp === 'pureblood') o.glow = { label: 'Eye glow', items: asItems(GLOWS) };
  o.liner = { label: 'Lined eyes', items: asItems(LINERS) };
  if (sp !== 'pureblood') o.marks = { label: 'Face detail', items: asItems(MARKS) };
  for (const [k, d] of Object.entries(L.options || {})) o[k] = { label: d.label, multi: d.multi, swatch: d.swatch, items: asItems(d.items) };
  o.style = { label: 'Hair', items: ['slick', 'swept', 'crop', 'tail', 'knot', 'braid', 'bald'].map((k) => ({ key: k, name: STYLES[k].name })) };
  o.hair = { label: 'Hair colour', swatch: true, items: P.hairs };
  if (sp === 'pureblood') for (const [k, d] of Object.entries(PUREBLOOD.options)) if (d.items) o[k] = { label: d.label, multi: d.multi, items: asItems(d.items) };
  o.outfit = { label: 'Outfit', items: P.outfits.map((k) => ({ key: k, name: OUTFITS[k].name })) };
  o.hood = { label: 'Hood', items: asItems(HOODS) };
  o.main = { label: 'Main colour', swatch: true, items: CLOTH }; o.second = { label: 'Second colour', swatch: true, items: CLOTH };
  return o;
}
const defaultsOf = (sp) => {
  const d = { ...LOOKS[sp].defaults, ...PAGE[sp].defaults, people: PAGE[sp].people };
  if (sp === 'pureblood') for (const [k, o] of Object.entries(PUREBLOOD.options)) d[k] = o.def;
  return d;
};
const setOf = (v, def) => { const ok = def.items.map((o) => o.key); return new Set(String(v || '').split('.').filter((k) => ok.includes(k))); };
// make the state whole for its species: anything missing or not on offer takes the species' own default
function settle(from = {}) {
  state.species = LOOKS[from.species ?? state.species] && PAGE[from.species ?? state.species] ? (from.species ?? state.species) : 'pureblood';
  const defs = defaultsOf(state.species), opts = options();
  for (const k of Object.keys(state)) if (k !== 'species' && !opts[k] && !(k in defs)) delete state[k];
  for (const [k, def] of Object.entries(opts)) {
    if (k === 'species') continue;
    const v = from[k] ?? state[k];
    if (def.multi) state[k] = [...setOf(v ?? defs[k], def)].join('.');
    else state[k] = def.items.some((o) => o.key === v) ? v : def.items.some((o) => o.key === defs[k]) ? defs[k] : def.items[0].key;
  }
  if (sp() === 'pureblood' && from.ridges !== undefined) state.ridges = Math.max(0, Math.min(1, +from.ridges || 0)); else if (sp() === 'pureblood' && state.ridges === undefined) state.ridges = PUREBLOOD.options.ridges.def;
}
const sp = () => state.species;
const ALLC = [...CONTROLS.build, ...CONTROLS.head];
function people(key) { Object.assign(ctrl, CONTROL_DEFAULTS, (PRESETS[key] || PRESETS.man).controls); }
// the link: the choices, and the controls that differ from the person they started from
{
  const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  settle(q); people(state.people);
  for (const c of ALLC) if (q['c.' + c.key] !== undefined) ctrl[c.key] = Math.min(c.max, Math.max(c.min, +q['c.' + c.key] || 0));
}
function writeHash() {
  const q = new URLSearchParams(), base0 = { ...CONTROL_DEFAULTS, ...(PRESETS[state.people] || PRESETS.man).controls };
  for (const [k, v] of Object.entries(state)) q.set(k, v);
  for (const c of ALLC) if (Math.abs(ctrl[c.key] - base0[c.key]) > 0.004) q.set('c.' + c.key, ctrl[c.key].toFixed(2));
  history.replaceState(null, '', '#' + q.toString());
}
const pick = (opt) => { const it = options()[opt]?.items || []; return it.find((o) => o.key === state[opt]) || it[0]; };
const colours = () => ({ main: pick('main').c, second: pick('second').c, dark: '#25272d', leather: '#46321f', metal: '#a4a9b0', trim: '#c9a24a' });

/* ---------------- the figure from the state ---------------- */
function apply() {
  const L = LOOKS[sp()], look = L.look, glow = (GLOWS[state.glow] || GLOWS.none).v, shape = toShape(ctrl);
  fig.set(shape);
  const suit = OUTFITS[state.outfit]?.suit;
  fig.skin.userData.set({ tone: pick('skin').c, browAmount: look.brows ?? 0.85, browThick: 0.62 + 0.38 * shape.gender, brow: look.brow || '#231a16', lips: look.lips || null,
    sockets: glow > 0.1 ? look.sockets ?? 0.4 : Math.min(look.sockets ?? 0.4, 0.32),
    suit: '#1f2126', suitOn: !!suit, suitCover: suit || { torso: shape.gender < 0.75, arms: 0, legs: 0 },
    marks: painters({ liner: state.liner, marks: state.marks, tattoo: sp() === 'mirialan' ? state.tattoo : '', shape: state.shape, ink: L.options?.ink?.items[state.ink]?.c }) });
  fig.eyes.set({ colour: pick('eyes').c, glow, white: look.white || '#e6dfd6', iris: look.iris || 1 });
  const pbo = { on: sp() === 'pureblood' }; if (pbo.on) for (const k of Object.keys(PUREBLOOD.options)) pbo[k] = state[k];
  pb.set(pbo);
  fig.update();
  hair.set(state.hood === 'up' ? 'bald' : state.style, pick('hair').c);   // a raised hood covers the hair
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
const info = {};
// What is worn round the neck and chest, for the Pureblood's tendrils to drape over (human-base/species/pureblood.js
// `worn`): the signed distance to the clothes' own surfaces within 32 cm of the chin, positive outside them
function wear(key) {
  const chin = fig.landmark('chin').p, P = [], N = [], I = [];
  for (const m of clothes.children) {
    const g = m.geometry, p = g.attributes.position.array, n = g.attributes.normal.array, ix = g.index.array, v0 = P.length / 3, keep = new Map();
    for (let t = 0; t < ix.length; t += 3) {
      if (![0, 1, 2].some((k) => { const i = ix[t + k] * 3; return Math.hypot(p[i] - chin[0], p[i + 1] - chin[1], p[i + 2] - chin[2]) < 0.32; })) continue;
      for (let k = 0; k < 3; k++) { const i = ix[t + k]; if (!keep.has(i)) { keep.set(i, v0 + keep.size); P.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); N.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]); } I.push(keep.get(i)); }
    }
  }
  const worn = I.length ? fieldFor(Float32Array.from(P), Float32Array.from(N), Uint32Array.from(I)) : null;
  pb.set({ worn, wornKey: worn ? `${state.outfit}|${state.hood}|${key}` : '' });
  fig.update();
}
fig.addEventListener('redraw', () => stage.changed());   // a re-drape lands a moment after the sliders rest
let dressTicket = 0;
function clothGeometry(m) {   // mesher arrays -> geometry, with its occlusion as vertex colour
  const g = new THREE.BufferGeometry(), n = m.ao.length, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = 0.32 + 0.68 * Math.pow(m.ao[i], 1.4); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3)); g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(m.index, 1)); g.computeBoundingSphere(); return g;
}
async function dress() {
  const my = ++dressTicket, key = state.outfit;
  pool.cancelQueued();   // whatever was waiting for an older choice is no longer wanted
  const clear = () => { for (const c of [...clothes.children]) { clothes.remove(c); c.geometry.dispose(); c.material.dispose(); } };
  if (!OUTFITS[key] || key === 'none') { clear(); wear(my); return; }
  const J = Object.fromEntries(Object.keys(base.info.joints).map((k) => [k, fig.joint(k)]));
  const L = Object.fromEntries(['neckSideL', 'neckSideR', 'chestMid', 'backMid'].map((k) => { const l = fig.landmark(k); return [k, { p: l.p, n: l.n }]; }));
  const args = { key, hood: state.hood, surface: { position: fig.p0.slice(), normal: fig.n0.slice(), index: tris }, J, L }, n = pool.size(), t0 = performance.now();
  $('status').hidden = false; $('status').textContent = 'Dressing…';
  let rs;
  try { rs = await Promise.all(Array.from({ length: n }, (_, part) => pool.mesh('outfit', { ...args, part, of: n }))); } catch (e) { if (my === dressTicket && !(e && e.cancelled)) { console.error(e); $('status').textContent = 'Something went wrong dressing the figure.'; } return; }
  if (my !== dressTicket) return;
  clear();   // the old clothes stay on until the new ones are ready
  const cols = colours();
  for (const p of rs.flatMap((r) => r.pieces)) { const m = new THREE.Mesh(clothGeometry(p.mesh), (MATS[p.material] || clothMaterial)(cols[p.role] || '#777777')); m.material.vertexColors = true; m.castShadow = m.receiveShadow = true; m.name = p.name; m.userData.role = p.role; clothes.add(m); }
  wear(my);
  $('status').hidden = true; info.dress = Math.round(performance.now() - t0); stage.changed();
}


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


/* ---------------- the panel ---------------- */
const panelEl = $('options');
const SHAPE_OPTS = new Set(['species', 'people', 'outfit', 'hood', 'folds', 'spurs', 'tendrils', 'tlength']);   // these change what is worn or its fit
function panel() {
  panelEl.textContent = '';
  const field = (k, def, parent = panelEl) => {
    const fs = document.createElement('fieldset'); fs.className = 'opt';
    const lg = document.createElement('legend'); lg.textContent = def.label; fs.appendChild(lg);
    const box = document.createElement('div'); box.className = def.swatch ? 'swatches' : 'seg wrap'; box.dataset.opt = k;
    for (const o of def.items) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.key = o.key;
      if (def.swatch) { b.className = 'sw'; b.style.setProperty('--c', o.c); b.setAttribute('aria-label', o.name); b.title = o.name; } else b.textContent = o.name;
      b.addEventListener('click', () => choose(k, o.key)); box.appendChild(b);
    }
    fs.appendChild(box); parent.appendChild(fs);
  };
  const group = (title, open) => { const d = document.createElement('details'); d.className = 'group'; d.open = open; const s = document.createElement('summary'); s.textContent = title; d.appendChild(s); panelEl.appendChild(d); return d; };
  const slider = (parent, c, obj, onChange) => {
    const row = document.createElement('label'); row.className = 'slide'; const name = document.createElement('span'); name.textContent = c.label; if (c.hint) name.title = c.hint;
    const r = document.createElement('input'); r.type = 'range'; r.min = c.min; r.max = c.max; r.step = 0.01; r.value = obj[c.key]; r.dataset.ctrl = c.key;
    r.addEventListener('input', () => { obj[c.key] = Number(r.value); live(); });
    r.addEventListener('change', () => { onChange(); writeHash(); });
    row.append(name, r); parent.appendChild(row);
  };
  const opts = options();
  for (const k of ['species', 'people']) field(k, opts[k]);
  const gb = group('Build', false); for (const c of CONTROLS.build) slider(gb, c, ctrl, redress);
  const gf = group('Face', false); for (const c of CONTROLS.head) slider(gf, c, ctrl, redress);
  for (const [k, def] of Object.entries(opts)) {
    if (k === 'species' || k === 'people') continue;
    field(k, def);
    if (k === 'folds') { const o = PUREBLOOD.options.ridges, box = document.createElement('div'); panelEl.appendChild(box); slider(box, { key: 'ridges', label: o.label, min: o.min, max: o.max }, state, () => {}); }   // the folds' height, under the folds
  }
  paintPanel();
}
function paintPanel() {
  const opts = options();
  for (const el of panelEl.querySelectorAll('[data-opt]')) {
    const def = opts[el.dataset.opt]; if (!def) continue;
    const on = def.multi ? setOf(state[el.dataset.opt], def) : null;
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(def.multi ? on.has(b.dataset.key) : b.dataset.key === state[el.dataset.opt]));
  }
  for (const r of panelEl.querySelectorAll('input[data-ctrl]')) r.value = r.dataset.ctrl === 'ridges' ? state.ridges : ctrl[r.dataset.ctrl];
  $('title').textContent = LOOKS[sp()].name;
  $('summary').textContent = `${LOOKS[sp()].name}: ${pick('skin').name.toLowerCase()} skin, ${pick('eyes').name.toLowerCase()} eyes, ${state.hood === 'up' ? 'hood up' : `${pick('hair').name.toLowerCase()} hair ${STYLES[state.style].name.toLowerCase()}`}; in ${OUTFITS[state.outfit].name.toLowerCase()}, ${pick('main').name.toLowerCase()} and ${pick('second').name.toLowerCase()}.`;
}
let raf = 0, dressTimer = 0;
const live = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; apply(); }); };   // reshape at once while a slider moves
const redress = () => { clearTimeout(dressTimer); dressTimer = setTimeout(() => { current = dress(); }, 250); };   // and fit the clothes when it stops
function choose(k, v) {
  const def = options()[k]; if (!def) return;
  if (def.multi) { const on = setOf(state[k], def); if (on.has(v)) on.delete(v); else on.add(v); state[k] = [...on].join('.'); } else { if (state[k] === v) return; state[k] = v; }
  if (k === 'species') { for (const q of Object.keys(state)) if (q !== 'species') delete state[q]; settle(); people(state.people); panel(); }
  if (k === 'people') people(v);
  apply(); paintPanel(); writeHash();
  if (SHAPE_OPTS.has(k)) redress(); else recolourClothes();
}
function recolourClothes() { const cols = colours(); for (const m of clothes.children) m.material.color.set(cols[m.userData.role] || '#777777'); stage.redraw(); }
$('random').addEventListener('click', () => {
  const rnd = Math.random, opts = options(), any = (k) => { const it = opts[k].items; return it[Math.floor(rnd() * it.length)].key; };
  Object.assign(ctrl, randomControls(rnd));
  for (const k of ['skin', 'eyes', 'hair', 'outfit', 'main']) state[k] = any(k);
  do state.second = any('second'); while (state.second === state.main);
  state.hood = rnd() < 0.6 ? 'none' : any('hood'); state.style = any('style');
  if (sp() === 'pureblood') {   // steered: tendrils nearly always, a few pieces of jewellery in one metal, eyes that burn now and then
    for (const k of ['folds', 'spurs', 'tlength', 'metal']) state[k] = any(k);
    state.tendrils = rnd() < 0.05 ? 'none' : ['chin', 'fringe', 'beard', 'beard', 'cheek'][Math.floor(rnd() * 5)];
    state.jewel = rnd() < 0.15 ? '' : [...new Set([['rings', 'cuffs'][Math.floor(rnd() * 2)], ...(rnd() < 0.45 ? [['circlet', 'studs', 'brow', 'chains'][Math.floor(rnd() * 4)]] : [])])].join('.');
    state.glow = ['none', 'faint', 'faint', 'burning'][Math.floor(rnd() * 4)];
    state.main = ['charcoal', 'black', 'black', 'slate', 'wine', 'umber'][Math.floor(rnd() * 6)]; do state.second = ['black', 'wine', 'wine', 'crimson', 'charcoal', 'umber'][Math.floor(rnd() * 6)]; while (state.second === state.main);
  } else { state.liner = any('liner'); if (opts.marks) state.marks = rnd() < 0.7 ? 'none' : any('marks'); }
  apply(); paintPanel(); writeHash(); redress();
});

/* ---------------- pictures ---------------- */
const bgChoice = () => (document.querySelector('input[name=bg]:checked') || { value: 'studio' }).value;
$('save').addEventListener('click', () => stage.download(stage.snapshot(1024, bgChoice(), stage.squareCamera()), `${sp()}-${state.outfit}.png`));
const tokenCam = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
$('token').addEventListener('click', () => {
  const h = headAt(); tokenCam.position.set(h.x + 0.14, h.y, h.z + 1.0); tokenCam.lookAt(h.x, h.y - 0.06, h.z - 0.03); tokenCam.updateProjectionMatrix();
  stage.download(stage.snapshot(512, bgChoice() === 'studio' ? 'plain' : bgChoice(), tokenCam, false), `${sp()}-token.png`);
});

panel(); apply(); view('bust'); $('status').hidden = true;
let current = dress();
stage.start();
window.__fig = { fig, base, hair, state, ctrl, stage, camera: stage.camera, controls: stage.controls, redraw: stage.redraw, get ready() { return current; }, views: VIEWS, info, choose };
