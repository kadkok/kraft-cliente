// Kraft (LAVRA) — a grama cresce sozinha sobre a terra (pedido do Kadmus, 19/11/2026: "quero que a grama sempre possa
// crescer na terra"; toda terra, inclusive estrada e caminho de terra feitos por quem joga).
//
// Lei, como os "random ticks" do Minecraft: perto de quem joga, colunas sorteadas; o primeiro bloco que barra a luz,
// de cima para baixo, é o chão daquela coluna. Se ele for Terra (B.DIRT) — portanto com céu por cima: ar, planta
// rasteira, folhagem, vidro… nada opaco e nada de água ou gelo —, ela vira Gramado:
//   (a) espalhando: algum dos 8 vizinhos, de 1 abaixo a 1 acima, é Gramado → em `espalha` segundos em média;
//   (b) sozinha: a céu aberto sem Gramado encostado → bem mais devagar, em `sozinha` segundos em média.
// Terra debaixo de bloco opaco (telhado, laje, pedra) ou d'água nunca fica verde; terra em túnel e caverna também não.
// Terra moldada (estado 64, shared/minis.js) continua moldada: Gramado está em MOLDE_OK. Mini-bloco de terra fica.
// Puro: sem rede, sem relógio; o servidor (server/grama.js) sorteia e escreve.
import { B, OPAQUE, LEVEL } from './blocks.js';
import { Y_TOP } from './constants.js';
import { MOLDE } from './minis.js';
import { hash32 } from './nature.js';

const env = (k, d) => { const v = Number(globalThis.process?.env?.[k]); return Number.isFinite(v) && v > 0 ? v : d; };

export const GRAMA = Object.freeze({
  ligada: globalThis.process?.env?.LAVRA_GRAMA !== '0',
  espalha: env('LAVRA_GRAMA_ESPALHA_MIN', 3) * 60,     // terra encostada em gramado → gramado (média)
  sozinha: env('LAVRA_GRAMA_SOZINHA_MIN', 45) * 60,    // terra a céu aberto sem gramado por perto → gramado (média)
  raio: Math.min(96, env('LAVRA_GRAMA_RAIO', 48)),     // quadrado em volta de cada pessoa (lado 2·raio + 1)
  amostras: Math.min(2000, env('LAVRA_GRAMA_AMOSTRAS', 64)),   // colunas sorteadas por segundo por pessoa
  passo: 0.5,                                          // segundos entre uma leva de sorteios e outra
});

// O bloco deixa a luz e a chuva chegarem ao chão? (ar, planta, folhagem, vidro: sim; opaco, água e gelo: não)
export const deixaPassar = (id) => id === B.AIR || (!OPAQUE[id] && !LEVEL[id] && id !== B.ICE);

// Chão de luz da coluna: o primeiro bloco, de cima para baixo, que não deixa passar. Devolve y se for Terra
// (candidata a virar gramado), senão -1. `de` = de onde começar a descer.
export function terraAoCeu(get, x, z, de = Y_TOP - 1) {
  for (let y = de; y >= 1; y--) {
    const id = get(x, y, z);
    if (deixaPassar(id)) continue;
    return id === B.DIRT ? y : -1;
  }
  return -1;
}

// Algum dos 8 vizinhos, de 1 abaixo a 1 acima, é Gramado?
export function gramaEncostada(get, x, y, z) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (get(x + dx, y + dy, z + dz) === B.GRASS) return true;
      }
    }
  }
  return false;
}

// Estado que a célula leva ao virar gramado, ou -1 se ela não pode virar (mini-bloco, escada, bloco MC: fica como está).
export const estadoAoVirar = (st) => (!st ? 0 : st === MOLDE ? MOLDE : -1);

// Chance de virar em UMA amostra, para que a média dê `media` segundos quando cada coluna é sorteada a cada
// `intervalo` segundos. Mais rápido que o sorteio não dá: o teto é 1.
export const chancePorAmostra = (intervalo, media) => (media > 0 ? Math.min(1, intervalo / media) : 1);

// Chance de virar dentro de `dur` segundos (para adiantar o relógio em rodadas): 1 − e^(−dur/média).
export const chanceNoTempo = (dur, media) => (media > 0 ? 1 - Math.exp(-dur / media) : 1);

// Sorteio fixo pela semente do mundo, pela leva e pela posição: mesma entrada, mesmo resultado.
export const sorteio = (seed, n, x, z) => hash32(hash32(seed, n, 0x6a7a), x, z) / 4294967296;
