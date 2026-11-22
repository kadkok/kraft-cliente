// LAVRA — o oceano do arquipélago (pedido do Kadmus, 19/11/2026: "olha ESSE MAR, ESSA PRAIA, A AREIA AS ONDAS…
// QUERO IMPLEMENTAR ISSO NO MEU kraft.k14.uk"; o mar anterior foi reprovado). Feito pelo Claude a pedido direto dele.
// Referência: dgreenheck/tidewater (MIT, Copyright (c) 2026 DRG Software Solutions LLC) — WaterMaterial, ShoreWaves,
// SurfFoam, traduzidos para WebGL2.
//
// Só liga em mundo com mapa de arquipélago (game.gen.arq) e na superfície (dimensão 0). Ali o mesher deixa de
// desenhar o topo da água no nível do mar e esta superfície contínua toma o lugar dela até o horizonte:
//   - anéis em volta de quem olha (densos perto, largos longe); o longe é "dobrado" para dentro do alcance da câmera
//     sem mudar a direção em que é visto, então o mar vai até a linha do horizonte e some na bruma;
//   - ondas e arrebentação de shared/mar.js (o mesmo modelo que o aparelho usa para a física e o mergulho);
//   - mapa do fundo (fundura e distância à costa), feito uma vez do gerador: cor e transparência pela fundura,
//     ondas que quebram na praia e espraiam na areia;
//   - luz: reflexo do céu com Fresnel de dielétrico, brilho do sol (GGX), absorção da luz pela água (Beer-Lambert),
//     luz atravessando as cristas, espuma da arrebentação e das cristas, vista de baixo (janela de Snell).
//
// Para os outros sistemas: game.mar = { ligado, altura(x, z) → y da superfície agora, prof(x, z), s(x, z), tempo }.
import * as THREE from '../three.js';
import { U, COMMON } from './materials.js';
import { RAIO_GELO, mascaraBanquisa } from '../../shared/fortaleza.js';
import { RAIO_BANQUISA } from '../../shared/fortaleza-banquisa.js';
import { mascaraNaMare } from '../../shared/ferrovia-terreno.js';
import { MAR_GLSL, MAR_NIVEL, alturaMar, estadoDoTempo, multMar } from '../../shared/mar.js';
import { B } from '../../shared/blocks.js';
import { CW } from '../../shared/constants.js';

const CAMERA_FAR = 6800;
// textura do molde da banquisa (uma vez): R8, 1 texel por bloco, centrada no centro da Fortaleza
let banquisaTex = null;
function texturaBanquisa() {
  if (banquisaTex) return banquisaTex;
  const m = mascaraBanquisa();
  banquisaTex = new THREE.DataTexture(m.dados, m.lado, m.lado, THREE.RedFormat);
  banquisaTex.needsUpdate = true;
  return banquisaTex;
}
const MAR_DISTANCIA_REAL = 4800;
const MAR_HORIZONTE = 6400;
const LONGE = 60000;          // raio virtual do último anel

// ---- malha: anéis em volta da origem; position.y guarda o espaçamento local (para o nível de detalhe) ------------
function malhaAneis(seg, cresce) {
  const raios = [0];
  let r = 0;
  while (r < LONGE) { r += Math.max(0.32, r * cresce); raios.push(Math.min(r, LONGE)); }
  const nR = raios.length;
  const pos = new Float32Array((1 + (nR - 1) * seg) * 3);
  pos[0] = 0; pos[1] = 0.32; pos[2] = 0;
  let k = 3;
  for (let i = 1; i < nR; i++) {
    const esp = raios[i] - raios[i - 1];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos[k++] = Math.cos(a) * raios[i]; pos[k++] = Math.max(esp, raios[i] * 6.283 / seg); pos[k++] = Math.sin(a) * raios[i];
    }
  }
  const idx = [];
  for (let j = 0; j < seg; j++) idx.push(0, 1 + ((j + 1) % seg), 1 + j);   // de cima: sentido anti-horário
  for (let i = 1; i < nR - 1; i++) {
    const a0 = 1 + (i - 1) * seg, b0 = 1 + i * seg;
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);   // nunca é recortada pela câmera
  return g;
}

// ---- texturas feitas no aparelho: detalhe das ondas (normal) e renda da espuma ---------------------------------
function texturaDetalhe(n = 256) {
  const h = new Float32Array(n * n);
  let semente = 7;
  const rnd = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
  for (let w = 0; w < 48; w++) {                    // soma de ondas com frequência inteira: repete sem emenda
    const fx = Math.round((rnd() * 2 - 1) * (2 + w * 0.6)), fz = Math.round((rnd() * 2 - 1) * (2 + w * 0.6));
    if (!fx && !fz) continue;
    const a = 1 / Math.pow(Math.hypot(fx, fz), 1.3), ph = rnd() * 6.283;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[i + j * n] += a * Math.sin((fx * i + fz * j) / n * 6.283 + ph);
  }
  const d = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const gx = h[((i + 1) % n) + j * n] - h[((i - 1 + n) % n) + j * n];
    const gz = h[i + ((j + 1) % n) * n] - h[i + ((j - 1 + n) % n) * n];
    const k = (i + j * n) * 4, s = 2.2;
    let nx = -gx * s, nz = -gz * s, ny = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (nz * 0.5 + 0.5) * 255; d[k + 2] = ny * 255; d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function texturaEspuma(n = 256) {
  // células de Worley com borda: bolhas grandes e pequenas, repete sem emenda
  const camada = (cel, semente) => {
    const pts = [];
    let s = semente;
    const rnd = () => { s = (s * 48271) % 2147483647; return s / 2147483647; };
    for (let j = 0; j < cel; j++) for (let i = 0; i < cel; i++) pts.push([(i + rnd()) / cel, (j + rnd()) / cel]);
    const out = new Float32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n, ci = Math.floor(u * cel), cj = Math.floor(v * cel);
      let d1 = 9, d2 = 9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + cel) % cel, jj = (cj + dj + cel) % cel, p = pts[ii + jj * cel];
        let dx = p[0] - u, dy = p[1] - v; dx -= Math.round(dx); dy -= Math.round(dy);
        const d = Math.hypot(dx, dy) * cel;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      out[x + y * n] = Math.min(1, (d2 - d1) * 2.2);
    }
    return out;
  };
  const a = camada(9, 11), b = camada(23, 29), c = camada(47, 53);
  const d = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    d[i * 4] = a[i] * 255; d[i * 4 + 1] = b[i] * 255; d[i * 4 + 2] = c[i] * 255; d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

// ---- mapa do fundo: r = topo do chão − nível do mar (m), g = distância à costa (m) -----------------------------
// Dois níveis (19/11, ilhas temáticas longe da principal): um mapa FINO (4 m) da região em que se está — a ilha
// principal ou a ilha temática mais perto — e um GERAL (16 m) do arquipélago inteiro, que dá a costa e o relevo das
// outras ilhas vistas de longe. `feito()` preenche algumas linhas por chamada (o mapa de uma ilha nunca trava um quadro).
// O relevo usa amostras fixas por ilha. A cor armazena o bloco e a copa (gen.topoEm), em RGB com gama 2.
const COR_LONGE = { [B.GRASS]: [0.042, 0.092, 0.022], [B.DIRT]: [0.085, 0.058, 0.035], [B.STONE]: [0.105, 0.105, 0.11], [B.SAND]: [0.36, 0.31, 0.2], [B.GRAVEL]: [0.12, 0.12, 0.115],
  [B.SNOW]: [0.4, 0.42, 0.45], [B.BASALT]: [0.022, 0.022, 0.027], [B.ASH]: [0.075, 0.07, 0.08], [B.CLAY]: [0.15, 0.14, 0.14], [B.CONCRETE]: [0.18, 0.18, 0.175], [B.MAGMA]: [0.9, 0.2, 0.02], [B.WATER]: [0.04, 0.24, 0.20] };
const COPA_LONGE = [null, [0.022, 0.06, 0.016], [0.015, 0.042, 0.024], [0.04, 0.09, 0.024]];   // frondosa · pinheiro · coqueiro
function corLonge(tp, x, z, o, k) {
  let c = COR_LONGE[tp.top] || COR_LONGE[B.STONE], a = 0;
  if (tp.top === B.CONCRETE) { const v = 0.75 + 0.6 * (Math.abs(Math.sin((x >> 3) * 12.9898 + (z >> 3) * 78.233) * 43758.5453) % 1); c = [c[0] * v * 1.06, c[1] * v, c[2] * v * 0.96]; }   // cada prédio no seu tom
  if (tp.top === B.GRASS) { const seco = Math.max(0, Math.min(1, (0.55 - tp.M) * 2.2)); c = [c[0] + 0.09 * seco, c[1] + 0.02 * seco, c[2]]; }
  if (tp.copa) { const f = COPA_LONGE[tp.copa]; if (tp.copa === 3) { c = [(c[0] + f[0]) / 2, (c[1] + f[1]) / 2, (c[2] + f[2]) / 2]; a = 0.45; } else { c = tp.top === B.SNOW ? [(c[0] + f[0] * 2) / 3, (c[1] + f[1] * 2) / 3, (c[2] + f[2] * 2) / 3] : f; a = 1; } }
  o[k] = Math.sqrt(c[0]) * 255; o[k + 1] = Math.sqrt(c[1]) * 255; o[k + 2] = Math.sqrt(c[2]) * 255; o[k + 3] = a * 255;
}
function mapaFundo(gen, caixa, passo, so = null, relevo = false) {
  const arq = gen.arq, [x0, z0, x1, z1] = caixa;
  const w = Math.ceil((x1 - x0) / passo) + 1, h = Math.ceil((z1 - z0) / passo) + 1;
  const dx = (x1 - x0) / (w - 1), dz = (z1 - z0) / (h - 1);
  const d = new Uint16Array(w * h * 2), toH = THREE.DataUtils.toHalfFloat, FUNDO = toH(-38), LONGE = toH(600);
  const cor = relevo ? new Uint8Array(w * h * 4) : null;
  let j = 0;
  const dentro = so ? (x, z) => so.some((c) => x >= c[0] && x <= c[2] && z >= c[1] && z <= c[3]) : null;
  const m = { tex: null, cor: null, geo: null, caixa: new THREE.Vector4(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0)), arq, gen, pronto: false };
  m.feito = (ms) => {
    const fim = performance.now() + ms;
    for (; j < h; j++) {
      if (performance.now() > fim) return false;
      for (let i = 0; i < w; i++) {
        const x = Math.round(x0 + i * dx), z = Math.round(z0 + j * dz), k = (i + j * w) * 2;
        if (dentro && !dentro(x, z)) { d[k] = FUNDO; d[k + 1] = LONGE; continue; }       // mar aberto: nem se calcula
        const alt = gen.height(x, z) + 1 - MAR_NIVEL;
        if (cor && alt > -12) corLonge(gen.topoEm(x, z), x, z, cor, k * 2);
        d[k] = toH(Math.max(-60, Math.min(120, alt)));
        if (!relevo) d[k + 1] = toH(Math.max(-200, Math.min(600, arq.s(x, z))));
      }
    }
    if (relevo) {
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, w - 1, h - 1);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      const p = g.attributes.position;
      const uv = g.attributes.uv;
      for (let k = 0; k < p.count; k++) {
        p.setY(k, MAR_NIVEL + THREE.DataUtils.fromHalfFloat(d[k * 2]));
        uv.setXY(k, (k % w + 0.5) / w, (Math.floor(k / w) + 0.5) / h);
      }
      g.computeVertexNormals();
      m.geo = g;
      const t = new THREE.DataTexture(cor, w, h, THREE.RGBAFormat);
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true; t.needsUpdate = true;
      m.cor = t;
    } else {
      const t = new THREE.DataTexture(d, w, h, THREE.RGFormat, THREE.HalfFloatType);
      t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
      m.tex = t;
    }
    m.pronto = true;
    return true;
  };
  m.dispose = () => { m.geo?.dispose(); m.tex?.dispose(); m.cor?.dispose(); };
  return m;
}
// leitura do fundo num ponto do mundo: o mapa fino onde ele cobre, senão o geral, senão mar aberto
const MAPA_GLSL = /* glsl */`
uniform sampler2D uMarLonge;
uniform vec4 uMarCaixaL;
vec2 mapaUV(sampler2D mapa, vec2 uv) {
  vec2 sz = vec2(textureSize(mapa, 0));
  return (uv * (sz - 1.0) + 0.5) / sz;
}
vec2 marMapa(vec2 p) {
  vec2 uv = (p - uMarCaixa.xy) * uMarCaixa.zw;
  if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) { vec2 m = textureLod(uMarMapa, mapaUV(uMarMapa, uv), 0.0).rg; return vec2(-m.r, m.g); }
  uv = (p - uMarCaixaL.xy) * uMarCaixaL.zw;
  if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) { vec2 m = textureLod(uMarLonge, mapaUV(uMarLonge, uv), 0.0).rg; return vec2(-m.r, m.g); }
  return vec2(38.0, 600.0);
}
`;
// Cada mapa de relevo fica no espaço do mundo, com profundidade igual à dos blocos e modelos reais.
const RELEVO_VS = /* glsl */`
precision highp float;
in vec3 position, normal;
in vec2 uv;
uniform mat4 viewMatrix, projectionMatrix;
out vec3 vPos, vNormal;
out vec2 vUv;
void main() {
  vPos = position;
  vNormal = normal;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;
const RELEVO_FS = /* glsl */`
precision highp float;
precision highp int;
${COMMON}
uniform vec3 cameraPosition;
uniform sampler2D uMarCor, uChunksComMalha;
uniform ivec2 uOrigemChunks;
in vec3 vPos, vNormal;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 cm = texture(uMarCor, vUv);
  ivec2 chunk = ivec2(floor(vPos.xz / ${CW.toFixed(1)})) - uOrigemChunks;
  ivec2 tamanho = textureSize(uChunksComMalha, 0);
  if (all(greaterThanEqual(chunk, ivec2(0))) && all(lessThan(chunk, tamanho))) {
    if (texelFetch(uChunksComMalha, chunk, 0).r > 0.0) discard;
  }
  if (vPos.y < ${(MAR_NIVEL - 0.25).toFixed(3)}) discard;
  vec3 Nt = normalize(vNormal);
  vec3 alb = cm.rgb * cm.rgb;
  float copa = cm.a;
  vec3 luz = uSunColor * max(dot(Nt, uLightDir), 0.0) * mix(0.9, 0.72, copa)
    + mix(uAmbGround, uAmbSky, 0.5 + 0.5 * Nt.y) * mix(1.0, 0.85, copa);
  vec3 raio = vPos - cameraPosition;
  float d = length(raio);
  vec3 dir = raio / max(d, 0.001);
  float br = clamp(uHaze.x * (1.0 - exp(-d * uHaze.y * 0.55)) + smoothstep(2500.0, 30000.0, d), 0.0, 1.0);
  vec3 ceu = skyBase(vec3(dir.x, max(dir.y, 0.0), dir.z));
  outColor = vec4(finish(mix(alb * luz, ceu, br)), 1.0);
}
`;

const VS = /* glsl */`
precision highp float;
in vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform vec3 uMarCentro, uMarVento;   // xy = direção do vento, z = estado do mar (0 calmaria … 1 tempestade)
uniform float uMarTempo, uMarFase;
uniform sampler2D uMarMapa;
uniform vec4 uMarCaixa;
out vec3 vVirt;
${MAR_GLSL}
const float MAR_NIVEL = ${MAR_NIVEL.toFixed(3)};
${MAPA_GLSL}void main() {
  vec2 p = uMarCentro.xz + position.xz;
  float lod = position.y;
  vec2 m = marMapa(p);
  vec3 n; float cr;
  vec3 d = marAberto(p, uMarTempo, m.x, m.y, uMarVento, lod, n, cr);
  float esp, fr, inc;
  float yc = lod < 6.0 ? marCosta(p, uMarFase, uMarVento.z, m.x, m.y, esp, fr, inc) : 0.0;
  vec3 P = vec3(p.x + d.x, MAR_NIVEL + d.y + yc, p.y + d.z);
  vVirt = P;
  vec3 rel = P - cameraPosition;
  float dist = length(rel.xz);
  // Só o oceano além das ilhas é comprimido, preservando a ordem dos anéis no horizonte.
  float extra = max(0.0, dist - ${MAR_DISTANCIA_REAL.toFixed(1)});
  if (extra > 0.0) {
    float largura = ${(MAR_HORIZONTE - MAR_DISTANCIA_REAL).toFixed(1)};
    rel *= (${MAR_DISTANCIA_REAL.toFixed(1)} + extra * largura / (extra + largura)) / dist;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + rel, 1.0);
}
`;

const FS = /* glsl */`
precision highp float;
${COMMON}
uniform vec3 cameraPosition;
uniform vec3 uMarVento;
uniform float uMarTempo, uMarFase;
uniform sampler2D uMarMapa, uMarDet, uMarEsp;
uniform vec4 uMarCaixa;
uniform vec3 uWaterColor, uWaterShallow;
in vec3 vVirt;
uniform sampler2D uGaleria;
uniform vec3 uGaleriaCaixa, uGeleira, uBanquisa;
uniform sampler2D uBanquisaMapa;
uniform ivec2 uOrigemChunks;
uniform sampler2D uChunksComMalha;
out vec4 outColor;
${MAR_GLSL}
const float MAR_NIVEL = ${MAR_NIVEL.toFixed(3)};
${MAPA_GLSL}float fresnelDieletrico(float cosI, float eta) {
  float c = abs(cosI), g2 = 1.0 / (eta * eta) - 1.0 + c * c;
  if (g2 < 0.0) return 1.0;
  float g = sqrt(g2), a = (g - c) / (g + c), b = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
  return 0.5 * a * a * (1.0 + b * b);
}
float ggx(float nh, float r) { float a2 = r * r * r * r; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (3.14159 * d * d); }

void main() {
  vec3 P = vVirt;
  if (uGeleira.z > 0.0) {
    vec2 dxz = floor(P.xz) - uGeleira.xy;
    if (dot(dxz, dxz) <= uGeleira.z) {
      ivec2 ch = ivec2(floor(P.xz / 16.0)) - uOrigemChunks;
      if (all(greaterThanEqual(ch, ivec2(0))) && all(lessThan(ch, textureSize(uChunksComMalha, 0)))
          && texelFetch(uChunksComMalha, ch, 0).r > 0.0) discard;
    }
  }
  // banquisa que veio com a Fortaleza (shared/fortaleza.js, o mesmo molde do gerador): onde há gelo, o mar não passa
  // por cima (antes as ondas cobriam o gelo em manchas e degraus de 16 m fora do círculo da geleira)
  if (uBanquisa.z > 0.0) {
    ivec2 q = ivec2(floor(P.xz) - uBanquisa.xy) + ivec2(int(uBanquisa.z));
    ivec2 lb = textureSize(uBanquisaMapa, 0);
    if (all(greaterThanEqual(q, ivec2(0))) && all(lessThan(q, lb)) && texelFetch(uBanquisaMapa, q, 0).r > 0.0) {
      ivec2 ch = ivec2(floor(P.xz / 16.0)) - uOrigemChunks;
      if (all(greaterThanEqual(ch, ivec2(0))) && all(lessThan(ch, textureSize(uChunksComMalha, 0)))
          && texelFetch(uChunksComMalha, ch, 0).r > 0.0) discard;
    }
  }
  if (uGaleriaCaixa.z > 0.0) {
    vec2 uv = (P.xz - uGaleriaCaixa.xy) / uGaleriaCaixa.z;
    if (all(greaterThanEqual(uv,vec2(0))) && all(lessThan(uv,vec2(1)))) {
      vec2 y = texture(uGaleria,uv).rg * 255.0 - 64.0;
      if (y.y > y.x && P.y >= y.x && P.y <= y.y) discard;
    }
  }
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 0.001);
  vec2 p = P.xz;
  vec2 m = marMapa(p);
  float prof = m.x, s = m.y;
  float chao = MAR_NIVEL - prof;                 // topo do chão debaixo deste ponto
  float coluna = P.y - chao;                      // água entre a superfície e o chão
  if (coluna < 0.0 || prof < -1.6) discard;       // areia acima da água (o espraiamento é que avança sobre ela)

  // normal: mar aberto (por pixel) + arrebentação + detalhe que rola com o vento
  float pegada = max(0.02, dist * 0.0016);
  vec3 n; float crista;
  marAberto(p, uMarTempo, prof, s, uMarVento, pegada * 2.5, n, crista);
  float espC, frente, incl;
  marCosta(p, uMarFase, uMarVento.z, prof, s, espC, frente, incl);
  float e = 4.0;
  vec2 gs = vec2(marMapa(p + vec2(e, 0.0)).y - marMapa(p - vec2(e, 0.0)).y, marMapa(p + vec2(0.0, e)).y - marMapa(p - vec2(0.0, e)).y) / (2.0 * e);
  n.xz -= gs * incl;
  vec2 vv = uMarVento.xy * (0.6 + 0.6 * uMarVento.z);
  float fd = 1.0 - smoothstep(25.0, 260.0, dist);
  vec3 d1 = texture(uMarDet, p * 0.061 + vv * uMarTempo * 0.021).xzy * 2.0 - 1.0;
  vec3 d2 = texture(uMarDet, p * 0.157 - vec2(vv.y, -vv.x) * uMarTempo * 0.034 + 0.37).xzy * 2.0 - 1.0;
  vec3 N = normalize(n + vec3(d1.x + d2.x * 0.6, 0.0, d1.z + d2.z * 0.6) * (0.32 * fd * (0.6 + 0.4 * uMarVento.z)));

  bool sob = cameraPosition.y < P.y - 0.02;       // olhando de baixo d'água
  if (sob) N = -N;
  float cosV = dot(N, V);
  vec3 L = uSunDir;
  float dia = smoothstep(-0.12, 0.2, uSunDir.y);
  vec3 luzSol = uSunColor * max(uLightDir.y, 0.0);

  // espuma: quebra na arrebentação + cristas apertadas no mar aberto + linha do espraiamento
  vec4 renda = texture(uMarEsp, p * 0.055 + vv * uMarTempo * 0.01);
  vec4 renda2 = texture(uMarEsp, p * 0.13 - vv * uMarTempo * 0.017);
  float bolhas = renda.r * 0.5 + renda2.g * 0.35 + renda2.b * 0.25;
  float espuma = espC * frente * smoothstep(0.2, 0.62, bolhas + espC * 0.3);              // crista quebrando + renda atrás
  espuma += espC * smoothstep(0.55, 0.8, bolhas) * 0.25;                                   // pontos soltos na zona de arrebentação
  float ventoEsp = smoothstep(0.25, 0.9, uMarVento.z);
  espuma += smoothstep(0.32, 0.58, crista) * smoothstep(0.45, 0.8, bolhas) * (0.35 + 0.65 * ventoEsp);   // carneirinhos
  espuma += smoothstep(0.12, 0.0, coluna) * smoothstep(0.45, 0.75, bolhas + 0.2) * smoothstep(1.5, -0.6, prof) * 0.85;   // borda do espraiamento
  espuma = clamp(espuma, 0.0, 1.0) * (1.0 - smoothstep(180.0, 700.0, dist));

  vec3 cor; vec3 trans;
  if (!sob) {
    float F = fresnelDieletrico(max(cosV, 0.0), 1.0 / 1.333);
    vec3 R = reflect(-V, N); R.y = abs(R.y);
    vec3 ceu = skyBase(R);
    vec3 H = normalize(L + V);
    float rug = mix(0.07, 0.16, smoothstep(40.0, 600.0, dist)) + 0.1 * smoothstep(0.4, 1.0, uMarVento.z);
    vec3 brilho = luzSol * ggx(max(dot(N, H), 0.0), rug) * F * 0.9 * step(0.0, uSunDir.y);
    // caminho da luz dentro da água até o chão (Beer-Lambert): o raso deixa ver a areia, o fundo fica azul-safira
    float cosT = sqrt(max(0.0, 1.0 - (1.0 - cosV * cosV) / (1.333 * 1.333)));
    float caminho = min(coluna, 60.0) * (1.0 + 1.0 / max(cosT, 0.2));
    vec3 sigma = vec3(0.42, 0.072, 0.041);
    vec3 T = exp(-sigma * caminho);
    vec3 luzAgua = (luzSol * 0.55 + uAmbSky * 1.1) * mix(0.35, 1.0, dia);
    float raso = 1.0 - smoothstep(0.5, 9.0, coluna);
    vec3 corpo = mix(uWaterColor, uWaterShallow, raso * 0.85) * luzAgua * mix(1.0, 0.55, smoothstep(0.5, 1.0, uMarVento.z));
    // luz atravessando a crista (de costas para o sol)
    float contra = pow(max(dot(-V, L), 0.0), 4.0) * smoothstep(-0.05, 0.6, P.y - MAR_NIVEL);
    corpo += vec3(0.05, 0.42, 0.36) * luzSol * contra * 0.25;
    // crista alta: a luz atravessa a parede fina da onda (verde-água por dentro), de qualquer lado que se olhe
    float altura = P.y - MAR_NIVEL;
    corpo += vec3(0.02, 0.30, 0.24) * (luzSol * 0.22 + uAmbSky * 0.5) * smoothstep(0.25, 1.1, altura) * (0.6 + 0.4 * max(cosV, 0.0));
    // o fundo visto através da água perde primeiro o vermelho (passada MULT); a água devolve um pouco de luz azul
    cor = ceu * F + (1.0 - F) * corpo * (1.0 - T) * 0.55 + brilho;
    trans = (1.0 - F) * T;
    // espuma por cima, com luz de céu e sol
    vec3 corEsp = (luzSol * max(dot(N, L), 0.0) * 0.8 + uAmbSky * 1.3) * vec3(0.92, 0.95, 0.97);
    cor = mix(cor, corEsp, espuma); trans *= 1.0 - espuma;
    // névoa: só a bruma do ar (o mar não tem borda de mundo carregado): vai até o horizonte e some nele
    vec4 nv = fogAt(dist, -V, P.y);
    float br = uHaze.x * (1.0 - exp(-dist * uHaze.y * 0.55)) + smoothstep(2500.0, 30000.0, dist);
    br = clamp(br, 0.0, 1.0);
    vec3 hor = skyBase(vec3(-V.x, max(-V.y, 0.0), -V.z));
    cor = mix(cor, mix(hor, nv.rgb, uFogTint.a), br);
    trans *= 1.0 - br;
  } else {
    // de baixo: dentro da janela de Snell vê-se o céu; fora dela, o espelho da água de dentro
    vec3 Rt = refract(-V, N, 1.333);
    float F = dot(Rt, Rt) < 1e-4 ? 1.0 : fresnelDieletrico(max(cosV, 0.0), 1.333);
    vec3 ceu = skyBase(normalize(Rt + vec3(0.0, 1e-3, 0.0))) * 1.1;
    vec3 dentro = uWaterColor * (luzSol * 0.4 + uAmbSky) * 0.9;
    cor = mix(ceu, dentro, F) + espuma * uAmbSky * 0.6;
    float vela = exp(-dist * 0.045);
    cor = mix(uWaterColor * (uAmbSky * 0.9 + luzSol * 0.2), cor, vela);
    trans = vec3(0.0);
  }
#ifdef MULT
  outColor = vec4(trans, 1.0);
#else
  outColor = vec4(finish(cor), 1.0);
#endif
}
`;

export function initOceano({ scene, camera, game, world }) {
  const pc = game.plataforma === 'pc' || !game.plataforma;
  const geo = malhaAneis(pc ? 320 : 180, pc ? 0.028 : 0.045);
  const ladoGaleria = 96, dadosGaleria = new Uint8Array(ladoGaleria * ladoGaleria * 2);
  const texturaGaleria = new THREE.DataTexture(dadosGaleria, ladoGaleria, ladoGaleria, THREE.RGFormat);
  texturaGaleria.needsUpdate = true;
  let indiceGaleria, ultimoX, ultimoZ;
  const uOrigemChunks = { value: new THREE.Vector2() };
  const uChunksComMalha = { value: null };
  const uniforms = {
    ...U,
    uOrigemChunks, uChunksComMalha, uGeleira: { value: new THREE.Vector3() },
    uBanquisa: { value: new THREE.Vector3() }, uBanquisaMapa: { value: texturaBanquisa() },
    uGaleria: {value: texturaGaleria}, uGaleriaCaixa: {value: new THREE.Vector3()},
    uMarCentro: { value: new THREE.Vector3() },
    uMarVento: { value: new THREE.Vector3(0.83, 0.55, 0.85) },
    uMarTempo: { value: 0 },
    uMarFase: { value: 0 },
    uMarMapa: { value: null },
    uMarCaixa: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMarLonge: { value: null },
    uMarCaixaL: { value: new THREE.Vector4(0, 0, 0, 0) },
    uMarDet: { value: texturaDetalhe() },
    uMarEsp: { value: texturaEspuma() },
  };
  // passada 1: o que está atrás (fundo, peixes, corais) × transmitância da água em cada cor
  // passada 2: + reflexo do céu, sol, luz devolvida pela água, espuma e bruma
  const base = { glslVersion: THREE.GLSL3, uniforms, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending };
  const matMult = new THREE.RawShaderMaterial({ ...base, name: 'oceano-transmissao', defines: { MULT: 1 },
    blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  const matLuz = new THREE.RawShaderMaterial({ ...base, name: 'oceano-luz',
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  const malhas = [matMult, matLuz].map((m, i) => {
    const o = new THREE.Mesh(geo, m);
    o.name = 'oceano'; o.frustumCulled = false; o.renderOrder = 2 + i; o.visible = false;
    scene.add(o);
    return o;
  });

  const relevo = new THREE.Group();
  relevo.name = 'relevo-distante';
  scene.add(relevo);
  let mascara = null, mascaraNova = null;
  function atualizarChunks(x, z) {
    const r = (world?.radius || 10) + 5, lado = 2 * r + 1;
    if (mascara?.image.width !== lado) {
      mascara?.dispose();
      mascara = new THREE.DataTexture(new Uint8Array(lado * lado), lado, lado, THREE.RedFormat);
      mascaraNova = new Uint8Array(lado * lado);
      uChunksComMalha.value = mascara;
      mascara.needsUpdate = true;
    }
    const cx = Math.floor(x / CW) - r, cz = Math.floor(z / CW) - r;
    uOrigemChunks.value.set(cx, cz);
    mascaraNova.fill(0);
    for (const c of world?.chunks.values() || []) {
      const i = c.cx - cx, j = c.cz - cz;
      if (c.hasMesh && i >= 0 && i < lado && j >= 0 && j < lado) mascaraNova[i + j * lado] = 255;
    }
    const dados = mascara.image.data;
    if (dados.some((v, k) => v !== mascaraNova[k])) {
      dados.set(mascaraNova);
      mascara.needsUpdate = true;
    }
  }
  let mapasRelevo = [], indiceRelevo = 0;
  const farNormal = camera.far;
  const cam = new THREE.Vector3();

  let mapa = null, rascunho = null;
  // regiões com costa: a ilha principal (0) e cada ilha temática; `finos` guarda o mapa fino das últimas visitadas
  let regioes = [], finos = new Map(), geral = null, ativa = -1, vazio = null;
  const maisPerto = (x, z) => {
    let k = 0, dm = Infinity;
    regioes.forEach((c, i) => { const dx = Math.max(c[0] - x, 0, x - c[2]), dz = Math.max(c[1] - z, 0, z - c[3]), d = dx * dx + dz * dz; if (d < dm) { dm = d; k = i; } });
    return [k, Math.sqrt(dm)];
  };
  const t0 = performance.now();
  const api = {
    ligado: false,
    tempo: 0,
    estado: 0.3,     // 0 calmaria … 1 tempestade (segue o tempo do mundo, devagar)
    fase: 0,         // séries da arrebentação já passadas (o período muda com o estado sem a onda pular)
    dir: { x: 0.83, y: 0.55 },
    prof(x, z) { return mapa ? MAR_NIVEL - (mapa.gen.height(Math.round(x), Math.round(z)) + 1) : 99; },
    s(x, z) { return mapa ? mapa.arq.s(x, z) : 999; },
    altura(x, z) { return MAR_NIVEL + alturaMar(x, z, api.tempo, api.prof(x, z), api.s(x, z), api.dir, api.estado, api.fase); },
  };
  game.mar = api;

  game.hooks.frame.push(() => {
    const gen = game.gen;
    const on = !!(gen && gen.arq && game.dim === 0);
    api.ligado = on;
    U.uMarNovo.value = on ? 1 : 0;
    const visivel = on && !(game.vooPlanetario?.mistura >= 1);
    for (const o of malhas) o.visible = visivel;
    relevo.visible = visivel;
    // O disco orbital oculta todo o cenário além do primeiro plano do piloto.
    const far = on && !visivel ? Math.min(farNormal, 96) : on ? Math.max(farNormal, CAMERA_FAR) : farNormal;
    if (camera.far !== far) {
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    if (!visivel) return;
    const c = camera.getWorldPosition(cam);
    const gelo = gen.fortaleza;
    const pertoDoGelo = gelo && Math.abs(c.x - gelo[0]) < 700 && Math.abs(c.z - gelo[1]) < 700;
    uniforms.uGeleira.value.set(gelo?.[0] ?? 0, gelo?.[1] ?? 0, pertoDoGelo ? RAIO_GELO ** 2 : 0);
    uniforms.uBanquisa.value.set(gelo?.[0] ?? 0, gelo?.[1] ?? 0, pertoDoGelo && gen.origemFortaleza ? RAIO_BANQUISA : 0);
    atualizarChunks(c.x, c.z);
    const corredores = game.ferrovia?.corredores;
    if (corredores?.size || indiceGaleria) {
      const x = Math.floor(c.x / 16) * 16 - 40, z = Math.floor(c.z / 16) * 16 - 40;
      if (corredores !== indiceGaleria || x !== ultimoX || z !== ultimoZ) {
        const ativa = mascaraNaMare(corredores, x, z, ladoGaleria, dadosGaleria);
        uniforms.uGaleriaCaixa.value.set(x,z,ativa ? ladoGaleria : 0);
        if (ativa) texturaGaleria.needsUpdate = true;
        indiceGaleria = corredores; ultimoX = x; ultimoZ = z;
      }
    }
    if (!mapa || mapa.gen !== gen) {
      rascunho?.dispose(); rascunho = null;
      for (const m of finos.values()) m.dispose();
      geral?.dispose();
      for (const m of mapasRelevo) m.dispose();
      for (const mesh of relevo.children) mesh.material.dispose();
      relevo.clear();
      const arq = gen.arq;
      regioes = [arq.caixa, ...(arq.ilhas || []).map((il) => il.caixa)];
      finos = new Map(); geral = null; ativa = -1;
      // onde se está agora fica pronto já (como sempre foi com a ilha principal); o resto, aos poucos
      const [k] = maisPerto(c.x, c.z);
      const ordem = [regioes[k], ...regioes.filter((_, i) => i !== k)];
      mapasRelevo = ordem.map((r) => {
        const passo = Math.max(pc ? 8 : 12, Math.max(r[2] - r[0], r[3] - r[1]) / 240);
        return mapaFundo(gen, r, passo, null, true);
      });
      indiceRelevo = 0;
      const regiao = regioes[k];
      const passoInicial = Math.max(16, (regiao[2] - regiao[0]) / 32, (regiao[3] - regiao[1]) / 32);
      rascunho = mapa = mapaFundo(gen, regiao, passoInicial); mapa.feito(Infinity);
      finos.set(k, mapaFundo(gen, regiao, 4));
      uniforms.uMarMapa.value = mapa.tex;
      uniforms.uMarCaixa.value.copy(mapa.caixa);
      if (!vazio) { vazio = new THREE.DataTexture(new Uint16Array(2), 1, 1, THREE.RGFormat, THREE.HalfFloatType); vazio.needsUpdate = true; }
      uniforms.uMarLonge.value = vazio; uniforms.uMarCaixaL.value.set(0, 0, 0, 0);
      if (regioes.length > 1) {
        const g = [Infinity, Infinity, -Infinity, -Infinity];
        for (const r of regioes) { g[0] = Math.min(g[0], r[0]); g[1] = Math.min(g[1], r[1]); g[2] = Math.max(g[2], r[2]); g[3] = Math.max(g[3], r[3]); }
        geral = mapaFundo(gen, g, 16, regioes);
      }
    }
    // Os mapas costeiros refinam em fatias de tempo, inclusive no primeiro pouso.
    if (geral && !geral.pronto && geral.feito(1)) {
      uniforms.uMarLonge.value = geral.tex; uniforms.uMarCaixaL.value.copy(geral.caixa);
    }
    const [regiaoAtual, dist] = maisPerto(c.x, c.z);
    let fino = finos.get(regiaoAtual);
    if (!fino && dist < 900) { fino = mapaFundo(gen, regioes[regiaoAtual], 4); finos.set(regiaoAtual, fino); }
    if (fino && !fino.pronto) fino.feito(dist < 300 ? 2 : 1);
    if (fino?.pronto && regiaoAtual !== ativa) {
      ativa = regiaoAtual; mapa = fino;
      uniforms.uMarMapa.value = fino.tex; uniforms.uMarCaixa.value.copy(fino.caixa);
      rascunho?.dispose(); rascunho = null;
      if (finos.size > 3) for (const [i, o] of finos) if (i !== ativa && i !== 0 && finos.size > 3) { o.dispose(); finos.delete(i); }
    }
    const terra = mapasRelevo[indiceRelevo];
    if (terra?.feito(2)) {
      const material = new THREE.RawShaderMaterial({
        name: 'relevo-distante', glslVersion: THREE.GLSL3, vertexShader: RELEVO_VS, fragmentShader: RELEVO_FS,
        uniforms: { ...U, uMarCor: { value: terra.cor }, uOrigemChunks, uChunksComMalha },
      });
      relevo.add(new THREE.Mesh(terra.geo, material));
      indiceRelevo++;
    }
    const agora = (performance.now() - t0) / 1000, dt = Math.min(0.1, Math.max(0, agora - api.tempo));
    api.tempo = agora;
    uniforms.uMarTempo.value = api.tempo;
    // o mar segue o tempo do mundo: engrossa em ~25 s e acalma em ~40 s (como mar de verdade, sem pulos)
    const w = game.weather, alvo = estadoDoTempo(w);
    api.estado += (alvo - api.estado) * (1 - Math.exp(-dt / (alvo > api.estado ? 25 : 40)));
    api.fase += dt / multMar(api.estado).periodo;
    const vx = w?.wind?.[0] || 0, vz = w?.wind?.[1] || 0, vl = Math.hypot(vx, vz);
    if (vl > 0.4) { api.dir.x += (vx / vl - api.dir.x) * dt * 0.05; api.dir.y += (vz / vl - api.dir.y) * dt * 0.05; }
    const dl = Math.hypot(api.dir.x, api.dir.y) || 1;
    uniforms.uMarVento.value.set(api.dir.x / dl, api.dir.y / dl, api.estado);
    uniforms.uMarFase.value = api.fase;
    // o mundo carregado acaba em world.radius pedaços; dali em diante quem mostra as ilhas é o relevo distante, então
    // a névoa de borda (que apagava o fim do mundo carregado) sai. Fica a bruma do ar; névoa de chuva e de mergulho ficam.
    const R = (world?.radius || 10) * 16;
    if (U.uFog.value.y > R * 0.9 && U.uFogTint.value.w < 0.5) {
      U.uFog.value.set(1e5, 2e5);
      if (scene.fog) { scene.fog.near = 1e5; scene.fog.far = 2e5; }
    }
    uniforms.uMarCentro.value.set(c.x, MAR_NIVEL, c.z);
  });
  return api;
}
