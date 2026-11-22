// Blocos da obra já construída. A posição é enviada no snapshot. A planta fica no cliente.
import { PALACIO, GELEIRA } from './fortaleza-obra.js';
import { B } from './blocks.js';
import { SEA, Y_MIN } from './constants.js';
import { RAIO_BANQUISA, BANQUISA } from './fortaleza-banquisa.js';

export const ORIGEM_FORTALEZA = Object.freeze([-235, -430]);
export const ALTO_MAR = Object.freeze([10500, -10500]);
export const RAIO_GELO = 50;
// Mudança de lugar por inteiro (pedido do Kadmus, 22/11/2026: "a ilha não foi movida na íntegra, ficou uma parte de
// gelo pra trás, com um corte reto"). Antes só um círculo de 50 m do mar congelado saía da origem antiga e a banquisa
// natural em volta ficava, recortada. Agora, no mundo que mudou a fortaleza de lugar (origemAntiga): na origem antiga
// todo gelo do nível do mar a até RAIO_LIMPEZA vira mar (o anel de 290 a 339 m não tem gelo nenhum: o corte não
// aparece), e a mesma banquisa (fortaleza-banquisa.js, o molde tirado do gerador) aparece em volta do centro novo,
// na mesma posição em relação ao palácio, só onde ali é mar.
export const RAIO_LIMPEZA = 315;
let banquisa;
function lerBanquisa() {
  if (banquisa) return banquisa;
  const bin = atob(BANQUISA), linhas = new Map();
  for (let i = 0; i + 5 < bin.length; i += 6) {
    const u = (k) => bin.charCodeAt(i + k) | (bin.charCodeAt(i + k + 1) << 8);
    const dz = u(0) - RAIO_BANQUISA, dx0 = u(2) - RAIO_BANQUISA, n = u(4);
    let l = linhas.get(dz);
    if (!l) { l = []; linhas.set(dz, l); }
    l.push(dx0, n);
  }
  banquisa = linhas;
  return banquisa;
}
let planta;
function lerPlanta() {
  if (planta) return planta;
  const colunas = new Map(),
    antigos = [];
  for (const [texto, obra] of [
    [GELEIRA, false],
    [PALACIO, true],
  ]) {
    const bytes = atob(texto);
    for (let i = 0; i < bytes.length; i += 5) {
      const x = bytes.charCodeAt(i) - RAIO_GELO,
        z = bytes.charCodeAt(i + 1) - RAIO_GELO;
      const y = bytes.charCodeAt(i + 2),
        fim = y + bytes.charCodeAt(i + 3),
        id = bytes.charCodeAt(i + 4);
      const k = (x + RAIO_GELO) * 101 + z + RAIO_GELO;
      let c = colunas.get(k);
      if (!c) {
        c = [];
        colunas.set(k, c);
      }
      c.push([y, fim, id]);
      if (obra) antigos.push([x, z, y, fim, id]);
    }
  }
  planta = { colunas, antigos };
  return planta;
}
// o molde inteiro como imagem (lado 2·RAIO_BANQUISA + 1, 1 = gelo), para a superfície do mar não cobrir a banquisa
export function mascaraBanquisa() {
  const N = 2 * RAIO_BANQUISA + 1, dados = new Uint8Array(N * N);
  for (const [dz, l] of lerBanquisa()) for (let k = 0; k < l.length; k += 2) dados.fill(255, (dz + RAIO_BANQUISA) * N + l[k] + RAIO_BANQUISA, (dz + RAIO_BANQUISA) * N + l[k] + RAIO_BANQUISA + l[k + 1]);
  return { raio: RAIO_BANQUISA, lado: N, dados };
}
export function edicoesDoPalacio() {
  return lerPlanta().antigos;
}
export function centroValido(c) {
  return (
    Array.isArray(c) &&
    c.length === 2 &&
    c.every((v) => Number.isInteger(v) && Math.abs(v) <= 1000000 - RAIO_GELO - 2)
  );
}
export function naGeleira(c, x, z) {
  return !!c && (x - c[0]) ** 2 + (z - c[1]) ** 2 <= RAIO_GELO ** 2;
}
const coluna = (dx, dz) => lerPlanta().colunas.get((dx + RAIO_GELO) * 101 + dz + RAIO_GELO);
export function blocoDaFortaleza(c, x, y, z) {
  if (!naGeleira(c, x, z) || y < 40 || y > 125) return 0;
  const partes = coluna(x - c[0], z - c[1]);
  if (partes)
    for (let i = partes.length - 1; i >= 0; i--) {
      const [de, ate, id] = partes[i];
      if (y >= de && y < ate) return id;
    }
  return 0;
}
export function dentroDoPalacio(c, p) {
  if (!c || !p || p[1] + 1.8 <= 44 || p[1] >= 96) return false;
  const x = p[0] - c[0] - 0.5,
    z = p[2] - c[1] - 0.5;
  return x * x + z * z <= 18 ** 2 || (x >= 12 && x <= 21.5 && Math.abs(z) <= 7.5 && p[1] < 75);
}
export function foraDoPalacio(c) {
  return [c[0] + 32.5, SEA + 1.05, c[1] + 0.5];
}
export function oceanoLivre(gen, c, obras) {
  if (!centroValido(c)) return false;
  for (let dx = -RAIO_GELO - 1; dx <= RAIO_GELO + 1; dx++) {
    const dzMax = Math.floor(Math.sqrt((RAIO_GELO + 1) ** 2 - dx * dx));
    for (let dz = -dzMax; dz <= dzMax; dz++) {
      const x = c[0] + dx,
        z = c[1] + dz;
      if (gen.height(x, z) >= SEA || obras?.(x, z)) return false;
    }
  }
  return true;
}
export function imprimirFortaleza(vox, x0, z0, centro, maxY, origemAntiga) {
  if (!centro) return maxY;
  function perto(c, r = RAIO_GELO) {
    return x0 <= c[0] + r && x0 + 15 >= c[0] - r && z0 <= c[1] + r && z0 + 15 >= c[1] - r;
  }
  const origem = ORIGEM_FORTALEZA, mar = (SEA - Y_MIN) * 256;
  if (origemAntiga && perto(origem, RAIO_LIMPEZA)) {
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const dx = x0 + x - origem[0], dz = z0 + z - origem[1];
        if (dx * dx + dz * dz > RAIO_LIMPEZA * RAIO_LIMPEZA) continue;
        const i = x + 16 * z + mar;
        if (vox[i] === B.ICE) vox[i] = B.WATER;
      }
  }
  if (origemAntiga && perto(centro, RAIO_BANQUISA)) {
    const linhas = lerBanquisa();
    for (let z = 0; z < 16; z++) {
      const l = linhas.get(z0 + z - centro[1]);
      if (!l) continue;
      for (let k = 0; k < l.length; k += 2) {
        const a = Math.max(x0, centro[0] + l[k]), b = Math.min(x0 + 15, centro[0] + l[k] + l[k + 1] - 1);
        for (let wx = a; wx <= b; wx++) { const i = wx - x0 + 16 * z + mar; if (vox[i] === B.WATER) vox[i] = B.ICE; }
      }
    }
  }
  if (!perto(centro)) return maxY;
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const dx = x0 + x - centro[0],
        dz = z0 + z - centro[1];
      if (Math.abs(dx) > RAIO_GELO || Math.abs(dz) > RAIO_GELO) continue;
      for (const [de, ate, id] of coluna(dx, dz) || []) {
        for (let y = de; y < ate; y++) vox[x + 16 * z + (y - Y_MIN) * 256] = id;
        if (id && ate - 1 > maxY) maxY = ate - 1;
      }
    }
  return maxY;
}
