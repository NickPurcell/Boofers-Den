/* HoloTable combat view (off until the GM switches it on): the fight on the map, by clicking.
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
      spent: f.spent, defenses: f.defenses || {}, effects: f.effects || [], conc: f.conc || {}, walls: ((s.map && s.map.walls) || []).concat(f.propWalls || []), variants: s.variants || [],
      npcStats: Object.fromEntries(Array.from(new Set(Object.keys(f.npcDefenses || {}).concat(Object.keys(f.npcBody || {})))).map((k) => [k,
        Object.assign({ saves: (f.npcSaves || {})[k] || {}, mods: (f.npcMods || {})[k] || {}, skills: (f.npcSkills || {})[k] || {} }, (f.npcDefenses || {})[k] || {}, (f.npcBody || {})[k] || {})])),
    }, R);
    for (const [id, u] of Object.entries(f.units || {})) { if (w.units[id] && u.down) w.units[id].down = true; if (w.units[id] && u.hidden) w.units[id].hidden = true; }
    // the GM's previews see the dark as the server does (step 5): the fog view says where the light falls
    const fog = s.fog;
    if (fog && (fog.dark || fog.dimLit)) {
      const n = fog.cols * fog.rows, dark = fog.dark ? E.unpackSquares(fog.dark, n) : new Uint8Array(n), dim = fog.dimLit ? E.unpackSquares(fog.dimLit, n) : new Uint8Array(n);
      w.light = { lit: Uint8Array.from(dark, (d, i) => (d ? 0 : dim[i] ? 1 : 2)), cols: fog.cols, rows: fog.rows };
    }
    UI.cache = { st: s, w, reach: null };
    return w;
  }
  const cur = () => { const w = world(); return w.turnId ? w.units[w.turnId] : null; };
  // the turn is yours to play, unless it waits for someone's answer to a reaction
  const myTurn = () => { const f = F(), u = cur(); return !!(f.on && u && !(f.pending || []).length && (gm() ? true : (f.units[u.id] || {}).mine)); };
  const entry = (id) => st().initiative.entries.find((e) => e.id === id);
  const unitAt = (gx, gy) => {
    const w = world();
    return Object.values(w.units).find((u) => gx >= u.x && gx < u.x + (u.size || 1) && gy >= u.y && gy < u.y + (u.size || 1)) || null;
  };
  function reach() {
    const w = world(), u = cur();
    if (!u || !myTurn()) return {};
    if (!UI.cache.reach) UI.cache.reach = F().reach || E.reachable(w, u.id, E.budget(w).moveLeft);
    return UI.cache.reach;
  }

  /* ---------------- attacks: the sheet's, or the creature's stat block (GM) ---------------- */
  // what the current combatant can do: a character's weapon attacks and the powers the table has data for;
  // a creature's attacks from its stat block (GM). Weapons keep their own key (the attack row) for fight.attack.
  function attacks() {
    const u = cur();
    if (!u) return [];
    if (u.charId) {
      const ch = st().characters[u.charId];
      if (!ch) return [];
      const weapons = E.attacksOf(ch, R);
      // powers, and a weapon's burst and rapid fire (5.8) as save-based options beside its attack
      const powers = E.abilitiesOf(ch, R, F().lib || {}).filter((a) => a.kind === 'power' || a.kind === 'volley').map((ab) => ({ key: ab.key, name: ab.name, power: ab,
        bonus: ab.attack ? ab.attack.bonus : null, damage: ab.damage.map((d) => d.dice + (d.add ? sgn(d.add) : '')).join('+') || (ab.heal ? 'heal ' + ab.heal.dice : ''),
        type: (ab.damage[0] || {}).type || '', melee: ab.reach || 0, range: ab.range, crit: '' }));
      // after the Attack action: a bonus action attack with the off-hand light weapon, or a double weapon's other end (5.8)
      const w = world(), me = w && w.units[u.id];
      const offs = me ? weapons.map((a) => ({ a, o: E.offhandOf(w, me, a) })).filter((x) => x.o.spec)
        .map(({ a, o }) => Object.assign({}, o.spec, { key: 'off:' + a.key, base: a.key, offhand: o.kind })) : [];
      // a monk's Martial Arts bonus strike, then Flurry of Blows (#67)
      const mas = me ? weapons.filter((a) => a.unarmed).map((a) => ({ a, o: E.martialOf(w, me, a) })).filter((x) => x.o.spec)
        .map(({ a, o }) => Object.assign({}, o.spec, { key: 'ma:' + a.key, base: a.key, martialBonus: true, flurry: !!o.flurry })) : [];
      return weapons.concat(offs, mas, powers, MANEUVERS);
    }
    if (!gm()) return [];
    const known = UI.npc[u.id];
    if (!known) loadCreature(u.id);
    return ((known && known.attacks) || []).concat(UI.custom && UI.custom.unit === u.id ? [UI.custom.spec] : [], MANEUVERS);
  }
  // Grapple, Shove and Help (#144): picked like an attack, then a target; Grapple and Shove use one attack of the Attack action
  const MANEUVERS = [
    { key: 'grapple', name: 'Grapple', maneuver: 'grapple', damage: 'Athletics contest', type: '', melee: 5 },
    { key: 'shove-prone', name: 'Shove: knock prone', maneuver: 'shove', push: false, damage: 'Athletics contest', type: '', melee: 5 },
    { key: 'shove-push', name: 'Shove: push 5 ft', maneuver: 'shove', push: true, damage: 'Athletics contest', type: '', melee: 5 },
    { key: 'help', name: 'Help', maneuver: 'help', damage: 'an ally attacks it with advantage', type: '', melee: 5 },
  ];
  const helpWhy = (u, t) => (E.feetBetween(u, t) > E.FT ? `${t.name} is ${E.feetBetween(u, t)} ft away: Help needs it within 5 ft.` : '');
  // a stat block's limited abilities (audit 9.5): "Recharge X-6", "N/Day", "Recharges after a Short or Long Rest", and
  // legendary actions (3 a round, back at the start of its turn)
  const slug = (n) => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  function limitedOf(m) {
    const out = [];
    for (const b of m.b || []) {
      const r = String(b.r || ''), name = String(b.n || ''), key = slug(name);
      let mm;
      if (!key || out.some((x) => x.key === key)) continue;
      if ((mm = /recharge\s*(\d)/i.exec(r))) out.push({ key, name, max: 1, used: 0, refill: 'manual', recharge: +mm[1] });
      else if (/recharges? after/i.test(r)) out.push({ key, name, max: 1, used: 0, refill: 'short' });
      else if ((mm = /(\d+)\s*\/\s*day/i.exec(r))) out.push({ key, name, max: +mm[1], used: 0, refill: 'long' });
    }
    if ((m.b || []).some((b) => b.k === 'legendary')) out.push({ key: 'legendary', name: 'Legendary actions', max: 3, used: 0, refill: 'turn' });
    // casting (audit 9.5): "It has 36 force points" / "(…, 22 tech points)" as a points pool, back after a long rest; an
    // innate caster's "3/day each: a, b, c" as a use count for each power
    for (const b of m.b || []) {
      const d = String(b.d || '');
      for (const [, n, kind] of d.matchAll(/(\d{1,3})\s+(force|tech)\s+points/gi)) {
        const key = `${kind.toLowerCase()}-points`;
        if (!out.some((x) => x.key === key)) out.push({ key, name: `${kind[0].toUpperCase()}${kind.slice(1).toLowerCase()} points`, max: Math.min(300, +n), used: 0, refill: 'long', points: true });
      }
      for (const [, n, list] of d.matchAll(/(\d+)\s*\/\s*day\s+each\s*:\s*(.+?)(?=\s{2,}|\.(?:\s|$)|\s+\d+\s*\/\s*day\s+each|\s+at[- ]will\s*:|$)/gi)) {
        for (const p of list.split(',').map((x) => x.trim().replace(/[.;]+$/, '')).filter(Boolean)) {
          const key = slug(p);
          if (key && !out.some((x) => x.key === key) && out.length < 40) out.push({ key, name: p.replace(/^./, (c) => c.toUpperCase()), max: +n, used: 0, refill: 'long' });
        }
      }
    }
    return out;
  }
  // the GM's own browser has the creature list (books.js); speed goes to the server once, attacks travel with each attack
  function loadCreature(id) {
    const e = entry(id);
    if (!e || !e.sb || !window.HTB || UI.npc[id]) { if (e && !UI.npc[id]) UI.npc[id] = { attacks: [] }; return; }
    UI.npc[id] = { attacks: [], loading: true };
    window.HTB.list('monsters').then((list) => {
      const m = (list || []).find((x) => x.n === e.sb);
      const res = m ? limitedOf(m) : [];
      const atks = m ? m.b.filter((b) => b.k === 'action').map((b) => { const a = E.attackFromBehavior(b); return a && Object.assign(a, { res: (res.find((r) => r.name === b.n) || {}).key }); }).filter(Boolean).map((a, i) => Object.assign(a, { key: 'sb' + i })) : [];
      const multi = m ? E.multiattackOf((m.b.find((b) => /^multiattack/i.test(b.n || '')) || {}).d) : 1;   // attacks per Attack action (#139)
      UI.npc[id] = { attacks: atks, multi, legendary: m ? m.b.filter((b) => b.k === 'legendary').map((b) => ({ name: b.n, cost: +((/costs?\s+(\d)/i.exec(b.n + ' ' + (b.r || '')) || [])[1]) || 1 })) : [] };
      if (m && res.length && !((F().npcRes || {})[id] || []).length) act('fight.npcres', { id, op: 'set', res });
      const sp = m && /(\d+)\s*f/.exec(m.speed || '');
      if (m && F().npcSpeed[id] == null && !UI.npcAsked[id]) {
        // its speed and save bonuses: the ability modifier, or the bonus its stat block lists ("Dex +5")
        const saves = Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].map((ab) => [ab, Math.floor(((m.ab || {})[ab] - 10) / 2) || 0]));
        for (const x of m.saves || []) { const mm = /^(str|dex|con|int|wis|cha)\w*\s*([+-]\d+)/i.exec(x); if (mm) saves[mm[1].toLowerCase()] = +mm[2]; }
        const mods = Object.fromEntries(['str', 'dex', 'con', 'int', 'wis', 'cha'].filter((ab) => Number.isFinite(+(m.ab || {})[ab])).map((ab) => [ab, Math.floor(((m.ab || {})[ab] - 10) / 2)]));
        const reach = Math.max(5, ...atks.map((a) => a.melee || 0));
        UI.npcAsked[id] = true; act('fight.npc', { id, speed: sp ? +sp[1] : 30, saves, mods, size: m.size || '', reach, resist: m.res || [], immune: m.imm || [], vuln: m.vul || [], condImmune: m.cimm || [], senses: m.senses || [], skills: m.skills || [] });
      }
      render(); H.drawMap();
    }).catch(() => { UI.npc[id] = { attacks: [] }; render(); });
  }
  function customAttack(forUnit) {
    const u = forUnit || cur();
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
        if (!forUnit) UI.armed = 'custom';
        H.closeModal(); render(); H.drawMap();
      };
    });
  }
  const armedSpec = () => attacks().find((a) => a.key === UI.armed) || null;
  const targets = (spec) => {
    const w = world(), u = cur();
    if (!u || !spec) return [];
    if (spec.maneuver) return Object.values(w.units).filter((t) => t.id !== u.id && t.side !== u.side && !E.isDead(t) && !(spec.maneuver === 'help' ? helpWhy(u, t) : E.maneuverCheck(w, u, t, spec.maneuver)));
    if (spec.power) {
      const ab = spec.power;
      if (ab.area) return [u];   // aimed at a point: always usable when the slot and the points are there
      return Object.values(w.units).filter((t) => (ab.targets === 'self' ? t.id === u.id : t.id !== u.id && (ab.heal ? t.side === u.side : t.side !== u.side) && !t.down) && E.inReachOf(w, u, t, ab).ok);
    }
    return Object.values(w.units).filter((t) => t.id !== u.id && t.side !== u.side && !t.down && E.preview(w, u.id, t.id, spec).legal);
  };
  // the line shown before a power is used on someone
  function powerPreview(w, u, t, ab) {
    const r = E.inReachOf(w, u, t, ab);
    if (!r.ok) return { legal: false, why: r.why };
    const lvl = ab.level + (UI.upcast || 0), cost = Object.entries(ab.cost || {}).map(([k, n]) => `${n + (UI.upcast && k === ab.pool ? UI.upcast : 0)} ${k === 'force' ? 'FP' : k === 'tech' ? 'TP' : k}`).join(', ');
    let line = `${t.id === u.id ? 'On yourself' : `<b>${esc(t.name)}</b>, ${r.feet} ft`}: `;
    if (ab.attack) {
      const pv = E.preview(w, u.id, t.id, { name: ab.name, bonus: ab.attack.bonus, abil: ab.attack.abil, damage: 'x', melee: ab.reach || 0, range: ab.range }, { adv: UI.adv, dis: UI.dis });
      line += pv.legal ? `you need <b>${pv.need}+</b> on the d20 (${Math.round(pv.chance * 100)}%)` : esc(pv.why);
    } else if (ab.save) {
      const sb = (t.saves || {})[ab.save.ability];
      line += `a DC ${ab.save.dc} ${ab.save.ability.toUpperCase()} save${sb == null ? '' : ` (${sgn(sb)}): it fails on ${Math.max(0, ab.save.dc - 1 - sb)} or less`}`;
    } else line += ab.heal ? 'healing' : 'no roll';
    const dmg = ab.damage.length ? ab.damage.map((d) => d.dice + (d.add ? sgn(d.add) : '') + (d.type ? ' ' + d.type : '')).join(' + ') + (UI.upcast && ab.upcast ? ` + ${UI.upcast}×${ab.upcast.damage}` : '') + (ab.save && ab.save.onSave === 'half' ? ', half on a save' : '') : ab.heal ? `${ab.heal.dice}${ab.heal.add ? sgn(ab.heal.add) : ''} hit points back` : '';
    return { legal: true, html: `${line}${dmg ? `. ${esc(dmg)}` : ''}${cost ? ` · costs ${esc(cost)}` : ''}${lvl !== ab.level ? ` · at level ${lvl}` : ''}.` };
  }

  // an area is aimed at a point: spheres, cylinders and cubes on a grid corner, cones and lines toward the pointer
  const aimAt = (ab, gx, gy) => (ab.area.from === 'point' ? { x: Math.round(gx), y: Math.round(gy) } : { x: gx, y: gy });
  function areaPreview() {
    const spec = armedSpec(), u = cur();
    if (!spec || !spec.power || !spec.power.area || !UI.aim || !u) return null;
    return E.areaHits(world(), u.id, spec.power, UI.aim);
  }

  /* ---------------- talking to the server ---------------- */
  async function send(type, payload) {
    if (UI.busy) return null;
    UI.busy = true;
    try { return await act(type, payload); } finally { UI.busy = false; }
  }
  const specOut = (spec) => ({ name: spec.name, bonus: spec.bonus, damage: spec.damage, type: spec.type, melee: spec.melee, range: spec.range, res: spec.res || undefined });
  // what a reaction can be made with: Return Fire takes a ranged weapon from the sheet; the rest, a melee attack (#67)
  function reactOptions(re, kind) {
    if (kind !== 'return-fire') return meleeOf(re);
    const ch = re.charId && st().characters[re.charId];
    return ch ? E.attacksOf(ch, R).filter((a) => a.range) : [];
  }
  // the melee attacks a reacting combatant has: its sheet's, or (for the GM) its stat block's
  function meleeOf(re) {
    if (re.charId) { const ch = st().characters[re.charId]; return ch ? E.attacksOf(ch, R).filter((a) => a.melee > 0) : []; }
    if (!gm()) return [];
    if (!UI.npc[re.id]) loadCreature(re.id);
    return ((UI.npc[re.id] || {}).attacks || []).concat(UI.custom && UI.custom.unit === re.id ? [UI.custom.spec] : []).filter((a) => a.melee > 0);
  }
  async function attack(targetId) {
    const spec = armedSpec(), u = cur();
    if (!spec || !u) return;
    if (spec.maneuver) {   // #144
      const r = spec.maneuver === 'help' ? await send('fight.common', { key: 'help', target: targetId })
        : await send('fight.' + spec.maneuver, { target: targetId, push: !!spec.push, multi: u.charId ? undefined : (UI.npc[u.id] || {}).multi || 1 });
      if (r) { UI.armed = null; UI.target = null; render(); }
      return;
    }
    const r = spec.power ? await send('fight.use', Object.assign({ ability: spec.key, upcast: UI.upcast || 0, adv: UI.adv, dis: UI.dis }, spec.power.area ? { point: UI.aim } : { target: targetId }))
      : await send('fight.attack', { target: targetId, adv: UI.adv, dis: UI.dis, attack: u.charId ? spec.base || spec.key : specOut(spec), offhand: !!spec.offhand, martial: !!spec.martialBonus, no: UI.noRiders || [], add: UI.addRiders || {}, twoHands: !!UI.twoHands,
        multi: u.charId ? undefined : (UI.npc[u.id] || {}).multi || 1 });
    if (r) { UI.armed = null; UI.target = null; UI.aim = null; UI.adv = UI.dis = false; UI.upcast = 0; UI.noRiders = []; UI.addRiders = {}; render(); }
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
    bar.addEventListener('change', onBarChange);
    return bar;
  }
  let sw = null;
  function ensureSwitch() {
    if (sw) return sw;
    sw = document.createElement('button');
    sw.className = 'btn small ct-switch'; sw.id = 'ctSwitch'; sw.hidden = true; sw.type = 'button';
    sw.textContent = '⚔ Combat view';
    sw.title = 'Turn on the combat view for everyone: click to move, an action bar, and the rules doing the arithmetic. Off again any time.';
    sw.addEventListener('click', () => send('fight.toggle', { on: true }));
    $('#mapWrap').appendChild(sw);
    return sw;
  }
  function render() {
    const s = st();
    if (!s) return;
    renderWallBar();
    const f = F(), b = ensureBar();
    // floating numbers for what just happened (not replayed when the page first loads)
    const evs = f.events || [];
    const top = evs.reduce((m, ev) => Math.max(m, ev.seq), 0);
    if (UI.seen < 0) UI.seen = top;
    for (const ev of evs) if (ev.seq > UI.seen && ev.kind !== 'move') UI.floats.push({ token: ev.token, kind: ev.kind, amount: ev.amount, t0: performance.now() });
    UI.seen = Math.max(UI.seen, top);
    if (UI.floats.length) animate();
    // off (the default): no bar and no change to the map's layout; the GM alone gets one small switch in its corner
    const sw = ensureSwitch();
    sw.hidden = f.on || !gm();
    if (!f.on) { b.hidden = true; b.innerHTML = ''; UI.floats = []; return; }
    b.hidden = false;
    const u = cur(), mine = myTurn(), bud = f.budget, w = world();
    const who = !f.active ? 'Combat hasn\'t started' : u ? `${esc(u.name)}'s turn` : f.turn ? 'A combatant not on the map' : 'Someone you can\'t see is acting';
    const chip = (on, label, title) => `<span class="ct-chip ${on ? '' : 'spent'}" title="${esc(title)}">${on ? '' : '<span aria-hidden="true">✕ </span>'}${esc(label)}${on ? '' : ' (used)'}</span>`;
    let html = `<div class="ct-row"><span class="ct-turn">${f.active ? `Round ${+f.round || 1} · ` : ''}${who}${mine && !gm() ? ' <span class="ct-you">your turn</span>' : ''}</span>`;
    if (bud) html += `<span class="ct-chips">${chip(bud.moveLeft > 0, `Move ${bud.moveLeft}/${bud.total == null ? bud.speed : bud.total} ft`, bud.dash ? 'Movement left this turn (with Dash)' : 'Movement left this turn')}${bud.attacks ? chip(true, `Attack: ${bud.attacks} more`, 'Attacks left in this Attack action (Extra Attack or Multiattack). You can move between them.') : chip(bud.action, 'Action', 'One action a turn')}${chip(bud.bonus, 'Bonus action', 'One bonus action a turn')}${chip(bud.reaction, 'Reaction', 'One reaction between your turns')}</span>`;
    html += '<span class="spacer"></span>';
    html += `<button class="btn small ghost ${UI.ruler ? 'primary' : ''}" data-ct="measure" aria-pressed="${!!UI.ruler}" title="Measure a distance on the map">📏 Measure</button>`;
    if (mine && u && f.active && (u.conditions || []).includes('Prone') && bud && bud.speed > 0) html += `<button class="btn small" data-ct="stand" title="Standing up costs half your speed">Stand up (${Math.ceil((bud ? bud.speed : 30) / 2 / 5) * 5} ft)</button>`;
    if (mine && u && f.active && bud && bud.action) for (const o of Object.values(w.units)) {
      if (!(o.conditions || []).includes('Ignited') || (o.id !== u.id && E.feetBetween(u, o) > E.FT)) continue;
      html += `<button class="btn small" data-ct="douse" data-id="${esc(o.id)}" title="Takes your action">🔥 Put out the flames${o.id === u.id ? '' : ` on ${esc(o.name)}`}</button>`;
    }
    if (mine && u && f.active) {   // a grapple (#144): escape one, or let go of one
      const held = (w.effects || []).find((ef) => ef.unit === u.id && ef.condition === 'Grappled' && ef.source && w.units[ef.source]);
      if (held && bud && bud.action) html += `<button class="btn small" data-ct="escape" title="Takes your action: your Athletics or Acrobatics against the grappler's Athletics">🤼 Escape ${esc(w.units[held.source].name)}'s grapple</button>`;
      for (const ef of (w.effects || []).filter((x) => x.condition === 'Grappled' && x.source === u.id && w.units[x.unit])) html += `<button class="btn small ghost" data-ct="release" data-id="${esc(ef.unit)}" title="No action needed">Let go of ${esc(w.units[ef.unit].name)}</button>`;
    }
    if (mine && u && f.active && E.isDying(u) && !E.spentOf(w, u.id).ds) html += '<button class="btn small primary" data-ct="deathsave" title="At 0 hit points: 10 or more succeeds, a 1 counts twice, a 20 brings you back with 1 hit point">🎲 Death save</button>';
    if (mine && u && f.active) html += '<button class="btn small amber" data-ct="end">End turn ⏭</button>';
    if (gm()) html += `<button class="btn small ghost" data-ct="undo" ${f.undo && f.undo.n ? '' : 'disabled'} title="${esc(f.undo && f.undo.last ? 'Undo: ' + f.undo.last : 'Nothing to undo')}">↶ Undo</button><button class="btn small ghost" data-ct="off" title="Turn the combat view off for everyone">Combat view off</button>`;
    html += '</div>';
    // the order of play, as this viewer's tracker has it (hidden creatures aren't in a player's), and the log
    const order = (s.initiative.entries || []).filter((e) => f.active);
    if (order.length) {
      html += `<div class="ct-row ct-order" aria-label="Order of play">${order.map((e) => {
        const down = e.hp != null && +e.hp <= 0, cur = e.id === f.turn, n = (e.conditions || []).length;
        return `<span class="ct-ord ${cur ? 'cur' : ''} ${down ? 'down' : ''}" title="${esc(e.name)}${n ? ': ' + esc(e.conditions.join(', ')) : ''}">${esc(e.name)}${n ? ` <b>${n}</b>` : ''}</span>`;
      }).join('<span class="ct-sep" aria-hidden="true">›</span>')}<span class="spacer"></span>
        ${(() => { const on = ['Flanking', 'Compound Advantage', 'Crueler Criticals', 'Critical Saving Throws'].filter((v) => (s.variants || []).includes(v)); return on.length ? `<span class="muted ct-variants" title="SW5e variant rules this table uses that change the combat view's arithmetic">${esc(on.join(' · '))}</span>` : ''; })()}
        <button class="btn tiny ghost ${UI.log ? 'primary' : ''}" data-ct="log" aria-pressed="${!!UI.log}" title="The last combat lines">📜 Log</button></div>`;
      if (UI.log) {
        const lines = (s.chat || []).filter((m) => m.fight).slice(-8);
        html += `<div class="ct-row ct-log">${lines.length ? lines.map((m) => `<div>${m.roll ? `${esc(m.roll.label)} <b>${esc(String(m.roll.total))}</b>` : esc(m.text)}</div>`).join('') : '<div class="muted">Nothing yet.</div>'}</div>`;
      }
    }
    // reactions waiting: the one who may react answers (or the GM for anyone); everyone else sees that the turn waits
    for (const pr of f.pending || []) {
      const re = w.units[pr.reactor], ag = w.units[pr.against];
      if (!re || !ag) continue;
      const what = pr.kind === 'riposte' ? `a riposte against <b>${esc(ag.name)}</b>, who missed it (a superiority die, added on a hit)`
        : pr.kind === 'return-fire' ? `return fire at <b>${esc(ag.name)}</b>, who missed it (a superiority die, added on a hit)` : `an opportunity attack on <b>${esc(ag.name)}</b>, who is leaving its reach`;
      if (pr.mine) {
        const opts = reactOptions(re, pr.kind);
        html += `<div class="ct-row ct-react" role="alert"><span>⚡ <b>${esc(re.name)}</b> can make ${what}.</span>
          ${opts.map((a) => `<button class="btn small primary" data-ct="react" data-id="${esc(pr.id)}" data-key="${esc(a.key)}" data-unit="${esc(re.id)}" data-kind="${esc(pr.kind || 'opportunity')}">${esc(a.name)} <b>${esc(sgn(a.bonus))}</b></button>`).join('')}
          ${opts.length ? '' : `<span class="muted">${UI.npc[re.id] && UI.npc[re.id].loading ? 'Reading the stat block…' : 'No melee attack known.'}</span>`}
          ${gm() && !re.charId ? `<button class="btn small ghost" data-ct="custom" data-unit="${esc(re.id)}">＋ Custom attack</button>` : ''}
          <button class="btn small ghost" data-ct="letgo" data-id="${esc(pr.id)}">Let it go</button></div>`;
      } else html += `<div class="ct-row ct-react muted">Waiting for ${esc(re.name)}: ${pr.kind === 'riposte' ? 'a riposte' : pr.kind === 'return-fire' ? 'return fire' : 'an opportunity attack'} against ${esc(ag.name)}, to take or let go.</div>`;
    }
    // the current combatant's conditions (how long each lasts) and what it is concentrating on
    const flags = u ? E.spentOf(w, u.id) : {};
    const at0 = u && u.side === 'pc' && u.hp === 0;
    if (f.active && u && ((u.conditions || []).length || (f.conc || {})[u.id] || flags.dodge || flags.disengage || (u.senses || []).length || at0 || gm())) {
      const efs = (f.effects || []).filter((ef) => ef.unit === u.id);
      // what the chip says beyond the name: its level, its fire damage, who caused it, or that the DM hasn't set one
      const detail = (c) => {
        const lv = E.LEVELS[c] ? E.levelOf(w, u, c) : 0, burn = c === 'Ignited' ? E.burnOf(w, u) : '';
        const src = efs.filter((x) => x.condition === c && x.source && w.units[x.source]).map((x) => w.units[x.source].name)[0];
        const bits = [];
        if (E.LEVELS[c]) bits.push(lv ? `level ${lv}` : 'no level set');
        if (c === 'Ignited') bits.push(burn ? `${burn} fire at the end of its turns` : 'no damage set');
        if (src) bits.push(`by ${src}`);
        return bits.length ? ` · ${bits.join(', ')}` : '';
      };
      const until = (c) => {
        const ef = efs.find((x) => x.condition === c && x.ends !== 'never');
        if (!ef) return '';
        const whose = ef.of === u.id ? 'its' : ef.of && w.units[ef.of] ? `${w.units[ef.of].name}'s` : "someone's";
        return ` (${ef.save ? `${ef.save.ability.toUpperCase()} save DC ${ef.save.dc} at the end of its turns` : `until the ${ef.ends} of ${whose} ${ef.rounds > 1 ? `turn, ${ef.rounds} rounds` : 'next turn'}`}${ef.conc ? ', while concentrating' : ''})`;
      };
      html += `<div class="ct-row ct-conds">${(u.conditions || []).map((c) => `<span class="ct-chip ct-cond" title="${esc((R.CONDITIONS || {})[c] || c)}${esc(until(c))}">${esc(c)}${esc(detail(c))}${E.CONDITION_EFFECTS[c] ? '' : ' <span class="muted">(no automatic effect yet)</span>'}${esc(until(c))}${gm() ? ` <button class="ct-x" data-ct="uncond" data-c="${esc(c)}" title="Take ${esc(c.toLowerCase())} off ${esc(u.name)}" aria-label="Take ${esc(c.toLowerCase())} off">✕</button>` : ''}</span>`).join('')}
        ${at0 ? (() => {
          const ds = u.deathSaves || { s: 0, f: 0 }, dots = (n, ch) => Array.from({ length: 3 }, (_, i) => (i < n ? ch : '·')).join('');
          return E.isDead(u) ? '<span class="ct-chip ct-cond">💀 Dead</span>' : E.isStable(u) ? '<span class="ct-chip">Stable at 0 hit points</span>'
            : `<span class="ct-chip ct-cond" title="Death saves: successes, then failures">Dying · ${dots(ds.s, '✓')} ${dots(ds.f, '✗')}</span>`;
        })() : ''}
        ${(u.senses || []).map((x) => `<span class="ct-chip ct-sense" title="${esc(SENSE_HINT[x.kind] || '')}">👁 ${esc(x.kind)} ${x.range} ft</span>`).join('')}
        ${flags.dodge ? '<span class="ct-chip" title="Attacks against it at disadvantage, Dex saves at advantage, until its next turn">Dodging</span>' : ''}
        ${flags.disengage ? '<span class="ct-chip" title="Leaving a reach provokes no opportunity attack this turn">Disengaged</span>' : ''}
        ${gm() ? '<button class="btn tiny ghost" data-ct="cond" title="Put a condition on a combatant, with its level, its damage or who caused it">＋ Condition</button>' : ''}
        ${(f.conc || {})[u.id] ? `<span class="ct-chip ct-conc" title="Damage asks for a Con save; dropping to 0 hit points or being incapacitated ends it">Concentrating: ${esc(f.conc[u.id])}</span>` : ''}</div>`;
    }
    // a creature's limited abilities (the GM's): a chip each; click to use one, or to reset a spent one
    if (gm() && f.active && u && !u.charId && ((f.npcRes || {})[u.id] || []).length) {
      html += `<div class="ct-row ct-pools">${f.npcRes[u.id].map((r) => `${r.points && r.used < r.max ? `<input class="ct-ptsn" type="number" min="1" max="${r.max - r.used}" value="${Math.min(2, r.max - r.used)}" data-pts="${esc(r.key)}" title="Points to spend: a power costs its level + 1 (at will costs nothing)" aria-label="${esc(r.name)} to spend">` : ''}<button class="ct-chip ct-pool ${r.used >= r.max ? 'spent' : ''}" data-ct="npcres" data-unit="${esc(u.id)}" data-key="${esc(r.key)}" title="${esc(r.recharge ? `Recharge ${r.recharge}-6: rolled at the start of its turn` : r.refill === 'turn' ? 'Back at the start of its turn' : r.refill === 'short' ? 'Back after a short or long rest (reset by hand)' : 'Per day (reset by hand)')}">${esc(r.name)} ${r.max - r.used}/${r.max}${r.recharge ? ` ⟳${r.recharge}–6` : ''}</button>`).join('')}</div>`;
    }
    if (gm() && f.active) {   // legendary actions, used at the end of another combatant's turn
      const legs = Object.entries(f.npcRes || {}).filter(([id, list]) => id !== (u && u.id) && w.units[id] && !w.units[id].down && list.some((r) => r.key === 'legendary' && r.used < r.max));
      if (legs.length) html += `<div class="ct-row ct-legend"><span class="muted">⚡ Legendary:</span>${legs.map(([id, list]) => {
        const r = list.find((x) => x.key === 'legendary'), opts = (UI.npc[id] || {}).legendary || [];
        if (!UI.npc[id]) loadCreature(id);
        return `<span class="ct-chip">${esc(w.units[id].name)} ${r.max - r.used}/${r.max}</span>${opts.map((o) => `<button class="btn tiny ghost" data-ct="legend" data-unit="${esc(id)}" data-n="${o.cost}" ${r.max - r.used < o.cost ? 'disabled' : ''} title="Costs ${o.cost}">${esc(o.name.replace(/\s*\(costs?[^)]*\)/i, ''))}${o.cost > 1 ? ` (${o.cost})` : ''}</button>`).join('') || `<button class="btn tiny ghost" data-ct="legend" data-unit="${esc(id)}" data-n="1">Use one</button>`}`;
      }).join('')}</div>`;
    }
    // the current character's resources (its owner and the GM): use one, or add one
    if (f.active && u && u.charId && (mine || gm())) {
      const pools = Object.values(u.pools || {}).filter((r) => r.key !== 'hitdice');
      html += `<div class="ct-row ct-pools">${pools.map((r) => `<button class="ct-chip ct-pool ${r.used >= r.max ? 'spent' : ''}" data-ct="pool" data-key="${esc(r.key)}" title="${esc(r.name)}: ${r.max - r.used} of ${r.max} left${r.refill === 'short' ? ', back on a short or long rest' : r.refill === 'long' ? ', back on a long rest' : ''}">${esc(r.name)} ${r.max - r.used}/${r.max}${r.die ? ' ' + esc(r.die) : ''}</button>`).join('')}
        <button class="btn tiny ghost" data-ct="addres" title="Add a resource with a maximum (uses, or a pool of dice)">＋ Resource</button>
        ${gm() ? '<button class="btn tiny ghost" data-ct="senses" title="Every character\'s senses at a glance">👁 Senses</button>' : ''}
        <button class="btn tiny ghost" data-ct="defs" title="Damage resistances, immunities and vulnerabilities, and senses">🛡 ${(() => { const d = (f.defenses || {})[u.charId] || {}; const n = (d.resist || []).length + (d.immune || []).length + (d.vuln || []).length; return n ? `Defences (${n})` : 'Defences'; })()}</button></div>`;
    }
    if (!f.active) html += `<div class="ct-row muted">${gm() ? 'Start initiative in the Combat tab to begin.' : 'Waiting for the GM to start initiative.'}</div>`;
    else if (mine && u) {
      const atks = attacks();
      const spent = bud && !bud.action;
      html += '<div class="ct-row ct-actions" role="group" aria-label="Attacks">';
      for (const a of atks) {
        const n = targets(a).length;
        const slot = a.power ? a.power.use : a.offhand || a.martialBonus ? 'bonus' : 'action';
        const lim = !u.charId && a.res && ((f.npcRes || {})[u.id] || []).find((r) => r.key === a.res);
        const slotSpent = (bud && slot !== 'free' && !bud[slot] && !a.offhand && !a.martialBonus && !(slot === 'action' && !a.power && a.maneuver !== 'help' && bud.attacks)) || (lim && lim.used >= lim.max);   // a weapon attack: also the rest of an Attack action (#139)
        const pool = a.power && Object.entries(a.power.cost || {})[0];
        const poorly = pool && (!u.pools[pool[0]] || u.pools[pool[0]].max - u.pools[pool[0]].used < pool[1]);
        const off = slotSpent || !n || poorly;
        const why = slotSpent ? `Your ${slot === 'bonus' ? 'bonus action' : slot} is used this turn` : poorly ? `Not enough ${pool[0] === 'force' ? 'force' : pool[0] === 'tech' ? 'tech' : pool[0]} points` : !n ? 'Nothing in reach or range' : a.power && a.power.targets === 'self' ? 'Use it on yourself' : 'Pick a target on the map';
        const tag = a.maneuver ? (a.maneuver === 'help' ? '' : sgn(E.contestBonus(u, 'athletics'))) : a.power ? (a.power.attack ? sgn(a.power.attack.bonus) : a.power.save ? `DC ${a.power.save.dc}` : '') : sgn(a.bonus);
        html += `<button class="btn small ct-atk ${a.power ? 'ct-power' : ''} ${UI.armed === a.key ? 'primary' : ''}" data-ct="arm" data-key="${esc(a.key)}" ${off ? 'disabled' : ''} aria-pressed="${UI.armed === a.key}"
          title="${esc(why)}">${esc(a.name)} <b>${esc(tag)}</b> <span class="muted">${esc(a.damage)}${a.type ? ' ' + esc(a.type) : ''} · ${a.power && a.power.targets === 'self' ? 'self' : a.range ? `${a.range[0]}${a.range[1] !== a.range[0] ? '/' + a.range[1] : ''} ft` : `${a.melee} ft`}${pool ? ` · ${pool[1]} ${pool[0] === 'force' ? 'FP' : pool[0] === 'tech' ? 'TP' : pool[0]}` : ''}${slot !== 'action' ? ` · ${slot === 'bonus' ? 'bonus' : slot}` : ''}</span></button>`;
      }
      for (const c of E.COMMON) {
        const used = bud && !bud[c.use];
        html += `<button class="btn small ghost ct-common" data-ct="common" data-key="${esc(c.key)}" ${used ? 'disabled' : ''} title="${esc(used ? `Your ${c.use === 'bonus' ? 'bonus action' : c.use} is used this turn` : c.hint)}">${esc(c.name)}</button>`;
        // a monk's Dash or Disengage as a bonus action (Martial Arts, #67)
        if (u.monk && (c.key === 'dash' || c.key === 'disengage')) html += `<button class="btn small ghost ct-common" data-ct="common" data-key="${esc(c.key)}" data-bonus="1" ${bud && !bud.bonus ? 'disabled' : ''} title="Martial Arts: as a bonus action">${esc(c.name)} (bonus)</button>`;
      }
      const surge = (u.pools || {})['action-surge'];   // a Fighter's Action Surge (#67): free, once a turn, one more action
      if (surge) {
        const why = +E.spentOf(w, u.id).surge ? 'Already surged this turn' : surge.used >= surge.max ? 'No Action Surge left until a short or long rest' : `One more action this turn (${surge.max - surge.used} of ${surge.max} left)`;
        html += `<button class="btn small ghost ct-common" data-ct="common" data-key="surge" ${+E.spentOf(w, u.id).surge || surge.used >= surge.max ? 'disabled' : ''} title="${esc(why)}">⚡ Action Surge</button>`;
      }
      if ((u.riders || {}).rage) {   // a Berserker's Rage (audit 5.9): a bonus action and a use of Rages
        const raging = (u.conditions || []).includes('Raging'), pool = (u.pools || {}).rage, out = pool && pool.used >= pool.max, used = bud && !bud.bonus;
        html += `<button class="btn small ghost ct-common" data-ct="common" data-key="rage" ${raging || out || used ? 'disabled' : ''} title="${esc(raging ? 'Raging: +' + u.riders.rage + ' damage on Strength melee weapon attacks, resistance to kinetic and energy' : out ? 'No rages left until a long rest' : used ? 'Your bonus action is used this turn' : `Bonus action, 1 minute: +${u.riders.rage} damage on Strength melee weapon attacks, resistance to kinetic and energy, advantage on Strength saves`)}">${raging ? '🔥 Raging' : 'Rage'}${pool && pool.max < 99 ? ` <span class="muted">${pool.max - pool.used}/${pool.max}</span>` : ''}</button>`;
      }
      if (gm() && u.charId) html += '<button class="btn small ghost" data-ct="teach" title="Give the table the numbers for one of this character\'s powers">＋ Power data</button>';
      if (!atks.length) html += `<span class="muted">${u.charId ? 'No weapon attacks on this sheet.' : UI.npc[u.id] && UI.npc[u.id].loading ? 'Reading the stat block…' : 'No attacks found in the stat block.'}</span>`;
      if (gm() && !u.charId) html += '<button class="btn small ghost" data-ct="custom">＋ Custom attack</button>';
      html += `<label class="ct-tog"><input type="checkbox" data-ct="adv" ${UI.adv ? 'checked' : ''}> Advantage</label><label class="ct-tog"><input type="checkbox" data-ct="dis" ${UI.dis ? 'checked' : ''}> Disadvantage</label></div>`;
      const spec = armedSpec();
      if (spec && spec.power && spec.power.area) {
        const ab = spec.power, hits = areaPreview();
        const up = ab.upcast && ab.maxLevel > ab.level ? `<label class="ct-tog">Level <select data-ct="upcast">${Array.from({ length: ab.maxLevel - ab.level + 1 }, (_, i) => `<option value="${i}" ${UI.upcast === i ? 'selected' : ''}>${ab.level + i}</option>`).join('')}</select></label>` : '';
        const what = `${ab.area.size} ft ${ab.area.shape}${ab.area.shape === 'line' ? ` (${ab.area.width} ft wide)` : ''}`;
        const names = hits && hits.ok ? hits.units.map((id) => w.units[id].name) : [];
        html += `<div class="ct-row ct-preview" aria-live="polite">${!hits ? `<span>${esc(ab.name)} (${esc(what)}): point at where it goes${ab.area.from === 'point' ? ` (up to ${ab.range ? ab.range[1] : ab.reach} ft away)` : ''}.</span>${up}<button class="btn tiny ghost" data-ct="disarm">Cancel</button>`
          : !hits.ok ? `<span>${esc(hits.why)}</span>${up}`
          : `<span>${esc(ab.name)}, ${esc(what)}: catches ${names.length ? `<b>${esc(names.join(', '))}</b>` : 'no one you can see'}${ab.save ? ` · DC ${ab.save.dc} ${ab.save.ability.toUpperCase()} save${ab.save.onSave === 'half' ? ', half on a success' : ''}` : ''}.</span>${up}<button class="btn small primary" data-ct="go">Use</button>`}</div>`;
      } else if (spec && spec.power) {
        const ab = spec.power, self = ab.targets === 'self';
        const t = self ? u : UI.target && w.units[UI.target];
        const up = ab.upcast && ab.maxLevel > ab.level ? `<label class="ct-tog">Level <select data-ct="upcast">${Array.from({ length: ab.maxLevel - ab.level + 1 }, (_, i) => `<option value="${i}" ${UI.upcast === i ? 'selected' : ''}>${ab.level + i}</option>`).join('')}</select></label>` : '';
        const pv = t && powerPreview(w, u, t, ab);
        html += `<div class="ct-row ct-preview" aria-live="polite">${!t ? `<span>${esc(ab.name)}: pick a target on the map (lit).</span>${up}<button class="btn tiny ghost" data-ct="disarm">Cancel</button>`
          : !pv.legal ? `<span>${esc(pv.why)}</span>` : `<span>${pv.html}</span>${up}<button class="btn small primary" data-ct="go">Use</button>`}</div>`;
        if (self && !UI.target) UI.target = u.id;
      } else if (spec && spec.maneuver) {   // Grapple, Shove, Help (#144)
        const t = UI.target && w.units[UI.target];
        const why = t && (spec.maneuver === 'help' ? helpWhy(u, t) : E.maneuverCheck(w, u, t, spec.maneuver));
        const knows = t && (t.charId || gm());
        const theirs = t && (knows ? `the better of its Athletics ${sgn(E.contestBonus(t, 'athletics'))} and Acrobatics ${sgn(E.contestBonus(t, 'acrobatics'))}` : 'its Athletics or Acrobatics, whichever is better');
        const wins = spec.maneuver === 'grapple' ? 'it is grappled' : spec.push ? 'it is pushed 5 ft away' : 'it is knocked prone';
        html += `<div class="ct-row ct-preview" aria-live="polite">${!t ? `<span>${esc(spec.name)}: pick a creature on the map (lit in red).</span><button class="btn tiny ghost" data-ct="disarm">Cancel</button>`
          : why ? `<span>${esc(why)}</span>`
          : spec.maneuver === 'help' ? `<span><b>${esc(t.name)}</b>: the first attack an ally makes on it before your next turn has advantage. Takes your action.</span><button class="btn small primary" data-ct="go">Help</button>`
          : `<span><b>${esc(t.name)}</b>, ${E.feetBetween(u, t)} ft: your Athletics ${sgn(E.contestBonus(u, 'athletics'))} against ${esc(theirs)}. If you win, ${wins}; a tie changes nothing.</span><button class="btn small primary" data-ct="go">${esc(spec.maneuver === 'grapple' ? 'Grapple' : 'Shove')}</button>`}</div>`;
      } else if (spec) {
        const t = UI.target && w.units[UI.target];
        const pv = t && E.preview(w, u.id, t.id, spec, { adv: UI.adv, dis: UI.dis });
        html += `<div class="ct-row ct-preview" aria-live="polite">${!t ? `<span>${esc(spec.name)}: pick a target on the map (lit in red).</span><button class="btn tiny ghost" data-ct="disarm">Cancel</button>`
          : !pv.legal ? `<span>${esc(pv.why)}</span>`
          : `<span><b>${esc(t.name)}</b>, ${pv.feet} ft: you need <b>${pv.need}+</b> on the d20 (${Math.round(pv.chance * 100)}%)${pv.mode !== 'normal' ? ` · ${E.modeName(pv)}: ${esc(pv.tilts.map((x) => x.text).join(', '))}` : ''}${pv.weak ? ` · weakened: −${pv.weak}` : ''}${(pv.notes || []).length ? ` · ${esc(pv.notes.join('; '))}` : ''}. Hit: ${esc((UI.twoHands && spec.versatile && !pv.ranged ? String(spec.damage).replace(/\d*d\d+/i, spec.versatile) : spec.damage) + (spec.heavy ? '+' + spec.heavy : ''))}${spec.type ? ' ' + esc(spec.type) : ''}${spec.heavy ? ' (heavy)' : ''}.</span>
             ${spec.versatile && !pv.ranged ? `<label class="ct-tog ct-rider" title="Versatile: the weapon in both hands uses the larger die"><input type="checkbox" data-ct="twohands" ${UI.twoHands ? 'checked' : ''}> Two hands (${esc(spec.versatile)})</label>` : ''}
             ${(pv.riders || []).map((x) => x.key === 'fes'
               ? `<label class="ct-tog ct-rider" title="On a melee weapon hit: 1d8 for each force point spent (paid only if it hits)">+ ${esc(x.name)} <select data-ct="fes">${Array.from({ length: x.max + 1 }, (_, i) => `<option value="${i}" ${+((UI.addRiders || {}).fes || 0) === i ? 'selected' : ''}>${i ? `${i}d8 (${i} FP)` : 'none'}</option>`).join('')}</select></label>`
               : x.key === 'maneuver'
               ? `<label class="ct-tog ct-rider" title="A superiority die (${esc(x.die)}), spent on a hit (Precision Attack: when used). One maneuver an attack, each once a turn">Maneuver <select data-ct="maneuver"><option value="">none</option>${x.options.map((o) => `<option value="${esc(o.key)}" ${(UI.addRiders || {}).maneuver === o.key ? 'selected' : ''}>${esc(o.name)} (+1${esc(x.die)}${o.save ? `, ${o.save.toUpperCase()} save DC ${o.dc}` : ''})</option>`).join('')}</select></label>`
               : x.key === 'double'
               ? `<label class="ct-tog ct-rider" title="On a weapon hit, once a turn: 1 force point for a Kinetic Combat die (paid only if it hits)"><input type="checkbox" data-ct="rider-add" data-key="double" ${(UI.addRiders || {}).double ? 'checked' : ''}> + ${esc(x.name)} ${esc(x.dice)} (1 FP)</label>`
               : `<label class="ct-tog ct-rider" title="${esc(x.key === 'sneak' ? 'Once per turn, on a hit: the same type as the weapon' : 'While raging, on a Strength melee weapon hit')}"><input type="checkbox" data-ct="rider" data-key="${esc(x.key)}" ${(UI.noRiders || []).includes(x.key) ? '' : 'checked'}> + ${esc(x.name)} ${esc(x.dice || '+' + x.flat)}</label>`).join('')}
             <button class="btn small primary" data-ct="go">Attack</button>`}</div>`;
      } else if (bud && bud.moveLeft > 0) html += `<div class="ct-row muted ct-hint">Tap a lit square to move there, or pick an attack.</div>`;
    }
    b.innerHTML = html;
  }
  function onBarChange(e) {
    const el = e.target.closest('[data-ct=upcast]');
    if (el) { UI.upcast = +el.value || 0; render(); }
    const fes = e.target.closest('[data-ct=fes]');   // Force-Empowered Strikes: how many force points to spend on a hit
    if (fes) { UI.addRiders = Object.assign({}, UI.addRiders, { fes: +fes.value || 0 }); render(); }
    const mvSel = e.target.closest('[data-ct=maneuver]');   // a maneuver for this attack (#67)
    if (mvSel) { UI.addRiders = Object.assign({}, UI.addRiders, { maneuver: mvSel.value || '' }); render(); }
  }
  function onBar(e) {
    const el = e.target.closest('[data-ct]');
    if (!el) return;
    const k = el.dataset.ct;
    if (k === 'on' || k === 'off') return send('fight.toggle', { on: k === 'on' });
    if (k === 'undo') return send('fight.undo', {});
    if (k === 'end') { UI.armed = UI.target = null; return send('fight.end', {}); }
    if (k === 'stand') return send('fight.stand', {});
    if (k === 'douse') return send('fight.douse', { target: el.dataset.id });
    if (k === 'escape') { const u = cur(); return send('fight.escape', { skill: u && E.contestBonus(u, 'athletics') > E.contestBonus(u, 'acrobatics') ? 'athletics' : 'acrobatics' }); }
    if (k === 'release') return send('fight.release', { target: el.dataset.id });
    if (k === 'common') return send('fight.common', Object.assign({ key: el.dataset.key }, el.dataset.bonus ? { asBonus: true } : {}));
    if (k === 'deathsave') return send('fight.deathsave', {});
    if (k === 'legend') return send('fight.npcres', { id: el.dataset.unit, op: 'use', key: 'legendary', n: +el.dataset.n || 1 });
    if (k === 'npcres') {
      const r = ((F().npcRes || {})[el.dataset.unit] || []).find((x) => x.key === el.dataset.key);
      if (!r) return;
      const box = r.points && el.parentNode.querySelector(`[data-pts="${CSS.escape(r.key)}"]`), n = box ? Math.max(1, Math.min(r.max - r.used, Math.round(+box.value) || 1)) : 1;
      return send('fight.npcres', { id: el.dataset.unit, key: r.key, op: r.used >= r.max ? 'reset' : 'use', n });
    }
    if (k === 'log') { UI.log = !UI.log; return render(); }

    if (k === 'letgo') return send('fight.react', { id: el.dataset.id, take: false });
    if (k === 'react') {
      const re = world().units[el.dataset.unit], a = re && reactOptions(re, el.dataset.kind).find((x) => x.key === el.dataset.key);
      if (!a) return;
      return send('fight.react', { id: el.dataset.id, take: true, attack: re.charId ? a.key : specOut(a) });
    }
    if (k === 'cond') return conditionModal();
    if (k === 'uncond') { const u = cur(); return u && send('fight.condition', { unit: u.id, condition: el.dataset.c, op: 'remove' }); }
    if (k === 'custom') return customAttack(el.dataset.unit ? world().units[el.dataset.unit] : null);
    if (k === 'pool') return poolModal(el.dataset.key);
    if (k === 'addres') return resourceModal();
    if (k === 'defs') return defencesModal();
    if (k === 'senses') return sensesTable();
    if (k === 'arm') { UI.armed = UI.armed === el.dataset.key ? null : el.dataset.key; UI.target = null; UI.upcast = 0; render(); return H.drawMap(); }
    if (k === 'disarm') { UI.armed = UI.target = UI.aim = null; render(); return H.drawMap(); }
    if (k === 'adv' || k === 'dis') { UI[k] = el.checked; return render(); }
    if (k === 'twohands') { UI.twoHands = el.checked; return render(); }
    if (k === 'rider-add') { UI.addRiders = Object.assign({}, UI.addRiders, { [el.dataset.key]: el.checked }); return render(); }
    if (k === 'rider') { const no = new Set(UI.noRiders || []); if (el.checked) no.delete(el.dataset.key); else no.add(el.dataset.key); UI.noRiders = [...no]; return render(); }
    if (k === 'teach') return teachModal();
    if (k === 'go' && (UI.target || UI.aim)) return attack(UI.target);
    if (k === 'measure') { UI.ruler = UI.ruler ? null : { a: null, b: null }; render(); return H.drawMap(); }
  }

  /* ---------------- teaching the table a power's numbers (issue #73) ---------------- */
  const ABN = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };
  // a first guess from the description on the sheet: dice and damage type, the save, the range; the GM checks it
  function suggest(pw) {
    const t = String(pw.description || '') + ' ' + String(pw.notes || '');
    const dmg = /(\d+d\d+)(?:\s*\+\s*your [a-z]+ modifier)?\s+([a-z]+)\s+damage/i.exec(t);
    const sv = /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/i.exec(t);
    const rg = /range[^0-9]{0,12}(\d+)\s*(?:feet|ft)/i.exec(t) || /within (\d+) feet/i.exec(t);
    const up = /(?:higher level|each (?:slot )?level above)[^.]*?(\d+d\d+)/i.exec(t);
    return {
      use: /bonus action/i.test(t) ? 'bonus' : /reaction/i.test(t) && !/action/i.test(t.replace(/reaction/ig, '')) ? 'reaction' : 'action',
      range: rg ? +rg[1] : /\bself\b/i.test(t) ? 'self' : 30,
      roll: /power attack/i.test(t) ? 'attack' : sv ? 'save' : 'none', saveAb: sv ? ABN[sv[1].toLowerCase()] : 'dex', half: /half as much/i.test(t),
      dice: dmg ? dmg[1] : '', type: dmg ? dmg[2].toLowerCase() : '', heal: /regains?.{0,30}hit points/i.test(t) && !dmg ? ((/(\d+d\d+)/.exec(t) || [])[1] || '') : '',
      upcast: up ? up[1] : '', concentration: /concentration/i.test(t),
    };
  }
  function teachModal() {
    const u = cur(), ch = u && st().characters[u.charId];
    if (!ch) return;
    const lib = F().lib || {};
    const pws = (ch.powers || []).filter((p) => p.name);
    if (!pws.length) return toast(`${u.name} has no powers on the sheet.`, true);
    const pick = pws.find((p) => !lib[p.name.toLowerCase()]) || pws[0];
    const draw = (pw) => {
      const have = lib[pw.name.toLowerCase()], g = suggest(pw);
      const v = have ? { use: have.use, range: have.targets === 'self' ? 'self' : have.range ? have.range[0] : have.reach || 5, roll: have.attack ? 'attack' : have.save ? 'save' : 'none',
        saveAb: have.save ? have.save.ability : 'dex', half: !!(have.save && have.save.onSave === 'half'), dice: (have.damage[0] || {}).dice || '', type: (have.damage[0] || {}).type || '',
        heal: have.heal ? have.heal.dice : '', upcast: have.upcast ? have.upcast.damage : '', concentration: have.concentration } : g;
      const opt = (val, cur, label) => `<option value="${esc(val)}" ${String(val) === String(cur) ? 'selected' : ''}>${label}</option>`;   // raw value compared, escaped when written
      H.modal(`<h3>Power data</h3>
        <p class="muted">The numbers the combat view uses for one of ${esc(u.name)}'s powers. ${have ? 'The table already has data for this one.' : 'A first guess from its description on the sheet: check it before saving.'} Without data, a power still works from the sheet as before.</p>
        <label>Power <select id="ctkPw">${pws.map((p) => opt(p.name, pw.name, `${esc(p.name)}${lib[p.name.toLowerCase()] ? ' ✓' : ''}`)).join('')}</select></label>
        <div class="row2"><label>Takes <select id="ctkUse">${opt('action', v.use, 'an action')}${opt('bonus', v.use, 'a bonus action')}${opt('reaction', v.use, 'a reaction')}</select></label>
        <label>Range (ft), or "self" <input id="ctkRange" value="${esc(v.range)}"></label></div>
        <div class="row2"><label>Roll <select id="ctkRoll">${opt('attack', v.roll, 'an attack roll')}${opt('save', v.roll, 'a saving throw')}${opt('none', v.roll, 'none')}</select></label>
        <label>Save <select id="ctkSave">${['str', 'dex', 'con', 'int', 'wis', 'cha'].map((a) => opt(a, v.saveAb, a.toUpperCase())).join('')}</select></label></div>
        <label class="check"><input type="checkbox" id="ctkHalf" ${v.half ? 'checked' : ''}> Half damage on a successful save</label>
        <div class="row2"><label>Damage dice <input id="ctkDice" value="${esc(v.dice)}" placeholder="2d6"></label><label>Damage type <input id="ctkType" value="${esc(v.type)}" placeholder="force"></label></div>
        <div class="row2"><label>Healing dice (instead of damage) <input id="ctkHeal" value="${esc(v.heal)}" placeholder="1d8"></label><label>Extra dice per level higher <input id="ctkUp" value="${esc(v.upcast)}" placeholder="1d6"></label></div>
        <label class="check"><input type="checkbox" id="ctkConc" ${v.concentration ? 'checked' : ''}> Concentration</label>
        <div class="row">${have ? '<button class="btn danger" id="ctkDel">Forget it</button>' : ''}<span class="spacer"></span><button class="btn" id="ctkCancel">Cancel</button><button class="btn primary" id="ctkOk">Save</button></div>`, (box) => {
        $('#ctkPw', box).onchange = (e) => draw(pws.find((p) => p.name === e.target.value) || pw);
        $('#ctkCancel', box).onclick = H.closeModal;
        if (have) $('#ctkDel', box).onclick = async () => { H.closeModal(); await send('fight.ability', { name: pw.name, data: null }); };
        $('#ctkOk', box).onclick = async () => {
          const rg = $('#ctkRange', box).value.trim().toLowerCase(), roll = $('#ctkRoll', box).value;
          const data = { use: $('#ctkUse', box).value, targets: rg === 'self' ? 'self' : 1, concentration: $('#ctkConc', box).checked,
            range: rg !== 'self' && +rg > 5 ? [+rg, +rg] : null, reach: rg !== 'self' && +rg <= 5 ? 5 : null,
            attack: roll === 'attack' ? { bonus: 'power' } : null, save: roll === 'save' ? { ability: $('#ctkSave', box).value, dc: 'power', onSave: $('#ctkHalf', box).checked ? 'half' : 'none' } : null,
            damage: $('#ctkDice', box).value.trim() ? [{ dice: $('#ctkDice', box).value.trim(), type: $('#ctkType', box).value.trim() }] : [],
            heal: $('#ctkHeal', box).value.trim() ? { dice: $('#ctkHeal', box).value.trim(), add: null } : null,
            upcast: $('#ctkUp', box).value.trim() ? { damage: $('#ctkUp', box).value.trim() } : null };
          H.closeModal();
          await send('fight.ability', { name: pw.name, data });
        };
      });
    };
    draw(pick);
  }

  /* ---------------- a character's damage defences (audit 5.10) ---------------- */
  // Every character's senses, for the GM, at any time and with the combat view on or off: players set their own, as
  // they do HP and AC, and the GM sees them all here and corrects any (under fog and light they decide what a player sees)
  async function sensesTable() {
    if (!gm()) return;
    // the sheets' senses (#92), which the GM's screen already has: opening the table writes nothing
    const chars = Object.values(st().characters || {}).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const got = { senses: Object.fromEntries(chars.map((c) => [c.id, Array.isArray(c.senses) ? c.senses : []])) };
    if (!chars.length) return H.toast('No characters at the table yet.');
    const val = (id, k) => ((got.senses[id] || []).find((x) => x.kind === k) || {}).range || '';
    const owner = (c) => ((st().players || {})[c.owner] || {}).name || '';
    H.modal(`<h3>👁 Senses</h3>
      <p class="muted">Every character's senses, in feet (blank for none), as on their sheets. They're yours to set: a species fills them, players see them but can't change them, and under fog and light they decide what each player sees.</p>
      <table class="ct-senses"><tr><th></th>${E.SENSES.map((k) => `<th>${esc(k)}</th>`).join('')}</tr>
        ${chars.map((c) => `<tr data-char="${esc(c.id)}"><td><b>${esc(c.name)}</b>${owner(c) ? ` <span class="muted">· ${esc(owner(c))}</span>` : ''}</td>${E.SENSES.map((k) => `<td><input type="number" min="0" max="9999" step="5" data-sense="${k}" value="${val(c.id, k)}" aria-label="${esc(c.name)} ${k}"></td>`).join('')}</tr>`).join('')}
      </table>
      <div class="row"><span class="spacer"></span><button class="btn" id="ctsCancel">Cancel</button><button class="btn primary" id="ctsOk">Save</button></div>`, (box) => {
      $('#ctsCancel', box).onclick = H.closeModal;
      $('#ctsOk', box).onclick = async () => {
        const rows = [...box.querySelectorAll('tr[data-char]')].map((tr) => [tr.dataset.char, [...tr.querySelectorAll('input[data-sense]')].map((x) => ({ kind: x.dataset.sense, range: +x.value || 0 })).filter((x) => x.range > 0)]);
        H.closeModal();
        for (const [id, senses] of rows) {   // only the ones that changed, one after another
          const was = (got.senses[id] || []).map((x) => `${x.kind}:${x.range}`).sort().join(), now = senses.map((x) => `${x.kind}:${x.range}`).sort().join();
          if (was !== now) await act('fight.senses', { op: 'set', charId: id, senses });
        }
      };
    });
  }
  function defencesModal() {
    const u = cur();
    if (!u || !u.charId) return;
    const d = (F().defenses || {})[u.charId] || {}, on = (list, t) => (d[list] || []).some((x) => x.type === t);
    const row = (list, label) => `<div class="lbl">${label}</div><div class="ct-types">${E.DAMAGE.map((t) => `<label class="check"><input type="checkbox" data-l="${list}" value="${t}" ${on(list, t) ? 'checked' : ''}> ${t}</label>`).join('')}</div>`;
    const sheet = (st().characters || {})[u.charId] || {}, sense = (k) => (((Array.isArray(sheet.senses) && sheet.senses) || []).find((x) => x.kind === k) || {}).range || '';   // the sheet's (#92)
    H.modal(`<h3>${esc(u.name)}: defences and senses</h3>
      <p class="muted">Applied when ${esc(u.name)} takes damage in the combat view: resisted is halved, immune is ignored, vulnerable is doubled.</p>
      ${row('resist', 'Resistant to')}${row('immune', 'Immune to')}${row('vuln', 'Vulnerable to')}
      ${gm() ? `<div class="lbl">Senses, in feet (blank for none)</div><div class="row2">${E.SENSES.map((k) => `<label>${k} <input type="number" min="0" max="9999" step="5" data-sense="${k}" value="${sense(k)}"></label>`).join('')}</div>`
        : `<div class="lbl">Senses <span class="muted">· the GM sets these</span></div><p>${esc((R && R.sensesText ? R.sensesText(sheet.senses) : '') || 'None')}</p>`}
      <div class="row"><span class="spacer"></span><button class="btn" id="ctdCancel">Cancel</button><button class="btn primary" id="ctdOk">Save</button></div>`, (box) => {
      $('#ctdCancel', box).onclick = H.closeModal;
      $('#ctdOk', box).onclick = async () => {
        const pick = (l) => [...box.querySelectorAll(`input[data-l=${l}]:checked`)].map((x) => x.value);
        H.closeModal();
        const senses = [...box.querySelectorAll('input[data-sense]')].map((x) => ({ kind: x.dataset.sense, range: +x.value || 0 })).filter((x) => x.range > 0);
        await send('fight.defenses', Object.assign({ charId: u.charId, resist: pick('resist'), immune: pick('immune'), vuln: pick('vuln') }, gm() ? { senses } : {}));
      };
    });
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

  // The DM's form: a condition on any combatant, asking for a level (Slowed, Corroded), a damage amount (Ignited), and
  // optionally who caused it (it matters for Charmed and Grappled). It lasts until the DM takes it off.
  function conditionModal() {
    const w = world(), u = cur();
    const units = Object.values(w.units);
    const names = Array.from(new Set(Object.keys(R.CONDITIONS || {}).concat(Object.keys(E.CONDITION_EFFECTS), ['Deafened', 'Diseased']))).filter((c) => c !== 'Exhaustion').sort();
    const opts = (sel) => units.map((x) => `<option value="${esc(x.id)}" ${sel === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    H.modal(`<h3>Put a condition on</h3>
      <label>Who <select id="ctkUnit">${opts(u ? u.id : '')}</select></label>
      <label>Condition <select id="ctkCond">${names.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
      <label id="ctkLvlRow" hidden>Level <select id="ctkLvl"></select></label>
      <label id="ctkAmtRow" hidden>Fire damage at the end of each of its turns <input id="ctkAmt" maxlength="20" placeholder="1d6"></label>
      <label>Caused by <span class="muted">(optional; a charm or a grapple with a cause ends properly)</span> <select id="ctkSrc"><option value="">nobody recorded</option>${opts('')}</select></label>
      <p class="muted">It lasts until you take it off (✕ on its chip). Slowed and Corroded add to any level already there.</p>
      <div class="row"><span class="spacer"></span><button class="btn" id="ctkCancel">Cancel</button><button class="btn primary" id="ctkOk">Put it on</button></div>`, (box) => {
      const sync = () => {
        const c = $('#ctkCond', box).value, top = (E.LEVELS || {})[c];
        $('#ctkLvlRow', box).hidden = !top; $('#ctkAmtRow', box).hidden = c !== 'Ignited';
        if (top) $('#ctkLvl', box).innerHTML = Array.from({ length: top }, (_, i) => `<option>${i + 1}</option>`).join('');
      };
      $('#ctkCond', box).onchange = sync; sync();
      $('#ctkCancel', box).onclick = H.closeModal;
      $('#ctkOk', box).onclick = async () => {
        const c = $('#ctkCond', box).value;
        if (c === 'Ignited' && !$('#ctkAmt', box).value.trim()) return toast('How much fire damage? Like 1d6, or 5.', true);
        H.closeModal();
        await send('fight.condition', { unit: $('#ctkUnit', box).value, condition: c, level: (E.LEVELS || {})[c] ? +$('#ctkLvl', box).value : 0,
          amount: c === 'Ignited' ? $('#ctkAmt', box).value.trim() : '', source: $('#ctkSrc', box).value || null });
      };
    });
  }

  /* ---------------- on the map (app.js calls these) ---------------- */
  // pointer down: claims the click only when it's an attack on a target, or a player's own token on their turn
  // Import a Universal VTT file (Dungeondraft's "export for other tabletops", .dd2vtt): its picture becomes the map's
  // background (shrunk under HoloTable's image limit, through its own upload), the board takes its size in squares, and
  // its line-of-sight polylines become walls and its portals doors (open or closed as exported). Lights are ignored.
  async function importUvtt(file) {
    const toast = H.toast;
    try {
      const d = JSON.parse(await file.text());
      const res = d && d.resolution, size = res && res.map_size, o = (res && res.map_origin) || { x: 0, y: 0 };
      if (!size || !(+size.x > 0) || !(+size.y > 0)) throw new Error("That isn't a Universal VTT file (no map size).");
      const pt = (q) => [(+q.x || 0) - (+o.x || 0), (+q.y || 0) - (+o.y || 0)];
      const walls = [];
      for (const line of [].concat(d.line_of_sight || [], d.objects_line_of_sight || [])) {
        if (!Array.isArray(line)) continue;
        for (let i = 0; i + 1 < line.length; i++) walls.push({ a: pt(line[i]), b: pt(line[i + 1]), kind: 'wall' });
      }
      for (const door of d.portals || []) {
        if (door && Array.isArray(door.bounds) && door.bounds.length >= 2) walls.push({ a: pt(door.bounds[0]), b: pt(door.bounds[1]), kind: 'door', open: door.closed === false });
      }
      const had = ((st().map || {}).walls || []).length || st().map.bgUrl;
      if (had && !confirm(`Replace this map's picture, size and walls with ${file.name}?`)) return;
      toast('Importing the map…');
      if (d.image) {
        const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("Couldn't read the map's picture.")); i.src = `data:image/png;base64,${String(d.image).replace(/^data:[^,]*,/, '')}`; });
        let dataUrl = '';
        for (const [dim, q] of [[4096, 0.85], [4096, 0.7], [3072, 0.7], [2048, 0.7]]) {
          const sc = Math.min(1, dim / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          dataUrl = c.toDataURL('image/jpeg', q);
          if (dataUrl.length * 0.75 < 2.9 * 1024 * 1024) break;
        }
        const up = await H.post('upload', { purpose: 'bg', dataUrl });
        await act('map.bg', { url: up.url });
      }
      await act('map.settings', { cols: Math.max(5, Math.min(200, Math.round(+size.x))), rows: Math.max(5, Math.min(200, Math.round(+size.y))) });
      await wallSend({ op: 'set', walls: walls.slice(0, 2000) });
      // its lights (#93 step 5): Universal VTT gives one range in squares; the inner half is bright, the rest dim
      const lights = (Array.isArray(d.lights) ? d.lights : []).filter((l) => l && l.position && +l.range > 0).slice(0, 200).map((l) => {
        const [x, y] = pt(l.position), feet = Math.round(+l.range * 5), bright = Math.round(feet / 2 / 5) * 5;
        return { x, y, bright, dim: Math.max(0, feet - bright) };
      });
      if (lights.length) await wallSend({ op: 'set', lights }, 'fight.light');
      toast(`Imported ${file.name}: ${Math.min(2000, walls.length)} walls and doors${walls.length > 2000 ? ' (the first 2000)' : ''}${lights.length ? `, ${lights.length} light${lights.length === 1 ? '' : 's'}` : ''}.`);
    } catch (err) { toast(err.message || "Couldn't import that file.", true); }
  }
  // The GM's wall tool lives in the map tools beside "＋ Token" (app.js asks for its button), with its own row under
  // the map tools: walls, doors, windows, lights, the map's light level and fog.
  function wallsButton() {
    return gm() ? `<button class="btn small ${UI.walls ? 'primary' : ''}" data-ct-walls="1" aria-pressed="${!!UI.walls}" title="Draw walls, doors and windows: they block movement, sight and areas in the combat view (players never receive them)">🧱 Walls</button>` : '';
  }
  let wallBar = null;
  function renderWallBar() {
    if (!wallBar) {
      wallBar = document.createElement('div');
      wallBar.className = 'ct-wallbar hidden';
      // a row of its own between the map tools and the map, so it never covers any of the board
      const pane = $('#pane-map'), body = pane && pane.querySelector('.map-body');
      if (body) pane.insertBefore(wallBar, body); else $('#mapWrap').appendChild(wallBar);
      wallBar.addEventListener('change', (e) => {
        if (e.target.matches('[data-wb-level]')) { wallSend({ level: e.target.value }, 'fight.light'); return; }
        if (e.target.matches('[data-wb-radius]')) { UI.lightSize = e.target.value; return; }
        const f = e.target.matches('[data-wb-file]') && e.target.files[0]; if (f) importUvtt(f).finally(() => { e.target.value = ''; });
      });
      wallBar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-wb]'); if (!b) return;
        const a = b.dataset.wb;
        if (a === 'senses') { sensesTable(); return; }
        if (a === 'fog' || a === 'shared' || a === 'reset') {   // fog of war (#93 step 4)
          const fog = (st().map || {}).fog || {};
          if (a === 'reset' && !confirm('Forget what the players have explored on this map?')) return;
          wallSend(a === 'fog' ? { on: !fog.on } : a === 'shared' ? { shared: !fog.shared } : { reset: true }, 'fight.fog');
          return;
        }
        if (a === 'done') UI.walls = null;
        else if (a === 'clear') { if (confirm('Remove every wall, door and window from this map?')) wallSend({ op: 'clear' }); return; }
        else UI.walls = { mode: a, from: null };
        renderWallBar(); render(); H.drawMap();
      });
    }
    if (UI.walls && !gm()) UI.walls = null;
    wallBar.classList.toggle('hidden', !UI.walls);
    if (!UI.walls) { wallBar.innerHTML = ''; return; }
    const n = ((st().map || {}).walls || []).length, T = UI.walls;
    wallBar.innerHTML = `<b>🧱 Walls</b>${[['wall', 'Wall'], ['door', 'Door'], ['window', 'Window'], ['toggle', 'Open / close'], ['erase', 'Erase']].map(([k, l]) => `<button class="btn tiny ${T.mode === k ? 'primary' : 'ghost'}" data-wb="${k}">${l}</button>`).join('')}
      <span class="muted" title="${T.mode === 'wall' ? 'Click corner to corner; Esc or the same corner again ends a run' : T.mode === 'door' || T.mode === 'window' ? 'Click its two ends' : 'Click next to one'}">${n} on this map</span>
      ${n ? '<button class="btn tiny ghost" data-wb="clear">Clear walls</button>' : ''}
      <label class="btn tiny ghost" title="Dungeondraft's export for other tabletops (Universal VTT): the picture, the board size, its walls and doors">Import .dd2vtt<input type="file" accept=".dd2vtt,.uvtt,.df2vtt,application/json" data-wb-file hidden></label>
      <span class="ct-fogctl">${(() => { const light = (st().map || {}).light || {}, lv = light.level || 'bright';
        return `<select class="ct-lightlv" data-wb-level title="The map's own light: bright changes nothing; dim and dark limit what players see under fog">${[['bright', '☀ Bright'], ['dim', '🌗 Dim'], ['dark', '🌑 Dark']].map(([k, l]) => `<option value="${k}" ${lv === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`
          + `<button class="btn tiny ${T.mode === 'light' ? 'primary' : 'ghost'}" data-wb="light" title="Click to place a light; Erase removes one">💡 Light</button>`
          + `<select data-wb-radius title="Bright / dim radius in feet">${LIGHT_SIZES.map(([b, d, l]) => `<option value="${b}/${d}" ${UI.lightSize === `${b}/${d}` ? 'selected' : ''}>${l}</option>`).join('')}</select>`; })()}</span>
      <span class="ct-fogctl">${(() => { const fog = (st().map || {}).fog || {}; return `<button class="btn tiny ${fog.on ? 'primary' : 'ghost'}" data-wb="fog" aria-pressed="${!!fog.on}" title="Each player sees only what their characters can see through the walls; the rest of the map is dark">🌫 Fog ${fog.on ? 'on' : 'off'}</button>`
        + (fog.on ? `<button class="btn tiny ${fog.shared ? 'primary' : 'ghost'}" data-wb="shared" aria-pressed="${!!fog.shared}" title="Every player sees what any character sees">Shared sight</button><button class="btn tiny ghost" data-wb="reset">Reset explored</button>` : ''); })()}</span>
      <button class="btn tiny ghost" data-wb="senses" title="Every character's senses: darkvision and the rest decide what each player sees under fog and light">👁 Senses</button>
      <button class="btn tiny" data-wb="done">Done</button>`;
  }
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-ct-walls]')) return;
    UI.walls = UI.walls ? null : { mode: 'wall', from: null };
    renderWallBar(); render(); H.drawMap();
    const b = e.target.closest('[data-ct-walls]'); b.classList.toggle('primary', !!UI.walls); b.setAttribute('aria-pressed', String(!!UI.walls));
  });
  // the GM's wall tool (issue #93): click corner to corner; door and window are one segment each; erase or open/close
  // by clicking next to one. Escape (or clicking the last corner again) ends a run of walls.
  const nearestWall = (gx, gy, kinds) => {
    let best = null, bd = 0.35;
    for (const wl of ((st().map || {}).walls || [])) {
      if (kinds && !kinds.includes(wl.kind)) continue;
      const [ax, ay] = wl.a, [bx, by] = wl.b, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((gx - ax) * dx + (gy - ay) * dy) / L)), d = Math.hypot(gx - (ax + t * dx), gy - (ay + t * dy));
      if (d < bd) { bd = d; best = wl; }
    }
    return best;
  };
  // wall edits go out one after another, never dropped: a GM draws faster than a save comes back from real hosting
  // (the one-at-a-time guard on other actions would swallow the next segment)
  let wallChain = Promise.resolve();
  const wallSend = (p, type) => (wallChain = wallChain.then(() => act(type || 'fight.wall', p)).catch(() => null));
  // lights (#93 step 5): a click places one at the centre of the square; Erase removes the nearest within half a square
  const LIGHT_SIZES = [[5, 5, 'Candle 5/5'], [10, 10, 'Fire 10/10'], [20, 20, 'Glow rod 20/20'], [30, 30, 'Lamp 30/30'], [60, 60, 'Floodlight 60/60']];
  const nearestLight = (gx, gy) => (((st().map || {}).light || {}).lights || []).find((l) => Math.hypot(l.x - gx, l.y - gy) < 0.6) || null;
  function wallClick(gx, gy) {
    const T = UI.walls, pt = [Math.round(gx), Math.round(gy)];
    if (T.mode === 'light') {
      const [b, d] = String(UI.lightSize || '20/20').split('/').map(Number);
      wallSend({ op: 'add', x: Math.floor(gx) + 0.5, y: Math.floor(gy) + 0.5, bright: b, dim: d }, 'fight.light'); return;
    }
    if (T.mode === 'erase') { const lt = nearestLight(gx, gy); if (lt) { wallSend({ op: 'remove', id: lt.id }, 'fight.light'); return; } const wl = nearestWall(gx, gy); if (wl) wallSend({ op: 'remove', id: wl.id }); return; }
    if (T.mode === 'toggle') { const wl = nearestWall(gx, gy, ['door']); if (wl) wallSend({ op: 'door', id: wl.id, open: !wl.open }); return; }
    if (!T.from) { T.from = pt; H.drawMap(); return; }
    if (T.from[0] === pt[0] && T.from[1] === pt[1]) { T.from = null; H.drawMap(); return; }
    wallSend({ op: 'add', a: T.from, b: pt, kind: T.mode });
    T.from = T.mode === 'wall' ? pt : null;
    H.drawMap();
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && UI.walls && UI.walls.from) { UI.walls.from = null; H.drawMap(); } });
  function down(gx, gy, e) {
    if (UI.walls && gm()) { wallClick(gx, gy); return true; }   // the wall tool works with the combat view off too
    if (!F().on) return false;
    if (UI.ruler) {   // two taps (or a click and a click): from here to there
      if (!UI.ruler.a || UI.ruler.b) UI.ruler = { a: { x: gx, y: gy }, b: null, live: { x: gx, y: gy } };
      else UI.ruler.b = { x: gx, y: gy };
      H.drawMap(); return true;
    }
    if (!myTurn()) return false;
    const spec = armedSpec();
    if (spec && spec.power && spec.power.area) {
      UI.aim = aimAt(spec.power, gx, gy); render(); H.drawMap();
      if (e.pointerType === 'mouse') { const h = areaPreview(); if (h && h.ok) attack(null); }
      return true;
    }
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
    if (UI.walls && gm()) { UI.walls.live = [Math.round(gx), Math.round(gy)]; if (UI.walls.from) H.drawMap(); return; }
    if (!F().on) return;
    if (UI.ruler && UI.ruler.a && !UI.ruler.b) { UI.ruler.live = { x: gx, y: gy }; H.drawMap(); return; }
    if (!myTurn()) return;
    const spec = armedSpec();
    if (spec && spec.power && spec.power.area) { const a = aimAt(spec.power, gx, gy); if (!UI.aim || a.x !== UI.aim.x || a.y !== UI.aim.y) { UI.aim = a; render(); H.drawMap(); } return; }
    if (!UI.armed) {   // the cost of a lit square
      const k = `${Math.floor(gx)},${Math.floor(gy)}`, c = reach()[k];
      if ((c === undefined ? null : k) !== (UI.hoverSq && UI.hoverSq.k)) { UI.hoverSq = c === undefined ? null : { k, c }; H.drawMap(); }
      return;
    }
    const t = unitAt(gx, gy), id = t && t.id !== (cur() || {}).id ? t.id : null;
    if (id !== UI.target && (id || UI.target)) { UI.target = id; render(); H.drawMap(); }
  }
  function cssVar(name, fallback) { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback; }
  const alpha = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };
  // under the tokens: the squares you can reach
  /* ---------------- fog of war (#93 step 4): the server sends each player their visible and explored squares ---------------- */
  // drawn as a picture one pixel per square, scaled up without smoothing, and rebuilt only when the squares change
  let fogPic = null;
  function fogPicture(fog) {
    const key = [fog.cols, fog.rows, fog.vis, fog.seen, fog.any, fog.dim, fog.dark, fog.dimLit].join('|');
    if (fogPic && fogPic.key === key) return fogPic.canvas;
    const n = fog.cols * fog.rows, c = document.createElement('canvas'); c.width = fog.cols; c.height = fog.rows;
    const cx = c.getContext('2d'), im = cx.createImageData(fog.cols, fog.rows);
    const shade = cssVar('--bg', '#05080d').replace('#', ''), rgb = [0, 2, 4].map((i) => parseInt(shade.slice(i, i + 2), 16) || 0);
    const un = (k) => (fog[k] ? E.unpackSquares(fog[k], n) : null);
    const vis = un('vis'), seen = un('seen'), any = un('any'), dim = un('dim'), dark = un('dark'), dimLit = un('dimLit');
    for (let i = 0; i < n; i++) {
      // a player: black where never seen, dim where explored, clear where seen now (a light veil where it's seen only
      // dimly); the GM: a light veil where no player sees, deeper where the light doesn't reach
      const a = any ? Math.max(any[i] ? 0 : 70, dark && dark[i] ? 125 : dimLit && dimLit[i] ? 60 : 0)
        : vis[i] ? (dim && dim[i] ? 95 : 0) : seen[i] ? 150 : 250;
      im.data.set([rgb[0], rgb[1], rgb[2], a], i * 4);
    }
    cx.putImageData(im, 0, 0);
    fogPic = { key, canvas: c };
    return c;
  }
  function drawFog(ctx, g) {
    const fog = st().fog;   // the map's fog (#93): sent at the top of the state, combat view or not
    if (!fog || !(fog.vis || fog.any)) return;
    ctx.save(); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(fogPicture(fog), 0, 0, fog.cols * g, fog.rows * g);
    ctx.restore();
  }
  function under(ctx, g, z) {
    drawFog(ctx, g);
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
  const SENSE_HINT = { blindsight: 'Perceives without sight within this range: being blinded doesn\'t hold it back, and it finds invisible creatures',
    truesight: 'Sees invisible creatures within this range', tremorsense: 'Treated like blindsight within this range (SW5e\'s books don\'t define it)',
    darkvision: 'Sees in the dark within this range (lighting isn\'t on the map yet)' };
  // two letters for a condition on a token's badge (the chip in the bar and the token's tooltip have the full name)
  const ABBR = { Incapacitated: 'Ic', Invisible: 'Iv', Petrified: 'Pe', Paralyzed: 'Pa', Poisoned: 'Po', Deafened: 'De', Diseased: 'Di', Stunned: 'St', Slowed: 'Sl', Shocked: 'Sh' };
  const abbr = (c) => ABBR[c] || String(c).slice(0, 2);
  // the GM's walls (wall, door: a gap when open, window), and the segment being drawn; with the combat view on or off
  function drawWalls(ctx, g, z) {
    if (gm()) for (const l of (((st().map || {}).light || {}).lights || [])) {   // the GM's lights: a lamp and its reach
      const cx = l.x * g, cy = l.y * g, amber = cssVar('--amber', '#ffb74d');
      ctx.beginPath(); ctx.arc(cx, cy, ((l.bright + l.dim) / 5) * g, 0, Math.PI * 2); ctx.strokeStyle = alpha(amber, UI.walls ? 0.45 : 0.18); ctx.lineWidth = 1 / z; ctx.setLineDash([4 / z, 6 / z]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(4 / z, g * 0.14), 0, Math.PI * 2); ctx.fillStyle = alpha(amber, 0.9); ctx.fill();
    }
    const walls = gm() ? ((st().map || {}).walls || []) : [];
    if (walls.length || (UI.walls && gm())) {
      const lw = (UI.walls ? 5 : 3) / Math.min(1, z);
      for (const wl of walls) {
        ctx.beginPath(); ctx.moveTo(wl.a[0] * g, wl.a[1] * g); ctx.lineTo(wl.b[0] * g, wl.b[1] * g);
        ctx.lineWidth = lw; ctx.setLineDash(wl.kind === 'window' ? [6 / z, 5 / z] : wl.kind === 'door' && wl.open ? [3 / z, 9 / z] : []);
        ctx.strokeStyle = wl.kind === 'door' ? '#c8935a' : wl.kind === 'window' ? '#8fd3ff' : alpha('#ffffff', UI.walls ? 0.95 : 0.6);
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (UI.walls && UI.walls.from && UI.walls.live) {
        ctx.beginPath(); ctx.moveTo(UI.walls.from[0] * g, UI.walls.from[1] * g); ctx.lineTo(UI.walls.live[0] * g, UI.walls.live[1] * g);
        ctx.lineWidth = lw; ctx.strokeStyle = alpha(cssVar('--amber', '#ffb74d'), 0.9); ctx.setLineDash([8 / z, 6 / z]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }
  function over(ctx, g, z) {
    const f = F();
    if (!f.on) { ctx.save(); drawWalls(ctx, g, z); ctx.restore(); return; }   // walls and fog are the map's (#93), the rest is the combat view's
    const w = world();
    const ring = (u, color, width, dash) => {
      const s = (u.size || 1) * g, cx = u.x * g + s / 2, cy = u.y * g + s / 2;
      ctx.beginPath(); ctx.arc(cx, cy, s / 2 + 2, 0, Math.PI * 2);
      ctx.setLineDash(dash ? [6 / z, 4 / z] : []); ctx.lineWidth = width / Math.min(1, z); ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]);
    };
    ctx.save();
    const armedArea = (armedSpec() || {}).power && armedSpec().power.area;
    if (myTurn() && UI.armed && !armedArea) {   // an area shows its template and catch instead
      const red = cssVar('--red', '#ef5350');
      for (const t of targets(armedSpec())) ring(t, alpha(red, 0.9), 2, t.id !== UI.target);
      const t = UI.target && w.units[UI.target];
      if (t) ring(t, '#ffffff', 3, false);
    }
    // the template of an area power being aimed, and who it catches
    const hits = myTurn() ? areaPreview() : null;
    if (hits && hits.ok) {
      const red = cssVar('--red', '#ef5350');
      ctx.fillStyle = alpha(red, 0.22); ctx.strokeStyle = alpha(red, 0.7); ctx.lineWidth = 1 / z;
      for (const [x, y] of hits.squares) { ctx.fillRect(x * g, y * g, g, g); ctx.strokeRect(x * g, y * g, g, g); }
      for (const id of hits.units) ring(w.units[id], '#ffffff', 2, false);
    }
    // the cost of the lit square under the pointer
    if (UI.hoverSq && myTurn() && !UI.armed) {
      const [x, y] = UI.hoverSq.k.split(',').map(Number);
      label(ctx, `${UI.hoverSq.c} ft`, x * g + g / 2, y * g + g / 2, z, g);
    }
    // the ruler
    const R0 = UI.ruler;
    if (R0 && R0.a) {
      const b = R0.b || R0.live || R0.a, ax = (Math.floor(R0.a.x) + 0.5) * g, ay = (Math.floor(R0.a.y) + 0.5) * g, bx = (Math.floor(b.x) + 0.5) * g, by = (Math.floor(b.y) + 0.5) * g;
      ctx.strokeStyle = cssVar('--amber', '#ffb74d'); ctx.lineWidth = 3 / z; ctx.setLineDash([8 / z, 6 / z]);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, `${E.ruler(R0.a, b)} ft`, (ax + bx) / 2, (ay + by) / 2, z, g);
    }
    drawWalls(ctx, g, z);
    // status on the tokens (audit 8.10): conditions as badges, concentration as an amber ring, and a creature's hit
    // points as a bar for the GM only (players never get a creature's hit points)
    for (const u of Object.values(w.units)) {
      const s = (u.size || 1) * g, x0 = u.x * g, y0 = u.y * g;
      if (gm() && !u.charId && u.hp != null && u.maxHp) {
        const pct = Math.max(0, Math.min(1, u.hp / u.maxHp));
        ctx.fillStyle = '#300'; ctx.fillRect(x0 + 4, y0 + s - 6, s - 8, 4);
        ctx.fillStyle = pct < 0.3 ? '#ef5350' : pct < 0.6 ? '#ffb74d' : '#66bb6a'; ctx.fillRect(x0 + 4, y0 + s - 6, (s - 8) * pct, 4);
      }
      if ((f.conc || {})[u.id]) ring(u, alpha(cssVar('--amber', '#ffb74d'), 0.9), 2, true);
      const marks = (u.conditions || []).map(abbr).concat(E.spentOf(w, u.id).dodge ? ['Dg'] : []);
      if (!marks.length) continue;
      const r = Math.max(7 / z, g * 0.14), shown = marks.length > 3 ? marks.slice(0, 2).concat(`+${marks.length - 2}`) : marks;
      ctx.font = `700 ${r * 1.05}px "Exo 2", "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      shown.forEach((m, i) => {
        const cx = x0 + s - r * 0.6 - i * (2 * r + 1 / z), cy = y0 + r * 0.6;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = m === 'Dg' ? alpha(cssVar('--holo', '#4fc3f7'), 0.95) : alpha(cssVar('--red', '#ef5350'), 0.95); ctx.fill();
        ctx.lineWidth = 1.5 / z; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.fillText(m, cx, cy + r * 0.05);
      });
    }
    // floating results over tokens, for 1.6 s
    const tnow = performance.now();
    UI.floats = UI.floats.filter((fl) => tnow - fl.t0 < 1600);
    for (const fl of UI.floats) {
      const tok = st().map.tokens.find((t) => t.id === fl.token);
      if (!tok) continue;
      const p = (tnow - fl.t0) / 1600, s = (tok.size || 1) * g;
      const text = fl.kind === 'miss' ? 'Miss' : fl.kind === 'heal' ? `+${fl.amount}` : fl.kind === 'crit' ? `Critical −${fl.amount}` : `−${fl.amount}`;
      ctx.globalAlpha = 1 - p * p;
      ctx.font = `700 ${Math.max(14 / z, g * 0.32)}px "Exo 2", "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4 / z; ctx.strokeStyle = 'rgba(0,0,0,.85)';
      const x = tok.x * g + s / 2, y = tok.y * g - p * g * 0.6;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = fl.kind === 'miss' ? '#e0e0e0' : fl.kind === 'heal' ? '#7ee787' : fl.kind === 'crit' ? cssVar('--amber', '#ffb74d') : '#ff6e6e';
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }
  function label(ctx, text, x, y, z, g) {
    ctx.font = `700 ${Math.max(12 / z, g * 0.24)}px "Exo 2", "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4 / z; ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.strokeText(text, x, y); ctx.fillStyle = '#ffffff'; ctx.fillText(text, x, y);
  }
  let raf = 0;
  function animate() {
    if (raf) return;
    // the loop prunes as it goes, so it stops by itself even when the map isn't drawn (another tab, the view off)
    const step = () => { const t = performance.now(); UI.floats = UI.floats.filter((fl) => t - fl.t0 < 1600); H.drawMap(); raf = UI.floats.length && F().on ? requestAnimationFrame(step) : 0; };
    raf = requestAnimationFrame(step);
  }

  window.HTC = { render, down, tap, hover, under, over, wallsButton };
  if (st()) render();
})();
