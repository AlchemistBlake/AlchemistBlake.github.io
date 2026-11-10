// fx.js - role presets, hero neural graph, scroll reveal, tile spotlight.
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Allcorn. All rights reserved.
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // 1. Role presets: filter directory rows and Ready tiles to the projects that evidence a role.
  const chips = $$('.rchip'), status = $('.rstatus'), rows = $$('details.row'), tiles = $$('.rtile'), tabs = $$('.dtab');
  const total = rows.length;
  const has = (el, r) => !r || (' ' + el.dataset.roles + ' ').includes(' ' + r + ' ');
  const applyRole = (chip) => {
    const r = chip.dataset.role;
    chips.forEach(c => c.setAttribute('aria-pressed', c === chip));
    let shown = 0;
    rows.forEach(d => { const on = has(d, r); d.classList.toggle('is-out', !on); if (!on) d.open = false; if (on) shown++;
      d.classList.remove('charged'); if (on && r) { void d.offsetWidth; d.classList.add('charged'); } });
    tiles.forEach(t => t.classList.toggle('is-dim', !has(t, r)));
    let first = -1, cur = -1;
    tabs.forEach((t, i) => {
      const p = document.getElementById(t.getAttribute('aria-controls'));
      const c = p.querySelectorAll('details.row:not(.is-out)').length;
      const badge = t.querySelector('.dtab__c'); badge.textContent = r ? c + '/' + badge.dataset.total : badge.dataset.total;
      t.classList.toggle('is-empty', c === 0);
      if (c && first < 0) first = i; if (t.getAttribute('aria-selected') === 'true') cur = c;
    });
    if (cur === 0 && first >= 0) tabs[first].click();
    status.textContent = r ? `Showing ${shown} of ${total} projects for ${chip.firstChild.textContent.trim()}: ${chip.dataset.desc}` : `Showing all ${total} projects.`;
  };
  chips.forEach(c => c.addEventListener('click', () => applyRole(c)));
  document.addEventListener('animationend', e => { if (e.animationName === 'charge') e.target.classList.remove('charged'); });

  // 2. Scroll reveal (JS-only class, so content is never hidden without JS).
  const RV = '.section-head, .section > h2, .services__lead, .svc, .dbox, .rtile, .about, .caps li, .skillgroup, .contact, .social';
  if (!reduce && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('fx');
    const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
    $$(RV).forEach(el => { if (el.closest('.row__body')) return; const sib = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
      el.classList.add('rv'); el.style.setProperty('--d', Math.min(sib, 6) * 70 + 'ms'); io.observe(el); });
    setTimeout(() => $$('.rv:not(.in)').forEach(el => { const b = el.getBoundingClientRect(); if (b.bottom < 0) el.classList.add('in'); }), 1200);
  }

  // 3. Pointer spotlight on metal surfaces (rAF-throttled, one listener).
  if (!reduce && matchMedia('(hover: hover)').matches) {
    let el = null, x = 0, y = 0, q = false;
    const paint = () => { q = false; if (!el) return; const b = el.getBoundingClientRect(); el.style.setProperty('--mx', x - b.left + 'px'); el.style.setProperty('--my', y - b.top + 'px'); };
    document.addEventListener('pointermove', e => { el = e.target.closest && e.target.closest('.rtile, .svc, .row > summary, .rchip, .dtab'); x = e.clientX; y = e.clientY; if (el && !q) { q = true; requestAnimationFrame(paint); } }, { passive: true });
  }

  // 4. Hero neural graph: blue-white symbolic lattice, violet bolts that hunt along its edges.
  //    Nodes and edges are suppressed inside a keep-out zone around every text block, so nothing draws over text.
  const hero = $('.hero'); if (!hero) return;
  const cv = document.createElement('canvas'); cv.className = 'neural'; cv.setAttribute('aria-hidden', 'true'); hero.prepend(cv);
  const g = cv.getContext('2d');
  const MAXN = 90, D = 170, D2 = D * D, PATH = 7;
  const nx = new Float32Array(MAXN), ny = new Float32Array(MAXN), vx = new Float32Array(MAXN), vy = new Float32Array(MAXN);
  const lit = new Float32Array(MAXN), blocked = new Uint8Array(MAXN);
  const path = new Int16Array(PATH); let plen = 0, bornAt = -1e9, nextBolt = 0;
  let W = 0, H = 0, dpr = 1, N = 0, keep = [], px = -1e4, py = -1e4, visible = true, raf = 0, last = 0;
  const KEEP = '.eyebrow, h1, .roles, .avail, .value, .cta, .cta--play, .play-notes';
  const layout = () => {
    const b = hero.getBoundingClientRect(); W = b.width; H = b.height; dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = W * dpr; cv.height = H * dpr;
    keep = $$(KEEP, hero).map(el => { const r = el.getBoundingClientRect(); return [r.left - b.left - 14, r.top - b.top - 10, r.right - b.left + 14, r.bottom - b.top + 10]; });
    const want = Math.min(MAXN, Math.round(W * H / 9000));
    for (let i = N; i < want; i++) { nx[i] = Math.random() * W; ny[i] = Math.random() * H; vx[i] = (Math.random() - .5) * .18; vy[i] = (Math.random() - .5) * .18; }
    N = want;
  };
  const inKeep = (x, y) => { for (let k = 0; k < keep.length; k++) { const r = keep[k]; if (x > r[0] && x < r[2] && y > r[1] && y < r[3]) return true; } return false; };
  const segClear = (ax, ay, bx, by) => !inKeep((ax + bx) / 2, (ay + by) / 2) && !inKeep(ax * .75 + bx * .25, ay * .75 + by * .25) && !inKeep(ax * .25 + bx * .75, ay * .25 + by * .75);
  const fire = (start, t) => {
    if (start < 0) { const c = []; for (let i = 0; i < N; i++) if (!blocked[i]) c.push(i); if (!c.length) return; start = c[(Math.random() * c.length) | 0]; }
    path[0] = start; plen = 1;
    while (plen < PATH) {
      const a = path[plen - 1]; let best = -1, bd = 1e9;
      for (let i = 0; i < N; i++) {
        if (blocked[i]) continue; let used = false; for (let k = 0; k < plen; k++) if (path[k] === i) { used = true; break; } if (used) continue;
        const dx = nx[i] - nx[a], dy = ny[i] - ny[a], d = dx * dx + dy * dy;
        if (d < D2 && d < bd * (0.6 + Math.random() * .8) && segClear(nx[a], ny[a], nx[i], ny[i])) { bd = d; best = i; }
      }
      if (best < 0) break; path[plen++] = best;
    }
    bornAt = t;
  };
  const BUF = new Float32Array((PATH * 5 + 1) * 2); let bl = 0;
  const jag = (ax, ay, bx, by, amp) => {
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, ux = -dy / L, uy = dx / L;
    for (let s = 1; s <= 4; s++) { const f = s / 5, o = (Math.random() - .5) * amp; BUF[bl++] = ax + dx * f + ux * o; BUF[bl++] = ay + dy * f + uy * o; }
    BUF[bl++] = bx; BUF[bl++] = by;
  };
  const draw = (t) => {
    const dt = Math.min(48, t - last || 16); last = t;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    for (let i = 0; i < N; i++) {
      if (!reduce) {
        const dx = px - nx[i], dy = py - ny[i], d = dx * dx + dy * dy;
        if (d < 32400) { vx[i] += dx * 2e-5 * dt; vy[i] += dy * 2e-5 * dt; }
        vx[i] *= .995; vy[i] *= .995; const sp = Math.hypot(vx[i], vy[i]); if (sp < .05) { vx[i] += (Math.random() - .5) * .02; vy[i] += (Math.random() - .5) * .02; }
        nx[i] += vx[i] * dt * .06; ny[i] += vy[i] * dt * .06;
        if (nx[i] < 0 || nx[i] > W) vx[i] = -vx[i]; if (ny[i] < 0 || ny[i] > H) vy[i] = -vy[i];
      }
      blocked[i] = inKeep(nx[i], ny[i]) ? 1 : 0; lit[i] = Math.max(0, lit[i] - dt / 700);
    }
    g.lineWidth = 1;
    for (let i = 0; i < N; i++) { if (blocked[i]) continue;
      for (let j = i + 1; j < N; j++) { if (blocked[j]) continue;
        const dx = nx[j] - nx[i], dy = ny[j] - ny[i], d = dx * dx + dy * dy; if (d > D2 || !segClear(nx[i], ny[i], nx[j], ny[j])) continue;
        const a = (1 - d / D2) * (.42 + .58 * Math.max(lit[i], lit[j]));
        g.strokeStyle = `hsla(205,90%,82%,${a})`; g.beginPath(); g.moveTo(nx[i], ny[i]); g.lineTo(nx[j], ny[j]); g.stroke(); } }
    for (let i = 0; i < N; i++) { if (blocked[i]) continue;
      const pd = Math.hypot(px - nx[i], py - ny[i]);
      if (pd < 170 && segClear(px, py, nx[i], ny[i]) && !inKeep(px, py)) { g.strokeStyle = `hsla(268,95%,75%,${(1 - pd / 170) * .55})`; g.beginPath(); g.moveTo(px, py); g.lineTo(nx[i], ny[i]); g.stroke(); }
      const r = 2 + lit[i] * 3; g.fillStyle = `hsla(${lit[i] > .05 ? 268 : 205},100%,${85 + lit[i] * 12}%,${.55 + lit[i] * .45})`;
      g.beginPath(); g.arc(nx[i], ny[i], r, 0, 6.2832); g.fill(); }
    // bolt: ignition -> travel -> afterglow
    const age = t - bornAt, TRAVEL = 560, GLOW = 700;
    if (plen > 1 && age < TRAVEL + GLOW) {
      const segs = plen - 1, head = Math.min(segs, (age / TRAVEL) * segs), fade = age < TRAVEL ? 1 : 1 - (age - TRAVEL) / GLOW;
      bl = 0; BUF[bl++] = nx[path[0]]; BUF[bl++] = ny[path[0]];
      for (let s = 0; s < segs && s < head; s++) {
        const a = path[s], b = path[s + 1], f = Math.min(1, head - s);
        jag(nx[a], ny[a], nx[a] + (nx[b] - nx[a]) * f, ny[a] + (ny[b] - ny[a]) * f, 14 * fade);
        if (f === 1) lit[b] = 1;
      }
      for (let pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass ? `hsla(270,100%,96%,${fade})` : `hsla(268,95%,66%,${fade * .55})`; g.lineWidth = pass ? 1.8 : 7;
        g.beginPath(); g.moveTo(BUF[0], BUF[1]); for (let k = 2; k < bl; k += 2) g.lineTo(BUF[k], BUF[k + 1]); g.stroke();
      }
      lit[path[0]] = 1;
    }
    if (!reduce && t > nextBolt) { fire(-1, t); nextBolt = t + 700 + Math.random() * 900; }
    if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(draw); else raf = 0;
  };
  const kick = () => { if (!raf && !reduce && visible && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(draw); } };
  layout(); addEventListener('resize', () => { layout(); if (reduce) draw(performance.now()); }, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(hero);
  hero.addEventListener('pointermove', e => { const b = hero.getBoundingClientRect(); px = e.clientX - b.left; py = e.clientY - b.top; }, { passive: true });
  hero.addEventListener('pointerleave', () => { px = py = -1e4; });
  hero.addEventListener('pointerdown', e => { if (e.target.closest('a,button')) return; const b = hero.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    let best = -1, bd = 1e9; for (let i = 0; i < N; i++) { if (blocked[i]) continue; const d = (nx[i] - x) ** 2 + (ny[i] - y) ** 2; if (d < bd) { bd = d; best = i; } }
    if (best >= 0) { fire(best, performance.now()); kick(); } }, { passive: true });
  new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(hero);
  document.addEventListener('visibilitychange', kick);
  if (reduce) draw(0); else { nextBolt = performance.now() + 600; kick(); }
})();
/* Ready-tile media: load and play only while in view; poster only under reduced motion. sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070 */
(function(){var vs=document.querySelectorAll('.rtile__media video[data-src]');if(!vs.length)return;
if(matchMedia('(prefers-reduced-motion: reduce)').matches||!('IntersectionObserver' in window))return;
var io=new IntersectionObserver(function(es){es.forEach(function(e){var v=e.target;
if(e.isIntersecting){if(!v.src)v.src=v.dataset.src;var p=v.play();if(p&&p.catch)p.catch(function(){});}else if(!v.paused)v.pause();});},{threshold:.35});
vs.forEach(function(v){io.observe(v);});})();
