// LAVRA — o machado: regras puras (cliente e testes). Pedido do Kadmus, 19/11/2026, com a referência
// screen.toys/firewood: "falta o machado… para poder cortar árvores e modelar blocos de madeira".
//
// O machado não quebra na hora: cada clique é um GOLPE com tempo (ergue, desce, bate, volta) e o efeito acontece no
// instante em que a lâmina chega na madeira.
//   - Árvore em pé ou caída (tronco, galho): alguns golpes no mesmo lugar e ela é cortada ali (o corte de sempre do
//     jogo: nature/trees.js → cut). Quanto mais grosso, mais golpes.
//   - Bloco de madeira posto por alguém (tronco, tábuas): cada golpe tira o QUARTO mirado. É o mini-bloco que o jogo já
//     tem (shared/minis.js), então nada muda no mundo gravado nem no servidor: bater por cima racha em quatro
//     moirões em pé (lenha); bater de lado tira ripas deitadas. É assim que se modela madeira.
// Fora da madeira o machado não manda: o clique faz o que sempre fez.
import { B } from './blocks.js';
import { MINI_OK, miniState, miniAxis, miniMask, isMiniState, axisFromNormal, quarterAt, quarterBox, withQuarter } from './minis.js';

// o que o machado lasca (blocos postos; a árvore natural é tratada como árvore, não como bloco)
export const MADEIRA = new Uint8Array(256);
for (const id of [B.LOG, B.PINE_LOG, B.PLANKS, B.PINE_PLANKS]) if (id !== undefined && MINI_OK[id]) MADEIRA[id] = 1;

// tempos do golpe, em segundos de verdade
export const GOLPE = { prepara: 0.2, desce: 0.09, volta: 0.36 };
export const GOLPE_IMPACTO = GOLPE.prepara + GOLPE.desce;
export const GOLPE_TOTAL = GOLPE_IMPACTO + GOLPE.volta;

// em que ponto do golpe se está: { fase: 'prepara' | 'desce' | 'volta' | 'fim', k: 0..1 dentro da fase }
export function faseDoGolpe(t) {
  if (!(t >= 0)) return { fase: 'prepara', k: 0 };
  if (t < GOLPE.prepara) return { fase: 'prepara', k: t / GOLPE.prepara };
  if (t < GOLPE_IMPACTO) return { fase: 'desce', k: (t - GOLPE.prepara) / GOLPE.desce };
  if (t < GOLPE_TOTAL) return { fase: 'volta', k: (t - GOLPE_IMPACTO) / GOLPE.volta };
  return { fase: 'fim', k: 1 };
}

// quantos golpes para cortar um tronco ou galho desse raio (m): galho fino 2, tronco comum 5 ou 6, o mais grosso 8
export function golpesParaCortar(raio) {
  const r = Number.isFinite(raio) && raio > 0 ? raio : 0.3;
  return Math.max(2, Math.min(8, Math.round(2 + r * 9)));
}

// Um golpe num bloco de madeira: tira o quarto mirado.
// id, mini = o bloco e o estado dele hoje · (nx, ny, nz) = face atingida · (fx, fy, fz) = ponto atingido, 0..1 no espaço.
// Devolve { id, mini, eixo, q, caixa } com o bloco e o estado DEPOIS do golpe (id 0 = não sobrou nada) e a caixa do
// quarto que saiu, ou null se ali não há o que lascar.
export function lascar(id, mini, nx, ny, nz, fx, fy, fz) {
  if (!MADEIRA[id]) return null;
  let eixo, estado;
  if (isMiniState(mini)) { eixo = miniAxis(mini); estado = mini; }
  else { eixo = axisFromNormal(nx, ny, nz); estado = miniState(eixo, 15); }    // bloco inteiro: o veio nasce da face batida
  const dentro = (v, n) => Math.max(0, Math.min(0.999, (Number.isFinite(v) ? v : 0.5) - n * 0.01));   // um fio para dentro da face
  const q = quarterAt(eixo, dentro(fx, nx), dentro(fy, ny), dentro(fz, nz));
  if (!(miniMask(estado) & (1 << q))) return null;
  const depois = withQuarter(estado, eixo, q, false);
  return { id: depois ? id : B.AIR, mini: depois, eixo, q, caixa: quarterBox(eixo, q) };
}
