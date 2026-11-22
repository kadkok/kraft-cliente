// Blocos da obra já construída. A posição é enviada no snapshot. A planta fica no cliente.
import { PALACIO, GELEIRA } from './fortaleza-obra.js';
import { B } from './blocks.js';
import { SEA, Y_MIN } from './constants.js';

export const ORIGEM_FORTALEZA = Object.freeze([-235, -430]);
export const ALTO_MAR = Object.freeze([10500, -10500]);
export const RAIO_GELO = 50;
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
  function perto(c) {
    return (
      x0 <= c[0] + RAIO_GELO &&
      x0 + 15 >= c[0] - RAIO_GELO &&
      z0 <= c[1] + RAIO_GELO &&
      z0 + 15 >= c[1] - RAIO_GELO
    );
  }
  const origem = ORIGEM_FORTALEZA;
  if (origemAntiga && perto(origem)) {
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        if (!naGeleira(origem, x0 + x, z0 + z)) continue;
        const i = x + 16 * z + (SEA - Y_MIN) * 256;
        if (vox[i] === B.ICE) vox[i] = B.WATER;
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
