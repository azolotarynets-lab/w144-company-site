// Virtual scroll. The page is fixed and moved by transform from the same frame loop that
// renders the sheet, so paper and content never drift apart (native scroll in Safari
// composites asynchronously and the WebGL paper lagged a frame behind the text).
export const scroll = { y: 0, target: 0, max: 0, lerp: 0.14 };

const page = document.querySelector('.page');
const spacer = document.createElement('div');
spacer.className = 'scroll-spacer';
document.body.appendChild(spacer);

export function measure() {
  const h = page.scrollHeight;
  spacer.style.height = h + 'px';
  scroll.max = Math.max(0, h - innerHeight);
}

// the easing is per time, not per frame: lerp is the share covered in one 120 Hz frame, so Safari at 60 Hz trails no longer than Chrome at 120
let lastT = 0;
// the header: counter-moved by the page's own offset in the same frame, so it stays put without a jitter.
// Up to 900 px wide it steps out of the way while the reader scrolls down and returns on the way up.
const header = document.querySelector('.l-top');
const narrow = matchMedia('(max-width: 900px)');
const head = { hide: 0, to: 0, lastTarget: 0, stuck: false };
function holdHeader(k) {
  if (!header) return;
  const h = header.offsetHeight, t = scroll.target, open = header.querySelector('.c-navbar.has-sheet');
  if (narrow.matches && !open) {
    if (t > head.lastTarget + 2 && scroll.y > h) head.to = h + 12; else if (t < head.lastTarget - 2 || t < h) head.to = 0;
  } else head.to = 0;
  head.lastTarget = t;
  head.hide += (head.to - head.hide) * Math.min(1, k * 1.6);
  if (Math.abs(head.to - head.hide) < 0.3) head.hide = head.to;
  header.style.transform = `translate3d(0, ${(scroll.y - head.hide).toFixed(2)}px, 0)`;
  const stuck = scroll.y > 2;
  if (stuck !== head.stuck) { head.stuck = stuck; header.classList.toggle('is-stuck', stuck); }
}
export function step() {
  const now = performance.now(), dt = lastT ? Math.min(now - lastT, 100) : 1000 / 120; lastT = now;
  scroll.target = Math.min(window.scrollY, scroll.max);
  const d = scroll.target - scroll.y, k = scroll.lerp >= 1 ? 1 : 1 - Math.pow(1 - scroll.lerp, dt / (1000 / 120));
  if (Math.abs(d) < 0.05) scroll.y = scroll.target; else scroll.y += d * k;
  page.style.transform = `translate3d(0, ${(-scroll.y).toFixed(2)}px, 0)`;
  holdHeader(k);
}

export function jump(y) { scroll.y = scroll.target = y; window.scrollTo(0, y); step(); }

if (matchMedia('(prefers-reduced-motion: reduce)').matches) scroll.lerp = 1;
new ResizeObserver(measure).observe(page);
addEventListener('resize', measure);
measure();

// Anchors. The page sits in a fixed layer, so a native jump to #id moves nothing: links to an id on this page
// scroll the window to that element's place in the page (the frame loop then eases the page there), and a page
// opened with a hash (index.html#software from another page) lands on it once the layout has settled.
const NAV_CLEAR = 24;
function anchorY(id) {
  const el = id && document.getElementById(id); if (!el) return null;
  const top = el.getBoundingClientRect().top + scroll.y;   // the element's place in the page
  return Math.max(0, Math.min(top - (header ? header.offsetHeight : 0) - NAV_CLEAR, scroll.max));   // land under the header
}
addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
  const url = new URL(a.getAttribute('href'), location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname || !url.hash) return;
  const y = anchorY(decodeURIComponent(url.hash.slice(1))); if (y === null) return;
  e.preventDefault(); history.replaceState(null, '', url.hash);
  window.scrollTo(0, y);
});
addEventListener('load', () => {
  if (!location.hash) return;
  measure();
  const go = () => { const y = anchorY(decodeURIComponent(location.hash.slice(1))); if (y !== null) jump(y); };
  requestAnimationFrame(go); setTimeout(go, 600);   // once more after the shapes and fonts have settled
});
