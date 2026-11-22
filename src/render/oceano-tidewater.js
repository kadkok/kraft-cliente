// LAVRA — Shaders GLSL 300 es do oceano, espuma costeira, cáusticas e areia da praia/fundo.
// Adaptado de dgreenheck/tidewater (MIT License — Copyright (c) Dan Greenheck).
//
// Módulos do Tidewater (WebGPU/WGSL) traduzidos aqui para WebGL2 (GLSL 300 es):
//   - src/ocean/WaterMaterial.js  (Fresnel dielétrico exato, fase Henyey-Greenstein, absorção Beer-Lambert,
//                                  espalhamento múltiplo de Gordon, SSS nas cristas, janela de Snell submarina)
//   - src/ocean/WaterSurface.js   (cascata de ondas + atenuação por profundidade + reoriented normal mapping)
//   - src/ocean/SeaDetail.js      (rajadas "cat's paws", manchas calmas de surfactante/slicks e faixas de Langmuir/windrows)
//   - src/ocean/ShoreWaves.js     (empinamento costeiro por profundidade, parede côncava da onda quebrando, rolo turbulento e swash)
//   - src/ocean/Breakers.js       (crista arqueada e cortina branca da arrebentação)
//   - src/ocean/SurfFoam.js       (espuma rendada advectada em fase dupla + relevo 3D de espuma branca com auto-sombreamento)
//   - src/ocean/FoamTexture.js    (campo de densidade de espuma com bolhas Worley multi-escala e filamentos)
//   - src/ocean/Caustics.js       (cáusticas com refração pela inclinação das ondas, duplo plano focal e dispersão cromática)
//   - src/world/Terrain.js & TerrainShading.js & DetailTextures.js (areia de coral seca com ondulações de vento,
//                                  grãos de quartzo/concha, faixa de areia molhada escura/especular com swash e fundo ondulado)
//
// Nota sobre WebGL2 vs WebGPU:
// Onde o Tidewater usa compute shaders WebGPU (FFT 4-cascatas em OceanFFT.js e simulação 2D rasa em ShoreSim.js),
// usamos em WebGL2 a soma analítica de 6 bandas de ondas de Gerstner direcionais (idêntica a public/shared/ondas.js)
// combinada com cascata de derivadas FBM/Worley e campo analítico de fase costeira/swash.

export const TIDEWATER_VERTEX_GLSL = /* glsl */`
// Espelho exato de public/shared/ondas.js para o vertex shader (TERRAIN_VS sob #ifdef WATER).
vec3 twNormalizarVento(vec3 w) {
  float len2 = dot(w.xy, w.xy);
  vec2 dir = len2 > 1e-6 ? w.xy * inversesqrt(len2) : vec2(0.833666, 0.552269);
  return vec3(dir, clamp(w.z, 0.0, 2.5));
}

float twAtenProfundidade(float prof) {
  return prof <= 0.35 ? 0.0 : smoothstep(0.35, 4.6, prof);
}

float twAtenBanda(float prof, float profMin) {
  if (prof <= 0.35) return 0.0;
  float base = smoothstep(0.35, profMin * 1.45, prof);
  float shoal = 1.0 + 0.18 * smoothstep(0.6, 1.8, prof) * (1.0 - smoothstep(1.8, 4.2, prof));
  return base * shoal;
}

// Soma de ondas de Gerstner direcionais multi-banda:
// Devolve deslocamento (dx, dy, dz) e preenche normal analítica (outN), crista (outCrest) e espuma (outFoam).
vec3 twGerstnerVertex(vec3 wp, float prof, vec3 uWindVec, float t, out vec3 outN, out float outCrest, out float outFoam) {
  outN = vec3(0.0, 1.0, 0.0);
  outCrest = 0.0;
  outFoam = 0.0;
  float env = twAtenProfundidade(prof);
  if (env <= 0.0) return vec3(0.0);

  vec3 w = twNormalizarVento(uWindVec);
  float energy = clamp((w.z - 0.35) / 1.45, 0.0, 1.0);
  float ampScale = (0.42 + 0.88 * energy) * env;
  float speedScale = 0.78 + 0.34 * energy;

  // 6 bandas idênticas a BANDAS_GERSTNER em public/shared/ondas.js
  const float COMP[6]  = float[6](28.0, 17.5, 10.8, 6.4, 3.7, 2.3);
  const float AMP[6]   = float[6](0.135, 0.088, 0.056, 0.034, 0.019, 0.011);
  const float ANG[6]   = float[6](0.14, -0.31, 0.42, -0.58, 0.25, -0.84);
  const float STEEP[6] = float[6](0.52, 0.48, 0.44, 0.38, 0.32, 0.26);
  const float FASE[6]  = float[6](0.00, 1.37, 2.71, 4.09, 5.13, 0.89);
  const float ESP[6]   = float[6](0.35, 0.42, 0.48, 0.38, 0.28, 0.20);
  const float PMIN[6]  = float[6](3.2, 2.4, 1.6, 1.1, 0.7, 0.45);

#ifdef WAVE_CAP
  const int MAX_BANDS = 6;
#elif defined(WAVE_CHOP)
  const int MAX_BANDS = 4;
#else
  const int MAX_BANDS = 2;
#endif

  vec3 disp = vec3(0.0);
  vec2 dH = vec2(0.0);
  float jacobian = 1.0;
  float cristaAcum = 0.0;
  // Deslocamento horizontal suave apenas em água bem funda para nunca abrir fresta na borda de voxels
  float horizMask = smoothstep(1.8, 5.0, prof) * 0.32;

  for (int i = 0; i < MAX_BANDS; i++) {
    float att = twAtenBanda(prof, PMIN[i]);
    if (att <= 1e-5) continue;
    float ca = cos(ANG[i]), sa = sin(ANG[i]);
    vec2 dir = vec2(w.x * ca - w.y * sa, w.x * sa + w.y * ca);
    float k = 6.2831853 / COMP[i];
    float omega = sqrt(9.81 * k) * speedScale;
    float A = AMP[i] * ampScale * att;
    float Q = STEEP[i] * (0.65 + 0.35 * energy);

    float theta = k * dot(dir, wp.xz) - omega * t + FASE[i];
    float s = sin(theta);
    float c = cos(theta);

    float crestSharp = s + 0.16 * (s * s - 0.5);
    disp.xz -= (Q * A * c * horizMask) * dir;
    disp.y += A * crestSharp;

    float dCrest = c * (1.0 + 0.32 * s);
    dH += (k * A * dCrest) * dir;
    jacobian -= k * Q * A * s * ESP[i];
    cristaAcum += max(0.0, s) * ESP[i] * att;
  }

  disp.y = clamp(disp.y, -0.48, 0.48);
  outN = normalize(vec3(-dH.x, 1.0, -dH.y));
  outCrest = clamp(cristaAcum * (0.45 + 0.55 * energy), 0.0, 1.0);
  outFoam = clamp((1.0 - jacobian) * 1.45 * energy + outCrest * 0.35 * energy, 0.0, 1.0);
  return disp;
}
`;

export const TIDEWATER_WATER_GLSL = /* glsl */`
// ---------------- Fresnel dielétrico exato & Fase de Henyey-Greenstein (WaterMaterial.js) ----------------
const float TW_IOR = 1.333;
const float TW_PI = 3.14159265;
const float TW_INV_PI = 0.318309886;

float twFresnelDielectric(float cosI, float eta) {
  float c = clamp(cosI, 0.0, 1.0);
  float g2 = eta * eta - 1.0 + c * c;
  if (g2 < 0.0) return 1.0; // reflexão interna total (fora da janela de Snell)
  float g = sqrt(max(g2, 0.0));
  float a = (g - c) / max(g + c, 1e-5);
  float b = (c * (g + c) - 1.0) / max(c * (g - c) + 1.0, 1e-5);
  return 0.5 * (a * a) * (b * b + 1.0);
}

float twWaterPhaseHG(float cosT, float g) {
  float g2 = g * g;
  return ((1.0 - g2) / (4.0 * TW_PI)) / pow(max(1.0 + g2 - cosT * 2.0 * g, 1e-4), 1.5);
}

// ---------------- SeaDetail.js: Rajadas (cat's paws), Slicks e Windrows ----------------
struct TwSeaDetail {
  float rough;
  float gust;
  float slick;
  float streak;
};

TwSeaDetail twSeaDetailSample(vec2 xz, vec2 windDir, float energy, float t) {
  float windSpeed = mix(2.2, 16.0, energy);
  vec2 drift = windDir * (windSpeed * 0.45 * t);
  vec2 p = xz - drift;

  // Rajadas de vento (gusts) em duas escalas largas (~280 m e ~110 m)
  float g1 = textureLod(uNoise, p / 280.0, 0.0).r;
  float g2 = textureLod(uNoise, p / 110.0 + vec2(t * 0.0012, 0.37), 0.0).g;
  float gustRaw = g1 * 0.62 + g2 * 0.38;
  float gust = clamp((gustRaw - 0.5) * 2.2 + 0.5, 0.0, 1.0);

  // Coordenadas alinhadas ao vento com leve serpenteio (domain warp)
  float along = dot(xz, windDir);
  float across = dot(xz, vec2(-windDir.y, windDir.x)) + (g2 - 0.5) * 18.0;

  // Slicks: faixas calmas onde filmes de surfactante amortecem ondas capilares em vento leve/moderado
  float sl = textureLod(uNoise, vec2(along / 420.0, across / 36.0), 0.0).b;
  float calmWind = smoothstep(13.0, 3.5, windSpeed);
  float slick = smoothstep(0.62, 0.76, sl) * (1.0 - gust * 0.8) * calmWind;

  // Windrows (circulação de Langmuir): trilhas finas de espuma alinhadas ao vento fresco
  float st = textureLod(uNoise, vec2(along / 160.0, across / 7.5) + vec2(0.13, 0.71), 0.0).a;
  float breakUp = textureLod(uNoise, vec2(along / 65.0, across / 22.0) + vec2(0.51, 0.29), 0.0).r;
  float freshWind = smoothstep(4.5, 11.5, windSpeed);
  float streak = smoothstep(0.66, 0.82, st) * smoothstep(0.38, 0.62, breakUp) * freshWind * 0.42;

  float rough = mix(0.54, 1.48, gust) * (1.0 - slick * 0.78) * (1.0 - streak * 0.5);
  return TwSeaDetail(rough, gust, slick, streak);
}

// ---------------- ShoreWaves.js & Breakers.js: Ondas Costeiras, Arrebentação e Swash ----------------
struct TwShoreWave {
  vec3 normal;
  float foam;
  float roller;
  float face;
  float aeration;
  float swashFoam;
  float swashRim;
  vec2 flow;
};

TwShoreWave twEvaluateShore(vec2 xz, float blocks, float rise, float steep, vec2 shoreDir, vec2 windDir, float energy, float t) {
  TwShoreWave sw;
  sw.normal = vec3(0.0, 1.0, 0.0);
  sw.foam = 0.0;
  sw.roller = 0.0;
  sw.face = 0.0;
  sw.aeration = 0.0;
  sw.swashFoam = 0.0;
  sw.swashRim = 0.0;
  sw.flow = windDir * (0.35 + 0.8 * energy);

  // Envelope costeiro: ativo de águas médias/rasas até a margem, atenuado contra paredes verticais (steep)
  float dMeters = max(blocks * 0.88, 0.08);
  float coastalEnv = smoothstep(6.8, 3.6, blocks) * (1.0 - steep * 0.75);
  if (coastalEnv <= 0.001) return sw;

  vec2 dir = normalize(mix(windDir, shoreDir, smoothstep(0.04, 0.35, rise)));
  vec2 acrossDir = vec2(-dir.y, dir.x);
  float along = dot(xz, acrossDir);
  float crossCoord = dot(xz, dir);

  // Período costeiro de 9.0 s (ShoreWaves.js), com fase desacelerando no raso (c = sqrt(g*d))
  const float Tp = 9.0;
  float cSpeed = sqrt(clamp(dMeters, 0.35, 12.0) * 9.81);
  float lam = max(cSpeed * Tp * 0.38, 4.5);
  float warp = (textureLod(uNoise, xz * 0.025, 0.0).r - 0.5) * 0.24;
  float s = crossCoord / lam - t / Tp + warp;
  float m = floor(s + 0.5);
  float u = s - m; // [-0.5, 0.5], 0 na crista

  // Grupos de ondas (sets) variando a altura ao longo da praia
  float setAmp = 0.75 + 0.25 * sin(along * 0.045 + m * 2.1);
  float H = (0.24 + 0.38 * energy) * setAmp;
  // Lei de Green + critério de quebra (H > gamma * d, gamma = 0.78)
  float breakRatio = H / max(dMeters * 0.78, 0.18);
  float breaking = smoothstep(0.65, 1.25, breakRatio) * smoothstep(0.15, 1.8, blocks);

  // Perfil assimétrico da onda costeira: frente íngreme (u > 0, sentido praia) e dorso suave (u < 0)
  float crestZone = exp(-u * u * mix(18.0, 42.0, breaking));
  float frontFace = smoothstep(-0.04, 0.14, u) * smoothstep(0.38, 0.10, u);
  float boreBack = smoothstep(-0.28, 0.04, u) * smoothstep(0.24, -0.02, u);

  // Inclinação da parede côncava (face limpa antes do tubo fechar) e do rolo de espuma (roller)
  float slopeMag = (u * -3.6 * crestZone + frontFace * 0.65 * (1.0 + breaking)) * coastalEnv * (0.45 + 0.55 * energy);
  // Grumos turbulentos no rolo da arrebentação (ShoreWaves.js linhas 102-127)
  float lumpN = textureLod(uNoise, vec2(along * 0.18, s * 1.4 - t * 0.35), 0.0).g - 0.5;
  float roller = breaking * boreBack * coastalEnv * (0.75 + 0.5 * lumpN);
  float face = frontFace * (1.0 - boreBack * 0.6) * coastalEnv;

  vec2 nXZ = dir * slopeMag + acrossDir * (lumpN * roller * 0.35);
  sw.normal = normalize(vec3(nXZ.x, 1.0, nXZ.y));
  sw.roller = clamp(roller, 0.0, 1.0);
  sw.face = clamp(face, 0.0, 1.0);

  // Espuma gerada pelo rolo que quebra + variação irregular ao longo da crista (wwPatch)
  float wwPatch = smoothstep(0.28, 0.72, textureLod(uNoise, vec2(along * 0.055 + t * 0.015, m * 0.37), 0.0).b);
  sw.foam = clamp((roller * 1.15 + crestZone * breaking * 0.55) * mix(0.45, 1.0, wwPatch), 0.0, 1.0);

  // Corrida de swash na beira rasa (blocks < 1.35)
  float shallowZone = (1.0 - smoothstep(0.05, 1.45, blocks)) * (1.0 - steep * 0.85);
  if (shallowZone > 0.001) {
    float swPhase = fract(t / Tp + sin(along * 0.035) * 0.18 + crossCoord * 0.008);
    float uprush = smoothstep(0.48, 0.28, swPhase);
    float envSwash = swPhase < 0.42
      ? (1.0 - (1.0 - swPhase / 0.42) * (1.0 - swPhase / 0.42))
      : smoothstep(0.97, 0.42, swPhase);
    float reach = (0.22 + 0.55 * energy) * setAmp * envSwash;
    float distEdge = blocks * 0.65 - reach;
    float bead = smoothstep(-0.08, 0.03, distEdge) * smoothstep(0.42, 0.06, distEdge);
    float trail = smoothstep(-0.12, 0.18, distEdge) * smoothstep(1.25, 0.2, distEdge);
    float edgePatch = smoothstep(0.25, 0.75, textureLod(uNoise, xz * 0.28 + vec2(0.0, t * 0.02), 0.0).a);
    sw.swashFoam = (bead * mix(0.55, 1.15, uprush) + trail * 0.42 * edgePatch) * shallowZone;
    sw.swashRim = smoothstep(0.0, 0.04, distEdge) * smoothstep(0.14, 0.05, distEdge) * uprush * shallowZone;
  }

  // Aeração (bolhas misturadas na coluna d'água atrás da arrebentação -> turquesa leitoso)
  sw.aeration = clamp((sw.foam * 1.1 + sw.swashFoam * 0.75) * (1.0 - sw.face * 0.65), 0.0, 1.0);
  float uFlow = mix(0.4, 1.8, breaking) * (crestZone - 0.25);
  sw.flow = dir * uFlow + windDir * (0.25 + 0.55 * energy);
  return sw;
}

// ---------------- SurfFoam.js & FoamTexture.js: Espuma Rendada (Lace) Advectada + Relevo 3D ----------------
float twHash11(float x) {
  return fract(sin(x * 91.7 + 17.3) * 43758.5453);
}

// Avalia o padrão procedural de renda e bolhas (0 nos filamentos de espuma .. 1 no centro dos buracos)
// usando o mapa de fluxo de fase dupla (SurfFoam.surfFoamFlowLace, período 1.2 s).
vec4 twSampleFoamLace(vec2 q, vec2 flow, float salt) {
  const float PERIOD = 1.2;
  const float LACE_TILE = 3.5;
  float t = uTime / PERIOD;
  vec2 v = clamp(flow, vec2(-2.2), vec2(2.2)) * PERIOD;
  vec4 acc = vec4(0.0);

  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    float tk = t + fk * 0.5 + salt * 0.37;
    float ph = fract(tk);
    float cycle = floor(tk) + fk * 13.1 + salt * 5.7;
    vec2 jitter = vec2(twHash11(cycle), twHash11(cycle + 0.5)) * 7.0;
    vec2 uv = (q - v * (ph - 0.5)) / LACE_TILE + jitter;
    float w = 1.0 - abs(ph * 2.0 - 1.0);

    // Combina 2 escalas com domain warp para formar buracos celulares (renda) e aglomerados de bolhas
    vec4 n1 = textureLod(uNoise, uv * 0.42, 0.0);
    vec2 warp = (n1.rg - 0.5) * 0.22;
    vec4 n2 = textureLod(uNoise, uv * 1.15 + warp, 0.0);
    vec4 n3 = textureLod(uNoise, uv * 3.1 - warp.yx * 1.4, 0.0);

    // Cristas celulares: abs(n - 0.5) é 0 sobre os cordões de espuma e alto nos buracos redondos
    float cellA = abs(n2.r - 0.5) * 2.15;
    float cellB = abs(n2.g - 0.48) * 2.25;
    float loops = min(cellA, cellB) * (0.75 + 0.5 * n3.r);
    float holes = smoothstep(0.18, 0.68, n1.b * 0.65 + n2.b * 0.35);
    float strandDist = clamp(loops * 0.78 + holes * 0.34, 0.0, 1.0);
    float bubbles = smoothstep(0.56, 0.84, n3.g) * (0.35 + 0.65 * (1.0 - strandDist));
    float mottle = n1.a;
    acc += vec4(strandDist, bubbles, mottle, n2.a) * w;
  }
  return acc;
}

// Calcula a opacidade final da espuma rendada + iluminação volumétrica com auto-sombreamento (SurfFoam.js)
vec3 twShadeFoam(
  vec3 P,
  vec3 N,
  vec3 V,
  vec3 L,
  vec3 sunLight,
  vec3 skyIrradiance,
  float coverage,
  float freshWhitewater,
  vec2 flow,
  float footprint,
  out float outFoamAlpha
) {
  if (coverage <= 0.008) {
    outFoamAlpha = 0.0;
    return vec3(0.0);
  }
  vec4 lace = twSampleFoamLace(P.xz, flow, 0.0);
  vec2 r2 = vec2(P.x * 0.8 - P.z * 0.6, P.x * 0.6 + P.z * 0.8);
  vec4 laceFine = twSampleFoamLace(r2 * 1.9 + vec2(1.7, 3.1), flow * 0.8, 1.0);

  float ww = clamp(freshWhitewater * 1.35, 0.0, 1.0);
  float boil = lace.x * 0.68 + lace.z * 0.32;
  float lumps = 0.6 * (1.0 - lace.x) + 0.4 * (1.0 - laceFine.x);
  float wwEdge = smoothstep(0.22, 0.74, ww * 1.35 - boil * 0.30 - (1.0 - lumps) * 0.45);
  float whitewater = (ww * 0.28 + wwEdge * 0.72) * ((1.0 - boil) * 0.14 + 0.86);

  // Renda de espuma carregada pela água: cordões largos viram tapete, cordões finos abrem buracos
  float c = clamp(coverage, 0.0, 1.0);
  float w = max(pow(c, 1.35) * 0.88 * (lace.z * 0.48 + 0.76) + (lace.y - 0.5) * 0.06, 0.0);
  float soft = 0.055 + footprint * 1.8;
  float strandDist = lace.x * 0.65 + laceFine.x * 0.35;
  float mat = (1.0 - smoothstep(w - soft, w + soft, strandDist)) * smoothstep(0.0, 0.05, c);
  float bub = lace.y * smoothstep(w + 0.25, w, strandDist) * smoothstep(0.02, 0.18, c) * 0.52;
  float inner = clamp((w - strandDist) / 0.26, 0.0, 1.0);
  float laceFoam = max(mat * clamp(inner * 0.38 + 0.46 + lace.z * 0.28, 0.0, 1.0), bub);

  float far = smoothstep(0.06, 0.38, footprint);
  float nearFoam = max(laceFoam, whitewater);
  outFoamAlpha = clamp(mix(nearFoam, c * 0.86, far), 0.0, 1.0);

  // Normal perturbada pelos grumos da espuma branca + auto-oclusão nas frestas (surfFoamLight)
  vec2 lumpGrad = vec2(laceFine.x - lace.x, laceFine.z - lace.z) * (ww * (1.0 - far) * 0.45);
  vec3 Nf = normalize(vec3(N.x + lumpGrad.x, max(N.y, 0.15), N.z + lumpGrad.y));
  float NdL = dot(Nf, L);
  float wrap = mix(0.45, 0.14, ww);
  float selfShadow = mix(1.0, 0.72 + 0.28 * lumps, ww * (1.0 - far));
  float diff = clamp(NdL * (1.0 - wrap) + wrap, 0.0, 1.0) * selfShadow;
  float cavity = mix(0.86 + 0.14 * inner, mix(0.58, 1.0, smoothstep(0.1, 0.8, lumps)), ww);

  // Espalhamento frontal verde-água nas bordas finas e contra o sol (Henyey-Greenstein g = 0.55)
  float density = max(c * (inner * 0.5 + 0.5), ww);
  float thin = (1.0 - density) * 0.78 + ww * (1.0 - cavity) * 0.28;
  float trans = twWaterPhaseHG(dot(-V, L), 0.55) * thin * 1.25;
  vec3 transCol = mix(vec3(1.0), vec3(0.60, 0.92, 0.82), ww * 0.7 + 0.3);

  vec3 skyGrey = vec3(dot(skyIrradiance, vec3(0.2126, 0.7152, 0.0722)));
  vec3 amb = mix(skyIrradiance, skyGrey, ww * 0.32) * cavity + sunLight * (ww * 0.045) * cavity;
  return (sunLight * (diff * mix(1.0, sqrt(cavity), ww) * TW_INV_PI + transCol * trans) + amb) * 0.90;
}

// Reoriented normal mapping (WaterSurface.js linhas 327-333): gira a normal de detalhe sobre a face inclinada da onda
vec3 twReorientNormal(vec3 baseN, vec2 detailSlope) {
  vec3 Ns = normalize(vec3(baseN.x, max(baseN.y, 0.15), baseN.z));
  vec3 nd = normalize(vec3(-detailSlope.x, 1.0, -detailSlope.y));
  vec3 tq = Ns + vec3(0.0, 1.0, 0.0);
  vec3 uq = vec3(detailSlope.x, 1.0, detailSlope.y) * nd.y;
  return normalize(tq * (dot(tq, uq) / max(tq.y, 1e-4)) - uq);
}
`;

export const TIDEWATER_TERRAIN_GLSL = /* glsl */`
// ---------------- Caustics.js: Rede de Cáusticas com Refração de Onda, Duplo Plano Focal e Dispersão Cromática ----------------
float twCausticPattern(vec2 uv, float t, float focalMix) {
  // Duas grades celulares refratadas que cruzam em velocidades opostas formando a malha focal (CausticLayer)
  vec2 d1 = vec2(t * 0.038, -t * 0.024);
  vec2 d2 = vec2(-t * 0.029, t * 0.033);
  float a1 = textureLod(uNoise, uv * 0.105 + d1, 0.0).r;
  float b1 = textureLod(uNoise, uv * 0.148 - d2 + vec2(0.37, 0.71), 0.0).g;
  float fineWeb = max(1.0 - abs(a1 - b1) * 6.8, 0.0);
  fineWeb *= fineWeb;
  fineWeb *= fineWeb;

  // Segundo plano focal mais fundo e suave (4.0 m .. 9.0 m)
  float a2 = textureLod(uNoise, uv * 0.052 + d1 * 0.65 + vec2(0.19, 0.43), 0.0).b;
  float b2 = textureLod(uNoise, uv * 0.074 - d2 * 0.65, 0.0).a;
  float deepWeb = max(1.0 - abs(a2 - b2) * 5.2, 0.0);
  deepWeb *= deepWeb;

  return mix(fineWeb * 2.35, deepWeb * 1.75, focalMix);
}

vec3 twCausticsSample(vec3 wp, float wd, vec3 sunDir, vec3 windVec, float t, float fw) {
  if (wd <= 0.01) return vec3(1.0);
  vec2 wDir = length(windVec.xy) > 1e-4 ? normalize(windVec.xy) : vec2(0.83, 0.55);
  float energy = clamp((windVec.z - 0.35) / 1.45, 0.0, 1.0);

  // Inclinação da onda longa na superfície acima: balança toda a rede de cáusticas quando a onda passa
  vec2 waveSlope = (textureLod(uNoise, wp.xz * 0.032 - wDir * (t * 0.08), 0.0).rg - 0.5) * (0.22 + 0.25 * energy);
  vec3 nSurf = normalize(vec3(-waveSlope.x, 1.0, -waveSlope.y));
  vec3 Ls = refract(-sunDir, nSurf, 1.0 / 1.333);
  float tDown = max(-Ls.y, 0.18);
  vec2 entry = wp.xz - Ls.xz * (wd / tDown);

  // Mistura entre plano focal raso (1.2 m) e fundo (4.0 m), mais modulação larga (9.0 m)
  float wD = clamp((wd - 1.2) / 2.8, 0.0, 1.0);
  float g = twCausticPattern(entry, t, wD);
  float r = g;
  float b = g;
#ifdef DETAIL
  // Dispersão cromática do Tidewater (Caustics.js linhas 243-250): R e B separam ao longo do sol refratado
  vec2 disp = normalize(Ls.xz + vec2(1e-4, 0.0)) * min(wd * 0.045, 0.28);
  r = twCausticPattern(entry + disp, t, wD);
  b = twCausticPattern(entry - disp, t, wD);
#endif
  float broad = 0.72 + 0.58 * textureLod(uNoise, entry * 0.018 - wDir * (t * 0.015), 0.0).r;
  vec3 c = vec3(r, g, b) * broad;

  // Fator de rajada/slick (SeaDetail) + envelope por profundidade e anti-aliasing por distância
  float gust = textureLod(uNoise, (entry - wDir * t * 1.4) / 180.0, 0.0).r;
  float detailK = mix(0.65, 1.30, gust);
  float aa = 1.0 - smoothstep(0.35, 1.6, fw);
  float k = smoothstep(0.03, 0.48, wd) * exp(-wd * 0.075) * 0.85 * detailK * aa;
  return mix(vec3(1.0), vec3(0.74) + c * 1.15, k);
}

// ---------------- Terrain.js & TerrainShading.js: Areia de Coral da Praia, Swash, Areia Molhada e Fundo do Mar ----------------
void twApplySandAndShore(
  vec3 wp,
  vec3 Ng,
  float uSeaLevel,
  vec3 windVec,
  float t,
  float dist,
  float isSandLayer,
  float fwXZ,
  inout vec3 albedo,
  inout vec3 N,
  inout float rough,
  out float outSwashFoam
) {
  outSwashFoam = 0.0;
  if (uSeaLevel < -1000.0) return;

  vec2 xz = wp.xz;
  float h = wp.y - uSeaLevel; // altura relativa ao nível de repouso do mar (m)
  vec2 wDir = length(windVec.xy) > 1e-4 ? normalize(windVec.xy) : vec2(0.83, 0.55);
  vec2 wPerp = vec2(-wDir.y, wDir.x);
  float energy = clamp((windVec.z - 0.35) / 1.45, 0.0, 1.0);

  // Amostras de detalhe em múltiplas escalas (Terrain.js linhas 191-198)
  float macroA = textureLod(uNoise, xz / 140.0, 0.0).a;
  float macroB = textureLod(uNoise, xz / 42.0 + 0.17, 0.0).r;
  float mcr = macroA * 0.6 + macroB * 0.4;
  vec4 dM = textureLod(uNoise, xz / 6.2 + 0.21, 0.0);
  vec4 dN = textureLod(uNoise, xz / 1.85 + 0.53, 0.0);
  vec4 dF = textureLod(uNoise, xz / 0.58 + 0.31, 0.0);
  float nearFade = 1.0 - smoothstep(16.0, 48.0, dist);

  // Corrida analítica do swash na praia (idêntica a swashPraia em public/shared/ondas.js e ShoreWaves.js)
  float along = dot(xz, wPerp);
  float crossC = dot(xz, wDir);
  float setMod = 0.78 + 0.22 * sin(along * 0.045 + t * 0.11) * cos(along * 0.019 - 0.7);
  float swFase = fract(t / 9.0 + sin(along * 0.035) * 0.18 + crossC * 0.008);
  bool isUprush = swFase < 0.42;
  float swEnv = isUprush
    ? (1.0 - (1.0 - swFase / 0.42) * (1.0 - swFase / 0.42))
    : smoothstep(0.97, 0.42, swFase);
  float maxRunup = (0.24 + 0.48 * energy) * setMod;
  float curRunup = maxRunup * swEnv;

  if (isSandLayer > 0.5) {
    float underW = smoothstep(0.08, -0.55, h);
    float landW = 1.0 - underW;

    // 1. Areia seca de coral da praia (Terrain.js linhas 349-384)
    float dryK = smoothstep(0.35, 2.2, h);
    vec3 coralSandA = vec3(0.65, 0.52, 0.33); // linear equivalente a sRGB(0.83, 0.75, 0.60)
    vec3 coralSandB = vec3(0.78, 0.67, 0.47); // linear equivalente a sRGB(0.90, 0.84, 0.72)
    vec3 warmDrift  = vec3(0.67, 0.48, 0.27); // linear equivalente a sRGB(0.84, 0.72, 0.55)
    vec3 drySand = mix(coralSandA, coralSandB, smoothstep(0.25, 0.75, mcr + dryK * 0.2));
    drySand = mix(drySand, warmDrift, smoothstep(0.52, 0.80, dM.a + (macroB - 0.5) * 0.5) * 0.42);
    // Grãos minerais, fragmentos de concha e cascalho fino na linha de maré alta (wrackBand)
    float grain = (dN.b - 0.5) * 0.22 + (dF.r - 0.5) * 0.16 * nearFade;
    drySand *= 1.0 + grain;
    float hw = h + (dM.a - 0.5) * 0.35;
    float wrackBand = smoothstep(0.55, 0.85, hw) * smoothstep(1.55, 1.15, hw);
    float shellGrit = smoothstep(0.68, 0.84, dF.g) * (0.25 + 0.75 * wrackBand) * nearFade;
    drySand = mix(drySand, vec3(0.82, 0.76, 0.64), shellGrit * 0.55);

    // Micro-ondulações de vento na areia seca (wind ripples ~14 cm, Terrain.js linhas 377-384)
    float phWind = dot(xz, wDir) * (6.2831853 / 0.14) + dM.a * 14.0 + dN.r * 4.5 + macroB * 18.0;
    float ripFade = (1.0 - smoothstep(0.025, 0.11, fwXZ)) * smoothstep(0.25, 0.95, h) * max(Ng.y, 0.0);
    float ripWind = pow(max(sin(phWind) * 0.5 + 0.5, 1e-4), 1.6);
    float ripWindGrad = cos(phWind) * ripFade;
    drySand *= 1.0 + (ripWind - 0.5) * 0.14 * ripFade;

    // 2. Fundo arenoso do mar (seabed, Terrain.js linhas 223-265): megaripples (~0.75 m) e wave ripples (~0.18 m)
    float depth = max(-h, 0.0);
    vec3 seabedShallow = vec3(0.67, 0.57, 0.38); // sRGB(0.84, 0.78, 0.64)
    vec3 seabedDeep    = vec3(0.48, 0.45, 0.31); // sRGB(0.72, 0.70, 0.58)
    vec3 underSand = mix(seabedShallow, seabedDeep, smoothstep(1.0, 10.0, depth));
    underSand *= 1.0 + (dM.a - 0.5) * 0.14 + grain * 0.7;

    float phMega = dot(xz, wDir) * (6.2831853 / 0.75) + dM.a * 10.0 + macroB * 16.0;
    float fadeMega = (1.0 - smoothstep(0.12, 0.45, fwXZ)) * smoothstep(0.6, 1.8, depth) * max(Ng.y, 0.0);
    float ripMega = pow(max(sin(phMega) * 0.5 + 0.5, 1e-4), 1.4);
    float phSub = dot(xz, wDir) * (6.2831853 / 0.18) + dM.g * 14.0 + dN.a * 4.0;
    float fadeSub = (1.0 - smoothstep(0.03, 0.13, fwXZ)) * smoothstep(0.15, 0.8, depth) * max(Ng.y, 0.0);
    float ripSub = pow(max(sin(phSub) * 0.5 + 0.5, 1e-4), 1.5);
    underSand *= 1.0 + (ripMega - 0.55) * 0.20 * fadeMega + (ripSub - 0.5) * 0.10 * fadeSub;

    vec3 targetSand = mix(drySand, underSand, underW);
    // Mistura preservando a identidade do bloco com a riqueza do Tidewater
    albedo = mix(albedo, targetSand, 0.58);

    // Perturbação da normal pelas micro-ondulações da areia seca e do fundo submerso
    float rippleSlope = ripWindGrad * 0.11 * landW
                      + (cos(phMega) * fadeMega * 0.14 + cos(phSub) * fadeSub * 0.09) * underW;
    if (abs(rippleSlope) > 1e-4 && Ng.y > 0.5) {
      N = normalize(vec3(N.x - wDir.x * rippleSlope, N.y, N.z - wDir.y * rippleSlope));
    }

    // Marcas de swash (swashLine: linhas finas deixadas por ondas anteriores, Terrain.js linhas 569-575)
    float sl = (h + dM.a * 0.16 + dN.a * 0.04) / 0.14;
    float slD = abs(fract(sl) - 0.5);
    float swashLine = smoothstep(0.12, 0.0, slD) * smoothstep(0.15, 0.35, h) * smoothstep(1.15, 0.75, h) * nearFade * landW;
    albedo = mix(albedo * (1.0 - swashLine * 0.22), vec3(0.78, 0.74, 0.66), swashLine * 0.35);
  }

  // 3. Faixa de areia molhada escura/especular + lâmina e espuma do swash (Terrain.js linhas 552-590)
  float mottle = smoothstep(0.25, 0.75, dM.a + (dN.g - 0.45) * 0.5);
  // Lâmina ativa de swash cobrindo a areia até curRunup
  float swashCovered = smoothstep(curRunup + 0.08, curRunup - 0.04, h) * smoothstep(-0.35, -0.02, h);
  // Faixa úmida estende-se até o alcance máximo da série de ondas (maxRunup + 0.42 m), secando em manchas
  float dampReach = maxRunup + 0.38 + (dM.a - 0.5) * 0.22;
  float dampBand = smoothstep(dampReach + 0.28, dampReach - 0.15, h) * smoothstep(-0.5, 0.02, h);
  float dryEdge = smoothstep(0.0, 0.55, dampBand) * smoothstep(1.0, 0.55, dampBand);
  float wetSand = max(swashCovered, dampBand * (1.0 - dryEdge * mottle * 0.55));

  if (wetSand > 0.001) {
    // Escurecimento rico com ganho de saturação (wetDarken = 0.58, saturation = 1.15 do Tidewater)
    float lum = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    vec3 satAlbedo = max(mix(vec3(lum), albedo, 1.16), vec3(0.0));
    // Sulcos finos de drenagem (backwash rills)
    float rill = (textureLod(uNoise, vec2(crossC / 2.8, along / 0.35), 0.0).a - 0.5) * 0.18 * nearFade;
    vec3 wetCol = satAlbedo * 0.56 * vec3(0.96, 0.98, 1.0) * (1.0 + rill * dampBand);
    albedo = mix(albedo, wetCol, wetSand * mix(0.65, 0.92, isSandLayer));
    // Filme espelhado de água na areia recém-molhada pelo swash
    float targetRough = mix(0.36, 0.12, swashCovered);
    rough = mix(rough, targetRough, wetSand * 0.88);
    // Suaviza o micro-relevo sob o filme de água
    if (Ng.y > 0.5) N = normalize(mix(N, Ng, swashCovered * 0.55));
  }

  // Borda espumosa do swash subindo e resíduos rendados deixados na areia
  float frontDist = curRunup - h;
  float uprushK = isUprush ? 1.0 : 0.38;
  float edgeBead = smoothstep(-0.04, 0.02, frontDist) * smoothstep(0.18, 0.03, frontDist) * uprushK;
  float laceRes = smoothstep(0.32, 0.72, dN.r * 0.6 + dF.g * 0.4);
  float trailRes = smoothstep(-0.02, 0.06, frontDist) * smoothstep(0.42, 0.08, frontDist) * laceRes * 0.55;
  outSwashFoam = clamp((edgeBead * mix(0.55, 1.0, laceRes) + trailRes) * smoothstep(-0.25, 0.02, h) * max(Ng.y, 0.0), 0.0, 1.0);
}
`;
