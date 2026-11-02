/* Seafloor explorer: a MapLibre globe over tiles cut from Sandwell's grids (see build_tiles.py).
   Global tiles go to zoom 4; five regions carry 1-arc-minute detail in their own bounded sources. */
(() => {
  const $ = (s) => document.querySelector(s);
  const TILES = new URL('tiles/', location.href).href;
  const EXAG = 18;
  const SPOTS = [
    { id: 'mid-atlantic', name: 'Mid-Atlantic Ridge', center: [-42.2, 25.2], zoom: 5.7, pitch: 55, bearing: -18,
      text: 'The seam where the Atlantic is still opening, a couple of centimetres a year. Look for the rift valley down the middle, cut sideways by fracture zones.' },
    { id: 'mariana', name: 'Mariana Trench', center: [143.2, 12.6], zoom: 5.8, pitch: 55, bearing: 20,
      text: 'The deepest place on Earth. Challenger Deep, near the southern end of the arc, is about 10.9 km down. Tap the trench to measure it.' },
    { id: 'hawaii', name: 'Hawaiian–Emperor seamounts', center: [-174, 25.5], zoom: 4.6, pitch: 45, bearing: -10,
      text: 'Volcanoes left behind as the Pacific plate slides over a hot spot: young Hawaii at the east end, older and older to the west, turning north into the Emperor seamounts at the far northwest.' },
    { id: 'south-pacific', name: 'South Pacific abyssal hills', center: [-122, -28], zoom: 6.8, pitch: 50, bearing: 0,
      text: 'Abyssal hills, the most common landform on Earth: long ridges a few hundred metres high, made at the East Pacific Rise. Flip between before and with SWOT here to see what the new satellite adds.' },
    { id: 'galapagos', name: 'Galápagos', center: [-90.2, -0.4], zoom: 6.2, pitch: 55, bearing: 15,
      text: 'Volcanic islands over a hot spot, with the Galápagos Spreading Center, a mid-ocean ridge, running just to the north.' },
  ];
  const GRAV_STOPS = [[0, '#2e6ee6'], [0.5, '#1e222c'], [1, '#ffb240']];
  const DEPTH = ['interpolate', ['linear'], ['elevation'],
    -11000, '#02040f', -8000, '#06102c', -6000, '#0a1f4d', -4500, '#123873', -3000, '#1c5598', -1500, '#2f7cbf', -200, '#62acd9', 0, '#a2d8ee',
    0.5, '#2b3826', 400, '#465530', 1500, '#736c45', 3000, '#a39377', 5000, '#ece8e0'];

  const state = { mode: 'gravity', mix: 100, tilt: false, spot: null };
  let regions = {};

  const lon180 = (l) => (l > 180 ? l - 360 : l);
  function boundsOf(r) {   // lon in 0..360 from the manifest; split at the antimeridian
    const [a, b] = r.lon, [s, n] = r.lat;
    if (a < 180 && b > 180) return [[a, s, 180, n], [-180, s, lon180(b), n]];
    return [[lon180(a), s, lon180(b), n]];
  }

  function buildStyle(manifest) {
    const sources = {
      dem: { type: 'raster-dem', tiles: [TILES + 'dem/{z}/{x}/{y}.webp'], tileSize: 256, maxzoom: 4, encoding: 'terrarium' },
      'vgg-before': { type: 'raster', tiles: [TILES + 'vgg-before/{z}/{x}/{y}.webp'], tileSize: 256, maxzoom: 4 },
      'vgg-swot': { type: 'raster', tiles: [TILES + 'vgg-swot/{z}/{x}/{y}.webp'], tileSize: 256, maxzoom: 4 },
    };
    const relief = [{ id: 'relief', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': DEPTH } }];
    const shade = [{ id: 'shade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': 'rgba(0,0,0,.6)', 'hillshade-highlight-color': 'rgba(255,255,255,.25)' } }];
    const before = [{ id: 'vgg-before', type: 'raster', source: 'vgg-before', paint: { 'raster-fade-duration': 0 } }];
    const swot = [{ id: 'vgg-swot', type: 'raster', source: 'vgg-swot', paint: { 'raster-fade-duration': 0 } }];
    for (const [key, r] of Object.entries(manifest.regions)) {
      boundsOf(r).forEach((b, i) => {
        const id = `${key}-${i}`;
        sources['dem-' + id] = { type: 'raster-dem', tiles: [TILES + `dem-${key}/{z}/{x}/{y}.webp`], tileSize: 256, minzoom: 5, maxzoom: r.zd, bounds: b, encoding: 'terrarium' };
        sources['vb-' + id] = { type: 'raster', tiles: [TILES + `vgg-before-${key}/{z}/{x}/{y}.webp`], tileSize: 256, minzoom: 5, maxzoom: r.zg, bounds: b };
        sources['vs-' + id] = { type: 'raster', tiles: [TILES + `vgg-swot-${key}/{z}/{x}/{y}.webp`], tileSize: 256, minzoom: 5, maxzoom: r.zg, bounds: b };
        relief.push({ id: 'relief-' + id, type: 'color-relief', source: 'dem-' + id, minzoom: 4.5, paint: { 'color-relief-color': DEPTH } });
        shade.push({ id: 'shade-' + id, type: 'hillshade', source: 'dem-' + id, minzoom: 4.5, paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': 'rgba(0,0,0,.6)', 'hillshade-highlight-color': 'rgba(255,255,255,.25)' } });
        before.push({ id: 'vb-' + id, type: 'raster', source: 'vb-' + id, minzoom: 4.5, paint: { 'raster-fade-duration': 0 } });
        swot.push({ id: 'vs-' + id, type: 'raster', source: 'vs-' + id, minzoom: 4.5, paint: { 'raster-fade-duration': 0 } });
        regions[key] = regions[key] || { zd: r.zd, boxes: [] };
        regions[key].boxes.push(b);
      });
    }
    return {
      version: 8,
      projection: { type: 'globe' },
      sources,
      layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#070a12' } }, ...relief, ...shade, ...before, ...swot],
    };
  }

  let map;
  fetch(TILES + 'manifest.json').then((r) => r.json()).then((manifest) => {
    map = new maplibregl.Map({
      container: 'map', style: buildStyle(manifest), center: [-160, 12], zoom: 1.4, maxZoom: 9, attributionControl: false,
      maxPitch: 75,
    });
    map.on('load', () => { applyMode(); window.__sf = { map, ready: true }; });
    map.on('click', (e) => tapDepth(e.lngLat, e.point));
    map.on('movestart', () => { $('#pop').hidden = true; });
    buildSpots();
  }).catch(() => { $('#caption').textContent = 'Could not load the map tiles. Try a refresh.'; });

  /* ---------- layers ---------- */
  function layerIds(prefix) { return map.getStyle().layers.map((l) => l.id).filter((id) => id === prefix || id.startsWith(prefix === 'vgg-before' ? 'vb-' : prefix === 'vgg-swot' ? 'vs-' : prefix + '-')); }
  function applyMode() {
    if (!map || !map.isStyleLoaded()) return;
    const grav = state.mode === 'gravity';
    for (const id of layerIds('vgg-before')) map.setLayoutProperty(id, 'visibility', grav ? 'visible' : 'none');
    for (const id of layerIds('vgg-swot')) {
      map.setLayoutProperty(id, 'visibility', grav && state.mix > 0 ? 'visible' : 'none');
      map.setPaintProperty(id, 'raster-opacity', state.mix / 100);
    }
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
    $('#compare').hidden = !grav;
    const lg = $('#legend');
    lg.innerHTML = grav
      ? '<span>trough</span><span class="bar" style="background:linear-gradient(90deg,#2e6ee6,#1e222c 50%,#ffb240)"></span><span>crest</span>'
      : '<span>11 km deep</span><span class="bar" style="background:linear-gradient(90deg,#02040f,#0a1f4d 25%,#1c5598 55%,#62acd9 85%,#a2d8ee 100%)"></span><span>sea level</span>';
  }
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { state.mode = b.dataset.mode; applyMode(); }));
  $('#mix').addEventListener('input', (e) => { state.mix = +e.target.value; applyMode(); });
  $('#flip').addEventListener('click', () => { state.mix = state.mix >= 50 ? 0 : 100; $('#mix').value = state.mix; applyMode(); });

  $('#tilt').addEventListener('click', () => {
    state.tilt = !state.tilt; $('#tilt').setAttribute('aria-pressed', String(state.tilt));
    if (state.tilt) { map.setTerrain({ source: 'dem', exaggeration: EXAG }); map.easeTo({ pitch: Math.max(map.getPitch(), 55), duration: 900 }); }
    else { map.setTerrain(null); map.easeTo({ pitch: 0, duration: 900 }); }
  });

  /* ---------- fly-to ---------- */
  function buildSpots() {
    const box = $('#spots');
    for (const s of SPOTS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = s.name; b.dataset.id = s.id;
      b.addEventListener('click', () => {
        state.spot = s.id;
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        $('#caption').textContent = s.text;
        map.flyTo({ center: s.center, zoom: s.zoom, pitch: state.tilt ? s.pitch : 0, bearing: state.tilt ? s.bearing : 0, speed: 1.4, curve: 1.5, essential: true });
      });
      box.append(b);
    }
  }

  /* ---------- tap for depth: read it from the same terrarium tiles the map draws ---------- */
  const cache = new Map();
  function tileImage(url) {
    if (!cache.has(url)) {
      cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
        .then((bmp) => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0); return g; }));
    }
    return cache.get(url);
  }
  function inBox(ll, b) { return ll.lng >= b[0] && ll.lng <= b[2] && ll.lat >= b[1] && ll.lat <= b[3]; }
  async function tapDepth(ll, pt) {
    let z = 4, dir = 'dem';
    for (const [key, r] of Object.entries(regions)) if (r.boxes.some((b) => inBox(ll, b))) { z = r.zd; dir = 'dem-' + key; }
    const n = 2 ** z, lat = Math.max(-85, Math.min(85, ll.lat)) * Math.PI / 180;
    const xf = ((ll.lng + 180) / 360) * n, yf = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
    const tx = Math.floor(xf) % n, ty = Math.floor(yf);
    const px = Math.min(255, Math.floor((xf - Math.floor(xf)) * 256)), py = Math.min(255, Math.floor((yf - ty) * 256));
    const pop = $('#pop');
    try {
      const g = await tileImage(`${TILES}${dir}/${z}/${tx}/${ty}.webp`);
      const [r, gg, b] = g.getImageData(px, py, 1, 1).data;
      const h = Math.round(r * 256 + gg + b / 256 - 32768);
      const where = `${Math.abs(ll.lat).toFixed(2)}°${ll.lat >= 0 ? 'N' : 'S'}, ${Math.abs(ll.lng).toFixed(2)}°${ll.lng >= 0 ? 'E' : 'W'}`;
      const ft = (m) => Math.round(Math.abs(m) * 3.28084).toLocaleString();
      pop.innerHTML = h < 0
        ? `<b>${Math.abs(h).toLocaleString()} m deep</b> (${ft(h)} ft)<small>${where}</small>`
        : `<b>Land, ${h.toLocaleString()} m up</b> (${ft(h)} ft)<small>${where}</small>`;
    } catch { pop.innerHTML = '<b>No depth here</b><small>outside the mapped band</small>'; }
    const p = pt || map.project(ll);
    pop.style.left = Math.max(80, Math.min(innerWidth - 80, p.x)) + 'px'; pop.style.top = p.y + 'px';
    pop.hidden = false;
  }

  /* ---------- explainer ---------- */
  for (const b of document.querySelectorAll('[data-info]')) b.addEventListener('click', () => $('#info').showModal());
  window.__sfTap = (lng, lat) => tapDepth(new maplibregl.LngLat(lng, lat));
})();
