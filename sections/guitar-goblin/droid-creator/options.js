// Droid creator: what a droid can be, as lists (no page here, so a node script can read them): the panel reads them, and the
// look parser's whitelist is made from them (tests/human-base/look-schema.mjs), so the table reads a look as the page does.
import { CHASSIS } from './chassis.js';

/* ---------------- the options ---------------- */
export const PAINTS = [
  { key: 'white', name: 'Works white', c: '#e6e3da' }, { key: 'cream', name: 'Cream', c: '#d6c59c' }, { key: 'sand', name: 'Sand', c: '#b3976a' },
  { key: 'grey', name: 'Hull grey', c: '#89919a' }, { key: 'graphite', name: 'Graphite', c: '#3a3f46' }, { key: 'black', name: 'Black', c: '#16171a' },
  { key: 'navy', name: 'Navy', c: '#1d3765' }, { key: 'blue', name: 'Signal blue', c: '#2a60b6' }, { key: 'teal', name: 'Teal', c: '#1c7676' },
  { key: 'green', name: 'Field green', c: '#3c6938' }, { key: 'olive', name: 'Olive', c: '#676639' }, { key: 'yellow', name: 'Hazard yellow', c: '#d6a01a' },
  { key: 'orange', name: 'Orange', c: '#cf5d1d' }, { key: 'red', name: 'Oxide red', c: '#a22d24' }, { key: 'maroon', name: 'Maroon', c: '#5c1e23' },
  { key: 'violet', name: 'Violet', c: '#573d86' },
];
export const EYES = [
  { key: 'red', name: 'Red', c: '#ff3a26' }, { key: 'blue', name: 'Blue', c: '#3d8bff' }, { key: 'amber', name: 'Amber', c: '#ffa51f' },
  { key: 'green', name: 'Green', c: '#35f58a' }, { key: 'white', name: 'White', c: '#e6f2ff' }, { key: 'violet', name: 'Violet', c: '#b25cff' },
];
// what every chassis shares; a chassis adds its own between `chassis` and the colours (chassis.js)
export const SHARED_FIRST = { chassis: { label: 'Chassis', items: Object.entries(CHASSIS).map(([key, c]) => ({ key, name: c.name })) } };
export const SHARED_LAST = {
  primary: { label: 'Main colour', swatch: true, items: PAINTS },
  secondary: { label: 'Second colour', swatch: true, items: PAINTS },
  finish: { label: 'Finish', items: [{ key: 'paint', name: 'Painted' }, { key: 'metal', name: 'Metallic' }] },
  eye: { label: 'Photoreceptor', swatch: true, items: EYES },
  wear: { label: 'Weathering', items: [{ key: 'fresh', name: 'Factory fresh', w: 0.0 }, { key: 'worn', name: 'In service', w: 0.45 }, { key: 'battered', name: 'Battered', w: 0.72 }, { key: 'scavenged', name: 'Scavenged', w: 1.0 }] },
};
export const SHARED_DEFAULT = { chassis: 't3', primary: 'sand', secondary: 'graphite', finish: 'paint', eye: 'red', wear: 'worn', seed: '7' };
