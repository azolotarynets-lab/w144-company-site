// C01 navigation. A dimension marker rides the rule under the word the pointer is on and returns to the current
// page on leave; Projects opens a sheet laid over the page, tied to the marker by a leader line, with a preview pane
// that shows the screen of the project under the pointer.
// Keyboard: focus points like hover, Enter/Space toggles a sheet, Escape closes it.
(() => {
  function init(bar) {
    const ul = bar.querySelector('ul'), items = [...bar.querySelectorAll('a.item')], rule = bar.querySelector('.c-navrule'), mk = rule.querySelector('.mk');
    const sheets = Object.fromEntries([...bar.querySelectorAll('.c-navsheet')].map(s => [s.dataset.sheet, s]));
    const current = () => items.find(a => a.hasAttribute('aria-current'));   // none on the 404 page: the marker rests nowhere
    const narrow = window.matchMedia('(max-width: 900px)');   // phones: no sheets, the items are plain links to their sections
    let pointed = null, openKey = null, tOpen = 0, tClose = 0;
    function place(a, instant) {
      if (!a) { mk.classList.remove('ready'); return; }
      const t = a.querySelector('.t') || a, r = t.getBoundingClientRect(), b = rule.getBoundingClientRect();
      const track = parseFloat(getComputedStyle(t).letterSpacing) || 0;   // the tracking after the last letter is not part of the word
      if (instant) mk.classList.add('instant');
      mk.style.setProperty('--x', (r.left - b.left).toFixed(1) + 'px'); mk.style.setProperty('--w', (r.width - track).toFixed(1) + 'px');
      if (instant) { void mk.offsetWidth; mk.classList.remove('instant'); }
      mk.classList.add('ready');
    }
    function point(a) {
      pointed = a; ul.classList.add('pointing'); items.forEach(i => i.classList.toggle('on', i === a)); place(a);
      clearTimeout(tOpen); clearTimeout(tClose);
      if (a.dataset.sheet && !narrow.matches) tOpen = setTimeout(() => open(a.dataset.sheet), openKey ? 0 : 90); else close();
    }
    function release() {
      pointed = null; ul.classList.remove('pointing'); items.forEach(i => i.classList.remove('on'));
      place(current());
    }
    // a sheet stops 16 px above the screen's foot; taller than that it scrolls inside (components.css)
    function fit(s) { s.style.maxHeight = Math.max(240, innerHeight - (bar.getBoundingClientRect().bottom + 26) - 16) + 'px'; }
    addEventListener('resize', () => { if (openKey) fit(sheets[openKey]); });
    // the wheel over a sheet belongs to the sheet: it scrolls the sheet while it can, and never the page under it
    Object.values(sheets).forEach(s => s.addEventListener('wheel', e => {
      const down = e.deltaY > 0, end = s.scrollTop + s.clientHeight >= s.scrollHeight - 1, top = s.scrollTop <= 0;
      if ((down && end) || (!down && top)) e.preventDefault();
    }, { passive: false }));
    // a sheet's preview pane: its first opening loads the screens; the row under the pointer (or in focus) shows its own
    function show(s, i) { s.querySelectorAll('[data-i]').forEach(e => e.classList.toggle('on', e.dataset.i === i)); }
    Object.values(sheets).forEach(s => s.querySelectorAll('.row').forEach(r => { r.addEventListener('mouseenter', () => show(s, r.dataset.i)); r.addEventListener('focus', () => show(s, r.dataset.i)); }));
    function open(key) {
      if (openKey === key) return; close(true);
      const s = sheets[key]; if (!s) return; openKey = key; fit(s); s.scrollTop = 0; s.classList.add('open'); s.setAttribute('aria-hidden', 'false');
      s.querySelectorAll('.pv img[data-src]').forEach(i => { i.src = i.dataset.src; i.removeAttribute('data-src'); }); show(s, '0');
      bar.classList.add('has-sheet'); items.forEach(i => { if (i.dataset.sheet) i.setAttribute('aria-expanded', String(i.dataset.sheet === key)); });
    }
    function close(swap) {
      if (!openKey) return; const s = sheets[openKey]; s.classList.remove('open'); s.setAttribute('aria-hidden', 'true');
      items.forEach(i => { if (i.dataset.sheet) i.setAttribute('aria-expanded', 'false'); }); openKey = null;
      if (!swap) bar.classList.remove('has-sheet');
    }
    function leaveSoon() { clearTimeout(tOpen); clearTimeout(tClose); tClose = setTimeout(() => { close(); release(); }, 220); }
    items.forEach(a => {
      a.addEventListener('mouseenter', () => point(a));
      a.addEventListener('focus', () => point(a));
      if (a.dataset.sheet) a.addEventListener('click', e => { if (narrow.matches) return; e.preventDefault(); if (openKey === a.dataset.sheet) close(); else { point(a); clearTimeout(tOpen); open(a.dataset.sheet); } });
    });
    bar.addEventListener('mouseleave', leaveSoon);
    bar.addEventListener('mouseenter', () => clearTimeout(tClose));
    Object.values(sheets).forEach(s => { s.addEventListener('mouseenter', () => clearTimeout(tClose)); });
    bar.addEventListener('focusout', e => { if (!bar.contains(e.relatedTarget)) leaveSoon(); });
    bar.addEventListener('keydown', e => { if (e.key === 'Escape' && openKey) { const k = openKey; close(); const a = items.find(i => i.dataset.sheet === k); if (a) a.focus(); } });
    const replace = () => place(pointed || current(), true);
    new ResizeObserver(replace).observe(rule);
    if (document.fonts) document.fonts.ready.then(replace);
    replace();
    bar._nav = { point, release, open, close };   // for the verification script
  }
  // phones: Menu opens the leaf under the rule (down to the bottom of the screen, the page held still behind it);
  // Projects inside opens its rows in place; a link, Escape or a wider screen closes it
  function mob(bar) {
    const btn = bar.querySelector('.c-nav .menu'), leaf = bar.querySelector('.c-navmob'); if (!btn || !leaf) return;
    const proj = leaf.querySelector('button.mi'), phone = window.matchMedia('(max-width: 640px)');
    const isOpen = () => leaf.classList.contains('open');
    function set(open) {
      if (open) { leaf.style.setProperty('--top', bar.getBoundingClientRect().bottom.toFixed(1) + 'px'); leaf.querySelectorAll('img[data-src]').forEach(i => { i.src = i.dataset.src; i.removeAttribute('data-src'); }); }
      leaf.classList.toggle('open', open); leaf.setAttribute('aria-hidden', String(!open));
      btn.setAttribute('aria-expanded', String(open));
      bar.classList.toggle('has-sheet', open);                              // scroll.js keeps the header in place while a sheet is open
      document.documentElement.classList.toggle('menu-open', open);
      if (!open && proj) proj.setAttribute('aria-expanded', 'false');
    }
    btn.addEventListener('click', () => set(!isOpen()));
    if (proj) proj.addEventListener('click', () => proj.setAttribute('aria-expanded', String(proj.getAttribute('aria-expanded') !== 'true')));
    leaf.addEventListener('click', e => { if (e.target.closest('a[href]')) set(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { set(false); btn.focus(); } });
    phone.addEventListener('change', () => { if (!phone.matches && isOpen()) set(false); });
  }
  function boot() { document.querySelectorAll('[data-nav]').forEach(b => { init(b); mob(b); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
