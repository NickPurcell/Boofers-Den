// Skin, eyes and lids for the humanoid figure: the materials, the eye's texture, and the small meshes of an eye.
// The face's own paint (lips, brows, tattoos) is face-paint.js.
import * as THREE from 'three';
import { textures } from '../duros-creator/materials.js';

// mesher arrays -> a geometry with baked occlusion as vertex colour (running a little red in the creases, as light
// does under skin) and a second set of uvs wrapped round the head, for the face paint
export function skinGeometry(m, o = {}) {
  const g = new THREE.BufferGeometry(), n = m.ao.length, col = new Float32Array(n * 3);
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  for (let i = 0; i < n; i++) {
    if (o.cloth) { const v = 0.32 + 0.68 * Math.pow(m.ao[i], 1.4); col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v; continue; }
    if (o.hair) { const v = 0.3 + 0.7 * Math.pow(m.ao[i], 2); col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v; continue; }   // hair: darker between the locks
    const a = Math.pow(m.ao[i], 1.5), v = 0.5 + 0.5 * a;
    col[i * 3] = v * (1 + (1 - a) * 0.2); col[i * 3 + 1] = v * (1 - (1 - a) * 0.1); col[i * 3 + 2] = v * (1 - (1 - a) * 0.06);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (o.wrap) {   // u round the head from the back (0) by the figure's right, the front (0.5) and its left, to the back (1); v up
    const [cx, y0, cz, hgt] = o.wrap, uv1 = new Float32Array(n * 2), p = m.position;
    for (let i = 0; i < n; i++) { uv1[i * 2] = 0.5 + Math.atan2(p[i * 3] - cx, p[i * 3 + 2] - cz) / (2 * Math.PI); uv1[i * 2 + 1] = (p[i * 3 + 1] - y0) / hgt; }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  }
  g.computeBoundingSphere();
  return g;
}
export function skinMaterial(map) {
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.56, metalness: 0,
    normalMap: textures.skin, normalScale: new THREE.Vector2(0.2, 0.2), sheen: 0.28, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffffff), clearcoat: 0.04, clearcoatRoughness: 0.55 });
  if (map) { map.channel = 1; m.map = map; }
  return m;
}

// An eye's texture, wrapped so its pole is the front of the eye: a pupil, an iris of fine spokes with a dark rim, and
// the white (a species may tint it). Angles are from the front, in degrees.
export function eyeTexture(irisHex, o = {}) {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), iris = new THREE.Color(irisHex), white = new THREE.Color(o.white || '#e9e4de'), col = new THREE.Color();
  const dark = iris.clone().multiplyScalar(0.28), light = iris.clone().lerp(new THREE.Color(1, 0.95, 0.8), 0.28), IR = o.iris ?? 28.5, PU = o.pupil ?? 10;
  const hash = (i) => { const s = Math.sin(i * 127.1) * 43758.5453; return s - Math.floor(s); };
  for (let y = 0; y < H; y++) {
    const th = (y / H) * 180;
    for (let x = 0; x < W; x++) {
      const a = (x / W) * 360, spoke = 0.82 + 0.3 * hash(Math.floor(a * 1.4)) * (0.5 + 0.5 * Math.sin(a * 0.9 + th));
      if (th < PU) col.setRGB(0.012, 0.012, 0.014);
      else if (th < IR) {
        const t = (th - PU) / (IR - PU);
        col.copy(light).lerp(iris, Math.min(1, t * 1.6)).multiplyScalar(spoke);
        col.lerp(dark, Math.max(0, (t - 0.72) / 0.28) ** 1.5 * 0.85);        // the dark ring at the iris's edge
        col.lerp(new THREE.Color(0.012, 0.012, 0.014), Math.max(0, 1 - (th - PU) / 1.6) * 0.8);
      } else {
        const t = Math.min(1, (th - IR) / 2.2);
        col.copy(dark).lerp(white, t);
        col.lerp(new THREE.Color(0.75, 0.42, 0.38), Math.min(0.45, Math.max(0, (th - 62) / 70)));   // pinker toward the corners
      }
      col.convertLinearToSRGB();   // THREE.Color is linear; the canvas holds sRGB
      const k = (x + y * W) * 4;
      img.data[k] = Math.min(255, col.r * 255); img.data[k + 1] = Math.min(255, col.g * 255); img.data[k + 2] = Math.min(255, col.b * 255); img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// Both eyes and their lids as three geometries (balls, lids, lash lines), in the head's frame. eye: { x, y, z, r };
// lid: { upper, lower, tilt } (how far each lid comes round the ball from its pole, in radians).
export function eyeGeometries(eye, lid) {
  const balls = [], lids = [], lashes = [], rl = eye.r + 0.0012;
  for (const sx of [-1, 1]) {
    const place = new THREE.Matrix4().makeTranslation(sx * eye.x, eye.y, eye.z).multiply(new THREE.Matrix4().makeRotationY(sx * 0.07)).multiply(new THREE.Matrix4().makeRotationZ(sx * (lid.tilt || 0)));
    const put = (g, rx) => { if (rx) g.rotateX(rx); g.applyMatrix4(place); return g; };
    const ball = new THREE.SphereGeometry(eye.r, 36, 24); ball.rotateX(Math.PI / 2);   // the texture's pole to the front
    balls.push(put(ball));
    lids.push(put(new THREE.SphereGeometry(rl, 36, 12, 0, Math.PI * 2, 0, lid.upper), -0.15));
    lids.push(put(new THREE.SphereGeometry(rl, 36, 10, 0, Math.PI * 2, Math.PI - lid.lower, lid.lower), 0.1));
    const lo = new THREE.TorusGeometry(rl * Math.sin(lid.lower), 0.0007, 5, 36); lo.rotateX(Math.PI / 2); lo.translate(0, -rl * Math.cos(lid.lower), 0); lids.push(put(lo, 0.1));
    const up = new THREE.TorusGeometry(rl * Math.sin(lid.upper), 0.00095, 5, 36); up.rotateX(Math.PI / 2); up.translate(0, rl * Math.cos(lid.upper), 0); lashes.push(put(up, -0.15));
  }
  return { balls: merge(balls), lids: merge(lids), lashes: merge(lashes) };
}
// indexed geometries with position, normal and uv, as one
export function merge(geos) {
  let vn = 0, n = 0;
  for (const g of geos) { vn += g.attributes.position.count; n += g.index.count; }
  const P = new Float32Array(vn * 3), N = new Float32Array(vn * 3), U = new Float32Array(vn * 2), I = new Uint32Array(n);
  let vo = 0, io = 0;
  for (const g of geos) {
    P.set(g.attributes.position.array, vo * 3); N.set(g.attributes.normal.array, vo * 3); U.set(g.attributes.uv.array, vo * 2);
    const idx = g.index.array; for (let k = 0; k < idx.length; k++) I[io + k] = idx[k] + vo;
    vo += g.attributes.position.count; io += idx.length; g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(U, 2)); m.setIndex(new THREE.BufferAttribute(I, 1)); m.computeBoundingSphere();
  return m;
}

// hair: a satin sheen and fine fibres running along each lock (the mesh's uvs run up and down the head on its
// sides and front to back on top, which is how hair lies)
let fibres = null;
export function hairMaterial() {
  if (!fibres) {
    const S = 256, data = new Uint8Array(S * S * 4), h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const yy = Math.floor(y / 48), f = (y / 48) - yy; hgt[x + y * S] = 0.6 * h(x, 1) + 0.25 * h(Math.floor(x / 3), 7) + 0.15 * (h(x, yy + 9) * (1 - f) + h(x, ((yy + 1) % Math.ceil(S / 48)) + 9) * f); }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const l = hgt[((x - 1 + S) % S) + y * S], r = hgt[((x + 1) % S) + y * S]; let nx = (l - r) * 1.6, nz = 1; const len = Math.hypot(nx, nz); nx /= len; nz /= len;
      const o = (x + y * S) * 4; data[o] = (nx * 0.5 + 0.5) * 255; data[o + 1] = 128; data[o + 2] = (nz * 0.5 + 0.5) * 255; data[o + 3] = 255;
    }
    fibres = new THREE.DataTexture(data, S, S, THREE.RGBAFormat); fibres.wrapS = fibres.wrapT = THREE.RepeatWrapping; fibres.magFilter = THREE.LinearFilter; fibres.minFilter = THREE.LinearMipmapLinearFilter; fibres.generateMipmaps = true; fibres.anisotropy = 4; fibres.needsUpdate = true;
  }
  return new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.46, metalness: 0, normalMap: fibres, normalScale: new THREE.Vector2(0.55, 0.55), sheen: 0.55, sheenRoughness: 0.4, side: THREE.DoubleSide });
}
