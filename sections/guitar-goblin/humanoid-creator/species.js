// The peoples this page can make, on one shared figure: what each offers (its skin, eye and hair colours, and the
// choices only it has) and the look it opens in. Colours and features are from a study of many individuals of each
// species; no default is any one named person's look.
import { SPURS, TENDRILS, RIDGES, TLENGTHS } from './pureblood.js';
import { STYLES } from './hair.js';
import { PLACES, SHAPES, INKS } from './tattoos.js';
import { ARRANGE, THICK, LENGTHS, SURFACES, PATTERNS } from './mikkian.js';

const named = (o) => Object.entries(o).map(([key, v]) => ({ key, name: v.name }));
const sw = (...list) => list.map(([key, name, c]) => ({ key, name, c }));
const BLACK = ['black', 'Black', '#16110e'], DKBROWN = ['dkbrown', 'Dark brown', '#2a1d14'];

export const SPECIES = {
  echani: {
    name: 'Echani', blurb: 'A martial people: pale skin, white or silver hair, pale eyes.',
    skins: sw(['porcelain', 'Porcelain', '#f1e5db'], ['ivory', 'Ivory', '#e9d8c7'], ['rose', 'Pale rose', '#eed6cd'], ['pearl', 'Pearl', '#e3dcd3'], ['cool', 'Cool grey', '#d6d3cf'], ['ashen', 'Ashen', '#cbc3bc']),
    eyes: sw(['silver', 'Silver', '#b9c2cc'], ['ice', 'Ice', '#a4c2d8'], ['blue', 'Pale blue', '#86a9cc'], ['violet', 'Pale violet', '#ada4d0'], ['grey', 'Grey', '#8a929b']),
    hairs: sw(['white', 'White', '#e4e4e8'], ['silver', 'Silver', '#bfc4cb'], ['ash', 'Ash', '#a6a6a2'], ['gold', 'Pale gold', '#d6cdaa'], ['steel', 'Steel', '#8b939c']),
    look: { white: '#ebe8e4', flush: '#b65a54' },
    outfits: ['armour', 'wraps', 'coat', 'robe'],   // what fits the people, their own first
    defaults: { frame: 'masc', build: 'strong', shoulders: 'average', face: 'oval', age: 'adult', skin: 'ivory', eyes: 'silver', style: 'swept', hair: 'white', marks: 'none', liner: 'none', outfit: 'armour', hood: 'none', gear: 'double', main: 'ash', second: 'slate' },
    groups: {},
  },
  pureblood: {
    name: 'Sith Pureblood', blurb: 'Red skin over a heavy brow, bone spurs and folds, fleshy tendrils at the jaw, burning eyes.',
    skins: sw(['ember', 'Ember', '#b84a2a'], ['scarlet', 'Scarlet', '#a8302a'], ['crimson', 'Crimson', '#8e2226'], ['brick', 'Brick', '#7e3326'], ['rose', 'Dusk rose', '#9a4a46'], ['maroon', 'Maroon', '#62202a'], ['oxblood', 'Oxblood', '#521820'], ['wine', 'Dark wine', '#3e121a'], ['umber', 'Red umber', '#5e2a1e']),
    eyes: sw(['amber', 'Amber', '#f09a1a'], ['yellow', 'Yellow', '#efc222'], ['gold', 'Gold', '#d6a636'], ['orange', 'Orange', '#e8641a'], ['red', 'Red', '#d32a1a'], ['ember', 'Ember', '#ff5a1e']),
    hairs: sw(BLACK, DKBROWN, ['redbrown', 'Red-brown', '#4a1a14'], ['grey', 'Iron grey', '#8a8684'], ['white', 'White', '#d8d4d0']),
    // hair that suits: worn back, tied or cropped, or none at all
    styles: ['slick', 'swept', 'knot', 'tail', 'braid', 'crop', 'long', 'shaved', 'bald'].map((key) => ({ key, name: STYLES[key].name })),
    // no eyebrow hair (the brow is bone), a large iris with little white, and the white itself warm and dark
    look: { white: '#9a6a48', iris: 38, brows: false, flush: '#5a1216', lips: '#2c0b10', shade: 0.35, deep: true, shadeK: 1.6, contour: true },
    outfits: ['plate', 'cloak', 'robe', 'armour', 'coat'],
    // the dice, steered: a few pieces of jewellery in one metal rather than all of them, tendrils nearly always, dark
    // Sith colours for the clothes, the hood up more often with the cloak, and spurs and folds that go together
    randomise(st, rnd) {
      const pick = (list) => list[Math.floor(rnd() * list.length)];
      st.tendrils = rnd() < 0.05 ? 'none' : pick(['chin', 'fringe', 'beard', 'beard', 'cheek']);
      st.jewel = rnd() < 0.15 ? '' : [...new Set([pick(['rings', 'cuffs']), ...(rnd() < 0.45 ? [pick(['circlet', 'studs', 'brow', 'chains'])] : [])])].join('.');
      st.spurs = st.frame === 'fem' ? pick(['brow', 'brow', 'brow_cheek', 'none']) : pick(['brow', 'brow_cheek', 'brow_cheek', 'full']);
      st.ridges = st.frame === 'fem' ? pick(['smooth', 'brow', 'brow', 'cheek']) : st.age === 'elder' ? pick(['cheek', 'corded']) : pick(['brow', 'cheek', 'cheek', 'corded']);
      st.main = pick(['charcoal', 'black', 'black', 'slate', 'wine', 'umber']);
      do st.second = pick(['black', 'wine', 'wine', 'crimson', 'charcoal', 'umber']); while (st.second === st.main);
      if (st.outfit === 'cloak') st.hood = rnd() < 0.6 ? 'up' : 'down';
      if (st.style === 'bald' && st.ridges === 'smooth') st.ridges = 'brow';
    },
    defaults: { frame: 'masc', build: 'heavy', shoulders: 'broad', face: 'square', age: 'adult', skin: 'scarlet', eyes: 'amber', glow: 'faint', style: 'slick', hair: 'black', liner: 'none', spurs: 'brow_cheek', ridges: 'cheek', tendrils: 'fringe', tlength: 'short', jewel: 'cuffs', metal: 'gold', outfit: 'plate', hood: 'none', gear: 'hilt', main: 'charcoal', second: 'wine' },
    groups: {
      spurs: { label: 'Bone spurs', items: named(SPURS) }, ridges: { label: 'Folds', items: named(RIDGES) },
      tendrils: { label: 'Tendrils', items: named(TENDRILS) }, tlength: { label: 'Tendril length', items: named(TLENGTHS) },
      glow: { label: 'Eye glow', items: [{ key: 'none', name: 'None' }, { key: 'faint', name: 'Faint' }, { key: 'burning', name: 'Burning' }] },
      jewel: { label: 'Jewellery', multi: true, items: [{ key: 'rings', name: 'Tendril rings' }, { key: 'cuffs', name: 'Tendril cuffs' }, { key: 'chains', name: 'Chains' }, { key: 'studs', name: 'Piercings' }, { key: 'brow', name: 'Spur rings' }, { key: 'circlet', name: 'Circlet' }] },
      metal: { label: 'Metal', items: [{ key: 'gold', name: 'Gold' }, { key: 'silver', name: 'Silver' }, { key: 'bronze', name: 'Bronze' }, { key: 'iron', name: 'Dark iron' }] },
    },
  },
  mirialan: {
    name: 'Mirialan', blurb: 'Green to yellow skin, dark hair, and tattoos that record what you have done.',
    skins: sw(['olive', 'Olive', '#748938'], ['leaf', 'Leaf green', '#8aa23f'], ['yellowgreen', 'Yellow-green', '#b3b750'], ['pale', 'Pale yellow', '#d3cc7c'], ['sage', 'Sage', '#91a676'], ['sea', 'Sea green', '#5f8f68'], ['deep', 'Deep olive', '#4d5e2e']),
    eyes: sw(['blue', 'Blue', '#4f78a8'], ['green', 'Green', '#4f8a56'], ['grey', 'Grey', '#7f8a94'], ['yellow', 'Yellow', '#c6ae30'], ['hazel', 'Hazel', '#7a6a3a'], ['violet', 'Violet', '#7e60ae']),
    hairs: sw(BLACK, ['blueblack', 'Blue-black', '#131928'], DKBROWN, ['redbrown', 'Red-brown', '#5a2a1a'], ['grey', 'Grey', '#8c8c8c']),
    look: { white: '#e8e4da', flush: '#7a6a2a' },
    outfits: ['jacket', 'robe', 'coat', 'wraps'],
    defaults: { frame: 'fem', build: 'average', shoulders: 'average', face: 'heart', age: 'adult', skin: 'olive', eyes: 'blue', style: 'tail', hair: 'black', marks: 'none', liner: 'soft', tattoo: 'brow.eyes', shape: 'triangle', ink: 'black', outfit: 'jacket', hood: 'down', gear: 'none', main: 'navy', second: 'sand' },
    groups: { tattoo: { label: 'Tattoos', multi: true, items: named(PLACES) }, shape: { label: 'Tattoo shape', items: named(SHAPES) }, ink: { label: 'Tattoo ink', swatch: true, items: INKS } },
  },
  mikkian: {
    name: 'Mikkian', blurb: 'Bright skin and, in place of hair, a mane of slim head-tendrils.',
    skins: sw(['blue', 'Medium blue', '#3d6fc0'], ['sky', 'Sky blue', '#6fa3d8'], ['teal', 'Teal', '#2f9a98'], ['green', 'Green', '#6aa84a'], ['yellowgreen', 'Yellow-green', '#b3be4a'], ['yellow', 'Yellow', '#dfc040'],
      ['coral', 'Coral pink', '#e07a78'], ['rose', 'Rose', '#d2577a'], ['red', 'Red', '#c8443c'], ['magenta', 'Magenta', '#b2459a'], ['violet', 'Violet', '#7a55b8'], ['lavender', 'Lavender', '#b9a6dc']),
    eyes: sw(['blue', 'Blue', '#3f78c8'], ['dark', 'Dark', '#2a2230'], ['violet', 'Violet', '#7a5ac0'], ['green', 'Green', '#3f9a6a'], ['amber', 'Amber', '#e0a030'], ['silver', 'Silver', '#b0bac8']),
    // a Mikkian has no hair: these are the accent colours of the tendrils (their tips, bands or roots) and the lips
    hairs: sw(['dkblue', 'Dark blue', '#1b2f6e'], ['navy', 'Navy', '#141c44'], ['teal', 'Deep teal', '#0f5a5c'], ['forest', 'Forest', '#1f5a2c'], ['gold', 'Gold', '#d8b030'], ['white', 'Pale', '#e8e4dc'],
      ['pink', 'Pink', '#e88aa8'], ['crimson', 'Crimson', '#8c1c2c'], ['purple', 'Purple', '#4a2a78'], ['black', 'Black', '#18161c']),
    styles: named(ARRANGE), styleLabel: 'Head-tendrils', hairLabel: 'Accent colour',
    look: { white: '#e9e6e2', flush: '#7a4a9a', brows: false, scalp: 0, accentLips: 0.55 },
    outfits: ['coat', 'robe', 'jacket', 'wraps', 'armour'],
    // opens on the look its first player asked for: mostly medium blue with dark blue accents
    defaults: { frame: 'andro', build: 'average', shoulders: 'average', face: 'oval', age: 'adult', skin: 'blue', eyes: 'dark', style: 'dreads', hair: 'dkblue', thick: 'thick', length: 'shoulder', surface: 'smooth', pattern: 'tips', marks: 'none', liner: 'none', outfit: 'coat', hood: 'none', gear: 'none', main: 'charcoal', second: 'steel' },
    groups: { thick: { label: 'Tendril thickness', items: named(THICK) }, length: { label: 'Tendril length', items: named(LENGTHS) }, surface: { label: 'Tendril surface', items: named(SURFACES) }, pattern: { label: 'Tendril pattern', items: named(PATTERNS) } },
  },
  human: {
    name: 'Human', blurb: 'The common stock of the galaxy.',
    skins: sw(['s1', 'Fair', '#f0d6c2'], ['s2', 'Light', '#e2bc9e'], ['s3', 'Tan', '#d0a07c'], ['s4', 'Olive', '#b78461'], ['s5', 'Brown', '#996a48'], ['s6', 'Deep brown', '#785036'], ['s7', 'Dark', '#593a28'], ['s8', 'Ebony', '#3e2a1e']),
    eyes: sw(['brown', 'Brown', '#5a3a22'], ['dark', 'Dark', '#2a1c14'], ['hazel', 'Hazel', '#7a6a3a'], ['green', 'Green', '#4f7a52'], ['blue', 'Blue', '#4f78a8'], ['grey', 'Grey', '#7f8a94']),
    hairs: sw(BLACK, DKBROWN, ['brown', 'Brown', '#4a3020'], ['auburn', 'Auburn', '#6a2e1a'], ['blond', 'Blond', '#b89858'], ['grey', 'Grey', '#8c8c8c'], ['white', 'White', '#dcdcdc']),
    look: { white: '#e9e4de', flush: '#b0453c' },
    outfits: ['coat', 'jacket', 'wraps', 'armour', 'plate', 'robe'],
    defaults: { frame: 'andro', build: 'average', shoulders: 'average', face: 'oval', age: 'adult', skin: 's4', eyes: 'brown', style: 'crop', hair: 'dkbrown', marks: 'none', liner: 'none', outfit: 'coat', hood: 'none', gear: 'none', main: 'umber', second: 'sand' },
    groups: {},
  },
};
export const CLOTH = sw(['bone', 'Bone white', '#e4e0d6'], ['ash', 'Ash grey', '#9aa0a8'], ['steel', 'Steel blue', '#5b6f86'], ['slate', 'Slate', '#3f4a58'], ['charcoal', 'Charcoal', '#26282d'], ['black', 'Black', '#141518'],
  ['umber', 'Umber', '#4d3a2c'], ['sand', 'Sand', '#b9a47c'], ['ochre', 'Ochre', '#b0812c'], ['rust', 'Rust', '#8a4324'], ['wine', 'Wine', '#5e1f26'], ['crimson', 'Crimson', '#8f1f22'],
  ['forest', 'Forest', '#2f4a34'], ['teal', 'Teal', '#22585a'], ['navy', 'Navy', '#1e2f52'], ['violet', 'Violet', '#473462']);
export const FRAMES = [{ key: 'fem', name: 'Feminine', v: 0.08 }, { key: 'andro', name: 'Between', v: 0.5 }, { key: 'masc', name: 'Masculine', v: 0.92 }];
export const BUILDS = [{ key: 'slight', name: 'Slight', v: 0.15 }, { key: 'average', name: 'Average', v: 0.5 }, { key: 'strong', name: 'Strong', v: 0.9 }, { key: 'heavy', name: 'Heavy', v: 1.3 }];
export const SHOULDERS = [{ key: 'narrow', name: 'Narrow', v: -0.014 }, { key: 'average', name: 'Average', v: 0 }, { key: 'broad', name: 'Broad', v: 0.016 }, { key: 'massive', name: 'Massive', v: 0.03 }];
export const AGES = [{ key: 'young', name: 'Young', v: 0.1 }, { key: 'adult', name: 'Adult', v: 0.36 }, { key: 'elder', name: 'Elder', v: 0.95 }];
export const MARKS = [{ key: 'none', name: 'None' }, { key: 'freckles', name: 'Freckles' }, { key: 'stubble', name: 'Stubble' }];
export const LINERS = [{ key: 'none', name: 'None', v: 0.12 }, { key: 'soft', name: 'Soft', v: 0.45 }, { key: 'dark', name: 'Dark', v: 0.9 }];
