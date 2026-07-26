/* Night City fragment shader.
   Generated from city.frag — edit that file, not this one.
   Held as a string so the page can show you exactly what it is running. */
window.CITY_SHADER = String.raw`#version 300 es
precision highp float;

// ---------------------------------------------------------------
//  N I G H T   C I T Y  --  neo-noir, dense fog, neon, rain
//  twigl idiom: r = resolution, t = time, m = mouse, o = out colour
// ---------------------------------------------------------------
uniform vec2  r;
uniform float t;
uniform vec2  m;
out vec4 o;

#define FC gl_FragCoord

const float CELL = 9.0;   // city block size
const float HALF = 4.5;

// ---- hashes -----------------------------------------------------
float h21(vec2 p){
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x * 37.719);
}
vec3 h32(vec2 p){
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yzz) * q.zyx);
}

// ---- primitives -------------------------------------------------
float sdBox(vec3 p, vec3 b){
  vec3 d = abs(p) - b;
  return min(max(d.x, max(d.y, d.z)), 0.0) + length(max(d, 0.0));
}

// is this block built on, or is it road?
bool builtOn(vec2 id){
  if (abs(id.x) < 0.5) return false;              // the avenue we drive down
  if (mod(id.y, 7.0) < 0.5) return false;         // cross streets
  return true;
}

float blockHeight(vec2 id){
  float a = h21(id + 3.7);
  float b = h21(id * 1.7 + 11.3);
  float h = 5.0 + 46.0 * pow(a, 1.7) * (0.35 + 0.65 * b);
  // the towers flanking the avenue lean tall, it feels like a canyon
  if (abs(abs(id.x) - 1.0) < 0.5) h *= 1.35;
  return h;
}

float blockWidth(vec2 id){ return 3.05 + 0.75 * h21(id + 21.1); }

// ---- the city ---------------------------------------------------
// returns distance; mat: 0 road, 1 facade
float map(vec3 p, out float mat){
  float dGround = p.y;
  mat = 0.0;

  vec2 id = floor(p.xz / CELL + 0.5);
  vec2 q  = p.xz - id * CELL;

  float dCity;
  if (builtOn(id)) {
    float h = blockHeight(id);
    float w = blockWidth(id);
    dCity = sdBox(vec3(q.x, p.y - h * 0.5, q.y), vec3(w, h * 0.5, w));
    // a setback ledge partway up, so the silhouettes aren't all shoeboxes
    float lh = h * (0.45 + 0.25 * h21(id + 5.5));
    dCity = min(dCity, sdBox(vec3(q.x, p.y - lh * 0.5, q.y), vec3(w + 0.55, lh * 0.5, w + 0.55)));
  } else {
    // empty block: safe step is the distance to the block's own walls
    dCity = max(HALF - max(abs(q.x), abs(q.y)), 0.015);
  }

  if (dCity < dGround) { mat = 1.0; return dCity; }
  return dGround;
}

float mapD(vec3 p){ float m0; return map(p, m0); }

vec3 calcNormal(vec3 p){
  vec2 e = vec2(0.0025, 0.0);
  return normalize(vec3(
    mapD(p + e.xyy) - mapD(p - e.xyy),
    mapD(p + e.yxy) - mapD(p - e.yxy),
    mapD(p + e.yyx) - mapD(p - e.yyx)));
}

// ---- neon: what actually lights this place ----------------------
// emissive density in the air, sampled along the ray -> volumetric bleed
vec3 neon(vec3 p){
  vec3 acc = vec3(0.0);

  vec2 id = floor(p.xz / CELL + 0.5);

  // signs live on the two rows flanking the avenue, facing in
  for (float k = -1.0; k <= 1.0; k += 2.0) {
    vec2 sid = vec2(k, id.y);
    if (!builtOn(sid)) continue;

    vec3 rnd = h32(sid * 3.13 + 7.7);
    vec3 hue = 0.55 + 0.45 * cos(6.28318 * (rnd.x + vec3(0.0, 0.33, 0.67)));
    hue = mix(hue, vec3(1.0, 0.25, 0.55), 0.25);   // push everything toward sodium/rose

    float faceX = k * CELL - k * (blockWidth(sid) + 0.18);
    float z0    = sid.y * CELL + (rnd.y - 0.5) * 2.6;   // kept near the block centre so the
                                                        // glow never gets clipped at a cell edge
    float yLo   = 2.2 + 13.0 * rnd.z;
    float yHi   = yLo + 3.0 + 7.0 * rnd.y;

    // vertical bar
    float dxz = length(vec2(p.x - faceX, p.z - z0));
    float dy  = max(0.0, max(yLo - p.y, p.y - yHi));
    float d   = sqrt(dxz * dxz + dy * dy);

    // some of them are on the blink, because of course they are
    float flick = 0.72 + 0.28 * step(0.12, fract(sin((sid.y + k * 9.0) * 12.9898 + floor(t * 6.0) * 0.618) * 43758.5));
    float dead  = step(0.14, rnd.x);              // one in seven is simply out

    acc += hue * flick * dead * 1.35 / (1.0 + 9.0 * d * d);

    // a low horizontal strip over the doorway
    float dh = length(vec3(p.x - faceX, p.y - 2.6, max(0.0, abs(p.z - z0) - 1.6)));
    acc += hue.zyx * dead * 0.55 / (1.0 + 22.0 * dh * dh);
  }

  // sodium street lamps down the middle, warm, spaced
  float lz = p.z - CELL * floor(p.z / CELL + 0.5);
  float dl = length(vec3(abs(p.x) - 3.4, p.y - 5.2, lz));
  acc += vec3(1.0, 0.62, 0.28) * 0.85 / (1.0 + 5.0 * dl * dl);

  return acc;
}

// ---- windows on a facade ---------------------------------------
vec3 windows(vec3 p, vec3 n, vec2 id){
  vec2 uv = (abs(n.x) > 0.5) ? vec2(p.z, p.y) : vec2(p.x, p.y);
  vec2 g  = floor(vec2(uv.x * 1.15, uv.y * 0.78));
  vec2 f  = fract(vec2(uv.x * 1.15, uv.y * 0.78));

  float pane = smoothstep(0.10, 0.20, f.x) * smoothstep(0.86, 0.72, f.x)
             * smoothstep(0.16, 0.28, f.y) * smoothstep(0.82, 0.66, f.y);

  vec3 rnd = h32(g + id * 17.0);
  float on = step(0.56, rnd.x);
  // the odd one flickers, someone is still at their desk
  on *= 0.55 + 0.45 * step(0.25, fract(sin(rnd.y * 91.7 + floor(t * 1.7 + rnd.z * 10.0)) * 4375.85));

  vec3 warm = mix(vec3(1.0, 0.78, 0.42), vec3(0.45, 0.85, 1.0), step(0.62, rnd.z));
  warm = mix(warm, vec3(1.0, 0.35, 0.6), 0.18 * step(0.9, rnd.y));
  return warm * pane * on;
}

// ---- sky --------------------------------------------------------
vec3 sky(vec3 rd){
  float up = clamp(rd.y, 0.0, 1.0);
  vec3 low  = vec3(0.30, 0.13, 0.20);        // smog lit orange-rose from below
  vec3 high = vec3(0.045, 0.035, 0.085);
  vec3 c = mix(low, high, pow(up, 0.55));
  // slow cloud drag
  float cl = h21(floor(rd.xz * 14.0 + vec2(t * 0.25, 0.0)));
  c += vec3(0.10, 0.05, 0.09) * cl * (1.0 - up) * 0.6;
  return c;
}

// ---- march ------------------------------------------------------
// traces, returns hit distance (or -1) and accumulates volumetric neon
float trace(vec3 ro, vec3 rd, int steps, float far, out float mat, inout vec3 glow, float glowGain){
  float d = 0.0;
  mat = 0.0;
  for (int i = 0; i < 160; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * d;
    float mm;
    float s = map(p, mm);
    // fog eats the far field, so glow contribution decays with depth
    glow += neon(p) * min(s, 0.6) * glowGain * exp(-d * 0.028);
    if (s < 0.0016 * d + 0.0025) { mat = mm; return d; }
    d += s * 0.82;
    if (d > far) break;
  }
  return -1.0;
}

// ---- rain -------------------------------------------------------
float rainStreaks(vec2 uv){
  float a = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 st = uv * vec2(52.0 + fi * 34.0, 5.5 + fi * 2.2);
    st.x += st.y * (0.14 + 0.05 * fi);            // wind shear
    st.y += t * (16.0 + fi * 11.0);
    st.x += fi * 23.7;
    vec2 ip = floor(st), fp = fract(st);
    float n = h21(ip);
    float on = step(0.955 - fi * 0.006, n);
    float line = smoothstep(0.5, 0.0, abs(fp.x - 0.5))
               * smoothstep(0.0, 0.35, fp.y) * smoothstep(1.0, 0.55, fp.y);
    a += on * line * (0.55 - fi * 0.09);
  }
  return a;
}

float lensDrops(vec2 uv){
  vec2 st = uv * 9.0;
  st.y += t * 0.35;
  vec2 ip = floor(st), fp = fract(st) - 0.5;
  vec3 n = h32(ip);
  float on = step(0.88, n.x);
  float d = length(fp - (n.yz - 0.5) * 0.55);
  return on * smoothstep(0.17, 0.02, d);
}

// ---- main -------------------------------------------------------
void main(){
  vec2 uv = (FC.xy * 2.0 - r) / r.y;

  float T = t * 2.6;

  // camera: rolling slowly up the avenue, slight handheld drift
  vec3 ro = vec3(sin(T * 0.09) * 1.6 + (m.x - 0.5) * 2.5,
                 2.35 + sin(T * 0.13) * 0.28,
                 T);
  vec3 ta = vec3(sin(T * 0.09 + 0.9) * 2.6,
                 4.4 + sin(T * 0.07) * 0.9 - (m.y - 0.5) * 3.0,
                 T + 9.0);

  vec3 f = normalize(ta - ro);
  vec3 s = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  vec3 u = cross(f, s);
  float roll = sin(T * 0.11) * 0.035;
  vec2 uvr = mat2(cos(roll), -sin(roll), sin(roll), cos(roll)) * uv;
  vec3 rd = normalize(uvr.x * s + uvr.y * u + 1.45 * f);

  vec3 glow = vec3(0.0);
  float mat;
  float d = trace(ro, rd, 120, 185.0, mat, glow, 0.055);

  vec3 col;
  float dist = (d < 0.0) ? 185.0 : d;

  if (d < 0.0) {
    col = sky(rd);
  } else {
    vec3 p = ro + rd * d;
    vec3 n = calcNormal(p);
    vec2 id = floor(p.xz / CELL + 0.5);

    if (mat > 0.5) {
      // ---- facade ----
      vec3 base = vec3(0.028, 0.026, 0.042) * (0.55 + 0.45 * h21(id + 1.3));
      vec3 em = windows(p, n, id);
      // neon spill from whatever is nearest
      vec3 lit = neon(p + n * 0.35) * 0.055;
      col = base + em * 1.5 + lit;
      // grazing sheen, wet concrete
      col += vec3(0.35, 0.22, 0.42) * pow(1.0 - abs(dot(n, rd)), 4.0) * 0.35;
    } else {
      // ---- wet asphalt ----
      vec3 base = vec3(0.016, 0.015, 0.024);

      // rain ripples perturb the mirror
      vec2 rp = p.xz * 1.9;
      vec2 ri = floor(rp), rf = fract(rp) - 0.5;
      float ph = h21(ri);
      float age = fract(t * 0.9 + ph);
      float rad = age * 0.55;
      float ring = smoothstep(0.06, 0.0, abs(length(rf) - rad)) * (1.0 - age);
      vec3 pn = normalize(n + vec3(rf.x, 0.0, rf.y) * ring * 2.2
                            + vec3(sin(p.z * 3.1 + t * 2.0), 0.0, cos(p.x * 2.7 - t * 1.6)) * 0.012);

      vec3 rrd = reflect(rd, pn);
      vec3 rglow = vec3(0.0);
      float rmat;
      float rd2 = trace(p + pn * 0.05, rrd, 56, 120.0, rmat, rglow, 0.05);
      vec3 refl;
      if (rd2 < 0.0) {
        refl = sky(rrd);
      } else {
        vec3 rp3 = p + pn * 0.05 + rrd * rd2;
        vec3 rn = calcNormal(rp3);
        vec2 rid = floor(rp3.xz / CELL + 0.5);
        refl = vec3(0.02) + windows(rp3, rn, rid) * 1.4 + neon(rp3 + rn * 0.35) * 0.05;
        refl = mix(vec3(0.12, 0.05, 0.11), refl, exp(-rd2 * 0.045));
      }
      refl += rglow;

      float fres = 0.06 + 0.94 * pow(1.0 - max(dot(-rd, pn), 0.0), 4.0);
      col = mix(base, refl, clamp(fres * 1.7, 0.0, 0.95));
      col += vec3(0.9, 0.55, 0.35) * ring * 0.06;
    }
  }

  // ---- volumetric neon in the fog ----
  col += glow;

  // ---- fog: the whole point ----
  vec3 fogCol = mix(vec3(0.115, 0.055, 0.105), vec3(0.20, 0.09, 0.15), exp(-dist * 0.02));
  fogCol += neon(ro + rd * min(dist, 34.0)) * 0.018;
  float fog = 1.0 - exp(-dist * 0.031);
  col = mix(col, fogCol, clamp(fog, 0.0, 1.0));

  // ---- rain ----
  float streaks = rainStreaks(uv);
  col += vec3(0.62, 0.70, 0.92) * streaks * 0.42;
  col = mix(col, col * 1.9 + vec3(0.06, 0.05, 0.09), lensDrops(uv) * 0.55);

  // ---- grade ----
  col *= 1.0 - 0.42 * dot(uv, uv) * 0.35;                       // vignette
  col = mix(col, col * vec3(1.06, 0.95, 1.10), 0.6);            // cold magenta cast
  col += (h32(FC.xy + fract(t) * 91.7).xyz - 0.5) * 0.035;      // grain
  col = col / (1.0 + col);                                      // reinhard
  col = pow(max(col, 0.0), vec3(0.4545));

  o = vec4(col, 1.0);
}
`;
