// LAVRA — o mar do arquipélago (pedido do Kadmus, 19/11/2026, com a referência dgreenheck.github.io/tidewater).
// Modelo único das ondas: a mesma conta roda no aparelho (física, câmera debaixo d'água, barco) e na placa de vídeo
// (render/oceano.js). O GLSL é GERADO destas constantes (MAR_GLSL), então as duas nunca se separam.
//
// Duas partes somadas na altura da superfície:
//   1) mar aberto: 12 ondas de Gerstner direcionais em volta do vento (ondulação de ~1 m, de 64 m a 1,5 m), que
//      sentem o fundo (encolhem no raso) e somem nas lagoas de dentro da ilha;
//   2) arrebentação: séries de ondas que andam para a praia pela distância à costa (shared/arquipelago.js → s), crescem
//      no raso, quebram quando ficam altas demais para a fundura (espuma) e sobem a areia no espraiamento.
// Entradas de cada ponto: posição (x, z), instante (s), fundura em repouso `prof` (m; negativo = areia acima do mar) e
// distância à costa `s` (m; negativo = terra adentro). Saída: altura acima do nível de repouso (m).
import { SEA } from './constants.js';

export const MAR_NIVEL = SEA + 0.88;      // nível do mar em repouso (o mesmo de shared/ondas.js)
const G = 9.81, TAU = Math.PI * 2;

// [comprimento (m), declividade k·A, ângulo em relação ao vento (rad), fase]
const ESPECTRO = [
  // ondulação de mar aberto (vem de longe; é ela que se vê rolando até a ilha)
  [96, 0.046, -0.18, 0.6], [68, 0.05, 0.12, 2.9], [47, 0.052, -0.34, 4.8],
  // mar de vento
  [33, 0.052, 0.46, 1.3], [23, 0.054, -0.52, 3.6], [16, 0.056, 0.71, 5.4], [11, 0.06, -0.21, 0.8],
  [8.0, 0.064, 0.95, 2.2], [5.8, 0.066, -0.83, 3.9], [4.2, 0.066, 0.31, 5.1], [3.0, 0.064, -1.12, 0.4],
  [2.1, 0.06, 0.64, 1.9], [1.5, 0.056, -0.52, 4.7],
];
export const N_ONDULACAO = 3;   // as primeiras do espectro: ondulação de mar aberto; o resto, mar de vento
export const ONDAS = ESPECTRO.map(([L, ka, ang, fase]) => {
  const k = TAU / L;
  return { L, k, A: ka / k, ang, cosAng: Math.cos(ang), senAng: Math.sin(ang), fase, w: Math.sqrt(G * k) };
});
// arrebentação: comprimento entre cristas (m), período (s), amplitude ao largo (m), fundura em que quebra = altura/γ
export const COSTA = { L: 23, T: 10, A0: 1.05, gama: 0.42, largo: 110 };

// ---- estado do mar (pedido do Kadmus, 19/11: "tempo calmo e pouco vento, mar calmo, poucas ondas baixas; tempo
// se fecha, o mar corresponde; tempestade vindo do mar, ondas maiores e muito mais violentas atingem a costa").
// E vai de 0 (calmaria) a 1 (tempestade) e 1,3 no temporal e sai do tempo do mundo (game.weather); muda devagar (render/oceano.js).
export function multMar(E) {
  const e = Math.min(1.3, Math.max(0, E));
  return { ondulacao: 0.1 + 2.4 * Math.pow(e, 1.6), vento: 0.12 + 1.75 * e, costa: 0.25 + 2.0 * Math.pow(e, 1.4), periodo: 8 + 5 * e, ressaca: 0.6 * e * e };
}
const BASE_TEMPO = { limpo: 0.22, neblina: 0.1, nublado: 0.38, garoa: 0.46, chuva: 0.64, tempestade: 1, temporal: 1.3 };   // temporal = tempestade severa (server/temporal.js)
// alvo do estado do mar para um tempo { kind, wind: [x, z] m/s }
export function estadoDoTempo(w) {
  const base = BASE_TEMPO[w?.kind] ?? 0.3;
  const vel = Math.hypot(w?.wind?.[0] || 0, w?.wind?.[1] || 0);
  if (w?.kind === 'temporal') return 1.3;                          // o mar mais violento que existe
  return Math.min(1, Math.max(0, 0.6 * base + 0.4 * Math.min(1, vel / 14) + (w?.kind === 'tempestade' ? 0.15 : 0)));
}
const KA_ONDULACAO = ESPECTRO.slice(0, 3).reduce((t, e) => t + e[1], 0), KA_VENTO = ESPECTRO.slice(3).reduce((t, e) => t + e[1], 0);

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const fract = (x) => x - Math.floor(x);
const hash1 = (n) => fract(Math.sin(n * 127.1) * 43758.5453);

// direção do vento (vx, vz, unitária) e força (0..2): o tempo do mundo empurra o mar
export function ventoMar(w) {
  const x = w?.x ?? 0.83, z = w?.y ?? 0.55, f = w?.z ?? 0.85;
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l, f: Math.min(2, Math.max(0.2, f)) };
}
// perfil de uma onda da arrebentação ao passar (u = 0 na crista; a frente, que encara a praia, é íngreme)
function perfil(u) { return u > 0.7 ? Math.pow(sstep(0.84, 1, u), 1.6) : 1 - sstep(0, 0.6, u); }

// Altura (m) acima do repouso, só a parte vertical (o deslocamento lateral do Gerstner não muda a altura média).
// vento = direção {x, y}; E = estado do mar; fase = fase acumulada da arrebentação (ver render/oceano.js).
export function alturaMar(x, z, t, prof, s, vento, E = 0.35, fase = t / 9.5) {
  const v = ventoMar(vento), M = multMar(E);
  const lamina = sstep(-0.1, 0.7, prof), litoral = sstep(-24, 6, s);
  let y = M.ressaca * (1 - sstep(60, 200, s));
  for (let i = 0; i < ONDAS.length; i++) {
    const o = ONDAS[i], amp = i < N_ONDULACAO ? M.ondulacao : M.vento;
    const dx = v.x * o.cosAng - v.z * o.senAng, dz = v.x * o.senAng + v.z * o.cosAng;
    const atenuacao = (0.12 + 0.88 * sstep(0, o.L * 0.22, prof)) * lamina * litoral;
    y += o.A * amp * atenuacao * Math.sin(o.k * (dx * x + dz * z) - o.w * t + o.fase);
  }
  return y + costa(x, z, fase, prof, s, E, M.costa).y;
}

// arrebentação num ponto: { y, espuma }; fase = quantas séries já passaram (cresce 1/período por segundo)
export function costa(x, z, fase, prof, s, E = 0.35, multiplicador) {
  const w = sstep(COSTA.largo, COSTA.largo * 0.5, s) * sstep(-14, -4, s);
  if (w <= 0) return { y: 0, espuma: 0 };
  const Mc = multiplicador ?? multMar(E).costa;
  const curva = 4.5 * Math.sin(x * 0.021 + z * 0.013) + 3 * Math.sin(z * 0.029 - x * 0.008);
  const f = (s + curva) / COSTA.L + fase;
  const n = Math.floor(f), u = f - n;
  const serie = 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(n * 2.1)) * (0.7 + 0.3 * hash1(n));
  const d = Math.max(prof, 0.05);
  const cresce = Math.min(1.8, Math.max(1, Math.sqrt(Math.sqrt(4 / d))));
  const A = COSTA.A0 * Mc * serie * cresce;
  const teto = COSTA.gama * (1 + 0.35 * Math.min(1, Math.max(0, E))) * d + 0.05;
  const quebra = sstep(0.75, 1.05, A / teto);
  const Ae = Math.min(A, teto + 0.12) * w;
  let y;
  if (prof > 0.25) y = Ae * (perfil(u) - 0.33);
  else y = (COSTA.A0 * Mc * 0.85 * serie) * w * perfil(u) - 0.1 - Math.max(0, -prof) * 0.6;   // espraiamento na areia
  return { y, espuma: quebra * w };
}

// ---- GLSL gerado das mesmas constantes (render/oceano.js) -------------------------------------------------------
const f = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(+x.toFixed(6)));
export const MAR_GLSL = /* glsl */`
#define MAR_N ${ONDAS.length}
const float MAR_L[MAR_N] = float[](${ONDAS.map((o) => f(o.L)).join(', ')});
const float MAR_K[MAR_N] = float[](${ONDAS.map((o) => f(o.k)).join(', ')});
const float MAR_A[MAR_N] = float[](${ONDAS.map((o) => f(o.A)).join(', ')});
const float MAR_ANG[MAR_N] = float[](${ONDAS.map((o) => f(o.ang)).join(', ')});
const float MAR_FASE[MAR_N] = float[](${ONDAS.map((o) => f(o.fase)).join(', ')});
const float MAR_W[MAR_N] = float[](${ONDAS.map((o) => f(o.w)).join(', ')});
const float COSTA_L = ${f(COSTA.L)}, COSTA_T = ${f(COSTA.T)}, COSTA_A0 = ${f(COSTA.A0)}, COSTA_GAMA = ${f(COSTA.gama)}, COSTA_LARGO = ${f(COSTA.largo)};
const int MAR_NOND = ${N_ONDULACAO};
const float KA_OND = ${f(KA_ONDULACAO)}, KA_VEN = ${f(KA_VENTO)};
// multiplicadores do estado do mar (iguais a multMar)
float multOnd(float e) { return 0.1 + 2.4 * pow(clamp(e, 0.0, 1.3), 1.6); }
float multVen(float e) { return 0.12 + 1.75 * clamp(e, 0.0, 1.3); }
float multCosta(float e) { return 0.25 + 2.0 * pow(clamp(e, 0.0, 1.3), 1.4); }
float ressaca(float e, float s) { e = clamp(e, 0.0, 1.3); return 0.6 * e * e * (1.0 - smoothstep(60.0, 200.0, s)); }

float marAtenua(int i, float prof, float s) {
  float fundo = 0.12 + 0.88 * smoothstep(0.0, MAR_L[i] * 0.22, prof);
  return fundo * smoothstep(-0.1, 0.7, prof) * smoothstep(-24.0, 6.0, s);
}
float marPerfil(float u) { return u > 0.7 ? pow(smoothstep(0.84, 1.0, u), 1.6) : 1.0 - smoothstep(0.0, 0.6, u); }
float marHash(float n) { return fract(sin(n * 127.1) * 43758.5453); }

// Gerstner do mar aberto. lod = metros por amostra (some a onda que não cabe). Devolve o deslocamento; em
// nrmOut a normal (sem normalizar) e em cristaOut quanto a crista está apertada (espuma do mar aberto).
vec3 marAberto(vec2 p, float t, float prof, float s, vec3 vento, float lod, out vec3 nrmOut, out float cristaOut) {
  vec3 d = vec3(0.0); vec3 n = vec3(0.0, 1.0, 0.0); float jac = 0.0;
  float mo = multOnd(vento.z), mv = multVen(vento.z);
  float q = min(0.85, 0.95 / max(KA_OND * mo + KA_VEN * mv, 1e-3));   // crista fechada sem dar laço, mesmo na tempestade
  for (int i = 0; i < MAR_N; i++) {
    float a = MAR_A[i] * (i < MAR_NOND ? mo : mv) * marAtenua(i, prof, s) * (1.0 - smoothstep(MAR_L[i] * 0.9, MAR_L[i] * 2.2, lod));
    if (a < 1e-4) continue;
    float ca = cos(MAR_ANG[i]), sa = sin(MAR_ANG[i]);
    vec2 dir = vec2(vento.x * ca - vento.y * sa, vento.x * sa + vento.y * ca);
    float th = MAR_K[i] * dot(dir, p) - MAR_W[i] * t + MAR_FASE[i];
    float c = cos(th), sn = sin(th);
    d += vec3(q * a * dir.x * c, a * sn, q * a * dir.y * c);
    float ka = MAR_K[i] * a;
    n.x -= dir.x * ka * c; n.z -= dir.y * ka * c; n.y -= q * ka * sn;
    jac += q * ka * sn;
  }
  nrmOut = n; cristaOut = jac;
  d.y += ressaca(vento.z, s);
  return d;
}

// Arrebentação. gS = gradiente de s (para a normal). Devolve a altura; espumaOut = quanto está quebrando;
// inclOut = inclinação da superfície ao longo de s (dy/ds).
float marCosta(vec2 p, float fase, float e, float prof, float s, out float espumaOut, out float frenteOut, out float inclOut) {
  espumaOut = 0.0; frenteOut = 0.0; inclOut = 0.0;
  float w = smoothstep(COSTA_LARGO, COSTA_LARGO * 0.5, s) * smoothstep(-14.0, -4.0, s);
  if (w <= 0.0) return 0.0;
  float curva = 4.5 * sin(p.x * 0.021 + p.y * 0.013) + 3.0 * sin(p.y * 0.029 - p.x * 0.008);
  float fs = (s + curva) / COSTA_L + fase;
  float nn = floor(fs), u = fs - nn;
  float serie = 0.62 + 0.38 * (0.5 + 0.5 * sin(nn * 2.1)) * (0.7 + 0.3 * marHash(nn));
  float d = max(prof, 0.05);
  float cresce = clamp(sqrt(sqrt(4.0 / d)), 1.0, 1.8);
  float mc = multCosta(e);
  float A = COSTA_A0 * mc * serie * cresce;
  float teto = COSTA_GAMA * (1.0 + 0.35 * clamp(e, 0.0, 1.0)) * d + 0.05;
  float quebra = smoothstep(0.75, 1.05, A / teto);
  float Ae = min(A, teto + 0.12) * w;
  float du = 0.012;
  float pu = marPerfil(u), dpu = (marPerfil(min(u + du, 0.9999)) - marPerfil(max(u - du, 0.0))) / (2.0 * du);
  float y;
  if (prof > 0.25) { y = Ae * (pu - 0.33); inclOut = Ae * dpu / COSTA_L; }
  else { float As = COSTA_A0 * mc * 0.85 * serie * w; y = As * pu - 0.1 - max(0.0, -prof) * 0.6; inclOut = As * dpu / COSTA_L; }
  espumaOut = quebra * w;
  frenteOut = smoothstep(0.93, 0.995, u) + (1.0 - smoothstep(0.0, 0.07, u)) * 0.9 + (1.0 - smoothstep(0.05, 0.5, u)) * 0.35;   // crista que quebra e a renda que fica
  return y;
}
`;
