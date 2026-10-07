/* The 372-family table: load families.json, filter by discipline / importance / verification / text, sort by column. */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const BUCKETS = ['Lean: headline', 'Lean: core claim', 'Lean: partial', 'Unformalized'];
  const state = { k: 'importance', dir: -1 };
  let rows = [];

  fetch('families.json').then((r) => r.json()).then((data) => {
    const bucket = (v) => v.startsWith('Lean, headline') ? BUCKETS[0] : v.startsWith('Lean, core') ? BUCKETS[1] : v.startsWith('Lean, partial') ? BUCKETS[2] : BUCKETS[3];
    rows = data.map((f) => ({ id: f.id, title: f.title, discipline: f.discipline, importance: f.importance, verification: f.verification,
      bucket: bucket(f.verification), claim: f.one_line_claim, reason: f.rating_reason }));
    data = rows;
    const opts = (sel, vals, label) => { for (const v of vals) { const o = document.createElement('option'); o.value = v; o.textContent = label ? label(v) : v; sel.appendChild(o); } };
    opts($('#fd'), [...new Set(data.map((f) => f.discipline))].sort());
    opts($('#fi'), [10, 9, 8, 7, 6, 5, 4].filter((n) => data.some((f) => f.importance === n)), (n) => n + (n >= 9 ? ' (top)' : ''));
    opts($('#fv'), BUCKETS);
    for (const id of ['q', 'fd', 'fi', 'fv']) $('#' + id).addEventListener('input', render);
    document.querySelectorAll('.fam th button').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k;
      state.dir = state.k === k ? -state.dir : (k === 'importance' ? -1 : 1);
      state.k = k;
      document.querySelectorAll('.fam th button').forEach((x) => x.removeAttribute('aria-sort'));
      b.setAttribute('aria-sort', state.dir > 0 ? 'ascending' : 'descending');
      render();
    }));
    render();
  }).catch(() => { $('#rows').innerHTML = '<tr><td colspan="6">Could not load families.json.</td></tr>'; });

  function render() {
    const q = $('#q').value.trim().toLowerCase(), d = $('#fd').value, i = $('#fi').value, v = $('#fv').value;
    const list = rows.filter((f) => (!d || f.discipline === d) && (!i || f.importance === +i) && (!v || f.bucket === v) &&
      (!q || (f.id + ' ' + f.title + ' ' + f.claim + ' ' + f.reason).toLowerCase().includes(q)));
    const k = state.k, dir = state.dir;
    list.sort((a, b) => {
      const x = k === 'bucket' ? BUCKETS.indexOf(a.bucket) : a[k], y = k === 'bucket' ? BUCKETS.indexOf(b.bucket) : b[k];
      return (x < y ? -1 : x > y ? 1 : 0) * dir || (a.id < b.id ? -1 : 1);
    });
    $('#count').textContent = list.length + ' of ' + rows.length + ' families';
    $('#rows').innerHTML = list.map((f) =>
      '<tr><td class="fid">' + f.id + '</td><td class="ftitle">' + esc(f.title) + '</td><td class="fdisc">' + esc(f.discipline) + '</td>' +
      '<td class="imp-cell"><span class="imp i' + f.importance + '">' + f.importance + '</span></td>' +
      '<td class="fver"><span class="vb ' + f.bucket.replace(/[: ]+/g, '-') + '">' + esc(f.bucket) + '</span>' +
      (f.verification !== 'Lean, headline formalized' && f.verification !== 'Unformalized' ? '<span class="vfull">' + esc(f.verification) + '</span>' : '') + '</td>' +
      '<td class="fclaim">' + esc(f.claim) + '<span class="why">' + esc(f.reason) + '</span></td></tr>').join('') ||
      '<tr><td colspan="6">No family matches those filters.</td></tr>';
  }
})();
