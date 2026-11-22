// LAVRA — contas do modo GM que saem iguais em todo aparelho: anel, ilha, árvores grandes e plantas das máquinas.
// Sem senha e sem segredo. A cortina de água do anel é desenho (Astra); aqui o anel é basalto com a cunha de cima acesa.
import { B } from './blocks.js';
import { hash3 } from './noise.js';

const R = 12;

// Anel vertical no plano X, abertura ao longo de Z. cy é o chão. O vão (d² < 7) fica de ar.
export function anel(cx, cy, cz) {
  const cells = [];
  for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 < 7 || d2 > 13) continue;
    const id = dx === 0 && dy === 3 ? B.LAMP : B.BASALT;
    cells.push([cx + dx, cy + 1 + dy, cz, id]);
  }
  return cells;
}

// Centro do vão e o chão do lado de fora, três blocos à frente, para não voltar no mesmo passo.
export function centroAnel(cx, cy, cz) { return [cx + 0.5, cy + 1.5, cz + 0.5]; }
export function saidaAnel(cx, cy, cz) { return [cx + 0.5, cy + 1.1, cz + 3.5]; }

// Ilha em disco. Sem raiz nem seno: a altura sai de faixas de d² e do hash. A borda é areia.
export function ilhaCelulas(seed, cx, cz, sea) {
  const cells = [];
  const s = seed >>> 0;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const d2 = dx * dx + dz * dz;
    if (d2 > R * R) continue;
    let h = d2 < 16 ? 5 : d2 < 49 ? 4 : d2 < 100 ? 3 : d2 < 144 ? 2 : 1;
    h += (hash3(cx + dx, 77, cz + dz, s) % 3) - 1;
    if (h < 1) h = 1;
    if (h > 6) h = 6;
    const yTop = sea - 1 + h;
    const areia = d2 >= 100 || yTop <= sea + 1;
    for (let y = sea - 3; y <= yTop; y++) {
      const id = y === yTop ? (areia ? B.SAND : B.GRASS) : y >= yTop - 2 ? B.DIRT : B.STONE;
      cells.push([cx + dx, y, cz + dz, id]);
    }
  }
  return cells;
}

// Árvore já grande. kind segue shared/trees.js. O carimbo não vira corpo que tomba.
export const ARVORES = {
  frondosa: { kind: 0, th: 11, rad: 4.2 },
  pinheiro: { kind: 1, th: 16, rad: 3.1 },
  savana: { kind: 2, th: 8, rad: 4.4 },
  palmeira: { kind: 4, th: 9, rad: 3.2 },
};

const SEAT = B.SEAT + 3, WHEEL = B.WHEEL, WING_Y = B.WING + 1, WING_X = B.WING;

function carro() {
  const b = [];
  for (let x = 0; x < 3; x++) for (let z = 0; z < 5; z++) b.push([x, 1, z, B.PLANKS]);
  b.push([1, 2, 2, SEAT], [1, 2, 3, B.MOTOR]);
  for (const [x, z] of [[0, 0], [2, 0], [0, 4], [2, 4]]) b.push([x, 0, z, WHEEL]);
  return b;
}
function aviao() {
  const b = [];
  for (let z = 0; z <= 6; z++) b.push([0, 1, z, z === 1 ? B.MOTOR : B.PLANKS]);
  b.push([0, 1, -1, B.PROPELLER + 5], [0, 2, 2, SEAT]);
  for (const z of [2, 3]) for (let x = 1; x <= 4; x++) b.push([x, 1, z, WING_Y], [-x, 1, z, WING_Y]);
  for (const x of [1, 2]) b.push([x, 1, 6, WING_Y], [-x, 1, 6, WING_Y]);
  b.push([0, 2, 6, WING_X], [0, 3, 6, WING_X]);
  b.push([-1, 0, 2, WHEEL], [1, 0, 2, WHEEL], [0, 0, 6, WHEEL]);
  return b;
}
function barco() {
  const b = [];
  for (let x = 0; x < 3; x++) for (let z = 0; z < 5; z++) b.push([x, 0, z, B.PLANKS]);
  b.push([1, 1, 2, SEAT]);
  return b;
}

export const MAQUINAS = { carro: carro(), aviao: aviao(), barco: barco() };
