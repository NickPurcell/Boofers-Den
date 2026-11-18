// The sculpted Duros head ("Head B"), to engineer7's head.js contract (#65):
//   makeHead(THREE, opts) -> Promise<{ object, setSkin(hex), setEyes(hex), dispose() }>
//   opts: { shape: 'round'|'tall'|'narrow', age: 0..1, expr: 'neutral'|'smile'|'stern'|'wary',
//           marks: 'none'|'freckles'|'cheeks'|'scar', skin: '#rrggbb', eyes: '#rrggbb' }
// Frame: metres, y up, facing +z, the figure's left is +x; the origin is the point between the eyes. The neck runs to
// 0.29 m below the eyes and matches the clothes' neck from (0, -0.07, -0.032) r 0.044 to (0, -0.25, -0.03) r 0.051.
// Two draw calls (skin, eyes), about 60k triangles. No lights and no environment: the page provides both.
//
// How it's made: a fine sphere pushed into the Duros head shape (tall, wide across the eyes and crown, a small chin,
// the cranium swept back; no nose, no ears), then sculpted along its normals where a face has form: eye sockets,
// brow ridges, cheekbones, temples, a lipless mouth cut into the face, and with age the hollows and lines. Eyelids are
// caps of slightly larger spheres tipped back so their edges arch over the eyes. Markings and the eye's depth are
// painted in code onto the meshes' own maps.

const UNIT = 0.09;   // metres per unit of the sculpting space (a head about 0.24 m tall, 0.18 m wide)
const HEADS = {
  round: { H: 1.32, jaw: 0.52, crown: 1.0, back: 1.06, wide: 1.0, eye: 0.32 },
  tall: { H: 1.55, jaw: 0.5, crown: 1.03, back: 1.24, wide: 1.0, eye: 0.32 },
  narrow: { H: 1.42, jaw: 0.42, crown: 0.9, back: 1.1, wide: 0.88, eye: 0.3 },
};
// what each expression moves: the mouth's curve (ends up +, down -), its width, the inner brows (up +), the cheeks,
// and the upper and lower lids (how far each comes over the eye)
const EXPR = {
  neutral: { curve: 0.55, width: 1, browIn: 0, browOut: 0, cheek: 0, upLid: 0.45, lowLid: 0.28 },
  smile: { curve: 2.0, width: 1.12, browIn: 0.02, browOut: 0, cheek: 0.035, upLid: 0.44, lowLid: 0.36 },
  stern: { curve: -0.5, width: 0.95, browIn: -0.09, browOut: 0.02, cheek: 0, upLid: 0.52, lowLid: 0.3 },
  wary: { curve: -0.1, width: 0.86, browIn: 0.07, browOut: -0.01, cheek: 0, upLid: 0.4, lowLid: 0.34 },
};
const smooth = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const gauss = (d2) => Math.exp(-d2);
// a seeded random, so a look (and its freckles) is the same every time it's built
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

export async function makeHead(THREE, opts = {}) {
  const shape = HEADS[opts.shape] || HEADS.round, ex = EXPR[opts.expr] || EXPR.neutral;
  const age = Math.min(1, Math.max(0, +opts.age || 0)), marks = opts.marks || 'none';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  /* ---- the head shape, in sculpting units ---- */
  const h = shape, R = h.eye;
  const geo = new THREE.SphereGeometry(1, 160, 120), pos = geo.attributes.position, v = V();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.y + 1) / 2;
    const w = lerp(h.jaw, 1, smooth(0.04, 0.6, t)) * lerp(1, h.crown, smooth(0.55, 0.95, t)) * h.wide * lerp(1, 0.97, age * smooth(0.1, 0.45, t));
    let z = v.z;
    if (z > 0) z *= lerp(0.74, 0.9, smooth(0, 0.7, t)) * lerp(1, 0.92, smooth(0.6, 1, t));
    else z *= lerp(0.88, h.back, smooth(0.3, 0.9, t));
    z -= smooth(0.55, 1, t) * (h.back - 1) * 1.1;
    if (t < 0.22 && v.z > 0) z += (0.22 - t) * 0.5;
    pos.setXYZ(i, v.x * w, v.y * h.H, z);
  }
  geo.computeVertexNormals();

  // where the face's features sit, found on the unsculpted shape: straight in from the front
  const probe = new THREE.Mesh(geo); probe.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const front = (x, y) => {
    ray.set(V(x, y, 20), V(0, 0, -1));
    const hit = ray.intersectObject(probe, false)[0];
    return hit ? { p: hit.point.clone(), n: hit.face.normal.clone().normalize(), uv: hit.uv && hit.uv.clone() } : null;
  };
  const eyes = [-1, 1].map((sx) => front(sx * 0.43 * h.wide, h.H * 0.06)).filter(Boolean);
  const my = -h.H * 0.56;

  /* ---- sculpting along the normals ---- */
  const nrm = geo.attributes.normal, n = V(), p = V(), out = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i);
    if (n.z < -0.25) continue;   // the back of the head stays as it is
    let d = 0;
    for (const e of eyes) {
      const side = Math.sign(e.p.x), dx = (p.x - e.p.x) / R, dy = (p.y - e.p.y) / R, dz = (p.z - e.p.z) / R;
      d -= 0.42 * (1 + 0.35 * age) * R * gauss((dx * dx + dy * dy + dz * dz) / 0.78);                    // the socket
      // the brow ridge: an arc over the eye, its inner and outer ends moved by the expression
      const across = (p.x - e.p.x) / (R * 1.25), inner = smooth(0.6, -0.9, across * side);   // 1 toward the middle
      const lift = (ex.browIn * inner + ex.browOut * (1 - inner)) * 1.0;
      const by = (p.y - e.p.y - R * 1.02 - lift) / (R * 0.34);
      d += (0.055 + 0.015 * age + (ex.browIn < 0 ? 0.02 * inner : 0)) * gauss(across * across + by * by);
      // the cheekbone, fuller when young or smiling; a hollow under it with age
      const cx = (p.x - e.p.x - side * R * 0.35) / (R * 0.9), cy = (p.y - e.p.y + R * 1.2 - ex.cheek * 4) / (R * 0.45);
      d += (0.04 * (1 - 0.45 * age) + ex.cheek) * gauss(cx * cx + cy * cy);
      const hx = (p.x - e.p.x - side * R * 0.45) / (R * 0.9), hy = (p.y - e.p.y + R * 2.1) / (R * 0.7);
      d -= 0.035 * age * gauss(hx * hx + hy * hy);
      // under the eye: a soft bag with age
      const ux = (p.x - e.p.x) / (R * 0.8), uy = (p.y - e.p.y + R * 1.02) / (R * 0.18);
      d += 0.012 * age * gauss(ux * ux + uy * uy);
      // the temple, deeper with age
      const tx = (p.x - e.p.x - side * R * 1.6) / (R * 0.7), ty = (p.y - e.p.y - R * 0.3) / (R * 0.9);
      d -= (0.025 + 0.025 * age) * gauss(tx * tx + ty * ty);
    }
    if (p.z > 0.15) {
      // the mouth: a thin cut with soft lines either side; its ends follow the expression
      const ax = Math.abs(p.x) / (h.wide * ex.width), yc = my + ax * ax * ex.curve * 0.3 + (ex.curve < 0 ? 0.01 : 0);
      const m = smooth(0.32, 0.2, ax), u = (p.y - yc) / 0.022;
      d += m * (-0.034 * gauss(u * u) + 0.012 * gauss(((p.y - yc - 0.06) / 0.035) ** 2) + 0.01 * gauss(((p.y - yc + 0.065) / 0.04) ** 2));
      // with age (or a smile), a line from the cheek to the mouth's corner
      const k = 0.008 * age + (ex.curve > 1 ? 0.006 : 0);
      if (k) for (const s of [-1, 1]) {   // a slanted groove, from beside the cheekbone down toward the mouth's corner
        const lx = p.x - s * 0.3 * h.wide, ly = p.y - (my + 0.12), q = (lx * 0.92 - ly * 0.4 * s) / 0.03;
        d -= k * gauss(q * q) * gauss((ly / 0.2) ** 2);
      }
      const cy = (p.y - (my - 0.32)) / 0.12, cx = p.x / 0.25;
      d -= 0.018 * gauss(cx * cx + cy * cy);                                       // the dip above the chin
      // with age, faint lines across the forehead
      if (age > 0.3 && p.y > h.H * 0.32 && p.y < h.H * 0.6) d -= 0.006 * (age - 0.3) * Math.max(0, Math.sin(p.y * 44)) * smooth(0.55, 0.2, Math.abs(p.x));
    }
    if (marks === 'scar') {   // a healed cut across the right brow and cheek, a narrow groove
      const sx = p.x + 0.4 * h.wide, sy = p.y - 0.05, along = sx * 0.45 + sy * 0.89, across = (sx * 0.89 - sy * 0.45) / 0.018;
      if (Math.abs(along) < 0.42) d -= 0.012 * gauss(across * across) * smooth(0.42, 0.3, Math.abs(along));
    }
    out[i] = d;
  }
  for (let i = 0; i < pos.count; i++) if (out[i]) {
    n.fromBufferAttribute(nrm, i);
    pos.setXYZ(i, pos.getX(i) + n.x * out[i], pos.getY(i) + n.y * out[i], pos.getZ(i) + n.z * out[i]);
  }
  geo.computeVertexNormals();

  /* ---- the eyes and their lids ---- */
  const eyeGeos = [], skinGeos = [geo];
  const mid = V();
  for (const e of eyes) {
    const c = e.p.clone().addScaledVector(e.n, -R * 0.78);
    mid.add(c);
    const look = new THREE.Object3D(); look.position.copy(c); look.lookAt(c.clone().add(e.n)); look.updateMatrix();
    const eg = new THREE.SphereGeometry(R, 48, 32); eg.applyMatrix4(new THREE.Matrix4().makeScale(1, 1.04, 0.92)); eg.applyMatrix4(look.matrix);
    eyeGeos.push(eg);
    const lid = (start, len, tip) => {
      const lg = new THREE.SphereGeometry(R * 1.06, 64, 24, 0, Math.PI * 2, start, len);
      lg.applyMatrix4(new THREE.Matrix4().makeRotationX(tip)); lg.applyMatrix4(new THREE.Matrix4().makeScale(1, 1.04, 0.92)); lg.applyMatrix4(look.matrix);
      skinGeos.push(lg);
    };
    lid(0, Math.PI * ex.upLid, -0.45);                                 // the upper lid
    lid(Math.PI * (1 - ex.lowLid), Math.PI * ex.lowLid, 0.45);         // the lower lid
  }
  mid.multiplyScalar(1 / Math.max(1, eyes.length));

  // into the page's frame: metres, the origin between the eyes
  const toFrame = new THREE.Matrix4().makeScale(UNIT, UNIT, UNIT).multiply(new THREE.Matrix4().makeTranslation(-mid.x, -mid.y, -mid.z));
  for (const g of [...skinGeos, ...eyeGeos]) g.applyMatrix4(toFrame);

  /* ---- the neck, to the clothes' measurements ---- */
  {
    const prof = [[0.001, 0.05], [0.04, 0.045], [0.05, 0.0], [0.046, -0.04], [0.044, -0.07], [0.0475, -0.16], [0.051, -0.25], [0.052, -0.29], [0.001, -0.292]];
    const ng = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 48);
    // the clothes' neck runs from z -0.032 at the top to -0.03 at -0.25: lean it the same, a touch
    const lean = new THREE.Matrix4().makeShear(0, 0, 0, 0, 0, -0.011);   // makeShear(xy, xz, yx, yz, zx, zy): z += -0.011 * y
    ng.applyMatrix4(lean); ng.translate(0, 0, -0.0328);
    skinGeos.push(ng);
  }
  const skinGeo = merge(THREE, skinGeos), eyeGeo = merge(THREE, eyeGeos);
  for (const g of [...skinGeos, ...eyeGeos]) g.dispose();

  /* ---- materials: skin with its markings and grain, eyes with depth ---- */
  const skinMap = paintMarks(THREE, marks, eyes, h, opts.seed || 7);
  const skinMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: skinMap, roughness: 0.46 + 0.16 * age, metalness: 0, dithering: true,   // dithering: no banding on the smooth gradients
    sheen: 0.35 * (1 - 0.5 * age), sheenRoughness: 0.6, sheenColor: 0x9fd0ff, clearcoat: 0.12 * (1 - age), clearcoatRoughness: 0.6,
    bumpMap: grain(THREE), bumpScale: 0.05 + 0.05 * age,   // gentle: this is a head about 0.24 m tall
  });
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: eyeDepth(THREE), dithering: true, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 });
  const skinMesh = new THREE.Mesh(skinGeo, skinMat), eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
  for (const m of [skinMesh, eyeMesh]) { m.castShadow = true; m.receiveShadow = true; }
  const object = new THREE.Group(); object.name = 'duros-head-sculpted'; object.add(skinMesh, eyeMesh);

  // the map is painted at 200/255 where there's no marking, so a scar can show lighter than the skin: the colour is
  // lifted to match
  const setSkin = (hex) => { skinMat.color.set(hex).multiplyScalar(255 / 200); };
  const setEyes = (hex) => { eyeMat.color.set(hex); eyeMat.emissive.set(hex).multiplyScalar(0.08); };
  setSkin(opts.skin || '#4c86b8'); setEyes(opts.eyes || '#d0222c');
  const dispose = () => {
    skinGeo.dispose(); eyeGeo.dispose();
    for (const m of [skinMat, eyeMat]) { for (const k of ['map', 'bumpMap']) if (m[k]) m[k].dispose(); m.dispose(); }
  };
  return { object, setSkin, setEyes, dispose };
}

/* ---------------- helpers ---------------- */
// several indexed geometries with position, normal and uv into one
function merge(THREE, geos) {
  let vn = 0, in_ = 0;
  for (const g of geos) { vn += g.attributes.position.count; in_ += g.index ? g.index.count : g.attributes.position.count; }
  const P = new Float32Array(vn * 3), N = new Float32Array(vn * 3), U = new Float32Array(vn * 2), I = new Uint32Array(in_);
  let vo = 0, io = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array, vo * 3); N.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, vo * 2);
    const idx = g.index ? g.index.array : Array.from({ length: c }, (_, k) => k);
    for (let k = 0; k < idx.length; k++) I[io + k] = idx[k] + vo;
    vo += c; io += idx.length;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(P, 3)); m.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(U, 2)); m.setIndex(new THREE.BufferAttribute(I, 1));
  m.computeBoundingSphere();
  return m;
}
// fine skin grain: a tileable noise for the bump map
function grain(THREE) {
  const n = 256, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d'), img = x.createImageData(n, n), r = rng(11);
  for (let i = 0; i < n * n; i++) { const v = 118 + r() * 20 + (r() < 0.012 ? -40 : 0); img.data.set([v, v, v, 255], i * 4); }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(8, 5);
  return t;
}
// depth in a Duros eye (no white, no pupil): brighter at the centre, a darker ring, the edge falling off darker, faint
// streaks. On the eye sphere's own map, whose front (+z) is at u = 0.25, v = 0.5.
function eyeDepth(THREE) {
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const phi = (i / W) * Math.PI * 2, th = (j / H) * Math.PI;
    const dz = Math.sin(phi) * Math.sin(th), a = Math.acos(Math.max(-1, Math.min(1, dz)));
    const streak = 0.025 * Math.sin(Math.atan2(Math.cos(th), -Math.cos(phi) * Math.sin(th)) * 22);
    let val = 1 - 0.25 * smooth(0, 0.5, a) - 0.22 * Math.exp(-(((a - 0.62) / 0.09) ** 2)) - 0.45 * smooth(0.75, 1.3, a) + (a < 0.6 ? streak : 0);
    val = Math.max(0.12, Math.min(1, val)) * 255;
    img.data.set([val, val, val, 255], (j * W + i) * 4);
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// the skin's map: 200/255 everywhere (the colour is lifted to match), darker where a marking is, lighter for a scar.
// Painted in the head sphere's own UVs: u = phi / 2pi with the front (+z) at u = 0.25, v = 1 - theta / pi.
function paintMarks(THREE, marks, eyes, h, seed) {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = 'rgb(200,200,200)'; x.fillRect(0, 0, W, H);
  // a point on the face (sculpting units, before the head was shaped) to the map: the sphere's own angles
  const at = (sx, sy) => {   // sx, sy: -1..1 across and up the face, as seen from the front
    const yy = Math.max(-0.999, Math.min(0.999, sy)), r = Math.sqrt(1 - yy * yy), xx = Math.max(-r, Math.min(r, sx * r));
    const zz = Math.sqrt(Math.max(0, r * r - xx * xx));
    const phi = Math.atan2(zz, -xx), theta = Math.acos(yy);
    return [((phi / (Math.PI * 2)) + 1) % 1 * W, theta / Math.PI * H];
  };
  const r = rng(seed);
  if (marks === 'freckles') {   // a scatter over the cheeks and across the upper face, denser on the cheekbones
    x.fillStyle = 'rgba(70,70,70,0.55)';
    for (let k = 0; k < 140; k++) {
      const side = k % 2 ? 1 : -1, s = side * (0.25 + r() * 0.5), y = -0.1 - r() * 0.32 + (r() < 0.25 ? 0.25 : 0);
      const [u, v] = at(s * (1 / h.wide), y);
      x.beginPath(); x.arc(u, v, 1.2 + r() * 2.2, 0, Math.PI * 2); x.fill();
    }
  } else if (marks === 'cheeks') {   // three short stripes down each cheek, a little curved, like clan marks
    x.strokeStyle = 'rgba(40,40,40,0.75)'; x.lineCap = 'round';
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
      x.lineWidth = 6 - k;
      x.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const [u, v] = at(side * (0.42 + k * 0.1 + t * 0.05), -0.12 - t * 0.28);
        if (t === 0) x.moveTo(u, v); else x.lineTo(u, v);
      }
      x.stroke();
    }
  } else if (marks === 'scar') {   // the healed cut, lighter than the skin, over the groove sculpted into it
    x.strokeStyle = 'rgba(255,240,240,0.85)'; x.lineWidth = 4; x.lineCap = 'round';
    x.beginPath();
    for (let t = -1; t <= 1.0001; t += 0.1) {
      const [u, v] = at(-0.4 + t * 0.19, 0.04 / h.H + t * 0.3);
      if (t === -1) x.moveTo(u, v); else x.lineTo(u, v);
    }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);   // linear on purpose: its grey is a multiplier, so 200 means 200/255, matched by the lift
  return t;
}
