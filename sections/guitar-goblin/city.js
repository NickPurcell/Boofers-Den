/* Night City runner — WebGL2, one fullscreen triangle, one fragment shader. */
(function () {
  "use strict";

  var canvas = document.getElementById("gl");
  var gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });

  function bail(msg) {
    var p = document.createElement("p");
    p.className = "oops";
    p.textContent = msg;
    document.body.appendChild(p);
  }

  if (!gl) {
    bail("This city needs WebGL2, and your browser hasn't got it. A newer Chrome, Firefox or Safari will do the trick.");
    return;
  }

  var VERT = [
    "#version 300 es",
    "void main(){",
    "  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);",
    "  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);",
    "}"
  ].join("\n");

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      console.error(log);
      bail("The shader refused to compile. Details are in the console.\n\n" + log);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  /* ---- quality tiers -------------------------------------------------
     A raymarcher on a phone will melt it, so the march budget is a
     #define the page rewrites before compiling, not just a resolution knob. */
  var TIERS = [
    { name: "low",  scale: 0.34, steps: 46,  rsteps: 0  },
    { name: "med",  scale: 0.50, steps: 72,  rsteps: 26 },
    { name: "high", scale: 0.72, steps: 104, rsteps: 46 },
    { name: "max",  scale: 1.00, steps: 144, rsteps: 64 }
  ];

  var coarse = (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || window.innerWidth < 700;
  var tier = coarse ? 0 : 2;
  var userPicked = false;

  var vs = compile(gl.VERTEX_SHADER, VERT);
  if (!vs) return;

  var progs = {};
  var prog = null, uRes = null, uTime = null, uMouse = null;

  function useTier(i) {
    var q = TIERS[i];
    if (!progs[q.name]) {
      var src = window.CITY_SHADER
        .replace("#define STEPS  120", "#define STEPS  " + q.steps)
        .replace("#define RSTEPS 56", "#define RSTEPS " + q.rsteps);
      var fs = compile(gl.FRAGMENT_SHADER, src);
      if (!fs) return false;
      var p = gl.createProgram();
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.linkProgram(p);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        bail("Shader link failed: " + gl.getProgramInfoLog(p));
        return false;
      }
      progs[q.name] = p;
    }
    prog = progs[q.name];
    gl.useProgram(prog);
    uRes = gl.getUniformLocation(prog, "r");
    uTime = gl.getUniformLocation(prog, "t");
    uMouse = gl.getUniformLocation(prog, "m");
    document.getElementById("qLabel").textContent = q.name;
    return true;
  }

  gl.bindVertexArray(gl.createVertexArray());
  if (!useTier(tier)) return;

  /* ---- sizing ---- */
  function resize() {
    var s = TIERS[tier].scale;
    var dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.0 : 1.5);
    var w = Math.max(1, Math.floor(canvas.clientWidth * dpr * s));
    var h = Math.max(1, Math.floor(canvas.clientHeight * dpr * s));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

  document.getElementById("quality").addEventListener("click", function () {
    tier = (tier + 1) % TIERS.length;
    userPicked = true;
    if (useTier(tier)) resize();
  });

  /* ---- pointer ---- */
  var mouse = [0.5, 0.5];
  var target = [0.5, 0.5];
  var hint = document.getElementById("hint");
  var hintGone = false;

  function point(x, y) {
    target[0] = x / window.innerWidth;
    target[1] = 1.0 - y / window.innerHeight;
    if (!hintGone) { hintGone = true; hint.classList.add("gone"); }
  }
  window.addEventListener("mousemove", function (e) { point(e.clientX, e.clientY); });
  window.addEventListener("touchmove", function (e) {
    if (e.touches.length) point(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  if (coarse) {
    hint.textContent = "drag anywhere — the camera leans with you";
    window.addEventListener("touchstart", function (e) {
      if (e.touches.length) point(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
  }

  /* ---- run state ---- */
  var paused = false;      // by the button
  var suspended = false;   // by the drawer or a hidden tab
  var looping = false;
  var t0 = performance.now();
  var clock = 0;           // shader time, only advances while we render
  var last = t0;

  function wake() {
    if (paused || suspended || looping) return;
    last = performance.now();
    looping = true;
    requestAnimationFrame(frame);
  }

  var pauseBtn = document.getElementById("pause");
  pauseBtn.addEventListener("click", function () {
    paused = !paused;
    pauseBtn.innerHTML = paused ? "&#9654;" : "&#10073;&#10073;";
    wake();
  });
  document.addEventListener("visibilitychange", function () {
    suspended = document.hidden || drawer.classList.contains("open");
    wake();
  });

  /* ---- shader drawer ---- */
  var drawer = document.getElementById("drawer");
  var backdrop = document.getElementById("backdrop");
  document.getElementById("src").textContent = window.CITY_SHADER;

  function openDrawer(on) {
    drawer.classList.toggle("open", on);
    backdrop.classList.toggle("open", on);
    drawer.setAttribute("aria-hidden", on ? "false" : "true");
    /* stop rendering behind it — reading code does not need a city running
       underneath, and a busy GPU makes taps feel dead on a phone */
    suspended = on || document.hidden;
    wake();
  }
  document.getElementById("srcBtn").addEventListener("click", function () {
    openDrawer(!drawer.classList.contains("open"));
  });
  document.getElementById("closeX").addEventListener("click", function () { openDrawer(false); });
  backdrop.addEventListener("click", function () { openDrawer(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") openDrawer(false); });

  var copyBtn = document.getElementById("copyBtn");
  copyBtn.addEventListener("click", function () {
    var done = function () {
      copyBtn.textContent = "copied";
      setTimeout(function () { copyBtn.textContent = "copy"; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(window.CITY_SHADER).then(done, function () { copyBtn.textContent = "no dice"; });
    } else {
      var ta = document.createElement("textarea");
      ta.value = window.CITY_SHADER;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (err) { copyBtn.textContent = "no dice"; }
      document.body.removeChild(ta);
    }
  });

  /* ---- context loss ---- */
  canvas.addEventListener("webglcontextlost", function (e) {
    e.preventDefault();
    looping = false;
    bail("The graphics context gave out — usually this machine deciding the shader was too much. Reload, and knock the quality down.");
  });

  /* ---- loop ---- */
  var slow = 0;

  function frame(now) {
    if (paused || suspended) { looping = false; return; }
    var dt = Math.min(now - last, 100);
    last = now;
    clock += dt * 0.001;

    /* if we're missing the budget badly, drop a tier — once */
    if (!userPicked) {
      if (dt > 40) { slow += 2; } else if (slow > 0) { slow--; }
      if (slow > 60 && tier > 0) {
        tier--; slow = 0;
        userPicked = (tier === 0);
        useTier(tier); resize();
      }
    }

    mouse[0] += (target[0] - mouse[0]) * 0.06;
    mouse[1] += (target[1] - mouse[1]) * 0.06;

    resize();
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, clock);
    gl.uniform2f(uMouse, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }

  resize();
  wake();
})();
