/* Five Nights at Claudie's — the game: screens, the night simulation, input,
   the phone call, and rendering. Depends on STORY, ROOMS, CHARS and SFX. */
(function () {
  'use strict';

  var W = 1280, H = 720;
  var cv = document.getElementById('game');
  var ctx = cv.getContext('2d');
  var U = ROOMS.util;
  var $ = function (id) { return document.getElementById(id); };

  function sfx(name) {
    var S = window.SFX;
    if (!S || typeof S[name] !== 'function') return;
    try { return S[name].apply(S, Array.prototype.slice.call(arguments, 1)); } catch (e) { /* audio is never fatal */ }
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function approach(v, target, step) { return v < target ? Math.min(target, v + step) : Math.max(target, v - step); }

  // ---------- save ----------
  var SAVE_KEY = 'claudies.save.v1';
  function loadSave() {
    var d = { night: 1, beat5: false, beat6: false, beat20: false };
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      for (var k in d) if (s[k] != null) d[k] = s[k];
    } catch (e) { /* private mode */ }
    return d;
  }
  function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } }
  var save = loadSave();

  // ---------- tuning ----------
  var IDS = ['claudie', 'hallu', 'clippy', 'captcha'];
  var LEVELS = { 1: [0, 0, 0, 0], 2: [0, 3, 1, 1], 3: [1, 0, 5, 2], 4: [2, 2, 4, 6], 5: [3, 5, 7, 5], 6: [4, 10, 12, 16] };
  var BASE_DRAIN = { 1: 0, 2: 0.012, 3: 0.02, 4: 0.028, 5: 0.036, 6: 0.044, 7: 0.036 };
  var USAGE_DRAIN = 0.08;           // % per second per usage bar
  var HOUR = 70;                     // real seconds per in-game hour: a night is 7 minutes
  var INTERVAL = { claudie: 3.02, hallu: 4.97, clippy: 4.98, captcha: 5.01 };
  var LEFT_ROOMS = ['dining', 'backstage', 'whall', 'closet', 'wcorner'];
  var GRAPH = {
    hallu: { stage: ['dining', 'backstage'], dining: ['backstage', 'whall'], backstage: ['dining', 'whall'], whall: ['closet', 'wcorner', 'dining'], closet: ['whall', 'wcorner', 'ldoor'], wcorner: ['ldoor', 'closet', 'ldoor'] },
    clippy: { stage: ['dining'], dining: ['restroom', 'kitchen'], restroom: ['kitchen', 'ehall', 'dining'], kitchen: ['restroom', 'ehall'], ehall: ['ecorner', 'kitchen', 'ecorner'], ecorner: ['rdoor', 'ehall', 'rdoor'] },
    claudie: { stage: ['dining'], dining: ['restroom'], restroom: ['kitchen'], kitchen: ['ehall'], ehall: ['ecorner'] }
  };
  var CAM_BAR = { x: 400, y: 664, w: 480, h: 48 };
  var MUTE_BTN = { x: 26, y: 24, w: 150, h: 40 };

  // ---------- canvas scaling & input mapping ----------
  var scale = 1, offX = 0, offY = 0;
  function fit() {
    var vw = window.innerWidth, vh = window.innerHeight;
    scale = Math.min(vw / W, vh / H);
    var cw = Math.floor(W * scale), ch = Math.floor(H * scale);
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    offX = (vw - cw) / 2; offY = (vh - ch) / 2;
    cv.style.left = offX + 'px'; cv.style.top = offY + 'px';
  }
  window.addEventListener('resize', fit);
  fit();
  function toLogical(e) {
    return { x: (e.clientX - offX) / scale, y: (e.clientY - offY) / scale };
  }
  function inRect(p, r) { return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; }

  // ---------- static noise frames ----------
  var NOISE = [];
  (function () {
    for (var i = 0; i < 6; i++) {
      var c = U.canvas(320, 180), x = c.getContext('2d'), img = x.createImageData(320, 180);
      for (var p = 0; p < img.data.length; p += 4) {
        var v = Math.random() * 255;
        if (Math.random() < 0.02) v = 255;
        img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      NOISE.push(c);
    }
  })();
  var SCAN = (function () {
    var c = U.canvas(W, H), x = c.getContext('2d');
    for (var y = 0; y < H; y += 3) { x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(0, y, W, 1); }
    U.vignette(x, W, H, W / 2, H / 2, 260, 820, 0.85);
    return c;
  })();
  function drawNoise(a, t) {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(NOISE[(Math.floor(Math.abs(t) * 30) % NOISE.length)], 0, 0, W, H);
    ctx.restore();
  }

  // ---------- screens ----------
  var screen = 'title';
  var screenT = 0;
  var N = null;          // the current night
  var paused = false;
  var lastNight = save.night;

  function showDom(id) {
    ['menu', 'news', 'custom', 'pay', 'pause', 'over'].forEach(function (k) {
      var el = $(k); if (el) el.classList.toggle('show', k === id);
    });
  }
  function setScreen(s) {
    screen = s; screenT = 0;
    showDom({ title: 'menu', news: 'news', custom: 'custom', pay: 'pay', gameover: 'over' }[s] || null);
    if (s === 'title') { refreshMenu(); sfx('stopAll'); sfx('titleMusic', true); }
    else sfx('titleMusic', false);
  }

  function refreshMenu() {
    save = loadSave();
    $('btn-continue').style.display = save.night > 1 ? '' : 'none';
    $('continue-night').textContent = 'Night ' + Math.min(save.night, 5);
    $('btn-six').style.display = save.beat5 ? '' : 'none';
    $('btn-custom').style.display = save.beat6 ? '' : 'none';
    $('stars').textContent = (save.beat5 ? '★' : '') + (save.beat6 ? '★' : '') + (save.beat20 ? '★' : '');
  }

  // ---------- the night ----------
  function newNight(night, levels) {
    var lv = levels || LEVELS[night] || LEVELS[5];
    N = {
      night: night, t: 0, hour: 0, power: 100,
      lv: { claudie: lv[0], hallu: lv[1], clippy: lv[2], captcha: lv[3] },
      doorL: false, doorR: false, doorAnimL: 0, doorAnimR: 0, lightL: false, lightR: false,
      camUp: false, camAnim: 0, cam: 'stage', switchStatic: 0, camWatch: 0,
      pan: 60, panTarget: 60,
      ch: {
        claudie: { loc: 'stage', timer: INTERVAL.claudie },
        hallu: { loc: 'stage', timer: INTERVAL.hallu },
        clippy: { loc: 'stage', timer: INTERVAL.clippy },
        captcha: { stage: 0, timer: INTERVAL.captcha, lock: 0, run: -1, dash: -1, bangCost: 1 }
      },
      inside: null, insideT: 0, insideCycled: false, buttonsDead: false,
      disrupt: 0, fake: null, cam11Until: 0,
      golden: { poster: false, office: false, t: 0, used: false, chance: 1 / 350 },
      powerOut: false, po: null, flicker: 0,
      scared: {}, clinkT: 0, over: false, scare: null, stats: { bangs: 0, doorCloses: 0, camFlips: 0 }
    };
    if (night === 7 && lv.join('/') === '1/9/8/7') N.golden.chance = 1;
    if (levels && night === 7) N.custom = true;
    return N;
  }

  function ev(k) { N.stats[k] = (N.stats[k] || 0) + 1; }

  function usage() {
    return 1 + (N.doorL ? 1 : 0) + (N.doorR ? 1 : 0) + (N.lightL || N.lightR ? 1 : 0) + (N.camUp ? 1 : 0);
  }
  function watching(key) { return N.camUp && N.camAnim > 0.95 && N.cam === key; }
  function locOf(id) { return N.ch[id].loc; }

  function relocate(id, to) {
    var c = N.ch[id], from = c.loc;
    if (from === to) return;
    c.loc = to;
    ev('move_' + id); if (to === 'ldoor' || to === 'rdoor') ev('door_' + id);
    if (N.camUp && (N.cam === from || N.cam === to)) {
      N.disrupt = 1.2 + Math.random() * 0.8;
      sfx('staticBurst', 0.5);
    }
    if (to === 'ldoor' || to === 'rdoor') N.scared[to] = false;
  }
  function enterOffice(id) {
    var c = N.ch[id];
    relocate(id, 'office');
    ev('enter_' + id);
    N.inside = id; N.insideT = 0; N.insideCycled = N.camUp;
    N.buttonsDead = true;
    if (N.lightL || N.lightR) { sfx('lightBuzz', 'L', false); sfx('lightBuzz', 'R', false); }
    N.lightL = N.lightR = false;
    N.groanAt = 3 + Math.random() * 4;
    c.loc = 'office';
  }

  var MOVE = {
    hallu: function (c) {
      if (c.loc === 'office') return;
      if (N.cam === 'cam11' && watching('cam11')) return; // busy talking to you
      if (c.loc === 'ldoor') {
        if (N.doorL) { relocate('hallu', pick(['dining', 'backstage', 'whall'])); sfx('footsteps', 'L', 2); }
        else enterOffice('hallu');
        return;
      }
      var next;
      if (Math.random() < 0.2 && c.loc !== 'stage') next = pick(LEFT_ROOMS.filter(function (r) { return r !== c.loc; }));
      else next = pick(GRAPH.hallu[c.loc] || ['dining']);
      relocate('hallu', next);
      if (next === 'ldoor') sfx('footsteps', 'L', 3);
      // it hallucinates
      if (Math.random() < 0.2) { N.cam11Until = N.t + 30; ev('cam11'); }
      if (!N.fake && Math.random() < 0.15) { ev('fake'); N.fake = { key: pick(['stage', 'dining', 'restroom', 'ehall', 'ecorner', 'backstage']), id: 'hallu', until: N.t + 12 }; }
    },
    clippy: function (c) {
      if (c.loc === 'office') return;
      if (c.loc === 'rdoor') {
        if (N.doorR) { relocate('clippy', pick(['ehall', 'kitchen', 'dining'])); sfx('footsteps', 'R', 2); }
        else enterOffice('clippy');
        return;
      }
      var next = pick(GRAPH.clippy[c.loc] || ['dining']);
      relocate('clippy', next);
      if (next === 'kitchen' && (watching('kitchen') || Math.random() < 0.4)) sfx('clank');
      if (next === 'rdoor') sfx('footsteps', 'R', 3);
    },
    claudie: function (c) {
      if (c.loc === 'office') return;
      var waits = (N.lv.hallu > 0 && locOf('hallu') === 'stage') || (N.lv.clippy > 0 && locOf('clippy') === 'stage');
      if (waits) return;
      if (watching(c.loc)) return;            // she only moves when nobody is looking
      if (c.loc === 'ecorner') {
        if (N.doorR) { relocate('claudie', 'ehall'); sfx('laugh'); }
        else if (N.camUp && N.cam !== 'ecorner') { enterOffice('claudie'); sfx('laugh'); }
        return;
      }
      relocate('claudie', (GRAPH.claudie[c.loc] || ['dining'])[0]);
      sfx('laugh');
      if (c.loc === 'ehall' || c.loc === 'ecorner') sfx('footsteps', 'R', 2);
    },
    captcha: function (c) {
      if (N.camUp || c.lock > 0 || c.stage >= 3) return;
      c.stage++;
      if (c.stage === 3) { c.run = 0; c.dash = -1; ev('captchaOut'); }
    }
  };

  function tickAI(dt) {
    IDS.forEach(function (id) {
      var c = N.ch[id];
      c.timer -= dt;
      if (id === 'captcha') c.lock = Math.max(0, c.lock - dt);
      if (c.timer > 0) return;
      c.timer += INTERVAL[id];
      var lv = N.lv[id];
      if (lv <= 0) return;
      if (1 + Math.floor(Math.random() * 20) > lv) return;
      MOVE[id](c);
    });
    // the verification entity's sprint
    var x = N.ch.captcha;
    if (x.stage === 3) {
      x.run += dt;
      if (x.dash < 0 && (watching('whall') || x.run > 25)) { x.dash = 0; ev('captchaDash'); sfx('runSteps', 'L'); }
      if (x.dash >= 0) {
        x.dash += dt;
        if (x.dash >= 2.2) {
          if (N.doorL) {
            sfx('bang', 3);
            N.power = Math.max(0, N.power - x.bangCost);
            x.bangCost += 4; N.stats.bangs++;
            x.stage = Math.random() < 0.5 ? 0 : 1; x.run = -1; x.dash = -1;
          } else {
            return jumpscare('captcha');
          }
        }
      }
    }
  }

  function onHour(h) {
    if (N.custom) return;
    if (h === 2) N.lv.hallu++;
    if (h === 3 || h === 4) { N.lv.hallu++; N.lv.clippy++; N.lv.captcha++; }
  }

  function startPowerOut() {
    N.powerOut = true; N.power = 0; ev('powerOut');
    if (N.camUp) setCam(false, true);
    if (N.lightL) sfx('lightBuzz', 'L', false);
    if (N.lightR) sfx('lightBuzz', 'R', false);
    if (N.doorL) sfx('doorOpen', 'L');
    if (N.doorR) sfx('doorOpen', 'R');
    N.doorL = N.doorR = N.lightL = N.lightR = false;
    sfx('powerDown'); sfx('setFan', false); sfx('camStatic', false);
    N.po = { phase: 1, t: 0, check: 5, face: 0 };
  }
  function tickPowerOut(dt) {
    var po = N.po;
    po.t += dt; po.check -= dt;
    if (po.phase === 2) {
      // her face flickers in time with the music box
      po.faceT = (po.faceT || 0) - dt;
      if (po.faceT <= 0) { po.face = po.face ? 0 : 1; po.faceT = 0.05 + Math.random() * (po.face ? 0.35 : 0.25); }
    }
    if (po.check > 0) return;
    po.check = po.phase === 3 ? 2 : 5;
    var go = Math.random() < 0.2 || po.t >= 20;
    if (!go) return;
    po.t = 0;
    if (po.phase === 1) { po.phase = 2; sfx('musicBox', true); }
    else if (po.phase === 2) { po.phase = 3; po.face = 0; sfx('musicBox', false); }
    else jumpscare('claudie');
  }

  function update(dt) {
    if (!N || N.over) return;
    N.t += dt;
    var hour = Math.floor(N.t / HOUR);
    if (hour !== N.hour) { N.hour = hour; onHour(hour); }
    if (N.t >= 6 * HOUR) return win();

    N.doorAnimL = approach(N.doorAnimL, N.doorL ? 1 : 0, dt / 0.22);
    N.doorAnimR = approach(N.doorAnimR, N.doorR ? 1 : 0, dt / 0.22);
    N.camAnim = approach(N.camAnim, N.camUp ? 1 : 0, dt / 0.2);
    N.pan += (N.panTarget - N.pan) * Math.min(1, dt * 6);
    N.switchStatic = Math.max(0, N.switchStatic - dt);
    N.disrupt = Math.max(0, N.disrupt - dt);
    N.camWatch = N.camUp ? N.camWatch + dt : 0;
    if (N.fake && N.t > N.fake.until) N.fake = null;
    N.flicker = Math.random() < 0.004 ? 0.5 + Math.random() * 0.4 : Math.max(0, N.flicker - dt * 3);

    if (N.powerOut) { tickPowerOut(dt); updateCall(dt); return; }

    var drain = usage() * USAGE_DRAIN + (BASE_DRAIN[N.night] || 0);
    if (locOf('clippy') === 'rdoor') {
      // converting your battery into paperclips
      drain += N.doorR ? 0.14 : 0.05;
      N.clinkT -= dt;
      if (N.clinkT <= 0) { N.clinkT = 3 + Math.random() * 3; sfx('clank'); }
    }
    N.power -= drain * dt;
    if (N.power <= 0) { startPowerOut(); return; }

    tickAI(dt);
    if (N.over) return;

    // something is in the room with you
    if (N.inside) {
      N.insideT += dt;
      if (N.groanAt && N.insideT > N.groanAt && !N.camUp) { N.groanAt = 0; sfx('groan'); }
      if (N.camUp) N.insideCycled = true;
      if (N.insideCycled && !N.camUp && N.camAnim < 0.05) return jumpscare(N.inside);
      if (N.camUp && N.insideT > 14) setCam(false, true);
      if (N.insideT > 26) return jumpscare(N.inside);
    }
    // the one you were never supposed to see
    if (N.golden.office) {
      N.golden.t += dt;
      if (N.camUp) { N.golden.office = false; sfx('goldenDrone', false); }
      else if (N.golden.t > 4.5) return jumpscare('golden');
    }
    if (N.camUp && N.cam === 'kitchen') {
      if (locOf('clippy') === 'kitchen') { N.kitchenClank = (N.kitchenClank || 0) - dt; if (N.kitchenClank <= 0) { N.kitchenClank = 2.5 + Math.random() * 2; sfx('clank'); } }
    }
    updateCall(dt);
  }

  // ---------- controls ----------
  function toggleDoor(side) {
    if (!N || N.over) return;
    if (N.buttonsDead || N.powerOut) return sfx('error');
    var k = 'door' + side;
    N[k] = !N[k];
    if (N[k]) { sfx('doorSlam', side); N.stats.doorCloses++; } else sfx('doorOpen', side);
  }
  function toggleLight(side) {
    if (!N || N.over) return;
    if (N.buttonsDead || N.powerOut) return sfx('error');
    var k = 'light' + side, other = side === 'L' ? 'R' : 'L';
    N[k] = !N[k];
    if (N['light' + other]) { N['light' + other] = false; sfx('lightBuzz', other, false); }
    sfx('lightBuzz', side, N[k]);
    if (N[k]) {
      var spot = side === 'L' ? 'ldoor' : 'rdoor';
      var who = occupantAt(spot);
      if (who && !N.scared[spot]) { N.scared[spot] = true; sfx('windowScare'); }
    }
  }
  function occupantAt(spot) {
    for (var i = 0; i < 3; i++) if (N.ch[IDS[i]].loc === spot) return IDS[i];
    return null;
  }
  function setCam(up, forced) {
    if (!N || N.over) return;
    if (up && N.powerOut) return;
    if (N.camUp === up) return;
    N.camUp = up;
    N.stats.camFlips++;
    sfx('camFlip', up);
    sfx('camStatic', up);
    if (up) {
      if (N.lightL) { N.lightL = false; sfx('lightBuzz', 'L', false); }
      if (N.lightR) { N.lightR = false; sfx('lightBuzz', 'R', false); }
      N.switchStatic = 0.3;
      if (N.inside) N.insideCycled = true;
      if (N.golden.office) { N.golden.office = false; sfx('goldenDrone', false); }
      if (N.cam === 'wcorner') goldenRoll();
      if (N.cam === 'kitchen' && locOf('claudie') === 'kitchen') sfx('musicBox', true);
    } else {
      N.ch.captcha.lock = 0.83 + Math.random() * 15.8;
      if (N.golden.poster) {
        N.golden.poster = false; N.golden.office = true; N.golden.t = 0;
        sfx('goldenDrone', true);
      }
      if (!N.powerOut) sfx('musicBox', false);
    }
  }
  function switchCam(key) {
    if (!N || !N.camUp || key === N.cam) return;
    var prev = N.cam;
    N.cam = key;
    N.switchStatic = 0.25;
    N.disrupt = 0;
    sfx('camBlip');
    if (prev === 'kitchen') sfx('musicBox', false);
    if (key === 'kitchen') {
      if (locOf('clippy') === 'kitchen') sfx('clank');
      if (locOf('claudie') === 'kitchen') sfx('musicBox', true);
    }
    if (key === 'wcorner') goldenRoll();
    if (key === 'cam11') sfx('glitch');
  }
  function goldenRoll() {
    if (!N.golden.used && !N.golden.poster && Math.random() < N.golden.chance) {
      N.golden.poster = true; N.golden.used = true; ev('golden');
    }
  }

  // ---------- the phone call ----------
  var call = null;
  var VOICE = { 5: { pitch: 0.1, rate: 0.6 }, 6: { pitch: 1.5, rate: 0.95 } };
  function pickVoice() {
    if (!window.speechSynthesis) return null;
    var vs = speechSynthesis.getVoices() || [];
    var en = vs.filter(function (v) { return /^en/i.test(v.lang); });
    var pref = en.filter(function (v) { return /male|daniel|david|fred|alex|guy/i.test(v.name); });
    return pref[0] || en[0] || vs[0] || null;
  }
  function startCall() {
    var lines = STORY.CALLS[N.night];
    if (!lines || N.custom) { call = null; return; }
    call = { lines: lines, i: -1, state: 'ring', t: 0, sub: '', muted: false };
    sfx('phoneRing', true);
  }
  function endCall(hangup) {
    if (!call) return;
    if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { /* */ }
    sfx('phoneRing', false);
    if (hangup) sfx('phoneHangup');
    call = null;
  }
  function nextLine() {
    if (!call) return;
    call.i++;
    if (call.i >= call.lines.length) return endCall(true);
    var line = call.lines[call.i];
    call.sub = line;
    call.lineT = 0;
    var spoken = line.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    call.est = spoken ? 1.2 + spoken.split(' ').length * 0.34 : 2.8;
    call.speaking = false;
    var cue = line.toLowerCase();
    if (cue.indexOf('(banging') >= 0) sfx('bang', 3);
    if (cue.indexOf('music box') >= 0) { sfx('musicBox', true); call.stopBox = true; }
    if (cue.indexOf('(a scream') >= 0) { sfx('musicBox', false); sfx('glitch'); sfx('staticBurst', 1.2); }
    if (cue.indexOf('static') >= 0 && cue.indexOf('scream') < 0) sfx('staticBurst', 0.6);
    if (spoken && window.speechSynthesis && window.SpeechSynthesisUtterance && !call.muted) {
      try {
        var u = new SpeechSynthesisUtterance(spoken);
        var v = pickVoice(); if (v) u.voice = v;
        var vp = VOICE[N.night] || { pitch: 0.9, rate: 1.05 };
        u.pitch = vp.pitch; u.rate = vp.rate; u.volume = 1;
        var mine = call.i;
        u.onstart = function () { if (call && call.i === mine) call.speaking = true; };
        u.onend = u.onerror = function () { if (call && call.i === mine) call.done = true; };
        call.done = false;
        speechSynthesis.speak(u);
      } catch (e) { /* subtitles carry it */ }
    }
  }
  function updateCall(dt) {
    if (!call) return;
    call.t += dt;
    if (call.state === 'ring') {
      if (call.t > 4.2) { call.state = 'talk'; sfx('phoneRing', false); sfx('phonePickup'); nextLine(); }
      return;
    }
    call.lineT += dt;
    // advance when the voice finishes; if the voice never starts, the subtitles keep time
    var limit = call.speaking ? call.est * 2.5 + 3 : call.est;
    if ((call.speaking && call.done && call.lineT > 0.5) || call.lineT > limit) {
      if (call.stopBox && call.i < call.lines.length - 1 && call.lines[call.i + 1].indexOf('music box') < 0) { sfx('musicBox', false); call.stopBox = false; }
      nextLine();
    }
  }

  // ---------- endings ----------
  function jumpscare(id) {
    if (N.over) return;
    N.over = true; ev('scare_' + id);
    N.scare = { id: id, t: 0 };
    endCall(false);
    sfx('stopAll');
    var d = sfx('scream', id);
    N.scare.dur = Math.max(1.2, d || 1.2);
    screen = 'scare'; screenT = 0;
  }
  function win() {
    N.over = true; N.won = true;
    endCall(false);
    sfx('stopAll');
    sfx('chime');
    setTimeout(function () { sfx('cheer'); }, 1400);
    if (N.night <= 5) save.night = Math.max(save.night, Math.min(5, N.night + 1));
    if (N.night === 5) save.beat5 = true;
    if (N.night === 6) save.beat6 = true;
    if (N.night === 7 && N.lv.claudie >= 20 && N.lv.hallu >= 20 && N.lv.clippy >= 20 && N.lv.captcha >= 20) save.beat20 = true;
    writeSave();
    screen = 'six'; screenT = 0;
  }
  function afterSix() {
    var n = N.night;
    if (n === 5 || n === 6 || n === 7) {
      $('pay-title').textContent = n === 7 ? 'NOTICE OF TERMINATION' : 'PAYCHECK';
      $('pay-body').textContent = STORY.SIX_AM[n];
      $('pay-amt').textContent = n === 5 ? '$120.50' : n === 6 ? '$120.75' : '$0.00';
      $('pay-note').textContent = n === 7 ? 'Reason: tampering with the models. Also: odor.' : (n === 5 ? 'A 6th night is now available. Overtime is not optional.' : 'Custom Night unlocked. You did this to yourself.');
      setScreen('pay');
    } else {
      beginNight(n + 1);
    }
  }
  function afterScare() {
    if (N.scare.id === 'golden') { screen = 'crash'; screenT = 0; return; }
    var lines = STORY.DEATH[N.scare.id] || STORY.DEATH.claudie;
    $('over-line').textContent = pick(lines);
    $('over-sub').textContent = pick(STORY.GAMEOVER_SUB);
    setScreen('gameover');
    sfx('staticBurst', 1.5);
  }

  // ---------- flow ----------
  var customLevels = [0, 0, 0, 0];
  function beginNight(n, levels) {
    lastNight = n;
    newNight(n, levels);
    showDom(null);
    screen = 'card'; screenT = 0;
    sfx('stopAll');
    sfx('staticBurst', 1.2);
  }
  function startPlay() {
    screen = 'play'; screenT = 0;
    sfx('startAmbience'); sfx('setFan', true);
    startCall();
  }

  // ---------- rendering ----------
  function drawHUD(t) {
    // clock
    var h = N.hour === 0 ? 12 : N.hour;
    U.txt(ctx, h + ' AM', W - 40, 50, 'bold 44px "Courier New", monospace', '#fff', 'right');
    U.txt(ctx, 'Night ' + (N.night === 7 ? 'Custom' : N.night), W - 40, 88, 'bold 20px "Courier New", monospace', '#ccc', 'right');
    // power
    U.txt(ctx, 'Power left: ' + Math.max(0, Math.ceil(N.power)) + '%', 28, H - 86, 'bold 24px "Courier New", monospace', '#fff', 'left');
    U.txt(ctx, 'Usage:', 28, H - 52, 'bold 24px "Courier New", monospace', '#fff', 'left');
    var u = N.powerOut ? 0 : usage();
    var cols = ['#4bd04b', '#4bd04b', '#e3d23a', '#e0512e', '#e0512e'];
    for (var i = 0; i < u; i++) { ctx.fillStyle = cols[i] || '#e0512e'; ctx.fillRect(130 + i * 26, H - 66, 20, 30); }
    if (!N.powerOut && locOf('clippy') === 'rdoor' && N.doorR && Math.floor(t * 4) % 2) {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(130 + u * 26, H - 66, 20, 30);
    }
    // camera bar
    if (!N.powerOut) {
      ctx.fillStyle = 'rgba(255,255,255,' + (N.camUp ? 0.12 : 0.18) + ')';
      ctx.fillRect(CAM_BAR.x, CAM_BAR.y, CAM_BAR.w, CAM_BAR.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2;
      ctx.strokeRect(CAM_BAR.x, CAM_BAR.y, CAM_BAR.w, CAM_BAR.h);
      U.txt(ctx, N.camUp ? '▼▼  CAMERA  ▼▼' : '▲▲  CAMERA  ▲▲', W / 2, CAM_BAR.y + CAM_BAR.h / 2 + 1, 'bold 20px "Courier New", monospace', '#fff');
    }
    // phone call
    if (call) {
      ctx.fillStyle = 'rgba(40,40,40,0.85)'; ctx.fillRect(MUTE_BTN.x, MUTE_BTN.y, MUTE_BTN.w, MUTE_BTN.h);
      ctx.strokeStyle = '#ddd'; ctx.strokeRect(MUTE_BTN.x, MUTE_BTN.y, MUTE_BTN.w, MUTE_BTN.h);
      U.txt(ctx, 'MUTE CALL', MUTE_BTN.x + MUTE_BTN.w / 2, MUTE_BTN.y + MUTE_BTN.h / 2 + 1, 'bold 18px "Courier New", monospace', '#fff');
      if (call.state === 'ring') {
        U.txt(ctx, '☎  incoming call' + '...'.slice(0, 1 + Math.floor(t * 2) % 3), 190, 44, 'bold 18px "Courier New", monospace', '#ddd', 'left');
      } else if (call.sub) {
        drawSubtitle(call.sub);
      }
    }
  }
  function wrap(text, maxW, font) {
    ctx.font = font;
    var words = text.split(' '), lines = [], cur = '';
    words.forEach(function (w) {
      var test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function drawSubtitle(text) {
    var font = '22px Georgia, "Times New Roman", serif';
    var italic = /^\(.*\)$/.test(text);
    if (italic) font = 'italic ' + font;
    var lines = wrap(text, 740, font);
    var lh = 30, bh = lines.length * lh + 20, by = 112;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(W / 2 - 390, by, 780, bh);
    lines.forEach(function (l, i) { U.txt(ctx, l, W / 2, by + 10 + lh / 2 + i * lh, font, italic ? '#c9c2ff' : '#f3efe0'); });
  }

  function drawCamView(t) {
    var key = N.cam, cam = ROOMS.CAM_BY_KEY[key];
    var pan = 0.5 + 0.5 * Math.sin(t * 0.25);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    var disrupted = N.disrupt > 0;
    if (cam.audioOnly) {
      drawNoise(0.12, t);
      U.txt(ctx, 'CAMERA DISABLED', W / 2 - 150, H / 2 - 30, 'bold 40px "Courier New", monospace', '#ddd');
      U.txt(ctx, '- AUDIO ONLY -', W / 2 - 150, H / 2 + 20, 'bold 28px "Courier New", monospace', '#aaa');
    } else if (!disrupted) {
      var occ = [];
      if (key === 'cam11') occ = ['hallu'];
      else IDS.forEach(function (id) { if (id !== 'captcha' && N.ch[id].loc === key) occ.push(id); });
      var x = N.ch.captcha;
      ROOMS.drawCam(ctx, key, {
        occ: occ, t: t, pan: pan,
        captchaStage: x.stage,
        runP: (key === 'whall' && x.dash >= 0) ? clamp(x.dash / 2.2, 0, 1) : null,
        fake: N.fake && N.fake.key === key ? N.fake.id : null,
        golden: key === 'wcorner' && N.golden.poster,
        watched: N.camWatch,
        stare: key === 'stage' && occ.length === 1
      });
      // security-camera look
      ctx.fillStyle = 'rgba(30,60,45,0.16)'; ctx.fillRect(0, 0, W, H);
      drawNoise(0.1 + (N.fake && N.fake.key === key ? 0.1 : 0), t);
      if ((N.fake && N.fake.key === key) || key === 'cam11') {
        var g = STORY.CAM_GLITCH[Math.floor(t * 1.3) % STORY.CAM_GLITCH.length];
        if (Math.floor(t * 5) % 3) U.txt(ctx, g, W / 2 + Math.sin(t * 13) * 8, 120, 'bold 30px "Courier New", monospace', 'rgba(230,120,255,0.8)');
      }
    }
    if (disrupted) drawNoise(1, t);
    if (N.switchStatic > 0) drawNoise(0.4 + N.switchStatic * 2, t);
    ctx.drawImage(SCAN, 0, 0);
    // frame
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3;
    var m = 24, L = 50;
    [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(function (c) {
      ctx.beginPath(); ctx.moveTo(c[0], c[1] + c[3] * L); ctx.lineTo(c[0], c[1]); ctx.lineTo(c[0] + c[2] * L, c[1]); ctx.stroke();
    });
    if (Math.floor(t * 1.5) % 2) { ctx.fillStyle = '#e21'; ctx.beginPath(); ctx.arc(60, 108, 12, 0, 7); ctx.fill(); }
    U.txt(ctx, 'REC', 82, 109, 'bold 22px "Courier New", monospace', '#eee', 'left');
    U.txt(ctx, cam.name, ROOMS.MAP.x + 10, ROOMS.MAP.y - 26, 'bold 26px "Courier New", monospace', '#fff', 'left');
    if (disrupted && !cam.audioOnly) U.txt(ctx, 'VIDEO SIGNAL LOST', W / 2, H / 2, 'bold 30px "Courier New", monospace', 'rgba(255,255,255,0.8)');
    ROOMS.drawMap(ctx, key, { t: t, cam11: N.t < N.cam11Until || key === 'cam11' });
  }

  function officeState() {
    return {
      pan: N.pan, doorL: N.doorAnimL, doorR: N.doorAnimR, doorOnL: N.doorL, doorOnR: N.doorR,
      lightL: N.lightL, lightR: N.lightR,
      occL: occupantAt('ldoor'), occR: occupantAt('rdoor'),
      fanOn: !N.powerOut, powerOut: N.powerOut,
      lightsOutFace: N.po && N.po.phase === 2 ? (N.po.face ? 1 : 0.2) : 0,
      golden: N.golden.office, flicker: N.flicker, buttonsDead: N.buttonsDead, power: N.power
    };
  }

  function drawPlay(t) {
    if (N.camAnim < 1) {
      ROOMS.drawOffice(ctx, officeState(), t);
      if (N.inside && !N.camUp && N.insideT > 0.5) {
        // it's in here. you can hear it breathe.
        ctx.fillStyle = 'rgba(0,0,0,' + (0.15 + 0.1 * Math.sin(t * 2)) + ')'; ctx.fillRect(0, 0, W, H);
      }
    }
    if (N.camAnim > 0 && N.camAnim < 1) {
      // the tablet flipping up
      var k = N.camAnim, top = H - k * H;
      ctx.fillStyle = '#111'; ctx.fillRect(40, top, W - 80, H);
      ctx.strokeStyle = '#333'; ctx.lineWidth = 10; ctx.strokeRect(40, top, W - 80, H);
      ctx.fillStyle = 'rgba(80,120,100,' + (0.2 * k) + ')'; ctx.fillRect(60, top + 20, W - 120, H - 40);
    } else if (N.camAnim >= 1) {
      drawCamView(t);
    }
    if (N.powerOut && N.po && N.po.phase === 3) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    drawHUD(t);
    if (N.golden.office) {
      if (Math.random() < 0.25) U.txt(ctx, "IT'S ME", W / 2 + (Math.random() - 0.5) * 600, H / 2 + (Math.random() - 0.5) * 400, 'bold ' + (40 + Math.random() * 80 | 0) + 'px Georgia, serif', 'rgba(240,210,110,0.9)');
    }
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, W, H);
    }
  }

  function drawCard(t) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    var a = t < 0.5 ? t / 0.5 : t > 3 ? Math.max(0, 1 - (t - 3) / 0.6) : 1;
    ctx.globalAlpha = a;
    var title = STORY.NIGHT_TITLE[N.night].split(' · ');
    U.txt(ctx, title[0], W / 2, H / 2 - 30, 'bold 60px "Courier New", monospace', '#fff');
    U.txt(ctx, title[1], W / 2, H / 2 + 40, 'bold 40px "Courier New", monospace', '#fff');
    ctx.globalAlpha = 1;
    drawNoise(t < 0.6 ? 0.7 - t : 0.08, t);
    if (t > 3.7) startPlay();
  }

  function drawSix(t) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    // 5 rolls up into 6
    var k = clamp((t - 1.0) / 1.2, 0, 1);
    k = k * k * (3 - 2 * k);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, H / 2 - 60, W, 120); ctx.clip();
    U.txt(ctx, '5', W / 2 - 70, H / 2 - k * 120, 'bold 110px "Courier New", monospace', '#fff');
    U.txt(ctx, '6', W / 2 - 70, H / 2 + 120 - k * 120, 'bold 110px "Courier New", monospace', '#fff');
    ctx.restore();
    U.txt(ctx, 'AM', W / 2 + 60, H / 2, 'bold 110px "Courier New", monospace', '#fff');
    if (t > 2.4) {
      ctx.globalAlpha = clamp((t - 2.4) / 0.8, 0, 1);
      U.txt(ctx, STORY.SIX_AM[N.night] || '', W / 2, H / 2 + 120, 'italic 24px Georgia, serif', '#d8d2c0');
      ctx.globalAlpha = 1;
    }
    if (t > 7) { screen = 'wait'; afterSix(); }
  }

  function drawScare(t) {
    var p = clamp(t / N.scare.dur, 0, 1);
    if (window.CHARS) CHARS.jumpscare(ctx, N.scare.id, p, t, W, H);
    if (t > N.scare.dur) { screen = 'wait'; afterScare(); }
  }

  function drawGameOver(t) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    drawNoise(Math.max(0.12, 1 - t * 0.6), t);
    ctx.drawImage(SCAN, 0, 0);
  }

  function drawCrash(t) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (t < 1.5) {
      ctx.fillStyle = '#c0c0c0'; ctx.fillRect(W / 2 - 280, H / 2 - 90, 560, 180);
      ctx.fillStyle = '#000080'; ctx.fillRect(W / 2 - 280, H / 2 - 90, 560, 34);
      U.txt(ctx, 'claudies.exe', W / 2 - 266, H / 2 - 72, 'bold 18px sans-serif', '#fff', 'left');
      U.txt(ctx, 'claudies.exe has stopped responding.', W / 2, H / 2 - 10, '20px sans-serif', '#000');
      U.txt(ctx, 'It is not responding to you specifically.', W / 2, H / 2 + 30, 'italic 18px sans-serif', '#333');
    }
    if (t > 2.2) setScreen('title');
  }

  var titleGlitch = 0;
  function drawTitle(t) {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    if (window.CHARS) {
      var id = 'claudie';
      if (Math.random() < 0.006) titleGlitch = 0.12;
      titleGlitch = Math.max(0, titleGlitch - 1 / 60);
      if (titleGlitch > 0) id = Math.random() < 0.5 ? 'hallu' : 'golden';
      var twitch = Math.sin(t * 0.7) * 6 + (Math.random() < 0.02 ? (Math.random() - 0.5) * 30 : 0);
      CHARS.face(ctx, id, W * 0.72 + twitch, H * 0.5, H * 0.85, { t: t, dark: 0.45 + 0.1 * Math.sin(t * 1.3), glow: true, glitch: titleGlitch > 0 ? 0.8 : 0.05 });
    }
    drawNoise(0.14 + (titleGlitch > 0 ? 0.4 : 0), t);
    ctx.drawImage(SCAN, 0, 0);
    if (Math.random() < 0.003) U.txt(ctx, "IT'S ME", W * 0.72, H * 0.5, 'bold 90px Georgia, serif', '#e6c86a');
  }

  function drawNewsBg(t) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); drawNoise(0.06, t); }

  // ---------- main loop ----------
  var last = performance.now(), T = 0, manual = false;
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = clamp((now - last) / 1000, 0, 0.1); last = now;
    T += dt; screenT += dt;
    try {
      if (screen === 'play' && !paused && !manual) update(dt * (api.timeScale || 1));
      render();
    } catch (e) {
      if (window.console) console.error(e);
    }
  }
  function render() {
    switch (screen) {
      case 'title': drawTitle(T); break;
      case 'news': case 'custom': case 'pay': drawNewsBg(T); break;
      case 'card': drawCard(screenT); break;
      case 'play': drawPlay(T); break;
      case 'six': drawSix(screenT); break;
      case 'scare': drawScare(screenT); break;
      case 'gameover': drawGameOver(screenT); break;
      case 'crash': drawCrash(screenT); break;
      default: break;
    }
  }

  // ---------- input ----------
  var hoverInBar = false, lastHoverToggle = 0;
  cv.addEventListener('pointerdown', function (e) {
    sfx('init');
    var p = toLogical(e);
    if (screen === 'play' && N && !N.over) {
      e.preventDefault();
      if (paused) { setPause(false); return; }
      if (call && inRect(p, MUTE_BTN)) { if (call) call.muted = true; endCall(true); return; }
      if (inRect(p, CAM_BAR) && !N.powerOut) {
        if (performance.now() - lastHoverToggle > 450) setCam(!N.camUp);
        return;
      }
      if (N.camUp) { var k = ROOMS.mapHit(p.x, p.y, { cam11: N.t < N.cam11Until || N.cam === 'cam11' }); if (k) switchCam(k); return; }
      var h = ROOMS.officeHit(p.x, p.y, N.pan);
      if (h) { if (h.what === 'door') toggleDoor(h.side); else toggleLight(h.side); return; }
      if (e.pointerType !== 'mouse') touchPan = { x: p.x, pan: N.panTarget };
    } else if (screen === 'gameover') {
      // handled by DOM
    } else if (screen === 'card' && screenT > 1) {
      screenT = 3.2;
    } else if (screen === 'six' && screenT > 3) {
      screenT = 7;
    }
  });
  var touchPan = null;
  cv.addEventListener('pointermove', function (e) {
    if (screen !== 'play' || !N) return;
    var p = toLogical(e);
    if (e.pointerType === 'mouse') {
      // pan toward the edge the mouse is near
      N.panTarget = clamp((p.x - 300) / (W - 600), 0, 1) * 120;
      var inBar = inRect(p, CAM_BAR);
      if (inBar && !hoverInBar && !N.over && !N.powerOut && !paused) { setCam(!N.camUp); lastHoverToggle = performance.now(); }
      hoverInBar = inBar;
    } else if (touchPan) {
      N.panTarget = clamp(touchPan.pan - (p.x - touchPan.x), 0, 120);
    }
  });
  window.addEventListener('pointerup', function () { touchPan = null; });
  window.addEventListener('keydown', function (e) {
    if (screen !== 'play' || !N || N.over) return;
    var k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') return setPause(!paused);
    if (paused) return;
    if (k === 'q') toggleDoor('L');
    else if (k === 'a') toggleLight('L');
    else if (k === 'e') toggleDoor('R');
    else if (k === 'd') toggleLight('R');
    else if (k === ' ' || k === 's') { e.preventDefault(); setCam(!N.camUp); }
    else if (k === 'm' && call) { call.muted = true; endCall(true); }
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && screen === 'play' && N && !N.over) setPause(true);
  });
  window.addEventListener('pagehide', function () {
    if (window.speechSynthesis) try { speechSynthesis.cancel(); } catch (e) { /* */ }
  });
  function setPause(v) {
    paused = v;
    $('pause').classList.toggle('show', v);
    if (window.speechSynthesis) try { if (v) speechSynthesis.pause(); else speechSynthesis.resume(); } catch (e) { /* */ }
    sfx('suspend', v);
  }

  // The first touch anywhere unlocks audio; on the title that means the music starts.
  document.addEventListener('pointerdown', function () {
    sfx('init');
    if (screen === 'title') sfx('titleMusic', true);
  }, true);

  // ---------- DOM wiring ----------
  function click(id, fn) {
    $(id).addEventListener('click', function (e) { e.preventDefault(); sfx('init'); sfx('click'); fn(); });
  }
  click('btn-new', function () {
    save.night = 1; writeSave();
    drawNewspaper();
    setScreen('news');
  });
  click('btn-continue', function () { beginNight(Math.min(loadSave().night, 5)); });
  click('btn-six', function () { beginNight(6); });
  click('btn-custom', function () { buildCustom(); setScreen('custom'); });
  click('news-go', function () { beginNight(1); });
  click('over-go', function () { setScreen('title'); });
  click('over-retry', function () { beginNight(lastNight, lastNight === 7 ? customLevels.slice() : null); });
  click('pay-go', function () { setScreen('title'); });
  click('pause-resume', function () { setPause(false); });
  click('pause-quit', function () { setPause(false); endCall(false); N.over = true; setScreen('title'); });
  click('custom-back', function () { setScreen('title'); });
  click('custom-go', function () { beginNight(7, customLevels.slice()); });

  function drawNewspaper() {
    var NP = STORY.NEWSPAPER;
    $('np-mast').textContent = NP.masthead;
    $('np-date').textContent = NP.date;
    $('np-head').textContent = NP.headline;
    $('np-sub').textContent = NP.sub;
    $('np-body').innerHTML = '';
    NP.body.forEach(function (p) { var el = document.createElement('p'); el.textContent = p; $('np-body').appendChild(el); });
    $('np-fine').textContent = NP.fine;
    $('np-side').innerHTML = '';
    NP.side.forEach(function (s) {
      var d = document.createElement('div'); d.className = 'np-item';
      var h = document.createElement('h4'); h.textContent = s[0];
      var p = document.createElement('p'); p.textContent = s[1];
      d.appendChild(h); d.appendChild(p); $('np-side').appendChild(d);
    });
    // a grainy photo of the grand opening
    var c = $('np-photo'), x = c.getContext('2d');
    x.save();
    x.scale(c.width / W, c.height / H);
    ROOMS.drawCam(x, 'stage', { occ: ['claudie', 'hallu', 'clippy'], t: 2, pan: 0.5 });
    x.restore();
    x.globalCompositeOperation = 'saturation'; x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = '#c9b58f'; x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 0.25; x.drawImage(NOISE[0], 0, 0, c.width, c.height); x.globalAlpha = 1;
  }

  function buildCustom() {
    var wrap = $('custom-cards');
    if (wrap.childNodes.length) return updateCustom();
    IDS.forEach(function (id, i) {
      var card = document.createElement('div'); card.className = 'cc';
      var c = document.createElement('canvas'); c.width = 220; c.height = 220;
      var x = c.getContext('2d'); x.fillStyle = '#050505'; x.fillRect(0, 0, 220, 220);
      if (window.CHARS) CHARS.face(x, id, 110, 115, 190, { t: 1, dark: 0.15, glow: true });
      var name = document.createElement('div'); name.className = 'cc-name'; name.textContent = (window.CHARS && CHARS.names && CHARS.names[id]) || id.toUpperCase();
      var blurb = document.createElement('div'); blurb.className = 'cc-blurb';
      blurb.textContent = { claudie: 'Only moves when unwatched.', hallu: 'Appears where it shouldn’t.', clippy: 'Eats your power.', captcha: 'Hates being ignored.' }[id];
      var row = document.createElement('div'); row.className = 'cc-row';
      var minus = document.createElement('button'); minus.textContent = '◀';
      var val = document.createElement('span'); val.className = 'cc-val'; val.id = 'cv-' + i;
      var plus = document.createElement('button'); plus.textContent = '▶';
      minus.onclick = function () { customLevels[i] = Math.max(0, customLevels[i] - 1); sfx('click'); updateCustom(); };
      plus.onclick = function () { customLevels[i] = Math.min(20, customLevels[i] + 1); sfx('click'); updateCustom(); };
      row.appendChild(minus); row.appendChild(val); row.appendChild(plus);
      card.appendChild(c); card.appendChild(name); card.appendChild(blurb); card.appendChild(row);
      wrap.appendChild(card);
    });
    updateCustom();
  }
  function updateCustom() { customLevels.forEach(function (v, i) { $('cv-' + i).textContent = v; }); }
  click('custom-20', function () { customLevels = [20, 20, 20, 20]; updateCustom(); });

  // ---------- test hooks (headless playtests drive the sim through these) ----------
  var api = {
    timeScale: 1,
    get N() { return N; },
    get screen() { return screen; },
    get call() { return call; },
    start: function (night, levels, opts) {
      opts = opts || {};
      newNight(night, levels);
      lastNight = night;
      showDom(null);
      screen = 'play'; screenT = 0;
      if (!opts.noCall) startCall();
      return N;
    },
    begin: beginNight,
    manual: function (v) { manual = v; },
    step: function (seconds, policy, dt) {
      dt = dt || 1 / 30;
      var n = Math.round(seconds / dt);
      for (var i = 0; i < n && !N.over; i++) {
        if (policy) policy(api);
        update(dt);
      }
      return { t: N.t, over: N.over, won: !!N.won, scare: N.scare && N.scare.id, power: N.power };
    },
    door: toggleDoor, light: toggleLight, cam: setCam, view: switchCam,
    perceive: function () {
      // only what a player could actually see right now
      var o = { t: N.t, power: N.power, camUp: N.camUp, cam: N.cam, doorL: N.doorL, doorR: N.doorR, dead: N.buttonsDead, powerOut: N.powerOut };
      if (N.lightL) o.atL = occupantAt('ldoor');
      if (N.lightR) o.atR = occupantAt('rdoor');
      if (N.camUp && N.camAnim > 0.95 && N.disrupt <= 0 && !ROOMS.CAM_BY_KEY[N.cam].audioOnly) {
        o.seen = IDS.filter(function (id) { return id !== 'captcha' && N.ch[id].loc === N.cam; });
        if (N.cam === 'cove') o.captcha = N.ch.captcha.stage;
        if (N.cam === 'whall' && N.ch.captcha.dash >= 0) o.running = true;
      }
      o.golden = N.golden.office;
      return o;
    },
    force: {
      golden: function () { N.golden.chance = 1; N.golden.used = false; },
      power: function (v) { N.power = v; },
      put: function (id, loc) { N.ch[id].loc = loc; },
      captcha: function (s) { N.ch.captcha.stage = s; if (s === 3) { N.ch.captcha.run = 0; N.ch.captcha.dash = -1; } },
      time: function (sec) { N.t = sec; N.hour = Math.floor(sec / HOUR); },
      save: function (s) { save = s; writeSave(); refreshMenu(); }
    },
    setScreen: setScreen, jumpscare: jumpscare,
    HOUR: HOUR, LEVELS: LEVELS
  };
  window.__claudies = api;

  // ---------- boot ----------
  ROOMS.prewarm();
  setScreen('title');
  requestAnimationFrame(frame);
})();
