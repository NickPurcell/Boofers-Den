// The clip player (sections/guitar-goblin/human-base/clips.js): a clip of our own (tests/human-base/test-clip.mjs), as
// BVH text and as a GLB, mapped onto our skeleton. Our limbs must point where the clip's point; the hips' travel is taken
// out (or kept) and becomes a speed; bad files are refused with a plain error, never a crash or a hang.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const HB = join(__dirname, "..", "sections", "guitar-goblin", "human-base");

async function setup() {
  const D = await import(join(HB, "derive.js")), M = await import(join(HB, "motion.js")), C = await import(join(HB, "clips.js")), T = await import(join(__dirname, "human-base", "test-clip.mjs"));
  const ab = (f) => { const b = readFileSync(join(HB, "data", f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const B = D.decode(JSON.parse(readFileSync(join(HB, "data", "mesh.json"), "utf8")), ab("mesh.bin"), ab("targets.bin"), ab("skin.bin"), ab("bones.bin"));
  let lo = Infinity; for (let i = 0; i < B.N; i++) if (B.inBody[i]) lo = Math.min(lo, B.rest[i * 3 + 1]);
  const sk = B.skeleton.bones.map((b) => { const c = [0, 0, 0]; for (const i of b.head) for (let k = 0; k < 3; k++) c[k] += B.rest[i * 3 + k] / b.head.length; c[1] -= lo; return { name: b.name, parent: b.parent, head: c.map((x) => x * 0.1) }; });
  return { M, C, T, rig: M.makeRig(sk) };
}
const dir = (a, b) => { const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d); return d.map((x) => x / l); };
const angle = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) / (Math.PI / 180);
const LIMBS = [["upperarm01.R", "lowerarm01.R", "RightArm", "RightForeArm"], ["lowerarm01.L", "wrist.L", "LeftForeArm", "LeftHand"], ["upperleg01.L", "lowerleg01.L", "LeftUpLeg", "LeftLeg"],
  ["lowerleg01.L", "foot.L", "LeftLeg", "LeftFoot"], ["upperarm01.L", "lowerarm01.L", "LeftArm", "LeftForeArm"]];

for (const kind of ["bvh", "glb"]) {
  test(`a ${kind} clip: the bones are found by name, and our limbs point where the clip's do`, async () => {
    const { C, T, rig } = await setup();
    const clip = kind === "bvh" ? C.parseBVH(T.bvh()) : C.parseGLB(T.glb());
    assert.equal(clip.bones.length, 22);
    const map = C.guessMap(clip);
    for (const [ours, theirs] of Object.entries({ root: "Hips", spine05: "LowerBack", spine01: "Spine1", neck01: "Neck", head: "Head", "upperarm01.R": "RightArm", "lowerarm01.L": "LeftForeArm", "wrist.L": "LeftHand", "upperleg01.L": "LeftUpLeg", "lowerleg01.R": "RightLeg", "foot.L": "LeftFoot", "toe3-1.R": "RightToeBase", "clavicle.L": "LeftShoulder" }))
      assert.equal(map[ours], theirs, ours);
    const play = C.retarget(clip, rig, { root: "inplace" });
    assert.ok(Math.abs(play.duration - 1) < 1e-6);
    let worst = 0;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const W = play.sample(Math.min(t, 0.999)).world(), truth = T.truth(Math.min(t, 0.999));
      for (const [a, b, sa, sb] of LIMBS) worst = Math.max(worst, angle(dir(W.P[rig.at[a]], W.P[rig.at[b]]), dir(truth[sa], truth[sb])));
    }
    assert.ok(worst < 4, `a limb points ${worst.toFixed(1)}° away from the clip's`);
    // the trunk keeps its own shape and takes the clip's turns: the chest leans as far as the clip's does
    const W0 = play.sample(0).world(), W1 = play.sample(0.999).world(), t0 = T.truth(0), t1 = T.truth(0.999);
    const ours = angle(dir(W0.P[rig.at.spine01], W0.P[rig.at.neck01]), dir(W1.P[rig.at.spine01], W1.P[rig.at.neck01])), theirs = angle(dir(t0.Spine1, t0.Neck), dir(t1.Spine1, t1.Neck));
    assert.ok(Math.abs(ours - theirs) < 2, `the chest leans ${ours.toFixed(1)}° against the clip's ${theirs.toFixed(1)}°`);
  });
}

test("the hips: their travel is taken out and becomes a speed, or kept; the rise and fall is kept, in our size", async () => {
  const { C, T, rig } = await setup(), clip = C.parseBVH(T.bvh());
  const inplace = C.retarget(clip, rig, { root: "inplace" }), keep = C.retarget(clip, rig, { root: "keep" });
  // the BVH is in centimetres: its scale takes them to our metres and our size (a 0.98 m hip to ours)
  const s = inplace.scale * 100; assert.ok(s > 0.8 && s < 1.1, `scaled by ${s}`);
  assert.ok(Math.abs(inplace.speed - 1 * s) < 0.02, `speed ${inplace.speed}`);
  assert.ok(Math.abs(keep.travel[2] - 1 * s) < 0.02 && Math.abs(keep.travel[0]) < 1e-6);
  const g = C.retarget(C.parseGLB(T.glb()), rig, { root: "inplace" });
  assert.ok(Math.abs(g.speed - inplace.speed) < 0.01, "the GLB's armature scale is the same metres");
  for (const t of [0, 0.3, 0.5, 0.9]) {
    const a = inplace.sample(t).root, b = keep.sample(t).root;
    assert.ok(Math.abs(a[2]) < 1e-3, "in place: no travel");
    assert.ok(Math.abs(b[2] - t * s) < 0.02, "kept: the travel so far");
    assert.ok(Math.abs(a[1] - b[1]) < 1e-9);
  }
  const rise = inplace.sample(0.5).root[1] - inplace.sample(0).root[1];
  assert.ok(Math.abs(rise - 0.05 * s) < 0.005, `the rise ${rise}`);
  assert.ok(Math.abs(inplace.sample(0).root[1]) < 0.02, "standing at the start: our hips where they are bound");
});

test("bad clip files are refused with a plain error", async () => {
  const { C, T } = await setup(), good = T.bvh();
  const bad = [null, 42, "", "HIERARCHY", good.replace("Frames: 31", "Frames: 99999999"), good.replace("Frame Time: 0.03333333333333333", "Frame Time: -1"), good.replace("OFFSET 0 10 0", "OFFSET 0 NaN 0"),
    good.replace("CHANNELS 3", "CHANNELS 300"), good.replace("Zrotation", "Wrotation"), good.replace("JOINT LowerBack", "JOINT <script>"), good.slice(0, good.length - 400), "HIERARCHY ROOT " + "x { OFFSET 0 0 0 CHANNELS 0 JOINT ".repeat(300)];
  for (const b of bad) assert.throws(() => C.parseBVH(b), C.ClipError, String(b).slice(0, 40));
  const glb = new Uint8Array(T.glb());
  const flip = (k, v) => { const c = glb.slice(); c[k] = v; return c.buffer; };
  for (const b of [new ArrayBuffer(4), flip(0, 0), flip(4, 9), glb.slice(0, 40).buffer]) assert.throws(() => C.parseGLB(b), (e) => e instanceof C.ClipError || e instanceof SyntaxError);
  // a JSON that points a track past its buffer
  const j = { asset: { version: "2.0" }, nodes: [{ name: "Hips" }], skins: [{ joints: [0] }], animations: [{ samplers: [{ input: 0, output: 1 }], channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }], accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: "SCALAR" }, { bufferView: 0, componentType: 5126, count: 99, type: "VEC4" }] };
  assert.throws(() => C.parseGLTF(j, new ArrayBuffer(8)), C.ClipError);
  assert.throws(() => C.parseGLTF({ ...j, skins: [{ joints: ["__proto__"] }] }, new ArrayBuffer(8)), C.ClipError);
  assert.equal({}.polluted, undefined);
});
