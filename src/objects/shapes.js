// LAVRA — formas geométricas livres: geometria de cada uma e sua função de distância
// (usada para o jogador colidir e andar sobre rampas, esferas, cilindros...).
// Todas cabem numa caixa unitária centrada na origem; o tamanho real vem de k = [L, A, P].

import * as THREE from '../three.js';
import { LADOS_TORA, secaoTora } from '../../shared/corte-tora.js';

// Painel de construção: chapa com espessura de verdade (pedido do Kadmus, 19/11/2026: "precisa ser 4x mais espesso do
// que atualmente é, está demasiado fino e fica complicado de usar"). Era uma folha sem espessura, com 6 a 8 cm de
// toque; agora é um quarto de bloco, desenhado, mirado e pisado com essa medida. Painel fino (k[2] < 0,1 m) continua
// folha: é o quadro de imagem e o painel antigo que já está posto nos mundos.
export const PAINEL_ESPESSURA = 0.25;
export const painelGrosso = (s, k, m) => s === 'painel' && (!m || m.t !== 'i') && ((k && k[2]) || 0) >= 0.1;

// 'tora' (20/11, pedido do Kadmus: "modelar no ar blocos de tronco de árvore… montar uma tora de madeira, deitar ela
// na horizontal… engrossar ou afinar o tronco"): cilindro com a casca do bloco na lateral e o corte (os anéis) nas
// pontas. k = [grossura, comprimento, grossura]. Serve com qualquer bloco (pedra vira coluna).
export const SHAPES = [
  ['cubo', 'Cubo'], ['tora', 'Tora'], ['esfera', 'Esfera'], ['cilindro', 'Cilindro'], ['cone', 'Cone'], ['piramide', 'Pirâmide'],
  ['rampa', 'Rampa'], ['escada', 'Escada'], ['toro', 'Anel'], ['capsula', 'Cápsula'], ['domo', 'Domo'], ['painel', 'Painel'],
];

const cache = new Map();

function applyPlanarUV(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const uv = [];
  const n = g.attributes.normal;
  for (let i = 0; i < pos.length / 3; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = pos[i * 3] + 0.5, y = pos[i * 3 + 1] + 0.5, z = pos[i * 3 + 2] + 0.5;
    if (ax > ay && ax > az) uv.push(z, y); else if (ay > az) uv.push(x, z); else uv.push(x, y);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function wedge() {
  // caixa cortada na diagonal: baixa na frente (z = -0,5), alta atrás (z = +0,5)
  const p = [
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5,   // base
    -0.5, 0.5, 0.5, 0.5, 0.5, 0.5,                                          // aresta de cima
  ];
  const tri = [
    [0, 1, 2], [0, 2, 3],           // base (para baixo)
    [3, 2, 5], [3, 5, 4],           // costas (+Z)
    [0, 4, 5], [0, 5, 1],           // rampa
    [0, 3, 4],                      // lado -X
    [1, 5, 2],                      // lado +X
  ];
  const pos = [];
  for (const t of tri) for (const i of t) {
    pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  }
  return applyPlanarUV(pos);
}

function stairsGeo(steps = 4) {
  const pos = [];
  const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
  };
  // base (-Y) e costas (+Z)
  quad(-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, 0.5);
  quad(-0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5);
  for (let i = 0; i < steps; i++) {
    const z0 = -0.5 + i / steps, z1 = -0.5 + (i + 1) / steps;
    const yPrev = -0.5 + i / steps, y1 = -0.5 + (i + 1) / steps;
    quad(-0.5, y1, z0, 0.5, y1, z0, 0.5, yPrev, z0, -0.5, yPrev, z0);     // espelho (-Z)
    quad(-0.5, y1, z1, 0.5, y1, z1, 0.5, y1, z0, -0.5, y1, z0);           // piso (+Y)
    quad(-0.5, -0.5, z0, -0.5, -0.5, z1, -0.5, y1, z1, -0.5, y1, z0);     // lateral -X
    quad(0.5, -0.5, z1, 0.5, -0.5, z0, 0.5, y1, z0, 0.5, y1, z1);         // lateral +X
  }
  return applyPlanarUV(pos);
}

// Mantém a mesma amostragem da casca e dos anéis do cilindro inteiro.
function meiaTora(h) {
  const segmentos = LADOS_TORA / 2;
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, segmentos, 1, false, h.inicio * 2 * Math.PI / LADOS_TORA, Math.PI);
  const pos = [...g.attributes.position.array], norm = [...g.attributes.normal.array], uv = [...g.attributes.uv.array];
  const indices = [...g.index.array], face = pos.length / 3;
  for (const i of new Set(indices.slice(0, g.groups[0].count))) uv[2 * i] = h.inicio / LADOS_TORA + uv[2 * i] / 2;
  const [ax, az] = h.arco[0], [bx, bz] = h.arco[segmentos];
  pos.push(ax, -0.5, az, ax, 0.5, az, bx, 0.5, bz, bx, -0.5, bz);
  for (let i = 0; i < 4; i++) norm.push(-h.nx, 0, -h.nz);
  uv.push(0, 0, 0, 1, 1, 1, 1, 0);
  g.addGroup(indices.length, 6, 3);
  indices.push(face, face + 1, face + 2, face, face + 2, face + 3);
  g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.translate(-h.cx, 0, -h.cz);
  g.scale(1 / h.w, 1, 1 / h.d);
  return g;
}

export function shapeGeometry(shape) {
  let g = cache.get(shape);
  if (g) return g;
  switch (shape) {
    case 'esfera': g = new THREE.SphereGeometry(0.5, 40, 24); break;
    case 'cilindro': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
    case 'tora': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); break;   // grupos do three: 0 = lateral, 1 e 2 = pontas
    case 'cone': g = new THREE.ConeGeometry(0.5, 1, 32); break;
    case 'piramide': g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4); g.rotateY(Math.PI / 4); break;
    case 'rampa': g = wedge(); break;
    case 'escada': g = stairsGeo(4); break;
    case 'toro': g = new THREE.TorusGeometry(0.36, 0.14, 14, 36); g.rotateX(Math.PI / 2); break;
    case 'capsula': g = new THREE.CapsuleGeometry(0.25, 0.5, 6, 18); break;
    case 'domo': g = new THREE.SphereGeometry(0.5, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2); g.translate(0, -0.25, 0); g.scale(1, 2, 1); break;
    case 'painel': g = new THREE.PlaneGeometry(1, 1); break;
    default: g = secaoTora(shape) ? meiaTora(secaoTora(shape)) : new THREE.BoxGeometry(1, 1, 1);
  }
  cache.set(shape, g);
  return g;
}

// Quantas vezes a textura de bloco se repete, para ficar com ~1 m por ladrilho.
export function shapeRepeat(shape, k) {
  const meia = secaoTora(shape);
  if (meia) return shapeRepeat('tora', [k[0] / meia.w, k[1], k[2] / meia.d]);
  const w = Math.max(k[0], k[2]);
  switch (shape) {
    case 'esfera': case 'domo': return [Math.max(1, Math.round(Math.PI * w)), Math.max(1, Math.round(Math.PI * k[1] / 2))];
    case 'cilindro': case 'tora': case 'cone': case 'capsula': case 'piramide': return [Math.max(1, Math.round(Math.PI * w)), Math.max(1, Math.round(k[1]))];
    case 'toro': return [Math.max(1, Math.round(Math.PI * w)), Math.max(1, Math.round(k[1] * 2))];
    case 'painel': return [Math.max(1, Math.round(k[0])), Math.max(1, Math.round(k[1]))];
    default: return [Math.max(1, Math.round(w)), Math.max(1, Math.round(k[1]))];
  }
}

// Distância com sinal do ponto local (x, y, z) à forma de tamanho k. Negativa = dentro.
export function shapeSDF(shape, k, x, y, z) {
  const hx = k[0] / 2, hy = k[1] / 2, hz = k[2] / 2;
  const h = secaoTora(shape);
  if (h) {
    const w = k[0] / h.w, d = k[2] / h.d;
    const dx = x + h.cx * w, dz = z + h.cz * d;
    const nx = h.nx / w, nz = h.nz / d;
    const plano = -(dx * nx + dz * nz) / Math.hypot(nx, nz);
    const raio = (Math.hypot(2 * dx / w, 2 * dz / d) - 1) * Math.min(w, d) / 2;
    return Math.max(plano, raio, Math.abs(y) - hy);
  }
  switch (shape) {
    case 'esfera': {
      const l = Math.hypot(x / hx, y / hy, z / hz);
      return (l - 1) * Math.min(hx, hy, hz);
    }
    case 'domo': {
      const l = Math.hypot(x / hx, (y + hy) / (2 * hy), z / hz);
      return Math.max((l - 1) * Math.min(hx, 2 * hy, hz), -(y + hy));
    }
    case 'cilindro': case 'tora': {
      const r = (Math.hypot(x / hx, z / hz) - 1) * Math.min(hx, hz);
      const dY = Math.abs(y) - hy;
      return r > 0 && dY > 0 ? Math.hypot(r, dY) : Math.max(r, dY);
    }
    case 'cone': case 'piramide': {
      // raio encolhe linearmente da base (y = -hy) até a ponta (y = +hy)
      const t = Math.min(1, Math.max(0, (y + hy) / (2 * hy)));
      const rad = shape === 'cone' ? Math.hypot(x / hx, z / hz) : Math.max(Math.abs(x) / hx, Math.abs(z) / hz);
      const side = (rad - (1 - t)) * Math.min(hx, hz) * (2 * hy / Math.hypot(2 * hy, Math.min(hx, hz)));
      return Math.max(side, Math.abs(y) - hy);
    }
    case 'rampa': {
      const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
      const box = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
      // plano da rampa: y/hy = z/hz
      const nl = Math.hypot(1 / hy, 1 / hz);
      return Math.max(box, (y / hy - z / hz) / nl);
    }
    case 'escada': {
      let best = Infinity;
      for (let i = 0; i < 4; i++) {
        const z0 = -hz + (hz * i) * 0.5, z1 = -hz + (hz * (i + 1)) * 0.5;
        const y1 = -hy + (hy * (i + 1)) * 0.5;
        const cy = (-hy + y1) * 0.5, sy = (y1 + hy) * 0.5;
        const cz = (z0 + z1) * 0.5, sz = (z1 - z0) * 0.5;
        const qx = Math.abs(x) - hx, qy = Math.abs(y - cy) - sy, qz = Math.abs(z - cz) - sz;
        const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
        if (d < best) best = d;
      }
      return best;
    }
    case 'toro': {
      const R = 0.36 * (hx + hz), r = 0.14 * (hx + hz);
      const q = Math.hypot(x, z) - R;
      return Math.hypot(q, y * (r / Math.max(1e-3, 0.28 * hy))) - r;
    }
    case 'capsula': {
      const r = 0.5 * Math.min(hx, hz), a = Math.max(0, hy - r);
      const cy = Math.max(-a, Math.min(a, y));
      return Math.hypot(x * (r / Math.max(1e-3, 0.5 * hx)), y - cy, z * (r / Math.max(1e-3, 0.5 * hz))) - r;
    }
    case 'painel': {
      const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - Math.max(0.04, hz);   // a espessura é a do painel (a folha antiga segue com 8 cm de toque)
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
    }
    default: {
      const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
    }
  }
}

// Malha de colisão de um modelo importado: triângulos numa grade espacial.
export function buildTriGrid(positions, cell = 1.5) {
  const grid = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const n = positions.length / 9;
  for (let t = 0; t < n; t++) {
    const o = t * 9;
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < 3; i++) {
      const x = positions[o + i * 3], y = positions[o + i * 3 + 1], z = positions[o + i * 3 + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const ax = Math.floor(x0 / cell), bx = Math.floor(x1 / cell), ay = Math.floor(y0 / cell), by = Math.floor(y1 / cell), az = Math.floor(z0 / cell), bz = Math.floor(z1 / cell);
    if ((bx - ax + 1) * (by - ay + 1) * (bz - az + 1) > 4096) continue; // triângulo gigante: ignora na grade fina
    for (let cx = ax; cx <= bx; cx++) for (let cy = ay; cy <= by; cy++) for (let cz = az; cz <= bz; cz++) {
      const kx = key(cx, cy, cz);
      let list = grid.get(kx);
      if (!list) { list = []; grid.set(kx, list); }
      list.push(o);
    }
  }
  return { grid, cell, positions };
}

// Ponto do triângulo (a, b, c) mais próximo de p. Escreve em out.
function closestOnTri(px, py, pz, P, o, out) {
  const ax = P[o], ay = P[o + 1], az = P[o + 2], bx = P[o + 3], by = P[o + 4], bz = P[o + 5], cx = P[o + 6], cy = P[o + 7], cz = P[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { out[0] = ax; out[1] = ay; out[2] = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { out[0] = bx; out[1] = by; out[2] = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); out[0] = ax + abx * v; out[1] = ay + aby * v; out[2] = az + abz * v; return; }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { out[0] = cx; out[1] = cy; out[2] = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); out[0] = ax + acx * w; out[1] = ay + acy * w; out[2] = az + acz * w; return; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    out[0] = bx + (cx - bx) * w; out[1] = by + (cy - by) * w; out[2] = bz + (cz - bz) * w; return;
  }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  out[0] = ax + abx * v + acx * w; out[1] = ay + aby * v + acy * w; out[2] = az + abz * v + acz * w;
}

const tmp = [0, 0, 0];
// Empurra uma esfera (centro c, raio r) para fora dos triângulos. Devolve true se tocou; soma o empurrão em push.
export function sphereVsTriGrid(tg, c, r, push) {
  const { grid, cell, positions } = tg;
  let hit = false;
  const x0 = Math.floor((c[0] - r) / cell), x1 = Math.floor((c[0] + r) / cell);
  const y0 = Math.floor((c[1] - r) / cell), y1 = Math.floor((c[1] + r) / cell);
  const z0 = Math.floor((c[2] - r) / cell), z1 = Math.floor((c[2] + r) / cell);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) for (let cz = z0; cz <= z1; cz++) {
    const list = grid.get(cx + ',' + cy + ',' + cz);
    if (!list) continue;
    for (let i = 0; i < list.length; i++) {
      closestOnTri(c[0] + push[0], c[1] + push[1], c[2] + push[2], positions, list[i], tmp);
      const dx = c[0] + push[0] - tmp[0], dy = c[1] + push[1] - tmp[1], dz = c[2] + push[2] - tmp[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < r && d > 1e-6) {
        const k = (r - d) / d;
        push[0] += dx * k; push[1] += dy * k; push[2] += dz * k;
        hit = true;
      }
    }
  }
  return hit;
}
