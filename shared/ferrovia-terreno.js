// Geometria derivada da linha. Nunca grava escavações nas edições do jogador.
import { B } from './blocks.js';
import { SEA, eidx } from './constants.js';
import { tracarVia, tipoVia, TREM } from './ferrovia.js';

const RAIO = 4.7;
export function corredores(linhas, altura) {
  const indice = new Map();
  for (const linha of linhas) {
    const via = tracarVia(linha.pontos);
    for (let i = 1; i < via.nos.length; i++) {
      const a = via.nos[i - 1],
        b = via.nos[i],
        x = (a.p[0] + b.p[0]) / 2,
        z = (a.p[2] + b.p[2]) / 2;
      const tipo = tipoVia((a.p[1] + b.p[1]) / 2, altura(Math.floor(x), Math.floor(z)) + 1);
      const seg = {
        a: a.p,
        b: b.p,
        tipo,
        luz: Math.floor(a.s / 2) % 6 === 0,
        estacao: a.s < TREM.recuo * 2.2 || b.s > via.comprimento - TREM.recuo * 2.2,
      };
      const x0 = Math.floor((Math.min(a.p[0], b.p[0]) - RAIO) / 16),
        x1 = Math.floor((Math.max(a.p[0], b.p[0]) + RAIO) / 16);
      const z0 = Math.floor((Math.min(a.p[2], b.p[2]) - RAIO) / 16),
        z1 = Math.floor((Math.max(a.p[2], b.p[2]) + RAIO) / 16);
      for (let cz = z0; cz <= z1; cz++)
        for (let cx = x0; cx <= x1; cx++) {
          const k = cx + ',' + cz;
          if (!indice.has(k)) indice.set(k, []);
          indice.get(k).push(seg);
        }
    }
  }
  return indice;
}

function corte(seg, x, z) {
  const a = seg.a,
    b = seg.b,
    dx = b[0] - a[0],
    dz = b[2] - a[2],
    ll = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / (ll || 1)));
  return { d: Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t), y: a[1] + (b[1] - a[1]) * t };
}

// Escolhe o eixo mais próximo para cada nível. Duas linhas em níveis distintos podem se cruzar.
export function blocosFerroviarios(indice, cx, cz) {
  const lista = indice?.get(cx + ',' + cz);
  if (!lista?.length) return null;
  const blocos = new Map();
  for (let z = 0; z < 16; z++)
    for (let x = 0; x < 16; x++) {
      const wx = cx * 16 + x + 0.5,
        wz = cz * 16 + z + 0.5,
        cortes = [];
      for (const seg of lista) {
        const c = corte(seg, wx, wz);
        if (c.d > RAIO) continue;
        const anterior = cortes.find((k) => Math.abs(k.y - c.y) < 2);
        if (!anterior) cortes.push({ ...c, seg });
        else if (c.d < anterior.d) Object.assign(anterior, c, { seg });
      }
      for (const { d, y, seg } of cortes) {
        const base = Math.floor(y) - 1,
          fechado = seg.tipo === 'tunel' || seg.tipo === 'vidro';
        const parede = seg.tipo === 'vidro' ? B.GLASS : B.STONE_BRICKS;
        const largura = fechado ? RAIO : seg.estacao ? 4.2 : 2;
        if (d > largura) continue;
        blocos.set(eidx(x, base, z), B.CONCRETE);
        // O lastro acompanha a cota, o teto continua vedado também nas mudanças de nível.
        if (fechado) blocos.set(eidx(x, base - 1, z), B.CONCRETE);
        for (let j = 1; j <= 5; j++) blocos.set(eidx(x, base + j, z), fechado && d > 3.35 ? parede : B.AIR);
        if (fechado) {
          for (let j = 6; j <= 7; j++) blocos.set(eidx(x, base + j, z), parede);
          if (seg.luz && d > 3.35 && d < 4.3) blocos.set(eidx(x, base + 4, z), B.LAMP);
        }
      }
    }
  return blocos;
}
// Limites verticais da galeria na linha d'água. O oceano desenha as ondas acima do vidro,
// e recorta só a água que passaria pelo ar da rampa de entrada.
export function mascaraNaMare(indice, x0, z0, lado, dados) {
  dados.fill(0);
  if (!indice?.size) return false;
  const vistas = new Set();
  let tem = false;
  for (let cz = z0 >> 4; cz <= (z0 + lado - 1) >> 4; cz++)
    for (let cx = x0 >> 4; cx <= (x0 + lado - 1) >> 4; cx++) {
      for (const seg of indice.get(cx + ',' + cz) || []) {
        if (vistas.has(seg) || seg.tipo !== 'vidro') continue;
        vistas.add(seg);
        if (Math.max(seg.a[1], seg.b[1]) + 6 < SEA - 2 || Math.min(seg.a[1], seg.b[1]) > SEA + 3) continue;
        const minX = Math.max(x0, Math.floor(Math.min(seg.a[0], seg.b[0]) - 3.5)),
          maxX = Math.min(x0 + lado - 1, Math.ceil(Math.max(seg.a[0], seg.b[0]) + 3.5));
        const minZ = Math.max(z0, Math.floor(Math.min(seg.a[2], seg.b[2]) - 3.5)),
          maxZ = Math.min(z0 + lado - 1, Math.ceil(Math.max(seg.a[2], seg.b[2]) + 3.5));
        for (let z = minZ; z <= maxZ; z++)
          for (let x = minX; x <= maxX; x++) {
            const c = corte(seg, x + 0.5, z + 0.5);
            if (c.d > 3.45) continue;
            const k = 2 * (x - x0 + (z - z0) * lado),
              base = Math.floor(c.y) + 64;
            dados[k] = base;
            dados[k + 1] = base + 5;
            tem = true;
          }
      }
    }
  return tem;
}
export function dentroTunel(indice, x, y, z) {
  const segs = indice?.get((Math.floor(x) >> 4) + ',' + (Math.floor(z) >> 4));
  if (!segs) return false;
  return segs.some((seg) => {
    if (seg.tipo !== 'vidro' && seg.tipo !== 'tunel') return false;
    const c = corte(seg, x, z);
    return c.d < 3.4 && y > Math.floor(c.y) - 0.2 && y < Math.floor(c.y) + 5;
  });
}
