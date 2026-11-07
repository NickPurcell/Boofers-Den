/* The design doc's generated parts: the gait tables and the ESP32 sketch, both printed from gait.js,
   so the robot runs exactly what the sim shows. */
import { GEOM, LEGS, HIP_DIR, KNEE_DIR, GAIT_KEYS, buildGait, SWING_ORDER, STEP_MS } from './gait.js';

const $ = (s) => document.querySelector(s);
const gaits = GAIT_KEYS.map(buildGait);

/* ---------- gait tables ---------- */
const head = '<tr><th scope="col">Frame</th>' + LEGS.map((L) => `<th scope="col" colspan="2">${L.id}<small>hip · knee</small></th>`).join('') + '</tr>';
$('#gait-tables').innerHTML = gaits.map((g) => `
  <h3>${g.label}: ${g.frames} keyframes, ${g.frameMs} ms each</h3>
  <p>${g.blurb} Each foot is on the ground for ${Math.round(g.duty * 100)}% of the cycle.</p>
  <div class="tablewrap"><table class="gait" data-gait="${g.key}">
    <caption class="sr">${g.label} gait joint angles in degrees</caption>
    <thead>${head}</thead>
    <tbody>${g.table.map((row, k) => `<tr data-k="${k}"><th scope="row">${k}</th>` +
      row.map((v, j) => `<td class="${j % 2 ? 'kn' : 'hp'}${j % 2 && v !== GEOM.stanceKnee ? ' up' : ''}">${v}</td>`).join('') + '</tr>').join('')}
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

const sketch = `// Clawd crab robot: 8 servos on a PCA9685, driven by an ESP32.
// Printed from the same gait tables as the 3D sim at
// https://boofers-den.vercel.app/sections/guitar-goblin/clawd-bot/
//
// Library: "Adafruit PWM Servo Driver Library" (Arduino Library Manager). Board: "ESP32 Dev Module".
// Wiring: PCA9685 SDA -> GPIO21, SCL -> GPIO22, VCC -> 3V3, GND -> GND. Servo power (V+) from the 6 V buck.
// Serial monitor at 115200 baud, one letter at a time:
//   w = walk / stop   c = creep   t = trot   a = turn left   d = turn right   s = straight   + / - = speed

#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pca(0x40);

// Channels: 0 LF hip, 1 LF knee, 2 RF hip, 3 RF knee, 4 LH hip, 5 LH knee, 6 RH hip, 7 RH knee.
// Servo angle = 90 + DIR * joint angle. Hip: + = foot forward. Knee: degrees out from straight down.
const int8_t HIP_DIR[4]  = { ${HIP_DIR.join(', ')} };
const int8_t KNEE_DIR[4] = { ${KNEE_DIR.join(', ')} };
int8_t TRIM[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };  // calibration, degrees: make the first keyframe look square
const uint16_t US_MIN = 500, US_MAX = 2500;    // pulse for 0 and 180 degrees; check your servos' range

const int8_t STANCE_KNEE = ${GEOM.stanceKnee}, LIFT_KNEE = ${GEOM.liftKnee};

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
float k[4] = { 1, 1, 1, 1 };    // per-leg hip scale, for turning
float turn = 0, turnTarget = 0; // -1..1, + = right
float speed = 1;
bool walking = false;
uint32_t last = 0;

void writeJoint(uint8_t ch, float deg) {
  int8_t dir = (ch % 2 == 0) ? HIP_DIR[ch / 2] : KNEE_DIR[ch / 2];
  float a = constrain(90 + dir * deg + TRIM[ch], 0.0f, 180.0f);
  pca.writeMicroseconds(ch, US_MIN + (uint16_t)(a * (US_MAX - US_MIN) / 180.0f));
}

void writeAll(const float *a) {
  for (uint8_t ch = 0; ch < 8; ch++) writeJoint(ch, a[ch]);
}

void sideScale(float t, float &kl, float &kr) {  // each side's hip sweep while turning
  kl = 1 + t; kr = 1 - t;
  float m = max(1.0f, max(fabsf(kl), fabsf(kr)));
  kl /= m; kr /= m;
}

void anglesAt(const Gait &g, float pos, float *out) {  // linear between keyframes
  uint8_t k0 = (uint8_t)pos % g.frames, k1 = (k0 + 1) % g.frames;
  float a = pos - floorf(pos);
  for (uint8_t j = 0; j < 8; j++) {
    float v = g.table[k0][j] * (1 - a) + g.table[k1][j] * a;
    out[j] = (j % 2 == 0) ? v * k[j / 2] : v;
  }
}

float swingAt(const Gait &g, float pos, uint8_t i) {  // 0..1 while foot i is in the air, -1 while it is down
  float p = fmodf(pos / g.frames + g.offset[i], 1.0f);
  return p >= g.duty ? (p - g.duty) / (1 - g.duty) : -1;
}

bool allDown(const Gait &g, uint8_t row) {
  for (uint8_t i = 0; i < 4; i++) if (g.table[row][2 * i + 1] != STANCE_KNEE) return false;
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
    mid[2 * i + 1] = LIFT_KNEE;
    glide(cur, mid);
    cur[2 * i] = target[2 * i];
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
  // Soft start: wake the servos one at a time, so eight stall currents never hit the battery at once.
  float a[8];
  anglesAt(GAITS[gait], 0, a);
  for (uint8_t ch = 0; ch < 8; ch++) { writeJoint(ch, a[ch]); delay(150); }
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
