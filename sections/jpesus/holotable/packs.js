/* Reads asset packs in the browser, so big packs never have to fit in one upload.
 *  - Dungeondraft packs (.dungeondraft_pack): Godot "GDPC" pack files, format v1 and v2
 *  - .zip files of images (stored or deflated entries)
 *  - single images
 * PackReader.read(file, onProgress) -> { name, author, items: [{ n, c, w, h, type, data (base64) }] }
 * Images are re-encoded as WebP when that is smaller (most props shrink a lot); the original
 * width/height are kept so props still land at Dungeondraft's 256 px-per-square scale. */
(function (root) {
  const IMG = /\.(png|jpe?g|webp|gif)$/i;
  const MAX_DIM = 4096;

  function category(path) {
    const low = path.toLowerCase();
    const m = /textures\/([^/]+)\//.exec(low);
    if (m) return ({ objects: 'props', terrain: 'terrain', walls: 'walls', paths: 'paths', portals: 'doors', tilesets: 'tilesets',
      lights: 'lights', caves: 'terrain', materials: 'terrain', roofs: 'roofs', patterns: 'terrain' })[m[1]] || m[1];
    for (const [k, c] of [['token', 'tokens'], ['portrait', 'tokens'], ['map', 'maps'], ['terrain', 'terrain'], ['floor', 'terrain'], ['texture', 'terrain'], ['tile', 'terrain']])
      if (low.includes(k)) return c;
    return 'props';
  }
  const baseName = p => p.split('/').pop().replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  const typeOf = p => ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' })[p.split('.').pop().toLowerCase()];

  function readGdpc(buf) {
    const dv = new DataView(buf), td = new TextDecoder();
    if (td.decode(new Uint8Array(buf, 0, 4)) !== 'GDPC') throw new Error('Not a Dungeondraft pack (bad header).');
    let o = 4;
    const ver = dv.getUint32(o, true); o += 16;
    let flags = 0, base = 0;
    if (ver >= 2) { flags = dv.getUint32(o, true); base = Number(dv.getBigUint64(o + 4, true)); o += 12; if (flags & 1) throw new Error('Encrypted packs are not supported.'); }
    o += 64;
    const count = dv.getUint32(o, true); o += 4;
    if (count > 200000) throw new Error('The pack index looks damaged.');
    const files = [];
    for (let i = 0; i < count; i++) {
      const len = dv.getUint32(o, true); o += 4;
      const path = td.decode(new Uint8Array(buf, o, len)).replace(/\0+$/, '').replace(/^res:\/\//, ''); o += len;
      let off = Number(dv.getBigUint64(o, true)); const size = Number(dv.getBigUint64(o + 8, true)); o += 32;
      if (ver >= 2) { o += 4; if (flags & 2) off += base; }
      files.push({ path, off, size });
    }
    const meta = {}, out = [];
    for (const f of files) {
      if (f.path.endsWith('pack.json')) { try { Object.assign(meta, JSON.parse(td.decode(new Uint8Array(buf, f.off, f.size)))); } catch { /* ignore */ } }
      else if (IMG.test(f.path)) out.push({ path: f.path.replace(/^packs\/[^/]+\//, ''), bytes: new Uint8Array(buf, f.off, f.size) });
    }
    return { meta, files: out };
  }

  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function readZip(buf) {
    const dv = new DataView(buf), td = new TextDecoder();
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('That zip file is damaged.');
    const n = dv.getUint16(eocd + 10, true);
    let o = dv.getUint32(eocd + 16, true);
    const meta = {}, out = [];
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(o, true) !== 0x02014b50) break;
      const method = dv.getUint16(o + 10, true), csize = dv.getUint32(o + 20, true);
      const nl = dv.getUint16(o + 28, true), xl = dv.getUint16(o + 30, true), cl = dv.getUint16(o + 32, true), lho = dv.getUint32(o + 42, true);
      const name = td.decode(new Uint8Array(buf, o + 46, nl));
      o += 46 + nl + xl + cl;
      const wanted = IMG.test(name) || /pack\.json$/i.test(name);
      if (!wanted || name.includes('__MACOSX') || name.endsWith('/')) continue;
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = new Uint8Array(buf, start, csize);
      const bytes = method === 0 ? raw : method === 8 ? await inflateRaw(raw) : null;
      if (!bytes) continue;
      if (/pack\.json$/i.test(name)) { try { Object.assign(meta, JSON.parse(td.decode(bytes))); } catch { /* ignore */ } }
      else out.push({ path: name, bytes });
    }
    return { meta, files: out };
  }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  // decode, measure, maybe shrink / convert to WebP
  async function prepare(bytes, type) {
    const blob = new Blob([bytes], { type });
    let bmp;
    try { bmp = await createImageBitmap(blob); } catch { return null; }
    const w = bmp.width, h = bmp.height;
    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
    let outBlob = blob;
    try {
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const webp = await new Promise(r => c.toBlob(r, 'image/webp', 0.86));
      if (webp && webp.type === 'image/webp' && (webp.size < blob.size || scale < 1)) outBlob = webp;
    } catch { /* keep original */ }
    bmp.close && bmp.close();
    return { w, h, type: outBlob.type, data: toBase64(new Uint8Array(await outBlob.arrayBuffer())) };
  }

  async function read(file, onProgress = () => {}) {
    const lname = file.name.toLowerCase();
    let parsed;
    if (/\.(dungeondraft_pack|pck)$/.test(lname)) parsed = readGdpc(await file.arrayBuffer());
    else if (lname.endsWith('.zip')) parsed = await readZip(await file.arrayBuffer());
    else if (IMG.test(lname)) parsed = { meta: { name: 'Uploaded images' }, files: [{ path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }] };
    else throw new Error('Use a .dungeondraft_pack, a .zip of images, or an image.');
    if (!parsed.files.length) throw new Error('No images found in that file.');
    const items = [];
    for (let i = 0; i < parsed.files.length; i++) {
      const f = parsed.files[i];
      onProgress(i, parsed.files.length);
      const p = await prepare(f.bytes, typeOf(f.path) || 'image/png');
      if (p) items.push(Object.assign({ n: baseName(f.path), c: category(f.path) }, p));
    }
    onProgress(parsed.files.length, parsed.files.length);
    return { name: String(parsed.meta.name || file.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ')), author: String(parsed.meta.author || ''), items };
  }

  root.PackReader = { read, category };
})(window);
