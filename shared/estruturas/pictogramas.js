// Kraft — pictogramas das ruínas e das cavernas (pedido do Kadmus, 19/11/2026: "pictogramas em ruínas"). Puro.
//
// O pictograma é um DADO: onde está (painel numa parede), para onde olha, qual motivo e qual lenda. O que se vê hoje é
// um MOSAICO PROVISÓRIO feito só com blocos e mini-blocos que já existem: o desenho é cavado na pedra, meio metro de
// "pixel" (quartos de mini-bloco, shared/minis.js) com 1 m de fundo, e o fundo do sulco é de outro material (basalto
// escuro nas ruínas, ocre — Reboco vermelho — nas cavernas). Quem desenha de verdade é o Astra (o Claude não desenha).
//
// ── CONTRATO PARA O ASTRA ─────────────────────────────────────────────────────────────────────────────────────────
// De onde vem: o servidor manda a lista no `welcome` e no `dim` do plano 0 (campo `pictos`) e, quando muda (GM pôs ou
// desfez uma estrutura), a mensagem { t: 'pictos', l: [...] } com a lista inteira. Cada item:
//   { id, motivo, nome, lenda, x, y, z, n: [nx, 0, nz], dir: [rx, 0, rz], larg, alt, px: ['..#..', ...], fundo, traco,
//     estrutura: id da estrutura }
//   · (x, y, z) = célula de baixo à esquerda (para quem olha de frente) da camada da frente do painel.
//   · n = normal da parede, apontando para quem olha. dir = "direita" de quem olha (cima × n). O painel ocupa
//     larg × alt células: x + dir·i, y + j (i em [0, larg), j em [0, alt)).
//   · A face visível de cada célula da frente é o plano (centro da célula + n × 0,5). Retângulo do painel no mundo:
//     cantos (x, y, z) + 0,5 + n × 0,5 ± dir × 0,5 … até larg × alt metros. É ali que vai o desenho (decalque ou
//     textura própria), com um afastamento mínimo da face para não brigar com ela.
//   · px = o motivo em pixels de 0,5 m (linhas de cima para baixo, '#' = traço), centrado no painel. É só o rascunho
//     do motivo: o Astra desenha no estilo dele (gravado na pedra nas ruínas; pintura rupestre em ocre nas cavernas).
//   · fundo/traco = ids dos blocos do mosaico provisório. Quando o desenho próprio existir, o mosaico pode virar parede
//     lisa (fundo inteiro) — pedir ao Claude (server/estruturas.js) para trocar.
//   · lenda = texto curto (pt-BR) para aparecer ao mirar o painel (dica no estilo de game.hint) ou num livro de
//     achados. Mirar: o painel é o retângulo acima; a dica pode usar `nome` como título.
//
// Motivos: cada um com nome, lenda e o rascunho em pixels (12 × 8 = um painel de 6 × 4 blocos).

import { B } from '../blocks.js';
import { miniState, AXIS_X, AXIS_Z } from '../minis.js';

export const MOTIVOS = Object.freeze({
  serpente: {
    nome: 'A serpente de pedra',
    lenda: 'A serpente de pedra dorme debaixo do rio. Quando ela se vira, a terra treme e as portas se abrem.',
    px: [
      '............',
      '.........##.',
      '........#..#',
      '..##...#....',
      '.#..#.#.....',
      '#....#......',
      '............',
      '............',
    ],
  },
  estrelas: {
    nome: 'O céu dos primeiros',
    lenda: 'Os primeiros contavam as estrelas para saber quando a água baixava. A de quatro pontas mostra o caminho.',
    px: [
      '#........#..',
      '....#.......',
      '.......#...#',
      '.#....###...',
      '.......#....',
      '...#......#.',
      '#...........',
      '......#....#',
    ],
  },
  cacada: {
    nome: 'A caçada do cervo branco',
    lenda: 'Antes das aldeias, um caçador seguiu o cervo branco até o fundo da mata e nunca voltou. A lança ficou lá.',
    px: [
      '............',
      '.#.......#.#',
      '#######...#.',
      '.#........##',
      '.#.....####.',
      '#.#....#.#..',
      '............',
      '............',
    ],
  },
  maos: {
    nome: 'As mãos na pedra',
    lenda: 'Estiveram aqui. Deixaram as mãos na pedra para que ninguém esquecesse.',
    px: [
      '.#.#........',
      '####...#.#.#',
      '####..######',
      '.####.####..',
      '.###...###..',
      '.......##...',
      '............',
      '............',
    ],
  },
  mapa: {
    nome: 'O mapa da cruz',
    lenda: 'Onde a montanha olha para o rio, cava-se debaixo da cruz.',
    px: [
      '..#.........',
      '.#.#....#.#.',
      '#...#....#..',
      '........#.#.',
      '##..........',
      '..##..##....',
      '....##..##..',
      '..........##',
    ],
  },
  porta_agua: {
    nome: 'A porta atrás da água',
    lenda: 'Atrás da água que cai há uma porta. Quem passa sem medo encontra o salão dos cristais.',
    px: [
      '.#........#.',
      '....####....',
      '.#.#.#..#.#.',
      '...#..#.#...',
      '.#.#.#..#.#.',
      '...#..#.#...',
      '.#.#.#..#.#.',
      '####....####',
    ],
  },
  espiral: {
    nome: 'O caminho de dentro',
    lenda: 'O caminho para dentro é o mesmo que o caminho para fora. Desça, e volte.',
    px: [
      '.#########..',
      '#.........#.',
      '#.#####...#.',
      '#.#...#...#.',
      '#.#.###...#.',
      '#.#.......#.',
      '#.#########.',
      '............',
    ],
  },
  arvore: {
    nome: 'A árvore primeira',
    lenda: 'A primeira árvore tinha raízes até o fundo do mundo. Delas fizeram um machado que prende quem ele fere.',
    px: [
      '...#.##.#...',
      '..#.#..#.#..',
      '...##..##...',
      '.....##.....',
      '.....##.....',
      '############',
      '...#.##.#...',
      '..#..#.#..#.',
    ],
  },
  luas: {
    nome: 'As três luas',
    lenda: 'Três luas de caminhada. Na lua cheia, o lago debaixo da terra brilha.',
    px: [
      '............',
      '.##..##...##',
      '##..#..#...#',
      '#...#..#...#',
      '##..#..#...#',
      '.##..##...##',
      '............',
      '............',
    ],
  },
});
export const LISTA_MOTIVOS = Object.freeze(Object.keys(MOTIVOS));

// Direita de quem olha a parede de frente: cima × n (ex.: parede virada para +X → quem olha está a leste, olhando
// para oeste, e a direita dele é o norte, −Z).
export const direitaDe = (n) => [n[2], 0, -n[0]];

// Monta o painel na planta P (shared/estruturas.js → criarPlanta). (x, y, z) = célula de baixo à esquerda da camada da
// frente; n = normal da parede (horizontal) para quem olha; larg × alt em blocos. A camada da frente vira `fundo` (com
// os quartos do desenho cavados), a de trás vira `traco`, e a célula em frente a cada uma fica vazia (o painel aparece).
// Devolve o dado do pictograma (sem id: quem grava dá o id).
export function montarPainel(P, { x, y, z, n, larg = 6, alt = 4, motivo, fundo = B.SANDSTONE, traco = B.BASALT, abrir = 1, moldura = null }) {
  const M = MOTIVOS[motivo];
  if (!M) throw new Error('motivo desconhecido: ' + motivo);
  const r = direitaDe(n);
  const W = larg * 2, H = alt * 2, bh = M.px.length, bw = M.px[0].length;
  const ox = Math.floor((W - bw) / 2), oy = Math.floor((H - bh) / 2);
  const pixel = (pi, pj) => {                       // pi da esquerda, pj de baixo
    const bx = pi - ox, by = bh - 1 - (pj - oy);
    return bx >= 0 && bx < bw && by >= 0 && by < bh && M.px[by][bx] === '#';
  };
  const eixo = n[0] ? AXIS_X : AXIS_Z;
  const rr = n[0] ? r[2] : r[0];                    // +1 ou −1: para que lado a "direita" anda no eixo do quarto
  for (let i = 0; i < larg; i++) for (let j = 0; j < alt; j++) {
    const cx = x + r[0] * i, cy = y + j, cz = z + r[2] * i;
    let mask = 0;
    for (let si = 0; si < 2; si++) for (let sj = 0; sj < 2; sj++) {
      if (pixel(i * 2 + si, j * 2 + sj)) continue;  // traço: quarto cavado
      const lado = rr > 0 ? si : 1 - si;
      const q = eixo === AXIS_X ? sj + 2 * lado : lado + 2 * sj;   // eixo X: (a = y, b = z) · eixo Z: (a = x, b = y)
      mask |= 1 << q;
    }
    if (mask === 15) P.por(cx, cy, cz, fundo, 0);
    else if (mask === 0) P.ar(cx, cy, cz);
    else P.por(cx, cy, cz, fundo, miniState(eixo, mask));
    P.por(cx - n[0], cy, cz - n[2], traco, 0);
    // a frente fica livre até o vão (numa parede curva de caverna, cava até achar o ar, no máximo `abrir` células)
    for (let k = 1; k <= abrir; k++) {
      const fx = cx + n[0] * k, fz = cz + n[2] * k;
      if (!P.cheio(fx, cy, fz)) break;
      P.cavar(fx, cy, fz);
    }
  }
  // moldura: em volta do painel, nas duas camadas, o que estiver vazio vira parede (o painel fica embutido, não solto)
  if (moldura !== null) {
    for (let i = -1; i <= larg; i++) for (let j = -1; j <= alt; j++) {
      if (i >= 0 && i < larg && j >= 0 && j < alt) continue;
      const cx = x + r[0] * i, cy = y + j, cz = z + r[2] * i;
      for (const k of [0, -1]) { const qx = cx + n[0] * k, qz = cz + n[2] * k; if (!P.cheio(qx, cy, qz)) P.por(qx, cy, qz, moldura, 0); }
    }
  }
  return { motivo, nome: M.nome, lenda: M.lenda, x, y, z, n: [n[0], 0, n[2]], dir: r, larg, alt, px: M.px.slice(), fundo, traco };
}
