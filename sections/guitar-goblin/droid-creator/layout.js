// How a utility droid's barrel is panelled, and how a paint scheme colours it.
//
// A layout is a tree. U(...) splits a rectangle of the unrolled barrel across (weights, left to right as you face
// the droid); V(...) splits it down (weights, top to bottom). The leaves are things: a plain panel, a door with a
// second line inside it, a tool-arm slot, a vent, and so on (utility.js builds each kind). Because every leaf owns
// its own rectangle, the panels tile with real gaps and nothing overlaps.
//
// These are our own arrangements in the idiom the references share (a centre line, two arm slots up top, vents
// under them, ports and grilles low down); none is a copy of one unit's body.
import { ROLE } from './hard.js';

export const U = (...parts) => ({ split: 'u', parts });
export const V = (...parts) => ({ split: 'v', parts });
const L = (kind, o = {}) => ({ kind, ...o });
const skin = (o) => L('skin', o), door = (o) => L('door', o), rim = () => L('skin', { tag: 'rim' });

// two tool-arm slots, one above the other, with the arms lying in them
const arms = (flip) => V(
  [14, skin()],
  [30, U([5, skin()], [90, L('bar', { flip })], [5, skin()])],
  [15, skin()],
  [30, U([5, skin()], [90, L('bar', { flip: !flip })], [5, skin()])],
  [16, skin()],
);
const shoulder = () => V([30, rim()], [176, L('shoulder')], [224, skin({ tag: 'side' })], [60, rim()]);

// the back: two tall doors either side of a spine, a heat exhaust low down
const back = (mirror) => {
  const cols = [[10, V([35, rim()], [70, skin()], [70, L('lights')], [165, skin()], [90, skin()], [60, rim()])],
    [33, V([35, rim()], [305, door({ tag: 'block' })], [90, L('hatch')], [60, rim()])],
    [33, V([35, rim()], [105, door()], [200, door({ drop: true })], [90, L('grille', { slats: 7 })], [60, rim()])]];
  return U(...(mirror ? cols.slice().reverse() : cols));
};

export const LAYOUTS = {
  // the works standard: a centre line, arm slots, a pair of vents with a column of slots beside them
  standard: {
    name: 'Standard',
    tree: () => U(
      [76, back(false)], [28, shoulder()],
      [152, V(
        [35, U([20, rim()], [112, rim()], [20, rim()])],
        [105, U([30, door()], [92, arms(false)], [30, door()])],
        [200, U([32, door({ drop: true })], [14, L('slots', { n: 6 })], [40, V([1, L('vent')], [1, L('vent')])], [28, V([62, door({ tag: 'block' })], [38, skin()])], [38, door()])],
        [90, U([26, L('grille', { slats: 6 })], [22, L('hatch')], [28, L('coupling')], [22, V([1, skin()], [1, skin()])], [26, L('port')], [28, L('grille', { slats: 6 })])],
        [60, U([1, rim()], [1, rim()], [1, rim()], [1, rim()])],
      )],
      [28, shoulder()], [76, back(true)],
    ),
  },
  // a technician's unit: the vents moved off-centre for a tall instrument door, more hatches
  technician: {
    name: 'Technician',
    tree: () => U(
      [76, back(false)], [28, shoulder()],
      [152, V(
        [35, U([1, rim()], [1, rim()], [1, rim()])],
        [105, U([52, V([1, door()], [1, L('lights')])], [100, arms(true)])],
        [200, U([20, door()], [34, V([1, L('vent')], [1, L('vent')])], [14, L('slots', { n: 5 })], [36, door({ tag: 'block' })], [22, V([1, L('hatch')], [1, L('hatch')])], [26, door({ drop: true })])],
        [90, U([28, L('grille', { slats: 6 })], [30, L('port')], [36, V([1, skin()], [1, skin()])], [30, L('coupling')], [28, L('grille', { slats: 6 })])],
        [60, U([1, rim()], [2, rim()], [1, rim()])],
      )],
      [28, shoulder()], [76, back(true)],
    ),
  },
  // a hauler: big plain doors, one wide vent, little else to break
  hauler: {
    name: 'Hauler',
    tree: () => U(
      [76, back(false)], [28, shoulder()],
      [152, V(
        [35, U([1, rim()])],
        [70, U([24, skin()], [104, V([20, skin()], [30, U([5, skin()], [90, L('bar', { flip: false })], [5, skin()])], [20, skin()])], [24, skin()])],
        [235, U([48, door({ tag: 'block' })], [56, V([40, L('vent')], [60, door({ drop: true })])], [48, door({ tag: 'block' })])],
        [90, U([30, L('grille', { slats: 7 })], [30, L('coupling')], [32, L('slots', { n: 3, across: true })], [30, L('port')], [30, L('grille', { slats: 7 })])],
        [60, U([1, rim()], [1, rim()])],
      )],
      [28, shoulder()], [76, back(true)],
    ),
  },
};

// Walk a layout over the barrel: u from -180 to 180 degrees (0 is the front), v from 0 at the bottom to `height`.
export function walk(node, r, emit) {
  if (node.split) {
    const total = node.parts.reduce((s, p) => s + p[0], 0);
    if (node.split === 'u') { let u = r[0]; for (const [w, child] of node.parts) { const du = ((r[1] - r[0]) * w) / total; walk(child, [u, u + du, r[2], r[3]], emit); u += du; } }
    else { let v = r[3]; for (const [w, child] of node.parts) { const dv = ((r[3] - r[2]) * w) / total; walk(child, [r[0], r[1], v - dv, v], emit); v -= dv; } }
  } else emit(node, r);
}

/* ---------------- paint schemes ---------------- */
// A scheme answers one question: what is this part painted? `tag` says what the part is; `at` says where
// (deg: degrees round from the front, i: its number in a row of like parts).
const { primary: P, secondary: S, metal: MT } = ROLE;
const front = (at, w) => Math.abs(at.deg ?? 999) < w;
export const SCHEMES = {
  service: { name: 'Service', role: (tag, at) => ({ trim: S, block: S, strut: S, eye: S, foottrim: S, hub: MT, domeskin: MT, cap: MT, band: at.i % 2 ? MT : S, crown: at.i % 2 ? S : MT })[tag] ?? P },
  solid: { name: 'Solid', role: (tag, at) => ({ trim: MT, band: MT, hub: MT, cap: MT, block: S, strut: S, eye: S, foottrim: MT })[tag] ?? P },
  stripe: { name: 'Stripe', role: (tag, at) => {
    if (tag === 'trim' || tag === 'hub' || tag === 'cap') return MT;
    if (tag === 'strut' || tag === 'eye') return S;
    if (['skin', 'door', 'rim', 'block', 'band', 'crown', 'domeskin', 'side'].includes(tag) && front(at, 17)) return S;
    return P;
  } },
  banded: { name: 'Banded', role: (tag, at) => ({ rim: S, band: S, trim: MT, hub: MT, cap: S, eye: MT, strut: MT, foottrim: S, shoulder: S })[tag] ?? P },
  twotone: { name: 'Two-tone', role: (tag, at) => ({ domeskin: S, crown: S, cap: S, legskin: S, shoulder: S, footskin: S, trim: MT, band: MT, hub: MT, eye: MT, strut: MT, foottrim: MT })[tag] ?? P },
  bare: { name: 'Bare metal', role: (tag, at) => ({ skirt: ROLE.steel, trim: P, band: at.i % 2 ? P : MT, block: S, strut: S, eye: P, foottrim: P, crown: at.i % 3 === 0 ? S : MT, cap: P })[tag] ?? MT },
};
