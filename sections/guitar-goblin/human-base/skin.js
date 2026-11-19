// Human base: the skin. One material for the body (and anything grown from it, such as tendrils), our own:
// - colour with broad mottling and fine pores, lips tinted from where the lip morph moves;
// - light and shade from the surface itself: creases and hollows darken (fine and broad cavity, recomputed after every
//   morph in base.js), proud forms catch a little light;
// - light that goes into skin comes out a little way off and redder: the diffuse term wraps past the shadow line;
// - brows painted on, placed in the base mesh's own coordinates so they ride every morph;
// - an optional plain undersuit from the waist to mid-thigh.
// Set the look with material.userData.set({ tone, lips, brow, browAmount, suit, suitOn, cavity }).
import * as THREE from 'three';

export function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4), h = (x, y, s) => { let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const vn = (u, v, p, s) => { const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, w = (a) => ((a % p) + p) % p, a = h(w(i), w(j), s), b = h(w(i + 1), w(j), s), c = h(w(i), w(j + 1), s), d = h(w(i + 1), w(j + 1), s), su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv); return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv; };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, o = (x + y * size) * 4;
    data[o] = 255 * vn(u * 64, v * 64, 64, 1);                                         // pores
    data[o + 1] = 255 * (0.6 * vn(u * 8, v * 8, 8, 2) + 0.4 * vn(u * 16, v * 16, 16, 3));   // mottling
    data[o + 2] = 255 * vn(u * 128, v * 128, 128, 4);                                  // finest grain
    data[o + 3] = 255 * vn(u * 256, v * 8, 256, 5);                                    // streaks, for hairs
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}
let shared = null;

export function skinMaterial(B, o = {}) {
  shared ||= noiseTexture();
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, specularIntensity: 0.42, sheen: 0.2, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffe6dc) });
  // where the brows go, in the base mesh's frame (decimetres, the +x side; the other is its mirror)
  const L = B.marks.L, R = B.rest, at = (i) => new THREE.Vector3(Math.abs(R[i * 3]), R[i * 3 + 1], R[i * 3 + 2]), { ey, d } = B.marks;
  const bi = at(L.browInnerL), bo = at(L.browOuterL);
  const u = {
    uSkin: { value: new THREE.Color(0xb98e72) }, uLip: { value: new THREE.Color(0x9a6a5a) }, uNoise: { value: shared },
    uWrap: { value: 0.32 }, uScatter: { value: new THREE.Vector3(0.55, 0.24, 0.15) },
    uSuit: { value: new THREE.Color(0x2b3038) }, uSuitOn: { value: 1 }, uCav: { value: 1 },
    // how much the undersuit covers: a top to the collarbones (0/1), sleeves (0 none, 0.5 to the elbow, 1 to the wrist),
    // and where the legs end (0 mid-thigh, 1 the ankle); the joints' places in the base frame say where those are
    uSuitTop: { value: 0 }, uSuitArms: { value: 0 }, uSuitLegs: { value: 0 },
    uJoints: { value: (() => { const J = (n) => { const l = B.info.joints[n], c = [0, 0, 0]; for (const i of l) for (let k = 0; k < 3; k++) c[k] += R[i * 3 + k] / l.length; return c; }; return new THREE.Vector4(Math.abs(J('l-elbow')[0]), Math.abs(J('l-hand')[0]), J('l-ankle')[1] + 0.25, J('neck')[1] - 0.55); })() },
    uBrow: { value: new THREE.Color(0x231a16) }, uBrowAmt: { value: 0.85 },
    uBrowX: { value: new THREE.Vector2(bi.x, bo.x) }, uBrowY: { value: new THREE.Vector3(ey + 0.25 * d, ey + 0.33 * d, ey + 0.24 * d) }, uBrowT: { value: new THREE.Vector2(0.075 * d, 0.032 * d) },
    uFaceZ: { value: B.marks.ez - 0.75 * d },
    // the face, for painted light and shade: one eye's centre (|x|, y, z) and the eye spacing, in the base's frame
    uEyeC: { value: (() => { const c = [0, 0, 0], l = B.info.eyes.l; for (const i of l) for (let k = 0; k < 3; k++) c[k] += R[i * 3 + k] / l.length; return new THREE.Vector3(Math.abs(c[0]), c[1], c[2]); })() },
    uD: { value: d }, uPaint: { value: 1 }, uSocket: { value: 0.4 }, uBone: { value: 0 },
    // painted marks (liner, freckles, stubble, tattoos, anything a page draws): a canvas laid on the face from the front,
    // in the base pose's frame, so the marks ride every morph. uMarkBox: x0, y0, width, height in decimetres
    uMarkTex: { value: null }, uMarkBox: { value: new THREE.Vector4() }, uMarkZ: { value: 0 },
  };
  m.userData.u = u; m.userData.cover = { on: true, torso: false, arms: 0, legs: 0 };
  m.userData.set = (s = {}) => {
    if (s.tone) { u.uSkin.value.set(s.tone); const lip = new THREE.Color(s.tone), hsl = {}; lip.getHSL(hsl); lip.setHSL(hsl.h * 0.96, Math.min(1, hsl.s * 1.1 + 0.05), hsl.l * 0.8); u.uLip.value.copy(lip); }
    if (s.lips) u.uLip.value.set(s.lips);
    if (s.brow) u.uBrow.value.set(s.brow);
    if (s.browThick !== undefined) u.uBrowT.value.set(0.075 * d * s.browThick, 0.032 * d * s.browThick);
    if (s.browAmount !== undefined) u.uBrowAmt.value = s.browAmount;
    if (s.suit) u.uSuit.value.set(s.suit);
    if (s.suitOn !== undefined) u.uSuitOn.value = s.suitOn ? 1 : 0;
    if (s.suitOn !== undefined || s.suitCover) m.userData.cover = { on: u.uSuitOn.value > 0.5, torso: u.uSuitTop.value > 0.5, arms: u.uSuitArms.value, legs: u.uSuitLegs.value, ...(s.suitCover || {}), ...(s.suitOn !== undefined ? { on: !!s.suitOn } : {}) };
    if (s.suitCover) { const c = s.suitCover; if (c.torso !== undefined) u.uSuitTop.value = c.torso ? 1 : 0; if (c.arms !== undefined) u.uSuitArms.value = c.arms; if (c.legs !== undefined) u.uSuitLegs.value = c.legs; }
    if (s.cavity !== undefined) u.uCav.value = s.cavity;
    if (s.paint !== undefined) u.uPaint.value = s.paint;
    if (s.sockets !== undefined) u.uSocket.value = s.sockets;
    if (s.bone !== undefined) u.uBone.value = s.bone;
    if (s.marks) m.userData.paint(s.marks);   // a list of functions (ctx) => draw on ctx.g
  };
  // the paint canvas: 1024 x 1280 px over 2.4 x 3 dm round the point between the eyes (rest pose)
  const ec = (() => { const c = [0, 0, 0]; for (const k of ['l', 'r']) for (const i of B.info.eyes[k]) for (let q = 0; q < 3; q++) c[q] += R[i * 3 + q] / (B.info.eyes[k].length * 2); return c; })();
  const MW = 2.4, MH = 3.0, canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1280;
  const g = canvas.getContext('2d'), tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  u.uMarkTex.value = tex; u.uMarkBox.value.set(ec[0] - MW / 2, ec[1] - MH * 0.62, MW, MH); u.uMarkZ.value = ec[2] - 0.9;
  // ctx.at(x, y): a point in the head frame (metres from the point between the eyes, x to the figure's left, y up) to
  // canvas pixels; ctx.mm(v): millimetres to pixels; ctx.eye: the eye centres' x and y in that frame
  const eyeX = Math.abs(B.marks.d / 2) / 10, ctx = {
    g, canvas, at: (x, y) => [((x * 10 + MW / 2) / MW) * canvas.width, (1 - (y * 10 + MH * 0.62) / MH) * canvas.height], mm: (v) => (v / 1000) * 10 / MW * canvas.width,
    eye: [eyeX, 0], d: B.marks.d / 10,
    // the base's landmarks in the same frame (metres), for placing marks on real features: lm.noseTip, lm.chin, lm.mouthL ...
    lm: Object.fromEntries(Object.entries(B.marks.L).map(([k, i]) => [k, [(R[i * 3] - ec[0]) / 10, (R[i * 3 + 1] - ec[1]) / 10]])),
    // each eye opening's edge (the mesh's hole round the eye), in the same frame, ordered round it: [[x, y], ...]
    holes: ['l', 'r'].map((k) => {
      const c = [0, 0, 0]; for (const i of B.info.eyes[k]) for (let q = 0; q < 3; q++) c[q] += R[i * 3 + q] / B.info.eyes[k].length;
      // the lid's edge: the skin that lies against the front of the eyeball (the mesh is closed, so there is no hole edge)
      let r = 0; { const l = B.info.eyes[k]; for (const i of l) r += Math.hypot(R[i * 3] - c[0], R[i * 3 + 1] - c[1], R[i * 3 + 2] - c[2]) / l.length; }
      const pts = []; for (let i = 0; i < B.N; i++) { if (!B.inBody[i]) continue; const dx = R[i * 3] - c[0], dy = R[i * 3 + 1] - c[1], dz = R[i * 3 + 2] - c[2], dd = Math.hypot(dx, dy, dz); if (dz > r * 0.35 && dd < r * 1.12) pts.push([(R[i * 3] - ec[0]) / 10, (R[i * 3 + 1] - ec[1]) / 10]); }
      const cx = (c[0] - ec[0]) / 10, cy = (c[1] - ec[1]) / 10, NB = 36, best = new Array(NB).fill(null);
      // in each direction round the eye, the nearest skin point is the lid's edge; then smooth the ring a little
      for (const p of pts) { const a = Math.atan2(p[1] - cy, p[0] - cx), k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * NB) % NB, rr = Math.hypot(p[0] - cx, p[1] - cy); if (!best[k] || rr < best[k][2]) best[k] = [p[0], p[1], rr]; }
      const ring = []; for (let k = 0; k < NB; k++) { const a = -Math.PI + ((k + 0.5) / NB) * 2 * Math.PI; let rr = best[k]?.[2]; if (rr === undefined) { const prev = best[(k + NB - 1) % NB], next = best[(k + 1) % NB]; rr = ((prev?.[2] ?? 0.008) + (next?.[2] ?? 0.008)) / 2; } ring.push([a, rr]); }
      for (let it = 0; it < 2; it++) { const r0 = ring.map((q) => q[1]); for (let k = 0; k < NB; k++) ring[k][1] = 0.25 * r0[(k + NB - 1) % NB] + 0.5 * r0[k] + 0.25 * r0[(k + 1) % NB]; }
      return { c: [cx, cy], pts: ring.map(([a, rr]) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]) };
    }),
  };
  m.userData.marks = ctx;
  let painters = [];
  m.userData.paint = (list = painters) => { painters = list; g.clearRect(0, 0, canvas.width, canvas.height); for (const f of painters) if (f) { g.save(); f(ctx); g.restore(); } tex.needsUpdate = true; };
  m.userData.paint([]);
  m.userData.set(o);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute float aLip; attribute vec3 aRest; attribute vec2 aCav; attribute vec2 aMark; attribute vec2 aArm; varying float vLip; varying vec3 vOP; varying vec3 vON; varying vec3 vRest; varying vec2 vCav; varying vec2 vMark; varying vec2 vArm;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLip = aLip; vOP = position; vON = normal; vRest = aRest; vCav = aCav; vMark = aMark; vArm = aArm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `uniform vec3 uSkin; uniform vec3 uLip; uniform sampler2D uNoise; uniform float uWrap; uniform vec3 uScatter; uniform vec3 uSuit; uniform float uSuitOn; uniform float uCav;
uniform vec3 uBrow; uniform float uBrowAmt; uniform vec2 uBrowX; uniform vec3 uBrowY; uniform vec2 uBrowT; uniform float uFaceZ; uniform vec3 uEyeC; uniform float uD; uniform float uPaint; uniform float uSocket; uniform float uBone; varying vec2 vMark; uniform float uSuitTop; uniform float uSuitArms; uniform float uSuitLegs; uniform vec4 uJoints; varying vec2 vArm; uniform sampler2D uMarkTex; uniform vec4 uMarkBox; uniform float uMarkZ;
varying float vLip; varying vec3 vOP; varying vec3 vON; varying vec3 vRest; varying vec2 vCav; float sHeight; float sSuit; float sAo;
vec4 tri(vec3 p, vec3 bw, float s) { return texture2D(uNoise, p.zy * s) * bw.x + texture2D(uNoise, p.xz * s) * bw.y + texture2D(uNoise, p.xy * s) * bw.z; }
#include <common>`)
      .replace('#include <color_fragment>', `
  vec3 bw = pow(abs(normalize(vON)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
  vec4 nF = tri(vOP, bw, 3.2), nB = tri(vOP, bw, 0.9);
  float poreK = 1.0 - smoothstep(0.00025, 0.0007, length(fwidth(vOP)));   // pores only where a pixel can hold them
  nF = mix(vec4(0.5), nF, poreK);
  vec3 col = uSkin * mix(0.95, 1.03, nB.g) * mix(0.985, 1.01, nF.b);
  float lipK = smoothstep(0.15, 0.7, vLip);
  col = mix(col, uLip, lipK * 0.75);
  // the face is never one colour: lighter on the forehead, the bridge of the nose and the top of the cheek; darker in the
  // sockets, under the cheekbones, beside the nose and under the lower lip; warmer on the cheeks and nose
  { float fx = (abs(vRest.x) - uEyeC.x) / uD, fy = (vRest.y - uEyeC.y) / uD, cx = abs(vRest.x) / uD, front = smoothstep(uFaceZ, uFaceZ + 0.6 * uD, vRest.z) * step(uEyeC.y - 2.6 * uD, vRest.y);
    float socket = exp(-(fx * fx * 1.7 + (fy - 0.06) * (fy - 0.06) * 3.2) / 0.32);
    float hollow = exp(-((cx - 1.25) * (cx - 1.25) / 0.1 + (fy + 0.9) * (fy + 0.9) / 0.09));
    float beside = exp(-((cx - 0.42) * (cx - 0.42) / 0.03 + (fy + 0.75) * (fy + 0.75) / 0.12)), underLip = exp(-(cx * cx / 0.25 + (fy + 1.45) * (fy + 1.45) / 0.02));
    float light = 0.07 * smoothstep(0.45, 0.9, fy) * (1.0 - smoothstep(0.6, 1.1, cx)) * (1.0 - smoothstep(1.8, 2.4, fy)) + 0.09 * exp(-(cx * cx / 0.03 + (fy + 0.35) * (fy + 0.35) / 0.25)) + 0.06 * exp(-((cx - 1.15) * (cx - 1.15) / 0.06 + (fy + 0.45) * (fy + 0.45) / 0.03));
    float dark = uSocket * socket + 0.16 * hollow + 0.1 * beside + 0.12 * underLip;
    col *= 1.0 + uPaint * front * (light - dark);
    float warm = exp(-((cx - 0.95) * (cx - 0.95) / 0.12 + (fy + 0.75) * (fy + 0.75) / 0.12)) + exp(-(cx * cx / 0.04 + (fy + 0.75) * (fy + 0.75) / 0.06));
    col = mix(col, col * vec3(1.06, 0.93, 0.92), uPaint * front * 0.6 * clamp(warm, 0.0, 1.0)); }
  // painted marks, from the front: faded out where the surface turns away to the side
  { vec2 muv = (vRest.xy - uMarkBox.xy) / uMarkBox.zw;
    if (muv.x > 0.0 && muv.x < 1.0 && muv.y > 0.0 && muv.y < 1.0 && vRest.z > uMarkZ) { vec4 mk = texture2D(uMarkTex, muv); col = mix(col, mk.rgb, mk.a * smoothstep(-0.05, 0.3, normalize(vON).z)); } }
  // a bone crest a species has raised: lit along its top
  col *= (1.0 + uBone * 0.32 * smoothstep(0.25, 0.95, vMark.x)) * (1.0 - uBone * 0.3 * vMark.y);
  // the brows: a band along a gentle arch from the inner end to the outer, thick at the head and thin at the tail,
  // broken into hairs that run outward
  { float ax = abs(vRest.x), t = (ax - uBrowX.x) / (uBrowX.y - uBrowX.x);
    float yc = mix(mix(uBrowY.x, uBrowY.y, clamp(t * 1.6, 0.0, 1.0)), uBrowY.z, smoothstep(0.62, 1.0, t)), th = mix(uBrowT.x, uBrowT.y, clamp(t, 0.0, 1.0));
    float band = (1.0 - smoothstep(th * 0.55, th, abs(vRest.y - yc))) * smoothstep(-0.06, 0.04, t) * (1.0 - smoothstep(0.94, 1.04, t)) * step(uFaceZ, vRest.z);
    float hairs = texture2D(uNoise, vec2(ax * 7.0 + (vRest.y - yc) * mix(2.5, 0.6, t) * 7.0, (vRest.y - yc) * 1.2)).a;
    col = mix(col, uBrow * mix(0.8, 1.2, nF.r), band * smoothstep(0.25, 0.65, hairs + 0.25 * (1.0 - t)) * uBrowAmt); }
  // light and shade from the form: creases and hollows darken (a touch warmer, where blood shows), proud forms lift
  float cf = vCav.x * 9.0, cb = vCav.y * 16.0;
  sAo = 1.0 - uCav * (0.14 * smoothstep(0.2, 1.6, cb) + 0.28 * smoothstep(0.1, 1.0, cf));
  col *= sAo; col = mix(col, col * vec3(1.04, 0.9, 0.87), uCav * 0.35 * smoothstep(0.2, 1.2, cf + cb));
  col *= 1.0 + uCav * (0.06 * smoothstep(0.0, 0.8, -cb) + 0.08 * smoothstep(0.05, 0.6, -cf));
  // the undersuit, in the base mesh's frame (decimetres); the arms hang out past |x| = 2.6 in the base pose, bare
  float waist = mix(1.05 - 0.12 * smoothstep(0.0, 1.2, abs(vRest.x)), uJoints.w, uSuitTop), hem = mix(-2.35 + 0.18 * smoothstep(0.4, 1.6, abs(vRest.x)), uJoints.z, uSuitLegs);
  float armK = smoothstep(0.25, 0.6, vArm.x);   // how much of this point is arm
  // the shorts stop where the arm begins; the top is cut square at the armpit, in the base pose's own frame where the
  // arms stand well clear of the chest
  float shortsTop = 1.05 - 0.12 * smoothstep(0.0, 1.2, abs(vRest.x));
  float shorts = smoothstep(hem - 0.02, hem + 0.02, vRest.y) * (1.0 - smoothstep(shortsTop - 0.02, shortsTop + 0.02, vRest.y)) * (1.0 - armK);
  float top = uSuitTop * step(shortsTop - 0.03, vRest.y) * (1.0 - smoothstep(waist - 0.02, waist + 0.02, vRest.y)) * (1.0 - smoothstep(1.66, 1.72, abs(vRest.x))) * (1.0 - smoothstep(0.55, 0.7, vArm.x));
  float body = max(shorts, top);
  float sleeveEnd = mix(uJoints.x + 0.2, uJoints.y - 0.25, step(0.75, uSuitArms)), sleeve = step(0.01, uSuitArms) * armK * (1.0 - smoothstep(sleeveEnd - 0.02, sleeveEnd + 0.02, abs(vRest.x)));
  sSuit = uSuitOn * max(body, sleeve);
  float rib = (smoothstep(waist - 0.16, waist - 0.12, vRest.y) + (1.0 - smoothstep(hem + 0.1, hem + 0.14, vRest.y))) * (1.0 - armK);
  col = mix(col, uSuit * mix(0.92, 1.05, nF.b) * (1.0 - 0.18 * rib) * mix(1.0, sAo, 0.6), sSuit);
  diffuseColor.rgb = col;
  // the pores only where a pixel is small enough to hold them; further off they would only sparkle
  sHeight = (nF.r * 0.7 + nF.b * 0.3) * 0.00012 * (1.0 - sSuit) * poreK;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness * mix(0.9, 1.12, nF.r) * mix(1.0, 0.82, lipK) * mix(1.08, 0.94, smoothstep(-0.5, 0.5, -vCav.y * 16.0)), 0.86, sSuit);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  { vec3 sp = -vViewPosition, dpx = dFdx(sp), dpy = dFdy(sp); float hx = dFdx(sHeight), hy = dFdy(sHeight);
    vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx); float det = dot(dpx, r1);
    normal = normalize(abs(det) * normal - sign(det) * (hx * r1 + hy * r2)); }`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(1.0, sAo, 0.7); reflectedLight.indirectSpecular *= sAo;')
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        `{ float wr = saturate( ( dot( geometryNormal, directLight.direction ) + uWrap ) / ( 1.0 + uWrap ) );
           vec3 lit = mix( vec3( dotNL ), vec3( wr * wr ), uScatter );
           reflectedLight.directDiffuse += lit * directLight.color * BRDF_Lambert( material.diffuseColor ); }`));
  };
  m.customProgramCacheKey = () => 'human-skin-6';
  return m;
}
