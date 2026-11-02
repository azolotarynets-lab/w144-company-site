// One lamp above the sheet. It stands still (owner 2026-11-02: its slow drift and its lean toward the cursor could not
// be seen, and they kept the sheet and the showcases' shadows redrawing): where the drift was centred, over the middle
// of the sheet a little above the screen. It moves only with the window's size.
// The sheet renderer reads lamp.x/y/z; the few CSS-lit leftovers get --ldx/--ldy on themselves.
export const lamp = { x: 0, y: 0, z: 1000 };
const root = document.documentElement;
let W = innerWidth, H = innerHeight;
export const mouse = { x: 0, y: 0, has: false };   // the sheet's hover items read the pointer
let lastKey = '';
// the lamp's direction goes only to the things CSS lights by it, never to :root. Written on :root it restyled the whole
// page at every turn, and WebKit then rebuilt the hatched band of the showcase under the cursor (its 45 degree SVG
// pattern): ~50 ms a frame, about nine times a second, while the reader scrolled the projects (2026-10-29)
const LIT = '.c-plate .sh, .c-navsheet, .raised, .bevel, .swatch, .c-prod .float';
let lit = null;

export function tick() {
  lamp.x = W * 0.46; lamp.y = -H * 0.10; lamp.z = Math.max(W, 900) * 0.85;
  const dx = lamp.x - W / 2, dy = lamp.y - H / 2, len = Math.hypot(dx, dy) || 1;
  const key = (dx / len).toFixed(2) + ',' + (dy / len).toFixed(2);   // written once, and again only for a new window size
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
