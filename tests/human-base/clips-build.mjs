// Build sections/guitar-goblin/human-base/data/clips.json: animation clips of CC0 data, mapped onto our skeleton once,
// here, so a page ships only our compact form and our player (human-base/clips.js). Our own script.
//
// The source: Mesh2Motion's human animations (github.com/Mesh2Motion/mesh2motion-app, static/assets/human/animations/,
// CC0 1.0 per the repository's LICENSE-CC0.MD), fetched at a pinned commit into a folder of their own and read as
// untrusted data. Their GLBs pack their tracks with EXT_meshopt_compression; unpacking it needs meshoptimizer's decoder
// (MIT, github.com/zeux/meshoptimizer), used here at build time only and never shipped:
//   npm install --ignore-scripts meshoptimizer   (in a tools folder of its own)
// Usage: node tests/human-base/clips-build.mjs SRC_DIR MESHOPT_DIR [--check]
//   SRC_DIR: the fetched .glb files; MESHOPT_DIR: the folder holding node_modules/meshoptimizer
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sections', 'guitar-goblin', 'human-base'), OUT = join(HB, 'data', 'clips.json');
const [SRC, MO] = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((p) => resolve(p)), check = process.argv.includes('--check');
const C = await import(pathToFileURL(join(HB, 'clips.js')).href);
const { MeshoptDecoder } = await import(pathToFileURL(join(MO, 'node_modules', 'meshoptimizer', 'meshopt_decoder.mjs')).href);
await MeshoptDecoder.ready;

export const SOURCE = { repo: 'https://github.com/Mesh2Motion/mesh2motion-app', commit: '1632e1a7e009600500d436628075aa3a0e8b36ac', path: 'static/assets/human/animations/', licence: 'CC0 1.0 Universal (LICENSE-CC0.MD: "All 3d models, blend files, rigs, animations")' };
// what we ship, under our own names: their file, and how it plays (in place and looping, or once, keeping its travel).
// Judged on our figures before shipping; left out: hit-knockback.glb (its last frames put a foot half a metre through
// the floor), jog.glb is kept as a "charge" (our own run() is the default move)
export const CLIPS = {
  idle: { file: 'idle-a.glb', root: 'inplace' },
  'idle-fight': { file: 'fighting-idle.glb', root: 'inplace' },
  jog: { file: 'jog.glb', root: 'inplace' },
  'sword-a': { file: 'sword-regular-a.glb', root: 'keep' },
  'sword-a-rec': { file: 'sword-regular-a-rec.glb', root: 'keep' },
  'spell-enter': { file: 'spell-simple-enter.glb', root: 'keep' },
  'spell-shoot': { file: 'spell-simple-shoot.glb', root: 'keep' },
  'spell-exit': { file: 'spell-simple-exit.glb', root: 'keep' },
  'two-hand-swing': { file: 'two-handed-horizontal-swing.glb', root: 'keep' },
  'two-hand-slam': { file: 'two-handed-overhead-slam.glb', root: 'keep' },
  'staff-combo': { file: 'staff-combo.glb', root: 'keep' },
  'staff-spin': { file: 'staff-spin.glb', root: 'keep' },
  'pistol-shoot': { file: 'pistol-shoot.glb', root: 'keep' },
  'rifle-fire': { file: 'rifle-fire.glb', root: 'keep' },
  'power-burst': { file: 'power-burst.glb', root: 'keep' },
  'force-blast': { file: 'two-hand-blast.glb', root: 'keep' },
  'hit-chest': { file: 'hit-chest.glb', root: 'keep' },
  'hit-head': { file: 'hit-head.glb', root: 'keep' },
  'death': { file: 'death-a.glb', root: 'keep' },
  'dodge': { file: 'dodge-left.glb', root: 'keep' },
  'block': { file: 'sword-block.glb', root: 'keep' },
  walk: { file: 'walk.glb', root: 'inplace' },
};

// a GLB, its meshopt-packed buffer views unpacked into one plain buffer
function readGLB(path) {
  const b = readFileSync(path); if (b.length > 32e6) throw new Error('too big: ' + path);
  const buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(4, true) !== 2) throw new Error('not a glTF 2 binary: ' + path);
  let at = 12, json = null, bin = null;
  while (at + 8 <= buf.byteLength) { const len = dv.getUint32(at, true), type = dv.getUint32(at + 4, true); if (at + 8 + len > buf.byteLength) throw new Error('a chunk runs past the end'); if (type === 0x4e4f534a && !json) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, at + 8, len))); else if (type === 0x004e4942 && !bin) bin = new Uint8Array(buf, at + 8, len); at += 8 + len + ((4 - (len % 4)) % 4); }
  const allowed = new Set(['EXT_meshopt_compression']);
  for (const e of json.extensionsRequired || []) if (!allowed.has(e)) throw new Error('needs an extension we do not read: ' + e);
  const parts = [], views = (json.bufferViews || []).map((v) => {
    const ext = v.extensions && v.extensions.EXT_meshopt_compression;
    let bytes;
    if (ext) {
      if (ext.buffer !== 0 || !bin) throw new Error('packed data outside the GLB');
      const count = ext.count, size = ext.byteStride, src = bin.subarray(ext.byteOffset || 0, (ext.byteOffset || 0) + ext.byteLength);
      if (!(count > 0 && count < 1e6 && size > 0 && size <= 256 && src.length === ext.byteLength)) throw new Error('a bad packed view');
      bytes = new Uint8Array(count * size); MeshoptDecoder.decodeGltfBuffer(bytes, count, size, src, ext.mode, ext.filter || 'NONE');
    } else {
      if (v.buffer !== 0 || !bin) throw new Error('a view outside the GLB');
      bytes = bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    }
    const off = parts.reduce((s, p) => s + p.length, 0), pad = (4 - (off % 4)) % 4; if (pad) parts.push(new Uint8Array(pad));
    const o = off + pad; parts.push(bytes);
    return { buffer: 0, byteOffset: o, byteLength: bytes.length, ...(ext && ext.byteStride ? { byteStride: ext.byteStride } : v.byteStride ? { byteStride: v.byteStride } : {}) };
  });
  const total = parts.reduce((s, p) => s + p.length, 0), out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return { json: { ...json, bufferViews: views, buffers: [{ byteLength: total }], extensionsUsed: [], extensionsRequired: [] }, bin: out.buffer };
}

const skeleton = JSON.parse(readFileSync(join(HB, 'data', 'mesh.json'), 'utf8')).skeleton.map((b) => ({ name: b.name, parent: b.parent }));
const out = { source: SOURCE, clips: {} };
for (const [name, c] of Object.entries(CLIPS)) {
  const path = join(SRC, c.file); if (!existsSync(path)) throw new Error('missing ' + path);
  const { json, bin } = readGLB(path), clip = C.parseGLTF(json, bin);
  const k = C.compact(clip, skeleton, {});
  if (c.root !== 'inplace') delete k.marks.ground;   // (a planted foot's speed means something only for a loop made in place)
  out.clips[name] = { from: c.file, root: c.root, ...C.packClip(k) };
  console.log(`${name.padEnd(12)} ${c.file.padEnd(28)} ${k.frames} frames at ${k.fps} fps, ${k.bones.length} bones, impact ${k.marks.impact.toFixed(2)} s, hips travel ${(k.hip[(k.frames - 1) * 3 + 2]).toFixed(2)} hip heights${k.marks.ground ? `, ground ${k.marks.ground.toFixed(2)} hip heights/s` : ''}`);
}
const text = JSON.stringify(out);
if (check) { const old = existsSync(OUT) ? readFileSync(OUT, 'utf8') : ''; if (old !== text) { console.error('clips.json differs from a fresh build'); process.exit(1); } console.log('clips.json matches a fresh build'); }
else { writeFileSync(OUT, text); console.log(`clips.json: ${text.length} bytes, ${Object.keys(out.clips).length} clips`); }
