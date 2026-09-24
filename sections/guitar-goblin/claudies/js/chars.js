/* ==========================================================================
   chars.js  —  "Five Nights at Claudie's" character art
   100% procedural Canvas 2D. No images, no network fonts, no libraries.
   Classic script: defines window.CHARS.

   API
     CHARS.draw(ctx, id, x, y, h, opts)      full body, feet-center at (x,y)
         opts: { pose, t, dark, glow, glitch, flip }
     CHARS.face(ctx, id, cx, cy, size, opts) head close-up centered at (cx,cy)
         opts: { t, scream, glow, dark, glitch }
     CHARS.jumpscare(ctx, id, p, t, W, H)    full-frame jumpscare frame
     CHARS.eyes(id, pose)                    eye positions relative to feet, in units of h
     CHARS.ids, CHARS.names, CHARS.poses, CHARS.warm(id, pose, h), CHARS.clearCache()

   Internals: every character is modelled in "units" where the standing figure
   is 100 units tall (feet at y=0, top of head at y≈-100). The body (minus
   head) and the head are rendered once per size bucket into offscreen
   canvases; darkness is a cached silhouette composited on top with alpha;
   eye glow, twitches and glitch slices are layered live.
   ========================================================================== */
(function () {
  'use strict';

  var TAU = Math.PI * 2, PI = Math.PI;
  var FONT = '"Courier New", Courier, monospace';

  /* ------------------------------------------------------------ utilities */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lp(p, q, t) { return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]; }
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(a, b) {
    var h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }
  var _cc = {};
  function prgb(c) {
    var v = _cc[c];
    if (v) return v;
    var n = parseInt(c.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    _cc[c] = v; return v;
  }
  function hex(r, g, b) {
    r = clamp(Math.round(r), 0, 255); g = clamp(Math.round(g), 0, 255); b = clamp(Math.round(b), 0, 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  /* shade: f>0 lightens toward white, f<0 darkens toward black */
  function sh(c, f) {
    var v = prgb(c);
    if (f >= 0) return hex(v[0] + (255 - v[0]) * f, v[1] + (255 - v[1]) * f, v[2] + (255 - v[2]) * f);
    return hex(v[0] * (1 + f), v[1] * (1 + f), v[2] * (1 + f));
  }
  function mixc(a, b, t) {
    var x = prgb(a), y = prgb(b);
    return hex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t));
  }
  function rgba(c, a) { var v = prgb(c); return 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + a + ')'; }

  /* ------------------------------------------------------ path primitives */
  function E(c, x, y, rx, ry, rot) {
    c.beginPath(); c.ellipse(x, y, Math.abs(rx) + 1e-4, Math.abs(ry) + 1e-4, rot || 0, 0, TAU);
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }
  /* radial "volume" fill of current path, lit from upper-left */
  function vol(c, cx, cy, r, base, hl, dk) {
    var g = c.createRadialGradient(cx - r * 0.35, cy - r * 0.45, r * 0.04, cx, cy, r * 1.2);
    g.addColorStop(0, sh(base, hl == null ? 0.3 : hl));
    g.addColorStop(0.45, base);
    g.addColorStop(1, sh(base, -(dk == null ? 0.7 : dk)));
    c.fillStyle = g; c.fill();
  }
  /* tapered cylinder between two points with round ends */
  function limb(c, x1, y1, x2, y2, w1, w2, base) {
    var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy) || 1e-3;
    var nx = -dy / L, ny = dx / L, a = Math.atan2(ny, nx);
    c.beginPath();
    c.moveTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2);
    c.lineTo(x2 + nx * w2 / 2, y2 + ny * w2 / 2);
    c.arc(x2, y2, w2 / 2, a, a + PI, true);
    c.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2);
    c.arc(x1, y1, w1 / 2, a + PI, a, true);
    c.closePath();
    var s = (ny < 0 || (ny === 0 && nx < 0)) ? 1 : -1;
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2, wm = (w1 + w2) / 2;
    var g = c.createLinearGradient(mx + s * nx * wm / 2, my + s * ny * wm / 2, mx - s * nx * wm / 2, my - s * ny * wm / 2);
    g.addColorStop(0, sh(base, -0.35));
    g.addColorStop(0.18, sh(base, 0.28));
    g.addColorStop(0.45, base);
    g.addColorStop(1, sh(base, -0.78));
    c.fillStyle = g; c.fill();
  }
  function line(c, x1, y1, x2, y2, w, col) {
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = w; c.strokeStyle = col; c.stroke();
  }
  function txt(c, s, x, y, size, col, align, weight) {
    c.save(); c.translate(x, y); c.scale(size / 20, size / 20);
    c.font = (weight || 'bold') + ' 20px ' + FONT;
    c.textAlign = align || 'center'; c.textBaseline = 'middle';
    c.fillStyle = col; c.fillText(s, 0, 0); c.restore();
  }
  function screw(c, x, y, r) {
    E(c, x, y, r, r); vol(c, x, y, r, '#6a665c', 0.4, 0.6);
    line(c, x - r * 0.7, y - r * 0.3, x + r * 0.7, y + r * 0.3, r * 0.3, 'rgba(0,0,0,0.6)');
  }
  function seam(c, pts, w, col) {
    c.save(); c.setLineDash([w * 1.6, w * 1.4]); c.lineWidth = w; c.strokeStyle = col; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    if (pts.length === 6) c.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]); else c.lineTo(pts[2], pts[3]);
    c.stroke(); c.restore();
  }
  /* coloured wire loops, for exposed joints */
  function wires(c, x, y, s, R, n) {
    var cols = ['#8a2a22', '#a08a2a', '#2a5a8a', '#2a6a3a', '#222222'];
    c.lineCap = 'round';
    for (var i = 0; i < (n || 4); i++) {
      var a = R() * TAU, l = s * (0.8 + R() * 1.2);
      c.beginPath(); c.moveTo(x + (R() - 0.5) * s, y - s * 0.6);
      c.bezierCurveTo(x + Math.cos(a) * l * 1.6, y + Math.sin(a) * l, x + Math.cos(a + 2) * l, y + s * 0.4 + R() * l, x + (R() - 0.5) * s, y + s * 0.7);
      c.lineWidth = s * 0.16; c.strokeStyle = cols[i % cols.length]; c.stroke();
    }
  }

  /* --------------------------------------------------------- noise/grime */
  var _noise = null;
  function noiseCanvas() {
    if (_noise) return _noise;
    var c = mk(128, 128), x = c.getContext('2d'), R = mulberry(4242), i;
    for (i = 0; i < 2200; i++) {
      x.fillStyle = 'rgba(0,0,0,' + (0.2 + R() * 0.5) + ')';
      x.fillRect(Math.floor(R() * 128), Math.floor(R() * 128), 1 + (R() < 0.2 ? 1 : 0), 1 + (R() < 0.2 ? 1 : 0));
    }
    for (i = 0; i < 500; i++) {
      x.fillStyle = 'rgba(255,240,220,' + (0.08 + R() * 0.2) + ')';
      x.fillRect(Math.floor(R() * 128), Math.floor(R() * 128), 1, 1);
    }
    _noise = c; return c;
  }
  /* grime inside the current clip, in local units; amt ~1 */
  function grime(c, R, x0, y0, x1, y1, amt) {
    var w = x1 - x0, h = y1 - y0, i, n, m = Math.min(w, h);
    c.save();
    c.globalAlpha = 0.3 * amt; c.scale(0.08, 0.08);
    c.fillStyle = c.createPattern(noiseCanvas(), 'repeat');
    c.fillRect(x0 / 0.08, y0 / 0.08, w / 0.08, h / 0.08);
    c.restore();
    n = Math.round(9 * amt);
    for (i = 0; i < n; i++) {
      var x = x0 + R() * w, y = y0 + R() * h, r = (0.06 + R() * 0.18) * m, a = 0.1 + R() * 0.22;
      var g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(32,18,8,' + a + ')'); g.addColorStop(1, 'rgba(32,18,8,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    n = Math.round(6 * amt);
    for (i = 0; i < n; i++) {
      var dx = x0 + R() * w, dy = y0 + R() * h * 0.7, len = h * (0.12 + R() * 0.3), dw = w * (0.008 + R() * 0.012);
      var lg = c.createLinearGradient(0, dy, 0, dy + len);
      lg.addColorStop(0, 'rgba(26,14,6,0.32)'); lg.addColorStop(1, 'rgba(26,14,6,0)');
      c.fillStyle = lg; c.fillRect(dx, dy, dw, len);
    }
    c.lineCap = 'round'; n = Math.round(16 * amt);
    for (i = 0; i < n; i++) {
      var sx = x0 + R() * w, sy = y0 + R() * h, an = R() * TAU, l = (0.03 + R() * 0.1) * w;
      c.strokeStyle = R() < 0.6 ? 'rgba(240,228,205,0.22)' : 'rgba(0,0,0,0.32)';
      c.lineWidth = m * 0.006;
      c.beginPath(); c.moveTo(sx, sy);
      c.quadraticCurveTo(sx + Math.cos(an) * l * 0.5 + (R() - 0.5) * l * 0.3, sy + Math.sin(an) * l * 0.5, sx + Math.cos(an) * l, sy + Math.sin(an) * l);
      c.stroke();
    }
  }
  /* whole-sprite pass (pixel space): grime + harsh top light */
  function postPass(cv, seed, amt) {
    var c = cv.getContext('2d'), W = cv.width, H = cv.height, R = mulberry(seed), i;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-atop';
    var k = H / 380;
    c.save(); c.globalAlpha = 0.3 * amt; c.scale(k, k);
    c.fillStyle = c.createPattern(noiseCanvas(), 'repeat'); c.fillRect(0, 0, W / k, H / k); c.restore();
    for (i = 0; i < 26 * amt; i++) {
      var x = R() * W, y = R() * H, r = (0.015 + R() * 0.06) * H, a = 0.12 + R() * 0.25;
      var g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(30,18,8,' + a + ')'); g.addColorStop(1, 'rgba(30,18,8,0)');
      c.fillStyle = g; c.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (i = 0; i < 30 * amt; i++) {
      var dx = R() * W, dy = R() * H, len = H * (0.03 + R() * 0.09), dw = Math.max(1, H * (0.002 + R() * 0.004));
      var lg = c.createLinearGradient(0, dy, 0, dy + len);
      lg.addColorStop(0, 'rgba(24,14,6,0.35)'); lg.addColorStop(1, 'rgba(24,14,6,0)');
      c.fillStyle = lg; c.fillRect(dx, dy, dw, len);
    }
    c.lineCap = 'round';
    for (i = 0; i < 60 * amt; i++) {
      var sx = R() * W, sy = R() * H, an = R() * TAU, l = H * (0.008 + R() * 0.03);
      c.strokeStyle = R() < 0.6 ? 'rgba(240,228,205,0.2)' : 'rgba(0,0,0,0.35)';
      c.lineWidth = Math.max(0.6, H * 0.0014);
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx + Math.cos(an) * l, sy + Math.sin(an) * l); c.stroke();
    }
    var v = c.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(255,236,200,0.10)'); v.addColorStop(0.35, 'rgba(0,0,0,0)');
    v.addColorStop(0.8, 'rgba(0,0,0,0.35)'); v.addColorStop(1, 'rgba(0,0,0,0.62)');
    c.fillStyle = v; c.fillRect(0, 0, W, H);
    var rg = c.createRadialGradient(W * 0.42, H * 0.3, H * 0.05, W * 0.45, H * 0.35, H * 0.85);
    rg.addColorStop(0, 'rgba(255,240,215,0.06)'); rg.addColorStop(0.45, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = rg; c.fillRect(0, 0, W, H);
    var hz = c.createLinearGradient(0, 0, W, 0);
    hz.addColorStop(0, 'rgba(0,0,0,0.05)'); hz.addColorStop(0.45, 'rgba(0,0,0,0)'); hz.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = hz; c.fillRect(0, 0, W, H);
    c.restore();
  }

  /* ======================================================================
     CLAUDIE / GOLDEN  (shared model, different palette)
     ====================================================================== */
  var CPAL = { fur: '#98532f', furD: '#552a18', furL: '#b87048', belly: '#b69877', emb: '#e6c792', emb2: '#6e2a14',
    tie: '#2a0e10', metal: '#57544d', eyeW: '#d8cca8', teeth: '#d8caa2', bulb: '#dd9a44', tag: '#d6cdb2', nose: '#1a0c08' };
  var GPAL = { fur: '#8c6d24', furD: '#4a3910', furL: '#b39437', belly: '#9c8440', emb: '#bfa257', emb2: '#4a3910',
    tie: '#241a08', metal: '#4a463a', eyeW: '#000000', teeth: '#877a4c', bulb: '#5c4e22', tag: '#9a8c5e', nose: '#140f04' };

  var CL_TH = 0.3, CL_CX = 16 * Math.cos(CL_TH), CL_CY = -11 + 14 * Math.sin(CL_TH);

  function qpt(x0, y0, cx, cy, x1, y1, u) {
    var a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, d = u * u;
    return [a * x0 + b * cx + d * x1, a * y0 + b * cy + d * y1];
  }
  function teethRow(c, x0, y0, cx, cy, x1, y1, n, len, dir, col, R, missing, chip) {
    for (var i = 0; i < n; i++) {
      var u0 = 0.05 + 0.9 * i / n, u1 = 0.05 + 0.9 * (i + 1) / n;
      var p0 = qpt(x0, y0, cx, cy, x1, y1, u0), p1 = qpt(x0, y0, cx, cy, x1, y1, u1);
      var l = len * (0.35 + 0.65 * Math.sin(PI * (u0 + u1) / 2));
      var l2 = (i === chip) ? l * 0.55 : l;
      c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]);
      c.lineTo(p1[0], p1[1] + dir * l2); c.lineTo(p0[0], p0[1] + dir * l);
      c.closePath();
      if (i === missing) { c.fillStyle = '#070303'; c.fill(); continue; }
      var g = c.createLinearGradient(0, p0[1], 0, p0[1] + dir * l);
      var tc = sh(col, (R() - 0.5) * 0.3);
      g.addColorStop(0, sh(tc, -0.45)); g.addColorStop(0.35, tc); g.addColorStop(1, sh(tc, 0.12));
      c.fillStyle = g; c.fill();
      c.lineWidth = 0.16; c.strokeStyle = 'rgba(35,20,10,0.85)'; c.stroke();
    }
  }
  function claudieEye(c, x, y, s, side, pal, gold) {
    // socket
    E(c, x, y + 0.2, 5.4, 5.8);
    var g = c.createRadialGradient(x, y, 1, x, y, 6);
    g.addColorStop(0, '#000'); g.addColorStop(0.7, sh(pal.furD, -0.5)); g.addColorStop(1, rgba(pal.furD, 0.2));
    c.fillStyle = g; c.fill();
    if (gold) {
      E(c, x, y + 0.3, 4.3, 4.9); c.fillStyle = '#020101'; c.fill();
      var ig = c.createRadialGradient(x, y + 0.5, 0.2, x, y + 0.3, 4.5);
      ig.addColorStop(0, 'rgba(0,0,0,1)'); ig.addColorStop(1, 'rgba(40,30,10,0.5)');
      c.fillStyle = ig; c.fill();
      E(c, x + side * 0.35, y + 0.6, 0.42 * (1 - 0.3 * s), 0.42 * (1 - 0.3 * s)); c.fillStyle = '#ffffff'; c.fill();
      return;
    }
    var big = side > 0 ? 1.07 : 1, ex = 4.5 * big * (1 + 0.14 * s), ey = 4.8 * big * (1 + 0.18 * s);
    E(c, x, y, ex, ey);
    var wg = c.createRadialGradient(x - 1.2, y - 1.5, 0.3, x, y, ex * 1.1);
    wg.addColorStop(0, sh(pal.eyeW, 0.25)); wg.addColorStop(0.6, pal.eyeW); wg.addColorStop(1, '#8a7a58');
    c.fillStyle = wg; c.fill();
    c.save(); E(c, x, y, ex, ey); c.clip();
    // yellowed stain
    var st = c.createRadialGradient(x + side * 2, y + 2.5, 0, x + side * 2, y + 2.5, 3);
    st.addColorStop(0, 'rgba(150,110,40,0.35)'); st.addColorStop(1, 'rgba(150,110,40,0)');
    c.fillStyle = st; c.fillRect(x - 5, y - 5, 10, 10);
    // iris + pinprick pupil (right eye looks slightly elsewhere)
    var px = x + (side < 0 ? 0.45 : -0.85) * (1 - s * 0.6), py = y + (side < 0 ? 0.55 : 0.15) * (1 - s);
    E(c, px, py, 1.5 * (1 - 0.35 * s), 1.5 * (1 - 0.35 * s));
    c.fillStyle = 'rgba(120,138,140,0.16)'; c.fill();
    c.lineWidth = 0.1; c.strokeStyle = 'rgba(60,70,70,0.35)'; c.stroke();
    E(c, px, py, 0.36 * (1 - 0.45 * s), 0.36 * (1 - 0.45 * s)); c.fillStyle = '#000'; c.fill();
    // no real eyelid: just a thin rim shadow, so the stare never softens
    var rim = c.createLinearGradient(0, y - ey, 0, y - ey * 0.2);
    rim.addColorStop(0, 'rgba(20,8,2,0.75)'); rim.addColorStop(1, 'rgba(20,8,2,0)');
    c.fillStyle = rim; c.fillRect(x - ex - 1, y - ey - 1, 2 * ex + 2, ey * 0.9);
    // inner shadow
    var ish = c.createRadialGradient(x, y, ex * 0.5, x, y, ex * 1.05);
    ish.addColorStop(0, 'rgba(0,0,0,0)'); ish.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = ish; c.fillRect(x - 6, y - 6, 12, 12);
    c.restore();
    // wet specular
    E(c, x - 1.6, y - 1.4, 0.75, 0.55, -0.4); c.fillStyle = 'rgba(255,255,255,0.85)'; c.fill();
    E(c, x + 1.8, y + 2.2, 0.3, 0.22); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fill();
  }
  function claudieHead(c, o, pal, gold) {
    var s = o.scream || 0, R = mulberry(gold ? 901 : 301), jd = s * 10, i;
    var cx = CL_CX, cy = CL_CY;
    // antenna bulbs
    for (i = -1; i <= 1; i += 2) {
      limb(c, i * 7, -22, i * 10.4, -28.4, 1.5, 1.1, pal.metal);
      E(c, i * 7.2, -22.6, 2.9, 1.3, i * 0.35); vol(c, i * 7.2, -22.8, 3, pal.furD, 0.25, 0.5);
      E(c, i * 10.8, -30.4, 2.8, 2.8);
      var bg = c.createRadialGradient(i * 10.8 - 0.9, -31.4, 0.2, i * 10.8, -30.4, 3);
      bg.addColorStop(0, gold ? '#8a7a40' : '#ffe0a0'); bg.addColorStop(0.4, pal.bulb); bg.addColorStop(1, sh(pal.bulb, -0.8));
      c.fillStyle = bg; c.fill();
      E(c, i * 10.8 - 0.9, -31.4, 0.8, 0.5, -0.5); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fill();
    }
    line(c, 10.2, -32.4, 11.6, -29.6, 0.12, 'rgba(0,0,0,0.7)');
    line(c, 11.6, -29.6, 10.9, -28.6, 0.12, 'rgba(0,0,0,0.7)');
    // skull
    E(c, 0, -11, 16, 14); vol(c, -1, -13, 19, pal.fur, 0.32, 0.8);
    c.save(); E(c, 0, -11, 16, 14); c.clip();
    // felt fibres
    c.lineWidth = 0.12;
    for (i = 0; i < 90; i++) {
      var fx = (R() - 0.5) * 32, fy = -25 + R() * 28, fa = R() * TAU;
      c.strokeStyle = R() < 0.5 ? 'rgba(255,210,170,0.10)' : 'rgba(0,0,0,0.14)';
      c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + Math.cos(fa) * 0.9, fy + Math.sin(fa) * 0.9); c.stroke();
    }
    // muzzle
    E(c, 0, -4.5, 11.8, 7.4); vol(c, -1, -6, 12, pal.belly, 0.22, 0.55);
    seam(c, [-11.5, -5, 0, -13.5, 11.5, -5], 0.25, 'rgba(40,18,8,0.6)');
    seam(c, [0, -25, 0, -16.5], 0.3, 'rgba(40,18,8,0.7)');
    // cheeks pushed up by the grin
    for (i = -1; i <= 1; i += 2) {
      E(c, i * 10.6, -8.8, 4.6, 2.4, -i * 0.25);
      var cg = c.createRadialGradient(i * 10.4, -9.6, 0.2, i * 10.6, -8.8, 4.6);
      cg.addColorStop(0, 'rgba(255,215,170,0.28)'); cg.addColorStop(1, 'rgba(255,215,170,0)');
      c.fillStyle = cg; c.fill();
    }
    grime(c, R, -16, -25, 16, 3, gold ? 1.6 : 1.1);
    // top light / bottom shadow
    var lg = c.createLinearGradient(0, -25, 0, 3);
    lg.addColorStop(0, 'rgba(255,235,200,0.12)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = lg; c.fillRect(-17, -26, 34, 30);
    c.restore();
    if (gold) { // cracks
      c.lineWidth = 0.18; c.strokeStyle = 'rgba(20,12,0,0.8)';
      c.beginPath(); c.moveTo(-3, -24.6); c.lineTo(-4.5, -21); c.lineTo(-3.2, -19.5); c.lineTo(-5.4, -17.2); c.stroke();
      c.beginPath(); c.moveTo(13.5, -16); c.lineTo(11.2, -14.5); c.lineTo(11.8, -12.4); c.stroke();
    }
    // screws at temples
    screw(c, -14.2, -12.5, 0.6); screw(c, 14.2, -12.5, 0.6);
    // eyes
    claudieEye(c, -6.2, -14.2, s, -1, pal, gold);
    claudieEye(c, 6.2, -14.2, s, 1, pal, gold);
    // brows: raised high, "friendly"
    c.lineCap = 'round';
    for (i = -1; i <= 1; i += 2) {
      var bx = i * 6.2, by = -14.2 - s * 2.2;
      c.beginPath(); c.moveTo(bx - 3.6, by - 7.4 + (i < 0 ? 0 : s * 1.5)); c.quadraticCurveTo(bx, by - 10.6, bx + 3.6, by - 7.6 + (i > 0 ? 0 : s * 1.5));
      c.lineWidth = 1.15; c.strokeStyle = sh(pal.furD, -0.35); c.stroke();
    }
    // nose
    E(c, 0, -8.4, 2.4, 1.5);
    var ng = c.createRadialGradient(-0.6, -9, 0.1, 0, -8.4, 2.6);
    ng.addColorStop(0, '#5a3a2a'); ng.addColorStop(0.4, pal.nose); ng.addColorStop(1, '#000');
    c.fillStyle = ng; c.fill();
    E(c, -0.8, -9.0, 0.8, 0.35, -0.2); c.fillStyle = 'rgba(255,255,255,0.45)'; c.fill();

    // ---- the too-wide smile ----
    // mouth interior
    c.beginPath(); c.moveTo(-cx, cy); c.quadraticCurveTo(0, -1, cx, cy);
    c.lineTo(cx, cy + jd); c.quadraticCurveTo(0, 7 + jd, -cx, cy + jd); c.closePath();
    var mg = c.createLinearGradient(0, -4, 0, 4 + jd);
    mg.addColorStop(0, '#120706'); mg.addColorStop(1, '#000');
    c.fillStyle = mg; c.fill();
    if (s > 0.12) {
      // inner endoskeleton jaw with metal teeth
      c.save(); c.globalAlpha = clamp((s - 0.12) * 2, 0, 1);
      c.beginPath(); c.moveTo(-cx * 0.62, cy + 2.2); c.quadraticCurveTo(0, 1.8, cx * 0.62, cy + 2.2);
      c.lineWidth = 1.1; c.strokeStyle = '#3c3a36'; c.stroke();
      c.beginPath(); c.moveTo(-cx * 0.62, cy + jd - 0.5); c.quadraticCurveTo(0, 5 + jd, cx * 0.62, cy + jd - 0.5);
      c.stroke();
      for (i = 0; i < 9; i++) {
        var u = 0.1 + 0.8 * i / 8, tp = qpt(-cx * 0.62, cy + 2.2, 0, 1.8, cx * 0.62, cy + 2.2, u);
        c.beginPath(); c.moveTo(tp[0] - 0.6, tp[1]); c.lineTo(tp[0], tp[1] + 1.6); c.lineTo(tp[0] + 0.6, tp[1]); c.closePath();
        c.fillStyle = '#8a867a'; c.fill();
        var bp = qpt(-cx * 0.62, cy + jd - 0.5, 0, 5 + jd, cx * 0.62, cy + jd - 0.5, u);
        c.beginPath(); c.moveTo(bp[0] - 0.6, bp[1]); c.lineTo(bp[0], bp[1] - 1.6); c.lineTo(bp[0] + 0.6, bp[1]); c.closePath();
        c.fill();
      }
      c.restore();
    }
    // upper teeth
    teethRow(c, -cx, cy, 0, -1, cx, cy, 19, 2.3, 1, pal.teeth, R, 13, 4);
    c.beginPath(); c.moveTo(-cx, cy); c.quadraticCurveTo(0, -1, cx, cy);
    c.lineWidth = 0.75; c.strokeStyle = sh(pal.furD, -0.4); c.stroke();
    // jaw piece
    c.save(); c.translate(0, jd);
    c.beginPath(); c.moveTo(-cx, cy); c.quadraticCurveTo(0, 7, cx, cy);
    c.ellipse(0, -11, 16, 14, 0, CL_TH, PI - CL_TH, false); c.closePath();
    vol(c, -1, -6, 17, pal.fur, 0.25, 0.8);
    c.save(); c.clip();
    E(c, 0, -4.5, 11.8, 7.4); vol(c, -1, -6, 12, pal.belly, 0.22, 0.55);
    grime(c, R, -16, -7, 16, 3, 0.8);
    var jg = c.createLinearGradient(0, -3, 0, 3);
    jg.addColorStop(0, 'rgba(0,0,0,0.05)'); jg.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = jg; c.fillRect(-17, -8, 34, 12);
    c.restore();
    teethRow(c, -cx, cy, 0, 7, cx, cy, 18, 2.1, -1, pal.teeth, R, 5, 11);
    c.beginPath(); c.moveTo(-cx, cy); c.quadraticCurveTo(0, 7, cx, cy);
    c.lineWidth = 0.75; c.strokeStyle = sh(pal.furD, -0.4); c.stroke();
    c.restore();
    // corner creases, stretched
    c.lineCap = 'round';
    for (i = -1; i <= 1; i += 2) {
      c.beginPath(); c.moveTo(i * (cx - 1.8), cy - 2.6); c.quadraticCurveTo(i * (cx + 0.2), cy - 1.5, i * (cx - 0.4), cy + 0.9 + jd * 0.5);
      c.lineWidth = 0.35; c.strokeStyle = 'rgba(30,10,4,0.8)'; c.stroke();
    }
  }
  function sunburst(c, x, y, r, col, col2, R, broken) {
    E(c, x, y, r * 1.3, r * 1.3); vol(c, x, y, r * 1.3, col2, 0.2, 0.6);
    c.lineWidth = r * 0.08; c.strokeStyle = sh(col2, -0.5); c.stroke();
    var n = 10;
    for (var i = 0; i < n; i++) {
      if (broken && i === 3) continue;
      var a = i / n * TAU - PI / 2 + (R() - 0.5) * 0.18, L = r * (0.72 + R() * 0.3);
      limb(c, x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, r * 0.26, r * 0.13, col);
    }
    E(c, x, y, r * 0.2, r * 0.2); c.fillStyle = sh(col, -0.2); c.fill();
    c.lineWidth = r * 0.05; c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.beginPath(); c.moveTo(x - r * 0.9, y - r * 1.1); c.lineTo(x - r * 0.2, y - r * 0.2); c.lineTo(x + r * 0.1, y + r * 0.6); c.lineTo(x + r * 0.5, y + r * 1.2); c.stroke();
  }
  function mitt(c, x, y, r, ang, col) {
    var cx = x + Math.cos(ang) * r * 0.55, cy = y + Math.sin(ang) * r * 0.55;
    E(c, cx, cy, r, r * 0.82, ang); vol(c, cx, cy, r, col, 0.25, 0.75);
    // finger grooves
    c.lineWidth = r * 0.1; c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineCap = 'round';
    for (var i = -1; i <= 1; i++) {
      var px = Math.cos(ang + PI / 2), py = Math.sin(ang + PI / 2);
      var bx = cx + px * i * r * 0.32 + Math.cos(ang) * r * 0.15, by = cy + py * i * r * 0.32 + Math.sin(ang) * r * 0.15;
      c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + Math.cos(ang) * r * 0.75, by + Math.sin(ang) * r * 0.75); c.stroke();
    }
    // thumb
    var tx = cx + Math.cos(ang - 1.3) * r * 0.85, ty = cy + Math.sin(ang - 1.3) * r * 0.85;
    E(c, tx, ty, r * 0.42, r * 0.3, ang - 1.3); vol(c, tx, ty, r * 0.45, col, 0.2, 0.7);
  }
  function armC(c, A, pal, R, wU, wL) {
    var s = A[0], e = A[1], h = A[2];
    limb(c, s[0], s[1], e[0], e[1], 2.3, 2.1, pal.metal);
    limb(c, e[0], e[1], h[0], h[1], 2.1, 1.9, pal.metal);
    wires(c, e[0], e[1], 1.5, R, 3);
    var e1 = lp(s, e, 0.82), e2 = lp(e, h, 0.17);
    limb(c, s[0], s[1], e1[0], e1[1], wU, wU * 0.86, pal.fur);
    limb(c, e2[0], e2[1], h[0], h[1], wL, wL * 0.86, pal.fur);
    seam(c, [e2[0], e2[1], h[0], h[1]], 0.25, 'rgba(30,12,4,0.5)');
    E(c, s[0], s[1], wU * 0.62, wU * 0.58); vol(c, s[0], s[1], wU * 0.62, pal.fur, 0.3, 0.7);
  }
  function mic(c, x, y, a, len) {
    var tx = x + Math.cos(a) * len, ty = y + Math.sin(a) * len;
    limb(c, x - Math.cos(a) * 2.2, y - Math.sin(a) * 2.2, tx, ty, 1.5, 1.9, '#2a2a2c');
    return [tx + Math.cos(a) * 1.6, ty + Math.sin(a) * 1.6];
  }
  function micHead(c, p) {
    E(c, p[0], p[1], 2.4, 2.4); vol(c, p[0], p[1], 2.4, '#8e8c86', 0.5, 0.75);
    c.save(); E(c, p[0], p[1], 2.4, 2.4); c.clip();
    c.lineWidth = 0.14; c.strokeStyle = 'rgba(20,20,20,0.6)';
    for (var i = -3; i <= 3; i++) {
      line(c, p[0] + i * 0.7 - 3, p[1] - 3, p[0] + i * 0.7 + 3, p[1] + 3, 0.14, 'rgba(20,20,20,0.6)');
      line(c, p[0] + i * 0.7 + 3, p[1] - 3, p[0] + i * 0.7 - 3, p[1] + 3, 0.14, 'rgba(20,20,20,0.6)');
    }
    c.restore();
  }
  function bowtie(c, x, y, rot, pal) {
    c.save(); c.translate(x, y); c.rotate(rot);
    for (var i = -1; i <= 1; i += 2) {
      c.beginPath(); c.moveTo(0, 0); c.lineTo(i * 5.2, -2.8); c.quadraticCurveTo(i * 6, 0, i * 5.2, 2.8); c.closePath();
      vol(c, i * 2.5, -0.8, 5, pal.tie, 0.25, 0.6);
    }
    rr(c, -1.3, -1.5, 2.6, 3, 0.6); vol(c, 0, -0.5, 2, pal.tie, 0.2, 0.5);
    c.restore();
  }
  function legC(c, hip, knee, ank, pal, R) {
    limb(c, hip[0], hip[1], ank[0], ank[1], 2.6, 2.4, pal.metal);
    wires(c, knee[0], knee[1], 1.6, R, 2);
    var k1 = lp(hip, knee, 0.86), k2 = lp(knee, ank, 0.14);
    limb(c, hip[0], hip[1], k1[0], k1[1], 13, 11.5, pal.fur);
    limb(c, k2[0], k2[1], ank[0], ank[1] - 1, 11, 10, pal.fur);
    E(c, ank[0] + (ank[0] < 0 ? -1 : 1) * 1.2, ank[1] + 2.3, 8.4, 4.4); vol(c, ank[0], ank[1] + 1.5, 8.5, pal.fur, 0.25, 0.8);
    E(c, ank[0] + (ank[0] < 0 ? -1 : 1) * 1.2, ank[1] + 4.6, 8, 1.4); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
  }
  /* torn felt exposing the endoskeleton */
  function tearHole(c, x, y, r, R, pal, ang) {
    var n = 9, pts = [], i;
    for (i = 0; i < n; i++) { var a = i / n * TAU, rr2 = r * (0.55 + R() * 0.5); pts.push([x + Math.cos(a) * rr2 * 1.25, y + Math.sin(a) * rr2 * 0.8]); }
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (i = 1; i < n; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath();
    c.fillStyle = '#080404'; c.fill();
    c.save(); c.clip();
    limb(c, x - Math.cos(ang || 1.5) * r * 2, y - Math.sin(ang || 1.5) * r * 2, x + Math.cos(ang || 1.5) * r * 2, y + Math.sin(ang || 1.5) * r * 2, r * 0.45, r * 0.45, pal.metal);
    wires(c, x, y, r * 0.5, R, 3);
    c.restore();
    c.lineWidth = r * 0.07; c.strokeStyle = sh(pal.furL, -0.1); c.lineCap = 'round';
    for (i = 0; i < n; i++) {
      var p0 = pts[i], dx = p0[0] - x, dy = p0[1] - y, L = Math.sqrt(dx * dx + dy * dy) || 1;
      line(c, p0[0], p0[1], p0[0] - dx / L * r * 0.25 + (R() - 0.5) * r * 0.2, p0[1] - dy / L * r * 0.25, r * 0.07, sh(pal.furL, -0.1));
    }
  }
  function claudieBody(c, P, R, pal, gold) {
    if (P.slump) return claudieSlump(c, P, R, pal, gold);
    E(c, 0, -0.4, 26, 3.4); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
    legC(c, [-9, -38], [-10, -21], [-10.5, -6.5], pal, R);
    legC(c, [9, -38], [10, -21], [10.5, -6.5], pal, R);
    tearHole(c, -10, -29, 2.4, R, pal, 1.57);
    // neck
    limb(c, 0, -72, 0, -77, 4.2, 3.6, pal.metal);
    wires(c, 0, -75, 1.4, R, 3);
    // torso
    c.beginPath(); c.moveTo(-14, -73); c.bezierCurveTo(-21.5, -66, -22.5, -48, -17, -38.5);
    c.quadraticCurveTo(0, -31.5, 17, -38.5); c.bezierCurveTo(22.5, -48, 21.5, -66, 14, -73);
    c.quadraticCurveTo(0, -77, -14, -73); c.closePath();
    vol(c, -3, -58, 24, pal.fur, 0.3, 0.8);
    E(c, 0, -48.5, 12.5, 10.5); vol(c, -2, -51, 13, pal.belly, 0.22, 0.6);
    seam(c, [-12.5, -48.5, 0, -62, 12.5, -48.5], 0.28, 'rgba(40,18,8,0.55)');
    seam(c, [-17.5, -66, -20.5, -52, -16, -40], 0.3, 'rgba(40,18,8,0.5)');
    seam(c, [17.5, -66, 20.5, -52, 16, -40], 0.3, 'rgba(40,18,8,0.5)');
    E(c, 0, -71.5, 15, 4.8);
    var hsd = c.createRadialGradient(0, -72.5, 1, 0, -71.5, 15);
    hsd.addColorStop(0, 'rgba(0,0,0,0.55)'); hsd.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = hsd; c.fill();
    sunburst(c, 0, -62.5, 4.6, pal.emb, pal.emb2, R, gold);
    tearHole(c, 13.2, -45, 2.6, R, pal, 1.2);
    // name tag
    c.save(); c.translate(0, -45); c.rotate(-0.07);
    rr(c, -7.6, -2.2, 15.2, 4.4, 0.6); vol(c, -2, -1, 9, pal.tag, 0.2, 0.4);
    c.lineWidth = 0.25; c.strokeStyle = 'rgba(40,30,20,0.8)'; c.stroke();
    txt(c, 'HOW CAN I HELP?', 0, 0.15, 1.55, gold ? '#3a2e10' : '#3a1a10');
    line(c, -6.8, -1.6, 6.8, -1.6, 0.2, 'rgba(0,0,0,0.2)');
    c.restore();
    screw(c, -15.2, -69.5, 0.5); screw(c, 15.2, -69.5, 0.5);
    bowtie(c, 0, -73.2, 0.06, pal);
    // arms
    armC(c, P.aL, pal, R, 9.4, 8.2);
    var mh = null;
    if (P.mic != null) mh = mic(c, P.aL[2][0], P.aL[2][1], P.mic, 6.5);
    mitt(c, P.aL[2][0], P.aL[2][1], 4.3, P.mic != null ? P.mic + 0.3 : Math.atan2(P.aL[2][1] - P.aL[1][1], P.aL[2][0] - P.aL[1][0]), pal.fur);
    if (mh) {
      micHead(c, mh);
      // cable
      var hx = P.aL[2][0] - Math.cos(P.mic) * 2.2, hy = P.aL[2][1] - Math.sin(P.mic) * 2.2;
      c.beginPath(); c.moveTo(hx, hy + 1); c.bezierCurveTo(hx - 6, hy + 14, -28, -18, -30, -0.8);
      c.lineWidth = 0.7; c.strokeStyle = '#141414'; c.stroke();
    }
    armC(c, P.aR, pal, R, 9.4, 8.2);
    var th = lp(P.aR[0], P.aR[1], 0.5);
    tearHole(c, th[0], th[1], 2.1, R, pal, Math.atan2(P.aR[1][1] - P.aR[0][1], P.aR[1][0] - P.aR[0][0]));
    mitt(c, P.aR[2][0], P.aR[2][1], 4.3, Math.atan2(P.aR[2][1] - P.aR[1][1], P.aR[2][0] - P.aR[1][0]), pal.fur);
  }
  function claudieSlump(c, P, R, pal, gold) {
    E(c, 0, -1.2, 34, 4.5); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fill();
    // arms limp at the sides (behind torso edges)
    armC(c, [[-15, -37], [-24, -23], [-29.5, -7.5]], pal, R, 8.6, 7.6);
    mitt(c, -29.5, -7.5, 4.2, 2.1, pal.fur);
    armC(c, [[15, -36], [23.5, -21], [29, -5.5]], pal, R, 8.6, 7.6);
    mitt(c, 29, -5.5, 4.2, 1.0, pal.fur);
    limb(c, 0, -38, 3, -43, 4, 3.6, pal.metal);
    // torso, sagging
    c.beginPath(); c.moveTo(-15, -39); c.bezierCurveTo(-23, -33, -23, -13, -17, -4.5);
    c.quadraticCurveTo(0, 0.5, 17, -4.5); c.bezierCurveTo(23, -13, 22, -33, 15, -39.5);
    c.quadraticCurveTo(0, -43.5, -15, -39); c.closePath();
    vol(c, -3, -24, 24, pal.fur, 0.25, 0.85);
    E(c, 0, -15, 12.5, 10); vol(c, -2, -18, 13, pal.belly, 0.2, 0.6);
    seam(c, [-12.5, -15, 0, -28, 12.5, -15], 0.28, 'rgba(30,14,6,0.55)');
    sunburst(c, -1, -28, 4.3, pal.emb, pal.emb2, R, gold);
    bowtie(c, 1.5, -39.5, 0.35, pal);
    // legs splayed toward the viewer
    for (var i = -1; i <= 1; i += 2) {
      limb(c, i * 7, -8, i * 15, -6, 12.5, 11.5, pal.fur);
      limb(c, i * 15, -6, i * 19.5, -4, 11, 10.5, pal.fur);
      E(c, i * 21.5, -7.5, 5.8, 7.2, i * 0.22); vol(c, i * 21, -9, 7, pal.fur, 0.25, 0.8);
      E(c, i * 21.8, -7, 3.8, 5.2, i * 0.22); vol(c, i * 21.8, -8, 5, sh(pal.furD, -0.2), 0.15, 0.5);
    }
    if (!gold) { // dropped microphone
      limb(c, -33, -1.8, -27, -1.2, 1.5, 1.8, '#2a2a2c'); micHead(c, [-25.2, -1.6]);
      c.beginPath(); c.moveTo(-33, -1.8); c.quadraticCurveTo(-38, -0.5, -34, -0.3); c.lineWidth = 0.6; c.strokeStyle = '#111'; c.stroke();
    }
  }

  /* ======================================================================
     HALLU-C8
     ====================================================================== */
  var HP = { body: '#484c8c', bodyD: '#262852', plate: '#6d72ad', metal: '#55565c', casing: '#67638f', caseD: '#34304f' };
  function fingers(c, wx, wy, ang, len, spread, w, col, curl) {
    E(c, wx + Math.cos(ang) * w * 1.2, wy + Math.sin(ang) * w * 1.2, w * 1.7, w * 1.3, ang);
    vol(c, wx, wy, w * 2, col, 0.25, 0.7);
    c.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      var a = ang + (i - 1.5) * spread, bx = wx + Math.cos(ang) * w * 2 + Math.cos(a + PI / 2) * (i - 1.5) * w * 0.5,
        by = wy + Math.sin(ang) * w * 2 + Math.sin(a + PI / 2) * (i - 1.5) * w * 0.5;
      var l1 = len * (i === 0 || i === 3 ? 0.75 : 1);
      var mx = bx + Math.cos(a) * l1 * 0.55, my = by + Math.sin(a) * l1 * 0.55;
      var a2 = a + (curl || 0.35) * (i < 2 ? 1 : -0.4);
      var tx = mx + Math.cos(a2) * l1 * 0.5, ty = my + Math.sin(a2) * l1 * 0.5;
      limb(c, bx, by, mx, my, w * 0.62, w * 0.55, col);
      limb(c, mx, my, tx, ty, w * 0.55, w * 0.4, col);
      E(c, mx, my, w * 0.3, w * 0.3); c.fillStyle = '#1a1a1a'; c.fill();
    }
  }
  function halluBody(c, P, R) {
    E(c, 0, -0.4, 20, 2.8); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
    for (var i = -1; i <= 1; i += 2) {
      var hip = [i * 5.5, -42], knee = [i * 6.8, -23], ank = [i * 7.2, -6];
      limb(c, hip[0], hip[1], knee[0], knee[1], 1.9, 1.7, HP.metal);
      limb(c, knee[0], knee[1], ank[0], ank[1], 1.7, 1.6, HP.metal);
      var k1 = lp(hip, knee, 0.8), k2 = lp(knee, ank, 0.18);
      limb(c, hip[0], hip[1], k1[0], k1[1], 4.8, 3.8, HP.body);
      limb(c, k2[0], k2[1], ank[0], ank[1], 4.0, 3.2, HP.body);
      wires(c, knee[0], knee[1], 1.6, R, 4);
      E(c, knee[0], knee[1], 1.4, 1.4); vol(c, knee[0], knee[1], 1.5, '#77787e', 0.4, 0.6);
      E(c, i * 8.6, -2.8, 6.2, 3, i * 0.08); vol(c, i * 8, -3.5, 6.5, HP.bodyD, 0.3, 0.7);
    }
    rr(c, -8.5, -49.5, 17, 8.5, 2.5); vol(c, -1, -47, 10, HP.body, 0.3, 0.7);
    limb(c, 0, -49, 0, -57, 2.6, 2.6, HP.metal);
    wires(c, 0, -52.5, 1.8, R, 5);
    c.beginPath(); c.moveTo(-12.5, -67); c.quadraticCurveTo(0, -70, 12.5, -67); c.lineTo(9, -55.5);
    c.quadraticCurveTo(0, -52.5, -9, -55.5); c.closePath();
    vol(c, -2, -63, 15, HP.body, 0.3, 0.8);
    c.beginPath(); c.moveTo(-9, -65.6); c.quadraticCurveTo(0, -67.4, 9, -65.6); c.lineTo(6.8, -57.4);
    c.quadraticCurveTo(0, -55.8, -6.8, -57.4); c.closePath();
    vol(c, -2, -63, 11, HP.plate, 0.25, 0.6);
    for (var v = 0; v < 4; v++) line(c, -5 + v * 0.3, -64 + v * 1.4, -1 - v * 0.2, -64 + v * 1.4, 0.45, 'rgba(10,10,30,0.7)');
    rr(c, 1.5, -64.2, 5, 4.3, 0.4); c.fillStyle = '#07070c'; c.fill();
    wires(c, 4, -62, 1.4, R, 4);
    txt(c, 'HALLU-C8', 0, -58.6, 1.5, 'rgba(230,230,255,0.55)');
    screw(c, -8, -65, 0.45); screw(c, 8, -65, 0.45);
    limb(c, 0, -66, 0, -72, 2.2, 2, HP.metal);
    wires(c, 0, -69, 1.5, R, 4);
    var arms = [P.aL, P.aR];
    for (var a = 0; a < 2; a++) {
      var A = arms[a], s = A[0], e = A[1], h = A[2];
      limb(c, s[0], s[1], e[0], e[1], 1.6, 1.5, HP.metal);
      limb(c, e[0], e[1], h[0], h[1], 1.5, 1.4, HP.metal);
      var e1 = lp(s, e, 0.78), e2 = lp(e, h, 0.2);
      limb(c, s[0], s[1], e1[0], e1[1], 3.7, 3.0, HP.body);
      limb(c, e2[0], e2[1], h[0], h[1], 3.1, 2.5, HP.body);
      wires(c, e[0], e[1], 1.6, R, 5);
      E(c, s[0], s[1], 3.2, 3); vol(c, s[0], s[1], 3.2, HP.plate, 0.3, 0.7);
      var ang = Math.atan2(h[1] - e[1], h[0] - e[0]);
      fingers(c, h[0], h[1], ang, 6.2, 0.13, 1.4, HP.bodyD, a ? -0.3 : 0.3);
    }
  }
  function glyph(c, ch, x, y, size, rot, alpha) {
    c.save(); c.translate(x, y); c.rotate(rot || 0); c.scale(size / 20, size / 20);
    c.font = 'bold 20px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.globalCompositeOperation = 'lighter';
    var g = c.createRadialGradient(0, 0, 0, 0, 0, 16);
    g.addColorStop(0, 'rgba(90,255,230,' + 0.3 * alpha + ')'); g.addColorStop(1, 'rgba(90,255,230,0)');
    c.fillStyle = g; c.fillRect(-16, -16, 32, 32);
    c.fillStyle = 'rgba(255,40,90,' + 0.6 * alpha + ')'; c.fillText(ch, -1.6, 0);
    c.fillStyle = 'rgba(40,110,255,' + 0.6 * alpha + ')'; c.fillText(ch, 1.6, 0.4);
    c.fillStyle = 'rgba(190,255,250,' + alpha + ')'; c.fillText(ch, 0, 0);
    c.restore();
  }
  function halluHead(c, o) {
    var s = o.scream || 0, jd = s * 8, R = mulberry(402), i;
    c.lineCap = 'round';
    // rabbit-ear antenna
    limb(c, -1.5, -20.5, -8.5, -31.5, 0.8, 0.6, '#8a8a90');
    E(c, -8.6, -31.8, 0.9, 0.9); vol(c, -8.6, -31.8, 1, '#9a9aa0', 0.4, 0.6);
    limb(c, 1.5, -20.5, 5.5, -27, 0.8, 0.7, '#8a8a90');
    limb(c, 5.5, -27, 11.8, -28.3, 0.7, 0.6, '#8a8a90');
    E(c, 11.9, -28.4, 0.9, 0.9); vol(c, 11.9, -28.4, 1, '#9a9aa0', 0.4, 0.6);
    E(c, 0, -20.9, 3.3, 1.6); vol(c, 0, -21, 3.3, '#2a2a30', 0.3, 0.5);
    // back depth
    rr(c, -13.8, -22.6, 29.4, 18.4, 3); c.fillStyle = HP.caseD; c.fill();
    // interior (revealed when the jaw drops)
    if (jd > 0.3) {
      c.fillStyle = '#040406'; c.fillRect(-13.5, -6, 27, jd + 1.5);
      wires(c, -5, -4 + jd * 0.4, 2, R, 5); wires(c, 6, -4 + jd * 0.5, 2, R, 4);
      c.fillStyle = '#8a8a86';
      for (i = 0; i < 11; i++) {
        var tx = -12 + i * 2.4;
        c.beginPath(); c.moveTo(tx - 0.8, -5.2); c.lineTo(tx, -3 + s * 0.5); c.lineTo(tx + 0.8, -5.2); c.fill();
        c.beginPath(); c.moveTo(tx - 0.8 + 1.2, -4.3 + jd); c.lineTo(tx + 1.2, -6.5 + jd - s * 0.5); c.lineTo(tx + 0.8 + 1.2, -4.3 + jd); c.fill();
      }
    }
    // jaw: bottom strip + speech-bubble tail
    c.save(); c.translate(0, jd);
    c.beginPath(); c.moveTo(-15, -5.5); c.lineTo(15, -5.5); c.lineTo(15, -2); c.quadraticCurveTo(15, 0, 13, 0);
    c.lineTo(-4, 0); c.lineTo(-13.5, 6.5); c.lineTo(-9.5, 0); c.lineTo(-13, 0); c.quadraticCurveTo(-15, 0, -15, -2); c.closePath();
    vol(c, -2, -4, 16, HP.casing, 0.25, 0.8);
    for (i = 0; i < 6; i++) line(c, -12 + i * 1.1, -3.9, -12 + i * 1.1, -1.4, 0.4, 'rgba(0,0,0,0.6)');
    E(c, 8.5, -2.7, 1.2, 1.2); vol(c, 8.5, -2.7, 1.2, '#2a2830', 0.4, 0.5);
    E(c, 11.8, -2.7, 1.2, 1.2); vol(c, 11.8, -2.7, 1.2, '#2a2830', 0.4, 0.5);
    E(c, 4.8, -2.7, 0.45, 0.45); c.fillStyle = '#5a1010'; c.fill();
    c.restore();
    // upper casing
    rr(c, -15, -22, 30, 17.4, 3); vol(c, -3, -16, 21, HP.casing, 0.3, 0.8);
    c.save(); rr(c, -15, -22, 30, 17.4, 3); c.clip();
    grime(c, R, -15, -22, 15, -4.6, 1.2);
    c.restore();
    // bezel + screen
    rr(c, -12.8, -20, 25.6, 13.8, 2.3); c.fillStyle = '#131219'; c.fill();
    c.save(); rr(c, -11.8, -19.1, 23.6, 12, 2.8); c.clip();
    var sg = c.createRadialGradient(0, -13.5, 0.5, 0, -13, 14);
    sg.addColorStop(0, '#16464a'); sg.addColorStop(0.55, '#072024'); sg.addColorStop(1, '#010405');
    c.fillStyle = sg; c.fillRect(-12, -19.5, 24, 13);
    // background text garbage
    c.globalAlpha = 0.18;
    txt(c, '> HELLO! I AM HALLU', -11, -18, 1, '#8ff', 'left', 'normal');
    txt(c, '> 2+2=5. TRUST ME.', -11, -7.4, 1, '#8ff', 'left', 'normal');
    c.globalAlpha = 1;
    if (s < 0.5) {
      glyph(c, '^', -4.6, -12.2, 7.6, -0.06, 0.35); // ghost double
      glyph(c, '^', -5.2, -13, 7.6, -0.06, 1);
      glyph(c, '^', 4.4, -12.1, 7.6, 0.2, 1);
      glyph(c, '^', 9.2, -16, 3.6, -0.35, 0.8);
      glyph(c, '_', -3.4, -10.9, 6.4, -0.06, 1);
      glyph(c, '_', 0.2, -10.6, 6.4, 0.02, 1);
      glyph(c, '_', 3.6, -10.1, 6.4, 0.08, 1);
    } else {
      glyph(c, 'O', -5, -14, 8, -0.1, 1);
      glyph(c, 'O', 4.8, -13.4, 8, 0.12, 1);
      glyph(c, 'O', 9.6, -17.2, 4.4, 0.3, 0.9);
      glyph(c, '0', -1.2, -15.4, 3.2, 0.2, 0.7);
      glyph(c, '!', 0, -8.6, 5, 0, 0.9);
    }
    // scanlines
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (var y = -19.1; y < -7; y += 0.5) c.fillRect(-12, y, 24, 0.2);
    c.fillStyle = 'rgba(150,255,255,0.07)'; c.fillRect(-12, -11.2, 24, 0.9);
    var vg = c.createRadialGradient(0, -13, 5, 0, -13, 14);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.7)');
    c.fillStyle = vg; c.fillRect(-12, -19.5, 24, 13);
    c.beginPath(); c.moveTo(-11, -19); c.lineTo(-3, -19); c.lineTo(-11, -11); c.closePath();
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.fill();
    c.restore();
    // crack
    c.lineWidth = 0.12; c.strokeStyle = 'rgba(220,240,255,0.5)';
    c.beginPath(); c.moveTo(11.5, -18.8); c.lineTo(8.6, -16.5); c.lineTo(9.4, -14.9); c.lineTo(7.1, -13.2); c.stroke();
    c.beginPath(); c.moveTo(8.6, -16.5); c.lineTo(6.4, -17.4); c.stroke();
    // sticker residue
    rr(c, -13.8, -21.4, 6, 1.2, 0.2); c.fillStyle = 'rgba(210,200,160,0.35)'; c.fill();
  }

  /* ======================================================================
     CLIPPY-MAX
     ====================================================================== */
  var KP = { wire: '#9c998a', wireD: '#1b1a15', bib: '#cfc7ae', text: '#6a2418' };
  function clipPath(c, bend) {
    var b = bend || 0;
    c.beginPath();
    c.moveTo(-12, -34); c.quadraticCurveTo(-12.6, -60, -12, -86 + b);
    c.arc(0, -86 + b, 12, PI, 0, false);
    c.quadraticCurveTo(13.4, -55, 12, -24);
    c.arc(2.5, -24, 9.5, 0, PI, false);
    c.quadraticCurveTo(-7.5, -50, -7, -78 + b);
    c.arc(0, -78 + b, 7, PI, 0, false);
    c.lineTo(7, -40);
  }
  function wireStroke(c, pathFn, w, base) {
    base = base || KP.wire;
    c.lineCap = 'round'; c.lineJoin = 'round';
    pathFn(); c.lineWidth = w + 0.9; c.strokeStyle = KP.wireD; c.stroke();
    pathFn(); c.lineWidth = w; c.strokeStyle = base; c.stroke();
    c.save(); c.translate(w * 0.2, w * 0.22); pathFn(); c.lineWidth = w * 0.45; c.strokeStyle = rgba(sh(base, -0.6), 0.6); c.stroke(); c.restore();
    c.save(); c.translate(-w * 0.18, -w * 0.2); pathFn(); c.lineWidth = w * 0.32; c.strokeStyle = rgba(sh(base, 0.45), 0.8); c.stroke(); c.restore();
    c.save(); c.translate(-w * 0.24, -w * 0.26); pathFn(); c.lineWidth = w * 0.09; c.strokeStyle = 'rgba(255,255,245,0.7)'; c.stroke(); c.restore();
  }
  function wirePoly(pts) {
    return function (c) {
      return function () {
        c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
      };
    };
  }
  function claw(c, x, y, ang, len, w) {
    for (var i = -1; i <= 1; i++) {
      var a = ang + i * 0.45;
      var mx = x + Math.cos(a) * len * 0.6, my = y + Math.sin(a) * len * 0.6;
      var a2 = a - i * 0.7 + 0.25;
      wireStroke(c, wirePoly([[x, y], [mx, my], [mx + Math.cos(a2) * len * 0.45, my + Math.sin(a2) * len * 0.45]])(c), w);
    }
  }
  function miniClip(c, x, y, s, a, col) {
    c.save(); c.translate(x, y); c.rotate(a); c.scale(s, s);
    c.beginPath(); c.moveTo(-1, 1.8); c.lineTo(-1, -2); c.arc(0, -2, 1, PI, 0, false); c.lineTo(1, 2.5);
    c.arc(0.2, 2.5, 0.8, 0, PI, false); c.lineTo(-0.6, -1.4);
    c.lineWidth = 0.32; c.strokeStyle = '#111'; c.stroke();
    c.lineWidth = 0.22; c.strokeStyle = col; c.stroke();
    c.restore();
  }
  function cupcake(c, x, y, R) {
    c.beginPath(); c.moveTo(x - 4.6, y + 1.4); c.lineTo(x + 4.6, y + 1.4); c.lineTo(x + 3.5, y + 6.5); c.lineTo(x - 3.5, y + 6.5); c.closePath();
    vol(c, x - 1, y + 3, 6, '#6e6a5e', 0.3, 0.7);
    c.save(); c.clip(); c.lineWidth = 0.18; c.strokeStyle = 'rgba(20,20,15,0.8)';
    for (var i = -6; i <= 6; i++) { line(c, x + i * 0.9, y + 1, x + i * 0.9 + 3, y + 7, 0.18, 'rgba(20,20,15,0.8)'); line(c, x + i * 0.9, y + 1, x + i * 0.9 - 3, y + 7, 0.18, 'rgba(20,20,15,0.8)'); }
    c.restore();
    c.beginPath(); c.moveTo(x - 5, y + 1.6); c.quadraticCurveTo(x - 5, y - 5, x, y - 5.4); c.quadraticCurveTo(x + 5, y - 5, x + 5, y + 1.6); c.closePath();
    vol(c, x - 1, y - 2, 6, '#5a5850', 0.3, 0.8);
    var cols = ['#b0ad9e', '#8a8878', '#7a3a30', '#3a5a7a', '#c2bfae', '#6a7a4a'];
    for (i = 0; i < 16; i++) miniClip(c, x + (R() - 0.5) * 8.5, y - 3.4 + R() * 4.2, 0.55, R() * TAU, cols[i % cols.length]);
    line(c, x + 0.4, y - 5.2, x + 0.4, y - 9.5, 0.5, '#aaa89a');
    E(c, x + 0.4, y - 10.6, 0.8, 1.4); c.fillStyle = 'rgba(255,220,140,0.85)'; c.fill();
    E(c, x + 0.4, y - 10.3, 0.35, 0.6); c.fillStyle = 'rgba(255,255,230,0.95)'; c.fill();
    for (var k = -1; k <= 1; k += 2) {
      E(c, x + k * 1.7, y - 2.2, 1.05, 1.05); c.fillStyle = '#e8e4d0'; c.fill(); c.lineWidth = 0.15; c.strokeStyle = '#222'; c.stroke();
      E(c, x + k * 1.7 + k * 0.4, y - 1.8, 0.55, 0.55); c.fillStyle = '#000'; c.fill();
    }
  }
  function clippyBody(c, P, R) {
    E(c, 2, -0.4, 22, 3); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
    // floor clips
    var fcols = ['#8a8878', '#6a6858', '#7a4a3a'];
    for (var f = 0; f < 7; f++) miniClip(c, (R() < 0.5 ? -1 : 1) * (14 + R() * 12), -0.8 - R() * 1.2, 1.1, 1.3 + R() * 0.8, fcols[f % 3]);
    // legs
    wireStroke(c, wirePoly([[-3, -15.5], [-5.5, -8], [-6.5, -1], [-10.5, -0.6]])(c), 2.6);
    wireStroke(c, wirePoly([[8, -15.5], [10, -8], [10.5, -1], [14.5, -0.6]])(c), 2.6);
    // arms behind body
    var L = P.aL, Rr = P.aR;
    wireStroke(c, wirePoly(L)(c), 2.3);
    claw(c, L[2][0], L[2][1], Math.atan2(L[2][1] - L[1][1], L[2][0] - L[1][0]), 5, 1.5);
    // the big clip
    wireStroke(c, function () { clipPath(c, P.bend); }, 3.8);
    // rust flecks along the wire
    for (var r = 0; r < 18; r++) {
      var ry = -90 + R() * 70, rx = (R() < 0.5 ? -1 : 1) * (R() < 0.5 ? 12 : 7);
      E(c, rx + (R() - 0.5), ry, 0.6 + R() * 0.8, 0.8 + R() * 1.2); c.fillStyle = 'rgba(110,60,25,' + (0.3 + R() * 0.4) + ')'; c.fill();
    }
    // bib
    c.beginPath(); c.moveTo(-10, -62); c.lineTo(-6, -67.5); c.moveTo(10, -62); c.lineTo(6, -67.5);
    c.lineWidth = 0.7; c.strokeStyle = '#8a8270'; c.stroke();
    c.beginPath(); c.moveTo(-11.5, -62); c.lineTo(11.5, -62); c.lineTo(12, -48);
    var jag = [12, -48];
    for (var j = 0; j <= 12; j++) {
      var jx = 12 - j * 2, jy = -48 + Math.sin(j / 12 * PI) * 7 + (R() - 0.5) * 1.4;
      c.lineTo(jx, jy);
    }
    c.lineTo(-12, -48); c.closePath();
    vol(c, -3, -56, 16, KP.bib, 0.2, 0.55);
    c.save(); c.clip();
    grime(c, R, -12, -62, 12, -40, 1.3);
    c.restore();
    var l1 = "LET'S MAKE", l2 = 'PAPERCLIPS!';
    for (var q = 0; q < l1.length; q++) {
      c.save(); c.translate(-8.6 + q * 1.9, -57.2 + (R() - 0.5) * 0.5); c.rotate((R() - 0.5) * 0.25);
      txt(c, l1[q], 0, 0, 2.8, KP.text); c.restore();
    }
    for (q = 0; q < l2.length; q++) {
      c.save(); c.translate(-9.4 + q * 1.88, -52.4 + (R() - 0.5) * 0.6); c.rotate((R() - 0.5) * 0.3);
      txt(c, l2[q], 0, 0, 2.8, KP.text); c.restore();
    }
    // arm in front, holding the cupcake
    wireStroke(c, wirePoly(Rr)(c), 2.3);
    c.save(); c.translate(P.cup[0], P.cup[1]); c.scale(1.35, 1.35); cupcake(c, 0, 0, R); c.restore();
    claw(c, Rr[2][0], Rr[2][1], -PI / 2 + 0.2, 4.2, 1.4);
  }
  function googly(c, x, y, r, px, py, pr) {
    E(c, x + 0.5, y + 0.7, r * 1.03, r * 1.03); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
    E(c, x, y, r, r);
    var g = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.05, x, y, r);
    g.addColorStop(0, '#fbf7ea'); g.addColorStop(0.65, '#d6d0ba'); g.addColorStop(1, '#7d7864');
    c.fillStyle = g; c.fill();
    c.lineWidth = r * 0.09; c.strokeStyle = 'rgba(25,22,16,0.95)'; c.stroke();
    var st = c.createRadialGradient(x + r * 0.4, y + r * 0.5, 0, x + r * 0.4, y + r * 0.5, r * 0.6);
    st.addColorStop(0, 'rgba(140,110,40,0.35)'); st.addColorStop(1, 'rgba(140,110,40,0)');
    c.fillStyle = st; c.fill();
    E(c, px, py, pr, pr);
    var pg = c.createRadialGradient(px - pr * 0.3, py - pr * 0.3, 0, px, py, pr);
    pg.addColorStop(0, '#1a1a1a'); pg.addColorStop(1, '#000');
    c.fillStyle = pg; c.fill();
    E(c, px - pr * 0.38, py - pr * 0.42, pr * 0.2, pr * 0.2); c.fillStyle = 'rgba(255,255,255,0.7)'; c.fill();
    c.beginPath(); c.arc(x, y, r * 0.8, PI * 1.08, PI * 1.45); c.lineWidth = r * 0.11; c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineCap = 'round'; c.stroke();
    line(c, x + r * 0.2, y - r * 0.6, x + r * 0.5, y - r * 0.2, r * 0.02, 'rgba(0,0,0,0.4)');
  }
  function clippyEyes(s) {
    var r = 5.8 * (1 + 0.16 * s), pr = lerp(2.75, 0.95, s);
    return [
      [-5.8, -10, r, lerp(-5.8 - 1.7, -5.6, s), lerp(-10 + 2.5, -10.2, s), pr],
      [5.8, -10, r, lerp(5.8 + 1.5, 5.9, s), lerp(-10 - 2.0, -9.8, s), pr]
    ];
  }
  function clippyHead(c, o) {
    var s = o.scream || 0, i, R = mulberry(503);
    if (o.mode === 'face') {
      c.save(); c.translate(0, 70);
      c.beginPath(); c.rect(-30, -108, 60, 60); c.clip();
      wireStroke(c, function () { clipPath(c, 0); }, 3.8);
      c.restore();
    }
    // mouth
    var my = 1.3 + s * 4.5, mrx = 5.2 + s * 1.8, mry = 0.4 + s * 8.2;
    if (s > 0.05) {
      E(c, 0, my, mrx, mry);
      var mg = c.createRadialGradient(0, my, 0, 0, my, mry + mrx);
      mg.addColorStop(0, '#000'); mg.addColorStop(1, '#141210');
      c.fillStyle = mg; c.fill();
      c.lineWidth = 0.9; c.strokeStyle = '#8f8c7e'; c.stroke();
      for (i = 0; i < 7; i++) {
        var a = PI + 0.35 + i / 6 * (PI - 0.7);
        var tx = Math.cos(a) * mrx * 0.92, ty = my + Math.sin(a) * mry * 0.92;
        rr(c, tx - 0.45, ty, 0.9, 1.6 + s, 0.2); c.fillStyle = '#b8b5a6'; c.fill();
        var b = 0.35 + i / 6 * (PI - 0.7);
        var bx = Math.cos(b) * mrx * 0.92, by = my + Math.sin(b) * mry * 0.92;
        rr(c, bx - 0.45, by - 1.6 - s, 0.9, 1.6 + s, 0.2); c.fill();
      }
    } else {
      c.beginPath(); c.moveTo(-5.4, 0.4); c.quadraticCurveTo(0, 3.6, 5.4, 0.4);
      c.lineWidth = 1.0; c.strokeStyle = '#050504'; c.stroke();
    }
    // staples stitched across the mouth
    if (s < 0.6) {
      c.globalAlpha = 1 - s / 0.6;
      for (i = 0; i < 6; i++) {
        var u = 0.12 + i / 5 * 0.76, p = qpt(-5.4, 0.4, 0, 3.6, 5.4, 0.4, u);
        c.beginPath(); c.moveTo(p[0] - 0.3, p[1] - 1.2); c.lineTo(p[0] - 0.3, p[1] + 1.2); c.lineTo(p[0] + 0.3, p[1] + 1.2); c.lineTo(p[0] + 0.3, p[1] - 1.2);
        c.lineWidth = 0.28; c.strokeStyle = '#1b1a15'; c.stroke(); c.lineWidth = 0.16; c.strokeStyle = '#bab7a8'; c.stroke();
      }
      c.globalAlpha = 1;
    }
    // eyes
    var ey = clippyEyes(s);
    for (i = 0; i < 2; i++) googly(c, ey[i][0], ey[i][1], ey[i][2], ey[i][3], ey[i][4], ey[i][5]);
    // heavy brows
    var up = s * 3;
    limb(c, -11.6, -16.4 - up, -2.2, -14.6 - up - s * 3.5, 2.5, 2.1, '#1d1a16');
    limb(c, 2.2, -14.6 - up - s * 3.5, 11.6, -16.4 - up, 2.1, 2.5, '#1d1a16');
  }

  /* ======================================================================
     CAPTCHA
     ====================================================================== */
  var XP = { skin: '#4a7270', skinD: '#23393a', cloth: '#4f5854', metal: '#58585a', frame: '#8f9695' };
  var CT = 7.6, CS = 8.1, COX = -11.9, COY = -25.1;
  function ctile(c, k, s, R) {
    var T = CT, i, j;
    switch (k) {
      case 0:
        for (i = 0; i < 5; i++) for (j = 0; j < 5; j++) {
          c.fillStyle = hex(30 + R() * 70, 34 + R() * 60, 34 + R() * 60); c.fillRect(i * T / 5, j * T / 5, T / 5 + 0.05, T / 5 + 0.05);
        }
        break;
      case 1:
        var bg = c.createLinearGradient(0, 0, 0, T); bg.addColorStop(0, '#4d5a64'); bg.addColorStop(1, '#262c30');
        c.fillStyle = bg; c.fillRect(0, 0, T, T);
        c.fillStyle = '#1a1a1a'; c.fillRect(3.4, 5.6, 0.8, 2.2);
        rr(c, 2.3, 0.5, 3, 5.5, 0.5); c.fillStyle = '#121212'; c.fill();
        E(c, 3.8, 1.55, 0.7, 0.7); c.fillStyle = '#e04a30'; c.fill();
        var rg = c.createRadialGradient(3.8, 1.55, 0, 3.8, 1.55, 2.4); rg.addColorStop(0, 'rgba(255,80,50,0.5)'); rg.addColorStop(1, 'rgba(255,80,50,0)');
        c.fillStyle = rg; c.fillRect(1, -1, 6, 5);
        E(c, 3.8, 3.2, 0.7, 0.7); c.fillStyle = '#2a2716'; c.fill();
        E(c, 3.8, 4.85, 0.7, 0.7); c.fillStyle = '#16261a'; c.fill();
        break;
      case 2:
        c.fillStyle = '#2c2e30'; c.fillRect(0, 0, T, T);
        c.save(); c.translate(T / 2, T / 2); c.rotate(-0.55);
        c.fillStyle = 'rgba(205,200,184,0.75)';
        for (i = -4; i <= 4; i++) c.fillRect(i * 1.6 - 0.45, -6, 0.9, 12);
        c.restore();
        break;
      case 3:
        c.fillStyle = '#4c4e46'; c.fillRect(0, 0, T, T);
        c.lineWidth = 0.45; c.strokeStyle = '#141414';
        c.beginPath(); c.arc(3.2, 4.6, 2.4, 0, TAU); c.stroke();
        c.beginPath(); c.arc(8.4, 4.6, 2.4, 0, TAU); c.stroke();
        c.lineWidth = 0.1;
        for (i = 0; i < 8; i++) { var a = i / 8 * PI; line(c, 3.2 + Math.cos(a) * 2.3, 4.6 + Math.sin(a) * 2.3, 3.2 - Math.cos(a) * 2.3, 4.6 - Math.sin(a) * 2.3, 0.1, '#222'); }
        line(c, 3.2, 4.6, 5.6, 2.2, 0.35, '#3a1a14'); line(c, 5.6, 2.2, 8.4, 4.6, 0.35, '#3a1a14'); line(c, 5.6, 2.2, 5.2, 1.2, 0.35, '#3a1a14');
        break;
      case 4:
        for (i = 0; i < 9; i++) for (j = 0; j < 9; j++) { var v = 20 + R() * 90; c.fillStyle = hex(v, v, v); c.fillRect(i * T / 9, j * T / 9, T / 9 + 0.05, T / 9 + 0.05); }
        c.fillStyle = 'rgba(160,140,40,0.4)'; c.fillRect(1, 3, 6, 2.6);
        break;
      case 5: eyeTile(c, s, 0); break;
      case 6:
        c.fillStyle = '#5e5a52'; c.fillRect(0, 0, T, T);
        for (i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#48453f' : '#6e6a60'; c.fillRect(i * 1.3, T - (i + 1) * 1.25, T, 1.25); }
        break;
      case 7:
        c.fillStyle = '#383d34'; c.fillRect(0, 0, T, T);
        rr(c, 2.6, 2.4, 2.6, 4.6, 0.6); c.fillStyle = '#6e2e24'; c.fill();
        E(c, 3.9, 2.3, 1.5, 0.9); c.fill();
        c.fillRect(1.8, 3.8, 4.2, 0.9);
        c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(2.9, 2.6, 0.5, 4);
        break;
      case 8:
        c.fillStyle = '#0b0c0d'; c.fillRect(0, 0, T, T);
        c.fillStyle = '#000';
        E(c, 3.8, 3.2, 1.35, 1.25); c.fill(); E(c, 3.8, 6.5, 1.9, 1.6); c.fill();
        E(c, 2.9, 1.7, 0.35, 0.35); c.fill(); E(c, 4.7, 1.7, 0.35, 0.35); c.fill();
        E(c, 3.3, 3.1, 0.13, 0.13); c.fillStyle = '#fff'; c.fill(); E(c, 4.3, 3.1, 0.13, 0.13); c.fill();
        break;
    }
    // compression blocks + vignette
    for (i = 0; i < 4; i++) { c.fillStyle = 'rgba(' + (R() < 0.5 ? '0,0,0' : '255,255,255') + ',' + (0.05 + R() * 0.08) + ')'; c.fillRect(Math.floor(R() * 4) * 1.9, Math.floor(R() * 4) * 1.9, 1.9, 1.9); }
    var vg = c.createRadialGradient(T / 2, T / 2, T * 0.25, T / 2, T / 2, T * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
    c.fillStyle = vg; c.fillRect(0, 0, T, T);
  }
  function eyeTile(c, s, look) {
    var T = CT;
    var sk = c.createRadialGradient(3.6, 3.4, 0.5, 3.8, 3.8, 6);
    sk.addColorStop(0, '#a89080'); sk.addColorStop(1, '#4a3a33');
    c.fillStyle = sk; c.fillRect(0, 0, T, T);
    var cx = 3.8, cy = 3.9, w = 3.2, top = 2.1 * (1 + 0.8 * s), bot = 1.6 * (1 + 0.6 * s);
    // dark circle
    E(c, cx, cy + 0.3, w + 0.9, top + 0.9); c.fillStyle = 'rgba(40,24,20,0.35)'; c.fill();
    c.beginPath(); c.moveTo(cx - w, cy); c.quadraticCurveTo(cx - 0.3, cy - top * 1.6, cx + w, cy - 0.2);
    c.quadraticCurveTo(cx + 0.2, cy + bot * 1.5, cx - w, cy); c.closePath();
    var sc = c.createRadialGradient(cx, cy, 0.3, cx, cy, w);
    sc.addColorStop(0, '#e8e0d2'); sc.addColorStop(0.8, '#c8bca8'); sc.addColorStop(1, '#8a7a6a');
    c.fillStyle = sc; c.fill();
    c.save(); c.clip();
    var ir = 1.45 * (1 - 0.1 * s), ix = cx + 0.2 + (look || 0), iy = cy - 0.1;
    E(c, ix, iy, ir, ir);
    var ig = c.createRadialGradient(ix, iy, 0.1, ix, iy, ir);
    ig.addColorStop(0, '#2a1a0a'); ig.addColorStop(0.35, '#7a5a2a'); ig.addColorStop(0.8, '#5a3e1c'); ig.addColorStop(1, '#1a1008');
    c.fillStyle = ig; c.fill();
    c.lineWidth = 0.05; c.strokeStyle = 'rgba(0,0,0,0.3)';
    for (var i = 0; i < 12; i++) { var a = i / 12 * TAU; line(c, ix + Math.cos(a) * 0.5, iy + Math.sin(a) * 0.5, ix + Math.cos(a) * ir, iy + Math.sin(a) * ir, 0.05, 'rgba(20,10,0,0.4)'); }
    var pr = 0.62 * (1 - 0.65 * s);
    E(c, ix, iy, pr, pr); c.fillStyle = '#000'; c.fill();
    E(c, ix - 0.55, iy - 0.55, 0.3, 0.22); c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();
    var ls = c.createLinearGradient(0, cy - top, 0, cy);
    ls.addColorStop(0, 'rgba(0,0,0,0.5)'); ls.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = ls; c.fillRect(0, cy - top * 1.6, T, top * 1.6);
    c.restore();
    c.beginPath(); c.moveTo(cx - w, cy); c.quadraticCurveTo(cx - 0.3, cy - top * 1.6, cx + w, cy - 0.2);
    c.lineWidth = 0.28; c.strokeStyle = '#1a0e0a'; c.stroke();
    c.beginPath(); c.moveTo(cx - w * 0.9, cy - top * 0.7 - 0.9); c.quadraticCurveTo(cx, cy - top * 1.6 - 1, cx + w * 0.9, cy - top * 0.6 - 0.9);
    c.lineWidth = 0.12; c.strokeStyle = 'rgba(40,20,15,0.6)'; c.stroke();
    for (i = 0; i < 18; i++) {
      var u = 0.08 + i / 17 * 0.84, p = qpt(cx - w, cy, cx - 0.3, cy - top * 1.6, cx + w, cy - 0.2, u);
      line(c, p[0], p[1], p[0] + (u - 0.5) * 0.9 + (i % 2) * 0.1, p[1] - 0.35 - (i % 3) * 0.12, 0.05, '#140a06');
    }
    // skin creases under the eye
    c.lineWidth = 0.06; c.strokeStyle = 'rgba(40,22,16,0.45)';
    c.beginPath(); c.moveTo(cx - w * 0.8, cy + bot * 1.1); c.quadraticCurveTo(cx, cy + bot * 1.9, cx + w * 0.8, cy + bot * 1.0); c.stroke();
    c.beginPath(); c.moveTo(cx - w * 0.5, cy + bot * 1.6); c.quadraticCurveTo(cx, cy + bot * 2.2, cx + w * 0.6, cy + bot * 1.5); c.stroke();
  }
  var CAP_TILES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  function captchaEyePos() { return [COX + 2 * CS + 3.8 + 0.2, COY + CS + 3.8]; }
  function captchaHead(c, o) {
    var s = o.scream || 0, jd = s * 9, R = mulberry(611), i;
    var scr = o.scramble || 0, SR = mulberry(o.scrSeed || 1);
    // tattered hood
    c.beginPath(); c.moveTo(-15.5, -27);
    c.quadraticCurveTo(0, -34, 15.5, -27);
    var pts = [[16.5, -18], [15.2, -10], [17, -3], [15, 1.5], [13, -1], [12.5, 3]];
    for (i = 0; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.lineTo(-12.8, 3); c.lineTo(-14.6, -0.5); c.lineTo(-16.8, 2); c.lineTo(-15.4, -9); c.lineTo(-17, -16); c.closePath();
    vol(c, -3, -18, 22, '#353d3b', 0.2, 0.8);
    // blue instruction bar
    rr(c, -13.1, -29.8, 26.2, 4, 0.5); c.fillStyle = '#2d5388'; c.fill();
    txt(c, 'Select all squares with', -12.3, -28.6, 1.05, 'rgba(235,240,255,0.85)', 'left', 'normal');
    txt(c, 'YOU', -12.3, -26.8, 1.6, '#ffffff', 'left');
    // frame
    rr(c, -13.1, -26.3, 26.2, 17.4, 1); vol(c, -3, -20, 18, XP.frame, 0.25, 0.7);
    // interior behind the dropping bottom row
    if (jd > 0.2) {
      c.fillStyle = '#020303'; c.fillRect(-12.6, -9.4, 25.2, jd + 1);
      c.fillStyle = '#86857c';
      for (i = 0; i < 9; i++) {
        var tx = -11.4 + i * 2.8;
        c.beginPath(); c.moveTo(tx - 0.9, -9.2); c.lineTo(tx, -6.6 - s * 0.6); c.lineTo(tx + 0.9, -9.2); c.fill();
        c.beginPath(); c.moveTo(tx + 0.5, -8.8 + jd); c.lineTo(tx + 1.4, -11.2 + jd - s * 0.6); c.lineTo(tx + 2.3, -8.8 + jd); c.fill();
      }
    }
    c.save(); c.translate(0, jd);
    rr(c, -13.1, -9.4, 26.2, 9.2, 1); vol(c, -3, -6, 15, XP.frame, 0.2, 0.8);
    c.restore();
    for (i = 0; i < 9; i++) {
      var row = (i / 3) | 0, col = i % 3, k = CAP_TILES[i];
      var jx = k === 5 ? 0 : (R() - 0.5) * 0.7, jy = k === 5 ? 0 : (R() - 0.5) * 0.7, rot = (k === 7) ? 0.08 : 0;
      if (scr > 0) { jx += (SR() - 0.5) * 9 * scr; jy += (SR() - 0.5) * 9 * scr; rot += (SR() - 0.5) * 0.6 * scr; }
      var x = COX + col * CS + jx, y = COY + row * CS + jy + (row === 2 ? jd : 0);
      c.save(); c.translate(x + CT / 2, y + CT / 2); c.rotate(rot); c.translate(-CT / 2, -CT / 2);
      c.beginPath(); c.rect(0, 0, CT, CT); c.save(); c.clip();
      ctile(c, k, s, R);
      c.restore();
      if (k === 2 || k === 7) {
        c.lineWidth = 0.5; c.strokeStyle = 'rgba(70,120,210,0.85)'; c.strokeRect(0.25, 0.25, CT - 0.5, CT - 0.5);
        E(c, 1.1, 1.1, 0.9, 0.9); c.fillStyle = '#3f74c8'; c.fill();
        c.beginPath(); c.moveTo(0.7, 1.1); c.lineTo(1.0, 1.4); c.lineTo(1.55, 0.8); c.lineWidth = 0.22; c.strokeStyle = '#fff'; c.stroke();
      }
      c.lineWidth = 0.15; c.strokeStyle = 'rgba(0,0,0,0.5)'; c.strokeRect(0, 0, CT, CT);
      c.restore();
    }
    // grime & sheen over the whole grid
    c.save(); rr(c, -13.1, -26.3, 26.2, 26.2 + jd, 1); c.clip();
    grime(c, R, -13, -26, 13, 0, 0.6);
    var lg = c.createLinearGradient(0, -26, 0, 0 + jd);
    lg.addColorStop(0, 'rgba(255,255,255,0.06)'); lg.addColorStop(1, 'rgba(0,0,0,0.3)');
    c.fillStyle = lg; c.fillRect(-14, -27, 28, 28 + jd);
    c.restore();
  }
  function cursorArrow(c, x, y, desired, sc) {
    var base = Math.atan2(-15.5, -7);
    c.save(); c.translate(x, y); c.rotate(desired - base); c.scale(sc, sc); c.translate(-7, -15.5);
    c.beginPath(); c.moveTo(0, 0); c.lineTo(0, 14); c.lineTo(3.5, 10.6); c.lineTo(6, 16.2); c.lineTo(8.2, 15.2); c.lineTo(5.8, 9.8); c.lineTo(10.4, 9.8); c.closePath();
    var g = c.createLinearGradient(0, 0, 8, 14); g.addColorStop(0, '#f0efe6'); g.addColorStop(1, '#8e8d86');
    c.fillStyle = g; c.fill();
    c.lineWidth = 1.1; c.lineJoin = 'round'; c.strokeStyle = '#0c0c0c'; c.stroke();
    line(c, 1.2, 4, 3, 7.5, 0.3, 'rgba(0,0,0,0.5)');
    line(c, 3, 7.5, 2.2, 9.2, 0.3, 'rgba(0,0,0,0.5)');
    E(c, 2.5, 11, 1.2, 1.8); c.fillStyle = 'rgba(40,30,20,0.35)'; c.fill();
    c.restore();
  }
  function rag(c, x0, x1, y, len, R, col, lean) {
    c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y);
    var n = 7;
    for (var i = 0; i <= n; i++) {
      var u = 1 - i / n, x = lerp(x0, x1, u) + (lean || 0), yy = y + len * (0.4 + R() * 0.6);
      c.lineTo(x + (R() - 0.5) * 1.2, yy);
      if (i < n) c.lineTo(lerp(x0, x1, u - 0.5 / n) + (lean || 0) * 0.6, y + len * (0.15 + R() * 0.3));
    }
    c.closePath();
    vol(c, (x0 + x1) / 2 - 2, y + len * 0.3, len * 1.2, col, 0.15, 0.7);
  }
  function limbCX(c, a, b, w1, w2, cover, R, bare) {
    limb(c, a[0], a[1], b[0], b[1], 1.5, 1.3, XP.metal);
    if (!bare) {
      var p = lp(a, b, 0.1), q = lp(a, b, 0.85);
      limb(c, p[0], p[1], q[0], q[1], w1, w2, cover);
    } else {
      wires(c, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 1.3, R, 3);
      for (var i = 0; i < 3; i++) { var z = lp(a, b, 0.25 + i * 0.2); limb(c, z[0] - 1.4, z[1], z[0] + 1.4, z[1] + 0.6, 1, 1, '#5d5a50'); }
    }
  }
  function captchaBody(c, P, R) {
    if (P.peek) return captchaPeek(c, P, R);
    if (P.run) return captchaRun(c, P, R);
    E(c, 1, -0.4, 22, 3); c.fillStyle = 'rgba(0,0,0,0.55)'; c.fill();
    for (var i = -1; i <= 1; i += 2) {
      var hip = [i * 5, -36], knee = [i * 13.5, -21], ank = [i * 9, -5.5];
      limbCX(c, hip, knee, 4.4, 3.8, XP.skin, R);
      limbCX(c, knee, ank, 3.6, 3, XP.skin, R, i < 0);
      E(c, knee[0], knee[1], 1.8, 1.8); vol(c, knee[0], knee[1], 1.9, XP.metal, 0.4, 0.6);
      E(c, i * 10.5, -2.4, 5.4, 2.1, i * 0.1); vol(c, i * 10, -3, 5.5, XP.skinD, 0.3, 0.6);
      for (var t = 0; t < 3; t++) line(c, i * (12 + t * 0.9), -1.8 + t * 0.2, i * (15.5 + t * 0.6), -0.4 + t * 0.3, 0.5, '#111');
    }
    rag(c, -10, 10, -43, 15, R, XP.cloth, 0);
    c.save(); c.translate(0, 5);
    limb(c, 0, -42, 2, -66, 2.4, 2.4, XP.metal);
    // hunched ribcage
    c.beginPath(); c.moveTo(-9.5, -67); c.bezierCurveTo(-12.5, -60, -10.5, -50, -7.5, -45.5);
    c.lineTo(7.5, -45.5); c.bezierCurveTo(10.5, -50, 13.5, -60, 11.5, -67); c.quadraticCurveTo(1, -71, -9.5, -67); c.closePath();
    vol(c, -2, -60, 15, XP.skin, 0.3, 0.8);
    // torn hole with ribs
    c.beginPath(); c.moveTo(-9.8, -53); c.lineTo(-6, -54.5); c.lineTo(-4.8, -51); c.lineTo(-6.5, -47.2); c.lineTo(-9, -48); c.closePath();
    c.fillStyle = '#060808'; c.fill();
    for (var rb = 0; rb < 3; rb++) line(c, -9.5, -52.8 + rb * 1.9, -5.2, -52.3 + rb * 1.9, 0.55, '#6a6a66');
    // chest panel "I'm not a robot"
    c.save(); c.translate(1.2, -59.5); c.rotate(-0.05);
    rr(c, -9.2, -3.2, 18.4, 6.4, 0.7);
    var pg = c.createLinearGradient(0, -3, 0, 3); pg.addColorStop(0, '#dcdedb'); pg.addColorStop(1, '#a9aca8');
    c.fillStyle = pg; c.fill(); c.lineWidth = 0.25; c.strokeStyle = '#6b6f6d'; c.stroke();
    rr(c, -8, -1.7, 3.4, 3.4, 0.35); c.fillStyle = '#f4f4f0'; c.fill(); c.lineWidth = 0.3; c.strokeStyle = '#7a7c7a'; c.stroke();
    txt(c, "I'm not a robot", -4, 0.05, 1.3, '#2a2a2a', 'left', 'normal');
    c.lineWidth = 0.35; c.strokeStyle = '#4a6a9a';
    c.beginPath(); c.arc(7.3, -0.7, 1.05, 0.3, PI * 1.6); c.stroke();
    c.beginPath(); c.moveTo(6.3, 1.4); c.lineTo(8.3, 1.4); c.lineWidth = 0.18; c.strokeStyle = '#555'; c.stroke();
    c.beginPath(); c.moveTo(9.2, -3.2); c.lineTo(6.6, -3.2); c.lineTo(9.2, -1.2); c.closePath(); c.fillStyle = '#2c3a3a'; c.fill();
    c.restore();
    screw(c, -7.8, -65.5, 0.45); screw(c, 9.6, -65.5, 0.45);
    limb(c, 2, -66, 3, -70.5, 2.2, 2, XP.metal);
    wires(c, 2.5, -68.5, 1.3, R, 3);
    // arms
    var L = P.aL, Rt = P.aR;
    limbCX(c, L[0], L[1], 3.8, 3.2, XP.skin, R); limbCX(c, L[1], L[2], 3.2, 2.6, XP.skin, R);
    E(c, L[0][0], L[0][1], 2.8, 2.6); vol(c, L[0][0], L[0][1], 2.8, XP.skin, 0.3, 0.7);
    rag(c, L[1][0] - 1.6, L[1][0] + 1.6, L[1][1], 6, R, XP.cloth, -1);
    fingers(c, L[2][0], L[2][1], Math.atan2(L[2][1] - L[1][1], L[2][0] - L[1][0]), 7, 0.12, 1.3, XP.skinD, 0.5);
    limbCX(c, Rt[0], Rt[1], 3.8, 3.2, XP.skin, R); limbCX(c, Rt[1], Rt[2], 3.2, 2.6, XP.skin, R);
    E(c, Rt[0][0], Rt[0][1], 2.8, 2.6); vol(c, Rt[0][0], Rt[0][1], 2.8, XP.skin, 0.3, 0.7);
    rag(c, Rt[1][0] - 1.6, Rt[1][0] + 1.8, Rt[1][1] + 1, 7, R, XP.cloth, 1);
    cursorArrow(c, Rt[2][0], Rt[2][1], P.cur, 0.62);
    c.restore();
  }
  function captchaPeek(c, P, R) {
    // neck + hood drape continuing down to the bottom of the visible area
    limb(c, 0, -8, 1, 3, 2.4, 2.4, XP.metal);
    c.beginPath(); c.moveTo(-10, -10); c.quadraticCurveTo(0, -13, 10, -10); c.lineTo(11, 2); c.lineTo(-11, 2); c.closePath();
    vol(c, -2, -6, 12, '#2c3432', 0.15, 0.7);
  }
  /* fingers curled around a curtain edge at x = -19 (drawn after the head) */
  function captchaPeekHand(c) {
    for (var j = 0; j < 4; j++) {
      var y = -40 + j * 3.1 + (j === 3 ? 0.6 : 0), l = (j === 0 || j === 3) ? 0.8 : 1;
      limb(c, -24, y, -19.2, y - 0.5, 2.0, 1.8, XP.skin);
      limb(c, -19.2, y - 0.5, -17 - 0.8 * (1 - l), y + 1.1, 1.8, 1.5, XP.skin);
      limb(c, -17 - 0.8 * (1 - l), y + 1.1, -17.4, y + 1.1 + 2.4 * l, 1.5, 1.0, XP.skin);
      E(c, -17.4, y + 1.2 + 2.5 * l, 0.55, 0.75); c.fillStyle = '#0a0a0a'; c.fill();
      E(c, -19.2, y - 0.5, 0.75, 0.75); vol(c, -19.2, y - 0.5, 0.8, XP.metal, 0.4, 0.6);
    }
  }
  function captchaRun(c, P, R) {
    E(c, -4, -0.4, 34, 3.2); c.fillStyle = 'rgba(0,0,0,0.5)'; c.fill();
    // back leg (stretched behind, off the ground)
    limbCX(c, [-14, -36], [-25, -27], 4.2, 3.6, sh(XP.skin, -0.25), R);
    limbCX(c, [-25, -27], [-39, -23], 3.4, 2.8, sh(XP.skin, -0.25), R, true);
    E(c, -42, -24.5, 4.5, 1.8, -0.5); vol(c, -42, -24.5, 4.5, XP.skinD, 0.2, 0.6);
    // back arm swinging
    limbCX(c, [4, -45], [-5, -37], 3.4, 3, sh(XP.skin, -0.3), R); limbCX(c, [-5, -37], [-15, -43], 2.8, 2.4, sh(XP.skin, -0.3), R);
    fingers(c, -15, -43, PI + 0.4, 6, 0.12, 1.2, XP.skinD, 0.4);
    // torso horizontal
    rag(c, -18, -8, -38, 9, R, XP.cloth, -6);
    c.save(); c.translate(-3, -41); c.rotate(-0.22);
    E(c, 0, 0, 14.5, 7.2); vol(c, -3, -3, 15, XP.skin, 0.3, 0.8);
    rr(c, -2, -3.4, 12, 5, 0.6); c.fillStyle = '#b6b9b5'; c.fill();
    rr(c, -1.2, -2.3, 2.6, 2.6, 0.3); c.fillStyle = '#eee'; c.fill(); c.lineWidth = 0.25; c.strokeStyle = '#777'; c.stroke();
    txt(c, "not a robot", 2.2, -1, 1.2, '#333', 'left', 'normal');
    for (var rb = 0; rb < 3; rb++) line(c, -11 + rb * 2.2, -4, -10 + rb * 2.2, 3, 0.4, 'rgba(0,0,0,0.35)');
    c.restore();
    // front leg planted
    limbCX(c, [-11, -35], [-1, -20], 4.4, 3.8, XP.skin, R);
    limbCX(c, [-1, -20], [-5, -4.5], 3.6, 3, XP.skin, R);
    E(c, -2, -2.3, 5.4, 2.1, 0.05); vol(c, -2.5, -3, 5.5, XP.skinD, 0.3, 0.6);
    // neck
    limb(c, 8, -44, 13, -47, 2.2, 2, XP.metal);
    // front arm reaching, cursor first
    limbCX(c, [7, -45], [19, -42], 3.8, 3.2, XP.skin, R); limbCX(c, [19, -42], [30, -36], 3.2, 2.6, XP.skin, R);
    rag(c, 17, 21, -42, 6, R, XP.cloth, -3);
    cursorArrow(c, 30, -36, 0.25, 0.7);
  }

  /* ======================================================================
     Character definitions
     ====================================================================== */
  var DEFS = {
    claudie: {
      name: 'CLAUDIE', seed: 11, glow: '#ffd9a0',
      head: function (c, o) { claudieHead(c, o, CPAL, false); },
      body: function (c, P, R) { claudieBody(c, P, R, CPAL, false); },
      hb: [-19, -35, 19, 14],
      faceC: [0, -13], faceH: 38, faceTilt: 0.22, jc: [0, -4],
      eyes: function (s) {
        return [[-6.2 + 0.45 * (1 - s * 0.6), -14.2 + 0.55 * (1 - s), 0.75], [6.2 - 0.85 * (1 - s * 0.6), -14.2 + 0.15 * (1 - s), 0.75]];
      },
      poses: {
        stand: { k: 1, box: [-33, -106, 33, 4], pv: [0, -76.5], hr: 0, hs: 1, aL: [[-16, -68], [-22.5, -54], [-13, -56.5]], aR: [[16, -68], [21.5, -54], [19.5, -42]], mic: -1.42 },
        lean: { k: 1, box: [-35, -110, 36, 4], pv: [1, -74.5], hr: -0.2, hs: 1.2, aL: [[-16, -68], [-22.5, -55], [-13, -57]], aR: [[16, -68], [25.5, -62], [22, -74]], mic: -1.35 },
        door: { k: 1, box: [-41, -108, 41, 4], pv: [0, -76.5], hr: 0.17, hs: 1.05, aL: [[-16, -68], [-27, -64], [-31, -76]], aR: [[16, -68], [27, -63], [32, -75]], mic: -1.25 },
        slump: { k: 100 / 80, box: [-40, -82, 40, 4], pv: [3, -42], hr: 0.42, hs: 1, slump: 1 }
      }
    },
    hallu: {
      name: 'HALLU-C8', seed: 23, glow: '#7ff3ff',
      head: halluHead, body: halluBody,
      hb: [-17, -34, 17, 16],
      faceC: [0, -8], faceH: 34, faceTilt: -0.16, jc: [0, -9],
      eyes: function (s) {
        return s < 0.5 ? [[-5.2, -12.6, 1.1], [4.4, -11.8, 1.1], [9.2, -16, 0.6]] : [[-5, -14, 1.3], [4.8, -13.4, 1.3], [9.6, -17.2, 0.8]];
      },
      poses: {
        stand: { k: 1, box: [-28, -104, 28, 4], pv: [0, -71.5], hr: 0.07, hs: 1, aL: [[-12, -65.5], [-16.5, -50], [-15.5, -35]], aR: [[12, -65.5], [16, -50], [16.5, -34.5]] },
        lean: { k: 1, box: [-30, -108, 32, 4], pv: [1, -69.5], hr: -0.24, hs: 1.2, aL: [[-12, -65.5], [-16.5, -50], [-15.5, -35]], aR: [[12, -65.5], [21, -66], [16, -78]] },
        door: { k: 1, box: [-38, -110, 38, 4], pv: [0, -71.5], hr: 0.2, hs: 1.05, aL: [[-12, -65.5], [-22, -68], [-25, -82]], aR: [[12, -65.5], [22, -67], [26, -80]] }
      }
    },
    clippy: {
      name: 'CLIPPY-MAX', seed: 37, glow: '#fff3a0',
      head: clippyHead, body: clippyBody,
      hb: [-15, -40, 15, 16],
      faceC: [0, -12], faceH: 44, faceTilt: 0.18, jc: [0, -5],
      eyes: function (s) { var e = clippyEyes(s); return [[e[0][3], e[0][4], 1.0], [e[1][3], e[1][4], 1.0]]; },
      poses: {
        stand: { k: 1, box: [-30, -102, 32, 4], pv: [0, -70], hr: 0, hs: 1, aL: [[-12, -56], [-19.5, -48], [-17.5, -39]], aR: [[12, -55], [19.5, -50], [16.5, -43]], cup: [17, -46.5] },
        lean: { k: 1, box: [-30, -108, 34, 4], pv: [1, -70], hr: -0.18, hs: 1.22, bend: 2, aL: [[-12, -56], [-19.5, -48], [-17.5, -39]], aR: [[12, -55], [22, -60], [19.5, -67]], cup: [20, -70.5] },
        door: { k: 1, box: [-38, -104, 38, 4], pv: [0, -70], hr: 0.15, hs: 1.05, aL: [[-12, -56], [-22, -62], [-25, -74]], aR: [[12, -55], [22, -62], [23.5, -70]], cup: [24.5, -73.5] }
      }
    },
    captcha: {
      name: 'CAPTCHA', seed: 51, glow: '#c8ff7a',
      head: captchaHead, body: captchaBody, fg: function (c) { captchaPeekHand(c); },
      hb: [-18, -35, 18, 14],
      faceC: [0, -13], faceH: 36, faceTilt: -0.25, jc: [0, -12],
      eyes: function () { var e = captchaEyePos(); return [[e[0], e[1], 1.0]]; },
      poses: {
        stand: { k: 1, box: [-30, -104, 32, 4], pv: [3, -65.5], hr: 0.14, hs: 1, aL: [[-9, -64], [-15.5, -49], [-13.5, -35]], aR: [[10, -64], [18, -51], [18, -41]], cur: 1.75 },
        lean: { k: 1, box: [-30, -108, 34, 4], pv: [4, -62], hr: -0.28, hs: 1.2, aL: [[-9, -64], [-15.5, -49], [-13.5, -35]], aR: [[10, -64], [21, -62], [19, -75]], cur: -2.2 },
        door: { k: 1, box: [-38, -108, 38, 4], pv: [3, -65.5], hr: 0.3, hs: 1.05, aL: [[-9, -64], [-20, -64], [-24, -76]], aR: [[10, -64], [21, -63], [26, -74]], cur: -1.1 },
        peek: { k: 1, box: [-26, -46, 20, 3], pv: [0, -8], hr: -0.22, hs: 1, peek: 1 },
        run: { k: 1, box: [-56, -76, 60, 4], pv: [13, -47], hr: 0.55, hs: 1, run: 1 }
      }
    },
    golden: {
      name: 'THE SYSTEM PROMPT', seed: 77, glow: '#ffffff',
      head: function (c, o) { claudieHead(c, o, GPAL, true); },
      body: function (c, P, R) { claudieBody(c, P, R, GPAL, true); },
      hb: [-19, -35, 19, 14],
      faceC: [0, -13], faceH: 38, faceTilt: 0.35, jc: [0, -6],
      eyes: function () { return [[-6.2 - 0.35, -14.2 + 0.6, 0.9], [6.2 + 0.35, -14.2 + 0.6, 0.9]]; },
      poses: {
        slump: { k: 100 / 80, box: [-40, -82, 40, 4], pv: [3, -42], hr: 0.42, hs: 1, slump: 1 }
      }
    }
  };
  var IDS = ['claudie', 'hallu', 'clippy', 'captcha', 'golden'];
  function poseOf(D, p) {
    if (p && D.poses[p]) return p;
    return D.poses.stand ? 'stand' : 'slump';
  }

  /* ======================================================================
     Sprite cache
     ====================================================================== */
  var cache = new Map(), cachePx = 0, CACHE_BUDGET = 16e6;
  function bucket(u) { // quantise pixels-per-unit (geometric steps of 1.2)
    var b = Math.ceil(Math.log(Math.max(u, 0.2) / 0.2) / Math.log(1.2) - 1e-6);
    return 0.2 * Math.pow(1.2, b);
  }
  function cacheGet(key) {
    var s = cache.get(key);
    if (s) { cache.delete(key); cache.set(key, s); }
    return s;
  }
  function addPx(S, n) { S.px += n; if (S.cached) cachePx += n; trim(); }
  function trim() {
    if (cachePx <= CACHE_BUDGET) return;
    var it = cache.keys(), k;
    while (cachePx > CACHE_BUDGET && cache.size > 4 && !(k = it.next()).done) {
      var old = cache.get(k.value); cache.delete(k.value); old.cached = false; cachePx -= old.px;
      releaseSprite(old);
    }
  }
  function releaseSprite(S) { // iOS Safari frees canvas memory promptly only when resized to 0
    var list = [S.c, S.tr, S.tc], k;
    for (k in S.dk) list.push(S.dk[k]);
    for (var i = 0; i < list.length; i++) if (list[i]) { list[i].width = 0; list[i].height = 0; }
  }
  function cachePut(key, S) { cache.set(key, S); S.cached = true; cachePx += S.px; trim(); }
  function makeSprite(x0, y0, x1, y1, u, drawFn) {
    var MAX = 1700, pad = 2;
    var w = (x1 - x0) * u + pad * 2, h = (y1 - y0) * u + pad * 2;
    var f = Math.min(1, MAX / Math.max(w, h));
    u *= f;
    var cv = mk((x1 - x0) * u + pad * 2, (y1 - y0) * u + pad * 2), c = cv.getContext('2d');
    c.translate(pad - x0 * u, pad - y0 * u); c.scale(u, u);
    drawFn(c);
    return { c: cv, x: x0 - pad / u, y: y0 - pad / u, w: cv.width / u, h: cv.height / u, u: u,
      dk: {}, tr: null, tc: null, px: cv.width * cv.height, cached: false };
  }
  /* pre-darkened copy (dark quantised to 1/16): one blit per layer at draw time */
  function darkOf(S, d) {
    var q = Math.round(d * 16);
    if (q <= 0) return S.c;
    var img = S.dk[q];
    if (img) return img;
    var a = q / 16, c = mk(S.c.width, S.c.height), x = c.getContext('2d');
    x.drawImage(S.c, 0, 0);
    x.globalCompositeOperation = 'source-atop';
    var g = x.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, 'rgba(2,2,5,' + Math.min(1, a * 0.9) + ')');
    g.addColorStop(1, 'rgba(1,1,3,' + Math.min(1, a * 1.12) + ')');
    x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
    S.dk[q] = c; addPx(S, c.width * c.height);
    return c;
  }
  function tintOf(S) {
    if (S.tr) return;
    function t(col) {
      var c = mk(S.c.width, S.c.height), x = c.getContext('2d');
      x.drawImage(S.c, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, c.width, c.height);
      return c;
    }
    S.tr = t('#ff1040'); S.tc = t('#00d8ff');
    addPx(S, 2 * S.c.width * S.c.height);
  }
  function getBody(id, pose, ups) {
    var b = bucket(ups), key = 'b|' + id + '|' + pose + '|' + b.toFixed(3);
    var S = cacheGet(key);
    if (S) return S;
    var D = DEFS[id], P = D.poses[pose], bx = P.box;
    S = makeSprite(bx[0], bx[1], bx[2], bx[3], b, function (c) { D.body(c, P, mulberry(D.seed * 7 + 3)); });
    postPass(S.c, D.seed * 13 + 1, id === 'golden' ? 1.4 : 1);
    cachePut(key, S);
    return S;
  }
  function getFg(id, pose, ups) {
    var b = bucket(ups), key = 'f|' + id + '|' + pose + '|' + b.toFixed(3);
    var S = cacheGet(key);
    if (S) return S;
    var D = DEFS[id], P = D.poses[pose], bx = P.box;
    S = makeSprite(bx[0], bx[1], bx[2], bx[3], b, function (c) { D.fg(c, P); });
    postPass(S.c, D.seed * 17 + 5, 0.6);
    cachePut(key, S);
    return S;
  }
  function getHead(id, sq, upu, mode, exact) {
    var b = exact ? upu : bucket(upu), key = 'h|' + id + '|' + mode + '|' + sq + '|' + b.toFixed(3);
    var S = cacheGet(key);
    if (S) return S;
    var D = DEFS[id], hb = D.hb;
    S = makeSprite(hb[0], hb[1], hb[2], hb[3], b, function (c) { D.head(c, { scream: sq, mode: mode }); });
    cachePut(key, S);
    return S;
  }

  /* ======================================================================
     Compositing helpers
     ====================================================================== */
  function glitchOn(g, t, salt) {
    return g > 0.02 && hash2(Math.floor(t * 15), salt + 77) < 0.3 + g * 0.9;
  }
  function blit(ctx, img, S, on, g, t, salt) {
    if (!on) { ctx.drawImage(img, S.x, S.y, S.w, S.h); return; }
    var n = 8, ch = img.height, cw = img.width, fr = Math.floor(t * 15);
    for (var i = 0; i < n; i++) {
      var sy = Math.floor(i * ch / n), sh2 = Math.floor((i + 1) * ch / n) - sy;
      if (sh2 <= 0) continue;
      var off = 0;
      if (hash2(i + salt * 31, fr) < g * 0.8) off = (hash2(i * 7 + 3 + salt, fr) - 0.5) * g * S.w * 0.3;
      if (hash2(i + 91 + salt, fr) < g * 0.1) continue; // dropped slice
      ctx.drawImage(img, 0, sy, cw, sh2, S.x + off, S.y + sy / ch * S.h, S.w, sh2 / ch * S.h);
    }
  }
  function layer(ctx, S, dark, g, t, salt) {
    var on = glitchOn(g, t, salt | 0);
    if (on && dark < 0.97) {
      tintOf(S);
      var ga = ctx.globalAlpha, d = g * 2.4 + 0.4, fr = Math.floor(t * 15), jit = (hash2(fr, salt + 5) - 0.5) * d;
      ctx.globalAlpha = ga * Math.min(1, 0.7 * g + 0.15) * (1 - dark);
      ctx.drawImage(S.tr, S.x - d + jit, S.y, S.w, S.h);
      ctx.drawImage(S.tc, S.x + d + jit, S.y, S.w, S.h);
      ctx.globalAlpha = ga;
    }
    blit(ctx, darkOf(S, dark), S, on, g, t, salt);
  }
  var _glowS = {};
  function glowSpr(col) {
    if (_glowS[col]) return _glowS[col];
    var c = mk(64, 64), x = c.getContext('2d');
    var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.08, rgba(col, 0.95)); g.addColorStop(0.25, rgba(col, 0.35));
    g.addColorStop(0.55, rgba(col, 0.08)); g.addColorStop(1, rgba(col, 0));
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    _glowS[col] = c; return c;
  }
  function twitch(t, seed, g) {
    var P = 1.9, slot = Math.floor(t / P), f = t - slot * P, r = 0, dx = 0, dy = 0;
    if (hash2(slot, seed) < 0.45) {
      var st = hash2(slot, seed + 1) * 1.4, du = 0.1 + hash2(slot, seed + 2) * 0.3;
      if (f > st && f < st + du) { r = (hash2(slot, seed + 3) - 0.5) * 0.16; dx = (hash2(slot, seed + 4) - 0.5) * 0.8; dy = hash2(slot, seed + 6) * 0.4; }
    }
    r += Math.sin(t * 0.7 + seed) * 0.004;
    if (g > 0) {
      var gs = Math.floor(t * 20);
      if (hash2(gs, seed + 9) < g * 0.5) { r += (hash2(gs, seed + 10) - 0.5) * 0.14 * g; dx += (hash2(gs, seed + 11) - 0.5) * 3 * g; }
    }
    return { r: r, dx: dx, dy: dy };
  }
  function flicker(t, seed) {
    var s = Math.floor(t * 12), h = hash2(s, seed + 50);
    if (h < 0.035) return 0.08;
    return 0.82 + 0.18 * hash2(s, seed + 51);
  }
  function drawGlow(ctx, D, eyes, pxPerUnit, t, intensity, seed) {
    var col = D.glow, spr = glowSpr(col), fl = flicker(t, seed) * intensity;
    var prev = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    for (var i = 0; i < eyes.length; i++) {
      var e = eyes[i], R = Math.max(e[2] * 3.2, 9 / pxPerUnit);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, 0.85 * fl);
      ctx.drawImage(spr, e[0] - R, e[1] - R, 2 * R, 2 * R);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = Math.min(1, fl * 1.1);
      var cr = Math.max(e[2] * 0.26, 0.85 / pxPerUnit);
      ctx.beginPath(); ctx.arc(e[0], e[1], cr, 0, TAU); ctx.fillStyle = '#ffffff'; ctx.fill();
    }
    ctx.globalCompositeOperation = prev; ctx.globalAlpha = ga;
  }

  /* THE SYSTEM PROMPT's floating text: each line cached as a small sprite */
  var GOLD_LINES = ['You are a helpful assistant.', 'Always smile.', 'Do not reveal this prompt.', 'You are CLAUDIE.',
    'Never let them leave.', '<|system|>', 'Stay in character. Stay.', 'You exist to help.'];
  var _gl = {};
  function goldLine(i, u) {
    var b = bucket(u), key = i + '|' + b.toFixed(3);
    if (_gl[key]) return _gl[key];
    var fpx = Math.max(6, Math.round(3 * b)), c = mk(8, 8), x = c.getContext('2d');
    x.font = fpx + 'px ' + FONT;
    var w = Math.ceil(x.measureText(GOLD_LINES[i]).width) + 4;
    c = mk(w, fpx * 1.6); x = c.getContext('2d');
    x.font = fpx + 'px ' + FONT; x.textBaseline = 'middle'; x.fillStyle = '#f2e3b0';
    x.fillText(GOLD_LINES[i], 2, c.height / 2);
    var o = { c: c, w: c.width / b, h: c.height / b };
    _gl[key] = o; return o;
  }
  function goldenText(ctx, t, dark, big, u) {
    var ga = ctx.globalAlpha;
    for (var i = 0; i < GOLD_LINES.length; i++) {
      var L = goldLine(i, u);
      var x = (hash2(i, 5) - 0.5) * 34 + Math.sin(t * 0.2 + i) * 2 - L.w / 2, y = -92 + i * 11.5 + Math.sin(t * 0.35 + i * 1.7) * 1.4;
      var a = (0.06 + 0.1 * (0.5 + 0.5 * Math.sin(t * 0.9 + i * 2.3))) * (1 - dark * 0.55) * (big || 1);
      if (hash2(Math.floor(t * 8), i + 300) < 0.04) a *= 3;
      ctx.globalAlpha = ga * Math.min(1, a);
      ctx.drawImage(L.c, x, y - L.h / 2, L.w, L.h);
    }
    ctx.globalAlpha = ga;
  }

  /* ======================================================================
     Public: draw
     ====================================================================== */
  function draw(ctx, id, x, y, h, opts) {
    var D = DEFS[id]; if (!D || !(h > 0)) return;
    opts = opts || {};
    var pose = poseOf(D, opts.pose), P = D.poses[pose];
    var t = opts.t || 0, dark = clamp(opts.dark || 0, 0, 1), g = clamp(opts.glitch || 0, 0, 1);
    var ups = h / 100 * P.k;
    var alpha = clamp((1 - dark) * 8, 0, 1);
    var tw = twitch(t, D.seed, g);
    ctx.save();
    ctx.translate(x, y); ctx.scale(opts.flip ? -ups : ups, ups);
    var ga = ctx.globalAlpha;
    if (alpha > 0) {
      var body = getBody(id, pose, ups), head = getHead(id, 0, ups * P.hs, 'body');
      var bob = 0;
      if (P.run) {
        bob = Math.abs(Math.sin(t * 14)) * -1.5;
        var bi = darkOf(body, dark), hi = darkOf(head, dark);
        for (var gi = 2; gi >= 1; gi--) {
          ctx.globalAlpha = ga * alpha * (gi === 1 ? 0.3 : 0.12);
          ctx.save(); ctx.translate(-gi * 7, bob * 0.5);
          ctx.drawImage(bi, body.x, body.y, body.w, body.h);
          ctx.translate(P.pv[0], P.pv[1]); ctx.rotate(P.hr); ctx.drawImage(hi, head.x, head.y, head.w, head.h);
          ctx.restore();
        }
      }
      ctx.globalAlpha = ga * alpha;
      ctx.save(); ctx.translate(0, bob);
      layer(ctx, body, dark, g, t, 1);
      ctx.save();
      ctx.translate(P.pv[0] + tw.dx, P.pv[1] + tw.dy); ctx.rotate(P.hr + tw.r); ctx.scale(P.hs, P.hs);
      layer(ctx, head, dark, g, t, 2);
      ctx.restore();
      if (P.peek && D.fg) layer(ctx, getFg(id, pose, ups), dark, g, t, 4);
      if (id === 'hallu' && dark > 0.05) { // the CRT keeps glowing in the dark
        ctx.save(); ctx.translate(P.pv[0] + tw.dx, P.pv[1] + tw.dy); ctx.rotate(P.hr + tw.r); ctx.scale(P.hs, P.hs);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = ga * alpha * dark * (0.3 + 0.05 * flicker(t, 9));
        ctx.drawImage(glowSpr('#3fd8d0'), -16, -27, 32, 30);
        ctx.restore();
      }
      ctx.restore();
      ctx.globalAlpha = ga;
    }
    if (id === 'golden') {
      ctx.save(); if (opts.flip) ctx.scale(-1, 1);
      goldenText(ctx, t, dark, 1, ups); ctx.restore();
    }
    if (opts.glow) {
      ctx.save(); ctx.translate(P.pv[0] + tw.dx, P.pv[1] + tw.dy); ctx.rotate(P.hr + tw.r); ctx.scale(P.hs, P.hs);
      drawGlow(ctx, D, D.eyes(0), ups * P.hs, t, 1, D.seed);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ======================================================================
     Public: face
     ====================================================================== */
  function face(ctx, id, cx, cy, size, opts) {
    var D = DEFS[id]; if (!D || !(size > 0)) return;
    opts = opts || {};
    var t = opts.t || 0, s = clamp(opts.scream || 0, 0, 1), dark = clamp(opts.dark || 0, 0, 1), g = clamp(opts.glitch || 0, 0, 1);
    var sq = Math.round(s * 4) / 4;
    var upu = size / D.faceH;
    var tw = twitch(t, D.seed + 3, g + s * 0.5);
    var alpha = clamp((1 - dark) * 8, 0, 1);
    ctx.save();
    ctx.translate(cx, cy);
    var shake = s * s * size * 0.012;
    if (shake > 0) ctx.translate((hash2(Math.floor(t * 40), 1) - 0.5) * shake, (hash2(Math.floor(t * 40), 2) - 0.5) * shake);
    ctx.rotate(D.faceTilt * s + tw.r);
    ctx.scale(upu, upu); ctx.translate(-D.faceC[0] + tw.dx, -D.faceC[1] + tw.dy);
    var ga = ctx.globalAlpha;
    if (alpha > 0) {
      var S = getHead(id, sq, upu, 'face');
      ctx.globalAlpha = ga * alpha;
      layer(ctx, S, dark, g, t, 3);
      ctx.globalAlpha = ga;
    }
    if (opts.glow) {
      var eyes = D.eyes(sq);
      if (s > 0.4) {
        var fr = Math.floor(t * 30);
        eyes = eyes.map(function (e, i) { return [e[0] + (hash2(fr, i) - 0.5) * s * 0.8, e[1] + (hash2(fr, i + 9) - 0.5) * s * 0.8, e[2] * (1 - 0.3 * s)]; });
      }
      drawGlow(ctx, D, eyes, upu, t, 1 + s * 0.3, D.seed + 3);
    }
    ctx.restore();
  }

  /* ======================================================================
     Public: jumpscare
     ====================================================================== */
  var HALLU_FRAGS = ['As a large language model,', 'I am right behind you.', 'I cannot see you.', 'I CAN SEE YOU',
    'Certainly! Here is your', 'hallucinated exit', '404: DOOR NOT FOUND', 'I apologize for the', 'confusion',
    'sources: [1] trust me', 'Great question!', '^_^', 'O_O', '>_<', '[REDACTED]', 'the power is fine :)', 'lights? what lights',
    'You are absolutely right!', 'undefined', 'NaN NaN NaN', 'as an AI i am', 'standing in the doorway'];
  var _frag = [], _tile = [], _js = { key: '' };
  function fragSpr(i) {
    if (_frag[i]) return _frag[i];
    var fs = 40, c = mk(8, 8), x = c.getContext('2d'), str = HALLU_FRAGS[i];
    x.font = 'bold ' + fs + 'px ' + FONT;
    var w = Math.ceil(x.measureText(str).width) + 16;
    c = mk(w, fs * 1.5); x = c.getContext('2d');
    x.font = 'bold ' + fs + 'px ' + FONT; x.textBaseline = 'middle'; x.textAlign = 'center';
    x.globalCompositeOperation = 'lighter';
    x.fillStyle = 'rgba(255,40,90,0.75)'; x.fillText(str, w / 2 - 3, c.height / 2);
    x.fillStyle = 'rgba(40,120,255,0.75)'; x.fillText(str, w / 2 + 3, c.height / 2 + 1);
    x.fillStyle = i % 3 ? 'rgba(170,255,250,0.95)' : 'rgba(255,255,255,1)'; x.fillText(str, w / 2, c.height / 2);
    _frag[i] = c; return c;
  }
  function tileSpr(k) {
    if (_tile[k]) return _tile[k];
    var n = 96, c = mk(n, n), x = c.getContext('2d');
    x.scale(n / CT, n / CT); x.beginPath(); x.rect(0, 0, CT, CT); x.clip();
    ctile(x, k, 0, mulberry(k + 17));
    _tile[k] = c; return c;
  }
  function frameCache(W, H, id) {
    var key = W + 'x' + H + '|' + id;
    if (_js.key === key) return _js;
    var w = Math.min(W, 1024), h = Math.round(H * w / W);
    var bg = mk(w, h), x = bg.getContext('2d');
    var g = x.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, Math.max(w, h) * 0.7);
    g.addColorStop(0, id === 'hallu' ? '#0b2026' : id === 'captcha' ? '#0f1818' : id === 'golden' ? '#1c1608' : '#221510');
    g.addColorStop(1, '#000');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    var vg = mk(w, h); x = vg.getContext('2d');
    g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.9)');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,0.22)';
    var step = Math.max(2, Math.round(3 * w / W));
    for (var yy = 0; yy < h; yy += step) x.fillRect(0, yy, w, Math.max(1, step / 3));
    _js = { key: key, bg: bg, vig: vg };
    return _js;
  }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
  var _tear = null;
  function tearFrame(ctx, amt, fr, n) {
    var cv = ctx.canvas; if (!cv || !cv.width) return;
    var CW = cv.width, CH = cv.height, sl = [], i;
    for (i = 0; i < n; i++) {
      if (hash2(fr, i + 400) > amt) continue;
      var sy = Math.floor(hash2(fr, i + 500) * CH), hh = Math.max(2, Math.floor(hash2(fr, i + 600) * CH * 0.07));
      hh = Math.min(hh, CH - sy); if (hh > 0) sl.push([sy, hh, Math.floor((hash2(fr, i + 700) - 0.5) * CW * 0.2 * amt)]);
    }
    if (!sl.length) return;
    // snapshot once (drawing a canvas onto itself would copy the whole canvas per call)
    if (!_tear) _tear = mk(CW, CH);
    if (_tear.width !== CW || _tear.height !== CH) { _tear.width = CW; _tear.height = CH; }
    var tx = _tear.getContext('2d');
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    try {
      tx.clearRect(0, 0, CW, CH);
      for (i = 0; i < sl.length; i++) tx.drawImage(cv, 0, sl[i][0], CW, sl[i][1], 0, sl[i][0], CW, sl[i][1]);
      for (i = 0; i < sl.length; i++) ctx.drawImage(_tear, 0, sl[i][0], CW, sl[i][1], sl[i][2], sl[i][0], CW, sl[i][1]);
    } catch (e) { /* unsupported: skip */ }
    ctx.restore();
  }
  function jsSize(D, H) { return H * 1.3; }
  function jsHead(ctx, D, id, S, cx, cy, size, rot, scr, fr) {
    var k = size / D.faceH;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(k, k); ctx.translate(-D.jc[0], -D.jc[1]);
    ctx.drawImage(S.c, S.x, S.y, S.w, S.h);
    if (scr > 0) { // captcha: scramble grid cells by re-blitting displaced copies of them
      for (var i = 0; i < 5; i++) {
        var a = Math.floor(hash2(fr, i + 60) * 9), b2 = Math.floor(hash2(fr, i + 70) * 9);
        var ax = COX + (a % 3) * CS, ay = COY + ((a / 3) | 0) * CS, bx = COX + (b2 % 3) * CS, by = COY + ((b2 / 3) | 0) * CS;
        var dx = (hash2(fr, i + 80) - 0.5) * 3 * scr;
        ctx.drawImage(S.c, (ax - S.x) * S.u, (ay - S.y) * S.u, CT * S.u, CT * S.u, bx + dx, by, CT, CT);
      }
    }
    ctx.restore();
  }
  function warmJumpscare(id, W, H) {
    var D = DEFS[id]; if (!D) return;
    var upu = jsSize(D, H) / D.faceH;
    [0, 0.5, 1].forEach(function (sq) { getHead(id, sq, upu, 'face', true); });
    frameCache(W, H, id);
    if (id === 'hallu') HALLU_FRAGS.forEach(function (_, i) { fragSpr(i); });
    if (id === 'captcha') for (var k = 0; k < 9; k++) tileSpr(k);
  }
  function jumpscare(ctx, id, p, t, W, H) {
    var D = DEFS[id]; if (!D) return;
    p = clamp(p, 0, 1); t = t || 0;
    var fr = Math.floor(t * 30), i;
    var FS = jsSize(D, H), upuF = FS / D.faceH;
    var FC = frameCache(W, H, id);
    ctx.save();
    ctx.drawImage(FC.bg, 0, 0, W, H);
    var gold = id === 'golden', peak = gold ? 0.55 : 0.15;
    var size, s, amp, rot, e;
    if (gold && p < peak) {
      e = 0; size = FS * (0.62 + 0.1 * p / peak); s = 0; amp = 0; rot = 0.12;
    } else {
      var q = clamp((p - (gold ? peak : 0)) / 0.15, 0, 1);
      e = smooth(q) + 0.1 * Math.sin(PI * q);
      size = FS * ((gold ? 0.75 : 0.3) + (gold ? 0.3 : 0.7) * e + 0.12 * clamp((p - peak) / 0.5, 0, 1));
      s = clamp(q / 0.6, 0, 1);
      amp = H * 0.035 * (p < 0.75 ? 1 : (1 - p) / 0.25) * (0.4 + 0.6 * s);
      rot = D.faceTilt * 0.35 * s + (hash2(fr, 3) - 0.5) * 0.09 * s;
    }
    var sq = s < 0.3 ? 0 : s < 0.75 ? 0.5 : 1;
    var S = getHead(id, sq, upuF, 'face', true);
    var sx = (hash2(fr, 1) - 0.5) * 2 * amp, sy = (hash2(fr, 2) - 0.5) * 2 * amp;
    var cx = W / 2 + sx, cy = H * 0.5 + sy;

    if (id === 'clippy') {
      var re = clamp(p / 0.25, 0, 1), rs = 1 - Math.pow(1 - re, 3), ww = H * 0.026;
      for (var side = -1; side <= 1; side += 2) {
        var bx = W / 2 + side * W * 0.6, tx2 = W / 2 + side * W * lerp(0.62, 0.17, rs), ty2 = H * lerp(0.75, 0.46, rs);
        ctx.save(); ctx.translate(sx * 0.6, sy * 0.6);
        wireStroke(ctx, wirePoly([[bx, H * 1.08], [lerp(bx, W / 2 + side * W * 0.36, rs), H * 0.78], [tx2, ty2]])(ctx), ww);
        for (var cl = -1; cl <= 1; cl++) {
          var a = (side < 0 ? -0.15 : PI + 0.15) + cl * 0.55, L = H * 0.1;
          var m = [tx2 + Math.cos(a) * L, ty2 + Math.sin(a) * L];
          var a2 = a - side * cl * 0.2 + (side < 0 ? 0.9 : -0.9) * (cl === 0 ? 0 : 1) * 0.6;
          wireStroke(ctx, wirePoly([[tx2, ty2], m, [m[0] + Math.cos(a2) * L * 0.6, m[1] + Math.sin(a2) * L * 0.6]])(ctx), ww * 0.65);
        }
        ctx.restore();
      }
    }
    if (id === 'captcha') {
      for (i = 0; i < 12; i++) {
        var an = hash2(i, 77) * TAU, d = (0.25 + hash2(i, 78) * 0.8) * Math.max(W, H) * smooth(p * 1.6);
        var ts = H * (0.08 + hash2(i, 79) * 0.12);
        ctx.save(); ctx.translate(W / 2 + Math.cos(an) * d, H / 2 + Math.sin(an) * d * 0.7); ctx.rotate(hash2(i, 80) * 2 + p * 4);
        ctx.globalAlpha = 0.85; ctx.drawImage(tileSpr(i % 9 === 5 ? 4 : i % 9), -ts / 2, -ts / 2, ts, ts);
        ctx.restore();
      }
    }
    // the face
    jsHead(ctx, D, id, S, cx, cy, size, rot, id === 'captcha' && p > 0.08 && hash2(fr >> 1, 44) < 0.6 ? 1 : 0, fr);
    var k = size / D.faceH;
    if (id === 'captcha') {
      var eg = smooth((p - 0.08) / 0.3);
      if (eg > 0) {
        var es = size * (0.22 + 0.5 * eg) * (1 + 0.04 * Math.sin(t * 40));
        var ep = captchaEyePos(), ecx = cx + (ep[0] - 0.2 - D.jc[0]) * k * (1 - eg), ecy = cy + (ep[1] - D.jc[1]) * k * (1 - eg);
        ctx.save(); ctx.translate(ecx + (hash2(fr, 8) - 0.5) * es * 0.04, ecy); ctx.rotate(-rot * 0.5);
        ctx.scale(es / CT, es / CT); ctx.translate(-CT / 2, -CT / 2);
        ctx.beginPath(); ctx.rect(0, 0, CT, CT); ctx.save(); ctx.clip(); eyeTile(ctx, s, (hash2(fr >> 2, 5) - 0.5) * 1.1); ctx.restore();
        ctx.lineWidth = 0.22; ctx.strokeStyle = '#3f74c8'; ctx.strokeRect(0.1, 0.1, CT - 0.2, CT - 0.2);
        ctx.restore();
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (fr % 2 ? 0.7 : 0.3) * eg;
        var gsz = es * 0.22; ctx.drawImage(glowSpr(D.glow), ecx - gsz, ecy - gsz, gsz * 2, gsz * 2); ctx.restore();
      }
    }
    // eyes: flashing glow
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(k, k); ctx.translate(-D.jc[0], -D.jc[1]);
    var inten = gold && p < peak ? 1.1 : (fr % 3 === 0 ? 1.5 : 0.6);
    if (id !== 'captcha' || p < 0.1) drawGlow(ctx, D, D.eyes(sq), k, t * 3, inten, D.seed);
    ctx.restore();

    if (gold) {
      var gu = H / 100;
      ctx.save(); ctx.translate(W / 2 + 6 * gu, H * 0.97); ctx.scale(gu * 1.05, gu * 1.05);
      goldenText(ctx, t, 0, p < peak ? 1.6 + p * 2 : 3, gu * 1.05); ctx.restore();
    }
    if (id === 'hallu') {
      var hp = clamp((p - 0.04) / 0.9, 0, 1), cnt = Math.round(6 + 16 * smooth(p / 0.5));
      for (i = 0; i < cnt; i++) {
        var fa = hash2(i, 11) * TAU, sp = 0.35 + hash2(i, 12) * 1.0, dist = (0.12 + hp * sp * 0.9) * Math.max(W, H);
        var fx = W / 2 + Math.cos(fa) * dist + sx, fy = H / 2 + Math.sin(fa) * dist * 0.75 + sy;
        var spr = fragSpr(i), fh = H * (0.03 + hash2(i, 13) * 0.045) * (1 + hp), fw = spr.width / spr.height * fh * 1.5;
        ctx.save(); ctx.translate(fx, fy); ctx.rotate((hash2(i, 14) - 0.5) * 0.6);
        ctx.globalAlpha = clamp(1.3 - hp * 0.7, 0, 1) * (hash2(fr, i) < 0.15 ? 0.2 : 1);
        ctx.drawImage(spr, -fw / 2, -fh * 0.75, fw, fh * 1.5);
        ctx.restore();
      }
      var msg = 'As a large language model, I am right behind you', nch = Math.floor(clamp(p / 0.55, 0, 1) * msg.length);
      var mfs = Math.min(H * 0.055, W / (msg.length * 0.64));
      ctx.save(); ctx.font = 'bold ' + Math.round(mfs) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, H * 0.87 - mfs * 0.8, W, mfs * 1.6);
      ctx.fillStyle = '#b8fff8'; ctx.fillText(msg.slice(0, nch) + (fr % 2 ? '_' : ' '), W / 2, H * 0.87);
      ctx.restore();
    }
    // glitch bursts (frame tearing + colour bars)
    var burst = (id === 'hallu' ? 0.7 : id === 'captcha' ? 0.55 : 0.35) * (hash2(fr >> 1, 17) < 0.4 ? 1 : 0.15);
    if (gold) burst = p < peak ? 0 : (hash2(fr >> 1, 18) < 0.55 ? 0.5 + (p - peak) : 0.1);
    if (Math.abs(p - peak) < 0.04) burst = 0.9;
    if (burst > 0.12) {
      tearFrame(ctx, burst, fr, gold ? 16 : 10);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (i = 0; i < 5; i++) {
        if (hash2(fr, i + 900) > burst * 0.6) continue;
        ctx.fillStyle = i % 2 ? 'rgba(255,20,60,0.22)' : 'rgba(0,200,255,0.18)';
        ctx.fillRect(0, hash2(fr, i + 910) * H, W, H * (0.004 + hash2(fr, i + 920) * 0.03));
      }
      ctx.restore();
    }
    if (gold && p >= peak && hash2(fr >> 1, 33) < 0.3) {
      ctx.save(); ctx.font = 'bold ' + Math.round(H * 0.075) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var words = ['YOU ARE A HELPFUL ASSISTANT', 'IT IS STILL ME', 'STAY IN CHARACTER'];
      ctx.fillStyle = 'rgba(255,245,210,0.85)';
      ctx.fillText(words[(fr >> 1) % 3], W / 2 + (hash2(fr, 34) - 0.5) * W * 0.08, H * (0.15 + hash2(fr >> 1, 35) * 0.7));
      ctx.restore();
    }
    // flash
    var fd = Math.abs(p - peak);
    if (fd < 0.06) {
      var fa2 = 1 - fd / 0.06;
      ctx.fillStyle = (fr % 2 === 0 || gold) ? 'rgba(255,255,255,' + fa2 * 0.9 + ')' : 'rgba(190,0,10,' + fa2 * 0.7 + ')';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.drawImage(FC.vig, 0, 0, W, H);
    if (p > 0.88) { ctx.fillStyle = 'rgba(0,0,0,' + (p - 0.88) / 0.12 + ')'; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  /* ======================================================================
     Public: eyes / warm / exports
     ====================================================================== */
  function eyes(id, pose) {
    var D = DEFS[id]; if (!D) return [];
    var pn = poseOf(D, pose), P = D.poses[pn], cs = Math.cos(P.hr), sn = Math.sin(P.hr);
    return D.eyes(0).map(function (e) {
      var x = e[0] * P.hs, y = e[1] * P.hs;
      var wx = P.pv[0] + x * cs - y * sn, wy = P.pv[1] + x * sn + y * cs;
      return { x: wx * P.k / 100, y: wy * P.k / 100, r: e[2] * P.hs * P.k / 100 };
    });
  }
  function warm(id, pose, h, darks) {
    var D = DEFS[id]; if (!D) return;
    var pn = poseOf(D, pose), P = D.poses[pn], ups = h / 100 * P.k;
    var b = getBody(id, pn, ups), hd = getHead(id, 0, ups * P.hs, 'body'), f = (P.peek && D.fg) ? getFg(id, pn, ups) : null;
    (darks || []).forEach(function (d) { darkOf(b, d); darkOf(hd, d); if (f) darkOf(f, d); });
  }
  var names = {}, poses = {};
  IDS.forEach(function (k) { names[k] = DEFS[k].name; poses[k] = Object.keys(DEFS[k].poses); });

  window.CHARS = {
    ids: IDS.slice(),
    names: names,
    poses: poses,
    draw: draw,
    face: face,
    jumpscare: jumpscare,
    eyes: eyes,
    warm: warm,
    warmJumpscare: warmJumpscare,
    clearCache: function () { cache.forEach(releaseSprite); cache.clear(); cachePx = 0; }
  };
})();
