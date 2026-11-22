// LAVRA — chuva: as regras que não dependem de desenho (19/11/2026). Puro: serve ao aparelho, aos testes e, adiante, ao
// servidor (ideia do Kadmus, 19/11: "isso é bom, fontes de água doce" — a água que a chuva empoça virar água de beber).
//
// O que o desenho (render/chuva.js e o trecho "Chão molhado" de render/materials.js) precisa saber de cada coluna:
//   · o TOPO: a altura do que apara a chuva (chão, telhado, copa, água), a inclinação dele (rampa) e o tipo;
//   · se o topo é uma BACIA: piso plano sem vizinho mais baixo por onde a água escorra. É onde a poça se forma.
// E a lei do nível das poças no tempo (enchem com chuva firme, seguram na garoa, secam devagar).
import { B, BLOCKS, KIND, K_AIR, K_CROSS, K_LIQUID, LEVEL, IS_STAIR } from './blocks.js';
import { CUBE, SHAPES, shapeHeight, miniShape } from './surfaces.js';

export const TETO_N = 64;                 // lado da janela de colunas em volta de quem olha (1 ponto = 1 m)
export const TIPO = { NADA: 0, CHAO: 1, COPA: 2, AGUA: 3, MACIO: 4 };
// chão que bebe a gota (grama, terra, areia, cascalho, neve): o respingo é só o pingo, quase sem anel
const MACIO = new Set(['grass', 'dirt', 'sand', 'gravel', 'snow']);
export const SEM_TOPO = -1e4;

// Topo da coluna (x, z). leitor = { topSolid(x, z), getBlock(x, y, z), getShape(x, y, z), getMini(x, y, z) } (o mundo
// do aparelho já é assim). Escreve em out: [altura, inclinação em x, inclinação em z, tipo].
export function topoDaColuna(leitor, x, z, out) {
  out[0] = SEM_TOPO; out[1] = 0; out[2] = 0; out[3] = TIPO.NADA;
  let y = leitor.topSolid(x, z), b = 0, k = K_AIR;
  for (; y >= 0; y--) {                      // capim, flor e samambaia não aparam chuva
    b = leitor.getBlock(x, y, z); k = KIND[b];
    if (b > 0 && k !== K_AIR && k !== K_CROSS) break;
  }
  if (y < 0) return out;
  if (k === K_LIQUID) { out[0] = y + (LEVEL[b] >= 8 ? 0.88 : Math.max(0.1, LEVEL[b] * 0.11)); out[3] = TIPO.AGUA; return out; }
  if (b === B.LEAVES || b === B.PINE_LEAVES) { out[0] = y + 1; out[3] = TIPO.COPA; return out; }
  const tipo = MACIO.has(BLOCKS[b]?.sound) ? TIPO.MACIO : TIPO.CHAO;
  let forma = leitor.getShape ? leitor.getShape(x, y, z) : CUBE;
  if (forma === CUBE && !IS_STAIR[b] && leitor.getMini) { const m = leitor.getMini(x, y, z); if (m) forma = miniShape(m); }
  out[3] = tipo;
  if (forma === CUBE || !SHAPES[forma]) { out[0] = y + 1; return out; }
  const h = shapeHeight(forma, 0.5, 0.5);
  out[0] = y + (h > 0 ? h : 1);
  if (h > 0) {                               // rampa: o plano da face, para o respingo deitar nela
    out[1] = (shapeHeight(forma, 0.75, 0.5) - shapeHeight(forma, 0.25, 0.5)) * 2;
    out[2] = (shapeHeight(forma, 0.5, 0.75) - shapeHeight(forma, 0.5, 0.25)) * 2;
  }
  return out;
}

// Posição de uma coluna do mundo na janela dobrada (a janela anda com quem olha sem copiar nada).
export const indiceNaJanela = (x, z, n = TETO_N) => ((x % n) + n) % n + (((z % n) + n) % n) * n;

// Bacias da janela que começa em (x0, z0). dados = 4 números por coluna (os de topoDaColuna), na ordem de
// indiceNaJanela. saida[i] = 255 onde a água fica, 0 onde escorre ou não é piso. A borda da janela nunca é bacia (o
// vizinho dela, na janela dobrada, é de outro lugar).
export function bacias(dados, x0, z0, saida, n = TETO_N) {
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = x0 + i, z = z0 + j, c = indiceNaJanela(x, z, n), o = c * 4, t = dados[o + 3];
    let v = 0;
    if ((t === TIPO.CHAO || t === TIPO.MACIO) && dados[o + 1] === 0 && dados[o + 2] === 0 && i > 0 && j > 0 && i < n - 1 && j < n - 1) {
      const h = dados[o];
      v = 255;
      for (let k = 0; k < 4; k++) {
        const q = indiceNaJanela(x + (k === 0 ? 1 : k === 1 ? -1 : 0), z + (k === 2 ? 1 : k === 3 ? -1 : 0), n) * 4;
        if (dados[q + 3] !== TIPO.NADA && dados[q] < h - 0.02) { v = 0; break; }      // tem por onde escorrer
      }
    }
    saida[c] = v;
  }
  return saida;
}

// Nível das poças (0 = secas … 1 = cheias) depois de dt segundos com `chove` (0…1, o game.weather.rain).
// Chuva firme enche em ~40 s; garoa segura o que há; sem chuva secam em ~3 min.
export const POCA_ENCHE = 40, POCA_SECA = 180;
export function nivelDasPocas(nivel, chove, dt) {
  const d = chove > 0.3 ? chove / POCA_ENCHE : chove > 0.05 ? 0 : -1 / POCA_SECA;
  return Math.max(0, Math.min(1, nivel + d * dt));
}

// Quanto da caixa de gotas existe com este tanto de chuva: a garoa já mostra gota, a tempestade enche a caixa.
export const gotasPara = (chove) => (chove > 0.02 ? Math.min(1, 0.12 + 0.88 * Math.pow(Math.min(1, chove), 0.85)) : 0);
