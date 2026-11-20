// The map in 3D (opened by figures.js, behind the GM's switch "3D figures on the map"). The ground is the board exactly
// as the flat map draws it for this person (HT.drawBoardInto: fog, light, walls, props, drawings, every token's disk,
// the combat view's marks), so the 3D view can show nothing the flat map would not. On it, each character whose sheet
// has a 3D look (made in the character creator, kept on the sheet as its link: char.look) stands on its token as a
// figure, facing the way it last moved. Only tokens this person's browser was sent can have a figure, and the server
// sends no token this person may not see (fog of war, hidden tokens), so a figure the player may not see is never drawn.
// Pressing a token or a figure, and clicking an empty square, go to the flat map's own handlers, with the point on the
// board: the same rules and the same requests as the disks (token.move, the combat view's moves and targets). Dragging
// anywhere else turns the view; scrolling or pinching zooms; the right button pans.
// A figure is built once per look per browser: the character creator, opened out of sight as
// characters/#<look>&bake=table, builds it and hands it over as plain arrays (characters/bake.js), and it is kept in
// IndexedDB for next time. Until it is ready, the token's disk is all there is.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clone as cloneRigged } from 'three/addons/utils/SkeletonUtils.js';
import { makeRig, run, stand, blend } from '/sections/guitar-goblin/human-base/motion.js';   // the run and the stand (no three.js: plain numbers)
import { unpackClip, play as playClip } from '/sections/guitar-goblin/human-base/clips.js';   // the fight's clips (CC0, human-base/data/clips.json)
import '/sections/guitar-goblin/human-base/look-schema.js';   // HBLookSchema, then HBLook: reads a look against the creator's own lists
import '/sections/guitar-goblin/human-base/look-parse.js';

const HT = window.HT, wrap = document.getElementById('mapWrap'), flat = document.getElementById('mapCanvas');
const CREATOR = '/sections/guitar-goblin/characters/index.html', BAKE_V = 'b3', SQ = 1.524;   // metres in a five-foot square
const FAKE = 7357;   // the pointer id the flat map's handlers see from here (never a real one, so they capture nothing)

let renderer = null, el = null, scene, camera, controls, ground, groundTex, groundCanvas, figsRoot, isOpen = false, dirty = true, raf = 0, redraw = 0, sized = '', camKey = '';
const figs = new Map();   // token id -> { look, obj, x, z, tx, tz, from, t0, dur, face }
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitV = new THREE.Vector3();
const st = () => HT.S.st, grid = () => st().map.gridSize;

/* ---------------- the figure for a look: from IndexedDB, or baked by the creator out of sight ---------------- */
const db = (() => {
  let p = null;
  const open = () => (p ||= new Promise((res, rej) => { const r = indexedDB.open('holotable-figures', 1); r.onupgradeneeded = () => r.result.createObjectStore('bakes'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const run = (mode, fn) => open().then((d) => new Promise((res, rej) => { const tx = d.transaction('bakes', mode), q = fn(tx.objectStore('bakes')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); }));
  return { get: (k) => run('readonly', (s) => s.get(k)).catch(() => null), put: (k, v) => run('readwrite', (s) => s.put(v, k)).catch(() => null) };
})();
let bakeQueue = Promise.resolve();   // one at a time: each runs the whole creator
function bake(look) {
  return new Promise((res, rej) => {
    const fr = document.createElement('iframe'); fr.setAttribute('aria-hidden', 'true'); fr.tabIndex = -1; fr.title = 'figure';
    fr.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:320px;border:0;opacity:0;pointer-events:none';
    const done = (v, err) => { clearTimeout(timer); window.removeEventListener('message', on); fr.remove(); if (err) rej(err); else res(v); };
    const on = (e) => {
      if (e.source !== fr.contentWindow || e.origin !== location.origin || !e.data || e.data.type !== 'holotable-figure') return;
      if (e.data.figure) done(e.data.figure); else done(null, new Error(String(e.data.error || 'no figure')));
    };
    const timer = setTimeout(() => done(null, new Error('the figure took too long')), 180000);
    window.addEventListener('message', on);
    fr.src = `${CREATOR}#${look}&bake=table`; document.body.appendChild(fr);
  });
}
// a bake as handed over or stored: typed arrays of the right kinds and sizes, nothing else
// (with a skeleton, v 3: its bones in order, each parent before it, and four bones and weights for every vertex)
function valid(b) {
  if (!b || (b.v !== 2 && b.v !== 3) || !Array.isArray(b.meshes) || !b.meshes.length || b.meshes.length > 200) return false;
  const S = b.v === 3 ? b.skeleton : null;
  if (b.v === 3 && !(Array.isArray(S) && S.length > 0 && S.length <= 256 && S.every((x, k) => x && Number.isInteger(x.parent) && x.parent >= -1 && x.parent < k
    && Array.isArray(x.head) && x.head.length === 3 && x.head.every(Number.isFinite)))) return false;
  return b.meshes.every((m) => m && m.position instanceof Float32Array && m.normal instanceof Float32Array && m.color instanceof Uint8Array && m.index instanceof Uint32Array
    && m.position.length % 3 === 0 && m.normal.length === m.position.length && m.color.length === m.position.length && m.index.length % 3 === 0
    && (m.emissive === undefined || (m.emissive instanceof Uint8Array && m.emissive.length === m.position.length))
    && (!S || (m.skinIndex instanceof Uint8Array && m.skinWeight instanceof Uint8Array && m.skinIndex.length === (m.position.length / 3) * 4
      && m.skinWeight.length === m.skinIndex.length && m.skinIndex.every((i) => i < S.length)))
    && (m.where === undefined || m.where === 'belt' || m.where === 'hand')
    && m.index.every((i) => i < m.position.length / 3))
    && (b.muzzle === undefined || (b.muzzle && typeof b.muzzle.bone === 'string' && [b.muzzle.offset, b.muzzle.dir].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))));
}
// the sheet's look as the creator's parser reads it (the server stored it that way already; read again, never trusted)
const looks = new Map();
function lookOf(raw) {
  if (!looks.has(raw)) { let v = ''; try { const r = window.HBLook && HBLook.parseLook(String(raw)); v = r && !r.fallback ? r.look : ''; } catch (e) { v = ''; } looks.set(raw, v); }
  return looks.get(raw);
}
const LIN = new Float32Array(256).map((_, i) => { const x = i / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
function build(b) {
  const g = new THREE.Group(), mats = new Map();
  // a skeleton: the bones where they stand (each bound with no turn of its own), and every mesh skinned to them
  let skel = null;
  if (b.skeleton) {
    const bones = b.skeleton.map((x) => { const o = new THREE.Bone(); o.name = String(x.name || '').slice(0, 40); return o; });
    b.skeleton.forEach((x, k) => { const p = x.parent >= 0 ? b.skeleton[x.parent].head : [0, 0, 0]; bones[k].position.set(x.head[0] - p[0], x.head[1] - p[1], x.head[2] - p[2]); (x.parent >= 0 ? bones[x.parent] : g).add(bones[k]); });
    g.updateMatrixWorld(true); skel = new THREE.Skeleton(bones);
    g.userData.rig = makeRig(b.skeleton); g.userData.root = b.skeleton.findIndex((x) => x.parent < 0); g.userData.rootAt = b.skeleton[g.userData.root].head.slice();
  }
  for (const m of b.meshes) {
    const geo = new THREE.BufferGeometry(), c = new Float32Array(m.color.length);
    for (let i = 0; i < c.length; i++) c[i] = LIN[m.color[i]] + (m.emissive ? LIN[m.emissive[i]] : 0);   // (what glows, a Pureblood's eyes, simply brighter)
    geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); geo.setIndex(new THREE.BufferAttribute(m.index, 1)); geo.computeBoundingSphere();
    // (metal no shinier than half: with no surroundings to reflect, full metal draws black)
    const rough = Math.max(0.3, Math.min(1, +m.rough || 0.6)), metal = Math.max(0, Math.min(0.5, +m.metal || 0)), key = `${rough.toFixed(2)}|${metal.toFixed(2)}`;
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal }));
    if (skel) {
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(m.skinIndex), 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Float32Array.from(m.skinWeight, (w) => w / 255), 4));
      const sm = new THREE.SkinnedMesh(geo, mats.get(key)); sm.frustumCulled = false; sm.userData.where = m.where || null; sm.visible = m.where !== 'hand'; g.add(sm); sm.bind(skel);
    } else { const mm = new THREE.Mesh(geo, mats.get(key)); mm.userData.where = m.where || null; mm.visible = m.where !== 'hand'; g.add(mm); }
  }
  // what it carries: the worn copy shows, the copy in the hand (and a saber's lit blade) only while it is used; a gun's
  // muzzle, on its bone, for the shots
  if (skel && b.muzzle) { const k = b.skeleton.findIndex((x) => x.name === b.muzzle.bone); if (k >= 0) g.userData.muzzle = { k, offset: b.muzzle.offset.slice(), dir: b.muzzle.dir.slice() }; }
  g.scale.setScalar(1 / SQ);   // metres to squares
  return g;
}
const made = new Map();   // look -> Promise<Group> (the template each token's figure is cloned from)
function figureFor(look) {
  if (!made.has(look)) made.set(look, (async () => {
    const key = `${BAKE_V}|${look}`;
    let b = await db.get(key);
    if (!valid(b)) {
      b = await (bakeQueue = bakeQueue.catch(() => {}).then(() => bake(look)));
      if (!valid(b)) throw new Error('the figure came back broken');
      db.put(key, b);
    }
    return build(b);
  })());
  return made.get(look);
}

/* ---------------- the scene ---------------- */
function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.outputColorSpace = THREE.SRGBColorSpace;
  el = renderer.domElement; el.className = 'map3d';
  scene = new THREE.Scene(); scene.background = new THREE.Color('#0a0f16');
  camera = new THREE.PerspectiveCamera(40, 1, 0.05, 1000);
  scene.add(new THREE.HemisphereLight(0xe4ecff, 0x4a4038, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(-0.45, 1, 0.6); scene.add(sun);
  groundCanvas = document.createElement('canvas');
  groundTex = new THREE.CanvasTexture(groundCanvas); groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: groundTex })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  figsRoot = new THREE.Group(); scene.add(figsRoot);
  controls = new OrbitControls(camera, el);
  Object.assign(controls, { maxPolarAngle: 1.38, minDistance: 1.2, maxDistance: 160, screenSpacePanning: false, zoomToCursor: true });
  controls.addEventListener('change', () => { dirty = true; });
  new ResizeObserver(() => { if (isOpen) resize(); }).observe(wrap);
  // presses go to the flat map's handlers when they are on a token (or a figure), or a click (no drag) on the ground
  wrap.addEventListener('pointerdown', down, true); wrap.addEventListener('pointermove', move, true);
  wrap.addEventListener('pointerup', up, true); wrap.addEventListener('pointercancel', up, true);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
function resize() {
  const w = wrap.clientWidth || 800, h = wrap.clientHeight || 600;
  if (sized === `${w}x${h}`) return; sized = `${w}x${h}`;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
}
// the board as the flat map draws it for this person, at up to 96 pixels a square (and no more than 4096 across)
function paintGround() {
  redraw = 0; if (!isOpen || !st()) return;
  const mp = st().map, g = mp.gridSize, px = Math.max(16, Math.min(96, Math.floor(Math.min(4096, renderer.capabilities.maxTextureSize) / Math.max(mp.cols, mp.rows)))), z = px / g;
  const w = Math.round(mp.cols * g * z), h = Math.round(mp.rows * g * z);
  if (groundCanvas.width !== w || groundCanvas.height !== h) { groundCanvas.width = w; groundCanvas.height = h; groundTex.dispose(); }
  HT.drawBoardInto(groundCanvas, z); groundTex.needsUpdate = true;
  ground.scale.set(mp.cols, mp.rows, 1); ground.position.set(mp.cols / 2, 0, mp.rows / 2);
  const key = `${mp.cols}x${mp.rows}`;
  if (key !== camKey) {   // a new board: from the near side, tilted, close on this person's own character if it is on it
    camKey = key; const s = st(), mine = s.map.tokens.find((t) => t.charId && s.characters[t.charId] && s.characters[t.charId].owner === s.you);
    const c = mine ? [mine.x + (mine.size || 1) / 2, mine.y + (mine.size || 1) / 2] : [mp.cols / 2, mp.rows / 2], d = mine ? 5.5 : Math.max(mp.cols, mp.rows) * 0.6;
    controls.target.set(c[0], mine ? 0.5 : 0, c[1]); camera.position.set(c[0] + d * 0.35, d * 0.62, c[1] + d * 0.75); controls.update();
  }
  sync(); dirty = true;
}

/* ---------------- the figures: one per token with a look, where its token is ---------------- */
let drag = null;   // { id, ox, oy, x, y }: a token being dragged from here, its top-left in squares
function sync() {
  const s = st(), seen = new Set(), now = performance.now();
  for (const t of s.map.tokens) {
    const ch = t.charId && s.characters && Object.prototype.hasOwnProperty.call(s.characters, t.charId) ? s.characters[t.charId] : null;
    const look = ch && ch.look ? lookOf(ch.look) : '';
    if (!look) continue;
    seen.add(t.id);
    let f = figs.get(t.id);
    if (!f || f.look !== look) {
      if (f && f.obj) figsRoot.remove(f.obj);
      f = { look, obj: null, x: null, z: null, tx: 0, tz: 0, from: null, t0: 0, dur: 0, face: 0, turned: 0, rig: null, bones: null, travel: 0, w: 0, moved: 0, held: false, act: null, route: null, size: 1, down: false }; figs.set(t.id, f);
      const mine = f;
      figureFor(look).then((tpl) => {
        if (figs.get(t.id) !== mine || !isOpen && !renderer) return;
        mine.obj = tpl.userData.rig ? cloneRigged(tpl) : tpl.clone(); mine.obj.userData.tokenId = t.id; mine.obj.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
        if (tpl.userData.rig) {   // its own bones, in the skeleton's order, to pose
          const sm = mine.obj.children.find((o) => o.isSkinnedMesh);
          Object.assign(mine, { rig: tpl.userData.rig, bones: sm.skeleton.bones, root: tpl.userData.root, rootAt: tpl.userData.rootAt, turned: mine.face, hand: [], belt: [] });
          mine.obj.traverse((o) => { if (o.isMesh && o.userData.where === 'hand') mine.hand.push(o); else if (o.isMesh && o.userData.where === 'belt') mine.belt.push(o); });
          const mz = tpl.userData.muzzle; if (mz) mine.muzzle = { bone: mine.bones[mz.k], offset: new THREE.Vector3(...mz.offset), dir: new THREE.Vector3(...mz.dir) };
          mine.gear = (/(?:^|&)gear=([a-z_]+)/.exec(look) || [])[1] || 'none';
          pose(mine); loadClips();
        }
        figsRoot.add(mine.obj); place(mine, t); dirty = true;
      }).catch((e) => console.warn('3D figure:', e && e.message));
    }
    place(f, t, now);
  }
  for (const [id, f] of figs) if (!seen.has(id)) { if (f.obj) figsRoot.remove(f.obj); figs.delete(id); }
  happenings();
}
function place(f, t, now = performance.now()) {
  const size = t.size || 1, at = drag && drag.id === t.id ? drag : t, tx = at.x + size / 2, tz = at.y + size / 2; f.size = size;
  if (f.x === null) { f.x = tx; f.z = tz; }
  else if (tx !== f.tx || tz !== f.tz) {   // it moved: walk there, facing the way it goes
    const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz), held = drag && drag.id === t.id;
    // (turned only by a real step: dragged, a step of a fifth of a square; else more than half a square, so the snap
    // to a square when it is let go does not turn it round)
    if (d > (held ? 0.2 : 0.6)) f.face = Math.atan2(dx, dz);
    f.from = [f.x, f.z]; f.t0 = now; f.dur = held ? 60 : Math.min(1200, 180 + 160 * d); f.held = !!held;
  }
  f.tx = tx; f.tz = tz;
  if (!f.obj) return;
  const k = (t.tiny ? 0.5 : 1) / SQ;
  f.obj.scale.setScalar(k); f.obj.position.set(f.x, Math.max(0, +t.elev || 0) / 5, f.z); f.obj.rotation.y = f.rig ? f.turned : f.face;
  const ghost = !!t.hidden;   // (the GM's hidden token: see-through, as its disk is)
  f.obj.traverse((o) => { if (o.isMesh && o.material.transparent !== ghost) { o.material.transparent = ghost; o.material.opacity = ghost ? 0.45 : 1; o.material.needsUpdate = true; } });
}
// The fight's clips (engineer13's, from Mesh2Motion, CC0): played from what the combat view records (#279). An 'act'
// turns its figure to its target and plays the swing, shot or power its grip and kind call for; when the blow lands
// (the clip's impact mark) each of its results plays on its target: a hit, a harder one for a crit, a dodge for a
// miss. A combatant at 0 hit points falls and stays down until it is back up. Each clip fades in and out over the
// stand or the run under it. Nothing here decides anything: the server already has, and this browser was told.
let clipsJ = null, clipsP = null;
function loadClips() { clipsP ||= fetch('/sections/guitar-goblin/human-base/data/clips.json').then((r) => r.json()).then((j) => { clipsJ = j && j.clips ? j : { clips: {} }; }).catch(() => { clipsJ = { clips: {} }; }); }
function clipFor(f, name) {
  if (!clipsJ || !name || !Object.prototype.hasOwnProperty.call(clipsJ.clips, name)) return null;
  const R = f.rig, own = (R.played ||= new Map());
  if (!own.has(name)) { let p = null; try { p = playClip(unpackClip(clipsJ.clips[name]), R, { root: clipsJ.clips[name].root, loop: false }); } catch (e) { console.warn('clip', name, e && e.message); } own.set(name, p); }
  return own.get(name);
}
function clipsOf(ev) {
  if (ev.how === 'power') return ev.school === 'tech' ? ['spell-enter', 'spell-shoot', 'spell-exit'] : ['force-blast'];
  if (ev.how === 'ranged') return [ev.grip === 'two' ? 'rifle-fire' : 'pistol-shoot'];
  if (ev.grip === 'unarmed') return ['punch-jab'];
  if (ev.grip === 'two') return ['two-hand-swing'];
  if (ev.grip === 'double' || ev.grip === 'staff') return ['staff-combo'];
  return ['sword-a', 'sword-a-rec'];
}
// the weapon in the hand (engineer13's carry: a worn copy and a held one): drawn for a swing with a melee weapon, or a
// shot with a gun, by whatever this figure's look carries; from the back (a staff or rifle) with the 'draw' clip first,
// from the hip early in the swing, a pistol as the shot starts. Put back when the clip is done.
const MELEE = new Set(['hilt', 'double', 'staff']), GUNS = new Set(['pistol', 'rifle']), ON_BACK = new Set(['staff', 'rifle']);
function weaponFor(f, ev, names) {
  if (!f.hand || !f.hand.length || ev.how === 'power' || ev.grip === 'unarmed') return { names, draw: null };
  const fits = ev.how === 'ranged' ? GUNS.has(f.gear) : MELEE.has(f.gear);
  if (!fits) return { names, draw: null };
  if (ON_BACK.has(f.gear) && clipFor(f, 'draw')) return { names: ['draw', ...names], draw: { i: 0, t: (clipFor(f, 'draw').marks || {}).impact ?? 0.5 }, hit: 1 };
  return { names, draw: { i: 0, t: f.gear === 'pistol' ? 0 : 0.06 } };
}
function inHand(f, on) { if (!f.hand || !f.hand.length) return; for (const o of f.hand) o.visible = on; for (const o of f.belt) o.visible = !on; }
// blaster bolts: from the muzzle at each of the clip's shots, to the target's chest (or straight on); the last one's
// arrival is when the target reacts
const bolts = [], BOLT_GEO = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8).rotateX(Math.PI / 2), BOLT_MAT = new THREE.MeshBasicMaterial({ color: 0xff7060 });
const GLOW_GEO = new THREE.CylinderGeometry(0.08, 0.08, 0.75, 10).rotateX(Math.PI / 2), GLOW_MAT = new THREE.MeshBasicMaterial({ color: 0xff2a10, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
let fired = 0;
function fire(f, tgt, onHit) {
  f.obj.updateMatrixWorld(true);
  const from = f.muzzle.bone.localToWorld(f.muzzle.offset.clone()), dir = f.muzzle.dir.clone().transformDirection(f.muzzle.bone.matrixWorld);
  const to = tgt ? new THREE.Vector3(tgt.x, 1.25 / SQ, tgt.z) : from.clone().addScaledVector(dir, 8);
  const m = new THREE.Mesh(BOLT_GEO, BOLT_MAT); m.add(new THREE.Mesh(GLOW_GEO, GLOW_MAT)); m.position.copy(from); m.lookAt(to); scene.add(m); fired++;
  bolts.push({ m, from, to, d: Math.max(0.01, from.distanceTo(to)), t: 0, onHit });
}
function stepBolts(dt) {
  for (const b of [...bolts]) {
    b.t += dt * 14; const u = Math.min(1, b.t / b.d); b.m.position.lerpVectors(b.from, b.to, u);   // (14 squares a second: fast, but seen)
    if (u >= 1) { scene.remove(b.m); bolts.splice(bolts.indexOf(b), 1); if (b.onHit) b.onHit(); }
  }
  return bolts.length > 0;
}
function playOn(f, names, o = {}) {
  if (!f || !f.rig || !f.bones) return false;
  const list = names.filter((n) => clipFor(f, n));
  if (!list.length) { if (o.onImpact) o.onImpact(); return false; }
  if (f.act && f.act.drawn) inHand(f, false);
  const hit = Math.min(list.length - 1, o.hit || 0), shots = ((clipFor(f, list[hit]).marks || {}).shots || []).slice();
  f.act = { list, i: 0, p: clipFor(f, list[0]), t: 0, w: f.act ? f.act.w : 0, hold: !!o.hold, onImpact: o.onImpact || null, out: false,
    hit, draw: o.draw || null, drawn: false, shots: f.muzzle && f.gear && GUNS.has(f.gear) && o.draw ? shots : [], target: o.target || null };
  return true;
}
function stepAct(f, dt) {
  const a = f.act; a.t += dt;
  if (a.out) { a.w -= dt / 0.2; if (a.w <= 0) f.act = null; return; }
  a.w = Math.min(1, a.w + dt / 0.12);
  if (a.draw && !a.drawn && (a.i > a.draw.i || a.t >= a.draw.t)) { a.drawn = true; inHand(f, true); }
  if (a.i === a.hit && a.shots.length && a.t >= a.shots[0]) {   // a shot: the reaction waits for the last bolt
    a.shots.shift(); const last = !a.shots.length, go = last ? a.onImpact : null; if (last) a.onImpact = null;
    pose(f); fire(f, a.target, go);
  }
  if (a.onImpact && a.i === a.hit && !a.shots.length && a.t >= (a.p.marks && a.p.marks.impact != null ? a.p.marks.impact : a.p.duration * 0.5)) { const go = a.onImpact; a.onImpact = null; go(); }
  if (a.t < a.p.duration) return;
  if (a.i + 1 < a.list.length) { a.i += 1; a.p = clipFor(f, a.list[a.i]); a.t = 0; return; }
  if (a.onImpact) { const go = a.onImpact; a.onImpact = null; go(); }
  if (a.hold) a.t = a.p.duration; else { a.out = true; if (a.drawn) inHand(f, false); }
}
let lastSeq = null;
function happenings() {
  const s = st(), fe = s.fight && Array.isArray(s.fight.events) ? s.fight.events : [];
  // down or back up: every combatant this browser is sent says so (no event needed)
  for (const u of Object.values((s.fight && s.fight.units) || {})) {
    const f = u && u.token && figs.get(u.token); if (!f || !f.rig || f.down === !!u.down) continue;
    f.down = !!u.down;
    if (f.down) playOn(f, ['down'], { hold: true }); else playOn(f, ['get-up']);
  }
  const top = fe.reduce((m, e) => Math.max(m, +e.seq || 0), 0);
  if (lastSeq === null || top < lastSeq) { lastSeq = top; return; }   // (what happened before the view opened isn't played again)
  const fresh = fe.filter((e) => e.seq > lastSeq).sort((a, b) => a.seq - b.seq); lastSeq = top;
  for (const ev of fresh) {
    const f = ev.token ? figs.get(ev.token) : null;
    if (ev.kind === 'move' && f && Array.isArray(ev.path) && ev.path.length > 1) {
      // a path that starts away from where the figure stands began out of this viewer's sight (#279 cut it there): the
      // figure appears where it came into sight, rather than running there from where it was last seen
      const p0 = [+ev.path[0][0] + f.size / 2, +ev.path[0][1] + f.size / 2];
      if (f.x === null || Math.hypot(p0[0] - f.x, p0[1] - f.z) > 0.6) { f.x = p0[0]; f.z = p0[1]; }
      f.route = ev.path.slice(1).map((q) => [+q[0], +q[1]]); f.from = f.from || [f.x, f.z]; continue;
    }
    if (ev.kind !== 'act') continue;
    const tgt = ev.target ? figs.get(ev.target) : null, results = fresh.filter((r) => r.act === ev.seq);
    const land = () => { for (const r of results) { const g = r.token && figs.get(r.token); if (g && !g.down) playOn(g, r.kind === 'miss' ? ['dodge'] : r.kind === 'crit' ? ['hit-head'] : r.kind === 'heal' ? [] : ['hit-chest']); } };
    if (f && tgt) f.face = Math.atan2(tgt.tx - f.tx, tgt.tz - f.tz);   // it turns to whoever it acts on
    const wp = f && f.rig ? weaponFor(f, ev, clipsOf(ev)) : { names: clipsOf(ev), draw: null };
    if (!(f && playOn(f, wp.names, { onImpact: land, draw: wp.draw, hit: wp.hit || 0, target: tgt ? { x: tgt.tx, z: tgt.tz } : null }))) land();
  }
}

// A figure with a skeleton runs: at the speed its run is made for (dragged, as fast as the pointer), its stride set by
// how far it has gone, so its feet never slide; it turns to face where it goes, and eases into its stand when it
// arrives. It shows only a move this browser was already told about: the position is always the server's.
function pose(f) {
  const st = stand(f.rig, 0); let p = f.w > 0.001 ? blend(st, run(f.rig, f.travel / f.rig.speed), f.w) : st;
  if (f.act && f.act.p) p = blend(p, f.act.p.sample(Math.min(f.act.t, f.act.p.duration)), Math.min(1, f.act.w));
  for (let i = 0; i < f.bones.length; i++) f.bones[i].quaternion.fromArray(p.q, i * 4);
  f.bones[f.root].position.set(f.rootAt[0] + p.root[0], f.rootAt[1] + p.root[1], f.rootAt[2] + p.root[2]);
}
function step(f, now, dt) {
  let active = false;
  if (f.from && f.rig) {
    // along the squares the move took (the combat view's path), then to where the token is
    const via = f.route && f.route.length ? [f.route[0][0] + f.size / 2, f.route[0][1] + f.size / 2] : null, gx = via ? via[0] : f.tx, gz = via ? via[1] : f.tz;
    const dx = gx - f.x, dz = gz - f.z, d = Math.hypot(dx, dz), v = (f.held ? Math.max(f.rig.speed, (d * SQ) / 0.08) : f.rig.speed) / SQ, s = Math.min(d, v * dt);
    if (via && d > 0.05) f.face = Math.atan2(dx, dz);
    if (s >= d - 1e-6) { f.x = gx; f.z = gz; if (via) f.route.shift(); else f.from = null; } else { f.x += (dx / d) * s; f.z += (dz / d) * s; }
    f.travel += s * SQ; if (s > 1e-5) f.moved = now; active = true;
  } else if (f.from) {
    const u = Math.min(1, (now - f.t0) / f.dur), e = u * u * (3 - 2 * u);
    f.x = f.from[0] + (f.tx - f.from[0]) * e; f.z = f.from[1] + (f.tz - f.from[1]) * e;
    if (u >= 1) f.from = null; active = true;
  }
  if (f.rig) {
    let da = f.face - f.turned; da = Math.atan2(Math.sin(da), Math.cos(da));
    if (Math.abs(da) > 1e-3) { f.turned += Math.sign(da) * Math.min(Math.abs(da), 9 * dt); active = true; }
    const want = now - f.moved < 120 ? 1 : 0;
    if (f.w !== want) { f.w = want ? Math.min(1, f.w + dt / 0.15) : Math.max(0, f.w - dt / 0.3); active = true; }
    if (f.act) { stepAct(f, dt); active = true; }
    if (active && f.bones) pose(f);
  }
  if (f.obj) { f.obj.position.set(f.x, f.obj.position.y, f.z); f.obj.rotation.y = f.rig ? f.turned : f.face; }
  return active;
}
let last = 0, held = null;   // (held: a test's own clock, stepped by advance(), in place of the screen's frames)
function frame(now) {
  const dt = Math.min(0.25, last ? (now - last) / 1000 : 0.016); last = now; let moving = false;   // (a slow device takes bigger steps, not slower runs)
  for (const f of figs.values()) moving = step(f, now, dt) || moving;
  moving = stepBolts(dt) || moving;
  if (moving || dirty) { dirty = false; renderer.render(scene, camera); }
}
function loop() { raf = requestAnimationFrame(loop); if (held === null) frame(performance.now()); }

/* ---------------- pointers: the flat map's handlers, with the point on the board ---------------- */
let press = null;
function boardAt(e, figures) {
  const r = el.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const g = grid();
  if (figures) {
    const hit = ray.intersectObjects([...figs.values()].filter((f) => f.obj).map((f) => f.obj), true)[0];
    if (hit) {
      let o = hit.object; while (o && !o.userData.tokenId) o = o.parent;
      const t = o && st().map.tokens.find((x) => x.id === o.userData.tokenId);
      if (t) { const s = t.size || 1; return { x: (t.x + s / 2) * g, y: (t.y + s / 2) * g, tok: t }; }
    }
  }
  const p = ray.ray.intersectPlane(plane, hitV); return p ? { x: p.x * g, y: p.z * g } : null;
}
function send(type, e, b) {
  const ev = new PointerEvent(type, { clientX: e.clientX, clientY: e.clientY, pointerId: FAKE, pointerType: e.pointerType || 'mouse', isPrimary: true,
    button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerdown' ? 1 : type === 'pointermove' ? (press && press.fwd ? 1 : 0) : 0,
    shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, bubbles: true, cancelable: true });
  ev.boardXY = { x: b.x, y: b.y }; flat.dispatchEvent(ev);
}
function down(e) {
  if (!isOpen || e.target !== el || !e.isPrimary || e.button !== 0) return;   // the right button pans, a second finger pinches: the view's own
  const b = boardAt(e, true); if (!b) return;
  const t = b.tok || HT.tokenAt(b.x, b.y);
  if (t) {   // a token: picked up if this person may move it (or the combat view's target), as on the flat map
    e.stopPropagation(); e.preventDefault(); el.setPointerCapture(e.pointerId);   // (preventDefault: dragging doesn't select the page's text)
    const g = grid();
    press = { fwd: true, id: e.pointerId };
    drag = HT.canMove(t) ? { id: t.id, ox: b.x / g - t.x, oy: b.y / g - t.y, x: t.x, y: t.y } : null;
    send('pointerdown', e, b); return;
  }
  press = { fwd: false, id: e.pointerId, sx: e.clientX, sy: e.clientY };   // the ground: turning the view, unless it is a click
}
function move(e) {
  if (!isOpen || (press && e.pointerId !== press.id)) return;
  if (press && !press.fwd) return;   // turning the view
  const b = boardAt(e, false); if (!b) return;
  if (press && drag) { const g = grid(); drag.x = b.x / g - drag.ox; drag.y = b.y / g - drag.oy; const t = st().map.tokens.find((x) => x.id === drag.id); if (t && figs.get(t.id)) place(figs.get(t.id), t); dirty = true; }
  if (e.target === el || press) send('pointermove', e, b);
}
function up(e) {
  if (!isOpen || !press || e.pointerId !== press.id) return;
  const p = press; press = null;
  const b = boardAt(e, false);
  if (p.fwd) { drag = null; if (b) send('pointerup', e, b); else send('pointercancel', e, { x: -1e6, y: -1e6 }); sync(); return; }
  if (b && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 6) { send('pointerdown', e, b); send('pointerup', e, b); }   // a click on the ground: as on the flat map (the combat view's move, or nothing)
}

/* ---------------- open and close ---------------- */
export function open() {
  if (!renderer) setup();
  if (!el.isConnected) flat.after(el);
  el.style.display = 'block'; isOpen = true; sized = ''; resize(); paintGround();   // (three.js sets the canvas's display inline, so hidden alone would not hide it)
  if (!raf) loop();
}
export function close() {
  isOpen = false; press = null; drag = null;
  if (el) el.style.display = 'none';
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}
// the flat map has just drawn (a poll, a move, a hover): the ground and the figures follow, once a frame
export function drawn() { if (isOpen && !redraw) redraw = requestAnimationFrame(paintGround); }
// for tests and the curious: what is standing where, and where a square is on the screen
export function state() { return { open: isOpen, figures: [...figs].map(([id, f]) => ({ id, ready: !!f.obj, x: f.x, z: f.z, face: f.face, rigged: !!f.rig, run: f.w, travel: f.travel, clip: f.act ? f.act.list[f.act.i] : null, down: f.down, inHand: !!(f.hand && f.hand.some((o) => o.visible)) })), bolts: bolts.length, fired }; }
export function screenOf(sx, sy) {
  if (!el) return null; const r = el.getBoundingClientRect(), v = new THREE.Vector3(sx, 0, sy).project(camera);
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}
// for tests and recordings: stop the screen's clock and step the figures by hand, so a slow machine can still record
// smooth motion frame by frame; and point the camera
export function hold(on) { held = on ? performance.now() : null; last = held || 0; }
export function advance(ms) { if (held === null) return; held += ms; frame(held); }
export function aim(x, z, d = 6, turn = 0.35) { controls.target.set(x, 0.5, z); camera.position.set(x + d * turn, d * 0.62, z + d * 0.75); controls.update(); dirty = true; }
export function debug() {
  const f = [...figs.values()][0]; if (!f || !f.obj) return null;
  f.obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(f.obj, true), sm = f.obj.children.filter((o) => o.isMesh);
  return { kids: f.obj.children.length, meshes: sm.length, skinned: sm.filter((o) => o.isSkinnedMesh).length, pos: f.obj.position.toArray(), scale: f.obj.scale.x, box: [box.min.toArray(), box.max.toArray()],
    bones: f.bones ? f.bones.length : 0, root: f.bones ? f.bones[f.root].position.toArray() : null, ground: [ground.scale.x, ground.scale.y, groundCanvas.width, groundCanvas.height], cam: camera.position.toArray(), target: controls.target.toArray() };
}
