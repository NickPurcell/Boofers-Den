// 3D figures on the map (the GM's switch "3D figures on the map", off by default): with it on, a 3D button over the
// map's top corner for everyone; the 3D view itself (three.js, combat/figures3d.js) is loaded only when someone opens
// it, so a table with the switch off loads nothing more than this.
(function () {
  "use strict";
  let btn = null, mod = null, on = false, busy = false;
  function button() {
    const st = window.HT && HT.S.st, w = document.getElementById("mapWrap"); if (!w) return;
    const want = !!(st && st.figures);
    if (!want && on) toggle(false);
    if (!want) { if (btn) btn.hidden = true; return; }
    if (!btn) {
      btn = document.createElement("button"); btn.type = "button"; btn.className = "btn small map3d-btn";
      btn.title = "Stand the characters up: this map in 3D (drag to turn, scroll or pinch to zoom)";
      btn.addEventListener("click", () => toggle(!on)); w.appendChild(btn);
    }
    btn.hidden = false; btn.textContent = on ? "▦ Flat map" : "🧊 3D"; btn.setAttribute("aria-pressed", String(on));
  }
  async function toggle(v) {
    if (busy) return;
    on = v; button();
    if (!v) { if (mod) mod.close(); return; }
    busy = true;
    try { mod = mod || await import("/sections/jpesus/holotable/combat/figures3d.js"); if (on) mod.open(); }
    catch (e) { console.error(e); on = false; button(); if (window.HT) HT.toast("The 3D view couldn't start on this device.", true); }
    busy = false;
  }
  window.HT3D = { drawn() { button(); if (on && mod) mod.drawn(); }, get view() { return on ? mod : null; } };
})();
