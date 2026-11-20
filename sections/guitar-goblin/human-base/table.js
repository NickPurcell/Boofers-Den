// Human base: a figure baked for the table (HoloTable's 3D map), as plain arrays a page can post, store and draw with
// its own three.js. No subdivision, no textures: the skin's colour goes into the vertices, worked out on the CPU the
// way skin.js's shader works out its colour (tone, lips, the face's painted light and shade, painted marks, a bone
// crest, brows, creases and hollows, the undersuit), without the pores, the lighting and the sheen, which a figure a
// few centimetres tall on a screen cannot show anyway.
//
//   const meshes = bakeTable(fig);            // the body, the eyes, and the groups named 'pureblood' and 'carry'
//   bakeMeshes(object, fig, meshes);          // anything else (clothes, hair), merged in the same way
//
// Each entry: { name, position: Float32Array, normal: Float32Array, color: Uint8Array (sRGB, rgb per vertex),
// index: Uint32Array, rough, metal, emissive?: Uint8Array (sRGB, rgb per vertex, only where something glows) }.
// The figure stands at the origin, feet at y = 0, facing +z, in metres (the figure's own frame, wherever the page has
// put it). Meshes that share a finish are merged, so a figure is a handful of draws. Nothing here reads a visible
// canvas or its size: it runs as well in a hidden frame.
import * as THREE from 'three';
import { quadNormals } from './derive.js';
import { EYE_COLOURS } from './eyes.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
// linear (three's working colour space) to an sRGB byte, and back
const toByte = (v) => { v = clamp01(v); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)); };
const LIN = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

/* ---------------- the skin's colour at one vertex ---------------- */
// From the skin material's own uniforms, so every look a page sets (skinMaterial's userData.set) bakes as it shows.
// paint(out, k, rest, n, lip, cav, mark, arm): rest is the vertex's place in the base mesh's frame (decimetres), n its
// normal now; writes linear rgb to out[k..k+2].
function skinPainter(mat) {
  const u = mat.userData.u, v3 = (c) => [c.x, c.y, c.z], cl = (c) => [c.r, c.g, c.b];
  const S = cl(u.uSkin.value), LP = cl(u.uLip.value), BR = cl(u.uBrow.value), SU = cl(u.uSuit.value);
  const crease = v3(u.uCrease.value), hiT = v3(u.uHiTint.value), shD = v3(u.uShadeDark.value);
  const E = u.uEyeC.value, D = u.uD.value, FZ = u.uFaceZ.value, paintK = u.uPaint.value, sock = u.uSocket.value, bone = u.uBone.value;
  const BX = u.uBrowX.value, BY = u.uBrowY.value, BT = u.uBrowT.value, bAmt = u.uBrowAmt.value, cavK = u.uCav.value;
  const J = u.uJoints.value, sTop = u.uSuitTop.value, sArms = u.uSuitArms.value, sLegs = u.uSuitLegs.value, sOn = u.uSuitOn.value;
  const MB = u.uMarkBox.value, MZ = u.uMarkZ.value;
  // the painted marks, read once and averaged over a few millimetres round each vertex (a liner line is thinner than
  // the space between two vertices: a point sample would miss it)
  const mk = mat.userData.marks; let img = null, W = 0, H = 0;
  if (mk && mk.canvas) {
    W = mk.canvas.width; H = mk.canvas.height; const d = mk.g.getImageData(0, 0, W, H).data;
    for (let i = 3; i < d.length; i += 16) if (d[i]) { img = d; break; }
  }
  const R = Math.max(1, Math.round((0.02 / MB.z) * W)), STEP = Math.max(1, Math.round(R / 2)), mc = [0, 0, 0, 0];
  const markAt = (x, y) => {
    const px = Math.round(x * W), py = Math.round((1 - y) * H); let a = 0, r = 0, g = 0, b = 0, n = 0;
    for (let yy = py - R; yy <= py + R; yy += STEP) for (let xx = px - R; xx <= px + R; xx += STEP) {
      n++; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const o = (yy * W + xx) * 4, al = img[o + 3] / 255; if (!al) continue;
      a += al; r += LIN[img[o]] * al; g += LIN[img[o + 1]] * al; b += LIN[img[o + 2]] * al;
    }
    mc[3] = a / n; if (a > 0) { mc[0] = r / a; mc[1] = g / a; mc[2] = b / a; }
    return mc;
  };
  return (out, k, rx, ry, rz, nz, lip, cx0, cy0, mx, my, ax0, ay0) => {
    let r = S[0], g = S[1], b = S[2];
    const lipK = smooth(0.15, 0.7, lip); let keep = lipK;
    r = mix(r, LP[0], lipK * 0.75); g = mix(g, LP[1], lipK * 0.75); b = mix(b, LP[2], lipK * 0.75);
    // the face's painted light and shade (skin.js has the reasons)
    { const fx = (Math.abs(rx) - E.x) / D, fy = (ry - E.y) / D, cx = Math.abs(rx) / D, front = smooth(FZ, FZ + 0.6 * D, rz) * (ry >= E.y - 2.6 * D ? 1 : 0);
      if (front > 0) {
        const socket = Math.exp(-(fx * fx * 1.7 + (fy - 0.06) * (fy - 0.06) * 3.2) / 0.32);
        const hollow = Math.exp(-((cx - 1.25) ** 2 / 0.1 + (fy + 0.9) ** 2 / 0.09));
        const beside = Math.exp(-((cx - 0.42) ** 2 / 0.03 + (fy + 0.75) ** 2 / 0.12)), underLip = Math.exp(-(cx * cx / 0.25 + (fy + 1.45) ** 2 / 0.02));
        const light = 0.07 * smooth(0.45, 0.9, fy) * (1 - smooth(0.6, 1.1, cx)) * (1 - smooth(1.8, 2.4, fy)) + 0.09 * Math.exp(-(cx * cx / 0.03 + (fy + 0.35) ** 2 / 0.25)) + 0.06 * Math.exp(-((cx - 1.15) ** 2 / 0.06 + (fy + 0.45) ** 2 / 0.03));
        const dark = sock * socket + 0.16 * hollow + 0.1 * beside + 0.12 * underLip, pf = paintK * front;
        r *= 1 + pf * (light * hiT[0] * (1 - lipK) - dark * shD[0]); g *= 1 + pf * (light * hiT[1] * (1 - lipK) - dark * shD[1]); b *= 1 + pf * (light * hiT[2] * (1 - lipK) - dark * shD[2]);
        const warm = clamp01(Math.exp(-((cx - 0.95) ** 2 / 0.12 + (fy + 0.75) ** 2 / 0.12)) + Math.exp(-(cx * cx / 0.04 + (fy + 0.75) ** 2 / 0.06))), wk = pf * 0.6 * warm;
        r = mix(r, r * 1.06, wk); g = mix(g, g * 0.93, wk); b = mix(b, b * 0.92, wk);
      } }
    // painted marks, from the front, faded where the surface turns away
    if (img) { const mu = (rx - MB.x) / MB.z, mv = (ry - MB.y) / MB.w;
      if (mu > 0 && mu < 1 && mv > 0 && mv < 1 && rz > MZ) { const m = markAt(mu, mv), ma = m[3] * smooth(-0.05, 0.3, nz); if (ma > 0) { r = mix(r, m[0], ma); g = mix(g, m[1], ma); b = mix(b, m[2], ma); keep = Math.max(keep, ma); } } }
    // a bone crest, lit along its top
    if (bone) { const f = (1 + bone * 0.32 * smooth(0.25, 0.95, mx)) * (1 - bone * 0.3 * my); r *= f; g *= f; b *= f; }
    // the brows: the shader's band, with its hairs averaged
    { const ax = Math.abs(rx), t = (ax - BX.x) / (BX.y - BX.x);
      if (t > -0.06 && t < 1.04 && rz >= FZ) {
        const yc = mix(mix(BY.x, BY.y, clamp01(t * 1.6)), BY.z, smooth(0.62, 1, t)), th = mix(BT.x, BT.y, clamp01(t));
        const band = (1 - smooth(th * 0.55, th, Math.abs(ry - yc))) * smooth(-0.06, 0.04, t) * (1 - smooth(0.94, 1.04, t));
        const k2 = band * smooth(0.25, 0.65, 0.5 + 0.25 * (1 - t)) * bAmt; r = mix(r, BR[0], k2); g = mix(g, BR[1], k2); b = mix(b, BR[2], k2);
      } }
    // creases and hollows darken, proud forms lift
    const cf = cx0 * 9, cb = cy0 * 16, ao = 1 - cavK * (0.14 * smooth(0.2, 1.6, cb) + 0.28 * smooth(0.1, 1, cf));
    r *= 1 - (1 - ao) * shD[0]; g *= 1 - (1 - ao) * shD[1]; b *= 1 - (1 - ao) * shD[2];
    const ck = cavK * 0.35 * smooth(0.2, 1.2, cf + cb); r = mix(r, r * crease[0], ck); g = mix(g, g * crease[1], ck); b = mix(b, b * crease[2], ck);
    const lift = (1 - keep) * cavK * (0.06 * smooth(0, 0.8, -cb) + 0.08 * smooth(0.05, 0.6, -cf)); r *= 1 + hiT[0] * lift; g *= 1 + hiT[1] * lift; b *= 1 + hiT[2] * lift;
    // the undersuit
    if (sOn > 0) {
      const arx = Math.abs(rx), shortsTop = 1.05 - 0.12 * smooth(0, 1.2, arx), waist = mix(shortsTop, J.w, sTop), hem = mix(-2.35 + 0.18 * smooth(0.4, 1.6, arx), J.z, sLegs), armK = smooth(0.25, 0.6, ax0);
      const shorts = smooth(hem - 0.02, hem + 0.02, ry) * (1 - smooth(shortsTop - 0.02, shortsTop + 0.02, ry)) * (1 - armK);
      const top = sTop * (ry >= shortsTop - 0.03 ? 1 : 0) * (1 - smooth(waist - 0.02, waist + 0.02, ry)) * mix(1, 1 - smooth(1.66, 1.72, arx), smooth(shortsTop + 0.6, shortsTop + 0.9, ry)) * (1 - smooth(0.55, 0.7, ax0));
      const sleeveEnd = mix(J.x + 0.2, J.y - 0.25, sArms >= 0.75 ? 1 : 0), sleeve = (sArms >= 0.01 ? 1 : 0) * armK * (sArms >= 0.75 ? 1 - smooth(0.35, 0.65, ay0) : 1 - smooth(sleeveEnd - 0.02, sleeveEnd + 0.02, arx));
      const suit = sOn * Math.max(shorts, top, sleeve);
      if (suit > 0) { const rib = (smooth(waist - 0.16, waist - 0.12, ry) + (1 - smooth(hem + 0.1, hem + 0.14, ry))) * (1 - armK), f = (1 - 0.18 * rib) * mix(1, ao, 0.6); r = mix(r, SU[0] * f, suit); g = mix(g, SU[1] * f, suit); b = mix(b, SU[2] * f, suit); }
    }
    out[k] = r; out[k + 1] = g; out[k + 2] = b;
  };
}

/* ---------------- collecting triangles by finish ---------------- */
// one bucket per finish (roughness to 0.1, metalness to 0.25), so a figure is a few draws however many parts it has
function buckets() { return new Map(); }
function bucket(B, rough, metal, name) {
  rough = Math.round(rough * 10) / 10; metal = Math.round(metal * 4) / 4;
  const key = `${name || 'part'} ${rough} ${metal}`;
  let b = B.get(key); if (!b) B.set(key, (b = { name: name || 'part', rough, metal, P: [], N: [], C: [], E: null, I: [] }));
  return b;
}
function finish(B) {
  const out = [];
  for (const b of B.values()) {
    if (!b.I.length) continue;
    const e = { name: b.name, position: Float32Array.from(b.P), normal: Float32Array.from(b.N), color: Uint8Array.from(b.C, toByte), index: Uint32Array.from(b.I), rough: b.rough, metal: b.metal };
    if (b.E) e.emissive = Uint8Array.from(b.E, toByte);
    out.push(e);
  }
  return out;
}
// the meshes already baked, back into buckets, so more can be merged into them
function reopen(list) {
  const B = buckets(), push = (to, from, f = (x) => x) => { for (let i = 0; i < from.length; i++) to.push(f(from[i])); };
  for (const e of list || []) {
    const b = bucket(B, e.rough, e.metal, e.name), base = b.P.length / 3, lin = (x) => LIN[x];
    if (e.emissive && !b.E) b.E = new Array(b.C.length).fill(0);
    push(b.P, e.position); push(b.N, e.normal); push(b.C, e.color, lin); push(b.I, e.index, (i) => i + base);
    if (b.E) { if (e.emissive) push(b.E, e.emissive, lin); else for (let i = 0; i < e.color.length; i++) b.E.push(0); }
  }
  return B;
}
// one skin painter per material in a bake (each reads the marks canvas once)
const painterOf = (ctx, mat) => { let p = ctx.get(mat); if (!p) ctx.set(mat, (p = skinPainter(mat))); return p; };

/* ---------------- the body, from the base mesh itself ---------------- */
function bakeBody(fig, B, ctx) {
  const base = fig.B, N = base.N, p = fig.p0, q = base.quads, nrm = quadNormals(p, q, N, new Float32Array(N * 3));
  const paint = painterOf(ctx, fig.skin), b = bucket(B, 0.6, 0, 'skin'), at = new Int32Array(N).fill(-1), col = [0, 0, 0];
  const R = base.rest, lip = base.lip, cav = fig.cav0, mark = fig.mark0, armW = base.armW, hand = base.derived.hand;
  for (let f = 0; f < q.length; f++) {
    const i = q[f]; if (at[i] >= 0) continue;
    at[i] = b.P.length / 3;
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2], l = Math.hypot(nx, ny, nz) || 1;
    b.P.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); b.N.push(nx / l, ny / l, nz / l);
    paint(col, 0, R[i * 3], R[i * 3 + 1], R[i * 3 + 2], nz / l, lip[i], cav[i * 2], cav[i * 2 + 1], mark ? mark[i * 2] : 0, mark ? mark[i * 2 + 1] : 0, armW[i] / 255, hand[i]);
    b.C.push(col[0], col[1], col[2]);
  }
  for (let f = 0; f < q.length; f += 4) { const a = at[q[f]], c = at[q[f + 1]], d = at[q[f + 2]], e = at[q[f + 3]]; b.I.push(a, c, d, a, d, e); }
}

/* ---------------- the eyes: small balls, the iris in their vertices ---------------- */
// rings of latitude close together over the iris so its colour holds at this size; the pole faces +z as the page's eye
function bakeEyes(fig, B) {
  const look = fig.eyes.look || {}, hex = EYE_COLOURS[look.colour] || look.colour || '#5a3418';
  const iris = new THREE.Color(hex), white = new THREE.Color(look.white || '#e6dfd6'), glow = +look.glow || 0, k = +look.iris || 1;
  const A = [0, 0.07, 0.14, 0.2, 0.26, 0.32, 0.4, 0.55, 0.75, 1].map((t) => t * Math.PI), SEG = 12;
  const b = bucket(B, 0.3, 0, glow > 0 ? 'eyes-glow' : 'eyes');
  if (glow > 0 && !b.E) b.E = [];
  fig.updateMatrixWorld(true);
  const toFig = new THREE.Matrix4().copy(fig.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const eye of [fig.eyes.l, fig.eyes.r]) {
    m.multiplyMatrices(toFig, eye.matrixWorld); nm.getNormalMatrix(m);
    const first = b.P.length / 3;
    A.forEach((a, ri) => {
      const t = a / Math.PI, pupil = t < 0.05 * k, inIris = t < 0.165 * k;
      const c = pupil ? [0.004, 0.003, 0.002] : inIris ? [iris.r * 0.85, iris.g * 0.85, iris.b * 0.85] : [white.r, white.g, white.b];
      const cnt = ri === 0 || ri === A.length - 1 ? 1 : SEG;
      for (let s = 0; s < cnt; s++) {
        const ph = (s / SEG) * Math.PI * 2, x = Math.sin(a) * Math.cos(ph), y = Math.sin(a) * Math.sin(ph), z = Math.cos(a);
        v.set(x, y, z).applyMatrix4(m); n.set(x, y, z).applyMatrix3(nm).normalize();
        b.P.push(v.x, v.y, v.z); b.N.push(n.x, n.y, n.z); b.C.push(...c);
        if (b.E) { const g = !pupil && inIris ? glow : 0; b.E.push(iris.r * g, iris.g * g, iris.b * g); }
      }
    });
    // the pole, the rings, the far pole
    const ring = (ri) => first + 1 + (ri - 1) * SEG, last = first + 1 + (A.length - 2) * SEG;
    for (let s = 0; s < SEG; s++) b.I.push(first, ring(1) + s, ring(1) + ((s + 1) % SEG));
    for (let ri = 1; ri < A.length - 2; ri++) for (let s = 0; s < SEG; s++) { const a0 = ring(ri) + s, a1 = ring(ri) + ((s + 1) % SEG), b0 = ring(ri + 1) + s, b1 = ring(ri + 1) + ((s + 1) % SEG); b.I.push(a0, b0, b1, a0, b1, a1); }
    for (let s = 0; s < SEG; s++) b.I.push(last, ring(A.length - 2) + ((s + 1) % SEG), ring(A.length - 2) + s);
  }
}

/* ---------------- anything else: its own geometry, coloured by its material ---------------- */
// the droid kit's paint: a colour and a finish per role (paint.js), without the wear
const ROLE_FINISH = [null, null, [[0.8, 0.81, 0.83], 0.3, 1], [[0.035, 0.038, 0.045], 0.55, 0.7], [[0.78, 0.52, 0.22], 0.36, 1], [[0.02, 0.02, 0.02], 0.88, 0], [[0.36, 0.38, 0.41], 0.42, 1]];
const visible = (o, root) => { for (let x = o; x && x !== root; x = x.parent) if (!x.visible) return false; return true; };

export function bakeMeshes(root, fig, list = []) { const B = reopen(list); collect(root, fig, B, new Map()); return finish(B); }
function collect(root, fig, B, ctx) {
  const toFig = new THREE.Matrix4(), m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3(), col = [0, 0, 0];
  fig.updateMatrixWorld(true); toFig.copy(fig.matrixWorld).invert();
  root.traverse((o) => {
    if (!o.isMesh || !visible(o, fig) || !o.geometry || o === fig.body || o === fig.eyes.l || o === fig.eyes.r) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material; if (!mat || mat.visible === false) return;
    const g = o.geometry, P = g.attributes.position; if (!P) return;
    if (!g.attributes.normal) g.computeVertexNormals();
    const Nn = g.attributes.normal, I = g.index ? g.index.array : Uint32Array.from({ length: P.count }, (_, i) => i);
    m.multiplyMatrices(toFig, o.matrixWorld); nm.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    // how each vertex is coloured, and which finish each triangle takes
    let colour, finishOf;
    if (mat === fig.skin) {
      const paint = painterOf(ctx, mat), at = g.attributes, R = at.aRest?.array, L = at.aLip?.array, C = at.aCav?.array, M = at.aMark?.array, A = at.aArm?.array;
      colour = (i, nz) => { paint(col, 0, R ? R[i * 3] : 0, R ? R[i * 3 + 1] : 0, R ? R[i * 3 + 2] : 0, nz, L ? L[i] : 0, C ? C[i * 2] : 0, C ? C[i * 2 + 1] : 0, M ? M[i * 2] : 0, M ? M[i * 2 + 1] : 0, A ? A[i * 2] : 0, A ? A[i * 2 + 1] : 0); return col; };
      finishOf = () => [0.6, 0, 'skin'];
    } else if (mat.userData?.u?.uPrimary && g.attributes.aData) {
      const u = mat.userData.u, D = g.attributes.aData.array, fin = u.uFinish ? u.uFinish.value : 0, role = (i) => { const rf = Math.floor(D[i * 4] + 0.5); return rf - 8 * Math.floor(rf / 8); };
      colour = (i) => { const r = role(i); if (r < 2) { const c = r ? u.uSecondary.value : u.uPrimary.value; col[0] = c.r; col[1] = c.g; col[2] = c.b; } else { const [c] = ROLE_FINISH[r] || ROLE_FINISH[6]; col[0] = c[0]; col[1] = c[1]; col[2] = c[2]; } return col; };
      finishOf = (i) => { const r = role(i); return r < 2 ? [0.45, fin, 'part'] : [(ROLE_FINISH[r] || ROLE_FINISH[6])[1], (ROLE_FINISH[r] || ROLE_FINISH[6])[2], 'part']; };
    } else {
      const vc = mat.vertexColors && g.attributes.color ? g.attributes.color : null, c0 = mat.color || new THREE.Color(1, 1, 1);
      colour = (i) => { if (vc) { col[0] = vc.getX(i) * c0.r; col[1] = vc.getY(i) * c0.g; col[2] = vc.getZ(i) * c0.b; } else { col[0] = c0.r; col[1] = c0.g; col[2] = c0.b; } return col; };
      finishOf = () => [mat.roughness ?? 0.6, mat.metalness ?? 0, 'part'];
    }
    const glow = mat.emissive && (mat.emissiveIntensity ?? 1) > 0 && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0 ? [mat.emissive.r * mat.emissiveIntensity, mat.emissive.g * mat.emissiveIntensity, mat.emissive.b * mat.emissiveIntensity] : null;
    const seen = new Map();   // (bucket, source vertex) -> index in the bucket
    for (let t = 0; t + 2 < I.length; t += 3) {
      const [rough, metal, name] = finishOf(I[t]), b = bucket(B, rough, metal, name);
      if (glow && !b.E) b.E = new Array(b.C.length).fill(0);
      let map = seen.get(b); if (!map) seen.set(b, (map = new Map()));
      const tri = [I[t], I[t + 1], I[t + 2]].map((i) => {
        let k = map.get(i); if (k !== undefined) return k;
        k = b.P.length / 3; map.set(i, k);
        v.fromBufferAttribute(P, i).applyMatrix4(m); n.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize();
        b.P.push(v.x, v.y, v.z); b.N.push(n.x, n.y, n.z); const c = colour(i, n.z); b.C.push(c[0], c[1], c[2]);
        if (b.E) b.E.push(...(glow || [0, 0, 0]));
        return k;
      });
      if (flip) b.I.push(tri[0], tri[2], tri[1]); else b.I.push(tri[0], tri[1], tri[2]);
    }
  });
}

// the whole figure: the body from the base mesh (not the subdivided one the page shows), the eyes, and the species'
// features and the carried thing as the page shows them now
export function bakeTable(fig) {
  const t0 = performance.now(), B = buckets(), ctx = new Map();
  fig.updateMatrixWorld(true);
  bakeBody(fig, B, ctx); bakeEyes(fig, B);
  for (const name of ['pureblood', 'carry']) { const g = fig.getObjectByName(name); if (g) collect(g, fig, B, ctx); }
  const list = finish(B);
  list.ms = Math.round(performance.now() - t0);
  return list;
}
