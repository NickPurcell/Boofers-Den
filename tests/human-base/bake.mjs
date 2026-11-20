// Bake the human base's derived tables (landmarks, regions, hand mask, eye rings, the Pureblood's ridges and roots)
// from the data files with human-base/derive.js, the one place that derives them, into data/derived.json.
// Usage: node bake.mjs DATA_DIR            write DATA_DIR/derived.json
//        node bake.mjs DATA_DIR --check    exit 1 if the shipped table differs from a fresh derivation
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = resolve(process.argv[2]), check = process.argv.includes('--check');
const { decode, deriveAll, pack, unpack } = await import(pathToFileURL(join(dir, '..', 'derive.js')).href);
const ab = (f) => { const b = readFileSync(join(dir, f)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const B = decode(JSON.parse(readFileSync(join(dir, 'mesh.json'), 'utf8')), ab('mesh.bin'), ab('targets.bin'), ab('skin.bin'));
const t0 = performance.now(), D = deriveAll(B), ms = Math.round(performance.now() - t0);
const fresh = JSON.stringify(pack(D));
if (!check) { writeFileSync(join(dir, 'derived.json'), fresh); console.log(`derived.json: ${fresh.length} bytes, derived in ${ms} ms, fingerprint ${D.fingerprint}`); process.exit(0); }
// compare: the same fingerprint, and every value within float rounding
const shipped = unpack(JSON.parse(readFileSync(join(dir, 'derived.json'), 'utf8'))), diffs = [];
const cmp = (a, b, path) => {
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) { const x = Array.from(a ?? []), y = Array.from(b ?? []); if (x.length !== y.length) return diffs.push(`${path}: length ${x.length} vs ${y.length}`); for (let i = 0; i < x.length; i++) if (Math.abs(x[i] - y[i]) > 1e-5) return diffs.push(`${path}[${i}]: ${x[i]} vs ${y[i]}`); return; }
  if (Array.isArray(a)) { if (!Array.isArray(b) || a.length !== b.length) return diffs.push(`${path}: array length`); a.forEach((v, i) => cmp(v, b[i], `${path}[${i}]`)); return; }
  if (a && typeof a === 'object') { const ka = Object.keys(a).sort(), kb = Object.keys(b || {}).sort(); if (ka.join() !== kb.join()) return diffs.push(`${path}: keys ${ka} vs ${kb}`); for (const k of ka) cmp(a[k], b[k], `${path}.${k}`); return; }
  if (typeof a === 'number' ? Math.abs(a - b) > 1e-6 : a !== b) diffs.push(`${path}: ${a} vs ${b}`);
};
cmp(unpack(JSON.parse(fresh)), shipped, 'derived');
if (diffs.length) { console.error(`derived.json does not match the mesh: ${diffs.length} differences, first: ${diffs.slice(0, 5).join('; ')}`); process.exit(1); }
console.log('derived.json matches a fresh derivation');
