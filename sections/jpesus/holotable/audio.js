/* HoloTable: table audio.
 * The GM uploads music or ambience (stored on our own server, like images) and plays it for the whole table.
 * The server keeps what's playing (track, playing or paused, position, when, loop, master volume); every screen
 * plays the same file and keeps itself within a second or two of it. Each person sets their own volume or mutes.
 * Uses the helpers app.js shares on window.HT. Nothing here loads from any other site.
 */
(() => {
  const H = window.HT;
  const { $, esc, n0 } = H;
  const el = new Audio();
  el.preload = 'auto';
  const A = { tracks: null, lib: null, clock: 0, blocked: false, src: '', uploading: '' };
  const me = { vol: 0.8, mute: false };
  try { Object.assign(me, JSON.parse(localStorage.getItem('holo.audio') || '{}')); } catch { /* storage unavailable */ }
  const saveMe = () => { try { localStorage.setItem('holo.audio', JSON.stringify(me)); } catch { /* storage unavailable */ } };
  const url = id => `${H.API}?aud=${encodeURIComponent(id)}`;
  const fmtT = s => { s = Math.max(0, Math.floor(n0(s))); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const mb = b => `${(n0(b) / 1048576).toFixed(1)} MB`;

  // where the track should be right now, on this screen's clock
  function wanted(au) {
    if (!au.playing) return n0(au.pos);
    let t = n0(au.pos) + (Date.now() / 1000 + A.clock - n0(au.at));
    if (el.duration && isFinite(el.duration)) t = au.loop ? t % el.duration : Math.min(t, el.duration);
    return Math.max(0, t);
  }
  // keep this screen in step with what the GM has playing
  function sync() {
    const st = H.S.st; if (!st) return;
    const au = st.audio;
    if (au && au.now) A.clock = n0(au.now) - Date.now() / 1000;
    if (!au) { if (!el.paused) el.pause(); if (A.src) { el.removeAttribute('src'); el.load(); A.src = ''; } renderTop(); return; }
    if (A.src !== au.track) { A.src = au.track; el.src = url(au.track); }
    el.loop = !!au.loop;
    el.volume = me.mute ? 0 : Math.max(0, Math.min(1, n0(au.vol) * me.vol));
    const t = wanted(au);
    if (au.playing) {
      if (Math.abs((el.currentTime || 0) - t) > 1.5 && el.readyState >= 1) el.currentTime = t;
      if (el.paused) el.play().then(() => { A.blocked = false; renderTop(); }).catch(() => { A.blocked = true; renderTop(); });
    } else {
      if (!el.paused) el.pause();
      if (el.readyState >= 1 && Math.abs((el.currentTime || 0) - t) > 0.5) el.currentTime = t;
    }
    renderTop();
  }
  el.addEventListener('loadedmetadata', () => { const au = H.S.st && H.S.st.audio; if (au) { el.currentTime = wanted(au); sync(); } renderGmBox(); });
  el.addEventListener('ended', () => renderTop());
  setInterval(() => { const au = H.S.st && H.S.st.audio; if (au && au.playing && !el.paused && Math.abs(el.currentTime - wanted(au)) > 2) el.currentTime = wanted(au); renderGmProgress(); }, 2000);

  // ---- the ♪ control in the top bar, for everyone
  const top = document.createElement('span');
  top.className = 'audio-top';
  const anchor = $('#themeBtn');
  if (anchor) anchor.parentNode.insertBefore(top, anchor);
  function renderTop() {
    const au = H.S.st && H.S.st.audio;
    if (!au) { top.innerHTML = ''; top.classList.add('hidden'); return; }
    top.classList.remove('hidden');
    top.innerHTML = A.blocked && au.playing
      ? `<button class="btn small amber" data-au="unblock" title="Your browser waits for a click before playing sound">🔊 Tap to hear the table's audio</button>`
      : `<button class="btn small ghost audio-now ${au.playing ? 'on' : ''}" data-au="pop" title="Table audio: your volume">${me.mute ? '🔇' : '♪'} ${esc(au.name)}${au.playing ? '' : ' (paused)'}</button>`;
  }
  top.addEventListener('click', e => {
    const b = e.target.closest('[data-au]'); if (!b) return;
    if (b.dataset.au === 'unblock') { el.play().then(() => { A.blocked = false; sync(); }).catch(() => {}); return; }
    if (b.dataset.au === 'pop') {
      const old = $('.audio-pop'); if (old) { old.remove(); return; }
      const pop = document.createElement('div');
      pop.className = 'audio-pop token-pop';
      const r = b.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(innerWidth - 240, r.left)) + 'px'; pop.style.top = (r.bottom + 6) + 'px';
      pop.innerHTML = `<b>Table audio</b><span class="muted">${esc((H.S.st.audio || {}).name || '')}</span>
        <label>Your volume <input type="range" min="0" max="1" step="0.05" value="${me.vol}" data-aup="vol"></label>
        <label class="toggle"><input type="checkbox" data-aup="mute" ${me.mute ? 'checked' : ''}> Mute it for me</label>
        <span class="muted" style="font-size:11px">Only changes what you hear.</span>`;
      document.body.appendChild(pop);
      pop.addEventListener('input', ev => { if (ev.target.dataset.aup === 'vol') { me.vol = +ev.target.value; saveMe(); sync(); } });
      pop.addEventListener('change', ev => { if (ev.target.dataset.aup === 'mute') { me.mute = ev.target.checked; saveMe(); sync(); } });
      setTimeout(() => document.addEventListener('mousedown', function close(ev) { if (!pop.contains(ev.target) && !b.contains(ev.target)) { pop.remove(); document.removeEventListener('mousedown', close); } }), 0);
    }
  });

  // ---- the GM's "Table audio" box (in the GM tab)
  async function loadTracks(force) {
    if (A.tracks && !force) return A.tracks;
    const r = await fetch(`${H.API}?op=audios`, { credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    A.tracks = Array.isArray(j.tracks) ? j.tracks : []; A.used = j.used; A.cap = j.cap; A.maxTrack = j.maxTrack;
    return A.tracks;
  }
  function renderGmProgress() {
    const p = $('#auProgress'); const au = H.S.st && H.S.st.audio;
    if (p && au) p.textContent = `${fmtT(el.currentTime || wanted(au))}${el.duration && isFinite(el.duration) ? ' / ' + fmtT(el.duration) : ''}`;
  }
  function renderGmBox() {
    const box = $('#gmAudio'); if (!box || !H.isGM()) return;
    const au = H.S.st.audio, tracks = A.tracks || [];
    box.innerHTML = `<h4>Table audio <span class="muted" style="text-transform:none;letter-spacing:0">(music and ambience for everyone)</span></h4>
      ${au ? `<div class="au-now"><b>${au.playing ? '▶' : '⏸'} ${esc(au.name)}</b> <span class="muted" id="auProgress"></span>
        <div class="row wrap" style="margin-top:6px">${au.playing ? '<button class="btn small" data-ag="pause">⏸ Pause</button>' : '<button class="btn small primary" data-ag="resume">▶ Resume</button>'}
          <button class="btn small" data-ag="restart" title="Back to the start">⏮</button><button class="btn small danger" data-ag="stop">⏹ Stop</button>
          <label class="toggle"><input type="checkbox" data-ag="loop" ${au.loop ? 'checked' : ''}> Loop</label>
          <label class="mini">Table volume <input type="range" min="0" max="1" step="0.05" value="${n0(au.vol)}" data-ag="vol"></label></div></div>` : '<p class="muted" style="margin:0 0 6px">Nothing playing.</p>'}
      <div class="au-list">${tracks.map(t => `<div class="row au-row"><span class="au-name">${esc(t.name)}</span><span class="muted">${mb(t.bytes)}</span><span class="spacer"></span>
        <button class="btn tiny ${au && au.track === t.id ? 'ghost' : 'primary'}" data-ag="play" data-id="${esc(t.id)}">${au && au.track === t.id ? 'Playing' : '▶ Play'}</button>
        <button class="btn tiny ghost" data-ag="del" data-id="${esc(t.id)}" title="Delete this track">✕</button></div>`).join('') || (A.tracks ? '<p class="muted">No tracks yet.</p>' : '<p class="muted">Loading…</p>')}</div>
      <div class="row wrap" style="margin-top:8px"><button class="btn small" data-ag="upload">⇪ Upload audio…</button>
        <input type="file" id="auFile" accept="audio/*,.mp3,.ogg,.wav,.flac,.m4a,.webm" multiple hidden>
        <span class="muted" style="font-size:12px">${A.uploading ? esc(A.uploading) : `MP3, OGG, WAV, FLAC, M4A or WebM, up to ${n0(A.maxTrack || 31457280) / 1048576} MB each.${A.cap ? ` Storage: ${mb(A.used)} of ${mb(A.cap)}.` : ''}`}</span></div>`;
    renderGmProgress();
  }
  async function uploadTrack(file) {
    A.uploading = `Uploading ${file.name}…`; renderGmBox();
    try {
      const start = await H.post('audiostart', { name: file.name, bytes: file.size });
      const part = start.part, n = Math.ceil(file.size / part);
      for (let i = 0; i < n; i++) {
        const blob = file.slice(i * part, Math.min(file.size, (i + 1) * part));
        const data = await new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = bad; fr.readAsDataURL(blob); });
        let tries = 0;
        for (;;) {   // a part that timed out is sent again; the server ignores a part it already has
          try { await H.post('audioadd', { id: start.id, seq: i, data }); break; } catch (err) { if (++tries >= 3 || /audio file|full|room|order|bad/i.test(err.message)) throw err; await new Promise(r => setTimeout(r, 800 * tries)); }
        }
        A.uploading = `Uploading ${file.name}: ${Math.round(100 * (i + 1) / n)}%`; renderGmBox();
      }
      await H.post('audiodone', { id: start.id });
      H.toast(`Added ${file.name}`);
    } catch (err) { H.toast(`${file.name}: ${err.message}`, true); }
    A.uploading = ''; await loadTracks(true); renderGmBox();
  }
  const gm = $('#gm');
  gm.addEventListener('click', async e => {
    const b = e.target.closest('[data-ag]'); if (!b) return;
    const a = b.dataset.ag, au = H.S.st.audio;
    if (a === 'upload') return $('#auFile').click();
    if (a === 'play') { const t = (A.tracks || []).find(x => x.id === b.dataset.id); if (t) { A.src = ''; H.act('audio.play', { track: t.id, name: t.name, pos: 0 }); } }
    if (a === 'resume' && au) H.act('audio.play', { track: au.track, name: au.name, pos: el.currentTime || n0(au.pos) });
    if (a === 'restart' && au) H.act('audio.play', { track: au.track, name: au.name, pos: 0 });
    if (a === 'pause' && au) H.act('audio.pause', { pos: el.currentTime || wanted(au) });
    if (a === 'stop') H.act('audio.stop');
    if (a === 'del') {
      const t = (A.tracks || []).find(x => x.id === b.dataset.id);
      if (t && confirm(`Delete “${t.name}” from the table's audio?`)) {
        if (au && au.track === t.id) await H.act('audio.stop');
        try { await H.post('audiodelete', { id: t.id }); } catch (err) { H.toast(err.message, true); }
        await loadTracks(true); renderGmBox();
      }
    }
  });
  gm.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'auFile' && t.files.length) { const files = [...t.files]; t.value = ''; files.reduce((p, f) => p.then(() => uploadTrack(f)), Promise.resolve()); }
    if (t.dataset.ag === 'loop') H.act('audio.set', { loop: t.checked });
    if (t.dataset.ag === 'vol') H.act('audio.set', { vol: +t.value });
  });

  // app.js calls this after every update
  window.HTA = {
    sync() {
      sync();
      if (!H.isGM()) return;
      if (A.lib !== H.S.lib) { A.lib = H.S.lib; loadTracks(true).then(renderGmBox).catch(() => {}); }
      else renderGmBox();
    },
  };
  if (H.S.st) window.HTA.sync();
})();
