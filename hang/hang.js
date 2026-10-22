/* Find time to hang: one-hour slots from a UTC start, shown in the viewer's local time.
   Each person's answers are a string with one character per slot: '.' unknown, 'g' good, 'n' no-go. */
(() => {
  const API = '/api/hang';
  const HOUR = 3600 * 1000;
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // one random token per browser, sent with every save so a name filled in elsewhere asks before it's overwritten
  let token = localStorage.getItem('hang:token');
  if (!token || token.length < 16) {
    token = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(36).padStart(2, '0')).join('');
    localStorage.setItem('hang:token', token);
  }

  const id = (location.pathname.match(/\/hang\/([a-z0-9]{7})\/?$/) || [])[1] || new URLSearchParams(location.search).get('c');

  async function api(method, body, query = '') {
    const r = await fetch(API + query, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await r.json(); } catch { /* empty */ }
    return { ok: r.ok, status: r.status, data };
  }

  /* ---------- landing: make a calendar ---------- */
  if (!id) {
    $('#landing').hidden = false;
    const d = new Date();
    $('#c-start').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('#create').addEventListener('submit', async (e) => {
      e.preventDefault();
      const [y, m, dd] = $('#c-start').value.split('-').map(Number);
      const start = new Date(y, m - 1, dd, 0, 0, 0, 0).getTime();
      const btn = e.submitter || $('#create button'); btn.disabled = true;
      const res = await api('POST', { action: 'create', title: $('#c-title').value, start, days: +$('#c-days').value });
      if (res.ok && res.data.id) { location.href = '/hang/' + res.data.id; return; }
      btn.disabled = false; $('#c-err').textContent = res.data.error || 'Something went wrong, try again.';
    });
    return;
  }

  /* ---------- the calendar ---------- */
  let cal, people = [], me = '', mine = '', mode = 'g', view = 'mine', page = 0, early = false, dirty = false, saveTimer = null, selected = -1;
  let slotInfo = [], days = [];

  function buildSlots() {
    slotInfo = []; const byDay = new Map();
    for (let k = 0; k < cal.slots; k++) {
      const t = cal.start + k * HOUR, d = new Date(t);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!byDay.has(key)) byDay.set(key, { date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), hours: {} });
      byDay.get(key).hours[d.getHours()] = k;
      slotInfo.push({ t, d, h: d.getHours(), m: d.getMinutes() });
    }
    days = [...byDay.values()];
  }
  const pages = () => Math.ceil(days.length / 7);
  const others = () => people.filter((p) => p.name.toLowerCase() !== me.toLowerCase());
  const everyone = () => (me && (mine.includes('g') || mine.includes('n')) ? [...others(), { name: me, cells: mine }] : others());

  async function load() {
    const res = await api('GET', null, '?id=' + id);
    if (res.status === 404 || res.status === 400) { $('#missing').hidden = false; return false; }
    if (!res.ok) { $('#status').textContent = 'Could not reach the calendar'; return false; }
    cal = res.data.cal; people = res.data.people;
    return true;
  }

  function setMe(name) {
    me = name.trim().slice(0, 30);
    if (!me) return;
    localStorage.setItem('hang:name:' + id, me); localStorage.setItem('hang:lastname', me);
    const row = people.find((p) => p.name.toLowerCase() === me.toLowerCase());
    mine = row ? row.cells : '.'.repeat(cal.slots);
    $('#name').value = me;
    dirty = false; render();
  }

  function renderPeople() {
    const box = $('#people'); box.textContent = '';
    const list = everyone();
    if (!list.length) { box.append(el('span', 'hint', 'Nobody yet. Be the first.')); return; }
    for (const p of list.sort((a, b) => a.name.localeCompare(b.name))) {
      const c = el('button', 'chip' + (p.name.toLowerCase() === me.toLowerCase() ? ' me' : ''));
      c.type = 'button';
      c.append(el('span', null, p.name));
      const g = (p.cells.match(/g/g) || []).length, n = (p.cells.match(/n/g) || []).length;
      const s = el('small'); s.append(el('span', 'dg', g + '✓'), ' ', el('span', 'dn', n + '✕')); c.append(s);
      c.title = 'Edit ' + p.name + "'s times";
      c.addEventListener('click', () => { if (dirty) flush(); setMe(p.name); });
      box.append(c);
    }
  }

  function renderGrid() {
    const grid = $('#grid'); grid.textContent = '';
    grid.classList.toggle('paintable', view === 'mine');
    page = Math.max(0, Math.min(pages() - 1, page));
    const week = days.slice(page * 7, page * 7 + 7);
    $('#weeklbl').textContent = week.length ? `${week[0].date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${week[week.length - 1].date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';
    $('#prev').disabled = page === 0; $('#next').disabled = page >= pages() - 1;
    const todayKey = new Date().toDateString();
    grid.append(el('span'));
    for (let i = 0; i < 7; i++) {
      const d = week[i];
      const h = el('div', 'dh' + (d && d.date.toDateString() === todayKey ? ' today' : ''));
      if (d) { h.append(d.date.toLocaleDateString(undefined, { weekday: 'short' })); h.append(el('b', null, String(d.date.getDate()))); }
      grid.append(h);
    }
    const all = view === 'all' ? everyone() : null;
    const now = Date.now();
    const minute = slotInfo.length ? slotInfo[0].m : 0;
    for (let hr = early ? 0 : 8; hr < 24; hr++) {
      grid.append(el('div', 'tl', new Date(2000, 0, 1, hr, minute).toLocaleTimeString([], { hour: 'numeric', minute: minute ? '2-digit' : undefined })));
      for (let i = 0; i < 7; i++) {
        const d = week[i], k = d ? d.hours[hr] : undefined;
        const c = el('div', 'cell');
        if (k === undefined) { c.classList.add('none'); grid.append(c); continue; }
        c.dataset.k = k;
        if (slotInfo[k].t + HOUR < now) c.classList.add('past');
        if (view === 'mine') {
          if (mine[k] === 'g') c.classList.add('g'); else if (mine[k] === 'n') c.classList.add('n');
        } else {
          let g = 0, n = 0; for (const p of all) { if (p.cells[k] === 'g') g++; else if (p.cells[k] === 'n') n++; }
          if (n) { c.classList.add('blocked'); c.append(el('span', 'c', '✕' + (n > 1 ? n : ''))); }
          else if (g) { c.style.background = `rgba(61, 220, 132, ${0.25 + 0.75 * g / Math.max(1, all.length)})`; c.style.borderColor = 'transparent'; c.append(el('span', 'c', String(g))); }
          if (k === selected) c.classList.add('sel');
        }
        grid.append(c);
      }
    }
  }

  function when(k, k2 = k) {
    const a = slotInfo[k].d, b = new Date(slotInfo[k2].t + HOUR);
    const day = a.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const t = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: d.getMinutes() ? '2-digit' : undefined });
    return `${day}, ${t(a)}–${t(b)}`;
  }

  function renderDetail() {
    const box = $('#detail');
    if (view !== 'all' || selected < 0) { box.hidden = true; return; }
    const all = everyone(), g = [], n = [], u = [];
    for (const p of all) (p.cells[selected] === 'g' ? g : p.cells[selected] === 'n' ? n : u).push(p.name);
    box.hidden = false; box.textContent = '';
    box.append(el('p', null, when(selected)));
    const line = (cls, label, names) => { const p = el('p'); p.append(el('span', cls, label + ': '), names.length ? names.join(', ') : '—'); box.append(p); };
    line('g', 'Good', g); line('n', 'No-go', n); line('u', 'No answer', u);
  }

  function renderBest() {
    const list = $('#best'); list.textContent = '';
    const all = everyone(); const now = Date.now();
    const runs = []; let cur = null;
    for (let k = 0; k < cal.slots; k++) {
      const good = [], bad = all.some((p) => p.cells[k] === 'n');
      for (const p of all) if (p.cells[k] === 'g') good.push(p.name);
      const key = !bad && good.length && slotInfo[k].t + HOUR > now ? good.slice().sort().join('\u0001') : '';
      if (key && cur && cur.key === key && cur.end === k - 1) { cur.end = k; continue; }
      cur = key ? { key, start: k, end: k, names: good } : null;
      if (cur) runs.push(cur);
    }
    runs.sort((a, b) => b.names.length - a.names.length || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
    const top = runs.slice(0, 6);
    if (!top.length) { list.append(el('li', 'empty', all.length ? 'No slot where people are good and nobody is a no-go yet.' : 'Paint some good times and they’ll show up here.')); return; }
    for (const r of top) {
      const li = el('li');
      li.append(el('span', 'cnt', `${r.names.length} of ${all.length}`), el('div', 'when', when(r.start, r.end)), el('div', 'who', r.names.join(', ')));
      li.addEventListener('click', () => { setView('all'); selected = r.start; page = Math.floor(days.findIndex((d) => Object.values(d.hours).includes(r.start)) / 7); render(); $('#grid').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      list.append(li);
    }
  }

  function render() {
    $('#title').textContent = cal.title; document.title = cal.title + ' · Find time to hang';
    $('#paint').hidden = view !== 'mine'; $('#hint').hidden = view !== 'mine';
    $('#tab-mine').setAttribute('aria-selected', String(view === 'mine')); $('#tab-all').setAttribute('aria-selected', String(view === 'all'));
    document.querySelectorAll('.pm').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    renderPeople(); renderGrid(); renderDetail(); renderBest();
  }
  function setView(v) { view = v; if (v === 'mine') selected = -1; render(); }

  /* ---------- painting ---------- */
  let painting = null;
  function paintCell(c) {
    if (!c || !c.dataset.k) return;
    const k = +c.dataset.k;
    if (mine[k] === painting) return;
    mine = mine.slice(0, k) + painting + mine.slice(k + 1);
    c.classList.remove('g', 'n'); if (painting !== '.') c.classList.add(painting);
    dirty = true;
  }
  const grid = $('#grid');
  grid.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.cell'); if (!c || !c.dataset.k) return;
    if (view === 'all') { selected = +c.dataset.k; renderGrid(); renderDetail(); return; }
    if (!me) { $('#name').focus(); $('#status').textContent = 'Type your name first'; return; }
    e.preventDefault();
    const k = +c.dataset.k;
    painting = mine[k] === mode ? '.' : mode;   // tapping a cell already in this mode clears it
    paintCell(c);
    grid.setPointerCapture?.(e.pointerId);
  });
  grid.addEventListener('pointermove', (e) => {
    if (painting === null) return;
    paintCell(document.elementFromPoint(e.clientX, e.clientY)?.closest('.cell'));
  });
  const endPaint = () => { if (painting === null) return; painting = null; scheduleSave(); renderPeople(); renderBest(); };
  grid.addEventListener('pointerup', endPaint); grid.addEventListener('pointercancel', endPaint);

  function scheduleSave() { clearTimeout(saveTimer); $('#status').textContent = 'Saving…'; saveTimer = setTimeout(flush, 700); }
  async function flush(force = false) {
    clearTimeout(saveTimer);
    if (!dirty || !me) return;
    const res = await api('POST', { action: 'save', id, name: me, token, cells: mine, force });
    if (res.status === 409 && res.data.error === 'name in use') {
      if (confirm(`“${res.data.name}” was filled in on another device. Edit it from here anyway?`)) return flush(true);
      $('#status').textContent = 'Not saved'; return;
    }
    if (!res.ok) { $('#status').textContent = res.data.error ? 'Not saved: ' + res.data.error : 'Not saved, retrying…'; if (res.status >= 500 || res.status === 429) saveTimer = setTimeout(flush, 4000); return; }
    dirty = false; people = res.data.people; $('#status').textContent = 'Saved ✓';
    renderPeople(); renderBest(); if (view === 'all') { renderGrid(); renderDetail(); }
  }

  /* ---------- wiring ---------- */
  $('#who').addEventListener('submit', (e) => { e.preventDefault(); if (dirty) flush(); setMe($('#name').value); });
  document.querySelectorAll('.pm').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
  $('#tab-mine').addEventListener('click', () => setView('mine'));
  $('#tab-all').addEventListener('click', () => setView('all'));
  $('#prev').addEventListener('click', () => { page--; renderGrid(); });
  $('#next').addEventListener('click', () => { page++; renderGrid(); });
  $('#early').addEventListener('change', (e) => { early = e.target.checked; renderGrid(); });
  $('#copy').addEventListener('click', async () => {
    const url = location.origin + '/hang/' + id;
    try { await navigator.clipboard.writeText(url); $('#copy').textContent = 'Copied!'; }
    catch { $('#link').textContent = url; $('#copy').textContent = 'Copy the link below'; }
    setTimeout(() => { $('#copy').textContent = 'Copy link'; }, 2000);
  });
  addEventListener('beforeunload', () => { if (dirty) navigator.sendBeacon?.(API, new Blob([JSON.stringify({ action: 'save', id, name: me, token, cells: mine })], { type: 'application/json' })); });

  // see other people's changes without losing your own unsaved strokes
  setInterval(async () => {
    if (document.hidden || painting !== null) return;
    const res = await api('GET', null, '?id=' + id);
    if (res.ok) { people = res.data.people; if (!dirty && me) { const row = people.find((p) => p.name.toLowerCase() === me.toLowerCase()); if (row) mine = row.cells; } render(); }
  }, 20000);

  (async () => {
    if (!(await load())) return;
    $('#app').hidden = false;
    buildSlots();
    $('#tz').textContent = `Times are in your time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`;
    $('#link').textContent = location.host + '/hang/' + id;
    const firstFuture = days.findIndex((d) => d.date.getTime() + 24 * HOUR > Date.now());
    page = firstFuture > 0 ? Math.floor(firstFuture / 7) : 0;
    mine = '.'.repeat(cal.slots);
    const saved = localStorage.getItem('hang:name:' + id) || '';
    if (saved) setMe(saved);
    else { $('#name').value = localStorage.getItem('hang:lastname') || ''; render(); }
  })();
})();
