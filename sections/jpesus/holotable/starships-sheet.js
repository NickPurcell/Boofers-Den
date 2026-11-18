/* HoloTable starships: the "In a fight" box on the ship sheet, and what a ship's conditions do to its rolls.
   The rules are in starships.js (HTShips); every change goes to the server as a ship.* action, which rolls the dice
   and decides. books.js draws the rest of the ship sheet and calls block() and rollOpts() from here. */
(function () {
  const H = window.HT, SR = window.HTShips;
  if (!H || !SR) return;
  const { $, esc } = H;
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  // the box: the ship's state at 0 hull, damage by type, repairs, conditions and what they do right now
  // power dice, shield dice and the Boost actions; ctx: { pb, as }, the crew row the sheet is rolling as and its proficiency bonus
  const ctxOf = {};   // per ship, the crew row the sheet is rolling as (the server works the bonus out from it)
  function powerBlock(s, ro, ctx) {
    ctxOf[s.id] = ctx || {};
    const st = SR.statusOf(s), caps = SR.powerCaps(s), dis = ro || SR.isDisabled(st) || SR.isLost(st);
    const auto = (field, fn, table) => { const v = s[field] || '', a = fn(Object.assign({}, s, { [field]: '' }));
      return `<select data-sp="${field}" ${ro ? 'disabled' : ''}><option value="" ${v ? '' : 'selected'}>${a ? `${esc(a)} (role or equipment)` : '(none)'}</option>${Object.keys(table).map(k => `<option ${k === v ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select>`; };
    const pools = ['central', ...SR.SYSTEMS].filter(k => caps[k] > 0).map(k => {
      const n = st.power[k] || 0, pips = Array.from({ length: caps[k] }, (_, i) => `<span class="dpip ${i < n ? 'on' : ''}"></span>`).join('');
      return `<span class="ship-pool"><b>${SR.SYSTEM_NAMES[k]}</b> ${pips}${ro ? '' : ` <button class="btn tiny amber" data-sx="puse" data-pool="${k}" ${n ? '' : 'disabled'} title="Spend a power die (${SR.powerDieText(s)})">use</button><button class="btn tiny ghost" data-sx="pset" data-pool="${k}" data-n="${n + 1}" ${n < caps[k] ? '' : 'disabled'}>+</button><button class="btn tiny ghost" data-sx="pset" data-pool="${k}" data-n="${n - 1}" ${n ? '' : 'disabled'}>−</button>`}</span>`;
    }).join('');
    const sd = SR.diceOf(s, 'shield'), sdLeft = SR.diceLeft(s, 'shield'), used = st.sdUsed, rate = SR.regenRate(s);
    const str = Math.floor(((+(s.abilities || {}).str || 10) - 10) / 2), boostBonus = str + (+((s.skills || {}).boost) || 0) * ((ctx && ctx.pb) || 0);
    const b = st.boost, done = [b.engines > 0 && 'engines +50 ft', b.shields && 'shields boosted', b.weapons && 'weapons boosted (next damage roll with advantage)', b.regen && 'shields regenerated'].filter(Boolean);
    const sign = n => (n >= 0 ? '+' : '') + n;
    return `<div class="ship-power">
      <div class="row wrap" style="gap:6px">${ro ? '' : `<button class="btn small primary" data-sx="turn" title="At the start of the ship's turn: the reactor's power dice come back, shields regenerate if ticked, this turn's boosts end, and a ship at 0 hull makes its destruction save">▶ Start of the ship's turn</button>
        <label class="toggle" title="Spend a shield die, without rolling, for the regeneration rate. Not when the shields are down."><input type="checkbox" id="shipRegen" checked> regenerate shields</label>`}
        <span class="spacer"></span><label class="ship-lv">Reactor ${auto('reactor', SR.reactorOf, SR.REACTORS)}</label><label class="ship-lv">Coupling ${auto('coupling', SR.couplingOf, SR.COUPLINGS)}</label><label class="ship-lv">Shields ${auto('shieldType', SR.shieldTypeOf, SR.SHIELD_TYPES)}</label></div>
      <div class="row wrap" style="gap:10px;margin-top:6px"><span class="muted" style="font-size:12px">Power dice (${SR.powerDieText(s)})</span>${pools || '<span class="muted" style="font-size:12px">Pick a power coupling to store power dice.</span>'}</div>
      <div class="row wrap" style="gap:8px;margin-top:6px;font-size:12px"><span>Shield dice <b>${sdLeft}</b> of ${sd.n} left (d${sd.die})${ro ? '' : ` <button class="btn tiny ghost" data-sx="sdset" data-n="${used + 1}" ${sdLeft ? '' : 'disabled'} title="Spend one">−</button><button class="btn tiny ghost" data-sx="sdset" data-n="${used - 1}" ${used ? '' : 'disabled'} title="Get one back">+</button>`}</span>
        <span>Regeneration <b>${rate}</b> a round</span>${st.tempShield ? `<span>Temporary shields <b>${st.tempShield}</b></span>` : ''}</div>
      ${dis ? '' : `<div class="row wrap" style="gap:6px;margin-top:6px"><span class="muted" style="font-size:12px" title="Strength (Boost): the ship's Strength plus the crew member's proficiency if the ship is proficiently equipped in Boost">Boost ${sign(boostBonus)} vs DC ${SR.boostDC(s)}</span>
        ${['engines', 'shields', 'weapons'].map(w => `<button class="btn tiny" data-sx="boost" data-what="${w}" ${(w === 'engines' ? b.engines >= 2 : b[w]) ? 'disabled' : ''}>Boost ${w}</button>`).join('')}
        <button class="btn tiny" data-sx="regen" ${b.regen || !sdLeft ? 'disabled' : ''} title="The action: spend a shield die and roll it (twice, keeping the lower, on a failed check). Works when the shields are down.">Regenerate shields (DC ${SR.regenDC(s)})</button>
        ${done.length ? `<span class="muted" style="font-size:12px">This turn: ${esc(done.join(', '))}</span>` : ''}</div>`}
    </div>`;
  }

  function block(s, ro, ctx) {
    const st = SR.statusOf(s), gm = H.isGM(), z = st.zero, hullNow = +((s.hull || {}).current) || 0;
    const lost = SR.isLost(st), dying = SR.dying(s), atZero = hullNow <= 0 && SR.hullMax(s) > 0;
    let state = '';
    if (z.destroyed) state = `<div class="ship-state lost">💥 Destroyed${gm ? ' <button class="btn tiny ghost" data-sx="reset" title="Undo the destruction (a mistake, or the story says it survived)">undo</button>' : ''}</div>`;
    else if (st.system >= 6) state = `<div class="ship-state lost">All primary systems failed (system damage 6)${gm ? ' <button class="btn tiny ghost" data-sx="reset" data-system="5" title="Back to system damage 5">undo</button>' : ''}</div>`;
    else if (atZero) {
      const pips = [0, 1, 2].map(i => `<span class="dpip ${i < z.s ? 'on' : ''}"></span>`).join('');
      state = `<div class="ship-state">At 0 hull points · ${z.stable ? '<b>stable</b>' : `destruction saves ${pips} <span class="muted">${plural(z.f, 'failure')} so far</span>`}
        ${dying && !ro ? `<button class="btn small amber" data-sx="dsave" title="d20: 10 or more is a success, three make it stable. A failure is a level of system damage; a 1 counts twice; a 20 brings back 1 hull point.">Destruction save</button>
        <button class="btn small ghost" data-sx="stabilize" title="After a crew member's successful DC 10 Intelligence (mechanic's kit) check">Stabilized</button>` : ''}</div>`;
    }
    const types = SR.DAMAGE_TYPES.map(t => `<option value="${t}">${cap(t)}</option>`).join('');
    const chips = SR.CONDITIONS.map(c => { const on = st.cond.includes(c), auto = c === 'Used' && st.system >= 5;
      return `<button class="btn tiny ${on ? 'primary' : 'ghost'}" data-sx="cond" data-c="${c}" ${ro || auto ? 'disabled' : ''} title="${esc(SR.CONDITION_NOTES[c] + (auto ? ' (from system damage 5; it stays)' : ''))}">${c}</button>`; }).join('');
    const lvSel = (k, n, notes) => `<select data-sxc="${k}" ${ro ? 'disabled' : ''}>${Array.from({ length: n + 1 }, (_, i) => `<option value="${i}" ${st[k] === i ? 'selected' : ''} title="${esc(notes(i))}">${i}</option>`).join('')}</select>`;
    const sysTitle = i => (i ? SR.SYSTEM_NOTES.slice(1, i + 1).join('; ') : 'None');
    const fx = effects(s);
    return `<div class="box ship-fight" style="margin-top:12px"><h4>In a fight</h4>
      ${fx.length ? `<p class="muted" style="font-size:12px;margin:0 0 6px">${esc(fx.join(' · '))}</p>` : ''}
      ${state}
      ${!ro && !lost ? `<div class="row wrap ship-dmg"><input id="shipAmt" type="number" min="0" placeholder="12" style="width:80px" title="How many points">
        <select id="shipDmgType" title="Damage type: shields take half of acid, cold, fire and necrotic; the hull takes half of ion, lightning and necrotic; neither takes poison or psychic; sonic does nothing in space">${types}</select>
        <label class="toggle" title="A critical hit: at 0 hull points it does two levels of system damage"><input type="checkbox" id="shipCrit"> critical</label>
        <label class="toggle" title="The attacker disables the ship instead of destroying it (a primary or secondary weapon, or ion or lightning damage). Ion damage always only disables."><input type="checkbox" id="shipDisable"> disable, don't destroy</label>
        <button class="btn small danger" data-sx="dmg">Damage</button><button class="btn small" data-sx="repair">Repair hull</button><button class="btn small" data-sx="shields">Restore shields</button></div>` : ''}
      <div class="row wrap" style="margin-top:8px;gap:4px">${chips}
        <span class="spacer"></span><label class="ship-lv" title="${esc('Speed -150 / -250 / -300 ft; at 4, speed 0')}">Slowed ${lvSel('slowed', 4, i => (i ? (i >= 4 ? 'Speed 0' : `Speed -${SR.SLOWED_FEET[i]} ft`) : 'None'))}</label>
        <label class="ship-lv" title="${esc(SR.SYSTEM_NOTES.slice(1).map((t, i) => `${i + 1}: ${t}`).join('\n'))}">System damage ${lvSel('system', 6, sysTitle)}</label></div>
      ${powerBlock(s, ro, ctx)}
    </div>`;
  }

  // the ship's conditions in effect, as short phrases for the box's heading
  function effects(s) {
    const st = SR.statusOf(s), out = [], sp = SR.speedOf(s), lv = SR.slowedLevel(s);
    const bs = SR.boostedSpeed(s);
    if (lv) out.push(`Speed ${bs} ft (slowed ${lv})`);
    else if (bs !== sp) out.push(`Speed ${bs} ft (engines boosted)`);
    if (st.system >= 4) out.push(`Maximums halved: hull ${SR.hullMax(s)}, shields ${SR.shieldMax(s)}; regeneration halved`);
    const fx = (k, ab) => SR.rollEffects(s, k, ab);
    const words = (f) => [f.adv.length && 'advantage', f.dis.length && 'disadvantage'].filter(Boolean).join(' and ');
    const chk = fx('check'), sav = fx('save', 'con'), atk = fx('attack'), vs = fx('against');
    if (words(chk)) out.push(`Checks: ${words(chk)}`);
    if (words(atk)) out.push(`Its attacks: ${words(atk)}`);
    if (words(sav)) out.push(`Saves: ${words(sav)}`);
    if (fx('save', 'dex').fail.length) out.push('Fails Str and Dex saves');
    if (words(vs)) out.push(`Attacks against it: ${words(vs)}`);
    if (SR.isDisabled(st)) out.push('No actions or reactions');
    else if (st.cond.includes('Shocked')) out.push('No reactions; action or bonus action');
    return out;
  }

  // a roll from the ship sheet: the mode after the ship's conditions, and the label saying why
  function rollOpts(s, el, asked) {
    const kind = el.dataset.kind, ab = el.dataset.ab;
    let label = el.dataset.label || '';
    if (!kind) return { mode: asked, label };
    const fx = SR.rollEffects(s, kind, ab), mode = SR.rollMode(fx, asked);
    const why = [...fx.adv, ...fx.dis];
    if (fx.fail.length) label += ` (fails automatically: ${fx.fail.join(', ')})`;
    else if (why.length) label += ` [${why.join(', ')}]`;
    return { mode, label };
  }

  // the box's buttons; returns true when it handled the click
  async function click(e, s) {
    const b = e.target.closest('[data-sx]'); if (!b || !s) return false;
    const a = b.dataset.sx, id = s.id;
    if (a === 'dmg' || a === 'repair' || a === 'shields') {
      const n = Math.abs(parseInt(($('#shipAmt') || {}).value, 10)); if (!n) { H.toast('How many points?', true); return true; }
      if (a === 'dmg') await H.act('ship.damage', { id, amount: n, type: ($('#shipDmgType') || {}).value, crit: !!($('#shipCrit') || {}).checked, disable: !!($('#shipDisable') || {}).checked });
      else await H.act('ship.restore', { id, what: a === 'shields' ? 'shield' : 'hull', amount: n });
      return true;
    }
    if (a === 'dsave') { await H.act('ship.dsave', { id }); return true; }
    if (a === 'turn') { await H.act('ship.turn', { id, regen: !!($('#shipRegen') || {}).checked }); return true; }
    if (a === 'puse') { await H.act('ship.poweruse', { id, pool: b.dataset.pool }); return true; }
    if (a === 'pset') { await H.act('ship.power', { id, pool: b.dataset.pool, n: +b.dataset.n }); return true; }
    if (a === 'sdset') { await H.act('ship.dice', { id, kind: 'shield', used: +b.dataset.n }); return true; }
    if (a === 'boost' || a === 'regen') { await H.act(a === 'boost' ? 'ship.boost' : 'ship.regen', { id, what: b.dataset.what, crew: (ctxOf[id] || {}).as || 0, mode: H.rollModeFromEvent(e) }); return true; }
    if (a === 'stabilize') { await H.act('ship.stabilize', { id }); return true; }
    if (a === 'cond') { const c = b.dataset.c; await H.act('ship.condition', { id, name: c, on: !SR.statusOf(s).cond.includes(c) }); return true; }
    if (a === 'reset') { if (confirm(`Undo ${s.name}'s destruction?`)) await H.act('ship.reset', Object.assign({ id }, b.dataset.system ? { system: +b.dataset.system } : {})); return true; }
    return false;
  }
  // the slowed and system damage pickers; returns true when it handled the change
  async function change(e, s) {
    const t = e.target, k = t.dataset && t.dataset.sxc; if (!k || !s) return false;
    await H.act('ship.condition', { id: s.id, name: k, level: +t.value || 0 });
    return true;
  }

  window.HTShipSheet = { block, effects, rollOpts, click, change };
  if (window.HTB && H.S.st) window.HTB.renderShipsSafe();   // the ships tab may have been drawn before this file loaded
})();
