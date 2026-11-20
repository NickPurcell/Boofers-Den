// Jawa creator: what a Jawa's look can say: every option and its choices, and the look the page opens on. No three.js
// and no page here, so the table's look parser (../human-base/look-schema.js, made by tests/human-base/look-schema.mjs)
// can read the same lists the page offers.
import { HOODS } from './figure.js';
import { RIGS } from './straps.js';

// Robe colours as the references show the species: dark warm browns first, then tans and rust reds, then the cloth
// of other clans (charcoal and grey-green from colder worlds, and a few dyes).
export const ROBES = [
  { key: 'umber', name: 'Umber', c: '#4a2f1f' }, { key: 'earth', name: 'Dark earth', c: '#33231b' }, { key: 'chestnut', name: 'Chestnut', c: '#613420' },
  { key: 'rust', name: 'Rust red', c: '#75301c' }, { key: 'terracotta', name: 'Terracotta', c: '#8b4b2d' }, { key: 'tan', name: 'Tan', c: '#886946' },
  { key: 'sand', name: 'Sand', c: '#a38a63' }, { key: 'taupe', name: 'Pale taupe', c: '#8a7c6a' },
  { key: 'charcoal', name: 'Charcoal', c: '#2a2b30' }, { key: 'lichen', name: 'Grey-green', c: '#4b4d40' }, { key: 'plum', name: 'Plum', c: '#4c2a33' }, { key: 'ochre', name: 'Ochre', c: '#8f6a26' },
];
export const EYES = [
  { key: 'amber', name: 'Amber', c: '#ffae2b' }, { key: 'yellow', name: 'Yellow', c: '#ffd93a' }, { key: 'orange', name: 'Orange', c: '#ff7d1c' }, { key: 'ember', name: 'Red-orange', c: '#ff4b22' },
  { key: 'pale', name: 'Pale gold', c: '#ffeeb0' }, { key: 'green', name: 'Yellow-green', c: '#c9f53c' }, { key: 'ice', name: 'Ice blue', c: '#8fd8ff' },
];
export const LEATHERS = [{ key: 'tan', name: 'Tan', c: '#8a5a34', d: '#5e3c22' }, { key: 'red', name: 'Red-brown', c: '#6e3320', d: '#3f2219' }, { key: 'brown', name: 'Dark brown', c: '#3f2a1e', d: '#6b4a30' }, { key: 'black', name: 'Black', c: '#1a1614', d: '#4a3324' }];
export const OPTIONS = {
  robe: { label: 'Robe', swatch: true, items: ROBES },
  cloth: { label: 'Cloth', items: [{ key: 'homespun', name: 'Homespun', pitch: 0.004 }, { key: 'ribbed', name: 'Ribbed', pitch: 0.0036 }, { key: 'burlap', name: 'Burlap', pitch: 0.0048 }] },
  wear: { label: 'Wear', items: [{ key: 'kept', name: 'Well kept', w: 0.12, d: 0.2 }, { key: 'worn', name: 'Worn', w: 0.42, d: 0.5 }, { key: 'ragged', name: 'Ragged', w: 0.8, d: 0.7 }, { key: 'sandblown', name: 'Sand-blown', w: 0.6, d: 1.15 }] },
  clan: { label: 'Clan marks', items: [{ key: 'none', name: 'Plain' }, { key: 'stripes', name: 'Hem stripes' }, { key: 'dipped', name: 'Dipped hem' }, { key: 'patched', name: 'Patched' }] },
  hood: { label: 'Hood', items: Object.entries(HOODS).map(([key, h]) => ({ key, name: h.name })) },
  eyes: { label: 'Eyes', swatch: true, items: EYES },
  gaze: { label: 'Eye shape', items: [{ key: 'points', name: 'Points', r: 0.0062 }, { key: 'round', name: 'Round', r: 0.0092 }, { key: 'wide', name: 'Wide', r: 0.0122 }] },
  glow: { label: 'Glow', items: [{ key: 'ember', name: 'Ember', g: 0.55 }, { key: 'bright', name: 'Bright', g: 1 }, { key: 'blazing', name: 'Blazing', g: 1.7 }] },
  build: { label: 'Build', items: [{ key: 'stout', name: 'Stout' }, { key: 'average', name: 'Average' }, { key: 'slight', name: 'Slight' }] },
  stance: { label: 'Stance', items: [{ key: 'rest', name: 'At rest' }, { key: 'ready', name: 'Ready' }, { key: 'haggle', name: 'Haggling' }, { key: 'utinni', name: 'Utinni!' }] },
  hands: { label: 'Hands', items: [{ key: 'black', name: 'Black gloves' }, { key: 'brown', name: 'Brown gloves' }, { key: 'wraps', name: 'Wrapped' }] },
  rig: { label: 'Straps', items: Object.entries(RIGS).map(([key, r]) => ({ key, name: r.name })) },
  leather: { label: 'Leather', swatch: true, items: LEATHERS },
  hold: { label: 'In hand', items: [{ key: 'none', name: 'Nothing' }, { key: 'blaster', name: 'Ion blaster' }, { key: 'bolt', name: 'Bolt tool' }, { key: 'salvage', name: 'Salvage' }] },
  extras: { label: 'Carries', multi: true, items: [{ key: 'goggles', name: 'Goggles' }, { key: 'satchel', name: 'Satchel' }, { key: 'scrap', name: 'Scrap pack' }] },
  keepsake: { label: 'Sandcrawler keepsake', items: [{ key: 'none', name: 'None' }, { key: 'talisman', name: 'Hull token' }, { key: 'shield', name: 'Hull-plate shield' }] },
};
// The page opens on a look of its own: a clan engineer with a bolt tool, goggles, and a token cut from the
// clan's sandcrawler.
export const DEFAULT = { robe: 'rust', cloth: 'homespun', wear: 'worn', clan: 'stripes', hood: 'peaked', eyes: 'amber', gaze: 'round', glow: 'bright', build: 'average', stance: 'ready', hands: 'black', rig: 'toolbelt', leather: 'brown', hold: 'bolt', extras: 'goggles.satchel', keepsake: 'talisman', seed: '7' };
