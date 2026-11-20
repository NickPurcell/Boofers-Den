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
  // a blow lands within the clip (this one swings at an even pace, so anywhere in it), and a given mark wins
  assert.ok(inplace.marks.impact > 0 && inplace.marks.impact <= 1, `impact at ${inplace.marks.impact}`);
  assert.equal(C.retarget(clip, rig, { marks: { impact: 0.4 } }).marks.impact, 0.4);
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

test("a clip shipped in our own form plays as the clip did", async () => {
  const { C, T, rig } = await setup(), clip = C.parseBVH(T.bvh()), direct = C.retarget(clip, rig, { root: "keep" });
  const json = JSON.parse(JSON.stringify(C.packClip(C.compact(clip, rig.bones))));
  const shipped = C.play(C.unpackClip(json), rig, { root: "keep" });
  let worst = 0, rootErr = 0;
  for (const t of [0, 0.2, 0.55, 0.9]) {
    const a = direct.sample(t), b = shipped.sample(t);
    for (let i = 0; i < a.q.length; i += 4) { const d = Math.abs(a.q[i] * b.q[i] + a.q[i + 1] * b.q[i + 1] + a.q[i + 2] * b.q[i + 2] + a.q[i + 3] * b.q[i + 3]); worst = Math.max(worst, 2 * Math.acos(Math.min(1, d)) / (Math.PI / 180)); }
    rootErr = Math.max(rootErr, Math.hypot(...a.root.map((v, k) => v - b.root[k])));
  }
  assert.ok(worst < 0.5, `a bone turns ${worst.toFixed(2)}° off`);
  assert.ok(rootErr < 0.002, `the hips are ${rootErr} m off`);
  for (const bad of [{}, { ...json, v: 2 }, { ...json, frames: 1e9 }, { ...json, bones: ["__proto__"] }, { ...json, d: json.d.slice(8) }, { ...json, fps: -1 }])
    assert.throws(() => C.unpackClip(bad), C.ClipError);
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

test("the shipped clips: each one unpacks and plays on our skeleton, and the NOTICE names where they came from", async () => {
  const { C, rig } = await setup(), DATA = join(HB, "data"), J = JSON.parse(readFileSync(join(DATA, "clips.json"), "utf8"));
  assert.match(J.source.repo, /^https:\/\/github\.com\/Mesh2Motion\//);
  assert.match(J.source.commit, /^[0-9a-f]{40}$/);
  const notice = readFileSync(join(DATA, "NOTICE.md"), "utf8");
  assert.ok(notice.includes(J.source.commit), "the NOTICE names the commit");
  assert.ok(notice.includes("CC0 1.0 Universal"));
  const names = Object.keys(J.clips); assert.ok(names.length >= 6);
  for (const n of names) {
    const c = J.clips[n]; assert.ok(notice.includes(c.from), `the NOTICE names ${c.from}`);
    const p = C.play(C.unpackClip(c), rig, { root: c.root });
    assert.ok(p.duration > 0);
    for (const t of [0, p.duration / 2, p.duration]) {
      const s = p.sample(t); assert.ok(s.q.every(Number.isFinite) && s.root.every(Number.isFinite), n);
      const W = s.world(); const head = W.P[rig.at.head][1]; assert.ok(head > 0.5 && head < 2.4, `${n}: the head at ${head} m`);
    }
  }
  assert.ok(C.play(C.unpackClip(J.clips.jog), rig, { root: "inplace" }).speed > 1, "the jog has a ground speed");
});

test("the shipped jog: a planted foot holds within 2 cm through each stance at the clip's speed, and the loop has no seam", async () => {
  const { C, rig } = await setup(), J = JSON.parse(readFileSync(join(HB, "data", "clips.json"), "utf8"));
  const p = C.play(C.unpackClip(J.clips.jog), rig, { root: "inplace" }), T = p.duration, N = 240;
  assert.ok(p.speed > 1, `speed ${p.speed}`);
  // each foot's ball, with the ground moving back under it at p.speed: while it is down it should stay put
  const ground = Math.min(...Array.from({ length: 60 }, (_, i) => { const W = p.sample((i / 60) * T).world(); return Math.min(W.P[rig.at["toe3-1.L"]][1], W.P[rig.at["toe3-1.R"]][1]); }));
  let worst = 0, stances = 0;
  for (const s of ["L", "R"]) {
    let run = null;
    for (let i = 0; i <= 2 * N; i++) {
      const t = (i / N) * T, W = p.sample(t).world(), b = W.P[rig.at["toe3-1." + s]], down = b[1] < ground + 0.03, z = b[2] + p.speed * t;
      if (down) { if (!run) { run = { z0: z, x0: b[0], n: 0 }; stances++; } run.n++; worst = Math.max(worst, Math.hypot(z - run.z0, b[0] - run.x0)); } else run = null;
    }
  }
  assert.ok(stances >= 2, "the feet come down");
  if (process.env.SHOW) console.log(`jog: ${p.speed.toFixed(2)} m/s, ${stances} stances, drift ${(worst * 100).toFixed(2)} cm`);
  assert.ok(worst < 0.02, `a planted foot drifts ${(worst * 100).toFixed(1)} cm`);
  // the loop's seam: the last moment and the first are the same pose
  const a = p.sample(T - 1e-4), b = p.sample(0); let seam = 0;
  for (let i = 0; i < a.q.length; i += 4) seam = Math.max(seam, 2 * Math.acos(Math.min(1, Math.abs(a.q[i] * b.q[i] + a.q[i + 1] * b.q[i + 1] + a.q[i + 2] * b.q[i + 2] + a.q[i + 3] * b.q[i + 3]))) / (Math.PI / 180));
  assert.ok(seam < 8, `the loop jumps ${seam.toFixed(1)}° at its seam`);
});
