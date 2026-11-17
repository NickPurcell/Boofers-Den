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
  let clientId = store.get('holo.clientId', null);
  if (!clientId) { clientId = rid(); store.set('holo.clientId', clientId); }

  const S = { code: null, st: null, es: null, selected: null, tab: 'sheet', sub: 'main', rollMode: 'normal',
    importNotes: {}, mapImg: null, mapBgVersion: -1, zoom: 1, lastChatId: null, chatHist: [], chatHistIdx: -1 };

  // --------------------------------------------------------------------------- utils
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.className = 'toast', 2600);
  }
  const API = '/api/holotable';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function post(op, body) {
    const r = await fetch(`${API}?op=${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, ...body }) });
    const j = await r.json().catch(() => ({ error: 'Server error (' + r.status + ')' }));
    if (!r.ok || j.error) throw new Error(j.error || r.statusText);
    return j;
  }
  async function act(type, payload = {}) {
    try { return await post('action', { code: S.code, type, payload }); }
    catch (e) { toast(e.message, true); return null; }
  }
  function modal(html, onMount) {
    $('#modalBox').innerHTML = html; $('#modal').classList.remove('hidden');
    onMount && onMount($('#modalBox'));
  }
  const closeModal = () => $('#modal').classList.add('hidden');
  $('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
  const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/\n/g, '<br>');
  const timeStr = ts => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  // --------------------------------------------------------------------------- lobby
  function recent() { return store.get('holo.recent', []); }
  function saveRecent(entry) {
    const list = recent().filter(r => r.code !== entry.code);
    const old = recent().find(r => r.code === entry.code) || {};
    list.unshift({ ...old, ...entry, ts: Date.now() });
    store.set('holo.recent', list.slice(0, 12));
  }
  async function renderSaved() {
    const r = { campaigns: [] }; // campaigns live on Boofer's Den; "Your campaigns" above lists the ones this browser joined
    const mine = new Set(recent().map(x => x.code));
    const list = (r.campaigns || []).filter(c => !mine.has(c.code));
    $('#saved').innerHTML = `${list.length ? '<h3>Saved on this PC</h3>' + list.map(c => `
      <div class="recent-item"><span class="code">${esc(c.code)}</span><b>${esc(c.name || '')}</b>
        <span class="muted">${esc(c.characters.join(', ') || 'no characters')} · ${new Date(c.updated * 1000).toLocaleDateString()}</span><span class="spacer"></span>
        <button class="btn small primary" data-resume="${esc(c.code)}">Resume as GM</button></div>`).join('') : ''}
      <div class="row" style="margin-top:10px"><button class="btn small ghost" id="restoreBtn">⇪ Restore a campaign backup…</button>
      <input type="file" id="restoreFile" accept=".json" hidden></div>`;
    S.savedList = r.campaigns || [];
  }
  $('#saved').addEventListener('click', e => {
    const b = e.target.closest('[data-resume]');
    if (b) { const c = S.savedList.find(x => x.code === b.dataset.resume); join(c.code, c.gmName || 'GM', c.gmToken); }
    if (e.target.id === 'restoreBtn') $('#restoreFile').click();
  });
  $('#saved').addEventListener('change', async e => {
    if (e.target.id !== 'restoreFile' || !e.target.files[0]) return;
    try {
      const campaign = JSON.parse(await e.target.files[0].text());
      const name = prompt('Your name (you will be the GM of the restored campaign):', 'GM'); if (!name) return;
      const r = await post('restore', { campaign, playerName: name });
      saveRecent({ code: r.code, name: r.name, playerName: name, gmToken: r.gmToken });
      toast(`Restored “${r.name}” — room code ${r.code}`);
      join(r.code, name, r.gmToken);
    } catch (err) { $('#lobbyError').textContent = err.message.includes('JSON') ? 'That file is not a HoloTable backup.' : err.message; }
    e.target.value = '';
  });
  function renderRecent() {
    renderSaved();
    const list = recent();
    $('#recent').innerHTML = list.length ? '<h3>Your campaigns</h3>' + list.map(r => `
      <div class="recent-item"><span class="code">${esc(r.code)}</span><b>${esc(r.name || '')}</b>
        <span class="muted">as ${esc(r.playerName || '')}${r.gmToken ? ' · GM' : ''}</span><span class="spacer"></span>
        <button class="btn small primary" data-rejoin="${esc(r.code)}">Rejoin</button>
        <button class="btn small ghost" data-forget="${esc(r.code)}" title="Remove from this list">✕</button></div>`).join('') : '';
  }
  $('#recent').addEventListener('click', e => {
    const rj = e.target.closest('[data-rejoin]'), fg = e.target.closest('[data-forget]');
    if (rj) { const r = recent().find(x => x.code === rj.dataset.rejoin); join(r.code, r.playerName, r.gmToken); }
    if (fg) { store.set('holo.recent', recent().filter(x => x.code !== fg.dataset.forget)); renderRecent(); }
  });
  $('#hostForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await post('create', { campaignName: f.get('campaignName'), playerName: f.get('playerName') });
      saveRecent({ code: r.code, name: f.get('campaignName'), playerName: f.get('playerName'), gmToken: r.gmToken });
      join(r.code, f.get('playerName'), r.gmToken);
    } catch (err) { $('#lobbyError').textContent = err.message; }
  });
  $('#joinForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const code = String(f.get('code')).toUpperCase().trim();
    join(code, f.get('playerName'), String(f.get('gmToken') || '').trim() || (recent().find(r => r.code === code) || {}).gmToken);
  });

  async function join(code, playerName, gmToken) {
    $('#lobbyError').textContent = '';
    try {
      await post('join', { code, playerName, gmToken });
    } catch (err) { $('#lobbyError').textContent = err.message; return; }
    S.code = code; S.st = null; S.selected = null; S.mapBgVersion = -1; S.mapImg = null; S.lastChatId = null;
    saveRecent({ code, playerName, ...(gmToken ? { gmToken } : {}) });
    history.replaceState(null, '', '?join=' + code);
    $('#lobby').classList.add('hidden'); $('#table').classList.remove('hidden');
    connect();
  }
  // Live updates: the server holds each request open until something changes (or ~8 s pass).
  function connect() {
    const gen = S.gen = (S.gen || 0) + 1;
    pollLoop(gen);
  }
  async function pollLoop(gen) {
    let v = '', lib = null, backoff = 1000;
    while (S.code && S.gen === gen) {
      try {
        const r = await fetch(`${API}?op=poll&code=${encodeURIComponent(S.code)}&clientId=${encodeURIComponent(clientId)}&v=${v}`, { cache: 'no-store' });
        if (S.gen !== gen) return;
        const j = await r.json().catch(() => ({}));
        if (r.status === 403 || r.status === 404) { $('#conn').classList.remove('ok'); toast(j.error || 'Lost access to this campaign', true); await sleep(5000); continue; }
        if (!r.ok) throw new Error(j.error || 'poll failed');
        $('#conn').classList.add('ok'); backoff = 1000;
        if (j.state) { v = j.v; onState(j.state); }
        if (lib !== null && j.lib !== lib && A.packs) { await loadPacks(); renderDrawer(); }
        lib = j.lib;
      } catch {
        $('#conn').classList.remove('ok');
        await sleep(backoff); backoff = Math.min(backoff * 2, 10000);
      }
    }
  }
  $('#leaveBtn').addEventListener('click', () => {
    S.gen = (S.gen || 0) + 1; S.code = null;
    history.replaceState(null, '', location.pathname);
    $('#table').classList.add('hidden'); $('#lobby').classList.remove('hidden'); renderRecent();
  });

  // --------------------------------------------------------------------------- state
  const me = () => S.st && S.st.players[clientId];
  const isGM = () => S.st && S.st.isGM;
  const canEdit = ch => ch && (isGM() || ch.owner === clientId);
  const chars = () => Object.values((S.st && S.st.characters) || {}).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const selChar = () => S.st && S.st.characters[S.selected];

  function onState(st) {
    const first = !S.st;
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
    S.st = st;
    document.body.classList.toggle('is-gm', !!st.isGM);
    saveRecent({ code: st.code, name: st.name, ...(st.gmToken ? { gmToken: st.gmToken } : {}) });
    if (!S.selected || !st.characters[S.selected]) {
      const mine = chars().find(c => c.owner === clientId);
      S.selected = (mine || chars()[0] || {}).id || null;
    }
    if (first && st.isGM && !chars().length) S.tab = 'gm';
    renderAll();
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
    renderMapTools(); loadMapBg(); drawMap();
    renderChat();
  }

  // --------------------------------------------------------------------------- top bar
  function renderTop() {
    $('#campName').textContent = S.st.name;
    $('#codeBtn').textContent = S.st.code;
    $('#online').innerHTML = S.st.online.map(o => `<span class="pill ${o.gm ? 'gm' : ''}">${esc(o.name)}${o.gm ? ' (GM)' : ''}</span>`).join('');
  }
  $('#codeBtn').addEventListener('click', () => {
    const link = location.origin + location.pathname + '?join=' + S.st.code;
    navigator.clipboard?.writeText(link).then(() => toast('Invite link copied: ' + link), () => toast(link));
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
      const cls = (c.classes || []).map(k => `${k.name} ${k.level}`).join(' / ');
      return `<div class="char-item ${c.id === S.selected ? 'on' : ''}" data-id="${c.id}">
        <div class="avatar" style="background-color:${esc(c.color || '#4fc3f7')};${c.image ? `background-image:url('${esc(c.image)}')` : ''}">${c.image ? '' : esc(initials(c.name))}</div>
        <div class="meta"><div class="nm">${esc(c.name)}</div><div class="sub">${esc(cls)} · ${esc(owner)}</div>
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
        await post('upload', { code: S.code, purpose: 'photo', charId: ch.id, kind, dataUrl });
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
      <div class="portrait-wrap"><div class="portrait ${ro ? '' : 'editable'}" ${ro ? '' : 'data-act="photo" data-kind="profile" title="Upload a profile photo"'} style="background-color:${esc(ch.color || '#4fc3f7')};${ch.image ? `background-image:url('${esc(ch.image)}')` : ''}">${ch.image ? '' : esc(initials(ch.name))}${ro ? '' : '<span class="cam">📷</span>'}</div>
        <div class="token-preview" title="Map token" style="background-color:${esc(ch.color || '#4fc3f7')};${(ch.tokenImage || ch.image) ? `background-image:url('${esc(ch.tokenImage || ch.image)}')` : ''}" ${ro ? '' : 'data-act="photo" data-kind="token"'}>${(ch.tokenImage || ch.image) ? '' : esc(initials(ch.name))}</div></div>
      <div class="sheet-title">
        ${inp('name', ch.name, { ro, cls: 'name' })}
        <div class="row wrap">
          ${inp('species', ch.species, { ro, list: 'dlSpecies', ph: 'Species', w: '150px' })}
          ${inp('background', ch.background, { ro, list: 'dlBg', ph: 'Background', w: '150px' })}
          ${inp('alignment', ch.alignment, { ro, ph: 'Alignment', w: '130px' })}
          <span class="muted">Level ${lvl} · Player: ${esc(owner)}</span>
        </div>
        <div class="row wrap">${(ch.classes || []).map((k, i) => `
          <span class="row">${inp(`classes.${i}.name`, k.name, { ro, list: 'dlClasses', w: '110px' })}
          ${inp(`classes.${i}.level`, +k.level || 1, { ro, type: 'number', w: '52px' })}
          ${inp(`classes.${i}.archetype`, k.archetype || '', { ro, ph: 'Archetype', w: '130px' })}
          ${!ro && ch.classes.length > 1 ? `<button class="btn tiny ghost" data-act="del-class" data-i="${i}">✕</button>` : ''}</span>`).join('')}
          ${!ro ? '<button class="btn tiny" data-act="add-class">＋ multiclass</button>' : ''}
        </div>
      </div>
      <div class="sheet-actions">
        <button class="btn small amber" data-act="init">⚔ Initiative</button>
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
        <div class="muted" style="font-size:11px">used ${inp('hitDiceUsed', +ch.hitDiceUsed || 0, { ro, type: 'number', w: '44px' })}</div></div>
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
      html += `<div class="box"><h4>Attacks <span class="spacer"></span>${!ro ? `<select data-act-change="add-weapon"><option value="">＋ add from list…</option>${R.WEAPONS.map((w, i) => `<option value="${i}">${esc(w.name)} (${w.damage} ${w.type})</option>`).join('')}</select><button class="btn tiny" data-act="add-attack">＋ custom</button>` : ''}</h4>
        <table class="t"><thead><tr><th>Name</th><th>Ability</th><th>Hit</th><th>Damage die</th><th>Type</th><th>Properties</th><th></th></tr></thead><tbody>
        ${(ch.attacks || []).map((a, i) => {
          const hit = R.attackBonus(ch, a), dmg = R.damageExpr(ch, a);
          return `<tr><td>${inp(`attacks.${i}.name`, a.name, { ro })}</td>
            <td style="width:96px">${inp(`attacks.${i}.ab`, a.ab || 'str', { ro, type: 'select', options: [{ v: 'str', t: 'Str' }, { v: 'dex', t: 'Dex' }, { v: 'finesse', t: 'Finesse' }, { v: 'con', t: 'Con' }, { v: 'int', t: 'Int' }, { v: 'wis', t: 'Wis' }, { v: 'cha', t: 'Cha' }] })}</td>
            <td style="width:120px"><button class="btn small amber" data-act="atk" data-i="${i}">${R.fmt(hit)}</button> ${inp(`attacks.${i}.magic`, a.magic || '', { ro, type: 'number', w: '44px', ph: '+0' })}</td>
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
      <div class="box" style="margin-top:12px"><h4>Powers <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-act="add-power">＋ power</button>' : ''}</h4>
        <table class="t"><thead><tr><th>Name</th><th>Lvl</th><th>Type</th><th>Alignment</th><th>Notes</th><th></th><th></th></tr></thead><tbody>
        ${(ch.powers || []).slice().map((p, i) => ({ p, i })).sort((a, b) => (+a.p.level || 0) - (+b.p.level || 0)).map(({ p, i }) => `<tr>
          <td>${inp(`powers.${i}.name`, p.name, { ro })}</td>
          <td class="n">${inp(`powers.${i}.level`, +p.level || 0, { ro, type: 'number' })}</td>
          <td style="width:90px">${inp(`powers.${i}.type`, p.type || 'force', { ro, type: 'select', options: ['force', 'tech'] })}</td>
          <td style="width:110px">${p.type === 'tech' ? '' : inp(`powers.${i}.alignment`, p.alignment || 'universal', { ro, type: 'select', options: ['universal', 'light', 'dark'] })}</td>
          <td>${inp(`powers.${i}.notes`, p.notes || '', { ro, ph: 'range, duration, effect…' })}</td>
          <td style="width:60px"><button class="btn small amber" data-act="cast" data-i="${i}">Cast</button></td>
          <td>${!ro ? `<button class="btn tiny ghost" data-act="del" data-list="powers" data-i="${i}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No powers.</td></tr>'}</tbody></table>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Casting costs 1 + power level points (level 0 at-wills are free).</p></div>`;
    }

    if (sub === 'gear') {
      html += `<div class="grid g2">
        <div class="box"><h4>Equipment <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-act="add-item">＋ item</button>' : ''}</h4>
          <div class="row" style="margin-bottom:8px"><span class="muted">Credits</span>${inp('credits', +ch.credits || 0, { ro, type: 'number', w: '120px' })}</div>
          <table class="t"><thead><tr><th>Qty</th><th>Item</th><th>Notes</th><th>Eq.</th><th></th></tr></thead><tbody>
          ${(ch.equipment || []).map((e, i) => `<tr><td class="n">${inp(`equipment.${i}.qty`, +e.qty || 1, { ro, type: 'number' })}</td>
            <td>${inp(`equipment.${i}.name`, e.name, { ro })}</td><td>${inp(`equipment.${i}.notes`, e.notes || '', { ro })}</td>
            <td>${inp(`equipment.${i}.equipped`, e.equipped, { ro, type: 'checkbox' })}</td>
            <td>${!ro ? `<button class="btn tiny ghost" data-act="del" data-list="equipment" data-i="${i}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Empty.</td></tr>'}
          </tbody></table></div>
        <div class="box"><h4>Features & Traits <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-act="add-feature">＋ feature</button>' : ''}</h4>
          ${(ch.features || []).map((f, i) => `<div style="margin-bottom:10px"><div class="row">${inp(`features.${i}.name`, f.name, { ro })}
            ${!ro ? `<button class="btn tiny ghost" data-act="del" data-list="features" data-i="${i}">✕</button>` : ''}
            <button class="btn tiny" data-act="share-feature" data-i="${i}" title="Post to chat">💬</button></div>
            ${inp(`features.${i}.text`, f.text || '', { ro, type: 'textarea', rows: 2 })}</div>`).join('') || '<p class="muted">None.</p>'}
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
            ${ch.tokenImage ? '<button class="btn small ghost" data-act="clear-token-photo">Token: use profile photo</button>' : ''}</div>` : ''}
          <label>Profile photo URL${inp('image', ch.image || '', { ro, ph: 'upload above, or paste https://…' })}</label>
          <label style="margin-top:8px">Token photo URL <span class="muted" style="text-transform:none">(blank = profile photo)</span>${inp('tokenImage', ch.tokenImage || '', { ro, ph: 'optional' })}</label>
          <label style="margin-top:8px">Token colour${inp('color', ch.color || '#4fc3f7', { ro, type: 'color' })}</label>
          <label style="margin-top:8px">Experience points${inp('xp', +ch.xp || 0, { ro, type: 'number' })}</label>
          <label style="margin-top:8px">Proficiency bonus override${inp('profOverride', ch.profOverride ?? '', { ro, type: 'number', ph: String(2 + Math.floor((lvl - 1) / 4)) })}</label>
          <label style="margin-top:8px">Initiative bonus (misc)${inp('initMisc', +ch.initMisc || 0, { ro, type: 'number' })}</label>
          ${isGM() ? `<label style="margin-top:8px">Owner (GM)<select data-act-change="assign">${Object.entries(S.st.players).map(([id, p]) => `<option value="${id}" ${id === ch.owner ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>` : ''}
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
      case 'add-class': mutate(c => c.classes.push({ name: 'Fighter', level: 1, archetype: '' })); break;
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
      case 'add-feature': mutate(c => c.features.push({ name: 'Feature', text: '' })); break;
      case 'del': mutate(c => c[b.dataset.list].splice(i, 1)); break;
      case 'atk': { const at = ch.attacks[i]; roll(d20(R.attackBonus(ch, at)), `${at.name} — attack`, { d20: true, mode: rollModeFromEvent(e), charId: ch.id, kind: 'attack' }); break; }
      case 'dmg': { const at = ch.attacks[i]; roll(R.damageExpr(ch, at), `${at.name} — ${at.type || ''} damage`, { charId: ch.id, kind: 'damage' }); break; }
      case 'crit': { const at = ch.attacks[i]; roll(R.critExpr(R.damageExpr(ch, at)), `${at.name} — CRITICAL ${at.type || ''} damage`, { charId: ch.id, kind: 'damage' }); break; }
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
      case 'clear-token-photo': mutate(c => { c.tokenImage = ''; }); break;
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

  // --------------------------------------------------------------------------- combat
  function renderCombat(el) {
    const ini = S.st.initiative, gm = isGM();
    const myChars = chars().filter(c => c.owner === clientId);
    let html = `<div class="row wrap"><h3>Initiative</h3><span class="round">${ini.active ? 'Round ' + ini.round : 'Not in combat'}</span><span class="spacer"></span>
      ${myChars.map(c => `<button class="btn small amber" data-cact="roll-init" data-id="${c.id}">⚔ Roll for ${esc(c.name)}</button>`).join('')}
      ${gm ? `<button class="btn small" data-cact="start">Start</button><button class="btn small" data-cact="prev">◀ Prev</button>
        <button class="btn small primary" data-cact="next">Next turn ▶</button><button class="btn small danger" data-cact="clear">End combat</button>` : ''}</div>`;
    if (gm) html += `<div class="box" style="margin-top:12px"><h4>Add NPC / enemy</h4><div class="npc-form">
      <label>Name<input id="npcName" placeholder="Stormtrooper"></label><label>Init bonus<input id="npcBonus" type="number" value="1"></label>
      <label>HP<input id="npcHp" type="number" value="13"></label><label>AC<input id="npcAc" type="number" value="14"></label>
      <label>Count<input id="npcCount" type="number" value="1" min="1" max="20"></label>
      <label class="toggle"><input type="checkbox" id="npcHidden"> hidden</label>
      <button class="btn primary" data-cact="add-npc">Add</button></div>
      <label class="toggle" style="margin-top:6px"><input type="checkbox" id="npcToken" checked> also place map tokens</label></div>`;
    html += `<div class="init-list">${ini.entries.map((en, i) => {
      const ch = en.charId && S.st.characters[en.charId];
      const canHp = gm || (ch && ch.owner === clientId);
      const hp = en.hp == null ? '' : `${en.hp}`;
      return `<div class="init-row ${ini.active && i === ini.turn ? 'cur' : ''} ${en.hidden ? 'hid' : ''}" data-id="${en.id}">
        <div class="init">${gm ? `<input type="number" value="${en.init}" data-cf="init">` : Math.round(en.init)}</div>
        <div><b>${esc(en.name)}</b>${en.hidden ? ' <span class="muted">(hidden)</span>' : ''}${ch ? ` <span class="muted">· ${esc((S.st.players[ch.owner] || {}).name || '')}</span>` : ''}
          <div>${(en.conditions || []).map((c, ci) => `<span class="chip" title="${esc(R.CONDITIONS[c] || '')}">${esc(c)}${gm || canHp ? `<button data-cact="rm-cond" data-ci="${ci}">✕</button>` : ''}</span>`).join('')}
          ${gm || canHp ? `<select data-cf="add-cond" style="font-size:12px;padding:1px 4px"><option value="">+ condition</option>${Object.keys(R.CONDITIONS).map(c => `<option>${c}</option>`).join('')}</select>` : ''}</div></div>
        <div class="hp">${hp !== '' ? (canHp ? `HP <input data-cf="hp" value="${esc(hp)}" title="Type a number, or -7 / +5">` : `HP ${esc(hp)}`) + (en.maxHp != null ? ` <span class="muted">/ ${en.maxHp}</span>` : '') : ''}</div>
        <div class="muted">${en.ac != null ? 'AC ' + esc(en.ac) : ''}</div>
        <div>${gm ? `<button class="btn tiny" data-cact="hide" title="Toggle hidden">${en.hidden ? '👁' : '◌'}</button> <button class="btn tiny ghost" data-cact="remove">✕</button>` : ''}</div></div>`;
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
    if (a === 'hide') act('init.update', { id, fields: { hidden: !en.hidden } });
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
        if ($('#npcToken').checked) await act('token.add', { name: nm, color: '#ef5350', x: 2 * k, y: 2, hidden: $('#npcHidden').checked });
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
  const imgCache = {};
  function img(src) {
    if (!src) return null;
    let im = imgCache[src];
    if (!im) { im = imgCache[src] = new Image(); im.onload = () => drawMap(); im.src = src; }
    return im.complete && im.naturalWidth ? im : null;
  }

  function renderMapTools() {
    const mp = S.st.map, gm = isGM(), sc = selChar();
    $('#mapTools').innerHTML = `
      ${sc && canEdit(sc) ? `<button class="btn small" data-mact="place">◉ Place ${esc(sc.name)}</button>` : ''}
      <span class="muted">Zoom</span><input type="range" min="0.3" max="2" step="0.1" value="${S.zoom}" data-mact="zoom" style="width:90px">
      ${gm ? `<button class="btn small ${A.open ? 'primary' : ''}" data-mact="assets">📦 Assets</button><span class="spacer"></span>
        <button class="btn small" data-mact="bg">🖼 Background…</button>${mp.bgVersion ? '<button class="btn small ghost" data-mact="clear-bg">clear</button>' : ''}
        ${mp.floor ? '<button class="btn small ghost" data-mact="clear-floor">clear floor</button>' : ''}
        ${(mp.props || []).length ? `<button class="btn small ghost" data-mact="clear-props">clear ${mp.props.length} props</button>` : ''}
        <button class="btn small" data-mact="fit" title="Set columns/rows to match the background image">Fit grid</button>
        <span class="muted">cell px</span><input type="number" value="${mp.gridSize}" data-mset="gridSize">
        <span class="muted">cols</span><input type="number" value="${mp.cols}" data-mset="cols">
        <span class="muted">rows</span><input type="number" value="${mp.rows}" data-mset="rows">
        <label class="toggle"><input type="checkbox" data-mset="showGrid" ${mp.showGrid ? 'checked' : ''}> grid</label>
        <button class="btn small" data-mact="npc">＋ Token</button>
        <input type="file" id="bgFile" accept="image/*" hidden>` : '<span class="muted">Drag your token to move. Click a token for options.</span>'}`;
  }
  $('#mapTools').addEventListener('click', async e => {
    const b = e.target.closest('[data-mact]'); if (!b) return;
    const a = b.dataset.mact;
    if (a === 'place') await act('token.add', { charId: S.selected, x: 1, y: 1 });
    if (a === 'assets') { A.open = !A.open; renderMapTools(); renderDrawer(); }
    if (a === 'bg') $('#bgFile').click();
    if (a === 'clear-bg') act('map.bg', { url: null });
    if (a === 'clear-floor') act('map.floor', { src: null });
    if (a === 'clear-props' && confirm('Remove every prop from this map?')) act('prop.clear');
    if (a === 'fit' && S.mapImg) act('map.settings', { cols: Math.round(S.mapImg.width / S.st.map.gridSize), rows: Math.round(S.mapImg.height / S.st.map.gridSize) });
    if (a === 'npc') {
      const name = prompt('Token name', 'Enemy'); if (!name) return;
      act('token.add', { name, color: '#ef5350', x: 1, y: 1 });
    }
  });
  $('#mapTools').addEventListener('input', e => { if (e.target.dataset.mact === 'zoom') { S.zoom = +e.target.value; drawMap(); } });
  $('#mapTools').addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'bgFile' && t.files[0]) {
      toast('Uploading map…');
      try {
        const { dataUrl, w, h } = await fitUpload(t.files[0], 4096);
        const up = await post('upload', { code: S.code, purpose: 'bg', dataUrl });
        await act('map.bg', { url: up.url });
        act('map.settings', { cols: Math.max(5, Math.round(w / S.st.map.gridSize)), rows: Math.max(5, Math.round(h / S.st.map.gridSize)) });
      } catch (err) { toast(err.message || 'Could not read that image', true); }
    }
    if (t.dataset.mset) act('map.settings', { [t.dataset.mset]: t.type === 'checkbox' ? t.checked : +t.value });
  });
  async function loadMapBg() {
    const v = S.st.map.bgVersion;
    if (v === S.mapBgVersion) return;
    S.mapBgVersion = v;
    const data = S.st.map.bgUrl;
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
    const mp = S.st.map, g = mp.gridSize, W = mp.cols * g, H = mp.rows * g, z = S.zoom, dpr = window.devicePixelRatio || 1;
    canvas.width = W * z * dpr; canvas.height = H * z * dpr; canvas.style.width = W * z + 'px'; canvas.style.height = H * z + 'px';
    ctx.setTransform(z * dpr, 0, 0, z * dpr, 0, 0);
    ctx.fillStyle = '#0d1420'; ctx.fillRect(0, 0, W, H);
    const fl = img(mp.floor);
    if (fl) {
      const pat = ctx.createPattern(fl, 'repeat'), s = (g / DD_PX) * (mp.floorScale || 1);
      pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
      ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
    }
    if (S.mapImg) ctx.drawImage(S.mapImg, 0, 0, W, H);
    if (mp.showGrid) {
      ctx.strokeStyle = 'rgba(79,195,247,0.18)'; ctx.lineWidth = 1 / z; ctx.beginPath();
      for (let x = 0; x <= W; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = 0; y <= H; y += g) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
    }
    // props
    for (const p of mp.props || []) {
      const drag = M.drag && M.drag.prop === p.id;
      const px = drag ? M.drag.px : p.x * g, py = drag ? M.drag.py : p.y * g, w = p.w * g, h = p.h * g;
      const im = img(p.src);
      ctx.save(); ctx.translate(px + w / 2, py + h / 2); ctx.rotate((p.rot || 0) * Math.PI / 180);
      if (im) ctx.drawImage(im, -w / 2, -h / 2, w, h); else { ctx.fillStyle = 'rgba(79,195,247,.15)'; ctx.fillRect(-w / 2, -h / 2, w, h); }
      if (M.selProp === p.id) { ctx.strokeStyle = '#ffb74d'; ctx.lineWidth = 2 / z; ctx.setLineDash([6 / z, 4 / z]); ctx.strokeRect(-w / 2, -h / 2, w, h); }
      ctx.restore();
    }
    // stamp preview
    if (A.stamp && A.hover) {
      const st = A.stamp, im = img(st.src);
      if (im) { ctx.globalAlpha = 0.6; const w = st.w * g, h = st.h * g; ctx.drawImage(im, A.hover.x - w / 2, A.hover.y - h / 2, w, h); ctx.globalAlpha = 1; }
    }
    // tokens
    const ini = S.st.initiative, cur = ini.active && ini.entries[ini.turn];
    for (const t of mp.tokens) {
      const drag = M.drag && M.drag.id === t.id;
      const px = drag ? M.drag.px : t.x * g, py = drag ? M.drag.py : t.y * g, sz = (t.size || 1) * g, r = sz / 2 - 3;
      const cx = px + sz / 2, cy = py + sz / 2;
      ctx.globalAlpha = t.hidden ? 0.45 : 1;
      const isCur = cur && ((cur.charId && cur.charId === t.charId) || (!cur.charId && cur.name === t.name));
      if (isCur) { ctx.beginPath(); ctx.arc(cx, cy, r + 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,183,77,.35)'; ctx.fill(); }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = t.color || '#4fc3f7'; ctx.fill();
      const ch = t.charId && S.st.characters[t.charId];
      const photo = ch && [ch.tokenImage, ch.image].find(u => /^(https?:|\/api\/holotable\?)/.test(u || ''));
      const im = img(t.img || photo);
      if (im) {
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.clip();
        // library art (transparent cut-outs) fits inside the circle; photos fill it
        const s = t.img ? Math.min((r - 2) * 2 / im.width, (r - 2) * 2 / im.height) : Math.max((r * 2) / im.width, (r * 2) / im.height);
        ctx.drawImage(im, cx - im.width * s / 2, cy - im.height * s / 2, im.width * s, im.height * s); ctx.restore();
      } else {
        ctx.fillStyle = '#04121b'; ctx.font = `bold ${Math.round(sz * 0.32)}px Segoe UI, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(initials(t.name), cx, cy + 1);
      }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = (M.sel === t.id ? 3 : 2); ctx.strokeStyle = M.sel === t.id ? '#fff' : 'rgba(0,0,0,.6)'; ctx.stroke();
      if (ch && ch.hp && +ch.hp.max) {
        const pct = Math.max(0, Math.min(1, ch.hp.current / ch.hp.max));
        ctx.fillStyle = '#300'; ctx.fillRect(px + 4, py + sz - 6, sz - 8, 4);
        ctx.fillStyle = pct < .3 ? '#ef5350' : pct < .6 ? '#ffb74d' : '#66bb6a'; ctx.fillRect(px + 4, py + sz - 6, (sz - 8) * pct, 4);
      }
      ctx.font = `600 ${Math.max(10, g * 0.22)}px Segoe UI, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(t.name, cx, py + sz + 1); ctx.fillStyle = '#fff'; ctx.fillText(t.name, cx, py + sz + 1);
      ctx.globalAlpha = 1;
    }
  }
  const canMove = t => isGM() || t.owner === clientId || (t.charId && S.st.characters[t.charId] && S.st.characters[t.charId].owner === clientId);
  function tokenAt(x, y) {
    const g = S.st.map.gridSize;
    return S.st.map.tokens.slice().reverse().find(t => x >= t.x * g && x < (t.x + (t.size || 1)) * g && y >= t.y * g && y < (t.y + (t.size || 1)) * g);
  }
  function mapXY(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom }; }
  const snap = (v, e) => e.altKey ? Math.round(v * 100) / 100 : Math.round(v * 2) / 2;
  canvas.addEventListener('contextmenu', e => { if (A.stamp) { e.preventDefault(); stopStamp(); } });
  canvas.addEventListener('pointerdown', async e => {
    closeTokenPop();
    if (e.button !== 0) return;
    const { x, y } = mapXY(e), g = S.st.map.gridSize;
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
      canvas.setPointerCapture(e.pointerId);
    } else if (!t && isGM()) {
      const p = propAt(x, y);
      if (p) {
        M.selProp = p.id;
        M.drag = { prop: p.id, ox: x - p.x * g, oy: y - p.y * g, px: p.x * g, py: p.y * g, moved: false };
        canvas.setPointerCapture(e.pointerId);
      }
    }
    drawMap();
    if (t && !M.drag) showTokenPop(t, e);
  });
  canvas.addEventListener('pointermove', e => {
    if (A.stamp) { A.hover = mapXY(e); drawMap(); return; }
    if (!M.drag) return;
    const { x, y } = mapXY(e);
    M.drag.px = x - M.drag.ox; M.drag.py = y - M.drag.oy; M.drag.moved = true; drawMap();
  });
  canvas.addEventListener('pointerleave', () => { if (A.stamp) { A.hover = null; drawMap(); } });
  canvas.addEventListener('pointerup', e => {
    if (!M.drag) return;
    const d = M.drag, g = S.st.map.gridSize;
    M.drag = null;
    if (d.prop) {
      const p = (S.st.map.props || []).find(p => p.id === d.prop);
      if (p && d.moved) { p.x = snap(d.px / g, e); p.y = snap(d.py / g, e); act('prop.update', { id: p.id, fields: { x: p.x, y: p.y } }); }
      else if (p) showPropPop(p, e);
      drawMap(); return;
    }
    const t = S.st.map.tokens.find(t => t.id === d.id);
    if (t && d.moved) {
      t.x = Math.max(0, Math.min(S.st.map.cols - 1, Math.round(d.px / g)));
      t.y = Math.max(0, Math.min(S.st.map.rows - 1, Math.round(d.py / g)));
      act('token.move', { id: t.id, x: t.x, y: t.y });
    } else if (t) showTokenPop(t, e);
    drawMap();
  });
  function closeTokenPop() { const p = $('.token-pop'); if (p) p.remove(); }
  function popAt(e) {
    const wrap = $('#mapWrap'), r = wrap.getBoundingClientRect();
    const pop = document.createElement('div'); pop.className = 'token-pop';
    pop.style.left = (e.clientX - r.left + wrap.scrollLeft + 10) + 'px'; pop.style.top = (e.clientY - r.top + wrap.scrollTop + 10) + 'px';
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
      <button class="btn small danger" data-pp="remove">Remove</button>
      <span class="muted" style="font-size:11px">Drag to move · hold Alt to place freely</span>`;
    pop.addEventListener('click', ev => {
      const a = ev.target.dataset.pp; if (!a) return;
      const f = {};
      if (a === 'rl' || a === 'rr') f.rot = ((p.rot || 0) + (a === 'rr' ? 45 : -45) + 360) % 360;
      if (a === 'smaller' || a === 'bigger') { const k = a === 'bigger' ? 1.25 : 0.8; f.w = p.w * k; f.h = p.h * k; f.x = p.x + (p.w - f.w) / 2; f.y = p.y + (p.h - f.h) / 2; }
      if (Object.keys(f).length) { Object.assign(p, f); act('prop.update', { id: p.id, fields: f }); drawMap(); return; }
      if (a === 'front' || a === 'back') act('prop.order', { id: p.id, dir: a });
      if (a === 'dup') act('prop.add', { ...p, x: p.x + 0.5, y: p.y + 0.5 });
      if (a === 'remove') { act('prop.remove', { id: p.id }); M.selProp = null; }
      closeTokenPop();
    });
  }
  function showTokenPop(t, e) {
    closeTokenPop();
    const canEditTok = isGM() || t.owner === clientId;
    const pop = popAt(e);
    const ch = t.charId && S.st.characters[t.charId];
    pop.innerHTML = `<b>${esc(t.name)}</b>${ch ? `<span class="muted">HP ${ch.hp.current}/${ch.hp.max} · AC ${ch.ac}</span><button class="btn small" data-tp="sheet">Open sheet</button>` : ''}
      ${canEditTok ? `<label>Colour<input type="color" value="${esc(t.color || '#4fc3f7')}" data-tp="color"></label>
      <label>Size<select data-tp="size">${[1, 2, 3, 4].map(n => `<option ${n === (t.size || 1) ? 'selected' : ''} value="${n}">${['Medium/Small', 'Large', 'Huge', 'Gargantuan'][n - 1]}</option>`).join('')}</select></label>
      ${isGM() && A.sel ? `<button class="btn small" data-tp="img">Use selected asset as image</button>` : ''}
      ${t.img ? '<button class="btn small ghost" data-tp="noimg">Remove image</button>' : ''}
      ${isGM() ? `<button class="btn small" data-tp="hide">${t.hidden ? 'Reveal to players' : 'Hide from players'}</button>` : ''}
      <button class="btn small danger" data-tp="remove">Remove token</button>` : ''}
      <button class="btn small ghost" data-tp="close">Close</button>`;
    pop.addEventListener('click', ev => {
      const a = ev.target.dataset.tp;
      if (a === 'remove') act('token.remove', { id: t.id });
      if (a === 'hide') act('token.update', { id: t.id, fields: { hidden: !t.hidden } });
      if (a === 'img') act('token.update', { id: t.id, fields: { img: A.sel.src } });
      if (a === 'noimg') act('token.update', { id: t.id, fields: { img: null } });
      if (a === 'sheet') { S.selected = t.charId; setTab('sheet'); renderAll(); }
      if (['remove', 'hide', 'sheet', 'close', 'img', 'noimg'].includes(a)) closeTokenPop();
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
        <input type="file" id="adFile" accept=".dungeondraft_pack,.zip,.pck,image/*" multiple hidden>
        <div id="adProg" class="progress hidden"><div></div></div>
        ${A.packs.length ? `<select id="adPack"><option value="all">All packs (${A.packs.reduce((s, p) => s + p.count, 0)})</option>${A.packs.map(p => `<option value="${p.id}" ${p.id === A.pack ? 'selected' : ''}>${esc(p.name)} (${p.count})</option>`).join('')}</select>
        <input id="adSearch" placeholder="Search crates, consoles, doors…" value="${esc(A.q)}">
        <div class="cats">${['all', ...Object.keys(cats).sort()].map(c => `<button data-cat="${c}" class="${A.cat === c ? 'on' : ''}">${c}${c === 'all' ? '' : ' ' + cats[c]}</button>`).join('')}</div>` : ''}
      </div>
      <div class="asset-grid" id="adGrid">${A.packs.length ? items.slice(0, A.limit).map((a, i) => `<div class="a ${A.sel && A.sel.src === a.src ? 'on' : ''}" data-i="${i}" title="${esc(a.n)}"><img loading="lazy" src="${esc(a.src)}" alt=""><span>${esc(a.n)}</span></div>`).join('')
        + (items.length > A.limit ? `<button class="btn small" id="adMore" style="grid-column:1/-1">Show more (${items.length - A.limit})</button>` : '')
        + (!items.length ? '<p class="muted" style="grid-column:1/-1">Nothing matches.</p>' : '')
        : `<p class="muted" style="grid-column:1/-1">No asset packs yet.<br><br>Upload a <b>Dungeondraft pack</b> (.dungeondraft_pack), a <b>.zip</b> of images, or single images. Packs are stored on this server and available in every campaign.</p>`}</div>
      ${A.sel ? `<div class="asset-sel"><b>${esc(A.sel.n)}</b><span class="muted" style="font-size:12px">${A.sel.w ? `${A.sel.w}×${A.sel.h}px · ${(A.sel.w / DD_PX).toFixed(1)}×${(A.sel.h / DD_PX).toFixed(1)} squares` : ''}</span>
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
        try { await post('packdelete', { code: S.code, packId: p.id }); } catch (err) { toast(err.message, true); }
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
  // Packs are unpacked in the browser (packs.js) and sent in ~3 MB batches, so even a 60 MB
  // Dungeondraft pack fits through the site's per-request size limit.
  async function uploadPack(file) {
    const bar = () => $('#adProg');
    const show = (pct, label) => { const b = bar(); if (b) { b.classList.remove('hidden'); b.firstElementChild.style.width = pct + '%'; b.title = label; } };
    try {
      toast(`Reading ${file.name}…`);
      const pack = await window.PackReader.read(file, (i, n) => show(40 * i / n, `Preparing ${i}/${n}`));
      const bytes = pack.items.reduce((s, it) => s + it.data.length * 0.75, 0);
      const { packId } = await post('packstart', { code: S.code, name: pack.name, author: pack.author, bytes });
      let batch = [], size = 0, sent = 0;
      const flush = async () => {
        if (!batch.length) return;
        await post('packadd', { code: S.code, packId, items: batch });
        sent += batch.length; batch = []; size = 0;
        show(40 + 60 * sent / pack.items.length, `Uploading ${sent}/${pack.items.length}`);
      };
      for (const it of pack.items) {
        if (size + it.data.length > 3000000) await flush();
        batch.push(it); size += it.data.length;
      }
      await flush();
      const done = await post('packdone', { code: S.code, packId });
      toast(`Added “${done.pack.name}” — ${done.pack.count} images`);
      A.pack = packId; A.cat = 'all';
      await loadPacks();
    } catch (err) { toast(err.message || 'Upload failed', true); }
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
          <button class="btn tiny" data-ho="toggle" data-id="${h.id}">${h.shared ? 'Unshare' : 'Share'}</button><button class="btn tiny ghost" data-ho="del" data-id="${h.id}">✕</button>` : ''}</h4>
        ${h.img ? `<img src="${esc(h.img)}" style="max-width:100%;border-radius:6px;margin-bottom:6px">` : ''}<div>${md(h.text || '')}</div></div>`).join('')
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
        $('#hoImg').value = (await post('upload', { code: S.code, purpose: 'handout', dataUrl })).url;
        toast('Image attached');
      } catch (err) { toast(err.message || 'Could not read image', true); }
    }
  });

  // --------------------------------------------------------------------------- rules
  function renderRules(filter = '') {
    const f = filter.toLowerCase();
    const match = (...s) => !f || s.join(' ').toLowerCase().includes(f);
    const sec = (t, b) => match(t, b.replace(/<[^>]+>/g, '')) ? `<div class="box rule"><h4>${t}</h4><div>${b}</div></div>` : '';
    let html = `<input class="rules-search" id="rulesSearch" placeholder="Search rules, conditions, classes, weapons…" value="${esc(filter)}">`;
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
    html += `<p class="muted" style="font-size:12px">Summaries for quick reference. Full rules: the SW5e Player's Handbook at sw5e.com. Values listed as defaults can be overridden on any sheet.</p>`;
    $('#rules').innerHTML = html;
    if (filter) { const inpEl = $('#rulesSearch'); inpEl.focus(); inpEl.setSelectionRange(filter.length, filter.length); }
  }
  $('#rules').addEventListener('input', e => { if (e.target.id === 'rulesSearch') renderRules(e.target.value); });

  // --------------------------------------------------------------------------- GM
  function renderGM(el) {
    if (!isGM()) { el.innerHTML = ''; return; }
    const link = location.origin + location.pathname + '?join=' + S.st.code;
    el.innerHTML = `<div class="grid g2">
      <div class="box"><h4>Invite players</h4>
        <p>Room code: <span class="code" style="font-size:18px">${esc(S.st.code)}</span></p>
        <p>Link: <code>${esc(link)}</code> <button class="btn tiny" id="copyLink">Copy</button></p>
        <h4 style="margin-top:12px">Campaign</h4>
        <div class="row"><input id="campRename" value="${esc(S.st.name)}" style="flex:1"><button class="btn small" id="doRename">Rename</button></div>
        <h4 style="margin-top:12px">GM key</h4>
        <p class="muted" style="font-size:12px">To run this campaign from another browser or device, use “Join”, open “I'm the GM on a new device” and paste this key. Keep it secret.</p>
        <div class="row"><code style="flex:1;overflow:auto">${esc(S.st.gmToken || '')}</code><button class="btn tiny" id="copyKey">Copy</button></div>
        <h4 style="margin-top:12px">Players</h4>
        ${Object.entries(S.st.players).map(([id, p]) => `<div>${esc(p.name)} ${id === S.st.gmId ? '<span class="muted">(GM)</span>' : ''} ${S.st.online.some(o => o.clientId === id) ? '<span style="color:var(--green)">● online</span>' : '<span class="muted">offline</span>'}
          <span class="muted">— ${chars().filter(c => c.owner === id).map(c => esc(c.name)).join(', ') || 'no characters'}</span></div>`).join('')}
        <div class="row" style="margin-top:12px"><button class="btn small danger" id="clearChat">Clear chat log</button></div>
      </div>
      <div class="box"><h4>Saving &amp; backups</h4>
        <p style="margin:0 0 6px"><span style="color:var(--green)">✓ Every change saves automatically to Boofer's Den.</span>
          <span class="muted">Last saved ${S.st.updated ? new Date(S.st.updated * 1000).toLocaleString() : '—'}</span></p>
        <p class="muted" style="font-size:12px;margin:0 0 8px">Next session: open this page and press <b>Rejoin</b>. On a new device, join with code ${esc(S.st.code)}
          and paste your GM key. Players rejoin with the same code and keep their characters. A backup copy is also kept every 10 minutes of play (last 10).</p>
        <div class="row wrap"><a class="btn small primary" href="${API}?op=export&code=${S.st.code}&clientId=${encodeURIComponent(clientId)}" download>⇩ Download full backup</a>
          <button class="btn small" id="showBackups">Automatic backups…</button></div>
        <div id="backupList" style="margin-top:8px"></div>
      </div>
      <div class="box"><h4>GM notes <span class="muted" style="text-transform:none;letter-spacing:0">(only you can see these · autosaves)</span></h4>
        <textarea id="gmNotes" rows="24" placeholder="Session plan, NPCs, secrets, loot…">${esc(S.st.notes || '')}</textarea></div>
    </div>`;
  }
  $('#gm').addEventListener('click', e => {
    const id = e.target.id;
    if (id === 'copyLink') navigator.clipboard?.writeText(location.origin + location.pathname + '?join=' + S.st.code).then(() => toast('Copied'));
    if (id === 'copyKey') navigator.clipboard?.writeText(S.st.gmToken).then(() => toast('GM key copied'));
    if (id === 'doRename') act('campaign.rename', { name: $('#campRename').value });
    if (id === 'clearChat' && confirm('Clear the chat log for everyone?')) act('chat.clear');
    if (id === 'showBackups') {
      post('backups', { code: S.code }).then(r => {
        const fmtB = b => b.at ? new Date(b.at * 1000).toLocaleString() : 'backup ' + (b.i + 1);
        $('#backupList').innerHTML = r.backups.length ? r.backups.map(b => `<div class="row" style="font-size:13px"><span style="flex:1">${esc(fmtB(b))}</span>
          <a class="btn tiny" download href="${API}?op=export&code=${S.code}&clientId=${encodeURIComponent(clientId)}&backup=${b.i}">⇩ download</a></div>`).join('')
          + '<p class="muted" style="font-size:12px">To roll back, download a backup and use “Restore a backup” on the start screen.</p>'
          : '<p class="muted">No automatic backups yet — the first is made on the next change.</p>';
      }).catch(err => toast(err.message, true));
    }
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
    if (m.system) return `<div class="msg sys">${md(m.text)}</div>`;
    const who = m.as ? `${esc(m.as)} <span class="muted" style="font-weight:400">(${esc(m.from)})</span>` : m.charName ? `${esc(m.charName)} <span class="muted" style="font-weight:400">(${esc(m.from)})</span>` : esc(m.from);
    const priv = m.private ? `<div class="tag">${m.roll ? '🔒 GM-only roll' : m.fromId === clientId ? '🔒 whisper to ' + esc(m.whisperTo || 'GM') : '🔒 whisper'}</div>` : '';
    if (m.roll) {
      const r = m.roll, crit = r.nat === 20 && r.kind !== 'damage', fumble = r.nat === 1 && r.kind !== 'damage';
      const detail = esc(r.detail).replace(/~(\d+)~/g, '<del>$1</del>');
      return `<div class="msg ${m.private ? 'priv' : ''}"><div class="who">${who}${t}</div>${priv}
        <div class="roll ${crit ? 'crit' : ''} ${fumble ? 'fumble' : ''}"><div class="label">${esc(r.label || r.expr)}${crit ? ' — NATURAL 20!' : fumble ? ' — natural 1' : ''}</div>
        <div class="total">${r.total}</div><div class="detail">${esc(r.expr)} → ${detail}</div></div></div>`;
    }
    if (m.narration) return `<div class="msg narr">${md(m.text)}</div>`;
    if (m.emote) return `<div class="msg emote">* ${esc(m.from)} ${md(m.text)}</div>`;
    return `<div class="msg ${m.private ? 'priv' : ''}"><div class="who">${who}${t}</div>${priv}<div>${md(m.text)}</div></div>`;
  }
  function renderChat() {
    const log = $('#chatLog'), msgs = S.st.chat;
    const last = msgs.length ? msgs[msgs.length - 1].id : null;
    if (last === S.lastChatId && log.childElementCount === msgs.length) return;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.innerHTML = msgs.map(renderMsg).join('');
    if (atBottom || S.lastChatId === null || (msgs.length && msgs[msgs.length - 1].fromId === clientId)) log.scrollTop = log.scrollHeight;
    S.lastChatId = last;
  }
  $('#chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const input = $('#chatInput'), text = input.value.trim(); if (!text) return;
    S.chatHist.unshift(text); S.chatHistIdx = -1;
    input.value = '';
    const sc = selChar();
    const res = await act('chat', { text, as: sc && sc.owner === clientId && !text.startsWith('/') ? sc.name : '' });
    if (!res) input.value = text;
  });
  $('#chatInput').addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' && S.chatHist.length) { S.chatHistIdx = Math.min(S.chatHist.length - 1, S.chatHistIdx + 1); e.target.value = S.chatHist[S.chatHistIdx]; e.preventDefault(); }
    if (e.key === 'ArrowDown') { S.chatHistIdx = Math.max(-1, S.chatHistIdx - 1); e.target.value = S.chatHistIdx < 0 ? '' : S.chatHist[S.chatHistIdx]; e.preventDefault(); }
  });
  $('#quickDice').innerHTML = [4, 6, 8, 10, 12, 20, 100].map(d => `<button type="button" data-d="${d}" title="Roll 1d${d}">d${d}</button>`).join('');
  $('#quickDice').addEventListener('click', e => {
    const b = e.target.closest('[data-d]'); if (!b) return;
    const d = +b.dataset.d;
    roll('1d' + d, 'd' + d, { d20: d === 20, mode: rollModeFromEvent(e) });
  });

  // --------------------------------------------------------------------------- boot
  window.addEventListener('resize', () => drawMap());
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeModal(); closeTokenPop();
    if (A.stamp) stopStamp();
    if (M.selProp) { M.selProp = null; drawMap(); }
  });
  renderRules();
  renderRecent();
  const params = new URLSearchParams(location.search);
  const jc = params.get('join');
  if (jc) {
    const r = recent().find(x => x.code === jc.toUpperCase());
    if (r && r.playerName) join(r.code, r.playerName, r.gmToken);
    else { $('#joinForm [name=code]').value = jc.toUpperCase(); $('#joinForm [name=playerName]').focus(); }
  }
})();
