// Jawa creator: the cloth. A Jawa's robe is coarse, heavy homespun, and the weave is most of what the eye reads, so
// the weave is made here thread by thread as a tile, laid on the sculpted cloth from three sides (so it needs no
// seams), and then sun, sand and years are put on by the same material: fade on what faces the sky, sand in the hem,
// a dark lining, clan stripes and patches, and the glow of the eyes on the inside of the hood. The frayed edges are
// ribbons of loose threads. Everything is made in code; nothing is downloaded.
import * as THREE from 'three';

/* ---------------- repeatable noise ---------------- */
function hash(i, j, seed) { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const wrap = (i, p) => ((i % p) + p) % p;
function vnoise(u, v, pu, pv, seed) {
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const a = hash(wrap(i, pu), wrap(j, pv), seed), b = hash(wrap(i + 1, pu), wrap(j, pv), seed), c = hash(wrap(i, pu), wrap(j + 1, pv), seed), d = hash(wrap(i + 1, pu), wrap(j + 1, pv), seed);
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
function fbm(u, v, pu, pv, oct, seed) { let s = 0, amp = 0.5, f = 1; for (let o = 0; o < oct; o++) { s += amp * vnoise(u * f, v * f, pu * f, pv * f, seed + o); amp *= 0.5; f *= 2; } return s; }

/* ---------------- the weave ---------------- */
// A tile of plain-woven yarn, T threads each way: RG the surface normal, B the height (1 on top of a thread, 0 in the
// gap between threads), A a random number for the yarn on top (homespun yarn is never one colour). Hand-spun threads
// are uneven, so each has its own width and wanders a little.
export const THREADS = 32;   // a power of two, so the smaller copies of the tile average whole threads and show no beat
// kind: 'homespun' (an even plain weave), 'burlap' (thin yarn, open gaps, more wander) or 'ribbed' (fat weft yarns
// lying close, the warp only showing as ties: the cloth reads as ribs running round the body).
const WEAVES = { homespun: { warp: [0.36, 0.13, 1], weft: [0.36, 0.13, 1], wander: 0.1 }, burlap: { warp: [0.25, 0.14, 1], weft: [0.27, 0.14, 1], wander: 0.2 }, ribbed: { warp: [0.17, 0.06, 0.5], weft: [0.5, 0.06, 1.12], wander: 0.06 } };
export function weaveTexture(kind = 'homespun', size = 512, T = THREADS) {
  const hgt = new Float32Array(size * size), yarn = new Uint8Array(size * size), W = WEAVES[kind] || WEAVES.homespun;
  const wWarp = Array.from({ length: T }, (_, i) => W.warp[0] + W.warp[1] * hash(i, 1, 5)), wWeft = Array.from({ length: T }, (_, i) => W.weft[0] + W.weft[1] * hash(i, 2, 5));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size) * T, v = (y / size) * T;
    const ku = wrap(Math.floor(u), T), kv = wrap(Math.floor(v), T), over = (ku + kv) & 1;
    // each thread wanders sideways a little along its length
    const fu = u - Math.floor(u) + W.wander * (vnoise(v * 0.5, ku * 7.3, T / 2, 4096, 9) - 0.5), fv = v - Math.floor(v) + W.wander * (vnoise(u * 0.5, kv * 7.3, T / 2, 4096, 10) - 0.5);
    // a round thread seen from above, rising over its crossing and dipping under the next
    const a = Math.abs(fu - 0.5) / wWarp[ku], b = Math.abs(fv - 0.5) / wWeft[kv];
    const warp = a < 1 ? W.warp[2] * Math.sqrt(1 - a * a) * (over ? 0.62 + 0.38 * Math.sin(Math.PI * fv) : 0.5 - 0.22 * Math.sin(Math.PI * fv)) : 0;
    const weft = b < 1 ? W.weft[2] * Math.sqrt(1 - b * b) * (over ? 0.5 - 0.22 * Math.sin(Math.PI * fu) : 0.62 + 0.38 * Math.sin(Math.PI * fu)) : 0;
    let h = Math.max(warp, weft);
    const top = warp >= weft;
    // the twist of the yarn: fine slanting ridges along each thread
    if (h > 0) h *= 0.86 + 0.14 * Math.sin((top ? fv * 9 + fu * 5 : fu * 9 + fv * 5) * Math.PI * 2 + (top ? ku : kv) * 2.4);
    h += 0.07 * (vnoise(u * 3, v * 3, T * 3, T * 3, 21) - 0.5);
    hgt[x + y * size] = Math.max(0, Math.min(1, h));
    yarn[x + y * size] = 255 * (top ? hash(ku, 11, 7) : hash(kv, 23, 7));
  }
  const data = new Uint8Array(size * size * 4), k = 2.6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = hgt[wrap(x - 1, size) + y * size], r = hgt[wrap(x + 1, size) + y * size], d = hgt[x + wrap(y - 1, size) * size], u2 = hgt[x + wrap(y + 1, size) * size];
    let nx = (l - r) * k, ny = (d - u2) * k; const len = Math.hypot(nx, ny, 1); nx /= len; ny /= len;
    const o = (x + y * size) * 4;
    data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = (ny * 0.5 + 0.5) * 255; data[o + 2] = hgt[x + y * size] * 255; data[o + 3] = yarn[x + y * size];
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
// broad noise for fade, stains and sand: R cloud, G blobs, B grain, A long streaks
export function clothNoise(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, o = (x + y * size) * 4;
    let d1 = 9, id = 0; const cu = u * 7, cv = v * 7, ci = Math.floor(cu), cj = Math.floor(cv);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const wi = wrap(ci + di, 7), wj = wrap(cj + dj, 7), d = Math.hypot(ci + di + hash(wi, wj, 3) - cu, cj + dj + hash(wi, wj, 4) - cv); if (d < d1) { d1 = d; id = hash(wi, wj, 6); } }
    data[o] = 255 * fbm(u * 4, v * 4, 4, 4, 5, 3);
    data[o + 1] = 255 * Math.max(0, Math.min(1, (1 - Math.min(1, d1 * 1.3)) * (0.3 + 0.7 * id) + 0.35 * (fbm(u * 20, v * 20, 20, 20, 3, 17) - 0.5)));
    data[o + 2] = 255 * fbm(u * 32, v * 32, 32, 32, 4, 29);
    data[o + 3] = 255 * fbm(u * 3, v * 40, 3, 40, 3, 41);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

/* ---------------- the cloth material ---------------- */
export const MAX_PATCH = 6;
const DECL = /* glsl */ `
uniform sampler2D uWeave; uniform sampler2D uNoise;
uniform vec3 uCloth; uniform vec3 uYarn; uniform vec3 uLining; uniform vec3 uSand; uniform vec3 uStripe; uniform vec3 uDip;
uniform float uFuzz; uniform float uPitch; uniform float uBump; uniform float uWear; uniform float uDust; uniform float uStripes; uniform float uDipAmt; uniform float uWrap; uniform float uTall;
uniform vec3 uEyeL; uniform vec3 uEyeR; uniform vec3 uEyeCol; uniform float uGlow;
uniform vec4 uPatchC[${MAX_PATCH}]; uniform vec4 uPatchU[${MAX_PATCH}]; uniform vec4 uPatchV[${MAX_PATCH}]; uniform vec3 uPatchCol[${MAX_PATCH}]; uniform float uPatches;
varying vec3 vOPos; varying vec3 vONrm; varying float vAo; varying float vMask;
float cRough; vec3 cGlow; vec3 cNrm; float cSheen;
`;
const CLOTH = /* glsl */ `
{
  vec3 P = vOPos, N = normalize(vONrm);
  #ifdef DOUBLE_SIDED
    if (!gl_FrontFacing) N = -N;
  #endif
  vec3 bw = pow(abs(N), vec3(5.0)); bw /= (bw.x + bw.y + bw.z);
  float S = 1.0 / (uPitch * ${'THREADS_F'});
  // patches: squares of other cloth sewn on; inside one the weave runs its own way and takes its colour
  vec3 base = uCloth; float patchEdge = 0.0, stitch = 0.0; vec3 Pw = P;
  for (int i = 0; i < ${MAX_PATCH}; i++) {
    if (float(i) >= uPatches) break;
    vec3 q = P - uPatchC[i].xyz; vec3 pu = uPatchU[i].xyz, pv = uPatchV[i].xyz, pn = cross(pu, pv);
    float a = dot(q, pu), b = dot(q, pv), c = dot(q, pn);
    float wob = (texture2D(uNoise, vec2(a, b) * 9.0 + float(i) * 0.37).r - 0.5) * 0.006;
    float d = max(abs(a) - uPatchU[i].w, abs(b) - uPatchV[i].w) + wob;
    if (d < 0.0 && abs(c) < uPatchC[i].w && dot(N, pn) > 0.25) {
      base = uPatchCol[i]; Pw = uPatchC[i].xyz + pu * (a * 0.8 - b * 0.6) + pv * (a * 0.6 + b * 0.8) + pn * c;
      patchEdge = smoothstep(-0.0035, 0.0, d);
      // a running stitch just inside the edge
      float along = abs(a) - uPatchU[i].w > abs(b) - uPatchV[i].w ? b : a;
      stitch = (1.0 - smoothstep(0.0006, 0.0016, abs(d + 0.0055))) * step(0.45, fract(along * 95.0));
    }
  }
  // how many threads a pixel covers: as that nears one, the threads can't be drawn (they would beat against the
  // pixels), so their relief fades into the cloth's even tone
  float tpp = max(length(dFdx(P)), length(dFdy(P))) / uPitch, fine = 1.0 - smoothstep(0.17, 0.38, tpp);
  vec4 wx = texture2D(uWeave, Pw.zy * S, 0.6), wy = texture2D(uWeave, Pw.xz * S, 0.6), wz = texture2D(uWeave, Pw.xy * S, 0.6);
  float hgt = mix(0.45, wx.b * bw.x + wy.b * bw.y + wz.b * bw.z, fine), yarn = mix(0.5, wx.a * bw.x + wy.a * bw.y + wz.a * bw.z, fine);
  // the weave's own normal, turned onto the surface from each side and blended
  vec3 tx = wx.xyz * 2.0 - 1.0, ty = wy.xyz * 2.0 - 1.0, tz = wz.xyz * 2.0 - 1.0;
  tx.xy *= uBump * fine; ty.xy *= uBump * fine; tz.xy *= uBump * fine;
  tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x); ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y); tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
  cNrm = normalize(tx.zyx * bw.x + ty.xzy * bw.y + tz.xyz * bw.z);
  // round the body: one coordinate for the broad noise
  // (the angle jumps at the back, so its slope is taken from whichever of two angles doesn't jump here, and the
  // noise is fetched with that slope: no seam down the spine)
  vec2 cyl = vec2(atan(P.x, P.z) / 6.2831853, P.y);
  float a2 = atan(-P.x, -P.z) / 6.2831853, ax1 = dFdx(cyl.x), ax2 = dFdx(a2), ay1 = dFdy(cyl.x), ay2 = dFdy(a2);
  vec2 gx = vec2(abs(ax1) < abs(ax2) ? ax1 : ax2, dFdx(P.y)), gy = vec2(abs(ay1) < abs(ay2) ? ay1 : ay2, dFdy(P.y));
  vec4 nA = textureGrad(uNoise, cyl * vec2(3.0, 2.2), gx * vec2(3.0, 2.2), gy * vec2(3.0, 2.2)), nB = textureGrad(uNoise, cyl * vec2(11.0, 7.0) + 0.37, gx * vec2(11.0, 7.0), gy * vec2(11.0, 7.0)), nS = textureGrad(uNoise, cyl * vec2(5.0, 0.9) + 0.11, gx * vec2(5.0, 0.9), gy * vec2(5.0, 0.9));
  // heavy cloth is never smooth: it lies in soft lumps, which is what keeps it from looking moulded at a distance
  vec4 nL = textureGrad(uNoise, cyl * vec2(23.0, 15.0) + 0.61, gx * vec2(23.0, 15.0), gy * vec2(23.0, 15.0));
  cNrm = normalize(cNrm + (vec3(nL.r, nL.b, nB.r) - 0.5) * 0.34 * (1.0 - 0.5 * fine));
  float up = max(N.y, 0.0), lining = vMask;
  vec3 col = base;
  // homespun: every yarn a little different, and slubs where it was spun thick
  col *= mix(0.86, 1.14, yarn) * mix(0.9, 1.1, nS.a) * mix(0.93, 1.07, nB.b);
  col = mix(col, uYarn, 0.22 * smoothstep(0.55, 0.8, yarn));
  // clan stripes woven in near the hem, and a dip-dyed hem
  float sy = P.y / uTall;
  float band = (smoothstep(0.070, 0.074, sy) - smoothstep(0.098, 0.102, sy)) + (smoothstep(0.118, 0.121, sy) - smoothstep(0.131, 0.134, sy)) + (smoothstep(0.150, 0.152, sy) - smoothstep(0.157, 0.159, sy));
  col = mix(col, uStripe * mix(0.86, 1.14, yarn), uStripes * clamp(band, 0.0, 1.0) * (1.0 - lining));
  // (the dye line is where the cloth stood in the vat: fairly sharp, never level)
  float dipLine = 0.2 + 0.09 * nA.r + 0.02 * nS.a;
  col = mix(col, uDip * mix(0.86, 1.14, yarn), uDipAmt * (1.0 - smoothstep(dipLine, dipLine + 0.035, sy)));
  // years in two suns: what faces the sky fades and goes chalky, unevenly
  float fade = uWear * (0.22 + 0.5 * up + 0.4 * nA.r) * (0.55 + 0.45 * nB.b);
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, mix(col, vec3(lum), 0.5) * 1.22 + 0.02, clamp(fade, 0.0, 1.0) * 0.6);
  // grease and old stains: darker blots, more of them on worn cloth
  // (broad and soft-edged, pulled out of round by the cloud noise)
  float blot = smoothstep(0.5 - 0.12 * uWear, 0.85, nA.g * 0.75 + (nA.r - 0.5) * 0.5 + (nB.b - 0.5) * 0.12) * (0.25 + 0.75 * uWear);
  col *= 1.0 - 0.36 * blot;
  // worn thin and torn near the hem: the cloth opens and the dark shows
  // (rents run down the cloth: the noise is stretched tall, and frayed by the grain)
  vec4 nT = textureGrad(uNoise, cyl * vec2(29.0, 9.0) + 0.23, gx * vec2(29.0, 9.0), gy * vec2(29.0, 9.0));
  float tear = smoothstep(0.71 - 0.1 * uWear, 0.75 - 0.1 * uWear, nT.g * 0.8 + (nB.b - 0.5) * 0.3 + nA.b * 0.12) * (1.0 - smoothstep(0.05, 0.3, sy)) * step(0.45, uWear);
  col = mix(col, vec3(0.012, 0.01, 0.009), tear * 0.92);
  // the relief of the weave: the gaps between threads are in shadow
  col *= mix(0.5, 1.1, smoothstep(0.05, 0.85, hgt));
  // seams of a patch
  col *= 1.0 - 0.45 * patchEdge;
  col = mix(col, vec3(0.78, 0.72, 0.6) * (0.4 + 0.6 * lum * 3.0), stitch * 0.85);
  // strips wound round a hand or a foot
  if (uWrap > 0.5) { float w = sin((P.y * 0.74 + P.x * 0.42 + P.z * 0.52) * 430.0); col *= mix(0.55, 1.05, smoothstep(-0.75, -0.35, w)); }
  // sand: thrown up round the hem, lying on whatever faces up, caught in the weave
  // (in smears and patches, as it is thrown and brushed on, not an even coat; thickest right at the hem)
  float low = 1.0 - smoothstep(0.02, 0.36, sy), smear = smoothstep(0.36, 0.72, nA.r * 0.55 + nS.a * 0.45 + (nB.b - 0.5) * 0.3);
  float dust = uDust * (low * (0.14 + 0.9 * smear) + 0.4 * (1.0 - smoothstep(0.0, 0.08, sy)) + 0.5 * up * (0.4 + nB.b) + 0.2 * nS.r * (1.0 - hgt));
  dust = clamp(dust * (0.75 + 0.5 * (1.0 - hgt)), 0.0, 1.0);
  col = mix(col, uSand * mix(0.8, 1.05, nB.b), dust * 0.8);
  // the lining of the hood and the sleeves is dark wool
  col = mix(col, uLining * mix(0.6, 1.1, hgt), lining);
  // folds and hollows are shaded by the sculpt itself
  float ao = 0.42 + 0.58 * pow(vAo, 1.25);
  col *= ao;
  diffuseColor.rgb = col;
  cRough = mix(0.93, 1.0, dust);
  cSheen = (1.0 - lining) * (1.0 - dust) * (1.0 - tear);
  // the eyes light the inside of the hood a little
  vec3 dl = uEyeL - P, dr = uEyeR - P; float ll = dot(dl, dl), lr = dot(dr, dr);
  float gl = max(dot(cNrm, dl) * inversesqrt(ll), 0.0) / (1.0 + ll * 2600.0) + max(dot(cNrm, dr) * inversesqrt(lr), 0.0) / (1.0 + lr * 2600.0);
  cGlow = uEyeCol * min(uGlow, 1.25) * 0.022 * gl * lining * mix(0.5, 1.0, hgt);   // faint: the glow shows the cloth nearest the eyes and no more
}
`.replace('THREADS_F', THREADS.toFixed(1));

export function clothMaterial(tex, opts = {}) {
  // wool has almost no shine of its own: a matte surface with a soft fuzz of light at grazing angles
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, metalness: 0, specularIntensity: 0.1, sheen: 1, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff), side: opts.side ?? THREE.FrontSide });
  const u = {
    uWeave: { value: tex.weave }, uNoise: { value: tex.noise },
    uCloth: { value: new THREE.Color(0x4a3222) }, uYarn: { value: new THREE.Color(0x6a4a30) }, uLining: { value: new THREE.Color(0x070605) }, uSand: { value: new THREE.Color(0xb39a72) },
    uStripe: { value: new THREE.Color(0x8a2f1c) }, uDip: { value: new THREE.Color(0x1c1410) },
    uFuzz: { value: opts.sheen ?? 0.45 }, uPitch: { value: opts.pitch ?? 0.004 }, uBump: { value: opts.bump ?? 1.0 }, uWear: { value: 0.4 }, uDust: { value: 0.5 }, uStripes: { value: 0 }, uDipAmt: { value: 0 }, uWrap: { value: opts.wrap ? 1 : 0 }, uTall: { value: 1 },
    uEyeL: { value: new THREE.Vector3(0.03, 0.81, 0.04) }, uEyeR: { value: new THREE.Vector3(-0.03, 0.81, 0.04) }, uEyeCol: { value: new THREE.Color(0xffa020) }, uGlow: { value: 0 },
    uPatchC: { value: Array.from({ length: MAX_PATCH }, () => new THREE.Vector4()) }, uPatchU: { value: Array.from({ length: MAX_PATCH }, () => new THREE.Vector4(1, 0, 0, 0)) },
    uPatchV: { value: Array.from({ length: MAX_PATCH }, () => new THREE.Vector4(0, 1, 0, 0)) }, uPatchCol: { value: Array.from({ length: MAX_PATCH }, () => new THREE.Color()) }, uPatches: { value: 0 },
  };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute float aAo; attribute float aMask; varying vec3 vOPos; varying vec3 vONrm; varying float vAo; varying float vMask;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOPos = position; vONrm = normal; vAo = aAo; vMask = aMask;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', DECL + '\n#include <common>')
      .replace('#include <color_fragment>', CLOTH)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = cRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(cNrm, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += cGlow;')
      // the fuzz of light on wool is the colour of the cloth under it: a dark dye has a dark fuzz
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_SHEEN\nmaterial.sheenColor = min(diffuseColor.rgb * 1.6 + 0.006, vec3(1.0)) * uFuzz * cSheen;\n#endif');
  };
  m.customProgramCacheKey = () => 'jawa-cloth-13' + (opts.wrap ? 'w' : '');
  return m;
}

/* ---------------- frayed edges ---------------- */
// loose threads: each column of the picture is one thread, with its own length; some are missing
export function fringeTexture(w = 512, h = 64) {
  const data = new Uint8Array(w * h * 4);
  for (let x = 0; x < w; x++) {
    const thread = Math.floor(x / 4), on = hash(thread, 3, 61) > 0.24, len = 0.25 + 0.75 * hash(thread, 5, 61) ** 1.4, core = (x % 4) < 3 ? 1 : 0, shade = 150 + 105 * hash(thread, 7, 61);
    for (let y = 0; y < h; y++) {
      const o = (x + y * w) * 4, v = y / (h - 1);   // v = 0 at the cloth, 1 at the thread's end
      data[o] = data[o + 1] = data[o + 2] = shade; data[o + 3] = on && core && v < len ? 255 : (v < 0.1 ? 255 : 0);
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
export function fringeMaterial(tex) {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.fringe, alphaTest: 0.42, vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
}
// ribbons of threads along loops of points: `pts` where they start, `dir` which way they hang, `len` how long.
// Two rows a little apart, so the edge is thick with them.
export function fringeGeometry(loops, sandAt = 0.3, tall = 1) {
  const P = [], N = [], U = [], C = [], I = [];
  let n = 0;
  for (const L of loops) {
    const count = L.pts.length / 3, last = L.closed ? count : count - 1;
    for (let row = 0; row < 2; row++) {
      const base = n, shift = row * 0.37, lenK = row ? 0.7 : 1, inK = row ? 0.0035 : 0.0012;
      let s = 0;
      for (let i = 0; i <= last; i++) {
        const k = i % count, kp = (k + count - 1) % count, kn = (k + 1) % count;
        const x = L.pts[k * 3], y = L.pts[k * 3 + 1], z = L.pts[k * 3 + 2];
        if (i > 0) { const j = (i - 1) % count; s += Math.hypot(x - L.pts[j * 3], y - L.pts[j * 3 + 1], z - L.pts[j * 3 + 2]); }
        let dx = L.dir[k * 3], dy = L.dir[k * 3 + 1], dz = L.dir[k * 3 + 2]; const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
        // the ribbon's face: across the loop's run and the way the threads hang
        const tx = L.pts[kn * 3] - L.pts[kp * 3], ty = L.pts[kn * 3 + 1] - L.pts[kp * 3 + 1], tz = L.pts[kn * 3 + 2] - L.pts[kp * 3 + 2];
        let nx = dy * tz - dz * ty, ny = dz * tx - dx * tz, nz = dx * ty - dy * tx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const len = L.len * lenK * (0.75 + 0.5 * hash(i, row, L.seed)), wob = 0.004 * (hash(i, 9 + row, L.seed) - 0.5);
        // start a little inside the cloth, so no gap shows
        const sx = x + nx * inK - dx * 0.004, sy = y + ny * inK - dy * 0.004, sz = z + nz * inK - dz * 0.004;
        const ex = sx + dx * len + nx * wob, ey = Math.max(0.0015, sy + dy * len), ez = sz + dz * len + nz * wob;
        const u = s / 0.085 + shift, sand = Math.max(0, 1 - sy / (sandAt * tall));
        P.push(sx, sy, sz, ex, ey, ez); N.push(nx, ny, nz, nx, ny, nz); U.push(u, 0, u, 1);
        C.push(1 - 0.25 * sand, 1 - 0.25 * sand, 1 - 0.25 * sand, 1 + 0.5 * sand, 1 + 0.5 * sand, 1 + 0.5 * sand);   // more sand, and paler, toward the ends near the ground
        n += 2;
      }
      for (let i = 0; i < last; i++) { const a = base + i * 2; I.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I);
  g.computeBoundingSphere();
  return g;
}

// a mesh from the mesher as a geometry the cloth material can paint
export function clothGeometry(m) {
  const g = new THREE.BufferGeometry(), n = m.ao.length;
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2)); g.setAttribute('aAo', new THREE.BufferAttribute(m.ao, 1));
  g.setAttribute('aMask', new THREE.BufferAttribute(m.mask || new Float32Array(n), 1));
  // the same shade as a vertex colour, for the shared leather and metal materials
  const c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const o = 0.3 + 0.7 * Math.pow(m.ao[i], 1.4); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = o; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.setIndex(new THREE.BufferAttribute(m.index, 1)); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
