// The face's paint: one picture wrapped round the head (across: the angle round it, with the front in the middle; up:
// height), drawn fresh whenever a choice changes. It carries everything too fine for the sculpted mesh: lip colour,
// eyebrows, lined eyes, freckles, stubble, the hair's roots along the hairline, and a species' markings (a Mirialan's
// tattoos). Everything is placed in the face's own measurements (metres from the point between the eyes) and carried
// onto the picture through the head as built, so paint stays on its feature whatever the face shape.
import * as THREE from 'three';
import { hairline } from './hair.js';

const Y0 = -0.16, HGT = 0.3;   // the picture runs from 16 cm below the eyes to 14 cm above them
export const WRAP = [0, Y0, 0, HGT];

// how far forward the face is at each (x, y), read off the head's mesh: a grid 2 mm to the cell
function depthMap(pos, at) {
  const C = 0.002, X0 = -0.1, nx = 101, ny = 151, z = new Float32Array(nx * ny).fill(-1);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] - at[0], y = pos[i + 1] - at[1], zz = pos[i + 2] - at[2];
    if (zz < 0) continue;
    const gx = Math.round((x - X0) / C), gy = Math.round((y - Y0) / C);
    if (gx >= 0 && gx < nx && gy >= 0 && gy < ny && zz > z[gx + gy * nx]) z[gx + gy * nx] = zz;
  }
  for (let pass = 0; pass < 3; pass++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {   // close the small gaps
    if (z[i + j * nx] >= 0) continue;
    let s = 0, n = 0; for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = z[Math.min(nx - 1, Math.max(0, i + a)) + Math.min(ny - 1, Math.max(0, j + b)) * nx]; if (v >= 0) { s += v; n++; } }
    if (n > 1) z[i + j * nx] = s / n;
  }
  return (x, y) => {
    const fx = Math.min(nx - 1.001, Math.max(0, (x - X0) / C)), fy = Math.min(ny - 1.001, Math.max(0, (y - Y0) / C)), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const g = (a, b) => Math.max(z[a + b * nx], 0.02);
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  };
}
const hash = (i, j = 0) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
const mix = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t);
const css = (c, a = 1) => { const k = new THREE.Color(c).convertLinearToSRGB(); return `rgba(${Math.round(k.r * 255)},${Math.round(k.g * 255)},${Math.round(k.b * 255)},${a})`; };

export function facePainter(size = 2048) {
  const W = size, H = size / 2, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; texture.wrapS = THREE.RepeatWrapping; texture.channel = 1;
  const mm = W / (2 * Math.PI * 0.088) / 1000;   // picture pixels to a millimetre on the front of the face
  let depth = () => 0.085;
  // a point on the face, in metres, to the picture
  const at = (x, y) => [(0.5 + Math.atan2(x, depth(x, y)) / (2 * Math.PI)) * W, (1 - (y - Y0) / HGT) * H];
  // a point by its angle round the head (radians, 0 the front) and height
  const round = (a, y) => [(0.5 + a / (2 * Math.PI)) * W, (1 - (y - Y0) / HGT) * H];
  const path = (pts, close = true) => { g.beginPath(); pts.forEach(([x, y], i) => { const p = at(x, y); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); if (close) g.closePath(); };
  // draw something with a soft edge: its blurred shadow lands on the picture while the thing itself is drawn off it
  // (this works everywhere, where the canvas blur filter does not)
  const soft = (blur, colour, draw) => { g.save(); g.shadowColor = colour; g.shadowBlur = blur * mm; g.shadowOffsetX = W * 2; g.translate(-W * 2, 0); g.fillStyle = '#000'; g.strokeStyle = '#000'; draw(); g.restore(); };
  const both = (f) => { f(1); f(-1); };

  function paint(o) {
    if (o.mesh) depth = depthMap(o.mesh.position, o.at);
    const P = o.P, L = P.L, Y = (y) => y * L, skin = new THREE.Color(o.skin), hair = new THREE.Color(o.hair || '#2a1d14');
    g.globalAlpha = 1; g.fillStyle = css(skin); g.fillRect(0, 0, W, H);
    // Skin is never one colour. Light where the face turns up to it: the forehead, down the nose, the top of each
    // cheek. Shade where it turns away: under the cheekbones, at the temples, beside the nose, under the lower lip.
    const lightC = css(mix(skin, '#ffffff', 0.3)), darkC = css(skin.clone().multiplyScalar(0.48));
    soft(14, lightC, () => { g.globalAlpha = 0.2; path([[-0.03, 0.03], [0.03, 0.03], [0.034, 0.055], [-0.034, 0.055]]); g.fill(); });
    soft(4, lightC, () => { g.globalAlpha = 0.22; path([[-0.0035, 0.004], [0.0035, 0.004], [0.004, Y(-0.032)], [-0.004, Y(-0.032)]]); g.fill(); });
    both((s) => soft(7, lightC, () => { g.globalAlpha = 0.16; path([[s * 0.026, Y(-0.014)], [s * 0.05, Y(-0.014)], [s * 0.047, Y(-0.026)], [s * 0.028, Y(-0.026)]]); g.fill(); }));
    both((s) => soft(9, darkC, () => { g.globalAlpha = 0.17; path([[s * 0.04, Y(-0.04)], [s * 0.062, Y(-0.034)], [s * 0.058, Y(-0.07)], [s * 0.04, Y(-0.075)]]); g.fill(); }));
    both((s) => soft(8, darkC, () => { g.globalAlpha = 0.14; path([[s * 0.052, 0.02], [s * 0.066, 0.02], [s * 0.066, 0.05], [s * 0.055, 0.05]]); g.fill(); }));
    both((s) => soft(3, darkC, () => { g.globalAlpha = 0.16; path([[s * 0.009, Y(-0.012)], [s * 0.014, Y(-0.012)], [s * 0.017, Y(-0.04)], [s * 0.012, Y(-0.04)]]); g.fill(); }));
    soft(4, darkC, () => { g.globalAlpha = 0.2; path([[-0.014, Y(-0.083)], [0.014, Y(-0.083)], [0.012, Y(-0.089)], [-0.012, Y(-0.089)]]); g.fill(); });
    soft(2.5, darkC, () => { g.globalAlpha = 0.34; path([[-0.0125, Y(-0.0445)], [0.0125, Y(-0.0445)], [0.0105, Y(-0.0515)], [-0.0105, Y(-0.0515)]]); g.fill(); });   // the underside of the nose is in shadow
    for (let k = 0; k < 70; k++) {   // and a faint unevenness all over
      const p = round((hash(k, 91) - 0.5) * 3.0, -0.11 + 0.2 * hash(k, 93));
      soft(5, hash(k, 95) > 0.5 ? lightC : darkC, () => { g.globalAlpha = 0.05; g.beginPath(); g.arc(p[0], p[1], (2 + 4 * hash(k, 97)) * mm, 0, 7); g.fill(); });
    }
    // warmth in the cheeks, the nose and the ears
    const flush = css(mix(skin, o.flush || '#b0453c', 0.55), 1);
    both((s) => soft(9, flush, () => { g.globalAlpha = 0.2 * (o.flushAmount ?? 1); path([[s * 0.03, Y(-0.02)], [s * 0.055, Y(-0.024)], [s * 0.052, Y(-0.05)], [s * 0.032, Y(-0.05)]]); g.fill(); }));
    soft(5, flush, () => { g.globalAlpha = 0.16; path([[-0.008, Y(-0.03)], [0.008, Y(-0.03)], [0.009, Y(-0.044)], [-0.009, Y(-0.044)]]); g.fill(); });
    both((s) => soft(6, flush, () => { g.globalAlpha = 0.2; const p = round(s * 1.42, -0.012); g.beginPath(); g.ellipse(p[0], p[1], 9 * mm, 16 * mm, 0, 0, 7); g.fill(); }));
    // a shade round the eyes (deeper for lined eyes)
    const shade = css(mix(skin, o.eyeShade || '#1a1014', 0.6), 1), lined = o.liner ?? 0.25;
    both((s) => soft(3.2, shade, () => { g.globalAlpha = 0.2 + 0.5 * lined; const e = P.eye; path([[s * (e[0] - 0.018), 0.001], [s * (e[0] - 0.008), 0.0085], [s * (e[0] + 0.006), 0.0095], [s * (e[0] + 0.018), 0.005], [s * (e[0] + 0.017), -0.006], [s * (e[0] + 0.002), -0.0095], [s * (e[0] - 0.013), -0.007]]); g.fill(); }));

    // the lips: the upper with its bow, the lower fuller; then the line between them
    const lip = css(o.lips ? new THREE.Color(o.lips) : mix(skin, '#8a2f33', 0.42), 1), ml = Y(-0.0679);
    const upper = [[-0.0262, ml - 0.0004], [-0.017, Y(-0.0636)], [-0.0085, Y(-0.0596)], [-0.0035, Y(-0.0584)], [0, Y(-0.0596)], [0.0035, Y(-0.0584)], [0.0085, Y(-0.0596)], [0.017, Y(-0.0636)], [0.0262, ml - 0.0004], [0.013, ml + 0.0002], [0, ml + 0.0008], [-0.013, ml + 0.0002]];
    const lower = [[-0.0262, ml - 0.0004], [-0.013, ml + 0.0002], [0, ml + 0.0008], [0.013, ml + 0.0002], [0.0262, ml - 0.0004], [0.019, Y(-0.0752)], [0.0095, Y(-0.0798)], [0, Y(-0.0808)], [-0.0095, Y(-0.0798)], [-0.019, Y(-0.0752)]];
    // soft-edged, and fainter on a masculine face, where lips are barely a different colour from the skin
    for (const [shape, a] of [[upper, 0.86], [lower, 0.8]]) soft(1.8, lip, () => { g.globalAlpha = a * (o.lipAmount ?? 1 - 0.4 * P.masc); path(shape); g.fill(); });
    g.save(); g.globalAlpha = 0.5; g.strokeStyle = css(mix(skin, '#1c0b0c', 0.8)); g.lineWidth = 0.8 * mm; g.lineCap = 'round'; path([[-0.0262, ml - 0.0006], [-0.013, ml], [0, ml + 0.0006], [0.013, ml], [0.0262, ml - 0.0006]], false); g.stroke(); g.restore();

    // the eyebrows: a soft shape under many short hairs, thick by the nose and thin at the tail
    const pale = hair.r * 0.3 + hair.g * 0.59 + hair.b * 0.11 > 0.3;   // pale hair wants darker brows, or they vanish
    const brow = css(o.brow ? new THREE.Color(o.brow) : hair.clone().multiplyScalar(pale ? 0.42 : 0.85), 1), bw = (0.9 + 0.5 * P.masc) * (o.browWeight ?? 1);
    // low over the eye and nearly straight on a masculine face; a little higher and more arched on a feminine one
    const arch = 0.6 + 0.6 * (1 - P.masc), lift = 0.0035 * (1 - P.masc);
    const spine = [[0.0085, 0.0158], [0.016, 0.0182], [0.026, 0.0198], [0.037, 0.0202], [0.047, 0.0186], [0.0545, 0.0155]].map(([x, y]) => [x * P.fw, 0.0182 + (y - 0.0158) * arch + lift]);
    const thick = [0.0034, 0.0036, 0.0031, 0.0025, 0.0017, 0.0008].map((t) => t * bw);
    both((s) => {
      soft(1.4, brow, () => { g.globalAlpha = 0.55; const top = spine.map(([x, y], i) => [s * x, y + thick[i]]), bot = spine.map(([x, y], i) => [s * x, y - thick[i]]).reverse(); path([...top, ...bot]); g.fill(); });
      g.save(); g.strokeStyle = brow; g.lineCap = 'round';
      for (let k = 0; k < 150; k++) {
        const t = hash(k, 3) * (spine.length - 1.001), i = Math.floor(t), f = t - i, x = spine[i][0] + (spine[i + 1][0] - spine[i][0]) * f, y = spine[i][1] + (spine[i + 1][1] - spine[i][1]) * f, th = thick[i] + (thick[i + 1] - thick[i]) * f;
        const oy = (hash(k, 7) - 0.5) * 2 * th, len = 0.0022 + 0.002 * hash(k, 11), lean = 0.55 - 0.9 * (t / (spine.length - 1));   // hairs stand up by the nose and lie along the tail
        const a = at(s * x, y + oy), b = at(s * (x + len * Math.cos(lean)), y + oy + len * Math.sin(lean) * 0.8);
        g.globalAlpha = 0.5 + 0.4 * hash(k, 13); g.lineWidth = (0.22 + 0.2 * hash(k, 17)) * mm; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      }
      g.restore();
    });

    if (o.freckles) {   // a scatter across the nose and cheeks
      g.fillStyle = css(mix(skin, '#5b2f1c', 0.6));
      for (let k = 0; k < 260; k++) { const x = (hash(k, 21) - 0.5) * 0.1, y = Y(-0.002 - 0.05 * hash(k, 23)); if (Math.abs(x) < 0.006 && y < Y(-0.03)) continue; const p = at(x, y); g.globalAlpha = 0.18 + 0.3 * hash(k, 29); g.beginPath(); g.arc(p[0], p[1], (0.35 + 0.5 * hash(k, 31)) * mm, 0, 7); g.fill(); }
    }
    if (o.stubble) {   // a day's growth on the jaw, chin and lip
      g.fillStyle = css(hair.clone().multiplyScalar(0.7));
      for (let k = 0; k < 5200; k++) {
        const a = (hash(k, 41) - 0.5) * 2.5, y = Y(-0.045 - 0.085 * hash(k, 43)), top = Y(-0.052) - 0.03 * Math.min(1, Math.abs(a) / 1.1) + (Math.abs(a) < 0.34 ? 0.004 : 0.012);
        if (y > top + 0.03 || (Math.abs(a) < 0.3 && y > Y(-0.058) && y < Y(-0.05) === false && y > Y(-0.082) && y < Y(-0.06) && Math.abs(a) < 0.26)) { /* the lips stay clear */ }
        if (y > Y(-0.0585) && Math.abs(a) > 0.36 && y > Y(-0.03) - Math.abs(a) * 0.045) continue;
        if (Math.abs(a) < 0.27 && y < Y(-0.059) && y > Y(-0.083)) continue;
        const p = round(a, y); g.globalAlpha = (0.16 + 0.22 * hash(k, 47)) * o.stubble; g.fillRect(p[0], p[1], 0.3 * mm, 0.42 * mm);
      }
    }
    if (o.marks) o.marks({ g, at, round, path, soft, both, mm, P, Y, css, mix, hash, skin });
    // the hair's roots: everything above the hairline, so no bare scalp shows between locks (and a shaved head is this alone)
    if (o.scalp) {
      const line = o.hairline || hairline;
      // (the roots fade out just past the hair itself)
      soft(3.2, css(mix(skin, hair, 0.82)), () => { g.globalAlpha = o.scalp; g.beginPath(); for (let i = 0; i <= 256; i++) { const a = -Math.PI + (i / 256) * 2 * Math.PI, p = round(a, line(a) - 0.0025); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); } g.lineTo(W, -40); g.lineTo(0, -40); g.closePath(); g.fill(); });
    }
    g.globalAlpha = 1; texture.needsUpdate = true;
  }
  return { canvas, texture, paint };
}
