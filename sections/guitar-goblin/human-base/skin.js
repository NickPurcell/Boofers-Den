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
  };
  m.userData.u = u;
  m.userData.set = (s = {}) => {
    if (s.tone) { u.uSkin.value.set(s.tone); const lip = new THREE.Color(s.tone), hsl = {}; lip.getHSL(hsl); lip.setHSL(hsl.h * 0.96, Math.min(1, hsl.s * 1.1 + 0.05), hsl.l * 0.8); u.uLip.value.copy(lip); }
    if (s.lips) u.uLip.value.set(s.lips);
    if (s.brow) u.uBrow.value.set(s.brow);
    if (s.browAmount !== undefined) u.uBrowAmt.value = s.browAmount;
    if (s.suit) u.uSuit.value.set(s.suit);
    if (s.suitOn !== undefined) u.uSuitOn.value = s.suitOn ? 1 : 0;
    if (s.suitCover) { const c = s.suitCover; if (c.torso !== undefined) u.uSuitTop.value = c.torso ? 1 : 0; if (c.arms !== undefined) u.uSuitArms.value = c.arms; if (c.legs !== undefined) u.uSuitLegs.value = c.legs; }
    if (s.cavity !== undefined) u.uCav.value = s.cavity;
    if (s.paint !== undefined) u.uPaint.value = s.paint;
    if (s.sockets !== undefined) u.uSocket.value = s.sockets;
    if (s.bone !== undefined) u.uBone.value = s.bone;
  };
  m.userData.set(o);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', 'attribute float aLip; attribute vec3 aRest; attribute vec2 aCav; attribute vec2 aMark; attribute vec2 aArm; varying float vLip; varying vec3 vOP; varying vec3 vON; varying vec3 vRest; varying vec2 vCav; varying vec2 vMark; varying vec2 vArm;\n#include <common>')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLip = aLip; vOP = position; vON = normal; vRest = aRest; vCav = aCav; vMark = aMark; vArm = aArm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `uniform vec3 uSkin; uniform vec3 uLip; uniform sampler2D uNoise; uniform float uWrap; uniform vec3 uScatter; uniform vec3 uSuit; uniform float uSuitOn; uniform float uCav;
uniform vec3 uBrow; uniform float uBrowAmt; uniform vec2 uBrowX; uniform vec3 uBrowY; uniform vec2 uBrowT; uniform float uFaceZ; uniform vec3 uEyeC; uniform float uD; uniform float uPaint; uniform float uSocket; uniform float uBone; varying vec2 vMark; uniform float uSuitTop; uniform float uSuitArms; uniform float uSuitLegs; uniform vec4 uJoints; varying vec2 vArm;
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
  m.customProgramCacheKey = () => 'human-skin-5';
  return m;
}
