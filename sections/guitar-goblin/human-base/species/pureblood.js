// Human base, species features: the Sith Pureblood. Our own, built on the base's landmarks:
// - bone ridges on the brow and the cheekbones: our own morph targets (raised bone, short, rounded at the ends),
//   computed once from the unmorphed mesh and blended like any other morph, so they ride every slider;
// - spurs: short horns with mass and a flared root, meshed on their own and set on landmark vertices along the surface
//   normal, sunk a little into the skin;
// - tendrils: flesh, hanging from the jaw and chin, wide at the root with a slow taper and a rounded tip, each a little
//   different; short by default, longer as an option, with rings on them as jewellery.
// pureblood(fig, base) -> { set({ on, ridges, spurs, tendrils, length, jewellery, spurColour }), group }
import * as THREE from 'three';

export const PUREBLOOD = {
  options: {
    ridges: { label: 'Bone ridges', min: 0, max: 1, def: 0.85 },
    spurs: { label: 'Spurs', def: 'cheekchin', items: { none: 'None', cheek: 'Cheeks', cheekchin: 'Cheeks and chin', brow: 'Brow and cheeks', jaw: 'Jaw' } },
    tendrils: { label: 'Tendrils', def: 'jaw', items: { none: 'None', chin: 'Chin', jaw: 'Jaw', cheek: 'Cheeks and jaw', beard: 'Full' } },
    length: { label: 'Tendril length', def: 'short', items: { short: 'Short', long: 'Long' } },
    jewellery: { label: 'Rings', def: 'none', items: { none: 'None', gold: 'Gold', silver: 'Silver', bronze: 'Bronze', black: 'Black iron' } },
  },
};
const METALS = { gold: 0xd8a83a, silver: 0xd6d8dc, bronze: 0xa86a3a, black: 0x2a2a2e };

// a little random number source that gives the same run for the same seed
const rng = (seed) => { let a = (seed * 2654435761) >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/* ---------------- bone ridges, as morph targets ---------------- */
// segments [A, B] in the base mesh's frame (decimetres), each raised along the surface normal: a rounded crest of
// half-width w and height h, the ends rounded off
function ridgeTarget(base, segs) {
  const { rest: p, restN: n, N, inBody } = base, out = new Map();
  for (const { A, B, w, h } of segs) {
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    for (let i = 0; i < N; i++) {
      if (!inBody[i]) continue;
      const ap = [p[i * 3] - A[0], p[i * 3 + 1] - A[1], p[i * 3 + 2] - A[2]], t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / L2));
      const dx = ap[0] - ab[0] * t, dy = ap[1] - ab[1] * t, dz = ap[2] - ab[2] * t, dist = Math.hypot(dx, dy, dz);
      if (dist >= w) continue;
      const x = dist / w, crest = (1 - x * x) ** 2 * (0.65 + 0.35 * (1 - x)), ends = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.6;
      const k = h * crest * ends, o = out.get(i) || [0, 0, 0];
      // where two ridges overlap, keep the higher rather than stacking
      const nn = [n[i * 3], n[i * 3 + 1], n[i * 3 + 2]], cur = o[0] * nn[0] + o[1] * nn[1] + o[2] * nn[2];
      if (k > cur) out.set(i, [nn[0] * k, nn[1] * k, nn[2] * k]);
    }
  }
  const idx = new Uint16Array(out.size), d = new Float32Array(out.size * 3); let j = 0;
  for (const [i, v] of out) { idx[j] = i; d.set(v, j * 3); j++; }
  return { idx, d };
}

/* ---------------- spurs and tendrils: meshes of their own ---------------- */
// a tube along points, with a radius at each, capped with a rounded tip; returns arrays for a geometry
function tube(pts, radii, sides = 14, flat = 1) {
  const P = [], Nn = [], T = [], I = [], n = pts.length;
  let prevN = null;
  const tang = (k) => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)]; return new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(); };
  const frames = [];
  for (let k = 0; k < n; k++) {
    const t = tang(k);
    let nx = prevN ? prevN.clone() : (Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
    nx.sub(t.clone().multiplyScalar(nx.dot(t))).normalize();   // parallel transport: keep the last normal, square it to the tangent
    const bx = new THREE.Vector3().crossVectors(t, nx);
    frames.push([nx, bx]); prevN = nx;
  }
  for (let k = 0; k < n; k++) {
    const [nx, bx] = frames[k], r = radii[k];
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a) * flat;
      const ox = nx.x * c + bx.x * si, oy = nx.y * c + bx.y * si, oz = nx.z * c + bx.z * si;
      P.push(pts[k][0] + ox * r, pts[k][1] + oy * r, pts[k][2] + oz * r); Nn.push(ox, oy, oz); T.push(k / (n - 1));
    }
  }
  for (let k = 0; k < n - 1; k++) for (let s = 0; s < sides; s++) { const a = k * (sides + 1) + s, b = a + sides + 1; I.push(a, a + 1, b, a + 1, b + 1, b); }   // wound so the outside faces out
  // close the root: a fan to a centre point a little inside
  const t0 = tang(0), c = P.length / 3; P.push(pts[0][0] - t0.x * radii[0] * 0.4, pts[0][1] - t0.y * radii[0] * 0.4, pts[0][2] - t0.z * radii[0] * 0.4); Nn.push(-t0.x, -t0.y, -t0.z); T.push(0);
  for (let s = 0; s < sides; s++) I.push(c, s + 1, s);
  return { P, Nn, T, I };
}
// a path that leaves the skin along the normal and bends toward `sweep`, `len` long; `wob` sways it a little
function path(p0, n, sweep, len, steps, bend, wob, seed) {
  const r = rng(seed), out = [], d = new THREE.Vector3(...n), g = new THREE.Vector3(...sweep).normalize(), side = new THREE.Vector3().crossVectors(d, g).normalize(), phase = r() * 6.28, amp = wob * (0.5 + r());
  const q = new THREE.Vector3(p0[0] - n[0] * 0.003, p0[1] - n[1] * 0.003, p0[2] - n[2] * 0.003), h = len / steps;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps; out.push([q.x, q.y, q.z]);
    const a = Math.min(1, (t / bend) ** 1.4), dir = new THREE.Vector3().copy(d).multiplyScalar(1 - a).addScaledVector(g, a).addScaledVector(side, Math.sin(phase + t * 5) * amp * t).normalize();
    q.addScaledVector(dir, h);
  }
  return out;
}

export function pureblood(fig, base) {
  const B = base, L = B.marks.L, R = B.rest, d = B.marks.d, at = (i) => [R[i * 3], R[i * 3 + 1], R[i * 3 + 2]];
  const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t), up = (a, k) => [a[0], a[1] + k, a[2]];
  // the ridges: two short crests above each brow; two along each cheekbone toward the ear
  const brow = [], cheek = [];
  for (const S of ['L', 'R']) {
    const bi = at(L['browInner' + S]), bm = at(L['brow' + S]), bo = at(L['browOuter' + S]), ck = at(L['cheek' + S]), tp = at(L['temple' + S]);
    brow.push({ A: up(lerp(bi, bm, 0.25), 0.2 * d), B: up(lerp(bi, bm, 1.0), 0.28 * d), w: 0.24 * d, h: 0.16 * d });
    brow.push({ A: up(lerp(bm, bo, 0.25), 0.28 * d), B: up(lerp(bm, bo, 1.05), 0.2 * d), w: 0.22 * d, h: 0.14 * d });
    const ear = lerp(ck, tp, 0.75);
    cheek.push({ A: lerp(ck, ear, 0.0), B: lerp(ck, ear, 0.5), w: 0.27 * d, h: 0.19 * d });
    cheek.push({ A: up(lerp(ck, ear, 0.2), -0.3 * d), B: up(lerp(ck, ear, 0.62), -0.27 * d), w: 0.23 * d, h: 0.15 * d });
  }
  fig.addTarget('pbBrowRidges', ridgeTarget(B, brow));
  fig.addTarget('pbCheekRidges', ridgeTarget(B, cheek));

  // tendril roots: points along the jaw and chin and the lower cheek, found once (vertex numbers)
  const nearest = (c) => { let best = -1, bd = Infinity; for (let i = 0; i < B.N; i++) { if (!B.inBody[i]) continue; const q = (R[i * 3] - c[0]) ** 2 + (R[i * 3 + 1] - c[1]) ** 2 + (R[i * 3 + 2] - c[2]) ** 2; if (q < bd) { bd = q; best = i; } } return best; };
  const chin = at(L.chin), roots = { chin: [], jaw: [], cheek: [] };
  for (const S of ['L', 'R']) {
    const jm = at(L['jawMid' + S]), ja = at(L['jaw' + S]), ck = at(L['cheek' + S]), mo = at(L['mouth' + S]);
    roots.chin.push(nearest(lerp(chin, jm, 0.22)));
    roots.jaw.push(nearest(lerp(chin, jm, 0.55)), nearest(lerp(jm, ja, 0.15)));
    roots.cheek.push(nearest(lerp(lerp(ck, mo, 0.55), ja, 0.25)));
  }
  const ARR = { none: [], chin: roots.chin, jaw: [...roots.chin, ...roots.jaw], cheek: [...roots.jaw, ...roots.cheek], beard: [...roots.chin, ...roots.jaw, ...roots.cheek] };

  const group = new THREE.Group(); group.name = 'pureblood'; fig.add(group);
  const spurMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.48, specularIntensity: 0.5, sheen: 0.2, sheenRoughness: 0.5 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xd8a83a, metalness: 1, roughness: 0.3 });
  const opt = { on: false, ridges: 0.85, spurs: 'cheekchin', tendrils: 'jaw', length: 'short', jewellery: 'none' };
  const vtx = (i) => { const g = fig.geometry, P = g.attributes.position.array, Nn = g.attributes.normal.array; return [[P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]]]; };

  function spurs() {
    const out = [], lm = (n) => fig.landmark(n);
    const add = (l, sweep, len, r0, seed, shift = [0, 0, 0]) => { if (l) out.push({ p: l.p.map((v, k) => v + shift[k]), n: l.n, sweep, len, r0, seed }); };
    const set = opt.spurs;
    if (set === 'cheek' || set === 'cheekchin' || set === 'brow') for (const [S, sx] of [['L', 1], ['R', -1]]) add(lm('cheek' + S), [sx * 0.75, -0.6, -0.25], 0.036, 0.0085, sx > 0 ? 3 : 4);
    if (set === 'cheekchin') { const c = lm('chin'); for (const sx of [1, -1]) add(c, [sx * 0.35, -0.9, 0.35], 0.022, 0.0065, sx > 0 ? 5 : 6, [sx * 0.012, 0.002, -0.005]); }
    if (set === 'brow') for (const [S, sx] of [['L', 1], ['R', -1]]) add(lm('browOuter' + S), [sx * 0.5, 0.35, -0.8], 0.024, 0.0055, sx > 0 ? 7 : 8);
    if (set === 'jaw') for (const [S, sx] of [['L', 1], ['R', -1]]) { add(lm('jaw' + S), [sx * 0.3, -0.8, -0.5], 0.032, 0.0066, sx > 0 ? 9 : 10); add(lm('jawMid' + S), [sx * 0.3, -0.9, 0.1], 0.02, 0.005, sx > 0 ? 11 : 12); }
    return out;
  }
  function build() {
    for (const c of [...group.children]) { group.remove(c); c.geometry.dispose(); }
    if (!opt.on) return;
    const tone = fig.skin.userData.u.uSkin.value, bone = tone.clone().lerp(new THREE.Color(0x2a1612), 0.45);
    // spurs: flattened a touch, a flared root sunk into the skin, a blunt tip; skin at the root darkening to horn
    for (const s of spurs()) {
      const r = rng(s.seed), len = s.len * (0.9 + 0.2 * r()), pts = path(s.p, s.n, s.sweep, len, 16, 0.7, 0.03, s.seed);
      const radii = pts.map((_, k) => { const t = k / (pts.length - 1), flare = 1 + 0.75 * (1 - Math.min(1, t / 0.22)) ** 2; return k === pts.length - 1 ? 0.0003 : s.r0 * flare * (1 - 0.86 * t ** 0.95); });
      const tb = tube(pts, radii, 16, 0.82), col = [];
      for (const t of tb.T) { const c = tone.clone().lerp(bone, Math.min(1, t * 1.4)); col.push(c.r, c.g, c.b); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tb.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(tb.Nn, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(tb.I);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, spurMat); m.castShadow = true; group.add(m);
    }
    // tendrils: flesh in the body's own skin material, so the root joins without a seam
    const long = opt.length === 'long';
    ARR[opt.tendrils].forEach((vi, k) => {
      const [p, n] = vtx(vi), r = rng(101 + k * 7), len = (long ? 0.105 : 0.042) * (0.8 + 0.4 * r()), r0 = (long ? 0.0078 : 0.0072) * (0.88 + 0.24 * r());
      // down, a little forward, and curling in toward the middle; the root sunk well into the skin
      const fwd = [-Math.sign(p[0]) * (0.12 + 0.1 * r()), -1, (long ? 0.42 : 0.3) + 0.15 * r()];
      const steps = long ? 28 : 18, pts = path(p.map((v, q) => v - n[q] * 0.003), n, fwd, len, steps, long ? 0.24 : 0.32, long ? 0.16 : 0.08, 200 + k);
      // the tip: rounded off over the last few rings
      const radii = pts.map((_, j) => { const t = j / steps, flare = 1 + 0.7 * (1 - Math.min(1, t / 0.16)) ** 2, taper = (1 - 0.62 * t ** 1.1) * (1 + 0.045 * Math.sin(t * len * 900)), tipK = Math.max(0, (t - (1 - 0.1)) / 0.1); return r0 * flare * taper * Math.sqrt(Math.max(0, 1 - tipK * tipK)) + (j === steps ? 0 : 0.0002); });
      const tb = tube(pts, radii, 14, 0.86), m = tb.P.length / 3, rest = new Float32Array(m * 3), lip = new Float32Array(m), cav = new Float32Array(m * 2);
      const rp = [R[vi * 3], R[vi * 3 + 1], R[vi * 3 + 2]];
      for (let j = 0; j < m; j++) { rest.set(rp, j * 3); const t = tb.T[j]; cav[j * 2] = 0.05 * (1 - Math.min(1, t / 0.08)); cav[j * 2 + 1] = 0.03 * (1 - Math.min(1, t / 0.15)); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tb.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(tb.Nn, 3));
      g.setAttribute('aRest', new THREE.BufferAttribute(rest, 3)); g.setAttribute('aLip', new THREE.BufferAttribute(lip, 1)); g.setAttribute('aCav', new THREE.BufferAttribute(cav, 2)); g.setIndex(tb.I);
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(g, fig.skin); mesh.castShadow = true; group.add(mesh);
      if (opt.jewellery !== 'none') {   // a ring a third of the way down, square to the tendril
        const j = Math.round(steps * (long ? 0.32 : 0.45)), a = pts[j], b = pts[j + 1], dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radii[j] + 0.0012, 0.0013, 8, 20), ringMat);
        ring.position.set(...a); ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); ring.castShadow = true; group.add(ring);
      }
    });
  }
  fig.addEventListener('shaped', build);
  return {
    group,
    set(o = {}) {
      Object.assign(opt, o);
      fig.state.pbBrowRidges = opt.on ? opt.ridges : 0; fig.state.pbCheekRidges = opt.on ? opt.ridges * 0.9 : 0;
      ringMat.color.set(METALS[opt.jewellery] || METALS.gold);
      return this;
    },
  };
}
