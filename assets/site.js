// site.js - scroll-to-top on load, project directory tabs, click sparks.
// sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070  (c) Blake Allcorn. All rights reserved.
(() => {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. Load at the top. In-page links scroll without writing #hash into the URL,
  //    so a reload doesn't jump to the last section; an incoming deep link is honored once.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const go = (el) => el && el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });

  // 2. Directory: roving-tabindex tablist (WAI-ARIA tabs pattern).
  const tabs = [...document.querySelectorAll('.dtab')];
  const panels = tabs.map(t => document.getElementById(t.getAttribute('aria-controls')));
  const select = (i, focus) => {
    tabs.forEach((t, j) => { const on = i === j; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; panels[j].hidden = !on; });
    if (focus) tabs[i].focus();
  };
  if (tabs.length) {
    select(0, false);
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i, false));
      t.addEventListener('keydown', ev => {
        const k = ev.key, L = tabs.length;
        const n = k === 'ArrowRight' ? (i + 1) % L : k === 'ArrowLeft' ? (i - 1 + L) % L : k === 'Home' ? 0 : k === 'End' ? L - 1 : -1;
        if (n >= 0) { ev.preventDefault(); select(n, true); }
      });
    });
    document.addEventListener('click', ev => {
      const b = ev.target.closest('[data-expand],[data-collapse]'); if (!b) return;
      const open = b.hasAttribute('data-expand');
      b.closest('.dpanel').querySelectorAll('details.row').forEach(d => { d.open = open; });
    });
  }
  // Open a project row by id: switch to its tab, expand it, scroll to it.
  const openRow = (id) => {
    const row = document.querySelector(`details.row[data-id="${CSS.escape(id)}"]`); if (!row) return false;
    const pi = panels.indexOf(row.closest('.dpanel')); if (pi >= 0) select(pi, false);
    row.open = true; requestAnimationFrame(() => go(row)); return true;
  };

  document.addEventListener('click', ev => {
    const a = ev.target.closest('a[href^="#"]'); if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    if (id === 'top' || id === '') { ev.preventDefault(); scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); return; }
    if (openRow(id)) { ev.preventDefault(); return; }
    const el = document.getElementById(id); if (!el) return;
    ev.preventDefault(); go(el);
    if (id === 'main') { el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
  });

  const initial = decodeURIComponent(location.hash.slice(1));
  if (initial) {
    history.replaceState(null, '', location.pathname + location.search);
    addEventListener('load', () => { if (!openRow(initial)) go(document.getElementById(initial)); }, { once: true });
  } else {
    scrollTo(0, 0);
    addEventListener('pageshow', e => { if (!e.persisted) scrollTo(0, 0); });
  }

  // Hero share-card loop: data-src only until motion is allowed, so reduced motion never requests the file.
  // sig: BWA_15.2003075_SOV_96.7Hz_SHA-BEWA_69912070
  const heroLoop = document.querySelector('.hero__loop');
  if (heroLoop) {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    let armed = false, io = null;
    const tryPlay = () => { if (heroLoop.paused) heroLoop.play().catch(() => {}); };
    const tryPause = () => { if (!heroLoop.paused) heroLoop.pause(); };
    const enable = () => {
      heroLoop.muted = true;
      let attach = false;
      heroLoop.querySelectorAll('source').forEach(el => {
        const next = el.getAttribute('data-src');
        if (next && el.getAttribute('src') !== next) { el.setAttribute('src', next); attach = true; }
      });
      if (attach || !armed) { heroLoop.load(); armed = true; }
      if (!io && 'IntersectionObserver' in window) {
        io = new IntersectionObserver(es => { es.forEach(en => { if (en.isIntersecting) tryPlay(); else tryPause(); }); }, { threshold: 0.2 });
        io.observe(heroLoop.closest('.hero') || heroLoop);
      } else tryPlay();
    };
    const disable = () => {
      heroLoop.pause();
      if (!armed) return;
      armed = false;
      heroLoop.removeAttribute('src');
      heroLoop.querySelectorAll('source').forEach(el => el.removeAttribute('src'));
      heroLoop.load();
    };
    const apply = () => { if (mq.matches) disable(); else enable(); };
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
    apply();
  }

  // 3. Click sparks: short electric bolts from the press point on interactive elements.
  //    One fixed canvas, a preallocated Float64Array pool, rAF only while sparks are alive.
  //    Color roles: violet main bolts, blue-white edge traces and panel ripples, gold only as the strike flare and tip embers.
  if (reduce) return;
  const SEL = '.btn, .chip, .rchip, .dtab, .social__btn, summary, .nav a, .brand';
  const MAXB = 96, SEG = 9, STRIDE = 4 + SEG * 2;           // per bolt: x, y, born, hue, then SEG (x,y) points
  const pool = new Float64Array(MAXB * STRIDE); let count = 0, head = 0, running = false;
  const cv = document.createElement('canvas'); cv.className = 'sparks'; cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv); const cx = cv.getContext('2d');
  let dpr = 1;
  const size = () => { dpr = Math.min(devicePixelRatio || 1, 2); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; };
  size(); addEventListener('resize', size, { passive: true });
  const VIOLET = 268, BLUE = '125,211,252', GOLD_RGB = '231,194,125';
  const LIFE = 1100, FLASH = 450, REACH = 360, ETRACE = 900, EMBER = 1000, GOLD_R = 220;   // gold never drawn beyond GOLD_R of the strike
  let flashX = 0, flashY = 0, flashT = -1e9;
  let ringPath = null, ringGrad = null;   // Path2D + gradient, rebuilt once per burst
  let ringScale = 1;                      // Pref / button-perimeter, computed once in armRing
  // Edge traces: light that wraps around nearby panels' borders, arriving later the farther away they are.
  const MAXE = 12, ES = 10;                                   // x, y, w, h, radius, t0, perimeter, start offset, segLen
  const edges = new Float64Array(MAXE * ES), eref = new Array(MAXE).fill(null); let ecount = 0;
  const NEAR = '.rtile, .svc, .dbox, .btn, .rchip, .dtab, .row > summary, .social__btn, .chip, .about, .contact, .skillgroup';
  const near = (x, y, t, src) => {
    ecount = 0; const found = [];
    for (const el of document.querySelectorAll(NEAR)) {
      const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      if (el.classList.contains('rv') && !el.classList.contains('in')) continue;
      const tf = getComputedStyle(el).transform; if (tf !== 'none' && Math.abs(new DOMMatrixReadOnly(tf).m42) > 1) continue;   // still sliding in
      const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom), d = Math.hypot(dx, dy);
      if (d <= REACH && !(el.contains(src) && el !== src && el.classList.contains('dbox'))) found.push([d, el, r]);
    }
    found.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < found.length && ecount < MAXE; i++) {
      const [d, el, r] = found[i], o = ecount++ * ES;
      const rad = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, r.height / 2, r.width / 2);
      const per = 2 * (r.width + r.height) - (8 - 2 * Math.PI) * rad;
      // nearest point on the rect outline, as distance along it clockwise from the top-left corner
      const qx = Math.min(Math.max(x, r.left), r.right), qy = Math.min(Math.max(y, r.top), r.bottom);
      const m = Math.min(qy - r.top, r.right - qx, r.bottom - qy, qx - r.left);
      const sp = m === qy - r.top ? qx - r.left : m === r.right - qx ? r.width + (qy - r.top)
        : m === r.bottom - qy ? r.width + r.height + (r.right - qx) : 2 * r.width + r.height + (r.bottom - qy);
      eref[o / ES] = el; edges[o] = r.left; edges[o + 1] = r.top; edges[o + 2] = r.width; edges[o + 3] = r.height; edges[o + 4] = rad;
      edges[o + 5] = t + i * 110; edges[o + 6] = per; edges[o + 7] = sp * per / (2 * (r.width + r.height)); edges[o + 8] = Math.min(per, 160 + per * .35); edges[o + 9] = Math.pow(.8, i);
      if (el !== src) { el.style.setProperty('--ld', (i * 110) + 'ms'); el.style.setProperty('--la', (.85 * Math.pow(.8, i)).toFixed(2)); el.classList.remove('aoe'); void el.offsetWidth; el.classList.add('aoe'); }
    }
  };
  const MAXK = 512, keep = new Float64Array(MAXK * 4), kref = new Array(MAXK).fill(null); let kcount = 0, kover = false, kdirty = false, kx = 0, ky = 0, ksrc = null;
  const TEXT = 'h1, h2, h3, h4, p, li, figcaption, .kicker, .rstatus, .eyebrow, ' + SEL;
  const keepOut = (x, y, src) => {
    kx = x; ky = y; ksrc = src; kdirty = false; kcount = 0; kover = false; const R = REACH + 260;
    for (const el of document.querySelectorAll(TEXT)) {
      if (el !== src && el.contains(src)) continue;   // the pressed control's own label is protected too
      const r = el.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
      if (Math.max(r.left - x, 0, x - r.right) > R || Math.max(r.top - y, 0, y - r.bottom) > R) continue;
      const cs = getComputedStyle(el), pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0,
        pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
      if (kcount >= MAXK) { kover = true; break; }   // fail safe: too many text boxes to protect, so no bolts this press
      const o = kcount * 4; kref[kcount++] = el;   // store insets; the box itself is re-read every frame so layout shifts (an opening row) stay protected
      keep[o] = pl - 3; keep[o + 1] = pt - 2; keep[o + 2] = pl + pr - 6; keep[o + 3] = pt + pb - 4;
    }
  };
  const spawn = (x, y, t) => {
    const n = 12, base = Math.random() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const o = head * STRIDE; head = (head + 1) % MAXB; if (count < MAXB) count++;
      const ang = base + k * (Math.PI * 2 / n) + (Math.random() - .5) * .45, len = 110 + Math.random() * 120;
      pool[o] = x; pool[o + 1] = y; pool[o + 2] = t + (k % 3) * 40; pool[o + 3] = VIOLET;   // main bolt is always violet
      let px = x, py = y;
      for (let s = 0; s < SEG; s++) {
        const r = len * (s + 1) / SEG, j = (Math.random() - .5) * 26;
        px = x + Math.cos(ang) * r - Math.sin(ang) * j; py = y + Math.sin(ang) * r + Math.cos(ang) * j;
        pool[o + 4 + s * 2] = px; pool[o + 5 + s * 2] = py;
      }
    }
    if (!running) { running = true; requestAnimationFrame(frame); }
  };
  const frame = (now) => {
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, innerWidth, innerHeight);
    cx.lineCap = 'round'; cx.lineJoin = 'round'; cx.globalCompositeOperation = 'lighter';
    let alive = 0;
    if (kdirty) keepOut(kx, ky, ksrc);   // layout changed mid-burst (a row opened, a filter applied, a scroll): re-collect protected text
    if (kover) { count = 0; ecount = 0; flashT = -1e9; }   // fail safe: if text can't all be protected, drop the burst
    if (now - flashT < FLASH) { const fa = 1 - (now - flashT) / FLASH;
      cx.globalCompositeOperation = 'source-over';
      const gr = cx.createRadialGradient(flashX, flashY, 0, flashX, flashY, 28);
      gr.addColorStop(0, `rgba(255,236,190,${fa})`); gr.addColorStop(.35, `rgba(${GOLD_RGB},${fa * .9})`); gr.addColorStop(1, `rgba(${GOLD_RGB},0)`);
      cx.fillStyle = gr; cx.fillRect(flashX - 28, flashY - 28, 56, 56);
      cx.beginPath(); cx.arc(flashX, flashY, 9, 0, 6.2832); cx.fillStyle = `rgba(${GOLD_RGB},${fa})`; cx.fill();
      cx.beginPath(); cx.arc(flashX, flashY, 4, 0, 6.2832); cx.fillStyle = `rgba(255,236,190,${fa * .95})`; cx.fill();
      if (ringPath && ringGrad) {
        cx.save();
        cx.beginPath(); cx.arc(flashX, flashY, GOLD_R, 0, 6.2832); cx.clip();
        cx.setLineDash([]); cx.lineJoin = 'round'; cx.lineCap = 'round';
        cx.strokeStyle = ringGrad;
        cx.globalAlpha = fa * .22 * ringScale; cx.lineWidth = 10; cx.stroke(ringPath);
        cx.globalAlpha = fa * .45 * ringScale; cx.lineWidth = 3; cx.stroke(ringPath);
        cx.globalAlpha = fa * .28 * ringScale; cx.lineWidth = 1.2; cx.strokeStyle = `rgba(255,236,190,1)`; cx.stroke(ringPath);
        cx.globalAlpha = 1;
        cx.restore();
      }
      cx.globalCompositeOperation = 'lighter';
      alive++; }
    for (let b = 0; b < count; b++) {
      const o = b * STRIDE, age = now - pool[o + 2]; if (age > LIFE) continue; alive++; if (age < 0) continue;
      const p = age / LIFE, vis = Math.max(1, Math.ceil(SEG * Math.min(1, p / .6))), a = 1 - p * p;
      cx.beginPath(); cx.moveTo(pool[o], pool[o + 1]);
      for (let s = 0; s < vis; s++) cx.lineTo(pool[o + 4 + s * 2], pool[o + 5 + s * 2]);
      const h = pool[o + 3];
      cx.strokeStyle = `hsla(${h},95%,64%,${a * .32})`; cx.lineWidth = 8; cx.stroke();
      cx.strokeStyle = `hsla(${h},100%,93%,${a})`; cx.lineWidth = 1.5; cx.stroke();
    }
    // light running both ways around each nearby panel's border, starting at the side facing the press
    for (let e = 0; e < ecount; e++) {
      const o = e * ES, age = now - edges[o + 5]; if (age > ETRACE + EMBER) continue; alive++; if (age < 0) continue;
      const el = eref[e]; if (el) { const r = el.getBoundingClientRect(); edges[o] = r.left; edges[o + 1] = r.top; edges[o + 2] = r.width; edges[o + 3] = r.height; }   // follow layout shifts and scroll
      const p = Math.min(1, age / ETRACE), grow = Math.min(1, p / .5), fall = edges[o + 9],
        a = fall * (age <= ETRACE ? (p < .5 ? 1 : 1 - .8 * (p - .5) / .5) : .2 * (1 - (age - ETRACE) / EMBER));   // bright crawl, then a faint ember fading over ~1s
      const per = edges[o + 6], seg = edges[o + 8] * grow, half = seg / 2;
      cx.beginPath(); if (cx.roundRect) cx.roundRect(edges[o], edges[o + 1], edges[o + 2], edges[o + 3], edges[o + 4]); else cx.rect(edges[o], edges[o + 1], edges[o + 2], edges[o + 3]);
      cx.setLineDash([seg, Math.max(0.001, per - seg)]);
      cx.lineDashOffset = -((edges[o + 7] - edges[o + 4] - half) % per);   // roundRect's path starts just after the top-left arc
      cx.strokeStyle = `rgba(${BLUE},${a * .55})`; cx.lineWidth = 6; cx.stroke();
      cx.strokeStyle = `rgba(224,242,254,${a * .95})`; cx.lineWidth = 1.5; cx.stroke();
    }
    // gold embers: same traced segments, clipped to GOLD_R around the strike so gold never leaves the strike area
    if (ecount) {
      cx.save(); cx.beginPath(); cx.arc(flashX, flashY, GOLD_R, 0, 6.2832); cx.clip();
      for (let e = 0; e < ecount; e++) {
        const o = e * ES, age = now - edges[o + 5]; if (age < 0 || age > ETRACE + EMBER) continue;
        const p = Math.min(1, age / ETRACE), grow = Math.min(1, p / .5), fall = edges[o + 9];
        const per = edges[o + 6], seg = edges[o + 8] * grow, half = seg / 2;
        cx.beginPath(); if (cx.roundRect) cx.roundRect(edges[o], edges[o + 1], edges[o + 2], edges[o + 3], edges[o + 4]); else cx.rect(edges[o], edges[o + 1], edges[o + 2], edges[o + 3]);
        cx.setLineDash([seg, Math.max(0.001, per - seg)]);
        cx.lineDashOffset = -((edges[o + 7] - edges[o + 4] - half) % per);
      cx.globalCompositeOperation = 'source-over';
      const ga = age >= 0 && age < 1000 ? fall * .32 * (1 - age / 1000) : 0;
      if (ga > 0) { cx.strokeStyle = `rgba(${GOLD_RGB},${ga})`; cx.lineWidth = 2; cx.stroke(); }
      if (p > .35 || age > ETRACE) {
        const tipA = age <= 1000 ? Math.max(ga, fall * .7 * (1 - age / 1000)) : 0;
        if (tipA > 0) {
          const tip = 16, baseOff = edges[o + 7] - edges[o + 4];
          cx.setLineDash([tip, Math.max(0.001, per - tip)]);
          cx.strokeStyle = `rgba(${GOLD_RGB},${tipA})`; cx.lineWidth = 4;
          cx.lineDashOffset = -((baseOff + half - tip / 2) % per); cx.stroke();
          cx.lineDashOffset = -((baseOff - half - tip / 2) % per); cx.stroke();
          cx.strokeStyle = `rgba(255,236,190,${tipA * .85})`; cx.lineWidth = 2;
          cx.lineDashOffset = -((baseOff + half - tip / 2) % per); cx.stroke();
          cx.lineDashOffset = -((baseOff - half - tip / 2) % per); cx.stroke();
        }
      }
      cx.globalCompositeOperation = 'lighter';
      }
      cx.restore();
    }
    cx.setLineDash([]);
    // erase every protected text box (a union, so nested or overlapping boxes can't cancel out), last, after the edge light too
    cx.globalCompositeOperation = 'destination-out'; cx.fillStyle = '#000';
    for (let k = 0; k < kcount; k++) { const r = kref[k].getBoundingClientRect(), o = k * 4; cx.fillRect(r.left + keep[o], r.top + keep[o + 1], r.width - keep[o + 2], r.height - keep[o + 3]); }
    cx.globalCompositeOperation = 'lighter';
    if (alive) requestAnimationFrame(frame); else { running = false; cx.clearRect(0, 0, innerWidth, innerHeight); count = 0; head = 0; ecount = 0; eref.fill(null); kref.fill(null, 0, kcount); kcount = 0; ksrc = null; }
  };

  const armRing = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
    const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const btnRad = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.height / 2, r.width / 2);
    // keep-out box of the pressed control (same insets as keepOut), then sit the ring 4px outside it
    const kl = r.left + pl - 3, kt = r.top + pt - 2, kr = r.right - pr + 3, kb = r.bottom - pb + 2;
    const exp = 9;   // 4px gap past keep-out + half of the 10px falloff so the inner edge lands ~4px out
    const L = kl - exp, T = kt - exp, W = (kr - kl) + exp * 2, H = (kb - kt) + exp * 2;
    const rad = Math.min(Math.max(0, btnRad + (L - r.left)), W / 2, H / 2);
    const path = new Path2D();
    if (path.roundRect) path.roundRect(L, T, W, H, rad); else path.rect(L, T, W, H);
    ringPath = path;
    const inside = flashX >= L && flashX <= L + W && flashY >= T && flashY <= T + H;
    let nx, ny, fx, fy;
    if (inside) {
      const dl = flashX - L, dr = L + W - flashX, dt = flashY - T, db = T + H - flashY, m = Math.min(dl, dr, dt, db);
      if (m === dl) { nx = L; ny = flashY; fx = L + W; fy = flashY; }
      else if (m === dr) { nx = L + W; ny = flashY; fx = L; fy = flashY; }
      else if (m === dt) { nx = flashX; ny = T; fx = flashX; fy = T + H; }
      else { nx = flashX; ny = T + H; fx = flashX; fy = T; }
    } else {
      nx = Math.min(Math.max(flashX, L), L + W); ny = Math.min(Math.max(flashY, T), T + H);
      fx = L + W - (nx - L); fy = T + H - (ny - T);
    }
    const g = cx.createLinearGradient(nx, ny, fx, fy);
    g.addColorStop(0, `rgba(${GOLD_RGB},1)`);
    g.addColorStop(1, `rgba(${GOLD_RGB},.3)`);
    ringGrad = g;
    // larger buttons stroke more gold pixels; scale alpha so burst gold stays comparable
    const perim = Math.max(1, 2 * (r.width + r.height) - btnRad * (8 - 2 * Math.PI));
    const Pref = 298, lo = 0.45, hi = 1.7;
    ringScale = Math.min(hi, Math.max(lo, Pref / perim));
  };
  document.addEventListener('pointerdown', ev => {
    if (ev.button > 0) return; const el = ev.target.closest(SEL); if (!el) return;
    flashX = ev.clientX; flashY = ev.clientY; flashT = performance.now(); keepOut(ev.clientX, ev.clientY, el); if (!kover) { spawn(ev.clientX, ev.clientY, flashT); armRing(el); } else { flashT = -1e9; ringPath = null; ringGrad = null; ringScale = 1; if (!running) { running = true; requestAnimationFrame(frame); } } near(ev.clientX, ev.clientY, flashT, el);
    el.classList.remove('zap'); void el.offsetWidth; el.classList.add('zap');
  }, { passive: true });
  const markDirty = () => { if (running) kdirty = true; };
  document.addEventListener('click', markDirty, true); document.addEventListener('toggle', markDirty, true); addEventListener('scroll', markDirty, { passive: true }); addEventListener('resize', markDirty, { passive: true });
  document.addEventListener('animationend', ev => { if (ev.animationName === 'zap') ev.target.classList.remove('zap'); else if (ev.animationName === 'aoe') ev.target.classList.remove('aoe'); });
})();
