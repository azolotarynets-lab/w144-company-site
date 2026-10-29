import { scroll, step as scrollStep, measure } from './scroll.js';
import { lamp, mouse, tick as lampTick } from './light.js';
import { Scene } from './scene.js';
import { createSheet } from './sheet.js';

// inline the mark so it can be rasterised with the page's colours
async function inlineMarks() {
  const cache = new Map();
  for (const host of document.querySelectorAll('[data-svg]')) {
    const src = host.dataset.svg;
    if (!cache.has(src)) cache.set(src, fetch(src).then(r => r.text()));
    const txt = (await cache.get(src))
      .replace(/fill="#000000"/g, 'fill="var(--mark-ink)"').replace(/stroke="#000000"/g, 'stroke="var(--mark-ink)"')
      .replace(/fill="#ffffff"/g, 'fill="var(--mark-paper)"').replace(/stroke="#ffffff"/g, 'stroke="var(--mark-paper)"');
    host.innerHTML = txt;
    const svg = host.querySelector('svg'); svg.removeAttribute('width'); svg.removeAttribute('height');
  }
}

// pictures marked loading="lazy" (tools/build_public.py) load two screens ahead of the reader: the browser's own
// distance differs from one browser to the next and is short in Safari; the engine prints each one as it arrives
const near = 'IntersectionObserver' in window
  ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.loading = 'eager'; near.unobserve(e.target); } }), { rootMargin: '200% 0px 200% 0px' })
  : null;
document.querySelectorAll('img[loading="lazy"]').forEach(i => { if (near) near.observe(i); else i.loading = 'eager'; });
// once the first screen has settled, the rest come in quietly, one after another in page order: the engine prints a
// drawing as it arrives, and printing one in the middle of a scroll cost WebKit a 90 ms frame (2026-10-28); this way
// they are printed while the reader is still on the first screen, and the opening stays as light as before
addEventListener('load', () => setTimeout(function next() {
  const i = [...document.querySelectorAll('img[loading="lazy"]')].find(i => !(i.complete && i.naturalWidth)); if (!i) return;
  if (near) near.unobserve(i);
  const go = () => setTimeout(next, 120);
  i.addEventListener('load', go, { once: true }); i.addEventListener('error', go, { once: true });
  i.loading = 'eager';
}, 1000));

const sheet = createSheet();
const scene = sheet ? new Scene(sheet.gl, sheet.dpr) : null;
if (scene) scene.onchange = () => { dirty = true; };
let rebuild = 0;

async function build() {
  if (!scene) return;
  await document.fonts.ready;
  measure(); scrollStep();
  await scene.build();
  dirty = true;
}

function hoverStep() {
  if (!scene) return false;
  let busy = false;
  const my = mouse.y + scroll.y;
  for (const it of scene.items) {
    if (!it.hover) continue;
    if (it.follow) {
      // the loupe follows the pointer and only exists over its engraving
      const L = it.lens; if (!L) continue;
      const over = mouse.has && mouse.x > L[0] - 30 && mouse.x < L[0] + L[2] + 30 && my > L[1] - 30 && my < L[1] + L[3] + 30;
      it.target = over ? 1 : 0;
      if (over || it.mix > 0.01) { it.x = mouse.x - it.w / 2; it.y = my - it.h / 2; }
    } else {
      it.target = (mouse.has && mouse.x > it.x && mouse.x < it.x + it.w && my > it.y && my < it.y + it.h) ? 1 : 0;
    }
    it.mix += (it.target - it.mix) * (it.target > it.mix ? 0.08 : 0.05);
    if (Math.abs(it.target - it.mix) > 0.002) busy = true;
  }
  return busy;
}

// The sheet is drawn only when something on it changed: the page moved, the lamp moved by more than a pixel and a half
// (its slow drift then costs ~9 frames a second instead of every frame), a hover is easing, or the scene was rebuilt.
const last = { y: NaN, lx: 0, ly: 0 };
let dirty = true;
function loop(now) {
  scrollStep();
  lampTick(now);
  const hovering = hoverStep();
  if (sheet) {
    const moved = scroll.y !== last.y, lampMoved = Math.hypot(lamp.x - last.lx, lamp.y - last.ly) > 1.5;
    if (moved || lampMoved || hovering || dirty) {
      if (moved) sheet.canvas.style.transform = `translate3d(0, ${scroll.y.toFixed(2)}px, 0)`;
      sheet.render(scene, scroll.y, lamp);
      last.y = scroll.y; last.lx = lamp.x; last.ly = lamp.y; dirty = false;
    }
  }
  requestAnimationFrame(loop);
}

inlineMarks().then(build);
requestAnimationFrame(loop);
addEventListener('resize', () => { dirty = true; clearTimeout(rebuild); rebuild = setTimeout(build, 150); });   // a resized canvas is blank until drawn

addEventListener('keydown', e => {
  if (e.key === 'g') document.body.classList.toggle('show-grid');
  if (e.key === 'd') document.body.classList.toggle('debug');
});

const ro = document.getElementById('lamp-readout');
if (ro) setInterval(() => { ro.textContent = `lamp ${lamp.x | 0}, ${lamp.y | 0}`; }, 250);
