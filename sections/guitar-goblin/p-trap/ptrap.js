/* Nick's under-sink plumbing, simplified, and how to take the J-bend off.
   Units are roughly inches. x runs left to right as you face the sink, y is up, z comes toward you; the wall is at z = -6.5. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch (e) { $('#nogl').hidden = false; throw e; }
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#11151b');
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 6;
controls.maxDistance = 140;

scene.add(new THREE.HemisphereLight('#f2f5ff', '#3a3127', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(8, 18, 16); scene.add(sun);
const fill = new THREE.DirectionalLight('#bcd2ff', 0.8); fill.position.set(-14, 6, 10); scene.add(fill);

const M = {
  abs: new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.45, metalness: 0.05 }),
  grey: new THREE.MeshStandardMaterial({ color: '#7d858c', roughness: 0.5 }),
  white: new THREE.MeshStandardMaterial({ color: '#eceae4', roughness: 0.6 }),
  wall: new THREE.MeshStandardMaterial({ color: '#d9d5cc', roughness: 0.95 }),
  floor: new THREE.MeshStandardMaterial({ color: '#bdb6aa', roughness: 0.95 }),
  sink: new THREE.MeshStandardMaterial({ color: '#6b5a4a', roughness: 0.8, metalness: 0.2 }),
  counter: new THREE.MeshStandardMaterial({ color: '#c9b48f', roughness: 0.9 }),
  disposal: new THREE.MeshStandardMaterial({ color: '#2b2e33', roughness: 0.6, metalness: 0.2 }),
  steel: new THREE.MeshStandardMaterial({ color: '#cfd6dd', roughness: 0.28, metalness: 0.35, side: THREE.DoubleSide }),
  hose: new THREE.MeshStandardMaterial({ color: '#efece2', roughness: 0.7 }),
  n1: new THREE.MeshStandardMaterial({ color: '#ff8a1f', roughness: 0.4, emissive: '#ff8a1f', emissiveIntensity: 0.25 }),
  n2: new THREE.MeshStandardMaterial({ color: '#29b6ff', roughness: 0.4, emissive: '#29b6ff', emissiveIntensity: 0.25 }),
  washer: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.15 }),
  water: new THREE.MeshStandardMaterial({ color: '#5fb6ff', roughness: 0.1, transparent: true, opacity: 0.7 }),
  gunk: new THREE.MeshStandardMaterial({ color: '#6b4f2a', roughness: 0.9 }),
};

const pickable = [];
const named = [];   // [mesh, name, cssClass] for the Names overlay
function tag(obj, name, cls = '', anchor = null) {
  obj.traverse((o) => { if (o.isMesh) { o.userData.name = name; o.userData.cls = cls; pickable.push(o); } });
  named.push({ obj, name, cls, anchor });
  return obj;
}
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);

function pipe(a, b, r, mat) {
  const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 28), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
  return m;
}
function tube(points, r, mat, segs = 64) {
  const c = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.Mesh(new THREE.TubeGeometry(c, segs, r, 20, false), mat);
}
function nut(pos, mat, r = 1.12, h = 0.95) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), mat));
  for (let i = 0; i < 12; i++) {   // grip ribs so the spin reads
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.16, h * 0.92, 0.16), mat);
    const a = (i / 12) * Math.PI * 2; rib.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); g.add(rib);
  }
  g.position.copy(pos);
  return g;
}

/* ---------- the room ---------- */
const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), M.wall); wall.position.set(-3, 7, -6.5); scene.add(wall);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), M.floor); floor.rotation.x = -Math.PI / 2; floor.position.set(-3, -5.2, 3); scene.add(floor);
const counter = new THREE.Mesh(new THREE.BoxGeometry(36, 1, 15), M.counter); counter.position.set(-3, 21, -0.5); scene.add(counter);

/* ---------- sink and the right-bowl drain ---------- */
const bowlL = tag(new THREE.Mesh(new THREE.BoxGeometry(13, 4.5, 11), M.sink), 'Sink, left bowl'); bowlL.position.set(-12.5, 18.3, -0.5); scene.add(bowlL);
const bowlR = tag(new THREE.Mesh(new THREE.BoxGeometry(13, 4.5, 11), M.sink), 'Sink, right bowl'); bowlR.position.set(6, 18.3, -0.5); scene.add(bowlR);
const strainer = new THREE.Group();
const flange = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.45, 40), M.grey); flange.position.set(6, 15.85, 0); strainer.add(flange);
const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 0.85, 2.7, 36), M.grey); cone.position.set(6, 14.3, 0); strainer.add(cone);
scene.add(tag(strainer, 'Strainer basket (right bowl)'));
scene.add(tag(nut(V(6, 12.55, 0), M.grey, 1.12, 0.9), 'Tailpiece slip nut'));
scene.add(tag(pipe(V(6, 12.9, 0), V(6, 10.2, 0), 0.72, M.abs), 'Tailpiece'));
scene.add(tag(nut(V(6, 10.25, 0), M.white, 1.18, 0.8), 'Slip nut and washer (top of tee)'));

/* sanitary tee, continuous waste, disposal */
const tee = new THREE.Group();
tee.add(pipe(V(6, 9.9, 0), V(6, 5.4, 0), 0.86, M.abs));
tee.add(tube([V(4.4, 7.4, 0), V(5.3, 7.4, 0), V(5.9, 6.9, 0)], 0.84, M.abs, 16));
scene.add(tag(tee, 'Sanitary tee'));
const waste = new THREE.Group();
waste.add(pipe(V(-8.2, 7.4, 0), V(4.6, 7.4, 0), 0.8, M.abs));
waste.add(pipe(V(-6.4, 7.4, 0), V(-5.0, 7.4, 0), 0.92, M.abs));
waste.add(pipe(V(3.2, 7.4, 0), V(4.5, 7.4, 0), 0.92, M.abs));
scene.add(tag(waste, 'Continuous waste pipe'));
const disposal = tag(new THREE.Group(), 'Garbage disposal');
const dBody = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 3.9, 7.5, 40), M.disposal); dBody.position.set(-15.5, 11.6, 0); disposal.add(dBody);
const dTop = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.4, 1.2, 40), M.disposal); dTop.position.set(-15.5, 15.9, 0); disposal.add(dTop);
scene.add(disposal);
const elbow = new THREE.Group();
elbow.add(tube([V(-11.7, 11.2, 0), V(-10.2, 11.2, 0), V(-9.0, 10.2, 0), V(-9.0, 8.6, 0), V(-8.6, 7.6, 0), V(-7.6, 7.4, 0)], 0.78, M.abs, 48));
elbow.add(nut(V(-9.0, 9.4, 0), M.abs, 1.0, 1.0));
scene.add(tag(elbow, 'Disposal discharge elbow'));
const hose = tag(tube([V(-1.5, -2.5, -6.2), V(-2.5, 1.5, -4.8), V(-5.5, 6.5, -3.2), V(-9.5, 11.5, -1.6), V(-11.6, 13.4, -0.4)], 0.42, M.hose, 64), 'Dishwasher hose');
scene.add(hose);

/* below the tee: the extension marked UP, nut 1, the J-bend, nut 2, the trap arm */
scene.add(tag(pipe(V(6, 5.5, 0), V(6, 2.3, 0), 0.74, M.abs), 'Tailpiece extension (marked "UP")'));
const nut1 = tag(nut(V(6, 2.0, 0), M.n1), 'Nut 1: J-bend to the UP pipe', 'n1'); scene.add(nut1);
const nut2 = tag(nut(V(3, 3.1, 0), M.n2), 'Nut 2: J-bend to the wall arm', 'n2'); scene.add(nut2);
scene.add(tag(tube([V(3, 3.4, 0), V(3, 4.6, 0), V(3, 5.35, -0.9), V(3, 5.55, -2.6), V(3, 5.55, -6.3)], 0.78, M.abs, 48), 'Trap arm (to the wall)'));
const stub = new THREE.Group();
stub.add(pipe(V(3, 5.55, -6.5), V(3, 5.55, -5.4), 1.0, M.abs));
const esc = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.15, 32), M.white); esc.rotation.x = Math.PI / 2; esc.position.set(3, 5.55, -6.42); stub.add(esc);
scene.add(tag(stub, 'Drain in the wall'));

class JCurve extends THREE.Curve {   // left leg up at x = -1.5, U at the bottom, right leg up at x = +1.5 (group-local)
  constructor() { super(); this.L1 = 3.1; this.R = 1.5; this.L2 = 2.0; this.tot = this.L1 + Math.PI * this.R + this.L2; }
  getPoint(t, out = new THREE.Vector3()) {
    let s = t * this.tot;
    if (s < this.L1) return out.set(-1.5, 3.1 - s, 0);
    s -= this.L1;
    if (s < Math.PI * this.R) { const a = Math.PI + s / this.R; return out.set(Math.cos(a) * this.R, Math.sin(a) * this.R, 0); }
    s -= Math.PI * this.R;
    return out.set(1.5, s, 0);
  }
}
const jbend = new THREE.Group(); jbend.position.set(4.5, 0, 0);
jbend.add(new THREE.Mesh(new THREE.TubeGeometry(new JCurve(), 80, 0.8, 24, false), M.abs));
tag(jbend, 'J-bend (the trap)');
scene.add(jbend);
const washers = [];
for (const x of [-1.5, 1.5]) {   // slip washers live in the J-bend's two open ends
  const w = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.13, 10, 32), M.washer);
  w.rotation.x = Math.PI / 2; w.position.set(x, x < 0 ? 3.15 : 2.05, 0); w.visible = false; jbend.add(w); washers.push(w);
}
tag(washers[0], 'Slip washer'); tag(washers[1], 'Slip washer');

/* the steel bowl that's already under the trap */
const pts = []; for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * 7, -Math.cos(a) * 2.6)); }
const bucket = tag(new THREE.Mesh(new THREE.LatheGeometry(pts, 48), M.steel), 'Bowl'); bucket.position.set(4.8, -2.55, 1.2); scene.add(bucket);
const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 40), M.water); puddle.rotation.x = -Math.PI / 2; puddle.position.set(4.8, -5.05, 1.2); puddle.visible = false; scene.add(puddle);

/* effects: the turn arrow, the water stream, gunk */
const arrow = new THREE.Group();
const arc = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.09, 8, 48, Math.PI * 1.4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
arc.rotation.x = Math.PI / 2; arrow.add(arc);
const head = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 16), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
// after the x-rotation the arc runs through (cos a, 0, sin a): the way a nut turns when it turns counter-clockwise seen from below
const ea = Math.PI * 1.4; head.position.set(Math.cos(ea) * 1.75, 0, Math.sin(ea) * 1.75);
head.quaternion.setFromUnitVectors(V(0, 1, 0), V(-Math.sin(ea), 0, Math.cos(ea)));
arrow.add(head); arrow.visible = false; scene.add(arrow);
const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1, 12), M.water); stream.visible = false; scene.add(stream);
const gunk = []; for (let i = 0; i < 6; i++) { const g = new THREE.Mesh(new THREE.SphereGeometry(0.28 + Math.random() * 0.15, 10, 8), M.gunk); g.visible = false; scene.add(g); gunk.push(g); }

/* ---------- steps ---------- */
const STEPS = [
  { t: 'Overview', c: 'This is the drain under your right bowl. The J-bend is the U at the bottom; two nuts hold it on.', cam: [[6, 11, 34], [-2, 7, 0]], w: 32 },
  { t: 'Step 1 of 6', c: 'Bowl under the J-bend, and no water, disposal or dishwasher until it’s back on.', cam: [[12, 6, 22], [3, 2, 0]], w: 18 },
  { t: 'Step 2 of 6', c: 'Loosen nut 1 by hand: counter-clockwise as seen from below. It slides up the pipe.', tip: 'Stuck? Grip it gently with channel-lock pliers wrapped in a rag.', cam: [[11, -2, 13], [5.2, 2.4, 0]], w: 9 },
  { t: 'Step 3 of 6', c: 'Loosen nut 2 the same way, counter-clockwise from below. It slides up the arm.', tip: 'Stuck? Grip it gently with channel-lock pliers wrapped in a rag.', cam: [[-3, -1, 13], [3.6, 3.2, 0]], w: 9 },
  { t: 'Step 4 of 6', c: 'Pull the J-bend down and out, tip its water into the bowl, and keep the two slip washers.', cam: [[12, 4, 18], [4.5, 0.5, 1.5]], w: 15 },
  { t: 'Step 5 of 6', c: 'Clean it out: rinse it, or push a brush or bent hanger through to clear the clog.', cam: [[10, 5, 18], [4.5, 2, 4]], w: 12 },
  { t: 'Step 6 of 6', c: 'Put it back: washers bevel-side toward the joint, nuts hand-tight plus a quarter turn, no tools on plastic. Run water and check both nuts for drips.', cam: [[12, 4, 17], [4.5, 3.5, 0]], w: 14 },
];
let step = 0, stepStart = 0, camTween = null;

const ease = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));
const seg = (t, a, b) => ease((t - a) / (b - a));
const lerp = (a, b, k) => a + (b - a) * k;
const LOOSE1 = 2.95, LOOSE2 = 4.05, TURNS = Math.PI * 2 * 2.5;

function pose(s, t) {
  // nut 1
  let k1 = s < 2 ? 0 : s === 2 ? seg(t, 0.05, 0.85) : s < 6 ? 1 : 1 - seg(t, 0.4, 0.75);
  nut1.position.y = lerp(2.0, LOOSE1, k1); nut1.rotation.y = -TURNS * k1;
  // nut 2
  let k2 = s < 3 ? 0 : s === 3 ? seg(t, 0.05, 0.85) : s < 6 ? 1 : 1 - seg(t, 0.4, 0.75);
  nut2.position.y = lerp(3.1, LOOSE2, k2); nut2.rotation.y = -TURNS * k2;
  // turn arrow around whichever nut is moving (counter-clockwise from below = clockwise from above)
  arrow.visible = s === 2 || s === 3;
  if (arrow.visible) { const n = s === 2 ? nut1 : nut2; arrow.position.set(n.position.x, n.position.y - 0.7, 0); arrow.rotation.y = -t * 6; }
  // the J-bend
  jbend.position.set(4.5, 0, 0); jbend.rotation.set(0, 0, 0);
  if (s === 4) {
    const a = seg(t, 0, 0.4), b = seg(t, 0.45, 0.7);
    jbend.position.set(4.5, -1.3 * a - 0.2 * b, 2.6 * a);
    jbend.rotation.z = 1.6 * b;
  } else if (s === 5) {
    jbend.position.set(4.5, 1.6, 4.2); jbend.rotation.set(0.35, t * Math.PI * 2, -0.25);
  } else if (s === 6) {
    const back = 1 - seg(t, 0, 0.35);
    jbend.position.set(4.5, -1.3 * back, 2.6 * back);
  }
  for (const w of washers) { w.visible = s >= 4; w.scale.setScalar(s === 4 ? 1 + 0.25 * Math.sin(t * 20) * seg(t, 0.7, 0.8) : 1); }
  // water pours out of the left leg's open end in step 4
  const pouring = s === 4 && t > 0.62;
  stream.visible = pouring;
  if (pouring) {
    const mouth = new THREE.Vector3(-1.5, 3.1, 0).applyMatrix4(jbend.matrixWorld);
    const bottom = new THREE.Vector3(mouth.x - 0.4, -4.9, mouth.z);
    const len = mouth.distanceTo(bottom) * seg(t, 0.62, 0.72);
    stream.scale.set(1, Math.max(len, 0.01), 1);
    stream.position.set(mouth.x - 0.2, mouth.y - len / 2, mouth.z);
  }
  puddle.visible = s >= 4 && s <= 5 && (s === 5 || t > 0.7);
  const pr = s === 5 ? 1 : seg(t, 0.7, 1); puddle.scale.setScalar(0.6 + 2.6 * pr);
  // gunk flying out while it's cleaned
  gunk.forEach((g, i) => {
    g.visible = s === 5;
    if (g.visible) { const p = (t * 1.6 + i / gunk.length) % 1; g.position.set(4.5 + (i - 2.5) * 0.5, 1.4 - p * 5.2, 4.2 + Math.sin(i) * 0.6); }
  });
  // step 6: once both nuts are snug they turn green: the two joints to check for drips with the water running
  const checking = s === 6 && t > 0.8;
  M.n1.color.set(checking ? '#4ade80' : '#ff8a1f'); M.n1.emissive.set(checking ? '#4ade80' : '#ff8a1f');
  M.n2.color.set(checking ? '#4ade80' : '#29b6ff'); M.n2.emissive.set(checking ? '#4ade80' : '#29b6ff');
  M.n1.emissiveIntensity = M.n2.emissiveIntensity = checking ? 0.35 + 0.25 * Math.sin(t * 25) : 0.25;
  // step 1: the things not to run glow red, the bowl glows
  const warn = s === 1 ? 0.35 + 0.35 * Math.sin(t * 12) : 0;
  M.disposal.emissive.set('#ff2b2b'); M.disposal.emissiveIntensity = warn;
  M.hose.emissive.set('#ff2b2b'); M.hose.emissiveIntensity = warn;
  M.steel.emissive.set('#3d7bff'); M.steel.emissiveIntensity = s === 1 ? 0.15 + 0.15 * Math.sin(t * 8) : 0;
}

function goTo(s) {
  step = Math.max(0, Math.min(STEPS.length - 1, s)); stepStart = performance.now();
  const st = STEPS[step];
  $('#stepno').textContent = st.t; $('#cap').textContent = st.c;
  $('#tip').hidden = !st.tip; if (st.tip) $('#tip').textContent = st.tip;
  $('#back').disabled = step === 0;
  $('#next').textContent = step === 0 ? 'Start' : step === STEPS.length - 1 ? 'Done' : 'Next';
  $('#dots').innerHTML = STEPS.slice(1).map((_, i) => `<i class="${i < step ? 'on' : ''}"></i>`).join('');
  camTween = { from: camera.position.clone(), fromT: controls.target.clone(), to: camFor(st), toT: V(...st.cam[1]), t0: performance.now() };
}
$('#next').addEventListener('click', () => goTo(step === STEPS.length - 1 ? 0 : step + 1));
$('#back').addEventListener('click', () => goTo(step - 1));
$('#replay').addEventListener('click', () => { stepStart = performance.now(); });
controls.addEventListener('start', () => { camTween = null; });

/* ---------- names: tap one, or show them all ---------- */
const labelsEl = $('#labels');
let picked = null, showAll = false;
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(pickable.filter((m) => m.visible), false)[0];
  picked = hit ? { name: hit.object.userData.name, cls: hit.object.userData.cls, point: hit.point.clone(), obj: hit.object } : null;
});
$('#names').addEventListener('click', (e) => { showAll = !showAll; e.currentTarget.setAttribute('aria-pressed', String(showAll)); });

const tmp = new THREE.Vector3(), box = new THREE.Box3();
function drawLabels() {
  const items = [];
  if (showAll) for (const n of named) {
    if (n.name === 'Slip washer' && !washers[0].visible) continue;
    box.setFromObject(n.obj); if (box.isEmpty()) continue;
    box.getCenter(tmp); tmp.y = box.max.y;
    items.push({ name: n.name, cls: n.cls + ' small', p: tmp.clone() });
  }
  if (picked) { const p = picked.obj.parent === jbend || picked.obj === jbend ? new THREE.Box3().setFromObject(picked.obj).getCenter(tmp).clone() : picked.point; items.push({ name: picked.name, cls: picked.cls, p, tapped: true }); }
  const w = canvas.clientWidth, h = canvas.clientHeight, placed = [];
  // most useful first; a label that would cover one already placed is skipped (zoom in to see it)
  const rank = (it) => (it.tapped ? -1 : it.cls.includes('n1') || it.cls.includes('n2') ? 0 : it.name.startsWith('J-bend') ? 1 : it.name.startsWith('Trap arm') ? 2 : 3);
  items.sort((a, b) => rank(a) - rank(b));
  labelsEl.innerHTML = items.map((it) => {
    const v = it.p.clone().project(camera); if (v.z > 1) return '';
    // the two nuts always get their names, short and out to the side: nut 1 to the right, nut 2 to the left
    const side = !it.tapped && it.cls.includes('n1') ? ' side-r' : !it.tapped && it.cls.includes('n2') ? ' side-l' : '';
    const text = side ? it.name.split(':')[0] : it.name;
    const x = ((v.x + 1) / 2) * w, y = ((1 - v.y) / 2) * h, bw = text.length * 6.6 + 16;
    const r = side === ' side-r' ? { l: x + 14, r: x + 14 + bw, t: y - 14, b: y + 14 } : side === ' side-l' ? { l: x - 14 - bw, r: x - 14, t: y - 14, b: y + 14 } : { l: x - bw / 2, r: x + bw / 2, t: y - 34, b: y - 8 };
    if (!it.tapped && !side && placed.some((q) => r.l < q.r && r.r > q.l && r.t < q.b && r.b > q.t)) return '';
    placed.push(r);
    return `<span class="lbl ${it.cls}${side}" style="left:${x}px;top:${y}px">${text}</span>`;
  }).join('');
}

/* ---------- loop ---------- */
// back the camera off until the step's width of the scene fits across the screen, so a narrow phone sees as much as a laptop
function camFor(st) {
  const [p, tg] = st.cam; const off = V(...p).sub(V(...tg)); const d0 = off.length();
  const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  return off.multiplyScalar(Math.max(d0, (st.w / 2) / Math.tan(half) * 1.08) / d0).add(V(...tg));
}
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h;
  // on a phone the step panel covers the bottom, so aim the view a little higher
  camera.setViewOffset(w, h, 0, h > w ? Math.round(h * 0.13) : 0, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
camera.position.copy(camFor(STEPS[0])); controls.target.set(...STEPS[0].cam[1]);
goTo(0);
camTween = null;

const DUR = 3400, HOLD = 1400;
function frame(now) {
  if (camTween) {
    const k = ease((now - camTween.t0) / 900);
    camera.position.lerpVectors(camTween.from, camTween.to, k); controls.target.lerpVectors(camTween.fromT, camTween.toT, k);
    if (k >= 1) camTween = null;
  }
  const t = ((now - stepStart) % (DUR + HOLD)) / DUR;
  jbend.updateMatrixWorld();
  pose(step, Math.min(1, t));
  controls.update();
  renderer.render(scene, camera);
  drawLabels();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__ptrap = { goTo, pose };
