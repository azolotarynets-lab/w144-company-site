// The sheet. A height tile (fibre, grain, mottling, slow undulation) is baked once;
// every frame only relights it from the lamp in light.js. Texture scrolls with the page,
// the lamp stays with the viewport, like a desk lamp over moving paper.
import { lamp } from './light.js';

const TILE = 2048;

const VS = `#version 300 es
precision highp float;
void main(){
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const BAKE = `#version 300 es
precision highp float;
out vec4 o;
uniform float uTile;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float pnoise(vec2 p, vec2 period){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  vec2 i00 = mod(i, period), i11 = mod(i + 1.0, period);
  float a = hash(vec2(i00.x, i00.y)), b = hash(vec2(i11.x, i00.y));
  float c = hash(vec2(i00.x, i11.y)), d = hash(vec2(i11.x, i11.y));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float pfbm(vec2 uv, float cells, int oct, float seed){
  float s = 0.0, a = 0.5, n = 0.0; float c = cells;
  for (int k = 0; k < 6; k++){ if (k >= oct) break; s += a * pnoise(uv*c + seed, vec2(c)); n += a; a *= 0.55; c *= 2.0; }
  return s / n;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uTile;
  float undul  = pfbm(uv, 3.0, 3, 11.0);
  float mottle = pfbm(uv, 32.0, 3, 23.0);
  float grain  = pnoise(uv*512.0 + 5.0, vec2(512.0));
  float grain2 = pnoise(uv*1024.0 + 9.0, vec2(1024.0));
  float fibx   = pnoise(vec2(uv.x*24.0, uv.y*1024.0) + 3.0, vec2(24.0, 1024.0));
  float fiby   = pnoise(vec2(uv.x*1024.0, uv.y*24.0) + 7.0, vec2(1024.0, 24.0));
  float fibers = smoothstep(0.64, 0.92, fibx) * 0.6 + smoothstep(0.68, 0.94, fiby) * 0.4;
  float low = clamp(undul*0.72 + mottle*0.28, 0.0, 1.0);
  float fine = clamp(grain*0.55 + grain2*0.30 + fibers*0.35, 0.0, 1.0);
  float v = low * 65535.0; float hi = floor(v / 256.0); float lo = v - hi * 256.0;
  float tint = pfbm(uv, 6.0, 2, 41.0);
  o = vec4(hi / 255.0, lo / 255.0, fine, tint);
}`;

const LIT = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uTex;
uniform vec2 uRes;      // css px
uniform float uDpr, uTile, uScroll, uBump, uFine, uLightZ, uAmbient, uKey;
uniform vec2 uLight;    // css px, y down, viewport
uniform vec3 uCool, uWarm, uLampCol;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float H(vec2 uv){ vec4 t = texture(uTex, uv); return (t.r * 255.0 * 256.0 + t.g * 255.0) / 65535.0; }
float F(vec2 uv){ return texture(uTex, uv).b; }
void main(){
  vec2 css = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec2 doc = css + vec2(0.0, uScroll);
  vec2 uv = doc / uTile;
  float px = 1.0 / uTile;
  float h = H(uv), hx = H(uv + vec2(3.0 * px, 0.0)), hy = H(uv + vec2(0.0, 3.0 * px));
  float f = F(uv), fx = F(uv + vec2(px, 0.0)), fy = F(uv + vec2(0.0, px));
  vec2 g = vec2(h - hx, h - hy) * uBump + vec2(f - fx, f - fy) * uFine;
  vec3 n = normalize(vec3(g, 1.0));
  vec3 Lv = vec3(uLight - css, uLightZ);
  float dist = length(Lv);
  vec3 L = Lv / dist;
  float ndl = dot(n, L);
  float wrap = max((ndl + 0.3) / 1.3, 0.0);
  float atten = 1.0 / (1.0 + pow(dist / (uLightZ * 1.7), 2.0));
  vec4 t = texture(uTex, uv);
  vec3 albedo = mix(uCool, uWarm, t.a);
  albedo *= 1.0 - (t.b - 0.5) * 0.06;
  vec3 Hh = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, Hh), 0.0), 14.0) * 0.07 * atten;
  vec3 col = albedo * (uAmbient * vec3(0.985, 0.99, 1.0) + uLampCol * (uKey * wrap * atten)) + uLampCol * spec;
  vec2 q = (css / uRes - 0.5) * vec2(1.0, uRes.y / uRes.x);
  col *= 1.0 - 0.16 * smoothstep(0.28, 0.75, length(q));
  col += (hash(gl_FragCoord.xy) - 0.5) * (1.6 / 255.0);
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);

export const paper = {
  bump: 11, fine: 0.6, ambient: 0.56, key: 0.58,
  cool: '#d6cec2', warm: '#e5dccf', lamp: '#fff6e8',
};

export function mountPaper() {
  const canvas = document.createElement('canvas');
  canvas.id = 'paper';
  document.body.prepend(canvas);
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false });
  if (!gl) { document.documentElement.classList.add('no-webgl'); return null; }

  // bake the tile
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TILE, TILE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const bake = program(gl, BAKE);
  gl.useProgram(bake);
  gl.uniform1f(gl.getUniformLocation(bake, 'uTile'), TILE);
  gl.viewport(0, 0, TILE, TILE);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const lit = program(gl, LIT);
  const U = n => gl.getUniformLocation(lit, n);
  const u = { res: U('uRes'), dpr: U('uDpr'), tile: U('uTile'), scroll: U('uScroll'), bump: U('uBump'), fine: U('uFine'), lz: U('uLightZ'),
    amb: U('uAmbient'), key: U('uKey'), light: U('uLight'), cool: U('uCool'), warm: U('uWarm'), lampc: U('uLampCol'), tex: U('uTex') };

  let dpr = 1, W = 0, H = 0;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  resize();
  addEventListener('resize', resize);

  function render() {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(lit);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u.tex, 0);
    gl.uniform2f(u.res, W, H);
    gl.uniform1f(u.dpr, dpr);
    gl.uniform1f(u.tile, TILE);
    gl.uniform1f(u.scroll, scrollY);
    gl.uniform1f(u.bump, paper.bump);
    gl.uniform1f(u.fine, paper.fine);
    gl.uniform1f(u.lz, lamp.z);
    gl.uniform1f(u.amb, paper.ambient);
    gl.uniform1f(u.key, paper.key);
    gl.uniform2f(u.light, lamp.x, lamp.y);
    gl.uniform3fv(u.cool, hex(paper.cool));
    gl.uniform3fv(u.warm, hex(paper.warm));
    gl.uniform3fv(u.lampc, hex(paper.lamp));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
  window.PAPER = paper;
  return paper;
}
