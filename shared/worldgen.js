// LAVRA — geração determinística do terreno.
// Mesma semente => mesmo mundo em qualquer aparelho. Ver a regra de ouro em noise.js:
// aqui só entram operações exatas (nada de sin/cos/pow).

import { imprimirFortaleza, centroValido } from './fortaleza.js';
import { plantTree, TREE_CELL, TREE_REACH } from './trees.js';
import { CW, SEA, CHUNK_VOL, DIM_MACRO, DIM_NANO0, FRACTAL, Y_MIN, Y_TOP } from './constants.js';
import { faixaDe as faixaFundo } from './minerios.js';
import { B, KIND, K_CUBE } from './blocks.js';
import { createSimplex, hash3, rand2, rand3, clamp, lerp, smoothstep } from './noise.js';
import { createArquipelago, mapaValido, PRAIA, FOSSA } from './arquipelago.js';

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, TAIGA: 4, SNOW: 5, DESERT: 6, SAVANNA: 7, ALPINE: 8 };

// Curva continente -> altura base (relativa ao nível do mar).
const SPL_X = [-1.0, -0.45, -0.28, -0.16, -0.07, -0.01, 0.04, 0.14, 0.4, 1.0];
const SPL_Y = [-44,  -42,   -32,   -16,   -4,    0.6,   3.2,  6.5,  13,  26];
function spline(c) {
  if (c <= SPL_X[0]) return SPL_Y[0];
  for (let i = 1; i < SPL_X.length; i++) {
    if (c <= SPL_X[i]) {
      const t = (c - SPL_X[i - 1]) / (SPL_X[i] - SPL_X[i - 1]);
      return SPL_Y[i - 1] + (SPL_Y[i] - SPL_Y[i - 1]) * t;
    }
  }
  return SPL_Y[SPL_Y.length - 1];
}

function fbm(n, x, z, oct) {
  let a = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(x, z);
    norm += a;
    x = x * 2.03 + 31.7;
    z = z * 2.03 - 17.3;
    a *= 0.5;
  }
  return s / norm;
}

// Cristas: 1 - |ruído|, ao quadrado, com cada oitava pesada pela anterior.
function ridged(n, x, z, oct) {
  let a = 1, s = 0, norm = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(n(x, z));
    v *= v;
    s += a * v * w;
    norm += a;
    w = clamp(v * 1.5, 0, 1);
    x = x * 2.07 + 13.1;
    z = z * 2.07 + 41.9;
    a *= 0.5;
  }
  return s / norm;
}

const ORE_CELL = 8;
// Cavernas de ruído (túneis e salões espalhados por todo o subsolo): DESLIGADAS a pedido do Kadmus (19/11: "quero que
// cavernas sejam muitíssimo raras… a terra deve ser mais sólida… todos os lugares esburacados devem ser preenchidos").
// O chão continua o mesmo (a altura vem antes de cavar): só os vazios de dentro e as bocas viram rocha. As cavernas
// de verdade, raras e desenhadas, entram depois. O código fica para elas poderem reaproveitar os campos.
export const CAVERNAS_RUIDO = false;

// Armazenamento (profundidade em dobro, 19/11): o vetor do pedaço guarda as camadas de Y_MIN a Y_TOP − 1, em todos os
// planos; a camada do y do mundo é y + YO. `generate` devolve maxY (maior y ocupado) e minY (menor y com célula que
// não é cubo opaco: ar, água) em y do MUNDO. Abaixo de minY tudo é opaco, e o mesher não precisa olhar.
const YO = -Y_MIN;

// Rios subterrâneos (19/11, pedido do Kadmus: "rios subterrâneos"). Raros, longos e sinuosos, em quatro fundos, todos
// no subsolo novo: a célula mais alta de um rio (o teto do vão de ar) fica em y −14 ou abaixo. Ninguém editava abaixo de
// y 1, então TODA obra e todo buraco de jogador de um mundo salvo fica a 15 m ou mais de qualquer rio, sem precisar de
// lista do mundo nem de conversor; e a superfície não muda um bloco. Água parada (fonte) de 1 a 4 de fundo, vão de ar de
// 2 a 4 por cima (mais fundo e mais alto no meio do leito), leito de cascalho, argila ou areia. Toda célula de água tem
// rocha ou leito embaixo e dos lados no mesmo nível: a lei da água não tem o que mover até alguém furar a margem.
//   · trecho: o rio só existe onde um ruído largo (portão, ~1,1 km) passa do limiar, afinando até sumir na borda;
//   · leito: a linha onde um ruído torcido cruza zero; a largura sai em METROS (|ruído| ÷ gradiente), por isso não
//     incha nos nós (onde o gradiente some o rio estreita em vez de virar lagoa);
//   · ~0,3–0,45 % das colunas por fundo (medido em 4 × 4 km; tests/profundidade.test.js).
// Nenhum rio debaixo do campo de futebol do mundo oficial (x 124,5…176,5, z −147,5…−119,5) nem a 12 m dele: o campo já
// fica a mais de 60 m, mas o pedido foi explícito e a conta é de graça. É constante de código, não dado do mundo, para o
// terreno continuar sendo função do código (invariante).
export const RIOS = Object.freeze([
  { y: -18, s: Object.freeze([11.3, -7.7, 3.1, 9.4, -5.2, 1.8, 7.7, -3.3, 2.2, 5.5]) },
  { y: -29, s: Object.freeze([153.54, -71.68, -8.8, 2.6, 6.1, -9.9, -4.4, 8.1, -6.6, 1.1]) },
  { y: -40, s: Object.freeze([33.3, 17.2, 5.5, -2.2, -7.7, 4.4, 2.9, 6.6, 9.1, -3.8]) },
  { y: -51, s: Object.freeze([-41.7, 29.3, -13.1, 7.9, 15.5, -21.2, 12.4, -17.7, 23.3, -5.9]) },
]);
export const RIO = Object.freeze({
  portaoF: 0.0009, limiar: 0.45, borda: 0.1,   // portão: frequência, limiar e faixa em que o rio afina até sumir
  torcaoF: 0.004, torcao: 48,                  // torção do leito (curvas largas)
  leitoF: 0.0019, corte: 0.09,                 // leito: frequência; |ruído| acima do corte nem calcula gradiente
  gradMin: 0.005,                              // gradiente (por metro) abaixo do qual o rio estreita
  meia0: 1.5, meia1: 1.5,                      // meia-largura: 1,5 a 3 m, variando ao longo do rio
  fundoMax: 4, vaoMin: 2, vaoMax: 4,           // água de 1 a 4; ar de 2 a 4
});
export const RIO_TETO = Math.max(...RIOS.map((r) => r.y)) + RIO.vaoMax;   // célula mais alta de qualquer rio (−14)
const BASALTO_BAIXO_MIN = -10;   // a base do basalto varia de −10 a −4 (generate): abaixo disso, só rocha profunda
export const SEM_RIO = Object.freeze([Object.freeze({ x0: 124.5, x1: 176.5, z0: -147.5, z1: -119.5, folga: 12 })]);
// Fossas abissais (22/11/2026; dado do mapa de arquipélago, `mapa.fossas`, shared/arquipelago.js). Dentro da fossa a
// coluna desce abaixo de y 3 (o resto do gerador nunca desce): o piso fica, no mínimo, uma camada acima das duas de
// rocha-mãe sorteada. Como o que guia é o mapa do mundo (dado), não uma constante de código, mundo sem `fossas` sai
// idêntico ao de antes, bloco a bloco. Nenhum rio subterrâneo dentro da fossa nem a menos de FOSSA.folgaRio metros
// dela (os rios têm vão de ar; encostados na água da fossa, a lei da água sairia movendo tudo): ver leitoRio.
export const Y_PISO_FOSSA = Y_MIN + 3;

export function createWorldGen(seed, dim = 0, opt = null) {
  seed = seed >>> 0;
  if (dim === 1) return createZoneGen(seed);
  if (dim === DIM_MACRO) return createMacroGen(seed, opt);
  if (dim >= DIM_NANO0) return createNanoGen(seed, opt || { block: B.STONE, at: [0, 0, 0] });
  const sA = createSimplex(seed ^ 0x1234abcd);
  const sB = createSimplex(seed ^ 0x77e1c0de);
  const sC = createSimplex(seed ^ 0x0badf00d);
  const n2 = sA.n2, m2 = sB.n2, k2 = sC.n2, k3 = sC.n3;
  const S_TREE = seed ^ 0x51ed270b, S_PLANT = seed ^ 0x2f6b9d11, S_ORE = seed ^ 0x6c8e9cf5, S_MISC = seed ^ 0x3c6ef372;
  const S_FUNDO = seed ^ 0x1b873593;   // veios do subsolo novo (profundidade em dobro)
  const sR = createSimplex(seed ^ 0x5f3759df), r2n = sR.n2;   // rios subterrâneos: ruído próprio

  // Altura do terreno, relativa ao nível do mar (float). `baseRel` é o relevo de sempre; com mapa de arquipélago
  // (shared/arquipelago.js) a altura passa por ele: miolo da ilha e obras iguais, costa vira praia, resto vira oceano.
  function baseRel(x, z) {
    const wx = x + 38 * n2(x * 0.0031 + 11.5, z * 0.0031 - 7.2);
    const wz = z + 38 * n2(x * 0.0031 - 51.3, z * 0.0031 + 23.9);
    const reg = fbm(n2, wx * 0.00105, wz * 0.00105, 4) + 0.11;
    const r2 = x * x + z * z;
    const far = smoothstep(180 * 180, 420 * 420, r2);
    let cont = reg;
    if (far > 0) {
      const macroBasin = fbm(n2, x * 0.00022 - 41.2, z * 0.00022 + 19.8, 2) * 0.95 + 0.03;
      const shelfMask = smoothstep(0.02, 0.16, macroBasin);
      const macroCont = macroBasin + (reg - 0.11) * (0.45 * shelfMask);
      cont = lerp(reg, macroCont, far);
    }
    const ero = fbm(m2, wx * 0.0016 + 400, wz * 0.0016 - 250, 3);
    const land = smoothstep(-0.06, 0.12, cont);
    const seaAmp = 5 * (1 - far);
    let h = spline(cont);
    h += fbm(m2, wx * 0.0068, wz * 0.0068, 4) * (seaAmp + (14 - seaAmp) * land);
    const mnt = smoothstep(-0.08, 0.38, ero) * smoothstep(0.02, 0.24, cont);
    if (mnt > 0) h += mnt * (ridged(n2, wx * 0.0032 + 90, wz * 0.0032 + 90, 5) * 105 - 12);
    h += fbm(n2, x * 0.03, z * 0.03, 2) * (1.6 * (1 - far) + 1.6 * far * land);

    // Rios: vales ao longo das linhas onde um ruído lento cruza o zero.
    if (land > 0 && h < 62) {
      const d = Math.abs(m2(wx * 0.0017 + 700, wz * 0.0017 + 700));
      if (d < 0.13) {
        const w = land * (1 - smoothstep(24, 62, h));
        const bank = lerp(1.6, h, smoothstep(0.024, 0.13, d));
        const bed = lerp(-3.6, 1.6, smoothstep(0.0, 0.024, d));
        const target = d < 0.024 ? bed : bank;
        if (target < h) h = lerp(h, target, w);
      }
    }
    if (h > 80) h = 80 + (h - 80) * 0.3;
    return h;
  }

  const arq = dim === 0 && opt && mapaValido(opt.mapa)
    ? createArquipelago(baseRel, opt.mapa, (x, z) => n2(x * 0.021 + 3.3, z * 0.021 - 8.1), seed) : null;
  const heightRel = arq ? arq.rel : baseRel;
  const temIlhas = !!(arq && arq.ilhas.length);   // ilhas temáticas (shared/ilhas.js): clima, superfície e árvores do tema
  const temObras = !!(arq && arq.obras);          // obras do próprio mundo (cais das balsas, cidade): blocos do gerador
  const AJ = { kind: 0, dens: 0, th: 0, rad: 0, clareira: 0 };
  const fossas = arq && arq.fossas.length ? arq.fossas : null;   // fossas abissais do mapa (null = nenhuma: nada muda)

  // y do bloco de cima a partir da altura relativa. Coluna afundada por uma fossa (h < h0) pode descer abaixo de 3,
  // até Y_PISO_FOSSA, e nunca fica acima do que era (y0); toda outra coluna sai pela conta de sempre.
  const yDeRel = (h) => { const y = Math.floor(SEA + h + 0.5); return y < 3 ? 3 : y > Y_TOP - 14 ? Y_TOP - 14 : y; };
  const yDeFossa = (h, y0) => { const y = Math.floor(SEA + h + 0.5); return y < Y_PISO_FOSSA ? Y_PISO_FOSSA : y > y0 ? y0 : y; };
  function height(x, z) {
    if (!fossas) return yDeRel(heightRel(x, z));
    const h0 = arq.relSemFossa(x, z), y0 = yDeRel(h0), h = arq.afundar(x, z, h0);
    return h < h0 ? yDeFossa(h, y0) : y0;
  }

  // Clima base (sem o efeito da altitude). Devolve por variáveis de saída.
  let oT = 0, oM = 0;
  function climate(x, z) {
    oT = clamp(0.5 + 0.78 * fbm(k2, x * 0.00075 + 300, z * 0.00075 + 300, 3), 0, 1);
    oM = clamp(0.5 + 0.78 * fbm(k2, x * 0.00095 - 700, z * 0.00095 + 200, 3), 0, 1);
    if (temIlhas) {
      // mar aberto entre as ilhas: sem banquisa (o frio natural daquele trecho do mundo antigo não vale mais ali);
      // dentro da região da ilha principal nada muda
      const il = arq.ilhaEm(x, z), c0 = arq.caixa;
      if ((il || x < c0[0] || x > c0[2] || z < c0[1] || z > c0[3]) && oT < 0.34) oT = 0.34;
      if (il) { const w = il.clima(x, z); if (w > 0) { oT += (il.T - oT) * w; oM += (il.M - oM) * w; } }
    }
  }
  const lapse = (y) => Math.max(0, y - SEA - 14) * 0.0062;

  // Clima base nos (n x n) cantos a partir de (x0, z0): alimenta a tinta de grama/folhagem.
  function climateGrid(x0, z0, n, outT, outM) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        climate(x0 + i, z0 + j);
        outT[i + j * n] = oT;
        outM[i + j * n] = oM;
      }
    }
  }

  function biomeAt(x, z) {
    const y = height(x, z);
    climate(x, z);
    const t = oT - lapse(y);
    if (y < SEA) return BIOME.OCEAN;
    if (y <= SEA + 2) return BIOME.BEACH;
    if (t < 0.2) return BIOME.SNOW;
    if (y - SEA > 66) return BIOME.ALPINE;
    if (oT > 0.62 && oM < 0.4) return BIOME.DESERT;
    if (oT > 0.57 && oM < 0.5) return BIOME.SAVANNA;
    if (t < 0.36) return BIOME.TAIGA;
    if (oM > 0.56) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  // Áreas de trabalho reaproveitadas a cada chunk.
  const HM = CW + 2;                       // mapa de alturas com 1 de margem
  const hmap = new Int16Array(HM * HM);
  const topBlock = new Uint8Array(CW * CW);
  const fos = new Uint8Array(HM * HM);     // fossa: quantos blocos a coluna foi afundada (0 = intocada; satura em 255)
  const tetoMin = new Int16Array(CW * CW); // fossa: maior y em que um veio de minério ainda pode entrar na coluna
  const treeCol = new Uint8Array(CW * CW);
  const tArr = new Float32Array(CW * CW);
  const mArr = new Float32Array(CW * CW);
  const GY = (Y_TOP >> 2) + 1;   // grade das cavernas de ruído (desligadas): só a parte de cima, como antes
  const ca = new Float32Array(5 * 5 * GY);
  const cb = new Float32Array(5 * 5 * GY);
  const cc = new Float32Array(5 * 5 * GY);

  // Sorteia a árvore da célula (gx, gz). Devolve null ou a descrição dela.
  function treeAt(gx, gz) {
    const h = hash3(gx, 77, gz, S_TREE);
    const roll = (h & 0xffff) / 65536;
    if (roll > 0.88) return null; // densidade máxima possível
    const tx = gx * TREE_CELL + ((h >>> 16) & 3);
    const tz = gz * TREE_CELL + ((h >>> 18) & 3);
    const y = height(tx, tz);
    if (y <= SEA + 1 || y - SEA > 70) return null;
    if (temObras && arq.semArvore(tx, tz)) return null;
    climate(tx, tz);
    const t = oT - lapse(y), m = oM, hot = oT;
    // declive: árvore não nasce em paredão
    const s = Math.max(
      Math.abs(height(tx + 1, tz) - y), Math.abs(height(tx - 1, tz) - y),
      Math.abs(height(tx, tz + 1) - y), Math.abs(height(tx, tz - 1) - y));
    if (s > 2) return null;
    const r2 = ((h >>> 20) & 0xff) / 256;
    const r3 = ((h >>> 28) & 0xf) / 16;
    let kind, dens;
    const praia = arq && arq.p(tx, tz) <= 0 ? arq.s(tx, tz) : null;        // arquipélago: faixa da praia nova
    if (praia !== null && praia > -PRAIA) {
      if (praia > -6) return null;                                          // areia da beira-mar: sem árvore
      kind = 5; dens = praia > -32 ? 0.5 : 0.16;                            // coqueiro modelado (render/coqueiros.js), sem blocos
    }
    else if (hot > 0.62 && m < 0.4) { kind = 3; dens = 0.045; }                   // cacto
    else if (y <= SEA + 2) { if (hot < 0.48) return null; kind = 4; dens = 0.13; } // palmeira
    else if (hot > 0.57 && m < 0.5) { kind = 2; dens = 0.11; }               // copa chata
    else if (t < 0.36) { kind = 1; dens = t < 0.2 ? 0.14 : lerp(0.3, 0.74, smoothstep(0.32, 0.6, m)); } // pinheiro
    else { kind = 0; dens = lerp(0.06, 0.85, smoothstep(0.42, 0.6, m)); }    // frondosa
    // ilha temática: o tema ajusta (mata fechada, coqueiral, cone pelado…) ou tira a árvore
    let clareira = 0, thT = 0, radT = 0;
    if (temIlhas) {
      const il = arq.ilhaEm(tx, tz);
      if (il) {
        AJ.kind = kind; AJ.dens = dens; AJ.th = 0; AJ.rad = 0; AJ.clareira = 0;
        if (!il.arvore(AJ, tx, tz, y, SEA, praia !== null && praia > -PRAIA ? praia : null, r2, r3)) return null;
        kind = AJ.kind; dens = AJ.dens; clareira = AJ.clareira; thT = AJ.th; radT = AJ.rad;
      }
    }
    // clareiras
    if (clareira > 0) { const cl = 0.35 + 0.65 * smoothstep(-0.35, 0.1, k2(tx * 0.011 + 55, tz * 0.011 - 91)); dens *= cl + (1 - cl) * clareira; }
    else dens *= 0.35 + 0.65 * smoothstep(-0.35, 0.1, k2(tx * 0.011 + 55, tz * 0.011 - 91));
    if (roll > dens) return null;
    let th, rad;
    if (kind === 0) { th = 4 + Math.floor(r2 * 4); rad = 2.3 + r3 * 1.1; if (r2 > 0.92) { th += 3; rad = 3.9; } }
    else if (kind === 1) { th = 7 + Math.floor(r2 * 6); rad = 2.2 + r3 * 0.9; }
    else if (kind === 2) { th = 4 + Math.floor(r2 * 3); rad = 3.2 + r3 * 0.7; }
    else if (kind === 3) { th = 2 + Math.floor(r2 * 3); rad = 0; }
    else { th = 5 + Math.floor(r2 * 3); rad = 3; }
    if (thT) { th = thT; rad = radT; }
    return { x: tx, y, z: tz, kind, th, rad, h };
  }

  // Os campos lentos de cada rio (portão e torção) são amostrados nos 4 cantos do pedaço e interpolados (bilinear, só
  // + − ×): o leito sai igual para quem gera o pedaço e para quem pergunta por uma coluna (rioEm), e o pedaço custa 12
  // amostras por rio em vez de 3 por coluna. Como o portão interpolado nunca passa do maior canto, pedaço com os 4
  // cantos abaixo do limiar não tem rio nenhum (e nem calcula a torção).
  const C_RIO = new Float64Array(12);
  function cantosRio(rio, cx, cz, out = C_RIO) {
    const s = rio.s, F = RIO.portaoF, TF = RIO.torcaoF;
    let gMax = -2;
    for (let k = 0; k < 4; k++) {
      const X = (cx + (k & 1)) * CW, Z = (cz + (k >> 1)) * CW;
      out[k] = r2n(X * F + s[0], Z * F + s[1]);
      if (out[k] > gMax) gMax = out[k];
    }
    if (gMax < RIO.limiar) return false;
    for (let k = 0; k < 4; k++) {
      const X = (cx + (k & 1)) * CW, Z = (cz + (k >> 1)) * CW;
      out[4 + k] = RIO.torcao * r2n(X * TF + s[2], Z * TF + s[3]);
      out[8 + k] = RIO.torcao * r2n(X * TF + s[4], Z * TF + s[5]);
    }
    return true;
  }
  const bil = (C, o, fx, fz) => C[o] + (C[o + 1] - C[o]) * fx + (C[o + 2] - C[o]) * fz + (C[o] - C[o + 1] - C[o + 2] + C[o + 3]) * fx * fz;
  // Leito na coluna (x, z) do pedaço cujos cantos estão em C: 0 fora; dentro, de >0 (margem) a 1 (meio do leito).
  function leitoRio(rio, x, z, C) {
    const fx = (x - Math.floor(x / CW) * CW) / CW, fz = (z - Math.floor(z / CW) * CW) / CW;
    const g = bil(C, 0, fx, fz);
    if (g < RIO.limiar) return 0;
    let fade = smoothstep(RIO.limiar, RIO.limiar + RIO.borda, g);
    for (const q of SEM_RIO) {                                                     // longe do campo do mundo oficial
      const dx = x < q.x0 ? q.x0 - x : x > q.x1 ? x - q.x1 : 0, dz = z < q.z0 ? q.z0 - z : z > q.z1 ? z - q.z1 : 0;
      const d = Math.sqrt(dx * dx + dz * dz) - q.folga;
      if (d <= 0) return 0;
      if (d < 16) fade *= d / 16;
    }
    if (fossas) {                                                                  // longe das fossas abissais do mapa
      const d = arq.distFossas(x, z) - FOSSA.folgaRio;
      if (d <= 0) return 0;
      if (d < FOSSA.esmaeceRio) fade *= d / FOSSA.esmaeceRio;
    }
    const s = rio.s;
    const wx = x + bil(C, 4, fx, fz), wz = z + bil(C, 8, fx, fz);
    const u = wx * RIO.leitoF + s[6], v = wz * RIO.leitoF + s[7], n = r2n(u, v);
    if (Math.abs(n) > RIO.corte) return 0;
    const e = 0.6 * RIO.leitoF;                                                    // gradiente por diferença finita
    const gu = (r2n(u + e, v) - n) / e, gv = (r2n(u, v + e) - n) / e;
    const gr = Math.sqrt(gu * gu + gv * gv) * RIO.leitoF;                          // ruído por metro
    const dist = Math.abs(n) / Math.max(gr, RIO.gradMin);                          // metros até o meio do leito
    const meia = (RIO.meia0 + RIO.meia1 * (0.5 + 0.5 * r2n(x * 0.01 + s[8], z * 0.01 + s[9]))) * fade * Math.min(1, gr / RIO.gradMin);
    return dist < meia ? 1 - dist / meia : 0;
  }
  // a mesma conta para uma coluna avulsa (testes, ferramentas de medição)
  const C_AVULSA = new Float64Array(12);
  function rioEm(rio, x, z) {
    x = Math.floor(x); z = Math.floor(z);
    if (!cantosRio(rio, Math.floor(x / CW), Math.floor(z / CW), C_AVULSA)) return 0;
    return leitoRio(rio, x, z, C_AVULSA);
  }
  // Rocha-mãe antiga (y 0…2) pelo sorteio de antes: os veios de cima não entram onde ela ficava (ali nada mais muda).
  const eraRochaMae = (wx, y, wz) => y <= 0 || (y <= 2 && rand3(wx, y, wz, S_MISC) < (y === 1 ? 0.55 : 0.2));

  const fortaleza = dim === 0 && centroValido(opt?.fortaleza) ? opt.fortaleza : null;
  function generate(cx, cz) {
    const vox = new Uint8Array(CHUNK_VOL);
    const x0 = cx * CW, z0 = cz * CW;
    let maxY = 0;               // maior y ocupado (do mundo)
    let minY = Y_TOP;           // menor y com célula que não é cubo opaco (ar, água): abaixo disso o mesher nem olha
    const ilC = temIlhas ? arq.ilhaEm(x0 + 8, z0 + 8) : null;     // ilha temática deste pedaço (as caixas não se tocam)

    // 1) alturas com margem de 1. Pedaço que encosta numa fossa abissal marca também quais colunas ela afundou.
    const comFossa = fossas !== null && arq.fossaPerto(x0 - 1, z0 - 1, x0 + CW, z0 + CW);
    if (comFossa) {
      for (let j = 0; j < HM; j++) for (let i = 0; i < HM; i++) {
        const X = x0 + i - 1, Z = z0 + j - 1, h0 = arq.relSemFossa(X, Z), y0 = yDeRel(h0), h = arq.afundar(X, Z, h0);
        const y = h < h0 ? yDeFossa(h, y0) : y0;
        hmap[i + j * HM] = y; fos[i + j * HM] = y0 - y > 255 ? 255 : y0 - y;
      }
    } else {
      for (let j = 0; j < HM; j++) {
        for (let i = 0; i < HM; i++) hmap[i + j * HM] = height(x0 + i - 1, z0 + j - 1);
      }
    }

    // 2) árvores candidatas (inclui as de fora cuja copa entra aqui)
    treeCol.fill(0);
    const trees = [];
    const g0x = Math.floor((x0 - TREE_REACH) / TREE_CELL), g1x = Math.floor((x0 + CW - 1 + TREE_REACH) / TREE_CELL);
    const g0z = Math.floor((z0 - TREE_REACH) / TREE_CELL), g1z = Math.floor((z0 + CW - 1 + TREE_REACH) / TREE_CELL);
    for (let gz = g0z; gz <= g1z; gz++) {
      for (let gx = g0x; gx <= g1x; gx++) {
        const t = treeAt(gx, gz);
        if (!t) continue;
        trees.push(t);
        const lx = t.x - x0, lz = t.z - z0;
        if (lx >= 0 && lx < CW && lz >= 0 && lz < CW) treeCol[lx + lz * CW] = 1;
      }
    }

    // 3) colunas: rocha, solo, superfície, água. O subsolo novo é igual em toda coluna até a menor base possível do
    // basalto (BASALTO_BAIXO_MIN): rocha-mãe na camada do fundo e rocha profunda acima, preenchidos por camada inteira
    // (contíguos no vetor); por coluna só o sorteio da rocha-mãe nas duas camadas de cima dela e o resto, como antes.
    vox.fill(B.BEDROCK, 0, 256);
    vox.fill(B.DEEP_STONE, 256, (BASALTO_BAIXO_MIN - Y_MIN) << 8);
    for (let z = 0; z < CW; z++) {
      for (let x = 0; x < CW; x++) {
        const wx = x0 + x, wz = z0 + z;
        const hi = (x + 1) + (z + 1) * HM;
        const H = hmap[hi];
        const slope = Math.max(
          Math.abs(hmap[hi + 1] - H), Math.abs(hmap[hi - 1] - H),
          Math.abs(hmap[hi + HM] - H), Math.abs(hmap[hi - HM] - H));
        climate(wx, wz);
        const temp = oT, moist = oM;
        const tEff = temp - lapse(H) + (rand2(wx, wz, S_MISC) - 0.5) * 0.035;
        tArr[x + z * CW] = tEff; mArr[x + z * CW] = moist;
        const above = H - SEA;
        const r = rand2(wx, wz, S_MISC ^ 0x9e37);

        if (comFossa) {
          const col = x + (z << 4);
          tetoMin[col] = Y_TOP;                                            // coluna de sempre: os veios entram como antes
          if (fos[hi] !== 0) {
            // Coluna afundada por uma fossa abissal: a rocha de sempre até o piso (basalto no alto, rocha profunda
            // embaixo), sedimento só onde é plano (piso e patamares: argila com manchas de cascalho; no lábio, a até
            // 3 blocos do fundo de fora, a mesma mistura do mar fundo de fora, para a borda não aparecer), água —
            // fonte — do piso até o mar. Sem ar, sem planta, sem árvore; os veios de minério ficam 2 blocos abaixo de
            // qualquer face à mostra (não afloram na parede nem no piso).
            const basaltTop = 9 + Math.floor(4 * k2(wx * 0.02 + 3, wz * 0.02 + 8));
            const basaltBot = -4 - Math.floor(3 * (k2(wx * 0.017 - 41, wz * 0.017 + 17) + 1));
            if (rand3(wx, Y_MIN + 1, wz, S_MISC) < 0.55) vox[col + 256] = B.BEDROCK;
            if (rand3(wx, Y_MIN + 2, wz, S_MISC) < 0.2) vox[col + 512] = B.BEDROCK;
            for (let y = BASALTO_BAIXO_MIN; y <= H; y++) vox[col + ((y + YO) << 8)] = y < basaltBot ? B.DEEP_STONE : y <= basaltTop ? B.BASALT : B.STONE;
            let sed = 0;
            if (slope <= 1) {
              const patch = k2(wx * 0.045 + 9, wz * 0.045 - 4);            // as mesmas manchas do mar fundo
              if (fos[hi] > 3) sed = patch < -0.35 ? B.GRAVEL : B.CLAY;
              else sed = patch > 0.35 ? B.CLAY : patch < -0.25 ? B.GRAVEL : B.BASALT;
            }
            if (sed) for (let y = H; y >= H - 2; y--) { const vi = col + ((y + YO) << 8); if (vox[vi] !== B.BEDROCK) vox[vi] = sed; }
            topBlock[x + z * CW] = vox[col + ((H + YO) << 8)];
            if (H < SEA) {
              for (let y = H + 1; y <= SEA; y++) vox[col + ((y + YO) << 8)] = B.WATER;
              if (tEff < 0.15) vox[col + ((SEA + YO) << 8)] = B.ICE;
              if (SEA > maxY) maxY = SEA;
            }
            if (H > maxY) maxY = H;
            if (H + 1 < minY) minY = H + 1;
            tetoMin[col] = Math.min(H, hmap[hi + 1], hmap[hi - 1], hmap[hi + HM], hmap[hi - HM]) - 2;
            continue;
          }
        }

        let top, sub, subDepth = 3;
        const praiaS = arq && arq.p(wx, wz) < 0.5 ? arq.s(wx, wz) : null;
        if (praiaS !== null && praiaS > -PRAIA * 0.75 && H >= SEA - 14 && H <= SEA + 3 && slope <= 3) {
          top = B.SAND; sub = B.SAND; subDepth = 4;                         // praia larga e fundo raso de areia clara
        } else if (H < SEA) {
          const depth = SEA - H;
          const patch = k2(wx * 0.045 + 9, wz * 0.045 - 4);
          if (depth <= 3) top = tEff < 0.3 ? B.GRAVEL : B.SAND;
          else if (depth > 28) top = patch > 0.35 ? B.CLAY : patch < -0.25 ? B.GRAVEL : B.BASALT;
          else if (patch > 0.45) top = B.CLAY;
          else if (patch < -0.35 || depth > 16) top = B.GRAVEL;
          else top = B.SAND;
          sub = top === B.CLAY ? B.CLAY : top;
          subDepth = 2;
        } else if (above <= 2 && slope <= 2) {
          top = tEff < 0.3 ? B.GRAVEL : B.SAND; sub = top;
        } else if (slope >= 4 || (slope >= 3 && above > 10)) {
          top = B.STONE; sub = B.STONE;
        } else if (tEff < 0.2) {
          top = B.SNOW; sub = slope >= 3 ? B.STONE : B.DIRT; subDepth = 2;
        } else if (above > 58 && r < smoothstep(58, 78, above)) {
          top = r < 0.12 ? B.GRAVEL : B.STONE; sub = B.STONE;
        } else if (slope >= 3) {
          top = r < 0.5 ? B.GRAVEL : B.DIRT; sub = B.DIRT; subDepth = 1;
        } else if (temp > 0.62 && moist < 0.4) {
          top = B.SAND; sub = B.SAND; subDepth = 3;
        } else {
          top = B.GRASS; sub = B.DIRT;
        }
        let rocha = B.STONE;
        if (ilC) {
          const t2 = ilC.topo(wx, wz, H, SEA, slope, r, top);
          if (t2 !== top) { top = t2; sub = t2 === B.ASH ? B.BASALT : t2 === B.GRASS ? B.DIRT : t2; if (t2 === B.ASH) subDepth = 1; }
          rocha = ilC.rocha(wx, wz);
        }
        topBlock[x + z * CW] = top;

        const desert = top === B.SAND && above > 2;
        const basaltTop = 9 + Math.floor(4 * k2(wx * 0.02 + 3, wz * 0.02 + 8));
        // Do novo fundo para cima. A rocha-mãe desceu para Y_MIN (com o mesmo sorteio de antes nas duas camadas acima
        // dela); onde ela ficava (y 0…2) agora é basalto, que continua até −4…−10; dali para baixo, rocha profunda.
        // De y 3 para cima a coluna sai idêntica à de antes (as regras de cima não mudaram).
        const basaltBot = -4 - Math.floor(3 * (k2(wx * 0.017 - 41, wz * 0.017 + 17) + 1));   // −10 … −4
        const col = x + (z << 4);
        if (rand3(wx, Y_MIN + 1, wz, S_MISC) < 0.55) vox[col + 256] = B.BEDROCK;
        if (rand3(wx, Y_MIN + 2, wz, S_MISC) < 0.2) vox[col + 512] = B.BEDROCK;
        for (let y = BASALTO_BAIXO_MIN; y <= H; y++) {
          let b;
          if (y === H) b = top;
          else if (y >= H - subDepth) b = sub;
          else if (desert && y >= H - 8) b = B.SANDSTONE;
          else if (y < basaltBot) b = B.DEEP_STONE;
          else if (y <= basaltTop) b = B.BASALT;
          else b = rocha;
          vox[col + ((y + YO) << 8)] = b;
        }
        if (H < SEA) {
          for (let y = H + 1; y <= SEA; y++) vox[col + ((y + YO) << 8)] = B.WATER;
          if (tEff < 0.15) vox[col + ((SEA + YO) << 8)] = B.ICE;
          if (SEA > maxY) maxY = SEA;
        }
        if (ilC) {                                     // lago de lava na cratera do vulcão e água da cachoeira selvagem
          const lv = ilC.lava(wx, wz);
          if (lv) { const yl = Math.min(Y_TOP - 2, Math.floor(SEA + lv + 0.5)); for (let y = H + 1; y <= yl; y++) vox[col + ((y + YO) << 8)] = ilC.liquido; if (yl > maxY) maxY = yl; }
          const ag = ilC.agua && ilC.agua(wx, wz);
          if (ag) { const ya = Math.min(Y_TOP - 2, Math.floor(SEA + ag + 0.5)); for (let y = H + 1; y <= ya; y++) vox[col + ((y + YO) << 8)] = B.WATER; if (ya > maxY) maxY = ya; }
        }
        if (H > maxY) maxY = H;
        if (H + 1 < minY) minY = H + 1;
      }
    }

    // 3b) rios subterrâneos (ver RIOS e cantosRio): pedaço sem portão aberto em nenhum canto fica de fora inteiro
    for (const rio of RIOS) {
      if (!cantosRio(rio, cx, cz)) continue;
      for (let z = 0; z < CW; z++) for (let x = 0; x < CW; x++) {
        const wx = x0 + x, wz = z0 + z;
        const t = leitoRio(rio, wx, wz, C_RIO);
        if (t <= 0) continue;
        const fundo = 1 + Math.floor((RIO.fundoMax - 1) * t + 0.5), vao = RIO.vaoMin + Math.floor((RIO.vaoMax - RIO.vaoMin) * t + 0.5);
        const col = x + (z << 4), y0 = rio.y - fundo + 1;
        for (let y = y0; y <= rio.y; y++) vox[col + ((y + YO) << 8)] = B.WATER;
        for (let y = rio.y + 1; y <= rio.y + vao; y++) vox[col + ((y + YO) << 8)] = B.AIR;
        const r = rand2(wx, wz, S_MISC ^ 0x51e7);                                 // leito: cascalho, às vezes argila ou areia
        vox[col + ((y0 - 1 + YO) << 8)] = r < 0.62 ? B.GRAVEL : r < 0.84 ? B.CLAY : B.SAND;
        if (y0 < minY) minY = y0;
      }
    }

    // 4) cavernas: três campos de ruído 3D amostrados numa grade 4x4x4 e interpolados
    const gyN = CAVERNAS_RUIDO ? Math.min(GY, (maxY >> 2) + 2) : 0;   // sem cavernas de ruído: nenhum laço roda
    for (let iy = 0; iy < gyN; iy++) {
      for (let iz = 0; iz < 5; iz++) {
        for (let ix = 0; ix < 5; ix++) {
          const wx = x0 + ix * 4, wy = iy * 4, wz = z0 + iz * 4;
          const gi = ix + iz * 5 + iy * 25;
          ca[gi] = k3(wx * 0.0192, wy * 0.03, wz * 0.0192);
          cb[gi] = k3(wx * 0.0192 + 71.3, wy * 0.03 + 13.7, wz * 0.0192 - 47.1);
          cc[gi] = k3(wx * 0.011 - 20.5, wy * 0.018 + 5.5, wz * 0.011 + 80.2);
        }
      }
    }
    for (let iy = 0; iy < gyN - 1; iy++) {
      for (let iz = 0; iz < 4; iz++) {
        for (let ix = 0; ix < 4; ix++) {
          const g = ix + iz * 5 + iy * 25;
          const a000 = ca[g], a100 = ca[g + 1], a010 = ca[g + 5], a110 = ca[g + 6];
          const a001 = ca[g + 25], a101 = ca[g + 26], a011 = ca[g + 30], a111 = ca[g + 31];
          const b000 = cb[g], b100 = cb[g + 1], b010 = cb[g + 5], b110 = cb[g + 6];
          const b001 = cb[g + 25], b101 = cb[g + 26], b011 = cb[g + 30], b111 = cb[g + 31];
          const c000 = cc[g], c100 = cc[g + 1], c010 = cc[g + 5], c110 = cc[g + 6];
          const c001 = cc[g + 25], c101 = cc[g + 26], c011 = cc[g + 30], c111 = cc[g + 31];
          for (let dy = 0; dy < 4; dy++) {
            const y = iy * 4 + dy;
            if (y < 2 || y > maxY) continue;
            const fy = dy * 0.25;
            for (let dz = 0; dz < 4; dz++) {
              const z = iz * 4 + dz, fz = dz * 0.25;
              for (let dx = 0; dx < 4; dx++) {
                const x = ix * 4 + dx, fx = dx * 0.25;
                const hi = (x + 1) + (z + 1) * HM;
                const H = hmap[hi];
                if (y > H) continue;
                const depth = H - y;
                if (H < SEA) { if (depth < 5) continue; }
                else if (H <= SEA + 3) { if (depth < 6) continue; }
                if (treeCol[x + z * CW] && depth < 8) continue;
                // nunca abrir um buraco encostado na água
                if (y <= SEA + 1 && (hmap[hi + 1] < y || hmap[hi - 1] < y || hmap[hi + HM] < y || hmap[hi - HM] < y)) continue;
                const vi = x + (z << 4) + ((y + YO) << 8);
                if (vox[vi] === B.BEDROCK) continue;

                const cx0 = c000 + (c100 - c000) * fx, cx1 = c010 + (c110 - c010) * fx;
                const cx2 = c001 + (c101 - c001) * fx, cx3 = c011 + (c111 - c011) * fx;
                const cz0 = cx0 + (cx1 - cx0) * fz, cz1 = cx2 + (cx3 - cx2) * fz;
                const c = cz0 + (cz1 - cz0) * fy;
                let carve = false;
                if (depth >= 6 && c > 0.56 + Math.max(0, y - 34) * 0.006) carve = true;
                if (!carve) {
                  const ax0 = a000 + (a100 - a000) * fx, ax1 = a010 + (a110 - a010) * fx;
                  const ax2 = a001 + (a101 - a001) * fx, ax3 = a011 + (a111 - a011) * fx;
                  const az0 = ax0 + (ax1 - ax0) * fz, az1 = ax2 + (ax3 - ax2) * fz;
                  const a = az0 + (az1 - az0) * fy;
                  const bx0 = b000 + (b100 - b000) * fx, bx1 = b010 + (b110 - b010) * fx;
                  const bx2 = b001 + (b101 - b001) * fx, bx3 = b011 + (b111 - b011) * fx;
                  const bz0 = bx0 + (bx1 - bx0) * fz, bz1 = bx2 + (bx3 - bx2) * fz;
                  const b = bz0 + (bz1 - bz0) * fy;
                  let thr = 0.014 + 0.026 * (0.5 + 0.5 * c);
                  if (depth < 6) thr *= 0.12 + depth * 0.14; // perto da superfície os túneis afinam: poucas bocas de caverna
                  if (a * a + b * b < thr) carve = true;
                }
                if (carve) { vox[vi] = B.AIR; if (y < minY) minY = y; }
              }
            }
          }
        }
      }
    }

    // 5) veios de minério: no máximo um por célula de 8x8x8
    const o0x = Math.floor((x0 - 3) / ORE_CELL), o1x = Math.floor((x0 + CW + 2) / ORE_CELL);
    const o0z = Math.floor((z0 - 3) / ORE_CELL), o1z = Math.floor((z0 + CW + 2) / ORE_CELL);
    const o1y = Math.min(Math.floor((maxY + 3) / ORE_CELL), Math.floor((Y_TOP - 1) / ORE_CELL));
    for (let oy = 0; oy <= o1y; oy++) {
      for (let oz = o0z; oz <= o1z; oz++) {
        for (let ox = o0x; ox <= o1x; ox++) {
          const h = hash3(ox, oy, oz, S_ORE);
          const roll = (h & 0xffff) / 65536;
          const vy = oy * ORE_CELL + ((h >>> 16) & 7);
          let ore = 0, rad = 0;
          if (roll < 0.045 && vy >= 3 && vy <= 30) { ore = B.CRYSTAL_ORE; rad = 1.5; }
          else if (roll < 0.1 && vy >= 4 && vy <= 36) { ore = B.GOLD_ORE; rad = 1.4; }
          else if (roll < 0.21 && vy >= 16 && vy <= 100) { ore = B.COPPER_ORE; rad = 1.8; }
          else if (roll < 0.38 && vy >= 5 && vy <= 84) { ore = B.IRON_ORE; rad = 1.8; }
          else if (roll < 0.66 && vy >= 8 && vy <= 140) { ore = B.COAL_ORE; rad = 2.1; }
          if (!ore) continue;
          const vx = ox * ORE_CELL + ((h >>> 19) & 7), vz = oz * ORE_CELL + ((h >>> 22) & 7);
          rad += ((h >>> 25) & 7) * 0.09;
          const ri = Math.ceil(rad), r2 = rad * rad;
          for (let dy = -ri; dy <= ri; dy++) {
            const y = vy + dy;
            if (y < 1 || y >= Y_TOP) continue;
            for (let dz = -ri; dz <= ri; dz++) {
              const z = vz + dz - z0;
              if (z < 0 || z >= CW) continue;
              for (let dx = -ri; dx <= ri; dx++) {
                const x = vx + dx - x0;
                if (x < 0 || x >= CW) continue;
                const d2 = dx * dx + dy * dy * 1.4 + dz * dz;
                if (d2 > r2) continue;
                if (d2 > r2 * 0.45 && rand3(vx + dx, y, vz + dz, S_ORE) < 0.45) continue;
                if (y <= 2 && eraRochaMae(vx + dx, y, vz + dz)) continue;   // onde era rocha-mãe, nada muda
                if (comFossa && y > tetoMin[x + (z << 4)]) continue;        // fossa abissal: veio não aflora
                const vi = x + (z << 4) + ((y + YO) << 8);
                const cur = vox[vi];
                if (cur === B.STONE || cur === B.BASALT) vox[vi] = ore;
              }
            }
          }
        }
      }
    }

    // 5b) veios do subsolo novo (y < 0): sorteio próprio (S_FUNDO), tabela da faixa do centro do veio
    // (shared/minerios.js). Só trocam rocha (profunda, basalto, pedra): nunca água, ar ou o leito dos rios. Ficam de
    // y −1 para baixo e acima das duas camadas da rocha-mãe sorteada.
    for (let oy = Y_MIN / ORE_CELL; oy < 0; oy++) {
      for (let oz = o0z; oz <= o1z; oz++) {
        for (let ox = o0x; ox <= o1x; ox++) {
          const h = hash3(ox, oy, oz, S_FUNDO);
          const vy = oy * ORE_CELL + ((h >>> 16) & 7);
          const faixa = faixaFundo(vy);
          if (!faixa) continue;
          const roll = (h & 0xffff) / 65536;
          let ore = 0, rad = 0, acc = 0;
          for (const v of faixa.veios) { acc += v[1]; if (roll < acc) { ore = v[0]; rad = v[2]; break; } }
          if (!ore) continue;
          const vx = ox * ORE_CELL + ((h >>> 19) & 7), vz = oz * ORE_CELL + ((h >>> 22) & 7);
          rad += ((h >>> 25) & 7) * 0.09;
          const ri = Math.ceil(rad), r2 = rad * rad;
          for (let dy = -ri; dy <= ri; dy++) {
            const y = vy + dy;
            if (y <= Y_MIN + 2 || y >= 0) continue;
            for (let dz = -ri; dz <= ri; dz++) {
              const z = vz + dz - z0;
              if (z < 0 || z >= CW) continue;
              for (let dx = -ri; dx <= ri; dx++) {
                const x = vx + dx - x0;
                if (x < 0 || x >= CW) continue;
                const d2 = dx * dx + dy * dy * 1.4 + dz * dz;
                if (d2 > r2) continue;
                if (d2 > r2 * 0.45 && rand3(vx + dx, y, vz + dz, S_FUNDO) < 0.45) continue;
                if (comFossa && y > tetoMin[x + (z << 4)]) continue;        // fossa abissal: veio não aflora
                const vi = x + (z << 4) + ((y + YO) << 8);
                const cur = vox[vi];
                if (cur === B.DEEP_STONE || cur === B.STONE || cur === B.BASALT) vox[vi] = ore;
              }
            }
          }
        }
      }
    }

    // 5c) obras do próprio mundo (shared/cais.js; a cidade da ilha metrópole): entram como blocos do gerador
    if (temObras) arq.obras(x0, z0, (wx, y, wz, b) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || x >= CW || z < 0 || z >= CW || y < 1 || y >= Y_TOP) return;
      vox[x + (z << 4) + ((y + YO) << 8)] = b;
      if (b !== B.AIR && y > maxY) maxY = y;
      if ((b === B.AIR || b === B.WATER) && y < minY) minY = y;
    }, (wx, wz) => { const i = wx - x0 + 1, j = wz - z0 + 1; return i >= 0 && i < HM && j >= 0 && j < HM ? hmap[i + j * HM] : height(wx, wz); });

    // 6) árvores
    const put = (wx, y, wz, b, force) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || x >= CW || z < 0 || z >= CW || y < 1 || y >= Y_TOP) return;
      const vi = x + (z << 4) + ((y + YO) << 8);
      const cur = vox[vi];
      if (force ? (cur === B.AIR || cur === B.LEAVES || cur === B.PINE_LEAVES || cur === B.TALL_GRASS) : cur === B.AIR) {
        vox[vi] = b;
        if (y > maxY) maxY = y;
      }
    };
    for(const t of trees)plantTree(t,seed,put);

    // 7) plantas rasteiras
    for (let z = 0; z < CW; z++) {
      for (let x = 0; x < CW; x++) {
        const hi = (x + 1) + (z + 1) * HM;
        const H = hmap[hi];
        if (H < SEA || H + 1 >= Y_TOP) continue;
        const vi = x + (z << 4) + ((H + YO) << 8);
        const ground = vox[vi];
        if (vox[vi + 256] !== B.AIR) continue;
        const wx = x0 + x, wz = z0 + z;
        if (ilC && ilC.semPlanta && ilC.semPlanta(wx, wz)) continue;   // cidade da ilha metrópole: gramado do estádio, ruas e pisos sem mato
        const r = rand2(wx, wz, S_PLANT);
        const tEff = tArr[x + z * CW], moist = mArr[x + z * CW];
        let p = 0;
        if (ilC && ilC.planta && ground === B.GRASS) {
          const beira = H <= SEA + 2 && (hmap[hi + 1] < SEA || hmap[hi - 1] < SEA || hmap[hi + HM] < SEA || hmap[hi - HM] < SEA);
          p = ilC.planta(wx, wz, ground, H, SEA, r, beira);
        } else if (ground === B.GRASS) {
          const meadow = k2(wx * 0.035 - 12, wz * 0.035 + 44);
          const patch = k2(wx * 0.075 + 91, wz * 0.075 - 37);
          const dry = tEff > 0.57 && moist < 0.5;
          const lush = moist > 0.56;
          const cold = tEff < 0.36;
          const grassP = dry ? 0.42 : cold ? 0.14 : lush ? 0.22 : 0.34;
          const fernP = cold ? 0.15 : lush ? 0.22 : 0.035;
          const flowerP = dry || cold ? 0.025 : (meadow > 0.22 || patch > 0.48) ? 0.20 : 0.045;
          if (r < flowerP) {
            const kindN = k2(wx * 0.012 + 200, wz * 0.012 - 130) + (rand2(wx, wz, S_PLANT ^ 0x55) - 0.5) * 0.5;
            p = kindN < -0.25 ? B.FLOWER_BLUE : kindN < 0.05 ? B.FLOWER_YELLOW : kindN < 0.3 ? B.FLOWER_WHITE : B.FLOWER_RED;
          } else if (r < flowerP + fernP) p = B.FERN;
          else if (r < flowerP + fernP + grassP) p = B.TALL_GRASS;
          // junco e samambaia na beira d'água
          if (H <= SEA + 2 && (hmap[hi + 1] < SEA || hmap[hi - 1] < SEA || hmap[hi + HM] < SEA || hmap[hi - HM] < SEA)) {
            if (r > 0.42) p = B.REEDS;
            else if (r < 0.14) p = B.FERN;
          }
        } else if (ground === B.SAND && arq && arq.p(wx, wz) <= 0 && arq.s(wx, wz) > -PRAIA) {
          // praia do arquipélago: areia limpa até a linha da maré; capim de restinga só no alto, perto da vegetação
          const sp = arq.s(wx, wz);
          if (sp < -22 && r < 0.05 + 0.1 * smoothstep(-22, -36, sp)) p = r < 0.012 ? B.DRY_SHRUB : B.TALL_GRASS;
        } else if (ground === B.SAND) {
          if (H <= SEA + 2) {
            if (r < 0.28 && tEff > 0.25 && (hmap[hi + 1] < SEA || hmap[hi - 1] < SEA || hmap[hi + HM] < SEA || hmap[hi - HM] < SEA)) p = B.REEDS;
            else if (r > 0.90 && tEff > 0.35) p = r > 0.95 ? B.DRY_SHRUB : B.FERN;
          } else if (H > SEA + 2) {
            if (r < 0.055) p = B.DRY_SHRUB;
            else if (r > 0.975 && moist > 0.32) p = r > 0.988 ? B.FLOWER_YELLOW : B.FLOWER_RED;
          }
        } else if (ground === B.DIRT || ground === B.CLAY) {
          if (H > SEA + 1) {
            if (r < 0.12) p = B.FERN;
            else if (r < 0.16) p = r < 0.14 ? B.FLOWER_WHITE : B.FLOWER_BLUE;
            else if (r < 0.24) p = B.TALL_GRASS;
          }
        }
        if (p) {
          vox[vi + 256] = p;
          if (H + 1 > maxY) maxY = H + 1;
        }
      }
    }

    if (fortaleza) maxY = imprimirFortaleza(vox, x0, z0, fortaleza, maxY, opt.origemFortaleza);
    return { vox, maxY, minY };
  }

  // Ponto de nascimento: terra firme e plana mais próxima da origem.
  function findSpawn() {
    for (let ring = 0; ring < 400; ring++) {
      const steps = ring === 0 ? 1 : ring * 8;
      for (let s = 0; s < steps; s++) {
        let x, z;
        if (ring === 0) { x = 0; z = 0; } else {
          const side = Math.floor(s / (ring * 2)), off = (s % (ring * 2)) - ring;
          if (side === 0) { x = off; z = -ring; } else if (side === 1) { x = ring; z = off; }
          else if (side === 2) { x = -off; z = ring; } else { x = -ring; z = -off; }
        }
        const wx = x * 6 + 8, wz = z * 6 + 8;
        const y = height(wx, wz);
        if (y < SEA + 3 || y > SEA + 30) continue;
        const flat = Math.max(Math.abs(height(wx + 2, wz) - y), Math.abs(height(wx - 2, wz) - y),
          Math.abs(height(wx, wz + 2) - y), Math.abs(height(wx, wz - 2) - y));
        if (flat > 1) continue;
        const b = biomeAt(wx, wz);
        if (b !== BIOME.PLAINS && b !== BIOME.FOREST && ring < 200) continue;
        return { x: wx + 0.5, y: y + 1, z: wz + 0.5 };
      }
    }
    return { x: 8.5, y: SEA + 30, z: 8.5 };
  }

  // Bloco da superfície e copa de uma coluna, sem gerar o pedaço: para o retrato de longe (relevo distante do mar,
  // mapas). Mesma ordem de regras das colunas de generate(), sem o sorteio fino; copa = a árvore sorteada na célula
  // (0 nada · 1 frondosa/copa chata/palmeira · 2 pinheiro · 3 coqueiro). Devolve sempre o mesmo objeto.
  const TP = { top: 0, H: 0, T: 0, M: 0, copa: 0 };
  function topoEm(x, z) {
    const H = height(x, z);
    const slope = Math.max(Math.abs(height(x + 1, z) - H), Math.abs(height(x - 1, z) - H), Math.abs(height(x, z + 1) - H), Math.abs(height(x, z - 1) - H));
    climate(x, z);
    const temp = oT, moist = oM, tEff = temp - lapse(H), above = H - SEA, r = rand2(x, z, S_MISC ^ 0x9e37);
    const praiaS = arq && arq.p(x, z) < 0.5 ? arq.s(x, z) : null;
    let top;
    if (praiaS !== null && praiaS > -PRAIA * 0.75 && H >= SEA - 14 && H <= SEA + 3 && slope <= 3) top = B.SAND;
    else if (H < SEA) top = B.WATER;
    else if (above <= 2 && slope <= 2) top = tEff < 0.3 ? B.GRAVEL : B.SAND;
    else if (slope >= 4 || (slope >= 3 && above > 10)) top = B.STONE;
    else if (tEff < 0.2) top = B.SNOW;
    else if (above > 58 && r < smoothstep(58, 78, above)) top = B.STONE;
    else if (slope >= 3) top = B.DIRT;
    else if (temp > 0.62 && moist < 0.4) top = B.SAND;
    else top = B.GRASS;
    let obra = 0;
    if (temIlhas && H >= SEA) {
      const il = arq.ilhaEm(x, z);
      if (il) {
        top = il.topo(x, z, H, SEA, slope, r, top);
        if (il.agua && il.agua(x, z) > H - SEA) top = B.WATER;
        else if (il.lava && il.lava(x, z) > H - SEA) top = B.MAGMA;
        if (il.topoObra) obra = il.topoObra(x, z);
      }
    }
    TP.top = top; TP.H = H; TP.T = tEff; TP.M = moist; TP.copa = 0;
    if (obra > H) { TP.top = B.CONCRETE; return TP; }   // prédio da cidade: de longe o chão dele é cinza (o perfil são as caixas de game/cidade-longe.js)
    if (H >= SEA) { const t = treeAt(Math.floor(x / TREE_CELL), Math.floor(z / TREE_CELL)); if (t) TP.copa = t.kind === 1 ? 2 : t.kind === 3 ? 0 : t.kind === 5 ? 3 : 1; }
    return TP;
  }

  function treesNear(x,z,r=4){
    const out=[];
    for(let gz=Math.floor((z-r)/TREE_CELL);gz<=Math.floor((z+r)/TREE_CELL);gz++)for(let gx=Math.floor((x-r)/TREE_CELL);gx<=Math.floor((x+r)/TREE_CELL);gx++){
      const t=treeAt(gx,gz);if(t&&t.kind!==3&&t.kind!==5)out.push(t);
    }
    return out;
  }
  // coqueiros da praia do arquipélago (tipo 5): não viram blocos, são desenhados por render/coqueiros.js
  function coqueiros(x,z,r){
    const out=[];
    for(let gz=Math.floor((z-r)/TREE_CELL);gz<=Math.floor((z+r)/TREE_CELL);gz++)for(let gx=Math.floor((x-r)/TREE_CELL);gx<=Math.floor((x+r)/TREE_CELL);gx++){
      const t=treeAt(gx,gz);if(t&&t.kind===5)out.push(t);
    }
    return out;
  }
  return { seed, fundo: Y_MIN, generate, height, heightRel, arq, fortaleza, biomeAt, climateGrid, lapse, findSpawn, treeAt, treesNear, coqueiros, rioEm, topoEm };

}


// Planos que não descem (Zona, macro, nano): o fundo deles continua em y 0. Geram no formato de antes (y de 0 a
// Y_TOP − 1, o mesmo código de sempre) e o embrulho põe no armazenamento novo, com rocha-mãe nas camadas de baixo — é o
// que o mundo e o mesher sempre leram abaixo de 0 nesses planos (o servidor ainda lê vazio abaixo de 0 na Zona, como
// antes: terrain.js). minY 0: o mesher começa no fundo do plano, como sempre.
const VOL_ANTIGO = CW * CW * Y_TOP;
function emCamadas(antigo, maxY) {
  const vox = new Uint8Array(CHUNK_VOL);
  vox.fill(B.BEDROCK, 0, YO << 8);
  vox.set(antigo, YO << 8);
  return { vox, maxY, minY: 0 };
}

// ---- Zona Fantasma: ilhas de pedra-sombra flutuando no vazio -------------------------------
// A densidade é amostrada numa grade do MUNDO (múltiplos de 4) e interpolada: é função pura
// das coordenadas, então qualquer chunk (e o servidor) chega ao mesmo resultado.
const RUIN_CELL = 40;

function createZoneGen(seed) {
  const sn = createSimplex(seed ^ 0x5a0fa17a);
  const k3 = sn.n3, k2 = sn.n2;
  const S = seed ^ 0x7f4a7c15;
  const GY = 32;                                   // amostras verticais: y = 0, 4, ..., 124
  const grid = new Float32Array(5 * 5 * GY);

  function sample(wx, wy, wz) {
    const top = 66 + 9 * k2(wx * 0.009, wz * 0.009);           // altura do planalto
    const band = 1 - Math.abs(wy - 58) / 34;
    let d = k3(wx * 0.012, wy * 0.024, wz * 0.012) * 0.9 + k3(wx * 0.04 + 31, wy * 0.07, wz * 0.04 - 12) * 0.22 + band * 0.85 - 0.92;
    if (wy > top) d -= (wy - top) * 0.22;                     // topo chato, bom de andar
    return d;
  }
  function density(x, y, z) {
    if (y < 0 || y > 120) return -1;
    const gx = Math.floor(x / 4), gy = Math.floor(y / 4), gz = Math.floor(z / 4);
    const fx = (x - gx * 4) / 4, fy = (y - gy * 4) / 4, fz = (z - gz * 4) / 4;
    const s = (i, j, k) => sample((gx + i) * 4, (gy + j) * 4, (gz + k) * 4);
    const a = s(0, 0, 0) + (s(1, 0, 0) - s(0, 0, 0)) * fx, b = s(0, 0, 1) + (s(1, 0, 1) - s(0, 0, 1)) * fx;
    const c = s(0, 1, 0) + (s(1, 1, 0) - s(0, 1, 0)) * fx, e = s(0, 1, 1) + (s(1, 1, 1) - s(0, 1, 1)) * fx;
    const lo = a + (b - a) * fz, hi = c + (e - c) * fz;
    return lo + (hi - lo) * fy;
  }
  // primeiro bloco sólido de cima para baixo, ou -1 no vazio
  function surface(x, z) {
    for (let y = 112; y >= 8; y--) if (density(x, y, z) > 0) return y;
    return -1;
  }
  function ruinAt(gx, gz) {
    const h = hash3(gx, 91, gz, S);
    if ((h & 0xff) > 150) return null;
    const x = gx * RUIN_CELL + 6 + ((h >>> 8) % 28), z = gz * RUIN_CELL + 6 + ((h >>> 14) % 28);
    const y = surface(x, z);
    if (y < 0) return null;
    return { x, y, z, kind: (h >>> 20) % 5, h };
  }

  function generate(cx, cz) {
    const vox = new Uint8Array(VOL_ANTIGO);
    const x0 = cx * CW, z0 = cz * CW;
    let maxY = 0;
    for (let iy = 0; iy < GY; iy++) for (let iz = 0; iz < 5; iz++) for (let ix = 0; ix < 5; ix++) grid[ix + iz * 5 + iy * 25] = sample(x0 + ix * 4, iy * 4, z0 + iz * 4);
    for (let iy = 0; iy < GY - 1; iy++) for (let iz = 0; iz < 4; iz++) for (let ix = 0; ix < 4; ix++) {
      const g = ix + iz * 5 + iy * 25;
      const d000 = grid[g], d100 = grid[g + 1], d010 = grid[g + 5], d110 = grid[g + 6];
      const d001 = grid[g + 25], d101 = grid[g + 26], d011 = grid[g + 30], d111 = grid[g + 31];
      if (d000 < -0.3 && d100 < -0.3 && d010 < -0.3 && d110 < -0.3 && d001 < -0.3 && d101 < -0.3 && d011 < -0.3 && d111 < -0.3) continue;
      for (let dy = 0; dy < 4; dy++) {
        const y = iy * 4 + dy, fy = dy * 0.25;
        for (let dz = 0; dz < 4; dz++) {
          const fz = dz * 0.25;
          for (let dx = 0; dx < 4; dx++) {
            const fx = dx * 0.25;
            const a = d000 + (d100 - d000) * fx, b = d010 + (d110 - d010) * fx;
            const c = d001 + (d101 - d001) * fx, e = d011 + (d111 - d011) * fx;
            const lo = a + (b - a) * fz, hi = c + (e - c) * fz;
            if (lo + (hi - lo) * fy <= 0) continue;
            const x = ix * 4 + dx, z = iz * 4 + dz;
            vox[x + (z << 4) + (y << 8)] = rand3(x0 + x, y, z0 + z, S) < 0.005 ? B.PHANTOM_CRYSTAL : B.SHADOW_STONE;
            if (y > maxY) maxY = y;
          }
        }
      }
    }
    // superfície: cinza por cima, e de vez em quando uma agulha de cristal
    for (let z = 0; z < CW; z++) for (let x = 0; x < CW; x++) {
      for (let y = Math.min(maxY, 120); y >= 4; y--) {
        const i = x + (z << 4) + (y << 8);
        if (vox[i] === B.AIR) continue;
        const wx = x0 + x, wz = z0 + z, r = rand2(wx, wz, S);
        if (r < 0.78) { vox[i] = B.ASH; if (r < 0.4 && vox[i - 256] !== B.AIR) vox[i - 256] = B.ASH; }
        if (r > 0.994) {
          const hgt = 2 + Math.floor(rand2(wx, wz, S ^ 0x33) * 5);
          for (let k = 1; k <= hgt && y + k < Y_TOP; k++) vox[i + k * 256] = B.PHANTOM_CRYSTAL;
          if (y + hgt > maxY) maxY = y + hgt;
        }
        break;
      }
    }
    // ruínas de todas as eras, uma por célula sorteada
    const put = (wx, y, wz, b) => {
      const x = wx - x0, z = wz - z0;
      if (x < 0 || x >= CW || z < 0 || z >= CW || y < 1 || y >= Y_TOP) return;
      vox[x + (z << 4) + (y << 8)] = b;
      if (b && y > maxY) maxY = y;
    };
    const g0x = Math.floor((x0 - 6) / RUIN_CELL), g1x = Math.floor((x0 + CW + 5) / RUIN_CELL);
    const g0z = Math.floor((z0 - 6) / RUIN_CELL), g1z = Math.floor((z0 + CW + 5) / RUIN_CELL);
    for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) {
      const r = ruinAt(gx, gz);
      if (!r) continue;
      const { x, y, z, kind, h } = r;
      if (x < x0 - 6 || x > x0 + CW + 5 || z < z0 - 6 || z > z0 + CW + 5) continue;
      if (kind === 0) {                                  // antiguidade: anel de colunas quebradas
        for (const [dx, dz, t] of [[4, 0, 5], [-4, 0, 3], [0, 4, 4], [0, -4, 6], [3, 3, 2], [-3, -3, 5], [3, -3, 4], [-3, 3, 1]]) {
          const hh = 1 + ((h >>> (dx + dz + 9)) + t) % 6;
          for (let k = 1; k <= hh; k++) put(x + dx, y + k, z + dz, k === hh && hh > 3 ? B.MARBLE : B.STONE_BRICKS);
        }
        put(x, y + 1, z, B.MARBLE);
      } else if (kind === 1) {                           // pré-história: menir com cristal
        for (let k = 1; k <= 6; k++) { put(x, y + k, z, B.BASALT); if (k <= 4) put(x + 1, y + k, z, B.BASALT); if (k <= 2) put(x, y + k, z + 1, B.BASALT); }
        put(x, y + 7, z, B.PHANTOM_CRYSTAL);
      } else if (kind === 2) {                           // futuro: lasca de torre de aço e vidro
        for (let k = 1; k <= 9; k++) for (let dx = 0; dx < 2; dx++) for (let dz = 0; dz < 2; dz++) {
          if (k > 6 && (dx + dz + k) % 3 === 0) continue;
          put(x + dx, y + k, z + dz, (k % 3 === 0) ? B.GLASS : B.STEEL);
        }
        put(x, y + 10, z, B.LAMP);
      } else if (kind === 3) {                           // idade média: muro de tijolos com lanterna
        for (let dx = -4; dx <= 4; dx++) { const hh = 2 + ((h >>> (dx + 12)) & 3); for (let k = 1; k <= hh; k++) put(x + dx, y + k, z, B.BRICKS); }
        put(x, y + 6, z, B.LAMP);
      } else {                                           // poço de águas místicas
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
          const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          put(x + dx, y, z + dz, edge ? B.STONE_BRICKS : B.MYSTIC_WATER);
          if (edge && (dx + dz) % 2 === 0) put(x + dx, y + 1, z + dz, B.STONE_BRICKS);
        }
      }
    }
    return emCamadas(vox, maxY);
  }

  function findSpawn(nx = 8, nz = 8) {
    for (let ring = 0; ring < 80; ring++) {
      for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const x = nx + dx * 4, z = nz + dz * 4, y = surface(x, z);
        if (y > 0 && surface(x + 2, z) > 0 && surface(x - 2, z) > 0 && surface(x, z + 2) > 0 && surface(x, z - 2) > 0) return { x: x + 0.5, y: y + 1, z: z + 0.5 };
      }
    }
    return { x: nx + 0.5, y: 90, z: nz + 0.5 };
  }

  return {
    seed, dim: 1, fundo: 0, generate, height: (x, z) => Math.max(0, surface(x, z)), surface, heightRel: () => 0, biomeAt: () => 0,
    climateGrid(x0, z0, n, outT, outM) { outT.fill(0.3); outM.fill(0.2); }, lapse: () => 0, findSpawn,
  };
}


// ---- plano macro: o mesmo mundo visto de cima da escala ---------------------------------------
// Cada bloco daqui resume um cubo de FRACTAL blocos de lado do plano normal: mesma costa, mesmos
// biomas, mesmas serras. O relevo é exagerado ~3x na vertical (senão tudo teria 1 bloco de altura).
export const MACRO_SEA = 8;
function createMacroGen(seed, opt = null) {
  const base = createWorldGen(seed, 0, opt);
  const S = seed ^ 0x2c1b3c6d;
  const t1 = new Float32Array(1), m1 = new Float32Array(1);
  // altura média do cubo (5 amostras) e relevo exagerado ~3x: vira um mapa em relevo legível
  const col = (x, z) => {
    const cx = x * FRACTAL + 50, cz = z * FRACTAL + 50;
    const H = (base.height(cx, cz) + base.height(cx - 25, cz - 25) + base.height(cx + 25, cz - 25) + base.height(cx - 25, cz + 25) + base.height(cx + 25, cz + 25)) / 5;
    return Math.max(1, Math.min(60, MACRO_SEA + Math.floor((H - SEA) / 30)));
  };
  function generate(cx, cz) {
    const vox = new Uint8Array(VOL_ANTIGO);
    const x0 = cx * CW, z0 = cz * CW;
    let maxY = MACRO_SEA;
    for (let z = 0; z < CW; z++) for (let x = 0; x < CW; x++) {
      const wx = x0 + x, wz = z0 + z;
      const h = col(wx, wz), biome = base.biomeAt(wx * FRACTAL + 50, wz * FRACTAL + 50), r = rand2(wx, wz, S);
      let top = B.GRASS, cover = 0;
      if (h < MACRO_SEA) top = h < MACRO_SEA - 1 ? B.GRAVEL : B.SAND;
      else if (biome === BIOME.BEACH || biome === BIOME.DESERT) top = B.SAND;
      else if (biome === BIOME.SNOW) top = B.SNOW;
      else if (biome === BIOME.ALPINE) top = B.STONE;
      else if (biome === BIOME.FOREST) cover = r < 0.72 ? B.LEAVES : 0;
      else if (biome === BIOME.TAIGA) cover = r < 0.55 ? B.PINE_LEAVES : 0;
      else if (biome === BIOME.SAVANNA) cover = r < 0.08 ? B.LEAVES : 0;
      else cover = r < 0.05 ? B.LEAVES : 0;
      const i = x + (z << 4);
      vox[i] = B.BEDROCK;
      for (let y = 1; y < h; y++) vox[i + (y << 8)] = top === B.SAND && y > h - 3 ? B.SANDSTONE : B.STONE;
      vox[i + (h << 8)] = top;
      let t = h;
      if (h < MACRO_SEA) { for (let y = h + 1; y <= MACRO_SEA; y++) vox[i + (y << 8)] = B.WATER; t = MACRO_SEA; }
      else if (cover) { vox[i + ((h + 1) << 8)] = cover; t = h + 1; }
      if (t > maxY) maxY = t;
    }
    return emCamadas(vox, maxY);
  }
  return {
    seed, dim: DIM_MACRO, fundo: 0, generate, height: col, heightRel: () => 0, biomeAt: (x, z) => base.biomeAt(x * FRACTAL + 50, z * FRACTAL + 50),
    climateGrid(x0, z0, n, outT, outM) {
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { base.climateGrid((x0 + i) * FRACTAL, (z0 + j) * FRACTAL, 1, t1, m1); outT[i + j * n] = t1[0]; outM[i + j * n] = m1[0]; }
    },
    lapse: () => 0,
    findSpawn() { const s = base.findSpawn(); const x = Math.floor(s.x / FRACTAL), z = Math.floor(s.z / FRACTAL); return { x: x + 0.5, y: col(x, z) + 2, z: z + 0.5 }; },
  };
}

// ---- plano nano: um mapa inteiro dentro de um único bloco ---------------------------------------
// FRACTAL x FRACTAL de área e até FRACTAL de altura, cercado pelas "paredes" do bloco. O que há lá
// dentro depende do bloco em que se mergulhou.
function nanoTheme(b) {
  if (b === B.WATER || b === B.MYSTIC_WATER) return 'agua';
  if (b === B.GRASS || b === B.DIRT || b === B.CLAY) return 'terra';
  if (b === B.SAND || b === B.GRAVEL || b === B.SANDSTONE) return 'areia';
  if (b === B.SNOW || b === B.ICE) return 'gelo';
  if (b === B.LOG || b === B.PINE_LOG || b === B.PLANKS || b === B.PINE_PLANKS) return 'madeira';
  if (b === B.LEAVES || b === B.PINE_LEAVES || b === B.CACTUS) return 'folha';
  if (b === B.STONE || b === B.BASALT || b === B.BEDROCK || (b >= B.COAL_ORE && b <= B.CRYSTAL_ORE) || b === B.SHADOW_STONE) return 'rocha';
  return 'obra';
}
function createNanoGen(seed, opt) {
  const at = opt.at || [0, 0, 0], block = opt.block | 0;
  const S = hash3(at[0], at[1], at[2], seed ^ 0x4e616e6f);
  const sn = createSimplex(S);
  const n2 = sn.n2, n3 = sn.n3;
  const theme = nanoTheme(block);
  const N = FRACTAL;
  const hgt = (x, z) => {
    let h = 34 + 20 * n2(x * 0.021, z * 0.021) + 7 * n2(x * 0.07 + 9, z * 0.07 - 3);
    if (theme === 'madeira') h = 30 + 12 * n2(x * 0.012, z * 0.11) + 5 * n2(x * 0.05, z * 0.4);   // veios da madeira
    if (theme === 'areia') h = 30 + 14 * n2(x * 0.03 + z * 0.012, z * 0.014);                     // dunas
    if (theme === 'agua') h = 22 + 14 * n2(x * 0.025, z * 0.025);
    if (theme === 'obra') h = 26 + 4 * n2(x * 0.03, z * 0.03);
    return Math.max(6, Math.min(78, Math.floor(h)));
  };
  function generate(cx, cz) {
    const vox = new Uint8Array(VOL_ANTIGO);
    const x0 = cx * CW, z0 = cz * CW;
    let maxY = 0;
    for (let z = 0; z < CW; z++) for (let x = 0; x < CW; x++) {
      const wx = x0 + x, wz = z0 + z, i = x + (z << 4);
      if (wx < 0 || wx >= N || wz < 0 || wz >= N) {            // parede do bloco
        for (let y = 0; y <= N + 6; y++) vox[i + (y << 8)] = B.BEDROCK;
        maxY = N + 6;
        continue;
      }
      const h = hgt(wx, wz), r = rand2(wx, wz, S);
      let top = B.STONE, sub = B.STONE, deep = B.BASALT, spire = 0, spireH = 0, water = 0;
      if (theme === 'rocha') { top = sub = block === B.BASALT || block === B.SHADOW_STONE ? block : B.STONE; if (r > 0.992) { spire = block >= B.COAL_ORE && block <= B.CRYSTAL_ORE ? block : B.CRYSTAL_ORE; spireH = 2 + Math.floor(r * 997 % 6); } }
      else if (theme === 'terra') { top = block === B.CLAY ? B.CLAY : B.GRASS; sub = block === B.CLAY ? B.CLAY : B.DIRT; deep = B.STONE; if (r > 0.975) { spire = B.LEAVES; spireH = 4 + Math.floor(r * 991 % 9); } else if (r < 0.2) spire = -B.TALL_GRASS; else if (r < 0.215) spire = -B.FLOWER_YELLOW; }
      else if (theme === 'areia') { top = sub = block === B.GRAVEL ? B.GRAVEL : B.SAND; deep = B.SANDSTONE; if (r > 0.994) { spire = B.GLASS; spireH = 2 + Math.floor(r * 983 % 4); } }
      else if (theme === 'gelo') { top = B.SNOW; sub = B.ICE; deep = B.ICE; if (r > 0.985) { spire = B.ICE; spireH = 3 + Math.floor(r * 977 % 8); } }
      else if (theme === 'agua') { top = B.SAND; sub = r < 0.3 ? B.CLAY : B.SAND; deep = B.STONE; water = 58; }
      else if (theme === 'madeira') { top = block === B.LOG || block === B.PINE_LOG ? block : (block === B.PINE_PLANKS ? B.PINE_PLANKS : B.PLANKS); sub = top; deep = block === B.PINE_LOG || block === B.PINE_PLANKS ? B.PINE_LOG : B.LOG; }
      else if (theme === 'folha') { top = block === B.CACTUS ? B.CACTUS : B.LEAVES; sub = top === B.CACTUS ? B.CACTUS : (block === B.PINE_LEAVES ? B.PINE_LEAVES : B.LEAVES); deep = B.LOG; water = n2(wx * 0.03, wz * 0.03) > 0.42 ? h + 0 : 0; }
      else { top = sub = KIND[block] === K_CUBE ? block : B.CONCRETE; deep = top; if (r > 0.99) { spire = B.LAMP; spireH = 1 + Math.floor(r * 971 % 4); } }
      vox[i] = B.BEDROCK;
      for (let y = 1; y <= h; y++) {
        let b = y === h ? top : y > h - 4 ? sub : y < 10 ? deep : sub;
        // rocha tem cavernas e veios do próprio minério
        if (theme === 'rocha' && y > 3 && y < h - 2) {
          const c = n3(wx * 0.045, y * 0.06, wz * 0.045);
          if (c > 0.5) b = B.AIR;
          else if (block >= B.COAL_ORE && block <= B.CRYSTAL_ORE && n3(wx * 0.11 + 7, y * 0.11, wz * 0.11) > 0.45) b = block;
        }
        vox[i + (y << 8)] = b;
      }
      let t = h;
      if (water && h < water) { for (let y = h + 1; y <= water; y++) vox[i + (y << 8)] = block === B.MYSTIC_WATER && y === water ? B.WATER : B.WATER; t = water; }
      else if (spire > 0) { for (let k = 1; k <= spireH; k++) vox[i + ((h + k) << 8)] = spire; t = h + spireH; }
      else if (spire < 0 && vox[i + (h << 8)] === B.GRASS) { vox[i + ((h + 1) << 8)] = -spire; t = h + 1; }
      if (t > maxY) maxY = t;
    }
    return emCamadas(vox, maxY);
  }
  return {
    seed, dim: DIM_NANO0, fundo: 0, generate, height: (x, z) => (x < 0 || x >= N || z < 0 || z >= N ? N + 6 : hgt(x, z)), heightRel: () => 0, biomeAt: () => 0,
    climateGrid(x0, z0, n, outT, outM) { outT.fill(theme === 'gelo' ? 0.1 : 0.55); outM.fill(theme === 'areia' ? 0.2 : 0.7); },
    lapse: () => 0,
    findSpawn() { const y = hgt(50, 50); return { x: 50.5, y: (theme === 'agua' ? 59 : y) + 1.05, z: 50.5 }; },
    theme,
  };
}
