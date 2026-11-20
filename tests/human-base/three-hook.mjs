// For node scripts that import the creator's modules: the bare 'three' resolves to the vendored copy, as the pages'
// import map does. Usage: node --import ./tests/human-base/three-hook.mjs SCRIPT
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const three = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sections', 'guitar-goblin', 'vendor', 'three', 'three.module.min.js')).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { return s === 'three' ? { url: ${JSON.stringify(three)}, shortCircuit: true } : next(s, c); }`));
