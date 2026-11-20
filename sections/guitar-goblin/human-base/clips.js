// Human base: animation clips that come as data, played on our skeleton. Our own code. Two formats are read: BVH text
// and glTF (a .gltf's JSON with its binary buffer, or a .glb). A clip is bone turns over time on its own skeleton;
// retarget() maps it onto a rig from motion.js (makeRig), so it plays exactly as run() and stand() do: { root, q }.
//
//   const clip = parseBVH(text)                     // or parseGLB(arrayBuffer), or parseGLTF(json, bin)
//   const play = retarget(clip, rig, { root: 'inplace' })
//   play.sample(t) -> { root, q }; play.duration; play.speed (m/s, for a clip that travels); play.travel ([x, y, z])
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
//   fps, frames, rot: Float32Array(frames * bones * 4) (each bone's own turn per frame), pos: Float32Array(frames * 3)
//   (the top bone's place per frame, in the clip's own units), base: { rot, scale } (anything above the top bone)

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
  const rot = new Float32Array(F * B * 4), pos = new Float32Array(F * 3), ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let f = 0; f < F; f++) {
    for (let b = 0; b < B; b++) {
      let q = [0, 0, 0, 1]; const p = bones[b].offset.slice();
      for (const c of chans[b]) { const v = num(tok[i++]); if (c.kind === 'rot') q = Q.mul(q, Q.axis(ax[c.axis], v * D)); else if (b === 0) p[c.axis] = bones[b].offset[c.axis] + v; }
      rot.set(q, (f * B + b) * 4);
      if (b === 0) pos.set(p, f * 3);
    }
  }
  return { bones, fps: 1 / ft, frames: F, rot, pos, base: { rot: [0, 0, 0, 1], scale: 1 }, from: 'bvh' };
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
  const read = (ai, comps) => {
    const ac = accs[ai]; if (!ac || ac.componentType !== 5126 || !bin) fail('an animation track is not plain floats');
    const want = { SCALAR: 1, VEC3: 3, VEC4: 4 }[ac.type]; if (want !== comps) fail('an animation track has the wrong shape');
    const bv = views[ac.bufferView]; if (!bv) fail('a track has no buffer view');
    const count = ac.count; if (!(Number.isInteger(count) && count >= 1 && count <= LIMIT.frames * 4)) fail('a bad track length');
    const stride = bv.byteStride || comps * 4, start = (bv.byteOffset || 0) + (ac.byteOffset || 0);
    if (start < 0 || start + stride * (count - 1) + comps * 4 > Math.min(bin.byteLength, (bv.byteOffset || 0) + bv.byteLength)) fail('a track runs past its buffer');
    const dv = new DataView(bin), out = new Float32Array(count * comps);
    for (let k = 0; k < count; k++) for (let c = 0; c < comps; c++) { const v = dv.getFloat32(start + k * stride + c * 4, true); if (!Number.isFinite(v)) fail('a track holds a bad number'); out[k * comps + c] = v; }
    return out;
  };
  const tracks = [];
  let end = 0;
  for (const ch of arr(a.channels)) {
    const tgt = ch && ch.target, s = arr(a.samplers)[ch && ch.sampler]; if (!tgt || !s) continue;
    const bi = jIndex.has(tgt.node) ? remap.get(jIndex.get(tgt.node)) : -1; if (bi < 0) continue;
    if (tgt.path !== 'rotation' && !(tgt.path === 'translation' && bi === 0)) continue;
    const comps = tgt.path === 'rotation' ? 4 : 3, times = read(s.input, 1), cubic = s.interpolation === 'CUBICSPLINE', vals = read(s.output, comps);
    if (vals.length !== times.length * comps * (cubic ? 3 : 1)) fail('a track has the wrong number of values');
    const v = cubic ? Float32Array.from({ length: times.length * comps }, (_, k) => vals[Math.floor(k / comps) * comps * 3 + comps + (k % comps)]) : vals;
    tracks.push({ bi, comps, times, v, step: s.interpolation === 'STEP' });
    end = Math.max(end, times[times.length - 1]);
  }
  if (!tracks.length) fail('the animation moves none of the skeleton');
  const fps = 30, F = Math.min(LIMIT.frames, Math.max(2, Math.round(end * fps) + 1)), N = B.length;
  const rot = new Float32Array(F * N * 4), pos = new Float32Array(F * 3);
  for (let f = 0; f < F; f++) { for (let b = 0; b < N; b++) rot.set(B[b].rest, (f * N + b) * 4); pos.set(B[0].offset, f * 3); }
  for (const tr of tracks) {
    for (let f = 0; f < F; f++) {
      const t = f / fps, T = tr.times; let k = 0; while (k < T.length - 1 && T[k + 1] <= t) k++;
      const k2 = Math.min(T.length - 1, k + 1), u = tr.step || k2 === k ? 0 : Math.min(1, Math.max(0, (t - T[k]) / (T[k2] - T[k] || 1)));
      const a0 = Array.from(tr.v.subarray(k * tr.comps, k * tr.comps + tr.comps)), a1 = Array.from(tr.v.subarray(k2 * tr.comps, k2 * tr.comps + tr.comps));
      if (tr.comps === 4) rot.set(Q.slerp(norm4(a0), norm4(a1), u), (f * N + tr.bi) * 4);
      else pos.set([0, 1, 2].map((c) => a0[c] + (a1[c] - a0[c]) * u), f * 3);
    }
  }
  return { bones: B.map(({ name, parent, offset, rest, tip }) => ({ name, parent, offset, rest, tip })), fps, frames: F, rot, pos, base: { rot: baseRot, scale: baseScale }, from: 'gltf' };
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
  const map = {}, B = clip.bones, kids = B.map((_, k) => B.map((b, j) => (b.parent === k ? j : -1)).filter((j) => j >= 0));
  // the limbs by name
  for (let k = 0; k < B.length; k++) {
    const [s, w] = sideOf(B[k].name); if (!s) continue;
    for (const [ours, words] of Object.entries(LIMBS)) if (words.includes(w)) { const key = ours + '.' + s; if (!(key in map)) map[key] = B[k].name; }
  }
  // the trunk by its place: the top bone is the hips; the chain from there to the neck is the spine, spread over ours
  map.root = B[0].name;
  const headK = B.findIndex((b) => clean(b.name) === 'head'), neckK = B.findIndex((b) => /^neck/.test(clean(b.name)));
  if (headK >= 0) {
    const chain = []; for (let k = B[headK].parent; k > 0; k = B[k].parent) chain.unshift(k);
    const neck = chain.filter((k) => /^neck/.test(clean(B[k].name))), spine = chain.filter((k) => !/^neck/.test(clean(B[k].name)));
    if (spine.length) { map.spine05 = B[spine[0]].name; if (spine.length > 2) map.spine03 = B[spine[Math.floor(spine.length / 2)]].name; if (spine.length > 1) map.spine01 = B[spine[spine.length - 1]].name; }
    if (neck.length) map.neck01 = B[neck[0]].name; else if (neckK >= 0) map.neck01 = B[neckK].name;
    map.head = B[headK].name;
  }
  return map;
}

/* ---------------- onto our skeleton ---------------- */
// o.map: { ourBone: theirBone } (default guessMap); o.axes: a turn from their frame into ours (y up, the figure facing
// +z), default none; o.root: 'inplace' (default) or 'keep'; o.loop: true to wrap time (default for 'inplace')
export function retarget(clip, rig, o = {}) {
  const map = o.map || guessMap(clip), G = o.axes || [0, 0, 0, 1], Gi = Q.inv(G), B = clip.bones, N = B.length;
  const byName = new Map(B.map((b, k) => [b.name, k]));
  const src = {}; for (const [ours, theirs] of Object.entries(map)) if (rig.at[ours] !== undefined && byName.has(theirs)) src[ours] = byName.get(theirs);
  if (src.root === undefined) fail('the clip has no hips to follow');
  // their rest pose in the world (their frame), with what sits above the top bone
  const restW = new Array(N), restP = new Array(N);
  for (let b = 0; b < N; b++) {
    const pb = B[b].parent;
    if (pb < 0) { restW[b] = Q.mul(clip.base.rot, B[b].rest); restP[b] = mul(Q.rot(clip.base.rot, B[b].offset), clip.base.scale); }
    else { restW[b] = Q.mul(restW[pb], B[b].rest); restP[b] = add(restP[pb], mul(Q.rot(restW[pb], B[b].offset), clip.base.scale)); }
  }
  const toOurs = (p) => Q.rot(G, p);
  // their size against ours: from the hips down to the lowest joint, at rest
  let lowest = Infinity; for (let b = 0; b < N; b++) { lowest = Math.min(lowest, toOurs(restP[b])[1]); if (B[b].tip) lowest = Math.min(lowest, toOurs(add(restP[b], mul(Q.rot(restW[b], B[b].tip), clip.base.scale)))[1]); }
  const hipH = toOurs(restP[src.root])[1] - lowest, ourHip = rig.bones[rig.at.root].head[1];
  const scale = o.scale || (hipH > 0 ? ourHip / hipH : 1);
  // per mapped limb bone of ours: the turn taking their rest direction to ours (toward the next mapped bone down the
  // chain), so a T-pose clip lifts our arms from where they hang. The trunk is upright at rest in both, and its bones'
  // own lines say little (our hips' bone leans back to the spine), so it keeps its own shape and takes only the turns.
  const TRUNK = new Set(['root', 'spine05', 'spine04', 'spine03', 'spine02', 'spine01', 'neck01', 'neck02', 'neck03', 'head']);
  const kidsOf = rig.bones.map((_, k) => rig.bones.map((b, j) => (b.parent === k ? j : -1)).filter((j) => j >= 0));
  const nextMapped = (k) => { const q = [...kidsOf[k]]; while (q.length) { const j = q.shift(); const name = rig.bones[j].name; if (src[name] !== undefined) return j; q.push(...kidsOf[j]); } return -1; };
  const fix = {};
  for (const [ours, s] of Object.entries(src)) {
    const k = rig.at[ours], j = nextMapped(k);
    if (j < 0 || TRUNK.has(ours)) { fix[ours] = [0, 0, 0, 1]; continue; }
    const dTheirs = norm(toOurs(sub(restP[src[rig.bones[j].name]], restP[s]))), dOurs = norm(sub(rig.bones[j].head, rig.bones[k].head));
    fix[ours] = Q.from(dTheirs, dOurs);
  }
  const restWi = restW.map(Q.inv);
  // the hips' travel over the clip (in our frame and size): taken out for 'inplace', where it is the figure's speed
  const F = clip.frames, dur = (F - 1) / clip.fps;
  // the hips' place per frame, in our frame and size; and the clip's ground: the lowest any joint comes, over the clip
  const hipAbs = (f) => mul(toOurs(mul(Q.rot(clip.base.rot, Array.from(clip.pos.subarray(f * 3, f * 3 + 3))), clip.base.scale)), scale);
  let ground = Infinity;
  for (let s = 0, S = Math.min(F, 240); s < S; s++) {
    const f = Math.round((s * (F - 1)) / Math.max(1, S - 1)), W = new Array(N), P = new Array(N);
    for (let b = 0; b < N; b++) {
      const l = Array.from(clip.rot.subarray((f * N + b) * 4, (f * N + b) * 4 + 4)), pb = B[b].parent;
      if (pb < 0) { W[b] = Q.mul(clip.base.rot, l); P[b] = mul(Q.rot(clip.base.rot, Array.from(clip.pos.subarray(f * 3, f * 3 + 3))), clip.base.scale); }
      else { W[b] = Q.mul(W[pb], l); P[b] = add(P[pb], mul(Q.rot(W[pb], B[b].offset), clip.base.scale)); }
      ground = Math.min(ground, toOurs(P[b])[1]);
      if (B[b].tip) ground = Math.min(ground, toOurs(add(P[b], mul(Q.rot(W[b], B[b].tip), clip.base.scale)))[1]);
    }
  }
  ground *= scale;
  const hipAt = (f) => { const h = hipAbs(f); return [h[0], h[1] - ground - ourHip, h[2]]; };   // y: from where our hips are bound
  const t0 = hipAt(0), t1 = hipAt(F - 1), travel = [t1[0] - t0[0], 0, t1[2] - t0[2]];
  const mode = o.root || 'inplace', loop = o.loop ?? mode === 'inplace';
  const speed = dur > 0 ? Math.hypot(travel[0], travel[2]) / dur : 0;
  const n = rig.n;
  function frameRot(f, b) { return Array.from(clip.rot.subarray((f * N + b) * 4, (f * N + b) * 4 + 4)); }
  function sample(t) {
    let x = dur > 0 ? (loop ? (((t % dur) + dur) % dur) : Math.min(dur, Math.max(0, t))) : 0;
    const fx = x * clip.fps, f0 = Math.min(F - 1, Math.floor(fx)), f1 = Math.min(F - 1, f0 + 1), u = fx - f0;
    // their bones in the world at this moment
    const W = new Array(N);
    for (let b = 0; b < N; b++) { const l = Q.slerp(frameRot(f0, b), frameRot(f1, b), u), pb = B[b].parent; W[b] = pb < 0 ? Q.mul(clip.base.rot, l) : Q.mul(W[pb], l); }
    // ours: a mapped bone turns in the world as theirs turned from its rest, less the rest difference; others follow
    const Wo = new Array(n), q = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) {
      const name = rig.bones[k].name, p = rig.bones[k].parent, pw = p < 0 ? [0, 0, 0, 1] : Wo[p];
      if (src[name] !== undefined) { const s = src[name], d = Q.mul(G, Q.mul(Q.mul(W[s], restWi[s]), Gi)); Wo[k] = Q.mul(d, Q.inv(fix[name])); }
      else Wo[k] = pw;
      q.set(Q.mul(Q.inv(pw), Wo[k]), k * 4);
    }
    const h0 = hipAt(f0), h1 = hipAt(f1); let root = [0, 1, 2].map((c) => h0[c] + (h1[c] - h0[c]) * u);
    if (mode === 'inplace') { const k = dur > 0 ? x / dur : 0; root = [root[0] - t0[0] - travel[0] * k, root[1], root[2] - t0[2] - travel[2] * k]; }
    else root = [root[0] - t0[0], root[1], root[2] - t0[2]];
    return { root, q, world: () => poseWorld(rig, root, q) };
  }
  return { sample, duration: dur, speed, travel, scale, map: src, loop };
}
