/* HoloTable starships: the space map. jpesus's call (#146): ship fights on their own map, 50 ft a square, with ship
   tokens at ship scale (Tiny and Small 1 square, Medium 2, Large 4, Huge 8, Gargantuan 16); the table's own map stays as
   it is, and the GM switches the table to this one and back. The geometry is in starships.js (HTShips); every change
   goes to the server as a space.* action (api/_holotable-space.js), which checks it and keeps it inside the map. */
(function () {
  const H = window.HT, SR = window.HTShips;
  if (!H || !SR) return;
  const { $, esc } = H;
  const V = { sel: null, seenN: null, cell: 24, weapon: 0, target: null, crew: 0, mode: 'single' };
  const sp = () => (H.S.st && H.S.st.space) || null;
  const shipById = (id) => ((H.S.st && H.S.st.ships) || []).find((s) => s.id === id);
  const tokById = (id) => ((sp() || {}).tok || []).find((t) => t.id === id);
  const sizeOfTok = (t) => SR.SQUARES[t.size] || 1;
  // the GM moves any ship; a player moves a party ship (the server checks again)
  const mayMove = (t) => H.isGM() || (t && !t.enemy);

  function render() {
    const el = $('#space'); if (!el || !H.S.st) return;
    const s = sp();
    // the GM switched the table to the space map: every screen turns to it, once each time
    if (s && s.on && s.n && s.n !== V.seenN) { V.seenN = s.n; if (H.S.tab !== 'space') H.setTab('space'); }
    const a = document.activeElement; if (a && el.contains(a) && a.matches('input, select')) return;
    const gm = H.isGM(), on = !!(s && s.on);
    if (V.sel && !tokById(V.sel)) V.sel = null;
    const placed = new Set(((s || {}).tok || []).map((t) => t.id));
    const addable = ((H.S.st.ships) || []).filter((x) => !placed.has(x.id) && (gm || !x.hidden));
    let html = `<div class="row wrap space-top"><h3 style="margin:0">Space map</h3>
      <span class="muted" style="font-size:12px">50 ft a square</span>
      ${gm ? (on ? '<button class="btn small" data-spx="off">Back to the table\'s map</button>' : '<button class="btn small primary" data-spx="on" title="Every screen turns to the space map">Switch the table to the space map</button>') : (on ? '' : '<span class="muted">The GM hasn\'t switched the table to the space map.</span>')}
      ${gm ? `<label class="ship-lv">Size <input type="number" id="spCols" value="${s ? s.cols : 40}" min="10" max="120" style="width:58px"> × <input type="number" id="spRows" value="${s ? s.rows : 28}" min="10" max="120" style="width:58px"></label>` : ''}
      <span class="spacer"></span>
      ${addable.length ? `<select id="spAdd">${addable.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.hidden ? ' (hidden)' : ''}</option>`).join('')}</select><button class="btn small" data-spx="add">Put on the map</button>` : ''}
    </div>
    <div class="space-body"><div class="space-side">${side(s, gm)}</div><div class="space-wrap" id="spaceWrap"><canvas id="spaceCanvas"></canvas></div></div>`;
    el.innerHTML = html;
    draw(); preview();
  }

  function side(s, gm) {
    if (!s) return '<p class="muted">No ships on the space map yet. Put one on with the picker above.</p>';
    const order = s.order || [], cur = s.turnId, curTok = tokById(cur);
    let h = `<div class="box"><h4>Ship turns ${s.active ? `<span class="muted" style="text-transform:none;letter-spacing:0">round ${s.round}</span>` : ''}</h4>`;
    h += order.length ? `<ol class="space-order">${order.map((e) => { const t = tokById(e.id) || {}; return `<li class="${e.id === cur ? 'on' : ''}" data-spsel="${esc(e.id)}"><span class="sw" style="background:${esc(t.color || '#90a4ae')}"></span>${esc(t.name || '?')}<span class="spacer"></span><b>${e.init}</b></li>`; }).join('')}</ol>`
      : '<p class="muted" style="font-size:12px">No ship combat yet.</p>';
    if (gm) h += `<div class="row wrap" style="gap:4px">${s.active ? '<button class="btn tiny" data-spx="prev">◀</button><button class="btn tiny primary" data-spx="next">Next ship ▶</button><button class="btn tiny ghost" data-spx="end">End</button>' : '<button class="btn tiny primary" data-spx="init" title="Party ships go at their crew\'s lowest initiative roll; enemy ships roll Dexterity with their size modifier">Roll initiative and start</button>'}</div>`;
    else if (s.active && curTok && !curTok.enemy) h += '<button class="btn tiny primary" data-spx="next">End our ship\'s turn ▶</button>';
    h += '</div>';
    const t = tokById(V.sel), ship = t && shipById(t.id);
    if (t) {
      const speed = ship ? SR.moveBudget(ship) : null, moved = (s.moved || {})[t.id], mine = s.active && cur === t.id;
      h += `<div class="box" style="margin-top:8px"><h4>${esc(t.name)}</h4>
        <p style="font-size:12px;margin:0 0 6px">Facing ${SR.FACING_NAMES[t.f]} · ${sizeOfTok(t)}×${sizeOfTok(t)} squares${ship ? ` · speed ${speed} ft (${Math.floor(speed / 50)} squares), a 90° turn ${ship.turn || 0} ft` : ''}${mine ? `<br>Moved ${moved || 0}${speed != null ? ` of ${speed}` : ''} ft this turn${speed != null && moved > speed ? ' <b>(over its speed)</b>' : ''}` : ''}</p>
        ${mayMove(t) ? `<div class="row wrap" style="gap:4px"><button class="btn tiny" data-spx="turn" data-d="-1" title="Turn 45° to port">⟲</button><button class="btn tiny" data-spx="turn" data-d="1" title="Turn 45° to starboard">⟳</button>
          <span class="muted" style="font-size:12px">Click a square on the map to move it there.</span></div>
          <div class="row wrap" style="gap:4px;margin-top:6px">${gm ? `<label class="toggle"><input type="checkbox" data-spt="hidden" ${t.hidden ? 'checked' : ''}> off players' maps</label>${t.enemy ? `<label class="toggle"><input type="checkbox" data-spt="named" ${t.named ? 'checked' : ''}> players see its name</label>` : ''}` : ''}
          ${ship ? '<button class="btn tiny ghost" data-spx="sheet">Ship sheet</button>' : ''}<button class="btn tiny ghost" data-spx="remove">Take off the map</button></div>` : ''}</div>`;
      if (ship && mayMove(t)) h += fireBox(s, t, ship);
    }
    return h;
  }

  // the Fire action: a weapon of the selected ship at another ship on the map; the preview is only a preview, the
  // server checks the arc and range again and rolls
  function fireBox(s, t, ship) {
    const weapons = ship.weapons || [], targets = s.tok.filter((x) => x.id !== t.id), crew = ship.crew || [];
    const st = SR.statusOf(ship), helmUsed = st.fx.helm, gone = SR.isDisabled(st) || SR.isLost(st);
    const helmRow = gone ? '<p class="muted" style="font-size:12px">It can\'t take actions.</p>' : `<div class="row wrap" style="gap:4px;margin-top:6px"><span class="muted" style="font-size:12px">Helm${helmUsed ? ' (taken this turn)' : ''}</span>
      <button class="btn tiny" data-spx="helm" data-what="evade" ${helmUsed ? 'disabled' : ''} title="Attacks against it have disadvantage and its Dexterity saves advantage until its next turn; its own checks and attacks have disadvantage through that turn">Evade</button>
      <button class="btn tiny" data-spx="helm" data-what="fly" ${helmUsed ? 'disabled' : ''} title="Twice its speed this turn; disadvantage on its checks and attacks through its next turn">Fly</button>
      <button class="btn tiny" data-spx="helm" data-what="hardturn" ${helmUsed ? 'disabled' : ''} title="Its next turn of up to 90° this turn costs no movement">Hard turn</button>
      ${targets.length ? `<button class="btn tiny" data-spx="dogfight" ${helmUsed ? 'disabled' : ''} title="Opposed Dexterity (Maneuvering): the target's next attack on you has disadvantage, another ship's next has advantage, and your forward primary weapons fire at it without the helm's disadvantage">Dogfight</button>
      <button class="btn tiny" data-spx="harass" ${helmUsed ? 'disabled' : ''} title="With the selected forward primary weapon (it can't fire this turn), at a target within one size and in normal range: opposed Dexterity (Maneuvering); if it leaves its square before your next turn, it takes that weapon's critical hit">Harass</button>
      <button class="btn tiny" data-spx="run" ${helmUsed || !((s.moved || {})[t.id] >= 150) || s.turnId !== t.id ? 'disabled' : ''} title="After moving 150 ft or more toward the target this turn: your next forward shot at it has no helm disadvantage (tertiary: + feet/50 damage, up to Strength), or ram it with advantage (+ feet/50, up to Constitution)">Attack run</button>` : ''}
      <button class="btn tiny" data-spx="conceal" ${helmUsed || st.fx.concealed ? 'disabled' : ''} title="Dexterity (Hide) against the other side's passive Wisdom (Scan): unseen until you attack">${st.fx.concealed ? 'Concealed' : 'Conceal'}</button>
      ${targets.length ? `<button class="btn tiny" data-spx="ram" ${helmUsed ? 'disabled' : ''} title="Within 50 ft: Strength (Ram) against the target's Dexterity (Maneuvering); both take two hull dice + Strength in kinetic damage, the rammer half while its shields hold">Ram the target</button>` : ''}</div>
      <div class="row wrap" style="gap:4px;margin-top:4px"><span class="muted" style="font-size:12px">Crew</span>
      ${targets.length ? '<button class="btn tiny" data-spx="interfere" title="Within 1,000 ft: Charisma (Interfere) against the target\'s Wisdom (Scan); its next check or attack roll has disadvantage">Interfere with the target</button>' : ''}
      <button class="btn tiny" data-spx="direct" ${st.fx.directed ? 'disabled' : ''} title="Its next attack roll has advantage">Direct${st.fx.directed ? 'ed' : ''}</button></div>`;
    if (!targets.length) return `<div class="box" style="margin-top:8px"><h4>Actions</h4>${helmRow}</div>`;
    if (!weapons.length) return `<div class="box" style="margin-top:8px"><h4>Actions</h4><label class="ship-lv">Target <select id="spTarget">${targets.map((x) => `<option value="${esc(x.id)}" ${x.id === V.target ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>${helmRow}<p class="muted" style="font-size:12px">No weapons on its sheet.</p></div>`;
    if (!targets.some((x) => x.id === V.target)) V.target = targets[0].id;
    if (V.weapon >= weapons.length) V.weapon = 0;
    if (V.crew >= Math.max(1, crew.length)) V.crew = 0;
    const crewName = (c) => (c.charId && H.S.st.characters[c.charId] ? H.S.st.characters[c.charId].name : c.name) || 'Crew member';
    return `<div class="box" style="margin-top:8px"><h4>Actions</h4>
      <label class="ship-lv">Crew member <select id="spCrew">${crew.length ? crew.map((c, i) => `<option value="${i}" ${i === V.crew ? 'selected' : ''}>${esc(crewName(c))}</option>`).join('') : '<option value="0">no crew (+2)</option>'}</select></label>
      <label class="ship-lv">Weapon <select id="spWeapon">${weapons.map((w, i) => `<option value="${i}" ${i === V.weapon ? 'selected' : ''}>${esc(w.name)}${w.arc ? ' · ' + esc(w.arc) : ''}${typeof w.ammo === 'number' ? ` · ${w.ammo} left` : ''}${SR.heatCap(w) !== null ? ` · heat ${+w.heat || 0}/${SR.heatCap(w)}` : ''}</option>`).join('')}</select></label>
      ${modeSel(weapons[V.weapon])}
      <label class="ship-lv">Target <select id="spTarget">${targets.map((x) => `<option value="${esc(x.id)}" ${x.id === V.target ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <p class="muted" id="spPreview" style="font-size:12px;margin:6px 0"></p>
      <button class="btn small amber" data-spx="fire">Fire</button>${coolReload(weapons[V.weapon])}${helmRow}</div>`;
  }
  // rapid and burst modes, for weapons that have them (auto weapons fire only in those)
  function modeSel(w) {
    const modes = SR.weaponModes(w);
    if (!modes.includes(V.mode)) V.mode = modes[0];
    if (modes.length < 2) return modes[0] === 'single' ? '' : `<span class="muted" style="font-size:12px">${modes[0]} only</span>`;
    return `<label class="ship-lv">Mode <select id="spMode">${modes.map((m) => `<option ${m === V.mode ? 'selected' : ''}>${m}</option>`).join('')}</select></label>`;
  }
  function coolReload(w) {
    if (!w) return '';
    const cap = SR.heatCap(w), rl = SR.reloadOf(w);
    return (cap !== null && +w.heat ? ` <button class="btn tiny" data-spx="cool" title="An action: the weapon's heat back to 0">Cool (${+w.heat}/${cap})</button>` : '')
      + (rl !== null && typeof w.ammo === 'number' && w.ammo < rl ? ` <button class="btn tiny ghost" data-spx="reload" title="A minute per round of ammunition: not in the middle of a fight">Reload to ${rl}</button>` : '');
  }
  function preview() {
    const el = $('#spPreview'); if (!el) return;
    const t = tokById(V.sel), ship = t && shipById(t.id), tt = tokById(V.target), w = ship && (ship.weapons || [])[V.weapon];
    if (!t || !ship || !tt || !w) { el.textContent = ''; return; }
    const row = (ship.crew || [])[V.crew], target = shipById(tt.id) || { id: tt.id, size: tt.size }, c = SR.fireCheck(ship, t, w, target, tt, { fromHelm: !!row && row.deployment === 'Pilot' });
    const crew = (ship.crew || [])[V.crew], pb = crew && crew.charId && H.S.st.characters[crew.charId] ? H.R.profBonus(H.S.st.characters[crew.charId]) : (crew && +crew.pb) || 2;
    const sign = (n) => (n >= 0 ? '+' : '') + n;
    if (!c.ok) { el.textContent = `Can't fire: ${c.why}.`; return; }
    if (V.mode === 'rapid' || V.mode === 'burst') {
      const atkDis = SR.rollMode({ adv: c.adv, dis: c.dis }, 'normal') === 'dis';
      el.textContent = `${c.feet} ft, in its ${c.arc} arc · ${V.mode} (${SR.shotCost(w, V.mode)} shots): ${V.mode === 'burst' ? 'every ship in a 150-ft cube makes' : 'a'} Dexterity save DC ${8 + SR.attackBonusOf(ship, w, pb)}, damage ${SR.damageExpr(ship, w, V.mode === 'rapid') || '—'}, none on a success${atkDis ? ' · they save with advantage' : ''}`;
      return;
    }
    const how = c.kind === 'attack' ? `attack ${sign(SR.attackBonusOf(ship, w, pb))}, damage ${SR.damageExpr(ship, w, false) || '—'}` : `Dexterity save DC ${SR.saveDcOf(ship, w, pb)}, damage ${SR.damageExpr(ship, w, false) || '—'}`;
    const mods = [...c.adv.map((x) => '+' + x), ...c.dis.map((x) => '−' + x)];
    el.textContent = `${c.feet} ft, in its ${c.arc} arc · ${how}${mods.length ? ` · ${c.kind === 'attack' ? 'advantage/disadvantage' : 'their save'}: ${mods.join(', ')}` : ''}`;
  }

  function draw() {
    const s = sp(), wrap = $('#spaceWrap'), cv = $('#spaceCanvas'); if (!cv || !wrap) return;
    const cols = s ? s.cols : 40, rows = s ? s.rows : 28;
    const cell = V.cell = Math.max(10, Math.min(36, Math.floor((wrap.clientWidth || 800) / cols)));
    cv.width = cols * cell; cv.height = rows * cell;
    const g = cv.getContext('2d'), css = getComputedStyle(document.body);
    const line = css.getPropertyValue('--line').trim() || '#2a3550', text = css.getPropertyValue('--text').trim() || '#e6edf7', accent = css.getPropertyValue('--amber').trim() || '#ffb74d';
    g.fillStyle = '#05070d'; g.fillRect(0, 0, cv.width, cv.height);
    // a scatter of stars that stays put (seeded by position), then the grid
    for (let i = 0; i < cols * rows / 3; i++) { const x = (i * 7919) % cv.width, y = (i * 104729) % cv.height; g.fillStyle = `rgba(255,255,255,${0.15 + (i % 7) / 14})`; g.fillRect(x, y, 1, 1); }
    g.strokeStyle = line; g.globalAlpha = 0.35; g.lineWidth = 1; g.beginPath();
    for (let x = 0; x <= cols; x++) { g.moveTo(x * cell + 0.5, 0); g.lineTo(x * cell + 0.5, rows * cell); }
    for (let y = 0; y <= rows; y++) { g.moveTo(0, y * cell + 0.5); g.lineTo(cols * cell, y * cell + 0.5); }
    g.stroke(); g.globalAlpha = 1;
    if (!s) return;
    for (const t of s.tok) {
      const n = sizeOfTok(t), px = t.x * cell, py = t.y * cell, w = n * cell, cx = px + w / 2, cy = py + w / 2;
      const sel = t.id === V.sel, cur = t.id === s.turnId;
      if (sel) {   // its four firing arcs: the lines between forward, starboard, aft and port
        g.save(); g.translate(cx, cy); g.rotate(t.f * Math.PI / 4); g.strokeStyle = accent; g.globalAlpha = 0.35; g.setLineDash([4, 4]);
        const r = Math.max(cv.width, cv.height);
        for (const k of [1, 3, 5, 7]) { const a = k * Math.PI / 4 - Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); }
        g.restore();
      }
      g.save(); g.translate(cx, cy); g.rotate(t.f * Math.PI / 4);
      g.globalAlpha = t.hidden ? 0.45 : 1;
      g.fillStyle = t.color || '#90a4ae'; g.strokeStyle = cur ? accent : sel ? text : 'rgba(0,0,0,.6)'; g.lineWidth = cur || sel ? 3 : 1.5;
      const r = w / 2 - 2;   // a ship: a pointed hull facing up before the rotation
      g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.8, r * 0.75); g.lineTo(0, r * 0.4); g.lineTo(-r * 0.8, r * 0.75); g.closePath(); g.fill(); g.stroke();
      g.restore();
      g.fillStyle = text; g.font = `${Math.max(10, Math.min(13, cell * 0.5))}px sans-serif`; g.textAlign = 'center';
      g.fillText(t.name + (t.hidden ? ' (hidden)' : ''), cx, py + w + 12);
    }
  }

  function at(e) {
    const cv = $('#spaceCanvas'), r = cv.getBoundingClientRect();
    const sx = cv.width / r.width, sy = cv.height / r.height;
    return { x: Math.floor((e.clientX - r.left) * sx / V.cell), y: Math.floor((e.clientY - r.top) * sy / V.cell) };
  }
  document.addEventListener('click', async (e) => {
    const el = $('#space'); if (!el || !el.contains(e.target)) return;
    const s = sp();
    if (e.target.id === 'spaceCanvas') {
      if (!s) return;
      const q = at(e);
      const hit = s.tok.slice().reverse().find((t) => { const n = sizeOfTok(t); return q.x >= t.x && q.x < t.x + n && q.y >= t.y && q.y < t.y + n; });
      if (hit) { V.sel = hit.id; return render(); }
      const t = tokById(V.sel);
      if (t && mayMove(t)) { const n = sizeOfTok(t); await H.act('space.place', { id: t.id, x: q.x - Math.floor((n - 1) / 2), y: q.y - Math.floor((n - 1) / 2), f: t.f }); }
      return;
    }
    const pick = e.target.closest('[data-spsel]'); if (pick) { V.sel = pick.dataset.spsel; return render(); }
    const b = e.target.closest('[data-spx]'); if (!b) return;
    const a = b.dataset.spx, t = tokById(V.sel);
    if (a === 'on' || a === 'off') return H.act('space.on', { on: a === 'on' });
    if (a === 'add') {
      const id = ($('#spAdd') || {}).value; if (!id) return;
      const ship = shipById(id), n = SR.SQUARES[(ship || {}).size] || 1, cols = s ? s.cols : 40, rows = s ? s.rows : 28;
      const r = await H.act('space.place', { id, x: Math.floor((cols - n) / 2), y: Math.floor((rows - n) / 2), f: 0 });
      if (r) V.sel = id;
      return;
    }
    if (a === 'init') return H.act('space.init', {});
    if (a === 'next' || a === 'prev') return H.act('space.' + a, {});
    if (a === 'end') { if (confirm('End ship combat?')) H.act('space.end', {}); return; }
    if (!t) return;
    if (a === 'turn') return H.act('space.place', { id: t.id, x: t.x, y: t.y, f: (t.f + (+b.dataset.d) + 8) % 8 });
    if (a === 'fire') return H.act('space.fire', { id: t.id, target: V.target, weapon: V.weapon, crew: V.crew, fireMode: V.mode, mode: H.rollModeFromEvent(e) });
    if (a === 'cool' || a === 'reload') return H.act('ship.' + a, { id: t.id, weapon: V.weapon });
    if (a === 'helm') return H.act('ship.helm', { id: t.id, what: b.dataset.what });
    if (a === 'ram' || a === 'interfere' || a === 'dogfight' || a === 'run') return H.act('space.' + a, { id: t.id, target: V.target, crew: V.crew });
    if (a === 'harass') return H.act('space.harass', { id: t.id, target: V.target, weapon: V.weapon, crew: V.crew });
    if (a === 'conceal') return H.act('space.conceal', { id: t.id, crew: V.crew });
    if (a === 'direct') return H.act('ship.direct', { id: t.id });
    if (a === 'remove') { if (confirm(`Take ${t.name} off the space map?`)) { await H.act('space.remove', { id: t.id }); V.sel = null; } return; }
    if (a === 'sheet') { H.setTab('ships'); const sel = document.querySelector(`#ships [data-sa="sel"][data-id="${t.id}"]`); if (sel) sel.click(); return; }
  });
  document.addEventListener('change', (e) => {
    const el = $('#space'); if (!el || !el.contains(e.target)) return;
    if (e.target.id === 'spWeapon') { V.weapon = +e.target.value || 0; e.target.blur(); return render(); }
    if (e.target.id === 'spMode') { V.mode = e.target.value; return preview(); }
    if (e.target.id === 'spTarget') { V.target = e.target.value; return preview(); }
    if (e.target.id === 'spCrew') { V.crew = +e.target.value || 0; return preview(); }
    const t = tokById(V.sel), k = e.target.dataset.spt;
    if (k && t) return H.act('space.token', { id: t.id, [k]: e.target.checked });
    if (e.target.id === 'spCols' || e.target.id === 'spRows') return H.act('space.size', { cols: +($('#spCols') || {}).value, rows: +($('#spRows') || {}).value });
  });
  window.addEventListener('resize', () => { if (H.S.tab === 'space') draw(); });
  document.addEventListener('click', (e) => { const b = e.target.closest('#tabs [data-tab="space"]'); if (b) requestAnimationFrame(draw); });

  window.HTSpace = { render, draw };
  if (H.S.st) render();
})();
