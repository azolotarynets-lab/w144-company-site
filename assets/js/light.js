// One lamp above the sheet. It drifts slowly and leans a little toward the cursor.
// The sheet renderer reads lamp.x/y/z; the few CSS-lit leftovers get --ldx/--ldy on themselves.
export const lamp = { x: 0, y: 0, z: 1000 };
const root = document.documentElement;
let W = innerWidth, H = innerHeight;
export const mouse = { x: 0, y: 0, has: false };
const nudge = { x: 0, y: 0 };
let reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
let lastKey = '';
// the lamp's direction goes only to the things CSS lights by it, never to :root. Written on :root it restyled the whole
// page at every turn, and WebKit then rebuilt the hatched band of the showcase under the cursor (its 45 degree SVG
// pattern): ~50 ms a frame, about nine times a second, while the reader scrolled the projects (2026-10-29)
const LIT = '.c-plate .sh, .c-navsheet, .raised, .bevel, .swatch, .c-prod .float';
let lit = null;

export function tick(now) {
  const t = reduce ? 0 : now / 1000;
  const bx = W * 0.46 + W * 0.17 * Math.sin(t * 0.047) + W * 0.05 * Math.sin(t * 0.123 + 1.7);
  const by = -H * 0.10 + H * 0.10 * Math.sin(t * 0.031 + 0.6) + H * 0.04 * Math.cos(t * 0.089);
  const tx = mouse.has ? (mouse.x - W / 2) * 0.16 : 0;
  const ty = mouse.has ? (mouse.y - H / 2) * 0.16 : 0;
  nudge.x += (tx - nudge.x) * 0.02; nudge.y += (ty - nudge.y) * 0.02;
  lamp.x = bx + nudge.x; lamp.y = by + nudge.y; lamp.z = Math.max(W, 900) * 0.85;
  const dx = lamp.x - W / 2, dy = lamp.y - H / 2, len = Math.hypot(dx, dy) || 1;
  const key = (dx / len).toFixed(2) + ',' + (dy / len).toFixed(2);   // 2 decimals: every write restyles what it lights, a 0.01 turn of a shadow is invisible
  if (key !== lastKey) {
    lastKey = key; lit = lit || document.querySelectorAll(LIT);
    const lx = (dx / len).toFixed(2), ly = (dy / len).toFixed(2);
    for (const el of lit) { el.style.setProperty('--ldx', lx); el.style.setProperty('--ldy', ly); }
    if (root.classList.contains('no-webgl')) {   // without the sheet the page's own background is lit (materials.css)
      root.style.setProperty('--light-x', lamp.x.toFixed(0) + 'px'); root.style.setProperty('--light-y', lamp.y.toFixed(0) + 'px');
    }
  }
}
addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true; }, { passive: true });
addEventListener('mouseleave', () => { mouse.has = false; });
addEventListener('resize', () => { W = innerWidth; H = innerHeight; });
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', e => { reduce = e.matches; });
