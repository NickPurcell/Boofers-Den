// Human base, species features: the Sith Pureblood. Our own, built on the base's landmarks, after what the references
// agree on (engineer7's study of 88 pictures; see its NOTES.md):
// - a human skull with bone grown into it: RAISED ridges, short and a finger wide, three up the forehead from between
//   the brows and two angling across each cheek from under the cheekbone toward the mouth, stopping short of the
//   tendrils. They are our own morph targets, made once from the unmorphed mesh and blended like any morph; the skin
//   lights their crests;
// - spurs that carry the brow shelf on back along the temple, thick at the root, the tip lifting clear; smaller ones at
//   the back of the cheekbone and the jaw angle as options;
// - tendrils of flesh from the jaw's lower edge and the chin: a swelling at the root about 15 mm across, a slow taper to
//   a rounded end half as wide, each a little different, hanging close in front of the throat;
// - jewellery in four metals: tendril cuffs and rings, spur rings, piercings, a chain, a circlet.
//
// const pb = pureblood(fig, base); fig.features = pb;
// pb.set({ on, folds, ridges: 0..1, spurs, tendrils, tlength, jewel: 'cuffs.rings...', metal }) before fig.update();
// pb.anchors() after it. The option lists are PUREBLOOD.options (keys as on the old page).
import * as THREE from 'three';

export const PUREBLOOD = {
  options: {
    folds: { label: 'Folds', def: 'both', items: { smooth: 'Smooth', brow: 'Brow folds', cheek: 'Cheek ridges', both: 'Brow and cheek', corded: 'Corded' } },
    ridges: { label: 'Fold height', min: 0, max: 1, def: 0.8 },
    spurs: { label: 'Bone spurs', def: 'brow', items: { none: 'None', brow: 'Brow', brow_cheek: 'Brow and cheek', full: 'Brow, cheek and jaw' } },
    tendrils: { label: 'Tendrils', def: 'fringe', items: { none: 'None', chin: 'Chin pair', fringe: 'Chin and jaw', cheek: 'Cheek and chin', beard: 'Full beard' } },
    tlength: { label: 'Tendril length', def: 'short', items: { short: 'Short', long: 'Long' } },
    jewel: { label: 'Jewellery', multi: true, def: 'cuffs.brow', items: { rings: 'Tendril rings', cuffs: 'Tendril cuffs', chains: 'Chains', studs: 'Piercings', brow: 'Spur rings', circlet: 'Circlet' } },
    metal: { label: 'Metal', def: 'gold', items: { gold: 'Gold', silver: 'Silver', bronze: 'Bronze', iron: 'Dark iron' } },
  },
};
const METALS = { gold: [0xd8a83a, 0.28], silver: [0xd6d8dc, 0.25], bronze: [0xa8683a, 0.35], iron: [0x34363b, 0.45] };
const rng = (seed) => { let a = (seed * 2654435761) >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/* ---------------- bone ridges: our own morph targets ---------------- */
// Each ridge is a polyline snapped to the surface (base frame, decimetres). Vertices within w of it rise along their
// normal in a rounded crest of height h, tapering at both ends. Returns the target, and a 0..1 crest value per vertex.
function ridges(B, lines) {
  const { rest: p, restN: n, N, inBody } = B, lift = new Float32Array(N), beside = new Float32Array(N);
  for (const { pts, w, h } of lines) {
    let total = 0; const seg = []; for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); seg.push([a, b, L, total]); total += L; }
    for (let i = 0; i < N; i++) {
      if (!inBody[i]) continue;
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]; let best = Infinity, along = 0;
      for (const [a, b, L, s0] of seg) {
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], t = Math.max(0, Math.min(1, ((x - a[0]) * ab[0] + (y - a[1]) * ab[1] + (z - a[2]) * ab[2]) / (L * L || 1)));
        const dd = Math.hypot(x - a[0] - ab[0] * t, y - a[1] - ab[1] * t, z - a[2] - ab[2] * t); if (dd < best) { best = dd; along = (s0 + t * L) / total; }
      }
      if (best >= w) { if (best < w * 1.7) beside[i] = Math.max(beside[i], Math.sin(Math.PI * ((best - w) / (0.7 * w))) * Math.sin(Math.PI * along) ** 0.5); continue; }
      const q = best / w, crest = (1 - q * q) ** 2 * (0.6 + 0.4 * (1 - q)), ends = Math.sin(Math.PI * along) ** 0.5;
      lift[i] = Math.max(lift[i], h * crest * ends);
    }
  }
  const idx = [], d = [], mark = new Float32Array(N * 2); let top = 0;
  for (let i = 0; i < N; i++) mark[i * 2 + 1] = beside[i];
  for (let i = 0; i < N; i++) if (lift[i] > 0) { idx.push(i); d.push(n[i * 3] * lift[i], n[i * 3 + 1] * lift[i], n[i * 3 + 2] * lift[i]); top = Math.max(top, lift[i]); }
  for (let i = 0; i < N; i++) mark[i * 2] = lift[i] / (top || 1);
  return { target: { idx: Uint16Array.from(idx), d: Float32Array.from(d) }, mark };
}

/* ---------------- tubes: spurs, tendrils ---------------- */
// a tube along points with a radius at each, the root closed; wound so its outside faces out
function tube(pts, radii, sides = 14, flat = 1) {
  const P = [], Nn = [], T = [], I = [], n = pts.length, tang = (k) => { const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n - 1, k + 1)]; return new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(); };
  let prev = null; const frames = [];
  for (let k = 0; k < n; k++) {
    const t = tang(k), nx = prev ? prev.clone() : (Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
    nx.sub(t.clone().multiplyScalar(nx.dot(t))).normalize(); frames.push([nx, new THREE.Vector3().crossVectors(t, nx)]); prev = nx;
  }
  for (let k = 0; k < n; k++) {
    const [nx, bx] = frames[k], r = radii[k];
    for (let s = 0; s <= sides; s++) { const a = (s / sides) * Math.PI * 2, c = Math.cos(a), si = Math.sin(a) * flat, o = [nx.x * c + bx.x * si, nx.y * c + bx.y * si, nx.z * c + bx.z * si]; P.push(pts[k][0] + o[0] * r, pts[k][1] + o[1] * r, pts[k][2] + o[2] * r); Nn.push(...o); T.push(k / (n - 1)); }
  }
  for (let k = 0; k < n - 1; k++) for (let s = 0; s < sides; s++) { const a = k * (sides + 1) + s, b = a + sides + 1; I.push(a, a + 1, b, a + 1, b + 1, b); }
  const t0 = tang(0), c = P.length / 3; P.push(pts[0][0] - t0.x * radii[0] * 0.4, pts[0][1] - t0.y * radii[0] * 0.4, pts[0][2] - t0.z * radii[0] * 0.4); Nn.push(-t0.x, -t0.y, -t0.z); T.push(0);
  for (let s = 0; s < sides; s++) I.push(c, s + 1, s);
  return { P, Nn, T, I };
}
// a path from p (sunk `sink` into the skin) leaving along n and bending toward `sweep` over the first `bend` of its length
function path(p, n, sweep, len, steps, bend, wob, seed, sink = 0.003, dir0 = null) {
  const r = rng(seed), out = [], d = new THREE.Vector3(...(dir0 || n)), g = new THREE.Vector3(...sweep).normalize(), side = new THREE.Vector3().crossVectors(d, g).normalize(), phase = r() * 6.28, amp = wob * (0.5 + r());
  const q = new THREE.Vector3(p[0] - n[0] * sink, p[1] - n[1] * sink, p[2] - n[2] * sink), h = len / steps;
  for (let k = 0; k <= steps; k++) {
    const t = k / steps; out.push([q.x, q.y, q.z]);
    const a = Math.min(1, (t / bend) ** 1.3), dir = d.clone().multiplyScalar(1 - a).addScaledVector(g, a).addScaledVector(side, Math.sin(phase + t * 5) * amp * t).normalize();
    q.addScaledVector(dir, h);
  }
  return out;
}
const geom = (tb, extra = {}) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(tb.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(tb.Nn, 3)); for (const [k, [a, n]] of Object.entries(extra)) g.setAttribute(k, new THREE.BufferAttribute(a, n)); g.setIndex(tb.I); g.computeVertexNormals(); return g; };

export function pureblood(fig, base) {
  const B = base, L = B.marks.L, R = B.rest, { d, ey, ez } = B.marks, side = B.marks.side, at = (i) => [R[i * 3], R[i * 3 + 1], R[i * 3 + 2]];
  const lerp = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t);
  // the nearest body vertex to a point in the base frame; a point on the front of the face at (x, y)
  const nearest = (c) => { let best = -1, bd = Infinity; for (let i = 0; i < B.N; i++) { if (!B.inBody[i]) continue; const q = (R[i * 3] - c[0]) ** 2 + (R[i * 3 + 1] - c[1]) ** 2 + (R[i * 3 + 2] - c[2]) ** 2; if (q < bd) { bd = q; best = i; } } return best; };
  const onFace = (x, y) => { let best = -1, bz = -Infinity; for (let i = 0; i < B.N; i++) { if (!B.inBody[i] || Math.abs(R[i * 3] - x) > 0.05 * d || Math.abs(R[i * 3 + 1] - y) > 0.05 * d) continue; if (R[i * 3 + 2] > bz) { bz = R[i * 3 + 2]; best = i; } } return best < 0 ? at(nearest([x, y, ez + d])) : at(best); };
  const line = (x0, y0, x1, y1, k = 6) => Array.from({ length: k + 1 }, (_, j) => onFace(x0 + (x1 - x0) * (j / k), y0 + (y1 - y0) * (j / k)));
  const ax = d / 2;

  // folds: three up the forehead from between the brows; two across each cheek from under the cheekbone toward the
  // mouth; "corded" adds two more on the forehead, a third on each cheek and one along each side of the chin
  const brow = [{ pts: line(0, ey + 0.42 * d, 0, ey + 1.5 * d), w: 0.17 * d, h: 0.15 * d }], cheek = [], cord = [];
  for (const s of [1, -1]) {
    brow.push({ pts: line(s * 0.3 * d, ey + 0.4 * d, s * 0.62 * d, ey + 1.4 * d), w: 0.16 * d, h: 0.135 * d });
    cheek.push({ pts: line(s * 1.62 * ax, ey - 0.62 * d, s * 1.0 * ax, ey - 1.18 * d), w: 0.2 * d, h: 0.2 * d });
    cheek.push({ pts: line(s * 1.82 * ax, ey - 0.86 * d, s * 1.28 * ax, ey - 1.38 * d), w: 0.18 * d, h: 0.17 * d });
    cord.push({ pts: line(s * 0.62 * d, ey + 0.38 * d, s * 1.0 * d, ey + 1.15 * d), w: 0.13 * d, h: 0.1 * d });
    cord.push({ pts: line(s * 1.95 * ax, ey - 1.12 * d, s * 1.5 * ax, ey - 1.55 * d), w: 0.14 * d, h: 0.12 * d });
    cord.push({ pts: line(s * 0.42 * d, ey - 1.55 * d, s * 0.3 * d, ey - 1.95 * d, 4), w: 0.11 * d, h: 0.09 * d });
  }
  const G = { brow: ridges(B, brow), cheek: ridges(B, cheek), cord: ridges(B, cord) };
  for (const [k, g] of Object.entries(G)) fig.addTarget('pbFold_' + k, g.target);
  const markOf = (keys) => { const m = new Float32Array(B.N * 2); for (const k of keys) { const a = G[k].mark; for (let i = 0; i < m.length; i++) m[i] = Math.max(m[i], a[i]); } return m; };
  const FOLDS = { smooth: [], brow: ['brow'], cheek: ['cheek'], both: ['brow', 'cheek'], corded: ['brow', 'cheek', 'cord'] };

  // tendril roots on the jaw's lower edge and the chin (vertex numbers, found once)
  const under = (c, k = 0.14) => nearest([c[0], c[1] - k * d, c[2] - 0.08 * d]);
  const chin = at(L.chin), R0 = { chin: [], jaw: [], jaw2: [], cheek: [], mid: [under(chin, 0.2)] };
  for (const S of ['L', 'R']) {
    const jm = at(L['jawMid' + S]), ja = at(L['jaw' + S]), mo = at(L['mouth' + S]);
    R0.chin.push(under(lerp(chin, jm, 0.16)));
    R0.jaw.push(under(lerp(chin, jm, 0.7), 0.05), under(lerp(jm, ja, 0.4), 0.03));
    R0.jaw2.push(under(lerp(jm, ja, 0.7), 0.03));
    R0.cheek.push(nearest(lerp(lerp(mo, jm, 0.55), ja, 0.2)));
  }
  const SETS = { none: [], chin: R0.chin, fringe: [...R0.chin, ...R0.jaw], cheek: [...R0.cheek, ...R0.chin], beard: [...R0.mid, ...R0.chin, ...R0.jaw, ...R0.jaw2, ...R0.cheek] };

  const group = new THREE.Group(); group.name = 'pureblood'; fig.add(group);
  const spurMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, specularIntensity: 0.45, sheen: 0.2, sheenRoughness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xd8a83a, metalness: 1, roughness: 0.3 });
  const opt = { on: false, folds: 'both', ridges: 0.8, spurs: 'brow', tendrils: 'fringe', tlength: 'short', jewel: 'cuffs.brow', metal: 'gold' };
  const vtx = (i) => { const g = fig.geometry, P = g.attributes.position.array, Nn = g.attributes.normal.array; return [[P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], [Nn[i * 3], Nn[i * 3 + 1], Nn[i * 3 + 2]]]; };
  const spurRoot = {};
  for (const S of ['L', 'R']) { spurRoot['brow' + S] = L['browOuter' + S]; spurRoot['cheek' + S] = nearest(lerp(at(L['cheek' + S]), at(L['earFront' + S]), 0.62)); spurRoot['jaw' + S] = L['jaw' + S]; }
  let built = { tendrils: [], spurs: {} };

  function build() {
    for (const c of [...group.children]) { group.remove(c); c.geometry.dispose(); }
    built = { tendrils: [], spurs: {} };
    if (!opt.on) return;
    const tone = fig.skin.userData.u.uSkin.value, horn = tone.clone().lerp(new THREE.Color(0x1c0c0a), 0.5);
    const want = { brow: ['brow'], brow_cheek: ['brow', 'cheek'], full: ['brow', 'cheek', 'jaw'] }[opt.spurs] || [];
    // spurs: along the surface toward the back, so they carry the line they grow from; flattened, a flared root
    for (const kind of want) for (const [S, sx] of [['L', side], ['R', -side]]) {
      const [p, n] = vtx(spurRoot[kind + S]), cfg = { brow: [[sx * 0.55, 0.3, -1], 0.042, 0.0095, 0.6], cheek: [[sx * 0.35, -0.05, -1], 0.024, 0.0068, 0.6], jaw: [[sx * 0.35, -0.6, -0.75], 0.026, 0.007, 0.6] }[kind];
      const [sweep, len0, r0, bend] = cfg, r = rng(kind.length * 13 + (sx > 0 ? 1 : 2)), len = len0 * (0.94 + 0.12 * r());
      // leave the skin already heading where the spur goes: the sweep laid along the surface, lifted a little off it
      const N3 = new THREE.Vector3(...n), sw = new THREE.Vector3(...sweep).normalize(), along = sw.clone().addScaledVector(N3, -sw.dot(N3)).normalize(), d0 = along.clone().addScaledVector(N3, 0.32).normalize();
      const pts = path(p, n, sweep, len, 16, bend, 0.02, 31 + kind.length, 0.004, d0.toArray());
      const radii = pts.map((_, k) => { const t = k / (pts.length - 1), flare = 1 + 0.8 * (1 - Math.min(1, t / 0.25)) ** 2; return k === pts.length - 1 ? 0.0004 : r0 * flare * (1 - 0.86 * t ** 0.9); });
      const tb = tube(pts, radii, 16, 0.72), col = new Float32Array(tb.T.length * 3);
      tb.T.forEach((t, j) => { const c = tone.clone().lerp(horn, Math.min(1, t * 1.3)); col.set([c.r, c.g, c.b], j * 3); });
      const m = new THREE.Mesh(geom(tb, { color: [col, 3] }), spurMat); m.castShadow = true; group.add(m);
      built.spurs[kind + S] = { pts, r: radii };
    }
    // tendrils: flesh in the body's own skin material, so the root joins without a seam
    const long = opt.tlength === 'long';
    SETS[opt.tendrils].forEach((vi) => {
      // the front ones longest and thickest, shorter and thinner back along the jaw, each a little different
      const front = R0.chin.includes(vi) || R0.mid.includes(vi), back = R0.jaw2.includes(vi) || R0.cheek.includes(vi);
      const [p, n] = vtx(vi), r = rng(101 + vi), len = (long ? 0.13 : 0.07) * (front ? 1.2 : back ? 0.62 : 0.85) * (0.8 + 0.4 * r()), r0 = (front ? 0.0088 : back ? 0.0072 : 0.008) * (0.92 + 0.16 * r());
      const sx = Math.sign(p[0]) || 1, sweep = [sx * (front ? -0.04 : 0.05) + sx * 0.06 * (r() - 0.5), -1, (long ? 0.16 : 0.08) + 0.06 * r()];
      const steps = long ? 34 : 24, pts = path(p, n, sweep, len, steps, long ? 0.2 : 0.26, long ? 0.12 : 0.07, 200 + vi, 0.007);
      // a swelling at the root, then a slow taper to a rounded end about half the root's width
      const tipL = Math.min(0.2, (r0 * 0.55) / len), radii = pts.map((_, j) => { const t = j / steps, swell = 1 + 0.75 * Math.exp(-(t * t) / 0.006) + 0.18 * Math.exp(-((t - 0.12) ** 2) / 0.004), taper = 1 - 0.45 * t ** 1.15, tip = Math.max(0, (t - (1 - tipL)) / tipL); return r0 * swell * taper * Math.sqrt(Math.max(0, 1 - tip * tip)) + (j === steps ? 0 : 0.0002); });
      const tb = tube(pts, radii, 14, 0.9), m = tb.P.length / 3, rest = new Float32Array(m * 3), lip = new Float32Array(m), cav = new Float32Array(m * 2), mark = new Float32Array(m * 2);
      const rp = [R[vi * 3], R[vi * 3 + 1], R[vi * 3 + 2]];
      for (let j = 0; j < m; j++) { rest.set(rp, j * 3); const t = tb.T[j]; cav[j * 2] = 0.05 * (1 - Math.min(1, t / 0.08)); cav[j * 2 + 1] = 0.03 * (1 - Math.min(1, t / 0.15)); }
      const mesh = new THREE.Mesh(geom(tb, { aRest: [rest, 3], aLip: [lip, 1], aCav: [cav, 2], aMark: [mark, 2], aArm: [new Float32Array(m * 2), 2] }), fig.skin); mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh);
      built.tendrils.push({ pts, r: radii, root: vi });
    });
    // jewellery, in one metal: cuffs on the front tendrils, rings on all of them, rings through the brow spurs, studs
    // at the chin and lower lip with a ring in the nose, a chain slung between the front tendrils, a circlet
    const J = new Set(String(opt.jewel || '').split('.').filter(Boolean)), [hex, rough] = METALS[opt.metal] || METALS.gold;
    metal.color.set(hex); metal.roughness = rough;
    const put = (geo, p, dir) => { const m = new THREE.Mesh(geo, metal); m.position.set(...p); if (dir) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); group.add(m); return m; };
    const along = (pts, f) => { const j = Math.min(pts.length - 2, Math.round((pts.length - 1) * f)), a = pts[j], b = pts[j + 1]; return [j, a, new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()]; };
    const fronts = built.tendrils.filter((q) => R0.chin.includes(q.root)), cuffAt = [];
    if (J.has('cuffs')) for (const t of fronts) {
      const [j, a, dir] = along(t.pts, 0.38), r = t.r[j] + 0.0016;
      put(new THREE.CylinderGeometry(r, r, 0.011, 20, 1, true).rotateX(Math.PI / 2), a, dir);
      for (const dz of [-0.0055, 0.0055]) put(new THREE.TorusGeometry(r + 0.0002, 0.0009, 6, 20), a.map((v, q) => v + dir.getComponent(q) * dz), dir);
      cuffAt.push(a);
    }
    if (J.has('rings')) for (const t of built.tendrils) { const [j, a, dir] = along(t.pts, J.has('cuffs') && fronts.includes(t) ? 0.7 : 0.55); put(new THREE.TorusGeometry(t.r[j] + 0.0013, 0.0011, 8, 20), a, dir); if (!cuffAt.length && fronts.includes(t)) cuffAt.push(a); }
    if (J.has('brow')) for (const S of ['L', 'R']) { const s = built.spurs['brow' + S]; if (!s) continue; const [j, a, dir] = along(s.pts, 0.62); put(new THREE.TorusGeometry(s.r[j] * 1.1 + 0.002, 0.0011, 8, 22), a, dir); }
    if (J.has('studs')) {
      const at3 = (i, lift = 0.0015) => { const [p, n] = vtx(i); return [p.map((v, k) => v + n[k] * lift), new THREE.Vector3(...n)]; };
      for (const i of [nearest(lerp(at(L.chin), at(L.noseTip), 0.08)), nearest(lerp(at(L.chin), at(L.noseTip), 0.4))]) { const [p, n] = at3(i); put(new THREE.SphereGeometry(0.0024, 12, 8), p, n); }
      const [np, nn] = at3(nearest([at(L.noseTip)[0] + 0.12 * d * side, at(L.noseTip)[1] - 0.12 * d, at(L.noseTip)[2] - 0.08 * d]), 0.003);
      put(new THREE.TorusGeometry(0.0045, 0.0007, 6, 18), np, new THREE.Vector3(side, 0, 0));
    }
    if (J.has('chains') && cuffAt.length === 2) {   // beads on a slack line between the two front tendrils
      const [a, b] = cuffAt, n = 22;
      for (let k = 0; k <= n; k++) { const t = k / n, sag = 0.022 * Math.sin(Math.PI * t); put(new THREE.SphereGeometry(0.0011, 6, 4), [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag, a[2] + (b[2] - a[2]) * t + sag * 0.35], null); }
    }
    if (J.has('circlet')) {   // a thin band round the forehead and over the ears, a small plate at the front
      const ring = []; for (let k = 0; k <= 36; k++) { const a = (k / 36) * Math.PI * 2, i = nearest([Math.sin(a) * 3 * ax, ey + (0.8 - 0.3 * (1 - Math.cos(a)) * 0.5) * d, ez - 1.3 * d + Math.cos(a) * 2.2 * d]); const [p, n2] = vtx(i); ring.push(new THREE.Vector3(p[0] + n2[0] * 0.0035, p[1] + n2[1] * 0.0035, p[2] + n2[2] * 0.0035)); }
      ring.pop();   // the loop closes on itself
      for (let it = 0; it < 4; it++) { const c = ring.map((v) => v.clone()); for (let k = 0; k < ring.length; k++) ring[k].copy(c[(k + ring.length - 1) % ring.length]).add(c[(k + 1) % ring.length]).multiplyScalar(0.25).addScaledVector(c[k], 0.5); }   // smooth out the vertex-by-vertex wobble
      const curve = new THREE.CatmullRomCurve3(ring, true); group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.0016, 8, true), metal));
      const f = ring[0], [, n0] = vtx(nearest([0, ey + 0.8 * d, ez + d])); put(new THREE.CylinderGeometry(0.006, 0.006, 0.0025, 6).rotateX(Math.PI / 2), [f.x, f.y, f.z], new THREE.Vector3(...n0));
    }
  }
  fig.addEventListener('shaped', build);
  const api = {
    group, options: PUREBLOOD.options,
    set(o = {}) {
      Object.assign(opt, o);
      const on = FOLDS[opt.folds] || [];
      for (const k of Object.keys(G)) fig.state['pbFold_' + k] = opt.on && on.includes(k) ? opt.ridges : 0;
      fig.setMark(markOf(opt.on ? on : []));
      fig.skin.userData.set({ bone: opt.on ? opt.ridges : 0 });
      return api;
    },
    // where jewellery and other things can sit, after the morphs (metres)
    anchors() {
      const pn = (i) => { const [p, n] = vtx(i); return { p, n }; };
      const circlet = []; for (let k = -6; k <= 6; k++) circlet.push(vtx(nearest([Math.sin(k * 0.22) * 2.3 * ax, ey + 0.95 * d, ez + d * (Math.cos(k * 0.22) - 1.25)]))[0]);
      return { tendrils: built.tendrils.map((t) => ({ pts: t.pts, r: t.r })), spurs: built.spurs, chin: pn(L.chin), nose: pn(L.noseTip), lip: pn(nearest(lerp(at(L.chin), at(L.noseTip), 0.42))), brow: { L: pn(spurRoot.browL), R: pn(spurRoot.browR) }, circlet };
    },
  };
  return api;
}
