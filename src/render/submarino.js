// LAVRA — visão submarina, linha d'água dividida (split waterline), menisco, cáusticas e god rays submersos.
// Adaptado de dgreenheck/tidewater (src/post/Underwater.js, src/ocean/Caustics.js,
// src/ocean/UnderwaterLighting.js, MIT License — Copyright (c) Dan Greenheck).

import { SEA } from '../../shared/constants.js';
import { LEVEL } from '../../shared/blocks.js';
import {
  NIVEL_MAR_REPOUSO,
  PADRAO_VENTO,
  alturaOnda,
  normalOnda,
  ondaCompleta,
  normalizarVento,
} from '../../shared/ondas.js';

export const UW_IOR = 1.333;
export const UW_STRADDLE = 0.44;     // alcance vertical (m) em que a superfície cruza a lente (near plane)
export const UW_BAND = 12;           // meia-largura máxima do menisco em pixels
export const UW_LENS_DIST = 0.24;    // distância efetiva da lente virtual para a linha d'água

// Coeficientes físicos de absorção e espalhamento (Beer-Lambert) do Tidewater (1/m):
// O vermelho é absorvido nos primeiros metros (~2.5 m), o verde alcança ~14 m (turquesa)
// e o azul penetra mais fundo (~30 m, azul oceânico escuro).
export const WATER_ABSORPTION = Object.freeze([0.38, 0.072, 0.032]);
export const WATER_SCATTERING = Object.freeze([0.014, 0.025, 0.034]);

// Mede a profundidade local da coluna d'água em blocos (0..7) usando getBlock quando disponível.
export function medirProfundidadeAgua(getBlock, x, z, seaLevel = NIVEL_MAR_REPOUSO) {
  if (typeof getBlock !== 'function') return 7;
  const fx = Math.floor(x);
  const fz = Math.floor(z);
  const topY = Math.floor(seaLevel);
  let depth = 0;
  for (let dy = 0; dy < 7; dy++) {
    const b = getBlock(fx, topY - dy, fz);
    if (b > 0 && LEVEL[b] > 0) depth += 1;
    else if (dy === 0) {
      // Na beira imediata da praia, verifica os 4 vizinhos horizontais para não cortar a onda no menisco
      let near = 0;
      if (LEVEL[getBlock(fx + 1, topY, fz)] > 0) near++;
      if (LEVEL[getBlock(fx - 1, topY, fz)] > 0) near++;
      if (LEVEL[getBlock(fx, topY, fz + 1)] > 0) near++;
      if (LEVEL[getBlock(fx, topY, fz - 1)] > 0) near++;
      if (near === 0) return 0;
      depth += 0.6;
    } else break;
  }
  return Math.min(7, depth);
}

// Avalia a altura da câmera em relação à onda real (Tidewater WaterQuery + Underwater.js).
export function avaliarSuperficieCamera(camPos, time = 0, wind = PADRAO_VENTO, seaLevel = NIVEL_MAR_REPOUSO, stateUnderwater = false, getBlock = null) {
  const cx = Number.isFinite(camPos?.x) ? camPos.x : 0;
  const cy = Number.isFinite(camPos?.y) ? camPos.y : SEA + 2;
  const cz = Number.isFinite(camPos?.z) ? camPos.z : 0;
  const hasSea = Number.isFinite(seaLevel) && seaLevel > -1e3;

  // Tanque, rio ou lago acima do nível do mar quando wetAt acusa submerso
  if (stateUnderwater && (!hasSea || cy > seaLevel + 1.4)) {
    const poolSurface = Math.floor(cy) + 0.88;
    const camH = cy - poolSurface;
    return {
      hasWater: true,
      baseSea: poolSurface,
      waveDy: 0,
      waterY: poolSurface,
      camH,
      camDepth: Math.max(0, -camH),
      waveDepth: 0.35,
      normal: { x: 0, y: 1, z: 0 },
      straddling: Math.abs(camH) < UW_STRADDLE,
      submerged: true,
      active: true,
      mode: Math.abs(camH) < UW_STRADDLE ? 1 : 2,
    };
  }

  if (!hasSea) {
    return {
      hasWater: false,
      baseSea: -1e4,
      waveDy: 0,
      waterY: -1e4,
      camH: 100,
      camDepth: 0,
      waveDepth: 0,
      normal: { x: 0, y: 1, z: 0 },
      straddling: false,
      submerged: false,
      active: false,
      mode: 0,
    };
  }

  let waveDepth = 7;
  let nearWaterBlock = true;
  if (typeof getBlock === 'function' && Math.abs(cy - seaLevel) < 2.5) {
    waveDepth = medirProfundidadeAgua(getBlock, cx, cz, seaLevel);
    nearWaterBlock = stateUnderwater || waveDepth > 0;
  }

  let onda = ondaCompleta(cx, cz, time, wind, Math.max(waveDepth, stateUnderwater ? 2.5 : 0));
  // mar do arquipélago (render/oceano.js): a superfície é a das ondas de shared/mar.js, as mesmas que a tela desenha
  const mar = globalThis.LAVRA?.game?.mar;
  if (mar?.ligado) { const y = mar.altura(cx, cz); if (Number.isFinite(y)) onda = { dy: y - seaLevel, nx: 0, ny: 1, nz: 0 }; }
  const waterY = seaLevel + onda.dy;
  const camH = cy - waterY;
  const straddling = nearWaterBlock && Math.abs(camH) < UW_STRADDLE;
  const submerged = stateUnderwater || (nearWaterBlock && camH < 0);
  const active = submerged || straddling;
  // mode: 0 = ar puro, 1 = cruzando a superfície (split waterline), 2 = totalmente submerso
  const mode = !active ? 0 : straddling ? 1 : 2;

  return {
    hasWater: nearWaterBlock,
    baseSea: seaLevel,
    waveDy: onda.dy,
    waterY,
    camH,
    camDepth: Math.max(0, -camH),
    waveDepth: Math.max(waveDepth, stateUnderwater ? 2.5 : 0),
    normal: { x: onda.nx, y: onda.ny, z: onda.nz },
    straddling,
    submerged,
    active,
    mode,
  };
}

// Calcula a cor de equilíbrio da coluna d'água e a atenuação da luz com a profundidade (Beer-Lambert).
// Usado tanto pelo atmosphere.js (incluindo fallback sem post em VR / perfil baixo) quanto por testes.
// Em águas rasas predomina o turquesa brilhante (verde+azul); em águas profundas o verde decai antes
// do azul e a cor migra para azul oceânico escuro.
export function corNevoaSubmarina(camDepth = 0, lightDir = { x: 0, y: 1, z: 0 }, sunColor = { x: 1, y: 1, z: 1 }, ambSky = { x: 0.3, y: 0.4, z: 0.6 }, dayK = 1) {
  const zc = Math.max(0, Number.isFinite(camDepth) ? camDepth : 0);
  const sigA = WATER_ABSORPTION;
  const sigS = WATER_SCATTERING;
  const sigT = [sigA[0] + sigS[0], sigA[1] + sigS[1], sigA[2] + sigS[2]];

  // Direção do sol refratada na água (lei de Snell, IOR = 1.333)
  const ly = Math.max(-1, Math.min(1, Number.isFinite(lightDir?.y) ? lightDir.y : 0.8));
  const sinAir = Math.sqrt(Math.max(0, 1 - ly * ly));
  const sinWater = sinAir / UW_IOR;
  const mu = Math.max(0.18, Math.sqrt(Math.max(0, 1 - sinWater * sinWater)));

  // Atenuação da luz solar e celeste até a profundidade zc (UnderwaterLighting.js)
  const attSun = [
    Math.exp(-sigT[0] * zc / mu),
    Math.exp(-sigT[1] * zc / mu),
    Math.exp(-sigT[2] * zc / mu),
  ];
  const attAmb = [
    Math.exp(-sigT[0] * zc * 1.15) * 0.88,
    Math.exp(-sigT[1] * zc * 1.15) * 0.92 + 0.025 * Math.exp(-zc * 0.08),
    Math.exp(-sigT[2] * zc * 1.15) * 0.95 + 0.055 * Math.exp(-zc * 0.07),
  ];

  // Albedo de espalhamento simples + múltiplo na coluna d'água
  const alb = [
    sigS[0] / sigT[0],
    sigS[1] / sigT[1],
    sigS[2] / sigT[2],
  ];

  const sx = Number.isFinite(sunColor?.x) ? sunColor.x : 1;
  const sy = Number.isFinite(sunColor?.y) ? sunColor.y : 1;
  const sz = Number.isFinite(sunColor?.z) ? sunColor.z : 1;
  const ax = Number.isFinite(ambSky?.x) ? ambSky.x : 0.3;
  const ay = Number.isFinite(ambSky?.y) ? ambSky.y : 0.4;
  const az = Number.isFinite(ambSky?.z) ? ambSky.z : 0.6;
  const dk = Math.max(0.15, Math.min(1, Number.isFinite(dayK) ? dayK : 1));

  // Transição turquesa raso -> azul profundo conforme zc aumenta
  const deepK = 1 - Math.exp(-zc * 0.11);
  const shallowTurquoise = [0.025 * dk, 0.24 * dk, 0.30 * dk];
  const deepOceanBlue = [0.004 * dk, 0.032 * dk, 0.105 * dk];

  const scatterR = (sx * 0.26 * attSun[0] + ax * 1.65 * attAmb[0]) * alb[0] * 1.4;
  const scatterG = (sy * 0.32 * attSun[1] + ay * 1.95 * attAmb[1]) * alb[1] * 2.35;
  const scatterB = (sz * 0.34 * attSun[2] + az * 2.15 * attAmb[2]) * alb[2] * 2.65;

  const baseR = shallowTurquoise[0] * (1 - deepK) + deepOceanBlue[0] * deepK;
  const baseG = shallowTurquoise[1] * (1 - deepK) + deepOceanBlue[1] * deepK;
  const baseB = shallowTurquoise[2] * (1 - deepK) + deepOceanBlue[2] * deepK;

  return {
    r: scatterR * 0.65 + baseR * 0.75,
    g: scatterG * 0.65 + baseG * 0.85,
    b: scatterB * 0.65 + baseB * 0.95,
    attSun,
    attAmb,
    deepK,
  };
}

// Funções GLSL 300 es compartilhadas entre o passe de god-rays/cáusticas (UW_SHAFTS_FS) e o composite final
export const UW_COMMON_GLSL = /* glsl */`
const float UW_IOR = 1.333;
const float UW_STRADDLE = 0.44;
const int UW_BAND = 12;
const float UW_PI = 3.141592653589793;
const vec3 UW_SIG_A = vec3(0.38, 0.072, 0.032);
const vec3 UW_SIG_S = vec3(0.014, 0.025, 0.034);
const vec3 UW_SIG_T = vec3(0.394, 0.097, 0.066);

uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec4 uProj;          // x = P[0][0], y = P[1][1], z = near, w = far
uniform float uLensDist;     // distância da lente virtual
uniform float uBaseSea;      // nível de repouso da água (SEA + 0.88)
uniform float uWaterY;       // altura da onda exatamente na câmera
uniform float uWaveDepth;    // profundidade local em blocos (0..7)
uniform float uUwMode;       // 0 = ar, 1 = linha d'água dividida (straddle), 2 = submerso
uniform float uUwBand;       // meia-largura do menisco em pixels
uniform vec2 uResolution;    // largura e altura do framebuffer em pixels

// Profundidade WebGL padrão [0, 1] -> Z no espaço da câmera (negativo à frente)
float underwaterViewZ(float d) {
  float n = uProj.z;
  float f = uProj.w;
  return -(n * f) / max(f - d * (f - n), 1e-5);
}

// Raio no espaço da câmera para uv de tela (z = -1)
vec3 underwaterViewRay(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x / max(uProj.x, 1e-4), ndc.y / max(uProj.y, 1e-4), -1.0);
}

vec3 underwaterWorldDir(vec2 uv) {
  return normalize(mat3(uCamWorld) * underwaterViewRay(uv));
}

float uwAtenBanda(float prof, float profMin) {
  if (prof <= 0.35) return 0.0;
  float base = smoothstep(0.35, profMin * 1.45, prof);
  float shoal = 1.0 + 0.18 * smoothstep(0.6, 1.8, prof) * (1.0 - smoothstep(1.8, 4.2, prof));
  return base * shoal;
}

// Espelho exato em GLSL 300 es de alturaOnda / ondaCompleta em public/shared/ondas.js (6 bandas Gerstner)
float uwWaveHeightAndSlope(vec2 xz, out vec2 slope) {
  slope = vec2(0.0);
  if (uWaveDepth <= 0.35) return 0.0;
  float env = smoothstep(0.35, 4.6, uWaveDepth);
  vec2 w = uWind.xy;
  float wl = dot(w, w);
  w = wl > 1e-6 ? w * inversesqrt(wl) : vec2(0.833666, 0.552269);
  float wz = clamp(uWind.z, 0.0, 2.5);
  float energy = clamp((wz - 0.35) / 1.45, 0.0, 1.0);
  float ampScale = (0.42 + 0.88 * energy) * env;
  float speedScale = 0.78 + 0.34 * energy;

  const float COMP[6] = float[6](28.0, 17.5, 10.8, 6.4, 3.7, 2.3);
  const float AMP[6]  = float[6](0.135, 0.088, 0.056, 0.034, 0.019, 0.011);
  const float ANG[6]  = float[6](0.14, -0.31, 0.42, -0.58, 0.25, -0.84);
  const float FASE[6] = float[6](0.00, 1.37, 2.71, 4.09, 5.13, 0.89);
  const float PMIN[6] = float[6](3.2, 2.4, 1.6, 1.1, 0.7, 0.45);

  float dy = 0.0;
  for (int i = 0; i < 6; i++) {
    float att = uwAtenBanda(uWaveDepth, PMIN[i]);
    if (att <= 1e-5) continue;
    float ca = cos(ANG[i]);
    float sa = sin(ANG[i]);
    vec2 dir = vec2(w.x * ca - w.y * sa, w.x * sa + w.y * ca);
    float k = 6.28318530718 / COMP[i];
    float omega = sqrt(9.81 * k) * speedScale;
    float A = AMP[i] * ampScale * att;
    float theta = k * dot(dir, xz) - omega * uTime + FASE[i];
    float s = sin(theta);
    float c = cos(theta);
    dy += A * (s + 0.16 * (s * s - 0.5));
    slope += (k * A * c * (1.0 + 0.32 * s)) * dir;
  }
  return clamp(dy, -0.48, 0.48);
}

float uwWaveFast(vec2 xz) {
  vec2 sl;
  return uwWaveHeightAndSlope(xz, sl);
}

// Rede de cáusticas focalizadas por refração solar nas ondas (adaptado de Tidewater Caustics.js):
// Combina duas cascatas (fina em 2 planos focais 1.2m / 4.0m e larga em 3.0m / 9.0m) com dispersão cromática.
float uwCausticCell(vec2 p, float t) {
  vec2 a = sin(p * vec2(1.75, 1.45) + vec2(t * 0.9, -t * 0.7) + sin(p.yx * 1.2 - t * 0.55) * 0.65);
  vec2 b = cos(p * vec2(2.35, -1.95) - vec2(t * 0.8, t * 1.05) + cos(p.yx * 1.6 + t * 0.6) * 0.55);
  float fold = abs(a.x * b.y - a.y * b.x);
  return 1.0 / (1.0 + fold * 5.2);
}

vec3 causticsSample(vec3 P, float depth, vec2 slope, bool chromatic) {
  if (depth <= 0.02 || depth > 32.0) return vec3(1.0);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 Ls = refract(-uLightDir, n, 1.0 / UW_IOR);
  float tDown = max(-Ls.y, 0.15);
  vec2 entry = P.xz - Ls.xz * (depth / tDown);

  float wD = clamp((depth - 1.2) / 2.8, 0.0, 1.0);
  float t = uTime * 1.15;
  vec2 uvF = entry * 0.72;
  float fShallow = uwCausticCell(uvF, t) * 1.65;
  float fDeep = uwCausticCell(uvF * 0.62 + 3.7, t * 0.82) * 1.55;
  float g = mix(fShallow, fDeep, wD);
  float r = g;
  float b = g;

  if (chromatic) {
    // Dispersão cromática do Tidewater (Caustics.js l.245): cada canal pousa levemente deslocado na direção do sol
    vec2 disp = normalize(Ls.xz + vec2(1e-4, 0.0)) * min(depth * 0.022, 0.18);
    float rS = uwCausticCell(uvF + disp, t) * 1.65;
    float rD = uwCausticCell((uvF + disp) * 0.62 + 3.7, t * 0.82) * 1.55;
    float bS = uwCausticCell(uvF - disp, t) * 1.65;
    float bD = uwCausticCell((uvF - disp) * 0.62 + 3.7, t * 0.82) * 1.55;
    r = mix(rS, rD, wD);
    b = mix(bS, bD, wD);
  }

  float broad = mix(0.65, 1.45, uwCausticCell(entry * 0.24 - 7.1, t * 0.55));
  vec3 c = vec3(r, g, b) * mix(1.0, broad, 0.58);
  float k = smoothstep(0.03, 0.55, depth) * exp(-depth * 0.065) * 0.85;
  return mix(vec3(1.0), c, k);
}

float causticsSampleShaft(vec3 P, float depth) {
  return causticsSample(P, depth, vec2(0.0), false).g;
}
`;

// Passe em meia resolução (Underwater.js _shaftCode): ray-marching de feixes volumétricos de cáusticas
// e god rays submersos vindos da superfície. RGB = luz espalhada no raio, A = distância da cena (para upsample bilateral).
export const UW_SHAFTS_FS = /* glsl */`
precision highp float;
uniform sampler2D tDepth;
uniform vec3 uLightDir;
uniform vec3 uSunColor;
uniform vec3 uAmbSky;
uniform vec3 uWind;
uniform float uTime;
${UW_COMMON_GLSL}
in vec2 vUv;
out vec4 outColor;

float uwIgn(vec2 px) {
  return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
}

void main() {
  float d = texture(tDepth, vUv).r;
  float vz = -underwaterViewZ(d);
  vec3 ray = underwaterViewRay(vUv);
  float rayLen = length(ray);
  float dist = max(min(rayLen * vz, 180.0) - uLensDist * rayLen, 0.0);
  vec3 dir = normalize(mat3(uCamWorld) * ray);

  // Quando o raio aponta para cima, o percurso dentro d'água termina na superfície da onda
  float zc = max(uWaterY - uCamPos.y, 0.0);
  float waterDist = dir.y > 0.002 ? min(dist, max(zc, 0.25) / dir.y) : dist;

  vec3 Ls = -refract(-uLightDir, vec3(0.0, 1.0, 0.0), 1.0 / UW_IOR);
  float mu = max(Ls.y, 0.18);
  float cosPh = dot(dir, Ls);
  float g = 0.85;
  float phase = (1.0 - g * g) / (4.0 * UW_PI) / pow(max(1.0 + g * g - cosPh * 2.0 * g, 1e-4), 1.5) * 0.75 + 0.25 / (4.0 * UW_PI);

  vec3 sunE = uSunColor * 0.96 + uAmbSky * 0.35;
  vec3 shafts = vec3(0.0);

  const int STEPS = 16;
  float maxD = min(waterDist, 22.0);
  if (maxD > 0.02) {
    float ds = maxD / float(STEPS);
    float jitter = uwIgn(gl_FragCoord.xy + fract(uTime * 1.37) * 64.0);
    for (int i = 0; i < STEPS; i++) {
      float s = (float(i) + jitter) * ds;
      vec3 p = uCamPos + dir * s;
      float surfH = uBaseSea + uwWaveFast(p.xz);
      float z = surfH - p.y;
      if (z <= 0.0) continue;
      float caus = causticsSampleShaft(p, z);
      vec3 Tl = exp(-UW_SIG_T * (s + z / mu));
      shafts += max(caus - 0.82, 0.0) * Tl * ds;
    }
    // Reforço direcional dos god rays quando olhando para cima / direção do sol refratado
    float upRay = 1.0 + 1.35 * smoothstep(-0.1, 0.75, dir.y);
    shafts *= sunE * UW_SIG_S * (phase * 1.4 + 0.055) * 3.4 * upRay;
  }

  outColor = vec4(max(shafts, vec3(0.0)), waterDist);
}
`;

// Composite da linha d'água dividida (menisco + lente cilíndrica) e meio participante submarino
// (Beer-Lambert + single/multiple scattering + upsample bilateral dos god rays + cáusticas no fundo).
export const UW_COMPOSITE_GLSL = /* glsl */`
uniform sampler2D tDepth;
uniform sampler2D tUwShafts;
uniform float uHasUwShafts;
${UW_COMMON_GLSL}

// Diferença vertical (metros) entre a onda na lente e o ponto do raio no plano da lente:
// > 0 = pixel abaixo da superfície da onda (água), < 0 = pixel acima da superfície (ar).
float uwLensDiff(vec2 uv) {
  vec3 ray = underwaterViewRay(uv);
  vec3 rayW = mat3(uCamWorld) * ray;
  vec3 lensP = uCamPos + rayW * uLensDist;
  vec2 slope;
  float waveH = uwWaveHeightAndSlope(lensP.xz, slope);
  // Micro-ondulação capilar da água aderida ao vidro da lente
  float cap = sin(uv.x * 26.0 + uTime * 2.3) * 0.0022 + cos(uv.x * 43.0 - uTime * 3.1) * 0.0011;
  float surfY = uBaseSea + waveH + cap;
  return surfY - lensP.y;
}

float uwMediumAt(vec2 uv) {
  if (uUwMode < 0.5) return 0.0;
  if (uUwMode > 1.5) return 1.0;
  return uwLensDiff(uv) > 0.0 ? 1.0 : 0.0;
}

// Integral analítica de espalhamento (in-scattering) ao longo do raio submarino (Underwater.js _uwLit):
// Ambos os expoentes permanecem <= 0 dentro d'água, evitando overflow/NaN ao olhar para cima do fundo.
vec3 uwLitIntegral(float m, vec3 sigT, float zc, float dirY, float dist) {
  vec3 a = sigT * (zc / m);
  vec3 kk = sigT * (1.0 - dirY / m);
  vec3 e0 = exp(-a);
  vec3 e1 = exp(-max(a + kk * dist, vec3(0.0)));
  vec3 safeK = sign(kk + vec3(1e-8)) * max(abs(kk), vec3(1e-4));
  vec3 ratio = (e0 - e1) / safeK;
  vec3 linear = e0 * dist;
  return vec3(
    abs(kk.x) < 1e-4 ? linear.x : ratio.x,
    abs(kk.y) < 1e-4 ? linear.y : ratio.y,
    abs(kk.z) < 1e-4 ? linear.z : ratio.z
  );
}

// Aplica a linha d'água dividida, o menisco refrativo e o meio óptico submarino do Tidewater.
// Retorna a cor HDR linear e escreve em outUnderMask (0 = ar, 1 = água) para vinheta/ajuste fino.
vec3 underwaterComposite(vec2 uv, out float outUnderMask) {
  outUnderMask = 0.0;
  if (uUwMode < 0.5) {
    return texture(tScene, uv).rgb;
  }

  float diffHere = uwLensDiff(uv);
  float here = uUwMode > 1.5 ? 1.0 : (diffHere > 0.0 ? 1.0 : 0.0);
  // Suavização sub-pixel da cobertura na fronteira da linha d'água
  float underWeight = uUwMode > 1.5 ? 1.0 : smoothstep(-0.0018, 0.0018, diffHere);

  // Busca vertical em pixels até a linha d'água na lente (Underwater.js l.337-352)
  float lineDist = 1e4;
  float lineDir = 0.0;
  float invH = 1.0 / max(uResolution.y, 1.0);
  if (uUwMode < 1.5) {
    float mUpFar = uwMediumAt(clamp(uv + vec2(0.0, float(UW_BAND) * invH), vec2(0.0), vec2(1.0)));
    float mDnFar = uwMediumAt(clamp(uv - vec2(0.0, float(UW_BAND) * invH), vec2(0.0), vec2(1.0)));
    float mUpMid = uwMediumAt(clamp(uv + vec2(0.0, 6.0 * invH), vec2(0.0), vec2(1.0)));
    float mDnMid = uwMediumAt(clamp(uv - vec2(0.0, 6.0 * invH), vec2(0.0), vec2(1.0)));
    float flips = abs(mUpFar - here) + abs(mDnFar - here) + abs(mUpMid - here) + abs(mDnMid - here);
    if (flips > 0.5) {
      float prevUpDiff = diffHere;
      float prevDnDiff = diffHere;
      for (int i = 1; i <= UW_BAND; i++) {
        float dy = float(i) * invH;
        float dUp = uwLensDiff(clamp(uv + vec2(0.0, dy), vec2(0.0), vec2(1.0)));
        float dDn = uwLensDiff(clamp(uv - vec2(0.0, dy), vec2(0.0), vec2(1.0)));
        bool crossUp = (dUp > 0.0) != (diffHere > 0.0);
        bool crossDn = (dDn > 0.0) != (diffHere > 0.0);
        if (lineDist > 1e3 && (crossUp || crossDn)) {
          float frac = crossUp
            ? abs(prevUpDiff) / max(abs(prevUpDiff - dUp), 1e-5)
            : abs(prevDnDiff) / max(abs(prevDnDiff - dDn), 1e-5);
          lineDist = float(i - 1) + clamp(frac, 0.0, 1.0);
          lineDir = crossUp ? 1.0 : -1.0;
        }
        prevUpDiff = dUp;
        prevDnDiff = dDn;
      }
    }
  }

  // ---- Banda do menisco: borda arredondada da água na lente agindo como lente cilíndrica (Underwater.js l.356-360)
  float bandW = max(uUwBand, 2.0);
  float tBand = clamp(lineDist / bandW, 0.0, 1.0);
  float bendPx = tBand * sqrt(max(1.0 - tBand * tBand, 0.0)) * bandW * 0.82;
  vec2 uvB = uv - vec2(0.0, lineDir * bendPx * invH);

  // Distorção suave da tela na parte submersa (enfraquece junto ao menisco para preservar a borda nítida)
  if (underWeight > 0.01) {
    float meniscusClear = smoothstep(1.5, bandW, lineDist);
    float lookK = 0.45 + 0.55 * smoothstep(-0.1, 0.72, uLookUp);
    vec2 flow = uWind.xy;
    vec2 waveWarp = vec2(
      sin(uv.y * 4.2 + uTime * 0.75 + flow.x) + 0.3 * sin(uv.y * 10.5 - uTime * 1.3),
      cos(uv.x * 3.8 + uTime * 0.62 + flow.y) + 0.3 * cos(uv.x * 9.2 + uTime * 1.1)
    );
    uvB += underWeight * meniscusClear * lookK * (0.0024 + 0.0032 * clamp(uWind.z, 0.0, 1.6)) * waveWarp;
  }
  uvB = clamp(uvB, vec2(0.001), vec2(0.999));
  vec3 base = texture(tScene, uvB).rgb;
  vec3 result = base;

  if (underWeight > 0.001) {
    float d = texture(tDepth, uvB).r;
    float vz = -underwaterViewZ(d);
    vec3 ray = underwaterViewRay(uvB);
    float rayLen = length(ray);
    float dist = max(min(rayLen * vz, 220.0) - uLensDist * rayLen, 0.0);
    vec3 dir = normalize(mat3(uCamWorld) * ray);

    // Profundidade da câmera abaixo da superfície da onda (zc)
    float zc = max(uWaterY - uCamPos.y, 0.05);
    // Raios que sobem em direção à janela de Snell só atravessam água até a superfície
    float waterDist = dir.y > 0.002 ? min(dist, max(zc, 0.25) / dir.y) : dist;

    // Cáusticas com dispersão cromática projetadas sobre a geometria submersa próxima (Caustics.js + UnderwaterLighting.js)
    if (d < 0.9999 && dist < 30.0) {
      vec3 hitP = uCamPos + dir * dist;
      vec2 hitSlope;
      float hitWave = uwWaveHeightAndSlope(hitP.xz, hitSlope);
      float hitDepth = max(uBaseSea + hitWave - hitP.y, 0.0);
      if (hitDepth > 0.02) {
        vec3 surfCaust = causticsSample(hitP, hitDepth, hitSlope, true);
        float sunReach = exp(-hitDepth * 0.09) * smoothstep(30.0, 4.0, dist);
        base *= mix(vec3(1.0), surfCaust, sunReach * 0.48);
      }
    }

    vec3 Ls = -refract(-uLightDir, vec3(0.0, 1.0, 0.0), 1.0 / UW_IOR);
    float mu = max(Ls.y, 0.18);
    float cosPh = dot(dir, Ls);
    float g = 0.85;
    float phase = (1.0 - g * g) / (4.0 * UW_PI) / pow(max(1.0 + g * g - cosPh * 2.0 * g, 1e-4), 1.5) * 0.75 + 0.25 / (4.0 * UW_PI);

    vec3 sunE = uSunColor * 0.96;
    vec3 ambE = uAmbSky * (UW_PI * 1.05);

    vec3 bb = UW_SIG_S * 0.04;
    vec3 msAlb = bb * 1.35 / (UW_SIG_A + bb);
    vec3 inSun = sunE * (UW_SIG_S * phase + msAlb * UW_SIG_T * (1.0 / UW_PI)) * uwLitIntegral(mu, UW_SIG_T, zc, dir.y, waterDist);
    vec3 inAmb = ambE * (UW_SIG_S * (1.0 / (4.0 * UW_PI)) + msAlb * UW_SIG_T * (1.0 / UW_PI)) * uwLitIntegral(0.8, UW_SIG_T, zc, dir.y, waterDist);

    // Gradiente de profundidade Tidewater: turquesa luminoso perto da superfície -> azul oceânico escuro no fundo
    float deepK = 1.0 - exp(-zc * 0.10);
    float dayLum = clamp(dot(uAmbSky, vec3(0.33, 0.5, 0.6)) * 2.4 + max(uLightDir.y, 0.0) * 0.35, 0.08, 1.15);
    vec3 turquoiseVeil = vec3(0.018, 0.19, 0.24) * dayLum * exp(-zc * 0.07);
    vec3 deepAbyssBlue = vec3(0.003, 0.024, 0.078) * dayLum;
    vec3 columnTint = mix(turquoiseVeil, deepAbyssBlue, deepK) * (1.0 - exp(-waterDist * 0.065));

    // Upsample bilateral (sensível à profundidade) dos god rays / feixes de cáusticas em meia resolução (Underwater.js l.401-418)
    vec3 extraShafts = vec3(0.0);
    if (uHasUwShafts > 0.5) {
      ivec2 ls = textureSize(tUwShafts, 0);
      vec2 pa = uvB * vec2(ls) - 0.5;
      vec2 q0 = floor(pa);
      vec2 fr = pa - q0;
      vec3 acc = vec3(0.0);
      float wSum = 1e-6;
      for (int k = 0; k < 4; k++) {
        ivec2 o = ivec2(k & 1, k >> 1);
        ivec2 tc = clamp(ivec2(q0) + o, ivec2(0), ls - ivec2(1));
        vec4 sm = texelFetch(tUwShafts, tc, 0);
        float wb = (o.x == 1 ? fr.x : 1.0 - fr.x) * (o.y == 1 ? fr.y : 1.0 - fr.y);
        float rel = abs(sm.w - waterDist) / max(waterDist, 0.5);
        float rw = rel * 10.0 + 1.0;
        float wt = wb / (rw * rw) + 1e-5;
        acc += sm.rgb * wt;
        wSum += wt;
      }
      extraShafts = acc / wSum;
    }

    vec3 T = exp(-UW_SIG_T * waterDist);
    vec3 uwCol = base * T + inSun + inAmb + columnTint + extraShafts;
    result = mix(base, uwCol, underWeight);
    outUnderMask = underWeight;
  }

  // Linha de contato escura do menisco e borda brilhante refratada (Underwater.js l.425-428)
  if (lineDist < bandW) {
    float line = smoothstep(2.1, 0.0, lineDist);
    float rim = smoothstep(bandW, bandW * 0.38, lineDist) * smoothstep(0.4, 2.4, lineDist);
    vec3 rimLight = uAmbSky * 2.5 + uSunColor * 0.04;
    result = result * (1.0 - line * 0.55) + rim * 0.16 * rimLight;
  }

  return result;
}
`;
