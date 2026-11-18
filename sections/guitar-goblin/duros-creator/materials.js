// Materials for the Duros creator, with textures made here in code (tileable noise turned into normal maps), so
// nothing is downloaded: skin pores, cloth weave, leather grain, brushed metal, and the eye.
import * as THREE from 'three';

/* ---------------- tileable noise ---------------- */
function hash(i, j, seed) { let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function valueNoise(u, v, period, seed) {   // u, v in cells; wraps every `period` cells
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const a = hash(((i % period) + period) % period, ((j % period) + period) % period, seed), b = hash((((i + 1) % period) + period) % period, ((j % period) + period) % period, seed);
  const c = hash(((i % period) + period) % period, (((j + 1) % period) + period) % period, seed), d = hash((((i + 1) % period) + period) % period, (((j + 1) % period) + period) % period, seed);
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
function fbm(u, v, period, octaves, seed) { let s = 0, amp = 0.5, f = 1; for (let o = 0; o < octaves; o++) { s += amp * valueNoise(u * f, v * f, period * f, seed + o); amp *= 0.5; f *= 2; } return s; }
function worley(u, v, period, seed) {   // [nearest, second nearest] feature distance, wrapping
  const i = Math.floor(u), j = Math.floor(v); let d1 = 9, d2 = 9;
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const ci = i + di, cj = j + dj, wi = ((ci % period) + period) % period, wj = ((cj % period) + period) % period;
    const px = ci + hash(wi, wj, seed), py = cj + hash(wi, wj, seed + 7);
    const d = Math.hypot(px - u, py - v);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return [d1, d2];
}
// a normal map texture from a height function over the unit square (tileable)
function normalMap(size, height, strength) {
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) hgt[x + y * size] = height(x / size, y / size);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = hgt[((x - 1 + size) % size) + y * size], r = hgt[((x + 1) % size) + y * size];
    const d = hgt[x + ((y - 1 + size) % size) * size], u = hgt[x + ((y + 1) % size) * size];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const o = (x + y * size) * 4;
    data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = (ny * 0.5 + 0.5) * 255; data[o + 2] = (nz * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

export const textures = {};
export function makeTextures() {
  // skin: fine pores and a soft unevenness
  textures.skin = normalMap(256, (u, v) => {
    const [d1] = worley(u * 40, v * 40, 40, 3);
    return 0.55 * fbm(u * 8, v * 8, 8, 4, 11) - 0.35 * Math.max(0, 0.32 - d1) * 3;
  }, 2.2);
  // cloth: a plain weave with a little slub
  textures.weave = normalMap(256, (u, v) => {
    const N = 32, cu = u * N, cv = v * N, iu = Math.floor(cu), iv = Math.floor(cv), fu = cu - iu, fv = cv - iv, over = (iu + iv) & 1;
    const warp = Math.sin(Math.PI * fu) * (over ? 1 : 0.55), weft = Math.sin(Math.PI * fv) * (over ? 0.55 : 1);
    return Math.max(warp, weft) * 0.8 + 0.25 * fbm(u * 16, v * 4, 16, 2, 5);
  }, 3.0);
  // leather: pebbled grain with creases
  textures.leather = normalMap(256, (u, v) => {
    const [d1, d2] = worley(u * 24, v * 24, 24, 21);
    return 0.6 * Math.min(1, (d2 - d1) * 2.2) + 0.35 * fbm(u * 6, v * 6, 6, 4, 9);
  }, 2.6);
  // brushed metal: fine streaks one way
  textures.brushed = normalMap(128, (u, v) => 0.7 * fbm(u * 64, v * 2, 64, 3, 31), 1.2);
}

/* ---------------- the eye ---------------- */
// An equirectangular texture whose pole is the front of the eye: a deep red that is brighter in a ring, darker at
// its very centre and toward its edges, with fine radial fibres. The colour comes from `hex`.
export function eyeTexture(hex) {
  const W = 512, Hh = 256, c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const g = c.getContext('2d'), img = g.createImageData(W, Hh), base = new THREE.Color(hex);
  const hi = base.clone().lerp(new THREE.Color(1, 0.8, 0.55), 0.16), lo = base.clone().multiplyScalar(0.22);
  for (let y = 0; y < Hh; y++) {
    const th = (y / Hh) * 180;   // degrees from the front
    for (let x = 0; x < W; x++) {
      const fib = 0.86 + 0.28 * fbm((x / W) * 96, th / 30, 96, 3, 4);
      let col;
      if (th < 9) col = lo.clone().lerp(base, th / 9 * 0.7);                       // a dark centre
      else if (th < 46) col = base.clone().lerp(hi, Math.sin(((th - 9) / 37) * Math.PI) * 0.55).multiplyScalar(fib);
      else if (th < 60) col = base.clone().lerp(lo, (th - 46) / 14 * 0.85).multiplyScalar(fib);   // the darker rim
      else col = lo.clone().multiplyScalar(0.6);
      // THREE.Color works in linear values; the canvas holds sRGB (the texture is flagged so), so convert on the way in
      col.convertLinearToSRGB();
      const o = (x + y * W) * 4;
      img.data[o] = Math.min(255, col.r * 255); img.data[o + 1] = Math.min(255, col.g * 255); img.data[o + 2] = Math.min(255, col.b * 255); img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/* ---------------- materials ---------------- */
export function skinMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.46, metalness: 0,
    normalMap: textures.skin, normalScale: new THREE.Vector2(0.28, 0.28),
    sheen: 0.45, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x9ec8ff),
    clearcoat: 0.18, clearcoatRoughness: 0.45,
  });
}
export function clothMaterial(hex, opts = {}) {
  return new THREE.MeshStandardMaterial({ color: hex, vertexColors: true, roughness: opts.rough ?? 0.92, metalness: 0, normalMap: textures.weave, normalScale: new THREE.Vector2(opts.bump ?? 0.55, opts.bump ?? 0.55), side: THREE.DoubleSide });
}
export function leatherMaterial(hex) {
  return new THREE.MeshPhysicalMaterial({ color: hex, vertexColors: true, roughness: 0.58, metalness: 0, normalMap: textures.leather, normalScale: new THREE.Vector2(0.22, 0.22), clearcoat: 0.25, clearcoatRoughness: 0.5, side: THREE.DoubleSide });
}
export function metalMaterial(hex) {
  return new THREE.MeshStandardMaterial({ color: hex, vertexColors: true, roughness: 0.32, metalness: 1, normalMap: textures.brushed, normalScale: new THREE.Vector2(0.25, 0.25) });
}
export function plasticMaterial(hex) {
  return new THREE.MeshPhysicalMaterial({ color: hex, vertexColors: true, roughness: 0.38, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.3 });
}
