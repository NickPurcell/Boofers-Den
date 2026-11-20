// A small clip of our own, for testing the clip player (human-base/clips.js): a T-pose skeleton in centimetres with the
// common bone names, y up, facing +z, 31 frames over a second. The hips travel 1 m forward and rise 5 cm; the right arm swings
// round to point forward; the left elbow bends forward; the left thigh lifts and its knee bends; the trunk leans; the head
// turns. The same motion is written as BVH text and as a GLB (an armature node scaling centimetres to metres), and
// truth(t) gives where every joint is, so a test can compare what our figure does with what the clip asks for.
const D = Math.PI / 180;
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qaxis = (ax, a) => [ax[0] * Math.sin(a / 2), ax[1] * Math.sin(a / 2), ax[2] * Math.sin(a / 2), Math.cos(a / 2)];
const qrot = (q, v) => { const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x]; };

// name, parent, offset (cm), end site
const S = [
  ['Hips', -1, [0, 0, 0]], ['LowerBack', 0, [0, 10, 0]], ['Spine', 1, [0, 15, 0]], ['Spine1', 2, [0, 15, 0]], ['Neck', 3, [0, 12, 0]], ['Head', 4, [0, 10, 0], [0, 18, 0]],
  ['LeftShoulder', 3, [4, 10, 0]], ['LeftArm', 6, [14, 0, 0]], ['LeftForeArm', 7, [28, 0, 0]], ['LeftHand', 8, [25, 0, 0], [15, 0, 0]],
  ['RightShoulder', 3, [-4, 10, 0]], ['RightArm', 10, [-14, 0, 0]], ['RightForeArm', 11, [-28, 0, 0]], ['RightHand', 12, [-25, 0, 0], [-15, 0, 0]],
  ['LeftUpLeg', 0, [9, -5, 0]], ['LeftLeg', 14, [0, -45, 0]], ['LeftFoot', 15, [0, -42, 0]], ['LeftToeBase', 16, [0, -6, 13], [0, 0, 6]],
  ['RightUpLeg', 0, [-9, -5, 0]], ['RightLeg', 18, [0, -45, 0]], ['RightFoot', 19, [0, -42, 0]], ['RightToeBase', 20, [0, -6, 13], [0, 0, 6]],
];
export const BONES = S.map(([name]) => name);
const F = 31, FT = 1 / 30;
// each joint's turn at time t, as Euler degrees in the order Z, X, Y (BVH's usual), and the hips' place (cm)
export function anglesAt(t) {
  const a = Object.fromEntries(BONES.map((n) => [n, [0, 0, 0]]));
  a.RightArm = [0, 0, 90 * t]; a.LeftForeArm = [0, 0, -90 * t]; a.LeftUpLeg = [0, -40 * t, 0]; a.LeftLeg = [0, 60 * t, 0];
  a.Spine1 = [10 * t, 15 * t, 0]; a.Head = [0, 0, 20 * t];
  return { a, hips: [0, 98 + 5 * Math.sin(Math.PI * t) ** 2, 100 * t] };
}
const quatOf = ([z, x, y]) => qmul(qmul(qaxis([0, 0, 1], z * D), qaxis([1, 0, 0], x * D)), qaxis([0, 1, 0], y * D));
// where every joint is at time t (metres, our frame: y up, facing +z), and where each limb points
export function truth(t) {
  const { a, hips } = anglesAt(t), W = [], P = [];
  S.forEach(([name, p, off], k) => {
    const q = quatOf(a[name]);
    if (p < 0) { W[k] = q; P[k] = hips.map((v) => v / 100); }
    else { W[k] = qmul(W[p], q); const o = qrot(W[p], off.map((v) => v / 100)); P[k] = [P[p][0] + o[0], P[p][1] + o[1], P[p][2] + o[2]]; }
  });
  return Object.fromEntries(BONES.map((n, k) => [n, P[k]]));
}
export function bvh() {
  let s = 'HIERARCHY\n';
  const kids = (k) => S.map((b, j) => (b[1] === k ? j : -1)).filter((j) => j >= 0);
  const joint = (k, pad) => {
    const [name, p, off, tip] = S[k];
    s += `${pad}${p < 0 ? 'ROOT' : 'JOINT'} ${name}\n${pad}{\n${pad}  OFFSET ${off.join(' ')}\n${pad}  CHANNELS ${p < 0 ? '6 Xposition Yposition Zposition ' : '3 '}Zrotation Xrotation Yrotation\n`;
    for (const j of kids(k)) joint(j, pad + '  ');
    if (tip) s += `${pad}  End Site\n${pad}  {\n${pad}    OFFSET ${tip.join(' ')}\n${pad}  }\n`;
    s += `${pad}}\n`;
  };
  joint(0, '');
  s += `MOTION\nFrames: ${F}\nFrame Time: ${FT}\n`;
  for (let f = 0; f < F; f++) { const { a, hips } = anglesAt(f * FT), row = []; S.forEach(([name, p], k) => { if (p < 0) row.push(...hips); row.push(...a[name]); }); s += row.map((v) => +v.toFixed(5)).join(' ') + '\n'; }
  return s;
}
// the same as a GLB: joints in centimetres under an armature node scaled 0.01, rotation tracks for every joint and the
// hips' translation
export function glb() {
  const times = Float32Array.from({ length: F }, (_, f) => f * FT), chunks = [], views = [], accs = [];
  const addAcc = (arr, type) => { const off = chunks.reduce((s, c) => s + c.byteLength, 0); chunks.push(new Uint8Array(arr.buffer)); views.push({ buffer: 0, byteOffset: off, byteLength: arr.byteLength }); accs.push({ bufferView: views.length - 1, componentType: 5126, count: arr.length / { SCALAR: 1, VEC3: 3, VEC4: 4 }[type], type }); return accs.length - 1; };
  const tIn = addAcc(times, 'SCALAR');
  const nodes = [{ name: 'Armature', scale: [0.01, 0.01, 0.01], children: [1] }], samplers = [], channels = [];
  S.forEach(([name, p, off], k) => nodes.push({ name, translation: p < 0 ? anglesAt(0).hips : off, children: S.map((b, j) => (b[1] === k ? j + 1 : -1)).filter((j) => j >= 0) }));
  S.forEach(([name, p], k) => {
    const r = new Float32Array(F * 4); for (let f = 0; f < F; f++) r.set(quatOf(anglesAt(f * FT).a[name]), f * 4);
    samplers.push({ input: tIn, output: addAcc(r, 'VEC4'), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: k + 1, path: 'rotation' } });
    if (p < 0) { const tr = new Float32Array(F * 3); for (let f = 0; f < F; f++) tr.set(anglesAt(f * FT).hips, f * 3); samplers.push({ input: tIn, output: addAcc(tr, 'VEC3'), interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node: k + 1, path: 'translation' } }); }
  });
  const binLen = chunks.reduce((s, c) => s + c.byteLength, 0), bin = new Uint8Array(binLen); let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
  const json = { asset: { version: '2.0' }, nodes, skins: [{ joints: S.map((_, k) => k + 1) }], animations: [{ name: 'test', samplers, channels }], buffers: [{ byteLength: binLen }], bufferViews: views, accessors: accs, scenes: [{ nodes: [0] }] };
  const js = new TextEncoder().encode(JSON.stringify(json)), jl = Math.ceil(js.length / 4) * 4, bl = Math.ceil(binLen / 4) * 4;
  const out = new Uint8Array(12 + 8 + jl + 8 + bl), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true); out.fill(0x20, 20, 20 + jl); out.set(js, 20);
  dv.setUint32(20 + jl, bl, true); dv.setUint32(24 + jl, 0x004e4942, true); out.set(bin, 28 + jl);
  return out.buffer;
}
