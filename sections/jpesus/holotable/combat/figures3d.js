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
import '/sections/guitar-goblin/human-base/look-schema.js';   // HBLookSchema, then HBLook: reads a look against the creator's own lists
import '/sections/guitar-goblin/human-base/look-parse.js';

const HT = window.HT, wrap = document.getElementById('mapWrap'), flat = document.getElementById('mapCanvas');
const CREATOR = '/sections/guitar-goblin/characters/index.html', BAKE_V = 'b2', SQ = 1.524;   // metres in a five-foot square
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
function valid(b) {
  if (!b || b.v !== 2 || !Array.isArray(b.meshes) || !b.meshes.length || b.meshes.length > 200) return false;
  return b.meshes.every((m) => m && m.position instanceof Float32Array && m.normal instanceof Float32Array && m.color instanceof Uint8Array && m.index instanceof Uint32Array
    && m.position.length % 3 === 0 && m.normal.length === m.position.length && m.color.length === m.position.length && m.index.length % 3 === 0
    && (m.emissive === undefined || (m.emissive instanceof Uint8Array && m.emissive.length === m.position.length))
    && m.index.every((i) => i < m.position.length / 3));
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
  for (const m of b.meshes) {
    const geo = new THREE.BufferGeometry(), c = new Float32Array(m.color.length);
    for (let i = 0; i < c.length; i++) c[i] = LIN[m.color[i]] + (m.emissive ? LIN[m.emissive[i]] : 0);   // (what glows, a Pureblood's eyes, simply brighter)
    geo.setAttribute('position', new THREE.BufferAttribute(m.position, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); geo.setIndex(new THREE.BufferAttribute(m.index, 1)); geo.computeBoundingSphere();
    // (metal no shinier than half: with no surroundings to reflect, full metal draws black)
    const rough = Math.max(0.3, Math.min(1, +m.rough || 0.6)), metal = Math.max(0, Math.min(0.5, +m.metal || 0)), key = `${rough.toFixed(2)}|${metal.toFixed(2)}`;
    if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal }));
    g.add(new THREE.Mesh(geo, mats.get(key)));
  }
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
      f = { look, obj: null, x: null, z: null, tx: 0, tz: 0, from: null, t0: 0, dur: 0, face: 0 }; figs.set(t.id, f);
      const mine = f;
      figureFor(look).then((tpl) => {
        if (figs.get(t.id) !== mine || !isOpen && !renderer) return;
        mine.obj = tpl.clone(); mine.obj.userData.tokenId = t.id; mine.obj.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
        figsRoot.add(mine.obj); place(mine, t); dirty = true;
      }).catch((e) => console.warn('3D figure:', e && e.message));
    }
    place(f, t, now);
  }
  for (const [id, f] of figs) if (!seen.has(id)) { if (f.obj) figsRoot.remove(f.obj); figs.delete(id); }
}
function place(f, t, now = performance.now()) {
  const size = t.size || 1, at = drag && drag.id === t.id ? drag : t, tx = at.x + size / 2, tz = at.y + size / 2;
  if (f.x === null) { f.x = tx; f.z = tz; }
  else if (tx !== f.tx || tz !== f.tz) {   // it moved: walk there, facing the way it goes
    const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz), held = drag && drag.id === t.id;
    // (turned only by a real step: dragged, a step of a fifth of a square; else more than half a square, so the snap
    // to a square when it is let go does not turn it round)
    if (d > (held ? 0.2 : 0.6)) f.face = Math.atan2(dx, dz);
    f.from = [f.x, f.z]; f.t0 = now; f.dur = held ? 60 : Math.min(1200, 180 + 160 * d);
  }
  f.tx = tx; f.tz = tz;
  if (!f.obj) return;
  const k = (t.tiny ? 0.5 : 1) / SQ;
  f.obj.scale.setScalar(k); f.obj.position.set(f.x, Math.max(0, +t.elev || 0) / 5, f.z); f.obj.rotation.y = f.face;
  const ghost = !!t.hidden;   // (the GM's hidden token: see-through, as its disk is)
  f.obj.traverse((o) => { if (o.isMesh && o.material.transparent !== ghost) { o.material.transparent = ghost; o.material.opacity = ghost ? 0.45 : 1; o.material.needsUpdate = true; } });
}
function step(f, now) {
  if (!f.from) return false;
  const u = Math.min(1, (now - f.t0) / f.dur), e = u * u * (3 - 2 * u);
  f.x = f.from[0] + (f.tx - f.from[0]) * e; f.z = f.from[1] + (f.tz - f.from[1]) * e;
  if (f.obj) f.obj.position.set(f.x, f.obj.position.y, f.z);
  if (u >= 1) f.from = null;
  return true;
}
function loop() {
  raf = requestAnimationFrame(loop);
  const now = performance.now(); let moving = false;
  for (const f of figs.values()) moving = step(f, now) || moving;
  if (moving || dirty) { dirty = false; renderer.render(scene, camera); }
}

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
export function state() { return { open: isOpen, figures: [...figs].map(([id, f]) => ({ id, ready: !!f.obj, x: f.x, z: f.z, face: f.face })) }; }
export function screenOf(sx, sy) {
  if (!el) return null; const r = el.getBoundingClientRect(), v = new THREE.Vector3(sx, 0, sy).project(camera);
  return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
}
