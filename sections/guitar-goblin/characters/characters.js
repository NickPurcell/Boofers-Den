// Character creator on the human base (in progress): the figure from ../human-base/ (engineer13's library: the body,
// its controls, skin, eyes, species looks and the Pureblood's features), with this page's hair (hair.js) and clothes
// (outfit-shape.js, meshed in workers by jobs.js), the panel, Randomise, the link, and pictures.
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';
import { loadBase } from '../human-base/base.js';
import { CONTROLS, CONTROL_DEFAULTS, PRESETS, toShape, randomControls } from '../human-base/controls.js';
import { SPECIES as LOOKS, LINERS, MARKS, GLOWS, lookParams } from '../human-base/species/looks.js';
import { ARRANGE, THICK, LENGTHS, SURFACES, PATTERNS } from '../humanoid-creator/mikkian.js';
import { pureblood, PUREBLOOD } from '../human-base/species/pureblood.js';
import { carry, ITEMS } from '../human-base/carry.js';
import { makeHair, fibreTexture } from './hair.js';
import { STYLES } from './hair-shape.js';
import { createPool } from '../creator-kit/pool.js';
import { makeTextures, clothMaterial, leatherMaterial, metalMaterial, plasticMaterial } from '../duros-creator/materials.js';
import { OUTFITS, HOODS } from './outfit-shape.js';
import { fieldFor } from './bodyfield.js';

const $ = (id) => document.getElementById(id);
const stage = makeStage($('scene'), { tall: 1.8, minDistance: 0.22, maxDistance: 6, onNoGL: () => { $('nogl').hidden = false; } });
stage.key && stage.key.shadow && Object.assign(stage.key.shadow, { normalBias: 0.012, bias: -0.0006 });   // (the base's own advice for this figure)
// the workers first: they load their modules while the base mesh downloads (started later, the first outfit waited ~7 s for them)
const pool = createPool(new URL('./jobs.js', import.meta.url));
const base = await loadBase();
const fig = base.figure(); stage.scene.add(fig);
const pb = pureblood(fig, base);
const hair = makeHair(base, fig);
const carried = carry(fig);   // what they carry: engineer13's human-base/carry.js

/* ---------------- what each species offers on this page ---------------- */
const sw = (...l) => l.map(([key, name, c]) => ({ key, name, c }));
const BLACK = ['black', 'Black', '#16110e'], DKBROWN = ['dkbrown', 'Dark brown', '#2a1d14'];
const CLOTH = sw(['bone', 'Bone white', '#e4e0d6'], ['ash', 'Ash grey', '#9aa0a8'], ['steel', 'Steel blue', '#5b6f86'], ['slate', 'Slate', '#3f4a58'], ['charcoal', 'Charcoal', '#34373e'], ['black', 'Black', '#18191c'],
  ['umber', 'Umber', '#4d3a2c'], ['sand', 'Sand', '#b9a47c'], ['ochre', 'Ochre', '#b0812c'], ['rust', 'Rust', '#8a4324'], ['wine', 'Wine', '#6a2229'], ['crimson', 'Crimson', '#8f1f22'],
  ['forest', 'Forest', '#2f4a34'], ['teal', 'Teal', '#22585a'], ['navy', 'Navy', '#1e2f52'], ['violet', 'Violet', '#473462']);
// the opening person (a preset of the base's controls), hair colours, the outfits that suit (their own first), and the look it opens in
const PAGE = {
  pureblood: { people: 'powerful', hairs: sw(BLACK, DKBROWN, ['redbrown', 'Red-brown', '#4a1a14'], ['grey', 'Iron grey', '#8a8684'], ['white', 'White', '#d8d4d0']),
    outfits: ['plate', 'cloak', 'robe', 'armour', 'coat'], defaults: { style: 'slick', hair: 'black', outfit: 'plate', hood: 'none', gear: 'hilt', main: 'charcoal', second: 'wine' } },
  human: { people: 'man', hairs: sw(BLACK, DKBROWN, ['brown', 'Brown', '#4a3020'], ['auburn', 'Auburn', '#6a2e1a'], ['blond', 'Blond', '#b89858'], ['grey', 'Grey', '#8c8c8c'], ['white', 'White', '#dcdcdc']),
    outfits: ['coat', 'jacket', 'wraps', 'armour', 'plate', 'robe', 'cloak'], defaults: { style: 'crop', hair: 'dkbrown', outfit: 'coat', hood: 'none', main: 'umber', second: 'sand' } },
  echani: { people: 'athlete', hairs: sw(['white', 'White', '#e4e4e8'], ['silver', 'Silver', '#bfc4cb'], ['ash', 'Ash', '#a6a6a2'], ['gold', 'Pale gold', '#d6cdaa'], ['steel', 'Steel', '#8b939c']),
    outfits: ['armour', 'wraps', 'coat', 'robe', 'cloak'], defaults: { style: 'swept', hair: 'white', outfit: 'armour', hood: 'none', gear: 'double', main: 'ash', second: 'slate' } },
  mirialan: { people: 'woman', hairs: sw(BLACK, ['blueblack', 'Blue-black', '#131928'], DKBROWN, ['redbrown', 'Red-brown', '#5a2a1a'], ['grey', 'Grey', '#8c8c8c']),
    outfits: ['jacket', 'robe', 'coat', 'wraps', 'cloak'], defaults: { style: 'tail', hair: 'black', outfit: 'jacket', hood: 'none', main: 'navy', second: 'sand' } },
  // opens on the look its first player asked for: medium blue with dark blue accents, heavy smooth dreads to the shoulders
  mikkian: { people: 'between', outfits: ['coat', 'robe', 'jacket', 'wraps', 'armour', 'cloak'], defaults: { style: 'dreads', thick: 'thick', length: 'shoulder', surface: 'smooth', pattern: 'deepen', outfit: 'coat', hood: 'none', main: 'charcoal', second: 'steel' } },
};
const ORDER = ['pureblood', 'human', 'echani', 'mirialan', 'mikkian'];
// the people to start from: the base's presets, and one between the two (the controls' own middle)
const PEOPLE = { ...PRESETS, between: { name: 'In between', controls: { gender: 0.5 } } };
const asItems = (o) => Object.entries(o).map(([key, v]) => ({ key, name: typeof v === 'string' ? v : v.name, c: v.c }));

/* ---------------- the state: choices, and the body and face as the base's control values ---------------- */
const state = {}, ctrl = { ...CONTROL_DEFAULTS };
function options() {
  const sp = state.species, L = LOOKS[sp], P = PAGE[sp], o = {
    species: { label: 'Species', items: ORDER.map((k) => ({ key: k, name: LOOKS[k].name })) },
    people: { label: 'Start from', items: asItems(PEOPLE) },
    skin: { label: 'Skin', swatch: true, items: asItems(L.skins) }, eyes: { label: 'Eyes', swatch: true, items: asItems(L.eyes) },
  };
  if (sp === 'pureblood') o.glow = { label: 'Eye glow', items: asItems(GLOWS) };
  o.liner = { label: 'Lined eyes', items: asItems(LINERS) };
  if (sp !== 'pureblood') o.marks = { label: 'Face detail', items: asItems(MARKS) };
  for (const [k, d] of Object.entries(L.options || {})) o[k] = { label: d.label, multi: d.multi, swatch: d.swatch, items: asItems(d.items) };
  if (sp === 'mikkian') {   // head-tendrils in place of hair
    o.style = { label: 'Head-tendrils', items: asItems(ARRANGE) }; o.thick = { label: 'Tendril thickness', items: asItems(THICK) };
    o.length = { label: 'Tendril length', items: asItems(LENGTHS) }; o.surface = { label: 'Tendril surface', items: asItems(SURFACES) }; o.pattern = { label: 'Tendril pattern', items: asItems({ deepen: { name: 'Deepening to the lips' }, fade: { name: 'Paler tips' }, ...PATTERNS }) };
  } else {
    o.style = { label: 'Hair', items: [...['slick', 'swept', 'crop', 'tail', 'knot', 'braid'].map((k) => ({ key: k, name: STYLES[k].name })), { key: 'bob', name: 'Bob' }, { key: 'long', name: 'Long' }, ...['crest', 'shaved', 'bald'].map((k) => ({ key: k, name: STYLES[k].name }))] };
    o.hair = { label: 'Hair colour', swatch: true, items: P.hairs };
  }
  if (sp === 'pureblood') for (const [k, d] of Object.entries(PUREBLOOD.options)) if (d.items) o[k] = { label: d.label, multi: d.multi, items: asItems(d.items) };
  o.outfit = { label: 'Outfit', items: P.outfits.map((k) => ({ key: k, name: OUTFITS[k].name })) };
  o.hood = { label: 'Hood', items: asItems(HOODS) };
  o.gear = { label: 'Carries', items: asItems(ITEMS) };
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
function people(key) { Object.assign(ctrl, CONTROL_DEFAULTS, (PEOPLE[key] || PRESETS.man).controls); }
// the link: the choices, and the controls that differ from the person they started from
{
  const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
  settle(q); people(state.people);
  for (const c of ALLC) if (q['c.' + c.key] !== undefined) ctrl[c.key] = Math.min(c.max, Math.max(c.min, +q['c.' + c.key] || 0));
}
function writeHash() {
  const q = new URLSearchParams(), base0 = { ...CONTROL_DEFAULTS, ...(PEOPLE[state.people] || PRESETS.man).controls };
  for (const [k, v] of Object.entries(state)) q.set(k, v);
  for (const c of ALLC) if (Math.abs(ctrl[c.key] - base0[c.key]) > 0.004) q.set('c.' + c.key, ctrl[c.key].toFixed(2));
  history.replaceState(null, '', '#' + q.toString());
}
const pick = (opt) => { const it = options()[opt]?.items || []; return it.find((o) => o.key === state[opt]) || it[0]; };
const colours = () => ({ main: pick('main').c, second: pick('second').c, dark: '#25272d', leather: '#46321f', metal: '#a4a9b0', trim: '#c9a24a' });

/* ---------------- the figure from the state ---------------- */
function apply() {
  const shape = toShape(ctrl), look = lookParams(sp(), { ...state, gender: shape.gender });   // the base's own way to set a look
  fig.set(shape);
  const suit = OUTFITS[state.outfit]?.suit;
  fig.skin.userData.set({ ...look.skin, suit: '#1f2126', suitOn: !!suit, suitCover: suit || { torso: shape.gender < 0.75, arms: 0, legs: 0 } });
  fig.eyes.set(look.eyes); accent = look.accent; lips = look.skin.lips || look.accent;
  const pbo = { on: sp() === 'pureblood' }; if (pbo.on) for (const k of Object.keys(PUREBLOOD.options)) pbo[k] = state[k];
  pb.set(pbo);
  fig.update();
  const down = DOWN.has(state.style) && state.hood !== 'up' && sp() !== 'mikkian';
  // a raised hood covers the hair; a Mikkian has none; hair worn down has a close cap bound like the rest, and its fall
  // worked out in a worker (fall())
  hair.set(state.hood === 'up' || sp() === 'mikkian' ? 'bald' : down ? 'crop' : state.style, pick('hair')?.c);
  if (fallen) { paintFall(); fallen.visible = down; }
  carried.set({ item: state.gear || 'none', accent: pick('second').c });
  paintTendrils();
  stage.changed();
}
let accent = null, lips = null;

/* ---------------- clothes: meshed in workers from the live body ---------------- */
makeTextures();
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
  carried.set({ worn, wornKey: worn ? `${state.outfit}|${state.hood}|${key}` : '' });   // (what is carried hangs on the clothes, not in them)
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
/* ---------------- hair worn down: locks worked out in a worker from the live figure (hairlocks.js) ---------------- */
const DOWN = new Set(['bob', 'long']);
const fallMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0, normalMap: fibreTexture(), normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.3, sheenRoughness: 0.4, side: THREE.DoubleSide });
let fallen = null, fallTicket = 0;
function paintFall() {   // the hair's colour, lighter on top of each lock and a little varied lock to lock
  if (!fallen) return;
  const c = new THREE.Color(pick('hair')?.c || '#16110e'), sh = fallen.userData.shade, col = fallen.geometry.attributes.color;
  for (let i = 0; i < sh.length; i++) col.setXYZ(i, c.r * sh[i], c.g * sh[i], c.b * sh[i]);
  col.needsUpdate = true; fallMat.sheenColor.copy(c).lerp(new THREE.Color(1, 1, 1), 0.2);
}
async function fall() {
  const my = ++fallTicket, clear = () => { if (fallen) { fig.remove(fallen); fallen.geometry.dispose(); fallen = null; } };
  if (!DOWN.has(state.style) || state.hood === 'up' || sp() === 'mikkian') { clear(); return; }
  let r; try { r = await pool.mesh('hairlocks', { mesh: { position: fig.p0.slice(), normal: fig.n0.slice(), index: tris }, frame: headFrame(), style: state.style }); } catch (e) { if (!(e && e.cancelled)) console.error(e); return; }
  if (my !== fallTicket) return;
  clear(); const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(r.normal, 3)); g.setAttribute('uv', new THREE.BufferAttribute(r.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(r.shade.length * 3), 3)); g.setIndex(new THREE.BufferAttribute(r.index, 1)); g.computeBoundingSphere();
  fallen = new THREE.Mesh(g, fallMat); fallen.userData.shade = r.shade; fallen.castShadow = fallen.receiveShadow = true; fallen.name = 'hair-down'; fig.add(fallen); paintFall(); stage.changed();
}

/* ---------------- a Mikkian's head-tendrils: worked out in a worker from the live figure, like the clothes ---------------- */
const tentMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.3, sheen: 0.3, sheenRoughness: 0.45 });   // smooth, like a tentacle
const lockMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, normalMap: fibreTexture(), normalScale: new THREE.Vector2(1.15, 1.15), sheen: 0.3, sheenRoughness: 0.75 });   // or locked: matte and fibrous
let mane = null, maneTicket = 0;
function headFrame() {   // the earlier head's frame on this figure: upright, level with the eyes, 67 mm behind them, scaled by the eyes' spacing
  const F = fig.headFrame(), x = new THREE.Vector3(...F.x), up = new THREE.Vector3(0, 1, 0).addScaledVector(x, -x.y).normalize(), fw = new THREE.Vector3().crossVectors(x, up), k = F.scale / 0.0644;
  return { origin: new THREE.Vector3(...F.origin).addScaledVector(fw, -0.0672 * k).toArray(), x: x.toArray(), up: up.toArray(), fw: fw.toArray(), k };
}
async function grow() {
  const my = ++maneTicket;
  const clear = () => { if (mane) { fig.remove(mane.mesh); mane.mesh.geometry.dispose(); mane = null; } };
  if (sp() !== 'mikkian' || state.hood === 'up') { clear(); return; }
  let r; try { r = await pool.mesh('mikkian', { mesh: { position: fig.p0.slice(), normal: fig.n0.slice(), index: tris }, frame: headFrame(), style: state.style, thick: state.thick, length: state.length, surface: state.surface }); } catch (e) { if (!(e && e.cancelled)) console.error(e); return; }
  if (my !== maneTicket) return;
  clear();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(r.normal, 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(r.t.length * 3), 3)); g.setIndex(new THREE.BufferAttribute(r.index, 1)); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, state.surface === 'locked' ? lockMat : tentMat); m.castShadow = m.receiveShadow = true; m.name = 'tendrils'; fig.add(m);
  mane = { mesh: m, t: r.t, d: r.d }; paintTendrils(); stage.changed();
}
// the tendrils' colours: the skin's own blue deepening along their length to near the lips' colour (a Mikkian's default,
// as its first player asked); or with the accent on the tips, in rings toward the tips, or at the roots; or paler tips; a smooth one catches light pale on its lit side and goes violet
// in its shade, as the skin does
function paintTendrils() {
  if (!mane) return;
  const col = mane.mesh.geometry.attributes.color, nrm = mane.mesh.geometry.attributes.normal, c = new THREE.Color(pick('skin').c), acc = new THREE.Color(accent || '#1b2f6e'), k = new THREE.Color();
  const lipC = new THREE.Color(lips || accent || '#1b2f6e'), cS = c.clone().convertLinearToSRGB(), lipS = lipC.clone().convertLinearToSRGB(), pale = c.clone().lerp(new THREE.Color('#8fd2ff'), 0.5), lit = c.clone().lerp(new THREE.Color('#7fe0ff'), 0.45), shade = c.clone().lerp(new THREE.Color('#3a2190'), 0.6), L = new THREE.Vector3(0.35, 0.85, 0.4).normalize();   // (staying blue: pale cyan, never white)
  const smooth = state.surface !== 'locked', ring = (dd) => (dd < 0.014 || dd > 0.27 ? 0 : Math.pow((Math.cos((dd / 0.042) * 2 * Math.PI) + 1) / 2, 7));
  for (let i = 0; i < mane.t.length; i++) {
    const u = mane.t[i];
    // deepening: the skin's own blue where it leaves the head, darkening smoothly along its length to near the lips' colour
    // (mixed as the eye sees colour, in sRGB: mixed in linear light it stays bright until right at the tip)
    if (state.pattern === 'deepen') k.copy(cS).lerp(lipS, u > 1.2 ? 1 : 0.9 * Math.pow(Math.min(1, Math.max(0, (u - 0.05) / 0.85)), 1.0)).convertSRGBToLinear();
    else if (state.pattern === 'fade') k.copy(c).lerp(pale, u > 1.2 ? 0 : Math.pow(Math.min(1, Math.max(0, (u - 0.25) / 0.7)), 1.2));
    else { const w = u > 1.2 ? 1 : state.pattern === 'tips' ? Math.pow(Math.min(1, Math.max(0, (u - 0.4) / 0.4)), 0.8) : state.pattern === 'bands' ? ring(mane.d[i]) : state.pattern === 'roots' ? 1 - Math.min(1, Math.max(0, (u - 0.04) / 0.34)) : 0; k.copy(c).lerp(acc, w); }
    if (u > 1.2 && state.pattern === 'fade') k.copy(acc);   // (the bound arrangement's band, in the accent)
    if (smooth) { const s2 = nrm.getX(i) * L.x + nrm.getY(i) * L.y + nrm.getZ(i) * L.z; if (s2 > 0) k.lerp(lit, 0.3 * s2); else k.lerp(shade, 0.55 * -s2); }
    col.setXYZ(i, k.r, k.g, k.b);
  }
  // (the sheen in the tendril's own blue when they deepen: a pale sheen washes the dark tips out)
  col.needsUpdate = true; tentMat.sheenColor.copy(state.pattern === 'deepen' ? c.clone().multiplyScalar(0.6) : lit); tentMat.sheen = state.pattern === 'deepen' ? 0.15 : 0.3; lockMat.sheenColor.copy(c).lerp(new THREE.Color(1, 1, 1), 0.3);
}

async function dress() {
  const my = ++dressTicket, key = state.outfit;
  pool.cancelQueued();   // whatever was waiting for an older choice is no longer wanted
  grow(); fall();   // (a Mikkian's tendrils, or hair worn down, alongside)
  const clear = () => { for (const c of [...clothes.children]) { clothes.remove(c); c.geometry.dispose(); c.material.dispose(); } };
  if (!OUTFITS[key] || key === 'none') { clear(); wear(my); return; }
  const J = Object.fromEntries(Object.keys(base.info.joints).map((k) => [k, fig.joint(k)]));
  const L = Object.fromEntries(['neckSideL', 'neckSideR', 'chestMid', 'backMid'].map((k) => { const l = fig.landmark(k); return [k, { p: l.p, n: l.n }]; }));
  const args = { key, hood: state.hood, surface: { position: fig.p0.slice(), normal: fig.n0.slice(), index: tris }, J, L }, n = pool.size(), t0 = performance.now(), T0 = Date.now();
  $('status').hidden = false; $('status').textContent = 'Dressing…';
  // two passes: a coarse one (cells twice the size, several times quicker) put on as soon as it is whole, then the fine
  // one in the background, replacing it whole; a newer choice drops whatever is still waiting
  const pass = (coarse) => Promise.all(Array.from({ length: n }, (_, part) => pool.mesh('outfit', { ...args, part, of: n, coarse })));
  const put = (rs) => {
    clear();   // the old clothes stay on until the new ones are whole
    const cols = colours();
    for (const p of rs.flatMap((r) => r.pieces)) { const m = new THREE.Mesh(clothGeometry(p.mesh), (MATS[p.material] || clothMaterial)(cols[p.role] || '#777777')); m.material.vertexColors = true; m.castShadow = m.receiveShadow = true; m.name = p.name; m.userData.role = p.role; clothes.add(m); }
    wear(my); stage.changed();
  };
  const fail = (e) => { if (my === dressTicket && !(e && e.cancelled)) { console.error(e); $('status').textContent = 'Something went wrong dressing the figure.'; } };
  let rs;
  try { rs = await pass(2); } catch (e) { fail(e); return; }
  if (my !== dressTicket) return;
  put(rs); $('status').hidden = true; info.dress = Math.round(performance.now() - t0); info.coarseJobs = rs.map((r) => `start ${r.began - T0} end ${r.ended - T0} (${r.setup}+${r.ms - r.setup})`).join(' | ');
  try { rs = await pass(1); } catch (e) { fail(e); return; }
  if (my !== dressTicket) return;
  put(rs); info.fine = Math.round(performance.now() - t0); info.fineJobs = rs.map((r) => `start ${r.began - T0} end ${r.ended - T0}`).join(' | ');
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
const SHAPE_OPTS = new Set(['species', 'people', 'outfit', 'hood', 'gear', 'folds', 'spurs', 'tendrils', 'tlength', 'thick', 'length', 'surface']);   // these change what is worn or its fit
const MANE_OPTS = new Set(['style', 'surface', 'pattern', 'accent', 'skin']);   // these change what is worn or its fit
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
  $('title').textContent = LOOKS[sp()].name; $('blurb').textContent = LOOKS[sp()].blurb || '';
  $('summary').textContent = `${LOOKS[sp()].name}: ${pick('skin').name.toLowerCase()} skin, ${pick('eyes').name.toLowerCase()} eyes, ${state.hood === 'up' ? 'hood up' : sp() === 'mikkian' ? `${pick('length').name.toLowerCase()} ${pick('surface').name.toLowerCase()} head-tendrils (${pick('style').name.toLowerCase()}) with ${pick('accent').name.toLowerCase()} ${pick('pattern').name.toLowerCase()}` : `${pick('hair').name.toLowerCase()} hair ${pick('style').name.toLowerCase()}`}; in ${OUTFITS[state.outfit].name.toLowerCase()}, ${pick('main').name.toLowerCase()} and ${pick('second').name.toLowerCase()}${state.gear && state.gear !== 'none' ? `, carrying a ${pick('gear').name.toLowerCase()}` : ''}.`;
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
  if (SHAPE_OPTS.has(k) || (sp() === 'mikkian' && k === 'style') || (k === 'style' && (DOWN.has(v) || fallen))) redress(); else recolourClothes();
}
function recolourClothes() { const cols = colours(); for (const m of clothes.children) m.material.color.set(cols[m.userData.role] || '#777777'); stage.redraw(); }
$('random').addEventListener('click', () => {
  const rnd = Math.random, opts = options(), any = (k) => { const it = opts[k].items; return it[Math.floor(rnd() * it.length)].key; };
  Object.assign(ctrl, randomControls(rnd));
  for (const k of ['skin', 'eyes', 'outfit', 'main', ...(sp() === 'mikkian' ? ['thick', 'length', 'surface', 'pattern', 'accent'] : ['hair'])]) state[k] = any(k);
  do state.second = any('second'); while (state.second === state.main);
  state.hood = rnd() < 0.6 ? 'none' : any('hood'); state.gear = rnd() < 0.5 ? 'none' : any('gear'); state.style = sp() === 'mikkian' && rnd() < 0.6 ? 'dreads' : any('style');
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
