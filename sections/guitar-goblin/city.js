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
      return null;
    }
    return sh;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, window.CITY_SHADER);
  if (!vs || !fs) return;

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    bail("Shader link failed: " + gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  var uRes = gl.getUniformLocation(prog, "r");
  var uTime = gl.getUniformLocation(prog, "t");
  var uMouse = gl.getUniformLocation(prog, "m");

  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  /* ---- render scale ---- */
  var SCALES = [0.4, 0.55, 0.75, 1.0];
  var scaleIdx = 2;
  var qLabel = document.getElementById("qLabel");

  function resize() {
    var s = SCALES[scaleIdx];
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.max(1, Math.floor(canvas.clientWidth * dpr * s));
    var h = Math.max(1, Math.floor(canvas.clientHeight * dpr * s));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    qLabel.textContent = Math.round(s * 100) + "%";
  }
  window.addEventListener("resize", resize);

  document.getElementById("quality").addEventListener("click", function () {
    scaleIdx = (scaleIdx + 1) % SCALES.length;
    autoTuned = true;           // hands off once a human has an opinion
    resize();
  });

  /* ---- mouse ---- */
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

  /* ---- pause ---- */
  var running = true;
  var pauseBtn = document.getElementById("pause");
  pauseBtn.addEventListener("click", function () {
    running = !running;
    pauseBtn.innerHTML = running ? "&#10073;&#10073;" : "&#9654;";
    if (running) { last = performance.now(); requestAnimationFrame(frame); }
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && running) { last = performance.now(); requestAnimationFrame(frame); }
  });

  /* ---- shader drawer ---- */
  var drawer = document.getElementById("drawer");
  document.getElementById("src").textContent = window.CITY_SHADER;
  function openDrawer(on) { drawer.hidden = !on; }
  document.getElementById("srcBtn").addEventListener("click", function () { openDrawer(drawer.hidden); });
  document.getElementById("closeBtn").addEventListener("click", function () { openDrawer(false); });
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

  /* ---- loop ---- */
  var t0 = performance.now();
  var last = t0;
  var slow = 0;
  var autoTuned = false;

  function frame(now) {
    if (!running) return;
    var dt = Math.min(now - last, 100);
    last = now;

    /* if the machine is struggling, quietly turn the resolution down once */
    if (!autoTuned) {
      if (dt > 34) { slow++; } else if (slow > 0) { slow--; }
      if (slow > 45 && scaleIdx > 0) { scaleIdx--; slow = 0; autoTuned = scaleIdx === 0; resize(); }
    }

    mouse[0] += (target[0] - mouse[0]) * 0.06;
    mouse[1] += (target[1] - mouse[1]) * 0.06;

    resize();
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (now - t0) * 0.001);
    gl.uniform2f(uMouse, mouse[0], mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }

  resize();
  requestAnimationFrame(frame);
})();
