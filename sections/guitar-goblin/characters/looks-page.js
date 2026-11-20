// The character creator's choices for each species: every key its link may hold, with the values on offer and the
// look each species opens in. No DOM and nothing drawn, so others can read it too: the page (characters.js), and the
// generator of the look parser's whitelist (tests/human-base/look-schema.mjs, human-base/look-parse.js), so a look
// someone pastes into a game table is read against exactly what this page offers.
//   optionsFor(species) -> { key: { label, items: [{ key, name, c? }], multi?, swatch? } | { label, min, max } }
//   defaultsOf(species) -> { key: value }
import { PRESETS } from '../human-base/controls.js';
import { SPECIES as LOOKS, LINERS, MARKS, GLOWS } from '../human-base/species/looks.js';
import { ARRANGE, THICK, LENGTHS, SURFACES, PATTERNS } from '../humanoid-creator/mikkian.js';
import { PUREBLOOD } from '../human-base/species/pureblood.js';
import { ITEMS } from '../human-base/carry.js';
import { STYLES } from './hair-shape.js';
import { OUTFITS, HOODS } from './outfit-shape.js';

/* ---------------- what each species offers on this page ---------------- */
export const sw = (...l) => l.map(([key, name, c]) => ({ key, name, c }));
const BLACK = ['black', 'Black', '#16110e'], DKBROWN = ['dkbrown', 'Dark brown', '#2a1d14'];
export const CLOTH = sw(['bone', 'Bone white', '#e4e0d6'], ['ash', 'Ash grey', '#9aa0a8'], ['steel', 'Steel blue', '#5b6f86'], ['slate', 'Slate', '#3f4a58'], ['charcoal', 'Charcoal', '#34373e'], ['black', 'Black', '#18191c'],
  ['umber', 'Umber', '#4d3a2c'], ['sand', 'Sand', '#b9a47c'], ['ochre', 'Ochre', '#b0812c'], ['rust', 'Rust', '#8a4324'], ['wine', 'Wine', '#6a2229'], ['crimson', 'Crimson', '#8f1f22'],
  ['forest', 'Forest', '#2f4a34'], ['teal', 'Teal', '#22585a'], ['navy', 'Navy', '#1e2f52'], ['violet', 'Violet', '#473462']);
// the opening person (a preset of the base's controls), hair colours, the outfits that suit (their own first), and the look it opens in
export const PAGE = {
  pureblood: { people: 'powerful', hairs: sw(BLACK, DKBROWN, ['redbrown', 'Red-brown', '#4a1a14'], ['grey', 'Iron grey', '#8a8684'], ['white', 'White', '#d8d4d0']),
    outfits: ['plate', 'cloak', 'robe', 'armour', 'coat'], defaults: { style: 'slick', hair: 'black', outfit: 'plate', hood: 'none', gear: 'hilt', main: 'charcoal', second: 'wine' } },
  human: { people: 'man', hairs: sw(BLACK, DKBROWN, ['brown', 'Brown', '#4a3020'], ['auburn', 'Auburn', '#6a2e1a'], ['blond', 'Blond', '#b89858'], ['grey', 'Grey', '#8c8c8c'], ['white', 'White', '#dcdcdc']),
    outfits: ['coat', 'jacket', 'wraps', 'armour', 'plate', 'robe', 'cloak'], defaults: { style: 'crop', hair: 'dkbrown', outfit: 'coat', hood: 'none', main: 'umber', second: 'sand' } },
  echani: { people: 'athlete', hairs: sw(['white', 'White', '#e4e4e8'], ['silver', 'Silver', '#bfc4cb'], ['ash', 'Ash', '#a6a6a2'], ['gold', 'Pale gold', '#d6cdaa'], ['steel', 'Steel', '#8b939c']),
    outfits: ['armour', 'wraps', 'coat', 'robe', 'cloak'], defaults: { style: 'swept', hair: 'white', outfit: 'armour', hood: 'none', gear: 'double', main: 'ash', second: 'slate' } },
  mirialan: { people: 'woman', hairs: sw(BLACK, ['blueblack', 'Blue-black', '#131928'], DKBROWN, ['redbrown', 'Red-brown', '#5a2a1a'], ['grey', 'Grey', '#8c8c8c']),
    outfits: ['jacket', 'robe', 'coat', 'wraps', 'cloak'], defaults: { style: 'tail', hair: 'black', outfit: 'jacket', hood: 'none', main: 'navy', second: 'sand' } },
  // opens on the look its first player asked for: medium blue with dark blue accents, heavy smooth dreads to the shoulders
  mikkian: { people: 'between', outfits: ['coat', 'robe', 'jacket', 'wraps', 'armour', 'cloak'], defaults: { style: 'dreads', front: 'forward', thick: 'thick', length: 'shoulder', surface: 'smooth', pattern: 'deepen', tpose: 'rest', outfit: 'coat', hood: 'none', main: 'charcoal', second: 'steel' } },
};
export const ORDER = ['pureblood', 'human', 'echani', 'mirialan', 'mikkian'];
// the people to start from: the base's presets, and one between the two (the controls' own middle)
export const PEOPLE = { ...PRESETS, between: { name: 'In between', controls: { gender: 0.5 } } };
export const asItems = (o) => Object.entries(o).map(([key, v]) => ({ key, name: typeof v === 'string' ? v : v.name, c: v.c }));

export function optionsFor(sp) {
  const L = LOOKS[sp], P = PAGE[sp], o = {
    species: { label: 'Species', items: ORDER.map((k) => ({ key: k, name: LOOKS[k].name })) },
    people: { label: 'Start from', items: asItems(PEOPLE) },
    skin: { label: 'Skin', swatch: true, items: asItems(L.skins) }, eyes: { label: 'Eyes', swatch: true, items: asItems(L.eyes) },
  };
  if (sp === 'pureblood') o.glow = { label: 'Eye glow', items: asItems(GLOWS) };
  o.liner = { label: 'Lined eyes', items: asItems(LINERS) };
  if (sp !== 'pureblood') o.marks = { label: 'Face detail', items: asItems(MARKS) };
  for (const [k, d] of Object.entries(L.options || {})) o[k] = { label: d.label, multi: d.multi, swatch: d.swatch, items: asItems(d.items) };
  if (sp === 'mikkian') {   // head-tendrils in place of hair
    o.style = { label: 'Head-tendrils', items: asItems(ARRANGE) }; o.front = { label: 'Tendril line', items: [{ key: 'forward', name: 'Forward' }, { key: 'high', name: 'High' }] }; o.thick = { label: 'Tendril thickness', items: asItems(THICK) };
    o.tpose = { label: 'Tendrils held', items: [{ key: 'rest', name: 'Relaxed, lying back' }, { key: 'flare', name: 'Flared, standing out' }] };
    o.length = { label: 'Tendril length', items: asItems(LENGTHS) }; o.surface = { label: 'Tendril surface', items: asItems(SURFACES) }; o.pattern = { label: 'Tendril pattern', items: asItems({ deepen: { name: 'Deepening to the lips' }, fade: { name: 'Paler tips' }, ...PATTERNS }) };
  } else {
    o.style = { label: 'Hair', items: [...['slick', 'swept', 'crop', 'tail', 'knot', 'braid'].map((k) => ({ key: k, name: STYLES[k].name })), { key: 'bob', name: 'Bob' }, { key: 'long', name: 'Long' }, ...['crest', 'shaved', 'bald'].map((k) => ({ key: k, name: STYLES[k].name }))] };
    o.hair = { label: 'Hair colour', swatch: true, items: P.hairs };
  }
  if (sp === 'pureblood') for (const [k, d] of Object.entries(PUREBLOOD.options)) {
    if (d.items) o[k] = { label: d.label, multi: d.multi, items: asItems(d.items) };
    else if (typeof d.min === 'number') o[k] = { label: d.label, min: d.min, max: d.max };   // (the folds' height: a slider)
  }
  o.outfit = { label: 'Outfit', items: P.outfits.map((k) => ({ key: k, name: OUTFITS[k].name })) };
  o.hood = { label: 'Hood', items: asItems(HOODS) };
  o.gear = { label: 'Carries', items: asItems(ITEMS) };
  o.main = { label: 'Main colour', swatch: true, items: CLOTH }; o.second = { label: 'Second colour', swatch: true, items: CLOTH };
  return o;
}
export const defaultsOf = (sp) => {
  const d = { ...LOOKS[sp].defaults, ...PAGE[sp].defaults, people: PAGE[sp].people };
  if (sp === 'pureblood') for (const [k, o] of Object.entries(PUREBLOOD.options)) d[k] = o.def;
  return d;
};
// a species this page offers (an own key: a link's #species=__proto__ is not one)
export const isSpecies = (sp) => typeof sp === 'string' && Object.prototype.hasOwnProperty.call(PAGE, sp) && Object.prototype.hasOwnProperty.call(LOOKS, sp);
