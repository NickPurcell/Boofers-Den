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
        <span>Regeneration <b>${rate}</b> a round</span>${st.tempShield ? `<span>Temporary shields <b>${st.tempShield}</b></span>` : ''}
        <span>Hull dice <b>${SR.diceLeft(s, 'hull')}</b> of ${SR.diceOf(s, 'hull').n} left (d${SR.diceOf(s, 'hull').die})${ro ? '' : ` <button class="btn tiny ghost" data-sx="hdset" data-n="${st.hdUsed + 1}" ${SR.diceLeft(s, 'hull') ? '' : 'disabled'} title="Spend one">−</button><button class="btn tiny ghost" data-sx="hdset" data-n="${st.hdUsed - 1}" ${st.hdUsed ? '' : 'disabled'} title="Get one back">+</button>`}</span></div>
      ${dis ? '' : `<div class="row wrap" style="gap:6px;margin-top:6px"><span class="muted" style="font-size:12px" title="Strength (Boost): the ship's Strength plus the crew member's proficiency if the ship is proficiently equipped in Boost">Boost ${sign(boostBonus)} vs DC ${SR.boostDC(s)}</span>
        ${['engines', 'shields', 'weapons'].map(w => `<button class="btn tiny" data-sx="boost" data-what="${w}" ${(w === 'engines' ? b.engines >= 2 : b[w]) ? 'disabled' : ''}>Boost ${w}</button>`).join('')}
        <button class="btn tiny" data-sx="regen" ${b.regen || !sdLeft ? 'disabled' : ''} title="The action: spend a shield die and roll it (twice, keeping the lower, on a failed check). Works when the shields are down.">Regenerate shields (DC ${SR.regenDC(s)})</button>
        <button class="btn tiny" data-sx="patch" ${SR.diceLeft(s, 'hull') ? '' : 'disabled'} title="The action: a Constitution (Patch) check; spend a hull die and roll it (twice, keeping the lower, on a failure). Any number a turn.">Patch (DC ${SR.patchDC(s)})</button>
        ${done.length ? `<span class="muted" style="font-size:12px">This turn: ${esc(done.join(', '))}</span>` : ''}</div>`}
    </div>`;
  }

  // between fights: an hour's recharge (then hull dice), or a refit at a spaceport, with its time and cost
  function betweenBlock(s, st) {
    const size = SR.SIZE_DATA[s.size] ? s.size : 'Small', hdLeft = SR.diceLeft(s, 'hull'), whole = (+(s.hull || {}).current || 0) >= SR.hullMax(s);
    return `<div class="row wrap" style="gap:6px;margin-top:8px;font-size:12px"><span class="muted">Between fights</span>
      <button class="btn tiny" data-sx="recharge" title="An hour, with the crew for its size: shields full and half its shield dice back; then its crew can spend hull dice">Recharge (1 hour)</button>
      ${st.recharged ? `<button class="btn tiny" data-sx="hulldie" ${hdLeft && !whole ? '' : 'disabled'} title="An Intelligence (mechanic's kit) check: 10 or less, the die twice and the lower; 21 or more, twice and the higher; plus Constitution">Spend a hull die (${hdLeft} left)</button>` : ''}
      <button class="btn tiny ghost" data-sx="refit" title="Docked at a spaceport or shipyard: hull and shields full, all dice back, system damage one level lower">Refit (${SR.REFIT_TIME[size]}, ${SR.refitCost(s).toLocaleString('en-US')} cr)</button></div>`;
  }
  // the Modifications box: slots and suites against what the size allows; each row's category, grade, DC, cost and
  // prerequisites, and its installation check
  function modsHead(s) {
    const m = SR.modsSummary(s);
    return `<p style="font-size:12px;margin:0 0 6px">${m.used} of ${m.cap} slots${m.over ? ` <b class="warn">(${m.over} over: each one past capacity adds 2 to its installation DC)</b>` : ''} · ${s.size === 'Tiny' ? 'no suites on a Tiny ship' : `${m.suites} of ${m.suiteMax} suites${m.suites > m.suiteMax ? ' <b class="warn">(too many)</b>' : ''}`}</p>`;
  }
  function modRow(s, x, i, ro, inp) {
    const pre = SR.prereqs(s, x), dc = SR.installDC(s, i);
    const preTxt = pre.map((p) => `<span class="${p.ok === false ? 'warn' : 'muted'}" title="${p.ok === null ? 'For the GM to judge' : p.ok ? 'Met' : 'Not met'}">${p.ok === false ? '✗' : p.ok ? '✓' : '?'} ${esc(p.pre)}</span>`).join(' ');
    return `<div class="row wrap mod-row" style="gap:6px;margin:-2px 0 6px 8px;font-size:12px">${inp(`mods.${i}.type`, x.type || '', { ro, type: 'select', options: ['', ...SR.MOD_TYPES] })}
      <label class="ship-lv">grade ${inp(`mods.${i}.grade`, String(+x.grade || 0), { ro, type: 'select', options: ['0', '1', '2', '3', '4', '5'] })}</label>
      <label class="toggle" title="Given by a tier feature: no slot, no suite count, no cost, no check">${inp(`mods.${i}.free`, !!x.free, { ro, type: 'checkbox' })} tier feature</label>
      ${x.free ? '' : `<span class="muted">DC ${dc} · ${SR.modCost(s, x, i).toLocaleString('en-US')} cr${SR.pastCapacity(s, i) ? ' <span class="warn">(past capacity)</span>' : ''}</span>${ro || inFight() ? '' : `<button class="btn tiny ghost" data-sx="install" data-i="${i}" title="The foremost mechanic's Intelligence (mechanic's kit) check">Install check</button>`}`}
      ${preTxt}</div>`;
  }
  // ship combat is running on the space map: between-fights work (recharge, refit, installing) waits, for players (the
  // server refuses it; the GM stays free)
  const inFight = () => !H.isGM() && !!(H.S.st && H.S.st.space && H.S.st.space.active);
  // travel (SotG chapter 8): a hyperspace jump's time and fuel, astrogation, the start-up procedure
  const TV = {};   // per ship: the regions, rush, careful, data age and crew size picked here
  function travelBlock(s, ro) {
    const st = SR.statusOf(s), t = TV[s.id] = Object.assign({ from: 'Core', to: 'Core', rush: 0, careful: false, age: 'normal', crew: 'normal' }, TV[s.id]);
    // once equations are done, the trip keeps the course choice they were worked for (changing it restarts them)
    const crs = st.astro > 0 ? st.course : { rush: t.rush, careful: t.careful };
    const cls = SR.hyperClass(s), hours = SR.jumpHours(s, t.from, t.to, crs.rush, crs.careful), fuel = hours != null ? SR.jumpFuel(s, hours) : null, have = SR.fuelOf(s);
    const sel = (k, opts) => `<select data-tv="${k}" ${ro ? 'disabled' : ''}>${opts.map(([v, l]) => `<option value="${esc(String(v))}" ${String(t[k]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const regions = SR.REGIONS.map((r) => [r, r]);
    const when = hours == null ? (cls ? '' : 'No hyperdrive class on the sheet (Hyperdrive, above).') : `${hours < 24 ? `${hours} hours` : `${Math.round(hours / 24 * 10) / 10} days`} with a class ${cls} hyperdrive; ${fuel} units of fuel${have != null ? ` (it has ${have})` : ''}.`;
    return `<details class="ship-build" data-sid="${esc(s.id)}-tv" style="margin-top:8px" ${buildOpen[s.id + '-tv'] ? 'open' : ''}><summary>Travel <span class="muted" style="font-size:12px">(hyperspace, astrogation, start-up)</span></summary>
      <div class="row wrap" style="gap:6px;margin:6px 0;font-size:12px"><label class="ship-lv">From ${sel('from', regions)}</label><label class="ship-lv">to ${sel('to', regions)}</label>
        <label class="ship-lv" title="Each rush: -5 on the astrogation checks, a day off the trip (or half of what's left under a day)">Rush ${sel('rush', [[0, 'none'], [1, '1 day'], [2, '2 days'], [3, '3 days']])}</label>
        <label class="toggle" title="+5 on the astrogation checks, and the trip takes twice as long"><input type="checkbox" data-tv="careful" ${t.careful ? 'checked' : ''} ${ro ? 'disabled' : ''}> careful</label></div>
      <p style="font-size:12px;margin:0 0 6px">${esc(when)}${st.astro > 0 ? ` <span class="muted">Course worked for: ${crs.rush ? `rushed ${crs.rush}` : 'no rush'}${crs.careful ? ', careful' : ''}; a different choice restarts the equations.</span>` : ''}</p>
      <div class="row wrap" style="gap:6px;font-size:12px"><span>Astrogation: <b>${st.astro}</b> of 10 equations</span>
        ${ro ? '' : `<button class="btn tiny" data-sx="plot" title="Not under duress: 10 minutes of careful work, all ten equations">Plot with care</button>
        <label class="ship-lv">data ${sel('age', [['fresh', 'under a day old'], ['normal', 'this week'], ['old', 'over a week old']])}</label>
        <button class="btn tiny" data-sx="astro" title="Under duress, an action: Intelligence (Astrogation); 10-15 one equation, 16-20 two, 21-25 three, 26-29 four, 30+ five">Astrogation check</button>
        <button class="btn tiny amber" data-sx="jump" ${hours == null ? 'disabled' : ''} title="${st.astro < 10 ? 'Rushed: a mishap roll (d20 + the equations done)' : 'The course is plotted'}">Jump${st.astro < 10 ? ' (rushed)' : ''}</button>`}</div>
      <div class="row wrap" style="gap:6px;margin-top:6px;font-size:12px"><span>Start-up: ${esc(SR.START_UP[s.size] || '')} with care · emergency: <b>${st.startup}</b> of 10 procedures</span>
        ${ro ? '' : `<label class="ship-lv">crew ${sel('crew', [['normal', 'the minimum'], ['half', 'half (-5)'], ['extra', '1.5 times (+5)']])}</label>
        <button class="btn tiny" data-sx="startup" title="An action: the crew leader's Intelligence (Piloting); advantage at full hull and shields, disadvantage under full hull">Emergency start-up check</button>`}</div>
    </details>`;
  }
  // what a ship like this costs to buy, build, upgrade, dock and crew (SotG chapters 3, 5 and 8)
  function costsBlock(s) {
    const c = SR.costs(s), cr = (n) => `${Math.round(n).toLocaleString('en-US')} cr`, n = (x) => x.toLocaleString('en-US');
    const crew = (s.crew || []).length;
    return `<details class="ship-build" data-sid="${esc(s.id)}-cost" style="margin-top:8px" ${buildOpen[s.id + '-cost'] ? 'open' : ''}><summary>Costs and crew <span class="muted" style="font-size:12px">(buying, upgrading, docking)</span></summary>
      <table class="t" style="margin-top:6px"><tbody>
        <tr><td>A new ${esc(s.size || 'Small')} ship (tier 0)</td><td><b>${cr(c.stock)}</b>; a bank loan: ${cr(c.bankDown)} down and ${cr(c.bankMonthly)} a month for 5 years; a loan shark: about ${cr(c.sharkMonthly)} a month for 3 years</td></tr>
        <tr><td>Building one</td><td>${cr(c.build)} at a shipyard; a workforce of ${n(c.buildWorkforce[0])} to ${n(c.buildWorkforce[1])}: ${c.buildDays[0]} days at the smallest, ${c.buildDays[1]} at the largest</td></tr>
        <tr><td>Upgrading to tier ${(+s.tier || 0) + 1}</td><td>${c.nextTier == null ? 'already tier 5' : `<b>${cr(c.nextTier)}</b> (half if the party does the work), a workforce of ${n(c.upgradeWorkforce)}: ${c.upgradeDays} days`}</td></tr>
        <tr><td>Docking</td><td>about ${cr(c.docking)} a day${['Large', 'Huge', 'Gargantuan'].includes(s.size) ? ' at an orbital station (too big to land), or nothing staying in orbit' : ''}</td></tr>
        <tr><td>Minimum crew</td><td><b>${n(c.minCrew)}</b> (by size and Intelligence)${c.minCrew && crew < c.minCrew ? ` · ${crew} on the sheet: a skeleton crew runs as if with more system damage (¾: 1 level, ½: 2, ¼: 3, a tenth: 4)` : ''}</td></tr>
        <tr><td>Hired crew</td><td>salaried: 10 cr a day each and a 300 cr hiring bonus; or a share: 60% of the profits split among them</td></tr>
      </tbody></table></details>`;
  }
  // a crew row's deployment: the features of each rank they have, and the techniques they know (rank + 1), each with
  // "use": a power die from its system (or central storage), or a mechanic's tech die
  const DEP = { list: null, loading: false };
  function deployments() {
    if (DEP.list || DEP.loading || !window.HTB) return DEP.list;
    DEP.loading = true;
    window.HTB.list('deployments').then((l) => { DEP.list = {}; for (const d of l || []) DEP.list[d.n] = Object.assign(SR.deploymentInfo(d.md), { features: d.features || [] }); window.HTB.renderShipsSafe(); })
      .catch(() => { DEP.loading = false; });
    return null;
  }
  function crewRow(s, c, i, ro) {
    if (!c.deployment || !(+c.rank > 0)) return '';
    const all = deployments();
    if (!all) return `<tr class="crew-dep"><td colspan="5" class="muted" style="font-size:12px">Loading ${esc(c.deployment)} features…</td></tr>`;
    const info = all[c.deployment]; if (!info) return '';
    const featMd = (n) => ((info.features || []).find((f) => f.n === n) || {}).md || '';
    const ranks = info.ranks.filter(([r]) => r <= +c.rank).map(([r, fs]) => `<span class="muted">${r}:</span> ${fs.map((f) => `<span class="chip" title="${esc(featMd(f).slice(0, 600))}">${esc(f)}</span>`).join('')}`).join(' ');
    const known = (c.known || []).filter((k) => info.techniques.some((t) => t.name === k)), cap = SR.techniquesKnown(c.rank), st = SR.statusOf(s);
    const mech = c.deployment === 'Mechanic';
    const tech = known.map((k) => { const t = info.techniques.find((x) => x.name === k), loc = t.loc;
      const pool = loc && st.power[loc] > 0 ? loc : 'central', ok = mech || st.power[pool] > 0;
      return `<span class="chip" title="${esc(t.md.slice(0, 600))}">${esc(k)}${loc ? ` <span class="muted">(${loc})</span>` : ''}${ro ? '' : ` <button class="btn tiny amber" data-sx="tech" data-ci="${i}" data-name="${esc(k)}" data-pool="${mech ? '' : pool}" ${ok ? '' : 'disabled'} title="${mech ? `Roll the tech die (d${SR.techDie(c.rank)}); it isn't spent` : `Spend a power die from ${pool}`}">use</button><button class="btn tiny ghost" data-sx="forget" data-ci="${i}" data-name="${esc(k)}" title="Forget it">✕</button>`}</span>`; }).join('');
    const learn = !ro && known.length < cap ? `<select data-learn="${i}" style="width:auto;display:inline-block;font-size:12px;padding:1px 4px"><option value="">＋ ${mech ? 'technique' : 'technique'} (${known.length} of ${cap})</option>${info.techniques.filter((t) => !known.includes(t.name)).map((t) => `<option>${esc(t.name)}</option>`).join('')}</select>` : '';
    return `<tr class="crew-dep"><td colspan="5" style="font-size:12px;padding-top:0">${ranks}<div style="margin-top:3px">${tech || '<span class="muted">No techniques picked.</span>'} ${learn}${mech ? ` <span class="muted">tech die d${SR.techDie(c.rank)}</span>` : ''}</div></td></tr>`;
  }
  const buildOpen = {};   // per ship, whether the panel below is open (the sheet is redrawn on every change)
  document.addEventListener('toggle', (e) => { const d = e.target; if (d && d.classList && d.classList.contains('ship-build')) buildOpen[d.dataset.sid] = d.open; }, true);
  // what the ship's size, tier and role give it (SotG chapters 1, 3 and 5), next to what the sheet says, with Apply
  function buildBlock(s, ro) {
    const d = SR.derive(s), roles = Object.keys(SR.sizeOf(s).roles), sign = (n) => (n >= 0 ? '+' : '') + n;
    const adj = (o) => Object.entries(o || {}).map(([k, v]) => `${k.toUpperCase()} ${sign(v)}`).join(', ') || 'none';
    const armorAuto = SR.armorOf(Object.assign({}, s, { armor: '' }));
    const row = (label, mine, theirs) => `<tr><td>${label}</td><td>${esc(String(mine))}</td><td><b>${esc(String(theirs))}</b></td></tr>`;
    const saves = d.saves.length ? d.saves.map((k) => k.toUpperCase()).join(', ') + (d.saveNote ? ' + ' + d.saveNote.replace(/^Wisdom and /, '') : '') : d.saveNote;
    return `<details class="ship-build" data-sid="${esc(s.id)}" style="margin-top:10px" ${buildOpen[s.id] ? 'open' : ''}><summary>From size, tier and role <span class="muted" style="font-size:12px">(Starships of the Galaxy)</span></summary>
      <div class="row wrap" style="gap:8px;margin:6px 0"><label class="ship-lv">Role <select data-sp="role" ${ro ? 'disabled' : ''}><option value="" ${d.role ? '' : 'selected'}>${s.role && !d.role ? esc(s.role) + ' (not a SotG role)' : '(pick)'}</option>${roles.map((r) => `<option ${r === s.role ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
        <label class="ship-lv">Armor <select data-sp="armor" ${ro ? 'disabled' : ''}><option value="" ${s.armor ? '' : 'selected'}>${armorAuto ? `${esc(armorAuto)} (role or equipment)` : 'Lightweight (none set)'}</option>${Object.keys(SR.ARMORS).map((k) => `<option ${k === s.armor ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <span class="muted" style="font-size:12px">Damage reduction against attack rolls: ${SR.armorDR(s)}</span></div>
      <table class="t"><thead><tr><th></th><th>Sheet</th><th>From the rules</th></tr></thead><tbody>
        ${row('Hull dice', s.hullDice || '—', d.hullDice)}${row('Hull points', (s.hull || {}).max || 0, d.hull)}
        ${row('Shield dice', s.shieldDice || '—', d.shieldDice)}${row('Shield points', (s.shield || {}).max || 0, d.shieldType ? `${d.shield} (${d.shieldBase} base, ${d.shieldType.toLowerCase()})` : `${d.shieldBase} base (pick shields)`)}
        ${row('Armor Class', s.ac, d.ac)}${row('Speed / turning', `${s.speed} / ${s.turn}`, d.speed != null ? `${d.speed} / ${d.turn}` : '(pick a role)')}
        ${row('Suites', s.suites || '—', s.size === 'Tiny' ? 'none' : `up to ${d.suites}`)}${row('Modification slots', s.slots || '—', d.slots)}
        ${row('Saving throws', ['str', 'dex', 'con', 'int', 'wis', 'cha'].filter((k) => (s.saves || {})[k]).map((k) => k.toUpperCase()).join(', ') || '—', saves || '—')}</tbody></table>
      <p class="muted" style="font-size:12px;margin:6px 0">Ability scores: the standard array ${SR.STANDARD_ARRAY.join(', ')}, then size ${adj(d.sizeAdj)} and role ${adj(d.roleAdj)}, and +2 (or +1 and +1) at each tier from 1. Type them above; Apply doesn't change them.</p>
      ${ro ? '' : '<button class="btn small" data-sx="build" title="Sets hull and shield dice and points, AC, speed and turning, slots and the saving throws the size gives. A ship with no points yet starts full.">Apply these to the sheet</button>'}
    </details>`;
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
      ${ro || SR.isLost(st) && st.zero.destroyed || inFight() ? '' : betweenBlock(s, st)}
      ${buildBlock(s, ro)}
      ${travelBlock(s, ro)}
      ${costsBlock(s)}
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
    if (st.fx.evade >= 2) out.push('Evading');
    if (st.fx.fly >= 2) out.push(`Flying flat out: ${SR.moveBudget(s)} ft this turn`);
    if (st.fx.hardTurn) out.push('Hard turn ready');
    if (st.fx.directed) out.push('Next attack directed (advantage)');
    if (st.fx.interfered) out.push('Interfered with (next roll at disadvantage)');
    if (st.fx.concealed) out.push('Concealed (unseen until it attacks)');
    if (st.fx.dogfightVs) out.push('Dogfighting');
    if (st.fx.runVs) out.push(`Attack run (${st.fx.runFeet} ft)`);
    if (st.fx.harassedBy) out.push('Harassed (leaving its square costs a critical hit)');
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
    if (a === 'build') {
      const d = SR.derive(s), x = JSON.parse(JSON.stringify(s)), fresh = !((s.hull || {}).max > 0);
      x.hullDice = d.hullDice; x.shieldDice = d.shieldDice; x.hull.max = d.hull; if (d.shieldType) x.shield.max = d.shield;
      x.ac = d.ac; if (d.speed != null) { x.speed = d.speed; x.turn = d.turn; }
      const used = /^\s*(\d+)\s*\//.exec(String(s.slots || '')); x.slots = `${used ? used[1] : 0} / ${d.slots}`;
      if (s.size !== 'Tiny') x.suites = x.suites && !/^up to \d+$/.test(x.suites) ? x.suites : `up to ${d.suites}`;
      for (const k of d.saves) x.saves[k] = true;
      await H.act('ship.save', { ship: x });
      if (fresh) { await H.act('ship.points', { id, what: 'hull', current: d.hull }); if (d.shieldType) await H.act('ship.points', { id, what: 'shield', current: d.shield }); }
      H.toast('Applied from size, tier and role');
      return true;
    }
    if (a === 'plot') { await H.act('ship.plot', { id }); return true; }
    if (a === 'astro') { const t = TV[id] || {}; await H.act('ship.astro', { id, crew: (ctxOf[id] || {}).as || 0, rush: t.rush, careful: t.careful, age: t.age }); return true; }
    if (a === 'startup') { await H.act('ship.startup', { id, crew: (ctxOf[id] || {}).as || 0, crewSize: (TV[id] || {}).crew }); return true; }
    if (a === 'jump') { const t = TV[id] || {}; if (confirm(`Jump to hyperspace, ${t.from} to ${t.to}?`)) await H.act('ship.jump', { id, from: t.from, to: t.to, rush: t.rush, careful: t.careful }); return true; }
    if (a === 'tech') { await H.act('ship.technique', { id, crew: +b.dataset.ci, name: b.dataset.name, pool: b.dataset.pool }); return true; }
    if (a === 'forget') { const x = JSON.parse(JSON.stringify(s)), c = x.crew[+b.dataset.ci]; if (c) { c.known = (c.known || []).filter((k) => k !== b.dataset.name); await H.act('ship.save', { ship: x }); } return true; }
    if (a === 'install') { await H.act('ship.install', { id, mod: +b.dataset.i, crew: (ctxOf[id] || {}).as || 0 }); return true; }
    if (a === 'recharge') { await H.act('ship.recharge', { id }); return true; }
    if (a === 'hulldie') { await H.act('ship.hulldie', { id, crew: (ctxOf[id] || {}).as || 0 }); return true; }
    if (a === 'refit') { if (confirm(`Refit ${s.name} at a spaceport? ${SR.REFIT_TIME[SR.SIZE_DATA[s.size] ? s.size : 'Small']}, ${SR.refitCost(s).toLocaleString('en-US')} credits.`)) await H.act('ship.refit', { id }); return true; }
    if (a === 'hdset') { await H.act('ship.dice', { id, kind: 'hull', used: +b.dataset.n }); return true; }
    if (a === 'patch') { await H.act('ship.patch', { id, crew: (ctxOf[id] || {}).as || 0, mode: H.rollModeFromEvent(e) }); return true; }
    if (a === 'boost' || a === 'regen') { await H.act(a === 'boost' ? 'ship.boost' : 'ship.regen', { id, what: b.dataset.what, crew: (ctxOf[id] || {}).as || 0, mode: H.rollModeFromEvent(e) }); return true; }
    if (a === 'stabilize') { await H.act('ship.stabilize', { id }); return true; }
    if (a === 'cond') { const c = b.dataset.c; await H.act('ship.condition', { id, name: c, on: !SR.statusOf(s).cond.includes(c) }); return true; }
    if (a === 'reset') { if (confirm(`Undo ${s.name}'s destruction?`)) await H.act('ship.reset', Object.assign({ id }, b.dataset.system ? { system: +b.dataset.system } : {})); return true; }
    return false;
  }
  // the slowed and system damage pickers; returns true when it handled the change
  async function change(e, s) {
    const t = e.target, tv = t.dataset && t.dataset.tv;
    if (t.dataset && t.dataset.learn !== undefined && s) {   // learn a technique
      const x = JSON.parse(JSON.stringify(s)), c = x.crew[+t.dataset.learn];
      if (c && t.value) { c.known = [...new Set([...(c.known || []), t.value])]; await H.act('ship.save', { ship: x }); }
      return true;
    }
    if (tv && s) { const o = TV[s.id] = TV[s.id] || {}; o[tv] = t.type === 'checkbox' ? t.checked : tv === 'rush' ? +t.value || 0 : t.value; t.blur(); window.HTB.renderShipsSafe(); return true; }
    const k = t.dataset && t.dataset.sxc; if (!k || !s) return false;
    await H.act('ship.condition', { id: s.id, name: k, level: +t.value || 0 });
    return true;
  }

  window.HTShipSheet = { block, effects, rollOpts, click, change, modsHead, modRow, crewRow };
  if (window.HTB && H.S.st) window.HTB.renderShipsSafe();   // the ships tab may have been drawn before this file loaded
})();
