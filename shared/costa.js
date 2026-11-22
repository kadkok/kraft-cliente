// LAVRA — física hidrostática, cinemática de convés e posicionamento determinístico da Costa Tidewater.
// Portado e adaptado do Tidewater (MIT License — referência /tmp/tidewater-ref/src/player/BoatController.js).
//
// Convenção de coordenadas do barco Tidewater (~8,2 m Downeast):
//   +Z = proa (avante), +Y = cima, +X = bombordo (port, esquerda quando olhando para a proa).
//   y = 0 é a linha d'água de projeto; yaw = 0 aponta a proa para +Z; esterço positivo (+1) vira para bombordo (+yaw em +Y).
import { SEA } from './constants.js';
import { hash3, clamp, lerp, smoothstep } from './noise.js';
import { MAR_NIVEL, alturaMar, estadoDoTempo, multMar, ventoMar } from './mar.js';
import { NIVEL_MAR_REPOUSO, PADRAO_VENTO, alturaOnda } from './ondas.js';

export const COSTA_VERSAO = 1;
export const RHO_AGUA_MAR = 1025;
export const GRAVIDADE_COSTA = 9.81;
const RAD_PARA_GRAU = 180 / Math.PI;
const GRAU_PARA_RAD = Math.PI / 180;

// Dimensões e propriedades hidrostáticas do casco Downeast (~8,2 m, ~3,2 t).
export const DIMENSOES_BARCO_TIDEWATER = Object.freeze({
  comprimento: 8.2,
  boca: 2.9,
  calado: 0.72,
  pontalPopa: 0.98,
  alturaConves: 0.35,
  alturaTeto: 2.52,
  zPopa: -3.9,
  zProa: 4.3,
  cascoEspessura: 0.07,
  casaTras: -0.35,
  casaFrente: 1.45,
  massa: 3204,
  com: Object.freeze([0, 0.3, -0.737679]),
  cb: Object.freeze([0, -0.141727, -0.737679]),
  // Inércia principal no referencial do barco: x = pitch, y = yaw, z = roll (× 1,24 pela casaria/equipamentos).
  inercia: Object.freeze([14564, 15706, 3493 * 1.24]),
  massaAdicional: Object.freeze([0.6, 0.7, 0.05]),     // x (deriva), y (arfagem), z (avanço)
  inerciaAdicional: Object.freeze([1.0, 0.4, 0.2]),   // x (pitch), y (yaw), z (roll)
  helicePos: Object.freeze([0, -0.53, -3.3]),
  lemaPos: Object.freeze([0, -0.52, -3.58]),
  lemaZ: -3.58,
  empuxoMax: 26000,
  velPasso: 16,
  fatorRe: 0.45,
  sustentacaoCasco: 0.5,
  sustentacaoLeme: 2.8,
});

export const POSICAO_LEME_LOCAL = Object.freeze({
  x: -0.55,
  y: 0.35,
  z: 0.22,
  olhoY: 1.85,
  olhoZ: 0.3,
  raio: 1.45,
});

export const POSICAO_EMBARQUE_LOCAL = Object.freeze({
  x: 0,
  y: 0.35,
  z: -1.75,
});

export const PONTOS_SAIDA_LOCAL = Object.freeze([
  Object.freeze([1.35, 1.03, -3.0]),
  Object.freeze([-1.35, 1.03, -3.0]),
  Object.freeze([1.41, 1.03, -2.0]),
  Object.freeze([-1.41, 1.03, -2.0]),
  Object.freeze([1.41, 1.03, -1.2]),
  Object.freeze([-1.41, 1.03, -1.2]),
]);

// 32 patches de empuxo do casco (HullLines.buildHullSamples(8)): sum(area * -y) * 1025 ≈ 3204 kg em y = 0.
export const AMOSTRAS_CASCO_LOCAL = Object.freeze([
  Object.freeze({ x: 0.3101, y: -0.2289, z: -3.4035, area: 0.526, bottomY: -0.2222 }),
  Object.freeze({ x: -0.3101, y: -0.2289, z: -3.4035, area: 0.526, bottomY: -0.2222 }),
  Object.freeze({ x: 0.8206, y: -0.1014, z: -3.405, area: 0.5264, bottomY: -0.0988 }),
  Object.freeze({ x: -0.8206, y: -0.1014, z: -3.405, area: 0.5264, bottomY: -0.0988 }),
  Object.freeze({ x: 0.3299, y: -0.2948, z: -2.4359, area: 0.5484, bottomY: -0.2871 }),
  Object.freeze({ x: -0.3299, y: -0.2948, z: -2.4359, area: 0.5484, bottomY: -0.2871 }),
  Object.freeze({ x: 0.8728, y: -0.1293, z: -2.4368, area: 0.5484, bottomY: -0.1318 }),
  Object.freeze({ x: -0.8728, y: -0.1293, z: -2.4368, area: 0.5484, bottomY: -0.1318 }),
  Object.freeze({ x: 0.3436, y: -0.3449, z: -1.467, area: 0.5832, bottomY: -0.3343 }),
  Object.freeze({ x: -0.3436, y: -0.3449, z: -1.467, area: 0.5832, bottomY: -0.3343 }),
  Object.freeze({ x: 0.9087, y: -0.1532, z: -1.4686, area: 0.5824, bottomY: -0.1545 }),
  Object.freeze({ x: -0.9087, y: -0.1532, z: -1.4686, area: 0.5824, bottomY: -0.1545 }),
  Object.freeze({ x: 0.3464, y: -0.3701, z: -0.49, area: 0.588, bottomY: -0.3602 }),
  Object.freeze({ x: -0.3464, y: -0.3701, z: -0.49, area: 0.588, bottomY: -0.3602 }),
  Object.freeze({ x: 0.9159, y: -0.1687, z: -0.4909, area: 0.5868, bottomY: -0.1752 }),
  Object.freeze({ x: -0.9159, y: -0.1687, z: -0.4909, area: 0.5868, bottomY: -0.1752 }),
  Object.freeze({ x: 0.323, y: -0.366, z: 0.4781, area: 0.5468, bottomY: -0.3558 }),
  Object.freeze({ x: -0.323, y: -0.366, z: 0.4781, area: 0.5468, bottomY: -0.3558 }),
  Object.freeze({ x: 0.8542, y: -0.1627, z: 0.4779, area: 0.546, bottomY: -0.1694 }),
  Object.freeze({ x: -0.8542, y: -0.1627, z: 0.4779, area: 0.546, bottomY: -0.1694 }),
  Object.freeze({ x: 0.254, y: -0.3191, z: 1.4284, area: 0.4144, bottomY: -0.3121 }),
  Object.freeze({ x: -0.254, y: -0.3191, z: 1.4284, area: 0.4144, bottomY: -0.3121 }),
  Object.freeze({ x: 0.6721, y: -0.1315, z: 1.428, area: 0.414, bottomY: -0.1324 }),
  Object.freeze({ x: -0.6721, y: -0.1315, z: 1.428, area: 0.414, bottomY: -0.1324 }),
  Object.freeze({ x: 0.146, y: -0.2183, z: 2.3508, area: 0.2228, bottomY: -0.2053 }),
  Object.freeze({ x: -0.146, y: -0.2183, z: 2.3508, area: 0.2228, bottomY: -0.2053 }),
  Object.freeze({ x: 0.3858, y: -0.082, z: 2.3504, area: 0.222, bottomY: -0.0693 }),
  Object.freeze({ x: -0.3858, y: -0.082, z: 2.3504, area: 0.222, bottomY: -0.0693 }),
  Object.freeze({ x: 0.0468, y: -0.1134, z: 3.194, area: 0.046, bottomY: -0.0988 }),
  Object.freeze({ x: -0.0468, y: -0.1134, z: 3.194, area: 0.046, bottomY: -0.0988 }),
  Object.freeze({ x: 0.1217, y: -0.0378, z: 3.2071, area: 0.0472, bottomY: -0.0094 }),
  Object.freeze({ x: -0.1217, y: -0.0378, z: 3.2071, area: 0.0472, bottomY: -0.0094 }),
]);

// Estações laterais ao longo da quilha: [z, área lateral m²] para sustentação direcional e arrasto transversal.
const ESTACOES_QUILHA = [
  [-3.4, 0.73],
  [-2.3, 0.78],
  [-1.2, 0.8],
  [-0.1, 0.77],
  [1.0, 0.62],
  [2.1, 0.33],
  [3.2, 0.14],
];

// Pontos de contato do casco com o fundo do mar/areia [lx, ly, lz].
const PONTOS_CONTATO_FUNDO = [
  [0, -0.7, 3.2],
  [0, -0.75, 0],
  [0, -0.72, -3.4],
  [1.1, -0.4, 1.5],
  [-1.1, -0.4, 1.5],
  [1.2, -0.35, -2.5],
  [-1.2, -0.35, -2.5],
  [0, 0.2, 4.2],
];

// Contorno na linha d'água para colisão lateral contra estacas do píer e obstáculos costeiros.
const CONTORNO_LINHA_AGUA = [
  [0, 0.3, 4.1],
  [1.2, 0.3, 2.0],
  [-1.2, 0.3, 2.0],
  [1.4, 0.3, -1.0],
  [-1.4, 0.3, -1.0],
  [1.2, 0.3, -3.8],
  [-1.2, 0.3, -3.8],
];

// ---- matemática de quatérnions e referencial local <-> mundo --------------------------------------------------------

export function quatDeYaw(yaw = 0, out = [0, 0, 0, 1]) {
  const half = (Number.isFinite(yaw) ? yaw : 0) * 0.5;
  out[0] = 0;
  out[1] = Math.sin(half);
  out[2] = 0;
  out[3] = Math.cos(half);
  return out;
}

export function quatNormalizar(q, out = q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(l > 1e-12)) {
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 1;
    return out;
  }
  const inv = 1 / l;
  out[0] = q[0] * inv;
  out[1] = q[1] * inv;
  out[2] = q[2] * inv;
  out[3] = q[3] * inv;
  return out;
}

export function rotacionarVecPorQuat(vx, vy, vz, q, out = [0, 0, 0]) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;
  out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

export function rotacionarVecPorQuatInv(vx, vy, vz, q, out = [0, 0, 0]) {
  const qx = -q[0], qy = -q[1], qz = -q[2], qw = q[3];
  const ix = qw * vx + qy * vz - qz * vy;
  const iy = qw * vy + qz * vx - qx * vz;
  const iz = qw * vz + qx * vy - qy * vx;
  const iw = -qx * vx - qy * vy - qz * vz;
  out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

export function anguloNormalizado(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// Conversão entre rumo de vila/praia (`dir`, em radianos com cos/sin) e yaw do barco (+Z quando yaw=0).
export function yawDeDirecaoMar(dir = 0) {
  return anguloNormalizado(Math.PI * 0.5 - (Number.isFinite(dir) ? dir : 0));
}

export function direcaoMarDeYaw(yaw = 0) {
  return anguloNormalizado(Math.PI * 0.5 - (Number.isFinite(yaw) ? yaw : 0));
}

function garantirQuatBarco(barco) {
  if (Array.isArray(barco?.q) && barco.q.length === 4 && barco.q.every(Number.isFinite)) return barco.q;
  return quatDeYaw(barco?.yaw || 0, [0, 0, 0, 1]);
}

export function frenteBarco(barco, out = [0, 0, 1]) {
  return rotacionarVecPorQuat(0, 0, 1, garantirQuatBarco(barco), out);
}

export function yawDoBarco(barco) {
  const f = frenteBarco(barco, _tmpF);
  return Math.atan2(f[0], f[2]);
}

export function eulerDoBarco(barco) {
  const f = frenteBarco(barco, _tmpF);
  const s = rotacionarVecPorQuat(1, 0, 0, garantirQuatBarco(barco), _tmpS);
  return {
    yaw: Math.atan2(f[0], f[2]),
    pitch: Math.asin(clamp(-f[1], -1, 1)),
    roll: Math.asin(clamp(s[1], -1, 1)),
  };
}

export function localBarcoParaMundo(barco, lx, ly, lz, out = [0, 0, 0]) {
  const p = barco?.pos || [0, MAR_NIVEL, 0];
  const q = garantirQuatBarco(barco);
  rotacionarVecPorQuat(lx, ly, lz, q, out);
  out[0] += p[0];
  out[1] += p[1];
  out[2] += p[2];
  return out;
}

export function mundoParaLocalBarco(barco, wx, wy, wz, out = [0, 0, 0]) {
  const p = barco?.pos || [0, MAR_NIVEL, 0];
  const q = garantirQuatBarco(barco);
  return rotacionarVecPorQuatInv(wx - p[0], wy - p[1], wz - p[2], q, out);
}

// ---- geometria de convés pura (fallback determinístico quando o cliente 3D ainda não carregou) -------------------

export function meiaBocaConvesLocal(z, y = 0.35) {
  const t = clamp((z - DIMENSOES_BARCO_TIDEWATER.zPopa) / DIMENSOES_BARCO_TIDEWATER.comprimento, 0, 1);
  let sheerX;
  if (t <= 0.42) {
    const a = 1 - t / 0.42;
    sheerX = 1.45 - 0.17 * a * a;
  } else {
    const s = (t - 0.42) / 0.58;
    sheerX = 1.45 * (1 - Math.pow(s, 2.6));
  }
  const alturaFator = y >= 0.85 ? 1 : clamp(0.84 + 0.16 * ((y - 0.35) / 0.5), 0.78, 1);
  return Math.max(0.18, sheerX * alturaFator);
}

export function pontoNoConvesLocalFallback(lx, lz, margem = 0.08) {
  const { zPopa, zProa, cascoEspessura } = DIMENSOES_BARCO_TIDEWATER;
  if (lz < zPopa + cascoEspessura + margem || lz > zProa - 0.25 - margem) return false;
  const maxX = Math.max(0.14, meiaBocaConvesLocal(lz, 0.35) - cascoEspessura - margem);
  return Math.abs(lx) <= maxX;
}

const CAIXAS_CAMINHAVEIS_BARCO = [
  { tag: 'banco', x0: 0.65, x1: 1.07, y1: 0.82, z0: 0.075, z1: 0.825 },
  { tag: 'teto', x0: -1.25, x1: 1.25, y1: 2.38, z0: -0.95, z1: 1.34 },
  { tag: 'armadilha1', x0: 0.385, x1: 0.935, y1: 0.75, z0: -3.725, z1: -2.775 },
  { tag: 'armadilha2', x0: 0.385, x1: 0.935, y1: 1.155, z0: -3.705, z1: -2.755 },
  { tag: 'armadilha3', x0: 0.365, x1: 0.915, y1: 0.75, z0: -2.675, z1: -1.725 },
  { tag: 'armadilha4', x0: -0.955, x1: -0.405, y1: 0.75, z0: -3.725, z1: -2.775 },
  { tag: 'proa1', x0: -1.22, x1: 1.22, y1: 1.12, z0: 1.45, z1: 2.4 },
  { tag: 'proa2', x0: -0.95, x1: 0.95, y1: 1.28, z0: 2.4, z1: 3.3 },
  { tag: 'proa3', x0: -0.6, x1: 0.6, y1: 1.48, z0: 3.3, z1: 4.15 },
];

const CAIXAS_SOLIDAS_BARCO = [
  { tag: 'console', x0: -1.1, x1: 1.1, y0: 0.35, y1: 1.4, z0: 0.98, z1: 1.45 },
  { tag: 'bancoLeme', x0: -0.78, x1: -0.32, y0: 0.35, y1: 1.05, z0: -0.02, z1: 0.43 },
  { tag: 'paredeBB', x0: 1.16, x1: 1.24, y0: 0.98, y1: 2.31, z0: -0.35, z1: 1.45 },
  { tag: 'paredeBE', x0: -1.24, x1: -1.16, y0: 0.98, y1: 2.31, z0: -0.35, z1: 1.45 },
  { tag: 'hauler', x0: 1.0, x1: 1.4, y0: 0.35, y1: 1.35, z0: -1.25, z1: -0.85 },
  { tag: 'barril', x0: 0.6, x1: 1.12, y0: 0.35, y1: 1.15, z0: -1.06, z1: -0.54 },
  { tag: 'banco', x0: 0.65, x1: 1.07, y0: 0.35, y1: 0.82, z0: 0.075, z1: 0.825 },
  { tag: 'teto', x0: -1.25, x1: 1.25, y0: 2.31, y1: 2.38, z0: -0.95, z1: 1.34 },
  { tag: 'armadilha1', x0: 0.385, x1: 0.935, y0: 0.38, y1: 0.75, z0: -3.725, z1: -2.775 },
  { tag: 'armadilha3', x0: 0.365, x1: 0.915, y0: 0.38, y1: 0.75, z0: -2.675, z1: -1.725 },
  { tag: 'armadilha4', x0: -0.955, x1: -0.405, y0: 0.38, y1: 0.75, z0: -3.725, z1: -2.775 },
];

export function alturaConvesLocalFallback(lx, lz, lyAtual = 10) {
  let g = DIMENSOES_BARCO_TIDEWATER.alturaConves;
  const maxY = Number.isFinite(lyAtual) ? lyAtual : 10;
  for (let i = 0; i < CAIXAS_CAMINHAVEIS_BARCO.length; i++) {
    const c = CAIXAS_CAMINHAVEIS_BARCO[i];
    if (lx < c.x0 || lx > c.x1 || lz < c.z0 || lz > c.z1) continue;
    if (c.y1 <= maxY && c.y1 > g) g = c.y1;
  }
  return g;
}

export function resolverObstaculoBarcoLocalFallback(posLocal, velLocal, raio = 0.25, altura = 1.75, passo = 0.45) {
  let x = posLocal[0], z = posLocal[2];
  const y = posLocal[1];
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < CAIXAS_SOLIDAS_BARCO.length; i++) {
      const c = CAIXAS_SOLIDAS_BARCO[i];
      if (c.y1 <= y + passo || c.y0 >= y + altura) continue;
      const cx = (c.x0 + c.x1) * 0.5, cz = (c.z0 + c.z1) * 0.5;
      const hx = (c.x1 - c.x0) * 0.5 + raio, hz = (c.z1 - c.z0) * 0.5 + raio;
      const dx = x - cx, dz = z - cz;
      if (Math.abs(dx) >= hx || Math.abs(dz) >= hz) continue;
      const px = hx - Math.abs(dx), pz = hz - Math.abs(dz);
      if (px < pz) {
        x += (dx >= 0 ? 1 : -1) * px;
        if (velLocal) velLocal[0] = 0;
      } else {
        z += (dz >= 0 ? 1 : -1) * pz;
        if (velLocal) velLocal[2] = 0;
      }
    }
  }
  const zMin = DIMENSOES_BARCO_TIDEWATER.zPopa + DIMENSOES_BARCO_TIDEWATER.cascoEspessura + raio;
  const zMax = 4.0;
  if (z < zMin) { z = zMin; if (velLocal) velLocal[2] = Math.max(0, velLocal[2]); }
  if (z > zMax) { z = zMax; if (velLocal) velLocal[2] = Math.min(0, velLocal[2]); }
  const halfIn = Math.max(0.15, meiaBocaConvesLocal(z, Math.max(y, 0.35)) - DIMENSOES_BARCO_TIDEWATER.cascoEspessura - raio);
  if (x < -halfIn) { x = -halfIn; if (velLocal) velLocal[0] = Math.max(0, velLocal[0]); }
  if (x > halfIn) { x = halfIn; if (velLocal) velLocal[0] = Math.min(0, velLocal[0]); }
  posLocal[0] = x;
  posLocal[2] = z;
  return posLocal;
}

// ---- amostragem de ondas unificada (shared/mar.js + shared/ondas.js) ---------------------------------------------

export function nivelAguaEmCosta(x, z, t = 0, ambiente = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return MAR_NIVEL;
  if (ambiente && typeof ambiente.aguaEm === 'function') {
    const h = ambiente.aguaEm(x, z, t);
    if (Number.isFinite(h)) return h;
  }
  const mar = ambiente?.mar;
  if (mar && mar.ligado && typeof mar.prof === 'function' && typeof mar.s === 'function') {
    const dtMar = Number.isFinite(t) ? t - (mar.tempo || 0) : 0;
    const est = Number.isFinite(mar.estado) ? mar.estado : 0.3;
    const per = multMar(est).periodo || 9.5;
    const fase = (mar.fase || 0) + dtMar / per;
    const h = MAR_NIVEL + alturaMar(x, z, (mar.tempo || 0) + dtMar, mar.prof(x, z), mar.s(x, z), mar.dir, est, fase);
    if (Number.isFinite(h)) return h;
  }
  const gen = ambiente?.gen;
  let prof = ambiente?.profundidade;
  if (!Number.isFinite(prof)) {
    if (gen && typeof gen.height === 'function') {
      prof = Math.max(0, MAR_NIVEL - (gen.height(Math.round(x), Math.round(z)) + 1));
    } else if (gen && typeof gen.heightRel === 'function') {
      prof = Math.max(0, -gen.heightRel(x, z) + 0.88);
    } else {
      prof = 8;
    }
  }
  if (gen && gen.arq && typeof gen.arq.s === 'function') {
    const tempo = ambiente?.tempo;
    const E = Number.isFinite(ambiente?.E) ? ambiente.E : estadoDoTempo(tempo);
    const vDir = ambiente?.ventoDir || ventoMar(tempo);
    const fase = Number.isFinite(ambiente?.fase) ? ambiente.fase : t / (multMar(E).periodo || 9.5);
    const h = MAR_NIVEL + alturaMar(x, z, t, prof, gen.arq.s(x, z), vDir, E, fase);
    if (Number.isFinite(h)) return h;
  }
  const dh = alturaOnda(x, z, t, ambiente?.vento || PADRAO_VENTO, prof);
  return Number.isFinite(dh) ? NIVEL_MAR_REPOUSO + dh : NIVEL_MAR_REPOUSO;
}

// ---- física hidrostática e manobrabilidade (120 Hz, semi-implícito de Euler) --------------------------------------

function criarAmostrasEfetivas(amostrasBase = AMOSTRAS_CASCO_LOCAL) {
  const cbz = DIMENSOES_BARCO_TIDEWATER.cb[2];
  const sx = 0.79, sz = 0.9;
  const out = [];
  for (let i = 0; i < amostrasBase.length; i++) {
    const a = amostrasBase[i];
    out.push({
      x: a.x * sx,
      y: a.y,
      z: cbz + (a.z - cbz) * sz,
      area: a.area,
      bottomY: a.bottomY ?? a.y,
    });
  }
  return out;
}

const AMOSTRAS_EFETIVAS_PADRAO = criarAmostrasEfetivas();
const RIGIDEZ_PITCH_PADRAO = (() => {
  const cbz = DIMENSOES_BARCO_TIDEWATER.cb[2];
  let k = 0;
  for (let i = 0; i < AMOSTRAS_EFETIVAS_PADRAO.length; i++) {
    const dz = AMOSTRAS_EFETIVAS_PADRAO[i].z - cbz;
    k += AMOSTRAS_EFETIVAS_PADRAO[i].area * dz * dz;
  }
  return RHO_AGUA_MAR * GRAVIDADE_COSTA * k;
})();

// Vetores temporários pré-alocados para rodar 120 Hz com zero lixo de memória por subpasso.
const _F = [0, 0, 0], _T = [0, 0, 0], _comW = [0, 0, 0], _pw = [0, 0, 0], _r = [0, 0, 0];
const _vp = [0, 0, 0], _vl = [0, 0, 0], _aLoc = [0, 0, 0], _fl = [0, 0, 0], _tl = [0, 0, 0];
const _fwd = [0, 0, 1], _side = [1, 0, 0], _up = [0, 1, 0], _v = [0, 0, 0], _rud = [0, 0, 0];
const _prop = [0, 0, 0], _tmpF = [0, 0, 1], _tmpS = [1, 0, 0], _outCol = [0, 0, 0];

function somaForcaEm(fx, fy, fz, pwx, pwy, pwz) {
  _F[0] += fx;
  _F[1] += fy;
  _F[2] += fz;
  const rx = pwx - _comW[0], ry = pwy - _comW[1], rz = pwz - _comW[2];
  _T[0] += ry * fz - rz * fy;
  _T[1] += rz * fx - rx * fz;
  _T[2] += rx * fy - ry * fx;
}

export function criarEstadoBarco(opts = {}) {
  const x = Number.isFinite(opts.x) ? opts.x : (Array.isArray(opts.pos) && Number.isFinite(opts.pos[0]) ? opts.pos[0] : 0);
  const y = Number.isFinite(opts.y) ? opts.y : (Array.isArray(opts.pos) && Number.isFinite(opts.pos[1]) ? opts.pos[1] : MAR_NIVEL);
  const z = Number.isFinite(opts.z) ? opts.z : (Array.isArray(opts.pos) && Number.isFinite(opts.pos[2]) ? opts.pos[2] : 0);
  const yaw = Number.isFinite(opts.yaw) ? opts.yaw : (Number.isFinite(opts.dir) ? yawDeDirecaoMar(opts.dir) : 0);
  const q = Array.isArray(opts.q) && opts.q.length === 4 && opts.q.every(Number.isFinite)
    ? quatNormalizar([opts.q[0], opts.q[1], opts.q[2], opts.q[3]])
    : quatDeYaw(yaw, [0, 0, 0, 1]);
  const ancSrc = opts.ancoragem || {};
  const ancX = Number.isFinite(ancSrc.x) ? ancSrc.x : x;
  const ancY = Number.isFinite(ancSrc.y) ? ancSrc.y : y;
  const ancZ = Number.isFinite(ancSrc.z) ? ancSrc.z : z;
  const ancYaw = Number.isFinite(ancSrc.yaw) ? ancSrc.yaw : yaw;

  return {
    id: String(opts.id || 'barco-costeiro-1'),
    vilaId: opts.vilaId ? String(opts.vilaId) : null,
    nome: String(opts.nome || 'Barco Tidewater'),
    pos: [x, y, z],
    q,
    vel: Array.isArray(opts.vel) && opts.vel.length === 3 ? [opts.vel[0] || 0, opts.vel[1] || 0, opts.vel[2] || 0] : [0, 0, 0],
    ang: Array.isArray(opts.ang) && opts.ang.length === 3 ? [opts.ang[0] || 0, opts.ang[1] || 0, opts.ang[2] || 0] : [0, 0, 0],
    yaw,
    pitch: 0,
    roll: 0,
    acelerador: clamp(Number(opts.acelerador) || 0, -1, 1),
    leme: clamp(Number(opts.leme) || 0, -1, 1),
    rpm: clamp(Number(opts.rpm) || 0, 0, 1),
    empuxo: 0,
    velEscalar: 0,
    velAvante: 0,
    fracaoMolhada: 1,
    batida: 0,
    atracado: opts.atracado !== undefined ? !!opts.atracado : true,
    ancoragem: { x: ancX, y: ancY, z: ancZ, yaw: ancYaw },
    piloto: opts.piloto ?? null,
    pilotoNome: opts.pilotoNome ?? '',
    ocupantes: Array.isArray(opts.ocupantes) ? opts.ocupantes.slice() : [],
    _acc: 0,
    _tSim: 0,
  };
}

function barcoFinito(b) {
  return b
    && Array.isArray(b.pos) && b.pos.length === 3 && b.pos.every(Number.isFinite)
    && Array.isArray(b.q) && b.q.length === 4 && b.q.every(Number.isFinite)
    && Array.isArray(b.vel) && b.vel.length === 3 && b.vel.every(Number.isFinite)
    && Array.isArray(b.ang) && b.ang.length === 3 && b.ang.every(Number.isFinite);
}

export function resetarBarcoNaAncoragem(b, ambiente = {}) {
  const a = b.ancoragem || { x: 0, y: MAR_NIVEL, z: 0, yaw: 0 };
  const agua = Number.isFinite(a.y) ? a.y : nivelAguaEmCosta(a.x, a.z, ambiente?.t || 0, ambiente);
  b.pos[0] = a.x;
  b.pos[1] = agua;
  b.pos[2] = a.z;
  quatDeYaw(a.yaw || 0, b.q);
  b.vel[0] = b.vel[1] = b.vel[2] = 0;
  b.ang[0] = b.ang[1] = b.ang[2] = 0;
  b.acelerador = 0;
  b.leme = 0;
  b.rpm = 0;
  b.empuxo = 0;
  b.velEscalar = 0;
  b.velAvante = 0;
  b.atracado = true;
  b._acc = 0;
  const e = eulerDoBarco(b);
  b.yaw = e.yaw;
  b.pitch = e.pitch;
  b.roll = e.roll;
  return b;
}

function subPassoBarco(b, h, driven, tAgua, ambiente, amostras, pitchStiffness) {
  const m = DIMENSOES_BARCO_TIDEWATER.massa;
  const com = DIMENSOES_BARCO_TIDEWATER.com;
  const invI = DIMENSOES_BARCO_TIDEWATER.inercia;
  const addM = DIMENSOES_BARCO_TIDEWATER.massaAdicional;
  const addI = DIMENSOES_BARCO_TIDEWATER.inerciaAdicional;
  const q = b.q;

  _F[0] = 0; _F[1] = -m * GRAVIDADE_COSTA; _F[2] = 0;
  _T[0] = 0; _T[1] = 0; _T[2] = 0;

  rotacionarVecPorQuat(com[0], com[1], com[2], q, _comW);
  _comW[0] += b.pos[0];
  _comW[1] += b.pos[1];
  _comW[2] += b.pos[2];

  // 1) Empuxo e amortecimento vertical de arfagem nos 32 patches do casco
  let wetArea = 0, totalArea = 0, immersion = 0;
  let aguaMedia = 0, propAgua = 0, propDist = Infinity;
  const dtV = 0.05;
  const propLoc = DIMENSOES_BARCO_TIDEWATER.helicePos;
  rotacionarVecPorQuat(propLoc[0], propLoc[1], propLoc[2], q, _prop);
  _prop[0] += b.pos[0]; _prop[1] += b.pos[1]; _prop[2] += b.pos[2];

  for (let i = 0; i < amostras.length; i++) {
    const s = amostras[i];
    rotacionarVecPorQuat(s.x, s.y, s.z, q, _pw);
    _pw[0] += b.pos[0];
    _pw[1] += b.pos[1];
    _pw[2] += b.pos[2];

    const hw = nivelAguaEmCosta(_pw[0], _pw[2], tAgua, ambiente);
    const hwAnt = nivelAguaEmCosta(_pw[0], _pw[2], tAgua - dtV, ambiente);
    const waterV = clamp((hw - hwAnt) / dtV, -3, 3);
    aguaMedia += hw;

    const dProp = (_pw[0] - _prop[0]) ** 2 + (_pw[2] - _prop[2]) ** 2;
    if (dProp < propDist) { propDist = dProp; propAgua = hw; }

    totalArea += s.area;
    const depth = hw - _pw[1];
    if (depth <= 0) continue;

    const sub = Math.min(depth, 1.6);
    const wet = Math.min(1, depth / 0.3);
    wetArea += s.area * wet;
    immersion += s.area * Math.min(sub / Math.max(-s.y, 0.05), 1.5);

    const rx = _pw[0] - _comW[0], ry = _pw[1] - _comW[1], rz = _pw[2] - _comW[2];
    const vyPonto = (b.ang[2] * rx - b.ang[0] * rz) + b.vel[1];
    const vy = vyPonto - waterV * 0.6;
    const wetK = Math.min(1, sub / 0.25) * s.area;
    const fy = RHO_AGUA_MAR * GRAVIDADE_COSTA * s.area * sub - (1800 * vy + 900 * vy * Math.abs(vy)) * wetK;
    somaForcaEm(0, fy, 0, _pw[0], _pw[1], _pw[2]);
  }
  aguaMedia = amostras.length > 0 ? aguaMedia / amostras.length : MAR_NIVEL;

  const wet = totalArea > 0 ? wetArea / totalArea : 0;
  b.fracaoMolhada = wet;
  const imm = totalArea > 0 ? clamp(immersion / totalArea, 0, 1) : 0;
  const wetD = Math.min(1, wet * 1.6);

  rotacionarVecPorQuat(0, 0, 1, q, _fwd);
  rotacionarVecPorQuat(1, 0, 0, q, _side);
  rotacionarVecPorQuat(0, 1, 0, q, _up);
  rotacionarVecPorQuatInv(b.vel[0], b.vel[1], b.vel[2], q, _vl);
  rotacionarVecPorQuatInv(b.ang[0], b.ang[1], b.ang[2], q, _aLoc);

  const u = _vl[2], vs = _vl[0];
  const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
  b.velEscalar = sp;
  b.velAvante = u;

  // 2) Resistência em água calma (atrito + bossa de onda + planeio) + arrasto aerodinâmico
  const au = Math.abs(u);
  const sHump = smoothstep(2.8, 5.4, au);
  const sPlane = smoothstep(7.0, 11.0, au);
  const R = (40 * au + 22 * au * au + 3000 * sHump + 55 * au * au * sPlane) * wetD;
  rotacionarVecPorQuat(0, -0.2, com[2], q, _pw);
  _pw[0] += b.pos[0]; _pw[1] += b.pos[1]; _pw[2] += b.pos[2];
  const sgnU = u > 0 ? 1 : u < 0 ? -1 : 0;
  somaForcaEm(_fwd[0] * (-R * sgnU), _fwd[1] * (-R * sgnU), _fwd[2] * (-R * sgnU), _pw[0], _pw[1], _pw[2]);

  _F[0] -= b.vel[0] * 3.3 * sp;
  _F[1] -= b.vel[1] * 3.3 * sp;
  _F[2] -= b.vel[2] * 3.3 * sp;

  // 3) Estações laterais na quilha (sustentação de deriva + arrasto transversal)
  const lateralY = 0.06;
  for (let i = 0; i < ESTACOES_QUILHA.length; i++) {
    const sz = ESTACOES_QUILHA[i][0], A = ESTACOES_QUILHA[i][1];
    const dz = sz - com[2];
    const vk = vs + _aLoc[1] * dz - _aLoc[2] * (lateralY - com[1]);
    const Y = -0.5 * RHO_AGUA_MAR * A * (DIMENSOES_BARCO_TIDEWATER.sustentacaoCasco * au * vk + 1.1 * vk * Math.abs(vk)) * wetD;
    rotacionarVecPorQuat(0, lateralY, sz, q, _pw);
    _pw[0] += b.pos[0]; _pw[1] += b.pos[1]; _pw[2] += b.pos[2];
    somaForcaEm(_side[0] * Y, _side[1] * Y, _side[2] * Y, _pw[0], _pw[1], _pw[2]);
  }

  // 4) Hélice (empuxo com queda até a velocidade de passo + passo lateral à ré)
  const propSub = propAgua - _prop[1];
  const propWet = clamp(propSub / 0.3 + 0.5, 0, 1);
  const dir = driven ? Math.sign(b.acelerador) : 0;
  const n = b.rpm * (driven && Math.abs(b.acelerador) > 0.02 ? 1 : 0);
  let thrust = 0;
  if (dir > 0) {
    thrust = DIMENSOES_BARCO_TIDEWATER.empuxoMax * n * n * Math.max(0, 1 - Math.max(u, 0) / (DIMENSOES_BARCO_TIDEWATER.velPasso * Math.max(n, 0.2)));
  } else if (dir < 0) {
    thrust = -DIMENSOES_BARCO_TIDEWATER.fatorRe * DIMENSOES_BARCO_TIDEWATER.empuxoMax * n * n * Math.max(0, 1 - Math.max(-u, 0) / (DIMENSOES_BARCO_TIDEWATER.velPasso * 0.6 * Math.max(n, 0.2)));
  }
  thrust *= propWet;
  b.empuxo = thrust;
  somaForcaEm(_fwd[0] * thrust, _fwd[1] * thrust, _fwd[2] * thrust, _prop[0], _prop[1], _prop[2]);
  if (thrust < 0) {
    somaForcaEm(_side[0] * (-thrust * 0.08), _side[1] * (-thrust * 0.08), _side[2] * (-thrust * 0.08), _prop[0], _prop[1], _prop[2]);
  }

  // 5) Leme no fluxo da hélice (sustentação + arrasto induzido)
  rotacionarVecPorQuat(0, -0.15, DIMENSOES_BARCO_TIDEWATER.lemaZ, q, _rud);
  _rud[0] += b.pos[0]; _rud[1] += b.pos[1]; _rud[2] += b.pos[2];
  const race = (Math.max(thrust, 0) * 2) / (RHO_AGUA_MAR * 0.14);
  const Ur2 = u * Math.abs(u) + 0.9 * race;
  const Ur = Math.sqrt(Math.abs(Ur2)) * (Ur2 < 0 ? -1 : 1);
  const vRud = vs + _aLoc[1] * (DIMENSOES_BARCO_TIDEWATER.lemaZ - com[2]);
  const delta = b.leme * 0.6 + (Math.abs(Ur) > 0.3 ? Math.atan2(vRud, Math.abs(Ur)) * (Ur < 0 ? -1 : 1) : 0);
  const dLeme = clamp(delta, -0.7, 0.7);
  const sgnUr = Ur2 === 0 ? 1 : (Ur2 > 0 ? 1 : -1);
  const lift = 0.5 * RHO_AGUA_MAR * 0.12 * Math.abs(Ur2) * DIMENSOES_BARCO_TIDEWATER.sustentacaoLeme * Math.sin(dLeme) * Math.cos(dLeme) * propWet * sgnUr;
  somaForcaEm(-_side[0] * lift, -_side[1] * lift, -_side[2] * lift, _rud[0], _rud[1], _rud[2]);
  const rudDrag = -Math.abs(lift * Math.sin(dLeme)) * 0.8 * (u < 0 ? -1 : 1);
  somaForcaEm(_fwd[0] * rudDrag, _fwd[1] * rudDrag, _fwd[2] * rudDrag, _rud[0], _rud[1], _rud[2]);

  // 6) Trim de marcha (empinada ao subir a bossa de onda, assenta no planeio)
  const trim = (2.8 * smoothstep(2.5, 4.8, u) - 0.8 * smoothstep(4.8, 7.5, u) - 0.4 * smoothstep(7.5, 10.5, u)) * GRAU_PARA_RAD;
  const trimMom = pitchStiffness * trim * imm * -1;
  _T[0] += _side[0] * trimMom;
  _T[1] += _side[1] * trimMom;
  _T[2] += _side[2] * trimMom;
  const dynLift = m * GRAVIDADE_COSTA * 0.15 * smoothstep(3.5, 9.0, u) * imm;
  _F[0] += _up[0] * dynLift;
  _F[1] += _up[1] * dynLift;
  _F[2] += _up[2] * dynLift;

  // 7) Amortecimento angular de apêndices e bolina
  const wd = 0.2 + wetD;
  rotacionarVecPorQuat(-_aLoc[0] * 25000 * wd, -_aLoc[1] * 2000 * wd, -_aLoc[2] * (4500 + 900 * au) * wd, q, _v);
  _T[0] += _v[0]; _T[1] += _v[1]; _T[2] += _v[2];

  // 8) Espias de amarração quando atracado no cais/píer sem piloto no leme
  if (b.atracado && !driven && b.ancoragem) {
    const a = b.ancoragem;
    const k = 5500, c = 4200;
    _F[0] += (a.x - b.pos[0]) * k - b.vel[0] * c;
    _F[2] += (a.z - b.pos[2]) * k - b.vel[2] * c;
    const dy = anguloNormalizado((a.yaw || 0) - Math.atan2(_fwd[0], _fwd[2]));
    _T[1] += dy * 60000 - b.ang[1] * 30000;
  }

  // 9) Encalhe suave no fundo/praia e contato contra estacas do píer ou obstáculos
  let maxImpact = 0;
  const terrenoEm = ambiente?.terrenoEm;
  if (typeof terrenoEm === 'function') {
    for (let i = 0; i < PONTOS_CONTATO_FUNDO.length; i++) {
      const lp = PONTOS_CONTATO_FUNDO[i];
      rotacionarVecPorQuat(lp[0], lp[1], lp[2], q, _pw);
      _pw[0] += b.pos[0]; _pw[1] += b.pos[1]; _pw[2] += b.pos[2];
      const ground = terrenoEm(_pw[0], _pw[2]);
      if (!Number.isFinite(ground)) continue;
      const pen = ground - _pw[1];
      if (pen > 0) {
        const rx = _pw[0] - _comW[0], ry = _pw[1] - _comW[1], rz = _pw[2] - _comW[2];
        const vpx = b.vel[0] + (b.ang[1] * rz - b.ang[2] * ry);
        const vpy = b.vel[1] + (b.ang[2] * rx - b.ang[0] * rz);
        const vpz = b.vel[2] + (b.ang[0] * ry - b.ang[1] * rx);
        const fn = pen * 400000 - Math.min(vpy, 0) * 30000;
        somaForcaEm(-vpx * 6000, Math.max(fn, 0), -vpz * 6000, _pw[0], _pw[1], _pw[2]);
        if (Math.hypot(vpx, vpz) > maxImpact) maxImpact = Math.hypot(vpx, vpz);
      }
    }
  }

  const resolverObstaculo = ambiente?.resolverObstaculo;
  if (typeof resolverObstaculo === 'function') {
    for (let i = 0; i < CONTORNO_LINHA_AGUA.length; i++) {
      const lp = CONTORNO_LINHA_AGUA[i];
      rotacionarVecPorQuat(lp[0], lp[1], lp[2], q, _pw);
      _pw[0] += b.pos[0]; _pw[1] += b.pos[1]; _pw[2] += b.pos[2];
      _outCol[0] = _pw[0];
      _outCol[1] = _pw[1] - 0.9;
      _outCol[2] = _pw[2];
      if (resolverObstaculo(_outCol, 0.25, 1.6)) {
        const rx = _pw[0] - _comW[0], ry = _pw[1] - _comW[1], rz = _pw[2] - _comW[2];
        const vpx = b.vel[0] + (b.ang[1] * rz - b.ang[2] * ry);
        const vpz = b.vel[2] + (b.ang[0] * ry - b.ang[1] * rx);
        somaForcaEm((_outCol[0] - _pw[0]) * 260000 - vpx * 8000, 0, (_outCol[2] - _pw[2]) * 260000 - vpz * 8000, _pw[0], _pw[1], _pw[2]);
        const imp = Math.hypot(vpx, vpz);
        if (imp > maxImpact) maxImpact = imp;
      }
    }
  }
  b.batida = maxImpact;

  // 10) Integração semi-implícita com massa/inércia adicionais no referencial do barco
  rotacionarVecPorQuatInv(_F[0], _F[1], _F[2], q, _fl);
  _fl[0] /= m * (1 + addM[0] * wetD);
  _fl[1] /= m * (1 + addM[1] * wetD);
  _fl[2] /= m * (1 + addM[2] * wetD);
  rotacionarVecPorQuat(_fl[0], _fl[1], _fl[2], q, _v);
  b.vel[0] += _v[0] * h;
  b.vel[1] += _v[1] * h;
  b.vel[2] += _v[2] * h;

  rotacionarVecPorQuatInv(_T[0], _T[1], _T[2], q, _tl);
  _tl[0] /= invI[0] * (1 + addI[0] * wetD);
  _tl[1] /= invI[1] * (1 + addI[1] * wetD);
  _tl[2] /= invI[2] * (1 + addI[2] * wetD);
  rotacionarVecPorQuat(_tl[0], _tl[1], _tl[2], q, _v);
  b.ang[0] += _v[0] * h;
  b.ang[1] += _v[1] * h;
  b.ang[2] += _v[2] * h;

  _comW[0] += b.vel[0] * h;
  _comW[1] += b.vel[1] * h;
  _comW[2] += b.vel[2] * h;

  const wLen = Math.hypot(b.ang[0], b.ang[1], b.ang[2]);
  const angle = wLen * h;
  if (angle > 1e-8) {
    const half = angle * 0.5, sA = Math.sin(half) / wLen, cA = Math.cos(half);
    const dqx = b.ang[0] * sA, dqy = b.ang[1] * sA, dqz = b.ang[2] * sA, dqw = cA;
    // q = normalize(dq * q)
    const nx = dqw * q[0] + dqx * q[3] + dqy * q[2] - dqz * q[1];
    const ny = dqw * q[1] - dqx * q[2] + dqy * q[3] + dqz * q[0];
    const nz = dqw * q[2] + dqx * q[1] - dqy * q[0] + dqz * q[3];
    const nw = dqw * q[3] - dqx * q[0] - dqy * q[1] - dqz * q[2];
    q[0] = nx; q[1] = ny; q[2] = nz; q[3] = nw;
    quatNormalizar(q);
  }

  rotacionarVecPorQuat(com[0], com[1], com[2], q, _v);
  b.pos[0] = _comW[0] - _v[0];
  b.pos[1] = _comW[1] - _v[1];
  b.pos[2] = _comW[2] - _v[2];

  // Garantia contra mergulho extremo se ficar abaixo do nível de repouso sem água válida
  if (b.pos[1] < aguaMedia - 6 && wet <= 0) b.pos[1] = aguaMedia - 0.1;
}

export function passoBarco(barco, dt, entrada = {}, ambiente = {}) {
  if (!barco) return barco;
  const clDt = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
  const driven = entrada.dirigindo !== undefined ? !!entrada.dirigindo : !!barco.piloto;
  const alvoAcel = driven ? clamp(Number(entrada.acelerador) || 0, -1, 1) : 0;
  const alvoLeme = driven ? clamp(Number(entrada.leme) || 0, -1, 1) : 0;

  if (driven) barco.atracado = false;

  // Alavanca e leme respondem com inércia realista de barco de trabalho
  barco.acelerador += (alvoAcel - barco.acelerador) * (1 - Math.exp(-clDt * 2.2));
  barco.leme += (alvoLeme - barco.leme) * (1 - Math.exp(-clDt * 1.2));

  const targetRpm = Math.max(driven ? Math.abs(barco.acelerador) : 0, driven ? 0.15 : 0);
  const tauRpm = targetRpm > barco.rpm ? 0.9 : 1.3;
  barco.rpm += (targetRpm - barco.rpm) * (1 - Math.exp(-clDt / tauRpm));

  const amostras = Array.isArray(ambiente?.amostrasEfetivas) && ambiente.amostrasEfetivas.length
    ? ambiente.amostrasEfetivas
    : AMOSTRAS_EFETIVAS_PADRAO;
  const pitchK = Number.isFinite(ambiente?.rigidezPitch) ? ambiente.rigidezPitch : RIGIDEZ_PITCH_PADRAO;

  const h = 1 / 120;
  barco._acc = (barco._acc || 0) + clDt;
  let steps = 0;
  const tBase = Number.isFinite(ambiente?.t) ? ambiente.t : (barco._tSim || 0);
  while (barco._acc >= h && steps < 12) {
    subPassoBarco(barco, h, driven, tBase + steps * h, ambiente, amostras, pitchK);
    barco._acc -= h;
    steps++;
  }
  barco._tSim = tBase + clDt;

  if (!barcoFinito(barco)) resetarBarcoNaAncoragem(barco, ambiente);
  const e = eulerDoBarco(barco);
  barco.yaw = e.yaw;
  barco.pitch = e.pitch;
  barco.roll = e.roll;
  return barco;
}

// ---- posicionamento determinístico de vilas costeiras (sem colisão com cais nem construções) -------------------

// Mesma geometria de public/shared/cais.js (permite validar colisão mesmo sem importar cais.js ainda).
const CAIS_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const CAIS_DIM = { meiaCabeca: 6, cabeca: 10, recuo: 4 };

export function caixaCais(c) {
  if (!Array.isArray(c) || c.length < 4) return null;
  const d = CAIS_DIRS[c[2]];
  if (!d) return null;
  const pt = (t, a) => [c[0] + d[0] * t - d[1] * a, c[1] + d[1] * t + d[0] * a];
  const pts = [
    pt(-CAIS_DIM.recuo, -CAIS_DIM.meiaCabeca - 1),
    pt(-CAIS_DIM.recuo, CAIS_DIM.meiaCabeca + 1),
    pt(c[3] + CAIS_DIM.cabeca, -CAIS_DIM.meiaCabeca - 1),
    pt(c[3] + CAIS_DIM.cabeca, CAIS_DIM.meiaCabeca + 1),
  ];
  return [
    Math.min(pts[0][0], pts[1][0], pts[2][0], pts[3][0]),
    Math.min(pts[0][1], pts[1][1], pts[2][1], pts[3][1]),
    Math.max(pts[0][0], pts[1][0], pts[2][0], pts[3][0]),
    Math.max(pts[0][1], pts[1][1], pts[2][1], pts[3][1]),
  ];
}

export function caixaVilaCosteira(vila, folga = 4) {
  if (!vila || !Number.isFinite(vila.x) || !Number.isFinite(vila.z)) return [0, 0, 0, 0];
  const dir = Number.isFinite(vila.dir) ? vila.dir : 0;
  const dx = Math.cos(dir), dz = Math.sin(dir);
  const rx = -dz, rz = dx;
  const extMar = (Number.isFinite(vila.comprimentoPier) ? vila.comprimentoPier : 38) + folga;
  const extPraia = (Number.isFinite(vila.raioPraia) ? vila.raioPraia : 46) + folga;
  const meiaLarg = 30 + folga;
  const pts = [
    [-extPraia, -meiaLarg],
    [-extPraia, meiaLarg],
    [extMar, -meiaLarg],
    [extMar, meiaLarg],
  ];
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const wx = vila.x + dx * pts[i][0] + rx * pts[i][1];
    const wz = vila.z + dz * pts[i][0] + rz * pts[i][1];
    if (wx < x0) x0 = wx;
    if (wx > x1) x1 = wx;
    if (wz < z0) z0 = wz;
    if (wz > z1) z1 = wz;
  }
  return [x0, z0, x1, z1];
}

export function pontoAtracacaoPadraoVila(vila) {
  const x = vila?.x || 0;
  const z = vila?.z || 0;
  const dir = Number.isFinite(vila?.dir) ? vila.dir : 0;
  const fx = Math.cos(dir), fz = Math.sin(dir);
  const rx = Math.sin(dir), rz = -Math.cos(dir);
  // Píer Tidewater avança 34 m mar adentro (T-head em z=27..34, meia largura 7 m): atraca paralelo em (9,55; 30,8).
  const tBerth = (Number.isFinite(vila?.comprimentoPier) ? vila.comprimentoPier : 34) - 3.2;
  const lat = 9.55;
  const bx = x + fx * tBerth + rx * lat;
  const bz = z + fz * tBerth + rz * lat;
  const yaw = yawDeDirecaoMar(dir);
  return { x: bx, y: MAR_NIVEL, z: bz, dir, yaw };
}

function distPontoCaixa(x, z, cx) {
  const dx = x < cx[0] ? cx[0] - x : x > cx[2] ? x - cx[2] : 0;
  const dz = z < cx[1] ? cx[1] - z : z > cx[3] ? z - cx[3] : 0;
  return Math.hypot(dx, dz);
}

function caixasSeTocam(a, b, margem = 0) {
  return !(a[2] + margem < b[0] || a[0] - margem > b[2] || a[3] + margem < b[1] || a[1] - margem > b[3]);
}

export function coletarObstaculosCosta(gen, opts = {}) {
  const caixasCais = [];
  const circulos = [];
  const boxesConstrucao = [];

  const pushCais = (c) => {
    if (!c) return;
    if (Array.isArray(c) && typeof c[0] === 'number') {
      const box = caixaCais(c);
      if (box) caixasCais.push(box);
    } else if (c.caixa && Array.isArray(c.caixa)) {
      caixasCais.push(c.caixa);
    } else if (c.cais) {
      const box = caixaCais(c.cais);
      if (box) caixasCais.push(box);
    }
  };

  const arq = gen?.arq;
  if (arq) {
    if (Array.isArray(arq.portos)) for (const p of arq.portos) pushCais(p);
    if (Array.isArray(arq.ilhas)) for (const il of arq.ilhas) if (il?.ficha?.cais) pushCais(il.ficha.cais);
    if (Array.isArray(arq.mapa?.cais)) for (const c of arq.mapa.cais) pushCais(c);
    if (Array.isArray(arq.mapa?.proteger)) {
      for (const pr of arq.mapa.proteger) {
        if (Array.isArray(pr) && pr.length >= 3) circulos.push([pr[0], pr[1], pr[2]]);
      }
    }
  }
  if (Array.isArray(opts.portos)) for (const p of opts.portos) pushCais(p);
  if (Array.isArray(opts.cais)) for (const c of opts.cais) pushCais(c);
  if (Array.isArray(opts.proteger)) {
    for (const pr of opts.proteger) {
      if (Array.isArray(pr) && pr.length >= 3) circulos.push([pr[0], pr[1], pr[2]]);
    }
  }
  if (Array.isArray(opts.construcoes)) {
    for (const ob of opts.construcoes) {
      if (!ob) continue;
      if (Array.isArray(ob) && ob.length >= 3) {
        circulos.push([ob[0], ob[1], ob[2]]);
      } else if (Number.isFinite(ob.x) && Number.isFinite(ob.z)) {
        const r = Number.isFinite(ob.raio) ? ob.raio : Number.isFinite(ob.r) ? ob.r : 28;
        circulos.push([ob.x, ob.z, r]);
      } else if (Number.isFinite(ob.x0) && Number.isFinite(ob.z0) && Number.isFinite(ob.x1) && Number.isFinite(ob.z1)) {
        boxesConstrucao.push([ob.x0, ob.z0, ob.x1, ob.z1]);
      }
    }
  }

  return { caixasCais, circulos, boxesConstrucao };
}

export function vilaColideComObstaculos(vila, obstaculos, vilasExistentes = [], margemCais = 52, margemObra = 26) {
  const cv = caixaVilaCosteira(vila, 2);
  for (let i = 0; i < obstaculos.caixasCais.length; i++) {
    if (caixasSeTocam(cv, obstaculos.caixasCais[i], margemCais)) return true;
  }
  for (let i = 0; i < obstaculos.boxesConstrucao.length; i++) {
    if (caixasSeTocam(cv, obstaculos.boxesConstrucao[i], margemObra)) return true;
  }
  for (let i = 0; i < obstaculos.circulos.length; i++) {
    const [cx, cz, cr] = obstaculos.circulos[i];
    if (distPontoCaixa(cx, cz, cv) < cr + margemObra) return true;
    const dx = vila.x - cx, dz = vila.z - cz;
    if (Math.hypot(dx, dz) < cr + margemObra + 16) return true;
  }
  for (let i = 0; i < vilasExistentes.length; i++) {
    const o = vilasExistentes[i];
    if (!o) continue;
    if (Math.hypot(vila.x - o.x, vila.z - o.z) < 110) return true;
  }
  return false;
}

function avaliarCandidatoPraia(gen, ilha, x, z, dir, obstaculos, vilasExistentes, pertoDe, seed) {
  const heightRel = typeof gen?.heightRel === 'function'
    ? (px, pz) => gen.heightRel(px, pz)
    : (px, pz) => (gen?.height ? gen.height(px, pz) - SEA : -10);
  const dx = Math.cos(dir), dz = Math.sin(dir);
  const rx = -dz, rz = dx;

  // 1) Verifica mar aberto à frente (+dir): profundidade crescente (≥ ~1,4 m com MAR_NIVEL=+0,88 sobre SEA)
  //    e sem ilhotas bloqueando o píer/barco (suporta plataformas rasas como Caribe `raso: 120`)
  const h6 = heightRel(x + dx * 6, z + dz * 6);
  const h16 = heightRel(x + dx * 16, z + dz * 16);
  const h30 = heightRel(x + dx * 30, z + dz * 30);
  const h42 = heightRel(x + dx * 42, z + dz * 42);
  const h60 = heightRel(x + dx * 60, z + dz * 60);
  if (!(h6 < -0.05 && h16 < -0.25 && h30 < -0.55 && h42 < -0.85 && h60 < -1.0)) return null;

  // Canal de manobra lateral para atracar ao lado do píer
  if (heightRel(x + dx * 30 + rx * 10, z + dz * 30 + rz * 10) >= -0.45) return null;
  if (heightRel(x + dx * 30 - rx * 10, z + dz * 30 - rz * 10) >= -0.45) return null;

  // Se houver arquipélago/ilha, confirma que +60 m aponta realmente para o mar aberto (não lagoa interna)
  const sFn = ilha?.s || gen?.arq?.s;
  if (typeof sFn === 'function') {
    if (sFn(x + dx * 55, z + dz * 55) < 28) return null;
  }

  // 2) Verifica praia e terra firme atrás (-dir) para passadiço e casas costeiras
  const hBack8 = heightRel(x - dx * 8, z - dz * 8);
  const hBack20 = heightRel(x - dx * 20, z - dz * 20);
  const hBack34 = heightRel(x - dx * 34, z - dz * 34);
  if (hBack8 < 0.08 || hBack20 < 0.2 || hBack34 < 0.15) return null;
  if (hBack8 > 7.5 || hBack20 > 12.0 || hBack34 > 18.0) return null;

  // Evita lagos/crateras de lava (vulcão) ou terrenos muito inclinados nas laterais das casas
  let rugosidade = 0;
  for (const lat of [-16, 16]) {
    for (const back of [-14, -28]) {
      const px = x + dx * back + rx * lat, pz = z + dz * back + rz * lat;
      if (ilha && typeof ilha.lava === 'function' && ilha.lava(px, pz) > 0) return null;
      const hl = heightRel(px, pz);
      if (hl < -0.6 || hl > 16) return null;
      rugosidade += Math.abs(hl - hBack20);
    }
  }

  // Evita área de cidade da metrópole quando marcado por obras/semPlanta
  if (ilha && typeof ilha.semPlanta === 'function') {
    if (ilha.semPlanta(x - dx * 18, z - dz * 18)) return null;
  }

  const candidata = {
    x: Math.round(x * 100) / 100,
    y: SEA,
    z: Math.round(z * 100) / 100,
    dir,
    comprimentoPier: 34,
    raioPraia: 46,
  };
  if (vilaColideComObstaculos(candidata, obstaculos, vilasExistentes)) return null;

  // Pontuação: praia suave, profundidade limpa no T-head (~2,5..4 m), folga grande de cais e proximidade controlada
  let distCais = 500;
  for (let i = 0; i < obstaculos.caixasCais.length; i++) {
    const d = distPontoCaixa(x, z, obstaculos.caixasCais[i]);
    if (d < distCais) distCais = d;
  }
  let penalSpawn = 0;
  if (pertoDe && Number.isFinite(pertoDe.x ?? pertoDe[0]) && Number.isFinite(pertoDe.z ?? pertoDe[1])) {
    const sx = pertoDe.x ?? pertoDe[0], sz = pertoDe.z ?? pertoDe[1];
    const dist = Math.hypot(x - sx, z - sz);
    if (dist < 48) penalSpawn += (48 - dist) * 3;
    penalSpawn += Math.abs(dist - 190) * 0.14;
  }
  const tie = ((hash3(Math.round(x), 7, Math.round(z), seed | 0) & 1023) / 1023) * 0.25;
  const depthScore = clamp(-h30, 0, 5) * 3.5;
  const slopePen = rugosidade * 0.8 + Math.abs(hBack20 - 1.8) * 1.4;
  const score = depthScore + Math.min(distCais, 260) * 0.08 - slopePen - penalSpawn + tie;

  return { ...candidata, score };
}

export function encontrarSitioVilaCosteira(gen, opts = {}) {
  const seed = Number.isFinite(opts.seed) ? opts.seed : (gen?.seed || 1337);
  const ilha = opts.ilha || null;
  const cx = Number.isFinite(opts.centroX) ? opts.centroX : (ilha ? ilha.x : 0);
  const cz = Number.isFinite(opts.centroZ) ? opts.centroZ : (ilha ? ilha.z : 0);
  const rBase = ilha?.r || 260;
  const rMin = Number.isFinite(opts.rMin) ? opts.rMin : Math.max(8, Math.floor(rBase * 0.1));
  const rMax = Number.isFinite(opts.rMax) ? opts.rMax : Math.ceil(rBase * 2.1 + 360);
  const numRaios = Math.max(12, opts.raios | 0 || 24);
  const passoR = 6;
  const heightRel = typeof gen?.heightRel === 'function'
    ? (px, pz) => gen.heightRel(px, pz)
    : (px, pz) => (gen?.height ? gen.height(px, pz) - SEA : -10);

  const obstaculos = coletarObstaculosCosta(gen, opts);
  const existentes = Array.isArray(opts.vilasExistentes) ? opts.vilasExistentes : [];
  let melhor = null;

  const tentarLinha = (ox, oz, dir, distMax) => {
    let antTerra = heightRel(ox, oz) >= 0.2;
    for (let r = passoR; r <= distMax; r += passoR) {
      const px = ox + Math.cos(dir) * r;
      const pz = oz + Math.sin(dir) * r;
      const h = heightRel(px, pz);
      const terraAgora = h >= 0;
      if (antTerra && !terraAgora) {
        // Bisseção curta para cravar o ponto exato de transição praia <-> água
        let lo = r - passoR, hi = r;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) * 0.5;
          if (heightRel(ox + Math.cos(dir) * mid, oz + Math.sin(dir) * mid) >= 0) lo = mid;
          else hi = mid;
        }
        const rm = (lo + hi) * 0.5;
        const cand = avaliarCandidatoPraia(
          gen,
          ilha,
          ox + Math.cos(dir) * rm,
          oz + Math.sin(dir) * rm,
          dir,
          obstaculos,
          existentes,
          opts.pertoDe,
          seed
        );
        if (cand && (!melhor || cand.score > melhor.score)) melhor = cand;
      }
      antTerra = h >= 0.2;
    }
  };

  for (let i = 0; i < numRaios; i++) {
    const dir = (i / numRaios) * Math.PI * 2;
    const ox = cx + Math.cos(dir) * rMin;
    const oz = cz + Math.sin(dir) * rMin;
    tentarLinha(ox, oz, dir, rMax - rMin);
  }

  // Fallback para terrenos continentais ou referência fora do centro onde o mar está distante do spawn
  if (!melhor && opts.pertoDe) {
    const px = opts.pertoDe.x ?? opts.pertoDe[0] ?? cx;
    const pz = opts.pertoDe.z ?? opts.pertoDe[1] ?? cz;
    for (let i = 0; i < 24; i++) {
      const dir = (i / 24) * Math.PI * 2;
      tentarLinha(px, pz, dir, 900);
    }
  }

  if (!melhor) return null;
  const tema = ilha?.ficha?.tema || (typeof ilha?.tema === 'string' ? ilha.tema : null) || 'principal';
  const ilhaId = ilha?.id || 'principal';
  const idBase = ilhaId === 'principal' ? 'vila-costa-principal' : `vila-costa-${ilhaId}`;
  return {
    id: String(opts.id || idBase),
    ilhaId,
    nome: String(opts.nome || (ilha?.nome ? `Porto ${ilha.nome}` : 'Vila Costeira Tidewater')),
    tema: String(tema),
    x: melhor.x,
    y: melhor.y,
    z: melhor.z,
    dir: melhor.dir,
    comprimentoPier: melhor.comprimentoPier,
    raioPraia: melhor.raioPraia,
    tipo: 'tidewater',
  };
}

export function gerarVilasArquipelago(gen, opts = {}) {
  const vilas = [];
  const pSpawn = opts.pertoDe || { x: 0, z: 0 };
  const principal = encontrarSitioVilaCosteira(gen, {
    ...opts,
    id: 'vila-costa-principal',
    nome: opts.nomePrincipal || (gen?.arq?.mapa?.nome ? `Porto ${gen.arq.mapa.nome}` : 'Vila Costeira Tidewater'),
    pertoDe: pSpawn,
    vilasExistentes: vilas,
  });
  if (principal) vilas.push(principal);

  const ilhas = gen?.arq?.ilhas;
  if (opts.incluirIlhas !== false && Array.isArray(ilhas)) {
    for (let i = 0; i < ilhas.length; i++) {
      const il = ilhas[i];
      if (!il) continue;
      const v = encontrarSitioVilaCosteira(gen, {
        ...opts,
        ilha: il,
        id: `vila-costa-${il.id || i + 1}`,
        nome: il.nome ? `Porto ${il.nome}` : `Porto Ilha ${i + 1}`,
        pertoDe: { x: il.x, z: il.z },
        vilasExistentes: vilas,
      });
      if (v) vilas.push(v);
    }
  }
  return vilas;
}
