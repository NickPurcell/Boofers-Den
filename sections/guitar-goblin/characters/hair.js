// Hair on the human base, as meshes (three.js): the base cap and the locks of a style (hair-shape.js), rebuilt in place
// from the live skin whenever the figure is reshaped. makeHair(base, fig) -> { set(style, colour), place(), group }.
import * as THREE from 'three';
import { STYLES, restShape, bindStyle, placeBase, placeLocks, lockCounts, lockIndex, lockStatic, normals, massPaths, rootAt } from './hair-shape.js';

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
  const capMat = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.5, metalness: 0, normalMap: fibreTexture(), normalScale: new THREE.Vector2(0.45, 0.45), sheen: 0.45, sheenRoughness: 0.4 });
  const lockMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.36, metalness: 0, normalMap: fibreTexture(), normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.25, sheenRoughness: 0.4 });
  let rest = null, bound = null, cap = null, locks = null, shade = null, colour = new THREE.Color(0x16110e);
  const binds = new Map();   // per style, once
  // a grooved tube along a path of [x, y, z, r] (head-frame metres): rings of points, the radius dipping between lines
  // of hair that run along it (twisting a little on a knot; on a braid, knuckles that swell and pinch)
  function tube(P) {
    const pts = P.pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])), curve = new THREE.CatmullRomCurve3(pts), N = 64, R = 24, pos = [], idx = [], uv = [];
    const frames = curve.computeFrenetFrames(N, false), rAt = (t) => { const f = t * (P.pts.length - 1), i = Math.min(P.pts.length - 2, Math.floor(f)), u = f - i; return P.pts[i][3] * (1 - u) + P.pts[i + 1][3] * u; };
    for (let i = 0; i <= N; i++) {
      const t = i / N, c = curve.getPointAt(t), n = frames.normals[i], b = frames.binormals[i], r0 = rAt(t);
      const len = curve.getLength() * t, kn = P.knuckle ? 0.82 + 0.18 * Math.abs(Math.sin(Math.PI * len / P.knuckle)) : 1;
      for (let j = 0; j <= R; j++) {
        const a = (j / R) * Math.PI * 2 + (P.twist || 0) * t, line = Math.abs(Math.sin(a * P.lines / 2 + (P.knuckle ? Math.floor(len / P.knuckle) * 1.3 : 0)));
        const r = r0 * kn * (0.9 + 0.1 * Math.pow(line, 0.4)), d = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
        pos.push(c.x + d.x * r, c.y + d.y * r, c.z + d.z * r); uv.push(j / R, t * 4);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < R; j++) { const a = i * (R + 1) + j, b = a + R + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }   // wound to face outward
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    // a binding round it where it is tied
    if (P.tie) { const t = (P.tie === 2 ? 0.1 : 0.14), c = curve.getPointAt(t), tg = curve.getTangentAt(t), band = new THREE.TorusGeometry(rAt(t) * 0.95, rAt(t) * 0.14, 8, 24); band.lookAt(tg); band.translate(c.x, c.y, c.z); return [g, band]; }
    return [g];
  }
  const massMat = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.42, metalness: 0, normalMap: fibreTexture(), normalScale: new THREE.Vector2(0.6, 0.6), sheen: 0.4, sheenRoughness: 0.4 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.7 });
  let mass = null;
  function build(style) {
    for (const m of [cap, locks]) if (m) { group.remove(m); m.geometry.dispose(); }
    if (mass) { group.remove(mass); mass.traverse((o) => o.geometry && o.geometry.dispose()); mass = null; }
    cap = locks = null; bound = null;
    if (STYLES[style] && STYLES[style].mass) {
      mass = new THREE.Group(); mass.matrixAutoUpdate = false;
      for (const P of massPaths(STYLES[style].mass)) { const [g, band] = tube(P); const m = new THREE.Mesh(g, massMat); m.castShadow = m.receiveShadow = true; mass.add(m); if (band) mass.add(new THREE.Mesh(band, tieMat)); }
      group.add(mass);
    }
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
    capMat.color.copy(colour).multiplyScalar(STYLES[current]?.locks ? 0.55 : 0.9); massMat.color.copy(colour); massMat.sheenColor.copy(colour).lerp(new THREE.Color(1, 1, 1), 0.25);
    if (locks) { const c = locks.geometry.attributes.color.array; for (let i = 0; i < shade.length; i++) { c[i * 3] = colour.r * shade[i]; c[i * 3 + 1] = colour.g * shade[i]; c[i * 3 + 2] = colour.b * shade[i]; } locks.geometry.attributes.color.needsUpdate = true; }
    lockMat.sheenColor.copy(colour).lerp(new THREE.Color(1, 1, 1), 0.18);
  }
  function place() {
    if (mass) {   // the masses in the head's frame, scaled to the head
      // (upright: x across the eyes, y the world's up made square to it, z forward; headFrame's own y leans back toward the crown)
      const F = fig.headFrame(), k = F.scale / 0.0644, x = new THREE.Vector3(...F.x), up = new THREE.Vector3(0, 1, 0).addScaledVector(x, -x.y).normalize(), fw = new THREE.Vector3().crossVectors(x, up);
      const X = x.multiplyScalar(k), Y = up.multiplyScalar(k), Z = fw.multiplyScalar(k);
      // the path's first point goes on its root on the scalp (the skull's depth behind the eyes differs from head to head)
      const r = bound && rootAt(bound, fig.surface), p0 = massPaths(STYLES[current].mass)[0].pts[0];
      const o = r ? new THREE.Vector3(...r[0]).sub(X.clone().multiplyScalar(p0[0])).sub(Y.clone().multiplyScalar(p0[1])).sub(Z.clone().multiplyScalar(p0[2])) : new THREE.Vector3(...F.origin);
      mass.matrix.makeBasis(X, Y, Z).setPosition(o); mass.matrixWorldNeedsUpdate = true;
    }
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
