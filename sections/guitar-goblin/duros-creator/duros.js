// Duros character creator: the page. The figure is sculpted from signed distance shapes and meshed in workers
// (sdf.js, anatomy.js, kit.js, outfits.js, jobs.js, pool.js); the head is its own module (head-sculpt.js and
// head-b-field.js, by jpesus's agent) behind the small contract written down in head.js. This file builds the scene and the lights, puts the figure together, runs the panel and saves pictures.
// three.js is the copy vendored in ../vendor/three (r185), loaded through the page's import map.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeTextures, skinMaterial, clothMaterial, leatherMaterial, metalMaterial, plasticMaterial } from './materials.js';
import { OUTFITS } from './outfits.js';
import { HEAD_AT } from './anatomy.js';
import { cached, mesh, poolSize, cache_ } from './pool.js';
import { paintSkin, geometryFrom, smoothNoise } from './head.js';
import { makeHead } from './head-sculpt.js';   // the head: jpesus's agent's, to the contract in head.js

/* ---------------- the options ---------------- */
export const OPTIONS = {
  // skin and eye colours as the references show the species: muted blues, teals, greens and greys; red to orange eyes
  skin: { label: 'Skin', type: 'swatch', items: [
    { key: 'duro', name: 'Duro blue', c: '#4f7397' }, { key: 'slate', name: 'Slate grey-blue', c: '#5d7186' },
    { key: 'deep', name: 'Deep blue', c: '#34567f' }, { key: 'sky', name: 'Pale blue', c: '#6c8dab' },
    { key: 'teal', name: 'Blue-green', c: '#3f7b79' }, { key: 'sea', name: 'Sea green', c: '#55917a' },
    { key: 'green', name: 'Green', c: '#5e8756' }, { key: 'grey', name: 'Grey-green', c: '#74897c' },
  ] },
  eyes: { label: 'Eyes', type: 'swatch', items: [
    { key: 'red', name: 'Red', c: '#d2261c' }, { key: 'ember', name: 'Orange-red', c: '#e6481a' },
    { key: 'orange', name: 'Orange', c: '#ee7a1c' }, { key: 'amber', name: 'Amber', c: '#eaa238' },
    { key: 'crimson', name: 'Crimson', c: '#ac1826' }, { key: 'dark', name: 'Dark red', c: '#78121a' },
  ] },
  head: { label: 'Head', type: 'seg', items: [{ key: 'round', name: 'Rounded' }, { key: 'tall', name: 'High dome' }, { key: 'narrow', name: 'Narrow' }] },
  // slender by nature: 'average' is narrower in the shoulder than a human hero
  build: { label: 'Build', type: 'seg', items: [{ key: 'slim', name: 'Slim', s: 0.88 }, { key: 'average', name: 'Average', s: 0.95 }, { key: 'broad', name: 'Broad', s: 1.06 }] },
  age: { label: 'Age', type: 'seg', items: [{ key: 'young', name: 'Young', a: 0 }, { key: 'adult', name: 'Adult', a: 0.3 }, { key: 'elder', name: 'Elder', a: 0.8 }] },
  expr: { label: 'Expression', type: 'seg', items: [{ key: 'neutral', name: 'Calm' }, { key: 'smile', name: 'Smile' }, { key: 'stern', name: 'Stern' }, { key: 'wary', name: 'Wary' }] },
  marks: { label: 'Markings', type: 'seg', items: [{ key: 'none', name: 'None' }, { key: 'freckles', name: 'Freckles' }, { key: 'cheeks', name: 'Cheek bars' }, { key: 'scar', name: 'Scar' }] },
  outfit: { label: 'Outfit', type: 'seg', items: OUTFITS.map((o) => ({ key: o.key, name: o.name })) },
};
const DEFAULT = { skin: 'duro', eyes: 'red', head: 'round', build: 'average', age: 'adult', expr: 'neutral', marks: 'none', outfit: 'scout' };
const pick = (opt, key) => OPTIONS[opt].items.find((o) => o.key === key) || OPTIONS[opt].items[0];
function readHash() {
  const st = Object.assign({}, DEFAULT), q = new URLSearchParams(location.hash.slice(1));
  for (const k of Object.keys(OPTIONS)) if (OPTIONS[k].items.some((o) => o.key === q.get(k))) st[k] = q.get(k);
  return st;
}
const state = readHash();
const writeHash = () => history.replaceState(null, '', '#' + new URLSearchParams(state).toString());

/* ---------------- the renderer and the scene ---------------- */
const canvas = document.getElementById('scene');
const phone = Math.min(screen.width, screen.height) < 600 || /Mobi|Android/i.test(navigator.userAgent);
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
catch (e) { document.getElementById('nogl').hidden = false; throw e; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.75 : 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;   // the figure stands still: shadows are drawn again only after a change
makeTextures();

const scene = new THREE.Scene();
// a soft studio for reflections: a dark room with four light panels
{
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.MeshBasicMaterial({ color: 0x1b2230, side: THREE.BackSide })));
  const panel = (w, h, col, pos) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m); };
  panel(4, 4, 0xfff1dc, [5, 5, 6]);      // key softbox
  panel(6, 3, 0x9fd0ff, [-6, 3, -5]);    // rim
  panel(8, 8, 0x55606e, [0, 8, 0]);      // ceiling bounce
  panel(3, 5, 0xcfe0ff, [-6, 1, 4]);     // fill
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.035).texture;
  pm.dispose();
}
scene.environmentIntensity = 0.55;

// three-point light: a warm key that casts soft shadows, a cool fill, and cool and warm rims from behind
const key = new THREE.DirectionalLight(0xffecd6, 2.6);
key.position.set(1.4, 2.9, 2.0); key.target.position.set(0, 1.4, 0);
key.castShadow = true;
key.shadow.mapSize.set(phone ? 1024 : 2048, phone ? 1024 : 2048);
Object.assign(key.shadow.camera, { left: -0.75, right: 0.75, top: 0.75, bottom: -0.75, near: 1.5, far: 5.5 });
key.shadow.bias = -0.0003; key.shadow.normalBias = 0.012; key.shadow.radius = 4; key.shadow.intensity = 0.7;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xb9d4ff, 0.55); fill.position.set(-2.2, 1.6, 1.6); scene.add(fill);
const rim = new THREE.DirectionalLight(0x9fd6ff, 2.4); rim.position.set(-1.2, 2.6, -2.4); rim.target.position.set(0, 1.5, 0); scene.add(rim, rim.target);
const rim2 = new THREE.DirectionalLight(0xffd2b0, 0.9); rim2.position.set(1.8, 2.0, -1.8); rim2.target.position.set(0, 1.5, 0); scene.add(rim2, rim2.target);
scene.add(new THREE.HemisphereLight(0x8ea7c7, 0x141820, 0.35));

// the backdrop: a curved studio sweep behind the figure, lit in the middle and dark at the edges
const backdrop = (() => {
  const g = new THREE.CylinderGeometry(2.4, 2.4, 4, 64, 8, true, Math.PI * 0.62, Math.PI * 0.76);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), t = Math.exp(-((x / 1.6) ** 2) - ((y - 0.15) / 1.4) ** 2);
    c.setRGB(0.012, 0.016, 0.026).lerp(new THREE.Color(0.075, 0.1, 0.14), t); col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.BackSide }));
  m.position.set(0, 1.45, 1.55); m.receiveShadow = true;
  return m;
})();
scene.add(backdrop);

let dirty = true;
const redraw = () => { dirty = true; };
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
const controls = new OrbitControls(camera, canvas);
const VIEWS = {
  portrait: { target: [0, 1.665, 0.02], pos: [0.4, 1.73, 1.18] },
  body: { target: [0, 1.32, 0.02], pos: [0.7, 1.45, 2.3] },
};
function frameView(which = 'portrait') {
  const v = VIEWS[which] || VIEWS.portrait;
  controls.target.set(...v.target); camera.position.set(...v.pos); controls.update(); redraw();
}
controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 0.42; controls.maxDistance = 2.7; controls.minPolarAngle = 0.5; controls.maxPolarAngle = 2.15;
frameView('portrait');

/* ---------------- the figure ---------------- */
const figure = new THREE.Group(); scene.add(figure);
const handSkin = skinMaterial();
const parts = { head: null, hands: null, outfit: null };
let head = null;   // the head module's handle: { object, setSkin, setEyes, dispose }

function swap(slot, obj) {
  if (parts[slot]) { figure.remove(parts[slot]); if (slot !== 'head') parts[slot].traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  parts[slot] = obj;
  if (obj) figure.add(obj);
}
function paintCloth(geo) {
  const ao = geo.userData.ao, col = geo.attributes.color, pos = geo.attributes.position;
  for (let i = 0; i < ao.length; i++) { const o = 0.3 + 0.7 * Math.pow(ao[i], 1.4), m = 0.96 + 0.08 * smoothNoise(pos.getX(i) * 30, pos.getY(i) * 30, pos.getZ(i) * 30); col.setXYZ(i, o * m, o * m, o * m); }
  col.needsUpdate = true;
}
const lightMaterial = (hex) => new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: 1.4, roughness: 0.3 });
const MATERIALS = { cloth: clothMaterial, leather: leatherMaterial, metal: metalMaterial, plastic: plasticMaterial, light: lightMaterial };

function skinColours() {
  const c = new THREE.Color(pick('skin', state.skin).c);
  handSkin.color.copy(c); handSkin.sheenColor.copy(c).lerp(new THREE.Color(0xffffff), 0.45);
  if (head) head.setSkin(pick('skin', state.skin).c);
  redraw();
}
const changed = () => { renderer.shadowMap.needsUpdate = true; redraw(); };

let building = 0;
const status = document.getElementById('status');
async function rebuild(what) {
  const ticket = ++building;
  status.hidden = false;
  const s = pick('build', state.build).s, age = pick('age', state.age).a;
  const jobs = [];
  if (what.head) jobs.push(makeHead(THREE, { shape: state.head, expr: state.expr, age, marks: state.marks, skin: pick('skin', state.skin).c, eyes: pick('eyes', state.eyes).c }).then((h) => ['head', h]));
  if (what.body) jobs.push(Promise.all([cached(`hand:1:${s}`, 'hand', { side: 1, build: s }), cached(`hand:-1:${s}`, 'hand', { side: -1, build: s })]).then((r) => ['hands', r]));
  if (what.outfit) {
    // the outfit's pieces shared out between the workers, then put back in order
    const n = poolSize(), k = `outfit:${state.outfit}:${s}`;
    if (!cache_.has(k)) cache_.set(k, Promise.all(Array.from({ length: n }, (_, part) => mesh('outfit', { key: state.outfit, build: s, part, of: n })))
      .then((rs) => ({ pieces: rs.flatMap((r) => r.pieces).sort((x, y) => x.index - y.index) })));
    jobs.push(cache_.get(k).then((r) => ['outfit', r]));
  }
  const done = await Promise.all(jobs);
  if (ticket !== building) { for (const [slot, r] of done) if (slot === 'head') r.dispose(); return; }   // a newer choice is on its way
  for (const [slot, r] of done) {
    if (slot === 'head') {
      if (head) head.dispose();
      head = r; r.object.position.set(...HEAD_AT); swap('head', r.object);
    } else if (slot === 'hands') {
      const g = new THREE.Group();
      for (const h of r) { const geo = geometryFrom(THREE, h.mesh); paintSkin(geo); const m = new THREE.Mesh(geo, handSkin); m.castShadow = m.receiveShadow = true; g.add(m); }
      swap('hands', g);
    } else if (slot === 'outfit') {
      const g = new THREE.Group(), def = OUTFITS.find((o) => o.key === state.outfit);
      for (const p of r.pieces) {
        const mk = MATERIALS[p.material] || clothMaterial, colour = p.colour || (def && def.colours && def.colours[p.name]) || '#777777';
        // a copy of the cached arrays, so the same outfit can be shown again later
        const geo = geometryFrom(THREE, { position: p.mesh.position, normal: p.mesh.normal, uv: p.mesh.uv, index: p.mesh.index, ao: p.mesh.ao }); paintCloth(geo);
        const m = new THREE.Mesh(geo, mk(colour)); m.castShadow = m.receiveShadow = true; m.name = p.name; g.add(m);
      }
      swap('outfit', g);
    }
  }
  skinColours(); changed();
  status.hidden = true;
}

/* ---------------- the panel ---------------- */
function summary() {
  const s = (k) => pick(k, state[k]).name.toLowerCase();
  document.getElementById('summary').textContent = `${pick('age', state.age).name} Duros, ${s('build')} build, ${s('skin')} skin, ${s('eyes')} eyes, ${s('head')} head, ${s('expr')}${state.marks !== 'none' ? ', ' + s('marks') : ''}, in a ${s('outfit')}.`;
}
function paint() {
  for (const el of document.querySelectorAll('[data-opt]')) for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.key === state[el.dataset.opt]));
  summary();
}
function set(opt, k) {
  if (state[opt] === k) return;
  state[opt] = k;
  if (opt === 'head' || opt === 'expr' || opt === 'age' || opt === 'marks') rebuild({ head: true });
  else if (opt === 'build') rebuild({ body: true, outfit: true });
  else if (opt === 'outfit') rebuild({ outfit: true });
  else if (opt === 'eyes') { if (head) head.setEyes(pick('eyes', state.eyes).c); redraw(); }
  else if (opt === 'skin') skinColours();
  paint(); writeHash();
}
const panelEl = document.getElementById('options');
for (const [opt, def] of Object.entries(OPTIONS)) {
  const fs = document.createElement('fieldset'); fs.className = 'opt';
  fs.innerHTML = `<legend>${def.label}</legend>`;
  const box = document.createElement('div'); box.className = def.type === 'swatch' ? 'swatches' : 'seg'; box.dataset.opt = opt;
  for (const o of def.items) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.key = o.key;
    if (def.type === 'swatch') { b.className = 'sw'; b.style.setProperty('--c', o.c); b.setAttribute('aria-label', o.name); b.title = o.name; }
    else b.textContent = o.name;
    b.addEventListener('click', () => set(opt, o.key));
    box.appendChild(b);
  }
  fs.appendChild(box); panelEl.appendChild(fs);
}
document.getElementById('random').addEventListener('click', () => {
  const before = Object.assign({}, state);
  for (const k of Object.keys(OPTIONS)) { const it = OPTIONS[k].items; state[k] = it[Math.floor(Math.random() * it.length)].key; }
  if (Math.random() < 0.6) state.marks = 'none';
  const headChanged = ['head', 'expr', 'age', 'marks'].some((k) => before[k] !== state[k]);
  rebuild({ head: headChanged, body: before.build !== state.build, outfit: before.outfit !== state.outfit || before.build !== state.build });
  if (!headChanged && head) head.setEyes(pick('eyes', state.eyes).c);
  skinColours(); paint(); writeHash();
});
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => frameView(b.dataset.view));

/* ---------------- pictures ---------------- */
// Render the scene square at `size` from a camera (the current view, or a fixed head-and-shoulders one), on the studio
// backdrop, a plain colour or nothing, and return a PNG data URL.
function snapshot(size, bg, cam) {
  const keep = { w: canvas.clientWidth, h: canvas.clientHeight, pr: renderer.getPixelRatio() };
  renderer.setPixelRatio(1); renderer.setSize(size, size, false);
  backdrop.visible = bg === 'studio';
  renderer.setClearColor(0x161d29, bg === 'plain' ? 1 : 0);
  renderer.render(scene, cam);
  const url = canvas.toDataURL('image/png');
  backdrop.visible = true; renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(keep.pr); renderer.setSize(keep.w, keep.h, false);
  redraw();
  return url;
}
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
const bgChoice = () => (document.querySelector('input[name=bg]:checked') || { value: 'studio' }).value;
// the portrait: the current view, 1024 px square
document.getElementById('save').addEventListener('click', () => {
  const cam = camera.clone(); cam.aspect = 1; cam.fov = fovFor(1); cam.updateProjectionMatrix();
  download(snapshot(1024, bgChoice(), cam), `duros-${state.skin}-${state.outfit}.png`);
});
// the token: 512 px, the whole head and the shoulders from the front and a little to the side, so it
// still reads at 20 px on a map (jpesus's agent's test on #65); plain by default
const tokenCam = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
document.getElementById('token').addEventListener('click', () => {
  const eyeY = HEAD_AT[1];
  tokenCam.position.set(0.15, eyeY, 1.04); tokenCam.lookAt(0, eyeY - 0.015, 0); tokenCam.updateProjectionMatrix();
  const bg = bgChoice() === 'studio' ? 'plain' : bgChoice();
  download(snapshot(512, bg, tokenCam), `duros-token-${state.skin}.png`);
});

/* ---------------- run ---------------- */
const fovFor = (aspect) => (aspect < 0.75 ? 30 + (0.75 - aspect) * 22 : 30);
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const pr = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) { renderer.setSize(w, h, false); redraw(); }
  if (camera.aspect !== w / h) { camera.aspect = w / h; camera.fov = fovFor(w / h); camera.updateProjectionMatrix(); redraw(); }
}
const hint = document.getElementById('hint');
controls.addEventListener('start', () => hint.classList.add('gone'));
controls.addEventListener('change', redraw);
function frame() {
  resize();
  controls.update();   // damping keeps moving the camera for a moment after a drag; 'change' marks those frames
  if (!dirty) return;
  dirty = false;
  renderer.render(scene, camera);
}
paint();
const ready = rebuild({ head: true, body: true, outfit: true });
renderer.setAnimationLoop(frame);
window.__duros = { state, set, ready, frameView, camera, controls, redraw, stats: () => ({ tris: renderer.info.render.triangles, calls: renderer.info.render.calls, geometries: renderer.info.memory.geometries }) };
