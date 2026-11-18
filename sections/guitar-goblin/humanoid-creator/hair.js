// Hair, sculpted: each style is a solid shape that hugs the head as built (so it fits any face), stands off it by a
// thickness that varies over the scalp, stops at the hairline, and is combed into locks by shallow grooves that
// follow the way the hair lies. Tails, knots, braids and long hair add their own masses. Pure: a worker can import
// it. All in the head's frame: metres from the point between the eyes, y up, facing +z.
import { sphere, ellipsoid, capsule, roundCone, smin, ssub } from '../duros-creator/sdf.js';

// The hairline, as a height for each angle round the head (0 the front, positive toward the figure's left): across
// the forehead, down the temple to the sideburn, up behind the ear, and down to the nape. The face's paint draws the
// roots to the same line.
export function hairline(a) {
  const b = Math.abs(a);
  const w = b < 1.3 ? 0.0026 * Math.sin(a * 19 + 0.7) + 0.0019 * Math.sin(a * 37 + 1.3) : 0;   // no hairline is a clean line
  if (b < 0.75) return 0.071 - 0.012 * (b / 0.75) ** 2 + w;
  if (b < 1.2) return 0.059 - 0.05 * ((b - 0.75) / 0.45) + w;
  if (b < 1.42) return 0.009 - 0.04 * ((b - 1.2) / 0.22);
  if (b < 1.9) return -0.031 + 0.045 * Math.sqrt((b - 1.42) / 0.48);
  return 0.014 - 0.075 * ((b - 1.9) / 1.24);
}
const hash = (i) => { const s = Math.sin(i * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// locks: 0 on a lock's crest, 1 in the groove between two, for a coordinate u that runs across the way the hair lies;
// n locks per unit of u, each a little different in width
function strands(u, n) {
  const t = u * n, i = Math.floor(t), w = 0.5 + 0.35 * (hash(i) - 0.5), f = t - i;
  const d = f < w ? f / w : (1 - f) / (1 - w);   // 0 at both edges of the lock, 1 at its crest
  return 1 - Math.pow(d, 0.55);
}
// hair lies in clumps of different widths, each made of finer strands: deep grooves between clumps, shallow within
const locks = (u, n) => 0.42 * strands(u, n) * (0.5 + hash(Math.floor(u * n) + 71)) + 0.85 * strands(u + 0.137, n * 0.29);

export const STYLES = {
  bald: { name: 'Bald', roots: 0 },
  shaved: { name: 'Shaved', roots: 0.5 },
  crop: { name: 'Short crop', roots: 0.9 },
  swept: { name: 'Swept back', roots: 0.9 },
  bob: { name: 'Bob', roots: 0.9 },
  tail: { name: 'Tail', roots: 0.9 },
  knot: { name: 'Topknot', roots: 0.9 },
  braid: { name: 'Long braid', roots: 0.9 },
  long: { name: 'Long', roots: 0.9 },
  crest: { name: 'Crest', roots: 0.45 },
};

// head: the head's own field (this frame). Returns null for a style with no sculpted hair.
export function hairField(style, head) {
  if (style === 'bald' || style === 'shaved' || !STYLES[style]) return null;
  const C = [0, 0.03, -0.012];   // the middle of the skull
  // the two ways hair lies: combed straight back (locks follow lines of constant angle round the front-to-back axis)
  // and falling from the crown (locks follow lines of constant angle round the upright axis)
  const back = (x, y) => Math.atan2(x, y - C[1]) / (2 * Math.PI) + 0.5, fall = (x, z) => Math.atan2(x, -(z - C[2])) / (2 * Math.PI) + 0.5;
  const line = (x, y, z) => hairline(Math.atan2(x, z)) - y;   // negative above the hairline
  // a cap of hair: thickness t(x, y, z) over the scalp, grooved by g (0..1), kept above the hairline (or `edge`)
  const cap = (t, groove, depth, edge = line) => (x, y, z) => {
    const d = head(x, y, z);
    if (d > 0.07) return d - 0.05;
    const e = edge(x, y, z), th = t(x, y, z) * (0.16 + 0.84 * sstep(0, 0.022, -e));   // hair rises out of the scalp at the hairline; it does not stand there like the rim of a helmet
    return Math.max(d - th + depth * groove(x, y, z) * Math.min(1, th / 0.008), e * 0.7);
  };
  let f, bounds = [[-0.12, -0.1, -0.14], [0.12, 0.16, 0.12]];
  if (style === 'crop') {
    f = cap((x, y, z) => 0.0065 + 0.006 * sstep(0.03, 0.09, y) + 0.004 * sstep(0.02, 0.07, z) * sstep(0.05, 0.08, y), (x, y, z) => locks(back(x, y), 54), 0.0022);
  } else if (style === 'swept') {
    f = cap((x, y, z) => 0.009 + 0.011 * sstep(0.035, 0.1, y) + 0.008 * sstep(0.03, 0.075, z) * sstep(0.05, 0.085, y) - 0.003 * sstep(0.04, 0.075, Math.abs(x)) * (1 - sstep(0.06, 0.1, y)), (x, y, z) => locks(back(x, y), 38), 0.0034);
  } else if (style === 'crest') {
    // a strip over the top from brow to nape, the sides shaved to the roots
    const strip = (x, y, z) => Math.max(line(x, y, z), Math.abs(x) - 0.03 - 0.008 * sstep(0.0, -0.08, z));
    f = cap((x, y, z) => 0.012 + 0.02 * sstep(0.02, 0.1, y) * (1 - sstep(-0.11, -0.03, -z) * 0), (x, y, z) => locks(back(x, y) * 1.0, 40), 0.004, strip);
  } else {
    // a close cap combed back, for styles gathered behind; or falling from a centre parting, for hair worn down
    const tied = style === 'tail' || style === 'knot' || style === 'braid';
    const base = tied
      ? cap((x, y, z) => 0.0075 + 0.005 * sstep(0.03, 0.09, y), (x, y, z) => locks(back(x, y), 44), 0.0026)
      : cap((x, y, z) => 0.01 + 0.008 * sstep(0.02, 0.09, y) + 0.01 * sstep(0.035, 0.075, Math.abs(x)) * (1 - sstep(0.06, 0.1, y)), (x, y, z) => locks(fall(x, z), 34), 0.0036,
        (x, y, z) => { const a = Math.abs(Math.atan2(x, z)); return Math.max(line(x, y, z), a > 0.95 ? 0.02 - y : -1); });   // no sideburns: the curtain covers the sides
    f = base;
    if (style === 'tail') {
      const tie = [0, 0.062, -0.108], tail = smin(0.012, roundCone(tie, [0, -0.02, -0.132], 0.021, 0.024), roundCone([0, -0.02, -0.132], [0, -0.115, -0.118], 0.024, 0.011));
      const grooved = (x, y, z) => tail(x, y, z) + 0.003 * locks(Math.atan2(x, z + 0.125) / (2 * Math.PI) + 0.5, 12);
      f = smin(0.006, f, grooved); bounds = [[-0.12, -0.14, -0.17], [0.12, 0.16, 0.12]];
    } else if (style === 'knot') {
      const knot = ellipsoid(0, 0.118, -0.05, 0.032, 0.027, 0.034), stem = capsule([0, 0.095, -0.045], [0, 0.11, -0.05], 0.02);
      const grooved = (x, y, z) => knot(x, y, z) + 0.0028 * locks(Math.atan2(x, z + 0.05) / (2 * Math.PI) + 0.5 + y * 6, 12);
      f = smin(0.005, f, smin(0.004, grooved, stem)); bounds = [[-0.12, -0.1, -0.14], [0.12, 0.17, 0.12]];
    } else if (style === 'braid') {
      // a rope of fat knuckles down the back, each turned against the last
      let br = null;
      for (let k = 0; k < 9; k++) { const y = 0.03 - k * 0.031, z = -0.112 - 0.012 * Math.sin(k * 0.5), r = 0.021 - k * 0.0011, s = k % 2 ? 1 : -1; const b = ellipsoid(s * 0.005, y, z, r, 0.019, r * 0.9); br = br ? smin(0.004, br, b) : b; }
      f = smin(0.008, f, smin(0.01, br, roundCone([0, 0.07, -0.1], [0, 0.03, -0.112], 0.026, 0.022))); bounds = [[-0.12, -0.27, -0.17], [0.12, 0.16, 0.12]];
    } else {
      // hair worn down: a curtain hanging from the cap round the sides and back, open over the face, to the jaw
      // (bob) or the shoulder blades (long)
      const long = style === 'long', bottom = long ? -0.27 : -0.082;
      const shell = (x, y, z) => {
        // an egg round the head and neck, a little wider toward the bottom on long hair, the locks falling down it
        const w = 0.0935 + (long ? 0.012 * sstep(-0.05, -0.22, y) : 0.004 * sstep(0.02, -0.07, y)), dz = z + 0.02 + (long ? 0.035 * sstep(-0.08, -0.26, y) : 0);
        const d = (Math.hypot(x / w, dz / (w * 1.16)) - 1) * w + 0.0034 * locks(fall(x, z), 34);
        // open in front: the hair parts round the face, from the temple to in front of the ear and along the jaw
        const th = Math.abs(Math.atan2(x, z)), edge = 0.74 + 0.5 * sstep(0.06, -0.03, y) + (long ? 0.34 * sstep(-0.07, -0.17, y) : 0.06 * sstep(-0.03, -0.08, y));
        const tip = long ? 0 : 0.012 * sstep(1.9, 1.0, th);   // a bob's ends are a little longer toward the front
        return Math.max(d, bottom - tip - y, y - 0.07, (edge - th) * 0.08);
      };
      f = smin(0.014, f, shell); bounds = long ? [[-0.14, -0.29, -0.18], [0.14, 0.16, 0.13]] : [[-0.13, -0.11, -0.15], [0.13, 0.16, 0.13]];
      // never inside the head and neck, and not on the face
      const h0 = f; f = (x, y, z) => Math.max(h0(x, y, z), -(head(x, y, z) - 0.0015));
    }
  }
  return { field: f, bounds };
}
