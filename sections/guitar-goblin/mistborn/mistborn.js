/* Steelpush and Ironpull, physics first.

   A push or pull is an actuator between your chest and a piece of metal. Every physics step it
   applies equal and opposite impulses along the line between the two, up to a maximum force,
   until they are separating (push) or closing (pull) at a capped speed. Nothing here decides who
   moves: Rapier does. Free in the room, you are lighter and less anchored than a 150 kg knight in
   armour standing on stone, so you go. With a wall at your back or a barrier in front of you, the
   contact takes your half of the impulse and the knight goes instead. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import RAPIER from '../vendor/rapier/rapier.mjs';

const $ = (s) => document.querySelector(s);
const DT = 1 / 60;
const P = { mass: 70, r: 0.35, hh: 0.55, eye: 1.65, chest: 1.3 };   // heights from the feet
const K = { mass: 150, r: 0.42, hh: 0.53, chest: 1.25 };
const ALLO = { force: 2600, flare: 2, speed: 10, flareSpeed: 16, coinSpeed: 45, range: 30 };
const WALK = { speed: 5.2, accel: 14, air: 3, brake: 10, jump: 5.4 };
const HALF = 15, WALL_H = 8;
const BARRIERS = [   // chest high: 1.2 m
  { x: -6, z: 0, hx: 1.6, hz: 0.3 }, { x: 6.5, z: 3, hx: 1.6, hz: 0.3 }, { x: 0, z: 9.5, hx: 2, hz: 0.3 },
  { x: -10, z: 8, hx: 0.3, hz: 1.6 }, { x: 10, z: -8, hx: 0.3, hz: 1.8 }, { x: 4.5, z: -9, hx: 1.6, hz: 0.3 },
];
const PLATES = [[-3, -3], [8, -2.5]];
const RINGS = [[-6, 3, HALF, 'n'], [6, 3, HALF, 'n'], [HALF, 3, 0, 'e'], [-HALF, 2.6, -6, 'w']];
const SCENES = {
  start:    { player: [0, -7], knight: [0, 2] },
  free:     { player: [0, -5], knight: [0, 0], caption: 'Steelpush, nothing behind you: you are the lighter one, so you fly back.' },
  wall:     { player: [0, -HALF + P.r + 0.02], knight: [0, -11], caption: 'Steelpush with your back to the wall: the wall takes it, so the knight flies.' },
  pullFree: { player: [0, -6], knight: [0, 0], caption: 'Ironpull, nothing to brace on: you get yanked to him.' },
  braced:   { player: [-6, -0.3 - P.r - 0.02], knight: [-6, 5], caption: 'Ironpull, braced on a chest-high barrier: he gets dragged to you.' },
};

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
world.timestep = DT;

/* ---------- three ---------- */
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: new URLSearchParams(location.search).has('test') });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1e26);
scene.fog = new THREE.FogExp2(0x262b36, 0.028);
const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
camera.rotation.order = 'YXZ';
scene.add(new THREE.HemisphereLight(0x8d97ad, 0x2a2420, 1.3));
const sun = new THREE.DirectionalLight(0xffe2c4, 1.6);
sun.position.set(-9, 18, -6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 50 });
scene.add(sun);

function tex(draw, w = 256, h = 256, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
const noise = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); } };
const floorTex = tex((g, w, h) => {
  g.fillStyle = '#4a4740'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = `hsl(36,6%,${25 + Math.random() * 6}%)`; g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60); }
  noise(g, w, h, 2500, 0.18);
}, 256, 256, [HALF / 2, HALF / 2]);
const wallTex = tex((g, w, h) => {
  g.fillStyle = '#2b2d33'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { g.fillStyle = `hsl(220,6%,${17 + Math.random() * 5}%)`; g.fillRect(x * 64 + (y % 2) * 32 + 2, y * 32 + 2, 60, 28); }
  noise(g, w, h, 2000, 0.15);
}, 256, 256, [8, 2]);
const stoneTex = tex((g, w, h) => {
  g.fillStyle = '#5d584f'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) { g.fillStyle = `hsl(35,7%,${33 + Math.random() * 7}%)`; g.fillRect(x * 128 + (y % 2) * 64 + 2, y * 64 + 2, 124, 60); }
  noise(g, w, h, 1500, 0.2);
});
const MAT = {
  floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }),
  wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }),
  stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.9 }),
  iron: new THREE.MeshStandardMaterial({ color: 0x8a919c, metalness: 0.85, roughness: 0.35 }),
  coin: new THREE.MeshStandardMaterial({ color: 0xc9a45a, metalness: 0.9, roughness: 0.3 }),
};

/* A box that is both a mesh and a fixed collider. */
function block(cx, cy, cz, hx, hy, hz, mat, friction = 0.3) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), mat);
  m.position.set(cx, cy, cz); m.castShadow = m.receiveShadow = true; scene.add(m);
  if (mat.map) { const uv = m.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(hx, hz) / 2, uv.getY(i) * hy / 1.5); }
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setFriction(friction));
  return m;
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), MAT.floor);
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
world.createCollider(RAPIER.ColliderDesc.cuboid(HALF + 1, 0.5, HALF + 1).setTranslation(0, -0.5, 0).setFriction(1));
for (const [x, z, hx, hz] of [[0, HALF + 0.5, HALF + 1, 0.5], [0, -HALF - 0.5, HALF + 1, 0.5], [HALF + 0.5, 0, 0.5, HALF], [-HALF - 0.5, 0, 0.5, HALF]]) block(x, WALL_H / 2, z, hx, WALL_H / 2, hz, MAT.wall);
world.createCollider(RAPIER.ColliderDesc.cuboid(HALF + 1, 0.5, HALF + 1).setTranslation(0, WALL_H + 0.5, 0));   // an unseen lid: coin jumps stay in the room
for (const b of BARRIERS) {
  block(b.x, 0.6, b.z, b.hx, 0.6, b.hz, MAT.stone);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(b.hx * 2 + 0.12, 0.08, b.hz * 2 + 0.12), MAT.stone);
  cap.position.set(b.x, 1.22, b.z); cap.castShadow = cap.receiveShadow = true; scene.add(cap);
}

/* ---------- metal ---------- */
const metals = [];
for (const [x, z] of PLATES) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 1), MAT.iron);
  m.position.set(x, 0.02, z); m.receiveShadow = true; scene.add(m);
  const rivets = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 24), MAT.iron);
  rivets.rotation.x = Math.PI / 2; rivets.position.set(x, 0.045, z); scene.add(rivets);
  metals.push({ kind: 'anchor', name: 'Iron floor plate', at: new THREE.Vector3(x, 0.04, z) });
}
for (const [x, y, z, face] of RINGS) {
  const off = { n: [0, 0, -0.12], e: [-0.12, 0, 0], w: [0.12, 0, 0] }[face];
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 28), MAT.iron);
  ring.position.set(x + off[0], y, z + off[2]); if (face !== 'n') ring.rotation.y = Math.PI / 2;
  ring.castShadow = true; scene.add(ring);
  metals.push({ kind: 'anchor', name: 'Iron ring in the wall', at: ring.position.clone() });
}

const player = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().lockRotations().setCanSleep(false).setCcdEnabled(true));
world.createCollider(RAPIER.ColliderDesc.capsule(P.hh, P.r).setMass(P.mass).setFriction(0)
  .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), player);
const knightBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().lockRotations().setCanSleep(false).setCcdEnabled(true));
world.createCollider(RAPIER.ColliderDesc.capsule(K.hh, K.r).setMass(K.mass).setFriction(1), knightBody);
const knight = {
  kind: 'knight', name: 'Knight, 150 kg in armour', body: knightBody, mass: K.mass,
  get at() { const t = knightBody.translation(); return new THREE.Vector3(t.x, t.y - K.hh - K.r + K.chest, t.z); },
};
metals.push(knight);

const knightRoot = new THREE.Group(); scene.add(knightRoot);
let mixer = null, clips = {}, current = null;
const fallback = new THREE.Mesh(new THREE.CapsuleGeometry(K.r, K.hh * 2, 6, 14), MAT.iron);
fallback.position.y = K.hh + K.r; fallback.castShadow = true; knightRoot.add(fallback);
new GLTFLoader().load('knight.glb', (gltf) => {
  const model = gltf.scene;
  const drop = new Set(['1H_Sword_Offhand', 'Badge_Shield', 'Round_Shield', 'Spike_Shield', '2H_Sword']);
  model.traverse((o) => { if (drop.has(o.name)) o.visible = false; if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const box = new THREE.Box3().setFromObject(model);
  model.scale.setScalar((2 * (K.hh + K.r)) / (box.max.y - box.min.y));
  model.position.y = -box.min.y * model.scale.y;
  knightRoot.remove(fallback); knightRoot.add(model);
  mixer = new THREE.AnimationMixer(model);
  for (const c of gltf.animations) clips[c.name] = mixer.clipAction(c);
  play('Idle');
});
function play(name) {
  const a = clips[name]; if (!a || a === current) return;
  a.reset().fadeIn(0.25).play(); if (current) current.fadeOut(0.25); current = a;
}

const coins = [];
const coinGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.006, 14);
function tossCoin() {
  if (coins.length >= 16) removeCoin(coins[0]);
  const f = forward(), at = camera.position.clone().addScaledVector(f, 0.5).add(new THREE.Vector3(0, -0.15, 0));
  const v = player.linvel();
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setCcdEnabled(true)
    .setLinvel(v.x + f.x * 7, v.y + f.y * 7 + 1.5, v.z + f.z * 7));
  const collider = world.createCollider(RAPIER.ColliderDesc.cylinder(0.004, 0.03).setMass(0.012).setFriction(0.6), body);
  const mesh = new THREE.Mesh(coinGeo, MAT.coin); mesh.castShadow = true; scene.add(mesh);
  const coin = { kind: 'coin', name: 'Coin', body, collider, mesh, mass: 0.012, get at() { return new THREE.Vector3().copy(body.translation()); } };
  coins.push(coin); metals.push(coin);
}
function removeCoin(c) {
  world.removeRigidBody(c.body); scene.remove(c.mesh);
  coins.splice(coins.indexOf(c), 1); metals.splice(metals.indexOf(c), 1);
  if (active && active.target === c) active = null;
}
/* A coin pressed against the floor or a wall cannot move, so the push goes into the world. */
function pinned(m) {
  if (!m.body) return true;
  if (m.kind !== 'coin') return false;
  let hit = false;
  world.contactPairsWith(m.collider, (other) => {
    const body = other.parent();
    if (hit || (body && !body.isFixed())) return;
    world.contactPair(m.collider, other, (manifold) => { if (manifold.numContacts() > 0) hit = true; });
  });
  return hit;
}

/* ---------- input and the player ---------- */
const keys = new Set();
let yaw = Math.PI, pitch = 0, jump = false, flare = false, active = null, aimed = null, scripted = null;
const forward = () => new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
const chest = () => { const t = player.translation(); return new THREE.Vector3(t.x, t.y - P.hh - P.r + P.chest, t.z); };

function grounded() {
  const t = player.translation();
  const hit = world.castRay(new RAPIER.Ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: -1, z: 0 }), P.hh + P.r + 0.08, true, undefined, undefined, undefined, player);
  return !!hit;
}

function walk() {
  const v = player.linvel(), onGround = grounded();
  let fw = 0, rt = 0;
  if (!scripted) { fw = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0); rt = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0); }
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  let wx = fx * fw + rx * rt, wz = fz * fw + rz * rt;
  const len = Math.hypot(wx, wz), moving = len > 0;
  if (moving) { wx = (wx / len) * WALK.speed; wz = (wz / len) * WALK.speed; }
  const dvx = wx - v.x, dvz = wz - v.z, dv = Math.hypot(dvx, dvz);
  // Feet on stone: walking accelerates you, standing still brakes you; neither stops a push.
  const cap = (onGround ? (moving ? WALK.accel : WALK.brake) : moving ? WALK.air : 0) * DT;
  if (dv > 1e-6 && cap > 0) { const s = Math.min(1, cap / dv); player.applyImpulse({ x: dvx * s * P.mass, y: 0, z: dvz * s * P.mass }, true); }
  if (jump && onGround && v.y < 1) player.applyImpulse({ x: 0, y: (WALK.jump - v.y) * P.mass, z: 0 }, true);
  jump = false;
}

/* The actuator. mode +1 pushes the metal away, -1 pulls it in. */
const hud = { force: 0 };
function allomancy() {
  hud.force = 0;
  if (!active) return;
  const m = active.target, from = chest(), to = m.at;
  const n = to.clone().sub(from); const d = n.length();
  if (d > ALLO.range || d < 0.05) return;
  n.divideScalar(d);
  const fall = d <= 4 ? 1 : Math.max(0.25, 1 - (d - 4) / 26);
  const fl = active.flare;
  const fmax = ALLO.force * (fl ? ALLO.flare : 1) * fall;
  const fixed = pinned(m);
  const cap = m.kind === 'coin' && !fixed ? ALLO.coinSpeed : fl ? ALLO.flareSpeed : ALLO.speed;
  const vp = player.linvel(), vm = fixed ? { x: 0, y: 0, z: 0 } : m.body.linvel();
  const sep = active.mode * ((vm.x - vp.x) * n.x + (vm.y - vp.y) * n.y + (vm.z - vp.z) * n.z);
  const invMass = 1 / P.mass + (fixed ? 0 : 1 / m.mass);
  const j = Math.max(0, Math.min((cap - sep) / invMass, fmax * DT));
  if (j <= 0) return;
  const s = active.mode * j;
  if (!fixed) m.body.applyImpulse({ x: n.x * s, y: n.y * s, z: n.z * s }, true);
  player.applyImpulse({ x: -n.x * s, y: -n.y * s, z: -n.z * s }, true);
  hud.force = j / DT;
}

function stepPhysics() {
  walk();
  allomancy();
  world.step();
  for (const c of coins) {   // tunnelling guard; real coins do not exceed this either
    const v = c.body.linvel(), sp = Math.hypot(v.x, v.y, v.z);
    if (sp > 60) c.body.setLinvel({ x: (v.x / sp) * 60, y: (v.y / sp) * 60, z: (v.z / sp) * 60 }, true);
  }
}

function place(body, [x, z], hh, r) {
  body.setTranslation({ x, y: hh + r + 0.001, z }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
}
function setup(name) {
  const s = SCENES[name] || SCENES.start;
  while (coins.length) removeCoin(coins[0]);
  place(player, s.player, P.hh, P.r); place(knightBody, s.knight, K.hh, K.r);
  active = null; aimAt(knight.at);
  return s;
}
function aimAt(p) {
  const e = chest(); e.y += P.eye - P.chest;
  const dx = p.x - e.x, dy = p.y - e.y, dz = p.z - e.z;
  yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

/* ---------- targeting and the blue lines ---------- */
function pick() {
  const eye = camera.position, f = forward();
  let best = null, score = 1;
  for (const m of metals) {
    const d = m.at.clone().sub(eye); const dist = d.length(); if (dist > ALLO.range || dist < 0.2) continue;
    const ang = Math.acos(Math.min(1, d.dot(f) / dist));
    const r = ang / Math.min(0.3, Math.max(0.07, Math.atan(0.7 / dist)));
    if (r < score) { score = r; best = m; }
  }
  return best;
}
const lineGeo = new THREE.CylinderGeometry(1, 0.3, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
const lines = [];
function lineFor(i) {
  if (!lines[i]) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fb6ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    lines[i] = new THREE.Mesh(lineGeo, mat); lines[i].frustumCulled = false; lines[i].renderOrder = 2; scene.add(lines[i]);
  }
  return lines[i];
}
function drawLines(time) {
  const f = forward(), origin = camera.position.clone().addScaledVector(f, 0.35).add(new THREE.Vector3(0, -0.32, 0));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  let i = 0;
  for (const m of metals) {
    const p = m.at, dist = p.distanceTo(camera.position); if (dist > ALLO.range) continue;
    const isActive = active && active.target === m, isAimed = !active && aimed === m;
    const l = lineFor(i++); const o = origin.clone().addScaledVector(right, ((i % 5) - 2) * 0.012);
    const len = o.distanceTo(p);
    l.position.copy(o); l.lookAt(p);
    const w = isActive ? 0.016 + 0.004 * Math.sin(time * 30) : isAimed ? 0.011 : 0.006;
    l.scale.set(w, w, len);
    l.material.opacity = isActive ? 0.9 : isAimed ? 0.7 : 0.18 + 0.22 * (1 - dist / ALLO.range);
    l.material.color.setHex(isActive ? (active.mode > 0 ? 0x4f9dff : 0x8f7cff) : isAimed ? 0x3f86f0 : 0x2a5fc0);
    l.visible = true;
  }
  for (; i < lines.length; i++) lines[i].visible = false;
}

/* ---------- ash ---------- */
const ASH = 450, ashPos = new Float32Array(ASH * 3);
for (let i = 0; i < ASH; i++) { ashPos[i * 3] = (Math.random() - 0.5) * 34; ashPos[i * 3 + 1] = Math.random() * 14; ashPos[i * 3 + 2] = (Math.random() - 0.5) * 34; }
const ashGeo = new THREE.BufferGeometry(); ashGeo.setAttribute('position', new THREE.BufferAttribute(ashPos, 3));
const ash = new THREE.Points(ashGeo, new THREE.PointsMaterial({ color: 0x77736d, size: 0.035, transparent: true, opacity: 0.55, depthWrite: false }));
scene.add(ash);
function drift(dt, t) {
  for (let i = 0; i < ASH; i++) {
    ashPos[i * 3 + 1] -= dt * (0.35 + (i % 7) * 0.05); ashPos[i * 3] += Math.sin(t * 0.4 + i) * dt * 0.15;
    if (ashPos[i * 3 + 1] < 0) ashPos[i * 3 + 1] += 14;
  }
  ashGeo.attributes.position.needsUpdate = true;
}

/* ---------- frame ---------- */
function syncVisuals(dt, time) {
  const t = player.translation();
  camera.position.set(t.x, t.y - P.hh - P.r + P.eye, t.z);
  camera.rotation.set(pitch, yaw, 0);
  const k = knightBody.translation();
  knightRoot.position.set(k.x, k.y - K.hh - K.r, k.z);
  const want = Math.atan2(t.x - k.x, t.z - k.z);
  let dy = want - knightRoot.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  knightRoot.rotation.y += dy * Math.min(1, dt * 4);
  const kv = knightBody.linvel();
  play(Math.hypot(kv.x, kv.z) > 1.6 || Math.abs(kv.y) > 1.5 ? 'Jump_Idle' : 'Idle');
  if (mixer) mixer.update(dt);
  for (const c of coins) { c.mesh.position.copy(c.body.translation()); c.mesh.quaternion.copy(c.body.rotation()); }
  aimed = pick();
  drawLines(time);
  drift(dt, time);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

let last = performance.now(), acc = 0, paused = false, demo = null;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused) {
    if (demo) demo.tick(dt);
    acc += dt;
    while (acc >= DT) { stepPhysics(); acc -= DT; }
  }
  syncVisuals(dt, now / 1000);
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ---------- HUD ---------- */
const hudEl = { steel: $('#steel'), iron: $('#iron'), flare: $('#flare'), on: $('#on') };
function updateHud() {
  const pushing = active && active.mode > 0, pulling = active && active.mode < 0, fl = active ? active.flare : flare;
  hudEl.steel.classList.toggle('lit', !!pushing); hudEl.iron.classList.toggle('lit', !!pulling); hudEl.flare.classList.toggle('lit', !!fl);
  const m = active ? active.target : aimed;
  hudEl.on.textContent = m ? (active ? (pushing ? 'Pushing on: ' : 'Pulling on: ') : 'Aiming at: ') + m.name + (active && hud.force ? ` · ${Math.round(hud.force).toLocaleString()} N` : '') : 'No metal under the crosshair';
}

/* ---------- controls ---------- */
const overlay = $('#overlay');
const locked = () => document.pointerLockElement === canvas;
$('#play').addEventListener('click', () => { stopDemo(); canvas.requestPointerLock(); });
canvas.addEventListener('click', () => { if (!locked() && !demo) canvas.requestPointerLock(); });
let lockedAt = 0;
document.addEventListener('pointerlockchange', () => {
  overlay.hidden = locked() || !!demo; lockedAt = performance.now();
  if (!locked()) { active = null; keys.clear(); }
});
document.addEventListener('mousemove', (e) => {
  // Chrome can report one huge jump as the lock engages; it would spin you off the knight.
  if (!locked() || performance.now() - lockedAt < 120 || Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return;
  yaw -= e.movementX * 0.0022; pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022));
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousedown', (e) => {
  if (!locked() || (e.button !== 0 && e.button !== 2)) return;
  const target = aimed || pick();
  if (target) active = { target, mode: e.button === 0 ? 1 : -1, flare, button: e.button };
});
document.addEventListener('mouseup', (e) => { if (active && active.button === e.button) active = null; });
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') return;
  if (!locked()) { if (e.code === 'KeyR') setup('start'); return; }
  keys.add(e.code);
  if (e.code === 'Space') { jump = true; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { flare = true; if (active) active.flare = true; }
  if (e.code === 'KeyR') setup('start');
  if (e.code === 'KeyF' && !e.repeat) tossCoin();
});
document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { flare = false; if (active) active.flare = false; }
});
$('#reset').addEventListener('click', () => setup('start'));

/* ---------- the demo: the four cases, played by script through the same physics ---------- */
const caption = $('#caption');
const DEMO = [['free', 1, 1.1], ['wall', 1, 1.4], ['pullFree', -1, 0.9], ['braced', -1, 1.6]];
function startDemo() {
  overlay.hidden = true; caption.hidden = false;
  let i = -1, t = 0, phase = 'next';
  demo = {
    tick(dt) {
      t += dt;
      if (phase === 'next') { i = (i + 1) % DEMO.length; caption.textContent = setup(DEMO[i][0]).caption; scripted = true; phase = 'aim'; t = 0; }
      else if (phase === 'aim' && t > 1.1) { active = { target: knight, mode: DEMO[i][1], flare: false }; phase = 'hold'; t = 0; }
      else if (phase === 'hold' && t > DEMO[i][2]) { active = null; phase = 'rest'; t = 0; }
      else if (phase === 'rest' && t > 1.4) phase = 'next';
      if (phase === 'aim' || phase === 'hold') aimAt(knight.at);
    },
  };
}
function stopDemo() { demo = null; scripted = null; active = null; caption.hidden = true; setup('start'); }
$('#demo').addEventListener('click', startDemo);
$('#stop-demo').addEventListener('click', () => { stopDemo(); overlay.hidden = false; });
caption.hidden = true;

setup('start');
requestAnimationFrame(frame);
document.body.classList.add('ready');
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');

/* Hooks for scripted checks in a headless browser. */
window.__mb = {
  setup(name) { setup(name); scripted = true; paused = true; },
  run(steps, mode = 0, fl = false) {
    active = mode ? { target: knight, mode, flare: fl } : null;
    for (let s = 0; s < steps; s++) { aimAt(knight.at); stepPhysics(); }
    active = null;
    const p = player.translation(), k = knightBody.translation();
    return { player: [p.x, p.z], knight: [k.x, k.z] };
  },
  hold(mode, fl = false) { active = mode ? { target: knight, mode, flare: fl } : null; },
  frames(n) { for (let s = 0; s < n; s++) { aimAt(knight.at); stepPhysics(); } syncVisuals(n * DT, performance.now() / 1000); updateHud(); renderer.render(scene, camera); },
  coinShot() {
    setup('start'); scripted = true; paused = true; yaw = Math.PI; pitch = -1.45;
    syncVisuals(0, 0); tossCoin(); for (let s = 0; s < 45; s++) stepPhysics();
    const c = coins[coins.length - 1], y0 = player.translation().y;
    active = { target: c, mode: 1, flare: false };
    let top = y0; for (let s = 0; s < 60; s++) { stepPhysics(); top = Math.max(top, player.translation().y); }
    active = null; return { rise: top - y0, coinPinned: pinned(c) };
  },
  state() { const p = player.translation(), k = knightBody.translation(); return { player: [p.x, p.y, p.z], knight: [k.x, k.y, k.z] }; },
  ready: true,
};
