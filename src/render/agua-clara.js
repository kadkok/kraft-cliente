// LAVRA — a água clara do mar: os números da luz debaixo d'água num lugar só (24/11/2026).
// Pedido direto do Kadmus ao Claude, com a referência "Abyssal Garden": "a qualidade visual deixou muito a desejar e
// não foi até as áreas mais profundas do mar… a transparência e os reflexos solares na água não ficaram realistas".
//
// O que estava errado, medido:
//   · a água era de costa turva: extinção (0,394 · 0,097 · 0,066) por metro. A 30 m de quem olha só 14% do azul e 5%
//     do verde chegavam: via-se 15 a 25 m. A referência é água clara de recife: (0,072 · 0,042 · 0,029);
//   · a luz do terreno vinha da luz do céu dos blocos, que perde 1 por bloco de água: a 15 m de fundura é zero e o
//     fundo do mar (26 a 43 m em quase todo o arquipélago) ficava preto.
// Agora, no mar, a luz vem da coluna d'água: sol direto atenuado pelo caminho até a superfície (com sombra e com a
// cáustica de refração de render/causticas.js) e luz difusa de cima atenuada pela fundura. O vermelho ainda some
// primeiro, mas devagar o bastante para o coral continuar colorido a 30 m, como na referência.
//
// Quem usa: materials.js (terreno), recife.js (corais, peixes, arraias), oceano.js (o fundo visto de cima e a janela
// vista de baixo), submarino.js (o véu da água no pós-processamento e a cor da névoa), atmosphere.js, ambient.js.
export const AGUA = Object.freeze({
  ext: Object.freeze([0.100, 0.045, 0.030]),     // extinção ao longo do olhar, por metro
  sol: Object.freeze([0.075, 0.021, 0.012]),     // sol direto, por metro de caminho dentro d'água
  ceu: Object.freeze([0.090, 0.029, 0.017]),     // luz difusa de cima, por metro de fundura
  // luz que a água devolve por metro (o véu azul), antes de multiplicar pela luz do dia (atmosphere.js → U.uAguaVeu)
  veu: Object.freeze([0.0055, 0.0056, 0.0064]),
  // a parte do véu que vem do sol direto espalhado pela água, por metro e por unidade de luz do sol (U.uAguaVeuSol);
  // é mais forte olhando na direção do sol (aguaFase). Na referência é o que dá o azul luminoso ao longe.
  veuSol: Object.freeze([0.0020, 0.0042, 0.0052]),
  // cor da luz difusa logo abaixo da superfície, por unidade de luz do dia (o céu visto de dentro d'água é ciano)
  cor: Object.freeze([0.30, 0.80, 1.00]),
  vista: 120,                                    // além disto só há o véu (m): esconde o fim do mundo carregado
  dia: Object.freeze([1.55, 0.16]),              // pesos do céu e do sol na luz do dia que entra na água (luzDoDia)
  veuGanho: 1.1,                                 // o véu em relação à luz difusa (na referência, 1 / 0,9)
});
// seno da elevação do sol depois de refratado na superfície (índice 1,333): debaixo d'água ele nunca fica rasante
export function muDoSol(ly) {
  const y = Math.max(0, Math.min(1, ly));
  return Math.sqrt(1 - (1 - y * y) / 1.777);
}
// quanto do sol e da luz difusa chega a uma fundura (m), por cor
export function luzNaFundura(fundura, ly = 0.8) {
  const z = Math.max(0, fundura), mu = muDoSol(ly);
  return { sol: AGUA.sol.map((k) => Math.exp(-k * z / mu)), ceu: AGUA.ceu.map((k) => Math.exp(-k * z)) };
}

// A luz do dia como a água a recebe (um número): o céu inteiro mais uma parte do sol, que entra pela superfície.
// sunColor e ambSky são os uniforms U.uSunColor e U.uAmbSky (x, y, z); ly = altura do sol/lua (U.uLightDir.y).
export function luzDoDia(sunColor, ambSky, ly) {
  const lum = (c) => 0.2126 * (c?.x ?? 0) + 0.7152 * (c?.y ?? 0) + 0.0722 * (c?.z ?? 0);
  return lum(ambSky) * AGUA.dia[0] + lum(sunColor) * AGUA.dia[1] * Math.max(0, Math.min(1, ly ?? 0.8));
}

const v3 = (a) => `vec3(${a.map((x) => String(+x.toFixed(5))).join(', ')})`;
export const AGUA_GLSL = /* glsl */`
const vec3 AGUA_EXT = ${v3(AGUA.ext)};
const vec3 AGUA_SOL = ${v3(AGUA.sol)};
const vec3 AGUA_CEU = ${v3(AGUA.ceu)};
float aguaMu(float ly) { ly = clamp(ly, 0.0, 1.0); return sqrt(1.0 - (1.0 - ly * ly) / 1.777); }
// quanto do sol direto chega a esta fundura (m), vindo pela direção da luz
vec3 aguaSol(float fundura, float ly) { return exp(-AGUA_SOL * (max(fundura, 0.0) / aguaMu(ly))); }
// quanto da luz difusa de cima chega a esta fundura
vec3 aguaCeu(float fundura) { return exp(-AGUA_CEU * max(fundura, 0.0)); }
// O véu: luz que a água devolve ao longo de um raio de comprimento dist (m), para quem está a funduraOlho (m) e olha
// com inclinação dirY (para cima a água é mais clara: a conta fecha sem estourar). fonte = U.uAguaVeu.
// fonteSol = U.uAguaVeuSol já multiplicado por aguaFase (para onde se olha em relação ao sol); ly = altura do sol.
vec3 aguaVeu(vec3 fonte, vec3 fonteSol, float funduraOlho, float dirY, float dist, float ly) {
  vec3 k = max(AGUA_EXT - AGUA_CEU * dirY, vec3(0.004));
  float z = max(funduraOlho, 0.0);
  return (fonte * exp(-AGUA_CEU * z) + fonteSol * exp(-AGUA_SOL * (z / aguaMu(ly)))) * (1.0 - exp(-k * dist)) / k;
}
// quanto a água espalha o sol na direção de quem olha (cosseno entre o olhar e o sol): forte para a frente
float aguaFase(float cosSol) {
  const float g = 0.62;
  return 0.55 + 0.20 * (1.0 - g * g) / pow(max(1.0 + g * g - 2.0 * g * cosSol, 1e-3), 1.5);
}
`;
