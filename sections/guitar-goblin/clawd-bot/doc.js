/* The design doc's generated parts: the gait tables and the ESP32 sketch, both printed from gait.js,
   so the robot runs exactly what the sim shows. */
import { GEOM, LEGS, SWING_DIR, LIFT_DIR, GAIT_KEYS, buildGait, rowFootDown, DOWN_MM, SWING_ORDER, STEP_MS } from './gait.js';

const $ = (s) => document.querySelector(s);
const gaits = GAIT_KEYS.map(buildGait);

/* ---------- gait tables ---------- */
const head = '<tr><th scope="col">Frame</th>' + LEGS.map((L) => `<th scope="col" colspan="2">${L.id}<small>swing · lift</small></th>`).join('') + '</tr>';
$('#gait-tables').innerHTML = gaits.map((g) => `
  <h3>${g.label}: ${g.frames} keyframes, ${g.frameMs} ms each</h3>
  <p>${g.blurb} Each foot is on the ground for ${Math.round(g.duty * 100)}% of the cycle.</p>
  <div class="tablewrap"><table class="gait" data-gait="${g.key}">
    <caption class="sr">${g.label} gait joint angles in degrees</caption>
    <thead>${head}</thead>
    <tbody>${g.table.map((row, k) => `<tr data-k="${k}"><th scope="row">${k}</th>` +
      row.map((v, j) => `<td class="${j % 2 ? 'kn' : 'hp'}${j % 2 && !rowFootDown(row, j >> 1) ? ' up' : ''}">${v}</td>`).join('') + '</tr>').join('')}
    </tbody>
  </table></div>`).join('');

// The sim announces which keyframe it is on; light up that row.
let lit = null;
document.addEventListener('clawd:frame', (e) => {
  const { gait, k } = e.detail;
  const row = document.querySelector(`table.gait[data-gait="${gait}"] tr[data-k="${k}"]`);
  if (row === lit) return;
  if (lit) lit.classList.remove('now');
  if (row) row.classList.add('now');
  lit = row;
});

/* ---------- the sketch ---------- */
const arr = (t) => t.map((r) => '  { ' + r.map((v) => String(v).padStart(3)).join(', ') + ' },').join('\n');
const num = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v)) + 'f';
const gaitRow = (g, name) => `  { ${name}, ${String(g.frames).padStart(2)}, ${num(g.duty)}, { ${g.offsets.map(num).join(', ')} }, ${g.frameMs} },`;
const creep = gaits.find((g) => g.key === 'creep'), trot = gaits.find((g) => g.key === 'trot');

const sketch = `// Clawd crab robot (v2): 8 servos, all inside the shell, on a PCA9685 driven by an ESP32.
// Printed from the same gait tables as the 3D sim at
// https://boofers-den.vercel.app/sections/guitar-goblin/clawd-bot/
//
// Each rigid leg hangs from a swing servo (foot forward and back). The swing servo rides on a carriage that slides
// up and down two rods; the lift servo moves the carriage through a Scotch yoke (a pin on its horn in a slot).
//
// Library: "Adafruit PWM Servo Driver Library" (Arduino Library Manager). Board: "ESP32 Dev Module".
// Wiring: PCA9685 SDA -> GPIO21, SCL -> GPIO22, VCC -> 3V3, GND -> GND. Servo power (V+) from the 6 V buck.
// Serial monitor at 115200 baud, one letter at a time:
//   w = walk / stop   c = creep   t = trot   a = turn left   d = turn right   s = straight   + / - = speed

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pca(0x40);

// Channels: 0 LF swing, 1 LF lift, 2 RF swing, 3 RF lift, 4 LH swing, 5 LH lift, 6 RH swing, 7 RH lift.
// Servo angle = 90 + DIR * joint angle. Swing: + = foot forward. Lift: + = carriage up (horn above level).
const int8_t SWING_DIR[4] = { ${SWING_DIR.join(', ')} };
const int8_t LIFT_DIR[4]  = { ${LIFT_DIR.join(', ')} };
int8_t TRIM[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };  // calibration, degrees: make the first keyframe stand level
const uint16_t US_MIN = 500, US_MAX = 2500;    // pulse for 0 and 180 degrees; check your servos' range

// Leg geometry in mm (must match the build): swing axis to sole, lift horn radius, lift shaft height, step height.
const float LEG = ${GEOM.leg}, CRANK = ${GEOM.crank}, YOKE_Y = ${GEOM.yokeY}, LIFT_MM = ${GEOM.lift}, DOWN_MM = ${DOWN_MM};

// Joint angles in degrees: one row per keyframe, columns in channel order.
const int8_t CREEP[${creep.frames}][8] = {
${arr(creep.table)}
};
const int8_t TROT[${trot.frames}][8] = {
${arr(trot.table)}
};

struct Gait { const int8_t (*table)[8]; uint8_t frames; float duty; float offset[4]; uint16_t frameMs; };
const Gait GAITS[2] = {
${gaitRow(creep, 'CREEP')}
${gaitRow(trot, 'TROT ')}
};
const uint8_t SWING_ORDER[4] = { ${SWING_ORDER.join(', ')} };  // LH, LF, RH, RF
const uint16_t STEP_MS = ${STEP_MS};                    // per half-step while re-planting feet

uint8_t gait = 0;               // 0 = creep, 1 = trot
int8_t nextGait = -1;           // gait change waiting for all four feet to be down
float f = 0;                    // position in the gait, in keyframes
float k[4] = { 1, 1, 1, 1 };    // per-leg stride scale, for turning
float turn = 0, turnTarget = 0; // -1..1, + = right
float speed = 1;
bool walking = false;
uint32_t last = 0;

void writeJoint(uint8_t ch, float deg) {
  int8_t dir = (ch % 2 == 0) ? SWING_DIR[ch / 2] : LIFT_DIR[ch / 2];
  float a = constrain(90 + dir * deg + TRIM[ch], 0.0f, 180.0f);
  pca.writeMicroseconds(ch, US_MIN + (uint16_t)(a * (US_MAX - US_MIN) / 180.0f));
}

void writeAll(const float *a) {
  for (uint8_t ch = 0; ch < 8; ch++) writeJoint(ch, a[ch]);
}

// Foot height for a swing and lift angle, and the lift angle that puts the foot at height y.
float footY(float swing, float lift) {
  return YOKE_Y + CRANK * sinf(lift * DEG_TO_RAD) - LEG * cosf(swing * DEG_TO_RAD);
}
float liftFor(float swing, float y) {
  return asinf(constrain((y + LEG * cosf(swing * DEG_TO_RAD) - YOKE_Y) / CRANK, -1.0f, 1.0f)) * RAD_TO_DEG;
}

void sideScale(float t, float &kl, float &kr) {  // each side's stride while turning (skid steering)
  kl = 1 + t; kr = 1 - t;
  float m = max(1.0f, max(fabsf(kl), fabsf(kr)));
  kl /= m; kr /= m;
}

void anglesAt(const Gait &g, float pos, float *out) {  // linear between keyframes
  uint8_t k0 = (uint8_t)pos % g.frames, k1 = (k0 + 1) % g.frames;
  float a = pos - floorf(pos);
  for (uint8_t i = 0; i < 4; i++) {
    float s = g.table[k0][2 * i] * (1 - a) + g.table[k1][2 * i] * a;
    float l = g.table[k0][2 * i + 1] * (1 - a) + g.table[k1][2 * i + 1] * a;
    if (k[i] == 1) { out[2 * i] = s; out[2 * i + 1] = l; continue; }
    out[2 * i] = s * k[i];
    out[2 * i + 1] = liftFor(s * k[i], footY(s, l));  // shorter step, same foot height
  }
}

float swingAt(const Gait &g, float pos, uint8_t i) {  // 0..1 while foot i is in the air, -1 while it is down
  float p = fmodf(pos / g.frames + g.offset[i], 1.0f);
  return p >= g.duty ? (p - g.duty) / (1 - g.duty) : -1;
}

bool allDown(const Gait &g, uint8_t row) {
  for (uint8_t i = 0; i < 4; i++) if (footY(g.table[row][2 * i], g.table[row][2 * i + 1]) >= DOWN_MM) return false;
  return true;
}

void glide(const float *a, const float *b) {
  uint16_t ms = STEP_MS / speed;
  for (uint16_t t = 20; t <= ms; t += 20) {
    float s = t / (float)ms, p[8];
    for (uint8_t j = 0; j < 8; j++) p[j] = a[j] * (1 - s) + b[j] * s;
    writeAll(p);
    delay(20);
  }
}

// Gait change: move the feet one at a time (lift, swing, put down) to the new gait's first keyframe.
void replant(uint8_t to) {
  float cur[8], target[8], mid[8];
  anglesAt(GAITS[gait], f, cur);
  gait = to; f = 0;
  anglesAt(GAITS[gait], 0, target);
  for (uint8_t n = 0; n < 4; n++) {
    uint8_t i = SWING_ORDER[n];
    if (fabsf(cur[2 * i] - target[2 * i]) < 0.5f) continue;
    memcpy(mid, cur, sizeof mid);
    mid[2 * i] = (cur[2 * i] + target[2 * i]) / 2;
    mid[2 * i + 1] = liftFor(mid[2 * i], LIFT_MM);
    glide(cur, mid);
    cur[2 * i] = target[2 * i];
    cur[2 * i + 1] = target[2 * i + 1];
    glide(mid, cur);
  }
}

void step(float ms) {
  const Gait &g = GAITS[gait];
  float f0 = f, f1 = f0 + ms / g.frameMs;
  float kl, kr;
  sideScale(turn, kl, kr);
  // A new turn value reaches a leg only while it is in the air, so feet on the ground are never dragged.
  for (uint8_t i = 0; i < 4; i++) {
    float s0 = swingAt(g, f0, i), s1 = swingAt(g, fmodf(f1, g.frames), i);
    float target = (i == 0 || i == 2) ? kl : kr;  // legs 0 and 2 are on the left
    if (s0 >= 0 && s1 < 0) k[i] = target;
    else if (s0 >= 0 && s1 > s0) k[i] += (target - k[i]) * min(1.0f, (s1 - s0) / (1 - s0));
  }
  if (nextGait >= 0) {
    for (int kf = (int)floorf(f0) + 1; kf <= f1; kf++) {
      if (allDown(g, kf % g.frames)) {
        f = kf % g.frames;
        uint8_t to = nextGait;
        nextGait = -1;
        replant(to);
        return;
      }
    }
  }
  f = fmodf(f1, g.frames);
}

void readSerial() {
  while (Serial.available()) {
    switch (Serial.read()) {
      case 'w': walking = !walking; break;
      case 'c': nextGait = (gait == 0) ? -1 : 0; break;
      case 't': nextGait = (gait == 1) ? -1 : 1; break;
      case 'a': turnTarget = -0.6f; break;
      case 'd': turnTarget = 0.6f; break;
      case 's': turnTarget = 0; break;
      case '+': speed = min(2.0f, speed + 0.25f); break;
      case '-': speed = max(0.25f, speed - 0.25f); break;
    }
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  pca.begin();
  pca.setOscillatorFrequency(27000000);
  pca.setPWMFreq(50);
  delay(10);
  // Soft start: wake the servos one at a time (lifts first, they carry the weight), so eight stall currents
  // never hit the battery at once.
  float a[8];
  anglesAt(GAITS[gait], 0, a);
  for (uint8_t ch = 1; ch < 8; ch += 2) { writeJoint(ch, a[ch]); delay(150); }
  for (uint8_t ch = 0; ch < 8; ch += 2) { writeJoint(ch, a[ch]); delay(150); }
  last = millis();
  Serial.println(F("Clawd ready. w = walk/stop, c = creep, t = trot, a/d/s = left/right/straight, +/- = speed"));
}

void loop() {
  readSerial();
  uint32_t now = millis();
  if (now - last < 20) return;  // 50 updates a second, the servo pulse rate
  float ms = (now - last) * speed;
  last = now;
  if (!walking) return;
  turn += constrain(turnTarget - turn, -ms / 600, ms / 600);
  step(ms);
  float a[8];
  anglesAt(GAITS[gait], f, a);
  writeAll(a);
}
`;

const code = $('#sketch');
code.textContent = sketch;
$('#sketch-lines').textContent = sketch.split('\n').length - 1;
$('#copy').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  try { await navigator.clipboard.writeText(sketch); b.textContent = 'Copied'; }
  catch { const r = document.createRange(); r.selectNodeContents(code); getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = 'Selected: copy it'; }
  setTimeout(() => { b.textContent = 'Copy'; }, 1800);
});
const dl = $('#download');
dl.href = URL.createObjectURL(new Blob([sketch], { type: 'text/plain' }));
dl.download = 'clawd_bot.ino';

/* ---------- the single-leg test rig sketch ---------- */
const RL = 1;   // the rig is a front-right module: leg 1 of the robot
const col = (g) => g.table.map((r) => `  { ${String(r[2 * RL]).padStart(3)}, ${String(r[2 * RL + 1]).padStart(3)} },`).join('\n');
const rigSketch = `// Clawd crab robot: single-leg test rig.
// Drives one leg module on the printed rig: a front-right leg, so it plays column ${2 * RL} and ${2 * RL + 1} (swing, lift) of the
// robot's gait tables, the same tables as the 3D sim at https://boofers-den.vercel.app/sections/guitar-goblin/clawd-bot/
//
// Serial monitor at 115200 baud, one letter at a time:
//   h = home (both servos at 90: leg straight down, carriage mid-travel)
//   s = sweep the swing servo alone      l = sweep the lift servo alone
//   c = run the creep cycle              t = run the trot cycle          x = stop where it is
//   [ ] = swing trim -/+ 1 degree        - = = lift trim -/+ 1 degree     < > = slower / faster   p = print state
// Each keyframe prints the commanded angles and the foot position the kinematics expect: hold a ruler against the foot.

#define USE_PCA9685 1   // 1: PCA9685 channels 0 (swing) and 1 (lift). 0: straight from ESP32 pins (ESP32Servo library)

#if USE_PCA9685
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
Adafruit_PWMServoDriver pca(0x40);
const uint8_t CH_SWING = 0, CH_LIFT = 1;
#else
#include <ESP32Servo.h>
Servo swingServo, liftServo;
const uint8_t PIN_SWING = 18, PIN_LIFT = 19;
#endif

const int8_t SWING_DIR = ${SWING_DIR[RL]}, LIFT_DIR = ${LIFT_DIR[RL]};  // front-right module; flip if a joint runs backwards
int8_t trimSwing = 0, trimLift = 0;          // calibration, degrees: set with [ ] - =, then copy into the robot's TRIM
const uint16_t US_MIN = 500, US_MAX = 2500;  // pulse for 0 and 180 degrees
const float LEG = ${GEOM.leg}, CRANK = ${GEOM.crank}, YOKE_Y = ${GEOM.yokeY};   // mm, the rig's geometry

// This leg's (swing, lift) joint angles from the robot's tables, one row per keyframe.
const int8_t CREEP[${creep.frames}][2] = {
${col(creep)}
};
const int8_t TROT[${trot.frames}][2] = {
${col(trot)}
};
const uint16_t CREEP_MS = ${creep.frameMs}, TROT_MS = ${trot.frameMs};

char mode = 'h';
float f = 0, speed = 1, curS = 0, curL = 0, t = 0;
int lastRow = -1;
uint32_t last = 0;

void writeServo(bool isLift, float deg) {
  float a = constrain(90 + (isLift ? LIFT_DIR : SWING_DIR) * deg + (isLift ? trimLift : trimSwing), 0.0f, 180.0f);
  uint16_t us = US_MIN + (uint16_t)(a * (US_MAX - US_MIN) / 180.0f);
#if USE_PCA9685
  pca.writeMicroseconds(isLift ? CH_LIFT : CH_SWING, us);
#else
  (isLift ? liftServo : swingServo).writeMicroseconds(us);
#endif
}

void pose(float s, float l) { curS = s; curL = l; writeServo(false, s); writeServo(true, l); }
float footFwd(float s) { return LEG * sinf(s * DEG_TO_RAD); }
float footUp(float s, float l) { return YOKE_Y + CRANK * sinf(l * DEG_TO_RAD) - LEG * cosf(s * DEG_TO_RAD); }

void report(const char *what) {
  Serial.printf("%-8s swing %+5.1f  lift %+5.1f | servos %3d %3d | foot %+5.1f mm forward, %5.1f mm up\\n", what, curS, curL,
    (int)(90 + SWING_DIR * curS + trimSwing), (int)(90 + LIFT_DIR * curL + trimLift), footFwd(curS), footUp(curS, curL));
}

// Stride and step height of a gait for this leg, from the table, to compare with what you measure.
void describe(const int8_t (*tb)[2], uint8_t n, const char *name) {
  float zMin = 999, zMax = -999, up = 0;
  for (uint8_t k = 0; k < n; k++) {
    float y = footUp(tb[k][0], tb[k][1]);
    if (y < 0.5f) { zMin = min(zMin, footFwd(tb[k][0])); zMax = max(zMax, footFwd(tb[k][0])); }
    up = max(up, y);
  }
  Serial.printf("%s: the foot slides %.1f mm along the floor and lifts %.1f mm\\n", name, zMax - zMin, up);
}

void setup() {
  Serial.begin(115200);
#if USE_PCA9685
  Wire.begin(21, 22);
  pca.begin();
  pca.setOscillatorFrequency(27000000);
  pca.setPWMFreq(50);
#else
  swingServo.attach(PIN_SWING, US_MIN, US_MAX);
  liftServo.attach(PIN_LIFT, US_MIN, US_MAX);
#endif
  delay(10);
  writeServo(true, 0); delay(300); writeServo(false, 0);   // lift first, then swing: one stall current at a time
  Serial.println(F("Clawd leg rig. h home, s swing sweep, l lift sweep, c creep, t trot, x stop, [ ] - = trims, < > speed, p print"));
  describe(CREEP, ${creep.frames}, "creep");
  describe(TROT, ${trot.frames}, "trot");
  report("home");
  last = millis();
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    switch (c) {
      case 'h': case 's': case 'l': case 'c': case 't': case 'x': mode = c; f = 0; t = 0; lastRow = -1; break;
      case '[': trimSwing--; break;
      case ']': trimSwing++; break;
      case '-': trimLift--; break;
      case '=': trimLift++; break;
      case '<': speed = max(0.25f, speed - 0.25f); break;
      case '>': speed = min(2.0f, speed + 0.25f); break;
      case 'p': Serial.printf("trims: swing %d, lift %d; speed %.2fx\\n", trimSwing, trimLift, speed); report("now"); break;
      default: continue;
    }
    if (c != 'p') { Serial.printf("mode %c, trims %d / %d\\n", mode, trimSwing, trimLift); if (mode == 'h') { pose(0, 0); report("home"); } }
  }
  uint32_t now = millis();
  if (now - last < 20) return;  // 50 updates a second, the servo pulse rate
  float ms = (now - last) * speed;
  last = now;
  t += ms;
  if (mode == 's') pose(20 * sinf(t * 2 * PI / 3000), -9);           // +-20 deg at lift -9: clear of the shell slot
  else if (mode == 'l') pose(0, 8 + 26 * sinf(t * 2 * PI / 3000));  // lift -18..34 deg: foot 0..14 mm up
  else if (mode == 'c' || mode == 't') {
    const int8_t (*tb)[2] = (mode == 'c') ? CREEP : TROT;
    uint8_t n = (mode == 'c') ? ${creep.frames} : ${trot.frames};
    f = fmodf(f + ms / ((mode == 'c') ? CREEP_MS : TROT_MS), n);
    uint8_t k0 = (uint8_t)f, k1 = (k0 + 1) % n;
    float a = f - k0;
    pose(tb[k0][0] * (1 - a) + tb[k1][0] * a, tb[k0][1] * (1 - a) + tb[k1][1] * a);
    if (k0 != lastRow) { lastRow = k0; char buf[12]; snprintf(buf, sizeof buf, "frame %d", k0); report(buf); }
  }
}
`;
const rigCode = $('#rig-sketch');
rigCode.textContent = rigSketch;
$('#rig-copy').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  try { await navigator.clipboard.writeText(rigSketch); b.textContent = 'Copied'; }
  catch { const r = document.createRange(); r.selectNodeContents(rigCode); getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = 'Selected: copy it'; }
  setTimeout(() => { b.textContent = 'Copy'; }, 1800);
});
const rdl = $('#rig-download');
rdl.href = URL.createObjectURL(new Blob([rigSketch], { type: 'text/plain' }));
rdl.download = 'clawd_leg_rig.ino';
