/* Renders the rated list from window.PROGRAMS (data.js), with style/town/rates filters and sorting. */
(() => {
  const ALL = window.PROGRAMS || [];
  const ranked = ALL.filter(p => p.scores);
  const STYLES = { regular: 'Regular', montessori: 'Montessori', 'waldorf-forest': 'Waldorf & forest', 'reggio-arts': 'Reggio & arts' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = d => { const t = new Date(d + 'T12:00:00'); return isNaN(t) ? esc(d) : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  const ccldUrl = n => 'https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/' + encodeURIComponent(n);
  // Rough monthly equivalent, for sorting only: weekly ×4.33, daily ×13 (3 days a week), yearly ÷12, per-8-weeks ÷1.85.
  const priceNum = p => {
    const t = (p.price && p.price.three_day_summary) || '';
    if (!(p.price && p.price.published)) return Infinity;
    if (/^free\b/i.test(t)) return 0;
    const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(t);
    if (!m) return Infinity;
    let v = parseFloat(m[1].replace(/,/g, ''));
    const unit = s => /\/\s?mo|month/.test(s) ? 'mo' : /\/\s?wk|week/.test(s) ? 'wk' : /8 weeks|8-week/.test(s) ? '8wk' :
      /\/\s?day|per day|a day/.test(s) ? 'day' : /\/\s?yr|year|annual/.test(s) ? 'yr' : null;
    const u = unit(t.slice(m.index, m.index + 24).toLowerCase()) || unit(t.toLowerCase()) || 'mo';
    return { mo: v, wk: v * 4.33, day: v * 13, yr: v / 12, '8wk': v / 1.85 }[u];
  };
  const SETTING = { home: 'Home daycare', outdoor: 'Outdoor', 'co-op': 'Parent co-op', 'public-school': 'Public school' };

  const state = { style: 'all', town: 'all', rates: false, both: false, older: false, sort: 'score' };

  function chip(group, value, label, pressed) {
    return `<button type="button" class="chip" data-g="${group}" data-v="${esc(value)}" aria-pressed="${pressed}">${esc(label)}</button>`;
  }
  function buildControls() {
    const towns = [...new Set(ranked.map(p => p.town))].sort();
    document.getElementById('chips-style').innerHTML = chip('style', 'all', 'All styles', true) + Object.entries(STYLES).map(([k, v]) => chip('style', k, v, false)).join('');
    document.getElementById('chips-town').innerHTML = chip('town', 'all', 'All towns', true) + towns.map(t => chip('town', t, t, false)).join('') +
      chip('rates', '1', 'Publishes rates', false) + chip('both', '1', 'Takes 2s and 4s', false) + chip('older', '1', 'Ages 3+ only', false);
    document.querySelector('.controls').addEventListener('click', e => {
      const b = e.target.closest('.chip'); if (!b) return;
      const g = b.dataset.g;
      if (g === 'rates' || g === 'both' || g === 'older') { state[g] = !state[g]; b.setAttribute('aria-pressed', state[g]); }
      else {
        state[g] = b.dataset.v;
        document.querySelectorAll(`.chip[data-g="${g}"]`).forEach(x => x.setAttribute('aria-pressed', x === b));
      }
      render();
    });
    document.getElementById('sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
  }

  function bar(label, v, why) {
    return `<div class="sub-s" title="${esc(why)}">${label}<b>${v.toFixed(1)}</b><div class="bar"><i style="width:${v * 10}%"></i></div></div>`;
  }
  function card(p, rank) {
    const s = p.scores, pr = p.price || {}, L = p.license || {}, R = p.reviews || {};
    const contact = p.email
      ? `<a href="mailto:${esc(p.email)}?subject=${encodeURIComponent('Part-time enrollment and rates (about 3 days a week)')}">email ${esc(p.email)}</a>`
      : (p.phone ? `call <a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>` : 'ask via the website');
    const priceHtml = pr.published
      ? `<span class="h">${esc(pr.three_day_summary)}</span>${(pr.details || []).length ? ' · ' + pr.details.map(esc).join(' · ') : ''}` +
        (pr.sibling ? `<br>Siblings: ${esc(pr.sibling)}` : '') + (pr.fees ? `<br>${esc(pr.fees)}` : '') +
        (pr.rate_year_label ? `<br><b>Labelled ${esc(pr.rate_year_label)}</b>: ask for current rates.` : '') +
        `<span class="src">Per child, per month unless stated. From the program’s own site (<a href="${esc(pr.source)}" rel="noopener">source</a>), checked ${fmtDate(pr.checked)}.</span>`
      : `<span class="nr">Rates not published</span>: ${contact}.` + ((pr.details || []).length ? `<br>${pr.details.map(esc).join(' · ')}` : '');
    const ccld = (p.ccld || []).map(n => `<a href="${ccldUrl(n)}" rel="noopener">CCLD #${esc(n)}</a>`).join(' · ');
    const low = R.count != null && R.count < 10 ? '<span class="lowconf">few reviews</span>' : '';
    const rev = R.rating != null ? `${esc(R.site || 'Reviews')} ${esc(Number(R.rating).toFixed(1))} from ${esc(R.count)} review${R.count === 1 ? '' : 's'} ${low}` +
      (R.url ? ` <a class="src" href="${esc(R.url)}" rel="noopener">source</a>` : '') : 'No usable public reviews found <span class="lowconf">low confidence</span>';
    const extras = [p.accreditation && 'Accreditation: ' + p.accreditation, p.outdoor && 'Outdoors: ' + p.outdoor, p.ratios && 'Ratios: ' + p.ratios, p.potty && 'Potty training: ' + p.potty,
      p.calendar && 'Calendar: ' + p.calendar.replace('-', ' '), p.address && 'Address: ' + p.address].filter(Boolean);
    const asks = (p.asks || []).length ? `<h4 class="small muted">Ask before enrolling</h4><ul>${p.asks.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '';
    return `<li class="card" id="${esc(p.id)}">
  <div class="card-top">
    <div><h3><span class="rank">#${rank}</span>${esc(p.name)}</h3>
      <div class="meta"><span class="tag ${esc(p.style)}">${esc(STYLES[p.style] || p.style)}</span>${SETTING[p.setting] ? `<span class="tag setting">${esc(SETTING[p.setting])}</span>` : ''}${esc(p.town)} · ${p.drive_min != null ? esc(p.drive_min) + ' min drive' : 'drive time n/a'}${p.toll ? ' + bridge toll' : ''}</div></div>
    <div class="score"><div class="big">${s.overall.toFixed(1)}<small>/10</small></div></div>
  </div>
  ${p.availability ? `<p class="avail">${esc(p.availability)}</p>` : ''}
  <div class="subs">${bar('Safety', s.safety, s.why.safety)}${bar('Reviews', s.reviews, s.why.reviews)}${bar('Program', s.program, s.why.program)}${bar('Fit', s.fit, s.why.fit)}</div>
  <div class="price">${priceHtml}</div>
  <div class="facts">
    <div><span>Ages</span>${esc(p.ages_text || 'Not stated')}</div>
    <div><span>Part-time</span>${esc(p.part_time_text || 'Not stated')}</div>
    <div><span>Hours</span>${esc(p.hours || 'Not stated')}</div>
    <div><span>Approach</span>${esc(p.approach || 'Not described')}</div>
  </div>
  <div class="lic"><b>Licensing:</b> ${esc(L.summary || 'Not checked')}${L.mirrors_disagree ? ' <em>(' + esc(L.mirrors_disagree) + ')</em>' : ''}<br>
    <span class="src">${ccld ? 'Official record: ' + ccld + ' · ' : ''}Data: ${L.source ? `<a href="${esc(L.source)}" rel="noopener">${esc(L.source_name || 'source')}</a>` : esc(L.source_name || 'n/a')}, checked ${fmtDate(L.checked || '2026-10-31')}</span></div>
  <div class="rev"><b>Reviews:</b> ${rev}</div>
  <div class="links">${p.website ? `<a href="${esc(p.website)}" rel="noopener">Website ↗</a>` : ''}${p.phone ? `<a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a>` : ''}${p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ''}</div>
  <details class="more"><summary>Details and why it scored this way</summary>
    ${p.note ? `<p class="small">${esc(p.note)}</p>` : ''}
    <ul>${extras.map(x => `<li>${esc(x)}</li>`).join('')}
      <li>Safety ${s.safety.toFixed(1)}: ${esc(s.why.safety)}</li><li>Reviews ${s.reviews.toFixed(1)}: ${esc(s.why.reviews)}</li>
      <li>Program ${s.program.toFixed(1)}: ${esc(s.why.program)}</li><li>Fit ${s.fit.toFixed(1)}: ${esc(s.why.fit)}</li></ul>
    ${asks}
  </details>
</li>`;
  }

  function render() {
    let list = ranked.filter(p => (state.style === 'all' || p.style === state.style) && (state.town === 'all' || p.town === state.town) &&
      (!state.rates || (p.price && p.price.published)) && (!state.both || (p.takes_twos && p.takes_fours)) &&
      (!state.older || (p.takes_twos === false && p.takes_fours)));
    const by = {
      score: (a, b) => b.scores.overall - a.scores.overall,
      price: (a, b) => priceNum(a) - priceNum(b) || b.scores.overall - a.scores.overall,
      drive: (a, b) => (a.drive_min ?? 999) - (b.drive_min ?? 999) || b.scores.overall - a.scores.overall,
      name: (a, b) => a.name.localeCompare(b.name),
    }[state.sort];
    list = list.slice().sort(by);
    const rankOf = new Map(ranked.map((p, i) => [p.id, i + 1]));
    document.getElementById('count').textContent = `${list.length} of ${ranked.length} programs`;
    document.getElementById('list').innerHTML = list.length ? list.map(p => card(p, rankOf.get(p.id))).join('')
      : '<li class="empty">Nothing matches these filters. Try fewer.</li>';
  }

  function renderOthers() {
    const avoid = ALL.filter(p => p.avoid || (p.license && p.license.status === 'Closed'));
    document.getElementById('avoid-list').innerHTML = avoid.map(p => {
      const L = p.license || {};
      return `<li><b>${esc(p.name)}</b>, ${esc(p.town)}: ${esc(p.avoid_reason || L.summary || 'Closed')}` +
        `${L.source ? ` <a class="small" href="${esc(L.source)}" rel="noopener">record</a>` : ''}${(p.ccld || []).length ? ' · ' + p.ccld.map(n => `<a class="small" href="${ccldUrl(n)}" rel="noopener">CCLD #${esc(n)}</a>`).join(' · ') : ''}</li>`;
    }).join('');
    const inc = ALL.filter(p => p.income_only && !p.avoid);
    document.getElementById('income-list').innerHTML = inc.map(p => `<li>${esc(p.name)}, ${esc(p.town)}${p.website ? ` (<a href="${esc(p.website)}" rel="noopener">site</a>)` : ''}</li>`).join('') || '<li>None listed.</li>';
  }

  buildControls(); render(); renderOthers();
})();
