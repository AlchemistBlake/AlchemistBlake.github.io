// light.js - pointer spotlight for project cards: one passive listener, rAF-throttled, no allocation per frame beyond the event.
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Allcorn. All rights reserved.
(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover)').matches) return;
  let card = null, x = 0, y = 0, queued = false;
  const paint = () => { queued = false; if (!card) return; const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', (x - r.left) + 'px'); card.style.setProperty('--my', (y - r.top) + 'px'); };
  document.addEventListener('pointermove', e => {
    card = e.target.closest ? e.target.closest('.card') : null; x = e.clientX; y = e.clientY;
    if (card && !queued) { queued = true; requestAnimationFrame(paint); }
  }, { passive: true });
})();
