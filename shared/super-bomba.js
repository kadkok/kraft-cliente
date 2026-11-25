import { B, LEVEL } from './blocks.js';
import { Y_MIN, Y_TOP, YOFF } from './constants.js';
import { RAIO_GELO } from './fortaleza.js';

export const RAIO = 128, PROFUNDIDADE = 64, PAVIO_MS = 10000;
const RAIO2 = RAIO * RAIO, MAX_CRATERAS = 256;
const vazio = Object.freeze([]);
const removivel = Uint8Array.from({ length: 256 }, (_, id) =>
  id !== B.AIR && id !== B.BEDROCK && id !== B.PORTAL && !LEVEL[id] ? 1 : 0);

export function centroValido(p) {
  return Array.isArray(p) && p.length === 3 && p.every(Number.isSafeInteger) &&
    Math.abs(p[0]) <= 1000000 && Math.abs(p[2]) <= 1000000 && p[1] > Y_MIN && p[1] < Y_TOP;
}

export function alcancaFortaleza(p, centro) {
  return !!centro && p[1] + PROFUNDIDADE >= 40 &&
    Math.hypot(p[0] - centro[0], p[2] - centro[1]) <= RAIO + RAIO_GELO;
}

export function chunksDaCratera([x, , z], visitar) {
  for (let cz = (z - RAIO) >> 4; cz <= (z + RAIO) >> 4; cz++) {
    for (let cx = (x - RAIO) >> 4; cx <= (x + RAIO) >> 4; cx++) {
      const dx = Math.max(cx * 16 - x, x - (cx * 16 + 15), 0);
      const dz = Math.max(cz * 16 - z, z - (cz * 16 + 15), 0);
      if (dx * dx + dz * dz < RAIO2) visitar(cx, cz);
    }
  }
}

// O arquivo guarda só os centros. O índice por pedaço é reconstruído na carga.
export class Crateras {
  constructor(salvas) {
    this.centros = new Map();
    this.chunks = new Map();
    if (Array.isArray(salvas)) for (const p of salvas) this.incluir(p);
  }
  cabe(p) { return centroValido(p) && (this.centros.size < MAX_CRATERAS || this.centros.has(p.join(','))); }
  lista() { return [...this.centros.values()]; }
  noChunk(cx, cz) { return this.chunks.get(cx + ',' + cz) || vazio; }
  incluir(p) {
    if (!this.cabe(p) || this.centros.has(p.join(','))) return false;
    const centro = [...p];
    this.centros.set(p.join(','), centro);
    chunksDaCratera(centro, (cx, cz) => {
      const k = cx + ',' + cz;
      if (!this.chunks.has(k)) this.chunks.set(k, []);
      this.chunks.get(k).push(centro);
    });
    return true;
  }
}

// Interseção do elipsoide com uma coluna. Sem ruído ou sorteio para que colisão,
// desenho, servidor e terreno reaberto sempre concordem na borda.
function meiaAltura(p, x, z) {
  const dx = x - p[0], dz = z - p[2], restante = RAIO2 - dx * dx - dz * dz;
  return restante > 0 ? Math.floor(PROFUNDIDADE * Math.sqrt(restante / RAIO2)) : -1;
}

export function escavarChunk(vox, cx, cz, p, fundo, topo = Y_TOP - 1) {
  let minimo = Y_TOP;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const h = meiaAltura(p, cx * 16 + x, cz * 16 + z);
    if (h < 0) continue;
    const baixo = Math.max(fundo + 1, p[1] - h), alto = Math.min(topo, p[1] + h);
    const coluna = x + (z << 4) + YOFF;
    for (let y = baixo; y <= alto; y++) {
      const i = coluna + (y << 8);
      if (removivel[vox[i]]) { vox[i] = B.AIR; if (y < minimo) minimo = y; }
    }
  }
  return minimo;
}

// Só as edições já existentes são afetadas no instante da detonação. Novos
// blocos construídos dentro de uma cratera têm precedência sobre o terreno.
export function limparEdicoes(p, cx, cz, ed, minis, fundo, aoRemover) {
  if (!ed) return;
  for (const [i, id] of ed) {
    if (!removivel[id]) continue;
    const x = cx * 16 + (i & 15), z = cz * 16 + ((i >> 4) & 15), y = i >> 8;
    if (y <= fundo || Math.abs(y - p[1]) > meiaAltura(p, x, z)) continue;
    ed.set(i, B.AIR);
    minis?.delete(i);
    aoRemover?.(x, y, z);
  }
}
