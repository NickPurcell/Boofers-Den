// The head's contract, and the skin helpers every part of the figure shares.
//
//   makeHead(THREE, opts) -> Promise<{ object, setSkin(hex), setEyes(hex), dispose() }>
//   opts: { shape: 'round'|'tall'|'narrow', age: 0..1, expr: 'neutral'|'smile'|'stern'|'wary',
//           marks: 'none'|'freckles'|'cheeks'|'scar', skin: '#rrggbb', eyes: '#rrggbb' }
//
// Metres, y up, facing +z, the figure's left is +x. `object`'s origin is the point between the eyes; the page puts it
// at (0, 1.715, 0). The neck reaches 0.29 m below the eyes, inside the collar. Clothes are fitted to a neck running
// from (0, -0.07, -0.032) radius 0.044 to (0, -0.25, -0.03) radius 0.051 in this frame, so a head's neck should stay
// within a few millimetres of that below -0.17. Meshes cast and receive shadows; the page provides the lights and
// the environment.
//
// The head on the page is head-sculpt.js (its shapes in head-b-field.js), by jpesus's agent, shaped to a study of
// reference pictures of the species. This file keeps what the head, the hands and the page all use.

const noise3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };
export function smoothNoise(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), fx = x - i, fy = y - j, fz = z - k;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, t) => a + (b - a) * t, n = (a, b, c) => noise3(i + a, j + b, k + c);
  return L(L(L(n(0, 0, 0), n(1, 0, 0), u), L(n(0, 1, 0), n(1, 1, 0), u), v), L(L(n(0, 0, 1), n(1, 0, 1), u), L(n(0, 1, 1), n(1, 1, 1), u), v), w);
}
// skin colour per vertex: occlusion that runs a little purple-red in the creases (a stand-in for light under the skin),
// a faint mottle, and (on the head) darker lips, the markings and an older skin's dullness
export function paintSkin(geo, opts = {}) {
  const ao = geo.userData.ao, pos = geo.attributes.position, col = geo.attributes.color, marks = opts.marks || 'none', age = opts.age || 0, head = !!opts.head, eye = opts.eye;
  for (let i = 0; i < ao.length; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const o = Math.pow(ao[i], 1.25), m = 0.94 + 0.12 * smoothNoise(x * 60, y * 60, z * 60) + 0.04 * smoothNoise(x * 260, y * 260, z * 260);
    let r = (0.42 + 0.58 * o) * (1 + (1 - o) * 0.22), g = (0.42 + 0.58 * o) * (1 - (1 - o) * 0.1), b = 0.42 + 0.58 * o;
    r *= m; g *= m; b *= m;
    // mottling: soft darker patches, as on the references' skin (stronger on the cranium, see below)
    const patch = Math.min(1, Math.max(0, smoothNoise(x * 21 + 3.1, y * 21 + 1.7, z * 21) * 0.65 + smoothNoise(x * 47, y * 47 + 5.3, z * 47) * 0.35 - 0.47) * 3.2);
    let dark = patch * 0.14;
    if (head) {
      // the cranium carries the darker patches; the middle of the face is a shade lighter; the skin round the eyes darker
      dark = patch * (0.12 + 0.2 * Math.min(1, Math.max(0, (y - 0.02) / 0.05)));
      const centre = Math.exp(-((x / 0.026) ** 2)) * (y < 0.01 && y > -0.1 && z > 0.04 ? 1 : 0);
      const ex = eye ? eye.x : 0.04, ey = eye ? eye.y : 0, round = Math.exp(-(((Math.abs(x) - ex) / 0.03) ** 2 + ((y - ey) / 0.022) ** 2)) * (z > 0.02 ? 1 : 0);
      const k = (1 + centre * 0.07) * (1 - round * 0.2) * (1 - Math.max(0, y - 0.09) * 0.5);
      r *= k; g *= k; b *= k;
      const dull = 1 - age * 0.07; r = r * dull + age * 0.02; g = g * dull + age * 0.02; b = b * dull + age * 0.02;
      if (marks === 'freckles' && y > -0.03 && Math.abs(x) > 0.035) {
        const cx = Math.floor(x / 0.009), cy = Math.floor(y / 0.009), cz = Math.floor(z / 0.009);
        let near = 0;
        for (let a = -1; a <= 1; a++) for (let bb = -1; bb <= 1; bb++) for (let c = -1; c <= 1; c++) {
          if (noise3(cx + a, cy + bb, cz + c) > 0.55) continue;
          const px = (cx + a + noise3(cx + a + 9, cy + bb, cz + c)) * 0.009, py = (cy + bb + noise3(cx + a, cy + bb + 9, cz + c)) * 0.009, pz = (cz + c + noise3(cx + a, cy + bb, cz + c + 9)) * 0.009;
          near = Math.max(near, Math.exp(-((x - px) ** 2 + (y - py) ** 2 + (z - pz) ** 2) / (0.0016 ** 2)));
        }
        const f = 1 - near * 0.38; r *= f; g *= f; b *= f * 0.97;
      }
      if (marks === 'cheeks' && z > 0.035) {
        const e = eye ? eye.x : 0.0385;
        for (const s of [-1, 1]) for (const off of [-0.007, 0.006]) {
          const t = Math.exp(-(((x - s * (e + off)) / 0.0024) ** 2)) * Math.exp(-(((y + 0.047) / 0.017) ** 6));
          const f = 1 - t * 0.45; r *= f; g *= f; b *= f;
        }
      }
      if (marks === 'scar') {   // across the figure's right brow and cheek (screen left), skipping the eye
        const ax = -0.012, ay = 0.06, bx = -0.07, by = -0.045, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (L * L))), d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
        if (z > 0.02 && !(Math.hypot(x + (eye ? eye.x : 0.0385), y) < 0.028)) { const s = Math.exp(-((d / 0.0016) ** 2)) * Math.sin(t * Math.PI) ** 0.3; r += s * 0.32; g += s * 0.26; b += s * 0.2; }
      }
    }
    r *= 1 - dark; g *= 1 - dark * 0.92; b *= 1 - dark * 0.85;
    col.setXYZ(i, r, g, b);
  }
  col.needsUpdate = true;
}

export function geometryFrom(THREE, m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.userData.ao = m.ao;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m.ao.length * 3), 3));
  g.computeBoundingSphere();
  return g;
}
