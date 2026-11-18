/* HoloTable client */
(() => {
  const R = window.SW5E;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clone = o => JSON.parse(JSON.stringify(o));
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '');
  // Who you are comes from the server (a signed, HttpOnly session cookie the page can't read).
  let clientId = null;

  const S = { signedIn: false, st: null, selected: null, tab: 'sheet', sub: 'main', rollMode: 'normal',
    importNotes: {}, mapImg: null, mapBgVersion: -1, zoom: 1, lastChatId: null, chatHist: [], chatHistIdx: -1 };

  // --------------------------------------------------------------------------- utils
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 2600);
  }
  const API = '/api/holotable';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function post(op, body) {
    const r = await fetch(`${API}?op=${op}`, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-HoloTable': '1' }, body: JSON.stringify(body || {}) });
    const j = await r.json().catch(() => ({ error: 'Server error (' + r.status + ')' }));
    if (r.status === 401 && op !== 'login') signedOut('Your session ended. Please sign in again.');
    if (!r.ok || j.error) throw new Error(j.error || r.statusText);
    return j;
  }
  async function act(type, payload = {}) {
    try { return await post('action', { type, payload }); }
    catch (e) { toast(e.message, true); return null; }
  }
  function modal(html, onMount) {
    const box = $('#modalBox');
    box.onclick = box.oninput = box.onchange = null;
    box.innerHTML = html; $('#modal').classList.remove('hidden');
    onMount && onMount($('#modalBox'));
  }
  const closeModal = () => $('#modal').classList.add('hidden');
  const modalOpen = () => !$('#modal').classList.contains('hidden');
  $('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
  const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/\n/g, '<br>');
  const timeStr = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const n0 = v => (Number.isFinite(+v) ? +v : 0);                       // a number for display, never markup
  const color = c => (/^#[0-9a-fA-F]{6}$/.test(String(c || '')) ? c : '#4fc3f7');
  const imgUrl = u => (/^\/api\/holotable\?(img=[a-f0-9]{16,40}|a=[a-z0-9-]{3,60}\.\d{1,5})$/.test(String(u || '')) ? u : '');
  function getPath(o, p) { return p.split('.').reduce((a, k) => a == null ? a : a[k], o); }
  function setPath(o, p, v) {
    const ks = p.split('.'); let cur = o;
    ks.slice(0, -1).forEach((k, i) => { if (cur[k] == null) cur[k] = /^\d+$/.test(ks[i + 1]) ? [] : {}; cur = cur[k]; });
    cur[ks[ks.length - 1]] = v;
  }
  async function fitUpload(file, maxDim) {
    for (const [dim, q] of [[maxDim, 0.85], [maxDim, 0.7], [maxDim * 0.75, 0.7], [maxDim * 0.5, 0.7]]) {
      const r = await downscale(file, dim, q);
      if (r.dataUrl.length * 0.75 < 2.9 * 1024 * 1024) return r;
    }
    throw new Error('That image is too large, even after shrinking it.');
  }
  // keepAlpha (profile and token photos): an image with see-through parts stays a PNG, so a cut-out portrait (the
  // Duros creator's, say) keeps its transparent background instead of turning black; anything else is a JPEG as before
  const hasAlpha = ctx => { const d = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true; return false; };
  function downscale(file, maxDim, quality = 0.85, keepAlpha = false) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
          const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
          if (keepAlpha && hasAlpha(ctx)) {
            const png = c.toDataURL('image/png');
            if (png.length * 0.75 < 2.9 * 1024 * 1024) return res({ dataUrl: png, w: c.width, h: c.height });
          }
          res({ dataUrl: c.toDataURL('image/jpeg', quality), w: c.width, h: c.height });
        };
        img.onerror = rej; img.src = fr.result;
      };
      fr.onerror = rej; fr.readAsDataURL(file);
    });
  }

  // --------------------------------------------------------------------------- sign in
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    $('#lobbyError').textContent = '';
    try {
      await post('login', { name: f.get('name'), password: f.get('password') });
      store.set('holo.name', String(f.get('name') || ''));
      e.target.password.value = '';
      enterTable();
    } catch (err) { $('#lobbyError').textContent = err.message; }
  });
  function enterTable() {
    S.signedIn = true; S.st = null; S.mapBgVersion = -1; S.mapImg = null; S.lastChatId = null;
    $('#lobby').classList.add('hidden'); $('#table').classList.remove('hidden');
    connect();
  }
  function signedOut(msg) {
    if (!S.signedIn) return;
    S.signedIn = false; S.gen = (S.gen || 0) + 1;
    if (S.abort) S.abort.abort();
    closeModal();
    $('#table').classList.add('hidden'); $('#lobby').classList.remove('hidden');
    $('#lobbyError').textContent = msg || '';
  }
  $('#leaveBtn').addEventListener('click', async () => {
    try { await post('logout', {}); } catch { /* signing out anyway */ }
    signedOut('');
  });

  // Live updates: the server holds each request open until something changes (or ~8 s pass).
  // A hidden tab stops asking, and picks up again when it's shown.
  function connect() {
    const gen = S.gen = (S.gen || 0) + 1;
    pollLoop(gen);
  }
  async function pollLoop(gen) {
    let lib = null, backoff = 1000;
    S.v = '';
    while (S.signedIn && S.gen === gen) {
      if (document.hidden) { $('#conn').classList.remove('ok'); $('#conn').title = 'Paused while this tab is hidden'; return; }
      try {
        S.abort = new AbortController();
        const r = await fetch(`${API}?op=poll&v=${encodeURIComponent(S.v)}`, { cache: 'no-store', credentials: 'same-origin', signal: S.abort.signal });
        if (S.gen !== gen) return;
        const j = await r.json().catch(() => ({}));
        if (r.status === 401) return signedOut('Your session ended. Please sign in again.');
        if (!r.ok) throw new Error(j.error || 'poll failed');
        $('#conn').classList.add('ok'); $('#conn').title = 'Connected'; backoff = 1000;
        if (j.state) {
          // the GM moved the table to another campaign (12.9): this page's selection belonged to the old one
          const camp = v => (String(v || '').includes(':') ? String(v).split(':')[0] : 'main');
          if (S.v && camp(S.v) !== camp(j.v)) S.selected = null;
          S.v = j.v; onState(j.state);
        }
        if (lib !== null && j.lib !== lib && A.packs) { await loadPacks(); renderDrawer(); }
        lib = j.lib;
        if (S.lib !== j.lib) { S.lib = j.lib; if (window.HTA) HTA.sync(); }   // the GM's track list changed
      } catch (err) {
        if (S.gen !== gen || document.hidden) continue;
        $('#conn').classList.remove('ok');
        await sleep(backoff); backoff = Math.min(backoff * 2, 10000);
      }
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (!S.signedIn) return;
    if (document.hidden) {
      S.gen = (S.gen || 0) + 1; if (S.abort) S.abort.abort();
      $('#conn').classList.remove('ok'); $('#conn').title = 'Paused while this tab is hidden';
    }
    else { const keep = S.v; connect(); S.v = keep; }
  });

  // --------------------------------------------------------------------------- state
  const me = () => S.st && S.st.players[clientId];
  const isGM = () => S.st && S.st.isGM;
  const canEdit = ch => ch && (isGM() || ch.owner === clientId);
  const chars = () => Object.values((S.st && S.st.characters) || {}).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const selChar = () => S.st && S.st.characters[S.selected];

  function onState(st) {
    const first = !S.st;
    clientId = st.you;
    // fill any missing fields so partial / hand-written sheets never break rendering
    for (const [id, c] of Object.entries(st.characters)) {
      const b = R.blankCharacter();
      const n = Object.assign(b, c);
      for (const k of ['abilities', 'hp', 'deathSaves', 'force', 'tech']) n[k] = Object.assign(R.blankCharacter()[k], c[k] || {});
      for (const k of ['saves', 'skills', 'skillMisc', 'saveMisc']) if (!n[k] || typeof n[k] !== 'object') n[k] = {};
      for (const k of ['classes', 'attacks', 'powers', 'features', 'equipment', 'conditions']) if (!Array.isArray(n[k])) n[k] = [];
      if (!n.classes.length) n.classes = [{ name: 'Fighter', level: 1, archetype: '' }];
      st.characters[id] = n;
    }
    // the GM changed the scene: wipe from the old board to the new one (snapshot taken before redrawing)
    const fx = st.sceneFx;
    if (fx && S.fxSeen !== undefined && fx.n !== S.fxSeen) playSceneFx(fx);
    S.fxSeen = fx ? fx.n : null;
    S.st = st;
    document.body.classList.toggle('is-gm', !!st.isGM);
    document.body.classList.toggle('no-sw5e-books', st.sw5eBooks === false);
    if (!S.selected || !st.characters[S.selected]) {
      const mine = chars().find(c => c.owner === clientId);
      S.selected = (mine || chars()[0] || {}).id || null;
    }
    if (first && st.isGM && !chars().length) S.tab = 'gm';
    applyPrefs((st.players[clientId] || {}).prefs || store.get('holo.theme', null));
    renderAll();
    maybeCelebrate();
  }

  function guarded(id, fn) {
    const el = $('#' + id);
    const a = document.activeElement;
    if (a && el.contains(a) && a.matches('input, textarea, select') && a.type !== 'checkbox') return;
    const pane = el.closest('.pane'); const top = pane ? pane.scrollTop : 0;
    fn(el);
    if (pane) pane.scrollTop = top;
  }

  function renderAll() {
    if (!S.st) return;
    renderTop(); renderRoster(); renderTabs();
    guarded('sheet', renderSheet);
    guarded('combat', renderCombat);
    guarded('handouts', renderHandouts);
    guarded('gm', renderGM);
    if (window.HTA) HTA.sync();   // table audio: keep this screen in step, refresh the GM's audio box
    if (window.HTB) {
      HTB.renderShipsSafe();
      const v = JSON.stringify([S.st.variants || [], !!S.st.statBlocksHidden]);   // the variants, and the GM's stat-block switch (9.17)
      if (v !== S.variantsSeen) { S.variantsSeen = v; if (!$('#rules .lib') && !($('#rulesSearch') || {}).value) renderRules(); }
    }
    renderMapTools(); loadMapBg(); drawMap();
    if (window.HTC) HTC.render();   // combat view
    renderAsk();
    renderChat();
  }

  // --------------------------------------------------------------------------- the GM asks for a roll (audit 9.12)
  // The GM picks a skill, save or ability check, who rolls, a DC (shown to players or not) and whether it's secret,
  // then rolls for them at once or asks the players, who each get a Roll button here. The server rolls from the sheet.
  function askCheckOptions() {
    return `<optgroup label="Skills">${R.SKILLS.map(s => `<option value="skill:${s.key}" ${s.key === 'perception' ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>
      <optgroup label="Saving throws">${R.ABILITIES.map(a => `<option value="save:${a.key}">${esc(a.name)} save</option>`).join('')}</optgroup>
      <optgroup label="Ability checks">${R.ABILITIES.map(a => `<option value="ability:${a.key}">${esc(a.name)} check</option>`).join('')}</optgroup>`;
  }
  function openAskRoll() {
    const gmIds = new Set(Object.entries(S.st.players).filter(([, p]) => p.role === 'gm').map(([id]) => id));
    const list = chars().map(c => ({ c, pc: !gmIds.has(c.owner) }));
    modal(`<h3>🎲 Ask for a roll</h3>
      <label>Roll<select id="askWhat">${askCheckOptions()}</select></label>
      <h4 style="margin-top:10px">Who</h4>
      <div class="ask-who">${list.map(({ c, pc }) => `<label class="toggle"><input type="checkbox" class="askChar" value="${esc(c.id)}" ${pc ? 'checked' : ''}> ${esc(c.name)}${pc ? '' : ' <span class="muted">(yours)</span>'}</label>`).join('') || '<p class="muted">No characters yet.</p>'}</div>
      <div class="row wrap" style="margin-top:10px"><label>DC <input id="askDc" type="number" min="1" max="40" placeholder="none" style="width:80px"></label>
        <label class="toggle"><input type="checkbox" id="askShowDc"> players see the DC</label>
        <label class="toggle" title="A group check succeeds if at least half the group succeeds"><input type="checkbox" id="askGroup"> group check</label>
        <label class="toggle" title="Only you see the numbers; players see only that they rolled"><input type="checkbox" id="askSecret"> secret</label></div>
      <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" id="askNow" title="Roll for each of them now, from their sheets">Roll for them now</button>
        <button class="btn primary" id="askOpen" title="Each player gets a Roll button for their character">Ask the players</button></div>`, box => {
      const send = type => {
        const [what, key] = $('#askWhat').value.split(':');
        const ids = [...box.querySelectorAll('.askChar:checked')].map(x => x.value);
        if (!ids.length) return toast('Pick at least one character');
        act(type, { what, key, chars: ids, dc: $('#askDc').value, showDc: $('#askShowDc').checked, group: $('#askGroup').checked, secret: $('#askSecret').checked })
          .then(r => { if (r) closeModal(); });
      };
      box.onclick = e => { if (e.target.id === 'askNow') send('ask.roll'); if (e.target.id === 'askOpen') send('ask.open'); };
    });
  }
  function renderAsk() {
    const card = $('#askCard'), a = S.st.ask;
    if (!a) { card.classList.add('hidden'); card.innerHTML = ''; return; }
    const ch = id => S.st.characters[id], name = id => (ch(id) || {}).name || '?';
    const dc = a.dc != null && (isGM() || a.showDc) ? ` · DC ${n0(a.dc)}${isGM() && !a.showDc ? ' (hidden)' : ''}` : '';
    const ids = isGM() ? a.chars : (a.mine || []);
    const row = id => {
      const r = (a.results || {})[id];
      const res = r ? (r.done ? '✓' : `${n0(r.total)}${r.ok === true ? ' ✓' : r.ok === false ? ' ✗' : ''}`) : '';
      const canRoll = !r && (isGM() || (ch(id) && ch(id).owner === clientId));
      return `<div class="ask-row"><span>${esc(name(id))}</span><span class="spacer"></span>${res ? `<b>${esc(res)}</b>` : canRoll ? `<button class="btn tiny amber" data-ask-roll="${esc(id)}" title="Shift: advantage · Ctrl: disadvantage">Roll</button>` : '<span class="muted">waiting</span>'}</div>`;
    };
    const left = a.chars.filter(id => !(a.results || {})[id]).length;
    card.classList.remove('hidden');
    card.innerHTML = `<div class="ask-head">🎲 <b>${esc(a.check.name)}</b>${a.group ? ' <span class="muted">group</span>' : ''}${a.secret ? ' <span class="muted">secret</span>' : ''}<span class="muted">${esc(dc)}</span>
      <span class="spacer"></span>${isGM() ? `<button class="btn tiny ghost" data-ask-close title="End this request">${left ? 'Cancel' : 'Done'}</button>` : ''}</div>
      ${ids.map(row).join('')}${isGM() ? '' : `<div class="muted" style="font-size:11px">The GM asked for this roll.</div>`}`;
  }
  $('#askCard').addEventListener('click', e => {
    const a = S.st.ask; if (!a) return;
    const b = e.target.closest('[data-ask-roll]');
    if (b) { b.disabled = true; act('ask.answer', { id: a.id, charId: b.dataset.askRoll, mode: rollModeFromEvent(e) }); }
    if (e.target.closest('[data-ask-close]')) act('ask.close');
  });

  // --------------------------------------------------------------------------- top bar
  function renderTop() {
    const bar = $('#missingBar');
    bar.classList.toggle('hidden', !S.st.missing);
    if (S.st.missing) bar.innerHTML = isGM()
      ? `⚠ The table's save is missing (the database may have been full). Nothing can be changed until it's restored.
         <button class="btn small amber-fill" id="restoreLatest">Restore latest backup</button> <span class="muted">or pick one in the GM tab</span>`
      : `⚠ The table's save is missing. The GM needs to restore a backup before play can continue.`;
    $('#campName').textContent = S.st.name;
    const ck = S.st.clock, clk = $('#clock');   // in-game time (9.18): everyone sees it, the GM sets it
    clk.classList.toggle('hidden', !ck && !isGM());
    clk.textContent = ck ? `🕑 Day ${n0(ck.day)} · ${String(Math.floor(n0(ck.min) / 60)).padStart(2, '0')}:${String(n0(ck.min) % 60).padStart(2, '0')}` : '🕑 Set the time';
    clk.disabled = !isGM(); clk.classList.toggle('ghost', !ck);
    const gmTag = n => (/^\s*gm\s*$/i.test(n || '') ? '' : ' (GM)');
    $('#online').innerHTML = S.st.online.map(o => `<span class="pill ${o.gm ? 'gm' : ''}">${esc(o.name)}${o.gm ? gmTag(o.name) : ''}</span>`).join('');
  }
  $('#clock').addEventListener('click', () => { if (isGM()) openClock(); });
  function openClock() {
    const ck = S.st.clock || { day: 1, min: 8 * 60 };
    const hhmm = `${String(Math.floor(ck.min / 60)).padStart(2, '0')}:${String(ck.min % 60).padStart(2, '0')}`;
    modal(`<h3>🕑 The time in the story</h3>
      <div class="row wrap"><label>Day<input id="ckDay" type="number" min="1" value="${n0(ck.day)}" style="width:90px"></label><label>Time<input id="ckTime" type="time" value="${hhmm}"></label>
        <button class="btn small" id="ckSet">Set</button>${S.st.clock ? '<button class="btn small ghost" id="ckOff" title="Hide the clock">Hide clock</button>' : ''}</div>
      <h4 style="margin-top:12px">Move time on</h4>
      <div class="row wrap">${[['+10 min', 10, ''], ['+1 hour', 60, ''], ['Short rest', 60, 'short rest'], ['Long rest', 480, 'long rest'], ['+1 day', 1440, '']].map(([t, m, w]) => `<button class="btn small" data-ck="${m}" data-why="${w}">${t}</button>`).join('')}</div>
      <div class="row wrap" style="margin-top:8px"><label>Or<input id="ckMins" type="number" min="1" placeholder="minutes" style="width:90px"></label><input id="ckWhy" maxlength="60" placeholder="why, e.g. the trip to Mos Shuuta" style="flex:1">
        <button class="btn small" id="ckGo">Advance</button></div>
      <label class="toggle" style="margin-top:8px"><input type="checkbox" id="ckSay" checked> say it in chat</label>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn ghost" id="ckClose">Close</button></div>`, box => {
      box.onclick = async e => {
        const t = e.target, say = $('#ckSay').checked;
        if (t.id === 'ckClose') closeModal();
        if (t.id === 'ckOff') { await act('clock.set', { off: true }); closeModal(); }
        if (t.id === 'ckSet') { const [h, m] = ($('#ckTime').value || '08:00').split(':').map(Number); if (await act('clock.set', { day: +$('#ckDay').value || 1, min: (h || 0) * 60 + (m || 0) })) closeModal(); }
        if (t.dataset.ck) { if (await act('clock.advance', { mins: +t.dataset.ck, why: t.dataset.why, announce: say })) closeModal(); }
        if (t.id === 'ckGo' && +$('#ckMins').value > 0) { if (await act('clock.advance', { mins: +$('#ckMins').value, why: $('#ckWhy').value, announce: say })) closeModal(); }
      };
    });
  }
  $('#missingBar').addEventListener('click', async e => {
    if (e.target.id !== 'restoreLatest') return;
    if (!confirm('Restore the most recent automatic backup?')) return;
    try { await post('restore', { backup: 0 }); toast('Table restored'); } catch (err) { toast(err.message, true); }
  });
  $$('.rollmode button').forEach(b => b.addEventListener('click', () => {
    S.rollMode = b.dataset.mode; $$('.rollmode button').forEach(x => x.classList.toggle('on', x === b));
  }));

  // --------------------------------------------------------------------------- rolling
  function rollModeFromEvent(e) { return e && e.shiftKey ? 'adv' : e && (e.ctrlKey || e.metaKey) ? 'dis' : S.rollMode; }
  function roll(expr, label, opts = {}) {
    let e = String(expr);
    if (opts.d20) {
      const mode = opts.mode || S.rollMode;
      if (mode === 'adv') { e = e.replace(/^1d20/, '2d20kh1'); label += ' (adv)'; }
      if (mode === 'dis') { e = e.replace(/^1d20/, '2d20kl1'); label += ' (dis)'; }
    }
    return act('roll', { expr: e, label, charId: opts.charId, private: $('#privateRolls').checked, kind: opts.kind });
  }
  const d20 = b => '1d20' + (b >= 0 ? '+' : '') + b;

  // --------------------------------------------------------------------------- roster
  function renderRoster() {
    const list = chars();
    $('#charList').innerHTML = list.length ? list.map(c => {
      const hp = c.hp || {}; const pct = Math.max(0, Math.min(100, 100 * (+hp.current || 0) / (+hp.max || 1)));
      const owner = (S.st.players[c.owner] || {}).name || '—';
      const cls = (c.classes || []).map(k => `${k.name} ${n0(k.level)}`).join(' / '); // shown with esc() below
      return `<div class="char-item ${c.id === S.selected ? 'on' : ''}" data-id="${esc(c.id)}">
        <div class="avatar" style="background-color:${color(c.color)};${imgUrl(c.image) ? `background-image:url('${esc(imgUrl(c.image))}')` : ''}">${imgUrl(c.image) ? '' : esc(initials(c.name))}</div>
        <div class="meta"><div class="nm">${esc(c.name)}${pendingFor(c.id) ? ' <span class="lvl-badge" title="Level up waiting">⬆</span>' : ''}</div><div class="sub">${esc(cls)} · ${esc(owner)}</div>
        <div class="hpbar"><div style="width:${pct}%;background:${pct < 30 ? 'var(--red)' : pct < 60 ? 'var(--amber)' : 'var(--green)'}"></div></div></div></div>`;
    }).join('') : '<p class="muted" style="padding:8px">No characters yet. Import a sheet or create one.</p>';
  }
  $('#charList').addEventListener('click', e => {
    const it = e.target.closest('.char-item'); if (!it) return;
    S.selected = it.dataset.id; setTab('sheet'); renderRoster(); renderSheet($('#sheet'));
  });
  // ＋ New: SW5e's guided level-1 build (books.js) when the SW5e books are on; a blank sheet otherwise, or if chosen
  $('#newCharBtn').addEventListener('click', () => {
    const make = async built => {
      const c = built || R.blankCharacter();
      c.acAuto = true;   // a brand-new sheet works its AC out from armor (audit 5.3); old sheets and imports keep their typed AC
      if (!built) c.name = (me() && me().name ? me().name + "'s character" : 'New Character');
      c.color = ['#4fc3f7', '#ffb74d', '#66bb6a', '#ef5350', '#b388ff', '#f06292', '#4db6ac'][Math.floor(Math.random() * 7)];
      const r = await act('char.save', { char: c });
      if (r) { S.selected = r.id; S.sub = 'main'; setTab('sheet'); if (built) toast(`${c.name} is ready`); }
    };
    if (window.HTB && HTB.guidedBuild && S.st && S.st.sw5eBooks !== false) return HTB.guidedBuild(make);
    make(null);
  });

  // ---- import
  $('#importBtn').addEventListener('click', () => modal(`
    <h3>Upload a character sheet</h3>
    <div class="note" style="background:#13283a;border-color:#1f5f7d;color:#cfe8f7"><b>From the SW5e character builder (sw5e.com):</b>
      <ol style="margin:6px 0 0;padding-left:20px"><li>Open your character in the builder.</li>
      <li>Use its export option and download the <b>Roll20</b> export (a file like <code>name_roll20.json</code>) — it includes power levels, attacks and features.
        The builder's plain character JSON works too.</li>
      <li>Choose that file below, or drag it onto the Characters panel.</li></ol></div>
    <p class="muted" style="margin:0">Also accepted: <b>Foundry VTT</b> (sw5e system) actor exports and HoloTable exports. You can upload several files at once.</p>
    <div class="row"><button class="btn primary" id="pickFile">Choose .json file(s)…</button><span class="muted">or drag files onto the Characters panel</span></div>
    <label>…or paste JSON<textarea id="pasteJson" rows="8" placeholder='{"name": "…"}'></textarea></label>
    <div class="row"><span class="spacer"></span><button class="btn" id="cancelImp">Cancel</button><button class="btn primary" id="doPaste">Import pasted JSON</button></div>`,
    box => {
      $('#pickFile', box).onclick = () => $('#importFile').click();
      $('#cancelImp', box).onclick = closeModal;
      $('#doPaste', box).onclick = () => { importText($('#pasteJson', box).value, 'pasted JSON'); };
    }));
  $('#importFile').addEventListener('change', e => { importFiles(e.target.files); e.target.value = ''; });
  const roster = $('.roster');
  roster.addEventListener('dragover', e => { e.preventDefault(); roster.classList.add('dragging'); });
  roster.addEventListener('dragleave', e => { if (!roster.contains(e.relatedTarget)) roster.classList.remove('dragging'); });
  roster.addEventListener('drop', e => { e.preventDefault(); roster.classList.remove('dragging'); importFiles(e.dataTransfer.files); });
  const mapPane = $('#pane-map');
  mapPane.addEventListener('dragover', e => e.preventDefault());
  mapPane.addEventListener('drop', e => { e.preventDefault(); importFiles(e.dataTransfer.files); });
  // one entry point for anything dropped or picked: sheets (.json), asset packs, images
  async function importFiles(files) {
    const packs = [];
    for (const f of files) {
      const n = f.name.toLowerCase();
      if (/\.(dungeondraft_pack|pck|zip)$/.test(n) || (/\.(png|jpe?g|webp|gif)$/.test(n) && S.tab === 'map')) packs.push(f);
      else if (n.endsWith('.json') || f.type === 'application/json') importText(await f.text(), f.name);
      else toast(`${f.name}: not a character sheet (.json) or asset pack`, true);
    }
    if (packs.length) uploadPacks(packs);
  }

  // ---- character photos (profile portrait + map token)
  function pickPhoto(kind) {
    const ch = selChar(); if (!ch || !canEdit(ch)) return;
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        toast('Uploading photo…');
        const { dataUrl } = await downscale(f, kind === 'token' ? 400 : 800, 0.86, true);
        await post('upload', { purpose: 'photo', charId: ch.id, kind, dataUrl });
        toast(kind === 'token' ? 'Token photo updated' : 'Profile photo updated');
      } catch (err) { toast(err.message || 'Could not upload that image', true); }
    };
    inp.click();
  }
  // Import fidelity (audit 1.2): what an export leaves out, filled in from SW5e's own lists before the sheet is saved:
  // each power's level, alignment, text and prerequisite (the builder's JSON names its powers only), and worn armor's
  // kind and AC, so the sheet works its AC out (acAuto, #165) instead of 10 + Dex. Each fill is said in the import notes.
  async function enrichImport(res) {
    const c = res.char, lc = s => String(s || '').trim().toLowerCase();
    if (S.st.sw5eBooks === false) return;
    if ((c.powers || []).length) {
      const list = await powerList().catch(() => null);
      if (list) {
        let n = 0;
        for (const p of c.powers) {
          const x = list.find(y => lc(y.n) === lc(p.name) && y.t === (p.type === 'tech' ? 'tech' : 'force')) || list.find(y => lc(y.n) === lc(p.name));
          if (!x) continue;
          n++;
          if (!+p.level && x.l) p.level = x.l;
          p.type = x.t;
          if (x.t === 'force' && (!p.alignment || p.alignment === 'universal')) p.alignment = x.a || 'universal';
          if (!p.notes) p.notes = [x.ct, x.r && 'Range ' + x.r, x.d].filter(Boolean).join(' · ').slice(0, 300);
          if (!p.description) p.description = (x.desc + (x.hl ? '\n\nAt higher levels. ' + x.hl : '')).slice(0, 4000);
          if (x.pre && !p.pre) p.pre = x.pre;
        }
        if (n) {
          res.notes = res.notes.filter(t => !/include power levels/.test(t));
          res.notes.push(`Power levels and descriptions filled in from SW5e for ${n} of ${c.powers.length} powers${n < c.powers.length ? '; set the rest by hand' : ''}.`);
        }
      }
    }
    if (res.acFromDex) {
      const list = await equipList('standard').catch(() => null);
      let worn = 0;
      for (const e of (list ? c.equipment || [] : [])) {
        const it = list.find(y => lc(y.n) === lc(e.name)), a = it && R.armorFromItem(it);
        if (a) { e.armor = a; if (e.equipped) worn++; }
      }
      c.acAuto = true;   // the sheet works the AC out: worn armor and shield, or the class's unarmored rules
      res.notes = res.notes.filter(t => !/AC set to 10 \+ Dex/.test(t));
      res.notes.push(worn ? 'AC is worked out from the armor and shield you wear (their numbers are from SW5e\'s gear).' : 'AC is worked out on the sheet (no armor from SW5e\'s gear is worn); check it.');
    }
  }
  async function importText(text, src) {
    let results;
    try { results = window.SheetImporter.importAny(text); }
    catch (e) { toast(`Couldn't read ${src}: ${e.message}`, true); return; }
    closeModal();
    for (const res of [].concat(results)) {
      const same = chars().find(c => canEdit(c) && c.name.trim().toLowerCase() === String(res.char.name || '').trim().toLowerCase());
      if (same && confirm(`Update ${same.name} from this sheet?\n\nOK keeps their photos, token, and current HP / points used.\nCancel adds a separate copy.`)) {
        Object.assign(res.char, { id: same.id, color: same.color });
        res.char.hp.current = Math.min(n0(same.hp.current), n0(res.char.hp.max));
        res.char.hp.temp = n0(same.hp.temp);
        res.char.force.used = n0(same.force.used); res.char.tech.used = n0(same.tech.used);
        res.char.conditions = same.conditions || [];
      }
      await enrichImport(res);
      const r = await act('char.save', { char: res.char });
      if (r) {
        S.importNotes[r.id] = { source: res.source, notes: res.notes };
        S.selected = r.id; S.sub = 'main'; setTab('sheet'); renderRoster(); guarded('sheet', renderSheet);
        toast(`Imported ${res.char.name} (${res.source})`);
      }
    }
  }

  // --------------------------------------------------------------------------- tabs
  function setTab(t) {
    S.tab = t;
    renderTabs();
    if (t === 'map') requestAnimationFrame(drawMap);
  }
  function renderTabs() {
    if (S.tab === 'gm' && !isGM()) S.tab = 'sheet';
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
    $$('.pane').forEach(p => p.classList.toggle('on', p.id === 'pane-' + S.tab));
    document.body.classList.toggle('on-map', S.tab === 'map');   // phones give the map most of the screen
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });

  // --------------------------------------------------------------------------- sheet
  function saveChar(ch) {
    S.st.characters[ch.id] = ch;
    renderRoster();
    return act('char.save', { char: ch });
  }
  // A short rest (audit 7.2, 7.4; issue #71): spend hit dice by size, each healing its roll + Con (at least 0), then
  // finish it: resources that come back on a short rest, an Engineer's or a Scout's tech points, and a Consular's
  // Force Recovery (once per long rest, kept as a tracked resource that the long rest gives back).
  // ---- ability scores (audit 1.4), as SW5e's "Step-By-Step Characters" has it: roll 4d6 keeping the highest three,
  // six times (rolled by the server, in chat for the table), or the standard set; then place each number. Point buy
  // is SW5e's variant (the GM's option): 27 points on scores from 8 to 15. Species increases come after.
  function scoresDialog(ch, done) {
    const st = { how: 'array', values: R.STANDARD_ARRAY.slice(), pick: {}, buy: {} };
    R.ABILITIES.forEach((a, i) => { st.pick[a.key] = i; st.buy[a.key] = 8; });
    const scores = () => st.how === 'buy' ? Object.assign({}, st.buy)
      : Object.fromEntries(R.ABILITIES.map(a => [a.key, st.values[st.pick[a.key]]]));
    const body = () => {
      if (st.how === 'buy') {
        const cost = R.pointBuyCost(st.buy);
        return `<p class="muted" style="margin:0 0 8px">SW5e's variant, at the GM's option: ${R.POINT_BUDGET} points, every score from 8 to 15.</p>
          ${R.ABILITIES.map(a => `<div class="row" style="margin:4px 0"><span style="flex:1">${a.name}</span>
            <button class="btn tiny" data-sg="dn" data-k="${a.key}" ${st.buy[a.key] <= 8 ? 'disabled' : ''}>−</button>
            <b style="width:28px;text-align:center">${st.buy[a.key]}</b>
            <button class="btn tiny" data-sg="up" data-k="${a.key}" ${st.buy[a.key] >= 15 ? 'disabled' : ''}>+</button>
            <span class="muted" style="width:64px;text-align:right">${R.POINT_COST[st.buy[a.key]]} pts</span></div>`).join('')}
          <p style="margin:8px 0 0"><b style="color:${cost > R.POINT_BUDGET ? 'var(--red)' : 'var(--green)'}">${cost} of ${R.POINT_BUDGET} points</b></p>`;
      }
      if (st.how === 'roll' && !st.rolled) return `<p class="muted" style="margin:0 0 8px">Six rolls of 4d6, each keeping the highest three. They're rolled by the table and show in chat.</p>
        <button class="btn primary" data-sg="roll">🎲 Roll six scores</button>`;
      return `<p class="muted" style="margin:0 0 8px">${st.how === 'roll' ? 'Your rolls' : 'The standard set'}: <b>${st.values.join(', ')}</b>. Put each number on one ability.</p>
        ${R.ABILITIES.map(a => `<div class="row" style="margin:4px 0"><span style="flex:1">${a.name}</span>
          <select data-sg="pick" data-k="${a.key}">${st.values.map((v, i) => `<option value="${i}" ${st.pick[a.key] === i ? 'selected' : ''}>${v}</option>`).join('')}</select></div>`).join('')}`;
    };
    const ok = () => st.how === 'buy' ? R.pointBuyCost(st.buy) <= R.POINT_BUDGET : (st.how === 'array' || st.rolled) && R.usesEachOnce(scores(), st.values);
    const draw = box => {
      box.querySelector('#sgBody').innerHTML = body();
      box.querySelectorAll('[data-how]').forEach(b => b.classList.toggle('on', b.dataset.how === st.how));
      box.querySelector('#sgOk').disabled = !ok();
    };
    modal(`<h3>Ability scores: ${esc(ch.name)}</h3>
      <div class="rollmode" style="display:inline-flex;margin-bottom:10px"><button data-how="array">Standard set</button>
        <button data-how="roll">Roll 4d6</button><button data-how="buy">Point buy</button></div>
      <div id="sgBody"></div>
      <p class="muted" style="font-size:12px">These replace all six scores. Add your species' increase after (◈ on Species).</p>
      <div class="row"><span class="spacer"></span><button class="btn" id="sgCancel">Cancel</button><button class="btn primary" id="sgOk">Use these scores</button></div>`, box => {
      draw(box);
      box.onclick = async e => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.how) { st.how = t.dataset.how; st.values = st.how === 'roll' ? (st.rolls || []) : R.STANDARD_ARRAY.slice(); if (st.how === 'roll') st.rolled = !!st.rolls; draw(box); return; }
        if (t.dataset.sg === 'up' || t.dataset.sg === 'dn') { const k = t.dataset.k; st.buy[k] = Math.max(8, Math.min(15, st.buy[k] + (t.dataset.sg === 'up' ? 1 : -1))); draw(box); return; }
        if (t.dataset.sg === 'roll') {
          t.disabled = true; const got = [];
          for (let i = 1; i <= 6; i++) {
            const r = await roll('4d6dl1', `Ability score ${i} of 6`, { charId: ch.id });
            if (!r || !r.roll) { toast('A roll failed; try again.', true); t.disabled = false; return; }
            got.push(+r.roll.total);
          }
          st.rolls = got.slice().sort((x, y) => y - x); st.values = st.rolls; st.rolled = true; draw(box); return;
        }
        if (t.id === 'sgCancel') return closeModal();
        if (t.id === 'sgOk' && ok()) {
          const sc = scores(); closeModal();
          if (done) return done(sc);
          mutate(c => { c.abilities = Object.assign({}, c.abilities, sc); });
          toast('Ability scores set');
        }
      };
      box.onchange = e => {   // picking a number another ability holds swaps the two
        const sel = e.target.closest('[data-sg=pick]'); if (!sel) return;
        const k = sel.dataset.k, v = +sel.value, other = R.ABILITIES.find(a => a.key !== k && st.pick[a.key] === v);
        if (other) st.pick[other.key] = st.pick[k];
        st.pick[k] = v; draw(box);
      };
    });
  }
  // a tool or kit check (audit 6.10): the tool, the ability the GM calls for, and the proficiency tier in it
  function toolCheckDialog(ch) {
    const tools = R.toolNames(ch), tiers = [[0, 'not proficient'], ...Object.entries(R.PROF_TIERS).map(([k, v]) => [+k, v])];
    modal(`<h3>🧰 Tool check: ${esc(ch.name)}</h3>
      <label>Tool or kit<input id="tcName" list="tcList" value="${esc(tools[0] || '')}" maxlength="80" placeholder="e.g. Slicer's kit"><datalist id="tcList">${tools.map(t => `<option value="${esc(t)}">`).join('')}</datalist></label>
      <div class="row wrap"><label>Ability<select id="tcAb">${R.ABILITIES.map(a => `<option value="${a.key}" ${a.key === 'int' ? 'selected' : ''}>${a.name}</option>`).join('')}</select></label>
        <label>Proficiency<select id="tcTier">${tiers.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label>Misc<input id="tcMisc" type="number" value="0" style="width:60px"></label></div>
      <p class="muted" id="tcSum" style="margin:6px 0"></p>
      <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="tcClose">Cancel</button><button class="btn primary" id="tcRoll">Roll</button></div>`, box => {
      const sum = () => { const b = R.toolBonus(ch, $('#tcAb').value, +$('#tcTier').value, +$('#tcMisc').value), x = R.checkRollExpr(ch, +$('#tcTier').value, b); $('#tcSum').textContent = `${x.expr}${x.tier ? ` · ${x.tier}: always advantage` : ''}`; return x; };
      const auto = () => { $('#tcTier').value = String(R.toolTierFromText(ch, $('#tcName').value)); sum(); };
      auto();
      box.oninput = e => { if (e.target.id === 'tcName') auto(); else sum(); };
      box.onchange = sum;
      box.onclick = async e => {
        if (e.target.id === 'tcClose') return closeModal();
        if (e.target.id !== 'tcRoll') return;
        const x = sum(), name = $('#tcName').value.trim() || 'Tool', ab = $('#tcAb').value;
        closeModal();
        roll(x.expr, `${name} check (${ab.toUpperCase()})${x.tier ? ` (${x.tier})` : ''}${x.reliable ? ' (Reliable Talent)' : ''}`, { d20: true, charId: ch.id, kind: 'check' });
      };
    });
  }
  function shortRestDialog() {
    const id = S.selected;
    const draw = () => {
      const ch = S.st.characters[id];
      if (!ch) return '';
      const con = R.abilityMod(ch, 'con'), fr = R.forceRecovery(ch);
      const frUsed = (ch.resources || []).some(r => r.key === 'force-recovery' && r.used >= 1);
      return `<h3>${vOn('Longer Rests') ? 'Short rest (8 hours)' : 'Short rest'}: ${esc(ch.name)}</h3>
        ${vOn('Longer Rests') ? `<p class="muted">Longer Rests (variant): finishing gives back missing hit points up to half your maximum (${Math.ceil((+ch.hp.max || 0) / 2)}). One short rest a day. A quick rest (1 hour) is just the hit dice: use Spend Hit Die.</p>` : ''}
        <p class="muted">Each hit die heals its roll ${R.fmt(con)} (Con), at least 0. Hit points ${+ch.hp.current || 0} of ${+ch.hp.max || 0}.</p>
        ${R.hitDice(ch).map(d => `<div class="row" style="margin:4px 0"><span>d${d.die}${d.classes.length ? ` · ${esc(d.classes.join(', '))}` : ''}: <b>${d.total - d.used}</b> of ${d.total} left</span><span class="spacer"></span>
          <button class="btn small" data-hd="${d.die}" ${d.used >= d.total ? 'disabled' : ''}>Roll a d${d.die}</button></div>`).join('')}
        ${fr ? `<label class="check" style="margin-top:8px"><input type="checkbox" id="srFR" ${frUsed ? 'disabled' : (+ch.force.used || 0) > 0 ? 'checked' : ''}>
          Force Recovery: regain ${fr} force points${frUsed ? ' (used: it comes back after a long rest)' : ''}</label>` : ''}
        ${R.techOnShortRest(ch) ? '<p class="muted">Finishing gives back all tech points (Engineer, Scout, or a tech archetype).</p>' : ''}
        <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn" id="srClose">Close</button><button class="btn primary" id="srDone">Finish the short rest</button></div>`;
    };
    modal(draw(), box => {
      box.onclick = async e => {
        const b = e.target.closest('[data-hd]');
        if (b) {
          const ch = S.st.characters[id], die = +b.dataset.hd;
          const res = await roll(`1d${die}${R.fmt(R.abilityMod(ch, 'con'))}`, `Hit die (short rest)`, { charId: id });
          if (!res) return;
          mutate(c => {
            const dice = R.hitDice(c), d = dice.find(x => x.die === die);
            if (d && d.used < d.total) d.used++;
            c.hitDiceUsed = R.hitDiceUsedOf(dice);
            c.hp.current = Math.min(+c.hp.max, (+c.hp.current || 0) + Math.max(0, res.roll.total));
          });
          box.innerHTML = draw();
          return;
        }
        if (e.target.id === 'srClose') return closeModal();
        if (e.target.id === 'srDone') {
          const ch = S.st.characters[id], fr = R.forceRecovery(ch);
          const useFR = fr && $('#srFR', box) && $('#srFR', box).checked && !$('#srFR', box).disabled;
          const tech = R.techOnShortRest(ch) && (+ch.tech.used || 0) > 0, half = vOn('Longer Rests') ? Math.ceil((+ch.hp.max || 0) / 2) : 0;
          mutate(c => {
            if (half && (+c.hp.current || 0) >= 1) c.hp.current = Math.min(+c.hp.max || 0, (+c.hp.current || 0) + half);
            if (R.techOnShortRest(c)) c.tech.used = 0;
            c.resources = (c.resources || []).map(r => R.refillOf(c, r) === 'short' && r.used ? Object.assign({}, r, { used: 0 }) : r);
            if (useFR) {
              c.force.used = Math.max(0, (+c.force.used || 0) - fr);
              const k = (c.resources || []).find(r => r.key === 'force-recovery');
              if (k) k.used = 1; else c.resources = (c.resources || []).concat({ key: 'force-recovery', name: 'Force Recovery', max: 1, used: 1, refill: 'long' });
            }
          });
          closeModal();
          act('char.rest', { charId: ch.id, kind: 'short' });   // what else a rest resets (the combat view's Wounds DC)
          act('chat', { text: `*${ch.name} takes a short rest${half ? ' (8 hours; up to half their hit points back)' : ''}.${tech ? ' Tech points restored.' : ''}${useFR ? ` Force Recovery: ${fr} force points back.` : ''}*`, as: ch.name });
        }
      };
    });
  }
  // the variant rules the GM marks (9.16): the sheet and the table act on these
  const vOn = name => (S.st.variants || []).includes(name);
  // how long a condition from the sheet's Cast has left in a fight (audit 4.10): " · 2 rounds · Force Push"
  function fxNote(ref, c) {
    const x = ((S.st.sheetCast || {}).fx || []).find(y => (ref.char ? y.char === ref.char : y.entry === ref.entry) && y.condition === c);
    return x ? ` <span class="muted fx-note" title="From the sheet's Cast: the tracker counts it down${x.save ? '; a save at the end of each of its turns can end it sooner' : ''}">· ${n0(x.left)} round${n0(x.left) === 1 ? '' : 's'}${x.save ? ' or a save' : ''} · ${esc(x.power)}</span>` : '';
  }
  function mutate(fn) {
    const ch = clone(selChar()); fn(ch); saveChar(ch); guarded('sheet', renderSheet);
  }

  // The way into the archetype picker (audit 2.7): SW5e's classes take their archetype at 3rd level. A class at 3+ with
  // none (an import, a missed pick) gets a button; one that has it gets a small ◈ to change it. Needs the SW5e books.
  function archetypeButton(k, i, ro) {
    const cls = Object.prototype.hasOwnProperty.call(R.CLASSES, k.name) ? R.CLASSES[k.name] : null;   // a class named "constructor" is no class
    if (ro || !cls || n0(k.level) < 3 || !window.HTB || S.st.sw5eBooks === false) return '';
    return k.archetype ? `<button class="btn tiny ghost" data-act="pick-archetype" data-i="${i}" title="Change the ${esc(cls.arch)}">◈</button>`
      : `<button class="btn tiny amber" data-act="pick-archetype" data-i="${i}" title="${esc(k.name)} ${n0(k.level)} has no ${esc(cls.arch)} yet">◈ Choose ${esc(cls.arch)}</button>`;
  }
  function inp(path, val, opts = {}) {
    const ro = opts.ro ? 'disabled' : '';
    const type = opts.type || (typeof val === 'number' ? 'number' : 'text');
    const style = opts.w ? `style="width:${opts.w}"` : '';
    if (type === 'textarea') return `<textarea data-path="${path}" rows="${opts.rows || 4}" ${ro} placeholder="${esc(opts.ph || '')}">${esc(val)}</textarea>`;
    if (type === 'checkbox') return `<input type="checkbox" data-path="${path}" ${val ? 'checked' : ''} ${ro}>`;
    if (type === 'select') return `<select data-path="${path}" ${ro} ${style}>${opts.options.map(o => `<option ${String(o.v ?? o) === String(val) ? 'selected' : ''} value="${esc(o.v ?? o)}">${esc(o.t ?? o)}</option>`).join('')}</select>`;
    return `<input type="${type}" data-path="${path}" value="${esc(val ?? '')}" ${ro} ${style} ${opts.list ? `list="${opts.list}"` : ''} placeholder="${esc(opts.ph || '')}" class="${opts.cls || ''}">`;
  }

  // a small misc bonus box beside a save or skill (audit 5.5): feats, items, features; shown to read-only viewers only when set
  function miscBox(path, val, ro) {
    if (ro && !+val) return '';
    return `<span class="misc-box" title="Misc bonus (feats, items, features)">${inp(path, +val || '', { ro, type: 'number', w: '40px', ph: '±' })}</span>`;
  }
  // the record of sheet changes (audit 12.5), newest first; the GM can put any change's numbers back
  function openHistory(id) {
    const draw = async () => {
      const j = await fetch(`${API}?op=history&char=${encodeURIComponent(id)}`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ log: [] }));
      const log = (j.log || []).slice().reverse(), ch = S.st.characters[id] || {};
      const v = x => x === null || x === '' ? '—' : x === true ? 'yes' : x === false ? 'no' : String(x);
      $('#modalBox').innerHTML = `<h3>🕘 ${esc(ch.name || '')}: changes</h3><p class="muted" style="margin-top:0">The last 30 saves that changed a number. ↶ puts that change's numbers back (lists such as gear are shown, not undone).</p>
        <div class="hist">${log.map(e => `<div class="box" style="margin:6px 0;padding:8px"><div class="row"><b>${esc(e.by)}</b><span class="muted">${esc(new Date(e.ts * 1000).toLocaleString())}</span><span class="spacer"></span>
          ${e.changes.some(c => !c.view) ? `<button class="btn tiny" data-hundo="${esc(e.id)}">↶ Undo</button>` : ''}</div>
          ${e.changes.map(c => `<div style="font-size:13px"><span class="muted">${esc(c.k)}</span> ${esc(v(c.from))} → <b>${esc(v(c.to))}</b></div>`).join('')}</div>`).join('') || '<p class="muted">No changes recorded.</p>'}</div>
        <div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn ghost" id="histClose">Close</button></div>`;
    };
    modal('', box => {
      draw();
      box.onclick = async e => {
        if (e.target.id === 'histClose') return closeModal();
        const u = e.target.closest('[data-hundo]');
        if (u && confirm('Put these numbers back to what they were before this change?')) { await act('sheet.revert', { charId: id, entry: u.dataset.hundo }); setTimeout(draw, 300); }
      };
    });
  }
  // the party stash (6.9): what the party found and hasn't split yet. Anyone takes an item onto their own character;
  // the GM puts things in (🎁 Loot in the GM tab), shares out the credits and removes things.
  // ---- crafting (audit 11.2, Wretched Hives): ask, the GM approves (value, days, materials, tool), then roll
  function craftRows(ch, ro) {
    const list = (ch.craft && ch.craft.pending) || [];
    if (!list.length) return '';
    return `<div class="craft-list">${list.map(q => `<div class="row craft-row"><span>🔨 <b>${esc(q.item.name)}</b> <span class="muted">${q.ok
      ? `approved: ${n0(q.days)} day${n0(q.days) === 1 ? '' : 's'}, ${n0(q.cost).toLocaleString()} cr in materials, Intelligence with ${esc(q.tool)}`
      : `asked (about ${n0(q.value).toLocaleString()} cr); waiting for the GM`}</span></span><span class="spacer"></span>
      ${q.ok ? (!ro ? `<button class="btn tiny amber" data-act="craft-roll" data-id="${esc(q.id)}" title="Roll the Intelligence check, then the d100 for how it went">Roll</button>` : '')
        : (isGM() ? `<button class="btn tiny" data-act="craft-ok" data-id="${esc(q.id)}">Approve</button><button class="btn tiny ghost" data-act="craft-no" data-id="${esc(q.id)}">Turn down</button>` : '')
          + (!ro && !isGM() ? `<button class="btn tiny ghost" data-act="craft-cancel" data-id="${esc(q.id)}">Withdraw</button>` : '')}</div>`).join('')}</div>`;
  }
  async function openCraft(ch) {
    let std = [], enh = [];
    try { [std, enh] = await Promise.all([equipList('standard'), equipList('enhanced')]); } catch (err) { return toast(err.message, true); }
    const all = std.map(it => ({ it, enh: false })).concat(enh.map(it => ({ it, enh: true })));
    const byName = new Map(all.map(x => [x.it.n.toLowerCase(), x]));
    modal(`<h3>🔨 Craft</h3>
      <input id="craftName" list="dlCraft" placeholder="An item from SW5e's gear or enhanced items" style="width:100%">
      <datalist id="dlCraft">${all.map(x => `<option value="${esc(x.it.n)}">${esc(x.enh ? `${x.it.rar || ''} ${x.it.cat}` : x.it.cat)}</option>`).join('')}</datalist>
      <div id="craftInfo" class="muted" style="margin:8px 0">Wretched Hives: it takes the item's value ÷ 250 days, materials worth half its value, and the right tools.</div>
      <input id="craftNote" placeholder="A note for the GM (optional)" style="width:100%">
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn" id="craftNo">Cancel</button><button class="btn primary" id="craftAsk">Ask the GM</button></div>`, box => {
      const info = () => {
        const x = byName.get($('#craftName', box).value.trim().toLowerCase());
        if (!x) return null;
        const v = R.craftValue(x.it, x.enh);
        $('#craftInfo', box).textContent = `${x.it.n}: about ${v.toLocaleString()} cr · ${R.craftDays(v)} day${R.craftDays(v) === 1 ? '' : 's'} · ${Math.floor(v / 2).toLocaleString()} cr in materials · ${R.craftTool(x.it, x.enh)}`
          + (x.enh ? '. An enhanced item also needs its blueprint and a rare material; the GM decides.' : '');
        return Object.assign(x, { v });
      };
      box.oninput = e => { if (e.target.id === 'craftName') info(); };
      box.onclick = async e => {
        if (e.target.id === 'craftNo') return closeModal();
        if (e.target.id !== 'craftAsk') return;
        const x = info(); if (!x) return toast('Pick an item from the list.', true);
        const it = x.it, item = sheetItem(it, x.enh);   // what "+ from SW5e" would add: a medpac keeps its Use, an enhanced item its +N
        if (await act('craft.request', { charId: ch.id, item, value: x.v, tool: R.craftTool(it, x.enh), note: $('#craftNote', box).value.trim() })) { closeModal(); toast('Asked the GM.'); }
      };
    });
  }
  function craftApprove(ch, id) {   // the GM: the book's numbers to start with, any of them changed
    const q = ((ch.craft && ch.craft.pending) || []).find(x => x.id === id); if (!q) return;
    const tool = q.tool || R.craftTool({ n: q.item.name, cat: q.item.armor ? 'Armor' : '', sub: '' }, !!q.item.rar);
    modal(`<h3>Approve: ${esc(ch.name)} crafts ${esc(q.item.name)}</h3>${q.note ? `<p class="muted">"${esc(q.note)}"</p>` : ''}
      <div class="row wrap"><label>Value (cr) <input id="caValue" type="number" min="0" value="${n0(q.value)}" style="width:110px"></label>
        <label>Days <input id="caDays" type="number" min="0" value="${R.craftDays(q.value)}" style="width:80px"></label>
        <label>Materials (cr) <input id="caCost" type="number" min="0" value="${Math.floor(n0(q.value) / 2)}" style="width:110px"></label></div>
      <label style="margin-top:8px">Tool <input id="caTool" value="${esc(tool)}" style="width:100%"></label>
      <p class="muted" style="font-size:12px">Approving takes the days and the materials from ${esc(ch.name)}'s downtime and credits. ${q.item.rar ? 'An enhanced item needs its blueprint and a rare material: approve only if they have them.' : ''}</p>
      <div class="row"><span class="spacer"></span><button class="btn" id="caNo">Cancel</button><button class="btn primary" id="caOk">Approve</button></div>`, box => {
      $('#caValue', box).oninput = () => { const v = +$('#caValue', box).value || 0; $('#caDays', box).value = R.craftDays(v); $('#caCost', box).value = Math.floor(v / 2); };
      box.onclick = async e => {
        if (e.target.id === 'caNo') return closeModal();
        if (e.target.id !== 'caOk') return;
        if (await act('craft.decide', { charId: ch.id, id, ok: true, value: +$('#caValue', box).value || 0, days: +$('#caDays', box).value || 0, cost: +$('#caCost', box).value || 0, tool: $('#caTool', box).value })) closeModal();
      };
    });
  }

  function stashBox(ch, ro) {
    const st = S.st.stash;
    if (!st && !isGM()) return '';
    return `<div class="box stash"><h4>🎒 Party stash <span class="spacer"></span>${isGM() ? '<button class="btn tiny" data-act="stash-loot">🎁 Loot…</button>' : ''}</h4>
      ${st && st.credits ? `<div class="row"><span><b>${n0(st.credits).toLocaleString()}</b> credits</span><span class="spacer"></span>${isGM() ? '<button class="btn tiny" data-act="stash-split">Share out…</button>' : ''}</div>` : ''}
      ${st && st.items.length ? `<div class="list-rows">${st.items.map(it => `<div class="lr"><span class="nm">${it.qty > 1 ? n0(it.qty) + '× ' : ''}${esc(it.name)}${it.rar ? ` <span class="muted">${esc(it.rar)}${it.att ? ' · attunement' : ''}</span>` : ''}</span>
        ${!ro ? `<button class="btn tiny" data-act="stash-take" data-sid="${esc(it.id)}" title="Put it in ${esc(ch.name)}'s gear">Take</button>` : ''}${isGM() ? `<button class="btn tiny ghost" data-act="stash-rm" data-sid="${esc(it.id)}" title="Remove from the stash">✕</button>` : ''}</div>`).join('')}</div>`
        : '<p class="muted" style="margin:4px 0">Empty.</p>'}</div>`;
  }
  function openLoot() {   // the GM rolls loot (9.10): enhanced items by rarity from SW5e's list, plus credits, into the stash
    const L = { rar: 'Premium', cat: '', n: 3, picks: [] };
    const draw = async () => {
      let list = [];
      try { list = await equipList('enhanced'); } catch (e) { return toast(e.message, true); }
      const cats = [...new Set(list.map(x => x.cat))].sort();
      const pool = list.filter(x => (!L.rar || x.rar === L.rar) && (!L.cat || x.cat === L.cat));
      const pick = () => pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
      if (!L.picks.length) L.picks = Array.from({ length: L.n }, pick).filter(Boolean);
      $('#modalBox').innerHTML = `<h3>🎁 Loot</h3>
        <div class="row wrap"><label>Rarity<select id="ltRar">${['', 'Standard', 'Premium', 'Prototype', 'Advanced', 'Legendary', 'Artifact'].map(r => `<option value="${r}" ${r === L.rar ? 'selected' : ''}>${r || 'Any'}</option>`).join('')}</select></label>
          <label>Kind<select id="ltCat"><option value="">Any</option>${cats.map(c => `<option ${c === L.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label>How many<input id="ltN" type="number" min="1" max="10" value="${L.n}" style="width:70px"></label><button class="btn small" id="ltRoll">🎲 Roll</button></div>
        <p class="muted" style="font-size:12px">${pool.length} SW5e enhanced items match. Untick any you don't want; 🎲 on a row rerolls it.</p>
        <div class="list-rows">${L.picks.map((x, i) => `<div class="lr"><label class="toggle" style="flex:1"><input type="checkbox" class="ltOn" data-i="${i}" checked> ${esc(x.n)} <span class="muted">${esc(x.cat)} · ${esc(x.rar)}${x.att ? ' · attunement' : ''}</span></label><button class="btn tiny ghost" data-ltre="${i}" title="Roll another">🎲</button></div>`).join('') || '<p class="muted">Nothing matches; try another rarity or kind.</p>'}</div>
        <div class="row wrap" style="margin-top:8px"><label>Credits<input id="ltCr" type="number" min="0" value="0" style="width:110px"></label></div>
        <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn ghost" id="ltClose">Cancel</button><button class="btn primary" id="ltGo">Into the party stash</button></div>`;
      $('#modalBox').onclick = async e => {
        const t = e.target;
        if (t.id === 'ltClose') return closeModal();
        if (t.id === 'ltRoll') { L.rar = $('#ltRar').value; L.cat = $('#ltCat').value; L.n = Math.max(1, Math.min(10, +$('#ltN').value || 1)); L.picks = []; return draw(); }
        if (t.dataset.ltre) { const x = pick(); if (x) L.picks[+t.dataset.ltre] = x; return draw(); }
        if (t.id === 'ltGo') {
          const items = [...document.querySelectorAll('.ltOn:checked')].map(c => L.picks[+c.dataset.i]).filter(Boolean).map(x => ({ name: x.n, qty: 1, rar: x.rar, att: x.att, notes: x.cat }));
          if (await act('stash.add', { items, credits: +$('#ltCr').value || 0 })) { closeModal(); toast('Into the party stash'); }
        }
      };
    };
    modal('<p class="muted">Loading SW5e\'s enhanced items…</p>'); draw();
  }
  function openStashSplit() {
    const st = S.st.stash || { credits: 0 };
    const gmIds = new Set(Object.entries(S.st.players).filter(([, p]) => p.role === 'gm').map(([id]) => id));
    modal(`<h3>Share out ${n0(st.credits).toLocaleString()} credits</h3>
      <div class="ask-who">${chars().map(c => `<label class="toggle"><input type="checkbox" class="spChar" value="${esc(c.id)}" ${gmIds.has(c.owner) ? '' : 'checked'}> ${esc(c.name)}</label>`).join('')}</div>
      <p class="muted" style="font-size:12px">Evenly; what doesn't divide stays in the stash.</p>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn ghost" id="spClose">Cancel</button><button class="btn primary" id="spGo">Share</button></div>`, box => {
      box.onclick = async e => {
        if (e.target.id === 'spClose') closeModal();
        if (e.target.id === 'spGo') { const ids = [...box.querySelectorAll('.spChar:checked')].map(x => x.value); if (await act('stash.split', { chars: ids })) closeModal(); }
      };
    });
  }
  function renderSheet(el) {
    const ch = selChar();
    if (!ch) {
      el.innerHTML = `<div class="empty"><h2>No character selected</h2>
        <p>Upload your sheet from the SW5e character builder (the Roll20 export or character JSON), or build one from scratch.</p>
        <div class="row" style="justify-content:center"><button class="btn primary" onclick="document.getElementById('importBtn').click()">⇪ Upload sheet</button>
        <button class="btn" onclick="document.getElementById('newCharBtn').click()">＋ New character</button></div></div>`;
      return;
    }
    const ro = !canEdit(ch), lock = ro || (!isGM() && !!S.st.sheetLock);   // the GM's lock (12.6): levels, XP, max HP
    const pb = R.profBonus(ch), lvl = R.totalLevel(ch), ci = R.casterInfo(ch);
    const owner = (S.st.players[ch.owner] || {}).name || 'unknown';
    const note = S.importNotes[ch.id];
    const classOpts = Object.keys(R.CLASSES);
    const sub = S.sub;

    let html = `
    <datalist id="dlClasses">${classOpts.map(c => `<option value="${c}">`).join('')}</datalist>
    <datalist id="dlSpecies">${R.SPECIES.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="dlBg">${R.BACKGROUNDS.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
    <datalist id="dlTypes">${R.DAMAGE_TYPES.map(c => `<option value="${c}">`).join('')}</datalist>
    ${note ? `<div class="note"><b>Imported from ${esc(note.source)}.</b> Please check:<ul>${note.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      <button class="btn tiny" data-act="dismiss-note">Got it</button></div>` : ''}
    <div class="sheet-head">
      <div class="portrait-wrap"><div class="portrait ${ro ? '' : 'editable'}" ${ro ? '' : 'data-act="photo" data-kind="profile" title="Upload a profile photo"'} style="background-color:${color(ch.color)};${imgUrl(ch.image) ? `background-image:url('${esc(imgUrl(ch.image))}')` : ''}">${imgUrl(ch.image) ? '' : esc(initials(ch.name))}${ro ? '' : '<span class="cam">📷</span>'}</div>
        <div class="token-preview" title="Map token" style="background-color:${color(ch.color)};${imgUrl(ch.tokenImage || ch.image) ? `background-image:url('${esc(imgUrl(ch.tokenImage || ch.image))}')` : ''}" ${ro ? '' : 'data-act="photo" data-kind="token"'}>${imgUrl(ch.tokenImage || ch.image) ? '' : esc(initials(ch.name))}</div></div>
      <div class="sheet-title">
        ${inp('name', ch.name, { ro, cls: 'name' })}
        <div class="row wrap">
          <span class="pick-wrap">${inp('species', ch.species, { ro, list: 'dlSpecies', ph: 'Species', w: '150px' })}${!ro ? '<button class="btn tiny ghost" data-act="pick-species" title="Choose a species from SW5e (adds its traits)">◈</button>' : ''}</span>
          <span class="pick-wrap">${inp('background', ch.background, { ro, list: 'dlBg', ph: 'Background', w: '150px' })}${!ro ? '<button class="btn tiny ghost" data-act="pick-background" title="Choose a background from SW5e (adds its feature)">◈</button>' : ''}</span>
          ${inp('alignment', ch.alignment, { ro, ph: 'Alignment', w: '130px' })}
          <span class="muted">Level ${lvl} · Player: ${esc(owner)}</span>
          ${((S.st.sheetCast || {}).conc || {})[ch.id] ? `<span class="chip conc-chip" title="Concentrating (audit 4.6): a new concentration power ends it">Concentrating: ${esc(S.st.sheetCast.conc[ch.id])}${!ro ? '<button data-act="unconc" title="Stop concentrating">✕</button>' : ''}</span>` : ''}
        </div>
        <div class="row wrap">${(ch.classes || []).map((k, i) => `
          <span class="row">${inp(`classes.${i}.name`, k.name, { ro, list: 'dlClasses', w: '110px' })}
          ${inp(`classes.${i}.level`, +k.level || 1, { ro: lock, type: 'number', w: '58px' })}
          ${k.archetype ? `<span class="muted class-arch" title="${esc((R.CLASSES[k.name] || {}).arch || 'Archetype')}">${esc(k.archetype)}</span>` : ''}
          ${archetypeButton(k, i, ro)}
          ${!ro && ch.classes.length > 1 ? `<button class="btn tiny ghost" data-act="del-class" data-i="${i}">✕</button>` : ''}</span>`).join('')}
        </div>
      </div>
      <div class="sheet-actions">
        <button class="btn small amber" data-act="init">⚔ Initiative</button>
        ${pendingFor(ch.id) && !ro ? `<button class="btn small lvl-go" data-act="levelup">⬆ Level up${n0(pendingFor(ch.id).count) > 1 ? ' ×' + n0(pendingFor(ch.id).count) : ''}</button>` : ''}
        ${isGM() && !pendingFor(ch.id) ? '<button class="btn small ghost" data-act="grant" title="Give this character a new level">⬆ Grant level</button>' : ''}
        ${isGM() ? '<button class="btn small ghost" data-act="history" title="Who changed what on this sheet, and an undo for each">🕘 History</button>' : ''}
        ${isGM() && (S.st.levelUndo || {})[ch.id] ? `<button class="btn small ghost" data-act="undo-level" title="Put the sheet back to just before its last level, and grant the level again">↶ Undo level ${n0(S.st.levelUndo[ch.id])}</button>` : ''}
        <button class="btn small" data-act="token">◉ Token</button>
        <button class="btn small" data-act="export">⇩ Export</button>
        ${!ro ? '<button class="btn small danger" data-act="delete">Delete</button>' : ''}
      </div>
    </div>
    <div class="stats-row">
      ${(acx => `<div class="stat ac-stat" title="${esc(ch.acAuto ? 'Worked out from equipped armor and shield: ' + acx.text + '. Mark armor in Features & Gear.' : 'Typed by hand. Tick auto to work it out from equipped armor (and Unarmored Defense).')}"><div class="lbl">Armor Class</div>
        ${ch.acAuto ? `<div class="val">${acx.total}</div>` : inp('ac', +ch.ac || 10, { ro, type: 'number' })}
        <div class="ac-opts"><label class="muted">${inp('acAuto', !!ch.acAuto, { ro, type: 'checkbox' })} auto</label>${ch.acAuto ? `<span class="muted">misc</span>${inp('acMisc', +ch.acMisc || 0, { ro, type: 'number', w: '44px' })}` : ''}</div></div>`)(R.armorClass(ch))}
      <div class="stat rollable" data-roll="${d20(R.initiative(ch))}" data-label="Initiative" data-d20="1"><div class="lbl">Initiative</div><div class="val">${R.fmt(R.initiative(ch))}</div></div>
      <div class="stat"><div class="lbl">Speed</div>${inp('speed', +ch.speed || 30, { ro, type: 'number' })}${(sp => (sp.slow ? `<div class="muted" style="font-size:11px" title="${esc(sp.parts.join(' · '))}">${n0(sp.speed)} ft now ⓘ</div>` : '')
        + (Object.keys(sp.other).length ? `<div class="muted" style="font-size:11px" title="From the species traits on this sheet">${Object.entries(sp.other).map(([k, v]) => `${k} ${n0(v)}`).join(' · ')}</div>` : ''))(R.speedOf(ch, S.st.variants))}</div>
      <div class="stat"><div class="lbl">Proficiency</div><div class="val">${R.fmt(pb)}</div></div>
      <div class="stat" title="Passive scores: 10 + the skill's bonus (audit 5.13)"><div class="lbl">Passive Perc.</div><div class="val">${R.passive(ch, 'perception')}</div>
        <div class="muted" style="font-size:11px">Insight ${R.passive(ch, 'insight')} · Invest. ${R.passive(ch, 'investigation')}</div></div>
      <div class="stat"><div class="lbl">Hit Dice</div><div class="val" style="font-size:15px;padding-top:6px">${esc(R.hitDiceSummary(ch))}</div>
        <div class="muted" style="font-size:11px" title="${esc(R.hitDice(ch).map(d => `d${d.die}: ${d.used} of ${d.total} used`).join(' · '))}">used ${inp('hitDiceUsed', R.hitDiceUsedTotal(ch), { ro, type: 'number', w: '58px' })}</div></div>
      <div class="stat"><div class="lbl">Inspiration</div><div style="padding-top:6px">${inp('inspiration', ch.inspiration, { ro, type: 'checkbox' })}</div></div>
    </div>
    <div class="senses-row" title="What this character perceives in the dark or unseen. Choosing a species sets them; only the GM changes them by hand.">
      <span class="lbl">Senses</span> <span>${esc(R.sensesText(ch.senses)) || '<span class="muted">none (normal sight)</span>'}</span>
      ${isGM() ? '<button class="btn tiny ghost" data-act="senses" title="Set the senses of this character (GM)">✎</button>' : ''}
      <span class="lbl" style="margin-left:14px" title="Choosing a species sets it; the GM can change it. A token placed for this character takes its size.">Size</span>
      ${isGM() ? inp('size', ch.size || 'Medium', { type: 'select', w: '120px', options: R.SIZES }) : `<span>${esc(ch.size || 'Medium')}</span>`}</div>
    <div class="subtabs">${[['main', 'Abilities & Skills'], ['actions', 'Attacks & Powers'], ['gear', 'Features & Gear'], ['bio', 'Bio & Notes']]
      .map(([k, t]) => `<button data-act="sub" data-sub="${k}" class="${sub === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;

    if (sub === 'main') {
      if (!ro) html += `<div class="row" style="justify-content:flex-end;margin:0 0 6px"><button class="btn tiny ghost" data-act="gen-scores"
        title="Set all six scores: the standard set, rolled 4d6 (in chat), or point buy">🎲 Ability scores…</button></div>`;
      html += `<div class="stats-row">${R.ABILITIES.map(a => {
        const m = R.abilityMod(ch, a.key);
        return `<div class="stat ability"><div class="lbl">${a.name}</div>
          <div class="val" data-roll="${d20(m)}" data-label="${a.name} check" data-d20="1" data-check="${m}" title="Alt-click: a careful check (take 10)">${R.fmt(m)}</div>
          ${inp('abilities.' + a.key, +ch.abilities[a.key] || 10, { ro, type: 'number' })}</div>`;
      }).join('')}</div>
      <div class="grid g2">
        <div class="box hp-box"><h4>Hit Points</h4>
          <div class="row wrap"><span>${inp('hp.current', +ch.hp.current || 0, { ro, type: 'number', cls: 'hpnum' })}</span><span class="muted">/</span>
            <span>${inp('hp.max', +ch.hp.max || 0, { ro: lock, type: 'number', cls: 'hpnum' })}</span>
            <span class="muted">temp</span>${inp('hp.temp', +ch.hp.temp || 0, { ro, type: 'number', w: '60px' })}</div>
          ${!ro ? `<div class="row hp-adjust" style="margin-top:8px"><input id="hpDelta" placeholder="-7 or +5">
            <button class="btn small danger" data-act="hp" data-sign="-1">Damage</button><button class="btn small" data-act="hp" data-sign="1" style="color:var(--green)">Heal</button></div>
          <div class="row wrap" style="margin-top:8px"><button class="btn small" data-act="short-rest">${vOn('Longer Rests') ? 'Quick Rest (1 h)' : 'Spend Hit Die'}</button>
            <button class="btn small" data-act="short-rest-done" title="${R.techOnShortRest(ch) ? 'Regain all tech points (Engineer, Scout, or a tech archetype). Spend Hit Dice to heal.' : 'Spend Hit Dice to heal during it.'}">Short Rest</button>
            <button class="btn small" data-act="long-rest" ${vOn('Longer Rests') ? 'title="Longer Rests (variant): two days, once a week"' : ''}>${vOn('Longer Rests') ? 'Long Rest (2 days)' : 'Long Rest'}</button>
            ${vOn('Exertion') ? '<button class="btn small amber" data-act="exert" title="Exertion (variant): roll a hit die without spending it and add it to a check, attack or save, or move 5 ft × the roll farther. You lose that many hit points.">💪 Exert</button>' : ''}</div>` : ''}
          <h4 style="margin-top:12px">Death Saves</h4>
          <div class="row"><span class="muted">Successes</span><span class="dots">${[1, 2, 3].map(n => `<span class="dot s ${ch.deathSaves.s >= n ? 'on' : ''}" data-act="ds" data-k="s" data-n="${n}"></span>`).join('')}</span>
            <span class="muted">Failures</span><span class="dots">${[1, 2, 3].map(n => `<span class="dot f ${ch.deathSaves.f >= n ? 'on' : ''}" data-act="ds" data-k="f" data-n="${n}"></span>`).join('')}</span>
            ${!ro ? '<button class="btn tiny" data-act="death-roll">Roll</button>' : ''}</div>
          <h4 style="margin-top:12px">Conditions</h4>
          <div>${(ch.conditions || []).map((c, i) => `<span class="chip" title="${esc(R.CONDITIONS[c] || '')}">${esc(c)}${fxNote({ char: ch.id }, c)}${!ro ? `<button data-act="rm-cond" data-i="${i}">✕</button>` : ''}</span>`).join('') || '<span class="muted">None</span>'}
            ${!ro ? `<select data-act-change="add-cond"><option value="">+ add…</option>${Object.keys(R.CONDITIONS).map(c => `<option>${c}</option>`).join('')}</select>` : ''}</div>
          <div class="row" style="margin-top:8px" title="${esc(R.CONDITIONS.Exhaustion)}"><span class="muted">Exhaustion ⓘ</span>${inp('exhaustion', +ch.exhaustion || 0, { ro, type: 'number', w: '56px' })}</div>
        </div>
        <div class="box"><h4>Saving Throws</h4><div class="list-rows">${R.ABILITIES.map(a => {
          const b = R.saveBonus(ch, a.key);
          return `<div class="lr"><button class="prof ${ch.saves[a.key] ? 'p1' : ''}" data-act="save-prof" data-ab="${a.key}" ${ro ? 'disabled' : ''}></button>
            <span class="bonus">${R.fmt(b)}</span><span class="nm rollable" data-roll="${d20(b)}" data-label="${a.name} save" data-d20="1">${a.name}</span>
            ${miscBox('saveMisc.' + a.key, (ch.saveMisc || {})[a.key], ro)}</div>`;
        }).join('')}</div></div>
        <div class="box" style="grid-row: span 2"><h4>Skills <span class="muted" style="text-transform:none;letter-spacing:0">click dot: none → proficient → expertise → half · long-press or right-click a dot: mastery tiers · Alt-click a skill: careful check</span></h4><div class="list-rows">${R.SKILLS.map(s => {
          const b = R.skillBonus(ch, s.key), lv = +(ch.skills[s.key] || 0);
          return `<div class="lr"><button class="prof ${lv >= 3 ? 'p2 p' + lv : lv === 2 ? 'p2' : lv === 1 ? 'p1' : lv === 0.5 ? 'p05' : ''}" data-act="skill-prof" data-sk="${s.key}" ${ro ? 'disabled' : ''} title="${lv ? esc(R.PROF_TIERS[lv]) : 'not proficient'}"></button>
            ${(sr => `<span class="bonus">${R.fmt(b)}</span><span class="nm rollable" data-roll="${esc(sr.expr)}" data-label="${s.name}${sr.tier ? ` (${sr.tier}${lv >= 5 ? ': may reroll the other die once too' : ''})` : ''}${sr.reliable ? ' (Reliable Talent)' : ''}" data-d20="1" data-check="${b}" title="${sr.tier ? `${sr.tier[0].toUpperCase() + sr.tier.slice(1)}: twice the bonus and always advantage. ` : ''}${sr.reliable ? 'Reliable Talent: the d20 counts as at least 8. ' : ''}Alt-click: a careful check (take 10)">${s.name}</span>`)(R.skillRollExpr(ch, s.key))}<span class="ab">${s.ab}</span>
            ${miscBox('skillMisc.' + s.key, (ch.skillMisc || {})[s.key], ro)}</div>`;
        }).join('')}</div></div>
      </div>`;
    }

    // the variant rules that live on the sheet (9.16), each only while the GM uses it
    function variantBits(ch, ci, fMax, tMax, ro) {
      const out = [];
      if (fMax > 0 && vOn('Simplified Forcecasting')) out.push(`<label class="mini" title="Simplified Forcecasting (variant): one ability for every force power">Forcecasting ability ${ro ? esc(ch.forceAbility === 'cha' ? 'Charisma' : ch.forceAbility === 'wis' ? 'Wisdom' : 'by alignment')
        : `<select data-act-change="force-ability"><option value="">by alignment (Wis light, Cha dark)</option><option value="wis" ${ch.forceAbility === 'wis' ? 'selected' : ''}>Wisdom</option><option value="cha" ${ch.forceAbility === 'cha' ? 'selected' : ''}>Charisma</option></select>`}</label>`);
      if (vOn('Saving Throw Checks') && (fMax > 0 || tMax > 0)) out.push(`<span class="muted" title="Saving Throw Checks (variant): you roll d20 + this against the target's defense save DC (14 + its save bonus)">Save checks: ${[fMax > 0 ? `light ${R.fmt(ci.lightDC - 8)}, dark ${R.fmt(ci.darkDC - 8)}` : '', tMax > 0 ? `tech ${R.fmt(ci.techDC - 8)}` : ''].filter(Boolean).join(' · ')}</span>`);
      if (!ro && vOn('Force and Tech Prowess') && (fMax > 0 || tMax > 0)) out.push(`<span title="Force and Tech Prowess (variant): after a failed check that added your proficiency bonus, without advantage or disadvantage, spend 1 point to reroll it once">${fMax > 0 ? '<button class="btn tiny" data-act="prowess" data-k="force">Force Prowess (1 FP)</button>' : ''}${tMax > 0 ? ' <button class="btn tiny" data-act="prowess" data-k="tech">Tech Prowess (1 TP)</button>' : ''}</span>`);
      if (vOn('Hunted') && fMax > 0) out.push(`<span title="Hunted (variant): each force power adds its level; the GM rolls d100 after a fight; a long rest takes off the character's level">Disturbance <b>${n0(ch.disturbance)}</b>${isGM() ? ' <button class="btn tiny" data-act="hunted-roll">Roll d100</button>' : ''}</span>`);
      return out.length ? `<div class="row wrap" style="gap:10px;margin-top:6px;font-size:13px">${out.join('')}</div>` : '';
    }
    // class resources (audit 3.2-3.11): rages, superiority dice, Second Wind... from SW5e's class tables, spent and
    // given back here (the combat view reads the same list), plus each class's table values at its level
    function classResourcesBox(ch, ro) {
      const rows = R.resourceRows(ch), miss = R.missingClassResources(ch), tbl = R.classTableAt(ch);
      if (!rows.length && !miss.length && !tbl.length) return '';
      const refill = { short: 'short rest', long: 'long rest', turn: 'each turn' };
      return `<div class="box class-res" style="margin-top:12px"><h4>Class resources <span class="spacer"></span>${!ro && miss.length
        ? `<button class="btn tiny" data-act="add-class-res" title="${esc(miss.map(p => p.name).join(', '))}">＋ Add ${miss.map(p => esc(p.name)).join(', ')}</button>` : ''}</h4>
        ${rows.length ? `<div class="list-rows">${rows.map(r => `<div class="lr res-row">
          <span class="nm${r.die ? ' rollable' : ''}" ${r.die ? `data-roll="1${esc(r.die)}" data-label="${esc(r.name)}" title="Roll a ${esc(r.die)}"` : ''}>${esc(r.name)}${r.die ? ` <span class="muted">${esc(r.die)}</span>` : ''}</span>
          ${r.max <= 12 ? `<span class="dots">${Array.from({ length: r.max }, (_, k) => `<span class="dot ${k < r.max - r.used ? 'on' : ''}"></span>`).join('')}</span>` : ''}
          <span class="bonus">${r.max - r.used}/${r.max}</span>
          ${!ro ? `<button class="btn tiny" data-act="res-use" data-i="${r.i}" ${r.used >= r.max ? 'disabled' : ''} title="Spend one">Use</button><button class="btn tiny ghost" data-act="res-back" data-i="${r.i}" ${r.used <= 0 ? 'disabled' : ''} title="Get one back">+1</button>` : ''}
          <span class="muted res-refill">${refill[r.refill] || ''}</span></div>`).join('')}</div>` : '<p class="muted">Nothing to track yet.</p>'}
        ${R.infuseBonus(ch) ? `<div class="lr res-row" title="Infuse Item (Engineer): one armor, shield or weapon until your next long rest. +${R.infuseBonus(ch)} to AC, or to attack and damage rolls.">
          <span class="nm">Infuse Item <span class="muted">+${R.infuseBonus(ch)}</span></span>
          ${ro ? `<span>${esc(String(ch.infused || '').replace(/^(attack|equipment):/, '') || '—')}</span>` : `<select data-act-change="infuse"><option value="">— nothing infused —</option>${(ch.attacks || []).map(a => `<option value="attack:${esc(a.name)}" ${ch.infused === 'attack:' + a.name ? 'selected' : ''}>⚔ ${esc(a.name)}</option>`).join('')}${(ch.equipment || []).filter(e => e.armor && e.armor.kind).map(e => `<option value="equipment:${esc(e.name)}" ${ch.infused === 'equipment:' + e.name ? 'selected' : ''}>🛡 ${esc(e.name)}</option>`).join('')}</select>`}
          <span class="muted res-refill">until long rest</span></div>` : ''}
        ${tbl.filter(t => t.cols.length).map(t => `<div class="class-tbl"><b>${esc(t.cls)} ${t.level}</b> ${t.cols.map(([h, v]) => `<span><span class="muted">${esc(h)}</span> ${esc(v)}</span>`).join(' · ')}</div>`).join('')}
      </div>`;
    }
    if (sub === 'actions') {
      const fMax = ch.force.max !== '' && ch.force.max != null ? +ch.force.max : ci.forceMax;
      const tMax = ch.tech.max !== '' && ch.tech.max != null ? +ch.tech.max : ci.techMax;
      const pts = (k, max, used, cls, label, extra) => `<div class="box"><h4>${label}</h4>
        <div class="points"><b>${Math.max(0, max - used) + (+ch[k].temp || 0)}</b><span class="muted">/ ${max}${+ch[k].temp ? ` (+${n0(ch[k].temp)} temp)` : ''}</span>
          <div class="meter ${cls}"><div style="width:${max ? 100 * Math.max(0, max - used) / max : 0}%"></div></div>
          <span class="muted">used</span>${inp(k + '.used', +used || 0, { ro, type: 'number' })}
          <span class="muted">max override</span>${inp(k + '.max', ch[k].max ?? '', { ro, type: 'number', ph: String(k === 'force' ? ci.forceMax : ci.techMax) })}
          <span class="muted" title="Temporary points: spent first, gone after a long rest. A new source replaces them; they don't add up.">temp</span>${inp(k + '.temp', +ch[k].temp || 0, { ro, type: 'number', w: '56px' })}</div>
        <div class="muted" style="margin-top:6px;font-size:12px">${extra}</div></div>`;
      html += `<div class="box"><h4>Attacks <span class="spacer"></span>${!ro ? `<button class="btn tiny" data-act="pick-weapon">＋ weapon from SW5e</button><button class="btn tiny ghost" data-act="add-attack">custom</button>` : ''}</h4>
        <table class="t"><thead><tr><th>Name</th><th>Ability</th><th title="Tick if proficient with this weapon">Prof.</th><th>Hit</th><th title="The d20 this attack crits on (19 = 19-20)">Crit</th><th>Damage die</th><th>Type</th><th>Properties</th><th></th></tr></thead><tbody>
        ${(ch.attacks || []).map((a, i) => {
          const hit = R.attackBonus(ch, a), dmg = R.damageExpr(ch, a);
          return `<tr><td>${inp(`attacks.${i}.name`, a.name, { ro })}</td>
            <td style="width:96px">${inp(`attacks.${i}.ab`, a.ab || 'str', { ro, type: 'select', options: [{ v: 'str', t: 'Str' }, { v: 'dex', t: 'Dex' }, { v: 'finesse', t: 'Finesse' }, { v: 'con', t: 'Con' }, { v: 'int', t: 'Int' }, { v: 'wis', t: 'Wis' }, { v: 'cha', t: 'Cha' }] })}</td>
            <td style="width:40px;text-align:center">${inp(`attacks.${i}.proficient`, a.proficient !== false, { ro, type: 'checkbox' })}</td>
            <td style="width:120px"><button class="btn small amber" data-act="atk" data-i="${i}">${R.fmt(hit)}</button> ${inp(`attacks.${i}.magic`, a.magic || '', { ro, type: 'number', w: '58px', ph: '+0' })}
              ${R.reloadOf(a) ? `<div class="shots" title="Shots left before a reload (Reload ${R.reloadOf(a)}). Reloading uses one ${esc(R.ammoOf(a).toLowerCase())}.">${R.shotsOf(a)}/${R.reloadOf(a)} ${!ro ? `<button class="btn tiny ghost" data-act="reload" data-i="${i}">⟳ Reload</button>` : ''}</div>` : ''}</td>
            <td style="width:56px">${inp(`attacks.${i}.critRange`, +a.critRange || 20, { ro, type: 'number', w: '48px' })}</td>
            <td style="width:160px"><div class="row">${inp(`attacks.${i}.damage`, a.damage || '', { ro, w: '64px' })}<button class="btn small" data-act="dmg" data-i="${i}" title="${esc(dmg)}">Dmg</button><button class="btn tiny" data-act="crit" data-i="${i}" title="Critical: dice doubled">Crit</button></div></td>
            <td style="width:100px">${inp(`attacks.${i}.type`, a.type || '', { ro, list: 'dlTypes' })}</td>
            <td>${inp(`attacks.${i}.props`, a.props || '', { ro })}</td>
            <td>${!ro ? `<button class="btn tiny ghost" data-act="del" data-list="attacks" data-i="${i}">✕</button>` : ''}</td></tr>`;
        }).join('') || '<tr><td colspan="9" class="muted">No attacks yet.</td></tr>'}</tbody></table>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Hit = ability mod + proficiency if ticked (+ the small box for enhancements). Damage adds the ability mod automatically. Crit is the lowest d20 that crits (20 by default; a Keen weapon from SW5e starts lower). A Reload weapon counts its shots; ⟳ Reload uses a power cell or slug cartridge from your gear.</p></div>
      <div class="grid g2" style="margin-top:12px">
        ${pts('force', fMax, +ch.force.used || 0, '', 'Force Points', `Light DC ${ci.lightDC} / atk ${R.fmt(ci.lightAtk)} · Dark DC ${ci.darkDC} / atk ${R.fmt(ci.darkAtk)}${ci.forceMaxLevel ? ' · max power level ' + ci.forceMaxLevel : ''}${highNote(ch, 'force', ci.forceMaxLevel)}`)}
        ${pts('tech', tMax, +ch.tech.used || 0, 'tech', 'Tech Points', `Tech DC ${ci.techDC} / atk ${R.fmt(ci.techAtk)}${ci.techMaxLevel ? ' · max power level ' + ci.techMaxLevel : ''}${highNote(ch, 'tech', ci.techMaxLevel)}`)}
      </div>
      ${variantBits(ch, ci, fMax, tMax, ro)}
      ${tMax > 0 && !R.hasTechFocus(ch) ? '<p class="muted" style="font-size:12px;margin:6px 0 0" title="SW5e: tech powers are cast through a tech focus. The GM decides how strictly the table holds to it.">⚠ No wristpad or chassis in the gear. SW5e casts tech powers through a tech focus (add one under Equipment).</p>' : ''}
      ${classResourcesBox(ch, ro)}
      <div class="box" style="margin-top:12px"><h4>Powers ${(pk => ['force', 'tech'].filter(t => pk[t].max).map(t => `<span class="${pk[t].known > pk[t].max ? 'error' : 'muted'}" style="text-transform:none;letter-spacing:0;font-weight:400;margin-left:8px" title="Powers known: the sheet's against the class table's (audit 2.10)">${t === 'force' ? 'Force' : 'Tech'} ${pk[t].known} / ${pk[t].max}</span>`).join(''))(R.powersKnown(ch))}<span class="spacer"></span>${!ro ? `<button class="btn tiny" data-act="pick-power" data-kind="force">＋ force power</button>
          <button class="btn tiny" data-act="pick-power" data-kind="tech">＋ tech power</button>
          <button class="btn tiny ghost" data-act="add-power" title="Add a homebrew power by hand">custom</button>` : ''}</h4>
        <table class="t"><thead><tr><th>Name</th><th>Lvl</th><th>Type</th><th>Alignment</th><th>Notes</th><th></th><th></th></tr></thead><tbody>
        ${(ch.powers || []).slice().map((p, i) => ({ p, i })).sort((a, b) => (+a.p.level || 0) - (+b.p.level || 0)).map(({ p, i }) => `<tr data-power-tip="${i}">
          <td>${inp(`powers.${i}.name`, p.name, { ro })}</td>
          <td class="n">${inp(`powers.${i}.level`, +p.level || 0, { ro, type: 'number' })}</td>
          <td style="width:90px">${inp(`powers.${i}.type`, p.type || 'force', { ro, type: 'select', options: ['force', 'tech'] })}</td>
          <td style="width:110px">${p.type === 'tech' ? '' : inp(`powers.${i}.alignment`, p.alignment || 'universal', { ro, type: 'select', options: ['universal', 'light', 'dark'] })}</td>
          <td>${inp(`powers.${i}.notes`, p.notes || '', { ro, ph: 'range, duration, effect…' })}</td>
          <td style="width:60px">${(over => `<button class="btn small ${over ? 'ghost' : 'amber'}" data-act="cast" data-i="${i}"${over ? ` title="${esc(over.text)}"` : ''}>Cast</button>`)(R.overMaxPowerLevel(ch, p, ci) || R.powerPrereqUnmet(ch, powerPre(p)))}</td>
          <td style="white-space:nowrap">${!ro ? `<button class="btn tiny ghost" data-act="power-desc" data-i="${i}" title="Write or edit this power's description">✎</button><button class="btn tiny ghost" data-act="del" data-list="powers" data-i="${i}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No powers.</td></tr>'}</tbody></table>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Hover (or tap) a power for its details. Casting costs 1 + power level points (level 0 at-wills are free).</p></div>`;
    }

    if (sub === 'gear') {
      html += `<div class="grid g2">
        <div class="box eq-box"><h4>Equipment <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-act="craft" title="Ask the GM to craft an item in downtime (Wretched Hives)">🔨 Craft</button><button class="btn tiny" data-act="pick-equip">＋ from SW5e</button><button class="btn tiny ghost" data-act="add-item" title="Add an item by hand">custom</button>' : ''}</h4>
          <div class="row" style="margin-bottom:8px"><span class="muted">Credits</span>${inp('credits', +ch.credits || 0, { ro, type: 'number', w: '120px' })}</div>
          ${(cw => `<div class="row carry ${cw.state ? 'carry-' + cw.state : ''}" style="margin-bottom:8px" title="Carrying capacity: Strength x 15 (PHB, Lifting and Carrying)${cw.variant ? '. Encumbrance variant: over 5 x Strength, speed -10 ft; over 10 x Strength, speed -20 ft and disadvantage on Str, Dex and Con rolls' : ''}">
            <span class="muted">Carrying</span> <b>${n0(cw.weight)}</b> <span class="muted">of ${n0(cw.capacity)} lb</span>${cw.text ? ` <span class="carry-state">${esc(cw.text)}</span>` : ''}
            ${isGM() ? `<label class="muted carry-var" title="PHB variant: weight slows characters down (the GM's call, for the whole table)"><input type="checkbox" data-act-change="encumbrance" ${cw.variant ? 'checked' : ''}> Encumbrance variant</label>` : ''}</div>`)(R.carrying(ch, S.st.variants))}
          ${(at => (ch.equipment || []).some(e => e.att) || at.simple ? `<div class="row carry ${at.used > at.max ? 'carry-over' : ''}" style="margin-bottom:8px" title="Wretched Hives: as many slots as the proficiency bonus; advanced, legendary and artifact items take two">
            <span class="muted">Attunement</span> <b>${n0(at.used)}</b> <span class="muted">of ${n0(at.max)} slots</span>${at.used > at.max ? ' <span class="carry-state">over the limit</span>' : ''}
            ${isGM() ? `<label class="muted carry-var" title="Wretched Hives variant: three slots, every item takes one (the GM's call, for the whole table)"><input type="checkbox" data-act-change="simple-attune" ${at.simple ? 'checked' : ''}> Simpler attunement</label>` : ''}</div>` : '')(R.attunement(ch, S.st.variants))}
          <div class="eq-wrap"><table class="t eq-table"><thead><tr><th>Qty</th><th>Item</th><th>Notes</th><th title="Weight in pounds, each">Wt</th><th title="Armor or shield, for the auto AC: its kind and AC (a shield's bonus)">Armor</th><th>Eq.</th><th></th></tr></thead><tbody>
          ${(ch.equipment || []).map((e, i) => `<tr><td class="n">${inp(`equipment.${i}.qty`, +e.qty || 1, { ro, type: 'number' })}</td>
            <td class="eq-name">${inp(`equipment.${i}.name`, e.name, { ro })}<button class="btn tiny ghost eq-info" data-act="item-info" data-i="${i}" title="What it is (SW5e's text)${e.bonus ? `; ${[e.bonus.hit && `+${e.bonus.hit} to hit`, e.bonus.dmg && `+${e.bonus.dmg} damage`, e.bonus.ac && `+${e.bonus.ac} AC`].filter(Boolean).join(', ')}` : ''}">ⓘ</button></td><td>${inp(`equipment.${i}.notes`, e.notes || '', { ro })}</td>
            <td class="n eq-wt">${inp(`equipment.${i}.wt`, +e.wt || '', { ro, type: 'number', ph: '0' })}</td>
            <td class="armor-cell">${inp(`equipment.${i}.armor.kind`, (e.armor || {}).kind || '', { ro, type: 'select', options: [{ v: '', t: '—' }, ...R.ARMOR_KINDS] })}${e.armor && e.armor.kind ? inp(`equipment.${i}.armor.ac`, +e.armor.ac || 0, { ro, type: 'number' }) : ''}</td>
            <td class="eq-cell">${inp(`equipment.${i}.equipped`, e.equipped, { ro, type: 'checkbox' })}${e.att ? `<span class="attune" title="Attuned (Wretched Hives: it takes a short rest with the item)${e.rar ? ` · ${esc(e.rar)}` : ''}">⟡${inp(`equipment.${i}.attuned`, !!e.attuned, { ro, type: 'checkbox' })}</span>` : ''}</td>
            <td style="white-space:nowrap">${!ro ? `${e.chassis ? `<button class="btn tiny" data-act="mods" data-i="${i}" title="Modifications: install and remove (Wretched Hives)">Mods ${(e.chassis.mods || []).length}/${R.modSlots(e.rar).base + R.modSlots(e.rar).aug}</button>` : ''}${e.use ? `<button class="btn tiny" data-act="use-item" data-i="${i}" title="Use one: ${esc(useText(e.use) || 'lowers the count')}">Use</button>` : ''}<button class="btn tiny ghost" data-act="sell" data-i="${i}" title="Sell one${+e.cost > 0 ? ` (half its cost: ${R.sellPrice(e).toLocaleString()} cr)` : ''}">Sell</button><button class="btn tiny ghost" data-act="del" data-list="equipment" data-i="${i}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Empty.</td></tr>'}
          </tbody></table></div>${craftRows(ch, ro)}</div>
        ${stashBox(ch, ro)}
        ${implantBox(ch, ro)}
        <div class="box"><h4>Features & Traits <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-act="pick-feature" title="Feats, class features, maneuvers, fighting styles, lightsaber forms, ventures">＋ from SW5e</button><button class="btn tiny ghost" data-act="add-feature" title="Write a feature by hand">custom</button>' : ''}</h4>
          <div class="feature-list">${(ch.features || []).map((f, i) => `<div class="feature-row">
            <span class="feature-name" data-feature-tip="${i}" tabindex="0">${esc(f.name || 'Feature')}</span>
            <span class="spacer"></span>
            <button class="btn tiny" data-act="share-feature" data-i="${i}" title="Post to chat">💬</button>
            ${!ro ? `<button class="btn tiny ghost" data-act="del" data-list="features" data-i="${i}" title="Remove">✕</button>` : ''}</div>`).join('') || '<p class="muted">None.</p>'}</div>
          ${(ch.features || []).length ? '<p class="muted" style="font-size:12px;margin:6px 0 0">Hover (or tap) a feature for its description.</p>' : ''}
        </div>
        <div class="box"><h4>Proficiencies <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-act="tool-check" title="Roll a check with a tool or kit">🧰 Tool check</button>' : ''}</h4>${inp('proficiencies', ch.proficiencies || '', { ro, type: 'textarea', rows: 3, ph: 'Armor, weapons, tools…' })}
          <h4 style="margin-top:10px">Languages</h4>${inp('languages', ch.languages || '', { ro, type: 'textarea', rows: 2 })}</div>
      </div>`;
    }

    if (sub === 'bio') {
      const dt = ch.downtime || { days: 0, log: [] };   // downtime (audit 11.1): the GM grants days; the server keeps the log
      html += `<div class="box" style="margin-bottom:10px"><h4>Downtime <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">${n0(dt.days)} day${n0(dt.days) === 1 ? '' : 's'} to spend</span>${!ro && n0(dt.days) ? '<span class="spacer"></span><button class="btn tiny" data-act="dt-ask">＋ Ask for an activity…</button>' : ''}</h4>
        ${(dt.log || []).length ? `<table class="t"><tbody>${dt.log.slice(-12).reverse().map(e => `<tr><td class="muted" style="white-space:nowrap">${esc(new Date(n0(e.at) * 1000).toLocaleDateString())}</td>
          <td>${e.act === 'grant' ? '🕰 granted' : esc(R.DOWNTIME_ACTS[e.act] || e.act)}</td><td class="n">${e.act === 'grant' ? '+' : '−'}${n0(e.days)} d</td><td class="n">${n0(e.cr) ? `${n0(e.cr) > 0 ? '+' : ''}${n0(e.cr).toLocaleString()} cr` : ''}</td><td>${esc(e.text || '')}</td></tr>`).join('')}</tbody></table>`
          : '<p class="muted" style="margin:0">No downtime yet. Between adventures the GM grants days to spend on activities.</p>'}
        ${(dt.pending || []).map(q => `<div class="row" style="margin-top:6px;gap:8px"><b>${esc(R.DOWNTIME_ACTS[q.act] || q.act)}</b><span class="muted">${n0(q.days)} days${q.note ? ' · ' + esc(q.note) : ''}</span><span class="spacer"></span>
          ${q.ok ? (!ro ? `<button class="btn tiny amber" data-act="dt-roll" data-id="${esc(q.id)}">🎲 Roll ${esc((q.check || {}).name || 'the check')}</button>` : '<span class="muted">approved: waiting for the roll</span>') : '<span class="muted">waiting for the GM</span>'}</div>`).join('')}</div>`;
      html += `<div class="grid g2">
        <div class="box"><h4>Appearance</h4>
          ${!ro ? `<div class="row wrap" style="margin-bottom:8px"><button class="btn small" data-act="photo" data-kind="profile">📷 Upload profile photo</button>
            <button class="btn small" data-act="photo" data-kind="token">◉ Upload token photo</button>
            ${ch.image ? '<button class="btn small ghost" data-act="clear-photo">Remove profile photo</button>' : ''}
            ${ch.tokenImage ? '<button class="btn small ghost" data-act="clear-token-photo">Token: use profile photo</button>' : ''}</div>` : ''}
          <p class="muted" style="font-size:12px;margin:0 0 6px">The token uses the profile photo unless you upload a separate one.</p>
          <label style="margin-top:8px">Token colour${inp('color', ch.color || '#4fc3f7', { ro, type: 'color' })}</label>
          <label style="margin-top:8px">Experience points${vOn('Milestone Leveling') ? ' <span class="muted">(Milestone Leveling: the GM decides when you level)</span>' : ''}${inp('xp', +ch.xp || 0, { ro: lock, type: 'number' })}
            ${(x => !x || vOn('Milestone Leveling') ? '' : `<span class="${x.ready ? 'up' : 'muted'}" style="text-transform:none;letter-spacing:0;font-size:12px" title="SW5e's XP for each level (audit 2.14)">${x.ready ? `Enough for level ${x.level} (${x.need.toLocaleString()} XP): the GM grants it` : `Level ${x.level} at ${x.need.toLocaleString()} XP, ${x.left.toLocaleString()} to go`}</span>`)(R.xpNext(ch))}</label>
          <label style="margin-top:8px">Proficiency bonus override${inp('profOverride', ch.profOverride ?? '', { ro, type: 'number', ph: String(2 + Math.floor((lvl - 1) / 4)) })}</label>
          <label style="margin-top:8px" title="Your quality of life between adventures (SW5e, PHB): the GM charges it by the day">Lifestyle${inp('lifestyle', ch.lifestyle || '', { ro, type: 'select', options: [{ v: '', t: '—' }, ...Object.entries(LIFESTYLES).map(([k, v]) => ({ v: k, t: `${k} (${v ? (k === 'Aristocratic' ? '100+' : v) + ' cr' : 'free'}/day)` }))] })}</label>
          <label style="margin-top:8px">Initiative bonus (misc)${inp('initMisc', +ch.initMisc || 0, { ro, type: 'number' })}</label>
          ${isGM() ? `<label style="margin-top:8px">Owner (GM)<select data-act-change="assign">${Object.entries(S.st.players).map(([id, p]) => `<option value="${esc(id)}" ${id === ch.owner ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
        </div>
        <div class="box"><h4>Backstory & Notes</h4>${inp('notes', ch.notes || '', { ro, type: 'textarea', rows: 16 })}</div>
      </div>`;
    }
    el.innerHTML = html;
  }

  // sheet events
  $('#sheet').addEventListener('change', e => {
    const t = e.target;
    const ch = selChar(); if (!ch) return;
    if (t.dataset.actChange === 'simple-attune') {   // the GM's switch for the whole table (audit 6.3)
      const v = new Set(S.st.variants || []); t.checked ? v.add(R.SIMPLE_ATTUNEMENT) : v.delete(R.SIMPLE_ATTUNEMENT);
      return act('variants.set', { variants: [...v] });
    }
    const att = /^equipment\.(\d+)\.attuned$/.exec(t.dataset.path || '');
    if (att && t.checked && canEdit(ch)) {   // attuning past the slots (audit 6.3): a player is refused; the GM is asked
      const no = R.attuneBlocked(ch, +att[1], S.st.variants);
      if (no && (!isGM() || !confirm(`${no.text}\n\nAttune anyway?`))) { if (!isGM()) toast(no.text, true); t.checked = false; return; }
    }
    if (t.dataset.actChange === 'encumbrance') {   // the GM's switch for the whole table (audit 6.5), kept with the variant rules
      const v = new Set(S.st.variants || []); t.checked ? v.add(R.ENCUMBRANCE) : v.delete(R.ENCUMBRANCE);
      return act('variants.set', { variants: [...v] });
    }
    if (t.dataset.actChange) return sheetChangeAction(t.dataset.actChange, t.value, t);
    const path = t.dataset.path; if (!path || !canEdit(ch)) return;
    let v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? '' : +t.value) : t.value;
    if (path.startsWith('classes.') && path.endsWith('.level')) v = Math.max(1, Math.min(20, +v || 1));
    const c2 = clone(ch); setPath(c2, path, v);
    saveChar(c2);
    if (t.type !== 'text' && t.tagName !== 'TEXTAREA') guarded('sheet', renderSheet);
    else setTimeout(() => guarded('sheet', renderSheet), 0);
  });
  function sheetChangeAction(kind, val, t) {
    if (kind === 'infuse' && !val) return mutate(c => { c.infused = ''; });   // nothing infused
    if (kind === 'force-ability') return mutate(c => { if (val) c.forceAbility = val; else delete c.forceAbility; });   // Simplified Forcecasting
    if (!val) return;
    if (kind === 'add-cond') mutate(c => { c.conditions = [...new Set([...(c.conditions || []), val])]; });
    if (kind === 'add-weapon') { const w = R.WEAPONS[+val]; mutate(c => c.attacks.push({ name: w.name, ab: w.ab, damage: w.damage, type: w.type, props: w.props, proficient: true })); }
    if (kind === 'assign') act('char.assign', { id: S.selected, owner: val });
    if (kind === 'infuse') return mutate(c => { c.infused = val; });
    t.value = '';
  }
  // the mastery tiers (Wretched Hives, audit 5.7): a long press or right-click on a skill's dot steps through them
  $('#sheet').addEventListener('contextmenu', e => {
    const b = e.target.closest('[data-act="skill-prof"]'), ch = selChar();
    if (!b || !ch || b.disabled || !canEdit(ch)) return;
    e.preventDefault();
    mutate(c => { const v = +(c.skills[b.dataset.sk] || 0); c.skills[b.dataset.sk] = v < 2 ? 3 : v >= 5 ? 2 : v + 1; });
  });
  $('#sheet').addEventListener('click', async e => {
    const ch = selChar();
    const r = e.target.closest('[data-roll]');
    // a careful check (Wretched Hives, audit 11.6): Alt-click a check when there's time and no disadvantage. It counts
    // as a 10 on the d20 (15 with advantage) plus the check's bonus, posted like any roll.
    if (r && ch && e.altKey && r.dataset.check !== undefined) {
      const mode = rollModeFromEvent(e);
      if (mode === 'dis') return toast("A careful check can't be made with disadvantage.", true);
      const t = mode === 'adv' ? 15 : 10, b = +r.dataset.check || 0;
      return roll(`${t}${b >= 0 ? '+' : ''}${b}`, `${r.dataset.label} (careful check: took ${t})`, { charId: ch.id, kind: 'check' });
    }
    if (r && ch) return roll(r.dataset.roll, `${r.dataset.label}`, { d20: !!r.dataset.d20, mode: rollModeFromEvent(e), charId: ch.id });
    const b = e.target.closest('[data-act]'); if (!b || !ch) return;
    const a = b.dataset.act, i = +b.dataset.i, ro = !canEdit(ch);
    const pub = ['sub', 'export', 'atk', 'dmg', 'crit', 'dismiss-note', 'share-feature', 'item-info'];
    if (ro && !pub.includes(a)) return;
    switch (a) {
      case 'sub': S.sub = b.dataset.sub; renderSheet($('#sheet')); break;
      case 'gen-scores': scoresDialog(ch); break;
      case 'dt-ask': askDowntime(ch); break;
      case 'dt-roll': act('downtime.roll', { charId: ch.id, id: b.dataset.id }); break;
      case 'tool-check': toolCheckDialog(ch); break;
      case 'dismiss-note': delete S.importNotes[ch.id]; renderSheet($('#sheet')); break;
      case 'del-class': mutate(c => c.classes.splice(i, 1)); break;
      case 'save-prof': mutate(c => { c.saves[b.dataset.ab] = !c.saves[b.dataset.ab]; }); break;
      // none → proficient → expertise → half (a feature that adds half your proficiency, audit 5.6) → none
      case 'skill-prof': mutate(c => { const v = +(c.skills[b.dataset.sk] || 0); c.skills[b.dataset.sk] = v === 0 ? 1 : v === 1 ? 2 : v === 2 ? 0.5 : 0; }); break;
      case 'hp': {
        const raw = $('#hpDelta').value.trim(); const n = Math.abs(parseInt(raw, 10)); if (!n) return;
        const sign = raw.startsWith('-') ? -1 : raw.startsWith('+') ? 1 : +b.dataset.sign;
        if (sign < 0) { act('char.damage', { id: ch.id, amount: n }); $('#hpDelta').value = ''; break; }   // on the server, as the tracker's -n: temporary HP first (#107)
        mutate(c => { c.hp.current = Math.min(+c.hp.max || 0, (+c.hp.current || 0) + n); if (c.hp.current > 0) c.deathSaves = { s: 0, f: 0 }; });
        break;
      }
      case 'short-rest': case 'short-rest-done': shortRestDialog(); break;   // hit dice by size, then the rest itself (#71)
      case 'long-rest':
        mutate(c => {
          c.hp.current = +c.hp.max; c.hp.temp = 0; c.force.used = 0; c.tech.used = 0; c.force.temp = 0; c.tech.temp = 0; c.deathSaves = { s: 0, f: 0 }; c.infused = '';   // Infuse Item ends; infuse again
          delete c.force.high; delete c.tech.high;   // high-level powers can be cast again (#160)
          // half the total hit dice back (at least one), the largest first (audit 7.5)
          const dice = R.hitDice(c); let back = Math.max(1, Math.floor(dice.reduce((n, d) => n + d.total, 0) / 2));
          for (const d of dice) { const k = Math.min(d.used, back); d.used -= k; back -= k; }
          c.hitDiceUsed = R.hitDiceUsedOf(dice);
          // tracked resources that come back on a short or long rest (the combat view's tracker, 3.1), Force Recovery among them
          c.resources = (c.resources || []).map(r => ['short', 'long'].includes(R.refillOf(c, r)) && r.used ? Object.assign({}, r, { used: 0 }) : r);
          c.exhaustion = Math.max(0, (+c.exhaustion || 0) - 1);
          if (vOn('Hunted') && c.disturbance) c.disturbance = Math.max(0, c.disturbance - R.totalLevel(c));   // Hunted: down by the character's level
        });
        act('char.rest', { charId: ch.id, kind: 'long' });
        act('chat', { text: `*${ch.name} takes a long rest${vOn('Longer Rests') ? ' (2 days)' : ''}. HP, force & tech points restored.*`, as: ch.name });
        break;
      case 'exert': {   // Exertion (variant, 9.16): the largest hit die, rolled without spending it; its roll in hit points
        const die = Math.max(0, ...R.hitDice(ch).map(d => d.die));
        if (!die) return toast('No hit dice to exert with.', true);
        const res = await roll(`1d${die}`, `Exertion: add it to the roll, or move ${'5 ft ×'} the roll farther; loses that many HP`, { charId: ch.id });
        if (!res) return;
        const n = Math.max(0, res.roll.total);
        mutate(c => { c.hp.current = Math.max(0, (+c.hp.current || 0) - n); });
        if ((+ch.hp.current || 0) - n <= 0) toast(`${ch.name} is at 0 HP: they stay up until the end of the turn, then fall unconscious and stable.`);
        break;
      }
      case 'prowess': {   // Force and Tech Prowess (variant): a point to reroll a failed check that added proficiency
        const k = b.dataset.k, ci = R.casterInfo(ch), max = ch[k].max !== '' && ch[k].max != null ? +ch[k].max : (k === 'force' ? ci.forceMax : ci.techMax);
        const spend = R.pointsSpend(ch[k], 1, max);
        if (!spend) return toast(`No ${k} points left.`, true);
        mutate(c => { c[k].used = spend.used; c[k].temp = spend.temp; });
        act('chat', { text: `*spends 1 ${k} point (${k === 'force' ? 'Force' : 'Tech'} Prowess) to reroll a failed check.*`, as: ch.name });
        break;
      }
      case 'hunted-roll': {   // Hunted (variant): the GM's percentile roll after a fight
        const d = +ch.disturbance || 0;
        const res = await roll('1d100', `Hunted: ${ch.name}'s disturbance is ${d}; ${d} or lower and hunters find them`, { charId: ch.id });
        if (res && res.roll.total <= d) toast(`${res.roll.total}: ${ch.name} is detected.`);
        break;
      }
      case 'ds': mutate(c => { const k = b.dataset.k, n = +b.dataset.n; c.deathSaves[k] = c.deathSaves[k] >= n ? n - 1 : n; }); break;
      case 'death-roll': {
        const res = await roll('1d20', 'Death save', { charId: ch.id }); if (!res) return;
        const t = res.roll.total;
        mutate(c => {
          if (t === 20) { c.hp.current = 1; c.deathSaves = { s: 0, f: 0 }; }
          else if (t === 1) c.deathSaves.f = Math.min(3, c.deathSaves.f + 2);
          else if (t >= 10) c.deathSaves.s = Math.min(3, c.deathSaves.s + 1);
          else c.deathSaves.f = Math.min(3, c.deathSaves.f + 1);
        });
        break;
      }
      case 'rm-cond': mutate(c => c.conditions.splice(i, 1)); break;
      case 'add-attack': mutate(c => c.attacks.push({ name: 'New attack', ab: 'str', damage: '1d6', type: 'kinetic', props: '', proficient: true })); break;
      case 'add-power': mutate(c => c.powers.push({ name: 'New power', level: 0, type: 'force', alignment: 'universal', notes: '' })); break;
      case 'add-item': mutate(c => c.equipment.push({ name: 'Item', qty: 1, notes: '' })); break;
      case 'add-feature':   // the description is written once, here; on the sheet it's fixed text
        modal(`<h3>＋ Add a feature or trait</h3>
          <label>Name<input id="ftName" maxlength="80" placeholder="e.g. Fighting Style: Defense"></label>
          <label>Description<textarea id="ftText" rows="6" placeholder="What it does"></textarea></label>
          <p class="muted" style="margin:0;font-size:12px">Once added, the description can't be edited on the sheet.</p>
          <div class="row"><span class="spacer"></span><button class="btn" id="ftCancel">Cancel</button><button class="btn primary" id="ftAdd">Add</button></div>`, box => {
          $('#ftCancel', box).onclick = closeModal;
          $('#ftAdd', box).onclick = () => {
            const name = $('#ftName', box).value.trim(); if (!name) return toast('Give the feature a name.', true);
            const text = $('#ftText', box).value.trim();
            mutate(c => c.features.push({ name, text })); closeModal();
          };
          $('#ftName', box).focus();
        });
        break;
      case 'pick-power': openPowerPicker(ch.id, b.dataset.kind); break;
      case 'pick-equip': openEquipPicker(ch.id); break;
      case 'pick-weapon': openEquipPicker(ch.id, { weapons: true }); break;
      case 'pick-species': HTB.openSpeciesPicker(ch.id); break;
      case 'pick-background': HTB.openBackgroundPicker(ch.id); break;
      case 'pick-archetype': if (window.HTB) HTB.openArchetypePicker(ch.id, i); break;
      case 'pick-feature': HTB.openFeaturePicker(ch.id); break;
      case 'del': mutate(c => c[b.dataset.list].splice(i, 1)); break;
      case 'use-item': useItem(ch, i); break;
      case 'mods': modsDialog(ch, i); break;
      case 'item-info': {   // the item's SW5e text (audit 6.2), looked up by name, never stored on the sheet
        const e0 = b.dataset.list === 'implants' ? (ch.implants || [])[i] : ch.equipment[i]; if (!e0) break;   // or an installed implant (6.4)
        const found = await itemInfo(e0.name);
        const b0 = e0.bonus ? [e0.bonus.hit && `+${e0.bonus.hit} to attack rolls`, e0.bonus.dmg && `+${e0.bonus.dmg} to damage rolls`, e0.bonus.ac && `+${e0.bonus.ac} to AC while worn${e0.att ? ' and attuned' : ''}`].filter(Boolean).join(', ') : '';
        modal(`<h3>${esc(e0.name)}</h3>${found ? `<p class="muted">${esc(itemNotes(found.it, found.enh))}${found.it.src ? ` · ${esc(SRC[found.it.src] || found.it.src)}` : ''}</p>` : ''}
          ${b0 ? `<p><b>On the sheet:</b> ${esc(b0)}.</p>` : ''}
          <div class="hc-desc">${found && found.it.desc ? md(found.it.desc) : `<p class="muted">${found ? 'No description in SW5e.' : 'Not an SW5e item by this name (or the list did not load).'}</p>`}</div>
          <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn" id="infoClose">Close</button></div>`, box => { box.onclick = ev => { if (ev.target.id === 'infoClose') closeModal(); }; });
        break;
      }
      case 'craft': openCraft(ch); break;
      case 'implants': implantDialog(ch); break;
      case 'implant-rm': implantDialog(ch, i); break;
      case 'motor-up': motorUp(ch); break;
      case 'craft-cancel': act('craft.cancel', { charId: ch.id, id: b.dataset.id }); break;
      case 'craft-roll': act('craft.roll', { charId: ch.id, id: b.dataset.id }); break;
      case 'craft-no': if (confirm('Turn this request down?')) act('craft.decide', { charId: ch.id, id: b.dataset.id, ok: false }); break;
      case 'craft-ok': craftApprove(ch, b.dataset.id); break;
      case 'sell': {   // selling (audit 6.8): one of the item, for half its cost by default (PHB, Selling Treasure); the table can agree another price
        const it = ch.equipment[i]; if (!it) break;
        const ans = prompt(`Sell one ${it.name} for how many credits?${+it.cost > 0 ? ` (Half its cost is ${R.sellPrice(it).toLocaleString()} cr.)` : ''}`, String(R.sellPrice(it)));
        if (ans === null) break;
        const price = String(ans).trim() === '' ? R.sellPrice(it) : Math.max(0, Math.min(1e9, Math.round(+ans) || 0));   // blank: the default
        mutate(c => {
          const e = c.equipment[i]; if (!e || e.name !== it.name) return;
          if ((n0(e.qty) || 1) > 1) e.qty = (n0(e.qty) || 1) - 1; else c.equipment.splice(i, 1);
          c.credits = n0(c.credits) + price;
        });
        act('chat', { text: `*sells ${it.name} for ${price.toLocaleString()} cr.*`, as: ch.name });
        break;
      }
      case 'atk': {
        const at = ch.attacks[i], crit = +at.critRange || 20, shots = R.shotsOf(at);
        if (shots === 0) { toast(`${at.name} is out of shots. Reload it first (an action or bonus action).`); break; }
        const r = await roll(d20(R.attackBonus(ch, at)), `${at.name} — attack${crit < 20 ? ` (crits on ${crit}–20)` : ''}`, { d20: true, mode: rollModeFromEvent(e), charId: ch.id, kind: 'attack' });
        const nat = r && r.roll && r.roll.nat;
        if (crit < 20 && nat >= crit && nat < 20) toast(`${nat}: a critical hit for ${at.name} (crits on ${crit}–20). Roll Crit for damage.`);
        if (r && shots != null && canEdit(ch)) mutate(c => { c.attacks[i].shots = Math.max(0, shots - 1); });   // one shot used (audit 6.6)
        break;
      }
      case 'reload': {   // a fresh power cell or slug cartridge from the gear; with none, the GM may reload anyway
        const at = ch.attacks[i], full = R.reloadOf(at), kind = R.ammoOf(at); if (!full) break;
        const k = (ch.equipment || []).findIndex(x => String(x.name).toLowerCase().startsWith(kind.toLowerCase()) && n0(x.qty) > 0);
        if (k < 0 && !(isGM() && confirm(`No ${kind.toLowerCase()}s in ${ch.name}'s gear. Reload anyway?`))) { if (!isGM()) toast(`No ${kind.toLowerCase()}s in your gear. Add some in Features & Gear (or ask the GM).`); break; }
        mutate(c => { c.attacks[i].shots = full; if (k >= 0) c.equipment[k].qty = n0(c.equipment[k].qty) - 1; });
        toast(`${at.name} reloaded: ${full} shots${k >= 0 ? `, ${n0(ch.equipment[k].qty) - 1} ${kind.toLowerCase()}${n0(ch.equipment[k].qty) - 1 === 1 ? '' : 's'} left` : ''}.`);
        break;
      }
      case 'dmg': { const at = ch.attacks[i]; roll(R.damageExpr(ch, at), `${at.name} — ${at.type || ''} damage`, { charId: ch.id, kind: 'damage' }); break; }
      case 'crit': { const at = ch.attacks[i], cd = R.critDamage(ch, at); roll(cd.expr, `${at.name} — CRITICAL ${at.type || ''} damage${cd.brutal ? ` (Brutal Critical +${cd.brutal})` : ''}`, { charId: ch.id, kind: 'damage' }); break; }
      case 'add-class-res': mutate(c => { c.resources = R.withClassResources(c); }); break;
      case 'history': if (isGM()) openHistory(ch.id); break;
      case 'stash-take': act('stash.take', { id: b.dataset.sid, charId: ch.id }); break;
      case 'stash-rm': if (isGM()) act('stash.remove', { id: b.dataset.sid }); break;
      case 'stash-loot': if (isGM()) openLoot(); break;
      case 'stash-split': if (isGM()) openStashSplit(); break;
      case 'undo-level':   // the GM's undo of the last level (2.15)
        if (confirm(`Take back ${ch.name}'s level ${n0((S.st.levelUndo || {})[ch.id])}?\n\nThe sheet goes back to just before it (anything changed since is lost), and the level is granted again to take properly.`)) act('levelup.undo', { charId: ch.id });
        break;
      case 'res-use': case 'res-back': {
        const res0 = (ch.resources || [])[i];
        if (a === 'res-use' && res0 && res0.key === 'second-wind') {   // Second Wind heals: 1d10 + fighter level (#65)
          const row = R.resourceRows(ch).find(x => x.i === i);
          if (!row || row.used >= row.max) break;
          const lvl = (ch.classes.find(k => /^fighter$/i.test(k.name)) || {}).level || 1;
          const r = await roll(`1d10+${lvl}`, 'Second Wind (healing)', { charId: ch.id, kind: 'heal' });
          const heal = r && r.roll ? Math.max(0, r.roll.total) : 0;
          mutate(c => { const rr = c.resources[i]; rr.used = Math.min(row.max, (+rr.used || 0) + 1); c.hp.current = Math.min(+c.hp.max || 0, (+c.hp.current || 0) + heal); });
          break;
        }
      }
      // falls through: any other resource just counts
      // eslint-disable-next-line no-fallthrough
      case 'res-count': mutate(c => {
        const r = (c.resources || [])[i]; if (!r) return;
        const row = R.resourceRows(c).find(x => x.i === i), max = row ? row.max : 0;
        r.used = Math.max(0, Math.min(max, (+r.used || 0) + (a === 'res-use' ? 1 : -1)));
      }); break;
      case 'senses': {   // the GM sets senses by hand (players' sheets get them from their species)
        if (!isGM()) return;
        const t = prompt('Senses, e.g. "darkvision 60, blindsight 30" (empty for none):', R.cleanSenses(ch.senses).map(x => `${x.kind} ${x.range}`).join(', '));
        if (t === null) break;
        mutate(c => { const v = R.parseSenses(t); if (v.length) c.senses = v; else delete c.senses; });
        break;
      }
      case 'power-desc': {
        const pw = ch.powers[i];
        modal(`<h3>✎ ${esc(pw.name || 'Power')}</h3>
          <label>Description<textarea id="pwDesc" rows="10" placeholder="What the power does: effect, damage, saving throw, upcasting…">${esc(pw.description || '')}</textarea></label>
          <div class="row"><span class="spacer"></span><button class="btn" id="pwCancel">Cancel</button><button class="btn primary" id="pwSave">Save</button></div>`, box => {
          $('#pwCancel', box).onclick = closeModal;
          $('#pwSave', box).onclick = () => { const v = $('#pwDesc', box).value; mutate(c => { c.powers[i].description = v; }); closeModal(); };
          $('#pwDesc', box).focus();
        });
        break;
      }
      case 'cast': castPower(ch, i); break;
      case 'unconc': act('fight.unconc', { charId: ch.id }); break;
      case 'share-feature': { const f = ch.features[i]; act('chat', { text: `**${f.name}**\n${f.text || ''}`, as: ch.name }); break; }
      case 'init': {
        const mode = rollModeFromEvent(e), bonus = R.initiative(ch);
        let expr = d20(bonus); if (mode === 'adv') expr = expr.replace('1d20', '2d20kh1'); if (mode === 'dis') expr = expr.replace('1d20', '2d20kl1');
        if (await act('init.add', { charId: ch.id, name: ch.name, bonus, expr })) toast('Initiative rolled — see Combat tab');
        break;
      }
      case 'token': if (await act('token.add', { charId: ch.id, x: 1, y: 1 })) setTab('map'); break;
      case 'photo': pickPhoto(b.dataset.kind); break;
      case 'clear-token-photo': act('char.photo.clear', { charId: ch.id, kind: 'token' }); break;
      case 'clear-photo': act('char.photo.clear', { charId: ch.id, kind: 'profile' }); break;
      case 'levelup': openWizard(ch.id); break;
      case 'grant': openGrant([ch.id]); break;
      case 'export': {
        const out = clone(ch); delete out.owner; delete out.id; delete out.updated; out._format = 'holotable-sw5e';
        const a2 = document.createElement('a');
        a2.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
        a2.download = (ch.name || 'character').replace(/[^\w\- ]/g, '') + '.json'; a2.click();
        break;
      }
      case 'delete':
        if (confirm(`Delete ${ch.name}? This removes them from the campaign.`)) { await act('char.delete', { id: ch.id }); S.selected = null; }
        break;
    }
  });

  // --------------------------------------------------------------------------- equipment picker
  // "+ from SW5e" on Equipment (and Attacks): all SW5e standard gear (PHB, Expanded Content, Wretched Hives)
  // and enhanced items, served by our API and cached. Filters are checkbox dropdowns plus a name search.
  // Adding a weapon also adds an attack with SW5e's damage and properties.
  const EQUIP = {};
  async function equipList(set) {
    if (EQUIP[set]) return EQUIP[set];
    const r = await fetch(`${API}?op=equipment&set=${set}`, { credentials: 'same-origin' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(j)) throw new Error((j && j.error) || "Couldn't load the SW5e equipment list.");
    return (EQUIP[set] = j);
  }
  const SRC = { PHB: "Player's Handbook", EC: 'Expanded Content', WH: 'Wretched Hives' };
  // a dropdown of checkboxes; `sel` is a Set of the ticked values
  function checkDrop(key, label, values, sel, names = {}) {
    const summary = sel.size === values.length ? `All ${label}` : sel.size === 0 ? `No ${label}` : sel.size <= 2 ? [...sel].map(v => names[v] || v).join(', ') : `${sel.size} ${label}`;
    return `<details class="pp-align" data-drop="${esc(key)}"><summary>${esc(summary)}</summary><div class="pp-align-menu">
      <div class="row" style="gap:4px"><button class="btn tiny" data-eq="all" data-key="${esc(key)}">All</button><button class="btn tiny ghost" data-eq="none" data-key="${esc(key)}">None</button></div>
      ${values.map(v => `<label class="toggle"><input type="checkbox" data-eq="check" data-key="${esc(key)}" value="${esc(v)}" ${sel.has(v) ? 'checked' : ''}> ${esc(names[v] || v)}</label>`).join('')}</div></details>`;
  }
  // the standard weapon an enhanced weapon is made from: by its subtype ("bo-rifle") or its name without the grade in
  // brackets ("Vibroblade (Fine)"), from the standard list when it's already loaded
  function enhancedBase(it) {
    const std = EQUIP.standard || [], key = s => String(s || '').toLowerCase().replace(/\s*\(.*\)\s*$/, '').trim();
    return std.find(w => w.cat === 'Weapon' && (key(w.n) === key(it.sub) || key(w.n) === key(it.n))) || null;
  }
  // the SW5e text of an item on the sheet, from the lists the picker loads (kept off the sheet, so sheets stay small)
  async function itemInfo(name) {
    const k = String(name || '').toLowerCase();
    for (const set of ['standard', 'enhanced']) {
      try { const it = (await equipList(set)).find(x => x.n.toLowerCase() === k); if (it) return { it, enh: set === 'enhanced' }; } catch { /* the list didn't load */ }
    }
    return null;
  }
  function weaponAttack(it) {
    const props = (it.props || []).join(', ');
    const ab = /blaster/i.test(it.wc) ? 'dex' : /finesse/i.test(props) ? 'finesse' : 'str';
    const crit = R.critFrom(props);   // Keen N: the crit range grows by N
    return { name: it.n, ab, damage: it.dmg || '1', type: it.dt || 'kinetic', props: props.slice(0, 200), proficient: true, ...(crit < 20 ? { critRange: crit } : {}) };
  }
  // a sheet item from an SW5e gear or enhanced item: one builder for "+ from SW5e" and for crafting (11.2)
  function sheetItem(it, enh) {
    const armor = !enh && R.armorFromItem(it);
    return Object.assign({ name: it.n, qty: 1, equipped: false, notes: itemNotes(it, enh).slice(0, 200) }, armor ? { armor } : {},
      !enh && parseFloat(it.wt) > 0 ? { wt: parseFloat(it.wt) } : {}, !enh && it.cost > 0 ? { cost: it.cost } : {},   // weight (6.5) and cost (6.8)
      enh && R.RARITIES.includes(it.rar) ? { rar: it.rar } : {}, enh && it.att ? { att: true } : {},   // rarity and attunement (6.3)
      (enh ? it.cat === 'Consumable' : ['Medical', 'Explosive'].includes(it.cat)) ? { use: R.consumableUse(it.desc) || {} } : {},   // a consumable (6.7)
      enh && R.enhancedBonus(it.desc) ? { bonus: R.enhancedBonus(it.desc) } : {},   // an enhanced item's +N (6.2)
      // a chassis, with its kind and no modifications yet; a modification, with the kind of chassis it fits (6.4)
      enh && R.chassisKind(it.n) ? { chassis: { kind: R.chassisKind(it.n), mods: [] } } : {},
      enh && it.cat === 'Item Modification' && R.cleanMod({ kind: String(it.sub || '').toLowerCase() }) ? { mod: { kind: String(it.sub).toLowerCase() } } : {},
      enh && R.implantOf(it) ? { implant: R.implantOf(it) } : {});   // a cybernetic augmentation or droid customization (6.4)
  }
  function itemNotes(it, enhanced) {
    if (enhanced) return [it.rar && `${it.rar} ${it.cat.toLowerCase()}`, it.sub, it.att && 'requires attunement'].filter(Boolean).join(' · ');
    if (it.cat === 'Weapon') return [it.dmg && `${it.dmg} ${it.dt}`, (it.props || []).join(', ')].filter(Boolean).join(' · ');
    if (it.cat === 'Armor') return [it.ac && `AC ${it.ac}`, it.accl, it.stealth && 'stealth disadvantage', it.str && `needs ${it.str}`].filter(Boolean).join(' · ');
    return it.cat;
  }
  function openEquipPicker(charId, opts = {}) {
    const F = { set: 'standard', q: '', limit: 120, sel: {} };
    modal(`<div id="eqp" class="power-picker"><h3>＋ Add equipment from SW5e</h3><p class="muted">Loading…</p></div>`, async box => {
      const ep = $('#eqp', box);
      const ch = () => S.st.characters[charId];
      let list = [];
      const facets = () => F.set === 'standard'
        ? [['cat', 'categories', it => it.cat], ['wc', 'weapon classes', it => it.wc || null], ['src', 'books', it => it.src]]
        : [['cat', 'types', it => it.cat], ['rar', 'rarities', it => it.rar || null], ['src', 'books', it => it.src]];
      const values = (fn) => [...new Set(list.map(fn).filter(Boolean))].sort((a, b) => {
        const order = ['Standard', 'Premium', 'Prototype', 'Advanced', 'Legendary', 'Artifact'];
        return order.indexOf(a) - order.indexOf(b) || a.localeCompare(b);
      });
      const load = async (set) => {
        F.set = set; F.limit = 120; F.q = '';   // a fresh search for each tab
        ep.querySelector('.pp-list').innerHTML = '<p class="muted">Loading the SW5e list…</p>';
        try { list = await equipList(set); } catch (err) { ep.querySelector('.pp-list').innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
        F.sel = {};
        for (const [key, , fn] of facets()) F.sel[key] = new Set(values(fn));
        if (set === 'standard' && opts.weapons) F.sel.cat = new Set(['Weapon']);
        renderFilters(); render();
      };
      const renderFilters = () => {
        ep.querySelector('.pp-filters').innerHTML = facets().map(([key, label, fn]) => checkDrop(key, label, values(fn), F.sel[key], key === 'src' ? SRC : {})).join('')
          + `<input data-eq="q" placeholder="Search by name…" value="${esc(F.q)}" style="flex:1;min-width:140px">`;
      };
      const shown = () => list.filter(it => facets().every(([key, , fn]) => { const v = fn(it); return v === null || F.sel[key].has(v); })
        && (!F.q || it.n.toLowerCase().includes(F.q)));
      const render = () => {
        const rows = shown(), have = new Map((ch() ? ch().equipment : []).map(e => [String(e.name).toLowerCase(), n0(e.qty) || 1]));
        const enh = F.set === 'enhanced';
        ep.querySelector('.pp-list').innerHTML = rows.slice(0, F.limit).map((it, i) => {
          const qty = have.get(it.n.toLowerCase());
          return `<div class="pp-row" data-i="${i}">
            <div class="pp-main"><b>${esc(it.n)}</b><span class="pp-lvl">${esc(it.cat)}</span>
              ${enh && it.rar ? `<span class="pp-tag pp-rar-${esc(it.rar.toLowerCase())}">${esc(it.rar)}</span>` : ''}${enh && it.att ? '<span class="pp-tag">Attunement</span>' : ''}
              ${it.src ? `<span class="pp-tag" title="${esc(SRC[it.src] || it.src)}">${esc(it.src)}</span>` : ''}
              <div class="pp-meta">${esc([!enh && it.wc, itemNotes(it, enh) !== it.cat && itemNotes(it, enh), !enh && it.cost != null && `${it.cost.toLocaleString()} cr`, !enh && it.wt && `${it.wt} lb`, enh && it.pre && `Requires ${it.pre}`].filter(Boolean).join(' · '))}</div>
              ${it.desc ? `<details class="pp-desc"><summary>Description</summary><div>${md(it.desc)}</div></details>` : ''}</div>
            <div class="eq-btns">${!enh && it.cost > 0 && canEdit(ch()) ? `<button class="btn small" data-eq="buy" data-i="${i}" title="Pay ${it.cost.toLocaleString()} cr from this character's credits">Buy · ${it.cost.toLocaleString()} cr</button>` : ''}
            <button class="btn small ${qty ? '' : 'primary'}" data-eq="add" data-i="${i}">${qty ? `Add another (${qty})` : 'Add'}</button></div></div>`;
        }).join('') + (rows.length > F.limit ? `<button class="btn small" data-eq="more" style="width:100%">Show ${rows.length - F.limit} more</button>` : '')
          + (!rows.length ? '<p class="muted">Nothing matches these filters.</p>' : '');
        ep.querySelector('.pp-count').textContent = `${rows.length} of ${list.length} ${enh ? 'enhanced items' : 'items'}`;
        ep._rows = rows;
      };
      ep.innerHTML = `<h3>＋ Add equipment from SW5e</h3>
        <div class="subtabs" style="margin:0"><button data-eq="set" data-set="standard" class="on">Standard gear</button><button data-eq="set" data-set="enhanced">Enhanced items</button></div>
        <div class="pp-filters"></div><div class="pp-count muted"></div><div class="pp-list"></div>
        <p class="muted" style="font-size:11px;margin:0">Equipment from the Player's Handbook, Expanded Content and Wretched Hives. Data from <a href="https://sw5e.com" target="_blank" rel="noopener noreferrer">SW5e</a>, a free fan project (sw5e.com).</p>
        <div class="row"><span class="spacer"></span><button class="btn primary" data-eq="close">Done</button></div>`;
      ep.addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.eq === 'check') { t.checked ? F.sel[t.dataset.key].add(t.value) : F.sel[t.dataset.key].delete(t.value); F.limit = 120; render(); updateSummaries(); }
      });
      const updateSummaries = () => {   // refresh the dropdown labels without closing the one that's open
        for (const [key, label, fn] of facets()) {
          const sum = ep.querySelector(`[data-drop="${key}"] summary`); if (!sum) continue;
          const vals = values(fn), sel = F.sel[key], names = key === 'src' ? SRC : {};
          sum.textContent = sel.size === vals.length ? `All ${label}` : sel.size === 0 ? `No ${label}` : sel.size <= 2 ? [...sel].map(v => names[v] || v).join(', ') : `${sel.size} ${label}`;
        }
      };
      ep.addEventListener('input', e => { if (e.target.dataset.eq === 'q') { F.q = e.target.value.trim().toLowerCase(); F.limit = 120; render(); } });
      ep.addEventListener('click', e => {
        const b = e.target.closest('[data-eq]'); if (!b) return;
        const a = b.dataset.eq;
        if (a === 'close') return closeModal();
        if (a === 'set') { ep.querySelectorAll('[data-eq="set"]').forEach(x => x.classList.toggle('on', x === b)); load(b.dataset.set); return; }
        if (a === 'more') { F.limit += 200; return render(); }
        if (a === 'all' || a === 'none') {
          e.preventDefault();
          const fn = facets().find(f => f[0] === b.dataset.key)[2];
          F.sel[b.dataset.key] = new Set(a === 'all' ? values(fn) : []);
          ep.querySelectorAll(`[data-eq="check"][data-key="${b.dataset.key}"]`).forEach(cb => { cb.checked = a === 'all'; });
          render(); updateSummaries(); return;
        }
        if (a === 'add' || a === 'buy') {
          const it = ep._rows[+b.dataset.i]; if (!it) return;
          const enh = F.set === 'enhanced', buy = a === 'buy' && !enh && it.cost > 0;
          // buying (audit 6.8): the item's SW5e cost comes off the character's credits; refused when they're short
          if (buy && (n0(ch().credits) < it.cost)) return toast(`${ch().name} has ${n0(ch().credits).toLocaleString()} cr; ${it.n} costs ${it.cost.toLocaleString()} cr.`, true);
          if (buy) act('chat', { text: `*buys ${it.n} for ${it.cost.toLocaleString()} cr.*`, as: ch().name });
          mutate(c => {
            if (buy) c.credits = n0(c.credits) - it.cost;
            const ex = c.equipment.find(x => String(x.name).toLowerCase() === it.n.toLowerCase());
            if (ex) ex.qty = (n0(ex.qty) || 1) + 1;
            else { c.equipment.push(sheetItem(it, enh));
              // an enhanced weapon of a known kind ("Vibroblade (Fine)", or its subtype) also gets that weapon's attack, with its +N
              const plus = enh && it.cat === 'Weapon' ? R.enhancedBonus(it.desc) : null, base = plus && plus.hit ? enhancedBase(it) : null;
              if (base && !c.attacks.some(x => String(x.name).toLowerCase() === it.n.toLowerCase())) c.attacks.push(Object.assign(weaponAttack(base), { name: it.n }, plus.dmg === plus.hit ? { magic: plus.hit } : {})); }   // the attack box adds to both
            if (!enh && it.cat === 'Weapon' && !c.attacks.some(x => String(x.name).toLowerCase() === it.n.toLowerCase())) c.attacks.push(weaponAttack(it));
          });
          toast(`${buy ? 'Bought' : 'Added'} ${it.n}${!enh && it.cat === 'Weapon' ? ' (and its attack)' : ''}${buy ? ` for ${it.cost.toLocaleString()} cr` : ''}`);
          setTimeout(render, 50);
        }
      });
      await load('standard');
      ep.querySelector('[data-eq="q"]')?.focus();
    });
  }

  // --------------------------------------------------------------------------- power picker
  // "+ force power" / "+ tech power": the whole SW5e list (served by our API, cached), filtered by level
  // and, for force powers, by alignment checkboxes. Picking one adds it with the right level, type and alignment.
  let POWER_LIST = null;
  // a sheet power with its prerequisite: kept on it since 2.11, or (older sheets) from SW5e's list once it has loaded
  const powerPre = p => (p.pre || !POWER_LIST ? p : Object.assign({}, p, { pre: ((POWER_LIST.find(x => x.n.toLowerCase() === String(p.name).toLowerCase() && x.t === (p.type === 'tech' ? 'tech' : 'force')) || {}).pre) || '' }));
  async function powerList() {
    if (POWER_LIST) return POWER_LIST;
    const r = await fetch(`${API}?op=powers`, { credentials: 'same-origin' });
    const j = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(j)) throw new Error((j && j.error) || "Couldn't load the SW5e power list.");
    return (POWER_LIST = j);
  }
  const ALIGN = { light: 'Light', dark: 'Dark', universal: 'Universal' };
  // opts.onAdd(power): hand the picked power to someone else (the level-up wizard) instead of the sheet;
  // opts.onDone(): called by Done; opts.taken(): names already picked there
  // --------------------------------------------------------------------------- item modification (audit 6.4)
  // A chassis's slots: install a modification from the inventory, or remove one, each with a check with the item's tool
  // against the DC its rarity sets (the GM may skip the check). A failed install leaves it in the inventory ("try again
  // after 24 hours"); a failed removal destroys it. The chassis requires attunement once anything is in it, and its
  // modifications' plain +N become its own.
  function modsDialog(ch, i) {
    const item = ch.equipment[i]; if (!item || !item.chassis) return;
    const ro = !canEdit(ch), slots = R.modSlots(item.rar), mods = item.chassis.mods || [];
    const fits = (ch.equipment || []).map((e, j) => ({ e, j })).filter(({ e }) => e.mod && !R.installBlocked(item, e));
    const tool = kind => R.MOD_TOOL[kind] || "Tinker's implements";
    // #218's tool check: Int, the tier the sheet gives that tool, its dice (mastery, Reliable Talent)
    const tierOf = kind => (R.toolTierFromText ? R.toolTierFromText(ch, tool(kind)) : 0);
    const exprOf = kind => { const t = tierOf(kind), b = R.toolBonus ? R.toolBonus(ch, 'int', t) : R.abilityMod(ch, 'int');
      return R.checkRollExpr ? R.checkRollExpr(ch, t, b).expr : `1d20${b >= 0 ? '+' : ''}${b}`; };
    const check = async (what, kind, rar) => {   // the tool check, rolled by the table; true on a success
      const dc = R.modDC(rar);
      const res = await roll(exprOf(kind), `${what}: ${tool(kind)} (Int) against DC ${dc}`, { d20: true });   // no character named (#187's review)
      return res && res.roll ? res.roll.total >= dc : null;
    };
    modal(`<h3>${esc(item.name)}: modifications</h3>
      <p class="muted">${esc(item.rar || 'Standard')} ${esc(item.chassis.kind)} chassis · ${slots.base} slots${slots.aug ? ` + ${slots.aug} augment` : ''} · checks with ${esc(tool(item.chassis.kind))} (augments: ${esc(tool('augment'))})</p>
      ${mods.length ? mods.map((m, k) => `<div class="row" style="margin:4px 0"><span style="flex:1">${m.aug ? '⟡ ' : ''}${esc(m.name)} <span class="muted">${esc(m.rar || '')}</span></span>
        ${ro ? '' : `<button class="btn tiny ghost" data-mod-rm="${k}" title="A check against DC ${R.modDC(m.rar)}: on a success it's salvaged, on a failure destroyed">Remove</button>`}</div>`).join('') : '<p class="muted">Nothing installed.</p>'}
      ${ro ? '' : fits.length ? `<div class="row" style="margin-top:10px"><select id="modPick" style="flex:1">${fits.map(({ e, j }) => `<option value="${j}">${esc(e.name)} (${esc(e.rar || 'Standard')}, DC ${R.modDC(e.rar)})</option>`).join('')}</select>
        <button class="btn primary" id="modInstall">Install</button></div>` : '<p class="muted">Nothing in the inventory fits: a modification of this kind (or an augment), at this rarity or lower, with a slot free.</p>'}
      ${isGM() && !ro ? '<label class="muted carry-var" style="margin-top:8px"><input type="checkbox" id="modNoCheck"> GM: no check</label>' : ''}
      <div class="row" style="margin-top:10px">${!ro && R.nextRarity(item) ? `<button class="btn tiny ghost" id="modUpgrade" title="Wretched Hives: one rarity step, 8 hours, a rare material, and a check against DC ${R.modDC(R.nextRarity(item))}. On a failure, wait 24 hours, and a d20 of 1 destroys an installed modification.">Upgrade to ${esc(R.nextRarity(item))}…</button>` : ''}
        <span class="spacer"></span><button class="btn" id="modClose">Close</button></div>`, box => {
      box.onclick = async e => {
        if (e.target.id === 'modClose') return closeModal();
        const skip = isGM() && $('#modNoCheck', box) && $('#modNoCheck', box).checked;
        if (e.target.id === 'modUpgrade') {   // a rarity step for the chassis (6.4)
          const next = R.nextRarity(item); if (!next) return;
          if (!confirm(`Upgrade ${item.name} to ${next}? It takes 8 hours and an appropriate rare material (see Crafting), and a check against DC ${R.modDC(next)}.`)) return;
          closeModal();
          const ok = skip ? true : await check(`Upgrade ${item.name} to ${next}`, item.chassis.kind, next);
          if (ok === null) return;
          if (ok) {
            mutate(c => { const it = c.equipment[i]; if (it && it.name === item.name && it.chassis) R.upgradeChassis(it); });
            return act('chat', { text: `*upgrades ${item.name} to ${next}.*` });
          }
          // a failure: wait 24 hours, and on a d20 of 1 one installed modification, picked at random, is destroyed
          const d = mods.length ? await roll('1d20', `Failed upgrade of ${item.name}: on a 1, an installed modification is destroyed`) : null;
          const lost = d && d.roll && d.roll.total === 1 ? await roll(`1d${mods.length}`, `Which modification of ${item.name} is destroyed`) : null;
          const k = lost && lost.roll ? lost.roll.total - 1 : -1, gone = mods[k];
          if (gone) mutate(c => { const it = c.equipment[i]; if (it && it.name === item.name && it.chassis && (it.chassis.mods || [])[k] && it.chassis.mods[k].name === gone.name) R.removeMod(c, i, k, false); });
          return act('chat', { text: `*fails to upgrade ${item.name}; try again after 24 hours${gone ? `. ${gone.name} is destroyed` : ''}.*` });
        }
        if (e.target.id === 'modInstall') {
          const j = +$('#modPick', box).value, m = ch.equipment[j]; if (!m) return;
          const why = R.installBlocked(item, m); if (why) return toast(why, true);
          closeModal();
          const ok = skip ? true : await check(`Install ${m.name} in ${item.name}`, m.mod.kind, m.rar);
          if (ok === null) return;
          if (!ok) return act('chat', { text: `*fails to install ${m.name} in ${item.name}: it stays in the pack; try again after 24 hours.*` });
          mutate(c => {
            const it = c.equipment[i], mm = c.equipment[j]; if (!it || !mm || it.name !== item.name || mm.name !== m.name) return;
            R.installMod(c, i, j);
          });
          act('chat', { text: `*installs ${m.name} in ${item.name}.*` });
        }
        const rm = e.target.closest('[data-mod-rm]');
        if (rm) {
          const k = +rm.dataset.modRm, m = mods[k]; if (!m) return;
          closeModal();
          const ok = skip ? true : await check(`Remove ${m.name} from ${item.name}`, m.aug ? 'augment' : item.chassis.kind, m.rar);
          if (ok === null) return;
          mutate(c => {
            const it = c.equipment[i]; if (!it || it.name !== item.name || !it.chassis || !(it.chassis.mods || [])[k] || it.chassis.mods[k].name !== m.name) return;
            R.removeMod(c, i, k, ok);
          });
          act('chat', { text: ok ? `*removes ${m.name} from ${item.name} and salvages it.*` : `*removes ${m.name} from ${item.name}, but it's destroyed.*` });
        }
      };
    });
  }

  // --------------------------------------------------------------------------- cybernetics and droid customizations (audit 6.4)
  // Installed in the character from its inventory, each with a check with biotech's implements (cybernetics) or astrotech's
  // (droids) against the DC its rarity sets, rolled with the installer's numbers: a character the user plays, or no check
  // for the GM (an NPC does the work). A failed install leaves it in the pack, and a failed enhancement costs a level of
  // exhaustion; a failed removal destroys it. A player is held to the limits (proficiency bonus, motor slots, parts and
  // protocols, droids only); the GM may go past them. The cybernetic side effects show by count.
  function implantBox(ch, ro) {
    const list = ch.implants || [], droid = R.isDroid(ch);
    if (!list.length && !droid && !(ch.equipment || []).some(e => e.implant)) return '';
    const k = R.implantCounts(ch), side = R.cyberSideEffects(ch);
    return `<div class="box implants"><h4>${droid ? '🔩 Droid customizations' : '🦾 Cybernetics'} <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-act="implants">Install…</button>' : ''}</h4>
      <p class="muted" style="margin:0 0 6px">${droid ? `Motor: ${n0(k.droid)} of ${n0(k.motor)} slots · parts ${n0(k.parts)} of ${n0(k.partsMax)} · protocols ${n0(k.protocols)} of ${n0(k.protocolsMax)}`
        : `${n0(k.cyber)} of ${n0(k.cyberMax)} augmentations (the proficiency bonus)`}</p>
      ${list.length ? `<div class="list-rows">${list.map((m, i) => `<div class="lr"><span class="nm">${esc(m.name)} <span class="muted">${esc(m.kind)}${m.rar ? ` · ${esc(m.rar)}` : ''}</span></span><span class="spacer"></span>
        <button class="btn tiny ghost" data-act="item-info" data-list="implants" data-i="${i}" title="What it does (SW5e's text)">ⓘ</button>${!ro ? `<button class="btn tiny ghost" data-act="implant-rm" data-i="${i}" title="A check against DC ${R.modDC(m.rar)}: salvaged on a success, destroyed on a failure">Remove</button>` : ''}</div>`).join('')}</div>`
        : '<p class="muted">Nothing installed.</p>'}
      ${side.length ? `<p class="muted" style="font-size:12px;margin:6px 0 0" title="Wretched Hives: Cybernetic Augmentation Side Effects">${side.map(esc).join(' ')}</p>` : ''}
      ${droid && !ro && k.motor < 6 ? `<button class="btn tiny ghost" data-act="motor-up" style="margin-top:6px" title="Wretched Hives: Total Slots Upgrade Cost, times the size's modifier">Upgrade the motor to ${k.motor + 1} slots (${n0(R.motorCost(ch, k.motor + 1)).toLocaleString()} cr)</button>` : ''}
    </div>`;
  }
  // install from the inventory (k undefined) or remove installed implant k
  function implantDialog(ch, k) {
    const removing = k != null, im = removing ? (ch.implants || [])[k] : null;
    if (removing && !im) return;
    const fits = removing ? [] : (ch.equipment || []).map((e, j) => ({ e, j })).filter(({ e }) => e.implant && R.groupOf(e.implant.kind));
    if (!removing && !fits.length) return toast("Nothing in the inventory to install: add a cybernetic augmentation or droid customization from SW5e's enhanced items.", true);
    const who = chars().filter(c => canEdit(c));   // the installer, whose check it is
    modal(`<h3>${removing ? `Remove ${esc(im.name)}` : `Install in ${esc(ch.name)}`}</h3>
      ${removing ? '' : `<div class="row"><select id="imPick" style="flex:1">${fits.map(({ e, j }) => `<option value="${j}">${esc(e.name)} (${esc(e.implant.kind)}, ${esc(e.rar || 'Standard')}, DC ${R.modDC(e.rar)})</option>`).join('')}</select></div>`}
      <div class="row" style="margin-top:8px"><span class="muted">The work is done by</span><select id="imBy" style="flex:1">${who.map(c => `<option value="${esc(c.id)}"${c.id === ch.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <p class="muted" id="imWhy" style="font-size:12px"></p>
      ${isGM() ? '<label class="muted carry-var"><input type="checkbox" id="imNoCheck"> GM: no check (an NPC does the work)</label>' : ''}
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn" id="imClose">Cancel</button><button class="btn primary" id="imGo">${removing ? 'Remove' : 'Install'}</button></div>`, box => {
      const pick = () => (removing ? Object.assign({ implant: { kind: im.kind } }, im) : ch.equipment[+$('#imPick', box).value]);
      const info = () => {
        const e = pick(), g = e && R.groupOf(e.implant.kind); if (!g) return;
        const why = removing ? null : R.implantBlocked(ch, e), hrs = R.implantHours(ch) / (removing ? 2 : 1);
        $('#imWhy', box).textContent = `${hrs} hours of work and a check with ${R.IMPLANT_TOOL[g]} (Int) against DC ${R.modDC(e.rar)}.` + (why ? ` ${why}${isGM() ? ' The GM may go ahead.' : ''}` : '');
      };
      info(); box.onchange = info;
      box.onclick = async ev => {
        if (ev.target.id === 'imClose') return closeModal();
        if (ev.target.id !== 'imGo') return;
        const e = pick(); if (!e) return;
        const kind = e.implant.kind, g = R.groupOf(kind), tool = R.IMPLANT_TOOL[g], j = removing ? -1 : +$('#imPick', box).value;
        const why = removing ? null : R.implantBlocked(ch, e);
        if (why && !isGM()) return toast(why, true);
        if (why && !confirm(`${why} Install it anyway?`)) return;
        const skip = isGM() && $('#imNoCheck', box) && $('#imNoCheck', box).checked;
        const by = Object.prototype.hasOwnProperty.call(S.st.characters, $('#imBy', box).value) ? S.st.characters[$('#imBy', box).value] : ch;
        closeModal();
        let ok = true;
        if (!skip) {   // #218's tool check with the installer's tier and dice; no character named on the roll (#187's review)
          const t = R.toolTierFromText ? R.toolTierFromText(by, tool) : 0, b = R.toolBonus ? R.toolBonus(by, 'int', t) : R.abilityMod(by, 'int');
          const expr = R.checkRollExpr ? R.checkRollExpr(by, t, b).expr : d20(b), dc = R.modDC(e.rar);
          const res = await roll(expr, `${removing ? 'Remove' : 'Install'} ${e.name}: ${tool} (Int) against DC ${dc}`, { d20: true });
          if (!res || !res.roll) return;
          ok = res.roll.total >= dc;
        }
        const hrs = R.implantHours(ch) / (removing ? 2 : 1);
        if (removing) {
          mutate(c => { const x = (c.implants || [])[k]; if (x && x.name === im.name) R.removeImplant(c, k, ok); });
          return act('chat', { text: `*removes ${im.name} (${hrs} hours of work)${ok ? ' and salvages it' : ", but it's destroyed"}${kind === 'replacement' ? '; the part it replaced is missing until another replacement goes in' : ''}.*` });
        }
        if (!ok) {
          if (kind === 'enhancement') mutate(c => { c.exhaustion = Math.min(6, n0(c.exhaustion) + 1); });
          return act('chat', { text: `*fails to install ${e.name} after ${hrs} hours: it stays in the pack; try again after 24 hours${kind === 'enhancement' ? '. The recipient gains a level of exhaustion' : kind === 'replacement' ? `. The recipient can't use that part for ${hrs} hours` : ''}.*` });
        }
        mutate(c => { const x = c.equipment[j]; if (x && x.name === e.name) R.installImplant(c, j); });
        act('chat', { text: `*installs ${e.name} (${hrs} hours of work).*` });
      };
    });
  }
  // a droid's motor, one slot up: the book's price times the size's modifier, from the droid's credits (the GM may waive it)
  function motorUp(ch) {
    const n = R.motorSlots(ch) + 1, cost = R.motorCost(ch, n); if (!cost) return;
    const short = n0(ch.credits) < cost;
    if (short && !isGM()) return toast(`${ch.name} has ${n0(ch.credits).toLocaleString()} cr; the upgrade costs ${cost.toLocaleString()} cr.`, true);
    if (!confirm(short ? `${ch.name} has ${n0(ch.credits).toLocaleString()} cr, short of ${cost.toLocaleString()}. Upgrade the motor to ${n} slots without charging it?`
      : `Upgrade ${ch.name}'s motor to ${n} slots for ${cost.toLocaleString()} cr (${R.implantHours(ch)} hours of work)?`)) return;
    mutate(c => { c.motor = n; if (!short) c.credits = n0(c.credits) - cost; });
    act('chat', { text: `*upgrades a droid motor to ${n} slots${short ? '' : ` for ${cost.toLocaleString()} cr`}.*` });
  }

  // --------------------------------------------------------------------------- consumables (audit 6.7)
  // Use: one comes off the count, and what the item does is rolled (from its SW5e text, read when it was added): a medpac's
  // Hit Dice + Con or a stim's healing, on this character or for someone else to read; a grenade's save DC and damage.
  const useText = u => [u.hd && `${u.hd} Hit Die${u.hd > 1 ? 'Dice' : ''} + Con of healing`, u.heal && `${u.heal} healing`,
    u.save && `DC ${u.save.dc} ${u.save.ab.toUpperCase()} save`, u.dmg && u.dmg.map(([d, t]) => `${d} ${t}`).join(' + '), u.half && 'half on a save'].filter(Boolean).join(', ');
  function useItem(ch, i) {
    const e = ch.equipment[i]; if (!e || !e.use) return;
    if ((n0(e.qty) || 0) < 1) return toast(`No ${e.name} left.`, true);
    const u = e.use, con = R.abilityMod(ch, 'con'), die = R.commonHitDie(ch);
    const healExpr = u.hd ? `${u.hd}d${die}${con ? (con > 0 ? '+' : '') + con : ''}` : u.heal || '';
    const dmgExpr = (u.dmg || []).map(d => d[0]).join('+');
    const spend = () => mutate(c => { const x = c.equipment[i]; if (!x || x.name !== e.name) return; if ((n0(x.qty) || 1) > 1) x.qty = (n0(x.qty) || 1) - 1; else c.equipment.splice(i, 1); });
    const go = async (self) => {
      closeModal(); spend();
      const what = useText(u);
      // no `as` and no character on the rolls: the lines show their sender, never a name the GM may be hiding (#187's review)
      act('chat', { text: `*uses ${e.name}${what ? `: ${what}` : ''}.*` });
      if (healExpr) {
        const res = await roll(healExpr, `${e.name}: healing${u.hd ? ` (the user's Hit Die${u.hd > 1 ? 's' : ''} and Con; another creature rolls its own)` : ''}`, { kind: 'heal' });
        const n = res && res.roll ? Math.max(u.hd ? 1 : 0, res.roll.total) : 0;   // a medpac heals at least one
        if (self && n) mutate(c => { const was = +c.hp.current || 0; c.hp.current = Math.min(+c.hp.max || 0, was + n); if (c.hp.current > 0) { c.deathSaves = { s: 0, f: 0 }; if (was <= 0) c.conditions = (c.conditions || []).filter(x => x !== 'Unconscious'); } });
      }
      if (dmgExpr) await roll(dmgExpr, `${e.name}: ${(u.dmg || []).map(d => d[1]).join(' and ')} damage${u.half ? ', half on a save' : ''}`, { kind: 'damage' });
    };
    modal(`<h3>Use ${esc(e.name)}</h3><p class="muted">${n0(e.qty)} left. ${esc(useText(u) || 'Nothing to roll: one comes off the count.')}</p>
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn" id="useNo">Cancel</button>
      ${healExpr ? `<button class="btn" id="useOther" title="Roll it and post it; whoever it's used on applies it">For someone else</button><button class="btn primary" id="useSelf">On ${esc(ch.name)}</button>` : '<button class="btn primary" id="useGo">Use one</button>'}</div>`, box => {
      box.onclick = e2 => {
        if (e2.target.id === 'useNo') closeModal();
        if (e2.target.id === 'useSelf') go(true);
        if (e2.target.id === 'useOther' || e2.target.id === 'useGo') go(false);
      };
    });
  }

  // --------------------------------------------------------------------------- the sheet's Cast (#73, audit 4.4-4.7)
  // Choose the level (upcasting pays a point more per level, up to the max power level; the GM may go past it), and,
  // for a power the table has data for, its targets on the map: the server rolls it as the combat view does (attack or
  // saves, damage or healing, conditions, concentration). In a fight this character is in, it is the combat view's own
  // action. A power without data casts as before, at the level chosen.
  // the force or tech box's note on high-level casting (#160): from which level, and what's been cast since the long rest
  const highNote = (ch, k, maxL) => {
    const from = R.highCastFrom(ch, k), used = R.highCastUsed(ch, k);
    if (!from || maxL < from) return '';
    return ` · level ${from}${maxL > from ? '+' : ''}: once each per long rest${used.length ? ` (cast: ${used.join(', ')})` : ''}`;
  };
  const powerData = p => { const lib = (S.st.sheetCast || {}).lib || (S.st.fight || {}).lib || {}, k = String((p && p.name) || '').trim().toLowerCase(); return Object.prototype.hasOwnProperty.call(lib, k) ? lib[k] : null; };
  async function castPower(ch, i) {
    const p = ch.powers[i]; if (!p) return;
    if (!p.pre && !POWER_LIST && S.st.sw5eBooks !== false) await powerList().catch(() => {});   // an older sheet: its prerequisite from SW5e's list
    const base = +p.level || 0, k = p.type === 'tech' ? 'tech' : 'force', ci = R.casterInfo(ch);
    const maxL = k === 'tech' ? ci.techMaxLevel : ci.forceMaxLevel;
    const over = R.overMaxPowerLevel(ch, p, ci);   // audit 4.5: a player is refused; the GM is asked when casting
    if (over && !isGM()) return toast(over.text, true);
    const need = R.powerPrereqUnmet(ch, powerPre(p));   // audit 2.11: its prerequisite must stay known to cast it
    if (need && !isGM()) return toast(need.text, true);
    if (need && !confirm(`${need.text}\n\nCast it anyway?`)) return;
    const data = powerData(p), F = S.st.fight;
    const entry = F && F.on && F.active ? (S.st.initiative.entries || []).find(e => e.charId === ch.id) : null;
    const top = base ? Math.min(9, isGM() ? 9 : Math.max(base, maxL)) : 0;
    const levels = base ? Array.from({ length: top - base + 1 }, (_, n) => base + n) : [0];
    if (!data && levels.length < 2) return castAt(ch, p, base, null);
    const pts = n => (n ? `${n + 1} ${k === 'force' ? 'FP' : 'TP'}` : 'free');
    const self = data && data.targets === 'self', area = data && data.area;
    const toks = data && !self ? (S.st.map.tokens || []) : [];
    const up = data && data.upcast && data.upcast.damage ? ` · +${esc(data.upcast.damage)} per level above ${base}` : '';
    const usedHigh = R.highCastUsed(ch, k), from = R.highCastFrom(ch, k);
    modal(`<h3>Cast ${esc(p.name)}</h3>
      ${levels.length > 1 ? `<label class="mini">Level <select id="castLvl">${levels.map(n => `<option value="${n}">${n} · ${pts(n)}${n > maxL ? ' (above max)' : from && n >= from ? (usedHigh.includes(n) ? ' (used until a long rest)' : ' (once per long rest)') : ''}</option>`).join('')}</select></label>
        <p class="muted" style="font-size:12px;margin:4px 0">Casting higher costs a point more per level${up}.</p>` : ''}
      ${data ? (self ? `<p class="muted">Affects ${esc(ch.name)}.</p>`
        : `<p class="muted" style="margin:8px 0 4px">${area ? 'Tick who is in the area' : `Targets${data.targets > 1 ? ` (up to ${n0(data.targets)})` : ''}`}, or none to roll it once for the table${isGM() ? '' : ". At anyone but your own characters it rolls and posts, for its owner or the GM to apply"}:</p>
        <div class="cast-targets" style="max-height:220px;overflow:auto">${toks.map(t => `<label class="check" style="display:block"><input type="checkbox" data-tok="${esc(t.id)}"> ${esc(t.name)}${t.hidden ? ' <span class="muted">(hidden)</span>' : ''}</label>`).join('') || '<p class="muted">No tokens on the map.</p>'}</div>`)
        : '<p class="muted">The table has no data for this power, so it posts as before, at the level chosen.</p>'}
      <div class="row" style="margin-top:10px"><span class="spacer"></span><button class="btn" id="castNo">Cancel</button><button class="btn primary" id="castGo">Cast</button></div>`, box => {
      box.onclick = async e => {
        if (e.target.id === 'castNo') return closeModal();
        if (e.target.id !== 'castGo') return;
        const L = levels.length > 1 ? +$('#castLvl', box).value : base;
        const ov = R.overMaxPowerLevel(ch, { level: L, type: k }, ci) || R.highCastBlocked(ch, { type: k }, L);
        if (ov && !isGM()) return toast(ov.text, true);
        if (ov && !confirm(`${ov.text}\n\nCast anyway?`)) return;
        const targets = [...box.querySelectorAll('[data-tok]:checked')].map(x => x.dataset.tok);
        if (!data) { closeModal(); return castAt(ch, p, L, ov); }
        if (entry) {   // in the fight: the combat view's own action, which checks the turn
          if (area) return toast('Place an area power from the combat view.', true);
          const ids = targets.map(t => Object.keys(F.units || {}).find(id => F.units[id].token === t));
          if (ids.some(x => !x)) return toast('Pick targets that are in the fight.', true);
          if (await act('fight.use', { ability: 'pw:' + String(p.name).trim().toLowerCase(), targets: ids, upcast: L - base })) closeModal();
          return;
        }
        if (await act('fight.cast', { charId: ch.id, power: p.name, level: L, targets })) closeModal();
      };
    });
  }
  // a power without the table's data: pay and post, as the sheet always has, at the level chosen
  function castAt(ch, p, L, ovAsked) {
    const base = +p.level || 0, cost = L ? L + 1 : 0, k = p.type === 'tech' ? 'tech' : 'force', ci = R.casterInfo(ch);
    const ov = R.overMaxPowerLevel(ch, { level: L, type: k }, ci) || R.highCastBlocked(ch, { type: k }, L);
    if (ov && !isGM()) return toast(ov.text, true);
    if (ov && !ovAsked && !confirm(`${ov.text}\n\nCast anyway?`)) return;
    const max = ch[k].max !== '' && ch[k].max != null ? +ch[k].max : (k === 'force' ? ci.forceMax : ci.techMax);
    const spend = R.pointsSpend(ch[k], cost, max);   // temporary points first (audit 4.9)
    if (cost && !spend) return toast(`Not enough ${k} points (${cost} needed).`, true);
    const from = R.highCastFrom(ch, k);   // a level that goes once per long rest is noted (#160)
    const hunted = k === 'force' && vOn('Hunted');   // Hunted (variant): a force power adds its level to the pool
    if (cost || (from && L >= from) || (hunted && L)) mutate(c => {
      if (hunted && L) c.disturbance = Math.min(999, (+c.disturbance || 0) + L);
      if (cost) { c[k].used = spend.used; c[k].temp = spend.temp; }
      if (from && L >= from) c[k].high = [...new Set(R.highCastUsed(c, k).concat(L))].sort((a, b) => a - b);
    });
    const dc = k === 'tech' ? `DC ${ci.techDC}, atk ${R.fmt(ci.techAtk)}` : p.alignment === 'dark' ? `DC ${ci.darkDC}, atk ${R.fmt(ci.darkAtk)}` : p.alignment === 'light' ? `DC ${ci.lightDC}, atk ${R.fmt(ci.lightAtk)}` : `DC ${Math.max(ci.lightDC, ci.darkDC)}, atk ${R.fmt(Math.max(ci.lightAtk, ci.darkAtk))}`;
    act('chat', { text: `casts **${p.name}** (${L ? 'level ' + L : 'at-will'} ${k} power${L > base ? `, cast up from level ${base}` : ''}${cost ? `, −${cost} ${k === 'force' ? 'FP' : 'TP'}` : ''}) · ${dc}${p.notes ? '\n' + p.notes : ''}${p.description ? '\n' + p.description.slice(0, 900) + (p.description.length > 900 ? '…' : '') : ''}`, as: ch.name });
  }

  function openPowerPicker(charId, kind, opts = {}) {
    const force = kind !== 'tech';
    const F = { level: 'all', align: new Set(['light', 'dark', 'universal']), q: '', limit: 120 };
    modal(`<div id="pp" class="power-picker"><h3>${force ? '＋ Add a force power' : '＋ Add a tech power'}</h3><p class="muted">Loading the SW5e power list…</p></div>`, async box => {
      const pp = $('#pp', box);
      let list;
      try { list = (await powerList()).filter(p => p.t === (force ? 'force' : 'tech')); }
      catch (err) { pp.innerHTML = `<h3>${force ? 'Force' : 'Tech'} powers</h3><p class="error">${esc(err.message)}</p><div class="row"><span class="spacer"></span><button class="btn" data-pp="close">Close</button></div>`; pp.onclick = e => { if (e.target.dataset.pp === 'close') closeModal(); }; return; }
      const ch = () => S.st.characters[charId];
      const known = () => new Set([...(ch() ? ch().powers : []).map(p => String(p.name).toLowerCase()), ...(opts.taken ? opts.taken() : [])]);
      const ci = () => (opts.caster ? opts.caster() : R.casterInfo(ch() || {}));
      const shown = () => list.filter(p => (F.level === 'all' || p.l === +F.level) && (!force || F.align.has(p.a))
        && (!F.q || p.n.toLowerCase().includes(F.q)));
      const alignLabel = () => F.align.size === 3 ? 'All alignments' : F.align.size === 0 ? 'None selected' : [...F.align].map(a => ALIGN[a]).join(', ');
      const render = () => {
        const rows = shown(), kn = known(), maxLvl = force ? ci().forceMaxLevel : ci().techMaxLevel;
        pp.querySelector('.pp-list').innerHTML = rows.slice(0, F.limit).map(p => {
          const has = kn.has(p.n.toLowerCase());
          return `<div class="pp-row" data-n="${esc(p.n)}">
            <div class="pp-main"><b>${esc(p.n)}</b>
              <span class="pp-lvl">${p.l ? 'Level ' + p.l : 'At-will'}</span>${force ? `<span class="pp-al pp-${esc(p.a)}">${esc(ALIGN[p.a] || '')}</span>` : ''}
              ${p.c ? '<span class="pp-tag">Concentration</span>' : ''}${p.src === 'EC' ? '<span class="pp-tag" title="SW5e Expanded Content">EC</span>' : ''}
              ${p.l > maxLvl ? `<span class="pp-tag pp-high" title="${maxLvl ? `Above the highest level this character can cast right now (${maxLvl})` : `This character can't cast leveled ${force ? 'force' : 'tech'} powers yet`}">above your level</span>` : ''}
              <div class="pp-meta">${esc(p.ct)} · Range ${esc(p.r)} · ${esc(p.d)}${p.pre ? ` · Requires ${esc(p.pre)} ${kn.has(p.pre.toLowerCase()) ? '<span class="up">✓</span>' : '<span class="error">(not known yet)</span>'}` : ''}</div>
              <details class="pp-desc"><summary>Description</summary><div>${md(p.desc)}${p.hl ? `<p><b>At higher levels.</b> ${md(p.hl)}</p>` : ''}</div></details></div>
            <button class="btn small ${has ? 'ghost' : 'primary'}" data-pp="add" ${has ? 'disabled' : ''}>${has ? '✓ Known' : 'Add'}</button></div>`;
        }).join('') + (rows.length > F.limit ? `<button class="btn small" data-pp="more" style="width:100%">Show ${rows.length - F.limit} more</button>` : '')
          + (!rows.length ? '<p class="muted">No powers match these filters.</p>' : '');
        pp.querySelector('.pp-count').textContent = `${rows.length} of ${list.length} ${force ? 'force' : 'tech'} powers`;
        const al = pp.querySelector('.pp-align summary'); if (al) al.textContent = alignLabel();
      };
      pp.innerHTML = `<h3>${force ? '＋ Add a force power' : '＋ Add a tech power'}</h3>
        <div class="pp-filters">
          <label class="mini">Level <select data-pp="level"><option value="all">All levels</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(l => `<option value="${l}">${l ? l : '0 (at-will)'}</option>`).join('')}</select></label>
          ${force ? `<details class="pp-align"><summary>All alignments</summary><div class="pp-align-menu">
            ${['light', 'dark', 'universal'].map(a => `<label class="toggle"><input type="checkbox" data-pp="align" value="${a}" checked> ${ALIGN[a]}</label>`).join('')}</div></details>` : ''}
          <input data-pp="q" placeholder="Search by name…" style="flex:1;min-width:140px">
        </div>
        <div class="pp-count muted"></div>
        <div class="pp-list"></div>
        <p class="muted" style="font-size:11px;margin:0">Data from <a href="https://sw5e.com" target="_blank" rel="noopener noreferrer">SW5e</a>, a free fan project (sw5e.com).</p>
        <div class="row"><span class="spacer"></span><button class="btn primary" data-pp="close">Done</button></div>`;
      pp.addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.pp === 'level') { F.level = t.value; F.limit = 120; render(); }
        if (t.dataset.pp === 'align') { t.checked ? F.align.add(t.value) : F.align.delete(t.value); F.limit = 120; render(); }
      });
      pp.addEventListener('input', e => { if (e.target.dataset.pp === 'q') { F.q = e.target.value.trim().toLowerCase(); F.limit = 120; render(); } });
      pp.addEventListener('click', e => {
        const b = e.target.closest('[data-pp]'); if (!b) return;
        if (b.dataset.pp === 'close') return opts.onDone ? opts.onDone() : closeModal();
        if (b.dataset.pp === 'more') { F.limit += 200; return render(); }
        if (b.dataset.pp === 'add') {
          const p = list.find(x => x.n === b.closest('.pp-row').dataset.n); if (!p) return;
          // audit 4.5: learning a power above the max power level asks first (players and the GM alike)
          const over = R.overMaxPowerLevel(ch() || {}, { level: p.l, type: force ? 'force' : 'tech' }, ci());
          if (over && !confirm(`${over.text} It can't be cast until then.\n\nAdd it anyway?`)) return;
          // audit 2.11: its prerequisite power must be known first (one picked in the same level-up counts); the GM may allow it
          const need = R.powerPrereqUnmet(ch() || {}, { name: p.n, pre: p.pre }, opts.taken ? opts.taken() : []);
          if (need && !isGM()) return toast(need.text, true);
          if (need && !confirm(`${need.text}\n\nAdd it anyway?`)) return;
          const notes = [p.ct, p.r && 'Range ' + p.r, p.d, p.c && !/concentration/i.test(p.d) ? 'Concentration' : ''].filter(Boolean).join(' · ');
          const desc = p.desc + (p.hl ? '\n\nAt higher levels. ' + p.hl : '');
          const pw = { name: p.n, level: p.l, type: force ? 'force' : 'tech', alignment: force ? p.a : 'universal', notes: notes.slice(0, 300), description: desc.slice(0, 4000), ...(p.pre ? { pre: p.pre } : {}) };
          if (opts.onAdd) opts.onAdd(pw); else mutate(c => c.powers.push(pw));
          b.textContent = '✓ Added'; b.disabled = true; b.classList.replace('primary', 'ghost');
          toast(`Added ${p.n}`);
        }
      });
      render();
      pp.querySelector('[data-pp="q"]').focus();
    });
  }

  // --------------------------------------------------------------------------- power tooltips
  const tip = document.createElement('div');
  tip.className = 'hover-card hidden'; tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);
  function powerCard(ch, pw) {
    const ci = R.casterInfo(ch), lvl = +pw.level || 0, tech = pw.type === 'tech';
    const cost = lvl ? lvl + 1 : 0;
    const side = tech ? 'Tech' : pw.alignment === 'light' ? 'Light side' : pw.alignment === 'dark' ? 'Dark side' : 'Universal';
    const dc = tech ? ci.techDC : pw.alignment === 'dark' ? ci.darkDC : pw.alignment === 'light' ? ci.lightDC : Math.max(ci.lightDC, ci.darkDC);
    const atk = tech ? ci.techAtk : pw.alignment === 'dark' ? ci.darkAtk : pw.alignment === 'light' ? ci.lightAtk : Math.max(ci.lightAtk, ci.darkAtk);
    const desc = String(pw.description || '').trim();
    return `<div class="hc-title">${esc(pw.name || 'Power')}</div>
      <div class="hc-sub">${lvl ? 'Level ' + lvl : 'At-will'} · ${side} ${tech ? 'power' : 'force power'}</div>
      <div class="hc-stats"><span>Cost <b>${cost ? cost + (tech ? ' TP' : ' FP') : 'free'}</b></span><span>Save DC <b>${n0(dc)}</b></span><span>Attack <b>${R.fmt(n0(atk))}</b></span></div>
      ${pw.notes ? `<div class="hc-notes">${esc(pw.notes)}</div>` : ''}
      ${desc ? `<div class="hc-desc">${richText(desc.length > 900 ? desc.slice(0, 900) + '…' : desc)}</div>`
        : `<div class="hc-desc muted">No description yet${canEdit(ch) ? '. Click ✎ to add one.' : '.'}</div>`}`;
  }
  const richText = s => (window.HTB ? HTB.mdBlock(s, { shift: 3, breaks: true }).html : md(s));
  function placeTip(x, y) {
    const r = tip.getBoundingClientRect(), pad = 14;
    let left = x + pad, top = y + pad;
    if (left + r.width > innerWidth - 8) left = x - r.width - pad;
    if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
    tip.style.left = Math.max(8, left) + 'px'; tip.style.top = top + 'px';
  }
  function showTextTip(title, text, x, y) {
    const t = String(text || '').trim();
    tip.innerHTML = `<div class="hc-title">${esc(title)}</div>${t ? `<div class="hc-desc">${richText(t.length > 1200 ? t.slice(0, 1200) + '…' : t)}</div>` : '<div class="hc-desc muted">No description.</div>'}`;
    tip.classList.remove('hidden'); placeTip(x, y);
  }
  function showFeatureTip(el, x, y) {
    const ch = selChar(); const f = ch && ch.features[+el.dataset.featureTip];
    if (!f) return;
    const text = String(f.text || '').trim();
    tip.innerHTML = `<div class="hc-title">${esc(f.name || 'Feature')}</div>
      ${text ? `<div class="hc-desc">${richText(text.length > 1500 ? text.slice(0, 1500) + '…' : text)}</div>` : '<div class="hc-desc muted">No description.</div>'}`;
    tip.classList.remove('hidden'); placeTip(x, y);
  }
  function showPowerTip(row, x, y) {
    const ch = selChar(); const pw = ch && ch.powers[+row.dataset.powerTip];
    if (!pw) return;
    tip.innerHTML = powerCard(ch, pw); tip.classList.remove('hidden'); placeTip(x, y);
  }
  const hideTip = () => { if (!tip.classList.contains('hc-sheet')) tip.classList.add('hidden'); };
  const tipTarget = e => e.target.closest('[data-power-tip], [data-feature-tip]');
  const showTip = (el, x, y) => (el.dataset.featureTip !== undefined ? showFeatureTip(el, x, y) : showPowerTip(el, x, y));
  $('#sheet').addEventListener('mouseover', e => { const el = tipTarget(e); if (el) showTip(el, e.clientX, e.clientY); });
  $('#sheet').addEventListener('mousemove', e => { if (!tip.classList.contains('hidden') && tipTarget(e)) placeTip(e.clientX, e.clientY); });
  $('#sheet').addEventListener('mouseout', e => { const el = tipTarget(e); if (el && !el.contains(e.relatedTarget)) hideTip(); });
  $('#sheet').addEventListener('focusin', e => { const el = tipTarget(e); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left, r.bottom); } });
  $('#sheet').addEventListener('focusout', hideTip);
  document.addEventListener('scroll', e => { if (!tip.classList.contains('hc-sheet')) hideTip(e); }, true);
  // phones and tablets (audit 12.11): there's no hover, so a tap on a power or feature (not on its inputs or buttons)
  // opens its card as a sheet along the bottom of the screen, with ✕; a tap anywhere else closes it
  $('#sheet').addEventListener('pointerup', e => {
    if (e.pointerType !== 'touch') return;
    const el = tipTarget(e);
    if (!el || e.target.closest('input, select, textarea, button')) return;
    showTip(el, 0, 0);
    tip.classList.add('hc-sheet');
    tip.insertAdjacentHTML('afterbegin', '<button class="btn tiny ghost hc-close" aria-label="Close">✕</button>');
    tip.style.left = ''; tip.style.top = '';
  });
  document.addEventListener('pointerdown', e => {
    if (!tip.classList.contains('hc-sheet')) return;
    if (e.target.closest('.hc-close') || !tip.contains(e.target)) { tip.classList.add('hidden'); tip.classList.remove('hc-sheet'); }
  }, true);

  // --------------------------------------------------------------------------- combat
  function renderCombat(el) {
    const ini = S.st.initiative, gm = isGM();
    const myChars = chars().filter(c => c.owner === clientId);
    let html = `<div class="row wrap"><h3>Initiative</h3><span class="round">${ini.active ? 'Round ' + ini.round : 'Not in combat'}</span><span class="spacer"></span>
      ${myChars.map(c => `<button class="btn small amber" data-cact="roll-init" data-id="${esc(c.id)}">⚔ Roll for ${esc(c.name)}</button>`).join('')}
      ${gm ? `<button class="btn small" data-cact="start">Start</button><button class="btn small" data-cact="prev">◀ Prev</button>
        <button class="btn small primary" data-cact="next">Next turn ▶</button><button class="btn small danger" data-cact="clear">End combat</button>` : ''}</div>`;
    if (gm) html += `<div class="box" style="margin-top:12px"><h4>Add NPC / enemy</h4><div class="npc-form">
      <label>Name<input id="npcName" placeholder="Stormtrooper"></label><label>Init bonus<input id="npcBonus" type="number" value="1"></label>
      <label>HP<input id="npcHp" type="number" value="13"></label><label>AC<input id="npcAc" type="number" value="14"></label>
      <label>Count<input id="npcCount" type="number" value="1" min="1" max="20"></label>
      <label title="Your saved NPCs: pick one to fill this form">My NPCs<select id="npcTpl"><option value="">—</option>${(S.st.npcs || []).map(t => `<option value="${esc(t.id)}" ${S.npcTpl === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="toggle"><input type="checkbox" id="npcHidden"> hidden</label>
      <button class="btn primary" data-cact="add-npc">Add</button></div>
      <div class="row wrap" style="margin-top:6px"><label class="toggle"><input type="checkbox" id="npcToken" checked> also place map tokens</label>
        <label class="toggle" title="Players see these tokens as ??? until you reveal them"><input type="checkbox" id="npcNameHidden"> hide their names</label>
        <label class="toggle" title="For SW5e creatures: roll each one's hit dice instead of taking the average"><input type="checkbox" id="npcRollHp"> roll creature HP</label>
        <span class="spacer"></span><button class="btn small" data-cact="npc-tpl" title="Save this NPC with its attacks and notes, to add again any time">💾 ${S.npcTpl ? 'Edit NPC…' : 'Save as NPC…'}</button>
        <button class="btn small amber" data-cact="add-creature">☠ Add an SW5e creature…</button></div></div>
      <div class="enc-diff row wrap" id="encDiff" title="The creatures' XP, multiplied for their numbers, against the party's thresholds (SW5e's encounter-building rules)"></div>`;
    html += `<div class="init-list">${ini.entries.map((en, i) => {
      const ch = en.charId && S.st.characters[en.charId];
      const canHp = gm || (ch && ch.owner === clientId);
      const hp = en.hp == null ? '' : `${en.hp}`, temp = ch ? Math.max(0, +(ch.hp || {}).temp || 0) : 0;
      return `<div class="init-row ${ini.active && i === ini.turn ? 'cur' : ''} ${en.hidden ? 'hid' : ''}" data-id="${esc(en.id)}">
        <div class="init${gm ? ' gm-init' : ''}">${gm ? `<input type="number" value="${n0(en.init)}" data-cf="init" aria-label="Initiative for ${esc(en.name)}"><span class="init-step"><button type="button" data-cact="init-up" title="Raise initiative by 1" aria-label="Raise initiative for ${esc(en.name)}">▲</button><button type="button" data-cact="init-down" title="Lower initiative by 1" aria-label="Lower initiative for ${esc(en.name)}">▼</button></span>` : Math.round(n0(en.init))}</div>
        <div><b>${esc(en.name)}</b>${en.hidden ? ' <span class="muted">(hidden)</span>' : ''}${ch ? ` <span class="muted">· ${esc((S.st.players[ch.owner] || {}).name || '')}</span>` : ''}
          <div>${(en.conditions || []).map((c, ci) => `<span class="chip" title="${esc(R.CONDITIONS[c] || '')}">${esc(c)}${fxNote(en.charId ? { char: en.charId } : { entry: en.id }, c)}${gm || canHp ? `<button data-cact="rm-cond" data-ci="${ci}">✕</button>` : ''}</span>`).join('')}
          ${gm || canHp ? `<select data-cf="add-cond" style="font-size:12px;padding:1px 4px"><option value="">+ condition</option>${Object.keys(R.CONDITIONS).map(c => `<option>${c}</option>`).join('')}</select>` : ''}</div></div>
        <div class="hp">${hp !== '' ? (canHp ? `HP <input data-cf="hp" value="${esc(hp)}" title="Type a number, or -7 / +5">` : `HP ${esc(hp)}`) + (en.maxHp != null ? ` <span class="muted">/ ${n0(en.maxHp)}</span>` : '') + (temp > 0 ? ` <span class="hp-temp" title="${temp} temporary hit point${temp === 1 ? '' : 's'}">+${temp}</span>` : '') : ''}</div>
        <div class="muted">${en.ac != null ? 'AC ' + esc(en.ac) : ''}</div>
        <div>${gm && en.tpl ? `<button class="btn tiny" data-cact="npccard" title="Your NPC: attacks and notes">📜</button> ` : ''}${gm && en.sb ? `<button class="btn tiny" data-cact="statblock" title="${esc(en.sb)} stat block">📜</button> <select class="sb-save" data-cf="save" title="Roll this creature's saving throw (GM-only). Shift: advantage, Ctrl: disadvantage" aria-label="Roll a saving throw for ${esc(en.name)}"><option value="">Save…</option>${['str', 'dex', 'con', 'int', 'wis', 'cha'].map(k => `<option value="${k}">${k.toUpperCase()}</option>`).join('')}</select> ` : ''}${gm ? `<button class="btn tiny" data-cact="hide" title="Toggle hidden">${en.hidden ? '👁' : '◌'}</button> <button class="btn tiny ghost" data-cact="remove">✕</button>` : ''}</div></div>`;
    }).join('') || '<p class="muted">No combatants yet. Players: click “Roll initiative” on your sheet. GM: add enemies above.</p>'}</div>`;
    el.innerHTML = html;
    if (gm && window.HTB) HTB.renderEncounter($('#encDiff'), ini.entries, S.st.characters, clientId);
  }
  $('#combat').addEventListener('click', async e => {
    const b = e.target.closest('[data-cact]'); if (!b) return;
    const row = b.closest('.init-row'), id = row && row.dataset.id, a = b.dataset.cact;
    const en = id && S.st.initiative.entries.find(x => x.id === id);
    if (a === 'start') act('init.start');
    if (a === 'next') act('init.next');
    if (a === 'prev') act('init.prev');
    if (a === 'clear' && confirm('End combat and clear the initiative order?')) act('init.clear');
    if (a === 'remove') act('init.remove', { id });
    if (a === 'add-creature') HTB.openMonsterPicker();
    if (a === 'statblock' && en && en.sb) HTB.openStatBlock(en.sb);
    if (a === 'npccard' && en && en.tpl) openNpcCard(en.tpl, en.name);
    if (a === 'npc-tpl') openNpcEditor((S.st.npcs || []).find(t => t.id === S.npcTpl) || { name: $('#npcName').value.trim(), bonus: +$('#npcBonus').value || 0, hp: +$('#npcHp').value || 1, ac: +$('#npcAc').value || 10, attacks: [], notes: '' });
    if (a === 'hide') act('init.update', { id, fields: { hidden: !en.hidden } });
    if (a === 'init-up' || a === 'init-down') { // GM's fixed ▲/▼ beside the number: step by 1 from what the field shows
      const box = row.querySelector('[data-cf="init"]'), v = n0(box.value) + (a === 'init-up' ? 1 : -1);
      box.value = v;
      act('init.update', { id, fields: { init: v } });
    }
    if (a === 'rm-cond') { const c = (en.conditions || []).slice(); c.splice(+b.dataset.ci, 1); act('init.update', { id, fields: { conditions: c } }); }
    if (a === 'roll-init') {
      const ch = S.st.characters[b.dataset.id], bonus = R.initiative(ch), mode = rollModeFromEvent(e);
      let expr = d20(bonus); if (mode === 'adv') expr = expr.replace('1d20', '2d20kh1'); if (mode === 'dis') expr = expr.replace('1d20', '2d20kl1');
      act('init.add', { charId: ch.id, name: ch.name, bonus, expr });
    }
    if (a === 'add-npc') {
      const name = $('#npcName').value.trim() || 'Enemy', count = Math.max(1, Math.min(20, +$('#npcCount').value || 1));
      for (let k = 1; k <= count; k++) {
        const nm = count > 1 ? `${name} ${k}` : name;
        await act('init.add', { name: nm, bonus: +$('#npcBonus').value || 0, hp: +$('#npcHp').value || null, ac: +$('#npcAc').value || null, hidden: $('#npcHidden').checked, tpl: S.npcTpl || undefined });
        if ($('#npcToken').checked) await act('token.add', { name: nm, color: '#ef5350', x: 2 * k, y: 2, hidden: $('#npcHidden').checked, nameHidden: $('#npcNameHidden').checked });
      }
    }
  });
  $('#combat').addEventListener('change', e => {
    if (e.target.id === 'npcTpl') {   // one of the GM's NPCs fills the form (9.9)
      const tp = (S.st.npcs || []).find(x => x.id === e.target.value);
      S.npcTpl = tp ? tp.id : null;
      if (tp) { $('#npcName').value = tp.name; $('#npcBonus').value = tp.bonus; $('#npcHp').value = tp.hp; $('#npcAc').value = tp.ac; }
      const b = $('[data-cact="npc-tpl"]'); if (b) b.textContent = tp ? '💾 Edit NPC…' : '💾 Save as NPC…';
      return;
    }
    const t = e.target, cf = t.dataset.cf; if (!cf) return;
    const id = t.closest('.init-row').dataset.id, en = S.st.initiative.entries.find(x => x.id === id);
    if (cf === 'save') { if (t.value && en && en.sb) HTB.rollCreatureSave(en.sb, t.value, en.name, e); t.value = ''; return; }
    if (cf === 'init') act('init.update', { id, fields: { init: +t.value || 0 } });
    if (cf === 'hp') {
      const v = t.value.trim(); let n;
      if (/^-\d+$/.test(v)) act('init.update', { id, fields: { damage: -parseInt(v, 10) } });   // on the server: temporary HP first (#107)
      else {
        if (/^\+\d+$/.test(v)) n = (+en.hp || 0) + parseInt(v, 10); else n = parseInt(v, 10);
        if (!isNaN(n)) act('init.update', { id, fields: { hp: Math.max(0, n) } });
      }
      t.blur();
    }
    if (cf === 'add-cond' && t.value) act('init.update', { id, fields: { conditions: [...new Set([...(en.conditions || []), t.value])] } });
  });

  // --------------------------------------------------------------------------- map
  const canvas = $('#mapCanvas'), ctx = canvas.getContext('2d');
  const M = { drag: null, sel: null, selProp: null };
  const DD_PX = 256; // Dungeondraft draws assets at 256 px per grid square
  const UI_FONT = '"Exo 2", "Segoe UI", sans-serif';
  const imgCache = {};
  function img(src) {
    src = imgUrl(src);
    if (!src) return null;
    let im = imgCache[src];
    if (!im) { im = imgCache[src] = new Image(); im.onload = () => drawMap(); im.src = src; }
    return im.complete && im.naturalWidth ? im : null;
  }

  // The map is an endless grid you can pan (drag empty space, or middle-drag anywhere) and zoom
  // (mouse wheel, trackpad pinch, two-finger pinch, or the buttons). One square is 70 px at 100%,
  // like most VTTs. The board (cols x rows) is where the background image and floor are drawn.
  // The view always opens fitted to the board (whatever size the GM set), and refits when the board's size
  // changes, the scene changes, or the screen resizes, unless this person has zoomed or panned since.
  const CAM = { x: 40, y: 40, z: 1, ready: false, fitted: false, key: '' };
  const ZMIN = 0.05, ZMAX = 3;
  try { localStorage.removeItem('holo.cam'); } catch { /* storage blocked */ }   // the old saved camera isn't used any more
  const saveCam = () => { CAM.fitted = false; };   // the person moved the view themselves
  function viewSize() { const w = $('#mapWrap'); return { w: w.clientWidth || 800, h: w.clientHeight || 600 }; }
  function zoomAt(sx, sy, factor) {
    const z = Math.max(ZMIN, Math.min(ZMAX, CAM.z * factor));
    CAM.x = sx - (sx - CAM.x) * (z / CAM.z); CAM.y = sy - (sy - CAM.y) * (z / CAM.z); CAM.z = z;
    saveCam(); drawMap(); updateZoomLabel();
  }
  function fitBoard() {
    const mp = S.st.map, g = mp.gridSize, { w, h } = viewSize();
    const pad = Math.min(40, Math.round(Math.min(w, h) * 0.04));   // a small margin, smaller on phones
    const z = Math.max(ZMIN, Math.min(ZMAX, Math.min((w - 2 * pad) / (mp.cols * g), (h - 2 * pad) / (mp.rows * g))));
    CAM.z = z; CAM.x = (w - mp.cols * g * z) / 2; CAM.y = (h - mp.rows * g * z) / 2;
    CAM.fitted = true; CAM.ready = true; drawMap(); updateZoomLabel();
  }
  function updateZoomLabel() { const l = $('#zoomPct'); if (l) l.textContent = Math.round(CAM.z * 100) + '%'; }

  function sceneBar() {
    const scenes = S.st.scenes || [], cur = S.st.scene;
    if (!isGM()) return cur ? `<span class="scene-name" title="Current scene">📍 ${esc(cur.name)}</span>` : '';
    return `<span class="scene-bar"><label class="mini" title="Pick a scene to show it to everyone">Scene
        <select data-mact-change="scene"><option value="">${scenes.length ? '— pick a scene —' : '— no scenes yet —'}</option>
        ${scenes.map(x => `<option value="${esc(x.id)}" ${cur && cur.id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      ${cur ? '<button class="btn small" data-mact="scene-save" title="Save the map into this scene">💾 Save</button>' : ''}
      <button class="btn small" data-mact="scene-saveas" title="Save the map as a new named scene">＋ Save as new</button>
      <button class="btn small ghost" data-mact="scene-new" title="Start an empty board as a new scene">New blank</button>
      ${cur ? `<button class="btn small ghost" data-mact="scene-rename" title="Rename this scene">✎</button>
        <button class="btn small ghost" data-mact="scene-delete" title="Delete this scene">🗑</button>` : ''}</span>`;
  }
  function renderMapTools() {
    const mp = S.st.map, gm = isGM(), sc = selChar();
    $('#mapTools').innerHTML = `${sceneBar()}<span class="tool-break"></span>
      ${sc && canEdit(sc) ? `<button class="btn small" data-mact="place">◉ Place ${esc(sc.name)}</button>` : ''}
      <span class="zoom-ctl"><button class="btn small" data-mact="zout" title="Zoom out">−</button><button class="btn small" data-mact="z100" id="zoomPct" title="Back to 100% (70 px squares)">${Math.round(CAM.z * 100)}%</button><button class="btn small" data-mact="zin" title="Zoom in">＋</button>
        <button class="btn small" data-mact="zfit" title="Fit the whole map in view">⤢ Fit</button></span>
      ${gm ? `<button class="btn small ${A.open ? 'primary' : ''}" data-mact="assets">📦 Assets</button><span class="spacer"></span>
        <button class="btn small" data-mact="bg">🖼 Background…</button>${mp.bgVersion && mp.bgUrl ? '<button class="btn small ghost" data-mact="clear-bg">clear</button>' : ''}
        ${mp.floor ? '<button class="btn small ghost" data-mact="clear-floor">clear floor</button>' : ''}
        ${(mp.props || []).length ? `<button class="btn small ghost" data-mact="clear-props">clear ${n0(mp.props.length)} props</button>` : ''}
        <button class="btn small" data-mact="fit" title="Set the board size to match the background image">Fit board</button>
        <label class="mini" title="Background image pixels per square">px/sq <input type="number" value="${n0(mp.gridSize)}" data-mset="gridSize"></label>
        <label class="mini">cols <input type="number" value="${n0(mp.cols)}" data-mset="cols"></label>
        <label class="mini">rows <input type="number" value="${n0(mp.rows)}" data-mset="rows"></label>
        <label class="toggle"><input type="checkbox" data-mset="showGrid" ${mp.showGrid ? 'checked' : ''}> grid</label>
        <button class="btn small ${M.drawMode ? 'primary' : ''}" data-mact="draw" title="Draw on the map for everyone to see (drag). Double-click anywhere to ping.">✎ Draw</button>${M.drawMode ? `<span class="draw-colors">${['#ffd27a', '#4fc3f7', '#ef5350', '#66bb6a', '#ffffff'].map(c => `<button class="draw-col ${M.drawColor === c ? 'on' : ''}" data-mact="dcol" data-c="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</span>` : ''}${(mp.drawings || []).length ? `<button class="btn small ghost" data-mact="draw-clear">clear drawings</button>` : ''}
        <button class="btn small" data-mact="npc">＋ Token</button>${window.HTC && HTC.wallsButton ? HTC.wallsButton() : ''}
        ${mp.tokens.some(t => t.moves) || (mp.props || []).some(x => x.moves) ? '<button class="btn small amber" data-mact="play-moves" title="Play the scene movements on this board now, for everyone">▶ Play movements</button>' : ''}
        <input type="file" id="bgFile" accept="image/*" hidden>` : '<span class="muted">Drag your token to move it · drag empty space to pan · scroll to zoom · double-click to ping</span>'}`;
  }
  $('#mapTools').addEventListener('click', async e => {
    const b = e.target.closest('[data-mact]'); if (!b) return;
    const a = b.dataset.mact, { w, h } = viewSize();
    if (a === 'zin') zoomAt(w / 2, h / 2, 1.25);
    if (a === 'zout') zoomAt(w / 2, h / 2, 0.8);
    if (a === 'z100') zoomAt(w / 2, h / 2, 1 / CAM.z);
    if (a === 'zfit') fitBoard();
    if (a === 'draw') { M.drawMode = !M.drawMode; M.drawColor = M.drawColor || '#ffd27a'; canvas.classList.toggle('drawing', M.drawMode); renderMapTools(); }
    if (a === 'dcol') { M.drawColor = b.dataset.c; renderMapTools(); }
    if (a === 'draw-clear' && confirm('Clear every drawing on this map?')) act('map.drawClear', {});
    if (a === 'place') {   // drop the token in the middle of what you're looking at
      const g = S.st.map.gridSize;
      await act('token.add', { charId: S.selected, x: Math.floor((w / 2 - CAM.x) / CAM.z / g), y: Math.floor((h / 2 - CAM.y) / CAM.z / g) });
    }
    if (a.startsWith('scene-')) return sceneAction(a);
    if (a === 'play-moves') { const r = await act('scene.play'); if (r) toast(`${r.moved} piece${r.moved > 1 ? 's' : ''} moving`); }
    if (a === 'assets') { A.open = !A.open; renderMapTools(); renderDrawer(); requestAnimationFrame(drawMap); }
    if (a === 'bg') $('#bgFile').click();
    if (a === 'clear-bg') act('map.bg', { url: null });
    if (a === 'clear-floor') act('map.floor', { src: null });
    if (a === 'clear-props' && confirm('Remove every prop from this map?')) act('prop.clear');
    if (a === 'fit' && S.mapImg) act('map.settings', { cols: Math.round(S.mapImg.width / S.st.map.gridSize), rows: Math.round(S.mapImg.height / S.st.map.gridSize) });
    if (a === 'npc') {
      const name = prompt('Token name', 'Enemy'); if (!name) return;
      const g = S.st.map.gridSize;
      act('token.add', { name, color: '#ef5350', x: Math.floor((w / 2 - CAM.x) / CAM.z / g), y: Math.floor((h / 2 - CAM.y) / CAM.z / g) });
    }
  });
  async function sceneAction(a) {
    const cur = S.st.scene;
    if (a === 'scene-save' && cur) { if (await act('scene.save')) toast(`Saved “${cur.name}”`); }
    if (a === 'scene-saveas' || a === 'scene-new') {
      const name = prompt(a === 'scene-new' ? 'Name for the new, empty scene:' : 'Name this scene:', ''); if (name === null) return;
      if (await act(a === 'scene-new' ? 'scene.new' : 'scene.saveAs', { name: name.trim() || 'Untitled scene' })) toast(a === 'scene-new' ? 'New scene ready' : 'Scene saved');
    }
    if (a === 'scene-rename' && cur) { const name = prompt('Rename the scene:', cur.name); if (name && name.trim()) act('scene.rename', { id: cur.id, name: name.trim() }); }
    if (a === 'scene-delete' && cur && confirm(`Delete the scene “${cur.name}”? The map on screen stays; only the saved scene is removed.`)) act('scene.delete', { id: cur.id });
  }
  $('#mapTools').addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.mactChange === 'scene') {
      if (!t.value) return;
      if (await act('scene.load', { id: t.value })) toast('Scene changed for everyone');
      return;
    }
    if (t.id === 'bgFile' && t.files[0]) {
      toast('Uploading map…');
      try {
        const { dataUrl, w, h } = await fitUpload(t.files[0], 4096);
        const up = await post('upload', { purpose: 'bg', dataUrl });
        await act('map.bg', { url: up.url });
        act('map.settings', { cols: Math.max(5, Math.round(w / S.st.map.gridSize)), rows: Math.max(5, Math.round(h / S.st.map.gridSize)) });
      } catch (err) { toast(err.message || 'Could not read that image', true); }
    }
    if (t.dataset.mset) act('map.settings', { [t.dataset.mset]: t.type === 'checkbox' ? t.checked : +t.value });
  });
  // --------------------------------------------------------------------------- scene wipes
  // Classic film-style screen wipes when the GM changes the scene. The old board is snapshotted onto an overlay,
  // the new one is drawn underneath, then the overlay is wiped away. The server picks the style, so everyone
  // sees the same one. Skipped when the map isn't on screen, and (unless switched on in 🎨) on devices set to reduce motion.
  const WIPE_MS = 1100;
  const wipeCanvas = document.createElement('canvas');
  wipeCanvas.id = 'wipeCanvas'; wipeCanvas.setAttribute('aria-hidden', 'true');
  $('#mapWrap').appendChild(wipeCanvas);
  const WIPE = { id: 0 };
  // By default the wipes follow the device's "reduce motion" setting; each person's 🎨 switch overrides it either way.
  const wipesOn = () => {
    const v = store.get('holo.wipes', null);
    if (v === 'on' || v === 'off') return v === 'on';
    return !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  };
  // Returns false when no wipe plays; otherwise calls onDone once the old board is gone.
  function startWipe(kind, onDone) {
    if (S.tab !== 'map' || !canvas.width || !canvas.height || !wipesOn() || document.hidden) return false;
    const old = document.createElement('canvas');
    old.width = canvas.width; old.height = canvas.height;
    old.getContext('2d').drawImage(canvas, 0, 0);
    wipeCanvas.width = canvas.width; wipeCanvas.height = canvas.height;
    wipeCanvas.style.width = canvas.style.width; wipeCanvas.style.height = canvas.style.height;
    const w = wipeCanvas.getContext('2d');
    paintWipe(w, old, kind, 0);
    wipeCanvas.classList.add('on');
    const id = ++WIPE.id, waitFrom = performance.now();
    let done = false;
    const finish = () => { if (done) return; done = true; wipeCanvas.classList.remove('on'); if (onDone) onDone(); };
    const go = () => {
      if (id !== WIPE.id) return finish();
      // give the new scene's background a moment to load (at most 1.5 s) so the wipe reveals it, not a blank board
      const bg = S.st && imgUrl(S.st.map.bgUrl);
      if (bg && !(S.mapImg && S.mapImg.complete && S.mapImg.src.endsWith(bg)) && performance.now() - waitFrom < 1500) return setTimeout(go, 60);
      const t0 = performance.now();
      const frame = t => {
        if (id !== WIPE.id || done) return;
        const p = Math.min(1, (t - t0) / WIPE_MS), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        paintWipe(w, old, kind, e);
        if (p < 1) requestAnimationFrame(frame); else finish();
      };
      requestAnimationFrame(frame);
      // never leave the old scene covering the new one (e.g. a background tab where animation frames pause)
      setTimeout(() => { if (id === WIPE.id && !done) { WIPE.id++; finish(); } }, WIPE_MS + 400);
    };
    setTimeout(go, 80);
    return true;
  }

  // --------------------------------------------------------------------------- scene movements
  // After a scene change (or the GM's ▶ Play), scripted pieces walk their waypoints for everyone. The server has
  // already put them where they end; here each one is drawn along its path from where it started.
  const ANIM = { pos: {}, id: 0 };
  const MOVE_SPEED = 4;   // squares per second
  function playSceneFx(fx) {
    const moves = (fx.moves || []).filter(m => m && m.from && Array.isArray(m.path) && m.path.length);
    const animate = moves.length && S.tab === 'map' && !document.hidden;
    if (animate) for (const m of moves) ANIM.pos[m.id] = { x: n0(m.from.x), y: n0(m.from.y) };   // start spots, under the wipe
    const go = () => (animate ? startMoves(moves) : null);
    if (fx.k >= 0 && startWipe(fx.k, go)) return;
    go();
  }
  function startMoves(moves) {
    const id = ++ANIM.id;
    const plans = moves.map(m => {
      const pts = [m.from, ...m.path].map(q => ({ x: n0(q.x), y: n0(q.y) })), segs = [];
      let total = 0;
      for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(d); total += d; }
      // asset pieces that "face their path" turn by however much each leg's heading differs from the first leg's
      const heads = segs.map((d, i) => Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x) * 180 / Math.PI);
      const first = heads.find((h, i) => segs[i] > 0);
      const rots = m.face && first !== undefined ? heads.map((h, i) => (segs[i] > 0 ? n0(m.rot0) + h - first : null)) : null;
      if (rots) for (let i = 0; i < rots.length; i++) if (rots[i] === null) rots[i] = i ? rots[i - 1] : n0(m.rot0);
      return { id: m.id, pts, segs, total, rots, rot0: n0(m.rot0), start: Math.min(20, n0(m.delay)) * 1000, dur: Math.max(300, total / MOVE_SPEED * 1000) };
    });
    const end = Math.max(...plans.map(q => q.start + q.dur)), t0 = performance.now();
    const stop = () => { if (id !== ANIM.id) return; ANIM.id++; ANIM.pos = {}; drawMap(); };
    const frame = now => {
      if (id !== ANIM.id) return;
      const el = now - t0;
      for (const q of plans) {
        const f = Math.max(0, Math.min(1, (el - q.start) / q.dur));
        let d = f * q.total, i = 0;
        while (i < q.segs.length - 1 && d > q.segs[i]) { d -= q.segs[i]; i++; }
        const a = q.pts[i], b = q.pts[i + 1] || a, k = q.segs[i] ? Math.min(1, d / q.segs[i]) : 1;
        const at = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        if (q.rots) {   // ease into each new heading over the first part of the leg
          const prev = i ? q.rots[i - 1] : q.rots[0], next = q.rots[i];
          const turn = ((next - prev + 540) % 360) - 180, ease = Math.min(1, k / 0.35);
          at.rot = prev + turn * (f >= 1 ? 1 : ease);
        }
        ANIM.pos[q.id] = at;
      }
      drawMap();
      if (el < end) requestAnimationFrame(frame); else stop();
    };
    requestAnimationFrame(frame);
    setTimeout(stop, end + 1500);   // in case animation frames are paused
  }

  // The GM records a token's movement by clicking squares (waypoints), then picks an exit and a delay.
  const scriptBar = document.createElement('div');
  scriptBar.className = 'script-bar hidden';
  $('#mapWrap').appendChild(scriptBar);
  const EXIT_NAMES = { '': 'stays on the board', n: '↑ off the top', s: '↓ off the bottom', e: '→ off the right', w: '← off the left' };
  function startScript(t, kind = 'token') {
    const m = t.moves || {};
    M.script = { kind, id: t.id, name: t.name || (kind === 'prop' ? 'Asset' : 'Token'), path: (m.path || []).map(q => ({ x: q.x, y: q.y })),
      exit: m.exit || '', delay: n0(m.delay), face: !!m.face, when: m.when === 'combat' ? 'combat' : 'scene' };
    renderScriptBar(); drawMap();
  }
  function renderScriptBar() {
    const sc = M.script;
    scriptBar.classList.toggle('hidden', !sc);
    if (!sc) { scriptBar.innerHTML = ''; return; }
    scriptBar.innerHTML = `<b>🎬 ${esc(sc.name || 'Token')}</b><span class="muted">Click squares to add waypoints (${sc.path.length}/12).</span>
      <label class="mini">Then <select data-sb="exit">${Object.entries(EXIT_NAMES).map(([k, v]) => `<option value="${k}" ${k === sc.exit ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="mini" title="When this movement plays">Plays <select data-sb="when">
        <option value="scene" ${sc.when !== 'combat' ? 'selected' : ''}>after the next scene change</option>
        <option value="combat" ${sc.when === 'combat' ? 'selected' : ''}>⚔ when combat starts</option></select></label>
      <label class="mini">Wait <input type="number" min="0" max="20" step="0.5" value="${n0(sc.delay)}" data-sb="delay"> s</label>
      ${sc.kind === 'prop' ? `<label class="toggle" title="Point the piece along its first leg; it turns at each waypoint as it goes"><input type="checkbox" data-sb="face" ${sc.face ? 'checked' : ''}> Turn to face its path</label>` : ''}
      <button class="btn tiny" data-sb="undo" ${sc.path.length ? '' : 'disabled'}>Undo</button><button class="btn tiny ghost" data-sb="clear">Clear</button>
      <button class="btn tiny primary" data-sb="save">Save</button><button class="btn tiny ghost" data-sb="cancel">Cancel</button>`;
  }
  scriptBar.addEventListener('click', async e => {
    const a = e.target.dataset.sb, sc = M.script; if (!a || !sc) return;
    if (a === 'undo') sc.path.pop();
    if (a === 'clear') { sc.path = []; sc.exit = ''; }
    if (a === 'cancel') M.script = null;
    if (a === 'save') {
      const has = sc.path.length || sc.exit;
      if (await act(sc.kind === 'prop' ? 'prop.script' : 'token.script', { id: sc.id, moves: has ? { path: sc.path, exit: sc.exit, delay: sc.delay, face: sc.face, when: sc.when } : null })) {
        const plays = sc.when === 'combat' ? 'when combat starts (Start in initiative, or the combat view switched on)' : 'when this scene is next loaded';
        toast(has ? `${sc.name}'s movement saved. It plays ${plays}, or with ▶ Play movements.` : `${sc.name}'s movement cleared`);
        M.script = null;
      }
    }
    renderScriptBar(); drawMap();
  });
  scriptBar.addEventListener('change', e => {
    const a = e.target.dataset.sb, sc = M.script; if (!sc) return;
    if (a === 'exit') sc.exit = e.target.value;
    if (a === 'delay') sc.delay = Math.max(0, Math.min(20, n0(e.target.value)));
    if (a === 'face') sc.face = e.target.checked;
    if (a === 'when') sc.when = e.target.value === 'combat' ? 'combat' : 'scene';
    drawMap();
  });
  // GM only: dashed paths for every scripted token (and the one being recorded)
  function drawScripts(g, z) {
    const mp = S.st.map, list = [];
    for (const t of [...mp.tokens, ...(mp.props || [])]) {
      const sc = M.script && M.script.id === t.id ? M.script : t.moves;
      if (sc && (sc.path.length || sc.exit)) list.push([t, sc, M.script && M.script.id === t.id]);
    }
    for (const [t, sc, live] of list) {
      const prop = t.w !== undefined, sz = t.size || 1;
      const start = prop ? { x: (t.x + t.w / 2) * g, y: (t.y + t.h / 2) * g } : { x: (t.x + sz / 2) * g, y: (t.y + sz / 2) * g };
      const c = q => (prop ? { x: (q.x + 0.5) * g, y: (q.y + 0.5) * g } : { x: (q.x + sz / 2) * g, y: (q.y + sz / 2) * g });
      const pts = [start, ...sc.path.map(c)];
      const last = pts[pts.length - 1], amber = sc.when === 'combat' ? themeHex('red', '#ef5350') : themeHex('amber', '#ffb74d');   // red: waits for combat
      ctx.save();
      ctx.strokeStyle = live ? amber : rgba(amber, 0.55); ctx.lineWidth = 3 / z; ctx.setLineDash([8 / z, 6 / z]);
      ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      let tip = null;
      if (sc.exit) {   // an arrow off the edge of the board
        const W = mp.cols * g, H = mp.rows * g;
        tip = { n: { x: last.x, y: -g }, s: { x: last.x, y: H + g }, w: { x: -g, y: last.y }, e: { x: W + g, y: last.y } }[sc.exit];
        if (tip) ctx.lineTo(tip.x, tip.y);
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (tip) {
        const ang = Math.atan2(tip.y - last.y, tip.x - last.x), L = 14 / z;
        ctx.fillStyle = live ? amber : rgba(amber, 0.55); ctx.beginPath();
        ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x - L * Math.cos(ang - 0.5), tip.y - L * Math.sin(ang - 0.5)); ctx.lineTo(tip.x - L * Math.cos(ang + 0.5), tip.y - L * Math.sin(ang + 0.5)); ctx.fill();
      }
      pts.slice(1).forEach((q, i) => {
        ctx.beginPath(); ctx.arc(q.x, q.y, 10 / z, 0, Math.PI * 2); ctx.fillStyle = live ? amber : rgba(amber, 0.55); ctx.fill();
        ctx.fillStyle = '#111'; ctx.font = `bold ${11 / z}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), q.x, q.y + 0.5 / z);
      });
      const cue = [sc.when === 'combat' ? '⚔ combat' : '', n0(sc.delay) ? `🎬 after ${n0(sc.delay)} s` : ''].filter(Boolean).join(' · ');
      if (cue) { ctx.fillStyle = amber; ctx.font = `600 ${11 / z}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.fillText(cue, pts[0].x, pts[0].y - ((prop ? t.h : sz) * g) / 2 - 8 / z); }
      ctx.restore();
    }
  }

  // Draw the old board with the part already wiped (progress e, 0..1) cut away.
  function paintWipe(w, old, kind, e) {
    const W = wipeCanvas.width, H = wipeCanvas.height, soft = Math.max(W, H) * 0.05;
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalCompositeOperation = 'source-over';
    w.clearRect(0, 0, W, H);
    w.drawImage(old, 0, 0);
    if (e <= 0) return;
    w.globalCompositeOperation = 'destination-out';
    w.fillStyle = '#000';
    // a straight wipe at `angle` (0 = left to right) with a soft edge
    const linear = angle => {
      const a = angle * Math.PI / 180, L = Math.abs(W * Math.cos(a)) + Math.abs(H * Math.sin(a)), Mx = Math.abs(W * Math.sin(a)) + Math.abs(H * Math.cos(a));
      w.translate(W / 2, H / 2); w.rotate(a);
      const pos = -L / 2 + e * (L + soft);
      const g = w.createLinearGradient(pos - soft, 0, pos, 0);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      w.fillRect(-L / 2 - 2, -Mx / 2 - 2, Math.max(0, pos - soft + L / 2 + 2), Mx + 4);
      w.fillStyle = g; w.fillRect(pos - soft, -Mx / 2 - 2, soft, Mx + 4);
    };
    const R = Math.hypot(W, H) / 2;
    switch (kind) {
      case 0: linear(0); break;          // left to right
      case 1: linear(180); break;        // right to left
      case 2: linear(90); break;         // top to bottom
      case 3: linear(270); break;        // bottom to top
      case 4: linear(35); break;         // diagonal
      case 5:                            // clock wipe, sweeping from 12 o'clock
        w.beginPath(); w.moveTo(W / 2, H / 2); w.arc(W / 2, H / 2, R + 4, -Math.PI / 2, -Math.PI / 2 + e * Math.PI * 2); w.closePath(); w.fill(); break;
      case 6:                            // iris opening from the centre
        w.beginPath(); w.arc(W / 2, H / 2, e * (R + 4), 0, Math.PI * 2); w.fill(); break;
      default: {                         // barn doors, opening from the middle
        const hw = e * (W / 2 + 4); w.fillRect(W / 2 - hw, 0, hw * 2, H);
      }
    }
    w.setTransform(1, 0, 0, 1, 0, 0);
    w.globalCompositeOperation = 'source-over';
  }

  async function loadMapBg() {
    const sid = S.st.map.sceneId || '';
    if (S.sceneSeen !== undefined && S.sceneSeen !== sid) { CAM.ready = false; requestAnimationFrame(drawMap); }
    S.sceneSeen = sid;
    const v = S.st.map.bgVersion;
    if (v === S.mapBgVersion) return;
    S.mapBgVersion = v;
    const data = imgUrl(S.st.map.bgUrl);
    if (!data) { S.mapImg = null; drawMap(); return; }
    const im = new Image(); im.onload = () => { S.mapImg = im; drawMap(); }; im.src = data;
  }

  function propAt(x, y) {
    const g = S.st.map.gridSize;
    return (S.st.map.props || []).slice().reverse().find(p => {
      // test in the prop's rotated frame
      const cx = (p.x + p.w / 2) * g, cy = (p.y + p.h / 2) * g, r = -(p.rot || 0) * Math.PI / 180;
      const dx = x - cx, dy = y - cy, lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
      return Math.abs(lx) <= p.w * g / 2 && Math.abs(ly) <= p.h * g / 2;
    });
  }

  function drawMap() {
    if (!S.st || S.tab !== 'map') return;
    const mp = S.st.map, g = mp.gridSize, W = mp.cols * g, H = mp.rows * g, dpr = window.devicePixelRatio || 1;
    const { w: vw, h: vh } = viewSize();
    const key = `${mp.cols}x${mp.rows}@${g}`;
    if (key !== CAM.key) { CAM.key = key; CAM.ready = false; }   // first open, or the GM resized the board
    if (!CAM.ready) {
      if (!$('#mapWrap').clientWidth) return;   // not laid out yet; the resize observer draws again once it is
      fitBoard(); return;
    }
    if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
      canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
      canvas.style.width = vw + 'px'; canvas.style.height = vh + 'px';
    }
    const z = CAM.z, MC = mapColors();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = MC.bg; ctx.fillRect(0, 0, vw, vh);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * CAM.x, dpr * CAM.y);
    // the board: floor texture and background image
    ctx.fillStyle = MC.board; ctx.fillRect(0, 0, W, H);
    const fl = img(mp.floor);
    if (fl) {
      const pat = ctx.createPattern(fl, 'repeat'), s = (g / DD_PX) * (mp.floorScale || 1);
      pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
      ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
    }
    if (S.mapImg) ctx.drawImage(S.mapImg, 0, 0, W, H);
    // the grid fills the whole view, not just the board
    if (mp.showGrid) {
      const x0 = Math.floor((-CAM.x / z) / g) * g, y0 = Math.floor((-CAM.y / z) / g) * g;
      const x1 = (vw - CAM.x) / z, y1 = (vh - CAM.y) / z;
      ctx.strokeStyle = MC.grid; ctx.lineWidth = 1 / z; ctx.beginPath();
      for (let x = x0; x <= x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let y = y0; y <= y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
    }
    ctx.strokeStyle = MC.edge; ctx.lineWidth = 2 / z; ctx.strokeRect(0, 0, W, H);
    // props
    for (const p of mp.props || []) {
      const drag = M.drag && M.drag.prop === p.id;
      const ap = ANIM.pos[p.id];   // mid scene-movement
      const px = drag ? M.drag.px : (ap ? ap.x : p.x) * g, py = drag ? M.drag.py : (ap ? ap.y : p.y) * g, w = p.w * g, h = p.h * g;
      const im = img(p.src);
      ctx.save(); ctx.translate(px + w / 2, py + h / 2); ctx.rotate(((ap && ap.rot !== undefined ? ap.rot : p.rot) || 0) * Math.PI / 180);
      if (im) ctx.drawImage(im, -w / 2, -h / 2, w, h); else { ctx.fillStyle = MC.ghost; ctx.fillRect(-w / 2, -h / 2, w, h); }
      if (p.blocksSight && isGM() && M.selProp !== p.id) { ctx.strokeStyle = rgba(themeHex('holo', '#4fc3f7'), 0.7); ctx.lineWidth = 2 / z; ctx.setLineDash([2 / z, 3 / z]); ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]); }
      if (M.selProp === p.id) { ctx.strokeStyle = themeHex('amber', '#ffb74d'); ctx.lineWidth = 2 / z; ctx.setLineDash([6 / z, 4 / z]); ctx.strokeRect(-w / 2, -h / 2, w, h); }
      ctx.restore();
    }
    // stamp preview
    if (A.stamp && A.hover) {
      const st = A.stamp, im = img(st.src);
      if (im) { ctx.globalAlpha = 0.6; const w = st.w * g, h = st.h * g; ctx.drawImage(im, A.hover.x - w / 2, A.hover.y - h / 2, w, h); ctx.globalAlpha = 1; }
    }
    drawDrawings(g, z);   // the GM's drawings (8.13)
    if (isGM()) drawScripts(g, z);
    if (window.HTC) HTC.under(ctx, g, z);   // combat view (reachable squares)
    // tokens
    const ini = S.st.initiative, cur = ini.active && ini.entries[ini.turn];
    for (const t of mp.tokens) {
      const drag = M.drag && M.drag.id === t.id;
      const ap = ANIM.pos[t.id];   // mid scene-movement
      const px = drag ? M.drag.px : (ap ? ap.x : t.x) * g, py = drag ? M.drag.py : (ap ? ap.y : t.y) * g, sz = (t.size || 1) * g, r = t.tiny ? sz / 4 - 1 : sz / 2 - 3;   // Tiny: half size, in its square (8.15)
      const cx = px + sz / 2, cy = py + sz / 2;
      ctx.globalAlpha = t.hidden ? 0.45 : 1;
      const isCur = cur && (cur.tok ? cur.tok === t.id : (cur.charId && cur.charId === t.charId) || (!cur.charId && cur.name !== '???' && cur.name === t.name));
      if (isCur) { ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.fillStyle = rgba(themeHex('amber', '#ffb74d'), 0.4); ctx.fill(); }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = color(t.color); ctx.fill();
      const ch = t.charId && S.st.characters[t.charId];
      const photo = ch && [ch.tokenImage, ch.image].find(u => imgUrl(u));
      const im = img(t.img || photo);
      if (im) {
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.clip();
        // library art (transparent cut-outs) fits inside the circle; photos fill it
        const s = t.img ? Math.min((r - 2) * 2 / im.width, (r - 2) * 2 / im.height) : Math.max((r * 2) / im.width, (r * 2) / im.height);
        ctx.drawImage(im, cx - im.width * s / 2, cy - im.height * s / 2, im.width * s, im.height * s); ctx.restore();
      } else {
        ctx.fillStyle = '#04121b'; ctx.font = `bold ${Math.round(sz * 0.32)}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(initials(t.name), cx, cy + 1);
      }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = (M.sel === t.id ? 3 : 2) / Math.min(1, z); ctx.strokeStyle = M.sel === t.id ? '#fff' : 'rgba(0,0,0,.6)'; ctx.stroke();
      if (ch && ch.hp && +ch.hp.max) {
        const pct = Math.max(0, Math.min(1, ch.hp.current / ch.hp.max));
        ctx.fillStyle = '#300'; ctx.fillRect(px + 4, py + sz - 6, sz - 8, 4);
        ctx.fillStyle = pct < .3 ? themeHex('red', '#ef5350') : pct < .6 ? themeHex('amber', '#ffb74d') : themeHex('green', '#66bb6a'); ctx.fillRect(px + 4, py + sz - 6, (sz - 8) * pct, 4);
      }
      if (t.elev) {   // elevation or flying height (audit 8.14): a badge at the token's top right, ↑ up, ↓ down
        const txt = `${t.elev > 0 ? '↑' : '↓'}${Math.abs(t.elev)}`;
        ctx.font = `700 ${Math.max(10 / z, g * 0.18)}px ${UI_FONT}`; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        const w = ctx.measureText(txt).width + 6 / z, h = Math.max(13 / z, g * 0.24), bx = px + sz, by = py;
        ctx.fillStyle = 'rgba(4,18,27,.85)'; ctx.fillRect(bx - w, by, w, h);
        ctx.fillStyle = themeHex('holo', '#4fc3f7'); ctx.fillText(txt, bx - 3 / z, by + 1 / z);
      }
      // a short label that fits under the token (so neighbours don't overlap); hover shows the full name
      ctx.font = `600 ${Math.max(11 / z, g * 0.2)}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const lab = shortLabel(t.name, sz - 4);
      if (t.nameHidden) ctx.globalAlpha = Math.min(ctx.globalAlpha, 0.55);   // the GM's reminder: players see "???"
      ctx.lineWidth = 3 / z; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(lab, cx, py + sz + 1); ctx.fillStyle = t.nameHidden ? themeHex('amber', '#ffb74d') : '#fff'; ctx.fillText(lab, cx, py + sz + 1);
      ctx.globalAlpha = 1;
    }
    if (window.HTC) HTC.over(ctx, g, z);    // combat view (targets, results)
    drawPings(g, z);
  }
  // ---- "look here" and the GM's quick drawings (audit 8.13)
  const PINGS = {};   // ping id -> when this screen first saw it, so each pulses once, for 2.5 s
  function drawPings(g, z) {
    const t = performance.now(); let live = false;
    for (const p of S.st.pings || []) {
      if (!PINGS[p.id]) PINGS[p.id] = t;
      const k = (t - PINGS[p.id]) / 2500; if (k >= 1) continue; live = true;
      const cx = p.x * g, cy = p.y * g, col = p.gm ? themeHex('amber', '#ffb74d') : themeHex('holo', '#4fc3f7');
      for (const off of [0, 0.33]) {
        const kk = (k + off) % 1;
        ctx.beginPath(); ctx.arc(cx, cy, g * (0.3 + 1.4 * kk), 0, Math.PI * 2);
        ctx.strokeStyle = rgba(col, 1 - kk); ctx.lineWidth = 4 / z; ctx.stroke();
      }
      ctx.font = `700 ${Math.max(11 / z, g * 0.2)}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3 / z; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(p.name || '', cx, cy - g * 0.35); ctx.fillStyle = col; ctx.fillText(p.name || '', cx, cy - g * 0.35);
    }
    if (live && !drawPings.raf) drawPings.raf = requestAnimationFrame(() => { drawPings.raf = 0; drawMap(); });
  }
  function drawDrawings(g, z) {
    const strokes = [...(S.st.map.drawings || []), ...(M.drag && M.drag.draw ? [{ c: M.drawColor, pts: M.drag.pts }] : [])];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const d of strokes) {
      if (!d.pts || d.pts.length < 4) continue;
      ctx.beginPath(); ctx.moveTo(d.pts[0] * g, d.pts[1] * g);
      for (let i = 2; i < d.pts.length; i += 2) ctx.lineTo(d.pts[i] * g, d.pts[i + 1] * g);
      ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 6 / z; ctx.stroke();
      ctx.strokeStyle = d.c || '#ffd27a'; ctx.lineWidth = 3 / z; ctx.stroke();
    }
  }
  canvas.addEventListener('dblclick', e => {   // a double-click (or double-tap) on the map pings it for everyone
    if (M.drawMode || A.stamp || M.script) return;
    const { x, y } = mapXY(e), g = S.st.map.gridSize;
    act('map.ping', { x: Math.round(x / g * 100) / 100, y: Math.round(y / g * 100) / 100 });
  });
  // the longest of: full name, first word, first word cut short, initials — that fits the token's width
  function shortLabel(name, w) {
    name = String(name || '').trim(); if (!name) return '';
    const fits = s => ctx.measureText(s).width <= w;
    if (fits(name)) return name;
    const first = name.split(/\s+/)[0];
    if (fits(first)) return first;
    for (let n = first.length - 1; n >= 3; n--) if (fits(first.slice(0, n) + '…')) return first.slice(0, n) + '…';
    return initials(name);
  }
  // hovering a token shows its full name
  function mapTip(t, e) {
    let tip = $('#mapTip');
    if (!t) { if (tip) tip.remove(); return; }
    if (!tip) { tip = document.createElement('div'); tip.id = 'mapTip'; tip.className = 'map-tip'; $('#mapWrap').appendChild(tip); }
    const unknown = !isGM() && t.name === '???';
    tip.innerHTML = unknown ? '<i>Name unknown</i>' : `${esc(t.name)}${isGM() && t.nameHidden ? '<span class="muted"> · name hidden from players</span>' : ''}`;
    const r = $('#mapWrap').getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 4) + 'px';
    tip.style.top = Math.max(4, e.clientY - r.top - 30) + 'px';
  }
  const canMove = t => isGM() || t.owner === clientId || (t.charId && S.st.characters[t.charId] && S.st.characters[t.charId].owner === clientId);
  function tokenAt(x, y) {
    const g = S.st.map.gridSize;
    return S.st.map.tokens.slice().reverse().find(t => x >= t.x * g && x < (t.x + (t.size || 1)) * g && y >= t.y * g && y < (t.y + (t.size || 1)) * g);
  }
  function screenXY(e) { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }
  function mapXY(e) { const { sx, sy } = screenXY(e); return { x: (sx - CAM.x) / CAM.z, y: (sy - CAM.y) / CAM.z }; }
  const snap = (v, e) => e.altKey ? Math.round(v * 100) / 100 : Math.round(v * 2) / 2;
  const TOK_MIN = -500, TOK_MAX = 1000;
  const capture = e => { try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ } };
  const touches = new Map(); // pointers currently down, for two-finger pinch / pan
  let pinch = null;
  canvas.addEventListener('contextmenu', e => { if (A.stamp) { e.preventDefault(); stopStamp(); } });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const { sx, sy } = screenXY(e);
    zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
  }, { passive: false });
  canvas.addEventListener('pointerdown', async e => {
    closeTokenPop();
    touches.set(e.pointerId, screenXY(e));
    if (touches.size === 2) { // second finger: start a pinch, cancel any drag
      const [a, b] = [...touches.values()];
      pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
      M.drag = null; return;
    }
    if (e.button === 1) { e.preventDefault(); M.drag = { pan: true, sx: e.clientX, sy: e.clientY, cx: CAM.x, cy: CAM.y, moved: false }; capture(e); return; }
    if (e.button !== 0) return;
    const { x, y } = mapXY(e), g = S.st.map.gridSize;
    if (M.drawMode && isGM()) { M.drag = { draw: true, pts: [x / g, y / g] }; capture(e); return; }   // the GM draws (8.13)
    if (!M.script && !A.stamp && window.HTC && HTC.down(x / g, y / g, e)) { drawMap(); return; }   // combat view
    if (M.script) {          // recording a scene movement: each click is the next waypoint
      if (M.script.path.length >= 12) return toast('That\'s the most waypoints for one piece (12).', true);
      M.script.path.push({ x: Math.floor(x / g), y: Math.floor(y / g) });
      renderScriptBar(); drawMap(); return;
    }
    if (A.stamp) {           // place from the asset browser
      const st = A.stamp;
      if (st.mode === 'token') {
        await act('token.add', { name: st.name, img: st.src, color: '#37474f', x: Math.floor(x / g), y: Math.floor(y / g), size: Math.max(1, Math.min(4, Math.round(Math.max(st.w, st.h)))) });
      } else {
        await act('prop.add', { src: st.src, name: st.name, x: snap(x / g - st.w / 2, e), y: snap(y / g - st.h / 2, e), w: st.w, h: st.h, rot: 0 });
      }
      if (!e.shiftKey && st.mode === 'token') stopStamp();
      return;
    }
    const t = tokenAt(x, y);
    M.sel = t ? t.id : null; M.selProp = null;
    if (t && canMove(t)) {
      M.drag = { id: t.id, ox: x - t.x * g, oy: y - t.y * g, px: t.x * g, py: t.y * g, moved: false };
    } else if (!t && isGM() && propAt(x, y)) {
      const p = propAt(x, y);
      M.selProp = p.id;
      M.drag = { prop: p.id, ox: x - p.x * g, oy: y - p.y * g, px: p.x * g, py: p.y * g, moved: false };
    } else if (!t) {
      M.drag = { pan: true, sx: e.clientX, sy: e.clientY, cx: CAM.x, cy: CAM.y, moved: false }; // empty space: pan
    }
    if (M.drag) capture(e);
    canvas.classList.toggle('panning', !!(M.drag && M.drag.pan));
    drawMap();
    if (t && !M.drag) showTokenPop(t, e);
  });
  canvas.addEventListener('pointermove', e => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, screenXY(e));
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy), mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
      CAM.x += mx - pinch.mx; CAM.y += my - pinch.my;
      zoomAt(mx, my, d / (pinch.d || d));
      pinch = { d, mx, my }; return;
    }
    if (A.stamp) { A.hover = mapXY(e); drawMap(); return; }
    if (!M.drag) {
      const { x, y } = mapXY(e);
      if (e.pointerType !== 'touch') mapTip(tokenAt(x, y), e);
      if (window.HTC) HTC.hover(x / S.st.map.gridSize, y / S.st.map.gridSize, e);   // combat view
      return;
    }
    mapTip(null);
    if (M.drag.draw) {
      const { x, y } = mapXY(e), g = S.st.map.gridSize, pts = M.drag.pts;
      if (pts.length < 600 && Math.hypot(x / g - pts[pts.length - 2], y / g - pts[pts.length - 1]) > 0.08) { pts.push(x / g, y / g); drawMap(); }
      return;
    }
    if (M.drag.pan) {
      const dx = e.clientX - M.drag.sx, dy = e.clientY - M.drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) M.drag.moved = true;
      CAM.x = M.drag.cx + dx; CAM.y = M.drag.cy + dy; drawMap(); return;
    }
    const { x, y } = mapXY(e);
    M.drag.px = x - M.drag.ox; M.drag.py = y - M.drag.oy; M.drag.moved = true; drawMap();
  });
  canvas.addEventListener('pointerleave', () => { mapTip(null); if (A.stamp) { A.hover = null; drawMap(); } });
  const endPointer = e => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    canvas.classList.remove('panning');
    if (!M.drag) return;
    const d = M.drag, g = S.st.map.gridSize;
    M.drag = null;
    if (d.draw) {
      if (d.pts.length >= 4) { const pts = d.pts.map(v => Math.round(v * 100) / 100); S.st.map.drawings = [...(S.st.map.drawings || []), { id: 'tmp', c: M.drawColor, pts }]; act('map.draw', { pts, c: M.drawColor }); }
      drawMap(); return;
    }
    if (d.pan) {
      if (d.moved) saveCam();
      else { const { x, y } = mapXY(e); if (!(window.HTC && HTC.tap(x / g, y / g, e))) { M.sel = null; M.selProp = null; } drawMap(); }   // combat view
      return;
    }
    if (d.prop) {
      const p = (S.st.map.props || []).find(p => p.id === d.prop);
      if (p && d.moved) { p.x = snap(d.px / g, e); p.y = snap(d.py / g, e); act('prop.update', { id: p.id, fields: { x: p.x, y: p.y } }); }
      else if (p) showPropPop(p, e);
      drawMap(); return;
    }
    const t = S.st.map.tokens.find(t => t.id === d.id);
    if (t && d.moved) {
      const was = [t.x, t.y];
      t.x = Math.max(TOK_MIN, Math.min(TOK_MAX, Math.round(d.px / g)));
      t.y = Math.max(TOK_MIN, Math.min(TOK_MAX, Math.round(d.py / g)));
      // refused (under fog, a wall in the way, #93): back where it was now, not at the next poll
      act('token.move', { id: t.id, x: t.x, y: t.y }).then(r => { if (r === null) { [t.x, t.y] = was; drawMap(); } });
    } else if (t) showTokenPop(t, e);
    drawMap();
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  // a rotated phone or resized window refits, unless this person has zoomed or panned since the last fit
  if (window.ResizeObserver) new ResizeObserver(() => { if (CAM.fitted) CAM.ready = false; drawMap(); }).observe($('#mapWrap'));
  function closeTokenPop() { const p = $('.token-pop'); if (p) p.remove(); }
  function popAt(e) {
    const wrap = $('#mapWrap'), r = wrap.getBoundingClientRect();
    const pop = document.createElement('div'); pop.className = 'token-pop';
    pop.style.left = Math.min(e.clientX - r.left + 10, r.width - 200) + 'px'; pop.style.top = Math.min(e.clientY - r.top + 10, r.height - 260) + 'px';
    wrap.appendChild(pop); return pop;
  }
  function showPropPop(p, e) {
    closeTokenPop();
    const pop = popAt(e);
    pop.innerHTML = `<b>${esc(p.name || 'Prop')}</b>
      <div class="row"><button class="btn small" data-pp="rl" title="Rotate left">⟲ 45°</button><button class="btn small" data-pp="rr" title="Rotate right">⟳ 45°</button></div>
      <div class="row"><button class="btn small" data-pp="smaller">− smaller</button><button class="btn small" data-pp="bigger">＋ bigger</button></div>
      <div class="row"><button class="btn small" data-pp="front">To front</button><button class="btn small" data-pp="back">To back</button></div>
      <button class="btn small" data-pp="dup">Duplicate</button>
      <button class="btn small ${p.blocksSight ? 'primary' : ''}" data-pp="sight" aria-pressed="${!!p.blocksSight}" title="Characters can't see through or past this piece when the fog of war is on (walls and doors already block sight)">👁 Blocks sight${p.blocksSight ? ' ✓' : ''}</button>
      <button class="btn small" data-pp="script" title="Waypoints this piece follows after the next scene change">🎬 Scene movement${p.moves ? ' ✓' : ''}…</button>
      <button class="btn small danger" data-pp="remove">Remove</button>
      <span class="muted" style="font-size:11px">Drag to move · hold Alt to place freely</span>`;
    pop.addEventListener('click', ev => {
      const a = ev.target.dataset.pp; if (!a) return;
      const f = {};
      if (a === 'rl' || a === 'rr') f.rot = ((p.rot || 0) + (a === 'rr' ? 45 : -45) + 360) % 360;
      if (a === 'smaller' || a === 'bigger') { const k = a === 'bigger' ? 1.25 : 0.8; f.w = p.w * k; f.h = p.h * k; f.x = p.x + (p.w - f.w) / 2; f.y = p.y + (p.h - f.h) / 2; }
      if (Object.keys(f).length) { Object.assign(p, f); act('prop.update', { id: p.id, fields: f }); drawMap(); return; }
      if (a === 'sight') { p.blocksSight = !p.blocksSight; act('prop.update', { id: p.id, fields: { blocksSight: p.blocksSight } }); drawMap(); }
      if (a === 'front' || a === 'back') act('prop.order', { id: p.id, dir: a });
      if (a === 'dup') act('prop.add', { ...p, moves: undefined, x: p.x + 0.5, y: p.y + 0.5 });
      if (a === 'script') { M.selProp = null; startScript(p, 'prop'); }
      if (a === 'remove') { act('prop.remove', { id: p.id }); M.selProp = null; }
      closeTokenPop();
    });
  }
  function showTokenPop(t, e) {
    closeTokenPop();
    const canEditTok = isGM() || t.owner === clientId;
    const pop = popAt(e);
    const ch = t.charId && S.st.characters[t.charId];
    pop.innerHTML = `<b>${esc(t.name)}</b>${ch ? `<span class="muted">HP ${n0(ch.hp.current)}/${n0(ch.hp.max)} · AC ${n0(ch.ac)}</span><button class="btn small" data-tp="sheet">Open sheet</button>` : ''}
      ${canEditTok ? `<label>Colour<input type="color" value="${color(t.color)}" data-tp="color"></label>
      <label>Size<select data-tp="size"><option value="tiny" ${t.tiny ? 'selected' : ''}>Tiny</option>${[1, 2, 3, 4].map(n => `<option ${!t.tiny && n === (t.size || 1) ? 'selected' : ''} value="${n}">${['Medium/Small', 'Large', 'Huge', 'Gargantuan'][n - 1]}</option>`).join('')}</select></label>
      <label title="Height above the ground in feet: flying, a balcony, a ledge (negative: below, e.g. a pit)">Elevation (ft)<input type="number" step="5" value="${n0(t.elev)}" data-tp="elev" style="width:80px"></label>
      ${isGM() && A.sel ? `<button class="btn small" data-tp="img">Use selected asset as image</button>` : ''}
      ${t.img ? '<button class="btn small ghost" data-tp="noimg">Remove image</button>' : ''}
      ${isGM() ? `<button class="btn small" data-tp="hide">${t.hidden ? 'Reveal to players' : 'Hide from players'}</button>
        <button class="btn small" data-tp="hidename" title="${t.nameHidden ? 'Players see this token as ???' : 'Players see the token but not who it is'}">${t.nameHidden ? 'Reveal name to players' : 'Hide name from players'}</button>
        <button class="btn small" data-tp="script" title="Waypoints this piece follows after the next scene change">🎬 Scene movement${t.moves ? ' ✓' : ''}…</button>` : ''}
      <button class="btn small danger" data-tp="remove">Remove token</button>` : ''}
      <button class="btn small ghost" data-tp="close">Close</button>`;
    pop.addEventListener('click', ev => {
      const a = ev.target.dataset.tp;
      if (a === 'remove') act('token.remove', { id: t.id });
      if (a === 'hide') act('token.update', { id: t.id, fields: { hidden: !t.hidden } });
      if (a === 'hidename') act('token.update', { id: t.id, fields: { nameHidden: !t.nameHidden } });
      if (a === 'img') act('token.update', { id: t.id, fields: { img: A.sel.src } });
      if (a === 'noimg') act('token.update', { id: t.id, fields: { img: null } });
      if (a === 'sheet') { S.selected = t.charId; setTab('sheet'); renderAll(); }
      if (a === 'script') startScript(t);
      if (['remove', 'hide', 'hidename', 'sheet', 'close', 'img', 'noimg', 'script'].includes(a)) closeTokenPop();
    });
    pop.addEventListener('change', ev => {
      const a = ev.target.dataset.tp;
      if (a === 'color') act('token.update', { id: t.id, fields: { color: ev.target.value } });
      if (a === 'size') act('token.update', { id: t.id, fields: ev.target.value === 'tiny' ? { size: 1, tiny: true } : { size: +ev.target.value, tiny: false } });
      if (a === 'elev') act('token.update', { id: t.id, fields: { elev: +ev.target.value || 0 } });
    });
  }

  // --------------------------------------------------------------------------- asset library (GM)
  const A = { open: false, packs: null, pack: 'all', assets: {}, cat: 'props', q: '', sel: null, stamp: null, hover: null, limit: 120 };
  async function loadPacks() {
    A.packs = (await fetch(`${API}?op=assets`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ packs: [] }))).packs || [];
    for (const p of A.packs) if (!A.assets[p.id] || A.assets[p.id].count !== p.count) {
      const j = await fetch(`${API}?op=pack&id=${encodeURIComponent(p.id)}`).then(r => r.json()).catch(() => null);
      if (j && j.assets) A.assets[p.id] = { count: p.count, list: j.assets.map(a => ({ ...a, pack: p.id })) };
    }
    for (const id of Object.keys(A.assets)) if (!A.packs.some(p => p.id === id)) delete A.assets[id];
    if (A.pack !== 'all' && !A.assets[A.pack]) A.pack = 'all';
  }
  function filtered() {
    const lists = A.pack === 'all' ? Object.values(A.assets).map(x => x.list) : [(A.assets[A.pack] || { list: [] }).list];
    const q = A.q.toLowerCase();
    return lists.flat().filter(a => (A.cat === 'all' || a.c === A.cat) && (!q || a.n.toLowerCase().includes(q)));
  }
  async function renderDrawer() {
    const el = $('#assetDrawer');
    el.classList.toggle('hidden', !(A.open && isGM()));
    if (!A.open || !isGM()) return;
    if (!A.packs) { el.innerHTML = '<p class="muted" style="padding:10px">Loading library…</p>'; await loadPacks(); }
    const cats = {};
    for (const x of (A.pack === 'all' ? Object.values(A.assets) : [A.assets[A.pack] || { list: [] }])) for (const a of x.list) cats[a.c] = (cats[a.c] || 0) + 1;
    const items = filtered();
    el.innerHTML = `<div class="ad-head">
        <div class="row"><b style="flex:1">Asset library</b><button class="btn tiny" id="adUpload" title="Dungeondraft .dungeondraft_pack, a .zip of images, or images">＋ Upload pack</button></div>
        <input type="file" id="adFile" multiple hidden>
        <div id="adProg" class="progress hidden"><div></div></div>
        <div id="adMsg" class="pack-msg hidden" role="status"></div>
        ${A.packs.length ? `<select id="adPack"><option value="all">All packs (${A.packs.reduce((s, p) => s + n0(p.count), 0)})</option>${A.packs.map(p => `<option value="${esc(p.id)}" ${p.id === A.pack ? 'selected' : ''}>${esc(p.name)} (${n0(p.count)})</option>`).join('')}</select>
        <input id="adSearch" placeholder="Search crates, consoles, doors…" value="${esc(A.q)}">
        <div class="cats">${['all', ...Object.keys(cats).sort()].map(c => `<button data-cat="${esc(c)}" class="${A.cat === c ? 'on' : ''}">${esc(c)}${c === 'all' ? '' : ' ' + n0(cats[c])}</button>`).join('')}</div>` : ''}
      </div>
      <div class="asset-grid" id="adGrid">${A.packs.length ? items.slice(0, A.limit).map((a, i) => `<div class="a ${A.sel && A.sel.src === a.src ? 'on' : ''}" data-i="${i}" title="${esc(a.n)}"><img loading="lazy" src="${esc(a.src)}" alt=""><span>${esc(a.n)}</span></div>`).join('')
        + (items.length > A.limit ? `<button class="btn small" id="adMore" style="grid-column:1/-1">Show more (${items.length - A.limit})</button>` : '')
        + (!items.length ? '<p class="muted" style="grid-column:1/-1">Nothing matches.</p>' : '')
        : `<p class="muted" style="grid-column:1/-1">No asset packs yet.<br><br>Upload a <b>Dungeondraft pack</b> (.dungeondraft_pack), a <b>.zip</b> of images, or single images. Packs are stored on this server and available in every campaign.</p>`}</div>
      ${A.sel ? `<div class="asset-sel"><b>${esc(A.sel.n)}</b><span class="muted" style="font-size:12px">${A.sel.w ? `${n0(A.sel.w)}×${n0(A.sel.h)}px · ${(n0(A.sel.w) / DD_PX).toFixed(1)}×${(n0(A.sel.h) / DD_PX).toFixed(1)} squares` : ''}</span>
        <div class="btns">
          <button class="btn small ${A.stamp && A.stamp.mode === 'prop' ? 'primary' : ''}" data-as="prop">Place as prop</button>
          <button class="btn small ${A.stamp && A.stamp.mode === 'token' ? 'primary' : ''}" data-as="token">Place as token</button>
          <button class="btn small" data-as="floor">Tile as floor</button>
          <button class="btn small" data-as="bg">Use as map</button>
        </div>
        ${A.stamp ? '<span class="muted" style="font-size:11px">Click the map to place · right-click or Esc to stop</span>' : ''}</div>` : ''}
      ${A.packs.length && A.pack !== 'all' ? `<div class="asset-sel"><button class="btn tiny danger" id="adDelete">Delete this pack from the server</button></div>` : ''}`;
  }
  function stopStamp() { A.stamp = null; A.hover = null; $('#mapWrap').classList.remove('stamping'); renderDrawer(); drawMap(); }
  function startStamp(mode) {
    const a = A.sel, w = a.w ? a.w / DD_PX : 1, h = a.h ? a.h / DD_PX : 1;
    A.stamp = { mode, src: a.src, name: a.n, w: Math.max(0.25, w), h: Math.max(0.25, h) };
    $('#mapWrap').classList.add('stamping'); renderDrawer();
  }
  $('#assetDrawer').addEventListener('click', async e => {
    const t = e.target;
    if (t.id === 'adUpload') return $('#adFile').click();
    if (t.id === 'adMore') { A.limit += 240; return renderDrawer(); }
    if (t.id === 'adDelete') {
      const p = A.packs.find(p => p.id === A.pack);
      if (p && confirm(`Delete “${p.name}” from this server? Props already placed from it will show as blank boxes.`)) {
        try { await post('packdelete', { packId: p.id }); } catch (err) { toast(err.message, true); }
      }
      return;
    }
    const c = t.closest('[data-cat]'); if (c) { A.cat = c.dataset.cat; A.limit = 120; return renderDrawer(); }
    const tile = t.closest('.a[data-i]');
    if (tile) { A.sel = filtered()[+tile.dataset.i]; startStamp('prop'); return; }
    const b = t.closest('[data-as]'); if (!b || !A.sel) return;
    const m = b.dataset.as;
    if (m === 'prop' || m === 'token') startStamp(m);
    if (m === 'floor') { await act('map.floor', { src: A.sel.src }); toast('Floor texture set'); }
    if (m === 'bg') {
      await act('map.bg', { url: A.sel.src });
      if (A.sel.w) act('map.settings', { cols: Math.max(5, Math.round(A.sel.w / DD_PX)), rows: Math.max(5, Math.round(A.sel.h / DD_PX)) });
    }
  });
  $('#assetDrawer').addEventListener('change', e => {
    if (e.target.id === 'adPack') { A.pack = e.target.value; A.cat = 'all'; A.limit = 120; renderDrawer(); }
    if (e.target.id === 'adFile') { uploadPacks([...e.target.files]); e.target.value = ''; }
  });
  $('#assetDrawer').addEventListener('input', e => {
    if (e.target.id !== 'adSearch') return;
    A.q = e.target.value; A.limit = 120;
    clearTimeout(A.qt); A.qt = setTimeout(async () => { await renderDrawer(); const s = $('#adSearch'); s.focus(); s.setSelectionRange(A.q.length, A.q.length); }, 200);
  });
  function uploadPacks(files) {
    if (!isGM()) return toast('Only the GM can add asset packs.', true);
    A.open = true; setTab('map'); renderMapTools();
    files.reduce((p, f) => p.then(() => uploadPack(f)), renderDrawer());
  }
  // Packs are unpacked in the browser (packs.js) and sent in small batches (~1.5 MB), so even a
  // 60 MB Dungeondraft pack fits through the site's per-request limits. Each batch is numbered, so
  // a retry after a timeout can't add the same images twice. Errors stay on screen and say which step failed.
  function packStatus(text, isErr) {
    const m = $('#adMsg'); if (!m) return;
    m.textContent = text || ''; m.className = 'pack-msg' + (isErr ? ' err' : '') + (text ? '' : ' hidden');
  }
  async function postRetry(op, body, what) {
    let last;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return await post(op, body); } catch (err) {
        last = err;
        // a refusal (full library, not the GM, bad file) won't change on retry; a timeout or blip might
        if (/full|GM only|isn't|Please sign in|not found|no such/i.test(err.message)) break;
        if (attempt < 3) { packStatus(`${what}: retrying (${err.message})…`); await sleep(1500 * attempt); }
      }
    }
    throw new Error(`${what} failed: ${last.message}`);
  }
  async function uploadPack(file) {
    const bar = () => $('#adProg');
    const show = (pct, label) => { const b = bar(); if (b) { b.classList.remove('hidden'); b.firstElementChild.style.width = pct + '%'; b.title = label; } packStatus(label); };
    try {
      show(0, `Reading ${file.name} (${(file.size / 1048576).toFixed(0)} MB)…`);
      let pack;
      try { pack = await window.PackReader.read(file, (i, n) => show(40 * i / n, `Preparing images ${i} / ${n}`)); }
      catch (err) { throw new Error(`Couldn't read ${file.name}: ${err.message}`); }
      const bytes = pack.items.reduce((s, it) => s + it.data.length * 0.75, 0);
      const { packId } = await postRetry('packstart', { name: pack.name, author: pack.author, bytes }, 'Starting the upload');
      const batches = [];
      let cur = [], size = 0;
      for (const it of pack.items) {
        if (cur.length && size + it.data.length > 1500000) { batches.push(cur); cur = []; size = 0; }
        cur.push(it); size += it.data.length;
      }
      if (cur.length) batches.push(cur);
      let sent = 0;
      for (let i = 0; i < batches.length; i++) {
        await postRetry('packadd', { packId, seq: i, items: batches[i] }, `Uploading batch ${i + 1} of ${batches.length}`);
        sent += batches[i].length;
        show(40 + 60 * sent / pack.items.length, `Uploading images ${sent} / ${pack.items.length}`);
      }
      const done = await postRetry('packdone', { packId }, 'Finishing the upload');
      toast(`Added “${done.pack.name}”: ${done.pack.count} images`);
      packStatus(`Added “${done.pack.name}”: ${done.pack.count} images.`);
      A.pack = packId; A.cat = 'all';
      await loadPacks();
    } catch (err) {
      toast(err.message || 'Upload failed', true);
      packStatus(err.message || 'Upload failed', true);
      const b = bar(); if (b) b.classList.add('hidden');
      await renderDrawer(); packStatus(err.message || 'Upload failed', true); // after the redraw, so it stays visible
      return;
    }
    const b = bar(); if (b) b.classList.add('hidden');
    renderDrawer();
  }

  // --------------------------------------------------------------------------- handouts
  // ---- between fights (audit section 11): factions, rivals and complications, lifestyle. The GM keeps them;
  // players see factions the GM shows and rivals the GM has made known, without the GM's notes.
  const LIFESTYLES = { Wretched: 0, Squalid: 1, Poor: 2, Modest: 10, Comfortable: 20, Wealthy: 40, Aristocratic: 100 };
  function storyHtml() {
    const gm = isGM(), fs = S.st.factions || [], rs = S.st.rivals || [], name = id => (S.st.characters[id] || {}).name || '?';
    const rankName = (f, r) => ((f.ranks || [])[r] || '').trim() || `rank ${n0(r)}`;
    const facts = fs.map(f => `<div class="box story-item"><h4 style="text-transform:none;letter-spacing:0">${f.ours ? '★' : '⚑'} ${esc(f.name)} <span class="muted" style="font-weight:400">${f.ours ? "the party's own · " : ''}tier ${n0(f.tier)} · ${n0(f.renown)} renown${f.dues ? ` · dues ${n0(f.dues)} cr a ${esc(f.duesPer)}` : ''}${gm && !f.shown ? ' · hidden from players' : ''}</span>
        ${gm ? `<span class="spacer"></span>${f.dues && Object.keys(f.members || {}).length ? `<button class="btn tiny" data-st="dues" data-id="${esc(f.id)}" title="Take one period's dues from each member's credits">Collect dues</button>` : ''}<button class="btn tiny" data-st="edit-f" data-id="${esc(f.id)}">✎</button>` : ''}</h4>
      ${f.insignia ? `<div class="muted">Insignia: ${esc(f.insignia)}</div>` : ''}
      ${f.notes ? `<div>${md(f.notes)}</div>` : ''}${gm && f.gmNotes ? `<div class="muted" style="margin-top:4px">🔒 ${md(f.gmNotes)}</div>` : ''}
      ${f.ours && (f.ideals || f.hq || f.recruitment || (f.scores || []).length) ? `<div style="margin-top:6px">${f.hq ? `<div><span class="muted">Headquarters:</span> ${esc(f.hq)}</div>` : ''}${f.ideals ? `<div><span class="muted">Ideals:</span> ${md(f.ideals)}</div>` : ''}${f.recruitment ? `<div><span class="muted">Recruitment:</span> ${md(f.recruitment)}</div>` : ''}
        ${(f.scores || []).length ? `<div class="row wrap" style="gap:6px;margin-top:4px">${f.scores.map(s => `<span class="pill">${esc(s.name)} ${n0(s.value)}</span>`).join('')}</div>` : ''}</div>` : ''}
      ${f.training ? `<div style="margin-top:6px"><span class="muted">Training:</span> ${md(f.training)}</div>` : ''}
      ${(f.stockpile || []).length ? `<div style="margin-top:6px"><span class="muted">Stockpile:</span> ${f.stockpile.map(s => `${s.qty !== 1 ? n0(s.qty) + '× ' : ''}${esc(s.name)}`).join(', ')}</div>` : ''}
      ${Object.keys(f.members || {}).length ? `<div class="list-rows" style="margin-top:6px">${Object.entries(f.members).map(([id, m]) => `<div class="lr"><span class="nm">${esc(name(id))}</span><span class="muted">${esc(rankName(f, m.rank))}</span><span class="bonus">${n0(m.renown)}</span>
        ${gm ? `<button class="btn tiny" data-st="ren" data-id="${esc(f.id)}" data-c="${esc(id)}" data-d="1">+1</button><button class="btn tiny ghost" data-st="ren" data-id="${esc(f.id)}" data-c="${esc(id)}" data-d="-1">−1</button>` : ''}</div>`).join('')}</div>` : ''}</div>`).join('');
    const rivs = rs.map(r => `<div class="box story-item"><h4 style="text-transform:none;letter-spacing:0">${r.kind === 'complication' ? '⚠' : '☠'} ${esc(r.name)} <span class="muted" style="font-weight:400">${r.kind}${(r.chars || []).length ? ' · ' + r.chars.map(name).map(esc).join(', ') : ''}${gm && !r.known ? ' · not known to players' : ''}</span>
        ${gm ? `<span class="spacer"></span><button class="btn tiny" data-st="edit-r" data-id="${esc(r.id)}">✎</button>` : ''}</h4>
      ${r.notes ? `<div>${md(r.notes)}</div>` : ''}${gm && r.gmNotes ? `<div class="muted" style="margin-top:4px">🔒 ${md(r.gmNotes)}</div>` : ''}</div>`).join('');
    if (!gm && !facts && !rivs) return '';
    return `<h3 style="margin-top:18px">Factions${gm ? ' <button class="btn tiny" data-st="new-f">＋ Faction</button>' : ''}</h3>${facts || '<p class="muted">None yet.</p>'}
      <h3 style="margin-top:18px">Rivals &amp; complications${gm ? ' <button class="btn tiny" data-st="new-r">＋ Add</button>' : ''}</h3>${rivs || '<p class="muted">None yet.</p>'}
      ${gm ? `<h3 style="margin-top:18px">Lifestyle</h3><div class="row wrap"><span class="muted">Charge each character's lifestyle (set on Bio &amp; Notes) for</span><input id="lsDays" type="number" min="1" value="7" style="width:70px"><span class="muted">days</span><button class="btn small" data-st="charge">🏠 Charge</button></div>` : ''}`;
  }
  function openStoryEditor(kind, x) {
    const f = kind === 'f', cs = chars();
    x = x || (f ? { name: '', tier: 1, renown: 0, notes: '', gmNotes: '', shown: true, members: {} } : { name: '', kind: 'rival', notes: '', gmNotes: '', known: false, chars: [] });
    const lines = a => (a || []).map(s => `${s.qty !== undefined ? s.qty : s.value} ${s.name}`).join('\n');
    const parse = (t, key, d) => t.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(\d+)\s*[×x]?\s+(.+)$/); return m ? { name: m[2], [key]: +m[1] } : { name: l, [key]: d }; });
    modal(`<h3>${f ? '⚑ Faction' : '☠ Rival or complication'}</h3>
      <label>Name<input id="soName" value="${esc(x.name)}" maxlength="80"></label>
      ${f ? `<div class="row wrap"><label>Tier<input id="soTier" type="number" min="1" max="20" value="${n0(x.tier)}" style="width:70px"></label><label>Faction renown<input id="soRen" type="number" min="0" value="${n0(x.renown)}" style="width:100px"></label>
        <label class="toggle"><input type="checkbox" id="soShown" ${x.shown ? 'checked' : ''}> players see it</label>
        <label class="toggle" title="The party's own faction: ideals, headquarters, recruitment and its scores"><input type="checkbox" id="soOurs" ${x.ours ? 'checked' : ''}> the party's own</label></div>
        <div class="row wrap"><label style="flex:1">Insignia<input id="soIns" value="${esc(x.insignia || '')}" maxlength="120" placeholder="What members wear or carry"></label>
          <label>Dues (cr)<input id="soDues" type="number" min="0" value="${n0(x.dues)}" style="width:90px"></label>
          <label>every<select id="soPer">${['week', 'month', 'year'].map(p => `<option ${(x.duesPer || 'month') === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div>
        <label>Rank names <span class="muted">(0 to 5, one per line; a blank line keeps "rank N")</span><textarea id="soRanks" rows="3">${esc((x.ranks || []).join('\n'))}</textarea></label>
        <label>Training on offer <span class="muted">(what members can learn, and from which rank)</span><textarea id="soTrain" rows="2">${esc(x.training || '')}</textarea></label>
        <label>Stockpile <span class="muted">(one per line, e.g. "4 medpac")</span><textarea id="soStock" rows="2">${esc(lines(x.stockpile))}</textarea></label>
        <div id="soOursBox" ${x.ours ? '' : 'hidden'}><label>Headquarters<input id="soHq" value="${esc(x.hq || '')}" maxlength="200"></label>
          <label>Ideals<textarea id="soIdeals" rows="2">${esc(x.ideals || '')}</textarea></label>
          <label>Recruitment<textarea id="soRecruit" rows="2">${esc(x.recruitment || '')}</textarea></label>
          <label>Scores <span class="muted">(yours to name, one per line, e.g. "14 Influence")</span><textarea id="soScores" rows="2">${esc(lines(x.scores))}</textarea></label></div>
        <h4 style="margin-top:8px">Members <span class="muted" style="text-transform:none;letter-spacing:0">rank 0–5 and renown</span></h4>
        ${cs.map(c => { const m = (x.members || {})[c.id]; return `<div class="row"><label class="toggle" style="flex:1"><input type="checkbox" class="soM" value="${esc(c.id)}" ${m ? 'checked' : ''}> ${esc(c.name)}</label><input class="soRank" data-c="${esc(c.id)}" type="number" min="0" max="5" value="${n0(m && m.rank)}" style="width:60px"><input class="soMR" data-c="${esc(c.id)}" type="number" min="0" value="${n0(m && m.renown)}" style="width:80px"></div>`; }).join('')}`
      : `<div class="row wrap"><label>Kind<select id="soKind"><option value="rival" ${x.kind === 'rival' ? 'selected' : ''}>Rival</option><option value="complication" ${x.kind === 'complication' ? 'selected' : ''}>Complication</option></select></label>
        <label class="toggle"><input type="checkbox" id="soKnown" ${x.known ? 'checked' : ''}> players know about it</label></div>
        <div class="ask-who">${cs.map(c => `<label class="toggle"><input type="checkbox" class="soC" value="${esc(c.id)}" ${(x.chars || []).includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>`}
      <label style="margin-top:8px">Notes <span class="muted">(players see these when it's shown)</span><textarea id="soNotes" rows="3">${esc(x.notes || '')}</textarea></label>
      <label style="margin-top:8px">🔒 GM notes<textarea id="soGm" rows="3">${esc(x.gmNotes || '')}</textarea></label>
      <div class="row" style="margin-top:12px">${x.id ? '<button class="btn small danger" id="soDel">Delete</button>' : ''}<span class="spacer"></span><button class="btn ghost" id="soClose">Cancel</button><button class="btn primary" id="soSave">Save</button></div>`, box => {
      box.onchange = e => { if (e.target.id === 'soOurs') $('#soOursBox').hidden = !e.target.checked; };
      box.onclick = async e => {
        const t = e.target;
        if (t.id === 'soClose') closeModal();
        if (t.id === 'soDel' && confirm(`Delete ${x.name}?`)) { await act(f ? 'faction.remove' : 'rival.remove', { id: x.id }); closeModal(); }
        if (t.id === 'soSave') {
          const item = { id: x.id, name: $('#soName').value, notes: $('#soNotes').value, gmNotes: $('#soGm').value };
          if (f) {
            Object.assign(item, { tier: +$('#soTier').value || 1, renown: +$('#soRen').value || 0, shown: $('#soShown').checked, members: {},
              insignia: $('#soIns').value, dues: +$('#soDues').value || 0, duesPer: $('#soPer').value, ranks: $('#soRanks').value.split('\n').slice(0, 6), training: $('#soTrain').value,
              stockpile: parse($('#soStock').value, 'qty', 1), ours: $('#soOurs').checked, hq: $('#soHq').value, ideals: $('#soIdeals').value, recruitment: $('#soRecruit').value,
              scores: parse($('#soScores').value, 'value', 10) });
            for (const c of box.querySelectorAll('.soM:checked')) item.members[c.value] = { rank: +box.querySelector(`.soRank[data-c="${c.value}"]`).value || 0, renown: +box.querySelector(`.soMR[data-c="${c.value}"]`).value || 0 };
          } else Object.assign(item, { kind: $('#soKind').value, known: $('#soKnown').checked, chars: [...box.querySelectorAll('.soC:checked')].map(c => c.value) });
          if (await act(f ? 'faction.save' : 'rival.save', { item })) closeModal();
        }
      };
    });
  }
  function renderHandouts(el) {
    const gm = isGM(), hs = S.st.handouts || [];
    el.innerHTML = `${gm ? `<div class="box"><h4>New handout</h4>
        <div class="grid" style="gap:8px"><input id="hoTitle" placeholder="Title (e.g., Intercepted transmission)">
        <textarea id="hoText" rows="4" placeholder="Text players will see"></textarea>
        <div class="row wrap"><input id="hoImg" placeholder="Image URL (optional)" style="flex:1"><button class="btn small" id="hoUpload">Upload image…</button><input type="file" id="hoFile" accept="image/*" hidden>
        <label class="toggle"><input type="checkbox" id="hoShared" checked> share now</label><button class="btn primary small" id="hoSave">Create</button></div></div></div>` : ''}
      <div class="grid g2" style="margin-top:12px">${hs.slice().reverse().map(h => `<div class="box">
        <h4 style="color:var(--holo);text-transform:none;font-size:15px;letter-spacing:0">${esc(h.title || 'Untitled')}
          ${gm ? `<span class="spacer"></span><span class="muted" style="font-size:11px">${h.shared ? 'shared' : 'GM only'}</span>
          <button class="btn tiny" data-ho="toggle" data-id="${esc(h.id)}">${h.shared ? 'Unshare' : 'Share'}</button><button class="btn tiny ghost" data-ho="del" data-id="${esc(h.id)}">✕</button>` : ''}</h4>
        ${imgUrl(h.img) ? `<img src="${esc(imgUrl(h.img))}" style="max-width:100%;border-radius:6px;margin-bottom:6px">` : ''}<div>${md(h.text || '')}</div></div>`).join('')
        || '<p class="muted">No handouts yet.</p>'}</div>${storyHtml()}`;
  }
  $('#handouts').addEventListener('click', async e => {
    const sb = e.target.closest('[data-st]');
    if (sb && isGM()) {
      const a = sb.dataset.st, id = sb.dataset.id;
      if (a === 'new-f') return openStoryEditor('f');
      if (a === 'new-r') return openStoryEditor('r');
      if (a === 'edit-f') return openStoryEditor('f', (S.st.factions || []).find(x => x.id === id));
      if (a === 'edit-r') return openStoryEditor('r', (S.st.rivals || []).find(x => x.id === id));
      if (a === 'ren') return act('faction.renown', { id, charId: sb.dataset.c, delta: +sb.dataset.d });
      if (a === 'dues') { const f = (S.st.factions || []).find(x => x.id === id), n = Object.keys((f && f.members) || {}).length; if (f && confirm(`Take ${f.dues} cr from each of ${n} member${n === 1 ? '' : 's'} for ${f.name}'s dues?`)) act('faction.dues', { id }); return; }
      if (a === 'charge') { const days = +$('#lsDays').value || 1, ids = chars().filter(c => c.lifestyle).map(c => c.id); if (!ids.length) return toast('Nobody has a lifestyle set yet (Bio & Notes on the sheet).', true); if (confirm(`Charge ${days} day${days === 1 ? '' : 's'} of lifestyle to ${ids.length} character${ids.length === 1 ? '' : 's'}?`)) act('lifestyle.charge', { days, chars: ids }); return; }
    }
    const t = e.target;
    if (t.id === 'hoUpload') return $('#hoFile').click();
    if (t.id === 'hoSave') {
      const h = { title: $('#hoTitle').value, text: $('#hoText').value, img: $('#hoImg').value, shared: $('#hoShared').checked };
      if (!h.title && !h.text && !h.img) return;
      await act('handout.save', { handout: h, announce: h.shared });
      return;
    }
    const b = t.closest('[data-ho]'); if (!b) return;
    const h = (S.st.handouts || []).find(x => x.id === b.dataset.id);
    if (b.dataset.ho === 'toggle') act('handout.save', { handout: { ...h, shared: !h.shared }, announce: !h.shared });
    if (b.dataset.ho === 'del' && confirm('Delete handout?')) act('handout.delete', { id: h.id });
  });
  $('#handouts').addEventListener('change', async e => {
    if (e.target.id === 'hoFile' && e.target.files[0]) {
      try {
        toast('Uploading image…');
        const { dataUrl } = await fitUpload(e.target.files[0], 1600);
        $('#hoImg').value = (await post('upload', { purpose: 'handout', dataUrl })).url;
        toast('Image attached');
      } catch (err) { toast(err.message || 'Could not read image', true); }
    }
  });

  // --------------------------------------------------------------------------- rules
  function renderRules(filter = '') {
    const f = filter.toLowerCase();
    const match = (...s) => !f || s.join(' ').toLowerCase().includes(f);
    const sec = (t, b) => match(t, b.replace(/<[^>]+>/g, '')) ? `<div class="box rule"><h4>${t}</h4><div>${b}</div></div>` : '';
    let html = (window.HTB ? HTB.libraryBar() : '') + `<input class="rules-search" id="rulesSearch" placeholder="Search rules, conditions, classes, weapons…" value="${esc(filter)}">`;
    html += R.REFERENCE.map(r => sec(r.title, r.body)).join('');
    const conds = Object.entries(R.CONDITIONS).filter(([k, v]) => match(k, v, 'condition'));
    if (conds.length) html += `<div class="box rule"><h4>Conditions</h4>${conds.map(([k, v]) => `<div style="margin-bottom:6px"><b>${k}.</b> ${esc(v)}</div>`).join('')}</div>`;
    const cls = Object.entries(R.CLASSES).filter(([k, v]) => match(k, 'class', v.caster || ''));
    if (cls.length) html += `<div class="box rule"><h4>Classes (defaults)</h4><table class="t"><thead><tr><th>Class</th><th>Hit die</th><th>Saves</th><th>Powers</th></tr></thead><tbody>
      ${cls.map(([k, v]) => `<tr><td>${k}</td><td>d${v.hd}</td><td>${v.saves.join(', ').toUpperCase()}</td><td>${v.caster ? `${v.caster} · ${v.pp} pts/level · ${v.prog === 'threeQuarter' ? '¾' : v.prog}` : '—'}</td></tr>`).join('')}</tbody></table></div>`;
    const sk = R.SKILLS.filter(s => match(s.name, s.ab, 'skill'));
    if (sk.length) html += `<div class="box rule"><h4>Skills</h4>${sk.map(s => `${s.name} <span class="muted">(${s.ab.toUpperCase()})</span>`).join(' · ')}</div>`;
    const wp = R.WEAPONS.filter(w => match(w.name, w.props, w.type, 'weapon'));
    if (wp.length) html += `<div class="box rule"><h4>Starter weapons</h4><table class="t"><thead><tr><th>Weapon</th><th>Damage</th><th>Properties</th></tr></thead><tbody>
      ${wp.map(w => `<tr><td>${esc(w.name)}</td><td>${w.damage} ${w.type}</td><td>${esc(w.props)}</td></tr>`).join('')}</tbody></table></div>`;
    html += `<p class="muted" style="font-size:12px">Summaries for quick reference; the full books are in the rulebook library above. Values listed as defaults can be overridden on any sheet.</p>`;
    $('#rules').innerHTML = html;
    if (filter) { const inpEl = $('#rulesSearch'); inpEl.focus(); inpEl.setSelectionRange(filter.length, filter.length); }
  }
  $('#rules').addEventListener('input', e => { if (e.target.id === 'rulesSearch') renderRules(e.target.value); });

  // --------------------------------------------------------------------------- GM
  // A player asks for a downtime activity (audit 11.1): which, how many days, a note. jpesus: the GM approves first, so
  // nothing is spent or rolled until then. Each activity's Resources and Resolution text comes from SW5e's list.
  function askDowntime(ch) {
    const dt = ch.downtime || { days: 0 }, left = n0(dt.days) - (dt.pending || []).reduce((n, q) => n + n0(q.days), 0);
    let acts = [];
    const info = key => { const a = acts.find(x => x.key === key); return a ? `<p style="margin:4px 0"><b>Resources.</b> ${esc(a.resources)}</p><p class="muted" style="margin:4px 0;font-size:12px"><b>Resolution.</b> ${esc(a.resolution.slice(0, 600))}${a.resolution.length > 600 ? '…' : ''}</p>` : key === 'other' ? '<p class="muted">Describe it in the note; the GM decides how it goes.</p>' : ''; };
    modal(`<h3>🕰 Ask for a downtime activity</h3>
      <p class="muted" style="margin-top:0;font-size:12px">${esc(ch.name)} has ${left} day${left === 1 ? '' : 's'} to ask for. The GM approves first; then you roll the check.</p>
      <div class="row wrap"><label style="flex:1">Activity<select id="daAct">${Object.entries(R.DOWNTIME_ACTS).map(([k, n]) => `<option value="${k}" ${k === 'work' ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label>Days<input id="daDays" type="number" min="1" max="${left}" value="${Math.min(5, left)}" style="width:80px"></label></div>
      <label style="margin-top:6px">Note for the GM<input id="daNote" maxlength="200" placeholder="e.g. Dock work at the spaceport"></label>
      <div id="daInfo" style="margin-top:6px"></div>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn ghost" id="daCancel">Cancel</button><button class="btn primary" id="daGo">Ask the GM</button></div>`, box => {
      const show = () => { $('#daInfo').innerHTML = info($('#daAct').value); };
      if (window.HTB && S.st.sw5eBooks !== false) HTB.list('downtime').then(l => { acts = l; show(); }).catch(() => {});
      show(); box.onchange = show;
      box.onclick = e => {
        if (e.target.id === 'daCancel') closeModal();
        if (e.target.id === 'daGo') act('downtime.request', { charId: ch.id, act: $('#daAct').value, days: n0($('#daDays').value), note: $('#daNote').value })
          .then(r => { if (r) { closeModal(); toast('Sent to the GM'); } });
      };
    });
  }
  // the GM's side: each request waiting, with the check to roll, the cost and any modifiers; then approve or turn down
  function downtimeRequestsHtml() {
    const rows = chars().flatMap(c => ((c.downtime || {}).pending || []).map(q => ({ c, q })));
    if (!rows.length) return '<p class="muted" style="margin:0">No requests. Players ask from their sheet\'s Bio tab once you grant days.</p>';
    const checks = [...R.SKILLS.map(k => [`skill:${k.key}`, `${k.name} (${({ str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' })[k.ab]})`]), ...R.ABILITIES.map(a => [`ability:${a.key}`, `${a.name} check`])];
    return rows.map(({ c, q }) => `<div class="dt-req" data-char="${esc(c.id)}" data-id="${esc(q.id)}" style="border-top:1px solid var(--line);padding:6px 0">
      <div><b>${esc(c.name)}</b>: ${esc(R.DOWNTIME_ACTS[q.act] || q.act)}, ${n0(q.days)} days${q.note ? ` · <span class="muted">${esc(q.note)}</span>` : ''}</div>
      ${q.ok ? `<div class="row"><span class="muted">Approved: ${esc(c.name)} rolls ${esc((q.check || {}).name || '')}.</span><span class="spacer"></span><button class="btn tiny" data-dt="roll">🎲 Roll for them</button></div>`
        : `<div class="row wrap" style="gap:6px;margin-top:4px">${q.act === 'other' ? '<input class="dtText" maxlength="200" placeholder="What came of it" style="flex:1">'
          : `<select class="dtCheck">${checks.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>
            <label class="toggle" title="An Intelligence check with a set of tools the character is proficient with"><input type="checkbox" class="dtProf"> + proficiency (tools)</label>
            <label>Check ±<input class="dtBonus" type="number" min="-10" max="10" value="0" style="width:60px"></label>
            <label title="Added to the d100 roll, e.g. a scarce or rich setting">d100 ±<input class="dtExtra" type="number" min="-50" max="50" value="0" style="width:60px"></label>
            ${q.act === 'selling-enhanced-items' ? '<label>Rarity<select class="dtRarity"><option value="0">Standard</option><option value="1">Premium</option><option value="2">Prototype</option><option value="3">Advanced</option><option value="4">Legendary</option></select></label>' : ''}`}
          <label>Cost (cr)<input class="dtCost" type="number" min="0" value="0" style="width:90px"></label>
          <span class="spacer"></span><button class="btn tiny ghost" data-dt="no">Turn down</button><button class="btn tiny primary" data-dt="yes">Approve</button></div>`}</div>`).join('');
  }

  // Downtime between adventures (audit 11.1, #202): the GM gives the characters they tick N days to spend
  function openGrantDowntime() {
    const gmIds = new Set(Object.entries(S.st.players).filter(([, p]) => p.role === 'gm').map(([id]) => id));
    const list = chars().map(c => ({ c, on: !gmIds.has(c.owner) }));
    modal(`<h3>🕰 Grant downtime</h3>
      <p class="muted" style="margin-top:0;font-size:12px">Days between adventures that each character can spend on downtime activities (Wretched Hives, chapter 2). They show on the sheet's Bio tab.</p>
      <div class="row wrap"><label>Days<input id="dtDays" type="number" min="1" max="3650" value="7" style="width:90px"></label>
        <label style="flex:1">Why <input id="dtWhy" maxlength="80" placeholder="e.g. A week in port at Nar Shaddaa"></label></div>
      <label class="toggle" style="margin-top:6px" title="Each character's lifestyle (on their sheet) is charged for these days, from their credits"><input type="checkbox" id="dtLiving" checked> Charge each one's lifestyle for these days</label>
      <h4 style="margin-top:10px">Who gets them</h4>
      <div class="ask-who">${list.map(({ c, on }) => `<label class="toggle"><input type="checkbox" class="dtChar" value="${esc(c.id)}" ${on ? 'checked' : ''}> ${esc(c.name)}
        <span class="muted">${n0((c.downtime || {}).days)} days now</span></label>`).join('') || '<p class="muted">No characters yet.</p>'}</div>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn ghost" id="dtCancel">Cancel</button><button class="btn primary" id="dtGo">Grant</button></div>`, box => {
      box.onclick = e => {
        if (e.target.id === 'dtCancel') closeModal();
        if (e.target.id === 'dtGo') {
          const ids = [...box.querySelectorAll('.dtChar:checked')].map(x => x.value);
          act('downtime.grant', { days: n0($('#dtDays').value), chars: ids, reason: $('#dtWhy').value, living: $('#dtLiving').checked })
            .then(r => { if (r) { closeModal(); toast(`Downtime granted to ${r.granted}${r.living ? `; living costs charged for ${r.living}` : ''}`); } });
        }
      };
    });
  }

  // XP after an encounter (audit 9.8): an amount (the meter fills in the creatures' XP), split among the characters
  // ticked. The server adds it and tells the GM who has reached the next level; levelling stays the GM's grant.
  function openAwardXp(amount) {
    const gmIds = new Set(Object.entries(S.st.players).filter(([, p]) => p.role === 'gm').map(([id]) => id));
    const ini = S.st.initiative || {}, inIni = new Set((ini.entries || []).map(e => e.charId).filter(Boolean));
    const list = chars().map(c => ({ c, on: !gmIds.has(c.owner) && (!inIni.size || inIni.has(c.id)) }));
    modal(`<h3>★ Award XP</h3>
      <div class="row wrap"><label>XP<input id="xpAmt" type="number" min="1" value="${n0(amount) || ''}" style="width:110px"></label>
        <label style="flex:1">For <input id="xpWhy" maxlength="80" placeholder="e.g. The cantina fight"></label></div>
      <h4 style="margin-top:10px">Split among</h4>
      <div class="ask-who">${list.map(({ c, on }) => `<label class="toggle"><input type="checkbox" class="xpChar" value="${esc(c.id)}" ${on ? 'checked' : ''}> ${esc(c.name)} <span class="muted">${n0(c.xp).toLocaleString()} XP</span></label>`).join('') || '<p class="muted">No characters yet.</p>'}</div>
      <p class="muted" id="xpEach" style="font-size:12px"></p>
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn ghost" id="xpCancel">Cancel</button><button class="btn primary" id="xpGo">Award</button></div>`, box => {
      const each = () => { const n = box.querySelectorAll('.xpChar:checked').length, a = n0($('#xpAmt').value); $('#xpEach').textContent = n && a ? `${Math.floor(a / n).toLocaleString()} XP each for ${n}.` : ''; };
      each(); box.oninput = box.onchange = each;
      box.onclick = e => {
        if (e.target.id === 'xpCancel') closeModal();
        if (e.target.id === 'xpGo') {
          const ids = [...box.querySelectorAll('.xpChar:checked')].map(x => x.value);
          act('xp.award', { amount: n0($('#xpAmt').value), chars: ids, reason: $('#xpWhy').value }).then(r => { if (r) { closeModal(); toast(`Awarded ${n0(r.each).toLocaleString()} XP each`); } });
        }
      };
    });
  }
  document.addEventListener('click', e => { const b = e.target.closest('#encAwardXp'); if (b && isGM()) openAwardXp(+b.dataset.xp || 0); });
  // ---- the GM's own NPCs (audit 9.9): a template with attacks ("Name | +5 | 1d8+3 energy" a line) and notes
  function openNpcEditor(t) {
    const lines = (t.attacks || []).map(a => `${a.n} | ${a.hit >= 0 ? '+' : ''}${a.hit} | ${a.dmg}`).join('\n');
    modal(`<h3>💾 ${t.id ? 'Edit' : 'Save'} NPC</h3>
      <div class="npc-form"><label>Name<input id="tpName" value="${esc(t.name || '')}" maxlength="60"></label><label>Init bonus<input id="tpBonus" type="number" value="${n0(t.bonus)}"></label>
        <label>HP<input id="tpHp" type="number" value="${n0(t.hp) || 1}"></label><label>AC<input id="tpAc" type="number" value="${n0(t.ac) || 10}"></label></div>
      <label style="margin-top:8px">Attacks <span class="muted">one a line: name | attack bonus | damage</span><textarea id="tpAtk" rows="4" placeholder="Blaster rifle | +5 | 1d8+3 energy">${esc(lines)}</textarea></label>
      <label style="margin-top:8px">Notes <span class="muted">(only you see them)</span><textarea id="tpNotes" rows="4">${esc(t.notes || '')}</textarea></label>
      <div class="row" style="margin-top:12px">${t.id ? '<button class="btn danger small" id="tpDel">Delete</button>' : ''}<span class="spacer"></span><button class="btn ghost" id="tpCancel">Cancel</button><button class="btn primary" id="tpSave">Save</button></div>`, box => {
      box.onclick = async e => {
        if (e.target.id === 'tpCancel') closeModal();
        if (e.target.id === 'tpDel' && confirm(`Delete ${t.name}? NPCs already in a fight stay.`)) { await act('npc.remove', { id: t.id }); S.npcTpl = null; closeModal(); }
        if (e.target.id === 'tpSave') {
          const attacks = $('#tpAtk').value.split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0]).map(([n, hit, dmg]) => ({ n, hit: parseInt(hit, 10) || 0, dmg: dmg || '' }));
          const r = await act('npc.save', { npc: { id: t.id, name: $('#tpName').value, bonus: +$('#tpBonus').value || 0, hp: +$('#tpHp').value || 1, ac: +$('#tpAc').value || 10, attacks, notes: $('#tpNotes').value } });
          if (r) { S.npcTpl = r.id; closeModal(); toast('NPC saved'); }
        }
      };
    });
  }
  function openNpcCard(id, who) {   // the tracker's 📜 for an NPC of the GM's: attacks and damage roll GM-only
    const t = (S.st.npcs || []).find(x => x.id === id);
    if (!t) return toast('That NPC was deleted.', true);
    modal(`<h3>📜 ${esc(who || t.name)}</h3><p class="muted" style="margin-top:0">AC ${n0(t.ac)} · HP ${n0(t.hp)} · initiative ${t.bonus >= 0 ? '+' : ''}${n0(t.bonus)}</p>
      ${(t.attacks || []).map((a, i) => `<div class="row" style="margin:4px 0"><b style="flex:1">${esc(a.n)}</b>
        <button class="btn small amber" data-npcroll="atk" data-i="${i}" title="Shift: advantage · Ctrl: disadvantage">${a.hit >= 0 ? '+' : ''}${n0(a.hit)} to hit</button>
        ${a.dmg ? `<button class="btn small" data-npcroll="dmg" data-i="${i}">${esc(a.dmg)}</button>` : ''}</div>`).join('') || '<p class="muted">No attacks saved.</p>'}
      ${t.notes ? `<div class="box" style="margin-top:8px;white-space:pre-wrap">${esc(t.notes)}</div>` : ''}
      <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn ghost" id="npcClose">Close</button></div>`, box => {
      box.onclick = e => {
        if (e.target.id === 'npcClose') return closeModal();
        const b = e.target.closest('[data-npcroll]'); if (!b) return;
        const a = t.attacks[+b.dataset.i]; if (!a) return;
        const mode = rollModeFromEvent(e);
        if (b.dataset.npcroll === 'atk') act('roll', { expr: `${mode === 'adv' ? '2d20kh1' : mode === 'dis' ? '2d20kl1' : '1d20'}${a.hit >= 0 ? '+' : ''}${a.hit}`, label: `${who || t.name}: ${a.n}${mode === 'adv' ? ' (adv)' : mode === 'dis' ? ' (dis)' : ''}`, private: true, kind: 'attack' });
        else { const m = /^[\dd+\-\s]+/i.exec(a.dmg); if (m && m[0].trim()) act('roll', { expr: m[0].replace(/\s+/g, ''), label: `${who || t.name}: ${a.n} damage ${a.dmg.slice(m[0].length).trim()}`.trim(), private: true, kind: 'damage' }); else toast('That damage isn\'t a dice expression.', true); }
      };
    });
  }
  // more than one campaign (audit 12.9): the GM keeps up to five; the table (everyone) is on one of them
  function openCampaigns() {
    const draw = async () => {
      const j = await fetch(`${API}?op=campaigns`, { cache: 'no-store' }).then(r => r.json()).catch(() => null);
      if (!j || !j.list) { $('#modalBox').innerHTML = '<p class="muted">Couldn\'t load the campaigns.</p>'; return; }
      $('#modalBox').innerHTML = `<h3>📚 Campaigns</h3><p class="muted" style="margin-top:0">Everyone is always on the live one. The others wait, untouched, until you switch to them. Up to ${n0(j.max)}.</p>
        <div class="list-rows">${j.list.map(c => `<div class="lr"><span class="nm">${c.live ? '● ' : ''}<b>${esc(c.name)}</b> <span class="muted">${(n0(c.bytes) / 1024).toFixed(0)} KB${c.live ? ' · live' : ''}</span></span>
          ${c.live ? '' : `<button class="btn tiny" data-camp="switch" data-code="${esc(c.code)}">Switch the table to it</button>`}
          <button class="btn tiny ghost" data-camp="rename" data-code="${esc(c.code)}" data-name="${esc(c.name)}">Rename</button>
          ${c.live || c.code === 'main' ? '' : `<button class="btn tiny ghost" data-camp="delete" data-code="${esc(c.code)}" data-name="${esc(c.name)}">Delete</button>`}</div>`).join('')}</div>
        <div class="row" style="margin-top:10px"><input id="campNew" placeholder="New campaign's name" maxlength="80" style="flex:1"><button class="btn small" id="campCreate" ${j.list.length >= j.max ? 'disabled' : ''}>＋ New campaign</button></div>
        <p class="muted" style="font-size:12px">Before deleting one, switch to it and use ⇩ Download full backup if you might want it back.</p>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="campClose">Close</button></div>`;
    };
    const go = async (body) => { try { await post('campaign', body); } catch (e) { toast(e.message, true); } draw(); };
    modal('<p class="muted">Loading…</p>', box => {
      draw();
      box.onclick = async e => {
        const t = e.target, c = t.dataset.camp;
        if (t.id === 'campClose') return closeModal();
        if (t.id === 'campCreate') return go({ do: 'create', name: $('#campNew').value });
        if (c === 'switch' && confirm('Put the whole table on this campaign? Everyone moves with you; the current one waits as it is.')) { await go({ do: 'switch', code: t.dataset.code }); closeModal(); }
        if (c === 'rename') { const n = prompt('Name', t.dataset.name); if (n && n.trim()) go({ do: 'rename', code: t.dataset.code, name: n.trim() }); }
        if (c === 'delete' && confirm(`Delete "${t.dataset.name}" for good? Its characters, maps, chat and backups go with it.`)) go({ do: 'delete', code: t.dataset.code });
      };
    });
  }
  function renderGM(el) {
    if (!isGM()) { el.innerHTML = ''; return; }
    const link = location.origin + location.pathname;
    const lvl = (S.st.levelUps) || {};
    const pendingNames = Object.keys(lvl).filter(id => S.st.characters[id]).map(id => `${esc(S.st.characters[id].name)} (${n0(lvl[id].count)})`);
    el.innerHTML = `<div class="grid g2">
      <div class="box"><h4>Players</h4>
        <p style="margin-top:0">Players open <code>${esc(link)}</code> <button class="btn tiny" id="copyLink">Copy</button>
          and sign in with the <b>player password</b>. You sign in with the GM password, on any device.</p>
        <h4 style="margin-top:12px">Table name</h4>
        <div class="row"><input id="campRename" value="${esc(S.st.name)}" style="flex:1"><button class="btn small" id="doRename">Rename</button></div>
        <h4 style="margin-top:12px">Who's here</h4>
        ${Object.entries(S.st.players).map(([id, p]) => `<div>${esc(p.name)} ${p.role === 'gm' && !/^\s*gm\s*$/i.test(p.name || '') ? '<span class="muted">(GM)</span>' : ''} ${S.st.online.some(o => o.clientId === id) ? '<span style="color:var(--green)">● online</span>' : '<span class="muted">offline</span>'}
          <span class="muted">— ${chars().filter(c => c.owner === id).map(c => esc(c.name)).join(', ') || 'no characters'}</span>${id !== clientId && !S.st.online.some(o => o.clientId === id) && !chars().some(c => c.owner === id) ? ` <button class="btn tiny ghost" data-rmplayer="${esc(id)}" title="Remove this old entry from the list (offline, no characters)" aria-label="Remove ${esc(p.name)} from the player list">✕</button>` : ''}</div>`).join('')}
        <div class="row" style="margin-top:12px"><button class="btn small" id="gmCampaigns" title="Keep up to five campaigns (a second game, a one-shot, a test table) and choose which one the table is on">📚 Campaigns…</button></div>
        <div class="row" style="margin-top:8px"><a class="btn small" href="${API}?op=chatlog" download title="The whole chat the table keeps (the last 400 messages), as a text file">⇩ Download chat log</a><button class="btn small danger" id="clearChat">Clear chat log</button></div>
      </div>
      <div class="box"><h4>Level ups</h4>
        <p style="margin-top:0" class="muted">After a big fight or a hard-won conversation, give the party a level. Each player gets a pop-up and picks how to level.
          Someone missed the session? Grant just their character, and you can level it for them.</p>
        <button class="btn small amber" id="gmGrant">⬆ Grant a level…</button>
        <button class="btn small" id="gmXp" title="Give the party XP and split it; you're told who has enough to level">★ Award XP…</button>
        <button class="btn small" id="gmDowntime" title="Between adventures: give characters days of downtime to spend on activities">🕰 Grant downtime…</button>
        <h4 style="margin-top:12px">Downtime requests</h4><div id="dtReqs">${downtimeRequestsHtml()}</div>
        <button class="btn small" id="gmLoot" title="Roll SW5e enhanced items by rarity, plus credits, into the party stash">🎁 Loot…</button>
        <button class="btn small" id="gmAsk" title="Everyone roll Perception, a group check, a secret Insight roll for a player…">🎲 Ask for a roll…</button>
        <label class="toggle" style="margin-top:8px" title="A table rule: whether players may take the hit die's maximum instead of the average or a roll">
          <input type="checkbox" id="gmHpMax" ${S.st.hpMax !== false ? 'checked' : ''}> Players may take maximum hit points when levelling</label>
        <label class="toggle" style="margin-top:4px" title="On: class levels, XP and maximum HP change only by your grant or your own edits. Archetype picks, credits and everything else stay the player's.">
          <input type="checkbox" id="gmSheetLock" ${S.st.sheetLock ? 'checked' : ''}> Only I change levels, XP and max HP</label>
        <label class="toggle" style="margin-top:4px" title="On: players can't open Scum and Villainy's creature stat blocks in the Rules library">
          <input type="checkbox" id="gmStatBlocks" ${S.st.statBlocksHidden ? 'checked' : ''}> Keep creature stat blocks to myself</label>
        ${pendingNames.length ? `<p class="muted" style="font-size:12px">Waiting to level: ${pendingNames.join(', ')}</p>` : ''}
      </div>
      <div class="box"><h4>Saving &amp; backups</h4>
        <p style="margin:0 0 6px"><span style="color:var(--green)">✓ Every change saves automatically to Boofer's Den.</span>
          <span class="muted">Last saved ${S.st.updated ? esc(new Date(S.st.updated * 1000).toLocaleString()) : '—'}</span></p>
        <p class="muted" style="font-size:12px;margin:0 0 8px">Next session, everyone just opens this page again. A backup copy is also kept every 10 minutes of play (last 10).</p>
        <div class="row wrap"><a class="btn small primary" href="${API}?op=export" download>⇩ Download full backup</a>
          <button class="btn small" id="showBackups">Automatic backups…</button>
          <button class="btn small ghost" id="restoreBtn">⇪ Restore a backup…</button><input type="file" id="restoreFile" accept=".json" hidden></div>
        <div id="backupList" style="margin-top:8px"></div>
      </div>
      <div class="box" id="gmFiles"></div>
      <div class="box" id="gmAudio"></div>
      <div class="box"><h4>GM notes <span class="muted" style="text-transform:none;letter-spacing:0">(only you can see these · autosaves)</span></h4>
        <textarea id="gmNotes" rows="18" placeholder="Session plan, NPCs, secrets, loot…">${esc(S.st.notes || '')}</textarea></div>
    </div>`;
    renderFilesBox();
  }
  // ---- the GM's "File storage" box: what the Den's private file store holds for this table, and the
  // one-time move of files uploaded before the store existed (they work where they are until then)
  const F = { info: null, loaded: false, lib: null, busy: '' };
  const fmb = b => (n0(b) < 1048576 ? `${Math.ceil(n0(b) / 1024)} KB` : `${(n0(b) / 1048576).toFixed(1)} MB`);
  async function loadFiles() {
    F.info = await fetch(`${API}?op=files`, { cache: 'no-store', credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    renderFilesBox();
  }
  function renderFilesBox() {
    const box = $('#gmFiles'); if (!box || !isGM()) return;
    if (!F.loaded || F.lib !== S.lib) { F.loaded = true; F.lib = S.lib; loadFiles(); }   // packs or tracks changed
    const f = F.info, left = f && f.left ? n0(f.left.images) + n0(f.left.packArt) + n0(f.left.tracks) : 0;
    const kinds = [['images', 'Uploaded images'], ['packArt', 'Asset-pack art'], ['audio', 'Table audio']];
    const line = (k, label) => { const h = f.held ? f.held[k] : f.listed[k]; return h && h.n ? `<div class="row" style="font-size:13px"><span style="flex:1">${label}</span><span class="muted">${n0(h.n)} file${h.n === 1 ? '' : 's'} · ${fmb(h.b)}</span></div>` : ''; };
    box.innerHTML = `<h4>File storage <span class="muted" style="text-transform:none;letter-spacing:0">(images, asset packs and audio)</span></h4>
      ${!f ? '<p class="muted">Loading…</p>' : `
        <p style="margin:0 0 6px">${f.store ? '<span style="color:var(--green)">✓ Files are kept in the Den\'s private file store.</span>' : '<span style="color:var(--amber)">File storage isn\'t connected here, so new uploads are off.</span>'}
          <span class="muted">${fmb(f.used)} of ${fmb(f.cap)} used.</span></p>
        ${kinds.map(([k, label]) => line(k, label)).join('') || '<p class="muted" style="font-size:12px;margin:0">Nothing stored yet.</p>'}
        ${f.unlisted && f.unlisted.n ? `<p class="muted" style="font-size:12px">${n0(f.unlisted.n)} leftover file${f.unlisted.n === 1 ? '' : 's'} from unfinished uploads (${fmb(f.unlisted.b)}); “Tidy up” removes them once they're an hour old.</p>` : ''}
        ${f.complete === false ? '<p class="muted" style="font-size:12px">(Only the first 20,000 files were counted.)</p>' : ''}
        ${left ? `<p style="font-size:13px;margin:8px 0 4px">Still in the database from before: ${[[f.left.images, 'image'], [f.left.packArt, 'pack image'], [f.left.tracks, 'track']].filter(([n]) => n).map(([n, w]) => `${n0(n)} ${w}${n === 1 ? '' : 's'}`).join(', ')}. They work as they are; moving them frees the database.</p>` : ''}
        <div class="row wrap" style="margin-top:6px">${f.store ? `<button class="btn small ${left ? 'primary' : ''}" id="moveFiles" ${F.busy ? 'disabled' : ''}>${left ? '⇪ Move files to file storage' : 'Tidy up'}</button>` : ''}
          <button class="btn small ghost" id="filesRefresh" ${F.busy ? 'disabled' : ''}>Refresh</button>
          ${F.busy ? `<span class="muted" style="font-size:12px">${esc(F.busy)}</span>` : ''}</div>`}`;
  }
  async function moveFiles() {
    let moved = 0, tidied = 0;
    F.busy = 'Moving…'; renderFilesBox();
    try {
      for (let i = 0, tries = 0; i < 500; i++) {   // each call moves what fits in a few seconds; it's safe to stop at any point
        let r;
        try { r = await post('filemove', {}); tries = 0; } catch (err) {   // a timeout or a blip: go again; a refusal: stop
          if (++tries >= 3 || /GM only|isn't connected|sign in/i.test(err.message)) throw err;
          await sleep(1500 * tries); continue;
        }
        moved += n0(r.moved); tidied += n0(r.tidied);
        F.busy = `Moving… ${moved} moved`; renderFilesBox();
        if (!r.more) break;
      }
      toast(moved || tidied ? `Moved ${moved} file${moved === 1 ? '' : 's'}${tidied ? `, removed ${tidied} leftover${tidied === 1 ? '' : 's'}` : ''}` : 'Nothing to move');
    } catch (err) { toast(err.message, true); }
    F.busy = ''; await loadFiles();
  }
  $('#gm').addEventListener('click', e => {
    const dtb = e.target.closest('[data-dt]');   // a downtime request: approve, turn down, or roll for a character (11.1)
    if (dtb) {
      const row = dtb.closest('.dt-req'), v = sel => row.querySelector(sel), charId = row.dataset.char, id = row.dataset.id;
      if (dtb.dataset.dt === 'roll') return act('downtime.roll', { charId, id });
      if (dtb.dataset.dt === 'no') return act('downtime.decide', { charId, id, ok: false });
      const [what, key] = v('.dtCheck') ? v('.dtCheck').value.split(':') : [];
      return act('downtime.decide', { charId, id, ok: true, cr: n0(v('.dtCost').value), text: v('.dtText') ? v('.dtText').value : undefined,
        check: what ? { what, key } : undefined, prof: v('.dtProf') ? v('.dtProf').checked : false, bonus: v('.dtBonus') ? n0(v('.dtBonus').value) : 0,
        extra: v('.dtExtra') ? n0(v('.dtExtra').value) : 0, rarity: v('.dtRarity') ? n0(v('.dtRarity').value) : -1 });
    }
    if (e.target.id === 'moveFiles') return moveFiles();
    if (e.target.id === 'filesRefresh') return loadFiles();
    const rm = e.target.closest('[data-rmplayer]');
    if (rm) { const pl = S.st.players[rm.dataset.rmplayer]; if (pl && confirm(`Remove ${pl.name || 'this player'} from the player list?`)) act('player.remove', { id: rm.dataset.rmplayer }); return; }
    const id = e.target.id;
    if (id === 'copyLink') navigator.clipboard?.writeText(location.origin + location.pathname).then(() => toast('Link copied'));
    if (id === 'doRename') act('campaign.rename', { name: $('#campRename').value });
    if (id === 'clearChat' && confirm('Clear the chat log for everyone?\n\nTip: "Download chat log" keeps a copy first.')) act('chat.clear');
    if (id === 'gmGrant') openGrant();
    if (id === 'gmCampaigns') openCampaigns();
    if (id === 'gmXp') openAwardXp(0);
    if (id === 'gmDowntime') openGrantDowntime();
    if (id === 'gmAsk') openAskRoll();
    if (id === 'gmLoot') openLoot();
    if (id === 'restoreBtn') $('#restoreFile').click();
    if (id === 'showBackups') {
      post('backups', {}).then(r => {
        const fmtB = b => b.at ? new Date(b.at * 1000).toLocaleString() : 'backup ' + (n0(b.i) + 1);
        $('#backupList').innerHTML = r.backups.length ? r.backups.map(b => `<div class="row" style="font-size:13px"><span style="flex:1">${esc(fmtB(b))}</span>
          <a class="btn tiny" download href="${API}?op=export&backup=${n0(b.i)}">⇩ download</a></div>`).join('')
          + '<p class="muted" style="font-size:12px">To roll back, download one and use “Restore a backup”.</p>'
          : '<p class="muted">No automatic backups yet; the first is made on the next change.</p>';
      }).catch(err => toast(err.message, true));
    }
  });
  $('#gm').addEventListener('change', async e => {
    if (e.target.id === 'gmHpMax') { act('settings.hpMax', { on: e.target.checked }); return; }
    if (e.target.id === 'gmSheetLock') { act('settings.sheetLock', { on: e.target.checked }); return; }
    if (e.target.id === 'gmStatBlocks') { act('settings.statBlocks', { hidden: e.target.checked }); return; }
    if (e.target.id !== 'restoreFile' || !e.target.files[0]) return;
    const f = e.target.files[0]; e.target.value = '';
    let campaign;
    try { campaign = JSON.parse(await f.text()); } catch { return toast('That file is not a HoloTable backup.', true); }
    if (!confirm(`Replace the table with “${campaign.name || f.name}”? The current table is kept as an automatic backup first.`)) return;
    try { await post('restore', { campaign }); toast('Table restored'); } catch (err) { toast(err.message, true); }
  });
  let notesTimer;
  $('#gm').addEventListener('input', e => {
    if (e.target.id !== 'gmNotes') return;
    clearTimeout(notesTimer);
    const v = e.target.value;
    notesTimer = setTimeout(() => { S.st.notes = v; act('notes.save', { notes: v }); }, 700);
  });

  // --------------------------------------------------------------------------- chat
  function renderMsg(m) {
    const t = m.ts ? `<span class="ts">${timeStr(m.ts)}</span>` : '';
    if (m.levelup) return `<div class="msg lvl">${md(m.text)}</div>`;
    if (m.system) return `<div class="msg sys">${md(m.text)}</div>`;
    const who = m.as ? `${esc(m.as)} <span class="muted" style="font-weight:400">(${esc(m.from)})</span>` : m.charName ? `${esc(m.charName)} <span class="muted" style="font-weight:400">(${esc(m.from)})</span>` : esc(m.from);
    const priv = m.private ? `<div class="tag">${m.roll ? '🔒 GM-only roll' : '🔒 whisper to ' + esc(m.whisperTo || 'GM')}</div>` : '';
    if (m.roll) {
      const r = m.roll, crit = r.nat === 20 && r.kind !== 'damage', fumble = r.nat === 1 && r.kind !== 'damage';
      const detail = esc(r.detail).replace(/~(\d+)~/g, '<del>$1</del>');
      return `<div class="msg ${m.private ? 'priv' : ''}"><div class="who">${who}${t}</div>${priv}
        <div class="roll ${crit ? 'crit' : ''} ${fumble ? 'fumble' : ''}"><div class="label">${esc(r.label || r.expr)}${crit ? ' — NATURAL 20!' : fumble ? ' — natural 1' : ''}</div>
        <div class="total">${n0(r.total)}</div><div class="detail">${esc(r.expr)} → ${detail}</div></div></div>`;
    }
    if (m.yell) return `<div class="msg yell"><div class="who">📣 ${who} yells${t}</div><div class="yell-text">${md(m.text)}</div></div>`;
    if (m.ooc) return `<div class="msg ooc"><span class="ooc-tag">OOC</span> <b>${esc(m.from)}:</b> ${md(m.text)}</div>`;
    if (m.narration) return `<div class="msg narr">${md(m.text)}</div>`;
    if (m.emote) return `<div class="msg emote">* ${m.as ? `${esc(m.as)} <span class="muted">(${esc(m.from)})</span>` : esc(m.from)} ${md(m.text)}</div>`;
    return `<div class="msg ${m.private ? 'priv' : ''}"><div class="who">${who}${t}</div>${priv}<div>${md(m.text)}</div></div>`;
  }
  // a yell also pops up on everyone else's screen for a moment
  function showYell(m) {
    const el = document.createElement('div');
    el.className = 'yell-pop'; el.setAttribute('role', 'alert');
    el.innerHTML = `<span class="who">📣 ${m.as ? `${esc(m.as)} (${esc(m.from)})` : esc(m.from)} yells</span><span class="text">${esc(m.text)}</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4400);
  }
  function renderChat() {
    const log = $('#chatLog'), msgs = S.st.chat;
    const last = msgs.length ? msgs[msgs.length - 1].id : null;
    if (last === S.lastChatId && log.childElementCount === msgs.length) return;
    if (S.lastChatId !== null) {  // new since last time (not on first load): pop up other people's yells
      const i = msgs.findIndex(m => m.id === S.lastChatId);
      for (const m of msgs.slice(i + 1)) if (m.yell && m.fromId !== clientId) showYell(m);
    }
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.innerHTML = msgs.map(renderMsg).join('');
    if (atBottom || S.lastChatId === null || (msgs.length && msgs[msgs.length - 1].fromId === clientId)) log.scrollTop = log.scrollHeight;
    S.lastChatId = last;
  }

  // ---- chat commands: type "/" for a menu that narrows as you type; names are suggested for whispers
  const COMMANDS = [
    { cmd: '/r', alias: ['/roll'], args: '<dice> [# label]', desc: 'Roll dice for everyone to see', ex: '/r 1d20+5 # Stealth' },
    { cmd: '/gmr', alias: ['/gr'], args: '<dice>', desc: 'Secret roll that only you and the GM see', ex: '/gmr 1d20' },
    { cmd: '/w', alias: ['/whisper', '/tell', '/msg'], args: '<player or character> <message>', desc: 'Whisper privately to a player or a character', ex: '/w Kira Vos meet me at the hangar', target: true },
    { cmd: '/yell', alias: ['/y', '/shout'], args: '<message>', desc: 'Yell to everyone at the table, with a pop-up on every screen', ex: '/yell Incoming fighters!' },
    { cmd: '/me', args: '<action>', desc: 'Describe what your character does', ex: '/me draws her blaster' },
    { cmd: '/ooc', alias: ['/o'], args: '<message>', desc: 'Out-of-character table talk', ex: '/ooc brb, getting snacks' },
    { cmd: '/init', args: '', desc: 'Roll initiative for your selected character', client: true },
    { cmd: '/desc', args: '<text>', desc: 'Narrate the scene (GM)', ex: '/desc The cantina falls silent.', gm: true },
    { cmd: '/clear', args: '', desc: 'Clear the chat log for everyone (GM)', gm: true, client: true },
    { cmd: '/help', args: '', desc: 'Show every chat command', client: true },
  ];
  const cmdFor = word => COMMANDS.find(c => c.cmd === word || (c.alias || []).includes(word));
  const CM = { items: [], sel: 0, open: false };
  function whisperTargets() {
    const out = isGM() ? [] : [{ name: 'gm', label: 'GM', sub: 'the Game Master' }];
    for (const [id, p] of Object.entries(S.st.players)) if (p && p.name && id !== clientId) out.push({ name: p.name, label: p.name, sub: p.role === 'gm' ? 'GM' : 'player' });
    for (const ch of chars()) if (ch.owner !== clientId) out.push({ name: ch.name, label: ch.name, sub: `${(S.st.players[ch.owner] || {}).name || 'someone'}'s character` });
    return out;
  }
  // what the menu should show for the text typed so far
  function menuItems(v) {
    if (!S.st || !v.startsWith('/')) return [];
    const sp = v.indexOf(' ');
    if (sp < 0) {   // still typing the command word
      const typed = v.toLowerCase();
      // every command word that starts with what's typed, aliases included (so /r lists /r and /roll)
      return COMMANDS.filter(c => !c.gm || isGM())
        .flatMap(c => [c.cmd, ...(c.alias || [])].filter(w => w.startsWith(typed)).map(hit => ({ c, hit })))
        .sort((a, b) => a.hit.length - b.hit.length || a.hit.localeCompare(b.hit))
        .map(({ c, hit }) => ({ kind: 'cmd', insert: hit + (c.args ? ' ' : ''), c, hit, typed }));
    }
    const c = cmdFor(v.slice(0, sp).toLowerCase());
    if (!c || !c.target) return [];
    const rest = v.slice(sp + 1);
    const lowRest = rest.toLowerCase();
    // stop suggesting once a full name has been typed and the message has started
    if (whisperTargets().some(t => lowRest.startsWith(t.name.toLowerCase() + ' '))) return [];
    return whisperTargets().filter(t => t.name.toLowerCase().startsWith(lowRest))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(t => ({ kind: 'name', insert: v.slice(0, sp + 1) + t.name + ' ', t, typed: rest }));
  }
  function renderMenu() {
    const box = $('#cmdMenu');
    if (!CM.open || !CM.items.length) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = CM.items.map((it, i) => {
      const on = i === CM.sel ? ' on' : '';
      if (it.kind === 'cmd') {
        const c = it.c, n = it.typed.length;
        const shown = `<b>${esc(it.hit.slice(0, n))}</b>${esc(it.hit.slice(n))}`;
        return `<div class="cm-item${on}" role="option" aria-selected="${i === CM.sel}" data-i="${i}"><span class="cm-cmd">${shown}</span> <span class="cm-args">${esc(c.args)}</span>
          <div class="cm-desc">${esc(c.desc)}${it.hit !== c.cmd ? ` <span class="muted">(same as ${esc(c.cmd)})</span>` : ''}${c.gm ? ' <span class="cm-gm">GM</span>' : ''}</div></div>`;
      }
      const n = it.typed.length;
      return `<div class="cm-item${on}" role="option" aria-selected="${i === CM.sel}" data-i="${i}"><span class="cm-cmd"><b>${esc(it.t.label.slice(0, n))}</b>${esc(it.t.label.slice(n))}</span>
        <div class="cm-desc">${esc(it.t.sub)}</div></div>`;
    }).join('');
    const selEl = box.querySelector('.cm-item.on'); if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  }
  function updateMenu() {
    const v = $('#chatInput').value;
    const items = menuItems(v);
    const sameList = CM.items.length === items.length && CM.items.every((x, i) => x.insert === items[i].insert);
    CM.items = items; CM.open = items.length > 0;
    if (!sameList) CM.sel = 0;
    renderMenu();
  }
  function acceptMenu(i = CM.sel) {
    const it = CM.items[i]; if (!it) return;
    const input = $('#chatInput');
    input.value = it.insert; input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    updateMenu();
  }
  function showHelp() {
    modal(`<h3>💬 Chat commands</h3>
      <p class="muted" style="margin:0">Type <code>/</code> in the chat box for a menu that narrows as you type. Arrow keys pick one; Tab or Enter fills it in.</p>
      <table class="t"><tbody>${COMMANDS.filter(c => !c.gm || isGM()).map(c => `<tr><td style="white-space:nowrap"><code>${esc(c.cmd)}</code>${(c.alias || []).map(a => ` <code class="muted">${esc(a)}</code>`).join('')}</td>
        <td>${esc(c.desc)}${c.ex ? `<br><span class="muted" style="font-size:12px">e.g. <code>${esc(c.ex)}</code></span>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="row"><span class="spacer"></span><button class="btn primary" id="helpOk">Got it</button></div>`, box => { $('#helpOk', box).onclick = closeModal; });
  }
  async function rollMyInitiative(mode) {
    const ch = selChar();
    const mine = ch && canEdit(ch) ? ch : chars().find(c => c.owner === clientId);
    if (!mine) { toast('Pick or create your character first.', true); return false; }
    const bonus = R.initiative(mine);
    let expr = '1d20' + (bonus >= 0 ? '+' : '') + bonus;
    if (mode === 'adv') expr = expr.replace('1d20', '2d20kh1'); if (mode === 'dis') expr = expr.replace('1d20', '2d20kl1');
    return !!(await act('init.add', { charId: mine.id, name: mine.name, bonus, expr }));
  }
  $('#chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#chatInput'), text = input.value.trim(); if (!text) return;
    S.chatHist.unshift(text); S.chatHistIdx = -1;
    CM.open = false; renderMenu();
    const word = text.split(/\s/)[0].toLowerCase(), c = cmdFor(word);
    if (c && c.client) {           // handled right here, not sent as chat
      input.value = '';
      if (c.cmd === '/help') showHelp();
      if (c.cmd === '/init') { if (await rollMyInitiative(S.rollMode)) toast('Initiative rolled; see the Combat tab'); }
      if (c.cmd === '/clear' && confirm('Clear the chat log for everyone?')) act('chat.clear');
      return;
    }
    input.value = '';
    const sc = selChar();
    const speaksAs = sc && sc.owner === clientId ? sc.name : '';   // talk, yells, whispers and emotes come from your character
    const res = await act('chat', { text, as: !text.startsWith('/') || /^\/(w|whisper|tell|msg|y|yell|shout|me) /i.test(text) ? speaksAs : '' });
    if (!res) input.value = text;
  });
  $('#chatInput').addEventListener('input', updateMenu);
  $('#chatInput').addEventListener('blur', () => setTimeout(() => { CM.open = false; renderMenu(); }, 150));
  $('#chatInput').addEventListener('keydown', e => {
    if (CM.open && CM.items.length) {
      if (e.key === 'ArrowDown') { CM.sel = (CM.sel + 1) % CM.items.length; renderMenu(); e.preventDefault(); return; }
      if (e.key === 'ArrowUp') { CM.sel = (CM.sel - 1 + CM.items.length) % CM.items.length; renderMenu(); e.preventDefault(); return; }
      if (e.key === 'Tab') { acceptMenu(); e.preventDefault(); return; }
      if (e.key === 'Enter') {
        const it = CM.items[CM.sel];
        // Enter fills in the highlighted choice, unless that's exactly what's typed already (then it sends)
        if (it && it.insert.trim() !== e.target.value.trim()) { acceptMenu(); e.preventDefault(); return; }
      }
      if (e.key === 'Escape') { CM.open = false; renderMenu(); e.preventDefault(); e.stopPropagation(); return; }
    }
    if (e.key === 'ArrowUp' && S.chatHist.length) { S.chatHistIdx = Math.min(S.chatHist.length - 1, S.chatHistIdx + 1); e.target.value = S.chatHist[S.chatHistIdx]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { S.chatHistIdx = Math.max(-1, S.chatHistIdx - 1); e.target.value = S.chatHistIdx < 0 ? '' : S.chatHist[S.chatHistIdx]; e.preventDefault(); }
  });
  $('#cmdMenu').addEventListener('mousedown', e => {   // mousedown, so the input doesn't lose focus first
    const it = e.target.closest('.cm-item'); if (!it) return;
    e.preventDefault(); acceptMenu(+it.dataset.i);
  });
  $('#quickDice').innerHTML = [4, 6, 8, 10, 12, 20, 100].map(d => `<button type="button" data-d="${d}" title="Roll 1d${d}">d${d}</button>`).join('');
  $('#quickDice').addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const d = +b.dataset.d;
    roll('1d' + d, 'd' + d, { d20: d === 20, mode: rollModeFromEvent(e) });
  });

  // --------------------------------------------------------------------------- colour themes
  // Each person's choice is saved with their account (so it follows them to other devices) and
  // cached in this browser so the page is already in their colours before they sign in.
  const TH = window.HoloThemes;
  const myPrefs = () => (S.st && S.st.players[clientId] && S.st.players[clientId].prefs) || store.get('holo.theme', null);
  let appliedTheme = '';
  function applyPrefs(prefs) {
    const key = JSON.stringify(prefs || {});
    if (key === appliedTheme) return;
    appliedTheme = key;
    TH.apply(prefs || {});
    store.set('holo.theme', prefs || null);
    if (S.st) drawMap();
  }
  // a theme colour for the canvas (which can't read CSS variables)
  function themeHex(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback;
  }
  const rgba = (hex, a) => `rgba(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`;
  function mapColors() {
    const bg = themeHex('bg', '#0b0f17'), holo = themeHex('holo', '#4fc3f7');
    const dark = [1, 3, 5].map(i => Math.round(parseInt(bg.slice(i, i + 2), 16) * 0.82));
    const board = [1, 3, 5].map(i => Math.round(parseInt(bg.slice(i, i + 2), 16) * 0.95 + 6));
    return { bg: `rgb(${dark.join(',')})`, board: `rgb(${board.join(',')})`, grid: rgba(holo, 0.2), ghost: rgba(holo, 0.15), edge: rgba(holo, 0.45) };
  }

  function openThemes() {
    const start = myPrefs() || { theme: 'republic-command', custom: {} };
    let draft = { theme: start.theme || 'republic-command', custom: Object.assign({}, start.custom || {}) };
    let saveTimer;
    const save = () => {
      applyPrefs(draft);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => act('player.prefs', draft), 400);
    };
    const card = t => {
      const c = t.colors;
      return `<button type="button" class="theme-card ${draft.theme === t.id ? 'on' : ''}" data-theme="${esc(t.id)}" style="background:${c.panel};color:${c.text}">
        <span class="sw" style="background:${c.bg}"><i style="background:${c.panel2};border:1px solid ${c.line}"></i><i style="background:${c.holo}"></i><i class="dot" style="background:${c.amber}"></i></span>
        <span class="nm">${esc(t.name)}</span><span class="tg" style="color:${c.muted}">${esc(t.tagline)}</span></button>`;
    };
    const render = box => {
      const groups = TH.GROUPS.filter(g => g.id !== 'gm' || isGM());
      const cur = TH.resolve(draft).colors;
      box.innerHTML = `<div id="themePick"><h3>🎨 Your colours</h3>
        <p class="muted" style="margin:0">Pick a look for your own screen. Everyone at the table can choose their own.</p>
        <div class="theme-groups">${groups.map(g => `<div><h4>${esc(g.name)}${g.id === 'gm' ? ' 🛡' : ''}</h4>
          <div class="theme-grid">${TH.THEMES.filter(t => t.group === g.id).map(card).join('')}</div></div>`).join('')}</div>
        <div class="box" style="margin:0"><h4>Customise</h4>
          <div class="custom-colors">${TH.CUSTOM_KEYS.map(k => `<label><input type="color" data-ck="${k.key}" value="${cur[k.key]}">${esc(k.label)}${draft.custom[k.key] ? ' ✎' : ''}</label>`).join('')}</div>
          ${Object.keys(draft.custom).length ? '<button class="btn tiny" data-tact="reset" style="margin-top:8px">Reset to the template\'s colours</button>' : ''}</div>
        <label class="toggle"><input type="checkbox" data-tact="wipes" ${wipesOn() ? 'checked' : ''}> Screen wipes when the GM changes the scene</label>
        <div class="row"><span class="spacer"></span><button class="btn primary" data-tact="done">Done</button></div></div>`;
    };
    modal('', box => {
      render(box);
      const wrap = box;
      wrap.onclick = e => {
        const t = e.target.closest('.theme-card[data-theme]'); // not <html>, which also carries data-theme
        if (t) { draft = { theme: t.dataset.theme, custom: {} }; save(); render(wrap); return; }
        const a = e.target.closest('[data-tact]');
        if (a && a.dataset.tact === 'reset') { draft.custom = {}; save(); render(wrap); }
        if (a && a.dataset.tact === 'done') closeModal();
      };
      wrap.oninput = e => {
        const k = e.target.dataset.ck; if (!k) return;
        draft.custom[k] = e.target.value;
        applyPrefs(draft);              // live preview while dragging
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => act('player.prefs', draft), 600);
      };
      wrap.onchange = e => {
        if (e.target.dataset.tact === 'wipes') { store.set('holo.wipes', e.target.checked ? 'on' : 'off'); return; }
        if (e.target.dataset.ck) render(wrap);
      };
    });
  }
  $('#themeBtn').addEventListener('click', openThemes);

  // --------------------------------------------------------------------------- level ups
  // The GM grants levels (to the whole party or picked characters); each player then levels their
  // own character in a guided wizard. The GM can run the wizard for someone who missed the session.
  const pendingFor = id => ((S.st && S.st.levelUps) || {})[id];
  const ASI_AT = { _: [4, 8, 12, 16, 19], Fighter: [4, 6, 8, 12, 14, 16, 19], Monk: [4, 8, 10, 12, 16, 19], Operative: [4, 8, 10, 12, 16, 19] }; // from SW5e's class tables
  const asiDue = (cls, lvl) => (ASI_AT[cls] || ASI_AT._).includes(lvl);
  const ABN = Object.fromEntries(R.ABILITIES.map(a => [a.key, a.name]));

  function openGrant(preselect) {
    const list = chars();
    if (!list.length) return toast('No characters at the table yet.', true);
    const pre = new Set(preselect || list.filter(c => !(S.st.players[c.owner] || {}).role || S.st.players[c.owner].role !== 'gm').map(c => c.id));
    modal(`<div id="grant"><h3>⬆ Grant a level up</h3>
      <p class="muted" style="margin:0">Everyone you tick gets a pop-up to level their character. Grants stack if you give more than one.</p>
      <div class="row"><button class="btn tiny" data-g="all">All characters</button><button class="btn tiny" data-g="none">None</button></div>
      <div class="grant-list">${list.map(c => {
        const pl = S.st.players[c.owner] || {}, pend = pendingFor(c.id), lvl = c.classes.reduce((a, k) => a + n0(k.level), 0);
        const online = S.st.online.some(o => o.clientId === c.owner);
        return `<label class="grant-row"><input type="checkbox" value="${esc(c.id)}" ${pre.has(c.id) ? 'checked' : ''}>
          <span><b>${esc(c.name)}</b> <span class="muted">level ${lvl} · ${esc(pl.name || 'unknown')}${online ? ' <span style="color:var(--green)">●</span>' : ' (away)'}</span>
          ${pend ? `<span class="chip lvl-chip">${n0(pend.count)} waiting</span>` : ''}</span>
          ${pend ? `<button class="btn tiny" data-g="for" data-id="${esc(c.id)}" title="Level this character now, for an absent player">Level for them</button>
            <button class="btn tiny ghost" data-g="cancel" data-id="${esc(c.id)}" title="Take back the waiting level">✕</button>` : ''}</label>`;
      }).join('')}</div>
      <label>Reason (optional, shown in chat)<input id="grantWhy" maxlength="200" placeholder="for surviving the ambush on Ord Mantell"></label>
      <div class="row"><span class="spacer"></span><button class="btn" data-g="close">Cancel</button><button class="btn primary amber-fill" data-g="go">Grant level up</button></div></div>`,
    box => {
      const g = $('#grant', box);
      g.addEventListener('click', async e => {
        const b = e.target.closest('[data-g]'); if (!b) return;
        e.preventDefault();
        const k = b.dataset.g, boxes = $$('input[type=checkbox]', g);
        if (k === 'all') boxes.forEach(x => x.checked = true);
        if (k === 'none') boxes.forEach(x => x.checked = false);
        if (k === 'close') closeModal();
        if (k === 'cancel') { await act('levelup.cancel', { charId: b.dataset.id }); closeModal(); }
        if (k === 'for') { closeModal(); openWizard(b.dataset.id); }
        if (k === 'go') {
          const ids = boxes.filter(x => x.checked).map(x => x.value);
          if (!ids.length) return toast('Tick at least one character.', true);
          const r = await act('levelup.grant', { charIds: ids, reason: $('#grantWhy', g).value });
          if (r) { closeModal(); toast(`Level up granted to ${r.granted} character${r.granted > 1 ? 's' : ''}`); }
        }
      });
    });
  }
  $('#lvlBtn').addEventListener('click', () => openGrant());

  // A pop-up for each new grant to one of your characters (once per grant, per browser).
  function maybeCelebrate() {
    if (!S.st || modalOpen() || $('#lobby').offsetParent) return;
    const seen = new Set(store.get('holo.lvlSeen', []));
    const ch = chars().find(c => c.owner === clientId && pendingFor(c.id) && !seen.has(pendingFor(c.id).grantId));
    if (!ch) return;
    const pend = pendingFor(ch.id);
    store.set('holo.lvlSeen', [...seen, pend.grantId].slice(-50));
    const lvl = ch.classes.reduce((a, k) => a + n0(k.level), 0);
    modal(`<div class="celebrate"><div class="burst">⬆</div><h3>Level up!</h3>
      <p>The GM has granted <b>${esc(ch.name)}</b> a new level: <b>${lvl} → ${lvl + 1}</b>${pend.count > 1 ? ` (and ${n0(pend.count) - 1} more after that)` : ''}.</p>
      <div class="row" style="justify-content:center"><button class="btn" id="celLater">Later</button><button class="btn primary" id="celGo">Level up now</button></div>
      <p class="muted" style="font-size:12px">You can also use the ⬆ button on your sheet any time.</p></div>`, box => {
      $('#celLater', box).onclick = closeModal;
      $('#celGo', box).onclick = () => { closeModal(); S.selected = ch.id; setTab('sheet'); renderAll(); openWizard(ch.id); };
    });
  }

  function openWizard(charId, resume) {
    const ch0 = S.st.characters[charId];
    if (!ch0) return;
    if (!pendingFor(charId)) return toast('The GM hasn\'t granted this character a level yet.', true);
    const W = resume || { cls: ch0.classes[0].name, newCls: '', archetype: '', hpMode: 'average', asiMode: 'two', a1: 'str', a2: 'dex', featName: '', featText: '', powers: [],
      auto: [], autoKey: '', autoState: '', archList: [], archFor: '', archMenu: false, featList: [], picks: {}, expTools: '', lists: null, listsErr: '', feats: null, featAsi: '' , improvements: null };
    modal('<div id="wiz"></div>', box => {
      const wiz = $('#wiz', box);
      // SW5e's class/archetype features for the level being gained (fetched once per class/level/archetype)
      const suggest = () => {
        if (!window.HTB || S.st.sw5eBooks === false) return;
        const P = wizardPlan(charId, W);
        const arch = (P.k && P.k.archetype) || (P.archDue ? W.archetype : '');
        const key = `${P.cls}|${P.newClassLevel}|${arch}`;
        if (!P.cls || key === W.autoKey) return;
        W.autoKey = key; W.autoState = 'loading'; W.auto = [];
        HTB.levelFeatures(P.cls, P.newClassLevel, arch).then(list => {
          if (W.autoKey !== key) return;
          const have = new Set(S.st.characters[charId].features.map(f => String(f.name).toLowerCase()));
          W.auto = list.map(f => Object.assign(f, { have: have.has(f.name.toLowerCase()) })); W.autoState = 'ok'; draw();
        }).catch(err => { if (W.autoKey === key) { W.autoState = err.message; draw(); } });
        if (P.archDue && W.archFor !== P.cls) {   // this class's archetypes (PHB and Expanded Content), with their descriptions
          W.archFor = P.cls; W.archList = [];
          HTB.list('archetypes').then(all => { if (W.archFor !== P.cls) return; W.archList = all.filter(a => a.cls.toLowerCase() === P.cls.toLowerCase()); draw(); }).catch(() => {});
        }
      };
      if (window.HTB && S.st.sw5eBooks !== false && !W.improvements) Promise.all(['improvements-class', 'improvements-multi', 'improvements-splash'].map(k => HTB.list(k)))   // 2.17
        .then(([cl, multi, splash]) => { W.improvements = { class: cl, multi, splash }; draw(); }).catch(() => { W.improvements = { class: [], multi: [], splash: [] }; });
      if (window.HTB && S.st.sw5eBooks !== false) HTB.list('feats').then(l => { W.feats = l; W.featList = l.map(f => f.n); draw(); }).catch(() => {});
      // the lists this level's choices come from (audit 2.9): class options, maneuvers, fighting styles
      if (window.HTB && HTB.levelChoices && S.st.sw5eBooks !== false && !W.lists) {
        Promise.all(['classes', 'maneuvers', 'styles'].map(k => HTB.list(k))).then(([classes, maneuvers, styles]) => { W.lists = { classes, maneuvers, styles }; draw(); })
          .catch(err => { W.listsErr = err.message || 'not available'; draw(); });
      }
      const draw = () => { const a = document.activeElement, id = a && a.dataset && a.dataset.w, pos = a && a.selectionStart;
        const scrolled = $$('[data-scroll]', wiz).map(el => [el.dataset.scroll, el.scrollTop]);   // a long list keeps its place when a box is ticked
        wiz.innerHTML = wizardHtml(charId, W);
        for (const [k, top] of scrolled) { const el = wiz.querySelector(`[data-scroll="${k}"]`); if (el) el.scrollTop = top; }
        if (id) { const el = wiz.querySelector(`[data-w="${id}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* not a text box */ } } } };
      const render = () => { draw(); suggest(); };
      wiz.addEventListener('input', e => {
        const t = e.target, f = t.dataset.w;
        if (!f) return;
        if (f.startsWith('feature.') || f.startsWith('power.')) {
          const [kind, i, key] = f.split('.');
          const row = (kind === 'feature' ? W.features : W.powers)[+i];
          row[key] = t.type === 'number' ? +t.value : t.value;
          return;
        }
        if (t.type === 'text' || t.tagName === 'TEXTAREA') W[f] = t.value;
        if (f === 'featName') {   // as you type (2.5): a feat from SW5e's list brings its own text, prerequisite and +1
          W.featAsi = ''; W.picks.improvement = [];
          const fd = (W.feats || []).find(x => x.n.toLowerCase() === W.featName.trim().toLowerCase());
          if (fd) { W.featText = fd.text; const ta = wiz.querySelector('[data-w=featText]'); if (ta) ta.value = fd.text; }
          const el = wiz.querySelector('#wizFeatInfo'); if (el) el.innerHTML = featInfoHtml(charId, W);
        }
      });
      // hovering an archetype in the menu shows its description
      wiz.addEventListener('mouseover', e => {
        const o = e.target.closest('[data-arch-tip]'); if (!o) return;
        const a = (W.archList || []).find(x => x.n === o.dataset.archTip); if (!a) return;
        showTextTip(a.n, a.text, e.clientX, e.clientY);
      });
      wiz.addEventListener('mousemove', e => { if (e.target.closest('[data-arch-tip]')) placeTip(e.clientX, e.clientY); });
      wiz.addEventListener('mouseout', e => { const o = e.target.closest('[data-arch-tip]'); if (o && !o.contains(e.relatedTarget)) hideTip(); });
      wiz.addEventListener('focusout', e => {   // a typed feat name: look up SW5e's text
        const f = e.target.dataset && e.target.dataset.w;
        if (f === 'featName' && window.HTB && W.featName.trim() && !W.featText.trim()) HTB.featNamed(W.featName).then(x => { if (x && !W.featText.trim()) { W.featText = x.text; draw(); } }).catch(() => {});
      });
      wiz.addEventListener('change', e => {
        const t = e.target, f = t.dataset.w;
        if (f && f.startsWith('pick.')) {   // a choice ticked or unticked
          const cur = W.picks[f.slice(5)] = W.picks[f.slice(5)] || [], i = cur.indexOf(t.value);
          if (t.checked && i < 0) cur.push(t.value);
          if (!t.checked && i >= 0) cur.splice(i, 1);
          return draw();
        }
        if (!f || f.startsWith('feature.') || (f.startsWith('power.') && !f.endsWith('.type'))) return;
        if (t.type === 'text' || t.tagName === 'TEXTAREA') return; // already saved on input; re-rendering here would eat a click
        if (f.startsWith('power.')) { const [, i] = f.split('.'); W.powers[+i].type = t.value; return; }
        W[f] = t.type === 'checkbox' ? t.checked : t.value;
        if (f === 'cls' || f === 'newCls') { W.archetype = ''; W.archMenu = false; W.picks = {}; }
        render();
      });
      wiz.addEventListener('click', async e => {
        const b = e.target.closest('[data-wa]'); if (!b) return;
        e.preventDefault();
        const a = b.dataset.wa;
        if (a === 'cancel') return closeModal();
        if (a === 'pick-power') {   // the same SW5e picker as on the sheet; Done comes back here
          return openPowerPicker(charId, b.dataset.kind, { taken: () => W.powers.map(x => x.name.toLowerCase()),
            caster: () => R.casterInfo(wizardPlan(charId, W).after),   // the max power level after this level
            onAdd: pw => W.powers.push(pw), onDone: () => openWizard(charId, W) });
        }
        if (a === 'rm-power') { W.powers.splice(+b.dataset.i, 1); render(); }
        if (a === 'arch-menu') { W.archMenu = !W.archMenu; draw(); }
        if (a === 'arch') { hideTip(); W.archetype = b.dataset.n; W.archMenu = false; render(); }
        if (a === 'go') {
          const plan = wizardPlan(charId, W);
          if (plan.error) return toast(plan.error, true);
          b.disabled = true;
          const r = await act('levelup.apply', plan.payload);
          if (!r) { b.disabled = false; return; }
          closeModal();
          toast(`Level ${r.level}! HP +${r.hpGain}${plan.payload.hpMode === 'roll' ? ` (rolled ${r.die})` : ''}${plan.payload.features.length ? ` · ${plan.payload.features.length} feature${plan.payload.features.length > 1 ? 's' : ''} added` : ''}`);
        }
      });
      render();
    });
  }

  // What the wizard will do, computed the same way the sheet computes things.
  function wizardPlan(charId, W) {
    const ch = S.st.characters[charId];
    const cls = W.cls === '__new' ? W.newCls.trim() : W.cls;
    const k = ch.classes.find(x => x.name.toLowerCase() === String(cls).toLowerCase());
    const newClassLevel = (k ? n0(k.level) : 0) + 1;
    const before = ch.classes.reduce((a, x) => a + n0(x.level), 0);
    const due = asiDue(cls, newClassLevel);
    const archDue = !!cls && newClassLevel === 3 && !(k && k.archetype);
    const archTerm = (R.CLASSES[cls] || {}).arch || `${cls} archetype`;
    const asiOn = due;
    let asi = null, feat = null, error = null;
    if (!cls) error = 'Pick a class to level up.';
    if (archDue && !W.archetype && (W.archList || []).length) error = error || `Pick your ${archTerm}.`;
    if (asiOn && W.asiMode === 'feat') { if (W.featName.trim()) feat = { name: W.featName.trim(), text: W.featText }; else error = error || 'Name the feat you picked.'; }
    else if (asiOn) {
      asi = W.asiMode === 'one' ? { [W.a1]: 2 } : { [W.a1]: 1, [W.a2]: 1 };
      if (W.asiMode === 'two' && W.a1 === W.a2) asi = { [W.a1]: 2 };
      for (const [ab, v] of Object.entries(asi)) if (n0(ch.abilities[ab]) + v > 20) error = error || `${ABN[ab]} can't go above 20.`;
    }
    const after = clone(ch);
    const kk = after.classes.find(x => x.name.toLowerCase() === String(cls).toLowerCase());
    if (kk) kk.level = newClassLevel; else after.classes.push({ name: cls, level: 1, archetype: '' });
    if (kk && archDue && W.archetype) kk.archetype = W.archetype;
    if (asi) for (const [ab, v] of Object.entries(asi)) after.abilities[ab] = n0(after.abilities[ab]) + v;
    // a feat from SW5e's list (audit 2.5): its prerequisite, checked at the new level, and a half-feat's own +1
    const fd = feat && W.feats ? W.feats.find(x => x.n.toLowerCase() === feat.name.toLowerCase()) : null;
    const prereq = fd ? R.featPrereq(after, fd.pre) : null;
    const featAsiOpts = fd ? [...new Set((fd.asi || []).flatMap(a => a === 'Any' ? R.ABILITIES.map(x => x.key) : R.ABILITIES.filter(x => x.name === a).map(x => x.key)))] : [];
    if (prereq && prereq.ok === false) error = error || `${fd.n} needs ${prereq.unmet.join(', ')}.`;
    if (featAsiOpts.length) {
      if (!featAsiOpts.includes(W.featAsi)) error = error || `Choose the ability ${fd.n} raises.`;
      else if (n0(ch.abilities[W.featAsi]) + 1 > 20) error = error || `${ABN[W.featAsi]} can't go above 20.`;
      else { feat.asi = { [W.featAsi]: 1 }; after.abilities[W.featAsi] = n0(after.abilities[W.featAsi]) + 1; }
    }
    // the Class, Multiclass and Splashclass Improvement feats (audit 2.17): their options, from SW5e's lists, at the new level
    const impKind = fd ? ({ 'class improvement': 'class', 'multiclass improvement': 'multi', 'splashclass improvement': 'splash' })[fd.n.toLowerCase()] : null;
    const impNeed = impKind === 'multi' ? 2 : impKind ? 1 : 0;
    const impOpts = impKind && W.improvements ? (W.improvements[impKind] || []).map(x => Object.assign({}, x, { q: R.featPrereq(after, x.pre) })) : [];
    const impPicked = (W.picks.improvement || []).filter(n => impOpts.some(x => x.n === n && x.q.ok !== false));
    if (impKind && !W.improvements && window.HTB && S.st.sw5eBooks !== false) error = error || 'Still looking up the improvement options…';
    else if (impKind && impOpts.length && impPicked.length !== impNeed) error = error || `${fd.n}: choose ${impNeed} option${impNeed > 1 ? 's' : ''} (${impPicked.length} chosen).`;
    const impFeatures = impPicked.map(n => { const x = impOpts.find(y => y.n === n); return { name: `${fd.n}: ${x.n}`.slice(0, 80), text: `${fd.n} (${x.n})\n${x.text}`.slice(0, 4000) }; });
    const hd = (R.CLASSES[cls] || {}).hd || 8;
    const oldCon = R.abilityMod(ch, 'con'), newCon = R.abilityMod(after, 'con');
    const retro = (newCon - oldCon) * before;
    const avgGain = Math.max(1, hd / 2 + 1 + newCon) + retro;
    const maxGain = Math.max(1, hd + newCon) + retro;
    if (W.hpMode === 'max' && S.st.hpMax === false) W.hpMode = 'average';
    // the choices this level brings (audit 2.9), each counted against what the class allows
    const groups = cls && W.lists && window.HTB && HTB.levelChoices ? HTB.levelChoices(ch, cls, newClassLevel, W.lists) : [];
    const tools = String(W.expTools || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 2);
    const picked = g => (W.picks[g.key] || []).filter(n => g.items.some(x => x.n === n));
    const chosen = g => picked(g).length + (g.kind === 'expertise' ? tools.length : 0);
    if (cls && window.HTB && HTB.levelChoices && S.st.sw5eBooks !== false && !W.lists && !W.listsErr) error = error || "Still looking up this level's choices…";
    // powers known (audit 2.10): the new level's table against the sheet; at least the level's own new powers
    const pkAfter = R.powersKnown(after), pkNow = R.powersKnown(ch), powerRoom = {};
    for (const t of ['force', 'tech']) {
      const gain = Math.max(0, pkAfter[t].max - pkNow[t].max), room = Math.max(gain, pkAfter[t].max - pkNow[t].known);
      const n = W.powers.filter(p => (p.type === 'tech' ? 'tech' : 'force') === t && p.name.trim()).length;
      powerRoom[t] = { gain, room, known: pkNow[t].known, max: pkAfter[t].max, n };
      if (pkAfter[t].max && n > room) error = error || `${t === 'force' ? 'Force' : 'Tech'} powers: up to ${room} new at this level (${n} picked).`;
    }
    for (const g of groups) {
      if (g.kind === 'powers') continue;
      const n = chosen(g);
      if (n < g.min || n > g.max) error = error || `${g.title}: choose ${g.min === g.max ? g.min : `${g.min} to ${g.max}`} (${n} chosen).`;
    }
    const choiceFeatures = groups.filter(g => g.kind !== 'powers' && g.kind !== 'expertise')
      .flatMap(g => picked(g).map(n => { const x = g.items.find(y => y.n === n); return { name: x.n, text: x.text }; }));
    const exp = groups.find(g => g.kind === 'expertise');
    if (exp && tools.length) choiceFeatures.push({ name: `Expertise: ${tools.join(', ')}`.slice(0, 80), text: `Expertise (${cls} ${newClassLevel}): your proficiency bonus is doubled for ${tools.join(' and ')}.` });
    const expertise = exp ? picked(exp).map(n => exp.items.find(x => x.n === n).key) : [];
    const unmet = !k && cls ? R.multiclassUnmet(ch, cls) : [];   // multiclassing prerequisites (2.12): the GM may allow it
    if (unmet.length && !isGM()) error = error || `Multiclassing into ${cls}: ${unmet.join('; ')}. Ask your GM.`;
    const payload = { charId, className: cls, hpMode: W.hpMode, archetype: archDue && W.archetype ? W.archetype : undefined, hitDie: hd, override: unmet.length && isGM() ? true : undefined,
      asi: asi || undefined, feat: feat || undefined, expertise: expertise.length ? expertise : undefined,
      features: choiceFeatures.concat(impFeatures, (W.auto || []).filter(f => !f.have).map(f => ({ name: f.name, text: f.text }))).slice(0, 20), powers: W.powers.filter(p => p.name.trim()).slice(0, 20) };
    return { ch, after, cls, k, newClassLevel, before, due, asiOn, archDue, archTerm, hd, oldCon, newCon, retro, avgGain, maxGain, payload, error, groups, picked, chosen, tools, powerRoom, fd, prereq, featAsiOpts, impKind, impNeed, impOpts };
  }

  // the chosen feat's prerequisite and, for a half-feat, which ability its +1 goes to (audit 2.5)
  function featInfoHtml(charId, W) {
    const P = wizardPlan(charId, W);
    if (!P.fd) return W.featName.trim() && W.feats ? '<p class="muted" style="margin:4px 0 0;font-size:12px">Not in SW5e\'s feat list, so nothing is checked.</p>' : '';
    const q = P.prereq, req = !P.fd.pre || /^none$/i.test(P.fd.pre) ? 'No prerequisite.'
      : `Requires ${esc(P.fd.pre)}: ${q.ok === true ? '<span class="up">✓ met</span>' : q.ok === false ? `<span class="error">✗ needs ${esc(q.unmet.join(', '))}</span>` : `<span class="muted">${esc(q.unknown.join(', '))} is your GM's call</span>`}`;
    return `<p style="margin:4px 0 0;font-size:12px">${req}</p>
      ${P.featAsiOpts.length ? `<div class="row" style="margin-top:4px;font-size:13px">${esc(P.fd.n)} raises one ability by 1:
        <select data-w="featAsi"><option value="">choose…</option>${P.featAsiOpts.map(k => `<option value="${k}" ${W.featAsi === k ? 'selected' : ''} ${n0(P.ch.abilities[k]) >= 20 ? 'disabled' : ''}>${ABN[k]} (${n0(P.ch.abilities[k])})</option>`).join('')}</select></div>` : ''}
      ${P.impKind && P.impOpts.length ? `<div style="margin-top:6px;font-size:13px">${esc(P.fd.n)}: choose ${P.impNeed} option${P.impNeed > 1 ? 's' : ''}
        <div class="wiz-opts" data-scroll="improvement">${P.impOpts.map(x => `<label class="wiz-opt" title="${esc(x.text.slice(0, 600))}"><input type="checkbox" data-w="pick.improvement" value="${esc(x.n)}"
          ${(W.picks.improvement || []).includes(x.n) ? 'checked' : ''} ${x.q.ok === false ? 'disabled' : ''}><span>${esc(x.n)}${x.q.ok === false ? ` <span class="muted">(needs ${esc(x.q.unmet.join(', '))})</span>` : ''}</span></label>`).join('')}</div></div>` : ''}`;
  }
  function wizardHtml(charId, W) {
    const P = wizardPlan(charId, W), ch = P.ch;
    const ciB = R.casterInfo(ch), ciA = R.casterInfo(P.after);
    const others = Object.keys(R.CLASSES).filter(c => !ch.classes.some(k => k.name === c));
    const change = (label, a, b) => `<tr><td>${label}</td><td>${esc(a)}</td><td>${String(a) === String(b) ? '' : '→'}</td><td class="${String(a) === String(b) ? 'muted' : 'up'}">${esc(b)}</td></tr>`;
    const abilitySelect = (f, v) => `<select data-w="${f}">${R.ABILITIES.map(a => `<option value="${a.key}" ${a.key === v ? 'selected' : ''} ${n0(ch.abilities[a.key]) >= 20 ? 'disabled' : ''}>${a.name} (${n0(ch.abilities[a.key])})</option>`).join('')}</select>`;
    const pend = pendingFor(charId);
    return `<h3>⬆ Level up ${esc(ch.name)} <span class="muted" style="font-weight:400">level ${P.before} → ${P.before + 1}</span></h3>
      ${pend && pend.count > 1 ? `<p class="muted" style="margin:0">${n0(pend.count)} levels waiting: this does one; open it again for the next.</p>` : ''}
      <section class="wiz-step"><h4><span class="step">1</span> Class</h4>
        <div class="choices">${ch.classes.map(k => `<label class="choice ${W.cls === k.name ? 'on' : ''}"><input type="radio" name="cls" data-w="cls" value="${esc(k.name)}" ${W.cls === k.name ? 'checked' : ''}>
          <b>${esc(k.name)}</b> ${n0(k.level)} → ${n0(k.level) + 1}${k.archetype ? `<br><span class="muted">${esc(k.archetype)}</span>` : ''}</label>`).join('')}
          <label class="choice ${W.cls === '__new' ? 'on' : ''}"><input type="radio" name="cls" data-w="cls" value="__new" ${W.cls === '__new' ? 'checked' : ''}><b>Multiclass</b><br><span class="muted">start a new class at 1</span></label></div>
        ${W.cls === '__new' ? `<div class="row" style="margin-top:6px"><select data-w="newCls"><option value="">Pick a class…</option>${others.map(c => `<option ${c === W.newCls ? 'selected' : ''}>${c}</option>`).join('')}</select>
          ${(un => un.length ? `<span class="wiz-warn" style="font-size:12px">⚠ ${esc(un.join('; '))}. ${isGM() ? 'As GM you can allow it anyway.' : 'Ask your GM: only they can allow it.'}</span>`
            : W.newCls ? `<span class="muted" style="font-size:12px">Prerequisites met. A new class gives its multiclass proficiencies: ${esc(R.mcProfs(W.newCls) || 'none')}.</span>` : '')(W.newCls ? R.multiclassUnmet(ch, W.newCls) : [])}</div>` : ''}
        ${P.archDue ? `<div class="arch-pick">
          <p class="muted" style="margin:6px 0 4px">At ${esc(P.cls)} level 3 you choose your ${esc(P.archTerm)}. You choose it once, and it gives you features as you level.</p>
          <div class="row wrap"><button class="btn small ${W.archetype ? '' : 'amber'}" data-wa="arch-menu" aria-expanded="${W.archMenu ? 'true' : 'false'}">${W.archetype ? 'Change' : 'Pick'} ${esc(P.archTerm)} ▾</button>
            ${W.archetype ? `<span class="arch-chosen">✓ <b>${esc(W.archetype)}</b></span>` : ''}</div>
          ${W.archMenu ? `<div class="arch-menu" role="listbox" aria-label="${esc(P.archTerm)}">${(W.archList || []).length
            ? W.archList.map(a => `<button role="option" data-wa="arch" data-n="${esc(a.n)}" data-arch-tip="${esc(a.n)}" class="${a.n === W.archetype ? 'on' : ''}">${esc(a.n)}${a.src ? ` <span class="pp-tag" title="${a.src === 'EC' ? 'Expanded Content' : "Player's Handbook"}">${esc(a.src)}</span>` : ''}</button>`).join('')
            : '<p class="muted" style="margin:4px">Loading the list…</p>'}</div>` : ''}</div>` : ''}
      </section>
      <section class="wiz-step"><h4><span class="step">2</span> Hit points <span class="muted" style="text-transform:none;letter-spacing:0">(d${P.hd}${P.newCon >= 0 ? ' + ' : ' − '}${Math.abs(P.newCon)} Con)</span></h4>
        <div class="choices">
          <label class="choice ${W.hpMode === 'average' ? 'on' : ''}"><input type="radio" name="hp" data-w="hpMode" value="average" ${W.hpMode === 'average' ? 'checked' : ''}><b>Take the average</b><br><span class="muted">+${P.avgGain} HP</span></label>
          <label class="choice ${W.hpMode === 'roll' ? 'on' : ''}"><input type="radio" name="hp" data-w="hpMode" value="roll" ${W.hpMode === 'roll' ? 'checked' : ''}><b>Roll the die</b><br><span class="muted">+${Math.max(1, 1 + P.newCon) + P.retro} to +${P.hd + P.newCon + P.retro} HP, rolled where everyone sees it</span></label>
          ${S.st.hpMax === false ? '' : `<label class="choice ${W.hpMode === 'max' ? 'on' : ''}"><input type="radio" name="hp" data-w="hpMode" value="max" ${W.hpMode === 'max' ? 'checked' : ''}><b>Take the maximum</b><br><span class="muted">+${P.maxGain} HP (the full d${P.hd})</span></label>`}
        </div>
        ${P.retro ? `<p class="muted" style="font-size:12px;margin:4px 0 0">Includes +${P.retro} because your Constitution modifier went up (it counts for every earlier level too).</p>` : ''}
      </section>
      <section class="wiz-step"><h4><span class="step">3</span> Ability score improvement or feat</h4>
        ${!P.cls ? '<p class="muted" style="margin:0">Pick a class first.</p>' : P.due ? `<p class="muted" style="margin:0 0 6px">${esc(P.cls)} ${P.newClassLevel} gives an ability score improvement (or a feat instead).</p>`
          : `<p class="muted" style="margin:0">Your class does not receive an ability score improvement at this level.</p>`}
        ${P.asiOn ? `<div class="choices" style="margin-top:6px">
          ${[['two', '+1 to two scores'], ['one', '+2 to one score'], ['feat', 'Take a feat']].map(([v, t]) => `<label class="choice ${W.asiMode === v ? 'on' : ''}"><input type="radio" name="asi" data-w="asiMode" value="${v}" ${W.asiMode === v ? 'checked' : ''}><b>${t}</b></label>`).join('')}</div>
          <div class="row wrap" style="margin-top:6px">${W.asiMode === 'feat'
            ? `<input data-w="featName" type="text" list="wizFeats" value="${esc(W.featName)}" placeholder="Pick or type a feat" style="flex:1"><datalist id="wizFeats">${(W.featList || []).map(f => `<option value="${esc(f)}">`).join('')}</datalist>
               <textarea data-w="featText" rows="3" placeholder="What it does (filled in from SW5e when you pick one)">${esc(W.featText)}</textarea>
               <div id="wizFeatInfo" style="width:100%">${featInfoHtml(charId, W)}</div>`
            : W.asiMode === 'one' ? abilitySelect('a1', W.a1) : abilitySelect('a1', W.a1) + abilitySelect('a2', W.a2)}</div>` : ''}
      </section>
      ${choicesHtml(P, W)}
      <section class="wiz-step"><h4><span class="step">5</span> New features &amp; powers</h4>
        ${!P.cls ? '' : W.autoState === 'loading' ? '<p class="muted" style="margin:0 0 6px">Looking up the class features for this level…</p>'
          : W.auto && W.auto.length ? `<p class="muted" style="margin:0 0 4px">These ${esc(P.cls)} ${P.newClassLevel} features from the Player's Handbook are added to Features &amp; Traits automatically (hover for details):</p>
            <ul class="wiz-feats">${W.auto.map(f => `<li title="${esc(f.text.slice(0, 500))}"><b>${esc(f.name)}</b>${f.have ? ' <span class="muted">(already on the sheet)</span>' : ''}</li>`).join('')}</ul>`
          : W.autoState === 'ok' ? `<p class="muted" style="margin:0 0 6px">No new ${esc(P.cls)} features at level ${P.newClassLevel}${P.due ? ' besides the ability score improvement' : ''}.</p>`
          : W.autoState ? `<p class="muted" style="margin:0 0 6px">Couldn't look up the class features (${esc(W.autoState)}). You can add them afterwards from Features &amp; Traits.</p>` : ''}
        <h5 class="wiz-sub">Powers learned this level ${ciA.forceMaxLevel > ciB.forceMaxLevel || ciA.techMaxLevel > ciB.techMaxLevel ? '<span class="up">· you can now cast higher-level powers</span>' : ''}</h5>
        ${['force', 'tech'].filter(t => P.powerRoom[t].max).map(t => { const q = P.powerRoom[t];
          return `<p class="${q.n > q.room ? 'error' : 'muted'}" style="margin:0 0 4px">${t === 'force' ? 'Force' : 'Tech'} powers known: the table allows ${q.max} after this level; the sheet has ${q.known}. Learn up to ${q.room} (${q.n} picked).</p>`; }).join('')}
        ${W.powers.map((p, i) => `<div class="row wiz-power"><b>${esc(p.name)}</b><span class="pp-lvl">${n0(p.level) ? 'Level ' + n0(p.level) : 'At-will'}</span>
          <span class="pp-tag">${p.type === 'tech' ? 'Tech' : esc(({ light: 'Light', dark: 'Dark' })[p.alignment] || 'Universal') + ' force'}</span><span class="spacer"></span>
          <button class="btn tiny ghost" data-wa="rm-power" data-i="${i}" title="Remove">✕</button></div>`).join('') || '<p class="muted" style="margin:0 0 4px">None picked.</p>'}
        <div class="row"><button class="btn tiny" data-wa="pick-power" data-kind="force">＋ force power</button><button class="btn tiny" data-wa="pick-power" data-kind="tech">＋ tech power</button></div>
      </section>
      <section class="wiz-step"><h4><span class="step">6</span> Summary</h4>
        <table class="t summary">
          ${change('Level', P.before, P.before + 1)}
          ${change('Class', P.k ? `${P.k.name} ${n0(P.k.level)}` : '—', `${P.cls || '?'} ${P.newClassLevel}`)}
          ${P.archDue ? change(P.archTerm, '—', W.archetype || 'not picked yet') : ''}
          ${change('Hit points (max)', n0(ch.hp.max), W.hpMode === 'roll' ? `${n0(ch.hp.max)} + roll` : n0(ch.hp.max) + (W.hpMode === 'max' ? P.maxGain : P.avgGain))}
          ${change('Hit dice', R.hitDiceSummary(ch), R.hitDiceSummary(P.after))}
          ${change('Proficiency bonus', R.fmt(R.profBonus(ch)), R.fmt(R.profBonus(P.after)))}
          ${ciB.forceMax || ciA.forceMax ? change('Force points (max)', ciB.forceMax, ciA.forceMax) : ''}
          ${ciB.techMax || ciA.techMax ? change('Tech points (max)', ciB.techMax, ciA.techMax) : ''}
          ${ciB.forceMaxLevel || ciA.forceMaxLevel ? change('Max force power level', ciB.forceMaxLevel, ciA.forceMaxLevel) : ''}
          ${ciB.techMaxLevel || ciA.techMaxLevel ? change('Max tech power level', ciB.techMaxLevel, ciA.techMaxLevel) : ''}
          ${R.ABILITIES.filter(a => n0(ch.abilities[a.key]) !== n0(P.after.abilities[a.key])).map(a => change(a.name, n0(ch.abilities[a.key]), n0(P.after.abilities[a.key]))).join('')}
        </table>
        ${ch.force.max !== '' || ch.tech.max !== '' ? '<p class="muted" style="font-size:12px">This sheet has a manual force/tech point max set; update it on the Attacks &amp; Powers tab if it should change.</p>' : ''}
        ${P.error ? `<p class="error">${esc(P.error)}</p>` : ''}
      </section>
      <div class="row"><span class="spacer"></span><button class="btn" data-wa="cancel">Not yet</button><button class="btn primary" data-wa="go">⬆ Level up!</button></div>`;
  }

  // Step 4 of the level-up wizard (audit 2.9): what the class asks you to choose at this level, with the count.
  function choicesHtml(P, W) {
    const groups = P.groups.filter(g => g.kind !== 'powers');
    const body = !P.cls ? '<p class="muted" style="margin:0">Pick a class first.</p>'
      : W.listsErr ? `<p class="muted" style="margin:0">Couldn't look up this level's choices (${esc(W.listsErr)}). Add them afterwards from Features &amp; Traits.</p>`
      : !W.lists ? (window.HTB && HTB.levelChoices && S.st.sw5eBooks !== false ? '<p class="muted" style="margin:0">Looking up this level\'s choices…</p>' : '<p class="muted" style="margin:0">Add any choices this level gives from Features &amp; Traits afterwards.</p>')
      : !groups.length ? `<p class="muted" style="margin:0">${esc(P.cls)} ${P.newClassLevel} has nothing to choose from a list.</p>`
      : groups.map(g => {
        const n = P.chosen(g), ok = n >= g.min && n <= g.max, mine = W.picks[g.key] || [];
        const want = g.min === g.max ? `choose ${g.min}` : `choose ${g.min} to ${g.max}`;
        const why = g.kind === 'expertise' ? 'Two of your skill proficiencies, or a tool (name it), get double your proficiency bonus.'
          : g.kind === 'style' ? 'A style of fighting as your specialty.'
          : `${/^[aeiou]/i.test(P.cls) ? 'An' : 'A'} ${esc(P.cls)} ${P.newClassLevel} knows ${g.total}; the sheet has ${g.have}.`;
        return `<div class="wiz-choice"><h5 class="wiz-sub">${esc(g.title)}: ${want} <span class="${ok ? 'up' : 'muted'}">· ${n} chosen</span></h5>
          <p class="muted" style="margin:0 0 4px;font-size:12px">${why}</p>
          <div class="wiz-opts" data-scroll="${esc(g.key)}">${g.items.map(x => `<label class="wiz-opt" ${x.text ? `title="${esc(x.text.slice(0, 600))}"` : ''}><input type="checkbox" data-w="pick.${esc(g.key)}" value="${esc(x.n)}" ${mine.includes(x.n) ? 'checked' : ''}><span>${esc(x.n)}${x.pre ? ` <span class="muted">(${esc(x.pre)})</span>` : ''}</span></label>`).join('')
            || (g.kind === 'expertise' ? '<p class="muted" style="margin:0">No skill proficiencies on the sheet yet.</p>' : '')}</div>
          ${g.kind === 'expertise' ? `<input type="text" data-w="expTools" value="${esc(W.expTools)}" placeholder="or a tool, e.g. Slicer's kit (comma between two)" style="margin-top:4px;width:100%">` : ''}</div>`;
      }).join('');
    return `<section class="wiz-step"><h4><span class="step">4</span> Choices at this level</h4>${body}</section>`;
  }

  // --------------------------------------------------------------------------- shared with books.js
  window.HT = { S, $, $$, esc, n0, R, API, modal, closeModal, toast, act, post, mutate, isGM, chars, roll, rollModeFromEvent, setPath, renderRules, setTab, drawMap, scoresDialog };

  // --------------------------------------------------------------------------- boot
  window.addEventListener('resize', () => drawMap());
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeModal(); closeTokenPop();
    if (M.script) { M.script = null; renderScriptBar(); drawMap(); }
    if (A.stamp) stopStamp();
    if (M.selProp) { M.selProp = null; drawMap(); }
  });
  applyPrefs(store.get('holo.theme', null));
  renderRules();
  $('#loginForm [name=name]').value = store.get('holo.name', '');
  // already signed in (the session cookie is HttpOnly, so ask the server)
  fetch(`${API}?op=me`, { credentials: 'same-origin', cache: 'no-store' }).then(async r => {
    const j = await r.json().catch(() => ({}));
    if (r.ok) enterTable();
    else if (r.status === 503) $('#lobbyError').textContent = j.error || 'HoloTable is not available right now.';
  }).catch(() => { $('#lobbyError').textContent = "Can't reach the server."; });
})();
