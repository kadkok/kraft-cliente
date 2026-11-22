// LAVRA — mapeamento determinístico de recifes e bentos marinhos (corais, anêmonas, algas, ouriços e estrelas-do-mar).
// Não altera worldgen.js nem os blocos salvos do terreno; gera pontos ecológicos por célula de mar (1..22 m abaixo de SEA).

import { SEA } from './constants.js';
import { hash32, rand01 } from './nature.js';

export const REEF_TYPES = ['anemona', 'coral_ramificado', 'coral_cerebro', 'alga_marinha'];
const EXTRA_PROPS = ['coral_ramificado', 'anemona', 'alga_marinha', 'ourico', 'estrela_do_mar'];
const CELL = 8; // grade de 8x8 m para recife denso e natural

function cellCoord(v) { return Math.floor(v / CELL); }

export function reefAt(seed, x, z, seabedY, seaLevel = SEA) {
  const depth = seaLevel - seabedY;
  if (!(depth >= 2.5 && depth <= 22)) return null;   // 19/11: abaixo de 2,5 m as algas furavam a superfície

  const gx = cellCoord(x);
  const gz = cellCoord(z);
  const h = hash32(seed | 0, gx, gz);
  // 65% das células rasas têm um agrupamento de recife
  if ((h % 100) >= 65) return null;

  const ox = (rand01(seed | 0, gx * 3 + 1, gz * 7 + 2) - 0.5) * 5.2;
  const oz = (rand01(seed | 0, gx * 5 + 3, gz * 11 + 4) - 0.5) * 5.2;
  const rx = gx * CELL + CELL * 0.5 + ox;
  const rz = gz * CELL + CELL * 0.5 + oz;
  const kindIdx = hash32(seed | 0, gx ^ 0x9e37, gz ^ 0x517c) % REEF_TYPES.length;
  const kind = REEF_TYPES[kindIdx];
  const radius = kind === 'coral_cerebro' ? 1.15 : kind === 'anemona' ? 0.9 : 1.05;

  // Cluster ecológico em torno do ponto principal (corais, anêmonas, algas, ouriços, estrelas-do-mar)
  const count = 3 + (hash32(seed | 0, gx * 13, gz * 17) % 4);
  const props = [{ kind, dx: 0, dz: 0, scale: radius, yaw: rand01(seed | 0, gx, gz) * 6.2832 }];
  for (let i = 1; i < count; i++) {
    const a = rand01(seed | 0, gx * 19 + i, gz * 23 + i) * 6.2832;
    const d = 0.8 + rand01(seed | 0, gx * 29 + i, gz * 31 + i) * 2.4;
    const pk = EXTRA_PROPS[hash32(seed | 0, gx + i * 7, gz - i * 11) % EXTRA_PROPS.length];
    const sc = pk === 'ourico' ? 0.65 + rand01(seed, i, 1) * 0.45
      : pk === 'estrela_do_mar' ? 0.75 + rand01(seed, i, 2) * 0.45
      : 0.7 + rand01(seed, i, 3) * 0.65;
    props.push({
      kind: pk,
      dx: Math.round(Math.cos(a) * d * 100) / 100,
      dz: Math.round(Math.sin(a) * d * 100) / 100,
      scale: Math.round(sc * 100) / 100,
      yaw: Math.round(rand01(seed | 0, gx * 3 + i, gz * 5 + i) * 628) / 100,
    });
  }

  return {
    x: Math.round(rx * 100) / 100,
    y: seabedY + 1,
    z: Math.round(rz * 100) / 100,
    kind,
    radius,
    food: kind === 'alga_marinha' ? 0.9 : 0.65,
    props,
  };
}

export function reefSpotsInRange(seed, cx, cz, radius, getSeabedY, seaLevel = SEA) {
  const out = [];
  const r2 = radius * radius;
  const x0 = cellCoord(cx - radius) * CELL;
  const x1 = cellCoord(cx + radius) * CELL;
  const z0 = cellCoord(cz - radius) * CELL;
  const z1 = cellCoord(cz + radius) * CELL;

  for (let gx = x0; gx <= x1; gx += CELL) {
    for (let gz = z0; gz <= z1; gz += CELL) {
      const px = gx + CELL * 0.5;
      const pz = gz + CELL * 0.5;
      const seabedY = getSeabedY(px, pz);
      const spot = reefAt(seed, px, pz, seabedY, seaLevel);
      if (!spot) continue;
      const dx = spot.x - cx, dz = spot.z - cz;
      if (dx * dx + dz * dz <= r2) out.push(spot);
    }
  }
  return out;
}
