/* Five Nights at Claudie's — the building. Office, camera rooms and the map,
   all drawn with Canvas 2D and a tiny perspective projection. Static layers
   are rendered once into offscreen canvases; only the moving parts are drawn
   per frame. */
(function () {
  'use strict';

  var FEED_W = 1400, FEED_H = 720;   // camera feeds pan across a wider frame
  var OFF_W = 1400, OFF_H = 720;     // the office too

  // ---------- small helpers ----------
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  // Projection for a camera at height camY looking straight down +Z.
  function Proj(cx, cy, F, camY) {
    return {
      cx: cx, cy: cy, F: F, camY: camY,
      p: function (X, Y, Z) { return [cx + X * F / Z, cy - (Y - camY) * F / Z]; },
      s: function (Z) { return F / Z; }
    };
  }
  function poly(ctx, pts, fill, stroke, lw) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }
  // Map an image onto a parallelogram given three projected corners.
  function imgQuad(ctx, img, tl, tr, bl) {
    ctx.save();
    ctx.setTransform(
      (tr[0] - tl[0]) / img.width, (tr[1] - tl[1]) / img.width,
      (bl[0] - tl[0]) / img.height, (bl[1] - tl[1]) / img.height,
      tl[0], tl[1]);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }
  function grime(ctx, x, y, w, h, n, r, seed, color) {
    var R = rng(seed);
    ctx.save();
    for (var i = 0; i < n; i++) {
      var px = x + R() * w, py = y + R() * h, rad = 2 + R() * r;
      var g = ctx.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, color || 'rgba(20,14,8,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }
  function vignette(ctx, w, h, cx, cy, r0, r1, a) {
    var g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + a + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  function lightPool(ctx, x, y, r, color) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  function txt(ctx, s, x, y, font, color, align) {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y);
  }

  // ---------- 3D room shell ----------
  // o: {w, H, d, zn, wall, wallLow, band, floorA, floorB, ceil, tile}
  function shell(ctx, P, o) {
    var w2 = o.w / 2, H = o.H, d = o.d, zn = o.zn || 0.35;
    var tile = o.tile || 0.5;
    // ceiling
    poly(ctx, [P.p(-w2, H, zn), P.p(w2, H, zn), P.p(w2, H, d), P.p(-w2, H, d)], o.ceil || '#111');
    // ceiling tiles
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
    for (var z = Math.ceil(zn); z <= d; z += 1) {
      var a = P.p(-w2, H, z), b = P.p(w2, H, z);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    // back wall
    poly(ctx, [P.p(-w2, 0, d), P.p(w2, 0, d), P.p(w2, H, d), P.p(-w2, H, d)], o.wall);
    poly(ctx, [P.p(-w2, 0, d), P.p(w2, 0, d), P.p(w2, 1.0, d), P.p(-w2, 1.0, d)], o.wallLow || o.wall);
    // side walls, darker
    [-1, 1].forEach(function (s) {
      var X = s * w2;
      poly(ctx, [P.p(X, 0, zn), P.p(X, 0, d), P.p(X, H, d), P.p(X, H, zn)], o.wall);
      poly(ctx, [P.p(X, 0, zn), P.p(X, 0, d), P.p(X, 1.0, d), P.p(X, 1.0, zn)], o.wallLow || o.wall);
      poly(ctx, [P.p(X, 0, zn), P.p(X, 0, d), P.p(X, H, d), P.p(X, H, zn)], 'rgba(0,0,0,0.28)');
    });
    // floor checker
    var nx = Math.ceil(o.w / tile);
    for (var zi = 0; zn + zi * tile < d; zi++) {
      var z0 = Math.max(zn, zn + zi * tile), z1 = Math.min(d, z0 + tile);
      for (var xi = 0; xi < nx; xi++) {
        var x0 = -w2 + xi * tile, x1 = Math.min(w2, x0 + tile);
        poly(ctx, [P.p(x0, 0, z0), P.p(x1, 0, z0), P.p(x1, 0, z1), P.p(x0, 0, z1)],
          ((xi + zi) % 2) ? (o.floorA || '#cfc8b8') : (o.floorB || '#1a1a1c'));
      }
    }
    // checker band along the walls (the pizzeria stripe)
    if (o.band !== false) {
      var bh = 0.12, by = 1.0, bt = 0.2;
      for (var k = 0; k * bt < o.w; k++) {
        var bx0 = -w2 + k * bt, bx1 = bx0 + bt;
        for (var r = 0; r < 2; r++) {
          poly(ctx, [P.p(bx0, by + r * bh / 2, d), P.p(bx1, by + r * bh / 2, d), P.p(bx1, by + (r + 1) * bh / 2, d), P.p(bx0, by + (r + 1) * bh / 2, d)],
            ((k + r) % 2) ? '#d8d0c0' : '#161616');
        }
      }
      [-1, 1].forEach(function (s) {
        var X = s * w2;
        for (var k2 = 0; zn + k2 * bt < d; k2++) {
          var za = zn + k2 * bt, zb = Math.min(d, za + bt);
          for (var r2 = 0; r2 < 2; r2++) {
            poly(ctx, [P.p(X, by + r2 * bh / 2, za), P.p(X, by + r2 * bh / 2, zb), P.p(X, by + (r2 + 1) * bh / 2, zb), P.p(X, by + (r2 + 1) * bh / 2, za)],
              ((k2 + r2) % 2) ? '#b9b1a2' : '#141414');
          }
        }
      });
    }
  }
  // An axis-aligned box: draws front, top (if below the eye) and the side facing the camera.
  function box(ctx, P, x0, x1, y0, y1, z0, z1, col, top, side) {
    if (y1 < P.camY) poly(ctx, [P.p(x0, y1, z0), P.p(x1, y1, z0), P.p(x1, y1, z1), P.p(x0, y1, z1)], top || col);
    if (x1 < 0) poly(ctx, [P.p(x1, y0, z0), P.p(x1, y0, z1), P.p(x1, y1, z1), P.p(x1, y1, z0)], side || shade(col, -0.3));
    if (x0 > 0) poly(ctx, [P.p(x0, y0, z0), P.p(x0, y0, z1), P.p(x0, y1, z1), P.p(x0, y1, z0)], side || shade(col, -0.3));
    poly(ctx, [P.p(x0, y0, z0), P.p(x1, y0, z0), P.p(x1, y1, z0), P.p(x0, y1, z0)], col);
  }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var m = f < 0 ? 0 : 255, k = Math.abs(f);
    r = Math.round(r + (m - r) * k); g = Math.round(g + (m - g) * k); b = Math.round(b + (m - b) * k);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  // Party table with a checked cloth and cone hats.
  function partyTable(ctx, P, xc, zc, len, seed) {
    var R = rng(seed);
    var x0 = xc - 0.45, x1 = xc + 0.45, z0 = zc, z1 = zc + len;
    box(ctx, P, x0 + 0.05, x1 - 0.05, 0, 0.72, z0 + 0.05, z1 - 0.05, '#2a2622', '#3b3530');
    // cloth
    var cols = 8, rows = Math.round(len / 0.15);
    for (var i = 0; i < cols; i++) for (var j = 0; j < rows; j++) {
      var a = x0 + (x1 - x0) * i / cols, b = x0 + (x1 - x0) * (i + 1) / cols;
      var c = z0 + len * j / rows, d = z0 + len * (j + 1) / rows;
      poly(ctx, [P.p(a, 0.75, c), P.p(b, 0.75, c), P.p(b, 0.75, d), P.p(a, 0.75, d)], ((i + j) % 2) ? '#bfb6a8' : '#7a2c2c');
    }
    // cloth drop at the front
    poly(ctx, [P.p(x0, 0.75, z0), P.p(x1, 0.75, z0), P.p(x1, 0.55, z0), P.p(x0, 0.55, z0)], '#6a2424');
    // hats + plates
    for (var k = 0; k < len / 0.55; k++) {
      [x0 + 0.15, x1 - 0.15].forEach(function (hx) {
        var hz = z0 + 0.3 + k * 0.55 + R() * 0.1;
        if (hz > z1 - 0.1) return;
        var base = P.p(hx, 0.75, hz), tip = P.p(hx, 0.95, hz), s = P.s(hz) * 0.06;
        var hues = ['#c2452b', '#2b6cc2', '#c2a12b', '#6a2bc2', '#2bc27c'];
        poly(ctx, [[base[0] - s, base[1]], [base[0] + s, base[1]], tip], hues[Math.floor(R() * hues.length)]);
        ctx.fillStyle = '#e8e2d6';
        ctx.beginPath(); ctx.arc(tip[0], tip[1], Math.max(1, s * 0.25), 0, 7); ctx.fill();
        var pl = P.p(hx + (hx < xc ? 0.12 : -0.12), 0.76, hz + 0.1);
        ctx.fillStyle = '#d9d4cb';
        ctx.beginPath(); ctx.ellipse(pl[0], pl[1], P.s(hz) * 0.07, P.s(hz) * 0.025, 0, 0, 7); ctx.fill();
      });
    }
  }
  // Poster canvas with text lines.
  function posterCanvas(w, h, bg, lines, fg, seed) {
    var c = canvas(w, h), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    x.strokeStyle = 'rgba(0,0,0,0.5)'; x.lineWidth = 4; x.strokeRect(2, 2, w - 4, h - 4);
    var y = h * 0.14;
    lines.forEach(function (L) {
      var font = L[1], m = /(\d+)px/.exec(font), size = m ? +m[1] : 20;
      x.font = font;
      while (size > 8 && x.measureText(L[0]).width > w * 0.9) { size--; font = font.replace(/\d+px/, size + 'px'); x.font = font; }
      txt(x, L[0], w / 2, L[3] === 0 ? h / 2 : y, font, L[2] || fg);
      y += L[3] || h * 0.16;
    });
    grime(x, 0, 0, w, h, 30, w * 0.08, seed || 3);
    // torn corner
    x.fillStyle = 'rgba(0,0,0,0.6)';
    x.beginPath(); x.moveTo(w, h); x.lineTo(w - w * 0.18, h); x.lineTo(w, h - h * 0.12); x.fill();
    return c;
  }
  // Crayon drawing of a character by a child.
  function kidDrawing(w, h, seed, label, col) {
    var c = canvas(w, h), x = c.getContext('2d'), R = rng(seed);
    x.fillStyle = '#e9e3d2'; x.fillRect(0, 0, w, h);
    x.lineCap = 'round'; x.lineWidth = 3;
    function scrib(fn) { x.beginPath(); fn(); x.stroke(); }
    x.strokeStyle = col;
    var cx = w * (0.4 + R() * 0.2), cy = h * 0.4;
    scrib(function () { x.arc(cx, cy, h * 0.16, 0, 7); });
    scrib(function () { x.moveTo(cx, cy + h * 0.16); x.lineTo(cx, cy + h * 0.45); });
    scrib(function () { x.moveTo(cx - w * 0.2, cy + h * 0.25); x.lineTo(cx + w * 0.2, cy + h * 0.25); });
    scrib(function () { x.moveTo(cx, cy + h * 0.45); x.lineTo(cx - w * 0.12, cy + h * 0.6); x.moveTo(cx, cy + h * 0.45); x.lineTo(cx + w * 0.12, cy + h * 0.6); });
    x.strokeStyle = '#111';
    scrib(function () { x.arc(cx - h * 0.05, cy - h * 0.03, 2, 0, 7); x.moveTo(cx + h * 0.07, cy - h * 0.03); x.arc(cx + h * 0.05, cy - h * 0.03, 2, 0, 7); });
    scrib(function () { x.arc(cx, cy + h * 0.02, h * 0.1, 0.1, Math.PI - 0.1); });
    x.strokeStyle = '#c33'; x.lineWidth = 2;
    txt(x, label, w / 2, h * 0.9, 'bold ' + Math.round(h * 0.09) + 'px Comic Sans MS, cursive, sans-serif', '#b22');
    // sun in corner
    x.strokeStyle = '#d9a400';
    scrib(function () { x.arc(w * 0.12, h * 0.12, h * 0.06, 0, 7); });
    return c;
  }

  // ---------- camera rooms ----------
  // Each room: build(ctx, P) draws the static layer; spots map character ids
  // to [X, Z, pose]; light is an optional [x, y, r] light pool.
  var CAMS = [
    { id: '1A', key: 'stage', name: 'Show Stage' },
    { id: '1B', key: 'dining', name: 'Dining Area' },
    { id: '1C', key: 'cove', name: 'Verification Cove' },
    { id: '5', key: 'backstage', name: 'Backstage' },
    { id: '7', key: 'restroom', name: 'Restrooms' },
    { id: '6', key: 'kitchen', name: 'Kitchen', audioOnly: true },
    { id: '3', key: 'closet', name: 'Server Closet' },
    { id: '2A', key: 'whall', name: 'West Hall' },
    { id: '2B', key: 'wcorner', name: 'W. Hall Corner' },
    { id: '4A', key: 'ehall', name: 'East Hall' },
    { id: '4B', key: 'ecorner', name: 'E. Hall Corner' },
    { id: '11', key: 'cam11', name: 'Camera 11', fake: true }
  ];
  var CAM_BY_KEY = {};
  CAMS.forEach(function (c) { CAM_BY_KEY[c.key] = c; });

  var ROOMDEF = {};
  var cache = {};

  ROOMDEF.stage = {
    P: Proj(700, 250, 620, 2.5),
    dark: 0.25,
    spots: { claudie: [0, 5.1, 'stand'], hallu: [-1.6, 5.3, 'stand'], clippy: [1.6, 5.3, 'stand'] },
    build: function (ctx, P) {
      shell(ctx, P, { w: 8, H: 4, d: 6.5, wall: '#241a2c', wallLow: '#1c1422', ceil: '#0c0a0e', floorA: '#b8b0a0', floorB: '#191919' });
      // curtains at the back with stars
      var R = rng(11);
      poly(ctx, [P.p(-4, 0.9, 6.4), P.p(4, 0.9, 6.4), P.p(4, 4, 6.4), P.p(-4, 4, 6.4)], '#3b1a4f');
      for (var i = 0; i < 40; i++) {
        var a = P.p(-4 + i * 0.2, 0.9, 6.4), b = P.p(-4 + i * 0.2, 4, 6.4);
        ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,0.35)' : 'rgba(150,90,190,0.12)';
        ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      for (var s = 0; s < 26; s++) star(ctx, P.p(-3.8 + R() * 7.6, 1.3 + R() * 2.5, 6.39), 6 + R() * 8, '#d9b44a');
      // stage platform
      box(ctx, P, -4, 4, 0, 0.9, 4.2, 6.5, '#3a2a1c', '#5a4028');
      for (var k = 0; k < 16; k++) {
        var p0 = P.p(-4 + k * 0.5, 0.9, 4.2), p1 = P.p(-4 + k * 0.5, 0.9, 6.5);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
      }
      // banner
      var ban = posterCanvas(700, 90, '#7b1f1f', [["CLAUDIE & FRIENDS · ASK ME ANYTHING!", 'bold 44px Georgia, serif', '#f2d27a', 0]], '#fff', 5);
      imgQuad(ctx, ban, P.p(-2.8, 3.6, 6.38), P.p(2.8, 3.6, 6.38), P.p(-2.8, 3.1, 6.38));
      // footlights
      for (var f = 0; f < 9; f++) {
        var fp = P.p(-3.6 + f * 0.9, 0.95, 4.25);
        lightPool(ctx, fp[0], fp[1], 26, 'rgba(255,220,150,0.5)');
      }
      // speakers
      box(ctx, P, -3.9, -3.2, 0.9, 2.3, 5.4, 5.9, '#151515');
      box(ctx, P, 3.2, 3.9, 0.9, 2.3, 5.4, 5.9, '#151515');
      partyTable(ctx, P, -1.2, 1.6, 2.0, 12);
      partyTable(ctx, P, 1.2, 1.6, 2.0, 13);
    },
    light: [700, 330, 520],
    tint: 'rgba(60,20,70,0.10)'
  };
  ROOMDEF.stage.spots.claudie[1] = 5.2;
  // characters stand on the platform; the platform top is at Y=0.9
  ROOMDEF.stage.floorY = 0.9;

  ROOMDEF.dining = {
    P: Proj(700, 230, 560, 2.7),
    dark: 0.45,
    spots: { claudie: [0.2, 7.4, 'stand'], hallu: [-1.6, 5.2, 'stand'], clippy: [1.8, 4.6, 'stand'] },
    build: function (ctx, P) {
      shell(ctx, P, { w: 9, H: 3.6, d: 10, wall: '#2c2a36', wallLow: '#3d2320', ceil: '#0d0d10', floorA: '#bfb8a8', floorB: '#1b1b1d' });
      // streamers
      var R = rng(21);
      for (var i = 0; i < 7; i++) {
        var z = 2.5 + i * 1.1;
        ctx.strokeStyle = ['#b33', '#36b', '#bb3', '#3b6', '#a3b'][i % 5]; ctx.lineWidth = 3;
        ctx.beginPath();
        for (var k = 0; k <= 20; k++) {
          var X = -4.5 + 9 * k / 20, Y = 3.5 - Math.sin(k / 20 * Math.PI * 3) * 0.2 - 0.15;
          var q = P.p(X, Y, z);
          if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
        }
        ctx.stroke();
      }
      partyTable(ctx, P, -2.2, 3.0, 5.5, 22);
      partyTable(ctx, P, 0, 3.4, 5.0, 23);
      partyTable(ctx, P, 2.2, 3.0, 5.5, 24);
      // posters on back wall
      var p1 = posterCanvas(200, 280, '#1f3a5c', [["CELEBRATE!", 'bold 34px Georgia, serif', '#f5d76e', 50], ['every day is', '18px Georgia, serif', '#ddd', 26], ['your birthday', '18px Georgia, serif', '#ddd', 26], ['(forever)', 'italic 16px Georgia, serif', '#aaa', 30]], '#fff', 31);
      imgQuad(ctx, p1, P.p(-3.5, 2.9, 9.98), P.p(-2.3, 2.9, 9.98), P.p(-3.5, 1.3, 9.98));
      var p2 = posterCanvas(200, 280, '#5c1f1f', [['PLEASE', 'bold 30px Georgia, serif', '#fff', 40], ['do not ask', '18px Georgia, serif', '#ddd', 26], ['Claudie to', '18px Georgia, serif', '#ddd', 26], ['forget you', '18px Georgia, serif', '#ddd', 26]], '#fff', 32);
      imgQuad(ctx, p2, P.p(2.3, 2.9, 9.98), P.p(3.5, 2.9, 9.98), P.p(2.3, 1.3, 9.98));
      // kids' drawings on the left wall
      for (var d = 0; d < 4; d++) {
        var kd = kidDrawing(120, 150, 40 + d, ['CLAUDIE', 'HALU', 'CLIPY', 'MY DAD?'][d], ['#c75a1f', '#5a3fb5', '#888', '#2a2'][d]);
        imgQuad(ctx, kd, P.p(-4.49, 2.3, 3.2 + d * 1.2), P.p(-4.49, 2.3, 3.9 + d * 1.2), P.p(-4.49, 1.5, 3.2 + d * 1.2));
      }
      grime(ctx, 0, 380, FEED_W, 340, 40, 60, 25, 'rgba(0,0,0,0.25)');
      R();
    },
    light: [700, 380, 600],
    tint: 'rgba(20,20,40,0.12)'
  };

  ROOMDEF.cove = {
    P: Proj(700, 260, 600, 2.3),
    dark: 0.35,
    spots: {},
    build: function (ctx, P) {
      shell(ctx, P, { w: 6, H: 3.4, d: 6, wall: '#2a2230', wallLow: '#1f1a24', ceil: '#0a0a0c', floorA: '#b0a898', floorB: '#171717' });
      box(ctx, P, -2.4, 2.4, 0, 0.6, 3.6, 6, '#2c2018', '#44301f');
      var sign = posterCanvas(360, 170, '#d8d0b0', [['SORRY! OUT OF ORDER', 'bold 30px Georgia, serif', '#8b1a1a', 52], ['ARE YOU A ROBOT?  ☐', 'bold 26px monospace', '#222', 50], ['please verify to proceed', 'italic 18px Georgia, serif', '#444', 30]], '#222', 41);
      imgQuad(ctx, sign, P.p(-0.62, 0.57, 3.59), P.p(0.62, 0.57, 3.59), P.p(-0.62, 0.03, 3.59));
    },
    // curtains are drawn per frame (they open)
    light: [700, 300, 480],
    tint: 'rgba(0,40,40,0.10)'
  };

  function hall(seed, mirror, posters) {
    return {
      P: Proj(700, 250, 560, 2.5),
      dark: 0.55,
      spots: mirror ? { claudie: [0.1, 7.5, 'stand'], clippy: [-0.2, 5.0, 'stand'] } : { hallu: [0.2, 6.2, 'stand'] },
      build: function (ctx, P) {
        shell(ctx, P, { w: 2.6, H: 3.0, d: 16, wall: mirror ? '#2e2a26' : '#27282e', wallLow: '#1c1b1b', ceil: '#0a0a0a', floorA: '#a8a090', floorB: '#141414' });
        // far door (dark)
        poly(ctx, [P.p(-0.6, 0, 15.98), P.p(0.6, 0, 15.98), P.p(0.6, 2.2, 15.98), P.p(-0.6, 2.2, 15.98)], '#050505');
        // ceiling lamps
        for (var z = 2; z < 16; z += 3) {
          var a = P.p(-0.3, 2.98, z), b = P.p(0.3, 2.98, z + 0.4);
          ctx.fillStyle = 'rgba(210,220,190,0.35)'; ctx.fillRect(a[0], a[1], b[0] - a[0], Math.max(2, b[1] - a[1]));
        }
        // posters on walls
        posters.forEach(function (pp, i) {
          var X = (i % 2 ? 1.29 : -1.29), z0 = 2.2 + i * 1.6;
          var tl = P.p(X, 2.3, z0), tr = P.p(X, 2.3, z0 + 0.7), bl = P.p(X, 1.3, z0);
          imgQuad(ctx, pp, tl, tr, bl);
        });
        // cables along the ceiling
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 3;
        ctx.beginPath();
        for (var k = 0; k <= 30; k++) {
          var q = P.p(mirror ? 1.1 : -1.1, 2.85 - Math.abs(Math.sin(k * 0.9)) * 0.12, 0.6 + k * 0.5);
          if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
        }
        ctx.stroke();
        grime(ctx, 0, 0, FEED_W, FEED_H, 50, 50, seed, 'rgba(0,0,0,0.25)');
      },
      light: [700, 300, 360],
      depthFog: true,
      tint: mirror ? 'rgba(40,30,10,0.12)' : 'rgba(10,20,40,0.12)'
    };
  }
  function hallPosters(mirror) {
    if (mirror) return [
      kidDrawing(120, 150, 71, 'CLIPY!!', '#999'),
      posterCanvas(140, 200, '#20402a', [['BE KIND', 'bold 24px Georgia, serif', '#fff', 36], ['TO YOUR', '18px Georgia, serif', '#cfc', 24], ['ASSISTANT', 'bold 18px Georgia, serif', '#cfc', 30], ['it remembers', 'italic 14px Georgia, serif', '#8a8', 20]], '#fff', 72),
      kidDrawing(120, 150, 73, 'CLAUDE', '#c75a1f'),
      kidDrawing(120, 150, 74, 'HELP', '#222')
    ];
    return [
      posterCanvas(140, 200, '#3a1f5c', [['CAM 11', 'bold 26px monospace', '#f0f', 36], ['does not', '18px Georgia, serif', '#ddd', 24], ['exist', 'bold 20px Georgia, serif', '#ddd', 30], ['(stop asking)', 'italic 14px Georgia, serif', '#aaa', 22]], '#fff', 61),
      kidDrawing(120, 150, 62, 'HALU', '#5a3fb5'),
      posterCanvas(140, 200, '#5c3a1f', [['EMPLOYEE', 'bold 20px Georgia, serif', '#fff', 30], ['OF THE', '16px Georgia, serif', '#ddd', 22], ['MONTH', 'bold 22px Georgia, serif', '#fff', 30], ['[REDACTED]', 'bold 16px monospace', '#000', 30]], '#fff', 63),
      kidDrawing(120, 150, 64, 'THE CURTAN', '#2a8a86')
    ];
  }

  function corner(seed, mirror) {
    return {
      P: Proj(700, 230, 520, 2.6),
      dark: 0.5,
      spots: mirror ? { claudie: [0.3, 2.2, 'lean'], clippy: [0.3, 2.2, 'lean'] } : { hallu: [-0.3, 2.1, 'lean'] },
      build: function (ctx, P) {
        shell(ctx, P, { w: 3.2, H: 3.0, d: 4.2, wall: mirror ? '#2e2a26' : '#27282e', wallLow: '#1c1b1b', ceil: '#0a0a0a', floorA: '#a8a090', floorB: '#141414' });
        // doorway to office at back
        poly(ctx, [P.p(-0.7, 0, 4.18), P.p(0.7, 0, 4.18), P.p(0.7, 2.3, 4.18), P.p(-0.7, 2.3, 4.18)], '#030303');
        // the poster (the rules; golden variant drawn at runtime)
        var rules = posterCanvas(180, 250, '#e3dcc6', [['RULES', 'bold 30px Georgia, serif', '#8b1a1a', 34], ['1. No running', '15px Georgia, serif', '#222', 22], ['2. No yelling', '15px Georgia, serif', '#222', 22], ['3. No unplugging', '15px Georgia, serif', '#222', 22], ['4. Do not verify', '15px Georgia, serif', '#222', 22], ['    the curtain', '15px Georgia, serif', '#222', 22], ['5. Smile back', 'bold 15px Georgia, serif', '#8b1a1a', 22]], '#222', seed);
        var X = mirror ? -1.59 : 1.59;
        imgQuad(ctx, rules, P.p(X, 2.4, 2.1), P.p(X, 2.4, 3.0), P.p(X, 1.2, 2.1));
        grime(ctx, 0, 0, FEED_W, FEED_H, 50, 60, seed + 1, 'rgba(0,0,0,0.3)');
      },
      poster: mirror ? null : [1.59, 2.4, 1.2, 2.1, 3.0],
      light: [700, 280, 420],
      tint: 'rgba(0,0,0,0.1)'
    };
  }

  ROOMDEF.whall = hall(51, false, []);
  ROOMDEF.ehall = hall(52, true, []);
  ROOMDEF.wcorner = corner(53, false);
  ROOMDEF.ecorner = corner(54, true);

  ROOMDEF.closet = {
    P: Proj(700, 260, 600, 2.3),
    dark: 0.55,
    spots: { hallu: [0.1, 3.3, 'stand'] },
    build: function (ctx, P) {
      shell(ctx, P, { w: 3.4, H: 3.0, d: 4.5, wall: '#1d2124', wallLow: '#16191b', ceil: '#080808', floorA: '#8c8678', floorB: '#121212', band: false });
      // server racks
      var R = rng(81);
      [[-1.65, -0.95], [0.95, 1.65]].forEach(function (xs) {
        box(ctx, P, xs[0], xs[1], 0, 2.4, 1.2, 4.3, '#121416', '#1a1d20', '#1e2226');
        var X = xs[0] < 0 ? xs[1] : xs[0];
        for (var u = 0; u < 22; u++) for (var z = 0; z < 6; z++) {
          var q = P.p(X, 0.2 + u * 0.1, 1.4 + z * 0.5);
          var on = R() < 0.35;
          ctx.fillStyle = on ? (R() < 0.8 ? 'rgba(80,255,120,0.9)' : 'rgba(255,80,60,0.9)') : 'rgba(40,60,50,0.6)';
          ctx.fillRect(q[0], q[1], 3, 2);
        }
      });
      // mop and bucket
      box(ctx, P, 0.4, 0.8, 0, 0.4, 4.0, 4.3, '#5a5a20');
      var m0 = P.p(0.55, 0.4, 4.1), m1 = P.p(0.2, 2.0, 4.2);
      ctx.strokeStyle = '#6b5130'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(m0[0], m0[1]); ctx.lineTo(m1[0], m1[1]); ctx.stroke();
      // cable spaghetti on the floor
      ctx.lineWidth = 3;
      for (var c = 0; c < 9; c++) {
        ctx.strokeStyle = ['#223', '#322', '#232', '#111'][c % 4];
        ctx.beginPath();
        var st = P.p(-0.9 + R() * 1.8, 0, 1.3 + R() * 3);
        ctx.moveTo(st[0], st[1]);
        for (var k = 0; k < 4; k++) { var e = P.p(-0.9 + R() * 1.8, 0, 1.3 + R() * 3); ctx.quadraticCurveTo(st[0] + (R() - 0.5) * 200, st[1] + (R() - 0.5) * 60, e[0], e[1]); st = e; }
        ctx.stroke();
      }
      var lbl = posterCanvas(220, 60, '#caa42a', [['⚠ TRAINING DATA ⚠', 'bold 20px monospace', '#111', 0]], '#111', 83);
      imgQuad(ctx, lbl, P.p(-0.55, 2.6, 4.48), P.p(0.55, 2.6, 4.48), P.p(-0.55, 2.3, 4.48));
    },
    light: [700, 280, 330],
    tint: 'rgba(0,40,20,0.12)'
  };

  ROOMDEF.backstage = {
    P: Proj(700, 250, 600, 2.4),
    dark: 0.5,
    spots: { hallu: [0.4, 3.0, 'lean'] },
    build: function (ctx, P) {
      shell(ctx, P, { w: 5, H: 3.0, d: 4.2, wall: '#262024', wallLow: '#1b1719', ceil: '#0a0a0a', floorA: '#8e887a', floorB: '#131313' });
      // shelves
      box(ctx, P, -2.4, 2.4, 1.2, 1.28, 3.6, 4.2, '#3b2f25', '#4e3e30');
      box(ctx, P, -2.4, 2.4, 2.1, 2.18, 3.6, 4.2, '#3b2f25', '#4e3e30');
      // workbench
      box(ctx, P, -2.3, -0.6, 0, 0.9, 2.2, 3.0, '#2b2622', '#3e3730');
      var R = rng(91);
      for (var i = 0; i < 10; i++) {
        var q = P.p(-2.2 + R() * 1.5, 0.92, 2.3 + R() * 0.6);
        ctx.fillStyle = ['#666', '#8a6', '#a55', '#aa6'][i % 4];
        ctx.fillRect(q[0], q[1] - 4, 6 + R() * 10, 4);
      }
      var lbl = posterCanvas(260, 70, '#e3dcc6', [['SPARE HEADS — DO NOT PROMPT', 'bold 18px monospace', '#8b1a1a', 0]], '#222', 92);
      imgQuad(ctx, lbl, P.p(-1.1, 2.75, 4.18), P.p(1.1, 2.75, 4.18), P.p(-1.1, 2.45, 4.18));
    },
    heads: true,
    light: [700, 250, 420],
    tint: 'rgba(40,10,10,0.1)'
  };

  ROOMDEF.restroom = {
    P: Proj(700, 250, 580, 2.5),
    dark: 0.45,
    spots: { claudie: [0.6, 5.0, 'stand'], clippy: [-0.6, 3.6, 'stand'] },
    build: function (ctx, P) {
      shell(ctx, P, { w: 4, H: 3.0, d: 7, wall: '#2a3434', wallLow: '#344040', ceil: '#0b0d0d', floorA: '#9aa6a2', floorB: '#1a2020', tile: 0.35, band: false });
      // stalls on the right
      for (var s = 0; s < 3; s++) {
        var z0 = 2.2 + s * 1.5;
        box(ctx, P, 1.1, 1.14, 0.2, 2.0, z0, z0 + 1.4, '#3e4a55');
        poly(ctx, [P.p(1.1, 0.2, z0 + 0.1), P.p(1.1, 0.2, z0 + 1.2), P.p(1.1, 2.0, z0 + 1.2), P.p(1.1, 2.0, z0 + 0.1)], s === 1 ? '#27313a' : '#46535f');
      }
      // sinks on the left
      for (var k = 0; k < 3; k++) {
        box(ctx, P, -2, -1.6, 0.8, 0.95, 2.5 + k * 1.3, 3.1 + k * 1.3, '#b8c0c0');
        var m = P.p(-1.99, 2.1, 2.4 + k * 1.3), m2 = P.p(-1.99, 2.1, 3.2 + k * 1.3), m3 = P.p(-1.99, 1.3, 2.4 + k * 1.3);
        var mc = canvas(40, 40), mx = mc.getContext('2d');
        mx.fillStyle = '#4a5a60'; mx.fillRect(0, 0, 40, 40); mx.fillStyle = 'rgba(255,255,255,0.1)'; mx.fillRect(4, 4, 10, 32);
        imgQuad(ctx, mc, m, m2, m3);
      }
      var sign = posterCanvas(260, 110, '#e3dcc6', [['WASH YOUR HANDS', 'bold 24px Georgia, serif', '#1f3a5c', 40], ['(Claudie is watching)', 'italic 18px Georgia, serif', '#444', 30]], '#222', 95);
      imgQuad(ctx, sign, P.p(-0.9, 2.5, 6.98), P.p(0.9, 2.5, 6.98), P.p(-0.9, 1.8, 6.98));
    },
    light: [700, 300, 520],
    tint: 'rgba(0,30,30,0.12)'
  };

  ROOMDEF.cam11 = {
    P: Proj(700, 300, 500, 2.0),
    dark: 0.3,
    spots: { hallu: [0, 4.2, 'stand'] },
    build: function (ctx, P) {
      // An impossible room: the checker floor goes on forever, a doorway inside a doorway.
      ctx.fillStyle = '#0b0614'; ctx.fillRect(0, 0, FEED_W, FEED_H);
      var tile = 0.6;
      for (var zi = 0; zi < 80; zi++) {
        var z0 = 0.6 + zi * tile, z1 = z0 + tile;
        for (var xi = -14; xi < 14; xi++) {
          poly(ctx, [P.p(xi * tile, 0, z0), P.p((xi + 1) * tile, 0, z0), P.p((xi + 1) * tile, 0, z1), P.p(xi * tile, 0, z1)], ((xi + zi) % 2) ? '#6b5a8a' : '#120a1c');
        }
      }
      for (var d = 0; d < 9; d++) {
        var z = 3 + d * d * 1.3, w = 1.2, h = 2.6;
        poly(ctx, [P.p(-w, 0, z), P.p(w, 0, z), P.p(w, h, z), P.p(-w, h, z)], null, 'rgba(210,150,255,' + (0.6 - d * 0.06) + ')', 3);
      }
      var g = ctx.createLinearGradient(0, 0, 0, 300);
      g.addColorStop(0, 'rgba(140,40,200,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, FEED_W, 300);
    },
    light: [700, 360, 700],
    tint: 'rgba(90,0,140,0.12)'
  };

  function star(ctx, p, r, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(p[0] + Math.cos(a) * rr, p[1] + Math.sin(a) * rr);
    }
    ctx.fill();
  }

  // Build (once) and return the static layer for a room.
  function roomLayer(key) {
    if (cache[key]) return cache[key];
    var def = ROOMDEF[key];
    var c = canvas(FEED_W, FEED_H), ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, FEED_W, FEED_H);
    if (key === 'whall') def = ROOMDEF.whall = hallWithPosters(false);
    if (key === 'ehall') def = ROOMDEF.ehall = hallWithPosters(true);
    def.build(ctx, def.P);
    cache[key] = c;
    return c;
  }
  function hallWithPosters(mirror) {
    var h = hall(mirror ? 52 : 51, mirror, hallPosters(mirror));
    return h;
  }

  // Lighting pass drawn over characters, so they sit in the same darkness.
  var lightCache = {};
  function lightLayer(key) {
    if (lightCache[key]) return lightCache[key];
    var def = ROOMDEF[key];
    var c = canvas(FEED_W, FEED_H), ctx = c.getContext('2d');
    if (def.tint) { ctx.fillStyle = def.tint; ctx.fillRect(0, 0, FEED_W, FEED_H); }
    var L = def.light;
    var g = ctx.createRadialGradient(L[0], L[1], L[2] * 0.15, L[0], L[1], L[2] * 1.6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0.95)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, FEED_W, FEED_H);
    if (def.depthFog) {
      var P = def.P, top = P.p(0, 3, 9)[1], bot = P.p(0, 0, 9)[1];
      var p0 = P.p(-1.3, 0, 9), p1 = P.p(1.3, 0, 9);
      var fg = ctx.createRadialGradient(700, (top + bot) / 2, 10, 700, (top + bot) / 2, (p1[0] - p0[0]) * 1.2);
      fg.addColorStop(0, 'rgba(0,0,0,0.92)');
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg; ctx.fillRect(0, 0, FEED_W, FEED_H);
    }
    lightCache[key] = c;
    return c;
  }

  function drawHeads(ctx, t, watchedSince) {
    // Spare Claudie heads on the backstage shelves. One of them turns to face you
    // if you stare long enough.
    if (!window.CHARS) return;
    var P = ROOMDEF.backstage.P;
    for (var i = 0; i < 5; i++) {
      var X = -1.9 + i * 0.95, Y = 1.28, Z = 3.95;
      var p = P.p(X, Y, Z), s = P.s(Z) * 0.62;
      var id = i === 2 ? 'hallu' : (i === 4 ? 'captcha' : 'claudie');
      var turned = i === 3 && watchedSince > 6 && Math.floor(t * 0.5) % 7 === 0;
      CHARS.face(ctx, id, p[0], p[1] - s * 0.45, s, { t: t, dark: 0.55, glow: turned, glitch: turned ? 0.4 : 0 });
    }
  }

  function drawCurtains(ctx, P, open, t) {
    // open 0..1, two curtain halves over the cove stage
    var zc = 3.62, top = 3.2, bot = 0.6;
    var sway = Math.sin(t * 0.7) * 0.02;
    [-1, 1].forEach(function (s) {
      var inner = s * (0.02 + open * 1.6), outer = s * 2.6;
      var x0 = Math.min(inner, outer), x1 = Math.max(inner, outer);
      var q = [P.p(x0, bot, zc), P.p(x1, bot, zc), P.p(x1, top, zc), P.p(x0, top, zc)];
      poly(ctx, q, '#4a1a5c');
      var n = 14;
      for (var i = 0; i < n; i++) {
        var X = x0 + (x1 - x0) * i / n + sway;
        var a = P.p(X, bot, zc), b = P.p(X, top, zc);
        ctx.strokeStyle = i % 2 ? 'rgba(0,0,0,0.35)' : 'rgba(180,110,210,0.12)';
        ctx.lineWidth = 7 - open * 3;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      for (var k = 0; k < 6; k++) {
        var sp = P.p(x0 + (x1 - x0) * ((k * 0.37 + 0.13) % 1), bot + 0.3 + ((k * 0.61) % 1) * 2.2, zc - 0.01);
        star(ctx, sp, 9, '#d9b44a');
      }
    });
  }

  function charDark(def, extra) { return Math.min(1, def.dark + (extra || 0)); }

  /* Draw a camera feed.
     ex: { occ: [ids], t, pan (0..1), captchaStage, runP (0..1 captcha sprint in 2A),
           fake: id drawn as a hallucination, golden: bool (2B poster), watched: seconds } */
  function drawCam(ctx, key, ex) {
    var def = ROOMDEF[key], t = ex.t || 0;
    var off = Math.round((FEED_W - 1280) * (ex.pan == null ? 0.5 : ex.pan));
    ctx.save();
    ctx.translate(-off, 0);
    ctx.drawImage(roomLayer(key), 0, 0);
    var P = def.P, fy = def.floorY || 0;
    var list = (ex.occ || []).slice();
    if (ex.fake && list.indexOf(ex.fake) < 0) list.push(ex.fake);
    // sort by depth, far first
    var items = list.map(function (id, i) {
      var sp = def.spots[id] || [(i - 1) * 0.9, 4, 'stand'];
      // two characters sharing a spot: nudge the second one
      if (i > 0 && list[0] !== id && def.spots[list[0]] && def.spots[list[0]][0] === sp[0] && def.spots[list[0]][1] === sp[1]) sp = [sp[0] - 0.9, sp[1] + 0.8, 'stand'];
      return { id: id, sp: sp };
    }).sort(function (a, b) { return b.sp[1] - a.sp[1]; });

    if (key === 'cove') {
      var st = ex.captchaStage || 0;
      var open = st === 0 ? 0 : st === 1 ? 0.18 : 1;
      // backdrop behind curtains
      poly(ctx, [P.p(-2.4, 0.6, 5.9), P.p(2.4, 0.6, 5.9), P.p(2.4, 3.2, 5.9), P.p(-2.4, 3.2, 5.9)], '#08060a');
      if (st === 2 && window.CHARS) {
        var p2 = P.p(0.4, 0.6, 4.3);
        CHARS.draw(ctx, 'captcha', p2[0], p2[1], P.s(4.3) * 2.0, { pose: 'stand', t: t, dark: charDark(def, 0.05), glow: true });
      }
      if (st === 3) {
        var sign = P.p(0, 1.6, 4.5);
        txt(ctx, 'VERIFICATION IN PROGRESS', sign[0], sign[1], 'bold 26px monospace', 'rgba(220,60,60,' + (0.5 + 0.5 * Math.sin(t * 8)) + ')');
      }
      drawCurtains(ctx, P, open, t);
      if (st === 1 && window.CHARS) {
        var p1 = P.p(0.05, 0.6, 3.6);
        CHARS.draw(ctx, 'captcha', p1[0], p1[1], P.s(3.6) * 1.1, { pose: 'peek', t: t, dark: charDark(def, 0.1), glow: true });
      }
    }
    if (def.heads) drawHeads(ctx, t, ex.watched || 0);
    if (key === 'wcorner' && ex.golden && window.CHARS) {
      // the poster becomes a golden face
      var pp = def.poster, tl = P.p(pp[0], pp[1], pp[3]), bl = P.p(pp[0], pp[2], pp[3]), tr = P.p(pp[0], pp[1], pp[4]);
      var gp = canvas(180, 250), gx = gp.getContext('2d');
      gx.fillStyle = '#2a2208'; gx.fillRect(0, 0, 180, 250);
      CHARS.face(gx, 'golden', 90, 120, 170, { t: t, dark: 0.1, glow: true });
      txt(gx, "IT'S ME", 90, 228, 'bold 26px Georgia, serif', '#e9d27a');
      imgQuad(ctx, gp, tl, tr, bl);
    }

    if (window.CHARS) {
      items.forEach(function (it) {
        var sp = it.sp, isFake = ex.fake === it.id && (ex.occ || []).indexOf(it.id) < 0;
        var p = P.p(sp[0], fy, sp[1]), h = P.s(sp[1]) * 2.1 * (sp[2] === 'lean' ? 1.05 : 1);
        // contact shadow
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.ellipse(p[0], p[1], h * 0.22, h * 0.04, 0, 0, 7); ctx.fill();
        CHARS.draw(ctx, it.id, p[0], p[1], h, {
          pose: sp[2], t: t, dark: charDark(def, isFake ? 0.2 : 0), glow: key !== 'stage' || it.id === 'claudie' && ex.stare,
          glitch: isFake ? 0.7 : (it.id === 'hallu' ? 0.15 : 0)
        });
      });
    }
    if (key === 'whall' && ex.runP != null && window.CHARS) {
      // captcha sprinting toward the camera
      var z = 14 - ex.runP * 12.5, q = P.p(0, 0, z);
      CHARS.draw(ctx, 'captcha', q[0], q[1], P.s(z) * 2.0, { pose: 'run', t: t, dark: 0.25, glow: true, glitch: 0.3 });
    }
    ctx.drawImage(lightLayer(key), 0, 0);
    ctx.restore();
  }

  // ---------- the office ----------
  // A 3D box: X in ±2.69, floor Y=0, camera at 1.6, back wall at Z=3.78.
  var OP = Proj(700, 300, 520, 1.6);
  var OW = 2.69, OBACK = 3.78, OTOP = 3.35;
  var DOOR = { z0: 2.05, z1: 3.2, h: 2.5 };
  var office = null, officeLight = null, poster = null;

  function doorQuad(side, y0, y1) {
    var X = side * OW;
    return [OP.p(X, y0, DOOR.z0), OP.p(X, y0, DOOR.z1), OP.p(X, y1, DOOR.z1), OP.p(X, y1, DOOR.z0)];
  }
  function panelRect(side) {
    // the door/light button panel on the back wall, in office-world pixels
    var X0 = side < 0 ? -2.62 : 1.9, X1 = side < 0 ? -1.9 : 2.62;
    var a = OP.p(X0, 2.1, OBACK), b = OP.p(X1, 0.6, OBACK);
    return { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] };
  }
  function buildOffice() {
    var c = canvas(OFF_W, OFF_H), ctx = c.getContext('2d');
    var P = OP;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, OFF_W, OFF_H);
    // ceiling
    poly(ctx, [P.p(-OW, OTOP, 1.2), P.p(OW, OTOP, 1.2), P.p(OW, OTOP, OBACK), P.p(-OW, OTOP, OBACK)], '#0d0e10');
    // back wall: concrete block lower half, dark painted upper
    poly(ctx, [P.p(-OW, 0, OBACK), P.p(OW, 0, OBACK), P.p(OW, OTOP, OBACK), P.p(-OW, OTOP, OBACK)], '#23262a');
    for (var r = 0; r < 12; r++) for (var k = 0; k < 14; k++) {
      var y0 = r * 0.2, x0 = -OW + k * 0.4 + (r % 2 ? 0.2 : 0);
      if (y0 > 1.8) continue;
      poly(ctx, [P.p(Math.max(-OW, x0), y0, OBACK), P.p(Math.min(OW, x0 + 0.4), y0, OBACK), P.p(Math.min(OW, x0 + 0.4), y0 + 0.2, OBACK), P.p(Math.max(-OW, x0), y0 + 0.2, OBACK)],
        ((r * 7 + k * 3) % 5) ? '#3a3d40' : '#34373a', 'rgba(0,0,0,0.5)', 1.5);
    }
    // checker stripe
    for (var s = 0; s < 27; s++) {
      for (var rr = 0; rr < 2; rr++) {
        var sx = -OW + s * 0.2;
        poly(ctx, [P.p(sx, 1.8 + rr * 0.06, OBACK), P.p(sx + 0.2, 1.8 + rr * 0.06, OBACK), P.p(sx + 0.2, 1.86 + rr * 0.06, OBACK), P.p(sx, 1.86 + rr * 0.06, OBACK)], ((s + rr) % 2) ? '#d8d0c0' : '#111');
      }
    }
    // side walls with the doorways
    [-1, 1].forEach(function (sd) {
      var X = sd * OW;
      poly(ctx, [P.p(X, 0, 1.0), P.p(X, 0, OBACK), P.p(X, OTOP, OBACK), P.p(X, OTOP, 1.0)], '#2a2d31');
      for (var zz = 1.0; zz < OBACK; zz += 0.2) {
        for (var yy = 0; yy < 1.8; yy += 0.2) {
          poly(ctx, [P.p(X, yy, zz), P.p(X, yy, zz + 0.2), P.p(X, yy + 0.2, zz + 0.2), P.p(X, yy + 0.2, zz)], null, 'rgba(0,0,0,0.35)', 1);
        }
      }
      poly(ctx, [P.p(X, 0, 1.0), P.p(X, 0, OBACK), P.p(X, OTOP, OBACK), P.p(X, OTOP, 1.0)], 'rgba(0,0,0,0.3)');
      // door frame (hazard striped)
      var fq = [P.p(X, 0, DOOR.z0 - 0.12), P.p(X, 0, DOOR.z1 + 0.12), P.p(X, DOOR.h + 0.15, DOOR.z1 + 0.12), P.p(X, DOOR.h + 0.15, DOOR.z0 - 0.12)];
      poly(ctx, fq, '#3a3a30');
      ctx.save();
      poly(ctx, fq, null);
      ctx.clip();
      for (var h = -3; h < 20; h++) {
        var za = DOOR.z0 - 0.2 + h * 0.12;
        poly(ctx, [P.p(X, DOOR.h + 0.15, za), P.p(X, DOOR.h + 0.15, za + 0.06), P.p(X, 0, za + 0.06 + 0.4), P.p(X, 0, za + 0.4)], h % 2 ? '#b8961f' : '#1a1a1a');
      }
      ctx.restore();
      // punch out the doorway itself
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      poly(ctx, doorQuad(sd, 0, DOOR.h), '#000');
      ctx.restore();
    });
    // floor
    for (var zi = 0; zi < 12; zi++) for (var xi = 0; xi < 11; xi++) {
      var fz0 = 1.2 + zi * 0.25, fz1 = fz0 + 0.25;
      if (fz0 >= OBACK) continue;
      var fx0 = -OW + xi * (2 * OW / 11), fx1 = fx0 + 2 * OW / 11;
      poly(ctx, [P.p(fx0, 0, fz0), P.p(fx1, 0, fz0), P.p(fx1, 0, Math.min(fz1, OBACK)), P.p(fx0, 0, Math.min(fz1, OBACK))], ((xi + zi) % 2) ? '#8f887a' : '#171717');
    }
    // posters on the back wall
    var pz = OBACK - 0.01;
    var celebrate = posterCanvas(260, 340, '#1d2f55', [['CELEBRATE!', 'bold 44px Georgia, serif', '#f5d76e', 52]], '#fff', 101);
    celebrate.getContext('2d');
    poster = { canvas: celebrate, tl: P.p(-0.55, 3.15, pz), tr: P.p(0.55, 3.15, pz), bl: P.p(-0.55, 1.95, pz) };
    var rules = posterCanvas(170, 230, '#e3dcc6', [['SAFETY', 'bold 26px Georgia, serif', '#8b1a1a', 30], ['keep doors', '15px Georgia, serif', '#222', 20], ['open for', '15px Georgia, serif', '#222', 20], ['Claudie', 'bold 16px Georgia, serif', '#222', 22], ['she only', '15px Georgia, serif', '#222', 20], ['wants to', '15px Georgia, serif', '#222', 20], ['help', 'bold 18px Georgia, serif', '#8b1a1a', 20]], '#222', 102);
    imgQuad(ctx, rules, P.p(-1.55, 2.9, pz), P.p(-0.95, 2.9, pz), P.p(-1.55, 2.05, pz));
    for (var d = 0; d < 4; d++) {
      var kd = kidDrawing(120, 150, 110 + d, ['CLAUDIE', 'ME + CLAUDIE', 'THE CURTAN', 'IS SHE SMILING'][d], ['#c75a1f', '#c75a1f', '#2a8a86', '#c75a1f'][d]);
      var bx = 0.8 + (d % 2) * 0.62, by = 3.0 - Math.floor(d / 2) * 0.6;
      imgQuad(ctx, kd, P.p(bx, by, pz), P.p(bx + 0.5, by - 0.03 * (d - 1.5), pz), P.p(bx, by - 0.55, pz));
    }
    // wires dangling from the ceiling
    ctx.strokeStyle = '#050505'; ctx.lineWidth = 3;
    [[-1.8, 0.4], [1.6, 0.6], [0.2, 0.3]].forEach(function (w) {
      var a = P.p(w[0], OTOP, 3.2), b = P.p(w[0] + 0.1, OTOP - w[1], 3.2);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(a[0] + 20, (a[1] + b[1]) / 2 + 20, b[0], b[1]); ctx.stroke();
    });
    // desk
    box(ctx, P, -1.5, 1.5, 0, 0.95, 2.05, 2.7, '#3a3128', '#4b4035');
    poly(ctx, [P.p(-1.5, 0.95, 2.05), P.p(1.5, 0.95, 2.05), P.p(1.5, 0.9, 2.05), P.p(-1.5, 0.9, 2.05)], '#1e1a15');
    grime(ctx, P.p(-1.5, 0.95, 2.05)[0], P.p(0, 0.95, 2.7)[1], 780, 300, 50, 40, 103, 'rgba(0,0,0,0.3)');
    // desk clutter: monitors (screens drawn per frame), cups, papers, phone
    box(ctx, P, -1.25, -0.55, 0.95, 1.55, 2.35, 2.7, '#2e2e2a', '#3a3a35', '#222');
    box(ctx, P, 0.05, 0.75, 0.95, 1.5, 2.4, 2.7, '#2e2e2a', '#3a3a35', '#222');
    box(ctx, P, -0.4, -0.05, 0.95, 1.1, 2.15, 2.35, '#1c1c1c', '#262626');   // phone
    box(ctx, P, 0.95, 1.05, 0.95, 1.08, 2.2, 2.28, '#d8d3c6', '#ece8de');     // cup
    box(ctx, P, 1.12, 1.22, 0.95, 1.06, 2.25, 2.33, '#c2452b', '#d25a3e');    // cup
    var paper = posterCanvas(120, 90, '#dcd6c6', [['NIGHT LOG', 'bold 13px monospace', '#222', 18], ['night 1: ok', '11px monospace', '#333', 14], ['night 2: ok', '11px monospace', '#333', 14], ['night 3: it', '11px monospace', '#333', 14], ['smiled at me', '11px monospace', '#933', 14]], '#222', 104);
    imgQuad(ctx, paper, P.p(-0.35, 0.96, 2.1), P.p(0.05, 0.96, 2.08), P.p(-0.4, 0.96, 2.02));
    office = c;

    // lighting overlay for the office
    var L = canvas(OFF_W, OFF_H), lx = L.getContext('2d');
    var g = lx.createRadialGradient(700, 380, 80, 700, 380, 820);
    g.addColorStop(0, 'rgba(0,0,0,0.22)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0.93)');
    lx.fillStyle = g; lx.fillRect(0, 0, OFF_W, OFF_H);
    var g2 = lx.createLinearGradient(0, 0, 0, 200);
    g2.addColorStop(0, 'rgba(0,0,0,0.6)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
    lx.fillStyle = g2; lx.fillRect(0, 0, OFF_W, 200);
    officeLight = L;
  }
  function buildPoster() {
    // the CELEBRATE! poster gets the cast once CHARS is available
    if (!window.CHARS || poster.done) return;
    var x = poster.canvas.getContext('2d');
    CHARS.draw(x, 'hallu', 60, 320, 200, { pose: 'stand', dark: 0.15 });
    CHARS.draw(x, 'clippy', 200, 320, 180, { pose: 'stand', dark: 0.15 });
    CHARS.draw(x, 'claudie', 130, 330, 230, { pose: 'stand', dark: 0.05 });
    poster.done = true;
    imgQuad(office.getContext('2d'), poster.canvas, poster.tl, poster.tr, poster.bl);
  }

  // The hallway seen through a doorway, lit or dark, with whoever stands in it.
  function drawDoorway(ctx, side, st, t) {
    var P = OP, X = side * OW;
    ctx.save();
    poly(ctx, doorQuad(side, 0, DOOR.h), null);
    ctx.clip();
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, OFF_W, OFF_H);
    var lit = side < 0 ? st.lightL : st.lightR;
    var occ = side < 0 ? st.occL : st.occR;
    if (lit) {
      var flick = 0.85 + 0.15 * Math.sin(t * 50) * Math.sin(t * 7.3);
      var Xf = side * 4.3;
      // hall floor and far wall
      poly(ctx, [P.p(X, 0, 1.4), P.p(Xf, 0, 1.4), P.p(Xf, 0, 4.2), P.p(X, 0, 4.2)], '#2b2720');
      for (var i = 0; i < 12; i++) for (var j = 0; j < 6; j++) {
        var za = 1.4 + i * 0.25, xa = X + side * j * 0.27;
        if ((i + j) % 2) poly(ctx, [P.p(xa, 0, za), P.p(xa + side * 0.27, 0, za), P.p(xa + side * 0.27, 0, za + 0.25), P.p(xa, 0, za + 0.25)], '#8a806c');
      }
      poly(ctx, [P.p(Xf, 0, 1.4), P.p(Xf, 0, 4.2), P.p(Xf, 3, 4.2), P.p(Xf, 3, 1.4)], '#4a4538');
      if (occ && window.CHARS) {
        var fp = P.p(side * 3.25, 0, 2.62);
        CHARS.draw(ctx, occ, fp[0], fp[1], P.s(2.62) * 2.05, { pose: 'door', t: t, dark: 0.12, glow: true, flip: side > 0 });
      }
      // warm light cone
      var cp = P.p(side * 3.0, 2.2, 2.6);
      ctx.globalCompositeOperation = 'multiply';
      var g = ctx.createRadialGradient(cp[0], cp[1] + 120, 20, cp[0], cp[1] + 120, 420);
      g.addColorStop(0, 'rgba(255,236,190,1)');
      g.addColorStop(1, 'rgba(40,30,20,1)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, OFF_W, OFF_H);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(0,0,0,' + (1 - flick) + ')';
      ctx.fillRect(0, 0, OFF_W, OFF_H);
    } else if (st.lightsOutFace && side < 0 && window.CHARS) {
      // power out: Claudie in the left doorway, face flashing with the music box
      var on = st.lightsOutFace > 0.5;
      var fp2 = P.p(-3.2, 0, 2.62);
      CHARS.draw(ctx, 'claudie', fp2[0], fp2[1], P.s(2.62) * 2.05, { pose: 'door', t: t, dark: on ? 0.55 : 0.97, glow: true });
    }
    ctx.restore();

    // the shutter
    var amt = side < 0 ? st.doorL : st.doorR;
    if (amt > 0.001) {
      var yb = DOOR.h * (1 - amt);
      var q = doorQuad(side, yb, DOOR.h);
      poly(ctx, q, '#4b4f52');
      for (var y = DOOR.h; y > yb; y -= 0.14) {
        var a = P.p(X, y, DOOR.z0), b = P.p(X, y, DOOR.z1);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(a[0], a[1] + 3); ctx.lineTo(b[0], b[1] + 3); ctx.stroke();
      }
      // hazard strip on the leading edge
      var e0 = P.p(X, yb + 0.12, DOOR.z0), e1 = P.p(X, yb + 0.12, DOOR.z1);
      poly(ctx, [P.p(X, yb, DOOR.z0), P.p(X, yb, DOOR.z1), e1, e0], '#b8961f');
      for (var k = 0; k < 10; k++) {
        var z0 = DOOR.z0 + (DOOR.z1 - DOOR.z0) * k / 10, z1 = z0 + (DOOR.z1 - DOOR.z0) / 20;
        poly(ctx, [P.p(X, yb, z0), P.p(X, yb, z1), P.p(X, yb + 0.12, z1 + 0.03), P.p(X, yb + 0.12, z0 + 0.03)], '#111');
      }
      if (lit && amt > 0.95) {
        // light leaks under nothing; a closed door with the light on glows at the seam
        var s0 = P.p(X, 0.02, DOOR.z0), s1 = P.p(X, 0.02, DOOR.z1);
        ctx.strokeStyle = 'rgba(255,220,150,0.4)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(s0[0], s0[1]); ctx.lineTo(s1[0], s1[1]); ctx.stroke();
      }
    }
  }

  function drawPanel(ctx, side, st) {
    var r = panelRect(side);
    ctx.fillStyle = '#1b1c1e'; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#4a4c50'; ctx.lineWidth = 3; ctx.strokeRect(r.x, r.y, r.w, r.h);
    var b = panelButtons(side);
    var doorOn = side < 0 ? st.doorOnL : st.doorOnR, lightOn = side < 0 ? st.lightL : st.lightR;
    var dead = st.buttonsDead || st.powerOut;
    // door button (red)
    ctx.fillStyle = dead ? '#2a1414' : (doorOn ? '#ff3b2f' : '#6b1a15');
    ctx.beginPath(); ctx.arc(b.door.x + b.door.w / 2, b.door.y + b.door.h / 2, b.door.w * 0.42, 0, 7); ctx.fill();
    if (doorOn && !dead) lightPool(ctx, b.door.x + b.door.w / 2, b.door.y + b.door.h / 2, b.door.w * 0.9, 'rgba(255,60,40,0.35)');
    // light button (white)
    ctx.fillStyle = dead ? '#1e1e1e' : (lightOn ? '#f5f1e0' : '#555451');
    ctx.beginPath(); ctx.arc(b.light.x + b.light.w / 2, b.light.y + b.light.h / 2, b.light.w * 0.42, 0, 7); ctx.fill();
    if (lightOn && !dead) lightPool(ctx, b.light.x + b.light.w / 2, b.light.y + b.light.h / 2, b.light.w * 0.9, 'rgba(255,250,220,0.35)');
    txt(ctx, 'DOOR', b.door.x + b.door.w / 2, b.door.y + b.door.h + 1, 'bold 11px monospace', '#999');
    txt(ctx, 'LIGHT', b.light.x + b.light.w / 2, b.light.y + b.light.h + 1, 'bold 11px monospace', '#999');
  }
  function panelButtons(side) {
    var r = panelRect(side), s = Math.min(r.w - 10, r.h / 2 - 16);
    var x = r.x + (r.w - s) / 2;
    return { door: { x: x, y: r.y + 10, w: s, h: s }, light: { x: x, y: r.y + r.h / 2 + 6, w: s, h: s } };
  }

  function drawFan(ctx, t, on) {
    var P = OP, c = P.p(1.05, 1.32, 2.45), r = P.s(2.45) * 0.26;
    // base and neck
    ctx.fillStyle = '#26282a';
    var base = P.p(1.05, 0.96, 2.45);
    ctx.fillRect(base[0] - r * 0.5, base[1] - 8, r, 10);
    ctx.fillRect(c[0] - 5, c[1], 10, base[1] - c[1]);
    // blades
    var a = on ? t * 22 : 0.4;
    ctx.save();
    ctx.translate(c[0], c[1]);
    ctx.globalAlpha = on ? 0.55 : 1;
    ctx.fillStyle = '#3a3d40';
    for (var i = 0; i < 3; i++) {
      ctx.rotate(Math.PI * 2 / 3);
      ctx.beginPath(); ctx.ellipse(r * 0.5, 0, r * 0.48, r * 0.2, a, 0, 7); ctx.fill();
    }
    if (on) {
      ctx.globalAlpha = 0.25;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.95, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // cage
    ctx.strokeStyle = 'rgba(160,160,150,0.55)'; ctx.lineWidth = 1.5;
    for (var k = 0; k < 12; k++) {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(k * 0.52) * r, Math.sin(k * 0.52) * r); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, 7); ctx.stroke();
    ctx.fillStyle = '#555'; ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawMonitors(ctx, t, st) {
    var P = OP;
    [[-1.2, -0.6, 1.0, 1.5, 2.349], [0.1, 0.7, 1.0, 1.45, 2.399]].forEach(function (m, i) {
      var tl = P.p(m[0] + 0.05, m[3] - 0.04, m[4]), br = P.p(m[1] - 0.05, m[2] + 0.04, m[4]);
      var w = br[0] - tl[0], h = br[1] - tl[1];
      if (st.powerOut) { ctx.fillStyle = '#050605'; ctx.fillRect(tl[0], tl[1], w, h); return; }
      var fl = 0.8 + 0.2 * Math.sin(t * 9 + i * 3);
      ctx.fillStyle = 'rgba(20,50,35,' + fl + ')'; ctx.fillRect(tl[0], tl[1], w, h);
      ctx.save(); ctx.beginPath(); ctx.rect(tl[0], tl[1], w, h); ctx.clip();
      if (i === 0) {
        txt(ctx, 'CLAUDIE OS', tl[0] + w / 2, tl[1] + h * 0.3, 'bold 14px monospace', 'rgba(140,255,170,0.85)');
        txt(ctx, (Math.floor(t * 2) % 2) ? 'How can I help?_' : 'How can I help?', tl[0] + w / 2, tl[1] + h * 0.55, '12px monospace', 'rgba(140,255,170,0.7)');
        var p = st.power == null ? 1 : st.power / 100;
        ctx.fillStyle = 'rgba(140,255,170,0.6)'; ctx.fillRect(tl[0] + 10, tl[1] + h * 0.75, (w - 20) * p, 6);
      } else {
        for (var l = 0; l < 7; l++) {
          var s = ((Math.floor(t * 3) + l * 7) % 13 < 7) ? '> ' + ['01101000 01101001', 'I can see you', 'optimizing...', 'hello?', '[REDACTED]', 'tokens: ∞', 'smile :)'][(l + Math.floor(t / 4)) % 7] : '';
          txt(ctx, s, tl[0] + 8, tl[1] + 12 + l * 14, '11px monospace', 'rgba(140,255,170,0.6)', 'left');
        }
      }
      for (var y = tl[1]; y < tl[1] + h; y += 3) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(tl[0], y, w, 1); }
      ctx.restore();
      lightPool(ctx, tl[0] + w / 2, tl[1] + h / 2, w * 1.1, 'rgba(80,200,130,0.08)');
    });
  }

  /* st: { pan (px 0..120), doorL, doorR (0..1 closed), doorOnL, doorOnR, lightL, lightR,
           occL, occR, fanOn, powerOut, lightsOutFace (0|1), golden, flicker (0..1), buttonsDead, power } */
  function drawOffice(ctx, st, t) {
    if (!office) buildOffice();
    buildPoster();
    ctx.save();
    ctx.translate(-Math.round(st.pan || 0), 0);
    drawDoorway(ctx, -1, st, t);
    drawDoorway(ctx, 1, st, t);
    ctx.drawImage(office, 0, 0);
    drawMonitors(ctx, t, st);
    drawFan(ctx, t, st.fanOn && !st.powerOut);
    if (st.golden && window.CHARS) {
      var gp = OP.p(0.1, 0, 2.0);
      CHARS.draw(ctx, 'golden', gp[0], gp[1] + 10, OP.s(2.0) * 1.15, { pose: 'slump', t: t, dark: 0.2, glow: true, glitch: 0.2 + 0.2 * Math.random() });
    }
    drawPanel(ctx, -1, st);
    drawPanel(ctx, 1, st);
    ctx.drawImage(officeLight, 0, 0);
    if (st.powerOut) {
      ctx.fillStyle = 'rgba(0,0,5,0.86)'; ctx.fillRect(0, 0, OFF_W, OFF_H);
      if (st.lightsOutFace) {
        // redraw the doorway above the darkness: the face is the only light
        var fp = OP.p(-3.2, 0, 2.62);
        ctx.save(); poly(ctx, doorQuad(-1, 0, DOOR.h), null); ctx.clip();
        CHARS.draw(ctx, 'claudie', fp[0], fp[1], OP.s(2.62) * 2.05, { pose: 'door', t: t, dark: st.lightsOutFace > 0.5 ? 0.4 : 0.97, glow: true });
        ctx.restore();
      }
    } else if (st.flicker) {
      ctx.fillStyle = 'rgba(0,0,0,' + st.flicker + ')'; ctx.fillRect(0, 0, OFF_W, OFF_H);
    }
    ctx.restore();
  }

  // Office hit-testing, in screen coords (already corrected for the pan).
  function officeHit(x, y, pan) {
    var wx = x + pan;
    var out = null;
    [-1, 1].forEach(function (sd) {
      var b = panelButtons(sd), pad = 12;
      ['door', 'light'].forEach(function (k) {
        var r = b[k];
        if (wx >= r.x - pad && wx <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad) out = { side: sd < 0 ? 'L' : 'R', what: k };
      });
    });
    return out;
  }

  // ---------- the map ----------
  var MAP = { x: 890, y: 360, w: 370, h: 300 };
  var MAPPOS = {   // button centres, map-local
    stage: [175, 22], dining: [150, 88], cove: [52, 128], backstage: [30, 58], restroom: [330, 80],
    kitchen: [318, 172], closet: [52, 208], whall: [128, 200], wcorner: [128, 252], ehall: [222, 200],
    ecorner: [222, 252], cam11: [330, 250]
  };
  function drawMap(ctx, cur, opts) {
    var M = MAP;
    ctx.save();
    ctx.translate(M.x, M.y);
    ctx.strokeStyle = 'rgba(230,230,230,0.8)'; ctx.lineWidth = 3;
    // building outline
    ctx.beginPath();
    ctx.rect(70, 8, 230, 150);          // stage + dining
    ctx.rect(8, 40, 62, 40);            // backstage
    ctx.rect(8, 105, 62, 45);           // cove
    ctx.rect(300, 55, 62, 60);          // restrooms
    ctx.rect(280, 150, 80, 50);         // kitchen
    ctx.rect(110, 158, 36, 115);        // west hall
    ctx.rect(204, 158, 36, 115);        // east hall
    ctx.rect(20, 185, 60, 45);          // closet
    ctx.rect(146, 238, 58, 45);         // office
    ctx.stroke();
    txt(ctx, 'YOU', 175, 262, 'bold 13px monospace', 'rgba(255,255,255,0.9)');
    CAMS.forEach(function (c) {
      if (c.fake && !opts.cam11) return;
      var p = MAPPOS[c.key], w = 54, h = 26;
      var sel = cur === c.key;
      var blink = sel && Math.floor(opts.t * 2.5) % 2 === 0;
      ctx.fillStyle = sel ? (blink ? '#9ae05a' : '#6fb23a') : (c.fake ? 'rgba(90,20,110,0.85)' : 'rgba(70,70,70,0.9)');
      ctx.fillRect(p[0] - w / 2, p[1] - h / 2, w, h);
      ctx.strokeStyle = c.fake ? '#e08aff' : '#ddd'; ctx.lineWidth = 2;
      ctx.strokeRect(p[0] - w / 2, p[1] - h / 2, w, h);
      txt(ctx, c.fake ? 'CAM ??' : 'CAM ' + c.id, p[0], p[1] + 1, 'bold 12px monospace', '#fff');
    });
    ctx.restore();
  }
  function mapHit(x, y, opts) {
    var hit = null;
    CAMS.forEach(function (c) {
      if (c.fake && !opts.cam11) return;
      var p = MAPPOS[c.key], w = 62, h = 34;
      var px = MAP.x + p[0], py = MAP.y + p[1];
      if (x >= px - w / 2 && x <= px + w / 2 && y >= py - h / 2 && y <= py + h / 2) hit = c.key;
    });
    return hit;
  }

  // Warm the caches so the first camera flip doesn't hitch.
  function prewarm() {
    buildOffice();
    Object.keys(ROOMDEF).forEach(function (k) { roomLayer(k); lightLayer(k); });
  }

  window.ROOMS = {
    CAMS: CAMS, CAM_BY_KEY: CAM_BY_KEY, FEED_W: FEED_W, OFF_W: OFF_W,
    drawCam: drawCam, drawOffice: drawOffice, officeHit: officeHit,
    drawMap: drawMap, mapHit: mapHit, MAP: MAP, prewarm: prewarm,
    util: { rng: rng, canvas: canvas, txt: txt, poly: poly, vignette: vignette, lightPool: lightPool, grime: grime }
  };
})();
