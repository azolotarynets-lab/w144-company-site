// The contact page as an assembly drawing. A leader runs from each part of the drawing (a dot on the part) to the
// balloon of its address row, ending in a short shoulder. The drawing is set so the first part sits a little below the
// first balloon: the leaders then fan out in order and never cross another part. Hovering a row or a part inks its
// leader, balloon and part. When the drawing moves, the paper engine is asked to re-measure (it prints the drawing).
(() => {
  const asm = document.querySelector('.c-asm'); if (!asm) return;
  const fig = asm.querySelector('.fig'), img = fig.querySelector('img'), side = asm.querySelector('.side'), svg = asm.querySelector('.leaders');
  const calls = [...asm.querySelectorAll('.call')], pts = [...asm.querySelectorAll('.pt')];
  const NS = 'http://www.w3.org/2000/svg', wide = matchMedia('(min-width: 901px)');
  let applied = '';
  function layout() {
    svg.innerHTML = '';
    fig.style.marginTop = ''; side.style.marginTop = '';
    if (!wide.matches) return settle();
    // the first part a little below the first balloon
    const b0 = calls[0].querySelector('.bal').getBoundingClientRect(), p0 = pts[0].getBoundingClientRect();
    const need = (b0.top + b0.height / 2 + 34) - (p0.top + p0.height / 2);
    if (need > 0) fig.style.marginTop = `${Math.round(need)}px`; else side.style.marginTop = `${Math.round(-need)}px`;
    const A = asm.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${A.width} ${A.height}`); svg.setAttribute('width', A.width); svg.setAttribute('height', A.height);
    calls.forEach((c, k) => {
      const P = pts[k].getBoundingClientRect(), bal = c.querySelector('.bal').getBoundingClientRect();
      const px = P.left + P.width / 2 - A.left, py = P.top + P.height / 2 - A.top;
      const bx = bal.left - A.left, by = bal.top + bal.height / 2 - A.top, shoulder = 34;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', `M${px.toFixed(1)} ${py.toFixed(1)} L${(bx - shoulder).toFixed(1)} ${by.toFixed(1)} L${(bx - 1).toFixed(1)} ${by.toFixed(1)}`);
      path.dataset.n = c.dataset.n; svg.appendChild(path);
    });
    settle();
  }
  function settle() {   // the engine prints the drawing where it measured it: re-measure once the drawing has moved
    const now = fig.style.marginTop + '|' + side.style.marginTop;
    if (now !== applied) { applied = now; dispatchEvent(new Event('resize')); }
  }
  function hl(n, on) {
    calls.forEach(c => { const me = on && c.dataset.n === n; c.classList.toggle('on', me); c.classList.toggle('is-hover', me); });   // is-hover runs the pencil pass, as on the buttons
    pts.forEach(p => p.classList.toggle('on', on && p.dataset.n === n));
    svg.querySelectorAll('path').forEach(p => p.classList.toggle('on', on && p.dataset.n === n));
  }
  calls.forEach(c => { c.addEventListener('mouseenter', () => hl(c.dataset.n, true)); c.addEventListener('mouseleave', () => hl(c.dataset.n, false)); c.addEventListener('focus', () => hl(c.dataset.n, true)); c.addEventListener('blur', () => hl(c.dataset.n, false)); });
  pts.forEach(p => { p.addEventListener('mouseenter', () => hl(p.dataset.n, true)); p.addEventListener('mouseleave', () => hl(p.dataset.n, false)); });
  const go = () => requestAnimationFrame(layout);
  if (img.complete) go(); else img.addEventListener('load', go);
  new ResizeObserver(go).observe(asm.parentElement); if (document.fonts) document.fonts.ready.then(go);
})();
