/* The single-leg test rig, in 3D: the same STLs you print (in rig coordinates), assembled or exploded, with the
   leg playing the robot's gait table through the same kinematics as the main sim. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GEOM, Player, carriageY } from './gait.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#rig-canvas');
const box = $('.rigview');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch (e) { $('#rig-nogl').hidden = false; }
if (renderer) { renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; }

const scene = new THREE.Scene();
scene.background = new THREE.Color('#11151b');
const camera = new THREE.PerspectiveCamera(36, 1, 5, 3000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.minDistance = 120; controls.maxDistance = 700;
controls.target.set(35, 48, 26);
camera.position.set(250, 170, 230);
scene.add(new THREE.HemisphereLight('#f4f1ff', '#2a2622', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.1); sun.position.set(300, 500, 350); scene.add(sun);
const rim = new THREE.DirectionalLight('#cfe0ff', 0.7); rim.position.set(-300, 150, -200); scene.add(rim);
const grid = new THREE.GridHelper(600, 30, '#3a4556', '#262e3a'); grid.position.y = -5.2; scene.add(grid);

/* Binary STL -> BufferGeometry (OpenSCAD exports, converted to binary). */
function parseSTL(buf) {
  const dv = new DataView(buf), n = dv.getUint32(80, true);
  const pos = new Float32Array(n * 9), nor = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50;
    for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) {
      pos[i * 9 + v * 3 + c] = dv.getFloat32(o + 12 + v * 12 + c * 4, true);
      nor[i * 9 + v * 3 + c] = dv.getFloat32(o + c * 4, true);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
const PARTS = {
  base:       { color: '#4b5361', group: 'fixed',    step: 1 },
  column:     { color: '#8b94a3', group: 'fixed',    step: 1 },
  liftServo:  { color: '#2f7fe6', group: 'fixed',    step: 2 },
  bushings:   { color: '#dfe4ea', group: 'carriage', step: 3, metal: true },
  carriage:   { color: '#a9b2bf', group: 'carriage', step: 3 },
  swingServo: { color: '#2f7fe6', group: 'carriage', step: 3 },
  rods:       { color: '#dfe4ea', group: 'fixed',    step: 4, metal: true },
  leg:        { color: '#e8735a', group: 'leg',      step: 5 },
  crank:      { color: '#f2f2ee', group: 'crank',    step: 6 },
  pin:        { color: '#c8ccd2', group: 'crank',    step: 6, metal: true },
};
// Exploded offsets per group (mm): pull things apart along the direction they go together.
const EXPLODE = { fixed: [0, 0, 0], carriage: [45, 18, 0], leg: [95, -12, 0], crank: [70, 18, -45] };
const SPECIAL = { base: [0, -30, 0], rods: [0, 70, 0], liftServo: [28, 0, -30] };

const groups = {};
for (const k of ['fixed', 'carriage', 'leg', 'crank']) { groups[k] = new THREE.Group(); scene.add(groups[k]); }
// leg and crank turn about their own axes: an inner group holds the mesh shifted so the axis is at the origin
const legPivot = new THREE.Group(); groups.leg.add(legPivot);
const crankPivot = new THREE.Group(); groups.crank.add(crankPivot);
const meshes = {};
const ready = Promise.all(Object.entries(PARTS).map(async ([name, p]) => {
  const r = await fetch(`rig/preview/${name}.stl`);
  const m = new THREE.Mesh(parseSTL(await r.arrayBuffer()), mat(p.color, p.metal ? { metalness: 0.8, roughness: 0.3 } : {}));
  m.userData = p; meshes[name] = m;
  if (name === 'leg') { m.position.z = -GEOM.legZ; legPivot.add(m); }
  else if (name === 'crank' || name === 'pin') { m.position.z = -8; crankPivot.add(m); }
  else groups[p.group].add(m);
}));

let exploded = false, playing = true, step = 6;
const player = new Player('creep');
const LEG = 1;   // the rig is a front-right module: the robot's leg 1 (channels 2 and 3)
let angles = [0, 0];

function place(t) {
  const [s, l] = angles;
  const k = exploded ? 1 : 0;
  const cy = carriageY(l);
  const off = (g) => EXPLODE[g].map((v) => v * k);
  groups.carriage.position.set(...off('carriage')); groups.carriage.position.y += cy;
  groups.leg.position.set(...off('leg')); groups.leg.position.y += cy; groups.leg.position.z += GEOM.legZ;
  legPivot.rotation.x = -s * Math.PI / 180;
  groups.crank.position.set(...off('crank')); groups.crank.position.y += GEOM.yokeY; groups.crank.position.z += 8;
  crankPivot.rotation.x = -l * Math.PI / 180;
  for (const [name, m] of Object.entries(meshes)) {
    const sp = SPECIAL[name];
    if (sp) m.position.set(sp[0] * k, sp[1] * k, sp[2] * k);
    m.visible = m.userData.step <= step;
    m.material.emissive.set(m.userData.step === step && step < 6 ? '#4a3210' : '#000000');
  }
}

const readout = $('#rig-read');
function update(ms) {
  if (playing) {
    const a = player.step(ms);
    angles = [a[2 * LEG], a[2 * LEG + 1]];
  }
}

/* UI */
$('#rig-explode').addEventListener('click', (e) => {
  exploded = !exploded; e.currentTarget.setAttribute('aria-pressed', String(exploded));
  const t0 = controls.target.clone(), t1 = exploded ? new THREE.Vector3(70, 55, 10) : new THREE.Vector3(35, 48, 26);
  camera.position.sub(t0).multiplyScalar(exploded ? 1.45 : 1 / 1.45).add(t1); controls.target.copy(t1);
  e.currentTarget.textContent = exploded ? 'Assembled' : 'Exploded';
});
$('#rig-play').addEventListener('click', (e) => {
  playing = !playing; e.currentTarget.textContent = playing ? 'Pause' : 'Play';
});
$('#rig-gait').addEventListener('click', (e) => {
  const next = player.gait.key === 'creep' ? 'trot' : 'creep';
  player.setGait(next); e.currentTarget.textContent = next === 'creep' ? 'Trot' : 'Creep';
});
const stepBtns = [...document.querySelectorAll('[data-step]')];
const stepText = [...document.querySelectorAll('#rig-steps li')];
function setStep(n) {
  step = n;
  stepBtns.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.step === n)));
  stepText.forEach((li, i) => li.classList.toggle('now', i + 1 === n));
}
stepBtns.forEach((b) => b.addEventListener('click', () => setStep(+b.dataset.step)));
stepText.forEach((li, i) => li.addEventListener('click', () => { setStep(i + 1); box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }));

function resize() {
  const w = box.clientWidth, h = box.clientHeight;
  if (renderer) renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (!resize.done && w > 0) {
    resize.done = true;
    const d = 330 * Math.max(1, Math.pow(1.2 / camera.aspect, 0.7));
    camera.position.copy(controls.target).add(new THREE.Vector3(0.68, 0.42, 0.6).normalize().multiplyScalar(d));
  }
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(box);
resize();

let visible = true;
new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(box);
let last = performance.now(), uiT = 0;
ready.then(() => {
  setStep(6);
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(now - last, 100); last = now;
    if (!visible) return;
    update(dt);
    place();
    controls.update();
    if (renderer) renderer.render(scene, camera);
    uiT += dt;
    if (uiT > 120) {
      uiT = 0;
      const [s, l] = angles, y = carriageY(l) - GEOM.leg * Math.cos(s * Math.PI / 180), z = GEOM.leg * Math.sin(s * Math.PI / 180);
      readout.textContent = `${player.gait.label} · swing ${s.toFixed(0)}° · lift ${l.toFixed(0)}° · foot ${z >= 0 ? '+' : ''}${z.toFixed(0)} mm, ${Math.max(0, y).toFixed(0)} mm up`;
    }
  }
  requestAnimationFrame(frame);
}).catch((e) => { readout.textContent = 'Could not load the STLs: ' + e.message; });
