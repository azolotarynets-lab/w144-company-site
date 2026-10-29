// The sheet renderer. Three passes a frame:
//   1. height  : paper undulation + every physical item, added into one height field (R16F)
//   2. material: albedo / params / anisotropy for paper and items (3 x RGBA8, MRT)
//   3. light   : normals from the height field + fine grain, one lamp, cast shadows marched
//                through the height field, cavity shading, bronze as metal, paper as paper.
const TILE = 2048;

const GLSL_COMMON = `
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float sdRR(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
`;

const VS_FULL = `#version 300 es
precision highp float;
void main(){ vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }`;

const VS_QUAD = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform vec4 uQuad;
out vec2 vUv; out vec2 vPx; out vec2 vCss;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vUv = c; vPx = c * uQuad.zw; vCss = uQuad.xy + vPx;
  vec2 clip = (vCss / uRes) * 2.0 - 1.0; clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FS_BAKE = `#version 300 es
precision highp float;
out vec4 o; uniform float uTile;
${GLSL_COMMON}
float pnoise(vec2 p, vec2 period){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  vec2 i00 = mod(i, period), i11 = mod(i + 1.0, period);
  float a = hash(vec2(i00.x, i00.y)), b = hash(vec2(i11.x, i00.y)), c = hash(vec2(i00.x, i11.y)), d = hash(vec2(i11.x, i11.y));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float pfbm(vec2 uv, float cells, int oct, float seed){
  float s = 0.0, a = 0.5, n = 0.0; float c = cells;
  for (int k = 0; k < 6; k++){ if (k >= oct) break; s += a * pnoise(uv*c + seed, vec2(c)); n += a; a *= 0.55; c *= 2.0; }
  return s / n;
}
void main(){
  vec2 uv = gl_FragCoord.xy / uTile;
  float undul  = pfbm(uv, 3.0, 2, 11.0);           // ~680 px: the sheet is not perfectly flat, but nearly
  float cloud  = pfbm(uv, 20.0, 3, 23.0);          // faint cloudiness of a laid sheet
  float tooth  = pnoise(uv*2048.0 + 5.0, vec2(2048.0)) * 0.6 + pnoise(uv*1024.0 + 9.0, vec2(1024.0)) * 0.4;  // 1-2 px tooth
  float laidx  = pnoise(vec2(uv.x*1600.0, uv.y*18.0) + 3.0, vec2(1600.0, 18.0));   // faint laid lines, the mark of a fine sheet
  float laid   = smoothstep(0.86, 0.98, laidx);
  float surf = clamp(cloud, 0.0, 1.0);
  float fine = clamp(0.5 + (tooth - 0.5)*0.55 + laid*0.18, 0.0, 1.0);
  float tint = clamp(0.5 + (pfbm(uv, 6.0, 2, 41.0) - 0.5) * 0.5, 0.0, 1.0);
  o = vec4(undul, surf, fine, tint);
}`;

const FS_DOWN = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uTexel, uDst;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uDst; vec2 t = uTexel;
  vec2 s = texture(uSrc, uv).rg * 4.0
    + texture(uSrc, uv + vec2(-t.x, -t.y)).rg + texture(uSrc, uv + vec2(t.x, -t.y)).rg
    + texture(uSrc, uv + vec2(-t.x, t.y)).rg + texture(uSrc, uv + vec2(t.x, t.y)).rg;
  o = vec4(s / 8.0, 0.0, 1.0);
}`;

const FS_BASE_H = `#version 300 es
precision highp float;
uniform sampler2D uTile; uniform vec2 uRes; uniform float uDpr, uTileSize, uScroll, uAmp;
out vec4 o;
void main(){
  vec2 css = vec2(gl_FragCoord.x, uRes.y*uDpr - gl_FragCoord.y) / uDpr;
  vec4 t = texture(uTile, (css + vec2(0.0, uScroll)) / uTileSize);
  o = vec4((t.r * 0.35 + t.g * 0.65) * uAmp, 1.0, 0.0, 1.0);
}`;

const FS_BASE_M = `#version 300 es
precision highp float;
uniform sampler2D uTile; uniform vec2 uRes; uniform float uDpr, uTileSize, uScroll; uniform vec3 uCool, uWarm;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
void main(){
  vec2 css = vec2(gl_FragCoord.x, uRes.y*uDpr - gl_FragCoord.y) / uDpr;
  vec4 t = texture(uTile, (css + vec2(0.0, uScroll)) / uTileSize);
  o0 = vec4(mix(uCool, uWarm, t.a), 1.0);
  o1 = vec4(0.0, 0.05, 1.0, 1.0);
  o2 = vec4(0.5, 0.5, 0.0, 1.0);
}`;

const ITEM_COMMON = `
in vec2 vUv; in vec2 vPx; in vec2 vCss; uniform vec4 uQuad;
uniform sampler2D uMask; uniform vec2 uSize; uniform vec4 uMaskRect; uniform int uType; uniform vec4 uP, uS; uniform float uPad, uMix, uMag, uShadow; uniform vec4 uLens;
${GLSL_COMMON}
vec2 muv(){ return (vPx - uMaskRect.xy) / uMaskRect.zw; }
float vn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
// a cast surface is never dead flat: slow waves, a few hundredths of a pixel per pixel
float castWave(vec2 doc){ return (vn2(doc * 0.045) * 0.6 + vn2(doc * 0.11 + 7.0) * 0.4 - 0.5) * 0.32; }
float m(vec2 uv){ if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0; return texture(uMask, uv).r; }
float sd(vec2 uv){ if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -16.0; return texture(uMask, uv).g; }
// local half-width of the stroke (baked on the CPU as a dense max filter of the distance field)
float localHalf(vec2 uv){ if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0; return texture(uMask, uv).b; }
// chamfer width capped by the stroke: thin serifs keep a flat top instead of becoming a roof
float chamfer(vec2 uv, float w){ return clamp(0.55 * localHalf(uv), 0.7, w); }
uniform float uMaskDpr;
float mlod(vec2 uv, float lod){ if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0; return textureLod(uMask, uv, lod).r; }
// wide blurs come from the mask's mip chain, so a 20 px bevel costs 9 taps and shows no ghosts
float blur(vec2 uv, float r){
  float lod = log2(max(r * uMaskDpr * 0.9, 1.0));
  vec2 t = (r * 0.55) / uMaskRect.zw;
  float s = mlod(uv, lod) * 0.25;
  for (int i = 0; i < 8; i++){ float a = float(i) * 0.7853982; vec2 d = vec2(cos(a), sin(a)); s += mlod(uv + d*t, lod) * 0.09375; }
  return s;
}`;

const FS_ITEM_H = `#version 300 es
precision highp float;
${ITEM_COMMON}
uniform sampler2D uTile; uniform float uScroll, uTileSize, uAmp;
out vec4 o;
void main(){
  float h = 0.0; vec2 uv = muv();
  vec2 c = vPx - uSize*0.5; vec2 hf = uSize*0.5 - uPad;
  float surf = texture(uTile, (vCss + vec2(0.0, uScroll)) / uTileSize).g * 0.65 * uAmp;
  if (uType == 0) {
    // raised type from a signed distance: facets are cut, not blurred
    float d = sd(uv); float w = chamfer(uv, uP.y); float prof = uP.z; float t;
    if (prof < 0.5)      t = clamp(d / w, 0.0, 1.0);                                        // facet: linear chamfer, flat polished top
    else if (prof < 1.5) t = smoothstep(-0.6, 0.6, d);                                       // step: cut from sheet, near-vertical wall
    else if (prof < 2.5) { float hw = max(localHalf(uv), 0.8); float u = clamp(d / hw, 0.0, 1.0); t = sin(u * 1.5707963); } // dome: a round crest along every stroke, finite slope at the foot
    else if (prof < 3.5) { float x = d - (w + 1.4); t = clamp(d / w, 0.0, 1.0) + 0.3 * sqrt(max(1.0 - x * x, 0.0)); } // inline: a bead along the edge
    else                 t = clamp(d / w, 0.0, 1.0) - 0.12 * smoothstep(w, w + 0.9, d);            // enamel: the top sunk below the rim
    float foot = smoothstep(-0.7, 0.3, d);
    h = foot * (uP.x * t - surf + castWave(vCss + vec2(0.0, uScroll)) * step(w, d) * (prof < 2.5 ? 0.0 : 0.6));   // the crest carries its own light; a lattice wave on it reads as a ladder
  }
  else if (uType == 1) { float b = blur(uv, uP.y); float wide = blur(uv, uP.y*4.0); h = -uP.x * smoothstep(0.25, 0.75, b) + uP.z * max(wide - b, 0.0) * 2.5; }
  else if (uType == 2) { float b = blur(uv, uP.y); float floorB = blur(uv, uP.y * 2.5); h = -uP.x * (0.7 * smoothstep(0.2, 0.8, b) + 0.3 * smoothstep(0.1, 1.0, floorB)); }   // blind deboss: pressed into the sheet, soft floor
  else if (uType == 3) { h = -uP.x * m(uv); }
  else if (uType == 4) { float d = sdRR(c, hf, 1.0); h = -uP.x * smoothstep(1.6, -1.6, d) + uP.x * 0.35 * exp(-(d - 1.8)*(d - 1.8) / 6.0) * step(0.0, d); }
  else if (uType == 5) {
    // half-arch: the rim grows out of the paper and carries the glass on its crest
    float dO = sdRR(c, hf, uS.y); float dI = sdRR(c, hf - uS.x, max(uS.y - uS.x, 0.6));
    float t = clamp(-dO / uS.x, 0.0, 1.0);
    float arch = smoothstep(0.0, 1.0, pow(t, 1.1));
    float ring = (1.0 - smoothstep(-0.7, 0.7, dO)) * smoothstep(-0.7, 0.7, dI);
    float glass = 1.0 - smoothstep(-0.7, 0.7, dI);
    h = uS.z * arch * ring + (uS.z - uS.w) * glass - surf * (ring * arch + glass);
  }
  else if (uType == 7) {
    float R = min(hf.x, hf.y); float l = length(c); float d = l - R;
    float body = 1.0 - smoothstep(-0.8, 0.8, d);
    float dome = uS.y * (1.0 - 0.55 * (l/R)*(l/R));
    float rim = uS.z * exp(-pow((l - (R - 3.2)) / 1.7, 2.0));
    float b = blur(uv, uP.y);
    h = (uS.x + dome + rim - uP.x * smoothstep(0.3, 0.7, b) - surf + castWave(vCss + vec2(0.0, uScroll)) * 0.6) * body;
  }
  else if (uType == 8) { float d = sdRR(c, hf, uS.y); float top = smoothstep(0.0, uS.z, -d); h = top * (uS.x - surf + castWave(vCss + vec2(0.0, uScroll)) * 0.6); }
  else if (uType == 10) {
    // a slab of dark glass lying on the sheet: flat top, a quarter-round fillet at the edge
    float d = sdRR(c, hf, uS.z); float cov = 1.0 - smoothstep(-0.6, 0.6, d);
    float t = clamp(-d / uS.y, 0.0, 1.0); float prof = 0.5 - 0.5 * cos(3.14159265 * t);   // cushion edge: no vertical wall, no dark line
    h = cov * (uS.x * prof - surf + castWave(vCss + vec2(0.0, uScroll)) * 0.25);
  }
  else if (uType == 11) { h = 0.0; }
  else if (uType == 14) {
    // hot foil: a flat leaf pressed a little into the sheet, with the faint crinkle of real foil
    float b = blur(uv, uP.y); float m = smoothstep(0.3, 0.7, b); vec2 doc = vCss + vec2(0.0, uScroll);
    float crinkle = (vn2(doc * 1.7) * 0.5 + vn2(doc * 4.1 + 3.0) * 0.5 - 0.5) * uP.z;
    h = m * (-uP.x + crinkle);
  }
  else if (uType == 13) { float d = sdRR(c, hf, uS.y); float top = 1.0 - smoothstep(-0.5, 0.5, d); h = top * (uS.x - surf * 0.5); }
  else if (uType == 12) {
    // a jeweller's loupe: a bronze ring (torus) around a shallow glass dome, lying on the sheet
    float R = min(hf.x, hf.y); float l = length(c); float Ri = R - uS.x;
    float body = 1.0 - smoothstep(-0.8, 0.8, l - R);
    float tr = clamp((l - (R - uS.x * 0.5)) / (uS.x * 0.5), -1.0, 1.0);
    float torus = uS.y * sqrt(max(1.0 - tr * tr, 0.0)) * step(Ri, l);
    float q = clamp(l / max(Ri, 1.0), 0.0, 1.0); float dome = (uS.y * 0.55 + uS.z * (1.0 - q * q)) * (1.0 - step(Ri, l));
    h = uMix * body * (torus + dome - surf);
  }
  else if (uType == 9) {
    // a window cut through the sheet: bevelled edge down to the glass, a bronze fillet at its foot,
    // the glass itself very slightly domed (a crystal) so the lamp finds it
    float dO = sdRR(c, hf, uS.y); float dI = sdRR(c, hf - uS.x, max(uS.y - uS.x, 0.5));
    float bevel = (1.0 - smoothstep(-0.6, 0.6, dO)) * smoothstep(-0.6, 0.6, dI);
    float glass = 1.0 - smoothstep(-0.6, 0.6, dI);
    float ramp = clamp(-dO / uS.x, 0.0, 1.0);
    vec2 q = c / (hf - uS.x); float dome = uS.w * (1.0 - clamp(dot(q, q), 0.0, 1.0));
    float x = dI - 0.9; float fillet = uP.x * sqrt(max(1.0 - x * x / 1.1, 0.0));
    h = -uS.z * ramp * bevel - (uS.z - dome) * glass + fillet - surf * glass;
  }
  float foot = step(0.002, abs(h));
  o = vec4(h, (uShadow - 1.0) * foot, 0.0, 1.0);
}`;

const FS_ITEM_M = `#version 300 es
precision highp float;
${ITEM_COMMON}
uniform sampler2D uImg, uTile; uniform float uScroll, uTileSize, uWear; uniform vec3 uColor, uCool, uWarm;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
void emit(vec3 alb, float metal, float gloss, float grain, vec2 aniso, float emis, float cov){ o0 = vec4(alb, cov); o1 = vec4(metal, gloss, grain, cov); o2 = vec4(clamp(aniso, -1.0, 1.0)*0.5 + 0.5, emis, cov); }
float vn1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(hash(vec2(i, 7.0)), hash(vec2(i + 1.0, 7.0)), f); }
// grooves run perpendicular to 'across'; s is the coordinate across the grooves (local, in px)
vec2 brush(vec2 across, float s, float amt){ float streak = vn1(s * 2.3) * 0.5 + vn1(s * 8.7 + 11.0) * 0.5; return across * (streak - 0.5) * amt; }
void main(){
  vec2 uv = muv(); vec2 c = vPx - uSize*0.5; vec2 hf = uSize*0.5 - uPad;
  vec4 tile = texture(uTile, (vCss + vec2(0.0, uScroll)) / uTileSize); float fine = tile.b; vec3 paper = mix(uCool, uWarm, tile.a);
  if (uType == 0) {
    float d = sd(uv); float w = chamfer(uv, uP.y); float top = step(w, d); float cov = smoothstep(-0.7, 0.3, d);
    if (uP.z > 3.5 && d > w + 0.5) emit(vec3(0.07, 0.09, 0.14), 0.0, 1.0, 0.0, vec2(0.0), 0.0, cov);   // champleve: navy enamel in the cell
    else emit(uColor, 1.0, 1.0, 0.0, vec2(0.0), 0.0, cov);
  }
  else if (uType == 1) { float mk = m(uv); float cov = mk * mix(1.0, smoothstep(0.22, 0.62, fine + 0.18), uWear); emit(uColor, 0.0, 0.2, 0.45, vec2(0.0), 0.0, cov); }
  else if (uType == 2) { emit(paper, 0.0, 0.05, 1.0, vec2(0.0), 0.0, 0.0); }
  else if (uType == 3) { float mk = m(uv); float cov = mk * mix(1.0, smoothstep(0.26, 0.68, fine + 0.2*mk), uWear); emit(uColor, 0.0, 0.12, 0.85, vec2(0.0), 0.0, cov * 0.94); }
  else if (uType == 4) { float d = sdRR(c, hf, 1.0); emit(paper * 0.992, 0.0, 0.05, 0.6, vec2(0.0), 0.0, 1.0 - smoothstep(-1.0, 1.0, d)); }
  else if (uType == 5) {
    float dO = sdRR(c, hf, uS.y); float dI = sdRR(c, hf - uS.x, max(uS.y - uS.x, 0.6));
    if (dI < 0.0) {
      vec2 inner = uSize - 2.0 * (uPad + uS.x); vec2 guv = (vPx - uPad - uS.x) / inner;
      emit(texture(uImg, clamp(guv, 0.0, 1.0)).rgb, 0.0, 0.75, 0.0, vec2(0.0), 0.88, 1.0 - smoothstep(-0.7, 0.7, dI));
    } else {
      vec2 g = vec2(sdRR(c + vec2(0.5, 0.0), hf, uS.y) - sdRR(c - vec2(0.5, 0.0), hf, uS.y), sdRR(c + vec2(0.0, 0.5), hf, uS.y) - sdRR(c - vec2(0.0, 0.5), hf, uS.y));
      vec2 across = normalize(g + 1e-5);
      emit(uColor, 1.0, 1.0, 0.0, brush(across, dO, 0.7), 0.0, 1.0 - smoothstep(-0.7, 0.7, dO));
    }
  }
  else if (uType == 7) {
    float R = min(hf.x, hf.y); float l = length(c); float d = l - R;
    float body = 1.0 - smoothstep(-0.8, 0.8, d);
    float mk = smoothstep(0.3, 0.7, blur(uv, uP.y));
    vec2 radial = normalize(c + 1e-5);
    emit(mix(uColor, uColor * 0.5, mk), 1.0, mix(1.0, 0.35, mk), 0.0, brush(radial, l, 0.18 * (1.0 - mk)), 0.0, body);
  }
  else if (uType == 8) { float d = sdRR(c, hf, uS.y); emit(uColor, 1.0, 1.0, 0.0, brush(vec2(1.0, 0.0), vPx.x, 0.6), 0.0, 1.0 - smoothstep(-0.7, 0.7, d)); }
  else if (uType == 10) {
    // a slab of smoked glass on the sheet. At rest its surface is frosted: the screen's bright parts glow
    // warm through it as if lit from beneath; under the pointer the glass clears and the colour screen surfaces.
    float d = sdRR(c, hf, uS.z); float cov = 1.0 - smoothstep(-0.6, 0.6, d);
    vec2 guv = (vPx - uPad) / (uSize - 2.0 * uPad);
    float lod = 2.2 * (1.0 - uMix);
    vec3 img = textureLod(uImg, clamp(guv, 0.0, 1.0), lod).rgb;
    float lum = dot(img, vec3(0.3, 0.59, 0.11));
    // at rest the glass is frosted: milky over the sheet, the screen's bright parts glowing warm through it
    // as if lit from beneath; under the pointer it clears into the colour screen
    vec3 frost = paper * (0.88 + 0.12 * lum) * (0.94 + 0.12 * fine) + vec3(1.0, 0.9, 0.7) * lum * 0.5 * (0.85 + 0.3 * fine);
    vec3 face = mix(frost, img, uMix);
    float edge = 1.0 - smoothstep(uS.y * 0.45, uS.y, -d);     // the cushion edge: glass seen through its thickness
    vec3 edgeCol = mix(face * 0.96, face * 0.6 + vec3(0.01, 0.015, 0.03), uMix);
    float gl = mix(0.15, 1.0, uMix), glE = mix(0.12, 0.7, uMix);
    emit(mix(face, edgeCol, edge), 0.0, mix(gl, glE, edge), 0.12 * (1.0 - uMix), vec2(0.0), mix(mix(0.3, 0.86, uMix), mix(0.3, 0.4, uMix), edge), cov);
  }
  else if (uType == 14) { float mk = smoothstep(0.3, 0.7, blur(uv, uP.y)); emit(uColor, 0.6, 0.9, 0.0, vec2(0.0), 0.0, mk); }   // gloss 0.9 marks foil for the light pass
  else if (uType == 13) {
    // a lighter sheet lying on the page: a letter, a dossier
    float d = sdRR(c, hf, uS.y); float cov = 1.0 - smoothstep(-0.5, 0.5, d);
    emit(uColor * (0.97 + 0.06 * fine), 0.0, 0.05, 0.9, vec2(0.0), 0.0, cov);
  }
  else if (uType == 11) {
    // the product lives under the sheet: it glows through the fibre, and comes up to the surface under the pointer
    vec2 guv = vPx / uSize; float lod = 2.4 * (1.0 - uMix);
    vec3 img = textureLod(uImg, clamp(guv, 0.0, 1.0), lod).rgb;
    // at rest: lamp-light from beneath. The bright parts of the screen glow warm through the fibre,
    // the dark body dims the paper a little; under the pointer the colour image surfaces
    float lum = dot(img, vec3(0.3, 0.59, 0.11));
    vec3 rest = paper * (0.9 + 0.1 * lum) * (0.82 + 0.36 * fine) + vec3(1.0, 0.9, 0.7) * lum * 0.5 * (0.7 + 0.6 * fine);
    emit(mix(rest, img, uMix), 0.0, 0.08, 1.0 - 0.9 * uMix, vec2(0.0), 0.25 + 0.67 * uMix, 1.0);
  }
  else if (uType == 12) {
    float R = min(hf.x, hf.y); float l = length(c); float Ri = R - uS.x;
    float body = 1.0 - smoothstep(-0.8, 0.8, l - R);
    if (l < Ri) {
      // the lens develops the engraving beneath into the live screen, a little magnified
      vec2 center = uQuad.xy + uSize * 0.5;
      vec2 src = center + (vCss - center) / uMag;
      vec2 guv = (src - uLens.xy) / uLens.zw;
      float inside = step(0.0, guv.x) * step(guv.x, 1.0) * step(0.0, guv.y) * step(guv.y, 1.0);
      vec3 img = texture(uImg, clamp(guv, 0.0, 1.0)).rgb;
      float rimDark = smoothstep(Ri - 6.0, Ri, l) * 0.5;
      emit(mix(paper, img * (1.0 - rimDark), inside), 0.0, 1.0, 0.0, vec2(0.0), 0.9 * inside, uMix * body);
    } else {
      vec2 radial = normalize(c + 1e-5);
      emit(uColor, 1.0, 1.0, 0.0, brush(radial, l, 0.22), 0.0, uMix * body);
    }
  }
  else if (uType == 9) {
    float dO = sdRR(c, hf, uS.y); float dI = sdRR(c, hf - uS.x, max(uS.y - uS.x, 0.5));
    if (abs(dI - 0.9) < 1.05) emit(uColor, 1.0, 1.0, 0.0, vec2(0.0), 0.0, 1.0);                       // the fillet
    else if (dI < 0.0) { vec2 inner = uSize - 2.0 * (uPad + uS.x); vec2 guv = (vPx - uPad - uS.x) / inner;
      emit(texture(uImg, clamp(guv, 0.0, 1.0)).rgb, 0.0, 0.8, 0.0, vec2(0.0), 0.9, 1.0 - smoothstep(-0.6, 0.6, dI)); }
    else emit(paper * vec3(1.06, 1.05, 1.04), 0.0, 0.08, 0.35, vec2(0.0), 0.0, 1.0 - smoothstep(-0.6, 0.6, dO));   // the cut core of the board
  }
  else { emit(paper, 0.0, 0.0, 1.0, vec2(0.0), 0.0, 0.0); }
}`;

const FS_LIGHT = `#version 300 es
precision highp float;
uniform sampler2D uH, uA, uP, uN, uTile;
uniform vec2 uRes, uLight; uniform vec3 uLampCol;
uniform float uDpr, uTileSize, uScroll, uFine, uLightZ, uPool, uAmbient, uKey, uShadowSlope, uShadowSoft, uShadowLen, uShadowAmt, uPenumbra, uPenumbraBase, uPenumbraH, uContact, uCav, uVignette, uBrush, uSpeck, uSpecCap, uPatina;
out vec4 o;
${GLSL_COMMON}
float vn1(float x){ float i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f); return mix(hash(vec2(i, 7.0)), hash(vec2(i + 1.0, 7.0)), f); }
float H(vec2 uv){ return texture(uH, uv).r; }
void main(){
  vec2 fc = gl_FragCoord.xy; vec2 vp = uRes * uDpr; vec2 uv = fc / vp; vec2 px = 1.0 / vp;
  vec2 css = vec2(fc.x, vp.y - fc.y) / uDpr;
  vec2 doc = css + vec2(0.0, uScroll); vec2 tuv = doc / uTileSize; float ft = 1.0 / uTileSize;
  float h = H(uv);
  float hx = H(uv + vec2(px.x, 0.0)), hy = H(uv + vec2(0.0, px.y));
  float dhdx = (hx - h) * uDpr, dhdy = -(hy - h) * uDpr;
  vec4 Pm = texture(uP, uv); vec4 Nm = texture(uN, uv); vec4 Am = texture(uA, uv);
  float f = texture(uTile, tuv).b, fx = texture(uTile, tuv + vec2(ft, 0.0)).b, fy = texture(uTile, tuv + vec2(0.0, ft)).b;
  vec2 g = vec2(dhdx, dhdy) + vec2(fx - f, fy - f) * uFine * Pm.z;
  g += (Nm.xy * 2.0 - 1.0) * uBrush;
  vec3 n = normalize(vec3(-g, 1.0));
  vec3 Lv = vec3(uLight - css, uLightZ); float dist = length(Lv); vec3 L = Lv / dist;
  // cast shadows: march toward the lamp through the height field; the further from the
  // occluder, the blurrier the sample (mip level), so the penumbra widens like a real lamp's
  vec2 d2 = normalize(uLight - css); float slope = uLightZ / max(length(uLight - css), 1.0) * uShadowSlope;
  float occ = 0.0;
  float slopeBias = 0.7 * min(length(g), 1.5);   // a sloped surface does not shadow itself (shadow acne)
  for (int i = 1; i <= 16; i++) {
    float fi = float(i); float d = uShadowLen * (fi * fi) / 256.0;   // dense near the foot, coarse far out
    vec2 spos = uv + vec2(d2.x, -d2.y) * d * uDpr * px;
    // an area lamp: the penumbra widens with the occluder's height above this point
    float dh = max(textureLod(uH, spos, 3.0).r - h, 0.0);
    float lod = log2(1.0 + (uPenumbraBase + d * uPenumbra + dh * uPenumbraH) * uDpr);
    vec2 hs = textureLod(uH, spos, lod).rg;
    float ray = h + d * (slope + slopeBias) + 0.05;
    float k = (hs.r - ray) / (d * uShadowSoft + 0.6);
    k *= 1.0 - smoothstep(0.45, 1.0, d / uShadowLen);   // the umbra thins out with distance
    occ = max(occ, clamp(k, 0.0, 1.0) * max(hs.g, 0.0));  // hs.g: the occluder's own weight (paper 1)
  }
  float sh = 1.0 - min(uShadowAmt * occ, 0.92);
  // contact occlusion: what stands higher around me takes light away (and ink sits in a groove)
  float around = textureLod(uH, uv, 2.6).r - h;
  float around2 = textureLod(uH, uv, 4.2).r - h;
  float contact = 1.0 - clamp(max(around, 0.0) * uContact + max(around2, 0.0) * uContact * 0.6, 0.0, 0.26);
  // cavity / ridge at the finest scale
  float r2 = 1.6 * uDpr;
  float avg2 = (H(uv + vec2(px.x*r2, 0.0)) + H(uv - vec2(px.x*r2, 0.0)) + H(uv + vec2(0.0, px.y*r2)) + H(uv - vec2(0.0, px.y*r2))) * 0.25;
  float cav = (h - avg2);
  float ao = clamp(1.0 + (cav < 0.0 ? cav * uCav : cav * uCav * 0.2), 0.6, 1.05) * contact;
  float ndl = dot(n, L); float wrap = max((ndl + 0.3) / 1.3, 0.0);
  float atten = 1.0 / (1.0 + pow(dist / uPool, 2.0));
  vec3 V = vec3(0.0, 0.0, 1.0); vec3 Hh = normalize(L + V); float ndh = max(dot(n, Hh), 0.0);
  vec3 alb = Am.rgb * (1.0 - (f - 0.5) * uSpeck * Pm.z); float metal = Pm.x, gloss = Pm.y, emis = Nm.z;
  vec3 amb = uAmbient * vec3(0.985, 0.99, 1.0) * mix(1.0, sh, 0.35);
  vec3 key = uLampCol * (uKey * wrap * atten * sh);
  float specP = pow(ndh, mix(10.0, 70.0, gloss)) * mix(0.03, 0.4, gloss) * atten * sh;
  vec3 colD = alb * (amb + key) + specP * uLampCol;
  // metal: a small studio reflected in the surface. A warm softbox above, a cooler fill to the
  // right, darkness elsewhere; facets that tilt toward the softbox flare, the rest sit deep.
  vec3 R = reflect(-V, n);
  // what the surface sees: a softbox high above (facets tilted up flare, up to 45 deg and beyond),
  // a cooler fill to the right, the dark floor below. Flat faces see the dim ceiling.
  float upFace = smoothstep(-0.12, -0.85, R.y);
  float sideFace = smoothstep(0.2, 0.85, R.x) * 0.3;
  float downFace = smoothstep(0.08, 0.6, R.y);
  float graze = pow(1.0 - n.z, 2.0);
  float foilLift = clamp((1.0 - gloss) * 4.0, 0.0, 0.4);   // hot foil (gloss 0.9): a flat leaf facing the viewer still looks lit
  float envL = 0.28 + foilLift + 0.68 * upFace + sideFace - 0.18 * downFace + 0.14 * graze;
  float bandUp = upFace;
  float pat = clamp(-cav * 2.4 + max(around, 0.0) * 0.6, 0.0, 1.0) * uPatina;   // old bronze: dark in the recesses
  vec3 albM = mix(alb * vec3(1.04, 0.99, 0.92), alb * vec3(0.52, 0.5, 0.42), pat);
  vec3 envCol = mix(albM * vec3(0.4, 0.31, 0.22), mix(albM, vec3(1.0, 0.94, 0.78), 0.72), clamp(envL, 0.0, 1.0));
  // the lamp in the metal: a tight glint, a broad pool that travels with the lamp, and on brushed
  // surfaces a band stretched along the grooves (narrow across them)
  float specM = pow(ndh, 160.0) * 0.3 + pow(ndh, 24.0) * 0.3 + pow(ndh, 9.0) * (0.32 + foilLift * 1.2);
  vec2 pert = Nm.xy * 2.0 - 1.0; float am = length(pert);
  if (am > 0.03) { vec2 B = pert / am; float eB = dot(Hh.xy, B); specM += exp(-eB * eB / 0.004) * pow(ndh, 4.0) * 0.36; }
  vec3 colM = envCol * (0.6 + 0.4 * wrap * atten * sh) + albM * specM * atten * sh * uLampCol;
  colM = min(colM, albM * uSpecCap + 0.06);   // bronze never goes white
  vec3 col = mix(colD, colM, metal);
  col = mix(col, alb * (0.84 + 0.16 * sh), emis) + (specP * 0.5 + bandUp * 0.06 * gloss) * uLampCol * emis;
  col *= mix(ao, 1.0, emis * 0.6);
  vec2 q = (css / uRes - 0.5) * vec2(1.0, uRes.y / uRes.x); col *= 1.0 - uVignette * smoothstep(0.28, 0.75, length(q));
  col += (hash(fc) - 0.5) * (1.6 / 255.0);
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}
const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16) / 255);

export const params = {
  amp: 0.45, fine: 0.085, speck: 0.045, ambient: 0.88, key: 0.13, cool: '#e4dfd7', warm: '#ece8e0', lamp: '#fff8ee',
  lampZ: 0.75, pool: 3.4,
  shadowSlope: 0.1, shadowSoft: 0.28, shadowLen: 80, shadowAmt: 0.52, penumbra: 0.16, penumbraBase: 1.2, penumbraH: 1.1, contact: 0.1, specCap: 1.9, patina: 0.5,
  cav: 0.3, vignette: 0.03, brush: 0.4,
};

export function createSheet() {
  const canvas = document.createElement('canvas'); canvas.id = 'paper';
  const page = document.querySelector('.page');
  page.prepend(canvas);
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!gl) { document.documentElement.classList.add('no-webgl'); return null; }
  const extF = gl.getExtension('EXT_color_buffer_float');
  if (!extF) { console.warn('sheet: EXT_color_buffer_float missing'); document.documentElement.classList.add('no-webgl'); return null; }

  const P = {
    bake: program(gl, VS_FULL, FS_BAKE), baseH: program(gl, VS_FULL, FS_BASE_H), baseM: program(gl, VS_FULL, FS_BASE_M),
    itemH: program(gl, VS_QUAD, FS_ITEM_H), itemM: program(gl, VS_QUAD, FS_ITEM_M), light: program(gl, VS_FULL, FS_LIGHT),
    down: program(gl, VS_FULL, FS_DOWN),
  };
  const LEVELS = 6;
  const fbDown = gl.createFramebuffer();

  function tex2d(internal, w, h, format, type, filter) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // bake the paper tile once
  const tile = tex2d(gl.RGBA8, TILE, TILE, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, tile);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  const fbBake = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbBake);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tile, 0);
  gl.useProgram(P.bake.p); gl.uniform1f(P.bake.u.uTile, TILE); gl.viewport(0, 0, TILE, TILE); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  let dpr = 1, W = 0, H = 0, texH, texA, texP, texN, fbH, fbM;
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    for (const t of [texH, texA, texP, texN]) if (t) gl.deleteTexture(t);
    if (fbH) gl.deleteFramebuffer(fbH); if (fbM) gl.deleteFramebuffer(fbM);
    texH = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texH);
    gl.texStorage2D(gl.TEXTURE_2D, LEVELS, gl.RG16F, canvas.width, canvas.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, LEVELS - 1);
    texA = tex2d(gl.RGBA8, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    texP = tex2d(gl.RGBA8, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    texN = tex2d(gl.RGBA8, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    fbH = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbH);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texH, 0);
    fbM = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbM);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, texP, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, texN, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2]);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER); if (st !== gl.FRAMEBUFFER_COMPLETE) console.warn('sheet: material fbo', st);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  resize();
  addEventListener('resize', resize);

  function bindTex(unit, t) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); }

  function drawItems(prog, items, sy, scene, material) {
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u.uRes, W, H);
    if (material) {
      gl.uniform1i(prog.u.uMask, 0); gl.uniform1i(prog.u.uImg, 1); gl.uniform1i(prog.u.uTile, 2); bindTex(2, tile);
      gl.uniform1f(prog.u.uScroll, sy); gl.uniform1f(prog.u.uTileSize, TILE);
      gl.uniform3fv(prog.u.uCool, hex(params.cool)); gl.uniform3fv(prog.u.uWarm, hex(params.warm));
    } else {
      gl.uniform1i(prog.u.uMask, 0); gl.uniform1i(prog.u.uTile, 2); bindTex(2, tile);
      gl.uniform1f(prog.u.uScroll, sy); gl.uniform1f(prog.u.uTileSize, TILE); gl.uniform1f(prog.u.uAmp, params.amp);
    }
    for (const it of items) {
      const y = it.y - sy; if (y + it.h < -40 || y > H + 40) continue;
      gl.uniform4f(prog.u.uQuad, it.x, y, it.w, it.h);
      gl.uniform2f(prog.u.uSize, it.w, it.h);
      gl.uniform4f(prog.u.uMaskRect, 0, 0, it.w, it.h);
      gl.uniform1i(prog.u.uType, it.type);
      gl.uniform4fv(prog.u.uP, it.p); gl.uniform4fv(prog.u.uS, it.s); gl.uniform1f(prog.u.uPad, it.pad); gl.uniform1f(prog.u.uMaskDpr, scene.dpr);
      const mix = it.mix ?? 1, rest = it.rest ?? 0;
      gl.uniform1f(prog.u.uMix, rest + (1 - rest) * mix); gl.uniform1f(prog.u.uMag, it.s[3] || 1); gl.uniform1f(prog.u.uShadow, it.shadow ?? 1);
      if (it.lens) gl.uniform4f(prog.u.uLens, it.lens[0], it.lens[1] - sy, it.lens[2], it.lens[3]); else gl.uniform4f(prog.u.uLens, 0, 0, 1, 1);
      bindTex(0, it.tex || scene.black);
      if (material) { bindTex(1, it.img || scene.black); gl.uniform1f(prog.u.uWear, it.wear); gl.uniform3fv(prog.u.uColor, it.color); }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  function render(scene, sy, lamp) {
    const items = scene ? scene.items : [];
    // 1. height
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbH); gl.viewport(0, 0, canvas.width, canvas.height); gl.disable(gl.BLEND);
    gl.useProgram(P.baseH.p); bindTex(0, tile); gl.uniform1i(P.baseH.u.uTile, 0);
    gl.uniform2f(P.baseH.u.uRes, W, H); gl.uniform1f(P.baseH.u.uDpr, dpr); gl.uniform1f(P.baseH.u.uTileSize, TILE); gl.uniform1f(P.baseH.u.uScroll, sy); gl.uniform1f(P.baseH.u.uAmp, params.amp);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    drawItems(P.itemH, items, sy, scene, false);
    // blur pyramid of the height field: a 4x4 tent per level, so soft shadows stay still while the page scrolls
    // (box mipmaps snap to the pixel grid and the penumbra twitched by whole texels)
    gl.disable(gl.BLEND); gl.useProgram(P.down.p); bindTex(0, texH); gl.uniform1i(P.down.u.uSrc, 0);
    for (let i = 1; i < LEVELS; i++) {
      const sw = Math.max(1, canvas.width >> (i - 1)), shh = Math.max(1, canvas.height >> (i - 1));
      const dw = Math.max(1, canvas.width >> i), dhh = Math.max(1, canvas.height >> i);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbDown); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texH, i);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, i - 1); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, i - 1);
      gl.viewport(0, 0, dw, dhh); gl.uniform2f(P.down.u.uTexel, 1 / sw, 1 / shh); gl.uniform2f(P.down.u.uDst, dw, dhh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, LEVELS - 1);
    // 2. material
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbM); gl.viewport(0, 0, canvas.width, canvas.height); gl.disable(gl.BLEND);
    gl.useProgram(P.baseM.p); bindTex(0, tile); gl.uniform1i(P.baseM.u.uTile, 0);
    gl.uniform2f(P.baseM.u.uRes, W, H); gl.uniform1f(P.baseM.u.uDpr, dpr); gl.uniform1f(P.baseM.u.uTileSize, TILE); gl.uniform1f(P.baseM.u.uScroll, sy);
    gl.uniform3fv(P.baseM.u.uCool, hex(params.cool)); gl.uniform3fv(P.baseM.u.uWarm, hex(params.warm));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawItems(P.itemM, items, sy, scene, true);
    // 3. light
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.disable(gl.BLEND);
    const L = P.light; gl.useProgram(L.p);
    bindTex(0, texH); bindTex(1, texA); bindTex(2, texP); bindTex(3, texN); bindTex(4, tile);
    gl.uniform1i(L.u.uH, 0); gl.uniform1i(L.u.uA, 1); gl.uniform1i(L.u.uP, 2); gl.uniform1i(L.u.uN, 3); gl.uniform1i(L.u.uTile, 4);
    gl.uniform2f(L.u.uRes, W, H); gl.uniform2f(L.u.uLight, lamp.x, lamp.y); gl.uniform3fv(L.u.uLampCol, hex(params.lamp));
    gl.uniform1f(L.u.uDpr, dpr); gl.uniform1f(L.u.uTileSize, TILE); gl.uniform1f(L.u.uScroll, sy); gl.uniform1f(L.u.uFine, params.fine);
    gl.uniform1f(L.u.uLightZ, Math.max(W, 900) * params.lampZ); gl.uniform1f(L.u.uPool, Math.max(W, 900) * params.pool);
    gl.uniform1f(L.u.uAmbient, params.ambient); gl.uniform1f(L.u.uKey, params.key);
    gl.uniform1f(L.u.uShadowSlope, params.shadowSlope); gl.uniform1f(L.u.uShadowSoft, params.shadowSoft); gl.uniform1f(L.u.uShadowLen, params.shadowLen);
    gl.uniform1f(L.u.uShadowAmt, params.shadowAmt); gl.uniform1f(L.u.uPenumbra, params.penumbra); gl.uniform1f(L.u.uPenumbraBase, params.penumbraBase); gl.uniform1f(L.u.uPenumbraH, params.penumbraH); gl.uniform1f(L.u.uContact, params.contact); gl.uniform1f(L.u.uSpecCap, params.specCap); gl.uniform1f(L.u.uPatina, params.patina);
    gl.uniform1f(L.u.uCav, params.cav); gl.uniform1f(L.u.uVignette, params.vignette); gl.uniform1f(L.u.uBrush, params.brush); gl.uniform1f(L.u.uSpeck, params.speck);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  window.SHEET = params;
  return { gl, canvas, render, resize, get dpr() { return dpr; }, params };
}
