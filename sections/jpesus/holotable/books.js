/* HoloTable: the SW5e books beyond powers and gear.
 *  - Player's Handbook / Expanded Content: species, backgrounds, archetypes, feats, maneuvers,
 *    fighting styles & masteries, lightsaber forms, class & archetype features (also used by level-ups)
 *  - Wretched Hives: its feats, gear (in the equipment picker) and rule chapters
 *  - Scum and Villainy: a GM creature picker with full stat blocks and rollable attacks
 *  - Starships of the Galaxy: starship sheets, crew deployments, ship weapons/equipment/modifications, ventures
 *  - Variant Rules: every variant, and which ones this table uses (the GM switches them on)
 *  - Rules library: every book's chapters, searchable
 * All data comes from our own API (?op=sw5e&list=...), which fetches SW5e's lists server-side and caches them.
 * Uses the helpers app.js shares on window.HT. Everything shown is escaped (esc / mdBlock).
 */
(() => {
  const H = window.HT;
  const { $, $$, esc, n0, R } = H;

  // --------------------------------------------------------------------------- data
  const CACHE = {};
  function list(name) {
    if (!CACHE[name]) {
      CACHE[name] = fetch(`${H.API}?op=sw5e&list=${encodeURIComponent(name)}`, { credentials: 'same-origin' }).then(async r => {
        const j = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(j)) throw new Error((j && j.error) || "Couldn't load that SW5e list.");
        return j;
      });
      CACHE[name].catch(() => { delete CACHE[name]; });   // try again next time
    }
    return CACHE[name];
  }
  const SRC = { PHB: "Player's Handbook", EC: 'Expanded Content', WH: 'Wretched Hives', SnV: 'Scum and Villainy', SotG: 'Starships of the Galaxy' };
  const srcTag = s => (s && s !== 'None' ? `<span class="pp-tag" title="${esc(SRC[s] || s)}">${esc(s)}</span>` : '');

  // --------------------------------------------------------------------------- markdown (rule text)
  // A small, safe renderer: everything is escaped first, then a few markdown forms are turned back
  // into tags we build ourselves. Links become plain text and images are dropped (no outside requests).
  const ENT = /&amp;(mdash|ndash|emsp|ensp|nbsp|times|minus|rsquo|lsquo|rdquo|ldquo|hellip|frac12|frac14|deg|#\d{2,4});/g;
  function inline(s) {
    return s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(ENT, '&$1;')
      .replace(/&lt;br\s*\/?&gt;/gi, '<br>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(.+?)__/g, '<b>$1</b>')
      .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>')
      .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<i>$2</i>');
  }
  const slug = s => String(s).toLowerCase().replace(/<[^>]+>|&[a-z#0-9]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  function mdBlock(src, opts = {}) {
    const lines = esc(String(src || '')).replace(/\r/g, '').split('\n');
    const out = [], toc = [];
    let i = 0;
    const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) { i++; continue; }
      let m;
      if ((m = /^(#{1,6})\s+(.*)$/.exec(l))) {
        const lvl = Math.min(6, m[1].length + (opts.shift || 0)), txt = inline(m[2].replace(/#+\s*$/, ''));
        const id = (opts.idPrefix || 'h') + '-' + slug(txt) + '-' + i;
        if (m[1].length <= 3) toc.push({ id, txt, lvl: m[1].length });
        out.push(`<h${lvl} id="${id}" class="md-h">${txt}</h${lvl}>`); i++; continue;
      }
      if (/^\s*(___+|---+|\*\*\*+)\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (/^\s*\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
        const isSep = r => /^\s*\|?\s*:?-{2,}/.test(r) && cells(r).every(c => /^:?-*:?$/.test(c));
        let head = null, body = rows;
        if (rows.length > 1 && isSep(rows[1])) { head = cells(rows[0]); body = rows.slice(2); }
        out.push(`<div class="md-table"><table class="t">${head ? `<thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead>` : ''}<tbody>${body.filter(r => !isSep(r)).map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
        continue;
      }
      if (/^\s*&gt;/.test(l)) {
        const q = [];
        while (i < lines.length && /^\s*&gt;/.test(lines[i])) q.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
        // re-render the quote's inside (it is already escaped, so un-escape only to re-escape)
        const inner = mdBlock(q.join('\n').replace(/&lt;|&gt;|&quot;|&#39;|&amp;/g, x => ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' })[x]), { shift: 2, idPrefix: 'q' });
        out.push(`<blockquote class="md-quote">${inner.html}</blockquote>`); continue;
      }
      if (/^\s*([-*+]|\d+\.)\s+/.test(l)) {
        const ordered = /^\s*\d+\./.test(l), items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          let it = lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, '');
          while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])) it += ' ' + lines[i++].trim();
          items.push(`<li>${inline(it)}</li>`);
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*\||\s*&gt;|\s*([-*+]|\d+\.)\s+|\s*(___+|---+)\s*$)/.test(lines[i])) para.push(lines[i++].trim());
      if (para.length) out.push(`<p>${para.map(inline).join(opts.breaks ? '<br>' : ' ')}</p>`); else i++;
    }
    return { html: out.join(''), toc };
  }
  const md = s => mdBlock(s).html;

  // --------------------------------------------------------------------------- generic picker
  // One modal for every "pick something from SW5e" list: tabs (optional), checkbox filters, search,
  // a row per entry with its details folded away, and an action button.
  function picker(cfg) {
    const F = { tab: cfg.tabs ? cfg.tabs[0].key : null, q: '', limit: 100, sel: {} };
    H.modal(`<div id="bp" class="power-picker"><h3>${esc(cfg.title)}</h3><p class="muted">Loading…</p></div>`, async box => {
      const bp = $('#bp', box);
      let rows = [], all = [];
      const tabCfg = () => (cfg.tabs ? cfg.tabs.find(t => t.key === F.tab) : cfg);
      const facets = () => tabCfg().facets || [];
      const values = fn => [...new Set(all.map(fn).filter(v => v !== '' && v != null))].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })));
      const drop = (key, label, vals, sel, names) => {
        const summary = sel.size === vals.length ? `All ${label}` : sel.size === 0 ? `No ${label}` : sel.size <= 2 ? [...sel].map(v => names[v] || v).join(', ') : `${sel.size} ${label}`;
        return `<details class="pp-align" data-drop="${esc(key)}"><summary>${esc(summary)}</summary><div class="pp-align-menu">
          <div class="row" style="gap:4px"><button class="btn tiny" data-bp="all" data-key="${esc(key)}">All</button><button class="btn tiny ghost" data-bp="none" data-key="${esc(key)}">None</button></div>
          ${vals.map(v => `<label class="toggle"><input type="checkbox" data-bp="check" data-key="${esc(key)}" value="${esc(v)}" ${sel.has(String(v)) ? 'checked' : ''}> ${esc(names[v] || v)}</label>`).join('')}</div></details>`;
      };
      const renderFilters = () => {
        bp.querySelector('.pp-filters').innerHTML = facets().map(f => drop(f.key, f.label, values(f.get), F.sel[f.key], f.names || (f.key === 'src' ? SRC : {}))).join('')
          + `<input data-bp="q" placeholder="Search…" value="${esc(F.q)}" style="flex:1;min-width:140px">`;
      };
      const render = () => {
        rows = all.filter(it => facets().every(f => { const v = f.get(it); return v === '' || v == null || F.sel[f.key].has(String(v)); })
          && (!F.q || (tabCfg().search || (x => x.n))(it).toLowerCase().includes(F.q)));
        const t = tabCfg();
        bp.querySelector('.pp-list').innerHTML = rows.slice(0, F.limit).map((it, i) => `<div class="pp-row">
            <div class="pp-main">${t.row(it)}${t.detail ? `<details class="pp-desc"><summary>${esc(t.detailLabel || 'Details')}</summary><div>${t.detail(it)}</div></details>` : ''}</div>
            ${t.action ? t.action(it, i) : ''}</div>`).join('')
          + (rows.length > F.limit ? `<button class="btn small" data-bp="more" style="width:100%">Show ${rows.length - F.limit} more</button>` : '')
          + (!rows.length ? '<p class="muted">Nothing matches.</p>' : '');
        bp.querySelector('.pp-count').textContent = `${rows.length} of ${all.length}`;
      };
      const load = async () => {
        bp.querySelector('.pp-list').innerHTML = '<p class="muted">Loading the SW5e list…</p>';
        try { all = await tabCfg().load(); } catch (err) { bp.querySelector('.pp-list').innerHTML = `<p class="error">${esc(err.message)}</p>`; all = []; return; }
        F.sel = {}; F.limit = 100;
        for (const f of facets()) F.sel[f.key] = new Set((f.initial ? f.initial(values(f.get)) : values(f.get)).map(String));
        renderFilters(); render();
      };
      bp.innerHTML = `<h3>${esc(cfg.title)}</h3>
        ${cfg.intro ? `<p class="muted" style="margin:0">${cfg.intro}</p>` : ''}
        ${cfg.tabs ? `<div class="subtabs" style="margin:0">${cfg.tabs.map(t => `<button data-bp="tab" data-tab="${esc(t.key)}" class="${t.key === F.tab ? 'on' : ''}">${esc(t.label)}</button>`).join('')}</div>` : ''}
        <div class="pp-filters"></div><div class="pp-count muted"></div><div class="pp-list"></div>
        <p class="muted" style="font-size:11px;margin:0">Data from <a href="https://sw5e.com" target="_blank" rel="noopener noreferrer">SW5e</a>, a free fan project (sw5e.com).</p>
        <div class="row"><span class="spacer"></span><button class="btn primary" data-bp="close">Done</button></div>`;
      const updateSummaries = () => {
        for (const f of facets()) {
          const sum = bp.querySelector(`[data-drop="${f.key}"] summary`); if (!sum) continue;
          const vals = values(f.get), sel = F.sel[f.key], names = f.names || (f.key === 'src' ? SRC : {});
          sum.textContent = sel.size === vals.length ? `All ${f.label}` : sel.size === 0 ? `No ${f.label}` : sel.size <= 2 ? [...sel].map(v => names[v] || v).join(', ') : `${sel.size} ${f.label}`;
        }
      };
      bp.addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.bp === 'check') { t.checked ? F.sel[t.dataset.key].add(t.value) : F.sel[t.dataset.key].delete(t.value); F.limit = 100; render(); updateSummaries(); }
      });
      bp.addEventListener('input', e => { if (e.target.dataset.bp === 'q') { F.q = e.target.value.trim().toLowerCase(); F.limit = 100; render(); } });
      bp.addEventListener('click', e => {
        const b = e.target.closest('[data-bp]'); if (!b) return;
        const a = b.dataset.bp;
        if (a === 'close') return H.closeModal();
        if (a === 'more') { F.limit += 200; return render(); }
        if (a === 'tab') { F.tab = b.dataset.tab; $$('[data-bp="tab"]', bp).forEach(x => x.classList.toggle('on', x === b)); F.q = ''; load(); return; }
        if (a === 'all' || a === 'none') {
          e.preventDefault();
          const f = facets().find(x => x.key === b.dataset.key);
          F.sel[f.key] = new Set(a === 'all' ? values(f.get).map(String) : []);
          $$(`[data-bp="check"][data-key="${f.key}"]`, bp).forEach(cb => { cb.checked = a === 'all'; });
          render(); updateSummaries(); return;
        }
        if (a === 'pick') {
          const it = rows[+b.dataset.i]; if (!it) return;
          const done = tabCfg().onPick(it, b);
          if (done !== false) { b.textContent = tabCfg().pickedLabel || '✓ Added'; b.disabled = true; b.classList.replace('primary', 'ghost'); }
        }
      });
      await load();
      bp.querySelector('[data-bp="q"]')?.focus();
    });
  }
  const pickBtn = (i, label = 'Add', has = false) => `<button class="btn small ${has ? 'ghost' : 'primary'}" data-bp="pick" data-i="${i}" ${has ? 'disabled' : ''}>${has ? '✓ Have it' : esc(label)}</button>`;
  const charOf = id => H.S.st.characters[id];
  const mutateChar = (id, fn) => { if (H.S.selected !== id) H.S.selected = id; H.mutate(fn); };
  const hasFeature = (ch, name) => (ch.features || []).some(f => String(f.name).toLowerCase() === String(name).toLowerCase());
  const lc = s => String(s || '').toLowerCase();

  // --------------------------------------------------------------------------- species
  const ABN = { str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' };
  const asiText = a => Object.entries(a || {}).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${ABN[k]}`).join(', ');
  const SKIP_TRAITS = new Set(['ability score increase', 'age', 'alignment', 'size', 'speed', 'languages']);
  function openSpeciesPicker(charId) {
    picker({
      title: '◈ Choose a species', intro: "Sets the species, adds its traits to Features &amp; Traits, and can apply its ability score increase. Picking another species replaces the old traits.",
      load: () => list('species'),
      facets: [{ key: 'src', label: 'books', get: x => x.src }, { key: 'size', label: 'sizes', get: x => x.size }],
      search: x => x.n + ' ' + x.home + ' ' + x.traits.map(t => t.n).join(' '),
      row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}<span class="pp-lvl">${esc(x.size)}</span>
        <div class="pp-meta">${esc([x.home && 'Homeworld: ' + x.home, x.asi ? asiText(x.asi) : 'ability increase: your choice', x.lang && 'Speaks ' + x.lang].filter(Boolean).join(' · '))}</div>`,
      detail: x => x.traits.map(t => `<p><b>${esc(t.n)}.</b> ${md(t.d).replace(/^<p>|<\/p>$/g, '')}</p>`).join(''),
      detailLabel: 'Traits',
      action: (x, i) => pickBtn(i, lc(charOf(charId).species) === lc(x.n) ? 'Re-apply' : 'Choose'),
      pickedLabel: '✓ Chosen',
      onPick: x => {
        const apply = x.asi && confirm(`Also apply ${x.n}'s ability score increase (${asiText(x.asi)})?\n\nChoose Cancel if your sheet already includes it.`);
        mutateChar(charId, c => {
          c.features = c.features.filter(f => !/^Species trait \(/.test(f.text || ''));
          c.species = x.n;
          for (const t of x.traits) if (!SKIP_TRAITS.has(lc(t.n))) c.features.push({ name: t.n.slice(0, 80), text: `Species trait (${x.n})\n${t.d}`.slice(0, 4000) });
          const speed = x.traits.find(t => lc(t.n) === 'speed'); const sp = speed && /(\d+)\s*feet/.exec(speed.d); if (sp) c.speed = +sp[1];
          c.senses = R.sensesFromTraits(x.traits);   // the species' own senses (the server applies the same for a player)
          if (R.SIZES.includes(x.size)) c.size = x.size;   // and its size (audit 5.12)
          const lang = x.traits.find(t => lc(t.n) === 'languages'); if (lang && !c.languages.includes(lang.d.slice(0, 40))) c.languages = (c.languages ? c.languages + '\n' : '') + lang.d.slice(0, 300);
          if (apply) for (const [k, v] of Object.entries(x.asi)) c.abilities[k] = Math.min(30, n0(c.abilities[k]) + v);
        });
        H.toast(`${x.n} chosen${apply ? ' (ability scores updated)' : ''}`);
        H.closeModal();
      },
    });
  }

  // --------------------------------------------------------------------------- backgrounds
  function openBackgroundPicker(charId) {
    picker({
      title: '◈ Choose a background', intro: "Sets the background and adds its feature; then you choose its skills (ticked on the sheet) and its feat. Its tools, languages and equipment are noted.",
      load: () => list('backgrounds'),
      facets: [{ key: 'src', label: 'books', get: x => x.src }],
      row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}<div class="pp-meta">${esc([x.skills, x.feature && 'Feature: ' + x.feature].filter(Boolean).join(' · '))}</div>`,
      detail: x => `${x.skills ? `<p><b>Skills.</b> ${esc(x.skills)}</p>` : ''}${x.tools ? `<p><b>Tools.</b> ${esc(x.tools)}</p>` : ''}${x.langs ? `<p><b>Languages.</b> ${esc(x.langs)}</p>` : ''}
        ${x.equip ? `<p><b>Equipment.</b> ${esc(x.equip)}</p>` : ''}${x.feature ? `<p><b>Feature: ${esc(x.feature)}.</b></p>${md(x.featureText)}` : ''}
        ${x.feats.length ? `<p><b>Suggested feats.</b> ${esc(x.feats.join(', '))}</p>` : ''}`,
      action: (x, i) => pickBtn(i, 'Choose'), pickedLabel: '✓ Chosen',
      onPick: x => {
        const held = heldSkills(charOf(charId).skills);
        backgroundChoices(x, held, `◈ ${esc(x.n)}`, 'Use this background', (skills, feat) => {
          mutateChar(charId, c => applyBackground(c, x, skills, feat));
          H.toast(`${x.n} chosen${skills.length ? ': ' + skills.map(k => R.SKILLS.find(sk => sk.key === k).name).join(', ') : ''}${feat ? ', feat ' + feat.n : ''}`);
          H.closeModal();
        });
      },
    });
  }

  // --------------------------------------------------------------------------- guided level-1 build (audit 1.3, 1.7)
  // SW5e's Player's Handbook, "Step-By-Step Characters": choose a species, a class, determine ability scores, describe
  // the character (background), choose equipment. Each step picks into a draft; the character is saved once, at the end.
  const skillKey = name => (R.SKILLS.find(k => lc(k.name) === lc(String(name).trim())) || {}).key;
  // "Choose two from Deception, Insight, Lore, and Persuasion" -> { n: 2, from: [keys] }
  const NUM = { one: 1, two: 2, three: 3, four: 4 };
  function skillChoice(text) {
    const m = /choose (\w+) from (.*)$/i.exec(String(text || '').trim());
    if (!m) return { n: 0, from: [] };
    const from = m[2].replace(/\.$/, '').split(/,\s*|\s+(?:and|or)\s+/).map(x => skillKey(x.replace(/^(and|or)\s+/i, ''))).filter(Boolean);
    return { n: NUM[lc(m[1])] || +m[1] || 0, from: [...new Set(from)] };
  }
  // a class's skill list as sheet keys ("Any" is every skill)
  const classSkills = cl => (cl.skills.some(x => lc(x) === 'any') ? R.SKILLS.map(k => k.key) : cl.skills.map(skillKey).filter(Boolean));
  // Choosing within a background (audit 1.8): the skills from its "Choose two from …" list (minus ones already held) and
  // one of its feats. done(skills, feat) with skill keys and { n, text } (or null when it lists no feats).
  // What a background's skill choice offers a character who already has some skills (held: sheet keys at full proficiency).
  // SW5e, Personality and Backgrounds: "If a character would gain the same proficiency from two different sources, he or
  // she can choose a different proficiency of the same kind instead." So each listed skill already held is a swap: up to
  // that many picks may come from any other skill. n is how many to pick in all.
  // the skills a sheet has the proficiency in: a dot at 1 or 2 (expertise); the half step (0.5, #185) isn't it
  const heldSkills = skills => Object.keys(skills || {}).filter(k => +skills[k] >= 1);
  function backgroundSkillOptions(b, held) {
    held = held || [];
    const ch = skillChoice(b.skills), from = ch.from.filter(k => !held.includes(k)), swaps = Math.min(ch.n, ch.from.length - from.length);
    const other = swaps > 0 ? R.SKILLS.map(x => x.key).filter(k => !ch.from.includes(k) && !held.includes(k)) : [];
    return { n: Math.min(ch.n, from.length + Math.min(swaps, other.length)), from, other, swaps, listed: ch.from.length };
  }
  function backgroundChoices(b, held, title, nextLabel, done) {
    const { n, from, other, swaps, listed } = backgroundSkillOptions(b, held);
    let skills = [], feat = null;
    const ready = () => skills.length === n && (!b.feats.length || !!feat);
    H.modal(`<h3>${title}</h3>
      <h4>Choose ${n} skill${n === 1 ? '' : 's'} <span class="muted" id="bcCount">(0 of ${n})</span></h4>
      <div class="row wrap" style="gap:4px 14px">${from.map(k => `<label class="toggle"><input type="checkbox" data-bc="skill" value="${k}"> ${esc(R.SKILLS.find(x => x.key === k).name)}</label>`).join('')}</div>
      ${other.length ? `<p class="muted" style="font-size:12px;margin:8px 0 4px">You already have ${swaps === 1 ? 'one' : swaps} of this background's skills, so ${swaps === 1 ? 'one pick' : `up to ${swaps} picks`} can be any other skill instead:</p>
        <div class="row wrap" style="gap:4px 14px">${other.map(k => `<label class="toggle"><input type="checkbox" data-bc="skill" data-other="1" value="${k}"> ${esc(R.SKILLS.find(x => x.key === k).name)}</label>`).join('')}</div>`
        : listed > from.length ? '<p class="muted" style="font-size:12px">Skills you already have are left out.</p>' : ''}
      ${b.feats.length ? `<h4 style="margin-top:12px">Choose a feat</h4><select data-bc="feat"><option value="">— choose —</option>${b.feats.map(f => `<option>${esc(f)}</option>`).join('')}</select>
        <div class="muted" id="bcFeat" style="font-size:12px;margin-top:6px"></div>` : ''}
      <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" data-bc="cancel">Cancel</button>
        <button class="btn primary" data-bc="ok" ${ready() ? '' : 'disabled'}>${esc(nextLabel)}</button></div>`, box => {
      box.onchange = async e => {
        if (e.target.dataset.bc === 'skill') {
          const swapped = box.querySelectorAll('[data-bc=skill][data-other]:checked').length;
          if (box.querySelectorAll('[data-bc=skill]:checked').length > n || swapped > swaps) e.target.checked = false;   // too many, or more swaps than held skills
          skills = [...box.querySelectorAll('[data-bc=skill]:checked')].map(i => i.value);
          box.querySelector('#bcCount').textContent = `(${skills.length} of ${n})`;
        }
        if (e.target.dataset.bc === 'feat') {
          const name = e.target.value, f = name ? await featNamed(name) : null;
          feat = name ? { n: name, text: f ? f.text : '' } : null;
          box.querySelector('#bcFeat').innerHTML = f ? mdBlock(f.text).html : '';
        }
        box.querySelector('[data-bc=ok]').disabled = !ready();
      };
      box.onclick = e => {
        const t = e.target.closest('[data-bc]'); if (!t) return;
        if (t.dataset.bc === 'cancel') return H.closeModal();
        if (t.dataset.bc === 'ok' && ready()) done(skills, feat);
      };
    });
  }

  // A background on a sheet (audit 1.8): its feature; the skills chosen from its list as ticked dots; the feat chosen from
  // its options; its tools, languages and (unless the caller lists equipment itself) equipment as text. Re-choosing a
  // background replaces the old background feature and feat (dots already ticked stay: they may come from elsewhere).
  function applyBackground(c, b, skills, feat, opts = {}) {
    c.features = (c.features || []).filter(f => !/^Background (feature|feat) \(/.test(f.text || ''));
    c.background = b.n;
    if (b.feature) c.features.push({ name: b.feature.slice(0, 80), text: `Background feature (${b.n})\n${b.featureText}`.slice(0, 4000) });
    if (feat) c.features.push({ name: feat.n.slice(0, 80), text: `Background feat (${b.n})\n${feat.text || ''}`.slice(0, 4000) });
    c.skills = c.skills || {};
    const picked = (skills || []).filter(k => R.SKILLS.some(sk => sk.key === k));
    for (const k of picked) c.skills[k] = Math.max(1, +(c.skills[k] || 0));
    const line = `Background (${b.n}): ${[picked.length && 'Skills: ' + picked.map(k => R.SKILLS.find(sk => sk.key === k).name).join(', '), b.tools && 'Tools: ' + b.tools].filter(Boolean).join('. ')}`;
    c.proficiencies = (c.proficiencies || '').split('\n').filter(l => !/^Background \(/.test(l)).concat(line).join('\n').trim().slice(0, 2000);
    if (b.langs && !(c.languages || '').includes(b.langs)) c.languages = ((c.languages ? c.languages + '\n' : '') + 'Background: ' + b.langs).slice(0, 500);
    if (opts.equip !== false && b.equip && !(c.notes || '').includes(b.equip.slice(0, 40))) c.notes = ((c.notes ? c.notes + '\n\n' : '') + `Starting equipment (${b.n}): ${b.equip}`).slice(0, 20000);
    return c;
  }
  // The character a finished guide makes, from what was chosen (pure: the tests call it). D: { name, color, species,
  // asi (bool), cls, classSkills [keys], classFeatures [{n, text}], scores {str..}, bg, bgSkills [keys], feat {n, text} }
  function buildLevel1(D) {
    const c = R.blankCharacter();
    c.name = String(D.name || 'New Character').slice(0, 80); if (D.color) c.color = D.color;
    c.abilities = Object.assign({}, c.abilities, D.scores || {});
    const x = D.species;
    if (x) {
      c.species = x.n;
      for (const t of x.traits) if (!SKIP_TRAITS.has(lc(t.n))) c.features.push({ name: t.n.slice(0, 80), text: `Species trait (${x.n})\n${t.d}`.slice(0, 4000) });
      const speed = x.traits.find(t => lc(t.n) === 'speed'); const sp = speed && /(\d+)\s*feet/.exec(speed.d); if (sp) c.speed = +sp[1];
      c.senses = R.sensesFromTraits(x.traits);
      if (R.SIZES.includes(x.size)) c.size = x.size;   // and its size (#185), as the species picker sets it
      const lang = x.traits.find(t => lc(t.n) === 'languages'); if (lang) c.languages = lang.d.slice(0, 300);
      if (D.asi && x.asi) for (const [k, v] of Object.entries(x.asi)) c.abilities[k] = Math.min(30, n0(c.abilities[k]) + v);
    }
    const cl = D.cls;
    if (cl) {
      c.classes = [{ name: cl.n, level: 1, archetype: '' }];
      c.saves = Object.fromEntries(cl.saves.map(k => [k, true]));
      const hp = Math.max(1, cl.hp1 + mod(c.abilities.con));   // 1st level: the die's maximum + Con
      c.hp = { max: hp, current: hp, temp: 0 };
      for (const f of D.classFeatures || []) c.features.push({ name: f.n.slice(0, 80), text: `${cl.n} 1st-level feature\n${f.text}`.slice(0, 4000) });
      c.proficiencies = [cl.armor.length && 'Armor: ' + cl.armor.join(', '), cl.weapons.length && 'Weapons: ' + cl.weapons.join(', '),
        cl.tools.length && 'Tools: ' + cl.tools.join(', ')].filter(Boolean).join('\n');
    }
    for (const k of D.classSkills || []) if (R.SKILLS.some(s => s.key === k)) c.skills[k] = 1;
    c.ac = 10 + mod(c.abilities.dex);   // unarmored; armor goes on with the equipment
    c.acAuto = true;                    // brand-new: the sheet works its AC out from worn armor (#165), as ＋ New's blank sheet does
    const b = D.bg;
    if (b) applyBackground(c, b, D.bgSkills, D.feat, { equip: false });   // the guide lists the equipment itself, below
    const plain = x => String(x).replace(/\*/g, '').replace(/^\s*-\s*/, '• ');   // SW5e's markdown: *(a)* -> (a), "- " -> a bullet
    const eq = [cl && cl.equip.length && `${cl.n}:\n${cl.equip.map(plain).join('\n')}`, b && b.equip && `${b.n}: ${plain(b.equip)}`].filter(Boolean);
    if (eq.length) c.notes = ('Starting equipment (choose where it says (a) or (b)):\n' + eq.join('\n\n')).slice(0, 20000);
    c.proficiencies = (c.proficiencies || '').slice(0, 2000);
    return c;
  }

  function guidedBuild(onDone) {
    const me = H.S.st && H.S.st.players && H.S.st.players[H.S.st.you];
    const D = { name: me && me.name ? me.name + "'s character" : 'New Character', classSkills: [], bgSkills: [] };
    const step = (n, t) => `<span class="muted" style="text-transform:none;letter-spacing:0">Step ${n} of 5 · </span>${t}`;
    const box0 = $('#modalBox');
    if (guidedBuild.skip) box0.removeEventListener('click', guidedBuild.skip);   // one guide's handler at a time, even if the last was closed
    const skip = guidedBuild.skip = e => { if (e.target.closest('[data-gb=blank]')) { box0.removeEventListener('click', skip); H.closeModal(); onDone(null); } };
    box0.addEventListener('click', skip);   // the "blank character" button in step 1's intro; removed once the guide moves on
    // 1. species
    picker({
      title: 'New character · 1 of 5: species', intro: "SW5e builds a character in five steps: species, class, ability scores, background, equipment. " +
        "Nothing is saved until the last step. <button class='btn tiny ghost' data-gb='blank'>Skip: a blank character</button>",
      load: () => list('species'),
      facets: [{ key: 'src', label: 'books', get: x => x.src }, { key: 'size', label: 'sizes', get: x => x.size }],
      search: x => x.n + ' ' + x.home + ' ' + x.traits.map(t => t.n).join(' '),
      row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}<span class="pp-lvl">${esc(x.size)}</span>
        <div class="pp-meta">${esc([x.home && 'Homeworld: ' + x.home, x.asi ? asiText(x.asi) : 'ability increase: your choice', x.lang && 'Speaks ' + x.lang].filter(Boolean).join(' · '))}</div>`,
      detail: x => x.traits.map(t => `<p><b>${esc(t.n)}.</b> ${md(t.d).replace(/^<p>|<\/p>$/g, '')}</p>`).join(''),
      detailLabel: 'Traits', action: (x, i) => pickBtn(i, 'Choose'), pickedLabel: '✓ Chosen',
      onPick: x => { box0.removeEventListener('click', skip); D.species = x; D.asi = !!x.asi; stepClass(); },
    });
    // 2. class
    async function stepClass() {
      let all;
      try { all = await list('classes'); } catch (err) { H.toast(err.message, true); return; }
      const draw = () => {
        const cl = D.cls, opts = cl ? classSkills(cl) : [];
        return `<h3>${step(2, 'class')}</h3>
          <div class="grid g2" style="gap:6px">${all.map(k => `<label style="display:block;cursor:pointer;padding:8px 10px;border:1px solid ${cl && cl.n === k.n ? 'var(--holo)' : 'var(--line)'};border-radius:8px;text-transform:none;letter-spacing:0">
            <input type="radio" name="gbCls" value="${esc(k.n)}" ${cl && cl.n === k.n ? 'checked' : ''}> <b>${esc(k.n)}</b>
            <span class="muted" style="font-size:12px"> · d${k.hd} · saves ${k.saves.map(a => a.toUpperCase()).join(', ')}</span>
            <div class="muted" style="font-size:12px">${esc(k.sum)}</div></label>`).join('')}</div>
          ${cl ? `<h4 style="margin-top:12px">${esc(cl.n)}: choose ${cl.nSkills} skill${cl.nSkills === 1 ? '' : 's'} <span class="muted" id="gbCount">(${D.classSkills.length} of ${cl.nSkills})</span></h4>
            <div class="row wrap" style="gap:4px 14px">${opts.map(k => `<label class="toggle"><input type="checkbox" data-gb="cskill" value="${k}" ${D.classSkills.includes(k) ? 'checked' : ''}> ${esc(R.SKILLS.find(s => s.key === k).name)}</label>`).join('')}</div>
            <p class="muted" style="font-size:12px;margin:8px 0 0">1st-level hit points: ${cl.hp1} + your Constitution modifier. Saving throws: ${cl.saves.map(a => a.toUpperCase()).join(', ')}.</p>` : ''}
          <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" data-gb="cancel">Cancel</button>
            <button class="btn primary" data-gb="next" ${cl && D.classSkills.length === cl.nSkills ? '' : 'disabled'}>Next: ability scores</button></div>`;
      };
      H.modal(draw(), box => {
        box.onchange = e => {
          if (e.target.name === 'gbCls') { D.cls = all.find(k => k.n === e.target.value); D.classSkills = []; box.innerHTML = draw(); return; }
          if (e.target.dataset.gb === 'cskill') {
            D.classSkills = [...box.querySelectorAll('[data-gb=cskill]:checked')].map(i => i.value);
            if (D.classSkills.length > D.cls.nSkills) { e.target.checked = false; D.classSkills = D.classSkills.filter(k => k !== e.target.value); }
            box.querySelector('#gbCount').textContent = `(${D.classSkills.length} of ${D.cls.nSkills})`;
            box.querySelector('[data-gb=next]').disabled = D.classSkills.length !== D.cls.nSkills;
          }
        };
        box.onclick = async e => {
          const b = e.target.closest('[data-gb]'); if (!b) return;
          if (b.dataset.gb === 'cancel') return H.closeModal();
          if (b.dataset.gb === 'next') {
            b.disabled = true; b.textContent = 'Loading the class features…';   // the first load of the features list takes a moment
            D.classFeatures = (await featuresFor(D.cls.n, 'class', 1, 1).catch(() => [])).map(f => ({ n: f.n, text: f.text }));
            H.scoresDialog({ name: D.name }, sc => { D.scores = sc; stepBackground(); });
          }
        };
      });
    }
    // 4. background: the background, two of its skills and one of its feats
    function stepBackground() {
      picker({
        title: 'New character · 4 of 5: background', intro: 'Your background gives two skills, a feature and a feat.',
        load: () => list('backgrounds'),
        facets: [{ key: 'src', label: 'books', get: x => x.src }],
        row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}<div class="pp-meta">${esc([x.skills, x.feature && 'Feature: ' + x.feature].filter(Boolean).join(' · '))}</div>`,
        detail: x => `${x.skills ? `<p><b>Skills.</b> ${esc(x.skills)}</p>` : ''}${x.tools ? `<p><b>Tools.</b> ${esc(x.tools)}</p>` : ''}
          ${x.feature ? `<p><b>Feature: ${esc(x.feature)}.</b></p>${md(x.featureText)}` : ''}${x.feats.length ? `<p><b>Feats.</b> ${esc(x.feats.join(', '))}</p>` : ''}`,
        action: (x, i) => pickBtn(i, 'Choose'), pickedLabel: '✓ Chosen',
        onPick: x => { D.bg = x; D.bgSkills = []; D.feat = null; stepBgChoices(); },
      });
    }
    function stepBgChoices() {
      backgroundChoices(D.bg, D.classSkills, step(4, esc(D.bg.n)), 'Next: review', (skills, feat) => { D.bgSkills = skills; D.feat = feat; stepReview(); });
    }
    // 5. equipment and a last look
    function stepReview() {
      const c = buildLevel1(D), sk = Object.keys(c.skills).map(k => R.SKILLS.find(s => s.key === k).name);
      H.modal(`<h3>${step(5, 'equipment and a last look')}</h3>
        <label>Name<input id="gbName" value="${esc(c.name)}" maxlength="80"></label>
        <p style="margin:8px 0 4px"><b>${esc(c.species)}</b> · <b>${esc(D.cls.n)} 1</b> · ${esc(c.background)}${D.feat ? ' · feat: ' + esc(D.feat.n) : ''}</p>
        <p style="margin:0 0 4px">${R.ABILITIES.map(a => `${a.key.toUpperCase()} <b>${c.abilities[a.key]}</b>`).join(' · ')}
          ${D.species.asi ? `<span class="muted">(with ${esc(D.species.n)}'s ${esc(asiText(D.species.asi))})</span>` : `<br><span class="muted">${esc(D.species.n)}'s ability increase is your choice: add it on the sheet.</span>`}</p>
        <p style="margin:0 0 4px">HP <b>${c.hp.max}</b> · AC <b>${c.ac}</b> (unarmored) · saves ${Object.keys(c.saves).map(a => a.toUpperCase()).join(', ')} · skills ${esc(sk.join(', '))}</p>
        <h4 style="margin-top:10px">Starting equipment</h4><div class="muted" style="font-size:12px;white-space:pre-wrap;max-height:180px;overflow:auto">${esc(c.notes)}</div>
        <p class="muted" style="font-size:12px">This goes into your sheet's Notes; add the items you choose on the Features &amp; Gear tab.</p>
        <div class="row"><span class="spacer"></span><button class="btn" data-gb="cancel">Cancel</button><button class="btn primary" data-gb="make">Create ${esc(D.cls.n)}</button></div>`, box => {
        box.onclick = e => {
          const b = e.target.closest('[data-gb]'); if (!b) return;
          if (b.dataset.gb === 'cancel') return H.closeModal();
          if (b.dataset.gb === 'make') { D.name = box.querySelector('#gbName').value.trim() || D.name; H.closeModal(); onDone(buildLevel1(D)); }
        };
      });
    }
  }

  // --------------------------------------------------------------------------- archetypes
  async function featuresFor(of, kind, fromLvl, toLvl) {
    const all = await list('features');
    return all.filter(f => f.k === kind && lc(f.of) === lc(of) && f.lvl >= fromLvl && f.lvl <= toLvl && lc(f.n) !== 'ability score improvement');
  }
  // Changing an archetype takes the old one's features off the sheet: the ones this picker and the level-up wizard
  // added, whose text starts "Archetype feature (Old name, level n)". Anything typed by hand stays. Returns how many went.
  function dropArchetypeFeatures(c, name) {
    const mark = `Archetype feature (${name},`, before = (c.features || []).length;
    c.features = (c.features || []).filter(f => !String((f && f.text) || '').startsWith(mark));
    return before - c.features.length;
  }
  function openArchetypePicker(charId, classIdx) {
    const k = charOf(charId).classes[classIdx]; if (!k) return;
    picker({
      title: `◈ ${k.name} archetype`, intro: `Sets the archetype and adds its features up to ${esc(k.name)} level ${n0(k.level)}.`,
      load: async () => { const a = await list('archetypes'); const mine = a.filter(x => lc(x.cls) === lc(k.name)); return mine.length ? mine : a; },
      facets: [{ key: 'src', label: 'books', get: x => x.src }, { key: 'cls', label: 'classes', get: x => x.cls }],
      row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}<span class="pp-lvl">${esc(x.cls)}</span>${x.cast ? `<span class="pp-tag">${esc(x.cast)} casting</span>` : ''}`,
      detail: x => md(x.text), detailLabel: 'About',
      action: (x, i) => pickBtn(i, lc(k.archetype) === lc(x.n) ? 'Re-apply' : 'Choose'), pickedLabel: '✓ Chosen',
      onPick: x => {
        let gone = 0;
        featuresFor(x.n, 'archetype', 0, n0(k.level)).then(feats => {
          mutateChar(charId, c => {
            const kk = c.classes[classIdx]; if (!kk) return;
            if (kk.archetype && lc(kk.archetype) !== lc(x.n)) gone = dropArchetypeFeatures(c, kk.archetype);
            kk.archetype = x.n.slice(0, 60);
            for (const f of feats) if (!hasFeature(c, f.n)) c.features.push({ name: f.n, text: `Archetype feature (${x.n}, level ${f.lvl})\n${f.text}`.slice(0, 4000) });
          });
          H.toast(`${x.n}: ${feats.length} feature${feats.length === 1 ? '' : 's'} added${gone ? `, ${gone} from the old archetype removed` : ''}`);
        }).catch(err => H.toast(err.message, true));
        H.closeModal();
      },
    });
  }

  // --------------------------------------------------------------------------- features & traits picker
  const featureTabs = charId => {
    const ch = () => charOf(charId);
    const add = (name, text) => { mutateChar(charId, c => { c.features.push({ name: name.slice(0, 80), text: text.slice(0, 4000) }); }); H.toast(`Added ${name}`); };
    const act = (x, i) => pickBtn(i, 'Add', hasFeature(ch(), x.n));
    const classNames = () => (ch().classes || []).map(k => k.name);
    return [
      { key: 'feats', label: 'Feats', load: () => list('feats'), facets: [{ key: 'src', label: 'books', get: x => x.src }],
        row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}${x.asi.length ? `<span class="pp-tag">+1 ${esc(x.asi.join(' or '))}</span>` : ''}<div class="pp-meta">${x.pre ? 'Requires ' + esc(x.pre) : ''}</div>`,
        detail: x => md(x.text), action: act, onPick: x => add(x.n, `Feat${x.pre ? ' (requires ' + x.pre + ')' : ''}\n${x.text}`) },
      { key: 'class', label: 'Class features', load: async () => (await list('features')).filter(f => classNames().some(c => lc(c) === lc(f.of)) || (ch().classes || []).some(k => lc(k.archetype) === lc(f.of))),
        facets: [{ key: 'of', label: 'classes', get: x => x.of }, { key: 'lvl', label: 'levels', get: x => x.lvl, names: {} }],
        row: x => `<b>${esc(x.n)}</b><span class="pp-lvl">${esc(x.of)} ${n0(x.lvl)}</span>${x.k === 'archetype' ? '<span class="pp-tag">archetype</span>' : ''}`,
        detail: x => md(x.text), action: act, onPick: x => add(x.n, `${x.k === 'archetype' ? 'Archetype' : 'Class'} feature (${x.of}, level ${x.lvl})\n${x.text}`) },
      { key: 'maneuvers', label: 'Maneuvers', load: () => list('maneuvers'), facets: [{ key: 'type', label: 'types', get: x => x.type }, { key: 'src', label: 'books', get: x => x.src }],
        row: x => `<b>${esc(x.n)}</b><span class="pp-lvl">${esc(x.type)}</span>${srcTag(x.src)}<div class="pp-meta">${x.pre ? 'Requires ' + esc(x.pre) : ''}</div>`,
        detail: x => md(x.text), action: act, onPick: x => add(x.n, `Maneuver (${x.type})\n${x.text}`) },
      { key: 'styles', label: 'Fighting styles', load: () => list('styles'), facets: [{ key: 'src', label: 'books', get: x => x.src }],
        row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}`, detail: x => md(x.text), action: act, onPick: x => add(x.n, `Fighting style\n${x.text}`) },
      { key: 'masteries', label: 'Fighting masteries', load: () => list('masteries'), facets: [{ key: 'src', label: 'books', get: x => x.src }],
        row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}`, detail: x => md(x.text), action: act, onPick: x => add(x.n, `Fighting mastery\n${x.text}`) },
      { key: 'forms', label: 'Lightsaber forms', load: () => list('forms'), facets: [{ key: 'src', label: 'books', get: x => x.src }],
        row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}`, detail: x => md(x.text), action: act, onPick: x => add(x.n, `Lightsaber form\n${x.text}`) },
      { key: 'ventures', label: 'Starship ventures', load: () => list('ventures'),
        row: x => `<b>${esc(x.n)}</b>${srcTag(x.src)}<div class="pp-meta">${x.pre ? 'Requires ' + esc(x.pre) : ''}</div>`,
        detail: x => md(x.md), action: act, onPick: x => add(x.n, `Starship venture${x.pre ? ' (requires ' + x.pre + ')' : ''}\n${x.md}`) },
    ];
  };
  function openFeaturePicker(charId) {
    picker({ title: '＋ Add from SW5e', intro: 'Feats, class and archetype features, maneuvers, fighting styles and masteries, lightsaber forms and starship ventures. Each is added with its full text (hover the name on the sheet).', tabs: featureTabs(charId) });
  }

  // --------------------------------------------------------------------------- level-up suggestions
  // The class (and archetype) features SW5e gives at the new level, for the level-up wizard.
  async function levelFeatures(cls, level, archetype) {
    const all = await list('features');
    return all.filter(f => f.lvl === level && lc(f.n) !== 'ability score improvement'
      && ((f.k === 'class' && lc(f.of) === lc(cls)) || (archetype && f.k === 'archetype' && lc(f.of) === lc(archetype))))
      .map(f => ({ name: f.n, text: `${f.k === 'archetype' ? 'Archetype' : 'Class'} feature (${f.of}, level ${f.lvl})\n${f.text}`.slice(0, 4000) }));
  }
  // The choices a class makes at its new level, counted against what its table allows (audit 2.9): its own options
  // (Berserker Instincts, Operative Exploits, Fighter Strategies...), maneuvers, a fighting style, Expertise.
  // lists = { classes, maneuvers, styles } as SW5e's lists serve them. Each group says how many to pick (min..max: the
  // new ones this level, and up to the class's total if the sheet is behind) and what can be picked: what the sheet
  // doesn't have yet, past its prerequisite level. 'powers' rows are the power counts, for the wizard to show.
  function levelChoices(ch, cls, L, lists) {
    const cl = (lists.classes || []).find(c => lc(c.n) === lc(cls));
    const known = new Set((ch.features || []).map(f => lc(f.name)));
    const fresh = all => all.filter(x => !known.has(lc(x.n)) && !(typeof x.pre === 'number' && x.pre > L));
    const groups = [];
    const counted = (key, title, row, all, text) => {
      const have = all.filter(x => known.has(lc(x.n))).length, items = fresh(all).map(x => ({ n: x.n, pre: typeof x.pre === 'string' ? x.pre : '', text: text(x) }));
      const max = Math.min(items.length, Math.max(0, row.total - have)), min = Math.min(max, row.total - row.prev);
      if (max > 0) groups.push({ key, title, kind: key, min, max, have, total: row.total, items });
    };
    for (const row of R.choiceCounts(cls, L)) {
      if (row.kind === 'powers') { if (row.total > row.prev) groups.push({ key: row.col, title: row.col, kind: 'powers', min: 0, max: row.total - row.prev, total: row.total, prev: row.prev, items: [] }); }
      else if (row.kind === 'maneuvers') counted('maneuvers', 'Maneuvers', row, lists.maneuvers || [], x => `Maneuver (${x.type})\n${x.text}`);
      else if (cl && cl.opts) counted('opts', cl.opts.title, row, cl.opts.items, x => `${cl.opts.title} (${cl.n})\n${x.text}`);
    }
    // the Features column names what a level brings, Expertise at Operative 6 included (the feature list files it under 1st)
    const feats = String((cl && cl.lv && cl.lv[L - 1]) || '').split(',').map(x => lc(x.trim()));
    if (feats.includes('fighting style')) {
      const items = fresh(lists.styles || []).map(x => ({ n: x.n, pre: '', text: `Fighting style\n${x.text}` }));
      if (items.length) groups.push({ key: 'style', title: 'Fighting Style', kind: 'style', min: 1, max: 1, items });
    }
    if (feats.includes('expertise')) {
      const items = R.SKILLS.filter(k => +(ch.skills || {})[k.key] === 1).map(k => ({ n: k.name, key: k.key, pre: '', text: '' }));
      groups.push({ key: 'expertise', title: 'Expertise', kind: 'expertise', min: 2, max: 2, items });
    }
    return groups;
  }
  const archetypesOf = async cls => (await list('archetypes')).filter(a => lc(a.cls) === lc(cls)).map(a => a.n);
  const featNamed = async name => (await list('feats')).find(f => lc(f.n) === lc(name)) || null;
  const featNames = async () => (await list('feats')).map(f => f.n);

  // --------------------------------------------------------------------------- Scum and Villainy: creatures
  const mod = v => Math.floor((n0(v) - 10) / 2);
  const fmt = v => (v >= 0 ? '+' : '') + v;
  function statBlock(m, opts = {}) {
    const kinds = [['trait', ''], ['action', 'Actions'], ['bonus', 'Bonus actions'], ['reaction', 'Reactions'], ['legendary', 'Legendary actions']];
    const line = (label, v) => (v && v.length ? `<div><b>${label}</b> ${esc(Array.isArray(v) ? v.join(', ') : v)}</div>` : '');
    return `<div class="statblock">
      <div class="sb-name">${esc(m.n)}</div>
      <div class="sb-sub">${esc([m.size, m.types.join(', ')].filter(Boolean).join(' '))}${m.align ? ', ' + esc(m.align) : ''}</div>
      <div class="sb-rule"></div>
      <div><b>Armor Class</b> ${n0(m.ac)}${m.at ? ` (${esc(m.at)})` : ''}</div>
      <div><b>Hit Points</b> ${n0(m.hp)}${m.hpr ? ` (${esc(m.hpr)})` : ''}</div>
      <div><b>Speed</b> ${esc(m.speed)}</div>
      <div class="sb-rule"></div>
      <div class="sb-abil">${Object.entries(m.ab).map(([k, v]) => `<div ${opts.roll ? `class="sb-roll" data-sbroll="1d20${fmt(mod(v))}" data-sblabel="${esc(m.n)}: ${ABN[k]} check"` : ''}><b>${ABN[k].toUpperCase()}</b><br>${n0(v)} (${fmt(mod(v))})</div>`).join('')}</div>
      <div class="sb-rule"></div>
      ${rollLine(m, 'Saving Throws', m.saves, 'save', opts)}${rollLine(m, 'Skills', m.skills, 'check', opts)}${line('Damage Vulnerabilities', m.vul)}${line('Damage Resistances', m.res)}
      ${line('Damage Immunities', m.imm)}${line('Condition Immunities', m.cimm)}${line('Senses', m.senses)}${line('Languages', m.langs)}
      <div><b>Challenge</b> ${esc(m.cr)}${m.xp != null ? ` (${n0(m.xp).toLocaleString()} XP)` : ''} ${srcTag(m.src)}</div>
      ${kinds.map(([k, h]) => {
        const bs = m.b.filter(b => b.k === k); if (!bs.length) return '';
        return `${h ? `<div class="sb-head">${h}</div>` : '<div class="sb-rule"></div>'}${bs.map(b => {
          const rolls = opts.roll ? `${b.atk != null ? ` <button class="btn tiny amber" data-sbroll="1d20${fmt(b.atk)}" data-sblabel="${esc(m.n)}: ${esc(b.n)} (attack)">${fmt(b.atk)} to hit</button>` : ''}${b.dmg ? ` <button class="btn tiny" data-sbroll="${esc(b.dmg.replace(/\s+/g, ''))}" data-sblabel="${esc(m.n)}: ${esc(b.n)} (${esc(b.dt || '')} damage)">${esc(b.dmg)}${b.dt ? ' ' + esc(b.dt) : ''}</button>` : ''}` : '';
          return `<div class="sb-b"><b><i>${esc(b.n)}.</i></b>${rolls} ${md(b.d.replace(new RegExp('^\\s*' + b.n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.\\s*'), '')).replace(/^<p>|<\/p>$/g, '')}</div>`;
        }).join('')}`;
      }).join('')}
      ${m.flavor ? `<details class="pp-desc"><summary>About</summary>${md(m.flavor)}</details>` : ''}
    </div>`;
  }
  // "Dex +5", "Insight+12", "Dex + 6", "* Dex +7", "Stealth +14 Survival +8": each name with its bonus.
  // Entries with no number (a bare "Cha") come back as plain text.
  function bonuses(list) {
    const out = [];
    for (const s of list || []) {
      const re = /([A-Za-z][A-Za-z ]*?)\s*([+-])\s*(\d+)/g; let m, any = false;
      while ((m = re.exec(s))) { any = true; out.push({ name: m[1].trim(), bonus: (m[2] === '-' ? -1 : 1) * +m[3] }); }
      if (!any) out.push({ text: s });
    }
    return out;
  }
  const SAVE_AB = { str: 'str', strength: 'str', dex: 'dex', dexterity: 'dex', con: 'con', constitution: 'con', int: 'int', intelligence: 'int', wis: 'wis', wisdom: 'wis', cha: 'cha', charisma: 'cha' };
  // a creature's save for one ability: its listed bonus, or the plain ability modifier when it isn't proficient
  function saveBonus(m, ab) {
    const hit = bonuses(m.saves).find(x => x.name && SAVE_AB[x.name.toLowerCase()] === ab);
    return hit ? hit.bonus : mod(m.ab[ab]);
  }
  // the saves and skills lines, each entry a GM-only roll when the stat block can roll
  function rollLine(m, label, list, what, opts) {
    if (!list || !list.length) return '';
    if (!opts.roll) return `<div><b>${label}</b> ${esc(list.join(', '))}</div>`;
    return `<div><b>${label}</b> ${bonuses(list).map(x => x.text != null ? esc(x.text)
      : `<button class="btn tiny sb-chip" data-sbroll="1d20${fmt(x.bonus)}" data-sblabel="${esc(m.n)}: ${esc(what === 'save' ? (ABN[SAVE_AB[x.name.toLowerCase()]] || x.name) : x.name)} ${what}">${esc(x.name)} ${fmt(x.bonus)}</button>`).join(' ')}</div>`;
  }
  // ---- encounter difficulty (audit 9.7): the creatures' XP, multiplied for their numbers, against the party's
  // thresholds. SW5e uses 5e's encounter-building tables: XP thresholds per character level (easy, medium, hard,
  // deadly), and a multiplier by the number of creatures, one step up for a party under 3 and one down for 6 or more.
  const XP_TH = [null, [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
    [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
    [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
    [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700]];
  const MULT = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];
  function xpMultiplier(creatures, party) {
    let i = creatures <= 1 ? 1 : creatures === 2 ? 2 : creatures <= 6 ? 3 : creatures <= 10 ? 4 : creatures <= 14 ? 5 : 6;
    if (party > 0 && party < 3) i += 1; else if (party >= 6) i -= 1;
    return MULT[Math.max(0, Math.min(MULT.length - 1, i))];
  }
  // levels: each party member's character level; xps: each creature's XP. Returns the numbers and the rating.
  function difficulty(levels, xps) {
    const th = [0, 0, 0, 0];
    for (const l of levels) XP_TH[Math.max(1, Math.min(20, Math.round(+l) || 1))].forEach((v, k) => { th[k] += v; });
    const raw = xps.reduce((a, b) => a + (+b || 0), 0), mult = xpMultiplier(xps.length, levels.length), adj = Math.round(raw * mult);
    const k = th.filter(v => adj >= v).length;   // how many thresholds the encounter reaches
    return { raw, mult, adj, th, rating: !xps.length || !levels.length ? '' : ['Trivial', 'Easy', 'Medium', 'Hard', 'Deadly'][k] };
  }
  // the GM's meter above the initiative list. Party: the characters in initiative; before any have rolled, every
  // character not owned by this GM. Creatures: entries added from the SW5e list (others have no XP to count).
  async function renderEncounter(el, entries, characters, me) {
    if (!el) return;
    const inIni = entries.filter(e => e.charId && characters[e.charId]).map(e => characters[e.charId]);
    const party = inIni.length ? inIni : Object.values(characters).filter(c => c.owner !== me);
    const foes = entries.filter(e => !e.charId), withSb = foes.filter(e => e.sb);
    if (!withSb.length) { el.innerHTML = foes.length ? '<span class="muted">Encounter difficulty: add creatures from the SW5e list to rate this fight.</span>' : ''; return; }
    let mons;
    try { mons = await list('monsters'); } catch { el.innerHTML = ''; return; }
    const xps = withSb.map(e => (mons.find(m => m.n === e.sb) || {}).xp).filter(v => v != null);
    const d = difficulty(party.map(c => R.totalLevel(c)), xps);
    if (!party.length) { el.innerHTML = '<span class="muted">Encounter difficulty: no party characters yet.</span>'; return; }
    const f = v => n0(v).toLocaleString(), lv = party.map(c => R.totalLevel(c));
    const skipped = foes.length - xps.length;
    el.innerHTML = `<span class="enc-rating enc-${d.rating.toLowerCase()}">${esc(d.rating)}</span>
      <span><b>${f(d.adj)}</b> XP adjusted <span class="muted">(${f(d.raw)} × ${d.mult} for ${xps.length} creature${xps.length === 1 ? '' : 's'})</span></span>
      <span class="muted" title="${esc(party.map(c => `${c.name} (level ${R.totalLevel(c)})`).join(', '))}">Party of ${party.length}${inIni.length ? '' : ' (everyone; none in initiative yet)'}, level${new Set(lv).size > 1 ? 's' : ''} ${esc([...new Set(lv)].sort((a, b) => a - b).join('/'))}:
        easy ${f(d.th[0])} · medium ${f(d.th[1])} · hard ${f(d.th[2])} · deadly ${f(d.th[3])}</span>
      ${skipped ? `<span class="muted">${skipped} without an SW5e stat block not counted</span>` : ''}
      <button class="btn tiny" id="encAwardXp" data-xp="${n0(d.raw)}" title="When the fight is over: give the party the creatures' XP (${f(d.raw)}, before the multiplier), split among them">★ Award XP…</button>`;
  }
  const crNum = cr => (/^\d+\/\d+$/.test(cr) ? eval_frac(cr) : +cr || 0);
  function eval_frac(s) { const [a, b] = s.split('/'); return +a / +b; }
  // the GM's rolls from a stat block stay between the GM and the server (GM-only rolls)
  function sbRoll(expr, label, e) {
    if (/^1d20/.test(expr)) {   // d20 rolls: shift-click for advantage, ctrl-click for disadvantage, else the table's mode
      const mode = H.rollModeFromEvent ? H.rollModeFromEvent(e) : 'normal';
      if (mode === 'adv') { expr = expr.replace(/^1d20/, '2d20kh1'); label += ' (adv)'; }
      if (mode === 'dis') { expr = expr.replace(/^1d20/, '2d20kl1'); label += ' (dis)'; }
    }
    const kind = /\(attack\)/.test(label) ? 'attack' : /(save|check)( \((adv|dis)\))?$/.test(label) ? 'check' : 'damage';
    return H.act('roll', { expr, label, private: true, kind });
  }
  // the tracker's "Save…" menu for a creature: rolls its saving throw for one ability, GM-only
  async function rollCreatureSave(sb, ab, name, e) {
    const m = (await list('monsters')).find(x => x.n === sb);
    if (!m || !ABN[ab]) return;
    return sbRoll(`1d20${fmt(saveBonus(m, ab))}`, `${name || m.n}: ${ABN[ab]} save`, e);
  }
  function sbRollHandler(box) {
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-sbroll]'); if (!b) return;
      e.preventDefault();
      sbRoll(b.dataset.sbroll, b.dataset.sblabel, e);
    });
  }
  function openMonsterPicker() {
    picker({
      title: '☠ Add a creature (Scum and Villainy)', intro: 'Adds the creature to the initiative order (rolled with its Dex) with its HP and AC, and a map token if you like. Its stat block opens from the 📜 button in the combat list.',
      load: () => list('monsters'),
      facets: [{ key: 'cr', label: 'challenge ratings', get: x => x.cr }, { key: 'type', label: 'types', get: x => x.types[0] || '' }, { key: 'size', label: 'sizes', get: x => x.size }],
      search: x => x.n + ' ' + x.types.join(' '),
      row: x => `<b>${esc(x.n)}</b><span class="pp-lvl">CR ${esc(x.cr)}</span><span class="pp-tag">${esc(x.size)} ${esc(x.types.join(', '))}</span>
        <div class="pp-meta">AC ${n0(x.ac)} · HP ${n0(x.hp)}${x.hpr ? ` (${esc(x.hpr)})` : ''} · ${esc(x.speed)}</div>`,
      detail: x => statBlock(x), detailLabel: 'Stat block',
      action: (x, i) => `<div class="mon-add"><input type="number" min="1" max="20" value="1" class="mon-n" title="How many" aria-label="How many ${esc(x.n)}">
        <button class="btn small primary" data-bp="pick" data-i="${i}">Add</button></div>`,
      onPick: (x, b) => { addMonsters(x, Math.max(1, Math.min(20, +b.parentElement.querySelector('.mon-n').value || 1))); b.textContent = 'Add more'; return false; },
    });
  }
  async function addMonsters(m, count) {
    const hidden = !!($('#npcHidden') && $('#npcHidden').checked), token = !$('#npcToken') || $('#npcToken').checked;
    const rollHp = !!($('#npcRollHp') && $('#npcRollHp').checked) && m.hpr;
    for (let k = 1; k <= count; k++) {
      const nm = (count > 1 ? `${m.n} ${k}` : m.n).slice(0, 60);
      let hp = n0(m.hp);
      if (rollHp) { const r = await H.act('roll', { expr: m.hpr.replace(/\s+/g, ''), label: `${nm}: hit points`, private: true }); if (r && r.roll) hp = Math.max(1, r.roll.total); }
      await H.act('init.add', { name: nm, bonus: mod(m.ab.dex), hp, ac: n0(m.ac), hidden, sb: m.n });
      if (token) await H.act('token.add', { name: nm, color: '#ef5350', x: 2 * k, y: 2, hidden, size: { Large: 2, Huge: 3, Gargantuan: 4 }[m.size] || 1 });
    }
    H.toast(`Added ${count} × ${m.n}`);
  }
  async function openStatBlock(name) {
    H.modal('<div id="sbm"><p class="muted">Loading…</p></div>', async box => {
      const el = $('#sbm', box);
      try {
        const m = (await list('monsters')).find(x => x.n === name);
        el.innerHTML = m ? statBlock(m, { roll: true }) + '<p class="muted" style="font-size:12px">Rolls from here are GM-only.</p><div class="row"><span class="spacer"></span><button class="btn primary" id="sbClose">Close</button></div>'
          : `<p>${esc(name)} isn't in the SW5e list.</p>`;
      } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      sbRollHandler(el);
      el.addEventListener('click', e => { if (e.target.id === 'sbClose') H.closeModal(); });
    });
  }

  // --------------------------------------------------------------------------- rules library
  const BOOKS = [
    { key: 'rules-phb', name: "Player's Handbook" },
    { key: 'rules-ec', name: 'Expanded Content' },
    { key: 'rules-wh', name: 'Wretched Hives' },
    { key: 'rules-sotg', name: 'Starships of the Galaxy' },
    { key: 'rules-variant', name: 'Variant Rules', variants: true },
    { key: 'monsters', name: 'Scum and Villainy', monsters: true, gmOnly: 'statBlocksHidden' },
    { key: 'tables', name: 'Reference tables', entries: true },
    { key: 'weapon-props', name: 'Weapon properties', entries: true },
    { key: 'armor-props', name: 'Armor properties', entries: true },
  ];
  const LIB = { book: null, ch: 0, q: '' };
  function libraryBar() {
    const v = (H.S.st && H.S.st.variants) || [];
    return `<div class="box lib-bar"><h4>SW5e rulebooks <span class="spacer"></span><span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">from <a href="https://sw5e.com" target="_blank" rel="noopener noreferrer">sw5e.com</a>, a free fan project</span></h4><div class="row wrap">${BOOKS.filter(b => !(b.gmOnly && !H.isGM() && (H.S.st || {})[b.gmOnly])).map(b => `<button class="btn small" data-lib="${esc(b.key)}">${esc(b.name)}</button>`).join('')}</div>
      ${v.length ? `<div style="margin-top:8px"><span class="muted">Variant rules in use at this table:</span> ${v.map(n => `<button class="chip lib-var" data-lib="rules-variant" data-libch="${esc(n)}">${esc(n)}</button>`).join(' ')}</div>` : ''}</div>`;
  }
  async function openBook(key, chapterName) {
    const book = BOOKS.find(b => b.key === key); if (!book) return;
    LIB.book = book; LIB.q = '';
    const el = $('#rules');
    el.innerHTML = `<div class="lib"><div class="row"><button class="btn small ghost" data-lib="back">← Quick reference</button><h3 style="margin:0">${esc(book.name)}</h3></div><p class="muted">Loading…</p></div>`;
    let data;
    try { data = await list(key); } catch (err) { el.querySelector('.lib').insertAdjacentHTML('beforeend', `<p class="error">${esc(err.message)}</p>`); return; }
    if (LIB.book !== book) return;
    const chapters = book.monsters ? data.map(m => ({ n: m.n, mon: m })) : book.entries ? data.map(e => ({ n: e.n, md: e.md })) : data;
    LIB.chapters = chapters;
    LIB.ch = Math.max(0, chapterName ? chapters.findIndex(c => c.n === chapterName) : 0);
    renderBook();
  }
  function renderBook() {
    const book = LIB.book, chs = LIB.chapters, q = LIB.q.toLowerCase(), gm = H.isGM(), used = new Set((H.S.st && H.S.st.variants) || []);
    const hits = chs.map((c, i) => ({ c, i })).filter(({ c }) => !q || c.n.toLowerCase().includes(q) || (c.md || '').toLowerCase().includes(q) || (c.mon && JSON.stringify(c.mon).toLowerCase().includes(q)));
    const cur = chs[LIB.ch] || chs[0];
    const body = !cur ? '<p class="muted">Empty.</p>' : cur.mon ? statBlock(cur.mon, { roll: gm }) : (() => { const r = mdBlock(cur.md, { idPrefix: 'lib' }); return (r.toc.length > 3 ? `<details class="lib-toc"><summary>On this page</summary>${r.toc.map(t => `<a href="#${t.id}" class="lib-toc-${t.lvl}" data-libjump="${t.id}">${t.txt}</a>`).join('')}</details>` : '') + r.html; })();
    $('#rules').innerHTML = `<div class="lib">
      <div class="row wrap"><button class="btn small ghost" data-lib="back">← Quick reference</button><h3 style="margin:0">${esc(book.name)}</h3><span class="spacer"></span>
        <input id="libSearch" placeholder="Search this book…" value="${esc(LIB.q)}" style="min-width:200px"></div>
      <p class="lib-credit muted">Rules text from SW5e, a free fan project: <a href="https://sw5e.com" target="_blank" rel="noopener noreferrer">sw5e.com</a></p>
      <div class="lib-body"><nav class="lib-nav">${hits.map(({ c, i }) => `<button class="${i === LIB.ch ? 'on' : ''}" data-libgo="${i}">${esc(c.n)}${book.variants && used.has(c.n) ? ' <span class="lib-on">in use</span>' : ''}</button>`).join('') || '<p class="muted">No matches.</p>'}</nav>
        <article class="lib-page">
          ${book.variants && cur ? `<div class="lib-variant ${used.has(cur.n) ? 'on' : ''}">${used.has(cur.n) ? '✓ This table uses this variant rule.' : 'This table doesn\'t use this variant rule.'}
            ${gm ? `<button class="btn tiny ${used.has(cur.n) ? 'ghost' : 'amber'}" data-libvar="${esc(cur.n)}">${used.has(cur.n) ? 'Stop using it' : 'Use at this table'}</button>` : ''}</div>` : ''}
          ${!cur || cur.mon ? '' : `<h2 class="lib-title">${esc(cur.n)}</h2>`}${body}</article></div></div>`;
    if (gm && cur && cur.mon) sbRollHandler($('#rules .lib-page'));
  }
  $('#rules').addEventListener('click', e => {
    const b = e.target.closest('[data-lib], [data-libgo], [data-libvar], [data-libjump]'); if (!b) return;
    if (b.dataset.libjump) { e.preventDefault(); const t = document.getElementById(b.dataset.libjump); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (b.dataset.lib === 'back') { LIB.book = null; H.renderRules(); return; }
    if (b.dataset.lib) return openBook(b.dataset.lib, b.dataset.libch);
    if (b.dataset.libgo) { LIB.ch = +b.dataset.libgo; renderBook(); $('#pane-rules').scrollTop = 0; return; }
    if (b.dataset.libvar && H.isGM()) {
      const cur = new Set(H.S.st.variants || []), n = b.dataset.libvar;
      cur.has(n) ? cur.delete(n) : cur.add(n);
      H.S.st.variants = [...cur];
      H.act('variants.set', { variants: [...cur] }).then(r => { if (r) H.toast(cur.has(n) ? `${n}: now used at this table` : `${n}: no longer used`); });
      renderBook();
    }
  });
  $('#rules').addEventListener('input', e => {
    if (e.target.id !== 'libSearch') return;
    LIB.q = e.target.value; const pos = e.target.selectionStart;
    renderBook(); const inp = $('#libSearch'); inp.focus(); inp.setSelectionRange(pos, pos);
  });

  // --------------------------------------------------------------------------- Starships of the Galaxy
  const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
  const DEPLOY = ['Coordinator', 'Gunner', 'Mechanic', 'Operator', 'Pilot', 'Technician'];
  const SKILLS = [['astrogation', 'Astrogation', 'int'], ['boost', 'Boost', 'str'], ['data', 'Data', 'int'], ['hide', 'Hide', 'dex'], ['impress', 'Impress', 'cha'],
    ['interfere', 'Interfere', 'cha'], ['maneuvering', 'Maneuvering', 'dex'], ['menace', 'Menace', 'cha'], ['patch', 'Patch', 'con'], ['probe', 'Probe', 'int'],
    ['ram', 'Ram', 'str'], ['regulation', 'Regulation', 'con'], ['scan', 'Scan', 'wis'], ['swindle', 'Swindle', 'cha']];
  const SH = { sel: null, as: 0 };
  const ships = () => (H.S.st && H.S.st.ships) || [];
  const blankShip = () => ({ name: 'New ship', size: 'Small', tier: 0, role: '', model: '', ac: 10, hull: { current: 0, max: 0 }, shield: { current: 0, max: 0 },
    hullDice: '', shieldDice: '', shieldRegen: '', speed: 300, turn: 0, hyper: '', fuel: '', cargo: '', suites: '', slots: '',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, saves: {}, skills: {}, crew: [], weapons: [], equipment: [], mods: [], notes: '', color: '#90a4ae' });
  const canEditShip = s => s && (H.isGM() || !s.hidden);
  const crewPb = (s, c) => { const ch = c && c.charId && charOf(c.charId); return ch ? R.profBonus(ch) : n0(c && c.pb) || 2; };
  function saveShip(s) {
    const i = ships().findIndex(x => x.id === s.id); if (i >= 0) H.S.st.ships[i] = s;
    renderShipsSafe();
    return H.act('ship.save', { ship: s });
  }
  const mutateShip = fn => { const s = JSON.parse(JSON.stringify(ships().find(x => x.id === SH.sel))); if (!s) return; fn(s); saveShip(s); };
  function shipInp(path, val, o = {}) {
    const ro = o.ro ? 'disabled' : '', type = o.type || (typeof val === 'number' ? 'number' : 'text');
    if (type === 'select') return `<select data-sp="${path}" ${ro}>${o.options.map(v => `<option ${String(v) === String(val) ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    if (type === 'textarea') return `<textarea data-sp="${path}" rows="${o.rows || 3}" ${ro} placeholder="${esc(o.ph || '')}">${esc(val)}</textarea>`;
    if (type === 'checkbox') return `<input type="checkbox" data-sp="${path}" ${val ? 'checked' : ''} ${ro}>`;
    return `<input type="${type}" data-sp="${path}" value="${esc(val ?? '')}" ${ro} placeholder="${esc(o.ph || '')}" ${o.w ? `style="width:${o.w}"` : ''}>`;
  }
  function renderShips(el) {
    const list_ = ships(), gm = H.isGM();
    if (SH.sel && !list_.some(s => s.id === SH.sel)) SH.sel = null;
    if (!SH.sel && list_.length) SH.sel = list_[0].id;
    const s = list_.find(x => x.id === SH.sel);
    let html = `<div class="row wrap ship-top"><h3 style="margin:0">Starships</h3>
      ${list_.map(x => `<button class="btn small ${x.id === SH.sel ? 'primary' : ''}" data-sa="sel" data-id="${esc(x.id)}">${esc(x.name)}${x.hidden ? ' <span class="muted">(hidden)</span>' : ''}</button>`).join('')}
      <span class="spacer"></span><button class="btn small" data-sa="new">＋ New ship</button>${gm ? '<button class="btn small ghost" data-sa="new-hidden" title="Only you can see it, e.g. an enemy ship">＋ Hidden ship</button>' : ''}
      <button class="btn small ghost" data-sa="rules">Starship rules</button></div>`;
    if (!s) { el.innerHTML = html + `<div class="empty"><h2>No ships yet</h2><p>Make the party's ship with “＋ New ship”. Ship sheets follow <i>Starships of the Galaxy</i>: size and tier, hull and shield points, ship ability scores and skills, crew deployments, weapons, equipment and modifications.</p></div>`; return; }
    const ro = !canEditShip(s), m = k => Math.floor((n0(s.abilities[k]) - 10) / 2);
    const crew = s.crew || [], as = crew[SH.as] ? SH.as : 0, pb = crewPb(s, crew[as]);
    const crewName = c => (c.charId && charOf(c.charId) ? charOf(c.charId).name : c.name) || 'Crew member';
    const pts = (k, label) => `<div class="stat"><div class="lbl">${label}</div><div class="row" style="justify-content:center;gap:4px">${shipInp(k + '.current', n0(s[k].current), { ro, w: '64px' })}<span class="muted">/</span>${shipInp(k + '.max', n0(s[k].max), { ro, w: '64px' })}</div></div>`;
    html += `<div class="ship-sheet">
      <div class="row wrap">${shipInp('name', s.name, { ro })}${shipInp('model', s.model, { ro, ph: 'Model (e.g. YT-1300)' })}
        <label class="mini">Size ${shipInp('size', s.size, { ro, type: 'select', options: SIZES })}</label><label class="mini">Tier ${shipInp('tier', n0(s.tier), { ro, type: 'select', options: [0, 1, 2, 3, 4, 5] })}</label>
        ${shipInp('role', s.role, { ro, ph: 'Role (e.g. freighter)' })}
        ${gm ? `<label class="toggle"><input type="checkbox" data-sp="hidden" ${s.hidden ? 'checked' : ''}> hidden from players</label>` : ''}
        <span class="spacer"></span>${!ro ? '<button class="btn small danger" data-sa="delete">Delete</button>' : ''}</div>
      <div class="stats-row">
        <div class="stat"><div class="lbl">Armor Class</div>${shipInp('ac', n0(s.ac), { ro })}</div>
        ${pts('hull', 'Hull points')}${pts('shield', 'Shield points')}
        <div class="stat"><div class="lbl">Speed (ft)</div>${shipInp('speed', n0(s.speed), { ro })}</div>
        <div class="stat"><div class="lbl">Turning (ft)</div>${shipInp('turn', n0(s.turn), { ro })}</div>
        <div class="stat"><div class="lbl">Hyperdrive</div>${shipInp('hyper', s.hyper, { ro, ph: 'class' })}</div>
      </div>
      ${!ro ? `<div class="row wrap ship-dmg"><span class="muted" style="font-size:12px">Hull dice ${shipInp('hullDice', s.hullDice, { ro, w: '80px', ph: 'e.g. 3d10' })} Shield dice ${shipInp('shieldDice', s.shieldDice, { ro, w: '80px', ph: 'e.g. 3d10' })} Regen ${shipInp('shieldRegen', s.shieldRegen, { ro, w: '90px' })}</span></div>` : ''}
      ${window.HTShipSheet ? HTShipSheet.block(s, ro, { pb, as }) : ''}
      <div class="grid g2" style="margin-top:12px">
        <div class="box"><h4>Crew &amp; deployments</h4>
          <table class="t"><thead><tr><th>Crew member</th><th>Deployment</th><th>Rank</th><th>Prof.</th><th></th></tr></thead><tbody>
          ${crew.map((c, i) => `<tr><td>${!ro ? `<select data-sp="crew.${i}.charId"><option value="">${esc(c.charId ? '' : c.name || '(other)')}</option>${H.chars().map(ch => `<option value="${esc(ch.id)}" ${ch.id === c.charId ? 'selected' : ''}>${esc(ch.name)}</option>`).join('')}</select>` : esc(crewName(c))}</td>
            <td>${shipInp(`crew.${i}.deployment`, c.deployment, { ro, type: 'select', options: ['', ...DEPLOY] })} ${c.deployment ? `<button class="btn tiny ghost" data-sa="deploy-info" data-dep="${esc(c.deployment)}" title="Deployment features">ⓘ</button>` : ''}</td>
            <td>${shipInp(`crew.${i}.rank`, n0(c.rank), { ro, type: 'select', options: [0, 1, 2, 3, 4, 5] })}</td>
            <td>${c.charId ? R.fmt(crewPb(s, c)) : shipInp(`crew.${i}.pb`, n0(c.pb) || 2, { ro, w: '50px' })}</td>
            <td>${!ro ? `<button class="btn tiny ghost" data-sa="del" data-list="crew" data-i="${i}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No crew yet.</td></tr>'}</tbody></table>
          ${!ro ? '<button class="btn tiny" data-sa="add-crew">＋ crew member</button>' : ''}
          <p class="muted" style="font-size:12px;margin:6px 0 0">Ship rolls add the acting crew member's proficiency bonus when the ship is proficiently equipped.</p></div>
        <div class="box"><h4>Ship abilities <span class="spacer"></span><span class="muted" style="text-transform:none;letter-spacing:0">Rolling as</span>
          <select data-sa-change="as">${crew.length ? crew.map((c, i) => `<option value="${i}" ${i === as ? 'selected' : ''}>${esc(crewName(c))} (${R.fmt(crewPb(s, c))})</option>`).join('') : '<option>no crew (+2)</option>'}</select></h4>
          <div class="ship-abil">${R.ABILITIES.map(a => `<div class="stat ability"><div class="lbl">${a.name}</div><div class="val sb-roll" data-shiproll="1d20${fmt(m(a.key))}" data-kind="check" data-ab="${a.key}" data-label="${esc(s.name)}: ${a.name} check">${fmt(m(a.key))}</div>
            ${shipInp('abilities.' + a.key, n0(s.abilities[a.key]), { ro })}
            <label class="toggle" title="Proficiently equipped for this saving throw">${shipInp('saves.' + a.key, s.saves[a.key], { ro, type: 'checkbox' })}<span class="sb-roll" data-shiproll="1d20${fmt(m(a.key) + (s.saves[a.key] ? pb : 0))}" data-kind="save" data-ab="${a.key}" data-label="${esc(s.name)}: ${a.name} save">save ${fmt(m(a.key) + (s.saves[a.key] ? pb : 0))}</span></label></div>`).join('')}</div>
          <h4 style="margin-top:10px">Ship skills <span class="muted" style="text-transform:none;letter-spacing:0">dot: none → proficiently → expertly equipped</span></h4>
          <div class="list-rows ship-skills">${SKILLS.map(([k, name, ab]) => { const lv = n0(s.skills[k]), b = m(ab) + lv * pb; return `<div class="lr"><button class="prof ${lv === 2 ? 'p2' : lv === 1 ? 'p1' : ''}" data-sa="skill" data-k="${k}" ${ro ? 'disabled' : ''}></button>
            <span class="bonus">${fmt(b)}</span><span class="nm rollable" data-shiproll="1d20${fmt(b)}" data-kind="check" data-ab="${ab}" data-label="${esc(s.name)}: ${name}">${name}</span><span class="ab">${ab}</span></div>`; }).join('')}</div></div>
      </div>
      <div class="box" style="margin-top:12px"><h4>Weapons <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-sa="pick-equip" data-weapons="1">＋ weapon from SotG</button><button class="btn tiny ghost" data-sa="add-weapon">custom</button>' : ''}</h4>
        <table class="t"><thead><tr><th>Weapon</th><th>Attack</th><th>Damage</th><th>Type</th><th>Range</th><th>Properties</th><th title="Category, mount (a fixed arc or a turret) and ammunition left (blank: not counted). The space map's Fire uses them.">Mount</th><th></th></tr></thead><tbody>
        ${(s.weapons || []).map((w, i) => { const atk = m('wis') + pb + n0(w.atkMisc), dmg = w.dmg ? w.dmg + (m('str') ? fmt(m('str')) : '') : ''; return `<tr><td>${shipInp(`weapons.${i}.name`, w.name, { ro })}</td>
          <td style="white-space:nowrap"><button class="btn small amber" data-shiproll="1d20${fmt(atk)}" data-kind="attack" data-label="${esc(s.name)}: ${esc(w.name)} (attack)" title="Wis ${fmt(m('wis'))} + crew prof. ${fmt(pb)}">${fmt(atk)}</button> ${shipInp(`weapons.${i}.atkMisc`, n0(w.atkMisc), { ro, w: '50px' })}</td>
          <td style="white-space:nowrap">${shipInp(`weapons.${i}.dmg`, w.dmg, { ro, w: '64px' })}${dmg ? ` <button class="btn small" data-shiproll="${esc(dmg)}" data-label="${esc(s.name)}: ${esc(w.name)} (${esc(w.type)} damage)" title="+ Str ${fmt(m('str'))}">Dmg</button>` : ''}</td>
          <td>${shipInp(`weapons.${i}.type`, w.type, { ro, w: '80px' })}</td><td>${shipInp(`weapons.${i}.range`, w.range, { ro, w: '100px' })}</td><td>${shipInp(`weapons.${i}.props`, w.props, { ro })}</td>
          <td style="white-space:nowrap">${shipInp(`weapons.${i}.cat`, w.cat || '', { ro, type: 'select', options: ['', 'primary', 'secondary', 'tertiary', 'quaternary'] })}${shipInp(`weapons.${i}.arc`, w.arc || '', { ro, type: 'select', options: ['', 'forward', 'starboard', 'aft', 'port', 'turret'] })}${shipInp(`weapons.${i}.ammo`, w.ammo ?? '', { ro, w: '50px', ph: 'ammo', type: 'text' })}</td>
          <td>${!ro ? `<button class="btn tiny ghost" data-sa="del" data-list="weapons" data-i="${i}">✕</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="muted">No weapons.</td></tr>'}</tbody></table>
        <p class="muted" style="font-size:12px;margin:6px 0 0">Attack = ship's Wisdom modifier + the crew member's proficiency bonus (+ the small box). Damage adds the ship's Strength modifier. Weapon save DC = 8 + Wis + proficiency: <b>${8 + m('wis') + pb}</b>.</p></div>
      <div class="grid g2" style="margin-top:12px">
        <div class="box"><h4>Equipment <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-sa="pick-equip">＋ from SotG</button><button class="btn tiny ghost" data-sa="add-eq">custom</button>' : ''}</h4>
          ${(s.equipment || []).map((x, i) => `<div class="row" style="margin-bottom:4px">${shipInp(`equipment.${i}.name`, x.name, { ro, w: '40%' })}${shipInp(`equipment.${i}.notes`, x.notes, { ro })}${!ro ? `<button class="btn tiny ghost" data-sa="del" data-list="equipment" data-i="${i}">✕</button>` : ''}</div>`).join('') || '<p class="muted">None.</p>'}
          <h4 style="margin-top:10px">Fuel, cargo &amp; suites</h4>
          <div class="row wrap"><label class="mini">Fuel ${shipInp('fuel', s.fuel, { ro, w: '90px' })}</label><label class="mini">Mod slots ${shipInp('slots', s.slots, { ro, w: '90px', ph: 'used / max' })}</label><label class="mini">Suites ${shipInp('suites', s.suites, { ro, w: '140px' })}</label></div>
          ${shipInp('cargo', s.cargo, { ro, type: 'textarea', rows: 2, ph: 'Cargo' })}</div>
        <div class="box"><h4>Modifications <span class="spacer"></span>${!ro ? '<button class="btn tiny" data-sa="pick-mod">＋ from SotG</button><button class="btn tiny ghost" data-sa="add-mod">custom</button>' : ''}</h4>
          ${window.HTShipSheet ? HTShipSheet.modsHead(s) : ''}
          ${(s.mods || []).map((x, i) => `<div class="row" style="margin-bottom:4px">${shipInp(`mods.${i}.name`, x.name, { ro, w: '40%' })}${shipInp(`mods.${i}.notes`, x.notes, { ro })}${!ro ? `<button class="btn tiny ghost" data-sa="del" data-list="mods" data-i="${i}">✕</button>` : ''}</div>${window.HTShipSheet ? HTShipSheet.modRow(s, x, i, ro, shipInp) : ''}`).join('') || '<p class="muted">None.</p>'}
          <h4 style="margin-top:10px">Notes</h4>${shipInp('notes', s.notes, { ro, type: 'textarea', rows: 4 })}</div>
      </div></div>`;
    el.innerHTML = html;
  }
  // the space map (space.js) redraws with the ships
  function renderShipsSafe() { if (window.HTSpace) HTSpace.render(); const el = $('#ships'); if (!el) return; const a = document.activeElement; if (a && el.contains(a) && a.matches('input:not([type=checkbox]), textarea, select')) return; renderShips(el); }
  const shipsEl = () => $('#ships');
  if (shipsEl()) {
    shipsEl().addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.saChange === 'as') { SH.as = +t.value || 0; return renderShips(shipsEl()); }
      if (t.dataset.sxc && window.HTShipSheet) return HTShipSheet.change(e, ships().find(x => x.id === SH.sel));
      const path = t.dataset.sp; if (!path) return;
      const s = ships().find(x => x.id === SH.sel); if (!canEditShip(s)) return;
      if (path === 'hull.current' || path === 'shield.current') return H.act('ship.points', { id: s.id, what: path.split('.')[0], current: +t.value || 0 });   // the server's, like damage
      let v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? +t.value || 0 : t.value;
      if (/^(tier|crew\.\d+\.rank)$/.test(path)) v = +v || 0;
      mutateShip(x => { H.setPath(x, path, v); if (/^crew\.\d+\.charId$/.test(path) && v) { const c = x.crew[+path.split('.')[1]]; c.name = (charOf(v) || {}).name || ''; } });
      setTimeout(() => renderShips(shipsEl()), 0);
    });
    shipsEl().addEventListener('click', async e => {
      const r = e.target.closest('[data-shiproll]');
      if (r) {
        const o = window.HTShipSheet ? HTShipSheet.rollOpts(ships().find(x => x.id === SH.sel), r, H.rollModeFromEvent(e)) : { mode: H.rollModeFromEvent(e), label: r.dataset.label };
        return H.roll(r.dataset.shiproll, o.label, { d20: /^1d20/.test(r.dataset.shiproll), mode: o.mode });
      }
      if (e.target.closest('[data-sx]') && window.HTShipSheet) return HTShipSheet.click(e, ships().find(x => x.id === SH.sel));
      const b = e.target.closest('[data-sa]'); if (!b) return;
      const a = b.dataset.sa, s = ships().find(x => x.id === SH.sel);
      if (a === 'sel') { SH.sel = b.dataset.id; SH.as = 0; return renderShips(shipsEl()); }
      if (a === 'rules') { H.setTab('rules'); return openBook('rules-sotg'); }
      if (a === 'new' || a === 'new-hidden') {
        const ns = blankShip(); ns.hidden = a === 'new-hidden';
        const res = await H.act('ship.save', { ship: ns }); if (res && res.id) SH.sel = res.id; return;
      }
      if (a === 'deploy-info') return openDeployment(b.dataset.dep);
      if (!canEditShip(s)) return;
      const i = +b.dataset.i;
      if (a === 'delete') { if (confirm(`Delete the ship ${s.name}?`)) H.act('ship.delete', { id: s.id }); return; }
      if (a === 'del') return mutateShip(x => x[b.dataset.list].splice(i, 1));
      if (a === 'add-crew') return mutateShip(x => x.crew.push({ charId: null, name: '', deployment: '', rank: 0, pb: 2 }));
      if (a === 'add-weapon') return mutateShip(x => x.weapons.push({ name: 'Weapon', atkMisc: 0, dmg: '1d6', type: 'energy', range: '', props: '' }));
      if (a === 'add-eq') return mutateShip(x => x.equipment.push({ name: 'Equipment', notes: '' }));
      if (a === 'add-mod') return mutateShip(x => x.mods.push({ name: 'Modification', notes: '' }));
      if (a === 'skill') return mutateShip(x => { const k = b.dataset.k; x.skills[k] = (n0(x.skills[k]) + 1) % 3; });
      if (a === 'pick-equip') return openShipEquipPicker(!!b.dataset.weapons);
      if (a === 'pick-mod') return openShipModPicker();
    });
  }
  function openShipEquipPicker(weapons) {
    picker({
      title: weapons ? '＋ Ship weapon (Starships of the Galaxy)' : '＋ Ship equipment (Starships of the Galaxy)',
      load: () => list('ship-equipment'),
      facets: [{ key: 'type', label: 'types', get: x => x.type, initial: v => (weapons ? ['Weapon'] : v) }, { key: 'wcat', label: 'weapon categories', get: x => (x.type === 'Weapon' ? x.wcat : '') }],
      row: x => `<b>${esc(x.n)}</b><span class="pp-lvl">${esc(x.type)}</span>${x.wsize && x.wsize !== 'None' ? `<span class="pp-tag">${esc(x.wsize)}</span>` : ''}
        <div class="pp-meta">${esc([x.dmg && `${x.dmg} ${x.dt}`, x.rng && 'Range ' + x.rng, x.props, x.cost != null && x.cost.toLocaleString() + ' cr', x.acb && `AC +${x.acb}`, x.hyper && 'Class ' + x.hyper].filter(Boolean).join(' · '))}</div>`,
      detail: x => (x.desc ? md(x.desc) : '<p class="muted">No further text.</p>'),
      action: (x, i) => pickBtn(i), onPick: x => {
        mutateShip(s => {
          if (x.type === 'Weapon') s.weapons.push({ name: x.n, atkMisc: n0(x.atk), dmg: x.dmg, type: x.dt, range: x.rng, props: x.props.slice(0, 300), cat: String(x.wcat || '').toLowerCase(), arc: '', ammo: '' });
          else s.equipment.push({ name: x.n, notes: [x.type, x.acb && `AC +${x.acb}`, x.hyper && 'class ' + x.hyper, x.props].filter(Boolean).join(' · ').slice(0, 300) });
        });
        H.toast(`Added ${x.n}`);
      },
    });
  }
  function openShipModPicker() {
    picker({
      title: '＋ Ship modification (Starships of the Galaxy)', load: () => list('ship-mods'),
      facets: [{ key: 'type', label: 'types', get: x => x.type }, { key: 'grade', label: 'grades', get: x => x.grade }],
      row: x => `<b>${esc(x.n)}</b><span class="pp-lvl">${esc(x.type)}</span><span class="pp-tag">Grade ${n0(x.grade)}</span><div class="pp-meta">${x.pre ? 'Requires ' + esc(x.pre) : ''}</div>`,
      detail: x => md(x.md), action: (x, i) => pickBtn(i),
      onPick: x => { mutateShip(s => s.mods.push({ name: x.n, notes: `${x.type}, grade ${x.grade}`.slice(0, 300), type: x.type, grade: n0(x.grade), pre: String(x.pre || '').slice(0, 200), free: false })); H.toast(`Added ${x.n}`); },
    });
  }
  async function openDeployment(name) {
    H.modal('<div id="dep"><p class="muted">Loading…</p></div>', async box => {
      const el = $('#dep', box);
      try {
        const d = (await list('deployments')).find(x => x.n === name);
        el.innerHTML = d ? `<h3>${esc(d.n)}</h3><p class="muted">${esc(d.desc)}</p>${md(d.md)}${d.features.map(f => `<details class="pp-desc"><summary>${esc(f.n)}</summary>${md(f.md)}</details>`).join('')}`
          : `<p>No deployment called ${esc(name)}.</p>`;
      } catch (err) { el.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      el.insertAdjacentHTML('beforeend', '<div class="row"><span class="spacer"></span><button class="btn primary" id="depClose">Close</button></div>');
      $('#depClose', el).onclick = H.closeModal;
    });
  }

  window.HTB = {
    list, mdBlock, libraryBar, openBook, openSpeciesPicker, openBackgroundPicker, openArchetypePicker, openFeaturePicker,
    guidedBuild, buildLevel1, skillChoice, applyBackground, backgroundSkillOptions, heldSkills,
    levelFeatures, levelChoices, dropArchetypeFeatures, archetypesOf, featNamed, featNames, openMonsterPicker, openStatBlock, rollCreatureSave, bonuses, saveBonus, difficulty, xpMultiplier, renderEncounter, renderShips, renderShipsSafe,
  };
  // the rules tab and ships tab were drawn before this file loaded
  if (!LIB.book) H.renderRules();
  if (H.S.st) renderShipsSafe();
})();
