// Human base: the eyes, our own. A ball with the iris painted round its front pole, a glossy coat for the highlight,
// and an optional glow in the iris (for eyes that should burn a little). Placed where the base mesh's eye helper
// spheres are after every morph. set({ colour: '#hex' or a name from EYE_COLOURS, glow: 0..1, white: '#hex', iris: size, 1 normal }).
import * as THREE from 'three';

export const EYE_COLOURS = {
  brown: '#5a3418', hazel: '#7a6a2c', green: '#4f7a3a', blue: '#4a7fb8', grey: '#8a949c',
  amber: '#f09a1a', yellow: '#efc222', gold: '#d6a636', orange: '#e8641a', ember: '#ff7a1e', red: '#d32a1a', pale: '#e8e2c8',
};

function eyeTexture(hex, glow, white = '#e6dfd6', irisK = 1) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 512; const g = c.getContext('2d');
  // rows run from the front of the eye (top) to the back; the iris is a disc round the front pole
  const iris = 0.165 * irisK, pupil = 0.05 * irisK, col = new THREE.Color(hex);
  g.fillStyle = white; g.fillRect(0, 0, 64, 512);
  const grd = g.createLinearGradient(0, iris * 512, 0, 512); grd.addColorStop(0, 'rgba(170,120,110,0.0)'); grd.addColorStop(0.45, 'rgba(190,120,110,0.16)'); grd.addColorStop(1, 'rgba(150,80,70,0.4)');
  g.fillStyle = grd; g.fillRect(0, iris * 512, 64, 512);
  for (let y = 0; y < iris * 512; y++) {
    const t = y / (iris * 512), k = t < pupil / iris ? 0 : 0.5 + 0.65 * (1 - Math.abs(t - 0.6) * 1.7);
    g.fillStyle = `rgb(${Math.min(255, 255 * col.r * k) | 0},${Math.min(255, 255 * col.g * k) | 0},${Math.min(255, 255 * col.b * k) | 0})`; g.fillRect(0, y, 64, 1);
  }
  for (let x = 0; x < 64; x += 2) { g.fillStyle = `rgba(0,0,0,${0.1 + 0.12 * ((x * 7) % 5) / 5})`; g.fillRect(x, pupil * 512, 1, (iris - pupil) * 512); }   // the iris's fibres
  g.fillStyle = 'rgba(20,12,8,0.75)'; g.fillRect(0, iris * 512 - 3, 64, 4);   // the dark ring at its edge
  g.fillStyle = '#050403'; g.fillRect(0, 0, 64, pupil * 512);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  const e = document.createElement('canvas'); e.width = 4; e.height = 512; const eg = e.getContext('2d'); eg.fillStyle = '#000'; eg.fillRect(0, 0, 4, 512);
  if (glow > 0) { eg.fillStyle = hex; eg.fillRect(0, pupil * 512, 4, (iris - pupil) * 512); }
  const em = new THREE.CanvasTexture(e); em.colorSpace = THREE.SRGBColorSpace;
  return { map, em };
}

export function makeEyes(o = {}) {
  const geo = new THREE.SphereGeometry(1, 48, 32).rotateX(Math.PI / 2);   // the pole the iris is drawn round faces +z
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, emissive: 0xffffff, emissiveIntensity: 0 });
  const l = new THREE.Mesh(geo, mat), r = new THREE.Mesh(geo, mat), box = new THREE.Box3(), v = new THREE.Vector3(), sz = new THREE.Vector3();
  const look = { colour: 'brown', glow: 0, white: '#e6dfd6', iris: 1 };
  const eyes = {
    l, r, material: mat,
    set(s = {}) {
      Object.assign(look, s);
      const hex = EYE_COLOURS[look.colour] || look.colour, t = eyeTexture(hex, look.glow, look.white, look.iris);
      if (mat.map) { mat.map.dispose(); mat.emissiveMap.dispose(); }
      mat.map = t.map; mat.emissiveMap = t.em; mat.emissiveIntensity = look.glow * 1.4; mat.needsUpdate = true;
      return eyes;
    },
    // each eye where its helper sphere is (vertex lists), at its size, from positions p in metres
    place(lists, p) {
      for (const [m, list] of [[l, lists.l], [r, lists.r]]) {
        box.makeEmpty(); for (const i of list) box.expandByPoint(v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
        box.getCenter(m.position); box.getSize(sz); m.scale.setScalar(((sz.x + sz.y + sz.z) / 6) * 0.97);
      }
    },
  };
  return eyes.set(o);
}
