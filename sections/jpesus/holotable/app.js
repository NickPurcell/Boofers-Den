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
  function downscale(file, maxDim, quality = 0.85) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const sc = Math.min(1, maxDim / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
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
        if (j.state) { S.v = j.v; onState(j.state); }
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
      const v = JSON.stringify(S.st.variants || []);
      if (v !== S.variantsSeen) { S.variantsSeen = v; if (!$('#rules .lib') && !($('#rulesSearch') || {}).value) renderRules(); }
    }
    renderMapTools(); loadMapBg(); drawMap();
    renderChat();
  }

  // --------------------------------------------------------------------------- top bar
  function renderTop() {
    const bar = $('#missingBar');
    bar.classList.toggle('hidden', !S.st.missing);
    if (S.st.missing) bar.innerHTML = isGM()
      ? `⚠ The table's save is missing (the database may have been full). Nothing can be changed until it's restored.
         <button class="btn small amber-fill" id="restoreLatest">Restore latest backup</button> <span class="muted">or pick one in the GM tab</span>`
      : `⚠ The table's save is missing. The GM needs to restore a backup before play can continue.`;
    $('#campName').textContent = S.st.name;
    const gmTag = n => (/^\s*gm\s*$/i.test(n || '') ? '' : ' (GM)');
    $('#online').innerHTML = S.st.online.map(o => `<span class="pill ${o.gm ? 'gm' : ''}">${esc(o.name)}${o.gm ? gmTag(o.name) : ''}</span>`).join('');
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
  $('#newCharBtn').addEventListener('click', async () => {
    const c = R.blankCharacter();
    c.name = (me() && me().name ? me().name + "'s character" : 'New Character');
    c.color = ['#4fc3f7', '#ffb74d', '#66bb6a', '#ef5350', '#b388ff', '#f06292', '#4db6ac'][Math.floor(Math.random() * 7)];
    const r = await act('char.save', { char: c });
    if (r) { S.selected = r.id; S.sub = 'main'; setTab('sheet'); }
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
        const { dataUrl } = await downscale(f, kind === 'token' ? 400 : 800, 0.86);
        await post('upload', { purpose: 'photo', charId: ch.id, kind, dataUrl });
        toast(kind === 'token' ? 'Token photo updated' : 'Profile photo updated');
      } catch (err) { toast(err.message || 'Could not upload that image', true); }
    };
    inp.click();
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
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });

  // --------------------------------------------------------------------------- sheet
  function saveChar(ch) {
    S.st.characters[ch.id] = ch;
    renderRoster();
    return act('char.save', { char: ch });
  }
  function mutate(fn) {
    const ch = clone(selChar()); fn(ch); saveChar(ch); guarded('sheet', renderSheet);
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

  function renderSheet(el) {
    const ch = selChar();
    if (!ch) {
      el.innerHTML = `<div class="empty"><h2>No character selected</h2>
        <p>Upload your sheet from the SW5e character builder (the Roll20 export or character JSON), or build one from scratch.</p>
        <div class="row" style="justify-content:center"><button class="btn primary" onclick="document.getElementById('importBtn').click()">⇪ Upload sheet</button>
        <button class="btn" onclick="document.getElementById('newCharBtn').click()">＋ New character</button></div></div>`;
      return;
    }
    const ro = !canEdit(ch);
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
        </div>
        <div class="row wrap">${(ch.classes || []).map((k, i) => `
          <span class="row">${inp(`classes.${i}.name`, k.name, { ro, list: 'dlClasses', w: '110px' })}
          ${inp(`classes.${i}.level`, +k.level || 1, { ro, type: 'number', w: '58px' })}
          ${k.archetype ? `<span class="muted class-arch" title="${esc((R.CLASSES[k.name] || {}).arch || 'Archetype')}">${esc(k.archetype)}</span>` : ''}
          ${!ro && ch.classes.length > 1 ? `<button class="btn tiny ghost" data-act="del-class" data-i="${i}">✕</button>` : ''}</span>`).join('')}
        </div>
      </div>
      <div class="sheet-actions">
        <button class="btn small amber" data-act="init">⚔ Initiative</button>
        ${pendingFor(ch.id) && !ro ? `<button class="btn small lvl-go" data-act="levelup">⬆ Level up${n0(pendingFor(ch.id).count) > 1 ? ' ×' + n0(pendingFor(ch.id).count) : ''}</button>` : ''}
        ${isGM() && !pendingFor(ch.id) ? '<button class="btn small ghost" data-act="grant" title="Give this character a new level">⬆ Grant level</button>' : ''}
        <button class="btn small" data-act="token">◉ Token</button>
        <button class="btn small" data-act="export">⇩ Export</button>
        ${!ro ? '<button class="btn small danger" data-act="delete">Delete</button>' : ''}
      </div>
    </div>
    <div class="stats-row">
      <div class="stat"><div class="lbl">Armor Class</div>${inp('ac', +ch.ac || 10, { ro, type: 'number' })}</div>
      <div class="stat rollable" data-roll="${d20(R.initiative(ch))}" data-label="Initiative" data-d20="1"><div class="lbl">Initiative</div><div class="val">${R.fmt(R.initiative(ch))}</div></div>
      <div class="stat"><div class="lbl">Speed</div>${inp('speed', +ch.speed || 30, { ro, type: 'number' })}</div>
      <div class="stat"><div class="lbl">Proficiency</div><div class="val">${R.fmt(pb)}</div></div>
      <div class="stat"><div class="lbl">Passive Perc.</div><div class="val">${R.passive(ch, 'perception')}</div></div>
      <div class="stat"><div class="lbl">Hit Dice</div><div class="val" style="font-size:15px;padding-top:6px">${esc(R.hitDiceSummary(ch))}</div>
        <div class="muted" style="font-size:11px">used ${inp('hitDiceUsed', +ch.hitDiceUsed || 0, { ro, type: 'number', w: '58px' })}</div></div>
      <div class="stat"><div class="lbl">Inspiration</div><div style="padding-top:6px">${inp('inspiration', ch.inspiration, { ro, type: 'checkbox' })}</div></div>
    </div>
    <div class="subtabs">${[['main', 'Abilities & Skills'], ['actions', 'Attacks & Powers'], ['gear', 'Features & Gear'], ['bio', 'Bio & Notes']]
      .map(([k, t]) => `<button data-act="sub" data-sub="${k}" class="${sub === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;

    if (sub === 'main') {
      html += `<div class="stats-row">${R.ABILITIES.map(a => {
        const m = R.abilityMod(ch, a.key);
        return `<div class="stat ability"><div class="lbl">${a.name}</div>
          <div class="val" data-roll="${d20(m)}" data-label="${a.name} check" data-d20="1">${R.fmt(m)}</div>
          ${inp('abilities.' + a.key, +ch.abilities[a.key] || 10, { ro, type: 'number' })}</div>`;
      }).join('')}</div>
      <div class="grid g2">
        <div class="box hp-box"><h4>Hit Points</h4>
          <div class="row wrap"><span>${inp('hp.current', +ch.hp.current || 0, { ro, type: 'number', cls: 'hpnum' })}</span><span class="muted">/</span>
            <span>${inp('hp.max', +ch.hp.max || 0, { ro, type: 'number', cls: 'hpnum' })}</span>
            <span class="muted">temp</span>${inp('hp.temp', +ch.hp.temp || 0, { ro, type: 'number', w: '60px' })}</div>
          ${!ro ? `<div class="row hp-adjust" style="margin-top:8px"><input id="hpDelta" placeholder="-7 or +5">
            <button class="btn small danger" data-act="hp" data-sign="-1">Damage</button><button class="btn small" data-act="hp" data-sign="1" style="color:var(--green)">Heal</button></div>
          <div class="row" style="margin-top:8px"><button class="btn small" data-act="short-rest">Spend Hit Die</button><button class="btn small" data-act="long-rest">Long Rest</button></div>` : ''}
          <h4 style="margin-top:12px">Death Saves</h4>
          <div class="row"><span class="muted">Successes</span><span class="dots">${[1, 2, 3].map(n => `<span class="dot s ${ch.deathSaves.s >= n ? 'on' : ''}" data-act="ds" data-k="s" data-n="${n}"></span>`).join('')}</span>
            <span class="muted">Failures</span><span class="dots">${[1, 2, 3].map(n => `<span class="dot f ${ch.deathSaves.f >= n ? 'on' : ''}" data-act="ds" data-k="f" data-n="${n}"></span>`).join('')}</span>
            ${!ro ? '<button class="btn tiny" data-act="death-roll">Roll</button>' : ''}</div>
          <h4 style="margin-top:12px">Conditions</h4>
          <div>${(ch.conditions || []).map((c, i) => `<span class="chip" title="${esc(R.CONDITIONS[c] || '')}">${esc(c)}${!ro ? `<button data-act="rm-cond" data-i="${i}">✕</button>` : ''}</span>`).join('') || '<span class="muted">None</span>'}
            ${!ro ? `<select data-act-change="add-cond"><option value="">+ add…</option>${Object.keys(R.CONDITIONS).map(c => `<option>${c}</option>`).join('')}</select>` : ''}</div>
          <div class="row" style="margin-top:8px"><span class="muted">Exhaustion</span>${inp('exhaustion', +ch.exhaustion || 0, { ro, type: 'number', w: '56px' })}</div>
        </div>
        <div class="box"><h4>Saving Throws</h4><div class="list-rows">${R.ABILITIES.map(a => {
          const b = R.saveBonus(ch, a.key);
          return `<div class="lr"><button class="prof ${ch.saves[a.key] ? 'p1' : ''}" data-act="save-prof" data-ab="${a.key}" ${ro ? 'disabled' : ''}></button>
            <span class="bonus">${R.fmt(b)}</span><span class="nm rollable" data-roll="${d20(b)}" data-label="${a.name} save" data-d20="1">${a.name}</span></div>`;
        }).join('')}</div></div>
        <div class="box" style="grid-row: span 2"><h4>Skills <span class="muted" style="text-transform:none;letter-spacing:0">click dot: none → proficient → expertise</span></h4><div class="list-rows">${R.SKILLS.map(s => {
          const b = R.skillBonus(ch, s.key), lv = +(ch.skills[s.key] || 0);
          return `<div class="lr"><button class="prof ${lv === 2 ? 'p2' : lv === 1 ? 'p1' : lv === 0.5 ? 'p05' : ''}" data-act="skill-prof" data-sk="${s.key}" ${ro ? 'disabled' : ''}></button>
            <span class="bonus">${R.fmt(b)}</span><span class="nm rollable" data-roll="${d20(b)}" data-label="${s.name}" data-d20="1">${s.name}</span><span class="ab">${s.ab}</span></div>`;
        }).join('')}</div></div>
      </div>`;
    }

    if (sub === 'actions') {
      const fMax = ch.force.max !== '' && ch.force.max != null ? +ch.force.max : ci.forceMax;
      const tMax = ch.tech.max !== '' && ch.tech.max != null ? +ch.tech.max : ci.techMax;
      const pts = (k, max, used, cls, label, extra) => `<div class="box"><h4>${label}</h4>
        <div class="points"><b>${Math.max(0, max - used)}</b><span class="muted">/ ${max}</span>
          <div class="meter ${cls}"><div style="width:${max ? 100 * Math.max(0, max - used) / max : 0}%"></div></div>
          <span class="muted">used</span>${inp(k + '.used', +used || 0, { ro, type: 'number' })}
          <span class="muted">max override</span>${inp(k + '.max', ch[k].max ?? '', { ro, type: 'number', ph: String(k === 'force' ? ci.forceMax : ci.techMax) })}</div>
        <div class="muted" style="margin-top:6px;font-size:12px">${extra}</div></div>`;
      html += `<div class="box"><h4>Attacks <span class="spacer"></span>${!ro ? `<button class="btn tiny" data-act="pick-weapon">＋ weapon from SW5e</button><button class="btn tiny ghost" data-act="add-attack">custom</button>` : ''}</h4>
        <table class="t"><thead><tr><th>Name</th><th>Ability</th><th>Hit</th><th>Damage die</th><th>Type</th><th>Properties</th><th></th></tr></thead><tbody>
        ${(ch.attacks || []).map((a, i) => {
          const hit = R.attackBonus(ch, a), dmg = R.damageExpr(ch, a);
          return `<tr><td>${inp(`attacks.${i}.name`, a.name, { ro })}</td>
            <td style="width:96px">${inp(`attacks.${i}.ab`, a.ab || 'str', { ro, type: 'select', options: [{ v: 'str', t: 'Str' }, { v: 'dex', t: 'Dex' }, { v: 'finesse', t: 'Finesse' }, { v: 'con', t: 'Con' }, { v: 'int', t: 'Int' }, { v: 'wis', t: 'Wis' }, { v: 'cha', t: 'Cha' }] })}</td>
            <td style="width:120px"><button class="btn small amber" data-act="atk" data-i="${i}">${R.fmt(hit)}</button> ${inp(`attacks.${i}.magic`, a.magic || '', { ro, type: 'number', w: '58px', ph: '+0' })}</td>
            <td style="width:160px"><div class="row">${inp(`attacks.${i}.damage`, a.damage || '', { ro, w: '64px' })}<button class="btn small" data-act="dmg" data-i="${i}" title="${esc(dmg)}">Dmg</button><button class="btn tiny" data-act="crit" data-i="${i}" title="Critical: dice doubled">Crit</button></div></td>
            <td style="width:100px">${inp(`attacks.${i}.type`, a.type || '', { ro, list: 'dlTypes' })}</td>
            <td>${inp(`attacks.${i}.props`, a.props || '', { ro })}</td>
            <td>${!ro ? `<button class="btn tiny ghost" data-act="del" data-list="attacks" data-i="${i}">✕</button>` : ''}</td></tr>`;
        }).join('') || '<tr><td colspan="7" class="muted">No attacks yet.</td></tr>'}</tbody></table>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Hit = ability mod + proficiency (+ the small box for enhancements). Damage adds the ability mod automatically.</p></div>
      <div class="grid g2" style="margin-top:12px">
        ${pts('force', fMax, +ch.force.used || 0, '', 'Force Points', `Light DC ${ci.lightDC} / atk ${R.fmt(ci.lightAtk)} · Dark DC ${ci.darkDC} / atk ${R.fmt(ci.darkAtk)}${ci.forceMaxLevel ? ' · max power level ' + ci.forceMaxLevel : ''}`)}
        ${pts('tech', tMax, +ch.tech.used || 0, 'tech', 'Tech Points', `Tech DC ${ci.techDC} / atk ${R.fmt(ci.techAtk)}${ci.techMaxLevel ? ' · max power level ' + ci.techMaxLevel : ''}`)}
      </div>
      <div class="box" style="margin-top:12px"><h4>Powers <span class="spacer"></span>${!ro ? `<button class="btn tiny" data-act="pick-power" data-kind="force">＋ force power</button>
          <button class="btn tiny" data-act="pick-power" data-kind="tech">＋ tech power</button>
          <button class="btn tiny ghost" data-act="add-power" title="Add a homebrew power by hand">custom</button>` : ''}</h4>
        <table class="t"><thead><tr><th>Name</th><th>Lvl</th><th>Type</th><th>Alignment</th><th>Notes</th><th></th><th></th></tr></thead><tbody>
        ${(ch.powers || []).slice().map((p, i) => ({ p, i })).sort((a, b) => (+a.p.level || 0) - (+b.p.level || 0)).map(({ p, i }) => `<tr data-power-tip="${i}">
          <td>${inp(`powers.${i}.name`, p.name, { ro })}</td>
          <td class="n">${inp(`powers.${i}.level`, +p.level || 0, { ro, type: 'number' })}</td>
          <td style="width:90px">${inp(`powers.${i}.type`, p.type || 'force', { ro, type: 'select', options: ['force', 'tech'] })}</td>
          <td style="width:110px">${p.type === 'tech' ? '' : inp(`powers.${i}.alignment`, p.alignment || 'universal', { ro, type: 'select', options: ['universal', 'light', 'dark'] })}</td>
          <td>${inp(`powers.${i}.notes`, p.notes || '', { ro, ph: 'range, duration, effect…' })}</td>
          <td style="width:60px"><button class="btn small amber" data-act="cast" data-i="${i}">Cast</button></td>
          <td style="white-space:nowrap">${!ro ? `<button class="btn tiny ghost" data-act="power-desc" data-i="${i}" title="Write or edit this power's description">✎</button><button class="btn tiny ghost" data-act="del" data-list="powers" data-i="${i}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No powers.</td></tr>'}</tbody></table>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Hover a power for its details. Casting costs 1 + power level points (level 0 at-wills are free).</p></div>`;
    }

    if (sub === 'gear') {
      html += `<div class="grid g2">
        <div class="box"><h4>Equipment <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-act="pick-equip">＋ from SW5e</button><button class="btn tiny ghost" data-act="add-item" title="Add an item by hand">custom</button>' : ''}</h4>
          <div class="row" style="margin-bottom:8px"><span class="muted">Credits</span>${inp('credits', +ch.credits || 0, { ro, type: 'number', w: '120px' })}</div>
          <table class="t"><thead><tr><th>Qty</th><th>Item</th><th>Notes</th><th>Eq.</th><th></th></tr></thead><tbody>
          ${(ch.equipment || []).map((e, i) => `<tr><td class="n">${inp(`equipment.${i}.qty`, +e.qty || 1, { ro, type: 'number' })}</td>
            <td>${inp(`equipment.${i}.name`, e.name, { ro })}</td><td>${inp(`equipment.${i}.notes`, e.notes || '', { ro })}</td>
            <td>${inp(`equipment.${i}.equipped`, e.equipped, { ro, type: 'checkbox' })}</td>
            <td>${!ro ? `<button class="btn tiny ghost" data-act="del" data-list="equipment" data-i="${i}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Empty.</td></tr>'}
          </tbody></table></div>
        <div class="box"><h4>Features & Traits <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-act="pick-feature" title="Feats, class features, maneuvers, fighting styles, lightsaber forms, ventures">＋ from SW5e</button><button class="btn tiny ghost" data-act="add-feature" title="Write a feature by hand">custom</button>' : ''}</h4>
          <div class="feature-list">${(ch.features || []).map((f, i) => `<div class="feature-row">
            <span class="feature-name" data-feature-tip="${i}" tabindex="0">${esc(f.name || 'Feature')}</span>
            <span class="spacer"></span>
            <button class="btn tiny" data-act="share-feature" data-i="${i}" title="Post to chat">💬</button>
            ${!ro ? `<button class="btn tiny ghost" data-act="del" data-list="features" data-i="${i}" title="Remove">✕</button>` : ''}</div>`).join('') || '<p class="muted">None.</p>'}</div>
          ${(ch.features || []).length ? '<p class="muted" style="font-size:12px;margin:6px 0 0">Hover a feature for its description.</p>' : ''}
        </div>
        <div class="box"><h4>Proficiencies</h4>${inp('proficiencies', ch.proficiencies || '', { ro, type: 'textarea', rows: 3, ph: 'Armor, weapons, tools…' })}
          <h4 style="margin-top:10px">Languages</h4>${inp('languages', ch.languages || '', { ro, type: 'textarea', rows: 2 })}</div>
      </div>`;
    }

    if (sub === 'bio') {
      html += `<div class="grid g2">
        <div class="box"><h4>Appearance</h4>
          ${!ro ? `<div class="row wrap" style="margin-bottom:8px"><button class="btn small" data-act="photo" data-kind="profile">📷 Upload profile photo</button>
            <button class="btn small" data-act="photo" data-kind="token">◉ Upload token photo</button>
            ${ch.image ? '<button class="btn small ghost" data-act="clear-photo">Remove profile photo</button>' : ''}
            ${ch.tokenImage ? '<button class="btn small ghost" data-act="clear-token-photo">Token: use profile photo</button>' : ''}</div>` : ''}
          <p class="muted" style="font-size:12px;margin:0 0 6px">The token uses the profile photo unless you upload a separate one.</p>
          <label style="margin-top:8px">Token colour${inp('color', ch.color || '#4fc3f7', { ro, type: 'color' })}</label>
          <label style="margin-top:8px">Experience points${inp('xp', +ch.xp || 0, { ro, type: 'number' })}</label>
          <label style="margin-top:8px">Proficiency bonus override${inp('profOverride', ch.profOverride ?? '', { ro, type: 'number', ph: String(2 + Math.floor((lvl - 1) / 4)) })}</label>
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
    if (!val) return;
    if (kind === 'add-cond') mutate(c => { c.conditions = [...new Set([...(c.conditions || []), val])]; });
    if (kind === 'add-weapon') { const w = R.WEAPONS[+val]; mutate(c => c.attacks.push({ name: w.name, ab: w.ab, damage: w.damage, type: w.type, props: w.props, proficient: true })); }
    if (kind === 'assign') act('char.assign', { id: S.selected, owner: val });
    t.value = '';
  }
  $('#sheet').addEventListener('click', async e => {
    const ch = selChar();
    const r = e.target.closest('[data-roll]');
    if (r && ch) return roll(r.dataset.roll, `${r.dataset.label}`, { d20: !!r.dataset.d20, mode: rollModeFromEvent(e), charId: ch.id });
    const b = e.target.closest('[data-act]'); if (!b || !ch) return;
    const a = b.dataset.act, i = +b.dataset.i, ro = !canEdit(ch);
    const pub = ['sub', 'export', 'atk', 'dmg', 'crit', 'dismiss-note', 'share-feature'];
    if (ro && !pub.includes(a)) return;
    switch (a) {
      case 'sub': S.sub = b.dataset.sub; renderSheet($('#sheet')); break;
      case 'dismiss-note': delete S.importNotes[ch.id]; renderSheet($('#sheet')); break;
      case 'del-class': mutate(c => c.classes.splice(i, 1)); break;
      case 'save-prof': mutate(c => { c.saves[b.dataset.ab] = !c.saves[b.dataset.ab]; }); break;
      case 'skill-prof': mutate(c => { const v = +(c.skills[b.dataset.sk] || 0); c.skills[b.dataset.sk] = v === 0 ? 1 : v === 1 ? 2 : 0; }); break;
      case 'hp': {
        const raw = $('#hpDelta').value.trim(); const n = Math.abs(parseInt(raw, 10)); if (!n) return;
        const sign = raw.startsWith('-') ? -1 : raw.startsWith('+') ? 1 : +b.dataset.sign;
        mutate(c => {
          if (sign < 0) { let d = n; const t = Math.min(+c.hp.temp || 0, d); c.hp.temp = (+c.hp.temp || 0) - t; d -= t; c.hp.current = Math.max(0, (+c.hp.current || 0) - d); }
          else { c.hp.current = Math.min(+c.hp.max || 0, (+c.hp.current || 0) + n); if (c.hp.current > 0) c.deathSaves = { s: 0, f: 0 }; }
        });
        break;
      }
      case 'short-rest': {
        const lvl = R.totalLevel(ch);
        if ((+ch.hitDiceUsed || 0) >= lvl) return toast('No hit dice left — take a long rest.', true);
        const hd = Math.max(...(ch.classes || []).map(k => (R.CLASSES[k.name] || {}).hd || 8));
        const res = await roll(`1d${hd}${R.fmt(R.abilityMod(ch, 'con'))}`, 'Hit Die (short rest)', { charId: ch.id });
        if (res) mutate(c => { c.hitDiceUsed = (+c.hitDiceUsed || 0) + 1; c.hp.current = Math.min(+c.hp.max, (+c.hp.current || 0) + Math.max(0, res.roll.total)); });
        break;
      }
      case 'long-rest':
        mutate(c => {
          c.hp.current = +c.hp.max; c.hp.temp = 0; c.force.used = 0; c.tech.used = 0; c.deathSaves = { s: 0, f: 0 };
          c.hitDiceUsed = Math.max(0, (+c.hitDiceUsed || 0) - Math.max(1, Math.floor(R.totalLevel(c) / 2)));
          c.exhaustion = Math.max(0, (+c.exhaustion || 0) - 1);
        });
        act('chat', { text: `*${ch.name} takes a long rest. HP, force & tech points restored.*`, as: ch.name });
        break;
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
      case 'pick-feature': HTB.openFeaturePicker(ch.id); break;
      case 'del': mutate(c => c[b.dataset.list].splice(i, 1)); break;
      case 'atk': { const at = ch.attacks[i]; roll(d20(R.attackBonus(ch, at)), `${at.name} — attack`, { d20: true, mode: rollModeFromEvent(e), charId: ch.id, kind: 'attack' }); break; }
      case 'dmg': { const at = ch.attacks[i]; roll(R.damageExpr(ch, at), `${at.name} — ${at.type || ''} damage`, { charId: ch.id, kind: 'damage' }); break; }
      case 'crit': { const at = ch.attacks[i]; roll(R.critExpr(R.damageExpr(ch, at)), `${at.name} — CRITICAL ${at.type || ''} damage`, { charId: ch.id, kind: 'damage' }); break; }
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
      case 'cast': {
        const p = ch.powers[i], lvl = +p.level || 0, cost = lvl ? lvl + 1 : 0, k = p.type === 'tech' ? 'tech' : 'force';
        const ci = R.casterInfo(ch);
        const max = ch[k].max !== '' && ch[k].max != null ? +ch[k].max : (k === 'force' ? ci.forceMax : ci.techMax);
        if (cost && (+ch[k].used || 0) + cost > max) return toast(`Not enough ${k} points (${cost} needed).`, true);
        if (cost) mutate(c => { c[k].used = (+c[k].used || 0) + cost; });
        const dc = k === 'tech' ? `DC ${ci.techDC}, atk ${R.fmt(ci.techAtk)}` : p.alignment === 'dark' ? `DC ${ci.darkDC}, atk ${R.fmt(ci.darkAtk)}` : p.alignment === 'light' ? `DC ${ci.lightDC}, atk ${R.fmt(ci.lightAtk)}` : `DC ${Math.max(ci.lightDC, ci.darkDC)}, atk ${R.fmt(Math.max(ci.lightAtk, ci.darkAtk))}`;
        act('chat', { text: `casts **${p.name}** (${lvl ? 'level ' + lvl : 'at-will'} ${k} power${cost ? `, −${cost} ${k === 'force' ? 'FP' : 'TP'}` : ''}) · ${dc}${p.notes ? '\n' + p.notes : ''}${p.description ? '\n' + p.description.slice(0, 900) + (p.description.length > 900 ? '…' : '') : ''}`, as: ch.name });
        break;
      }
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
  function weaponAttack(it) {
    const props = (it.props || []).join(', ');
    const ab = /blaster/i.test(it.wc) ? 'dex' : /finesse/i.test(props) ? 'finesse' : 'str';
    return { name: it.n, ab, damage: it.dmg || '1', type: it.dt || 'kinetic', props: props.slice(0, 200), proficient: true };
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
            <button class="btn small ${qty ? '' : 'primary'}" data-eq="add" data-i="${i}">${qty ? `Add another (${qty})` : 'Add'}</button></div>`;
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
        if (a === 'add') {
          const it = ep._rows[+b.dataset.i]; if (!it) return;
          const enh = F.set === 'enhanced';
          mutate(c => {
            const ex = c.equipment.find(x => String(x.name).toLowerCase() === it.n.toLowerCase());
            if (ex) ex.qty = (n0(ex.qty) || 1) + 1;
            else c.equipment.push({ name: it.n, qty: 1, equipped: false, notes: itemNotes(it, enh).slice(0, 200) });
            if (!enh && it.cat === 'Weapon' && !c.attacks.some(x => String(x.name).toLowerCase() === it.n.toLowerCase())) c.attacks.push(weaponAttack(it));
          });
          toast(!enh && it.cat === 'Weapon' ? `Added ${it.n} (and its attack)` : `Added ${it.n}`);
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
      const ci = () => R.casterInfo(ch() || {});
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
              ${maxLvl && p.l > maxLvl ? '<span class="pp-tag pp-high" title="Above the highest level this character can cast right now">above your level</span>' : ''}
              <div class="pp-meta">${esc(p.ct)} · Range ${esc(p.r)} · ${esc(p.d)}${p.pre ? ` · Requires ${esc(p.pre)}` : ''}</div>
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
          const notes = [p.ct, p.r && 'Range ' + p.r, p.d, p.c && !/concentration/i.test(p.d) ? 'Concentration' : ''].filter(Boolean).join(' · ');
          const desc = p.desc + (p.hl ? '\n\nAt higher levels. ' + p.hl : '');
          const pw = { name: p.n, level: p.l, type: force ? 'force' : 'tech', alignment: force ? p.a : 'universal', notes: notes.slice(0, 300), description: desc.slice(0, 4000) };
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
  const hideTip = () => tip.classList.add('hidden');
  const tipTarget = e => e.target.closest('[data-power-tip], [data-feature-tip]');
  const showTip = (el, x, y) => (el.dataset.featureTip !== undefined ? showFeatureTip(el, x, y) : showPowerTip(el, x, y));
  $('#sheet').addEventListener('mouseover', e => { const el = tipTarget(e); if (el) showTip(el, e.clientX, e.clientY); });
  $('#sheet').addEventListener('mousemove', e => { if (!tip.classList.contains('hidden') && tipTarget(e)) placeTip(e.clientX, e.clientY); });
  $('#sheet').addEventListener('mouseout', e => { const el = tipTarget(e); if (el && !el.contains(e.relatedTarget)) hideTip(); });
  $('#sheet').addEventListener('focusin', e => { const el = tipTarget(e); if (el) { const r = el.getBoundingClientRect(); showTip(el, r.left, r.bottom); } });
  $('#sheet').addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, true);

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
      <label class="toggle"><input type="checkbox" id="npcHidden"> hidden</label>
      <button class="btn primary" data-cact="add-npc">Add</button></div>
      <div class="row wrap" style="margin-top:6px"><label class="toggle"><input type="checkbox" id="npcToken" checked> also place map tokens</label>
        <label class="toggle" title="Players see these tokens as ??? until you reveal them"><input type="checkbox" id="npcNameHidden"> hide their names</label>
        <label class="toggle" title="For SW5e creatures: roll each one's hit dice instead of taking the average"><input type="checkbox" id="npcRollHp"> roll creature HP</label>
        <span class="spacer"></span><button class="btn small amber" data-cact="add-creature">☠ Add an SW5e creature…</button></div></div>`;
    html += `<div class="init-list">${ini.entries.map((en, i) => {
      const ch = en.charId && S.st.characters[en.charId];
      const canHp = gm || (ch && ch.owner === clientId);
      const hp = en.hp == null ? '' : `${en.hp}`;
      return `<div class="init-row ${ini.active && i === ini.turn ? 'cur' : ''} ${en.hidden ? 'hid' : ''}" data-id="${esc(en.id)}">
        <div class="init${gm ? ' gm-init' : ''}">${gm ? `<input type="number" value="${n0(en.init)}" data-cf="init" aria-label="Initiative for ${esc(en.name)}"><span class="init-step"><button type="button" data-cact="init-up" title="Raise initiative by 1" aria-label="Raise initiative for ${esc(en.name)}">▲</button><button type="button" data-cact="init-down" title="Lower initiative by 1" aria-label="Lower initiative for ${esc(en.name)}">▼</button></span>` : Math.round(n0(en.init))}</div>
        <div><b>${esc(en.name)}</b>${en.hidden ? ' <span class="muted">(hidden)</span>' : ''}${ch ? ` <span class="muted">· ${esc((S.st.players[ch.owner] || {}).name || '')}</span>` : ''}
          <div>${(en.conditions || []).map((c, ci) => `<span class="chip" title="${esc(R.CONDITIONS[c] || '')}">${esc(c)}${gm || canHp ? `<button data-cact="rm-cond" data-ci="${ci}">✕</button>` : ''}</span>`).join('')}
          ${gm || canHp ? `<select data-cf="add-cond" style="font-size:12px;padding:1px 4px"><option value="">+ condition</option>${Object.keys(R.CONDITIONS).map(c => `<option>${c}</option>`).join('')}</select>` : ''}</div></div>
        <div class="hp">${hp !== '' ? (canHp ? `HP <input data-cf="hp" value="${esc(hp)}" title="Type a number, or -7 / +5">` : `HP ${esc(hp)}`) + (en.maxHp != null ? ` <span class="muted">/ ${n0(en.maxHp)}</span>` : '') : ''}</div>
        <div class="muted">${en.ac != null ? 'AC ' + esc(en.ac) : ''}</div>
        <div>${gm && en.sb ? `<button class="btn tiny" data-cact="statblock" title="${esc(en.sb)} stat block">📜</button> ` : ''}${gm ? `<button class="btn tiny" data-cact="hide" title="Toggle hidden">${en.hidden ? '👁' : '◌'}</button> <button class="btn tiny ghost" data-cact="remove">✕</button>` : ''}</div></div>`;
    }).join('') || '<p class="muted">No combatants yet. Players: click “Roll initiative” on your sheet. GM: add enemies above.</p>'}</div>`;
    el.innerHTML = html;
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
        await act('init.add', { name: nm, bonus: +$('#npcBonus').value || 0, hp: +$('#npcHp').value || null, ac: +$('#npcAc').value || null, hidden: $('#npcHidden').checked });
        if ($('#npcToken').checked) await act('token.add', { name: nm, color: '#ef5350', x: 2 * k, y: 2, hidden: $('#npcHidden').checked, nameHidden: $('#npcNameHidden').checked });
      }
    }
  });
  $('#combat').addEventListener('change', e => {
    const t = e.target, cf = t.dataset.cf; if (!cf) return;
    const id = t.closest('.init-row').dataset.id, en = S.st.initiative.entries.find(x => x.id === id);
    if (cf === 'init') act('init.update', { id, fields: { init: +t.value || 0 } });
    if (cf === 'hp') {
      const v = t.value.trim(); let n;
      if (/^[+-]\d+$/.test(v)) n = (+en.hp || 0) + parseInt(v, 10); else n = parseInt(v, 10);
      if (!isNaN(n)) act('init.update', { id, fields: { hp: Math.max(0, n) } });
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
  const CAM = { x: 40, y: 40, z: 1, ready: false };
  const ZMIN = 0.2, ZMAX = 3;
  (() => { const c = store.get('holo.cam', null); if (c && isFinite(c.x) && isFinite(c.y) && isFinite(c.z)) Object.assign(CAM, c, { ready: true }); })();
  let camSaveT;
  const saveCam = () => { clearTimeout(camSaveT); camSaveT = setTimeout(() => store.set('holo.cam', { x: CAM.x, y: CAM.y, z: CAM.z }), 400); };
  function viewSize() { const w = $('#mapWrap'); return { w: w.clientWidth || 800, h: w.clientHeight || 600 }; }
  function zoomAt(sx, sy, factor) {
    const z = Math.max(ZMIN, Math.min(ZMAX, CAM.z * factor));
    CAM.x = sx - (sx - CAM.x) * (z / CAM.z); CAM.y = sy - (sy - CAM.y) * (z / CAM.z); CAM.z = z;
    saveCam(); drawMap(); updateZoomLabel();
  }
  function fitBoard() {
    const mp = S.st.map, g = mp.gridSize, { w, h } = viewSize();
    const z = Math.max(ZMIN, Math.min(ZMAX, Math.min((w - 40) / (mp.cols * g), (h - 40) / (mp.rows * g))));
    CAM.z = z; CAM.x = (w - mp.cols * g * z) / 2; CAM.y = (h - mp.rows * g * z) / 2;
    saveCam(); drawMap(); updateZoomLabel();
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
        <button class="btn small" data-mact="npc">＋ Token</button>
        ${mp.tokens.some(t => t.moves) || (mp.props || []).some(x => x.moves) ? '<button class="btn small amber" data-mact="play-moves" title="Play the scene movements on this board now, for everyone">▶ Play movements</button>' : ''}
        <input type="file" id="bgFile" accept="image/*" hidden>` : '<span class="muted">Drag your token to move it · drag empty space to pan · scroll to zoom</span>'}`;
  }
  $('#mapTools').addEventListener('click', async e => {
    const b = e.target.closest('[data-mact]'); if (!b) return;
    const a = b.dataset.mact, { w, h } = viewSize();
    if (a === 'zin') zoomAt(w / 2, h / 2, 1.25);
    if (a === 'zout') zoomAt(w / 2, h / 2, 0.8);
    if (a === 'z100') zoomAt(w / 2, h / 2, 1 / CAM.z);
    if (a === 'zfit') fitBoard();
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
      exit: m.exit || '', delay: n0(m.delay), face: !!m.face };
    renderScriptBar(); drawMap();
  }
  function renderScriptBar() {
    const sc = M.script;
    scriptBar.classList.toggle('hidden', !sc);
    if (!sc) { scriptBar.innerHTML = ''; return; }
    scriptBar.innerHTML = `<b>🎬 ${esc(sc.name || 'Token')}</b><span class="muted">Click squares to add waypoints (${sc.path.length}/12).</span>
      <label class="mini">Then <select data-sb="exit">${Object.entries(EXIT_NAMES).map(([k, v]) => `<option value="${k}" ${k === sc.exit ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
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
      if (await act(sc.kind === 'prop' ? 'prop.script' : 'token.script', { id: sc.id, moves: has ? { path: sc.path, exit: sc.exit, delay: sc.delay, face: sc.face } : null })) {
        toast(has ? `${sc.name}'s movement saved. It plays when this scene is next loaded, or with ▶ Play movements.` : `${sc.name}'s movement cleared`);
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
      const last = pts[pts.length - 1], amber = themeHex('amber', '#ffb74d');
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
      if (n0(sc.delay)) { ctx.fillStyle = amber; ctx.font = `600 ${11 / z}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.fillText(`🎬 after ${n0(sc.delay)} s`, pts[0].x, pts[0].y - ((prop ? t.h : sz) * g) / 2 - 8 / z); }
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
    if (!CAM.ready) {   // first open: fit the board, but never start smaller than 70% (then start at 100%, top-left)
      CAM.ready = true; fitBoard();
      if (CAM.z < 0.7) { CAM.z = 1; CAM.x = 40; CAM.y = 40; saveCam(); updateZoomLabel(); drawMap(); }
      return;
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
      if (M.selProp === p.id) { ctx.strokeStyle = themeHex('amber', '#ffb74d'); ctx.lineWidth = 2 / z; ctx.setLineDash([6 / z, 4 / z]); ctx.strokeRect(-w / 2, -h / 2, w, h); }
      ctx.restore();
    }
    // stamp preview
    if (A.stamp && A.hover) {
      const st = A.stamp, im = img(st.src);
      if (im) { ctx.globalAlpha = 0.6; const w = st.w * g, h = st.h * g; ctx.drawImage(im, A.hover.x - w / 2, A.hover.y - h / 2, w, h); ctx.globalAlpha = 1; }
    }
    if (isGM()) drawScripts(g, z);
    // tokens
    const ini = S.st.initiative, cur = ini.active && ini.entries[ini.turn];
    for (const t of mp.tokens) {
      const drag = M.drag && M.drag.id === t.id;
      const ap = ANIM.pos[t.id];   // mid scene-movement
      const px = drag ? M.drag.px : (ap ? ap.x : t.x) * g, py = drag ? M.drag.py : (ap ? ap.y : t.y) * g, sz = (t.size || 1) * g, r = sz / 2 - 3;
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
        ctx.fillStyle = pct < .3 ? '#ef5350' : pct < .6 ? '#ffb74d' : '#66bb6a'; ctx.fillRect(px + 4, py + sz - 6, (sz - 8) * pct, 4);
      }
      // a short label that fits under the token (so neighbours don't overlap); hover shows the full name
      ctx.font = `600 ${Math.max(11 / z, g * 0.2)}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const lab = shortLabel(t.name, sz - 4);
      if (t.nameHidden) ctx.globalAlpha = Math.min(ctx.globalAlpha, 0.55);   // the GM's reminder: players see "???"
      ctx.lineWidth = 3 / z; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(lab, cx, py + sz + 1); ctx.fillStyle = t.nameHidden ? '#ffb74d' : '#fff'; ctx.fillText(lab, cx, py + sz + 1);
      ctx.globalAlpha = 1;
    }
  }
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
    if (!M.drag) { if (e.pointerType !== 'touch') { const { x, y } = mapXY(e); mapTip(tokenAt(x, y), e); } return; }
    mapTip(null);
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
    if (d.pan) { if (d.moved) saveCam(); else { M.sel = null; M.selProp = null; drawMap(); } return; }
    if (d.prop) {
      const p = (S.st.map.props || []).find(p => p.id === d.prop);
      if (p && d.moved) { p.x = snap(d.px / g, e); p.y = snap(d.py / g, e); act('prop.update', { id: p.id, fields: { x: p.x, y: p.y } }); }
      else if (p) showPropPop(p, e);
      drawMap(); return;
    }
    const t = S.st.map.tokens.find(t => t.id === d.id);
    if (t && d.moved) {
      t.x = Math.max(TOK_MIN, Math.min(TOK_MAX, Math.round(d.px / g)));
      t.y = Math.max(TOK_MIN, Math.min(TOK_MAX, Math.round(d.py / g)));
      act('token.move', { id: t.id, x: t.x, y: t.y });
    } else if (t) showTokenPop(t, e);
    drawMap();
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  if (window.ResizeObserver) new ResizeObserver(() => drawMap()).observe($('#mapWrap'));
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
      <button class="btn small" data-pp="script" title="Waypoints this piece follows after the next scene change">🎬 Scene movement${p.moves ? ' ✓' : ''}…</button>
      <button class="btn small danger" data-pp="remove">Remove</button>
      <span class="muted" style="font-size:11px">Drag to move · hold Alt to place freely</span>`;
    pop.addEventListener('click', ev => {
      const a = ev.target.dataset.pp; if (!a) return;
      const f = {};
      if (a === 'rl' || a === 'rr') f.rot = ((p.rot || 0) + (a === 'rr' ? 45 : -45) + 360) % 360;
      if (a === 'smaller' || a === 'bigger') { const k = a === 'bigger' ? 1.25 : 0.8; f.w = p.w * k; f.h = p.h * k; f.x = p.x + (p.w - f.w) / 2; f.y = p.y + (p.h - f.h) / 2; }
      if (Object.keys(f).length) { Object.assign(p, f); act('prop.update', { id: p.id, fields: f }); drawMap(); return; }
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
      <label>Size<select data-tp="size">${[1, 2, 3, 4].map(n => `<option ${n === (t.size || 1) ? 'selected' : ''} value="${n}">${['Medium/Small', 'Large', 'Huge', 'Gargantuan'][n - 1]}</option>`).join('')}</select></label>
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
      if (a === 'color' || a === 'size') act('token.update', { id: t.id, fields: { [a]: a === 'size' ? +ev.target.value : ev.target.value } });
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
        || '<p class="muted">No handouts yet.</p>'}</div>`;
  }
  $('#handouts').addEventListener('click', async e => {
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
          <span class="muted">— ${chars().filter(c => c.owner === id).map(c => esc(c.name)).join(', ') || 'no characters'}</span></div>`).join('')}
        <div class="row" style="margin-top:12px"><button class="btn small danger" id="clearChat">Clear chat log</button></div>
      </div>
      <div class="box"><h4>Level ups</h4>
        <p style="margin-top:0" class="muted">After a big fight or a hard-won conversation, give the party a level. Each player gets a pop-up and picks how to level.
          Someone missed the session? Grant just their character, and you can level it for them.</p>
        <button class="btn small amber" id="gmGrant">⬆ Grant a level…</button>
        <label class="toggle" style="margin-top:8px" title="A table rule: whether players may take the hit die's maximum instead of the average or a roll">
          <input type="checkbox" id="gmHpMax" ${S.st.hpMax !== false ? 'checked' : ''}> Players may take maximum hit points when levelling</label>
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
      <div class="box" id="gmAudio"></div>
      <div class="box"><h4>GM notes <span class="muted" style="text-transform:none;letter-spacing:0">(only you can see these · autosaves)</span></h4>
        <textarea id="gmNotes" rows="18" placeholder="Session plan, NPCs, secrets, loot…">${esc(S.st.notes || '')}</textarea></div>
    </div>`;
  }
  $('#gm').addEventListener('click', e => {
    const id = e.target.id;
    if (id === 'copyLink') navigator.clipboard?.writeText(location.origin + location.pathname).then(() => toast('Link copied'));
    if (id === 'doRename') act('campaign.rename', { name: $('#campRename').value });
    if (id === 'clearChat' && confirm('Clear the chat log for everyone?')) act('chat.clear');
    if (id === 'gmGrant') openGrant();
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
      auto: [], autoKey: '', autoState: '', archList: [], archFor: '', archMenu: false, featList: [] };
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
      if (window.HTB && S.st.sw5eBooks !== false) HTB.featNames().then(f => { W.featList = f; draw(); }).catch(() => {});
      const draw = () => { const a = document.activeElement, id = a && a.dataset && a.dataset.w, pos = a && a.selectionStart; wiz.innerHTML = wizardHtml(charId, W);
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
        if (!f || f.startsWith('feature.') || (f.startsWith('power.') && !f.endsWith('.type'))) return;
        if (t.type === 'text' || t.tagName === 'TEXTAREA') return; // already saved on input; re-rendering here would eat a click
        if (f.startsWith('power.')) { const [, i] = f.split('.'); W.powers[+i].type = t.value; return; }
        W[f] = t.type === 'checkbox' ? t.checked : t.value;
        if (f === 'cls' || f === 'newCls') { W.archetype = ''; W.archMenu = false; }
        render();
      });
      wiz.addEventListener('click', async e => {
        const b = e.target.closest('[data-wa]'); if (!b) return;
        e.preventDefault();
        const a = b.dataset.wa;
        if (a === 'cancel') return closeModal();
        if (a === 'pick-power') {   // the same SW5e picker as on the sheet; Done comes back here
          return openPowerPicker(charId, b.dataset.kind, { taken: () => W.powers.map(x => x.name.toLowerCase()),
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
    const hd = (R.CLASSES[cls] || {}).hd || 8;
    const oldCon = R.abilityMod(ch, 'con'), newCon = R.abilityMod(after, 'con');
    const retro = (newCon - oldCon) * before;
    const avgGain = Math.max(1, hd / 2 + 1 + newCon) + retro;
    const maxGain = Math.max(1, hd + newCon) + retro;
    if (W.hpMode === 'max' && S.st.hpMax === false) W.hpMode = 'average';
    const payload = { charId, className: cls, hpMode: W.hpMode, archetype: archDue && W.archetype ? W.archetype : undefined, hitDie: hd,
      asi: asi || undefined, feat: feat || undefined,
      features: (W.auto || []).filter(f => !f.have).map(f => ({ name: f.name, text: f.text })).slice(0, 20), powers: W.powers.filter(p => p.name.trim()).slice(0, 20) };
    return { ch, after, cls, k, newClassLevel, before, due, asiOn, archDue, archTerm, hd, oldCon, newCon, retro, avgGain, maxGain, payload, error };
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
          <span class="muted" style="font-size:12px">Multiclassing usually needs 13+ in the new class's key ability; check with your GM.</span></div>` : ''}
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
               <textarea data-w="featText" rows="3" placeholder="What it does (filled in from SW5e when you pick one)">${esc(W.featText)}</textarea>`
            : W.asiMode === 'one' ? abilitySelect('a1', W.a1) : abilitySelect('a1', W.a1) + abilitySelect('a2', W.a2)}</div>` : ''}
      </section>
      <section class="wiz-step"><h4><span class="step">4</span> New features &amp; powers</h4>
        ${!P.cls ? '' : W.autoState === 'loading' ? '<p class="muted" style="margin:0 0 6px">Looking up the class features for this level…</p>'
          : W.auto && W.auto.length ? `<p class="muted" style="margin:0 0 4px">These ${esc(P.cls)} ${P.newClassLevel} features from the Player's Handbook are added to Features &amp; Traits automatically (hover for details):</p>
            <ul class="wiz-feats">${W.auto.map(f => `<li title="${esc(f.text.slice(0, 500))}"><b>${esc(f.name)}</b>${f.have ? ' <span class="muted">(already on the sheet)</span>' : ''}</li>`).join('')}</ul>`
          : W.autoState === 'ok' ? `<p class="muted" style="margin:0 0 6px">No new ${esc(P.cls)} features at level ${P.newClassLevel}${P.due ? ' besides the ability score improvement' : ''}.</p>`
          : W.autoState ? `<p class="muted" style="margin:0 0 6px">Couldn't look up the class features (${esc(W.autoState)}). You can add them afterwards from Features &amp; Traits.</p>` : ''}
        <h5 class="wiz-sub">Powers learned this level ${ciA.forceMaxLevel > ciB.forceMaxLevel || ciA.techMaxLevel > ciB.techMaxLevel ? '<span class="up">· you can now cast higher-level powers</span>' : ''}</h5>
        ${W.powers.map((p, i) => `<div class="row wiz-power"><b>${esc(p.name)}</b><span class="pp-lvl">${n0(p.level) ? 'Level ' + n0(p.level) : 'At-will'}</span>
          <span class="pp-tag">${p.type === 'tech' ? 'Tech' : esc(({ light: 'Light', dark: 'Dark' })[p.alignment] || 'Universal') + ' force'}</span><span class="spacer"></span>
          <button class="btn tiny ghost" data-wa="rm-power" data-i="${i}" title="Remove">✕</button></div>`).join('') || '<p class="muted" style="margin:0 0 4px">None picked.</p>'}
        <div class="row"><button class="btn tiny" data-wa="pick-power" data-kind="force">＋ force power</button><button class="btn tiny" data-wa="pick-power" data-kind="tech">＋ tech power</button></div>
      </section>
      <section class="wiz-step"><h4><span class="step">5</span> Summary</h4>
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

  // --------------------------------------------------------------------------- shared with books.js
  window.HT = { S, $, $$, esc, n0, R, API, modal, closeModal, toast, act, post, mutate, isGM, chars, roll, rollModeFromEvent, setPath, renderRules, setTab };

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
