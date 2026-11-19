// Hair on the human base, as meshes (three.js): the base cap and the locks of a style (hair-shape.js), rebuilt in place
// from the live skin whenever the figure is reshaped. makeHair(base, fig) -> { set(style, colour), place(), group }.
import * as THREE from 'three';
import { STYLES, restShape, bindStyle, placeBase, placeLocks, lockCounts, lockIndex, lockStatic, normals } from './hair-shape.js';

// fine fibres running along v, as a normal map: the strands inside a lock
let fibres = null;
function fibreTexture() {
  if (fibres) return fibres;
  const S = 256, data = new Uint8Array(S * S * 4), h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); }, hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const yy = Math.floor(y / 48), f = y / 48 - yy; hgt[x + y * S] = 0.6 * h(x, 1) + 0.25 * h(Math.floor(x / 3), 7) + 0.15 * (h(x, yy + 9) * (1 - f) + h(x, ((yy + 1) % Math.ceil(S / 48)) + 9) * f); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const l = hgt[((x - 1 + S) % S) + y * S], r = hgt[((x + 1) % S) + y * S]; let nx = (l - r) * 1.6, nz = 1; const len = Math.hypot(nx, nz); nx /= len; nz /= len;
    const o = (x + y * S) * 4; data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = 128; data[o + 2] = (nz * 0.5 + 0.5) * 255; data[o + 3] = 255;
  }
  fibres = new THREE.DataTexture(data, S, S, THREE.RGBAFormat); fibres.wrapS = fibres.wrapT = THREE.RepeatWrapping; fibres.magFilter = THREE.LinearFilter; fibres.minFilter = THREE.LinearMipmapLinearFilter;
  fibres.generateMipmaps = true; fibres.anisotropy = 4; fibres.needsUpdate = true;
  return fibres;
}

export function makeHair(base, fig) {
  const group = new THREE.Group(); group.name = 'hair'; fig.add(group);
  const capMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.62, metalness: 0 });
  const lockMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36, metalness: 0, normalMap: fibreTexture(), normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.25, sheenRoughness: 0.4 });
  let rest = null, bound = null, cap = null, locks = null, shade = null, colour = new THREE.Color(0x16110e);
  const binds = new Map();   // per style, once
  function build(style) {
    for (const m of [cap, locks]) if (m) { group.remove(m); m.geometry.dispose(); }
    cap = locks = null; bound = null;
    if (!STYLES[style] || !STYLES[style].line) return;
    if (!rest) rest = restShape(base, fig.surface);
    if (!binds.has(style)) binds.set(style, bindStyle(style, rest));
    bound = binds.get(style);
    const B = bound.base, g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(B.h.length * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(B.h.length * 3), 3)); g.setIndex(new THREE.BufferAttribute(B.index, 1));
    cap = new THREE.Mesh(g, capMat); cap.castShadow = cap.receiveShadow = true; cap.frustumCulled = false; group.add(cap);
    if (bound.locks.length) {
      const { v } = lockCounts(bound), st = lockStatic(bound), lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v * 3), 3)); lg.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(v * 3), 3));
      lg.setAttribute('uv', new THREE.BufferAttribute(st.uv, 2)); lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(v * 3), 3)); lg.setIndex(new THREE.BufferAttribute(lockIndex(bound), 1));
      shade = st.shade; locks = new THREE.Mesh(lg, lockMat); locks.castShadow = locks.receiveShadow = true; locks.frustumCulled = false; group.add(locks);
    }
    recolour(); place();
  }
  function recolour() {
    capMat.color.copy(colour).multiplyScalar(0.55);
    if (locks) { const c = locks.geometry.attributes.color.array; for (let i = 0; i < shade.length; i++) { c[i * 3] = colour.r * shade[i]; c[i * 3 + 1] = colour.g * shade[i]; c[i * 3 + 2] = colour.b * shade[i]; } locks.geometry.attributes.color.needsUpdate = true; }
    lockMat.sheenColor.copy(colour).lerp(new THREE.Color(1, 1, 1), 0.18);
  }
  function place() {
    if (!bound) return;
    const s = fig.surface, cp = cap.geometry.attributes.position.array;
    placeBase(bound, s, cp); normals(cp, bound.base.index, cap.geometry.attributes.normal.array);
    cap.geometry.attributes.position.needsUpdate = cap.geometry.attributes.normal.needsUpdate = true;
    if (locks) { const lp = locks.geometry.attributes; placeLocks(bound, s, lp.position.array, lp.normal.array); lp.position.needsUpdate = lp.normal.needsUpdate = true; }
  }
  fig.addEventListener('shaped', place);
  let current = null;
  return {
    group,
    set(style, hex) { if (hex) colour.set(hex); if (style !== current) { current = style; build(style); } else recolour(); lockMat.roughness = STYLES[style]?.gloss ? 0.32 : 0.46; },
    place,
  };
}
