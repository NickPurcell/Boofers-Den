// Duros character creator: a low-poly bust built from simple shapes, with a few lore-friendly options.
// three.js is the copy vendored in ../vendor/three (r185), loaded through the page's import map.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ---------------- the options ---------------- */
const OPTIONS = {
  skin: [
    { key: 'blue', name: 'Duro blue', c: '#4c86b8' },
    { key: 'deep', name: 'Deep blue', c: '#2d5a92' },
    { key: 'teal', name: 'Blue-green', c: '#3b8a86' },
    { key: 'green', name: 'Green', c: '#56885a' },
    { key: 'grey', name: 'Grey-blue', c: '#6c8095' },
  ],
  eyes: [
    { key: 'red', name: 'Red', c: '#d0222c' },
    { key: 'dark', name: 'Dark red', c: '#7a0f19' },
    { key: 'ember', name: 'Orange-red', c: '#e24a26' },
    { key: 'amber', name: 'Orange', c: '#f08a22' },
  ],
  head: [
    { key: 'round', name: 'Rounded' },
    { key: 'tall', name: 'High dome' },
    { key: 'narrow', name: 'Narrow' },
  ],
  build: [
    { key: 'slim', name: 'Slim', s: 0.88 },
    { key: 'average', name: 'Average', s: 1 },
    { key: 'broad', name: 'Broad', s: 1.14 },
  ],
  detail: [
    { key: 'sculpted', name: 'Sculpted' },
    { key: 'lowpoly', name: 'First cut' },
  ],
  outfit: [
    { key: 'scout', name: "Scout's jacket & scarf" },
    { key: 'pilot', name: 'Flight suit' },
    { key: 'trader', name: "Trader's coat" },
  ],
};
const DEFAULT = { skin: 'blue', eyes: 'red', head: 'round', build: 'average', outfit: 'scout', detail: 'sculpted' };
const pick = (opt, key) => OPTIONS[opt].find((o) => o.key === key) || OPTIONS[opt][0];

// the look lives in the page's address (#skin=teal&eyes=red&…), so a link keeps it
function readHash() {
  const st = Object.assign({}, DEFAULT), q = new URLSearchParams(location.hash.slice(1));
  for (const k of Object.keys(OPTIONS)) if (OPTIONS[k].some((o) => o.key === q.get(k))) st[k] = q.get(k);
  return st;
}
const state = readHash();
const writeHash = () => history.replaceState(null, '', '#' + new URLSearchParams(state).toString());

/* ---------------- the scene ---------------- */
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
} catch (e) {
  document.getElementById('nogl').hidden = false;
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(1.6, 0.4, 8.6);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, -0.55, 0);
controls.enablePan = false;
controls.enableDamping = true;
controls.minDistance = 4.2;
controls.maxDistance = 13;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 2.2;
controls.update();

scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1a1f2b, 1.0));
const key = new THREE.DirectionalLight(0xfff0de, 2.6); key.position.set(3, 4, 5); scene.add(key);
const rim = new THREE.DirectionalLight(0x86ccff, 1.8); rim.position.set(-4, 2.5, -5); scene.add(rim);
const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(-3, -1, 4); scene.add(fill);

// a small studio for reflections (the glossy eyes, the sheen on the skin): a dark room with a warm key panel, a cool
// rim panel and a soft overhead, baked once into an environment map
function studio() {
  const room = new THREE.Scene();
  room.add(new THREE.Mesh(new THREE.SphereGeometry(20, 24, 16), new THREE.MeshBasicMaterial({ color: 0x0c1220, side: THREE.BackSide })));
  const panel = (c, w, h, x, y, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); room.add(m); };
  panel(0xfff1dc, 8, 6, 9, 8, 12); panel(0x9fd4ff, 4, 9, -12, 4, -9); panel(0x6a7a90, 14, 3, 0, 16, 0);
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(room, 0.03).texture;
  pm.dispose();
  return env;
}
scene.environment = studio();
scene.environmentIntensity = 0.55;
// depth in a Duros eye (no white, no pupil): brighter at the centre, a darker ring a little way out, and the edge
// falling off darker still, with faint streaks running out from the centre. Painted on the sphere's own map, whose
// front (+Z) is at u = 0.25, v = 0.5; white where the eye's colour shows as chosen, darker where it deepens.
function eyeDepth() {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H);
  const smooth = (a, b, t) => { const s = Math.min(1, Math.max(0, (t - a) / (b - a))); return s * s * (3 - 2 * s); };   // made before the shared helpers
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const phi = (i / W) * Math.PI * 2, th = (j / H) * Math.PI;
    const dz = Math.sin(phi) * Math.sin(th), a = Math.acos(Math.max(-1, Math.min(1, dz)));   // angle from the front
    const streak = 0.025 * Math.sin(Math.atan2(Math.cos(th), -Math.cos(phi) * Math.sin(th)) * 22);
    let v = 1 - 0.25 * smooth(0.0, 0.5, a) - 0.22 * Math.exp(-(((a - 0.62) / 0.09) ** 2)) - 0.45 * smooth(0.75, 1.3, a) + (a < 0.6 ? streak : 0);
    v = Math.max(0.12, Math.min(1, v)) * 255;
    img.data.set([v, v, v, 255], (j * W + i) * 4);
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const eyeSculpted = new THREE.MeshPhysicalMaterial({ color: 0xd0222c, map: eyeDepth(), roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x000000 });
// fine skin grain for the sculpted head: a tileable noise used as a bump map
function grain() {
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d'), img = x.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { const v = 118 + Math.random() * 20 + (Math.random() < 0.012 ? -40 : 0); img.data.set([v, v, v, 255], i * 4); }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 4);
  return t;
}
const skinMat = new THREE.MeshStandardMaterial({ color: 0x4c86b8, roughness: 0.5, metalness: 0, flatShading: true });
const skinSmooth = new THREE.MeshPhysicalMaterial({ color: 0x4c86b8, roughness: 0.48, metalness: 0, sheen: 0.35, sheenRoughness: 0.6, sheenColor: 0x9fd0ff,
  clearcoat: 0.12, clearcoatRoughness: 0.6, bumpMap: grain(), bumpScale: 0.6 });
const skin = () => (state.detail === 'lowpoly' ? skinMat : skinSmooth);
const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0xd0222c, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x000000 });
const mouthMat = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.8 });
const cloth = (c, rough = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0, flatShading: state.detail === 'lowpoly' });

const figure = new THREE.Group();
scene.add(figure);
const headPivot = new THREE.Group();   // the head and its face, on top of the neck
headPivot.position.set(0, 0.25, 0.05);
figure.add(headPivot);
let headParts = null, bodyParts = null;

const smooth = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const ray = new THREE.Raycaster();
// where a line straight back from the front (z) first meets a mesh: the point and its outward normal
function front(mesh, x, y) {
  mesh.updateWorldMatrix(true, false);
  ray.set(new THREE.Vector3(x, y, 20).applyMatrix4(mesh.parent.matrixWorld), new THREE.Vector3(0, 0, -1).transformDirection(mesh.parent.matrixWorld));
  const hit = ray.intersectObject(mesh, false)[0];
  if (!hit) return null;
  const inv = new THREE.Matrix4().copy(mesh.parent.matrixWorld).invert();
  const p = hit.point.clone().applyMatrix4(inv);
  const n = hit.face.normal.clone().transformDirection(mesh.matrixWorld).transformDirection(inv).normalize();
  return { p, n };
}

/* ---------------- the head ---------------- */
// A sphere pushed into a Duros head: tall and smooth, wide across the eyes and the crown, narrowing to a small chin,
// the face fairly flat and the cranium swept back. No nose, no ears, a thin lipless mouth.
const HEADS = {
  round: { H: 1.32, jaw: 0.52, crown: 1.0, back: 1.06, wide: 1.0, eye: 0.32 },
  tall: { H: 1.55, jaw: 0.5, crown: 1.03, back: 1.24, wide: 1.0, eye: 0.32 },
  narrow: { H: 1.42, jaw: 0.42, crown: 0.9, back: 1.1, wide: 0.88, eye: 0.3 },
};
function buildHead() {
  if (headParts) { headPivot.remove(headParts); headParts.traverse((o) => o.geometry && o.geometry.dispose()); }
  if (state.detail !== 'lowpoly') return buildSculptedHead();
  const h = HEADS[state.head] || HEADS.round, g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 28, 22), pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.y + 1) / 2;
    let w = lerp(h.jaw, 1, smooth(0.04, 0.6, t)) * lerp(1, h.crown, smooth(0.55, 0.95, t)) * h.wide;
    let x = v.x * w, y = v.y * h.H, z = v.z;
    if (z > 0) z *= lerp(0.74, 0.9, smooth(0, 0.7, t)) * lerp(1, 0.92, smooth(0.6, 1, t));
    else z *= lerp(0.88, h.back, smooth(0.3, 0.9, t));
    z -= smooth(0.55, 1, t) * (h.back - 1) * 1.1;   // the cranium swept back
    if (t < 0.22 && v.z > 0) z += (0.22 - t) * 0.5;  // a small, forward chin
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  const head = new THREE.Mesh(geo, skinMat);
  g.add(head);
  headPivot.add(g);
  // eyes: large, round and wide-set, half sunk into the head
  const ex = 0.43 * h.wide, ey = h.H * 0.06;
  for (const sx of [-1, 1]) {
    const f = front(head, sx * ex, ey);
    if (!f) continue;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(h.eye, 24, 18), eyeMat);
    eye.position.copy(f.p).addScaledVector(f.n, -h.eye * 0.5);
    eye.scale.set(1, 1.04, 0.92);
    g.add(eye);
  }
  // a thin, lipless mouth that follows the face
  const my = -h.H * 0.56, pts = [];
  for (const mx of [-0.22, -0.11, 0, 0.11, 0.22]) {
    const f = front(head, mx * h.wide, my + Math.abs(mx) * 0.18);
    if (f) pts.push(f.p.clone().addScaledVector(f.n, 0.004));
  }
  if (pts.length >= 3) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.02, 6, false), mouthMat));
  headParts = g;
  headPivot.position.y = 0.25 + (h.H - 1.32) * 0.55;
}

// The sculpted head (detail "Sculpted"): the same Duros shape on a much finer sphere, then sculpted where a face has
// form: deep sockets the eyes sit in, a soft brow ridge over them, cheekbones under them, a mouth cut into the face
// (no lips), a faint dip at the temples and under the chin. Upper and lower lids wrap the eyes. Smooth shading.
function headShape(h, v) {
  const t = (v.y + 1) / 2;
  const w = lerp(h.jaw, 1, smooth(0.04, 0.6, t)) * lerp(1, h.crown, smooth(0.55, 0.95, t)) * h.wide;
  let z = v.z;
  if (z > 0) z *= lerp(0.74, 0.9, smooth(0, 0.7, t)) * lerp(1, 0.92, smooth(0.6, 1, t));
  else z *= lerp(0.88, h.back, smooth(0.3, 0.9, t));
  z -= smooth(0.55, 1, t) * (h.back - 1) * 1.1;
  if (t < 0.22 && v.z > 0) z += (0.22 - t) * 0.5;
  return new THREE.Vector3(v.x * w, v.y * h.H, z);
}
const gauss = (d2) => Math.exp(-d2);
function buildSculptedHead() {
  const h = HEADS[state.head] || HEADS.round, g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 128, 96), pos = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const p = headShape(h, v); pos.setXYZ(i, p.x, p.y, p.z); }
  geo.computeVertexNormals();
  const base = new THREE.Mesh(geo, skin());
  g.add(base); headPivot.add(g); g.updateMatrixWorld(true);
  // where the face features sit, found on the unsculpted shape
  const R = h.eye, ex = 0.43 * h.wide, ey = h.H * 0.06, my = -h.H * 0.56;
  const eyes = [-1, 1].map((sx) => front(base, sx * ex, ey)).filter(Boolean);
  const nrm = geo.attributes.normal, n = new THREE.Vector3(), p = new THREE.Vector3();
  const out = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i);
    if (n.z < -0.2) continue;   // the back of the head stays as it is
    let d = 0;
    for (const e of eyes) {
      const dx = (p.x - e.p.x) / R, dy = (p.y - e.p.y) / R, dz = (p.z - e.p.z) / R;
      d -= 0.42 * R * gauss((dx * dx + dy * dy + dz * dz) / 0.78);                              // the socket
      const bx = (p.x - e.p.x) / (R * 1.25), by = (p.y - e.p.y - R * 1.02) / (R * 0.34);
      d += 0.055 * gauss(bx * bx + by * by);                                                     // the brow ridge
      const cx = (p.x - e.p.x - Math.sign(e.p.x) * R * 0.35) / (R * 0.9), cy = (p.y - e.p.y + R * 1.2) / (R * 0.45);
      d += 0.04 * gauss(cx * cx + cy * cy);                                                      // the cheekbone
      const tx = (p.x - e.p.x - Math.sign(e.p.x) * R * 1.6) / (R * 0.7), ty = (p.y - e.p.y - R * 0.3) / (R * 0.9);
      d -= 0.025 * gauss(tx * tx + ty * ty);                                                     // the temple
    }
    if (p.z > 0.2) {   // the mouth: a thin cut, curving up a little at the ends, with soft lip lines either side
      const ax = Math.abs(p.x) / h.wide, yc = my + ax * ax * 0.55, m = smooth(0.3, 0.2, ax);
      const u = (p.y - yc) / 0.022;
      d += m * (-0.034 * gauss(u * u) + 0.012 * gauss(((p.y - yc - 0.06) / 0.035) ** 2) + 0.01 * gauss(((p.y - yc + 0.065) / 0.04) ** 2));
      const cy = (p.y - (my - 0.32)) / 0.12, cx = p.x / 0.25;
      d -= 0.018 * gauss(cx * cx + cy * cy);                                                     // the dip above the chin
    }
    out[i] = d;
  }
  for (let i = 0; i < pos.count; i++) {
    if (!out[i]) continue;
    n.fromBufferAttribute(nrm, i);
    pos.setXYZ(i, pos.getX(i) + n.x * out[i], pos.getY(i) + n.y * out[i], pos.getZ(i) + n.z * out[i]);
  }
  geo.computeVertexNormals(); pos.needsUpdate = true;
  // eyes in the sockets, each with an upper and a lower lid of skin
  for (const e of eyes) {
    const c = e.p.clone().addScaledVector(e.n, -R * 0.78);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), eyeSculpted);
    eye.position.copy(c); eye.lookAt(c.clone().add(e.n)); eye.scale.set(1, 1.04, 0.92); g.add(eye);   // its front faces out of the socket
    const lids = new THREE.Group(); lids.position.copy(c); lids.lookAt(c.clone().add(e.n)); g.add(lids);
    // a lid is a cap of a slightly larger sphere, its axis tipped away from the viewer, so its edge arches over the
    // eye the way a real lid's does (a cap facing straight up would cut across the eye in a straight line)
    const lid = (start, len, tip) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 64, 24, 0, Math.PI * 2, start, len), skin());
      m.rotation.x = tip; m.scale.set(1, 1.04, 0.92); lids.add(m); return m;
    };
    lid(0, Math.PI * 0.45, -0.45);                  // the upper lid, a little hooded
    lid(Math.PI * 0.72, Math.PI * 0.28, 0.45);      // the lower lid, a thin rim
  }
  headParts = g;
  headPivot.position.y = 0.25 + (h.H - 1.32) * 0.55;
}

/* ---------------- the body and the outfits ---------------- */
// A torso turned on a lathe (wide at the shoulders, flatter front to back), a neck, shoulders and upper arms; each
// outfit dresses it in its own colours and adds a few plain pieces: collar, straps, scarf, lapels.
const TW = 1.08, TD = 0.64;   // the torso's width and depth against its lathe profile
function torsoGeo(s, extra = 0) {
  const prof = [[0, -5.0], [1.12, -4.95], [1.18, -4.3], [1.22, -3.6], [1.34, -2.9], [1.32, -2.4], [1.14, -2.08], [0.78, -1.9], [0.5, -1.82], [0.42, -1.8]]
    .map(([r, y]) => new THREE.Vector2(r + (r ? extra : 0), y));
  const geo = new THREE.LatheGeometry(prof, 28);
  geo.scale(TW * s, 1, TD + (s - 1) * 0.3);
  return geo;
}
function strap(g, mat, a, b, w = 0.16, out = 0.05) {
  const dir = new THREE.Vector3().subVectors(b.p, a.p), len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.05), mat);
  const n = a.n.clone().add(b.n).normalize();
  m.position.copy(a.p).add(b.p).multiplyScalar(0.5).addScaledVector(n, out);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.add(m);
  return m;
}
function buildBody() {
  if (bodyParts) { figure.remove(bodyParts); bodyParts.traverse((o) => o.geometry && o.geometry.dispose()); }
  const s = pick('build', state.build).s, g = new THREE.Group();
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.46, 1.7, state.detail === 'lowpoly' ? 16 : 40), skin());
  neck.position.set(0, -1.35, -0.08);
  g.add(neck);
  const look = {
    scout: { body: '#6b4a30', arm: '#6b4a30', under: '#2a2f37', trim: '#3a2a1d' },
    pilot: { body: '#58664e', arm: '#58664e', under: '#3a4335', trim: '#262a24' },
    trader: { body: '#4a2a46', arm: '#4a2a46', under: '#d8cdb4', trim: '#c4a04a' },
  }[state.outfit] || {};
  const bodyMat = cloth(look.body), armMat = cloth(look.arm), underMat = cloth(look.under), trimMat = cloth(look.trim, 0.6);
  const torso = new THREE.Mesh(torsoGeo(s), bodyMat);
  g.add(torso);
  // shoulders and upper arms, hanging a little out from the body
  const sx = 1.22 * s;
  for (const k of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.42 * Math.sqrt(s), 14, 10), armMat);
    sh.position.set(k * sx, -2.36, -0.02);
    g.add(sh);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.32 * Math.sqrt(s), 1.8, 6, 12), armMat);
    arm.position.set(k * (sx + 0.08), -3.5, -0.02);
    arm.rotation.z = k * 0.1;
    g.add(arm);
  }
  figure.add(g);
  g.updateMatrixWorld(true);
  const at = (x, y) => front(torso, x, y);
  if (state.outfit === 'scout') {
    // an open-necked field jacket over a dark shirt, a long scarf, and a strap across the chest with two pouches
    const v1 = at(-0.42, -2.0), v2 = at(0.42, -2.0), v3 = at(0, -3.25);
    if (v1 && v2 && v3) {
      const shirt = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([v1.p.clone().addScaledVector(v1.n, 0.02), v2.p.clone().addScaledVector(v2.n, 0.02), v3.p.clone().addScaledVector(v3.n, 0.02)]), underMat);
      shirt.geometry.computeVertexNormals(); shirt.material.side = THREE.DoubleSide; g.add(shirt);
    }
    const scarfMat = cloth('#9a4b33');
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.2, 8, 20), scarfMat);
    wrap.position.set(0, -1.86, -0.04); wrap.rotation.x = Math.PI / 2 - 0.12; wrap.scale.set(1.08, 1, 0.9); g.add(wrap);
    const t1 = at(-0.18, -2.0), t2 = at(-0.3, -3.2), t3 = at(0.02, -2.0), t4 = at(0.0, -2.8);
    if (t1 && t2) strap(g, scarfMat, t1, t2, 0.3, 0.07);
    if (t3 && t4) strap(g, scarfMat, t3, t4, 0.26, 0.1);
    const a = at(0.62 * s, -2.05), m = at(0.05, -3.2), b = at(-0.62 * s, -4.35);
    if (a && m) strap(g, trimMat, a, m, 0.15, 0.1);
    if (m && b) strap(g, trimMat, m, b, 0.15, 0.1);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.08, 6, 28), trimMat);
    belt.position.set(0, -4.4, 0); belt.rotation.x = Math.PI / 2; belt.scale.set(1.16 * TW * s * 1.03, 1.16 * (TD + (s - 1) * 0.3) * 1.07, 1); g.add(belt);
    const bk = at(0.25, -4.4);
    if (bk) { const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.06), cloth('#b08a4a', 0.5)); buckle.position.copy(bk.p).addScaledVector(bk.n, 0.1); buckle.lookAt(buckle.position.clone().add(bk.n)); g.add(buckle); }
  } else if (state.outfit === 'pilot') {
    // a one-piece flight suit: a padded collar ring, a harness in a V to a chest unit, a patch on the shoulder
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.16, 8, 22), cloth('#3a4335'));
    ring.position.set(0, -1.86, -0.05); ring.rotation.x = Math.PI / 2 - 0.1; g.add(ring);
    const c = at(0, -2.85);
    for (const k of [-1, 1]) {
      const top = at(k * 0.78 * s, -2.05);
      if (top && c) strap(g, trimMat, top, c, 0.16, 0.13);
    }
    const belt = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 6, 28), trimMat);
    belt.position.set(0, -4.3, 0); belt.rotation.x = Math.PI / 2; belt.scale.set(1.18 * TW * s * 1.02, 1.18 * (TD + (s - 1) * 0.3) * 1.05, 1); g.add(belt);
    if (c) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.18), cloth('#2c2f33', 0.5));
      box.position.copy(c.p).addScaledVector(c.n, 0.1); box.lookAt(box.position.clone().add(c.n)); g.add(box);
      ['#d24a3a', '#e7c24a', '#4cb07a'].forEach((col, i) => {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.05), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6 }));
        led.position.set(-0.16 + i * 0.16, 0.06, 0.1); box.add(led);
      });
    }
    const patch = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12), cloth('#c8613a'));
    patch.position.set(-(sx + 0.06), -2.62, 0.28); patch.rotation.set(Math.PI / 2, 0, 0.3); g.add(patch);
  } else {
    // a long merchant's coat: wide lapels with a gilt edge over a pale shirt, a stiff collar behind the neck, a sash
    const v1 = at(-0.36, -2.0), v2 = at(0.36, -2.0), v3 = at(0, -3.4);
    if (v1 && v2 && v3) {
      const shirt = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([v1.p.clone().addScaledVector(v1.n, 0.02), v2.p.clone().addScaledVector(v2.n, 0.02), v3.p.clone().addScaledVector(v3.n, 0.02)]), underMat);
      shirt.geometry.computeVertexNormals(); shirt.material.side = THREE.DoubleSide; g.add(shirt);
    }
    const lapelMat = cloth('#6a3b62');
    for (const k of [-1, 1]) {
      const top = at(k * 0.42, -2.0), low = at(k * 0.06, -3.45), out = at(k * 0.9 * s, -2.5);
      if (top && low) { strap(g, lapelMat, top, low, 0.42, 0.06); strap(g, trimMat, top, low, 0.06, 0.1).translateX(k * 0.2); }
      if (top && out) strap(g, lapelMat, top, out, 0.3, 0.05);
    }
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.75, 20, 1, true, Math.PI * 0.55, Math.PI * 0.9), new THREE.MeshStandardMaterial({ color: look.body, roughness: 0.8, flatShading: true, side: THREE.DoubleSide }));
    collar.position.set(0, -1.55, -0.12); g.add(collar);
    const sash = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.1, 6, 28), trimMat);
    sash.position.set(0, -4.25, 0); sash.rotation.x = Math.PI / 2; sash.scale.set(1.18 * TW * s * 1.03, 1.18 * (TD + (s - 1) * 0.3) * 1.07, 1); g.add(sash);
    const clasp = at(0, -4.25);
    if (clasp) { const cl = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), trimMat); cl.position.copy(clasp.p).addScaledVector(clasp.n, 0.12); g.add(cl); }
  }
  bodyParts = g;
}

function recolour() {
  skinMat.color.set(pick('skin', state.skin).c);
  skinSmooth.color.set(pick('skin', state.skin).c);
  const e = pick('eyes', state.eyes).c;
  eyeMat.color.set(e);
  eyeMat.emissive.set(e).multiplyScalar(0.12);
  eyeSculpted.color.set(e);
  eyeSculpted.emissive.set(e).multiplyScalar(0.08);
  mouthMat.color.set(pick('skin', state.skin).c).multiplyScalar(0.28);
}

/* ---------------- the panel ---------------- */
function summary() {
  const s = (k) => pick(k, state[k]).name.toLowerCase();
  document.getElementById('summary').textContent = `${pick('build', state.build).name} build, ${s('skin')} skin, ${s('eyes')} eyes, ${s('head')} head, ${s('outfit')}.`;
}
function paint() {
  for (const el of document.querySelectorAll('[data-opt]')) {
    const opt = el.dataset.opt;
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.key === state[opt]));
  }
  summary();
}
function set(opt, keyName) {
  if (state[opt] === keyName) return;
  state[opt] = keyName;
  if (opt === 'head' || opt === 'detail') buildHead();
  if (opt === 'build' || opt === 'outfit' || opt === 'detail') buildBody();
  recolour(); paint(); writeHash();
}
for (const el of document.querySelectorAll('[data-opt]')) {
  const opt = el.dataset.opt, swatch = el.classList.contains('swatches');
  for (const o of OPTIONS[opt]) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.key = o.key;
    if (swatch) { b.className = 'sw'; b.style.setProperty('--c', o.c); b.setAttribute('aria-label', o.name); b.innerHTML = `<span class="tip">${o.name}</span>`; }
    else b.textContent = o.name;
    b.addEventListener('click', () => set(opt, o.key));
    el.appendChild(b);
  }
}
document.getElementById('random').addEventListener('click', () => {
  for (const k of Object.keys(OPTIONS)) state[k] = OPTIONS[k][Math.floor(Math.random() * OPTIONS[k].length)].key;
  buildHead(); buildBody(); recolour(); paint(); writeHash();
});

// the portrait: the current view, square, 1024 px, on a transparent or a plain background
document.getElementById('save').addEventListener('click', () => {
  const plain = document.getElementById('plainbg').checked, size = 1024;
  const keep = { w: canvas.clientWidth, h: canvas.clientHeight, pr: renderer.getPixelRatio(), aspect: camera.aspect };
  renderer.setPixelRatio(1); renderer.setSize(size, size, false);
  camera.aspect = 1; camera.fov = fovFor(1); camera.updateProjectionMatrix();
  renderer.setClearColor(0x16202f, plain ? 1 : 0);
  renderer.render(scene, camera);
  const url = canvas.toDataURL('image/png');
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(keep.pr); renderer.setSize(keep.w, keep.h, false);
  camera.aspect = keep.aspect; camera.fov = fovFor(keep.aspect); camera.updateProjectionMatrix();
  const a = document.createElement('a');
  a.href = url; a.download = `duros-${state.skin}-${state.outfit}.png`;
  document.body.appendChild(a); a.click(); a.remove();
});

/* ---------------- run ---------------- */
// wide enough for the shoulders on a narrow screen, tall enough for the whole head (a high dome too) on a wide one
const fovFor = (aspect) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(2.95, 2.4 / aspect) / 8.7));
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const pr = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = fovFor(w / h);
  camera.updateProjectionMatrix();
}
const hint = document.getElementById('hint');
controls.addEventListener('start', () => hint.classList.add('gone'));
const t0 = performance.now();
function frame() {
  const t = (performance.now() - t0) / 1000;
  resize();
  if (bodyParts) bodyParts.scale.y = 1 + Math.sin(t * 1.5) * 0.004;   // breathing, barely
  headPivot.rotation.x = Math.sin(t * 0.6) * 0.025;
  headPivot.rotation.y = Math.sin(t * 0.37) * 0.04;
  controls.update();
  renderer.render(scene, camera);
}
buildHead(); buildBody(); recolour(); paint();
renderer.setAnimationLoop(frame);
window.__duros = { state, set };   // for a quick look from the console
