// Human base: animation clips that come as data, played on our skeleton. Our own code. Two formats are read: BVH text
// and glTF (a .gltf's JSON with its binary buffer, or a .glb). A clip is bone turns over time on its own skeleton;
// retarget() maps it onto a rig from motion.js (makeRig), so it plays exactly as run() and stand() do: { root, q }.
//
//   const clip = parseBVH(text)                     // or parseGLB(arrayBuffer), or parseGLTF(json, bin)
//   const p = retarget(clip, rig, { root: 'inplace' })          // in the page; or, for clips we ship, at build time
//   c = compact(clip, rig.bones) -> packClip(c) (JSON), and in the page play(unpackClip(json), rig, o)
//   p.sample(t) -> { root, q }; p.duration; p.speed (m/s, for a clip that travels); p.travel ([x, y, z]);
//   p.marks.impact (seconds: when a blow lands, given as o.marks.impact or the moment a hand or foot moves fastest)
//
// How a clip is mapped: by bone names (guessMap knows the common ones; a map can be given), with the difference between
// the two skeletons' rest poses taken out (a T-pose clip on our arms-down figure), its moves scaled to our legs, and the
// hips' travel either kept (an attack that steps in: play.travel says how far) or taken out (a run in place: the figure
// then moves on the map at play.speed and the feet keep their grip).
//
// Clip files are read as untrusted data: sizes and counts are capped, every number is checked, nothing in them is used
// as code, markup or an object key of ours. A clip that cannot be read throws a ClipError with a plain message.
import { Q, poseWorld } from './motion.js';

export class ClipError extends Error {}
const LIMIT = { chars: 8e6, bytes: 32e6, bones: 256, frames: 20000, tracks: 1024 };
const fail = (m) => { throw new ClipError(m); };
const num = (s) => { const x = Number(s); if (!Number.isFinite(x)) fail('not a number: ' + String(s).slice(0, 20)); return x; };
const NAME = /^[\w.:\-|]{1,64}$/;
const D = Math.PI / 180;
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// A clip, whatever it came from:
//   bones: [{ name, parent (index or -1), offset: [x, y, z] (from the parent, at rest), rest: quaternion (its own turn
//            at rest), tip: [x, y, z] or null (where a bone with no child ends, at rest) }]
//   fps, frames, rot: Float32Array(frames * bones * 4) (each bone's own turn per frame), tr: Float32Array(frames *
//   bones * 3) (each bone's place from its parent per frame, in the clip's own units: the offset where nothing moves
//   it), base: { rot, scale } (anything above the top bone)

/* ---------------- BVH ---------------- */
export function parseBVH(text) {
  if (typeof text !== 'string') fail('a BVH clip is text');
  if (text.length > LIMIT.chars) fail('the clip is too big');
  const tok = text.split(/\s+/).filter(Boolean); let i = 0;
  const next = () => { if (i >= tok.length) fail('the clip ends too soon'); return tok[i++]; };
  const want = (w) => { const t = next(); if (t !== w) fail(`expected ${w}, found ${t.slice(0, 20)}`); };
  want('HIERARCHY');
  const bones = [], chans = [];   // chans[b]: [{ kind: 'pos' | 'rot', axis }]
  const stack = [];
  let kw = next(); if (kw !== 'ROOT') fail('expected ROOT');
  for (;;) {
    // a joint: ROOT or JOINT name { OFFSET x y z CHANNELS n ... (JOINT ... | End Site { OFFSET x y z })* }
    if (kw === 'ROOT' || kw === 'JOINT') {
      const name = next(); if (!NAME.test(name)) fail('a bone name is not plain');
      if (bones.length >= LIMIT.bones) fail('too many bones');
      want('{'); want('OFFSET'); const offset = [num(next()), num(next()), num(next())];
      want('CHANNELS'); const n = num(next()); if (!(n >= 0 && n <= 6 && Number.isInteger(n))) fail('a joint has a bad channel count');
      const ch = []; for (let k = 0; k < n; k++) { const c = next(), m = /^([XYZ])(position|rotation)$/.exec(c); if (!m) fail('an unknown channel: ' + c.slice(0, 20)); ch.push({ kind: m[2] === 'position' ? 'pos' : 'rot', axis: 'XYZ'.indexOf(m[1]) }); }
      bones.push({ name, parent: stack.length ? stack[stack.length - 1] : -1, offset, rest: [0, 0, 0, 1], tip: null }); chans.push(ch);
      stack.push(bones.length - 1);
    } else if (kw === 'End') {
      want('Site'); want('{'); want('OFFSET'); const o = [num(next()), num(next()), num(next())]; want('}');
      if (stack.length) bones[stack[stack.length - 1]].tip = o;
    } else if (kw === '}') {
      stack.pop(); if (!stack.length) break;
    } else fail('unexpected ' + kw.slice(0, 20));
    kw = next();
  }
  // a second ROOT is not read; the motion follows
  while (tok[i] !== 'MOTION') { if (i >= tok.length) fail('no MOTION'); i++; }
  i++; want('Frames:'); const F = num(next()); want('Frame'); want('Time:'); const ft = num(next());
  if (!(Number.isInteger(F) && F >= 1 && F <= LIMIT.frames)) fail('a bad frame count');
  if (!(ft > 0 && ft < 1)) fail('a bad frame time');
  const per = chans.reduce((s, c) => s + c.length, 0), B = bones.length;
  if (tok.length - i < F * per) fail('the clip has fewer numbers than its frames need');
  const rot = new Float32Array(F * B * 4), tr = new Float32Array(F * B * 3), ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let f = 0; f < F; f++) {
    for (let b = 0; b < B; b++) {
      let q = [0, 0, 0, 1]; const p = bones[b].offset.slice();
      for (const c of chans[b]) { const v = num(tok[i++]); if (c.kind === 'rot') q = Q.mul(q, Q.axis(ax[c.axis], v * D)); else p[c.axis] = bones[b].offset[c.axis] + v; }
      rot.set(q, (f * B + b) * 4); tr.set(p, (f * B + b) * 3);
    }
  }
  return { bones, fps: 1 / ft, frames: F, rot, tr, base: { rot: [0, 0, 0, 1], scale: 1 }, from: 'bvh' };
}

/* ---------------- glTF ---------------- */
export function parseGLB(buf) {
  if (!(buf instanceof ArrayBuffer)) fail('a GLB clip is binary');
  if (buf.byteLength > LIMIT.bytes || buf.byteLength < 20) fail('the clip is too big or too small');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) fail('not a glTF 2 binary');
  let at = 12, json = null, bin = null;
  while (at + 8 <= buf.byteLength) {
    const len = dv.getUint32(at, true), type = dv.getUint32(at + 4, true), start = at + 8;
    if (start + len > buf.byteLength) fail('a chunk runs past the end');
    if (type === 0x4e4f534a && !json) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len)));
    else if (type === 0x004e4942 && !bin) bin = buf.slice(start, start + len);
    at = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) fail('no JSON chunk');
  return parseGLTF(json, bin);
}
export function parseGLTF(json, bin, o = {}) {
  if (!json || typeof json !== 'object') fail('not a glTF');
  const arr = (v) => (Array.isArray(v) ? v : []);
  const nodes = arr(json.nodes), skins = arr(json.skins), anims = arr(json.animations), views = arr(json.bufferViews), accs = arr(json.accessors);
  if (!skins.length) fail('no skin (skeleton) in the glTF');
  if (nodes.length > 4096) fail('too many nodes');
  const joints = arr(skins[o.skin | 0].joints).map((j) => (Number.isInteger(j) && j >= 0 && j < nodes.length ? j : fail('a bad joint')));
  if (!joints.length || joints.length > LIMIT.bones) fail('a bad joint count');
  const parentOf = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, k) => arr(n && n.children).forEach((c) => { if (Number.isInteger(c) && c >= 0 && c < nodes.length) parentOf[c] = k; }));
  const jIndex = new Map(joints.map((j, k) => [j, k]));
  const trs = (n) => {
    if (n && Array.isArray(n.matrix)) {   // a matrix: its turn and its place (a uniform scale is folded out)
      const m = n.matrix.map(num); if (m.length !== 16) fail('a bad matrix');
      const sx = Math.hypot(m[0], m[1], m[2]) || 1, r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sx, m[5] / sx, m[6] / sx, m[8] / sx, m[9] / sx, m[10] / sx];
      const tr = r[0] + r[4] + r[8]; let q;
      if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); q = [(r[5] - r[7]) * s, (r[6] - r[2]) * s, (r[1] - r[3]) * s, 0.25 / s]; }
      else if (r[0] > r[4] && r[0] > r[8]) { const s = 2 * Math.sqrt(1 + r[0] - r[4] - r[8]); q = [0.25 * s, (r[3] + r[1]) / s, (r[6] + r[2]) / s, (r[5] - r[7]) / s]; }
      else if (r[4] > r[8]) { const s = 2 * Math.sqrt(1 + r[4] - r[0] - r[8]); q = [(r[3] + r[1]) / s, 0.25 * s, (r[7] + r[5]) / s, (r[6] - r[2]) / s]; }
      else { const s = 2 * Math.sqrt(1 + r[8] - r[0] - r[4]); q = [(r[6] + r[2]) / s, (r[7] + r[5]) / s, 0.25 * s, (r[1] - r[3]) / s]; }
      return { t: [m[12], m[13], m[14]], r: q, s: sx };
    }
    const t = arr(n && n.translation).map(num), r = arr(n && n.rotation).map(num), s = arr(n && n.scale).map(num);
    return { t: t.length === 3 ? t : [0, 0, 0], r: r.length === 4 ? r : [0, 0, 0, 1], s: s.length === 3 ? (s[0] + s[1] + s[2]) / 3 : 1 };
  };
  const bones = joints.map((j, k) => {
    let p = parentOf[j]; while (p >= 0 && !jIndex.has(p)) p = parentOf[p];
    const n = nodes[j] || {}, x = trs(n), name = typeof n.name === 'string' && NAME.test(n.name) ? n.name : 'joint' + k;
    return { name, parent: p >= 0 ? jIndex.get(p) : -1, offset: x.t, rest: x.r, tip: null, node: j, scale: x.s };
  });
  // parents must come before children
  const order = [], seen = new Set(), visit = (k) => { if (seen.has(k)) return; seen.add(k); if (bones[k].parent >= 0) visit(bones[k].parent); order.push(k); };
  bones.forEach((_, k) => visit(k));
  const remap = new Map(order.map((k, i) => [k, i])), B = order.map((k) => ({ ...bones[k], parent: bones[k].parent >= 0 ? remap.get(bones[k].parent) : -1 }));
  if (B.filter((b) => b.parent < 0).length !== 1) fail('the skeleton has more than one top bone');
  // whatever sits above the top bone (an armature's turn and scale)
  let baseRot = [0, 0, 0, 1], baseScale = 1;
  for (let p = parentOf[B[0].node]; p >= 0; p = parentOf[p]) { const x = trs(nodes[p]); baseRot = Q.mul(x.r, baseRot); baseScale *= x.s; }
  // the animation
  const a = anims[typeof o.animation === 'number' ? o.animation : Math.max(0, anims.findIndex((x) => x && x.name === o.animation))];
  if (!a) fail('no animation in the glTF');
  if (arr(a.channels).length > LIMIT.tracks) fail('too many tracks');
  // a track's numbers: plain floats, or (for turns) normalized integers, as glTF allows
  const KIND = { 5126: [4, (dv, o) => dv.getFloat32(o, true)], 5122: [2, (dv, o) => Math.max(-1, dv.getInt16(o, true) / 32767)], 5120: [1, (dv, o) => Math.max(-1, dv.getInt8(o) / 127)],
    5123: [2, (dv, o) => dv.getUint16(o, true) / 65535], 5121: [1, (dv, o) => dv.getUint8(o) / 255] };
  const read = (ai, comps) => {
    const ac = accs[ai]; if (!ac || !bin) fail('an animation track has no data');
    const K = KIND[ac.componentType]; if (!K || (ac.componentType !== 5126 && !ac.normalized)) fail('an animation track is not floats or normalized integers');
    const want = { SCALAR: 1, VEC3: 3, VEC4: 4 }[ac.type]; if (want !== comps) fail('an animation track has the wrong shape');
    const bv = views[ac.bufferView]; if (!bv) fail('a track has no buffer view');
    const count = ac.count; if (!(Number.isInteger(count) && count >= 1 && count <= LIMIT.frames * 4)) fail('a bad track length');
    const size = K[0], stride = bv.byteStride || comps * size, start = (bv.byteOffset || 0) + (ac.byteOffset || 0);
    if (start < 0 || start + stride * (count - 1) + comps * size > Math.min(bin.byteLength, (bv.byteOffset || 0) + bv.byteLength)) fail('a track runs past its buffer');
    const dv = new DataView(bin), out = new Float32Array(count * comps);
    for (let k = 0; k < count; k++) for (let c = 0; c < comps; c++) { const v = K[1](dv, start + k * stride + c * size); if (!Number.isFinite(v)) fail('a track holds a bad number'); out[k * comps + c] = v; }
    return out;
  };
  const tracks = [];
  let end = 0;
  for (const ch of arr(a.channels)) {
    const tgt = ch && ch.target, s = arr(a.samplers)[ch && ch.sampler]; if (!tgt || !s) continue;
    const bi = jIndex.has(tgt.node) ? remap.get(jIndex.get(tgt.node)) : -1; if (bi < 0) continue;
    if (tgt.path !== 'rotation' && tgt.path !== 'translation') continue;
    const comps = tgt.path === 'rotation' ? 4 : 3, times = read(s.input, 1), cubic = s.interpolation === 'CUBICSPLINE', vals = read(s.output, comps);
    if (vals.length !== times.length * comps * (cubic ? 3 : 1)) fail('a track has the wrong number of values');
    const v = cubic ? Float32Array.from({ length: times.length * comps }, (_, k) => vals[Math.floor(k / comps) * comps * 3 + comps + (k % comps)]) : vals;
    tracks.push({ bi, comps, times, v, step: s.interpolation === 'STEP' });
    end = Math.max(end, times[times.length - 1]);
  }
  if (!tracks.length) fail('the animation moves none of the skeleton');
  const fps = 30, F = Math.min(LIMIT.frames, Math.max(2, Math.round(end * fps) + 1)), N = B.length;
  const rot = new Float32Array(F * N * 4), tr = new Float32Array(F * N * 3);
  for (let f = 0; f < F; f++) for (let b = 0; b < N; b++) { rot.set(B[b].rest, (f * N + b) * 4); tr.set(B[b].offset, (f * N + b) * 3); }
  for (const tk of tracks) {
    for (let f = 0; f < F; f++) {
      const t = f / fps, T = tk.times; let k = 0; while (k < T.length - 1 && T[k + 1] <= t) k++;
      const k2 = Math.min(T.length - 1, k + 1), u = tk.step || k2 === k ? 0 : Math.min(1, Math.max(0, (t - T[k]) / (T[k2] - T[k] || 1)));
      const a0 = Array.from(tk.v.subarray(k * tk.comps, k * tk.comps + tk.comps)), a1 = Array.from(tk.v.subarray(k2 * tk.comps, k2 * tk.comps + tk.comps));
      if (tk.comps === 4) rot.set(Q.slerp(norm4(a0), norm4(a1), u), (f * N + tk.bi) * 4);
      else tr.set([0, 1, 2].map((c) => a0[c] + (a1[c] - a0[c]) * u), (f * N + tk.bi) * 3);
    }
  }
  return { bones: B.map(({ name, parent, offset, rest, tip }) => ({ name, parent, offset, rest, tip })), fps, frames: F, rot, tr, base: { rot: baseRot, scale: baseScale }, from: 'gltf' };
}
const norm4 = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map((x) => x / l); };

/* ---------------- which of their bones is which of ours ---------------- */
const clean = (n) => String(n).toLowerCase().replace(/^.*[:|]/, '').replace(/^mixamorig/, '').replace(/[^a-z0-9]/g, '');
const LIMBS = {
  clavicle: ['shoulder', 'collar', 'clavicle'], upperarm01: ['arm', 'shldr', 'upperarm'], lowerarm01: ['forearm', 'lowerarm'], wrist: ['hand', 'wrist'],
  upperleg01: ['upleg', 'thigh', 'upperleg', 'hip'], lowerleg01: ['leg', 'shin', 'lowerleg', 'calf', 'knee'], foot: ['foot', 'ankle'], 'toe3-1': ['toebase', 'toe', 'toes', 'ball'],
};
// a bone name's side and limb word: "LeftForeArm", "lForeArm", "forearm_l", "ForeArm.L"...
function sideOf(raw) {
  const n = String(raw).toLowerCase().replace(/^.*[:|]/, '').replace(/^mixamorig/, '');
  for (const [s, re] of [['L', /^(left|l(?=[a-z]*$)|l[_.\-])|([_.\-]l|left)$/], ['R', /^(right|r(?=[a-z]*$)|r[_.\-])|([_.\-]r|right)$/]]) {
    const m = re.exec(n); if (m) return [s, clean(n.replace(re, ''))];
  }
  return [null, clean(n)];
}
export function guessMap(clip) {
  const map = {}, B = clip.bones;
  // the limbs by name
  for (let k = 0; k < B.length; k++) {
    const [s, w] = sideOf(B[k].name); if (!s) continue;
    for (const [ours, words] of Object.entries(LIMBS)) if (words.includes(w)) { const key = ours + '.' + s; if (!(key in map)) map[key] = B[k].name; }
  }
  // the hips: a bone called so, or the top bone; the chain from there to the head is the spine and neck, spread over ours
  let hips = B.findIndex((b) => ['hips', 'pelvis', 'hip'].includes(clean(b.name))); if (hips < 0) hips = 0;
  map.root = B[hips].name;
  const headK = B.findIndex((b) => clean(b.name) === 'head');
  if (headK >= 0) {
    const chain = []; for (let k = B[headK].parent; k >= 0 && k !== hips; k = B[k].parent) chain.unshift(k);
    const neck = chain.filter((k) => /^neck/.test(clean(B[k].name))), spine = chain.filter((k) => !/^neck/.test(clean(B[k].name)));
    if (spine.length) { map.spine05 = B[spine[0]].name; if (spine.length > 2) map.spine03 = B[spine[Math.floor(spine.length / 2)]].name; if (spine.length > 1) map.spine01 = B[spine[spine.length - 1]].name; }
    if (neck.length) map.neck01 = B[neck[0]].name;
    map.head = B[headK].name;
  }
  return map;
}

/* ---------------- a clip in our terms ---------------- */
// What any of our figures needs from a clip, worked out once (at build time for clips we ship): for each of our bones
// the clip drives, its turn in the world away from the clip's rest pose, per frame, in our axes; the clip's rest
// direction for each driven limb (so each figure takes out its own rest difference); and the hips per frame, in units
// of the clip's own hip height (so each figure scales them to its own legs).
//   o.map: { ourBone: theirBone } (default guessMap); o.axes: a turn from their frame into ours (y up, facing +z)
export function compact(clip, topo, o = {}) {
  const map = o.map || guessMap(clip), G = o.axes || [0, 0, 0, 1], Gi = Q.inv(G), B = clip.bones, N = B.length, F = clip.frames;
  const at = new Map(topo.map((b, k) => [b.name, k])), byName = new Map(B.map((b, k) => [b.name, k]));
  const src = {}; for (const [ours, theirs] of Object.entries(map)) if (at.has(ours) && byName.has(theirs)) src[ours] = byName.get(theirs);
  if (src.root === undefined) fail('the clip has no hips to follow');
  const toOurs = (p) => Q.rot(G, p), sc = clip.base.scale;
  // their bones in the world (their frame) for a frame, or at rest (f < 0)
  const pose = (f) => {
    const W = new Array(N), P = new Array(N);
    for (let b = 0; b < N; b++) {
      const l = f < 0 ? B[b].rest : Array.from(clip.rot.subarray((f * N + b) * 4, (f * N + b) * 4 + 4)), t = f < 0 ? B[b].offset : Array.from(clip.tr.subarray((f * N + b) * 3, (f * N + b) * 3 + 3)), pb = B[b].parent;
      if (pb < 0) { W[b] = Q.mul(clip.base.rot, l); P[b] = mul(Q.rot(clip.base.rot, t), sc); }
      else { W[b] = Q.mul(W[pb], l); P[b] = add(P[pb], mul(Q.rot(W[pb], t), sc)); }
    }
    return { W, P };
  };
  const lowestOf = ({ W, P }) => { let lo = Infinity; for (let b = 0; b < N; b++) { lo = Math.min(lo, toOurs(P[b])[1]); if (B[b].tip) lo = Math.min(lo, toOurs(add(P[b], mul(Q.rot(W[b], B[b].tip), sc)))[1]); } return lo; };
  const rest = pose(-1), restWi = rest.W.map(Q.inv), hipH = toOurs(rest.P[src.root])[1] - lowestOf(rest);
  if (!(hipH > 0)) fail('the clip stands no height');
  // the clip's rest direction for each driven limb, toward the next driven bone down our chain
  const kids = topo.map((_, k) => topo.map((b, j) => (b.parent === k ? j : -1)).filter((j) => j >= 0));
  const nextMapped = (k) => { const q = [...kids[k]]; while (q.length) { const j = q.shift(); if (src[topo[j].name] !== undefined) return j; q.push(...kids[j]); } return -1; };
  const bones = topo.map((b) => b.name).filter((n) => src[n] !== undefined), dir = {};
  for (const n of bones) { const j = nextMapped(at.get(n)); dir[n] = j < 0 || TRUNK.has(n) ? null : { to: topo[j].name, d: norm(toOurs(sub(rest.P[src[topo[j].name]], rest.P[src[n]]))) }; }
  // per frame: the turns, the hips, the ground
  const nb = bones.length, d = new Float32Array(F * nb * 4), hip = new Float32Array(F * 3); let ground = Infinity;
  const ends = ['wrist.L', 'wrist.R', 'foot.L', 'foot.R'].map((n) => src[n]).filter((k) => k !== undefined);
  let fastest = 0, impact = (F - 1) / clip.fps / 2, prevEnds = null;
  for (let f = 0; f < F; f++) {
    const P0 = pose(f);
    bones.forEach((n, i) => { const s = src[n]; d.set(Q.mul(G, Q.mul(Q.mul(P0.W[s], restWi[s]), Gi)), (f * nb + i) * 4); });
    hip.set(toOurs(P0.P[src.root]).map((v) => v / hipH), f * 3);
    ground = Math.min(ground, lowestOf(P0));
    const e = ends.map((k) => sub(P0.P[k], P0.P[src.root]));   // (from the hips, so the clip's travel is not speed)
    if (prevEnds) for (let k = 0; k < e.length; k++) { const v = Math.hypot(...sub(e[k], prevEnds[k])); if (v > fastest) { fastest = v; impact = (f - 0.5) / clip.fps; } }
    prevEnds = e;
  }
  for (let f = 0; f < F; f++) hip[f * 3 + 1] -= ground / hipH;   // y: above the clip's ground
  // a run or walk made in place: the speed the ground would have to move under a planted foot (its median backward
  // speed while it is down), in hip heights a second, so the map can move the figure at it and the feet keep their grip
  const balls = ['toe3-1.L', 'toe3-1.R', 'foot.L', 'foot.R'].map((n) => src[n]).filter((k) => k !== undefined), vs = [];
  if (balls.length >= 2) {
    let prev = null;
    for (let f = 0; f < F; f++) {
      const P0 = pose(f), b = balls.map((k) => [toOurs(sub(P0.P[k], P0.P[src.root])), toOurs(P0.P[k])[1] - ground]);
      if (prev) for (let i = 0; i < b.length; i++) if (b[i][1] < 0.04 * hipH && prev[i][1] < 0.04 * hipH) vs.push(-(b[i][0][2] - prev[i][0][2]) * clip.fps);
      prev = b;
    }
  }
  vs.sort((a, b) => a - b);
  const contact = vs.length >= 4 ? vs[Math.floor(vs.length / 2)] / hipH : 0;
  const x0 = hip[0], z0 = hip[2]; for (let f = 0; f < F; f++) { hip[f * 3] -= x0; hip[f * 3 + 2] -= z0; }   // x, z: from where it starts
  const marks = { impact, ...(contact > 0.05 ? { ground: contact } : {}), ...(o.marks || {}) };
  return { v: 1, fps: clip.fps, frames: F, bones, dir, d, hip, marks, hipH };
}
const TRUNK = new Set(['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03', 'head']);

/* ---------------- onto one figure ---------------- */
// o.root: 'inplace' (the hips' travel taken out: play.speed is how fast the figure should move) or 'keep' (play.travel
// is how far the clip carries it); o.loop: wrap time (default for 'inplace')
export function play(c, rig, o = {}) {
  const F = c.frames, dur = (F - 1) / c.fps, nb = c.bones.length, n = rig.n, idx = c.bones.map((b) => rig.at[b]);
  if (idx.some((k) => k === undefined)) fail('the clip drives a bone this figure has not got');
  const driven = new Int32Array(n).fill(-1); idx.forEach((k, i) => (driven[k] = i));
  // this figure's own rest difference for each driven limb
  const fixI = c.bones.map((b, i) => { const r = c.dir[b]; if (!r || rig.at[r.to] === undefined) return [0, 0, 0, 1]; return Q.inv(Q.from(r.d, norm(sub(rig.bones[rig.at[r.to]].head, rig.bones[idx[i]].head)))); });
  const H = rig.bones[rig.at.root].head[1], hipAt = (f) => [c.hip[f * 3] * H, c.hip[f * 3 + 1] * H - H, c.hip[f * 3 + 2] * H];
  const t1 = hipAt(F - 1), travel = [t1[0], 0, t1[2]], mode = o.root || 'inplace', loop = o.loop ?? mode === 'inplace';
  // how fast the figure should move: the clip's own travel, or for one made in place, its planted foot's speed
  const speed = Math.max(dur > 0 ? Math.hypot(travel[0], travel[2]) / dur : 0, mode === 'inplace' ? (c.marks.ground || 0) * H : 0);
  const dAt = (f, i) => Array.from(c.d.subarray((f * nb + i) * 4, (f * nb + i) * 4 + 4));
  function sample(t) {
    const x = dur > 0 ? (loop ? (((t % dur) + dur) % dur) : Math.min(dur, Math.max(0, t))) : 0;
    const fx = x * c.fps, f0 = Math.min(F - 1, Math.floor(fx)), f1 = Math.min(F - 1, f0 + 1), u = fx - f0;
    const Wo = new Array(n), q = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      const p = rig.bones[k].parent, pw = p < 0 ? [0, 0, 0, 1] : Wo[p], i = driven[k];
      Wo[k] = i >= 0 ? Q.mul(Q.slerp(dAt(f0, i), dAt(f1, i), u), fixI[i]) : pw;
      q.set(Q.mul(Q.inv(pw), Wo[k]), k * 4);
    }
    const h0 = hipAt(f0), h1 = hipAt(f1); let root = [0, 1, 2].map((j) => h0[j] + (h1[j] - h0[j]) * u);
    if (mode === 'inplace') { const k = dur > 0 ? x / dur : 0; root = [root[0] - travel[0] * k, root[1], root[2] - travel[2] * k]; }
    return { root, q, world: () => poseWorld(rig, root, q) };
  }
  return { sample, duration: dur, speed, travel, scale: H, map: Object.fromEntries(c.bones.map((b, i) => [b, i])), loop, marks: { ...c.marks } };
}
// both at once, for a clip read in the page (tests, trying a file out)
export const retarget = (clip, rig, o = {}) => { const c = compact(clip, rig.bones, o), p = play(c, rig, o); p.scale = rig.bones[rig.at.root].head[1] / c.hipH; p.compact = c; return p; };

/* ---------------- shipping a clip ---------------- */
// our compact clip as plain JSON: the turns as 16-bit integers, the hips as 16-bit integers in 1/4096 of a hip height
const b64 = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64') : btoa(Array.from(u8, (x) => String.fromCharCode(x)).join('')));
const unb64 = (s) => { if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); return new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); } const t = atob(s), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };
export function packClip(c) {
  const d = Int16Array.from(c.d, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767)), h = Int16Array.from(c.hip, (x) => Math.round(Math.max(-8, Math.min(8, x)) * 4096));
  return { v: 1, fps: +c.fps.toFixed(4), frames: c.frames, bones: c.bones, dir: Object.fromEntries(Object.entries(c.dir).map(([k, r]) => [k, r && { to: r.to, d: r.d.map((x) => +x.toFixed(5)) }])), d: b64(new Uint8Array(d.buffer)), hip: b64(new Uint8Array(h.buffer)), marks: Object.fromEntries(Object.entries(c.marks).map(([k, v]) => [k, +v.toFixed(3)])) };
}
// read a shipped clip (our own file, still checked: names, sizes and numbers)
export function unpackClip(j) {
  if (!j || j.v !== 1 || !Array.isArray(j.bones) || !j.bones.every((b) => typeof b === 'string' && NAME.test(b))) fail('not a clip of ours');
  const F = j.frames, nb = j.bones.length; if (!(Number.isInteger(F) && F >= 1 && F <= LIMIT.frames && nb >= 1 && nb <= 64 && j.fps > 0 && j.fps <= 240)) fail('a bad clip size');
  const du = unb64(String(j.d)), hu = unb64(String(j.hip)); if (du.byteLength !== F * nb * 8 || hu.byteLength !== F * 6) fail('a clip of the wrong length');
  const d = Float32Array.from(new Int16Array(du.buffer, du.byteOffset, F * nb * 4), (x) => x / 32767), hip = Float32Array.from(new Int16Array(hu.buffer, hu.byteOffset, F * 3), (x) => x / 4096);
  for (let i = 0; i < d.length; i += 4) { const l = Math.hypot(d[i], d[i + 1], d[i + 2], d[i + 3]) || 1; d[i] /= l; d[i + 1] /= l; d[i + 2] /= l; d[i + 3] /= l; }
  const dir = {}; for (const b of j.bones) { const r = j.dir && Object.prototype.hasOwnProperty.call(j.dir, b) ? j.dir[b] : null; dir[b] = r && typeof r.to === 'string' && NAME.test(r.to) && Array.isArray(r.d) && r.d.length === 3 && r.d.every(Number.isFinite) ? { to: r.to, d: r.d } : null; }
  const marks = {}; for (const k of ['impact', 'ground']) if (j.marks && Number.isFinite(j.marks[k])) marks[k] = j.marks[k];
  return { v: 1, fps: j.fps, frames: F, bones: j.bones.slice(), dir, d, hip, marks };
}
