// LAVRA — relva viva (prova de realismo, ramo exp/realismo; referência do Kadmus: screen.toys/firewood).
//
// O gramado deixa de ser só a foto no topo do bloco: em volta de quem olha, cada metro quadrado ganha ~170 lâminas de
// grama de verdade (malha instanciada), que recebem o sol, a sombra de perto e o vento, e somem aos poucos com a
// distância (o terreno escurece por baixo delas pela mesma curva: shared/relva.js → densidadeRelva).
//
// Dados: `chunk.lawn` (shared/relva.js), vindo do mesher. Nada aqui muda o mundo: é só desenho.
// Leveza: as lâminas de cada célula nascem uma vez (ordem de baixa discrepância: qualquer começo da lista já cobre a
// célula por igual) e ficam guardadas; andar só recopia as que estão no alcance. Liga com `?real=1` (config.js → REAL).
import * as THREE from '../three.js';
import { U, COMMON, SHADOW_NEAR_GLSL } from './materials.js';
import { CW } from '../../shared/constants.js';
import { TEX_INDEX } from '../../shared/blocks.js';
import { PASSO_RELVA, RELVA_TRONCO, chaoRelva, densidadeRelva } from '../../shared/relva.js';

const PASSO = 12;                 // números por lâmina: base xyz · giro, altura, ordem, sorteio · tombo · céu, lâmpada, temp, umid
const R2A = 0.7548776662466927, R2B = 0.5698402909980532;   // sequência R2: pontos bem espalhados em qualquer prefixo

function hash3(x, y, z) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(z, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
// ruído de valor suave (manchas de relva mais alta e mais baixa, ~3 m)
function mancha(x, z) {
  const fx = x / 3.1, fz = z / 3.1, ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
  const v = (a, b) => hash3(a, 77, b) / 4294967296;
  const a = v(ix, iz), b = v(ix + 1, iz), c = v(ix, iz + 1), d = v(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

const VS = /* glsl */`
precision highp float;
in vec2 aT;                 // x = lado (−1..1) · y = altura na lâmina (0 = pé … 1 = ponta)
in vec3 aBase;
in vec4 aPar;               // giro · altura (m) · ordem (0..1) · sorteio (0..1)
in float aTombo;
in vec4 aCel;               // céu · lâmpada · temperatura · umidade (0..1)
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform vec4 uRelva;
uniform float uWindTime;
uniform vec3 uWind;
uniform vec4 uPisa[4];      // quem pisa: xyz + raio
${COMMON}
out vec3 vWorld;
out vec3 vN;
out vec3 vLado;
out vec2 vT;
out vec4 vCel;
out float vSorte;
void main() {
  float giro = aPar.x, alt = aPar.y, ordem = aPar.z, sorte = aPar.w;
  float dist = distance(aBase, cameraPosition);
  float dens = relvaDens(uRelva, dist);
  float nasce = clamp((dens * 1.14 - ordem) / 0.14, 0.0, 1.0);          // a lâmina cresce do chão quando entra no alcance
  float larg = (0.0085 + 0.006 * sorte) * (1.0 + 1.6 * (inversesqrt(max(dens, 0.07)) - 1.0));   // longe: menos lâminas, mais largas
  float t = aT.y;
  vec2 dir = vec2(cos(giro), sin(giro));
  vec3 lado = vec3(-dir.y, 0.0, dir.x);
  // vento: uma onda que atravessa o campo + o tremor de cada lâmina
  vec2 vd = uWind.xy;
  float onda = sin(uWindTime * 1.7 - dot(aBase.xz, vd) * 0.55 + sorte * 1.3) * 0.5 + 0.5;
  float trem = sin(uWindTime * 5.3 + sorte * 40.0 + aBase.x * 2.1);
  vec2 vento = vd * (0.045 + 0.11 * onda) * uWind.z + vec2(trem, -trem) * 0.012 * min(uWind.z, 1.5);
  // quem pisa deita a relva para fora
  vec2 pisa = vec2(0.0); float amassa = 0.0;
  for (int k = 0; k < 4; k++) {
    vec4 p = uPisa[k];
    vec2 d = aBase.xz - p.xz; float dl = length(d);
    float f = (1.0 - smoothstep(p.w * 0.35, p.w, dl)) * step(abs(aBase.y - p.y), 1.6);
    pisa += (dl > 1e-3 ? d / dl : vec2(0.7)) * f; amassa = max(amassa, f);
  }
  float h = alt * nasce * (1.0 - 0.55 * amassa);
  float tombo = aTombo + 0.9 * amassa;
  vec2 curva = dir * (tombo * h) + (vento + pisa * 0.16) * (h / 0.12);
  float t2 = t * t;
  vec3 p = aBase + vec3(curva.x * t2, h * t * (1.0 - 0.22 * tombo * t), curva.y * t2);
  p += lado * (aT.x * 0.5 * larg * (1.0 - 0.9 * t * t));
  // normal: a face da lâmina, arredondada de um lado ao outro
  vec3 tang = normalize(vec3(curva.x * 2.0 * t, h * (1.0 - 0.44 * tombo * t), curva.y * 2.0 * t) + vec3(0.0, 1e-4, 0.0));
  vec3 face = normalize(cross(lado, tang));
  vN = normalize(face + lado * (aT.x * 0.55));
  vLado = lado;
  vWorld = p;
  vT = aT;
  vCel = aCel;
  vSorte = sorte;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  if (nasce <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);      // fora do alcance: fora da tela
}
`;

const FS = /* glsl */`
precision highp float;
precision highp sampler2DShadow;
uniform vec3 cameraPosition;
uniform vec4 uRelva, uRelvaCor;        // uRelvaCor: cor média da foto do gramado (linear) · a = quanto ela aceita a tinta do clima
uniform sampler2D uNoise;
uniform float uWetness;
#ifdef SHADOWS
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowInfo;
#endif
${COMMON}
${SHADOW_NEAR_GLSL}
in vec3 vWorld;
in vec3 vN;
in vec3 vLado;
in vec2 vT;
in vec4 vCel;
in float vSorte;
out vec4 outColor;
vec3 lin(vec3 c) { return c * c * (c * 0.305 + 0.695); }
// a mesma tinta do gramado no terreno (materials.js → grassColor)
vec3 grassColor(vec2 cl) {
  vec3 dry = mix(vec3(0.44, 0.60, 0.40), vec3(0.74, 0.72, 0.32), smoothstep(0.35, 0.8, cl.x));
  vec3 wet = mix(vec3(0.34, 0.56, 0.39), vec3(0.34, 0.63, 0.26), cl.x);
  return lin(mix(dry, wet, smoothstep(0.2, 0.62, cl.y)));
}
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  float t = vT.y;
  // cor: a do gramado ali (foto × clima), pé escuro e ponta clara, cada lâmina um pouco diferente, algumas secas
  vec3 base = uRelvaCor.rgb * mix(vec3(1.0), grassColor(vCel.zw), uRelvaCor.a);
  base *= 0.84 + 0.32 * texture(uNoise, vWorld.xz * 0.013 + vWorld.y * 0.009).r;      // a mesma variação larga do terreno
  float seca = smoothstep(0.86, 1.0, vSorte);
  vec3 alb = mix(base, base * vec3(1.9, 1.5, 0.75), seca * 0.7);
  alb *= (0.85 + 0.4 * fract(vSorte * 7.31)) * mix(0.62, 1.55, smoothstep(0.0, 0.85, t));
  alb *= 1.0 - 0.1 * abs(vT.x);                                                        // nervura no meio, bordas um tom abaixo
  alb *= 1.0 - uWetness * 0.14;

  float sky = vCel.x, blk = vCel.y;
  float sunVis = smoothstep(0.5, 0.95, sky);
#ifdef SHADOWS
  float longe = sunVis;
  {
    vec4 sc = uShadowMatrix * vec4(vWorld + uLightDir * 0.12, 1.0);
    vec3 c = sc.xyz / sc.w;
    float e = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
    if (e > 0.0 && c.z < 1.0 && c.z > 0.0) longe = mix(longe, texture(uShadowMap, vec3(c.xy, c.z - 0.0001)), smoothstep(0.0, 0.06, e) * uShadowInfo.y);
  }
#ifdef SHADOW_NEAR
  vec2 perto = nearShadow(vWorld);
  sunVis = mix(longe, perto.x, perto.y);
#else
  sunVis = longe;
#endif
  sunVis *= smoothstep(0.0, 0.2, sky);
#endif
  // luz: a lâmina é fina e deixa a luz passar. De frente recebe o sol; contra o sol acende em verde-amarelo.
  vec3 Nm = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.5));
  float ndl = max((dot(Nm, uLightDir) + 0.3) / 1.3, 0.0);
  // o que atravessa a folha sai mais claro e amarelado: é o verde aceso do gramado ao sol
  float atras = 0.26 + max(dot(-N, uLightDir), 0.0) * 0.5 + pow(max(dot(V, -uLightDir), 0.0), 4.0) * 0.5;
  vec3 direct = uSunColor * (ndl + atras * vec3(1.3, 1.2, 0.5) * (0.4 + 0.6 * t)) * sunVis;
  float ao = mix(0.45, 1.0, smoothstep(0.0, 0.7, t));                                  // o pé fica entre as outras lâminas
  vec3 amb = mix(uAmbGround, uAmbSky, Nm.y * 0.5 + 0.5) * (sky * (0.25 + 0.75 * sky));
  vec3 torch = uTorch * mix(vec3(1.0, 0.7, 0.4), vec3(1.0), blk) * (blk * blk);
  vec3 col = alb * (direct * mix(0.5, 1.0, ao) + (amb + torch + uMinAmb) * ao);
  // brilho: a ponta da lâmina cintila quando o sol bate de raspão
  vec3 H = normalize(V + uLightDir);
  float brilho = pow(max(dot(N, H), 0.0), 22.0) * (0.25 + 0.75 * uWetness);
  col += uSunColor * brilho * 0.16 * sunVis * t;
  vec4 fog = fogAt(dist, -V, vWorld.y);
  col = mix(col, fog.rgb, fog.a);
  outColor = vec4(finish(col), 1.0);
}
`;

export function initRelva({ scene, world, camera, game, quality, player }) {
  const cfg = quality.real?.relva;
  if (!cfg) return null;
  const RAIO = cfg.raio || 22, CHEIO = RAIO * 0.25, POR_CELULA = Math.max(8, Math.round(cfg.porMetro || 170));
  U.uRelva.value.set(1, CHEIO, RAIO, 0);

  // ---- a lâmina: fita de 4 gomos que afina até a ponta -----------------------------------------------------------
  const ALT = [0, 0.3, 0.58, 0.82, 1];
  const aT = [], idx = [];
  for (let i = 0; i < ALT.length - 1; i++) aT.push(-1, ALT[i], 1, ALT[i]);
  aT.push(0, 1);
  for (let i = 0; i < ALT.length - 2; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const u = (ALT.length - 2) * 2; idx.push(u, u + 1, u + 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(aT), 2));
  geo.setIndex(idx);
  let cap = 0, dados = null, inter = null;
  function capacidade(n) {
    if (n <= cap) return;
    cap = Math.ceil(n * 1.25) + 4096;
    dados = new Float32Array(cap * PASSO);
    inter = new THREE.InstancedInterleavedBuffer(dados, PASSO);
    inter.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBase', new THREE.InterleavedBufferAttribute(inter, 3, 0));
    geo.setAttribute('aPar', new THREE.InterleavedBufferAttribute(inter, 4, 3));
    geo.setAttribute('aTombo', new THREE.InterleavedBufferAttribute(inter, 1, 7));
    geo.setAttribute('aCel', new THREE.InterleavedBufferAttribute(inter, 4, 8));
  }
  capacidade(60000);
  geo.instanceCount = 0;

  const uni = { ...U, uPisa: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, -999, 0, 0.001)) } };
  const defs = {};
  if (quality.shadow) defs.SHADOWS = 1;
  if (quality.shadow && quality.real?.shadowNear) defs.SHADOW_NEAR = 1;
  const material = new THREE.RawShaderMaterial({ name: 'relva', glslVersion: THREE.GLSL3, uniforms: uni, vertexShader: VS, fragmentShader: FS, defines: defs, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'relva'; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.visible = false;
  scene.add(mesh);

  // ---- cor: a média da foto do gramado que estiver em uso (pacote de textura trocado, a relva acompanha) ---------
  let corFeita = false;
  function cor() {
    const d = game.texData, n = game.texSize;
    if (!d || !n) return;
    const o = TEX_INDEX.grass_top * n * n * 4;
    let r = 0, g = 0, b = 0;
    const L = (v) => { v /= 255; return v * v * (v * 0.305 + 0.695); };
    for (let i = 0; i < n * n; i++) { r += L(d[o + i * 4]); g += L(d[o + i * 4 + 1]); b += L(d[o + i * 4 + 2]); }
    uni.uRelvaCor.value.set(r / (n * n), g / (n * n), b / (n * n), 1);
    corFeita = true;
  }

  // ---- lâminas de cada célula (nascem uma vez por malha do pedaço) -------------------------------------------------
  const porPedaco = new Map();      // chave do pedaço → { lawn, ox, oz, celulas: Map(i → Float32Array) }
  let sujo = true;
  function receber(chunk) {
    const lawn = chunk && chunk.hasMesh ? chunk.lawn : null;
    if (!lawn || !lawn.length) { if (porPedaco.delete(chunk.key)) sujo = true; return; }
    porPedaco.set(chunk.key, { lawn, ox: chunk.cx * CW, oz: chunk.cz * CW, celulas: new Map() });
    sujo = true;
  }
  const anterior = world.listeners.models;
  const ouvinte = (chunk, models) => { anterior?.(chunk, models); if (!models) { if (porPedaco.delete(chunk.key)) sujo = true; } else receber(chunk); };
  world.listeners.models = ouvinte;
  for (const c of world.chunks.values()) if (c.hasMesh) receber(c);

  function laminas(ped, i) {
    let out = ped.celulas.get(i);
    if (out) return out;
    const l = ped.lawn, o = i * PASSO_RELVA;
    const cx = l[o] & 15, cz = (l[o] >> 4) & 15, marca = (l[o] >> 8) & 1, copa = (l[o] >> 9) & 7, y = l[o + 1], forma = l[o + 2], luz = l[o + 3], clima = l[o + 4];
    const wx = ped.ox + cx, wz = ped.oz + cz;
    const h0 = hash3(wx, y, wz), fu = (h0 & 1023) / 1023, fv = ((h0 >>> 10) & 1023) / 1023;
    const ceu = (luz & 15) / 15, lamp = (luz >> 4) / 15, temp = (clima & 255) / 255, umid = (clima >> 8) / 255;
    // debaixo da copa a grama rareia: sobra o chão de folha seca (materials.js, "Chão fotografado")
    const quantas = Math.round(POR_CELULA * (copa === 0 ? 1 : copa === 1 ? 0.6 : copa === 2 ? 0.38 : 0.22) * (ceu >= 0.5 ? 1 : 0.4));
    out = new Float32Array(quantas * PASSO);
    let n = 0;
    for (let k = 0; k < quantas; k++) {
      // posição k da sequência R2 dentro da célula, deslocada por célula: sem grade à vista e sem emenda entre vizinhas
      let pu = (fu + (k + 1) * R2A) % 1, pv = (fv + (k + 1) * R2B) % 1;
      if (marca === RELVA_TRONCO && (pu - 0.5) * (pu - 0.5) + (pv - 0.5) * (pv - 0.5) < 0.2) continue;
      const alt = chaoRelva(forma, pu, pv);
      if (alt < 0) continue;
      const hk = hash3(wx * 131 + k, y, wz * 71 + k * 7);
      const r1 = (hk & 1023) / 1023, r2 = ((hk >>> 10) & 1023) / 1023, r3 = ((hk >>> 20) & 1023) / 1023;
      const x = wx + pu, z = wz + pv, m = mancha(x, z);
      const p = n * PASSO;
      out[p] = x; out[p + 1] = y + alt - 0.012; out[p + 2] = z;
      out[p + 3] = r1 * 6.2831853;
      out[p + 4] = (0.07 + 0.09 * r2 * r2) * (0.75 + 0.9 * m);                // altura: 5 a 26 cm, em manchas
      out[p + 5] = (k + r3) / POR_CELULA;                                     // ordem: as primeiras ficam até mais longe
      out[p + 6] = r3;
      out[p + 7] = 0.25 + 0.75 * r2 * r1;                                     // tombo
      out[p + 8] = ceu; out[p + 9] = lamp; out[p + 10] = temp; out[p + 11] = umid;
      n++;
    }
    out = out.subarray(0, n * PASSO);
    ped.celulas.set(i, out);
    return out;
  }

  // ---- remontar: copia para a placa as lâminas das células no alcance ------------------------------------------------
  const centro = new THREE.Vector3(1e9, 0, 1e9), olho = new THREE.Vector3();
  const stats = { laminas: 0, celulas: 0, ms: 0 };
  function remontar() {
    const t0 = performance.now();
    sujo = false; centro.copy(olho);
    const R = RAIO + 1.5, R2 = R * R;
    let n = 0, cel = 0;
    const partes = [];
    for (const ped of porPedaco.values()) {
      // pedaço fora do alcance: pula inteiro
      const dx = Math.max(ped.ox - olho.x, 0, olho.x - (ped.ox + CW)), dz = Math.max(ped.oz - olho.z, 0, olho.z - (ped.oz + CW));
      if (dx * dx + dz * dz > R2) continue;
      const l = ped.lawn;
      for (let i = 0, o = 0; o < l.length; i++, o += PASSO_RELVA) {
        const x = ped.ox + (l[o] & 15) + 0.5, z = ped.oz + ((l[o] >> 4) & 15) + 0.5, y = l[o + 1] + 1;
        const ex = x - olho.x, ey = y - olho.y, ez = z - olho.z, d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > R2) continue;
        const dens = densidadeRelva(CHEIO, RAIO, Math.max(0, Math.sqrt(d2) - 2.6));
        if (dens <= 0) continue;
        const lam = laminas(ped, i), total = lam.length / PASSO;
        const k = Math.min(total, Math.ceil(total * Math.min(1, dens * 1.14 + 0.02)));
        if (k <= 0) continue;
        partes.push(lam, k); n += k; cel++;
      }
    }
    capacidade(n);
    let p = 0;
    for (let i = 0; i < partes.length; i += 2) { const lam = partes[i], k = partes[i + 1] * PASSO; dados.set(k === lam.length ? lam : lam.subarray(0, k), p); p += k; }
    inter.needsUpdate = true;
    if (inter.clearUpdateRanges) { inter.clearUpdateRanges(); inter.addUpdateRange(0, p); }
    geo.instanceCount = n;
    mesh.visible = n > 0;
    stats.laminas = n; stats.celulas = cel; stats.ms = performance.now() - t0;
  }

  let espera = 0;
  game.hooks.frame.push((dt) => {
    if (!corFeita) cor();
    camera.getWorldPosition(olho);
    const dim = game.dim;
    const vale = dim === 0 || dim === undefined;      // só no plano normal por enquanto
    if (!vale) { mesh.visible = false; return; }
    const p = player?.pos;
    uni.uPisa.value[0].set(p ? p[0] : 0, p ? p[1] : -999, p ? p[2] : 0, p && !player.flying ? 0.75 : 0.001);
    espera -= dt;
    const andou = Math.hypot(olho.x - centro.x, olho.y - centro.y, olho.z - centro.z) > 1.3;
    if ((sujo && espera <= 0) || andou) { remontar(); espera = 0.2; }
  });

  const api = {
    stats,
    get laminas() { return stats.laminas; },
    dispose() { if (world.listeners.models === ouvinte) world.listeners.models = anterior; scene.remove(mesh); geo.dispose(); material.dispose(); },
  };
  game.relva = api;
  return api;
}
