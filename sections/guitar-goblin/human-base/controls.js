// Human base: the controls a person uses to make their own character. Not the raw morphs (base.js SLIDERS has every
// one of those): a curated set with plain names, grouped, each clamped to a range that never gives a broken face, and
// presets that are clearly different people.
//
//   import { CONTROLS, PRESETS, toShape, randomControls } from '../human-base/controls.js';
//   const c = { ...CONTROL_DEFAULTS, ...PRESETS.lean.controls };   // the page keeps control values
//   fig.set(toShape(c)).update();                                  // and turns them into morph values
//
// Each control: { key, label, min, max, def, hint }; `shape` (optional) maps its value onto morph keys when it is not
// simply the morph of the same name. Ranges are the safe part of each morph's own -1..1 (checked at both ends together).
import { DEFAULTS } from './base.js';

export const CONTROLS = {
  build: [
    { key: 'gender', label: 'Feminine to masculine', min: 0, max: 1, def: 0.5 },
    { key: 'age', label: 'Age', min: 0, max: 0.9, def: 0.1, hint: 'young adult to old' },
    { key: 'height', label: 'Height', min: -0.8, max: 0.7, def: 0 },
    { key: 'weight', label: 'Weight', min: 0.12, max: 0.95, def: 0.5 },
    { key: 'muscle', label: 'Muscle', min: 0.1, max: 0.95, def: 0.5 },
    { key: 'shoulders', label: 'Shoulders', min: -0.7, max: 0.9, def: 0 },
    { key: 'belly', label: 'Belly', min: -0.5, max: 0.8, def: 0 },
    { key: 'neck', label: 'Neck', min: -0.6, max: 0.9, def: 0, shape: (v) => ({ neck: v, neckDepth: v * 0.6 }) },
  ],
  head: [
    { key: 'headShape', label: 'Head shape', min: -1, max: 1, def: 0, hint: 'oval to square', shape: (v) => ({ oval: Math.max(0, -v) * 0.7, square: Math.max(0, v) * 0.7 }) },
    { key: 'headfat', label: 'Head fullness', min: -0.6, max: 0.6, def: 0 },
    { key: 'browr', label: 'Brow', min: -0.5, max: 0.9, def: 0, hint: 'smooth to heavy' },
    { key: 'browh', label: 'Brow height', min: -0.6, max: 0.6, def: 0 },
    { key: 'eyesize', label: 'Eye size', min: -0.6, max: 0.6, def: 0 },
    { key: 'eyespace', label: 'Eye spacing', min: -0.5, max: 0.5, def: 0 },
    { key: 'lids', label: 'Eye opening', min: -0.6, max: 0.5, def: 0, hint: 'hooded to open' },
    { key: 'nosew', label: 'Nose width', min: -0.6, max: 0.7, def: 0 },
    { key: 'nosel', label: 'Nose length', min: -0.6, max: 0.6, def: 0 },
    { key: 'nosehump', label: 'Nose bridge', min: -0.6, max: 0.8, def: 0, hint: 'scooped to hooked' },
    { key: 'mouthw', label: 'Mouth width', min: -0.6, max: 0.6, def: 0 },
    { key: 'lips', label: 'Lips', min: -0.7, max: 0.8, def: 0, hint: 'thin to full' },
    { key: 'corners', label: 'Mouth corners', min: -0.5, max: 0.5, def: 0, hint: 'stern to smiling' },
    { key: 'cheekbones', label: 'Cheekbones', min: -0.6, max: 0.8, def: 0 },
    { key: 'cheeks', label: 'Cheeks', min: -0.6, max: 0.6, def: 0, hint: 'hollow to full' },
    { key: 'jaw', label: 'Jaw', min: -0.6, max: 0.9, def: 0, hint: 'narrow to broad' },
    { key: 'chinjut', label: 'Chin', min: -0.6, max: 0.7, def: 0, hint: 'receding to strong' },
    { key: 'chinw', label: 'Chin width', min: -0.6, max: 0.7, def: 0 },
    { key: 'earsize', label: 'Ear size', min: -0.6, max: 0.6, def: 0 },
    { key: 'earflap', label: 'Ears', min: -0.5, max: 0.7, def: 0, hint: 'flat to sticking out' },
    { key: 'earpoint', label: 'Pointed ears', min: 0, max: 1, def: 0 },
  ],
};
const ALL = [...CONTROLS.build, ...CONTROLS.head];
export const CONTROL_DEFAULTS = Object.fromEntries(ALL.map((c) => [c.key, c.def]));
const clampTo = (c, v) => Math.min(c.max, Math.max(c.min, Number(v) || 0));

// control values -> morph values for fig.set(); anything not a control keeps the base's default
export function toShape(controls) {
  const s = { ...DEFAULTS };
  for (const c of ALL) { const v = clampTo(c, controls[c.key] ?? c.def); if (c.shape) Object.assign(s, c.shape(v)); else s[c.key] = v; }
  // a little of the heavy body shape and the double chin come with a lot of weight; the head ages with the body
  s.heavyset = Math.max(0, (s.weight - 0.65) * 1.6) * s.gender; s.doubleChin = Math.max(0, (s.weight - 0.7) * 1.5);
  s.headage = (s.age - 0.1) * 0.6; s.arms = (s.weight - 0.5) * 0.8; s.armMuscle = (s.muscle - 0.5) * 0.8; s.pecs = (s.muscle - 0.5) * 0.8 * s.gender; s.lats = (s.muscle - 0.5) * 0.6;
  return s;
}

// Presets: clearly different people, face and body. Values are controls.
export const PRESETS = {
  man: { name: 'Average man', controls: { gender: 1, age: 0.12, weight: 0.5, muscle: 0.55, jaw: 0.2, browr: 0.15, nosew: 0.1 } },
  woman: { name: 'Average woman', controls: { gender: 0, age: 0.1, weight: 0.45, muscle: 0.45, lips: 0.3, cheekbones: 0.25, jaw: -0.2, nosel: -0.15, eyesize: 0.15, browr: -0.2 } },
  powerful: { name: 'Powerful', controls: { gender: 1, age: 0.08, height: 0.2, weight: 0.86, muscle: 0.82, shoulders: 0.9, belly: 0.45, neck: 0.9, headShape: 0.65, headfat: 0.1, browr: 0.6, browh: -0.3, eyesize: -0.2, lids: -0.35, nosew: 0.35, nosel: 0.1, nosehump: 0.3, mouthw: 0.15, lips: -0.1, corners: -0.2, cheekbones: 0.65, cheeks: -0.2, jaw: 0.9, chinjut: 0.3, chinw: 0.55 } },
  lean: { name: 'Lean', controls: { gender: 0.85, age: 0.25, height: 0.45, weight: 0.15, muscle: 0.6, shoulders: 0.1, belly: -0.4, neck: -0.2, headShape: -0.6, cheekbones: 0.6, cheeks: -0.55, jaw: 0.25, chinjut: 0.35, nosel: 0.4, nosehump: 0.45, nosew: -0.3, lips: -0.35, eyespace: -0.15 } },
  heavy: { name: 'Heavy', controls: { gender: 0.7, age: 0.3, height: -0.15, weight: 0.95, muscle: 0.35, shoulders: 0.2, belly: 0.8, neck: 0.5, headShape: -0.2, headfat: 0.55, cheeks: 0.6, cheekbones: -0.3, jaw: 0.3, chinjut: -0.3, nosew: 0.45, lips: 0.3, eyesize: -0.15, lids: -0.2, earsize: 0.2 } },
  old: { name: 'Old', controls: { gender: 0.6, age: 0.88, height: -0.25, weight: 0.45, muscle: 0.25, shoulders: -0.3, belly: 0.3, neck: -0.2, headShape: -0.3, browr: 0.3, browh: -0.2, lids: -0.45, cheeks: -0.4, cheekbones: 0.4, nosel: 0.4, nosehump: 0.35, lips: -0.5, corners: -0.4, earsize: 0.5, earflap: 0.2, chinjut: 0.2 } },
  slight: { name: 'Slight', controls: { gender: 0.25, age: 0.05, height: -0.6, weight: 0.2, muscle: 0.2, shoulders: -0.6, belly: -0.3, neck: -0.5, headShape: -0.35, eyesize: 0.4, eyespace: 0.2, nosew: -0.4, nosel: -0.35, mouthw: -0.25, lips: 0.2, jaw: -0.55, chinjut: -0.1, cheeks: 0.2, earsize: -0.2 } },
  athlete: { name: 'Athletic woman', controls: { gender: 0.08, age: 0.15, height: 0.35, weight: 0.38, muscle: 0.8, shoulders: 0.45, belly: -0.45, neck: 0.1, headShape: 0.2, cheekbones: 0.7, cheeks: -0.3, jaw: 0.25, chinjut: 0.4, nosehump: 0.2, browr: 0.1, lips: 0.1, eyespace: 0.1, lids: -0.1 } },
};

// A random person: every control inside its safe range, most of them near the middle, gender toward either end,
// and the face loosely tied to the build so the two go together.
export function randomControls(rnd = Math.random) {
  const tri = (a, b) => a + (b - a) * ((rnd() + rnd() + rnd()) / 3), c = {};
  for (const k of ALL) c[k.key] = tri(k.min, k.max);
  c.gender = rnd() < 0.5 ? 0.85 + rnd() * 0.15 : rnd() * 0.15; if (rnd() < 0.1) c.gender = 0.35 + rnd() * 0.3;
  c.age = rnd() < 0.7 ? rnd() * 0.4 : 0.4 + rnd() * 0.5;
  c.earpoint = rnd() < 0.85 ? 0 : rnd() * 0.8;
  c.belly = Math.max(c.belly, (c.weight - 0.6) * 1.5);
  c.cheeks = c.cheeks * 0.5 + (c.weight - 0.5) * 0.8;
  for (const k of ALL) c[k.key] = clampTo(k, c[k.key]);
  return c;
}
