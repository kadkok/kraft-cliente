// LAVRA — relva viva (prova de realismo, 19/11/2026): o contrato entre a malha e quem desenha as lâminas.
//
// O gramado era só a foto no topo do bloco. Agora o mesher devolve, por pedaço, a lista `lawn` das células cujo topo
// é gramado à mostra, e render/relva.js planta lâminas de grama de verdade em cima (só perto de quem olha).
// Só o desenho muda: a célula continua sendo o bloco de sempre (colisão, quebrar, item e leis iguais).
//
// Lista (Uint16Array, PASSO_RELVA números por célula; coordenadas LOCAIS do pedaço):
//   [ x | z << 4 | marca << 8,  y,  forma,  luz,  temp | umid << 8 ]
//   x, z = 0..15 · y = altura da célula (y do mundo; só de 0 para cima: a lista é sem sinal, e abaixo de 0 — o subsolo
//   da profundidade em dobro, 19/11 — o mesher não põe relva) · forma = a de shared/surfaces.js (CUBE = topo plano em y + 1; rampa = o chão
//   acompanha a rampa) · luz = céu | lâmpada << 4, como no mesher · temp, umid = 0..255, o clima que tinge o gramado
//   marca: bit 0 = há um tronco redondo em cima (a relva fica só nos cantos da célula, em volta dele)
//          bits 1–3 = folhagem empilhada naquela coluna, 0..7 (debaixo da copa a relva rareia)
// O mesher devolve também `canopy` (Uint8Array de 16 × 16, índice x + z × 16): quantas células de folhagem há em cada
// coluna do pedaço (0 = céu aberto). render/real-chao.js junta os pedaços num mapa em volta de quem olha.
import { CUBE, SHAPES } from './surfaces.js';

export const PASSO_RELVA = 5;
export const RELVA_TRONCO = 1;

function dentro(t, x, z) {
  const a = t.v[0], b = t.v[1], c = t.v[2];
  const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
  if (det === 0) return false;
  const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / det;
  const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / det;
  return u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6;
}

// Altura do chão (0..1, contada da base da célula) no ponto (u, v) de uma célula de gramado.
// −1 = naquele ponto o chão não é desta célula (a rampa passa por baixo dela, ou segue na célula de cima).
export function chaoRelva(forma, u, v) {
  if (forma === CUBE) return 1;
  const s = SHAPES[forma];
  if (!s || s.boxes) return -1;
  for (const t of s.top) {
    if (t.cap || !(t.n[1] > 1e-6) || !dentro(t, u, v)) continue;
    const a = t.v[0];
    return a[1] - (t.n[0] * (u - a[0]) + t.n[2] * (v - a[2])) / t.n[1];
  }
  return -1;
}

// Quantas lâminas existem a cada distância de quem olha (1 = todas … 0 = nenhuma). A MESMA conta está no shader
// (render/materials.js → relvaDens): o terreno escurece por baixo das lâminas na medida em que elas existem.
export function densidadeRelva(cheio, fim, d) {
  const t = Math.max(0, Math.min(1, (fim - d) / Math.max(fim - cheio, 0.001)));
  return t * Math.sqrt(t);
}
