// Human base, species looks: what the lighter species are in skin and paint, on the same base. Palettes follow the
// old page's lists (engineer7's study of the references); the painters are our own and draw on the skin's mark canvas
// (skin.js: ctx.at(x, y) takes head-frame metres from the point between the eyes, x to the figure's left, y up).
//
//   import { SPECIES, painters } from '../human-base/species/looks.js';
//   fig.skin.userData.set({ tone, marks: painters({ liner: 'soft', marks: 'freckles', tattoo: 'brow.eyes', shape, ink }) });

const sw = (...list) => Object.fromEntries(list.map(([k, name, c]) => [k, { name, c }]));
export const SPECIES = {
  human: {
    name: 'Human', blurb: 'The common stock of the galaxy.',
    skins: sw(['s1', 'Fair', '#f0d6c2'], ['s2', 'Light', '#e2bc9e'], ['s3', 'Tan', '#d0a07c'], ['s4', 'Olive', '#b78461'], ['s5', 'Brown', '#996a48'], ['s6', 'Deep brown', '#785036'], ['s7', 'Dark', '#593a28'], ['s8', 'Ebony', '#3e2a1e']),
    eyes: sw(['brown', 'Brown', '#5a3a22'], ['dark', 'Dark', '#2a1c14'], ['hazel', 'Hazel', '#7a6a3a'], ['green', 'Green', '#4f7a52'], ['blue', 'Blue', '#4f78a8'], ['grey', 'Grey', '#7f8a94']),
    look: { white: '#e9e4de', brows: 0.85 },
    defaults: { skin: 's4', eyes: 'brown', liner: 'none', marks: 'none' },
  },
  echani: {
    name: 'Echani', blurb: 'A martial people: pale skin, white or silver hair, pale eyes.',
    skins: sw(['porcelain', 'Porcelain', '#f1e5db'], ['ivory', 'Ivory', '#e9d8c7'], ['rose', 'Pale rose', '#eed6cd'], ['pearl', 'Pearl', '#e3dcd3'], ['cool', 'Cool grey', '#d6d3cf'], ['ashen', 'Ashen', '#cbc3bc']),
    eyes: sw(['silver', 'Silver', '#b9c2cc'], ['ice', 'Ice', '#a4c2d8'], ['blue', 'Pale blue', '#86a9cc'], ['violet', 'Pale violet', '#ada4d0'], ['grey', 'Grey', '#8a929b']),
    // white or silver brows, faint on pale skin
    look: { white: '#ecebe6', brows: 0.55, brow: '#d8d6d0' },
    defaults: { skin: 'ivory', eyes: 'silver', liner: 'none', marks: 'none' },
  },
  mirialan: {
    name: 'Mirialan', blurb: 'Green to yellow skin, dark hair, and tattoos that record what you have done.',
    skins: sw(['olive', 'Olive', '#748938'], ['leaf', 'Leaf green', '#8aa23f'], ['yellowgreen', 'Yellow-green', '#b3b750'], ['pale', 'Pale yellow', '#d3cc7c'], ['sage', 'Sage', '#91a676'], ['sea', 'Sea green', '#5f8f68'], ['deep', 'Deep olive', '#4d5e2e']),
    eyes: sw(['blue', 'Blue', '#4f78a8'], ['green', 'Green', '#4f8a56'], ['grey', 'Grey', '#7f8a94'], ['yellow', 'Yellow', '#c6ae30'], ['hazel', 'Hazel', '#7a6a3a'], ['violet', 'Violet', '#7e60ae']),
    look: { white: '#e8e4da', brows: 0.8 },
    defaults: { skin: 'olive', eyes: 'blue', liner: 'soft', marks: 'none', tattoo: 'brow.eyes', shape: 'triangle', ink: 'black' },
    options: {
      tattoo: { label: 'Tattoos', multi: true, items: { brow: 'Brow', eyes: 'Eye corners', cheeks: 'Cheeks', nose: 'Nose', chin: 'Chin' } },
      shape: { label: 'Tattoo shape', items: { diamond: 'Diamonds', triangle: 'Triangles', bar: 'Bars', dot: 'Dots' } },
      ink: { label: 'Tattoo ink', swatch: true, items: sw(['black', 'Black', '#0e0e11'], ['blue', 'Deep blue', '#122340'], ['green', 'Deep green', '#0d2c20'], ['rust', 'Rust', '#4a1b12'], ['white', 'Chalk', '#d9d6cc']) },
    },
  },
  mikkian: {
    name: 'Mikkian', blurb: 'Bright skin and, in place of hair, a mane of slim head-tendrils.',
    skins: sw(['blue', 'Medium blue', '#3d6fc0'], ['sky', 'Sky blue', '#6fa3d8'], ['teal', 'Teal', '#2f9a98'], ['green', 'Green', '#6aa84a'], ['yellowgreen', 'Yellow-green', '#b3be4a'], ['yellow', 'Yellow', '#dfc040'],
      ['coral', 'Coral pink', '#e07a78'], ['rose', 'Rose', '#d2577a'], ['red', 'Red', '#c8443c'], ['magenta', 'Magenta', '#b2459a'], ['violet', 'Violet', '#7a55b8'], ['lavender', 'Lavender', '#b9a6dc']),
    eyes: sw(['blue', 'Blue', '#3f78c8'], ['dark', 'Dark', '#2a2230'], ['violet', 'Violet', '#7a5ac0'], ['green', 'Green', '#3f9a6a'], ['amber', 'Amber', '#e0a030'], ['silver', 'Silver', '#b0bac8']),
    // no hair, so no brows: the brow is only its own shape. The accent colour belongs to the head-tendrils (their tips,
    // bands or roots, engineer7's) and tints the lips
    look: { white: '#e9e6e2', brows: 0, accentLips: 0.55 },
    defaults: { skin: 'blue', eyes: 'dark', accent: 'dkblue', liner: 'none', marks: 'none' },
    options: {
      accent: { label: 'Accent colour', swatch: true, items: sw(['dkblue', 'Dark blue', '#1b2f6e'], ['navy', 'Navy', '#141c44'], ['teal', 'Deep teal', '#0f5a5c'], ['forest', 'Forest', '#1f5a2c'], ['gold', 'Gold', '#d8b030'], ['white', 'Pale', '#e8e4dc'],
        ['pink', 'Pink', '#e88aa8'], ['crimson', 'Crimson', '#8c1c2c'], ['purple', 'Purple', '#4a2a78'], ['black', 'Black', '#18161c']) },
    },
  },
  pureblood: {
    name: 'Sith Pureblood', blurb: 'Red skin over a heavy brow, bone spurs and folds, fleshy tendrils at the jaw, burning eyes.',
    skins: sw(['ember', 'Ember', '#b84a2a'], ['scarlet', 'Scarlet', '#a8302a'], ['crimson', 'Crimson', '#7c1f1e'], ['brick', 'Brick', '#7e3326'], ['rose', 'Dusk rose', '#9a4a46'], ['maroon', 'Maroon', '#62202a'], ['oxblood', 'Oxblood', '#521820'], ['wine', 'Dark wine', '#3e121a'], ['umber', 'Red umber', '#5e2a1e']),
    eyes: sw(['amber', 'Amber', '#f09a1a'], ['yellow', 'Yellow', '#efc222'], ['gold', 'Gold', '#d6a636'], ['orange', 'Orange', '#e8641a'], ['red', 'Red', '#d32a1a'], ['ember', 'Ember', '#ff5a1e']),
    look: { white: '#9a6a48', iris: 1.3, brows: 0, lips: '#2a0c0c', sockets: 0.6 },
    defaults: { skin: 'crimson', eyes: 'amber', glow: 'faint', liner: 'none', marks: 'none' },
  },
};
export const LINERS = { none: { name: 'None', v: 0 }, soft: { name: 'Soft', v: 0.45 }, dark: { name: 'Dark', v: 0.9 } };
export const MARKS = { none: { name: 'None' }, freckles: { name: 'Freckles' }, stubble: { name: 'Stubble' } };
export const GLOWS = { none: { name: 'None', v: 0 }, faint: { name: 'Faint', v: 0.35 }, burning: { name: 'Burning', v: 0.9 } };

const rng = (seed) => { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// liner: a dark line along the upper lid's edge (the mesh's own eye opening, so it sits on the lid whatever the
// morphs do), thicker toward the outer corner, and a thinner one along the lower lid
function liner(v) {
  return ({ g, at, mm, holes }) => {
    if (v <= 0) return;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const { c, pts } of holes) {
      if (pts.length < 8) continue;
      const out = Math.sign(c[0]) || 1, push = (p, k) => { const dx = p[0] - c[0], dy = p[1] - c[1], l = Math.hypot(dx, dy) || 1; return [p[0] + (dx / l) * k, p[1] + (dy / l) * k]; };
      // the ring runs counter-clockwise from the left: the upper lid is the top half, from the inner corner outward
      const top = pts.filter((p) => p[1] >= c[1]).sort((a, b) => (a[0] - b[0]) * out), bottom = pts.filter((p) => p[1] < c[1]).sort((a, b) => (a[0] - b[0]) * out);
      const stroke = (list, w0, w1, k, alpha) => { for (let i = 1; i < list.length; i++) { const t = i / (list.length - 1); g.strokeStyle = `rgba(14,9,10,${alpha})`; g.lineWidth = mm(w0 + (w1 - w0) * t); g.beginPath(); g.moveTo(...at(...push(list[i - 1], k))); g.lineTo(...at(...push(list[i], k))); g.stroke(); } };
      stroke(top, 0.7 + 0.9 * v, 1.1 + 2.6 * v, 0.0006, 0.45 + 0.5 * v);
      if (v > 0.6 && top.length) { const e = top[top.length - 1]; g.lineWidth = mm(1.2 * v); g.beginPath(); g.moveTo(...at(...push(e, 0.0005))); g.lineTo(...at(e[0] + out * 0.0045, e[1] + 0.0024)); g.stroke(); }   // a short flick at the outer corner
      stroke(bottom, 0.3, 0.3 + 0.7 * v, 0.0004, 0.2 + 0.4 * v);
    }
  };
}
// freckles over the nose and the tops of the cheeks
function freckles(seed = 3) {
  return ({ g, at, mm, d }) => {
    const r = rng(seed);
    for (let k = 0; k < 140; k++) {
      const x = (r() * 2 - 1) * d * 0.95, y = -d * (0.18 + r() * 0.48) + Math.abs(x) * 0.12, near = Math.exp(-((x / (d * 0.6)) ** 2));
      if (r() > 0.35 + 0.65 * near) continue;
      const [px, py] = at(x, y); g.fillStyle = `rgba(110,60,35,${0.18 + 0.3 * r()})`; g.beginPath(); g.arc(px, py, mm(0.35 + 0.6 * r()), 0, Math.PI * 2); g.fill();
    }
  };
}
// stubble: a soft shadow over the beard's ground (the jaw, the chin, the upper lip, the mouth left clear), and fine
// points through it
function stubble(seed = 5) {
  return ({ g, at, mm, d }) => {
    const r = rng(seed), P = (x, y) => at(x * d, y * d);
    const beard = () => {
      g.beginPath(); g.moveTo(...P(-1.02, -0.72));
      g.quadraticCurveTo(...P(-0.98, -1.3), ...P(-0.55, -1.62)); g.quadraticCurveTo(...P(0, -1.86), ...P(0.55, -1.62)); g.quadraticCurveTo(...P(0.98, -1.3), ...P(1.02, -0.72));
      g.quadraticCurveTo(...P(0.8, -0.8), ...P(0.6, -0.95)); g.quadraticCurveTo(...P(0.45, -0.8), ...P(0.24, -0.77)); g.quadraticCurveTo(...P(0, -0.74), ...P(-0.24, -0.77));
      g.quadraticCurveTo(...P(-0.45, -0.8), ...P(-0.6, -0.95)); g.quadraticCurveTo(...P(-0.8, -0.8), ...P(-1.02, -0.72)); g.closePath();
    };
    g.save(); beard(); g.clip();
    g.filter = `blur(${Math.round(mm(1.6))}px)`; g.fillStyle = 'rgba(28,20,16,0.26)'; beard(); g.fill(); g.filter = 'none';
    for (let k = 0; k < 12000; k++) { const x = (r() * 2 - 1) * 1.05, y = -0.7 - r() * 1.2, [px, py] = P(x, y); g.fillStyle = `rgba(20,14,11,${0.2 + 0.3 * r()})`; g.fillRect(px, py, mm(0.4), mm(0.4 + 0.5 * r())); }
    // the mouth stays clear
    g.globalCompositeOperation = 'destination-out'; g.filter = `blur(${Math.round(mm(0.8))}px)`; g.beginPath(); g.ellipse(...P(0, -1.04), mm(0.37 * d * 1000), mm(0.09 * d * 1000), 0, 0, Math.PI * 2); g.fill();
    g.restore();
  };
}
// Mirialan tattoos: small shapes in tidy, mirrored groups; each placement is a group that can be worn alone or with
// others. Our own arrangements in the tradition's idiom. Each mark: [x, y, half size, turn], in eye spacings d.
const PLACES = {
  brow: [[0, 0.5, 0.055, 0], [0, 0.66, 0.046, 0], [0, 0.8, 0.038, 0], [0.13, 0.56, 0.04, 0], [0.13, 0.71, 0.032, 0]],
  eyes: [0, 1, 2].map((i) => [0.82 + i * 0.1, 0.02 + i * 0.028, 0.044 - i * 0.007, -Math.PI / 2]),
  cheeks: [...[0, 1, 2, 3].map((i) => [0.32 + i * 0.12, -0.3 - i * 0.012, 0.045, 0]), ...[0, 1, 2].map((i) => [0.38 + i * 0.12, -0.44 - i * 0.012, 0.038, 0])],
  nose: [0, 1, 2, 3].map((i) => [0, 0.1 - i * 0.14, 0.032 - i * 0.002, 0]),
  chin: [[0, -1.36, 0.044, 0], [0.12, -1.36, 0.038, 0], [0, -1.48, 0.036, 0]],
};
function tattoos(places, shape, ink) {
  return ({ g, at, d }) => {
    g.fillStyle = ink; g.globalAlpha = 0.9;
    const draw = (x, y, h, turn, mirror) => {
      const c = Math.cos(turn), s = Math.sin(turn) * mirror, pts = shape === 'triangle' ? [[-h, h * 0.8], [h, h * 0.8], [0, -h]] : shape === 'bar' ? [[-h * 1.25, h * 0.36], [h * 1.25, h * 0.36], [h * 1.25, -h * 0.36], [-h * 1.25, -h * 0.36]] : shape === 'dot' ? Array.from({ length: 12 }, (_, i) => [h * 0.8 * Math.cos(i * 0.5236), h * 0.8 * Math.sin(i * 0.5236)]) : [[-h * 0.75, 0], [0, h], [h * 0.75, 0], [0, -h]];
      g.beginPath(); pts.forEach(([a, b], i) => { const p = at((x + a * c - b * s) * d, (y + a * s + b * c) * d); if (i) g.lineTo(...p); else g.moveTo(...p); }); g.closePath(); g.fill();
    };
    for (const pl of places) for (const [x, y, h, t] of PLACES[pl] || []) { draw(x, y, h, t, 1); if (x > 0) draw(-x, y, h, t, -1); }
    g.globalAlpha = 1;
  };
}
// A whole look, as the settings for the skin and the eyes: lookParams('mirialan', { skin: 'olive', eyes: 'blue',
// liner: 'soft', tattoo: 'brow.eyes', shape, ink, accent, glow: 'faint', gender: 0..1 }) ->
// { skin: { ... for fig.skin.userData.set }, eyes: { ... for fig.eyes.set }, accent: '#hex' or null }
export function lookParams(sp, c = {}) {
  const S = SPECIES[sp] || SPECIES.human, L = S.look, d = { ...S.defaults, ...c }, pick = (o, k) => (o[k] || Object.values(o)[0]).c;
  const tone = pick(S.skins, d.skin), glow = (GLOWS[d.glow] || GLOWS.none).v, g = d.gender ?? 0.5;
  const accent = S.options?.accent ? pick(S.options.accent.items, d.accent) : null;
  const mixHex = (a, b, t) => { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)), x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const lips = L.lips || (accent && L.accentLips ? mixHex(tone, accent, L.accentLips) : null);
  const ink = S.options?.ink ? pick(S.options.ink.items, d.ink) : undefined;
  return {
    skin: { tone, lips, browAmount: L.brows ?? 0.85, brow: L.brow || '#231a16', browThick: 0.62 + 0.38 * g, sockets: glow > 0.1 ? L.sockets ?? 0.4 : Math.min(L.sockets ?? 0.4, 0.32),
      marks: painters({ liner: d.liner, marks: d.marks, tattoo: sp === 'mirialan' ? d.tattoo : '', shape: d.shape, ink, seed: d.seed }) },
    eyes: { colour: pick(S.eyes, d.eyes), glow, white: L.white || '#e6dfd6', iris: L.iris || 1 },
    accent,
  };
}

// the painters for a look: { liner, marks, tattoo: 'brow.eyes', shape, ink (hex) }
export function painters(o = {}) {
  const list = [liner((LINERS[o.liner] || LINERS.none).v)];
  if (o.marks === 'freckles') list.push(freckles(o.seed || 3));
  if (o.marks === 'stubble') list.push(stubble(o.seed || 5));
  const places = String(o.tattoo || '').split('.').filter(Boolean);
  if (places.length) list.push(tattoos(places, o.shape || 'diamond', o.ink || '#0e0e11'));
  return list;
}
