/* Find time to hang, version two: the page. The rules are worked out by HangEngine (engine.js);
   this file draws the month, the sheets and the forms, and talks to /api/hangout. */
(() => {
  'use strict';
  const E = window.HangEngine;
  const API = '/api/hangout';
  const MIN = E.MIN, DAY = E.DAY;
  const $ = (s, r = document) => r.querySelector(s);
  const low = (s) => String(s || '').toLowerCase();
  const LOCALE = E.setLocale(navigator.language);
  const WEEK0 = E.weekStart(navigator.language);
  const viewTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') e[k] = !!v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
    return e;
  }
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  async function api(method, body, query = '') {
    try {
      const r = await fetch(API + query, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      let data = {};
      try { data = await r.json(); } catch { /* empty */ }
      return { ok: r.ok, status: r.status, data };
    } catch { return { ok: false, status: 0, data: { error: 'no connection' } }; }
  }
  let toastTimer = null;
  function toast(msg, action, ms = 6000) {
    const t = $('#toast');
    t.textContent = '';
    t.append(h('span', { text: msg }));
    if (action) t.append(h('button', { type: 'button', class: 'toast-act', text: action.label, onclick: () => { t.hidden = true; action.fn(); } }));
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  async function copy(text, what = 'Copied') {
    try { await navigator.clipboard.writeText(text); toast(`${what} ✓`); return true; } catch { /* fall back */ }
    const ta = h('textarea', { class: 'offscreen', readonly: true }); ta.value = text; document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    if (ok) { toast(`${what} ✓`); return true; }
    window.prompt('Copy this:', text);
    return false;
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const lenAdj = (m) => (m % 60 === 0 ? `${m / 60}-hour` : m < 60 ? `${m}-minute` : m % 30 === 0 ? `${m / 60}-hour` : `${m}-minute`);
  const lenText = (m) => (m % 60 ? `${Math.floor(m / 60) ? Math.floor(m / 60) + ' h ' : ''}${m % 60} min` : plural(m / 60, 'hour', 'hours'));
  const lenOptions = [60, 90, 120, 150, 180, 240, 300, 360, 480];
  function zoneOptions(selected) {
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); } catch { zones = [viewTz, 'UTC']; }
    if (!zones.includes(selected)) zones = [selected, ...zones];
    return zones.map((z) => h('option', { value: z, selected: z === selected, text: z.replace(/_/g, ' ') }));
  }
  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }
  function remember(evId, name) {
    const list = store.get('hang2:recent', []).filter((x) => x.id !== evId);
    list.unshift({ id: evId, name, at: Date.now() });
    store.set('hang2:recent', list.slice(0, 8));
  }

  /* ---------------- sheets: one at a time, with a back stack ---------------- */
  const sheetEl = $('#sheet'), sheetCard = $('.sheet-card');
  let stack = []; // [{ render, scroll }]: each sheet keeps its own scroll position
  function openSheet(render, { replace = false } = {}) {
    if (stack.length) stack[stack.length - 1].scroll = sheetCard.scrollTop;
    if (replace) stack.pop();
    stack.push({ render, scroll: 0 });
    drawSheet();
  }
  // keep: a redraw of the same sheet, so stay where the reader is
  function drawSheet(keep = false) {
    const top = stack[stack.length - 1];
    if (!top) { sheetEl.hidden = true; document.body.classList.remove('locked'); return; }
    const scroll = keep ? sheetCard.scrollTop : top.scroll;
    sheetCard.textContent = '';
    const { title, body, foot } = top.render();
    sheetCard.append(...[
      h('div', { class: 'sheet-head' },
        stack.length > 1 ? h('button', { type: 'button', class: 'icon', 'aria-label': 'Back', text: '‹', onclick: backSheet }) : h('span'),
        h('h2', { id: 'sheet-title', text: title }),
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Close', text: '×', onclick: closeSheet })),
      h('div', { class: 'sheet-body' }, body),
      foot ? h('div', { class: 'sheet-foot' }, foot) : null].filter(Boolean));
    sheetEl.hidden = false;
    document.body.classList.add('locked');
    sheetCard.scrollTop = scroll;
  }
  const redrawSheet = () => { if (stack.length) drawSheet(true); };
  function backSheet() { stack.pop(); drawSheet(); }
  function closeSheet() { stack = []; drawSheet(); renderEvent(); }
  sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) closeSheet(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) closeSheet(); });

  /* ---------------- which page ---------------- */
  const m = location.pathname.match(/^\/hang\/([a-z0-9-]{7,48})\/?$/);
  const id = m ? m[1] : null;
  if (!id) return createView();

  /* ================= create ================= */
  function createView() {
    const root = $('#create-view');
    root.hidden = false;
    const name = h('input', { id: 'c-name', maxlength: 60, placeholder: 'Space game, Game night, Dinner…', autocomplete: 'off', required: true });
    const roster = h('textarea', { id: 'c-roster', rows: 2, maxlength: 1200, placeholder: 'Names, separated by commas (optional)' });
    const len = h('select', { id: 'c-len' }, lenOptions.map((v) => h('option', { value: v, selected: v === 120, text: lenText(v) })));
    const tz = h('select', { id: 'c-tz' }, zoneOptions(viewTz));
    const reqBox = h('div', { class: 'req-list' });
    const quorum = h('select', { id: 'c-quorum' });
    const from = h('input', { id: 'c-from', type: 'date' }), to = h('input', { id: 'c-to', type: 'date' });
    const err = h('p', { class: 'err', role: 'alert' });
    const names = () => [...new Set(roster.value.split(/[,\n]/).map((x) => E.cleanText(x, 30)).filter(Boolean))].slice(0, 30);
    const required = new Set();
    function syncRoster() {
      const ns = names();
      reqBox.textContent = '';
      if (!ns.length) reqBox.append(h('p', { class: 'hint', text: 'Type names above to pick who must be there.' }));
      for (const n of ns) reqBox.append(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: required.has(low(n)), onchange: (e) => { if (e.target.checked) required.add(low(n)); else required.delete(low(n)); } }), n));
      const q = quorum.value;
      quorum.textContent = '';
      quorum.append(h('option', { value: 0, text: 'Everyone who fills it in' }));
      for (let i = 2; i <= Math.max(ns.length, 2); i++) quorum.append(h('option', { value: i, text: `At least ${i}` }));
      quorum.value = [...quorum.options].some((o) => o.value === q) ? q : '0';
    }
    roster.addEventListener('input', syncRoster);
    syncRoster();
    const form = h('form', { class: 'form', id: 'create', onsubmit: async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!name.value.trim()) { err.textContent = 'Give it a name.'; name.focus(); return; }
      const btn = $('#create-go'); btn.disabled = true;
      const res = await api('POST', { action: 'create', name: name.value, tz: tz.value, len: +len.value, quorum: +quorum.value || 0,
        roster: names().map((n) => ({ name: n, req: required.has(low(n)) })), from: from.value || null, to: to.value || null });
      if (res.ok && res.data.id) {
        store.set('hang2:key:' + res.data.id, res.data.key);
        remember(res.data.id, name.value.trim());
        location.href = '/hang/' + res.data.id + '?share=1';
        return;
      }
      btn.disabled = false;
      err.textContent = res.data.error ? res.data.error[0].toUpperCase() + res.data.error.slice(1) + '.' : 'Something went wrong, try again.';
    } },
      h('label', null, 'What’s it for?', name),
      h('label', null, 'Who’s in?', roster),
      h('label', null, 'How long is a session?', len),
      h('details', { class: 'more' }, h('summary', { text: 'More options' }),
        h('label', null, 'Home time zone', tz),
        h('div', { class: 'lbl' }, 'Must be there', reqBox),
        h('label', null, 'Enough people', quorum),
        h('div', { class: 'row2' }, h('label', null, 'Only look from', from), h('label', null, 'until', to))),
      h('button', { class: 'btn primary big', type: 'submit', id: 'create-go', text: 'Create scheduler →' }),
      err);
    const recent = store.get('hang2:recent', []);
    root.append(...[
      h('section', { class: 'card hero' },
        h('h1', { text: 'Find time to hang' }),
        h('p', { class: 'lede', text: 'Make a scheduler and share the link. Everyone taps their name and says when they’re usually free, and the best times float to the top. No logins.' }),
        form),
      recent.length ? h('section', { class: 'card' }, h('h2', { text: 'Your schedulers' }),
        h('ul', { class: 'recent' }, recent.map((x) => h('li', null, h('a', { href: '/hang/' + x.id, text: x.name }))))) : null,
      h('p', { class: 'foot', text: 'Schedulers disappear 90 days after the last change. Anyone with the link can edit, so keep it among friends.' })].filter(Boolean));
  }

  /* ================= the event ================= */
  let ev = null, people = [], log = [];
  let dispTz = viewTz;
  let changesOpen = false;
  let renderA = null; // the one analysis behind the month and the best times, made once per render
  let excluded = new Set();
  let me = store.get('hang2:me:' + id, null);
  let mine = null;              // my record while editing
  let saveTimer = null, saving = false, pendingSave = false;
  let shown = null, myShown = null; // {y, m} of the month on screen, for the event and for "my month"
  const url = () => `${location.origin}/hang/${id}`;

  async function load() {
    const res = await api('GET', null, '?id=' + encodeURIComponent(id));
    if (res.status === 404 || res.status === 400) { $('#missing').hidden = false; $('#event-view').hidden = true; $('#dock').hidden = true; return false; }
    if (!res.ok) { toast('Could not reach the scheduler. Retrying…'); return false; }
    take(res.data);
    return true;
  }
  let removed = [];
  function take(d) { ev = d.event; people = d.people || []; log = d.log || []; removed = d.removed || []; }
  const person = (name) => people.find((p) => low(p.name) === low(name)) || null;
  const answered = () => people.filter(E.answered);
  function members() {
    const out = [], seen = new Set();
    for (const r of ev.roster || []) { seen.add(low(r.name)); const p = person(r.name); out.push({ name: p ? p.name : r.name, req: r.req, done: E.answered(p) }); }
    for (const p of answered()) if (!seen.has(low(p.name))) out.push({ name: p.name, req: false, done: true });
    return out;
  }
  const waiting = () => (ev.roster || []).filter((r) => !E.answered(person(r.name))).map((r) => r.name);
  function counting() {
    const ans = answered();
    return {
      ans,
      count: ans.filter((p) => !excluded.has(low(p.name))).map((p) => p.name),
      required: (ev.roster || []).filter((r) => r.req && !excluded.has(low(r.name))).map((r) => r.name),
      quorum: ev.quorum || 0,
    };
  }
  function analysis(t0, t1) {
    const c = counting();
    return E.analyze(c.ans, { t0, t1, len: ev.len, count: c.count, required: c.required, quorum: c.quorum, now: Date.now() });
  }
  const todayKey = () => E.localKey(Date.now(), dispTz);
  function horizon() {
    let a = todayKey();
    if (ev.from && ev.from > a) a = ev.from;
    const b = ev.to ? E.addDays(ev.to, 1) : E.addDays(todayKey(), 56);
    return [Math.max(Date.now() - (Date.now() % (15 * MIN)), E.dayStart(a, dispTz)), E.dayStart(b, dispTz)];
  }
  const inWindow = (k) => (!ev.from || k >= ev.from) && (!ev.to || k <= ev.to);
  function ruleLine() {
    const c = counting();
    const sure = ev.quorum > 0 ? `at least ${ev.quorum} are sure` : 'everyone counted is sure';
    const req = c.required.length ? `${andList(c.required)} ${c.required.length > 1 ? 'are' : 'is'} sure and ` : '';
    return `A day works when ${req}${sure} for a ${lenAdj(ev.len)} session.`;
  }
  const zoneLabel = (tz) => E.zoneName(tz, 'long');
  const sessionsAhead = () => (ev.sessions || []).filter((s) => s.end > Date.now());

  /* ---------- the month ---------- */
  function monthGrid(ym, cell, onTap) {
    const first = E.keyOf(ym.y, ym.m, 1);
    const lead = (E.weekday(first) - WEEK0 + 7) % 7;
    const start = E.addDays(first, -lead);
    const dim = E.daysBetween(first, E.keyOf(ym.y, ym.m + 1, 1));
    const n = Math.ceil((lead + dim) / 7) * 7;
    const grid = h('div', { class: 'month', role: 'grid' });
    for (let i = 0; i < 7; i++) {
      const d = (WEEK0 + i) % 7;
      grid.append(h('div', { class: 'wd', role: 'columnheader', text: new Date(Date.UTC(2026, 10, 15 + d)).toLocaleDateString(LOCALE, { weekday: 'narrow', timeZone: 'UTC' }) }));
    }
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(E.addDays(start, i));
    const info = cell.prepare ? cell.prepare(keys) : null;
    for (const k of keys) {
      const inMonth = E.parseKey(k).m === ym.m;
      const b = h('button', { type: 'button', class: 'day' + (inMonth ? '' : ' other') + (k === todayKey() ? ' today' : ''), 'data-day': k, role: 'gridcell' },
        h('span', { class: 'dn', text: String(E.parseKey(k).d) }));
      cell(b, k, info);
      if (!b.disabled) b.addEventListener('click', () => onTap(k));
      grid.append(b);
    }
    return grid;
  }
  function monthNav(ym, set, minYm) {
    const label = new Date(Date.UTC(ym.y, ym.m - 1, 1)).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const step = (d) => { const t = new Date(Date.UTC(ym.y, ym.m - 1 + d, 1)); set({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 }); };
    const atMin = minYm && (ym.y < minYm.y || (ym.y === minYm.y && ym.m <= minYm.m));
    return h('div', { class: 'mnav' },
      h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Previous month', text: '‹', disabled: atMin, onclick: () => step(-1) }),
      h('b', { text: label }),
      h('button', { type: 'button', class: 'btn sm', 'aria-label': 'Next month', text: '›', onclick: () => step(1) }));
  }
  const ymOf = (k) => { const p = E.parseKey(k); return { y: p.y, m: p.m }; };

  function eventCell(b, k, info) {
    const past = k < todayKey(), closed = !inWindow(k);
    if (past || closed) { b.classList.add('past'); b.disabled = past; }
    const st = info.stats[k];
    if (st && st.open && !closed && st.of > 0) {
      if (st.tier === 2) b.classList.add('t2'); else if (st.tier === 1) b.classList.add('t1');
      const txt = st.sure + (st.maybe ? ` +${st.maybe}?` : '');
      b.append(h('span', { class: 'cnt', text: txt }));
      b.setAttribute('aria-label', `${E.dateText(k)}: ${st.sure} sure${st.maybe ? `, ${st.maybe} maybe` : ''} of ${st.of}${st.tier === 2 ? ', works' : st.tier === 1 ? ', works if the maybes come' : ''}`);
    }
    if (info.locked.has(k)) b.append(h('span', { class: 'lock', 'aria-hidden': 'true', text: '🔒' }));
  }
  function eventCellPrep(keys) {
    const stats = renderA ? E.dayStats(renderA, keys.filter((k) => k >= todayKey()), dispTz) : {};
    const locked = new Set((ev.sessions || []).map((s) => E.localKey(s.start, dispTz)));
    return { stats, locked };
  }
  eventCell.prepare = eventCellPrep;

  /* ---------- the event page ---------- */
  // the month on screen as day keys, first to last cell
  function gridKeys(ym) {
    const first = E.keyOf(ym.y, ym.m, 1);
    const start = E.addDays(first, -((E.weekday(first) - WEEK0 + 7) % 7));
    const n = Math.ceil((E.daysBetween(start, E.keyOf(ym.y, ym.m + 1, 1))) / 7) * 7;
    return [start, E.addDays(start, n - 1)];
  }
  function renderEvent() {
    if (!ev) return;
    const root = $('#event-view');
    root.textContent = '';
    // one analysis covering both the month on screen and the best-times horizon
    if (!shown) shown = ymOf(ev.from && ev.from > todayKey() ? ev.from : todayKey());
    const [g0, g1] = gridKeys(shown), [h0, h1] = horizon();
    const nowQ = Date.now() - (Date.now() % (15 * MIN));
    const a0 = Math.max(nowQ, Math.min(h0, E.dayStart(g0, dispTz)));
    const a1 = Math.max(h1, E.dayStart(E.addDays(g1, 1), dispTz)) + ev.len * MIN;
    renderA = answered().length && a1 > a0 ? analysis(a0, a1) : null;
    document.title = `${ev.name} · Find time to hang`;
    const mem = members(), wait = waiting();
    const ahead = sessionsAhead();
    const tzLine = h('p', { class: 'meta' },
      `${lenAdj(ev.len)} sessions · times in ${zoneLabel(dispTz)}`,
      ev.tz !== viewTz ? ' · ' : null,
      ev.tz !== viewTz ? h('button', { type: 'button', class: 'link', id: 'zone-toggle', text: dispTz === viewTz ? `show ${zoneLabel(ev.tz)}` : 'show my time', onclick: () => { dispTz = dispTz === viewTz ? ev.tz : viewTz; renderEvent(); } }) : null);
    root.append(h('section', { class: 'card head' },
      h('div', { class: 'title-row' }, h('h1', { text: ev.name }), h('button', { type: 'button', class: 'icon', id: 'settings', 'aria-label': 'Settings', text: '⚙', onclick: () => openSheet(settingsSheet()) })),
      tzLine));

    if (ahead.length) {
      const s = ahead[0];
      root.append(h('section', { class: 'card locked', id: 'next-session' },
        h('p', { class: 'kicker', text: ahead.length > 1 ? `🔒 Next of ${ahead.length} sessions` : '🔒 Locked in' }),
        h('p', { class: 'when' }, h('b', { text: s.label ? `${s.label}: ` : '' }), `${E.dateText(E.localKey(s.start, dispTz))}, ${E.spanText(s.start, s.end, dispTz)}`),
        h('div', { class: 'acts' },
          h('a', { class: 'btn sm', href: `${API}?id=${id}&ics=${s.sid}`, text: 'Add to calendar' }),
          h('button', { type: 'button', class: 'btn sm', text: 'More', onclick: () => openSheet(sessionsSheet()) }))));
    }

    // who's in
    const chips = h('div', { class: 'chips', id: 'people' });
    for (const x of mem) {
      const out = excluded.has(low(x.name));
      chips.append(h('button', { type: 'button', class: 'chip' + (x.done ? ' done' : ' wait') + (out ? ' out' : '') + (me && low(me) === low(x.name) ? ' me' : ''), 'aria-pressed': String(!out),
        title: out ? `Count ${x.name} again` : `Leave ${x.name} out`,
        onclick: () => { if (out) excluded.delete(low(x.name)); else excluded.add(low(x.name)); renderEvent(); } },
        x.done ? '✓' : null, h('span', { text: x.name }), x.req ? h('span', { class: 'req', title: 'must be there', text: '★' }) : null, x.done ? null : h('small', { text: 'waiting' })));
    }
    if (!mem.length) chips.append(h('p', { class: 'hint', text: 'Nobody yet. Share the link, or fill in your own times first.' }));
    const c = counting();
    const nudge = wait.length ? `Still waiting on ${andList(wait)} for ${ev.name}: tap your name and pick when you’re usually free ${url()}` : '';
    root.append(h('section', { class: 'card who' },
      h('h2', null, 'Who’s in ', h('small', { text: c.ans.length ? `${c.count.length} counted${excluded.size ? ` (tap a name to count them again)` : ' · tap a name to leave them out'}` : '' })),
      chips,
      wait.length ? h('div', { class: 'waiting' }, h('span', { text: `Waiting on ${andList(wait)}` }), h('button', { type: 'button', class: 'btn sm', id: 'nudge', text: 'Copy nudge', onclick: () => copy(nudge, 'Nudge copied') })) : null,
      excluded.size ? h('p', { class: 'filter' }, `Everyone except ${andList([...excluded].map((n) => (person(n) || { name: n }).name))}. `, h('button', { type: 'button', class: 'link', text: 'Count everyone', onclick: () => { excluded = new Set(); renderEvent(); } })) : null,
      h('p', { class: 'rule' }, ruleLine(), ' ', h('button', { type: 'button', class: 'link', text: 'Change', onclick: () => openSheet(settingsSheet()) })),
      c.required.some((r) => !E.answered(person(r))) ? h('p', { class: 'warn', text: `${andList(c.required.filter((r) => !E.answered(person(r))))} must be there and ${c.required.filter((r) => !E.answered(person(r))).length > 1 ? 'haven’t' : 'hasn’t'} filled in yet, so nothing can work until then.` }) : null));

    // the month
    const minYm = ymOf(todayKey());
    root.append(h('section', { class: 'card cal' },
      monthNav(shown, (ym) => { shown = ym; renderEvent(); }, minYm),
      monthGrid(shown, eventCell, (k) => openSheet(daySheet(k))),
      h('div', { class: 'legend' },
        h('span', null, h('i', { class: 'sw t2' }), 'Works'),
        h('span', null, h('i', { class: 'sw t1' }), 'Works if the maybes come')),
      h('p', { class: 'hint', text: `A number is how many are free for a whole session at that day’s best time: “4 +1?” is 4 sure and 1 maybe${c.count.length ? `, of ${c.count.length} counted` : ''}.` })));

    // best times
    root.append(bestCard());

    // recent changes, and people who were removed (they can come back)
    if (log.length || removed.length) {
      const seen = new Set(), rows = [];
      for (const x of log.slice(0, 15)) {
        // only the newest change to someone can be undone; undos already done do not block older ones
        const canUndo = !seen.has(x.who);
        if (x.what !== 'undo') seen.add(x.who);
        const evWhat = { settings: 'Settings changed', locked: 'A session was locked in', unlocked: 'A session was removed' };
        const what = x.what === 'undo' ? `${x.who === '@' ? 'An event change' : `A change to ${x.name}`} was undone`
          : x.who === '@' ? evWhat[x.what] || 'Event changed'
            : x.what === 'removed' ? `${x.name} was removed` : x.what === 'restored' ? `${x.name} was brought back` : `${x.name}’s times changed`;
        rows.push(h('li', null, h('span', { text: `${what} · ${ago(x.at)}` }), canUndo ? h('button', { type: 'button', class: 'btn sm', text: x.what === 'undo' ? 'Redo' : 'Undo', onclick: () => undo(x.n) }) : null));
      }
      for (const g of removed) rows.push(h('li', { class: 'gone' }, h('span', { text: `Removed: ${g.name}` }), h('button', { type: 'button', class: 'btn sm', text: 'Bring back', onclick: () => restore(g.name) })));
      root.append(h('details', { class: 'card changes', open: changesOpen, ontoggle: (e) => { changesOpen = e.target.open; } }, h('summary', { text: 'Recent changes' }), h('ul', null, rows)));
    }
    root.append(h('p', { class: 'foot', text: 'Schedulers disappear 90 days after the last change. Anyone with the link can edit, so keep it among friends.' }));
    $('#dock-me').textContent = me ? `My times (${me})` : 'Fill in my times';
  }

  function bestCard() {
    const card = h('section', { class: 'card best', id: 'best' }, h('h2', { text: 'Best times' }));
    const c = counting();
    if (!c.ans.length || !renderA) { card.append(h('p', { class: 'hint', text: 'Nobody has filled in yet. Once two people have, the best times show up here.' })); return card; }
    const [t0, t1] = horizon();
    const B = E.bestTimes(renderA, { tz: dispTz, limit: 6, from: t0, until: t1 });
    const span = ev.to ? `until ${E.dateText(ev.to)}` : 'in the next 8 weeks';
    card.append(h('p', { class: 'sub', text: B.fallback ? (B.windows.length ? `Nothing works yet ${span}. Closest:` : `Nothing yet ${span}.`) : `For a ${lenAdj(ev.len)} session ${span}, best first.` }));
    const ol = h('ol');
    for (const w of B.windows) {
      const k = E.localKey(w.best, dispTz);
      const tag = (w.tier === 2 ? 'Works' : w.tier === 1 ? 'If the maybes come' : 'Closest') + (w.soonest ? ' · soonest' : '');
      const sure = w.who.length - w.maybe.length;
      ol.append(h('li', { class: 'tier' + w.tier },
        h('button', { type: 'button', class: 'win', onclick: () => openSheet(daySheet(k)) },
          h('span', { class: 'cnt', text: `${sure} sure${w.maybe.length ? ` +${w.maybe.length}?` : ''}` }),
          h('span', { class: 'when', text: `${E.dateText(k)} · ${E.spanText(w.start, w.end, dispTz)}` }),
          h('span', { class: 'who', text: w.who.map((n) => (w.maybe.includes(n) ? n + '?' : n)).join(', ') }),
          h('span', { class: 'tag', text: tag }))));
    }
    card.append(ol);
    return card;
  }

  /* ---------- a day, everyone's hours ---------- */
  function dayPart(s, D0, D1, tz) {
    if (s.s <= D0 && s.e >= D1) return 'all day';
    if (s.e >= D1) return `from ${E.clock(s.s, tz)}`;
    if (s.s <= D0) return `until ${E.clock(s.e, tz)}`;
    return E.spanText(s.s, s.e, tz);
  }
  function daySheet(k) {
    return () => {
      const D0 = E.dayStart(k, dispTz), D1 = E.dayStart(E.addDays(k, 1), dispTz);
      const c = counting(), mem = members();
      const pct = (t) => `${(100 * (Math.min(D1, Math.max(D0, t)) - D0) / (D1 - D0)).toFixed(2)}%`;
      const width = (a, b) => `${(100 * (Math.min(D1, b) - Math.max(D0, a)) / (D1 - D0)).toFixed(2)}%`;
      const ticks = h('div', { class: 'axis' }, [0, 6, 12, 18].map((hr) => h('span', { style: `left:${(100 * hr) / 24}%`, text: E.clock(E.toUtc(k, `${String(hr).padStart(2, '0')}:00`, dispTz), dispTz).replace(':00', '') })));
      const daySessions = (ev.sessions || []).filter((s) => s.end > D0 && s.start < D1);
      const rows = h('div', { class: 'bars' });
      const order = [...mem].sort((a, b) => (b.done - a.done) || a.name.localeCompare(b.name));
      for (const x of order) {
        const p = person(x.name);
        const out = excluded.has(low(x.name));
        const bar = h('div', { class: 'bar' });
        for (const s of daySessions) bar.append(h('i', { class: 'sess', style: `left:${pct(s.start)};width:${width(s.start, s.end)}` }));
        let text = 'hasn’t filled in';
        if (E.answered(p)) {
          const sp = E.personSpans(p, D0, D1);
          for (const s of sp) bar.append(h('i', { class: s.lvl === 2 ? 'y' : 'm', style: `left:${pct(s.s)};width:${width(s.s, s.e)}` }));
          text = sp.length ? sp.map((s) => (s.lvl === 1 ? 'maybe ' : '') + dayPart(s, D0, D1, dispTz)).join(', ') : 'not free';
        }
        rows.append(h('div', { class: 'brow' + (out ? ' out' : '') + (E.answered(p) ? '' : ' wait') },
          h('div', { class: 'bname' }, h('b', { text: x.name }), x.req ? ' ★' : '', out ? ' (left out)' : ''),
          bar, h('div', { class: 'btext', text })));
      }
      // the best windows that start this day
      const tA = Math.max(D0, Date.now() - (Date.now() % (15 * MIN)));
      const wins = c.ans.length && tA < D1 ? E.bestTimes(analysis(tA, D1 + ev.len * MIN), { tz: dispTz, limit: 3, perDay: 3 }).windows.filter((w) => w.best < D1) : [];
      const body = [
        h('p', { class: 'meta', text: `Times in ${zoneLabel(dispTz)}. Green is free, striped is maybe.` }),
        daySessions.map((s) => h('div', { class: 'sessrow' }, h('span', { text: `🔒 ${s.label ? s.label + ': ' : ''}${E.spanText(s.start, s.end, dispTz)}` }), h('button', { type: 'button', class: 'btn sm', text: 'Open', onclick: () => openSheet(sessionSheet(s.sid)) }))),
        h('div', { class: 'timeline' }, ticks, rows),
        wins.length ? h('h3', { text: 'Best this day' }) : null,
        wins.map((w) => h('div', { class: 'winrow tier' + w.tier },
          h('div', null, h('b', { text: E.spanText(w.start, w.end, dispTz) }), h('small', { text: ` · ${w.who.length - w.maybe.length} sure${w.maybe.length ? ` +${w.maybe.length}?` : ''}` }),
            h('div', { class: 'who', text: w.who.map((n) => (w.maybe.includes(n) ? n + '?' : n)).join(', ') })),
          h('button', { type: 'button', class: 'btn sm primary', text: 'Lock in', onclick: () => openSheet(lockSheet(k, w)) }))),
        k >= todayKey() ? h('button', { type: 'button', class: 'btn', id: 'lock-other', text: wins.length ? 'Lock in another time…' : 'Lock in a time…', onclick: () => openSheet(lockSheet(k, null)) }) : null,
      ];
      const foot = [h('button', { type: 'button', class: 'btn primary', id: 'edit-my-day', text: me ? 'Change my day' : 'Fill in my times', onclick: () => (me ? openSheet(myDaySheet(k)) : openSheet(whoSheet(() => openSheet(myDaySheet(k), { replace: true })))) })];
      return { title: E.dateText(k, { weekday: 'long' }), body, foot };
    };
  }

  /* ---------- lock in ---------- */
  function lockSheet(k, w) {
    const starts = [];
    if (w) for (let t = w.start; t <= w.lastStart && starts.length < 96; t += 15 * MIN) starts.push(t);
    let start = w ? w.best : E.toUtc(k, '19:00', dispTz);
    let len = ev.len;
    let label = '';
    const n = (ev.sessions || []).length;
    return () => {
      const timeCtl = w && starts.length > 1
        ? h('select', { id: 'lock-start', onchange: (e) => { start = +e.target.value; } }, starts.map((t) => h('option', { value: t, selected: t === start, text: E.clock(t, dispTz) })))
        : w ? h('b', { text: E.clock(start, dispTz) })
          : h('input', { id: 'lock-start', type: 'time', step: 900, value: E.localHM(start, dispTz), onchange: (e) => { if (E.HM_RE.test(e.target.value)) start = E.toUtc(k, e.target.value, dispTz); } });
      const lens = [...new Set([...lenOptions, ev.len])].sort((a, b) => a - b);
      const body = [
        h('p', { class: 'meta', text: `${E.dateText(k, { weekday: 'long' })} · ${zoneLabel(dispTz)}` }),
        h('label', null, 'Starts at', timeCtl),
        h('label', null, 'For', h('select', { id: 'lock-len', onchange: (e) => { len = +e.target.value; } }, lens.map((v) => h('option', { value: v, selected: v === len, text: lenText(v) })))),
        h('label', null, 'Call it (optional)', h('input', { id: 'lock-label', maxlength: 40, placeholder: `Session ${n + 1}`, oninput: (e) => { label = e.target.value; } })),
        w && w.maybe.length ? h('p', { class: 'warn', text: `${andList(w.maybe)} ${w.maybe.length > 1 ? 'are' : 'is'} only a maybe.` }) : null,
      ];
      const foot = [h('button', { type: 'button', class: 'btn primary big', id: 'lock-go', text: 'Lock it in 🔒', onclick: async (e) => {
        e.target.disabled = true;
        const res = await api('POST', { action: 'lock', id, start, end: start + len * MIN, label });
        if (!res.ok) { e.target.disabled = false; toast(res.data.error || 'Could not lock it in'); return; }
        take(res.data);
        const s = (ev.sessions || []).find((x) => x.start === start && x.end === start + len * MIN);
        stack = [];
        renderEvent();
        if (s) openSheet(sessionSheet(s.sid));
        undoToast('Locked in', '@');
      } })];
      return { title: 'Lock in a session', body, foot };
    };
  }
  function discordLine(s) {
    const a = Math.floor(s.start / 1000), b = Math.floor(s.end / 1000);
    return `🔒 ${ev.name}${s.label ? ` · ${s.label}` : ''}: <t:${a}:F> to <t:${b}:t> (<t:${a}:R>) ${url()}`;
  }
  function sessionSheet(sid) {
    return () => {
      const s = (ev.sessions || []).find((x) => x.sid === sid);
      if (!s) return { title: 'Session', body: h('p', { text: 'That session was removed.' }) };
      const name = s.label ? `${ev.name}: ${s.label}` : ev.name;
      const body = [
        h('p', { class: 'when big' }, `${E.dateText(E.localKey(s.start, dispTz), { weekday: 'long' })}`, h('br'), `${E.spanText(s.start, s.end, dispTz)} ${E.zoneName(dispTz, 'short')}`),
        h('div', { class: 'stack' },
          h('a', { class: 'btn primary', id: 'ics', href: `${API}?id=${id}&ics=${s.sid}`, text: '📅 Add to calendar (.ics)' }),
          h('a', { class: 'btn', id: 'gcal', href: E.googleLink({ name, start: s.start, end: s.end, url: url() }), target: '_blank', rel: 'noopener', text: 'Add to Google Calendar' }),
          h('button', { type: 'button', class: 'btn', id: 'copy-discord', text: 'Copy for Discord', onclick: () => copy(discordLine(s), 'Copied for Discord') })),
        h('p', { class: 'hint', text: 'The Discord line shows the time in each reader’s own time zone.' }),
      ];
      const foot = [h('button', { type: 'button', class: 'btn danger', text: 'Remove this session', onclick: async () => {
        const res = await api('POST', { action: 'unlock', id, sid });
        if (!res.ok) { toast(res.data.error || 'Could not remove it'); return; }
        take(res.data); closeSheet(); undoToast('Session removed', '@');
      } })];
      return { title: s.label || 'Locked in', body, foot };
    };
  }
  function sessionsSheet() {
    return () => {
      const all = (ev.sessions || []).slice().sort((a, b) => a.start - b.start);
      return { title: 'Sessions', body: all.length ? all.map((s) => h('div', { class: 'sessrow' + (s.end < Date.now() ? ' past' : '') },
        h('span', { text: `${s.label ? s.label + ' · ' : ''}${E.dateText(E.localKey(s.start, dispTz))}, ${E.spanText(s.start, s.end, dispTz)}` }),
        h('button', { type: 'button', class: 'btn sm', text: 'Open', onclick: () => openSheet(sessionSheet(s.sid)) }))) : h('p', { class: 'hint', text: 'Nothing locked in yet. Tap a day, then Lock in.' }) };
    };
  }

  /* ---------- share ---------- */
  function shareSheet() {
    return () => {
      const line = `📅 ${ev.name}: tap your name and pick when you’re usually free ${url()}`;
      return {
        title: 'Share',
        body: [
          h('p', { class: 'meta', text: 'Paste it in Discord. Everyone taps their name; no logins.' }),
          h('p', { class: 'linkbox', id: 'share-link', text: url() }),
          h('div', { class: 'stack' },
            h('button', { type: 'button', class: 'btn primary', id: 'copy-link', text: 'Copy link', onclick: () => copy(url(), 'Link copied') }),
            h('button', { type: 'button', class: 'btn', id: 'copy-share', text: 'Copy a message for Discord', onclick: () => copy(line, 'Message copied') }),
            navigator.share ? h('button', { type: 'button', class: 'btn', text: 'Share…', onclick: () => navigator.share({ title: ev.name, url: url() }).catch(() => {}) }) : null),
        ],
        foot: [h('button', { type: 'button', class: 'btn', text: 'Fill in my times', onclick: () => (me ? openSheet(myTimesSheet(), { replace: true }) : openSheet(whoSheet(), { replace: true })) })],
      };
    };
  }

  /* ---------- who are you ---------- */
  function whoSheet(then) {
    let typed = store.get('hang2:lastname', '') || '';
    return () => {
      const mem = members();
      const pick = (name) => {
        me = name; store.set('hang2:me:' + id, name); store.set('hang2:lastname', name);
        startMine();
        if (then) then(); else openSheet(myTimesSheet(), { replace: true });
      };
      const input = h('input', { id: 'who-name', maxlength: 30, placeholder: 'Your name', value: mem.some((x) => low(x.name) === low(typed)) ? '' : typed, autocomplete: 'nickname', oninput: (e) => { typed = e.target.value; } });
      return {
        title: 'Who are you?',
        body: [
          mem.length ? h('div', { class: 'names' }, mem.map((x) => h('button', { type: 'button', class: 'btn name' + (x.done ? ' done' : ''), 'data-name': x.name, onclick: () => pick(x.name) }, x.name, x.done ? h('small', { text: ' ✓' }) : null))) : null,
          h('form', { class: 'who-new', onsubmit: (e) => { e.preventDefault(); const v = E.cleanText(input.value, 30); if (v) pick(v); } },
            h('label', null, mem.length ? 'Not on the list?' : 'Your name', h('div', { class: 'row' }, input, h('button', { type: 'submit', class: 'btn primary', id: 'who-go', text: 'That’s me' })))),
          h('p', { class: 'hint', text: 'No password: anyone with the link can pick any name, and every change can be undone.' }),
        ],
      };
    };
  }

  /* ---------- my times ---------- */
  const PRESETS = [
    { id: 'wkn', label: 'Weeknights', rule: { wd: [1, 2, 3, 4, 5], from: '20:00', to: null } },
    { id: 'eve', label: 'Every night', rule: { wd: [0, 1, 2, 3, 4, 5, 6], from: '21:00', to: null } },
    { id: 'fs', label: 'Fri & Sat nights', rule: { wd: [5, 6], from: '18:00', to: null } },
    { id: 'wke', label: 'Weekends', rule: { wd: [0, 6], from: null, to: null } },
    { id: 'wka', label: 'Weekend afternoons', rule: { wd: [0, 6], from: '12:00', to: '18:00' } },
    { id: 'wkd', label: 'Weekdays', rule: { wd: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' } },
  ];
  const sameRule = (a, b) => a.wd.slice().sort().join() === b.wd.slice().sort().join() && (a.from || null) === (b.from || null) && (a.to || null) === (b.to || null);
  function startMine() {
    const p = person(me);
    mine = p ? JSON.parse(JSON.stringify({ name: p.name, tz: p.tz || viewTz, rules: p.rules || [], days: p.days || [] })) : { name: me, tz: viewTz, rules: [], days: [] };
    me = mine.name;
    store.set('hang2:me:' + id, me);
  }
  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveMine, 350);
    redrawSheet();
  }
  async function saveMine() {
    saveTimer = null;
    const m = mine;
    if (!m) return;
    if (saving) { pendingSave = true; return; }
    saving = true;
    const body = { action: 'me', id, name: m.name, tz: m.tz, rules: m.rules, days: E.pruneDays(m.days, E.addDays(E.localKey(Date.now(), m.tz), -1)) };
    const res = await api('POST', body);
    saving = false;
    if (!res.ok) {
      toast(res.status === 429 ? 'Slow down a little, saving again shortly' : `Not saved: ${res.data.error || 'no connection'}`);
      if (res.status === 429 || res.status === 0 || res.status >= 500) saveTimer = setTimeout(saveMine, 4000);
      return;
    }
    take(res.data);
    // the server's spelling of the name wins (it cleans names the same way, but be sure)
    const stored = person(m.name);
    if (stored && stored.name !== m.name) { m.name = stored.name; if (mine === m) { me = stored.name; store.set('hang2:me:' + id, me); } }
    if (m.rules.length) store.set('hang2:usual', { tz: m.tz, rules: m.rules });
    remember(id, ev.name);
    if (pendingSave) { pendingSave = false; return saveMine(); }
    renderEvent();
    if (stack.length) redrawSheet();
    undoToast('Saved', low(m.name));
  }
  // offer to undo the newest change to this person (or to the event, '@'): never somebody else's
  function undoToast(msg, who) {
    const newest = log.find((x) => x.who === who);
    if (!newest) { toast(`${msg} ✓`); return; }
    toast(`${msg} ✓`, { label: 'Undo', fn: () => undo(newest.n) });
  }
  async function undo(n) {
    const was = log.find((x) => x.n === n);
    const res = await api('POST', { action: 'undo', id, n });
    if (!res.ok) { toast(res.data.error ? res.data.error[0].toUpperCase() + res.data.error.slice(1) : 'Could not undo'); return; }
    take(res.data);
    if (me) startMine();
    renderEvent();
    if (stack.length) redrawSheet();
    const redo = was && was.what !== 'undo' ? log.find((x) => x.who === was.who && x.what === 'undo') : null;
    if (redo) toast('Undone ✓', { label: 'Redo', fn: () => undo(redo.n) }); else toast(was && was.what === 'undo' ? 'Redone ✓' : 'Undone ✓');
  }
  async function restore(name) {
    const res = await api('POST', { action: 'restore', id, name });
    if (!res.ok) { toast(res.data.error ? res.data.error[0].toUpperCase() + res.data.error.slice(1) : 'Could not restore'); return; }
    take(res.data);
    renderEvent();
    undoToast(`${name} is back`, low(name));
  }

  function myTimesSheet() {
    return () => {
      if (!mine || low(mine.name) !== low(me)) startMine();
      const usual = store.get('hang2:usual', null);
      const offerUsual = !mine.rules.length && usual && usual.rules && usual.rules.length;
      const chips = h('div', { class: 'chips presets', id: 'presets' }, PRESETS.map((p) => {
        const on = mine.rules.some((r) => sameRule(r, p.rule));
        return h('button', { type: 'button', class: 'chip preset' + (on ? ' on' : ''), 'aria-pressed': String(on), 'data-preset': p.id, onclick: () => {
          if (on) mine.rules = mine.rules.filter((r) => !sameRule(r, p.rule));
          else if (mine.rules.length < 12) mine.rules.push({ ...p.rule, lvl: 'yes' });
          changed();
        } }, on ? '✓ ' : '', p.label, ' ', h('small', { text: E.rangeText(p.rule.from, p.rule.to) }));
      }), h('button', { type: 'button', class: 'chip preset other', id: 'something-else', text: 'Something else…', onclick: () => openSheet(ruleSheet(-1)) }));
      const rules = h('ul', { class: 'rules', id: 'my-rules' }, mine.rules.map((r, i) => h('li', null,
        h('button', { type: 'button', class: 'rtext', onclick: () => openSheet(ruleSheet(i)), title: 'Change' }, E.ruleText({ ...r, lvl: 'yes' }), h('small', { text: ' ✎' })),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'Sure or maybe' },
          h('button', { type: 'button', 'aria-pressed': String(r.lvl !== 'maybe'), text: 'Sure', onclick: () => { r.lvl = 'yes'; changed(); } }),
          h('button', { type: 'button', 'aria-pressed': String(r.lvl === 'maybe'), text: 'Maybe', onclick: () => { r.lvl = 'maybe'; changed(); } })),
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Remove', text: '×', onclick: () => { mine.rules.splice(i, 1); changed(); } }))));
      const days = h('ul', { class: 'rules', id: 'my-days' }, E.pruneDays(mine.days, E.localKey(Date.now(), mine.tz)).map((x) => h('li', null,
        h('span', { class: 'rtext', text: E.dayText(x) }),
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Remove', text: '×', onclick: () => { mine.days = mine.days.filter((y) => y !== x); changed(); } }))));
      if (!myShown) myShown = ymOf(E.localKey(Date.now(), mine.tz));
      const body = [
        h('p', { class: 'meta' }, 'Not you? ', h('button', { type: 'button', class: 'link', id: 'not-me', text: 'Pick another name', onclick: () => { clearTimeout(saveTimer); if (saveTimer) saveMine(); me = null; mine = null; store.set('hang2:me:' + id, null); openSheet(whoSheet(), { replace: true }); } })),
        offerUsual ? h('div', { class: 'offer' }, h('p', null, 'Your usual times from another scheduler: ', h('b', { text: usual.rules.map(E.ruleText).join('; ') })),
          h('button', { type: 'button', class: 'btn sm primary', id: 'use-usual', text: 'Use these', onclick: () => { mine.rules = usual.rules.slice(0, 12); if (E.validZone(usual.tz)) mine.tz = usual.tz; changed(); } })) : null,
        h('h3', { text: 'When are you usually free?' }),
        h('p', { class: 'hint', text: 'Pick any that fit. Tap one below to change its days or times.' }),
        chips,
        mine.rules.length ? rules : null,
        h('h3', { text: 'Days that are different' }),
        mine.days.length ? days : null,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', id: 'away-stretch', text: '✈️ Away for a stretch', onclick: () => openSheet(myDaySheet(E.addDays(E.localKey(Date.now(), mine.tz), 1), true)) }),
          h('span', { class: 'hint', text: 'or tap a day below' })),
        h('h3', { text: 'Your month' }),
        monthNav(myShown, (ym) => { myShown = ym; redrawSheet(); }, ymOf(E.localKey(Date.now(), mine.tz))),
        monthGrid(myShown, myCell, (k) => openSheet(myDaySheet(k))),
        h('div', { class: 'legend' }, h('span', null, h('i', { class: 'sw y' }), 'Free'), h('span', null, h('i', { class: 'sw m' }), 'Maybe'), h('span', null, h('i', { class: 'dot' }), 'Changed day')),
        h('p', { class: 'meta' }, 'Your times are in ', h('select', { class: 'inline', id: 'my-tz', 'aria-label': 'Your time zone', onchange: (e) => { mine.tz = e.target.value; changed(); } }, zoneOptions(mine.tz))),
      ];
      const foot = [h('button', { type: 'button', class: 'btn primary big', id: 'my-done', text: 'Done', onclick: () => { clearTimeout(saveTimer); if (mine && (mine.rules.length || mine.days.length || person(me))) saveMine(); closeSheet(); } })];
      return { title: `${mine.name}’s times`, body, foot, keepScroll: true };
    };
  }
  function myCell(b, k) {
    const today = E.localKey(Date.now(), mine.tz);
    if (k < today) { b.classList.add('past'); b.disabled = true; return; }
    const D0 = E.dayStart(k, mine.tz), D1 = E.dayStart(E.addDays(k, 1), mine.tz);
    const sp = E.personSpans(mine, D0, D1);
    if (sp.some((s) => s.lvl === 2)) b.classList.add('y'); else if (sp.length) b.classList.add('m');
    if (sp.length) {
      const whole = sp.length === 1 && sp[0].s === D0 && sp[0].e === D1;
      const t = whole ? 'all day' : E.clock(sp[0].s, mine.tz).replace(':00', '').replace(' AM', 'a').replace(' PM', 'p');
      b.append(h('span', { class: 'cnt small', text: t }));
    }
    if (mine.days.some((x) => k >= x.d1 && k <= (x.d2 || x.d1))) b.append(h('i', { class: 'dot', 'aria-hidden': 'true' }));
    b.setAttribute('aria-label', `${E.dateText(k)}: ${sp.length ? sp.map((s) => (s.lvl === 1 ? 'maybe ' : '') + E.spanText(s.s, s.e, mine.tz)).join(', ') : 'not free'}`);
  }

  /* ---------- a weekly time ---------- */
  function ruleSheet(i) {
    const r0 = i >= 0 ? mine.rules[i] : { wd: [1, 2, 3, 4, 5], from: '20:00', to: null, lvl: 'yes' };
    const st = { wd: new Set(r0.wd), mode: r0.from && r0.to ? 'between' : r0.from ? 'after' : r0.to ? 'before' : 'all', from: r0.from || '20:00', to: r0.to || '23:00', lvl: r0.lvl || 'yes' };
    const rule = () => ({ wd: [...st.wd].sort(), from: st.mode === 'after' || st.mode === 'between' ? st.from : null, to: st.mode === 'before' || st.mode === 'between' ? st.to : null, lvl: st.lvl });
    return () => {
      const re = () => redrawSheet();
      const order = [0, 1, 2, 3, 4, 5, 6].map((x) => (WEEK0 + x) % 7);
      const time = (key) => h('input', { type: 'time', step: 900, id: 'rule-' + key, value: st[key], onchange: (e) => { if (E.HM_RE.test(e.target.value)) { st[key] = e.target.value; re(); } } });
      const ok = st.wd.size > 0 && !(st.mode === 'between' && st.from === st.to) && !(st.mode === 'before' && st.to === '00:00');
      const body = [
        h('p', { class: 'readback', id: 'rule-text', text: st.wd.size ? E.ruleText(rule()) : 'Pick at least one day' }),
        h('div', { class: 'wdays', role: 'group', 'aria-label': 'Days' }, order.map((d) => h('button', { type: 'button', 'aria-pressed': String(st.wd.has(d)), 'data-wd': d,
          text: new Date(Date.UTC(2026, 10, 15 + d)).toLocaleDateString(LOCALE, { weekday: 'short', timeZone: 'UTC' }),
          onclick: () => { if (st.wd.has(d)) st.wd.delete(d); else st.wd.add(d); re(); } }))),
        h('div', { class: 'quick' },
          h('button', { type: 'button', class: 'chip', text: 'Weekdays', onclick: () => { st.wd = new Set([1, 2, 3, 4, 5]); re(); } }),
          h('button', { type: 'button', class: 'chip', text: 'Weekends', onclick: () => { st.wd = new Set([0, 6]); re(); } }),
          h('button', { type: 'button', class: 'chip', text: 'Every day', onclick: () => { st.wd = new Set([0, 1, 2, 3, 4, 5, 6]); re(); } })),
        h('div', { class: 'seg wide', role: 'group', 'aria-label': 'When' }, [['all', 'All day'], ['after', 'After'], ['before', 'Before'], ['between', 'Between']].map(([v, t]) =>
          h('button', { type: 'button', 'aria-pressed': String(st.mode === v), 'data-mode': v, text: t, onclick: () => { st.mode = v; re(); } }))),
        st.mode === 'after' ? h('label', null, 'After', time('from')) : null,
        st.mode === 'before' ? h('label', null, 'Before', time('to')) : null,
        st.mode === 'between' ? h('div', { class: 'row2' }, h('label', null, 'From', time('from')), h('label', null, 'To', time('to'))) : null,
        st.mode === 'between' && st.to < st.from ? h('p', { class: 'hint', text: 'Runs past midnight into the next day.' }) : null,
        h('div', { class: 'seg wide', role: 'group', 'aria-label': 'Sure or maybe' },
          h('button', { type: 'button', 'aria-pressed': String(st.lvl === 'yes'), text: 'Sure', onclick: () => { st.lvl = 'yes'; re(); } }),
          h('button', { type: 'button', 'aria-pressed': String(st.lvl === 'maybe'), text: 'Maybe', onclick: () => { st.lvl = 'maybe'; re(); } })),
      ];
      const foot = [
        i >= 0 ? h('button', { type: 'button', class: 'btn danger', text: 'Remove', onclick: () => { mine.rules.splice(i, 1); backSheet(); changed(); } }) : null,
        h('button', { type: 'button', class: 'btn primary', id: 'rule-save', text: 'Save', disabled: !ok, onclick: () => {
          if (i >= 0) mine.rules[i] = rule(); else if (mine.rules.length < 12) mine.rules.push(rule());
          backSheet(); changed();
        } }),
      ];
      return { title: i >= 0 ? 'Change a weekly time' : 'Add a weekly time', body, foot, keepScroll: true };
    };
  }

  /* ---------- one day, or a stretch of days ---------- */
  function myDaySheet(k, stretch = false) {
    const st = { d1: k, d2: stretch ? '' : k, panel: null, from: '18:00', to: '22:00', lvl: 'yes' };
    return () => {
      if (!mine || low(mine.name) !== low(me)) startMine();
      const re = () => redrawSheet();
      const a = st.d1, b = st.d2 && st.d2 >= st.d1 ? st.d2 : st.d1;
      const usual = mine.rules.filter((r) => r.wd.includes(E.weekday(a)));
      const now = mine.days.filter((x) => a <= (x.d2 || x.d1) && b >= x.d1);
      const apply = (entry, msg) => { mine.days = E.setDays(mine.days, a, b, entry); backSheet(); changed(); toast(msg); };
      const time = (key) => h('input', { type: 'time', step: 900, id: 'day-' + key, value: st[key], onchange: (e) => { if (E.HM_RE.test(e.target.value)) st[key] = e.target.value; } });
      const body = [
        h('div', { class: 'row2' },
          h('label', null, 'From', h('input', { type: 'date', id: 'day-from', value: st.d1, min: E.localKey(Date.now(), mine.tz), onchange: (e) => { if (E.isKey(e.target.value)) { st.d1 = e.target.value; if (st.d2 && st.d2 < st.d1) st.d2 = st.d1; re(); } } })),
          h('label', null, 'Through', h('input', { type: 'date', id: 'day-to', value: st.d2, min: st.d1, onchange: (e) => { st.d2 = E.isKey(e.target.value) ? e.target.value : ''; re(); } }))),
        h('p', { class: 'meta', text: b > a ? `${E.datesText(a, b)}, ${E.daysBetween(a, b) + 1} days` : (usual.length ? `Usually: ${usual.map((r) => E.rangeText(r.from, r.to) + (r.lvl === 'maybe' ? ' (maybe)' : '')).join(', ')}` : 'No weekly time on this day') }),
        now.length ? h('p', { class: 'meta', text: `Changed: ${now.map(E.dayText).join('; ')}` }) : null,
        h('div', { class: 'grid2' },
          h('button', { type: 'button', class: 'btn big', id: 'day-away', text: b > a ? '✈️ Away' : '🚫 Not free', onclick: () => apply({ kind: 'away' }, b > a ? `Away ${E.datesText(a, b)}` : `Not free ${E.dateText(a)}`) }),
          h('button', { type: 'button', class: 'btn big', id: 'day-free', text: '✅ Free all day', onclick: () => apply({ kind: 'only', lvl: 'yes' }, 'Free all day') }),
          h('button', { type: 'button', class: 'btn big' + (st.panel === 'only' ? ' on' : ''), id: 'day-only', text: '⏱ Only these hours…', onclick: () => { st.panel = 'only'; re(); } }),
          h('button', { type: 'button', class: 'btn big' + (st.panel === 'add' ? ' on' : ''), id: 'day-add', text: '➕ Add hours…', onclick: () => { st.panel = 'add'; re(); } })),
        st.panel ? h('div', { class: 'panel' },
          h('div', { class: 'row2' }, h('label', null, 'From', time('from')), h('label', null, 'To', time('to'))),
          h('div', { class: 'seg wide', role: 'group', 'aria-label': 'Sure or maybe' },
            h('button', { type: 'button', 'aria-pressed': String(st.lvl === 'yes'), text: 'Sure', onclick: () => { st.lvl = 'yes'; re(); } }),
            h('button', { type: 'button', 'aria-pressed': String(st.lvl === 'maybe'), text: 'Maybe', onclick: () => { st.lvl = 'maybe'; re(); } })),
          h('button', { type: 'button', class: 'btn primary', id: 'day-hours-save', text: st.panel === 'only' ? 'Only these hours' : 'Add these hours', onclick: () => {
            if (st.from === st.to) { toast('The start and end are the same'); return; }
            const entry = { kind: st.panel, from: st.from, to: st.to, lvl: st.lvl };
            if (st.panel === 'add') { const e2 = { ...entry, d1: a }; if (b > a) e2.d2 = b; mine.days.push(e2); backSheet(); changed(); toast('Hours added'); }
            else apply(entry, 'Hours set');
          } })) : null,
        now.length ? h('button', { type: 'button', class: 'btn', id: 'day-reset', text: 'Back to my usual times', onclick: () => { mine.days = E.clearDays(mine.days, a, b); backSheet(); changed(); toast('Back to usual'); } }) : null,
      ];
      return { title: b > a ? 'A stretch of days' : E.dateText(a, { weekday: 'long' }), body, keepScroll: true };
    };
  }

  /* ---------- settings ---------- */
  function settingsSheet() {
    const st = { name: ev.name, len: ev.len, tz: ev.tz, roster: (ev.roster || []).map((r) => ({ ...r })), quorum: ev.quorum || 0, from: ev.from || '', to: ev.to || '', add: '' };
    for (const p of answered()) if (!st.roster.some((r) => low(r.name) === low(p.name))) st.roster.push({ name: p.name, req: false });
    return () => {
      const re = () => redrawSheet();
      const lens = [...new Set([...lenOptions, st.len])].sort((a, b) => a - b);
      const addName = () => { const v = E.cleanText(st.add, 30); if (v && !st.roster.some((r) => low(r.name) === low(v)) && st.roster.length < 30) st.roster.push({ name: v, req: false }); st.add = ''; re(); };
      const key = store.get('hang2:key:' + id, null);
      const body = [
        h('label', null, 'Name', h('input', { id: 's-name', maxlength: 60, value: st.name, oninput: (e) => { st.name = e.target.value; } })),
        h('label', null, 'Session length', h('select', { id: 's-len', onchange: (e) => { st.len = +e.target.value; } }, lens.map((v) => h('option', { value: v, selected: v === st.len, text: lenText(v) })))),
        h('div', { class: 'lbl' }, 'People ', h('small', { text: '★ = must be there' })),
        h('ul', { class: 'roster' }, st.roster.map((r, i) => h('li', null,
          h('span', { text: r.name }),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: r.req, onchange: (e) => { r.req = e.target.checked; } }), '★ must be there'),
          h('button', { type: 'button', class: 'icon', 'aria-label': `Remove ${r.name} from the list`, text: '×', onclick: () => { st.roster.splice(i, 1); re(); } })))),
        h('form', { class: 'row', onsubmit: (e) => { e.preventDefault(); addName(); } },
          h('input', { id: 's-add', maxlength: 30, placeholder: 'Add a name', value: st.add, oninput: (e) => { st.add = e.target.value; } }),
          h('button', { type: 'submit', class: 'btn', text: 'Add' })),
        h('label', null, 'Enough people', h('select', { id: 's-quorum', onchange: (e) => { st.quorum = +e.target.value; } },
          h('option', { value: 0, selected: !st.quorum, text: 'Everyone counted' }),
          Array.from({ length: Math.max(st.roster.length, st.quorum, 2) - 1 }, (_, j) => j + 2).map((q) => h('option', { value: q, selected: q === st.quorum, text: `At least ${q}` })))),
        h('label', null, 'Home time zone', h('select', { id: 's-tz', onchange: (e) => { st.tz = e.target.value; } }, zoneOptions(st.tz))),
        h('div', { class: 'row2' },
          h('label', null, 'Only look from', h('input', { type: 'date', id: 's-from', value: st.from, onchange: (e) => { st.from = e.target.value; } })),
          h('label', null, 'until', h('input', { type: 'date', id: 's-to', value: st.to, onchange: (e) => { st.to = e.target.value; } }))),
        h('p', { class: 'hint', text: 'Anyone with the link can change these. Every change can be undone from Recent changes.' }),
        key ? h('button', { type: 'button', class: 'btn danger', text: 'Delete this scheduler', onclick: async () => {
          if (!confirm(`Delete “${ev.name}” for everyone? This cannot be undone.`)) return;
          const res = await api('POST', { action: 'delete', id, key });
          if (res.ok) { location.href = '/hang/'; } else toast(res.data.error || 'Could not delete');
        } }) : null,
      ];
      const foot = [h('button', { type: 'button', class: 'btn primary', id: 's-save', text: 'Save', onclick: async (e) => {
        if (st.add.trim()) addName();
        e.target.disabled = true;
        const res = await api('POST', { action: 'settings', id, set: { name: st.name, len: st.len, tz: st.tz, roster: st.roster, quorum: st.quorum, from: st.from || null, to: st.to || null } });
        e.target.disabled = false;
        if (!res.ok) { toast(res.data.error ? res.data.error[0].toUpperCase() + res.data.error.slice(1) : 'Not saved'); return; }
        take(res.data); closeSheet(); undoToast('Settings saved', '@');
      } })];
      return { title: 'Settings', body, foot, keepScroll: true };
    };
  }

  /* ---------- wiring ---------- */
  $('#dock-me').addEventListener('click', () => { if (!ev) return; stack = []; openSheet(me ? myTimesSheet() : whoSheet()); });
  $('#dock-share').addEventListener('click', () => { if (!ev) return; stack = []; openSheet(shareSheet()); });
  addEventListener('beforeunload', () => {
    if (saveTimer && mine) { clearTimeout(saveTimer); navigator.sendBeacon?.(API, new Blob([JSON.stringify({ action: 'me', id, name: mine.name, tz: mine.tz, rules: mine.rules, days: mine.days })], { type: 'application/json' })); }
  });
  // see other people's changes; never while a form is open or a save is waiting
  // redraw only when something changed
  let seenSig = '';
  const sig = (d) => JSON.stringify([d.event, d.people, d.log, d.removed]);
  setInterval(async () => {
    if (document.hidden || saving || saveTimer || stack.length) return;
    const res = await api('GET', null, '?id=' + encodeURIComponent(id));
    if (!res.ok) return;
    const now = sig(res.data);
    if (now === seenSig) return;
    seenSig = now;
    take(res.data);
    if (!stack.length) renderEvent();
  }, 30000);

  (async () => {
    if (!(await load())) {
      if (!$('#missing').hidden) return;
      const t = setInterval(async () => { if (await load()) { clearInterval(t); boot(); } }, 5000);
      return;
    }
    boot();
  })();
  function boot() {
    $('#event-view').hidden = false;
    $('#dock').hidden = false;
    remember(id, ev.name);
    if (me) startMine();
    renderEvent();
    const q = new URLSearchParams(location.search);
    if (q.has('share')) { history.replaceState(null, '', location.pathname); openSheet(shareSheet()); }
  }
})();
