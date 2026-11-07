/* Clawd crab robot (v2), walking in 3D. Every servo is inside the shell: the legs play the joint-angle tables from
   gait.js (swing servo + Scotch-yoke lift per leg), and the body goes wherever the planted feet push it (Walker),
   so feet on the ground stay on their footprints.
   Units are millimetres. Robot frame: x to its right, y up, z forward (three.js rotation.y = heading). */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GEOM, LEGS, JOINTS, Player, Walker, servoAngle, buildGait, carriageY, rowFootDown } from './gait.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const box3 = $('.viewport');
const CORAL = '#e8735a';
const BG = '#11151b';
const SLOT = [20, 44];

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
camera.position.set(260, 220, 320);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.minDistance = 160;
controls.maxDistance = 900;
controls.maxPolarAngle = Math.PI * 0.49;
controls.target.set(0, 62, 0);

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
  car: new THREE.MeshStandardMaterial({ color: '#a9b2bf', roughness: 0.55 }),
  rod: new THREE.MeshStandardMaterial({ color: '#dfe4ea', roughness: 0.25, metalness: 0.9 }),
  slot: new THREE.MeshStandardMaterial({ color: '#0b0d10', roughness: 0.9 }),
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
const { legX, legZ, leg, legW, crank, yokeY, bodyW, bodyD, shellH, shellBottom } = GEOM;
const robot = new THREE.Group(); scene.add(robot);

// Frame: a base deck just inside the shell's underside and a top deck on the 3 mm guide rods.
const baseY = shellBottom + 3, deckY = 90;
box(6, 3, bodyD - 8, M.frame, -bodyW / 2 + 8, baseY, 0, robot); box(6, 3, bodyD - 8, M.frame, bodyW / 2 - 8, baseY, 0, robot);
box(bodyW - 16, 3, 4, M.frame, 0, baseY, bodyD / 2 - 4, robot); box(bodyW - 16, 3, 4, M.frame, 0, baseY, -bodyD / 2 + 4, robot);
box(44, 2, 84, M.frame, 0, baseY, 0, robot);
box(bodyW - 26, 3, 6, M.frame, 0, deckY, bodyD / 2 - 14, robot); box(bodyW - 26, 3, 6, M.frame, 0, deckY, -bodyD / 2 + 14, robot);
box(6, 3, bodyD - 22, M.frame, bodyW / 2 - 16, deckY, 0, robot); box(6, 3, bodyD - 22, M.frame, -bodyW / 2 + 16, deckY, 0, robot);
box(bodyW - 26, 3, 6, M.frame, 0, deckY, 0, robot);
// Electronics: 2S LiPo low in the middle, ESP32 / PCA9685 / buck converters on the top deck.
box(33, 18, 70, M.cell, 0, baseY + 10, 0, robot);
box(51, 2, 28, M.esp, -6, deckY + 3, -24, robot); box(18, 3.5, 25, M.can, 2, deckY + 5.5, -24, robot);
box(62, 2, 25, M.pca, -6, deckY + 3, 24, robot);
for (let c = 0; c < 8; c++) box(2.5, 8, 7.5, M.esp, -33 + c * 3.8, deckY + 8, 33, robot);
box(21, 7, 43, M.buck, 46, deckY + 5, 0, robot);
box(17, 4, 22, M.buck, -46, deckY + 4, 0, robot);

// Leg modules, one per corner, all inside the shell. X() and Z() mirror a module-local position to its corner.
// Fixed: two guide rods and the lift servo. Moving: the carriage (bushings, the swing servo, the yoke tab with its
// slot) and, hung from the swing servo's horn, the rigid leg.
const legs = LEGS.map((L) => {
  const X = (v) => L.side * v, Z = (v) => L.end * v;
  for (const dz of [-12, 12]) { const r = cyl(1.5, deckY - baseY, M.rod, robot); r.position.set(X(30), (baseY + deckY) / 2, Z(legZ + dz)); }
  box(22.5, 22.8, 12.2, M.servo, X(33.75), yokeY + 5.4, Z(legZ - 26), robot);             // lift servo, shaft inboard
  const horn = new THREE.Group(); horn.position.set(X(21.5), yokeY, Z(legZ - 26)); robot.add(horn);
  box(2, 5, crank + 4, M.horn, 0, 0, Z(crank / 2), horn);
  const pin = cyl(1.5, 6, M.can, horn, 'x'); pin.position.set(X(-3), 0, Z(crank));

  const car = new THREE.Group(); robot.add(car);                                            // the carriage
  box(22.5, 22.8, 12.2, M.servo, X(33.75), 5.4, Z(legZ), car);                              // swing servo, shaft outboard
  box(26, 2.5, 30, M.car, X(32), -7.6, Z(legZ), car);
  for (const dz of [-12, 12]) box(8, 16, 8, M.car, X(30), 0, Z(legZ + dz), car);            // bushings on the rods
  box(2.5, 14, 13, M.car, X(18.25), 0, Z(legZ - 15), car);                                  // yoke tab...
  box(2.7, 3.4, 9, M.slot, X(18.25), 0, Z(legZ - 15), car);                                 // ...and its slot

  const g = new THREE.Group(); g.position.set(X(legX), 0, Z(legZ)); car.add(g);             // the leg, about the swing axis
  const lh = cyl(7, 2, M.horn, g, 'x'); lh.position.set(X(-legW / 2 - 1), 0, 0);
  box(legW, leg + 6, legW, M.leg, 0, (6 - leg) / 2, 0, g);
  box(legW + 0.6, 3, legW + 0.6, M.foot, 0, -leg + 1.5, 0, g);
  return { car, g, horn, end: L.end };
});

// Shell: Clawd. Semi-transparent coral box with square eyes and two stubby side claws (on TPU flexures, so they jiggle).
const shell = new THREE.Group(); robot.add(shell);
const shellY = shellBottom;
function shellBox(w, h, d, x, y, z, parent = shell) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const b = new THREE.Mesh(geo, M.shellBack); b.renderOrder = 1;
  const f = new THREE.Mesh(geo, M.shellFront); f.renderOrder = 2;
  const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), M.edge); e.renderOrder = 3;
  const g = new THREE.Group(); g.add(b, f, e); g.position.set(x, y, z); parent.add(g); return g;
}
shellBox(bodyW, shellH, bodyD, 0, shellY + shellH / 2, 0);
const claws = [-1, 1].map((s) => {
  const pivot = new THREE.Group(); pivot.position.set(s * bodyW / 2, shellY + shellH * 0.5, 6); shell.add(pivot);
  shellBox(22, 24, 30, s * 11, 0, 0, pivot);
  return pivot;
});
for (const x of [-30, 30]) box(11, 22, 2, M.eye, x, shellY + shellH - 28, bodyD / 2 + 1, shell);
box(7, 4, 2, M.eye, 30, shellY + 10, -bodyD / 2 - 1, shell);   // power switch at the back
// The leg slots in the underside: 20 x 44 mm, room for the leg's swing and a little play.
for (const L of LEGS) {
  const [x, z] = L.hip, w = SLOT[0] / 2, d = SLOT[1] / 2;
  const pts = [[x - w, z - d], [x + w, z - d], [x + w, z + d], [x - w, z + d], [x - w, z - d]].map(([a, b]) => new THREE.Vector3(a, shellY - 0.3, b));
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), M.edge); l.renderOrder = 3; shell.add(l);
}

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
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(bodyW + 10, bodyD + 10), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.2, depthWrite: false }));
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
    const s = angles[2 * i] * Math.PI / 180, l = angles[2 * i + 1], L = legs[i];
    L.car.position.y = carriageY(l);            // the Scotch yoke: carriage height = yokeY + crank * sin(lift)
    L.horn.rotation.x = -L.end * l * Math.PI / 180;
    L.g.rotation.x = -s;                        // swing: + = foot forward
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
  for (const joint of JOINTS) {
    const j = 2 * i + (joint === 'lift' ? 1 : 0);
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
const C = { swing: '#3987e5', lift: '#d95926', stance: '#c9d1dc', ink: '#eef2f6', dim: '#a7b1bd', grid: '#2b3440' };
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
    // Footfall: one bar per stretch of keyframes where the foot is on the ground (foot height from FK).
    const isDown = (k) => rowFootDown(g.table[k % n], i) && rowFootDown(g.table[(k + 1) % n], i);
    ctx.fillStyle = C.stance;
    for (let k = 0; k < n; k++) {
      if (!isDown(k) || (k > 0 && isDown(k - 1))) continue;
      let e = k; while (e < n && isDown(e)) e++;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(X(k), y0, X(e) - X(k), foot, 4); else ctx.rect(X(k), y0, X(e) - X(k), foot);
      ctx.fill();
    }
    // Swing and lift servo angles for this leg, 40..140°, as two 2 px lines.
    const a0 = y0 + foot + 4, ah = rowH - foot - 10;
    const Y = (deg) => a0 + ah * (1 - (deg - 40) / 100);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, Y(90)); ctx.lineTo(W - padR, Y(90)); ctx.stroke();
    for (const [j, col] of [[2 * i, C.swing], [2 * i + 1, C.lift]]) {
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
    for (const [lbl, col, yy] of [['swing', C.swing, a0 + 5], ['lift', C.lift, a0 + ah - 3]]) {
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
    `<span><i class="k swing"></i>${L.id} swing ${servoAngle(2 * i, row[2 * i])}° <i class="k lift"></i>lift ${servoAngle(2 * i + 1, row[2 * i + 1])}°${rowFootDown(row, i) ? '' : ' (up)'}</span>`).join('');
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
    const d = 420 * Math.max(1, Math.pow(1.25 / camera.aspect, 0.7));
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

