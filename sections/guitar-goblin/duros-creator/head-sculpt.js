// Head B, to the head contract (see head.js):
//   makeHead(THREE, opts) -> Promise<{ object, setSkin(hex), setEyes(hex), dispose() }>
// Metres, y up, facing +z, the origin between the eyes. The neck follows the clothes' neck (as A's does).
//
// Built on the same method as Head A: signed distance shapes (head-b-field.js) meshed in a worker (the 'headB' job in
// jobs.js), with baked occlusion painted into the skin (head.js paintSkin). B keeps its own look: the inverted egg with
// the skull swept back, large glossy wide-set eyes under clean lids, a flat face and a lipless slit of a mouth.
// Four draw calls: the head and neck, both eyes, all four lids, and the mouth line.
import { cached } from './pool.js';
import { geometryFrom, paintSkin } from './head.js';
import { skinMaterial, eyeTexture } from './materials.js';

export async function makeHead(THREE, opts = {}) {
  const age = Math.max(0, Math.min(1, +opts.age || 0));
  const r = await cached(`headB:${opts.shape}:${opts.expr}:${age}`, 'headB', { shape: opts.shape, expr: opts.expr, age });
  const object = new THREE.Group(); object.name = 'duros-head-b';
  const skin = skinMaterial();
  const lidMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.48, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x9ec8ff), clearcoat: 0.25, clearcoatRoughness: 0.35 });
  // B's eyes: glossier than A's, a wet clearcoat over a smooth surface
  const eyeMat = new THREE.MeshPhysicalMaterial({ roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0xffffff, emissiveIntensity: 0.05 });
  const mouthMat = new THREE.MeshStandardMaterial({ color: 0x14202c, roughness: 0.7 });

  // the head and neck, its colours painted from its own occlusion (and the markings and age)
  const geo = geometryFrom(THREE, { position: r.mesh.position.slice(), normal: r.mesh.normal.slice(), uv: r.mesh.uv.slice(), index: r.mesh.index.slice(), ao: r.mesh.ao });
  paintSkin(geo, { head: true, marks: opts.marks, age, eye: r.eye });
  const headMesh = new THREE.Mesh(geo, skin);

  // the eyes and lids, built per eye and then merged: one mesh for both eyes, one for all four lids
  const e = r.eye, eyeGeos = [], lidGeos = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Object3D();
    pivot.position.set(sx * e.x, e.y, e.z);
    pivot.lookAt(new THREE.Vector3(sx * e.x + sx * 0.25, e.y - 0.02, e.z + 1));   // wide-set eyes look a little outward
    pivot.updateMatrix();
    const at = (g, local) => { if (local) g.applyMatrix4(local); g.applyMatrix4(pivot.matrix); return g; };
    const ball = new THREE.SphereGeometry(e.r, 40, 28); ball.rotateX(Math.PI / 2);   // the texture's pole to the front
    eyeGeos.push(at(ball));
    const rl = e.r + 0.0017, tip = (rx) => new THREE.Matrix4().makeRotationX(rx);
    lidGeos.push(at(new THREE.SphereGeometry(rl, 40, 14, 0, Math.PI * 2, 0, r.lid.upper), tip(-0.18)));
    const upEdge = new THREE.TorusGeometry(rl * Math.sin(r.lid.upper), 0.0021, 6, 40); upEdge.rotateX(Math.PI / 2); upEdge.translate(0, rl * Math.cos(r.lid.upper), 0);
    lidGeos.push(at(upEdge, tip(-0.18)));
    lidGeos.push(at(new THREE.SphereGeometry(rl, 40, 10, 0, Math.PI * 2, Math.PI - r.lid.lower, r.lid.lower), tip(0.12)));
    const loEdge = new THREE.TorusGeometry(rl * Math.sin(r.lid.lower), 0.0018, 6, 40); loEdge.rotateX(Math.PI / 2); loEdge.translate(0, -rl * Math.cos(r.lid.lower), 0);
    lidGeos.push(at(loEdge, tip(0.12)));
  }
  const eyesMesh = new THREE.Mesh(merge(THREE, eyeGeos), eyeMat), lidsMesh = new THREE.Mesh(merge(THREE, lidGeos), lidMat);
  for (const g of [...eyeGeos, ...lidGeos]) g.dispose();
  for (const m of [headMesh, eyesMesh, lidsMesh]) { m.castShadow = true; m.receiveShadow = true; }
  object.add(headMesh, eyesMesh, lidsMesh);
  if (r.mouth && r.mouth.length > 2) {
    const curve = new THREE.CatmullRomCurve3(r.mouth.map((p) => new THREE.Vector3(...p)));
    object.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.0008, 6, false), mouthMat));
  }

  const setSkin = (hex) => {
    const c = new THREE.Color(hex);
    skin.color.copy(c); skin.sheenColor.copy(c).lerp(new THREE.Color(0xffffff), 0.45);
    lidMat.color.copy(c).multiplyScalar(0.88); lidMat.sheenColor.copy(skin.sheenColor);
    mouthMat.color.copy(c).multiplyScalar(0.16);
  };
  const setEyes = (hex) => { const t = eyeTexture(hex); if (eyeMat.map) eyeMat.map.dispose(); eyeMat.map = t; eyeMat.emissiveMap = t; eyeMat.needsUpdate = true; };
  setSkin(opts.skin || '#4f86b6'); setEyes(opts.eyes || '#cf1f2a');
  const dispose = () => { object.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); if (eyeMat.map) eyeMat.map.dispose(); for (const m of [skin, lidMat, eyeMat, mouthMat]) m.dispose(); };
  return { object, setSkin, setEyes, dispose };
}

// indexed geometries with position, normal and uv, as one
function merge(THREE, geos) {
  let vn = 0, n = 0;
  for (const g of geos) { vn += g.attributes.position.count; n += g.index.count; }
  const P = new Float32Array(vn * 3), N = new Float32Array(vn * 3), U = new Float32Array(vn * 2), I = new Uint32Array(n);
  let vo = 0, io = 0;
  for (const g of geos) {
    P.set(g.attributes.position.array, vo * 3); N.set(g.attributes.normal.array, vo * 3); U.set(g.attributes.uv.array, vo * 2);
    const idx = g.index.array; for (let k = 0; k < idx.length; k++) I[io + k] = idx[k] + vo;
    vo += g.attributes.position.count; io += idx.length;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(U, 2)); m.setIndex(new THREE.BufferAttribute(I, 1)); m.computeBoundingSphere();
  return m;
}
