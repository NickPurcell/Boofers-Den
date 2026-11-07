/* Clawd crab robot (v2): geometry, leg kinematics and the gait tables.
   One source of truth: the 3D sim animates these tables, and the ESP32 sketch on the page is printed from them.
   Units are millimetres and degrees. Body frame: x to the robot's right, y up (0 = the floor when standing), z forward.

   Each leg is one rigid block hanging from the horn of its swing servo, which turns about a sideways (x) axis, so
   the foot swings forward and back. The swing servo rides on a carriage that slides up and down two steel rods.
   The lift servo is fixed to the frame, and a pin on its horn sits in a horizontal slot in the carriage
   (a Scotch yoke), so carriage height = yokeY + crank * sin(lift angle). All 8 servos are inside the shell. */

export const GEOM = {
  bodyW: 150, bodyD: 124, shellH: 84,  // shell outside size (x, z, y)
  shellBottom: 28,                     // underside of the shell above the floor, standing
  legX: 55, legZ: 34,                  // swing axes, one per corner, at (±legX, ±legZ)
  leg: 56,                             // swing axis to the sole of the foot
  legW: 16,                            // square leg section
  crank: 13,                           // lift-servo horn radius: pin to shaft
  yokeY: 61,                           // lift-servo shaft height: the middle of the carriage's travel
  stride: 30,                          // foot travel per step, along z
  lift: 14,                            // foot clearance at the top of a step
};

// Leg order is also the servo channel order: channel 2i = swing servo of leg i, 2i+1 = lift servo of leg i.
export const LEGS = [
  { id: 'LF', name: 'Left front',  side: -1, end:  1, hip: [-GEOM.legX,  GEOM.legZ] },
  { id: 'RF', name: 'Right front', side:  1, end:  1, hip: [ GEOM.legX,  GEOM.legZ] },
  { id: 'LH', name: 'Left hind',   side: -1, end: -1, hip: [-GEOM.legX, -GEOM.legZ] },
  { id: 'RH', name: 'Right hind',  side:  1, end: -1, hip: [ GEOM.legX, -GEOM.legZ] },
];
export const JOINTS = ['swing', 'lift'];

// Servo mapping: servo angle = 90 + dir * joint angle. Mirror-image modules turn the other way.
// Flip a sign here (and in the sketch) if a joint moves the wrong way on your build.
export const SWING_DIR = [1, -1, 1, -1];
export const LIFT_DIR = [-1, 1, 1, -1];

const D = Math.PI / 180;
const clamp1 = (v) => Math.max(-1, Math.min(1, v));

// Height of the swing axis above the floor for a lift angle, and the lift angle for a swing-axis height.
export const carriageY = (liftDeg) => GEOM.yokeY + GEOM.crank * Math.sin(liftDeg * D);
const liftForCarriage = (y) => Math.asin(clamp1((y - GEOM.yokeY) / GEOM.crank)) / D;

/* Inverse kinematics for one leg. zRel: how far forward of its swing axis the foot should be (mm).
   y: foot height above the floor (mm). Returns [swing, lift] in degrees (swing > 0 = foot forward,
   lift > 0 = carriage up). The swing angle sets fore/aft; the lift raises the carriage to put the foot at the
   right height, which on the ground also cancels the arc the swinging leg would trace. */
export function ik(zRel, y) {
  const swing = Math.asin(clamp1(zRel / GEOM.leg));
  return [swing / D, liftForCarriage(y + GEOM.leg * Math.cos(swing))];
}

/* Foot height for a pair of joint angles, and the lift angle that gives foot height y at a swing angle. */
export const footY = (swingDeg, liftDeg) => carriageY(liftDeg) - GEOM.leg * Math.cos(swingDeg * D);
export const liftFor = (swingDeg, y) => liftForCarriage(y + GEOM.leg * Math.cos(swingDeg * D));

/* Forward kinematics: foot position in the body frame for leg i at joint angles (deg). */
export function fk(i, swingDeg, liftDeg) {
  const L = LEGS[i];
  return [L.hip[0], footY(swingDeg, liftDeg), L.hip[1] + GEOM.leg * Math.sin(swingDeg * D)];
}

/* A gait is a loop of keyframes. Each leg spends `duty` of the loop on the ground, sliding its foot back from
   +stride/2 to -stride/2 in a straight line (that pushes the body forward), then lifts, swings forward and puts
   the foot down again. offsets[i] shifts leg i in time: creep moves one leg at a time (LH, LF, RH, RF), trot
   moves diagonal pairs. sway (mm): creep also shifts the body forward while a hind leg is up and back while a
   front leg is up, which keeps the centre of mass inside the triangle of the other three feet. */
const GAITS = {
  creep: { label: 'Creep', frames: 20, duty: 0.85, offsets: [0.5, 0, 0.75, 0.25], frameMs: 100, sway: 12,
    blurb: 'One leg at a time (left hind, left front, right hind, right front), so three feet are always down, and the body leans away from each leg before it lifts. Slow and steady.' },
  trot: { label: 'Trot', frames: 8, duty: 0.5, offsets: [0, 0.5, 0.5, 0], frameMs: 100,
    blurb: 'Diagonal pairs (left front with right hind, then right front with left hind). Much faster, two feet down: a proper scuttle.' },
};

function footTarget(p, duty) {
  const S = GEOM.stride;
  if (p < duty) return [S / 2 - S * (p / duty), 0];                     // stance: slide back along the floor
  const s = (p - duty) / (1 - duty);                                     // swing: lift, carry forward, lower
  return [-S / 2 + S * s, GEOM.lift * Math.sin(Math.PI * s)];
}

/* Builds the integer joint-angle table: rows = keyframes, 8 columns in channel order (LF swing, LF lift, RF swing, ...). */
export function buildGait(key) {
  const g = GAITS[key];
  const table = [];
  const hindSwing = (g.duty - g.offsets[2] + 1) % 1 + (1 - g.duty) / 2;   // middle of the left hind leg's swing
  for (let k = 0; k < g.frames; k++) {
    const sway = (g.sway || 0) * Math.cos(4 * Math.PI * (k / g.frames - hindSwing));
    const row = [];
    for (let i = 0; i < 4; i++) {
      const p = (k / g.frames + g.offsets[i]) % 1;
      const [z, y] = footTarget(p, g.duty);
      const [swing, lift] = ik(z - sway, y);
      row.push(Math.round(swing), Math.round(lift));
    }
    table.push(row);
  }
  return { key, ...g, table };
}

export const GAIT_KEYS = Object.keys(GAITS);

/* Turning: each side's stride is scaled (skid steering). turn in [-1, 1], > 0 = turn right (left legs take longer steps). */
export function sideScale(turn) {
  let kl = 1 + turn, kr = 1 - turn;
  const m = Math.max(1, Math.abs(kl), Math.abs(kr));
  return [kl / m, kr / m];
}

/* Joint angles at a fractional keyframe position f (linear between keyframes, wrapping).
   k[i] scales leg i's swing angle (from sideScale; 1 = straight); its lift angle is then re-solved so the foot
   stays at the height the table asks for. */
export function anglesAt(gait, f, k = [1, 1, 1, 1]) {
  const n = gait.frames;
  const k0 = Math.floor(f) % n, k1 = (k0 + 1) % n, a = f - Math.floor(f);
  const out = new Array(8);
  for (let i = 0; i < 4; i++) {
    const s = gait.table[k0][2 * i] * (1 - a) + gait.table[k1][2 * i] * a;
    const l = gait.table[k0][2 * i + 1] * (1 - a) + gait.table[k1][2 * i + 1] * a;
    if (k[i] === 1) { out[2 * i] = s; out[2 * i + 1] = l; continue; }
    out[2 * i] = s * k[i];
    out[2 * i + 1] = liftFor(s * k[i], footY(s, l));
  }
  return out;
}

export const servoAngle = (j, jointDeg) => 90 + (j % 2 === 0 ? SWING_DIR[j >> 1] : LIFT_DIR[j >> 1]) * jointDeg;

// Swing progress of leg i at keyframe position f: 0..1 while the foot is in the air, null while it is down.
function swingAt(g, f, i) {
  const p = (f / g.frames + g.offsets[i]) % 1;
  return p >= g.duty ? (p - g.duty) / (1 - g.duty) : null;
}
export const DOWN_MM = 0.5;   // a foot this close to the floor counts as down
export const rowFootDown = (row, i) => footY(row[2 * i], row[2 * i + 1]) < DOWN_MM;
const allDown = (g, k) => [0, 1, 2, 3].every((i) => rowFootDown(g.table[k], i));
export const SWING_ORDER = [2, 0, 3, 1];   // LH, LF, RH, RF: the creep order, also used to re-plant feet on a gait change
export const STEP_MS = 150;               // per half-step while re-planting

/* Plays a gait. The ESP32 sketch runs the same logic (step() there).
   - A new turn value reaches a leg only while that leg is in the air, so feet on the ground never get dragged.
   - A gait change waits for a keyframe with all four feet down, then moves the feet one at a time
     (lift, swing, put down) to the new gait's first keyframe, and carries on in the new gait. */
export class Player {
  constructor(key = 'creep') {
    this.gait = buildGait(key); this.f = 0; this.turn = 0; this.k = [1, 1, 1, 1];
    this.next = null; this.queue = null; this.qf = 0;
    this.angles = anglesAt(this.gait, 0, this.k);
  }
  setGait(key) { this.next = key === this.gait.key ? null : key; }
  get changing() { return !!(this.next || this.queue); }
  step(ms) {
    if (this.queue) return this.replant(ms);
    const g = this.gait, n = g.frames, f0 = this.f, f1 = f0 + ms / g.frameMs;
    const [kl, kr] = sideScale(this.turn);
    for (let i = 0; i < 4; i++) {
      const s0 = swingAt(g, f0, i), s1 = swingAt(g, f1 % n, i), target = LEGS[i].side < 0 ? kl : kr;
      if (s0 !== null && s1 === null) this.k[i] = target;                       // just touched down
      else if (s0 !== null && s1 > s0) this.k[i] += (target - this.k[i]) * Math.min(1, (s1 - s0) / (1 - s0));
    }
    if (this.next) {
      for (let k = Math.floor(f0) + 1; k <= f1; k++) {
        if (allDown(g, k % n)) { this.f = k % n; this.startReplant(); return this.angles; }
      }
    }
    this.f = f1 % n;
    return this.angles = anglesAt(g, this.f, this.k);
  }
  startReplant() {
    let cur = anglesAt(this.gait, this.f, this.k);
    this.gait = buildGait(this.next); this.next = null; this.f = 0;
    const target = anglesAt(this.gait, 0, this.k);
    const rows = [cur];
    for (const i of SWING_ORDER) {
      if (Math.abs(cur[2 * i] - target[2 * i]) < 0.5) continue;
      const mid = cur.slice(); mid[2 * i] = (cur[2 * i] + target[2 * i]) / 2; mid[2 * i + 1] = liftFor(mid[2 * i], GEOM.lift);
      cur = cur.slice(); cur[2 * i] = target[2 * i]; cur[2 * i + 1] = target[2 * i + 1];
      rows.push(mid, cur);
    }
    this.queue = rows.length > 1 ? rows : null; this.qf = 0;
    this.angles = rows[0];
  }
  replant(ms) {
    const q = this.queue;
    this.qf += ms / STEP_MS;
    if (this.qf >= q.length - 1) { this.queue = null; return this.angles = anglesAt(this.gait, 0, this.k); }
    const r = Math.floor(this.qf), a = this.qf - r;
    return this.angles = q[r].map((v, j) => v * (1 - a) + q[r + 1][j] * a);
  }
}

/* Where the body goes. Each foot that touches the ground is pinned to that spot in the world; every update the
   body takes the rigid pose (x, z, heading) that best fits its pinned feet (least squares). So the body moves
   by the stance legs' displacement. Walking straight the feet slide in exact straight lines, so they stay put;
   turning is skid steering, and what the fit can't match is reported as `slip`, in mm. */
export class Walker {
  constructor() { this.x = 0; this.z = 0; this.th = 0; this.pins = [null, null, null, null]; this.feet = []; this.slip = 0; this.onTouchdown = null; }
  toWorld(p) {
    const c = Math.cos(this.th), s = Math.sin(this.th);
    return [this.x + p[0] * c + p[2] * s, this.z - p[0] * s + p[2] * c];
  }
  update(angles) {
    const F = this.feet = LEGS.map((_, i) => fk(i, angles[2 * i], angles[2 * i + 1]));
    const down = F.map((p) => p[1] < DOWN_MM);
    for (let i = 0; i < 4; i++) if (!down[i]) this.pins[i] = null;
    const use = [0, 1, 2, 3].filter((i) => down[i] && this.pins[i]);
    if (use.length) {
      let bx = 0, bz = 0, ax = 0, az = 0;
      for (const i of use) { bx += F[i][0]; bz += F[i][2]; ax += this.pins[i][0]; az += this.pins[i][1]; }
      bx /= use.length; bz /= use.length; ax /= use.length; az /= use.length;
      if (use.length > 1) {
        let sn = 0, cs = 0;
        for (const i of use) {
          const px = F[i][0] - bx, pz = F[i][2] - bz, qx = this.pins[i][0] - ax, qz = this.pins[i][1] - az;
          sn += px * qz - pz * qx; cs += px * qx + pz * qz;
        }
        this.th = -Math.atan2(sn, cs);
      }
      const c = Math.cos(this.th), s = Math.sin(this.th);
      this.x = ax - (bx * c + bz * s); this.z = az - (-bx * s + bz * c);
    }
    let e = 0;
    for (const i of use) { const w = this.toWorld(F[i]); e = Math.max(e, Math.hypot(w[0] - this.pins[i][0], w[1] - this.pins[i][1])); }
    this.slip = e;
    for (let i = 0; i < 4; i++) if (down[i] && !this.pins[i]) { this.pins[i] = this.toWorld(F[i]); if (this.onTouchdown) this.onTouchdown(i, this.pins[i]); }
    return F;
  }
}
