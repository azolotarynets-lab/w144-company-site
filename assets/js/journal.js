// The journal's rubrics: a button shows the articles of its rubric in the register, All shows every one.
(() => {
  const reg = document.querySelector('.c-jreg'); if (!reg) return;
  const btns = [...reg.querySelectorAll('.filt button')], rows = [...reg.querySelectorAll('.rows .r')];
  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    rows.forEach(r => { r.hidden = !(b.dataset.f === 'all' || r.dataset.rub === b.dataset.f); });
  }));
  btns.forEach(x => x.setAttribute('aria-pressed', String(x.classList.contains('on'))));
})();
