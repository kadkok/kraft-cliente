// LAVRA — Vila Pesqueira Costeira 3D (Píer/Deck de Madeira, Passarela/Boardwalk, Bancas e Casas Costeiras).
// Adaptado de dgreenheck/tidewater (MIT License — Copyright (c) 2026 DRG Software Solutions LLC):
//   src/world/Pier.js, src/world/Village.js, src/world/village/Buildings.js,
//   src/world/village/Boardwalk.js, src/world/village/GeoBuilder.js,
//   src/world/village/TextureBaker.js, src/world/village/VillageMaterials.js,
//   src/world/Props.js, src/game/FishStand.js, src/game/Chandlery.js, src/game/StallKit.js.
//
// Convenção de coordenadas da `vila`:
//   · (vila.x, vila.z): ponto de transição praia -> água (início do píer na margem, y ≈ SEA = 48).
//   · vila.dir (radianos): aponta da praia para o mar aberto (dx = cos(dir), dz = sin(dir)).
//     +dir (~34 m): píer de madeira sobre estacas até o T-head, escada d'água, cabeços, defensas e lanternas.
//     -dir e laterais (sobre a praia): passarela elevada (Boardwalk), praça, bancas Joe's Fish Stand e
//     Marta's Chandlery, barraquinha de mercado coberta de sapê, palafitas, boathouse com rampa e casas costeiras.

import * as THREE from '../three.js';
import { SEA } from '../../shared/constants.js';
import { PADRAO_VENTO, normalizarVento } from '../../shared/ondas.js';

const TAU = Math.PI * 2;
const STEP_UP_MAX = 0.55;
const MAT_TEX_SLOTS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
  'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap',
];

export const DIMENSOES_VILA_COSTEIRA = Object.freeze({
  pierInicioZ: -6.0,
  pierHeadZ0: 27.0,
  pierFimZ: 34.0,
  pierLargura: 2.6,
  headLargura: 14.0,
  headProfundidade: 7.0,
  deckAlturaSobreMar: 2.3,
  atracacaoLocalX: 9.55,
  atracacaoLocalZ: 30.8,
  escadaLocalX: 7.07,
  escadaLocalZ: 29.9,
});

// ---- Utilitários determinísticos e matemáticos --------------------------------------------------------------------

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function mulberry32(seed) {
  let a = (seed | 0) || 90210;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rand {
  constructor(seed) {
    this.fn = mulberry32(seed);
  }
  next() { return this.fn(); }
  range(a, b) { return a + (b - a) * this.fn(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.fn() * arr.length) % arr.length]; }
  chance(p) { return this.fn() < p; }
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valNoisePeriodic(x, y, px, py, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const x0 = ((ix % px) + px) % px;
  const x1 = (x0 + 1) % px;
  const y0 = ((iy % py) + py) % py;
  const y1 = (y0 + 1) % py;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbmPeriodic(u, v, fx, fy, oct, seed) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * valNoisePeriodic(u * fx, v * fy, fx, fy, seed + i * 97);
    norm += amp;
    fx *= 2;
    fy *= 2;
    amp *= 0.5;
  }
  return sum / norm;
}

function worleyPeriodic(u, v, nx, ny, seed) {
  const x = u * nx;
  const y = v * ny;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const wx = ((cx % nx) + nx) % nx;
      const wy = ((cy % ny) + ny) % ny;
      const px = cx + 0.14 + 0.72 * hash2(wx, wy, seed);
      const py = cy + 0.14 + 0.72 * hash2(wx, wy, seed + 13);
      const d = Math.hypot(x - px, y - py);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(wx, wy, seed + 29);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return { d1, d2, id };
}

function seedDeVila(vila) {
  if (Number.isFinite(vila?.seed)) return vila.seed | 0;
  const x = Math.round((Number(vila?.x) || 0) * 10);
  const z = Math.round((Number(vila?.z) || 0) * 10);
  const d = Math.round((Number(vila?.dir) || 0) * 100);
  return ((Math.imul(x, 73856093) ^ Math.imul(z, 19349663) ^ Math.imul(d, 83492791)) ^ 90210) | 0;
}

// ---- Sistema de coordenadas da vila (base ortonormal destra) -------------------------------------------------------
// Local +Z aponta para +dir (cos(dir), 0, sin(dir)) da praia para o mar aberto.
// Local +X aponta para (sin(dir), 0, -cos(dir)).
// Rotação equivalente em Three.js: rotation.y = Math.PI / 2 - dir.

function criarFrameVila(vila) {
  const ox = Number(vila?.x) || 0;
  const oz = Number(vila?.z) || 0;
  const baseY = Number.isFinite(vila?.y) ? vila.y : SEA;
  const dir = Number.isFinite(vila?.dir) ? vila.dir : 0;
  const nearSea = Math.abs(baseY - SEA) <= 8;
  const waterY = Number.isFinite(vila?.marY) ? vila.marY : (nearSea ? SEA + 0.88 : baseY + 0.88);
  const shoreY = nearSea ? Math.max(baseY, SEA + 1.0) : baseY;
  const deckY = Number.isFinite(vila?.deckY) ? vila.deckY : Math.max(waterY + 2.3, baseY + 2.18);

  const fx = Math.cos(dir);
  const fz = Math.sin(dir);
  const rx = Math.sin(dir);
  const rz = -Math.cos(dir);
  const ry = Math.PI / 2 - dir;

  const toWorldXZ = (lx, lz) => ({ x: ox + lx * rx + lz * fx, z: oz + lx * rz + lz * fz });
  const toLocalXZ = (wx, wz) => {
    const dx = wx - ox;
    const dz = wz - oz;
    return { lx: dx * rx + dz * rz, lz: dx * fx + dz * fz };
  };
  const beachY = (lx, lz) => {
    if (lz >= 0) {
      return Math.max(waterY - 4.8, shoreY - 0.18 - lz * 0.11);
    }
    return shoreY + Math.min(3.8, -lz * 0.062);
  };

  return {
    id: vila?.id ?? `${Math.round(ox)}_${Math.round(oz)}`,
    nome: vila?.nome || 'Vila Pesqueira',
    ox, oz, baseY, dir, ry, fx, fz, rx, rz,
    waterY, shoreY, deckY,
    seed: seedDeVila(vila),
    toWorldXZ, toLocalXZ, beachY,
  };
}

// ---- Paleta linear (sRGB hex -> linear [r, g, b]) ----------------------------------------------------------------

const _col = new THREE.Color();
function lin(hex) {
  _col.setHex(hex);
  return [_col.r, _col.g, _col.b];
}

const C = {
  woodRaw: lin(0x9a8f7e),
  woodFresh: lin(0xc8aa78),
  woodDark: lin(0x6e6253),
  woodDeck: lin(0x988e7f),
  iron: lin(0x28292b),
  galv: lin(0x9aa3a7),
  brass: lin(0xb59148),
  rubber: lin(0x1a1a1c),
  rope: lin(0xb99e6e),
  ropeDark: lin(0x7c694a),
  ropeBlue: lin(0x3f7191),
  white: lin(0xf2efe6),
  cream: lin(0xe8dec6),
  orange: lin(0xe8642c),
  red: lin(0xc43c2e),
  yellow: lin(0xf0c43c),
  green: lin(0x3f8256),
  blue: lin(0x2f6fa8),
  black: lin(0x222325),
  glassDay: lin(0x526470),
  glassWarm: lin(0xffdfb0),
  thatch: lin(0xd6c79a),
  stone: lin(0xdcd5c5),
  fishSilver: lin(0x9ca9b2),
  fishDry: lin(0x947047),
  coral: lin(0xe07a5f),
  teal: lin(0x2d8782),
};

const PASTELS = [
  lin(0x5dbcb0), // turquoise
  lin(0xec8b76), // coral
  lin(0xefe2c2), // cream
  lin(0x8cc2e0), // sky
  lin(0xf0cf7c), // yellow
  lin(0xa9dcbf), // mint
  lin(0xf2b3aa), // pink
  lin(0xbdb3da), // lavender
  lin(0x6aa6b8), // sea
];

const TRIMS = {
  white: lin(0xf3efe6),
  cream: lin(0xe9dfc6),
  navy: lin(0x2e4f73),
  teal: lin(0x2d7f7a),
  red: lin(0xa8463a),
  green: lin(0x4c7d4c),
  yellow: lin(0xe0b545),
  blue: lin(0x3f79ae),
};

const ROOFS = {
  red: lin(0xa64a35),
  green: lin(0x5f8a6a),
  blue: lin(0x4f7898),
  teal: lin(0x3f8a86),
  rust: lin(0x8a5a40),
  grey: lin(0x8c9296),
};

// ---- Colisores determinísticos compartilhados (CPU pura + física de caminhada/barco) ------------------------------

class VilaColliders {
  constructor() {
    this.boxes = [];
    this.cylinders = [];
  }

  addBox(cx, cy, cz, hx, hy, hz, rotY = 0, { walkable = false, solid = true, tag = '' } = {}) {
    this.boxes.push({
      cx, cy, cz, hx, hy, hz, rotY,
      cos: Math.cos(rotY),
      sin: Math.sin(rotY),
      walkable,
      solid,
      tag,
      top: cy + hy,
      bottom: cy - hy,
      radius: Math.hypot(hx, hz),
    });
  }

  addCylinder(x, z, radius, yMin, yMax, { tag = '' } = {}) {
    this.cylinders.push({ x, z, radius, yMin, yMax, tag });
  }

  groundHeightAt(lx, lz, maxY = Infinity, pad = 0.22) {
    let best = -Infinity;
    const limit = Number.isFinite(maxY) ? maxY + STEP_UP_MAX : Infinity;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.walkable || b.top > limit) continue;
      if (Math.abs(lx - b.cx) > b.radius + pad + 0.02 || Math.abs(lz - b.cz) > b.radius + pad + 0.02) continue;
      const dx = lx - b.cx;
      const dz = lz - b.cz;
      const bx = dx * b.cos - dz * b.sin;
      const bz = dx * b.sin + dz * b.cos;
      if (Math.abs(bx) <= b.hx + pad && Math.abs(bz) <= b.hz + pad) {
        if (b.top > best) best = b.top;
      }
    }
    return best > -Infinity ? best : null;
  }

  collidesAt(lx, ly, lz, radius = 0.32, height = 1.75, stepHeight = 0.35) {
    const r = Math.max(0.05, Number(radius) || 0.32);
    const yLo = ly + stepHeight;
    const yHi = ly + height;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.solid || yHi <= b.bottom || yLo >= b.top) continue;
      if (Math.abs(lx - b.cx) > b.radius + r || Math.abs(lz - b.cz) > b.radius + r) continue;
      const dx = lx - b.cx;
      const dz = lz - b.cz;
      const bx = dx * b.cos - dz * b.sin;
      const bz = dx * b.sin + dz * b.cos;
      const px = clamp(bx, -b.hx, b.hx);
      const pz = clamp(bz, -b.hz, b.hz);
      const ex = bx - px;
      const ez = bz - pz;
      if (ex * ex + ez * ez < r * r) return true;
    }
    for (let i = 0; i < this.cylinders.length; i++) {
      const c = this.cylinders[i];
      if (yHi <= c.yMin || yLo >= c.yMax) continue;
      const dx = lx - c.x;
      const dz = lz - c.z;
      const rr = c.radius + r;
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  resolveLocalCapsule(posLocal, radius = 0.32, height = 1.75, stepHeight = 0.35) {
    let hit = false;
    let outNx = 0;
    let outNz = 0;
    let maxPen = 0;
    let hitTag = '';
    const r = Math.max(0.05, Number(radius) || 0.32);
    const yLo = posLocal.y + stepHeight;
    const yHi = posLocal.y + height;

    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (!b.solid || yHi <= b.bottom || yLo >= b.top) continue;
      if (Math.abs(posLocal.x - b.cx) > b.radius + r || Math.abs(posLocal.z - b.cz) > b.radius + r) continue;
      const dx = posLocal.x - b.cx;
      const dz = posLocal.z - b.cz;
      const bx = dx * b.cos - dz * b.sin;
      const bz = dx * b.sin + dz * b.cos;
      const cx = clamp(bx, -b.hx, b.hx);
      const cz = clamp(bz, -b.hz, b.hz);
      const ex = bx - cx;
      const ez = bz - cz;
      const d2 = ex * ex + ez * ez;
      if (d2 >= r * r) continue;

      let lnx;
      let lnz;
      let pen;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        lnx = ex / d;
        lnz = ez / d;
        pen = r - d;
      } else {
        const px = b.hx - Math.abs(bx);
        const pz = b.hz - Math.abs(bz);
        if (px < pz) {
          lnx = bx >= 0 ? 1 : -1;
          lnz = 0;
          pen = px + r;
        } else {
          lnx = 0;
          lnz = bz >= 0 ? 1 : -1;
          pen = pz + r;
        }
      }
      const nx = lnx * b.cos + lnz * b.sin;
      const nz = -lnx * b.sin + lnz * b.cos;
      posLocal.x += nx * pen;
      posLocal.z += nz * pen;
      hit = true;
      if (pen > maxPen) {
        maxPen = pen;
        outNx = nx;
        outNz = nz;
        hitTag = b.tag;
      }
    }

    for (let i = 0; i < this.cylinders.length; i++) {
      const c = this.cylinders[i];
      if (yHi <= c.yMin || yLo >= c.yMax) continue;
      const dx = posLocal.x - c.x;
      const dz = posLocal.z - c.z;
      const rr = c.radius + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-4;
      const nx = dx / d;
      const nz = dz / d;
      const pen = rr - d;
      posLocal.x = c.x + nx * rr;
      posLocal.z = c.z + nz * rr;
      hit = true;
      if (pen > maxPen) {
        maxPen = pen;
        outNx = nx;
        outNz = nz;
        hitTag = c.tag;
      }
    }

    return { hit, nx: outNx, nz: outNz, pen: maxPen, tag: hitTag };
  }
}

// ---- Especificação unificada do layout da vila (alimenta tanto colisores puros quanto malhas 3D) ----------------

function gerarEspecificacaoVila(frame) {
  const rand = new Rand(frame.seed);
  const { waterY, deckY, beachY } = frame;
  const z0 = DIMENSOES_VILA_COSTEIRA.pierInicioZ;     // -6.0
  const zH = DIMENSOES_VILA_COSTEIRA.pierHeadZ0;      // 27.0
  const z1 = DIMENSOES_VILA_COSTEIRA.pierFimZ;        // 34.0
  const pierW = DIMENSOES_VILA_COSTEIRA.pierLargura;  // 2.6
  const headW = DIMENSOES_VILA_COSTEIRA.headLargura;  // 14.0

  // Degraus de acesso na praia até o início do píer
  const stepFootZ = -8.4;
  const bwStartY = beachY(0, stepFootZ) + 0.36;

  // Curva principal da passarela (Boardwalk) da ponta da escada até a praça
  const mainPathPts = [
    [0, stepFootZ + 0.1],
    [-0.9, -12.5],
    [-2.5, -17.0],
    [-4.1, -21.5],
    [-4.8, -24.8],
  ];

  // Ramificações da passarela para as bancas e casas costeiras (conectam direto às entradas/escadas)
  const sidePaths = [
    { pts: [[-1.2, -13.3], [-2.3, -13.4], [-3.4, -13.5]], width: 1.3, lift: 0.22 }, // Joe's Fish Stand
    { pts: [[-1.4, -14.0], [1.8, -14.3], [4.8, -14.5]], width: 1.3, lift: 0.22 },   // Marta's Chandlery
    { pts: [[-2.5, -17.0], [-8.8, -17.1], [-15.2, -17.1]], width: 1.15, lift: 0.22 }, // Casa A (frente)
    { pts: [[-2.1, -22.5], [5.8, -20.2], [13.0, -19.0]], width: 1.15, lift: 0.22 },   // Casa B (frente)
  ];

  // Bancas (Joe's Fish Stand & Marta's Chandlery) + Barraquinha de Mercado
  const fishStand = { x: -4.9, z: -13.5, yaw: 1.48 };
  const chandlery = { x: 6.7, z: -14.6, yaw: -1.72 };
  const marketStall = { x: -4.8, z: -28.0, yaw: 0.08 };
  const plaza = { x: -4.8, z: -24.6, r: 3.3, y: beachY(-4.8, -24.6) + 0.34 };

  // Casas costeiras, palafitas e boathouse (yaw=0 -> fachada +Z voltada para o mar)
  const houses = [
    // Palafitas próximas ao píer
    {
      name: 'S1', harbor: true, x: 12.2, z: -9.8, yaw: -0.1, w: 4.1, d: 4.0,
      floorY: Math.max(beachY(12.2, -9.8) + 1.35, waterY + 2.55), foundation: 'stilts',
      roof: 'gableFront', roofMat: 'metal', roofColor: ROOFS.rust,
      wall: PASTELS[8], trim: TRIMS.white, accent: TRIMS.red,
      porch: { depth: 1.6, rail: 'x' }, railNet: lin(0x3f6f5f), buoys: 1,
    },
    {
      name: 'S2', harbor: true, x: -12.6, z: -10.5, yaw: 0.14, w: 4.2, d: 4.0,
      floorY: Math.max(beachY(-12.6, -10.5) + 1.35, waterY + 2.55), foundation: 'stilts',
      roof: 'gableFront', roofMat: 'thatch',
      wall: PASTELS[1], trim: TRIMS.cream, accent: TRIMS.teal,
      porch: { depth: 1.6, rail: 'x' }, railNet: lin(0x9a4a38), buoys: -1,
    },
    // Primeira linha costeira sobre a areia alta
    {
      name: 'A', x: -16.8, z: -22.8, yaw: 0.14, w: 5.8, d: 4.8,
      foundation: 'stone', roof: 'gable', roofMat: 'metal', roofColor: ROOFS.red,
      wall: PASTELS[0], trim: TRIMS.white, accent: TRIMS.navy,
      porch: { depth: 2.0, rail: 'balusters' }, stovepipe: true, buoys: -1,
    },
    {
      name: 'B', x: 14.2, z: -24.2, yaw: -0.14, w: 5.2, d: 4.4,
      foundation: 'posts', roof: 'hip', roofMat: 'thatch',
      wall: PASTELS[1], trim: TRIMS.cream, accent: TRIMS.teal,
      porch: { depth: 1.8, rail: 'x' }, annex: { w: 2.8, d: 1.9, wall: PASTELS[2] },
    },
    // Linha superior (sobrado do capitão + casas coloridas)
    {
      name: 'C', x: 0.8, z: -34.5, yaw: -0.04, w: 6.8, d: 5.4, stories: 2,
      foundation: 'stone', roof: 'gableFront', roofMat: 'metal', roofColor: ROOFS.grey, galv: true,
      wall: PASTELS[2], trim: TRIMS.white, accent: TRIMS.blue,
      porch: { depth: 2.1, rail: 'x' }, antenna: true, tank: 1, doorGlass: true,
    },
    {
      name: 'D', x: -21.5, z: -34.2, yaw: 0.22, w: 5.6, d: 4.8,
      foundation: 'posts', roof: 'gable', roofMat: 'metal', roofColor: ROOFS.green,
      wall: PASTELS[3], trim: TRIMS.white, accent: TRIMS.yellow,
      porch: { depth: 1.9, rail: 'balusters' }, chimney: -1, woodpile: 1,
    },
    {
      name: 'E', x: 20.5, z: -35.0, yaw: -0.24, w: 5.4, d: 4.6,
      foundation: 'stone', roof: 'hip', roofMat: 'metal', roofColor: ROOFS.teal,
      wall: PASTELS[4], trim: TRIMS.white, accent: TRIMS.green,
      porch: { depth: 1.8, rail: 'balusters' }, buoys: 1,
    },
  ];

  for (const h of houses) {
    if (!Number.isFinite(h.floorY)) {
      h.floorY = beachY(h.x, h.z) + 0.95;
    }
    h.stories = h.stories || 1;
    h.storyH = h.stories > 1 ? 2.65 : 2.85;
    h.roofTop = h.floorY + h.stories * h.storyH + 1.8;
  }

  const boathouse = {
    x: 20.8, z: -6.2, yaw: -0.08, w: 5.2, d: 6.8,
    floorY: beachY(20.8, -6.2),
    wall: lin(0x8fb3a8), roofColor: ROOFS.grey,
  };

  const sheds = [
    { x: -9.5, z: -32.2, yaw: 0.12, w: 1.9, d: 1.7, wall: lin(0xb9c9b0), door: TRIMS.red },
    { x: 11.8, z: -32.8, yaw: -0.18, w: 1.9, d: 1.7, wall: lin(0xd8b8a0), door: TRIMS.teal, galv: true },
  ];

  // Curvas amostradas das passarelas (usadas tanto pelos colisores quanto pela geometria 3D)
  const sampleBoardwalk = (pts, width, lift, startY = null) => {
    const ctrl = pts.map(([px, pz]) => new THREE.Vector3(px, 0, pz));
    const curve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const len = curve.getLength();
    const pitch = 0.22;
    const n = Math.max(4, Math.floor(len / pitch));
    const samples = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      tan.y = 0;
      tan.normalize();
      const nx = -tan.z;
      const nz = tan.x;
      const g = Math.max(beachY(p.x, p.z), beachY(p.x + nx * width * 0.5, p.z + nz * width * 0.5), beachY(p.x - nx * width * 0.5, p.z - nz * width * 0.5));
      samples.push({ x: p.x, z: p.z, nx, nz, yaw: Math.atan2(tan.x, tan.z), g, y: g + lift });
    }
    if (startY !== null) {
      const blend = Math.min(n, 10);
      for (let i = 0; i <= blend; i++) {
        const k = i / blend;
        samples[i].y = Math.max(samples[i].g + 0.14, startY * (1 - k) + samples[i].y * k);
      }
    }
    return { samples, width, len };
  };

  const mainBw = sampleBoardwalk(mainPathPts, 1.9, 0.28, bwStartY);
  const branchBws = sidePaths.map((sp) => sampleBoardwalk(sp.pts, sp.width, sp.lift));

  return {
    rand,
    z0, zH, z1, pierW, headW,
    stepFootZ, bwStartY,
    mainBw, branchBws,
    plaza, fishStand, chandlery, marketStall,
    houses, boathouse, sheds,
  };
}

function popularColisores(frame, spec, colliders) {
  const { deckY, waterY, beachY } = frame;
  const { z0, zH, z1, pierW, headW, bwStartY, mainBw, branchBws, plaza, fishStand, chandlery, marketStall, houses, boathouse, sheds } = spec;
  const halfW = pierW / 2;
  const hx0 = -headW / 2;
  const hx1 = headW / 2;

  // 1) Deck principal do píer e T-head (caminháveis)
  colliders.addBox(0, deckY - 0.05, (z0 + zH) / 2, halfW, 0.05, (zH - z0) / 2, 0, { walkable: true, solid: true, tag: 'pierDeck' });
  colliders.addBox(0, deckY - 0.05, (zH + z1) / 2, headW / 2, 0.05, (z1 - zH) / 2, 0, { walkable: true, solid: true, tag: 'pierDeck' });

  // 2) Escada de terra do píer (z0 = -6.0 até stepFootZ = -8.4)
  const rise = deckY - bwStartY;
  const nSteps = Math.max(3, Math.ceil(rise / 0.22));
  const rh = rise / nSteps;
  const tread = (z0 - spec.stepFootZ) / nSteps;
  for (let k = 1; k < nSteps; k++) {
    const top = deckY - k * rh;
    const zc = z0 - (k - 0.5) * tread;
    const gb = beachY(0, zc) - 0.25;
    colliders.addBox(0, (top + gb) / 2, zc, halfW, (top - gb) / 2, tread / 2 + 0.03, 0, { walkable: true, solid: true, tag: 'pierStep' });
  }

  // 3) Guarda-corpos do píer (com vãos intencionais para pesca)
  const nB = Math.round((zH - z0) / 3.0);
  const bentZ = [];
  for (let i = 0; i <= nB; i++) bentZ.push(z0 + 0.35 + i * (zH - z0 - 0.1) / nB);
  const lastBent = bentZ.length - 1;
  const gapBays = { '-1': [3, 7], '1': [5, 9] };
  const hasRail = (side, bi) => bi >= 0 && bi < lastBent && !gapBays[side].includes(bi);

  for (let bi = 0; bi < bentZ.length; bi++) {
    const bz = bentZ[bi];
    for (const side of [-1, 1]) {
      const px = side * (halfW + 0.17);
      colliders.addCylinder(px, bz, 0.16, waterY - 4.5, deckY + 0.95, { tag: 'pile' });
      if (bi < lastBent && hasRail(side, bi)) {
        const len = bentZ[bi + 1] - bz;
        colliders.addBox(px, deckY + 0.55, (bz + bentZ[bi + 1]) / 2, 0.1, 0.55, len / 2, 0, { tag: 'pierRail' });
      }
    }
  }
  // Pilares sob o T-head e guarda-corpos nas bordas oeste, norte e sul (borda leste +7 livre para atracação)
  const rowsZ = [zH + 0.25, (zH + z1) / 2, z1 - 0.25];
  const colsX = [];
  for (let k = 0; k < 5; k++) colsX.push(hx0 + 0.35 + k * (headW - 0.7) / 4);
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 5; k++) {
      if (r === 0 && k === 2) continue;
      const post = (r === 0 || r === 2 || k === 0) && !(k === 4 && r === 1);
      colliders.addCylinder(colsX[k], rowsZ[r], 0.16, waterY - 4.5, post ? deckY + 0.95 : deckY - 0.25, { tag: 'pile' });
    }
  }
  // Borda sul (mar aberto), borda oeste (-X) e borda norte (-Z nos flancos do acesso)
  colliders.addBox(0, deckY + 0.55, rowsZ[2], (colsX[4] - colsX[0]) / 2, 0.55, 0.1, 0, { tag: 'pierRail' });
  colliders.addBox(colsX[0], deckY + 0.55, (rowsZ[0] + rowsZ[2]) / 2, 0.1, 0.55, (rowsZ[2] - rowsZ[0]) / 2, 0, { tag: 'pierRail' });
  colliders.addBox((colsX[0] - halfW - 0.17) / 2, deckY + 0.55, rowsZ[0], (Math.abs(colsX[0]) - halfW - 0.17) / 2, 0.55, 0.1, 0, { tag: 'pierRail' });
  colliders.addBox((halfW + 0.17 + colsX[4]) / 2, deckY + 0.55, rowsZ[0], (colsX[4] - halfW - 0.17) / 2, 0.55, 0.1, 0, { tag: 'pierRail' });
  // Vigas/defensas de borda do T-head (evita que barcos atravessem entre estacas sem tocar na parede do cais)
  colliders.addBox(hx1 - 0.15, deckY - 0.75, (zH + z1) / 2, 0.35, 0.85, (z1 - zH) / 2, 0, { tag: 'pierFender' });
  colliders.addBox(hx0 + 0.15, deckY - 0.75, (zH + z1) / 2, 0.35, 0.85, (z1 - zH) / 2, 0, { tag: 'pierFender' });
  colliders.addBox(0, deckY - 0.75, z1 - 0.15, headW / 2, 0.85, 0.35, 0, { tag: 'pierFender' });

  // Cabeços de amarração e equipamentos do T-head
  for (const bz of [29.0, 32.8]) {
    colliders.addCylinder(hx1 - 0.45, bz, 0.22, deckY, deckY + 0.52, { tag: 'bollard' });
  }
  colliders.addBox(-3.2, deckY + 0.42, z1 - 0.95, 0.85, 0.42, 0.3, 0, { tag: 'bench' });
  colliders.addBox(3.1, deckY + 0.45, z1 - 0.95, 0.7, 0.45, 0.35, 0, { tag: 'table' });
  colliders.addBox(-5.6, deckY + 0.4, 29.0, 0.55, 0.4, 0.45, 0, { tag: 'crates' });
  colliders.addBox(-5.3, deckY + 0.35, 32.6, 0.72, 0.35, 0.48, 0, { tag: 'traps' });
  colliders.addCylinder(-6.1, 30.8, 0.32, deckY, deckY + 0.9, { tag: 'barrel' });

  // Escada lateral até a água (borda leste do T-head: lx = 7.07, lz = 29.9)
  const ladX = DIMENSOES_VILA_COSTEIRA.escadaLocalX;
  const ladZ = DIMENSOES_VILA_COSTEIRA.escadaLocalZ;
  for (let y = waterY - 0.4; y < deckY - 0.05; y += 0.3) {
    colliders.addBox(ladX + 0.24, y - 0.15, ladZ, 0.28, 0.15, 0.32, 0, { walkable: true, solid: false, tag: 'ladder' });
  }

  // 4) Passarelas (Boardwalk principal e ramais)
  const addBwColliders = (bw) => {
    const S = bw.samples;
    const cs = 4;
    for (let i = 0; i < S.length - 1; i += cs) {
      const j = Math.min(S.length - 1, i + cs);
      const a = S[i];
      const b = S[j];
      let top = -Infinity;
      let bot = Infinity;
      for (let k = i; k <= j; k++) {
        top = Math.max(top, S[k].y);
        bot = Math.min(bot, S[k].g - 0.3);
      }
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      colliders.addBox((a.x + b.x) / 2, (top + bot) / 2, (a.z + b.z) / 2, bw.width / 2, (top - bot) / 2, len / 2 + 0.05, yaw, { walkable: true, solid: true, tag: 'boardwalk' });
    }
  };
  addBwColliders(mainBw);
  for (const b of branchBws) addBwColliders(b);

  // Praça central caminhável
  colliders.addBox(plaza.x, plaza.y - 0.25, plaza.z, plaza.r, 0.25, plaza.r, 0, { walkable: true, solid: true, tag: 'plaza' });

  // 5) Bancas: Joe's Fish Stand, Marta's Chandlery, Market Stall
  const fsY = beachY(fishStand.x, fishStand.z);
  colliders.addBox(fishStand.x, fsY + 1.15, fishStand.z, 1.38, 1.15, 0.88, fishStand.yaw, { tag: 'fishStand' });
  const chY = beachY(chandlery.x, chandlery.z);
  colliders.addBox(chandlery.x, chY + 0.55, chandlery.z, 1.1, 0.55, 0.5, chandlery.yaw, { tag: 'chandlery' });
  const msY = beachY(marketStall.x, marketStall.z);
  colliders.addBox(marketStall.x, msY + 0.55, marketStall.z, 1.65, 0.55, 0.5, marketStall.yaw, { tag: 'marketStall' });

  // 6) Casas costeiras, palafitas, varandas e escadas
  for (const h of houses) {
    const cy = Math.cos(h.yaw);
    const sy = Math.sin(h.yaw);
    const toW = (lx, lz) => ({ x: h.x + lx * cy + lz * sy, z: h.z - lx * sy + lz * cy });
    const bot = beachY(h.x, h.z) - 0.6;
    colliders.addBox(h.x, (bot + h.roofTop) / 2, h.z, h.w / 2 + 0.08, (h.roofTop - bot) / 2, h.d / 2 + 0.08, h.yaw, { tag: 'house' });

    if (h.porch) {
      const pd = h.porch.depth;
      const pz0 = h.d / 2;
      const pz1 = h.d / 2 + pd;
      const porchY = h.floorY - 0.05;
      const pc = toW(0, (pz0 + pz1) / 2);
      const gP = beachY(pc.x, pc.z) - 0.5;
      colliders.addBox(pc.x, (porchY + gP) / 2, pc.z, h.w / 2, (porchY - gP) / 2, pd / 2, h.yaw, { walkable: true, solid: true, tag: 'porch' });

      // Escada da varanda
      const gFront = beachY(pc.x, pc.z + pd / 2 + 0.8);
      const nS = Math.max(2, Math.ceil((porchY - gFront) / 0.21));
      const stepRh = (porchY - gFront) / nS;
      const stepTread = 0.28;
      for (let k = 1; k < nS; k++) {
        const top = porchY - k * stepRh;
        const sc = toW(0, pz1 + (k - 0.5) * stepTread);
        const gb = beachY(sc.x, sc.z) - 0.3;
        colliders.addBox(sc.x, (top + gb) / 2, sc.z, 0.62, (top - gb) / 2, stepTread / 2 + 0.02, h.yaw, { walkable: true, solid: true, tag: 'stairs' });
      }
      // Guarda-corpos da varanda deixando vão de entrada no centro
      for (const side of [-1, 1]) {
        const pRail = toW(side * (h.w / 2 + 0.68) / 2, pz1 - 0.1);
        const segW = Math.max(0.2, (h.w / 2 - 0.72) / 2);
        colliders.addBox(pRail.x, porchY + 0.55, pRail.z, segW, 0.55, 0.08, h.yaw, { tag: 'porchRail' });
        const sRail = toW(side * (h.w / 2 - 0.08), (pz0 + pz1) / 2);
        colliders.addBox(sRail.x, porchY + 0.55, sRail.z, 0.08, 0.55, pd / 2, h.yaw, { tag: 'porchRail' });
      }
    }
  }

  // 7) Boathouse e galpões
  {
    const bh = boathouse;
    const cy = Math.cos(bh.yaw);
    const sy = Math.sin(bh.yaw);
    const wallBot = bh.floorY - 0.3;
    const wallTop = bh.floorY + 2.8;
    const toW = (lx, lz) => ({ x: bh.x + lx * cy + lz * sy, z: bh.z - lx * sy + lz * cy });
    const back = toW(0, -bh.d / 2 + 0.08);
    colliders.addBox(back.x, (wallBot + wallTop) / 2, back.z, bh.w / 2, (wallTop - wallBot) / 2, 0.12, bh.yaw, { tag: 'boathouse' });
    for (const sx of [-1, 1]) {
      const sideP = toW(sx * (bh.w / 2 - 0.08), 0);
      colliders.addBox(sideP.x, (wallBot + wallTop) / 2, sideP.z, 0.12, (wallTop - wallBot) / 2, bh.d / 2, bh.yaw, { tag: 'boathouse' });
    }
  }
  for (const sh of sheds) {
    const sy = beachY(sh.x, sh.z);
    colliders.addBox(sh.x, sy + 1.2, sh.z, sh.w / 2 + 0.05, 1.3, sh.d / 2 + 0.05, sh.yaw, { tag: 'shed' });
  }
}

const _layoutCache = new Map();
function obterLayoutVila(vila) {
  if (!vila || typeof vila !== 'object') return null;
  const frame = criarFrameVila(vila);
  const key = `${frame.ox.toFixed(2)}|${frame.baseY.toFixed(2)}|${frame.oz.toFixed(2)}|${frame.dir.toFixed(4)}|${frame.seed}`;
  let entry = _layoutCache.get(key);
  if (!entry) {
    if (_layoutCache.size > 24) {
      const firstKey = _layoutCache.keys().next().value;
      _layoutCache.delete(firstKey);
    }
    const spec = gerarEspecificacaoVila(frame);
    const colliders = new VilaColliders();
    popularColisores(frame, spec, colliders);
    entry = { frame, spec, colliders };
    _layoutCache.set(key, entry);
  }
  return entry;
}

// ---- API Pura Exportada (sem precisar de WebGL no servidor / testes) -----------------------------------------------

export function pontoAtracacaoVila(vila) {
  if (!vila || typeof vila !== 'object') return null;
  const { frame } = obterLayoutVila(vila);
  const { waterY, deckY, dir, ry, toWorldXZ } = frame;
  const berth = toWorldXZ(DIMENSOES_VILA_COSTEIRA.atracacaoLocalX, DIMENSOES_VILA_COSTEIRA.atracacaoLocalZ);
  const cais = toWorldXZ(DIMENSOES_VILA_COSTEIRA.headLargura / 2 - 0.5, DIMENSOES_VILA_COSTEIRA.atracacaoLocalZ);
  const escada = toWorldXZ(DIMENSOES_VILA_COSTEIRA.escadaLocalX, DIMENSOES_VILA_COSTEIRA.escadaLocalZ);
  return {
    x: berth.x,
    y: waterY,
    z: berth.z,
    dir,
    yaw: ry,
    heading: dir,
    deckY,
    pontoCais: { x: cais.x, y: deckY, z: cais.z },
    escada: { x: escada.x, y: deckY, z: escada.z },
  };
}

export function alturaPisoVilaEm(vila, x, z, yPes = Infinity) {
  if (!vila || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const layout = obterLayoutVila(vila);
  if (!layout) return null;
  const { lx, lz } = layout.frame.toLocalXZ(x, z);
  return layout.colliders.groundHeightAt(lx, lz, yPes);
}

export function colideObstaculoVilaEm(vila, x, y, z, raio = 0.32) {
  if (!vila || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  const layout = obterLayoutVila(vila);
  if (!layout) return false;
  const { lx, lz } = layout.frame.toLocalXZ(x, z);
  return layout.colliders.collidesAt(lx, y, lz, raio);
}

export function resolverColisaoVilaEm(vila, pos, raio = 0.32, altura = 1.75) {
  if (!vila || !pos) return { hit: false, nx: 0, nz: 0, pen: 0, tag: '' };
  const layout = obterLayoutVila(vila);
  if (!layout) return { hit: false, nx: 0, nz: 0, pen: 0, tag: '' };
  const isArr = Array.isArray(pos);
  const wx = isArr ? pos[0] : pos.x;
  const wy = isArr ? pos[1] : pos.y;
  const wz = isArr ? pos[2] : pos.z;
  const { lx, lz } = layout.frame.toLocalXZ(wx, wz);
  const local = { x: lx, y: wy, z: lz };
  const res = layout.colliders.resolveLocalCapsule(local, raio, altura);
  if (res.hit) {
    const w = layout.frame.toWorldXZ(local.x, local.z);
    if (isArr) {
      pos[0] = w.x;
      pos[2] = w.z;
    } else {
      pos.x = w.x;
      pos.z = w.z;
    }
    const wnx = res.nx * layout.frame.rx + res.nz * layout.frame.fx;
    const wnz = res.nx * layout.frame.rz + res.nz * layout.frame.fz;
    res.nx = wnx;
    res.nz = wnz;
  }
  return res;
}

export function obterMarcadoresVila(vila) {
  const layout = obterLayoutVila(vila);
  if (!layout) return [];
  const { frame, spec } = layout;
  const { toWorldXZ, beachY, deckY, waterY, dir, id, nome } = frame;
  const ptPlaza = toWorldXZ(spec.plaza.x, spec.plaza.z);
  const ptHead = toWorldXZ(0, (DIMENSOES_VILA_COSTEIRA.pierHeadZ0 + DIMENSOES_VILA_COSTEIRA.pierFimZ) / 2);
  const ptBerth = toWorldXZ(DIMENSOES_VILA_COSTEIRA.atracacaoLocalX, DIMENSOES_VILA_COSTEIRA.atracacaoLocalZ);
  const ptJoe = toWorldXZ(spec.fishStand.x, spec.fishStand.z);
  const ptMarta = toWorldXZ(spec.chandlery.x, spec.chandlery.z);

  return [
    { id: `${id}:vila`, vilaId: id, tipo: 'vila', icone: 'vila', nome, x: ptPlaza.x, y: spec.plaza.y, z: ptPlaza.z, dir },
    { id: `${id}:pier`, vilaId: id, tipo: 'pier', icone: 'anchor', nome: 'Píer da Vila', x: ptHead.x, y: deckY, z: ptHead.z, dir },
    { id: `${id}:atracacao`, vilaId: id, tipo: 'atracacao', icone: 'boat', nome: 'Atracação', x: ptBerth.x, y: waterY, z: ptBerth.z, dir },
    { id: `${id}:joe`, vilaId: id, tipo: 'banca', icone: 'fish', nome: "Joe's Fish Stand", x: ptJoe.x, y: beachY(spec.fishStand.x, spec.fishStand.z), z: ptJoe.z, dir },
    { id: `${id}:marta`, vilaId: id, tipo: 'banca', icone: 'anchor', nome: "Marta's Chandlery", x: ptMarta.x, y: beachY(spec.chandlery.x, spec.chandlery.z), z: ptMarta.z, dir },
  ];
}

// ---- Texturas procedurais PBR em Uint8Array -> THREE.DataTexture (100% compatível com Node e WebGL2) --------------

function makeDataTex(data, w, h, srgb = true, repeat = true) {
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function bakeHeightNormal(hField, w, h, strength) {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ym = (y - 1 + h) % h;
    const yp = (y + 1) % h;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w;
      const xp = (x + 1) % w;
      const dx = (hField[xp + y * w] - hField[xm + y * w]) * strength;
      const dy = (hField[x + yp * w] - hField[x + ym * w]) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1.0;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv;
      ny *= inv;
      nz *= inv;
      const k = (x + y * w) * 4;
      out[k] = clamp(Math.round((nx * 0.5 + 0.5) * 255), 0, 255);
      out[k + 1] = clamp(Math.round((ny * 0.5 + 0.5) * 255), 0, 255);
      out[k + 2] = clamp(Math.round((nz * 0.5 + 0.5) * 255), 0, 255);
      out[k + 3] = 255;
    }
  }
  return out;
}

// Fonte bitmap compacta 5x7 para letreiros pintados à mão sem precisar de DOM Canvas
const GLYPHS = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawBitmapText(buf, W, H, text, x0, y0, scale, color) {
  let cx = x0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toUpperCase();
    const g = GLYPHS[ch] || GLYPHS[' '];
    for (let gy = 0; gy < 7; gy++) {
      const row = g[gy];
      for (let gx = 0; gx < 5; gx++) {
        if (row[gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = Math.round(cx + gx * scale + sx);
            const py = Math.round(y0 + (6 - gy) * scale + sy);
            if (px < 0 || px >= W || py < 0 || py >= H) continue;
            const k = (px + py * W) * 4;
            buf[k] = color[0];
            buf[k + 1] = color[1];
            buf[k + 2] = color[2];
            buf[k + 3] = 255;
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

function criarTexturasEMateriais() {
  const textures = [];
  const materials = [];
  const trackTex = (t) => { textures.push(t); return t; };
  const trackMat = (m) => { materials.push(m); return m; };

  // 1) Madeira desgastada (grãos, anéis, nós, frestas, pregos e variação de tábuas)
  const W = 256;
  const woodAlb = new Uint8Array(W * W * 4);
  const woodH = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const v = y / W;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const warp = fbmPeriodic(u, v, 3, 5, 3, 21) * 0.16;
      const rings = Math.sin((v * 28 + warp * 14) * TAU) * 0.5 + 0.5;
      const fiber = valNoisePeriodic(u * 10, v * 120, 10, 120, 53);
      const blotch = fbmPeriodic(u, v, 3, 4, 3, 81);
      const seam = Math.abs(((v * 6) % 1) - 0.5) > 0.47 ? 1 : 0;
      const knot = worleyPeriodic(u, v, 4, 6, 11);
      const kMask = knot.id > 0.88 ? smoothstep(0.18, 0.04, knot.d1) : 0;
      const crack = valNoisePeriodic(u * 6, v * 48, 6, 48, 71);
      const cMask = crack < 0.14 ? (0.14 - crack) * 4.0 : 0;
      const lum = clamp(0.76 + rings * 0.14 + (fiber - 0.5) * 0.12 + (blotch - 0.5) * 0.10 - seam * 0.28 - kMask * 0.25 - cMask * 0.35, 0.28, 1.0);
      const k = (x + y * W) * 4;
      woodAlb[k] = Math.round(lum * 246);
      woodAlb[k + 1] = Math.round(lum * 241);
      woodAlb[k + 2] = Math.round(lum * 234);
      woodAlb[k + 3] = 255;
      woodH[x + y * W] = lum - seam * 0.35 - cMask * 0.3;
    }
  }
  const woodMap = trackTex(makeDataTex(woodAlb, W, W, true, true));
  const woodNorm = trackTex(makeDataTex(bakeHeightNormal(woodH, W, W, 2.2), W, W, false, true));

  // 2) Telhado metálico corrugado (ondas senoidais + ferrugem pontual + rebites)
  const roofAlb = new Uint8Array(W * W * 4);
  const roofH = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const v = y / W;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const corr = Math.sin(u * 10 * TAU) * 0.5 + 0.5;
      const rust = fbmPeriodic(u, v, 5, 7, 4, 31);
      const rPatch = smoothstep(0.56, 0.78, rust);
      const streak = valNoisePeriodic(u * 32, v * 3, 32, 3, 33);
      const grime = 1 - smoothstep(0.62, 0.9, streak) * (1 - corr) * 0.24;
      const shade = (0.78 + corr * 0.22) * grime;
      const r = clamp(shade * (1 - rPatch * 0.12) + rPatch * 0.08, 0.3, 1);
      const g = clamp(shade * (1 - rPatch * 0.38), 0.2, 1);
      const b = clamp(shade * (1 - rPatch * 0.52), 0.15, 1);
      const k = (x + y * W) * 4;
      roofAlb[k] = Math.round(r * 250);
      roofAlb[k + 1] = Math.round(g * 248);
      roofAlb[k + 2] = Math.round(b * 246);
      roofAlb[k + 3] = 255;
      roofH[x + y * W] = corr * 0.8 + (rPatch - 0.5) * 0.12;
    }
  }
  const roofMap = trackTex(makeDataTex(roofAlb, W, W, true, true));
  const roofNorm = trackTex(makeDataTex(bakeHeightNormal(roofH, W, W, 3.2), W, W, false, true));

  // 3) Sapê de palmeira (camadas sobrepostas + fibras douradas/acinzentadas)
  const thatchAlb = new Uint8Array(W * W * 4);
  const thatchH = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const v = y / W;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const rowPhase = v * 6 + (valNoisePeriodic(u * 4, v * 2, 4, 2, 143) - 0.5) * 0.32;
      const tier = rowPhase - Math.floor(rowPhase);
      const fiber = valNoisePeriodic(u * 120, v * 8, 120, 8, 139);
      const age = fbmPeriodic(u, v, 4, 4, 3, 145);
      const tipShadow = smoothstep(0.0, 0.22, tier);
      const lum = (0.52 + 0.36 * tipShadow + (fiber - 0.5) * 0.24) * (0.86 + age * 0.24);
      const k = (x + y * W) * 4;
      thatchAlb[k] = clamp(Math.round(lum * 228), 0, 255);
      thatchAlb[k + 1] = clamp(Math.round(lum * 195), 0, 255);
      thatchAlb[k + 2] = clamp(Math.round(lum * 134), 0, 255);
      thatchAlb[k + 3] = 255;
      thatchH[x + y * W] = tipShadow * 0.75 + fiber * 0.25;
    }
  }
  const thatchMap = trackTex(makeDataTex(thatchAlb, W, W, true, true));
  const thatchNorm = trackTex(makeDataTex(bakeHeightNormal(thatchH, W, W, 2.5), W, W, false, true));

  // 4) Pedra / Alvenaria rústica caiada
  const stoneAlb = new Uint8Array(W * W * 4);
  const stoneH = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    const v = y / W;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const wx = (fbmPeriodic(u, v, 4, 4, 2, 213) - 0.5) * 0.08;
      const wy = (fbmPeriodic(u, v, 4, 4, 2, 215) - 0.5) * 0.08;
      const w = worleyPeriodic(u + wx, v + wy, 6, 10, 201);
      const edge = w.d2 - w.d1;
      const mortar = 1 - smoothstep(0.035, 0.095, edge);
      const grain = fbmPeriodic(u, v, 16, 16, 3, 203);
      const tone = (0.72 + w.id * 0.24) * (0.88 + grain * 0.22);
      const lum = tone * (1 - mortar) + 0.54 * mortar;
      const k = (x + y * W) * 4;
      stoneAlb[k] = clamp(Math.round(lum * 238), 0, 255);
      stoneAlb[k + 1] = clamp(Math.round(lum * 230), 0, 255);
      stoneAlb[k + 2] = clamp(Math.round(lum * 212), 0, 255);
      stoneAlb[k + 3] = 255;
      stoneH[x + y * W] = smoothstep(0.02, 0.35, edge) * 0.75 + grain * 0.25;
    }
  }
  const stoneMap = trackTex(makeDataTex(stoneAlb, W, W, true, true));
  const stoneNorm = trackTex(makeDataTex(bakeHeightNormal(stoneH, W, W, 2.6), W, W, false, true));

  // 5) Rede de pesca trançada em losango (alpha cutout)
  const N = 128;
  const netAlb = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    const v = y / N;
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const a = (u + v) * 4;
      const b = (u - v) * 4;
      const da = Math.abs((a - Math.floor(a)) - 0.5);
      const db = Math.abs((b - Math.floor(b)) - 0.5);
      const dist = Math.min(0.5 - da, 0.5 - db);
      const knot = Math.hypot(0.5 - da, 0.5 - db);
      const strand = dist < 0.075 || knot < 0.11;
      const shade = strand ? (knot < 0.11 ? 235 : 200) : 0;
      const k = (x + y * N) * 4;
      netAlb[k] = shade;
      netAlb[k + 1] = shade;
      netAlb[k + 2] = shade;
      netAlb[k + 3] = strand ? 255 : 0;
    }
  }
  const netMap = trackTex(makeDataTex(netAlb, N, N, true, true));

  // 6) Atlas de letreiros pintados à mão (Píer, Joe's Fish Stand, Marta's Chandlery, Lousa de preços)
  const SW = 512;
  const SH = 256;
  const signAlb = new Uint8Array(SW * SH * 4);
  for (let y = 0; y < SH; y++) {
    const v = y / SH;
    for (let x = 0; x < SW; x++) {
      const u = x / SW;
      const grain = 0.9 + 0.12 * valNoisePeriodic(u * 12, v * 36, 12, 36, 99);
      let r = 47;
      let g = 140;
      let b = 136;
      if (v < 0.34 && u >= 0.5) {
        // Lousa de preços (ardósia escura)
        r = 38; g = 46; b = 42;
      } else if (v < 0.34 && u < 0.5) {
        // Marta's Chandlery (azul naval desgastado)
        r = 44; g = 74; b = 108;
      } else if (v >= 0.34 && v < 0.67) {
        // Joe's Fish Stand (madeira marrom-clara)
        r = 148; g = 118; b = 82;
      }
      const k = (x + y * SW) * 4;
      signAlb[k] = clamp(Math.round(r * grain), 0, 255);
      signAlb[k + 1] = clamp(Math.round(g * grain), 0, 255);
      signAlb[k + 2] = clamp(Math.round(b * grain), 0, 255);
      signAlb[k + 3] = 255;
    }
  }
  // Borda creme e textos nítidos em cada quadrante (lembrando: v=0 é base, v=1 é topo)
  drawBitmapText(signAlb, SW, SH, 'PORTO DO PIER', 34, Math.round(SH * 0.78), 5, [242, 238, 224]);
  drawBitmapText(signAlb, SW, SH, "JOE'S FISH STAND", 22, Math.round(SH * 0.46), 4, [246, 240, 222]);
  drawBitmapText(signAlb, SW, SH, "MARTA'S", 18, Math.round(SH * 0.18), 3, [244, 236, 208]);
  drawBitmapText(signAlb, SW, SH, 'GEAR & FUEL', 14, Math.round(SH * 0.06), 2, [238, 198, 108]);
  drawBitmapText(signAlb, SW, SH, 'PEIXE FRESCO', 274, Math.round(SH * 0.21), 2, [238, 242, 232]);
  drawBitmapText(signAlb, SW, SH, 'ISCA & GELO', 274, Math.round(SH * 0.09), 2, [244, 214, 128]);
  const signMap = trackTex(makeDataTex(signAlb, SW, SH, true, false));

  const mats = {
    wood: trackMat(new THREE.MeshStandardMaterial({
      map: woodMap,
      normalMap: woodNorm,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.86,
      metalness: 0.02,
      vertexColors: true,
    })),
    roofMetal: trackMat(new THREE.MeshStandardMaterial({
      map: roofMap,
      normalMap: roofNorm,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.58,
      metalness: 0.34,
      vertexColors: true,
    })),
    thatch: trackMat(new THREE.MeshStandardMaterial({
      map: thatchMap,
      normalMap: thatchNorm,
      normalScale: new THREE.Vector2(0.65, 0.65),
      roughness: 0.94,
      metalness: 0.0,
      vertexColors: true,
    })),
    stone: trackMat(new THREE.MeshStandardMaterial({
      map: stoneMap,
      normalMap: stoneNorm,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.92,
      metalness: 0.0,
      vertexColors: true,
    })),
    hard: trackMat(new THREE.MeshStandardMaterial({
      roughness: 0.46,
      metalness: 0.38,
      vertexColors: true,
    })),
    rope: trackMat(new THREE.MeshStandardMaterial({
      map: woodMap,
      roughness: 0.92,
      metalness: 0.0,
      vertexColors: true,
    })),
    net: trackMat(new THREE.MeshStandardMaterial({
      map: netMap,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0.0,
      vertexColors: true,
    })),
    fabric: trackMat(new THREE.MeshStandardMaterial({
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0.0,
      vertexColors: true,
    })),
    sign: trackMat(new THREE.MeshStandardMaterial({
      map: signMap,
      roughness: 0.74,
      metalness: 0.04,
      vertexColors: true,
    })),
    windowGlass: trackMat(new THREE.MeshStandardMaterial({
      color: 0x3b4852,
      emissive: new THREE.Color(0xffb45c),
      emissiveIntensity: 0,
      roughness: 0.14,
      metalness: 0.12,
      vertexColors: true,
    })),
    lanternGlass: trackMat(new THREE.MeshStandardMaterial({
      color: 0xfff0d0,
      emissive: new THREE.Color(0xffaa44),
      emissiveIntensity: 0,
      roughness: 0.25,
      metalness: 0.05,
      vertexColors: true,
    })),
  };

  return { mats, textures, materials };
}

// ---- Construtor de geometria mesclada (GeoBuilder compacto para Three.js r187) ------------------------------------

const _m4 = new THREE.Matrix4();
const _m3 = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);
const _UP = new THREE.Vector3(0, 1, 0);

function boxPart(sx, sy, sz, grain = -1, skip = 0) {
  const s = [sx, sy, sz];
  let g = grain;
  if (g < 0) g = sx >= sy && sx >= sz ? 0 : (sy >= sz ? 1 : 2);
  const p = [];
  const n = [];
  const uv = [];
  const idx = [];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let k = 0; k < 3; k++) {
    for (let si = 0; si < 2; si++) {
      const sign = si === 0 ? 1 : -1;
      if (skip & (1 << (k * 2 + si))) continue;
      const a = (k + 1) % 3;
      const b = (k + 2) % 3;
      let ua = a;
      let va = b;
      if (g === b) { ua = b; va = a; }
      const base = p.length / 3;
      for (const [ca, cb] of corners) {
        const v = [0, 0, 0];
        v[k] = sign * s[k] / 2;
        v[a] = ca * s[a] / 2;
        v[b] = cb * s[b] / 2;
        p.push(v[0], v[1], v[2]);
        const nn = [0, 0, 0];
        nn[k] = sign;
        n.push(nn[0], nn[1], nn[2]);
        uv.push((v[ua] + s[ua] / 2) * 0.65, (v[va] + s[va] / 2) * 0.65);
      }
      if (sign > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  return { p, n, uv, idx };
}

function quadUVPart(w, h, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
  return {
    p: [-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0],
    n: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    uv: [u0, v0, u1, v0, u1, v1, u0, v1],
    idx: [0, 1, 2, 0, 2, 3],
  };
}

function gridPart(cols, rows, fn) {
  const p = [];
  const n = [];
  const uv = [];
  const idx = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const v = fn(i, j);
      p.push(v.p[0], v.p[1], v.p[2]);
      let nx = v.n[0];
      let ny = v.n[1];
      let nz = v.n[2];
      const nl = Math.hypot(nx, ny, nz);
      if (!Number.isFinite(nl) || nl < 1e-6) {
        nx = 0;
        ny = 1;
        nz = 0;
      } else {
        nx /= nl;
        ny /= nl;
        nz /= nl;
      }
      n.push(nx, ny, nz);
      uv.push(v.uv[0], v.uv[1]);
    }
  }
  const W = cols + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * W + i;
      const b = a + 1;
      const c = a + W;
      const d = c + 1;
      _a.set(p[a * 3], p[a * 3 + 1], p[a * 3 + 2]);
      _b.set(p[b * 3], p[b * 3 + 1], p[b * 3 + 2]);
      _c.set(p[d * 3], p[d * 3 + 1], p[d * 3 + 2]);
      _d.set(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]);
      const e1 = _b.clone().sub(_a);
      const e2 = _c.clone().sub(_a);
      const e3 = _d.clone().sub(_a);
      const fn1 = e1.cross(e2).add(e2.cross(e3));
      const dot = fn1.x * n[a * 3] + fn1.y * n[a * 3 + 1] + fn1.z * n[a * 3 + 2];
      if (dot >= 0) idx.push(a, b, d, a, d, c);
      else idx.push(a, d, b, a, c, d);
    }
  }
  return { p, n, uv, idx };
}

function cylPart(rTop, rBot, h, segs = 8, capTop = true, capBot = false, swapUV = false) {
  const p = [];
  const n = [];
  const uv = [];
  const idx = [];
  const slope = (rBot - rTop) / (h || 1);
  const nl = Math.hypot(1, slope);
  const rAvg = (rTop + rBot) / 2;
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * TAU;
    const c = Math.cos(t);
    const s = Math.sin(t);
    for (let j = 0; j < 2; j++) {
      const r = j ? rTop : rBot;
      const y = j ? h : 0;
      p.push(c * r, y, s * r);
      n.push(c / nl, slope / nl, s / nl);
      const U = y * 0.65;
      const V = t * rAvg * 0.65;
      if (swapUV) uv.push(V, U);
      else uv.push(U, V);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const cap = (y, r, up) => {
    if (r <= 0) return;
    const base = p.length / 3;
    p.push(0, y, 0);
    n.push(0, up ? 1 : -1, 0);
    uv.push(0.5, 0.5);
    for (let i = 0; i <= segs; i++) {
      const t = (i / segs) * TAU;
      p.push(Math.cos(t) * r, y, Math.sin(t) * r);
      n.push(0, up ? 1 : -1, 0);
      uv.push(0.5 + Math.cos(t) * 0.3, 0.5 + Math.sin(t) * 0.3);
    }
    for (let i = 0; i < segs; i++) {
      if (up) idx.push(base, base + 2 + i, base + 1 + i);
      else idx.push(base, base + 1 + i, base + 2 + i);
    }
  };
  if (capTop) cap(h, rTop, true);
  if (capBot) cap(0, rBot, false);
  return { p, n, uv, idx };
}

function lathePart(profile, segs = 12) {
  const m = profile.length;
  const pn = [];
  const segN = (i) => {
    const dr = profile[i + 1][0] - profile[i][0];
    const dy = profile[i + 1][1] - profile[i][1];
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  };
  for (let i = 0; i < m; i++) {
    let nr = 0;
    let ny = 0;
    if (i < m - 1) { const s = segN(i); nr += s[0]; ny += s[1]; }
    if (i > 0) { const s = segN(i - 1); nr += s[0]; ny += s[1]; }
    const l = Math.hypot(nr, ny) || 1;
    pn.push([nr / l, ny / l]);
  }
  return gridPart(m - 1, segs, (i, j) => {
    const t = (j / segs) * TAU;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const [r, y] = profile[i];
    const [nr, ny] = pn[i];
    return { p: [c * r, y, s * r], n: [c * nr, ny, s * nr], uv: [i / Math.max(1, m - 1), j / segs] };
  });
}

function torusPart(R, r, radial = 5, tubular = 12, arc = TAU) {
  return gridPart(tubular, radial, (i, j) => {
    const phi = (i / tubular) * arc;
    const psi = (j / radial) * TAU;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const cs = Math.cos(psi);
    const ss = Math.sin(psi);
    return {
      p: [(R + r * cs) * cp, r * ss, (R + r * cs) * sp],
      n: [cs * cp, ss, cs * sp],
      uv: [phi * R, psi * r],
    };
  });
}

function tubePart(points, radius, radial = 5) {
  const m = points.length;
  const T = [];
  const N = [];
  const Bn = [];
  for (let i = 0; i < m; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(m - 1, i + 1)];
    T.push(b.clone().sub(a).normalize());
  }
  let n0 = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  n0 = n0.sub(T[0].clone().multiplyScalar(n0.dot(T[0]))).normalize();
  N.push(n0);
  Bn.push(T[0].clone().cross(n0));
  for (let i = 1; i < m; i++) {
    const prev = N[i - 1];
    const nn = prev.clone().sub(T[i].clone().multiplyScalar(prev.dot(T[i])));
    if (nn.lengthSq() < 1e-8) nn.copy(prev);
    nn.normalize();
    N.push(nn);
    Bn.push(T[i].clone().cross(nn));
  }
  const len = [0];
  for (let i = 1; i < m; i++) len.push(len[i - 1] + points[i].distanceTo(points[i - 1]));
  return gridPart(radial, m - 1, (i, j) => {
    const t = (i / radial) * TAU;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const nx = N[j].x * c + Bn[j].x * s;
    const ny = N[j].y * c + Bn[j].y * s;
    const nz = N[j].z * c + Bn[j].z * s;
    const P = points[j];
    return { p: [P.x + nx * radius, P.y + ny * radius, P.z + nz * radius], n: [nx, ny, nz], uv: [len[j] * 0.65, t * radius * 0.65] };
  });
}

function slabPart(pts, thickness, uDir = null, upHint = null) {
  const m = pts.length;
  const nrm = new THREE.Vector3();
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % m];
    nrm.x += (a.y - b.y) * (a.z + b.z);
    nrm.y += (a.z - b.z) * (a.x + b.x);
    nrm.z += (a.x - b.x) * (a.y + b.y);
  }
  nrm.normalize();
  if (upHint && nrm.dot(upHint) < 0) {
    pts = pts.slice().reverse();
    nrm.negate();
  }
  const u = (uDir ? uDir.clone() : pts[1].clone().sub(pts[0]));
  u.sub(nrm.clone().multiplyScalar(u.dot(nrm))).normalize();
  const v = nrm.clone().cross(u);
  const off = nrm.clone().multiplyScalar(-thickness);
  const p = [];
  const n = [];
  const uv = [];
  const idx = [];
  let uMin = Infinity;
  let vMin = Infinity;
  for (const q of pts) {
    uMin = Math.min(uMin, q.dot(u));
    vMin = Math.min(vMin, q.dot(v));
  }
  const o = u.clone().multiplyScalar(uMin).add(v.clone().multiplyScalar(vMin));
  let base = 0;
  for (const q of pts) {
    p.push(q.x, q.y, q.z);
    n.push(nrm.x, nrm.y, nrm.z);
    _p.copy(q).sub(o);
    uv.push(_p.dot(u) * 0.65, _p.dot(v) * 0.65);
  }
  for (let i = 1; i < m - 1; i++) idx.push(base, base + i, base + i + 1);
  if (thickness > 0) {
    base = p.length / 3;
    for (const q of pts) {
      p.push(q.x + off.x, q.y + off.y, q.z + off.z);
      n.push(-nrm.x, -nrm.y, -nrm.z);
      _p.copy(q).sub(o);
      uv.push(_p.dot(u) * 0.65, _p.dot(v) * 0.65);
    }
    for (let i = 1; i < m - 1; i++) idx.push(base, base + i + 1, base + i);
    for (let i = 0; i < m; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % m];
      const e = b.clone().sub(a);
      const L = e.length();
      const sn = e.cross(nrm).normalize();
      base = p.length / 3;
      p.push(a.x, a.y, a.z, b.x, b.y, b.z, b.x + off.x, b.y + off.y, b.z + off.z, a.x + off.x, a.y + off.y, a.z + off.z);
      for (let k = 0; k < 4; k++) n.push(sn.x, sn.y, sn.z);
      uv.push(0, 0, 0, L * 0.65, thickness * 0.65, L * 0.65, thickness * 0.65, 0);
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const part = { p, n, uv, idx };
  for (let t = 0; t < idx.length; t += 3) {
    const i0 = idx[t];
    const i1 = idx[t + 1];
    const i2 = idx[t + 2];
    _a.set(p[i0 * 3], p[i0 * 3 + 1], p[i0 * 3 + 2]);
    _b.set(p[i1 * 3], p[i1 * 3 + 1], p[i1 * 3 + 2]);
    _c.set(p[i2 * 3], p[i2 * 3 + 1], p[i2 * 3 + 2]);
    _b.sub(_a);
    _c.sub(_a);
    _b.cross(_c);
    const nx = n[i0 * 3] + n[i1 * 3] + n[i2 * 3];
    const ny = n[i0 * 3 + 1] + n[i1 * 3 + 1] + n[i2 * 3 + 1];
    const nz = n[i0 * 3 + 2] + n[i1 * 3 + 2] + n[i2 * 3 + 2];
    if (_b.x * nx + _b.y * ny + _b.z * nz < 0) {
      idx[t + 1] = i2;
      idx[t + 2] = i1;
    }
  }
  return part;
}

function sagPoints(a, b, sag, n = 8) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new THREE.Vector3(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
      a[2] + (b[2] - a[2]) * t,
    ));
  }
  return pts;
}

class Batch {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.vcount = 0;
  }

  add(part, m, tint, waterY = null) {
    _m3.getNormalMatrix(m);
    const e = m.elements;
    const ne = _m3.elements;
    const P = part.p;
    const N = part.n;
    const U = part.uv;
    const base = this.vcount;
    const tintFn = typeof tint === 'function';
    const nv = P.length / 3;
    for (let i = 0; i < nv; i++) {
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      this.pos.push(wx, wy, wz);
      const nx = N[i * 3];
      const ny = N[i * 3 + 1];
      const nz = N[i * 3 + 2];
      let tx = ne[0] * nx + ne[3] * ny + ne[6] * nz;
      let ty = ne[1] * nx + ne[4] * ny + ne[7] * nz;
      let tz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      let l = Math.hypot(tx, ty, tz);
      if (!Number.isFinite(l) || l < 1e-6) {
        tx = 0;
        ty = 1;
        tz = 0;
        l = 1;
      }
      this.nrm.push(tx / l, ty / l, tz / l);
      this.uv.push(U[i * 2], U[i * 2 + 1]);
      const t = tintFn ? tint(x, y, z, i) : tint;
      let cr = t[0];
      let cg = t[1];
      let cb = t[2];
      // Zona de maré (algas verdes/escuras e madeira molhada perto do nível da água)
      if (waterY !== null && wy < waterY + 0.85) {
        const wet = 1 - smoothstep(waterY + 0.2, waterY + 0.85, wy);
        const algae = 1 - smoothstep(waterY - 0.15, waterY + 0.45, wy);
        cr *= 1 - 0.48 * wet;
        cg *= 1 - 0.36 * wet;
        cb *= 1 - 0.54 * wet;
        cr = cr * (1 - algae * 0.55) + 0.04 * algae * 0.55;
        cg = cg * (1 - algae * 0.55) + 0.09 * algae * 0.55;
        cb = cb * (1 - algae * 0.55) + 0.03 * algae * 0.55;
      }
      this.col.push(cr, cg, cb);
    }
    const flip = m.determinant() < 0;
    const I = part.idx;
    for (let k = 0; k < I.length; k += 3) {
      if (flip) this.idx.push(base + I[k], base + I[k + 2], base + I[k + 1]);
      else this.idx.push(base + I[k], base + I[k + 1], base + I[k + 2]);
    }
    this.vcount += nv;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    const Idx = this.vcount > 65535 ? THREE.Uint32BufferAttribute : THREE.Uint16BufferAttribute;
    g.setIndex(new Idx(this.idx, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function mat4(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _d.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _d);
}

class Builder {
  constructor(waterY = null) {
    this.waterY = waterY;
    this.batches = {};
    this.frame = new THREE.Matrix4();
    this.stack = [];
  }

  batch(key) {
    return this.batches[key] || (this.batches[key] = new Batch());
  }

  push(m) {
    this.stack.push(this.frame);
    this.frame = this.frame.clone().multiply(m);
    return this;
  }

  pushAt(x, y, z, ry = 0, rx = 0, rz = 0) {
    return this.push(mat4(x, y, z, ry, rx, rz));
  }

  pop() {
    this.frame = this.stack.pop();
    return this;
  }

  toWorld(x, y, z, out = new THREE.Vector3()) {
    return out.set(x, y, z).applyMatrix4(this.frame);
  }

  add(key, part, local, tint, applyTidal = false) {
    _m4.multiplyMatrices(this.frame, local);
    this.batch(key).add(part, _m4, tint || [1, 1, 1], applyTidal ? this.waterY : null);
  }

  box(key, x, y, z, sx, sy, sz, o = {}) {
    const part = boxPart(sx, sy, sz, o.grain ?? -1, o.skip ?? 0);
    this.add(key, part, mat4(x, y, z, o.ry || 0, o.rx || 0, o.rz || 0, o.sx ?? 1, o.sy ?? 1, o.sz ?? 1), o.tint, o.tidal);
  }

  cyl(key, x, y, z, rTop, rBot, h, o = {}) {
    const part = cylPart(rTop, rBot, h, o.segs ?? 8, o.capTop ?? true, o.capBot ?? false, o.swapUV ?? false);
    this.add(key, part, mat4(x, y, z, o.ry || 0, o.rx || 0, o.rz || 0), o.tint, o.tidal);
  }

  lathe(key, x, y, z, profile, o = {}) {
    const part = lathePart(profile, o.segs ?? 10);
    this.add(key, part, mat4(x, y, z, o.ry || 0, o.rx || 0, o.rz || 0), o.tint, o.tidal);
  }

  torus(key, x, y, z, R, r, o = {}) {
    const part = torusPart(R, r, o.radial ?? 5, o.tubular ?? 12, o.arc ?? TAU);
    this.add(key, part, mat4(x, y, z, o.ry || 0, o.rx || 0, o.rz || 0), o.tint, o.tidal);
  }

  part(key, part, x, y, z, o = {}) {
    this.add(key, part, mat4(x, y, z, o.ry || 0, o.rx || 0, o.rz || 0), o.tint, o.tidal);
  }

  beam(key, p0, p1, w, h, o = {}) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const L = _a.length();
    if (L < 1e-5) return;
    _a.divideScalar(L);
    const up = Math.abs(_a.y) > 0.98 ? _X : _Y;
    _c.crossVectors(_a, up).normalize();
    _b.crossVectors(_c, _a).normalize();
    if (o.roll) {
      const cr = Math.cos(o.roll);
      const sr = Math.sin(o.roll);
      const by = _b.clone();
      const bz = _c.clone();
      _b.copy(by).multiplyScalar(cr).addScaledVector(bz, sr);
      _c.copy(bz).multiplyScalar(cr).addScaledVector(by, -sr);
    }
    const m = new THREE.Matrix4().makeBasis(_a, _b, _c);
    m.setPosition((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2);
    const part = boxPart(L + (o.extend || 0), h, w, 0, o.skip ?? 0);
    this.add(key, part, m, o.tint, o.tidal);
  }

  rod(key, p0, p1, r0, r1 = r0, o = {}) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const L = _a.length();
    if (L < 1e-5) return;
    _a.divideScalar(L);
    _q.setFromUnitVectors(_Y, _a);
    const m = new THREE.Matrix4().compose(_p.set(p0[0], p0[1], p0[2]), _q, _s);
    const part = cylPart(r1, r0, L, o.segs ?? 6, o.capTop ?? true, o.capBot ?? false, false);
    this.add(key, part, m, o.tint, o.tidal);
  }

  tube(key, points, radius, o = {}) {
    const part = tubePart(points, radius, o.radial ?? 4);
    this.add(key, part, new THREE.Matrix4(), o.tint, o.tidal);
  }

  slab(key, pts, thickness, o = {}) {
    const part = slabPart(pts, thickness, o.uDir || null, o.up || null);
    this.add(key, part, new THREE.Matrix4(), o.tint, o.tidal);
  }
}

// ---- Emissores de adereços portuários e da vila -------------------------------------------------------------------

function woodTone(rand, base = C.woodRaw) {
  let k = rand.range(0.84, 1.1);
  const r = rand.next();
  if (r < 0.12) k *= rand.range(0.72, 0.85);
  else if (r > 0.92) k *= rand.range(1.08, 1.18);
  const w = rand.range(-0.02, 0.05);
  return [base[0] * k * (1 + w), base[1] * k, base[2] * k * (1 - w * 1.1)];
}

function addLanternGeo(B, x, y, z, scale = 1) {
  const s = scale;
  B.torus('hard', x, y - 0.02 * s, z, 0.02 * s, 0.005 * s, { rx: Math.PI / 2, radial: 3, tubular: 6, tint: C.iron });
  B.cyl('hard', x, y - 0.13 * s, z, 0.02 * s, 0.12 * s, 0.1 * s, { segs: 6, capTop: true, capBot: true, tint: C.iron });
  B.cyl('hard', x, y - 0.155 * s, z, 0.125 * s, 0.125 * s, 0.025 * s, { segs: 6, capBot: true, tint: C.iron });
  const gy = y - 0.355 * s;
  B.cyl('lanternGlass', x, gy, z, 0.082 * s, 0.072 * s, 0.2 * s, { segs: 6, capTop: false, tint: C.glassWarm });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    B.box('hard', x + Math.cos(a) * 0.085 * s, gy + 0.1 * s, z + Math.sin(a) * 0.085 * s, 0.014 * s, 0.2 * s, 0.014 * s, { tint: C.iron });
  }
  B.cyl('hard', x, gy - 0.04 * s, z, 0.1 * s, 0.07 * s, 0.04 * s, { segs: 6, capBot: true, tint: C.iron });
}

function addWallLantern(B, x, y, z) {
  B.box('hard', x, y, z + 0.01, 0.08, 0.16, 0.02, { tint: C.iron });
  B.rod('hard', [x, y + 0.02, z + 0.01], [x, y + 0.05, z + 0.2], 0.01, 0.01, { segs: 5, tint: C.iron });
  addLanternGeo(B, x, y + 0.05, z + 0.2, 0.75);
}

function addPathLight(B, x, y, z, rand) {
  B.box('wood', x, y + 0.55, z, 0.12, 1.1, 0.12, { grain: 1, tint: woodTone(rand) });
  B.box('wood', x, y + 1.12, z, 0.16, 0.04, 0.16, { grain: 0, tint: woodTone(rand) });
  const gy = y + 1.14;
  B.cyl('hard', x, gy, z, 0.07, 0.07, 0.03, { segs: 8, capBot: true, tint: C.iron });
  B.cyl('lanternGlass', x, gy + 0.03, z, 0.058, 0.058, 0.15, { segs: 8, capTop: false, tint: C.glassWarm });
  B.cyl('hard', x, gy + 0.18, z, 0.015, 0.1, 0.07, { segs: 8, capBot: true, tint: C.iron });
}

function addHungLampPost(B, hangList, x, y, z, armYaw, h, rand) {
  const pc = lin(0xd6cfbd);
  B.box('wood', x, y + h / 2, z, 0.14, h, 0.14, { grain: 1, tint: pc });
  B.box('wood', x, y + h + 0.03, z, 0.18, 0.06, 0.18, { grain: 0, tint: pc });
  B.pushAt(x, y, z, armYaw);
  const ay = h - 0.18;
  B.box('hard', 0, ay, 0.35, 0.035, 0.035, 0.62, { tint: C.iron });
  B.rod('hard', [0, ay - 0.35, 0.075], [0, ay - 0.01, 0.4], 0.012, 0.012, { segs: 5, tint: C.iron });
  B.torus('hard', 0, ay - 0.08, 0.2, 0.08, 0.008, { ry: Math.PI / 2, rz: Math.PI / 2, radial: 3, tubular: 8, tint: C.iron });
  B.torus('hard', 0, ay - 0.03, 0.6, 0.014, 0.004, { ry: Math.PI / 2, radial: 3, tubular: 6, tint: C.iron });
  const hook = B.toWorld(0, ay - 0.04, 0.6);
  B.pop();
  const LB = new Builder();
  const pitch = 0.03;
  const n = 5;
  for (let i = 0; i < n; i++) {
    LB.torus('hard', 0, -0.012 - i * pitch, 0, 0.012, 0.0032, { ry: i % 2 ? Math.PI / 2 : 0, radial: 3, tubular: 6, tint: C.iron });
  }
  addLanternGeo(LB, 0, -n * pitch, 0, 1.0);
  hangList.push({ pivot: hook, builder: LB, t: rand.range(0, 50), ph: rand.range(0, TAU), x: 0, z: 0, vx: 0, vz: 0 });
}

function addBollard(B, x, y, z) {
  B.lathe('hard', x, y, z, [
    [0.0, 0.0], [0.21, 0.0], [0.21, 0.045], [0.14, 0.075], [0.115, 0.14],
    [0.11, 0.3], [0.125, 0.37], [0.175, 0.41], [0.18, 0.45], [0.14, 0.49], [0.0, 0.5],
  ], { segs: 12, tint: C.iron });
}

function addCleat(B, x, y, z, ry = 0) {
  B.pushAt(x, y, z, ry);
  B.box('hard', 0, 0.012, 0, 0.26, 0.024, 0.09, { tint: C.iron });
  B.box('hard', -0.065, 0.055, 0, 0.05, 0.07, 0.055, { tint: C.iron });
  B.box('hard', 0.065, 0.055, 0, 0.05, 0.07, 0.055, { tint: C.iron });
  B.rod('hard', [0, 0.1, 0], [0.2, 0.1, 0], 0.026, 0.013, { segs: 7, tint: C.iron });
  B.rod('hard', [0, 0.1, 0], [-0.2, 0.1, 0], 0.026, 0.013, { segs: 7, tint: C.iron });
  B.pop();
}

function addTireFender(B, x, yTop, z, ry = 0, drop = 0.7) {
  B.pushAt(x, 0, z, ry);
  const cy = yTop - drop;
  B.torus('hard', 0.12, cy, 0, 0.27, 0.1, { rz: Math.PI / 2, radial: 6, tubular: 14, tint: C.rubber, tidal: true });
  B.tube('rope', sagPoints([-0.05, yTop + 0.02, 0], [0.12, cy + 0.33, 0], 0.02, 4), 0.016, { tint: C.rope });
  B.pop();
}

function addRopeCoil(B, x, y, z, r0 = 0.08, r1 = 0.28, turns = 4, tint = C.rope) {
  const pts = [];
  const n = turns * 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = t * turns * TAU;
    const r = r0 + (r1 - r0) * t;
    pts.push(new THREE.Vector3(x + Math.cos(a) * r, y + 0.02, z + Math.sin(a) * r));
  }
  const last = pts[pts.length - 1];
  pts.push(new THREE.Vector3(last.x + 0.22, y + 0.02, last.z + 0.24));
  B.tube('rope', pts, 0.018, { radial: 4, tint });
}

function addRopeLoop(B, x, y, z, R, tailTo = null) {
  B.torus('rope', x, y, z, R, 0.022, { rx: 0.18, rz: 0.1, radial: 5, tubular: 12, tint: C.rope });
  if (tailTo) B.tube('rope', sagPoints([x + R * 0.8, y - 0.02, z], tailTo, 0.15, 7), 0.02, { tint: C.rope });
}

function addLifeRing(B, x, y, z, ry = 0) {
  B.pushAt(x, y, z, ry);
  B.torus('hard', 0, 0, 0, 0.29, 0.06, {
    rx: Math.PI / 2,
    radial: 7,
    tubular: 18,
    tint: (px, py, pz) => (Math.floor((Math.atan2(pz, px) + Math.PI) / (Math.PI / 4) + 0.5) % 2 ? C.white : C.orange),
  });
  B.torus('rope', 0, 0, 0, 0.345, 0.012, { rx: Math.PI / 2, radial: 4, tubular: 18, tint: C.white });
  B.pop();
}

function addBench(B, x, y, z, ry = 0, len = 1.6, paint = null, rand) {
  B.pushAt(x, y, z, ry);
  const tint = paint || woodTone(rand);
  for (let i = 0; i < 3; i++) B.box('wood', 0, 0.44, -0.13 + i * 0.13, len, 0.04, 0.11, { grain: 0, tint });
  for (const sx of [-len / 2 + 0.15, len / 2 - 0.15]) {
    B.box('wood', sx, 0.21, -0.13, 0.07, 0.42, 0.07, { grain: 1, tint });
    B.box('wood', sx, 0.21, 0.13, 0.07, 0.42, 0.07, { grain: 1, tint });
    B.box('wood', sx, 0.4, 0, 0.06, 0.05, 0.4, { grain: 2, tint });
    B.beam('wood', [sx, 0.42, -0.2], [sx, 0.9, -0.28], 0.06, 0.05, { tint });
  }
  B.box('wood', 0, 0.68, -0.245, len, 0.1, 0.03, { grain: 0, rx: -0.16, tint });
  B.box('wood', 0, 0.84, -0.27, len, 0.1, 0.03, { grain: 0, rx: -0.16, tint });
  B.pop();
}

function addBucket(B, x, y, z, tint = C.blue) {
  B.lathe('hard', x, y, z, [
    [0.0, 0.0], [0.1, 0.0], [0.135, 0.28], [0.142, 0.295], [0.13, 0.29], [0.095, 0.03], [0.0, 0.03],
  ], { segs: 10, tint });
  B.torus('hard', x, y + 0.29, z, 0.14, 0.006, { rz: Math.PI / 2, arc: Math.PI, radial: 4, tubular: 10, tint: C.galv });
}

function addBarrel(B, x, y, z, rand) {
  const tone = woodTone(rand);
  const prof = [];
  for (let i = 0; i <= 6; i++) {
    const yy = (i / 6) * 0.88;
    prof.push([0.25 + 0.035 * Math.sin(Math.PI * yy / 0.88), yy]);
  }
  B.lathe('wood', x, y, z, prof, { segs: 12, tint: tone });
  B.cyl('wood', x, y + 0.82, z, 0.255, 0.255, 0.015, { segs: 12, capTop: true, tint: tone });
  for (const hy of [0.08, 0.26, 0.62, 0.8]) {
    const r = 0.25 + 0.035 * Math.sin(Math.PI * hy / 0.88) + 0.004;
    B.cyl('hard', x, y + hy - 0.025, z, r, r, 0.048, { segs: 12, capTop: false, tint: C.iron });
  }
}

function addCrate(B, x, y, z, ry, rand) {
  const w = 0.62;
  const d = 0.42;
  const h = 0.4;
  B.pushAt(x, y, z, ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    B.box('wood', sx * (w / 2 - 0.02), h / 2, sz * (d / 2 - 0.02), 0.04, h, 0.04, { grain: 1, tint: woodTone(rand) });
  }
  for (let i = 0; i < 3; i++) {
    const yy = 0.07 + i * 0.13;
    for (const sz of [-1, 1]) B.box('wood', 0, yy, sz * (d / 2 - 0.005), w - 0.02, 0.09, 0.012, { grain: 0, tint: woodTone(rand) });
    for (const sx of [-1, 1]) B.box('wood', sx * (w / 2 - 0.005), yy, 0, 0.012, 0.09, d - 0.02, { grain: 2, tint: woodTone(rand) });
  }
  B.box('wood', 0, 0.015, 0, w - 0.03, 0.02, d - 0.03, { grain: 0, tint: woodTone(rand) });
  for (let i = 0; i < 3; i++) B.box('wood', 0, h - 0.01, -d / 2 + 0.08 + i * 0.13, w, 0.018, 0.09, { grain: 0, tint: woodTone(rand) });
  B.pop();
}

function addTrap(B, x, y, z, ry, rand) {
  const L = 0.9;
  const W = 0.5;
  const R = 0.25;
  B.pushAt(x, y, z, ry);
  for (const sz of [-1, 1]) B.box('wood', 0, 0.025, sz * (W / 2 - 0.02), L, 0.05, 0.04, { grain: 0, tint: woodTone(rand) });
  for (let i = 0; i < 5; i++) B.box('wood', 0, 0.052, -W / 2 + 0.06 + i * 0.095, L - 0.04, 0.012, 0.06, { grain: 0, tint: woodTone(rand) });
  for (const sx of [-L / 2 + 0.03, 0, L / 2 - 0.03]) {
    B.torus('wood', sx, 0.05, 0, R - 0.01, 0.014, { rx: -Math.PI / 2, rz: Math.PI / 2, arc: Math.PI, radial: 3, tubular: 8, tint: woodTone(rand) });
  }
  for (let i = 0; i < 7; i++) {
    const a = ((i + 0.5) / 7) * Math.PI;
    const yy = 0.05 + Math.sin(a) * (R - 0.005);
    const zz = Math.cos(a) * (R - 0.005);
    B.box('wood', 0, yy, zz, L - 0.02, 0.012, 0.045, { grain: 0, rx: -(a - Math.PI / 2), tint: woodTone(rand) });
  }
  for (const sx of [-L / 2 + 0.03, L / 2 - 0.03]) {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * Math.PI;
      pts.push(new THREE.Vector3(sx, 0.05 + Math.sin(a) * (R - 0.01), Math.cos(a) * (R - 0.01)));
    }
    B.slab('net', pts, 0.0, { up: new THREE.Vector3(0, 0, 1), uDir: new THREE.Vector3(1, 0, 0), tint: lin(0x4a6a58) });
  }
  B.tube('rope', sagPoints([-0.1, 0.05 + R, 0], [0.1, 0.05 + R, 0], -0.1, 5), 0.01, { radial: 4, tint: C.ropeBlue });
  B.pop();
}

function addBuoy(B, x, y, z, colA, colB, kind = 0, o = {}) {
  B.pushAt(x, y, z, o.ry || 0, o.rx || 0, o.rz || 0);
  if (kind === 0) {
    B.lathe('hard', 0, 0, 0, [[0.0, 0.0], [0.08, 0.025], [0.125, 0.12], [0.1, 0.25], [0.04, 0.305], [0.0, 0.31]], {
      segs: 8,
      tint: (px, py) => (py > 0.15 ? colA : colB),
    });
  } else {
    B.lathe('hard', 0, 0, 0, [[0.0, 0.0], [0.08, 0.03], [0.09, 0.12], [0.0, 0.2]], { segs: 7, tint: colA });
  }
  B.pop();
}

function addBuoyString(B, a, b, count, rand, sag = 0.25) {
  const pts = sagPoints(a, b, sag, 10);
  B.tube('rope', pts, 0.01, { radial: 4, tint: C.rope });
  const pal = [[C.orange, C.white], [C.red, C.white], [C.yellow, C.black], [C.white, C.blue], [C.green, C.yellow]];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const p = pts[Math.round(t * 10)];
    const [ca, cb] = rand.pick(pal);
    addBuoy(B, p.x, p.y - 0.32, p.z, ca, cb, rand.chance(0.5) ? 0 : 2, { rz: rand.range(-0.15, 0.15) });
  }
}

function addSimpleFish(B, x, y, z, len = 0.36, ry = 0, tint = C.fishSilver, vertical = false) {
  B.pushAt(x, y, z, ry, vertical ? Math.PI / 2 : 0, 0);
  B.lathe('hard', 0, 0, 0, [
    [0.0, -len * 0.5], [len * 0.14, -len * 0.25], [len * 0.16, 0],
    [len * 0.12, len * 0.25], [len * 0.04, len * 0.4], [0.0, len * 0.45],
  ], { segs: 8, rx: Math.PI / 2, tint });
  B.box('hard', 0, 0, -len * 0.52, 0.012, len * 0.24, len * 0.14, { tint });
  B.pop();
}

function addRowboat(B, x, y, z, ry = 0, o = {}) {
  const L = o.length ?? 4.0;
  const Bm = o.beam ?? 1.36;
  const D = o.depth ?? 0.5;
  const hullCol = o.hull ?? lin(0x2f7f8f);
  const bottomCol = o.bottom ?? lin(0x8f3a2a);
  const trimCol = o.trim ?? C.white;
  const upside = !!o.upsideDown;
  B.pushAt(x, y, z, ry, o.rx || 0, (upside ? Math.PI : 0) + (o.rz || 0));
  if (upside) B.push(mat4(0, -(D + 0.03), 0));

  const sec = (t, s) => {
    const f = t < 0.42 ? 0.7 + 0.3 * Math.sin((Math.PI / 2) * t / 0.42) : Math.pow(Math.cos((Math.PI / 2) * (t - 0.42) / 0.58), 0.85);
    const halfB = (Bm / 2) * f;
    const sheer = D + 0.08 * Math.pow(2 * t - 1, 2) + 0.08 * t * t;
    const keel = 0.04 * Math.pow(Math.max(0, 0.45 - t) / 0.45, 2) + 0.38 * Math.pow(Math.max(0, t - 0.62) / 0.38, 2.2);
    const ang = Math.abs(s) * (Math.PI / 2);
    return [
      halfB * Math.sign(s) * Math.pow(Math.sin(ang), 0.85),
      keel + (sheer - keel) * (1 - Math.pow(Math.cos(ang), 1.25)),
      (t - 0.5) * L,
    ];
  };

  const NT = 12;
  const NS = 8;
  const hull = gridPart(NT, NS, (i, j) => {
    const t = 0.02 + (0.96 * i) / NT;
    const s = -1 + (2 * j) / NS;
    const p = sec(t, s);
    // Diferença finita centrada (clamped nos limites) evita ds=0 em j=NS (s=+1)
    const pt0 = sec(Math.max(0.001, t - 0.01), s);
    const pt1 = sec(Math.min(0.999, t + 0.01), s);
    const ps0 = sec(t, Math.max(-1, s - 0.02));
    const ps1 = sec(t, Math.min(1, s + 0.02));
    const dt = new THREE.Vector3(pt1[0] - pt0[0], pt1[1] - pt0[1], pt1[2] - pt0[2]);
    const ds = new THREE.Vector3(ps1[0] - ps0[0], ps1[1] - ps0[1], ps1[2] - ps0[2]);
    const n = dt.cross(ds);
    if (n.lengthSq() < 1e-10) n.set(Math.sign(s) || 0, 1, 0);
    n.normalize();
    if (n.x * p[0] + n.y * (p[1] - D * 0.9) < 0) n.negate();
    return { p, n: [n.x, n.y, n.z], uv: [t * L * 0.6, Math.abs(s) * 0.8] };
  });
  const wl = D * 0.42;
  B.add('wood', hull, new THREE.Matrix4(), (px, py) => (py < wl ? bottomCol : hullCol));

  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= NT; i++) {
      const p = sec(0.02 + (0.96 * i) / NT, side);
      pts.push(new THREE.Vector3(p[0], p[1] + 0.01, p[2]));
    }
    B.tube('wood', pts, 0.026, { radial: 4, tint: trimCol });
  }
  if (!upside) {
    for (const t of [0.3, 0.62]) {
      const pL = sec(t, -0.85);
      const pR = sec(t, 0.85);
      B.box('wood', 0, pL[1] - 0.06, pL[2], pR[0] - pL[0], 0.035, 0.22, { grain: 0, tint: trimCol });
    }
  }
  if (upside) B.pop();
  B.pop();
}

function addOar(B, p0, p1, bladeTint = C.red, rand) {
  _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
  const L = _a.length();
  _a.divideScalar(L || 1);
  const bs = Math.max(0.2, L - 0.55);
  const pb = [p0[0] + _a.x * bs, p0[1] + _a.y * bs, p0[2] + _a.z * bs];
  B.rod('wood', p0, pb, 0.02, 0.022, { segs: 6, tint: woodTone(rand) });
  B.beam('wood', pb, p1, 0.13, 0.018, { tint: bladeTint });
}

function addCleaningTable(B, x, y, z, ry, rand) {
  B.pushAt(x, y, z, ry);
  for (let i = 0; i < 5; i++) B.box('wood', 0, 0.88, -0.26 + i * 0.13, 1.35, 0.045, 0.12, { grain: 0, tint: woodTone(rand) });
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.27, 0.27]) B.box('wood', sx, 0.43, sz, 0.07, 0.86, 0.07, { grain: 1, tint: woodTone(rand) });
  B.box('wood', 0, 0.25, 0, 1.25, 0.03, 0.5, { grain: 0, tint: woodTone(rand) });
  B.box('wood', 0, 0.8, -0.28, 1.25, 0.1, 0.03, { grain: 0, tint: woodTone(rand) });
  B.box('wood', 0.2, 0.915, 0.02, 0.56, 0.025, 0.34, { grain: 0, tint: C.woodFresh });
  addSimpleFish(B, -0.25, 0.93, -0.02, 0.48, 0.5, C.fishSilver);
  addBucket(B, -0.3, 0.265, 0.05, C.white);
  B.pop();
}

function addNetRack(B, x, gy, z, ry, len, netTint, rand) {
  B.pushAt(x, 0, z, ry);
  const h = 1.95;
  for (const sx of [-len / 2, len / 2]) {
    B.cyl('wood', sx, gy - 0.8, 0, 0.055, 0.065, h + 0.85, { segs: 6, tint: woodTone(rand) });
    B.box('wood', sx, gy + h - 0.02, 0, 0.08, 0.08, 0.6, { grain: 2, tint: woodTone(rand) });
  }
  B.rod('wood', [-len / 2 - 0.2, gy + h + 0.05, 0], [len / 2 + 0.2, gy + h + 0.05, 0], 0.04, 0.04, { segs: 6, tint: woodTone(rand) });
  const top = gy + h + 0.08;
  const drop = h - 0.35;
  const part = gridPart(12, 8, (i, j) => {
    const u = i / 12;
    const v = j / 8;
    const xx = (u - 0.5) * (len - 0.25);
    const side = v < 0.5 ? 1 : -1;
    const a = Math.abs(v - 0.5) * 2;
    const fold = Math.sin(u * 18 + v * 3) * 0.04;
    return {
      p: [xx, top - a * drop + Math.sin(u * Math.PI) * a * 0.08, side * (0.04 + a * 0.2 + fold * a)],
      n: [0, 0.2, side],
      uv: [xx * 1.4, v * drop * 2.4],
    };
  });
  B.add('net', part, new THREE.Matrix4(), netTint);
  B.pop();
}

function addFishRack(B, x, gy, z, ry, len, rand) {
  B.pushAt(x, gy, z, ry);
  for (const sx of [-len / 2, len / 2]) {
    B.rod('wood', [sx, -0.4, -0.7], [sx, 2.05, 0.05], 0.035, 0.03, { segs: 5, tint: woodTone(rand) });
    B.rod('wood', [sx, -0.4, 0.7], [sx, 2.05, -0.05], 0.035, 0.03, { segs: 5, tint: woodTone(rand) });
  }
  for (const [py, pz] of [[1.95, 0], [1.25, -0.36], [1.25, 0.36]]) {
    B.rod('wood', [-len / 2 - 0.15, py, pz], [len / 2 + 0.15, py, pz], 0.025, 0.025, { segs: 5, tint: woodTone(rand) });
    const n = Math.floor(len / 0.3);
    for (let i = 0; i < n; i++) {
      if (rand.chance(0.25)) continue;
      const xx = -len / 2 + 0.2 + i * (len - 0.4) / Math.max(1, n - 1);
      addSimpleFish(B, xx, py - 0.22, pz, 0.38, rand.range(-0.4, 0.4), C.fishDry, true);
    }
  }
  B.pop();
}

function addFence(B, pts, beachY, style, tint, rand) {
  const painted = style === 'picket';
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, z0] = pts[s];
    const [x1, z1] = pts[s + 1];
    const L = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(L / 1.8));
    const yaw = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i <= n; i++) {
      if (s > 0 && i === 0) continue;
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      const g = beachY(px, pz);
      B.box('wood', px, g + 0.32, pz, 0.09, 1.3, 0.09, { grain: 1, tint: painted ? tint : woodTone(rand) });
    }
    for (let i = 0; i < n; i++) {
      const ta = i / n;
      const tb = (i + 1) / n;
      const ax = x0 + (x1 - x0) * ta;
      const az = z0 + (z1 - z0) * ta;
      const bx = x0 + (x1 - x0) * tb;
      const bz = z0 + (z1 - z0) * tb;
      const ga = beachY(ax, az);
      const gb = beachY(bx, bz);
      for (const ry of painted ? [0.25, 0.7] : [0.35, 0.78]) {
        B.beam('wood', [ax, ga + ry, az], [bx, gb + ry, bz], 0.03, 0.08, { tint: painted ? tint : woodTone(rand) });
      }
      if (painted) {
        const L2 = Math.hypot(bx - ax, bz - az);
        const np = Math.floor(L2 / 0.16);
        for (let k = 0; k < np; k++) {
          const tt = (k + 0.5) / np;
          const px = ax + (bx - ax) * tt;
          const pz = az + (bz - az) * tt;
          const g = ga + (gb - ga) * tt;
          const h = 0.88 + ((k * 7 + i * 3) % 5) * 0.015;
          B.box('wood', px, g + h / 2 - 0.04, pz, 0.075, h, 0.022, { grain: 1, ry: yaw + Math.PI / 2, tint });
        }
      }
    }
  }
}

function addWaterTank(B, x, gy, z, rand) {
  const h = 1.65;
  const s = 0.6;
  for (const sx of [-s, s]) for (const sz of [-s, s]) B.box('wood', x + sx, gy + h / 2 - 0.4, z + sz, 0.12, h + 0.8, 0.12, { grain: 1, tint: woodTone(rand) });
  for (const sz of [-s, s]) B.beam('wood', [x - s, gy + 0.3, z + sz], [x + s, gy + h - 0.2, z + sz], 0.04, 0.12, { tint: woodTone(rand) });
  for (let i = 0; i < 8; i++) B.box('wood', x, gy + h + 0.02, z - 0.65 + i * 0.185, 1.45, 0.045, 0.16, { grain: 0, tint: woodTone(rand) });
  const ty = gy + h + 0.045;
  B.cyl('roofMetal', x, ty, z, 0.58, 0.58, 1.22, { segs: 16, capTop: false, swapUV: true, tint: C.galv });
  B.cyl('roofMetal', x, ty + 1.22, z, 0.08, 0.6, 0.22, { segs: 16, tint: C.galv });
}

function addWoodpile(B, x, gy, z, ry, rand) {
  B.pushAt(x, gy, z, ry);
  for (let row = 0; row < 4; row++) {
    const n = 6 - (row > 2 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const r = rand.range(0.055, 0.075);
      const xx = -0.5 + i * 0.16 + (row % 2) * 0.08;
      B.cyl('wood', xx, r + row * 0.13, -0.25, r, r, 0.5, { segs: 7, capTop: true, capBot: true, rx: Math.PI / 2, tint: C.woodFresh });
    }
  }
  B.pop();
}

function addWreck(B, x, gy, z, ry, rand) {
  B.pushAt(x, gy - 0.15, z, ry, 0, 0.22);
  const L = 7.2;
  const Bm = 2.5;
  const D = 1.25;
  const keel = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    keel.push(new THREE.Vector3(0, 0.12 * Math.pow(2 * t - 1, 4) + (t > 0.85 ? (t - 0.85) * 3.2 : 0), (t - 0.5) * L));
  }
  B.tube('wood', keel, 0.095, { radial: 5, tint: C.woodDark });
  const nr = 10;
  for (let i = 1; i < nr; i++) {
    const t = i / nr;
    const half = (Bm / 2) * Math.pow(Math.sin(Math.PI * (0.08 + 0.84 * t)), 0.7);
    const zz = (t - 0.5) * L;
    for (const side of [-1, 1]) {
      if (rand.chance(0.18)) continue;
      const keep = rand.chance(0.35) ? rand.range(0.4, 0.85) : 1;
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        const ang = ((k / 5) * keep) * (Math.PI / 2);
        pts.push(new THREE.Vector3(side * half * Math.sin(ang), D * (1 - Math.cos(ang)) + 0.05, zz));
      }
      B.tube('wood', pts, 0.052, { radial: 4, tint: woodTone(rand, C.woodDark) });
    }
  }
  B.pop();
}

// ---- Construção das grandes seções da vila ------------------------------------------------------------------------

function construirPier(B, frame, spec, hangList, pointLights) {
  const { rand, z0, zH, z1, pierW, headW, bwStartY } = spec;
  const { waterY, deckY, beachY } = frame;
  const halfW = pierW / 2;
  const hx0 = -headW / 2;
  const hx1 = headW / 2;
  const plankT = 0.055;
  const pileOff = halfW + 0.17;
  const stringerTop = deckY - plankT;
  const capTop = stringerTop - 0.22;
  const capBot = capTop - 0.26;
  const pileBot = waterY - 5.5;
  const archH = 2.75;

  const pile = (px, pz, top, flatTop = false, r = 0.15) => {
    const h = top - pileBot;
    const tilt = top > deckY ? 0.008 : 0.022;
    const tint = woodTone(rand);
    B.cyl('wood', px, pileBot, pz, r * 0.9, r * 1.05, h, {
      segs: 9,
      capTop: top <= deckY || flatTop,
      rx: rand.range(-tilt, tilt),
      rz: rand.range(-tilt, tilt),
      tint,
      tidal: true,
    });
    if (top <= deckY && rand.chance(0.16)) {
      const y = waterY + rand.range(0.6, 1.3);
      for (let k = 0; k < 3; k++) B.torus('rope', px, y + k * 0.035, pz, r + 0.02, 0.018, { radial: 4, tubular: 10, tint: C.rope });
    } else if (top <= deckY && rand.chance(0.08)) {
      B.torus('hard', px, waterY + rand.range(0.25, 0.8), pz, r + 0.19, 0.09, { rx: rand.range(-0.2, 0.2), radial: 5, tubular: 12, tint: C.rubber, tidal: true });
    }
    if (top > deckY && !flatTop) {
      B.cyl('wood', px, top, pz, r * 0.5, r * 0.92, 0.07, { segs: 9, tint });
    }
  };

  const capRow = (bz, xa, xb) => {
    const off = 0.2;
    for (const s of [-1, 1]) {
      B.box('wood', (xa + xb) / 2, capBot + 0.13, bz + s * off, xb - xa, 0.26, 0.09, { grain: 0, tint: woodTone(rand) });
    }
  };

  const xBrace = (xa, xb, bz) => {
    const yTop = capBot - 0.12;
    const yBot = Math.max(waterY - 0.6, yTop - 3.6);
    const off = 0.18;
    B.beam('wood', [xa, yTop, bz + off], [xb, yBot, bz + off], 0.05, 0.18, { tint: woodTone(rand), tidal: true });
    B.beam('wood', [xa, yBot, bz - off], [xb, yTop, bz - off], 0.05, 0.18, { tint: woodTone(rand), tidal: true });
  };

  // Bents da passarela do píer
  const nB = Math.round((zH - z0) / 3.0);
  const bentZ = [];
  for (let i = 0; i <= nB; i++) bentZ.push(z0 + 0.35 + (i * (zH - z0 - 0.1)) / nB);
  const lastBent = bentZ.length - 1;
  const gapBays = { '-1': [3, 7], '1': [5, 9] };
  const railBay = (side, i) => i >= 0 && i < lastBent && !gapBays[side].includes(i);

  for (let bi = 0; bi < bentZ.length; bi++) {
    const bz = bentZ[bi];
    for (const side of [-1, 1]) {
      const px = side * pileOff;
      const needPost = railBay(side, bi) || railBay(side, bi - 1) || bi === 0 || bi === lastBent;
      let top = capTop;
      if (needPost) top = deckY + (bi === 0 ? archH + 0.25 : 0.95);
      else if (bi % 3 === 1) top = deckY + 0.45;
      pile(px, bz, top, needPost && bi !== 0, bi === 0 ? 0.17 : 0.15);
    }
    if (bi !== lastBent) {
      capRow(bz, -pileOff - 0.3, pileOff + 0.3);
      xBrace(-pileOff, pileOff, bz);
    }
    if (bi < lastBent && bi % 2 === 0) {
      const bz2 = bentZ[bi + 1];
      for (const side of [-1, 1]) {
        const xo = side * (pileOff + 0.17);
        const yTop = capBot - 0.2;
        const yBot = Math.max(waterY - 0.5, yTop - 2.8);
        B.beam('wood', [xo, yTop, bz + 0.25], [xo, yBot, bz2 - 0.25], 0.05, 0.18, { tint: woodTone(rand), tidal: true });
      }
    }
  }

  // Longarinas (4 linhas)
  for (let bi = 0; bi < lastBent; bi++) {
    const za = bi === 0 ? z0 + 0.02 : bentZ[bi];
    const zb = bentZ[bi + 1];
    for (const sx of [-1.15, -0.4, 0.4, 1.15]) {
      B.box('wood', sx, stringerTop - 0.11, (za + zb) / 2, 0.1, 0.22, zb - za + 0.04, { grain: 2, tint: woodTone(rand) });
    }
  }

  const plank = (cx, zc, L) => {
    const newer = rand.chance(0.07);
    const t = newer ? C.woodFresh : woodTone(rand, C.woodDeck);
    const wdt = rand.range(0.195, 0.206);
    const yOff = rand.range(0, 0.012);
    B.box('wood', cx + rand.range(-0.02, 0.02), deckY - plankT / 2 - yOff, zc, L + rand.range(-0.04, 0.04), plankT, wdt, {
      grain: 0,
      ry: rand.range(-0.008, 0.008),
      rx: rand.range(-0.015, 0.015),
      tint: t,
    });
  };

  const pitch = 0.22;
  const nPl = Math.floor((zH - z0) / pitch);
  for (let i = 0; i < nPl; i++) {
    plank(0, z0 + ((i + 0.5) * (zH - z0)) / nPl, pierW);
  }

  // Guarda-corpos da passarela do píer
  const railTop = deckY + 0.95;
  for (let bi = 0; bi < lastBent; bi++) {
    for (const side of [-1, 1]) {
      if (!railBay(side, bi)) continue;
      const za = bentZ[bi];
      const zb = bentZ[bi + 1];
      const px = side * pileOff;
      B.box('wood', px, railTop + 0.022, (za + zb) / 2, 0.19, 0.045, zb - za + 0.14, { grain: 2, tint: woodTone(rand) });
      B.beam('wood', [px - side * 0.14, deckY + 0.48, za - 0.05], [px - side * 0.14, deckY + 0.48, zb + 0.05], 0.05, 0.14, { tint: woodTone(rand) });
    }
  }

  // Postes com lanternas articuladas balançando ao vento ao longo do píer
  for (const [bi, side] of [[2, -1], [5, 1], [8, -1], [10, 1]]) {
    if (bi >= lastBent) continue;
    const lx = side * (halfW - 0.1);
    const lz = bentZ[bi] + 0.3;
    addHungLampPost(B, hangList, lx, deckY, lz, (-side * Math.PI) / 2, 3.0, rand);
  }

  // Portal de entrada do píer + placa de peixe pendurada (oscila ao vento)
  let signPivot = null;
  let signBuilder = null;
  {
    const az = bentZ[0];
    const by = deckY + archH;
    B.box('wood', 0, by, az, pierW + 1.1, 0.24, 0.16, { grain: 0, tint: C.white });
    B.box('wood', 0, by + 0.2, az, pierW + 1.35, 0.06, 0.22, { grain: 0, tint: C.white });
    for (const s of [-1, 1]) {
      B.beam('wood', [s * (pileOff - 0.12), by - 0.62, az], [s * (pileOff - 0.62), by - 0.1, az], 0.1, 0.09, { tint: C.white });
      B.torus('hard', s * (pileOff + 0.3), by - 0.125, az - 0.07, 0.02, 0.005, { rx: Math.PI / 2, radial: 3, tubular: 6, tint: C.iron });
      const LB = new Builder();
      for (let i = 0; i < 3; i++) LB.torus('hard', 0, -0.012 - i * 0.03, 0, 0.012, 0.0032, { ry: i % 2 ? Math.PI / 2 : 0, radial: 3, tubular: 6, tint: C.iron });
      addLanternGeo(LB, 0, -0.09, 0, 0.9);
      hangList.push({ pivot: new THREE.Vector3(s * (pileOff + 0.3), by - 0.12, az - 0.07), builder: LB, t: rand.range(0, 50), ph: rand.range(0, TAU), x: 0, z: 0, vx: 0, vz: 0 });
    }
    pointLights.push({ pos: new THREE.Vector3(0, by - 0.4, az), base: 3.4, dist: 15 });

    // Placa oscilante do portal
    signPivot = new THREE.Vector3(0, by - 0.12, az + 0.02);
    signBuilder = new Builder();
    const sy = -0.4;
    signBuilder.box('wood', 0, sy, 0, 1.98, 0.6, 0.04, { grain: 0, tint: C.white });
    signBuilder.part('sign', quadUVPart(1.88, 0.5, 0.02, 0.68, 0.98, 0.98), 0, sy, 0.024, { tint: [1, 1, 1] });
    signBuilder.part('sign', quadUVPart(1.88, 0.5, 0.02, 0.68, 0.98, 0.98), 0, sy, -0.024, { ry: Math.PI, tint: [1, 1, 1] });
    for (const s of [-0.7, 0.7]) {
      signBuilder.rod('hard', [s, sy + 0.28, 0], [s, 0, 0], 0.008, 0.008, { segs: 4, tint: C.iron });
    }
    // Peixe estilizado acima da placa
    signBuilder.box('wood', 0, sy + 0.38, 0, 0.75, 0.22, 0.03, { grain: 0, tint: C.coral });
    signBuilder.box('wood', 0.46, sy + 0.38, 0, 0.22, 0.26, 0.03, { grain: 0, rz: 0.4, tint: C.coral });
  }

  // Escada de terra conectando o início do píer à passarela na areia
  {
    const rise = deckY - bwStartY;
    const nR = Math.max(3, Math.ceil(rise / 0.22));
    const rh = rise / nR;
    const tread = (z0 - spec.stepFootZ) / nR;
    for (let k = 1; k < nR; k++) {
      const top = deckY - k * rh;
      const zc = z0 - (k - 0.5) * tread;
      B.box('wood', 0, top - 0.024, zc, pierW - 0.1, 0.048, tread + 0.02, { grain: 0, tint: woodTone(rand) });
    }
    for (const side of [-1, 1]) {
      const sx = side * (halfW - 0.04);
      const gEnd = beachY(sx, spec.stepFootZ - 0.2);
      B.beam('wood', [sx, deckY - 0.12, z0 + 0.15], [sx, gEnd - 0.15, spec.stepFootZ - 0.2], 0.07, 0.26, { tint: woodTone(rand) });
    }
  }

  // T-head do píer
  const rowsZ = [zH + 0.25, (zH + z1) / 2, z1 - 0.25];
  const colsX = [];
  for (let k = 0; k < 5; k++) colsX.push(hx0 + 0.35 + (k * (headW - 0.7)) / 4);
  for (let r = 0; r < 3; r++) {
    const rz = rowsZ[r];
    for (let k = 0; k < 5; k++) {
      if (r === 0 && k === 2) continue;
      const post = (r === 0 || r === 2 || k === 0) && !(k === 4 && r === 1);
      pile(colsX[k], rz, post ? deckY + 0.95 : capTop, post);
    }
    capRow(rz, hx0 - 0.08, hx1 + 0.08);
    for (let k = 0; k < 4; k++) {
      if (r === 0 && (k === 1 || k === 2)) continue;
      xBrace(colsX[k], colsX[k + 1], rz);
    }
  }
  for (let sx = hx0 + 0.25; sx < hx1 - 0.1; sx += 0.85) {
    B.box('wood', sx, stringerTop - 0.11, (zH + z1) / 2, 0.1, 0.22, z1 - zH - 0.05, { grain: 2, tint: woodTone(rand) });
  }
  const nRows = Math.floor((z1 - zH) / pitch);
  for (let r = 0; r < nRows; r++) {
    const zc = zH + ((r + 0.5) * (z1 - zH)) / nRows;
    const mid = (r % 2 === 0 ? -1.4 : 1.4);
    plank((hx0 + mid) / 2, zc, mid - hx0 - 0.06);
    plank((mid + hx1) / 2, zc, hx1 - mid - 0.06);
  }
  const railRun = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az);
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    B.box('wood', cx, railTop + 0.022, cz, alongX ? len + 0.16 : 0.19, 0.045, alongX ? 0.19 : len + 0.16, { grain: alongX ? 0 : 2, tint: woodTone(rand) });
    B.box('wood', cx, deckY + 0.48, cz, alongX ? len : 0.05, 0.14, alongX ? 0.05 : len, { grain: alongX ? 0 : 2, tint: woodTone(rand) });
  };
  for (let k = 0; k < 4; k++) railRun(colsX[k], rowsZ[2], colsX[k + 1], rowsZ[2]);
  railRun(colsX[0], rowsZ[0], colsX[0], rowsZ[2]);
  railRun(colsX[0], rowsZ[0], -pileOff, rowsZ[0]);
  railRun(pileOff, rowsZ[0], colsX[4], rowsZ[0]);

  // Cabeços de amarração, cunho, defensas de pneu e escada lateral para a água
  const edgeX = hx1;
  for (const bz of [29.0, 32.8]) {
    addBollard(B, edgeX - 0.45, deckY, bz);
    addRopeLoop(B, edgeX - 0.45, deckY + 0.36, bz, 0.155);
    addRopeCoil(B, edgeX - 1.2, deckY, bz + (bz < 31 ? 0.32 : -0.32), 0.08, 0.28, 4);
  }
  addCleat(B, edgeX - 0.22, deckY, 30.9, Math.PI / 2);
  for (const fz of [28.3, 30.8, 32.0, 33.4]) addTireFender(B, edgeX, deckY - 0.04, fz, 0, 0.72);

  // Escada metálica até a água
  {
    const lx = DIMENSOES_VILA_COSTEIRA.escadaLocalX;
    const lz = DIMENSOES_VILA_COSTEIRA.escadaLocalZ;
    const yb = waterY - 2.0;
    const yt = deckY + 0.85;
    for (const s of [-1, 1]) {
      const rzs = lz + s * 0.24;
      B.rod('hard', [lx, yb, rzs], [lx, yt - 0.15, rzs], 0.024, 0.024, { segs: 6, tint: C.galv, tidal: true });
      const arc = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI;
        arc.push(new THREE.Vector3(lx - 0.25 + Math.cos(a) * 0.25, yt - 0.15 + Math.sin(a) * 0.15, rzs));
      }
      B.tube('hard', arc, 0.024, { radial: 5, tint: C.galv });
      B.rod('hard', [lx - 0.5, yt - 0.15, rzs], [lx - 0.5, deckY, rzs], 0.024, 0.024, { segs: 6, tint: C.galv });
    }
    for (let y = yb + 0.25; y < deckY - 0.08; y += 0.3) {
      B.rod('hard', [lx, y, lz - 0.24], [lx, y, lz + 0.24], 0.018, 0.018, { segs: 6, tint: C.galv, tidal: true });
    }
  }

  // Equipamentos e mobília no T-head
  addBench(B, -3.2, deckY, z1 - 0.95, 0, 1.7, null, rand);
  addLifeRing(B, 0.6, deckY + 0.58, rowsZ[2] + 0.12, 0);
  addCleaningTable(B, 3.1, deckY, z1 - 0.95, 0, rand);
  addBucket(B, 4.1, deckY, z1 - 0.78, C.blue);
  for (const rx of [1.45, 1.85]) {
    B.rod('hard', [rx, deckY + 0.02, rowsZ[2] - 0.22], [rx + 0.22, deckY + 2.5, rowsZ[2] + 0.6], 0.016, 0.005, { segs: 5, tint: C.black });
  }
  addCrate(B, -5.6, deckY, 28.8, 0.08, rand);
  addCrate(B, -5.6, deckY + 0.4, 28.9, 0.3, rand);
  addTrap(B, -5.3, deckY, 32.6, 0.06, rand);
  addTrap(B, -5.2, deckY + 0.31, 32.5, 1.25, rand);
  addBarrel(B, -6.1, deckY, 30.8, rand);
  addBuoyString(B, [hx0 + 0.14, railTop, 28.4], [hx0 + 0.14, railTop, 30.6], 4, rand, 0.2);
  addBuoyString(B, [hx0 + 0.14, railTop, 31.4], [hx0 + 0.14, railTop, 33.4], 3, rand, 0.18);

  // 3 Lanternas no T-head + ponto de luz noturna
  for (const [lx, lz, yaw] of [[hx0 + 0.55, z1 - 0.55, (3 * Math.PI) / 4], [hx1 - 0.6, z1 - 0.55, (-3 * Math.PI) / 4], [hx0 + 0.55, zH + 0.6, Math.PI / 4]]) {
    addHungLampPost(B, hangList, lx, deckY, lz, yaw, 3.1, rand);
  }
  pointLights.push({ pos: new THREE.Vector3(3.2, deckY + 2.6, 30.8), base: 4.0, dist: 18 });
  pointLights.push({ pos: new THREE.Vector3(-4.2, deckY + 2.6, 31.2), base: 3.5, dist: 16 });

  return { signPivot, signBuilder };
}

function construirPassarelas(B, frame, spec) {
  const { rand, mainBw, branchBws, plaza } = spec;
  const { beachY } = frame;

  const emitBw = (bw, withLights = false) => {
    const S = bw.samples;
    const width = bw.width;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      const a = S[Math.max(0, i - 1)].y;
      const b = S[Math.min(S.length - 1, i + 1)].y;
      const span = 0.22 * (Math.min(S.length - 1, i + 1) - Math.max(0, i - 1)) || 0.22;
      const slope = (b - a) / span;
      const newer = rand.chance(0.05);
      B.box('wood', s.x + rand.range(-0.02, 0.02) * s.nx, s.y - 0.021, s.z + rand.range(-0.02, 0.02) * s.nz, width, 0.042, 0.185, {
        grain: 0,
        ry: s.yaw + rand.range(-0.01, 0.01),
        rx: -Math.atan(slope),
        tint: newer ? C.woodFresh : woodTone(rand, C.woodDeck),
      });
    }
    const seg = 5;
    for (let i = 0; i < S.length - 1; i += seg) {
      const j = Math.min(S.length - 1, i + seg);
      const a = S[i];
      const b = S[j];
      for (const o of [-width / 2 + 0.16, width / 2 - 0.16]) {
        B.beam('wood', [a.x + a.nx * o, a.y - 0.1, a.z + a.nz * o], [b.x + b.nx * o, b.y - 0.1, b.z + b.nz * o], 0.08, 0.14, { extend: 0.05, tint: woodTone(rand) });
      }
      for (const sgn of [-1, 1]) {
        const o = sgn * (width / 2 + 0.01);
        B.beam('wood', [a.x + a.nx * o, a.y - 0.09, a.z + a.nz * o], [b.x + b.nx * o, b.y - 0.09, b.z + b.nz * o], 0.03, 0.11, { extend: 0.03, tint: woodTone(rand) });
      }
    }
    for (let i = 0; i < S.length; i += 8) {
      const s = S[i];
      for (const o of [-width / 2 + 0.16, width / 2 - 0.16]) {
        const px = s.x + s.nx * o;
        const pz = s.z + s.nz * o;
        const gBot = beachY(px, pz) - 1.8;
        const top = s.y - 0.16;
        B.box('wood', px, (top + gBot) / 2, pz, 0.11, top - gBot, 0.11, { grain: 1, ry: s.yaw, tint: woodTone(rand) });
      }
    }
    if (withLights) {
      let side = 1;
      for (let i = 14; i < S.length - 8; i += 28) {
        const s = S[i];
        const o = side * (width / 2 + 0.22);
        const px = s.x + s.nx * o;
        const pz = s.z + s.nz * o;
        addPathLight(B, px, beachY(px, pz) - 0.18, pz, rand);
        side = -side;
      }
    }
  };

  emitBw(mainBw, true);
  for (const b of branchBws) emitBw(b, false);

  // Plataforma de madeira e pedra da Praça do Mercado
  B.box('stone', plaza.x, plaza.y - 0.9, plaza.z, plaza.r * 2 + 0.3, 1.7, plaza.r * 2 + 0.3, { tint: C.stone });
  for (let i = -14; i <= 14; i++) {
    B.box('wood', plaza.x, plaza.y - 0.02, plaza.z + i * 0.44, plaza.r * 2, 0.04, 0.4, { grain: 0, tint: woodTone(rand, C.woodDeck) });
  }
  addBench(B, plaza.x - 2.6, plaza.y, plaza.z + 1.4, 0.85, 1.6, lin(0x4f8fa0), rand);
  addBench(B, plaza.x + 2.6, plaza.y, plaza.z + 1.2, -0.85, 1.6, lin(0xb05a45), rand);
  addBarrel(B, plaza.x - 2.4, plaza.y, plaza.z - 2.2, rand);
  addBarrel(B, plaza.x - 1.75, plaza.y, plaza.z - 2.5, rand);
}

function construirBancas(B, frame, spec, pointLights) {
  const { rand, fishStand, chandlery, marketStall } = spec;
  const { beachY } = frame;

  // 1) Joe's Fish Stand
  {
    const fy = beachY(fishStand.x, fishStand.z);
    B.pushAt(fishStand.x, fy, fishStand.z, fishStand.yaw);
    // Plataforma e esteios ancorados na areia
    for (const [px, pz, h] of [[-1.25, 0.75, 2.45], [1.25, 0.75, 2.42], [-1.25, -0.75, 2.12], [1.25, -0.75, 2.15]]) {
      B.box('wood', px, (h - 1.5) / 2, pz, 0.11, h + 1.5, 0.11, { grain: 1, tint: woodTone(rand) });
    }
    B.box('wood', 0, 0.04, 0, 2.65, 0.08, 1.7, { grain: 0, tint: woodTone(rand, C.woodDeck) });
    // Balcão frontal, laterais, fundo e prateleira
    B.box('wood', 0, 0.52, 0.8, 2.56, 0.92, 0.04, { grain: 0, tint: lin(0x8e7e68) });
    B.box('wood', 0, 1.02, 0.82, 2.72, 0.05, 0.56, { grain: 0, tint: C.woodFresh });
    B.box('wood', 0, 0.7, -0.63, 2.5, 0.04, 0.3, { grain: 0, tint: woodTone(rand) });
    B.box('wood', 0, 1.05, -0.8, 2.6, 2.02, 0.04, { grain: 1, tint: woodTone(rand) });
    for (const s of [-1, 1]) B.box('wood', s * 1.29, 0.55, 0, 0.04, 1.0, 1.55, { grain: 2, tint: woodTone(rand) });
    // Telhado de zinco inclinado + placa pintada à mão
    B.slab('roofMetal', [
      new THREE.Vector3(-1.45, 2.42, 1.08),
      new THREE.Vector3(1.45, 2.42, 1.08),
      new THREE.Vector3(1.45, 2.12, -1.0),
      new THREE.Vector3(-1.45, 2.12, -1.0),
    ], 0.04, { up: _UP, uDir: new THREE.Vector3(0, 0.3, -2.08).normalize(), tint: ROOFS.rust });
    B.box('wood', 0, 2.16, 0.84, 2.34, 0.36, 0.035, { grain: 0, tint: woodTone(rand) });
    B.part('sign', quadUVPart(2.28, 0.32, 0.02, 0.35, 0.98, 0.65), 0, 2.16, 0.865, { tint: [1, 1, 1] });
    // Caixa de gelo com peixes + balança pendente + boias + lousa de preços + lanterna
    B.box('hard', -0.55, 1.16, 0.84, 0.92, 0.24, 0.5, { tint: C.blue });
    B.box('hard', -0.55, 1.28, 0.84, 0.84, 0.03, 0.42, { tint: C.white });
    for (let i = 0; i < 4; i++) addSimpleFish(B, -0.8 + i * 0.16, 1.31, 0.84, 0.32, i * 0.2, C.fishSilver);
    B.rod('hard', [0.6, 2.25, 0.72], [0.6, 1.75, 0.72], 0.008, 0.008, { tint: C.iron });
    B.cyl('hard', 0.6, 1.66, 0.72, 0.1, 0.1, 0.05, { segs: 12, rx: Math.PI / 2, tint: C.cream });
    B.cyl('hard', 0.6, 1.44, 0.72, 0.14, 0.1, 0.04, { segs: 12, tint: C.galv });
    addLifeRing(B, 1.34, 1.12, 0.1, Math.PI / 2);
    addLanternGeo(B, -0.9, 2.25, 0.25, 0.9);
    // Lousa cavalete (preços)
    B.box('wood', 1.75, 0.42, 1.0, 0.62, 0.82, 0.04, { ry: 0.35, rx: -0.22, tint: woodTone(rand) });
    B.part('sign', quadUVPart(0.54, 0.72, 0.51, 0.02, 0.98, 0.32), 1.76, 0.44, 1.025, { ry: 0.35, rx: -0.22, tint: [1, 1, 1] });
    addCrate(B, -1.75, 0, 0.25, 0.1, rand);
    addBucket(B, 1.5, 0, 0.95, C.blue);
    B.pop();
    pointLights.push({ pos: new THREE.Vector3(fishStand.x, fy + 2.0, fishStand.z), base: 3.0, dist: 13 });
  }

  // 2) Marta's Chandlery
  {
    const cy = beachY(chandlery.x, chandlery.z);
    B.pushAt(chandlery.x, cy, chandlery.z, chandlery.yaw);
    // Mesa de trabalho robusta sobre cavaletes
    for (const x of [-0.75, 0.75]) for (const s of [-1, 1]) {
      B.box('wood', x, 0.25, s * 0.22, 0.07, 1.3, 0.07, { rx: s * 0.24, tint: woodTone(rand) });
    }
    B.box('wood', 0, 0.88, 0, 2.05, 0.05, 0.82, { grain: 0, tint: C.woodFresh });
    // Caixa de apetrechos, carretéis de linha, molinetes, galões de diesel
    B.box('hard', -0.52, 1.0, 0.04, 0.5, 0.18, 0.3, { tint: C.green });
    for (let i = 0; i < 4; i++) {
      B.cyl('hard', 0.05 + i * 0.12, 0.96, 0.12, 0.045, 0.045, 0.06, { segs: 10, rx: Math.PI / 2, tint: [C.white, C.blue, C.yellow, C.orange][i] });
    }
    // Estante traseira + placa "MARTA'S CHANDLERY"
    for (const sx of [-1.05, 1.05]) {
      B.box('wood', sx, 0.7, -1.5, 0.09, 3.8, 0.09, { grain: 1, tint: woodTone(rand) });
    }
    B.box('wood', 0, 0.9, -1.25, 1.6, 1.5, 0.42, { grain: 0, tint: woodTone(rand) });
    B.box('wood', 0, 2.25, -1.48, 2.34, 0.58, 0.04, { grain: 0, tint: woodTone(rand) });
    B.part('sign', quadUVPart(2.26, 0.5, 0.02, 0.02, 0.48, 0.32), 0, 2.25, -1.45, { tint: [1, 1, 1] });
    addLanternGeo(B, -0.7, 1.95, -1.35, 0.85);
    addLifeRing(B, 1.06, 1.45, -1.42, 0);
    // Galões de diesel e rolo de cabo
    for (let i = 0; i < 3; i++) {
      B.box('hard', 1.25, 0.17, -0.15 + i * 0.24, 0.2, 0.34, 0.3, { ry: 0.2 * i, tint: i === 1 ? C.green : C.red });
    }
    addRopeCoil(B, -1.2, 0.02, 0.35, 0.1, 0.32, 5);
    // Suporte com varas de pesca
    B.box('wood', -1.35, 0.5, -0.8, 0.1, 1.5, 0.65, { tint: woodTone(rand) });
    for (let i = 0; i < 4; i++) {
      B.rod('hard', [-1.35, 0.12, -1.0 + i * 0.13], [-1.2, 2.1, -1.0 + i * 0.13], 0.012, 0.004, { segs: 5, tint: C.black });
    }
    B.pop();
  }

  // 3) Barraquinha aberta de Mercado na Praça (teto de sapê)
  {
    const my = beachY(marketStall.x, marketStall.z);
    B.pushAt(marketStall.x, my, marketStall.z, marketStall.yaw);
    const w = 3.4;
    const d = 2.4;
    const top = 2.55;
    for (const px of [-w / 2, w / 2]) for (const pz of [-d / 2, d / 2]) {
      B.cyl('wood', px, -1.2, pz, 0.065, 0.075, top + 1.25, { segs: 7, tint: woodTone(rand) });
    }
    const ov = 0.5;
    const XE = w / 2 + ov;
    const ZE = d / 2 + ov;
    const XR = (w - d) / 2;
    const ye = top + 0.06;
    const yR = ye + ZE * 0.68;
    const uV = (x, y, z) => new THREE.Vector3(x, y, z);
    B.slab('thatch', [uV(-XE, ye, ZE), uV(XE, ye, ZE), uV(XR, yR, 0), uV(-XR, yR, 0)], 0.2, { up: _UP, uDir: uV(0, yR - ye, -ZE), tint: C.thatch });
    B.slab('thatch', [uV(XE, ye, -ZE), uV(-XE, ye, -ZE), uV(-XR, yR, 0), uV(XR, yR, 0)], 0.2, { up: _UP, uDir: uV(0, yR - ye, ZE), tint: C.thatch });
    B.slab('thatch', [uV(XE, ye, ZE), uV(XE, ye, -ZE), uV(XR, yR, 0)], 0.2, { up: _UP, uDir: uV(-XE + XR, yR - ye, 0), tint: C.thatch });
    B.slab('thatch', [uV(-XE, ye, -ZE), uV(-XE, ye, ZE), uV(-XR, yR, 0)], 0.2, { up: _UP, uDir: uV(XE - XR, yR - ye, 0), tint: C.thatch });
    B.rod('thatch', [-XR - 0.05, yR - 0.02, 0], [XR + 0.05, yR - 0.02, 0], 0.14, 0.14, { segs: 6, tint: C.thatch });
    // Balcão turquesa + bacias com peixes
    B.box('wood', 0, 0.92, d / 2 - 0.55, w - 0.2, 0.05, 0.56, { grain: 0, tint: woodTone(rand) });
    B.box('wood', 0, 0.45, d / 2 - 0.28, w - 0.3, 0.9, 0.04, { grain: 0, tint: PASTELS[0] });
    for (const bx of [-1.0, 0, 1.0]) {
      B.cyl('wood', bx, 0.95, d / 2 - 0.56, 0.3, 0.22, 0.14, { segs: 12, capTop: true, tint: C.woodFresh });
      addSimpleFish(B, bx, 1.1, d / 2 - 0.56, 0.38, bx, C.fishSilver);
    }
    addLanternGeo(B, 0, top - 0.02, 0, 0.9);
    B.pop();
  }
}

function addWindowUnit(B, cx, sillY, ww, wh, st, rand) {
  const tw = 0.085;
  const tp = 0.035;
  B.box('wood', cx - ww / 2 - tw / 2, sillY + wh / 2, tp / 2, tw, wh + 0.02, tp, { grain: 1, tint: st.trim });
  B.box('wood', cx + ww / 2 + tw / 2, sillY + wh / 2, tp / 2, tw, wh + 0.02, tp, { grain: 1, tint: st.trim });
  B.box('wood', cx, sillY + wh + 0.06, tp / 2 + 0.004, ww + 2 * tw + 0.05, 0.12, tp + 0.008, { grain: 0, tint: st.trim });
  B.box('wood', cx, sillY - 0.025, 0.045, ww + 2 * tw + 0.08, 0.045, 0.09, { grain: 0, rx: 0.1, tint: st.trim });
  // Caixilho + vidro emissivo noturno
  B.box('wood', cx, sillY + wh / 2, 0.016, ww, 0.045, 0.03, { grain: 0, tint: st.trim });
  B.box('wood', cx, sillY + wh / 2, 0.012, 0.024, wh - 0.06, 0.02, { grain: 1, tint: st.trim });
  B.part('windowGlass', quadUVPart(ww - 0.05, wh - 0.05), cx, sillY + wh / 2, 0.008, { tint: C.glassWarm });
  // Venezianas laterais abertas
  const sw = ww / 2 + 0.02;
  for (const s of [-1, 1]) {
    B.pushAt(cx + s * (ww / 2 + tw), 0, 0.03, -s * rand.range(0.08, 0.38));
    B.box('wood', s * (sw / 2 + 0.01), sillY + wh / 2, 0.016, sw, wh + 0.04, 0.028, { grain: 0, tint: st.accent });
    B.pop();
  }
}

function addDoorUnit(B, cx, floorY, st) {
  const dw = 0.92;
  const dh = 2.08;
  const tw = 0.09;
  B.box('wood', cx, floorY + dh / 2, 0.014, dw, dh, 0.045, { grain: 1, tint: st.accent });
  B.box('wood', cx - dw / 2 - tw / 2, floorY + dh / 2 + 0.02, 0.02, tw, dh + 0.04, 0.04, { grain: 1, tint: st.trim });
  B.box('wood', cx + dw / 2 + tw / 2, floorY + dh / 2 + 0.02, 0.02, tw, dh + 0.04, 0.04, { grain: 1, tint: st.trim });
  B.box('wood', cx, floorY + dh + 0.1, 0.024, dw + 2 * tw + 0.06, 0.14, 0.048, { grain: 0, tint: st.trim });
  if (st.doorGlass) {
    B.box('wood', cx, floorY + 1.55, 0.04, 0.54, 0.48, 0.014, { grain: 0, tint: st.trim });
    B.part('windowGlass', quadUVPart(0.44, 0.38), cx, floorY + 1.55, 0.048, { tint: C.glassWarm });
  }
  B.cyl('hard', cx + dw / 2 - 0.12, floorY + 0.98, 0.045, 0.025, 0.025, 0.04, { segs: 8, rx: Math.PI / 2, tint: C.brass });
}

function construirCasas(B, frame, spec, flagEntries) {
  const { rand, houses, boathouse, sheds } = spec;
  const { beachY, waterY } = frame;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  for (const s of houses) {
    const cy = Math.cos(s.yaw);
    const sy = Math.sin(s.yaw);
    const toW = (lx, lz) => ({ x: s.x + lx * cy + lz * sy, z: s.z - lx * sy + lz * cy });
    const gAt = (lx, lz) => {
      const p = toW(lx, lz);
      return beachY(p.x, p.z);
    };

    const { w, d, floorY, stories, storyH } = s;
    const H = stories * storyH;
    const yE = floorY + H;
    const t = 0.14;
    const rimH = 0.24;
    const st = { trim: s.trim, accent: s.accent, doorGlass: !!s.doorGlass };

    B.pushAt(s.x, 0, s.z, s.yaw);

    // Fundação profunda (nunca flutua mesmo com relevo irregular na areia)
    if (s.foundation === 'stone') {
      const bot = gAt(0, 0) - 2.0;
      const top = floorY - rimH + 0.04;
      const hh = top - bot;
      B.box('stone', 0, bot + hh / 2, 0, w + 0.04, hh, d + 0.04, { grain: 0, tint: C.stone });
    } else {
      const stilts = s.foundation === 'stilts';
      const nx = 3;
      const nz = 3;
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const lx = -w / 2 + 0.16 + (i * (w - 0.32)) / (nx - 1);
        const lz = -d / 2 + 0.16 + (j * (d - 0.32)) / (nz - 1);
        const bot = gAt(lx, lz) - 2.2;
        const top = floorY - rimH + 0.03;
        if (stilts) {
          B.cyl('wood', lx, bot, lz, 0.1, 0.12, top - bot, { segs: 8, tint: woodTone(rand), tidal: true });
        } else {
          B.box('wood', lx, (bot + top) / 2, lz, 0.16, top - bot, 0.16, { grain: 1, tint: woodTone(rand) });
        }
      }
      if (stilts) {
        const yT = floorY - rimH - 0.15;
        const yB = Math.max(gAt(0, 0) + 0.2, yT - 1.5);
        for (const sz of [-1, 1]) {
          B.beam('wood', [-w / 2 + 0.16, yT, sz * (d / 2 - 0.12)], [w / 2 - 0.16, yB, sz * (d / 2 - 0.12)], 0.045, 0.14, { tint: woodTone(rand) });
          B.beam('wood', [-w / 2 + 0.16, yB, sz * (d / 2 - 0.12)], [w / 2 - 0.16, yT, sz * (d / 2 - 0.12)], 0.045, 0.14, { tint: woodTone(rand) });
        }
      }
    }

    // Paredes, faixa de rodapé e cantoneiras
    const wy = floorY + H / 2;
    B.box('wood', 0, wy, 0, w, H, d, { grain: 0, tint: s.wall });
    B.box('wood', 0, floorY - rimH / 2, 0, w + 0.08, rimH, d + 0.08, { grain: 0, tint: s.trim });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      B.box('wood', sx * (w / 2 - 0.04), wy, sz * (d / 2 - 0.04), 0.14, H + 0.02, 0.14, { grain: 1, tint: s.trim });
    }
    if (stories > 1) {
      B.box('wood', 0, floorY + storyH, 0, w + 0.06, 0.16, d + 0.06, { grain: 0, tint: s.trim });
    }

    // Telhado (gable, gableFront ou hip)
    const isThatch = s.roofMat === 'thatch';
    const roofKey = isThatch ? 'thatch' : 'roofMetal';
    const roofTint = isThatch ? C.thatch : (s.roofColor || ROOFS.red);
    const a = isThatch ? 0.66 : 0.44;
    const ta = Math.tan(a);
    const T = isThatch ? 0.24 : 0.06;
    const ovE = isThatch ? 0.58 : 0.44;
    const ovR = isThatch ? 0.42 : 0.32;
    const r0 = 0.12;
    let ridgeY = yE + 1.2;

    if (s.roof === 'gable') {
      const X = w / 2 + ovR;
      const yR = yE + r0 + (d / 2) * ta;
      const zf = d / 2 + ovE;
      const yF = yE + r0 - ovE * ta;
      B.slab(roofKey, [V3(-X, yF, zf), V3(X, yF, zf), V3(X, yR, 0), V3(-X, yR, 0)], T, { up: _UP, uDir: V3(0, yR - yF, -zf), tint: roofTint });
      B.slab(roofKey, [V3(X, yF, -zf), V3(-X, yF, -zf), V3(-X, yR, 0), V3(X, yR, 0)], T, { up: _UP, uDir: V3(0, yR - yF, zf), tint: roofTint });
      for (const sx of [-1, 1]) {
        const gPts = [V3(0, 0, -d / 2), V3(0, 0, d / 2), V3(0, yR - yE, 0)];
        B.slab('wood', gPts.map((q) => V3(sx * (w / 2 - 0.05), yE + q.y, q.z)), t, { up: V3(sx, 0, 0), tint: s.wall });
      }
      ridgeY = yR;
    } else if (s.roof === 'gableFront') {
      const Z = d / 2 + ovR;
      const yR = yE + r0 + (w / 2) * ta;
      const xe = w / 2 + ovE;
      const yF = yE + r0 - ovE * ta;
      B.slab(roofKey, [V3(xe, yF, Z), V3(xe, yF, -Z), V3(0, yR, -Z), V3(0, yR, Z)], T, { up: _UP, uDir: V3(-xe, yR - yF, 0), tint: roofTint });
      B.slab(roofKey, [V3(-xe, yF, -Z), V3(-xe, yF, Z), V3(0, yR, Z), V3(0, yR, -Z)], T, { up: _UP, uDir: V3(xe, yR - yF, 0), tint: roofTint });
      for (const sz of [-1, 1]) {
        const gPts = [V3(-w / 2, yE, sz * (d / 2 - 0.05)), V3(w / 2, yE, sz * (d / 2 - 0.05)), V3(0, yR, sz * (d / 2 - 0.05))];
        B.slab('wood', gPts, t, { up: V3(0, 0, sz), tint: s.wall });
      }
      ridgeY = yR;
    } else {
      const ov = ovE;
      const yR = yE + r0 + (d / 2) * ta;
      const ye = yE + r0 - ov * ta;
      const XE = w / 2 + ov;
      const ZE = d / 2 + ov;
      const XR = Math.max(0.1, (w - d) / 2);
      B.slab(roofKey, [V3(-XE, ye, ZE), V3(XE, ye, ZE), V3(XR, yR, 0), V3(-XR, yR, 0)], T, { up: _UP, uDir: V3(0, yR - ye, -ZE), tint: roofTint });
      B.slab(roofKey, [V3(XE, ye, -ZE), V3(-XE, ye, -ZE), V3(-XR, yR, 0), V3(XR, yR, 0)], T, { up: _UP, uDir: V3(0, yR - ye, ZE), tint: roofTint });
      B.slab(roofKey, [V3(XE, ye, ZE), V3(XE, ye, -ZE), V3(XR, yR, 0)], T, { up: _UP, uDir: V3(-XE + XR, yR - ye, 0), tint: roofTint });
      B.slab(roofKey, [V3(-XE, ye, -ZE), V3(-XE, ye, ZE), V3(-XR, yR, 0)], T, { up: _UP, uDir: V3(XE - XR, yR - ye, 0), tint: roofTint });
      ridgeY = yR;
    }

    // Portas, janelas e lanterna da varanda
    B.pushAt(0, 0, d / 2, 0);
    addDoorUnit(B, 0, floorY, st);
    addWallLantern(B, 0.78, floorY + 1.95, 0.0);
    for (const wx of [-w * 0.3, w * 0.3]) {
      if (Math.abs(wx) > 1.0) addWindowUnit(B, wx, floorY + 0.88, 0.82, 1.15, st, rand);
    }
    if (stories > 1) {
      for (const wx of [-w * 0.28, 0, w * 0.28]) addWindowUnit(B, wx, floorY + storyH + 0.85, 0.82, 1.1, st, rand);
    }
    B.pop();
    // Janelas laterais e fundos
    for (const [fx, fz, ry] of [[w / 2, 0, Math.PI / 2], [-w / 2, 0, -Math.PI / 2], [0, -d / 2, Math.PI]]) {
      B.pushAt(fx, 0, fz, ry);
      addWindowUnit(B, 0, floorY + 0.9, 0.8, 1.1, st, rand);
      B.pop();
    }

    // Varanda frontal e escada
    if (s.porch) {
      const pd = s.porch.depth;
      const pz0 = d / 2;
      const pz1 = d / 2 + pd;
      const porchY = floorY - 0.05;
      B.box('wood', 0, porchY - 0.02, (pz0 + pz1) / 2, w + 0.04, 0.04, pd, { grain: 0, tint: woodTone(rand, C.woodDeck) });
      B.box('wood', 0, porchY - 0.14, pz1 - 0.03, w + 0.08, 0.2, 0.06, { grain: 0, tint: s.trim });
      // Pilares da varanda até a areia
      const yAtt = stories > 1 ? floorY + storyH : yE - 0.05;
      const yEnd = yAtt - pd * 0.28;
      for (const px of [-w / 2 + 0.1, 0, w / 2 - 0.1]) {
        const gBot = gAt(px, pz1 - 0.12) - 1.8;
        B.box('wood', px, (porchY - 0.2 + gBot) / 2, pz1 - 0.12, 0.14, porchY - 0.2 - gBot, 0.14, { grain: 1, tint: woodTone(rand) });
        if (px !== 0) {
          B.box('wood', px, (porchY + yEnd - 0.16) / 2, pz1 - 0.12, 0.12, yEnd - 0.16 - porchY, 0.12, { grain: 1, tint: s.trim });
        }
      }
      // Telhado da varanda
      B.slab(roofKey, [V3(-w / 2 - 0.2, yEnd, pz1 + 0.28), V3(w / 2 + 0.2, yEnd, pz1 + 0.28), V3(w / 2 + 0.2, yAtt, pz0), V3(-w / 2 - 0.2, yAtt, pz0)], isThatch ? 0.18 : 0.05, {
        up: _UP, uDir: V3(0, yAtt - yEnd, -pd - 0.28), tint: roofTint,
      });
      // Guarda-corpo da varanda (com abertura central para escada)
      for (const side of [-1, 1]) {
        const xA = side * 0.68;
        const xB = side * (w / 2 - 0.1);
        B.beam('wood', [xA, porchY + 0.86, pz1 - 0.12], [xB, porchY + 0.86, pz1 - 0.12], 0.09, 0.045, { tint: s.trim });
        B.beam('wood', [xA, porchY + 0.14, pz1 - 0.12], [xB, porchY + 0.14, pz1 - 0.12], 0.06, 0.045, { tint: s.trim });
        if (s.porch.rail === 'x') {
          B.beam('wood', [xA, porchY + 0.16, pz1 - 0.12], [xB, porchY + 0.84, pz1 - 0.12], 0.035, 0.06, { tint: s.trim });
          B.beam('wood', [xA, porchY + 0.84, pz1 - 0.12], [xB, porchY + 0.16, pz1 - 0.12], 0.035, 0.06, { tint: s.trim });
        } else {
          const nBal = Math.max(2, Math.floor(Math.abs(xB - xA) / 0.18));
          for (let i = 1; i < nBal; i++) {
            const bx = xA + ((xB - xA) * i) / nBal;
            B.box('wood', bx, porchY + 0.5, pz1 - 0.12, 0.035, 0.7, 0.035, { grain: 1, tint: s.trim });
          }
        }
      }
      // Rede secando no guarda-corpo das palafitas
      if (s.railNet) {
        const netPart = gridPart(8, 6, (i, j) => {
          const u = i / 8;
          const v = j / 6;
          return {
            p: [-w / 2 + 0.2 + u * (w / 2 - 0.92), porchY + 0.88 - v * 0.72, pz1 - 0.04 + Math.sin(u * 9) * 0.04],
            n: [0, 0, 1],
            uv: [u * 1.6, v * 1.2],
          };
        });
        B.add('net', netPart, new THREE.Matrix4(), s.railNet);
      }
      // Degraus da varanda até a areia
      const gFront = gAt(0, pz1 + 0.8);
      const nS = Math.max(2, Math.ceil((porchY - gFront) / 0.21));
      const stepRh = (porchY - gFront) / nS;
      const tread = 0.28;
      for (let k = 1; k < nS; k++) {
        const top = porchY - k * stepRh;
        const zc = pz1 + (k - 0.5) * tread;
        B.box('wood', 0, top - 0.02, zc, 1.2, 0.04, tread + 0.02, { grain: 0, tint: woodTone(rand) });
      }
      for (const side of [-1, 1]) {
        B.beam('wood', [side * 0.62, porchY - 0.1, pz1 - 0.02], [side * 0.62, gFront - 0.15, pz1 + nS * tread], 0.05, 0.22, { tint: s.trim });
      }
    }

    // Extras arquitetônicos: chaminé, tubo de fogão, antena, caixa d'água, boias
    if (s.stovepipe) {
      B.cyl('hard', w * 0.22, ridgeY - 0.3, -d * 0.22, 0.08, 0.08, 1.15, { segs: 8, tint: C.iron });
      B.cyl('hard', w * 0.22, ridgeY + 0.85, -d * 0.22, 0.02, 0.2, 0.14, { segs: 8, tint: C.iron });
    }
    if (s.chimney) {
      const cx = s.chimney * (w / 2 + 0.34);
      const g = gAt(cx, 0) - 1.4;
      const top = ridgeY + 0.6;
      B.box('stone', cx, (g + top) / 2, 0, 0.7, top - g, 0.8, { tint: C.stone });
      B.box('stone', cx, top + 0.04, 0, 0.82, 0.08, 0.92, { tint: C.cream });
    }
    if (s.antenna) {
      B.rod('hard', [-w * 0.28, ridgeY - 0.1, 0], [-w * 0.28, ridgeY + 2.3, 0], 0.022, 0.018, { segs: 5, tint: C.galv });
      for (const hy of [1.7, 2.05]) {
        B.rod('hard', [-w * 0.28, ridgeY + hy, -0.5], [-w * 0.28, ridgeY + hy, 0.5], 0.008, 0.008, { segs: 4, tint: C.galv });
      }
    }
    if (s.buoys) {
      B.pushAt(s.buoys * (w / 2 + 0.04), 0, 0, (s.buoys * Math.PI) / 2);
      addBuoyString(B, [-d / 2 + 0.5, floorY + 2.25, 0.06], [d / 2 - 0.7, floorY + 2.25, 0.06], 4, rand, 0.24);
      B.pop();
    }
    B.pop();

    if (s.tank) {
      const tp = toW(s.tank * (w / 2 + 1.2), -d / 4);
      addWaterTank(B, tp.x, beachY(tp.x, tp.z) - 0.1, tp.z, rand);
    }
    if (s.woodpile) {
      const wp = toW(-s.woodpile * (w / 2 + 0.48), -d / 4);
      addWoodpile(B, wp.x, beachY(wp.x, wp.z), wp.z, s.yaw + Math.PI / 2, rand);
    }
  }

  // Boathouse (garagem de barco aberta para o mar com rampa e bandeira ao vento)
  {
    const bh = boathouse;
    const { w, d, floorY } = bh;
    const yE = floorY + 2.75;
    const wallBot = floorY - 1.6;
    const hW = yE - wallBot;
    B.pushAt(bh.x, 0, bh.z, bh.yaw);
    for (const px of [-w / 2 + 0.09, w / 2 - 0.09]) for (let k = 0; k < 4; k++) {
      const pz = -d / 2 + 0.1 + (k * (d - 0.2)) / 3;
      B.box('wood', px, (wallBot + yE) / 2, pz, 0.18, yE - wallBot, 0.18, { grain: 1, tint: woodTone(rand) });
    }
    B.box('wood', 0, wallBot + hW / 2, -d / 2 + 0.05, w, hW, 0.08, { grain: 0, tint: bh.wall });
    for (const sx of [-1, 1]) B.box('wood', sx * (w / 2 - 0.05), wallBot + hW / 2, 0, 0.08, hW, d - 0.1, { grain: 2, tint: bh.wall });
    B.box('wood', 0, yE - 0.14, d / 2 - 0.09, w, 0.28, 0.16, { grain: 0, tint: woodTone(rand) });
    const yR = yE + 0.1 + (w / 2) * Math.tan(0.5);
    const Z = d / 2 + 0.45;
    const xe = w / 2 + 0.4;
    const yF = yE + 0.1 - 0.4 * Math.tan(0.5);
    B.slab('roofMetal', [V3(xe, yF, Z), V3(xe, yF, -Z), V3(0, yR, -Z), V3(0, yR, Z)], 0.05, { up: _UP, uDir: V3(-xe, yR - yF, 0), tint: bh.roofColor });
    B.slab('roofMetal', [V3(-xe, yF, -Z), V3(-xe, yF, Z), V3(0, yR, Z), V3(0, yR, -Z)], 0.05, { up: _UP, uDir: V3(xe, yR - yF, 0), tint: bh.roofColor });
    addRowboat(B, 0.3, floorY + 0.25, 0.1, 0, { hull: lin(0xd9d2bf), bottom: lin(0x2f5f7a), trim: lin(0x2f5f7a), length: 4.1 });
    addOar(B, [-w / 2 + 0.15, floorY + 0.4, -1.5], [-w / 2 + 0.15, floorY + 2.4, -1.2], C.red, rand);
    addLanternGeo(B, 0, yR - 0.22, 0.8, 0.95);
    // Rampa de madeira (slipway) descendo para a água
    for (const sx of [-0.55, 1.15]) {
      B.beam('wood', [sx, floorY + 0.06, d / 2 - 0.2], [sx, waterY - 0.65, d / 2 + 6.5], 0.14, 0.12, { tint: woodTone(rand), tidal: true });
    }
    B.pop();

    // Mastro com flâmula animada ao vento
    const fx = bh.x - w / 2 - 0.7;
    const fz = bh.z + d / 2 - 0.4;
    const fg = beachY(fx, fz);
    B.cyl('wood', fx, fg - 1.2, fz, 0.035, 0.06, 6.4, { segs: 7, tint: C.white });
    B.lathe('hard', fx, fg + 5.2, fz, [[0, 0], [0.05, 0.02], [0.05, 0.06], [0, 0.09]], { segs: 7, tint: C.brass });
    const flagB = new Builder();
    const flagPart = gridPart(8, 2, (i, j) => {
      const a = (i / 8) * 1.25;
      const hh = 0.52 * (1 - (0.72 * i) / 8);
      return { p: [a, -0.08 - (j / 2 - 0.5) * hh - 0.26, 0], n: [0, 0, 1], uv: [i / 8, j / 2] };
    });
    flagB.add('fabric', flagPart, new THREE.Matrix4(), C.red);
    flagEntries.push({ pivot: new THREE.Vector3(fx, fg + 5.15, fz), builder: flagB, phase: rand.range(0, TAU) });
  }

  // Galpões de ferramentas
  for (const sh of sheds) {
    const sy = beachY(sh.x, sh.z);
    B.pushAt(sh.x, 0, sh.z, sh.yaw);
    const bot = sy - 1.2;
    const hF = 2.25;
    const hB = 1.92;
    const base = sy + 0.14;
    B.box('wood', 0, (bot + base + hB) / 2, 0, sh.w, base + hB - bot, sh.d, { grain: 0, tint: sh.wall });
    B.box('wood', 0.12, base + 0.9, sh.d / 2 + 0.02, 0.8, 1.75, 0.04, { grain: 1, tint: sh.door });
    B.slab('roofMetal', [
      V3(-sh.w / 2 - 0.2, base + hB + 0.02, -sh.d / 2 - 0.22),
      V3(sh.w / 2 + 0.2, base + hB + 0.02, -sh.d / 2 - 0.22),
      V3(sh.w / 2 + 0.2, base + hF + 0.08, sh.d / 2 + 0.28),
      V3(-sh.w / 2 - 0.2, base + hF + 0.08, sh.d / 2 + 0.28),
    ], 0.04, { up: _UP, uDir: V3(0, hF - hB, sh.d + 0.5), tint: ROOFS.rust });
    B.pop();
  }
}

function construirAderecosPraia(B, frame, spec) {
  const { rand } = spec;
  const { beachY } = frame;

  // Botes na areia da praia (virados de cabeça para baixo e um pronto para ir à água)
  const boats = [
    { x: -18.5, z: -3.2, ry: 0.42, up: true, hull: lin(0x2f8f9a), bottom: lin(0xa0402e) },
    { x: -21.4, z: -5.6, ry: 0.58, up: true, hull: lin(0xe9e4d6), bottom: lin(0x2e5f86) },
    { x: 5.5, z: -2.4, ry: -0.34, up: false, hull: lin(0xd8c35a), bottom: lin(0x3e6f5a), rz: 0.14 },
  ];
  for (const b of boats) {
    addRowboat(B, b.x, beachY(b.x, b.z) + (b.up ? 0.0 : 0.05), b.z, b.ry, { upsideDown: b.up, hull: b.hull, bottom: b.bottom, rz: b.rz || 0 });
  }
  addOar(B, [-17.4, beachY(-17.4, -2.0) + 0.04, -2.0], [-15.8, beachY(-15.8, -4.1) + 0.06, -4.1], C.red, rand);

  // Casco de naufrágio antigo na faixa da praia
  addWreck(B, 28.0, beachY(28.0, -1.5), -1.5, 0.88, rand);

  // Varais de redes e secador de peixe
  addNetRack(B, -10.8, beachY(-10.8, -4.2), -4.2, 0.25, 3.0, lin(0x3f6f5f), rand);
  addNetRack(B, 14.5, beachY(14.5, -3.6), -3.6, -0.18, 3.0, lin(0x2f5f8a), rand);
  addFishRack(B, 12.6, beachY(12.6, -15.5), -15.5, 0.22, 2.5, rand);

  // Cercas costeiras
  addFence(B, [[-21.8, -19.2], [-21.2, -25.8], [-17.8, -28.0]], beachY, 'picket', TRIMS.white, rand);
  addFence(B, [[8.2, -22.8], [9.6, -28.0]], beachY, 'rail', TRIMS.cream, rand);

  // Barris, caixotes, armadilhas de lagosta e boias espalhados pelo porto e praia
  const clutter = [
    ['barrel', 2.4, -7.2], ['barrel', 3.05, -7.8], ['crate', 2.5, -6.1],
    ['trap', -2.5, -6.5], ['trap', -2.6, -7.2], ['crate', -3.3, -7.8],
    ['trap', 10.6, -11.4], ['barrel', 15.8, -11.8],
    ['crate', -9.4, -12.6], ['barrel', -9.9, -13.2],
  ];
  for (const [kind, cx, cz] of clutter) {
    const gy = beachY(cx, cz) - 0.02;
    if (kind === 'barrel') addBarrel(B, cx, gy, cz, rand);
    else if (kind === 'crate') addCrate(B, cx, gy, cz, rand.range(0, 1.5), rand);
    else addTrap(B, cx, gy, cz, rand.range(0, 0.6), rand);
  }
  addRopeCoil(B, 3.4, beachY(3.4, -5.8), -5.8, 0.08, 0.3, 4);
  addBuoy(B, 4.2, beachY(4.2, -5.4), -5.4, C.orange, C.white, 0, { rz: 1.35, ry: 0.7 });
  addBuoy(B, -6.8, beachY(-6.8, -5.2), -5.2, C.red, C.white, 0, { rz: 1.4, ry: 2.1 });
}

// ---- Fábrica 3D principal ------------------------------------------------------------------------------------------

export function createVilaCosteira3D({ scene = null } = {}) {
  const group = new THREE.Group();
  group.name = 'VilaCosteira3D';
  if (scene && typeof scene.add === 'function') scene.add(group);

  let assets = null;
  const activeVilas = [];
  let lastSig = '';
  let builtEntries = [];

  function garantirAssets() {
    if (!assets) assets = criarTexturasEMateriais();
    return assets;
  }

  function limparVilasConstruidas() {
    for (const entry of builtEntries) {
      if (entry.root.parent === group) group.remove(entry.root);
      for (const g of entry.geometries) g.dispose();
      for (const l of entry.pointLights) {
        if (l.light) {
          l.light.parent?.remove(l.light);
          l.light.dispose?.();
        }
      }
    }
    builtEntries = [];
  }

  function limpar() {
    limparVilasConstruidas();
    activeVilas.length = 0;
    lastSig = '';
    if (assets) {
      for (const m of assets.materials) m.dispose();
      for (const t of assets.textures) t.dispose();
      assets = null;
    }
  }

  function construirVila(vila) {
    const layout = obterLayoutVila(vila);
    if (!layout) return null;
    const { frame, spec } = layout;
    const { mats } = garantirAssets();
    const root = new THREE.Group();
    root.name = `Vila_${frame.id}`;
    root.position.set(frame.ox, 0, frame.oz);
    root.rotation.y = frame.ry;

    const B = new Builder(frame.waterY);
    const hangList = [];
    const pointLightsRaw = [];
    const flagEntries = [];

    const pierInfo = construirPier(B, frame, spec, hangList, pointLightsRaw);
    construirPassarelas(B, frame, spec);
    construirBancas(B, frame, spec, pointLightsRaw);
    construirCasas(B, frame, spec, flagEntries);
    construirAderecosPraia(B, frame, spec);

    const geometries = [];
    for (const key in B.batches) {
      const batch = B.batches[key];
      if (!batch || batch.vcount === 0) continue;
      const mat = mats[key] || mats.wood;
      const geo = batch.build();
      geometries.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `vila_${key}`;
      const isTranslucent = key === 'net' || key === 'windowGlass' || key === 'lanternGlass';
      mesh.castShadow = !isTranslucent;
      mesh.receiveShadow = key !== 'lanternGlass' && key !== 'windowGlass';
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      root.add(mesh);
    }

    // Placa oscilante do portal do píer
    let signObj = null;
    if (pierInfo.signBuilder && pierInfo.signPivot) {
      signObj = new THREE.Group();
      signObj.name = 'vila_placa_pier';
      signObj.position.copy(pierInfo.signPivot);
      signObj.rotation.order = 'YXZ';
      for (const key in pierInfo.signBuilder.batches) {
        const batch = pierInfo.signBuilder.batches[key];
        if (!batch || batch.vcount === 0) continue;
        const geo = batch.build();
        geometries.push(geo);
        const m = new THREE.Mesh(geo, mats[key] || mats.wood);
        m.castShadow = true;
        m.receiveShadow = true;
        signObj.add(m);
      }
      root.add(signObj);
    }

    // Lanternas suspensas que balançam ao vento
    const lanterns = [];
    for (const h of hangList) {
      const g = new THREE.Group();
      g.name = 'vila_lanterna';
      g.position.copy(h.pivot);
      for (const key in h.builder.batches) {
        const batch = h.builder.batches[key];
        if (!batch || batch.vcount === 0) continue;
        const geo = batch.build();
        geometries.push(geo);
        const m = new THREE.Mesh(geo, mats[key] || mats.hard);
        m.castShadow = false;
        m.receiveShadow = key !== 'lanternGlass';
        g.add(m);
      }
      root.add(g);
      lanterns.push({ obj: g, t: h.t, ph: h.ph, x: 0, z: 0, vx: 0, vz: 0 });
    }

    // Flâmulas ao vento
    const flags = [];
    for (const f of flagEntries) {
      const g = new THREE.Group();
      g.name = 'vila_flamula';
      g.position.copy(f.pivot);
      for (const key in f.builder.batches) {
        const batch = f.builder.batches[key];
        if (!batch || batch.vcount === 0) continue;
        const geo = batch.build();
        geometries.push(geo);
        const m = new THREE.Mesh(geo, mats.fabric);
        m.castShadow = true;
        g.add(m);
      }
      root.add(g);
      flags.push({ obj: g, phase: f.phase });
    }

    // Pontos de luz noturnos (sem sombra extra, intensidade 0 de dia)
    const pointLights = [];
    for (const pl of pointLightsRaw) {
      const light = new THREE.PointLight(0xffaa55, 0, pl.dist, 1.7);
      light.position.copy(pl.pos);
      light.castShadow = false;
      root.add(light);
      pointLights.push({ light, base: pl.base });
    }

    group.add(root);
    return {
      frame,
      root,
      geometries,
      signObj,
      swing: { t: 0, a: 0, av: 0, b: 0, bv: 0 },
      lanterns,
      flags,
      pointLights,
    };
  }

  function sincronizar(vilaOuLista) {
    const lista = Array.isArray(vilaOuLista)
      ? vilaOuLista.filter((v) => v && typeof v === 'object')
      : (vilaOuLista && typeof vilaOuLista === 'object' ? [vilaOuLista] : []);

    const sig = lista.map((v) => {
      const x = Number(v.x) || 0;
      const y = Number.isFinite(v.y) ? v.y : SEA;
      const z = Number(v.z) || 0;
      const dir = Number(v.dir) || 0;
      return `${v.id ?? ''}:${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${dir.toFixed(4)},${seedDeVila(v)}`;
    }).join('|');

    if (sig === lastSig) return;
    limparVilasConstruidas();
    activeVilas.length = 0;
    lastSig = sig;

    if (lista.length === 0) return;
    for (const v of lista) {
      const copy = { ...v };
      activeVilas.push(copy);
      const entry = construirVila(copy);
      if (entry) builtEntries.push(entry);
    }
  }

  function atualizar(dt = 1 / 60, t = 0, nightFactor = 0, vento = PADRAO_VENTO) {
    if (!assets || builtEntries.length === 0) return;
    const stepDt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0.001, 0.1);
    const time = Number.isFinite(t) ? t : 0;
    const nf = clamp(Number.isFinite(nightFactor) ? nightFactor : 0, 0, 1);
    const glowK = smoothstep(0.12, 0.72, nf);
    const flicker = 0.92 + 0.08 * Math.sin(time * 8.3) * Math.sin(time * 4.7 + 1.1);

    assets.mats.lanternGlass.emissiveIntensity = glowK * 2.8 * flicker;
    assets.mats.windowGlass.emissiveIntensity = glowK * 1.35;

    const w = normalizarVento(vento);
    const windSpeed = 2.5 + w.z * 7.5;
    const subSteps = Math.max(1, Math.ceil(stepDt / (1 / 90)));
    const h = stepDt / subSteps;
    const W = 5.4;
    const Z = 0.06;
    const WSign = 4.9;
    const WTwist = 10.2;

    for (const entry of builtEntries) {
      const { frame, signObj, swing, lanterns, flags, pointLights } = entry;
      // Converte vento mundial para o plano horizontal local da vila
      const lwx = w.x * frame.rx + w.y * frame.rz;
      const lwz = w.x * frame.fx + w.y * frame.fz;

      for (const pl of pointLights) {
        pl.light.intensity = glowK * pl.base * flicker;
      }

      for (const l of lanterns) {
        for (let i = 0; i < subSteps; i++) {
          const lt = (l.t += h);
          const p = l.ph;
          const gust = 1 + 0.4 * Math.sin(lt * 0.73 + p) * Math.sin(lt * 0.31 + p * 0.5) + 0.25 * Math.sin(lt * 2.3 + Math.sin(lt * 0.9 + p) * 1.5);
          const px = 0.0011 * windSpeed * windSpeed * gust * lwx + 0.0012 * windSpeed * Math.sin(lt * 1.9 + p);
          const pz = 0.0011 * windSpeed * windSpeed * gust * lwz + 0.0012 * windSpeed * Math.sin(lt * 1.6 + p * 1.7);
          l.vx += (W * W * (px - l.x) - 2 * Z * W * l.vx) * h;
          l.x += l.vx * h;
          l.vz += (W * W * (pz - l.z) - 2 * Z * W * l.vz) * h;
          l.z += l.vz * h;
        }
        l.obj.rotation.set(l.z, 0, -l.x);
      }

      if (signObj) {
        for (let i = 0; i < subSteps; i++) {
          const st = (swing.t += h);
          const gust = 1 + 0.35 * Math.sin(st * 0.73 + 1.3) * Math.sin(st * 0.31) + 0.2 * Math.sin(st * 2.1 + Math.sin(st * 0.9));
          const push = -0.0033 * windSpeed * windSpeed * gust * lwz * Math.abs(lwz) - 0.0009 * windSpeed * Math.sin(st * 1.7);
          swing.av += (WSign * WSign * (push * Math.cos(swing.a) - Math.sin(swing.a)) - 2 * 0.07 * WSign * swing.av) * h;
          swing.a += swing.av * h;
          const twist = 0.004 * windSpeed * windSpeed * lwx * lwz * gust + 0.0015 * windSpeed * Math.sin(st * 2.9 + 1.1);
          swing.bv += (WTwist * WTwist * (twist - swing.b) - 2 * 0.12 * WTwist * swing.bv) * h;
          swing.b += swing.bv * h;
        }
        signObj.rotation.set(swing.a, swing.b, 0);
      }

      const windYaw = Math.atan2(-lwz, lwx);
      for (const f of flags) {
        f.obj.rotation.y = windYaw + Math.sin(time * 5.2 + f.phase) * 0.16;
      }
    }
  }

  function alturaPisoEm(x, z, yPes = Infinity) {
    let best = null;
    for (let i = 0; i < activeVilas.length; i++) {
      const h = alturaPisoVilaEm(activeVilas[i], x, z, yPes);
      if (h !== null && (best === null || h > best)) best = h;
    }
    return best;
  }

  function colideObstaculoEm(x, y, z, raio = 0.32) {
    for (let i = 0; i < activeVilas.length; i++) {
      if (colideObstaculoVilaEm(activeVilas[i], x, y, z, raio)) return true;
    }
    return false;
  }

  function resolverColisaoEm(pos, raio = 0.32, altura = 1.75) {
    let hit = false;
    let lastRes = { hit: false, nx: 0, nz: 0, pen: 0, tag: '' };
    for (let i = 0; i < activeVilas.length; i++) {
      const r = resolverColisaoVilaEm(activeVilas[i], pos, raio, altura);
      if (r.hit) {
        hit = true;
        lastRes = r;
      }
    }
    return hit ? lastRes : { hit: false, nx: 0, nz: 0, pen: 0, tag: '' };
  }

  function pontoAtracacaoBarco(vila = null) {
    const target = vila || activeVilas[0] || null;
    return target ? pontoAtracacaoVila(target) : null;
  }

  function obterMarcadores() {
    const out = [];
    for (let i = 0; i < activeVilas.length; i++) {
      const list = obterMarcadoresVila(activeVilas[i]);
      for (let j = 0; j < list.length; j++) out.push(list[j]);
    }
    return out;
  }

  function dispose() {
    limpar();
    // Garante remoção de quaisquer restos de cena caso algo tenha sido anexado ao grupo
    group.traverse((child) => {
      if (child.geometry && !child.geometry.userData?.shared) child.geometry.dispose();
      if (child.material) {
        const list = Array.isArray(child.material) ? child.material : [child.material];
        for (const m of list) {
          if (!m || m.userData?.shared) continue;
          for (const slot of MAT_TEX_SLOTS) m[slot]?.dispose?.();
          m.dispose?.();
        }
      }
    });
    group.clear();
    if (group.parent) group.parent.remove(group);
  }

  return {
    group,
    sincronizar,
    atualizar,
    alturaPisoEm,
    colideObstaculoEm,
    resolverColisaoEm,
    pontoAtracacaoBarco,
    obterMarcadores,
    limpar,
    dispose,
  };
}
