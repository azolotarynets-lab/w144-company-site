// Physical items: DOM elements marked data-phys become masks in the sheet's height field.
// Text is rasterised glyph by glyph at the positions the DOM laid them out, so wrapping,
// kerning and tracking match exactly; prints and marks become ink-density masks.
import { scroll } from './scroll.js';

const TYPES = { emboss: 0, press: 1, blind: 2, print: 3, plate: 4, bezel: 5, glass: 6, medal: 7, slab: 8, window: 9, pane: 10, under: 11, loupe: 12, card: 13, foil: 14 };

// exact euclidean distance transform (Felzenszwalb), used to cut real facets on raised type
function edt1d(f, d, v, z, n) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edt2d(grid, w, h) {
  const m = Math.max(w, h);
  const f = new Float32Array(m), d = new Float32Array(m), v = new Int32Array(m), z = new Float32Array(m + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = grid[y * w + x]; edt1d(f, d, v, z, h); for (let y = 0; y < h; y++) grid[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = grid[y * w + x]; edt1d(f, d, v, z, w); for (let x = 0; x < w; x++) grid[y * w + x] = d[x]; }
}
// sliding maximum (van Herk / Gil-Werman), window [i-r, i+r]
function slidingMax(a, n, r, g, h, out) {
  const k = 2 * r + 1;
  for (let i = 0; i < n; i++) g[i] = (i % k === 0) ? a[i] : Math.max(g[i - 1], a[i]);
  for (let i = n - 1; i >= 0; i--) h[i] = (i === n - 1 || (i + 1) % k === 0) ? a[i] : Math.max(h[i + 1], a[i]);
  for (let i = 0; i < n; i++) {
    const lo = i - r, hi = i + r;
    const a1 = lo >= 0 ? h[lo] : -1e20, a2 = hi < n ? g[hi] : g[n - 1];
    out[i] = Math.max(a1, a2);
  }
}
// separable box mean, window [i-r, i+r]: smooths the square max filter's stair-steps on diagonals
function meanFilter2d(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) { let sum = 0, cnt = 0; const o = y * w;
    for (let x = 0; x < Math.min(r, w); x++) { sum += src[o + x]; cnt++; }
    for (let x = 0; x < w; x++) { if (x + r < w) { sum += src[o + x + r]; cnt++; } if (x - r - 1 >= 0) { sum -= src[o + x - r - 1]; cnt--; } tmp[o + x] = sum / cnt; } }
  for (let x = 0; x < w; x++) { let sum = 0, cnt = 0;
    for (let y = 0; y < Math.min(r, h); y++) { sum += tmp[y * w + x]; cnt++; }
    for (let y = 0; y < h; y++) { if (y + r < h) { sum += tmp[(y + r) * w + x]; cnt++; } if (y - r - 1 >= 0) { sum -= tmp[(y - r - 1) * w + x]; cnt--; } src[y * w + x] = sum / cnt; } }
}
function maxFilter2d(src, w, h, r) {
  const m = Math.max(w, h), g = new Float32Array(m), hh = new Float32Array(m), row = new Float32Array(m), out = new Float32Array(m);
  const tmp = new Float32Array(src.length);
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) row[x] = src[y * w + x]; slidingMax(row, w, r, g, hh, out); for (let x = 0; x < w; x++) tmp[y * w + x] = out[x]; }
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) row[y] = tmp[y * w + x]; slidingMax(row, h, r, g, hh, out); for (let y = 0; y < h; y++) src[y * w + x] = out[y]; }
}
// float mask for raised type: R coverage, G signed distance (css px, + inside), B local stroke half-width (css px).
// The glyphs are rasterised S times finer than the mask: a distance field from a binary edge jumps by one
// raster pixel at every stair of that edge, and at mask resolution those jumps shade as bands and ladders.
function sdfBuffer(c, S, dpr, reach) {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const w = c.width, h = c.height, px = ctx.getImageData(0, 0, w, h).data, n = w * h;
  const inside = new Float32Array(n), outside = new Float32Array(n), sdf = new Float32Array(n);
  for (let i = 0; i < n; i++) { const on = px[i * 4] >= 128; inside[i] = on ? 0 : 1e20; outside[i] = on ? 1e20 : 0; }
  edt2d(inside, w, h); edt2d(outside, w, h);
  for (let i = 0; i < n; i++) {
    const on = px[i * 4] >= 128;
    sdf[i] = (on ? Math.sqrt(outside[i]) : -Math.sqrt(inside[i])) + (px[i * 4] / 255 - 0.5);   // sub-pixel from the anti-aliased edge
  }
  meanFilter2d(sdf, w, h, 1);
  // box-downsample S x S to the mask resolution
  const wl = w / S, hl = h / S, nl = wl * hl, out = new Float32Array(nl * 4), half = new Float32Array(nl);
  const inv = 1 / (S * S), toCss = 1 / (dpr * S);
  for (let y = 0; y < hl; y++) for (let x = 0; x < wl; x++) {
    let sc = 0, sd = 0;
    for (let yy = 0; yy < S; yy++) { let o = ((y * S + yy) * w + x * S); for (let xx = 0; xx < S; xx++, o++) { sc += px[o * 4]; sd += sdf[o]; } }
    const i = y * wl + x;
    out[i * 4] = sc * inv / 255; out[i * 4 + 1] = sd * inv * toCss; out[i * 4 + 3] = 1; half[i] = sd * inv / S;   // half in mask px
  }
  const rr = Math.max(1, Math.round(reach * dpr));
  maxFilter2d(half, wl, hl, rr); meanFilter2d(half, wl, hl, Math.max(2, Math.round(rr * 0.5)));
  for (let i = 0; i < nl; i++) out[i * 4 + 2] = half[i] / dpr;
  return { data: out, w: wl, h: hl };
}

function fontOf(cs) { return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; }

function newCanvas(w, h, dpr, clear, ss = 1) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * dpr)) * ss; c.height = Math.max(1, Math.ceil(h * dpr)) * ss;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!clear) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.scale(dpr * ss, dpr * ss);
  return { c, ctx };
}

function rasterText(el, rect, pad, dpr, ss = 1) {
  const W = rect.width + 2 * pad, H = rect.height + 2 * pad;
  const { c, ctx } = newCanvas(W, H, dpr, false, ss);
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  const asc = new Map();
  let node;
  while ((node = walker.nextNode())) {
    const cs = getComputedStyle(node.parentElement);
    const font = fontOf(cs); ctx.font = font;
    if (!asc.has(font)) {
      const m = ctx.measureText('H');
      asc.set(font, m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8);
    }
    const a = asc.get(font), txt = node.nodeValue;
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (/\s/.test(ch)) continue;
      range.setStart(node, i); range.setEnd(node, i + 1);
      const rr = range.getClientRects();
      if (!rr.length || rr[0].width === 0) continue;
      ctx.fillText(ch, rr[0].left - rect.left + pad, rr[0].top - rect.top + pad + a);
    }
  }
  return c;
}

// ink density from an image: dark on light -> 1, background -> 0, transparent -> 0
function inkFromImage(img, w, h, dpr, lightInk, pos, fit) {
  const { c, ctx } = newCanvas(w, h, dpr, true);
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sc = fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih), dw = iw * sc, dh = ih * sc;
  const ay = pos === 'top' ? 0 : pos === 'bottom' ? 1 : 0.5;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) * ay, dw, dh);
  const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data, n = d.length / 4;
  const lum = new Float32Array(n); const sample = [];
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    const l = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    // dark ink: composite over white, so a line drawing on a transparent ground reads as ink on paper
    lum[i] = lightInk ? l : l * a + (1 - a);
    if ((lightInk ? a > 0.9 : true) && (i % 23 === 0)) sample.push(lum[i]);
  }
  sample.sort((x, y) => x - y);
  const bg = sample.length ? sample[Math.floor(sample.length * (lightInk ? 0.07 : 0.93))] : (lightInk ? 0 : 1);
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    const v = lightInk ? Math.max(0, Math.min(1, (lum[i] - bg) / Math.max((1 - bg) * 0.7, 0.05))) * a
                       : Math.max(0, Math.min(1, (bg - lum[i]) / Math.max(bg * 0.82, 0.05)));
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(v * 255); d[i * 4 + 3] = 255;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(id, 0, 0);
  return c;
}

function svgToImage(svg, w, h) {
  const clone = svg.cloneNode(true);
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  clone.removeAttribute('class'); clone.removeAttribute('style');
  let s = new XMLSerializer().serializeToString(clone);
  s = s.replace(/var\(--mark-ink\)/g, '#000').replace(/var\(--mark-paper\)/g, '#fff')
       .replace(/stroke="#[0-9a-fA-F]{6}"/g, m => (m.includes('ffffff') ? m : 'stroke="#000"'))
       .replace(/opacity="[^"]*"/g, '');
  const url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => { URL.revokeObjectURL(url); res(im); }; im.onerror = rej; im.src = url; });
}

async function loadImg(img) { if (img.decode) { try { await img.decode(); } catch (e) {} } return img; }

export class Scene {
  constructor(gl, dpr) { this.gl = gl; this.dpr = dpr; this.items = []; this.building = false; this.white = this.solid(255); this.black = this.solid(0); }

  solid(v) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([v, v, v, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  upload(source, old) {
    const gl = this.gl, t = old || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (source.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, source.w, source.h, 0, gl.RGBA, gl.FLOAT, source.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  dispose() { for (const it of this.items) { if (it.tex && it.own) this.gl.deleteTexture(it.tex); } this.items = []; }

  async build() {
    if (this.building) return; this.building = true; const t0 = performance.now();
    const dpr = this.dpr;
    const items = [];
    for (const el of document.querySelectorAll('[data-phys]')) {
      const type = el.dataset.phys; if (!(type in TYPES)) continue;
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
      const docTop = r.top + scroll.y; // read now: awaits below let the page move under us
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize) || 16;
      const it = { type: TYPES[type], el, pad: 0, p: [0, 0, 0, 0], s: [0, 0, 0, 0], color: [0, 0, 0], wear: parseFloat(el.dataset.wear || '0.35'), tex: null, img: null, maskRect: null, own: true };
      if (type === 'emboss' || type === 'press' || type === 'blind' || type === 'foil') {
        it.pad = type === 'emboss' ? 14 : 10;
        const S = type === 'emboss' ? (fs > 160 ? 1 : 3) : 1;   // giant type: stairs are tiny relative to the glyph
        const c = rasterText(el, r, it.pad, dpr, S);
        it.tex = this.upload(type === 'emboss' ? sdfBuffer(c, S, dpr, Math.max(clamp(fs * 0.016, 1.2, 4.5) * 1.8, fs * 0.12)) : c);
        it.color = hex(cs.getPropertyValue('--phys-color').trim() || (type === 'emboss' ? '#b08c58' : type === 'foil' ? '#d9b46a' : '#3b2f26'));
        const depth = parseFloat(el.dataset.depth || '1');
        if (type === 'emboss') {
          const profile = { facet: 0, step: 1, dome: 2, inline: 3, enamel: 4 }[el.dataset.profile || 'dome'] ?? 2;
          it.p = [clamp(fs * 0.02, 1.6, 5.0), clamp(fs * 0.016, 1.2, 4.5), profile, 0];
        }
        if (type === 'press') it.p = [(0.7 + fs * 0.008) * depth, clamp(fs * 0.007, 0.6, 1.4), 0.05, 0];
        if (type === 'blind') it.p = [(0.6 + fs * 0.006) * depth, clamp(fs * 0.012, 0.8, 2.2), 0, 0];
        if (type === 'foil') it.p = [(0.35 + fs * 0.003) * depth, clamp(fs * 0.006, 0.5, 1.2), parseFloat(el.dataset.crinkle || '0.55'), 0];
      } else if (type === 'print') {
        let src = el.tagName === 'IMG' ? el : el.querySelector('img'); const svg = el.tagName === 'svg' ? el : el.querySelector('svg');
        const pdpr = Math.min(dpr, 1800 / Math.max(r.width, r.height));   // cap print textures at 1800 px
        const ink = im => inkFromImage(im, r.width, r.height, pdpr, el.dataset.ink === 'light', el.dataset.pos, el.dataset.fit);
        if (src && !(src.complete && src.naturalWidth)) it.wait = { src, ink };   // not here yet (loads as the reader nears): printed when it comes
        else if (src) it.tex = this.upload(ink(await loadImg(src)));
        else if (svg) it.tex = this.upload(ink(await svgToImage(svg, Math.round(r.width), Math.round(r.height))));
        else continue;
        it.color = hex(cs.getPropertyValue('--print-ink').trim() || '#767069');   // its own property: --phys-color would inherit from a card
        it.p = [0.1, 0, 0, 0];
        if (src && el.id) { it.key = el.id; it.srcImg = src; }
      } else if (type === 'plate') {
        it.pad = 10; it.p = [0.55, 0, 0, 0];
      } else if (type === 'bezel') {
        it.pad = 4;
        const ring = parseFloat(cs.paddingLeft) || 14, rad = parseFloat(cs.borderTopLeftRadius) || 8;
        it.s = [ring, rad, parseFloat(el.dataset.arch || '5'), 0.6];
        it.color = hex(cs.getPropertyValue('--phys-color').trim() || '#b08c58');
        const img = el.querySelector('img'); if (img) { await loadImg(img); it.img = this.upload(img); }
      } else if (type === 'glass') {
        continue; // drawn by its bezel
      } else if (type === 'pane') {
        it.pad = 6; it.hover = true; it.mix = 0; it.target = 0; it.rest = parseFloat(el.dataset.rest || '0');
        it.s = [parseFloat(el.dataset.thick || '2.6'), parseFloat(el.dataset.fillet || '3'), parseFloat(cs.borderTopLeftRadius) || 3, 0];
        const img = el.querySelector('img'); if (!img) continue; await loadImg(img); it.img = this.upload(img);
      } else if (type === 'under') {
        it.pad = 0; it.hover = true; it.mix = 0; it.target = 0;
        const img = el.querySelector('img'); if (!img) continue; await loadImg(img); it.img = this.upload(img);
      } else if (type === 'loupe') {
        it.pad = 10; it.hover = true; it.mix = 0; it.target = 0; it.follow = true; it.forKey = el.dataset.for;
        it.s = [parseFloat(el.dataset.ring || '14'), parseFloat(el.dataset.ringh || '4.5'), parseFloat(el.dataset.lens || '3'), parseFloat(el.dataset.mag || '1.12')];
        it.color = hex(cs.getPropertyValue('--phys-color').trim() || '#b08c58');
      } else if (type === 'card') {
        it.pad = 6; it.s = [parseFloat(el.dataset.thick || '1.4'), parseFloat(cs.borderTopLeftRadius) || 1, 1.2, 0];
        it.color = hex(cs.getPropertyValue('--card-color').trim() || '#f3efe8');
      } else if (type === 'window') {
        it.pad = 6;
        const bevel = parseFloat(cs.paddingLeft) || 6, rad = parseFloat(cs.borderTopLeftRadius) || 4;
        it.s = [bevel, rad, parseFloat(el.dataset.depth || '4'), parseFloat(el.dataset.crystal || '0')];
        it.p = [parseFloat(el.dataset.fillet || '0.9'), 0, 0, 0];
        it.color = hex(cs.getPropertyValue('--phys-color').trim() || '#b08c58');
        const img = el.querySelector('img'); if (img) { await loadImg(img); it.img = this.upload(img); }
      } else if (type === 'medal') {
        it.pad = 8;
        // every svg inside becomes ink pressed into the disc, at its own place
        const { c, ctx } = newCanvas(r.width + 2 * it.pad, r.height + 2 * it.pad, dpr);
        for (const svg of el.querySelectorAll('svg')) {
          const q = svg.getBoundingClientRect(); if (q.width < 1) continue;
          const im = await svgToImage(svg, Math.round(q.width), Math.round(q.height));
          const ink = inkFromImage(im, q.width, q.height, dpr);
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.drawImage(ink, q.left - r.left + it.pad, q.top - r.top + it.pad, q.width, q.height); ctx.restore();
        }
        it.tex = this.upload(c);
        it.s = [parseFloat(el.dataset.thick || '2.2'), parseFloat(el.dataset.dome || '1.4'), parseFloat(el.dataset.rim || '0.9'), 0];
        it.p = [parseFloat(el.dataset.depth || '0.7'), 0.8, 0, 0];
        it.color = hex(cs.getPropertyValue('--phys-color').trim() || '#b08c58');
      } else if (type === 'slab') {
        it.pad = 6; it.s = [parseFloat(el.dataset.thick || '2.2'), parseFloat(cs.borderTopLeftRadius) || 3, 2.6, 0];
        it.color = hex(cs.getPropertyValue('--phys-color').trim() || '#b08c58');
      }
      it.x = r.left - it.pad; it.y = docTop - it.pad; it.w = r.width + 2 * it.pad; it.h = r.height + 2 * it.pad;
      if (el.dataset.shadow) it.shadow = parseFloat(el.dataset.shadow);
      items.push(it);
    }
    for (const lp of items) {
      if (lp.type !== TYPES.loupe) continue;
      const pr = items.find(o => o.key === lp.forKey);
      if (!pr) continue;
      lp.lens = [pr.x + pr.pad, pr.y + pr.pad, pr.w - 2 * pr.pad, pr.h - 2 * pr.pad];
      lp.img = this.upload(pr.srcImg);
    }
    this.dispose(); this.items = items; this.building = false;
    for (const it of items) if (it.wait) this.arrive(it);
    console.log('scene: ' + items.length + ' items in ' + Math.round(performance.now() - t0) + ' ms, ' + items.filter(i => i.wait).length + ' to come');
    return items;
  }

  // a drawing that was not loaded at build time is printed once it arrives, if the scene it was built for still
  // stands (a rebuild makes its own); onchange tells the frame loop to draw the sheet again
  arrive(it) {
    const { src, ink } = it.wait;
    const go = async () => {
      if (!this.items.includes(it)) return;
      await loadImg(src); if (!this.items.includes(it) || !src.naturalWidth) return;
      it.tex = this.upload(ink(src)); it.wait = null;
      if (this.onchange) this.onchange();
    };
    if (src.complete && src.naturalWidth) go(); else src.addEventListener('load', go, { once: true });
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function hex(s) { if (!s || s[0] !== '#') return [0.71, 0.55, 0.35]; if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]; return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255); }
