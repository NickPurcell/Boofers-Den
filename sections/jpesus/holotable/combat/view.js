/* HoloTable combat view (experimental branch): the fight on the map, by clicking.
   On your turn the squares you can still reach are lit and a click moves you there; the bar under the map lists your
   attacks (greyed when the action is spent or nothing is in reach); pick one, hover a target to see what you need to
   roll, click it to attack; End turn passes it on. Everyone watches it happen. The GM plays the creatures the same way,
   can undo the last step, and switches the whole view on and off.
   Everything here is a preview: the server decides every action (api/_holotable-fight.js), with the same engine. */
(() => {
  const H = window.HT, E = window.HTCombatEngine;
  if (!H || !E) return;
  const { $, esc, act, toast } = H;
  const R = H.R;
  const UI = { armed: null, target: null, adv: false, dis: false, seen: -1, floats: [], npc: {}, npcAsked: {}, cache: null, busy: false };
  const st = () => H.S.st;
  const F = () => (st() && st().fight) || { on: false };
  const gm = () => !!(st() && st().isGM);
  const sgn = (n) => (n >= 0 ? '+' : '') + n;

  /* ---------------- the world, as the server will see it ---------------- */
  function world() {
    const s = st(), f = F();
    if (UI.cache && UI.cache.st === s) return UI.cache.w;
    const w = E.buildWorld({
      characters: s.characters, entries: s.initiative.entries, active: f.active, turnId: f.turn, round: f.round, tokens: s.map.tokens,
      unitTokens: Object.fromEntries(Object.entries(f.units || {}).map(([id, u]) => [id, u.token])), npcSpeed: f.npcSpeed,
      spent: f.spent,
    }, R);
    for (const [id, u] of Object.entries(f.units || {})) if (w.units[id] && u.down) w.units[id].down = true;
    UI.cache = { st: s, w, reach: null };
    return w;
  }
  const cur = () => { const w = world(); return w.turnId ? w.units[w.turnId] : null; };
  const myTurn = () => { const f = F(), u = cur(); return !!(f.on && u && (gm() ? true : (f.units[u.id] || {}).mine)); };
  const entry = (id) => st().initiative.entries.find((e) => e.id === id);
  const unitAt = (gx, gy) => {
    const w = world();
    return Object.values(w.units).find((u) => gx >= u.x && gx < u.x + (u.size || 1) && gy >= u.y && gy < u.y + (u.size || 1)) || null;
  };
  function reach() {
    const w = world(), u = cur();
    if (!u || !myTurn()) return {};
    if (!UI.cache.reach) UI.cache.reach = E.reachable(w, u.id, E.budget(w).moveLeft);
    return UI.cache.reach;
  }

  /* ---------------- attacks: the sheet's, or the creature's stat block (GM) ---------------- */
  function attacks() {
    const u = cur();
    if (!u) return [];
    if (u.charId) { const ch = st().characters[u.charId]; return ch ? E.attacksOf(ch, R) : []; }
    if (!gm()) return [];
    const known = UI.npc[u.id];
    if (!known) loadCreature(u.id);
    return ((known && known.attacks) || []).concat(UI.custom && UI.custom.unit === u.id ? [UI.custom.spec] : []);
  }
  // the GM's own browser has the creature list (books.js); speed goes to the server once, attacks travel with each attack
  function loadCreature(id) {
    const e = entry(id);
    if (!e || !e.sb || !window.HTB || UI.npc[id]) { if (e && !UI.npc[id]) UI.npc[id] = { attacks: [] }; return; }
    UI.npc[id] = { attacks: [], loading: true };
    window.HTB.list('monsters').then((list) => {
      const m = (list || []).find((x) => x.n === e.sb);
      const atks = m ? m.b.filter((b) => b.k === 'action').map(E.attackFromBehavior).filter(Boolean).map((a, i) => Object.assign(a, { key: 'sb' + i })) : [];
      UI.npc[id] = { attacks: atks };
      const sp = m && /(\d+)\s*f/.exec(m.speed || '');
      if (sp && F().npcSpeed[id] == null && !UI.npcAsked[id]) { UI.npcAsked[id] = true; act('fight.npc', { id, speed: +sp[1] }); }
      render(); H.drawMap();
    }).catch(() => { UI.npc[id] = { attacks: [] }; render(); });
  }
  function customAttack() {
    const u = cur();
    H.modal(`<h3>Custom attack</h3>
      <p class="muted">For ${esc(u.name)}: an attack that isn't in its stat block.</p>
      <label>Name <input id="ctcName" value="Attack" maxlength="60"></label>
      <label>Attack bonus <input id="ctcBonus" type="number" value="4"></label>
      <label>Damage <input id="ctcDmg" value="1d6+2" maxlength="40"></label>
      <label>Reach (ft) <input id="ctcReach" type="number" value="5" min="0" step="5"></label>
      <label>Range (ft, normal/long, blank if melee) <input id="ctcRange" placeholder="80/320"></label>
      <div class="row"><span class="spacer"></span><button class="btn" id="ctcCancel">Cancel</button><button class="btn primary" id="ctcOk">Use it</button></div>`, (box) => {
      $('#ctcCancel', box).onclick = H.closeModal;
      $('#ctcOk', box).onclick = () => {
        const rg = /^(\d+)\s*\/\s*(\d+)$/.exec($('#ctcRange', box).value.trim());
        const damage = $('#ctcDmg', box).value.replace(/\s+/g, '');
        UI.custom = { unit: u.id, spec: { key: 'custom', name: $('#ctcName', box).value || 'Attack', bonus: +$('#ctcBonus', box).value || 0, damage,
          crit: damage.replace(/(\d*)d(\d+)/gi, (_, n, s) => (2 * (+n || 1)) + 'd' + s), type: '', melee: rg ? 0 : +$('#ctcReach', box).value || 5, range: rg ? [+rg[1], +rg[2]] : null } };
        UI.armed = 'custom';
        H.closeModal(); render(); H.drawMap();
      };
    });
  }
  const armedSpec = () => attacks().find((a) => a.key === UI.armed) || null;
  const targets = (spec) => {
    const w = world(), u = cur();
    if (!u || !spec) return [];
    return Object.values(w.units).filter((t) => t.id !== u.id && t.side !== u.side && !t.down && E.preview(w, u.id, t.id, spec).legal);
  };

  /* ---------------- talking to the server ---------------- */
  async function send(type, payload) {
    if (UI.busy) return null;
    UI.busy = true;
    try { return await act(type, payload); } finally { UI.busy = false; }
  }
  async function attack(targetId) {
    const spec = armedSpec(), u = cur();
    if (!spec || !u) return;
    const payload = { target: targetId, adv: UI.adv, dis: UI.dis, attack: u.charId ? spec.key : { name: spec.name, bonus: spec.bonus, damage: spec.damage, type: spec.type, melee: spec.melee, range: spec.range } };
    const r = await send('fight.attack', payload);
    if (r) { UI.armed = null; UI.target = null; UI.adv = UI.dis = false; render(); }
  }

  /* ---------------- the bar under the map ---------------- */
  let bar = null;
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'ct-bar';
    bar.id = 'ctBar';
    $('#pane-map').appendChild(bar);
    bar.addEventListener('click', onBar);
    return bar;
  }
  function render() {
    const s = st();
    if (!s) return;
    const f = F(), b = ensureBar();
    // floating numbers for what just happened (not replayed when the page first loads)
    const evs = f.events || [];
    const top = evs.reduce((m, ev) => Math.max(m, ev.seq), 0);
    if (UI.seen < 0) UI.seen = top;
    for (const ev of evs) if (ev.seq > UI.seen && ev.kind !== 'move') UI.floats.push({ token: ev.token, kind: ev.kind, amount: ev.amount, t0: performance.now() });
    UI.seen = Math.max(UI.seen, top);
    if (UI.floats.length) animate();
    if (!f.on) {
      b.hidden = !gm();
      b.innerHTML = gm() ? `<div class="ct-row"><span class="ct-turn muted">Combat view is off: the table works as usual.</span><span class="spacer"></span>
        <button class="btn small" data-ct="on">⚔ Turn on the combat view</button></div>` : '';
      return;
    }
    b.hidden = false;
    const u = cur(), mine = myTurn(), bud = f.budget, w = world();
    const who = !f.active ? 'Combat hasn\'t started' : u ? `${esc(u.name)}'s turn` : f.turn ? 'A combatant not on the map' : 'Someone you can\'t see is acting';
    const chip = (on, label, title) => `<span class="ct-chip ${on ? '' : 'spent'}" title="${esc(title)}">${on ? '' : '<span aria-hidden="true">✕ </span>'}${esc(label)}${on ? '' : ' (used)'}</span>`;
    let html = `<div class="ct-row"><span class="ct-turn">${f.active ? `Round ${+f.round || 1} · ` : ''}${who}${mine && !gm() ? ' <span class="ct-you">your turn</span>' : ''}</span>`;
    if (bud) html += `<span class="ct-chips">${chip(bud.moveLeft > 0, `Move ${bud.moveLeft}/${bud.speed} ft`, 'Movement left this turn')}${chip(bud.action, 'Action', 'One action a turn')}${chip(bud.bonus, 'Bonus action', 'One bonus action a turn')}${chip(bud.reaction, 'Reaction', 'One reaction between your turns')}</span>`;
    html += '<span class="spacer"></span>';
    if (mine && u && f.active) html += '<button class="btn small amber" data-ct="end">End turn ⏭</button>';
    if (gm()) html += `<button class="btn small ghost" data-ct="undo" ${f.undo && f.undo.n ? '' : 'disabled'} title="${esc(f.undo && f.undo.last ? 'Undo: ' + f.undo.last : 'Nothing to undo')}">↶ Undo</button><button class="btn small ghost" data-ct="off" title="Turn the combat view off for everyone">Combat view off</button>`;
    html += '</div>';
    // the current character's resources (its owner and the GM): use one, or add one
    if (f.active && u && u.charId && (mine || gm())) {
      const pools = Object.values(u.pools || {}).filter((r) => r.key !== 'hitdice');
      html += `<div class="ct-row ct-pools">${pools.map((r) => `<button class="ct-chip ct-pool ${r.used >= r.max ? 'spent' : ''}" data-ct="pool" data-key="${esc(r.key)}" title="${esc(r.name)}: ${r.max - r.used} of ${r.max} left${r.refill === 'short' ? ', back on a short or long rest' : r.refill === 'long' ? ', back on a long rest' : ''}">${esc(r.name)} ${r.max - r.used}/${r.max}${r.die ? ' ' + esc(r.die) : ''}</button>`).join('')}
        <button class="btn tiny ghost" data-ct="addres" title="Add a resource with a maximum (uses, or a pool of dice)">＋ Resource</button></div>`;
    }
    if (!f.active) html += `<div class="ct-row muted">${gm() ? 'Start initiative in the Combat tab to begin.' : 'Waiting for the GM to start initiative.'}</div>`;
    else if (mine && u) {
      const atks = attacks();
      const spent = bud && !bud.action;
      html += '<div class="ct-row ct-actions" role="group" aria-label="Attacks">';
      for (const a of atks) {
        const n = targets(a).length;
        const off = spent || !n;
        html += `<button class="btn small ct-atk ${UI.armed === a.key ? 'primary' : ''}" data-ct="arm" data-key="${esc(a.key)}" ${off ? 'disabled' : ''} aria-pressed="${UI.armed === a.key}"
          title="${esc(spent ? 'Your action is used this turn' : !n ? 'Nothing in reach or range' : 'Pick a target on the map')}">${esc(a.name)} <b>${sgn(a.bonus)}</b> <span class="muted">${esc(a.damage)}${a.type ? ' ' + esc(a.type) : ''} · ${a.range ? `${a.range[0]}/${a.range[1]} ft` : `${a.melee} ft`}</span></button>`;
      }
      if (!atks.length) html += `<span class="muted">${u.charId ? 'No weapon attacks on this sheet.' : UI.npc[u.id] && UI.npc[u.id].loading ? 'Reading the stat block…' : 'No attacks found in the stat block.'}</span>`;
      if (gm() && !u.charId) html += '<button class="btn small ghost" data-ct="custom">＋ Custom attack</button>';
      html += `<label class="ct-tog"><input type="checkbox" data-ct="adv" ${UI.adv ? 'checked' : ''}> Advantage</label><label class="ct-tog"><input type="checkbox" data-ct="dis" ${UI.dis ? 'checked' : ''}> Disadvantage</label></div>`;
      const spec = armedSpec();
      if (spec) {
        const t = UI.target && w.units[UI.target];
        const pv = t && E.preview(w, u.id, t.id, spec, { adv: UI.adv, dis: UI.dis });
        html += `<div class="ct-row ct-preview" aria-live="polite">${!t ? `<span>${esc(spec.name)}: pick a target on the map (lit in red).</span><button class="btn tiny ghost" data-ct="disarm">Cancel</button>`
          : !pv.legal ? `<span>${esc(pv.why)}</span>`
          : `<span><b>${esc(t.name)}</b>, ${pv.feet} ft: you need <b>${pv.need}+</b> on the d20 (${Math.round(pv.chance * 100)}%)${pv.mode !== 'normal' ? ` · ${pv.mode === 'adv' ? 'advantage' : 'disadvantage'}: ${esc(pv.tilts.map((x) => x.text).join(', '))}` : ''}. Hit: ${esc(spec.damage)}${spec.type ? ' ' + esc(spec.type) : ''}.</span>
             <button class="btn small primary" data-ct="go">Attack</button>`}</div>`;
      } else if (bud && bud.moveLeft > 0) html += `<div class="ct-row muted ct-hint">Tap a lit square to move there, or pick an attack.</div>`;
    }
    b.innerHTML = html;
  }
  function onBar(e) {
    const el = e.target.closest('[data-ct]');
    if (!el) return;
    const k = el.dataset.ct;
    if (k === 'on' || k === 'off') return send('fight.toggle', { on: k === 'on' });
    if (k === 'undo') return send('fight.undo', {});
    if (k === 'end') { UI.armed = UI.target = null; return send('fight.end', {}); }
    if (k === 'custom') return customAttack();
    if (k === 'pool') return poolModal(el.dataset.key);
    if (k === 'addres') return resourceModal();
    if (k === 'arm') { UI.armed = UI.armed === el.dataset.key ? null : el.dataset.key; UI.target = null; render(); return H.drawMap(); }
    if (k === 'disarm') { UI.armed = UI.target = null; render(); return H.drawMap(); }
    if (k === 'adv' || k === 'dis') { UI[k] = el.checked; return render(); }
    if (k === 'go' && UI.target) return attack(UI.target);
  }

  /* ---------------- resources (audit 3.1) ---------------- */
  function poolModal(key) {
    const u = cur(), r = u && u.pools[key];
    if (!r) return;
    const own = r.from === 'sheet';
    H.modal(`<h3>${esc(r.name)}</h3>
      <p>${r.max - r.used} of ${r.max} left${r.die ? ` (${esc(r.die)})` : ''}. ${r.refill === 'short' ? 'Comes back on a short or a long rest.' : r.refill === 'long' ? 'Comes back on a long rest.' : r.refill === 'turn' ? 'Comes back at the start of each turn.' : 'Refilled by hand.'}</p>
      <div class="row"><button class="btn primary" id="ctpUse" ${r.used >= r.max ? 'disabled' : ''}>Use one</button>
        ${own ? '<button class="btn danger" id="ctpDel">Remove it</button>' : ''}<span class="spacer"></span><button class="btn" id="ctpClose">Close</button></div>`, (box) => {
      $('#ctpClose', box).onclick = H.closeModal;
      $('#ctpUse', box).onclick = async () => { H.closeModal(); await send('fight.spend', { charId: u.charId, key }); };
      if (own) $('#ctpDel', box).onclick = async () => { if (!confirm(`Remove ${r.name} from ${u.name}?`)) return; H.closeModal(); await send('fight.resource', { charId: u.charId, op: 'remove', key }); };
    });
  }
  function resourceModal() {
    const u = cur();
    if (!u || !u.charId) return;
    H.modal(`<h3>New resource for ${esc(u.name)}</h3>
      <p class="muted">Anything with a maximum that gets used up: uses of a feature, or a pool of dice.</p>
      <label>Name <input id="ctrName" maxlength="60" placeholder="Second Wind"></label>
      <label>Maximum <input id="ctrMax" type="number" min="1" max="999" value="1"></label>
      <label>Die (for a pool of dice) <select id="ctrDie"><option value="">none</option>${['d4', 'd6', 'd8', 'd10', 'd12'].map((d) => `<option>${d}</option>`).join('')}</select></label>
      <label>Comes back <select id="ctrRefill"><option value="short">on a short or long rest</option><option value="long">on a long rest</option><option value="turn">every turn</option><option value="manual">by hand</option></select></label>
      <div class="row"><span class="spacer"></span><button class="btn" id="ctrCancel">Cancel</button><button class="btn primary" id="ctrOk">Add it</button></div>`, (box) => {
      $('#ctrCancel', box).onclick = H.closeModal;
      $('#ctrOk', box).onclick = async () => {
        const name = $('#ctrName', box).value.trim();
        if (!name) return toast('Give it a name.', true);
        const res = { key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30), name, max: +$('#ctrMax', box).value || 1, used: 0,
          die: $('#ctrDie', box).value || undefined, refill: $('#ctrRefill', box).value };
        H.closeModal();
        await send('fight.resource', { charId: u.charId, res });
      };
    });
  }

  /* ---------------- on the map (app.js calls these) ---------------- */
  // pointer down: claims the click only when it's an attack on a target, or a player's own token on their turn
  function down(gx, gy, e) {
    if (!F().on || !myTurn()) return false;
    const t = unitAt(gx, gy), u = cur();
    if (UI.armed && t && t.id !== u.id) {
      const legal = targets(armedSpec()).some((x) => x.id === t.id);
      if (!legal) { UI.target = t.id; render(); return true; }
      if (e.pointerType === 'mouse' && UI.target === t.id) { attack(t.id); return true; }
      UI.target = t.id; render(); H.drawMap();
      if (e.pointerType === 'mouse') attack(t.id);
      return true;
    }
    if (t && t.id === u.id && !gm()) { UI.armed = UI.target = null; render(); return true; }
    return false;
  }
  // a tap on empty map (no pan): move there if it's lit
  function tap(gx, gy) {
    if (!F().on || !myTurn()) return false;
    const x = Math.floor(gx), y = Math.floor(gy);
    if (UI.armed) { UI.armed = UI.target = null; render(); H.drawMap(); return true; }
    if (reach()[`${x},${y}`] === undefined) return false;
    send('fight.move', { x, y });
    return true;
  }
  function hover(gx, gy) {
    if (!UI.armed || !F().on || !myTurn()) return;
    const t = unitAt(gx, gy), id = t && t.id !== (cur() || {}).id ? t.id : null;
    if (id !== UI.target && (id || UI.target)) { UI.target = id; render(); H.drawMap(); }
  }
  function cssVar(name, fallback) { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback; }
  const alpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  // under the tokens: the squares you can reach
  function under(ctx, g, z) {
    if (!F().on || !myTurn()) return;
    const holo = cssVar('--holo', '#4fc3f7'), dim = UI.armed ? 0.45 : 1;   // fainter while an attack is picked
    ctx.save();
    ctx.fillStyle = alpha(holo, 0.16 * dim); ctx.strokeStyle = alpha(holo, 0.55 * dim); ctx.lineWidth = 1 / z;
    for (const k of Object.keys(reach())) {
      const [x, y] = k.split(',').map(Number);
      ctx.fillRect(x * g + 2, y * g + 2, g - 4, g - 4); ctx.strokeRect(x * g + 2, y * g + 2, g - 4, g - 4);
    }
    ctx.restore();
  }
  // over the tokens: who you can hit, the target you're pointing at, and what just happened
  function over(ctx, g, z) {
    const f = F();
    if (!f.on) return;
    const w = world();
    const ring = (u, color, width, dash) => {
      const s = (u.size || 1) * g, cx = u.x * g + s / 2, cy = u.y * g + s / 2;
      ctx.beginPath(); ctx.arc(cx, cy, s / 2 + 2, 0, Math.PI * 2);
      ctx.setLineDash(dash ? [6 / z, 4 / z] : []); ctx.lineWidth = width / Math.min(1, z); ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]);
    };
    ctx.save();
    if (myTurn() && UI.armed) {
      const red = cssVar('--red', '#ef5350');
      for (const t of targets(armedSpec())) ring(t, alpha(red, 0.9), 2, t.id !== UI.target);
      const t = UI.target && w.units[UI.target];
      if (t) ring(t, '#ffffff', 3, false);
    }
    // floating results over tokens, for 1.6 s
    const tnow = performance.now();
    UI.floats = UI.floats.filter((fl) => tnow - fl.t0 < 1600);
    for (const fl of UI.floats) {
      const tok = st().map.tokens.find((t) => t.id === fl.token);
      if (!tok) continue;
      const p = (tnow - fl.t0) / 1600, s = (tok.size || 1) * g;
      const text = fl.kind === 'miss' ? 'Miss' : fl.kind === 'crit' ? `Critical −${fl.amount}` : `−${fl.amount}`;
      ctx.globalAlpha = 1 - p * p;
      ctx.font = `700 ${Math.max(14 / z, g * 0.32)}px "Exo 2", "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4 / z; ctx.strokeStyle = 'rgba(0,0,0,.85)';
      const x = tok.x * g + s / 2, y = tok.y * g - p * g * 0.6;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fl.kind === 'miss' ? '#e0e0e0' : fl.kind === 'crit' ? cssVar('--amber', '#ffb74d') : '#ff6e6e';
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }
  let raf = 0;
  function animate() {
    if (raf) return;
    const step = () => { H.drawMap(); raf = UI.floats.length ? requestAnimationFrame(step) : 0; };
    raf = requestAnimationFrame(step);
  }

  window.HTC = { render, down, tap, hover, under, over };
  if (st()) render();
})();
