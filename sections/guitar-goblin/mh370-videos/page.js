// MH370 "orb videos" walk-through: the few things the page does with script. Without it everything is still there:
// the ledger cards open on a tap (details), both sides show stacked, and the tabs are plain links.
(() => {
  document.documentElement.classList.add('js');
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // the section tabs follow the reading
  const tabs = new Map($$('.tabs a').map((a) => [a.getAttribute('href').slice(1), a]));
  const secs = $$('section[id]').filter((s) => tabs.has(s.id));
  const mark = () => {
    let cur = secs[0];
    for (const s of secs) if (s.getBoundingClientRect().top < 120) cur = s;
    for (const [id, a] of tabs) a.classList.toggle('on', cur && id === cur.id);
    const on = cur && tabs.get(cur.id); if (on && on.parentElement.scrollWidth > on.parentElement.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true }); mark();

  // on a phone each card shows one side at a time: the case for, or the evidence against, one tap apart
  for (const pt of $$('.pt')) {
    const sides = pt.querySelector('.sides'), flip = pt.querySelector('.flip'); if (!sides || !flip) continue;
    sides.dataset.show = 'against';
    for (const b of $$('button', flip)) b.addEventListener('click', () => {
      sides.dataset.show = b.dataset.side;
      for (const o of $$('button', flip)) o.setAttribute('aria-selected', String(o === b));
    });
  }

  // the ledger's tools: open or close every card, and show only some strengths
  const cards = $$('.pt'), all = document.getElementById('openall');
  if (all) all.addEventListener('click', () => { const open = cards.some((c) => !c.open); for (const c of cards) c.open = open; all.textContent = open ? 'Close all' : 'Open all'; });
  const shown = new Set($$('.tools button[data-s]').map((b) => b.dataset.s));
  for (const b of $$('.tools button[data-s]')) b.addEventListener('click', () => {
    const s = b.dataset.s; if (shown.has(s)) shown.delete(s); else shown.add(s);
    b.setAttribute('aria-pressed', String(shown.has(s)));
    for (const c of cards) c.hidden = !shown.has(c.dataset.s);
  });

  // a link to a point (#p3) opens it
  const openHash = () => { const t = location.hash && document.getElementById(location.hash.slice(1)); if (t && t.matches('.pt')) t.open = true; };
  addEventListener('hashchange', openHash); openHash();
})();
