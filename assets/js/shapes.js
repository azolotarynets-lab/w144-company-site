// Drafted button shapes. Each .c-shape[data-shape] gets two SVGs sized to the button: the body (outline or ink fill)
// and the hatch band (the strip between the outline and the same outline set in by BAND px). Paths are rebuilt on
// resize so corners keep their true geometry and hairlines stay crisp. Shapes: cartouche, chamfer, arch, break.
(() => {
  const NS = 'http://www.w3.org/2000/svg', BAND = 7, PAD = 8, H = 0.5;
  const f = n => Math.round(n * 100) / 100;
  const P = pts => 'M' + pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L') + 'Z';
  const SHAPES = {
    // engraved label: concave quarter-round corners
    cartouche(w, h, d) {
      const r = 9, R = r + d, a = Math.sqrt(R * R - d * d), A = (x, y) => `A${f(R)} ${f(R)} 0 0 0 ${f(x)} ${f(y)}`;
      return { body: `M${f(a)} ${f(d)}L${f(w - a)} ${f(d)}${A(w - d, a)}L${f(w - d)} ${f(h - a)}${A(w - a, h - d)}L${f(a)} ${f(h - d)}${A(d, h - a)}L${f(d)} ${f(a)}${A(a, d)}Z` };
    },
    // instrument plate: 45 degree chamfers
    chamfer(w, h, d, C = 10) {
      const e = C + d * (Math.SQRT2 - 1), pts = [[e, d], [w - e, d], [w - d, e], [w - d, h - e], [w - e, h - d], [e, h - d], [d, h - e], [d, e]];
      return { body: P(pts), pts };
    },
    // doorway: a shallow segmental arch on top, a centre mark through the crown
    arch(w, h, d) {
      const k = 9, R = (w * w / 4 + k * k) / (2 * k), r = R - d, y1 = R - Math.sqrt(r * r - (w / 2 - d) * (w / 2 - d));
      return { body: `M${f(d)} ${f(h - d)}L${f(d)} ${f(y1)}A${f(r)} ${f(r)} 0 0 1 ${f(w - d)} ${f(y1)}L${f(w - d)} ${f(h - d)}Z`,
               extra: d < 1 ? `M${f(w / 2)} -6V5` : '' };
    },
    // break line: the right edge is the drafting break symbol, run past the outline top and bottom
    break(w, h, d) {
      const x = w - d, m = h / 2, z = 4;
      return { body: P([[d, d], [x, d], [x, m - 7], [x + z, m - 2.5], [x - z, m + 2.5], [x, m + 7], [x, h - d], [d, h - d]]),
               extra: d < 1 ? `M${f(x)} -6V0M${f(x)} ${f(h)}V${f(h + 6)}` : '' };
    },
  };
  let uid = 0;
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function build(btn) {
    const kind = btn.dataset.shape, fn = SHAPES[kind]; if (!fn) return;
    const w = btn.offsetWidth, h = btn.offsetHeight; if (!w || !h) return;
    if (btn._w === w && btn._h === h) return; btn._w = w; btn._h = h;
    btn.querySelectorAll(':scope > svg.sh-body, :scope > svg.sh-hatch').forEach(n => n.remove());
    // always out of flow, even if a stylesheet rule goes missing: in flow the outline would grow its host, which rebuilds it bigger, forever
    const box = { viewBox: `${-PAD} ${-PAD} ${w + 2 * PAD} ${h + 2 * PAD}`, width: w + 2 * PAD, height: h + 2 * PAD, 'aria-hidden': 'true', style: 'position:absolute' };
    let C = +btn.dataset.c || undefined, band = +btn.dataset.band || BAND;
    if (btn.dataset.cr) C = Math.max(8, Math.min(C, w * +btn.dataset.cr));          // plates: the chamfer and the band scale down with the width
    if (btn.dataset.br) band = Math.max(4, Math.round(Math.min(band, w * +btn.dataset.br)));
    const plate = btn.closest('.c-plate');
    if (btn.classList.contains('c-card') && plate && getComputedStyle(btn).position === 'absolute') {
      // a card laid in the screen's corner takes the screen's own inner cut, so the two chamfers coincide
      const pc = parseFloat(plate.style.getPropertyValue('--chamf')), pb = parseFloat(plate.style.getPropertyValue('--plate-band'));
      if (pc && pb) C = Math.max(6, pc - pb * (2 - Math.SQRT2));
    }
    const host = btn.classList.contains('lift') ? (btn.closest('.c-plate') || btn) : btn;   // only a plate's lift speaks for the plate (a card inside it has its own shape)
    host.style.setProperty('--band', band + 'px');
    if (btn.classList.contains('lift') && plate) { plate.style.setProperty('--plate-band', band + 'px'); plate.style.setProperty('--lift-h', h + 'px'); }   // the screen's own height: on narrow screens the card sits below it, outside its shadow
    const outer = fn(w - 2 * H, h - 2 * H, 0, C), inner = fn(w - 2 * H, h - 2 * H, band, C);
    const body = el('svg', { ...box, class: 'sh-body' });
    const g = el('g', { transform: `translate(${H} ${H})` }, body);
    el('path', { class: 'o', d: outer.body }, g);
    if (outer.extra) el('path', { class: 'x', d: outer.extra }, g);
    const hatch = el('svg', { ...box, class: 'sh-hatch pass' });
    const id = 'shh' + (++uid);
    const pat = el('pattern', { id, width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, el('defs', {}, hatch));
    el('line', { x1: 0.5, y1: 0, x2: 0.5, y2: 5 }, pat);
    const g2 = el('g', { transform: `translate(${H} ${H})` }, hatch);
    // a polygon band goes in as one piece per side: a pattern fills the whole box of its path, and the box of a ring is
    // the whole plate. Over a showcase that is millions of pixels, painted on every frame of the pencil pass: WebKit
    // drew it at 40-80 ms a frame (2026-10-29). Pieces along the sides keep the boxes thin; userSpaceOnUse keeps the hatch continuous
    if (outer.pts) outer.pts.forEach((p, i) => { const j = (i + 1) % outer.pts.length;
      el('path', { class: 'band', d: P([p, outer.pts[j], inner.pts[j], inner.pts[i]]), fill: `url(#${id})` }, g2); });
    else el('path', { class: 'band', d: outer.body + inner.body, 'fill-rule': 'evenodd', fill: `url(#${id})` }, g2);
    btn.prepend(hatch); btn.prepend(body);
    if (kind === 'chamfer') {                     // plates: the screen is clipped to the inner outline, the shadow to the outer
      const cc = C || 10, oct = (d) => { const e = cc + d * (Math.SQRT2 - 1), W = w - 2 * H, Hh = h - 2 * H;
        return [[e, d], [W - e, d], [W - d, e], [W - d, Hh - e], [W - e, Hh - d], [e, Hh - d], [d, Hh - e], [d, e]]; };
      const poly = (pts, ox, oy) => 'polygon(' + pts.map(p => f(p[0] + H - ox) + 'px ' + f(p[1] + H - oy) + 'px').join(',') + ')';
      host.style.setProperty('--clip-in', poly(oct(band), band, band));
      host.style.setProperty('--clip-out', poly(oct(0), 0, 0));
      host.style.setProperty('--chamf', cc + 'px');
    }
    if (btn.classList.contains('lift') && plate) plate.querySelectorAll('.c-card[data-shape]').forEach(c => { c._w = 0; build(c); });   // the card follows the screen
  }
  function all() { document.querySelectorAll('[data-shape]').forEach(build); }
  // rebuilt on the next frame, not inside the observer: a rebuild changes the sizes it observes (the band, the card
  // that follows its screen), and inside the delivery that now and then ended in "ResizeObserver loop completed"
  const pending = new Set(); let raf = 0;
  const flush = () => { raf = 0; const list = [...pending]; pending.clear(); list.forEach(build); };
  const ro = 'ResizeObserver' in window ? new ResizeObserver(es => { es.forEach(e => pending.add(e.target)); if (!raf) raf = requestAnimationFrame(flush); }) : null;
  function init() { all(); if (ro) document.querySelectorAll('[data-shape]').forEach(b => ro.observe(b)); if (document.fonts) document.fonts.ready.then(() => { document.querySelectorAll('[data-shape]').forEach(b => { b._w = 0; }); all(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
