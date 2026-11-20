// A figure baked for a game table (HoloTable's 3D combat map): every mesh the figure shows, as plain arrays, with its
// colour worked out per vertex, standing on the ground at the origin, facing +z, in metres. A table draws it with
// one plain material, so it needs none of this page's modules, shaders or workers, and keeps it for next time.
//   bakeFigure(fig, { skin }) -> { v: 1, height, meshes: [{ position, normal, color (rgb, sRGB bytes), index, rough, metal }] }
// The skin's colour lives in its shader (human-base/skin.js); at a table's size the tone, the lips and the undersuit
// are what show, so those are what it keeps (the undersuit's edges worked out as the shader does).
import * as THREE from 'three';

const toByte = (x) => Math.max(0, Math.min(255, Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055))));
const toLinear = (b) => { const x = b / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };

// a texture's colour at (u, v), linear, or null if its pixels cannot be read here
function sampler(tex) {
  const im = tex && tex.image; if (!im || !im.width) return null;
  let data = null; const w = im.width, h = im.height;
  if (im.data) data = im.data;
  else {
    try { const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }); const g = c.getContext('2d'); g.drawImage(im, 0, 0); data = g.getImageData(0, 0, w, h).data; } catch { return null; }
  }
  const srgb = tex.colorSpace === THREE.SRGBColorSpace, k = data instanceof Float32Array ? 1 : 255;
  return (u, v) => {
    const x = Math.max(0, Math.min(w - 1, Math.floor((((u % 1) + 1) % 1) * w))), y = Math.max(0, Math.min(h - 1, Math.floor((tex.flipY ? 1 - v : v) * h))), i = (y * w + x) * 4;
    return [0, 1, 2].map((c) => (srgb ? toLinear((data[i + c] / k) * 255) : data[i + c] / k));
  };
}

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }, mix = (a, b, t) => a + (b - a) * t;
// how much the undersuit covers a point of the skin, from its place in the base pose (decimetres) and how much of it is arm
function suitAt(rx, ry, armX, armY, U) {
  const ax = Math.abs(rx), J = U.uJoints.value, sa = U.uSuitArms.value, shortsTop = 1.05 - 0.12 * ss(0, 1.2, ax);
  const waist = mix(shortsTop, J.w, U.uSuitTop.value), hem = mix(-2.35 + 0.18 * ss(0.4, 1.6, ax), J.z, U.uSuitLegs.value), armK = ss(0.25, 0.6, armX);
  const shorts = ss(hem - 0.02, hem + 0.02, ry) * (1 - ss(shortsTop - 0.02, shortsTop + 0.02, ry)) * (1 - armK);
  const top = U.uSuitTop.value * (ry >= shortsTop - 0.03 ? 1 : 0) * (1 - ss(waist - 0.02, waist + 0.02, ry)) * mix(1, 1 - ss(1.66, 1.72, ax), ss(shortsTop + 0.6, shortsTop + 0.9, ry)) * (1 - ss(0.55, 0.7, armX));
  const sleeveEnd = mix(J.x + 0.2, J.y - 0.25, sa >= 0.75 ? 1 : 0), sleeve = (sa >= 0.01 ? 1 : 0) * armK * (sa >= 0.75 ? 1 - ss(0.35, 0.65, armY) : 1 - ss(sleeveEnd - 0.02, sleeveEnd + 0.02, ax));
  return U.uSuitOn.value * Math.max(shorts, top, sleeve);
}

const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

export function bakeFigure(fig, o = {}) {
  fig.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(fig.matrixWorld).invert(), M = new THREE.Matrix4(), N = new THREE.Matrix3(), v = new THREE.Vector3(), lin = new THREE.Color();
  const U = fig.skin?.userData?.u, skinC = U ? U.uSkin.value.clone() : new THREE.Color(o.skin?.tone || '#b98e72'), lipC = U ? U.uLip.value.clone() : new THREE.Color(o.skin?.lips || '#9a6a5a'), suitC = U ? U.uSuit.value.clone() : null;
  const out = []; let y0 = Infinity, y1 = -Infinity;
  fig.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || !shown(m)) return;
    const g = m.geometry, P = g.attributes.position; if (!P || !P.count) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material; if (!mat || (mat.transparent && mat.opacity < 0.05)) return;
    M.multiplyMatrices(inv, m.matrixWorld); N.getNormalMatrix(M);
    const n = P.count, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Uint8Array(n * 3);
    const Nn = g.attributes.normal, C = mat.vertexColors && g.attributes.color, UV = g.attributes.uv, lipA = g.attributes.aLip, rest = g.attributes.aRest, arm = g.attributes.aArm;
    const isSkin = mat === fig.skin, tex = !isSkin && UV && mat.map ? sampler(mat.map) : null, base = mat.color || new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      if (Nn) { v.fromBufferAttribute(Nn, i).applyMatrix3(N).normalize(); nrm[i * 3] = v.x; nrm[i * 3 + 1] = v.y; nrm[i * 3 + 2] = v.z; }
      if (isSkin) { lin.copy(skinC).lerp(lipC, lipA ? Math.min(1, lipA.getX(i)) * 0.75 : 0); if (U && suitC && rest) lin.lerp(suitC, suitAt(rest.getX(i), rest.getY(i), arm ? arm.getX(i) : 0, arm ? arm.getY(i) : 0, U)); }
      else {
        lin.copy(base);
        if (C) lin.multiply(new THREE.Color(C.getX(i), C.getY(i), C.getZ(i)));
        if (tex) { const t = tex(UV.getX(i), UV.getY(i)); lin.r *= t[0]; lin.g *= t[1]; lin.b *= t[2]; }
        if (mat.emissive && mat.emissiveIntensity > 0) { lin.r += mat.emissive.r * mat.emissiveIntensity * 0.5; lin.g += mat.emissive.g * mat.emissiveIntensity * 0.5; lin.b += mat.emissive.b * mat.emissiveIntensity * 0.5; }
      }
      col[i * 3] = toByte(lin.r); col[i * 3 + 1] = toByte(lin.g); col[i * 3 + 2] = toByte(lin.b);
    }
    if (!Nn) { const tmp = new THREE.BufferGeometry(); tmp.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (g.index) tmp.setIndex(g.index.clone()); tmp.computeVertexNormals(); nrm.set(tmp.attributes.normal.array); }
    const index = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: n }, (_, i) => i);
    out.push({ position: pos, normal: nrm, color: col, index, rough: mat.roughness ?? 0.6, metal: mat.metalness ?? 0 });
  });
  // standing on the ground
  if (Number.isFinite(y0) && Math.abs(y0) > 1e-4) for (const m of out) for (let i = 1; i < m.position.length; i += 3) m.position[i] -= y0;
  return { v: 1, height: Number.isFinite(y1) ? y1 - y0 : 0, meshes: out };
}

// what to hand over without copying
export const transfers = (b) => b.meshes.flatMap((m) => [m.position.buffer, m.normal.buffer, m.color.buffer, m.index.buffer]);
