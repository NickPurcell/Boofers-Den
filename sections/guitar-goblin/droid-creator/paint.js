// The droid's finish. One material paints nearly the whole unit: each vertex says what it is (painted in the first or
// second colour, bright metal, dark metal, brass, rubber, steel) and how near it is to a panel's edge, and the shader
// does the rest: paint (or plating, for a metallic finish) that chips along edges, scuffs, grime in the seams,
// streaks, dust thrown up from the ground, tarnish. How worn is one number, so it changes without rebuilding anything. The noise it uses is
// made here in code; nothing is downloaded.
import * as THREE from 'three';

/* ---------------- tileable noise ---------------- */
function hash(i, j, seed) { let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const wrap = (i, p) => ((i % p) + p) % p;
function valueNoise(u, v, pu, pv, seed) {   // u, v in cells; wraps every pu cells across and pv up
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const a = hash(wrap(i, pu), wrap(j, pv), seed), b = hash(wrap(i + 1, pu), wrap(j, pv), seed);
  const c = hash(wrap(i, pu), wrap(j + 1, pv), seed), d = hash(wrap(i + 1, pu), wrap(j + 1, pv), seed);
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
function fbm(u, v, pu, pv, octaves, seed) { let s = 0, amp = 0.5, f = 1; for (let o = 0; o < octaves; o++) { s += amp * valueNoise(u * f, v * f, pu * f, pv * f, seed + o); amp *= 0.5; f *= 2; } return s; }
function cells(u, v, period, seed) {   // [distance to the nearest cell point, that cell's own random number]
  const i = Math.floor(u), j = Math.floor(v); let d1 = 9, id = 0;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ci = i + di, cj = j + dj, wi = wrap(ci, period), wj = wrap(cj, period);
    const d = Math.hypot(ci + hash(wi, wj, seed) - u, cj + hash(wi, wj, seed + 7) - v);
    if (d < d1) { d1 = d; id = hash(wi, wj, seed + 13); }
  }
  return [d1, id];
}
// One texture, four kinds of noise: R broad cloud, G blobs with ragged edges (chips), B fine grain, A long streaks.
export function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, o = (x + y * size) * 4;
    const [d1, id] = cells(u * 9, v * 9, 9, 5);
    const blob = (1 - Math.min(1, d1 * 1.25)) * (0.35 + 0.65 * id) + 0.3 * (fbm(u * 24, v * 24, 24, 24, 3, 17) - 0.5);
    data[o] = 255 * fbm(u * 4, v * 4, 4, 4, 5, 3);
    data[o + 1] = 255 * Math.max(0, Math.min(1, blob));
    data[o + 2] = 255 * fbm(u * 32, v * 32, 32, 32, 4, 29);
    data[o + 3] = 255 * fbm(u * 48, v * 3, 48, 3, 3, 41);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

const DECL = /* glsl */ `
uniform vec3 uPrimary; uniform vec3 uSecondary; uniform vec3 uOdd; uniform vec3 uDirt;
uniform float uWear; uniform float uFinish; uniform sampler2D uNoise;
varying vec4 vData; varying vec2 vWuv; varying vec3 vWPos;
float pRough; float pMetal; float pHeight;
`;
const PAINT = /* glsl */ `
{
  float rf = floor(vData.x + 0.5), flag = floor(rf / 8.0), role = rf - flag * 8.0;
  float edge = vData.y, seed = vData.z, corner = step(0.5, vData.w);
  bool fOdd = mod(flag, 2.0) > 0.5, fDrop = mod(floor(flag / 2.0), 2.0) > 0.5;
  float wear = uWear;
  if (fDrop && wear > 0.9) discard;
  vec2 puv = vWuv + vec2(seed * 3.7, seed * 9.1);
  vec4 nA = texture2D(uNoise, puv * 1.7);
  vec4 nB = texture2D(uNoise, puv * 6.1 + 0.31);
  vec4 nS = texture2D(uNoise, vWuv * vec2(1.7, 0.21) + 0.5);
  float brush = texture2D(uNoise, vec2(vWuv.y * 5.0, vWuv.x * 0.45)).a;
  vec4 nD = texture2D(uNoise, vWuv * 0.8 + 0.11);
  vec3 col; float metal = 0.0, rough = 0.5, h = 0.0;
  vec3 bare = vec3(0.62, 0.63, 0.65);
  bool painted = role < 1.5;
  float e = 1.0 - smoothstep(0.0, 0.007, edge);
  if (painted) {
    col = role < 0.5 ? uPrimary : uSecondary;
    if (fOdd && wear > 0.85) col = uOdd;
    // years in the sun: the paint goes chalky and uneven, each panel a little differently
    float fade = wear * (0.25 + 0.5 * nD.r + 0.25 * seed);
    float lum = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(col, mix(col, vec3(lum), 0.45) * 1.08 + 0.015, fade * 0.7);
    rough = mix(0.30, 0.62, wear) + (nB.b - 0.5) * 0.2 * wear;
    // a metallic finish: the same colour, plated rather than painted
    metal = uFinish; rough = mix(rough, 0.24 + 0.22 * wear + (brush - 0.5) * 0.12, uFinish);
    // chips, thickest along the edges
    float n = nA.g * 0.62 + nB.g * 0.30 + (nA.b - 0.5) * 0.25;
    float th = mix(1.25, 0.56, wear) - e * mix(0.06, 0.44, wear) * (1.0 + 0.25 * corner);
    float chip = smoothstep(th, th + 0.025, n);
    float rim = smoothstep(th - 0.06, th - 0.035, n) * (1.0 - chip);
    col = mix(col, col * 0.5 + vec3(0.05, 0.045, 0.04), rim * 0.8);
    col = mix(col, mix(bare, vec3(0.11, 0.10, 0.095), uFinish), chip); metal = mix(metal, mix(1.0, 0.35, uFinish), chip); rough = mix(rough, mix(0.40, 0.6, uFinish), chip);
    h -= chip * 0.00012;
    // scuffs: long thin pale marks
    float sc = smoothstep(0.82, 0.88, texture2D(uNoise, vec2(puv.x * 0.9 + puv.y * 0.35, puv.y * 13.0)).a) * smoothstep(0.25, 0.9, wear) * (1.0 - chip) * smoothstep(0.45, 0.6, nA.r);
    col = mix(col, col * 1.25 + 0.05, sc * 0.5); rough = mix(rough, 0.7, sc);
  } else if (role < 2.5) { col = vec3(0.80, 0.81, 0.83); metal = 1.0; rough = 0.30 + (brush - 0.5) * 0.2; }
  else if (role < 3.5) { col = vec3(0.035, 0.038, 0.045); metal = 0.7; rough = 0.55; }
  else if (role < 4.5) { col = vec3(0.78, 0.52, 0.22); metal = 1.0; rough = 0.36; }
  else if (role < 5.5) { col = vec3(0.02); metal = 0.0; rough = 0.88; }
  else { col = vec3(0.36, 0.38, 0.41); metal = 1.0; rough = 0.42; }
  if (!painted && metal > 0.5) {   // bare metal tarnishes in patches
    float tar = wear * smoothstep(0.38, 0.72, nA.r * 0.6 + nB.b * 0.4 + 0.12 * e);
    col = mix(col, col * vec3(0.52, 0.47, 0.42), tar * 0.75); rough += tar * 0.28;
  }
  // grime in the seams, streaks running down, and dust thrown up from the ground
  float cav = (1.0 - smoothstep(0.0004, 0.004, edge)) * (1.0 - corner);
  float streak = smoothstep(0.56, 0.82, nS.a) * (0.3 + 0.7 * nD.b);
  float soil = wear * wear * smoothstep(0.42, 0.75, nD.r) * 0.3;
  float grime = clamp(wear * (0.8 * cav + 0.5 * streak * smoothstep(0.15, 0.7, wear)) + soil, 0.0, 1.0);
  float dust = clamp(wear * 1.15 * (1.0 - smoothstep(0.03, 0.50, vWPos.y)) * (0.3 + 0.9 * nD.g + 0.3 * nB.b), 0.0, 1.0);
  col = mix(col, uDirt * mix(0.4, 0.2, cav), grime); metal *= 1.0 - grime; rough = mix(rough, 0.85, grime);
  col = mix(col, uDirt, dust * 0.85); metal *= 1.0 - dust; rough = mix(rough, 0.95, dust);
  // a little shade in every seam, even on a unit fresh from the works
  col *= mix(1.0, mix(0.6, 1.0, smoothstep(0.0, 0.0022, edge)), 1.0 - corner);
  diffuseColor.rgb = col; pRough = clamp(rough, 0.06, 1.0); pMetal = clamp(metal, 0.0, 1.0); pHeight = h;
}
`;
const BUMP = /* glsl */ `
{
  vec3 sp = - vViewPosition, dpx = dFdx(sp), dpy = dFdy(sp);
  float hx = dFdx(pHeight), hy = dFdy(pHeight);
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  normal = normalize(abs(det) * normal - sign(det) * (hx * r1 + hy * r2));
}
`;

// the paint: set .userData.u.uPrimary.value and friends to change the look
export function paintMaterial(noise) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  const u = {
    uPrimary: { value: new THREE.Color(0xe9e6dc) }, uSecondary: { value: new THREE.Color(0x1f6f78) }, uOdd: { value: new THREE.Color(0x8a5a2c) },
    uDirt: { value: new THREE.Color(0x6b5a45) }, uWear: { value: 0.3 }, uFinish: { value: 0 }, uNoise: { value: noise },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute vec4 aData; attribute vec2 aUv; varying vec4 vData; varying vec2 vWuv; varying vec3 vWPos;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvData = aData; vWuv = aUv; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', DECL + '\n#include <common>')
      .replace('#include <color_fragment>', PAINT)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = pMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + BUMP);
  };
  m.customProgramCacheKey = () => 'droid-paint-1';
  return m;
}

/* ---------------- the other materials ---------------- */
// a dark lens
export const glassMaterial = () => new THREE.MeshPhysicalMaterial({ color: 0x030406, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.7 });
// a clear dome you can see the works through
export const clearMaterial = () => new THREE.MeshPhysicalMaterial({ color: 0xd8ecf2, transparent: true, opacity: 0.26, roughness: 0.02, metalness: 0, envMapIntensity: 3.0, depthWrite: false });
// anything lit from inside; its colour is the vertex colour
export const glowMaterial = () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

// a logic display: a few rows of small lit cells
export function logicTexture(seed = 1, cols = 12, rows = 4, palette = ['#7fd4ff', '#ffffff', '#2f7dff', '#0a1a33']) {
  const c = document.createElement('canvas'); c.width = cols * 8; c.height = rows * 8;
  const g = c.getContext('2d'); g.fillStyle = '#02040a'; g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const r = hash(x, y, seed);
    g.fillStyle = palette[r < 0.34 ? 0 : r < 0.5 ? 1 : r < 0.72 ? 2 : 3];
    g.fillRect(x * 8 + 1, y * 8 + 1, 6, 6);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  return t;
}
export const logicMaterial = (tex) => new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });

// the soft halo round a light: a sprite, added on top
let haloTex = null;
export function halo(hex, size) {
  if (!haloTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    haloTex = new THREE.CanvasTexture(c); haloTex.colorSpace = THREE.SRGBColorSpace;
  }
  const m = new THREE.SpriteMaterial({ map: haloTex, color: hex, transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor });
  const s = new THREE.Sprite(m); s.scale.set(size, size, 1); s.renderOrder = 10;
  return s;
}
