// LAVRA — shaders do terreno, da água e do céu, e os uniforms que eles dividem.
// Tudo o que é voxel passa por aqui; objetos, avatares e máquinas usam os materiais
// padrão do three, iluminados pelas luzes que o atmosphere.js mantém em sincronia.
// Oceano, espuma costeira, cáusticas e areia da praia/fundo adaptados de dgreenheck/tidewater (MIT License).
//
// Dois modos de saída (uDirect): 1 = o próprio shader fecha a imagem (curva de tons + sRGB),
// usado no VR e nos perfis sem pós-processamento; 0 = sai luz linear (HDR) e quem fecha é o post.js.

import * as THREE from '../three.js';
import { AGUA_GLSL } from './agua-clara.js';
import { CAUSTICA_GLSL } from './causticas.js';
import { TINT_B0, TINT_C0, TINT_D0, TEX_INDEX } from '../../shared/blocks.js';
import { CANOPY_WIND } from './wind.js';
import { WATER_REFLECTION } from './water-reflection.js';
import { GLASS_SURFACE } from './glass-shader.js';
import { TIDEWATER_VERTEX_GLSL, TIDEWATER_WATER_GLSL, TIDEWATER_TERRAIN_GLSL } from './oceano-tidewater.js';

// Uniforms globais: os mesmos objetos {value} são referenciados por todos os materiais.
export const U = {
  uTime: { value: 0 },
  uWindTime: { value: 0 },
  uWind: { value: new THREE.Vector3(.83,.55,.85) },
  uRainbow: { value: 0 },
  uWetness: { value: 0 },
  uDirect: { value: 1 },
  uHeadset: { value: 0 },                                 // 1 só com a sessão de VR aberta: superfície jateada, sem reflexo liso
  uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },    // onde o sol está
  uSunAz: { value: new THREE.Vector2(0.5, 0.86) },                     // direção do sol no chão (normalizada)
  uLightDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },  // luz direcional dominante (sol ou lua)
  uSunColor: { value: new THREE.Vector3(3, 2.8, 2.5) },
  uAmbSky: { value: new THREE.Vector3(0.34, 0.46, 0.66) },
  uAmbGround: { value: new THREE.Vector3(0.16, 0.14, 0.11) },
  uZenith: { value: new THREE.Vector3(0.1, 0.26, 0.62) },
  uHorizon: { value: new THREE.Vector3(0.52, 0.7, 0.92) },
  uDusk: { value: new THREE.Vector4(1, 0.5, 0.2, 0) },    // cor quente do horizonte do lado do sol + peso
  uSunGlow: { value: new THREE.Vector3(1, 0.8, 0.5) },
  uFog: { value: new THREE.Vector2(70, 160) },             // início e fim da névoa (m)
  uHaze: { value: new THREE.Vector4(0.2, 0.006, 48, 0.02) }, // bruma: força, densidade por metro, altura de base, queda por metro de altura
  uFogTint: { value: new THREE.Vector4(0, 0, 0, 0) },   // rgb + peso: névoa de cor fixa (debaixo d'água)
  uTorch: { value: new THREE.Vector3(1.8, 1.2, 0.62) },
  uMinAmb: { value: 0.014 },
  uExposure: { value: 1.0 },
  uNight: { value: 0 },
  uSkyReal: { value: 0 },                                  // 1 = lua e estrelas de verdade, desenhadas por nature/sky.js (o shader não inventa as dele)
  uCloudCover: { value: 0.52 },
  uCloudLit: { value: new THREE.Vector3(1, 1, 1) },
  uCloudDark: { value: new THREE.Vector3(0.5, 0.55, 0.65) },
  uWaterColor: { value: new THREE.Vector3(0.008, 0.092, 0.175) },   // água funda Tidewater (azul-safira oceânico)
  uWaterShallow: { value: new THREE.Vector3(0.11, 0.43, 0.39) },    // água rasa Tidewater (turquesa sobre areia de coral)
  uSea: { value: -1e4 },
  uMarNovo: { value: 0 },                                   // 1 = o mar do arquipélago (render/oceano.js) desenha a superfície e o espraiamento                                    // altura da superfície do mar (cáusticas e absorção); muito baixo = desligado
  // água clara do mar (render/agua-clara.js, 24/11/2026): no mar a luz vem da coluna d'água, não da luz dos blocos
  uCaust: { value: null },                                   // cáusticas por refração (render/causticas.js), canal r, média ~1
  uMarMapa: { value: null },                                 // fundo em volta da ilha ativa (render/oceano.js): r = chão − nível do mar, g = distância à costa (m)
  uMarCaixa: { value: new THREE.Vector4(0, 0, 1, 1) },       // x0, z0, 1 / largura, 1 / comprimento desse mapa
  uAguaCeu: { value: new THREE.Vector3(0.2, 0.5, 0.62) },    // luz difusa logo abaixo da superfície (atmosphere.js)
  uAguaVeu: { value: new THREE.Vector3(0.004, 0.004, 0.005) }, // luz que a água devolve por metro, já com a luz do dia (atmosphere.js)
  uAguaVeuSol: { value: new THREE.Vector3(0.004, 0.009, 0.011) }, // a parte do véu que vem do sol direto, por metro (atmosphere.js)
  uOmen: { value: new THREE.Vector4(0, 1, 0, 0) },      // direção no céu + intensidade da aparição
  uTex: { value: null },
  uMcTex: { value: null },                                   // folha de texturas dos blocos do Minecraft (world/mc-pacote.js)
  uTexSize: { value: 128 },
  uSurf: { value: null },                                   // relevo (normal xy), rugosidade e metal de cada camada
  uRel: { value: null },                                    // materiais de arquivo: altura (r: 1 = topo) e oclusão (g) por camada
  uRelInfo: { value: new THREE.Vector4(0, 14, 0.125, 0) },  // x = ligado · y = alcance do relevo de perto (m) · z = profundidade máx (m)
  uShadowMap: { value: null },                              // mapa de sombra do sol (profundidade, com comparação)
  uShadowMatrix: { value: new THREE.Matrix4() },            // mundo -> coordenada no mapa de sombra
  uShadowInfo: { value: new THREE.Vector3(1 / 2048, 0, 2) }, // x = tamanho do texel, y = força (0 = sem mapa ainda), z = raio da penumbra em texels
  // Prova de realismo (atmosphere.js): sombra de perto, um segundo mapa justo em volta de quem olha
  uShadowMapN: { value: null },
  uShadowMatrixN: { value: new THREE.Matrix4() },
  uShadowInfoN: { value: new THREE.Vector4(1 / 4096, 0, 1 / 519, 0.0105) },   // x = texel · y = força (0 = sem mapa) · z = profundidade por metro · w = abertura da penumbra por metro até quem faz a sombra
  uRelva: { value: new THREE.Vector4(0, 5, 22, 0) },       // relva viva (render/relva.js): x = ligada · y = até onde é cheia (m) · z = onde acaba (m) · w = livre
  uRelvaCor: { value: new THREE.Vector4(0.1, 0.2, 0.05, 1) },   // cor média (linear) da foto do gramado em uso: a relva e o chão fotografado partem dela
  // chão fotografado (render/real-chao.js): materiais escaneados lidos em coordenadas do mundo, sem repetir por bloco
  uChaoCor0: { value: null }, uChaoSup0: { value: null },   // gramado: cor · superfície (normal x, normal y, rugosidade)
  uChaoCor1: { value: null }, uChaoSup1: { value: null },   // debaixo das copas: serrapilheira
  uChao: { value: new THREE.Vector4(0, 48, 2, 2.3) },       // x = ligado (texturas carregadas) · y = alcance (m) · z, w = tamanho de verdade dos ladrilhos (m)
  uChaoMed: { value: new THREE.Vector3(0.14, 0.12, 0.06) }, // cor média (linear) do material do gramado
  uCascaCor: { value: null }, uCascaSup: { value: null },   // casca de árvore escaneada: cor · superfície
  uCasca: { value: new THREE.Vector4(0, 1, 60, 1.9) },      // x = ligada · y = tamanho do ladrilho (m) · z = alcance (m) · w = força do relevo
  uCascaMed: { value: new THREE.Vector3(0.07, 0.06, 0.035) },
  uCopa: { value: null },                                   // folhagem por coluna (1 ponto = 1 m), em volta de quem olha
  uCopaInfo: { value: new THREE.Vector4(0, 0, 1 / 192, 0) }, // x, z do canto do mapa no mundo · z = 1 / lado (m) · w = ligado
  uPocaMapa: { value: null },                               // bacias em volta de quem olha (64 × 64 m, 1 ponto = 1 coluna; dobra-se): onde a água fica
  uPoca: { value: new THREE.Vector4(0, 0, 0, 0) },          // chuva (render/chuva.js): x = quanto as poças encheram (0…1) · y = quanto chove agora (anéis de gota) · z = enxurrada (0…1, temporal) · w = livre
  uNoise: { value: null },
  uOmenTex: { value: null },
};

export const COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir, uLightDir, uSunColor, uAmbSky, uAmbGround, uZenith, uHorizon, uSunGlow, uTorch;
uniform float uMinAmb, uExposure, uNight, uDirect, uHeadset, uMarNovo;
uniform vec2 uFog, uSunAz;
uniform vec4 uFogTint, uDusk, uHaze;

// Cor do céu limpo numa direção: degradê zênite -> horizonte, crepúsculo quente do lado do sol e o halo em volta dele.
vec3 skyBase(vec3 dir) {
  float h = max(dir.y, 0.0);
  float t = 1.0 - h; float t2 = t * t; float t4 = t2 * t2;
  vec3 c = mix(uZenith, uHorizon, t4);
  float az = dot(dir.xz, uSunAz) * inversesqrt(max(dot(dir.xz, dir.xz), 1e-4));
  float toward = 0.5 + 0.5 * az;
  c = mix(c, uDusk.rgb, uDusk.a * t4 * t2 * toward * toward);
  float sd = max(dot(dir, uSunDir), 0.0);
  float s8 = sd * sd; s8 *= s8; s8 *= s8;
  float s64 = s8 * s8; s64 *= s64; s64 *= s64;
  c += uSunGlow * (s8 * 0.22 + s64 * 0.55) * (0.3 + 0.7 * t4);
  return c;
}
vec3 tonemap(vec3 c) {
  c *= uExposure / 0.6;
  c = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * c;
  c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
  c = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * c;
  return clamp(c, 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(0.41666)) - 0.055, step(vec3(0.0031308), c));
}
// Relva viva (render/relva.js): que fração das lâminas existe a esta distância de quem olha (1 perto … 0 no fim do
// alcance). O terreno escurece o gramado por baixo delas na mesma medida, e a relva some pela mesma curva.
float relvaDens(vec4 r, float d) { float t = clamp((r.z - d) / max(r.z - r.y, 0.001), 0.0, 1.0); return r.x * t * sqrt(t); }
// fecha a cor: direto na tela (curva de tons + sRGB) ou luz linear para o pós-processamento
// Caminho direto (VR, perfil baixo, ?post=0): a mesma saída do post.js menos o que custa ou incomoda no visor —
// −10% de saturação (sem ela a grama ficava néon no VR, 17/11); sem vinheta e sem pontilhado (este trecho também
// entra no shader de vértice, onde não existe gl_FragCoord).
vec3 finishDirect(vec3 c) { c = tonemap(c); float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = max(mix(vec3(l), c, 0.90), 0.0); return toSRGB(c); }
vec3 finish(vec3 c) { return uDirect > 0.5 ? finishDirect(c) : c; }
// ruído de gradiente intercalado: um valor por pixel, bom para girar amostras e quebrar faixas
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
// xyz = cor da névoa, w = quanto dela. Soma a névoa de borda (esconde o fim do mundo carregado)
// com a bruma do ar, que cresce com a distância e é mais densa perto do nível do mar.
vec4 fogAt(float dist, vec3 dir, float wy) {
  float f = smoothstep(uFog.x, uFog.y, dist);
  float hz = uHaze.x * (1.0 - exp(-dist * uHaze.y)) * clamp(1.0 - (wy - uHaze.z) * uHaze.w, 0.2, 1.0);
  f = 1.0 - (1.0 - f) * (1.0 - hz);
  // Debaixo d'água a luz vem de cima: olhando para a superfície a névoa alivia.
  if (uFogTint.a > 0.5) f *= mix(1.08, 0.4, smoothstep(-0.2, 0.75, dir.y));
  vec3 c = skyBase(vec3(dir.x, max(dir.y, 0.0), dir.z));
  c = mix(c, uFogTint.rgb, uFogTint.a);
  return vec4(c, f);
}
`;

// Nuvens: usadas pelo céu e, no perfil alto, pelo reflexo na água.
const CLOUDS = /* glsl */`
uniform float uCloudCover;
uniform vec3 uCloudLit, uCloudDark;
float cloudN(vec2 uv) {
  float n = texture(uNoise, uv).r * 0.56 + texture(uNoise, uv * 2.3 + 0.37).g * 0.29;
#if CLOUD_OCT > 2
  n += texture(uNoise, uv * 5.1 + 0.11).b * 0.15;
#else
  n += 0.075;
#endif
  return n;
}
#ifdef CLOUD_VOLUME
// Cinco amostras deixavam fatias visíveis no horizonte. Dezesseis convergem
// para a referência densa sem alterar a espessura óptica total da camada.
#ifndef CLOUD_STEPS
#define CLOUD_STEPS 16
#endif
float cloudDensity(vec3 p) {
  float shape = texture(uNoise,p.xz + p.y*vec2(.035,.021)).r*.7
              + texture(uNoise,p.xz*2.7 - p.y*vec2(.11,.06)).g*.3;
  float envelope = smoothstep(0.0,.16,p.y) * (1.0-smoothstep(.55,1.0,p.y));
  return max(0.0,shape-uCloudCover+.08) * envelope * 6.5;
}
vec4 cloudVolume(vec3 dir, float extra) {
  vec2 wind = uTime * vec2(.0019,.0007);
  vec3 result = vec3(0.0); float transmission = 1.0;
  float path = min(2.5,1.0/max(.4,dir.y));
  float toward = pow(max(dot(dir,uSunDir),0.0),8.0);
  for (int i=0;i<CLOUD_STEPS;i++) {
    float h = (float(i)+.5)/float(CLOUD_STEPS);
    vec2 uv = dir.xz/max(.12,dir.y+.11) * (.20+h*.065) + wind;
    vec3 p = vec3(uv.x,h,uv.y);
    float density = cloudDensity(p) + extra;
    float alpha = 1.0-exp(-density*path*(2.1/float(CLOUD_STEPS)));
    vec3 lp = p+vec3(uLightDir.x*.11,.12+max(0.0,uLightDir.y)*.12,uLightDir.z*.11);
    float sunlight = exp(-cloudDensity(lp)*2.5);
    vec3 color = mix(uCloudDark*.72,uCloudLit,clamp(sunlight*.78+h*.18,0.0,1.0));
    // Sol baixo acende a base. Some à noite porque o brilho solar já é zero.
    color += uSunGlow * uDusk.a * (1.0-h) * sunlight * (.18+.45*toward);
    result += transmission * alpha * color;
    transmission *= 1.0-alpha;
  }
  float opacity = 1.0-transmission;
  return vec4(result/max(opacity,.0001),opacity*smoothstep(.005,.16,dir.y));
}
#endif
// rgb = cor da nuvem, a = cobertura. extra = densidade somada (a aparição desenhada na nuvem).
vec4 cloudLayer(vec3 dir, float extra) {
#ifdef CLOUD_VOLUME
  if (uDirect < .5) return cloudVolume(dir,extra);
#endif
  vec2 cuv = dir.xz / (dir.y + 0.11) * 0.21 + uTime * vec2(0.0034, 0.0013);
  float n = cloudN(cuv) + extra;
  float cov = smoothstep(uCloudCover, uCloudCover + 0.2, n);
  float n2 = cloudN(cuv + uLightDir.xz * 0.018);
  float shade = clamp((n - n2) * 3.4 + 0.62, 0.0, 1.0);
  float thick = smoothstep(uCloudCover + 0.12, uCloudCover + 0.5, n);     // miolo espesso: base mais escura
  vec3 cc = mix(uCloudDark, uCloudLit, shade * (1.0 - 0.4 * thick));
  // borda prateada: nuvem fina na frente do sol espalha a luz para a frente
  float sd = max(dot(dir, uSunDir), 0.0);
  float s16 = sd * sd; s16 *= s16; s16 *= s16; s16 *= s16;
  cc += uSunGlow * (s16 * 1.5 * (1.0 - thick) * (1.0 - cov * 0.6));
  // O perfil plano não integra auto-oclusão. Compensa a espessura do céu fechado
  // à noite, para aumentar a cobertura não virar uma lâmpada sobre a água.
  cc *= 1.0-uNight*clamp((.52-uCloudCover)/.34,0.0,1.0)*.45;
  return vec4(cc, cov * smoothstep(0.015, 0.2, dir.y) * 0.94);
}
`;

// Só nos fragmentos (fwidth não existe no vértice). Fora do VR, vrGrain devolve 1.
const VR_SURFACE = /* glsl */`
float vrGrain(vec3 w) {
  vec3 q = w * 380.0;
  float n = fract(sin(dot(floor(q), vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float fw = max(fwidth(q.x), 1e-4);
  float k = uHeadset * (1.0 - smoothstep(0.5, 1.6, fw));
  return mix(1.0, 0.86 + 0.14 * n, k);
}
vec2 vrGrainN(vec3 w) {
  vec3 q = floor(w * 380.0);
  float a = fract(sin(dot(q, vec3(269.5, 183.3, 11.7))) * 43758.5453) - 0.5;
  float b = fract(sin(dot(q + 3.0, vec3(419.2, 371.9, 91.1))) * 43758.5453) - 0.5;
  return vec2(a, b);
}
`;

// Sombra de perto (prova de realismo; só nos fragmentos, depois de COMMON). `nearShadow(ponto no mundo)` devolve
// x = quanto do sol chega (0..1) e y = o peso deste mapa (1 dentro dele, caindo a 0 na borda; 0 = use o de longe).
//
// Duas ideias seguram a qualidade:
// 1) Folga mínima. Cada amostra cai no centro de um ponto do mapa e é comparada com a profundidade que o PLANO da
//    própria face tem ali (o plano sai das derivadas da posição: vale para cubo, rampa, folha e lâmina). Sem isso a
//    folga teria de cobrir o raio da penumbra e a sombra descolaria do pé das coisas.
// 2) Penumbra que cresce com a distância. Sombra de verdade é dura junto de quem a projeta (o pé do tronco) e
//    macia longe (a folha a 6 m de altura vira uma mancha de luz). O mapa só responde sim/não à comparação, então a
//    distância até quem faz sombra é medida repetindo a pergunta com a comparação 0,2 m, 0,8 m, 2,5 m e 8 m à frente:
//    enquanto a resposta for "na sombra", quem a projeta está mais longe que isso.
export const SHADOW_NEAR_GLSL = /* glsl */`
#ifdef SHADOW_NEAR
uniform highp sampler2DShadow uShadowMapN;
uniform mat4 uShadowMatrixN;
uniform vec4 uShadowInfoN;
const vec2 DISCN[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
// solto = 0: a amostra cai no centro do ponto do mapa (comparação exata, para a sombra colada no pé das coisas);
// 1: cai onde pediu e o mapa responde a média dos 4 pontos em volta (penumbra larga sem chuvisco).
float tapN(vec2 uv, vec2 c0, float z, vec2 g, float metros, float solto) {
  vec2 cen = mix((floor(uv / uShadowInfoN.x) + 0.5) * uShadowInfoN.x, uv, solto);
  return texture(uShadowMapN, vec3(cen, z + dot(g, cen - c0) - metros * uShadowInfoN.z - solto * 0.00002));
}
vec2 nearShadow(vec3 wp) {
  if (uShadowInfoN.y < 0.5) return vec2(1.0, 0.0);
  vec4 sc = uShadowMatrixN * vec4(wp, 1.0);
  vec3 c = sc.xyz / sc.w;
  float e = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
  if (e <= 0.0 || c.z >= 1.0 || c.z <= 0.0) return vec2(1.0, 0.0);
  float peso = smoothstep(0.0, 0.06, e);
  vec3 r0 = vec3(uShadowMatrixN[0][0], uShadowMatrixN[1][0], uShadowMatrixN[2][0]);
  vec3 r1 = vec3(uShadowMatrixN[0][1], uShadowMatrixN[1][1], uShadowMatrixN[2][1]);
  vec3 r2 = vec3(uShadowMatrixN[0][2], uShadowMatrixN[1][2], uShadowMatrixN[2][2]);
  vec3 ng = normalize(cross(dFdx(wp), dFdy(wp)));
  float nl = dot(ng, uLightDir);
  nl = abs(nl) < 0.12 ? (nl < 0.0 ? -0.12 : 0.12) : nl;
  vec2 g = -dot(r2, uLightDir) / nl * vec2(dot(ng, r0) / dot(r0, r0), dot(ng, r1) / dot(r1, r1));
  float tx = uShadowInfoN.x;
  float z = c.z - 0.000014 - (abs(g.x) + abs(g.y)) * tx * 0.6;
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  vec2 rv = vec2(cos(ang), sin(ang));
  mat2 rot = mat2(rv.x, rv.y, -rv.y, rv.x);
  // 1) a que distância está quem faz a sombra
  const float PASSO[5] = float[5](0.0, 0.2, 0.8, 2.5, 8.0);
  float busca = 10.0 * tx;
  float na[5];
  for (int k = 0; k < 5; k++) {
    float lit = 0.0;
    for (int j = 0; j < 3; j++) lit += tapN(c.xy + rot * DISCN[(k * 5 + j * 4) % 12] * busca, c.xy, z, g, PASSO[k], 1.0);
    na[k] = 1.0 - lit / 3.0;
  }
  float longe = na[4] * 5.0;
  for (int k = 0; k < 4; k++) longe += 0.5 * (na[k] + na[k + 1]) * (PASSO[k + 1] - PASSO[k]);
  longe /= max(na[0], 0.1);
  // 2) a penumbra abre com essa distância
  float raio = clamp(longe * uShadowInfoN.w * length(r0), 1.3 * tx, 18.0 * tx);
  float solto = smoothstep(2.0, 4.5, raio / tx);
  float s = 0.0;
  for (int i = 0; i < 12; i++) s += tapN(c.xy + rot * DISCN[i] * raio, c.xy, z, g, 0.0, solto);
  return vec2(s / 12.0, peso);
}
#endif
`;

const TERRAIN_VS = /* glsl */`
precision highp float;
in vec4 aPos;
in vec4 aDat;
#ifdef SLOPE
in vec3 aSlopeNormal;
#endif
#ifdef MC
in vec4 aUv;                       // blocos do Minecraft: uv do modelo (0..1, v = 0 no topo) · z = 1ª camada extra da animação · w = quadros×256 + ticks/quadro
out float vMcChama;
#endif
uniform mat4 modelMatrix, modelViewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
${COMMON}
${CANOPY_WIND}
out vec2 vUv;
out float vLayer;
out vec3 vLight;
out vec3 vN;
out vec3 vWorld;
out vec3 vTint;
out float vMask;
out vec4 vFog;
out float vTop;
#ifdef WATER
uniform float uSea;
out float vWaveH;
out float vWaveCrest;
out float vWaveFoam;
${TIDEWATER_VERTEX_GLSL}
#endif

const vec3 NRM[6] = vec3[6](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 lin(vec3 c) { return c * c * (c * 0.305 + 0.695); }
vec3 grassColor(vec2 cl) {
  vec3 dry = mix(vec3(0.44, 0.60, 0.40), vec3(0.74, 0.72, 0.32), smoothstep(0.35, 0.8, cl.x));
  vec3 wet = mix(vec3(0.34, 0.56, 0.39), vec3(0.34, 0.63, 0.26), cl.x);
  return lin(mix(dry, wet, smoothstep(0.2, 0.62, cl.y)));
}
vec3 leafColor(vec2 cl) {
  vec3 dry = mix(vec3(0.39, 0.50, 0.34), vec3(0.56, 0.60, 0.32), cl.x);
  vec3 wet = mix(vec3(0.29, 0.48, 0.34), vec3(0.30, 0.55, 0.22), cl.x);
  return lin(mix(dry, wet, smoothstep(0.25, 0.7, cl.y)));
}

#ifdef MC
// balanço das folhas e plantas dos blocos do Minecraft (c = tipo × 16 + peso; tools/mc/movimentos.py → world/mc-malha.js):
// o mesmo vento das copas e do capim do LAVRA. Campo contínuo no espaço: blocos vizinhos se movem juntos, sem fresta.
vec3 mcBalanco(float c, vec3 wp) {
  float k = floor(c / 16.0), w = mod(c, 16.0) / 15.0;
  vec3 v = canopyWind(wp);
  if (k < 1.5) return v;                                           // copa
  if (k < 2.5) return vec3(v.x, 0.0, v.z) * (1.4 * w);             // planta presa no chão: o pé fica, a ponta vai
  if (k < 3.5) return v * 0.6;                                     // pendurada ou em coluna
  if (k < 4.5) { float s = uTime * 0.9 + wp.x * 0.45 + wp.z * 0.35 + wp.y * 0.25; return vec3(sin(s) * 0.07, 0.0, cos(s * 0.8) * 0.05) * w; }   // submersa
  return vec3(0.0, sin(uTime * 1.3 + wp.x * 0.8 + wp.z * 1.1) * 0.012, 0.0);   // boia
}
#endif
void main() {
  vec3 p = aPos.xyz;
  int f = int(aDat.x + 0.5);
  int ni = f & 7;
  float ao = float((f >> 3) & 3);
  int special = (f >> 5) & 1;
  int lt = int(aDat.y + 0.5);
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec2 uv;
  vTop = 0.0;
#ifdef WATER
  n = NRM[ni];
  uv = p.xz;
  if (special == 1) { p.y -= 1.0 - aDat.z / 255.0; }   // desce até a superfície daquele canto (mesher: fonte 0,88; água corrente menos)
  vTop = ni == 2 ? 1.0 : 0.0;
  vWaveH = 0.0;
  vWaveCrest = 0.0;
  vWaveFoam = 0.0;
  if (ni == 2 && special == 1 && aDat.z > 215.0) {
    vec3 wp0 = (modelMatrix * vec4(p, 1.0)).xyz;
    float seaMask = uSea < -1000.0 ? 1.0 : smoothstep(1.8, 0.35, abs(wp0.y - uSea));
    if (seaMask > 0.001) {
      vec3 gN; float gCrest, gFoam;
      vec3 gDisp = twGerstnerVertex(wp0, aPos.w * seaMask, uWind, uTime, gN, gCrest, gFoam);
      p += gDisp * seaMask;
      n = normalize(mix(n, gN, seaMask));
      vWaveH = gDisp.y * seaMask;
      vWaveCrest = gCrest * seaMask;
      vWaveFoam = gFoam * seaMask;
    }
  }
#else
  if (ni < 6) {
    n = NRM[ni];
    uv = ni < 2 ? p.zy : (ni < 4 ? p.xz : p.xy);
  } else {
    float ub = float((f >> 6) & 1), vb = float((f >> 7) & 1);
    uv = vec2(ub, vb);
    vec2 base = ni == 6 ? p.xz - ub : vec2(p.x - (1.0 - ub), p.z - ub);
    vec2 wb = base + modelMatrix[3].xz;
    float h1 = hash(wb), h2 = hash(wb + 17.31);
    p.xz += (vec2(h1, h2) - 0.5) * 0.5;
    p.y -= vb * 0.3 * h2;
    // vento: uma onda larga que atravessa o campo + o tremor de cada planta
    p.xz += vb * canopyWind(vec3(wb.x,p.y,wb.y)).xz * 1.4;
    vTop = 2.0;
  }
#endif
  // Só folhagem de copa: troncos, vidro e colisões permanecem rígidos.
  // TERRAIN_VS também é usado pelo depth material: sombra acompanha a copa.
#ifdef MC
  uv = aUv.xy; vTop = 3.0; n = NRM[ni];
  vMcChama = float(special);
  float mcBal = floor(aUv.w / 65536.0);
  if (mcBal > 15.5) p += mcBalanco(mcBal, (modelMatrix * vec4(p, 1.0)).xyz);
  if (special == 1) p.y += (1.0 - aUv.y) * 0.035 * sin(uTime * 17.0 + dot(modelMatrix[3].xz + p.xz, vec2(5.3, 7.1)));   // a chama treme  // vTop 3: sem recorte de emenda, relevo ou PBR do terreno (as camadas são outra folha)
#endif
#if !defined(WATER) && !defined(MC)
  if (aPos.w >= ${TINT_D0}.0) p += canopyWind((modelMatrix * vec4(p, 1.0)).xyz);
#endif
  #ifdef SLOPE
  n = aSlopeNormal;
  #endif
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vLayer = aPos.w;
#ifdef MC
  float mcA = mod(aUv.w, 65536.0), mcQ = floor(mcA / 256.0), mcT = max(1.0, mod(mcA, 256.0));
  if (mcQ > 1.5) { float qi = mod(floor(uTime * 20.0 / mcT), mcQ); vLayer = qi < 0.5 ? aPos.w : aUv.z + qi - 1.0; }   // textura animada, 20 ticks por segundo
#endif
  vN = n;
  vWorld = wp.xyz;
  vLight = vec3(float(lt & 15) / 15.0, float(lt >> 4) / 15.0, 0.42 + 0.58 * ao / 3.0);
  vec2 cl = aDat.zw / 255.0;
  vTint = vec3(1.0);
  vMask = 0.0;
#ifdef MC
  int tm = (f >> 6) & 3;
  vTint = tm == 1 ? grassColor(cl) : tm == 2 ? leafColor(cl) : tm == 3 ? vec3(0.85, 0.05, 0.02) : vec3(1.0);
#endif
#if !defined(WATER) && !defined(MC)
  if (aPos.w >= ${TINT_D0}.0) vTint = aPos.w == ${TEX_INDEX.sakura}.0 ? vec3(1.0) : leafColor(cl);
  else if (aPos.w >= ${TINT_C0}.0) vTint = grassColor(cl);
  else if (aPos.w >= ${TINT_B0}.0) { vTint = grassColor(cl); vMask = 1.0; }
#endif
#ifdef FRAG_FOG
  vFog = vec4(0.0);
#else
  vFog = fogAt(length(mv.xyz), normalize(wp.xyz - cameraPosition), wp.y);
#endif
}
`;

// Chuva (19/11; referência do Kadmus: camper.rainyworlds.com). Anéis que a gota abre na poça: o chão é dividido em
// células e cada uma tem, a cada ciclo, um ponto de queda; o anel cresce, ondula e some. Devolve a inclinação da água.
const POCA_GLSL = /* glsl */`
#if defined(REAL) && !defined(CUTOUT) && !defined(MC)
float pocaSorte(float n) { return fract(sin(n) * 43758.5453123); }
vec2 pocaAneis(vec2 xz, float celula, float ritmo, float semente) {
  vec2 q = xz / celula, i = floor(q), f = fract(q);
  float s = i.x * 19.73 + i.y * 92.77 + semente;
  float t = fract(uTime * ritmo + pocaSorte(s + 71.7));
  vec2 d = f - (vec2(pocaSorte(s), pocaSorte(s + 11.3)) * 0.6 + 0.2);
  float r = length(d) + 1e-4, k = r - t * 0.42;
  float onda = exp(-k * k * 380.0) * sin(k * 55.0);
  return d / r * (onda * (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.06, t));
}
#endif
`;

const TERRAIN_FS = /* glsl */`
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;
uniform sampler2DArray uTex;
uniform sampler2DArray uMcTex;
uniform sampler2D uNoise;
uniform float uCloudCover, uTexSize, uSea, uWetness;
uniform vec3 uWind;
uniform vec3 cameraPosition;
uniform sampler2D uCaust, uMarMapa;
uniform vec4 uMarCaixa;
uniform vec3 uAguaCeu;
#ifdef PBR
uniform sampler2DArray uSurf;
#endif
#if defined(RELIEF) && !defined(CUTOUT)
uniform sampler2DArray uRel;
uniform vec4 uRelInfo;
#endif
#ifdef SHADOWS
uniform sampler2DShadow uShadowMap;
uniform mat4 uShadowMatrix;
uniform vec3 uShadowInfo;
#endif
#ifdef REAL
uniform vec4 uRelva, uRelvaCor, uChao;
uniform vec3 uChaoMed;
uniform sampler2D uChaoCor0, uChaoSup0, uChaoCor1, uChaoSup1, uCopa, uCascaCor, uCascaSup, uPocaMapa;
uniform vec4 uCopaInfo, uCasca, uPoca;
uniform vec3 uCascaMed;
#endif
${COMMON}
${VR_SURFACE}
${TIDEWATER_TERRAIN_GLSL}
${POCA_GLSL}
${AGUA_GLSL}
${CAUSTICA_GLSL}
in vec2 vUv;
in float vLayer;
in vec3 vLight;
in vec3 vN;
in vec3 vWorld;
in vec3 vTint;
in float vMask;
in vec4 vFog;
in float vTop;
#ifdef MC
in float vMcChama;
#endif
out vec4 outColor;

#ifdef SHADOWS
#if SHADOW_TAPS > 4
const vec2 DISC[8] = vec2[8](vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
                             vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893));
#else
const vec2 DISC[4] = vec2[4](vec2(-0.55, -0.45), vec2(0.6, -0.35), vec2(-0.4, 0.62), vec2(0.45, 0.55));
#endif
// Quanto do sol chega aqui (0..1), pelo mapa de longe. Fora do mapa, ou enquanto ele não existe, vale a estimativa pela luz do céu.
// A penumbra vem de um disco de amostras girado por pixel: borda macia sem o serrilhado em escada dos voxels.
float sunShadowFar(vec3 wp, vec3 n, float ndl, float fallback) {
  vec4 sc = uShadowMatrix * vec4(wp + n * 0.02, 1.0);
  vec3 c = sc.xyz / sc.w;
  float e = min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y));
  if (e <= 0.0 || c.z >= 1.0 || c.z <= 0.0) return fallback;
  // O mapa guarda a face que o sol vê primeiro (shadowSide = frente, em createTerrainMaterials). Cada amostra da penumbra
  // cai no centro de um texel e compara com a profundidade que o PRÓPRIO plano desta face tem ali: a folga fica em 2 cm.
  // Antes a folga tinha de cobrir o raio inteiro da penumbra (18 cm) e o mapa só tinha as faces de trás: a sombra sumia
  // junto do pé do bloco e ele parecia solto no ar.
  vec3 r0 = vec3(uShadowMatrix[0][0], uShadowMatrix[1][0], uShadowMatrix[2][0]);
  vec3 r1 = vec3(uShadowMatrix[0][1], uShadowMatrix[1][1], uShadowMatrix[2][1]);
  vec3 r2 = vec3(uShadowMatrix[0][2], uShadowMatrix[1][2], uShadowMatrix[2][2]);
  float plant = step(1.5, vTop);                       // planta em X não é um plano alinhado: fica com a folga larga
  vec2 g = -dot(r2, uLightDir) / max(dot(n, uLightDir), 0.15) * vec2(dot(n, r0) / dot(r0, r0), dot(n, r1) / dot(r1, r1));
  g *= 1.0 - plant;
  float z = c.z - mix(0.00004, 0.00035, plant) - (abs(g.x) + abs(g.y)) * uShadowInfo.x * 0.12;
  float ang = ign(gl_FragCoord.xy) * 6.2831853;
  vec2 r = vec2(cos(ang), sin(ang)) * (uShadowInfo.x * uShadowInfo.z);
  mat2 rot = mat2(r.x, r.y, -r.y, r.x);
  float s = 0.0;
  for (int i = 0; i < SHADOW_TAPS; i++) {
    vec2 cen = (floor((c.xy + rot * DISC[i]) / uShadowInfo.x) + 0.5) * uShadowInfo.x;
    s += texture(uShadowMap, vec3(cen, z + dot(g, cen - c.xy)));
  }
  s /= float(SHADOW_TAPS);
  return mix(fallback, s, smoothstep(0.0, 0.06, e) * uShadowInfo.y);
}
${SHADOW_NEAR_GLSL}
// Quanto do sol chega aqui (0..1): o mapa de perto onde ele alcança, o de longe no resto, misturados na borda.
float sunShadow(vec3 wp, vec3 n, float ndl, float fallback) {
#ifdef SHADOW_NEAR
  vec2 perto = nearShadow(wp);            // x = quanto do sol chega · y = peso (1 dentro do mapa de perto, 0 fora dele)
  if (perto.y > 0.999) return perto.x;
#endif
  float longe = sunShadowFar(wp, n, ndl, fallback);
#ifdef SHADOW_NEAR
  longe = mix(longe, perto.x, perto.y);
#endif
  return longe;
}
#endif

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  // Um pouco mais de detalhe na margem, sem afiar os mipmaps do horizonte.
  float mipBias = -.4 * (1.0-smoothstep(24.0,60.0,dist));
  // A foto do bloco não fecha nas bordas: corta-se a mesma margem de cada lado, reduzindo a foto inteira por igual,
  // para a fresta da emenda não virar um risco preto a cada metro. (Antes a margem era empurrada só perto da quina, e
  // nos dois eixos: a faixa toda lia a mesma linha da foto e saía esticada e torta em toda emenda — Kadmus, 16/11.)
  vec2 uv = vUv;
  if (vTop < 1.5) uv = floor(vUv) + 0.045 + fract(vUv) * 0.91;
  vec2 ruv = uv;
#if defined(RELIEF) && !defined(CUTOUT)
  vec2 gx = dFdx(vUv), gy = dFdy(vUv);
  float aoMap = 1.0;
  if (uRelInfo.x > 0.5 && vTop < 1.5) {
    float eyeDist = max(dist, 1e-4);
    float focus = 1.0 - smoothstep(uRelInfo.y * 0.55, uRelInfo.y, eyeDist);
    if (focus > 0.0) {
      vec3 Tr = abs(vN.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
      vec3 Br = abs(vN.y) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
      float vz = abs(dot(V, vN));
      float steps = mix(18.0, 6.0, vz);
      float dl = 1.0 / steps;
      vec2 duv = -vec2(dot(V, Tr), dot(V, Br)) / max(vz, 0.22) * (uRelInfo.z * focus) * dl;
      float cur = 0.0;
      float dep = 1.0 - textureGrad(uRel, vec3(ruv, vLayer), gx, gy).r;
      for (int i = 0; i < 18; i++) {
        if (cur >= dep) break;
        ruv += duv; cur += dl;
        dep = 1.0 - textureGrad(uRel, vec3(ruv, vLayer), gx, gy).r;
      }
      vec2 prev = ruv - duv;
      float a = dep - cur;
      float b = (1.0 - textureGrad(uRel, vec3(prev, vLayer), gx, gy).r) - (cur - dl);
      ruv = mix(ruv, prev, clamp(a / (a - b - 1e-5), 0.0, 1.0));
    }
    aoMap = textureGrad(uRel, vec3(ruv, vLayer), gx, gy).g;
  }
  vec4 tex = textureGrad(uTex, vec3(ruv, vLayer), gx, gy);
#else
#ifdef MC
  vec4 tex = texture(uMcTex, vec3(uv, vLayer), mipBias);
#else
  vec4 tex = texture(uTex, vec3(uv, vLayer), mipBias);
#endif
#endif
  vec3 albedo = tex.rgb;
#if defined(RELIEF) && !defined(CUTOUT)
  albedo *= mix(1.0, aoMap, 0.7);
#endif
  float emissive = 0.0, alpha = 1.0;
  vec3 N = vN;
#ifdef CUTOUT
  // de longe a textura reduzida perde cobertura: compensa para a copa não rarear
  vec2 du = dFdx(vUv) * uTexSize, dv = dFdy(vUv) * uTexSize;
  float lod = clamp(0.5 * log2(max(dot(du, du), dot(dv, dv)) + 1e-8), 0.0, 4.0);
  float cover = tex.a * (1.0 + lod * 0.22);
#ifdef A2C
  // com MSAA a borda do recorte vira cobertura parcial: folha e capim sem serrilhado
  alpha = clamp((cover - 0.5) / max(fwidth(cover), 1e-4) + 0.5, 0.0, 1.0);
  if (alpha < 0.03) discard;
#else
  if (cover < 0.5) discard;
#endif
  albedo *= vTint;
  if (!gl_FrontFacing && vTop < 1.5) N = -N;
#else
  float m = 1.0 - tex.a;
  albedo *= mix(vec3(1.0), vTint, vMask > 0.5 ? m : 1.0);
  emissive = vMask > 0.5 ? 0.0 : m;
#endif
#ifdef MC
  if (vMcChama > 0.5) emissive = 1.0;   // chama da tocha: luz própria
#endif
  vec3 Ng = N;                       // normal geométrica (da face)
  float rough = 0.9, metal = 0.0;
#ifdef PBR
  if (vTop < 1.5) {
    // relevo: a normal do mapa entra na base da face (as faces são alinhadas aos eixos, a base é trivial)
#if defined(RELIEF) && !defined(CUTOUT)
    vec4 sf = textureGrad(uSurf, vec3(ruv, vLayer), gx, gy);
#else
    vec4 sf = texture(uSurf, vec3(uv, vLayer));
#endif
    vec3 T = abs(Ng.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 B = abs(Ng.y) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vec2 nxy = sf.xy * 2.0 - 1.0;
    float seam = min(min(fract(ruv.x), 1.0 - fract(ruv.x)), min(fract(ruv.y), 1.0 - fract(ruv.y)));
    nxy *= smoothstep(0.0, 0.06, seam);
    N = normalize(T * nxy.x + B * nxy.y + Ng * sqrt(max(0.08, 1.0 - dot(nxy, nxy))));
    rough = sf.z; metal = sf.w;
  }
#endif
  // quebra a repetição: variação larga pelo mundo e grão fino pelo bloco
  vec4 macroN = texture(uNoise, vWorld.xz * 0.013 + vWorld.y * 0.009);
  float macro = macroN.r;
  albedo *= 0.84 + 0.32 * macro;
#ifdef DETAIL
  albedo *= 0.9 + 0.2 * texture(uNoise, ruv * 3.0).g;
#endif

  float relvaK = 0.0, chaoK = 0.0;   // chaoK: quanto do chão fotografado está valendo neste ponto (0 longe … 1 perto)
#if defined(REAL) && !defined(CUTOUT) && !defined(MC)
  if (uCasca.x > 0.5 && (abs(vLayer - ${TEX_INDEX.log_side}.0) < 0.5 || abs(vLayer - ${TEX_INDEX.pine_side}.0) < 0.5)) {
    // Casca escaneada (render/real-chao.js). O tronco troca a foto de 1 m por casca de verdade, com os sulcos em relevo
    // sob a luz. O desenho vem da foto; o tom continua o da madeira do bloco (carvalho quente, pinheiro escuro).
    float kb = 1.0 - smoothstep(uCasca.z * 0.6, uCasca.z, dist);
    if (kb > 0.001) {
      vec2 ub = vUv / uCasca.y;
      vec3 cb = texture(uCascaCor, ub).rgb, sb = texture(uCascaSup, ub).rgb;
      const vec3 PESO = vec3(0.3, 0.55, 0.15);
      vec3 doBloco = textureLod(uTex, vec3(0.5, 0.5, vLayer), 9.0).rgb;      // cor média da madeira deste bloco
      float lb = max(dot(cb, PESO), 1e-3), lm = max(dot(uCascaMed, PESO), 1e-3), ld = max(dot(doBloco, PESO), 1e-3);
      vec3 novo = (cb / lm) * ld * 0.82 * mix(vec3(1.0), (doBloco / ld) / (uCascaMed / lm), 0.55);
      albedo = mix(albedo, novo * (0.84 + 0.32 * macro), kb);
      // base tangente pelas derivadas: vale para o tronco redondo, o galho inclinado e a tora em pé
      vec3 dp1 = dFdx(vWorld), dp2 = dFdy(vWorld);
      vec2 du1 = dFdx(ub), du2 = dFdy(ub);
      vec3 p2 = cross(dp2, Ng), p1 = cross(Ng, dp1);
      vec3 Tb = p2 * du1.x + p1 * du2.x, Bb = p2 * du1.y + p1 * du2.y;
      float im = inversesqrt(max(max(dot(Tb, Tb), dot(Bb, Bb)), 1e-12));
      vec2 nb = (sb.xy * 2.0 - 1.0) * (uCasca.w * kb);
      N = normalize(Tb * (im * nb.x) + Bb * (im * nb.y) + Ng);
      rough = mix(rough, max(sb.z, 0.86), kb);
    }
  }
  if (uCasca.x > 0.5 && (abs(vLayer - ${TEX_INDEX.log_top}.0) < 0.5 || abs(vLayer - ${TEX_INDEX.pine_top}.0) < 0.5)) {
    // Topo da tora: anéis de crescimento desenhados por conta (miolo fora do centro, anéis que ondulam, cerne escuro,
    // rachas de secagem, fibra serrada e o anel da casca), no tom da madeira do bloco. De longe volta a foto de sempre.
    float kt = 1.0 - smoothstep(uCasca.z * 0.35, uCasca.z * 0.7, dist);
    if (kt > 0.001) {
      vec2 q = fract(vUv) - 0.5, qc = q - vec2(0.035, -0.022);
      float ang = atan(qc.y, qc.x), nz = texture(uNoise, q * 1.9 + 0.23).r, fino = texture(uNoise, q * 21.0).g;
      float r = length(qc) * (1.0 + 0.07 * sin(ang * 3.0 + 1.3) + 0.03 * sin(ang * 7.0 + 0.4)) + (nz - 0.5) * 0.022;
      float anel = smoothstep(0.2, 0.9, 0.5 + 0.5 * sin(r * 132.0 + 1.6 * sin(r * 31.0)));
      vec3 madeira = textureLod(uTex, vec3(0.5, 0.5, vLayer), 9.0).rgb;
      float cerne = 1.0 - smoothstep(0.1, 0.27, r);
      vec3 cor = madeira * mix(1.2, 0.66, anel * 0.5 + cerne * 0.3);
      float racha = pow(abs(sin(ang * 4.0 + nz * 5.0)), 90.0) * smoothstep(0.03, 0.2, r) * (1.0 - smoothstep(0.3, 0.46, r));
      cor *= (1.0 - 0.6 * racha) * (0.9 + 0.2 * fino);
      cor = mix(cor, madeira * 0.22, smoothstep(0.452, 0.474, length(q)));
      albedo = mix(albedo, cor * (0.84 + 0.32 * macro), kt);
      rough = mix(rough, 0.8, kt);
    }
  }
  if (abs(vLayer - ${TINT_C0}.0) < 0.5 && Ng.y > 0.5) {
    // Chão fotografado (render/real-chao.js). Perto de quem olha, o topo do gramado deixa de ser a foto de 1 m repetida
    // em cada bloco: lê um chão de mata escaneado (grama rala, terra batida, gravetos) pelas coordenadas do mundo.
    float kc = uChao.x * (1.0 - smoothstep(uChao.y * 0.5, uChao.y, dist));
    if (kc > 0.001) {
      vec2 pc = vWorld.xz;
      chaoK = kc;
#ifdef REAL_LEVE
      // celular e visor: a cor em duas leituras (escalas e giros diferentes, misturadas pela mancha larga que o terreno
      // já leu), o relevo numa só — o ladrilho de 2 m não aparece repetido e a conta fica mais curta
      vec2 ua = pc / uChao.z, ub = (mat2(0.8, 0.6, -0.6, 0.8) * pc) / (uChao.z * 1.31) + vec2(0.37, 0.61);
      float mb = smoothstep(0.38, 0.62, macroN.b);
      vec3 c0 = mix(texture(uChaoCor0, ua).rgb, texture(uChaoCor0, ub).rgb, mb);
      vec3 sa = texture(uChaoSup0, ua).rgb;
      vec2 n0 = sa.xy * 2.0 - 1.0;
      float r0 = sa.z;
#else
      // duas leituras, em escalas e giros diferentes, misturadas por uma mancha larga: o ladrilho de 2 m não aparece repetido
      vec2 ua = pc / uChao.z, ub = (mat2(0.8, 0.6, -0.6, 0.8) * pc) / (uChao.z * 1.31) + vec2(0.37, 0.61);
      float mb = smoothstep(0.38, 0.62, texture(uNoise, pc * 0.023 + 0.11).b);
      vec3 c0 = mix(texture(uChaoCor0, ua).rgb, texture(uChaoCor0, ub).rgb, mb);
      vec3 sa = texture(uChaoSup0, ua).rgb, sb = texture(uChaoSup0, ub).rgb;
      vec2 n0 = mix(sa.xy * 2.0 - 1.0, mat2(0.8, -0.6, 0.6, 0.8) * (sb.xy * 2.0 - 1.0), mb);
      float r0 = mix(sa.z, sb.z, mb);
#endif
      // A foto dá o desenho (claro e escuro, graveto, tufo); a COR é a do gramado daquele lugar (foto do bloco × clima):
      // de longe o gramado é o mesmo de sempre, e bioma seco continua seco. Do tom da foto fica só uma parte do desvio
      // em relação à média dela (o graveto segue mais pardo que a grama, a grama viva mais verde).
      const vec3 PESO = vec3(0.3, 0.55, 0.15);
      vec3 alvo = uRelvaCor.rgb * vTint * (0.84 + 0.32 * macro);
      float lc = max(dot(c0, PESO), 1e-3), lm = max(dot(uChaoMed, PESO), 1e-3);
      float lum = lc / lm; lum = mix(lum, lum * lum, 0.3);
      vec3 desvio = (c0 / lc) / (uChaoMed / lm);
      // o que na foto é verde toma quase toda a cor do lugar; terra batida, palha e graveto guardam mais da cor deles
      float verde = smoothstep(-0.012, 0.04, c0.g - max(c0.r, c0.b) * 0.93);
      vec3 novo = alvo * lum * mix(vec3(1.0), desvio, mix(0.72, 0.36, verde));
      // debaixo da copa a grama rareia e o chão é de folha seca (uCopa: folhagem por coluna, em volta de quem olha)
      float copa = uCopaInfo.w * texture(uCopa, (pc - uCopaInfo.xy) * uCopaInfo.z).r * 255.0;
      if (copa > 0.001) {
        copa = clamp(copa * 0.5 - 0.15 + (texture(uNoise, pc * 0.13).g - 0.5) * 0.9, 0.0, 1.0);
        vec2 uc = pc / uChao.w;
        vec3 c1 = texture(uChaoCor1, uc).rgb, s1 = texture(uChaoSup1, uc).rgb;
        novo = mix(novo, c1 * 2.2, copa);
        n0 = mix(n0, s1.xy * 2.0 - 1.0, copa);
        r0 = mix(r0, s1.z, copa);
      }
      albedo = mix(albedo, novo, kc);
      n0 *= 1.6 * kc;
      N = normalize(vec3(n0.x, 0.0, n0.y) + Ng * sqrt(max(0.1, 1.0 - dot(n0, n0))) + (N - Ng) * (1.0 - kc));
      rough = mix(rough, r0, kc);
    }
    // relva viva (render/relva.js): por baixo das lâminas o gramado é chão sombreado; some com elas, pela mesma curva.
    // Visto de cima quase não há lâmina na frente: o chão fica mais claro para o gramado não escurecer de pé.
    relvaK = relvaDens(uRelva, dist);
    albedo *= mix(1.0, mix(0.5, 0.82, max(V.y, 0.0)), relvaK);
  }
#endif
  float sky = vLight.x, blk = vLight.y, ao = vLight.z;
  float fwXZ = max(length(dFdx(vWorld.xz)), length(dFdy(vWorld.xz)));
  // Debaixo do mar do arquipélago (24/11/2026): a luz do céu dos blocos perde 1 por bloco de água e a 15 m de fundura é
  // zero; o fundo do mar ficava preto. Ali a luz vem da coluna d'água (marK). Terra adentro (mina, porão, caverna abaixo
  // do nível do mar) não é mar: a distância à costa do mapa do oceano separa as duas coisas.
  float wd = uSea - vWorld.y, uw = 0.0, marK = 0.0;
  if (wd > 0.0 && uMarNovo > 0.5) {
    vec2 um = (vWorld.xz - uMarCaixa.xy) * uMarCaixa.zw;
    vec2 tm = vec2(textureSize(uMarMapa, 0));
    float costa = (um.x >= 0.0 && um.y >= 0.0 && um.x <= 1.0 && um.y <= 1.0) ? textureLod(uMarMapa, (um * (tm - 1.0) + 0.5) / tm, 0.0).g : 600.0;
    marK = smoothstep(0.0, 0.3, wd) * smoothstep(-4.0, 2.0, costa);
  }
  float isSandLayer = (abs(vLayer - ${TEX_INDEX.sand}.0) < 0.5 || abs(vLayer - ${TEX_INDEX.sandstone}.0) < 0.5) && vTop < 1.5 ? 1.0 : 0.0;
  // Sedimento: no mar, o que olha para cima abaixo de ~2 m de fundura fica coberto de areia clara e ondulada (o fundo
  // de basalto, argila e cascalho continua lá: é só a pele). Sem isto o fundo de 30 m era quase preto e listrado, e a
  // rede de luz do sol não tinha onde aparecer. Parede e degrau seguem mostrando a rocha.
  float sedimento = isSandLayer > 0.5 || vTop > 1.5 ? 0.0 : marK * smoothstep(0.55, 0.9, Ng.y) * smoothstep(1.5, 6.0, wd);
  if (sedimento > 0.01) {
    albedo = mix(albedo, vec3(0.60, 0.53, 0.38), sedimento);
    rough = mix(rough, 0.94, sedimento);
    metal *= 1.0 - sedimento;
    emissive *= 1.0 - sedimento;
    // a areia assenta macia por cima das rampas e degraus: a luz não segue cada faceta do bloco (visto através da água
    // clara, o fundo em rampa virava uma colcha de losangos) nem as quinas escurecidas de cada degrau
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), sedimento * 0.8));
    Ng = normalize(mix(Ng, vec3(0.0, 1.0, 0.0), sedimento * 0.8));
    ao = mix(ao, 1.0, sedimento * 0.75);
    isSandLayer = sedimento;
  }
  float swashFoamTerrain = 0.0;
  twApplySandAndShore(vWorld, Ng, uSea, uWind, uTime, dist, isSandLayer, fwXZ, albedo, N, rough, swashFoamTerrain);
  // Água sobre a superfície exposta (chuva e borda úmida costeira): escurece e reduz a rugosidade.
  float shoreWet=smoothstep(0.65,-0.35,vWorld.y-uSea)*smoothstep(-4.0,-0.1,vWorld.y-uSea);
  float pocaK = 0.0;                  // quanto deste ponto é poça (espelho do céu); só com a chuva de render/chuva.js
#if defined(REAL) && !defined(CUTOUT) && !defined(MC)
  // Chão molhado (19/11). A chuva chega onde o céu alcança e pouco debaixo de copa; parede molha menos que piso. O que
  // é áspero bebe a água: escurece e ganha cor, mas não vira espelho (grama e terra molhadas não brilham como plástico);
  // pedra, tábua e metal ficam lisos e devolvem o céu.
  float aberto = smoothstep(.78, .98, sky);
  aberto *= 1.0 - 0.8 * clamp(uCopaInfo.w * texture(uCopa, (vWorld.xz - uCopaInfo.xy) * uCopaInfo.z).r * 255.0 * 0.6, 0.0, 1.0);
  float wet = uWetness * aberto * (0.3 + 0.7 * max(Ng.y, 0.0));
  float totalWet = max(wet, shoreWet * 0.85 * (1.0 - isSandLayer * 0.65));
  float poroso = smoothstep(0.5, 0.92, rough);
  float lumW = dot(albedo, vec3(0.3, 0.55, 0.15));
  albedo = mix(vec3(lumW), albedo, 1.0 + 0.22 * totalWet) * (1.0 - totalWet * mix(0.14, 0.32, poroso));
  rough = mix(rough, max(0.14, rough * mix(0.38, 0.7, poroso)), totalWet * 0.8);
  // Enxurrada (temporal, uPoca.z): nas rampas a céu aberto a água corre morro abaixo em veios barrentos. Só desenho:
  // não há água de verdade no mundo (ela viraria edição gravada; fica para quando houver água passageira no servidor).
  if (uPoca.z > 0.01 && Ng.y > 0.45 && Ng.y < 0.985 && vTop < 0.5 && aberto > 0.05) {
    vec2 desce = normalize(-Ng.xz + vec2(1e-5));
    float ao_longo = dot(vWorld.xz, desce) - vWorld.y * 0.6, atraves = dot(vWorld.xz, vec2(-desce.y, desce.x));
    atraves += 0.22 * sin(ao_longo * 0.9 + atraves * 0.7);                                   // o veio serpenteia
    float veio = texture(uNoise, vec2(atraves * 0.6, ao_longo * 0.05 - uTime * 0.1)).r;
    float fino = texture(uNoise, vec2(atraves * 2.6, ao_longo * 0.17 - uTime * 0.4)).g;
    float corre = smoothstep(0.54, 0.76, veio * 0.66 + fino * 0.34) * uPoca.z * aberto * smoothstep(0.9, 0.99, sky);
    // água barrenta: escurece o chão e leva a cor da terra; brilha pouco (não é espelho, é água revolta)
    albedo = mix(albedo, albedo * 0.5 + vec3(0.085, 0.066, 0.04), corre * 0.8);
    albedo = mix(albedo, vec3(0.34, 0.31, 0.25) * (0.4 + 0.6 * sky), smoothstep(0.8, 0.95, fino) * corre * 0.42);   // espuma
    rough = mix(rough, 0.34, corre * 0.75);
  }
  // Poças: no piso plano a céu aberto, onde a água junta — nas bacias (uPocaMapa: piso sem vizinho mais baixo por onde
  // escorrer; some na direção de onde a água escoa) e, dentro delas, em manchas largas de ruído puxadas para o pé de
  // degrau e de parede. Enchem aos poucos com a chuva e secam devagar (uPoca.x). Só perto: o mapa cobre 64 × 64 m.
  // O mapa fala do topo da coluna: só vale onde o céu está direto em cima (luz do céu cheia). Debaixo de telhado e de
  // copa o piso não empoça, mesmo que o telhado lá em cima seja uma bacia.
  float ceuAberto = smoothstep(0.93, 0.995, sky);
  float bacia = uPoca.x > 0.01 && Ng.y > 0.985 && vTop < 0.5 && isSandLayer < 0.5 && ceuAberto * aberto > 0.02   // vTop 0 = face de bloco (planta = 2, bloco MC = 3)
    ? smoothstep(0.35, 0.9, texture(uPocaMapa, vWorld.xz / 64.0).r) * (1.0 - smoothstep(22.0, 28.0, length(vWorld.xz - cameraPosition.xz))) * ceuAberto : 0.0;
  if (bacia > 0.01) {
    float junta = texture(uNoise, vWorld.xz * 0.021 + 0.37).g * 0.62 + texture(uNoise, vWorld.xz * 0.11 + 0.71).r * 0.38 + (1.0 - ao) * 0.35;
    float gramado = abs(vLayer - ${TINT_C0}.0) < 0.5 ? 1.0 : 0.0;
    float lim = mix(0.84, 0.56, uPoca.x * bacia) + gramado * 0.1 - 0.14 * uPoca.z * bacia;    // o gramado bebe mais; na enxurrada a poça transborda
    albedo *= 1.0 - 0.22 * smoothstep(lim - 0.08, lim, junta) * aberto;                       // a beira encharcada
    pocaK = smoothstep(lim, lim + 0.035, junta) * aberto;
    if (pocaK > 0.001) {
      vec2 incl = (texture(uNoise, vWorld.xz * 0.9 + uTime * vec2(0.05, 0.035)).rg - 0.5) * 0.03;   // marolinha do vento
      float perto = 1.0 - smoothstep(18.0, 30.0, dist);
      if (uPoca.y > 0.02 && perto > 0.0) incl += (pocaAneis(vWorld.xz, 0.55, 1.1, 0.0) + pocaAneis(vWorld.xz, 0.31, 1.6, 913.0) * 0.7) * (0.35 * uPoca.y * perto);
      N = normalize(mix(N, normalize(vec3(-incl.x, 1.0, -incl.y)), pocaK));
      albedo = mix(albedo, albedo * vec3(0.5, 0.55, 0.62), pocaK);
      rough = mix(rough, 0.035, pocaK);
      metal *= 1.0 - pocaK;
    }
  }
#else
  float wet=uWetness*smoothstep(.78,.98,sky)*max(Ng.y,0.0);
  float totalWet=max(wet,shoreWet*0.85*(1.0-isSandLayer*0.65));
  albedo*=1.0-totalWet*.16;
  rough=mix(rough,max(.18,rough*.45),totalWet*.7);
#endif
  // Visor: jateado fosco. Reflexo liso estoura em branco na lente e apaga o contraste.
  albedo *= vrGrain(vWorld);
  if (uHeadset > 0.5) {
    rough = mix(rough, 0.94, 0.92);
    metal *= 0.2;
    vec3 Tg = abs(Ng.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 Bg = abs(Ng.y) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    float fw = fwidth(vWorld.x * 380.0);
    float kg = 1.0 - smoothstep(0.5, 1.6, max(fw, 1e-4));
    N = normalize(N + (Tg * vrGrainN(vWorld).x + Bg * vrGrainN(vWorld).y) * 0.22 * kg);
  }
  float skyEst = smoothstep(0.5, 0.95, sky);
  float sunVis = skyEst;
  float ndlG = max(dot(Ng, uLightDir), 0.0);
  float ndl = max(dot(N, uLightDir), 0.0);
#ifdef SHADOWS
  sunVis = sunShadow(vWorld, Ng, ndlG, mix(sunVis, 1.0, marK)) * mix(smoothstep(0.0, 0.2, sky), 1.0, marK);
#else
  sunVis = mix(sunVis, 1.0, marK);
#endif
#ifdef CUTOUT
  float vegetation = (vLayer >= ${TINT_C0}.0 || vTop > 1.5) ? 1.0 : 0.0;
  // Folhas recebem luz pelas bordas, sem iluminar vidro como se fosse vegetação.
  ndl = mix(ndl, max(0.0,(dot(N,uLightDir)+0.35)/1.35),0.65*vegetation);
#endif
#ifdef CLOUD_SHADOWS
  float cn = texture(uNoise, vWorld.xz * 0.0016 + uTime * vec2(0.0034, 0.0013)).r * 0.6
           + texture(uNoise, vWorld.xz * 0.0041 + uTime * vec2(0.005, 0.002)).g * 0.4;
  sunVis *= 1.0 - 0.5 * smoothstep(uCloudCover, uCloudCover + 0.2, cn);
#endif
  // debaixo d'água: a luz do sol chega em rede (cáusticas) e a cor some com a profundidade, o vermelho primeiro.
  // Fora do mar do arquipélago (lago, rio, mundo sem mapa) vale a rede de sempre; no mar, a de refração (uCaust).
  vec3 causticsCol = vec3(1.0);
#ifdef CAUSTICS
  if (wd > 0.0) {
    uw = smoothstep(0.0, 0.25, wd) * (1.0 - smoothstep(0.94, 0.995, sky));
    if (marK < 0.999) causticsCol = mix(vec3(1.0), twCausticsSample(vWorld, wd, uLightDir, uWind, uTime, fwXZ), uw * (1.0 - 0.45 * uMarNovo) * (1.0 - marK));
    if (marK > 0.001) causticsCol *= mix(1.0, causticaDoMar(vWorld, uSea, dist), marK);
  }
#endif
  vec3 solCor = uSunColor;
  vec3 direct = uSunColor * ndl * sunVis * causticsCol;
  vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * (sky * (0.25 + 0.75 * sky));
  if (marK > 0.001) {
    // sol direto: atenuado pelo caminho dentro d'água, mais difuso que no ar (a água espalha) · luz de cima: o céu visto
    // de dentro d'água, atenuado pela fundura, mais um pouco do sol que o fundo claro devolve para o que olha para baixo
    solCor = uSunColor * aguaSol(wd, uLightDir.y);
    float cima = N.y * 0.5 + 0.5;
    vec3 directMar = solCor * (clamp((dot(N, uLightDir) + 0.22) / 1.22, 0.0, 1.0) * sunVis) * causticsCol;
    vec3 ambMar = uAguaCeu * aguaCeu(wd) * (0.22 + 0.78 * cima) + solCor * vec3(0.05, 0.046, 0.034) * (1.0 - cima);
    direct = mix(direct, directMar, marK);
    amb = mix(amb, ambMar, marK);
    solCor = mix(uSunColor, solCor, marK);
  }
  // tocha: tremula de leve e esquenta a cor conforme a luz se afasta da chama
  float flick = 1.0 + 0.05 * sin(uTime * 8.3 + dot(vWorld, vec3(0.9, 1.3, 0.7))) * sin(uTime * 3.1 + vWorld.x * 0.4);
  vec3 torch = uTorch * mix(vec3(1.0, 0.7, 0.4), vec3(1.0), blk) * (blk * blk * flick);
  vec3 lit = direct * (0.5 + 0.5 * ao) + (amb + torch + uMinAmb) * ao;
  // brilho próprio: a cor entra ao quadrado, para a lanterna continuar âmbar (e o cristal, ciano) em vez de estourar em branco
  vec3 col = albedo * (1.0 - 0.85 * metal) * lit + albedo * albedo * emissive * 3.8;
  swashFoamTerrain *= 1.0 - uMarNovo;   // no arquipélago, a espuma da beira é do oceano novo (não dobra)
  if (swashFoamTerrain > 0.005) {
    vec3 swFoamCol = vec3(0.92, 0.96, 0.99) * (uAmbSky * 1.15 + uSunColor * (0.38 * sunVis) + uMinAmb);
    col = mix(col, swFoamCol, swashFoamTerrain * 0.85 * (1.0 - uHeadset * 0.5));
  }
#ifdef CUTOUT
  // folha contra o sol deixa a luz passar: brilho amarelo-esverdeado na copa e no capim
  float back = max(dot(V, -uLightDir), 0.0); back *= back; back *= back;
  col += albedo * uSunColor * vec3(1.0, 0.95, 0.6) * (back * mix(0.38, 0.16, uHeadset) * skyEst * (0.2+0.8*sunVis) * vegetation);
#else
  // relva rasante: olhando quase paralelo ao chão ela clareia (as pontas das folhas pegam o céu)
  if (vLayer > ${TINT_B0}.0 - 0.5 && Ng.y > 0.5) {
    // O ângulo é o do olhar com a FACE (antes era só a altura do olhar: uma rampa de frente para quem olha, vista na
    // horizontal, pegava o clarão inteiro e o gramado ficava com um brilho esbranquiçado, de plástico — Kadmus, 19/11).
    float fz = 1.0 - max(dot(V, Ng), 0.0); fz *= fz; fz *= fz;
    // onde há lâminas de verdade, são elas que pegam o céu; no celular e no visor (sem lâminas) o chão fotografado é
    // que faz esse papel: perto de quem olha ele fica fosco como no PC
    float fosco = relvaK;
#ifdef REAL_LEVE
    fosco = max(fosco, chaoK);
#endif
    fz *= 1.0 - fosco;
    col += albedo * (uAmbSky * 0.9 + uSunColor * (0.3 * sunVis)) * (fz * mix(0.55, 0.12, uHeadset) * sky);
    // Faísca estreita do sol: no visor vira ponto branco. Fica só fora do VR.
    float perto = 1.0 - smoothstep(8.0, 14.0, dist);
    vec3 Hg = normalize(V + uLightDir);
    float spark = pow(max(dot(N, Hg), 0.0), 36.0) * sunVis * sky * perto * (1.0 - uHeadset) * (1.0 - fosco);
    float trem = 0.7 + 0.3 * sin(uTime * 1.6 + vWorld.x * 2.7 + vWorld.z * 3.3);
    col += uSunColor * vec3(1.0, 0.97, 0.86) * spark * trem * 0.42;
  }
#endif
#if defined(PBR) && !defined(CUTOUT)
  // brilho: reflexo do sol (GGX) e do céu, mais fortes em superfície lisa ou metálica
  // (folhas e plantas ficam de fora: relevo fino + brilho vira faísca branca à distância)
  vec3 H = normalize(V + uLightDir);
  float a2 = rough * rough; a2 *= a2;
  float nh = max(dot(N, H), 0.0);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float D = min(a2 / (3.14159 * d * d), 24.0);
  float f0 = mix(0.04, 1.0, metal);
  float fh = f0 + (1.0 - f0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
  vec3 specCol = mix(vec3(1.0), albedo, metal);
  vec3 R = reflect(-V, N);
  float fn = f0 + (1.0 - f0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float smooth2 = (1.0 - rough) * (1.0 - rough);
  vec3 spec = solCor * (D * fh * 0.25) * ndl * sunVis + skyBase(vec3(R.x, abs(R.y), R.z)) * fn * smooth2 * sky * (1.0 - pocaK);
  col += specCol * spec * ao;
#endif
#if defined(REAL) && !defined(CUTOUT) && !defined(MC)
  if (pocaK > 0.001) {
    // espelho d'água: de cima vê-se o fundo, de lado o céu (Fresnel um pouco mais generoso que o da água, para a poça
    // se ler a meia distância). No visor o espelho é mais contido: reflexo liso estoura na lente.
    vec3 Rp = reflect(-V, N);
    float fp = 0.06 + 0.94 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
    col = mix(col, skyBase(vec3(Rp.x, abs(Rp.y), Rp.z)) * sky, pocaK * fp * mix(1.0, 0.6, uHeadset));
  }
#endif
  col *= mix(vec3(1.0), exp(-max(wd, 0.0) * vec3(0.2, 0.06, 0.04)), uw * (1.0 - marK));   // no mar a fundura já entrou na luz
  // Dispersão angular discreta em cristais/gelo. Aproximação de superfície;
  // não simula cáusticas refratadas através de todo o volume do mundo.
  if(vLayer==${TEX_INDEX.crystal_ore}.0 || vLayer==${TEX_INDEX.phantom_crystal}.0 || vLayer==${TEX_INDEX.ice}.0) {
    float angle=dot(reflect(-V,N),uLightDir);
    vec3 band=max(vec3(0.0),vec3(1.0)-abs(vec3(angle)-vec3(.985,.975,.965))*70.0);
    col+=band*band*uSunColor*sunVis*mix(.11,.03,uHeadset)*(1.0-metal);
  }

#ifdef FRAG_FOG
  vec4 fog = fogAt(dist, -V, vWorld.y);
#else
  vec4 fog = vFog;
#endif
  col = mix(col, fog.rgb, fog.a);
  outColor = vec4(finish(col), alpha);
}
`;

// Passo de sombra: só profundidade (e o recorte das folhas e plantas).
const DEPTH_FS = /* glsl */`
precision highp float;
precision highp sampler2DArray;
#ifdef CUTOUT
uniform sampler2DArray uTex;
uniform sampler2DArray uMcTex;
in vec2 vUv;
in float vLayer;
#endif
#if defined(CUTOUT) && defined(REAL) && !defined(MC)
uniform sampler2D uNoise;
uniform vec3 uLightDir;
uniform float uTime;
in vec3 vWorld;
#endif
out vec4 outColor;
void main() {
#ifdef CUTOUT
#ifdef GLASS_SHADOW
  if(abs(vLayer-${TEX_INDEX.glass_mirror}.0)>.5) discard;
#endif
#ifdef MC
  if (texture(uMcTex, vec3(vUv, vLayer)).a < 0.5) discard;
#else
  if (texture(uTex, vec3(vUv, vLayer)).a < 0.5) discard;
#endif
#if defined(REAL) && !defined(MC)
  // Frestas de sol (prova de realismo). Copa de verdade não é um bloco maciço: deixa passar manchas de luz. As
  // frestas são colunas na direção da luz (o mesmo desenho em todas as camadas de folha, senão uma camada tapava o
  // buraco da outra) e balançam devagar, como a copa ao vento. Só no passo de sombra: a copa que se vê não muda.
  if (vLayer >= ${TINT_D0}.0) {
    vec3 ex = normalize(cross(vec3(0.0, 1.0, 0.0), uLightDir));
    vec3 ey = cross(uLightDir, ex);
    vec2 q = vec2(dot(vWorld, ex), dot(vWorld, ey));
    q += 0.05 * vec2(sin(uTime * 0.7 + q.y * 0.9), cos(uTime * 0.53 + q.x * 1.1));
    // manchas largas e lisas (o ruído é lido borrado): fresta miúda vira chuvisco na penumbra
    float f = texture(uNoise, q * 0.19, 2.6).r * 0.7 + texture(uNoise, q * 0.47 + 0.31, 2.2).g * 0.3;
    if (f > 0.585) discard;
  }
#endif
#endif
  outColor = vec4(1.0);
}
`;

const WATER_FS = /* glsl */`
precision highp float;
precision highp int;
uniform sampler2D uNoise;
uniform vec3 cameraPosition;
uniform vec3 uWaterColor, uWaterShallow;
uniform vec3 uWind;          // xy direção, z força (0,28 calmo .. 1,8 temporal)
${COMMON}
${VR_SURFACE}
${WATER_REFLECTION}
${TIDEWATER_WATER_GLSL}
#ifdef WATER_CLOUDS
${CLOUDS}
#endif
in vec3 vLight;
in vec3 vN;
in vec3 vWorld;
in vec4 vFog;
in float vTop;
in float vLayer;       // no topo: profundidade da água naquele canto (0 = margem, 7 = fundo)
in float vWaveH;
in float vWaveCrest;
in float vWaveFoam;
out vec4 outColor;

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 1e-4);
  vec3 N = vN;
  vec2 uv = vWorld.xz;
  float depth = 1.0;
  // 0 na neblina, ~0,34 no dia claro, 1 na chuva forte. Vale para a onda e para a espuma.
  float energy = clamp((uWind.z - 0.35) / 1.45, 0.0, 1.0);
  float blocks = vLayer;
  // Derivadas de tela avaliadas em fluxo uniforme (WebGL2/GLSL 300 es)
  float dDx = dFdx(blocks), dDy = dFdy(blocks);
  vec2 wx = vec2(dFdx(vWorld.x), dFdx(vWorld.z));
  vec2 wy = vec2(dFdy(vWorld.x), dFdy(vWorld.z));
  float footprint = max(length(wx) + length(wy), 1e-4) * 0.5;
  float rise = 0.0, known = 1.0, steep = 0.0;
  vec2 wind = uWind.xy;
  float wlen = dot(wind, wind);
  wind = wlen > 1e-4 ? wind * inversesqrt(wlen) : vec2(0.83, 0.55);
  vec2 shoreDir = wind;

  TwSeaDetail det = TwSeaDetail(1.0, 0.5, 0.0, 0.0);
  TwShoreWave sw = TwShoreWave(vec3(0.0, 1.0, 0.0), 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, wind * 0.5);

  if (vTop > 0.5) {
    depth = clamp(blocks / 7.0, 0.0, 1.0);
    // Inclinação da profundidade em blocos por metro. Parede é íngreme; praia é mansa.
    float detMat = wx.x * wy.y - wy.x * wx.y;
    float inv = abs(detMat) > 1e-8 ? 1.0 / detMat : 0.0;
    vec2 gradDepth = vec2(
      (dDx * wy.y - wy.x * dDy) * inv,
      (wx.x * dDy - wx.y * dDx) * inv
    );
    rise = min(length(gradDepth), 12.0);
    known = abs(detMat) > 1e-8 ? 1.0 : 0.0;
    steep = smoothstep(0.8, 3.5, rise);
    if (rise > 0.025) shoreDir = normalize(-gradDepth);

    float deep = smoothstep(0.08, 0.7, depth);
    float room = (1.0 - steep) * deep;
    float fade = 1.0 / (1.0 + dist * 0.02);

    // SeaDetail.js: rajadas (cat's paws), slicks de surfactante e faixas de Langmuir
    det = twSeaDetailSample(uv, wind, energy, uTime);

    // Cascata de derivadas de ondas (swell longo + chop cruzado + ondulação capilar de campo próximo)
    float speed = mix(0.14, 0.4, deep) * mix(0.6, 1.0, energy);
    vec2 swellUv = uv * mix(0.32, 0.09, room) - wind * uTime * speed;
    float swell = texture(uNoise, swellUv).r - 0.5;
    float swellA = (0.025 + 0.14 * energy) * mix(0.35, 1.0, room);
    vec2 slope = wind * swell * swellA;
#ifdef WAVE_CHOP
    vec2 side = vec2(-wind.y, wind.x);
    vec2 chopUv = uv * mix(0.95, 0.34, deep) - wind * uTime * speed * 1.3 + side * uTime * 0.04;
    float chop = texture(uNoise, chopUv).g - 0.5;
    float cross = texture(uNoise, chopUv.yx + 0.37).a - 0.5;
    float chopA = (0.028 + 0.12 * energy) * mix(1.25, 0.7, deep) * det.rough * fade;
    slope += (wind * chop + side * cross) * chopA;
#else
    slope += wind * swell * (0.02 + 0.08 * energy) * mix(1.0, 0.35, deep) * fade;
#endif
#ifdef WAVE_CAP
    vec2 capUv = uv * 1.7 - wind * uTime * 0.5;
    float cap = texture(uNoise, capUv).b - 0.5;
    float capA = (0.020 + 0.040 * energy) * det.rough * fade;
    slope += vec2(cap, cross) * capA;
    // Ripples capilares de campo próximo rotacionados (WaterSurface.js linhas 297-305: 0.63 rad e 2.14 rad)
    float nearCap = smoothstep(0.08, 0.015, footprint) * det.rough * (1.0 - uHeadset);
    if (nearCap > 0.002) {
      vec2 r1 = vec2(uv.x * 0.808 - uv.y * 0.589, uv.x * 0.589 + uv.y * 0.808);
      vec2 r2 = vec2(uv.x * -0.539 - uv.y * 0.842, uv.x * 0.842 + uv.y * -0.539);
      vec2 g1 = textureLod(uNoise, r1 * 0.92 - wind * uTime * 0.38, 0.0).rg - 0.5;
      vec2 g2 = textureLod(uNoise, r2 * 0.44 + wind * uTime * 0.27, 0.0).ba - 0.5;
      slope += (g1 * 0.045 + g2 * 0.030) * nearCap;
    }
#endif
    // ShoreWaves.js + Breakers.js: arrebentação costeira dependente da profundidade e corrida de swash
    sw = twEvaluateShore(uv, blocks, rise, steep, shoreDir, wind, energy, uTime);
    vec3 baseN = normalize(vec3(vN.x + sw.normal.x * 0.85, vN.y + sw.normal.y, vN.z + sw.normal.z * 0.85));
    // Reoriented Normal Mapping (WaterSurface.js): detalhe cavalga na face inclinada da onda
    N = twReorientNormal(baseN, slope);
  }
  float sky = vLight.x;
  float lightK = 0.12 + 0.88 * sky * sky;
  vec3 col;
  float alpha;
  if (!gl_FrontFacing) {
    // Janela de Snell + Reflexão Interna Total (WaterMaterial.js linhas 551-588):
    // O ar cabe num cone de ~48.6° (IOR = 1.333). Fora dele, reflexão interna total do volume submarino.
    vec3 nrm = normalize(vec3(N.x, abs(N.y), N.z));
    vec3 I = normalize(-V);
    float cosW = clamp(dot(I, nrm), 0.0, 1.0);
    float F_under = twFresnelDielectric(cosW, 1.0 / TW_IOR);
    float sinW = sqrt(max(0.0, 1.0 - cosW * cosW));
    float sinA = TW_IOR * sinW;
    float open = 1.0 - smoothstep(0.94, 1.03, sinA);
    float rim = (1.0 - smoothstep(0.0, 0.08, abs(sinA - 1.0))) * open;
    vec3 axis = sinW > 1e-3 ? (I - nrm * cosW) / sinW : vec3(0.0);
    float cosA = sqrt(max(0.0, 1.0 - min(sinA, 1.0) * min(sinA, 1.0)));
    vec3 air = normalize(axis * min(sinA, 0.999) + nrm * max(cosA, 0.02));
    vec3 skyCol = skyBase(air) * (0.85 + 0.25 * sky);
#ifdef WATER_CLOUDS
    vec4 clU = cloudLayer(normalize(vec3(air.x, max(air.y, 0.02), air.z)), 0.0);
    skyCol = mix(skyCol, clU.rgb, clU.a);
#endif
    // Radiância volumétrica refletida por TIR (fase Henyey-Greenstein g = 0.86)
    vec3 Rr = reflect(-V, nrm);
    vec3 LsU = normalize(vec3(uLightDir.x * 0.75, max(uLightDir.y, 0.2), uLightDir.z * 0.75));
    float phR = twWaterPhaseHG(dot(Rr, LsU), 0.86) * 0.7 + 0.023873;
    vec3 body = (uWaterColor * (0.55 + 1.15 * sky) + uWaterShallow * (0.28 * phR * max(uLightDir.y, 0.0))) * lightK;
    float compress = smoothstep(0.25, 0.92, sinA);
    col = mix(body, skyCol, open * (1.0 - F_under * 0.65));
    col += vec3(0.75, 0.92, 1.0) * rim * mix(0.35, 0.12, uHeadset) * lightK;
    // Sombra suave da espuma vista por baixo (foamUnder)
    float underFoam = clamp(vWaveFoam + sw.foam * 0.8, 0.0, 1.0);
    vec3 foamUnderCol = (uAmbSky + uSunColor * 0.35 * max(uLightDir.y, 0.0)) * 0.32 * lightK;
    col = mix(col, foamUnderCol, underFoam * 0.55);
    alpha = mix(0.94, mix(0.22, 0.7, compress), open);
  } else {
    float nvRaw = max(dot(N, V), 1e-4);
    float fresExact = twFresnelDielectric(nvRaw, TW_IOR);
    float fres = mix(0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0), fresExact, 0.75);
    fres *= mix(1.0, 0.28, uHeadset);

    // Variância de inclinação não resolvida de Cox-Munk (WaterMaterial.js linhas 305-345):
    // inclina o reflexo médio em rajadas (gusts) para o céu mais alto e escuro, enquanto slicks ficam espelhados
    float windSpeed = mix(2.2, 16.0, energy);
    float mss = 0.003 + windSpeed * 0.00512;
    float kpx = 3.14159265 / max(footprint, 1e-4);
    float unresolved = clamp(log2(max(110.0 / kpx, 1.0)) / 9.0, 0.0, 1.0);
    float sigmaUnres = sqrt(max(mss * unresolved * det.rough * det.rough, 0.0));

    vec3 Rraw = reflect(-V, N);
    float Rup = max(Rraw.y, 0.005) + sigmaUnres * 1.15 * (1.0 - max(Rraw.y, 0.0));
    vec3 R = normalize(vec3(Rraw.x, max(Rup, .008), Rraw.z));
    float horizonOcc = smoothstep(-0.12, 0.08, Rraw.y);
    vec3 skyRefl = skyBase(R);
#ifdef WATER_CLOUDS
    vec4 cl = cloudLayer(normalize(vec3(R.x, max(R.y, 0.02), R.z)), 0.0);
    skyRefl = mix(skyRefl, cl.rgb, cl.a);
#endif
    vec3 refl = mix(uHorizon * 0.38, skyRefl, horizonOcc);
    float lit = smoothstep(0.6, 1.0, sky);
    float sunShadowVis = waterSunVisibility(vWorld, vN);
#ifdef WATER_VOXELS
    if (vTop > .5) refl = localWaterReflection(refl,vWorld,R,dist);
#endif
    // Microfacetas GGX: preserva energia em incidência rasante, formando o caminho
    // do sol baixo. O brilho entra uma vez, separado do Fresnel do reflexo ambiente.
    vec3 H = normalize(V+uLightDir);
    float nv = max(dot(N,V),.001), nl = max(dot(N,uLightDir),0.0);
    float nh = max(dot(N,H),0.0), vh = max(dot(V,H),0.0);
    float a2 = mix(0.0038, 0.013, energy) + mss * 1.4 * unresolved * det.rough * det.rough + sw.aeration * 0.025;
    a2 = mix(a2, 0.62, uHeadset);
    float d = nh*nh*(a2-1.0)+1.0;
    float D = min(a2/(3.14159*d*d),64.0);
    float visibility = .5 / max(nl*sqrt(nv*nv*(1.0-a2)+a2)+nv*sqrt(nl*nl*(1.0-a2)+a2),.001);
    float fresSun = .02+.98*pow(1.0-vh,5.0);
    vec3 glint = uSunColor * min(D*visibility*nl*fresSun, mix(12.0, 0.45, uHeadset)) * lit * waterSunVisibility(vWorld,vN);

    // ---------------- Volume Submarino Tidewater: Beer-Lambert + Espalhamento de Gordon + SSS ----------------
    float dk = smoothstep(0.0, 0.92, depth);
    float clearShallow = smoothstep(0.12, 2.2, blocks);
    float abyss = smoothstep(7.0, 28.0, blocks);

    // Raio refratado para dentro da coluna d'água (lei de Snell, WaterMaterial.js linhas 381-395)
    vec3 Tr = refract(-V, N, 1.0 / TW_IOR);
    vec3 Tv = normalize(vec3(Tr.x, min(Tr.y, -0.08), Tr.z));
    float tDown = max(-Tv.y, 0.14);
    float dMeters = max(blocks * 0.92 + vWaveH, 0.05);
    float pathLen = clamp(dMeters / tDown, 0.05, 80.0);

    // Coeficientes ópticos do Tidewater (absorção seletiva do vermelho + espalhamento turquesa e pluma de bolhas)
    vec3 sigA = vec3(0.28, 0.062, 0.030) + vec3(0.12, 0.08, 0.05) * (sw.aeration * 0.75);
    vec3 sigS = mix(uWaterShallow * 0.24, vec3(0.015, 0.072, 0.095), dk) + vec3(0.08, 0.16, 0.15) * (sw.aeration * 1.35);
    vec3 sigT = sigA + sigS;
    vec3 Tview = exp(-sigT * pathLen);

    vec3 sunLight = uSunColor * lit * sunShadowVis;
    vec3 skyIrr = uAmbSky * 2.1 + uMinAmb;
    vec3 Ls = normalize(vec3(uLightDir.x * 0.75, max(uLightDir.y, 0.15), uLightDir.z * 0.75));
    float muS = max(Ls.y, 0.12);
    float muV = max(-Tv.y, 0.15);

    // Espalhamento único + múltiplo de Gordon (R = 0.33 * bb / (a + bb), WaterMaterial.js linhas 505-515)
    vec3 sunIn = sunLight * (1.0 - twFresnelDielectric(max(uLightDir.y, 0.02), TW_IOR));
    vec3 kSun = max(sigT * (1.0 + muV / muS), vec3(1e-4));
    vec3 kAmb = max(sigT * (1.0 + muV / 0.75), vec3(1e-4));
    float phase = twWaterPhaseHG(dot(Tv, Ls), 0.86) * 0.7 + 0.023873;
    vec3 bb = sigS * mix(0.038, 0.065, clamp(sw.aeration * 2.0, 0.0, 1.0));
    vec3 albedoMS = bb * (0.33 * 4.0) / max(sigA + bb, vec3(1e-4));
    vec3 inSun = sunIn * (sigS * phase + albedoMS * sigT * TW_INV_PI) * (vec3(1.0) - exp(-kSun * pathLen)) / kSun;
    vec3 inAmb = skyIrr * (sigS * 0.25 + albedoMS * sigT) * (vec3(1.0) - exp(-kAmb * pathLen)) / kAmb;

    // Fundo arenoso de coral iluminado com cáusticas visto através da água rasa cristalina
    vec2 floorHit = uv + Tv.xz * min(pathLen, 12.0);
    float c1 = textureLod(uNoise, floorHit * 0.105 + vec2(uTime * 0.036, -uTime * 0.024), 0.0).r;
    float c2 = textureLod(uNoise, floorHit * 0.148 - vec2(-uTime * 0.028, uTime * 0.032), 0.0).g;
    float cWeb = max(1.0 - abs(c1 - c2) * 6.5, 0.0); cWeb *= cWeb; cWeb *= cWeb;
    vec3 sandFloor = mix(vec3(0.68, 0.58, 0.39), uWaterShallow * 1.35, dk) * (skyIrr * 0.55 + sunLight * (0.32 + 0.75 * cWeb * exp(-dMeters * 0.22)));

    // Subsurface Scattering (SSS) nas cristas finas contra e transversalmente ao sol (WaterMaterial.js linhas 516-525)
    vec2 vH = normalize(V.xz + vec2(1e-5, 0.0));
    vec2 lH = normalize(uLightDir.xz + vec2(1e-5, 0.0));
    float back = pow(clamp(dot(vH, -lH) * 0.6 + 0.4, 0.0, 1.0), 2.5);
    float crest = clamp(vWaveH * 1.85 + 0.20 + vWaveCrest * 0.75 + sw.face * 0.65, 0.0, 1.6) * (clamp((1.0 - N.y) * 4.0, 0.0, 1.0) + 0.25);
    vec3 sss = sunLight * vec3(0.11, 0.56, 0.45) * (0.082 * back * crest * smoothstep(0.0, 0.25, uLightDir.y) * mix(1.0, 0.35, uHeadset));

    vec3 abyssCol = uWaterColor * vec3(0.26, 0.40, 0.68);
    vec3 baseBody = mix(mix(uWaterShallow, uWaterColor, dk), abyssCol, abyss) * (skyIrr + sunLight * 0.16 * max(uLightDir.y, 0.0));
    vec3 transmitted = mix(baseBody, sandFloor * Tview + inSun + inAmb, 0.84) + sss;

    col = (mix(transmitted, refl, fres) + glint + skyRefl * (0.20 * sw.swashRim)) * lightK + uTorch * vLight.y * vLight.y * 0.08;
    float bodyAlpha = mix(0.14, mix(0.78, 0.96, abyss), clearShallow * 0.85 + dk * 0.15);
    alpha = mix(bodyAlpha, 0.96, fres);

    if (vTop > 0.5) {
      // A onda e a espuma usam a mesma leitura: praia, parede, lâmina, windrows e mar aberto.
      float meters = rise > 0.03 ? blocks / rise : 40.0;
      float runup = mix(0.16, 1.35, energy) / (0.45 + rise);
      float reach = 1.0 - smoothstep(runup * 0.38, runup, meters);
      float wash = reach * mix(0.78, 0.18, steep) * mix(0.35, 1.0, energy);
      float film = (1.0 - smoothstep(0.02, 0.22, blocks)) * (1.0 - smoothstep(0.04, 0.3, rise));

      // Whitecaps nas cristas de mar aberto (moduladas por rajadas) + windrows + arrebentação costeira + swash
      float openMask = (1.0 - smoothstep(0.02, 0.24, rise)) * smoothstep(2.6, 4.8, blocks);
      float whitecaps = (vWaveFoam * mix(0.55, 1.45, det.gust) + det.streak * 0.65) * openMask * smoothstep(0.22, 0.85, energy);
      float surfCoverage = max(sw.foam + sw.swashFoam, wash * 0.82 + film * smoothstep(0.45, 1.0, energy) * 0.45);
      float totalCoverage = clamp((surfCoverage + whitecaps) * known, 0.0, 1.0);
      float freshWW = clamp((sw.roller * 1.15 + sw.swashFoam * 0.85 + vWaveFoam * 0.45 * energy) * known, 0.0, 1.0);

      float foamAlpha = 0.0;
      vec3 foamCol = twShadeFoam(
        vWorld,
        N,
        V,
        uLightDir,
        sunLight,
        skyIrr * 0.48,
        totalCoverage,
        freshWW,
        sw.flow,
        footprint,
        foamAlpha
      ) * lightK;

      col = mix(col, foamCol + glint * 0.04, foamAlpha * 0.90);
      alpha = max(alpha, foamAlpha * 0.82);
    }
  }
#ifdef FRAG_FOG
  vec4 fog = fogAt(dist, -V, vWorld.y);
#else
  vec4 fog = vFog;
#endif
  col = mix(col, fog.rgb, fog.a);
  col *= vrGrain(vWorld);
  outColor = vec4(finish(col), alpha);
}
`;

const SKY_VS = /* glsl */`
precision highp float;
in vec3 position;
uniform mat4 viewMatrix, projectionMatrix;
out vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;   // sempre no plano mais distante
}
`;

const SKY_FS = /* glsl */`
precision highp float;
uniform float uRainbow, uSkyReal;
uniform sampler2D uNoise;
uniform sampler2D uOmenTex;
uniform vec4 uOmen;
${COMMON}
${CLOUDS}
in vec3 vDir;
out vec4 outColor;

float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
// Estrelas: um ponto redondo sorteado dentro de cada célula, com brilho, cor e cintilar próprios.
vec3 stars(vec3 dir) {
  vec3 p = dir * 150.0;
  vec3 ip = floor(p), fp = p - ip;
  float h = hash3(ip);
  if (h < 0.9) return vec3(0.0);
  vec3 sp = 0.25 + 0.5 * vec3(hash3(ip + 3.1), hash3(ip + 7.7), hash3(ip + 11.3));
  float mag = fract(h * 91.7); mag *= mag * mag;
  float core = 1.0-smoothstep(0.0, 0.17 + 0.12 * mag, length(fp - sp));
  float tw = 0.72 + 0.28 * sin(uTime * (1.4 + 3.0 * fract(h * 13.3)) + h * 90.0);
  vec3 tint = mix(vec3(1.0, 0.8, 0.6), vec3(0.68, 0.8, 1.0), fract(h * 57.3));
  return tint * (core * core * tw * (0.6 + 6.0 * mag));
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyBase(dir);
  // Arco primário: lado oposto ao sol, ~40–42 graus, somente com gotículas.
  if(uRainbow>0.001 && dir.y>0.0) {
    float anti=dot(dir,-uSunDir);
    vec3 arc=vec3(1.0)-smoothstep(vec3(0.0),vec3(.014),abs(vec3(anti)-vec3(.743,.754,.765)));
    col+=arc*uRainbow*.6*smoothstep(0.0,.045,dir.y);
  }
  if (dir.y < 0.0) col = mix(col, mix(uHorizon, uFogTint.rgb, uFogTint.a) * 0.9, 1.0-smoothstep(-0.2, 0.0, dir.y));

  // sol: disco com a borda um pouco mais escura que o centro
  float sd = dot(dir, uSunDir);
  float disc = smoothstep(0.99955, 0.9998, sd);
  col += uSunGlow * disc * (18.0 + 14.0 * smoothstep(0.9997, 1.0, sd));
  if (uNight > 0.01 && uSkyReal < 0.5) {
    float up = smoothstep(0.0, 0.2, dir.y);
    // lua: disco com mares, borda suave e um halo frio em volta
    vec3 md3 = -uSunDir;
    float md = dot(dir, md3);
    float moon = smoothstep(0.99925, 0.9996, md);
    if (md > 0.99) {
      vec3 mx = normalize(cross(vec3(0.0, 1.0, 0.0), md3) + vec3(1e-4, 0.0, 0.0));
      vec3 my = cross(md3, mx);
      vec2 muv = vec2(dot(dir, mx), dot(dir, my)) * 9.0;
      float mare = texture(uNoise, muv + 0.31).r * 0.7 + texture(uNoise, muv * 3.1).g * 0.3;
      float limb = sqrt(clamp((md - 0.99925) / 0.00075, 0.0, 1.0));
      col += vec3(0.86, 0.9, 1.0) * (moon * uNight * (0.45 + 0.75 * mare) * (0.55 + 0.45 * limb) * 2.4);
      col += vec3(0.3, 0.4, 0.62) * (pow(max((md - 0.99) / 0.01, 0.0), 3.0) * 0.16 * uNight * (1.0 - moon));
    }
    if (dir.y > 0.0) {
      col += stars(dir) * (uNight * up * (1.0 - moon));
      // via láctea: uma faixa de poeira clara atravessando o céu
      float band = dot(dir, vec3(0.38, 0.52, -0.764));
      float mw = exp(-band * band * 13.0);
      float mn = texture(uNoise, dir.xz * 1.3 + dir.y * 0.6).r * texture(uNoise, dir.zx * 3.3 + 0.2).g;
      col += vec3(0.42, 0.5, 0.78) * (mw * (0.02 + 0.55 * mn * mn) * uNight * up * 0.55);
    }
  }

  if (dir.y > 0.015) {
#if CLOUD_OCT > 2
    // cirros: véu alto e esticado, bem acima das nuvens gordas
    vec2 huv = dir.xz / (dir.y + 0.06) * vec2(0.03, 0.1) + uTime * vec2(0.0012, 0.0004);
    float hn = texture(uNoise, huv).b * 0.62 + texture(uNoise, huv * 2.9 + 0.5).r * 0.38;
    float hc = smoothstep(0.5, 0.86, hn) * 0.34 * smoothstep(0.04, 0.3, dir.y);
    float hs = max(sd, 0.0); hs *= hs; hs *= hs;
    col = mix(col, uCloudLit * 1.05 + uSunGlow * hs * 0.5, hc);
#endif
    float om = 0.0;
    if (uOmen.w > 0.001) {
      // aparição: uma figura desenhada na própria nuvem, em torno de uma direção do céu
      vec3 od = normalize(uOmen.xyz);
      vec3 ax = normalize(cross(vec3(0.0, 1.0, 0.0), od) + vec3(1e-4, 0.0, 0.0));
      vec3 ay = cross(od, ax);
      vec2 ouv = vec2(dot(dir, ax), dot(dir, ay)) / max(dot(dir, od), 0.2) * 1.15 + 0.5;
      if (ouv.x > 0.0 && ouv.x < 1.0 && ouv.y > 0.0 && ouv.y < 1.0 && dot(dir, od) > 0.0) om = texture(uOmenTex, ouv).r * uOmen.w;
    }
    vec4 cl = cloudLayer(dir, om * 0.42);
    cl.rgb += vec3(1.0, 0.92, 0.7) * om * 1.6;
    col = mix(col, cl.rgb, cl.a);
  }
  // Janela de Snell no céu: aberto até ~49° do zênite. Mais de lado, a água fecha.
  col = mix(col, uFogTint.rgb, uFogTint.a * (1.0 - smoothstep(0.62, 0.74, dir.y)));
  col = finish(col);
  // um grão mínimo desfaz as faixas do degradê do céu em telas de 8 bits (só quando esta é a saída final)
  col += (ign(gl_FragCoord.xy) - 0.5) * (uDirect / 255.0);
  outColor = vec4(col, 1.0);
}
`;

const GLASS_FS = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2DArray;
uniform sampler2D uNoise;
uniform vec3 cameraPosition;
in vec2 vUv;
in float vLayer;
in vec3 vN, vWorld, vLight;
out vec4 outColor;
${COMMON}
${VR_SURFACE}
${CLOUDS}
${WATER_REFLECTION}
${GLASS_SURFACE}
`;

export function createTerrainMaterials(quality, opts = {}) {
  const defs = {};
  if (quality.detail) { defs.DETAIL = 1; defs.CAUSTICS = 1; }
  if (quality.cloudShadows) defs.CLOUD_SHADOWS = 1;
  if (quality.shadow) { defs.SHADOWS = 1; defs.SHADOW_TAPS = quality.shadow.taps || 4; }
  if (quality.shadow && quality.real?.shadowNear) defs.SHADOW_NEAR = 1;   // prova de realismo: sombra de perto
  if (quality.real) defs.REAL = 1;
  if (quality.real?.leve) defs.REAL_LEVE = 1;      // celular, iPad e visor: só chão e casca escaneados, com menos leituras
  if (quality.pbr) { defs.PBR = 1; defs.FRAG_FOG = 1; defs.RELIEF = 1; }
  const mk = (extra, o) => new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: U,
    vertexShader: TERRAIN_VS,
    fragmentShader: extra.WATER ? WATER_FS : extra.GLASS ? GLASS_FS : TERRAIN_FS,
    defines: { ...defs, ...extra },
    ...o,
  });
  const depth = (extra, name) => new THREE.RawShaderMaterial({
    // frestas de sol na copa: só no realismo inteiro (no leve o passo de sombra fica como era)
    glslVersion: THREE.GLSL3, uniforms: U, vertexShader: TERRAIN_VS, fragmentShader: DEPTH_FS, defines: quality.real && !quality.real.leve ? { ...extra, REAL: 1 } : extra, name,
  });
  const cut = { CUTOUT: 1 };
  const semPbr = { ...defs }; delete semPbr.PBR; delete semPbr.RELIEF;
  if (opts.a2c) cut.A2C = 1;
  const water = { WATER: 1, CLOUD_OCT: quality.cloudOct };
  const bands = quality.waves ?? (quality.name === 'baixa' ? 1 : quality.name === 'media' ? 2 : 3);
  if (bands >= 2) water.WAVE_CHOP = 1;
  if (bands >= 3) water.WAVE_CAP = 1;
  if (quality.cloudShadows) water.WATER_CLOUDS = 1;
  if (quality.rt && quality.post) water.WATER_VOXELS = 1;
  if (quality.cloudShadows && quality.post && quality.rt) water.CLOUD_VOLUME = 1;
  const glass = { GLASS: 1, CLOUD_OCT: 2 };
  if (quality.cloudShadows) glass.GLASS_CLOUDS = 1;
  if (quality.rt && quality.post) glass.WATER_VOXELS = 1;
  return {
    opaque: mk({}, { name: 'terreno', shadowSide: THREE.FrontSide }),   // no mapa de sombra entra a face que o sol vê (o padrão do three seria a de trás)
    slope: mk({SLOPE:1}, {name:'rampas',shadowSide:THREE.FrontSide}),
    depthSlope: quality.shadow ? depth({SLOPE:1},'sombra-rampas') : null,
    cutout: mk(cut, { name: 'recorte', side: THREE.DoubleSide, alphaToCoverage: !!opts.a2c }),
    water: mk(water, { name: 'agua', side: THREE.DoubleSide, transparent: true, depthWrite: false }),
    glass: mk(glass, { name: 'vidro', side: THREE.FrontSide, shadowSide: THREE.FrontSide, transparent: true, depthWrite: false }),
    mirror: mk(glass, { name: 'espelho', side: THREE.FrontSide, shadowSide: THREE.FrontSide, depthWrite: true }),
    depthGlass: quality.shadow ? depth({CUTOUT:1,GLASS_SHADOW:1},'sombra-espelho') : null,
    // usados só no passo de sombra (null = este perfil não tem sombra de mapa)
    depthOpaque: quality.shadow ? depth({}, 'sombra') : null,
    depthCutout: quality.shadow ? depth({ CUTOUT: 1 }, 'sombra-recorte') : null,
    // blocos do Minecraft: mesma luz, sombra e neblina do terreno; uv e textura do modelo; sem relevo/PBR do terreno
    mc: new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: U, vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS,
      defines: { ...semPbr, CUTOUT: 1, MC: 1 }, name: 'minecraft', side: THREE.DoubleSide, shadowSide: THREE.DoubleSide }),
    depthMc: quality.shadow ? depth({ CUTOUT: 1, MC: 1 }, 'sombra-minecraft') : null,
  };
}

export function createSkyMaterial(quality) {
  return new THREE.RawShaderMaterial({
    name: 'ceu',
    glslVersion: THREE.GLSL3,
    uniforms: U,
    vertexShader: SKY_VS,
    fragmentShader: SKY_FS,
    defines: { CLOUD_OCT: quality.cloudOct, ...(quality.cloudShadows && quality.post && quality.rt ? { CLOUD_VOLUME: 1 } : {}) },
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
    side: THREE.BackSide,
  });
}

// Array de texturas dos blocos a partir dos pixels gerados no worker.
export function makeBlockTextureArray(data, size, layers, anisotropy) {
  const t = new THREE.DataArrayTexture(data, size, size, layers);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

// Mapa de superfície por camada: normal (xy), rugosidade e metal. São DADOS: nada de sRGB aqui.
export function makeSurfaceArray(data, size, layers) {
  const t = new THREE.DataArrayTexture(data, size, size, layers);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4; // o relevo também precisa sobreviver ao ângulo rasante da margem
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Ruído que se repete sem emenda, um campo independente por canal.
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const hash = (x, y, s) => {
    let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ s;
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vn = (x, y, per, s) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const x0 = ix % per, x1 = (x0 + 1) % per, y0 = iy % per, y1 = (y0 + 1) % per;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  for (let ch = 0; ch < 4; ch++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0, amp = 0.5, norm = 0, per = 4;
        for (let o = 0; o < 5; o++) {
          s += amp * vn(x / size * per, y / size * per, per, 991 * ch + o * 31);
          norm += amp; amp *= 0.5; per *= 2;
        }
        s /= norm;
        // estica o contraste: o fbm puro fica muito perto de 0,5
        data[(x + y * size) * 4 + ch] = Math.max(0, Math.min(255, ((s - 0.5) * 1.9 + 0.5) * 255));
      }
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
