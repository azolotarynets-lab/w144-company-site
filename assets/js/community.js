// The community page as an assembly drawing of a round table. A leader runs from each chair (a dot on the top rail of
// its back) to the balloon of its block, ending in a short shoulder: the blocks on the left are reached from their right,
// those on the right from their left; each balloon slides toward its chair's height. Hovering a block or a chair inks
// its leader, balloon and outline, and runs the pencil pass along the outline, as on the buttons. Below 1100 px the
// blocks stack under the drawing and the dots carry their numbers instead.
(() => {
  const root = document.querySelector('.c-cwin'); if (!root) return;
  const img = root.querySelector('.fig img'), svg = root.querySelector('.leaders');
  const blks = [...root.querySelectorAll('.blk')], pts = [...root.querySelectorAll('.pt')];
  const NS = 'http://www.w3.org/2000/svg', wide = matchMedia('(min-width: 1101px)'), SHOULDER = 30;
  function layout() {
    svg.innerHTML = '';
    if (!wide.matches) { blks.forEach(b => { b.querySelector('.bal').style.top = ''; }); return; }
    const A = root.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${A.width} ${A.height}`); svg.setAttribute('width', A.width); svg.setAttribute('height', A.height);
    blks.forEach(b => {
      // the balloon slides along the block's edge toward its chair's height, as far as the block reaches; past that the
      // leader runs at a slant, as leaders do on an assembly drawing (the blocks never move: two on a side would collide)
      const P = pts.find(p => p.dataset.n === b.dataset.n).getBoundingClientRect(), ball = b.querySelector('.bal'), h = ball.offsetHeight;
      const B = b.getBoundingClientRect(), dot = P.top + P.height / 2;
      ball.style.top = `${Math.round(Math.max(18, Math.min(B.height - h - 18, dot - B.top - h / 2)))}px`;
      const bal = ball.getBoundingClientRect();
      const px = P.left + P.width / 2 - A.left, py = P.top + P.height / 2 - A.top, by = bal.top + bal.height / 2 - A.top;
      const left = b.classList.contains('l'), bx = (left ? bal.right : bal.left) - A.left, s = left ? SHOULDER : -SHOULDER, e = left ? 1 : -1;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', `M${px.toFixed(1)} ${py.toFixed(1)} L${(bx + s).toFixed(1)} ${by.toFixed(1)} L${(bx + e).toFixed(1)} ${by.toFixed(1)}`);
      path.dataset.n = b.dataset.n; svg.appendChild(path);
    });
  }
  function hl(n, on) {
    blks.forEach(b => { const me = on && b.dataset.n === n; b.classList.toggle('on', me); b.classList.toggle('is-hover', me); });
    pts.forEach(p => p.classList.toggle('on', on && p.dataset.n === n));
    svg.querySelectorAll('path').forEach(p => p.classList.toggle('on', on && p.dataset.n === n));
  }
  for (const el of [...blks, ...pts]) { el.addEventListener('mouseenter', () => hl(el.dataset.n, true)); el.addEventListener('mouseleave', () => hl(el.dataset.n, false)); }
  const go = () => requestAnimationFrame(layout);
  if (img.complete) go(); else img.addEventListener('load', go);
  new ResizeObserver(go).observe(root); if (document.fonts) document.fonts.ready.then(go);
})();
