// Filters for the checklist: by state and by how much it matters. Without this script the page still
// works: every section opens and shows all its lines. Nothing here talks to a server.
(() => {
  const bar = document.getElementById('filters');
  if (!bar) return;
  bar.hidden = false;
  const items = [...document.querySelectorAll('.item')];
  const sections = [...document.querySelectorAll('details.sec')];
  const buttons = [...bar.querySelectorAll('button[data-f]')];
  const shownAll = document.getElementById('shownall');

  function apply(openMatches) {
    const on = (f) => new Set(buttons.filter((b) => b.dataset.f === f && b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.v));
    const states = on('state'), matters = on('matters');
    let shown = 0;
    for (const li of items) {
      const show = states.has(li.dataset.state) && matters.has(li.dataset.matters);
      li.hidden = !show;
      if (show) shown += 1;
    }
    const filtered = shown !== items.length;
    for (const sec of sections) {
      const n = sec.querySelectorAll('.item:not([hidden])').length;
      const label = sec.querySelector('.shown');
      label.hidden = !filtered;
      label.textContent = ` · ${n} shown`;
      sec.querySelector('.nomatch').hidden = n > 0;
      if (openMatches) sec.open = filtered && n > 0;
    }
    shownAll.textContent = filtered ? `Showing ${shown} of ${items.length}.` : `Showing all ${items.length}.`;
  }

  for (const b of buttons) {
    b.addEventListener('click', () => {
      b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      apply(true);
    });
  }
  document.getElementById('openall').addEventListener('click', () => sections.forEach((s) => { s.open = true; }));
  document.getElementById('closeall').addEventListener('click', () => sections.forEach((s) => { s.open = false; }));

  // a link to one line (#l-3-1) opens its section and shows the line, even if a filter had hidden it
  function reveal() {
    const el = location.hash && document.getElementById(location.hash.slice(1));
    if (!el || !el.classList.contains('item')) return;
    if (el.hidden) { buttons.forEach((b) => b.setAttribute('aria-pressed', 'true')); apply(false); }
    const sec = el.closest('details');
    if (sec) sec.open = true;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
    el.scrollIntoView({ block: 'center' });
  }
  addEventListener('hashchange', reveal);
  apply(false);
  reveal();
})();
