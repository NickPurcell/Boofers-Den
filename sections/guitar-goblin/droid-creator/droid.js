// Droid creator: the page. A droid is built from hard-surface parts made in code (hard.js: bevelled panels laid on
// curved surfaces, turned and lofted solids), painted by one material that also wears it (paint.js). chassis.js
// lists the kinds of droid: utility.js is the astromech-style one (domes.js its heads, layout.js its panel layouts
// and the paint schemes, fittings.js its attachments), power.js the walking battery. The scene, lights, studio and picture export are the
// shared stage (../creator-kit/stage.js); this file puts the pieces together and runs the panel.
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';
import { noiseTexture, paintMaterial, glassMaterial, clearMaterial, glowMaterial, logicTexture, logicMaterial, halo } from './paint.js';
import { CHASSIS } from './chassis.js';

/* ---------------- the options ---------------- */
const PAINTS = [
  { key: 'white', name: 'Works white', c: '#e6e3da' }, { key: 'cream', name: 'Cream', c: '#d6c59c' }, { key: 'sand', name: 'Sand', c: '#b3976a' },
  { key: 'grey', name: 'Hull grey', c: '#89919a' }, { key: 'graphite', name: 'Graphite', c: '#3a3f46' }, { key: 'black', name: 'Black', c: '#16171a' },
  { key: 'navy', name: 'Navy', c: '#1d3765' }, { key: 'blue', name: 'Signal blue', c: '#2a60b6' }, { key: 'teal', name: 'Teal', c: '#1c7676' },
  { key: 'green', name: 'Field green', c: '#3c6938' }, { key: 'olive', name: 'Olive', c: '#676639' }, { key: 'yellow', name: 'Hazard yellow', c: '#d6a01a' },
  { key: 'orange', name: 'Orange', c: '#cf5d1d' }, { key: 'red', name: 'Oxide red', c: '#a22d24' }, { key: 'maroon', name: 'Maroon', c: '#5c1e23' },
  { key: 'violet', name: 'Violet', c: '#573d86' },
];
const EYES = [
  { key: 'red', name: 'Red', c: '#ff3a26' }, { key: 'blue', name: 'Blue', c: '#3d8bff' }, { key: 'amber', name: 'Amber', c: '#ffa51f' },
  { key: 'green', name: 'Green', c: '#35f58a' }, { key: 'white', name: 'White', c: '#e6f2ff' }, { key: 'violet', name: 'Violet', c: '#b25cff' },
];
// what every chassis shares; a chassis adds its own between `chassis` and the colours (chassis.js)
const SHARED_FIRST = { chassis: { label: 'Chassis', items: Object.entries(CHASSIS).map(([key, c]) => ({ key, name: c.name })) } };
const SHARED_LAST = {
  primary: { label: 'Main colour', swatch: true, items: PAINTS },
  secondary: { label: 'Second colour', swatch: true, items: PAINTS },
  finish: { label: 'Finish', items: [{ key: 'paint', name: 'Painted' }, { key: 'metal', name: 'Metallic' }] },
  eye: { label: 'Photoreceptor', swatch: true, items: EYES },
  wear: { label: 'Weathering', items: [{ key: 'fresh', name: 'Factory fresh', w: 0.0 }, { key: 'worn', name: 'In service', w: 0.45 }, { key: 'battered', name: 'Battered', w: 0.72 }, { key: 'scavenged', name: 'Scavenged', w: 1.0 }] },
};
const SHARED_DEFAULT = { chassis: 'utility', primary: 'sand', secondary: 'graphite', finish: 'paint', eye: 'red', wear: 'worn', seed: '7' };
const chosen = new Set();   // the choices a person has made themselves; the rest follow the chassis
const state = {};
const chassis = () => CHASSIS[state.chassis] || CHASSIS.utility;
const options = () => ({ ...SHARED_FIRST, ...chassis().options, ...SHARED_LAST });
const pick = (opt, key) => { const it = options()[opt].items; return it.find((o) => o.key === key) || it[0]; };
const kitSet = (s) => { const ok = (options().kit || { items: [] }).items.map((o) => o.key); return new Set(String(s || '').split('.').filter((k) => ok.includes(k))); };
// make the state whole for its chassis: anything missing or not on offer takes the default
function settle(from = {}) {
  const ch = from.chassis ?? state.chassis;
  state.chassis = CHASSIS[ch] ? ch : SHARED_DEFAULT.chassis;
  const defs = { ...SHARED_DEFAULT, ...chassis().defaults }, opts = options();
  for (const k of Object.keys(state)) if (k !== 'chassis' && k !== 'seed' && !opts[k]) delete state[k];
  for (const [k, def] of Object.entries(opts)) {
    if (k === 'chassis') continue;
    const v = from[k] ?? state[k];
    if (def.multi) state[k] = [...kitSet(v ?? defs[k])].join('.');
    else state[k] = def.items.some((o) => o.key === v) ? v : defs[k];
  }
  state.seed = /^\d{1,4}$/.test(from.seed ?? state.seed ?? '') ? String(from.seed ?? state.seed) : SHARED_DEFAULT.seed;
}
{ const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1))); for (const k of Object.keys(q)) if (k !== 'chassis') chosen.add(k); settle(q); }
const writeHash = () => history.replaceState(null, '', '#' + new URLSearchParams(state).toString());

/* ---------------- the stage ---------------- */
const canvas = document.getElementById('scene');
const stage = makeStage(canvas, { tall: 1.3, minDistance: 0.55, onNoGL: () => { document.getElementById('nogl').hidden = false; } });
const { scene, camera, controls, redraw, changed } = stage;
function frameView(which = 'whole') { const v = chassis().views[which] || chassis().views.whole; stage.view(v.target, v.pos); }

/* ---------------- the droid ---------------- */
const noise = noiseTexture(256);
const MAT = { main: paintMaterial(noise), glass: glassMaterial(), glow: glowMaterial(), logic: logicMaterial(logicTexture(7)), clear: clearMaterial() };
const paintU = MAT.main.userData.u;
const droid = new THREE.Group(); scene.add(droid);
let pieces = null, halos = [], info = { tris: 0 };
// what moves smoothly (the stance, a turn of the head): where each is, and where it is heading
const anim = {}, goal = {};
function aim(jump) { const A = chassis().anim || {}; for (const k of Object.keys(anim)) if (!A[k]) { delete anim[k]; delete goal[k]; } for (const [k, f] of Object.entries(A)) { goal[k] = f(state); if (jump || anim[k] === undefined) anim[k] = goal[k]; } }

function assemble(kits) {
  const g = {}; halos = [];
  for (const [name, kit] of Object.entries(kits)) {
    const grp = new THREE.Group(); grp.name = name;
    for (const part of ['main', 'glass', 'glow', 'logic', 'clear']) {
      if (kit[part].empty) continue;
      const mesh = new THREE.Mesh(kit[part].geometry(), MAT[part]);
      mesh.castShadow = part === 'main' || part === 'glass'; mesh.receiveShadow = part === 'main';
      if (part === 'clear') mesh.renderOrder = 5;
      grp.add(mesh);
    }
    for (const h of kit.halos) {
      const s = halo(new THREE.Color(h.color[0], h.color[1], h.color[2]), h.size);
      s.position.set(h.p[0] + h.n[0] * 0.008, h.p[1] + h.n[1] * 0.008, h.p[2] + h.n[2] * 0.008);
      s.userData.n = new THREE.Vector3(h.n[0], h.n[1], h.n[2]); grp.add(s); halos.push(s);
    }
    g[name] = grp;
  }
  return g;
}
function rebuild() {
  const t0 = performance.now(), c = new THREE.Color(pick('eye', state.eye).c);
  const kits = chassis().build({ ...state, eyeColor: pick('eye', state.eye).c, eyeRGB: [c.r, c.g, c.b] }, kitSet(state.kit));
  if (pieces) { droid.clear(); for (const g of Object.values(pieces)) g.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isSprite) o.material.dispose(); }); }
  pieces = assemble(kits); chassis().place(pieces, droid);
  chassis().pose(pieces, anim);
  let tris = 0; droid.traverse((o) => { if (o.isMesh) tris += o.geometry.index.count / 3; });
  info = { tris, ms: Math.round(performance.now() - t0) };
  colours(); changed();
}
function colours() {
  paintU.uPrimary.value.set(pick('primary', state.primary).c);
  paintU.uSecondary.value.set(pick('secondary', state.secondary).c);
  // a panel from some other unit: a paint that is neither of this one's
  const others = PAINTS.filter((p) => p.key !== state.primary && p.key !== state.secondary);
  paintU.uOdd.value.set(others[(Number(state.seed) * 7 + 3) % others.length].c);
  paintU.uWear.value = pick('wear', state.wear).w;
  paintU.uFinish.value = state.finish === 'metal' ? 1 : 0;
  redraw();
}
// halos fade as their light turns away from the camera
const _wp = new THREE.Vector3(), _wn = new THREE.Vector3(), _q = new THREE.Quaternion();
function faceHalos(cam) {
  for (const s of halos) {
    if (s.userData.n.lengthSq() < 0.5) { s.material.opacity = 0.9; continue; }
    s.getWorldPosition(_wp); s.parent.getWorldQuaternion(_q); _wn.copy(s.userData.n).applyQuaternion(_q);
    const f = _wn.dot(_wp.sub(cam.position).normalize().negate());
    s.material.opacity = Math.max(0, Math.min(1, (f - 0.12) * 2.2)) * 0.7;
  }
}

/* ---------------- the panel ---------------- */
function summary() {
  const n = (k) => pick(k, state[k]).name.toLowerCase(), kit = [...kitSet(state.kit)].map((k) => pick('kit', k).name.toLowerCase());
  document.getElementById('summary').textContent = `${chassis().noun} No. ${state.seed}: ${chassis().describe(n)}, ${n('scheme')} scheme in ${state.finish === 'metal' ? 'metallic ' : ''}${n('primary')} and ${n('secondary')}, ${n('eye')} photoreceptor, ${n('wear')}${kit.length ? ', with ' + kit.join(', ') : ''}.`;
}
function paint() {
  for (const el of document.querySelectorAll('[data-opt]')) {
    const multi = options()[el.dataset.opt].multi, on = multi ? kitSet(state[el.dataset.opt]) : null;
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(multi ? on.has(b.dataset.key) : b.dataset.key === state[el.dataset.opt]));
  }
  summary();
}
function set(opt, k) {
  const def = options()[opt];
  if (def.multi) { const on = kitSet(state[opt]); if (on.has(k)) on.delete(k); else on.add(k); state[opt] = [...on].join('.'); rebuild(); }
  else {
    if (state[opt] === k) return;
    state[opt] = k; if (opt !== 'chassis') chosen.add(opt);
    if (opt === 'chassis') { for (const [q, v] of Object.entries(chassis().defaults)) if (!chosen.has(q)) state[q] = v; settle(); aim(true); panel(); rebuild(); frameView('whole'); }
    else if (opt === 'primary' || opt === 'secondary' || opt === 'wear' || opt === 'finish') colours();
    else if ((chassis().moves || []).includes(opt)) aim(false);
    else rebuild();
  }
  paint(); writeHash(); redraw();
}
const panelEl = document.getElementById('options');
function panel() {   // the choices on offer change with the chassis
  panelEl.textContent = '';
  for (const [opt, def] of Object.entries(options())) {
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
  const hv = document.querySelector('[data-view="head"]'); if (hv) hv.textContent = chassis().headName;
}
document.getElementById('random').addEventListener('click', () => {
  const opts = options(), any = (k) => { const it = opts[k].items; return it[Math.floor(Math.random() * it.length)].key; };
  for (const [k, def] of Object.entries(opts)) {
    if (k === 'chassis' || k === 'secondary') continue;
    state[k] = def.multi ? def.items.map((o) => o.key).filter(() => Math.random() < 0.35).join('.') : any(k);
  }
  do state.secondary = any('secondary'); while (state.secondary === state.primary);
  // never roll the one combination that reads as the best-known unit of the type: a pale round-domed unit with blue trim
  if (state.chassis === 'utility' && state.form === 'round' && ['white', 'cream', 'grey'].includes(state.primary) && ['blue', 'navy', 'teal'].includes(state.secondary)) state.primary = ['sand', 'olive', 'graphite', 'maroon'][Math.floor(Math.random() * 4)];
  for (const k of Object.keys(opts)) if (k !== 'chassis') chosen.add(k);
  state.seed = String(1 + Math.floor(Math.random() * 999));
  aim(false); rebuild(); paint(); writeHash();
});
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => frameView(b.dataset.view));

/* ---------------- pictures ---------------- */
const bgChoice = () => (document.querySelector('input[name=bg]:checked') || { value: 'studio' }).value;
// the portrait: the current view, 1024 px square
document.getElementById('save').addEventListener('click', () => {
  stage.download(stage.snapshot(1024, bgChoice(), stage.squareCamera()), `${state.chassis}-droid-${state.seed}-${state.primary}-${state.secondary}.png`);
});
// the token: 512 px, the head and shoulders from the front and a little to one side, so the eye still reads at map
// size; plain by default
const tokenCam = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
document.getElementById('token').addEventListener('click', () => {
  const t = chassis().token(pieces);
  tokenCam.position.set(...t.pos); tokenCam.lookAt(...t.target); tokenCam.updateProjectionMatrix();
  const bg = bgChoice() === 'studio' ? 'plain' : bgChoice();
  stage.download(stage.snapshot(512, bg, tokenCam, false), `${state.chassis}-droid-token-${state.seed}.png`);
});

/* ---------------- run ---------------- */
const hint = document.getElementById('hint');
controls.addEventListener('start', () => hint.classList.add('gone'));
stage.beforeRender = faceHalos;
aim(true); panel(); paint(); frameView('whole');
rebuild();
stage.start((dt) => {   // lean back onto the third leg, turn the dome, take a step
  let moving = false;
  for (const k of Object.keys(goal)) if (anim[k] !== goal[k]) { const step = dt / 0.75; anim[k] = goal[k] > anim[k] ? Math.min(goal[k], anim[k] + step) : Math.max(goal[k], anim[k] - step); moving = true; }
  if (moving && pieces) chassis().pose(pieces, anim);
  return moving;
});
window.__droid = { state, set, frameView, camera, controls, redraw, rebuild, anim, goal, stats: () => ({ ...stage.stats(), built: info }) };
