/* ------------------------------------------------------------------
   NIGHT CITY  --  three.js r185, vendored. A scene that plays at you.
   Camera on rails down a wet street. The signs are the whole point.
------------------------------------------------------------------- */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import * as BGU from "three/addons/utils/BufferGeometryUtils.js";

const STREET_HALF = 7.0;    // distance from centreline to the shopfronts
const SEG_LEN = 62;         // length of one recycled chunk of street
const FOG_COLOUR = 0x140b1e;

/* ---------- little helpers ---------- */
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function bail(msg) {
  const p = document.createElement("p");
  p.className = "oops";
  p.textContent = msg;
  document.body.appendChild(p);
}

/* ------------------------------------------------------------------
   1. THE SIGNS
------------------------------------------------------------------- */

const FONTS = {
  ja: '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Meiryo","Noto Sans JP","MS PGothic",sans-serif',
  zh: '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","SimHei",sans-serif',
  ko: '"Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR","NanumGothic",sans-serif',
  ar: '"Geeza Pro","Segoe UI","Noto Sans Arabic","Tahoma",sans-serif',
  he: '"Arial Hebrew","Segoe UI","Noto Sans Hebrew","Tahoma",sans-serif',
  th: '"Thonburi","Leelawadee UI","Noto Sans Thai","Tahoma",sans-serif',
  dv: '"Kohinoor Devanagari","Nirmala UI","Noto Sans Devanagari",sans-serif',
  la: '"Helvetica Neue",Arial,sans-serif'
};

/* hot pink, cyan, sodium, acid green, violet, ember, arc-white */
const NEON = [
  { core: "#ffe3ef", glow: "#ff2d7a" },
  { core: "#dcfcff", glow: "#19d8ff" },
  { core: "#fff0d0", glow: "#ffab2b" },
  { core: "#dfffe9", glow: "#2bff88" },
  { core: "#efe4ff", glow: "#a86bff" },
  { core: "#ffe0d4", glow: "#ff5533" },
  { core: "#ffffff", glow: "#8fd8ff" }
];

const SIGNS = [
  { t: "電気", s: "ja", v: true },  { t: "ラーメン", s: "ja", v: true },
  { t: "酒場", s: "ja", v: true },  { t: "質屋", s: "ja", v: true },
  { t: "焼鳥", s: "ja", v: true },  { t: "夜光", s: "ja", v: true },
  { t: "新宿", s: "ja", v: true },  { t: "楽器", s: "ja", v: true },
  { t: "ゴブリン", s: "ja", v: true },
  { t: "深夜食堂", s: "ja" },       { t: "二十四時間", s: "ja" },
  { t: "麵館", s: "zh", v: true },  { t: "夜市", s: "zh", v: true },
  { t: "當鋪", s: "zh", v: true },  { t: "電子城", s: "zh", v: true },
  { t: "冷飲", s: "zh", v: true },  { t: "龍門客棧", s: "zh" },
  { t: "전자", s: "ko", v: true },  { t: "국밥", s: "ko", v: true },
  { t: "노래방", s: "ko" },          { t: "야시장", s: "ko" },
  { t: "ЭЛЕКТРО", s: "la" },        { t: "НОЧЬ", s: "la" },
  { t: "ОБМЕН", s: "la" },          { t: "БАР", s: "la" },
  { t: "ΝΕΟΝ", s: "la" },           { t: "ΑΓΟΡΑ", s: "la" },
  { t: "كهرباء", s: "ar", rtl: true }, { t: "سوق الليل", s: "ar", rtl: true },
  { t: "חשמל", s: "he", rtl: true },   { t: "לילה", s: "he", rtl: true },
  { t: "ไฟฟ้า", s: "th" },          { t: "ตลาด", s: "th" },
  { t: "बिजली", s: "dv" },          { t: "बाज़ार", s: "dv" },
  { t: "RAMEN", s: "la" },          { t: "PAWN", s: "la" },
  { t: "HOTEL", s: "la", v: true }, { t: "24 HOURS", s: "la" },
  { t: "KARAOKE", s: "la" },        { t: "NO VACANCY", s: "la" },
  { t: "GUITARS", s: "la" },        { t: "BOOFER'S", s: "la" },
  { t: "OPEN ALL NIGHT", s: "la" }
];

/* Canvas will happily draw tofu boxes for glyphs the device hasn't got.
   Measure first: a missing glyph is the same width as U+FFFF's notdef. */
const glyphProbe = document.createElement("canvas").getContext("2d");
function scriptAvailable(text, font) {
  glyphProbe.font = "64px " + font;
  const notdef = glyphProbe.measureText("\uFFFF").width;
  const known = glyphProbe.measureText("H").width;
  if (Math.abs(notdef - known) < 0.5) return true;   // probe is useless here, take the chance
  for (const ch of text) {
    if (ch === " " || ch === "'") continue;
    if (Math.abs(glyphProbe.measureText(ch).width - notdef) < 0.5) return false;
  }
  return true;
}

/* Draw glowing tube-lettering: fat blurred passes underneath, hot core on top. */
function drawGlow(ctx, draw, colour, scale) {
  ctx.fillStyle = colour.glow;
  ctx.shadowColor = colour.glow;
  for (const blur of [34, 20, 11]) {
    ctx.shadowBlur = blur * scale;
    draw();
  }
  ctx.shadowBlur = 8 * scale;
  ctx.fillStyle = colour.core;
  draw();
  ctx.shadowBlur = 0;
  draw();
}

function makeSignTexture(spec, colour) {
  const font = FONTS[spec.s] || FONTS.la;
  const vertical = Boolean(spec.v);
  const chars = Array.from(spec.t);
  const W = vertical ? 192 : 640;
  const H = vertical ? Math.min(768, 150 * chars.length + 60) : 176;

  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (spec.rtl) ctx.direction = "rtl";

  if (vertical) {
    const step = (H - 40) / chars.length;
    const size = Math.min(step * 0.78, 118);
    ctx.font = "700 " + size + "px " + font;
    chars.forEach((ch, i) => {
      const y = 20 + step * (i + 0.5);
      drawGlow(ctx, () => ctx.fillText(ch, W / 2, y), colour, 1);
    });
  } else {
    let size = 112;
    ctx.font = "800 " + size + "px " + font;
    const wanted = W - 70;
    const w = ctx.measureText(spec.t).width;
    if (w > wanted) {
      size = Math.max(34, size * (wanted / w));
      ctx.font = "800 " + size + "px " + font;
    }
    drawGlow(ctx, () => ctx.fillText(spec.t, W / 2, H / 2 + 4), colour, size / 112);
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, w: W, h: H };
}

/* ------------------------------------------------------------------
   2. WINDOWS
------------------------------------------------------------------- */
function makeWindowTexture() {
  const S = 512, cells = 8, cell = S / cells;
  const cv = document.createElement("canvas");
  cv.width = cv.height = S;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#08060f";
  ctx.fillRect(0, 0, S, S);

  const warm = ["#ffd79a", "#ffbe6b", "#ffe9c4"];
  const cold = ["#9fd8ff", "#c9ecff", "#6fb6ff"];
  const odd  = ["#ff7fb0", "#8affc8"];

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const px = x * cell + cell * 0.18, py = y * cell + cell * 0.16;
      const pw = cell * 0.64, ph = cell * 0.56;
      const roll = Math.random();
      if (roll < 0.42) { ctx.fillStyle = "#0c0a16"; ctx.fillRect(px, py, pw, ph); continue; }
      const pal = roll < 0.78 ? warm : (roll < 0.96 ? cold : odd);
      ctx.fillStyle = pick(pal);
      ctx.globalAlpha = rand(0.45, 1.0);
      ctx.fillRect(px, py, pw, ph);
      ctx.globalAlpha = 1;
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/* soft elongated pool of light for the wet road */
function makePoolTexture() {
  const W = 128, H = 512;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.35, "rgba(255,255,255,0.42)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // chew the edges up so it reads as broken water rather than an airbrush
  const side = ctx.createLinearGradient(0, 0, W, 0);
  side.addColorStop(0, "rgba(0,0,0,1)");
  side.addColorStop(0.5, "rgba(0,0,0,0)");
  side.addColorStop(1, "rgba(0,0,0,1)");
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  for (let i = 0; i < 220; i++) {
    ctx.globalAlpha = rand(0.05, 0.3);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, Math.random() * H, W, rand(1, 4));
  }
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

/* ------------------------------------------------------------------
   3. BOOT
------------------------------------------------------------------- */
const canvas = document.getElementById("gl");
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
} catch (e) {
  bail("This one needs WebGL, and this browser isn't offering it.");
  throw e;
}

const coarse = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || window.innerWidth < 700;

const TIERS = [
  { name: "low",  dpr: 0.75, bloom: 0.95, rain: 700 },
  { name: "med",  dpr: 1.00, bloom: 1.15, rain: 1600 },
  { name: "high", dpr: 1.50, bloom: 1.30, rain: 2800 }
];
let tier = coarse ? 0 : 1;
let userPicked = false;

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIERS[tier].dpr));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG_COLOUR, 0.024);
scene.background = new THREE.Color(FOG_COLOUR);

const camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 2.4, 0);


/* ------------------------------------------------------------------
   4. THE STREET
------------------------------------------------------------------- */
const windowTex = makeWindowTexture();
const poolTex = makePoolTexture();
const buildingMat = new THREE.MeshBasicMaterial({ map: windowTex, vertexColors: true, fog: true });

/* pre-bake the sign textures once, reuse across the whole street */
const signBank = [];
for (const spec of SIGNS) {
  const font = FONTS[spec.s] || FONTS.la;
  if (!scriptAvailable(spec.t, font)) continue;      // device hasn't got the glyphs; skip quietly
  const colour = pick(NEON);
  const made = makeSignTexture(spec, colour);
  signBank.push({
    tex: made.tex,
    aspect: made.w / made.h,
    vertical: Boolean(spec.v),
    glow: new THREE.Color(colour.glow)
  });
}
if (signBank.length === 0) {
  // vanishingly unlikely, but a city with no signs is just a dark corridor
  const made = makeSignTexture({ t: "NIGHT CITY", s: "la" }, NEON[0]);
  signBank.push({ tex: made.tex, aspect: made.w / made.h, vertical: false, glow: new THREE.Color(NEON[0].glow) });
}

const poolGeo = new THREE.PlaneGeometry(1, 1);
const pools = [];

function buildSegment() {
  const group = new THREE.Group();
  const geos = [];
  const spans = [];   // [side, zStart, zEnd, height] of every facade we can hang a sign on

  for (const side of [-1, 1]) {
    let z = 0;
    while (z < SEG_LEN) {
      if (Math.random() < 0.11) { z += rand(4, 7); continue; }   // an alley
      const len = rand(7, 15);
      const depth = rand(6, 20);
      const h = rand(9, 46) * (Math.random() < 0.18 ? 1.7 : 1);
      const g = new THREE.BoxGeometry(depth, h, Math.min(len, SEG_LEN - z));

      // window scale: keep panes roughly the same size whatever the box
      const uv = g.attributes.uv;
      const rx = rand(0, 8), ry = rand(0, 8);
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * 2.0 + rx, uv.getY(i) * (h / 7.0) + ry);
      }
      const tint = new THREE.Color().setHSL(rand(0.68, 0.82), rand(0.25, 0.5), rand(0.42, 0.72));
      const col = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < g.attributes.position.count; i++) {
        col[i * 3] = tint.r; col[i * 3 + 1] = tint.g; col[i * 3 + 2] = tint.b;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));

      const zc = z + Math.min(len, SEG_LEN - z) / 2;
      g.translate(side * (STREET_HALF + depth / 2), h / 2, zc);
      geos.push(g);
      spans.push({ side, z0: z + 1, z1: z + len - 1, h });
      z += len;
    }
  }

  // far towers, pure silhouette, just to give the fog something to hide
  for (let i = 0; i < 7; i++) {
    const w = rand(10, 26), h = rand(30, 95);
    const g = new THREE.BoxGeometry(w, h, rand(10, 26));
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * 3, uv.getY(k) * (h / 9));
    const tint = new THREE.Color().setHSL(rand(0.7, 0.8), 0.35, rand(0.16, 0.3));
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < g.attributes.position.count; k++) {
      col[k * 3] = tint.r; col[k * 3 + 1] = tint.g; col[k * 3 + 2] = tint.b;
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.translate(pick([-1, 1]) * rand(34, 110), h / 2, rand(0, SEG_LEN));
    geos.push(g);
  }

  const merged = BGU.mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  group.add(new THREE.Mesh(merged, buildingMat));

  /* ---- signs ---- */
  const wanted = 9 + ((Math.random() * 4) | 0);
  for (let i = 0; i < wanted && spans.length; i++) {
    const span = pick(spans);
    const s = pick(signBank);
    const zc = rand(span.z0, Math.max(span.z0 + 0.5, span.z1));

    let hgt = s.vertical ? rand(3.4, 6.2) : rand(1.0, 1.9);
    const wid = hgt * s.aspect;
    const mat = new THREE.MeshBasicMaterial({
      map: s.tex, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, fog: true, toneMapped: false
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wid, hgt), mat);
    mesh.position.set(span.side * (STREET_HALF - 0.28), rand(2.6, Math.max(3.2, Math.min(span.h - 1.5, 17))), zc);
    mesh.rotation.y = span.side < 0 ? Math.PI / 2 : -Math.PI / 2;
    mesh.renderOrder = 3;
    group.add(mesh);

    // and its pool on the wet road
    const pmat = new THREE.MeshBasicMaterial({
      map: poolTex, transparent: true, depthWrite: false,
      color: s.glow, opacity: 0.5, fog: true, toneMapped: false,
      blending: THREE.AdditiveBlending
    });
    const pool = new THREE.Mesh(poolGeo, pmat);
    pool.scale.set(rand(2.4, 4.4), rand(10, 20), 1);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(span.side * rand(2.2, STREET_HALF - 0.6), 0.02, zc);
    pool.renderOrder = 1;
    group.add(pool);
    pools.push({ mesh: pool, base: pmat.opacity, phase: Math.random() * 6.28 });
  }

  return group;
}

const SEGMENTS = coarse ? 5 : 7;
const segs = [];
const world = new THREE.Group();
scene.add(world);
for (let i = 0; i < SEGMENTS; i++) {
  const g = buildSegment();
  g.position.z = i * SEG_LEN;
  world.add(g);
  segs.push(g);
}

/* road */
const roadMat = new THREE.MeshBasicMaterial({ color: 0x08060e, fog: true });
const road = new THREE.Mesh(new THREE.PlaneGeometry(2 * STREET_HALF, SEG_LEN * SEGMENTS + 200), roadMat);
road.rotation.x = -Math.PI / 2;
scene.add(road);

/* a wet sheen straight down the centreline, because asphalt in the rain is a mirror */
const sheenMat = new THREE.MeshBasicMaterial({
  map: poolTex, transparent: true, depthWrite: false, opacity: 0.13,
  color: 0xb98cff, blending: THREE.AdditiveBlending, fog: true, toneMapped: false
});
const sheen = new THREE.Mesh(new THREE.PlaneGeometry(2 * STREET_HALF, 90), sheenMat);
sheen.rotation.x = -Math.PI / 2;
sheen.position.y = 0.015;
sheen.renderOrder = 0;
scene.add(sheen);

/* ------------------------------------------------------------------
   5. RAIN
------------------------------------------------------------------- */
const DROPS = TIERS[tier].rain;
const rainGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(DROPS * 2 * 3);
  const end = new Float32Array(DROPS * 2);
  const seed = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i++) {
    const x = rand(-26, 26), y = rand(0, 34), z = rand(-70, 70), sd = Math.random();
    for (let k = 0; k < 2; k++) {
      const o = (i * 2 + k) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      end[i * 2 + k] = k;
      seed[i * 2 + k] = sd;
    }
  }
  rainGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  rainGeo.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
  rainGeo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
}
const rainMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 }, uCam: { value: 0 }, uFog: { value: 0.024 } },
  vertexShader: `
    attribute float aEnd;
    attribute float aSeed;
    uniform float uTime;
    uniform float uCam;
    uniform float uFog;
    varying float vA;
    void main(){
      vec3 p = position;
      float speed = 20.0 + aSeed * 26.0;
      p.y = mod(p.y - uTime * speed, 34.0);
      p.z = mod(p.z - uCam + 70.0, 140.0) - 70.0 + uCam;
      float len = 0.5 + aSeed * 1.4;
      p.y += aEnd * len;
      p.x += aEnd * 0.16;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float d = -mv.z;
      vA = (0.20 + aSeed * 0.4) * exp(-d * uFog * 1.35) * smoothstep(1.0, 6.0, d);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA;
    void main(){ gl_FragColor = vec4(vec3(0.66, 0.76, 1.0) * vA, vA); }`
});
const rain = new THREE.LineSegments(rainGeo, rainMat);
rain.frustumCulled = false;
rain.renderOrder = 4;
scene.add(rain);

/* ------------------------------------------------------------------
   6. POST
------------------------------------------------------------------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  TIERS[tier].bloom, 0.62, 0.35
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ------------------------------------------------------------------
   7. UI
------------------------------------------------------------------- */
const qLabel = document.getElementById("qLabel");
qLabel.textContent = TIERS[tier].name;
document.getElementById("quality").addEventListener("click", () => {
  tier = (tier + 1) % TIERS.length;
  userPicked = true;
  applyTier();
});
function applyTier() {
  const q = TIERS[tier];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
  bloom.strength = q.bloom;
  qLabel.textContent = q.name;
  onResize();
}

let paused = false, suspended = false, looping = false;
const pauseBtn = document.getElementById("pause");
pauseBtn.addEventListener("click", () => {
  paused = !paused;
  pauseBtn.innerHTML = paused ? "&#9654;" : "&#10073;&#10073;";
  wake();
});
const drawer = document.getElementById("drawer");
const backdrop = document.getElementById("backdrop");
function openDrawer(on) {
  drawer.classList.toggle("open", on);
  backdrop.classList.toggle("open", on);
  drawer.setAttribute("aria-hidden", on ? "false" : "true");
  suspended = on || document.hidden;
  wake();
}
document.getElementById("srcBtn").addEventListener("click", () => openDrawer(!drawer.classList.contains("open")));
document.getElementById("closeX").addEventListener("click", () => openDrawer(false));
backdrop.addEventListener("click", () => openDrawer(false));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") openDrawer(false); });
document.addEventListener("visibilitychange", () => {
  suspended = document.hidden || drawer.classList.contains("open");
  wake();
});

/* the page will show you its own source, because why not */
const srcEl = document.getElementById("src");
fetch("city.js")
  .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
  .then((txt) => { srcEl.textContent = txt; })
  .catch(() => { srcEl.textContent = "Couldn't fetch city.js from here. It's in the repo."; });
const copyBtn = document.getElementById("copyBtn");
copyBtn.addEventListener("click", () => {
  const txt = srcEl.textContent;
  const done = () => { copyBtn.textContent = "copied"; setTimeout(() => { copyBtn.textContent = "copy"; }, 1400); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done, () => { copyBtn.textContent = "no dice"; });
  } else { copyBtn.textContent = "no dice"; }
});

/* gentle parallax; the camera is on rails either way */
let lookX = 0.5, lookY = 0.5, aimX = 0.5, aimY = 0.5;
const hint = document.getElementById("hint");
let hintGone = false;
function point(x, y) {
  aimX = x / window.innerWidth;
  aimY = 1 - y / window.innerHeight;
  if (!hintGone) { hintGone = true; hint.classList.add("gone"); }
}
window.addEventListener("mousemove", (e) => point(e.clientX, e.clientY));
window.addEventListener("touchmove", (e) => { if (e.touches.length) point(e.touches[0].clientX, e.touches[0].clientY); }, { passive: true });
if (coarse) hint.textContent = "drag to lean the camera";

canvas.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  looping = false;
  bail("The graphics context gave out. Reload, and knock the quality down a notch.");
});

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  // the composer caches the pixel ratio at construction; it has to be told again
  // whenever the quality tier moves it, or the buffers stay at the old resolution
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
}
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);
onResize();

/* ------------------------------------------------------------------
   8. LOOP
------------------------------------------------------------------- */
const SPEED = 8.2;
let clock = 0, last = performance.now(), slow = 0;
const aim = new THREE.Vector3();

function wake() {
  if (paused || suspended || looping) return;
  last = performance.now();
  looping = true;
  requestAnimationFrame(frame);
}

function frame(now) {
  if (paused || suspended) { looping = false; return; }
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  clock += dt;

  if (!userPicked) {
    if (dt > 0.042) slow += 2; else if (slow > 0) slow--;
    if (slow > 90 && tier > 0) { tier--; slow = 0; userPicked = tier === 0; applyTier(); }
  }

  /* rails */
  const z = clock * SPEED;
  lookX += (aimX - lookX) * 0.05;
  lookY += (aimY - lookY) * 0.05;
  camera.position.set(
    Math.sin(clock * 0.21) * 1.7 + (lookX - 0.5) * 2.6,
    2.35 + Math.sin(clock * 0.33) * 0.14,
    z
  );
  aim.set(Math.sin(clock * 0.17 + 1.1) * 3.4, 5.0 - (lookY - 0.5) * 6.0, z + 13);
  camera.lookAt(aim);
  camera.rotation.z += Math.sin(clock * 0.26) * 0.028;

  /* recycle the street behind us */
  const span = SEGMENTS * SEG_LEN;
  for (const s of segs) {
    if (s.position.z < z - SEG_LEN * 1.2) s.position.z += span;
  }
  road.position.z = z;
  sheen.position.z = z + 26;
  rainMat.uniforms.uTime.value = clock;
  rainMat.uniforms.uCam.value = z;

  /* the pools breathe, the way reflections do on moving water */
  for (const p of pools) {
    p.mesh.material.opacity = p.base * (0.72 + 0.28 * Math.sin(clock * 2.1 + p.phase));
  }

  composer.render();
  requestAnimationFrame(frame);
}

document.body.classList.add("ready");
wake();
