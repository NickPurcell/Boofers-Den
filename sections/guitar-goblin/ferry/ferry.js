/* Where should I live? Ferry commute map.
   Data: places.json (towns), terminals.json (terminals, ride times, sources),
   drivetimes.json (precomputed free-flow drive minutes, see build_drivetimes.py). */
(() => {
  'use strict';

  const BUFFER = 10;                       // park, walk to the boat, board
  const RUSH = 1.35;                       // rush-hour multiplier on the drive to the terminal
  const LAST = { walk: 15, scooter: 3 };   // Ferry Building -> Salesforce Plaza
  const WORK = { name: 'Salesforce Plaza', lat: 37.7897, lon: -122.3969 };
  const START = L.latLngBounds([37.47, -122.78], [38.52, -121.98]);

  const $ = (s) => document.querySelector(s);
  const phone = window.matchMedia('(max-width: 760px)');

  const ICON = {
    ferry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 15l1.6 4.2c.2.5.7.8 1.2.8h12.4c.5 0 1-.3 1.2-.8L21 15z"/><path d="M6 15V10h12v5"/><path d="M9 10V6h6v4"/></svg>',
    wine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8l-.6 5.2a3.4 3.4 0 0 1-6.8 0z"/><path d="M12 11.6V20"/><path d="M8.5 20h7"/></svg>',
    work: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2"/></svg>'
  };

  // Rough water paths for the route line (decoration only; ride times come from the schedules).
  const PATH = {
    'vallejo': [[38.0999, -122.2631], [38.078, -122.262], [38.058, -122.275], [38.03, -122.33], [37.978, -122.44], [37.935, -122.435], [37.885, -122.405], [37.83, -122.395]],
    'mare-island': [[38.1013, -122.2689], [38.078, -122.262], [38.058, -122.275], [38.03, -122.33], [37.978, -122.44], [37.935, -122.435], [37.885, -122.405], [37.83, -122.395]],
    'richmond': [[37.909, -122.3595], [37.9, -122.368], [37.865, -122.39], [37.825, -122.392]],
    'oakland': [[37.7945, -122.2802], [37.7925, -122.2905], [37.795, -122.31], [37.8, -122.33], [37.803, -122.36]],
    'alameda-main': [[37.7911, -122.2945], [37.795, -122.31], [37.8, -122.33], [37.803, -122.36]],
    'seaplane': [[37.7772, -122.2992], [37.782, -122.33], [37.792, -122.37]],
    'harbor-bay': [[37.7363, -122.2574], [37.733, -122.275], [37.75, -122.33], [37.785, -122.375]],
    'ssf': [[37.6637, -122.3772], [37.675, -122.36], [37.705, -122.343], [37.735, -122.348], [37.77, -122.375]],
    'treasure-island': [[37.8162, -122.3732], [37.806, -122.38]],
    'larkspur': [[37.9447, -122.5084], [37.9415, -122.49], [37.93, -122.465], [37.9, -122.435], [37.87, -122.407], [37.83, -122.398]],
    'sausalito': [[37.8561, -122.4776], [37.845, -122.465], [37.826, -122.44], [37.81, -122.41]],
    'tiburon': [[37.8727, -122.4555], [37.865, -122.447], [37.848, -122.432], [37.815, -122.405]]
  };
  const FB_WATER = [37.7955, -122.3915];

  const state = { term: 'best', drive: 20, napa: 30, rush: false, last: 'walk', city: null };

  let PLACES, TERMS, NAPA, FB, DT, META, map;
  const pm = new Map();     // place id -> marker
  const tm = new Map();     // terminal id -> marker
  const lms = [];           // landmark markers: Napa, Ferry Building, work
  let circles = L.layerGroup(), route = L.layerGroup();
  const speed = {};         // anchor id -> km per minute, straight-line

  Promise.all(['places.json', 'terminals.json', 'drivetimes.json'].map((f) =>
    fetch(f).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); })
  )).then(([p, t, d]) => init(p, t, d)).catch((e) => {
    $('#status').textContent = 'Could not load the map data (' + e.message + '). Try a refresh.';
  });

  /* ---------- helpers ---------- */
  function hav(a, b, c, d) {
    const R = 6371, r = Math.PI / 180;
    const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function fmt(m) {
    m = Math.round(m);
    if (m < 60) return m + ' min';
    const h = Math.floor(m / 60), r = m % 60;
    return h + ' h ' + String(r).padStart(2, '0') + ' min';
  }
  const short = (m) => { m = Math.round(m); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm'; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rf = () => (state.rush ? RUSH : 1);
  const served = (t) => t.ride != null && t.service !== 'none';
  // Treasure Island's boat only makes sense from the island: anyone else driving there is already on the Bay Bridge.
  const LOCAL_MAX = 5;
  const eligible = (pid, t) => served(t) && (!t.localOnly || (DT[pid][t.id] && DT[pid][t.id][0] <= LOCAL_MAX));
  const term = (id) => TERMS.find((t) => t.id === id);

  function fitSpeed(id, lat, lon) {
    let num = 0, den = 0;
    for (const p of PLACES) {
      const v = DT[p.id] && DT[p.id][id];
      if (!v || v[0] == null || v[0] > 60 || v[0] < 3) continue;
      const d = hav(p.lat, p.lon, lat, lon);
      num += d * v[0]; den += v[0] * v[0];
    }
    return den ? num / den : 0.8;
  }

  function driveTo(pid, tid) {
    const v = DT[pid] && DT[pid][tid];
    return v && v[0] != null ? v[0] * rf() : null;
  }
  function commute(pid, t) {
    const d = driveTo(pid, t.id);
    if (d == null || !served(t)) return null;
    const last = LAST[state.last];
    return { t, drive: d, km: DT[pid][t.id][1], ride: t.ride, last, total: d + BUFFER + t.ride + last };
  }
  function ranked(pid) {
    return TERMS.filter((t) => eligible(pid, t)).map((t) => commute(pid, t)).filter(Boolean).sort((a, b) => a.total - b.total);
  }
  // Nearest terminal by drive (for "near a terminal" in best mode): any served terminal within the slider.
  function nearestDrive(pid) {
    let best = null;
    for (const t of TERMS) {
      if (!eligible(pid, t)) continue;
      const d = driveTo(pid, t.id);
      if (d != null && (!best || d < best.d)) best = { t, d };
    }
    return best;
  }
  function status(pid) {
    let a;
    if (state.term === 'best') { const n = nearestDrive(pid); a = !!n && n.d <= state.drive; }
    else { const d = driveTo(pid, state.term); a = d != null && d <= state.drive; }
    const nv = DT[pid] && DT[pid].napa;
    const b = !!nv && nv[0] != null && nv[0] <= state.napa;
    return a && b ? 'c' : a ? 'a' : b ? 'b' : 'n';
  }
  // The commute shown for a town: via the picked terminal, or the fastest one in "best" mode.
  function chosen(pid) {
    if (state.term === 'best') return ranked(pid)[0] || null;
    return commute(pid, term(state.term));
  }

  /* ---------- state in the URL, so a view can be bookmarked or sent ---------- */
  function readHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('t') && (h.get('t') === 'best' || term(h.get('t')))) state.term = h.get('t');
    const d = +h.get('d'), n = +h.get('n');
    if (d >= 5 && d <= 60) state.drive = d;
    if (n >= 5 && n <= 90) state.napa = n;
    if (h.get('r') === '1') state.rush = true;
    if (h.get('m') === 'scooter') state.last = 'scooter';
    if (h.get('c') && PLACES.some((p) => p.id === h.get('c'))) state.city = h.get('c');
  }
  function writeHash() {
    const h = new URLSearchParams({ t: state.term, d: state.drive, n: state.napa, r: state.rush ? 1 : 0, m: state.last });
    if (state.city) h.set('c', state.city);
    history.replaceState(null, '', '#' + h.toString());
  }

  /* ---------- init ---------- */
  function init(p, t, d) {
    PLACES = p.places; TERMS = t.terminals; NAPA = t.napa; FB = t.ferryBuilding; DT = d.times; META = { t, d };
    readHash();

    for (const x of TERMS) speed[x.id] = fitSpeed(x.id, x.lat, x.lon);
    speed.napa = fitSpeed('napa', NAPA.lat, NAPA.lon);

    map = L.map('map', { zoomControl: false, attributionControl: false, zoomSnap: 0.25, minZoom: 7, maxZoom: 15 });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.attribution({ position: phone.matches ? 'topright' : 'bottomright', prefix: false }).addTo(map);
    basemap();
    map.createPane('circles').style.zIndex = 390;
    circles.addTo(map); route.addTo(map);
    fit(false);

    // towns
    for (const x of PLACES) {
      const m = L.marker([x.lat, x.lon], {
        icon: L.divIcon({ className: 'pm t' + x.tier, iconSize: [28, 28], html: '<span class="dot"></span><span class="nm">' + esc(x.name) + '</span>' }),
        title: x.name, keyboard: true, riseOnHover: true
      }).addTo(map);
      m.on('click', () => openCity(x.id, false));
      pm.set(x.id, m);
    }
    // terminals
    for (const x of TERMS) {
      const m = L.marker([x.lat, x.lon], {
        icon: L.divIcon({ className: 'tm' + (served(x) ? '' : ' dim'), iconSize: [30, 30], html: '<span class="ic">' + ICON.ferry + '</span><span class="nm">' + esc(x.name) + '</span>' }),
        title: x.name + ' ferry terminal', zIndexOffset: 800, keyboard: true
      }).addTo(map);
      m.on('click', () => { state.term = x.id; $('#term').value = x.id; render(); });
      tm.set(x.id, m);
    }
    // landmarks
    const lm = (cls, ll, ic, name, z) => lms[lms.push(L.marker(ll, {
      icon: L.divIcon({ className: 'lm ' + cls, iconSize: [30, 30], html: '<span class="ic">' + ic + '</span><span class="nm">' + esc(name) + '</span>' }),
      title: name, zIndexOffset: z, keyboard: false
    }).addTo(map)) - 1];
    lm('napa', [NAPA.lat, NAPA.lon], ICON.wine, 'Napa', 900);
    lm('fb', [FB.lat, FB.lon], ICON.ferry, 'Ferry Building', 950);
    lm('work', [WORK.lat, WORK.lon], ICON.work, 'Work', 940);

    buildSelect();
    buildSources();
    wire();
    map.on('zoomend', () => labels());
    window.addEventListener('resize', () => labels());
    render();
    if (state.city) openCity(state.city, true);
  }

  /* Base map: OpenFreeMap vector tiles (OpenStreetMap data, no key) drawn by MapLibre under Leaflet,
     with its place names removed because the page draws its own. Plain OSM raster tiles if WebGL
     or the style is unavailable. */
  function basemap() {
    let done = false;
    const osm = () => {
      if (done) return; done = true;
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, className: 'osm-tiles',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
    };
    const load = (src) => new Promise((ok, no) => {
      const el = document.createElement(src.endsWith('.css') ? 'link' : 'script');
      if (el.tagName === 'LINK') { el.rel = 'stylesheet'; el.href = src; } else { el.src = src; }
      el.onload = ok; el.onerror = no; document.head.appendChild(el);
    });
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl2') || c.getContext('webgl'))) return osm();
    const timer = setTimeout(osm, 10000);
    Promise.all([
      load('../vendor/maplibre/maplibre-gl.js').then(() => load('../vendor/maplibre/leaflet-maplibre-gl.js')),
      load('../vendor/maplibre/maplibre-gl.css'),
      fetch('https://tiles.openfreemap.org/styles/positron').then((r) => { if (!r.ok) throw new Error('style'); return r.json(); })
    ]).then(([, , style]) => {
      if (done) return;
      style.layers = style.layers.filter((l) => !/^label_|^airport$/.test(l.id));
      for (const l of style.layers) {
        if (l.id === 'water') l.paint['fill-color'] = '#c6dbea';
        if (l.id === 'background') l.paint['background-color'] = '#f3f1ec';
        if (l.id === 'park') l.paint['fill-color'] = '#e3ecd9';
        if (l.id === 'landcover_wood') l.paint['fill-color'] = '#e6eedd';
      }
      done = true; clearTimeout(timer);
      L.maplibreGL({
        style, interactive: false,
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
      }).addTo(map);
    }).catch(() => { clearTimeout(timer); osm(); });
  }

  function fit(animate) {
    const pad = phone.matches ? { paddingTopLeft: [10, 10], paddingBottomRight: [10, Math.round(window.innerHeight * 0.44)] } : { padding: [20, 20] };
    map.fitBounds(START, Object.assign({ animate }, pad));
  }

  function buildSelect() {
    const sel = $('#term');
    const add = (parent, value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; parent.appendChild(o); };
    add(sel, 'best', 'Any terminal (fastest per town)');
    const ops = [...new Set(TERMS.map((t) => t.operator))];
    for (const op of ops) {
      const g = document.createElement('optgroup'); g.label = op;
      for (const t of TERMS.filter((x) => x.operator === op)) {
        add(g, t.id, t.name + (served(t) ? ' · ' + t.ride + ' min' + (t.service === 'limited' ? ', few boats' : t.localOnly ? ', islanders' : '') : ' · ' + (t.short || 'no service')));
      }
      sel.appendChild(g);
    }
    sel.value = state.term;
  }

  function buildSources() {
    $('#gen').textContent = 'routed ' + META.d.generated;
    const ul = $('#sources');
    for (const s of META.t.sources || []) {
      const li = document.createElement('li');
      li.innerHTML = '<a href="' + esc(s.url) + '" rel="noopener">' + esc(s.label) + '</a>' + (s.note ? ' <span>' + esc(s.note) + '</span>' : '');
      ul.appendChild(li);
    }
  }

  function wire() {
    const drive = $('#drive'), napa = $('#napa');
    drive.value = state.drive; napa.value = state.napa;
    $('#term').addEventListener('change', (e) => { state.term = e.target.value; render(); if (state.term !== 'best') focusTerm(); });
    drive.addEventListener('input', () => { state.drive = +drive.value; render(); });
    napa.addEventListener('input', () => { state.napa = +napa.value; render(); });
    document.querySelectorAll('[data-rush]').forEach((b) => b.addEventListener('click', () => { state.rush = b.dataset.rush === '1'; render(); }));
    document.querySelectorAll('[data-last]').forEach((b) => b.addEventListener('click', () => { state.last = b.dataset.last; render(); }));
    $('#card').addEventListener('click', (e) => {
      if (e.target.closest('.x')) closeCity();
      const use = e.target.closest('[data-use]');
      if (use) { state.term = use.dataset.use; $('#term').value = state.term; render(); }
    });
    $('#list').addEventListener('click', (e) => { const b = e.target.closest('[data-city]'); if (b) openCity(b.dataset.city, true); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCity(); });
    map.on('click', () => closeCity());

    const sheet = $('#sheet'), grab = $('#grab');
    grab.addEventListener('click', () => {
      const next = sheet.classList.contains('min') ? '' : sheet.classList.contains('full') ? 'min' : 'full';
      sheet.classList.remove('min', 'full');
      if (next) sheet.classList.add(next);
      grab.setAttribute('aria-expanded', next !== 'min');
      sheet.scrollTop = 0;
    });
  }

  function focusTerm() {
    const t = term(state.term);
    if (!t) return;
    const r = (state.drive / rf()) * speed[t.id] * 1000;
    const b = L.latLng(t.lat, t.lon).toBounds(Math.max(r * 2.1, 12000)).extend([FB.lat, FB.lon]);
    const pad = phone.matches ? { paddingTopLeft: [10, 40], paddingBottomRight: [10, Math.round(window.innerHeight * 0.46)] } : { padding: [30, 30] };
    map.flyToBounds(b, Object.assign({ duration: 0.6, maxZoom: 11 }, pad));
  }

  /* ---------- render ---------- */
  function render() {
    // controls
    const pct = (el) => ((el.value - el.min) / (el.max - el.min)) * 100 + '%';
    const drive = $('#drive'), napa = $('#napa');
    drive.style.setProperty('--pct', pct(drive)); napa.style.setProperty('--pct', pct(napa));
    $('#driveOut').textContent = '≤ ' + state.drive + ' min' + (state.rush ? ' in rush' : '');
    $('#napaOut').textContent = '≤ ' + state.napa + ' min';
    document.querySelectorAll('[data-rush]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.rush === '1') === state.rush)));
    document.querySelectorAll('[data-last]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.last === state.last)));
    $('#term').value = state.term;
    svcLine();

    // towns
    const counts = { a: 0, b: 0, c: 0, n: 0 };
    const st = {};
    for (const x of PLACES) {
      const s = status(x.id); st[x.id] = s; counts[s]++;
      const el = pm.get(x.id).getElement();
      if (el) {
        el.classList.remove('s-a', 's-b', 's-c', 's-n');
        el.classList.add('s-' + s);
        el.classList.toggle('sel', state.city === x.id);
      }
      pm.get(x.id).setZIndexOffset(s === 'c' ? 600 : s === 'n' ? 0 : 300);
    }
    for (const k of ['a', 'b', 'c', 'n']) $('#n' + k.toUpperCase()).textContent = counts[k];
    labels(st);

    // terminals
    for (const [id, m] of tm) {
      const el = m.getElement();
      if (el) el.classList.toggle('sel', id === state.term);
    }

    // circles + route
    circles.clearLayers(); route.clearLayers();
    const ring = (lat, lon, km, color, weight, faint) => L.circle([lat, lon], {
      pane: 'circles', radius: km * 1000, color, weight, opacity: faint ? 0.35 : 0.6, fillColor: color,
      fillOpacity: faint ? 0.035 : 0.07, dashArray: '6 6', interactive: false
    }).addTo(circles);
    const eff = state.drive / rf();
    const shown = state.term === 'best' ? TERMS.filter((t) => served(t) && !t.localOnly) : [term(state.term)];
    for (const t of shown) ring(t.lat, t.lon, eff * speed[t.id], '#2a78d6', state.term === 'best' ? 1.2 : 2, state.term === 'best');
    ring(NAPA.lat, NAPA.lon, state.napa * speed.napa, '#c2366b', 2);
    if (state.term !== 'best') {
      const t = term(state.term);
      const path = (PATH[t.id] || [[t.lat, t.lon]]).concat([FB_WATER]);
      L.polyline(path, { color: '#2a78d6', weight: 3, opacity: served(t) ? 0.75 : 0.35, dashArray: '2 7', lineCap: 'round', smoothFactor: 1.5, interactive: false }).addTo(route);
    }
    L.polyline([[FB.lat, FB.lon], [WORK.lat, WORK.lon]], { color: '#16202a', weight: 2.5, opacity: 0.6, dashArray: '1 6', lineCap: 'round', interactive: false }).addTo(route);

    // circle note
    const mph = (k) => Math.round(k * 60 / 1.609);
    if (state.term === 'best') {
      $('#circleNote').innerHTML = 'Blue circles: ' + state.drive + ' min around every terminal with service. Pink circle: ' + state.napa +
        ' min around downtown Napa at ~' + mph(speed.napa) + ' mph straight-line. Colours use real drive times.';
    } else {
      const t = term(state.term);
      $('#circleNote').innerHTML = 'Circles: ' + state.drive + ' min' + (state.rush ? ' (÷1.35 for rush)' : '') + ' at ~' + mph(speed[t.id]) +
        ' mph straight-line around ' + esc(t.name) + ', ' + state.napa + ' min at ~' + mph(speed.napa) + ' mph around Napa. Colours use real drive times.';
    }

    list(st);
    if (state.city) cityCard(state.city);
    writeHash();
  }

  function svcLine() {
    const el = $('#svc');
    if (state.term === 'best') { el.innerHTML = 'Each town uses whichever terminal gets it to your desk fastest. Terminals with no weekday morning boat are left out, and Treasure Island only counts for the island itself.'; return; }
    const t = term(state.term);
    if (!served(t)) { el.innerHTML = '<span class="bad">' + esc(t.note) + '</span>'; return; }
    const note = t.service === 'limited' ? '<span class="warn">' + esc(t.note) + '</span>' : esc(t.note);
    el.innerHTML = esc(t.operator) + ' · <strong>' + t.ride + ' min</strong> to the Ferry Building · ' + esc(t.fare) + '. ' + note;
  }

  /* Labels: most important first, each drawn right of its dot, else left, else hidden if it
     would cover a label already placed or another marker. Runs on every render and zoom. */
  function labels(st) {
    if (!map) return;
    st = st || Object.fromEntries(PLACES.map((x) => [x.id, status(x.id)]));
    const z = map.getZoom();
    map.getContainer().classList.toggle('lo', z < 10);
    map.getContainer().classList.toggle('near', z >= 12);
    const pt = (m) => map.latLngToContainerPoint(m.getLatLng());
    const dots = [];
    const items = [];
    for (const x of PLACES) {
      const m = pm.get(x.id), el = m.getElement(); if (!el) continue;
      const p = pt(m), r = 7;
      dots.push({ id: x.id, x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r });
      const s = st[x.id], lit = s !== 'n', sel = state.city === x.id;
      const gate = lit || x.tier === 1 || (x.tier === 2 && z >= 9.5) || z >= 10.25;
      const pr = sel ? 0 : s === 'c' ? 2 + x.tier / 10 : lit ? 3 + x.tier : 7 + x.tier;
      items.push({ id: x.id, el, p, gap: 10, pr: gate ? pr : Infinity });
    }
    for (const [id, m] of tm) {
      const el = m.getElement(); if (!el) continue;
      const p = pt(m), r = z < 10 ? 10 : 13;
      dots.push({ id, x0: p.x - r, x1: p.x + r, y0: p.y - r, y1: p.y + r });
      items.push({ id, el, p, gap: r + 4, pr: id === state.term ? 1 : 5.5 });
    }
    for (const m of lms) {
      const el = m.getElement(); if (!el || !el.offsetParent) continue;
      const p = pt(m);
      dots.push({ id: el, x0: p.x - 14, x1: p.x + 14, y0: p.y - 14, y1: p.y + 14 });
      items.push({ id: el, el, p, gap: 18, pr: -1, fixed: true });
    }
    items.sort((a, b) => a.pr - b.pr);
    const placed = [];
    const hit = (b, id) => placed.some((q) => b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0) ||
      dots.some((q) => q.id !== id && b.x0 < q.x1 && b.x1 > q.x0 && b.y0 < q.y1 && b.y1 > q.y0);
    for (const it of items) {
      const nm = it.el.querySelector('.nm');
      if (!nm) continue;
      if (it.pr === Infinity) { it.el.classList.add('hide-nm'); continue; }
      const w = nm.offsetWidth, h = 16;
      const right = { x0: it.p.x + it.gap, x1: it.p.x + it.gap + w, y0: it.p.y - h / 2, y1: it.p.y + h / 2 };
      const left = { x0: it.p.x - it.gap - w, x1: it.p.x - it.gap, y0: right.y0, y1: right.y1 };
      let side = null;
      if (it.fixed || it.pr <= 1 || !hit(right, it.id)) side = 'r';
      else if (!hit(left, it.id)) side = 'l';
      it.el.classList.toggle('hide-nm', !side);
      it.el.classList.toggle('nm-l', side === 'l');
      if (side) placed.push(side === 'l' ? left : right);
    }
  }

  function list(st) {
    const rank = { c: 0, a: 1, b: 2 };
    const rows = PLACES.filter((x) => st[x.id] !== 'n').map((x) => ({ x, s: st[x.id], c: chosen(x.id) || ranked(x.id)[0] || null }))
      .sort((p, q) => rank[p.s] - rank[q.s] || (p.c ? p.c.total : 1e9) - (q.c ? q.c.total : 1e9));
    const ol = $('#list');
    if (!rows.length) { ol.innerHTML = '<li class="empty">Nothing lights up yet. Slide either one to the right.</li>'; return; }
    ol.innerHTML = rows.map(({ x, s, c }) =>
      '<li><button type="button" data-city="' + x.id + '"' + (state.city === x.id ? ' class="on"' : '') + '>' +
      '<i class="sw ' + s + '"></i><span class="nm">' + esc(x.name) + '<small>' + esc(x.county) + '</small></span>' +
      '<span class="tt">' + (c ? short(c.total) : '—') + (c && c.t.id !== state.term ? '<span class="via">via ' + esc(c.t.name) + '</span>' : '') + '</span>' +
      '</button></li>').join('');
  }

  /* ---------- city card ---------- */
  function openCity(id, pan) {
    state.city = id;
    render();
    const x = PLACES.find((p) => p.id === id);
    if (pan && x) {
      if (phone.matches) {
        const h = window.innerHeight * 0.36;
        const pt = map.project([x.lat, x.lon], map.getZoom()).add([0, h]);
        map.panTo(map.unproject(pt, map.getZoom()), { animate: true });
      } else map.panTo([x.lat, x.lon], { animate: true });
    }
  }
  function closeCity() {
    if (!state.city) return;
    state.city = null;
    $('#card').hidden = true;
    document.body.classList.remove('card-open');
    render();
  }

  function cityCard(id) {
    const x = PLACES.find((p) => p.id === id);
    const card = $('#card');
    const s = status(id);
    const all = ranked(id);
    const best = all[0] || null;
    const cur = chosen(id);
    const pickT = state.term === 'best' ? (best && best.t) : term(state.term);
    const nv = DT[id].napa;
    const lastName = state.last === 'walk' ? 'Walk' : 'Scooter';

    const chip = (k, txt) => '<span class="chip"><i class="sw ' + k + '"></i>' + txt + '</span>';
    const chips = [];
    if (s === 'c') chips.push(chip('c', 'Near the terminal and Napa'));
    else if (s === 'a') chips.push(chip('a', 'Near the terminal'));
    else if (s === 'b') chips.push(chip('b', 'Near Napa'));
    else chips.push(chip('n', 'Outside both'));

    let body = '';
    if (cur) {
      const segs = [['leg-drive', cur.drive], ['leg-buf', BUFFER], ['leg-ferry', cur.ride], ['leg-last', cur.last]];
      body += '<div class="total"><div class="k">Door to desk via ' + esc(cur.t.name) + '</div>' +
        '<div class="v">' + fmt(cur.total) + '<small>each way</small></div></div>' +
        '<div class="bar" aria-hidden="true">' + segs.map(([c, v]) => '<i class="' + c + '" style="flex:' + v.toFixed(1) + '"></i>').join('') + '</div>' +
        '<ol class="legs">' +
        '<li><i class="leg-drive"></i><span class="w">Drive to ' + esc(cur.t.name) + '</span><span class="m">' + fmt(cur.drive) + '</span>' +
        '<small>' + cur.km + ' km · ' + (state.rush ? 'free-flow ×1.35 for rush hour' : 'free-flow, no traffic') + '</small></li>' +
        '<li><i class="leg-buf"></i><span class="w">Park and board</span><span class="m">' + BUFFER + ' min</span><small>assumed</small></li>' +
        '<li><i class="leg-ferry"></i><span class="w">Ferry to the Ferry Building</span><span class="m">' + cur.ride + ' min</span>' +
        '<small>' + esc(cur.t.operator) + (cur.t.rideRange ? ' · weekday AM ' + esc(cur.t.rideRange) : '') + '</small></li>' +
        '<li><i class="leg-last"></i><span class="w">' + lastName + ' to Salesforce Plaza</span><span class="m">' + cur.last + ' min</span></li>' +
        '</ol>';
      body += '<dl class="boats"><div><dt>Boats to SF</dt><dd>' + cur.t.am.join(' · ') + ' am</dd></div>' +
        '<div><dt>Home, 4:30–7pm</dt><dd>' + cur.t.pm.join(' · ') + ' pm</dd></div>' +
        '<div><dt>Fare</dt><dd>' + esc(cur.t.fare) + ' one way</dd></div></dl>';
      if ((cur.t.service === 'limited' || cur.t.localOnly) && cur.t.note) body += '<p class="svcnote">' + esc(cur.t.note) + '</p>';
    } else if (pickT) {
      body += '<p class="svcnote"><strong>' + esc(pickT.name) + ':</strong> ' + esc(pickT.note) + '</p>';
      const d = DT[id][pickT.id];
      if (d && d[0] != null) body += '<p class="sub">Drive to ' + esc(pickT.name) + ': ' + fmt(d[0] * rf()) + ' (' + d[1] + ' km)</p>';
    }

    if (best && state.term !== 'best') {
      const via = fmt(best.total) + ' door to desk (' + fmt(best.drive) + ' drive, ' + best.ride + ' min ferry).';
      const use = '<br /><button type="button" data-use="' + best.t.id + '">Use ' + esc(best.t.name) + '</button>';
      const gain = cur ? Math.round(cur.total - best.total) : null;
      if (cur && best.t.id === cur.t.id) {
        body += '<div class="alt same">This is the fastest terminal from ' + esc(x.name) + '.</div>';
      } else if (!cur) {
        body += '<div class="alt"><strong>Fastest from ' + esc(x.name) + ': ' + esc(best.t.name) + '</strong>, ' + via + use + '</div>';
      } else if (gain < 5) {
        body += '<div class="alt same">' + esc(best.t.name) + ' is about the same: ' + via + '</div>';
      } else {
        body += '<div class="alt"><strong>' + esc(best.t.name) + ' is ' + gain + ' min faster:</strong> ' + via + use + '</div>';
      }
    }

    if (all.length > 1) {
      const rows = all.slice(0, 4);
      if (cur && !rows.some((r) => r.t.id === cur.t.id)) rows.push(cur);
      body += '<table class="cmp"><caption>Terminals from ' + esc(x.name) + '</caption><thead><tr><th>Terminal</th><th>Drive</th><th>Ferry</th><th>Total</th></tr></thead><tbody>' +
        rows.map((r) => '<tr' + (cur && r.t.id === cur.t.id ? ' class="cur"' : '') + '><td>' + esc(r.t.name) + '</td><td>' + Math.round(r.drive) + '</td>' +
          '<td' + (r.t.service === 'limited' ? ' class="lim" title="' + esc(r.t.note || 'limited service') + '"' : '') + '>' + r.ride + (r.t.service === 'limited' ? '*' : '') + '</td><td>' + short(r.total) + '</td></tr>').join('') +
        '</tbody></table>';
      if (rows.some((r) => r.t.service === 'limited')) body += '<p class="fine">* limited weekday service, see the terminal notes.</p>';
    }

    if (nv && nv[0] != null) {
      body += '<div class="napa"><span class="ni">' + ICON.wine + '</span>' +
        '<span>Downtown Napa: <b>' + fmt(nv[0]) + '</b> drive, ' + nv[1] + ' km (free-flow)</span></div>';
    }

    card.innerHTML = '<div class="top"><div><h2>' + esc(x.name) + '</h2><p class="sub">' + esc(x.county) + ' County</p></div>' +
      '<button class="x" type="button" aria-label="Close">×</button></div>' +
      '<div class="chips">' + chips.join('') + '</div>' + body;
    card.hidden = false;
    document.body.classList.add('card-open');
  }
})();
