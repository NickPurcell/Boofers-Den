/* Five Nights at Claudie's - sound engine.
 * Everything is synthesized with the Web Audio API: no files, no libraries.
 * Classic script: defines window.SFX. Every method is a silent no-op until
 * SFX.init() has run (call it from a user gesture), and never throws.
 *
 * Internals: every sound is built against the current engine `E`
 * ({ctx, master, verb, noise, loops}), so the same code can be rendered into an
 * OfflineAudioContext for testing via SFX._render(name, args, seconds).
 */
(function () {
  'use strict';

  var AC = window.AudioContext || window.webkitAudioContext;
  var E = null;               // current engine (swapped temporarily for offline renders)
  var masterLevel = 0.8;
  var fanOn = true;

  // ---------- small utils ----------
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function T() { return E.ctx.currentTime; }
  function warn(err) { try { console.warn('[SFX]', err); } catch (e) { /* ignore */ } }
  function sidePan(side, amt) {
    amt = amt == null ? 0.8 : amt;
    if (side === 'L' || side === 'l') return -amt;
    if (side === 'R' || side === 'r') return amt;
    return 0;
  }

  // ---------- waveshaper curves (context independent, cached) ----------
  var curves = {};
  function driveCurve(k) {            // smooth saturation, bigger k = dirtier
    var key = 'd' + k;
    if (curves[key]) return curves[key];
    var n = 2048, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    return (curves[key] = c);
  }
  function crushCurve(levels) {       // amplitude quantiser = bit-crush grit
    var key = 'c' + levels;
    if (curves[key]) return curves[key];
    var n = 4096, c = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; c[i] = Math.round(x * levels) / levels; }
    return (curves[key] = c);
  }
  function limitCurve() {             // safety soft-limiter; input is pre-scaled by 0.5 so it covers +-2
    if (curves.lim) return curves.lim;
    var n = 4096, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = (i * 2 / (n - 1) - 1) * 2, a = Math.abs(x);
      var y = a < 0.75 ? a : 0.75 + 0.23 * Math.tanh((a - 0.75) / 0.23);
      c[i] = x < 0 ? -y : y;
    }
    return (curves.lim = c);
  }

  // ---------- buffers: noise, crackle, reverb impulse ----------
  function noiseBuf(ctx, kind, secs) {
    var len = Math.floor(ctx.sampleRate * secs), buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0), b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      if (kind === 'pink') {           // Paul Kellet's filter
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5;
      } else d[i] = w;
    }
    var drift = d[len - 1] - d[0];      // remove drift so the loop seam doesn't click
    for (i = 0; i < len; i++) d[i] -= drift * i / len;
    return buf;
  }
  function crackleBuf(ctx, secs) {      // sparse pops, like dusty static
    var len = Math.floor(ctx.sampleRate * secs), buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0), n = Math.floor(secs * 30);
    for (var k = 0; k < n; k++) {
      var p = (Math.random() * (len - 64)) | 0, a = Math.pow(Math.random(), 2) * (Math.random() < 0.5 ? -1 : 1);
      for (var j = 0; j < 48; j++) d[p + j] += a * Math.exp(-j / 7) * (Math.random() * 2 - 1);
    }
    return buf;
  }
  function makeIR(ctx, secs, decay) {   // decaying, slowly darkening stereo noise
    var sr = ctx.sampleRate, len = Math.floor(sr * secs), buf = ctx.createBuffer(2, len, sr), pre = Math.floor(sr * 0.012);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = pre; i < len; i++) {
        var x = i / len;
        lp += ((Math.random() * 2 - 1) - lp) * (0.6 - 0.45 * x);
        d[i] = lp * Math.pow(1 - x, decay);
      }
    }
    return buf;
  }

  // ---------- engine ----------
  function makeEngine(ctx) {
    var e = { ctx: ctx, loops: {} };
    e.master = ctx.createGain();
    e.master.gain.value = masterLevel;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.25;
    var pre = ctx.createGain(); pre.gain.value = 0.5;
    var lim = ctx.createWaveShaper(); lim.curve = limitCurve();
    e.master.connect(comp); comp.connect(pre); pre.connect(lim); lim.connect(ctx.destination);
    e.verb = ctx.createConvolver();
    e.verb.buffer = makeIR(ctx, 2.6, 3);
    var vg = ctx.createGain(); vg.gain.value = 0.6;
    e.verb.connect(vg); vg.connect(e.master);
    e.noise = { white: noiseBuf(ctx, 'white', 3), pink: noiseBuf(ctx, 'pink', 3),
                brown: noiseBuf(ctx, 'brown', 3), crackle: crackleBuf(ctx, 3) };
    return e;
  }

  // ---------- Voice: tracks the nodes of one sound, frees them when its sources end ----------
  function Voice() { this.e = E; this.nodes = []; this.srcs = []; this.live = 0; this.onfree = null; }
  var VP = Voice.prototype;
  VP.keep = function (n, dest) { this.nodes.push(n); if (dest) n.connect(dest); return n; };
  VP.gain = function (v, dest) { var g = this.e.ctx.createGain(); g.gain.value = v; return this.keep(g, dest); };
  VP.filter = function (type, f, q, dest) {
    var b = this.e.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f;
    if (q != null) b.Q.value = q;
    return this.keep(b, dest);
  };
  VP.shaper = function (curve, dest) { var s = this.e.ctx.createWaveShaper(); s.curve = curve; return this.keep(s, dest); };
  VP.pan = function (p, dest) {
    var c = this.e.ctx, n;
    if (c.createStereoPanner) { n = c.createStereoPanner(); n.pan.value = p; }
    else { n = c.createPanner(); n.panningModel = 'equalpower'; n.setPosition(p, 0, 1 - Math.abs(p)); }
    return this.keep(n, dest);
  };
  VP.start = function (s, t0, t1, off) {
    var self = this;
    this.nodes.push(s); this.srcs.push(s); this.live++;
    s.onended = function () { s.onended = null; if (--self.live <= 0) self.free(); };
    if (off != null) s.start(t0, off); else s.start(t0);
    if (t1 != null) s.stop(t1);
    return s;
  };
  VP.osc = function (type, f, t0, t1, dest) {
    var o = this.e.ctx.createOscillator(); o.type = type; o.frequency.value = f;
    if (dest) o.connect(dest);
    return this.start(o, t0, t1);
  };
  VP.noise = function (kind, t0, t1, dest) {
    var s = this.e.ctx.createBufferSource(); s.buffer = this.e.noise[kind]; s.loop = true;
    if (dest) s.connect(dest);
    return this.start(s, t0, t1, rnd(0, s.buffer.duration - 0.5));
  };
  // input -> panner -> (dry to master, wet to reverb). Returns the input node.
  VP.out = function (pan, dry, wet, dest) {
    var inp = this.gain(1), p = this.pan(pan || 0);
    inp.connect(p);
    if (dry > 0) p.connect(this.gain(dry, dest || this.e.master));
    if (wet > 0) p.connect(this.gain(wet, this.e.verb));
    return inp;
  };
  VP.kill = function (t) { this.srcs.forEach(function (s) { try { s.stop(t); } catch (e) { /* already stopped */ } }); };
  VP.free = function () {
    this.nodes.forEach(function (n) { try { n.disconnect(); } catch (e) { /* ignore */ } });
    this.nodes = []; this.srcs = [];
    if (this.onfree) { var f = this.onfree; this.onfree = null; f(); }
  };

  // ---------- envelopes ----------
  function perc(p, t, peak, a, d) {     // attack then exponential-ish decay (~-35dB after d)
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a); p.setTargetAtTime(0, t + a, d / 4);
  }
  function swell(p, t, peak, a, hold, r) {
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
    p.setValueAtTime(peak, t + a + hold); p.linearRampToValueAtTime(0, t + a + hold + r);
  }
  function glide(p, t, f0, f1, dur) { p.setValueAtTime(f0, t); p.exponentialRampToValueAtTime(Math.max(f1, 0.01), t + dur); }
  function fadeTo(p, t, v, dur) {
    p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(v, t + dur);
  }

  // Common one-shot building blocks.
  function hit(v, dest, t, f0, f1, amp, dec) {          // pitched thud
    var g = v.gain(0, dest); perc(g.gain, t, amp, 0.004, dec);
    glide(v.osc('sine', f0, t, t + dec * 1.4, g).frequency, t, f0, f1, dec * 0.6);
  }
  function burst(v, dest, t, kind, type, f, q, amp, dec) { // filtered noise burst
    var g = v.gain(0, dest); perc(g.gain, t, amp, 0.002, dec);
    v.noise(kind, t, t + dec * 1.4 + 0.01, v.filter(type, f, q, g));
  }
  function ring(v, dest, t, freqs, amp, dec) {           // inharmonic metal partials
    freqs.forEach(function (f, i) {
      var g = v.gain(0, dest); perc(g.gain, t, amp / (1 + i * 0.4), 0.002, dec / (1 + i * 0.3));
      v.osc('sine', f * rnd(0.985, 1.015), t, t + dec * 1.4, g);
    });
  }

  // ---------- loops (continuous sounds) ----------
  function startLoop(name) {
    stopLoop(name, 0.05);
    var v = new Voice();
    var L = { name: name, e: E, v: v, bus: v.gain(0), timers: [], subs: [], dead: false };
    E.loops[name] = L;
    return L;
  }
  function stopLoop(name, fade) {
    var L = E.loops[name];
    if (!L) return;
    delete E.loops[name];
    L.dead = true;
    L.timers.forEach(function (id) { clearInterval(id); clearTimeout(id); });
    fade = fade == null ? 0.3 : fade;
    var t = L.e.ctx.currentTime, end = t + fade + 0.05;
    fadeTo(L.bus.gain, t, 0, fade);
    L.v.kill(end);
    L.subs.slice().forEach(function (s) { s.kill(end); });
    setTimeout(function () { L.v.free(); }, (fade + 0.3) * 1000);
  }
  function sub(L) {                     // per-event voice inside a loop
    var v = new Voice();
    L.subs.push(v);
    v.onfree = function () { var i = L.subs.indexOf(v); if (i >= 0) L.subs.splice(i, 1); };
    return v;
  }
  function fadeIn(L, v, dur) { var t = T(); L.bus.gain.setValueAtTime(0, t); L.bus.gain.linearRampToValueAtTime(v, t + dur); }
  function later(L, ms, fn) {           // loop-scoped timeout with the right engine selected
    L.timers.push(setTimeout(function () {
      if (L.dead) return;
      var saved = E; E = L.e;
      try { fn(); } catch (err) { warn(err); }
      E = saved;
    }, ms));
  }
  // Lookahead sequencer: events [{t,...}] repeat every `period` seconds (number or function).
  function looper(L, events, period, play) {
    var e = L.e, idx = 0, base = e.ctx.currentTime + 0.06;
    function tick() {
      if (L.dead) return;
      var saved = E; E = e;
      try {
        var now = e.ctx.currentTime, n = 0;
        if (base + events[events.length - 1].t < now - 0.5) { base = now + 0.06; idx = 0; } // throttled tab: resync
        while (n++ < 256) {
          var tt = base + events[idx].t;
          if (tt > now + 1.2) break;
          if (tt >= now - 0.05) play(events[idx], tt);
          if (++idx >= events.length) { idx = 0; base += typeof period === 'function' ? period() : period; }
        }
      } catch (err) { warn(err); }
      E = saved;
    }
    tick();
    L.timers.push(setInterval(tick, 250));
  }

  // =====================================================================
  // AMBIENCE: mains hum + desk fan + rare distant one-shots
  // =====================================================================
  function startAmbience() {
    var cur = E.loops.amb;
    if (cur && cur.powered) return;
    var L = startLoop('amb'), v = L.v, t = T();
    L.powered = true;
    L.bus.connect(E.master);
    fadeIn(L, 1, 2);
    // hum: 60 Hz and a few harmonics, with a slow breathing wobble
    var hum = L.hum = v.gain(1, L.bus), humLp = v.filter('lowpass', 600, 0.7, hum);
    [[60, 'sine', 0.022], [120, 'sine', 0.012], [180, 'triangle', 0.005], [240, 'sawtooth', 0.003]].forEach(function (h) {
      v.osc(h[1], h[0] * rnd(0.998, 1.002), t, null, v.gain(h[2], humLp));
    });
    v.osc('sine', 0.23, t, null, v.gain(0.15, hum.gain));
    // fan: noise with blade-rate amplitude modulation + motor rumble
    var fan = L.fan = v.gain(fanOn ? 1 : 0, L.bus);
    var blade = v.gain(0.7, fan);
    L.fanLfo = v.osc('sine', 9.5, t, null, v.gain(0.3, blade.gain));
    var bp = L.fanBp = v.filter('bandpass', 850, 0.6, v.gain(0.05, blade));
    v.noise('pink', t, null, bp);
    v.osc('sine', 0.13, t, null, v.gain(120, bp.frequency));
    v.noise('brown', t, null, v.filter('lowpass', 180, 1, v.gain(0.08, blade)));
    v.osc('triangle', 47, t, null, v.gain(0.004, fan));
    // distant unsettling events every 20-60 s
    (function next(first) {
      later(L, first ? rnd(9000, 20000) : rnd(20000, 60000), function () { pick(DISTANT)(); next(false); });
    })(true);
  }

  function setFan(on) {
    fanOn = !!on;
    var L = E && E.loops.amb;
    if (!L) return;
    var t = T();
    fadeTo(L.fan.gain, t, fanOn ? 1 : 0, fanOn ? 1.2 : 0.5);
    fadeTo(L.fanLfo.frequency, t, fanOn ? 9.5 : 2, fanOn ? 1.2 : 0.5);
  }

  var DISTANT = [
    function clunk() {                  // far-off metallic clunk
      var v = new Voice(), t = T() + 0.02, o = v.filter('lowpass', 1400, 0.7, v.out(rnd(-0.8, 0.8), 0.12, 0.9));
      hit(v, o, t, 85, 45, 0.3, 0.4);
      ring(v, o, t, [311, 523, 877], 0.04, 0.8);
      burst(v, o, t, 'white', 'bandpass', 1200, 1, 0.08, 0.06);
    },
    function toyNote() {                // warped childlike toy note(s)
      var v = new Voice(), t = T() + 0.02, o = v.out(rnd(-0.7, 0.7), 0.08, 1);
      var sh = v.shaper(driveCurve(4), v.gain(0.4, o)), f = mtof(pick([76, 79, 81, 84]));
      [0, 0.55].forEach(function (dt, i) {
        var g = v.gain(0, sh); perc(g.gain, t + dt, 0.12, 0.004, 1.3);
        var s = v.osc('triangle', f * (i ? 0.944 : 1), t + dt, t + dt + 1.8, g);
        s.detune.setValueAtTime(0, t + dt); s.detune.linearRampToValueAtTime(-60, t + dt + 1.5);
      });
    },
    function rumble() {                 // low sub rumble swell
      var v = new Voice(), t = T() + 0.02, o = v.out(0, 0.6, 0.3), g = v.gain(0, o);
      swell(g.gain, t, 0.35, 1.5, 1, 2);
      v.noise('brown', t, t + 4.6, v.filter('lowpass', 90, 1, g));
      v.osc('sine', 31, t, t + 4.6, v.gain(0.35, g));
    },
    function blip() {                   // a machine somewhere dying
      var v = new Voice(), t = T() + 0.02, o = v.filter('bandpass', 1500, 1, v.out(rnd(-0.8, 0.8), 0.15, 0.8));
      [0, 0.3, 0.8].forEach(function (dt, i) {
        var ts = t + dt, g = v.gain(0, o), f = 900 * Math.pow(0.88, i);
        perc(g.gain, ts, 0.15 * (1 - i * 0.25), 0.003, 0.12);
        glide(v.osc('square', f, ts, ts + 0.2, g).frequency, ts, f, f * 0.8, 0.1);
      });
    }
  ];

  // =====================================================================
  // OFFICE: doors, lights, footsteps, banging
  // =====================================================================
  function doorSlam(side) {
    var v = new Voice(), t = T() + 0.01, ti = t + 0.09, o = v.out(sidePan(side, 0.75), 1, 0.3);
    // rattle as it drops
    var rg = v.gain(0, o);
    rg.gain.setValueAtTime(0, t); rg.gain.linearRampToValueAtTime(0.18, ti); rg.gain.linearRampToValueAtTime(0, ti + 0.01);
    v.noise('white', t, ti + 0.02, v.filter('bandpass', 1300, 1.2, rg));
    v.osc('square', 38, t, ti, v.gain(0.12, rg.gain));
    // impact: crash + thud + body + ring
    var cg = v.gain(0, o); perc(cg.gain, ti, 0.7, 0.002, 0.5);
    var lp = v.filter('lowpass', 6000, 0.8, v.shaper(driveCurve(4), cg));
    glide(lp.frequency, ti, 6000, 700, 0.4);
    v.noise('white', ti, ti + 0.8, lp);
    hit(v, o, ti, 85, 38, 1.1, 0.5);
    burst(v, o, ti, 'brown', 'lowpass', 150, 1, 0.8, 0.4);
    ring(v, o, ti, [220, 587, 1043, 1611, 2403], 0.06, 1.2);
  }

  function doorOpen(side) {
    var v = new Voice(), t = T() + 0.01, o = v.out(sidePan(side, 0.75), 1, 0.2);
    var g = v.gain(0, o); swell(g.gain, t, 0.16, 0.08, 0.25, 0.1);
    var lp = v.filter('lowpass', 700, 3, g);
    glide(v.osc('sawtooth', 90, t, t + 0.5, lp).frequency, t, 90, 150, 0.4);
    v.osc('square', 45, t, t + 0.5, v.gain(0.4, lp));
    var tc = t + 0.42;
    burst(v, o, tc, 'white', 'bandpass', 1500, 2, 0.35, 0.08);
    hit(v, o, tc, 180, 90, 0.4, 0.15);
    ring(v, o, tc, [700, 1350], 0.03, 0.3);
  }

  function lightBuzz(side, on) {
    var name = 'light' + (side === 'R' || side === 'r' ? 'R' : 'L');
    if (!on) return stopLoop(name, 0.06);
    if (E.loops[name]) return;
    var L = startLoop(name), v = L.v, t = T();
    L.bus.connect(v.out(sidePan(side, 0.7), 1, 0.1));
    var bg = L.bus.gain;                // fluorescent 'tink' flicker on start
    bg.setValueAtTime(0, t); bg.linearRampToValueAtTime(1, t + 0.015);
    bg.setValueAtTime(0.15, t + 0.05); bg.setValueAtTime(1, t + 0.09);
    var am = v.gain(1, L.bus);
    v.osc('square', 13.3, t, null, v.gain(0.08, am.gain));
    v.osc('sine', 0.7, t, null, v.gain(0.1, am.gain));
    var saw = v.osc('sawtooth', 120, t, null);
    saw.connect(v.filter('bandpass', 240, 2, v.gain(0.06, am)));
    saw.connect(v.filter('highpass', 1500, 0.7, v.gain(0.012, am)));
    v.osc('square', 60, t, null, v.filter('lowpass', 200, 1, v.gain(0.02, am)));
    v.noise('crackle', t, null, v.filter('highpass', 2000, 0.7, v.gain(0.1, am)));
  }

  function step(v, o, ts, amp, servo) {
    hit(v, o, ts, 75, 42, amp, 0.28);
    burst(v, o, ts, 'brown', 'lowpass', 260, 1, amp * 0.9, 0.2);
    burst(v, o, ts + 0.01, 'white', 'bandpass', 1800, 3, amp * 0.12, 0.04);
    if (servo) {
      var g = v.gain(0, o); perc(g.gain, ts + 0.05, amp * 0.05, 0.05, 0.3);
      var s = v.osc('sawtooth', 700, ts + 0.05, ts + 0.5, v.filter('bandpass', 1200, 4, g));
      s.frequency.setValueAtTime(700, ts + 0.05); s.frequency.linearRampToValueAtTime(1100, ts + 0.2);
      s.frequency.linearRampToValueAtTime(900, ts + 0.4);
    }
  }

  function footsteps(side, n) {
    n = n == null ? 3 : n;
    var v = new Voice(), t = T() + 0.02;
    var o = v.filter('lowpass', 1800, 0.7, v.out(sidePan(side, 0.7), 0.7, 0.45));
    for (var i = 0; i < n; i++) step(v, o, t + i * 0.55 + rnd(-0.03, 0.03), 0.55, true);
    return n * 0.55;
  }

  function runSteps(side) {
    var v = new Voice(), t = T() + 0.02, ts = t, gap = 0.3, p = sidePan(side || 'L', 1);
    var lp = v.filter('lowpass', 600, 0.7, v.out(p * 0.8, 0.8, 0.35));
    for (var i = 0; i < 8; i++) { step(v, lp, ts, 0.25 + i * 0.1, false); ts += gap; gap *= 0.86; }
    lp.frequency.setValueAtTime(600, t); lp.frequency.exponentialRampToValueAtTime(4000, ts);
    return ts - t;
  }

  function bang(n) {
    n = n || (Math.random() < 0.5 ? 3 : 4);
    var v = new Voice(), t = T() + 0.02, o = v.out(-0.75, 1, 0.35), tb = t;
    var dirty = v.shaper(driveCurve(6), v.gain(0.9, o));
    for (var i = 0; i < n; i++) {
      var a = 0.8 + 0.2 * i / n;
      hit(v, o, tb, 120, 45, a, 0.35);
      burst(v, dirty, tb, 'white', 'bandpass', 700, 0.8, a * 0.8, 0.3);
      ring(v, o, tb, [410, 1030, 1740], 0.07, 0.9);
      tb += rnd(0.38, 0.5);
    }
    return tb - t;
  }

  // =====================================================================
  // CAMERA TABLET + PHONE
  // =====================================================================
  function click(dest, t, amp) {
    var v = new Voice(); t = t || T() + 0.005; amp = amp || 1;
    var o = dest || v.out(0, 1, 0);
    burst(v, o, t, 'white', 'highpass', 2500, 0.7, 0.5 * amp, 0.015);
    var g = v.gain(0, o); perc(g.gain, t, 0.12 * amp, 0.001, 0.03);
    glide(v.osc('sine', 1500, t, t + 0.06, g).frequency, t, 1500, 900, 0.03);
  }

  function camFlip(up) {
    var v = new Voice(), t = T() + 0.01, d = 0.22, o = v.out(0, 1, 0.05);
    var g = v.gain(0, o);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + d * 0.6); g.gain.linearRampToValueAtTime(0, t + d);
    var bp = v.filter('bandpass', up ? 500 : 2800, 1.2, g);
    glide(bp.frequency, t, up ? 500 : 2800, up ? 2800 : 500, d);
    v.noise('pink', t, t + d + 0.02, bp);
    click(o, t + d, 1);
    hit(v, o, t + d, 300, 200, 0.12, 0.04);
  }

  function camBlip() {
    var v = new Voice(), t = T() + 0.005, o = v.out(0, 1, 0.05);
    var lp = v.filter('lowpass', 3000, 0.7, o);
    [[1320, 0], [1760, 0.045]].forEach(function (b) {
      var g = v.gain(0, lp); swell(g.gain, t + b[1], 0.1, 0.003, 0.035, 0.01);
      v.osc('square', b[0], t + b[1], t + b[1] + 0.06, g);
    });
    burst(v, o, t, 'white', 'bandpass', 3000, 0.5, 0.08, 0.08);
    click(o, t, 0.6);
  }

  function staticBurst(dur) {
    dur = dur == null ? 0.4 : Math.max(0.05, dur);
    var v = new Voice(), t = T() + 0.005, o = v.out(0, 1, 0);
    var g = v.gain(0, o); swell(g.gain, t, 0.35, 0.01, Math.max(0, dur - 0.09), 0.08);
    var rough = v.gain(0.7, g);
    v.osc('sawtooth', 60, t, t + dur + 0.02, v.gain(0.3, rough.gain));
    var cr = v.shaper(crushCurve(8), rough);
    v.noise('white', t, t + dur + 0.02, v.filter('highpass', 400, 0.7, cr));
    v.noise('crackle', t, t + dur + 0.02, v.gain(0.6, cr));
  }

  function camStatic(on) {
    if (!on) return stopLoop('camStatic', 0.12);
    if (E.loops.camStatic) return;
    var L = startLoop('camStatic'), v = L.v, t = T();
    L.bus.connect(E.master);
    fadeIn(L, 1, 0.15);
    v.noise('white', t, null, v.filter('bandpass', 3000, 0.4, v.gain(0.03, L.bus)));
    v.noise('crackle', t, null, v.filter('highpass', 1500, 0.7, v.gain(0.06, L.bus)));
    v.osc('sine', 0.4, t, null, v.gain(0.25, L.bus.gain));
  }

  function phoneRing(on) {
    if (!on) return stopLoop('phone', 0.05);
    if (E.loops.phone) return;
    var L = startLoop('phone');
    L.bus.connect(L.v.out(0.15, 0.9, 0.2));
    L.bus.gain.value = 0.25;
    looper(L, [{ t: 0 }], 6, function (ev, t) {   // ring 2 s, silence 4 s
      var v = sub(L), d = 2, env = v.gain(0, L.bus);
      env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(1, t + 0.03);
      env.gain.setValueAtTime(1, t + d - 0.05); env.gain.linearRampToValueAtTime(0, t + d);
      var am = v.gain(0.5, env);
      v.osc('sine', 20, t, t + d + 0.05, v.gain(0.5, am.gain));
      var sh = v.shaper(driveCurve(3), am);
      v.osc('sine', 440, t, t + d + 0.05, v.gain(0.45, sh));
      v.osc('sine', 480, t, t + d + 0.05, v.gain(0.45, sh));
    });
  }

  function phonePickup() {
    stopLoop('phone', 0.02);
    var v = new Voice(), t = T() + 0.005, o = v.out(0.15, 1, 0.05);
    click(o, t, 1.2); click(o, t + 0.06, 0.6);
    burst(v, o, t + 0.02, 'pink', 'bandpass', 800, 1, 0.08, 0.15);
  }

  function phoneHangup() {
    stopLoop('phone', 0.02);
    var v = new Voice(), t = T() + 0.005, o = v.out(0.15, 1, 0.05);
    hit(v, o, t, 250, 120, 0.4, 0.06);
    click(o, t, 1);
    var td = t + 0.25, g = v.gain(0, v.filter('bandpass', 1000, 0.7, o));
    swell(g.gain, td, 0.1, 0.01, 0.33, 0.02);
    v.osc('sine', 350, td, td + 0.4, g); v.osc('sine', 440, td, td + 0.4, g);
  }

  // =====================================================================
  // MUSIC: music box, title bed, 6 AM chime + cheer
  // =====================================================================
  // Original minor-key tune (A minor, creeping chromatic). [midi, beats]
  var MELODY = [[76, 1], [72, 1], [69, 1], [71, .5], [72, .5], [71, 1], [68, 1], [64, 2],
                [76, 1], [72, 1], [69, 1], [72, .5], [74, .5], [75, 1], [74, 1], [72, 2],
                [69, 1], [72, 1], [71, 1], [68, 1], [65, 1], [64, 1], [63, 1], [64, 1],
                [57, 2], [0, 2]];
  var BASS = [[57, 0], [52, 4], [57, 8], [53, 12], [50, 16], [52, 20], [45, 24]];
  var BEAT = 0.42, LOOP_BEATS = 28;
  var BOX_EVENTS = (function () {
    var ev = [], b = 0;
    MELODY.forEach(function (n) { if (n[0]) ev.push({ t: b * BEAT, m: n[0] + 12, vel: 0.2 }); b += n[1]; });
    BASS.forEach(function (n) { ev.push({ t: n[1] * BEAT + 0.005, m: n[0] + 12, vel: 0.11 }); });
    return ev.sort(function (a, b) { return a.t - b.t; });
  })();

  // Music-box tine: fundamental + 2 inharmonic partials, sagging pitch.
  function bell(v, dest, f, t, vel, det) {
    var parts = [[1, 1, 1.6], [2.01, 0.35, 0.35], [4.2, 0.18, 0.12]];
    parts.forEach(function (p) {
      var g = v.gain(0, dest); perc(g.gain, t, vel * p[1], 0.003, p[2]);
      var o = v.osc('sine', f * p[0], t, t + p[2] * 1.3 + 0.05, g);
      o.detune.setValueAtTime(det, t); o.detune.linearRampToValueAtTime(det - rnd(4, 14), t + p[2]);
    });
  }

  function musicBox(on, opts) {
    if (!on) return stopLoop('mbox', 0.6);
    if (E.loops.mbox) return;
    var L = startLoop('mbox'), pan = (opts && opts.pan) || 0;
    L.bus.connect(L.v.out(pan, 0.9, 0.5));
    fadeIn(L, 1, 0.1);
    looper(L, BOX_EVENTS, function () { return LOOP_BEATS * BEAT + rnd(0, 0.35); }, function (ev, t) {
      if (Math.random() < 0.04) return;              // a broken tine skips
      var wow = 14 * Math.sin(t * 1.46) + 8 * Math.sin(t * 4.8) + rnd(-6, 6);
      if (Math.random() < 0.05) wow -= 50;            // sour note
      bell(sub(L), L.bus, mtof(ev.m), t + rnd(-0.01, 0.02), ev.vel, wow);
    });
  }

  function titleMusic(on) {
    if (!on) return stopLoop('title', 1.5);
    if (E.loops.title) return;
    var L = startLoop('title'), v = L.v, t = T();
    L.bus.connect(E.master); L.bus.connect(v.gain(0.35, E.verb));
    fadeIn(L, 1, 3);
    // dark detuned drone with a slowly breathing filter
    var lp = v.filter('lowpass', 240, 5, v.gain(1, L.bus));
    [55, 55.35, 58.27].forEach(function (f) { v.osc('sawtooth', f, t, null, v.gain(0.05, lp)); });
    v.osc('sine', 0.06, t, null, v.gain(120, lp.frequency));
    v.osc('sine', 27.5, t, null, v.gain(0.12, L.bus));
    // faint eerie minor-second whine that swells and fades
    var eg = v.gain(0.006, L.bus);
    v.osc('sine', 0.04, t, null, v.gain(0.006, eg.gain));
    v.osc('sine', 880, t, null, eg); v.osc('sine', 932.3, t, null, eg);
    // static crackle + hiss
    v.noise('crackle', t, null, v.filter('highpass', 1200, 0.7, v.gain(0.05, L.bus)));
    v.noise('white', t, null, v.filter('highpass', 4000, 0.7, v.gain(0.004, L.bus)));
    // distant music-box fragments
    (function frag(first) {
      later(L, first ? rnd(2500, 5000) : rnd(6000, 14000), function () {
        var sv = sub(L), o = sv.pan(rnd(-0.7, 0.7), L.bus), s = (Math.random() * (MELODY.length - 6)) | 0;
        var ts = T() + 0.05, tr = pick([0, 0, -12]), det = rnd(-40, -10);
        for (var i = 0; i < 3 + ((Math.random() * 3) | 0); i++) {
          var n = MELODY[s + i];
          if (n[0]) bell(sv, o, mtof(n[0] + 12 + tr), ts, 0.07, det - i * 6);
          ts += n[1] * 0.6;
        }
        frag(false);
      });
    })(true);
  }

  // Church-bell partials: [ratio, amplitude, decay seconds]
  var BELL = [[0.5, 0.5, 6], [1, 1, 5], [1.183, 0.6, 3.5], [1.506, 0.35, 3], [2, 0.5, 2.5], [2.514, 0.25, 1.8], [3.011, 0.15, 1.2]];
  function chime() {
    var v = new Voice(), t = T() + 0.05, o = v.out(0, 0.6, 0.9), f = 196, gap = 1.9;
    for (var i = 0; i < 6; i++) {
      var ts = t + i * gap;
      BELL.forEach(function (p) {
        var g = v.gain(0, o); perc(g.gain, ts, p[1] * 0.17, 0.003, p[2]);
        v.osc('sine', f * p[0] * rnd(0.999, 1.001), ts, ts + p[2] * 1.2, g);
      });
      burst(v, o, ts, 'white', 'bandpass', 2500, 2, 0.12, 0.03);
    }
    return 5 * gap + 5;
  }

  function cheer() {
    var v = new Voice(), t = T() + 0.02, dur = 4.2, o = v.out(0, 1.2, 1), i;
    // crowd bed: noise through wobbling formant bands
    for (i = 0; i < 5; i++) {
      var g = v.gain(0, v.pan(rnd(-0.8, 0.8), o)), ts = t + rnd(0, 0.3);
      swell(g.gain, ts, 0.09, 0.35, dur * 0.45, 1.6);
      var bp = v.filter('bandpass', rnd(900, 1600), 5, g);
      v.noise('pink', ts, ts + dur + 0.3, bp);
      v.osc('sine', rnd(3, 7), ts, ts + dur + 0.3, v.gain(rnd(200, 400), bp.frequency));
    }
    // kids' "yaaay!" voices: rising then falling saws through two formants
    for (i = 0; i < 7; i++) {
      var tv = t + rnd(0, 1.2), f = rnd(330, 520), len = rnd(0.7, 1.4);
      var gv = v.gain(0, v.pan(rnd(-0.9, 0.9), o));
      swell(gv.gain, tv, 0.18, 0.08, len * 0.5, len * 0.4);
      var sum = v.gain(1);
      sum.connect(v.filter('bandpass', rnd(800, 1000), 4, gv));
      sum.connect(v.filter('bandpass', rnd(1600, 2100), 5, v.gain(0.6, gv)));
      var s = v.osc('sawtooth', f, tv, tv + len + 0.1, sum);
      s.frequency.setValueAtTime(f, tv); s.frequency.linearRampToValueAtTime(f * 1.35, tv + len * 0.3);
      s.frequency.linearRampToValueAtTime(f * 0.9, tv + len);
      v.osc('sine', rnd(5, 7), tv, tv + len + 0.1, v.gain(25, s.detune));
    }
    // scattered claps (one noise source, many envelopes)
    var cg = v.gain(0, o), times = [];
    for (i = 0; i < 26; i++) times.push(t + rnd(0.2, 3.2));
    times.sort();
    times.forEach(function (tc) {
      cg.gain.setValueAtTime(0, tc); cg.gain.linearRampToValueAtTime(rnd(0.1, 0.25), tc + 0.002);
      cg.gain.setTargetAtTime(0, tc + 0.002, 0.012);
    });
    v.noise('white', t, t + 3.4, v.filter('bandpass', 1500, 1.5, cg));
    return dur + 1.8;
  }

  // =====================================================================
  // SCARES
  // =====================================================================
  // layers: n detuned oscillators, f = [start, peak, end] Hz, spread in cents
  var SCREAMS = {
    claudie: { d: 1.3, drive: 40, crush: 24, lvl: 0.95, vib: [8, 70], noise: [1800, 0.5],
      layers: [{ n: 4, type: 'sawtooth', f: [70, 140, 55], spread: 25, lvl: 0.4 },
               { n: 5, type: 'sawtooth', f: [650, 1600, 700], spread: 45, lvl: 0.3 }] },
    hallu: { d: 1.2, drive: 25, crush: 6, rm: 2900, rmMix: 0.4, lvl: 0.9, vib: [31, 120], noise: [3000, 0.4], stutter: true,
      layers: [{ n: 4, type: 'square', f: [900, 2300, 600], spread: 60, lvl: 0.25, steps: true },
               { n: 2, type: 'sawtooth', f: [180, 260, 120], spread: 30, lvl: 0.3 }] },
    clippy: { d: 1.3, drive: 18, crush: 32, rm: 1130, rmMix: 0.5, lvl: 0.9, vib: [23, 150], noise: [4200, 0.3],
      metal: [1730, 2890, 4470, 6120],
      layers: [{ n: 4, type: 'square', f: [2400, 3800, 2000], spread: 35, lvl: 0.18 },
               { n: 3, type: 'sawtooth', f: [190, 240, 85], spread: 20, lvl: 0.3 }] },
    captcha: { d: 1.25, drive: 15, crush: 16, rm: 1370, rmMix: 0.8, lvl: 0.85, vib: [11, 40], noise: [5000, 0.25],
      layers: [{ n: 4, type: 'sawtooth', f: [1900, 3500, 2700], spread: 20, lvl: 0.28 },
               { n: 1, type: 'square', f: [3950, 4100, 3900], spread: 0, lvl: 0.12 }] },
    golden: { d: 1.6, drive: 250, crush: 5, rm: 740, rmMix: 0.3, lvl: 1.0, vib: [6, 90], noise: [900, 0.9],
      layers: [{ n: 5, type: 'sawtooth', f: [42, 75, 32], spread: 40, lvl: 0.5 },
               { n: 5, type: 'sawtooth', f: [1700, 3100, 1100], spread: 50, lvl: 0.28 }] }
  };
  function screamDur(kind) { return (SCREAMS[kind] || SCREAMS.claudie).d; }

  function scream(kind) {
    var c = SCREAMS[kind] || SCREAMS.claudie, v = new Voice(), t = T() + 0.01, d = c.d, end = t + d + 0.05;
    var env = v.gain(0, v.out(0, 1, 0.25));
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(c.lvl, t + 0.015);
    env.gain.setValueAtTime(c.lvl, t + d * 0.6); env.gain.linearRampToValueAtTime(0, t + d);
    // sum -> gate -> drive -> crush -> tone -> env
    var drive = v.shaper(driveCurve(c.drive), v.shaper(crushCurve(c.crush), v.filter('lowpass', 9000, 0.7, env)));
    var gate = v.gain(1, drive), sum = v.gain(1, gate);
    if (c.rm) {                        // ring-mod grit
      var rmg = v.gain(0, v.gain(c.rmMix, drive));
      gate.connect(rmg);
      v.osc('square', c.rm, t, end, rmg.gain);
    }
    if (c.stutter) for (var s = t + 0.08; s < t + d; s += rnd(0.02, 0.07)) gate.gain.setValueAtTime(Math.random() < 0.3 ? 0 : 1, s);
    var vib = v.gain(c.vib[1]);
    v.osc('sine', c.vib[0], t, end, vib);
    c.layers.forEach(function (L) {
      var lg = v.gain(L.lvl / Math.sqrt(L.n), sum), steps = [];
      if (L.steps) for (var st = t; st < t + d; st += rnd(0.03, 0.09)) steps.push([st, pick(L.f) * rnd(0.8, 1.3)]);
      for (var i = 0; i < L.n; i++) {
        var r = Math.pow(2, (L.n > 1 ? (i / (L.n - 1) - 0.5) * 2 * L.spread : 0) / 1200) * rnd(0.995, 1.005);
        var o = v.osc(L.type, L.f[0] * r, t, end, lg), fq = o.frequency;
        if (L.steps) steps.forEach(function (p) { fq.setValueAtTime(p[1] * r, p[0]); });
        else {
          fq.setValueAtTime(L.f[0] * r, t);
          fq.exponentialRampToValueAtTime(L.f[1] * r, t + d * 0.18);
          fq.exponentialRampToValueAtTime(L.f[2] * r, t + d);
        }
        vib.connect(o.detune);
      }
    });
    var ng = v.gain(c.noise[1], sum), nb = v.filter('bandpass', c.noise[0], 0.8, ng);
    nb.frequency.setValueAtTime(c.noise[0] * 0.6, t);
    nb.frequency.exponentialRampToValueAtTime(c.noise[0] * 1.5, t + d * 0.2);
    nb.frequency.exponentialRampToValueAtTime(c.noise[0] * 0.7, t + d);
    var ns = v.noise('white', t, end, nb);
    if (c.metal) c.metal.forEach(function (f) { ns.connect(v.filter('bandpass', f, 35, v.gain(4, sum))); });
    return d;
  }

  function laugh() {
    var v = new Voice(), t = T() + 0.02, o = v.out(0, 0.8, 0.5);
    var post = v.shaper(driveCurve(6), v.gain(0.45, o));
    var sum = v.gain(1), pre = v.shaper(driveCurve(3), sum);
    // formant filters shared by all syllables ("hah" gliding toward "hoh")
    var f2 = null;
    [[650, 6, 1], [1100, 7, 0.5], [2450, 9, 0.25]].forEach(function (f, i) {
      var bp = v.filter('bandpass', f[0], f[1], v.gain(f[2] * 3, post));
      sum.connect(bp);
      if (i === 1) f2 = bp;
    });
    sum.connect(v.filter('lowpass', 300, 1, v.gain(0.4, post)));
    var vib = v.gain(12), n = 4, gap = 0.44, len = 0.32, pitches = [98, 94, 88, 80];
    v.osc('sine', 5.5, t, t + n * gap + 0.3, vib);
    for (var i = 0; i < n; i++) {
      var ts = t + i * gap, p = pitches[i];
      // aspiration "h"
      var hn = v.gain(0, sum); swell(hn.gain, ts, 0.25, 0.02, 0.03, 0.03);
      v.noise('pink', ts, ts + 0.1, hn);
      // voiced part: two saws + sub square
      var gs = v.gain(0, pre);
      gs.gain.setValueAtTime(0, ts + 0.04); gs.gain.linearRampToValueAtTime(0.5, ts + 0.09);
      gs.gain.setTargetAtTime(0, ts + len * 0.75, 0.05);
      [['sawtooth', 1, 0], ['sawtooth', 1, 15], ['square', 0.5, 0]].forEach(function (s) {
        var o = v.osc(s[0], p * s[1], ts, ts + len + 0.25, s[0] === 'square' ? v.gain(0.3, gs) : gs);
        glide(o.frequency, ts, p * s[1] * 1.08, p * s[1] * 0.9, len);
        o.detune.value = s[2];
        vib.connect(o.detune);
      });
      f2.frequency.setValueAtTime(1100, ts); f2.frequency.linearRampToValueAtTime(800, ts + len);
    }
    return n * gap + 0.3;
  }

  function clank() {
    var v = new Voice(), t = T() + 0.02;
    // band-limited like it's coming through a camera mic
    var o = v.filter('highpass', 350, 0.7, v.filter('lowpass', 3800, 0.7, v.shaper(driveCurve(2), v.out(rnd(-0.3, 0.3), 0.7, 0.4))));
    for (var i = 0; i < 8; i++) {
      var th = t + rnd(0, 1.5), a = rnd(0.2, 0.5);
      burst(v, o, th, 'white', 'bandpass', rnd(1000, 5000), 8, a, 0.06);
      ring(v, o, th, [rnd(300, 900), rnd(1100, 2600)], a * 0.25, rnd(0.15, 0.5));
    }
    // a bending-wire squeal
    var g = v.gain(0, o); swell(g.gain, t + 0.3, 0.03, 0.2, 0.5, 0.3);
    var s = v.osc('sine', 1200, t + 0.3, t + 1.35, g);
    glide(s.frequency, t + 0.3, 1200, 1900, 1);
    v.osc('sine', 17, t + 0.3, t + 1.35, v.gain(60, s.detune));
    return 1.8;
  }

  function glitch() {
    var v = new Voice(), t = T() + 0.01, dur = rnd(0.3, 0.6), end = t + dur;
    var cr = v.shaper(crushCurve(4), v.gain(0.3, v.out(rnd(-0.3, 0.3), 0.8, 0.1)));
    var gs = v.gain(0, cr), gn = v.gain(0, cr);
    var sq = v.osc('square', 800, t, end + 0.05, gs);
    v.noise('white', t, end + 0.05, gn);
    var tt = t;
    while (tt < end) {
      var len = rnd(0.015, 0.06), f = pick([220, 440, 660, 1320, 1760, 2637, 3520]), ty = Math.random();
      var reps = Math.random() < 0.35 ? 2 + ((Math.random() * 3) | 0) : 1;
      for (var r = 0; r < reps && tt < end; r++) {
        sq.frequency.setValueAtTime(f, tt);
        gs.gain.setValueAtTime(ty < 0.6 ? 0.5 : 0, tt);
        gn.gain.setValueAtTime(ty > 0.4 ? 0.4 : 0, tt);
        tt += len;
        gs.gain.setValueAtTime(0, tt); gn.gain.setValueAtTime(0, tt);
        tt += rnd(0, 0.015);
      }
    }
    gs.gain.setValueAtTime(0, end); gn.gain.setValueAtTime(0, end);
    return dur;
  }

  function windowScare() {
    var v = new Voice(), t = T() + 0.005, o = v.out(0, 1, 0.3);
    var g = v.gain(0, o);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.8, t + 0.01); g.gain.setTargetAtTime(0, t + 0.25, 0.2);
    var sum = v.gain(0.12, v.shaper(driveCurve(8), g));
    [233, 247, 349, 370, 523, 554, 740, 784].forEach(function (f) {
      var s = v.osc('sawtooth', f * rnd(0.997, 1.003), t, t + 1.3, sum);
      s.detune.setValueAtTime(0, t + 0.3); s.detune.linearRampToValueAtTime(-80, t + 1.2);
    });
    hit(v, o, t, 70, 35, 0.9, 0.5);
    burst(v, o, t, 'white', 'bandpass', 2500, 1, 0.6, 0.3);
    return 1.2;
  }

  function groan() {
    var v = new Voice(), t = T() + 0.02, d = 2.8, end = t + d + 0.1, o = v.out(rnd(-0.2, 0.2), 0.8, 0.5);
    var lp = v.filter('lowpass', 300, 2, v.gain(0.35, o));
    lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(800, t + d * 0.45);
    lp.frequency.linearRampToValueAtTime(250, t + d);
    var src = v.gain(0, v.shaper(driveCurve(10), lp));
    swell(src.gain, t, 0.5, 0.6, d - 1.6, 1);
    var w1 = v.gain(25), w2 = v.gain(80);
    v.osc('sine', 3.1, t, end, w1); v.osc('sine', 0.7, t, end, w2);
    [52, 52.7].forEach(function (f) {
      var s = v.osc('sawtooth', f, t, end, src);
      glide(s.frequency, t, f, f * 0.85, d);
      w1.connect(s.detune); w2.connect(s.detune);
    });
    var bg = v.gain(0, o); swell(bg.gain, t + 0.2, 0.15, 0.8, 0.8, 1);   // breath
    v.noise('pink', t, end, v.filter('bandpass', 600, 1.5, bg));
    var cg = v.gain(0, o); swell(cg.gain, t + 0.4, 0.08, 0.5, 1, 0.8);   // servo grind
    v.osc('sawtooth', 18, t, end, v.filter('bandpass', 1800, 12, cg));
    return d;
  }

  function powerDown() {
    var t = T() + 0.01, L = E.loops.amb;
    fanOn = false;
    if (L) {
      L.powered = false;
      fadeTo(L.hum.gain, t, 0, 0.15);
      fadeTo(L.fan.gain, t, 0, 2.5);                 // fan spins down
      fadeTo(L.fanLfo.frequency, t, 1, 2.5);
      fadeTo(L.fanBp.frequency, t, 300, 2.5);
    }
    stopLoop('lightL', 0.05); stopLoop('lightR', 0.05); stopLoop('camStatic', 0.05);
    var v = new Voice(), o = v.out(0, 1, 0.5);
    hit(v, o, t, 90, 30, 1, 0.7);                    // big thunk
    burst(v, o, t, 'brown', 'lowpass', 400, 1, 0.8, 0.4);
    burst(v, o, t, 'white', 'highpass', 2000, 0.7, 0.4, 0.04);
    [[700, 0.2], [350, 0.1]].forEach(function (s, i) {  // generator whine winding down
      var g = v.gain(0, o); swell(g.gain, t, s[1], 0.02, 0.8, 1.8);
      glide(v.osc(i ? 'triangle' : 'sine', s[0], t, t + 2.7, g).frequency, t, s[0], s[0] / 25, 2.6);
    });
    return 2.7;
  }

  function error() {
    var v = new Voice(), t = T() + 0.005, g = v.gain(0, v.out(0, 1, 0));
    swell(g.gain, t, 0.12, 0.01, 0.2, 0.04);
    var lp = v.filter('lowpass', 700, 1, g);
    v.osc('square', 110, t, t + 0.3, lp); v.osc('square', 116.5, t, t + 0.3, lp);
  }

  function goldenDrone(on) {
    if (!on) return stopLoop('golden', 1);
    if (E.loops.golden) return;
    var L = startLoop('golden'), v = L.v, t = T();
    L.bus.connect(E.master); L.bus.connect(v.gain(0.4, E.verb));
    fadeIn(L, 1, 1.5);
    var lp = v.filter('lowpass', 700, 3, v.gain(0.25, L.bus));
    var pre = v.gain(0.5, v.shaper(driveCurve(25), lp));
    [36.7, 37.2, 51.9].forEach(function (f) { v.osc('sawtooth', f, t, null, pre); });
    v.osc('sine', 0.09, t, null, v.gain(250, lp.frequency));
    v.osc('sine', 5.3, t, null, v.gain(0.15, pre.gain));        // throb
    // whispers: pink noise through wandering narrow bands, auto-panned
    var p = v.pan(0, L.bus), wg = v.gain(0.08, p);
    if (p.pan) v.osc('sine', 0.17, t, null, v.gain(0.7, p.pan));
    var ns = v.noise('pink', t, null);
    [[1800, 8], [3100, 10]].forEach(function (f) {
      var bp = v.filter('bandpass', f[0], f[1], v.gain(3, wg));
      ns.connect(bp);
      v.osc('sine', rnd(0.3, 0.8), t, null, v.gain(600, bp.frequency));
    });
    var hi = v.osc('sine', 1480, t, null, v.gain(0.01, L.bus));
    v.osc('sine', 4.5, t, null, v.gain(30, hi.detune));
  }

  function stopAmbience() { stopLoop('amb', 0.8); }
  function stopAll() { Object.keys(E.loops).forEach(function (k) { stopLoop(k, 0.2); }); }

  // =====================================================================
  // PUBLIC API
  // =====================================================================
  var INTERNAL = {
    startAmbience: startAmbience, stopAmbience: stopAmbience, setFan: setFan,
    doorSlam: doorSlam, doorOpen: doorOpen, lightBuzz: lightBuzz, footsteps: footsteps,
    runSteps: runSteps, bang: bang, camFlip: camFlip, camBlip: camBlip, staticBurst: staticBurst,
    camStatic: camStatic, phoneRing: phoneRing, phonePickup: phonePickup, phoneHangup: phoneHangup,
    musicBox: musicBox, titleMusic: titleMusic, chime: chime, cheer: cheer, scream: scream,
    laugh: laugh, clank: clank, glitch: glitch, windowScare: windowScare, groan: groan,
    powerDown: powerDown, error: error, click: function () { click(); }, goldenDrone: goldenDrone,
    stopAll: stopAll,
    distant: function (i) { (DISTANT[i] || pick(DISTANT))(); }
  };

  // Wrap: no-op before init, never throw. `fb` = fallback return value (or function of args).
  function guard(fn, fb) {
    return function () {
      var args = arguments, alt = typeof fb === 'function' ? fb.apply(null, args) : fb;
      if (!E) return alt;
      try { var r = fn.apply(null, args); return r === undefined ? alt : r; } catch (err) { warn(err); return alt; }
    };
  }

  var SFX = {};
  Object.keys(INTERNAL).forEach(function (k) { if (k !== 'distant') SFX[k] = guard(INTERNAL[k]); });
  SFX.scream = guard(scream, screamDur);
  SFX.setFan = function (on) { fanOn = !!on; if (E) { try { setFan(on); } catch (err) { warn(err); } } };

  SFX.init = function () {
    try {
      if (!AC) return false;
      if (!E) {
        var ctx;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        E = makeEngine(ctx);
        try {                            // iOS unlock: play one silent sample inside the gesture
          var b = ctx.createBufferSource(); b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
          b.connect(ctx.destination); b.start(0);
        } catch (e) { /* ignore */ }
        var wake = function () { if (E && E.ctx.state !== 'running') SFX.init(); };
        ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) { window.addEventListener(ev, wake, true); });
      }
      if (E.ctx.state !== 'running' && E.ctx.resume) {
        var p = E.ctx.resume();
        if (p && p.catch) p.catch(function () { /* ignore */ });
      }
      return true;
    } catch (err) { warn(err); return false; }
  };

  SFX.setMaster = function (v) {
    v = Math.max(0, Math.min(1, +v || 0));
    masterLevel = v;
    if (!E) return;
    try { fadeTo(E.master.gain, T(), v, 0.05); } catch (err) { warn(err); }
  };

  SFX.suspend = function (v) {    // pause menu: freeze every sound in place
    if (!E) return;
    try { if (v) E.ctx.suspend(); else E.ctx.resume(); } catch (err) { warn(err); }
  };

  SFX.isReady = function () { return !!E && E.ctx.state === 'running'; };

  // Test hook: render any sound into an OfflineAudioContext. Resolves to an AudioBuffer.
  SFX._render = function (name, args, secs) {
    var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var sr = 44100, ctx = new OAC(2, Math.ceil(sr * (secs || 3)), sr);
    var saved = E, eng = makeEngine(ctx);
    E = eng;
    try { INTERNAL[name].apply(null, args || []); } finally { E = saved; }
    var done = function (buf) {        // stop any loop timers tied to the offline engine
      Object.keys(eng.loops).forEach(function (k) { eng.loops[k].dead = true; eng.loops[k].timers.forEach(clearInterval); });
      return buf;
    };
    var p = ctx.startRendering();
    if (p && p.then) return p.then(done);
    return new Promise(function (res) { ctx.oncomplete = function (e) { res(done(e.renderedBuffer)); }; });
  };

  window.SFX = SFX;
})();
