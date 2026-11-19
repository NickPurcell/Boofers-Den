// Human base test: MakeHuman's public-domain (CC0) base mesh and morph targets, loaded from our own compact files
// (data/, see data/NOTICE.md) and shaped here by numbers. Everything in this file is our own: the loader, the way the
// morphs are blended, the skin, the eyes and the page. The scene, lights and controls are the creator kit's stage.
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';

const $ = (id) => document.getElementById(id);
const stage = makeStage($('scene'), { tall: 1.8, minDistance: 0.22, maxDistance: 6, environment: 0.55 });

/* ---------------- what can be set ---------------- */
// body: [key, label, min, max, default]
const BODY = [['gender', 'Gender', 0, 1, 0.5], ['age', 'Age', 0, 1, 0], ['muscle', 'Muscle', 0, 1, 0.5], ['weight', 'Weight', 0, 1, 0.5],
  ['height', 'Height', -1, 1, 0], ['shoulders', 'Shoulders', -1, 1, 0], ['neck', 'Neck', -1, 1, 0]];
// face: [key, label, target for the low end, target for the high end]
const FACE = [['browh', 'Brow height', 'brow-down', 'brow-up'], ['browr', 'Brow ridge', 'brow-back', 'brow-forward'], ['browa', 'Brow angle', 'browangle-down', 'browangle-up'],
  ['forehead', 'Forehead', 'forehead-back', 'forehead-forward'], ['eyesize', 'Eye size', 'eyesize-decr', 'eyesize-incr'], ['eyespace', 'Eye spacing', 'eyespace-in', 'eyespace-out'],
  ['eyebags', 'Under eyes', 'eyebag-decr', 'eyebag-incr'], ['nosew', 'Nose width', 'nosewidth-decr', 'nosewidth-incr'], ['nosel', 'Nose length', 'noselength-decr', 'noselength-incr'],
  ['nosehump', 'Nose bridge', 'nosehump-decr', 'nosehump-incr'], ['nostrils', 'Nostrils', 'noseflare-decr', 'noseflare-incr'], ['mouthw', 'Mouth width', 'mouthwidth-decr', 'mouthwidth-incr'],
  ['lips', 'Lips', 'lips-decr', 'lips-incr'], ['corners', 'Mouth corners', 'mouthcorners-down', 'mouthcorners-up'], ['cheekbones', 'Cheekbones', 'cheekbones-decr', 'cheekbones-incr'],
  ['cheeks', 'Cheeks', 'cheeks-decr', 'cheeks-incr'], ['chinw', 'Chin width', 'chinwidth-decr', 'chinwidth-incr'], ['chinjut', 'Chin forward', 'chinjut-decr', 'chinjut-incr'],
  ['chinh', 'Chin height', 'chinheight-decr', 'chinheight-incr'], ['jaw', 'Jaw', 'jaw-decr', 'jaw-incr'], ['headfat', 'Head fullness', 'headfat-decr', 'headfat-incr'],
  ['headage', 'Head age', 'headage-decr', 'headage-incr']];
const SHAPE = [['square', 'Square', 'head-square'], ['oval', 'Oval', 'head-oval'], ['round', 'Round', 'head-round']];
const SKINS = { pale: '#ecd2c2', light: '#d9b49c', medium: '#b98e72', tan: '#9a7357', brown: '#6f4d39', deep: '#45302a', red: '#8e2f27', crimson: '#6c1e1a', grey: '#8d949b' };
const EYES = { brown: ['#5a3418', 0], hazel: ['#7a6a2c', 0], green: ['#4f7a3a', 0], blue: ['#4a7fb8', 0], grey: ['#8a949c', 0], amber: ['#d0901c', 0.6], ember: ['#ff9c14', 1.3] };
const DEFAULT = { skin: 'medium', eyes: 'brown' };
for (const [k, , , , d] of BODY) DEFAULT[k] = d;
for (const [k] of FACE) DEFAULT[k] = 0;
for (const [k] of SHAPE) DEFAULT[k] = 0;
const PRESETS = {
  neutral: {},
  // a heavy, wide-shouldered man with a strong brow and jaw, red skin and orange-yellow eyes
  heavy: { gender: 1, age: 0.06, muscle: 0.88, weight: 0.92, height: 0.22, shoulders: 0.85, neck: 0.7, browh: -0.2, browr: 0.45, browa: -0.2, forehead: 0.1, eyesize: -0.2,
    eyebags: 0.2, nosew: 0.35, nosel: 0.1, nosehump: 0.35, nostrils: 0.25, mouthw: 0.15, lips: -0.15, corners: -0.25, cheekbones: 0.7, cheeks: -0.25, chinw: 0.55, chinjut: 0.35,
    chinh: 0.15, jaw: 0.9, headfat: 0.1, headage: 0.3, square: 0.45, skin: 'red', eyes: 'ember' },
};
const state = { ...DEFAULT };
const num = (k, v) => { const b = BODY.find((x) => x[0] === k); const lo = b ? b[2] : SHAPE.some((x) => x[0] === k) ? 0 : -1, hi = b ? b[3] : 1; return Math.min(hi, Math.max(lo, Number(v) || 0)); };
function readHash() {
  const q = new URLSearchParams(location.hash.slice(1));
  for (const [k, v] of q) { if (k === 'skin' && SKINS[v]) state.skin = v; else if (k === 'eyes' && EYES[v]) state.eyes = v; else if (k in DEFAULT && k !== 'skin' && k !== 'eyes') state[k] = num(k, v); }
}
const writeHash = () => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(state)) if (v !== DEFAULT[k]) q.set(k, typeof v === 'number' ? v.toFixed(2) : v); history.replaceState(null, '', '#' + q.toString()); };

/* ---------------- the morphs: which targets, how much ---------------- */
// muscle and weight each run min .. average .. max; a value between two gives each its share
const thirds = (v) => (v < 0.5 ? [['min', 1 - v * 2], ['average', v * 2]] : [['average', 2 - v * 2], ['max', v * 2 - 1]]);
function weights(s) {
  const W = new Map(), add = (n, w) => { if (Math.abs(w) > 1e-4) W.set(n, (W.get(n) || 0) + w); };
  for (const [g, gw] of [['female', 1 - s.gender], ['male', s.gender]]) {
    add(`${g}-young`, gw * (1 - s.age)); add(`${g}-old`, gw * s.age);
    for (const [m, mw] of thirds(s.muscle)) for (const [w, ww] of thirds(s.weight)) if (!(m === 'average' && w === 'average')) add(`${g}-${m}muscle-${w}weight`, gw * mw * ww);
    add(`${g}-${s.height < 0 ? 'min' : 'max'}height`, gw * Math.abs(s.height) * 0.5);
  }
  const two = (v, lo, hi) => add(v < 0 ? lo : hi, Math.abs(v));
  two(s.shoulders, 'vshape-decr', 'vshape-incr'); two(s.neck, 'neck-decr', 'neck-incr');
  for (const [k, , lo, hi] of FACE) two(s[k], lo, hi);
  for (const [k, , t] of SHAPE) add(t, s[k]);
  return W;
}

/* ---------------- the skin ---------------- */
// fine noise for pores and a broad one for mottling, made here
function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4), h = (x, y, s) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const vn = (u, v, p, s) => { const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, w = (a) => ((a % p) + p) % p, a = h(w(i), w(j), s), b = h(w(i + 1), w(j), s), c = h(w(i), w(j + 1), s), d = h(w(i + 1), w(j + 1), s), su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv); return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, o = (x + y * size) * 4;
    data[o] = 255 * vn(u * 64, v * 64, 64, 1);                                         // pores
    data[o + 1] = 255 * (0.6 * vn(u * 8, v * 8, 8, 2) + 0.4 * vn(u * 16, v * 16, 16, 3));   // mottling
    data[o + 2] = 255 * vn(u * 128, v * 128, 128, 4);                                  // finest grain
    data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
function skinMaterial(noise) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.56, metalness: 0, specularIntensity: 0.45, sheen: 0.18, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffe6dc) });
  const u = { uSkin: { value: new THREE.Color() }, uLip: { value: new THREE.Color() }, uNoise: { value: noise }, uSuit: { value: new THREE.Color(0x2b3038) }, uWrap: { value: 0.32 }, uScatter: { value: new THREE.Vector3(0.55, 0.24, 0.15) } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute float aLip; attribute vec3 aRest; varying float vLip; varying vec3 vOP; varying vec3 vON; varying vec3 vRest;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLip = aLip; vOP = position; vON = normal; vRest = aRest;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `uniform vec3 uSkin; uniform vec3 uLip; uniform sampler2D uNoise; uniform float uWrap; uniform vec3 uScatter;
varying float vLip; varying vec3 vOP; varying vec3 vON; varying vec3 vRest; uniform vec3 uSuit; float sHeight; float sSuit;
vec4 tri(vec3 p, vec3 bw, float s) { return texture2D(uNoise, p.zy * s) * bw.x + texture2D(uNoise, p.xz * s) * bw.y + texture2D(uNoise, p.xy * s) * bw.z; }
#include <common>`)
      .replace('#include <color_fragment>', `
  vec3 bw = pow(abs(normalize(vON)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  vec4 nF = tri(vOP, bw, 3.2), nB = tri(vOP, bw, 0.9);
  vec3 col = uSkin * mix(0.94, 1.04, nB.g) * mix(0.97, 1.02, nF.b);
  col = mix(col, uLip, smoothstep(0.15, 0.7, vLip) * 0.75);
  // a plain undersuit from the waist to mid-thigh, placed in the base mesh's own coordinates so it follows every morph
  // (decimetres; the arms hang out past |x| = 2.6 in the base pose, so they stay bare)
  float waist = 1.05 - 0.12 * smoothstep(0.0, 1.2, abs(vRest.x)), hem = -2.35 + 0.18 * smoothstep(0.4, 1.6, abs(vRest.x));
  sSuit = smoothstep(hem - 0.02, hem + 0.02, vRest.y) * (1.0 - smoothstep(waist - 0.02, waist + 0.02, vRest.y)) * (1.0 - smoothstep(2.5, 2.6, abs(vRest.x)));
  float rib = smoothstep(waist - 0.16, waist - 0.12, vRest.y) + (1.0 - smoothstep(hem + 0.1, hem + 0.14, vRest.y));
  col = mix(col, uSuit * mix(0.92, 1.05, nF.b) * (1.0 - 0.18 * rib), sSuit);
  diffuseColor.rgb = col;
  sHeight = (nF.r * 0.7 + nF.b * 0.3) * 0.00012;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness * mix(0.9, 1.12, nF.r) * mix(1.0, 0.82, smoothstep(0.15, 0.7, vLip)), 0.86, sSuit);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { vec3 sp = -vViewPosition, dpx = dFdx(sp), dpy = dFdy(sp); float hx = dFdx(sHeight), hy = dFdy(sHeight);
    vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
    normal = normalize(abs(det) * normal - sign(det) * (hx * r1 + hy * r2)); }`)
      // light that goes into skin comes out a little way off, redder: the diffuse term wraps past the shadow line,
      // the red furthest
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        `{ float wr = saturate( ( dot( geometryNormal, directLight.direction ) + uWrap ) / ( 1.0 + uWrap ) );
           vec3 lit = mix( vec3( dotNL ), vec3( wr * wr ), uScatter );
           reflectedLight.directDiffuse += lit * directLight.color * BRDF_Lambert( material.diffuseColor ); }`));
  };
  m.customProgramCacheKey = () => 'hb-skin-2';
  return m;
}

/* ---------------- the eyes: our own, placed where the base mesh's eye helpers are ---------------- */
function eyeTexture(hex, glow) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 512; const g = c.getContext('2d');
  // rows run from the front of the eye (top) to the back; the iris is a disc round the front pole
  const iris = 0.165, pupil = 0.055, col = new THREE.Color(hex);
  g.fillStyle = '#e9e2da'; g.fillRect(0, 0, 64, 512);
  const grd = g.createLinearGradient(0, iris * 512, 0, 512); grd.addColorStop(0, 'rgba(170,120,110,0.0)'); grd.addColorStop(0.5, 'rgba(190,120,110,0.18)'); grd.addColorStop(1, 'rgba(160,90,80,0.35)');
  g.fillStyle = grd; g.fillRect(0, iris * 512, 64, 512);
  for (let y = 0; y < iris * 512; y++) {
    const t = y / (iris * 512), k = t < pupil / iris ? 0 : 0.55 + 0.6 * (1 - Math.abs(t - 0.62) * 1.6);
    g.fillStyle = `rgb(${255 * col.r * k | 0},${255 * col.g * k | 0},${255 * col.b * k | 0})`; g.fillRect(0, y, 64, 1);
  }
  for (let x = 0; x < 64; x += 2) { g.fillStyle = `rgba(0,0,0,${0.12 + 0.12 * ((x * 7) % 5) / 5})`; g.fillRect(x, pupil * 512, 1, (iris - pupil) * 512); }   // the iris's fibres
  g.fillStyle = 'rgba(20,12,8,0.75)'; g.fillRect(0, iris * 512 - 3, 64, 4);   // the dark ring at its edge
  g.fillStyle = '#050403'; g.fillRect(0, 0, 64, pupil * 512);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const e = document.createElement('canvas'); e.width = 4; e.height = 512; const eg = e.getContext('2d'); eg.fillStyle = '#000'; eg.fillRect(0, 0, 4, 512);
  if (glow) { eg.fillStyle = hex; eg.fillRect(0, pupil * 512, 4, (iris - pupil) * 512); }
  const em = new THREE.CanvasTexture(e); em.colorSpace = THREE.SRGBColorSpace;
  return { map, em };
}
const eyeGeo = new THREE.SphereGeometry(1, 48, 32).rotateX(Math.PI / 2);   // the pole the iris is drawn round faces +z
const eyeMat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0xffffff, emissiveIntensity: 0 });
const eyes = { l: new THREE.Mesh(eyeGeo, eyeMat), r: new THREE.Mesh(eyeGeo, eyeMat) };
function paintEyes() {
  const [hex, glow] = EYES[state.eyes], t = eyeTexture(hex, glow);
  if (eyeMat.map) { eyeMat.map.dispose(); eyeMat.emissiveMap.dispose(); }
  eyeMat.map = t.map; eyeMat.emissiveMap = t.em; eyeMat.emissiveIntensity = glow; eyeMat.needsUpdate = true;
}

/* ---------------- load ---------------- */
const t0 = performance.now();
const [info, meshBuf, tBuf] = await Promise.all([fetch('data/mesh.json').then((r) => r.json()), fetch('data/mesh.bin').then((r) => r.arrayBuffer()), fetch('data/targets.bin').then((r) => r.arrayBuffer())]);
const N = info.vertices, base = new Float32Array(meshBuf, 0, N * 3), index = new Uint16Array(meshBuf, N * 12, info.triangles * 3);
const T = {};
for (const [name, m] of Object.entries(info.targets)) {
  const q = new Int16Array(tBuf, m.at, m.n * 3), d = new Float32Array(m.n * 3);
  for (let k = 0; k < d.length; k++) d[k] = q[k] * m.scale;
  T[name] = { d, idx: new Uint16Array(tBuf, m.at + m.n * 6, m.n) };
}
const loadMs = Math.round(performance.now() - t0);
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
geo.setIndex(new THREE.BufferAttribute(index, 1));
{ // where the lips are: the vertices the lip-fullness morph moves most
  const lip = new Float32Array(N), t = T['lips-incr']; let big = 0;
  for (let k = 0; k < t.idx.length; k++) big = Math.max(big, Math.hypot(t.d[k * 3], t.d[k * 3 + 1], t.d[k * 3 + 2]));
  for (let k = 0; k < t.idx.length; k++) lip[t.idx[k]] = Math.hypot(t.d[k * 3], t.d[k * 3 + 1], t.d[k * 3 + 2]) / big;
  geo.setAttribute('aLip', new THREE.BufferAttribute(lip, 1));
}
geo.setAttribute('aRest', new THREE.BufferAttribute(base.slice(), 3));
const noise = noiseTexture();
const skin = skinMaterial(noise);
const body = new THREE.Mesh(geo, skin); body.castShadow = body.receiveShadow = true;
for (const e of Object.values(eyes)) { e.castShadow = false; stage.scene.add(e); }
stage.scene.add(body);

/* ---------------- landmarks: named vertices of the base mesh ---------------- */
// The base's vertex order never changes, so a landmark is just a vertex number. These are found once, from the
// unmorphed mesh, by simple rules relative to the eyes; after that every morph carries them along.
const LANDMARK = {};
{
  const ctr = (s) => { const c = [0, 0, 0]; for (const i of info.eyes[s]) for (let k = 0; k < 3; k++) c[k] += base[i * 3 + k] / info.eyes[s].length; return c; };
  const L = ctr('l'), R = ctr('r'), ey = (L[1] + R[1]) / 2, ez = (L[2] + R[2]) / 2, d = Math.abs(L[0] - R[0]), xl = L[0];
  const inFace = new Uint8Array(N); for (let k = 0; k < index.length; k++) inFace[index[k]] = 1;   // vertices of the body, not the eye helpers
  const nearest = (x, y, z) => { let best = -1, bd = Infinity; for (let i = 0; i < N; i++) { if (!inFace[i]) continue; const dx = base[i * 3] - x, dy = base[i * 3 + 1] - y, dz = base[i * 3 + 2] - z, q = dx * dx + dy * dy + dz * dz; if (q < bd) { bd = q; best = i; } } return best; };
  const extreme = (ok, f) => { let best = -1, bv = -Infinity; for (let i = 0; i < N; i++) { if (!inFace[i]) continue; const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2]; if (ok(x, y, z) && f(x, y, z) > bv) { bv = f(x, y, z); best = i; } } return best; };
  const mid = (x) => Math.abs(x) < 0.08 * d;
  LANDMARK.noseTip = extreme((x, y) => mid(x) && y < ey && y > ey - d, (x, y, z) => z);
  LANDMARK.chin = extreme((x, y, z) => mid(x) && y < ey - 1.5 * d && y > ey - 2.3 * d && z > ez - 0.5 * d, (x, y, z) => z);
  LANDMARK.crown = extreme((x) => mid(x), (x, y) => y);
  LANDMARK.browMid = nearest(0, ey + 0.32 * d, ez + 0.6 * d);
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    LANDMARK['brow' + s] = nearest(sx * Math.abs(xl), ey + 0.3 * d, ez + 0.6 * d);
    const ax = Math.abs(xl);
    // the cheekbone: the point that stands out furthest forward-and-sideways a little below and outside the eye
    LANDMARK['cheek' + s] = extreme((x, y, z) => Math.abs(y - (ey - 0.42 * d)) < 0.12 * d && sx * x > ax * 1.15 && sx * x < ax * 1.9, (x, y, z) => sx * x * 0.75 + z * 0.66);
    // the temple: furthest out to the side, level with the brow, behind the eye
    LANDMARK['temple' + s] = extreme((x, y, z) => Math.abs(y - (ey + 0.3 * d)) < 0.12 * d && z < ez - 0.15 * d && z > ez - 0.9 * d, (x, y, z) => sx * x);
    // the angle of the jaw: furthest out to the side, low on the face, below the ear
    LANDMARK['jaw' + s] = extreme((x, y, z) => y < ey - 1.15 * d && y > ey - 1.55 * d && z < ez - 0.35 * d && z > ez - 1.2 * d, (x, y, z) => sx * x);
  }
}
// a marker on each landmark, and a test spur standing out of the surface on a few of them (meshed on its own, joined on)
const marks = new THREE.Group(); marks.visible = false; stage.scene.add(marks);
const dotGeo = new THREE.SphereGeometry(0.0042, 12, 8), dotMat = new THREE.MeshBasicMaterial({ color: 0x35f58a, toneMapped: false });
const spurGeo = new THREE.ConeGeometry(0.0055, 0.028, 14, 1).translate(0, 0.014, 0), spurMat = new THREE.MeshStandardMaterial({ color: 0xd9cbb0, roughness: 0.55 });
const SPURS = ['cheekL', 'cheekR', 'chin', 'templeL', 'templeR'];
const markObjs = Object.keys(LANDMARK).map((k) => { const o = new THREE.Group(); o.add(new THREE.Mesh(dotGeo, dotMat)); if (SPURS.includes(k)) { const sp = new THREE.Mesh(spurGeo, spurMat); sp.castShadow = true; o.add(sp); } marks.add(o); return [k, o]; });
const _n = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function placeMarks(p, nrm) { for (const [k, o] of markObjs) { const i = LANDMARK[k]; o.position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); _n.set(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]).normalize(); o.quaternion.setFromUnitVectors(_up, _n); } }

/* ---------------- shape it ---------------- */
const work = new Float32Array(N * 3), eyeAt = { l: new THREE.Vector3(), r: new THREE.Vector3() };
let figureHeight = 0;
function morph() {
  const t = performance.now();
  work.set(base);
  for (const [name, w] of weights(state)) {
    const tg = T[name]; if (!tg) continue;
    const { d, idx } = tg;
    for (let k = 0; k < idx.length; k++) { const i = idx[k] * 3, j = k * 3; work[i] += w * d[j]; work[i + 1] += w * d[j + 1]; work[i + 2] += w * d[j + 2]; }
  }
  // decimetres to metres, feet on the floor
  let lo = Infinity, hi = -Infinity; for (let i = 1; i < work.length; i += 3) { if (work[i] < lo) lo = work[i]; if (work[i] > hi) hi = work[i]; }
  const p = geo.attributes.position.array;
  for (let i = 0; i < work.length; i += 3) { p[i] = work[i] * 0.1; p[i + 1] = (work[i + 1] - lo) * 0.1; p[i + 2] = work[i + 2] * 0.1; }
  figureHeight = (hi - lo) * 0.1;
  geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere();
  placeMarks(p, geo.attributes.normal.array);
  for (const s of ['l', 'r']) {   // each eye where its helper sphere is, at its size
    const b = new THREE.Box3(); for (const i of info.eyes[s]) b.expandByPoint(new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
    const c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
    eyes[s].position.copy(c); eyes[s].scale.setScalar((sz.x + sz.y + sz.z) / 6 * 0.98); eyeAt[s].copy(c);
  }
  stage.changed();
  return Math.round(performance.now() - t);
}
function colours() {
  skin.userData.u.uSkin.value.set(SKINS[state.skin]);   // (set() already takes a hex in sRGB to the working space)
  const lip = new THREE.Color(SKINS[state.skin]); const hsl = {}; lip.getHSL(hsl); lip.setHSL(hsl.h * 0.96, Math.min(1, hsl.s * 1.1 + 0.05), hsl.l * 0.8);
  skin.userData.u.uLip.value.copy(lip);
  paintEyes(); stage.redraw();
}

/* ---------------- the panel ---------------- */
const panel = $('options'), inputs = {};
function slider(parent, k, label, lo, hi) {
  const row = document.createElement('label'); row.className = 'slide';
  const name = document.createElement('span'); name.textContent = label;
  const r = document.createElement('input'); r.type = 'range'; r.min = lo; r.max = hi; r.step = 0.01; r.value = state[k];
  const out = document.createElement('output'); out.textContent = Number(state[k]).toFixed(2);
  r.addEventListener('input', () => { state[k] = Number(r.value); out.textContent = Number(r.value).toFixed(2); schedule(); });
  row.append(name, r, out); parent.appendChild(row); inputs[k] = [r, out];
}
function group(title, open) { const d = document.createElement('details'); d.className = 'group'; d.open = open; const s = document.createElement('summary'); s.textContent = title; d.appendChild(s); panel.appendChild(d); return d; }
function swatches(parent, label, key, table) {
  const fs = document.createElement('fieldset'); fs.className = 'opt'; const lg = document.createElement('legend'); lg.textContent = label; fs.appendChild(lg);
  const box = document.createElement('div'); box.className = 'swatches'; box.dataset.opt = key;
  for (const [k, v] of Object.entries(table)) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sw'; b.dataset.key = k; b.title = k; b.setAttribute('aria-label', k); b.style.setProperty('--c', Array.isArray(v) ? v[0] : v);
    b.addEventListener('click', () => { state[key] = k; paintSwatches(); colours(); writeHash(); }); box.appendChild(b);
  }
  fs.appendChild(box); parent.appendChild(fs);
}
function paintSwatches() { for (const el of document.querySelectorAll('[data-opt]')) for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.key === state[el.dataset.opt])); }
const gb = group('Body', true); for (const [k, l, lo, hi] of BODY) slider(gb, k, l, lo, hi);
const gc = group('Colour', true); swatches(gc, 'Skin', 'skin', SKINS); swatches(gc, 'Eyes', 'eyes', EYES);
const gf = group('Face', true); for (const [k, l] of FACE) slider(gf, k, l, -1, 1);
const gs = group('Head shape', false); for (const [k, l] of SHAPE) slider(gs, k, l, 0, 1);
{ // a test of attaching things at named vertices
  const gt = group('Test', false), row = document.createElement('label'); row.className = 'slide';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.addEventListener('change', () => { marks.visible = cb.checked; stage.changed(); });
  const t = document.createElement('span'); t.textContent = 'Show landmarks and test spurs'; t.style.gridColumn = '2 / 4';
  row.append(cb, t); gt.appendChild(row);
}
function syncPanel() { for (const [k, [r, out]] of Object.entries(inputs)) { r.value = state[k]; out.textContent = Number(state[k]).toFixed(2); } paintSwatches(); }
let pending = 0;
function schedule() { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; const ms = morph(); showStats(ms); writeHash(); }); }
function showStats(ms) {
  const ft = figureHeight / 0.3048, f = Math.floor(ft), inch = Math.round((ft - f) * 12);
  $('stats').textContent = `${N.toLocaleString()} vertices, ${info.triangles.toLocaleString()} triangles. Data loaded in ${loadMs} ms; a reshape takes ${ms} ms. Height ${figureHeight.toFixed(2)} m (${f}'${inch}").`;
}
function preset(name) { Object.assign(state, DEFAULT, PRESETS[name] || {}); syncPanel(); colours(); const ms = morph(); showStats(ms); writeHash(); }
for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', () => preset(b.dataset.preset));
$('random').addEventListener('click', () => {
  const r = (a) => (Math.random() * 2 - 1) * a;
  for (const [k, , lo, hi] of BODY) state[k] = Math.min(hi, Math.max(lo, (lo + hi) / 2 + r((hi - lo) / 2 * 0.8)));
  state.age = Math.random() * 0.6;
  for (const [k] of FACE) state[k] = Math.round(r(0.7) * 100) / 100;
  for (const [k] of SHAPE) state[k] = Math.random() < 0.4 ? Math.round(Math.random() * 70) / 100 : 0;
  const sk = Object.keys(SKINS), ey = Object.keys(EYES); state.skin = sk[Math.floor(Math.random() * sk.length)]; state.eyes = ey[Math.floor(Math.random() * ey.length)];
  syncPanel(); colours(); showStats(morph()); writeHash();
});

/* ---------------- views ---------------- */
function headAt() { return new THREE.Vector3().addVectors(eyeAt.l, eyeAt.r).multiplyScalar(0.5); }
const VIEWS = {
  full: () => { const h = figureHeight; return [[0, h * 0.53, 0], [h * 0.75, h * 0.68, h * 2.05]]; },
  face: () => { const e = headAt(); return [[0, e.y - 0.035, e.z - 0.06], [0, e.y + 0.01, e.z + 0.74]]; },
  three: () => { const e = headAt(); return [[0, e.y - 0.035, e.z - 0.06], [0.5, e.y + 0.04, e.z + 0.52]]; },
  profile: () => { const e = headAt(); return [[0, e.y - 0.035, e.z - 0.06], [0.76, e.y + 0.01, e.z - 0.06]]; },
};
const view = (name) => { const [t, p] = VIEWS[name](); stage.view(t, p); };
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view(b.dataset.view));

/* ---------------- run ---------------- */
readHash(); syncPanel(); colours(); showStats(morph()); view('full');
stage.controls.addEventListener('start', () => $('hint').classList.add('gone'));
$('status').classList.add('gone');
stage.start();
window.__hb = { THREE, stage, state, morph, marks, LANDMARK, colours, preset, view, VIEWS, eyes, eyeAt, info, get height() { return figureHeight; }, loadMs, set(k, v) { state[k] = v; syncPanel(); colours(); return morph(); } };
