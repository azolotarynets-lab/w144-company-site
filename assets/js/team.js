// The masthead of the house: the portrait plate stands in the right columns and eases to the row the pointer is on.
// It shows the person's photo from data-img, or the initials until the photos arrive. Only where there is a pointer.
(() => {
  const m = document.querySelector('.c-mast'); if (!m || !matchMedia('(hover: hover)').matches) return;
  const box = m.querySelector('.portrait'), ini = box.querySelector('.ini'), ph = box.querySelector('.ph');
  const rows = [...m.querySelectorAll('.names li')];
  let y = 0, ty = 0, shown = false, raf = 0;
  const x = () => m.clientWidth * 6 / 8 + (m.clientWidth * 2 / 8 - box.offsetWidth) / 2;
  function frame() {
    y += (ty - y) * 0.16;
    box.style.transform = `translate3d(${x().toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    raf = Math.abs(ty - y) > 0.3 ? requestAnimationFrame(frame) : 0;
  }
  function show(li) {
    rows.forEach(r => { r.classList.toggle('on', r === li); r.classList.toggle('was', r === li); });
    const src = li.dataset.img; let img = ph.querySelector('img');
    if (src) { if (!img) { img = document.createElement('img'); img.alt = ''; ph.appendChild(img); } img.src = src; ini.textContent = ''; }
    else { if (img) img.remove(); ini.textContent = li.dataset.ini; }
    ty = li.offsetTop + li.offsetHeight / 2 - box.offsetHeight / 2;
    if (!shown) { y = ty; shown = true; }          // the first time it appears in place, after that it travels
    if (!raf) raf = requestAnimationFrame(frame);
  }
  rows.forEach(li => li.addEventListener('mouseenter', () => { m.classList.add('is-on'); show(li); }));
  // at rest the portrait stands by the first name; leaving the list keeps it by the last one hovered, the names undimmed
  m.querySelector('.names').addEventListener('mouseleave', () => { m.classList.remove('is-on'); rows.forEach(r => r.classList.remove('on')); });
  const place = () => { if (!m.classList.contains('is-on')) { const li = rows.find(r => r.classList.contains('was')) || rows[0]; ty = y = li.offsetTop + li.offsetHeight / 2 - box.offsetHeight / 2; box.style.transform = `translate3d(${x().toFixed(1)}px, ${y.toFixed(1)}px, 0)`; } };
  show(rows[0]); rows[0].classList.remove('on'); m.classList.remove('is-on'); m.classList.add('pf');
  new ResizeObserver(place).observe(m); if (document.fonts) document.fonts.ready.then(place);
})();
