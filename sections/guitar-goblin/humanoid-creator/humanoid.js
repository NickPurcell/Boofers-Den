// Character creator for the humanoid species (Echani, Sith Pureblood, Mirialan, human): the page.
// One figure carries them all. Its head (head-field.js), body and hands (anatomy.js), hair (hair.js) and clothes
// (outfits.js) are sculpted from signed distance shapes and meshed in workers (jobs.js, on the shared pool); what a
// species adds to the head is in features.js; skin, eyes and hair materials are skin.js; lips, brows, lined eyes and
// tattoos are painted onto one picture wrapped round the head (face-paint.js, tattoos.js). species.js says what each
// people offers. The scene, lights, studio and picture export are the shared stage (../creator-kit/stage.js).
import * as THREE from 'three';
import { makeStage } from '../creator-kit/stage.js';
import { createPool } from '../creator-kit/pool.js';
import { makeTextures, clothMaterial, leatherMaterial, metalMaterial, plasticMaterial } from '../duros-creator/materials.js';
import { skinGeometry, skinMaterial, eyeTexture, eyeGeometries, hairMaterial, lockMaterial, tentacleMaterial, merge } from './skin.js';
import { HEAD_AT } from './anatomy.js';
import { FACES } from './head-field.js';
import { facePainter, WRAP } from './face-paint.js';
import { STYLES } from './hair.js';
import { OUTFITS, HOODS } from './outfits.js';
import { SPECIES, CLOTH, FRAMES, BUILDS, AGES, MARKS, LINERS } from './species.js';
import { tattooMarks } from './tattoos.js';
import { GEAR, makeGear, gearMaterial } from './gear.js';

/* ---------------- the options ---------------- */
const named = (o) => Object.entries(o).map(([key, v]) => ({ key, name: v.name }));
const state = {}, chosen = new Set();   // chosen: what a person picked themselves; the rest follows the species
const sp = () => SPECIES[state.species] || SPECIES.echani;
function options() {
  const S = sp(), o = {
    species: { label: 'Species', items: named(SPECIES) },
    frame: { label: 'Frame', items: FRAMES }, build: { label: 'Build', items: BUILDS }, face: { label: 'Face', items: named(FACES) }, age: { label: 'Age', items: AGES },
    skin: { label: 'Skin', swatch: true, items: S.skins }, eyes: { label: 'Eyes', swatch: true, items: S.eyes },
    style: { label: S.styleLabel || 'Hair', items: S.styles || named(STYLES) }, hair: { label: S.hairLabel || 'Hair colour', swatch: true, items: S.hairs },
    ...S.groups,
  };
  if (state.species !== 'pureblood') o.marks = { label: 'Face detail', items: MARKS };
  o.liner = { label: 'Lined eyes', items: LINERS };
  o.outfit = { label: 'Outfit', items: S.outfits.map((key) => ({ key, name: OUTFITS[key].name })) }; o.hood = { label: 'Hood', items: named(HOODS) };
  o.gear = { label: 'Carries', items: named(GEAR) };
  o.main = { label: 'Main colour', swatch: true, items: CLOTH }; o.second = { label: 'Second colour', swatch: true, items: CLOTH };
  return o;
}
const pick = (opt) => { const it = options()[opt].items; return it.find((o) => o.key === state[opt]) || it[0]; };
const val = (list, key) => (list.find((o) => o.key === key) || list[0]).v;
const setOf = (s, def) => { const ok = def.items.map((o) => o.key); return new Set(String(s || '').split('.').filter((k) => ok.includes(k))); };
// make the state whole for its species: anything missing or not on offer takes the species' own default
function settle(from = {}) {
  const want = from.species ?? state.species;
  state.species = SPECIES[want] ? want : 'echani';
  const defs = sp().defaults, opts = options();
  for (const k of Object.keys(state)) if (k !== 'species' && !opts[k]) delete state[k];
  for (const [k, def] of Object.entries(opts)) {
    if (k === 'species') continue;
    const v = from[k] ?? state[k];
    if (def.multi) state[k] = [...setOf(v ?? defs[k], def)].join('.');
    else state[k] = def.items.some((o) => o.key === v) ? v : def.items.some((o) => o.key === defs[k]) ? defs[k] : def.items[0].key;
  }
}
{ const q = Object.fromEntries(new URLSearchParams(location.hash.slice(1))); for (const k of Object.keys(q)) if (k !== 'species') chosen.add(k); settle(q); }
const writeHash = () => history.replaceState(null, '', '#' + new URLSearchParams(state).toString());

/* ---------------- the stage and the figure ---------------- */
const canvas = document.getElementById('scene'), status = document.getElementById('status');
const stage = makeStage(canvas, { tall: 1.8, minDistance: 0.3, onNoGL: () => { document.getElementById('nogl').hidden = false; } });
makeTextures();
const pool = createPool(new URL('./jobs.js', import.meta.url));
const VIEWS = { whole: { target: [0, 0.9, 0], pos: [1.2, 1.2, 4.0] }, head: { target: [0, 1.61, 0.02], pos: [0.25, 1.65, 0.84] } };
const figure = new THREE.Group(); stage.scene.add(figure);
const face = facePainter(stage.phone ? 1024 : 2048);
const skin = skinMaterial(face.texture), bodySkin = skinMaterial(null), hairMat = hairMaterial();
const lidMat = new THREE.MeshPhysicalMaterial({ roughness: 0.5, sheen: 0.3, sheenRoughness: 0.5 });
const tendrilMat = skinMaterial(null);   // a Mikkian's head-tendrils: skin, painted per vertex
const lockMat = lockMaterial();          // or worn as dreads: matte and fibrous (locked)
const tentMat = tentacleMaterial();      // or smooth and a little glossy, like a tentacle
const eyeMat = new THREE.MeshPhysicalMaterial({ roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04 }), lashMat = new THREE.MeshStandardMaterial({ color: 0x120d0a, roughness: 0.8 });
const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, opacity: 0.85 });
const ringMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.28, emissive: 0xc9a24a, emissiveIntensity: 0.22 });   // a little glow of its own, or polished metal goes black in a dark room
const CLOTHS = { cloth: clothMaterial, leather: leatherMaterial, metal: metalMaterial, plastic: (hex) => { const m = plasticMaterial(hex); m.roughness = 0.46; m.clearcoat = 0.25; return m; } };
const KEEP = new Set([skin, bodySkin, hairMat, lidMat, eyeMat, lashMat, glintMat, ringMat, tendrilMat, lockMat, tentMat, gearMaterial()]);
let built = null, cloth = [], info = {}, ticket = 0, current = Promise.resolve(), eyeKey = '';

function args() {
  const base = { face: state.face, masc: val(FRAMES, state.frame), age: val(AGES, state.age), build: val(BUILDS, state.build), coarse: stage.phone ? 1.2 : 1 };
  const feat = state.species === 'pureblood' ? { species: 'pureblood', spurs: state.spurs, tendrils: state.tendrils, ridges: state.ridges } : {};
  const body = { face: 'oval', masc: base.masc, age: 0.3, build: base.build, coarse: base.coarse };
  return { head: { ...base, ...feat }, bust: base, body, hair: { face: base.face, masc: base.masc, age: 0.3, build: 0.5, coarse: base.coarse, style: state.style, ...(state.species === 'mikkian' ? { species: 'mikkian', thick: state.thick, length: state.length, surface: state.surface, bodyBuild: base.build } : {}) } };
}
// mesher outputs as one (a head meshed in slices)
function joinMeshes(ms) {
  if (ms.length === 1) return ms[0];
  let nv = 0, ni = 0;
  for (const m of ms) { nv += m.ao.length; ni += m.index.length; }
  const out = { position: new Float32Array(nv * 3), normal: new Float32Array(nv * 3), ao: new Float32Array(nv), uv: new Float32Array(nv * 2), index: nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni) };
  let v = 0, i = 0;
  for (const m of ms) {
    out.position.set(m.position, v * 3); out.normal.set(m.normal, v * 3); out.ao.set(m.ao, v); out.uv.set(m.uv, v * 2);
    for (let k = 0; k < m.index.length; k++) out.index[i + k] = m.index[k] + v;
    v += m.ao.length; i += m.index.length;
  }
  return out;
}
const copy = (m) => ({ position: m.position.slice(), normal: m.normal.slice(), uv: m.uv.slice(), index: m.index.slice(), ao: m.ao });
async function rebuild() {
  const my = ++ticket; status.hidden = false; status.textContent = 'Sculpting…';
  pool.cancelQueued();   // whatever was waiting to be meshed for an older choice is no longer wanted
  const A = args(), kB = JSON.stringify(A.body), n = pool.size(), ok = `outfit:${state.outfit}:${state.hood}:${kB}`;
  // the head first, being the longest to mesh, in upright slices shared between the workers, then joined
  const hk = 'head:' + JSON.stringify(A.head), hs = Math.min(3, n);
  if (!pool.cache.has(hk)) pool.keep(hk, Promise.all(Array.from({ length: hs }, (_, part) => pool.mesh('head', { ...A.head, part, of: hs }, hk)))
    .then((rs) => ({ ...rs[0], mesh: joinMeshes(rs.map((x) => x.mesh)) })));
  // a Mikkian's dreads are the next longest: in slices too, joined with their per-vertex values in the same order
  const fk = 'hair:' + JSON.stringify(A.hair), fs = A.hair.species === 'mikkian' && A.hair.style === 'dreads' ? Math.min(3, n) : 1;
  if (!pool.cache.has(fk)) pool.keep(fk, Promise.all(Array.from({ length: fs }, (_, part) => pool.mesh('hair', fs > 1 ? { ...A.hair, part, of: fs } : A.hair, fk))).then((rs) => {
    if (rs.length === 1) return rs[0];
    const cat = (k) => { const arrs = rs.map((x) => x[k]); if (arrs.some((v) => !v)) return null; const out = new Float32Array(arrs.reduce((s, v) => s + v.length, 0)); let o = 0; for (const v of arrs) { out.set(v, o); o += v.length; } return out; };
    return { mesh: joinMeshes(rs.map((x) => x.mesh)), t: cat('t'), d: cat('d') };
  }));
  if (!pool.cache.has(ok)) pool.keep(ok, Promise.all(Array.from({ length: n }, (_, part) => pool.mesh('outfit', { ...A.body, key: state.outfit, hood: state.hood, part, of: n }, ok)))
    .then((rs) => ({ pieces: rs.flatMap((r) => r.pieces).sort((x, y) => x.index - y.index) })));
  let r; const t0 = performance.now();
  try {
    r = await Promise.all([pool.cache.get(hk), pool.cached('bust:' + JSON.stringify(A.bust), 'bust', A.bust), pool.cached('handL:' + kB, 'hand', { ...A.body, side: 1 }), pool.cached('handR:' + kB, 'hand', { ...A.body, side: -1 }),
      pool.cache.get(fk), pool.cache.get(ok)]);
  } catch (e) { if (my !== ticket) return; if (e && e.cancelled) return rebuild(); console.error(e); status.textContent = 'Something went wrong building the figure. Try another choice.'; return; }
  if (my !== ticket) return;   // a newer choice is on its way
  const [head, bust, hl, hr, hair, outfit] = r;
  figure.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && !KEEP.has(o.material)) o.material.dispose(); });
  figure.clear(); cloth = [];
  const add = (g, mat, to = figure) => { const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; to.add(m); return m; };
  add(skinGeometry(copy(head.mesh), { wrap: [WRAP[0], HEAD_AT[1] + WRAP[1], WRAP[2], WRAP[3]] }), skin);
  // where the bust runs up under the head's mesh, tuck it in a hair so the two never fight for the same pixels
  const bm = copy(bust.mesh); for (let i = 0; i < bm.ao.length; i++) if (bm.position[i * 3 + 1] > bust.seamY - 0.004) for (let k = 0; k < 3; k++) bm.position[i * 3 + k] -= bm.normal[i * 3 + k] * 0.0007;
  add(skinGeometry(bm), bodySkin);
  for (const h of [hl, hr]) add(skinGeometry(copy(h.mesh)), bodySkin);
  const hg = new THREE.Group(); hg.position.set(...HEAD_AT); figure.add(hg);
  const eg = eyeGeometries(head.eye, head.lid);
  add(eg.balls, eyeMat, hg).receiveShadow = false; add(eg.lids, lidMat, hg); add(eg.lashes, lashMat, hg);
  { const gl = new THREE.Mesh(eg.glints, glintMat); gl.renderOrder = 2; hg.add(gl); }   // the catchlights cast no shadow
  let mane = null;
  if (hair.mesh && state.hood !== 'up') {   // a raised hood covers the hair
    if (hair.t) mane = { mesh: add(skinGeometry(copy(hair.mesh)), state.style === 'dreads' ? (state.surface === 'locked' ? lockMat : tentMat) : tendrilMat, hg), t: hair.t, d: hair.d, ao: hair.mesh.ao };
    else add(skinGeometry(copy(hair.mesh), { hair: true }), hairMat, hg);
  }
  if (state.jewel && state.jewel !== 'none' && head.tendrils.length) {   // a ring on each tendril
    const rings = head.tendrils.map((t) => {
      const a = new THREE.Vector3(...t.a), b = new THREE.Vector3(...t.b), f = 0.42, at = a.clone().lerp(b, f), rad = t.r0 + (t.r1 - t.r0) * f + 0.0012;
      const g = new THREE.TorusGeometry(rad, 0.0017, 8, 20); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.clone().sub(a).normalize())); g.translate(at.x, at.y, at.z); return g;
    });
    add(merge(rings), ringMat, hg);
  }
  for (const p of outfit.pieces) { const m = add(skinGeometry(copy(p.mesh), { cloth: true }), (CLOTHS[p.material] || clothMaterial)('#777777')); m.name = p.name; cloth.push({ mesh: m, role: p.role }); }
  const gear = makeGear(state.gear, A.body, state.outfit); if (gear) figure.add(gear);
  built = { head, fresh: true, mane };
  let tris = 0; figure.traverse((o) => { if (o.isMesh) tris += o.geometry.index.count / 3; });
  info = { tris, ms: Math.round(performance.now() - t0) };
  while (pool.cache.size > 40) pool.cache.delete(pool.cache.keys().next().value);   // don't keep every figure ever tried
  recolour(); stage.changed(); status.hidden = true;
}
// everything that is only colour: skin, eyes, hair, the face's paint, the clothes
function recolour() {
  if (!built) return;
  const S = sp(), skinHex = pick('skin').c, hairHex = pick('hair').c, c = new THREE.Color(skinHex), liner = Math.min(1, val(LINERS, state.liner) + (S.look.shade || 0));
  bodySkin.color.copy(c); for (const m of [skin, bodySkin]) m.sheenColor.copy(c).lerp(new THREE.Color(0xffffff), 0.5);
  lidMat.color.copy(c).lerp(new THREE.Color(S.look.flush), 0.14).multiplyScalar(0.8 - 0.34 * liner);   // lids are a little darker and warmer than the face
  hairMat.color.set(hairHex); hairMat.sheenColor.set(hairHex).lerp(new THREE.Color(0xffffff), 0.35);
  const ek = pick('eyes').c + S.look.white;
  if (ek !== eyeKey) { eyeKey = ek; if (eyeMat.map) eyeMat.map.dispose(); eyeMat.map = eyeTexture(pick('eyes').c, { white: S.look.white }); eyeMat.needsUpdate = true; }
  face.paint({
    mesh: built.fresh ? built.head.mesh : null, at: HEAD_AT, P: built.head.P, skin: skinHex, hair: hairHex, scalp: state.species === 'mikkian' ? (state.pattern === 'roots' ? 0.5 : 0) : (STYLES[state.style] || {}).roots ?? 0.9, brows: S.look.brows,
    stubble: state.marks === 'stubble' ? 1 : 0, freckles: state.marks === 'freckles', liner, flush: S.look.flush, lips: S.look.accentLips ? c.clone().lerp(new THREE.Color(hairHex), S.look.accentLips) : S.look.lips ? c.clone().lerp(new THREE.Color(S.look.lips), 0.6) : null,
    marks: state.species === 'mirialan' && state.tattoo ? tattooMarks(setOf(state.tattoo, options().tattoo), state.shape, pick('ink').c) : null,
  });
  built.fresh = false;
  if (built.mane) {   // the tendrils: the skin's colour, with the accent on their tips, in bands or at their roots
    const { mesh, t, d, ao } = built.mane, col = mesh.geometry.attributes.color, pos = mesh.geometry.attributes.position, nrm = mesh.geometry.attributes.normal, white = new THREE.Color(1, 1, 1), smooth = state.style === 'dreads' && state.surface !== 'locked', acc = new THREE.Color(hairHex), k = new THREE.Color(), bell = (x, m) => Math.exp(-(((x - m) / 0.045) ** 2));
    // even rings toward the tip, every 4.2 cm, when it is known how far each point is from its tip
    const ring = (dd) => (dd < 0.014 || dd > 0.27 ? 0 : Math.pow((Math.cos((dd / 0.042) * 2 * Math.PI) + 1) / 2, 7));
    for (let i = 0; i < t.length; i++) {
      const u = t[i], w = u > 1.2 ? 1 : state.pattern === 'tips' ? Math.min(1, Math.max(0, (u - 0.5) / 0.38)) : state.pattern === 'bands' ? (d ? ring(d[i]) : Math.min(1, bell(u, 0.38) + bell(u, 0.58) + bell(u, 0.78))) : state.pattern === 'roots' ? 1 - Math.min(1, Math.max(0, (u - 0.04) / 0.34)) : 0;
      const a = Math.pow(ao[i], 1.5), v = 0.5 + 0.5 * a;
      k.copy(c).lerp(acc, w);
      if (smooth) {   // a tentacle is faintly paler on its inner side, the side toward the head and body
        const px = pos.getX(i), pz = pos.getZ(i) + 0.012, l = Math.hypot(px, pz) || 1, inner = Math.max(0, -(nrm.getX(i) * px + nrm.getZ(i) * pz) / l);
        k.lerp(white, 0.13 * inner);
      }
      col.setXYZ(i, k.r * v, k.g * v, k.b * v);
    }
    col.needsUpdate = true; tendrilMat.sheenColor.copy(c).lerp(new THREE.Color(0xffffff), 0.5); lockMat.sheenColor.copy(c).lerp(new THREE.Color(0xffffff), 0.3); tentMat.sheenColor.copy(c).lerp(new THREE.Color(0xffffff), 0.5);
  }
  const cols = { main: pick('main').c, second: pick('second').c, dark: '#25272d', leather: '#46321f', metal: '#a4a9b0', trim: '#c9a24a' };
  for (const p of cloth) p.mesh.material.color.set(cols[p.role] || '#777777');
  ringMat.color.set(state.jewel === 'silver' ? '#c3c7cd' : '#c9a24a'); ringMat.emissive.copy(ringMat.color);
  gearMaterial().userData.u.uPrimary.value.set('#3a2c20'); gearMaterial().userData.u.uSecondary.value.set(cols.second);   // a staff's wood, and its grip in the wearer's second colour
  stage.redraw();
}
const go = () => { current = rebuild(); return current; };

/* ---------------- the panel ---------------- */
const GEOMETRY = new Set(['frame', 'build', 'face', 'age', 'style', 'thick', 'length', 'surface', 'spurs', 'tendrils', 'ridges', 'jewel', 'outfit', 'hood', 'gear']);
function summary() {
  const n = (k) => pick(k).name.toLowerCase(), S = sp();
  document.getElementById('title').textContent = S.name; document.getElementById('blurb').textContent = S.blurb;
  document.getElementById('summary').textContent = `${S.name}: ${n('frame')} frame, ${n('build')} build, ${n('face')} face, ${n('age')}; ${n('skin')} skin, ${n('eyes')} eyes, ${state.species === 'mikkian' ? (state.style === 'dreads' ? `${state.length === 'long' ? 'long' : 'shoulder-length'} ${state.surface === 'locked' ? 'locked' : 'smooth'} dreads with ${n('hair')} accents` : `head-tendrils ${n('style')} with ${n('hair')} accents`) : `${n('hair')} hair worn ${n('style')}`}; in ${pick('outfit').name.toLowerCase()}, ${n('main')} and ${n('second')}${state.hood !== 'none' ? ', hood ' + n('hood') : ''}${state.gear !== 'none' ? ', carrying a ' + n('gear') : ''}.`;
}
function paintPanel() {
  const opts = options();
  for (const el of document.querySelectorAll('[data-opt]')) {
    const def = opts[el.dataset.opt], on = def.multi ? setOf(state[el.dataset.opt], def) : null;
    for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(def.multi ? on.has(b.dataset.key) : b.dataset.key === state[el.dataset.opt]));
  }
  summary();
}
function set(opt, k) {
  const def = options()[opt]; if (!def) return;
  if (def.multi) { const on = setOf(state[opt], def); if (on.has(k)) on.delete(k); else on.add(k); state[opt] = [...on].join('.'); }
  else { if (state[opt] === k) return; state[opt] = k; }
  if (opt === 'species') { for (const [q, v] of Object.entries(sp().defaults)) if (!chosen.has(q)) state[q] = v; settle(); panel(); eyeKey = ''; go(); }
  else { chosen.add(opt); if (GEOMETRY.has(opt)) go(); else recolour(); }
  paintPanel(); writeHash();
}
const panelEl = document.getElementById('options');
function panel() {   // the choices on offer change with the species
  panelEl.textContent = '';
  for (const [opt, def] of Object.entries(options())) {
    const fs = document.createElement('fieldset'); fs.className = 'opt';
    const lg = document.createElement('legend'); lg.textContent = def.label; fs.appendChild(lg);
    const box = document.createElement('div'); box.className = def.swatch ? 'swatches' : 'seg wrap'; box.dataset.opt = opt;
    for (const o of def.items) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.key = o.key;
      if (def.swatch) { b.className = 'sw'; b.style.setProperty('--c', o.c); b.setAttribute('aria-label', o.name); b.title = o.name; } else b.textContent = o.name;
      b.addEventListener('click', () => set(opt, o.key));
      box.appendChild(b);
    }
    fs.appendChild(box); panelEl.appendChild(fs);
  }
}
document.getElementById('random').addEventListener('click', () => {
  const opts = options(), any = (k) => { const it = opts[k].items; return it[Math.floor(Math.random() * it.length)].key; };
  for (const [k, def] of Object.entries(opts)) {
    if (k === 'species' || k === 'second') continue;
    state[k] = def.multi ? def.items.map((o) => o.key).filter(() => Math.random() < 0.45).join('.') : any(k);
    chosen.add(k);
  }
  do state.second = any('second'); while (state.second === state.main);
  chosen.add('second');
  if (Math.random() < 0.6) state.hood = 'none';
  go(); paintPanel(); writeHash();
});
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => stage.view(VIEWS[b.dataset.view].target, VIEWS[b.dataset.view].pos));

/* ---------------- pictures ---------------- */
const bgChoice = () => (document.querySelector('input[name=bg]:checked') || { value: 'studio' }).value;
// the portrait: the current view, 1024 px square
document.getElementById('save').addEventListener('click', () => stage.download(stage.snapshot(1024, bgChoice(), stage.squareCamera()), `${state.species}-${state.skin}-${state.outfit}.png`));
// the token: 512 px, head and shoulders from the front and a little to one side; plain by default
const tokenCam = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
document.getElementById('token').addEventListener('click', () => {
  tokenCam.position.set(0.14, 1.63, 1.02); tokenCam.lookAt(0, 1.58, 0); tokenCam.updateProjectionMatrix();
  stage.download(stage.snapshot(512, bgChoice() === 'studio' ? 'plain' : bgChoice(), tokenCam, false), `${state.species}-token.png`);
});

/* ---------------- run ---------------- */
const hint = document.getElementById('hint');
stage.controls.addEventListener('start', () => hint.classList.add('gone'));
panel(); paintPanel(); stage.view(VIEWS.head.target, VIEWS.head.pos);   // open on the face: that is where a species shows
go();
stage.start();
window.__fig = { state, set, stage, camera: stage.camera, controls: stage.controls, redraw: stage.redraw, get ready() { return current; }, stats: () => ({ ...stage.stats(), built: info }) };
