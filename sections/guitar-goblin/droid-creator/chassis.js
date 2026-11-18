// The kinds of droid this page can build. Each chassis says what can be chosen for it, how to build its pieces,
// which piece hangs on which, how to pose them, and where the cameras stand.
// Each opens in colours and a layout of our own, chosen so that no default echoes a well-known unit; any look a
// person builds from the options is theirs.
import * as THREE from 'three';
import { M, ROLE } from './hard.js';
import { buildUtility, poseUtility } from './utility.js';
import { LAYOUTS, SCHEMES } from './layout.js';
import { DOMES } from './domes.js';
import { FITTINGS, addFittings, antennaAt, boltAt } from './fittings.js';
import { buildPower, posePower, BOX } from './power.js';

const named = (o) => Object.entries(o).map(([key, v]) => ({ key, name: v.name }));
const schemes = named(SCHEMES);

// jump leads for the power droid: two cables hanging in a loop from the coupling on its side, with a clamp each
function leads(K) {
  const x = BOX.W / 2 + 0.008, m = K.main;
  for (const [dz, role] of [[0, ROLE.rubber], [0.022, ROLE.brass]]) {
    m.tube([[x - 0.006, 0.368, dz - 0.012], [x + 0.045, 0.34, dz], [x + 0.062, 0.25, dz + 0.05], [x + 0.05, 0.18, dz + 0.11], [x + 0.03, 0.25, dz + 0.17], [x + 0.014, 0.42, dz + 0.175], [x + 0.008, 0.54, dz + 0.17]], 0.006, { role, sides: 8, n: 30 });
    m.at(M.mul(M.t(x + 0.008, 0.565, dz + 0.17), M.rx(-Math.PI / 2)), (b) => { b.cyl(0.0085, -0.03, 0.0, { role: ROLE.steel, n: 10, bevel: 0.001 }); b.box(0.012, 0.007, 0.05, { role: ROLE.brass, bevel: 0.001 }); });
  }
  m.at(M.mul(M.t(x - 0.004, 0.58, 0.18), M.ry(Math.PI / 2)), (b) => b.box(0.07, 0.03, 0.014, { role: ROLE.steel, rad: 0.004, bevel: 0.002 }));   // the rail the clamps bite
}

export const CHASSIS = {
  utility: {
    name: 'Utility', noun: 'Utility droid', headName: 'Dome',
    options: {
      form: { label: 'Dome', items: named(DOMES) },
      layout: { label: 'Panel layout', items: named(LAYOUTS) },
      scheme: { label: 'Paint scheme', items: schemes },
      stance: { label: 'Stance', items: [{ key: 'two', name: 'Two legs' }, { key: 'three', name: 'Three legs' }] },
      look: { label: 'Looking', items: [{ key: 'left', name: 'Left' }, { key: 'ahead', name: 'Ahead' }, { key: 'right', name: 'Right' }] },
      kit: { label: 'Attachments', multi: true, items: named(FITTINGS) },
    },
    defaults: { form: 'round', layout: 'technician', scheme: 'banded', stance: 'three', look: 'ahead', kit: '', primary: 'yellow', secondary: 'graphite', finish: 'paint', eye: 'amber' },
    moves: ['stance', 'look'],
    anim: { stance: (s) => (s.stance === 'three' ? 1 : 0), look: (s) => (s.look === 'left' ? -1 : s.look === 'right' ? 1 : 0) },
    build(state, on) { const st = { ...state, dome: state.form }, kits = buildUtility(st); addFittings(kits, st, on); return kits; },
    place(g, root) { g.body.add(g.dome, g.midLeg); g.midLeg.add(g.midFoot); root.add(g.body, g.legL, g.legR, g.footL, g.footR); },
    pose: (g, a) => poseUtility(g, a.stance, a.look),
    views: { whole: { target: [0, 0.53, 0], pos: [1.07, 0.9, 2.74] }, head: { target: [0, 0.9, 0.02], pos: [0.5, 1.06, 1.22] } },
    token(g) { const y = g.body.position.y + 0.2; return { pos: [0.3, y + 0.16, 1.5], target: [0, y, -0.04] }; },
    describe: (n) => `${n('form')} dome, ${n('layout')} panels`,
  },
  power: {
    name: 'Power', noun: 'Power droid', headName: 'Face',
    options: {
      scheme: { label: 'Paint scheme', items: schemes },
      stance: { label: 'Stance', items: [{ key: 'stand', name: 'Standing' }, { key: 'step', name: 'Mid-step' }] },
      kit: { label: 'Attachments', multi: true, items: [{ key: 'antenna', name: 'Antenna' }, { key: 'bolt', name: 'Restraining bolt' }, { key: 'leads', name: 'Jump leads' }] },
    },
    defaults: { scheme: 'solid', stance: 'stand', kit: '', primary: 'sand', secondary: 'graphite', finish: 'paint', eye: 'red' },
    moves: ['stance'],
    anim: { stance: (s) => (s.stance === 'step' ? 1 : 0) },
    build(state, on) {
      const kits = buildPower(state);
      if (on.has('antenna')) antennaAt(kits.body, [-0.115, BOX.top + 0.022, 0.14], 0.19);
      if (on.has('bolt')) boltAt(kits.body, M.t(-0.13, 0.52, BOX.D / 2 + 0.0065));
      if (on.has('leads')) leads(kits.body);
      return kits;
    },
    place(g, root) { root.add(g.body, g.legL, g.legR); },
    pose: (g, a) => posePower(g, a.stance),
    views: { whole: { target: [0, 0.47, 0], pos: [1.1, 0.86, 2.66] }, head: { target: [0, 0.8, 0.27], pos: [0.44, 0.94, 1.32] } },
    token() { return { pos: [0.36, 0.96, 1.66], target: [0, 0.72, 0] }; },
    describe: () => 'a walking battery',
  },
};
