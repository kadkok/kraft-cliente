// Kraft — baú enterrado e câmara do tesouro (pedido do Kadmus, 19/11/2026). Puro e determinístico.
//
// Onde nasce: em chão firme e quase plano (sem mar, praia nem árvore a menos de 3 m do marco), em qualquer bioma.
// Duas variantes (a natural sai da semente: 3 em 4 rasas; das fundas, 1 em 8 é lendária):
//   · rasa — o baú enterrado: um buraco forrado de pedra, 3 a 5 m debaixo do chão, com tábuas no fundo e o baú (nível
//     pela fundura: raso). Em cima, quase sempre um sinal: um marco de pedras empilhadas ou um círculo de flores
//     brancas. Nada de entrada: quem achar o sinal cava.
//   · funda — a câmara do tesouro: uma sala de pedra talhada de 6 × 4 × 6 bem fundo no subsolo novo (de −22 a −56,
//     longe dos rios), piso de mármore com cruz de basalto, uma pedra que brilha no teto com lascas de cristal, dois
//     pictogramas nas paredes e o baú num pedestal (muito fundo; 1 em 8 lendário). Em cima, às vezes, um menir.
import { B, LEVEL } from '../blocks.js';
import { BIOME } from '../worldgen.js';
import { nivelPorProfundidade } from '../tesouros.js';
import { criarPlanta, rng, sorte, estabilizar, sementeDoSitio, planta_, olhoLivre, ESSENCIAL, MOLDE, TRES_QUARTOS, POSTE, SEA, Y_TOP } from '../estruturas.js';
import { montarPainel } from './pictogramas.js';

const FORA = new Set([BIOME.OCEAN, BIOME.BEACH]);
const VARIANTES = ['rasa', 'funda', 'lendaria'];

export function podeNascer(ctx, x, z, variante) {
  if (FORA.has(ctx.bioma(x, z))) return null;
  const H = ctx.height, h = H(x, z);
  if (h < SEA + 3 || h + 6 >= Y_TOP) return null;
  for (const [ex, ez] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) if (Math.abs(H(x + ex, z + ez) - h) > 1) return null;
  for (const t of ctx.arvores(x - 6, z - 6, x + 6, z + 6)) if ((t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < 12) return null;
  const sem = sementeDoSitio(ctx, 'camara', x, z);
  let v = VARIANTES.includes(variante) ? variante : sem % 4 === 0 ? ((sem >>> 4) % 8 === 0 ? 'lendaria' : 'funda') : 'rasa';
  let y;
  if (v === 'rasa') y = h - 4 - (sem >>> 9) % 3;
  else {
    y = -22 - ((sem >>> 12) % 34);
    if (y < ctx.yMin + 6) y = ctx.yMin + 6;
    // longe de água natural (rios subterrâneos): nenhuma água na caixa da sala com 4 de folga
    for (let ex = -8; ex <= 7; ex += 1) for (let ez = -8; ez <= 7; ez += 1) for (let ey = -5; ey <= 9; ey += 2) {
      if (LEVEL[ctx.natural(x + ex, y + ey, z + ez)]) return null;
    }
  }
  return { tipo: 'camara', x, y, z, rot: sem & 3, sup: h, variante: v, nota: 0, semente: sem };
}

export function gerar(ctx, s) {
  const S = s.semente & 0x7fffffff, r = rng(s.semente), h = s.sup;
  const funda = s.variante !== 'rasa';
  const P = criarPlanta(ctx, { tipo: 'camara', ancora: [s.x, s.y, s.z], rot: s.rot, semente: s.semente, nome: funda ? 'Câmara do tesouro' : 'Baú enterrado' });
  if (!funda) P.posta = 'posto';
  const L = P.L, [ox, oz] = P.eixoV, [ax, az] = P.eixoU;
  const por = (u, y, v, b, m = 0, f = 0) => { const [x, , z] = L(u, y, v); P.por(x, y, z, b, m, f); };
  const ar = (u, y, v, f = 0) => { const [x, , z] = L(u, y, v); P.ar(x, y, z, f); };
  const c = (q) => [q[0] + 0.5, q[1], q[2] + 0.5];
  const sinal = sorte(S, 1);

  if (!funda) {
    // buraco forrado de pedra: miolo 2 × 2 × 2, tábuas no fundo, o baú num canto
    const yi = s.y;
    for (let u = -1; u <= 2; u++) for (let v = -1; v <= 2; v++) for (let y = yi - 1; y <= yi + 2; y++) {
      const dentro = u >= 0 && u <= 1 && v >= 0 && v <= 1 && y >= yi && y <= yi + 1;
      if (dentro) ar(u, y, v, ESSENCIAL);
      else if (y === yi - 1) por(u, y, v, u >= 0 && u <= 1 && v >= 0 && v <= 1 ? B.PLANKS : B.STONE, 0, ESSENCIAL);
      else por(u, y, v, sorte(S, u, v, y) < 0.3 ? B.GRAVEL : B.STONE, 0, ESSENCIAL);
    }
    const [bx, , bz] = L(0, 0, 0);
    P.baus.push({ x: bx, y: yi, z: bz, nivel: nivelPorProfundidade(h - yi), i: 0 });
    // o sinal em cima
    if (sinal < 0.6) {                                          // marco de pedras empilhadas
      por(0, h + 1, 0, B.STONE, 0); por(0, h + 2, 0, B.STONE, TRES_QUARTOS(S)); por(0, h + 3, 0, B.STONE, POSTE(S >> 2));
      por(1, h + 1, 0, B.STONE, TRES_QUARTOS(S >> 4)); if (sorte(S, 2) < 0.5) por(0, h + 1, 1, B.STONE, POSTE(S >> 6));
      for (const [u, v] of [[0, 0], [1, 0], [0, 1]]) { const [x, , z] = L(u, 0, v); if (planta_(P.ler(x, h + 1, z))) P.ar(x, h + 1, z); }
    } else if (sinal < 0.85) {                                  // círculo de flores brancas
      for (const [u, v] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 2], [2, 1], [-1, -2], [-2, -1], [1, -2], [-2, 1], [2, -1], [-1, 2]]) {
        const [x, , z] = L(u, 0, v), y = ctx.height(x, z);
        if (y === h && (P.ler(x, y + 1, z) === B.AIR || planta_(P.ler(x, y + 1, z))) && P.ler(x, y, z) === B.GRASS) P.por(x, y + 1, z, B.FLOWER_WHITE);
      }
    }
    P.entrada = L(0, h + 1, 3);
    P.vista = { de: c(L(6, h + 3.5, 8)), para: c(L(0, h + 1, 0)) };
    P.vistas = { fora: { de: olhoLivre(P, P.vista.de), para: P.vista.para }, dentro: { de: c(L(1, yi + 0.6, 1)), para: c(L(0, yi, 0)) } };
    estabilizar(P);
    return P;
  }

  // câmara funda: miolo de 6 × 4 × 6 (u −3..2, v −3..2, y yc..yc+3), paredes de pedra talhada
  const yc = s.y;
  for (let u = -4; u <= 3; u++) for (let v = -4; v <= 3; v++) for (let y = yc - 1; y <= yc + 4; y++) {
    const dentro = u >= -3 && u <= 2 && v >= -3 && v <= 2 && y >= yc && y <= yc + 3;
    if (dentro) { ar(u, y, v, ESSENCIAL); continue; }
    if (y === yc - 1) {
      const cruz = (u === -1 || u === 0 || v === -1 || v === 0) && u >= -3 && u <= 2 && v >= -3 && v <= 2;
      por(u, y, v, cruz ? B.BASALT : B.MARBLE, 0, ESSENCIAL);
    } else por(u, y, v, (u === -4 || u === 3) && (v === -4 || v === 3) ? B.MARBLE : B.STONE_BRICKS, 0, ESSENCIAL);
  }
  // luz: a pedra que brilha no meio do teto, com lascas de cristal penduradas
  por(-1, yc + 4, -1, B.CRYSTAL_ORE, 0, ESSENCIAL);
  for (const [u, v, q] of [[-1, -1, 0], [0, -1, 1], [-1, 0, 2], [0, 0, 3]]) {
    if (u === 0 && v === 0) por(u, yc + 4, v, B.CRYSTAL_ORE, 0, ESSENCIAL);
    por(u, yc + 3, v, B.PHANTOM_CRYSTAL, POSTE(q));
  }
  // pictogramas: no fundo (−v) e na esquerda (−u), de frente para quem cava pela frente
  const n = [ox, 0, oz], motivos = ['mapa', 'luas', 'serpente', 'arvore', 'estrelas'];
  const m1 = motivos[Math.floor(r() * motivos.length)], m2 = motivos.filter((m) => m !== m1)[Math.floor(r() * (motivos.length - 1))];
  const [fx, , fz] = L(2, 0, -4);
  P.pictos.push(montarPainel(P, { x: fx, y: yc, z: fz, n, larg: 6, alt: 4, motivo: m1, fundo: B.SANDSTONE, traco: B.BASALT, abrir: 0 }));
  const [ex, , ez] = L(-4, 0, -3);
  P.pictos.push(montarPainel(P, { x: ex, y: yc, z: ez, n: [ax, 0, az], larg: 6, alt: 4, motivo: m2, fundo: B.SANDSTONE, traco: B.BASALT, abrir: 0 }));
  // pedestal e baú
  por(-1, yc, -1, B.MARBLE, 0, ESSENCIAL);
  const [bx, , bz] = L(-1, 0, -1);
  const fundura = h - yc;
  P.baus.push({ x: bx, y: yc + 1, z: bz, nivel: s.variante === 'lendaria' ? 'lendario' : 'muito_fundo', i: 0 });
  P.notas.push(`sala a ${fundura} m de fundura`);
  // menir em cima (às vezes): a pedra em pé que marca o lugar
  if (sinal < 0.7) {
    const [x, , z] = L(0, 0, 0);
    if (planta_(P.ler(x, h + 1, z))) P.ar(x, h + 1, z);
    P.por(x, h + 1, z, B.STONE, 0); P.por(x, h + 2, z, B.STONE, 0); P.por(x, h + 3, z, B.STONE, TRES_QUARTOS(S));
    const [x2, , z2] = L(1, 0, 0);
    if (P.ler(x2, h + 1, z2) === B.AIR || planta_(P.ler(x2, h + 1, z2))) P.por(x2, h + 1, z2, B.STONE, TRES_QUARTOS(S >> 3));
  }
  P.entrada = L(0, h + 1, 3);
  P.vista = { de: c(L(4, h + 3, 7)), para: c(L(0, h + 2, 0)) };
  P.vistas = { fora: { de: olhoLivre(P, P.vista.de), para: P.vista.para }, dentro: { de: c(L(1.4, yc + 1.6, 2.2)), para: c(L(-2, yc + 1.4, -3.5)) } };
  estabilizar(P);
  return P;
}

export const CAMARA = Object.freeze({
  chave: 'camara', nome: 'Baú enterrado / câmara do tesouro', sal: 71, variantes: VARIANTES,
  descricao: 'rasa: buraco forrado de pedra com o baú, 3 a 5 m debaixo de um marco de pedras ou de um círculo de flores; funda: sala de pedra talhada bem fundo no subsolo, com pictogramas, pedra que brilha e o baú muito fundo (às vezes lendário)',
  celula: 384, chance: 0.3, busca: 32, passo: 4, melhorDe: 1, raio: 8,
  raridade: 'umas 2 por km² (3 em 4 rasas); câmara funda ~1 a cada 2 km²; câmara lendária ~1 a cada 16 km²',
  podeNascer, gerar,
});
