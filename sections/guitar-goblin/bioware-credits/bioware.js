/* One tooltip for every chart mark that carries data-tip: follows the pointer, and taps toggle it on phones. */
(() => {
  const tip = document.getElementById('tip');
  let pinned = null;
  const show = (el, x, y) => {
    tip.textContent = el.getAttribute('data-tip'); tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x - r.width / 2)) + 'px';
    tip.style.top = Math.max(8, y - r.height - 14) + 'px';
  };
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else if (!pinned) tip.hidden = true;
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el && el !== pinned) { pinned = el; show(el, e.clientX, e.clientY); } else { pinned = null; tip.hidden = true; }
  });
  addEventListener('scroll', () => { if (pinned) { pinned = null; tip.hidden = true; } }, { passive: true });
})();
