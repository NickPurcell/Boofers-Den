/* Clawd crab robot, walking in 3D. The legs play the joint-angle tables from gait.js through forward kinematics,
   and the body goes wherever the planted feet push it (Walker), so feet on the ground stay on their footprints.
   Units are millimetres. Robot frame: x to its right, y up, z forward (three.js rotation.y = heading). */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GEOM, LEGS, Player, Walker, servoAngle, buildGait } from './gait.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const box3 = $('.viewport');
const CORAL = '#e8735a';
const BG = '#11151b';

let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); }
catch (e) { $('#nogl').hidden = false; }
if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 700, 1500);
const camera = new THREE.PerspectiveCamera(38, 1, 5, 4000);
camera.position.set(250, 210, 300);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 160;
controls.maxDistance = 900;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 70, 0);

scene.add(new THREE.HemisphereLight('#f4f1ff', '#2a2622', 1.7));
const sun = new THREE.DirectionalLight('#ffffff', 2.0); sun.position.set(300, 600, 400); scene.add(sun);
const rim = new THREE.DirectionalLight('#ffd9cc', 0.7); rim.position.set(-400, 200, -300); scene.add(rim);

const M = {
  frame: new THREE.MeshStandardMaterial({ color: '#6b7380', roughness: 0.55, metalness: 0.35 }),
  servo: new THREE.MeshStandardMaterial({ color: '#2f7fe6', roughness: 0.45 }),
  horn: new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.6 }),
  leg: new THREE.MeshStandardMaterial({ color: CORAL, roughness: 0.6 }),
  foot: new THREE.MeshStandardMaterial({ color: '#2a2b2e', roughness: 0.9 }),
  esp: new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.6 }),
  can: new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.3, metalness: 0.8 }),
  pca: new THREE.MeshStandardMaterial({ color: '#5a46a8', roughness: 0.6 }),
  buck: new THREE.MeshStandardMaterial({ color: '#2b6b45', roughness: 0.6 }),
  cell: new THREE.MeshStandardMaterial({ color: '#d7c35a', roughness: 0.5 }),
  holder: new THREE.MeshStandardMaterial({ color: '#1c1d20', roughness: 0.8 }),
  eye: new THREE.MeshStandardMaterial({ color: '#0b0b0d', roughness: 0.4 }),
  shellBack: new THREE.MeshStandardMaterial({ color: CORAL, roughness: 0.5, transparent: true, depthWrite: false, side: THREE.BackSide }),
  shellFront: new THREE.MeshStandardMaterial({ color: CORAL, roughness: 0.4, transparent: true, depthWrite: false, side: THREE.FrontSide }),
  edge: new THREE.LineBasicMaterial({ color: '#ffb7a3', transparent: true, opacity: 0.55 }),
};

function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}
function cyl(r, len, mat, parent, axis = 'y') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 18), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  parent.add(m); return m;
}

/* ---------- the robot ---------- */
const { hipY, coxa, tibia, bodyW, bodyD, shellH } = GEOM;
const robot = new THREE.Group(); scene.add(robot);

// Frame: two decks of 6 mm printed bars on four standoffs. Hip servos hang in the corners of the lower deck.
const lowY = hipY + 22, upY = hipY + 52;
for (const [y, w, d] of [[lowY, 124, 90], [upY, 112, 80]]) {
  box(w, 3, 6, M.frame, 0, y, d / 2 - 3, robot); box(w, 3, 6, M.frame, 0, y, -d / 2 + 3, robot);
  box(6, 3, d, M.frame, w / 2 - 3, y, 0, robot); box(6, 3, d, M.frame, -w / 2 + 3, y, 0, robot);
}
box(124, 3, 6, M.frame, 0, lowY, 14, robot); box(124, 3, 6, M.frame, 0, lowY, -14, robot);
box(6, 3, 80, M.frame, 0, upY, 0, robot);
for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
  const s = cyl(2.5, upY - lowY, M.frame, robot); s.position.set(sx * 50, (lowY + upY) / 2, sz * 37);
}
// Electronics: 2x18650 on the lower deck, PCA9685 and ESP32 on the upper deck, buck converter beside the cells.
box(72, 3, 42, M.holder, 0, lowY + 3, 0, robot);
for (const z of [-10, 10]) { const c = cyl(9.2, 65, M.cell, robot, 'x'); c.position.set(0, lowY + 13.7, z); }
box(22, 7, 34, M.buck, -54 + 13, upY - 6, 0, robot);
box(62, 2, 25, M.pca, 0, upY + 3, 22, robot);
for (let c = 0; c < 8; c++) box(2.5, 9, 7.5, M.esp, -27 + c * 2.54 * 1.5, upY + 8, 22 + 9, robot);
box(51, 2, 28, M.esp, 0, upY + 3, -20, robot);
box(18, 3.5, 25, M.can, 8, upY + 5.5, -20, robot);

// Servos, legs. Leg group origin = hip axis at hip height; local +x points out along the coxa, so
// rotation.y = yaw from fk(); the knee group rotates about local z (knee angle, + = foot outward).
const legs = LEGS.map((L, i) => {
  const hs = box(12.2, 23, 22.8, M.servo, L.hip[0], hipY + 17.5, L.hip[1] - Math.sign(L.hip[1]) * 5.4, robot);
  hs.name = 'hip servo';
  const g = new THREE.Group(); g.position.set(L.hip[0], hipY, L.hip[1]); robot.add(g);
  const horn = cyl(7, 2.5, M.horn, g); horn.position.set(0, 5.5, 0);
  box(coxa - 4, 9, 12, M.leg, (coxa - 4) / 2, 0, 0, g);                         // coxa bracket
  box(12.2, 22.8, 23, M.servo, coxa, 0, 0, g);                                  // knee servo, shaft along local z
  const knee = new THREE.Group(); knee.position.set(coxa, 0, 0); g.add(knee);
  const kh = cyl(6, 2, M.horn, knee, 'z'); kh.position.set(0, 0, 13);
  for (const z of [-13.5, 13.5]) box(9, 22, 2.5, M.leg, 0, -6, z, knee);         // U-bracket round the servo
  box(9, 3, 29.5, M.leg, 0, -17.5, 0, knee);
  box(9, tibia - 24, 9, M.leg, 0, -19 - (tibia - 24) / 2 + 2, 0, knee);          // tibia
  box(12, 6, 12, M.foot, 0, -tibia + 3, 0, knee);                                // rubber foot; its sole is the foot point
  return { g, knee, side: L.side };
});

// Shell: Clawd. Semi-transparent coral box with square eyes and two stubby side claws (on TPU flexures, so they jiggle).
const shell = new THREE.Group(); robot.add(shell);
const shellY = hipY + 7;
function shellBox(w, h, d, x, y, z, parent = shell) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const b = new THREE.Mesh(geo, M.shellBack); b.renderOrder = 1;
  const f = new THREE.Mesh(geo, M.shellFront); f.renderOrder = 2;
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), M.edge); e.renderOrder = 3;
  const g = new THREE.Group(); g.add(b, f, e); g.position.set(x, y, z); parent.add(g); return g;
}
shellBox(bodyW, shellH, bodyD, 0, shellY + shellH / 2, 0);
const claws = [-1, 1].map((s) => {
  const pivot = new THREE.Group(); pivot.position.set(s * bodyW / 2, shellY + shellH * 0.48, 4); shell.add(pivot);
  shellBox(20, 22, 26, s * 10, 0, 0, pivot);
  return pivot;
});
for (const x of [-27, 27]) box(10, 18, 2, M.eye, x, shellY + shellH - 24, bodyD / 2 + 1, shell);
box(7, 4, 2, M.eye, 26, shellY + 8, -bodyD / 2 - 1, shell);   // power switch at the back

function setShellOpacity(o) {
  M.shellFront.opacity = o; M.shellBack.opacity = o * 0.55;
  const solid = o >= 0.99;
  M.shellFront.transparent = M.shellBack.transparent = !solid;
  M.shellFront.depthWrite = solid;
  M.shellBack.visible = !solid && o > 0;
  M.shellFront.visible = o > 0;
  M.edge.opacity = 0.25 + 0.45 * (1 - o);
  M.shellFront.needsUpdate = M.shellBack.needsUpdate = true;
}

/* ---------- ground, footprints, support polygon ---------- */
const ground = new THREE.Group(); scene.add(ground);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshBasicMaterial({ color: '#1a2029' }));
floor.rotation.x = -Math.PI / 2; ground.add(floor);
const grid = new THREE.GridHelper(3000, 60, '#5d6b80', '#3a4556'); grid.position.y = 0.2; ground.add(grid);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(bodyW + 20, bodyD + 20), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.2, depthWrite: false }));
shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.4; robot.add(shadow);

const PRINTS = 28;
const printGeo = new THREE.PlaneGeometry(13, 13);
const prints = Array.from({ length: PRINTS }, () => {
  const m = new THREE.Mesh(printGeo, new THREE.MeshBasicMaterial({ color: CORAL, transparent: true, opacity: 0, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.6; m.visible = false; scene.add(m); return m;
});
let printIx = 0;

const polyGeo = new THREE.BufferGeometry();
polyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
const poly = new THREE.Line(polyGeo, new THREE.LineBasicMaterial({ color: '#f1f4f8', transparent: true, opacity: 0.75 }));
scene.add(poly);
const com = new THREE.Mesh(new THREE.RingGeometry(3.5, 6, 20), new THREE.MeshBasicMaterial({ color: '#f1f4f8', side: THREE.DoubleSide }));
com.rotation.x = -Math.PI / 2; com.position.y = 0.8; scene.add(com);

/* ---------- walking ---------- */
const player = new Player('creep');
const walker = new Walker();
walker.onTouchdown = (i, [x, z]) => {
  const p = prints[printIx++ % PRINTS];
  p.position.x = x; p.position.z = z; p.visible = true; p.userData.born = clock;
  p.rotation.z = walker.th;
};
let clock = 0, playing = true, speed = 1, turnTarget = 0;
let angles = player.angles;
walker.update(angles);

function placeLegs() {
  for (let i = 0; i < 4; i++) {
    const h = angles[2 * i], k = angles[2 * i + 1], L = legs[i];
    L.g.rotation.y = (L.side > 0 ? 0 : Math.PI) + (L.side > 0 ? -h : h) * Math.PI / 180;
    L.knee.rotation.z = k * Math.PI / 180;
  }
  robot.position.set(walker.x, 0, walker.z);
  robot.rotation.y = walker.th;
}

const RING = [0, 1, 3, 2];   // LF, RF, RH, LH: round the body
let margin = null;
function placeGroundMarks() {
  const pos = polyGeo.attributes.position.array;
  const pts = RING.filter((i) => walker.pins[i]).map((i) => walker.pins[i]);
  const n = pts.length;
  for (let j = 0; j <= n; j++) { const p = pts[j % n] || [0, 0]; pos.set([p[0], 0.7, p[1]], j * 3); }
  polyGeo.setDrawRange(0, n > 2 ? n + 1 : n);
  polyGeo.attributes.position.needsUpdate = true;
  const c = walker.toWorld([0, 0, 0]);
  com.position.x = c[0]; com.position.z = c[1];
  // Static stability margin: distance from the centre of mass to the nearest edge of the support triangle/quad.
  margin = null;
  if (n >= 3) {
    let m = Infinity, sgn = 0;
    for (let j = 0; j < n; j++) {
      const a = pts[j], b = pts[(j + 1) % n];
      const ex = b[0] - a[0], ez = b[1] - a[1], len = Math.hypot(ex, ez);
      const cr = (ex * (c[1] - a[1]) - ez * (c[0] - a[0])) / len;
      if (!sgn) sgn = Math.sign(cr) || 1;
      m = Math.min(m, cr * sgn);
    }
    margin = m;
  }
  for (const p of prints) {
    if (!p.visible) continue;
    const age = clock - p.userData.born;
    p.material.opacity = Math.max(0, 0.55 - age / 14000);
    if (p.material.opacity <= 0) p.visible = false;
  }
  // Keep the grid under the robot (it is 3 m wide; snap to its 50 mm squares so it doesn't visibly slide).
  ground.position.set(Math.round(walker.x / 50) * 50, 0, Math.round(walker.z / 50) * 50);
}

function tick(ms) {
  // Ease the steering command; Player hands it to each leg only while that leg is in the air.
  const dTurn = turnTarget - player.turn;
  player.turn += Math.sign(dTurn) * Math.min(Math.abs(dTurn), ms / 600);
  angles = player.step(ms);
  walker.update(angles);
}

/* ---------- UI ---------- */
const servoEls = [];
const servoBox = $('#servos');
for (let i = 0; i < 4; i++) {
  for (const joint of ['hip', 'knee']) {
    const j = 2 * i + (joint === 'knee' ? 1 : 0);
    const el = document.createElement('div');
    el.className = 'srv ' + joint;
    el.innerHTML = `<span class="ch">ch${j}</span><span class="nm">${LEGS[i].id} ${joint}</span><b>90°</b><i class="dial"><u></u></i>`;
    servoBox.appendChild(el);
    servoEls.push({ val: el.querySelector('b'), needle: el.querySelector('u'), last: null });
  }
}
function updateReadout() {
  for (let j = 0; j < 8; j++) {
    const a = Math.round(servoAngle(j, angles[j])), e = servoEls[j];
    if (a === e.last) continue;
    e.last = a; e.val.textContent = a + '°';
    e.needle.style.transform = `rotate(${a - 90}deg)`;
  }
  const down = walker.pins.filter(Boolean).length;
  $('#hud-gait').textContent = player.changing ? 'Re-planting feet…' : player.gait.label;
  $('#hud-down').textContent = `${down} feet down`;
  $('#hud-margin').textContent = margin != null ? `balance margin ${margin.toFixed(0)} mm` : down === 2 ? 'balanced by timing' : '';
  $('#hud-slip').textContent = `foot scuff ${walker.slip.toFixed(1)} mm`;
  $('#hud-speed').textContent = !playing ? 'paused' : speedEst ? `${speedEst.toFixed(0)} mm/s` : '';
  if (!player.queue) document.dispatchEvent(new CustomEvent('clawd:frame', { detail: { gait: player.gait.key, k: Math.floor(player.f) } }));
}

const playBtn = $('#play');
playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  playBtn.setAttribute('aria-pressed', String(!playing));
});
document.querySelectorAll('[data-gait]').forEach((b) => b.addEventListener('click', () => {
  player.setGait(b.dataset.gait);
  document.querySelectorAll('[data-gait]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('#gait-blurb').textContent = buildGait(b.dataset.gait).blurb;
  drawCharts();
}));
document.querySelectorAll('[data-turn]').forEach((b) => b.addEventListener('click', () => {
  turnTarget = Number(b.dataset.turn) * 0.6;
  document.querySelectorAll('[data-turn]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
}));
const speedIn = $('#speed'), speedOut = $('#speed-v');
speedIn.addEventListener('input', () => { speed = Number(speedIn.value); speedOut.textContent = speed + '×'; });
const opIn = $('#opacity'), opOut = $('#opacity-v');
opIn.addEventListener('input', () => { setShellOpacity(opIn.value / 100); opOut.textContent = opIn.value + '%'; });
setShellOpacity(opIn.value / 100);
$('#gait-blurb').textContent = player.gait.blurb;

/* ---------- charts: footfall pattern and servo angles over one cycle (canvas 2D) ---------- */
const chart = $('#timeline');
const chartTip = $('#timeline-tip');
const C = { hip: '#3987e5', knee: '#d95926', stance: '#c9d1dc', ink: '#eef2f6', dim: '#a7b1bd', grid: '#2b3440' };
let hoverF = null;
function chartGait() { return player.next ? buildGait(player.next) : player.gait; }
function drawCharts() {
  const g = chartGait();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = chart.clientWidth, rowH = 58, foot = 14, top = 6, padL = 64, padR = 12;
  const H = top + 4 * rowH + 22;
  if (chart.width !== Math.round(W * dpr) || chart.height !== Math.round(H * dpr)) {
    chart.width = Math.round(W * dpr); chart.height = Math.round(H * dpr); chart.style.height = H + 'px';
  }
  const ctx = chart.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const plotW = W - padL - padR, n = g.frames;
  const X = (f) => padL + (f / n) * plotW;
  ctx.font = '600 12px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    const y0 = top + i * rowH;
    ctx.fillStyle = C.ink; ctx.textAlign = 'left';
    ctx.fillText(LEGS[i].id, 4, y0 + foot / 2 + 1);
    // Footfall: one bar per stretch of keyframes where the foot is on the ground (knee at its stance angle).
    const isDown = (k) => g.table[k % n][2 * i + 1] === GEOM.stanceKnee && g.table[(k + 1) % n][2 * i + 1] === GEOM.stanceKnee;
    ctx.fillStyle = C.stance;
    for (let k = 0; k < n; k++) {
      if (!isDown(k) || (k > 0 && isDown(k - 1))) continue;
      let e = k; while (e < n && isDown(e)) e++;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(X(k), y0, X(e) - X(k), foot, 4); else ctx.rect(X(k), y0, X(e) - X(k), foot);
      ctx.fill();
    }
    // Hip and knee servo angles for this leg, 45..135°, as two 2 px lines.
    const a0 = y0 + foot + 4, ah = rowH - foot - 10;
    const Y = (deg) => a0 + ah * (1 - (deg - 45) / 90);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(90)); ctx.lineTo(W - padR, Y(90)); ctx.stroke();
    for (const [j, col] of [[2 * i, C.hip], [2 * i + 1, C.knee]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = ctx.lineCap = 'round';
      ctx.beginPath();
      for (let k = 0; k <= n; k++) {
        const v = servoAngle(j, g.table[k % n][j]);
        k ? ctx.lineTo(X(k), Y(v)) : ctx.moveTo(X(k), Y(v));
      }
      ctx.stroke();
    }
    // direct labels with a short line key, text in ink
    ctx.font = '11px system-ui, sans-serif';
    for (const [lbl, col, yy] of [['hip', C.hip, a0 + 5], ['knee', C.knee, a0 + ah - 3]]) {
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(6, yy); ctx.lineTo(16, yy); ctx.stroke();
      ctx.fillStyle = C.dim; ctx.fillText(lbl, 20, yy);
    }
    ctx.font = '600 12px system-ui, sans-serif';
  }
  // x axis: keyframes
  ctx.fillStyle = C.dim; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center';
  const yA = top + 4 * rowH + 10;
  const every = n > 8 ? 4 : 2;
  for (let k = 0; k <= n; k += every) { ctx.textAlign = k === n ? 'right' : 'center'; ctx.fillText(String(k), X(k) + (k === n ? 4 : 0), yA); }
  ctx.textAlign = 'left'; ctx.fillText('frame', 4, yA);
  // playhead (and the hover crosshair)
  const f = player.queue ? null : player.f;
  for (const [ff, col, w] of [[f, C.ink, 2], [hoverF, C.dim, 1]]) {
    if (ff == null || (ff === f && g !== player.gait)) continue;
    ctx.strokeStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(X(ff), top - 4); ctx.lineTo(X(ff), top + 4 * rowH - 4); ctx.stroke();
  }
  chart.dataset.padL = padL; chart.dataset.plotW = plotW;
}
function hover(e) {
  const r = chart.getBoundingClientRect(), g = chartGait();
  const padL = +chart.dataset.padL, plotW = +chart.dataset.plotW;
  const x = e.clientX - r.left;
  if (x < padL || x > padL + plotW) { leave(); return; }
  const k = Math.round(((x - padL) / plotW) * g.frames) % g.frames;
  hoverF = k;
  const row = g.table[k];
  chartTip.innerHTML = `<b>Frame ${k}</b>` + LEGS.map((L, i) =>
    `<span><i class="k hip"></i>${L.id} hip ${servoAngle(2 * i, row[2 * i])}° <i class="k knee"></i>knee ${servoAngle(2 * i + 1, row[2 * i + 1])}°${row[2 * i + 1] === GEOM.stanceKnee ? '' : ' (up)'}</span>`).join('');
  chartTip.hidden = false;
  const tx = Math.min(Math.max(x + 12, 0), r.width - chartTip.offsetWidth);
  chartTip.style.left = tx + 'px';
  drawCharts();
}
function leave() { hoverF = null; chartTip.hidden = true; drawCharts(); }
chart.addEventListener('pointermove', hover);
chart.addEventListener('pointerdown', hover);
chart.addEventListener('pointerleave', leave);

/* ---------- loop ---------- */
let framed = false;
function resize() {
  const w = box3.clientWidth, h = box3.clientHeight;
  if (renderer) renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (!framed && w > 0) {   // first fit: back off on narrow (phone) screens so the whole robot is in view
    framed = true;
    const d = 440 * Math.max(1, Math.pow(1.25 / camera.aspect, 0.85));
    camera.position.copy(controls.target).add(new THREE.Vector3(0.52, 0.42, 0.74).normalize().multiplyScalar(d));
  }
  drawCharts();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(box3);
resize();

let last = performance.now(), uiT = 0, speedEst = 0, distT = 0;
let lastX = walker.x, lastZ = walker.z;
const sampleXZ = [walker.x, walker.z];
const visible = { on: true };
new IntersectionObserver(([e]) => { visible.on = e.isIntersecting; }).observe(box3);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
if (reduced.matches) { playing = false; playBtn.textContent = 'Play'; playBtn.setAttribute('aria-pressed', 'true'); }

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(now - last, 100); last = now;
  if (!visible.on) return;
  if (playing) {
    let ms = dt * speed;
    clock += ms;
    while (ms > 0) { const s = Math.min(ms, 12); tick(s); ms -= s; }   // small steps keep the foot fit tight on slow phones
    distT += dt;
    if (distT > player.gait.frames * player.gait.frameMs / speed) {   // average over a whole cycle (creep sways)
      speedEst = Math.hypot(walker.x - sampleXZ[0], walker.z - sampleXZ[1]) / (distT / 1000);
      sampleXZ[0] = walker.x; sampleXZ[1] = walker.z; distT = 0;
    }
    const sw = Math.sin(clock / 260);
    claws[0].rotation.y = sw * 0.09; claws[1].rotation.y = -sw * 0.09;
    claws[0].rotation.z = claws[1].rotation.z = Math.sin(clock / 170) * 0.03;
  }
  placeLegs();
  placeGroundMarks();
  // Camera follows the robot; you orbit around it.
  const dx = walker.x - lastX, dz = walker.z - lastZ; lastX = walker.x; lastZ = walker.z;
  camera.position.x += dx; camera.position.z += dz; controls.target.x += dx; controls.target.z += dz;
  controls.update();
  if (renderer) renderer.render(scene, camera);
  uiT += dt;
  if (uiT > 66) { uiT = 0; updateReadout(); drawCharts(); }
}
requestAnimationFrame(frame);

