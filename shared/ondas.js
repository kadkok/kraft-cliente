// LAVRA — modelo compartilhado de ondas oceânicas e costeiras (CPU + espelho exato do GLSL).
// Adaptado de dgreenheck/tidewater (MIT License — Copyright (c) Dan Greenheck).
//
// Por que soma de ondas Gerstner multi-banda em vez de FFT por compute shader:
// O Tidewater original roda em WebGPU e integra espectros Phillips/JONSWAP via compute FFT.
// Como o LAVRA roda em WebGL2 (GLSL 300 es) sem compute shaders e precisa avaliar a mesma
// superfície tanto no vertex/fragment shader quanto na CPU (câmera submarina, linha d'água
// dividida e física costeira), usamos uma cascata analítica de 6 bandas de ondas de Gerstner
// direcionais com relação de dispersão de águas profundas/rasas (ω = √(g·k·tanh(k·h))),
// empinamento costeiro (lei de Green) e corrida de swash na praia (ShoreWaves.js).

import { SEA } from './constants.js';

export const NIVEL_MAR_REPOUSO = SEA + 0.88;
export const GRAVIDADE_ONDA = 9.81;
export const PERIODO_SWASH = 9.0;

// Mesmo vetor padrão de U.uWind em public/src/render/materials.js: xy = direção, z = força.
export const PADRAO_VENTO = Object.freeze({ x: 0.83, y: 0.55, z: 0.85 });

// 6 bandas direcionais calibradas para reproduzir o espectro multi-cascata do Tidewater:
// [comprimento (m), amplitude base (m), ângulo relativo ao vento (rad), steepness Q, fase, pesoEspuma]
export const BANDAS_GERSTNER = Object.freeze([
  Object.freeze({ comp: 28.0, amp: 0.135, ang:  0.14, q: 0.52, fase: 0.00, espuma: 0.35, profMin: 3.2 }),
  Object.freeze({ comp: 17.5, amp: 0.088, ang: -0.31, q: 0.48, fase: 1.37, espuma: 0.42, profMin: 2.4 }),
  Object.freeze({ comp: 10.8, amp: 0.056, ang:  0.42, q: 0.44, fase: 2.71, espuma: 0.48, profMin: 1.6 }),
  Object.freeze({ comp:  6.4, amp: 0.034, ang: -0.58, q: 0.38, fase: 4.09, espuma: 0.38, profMin: 1.1 }),
  Object.freeze({ comp:  3.7, amp: 0.019, ang:  0.25, q: 0.32, fase: 5.13, espuma: 0.28, profMin: 0.7 }),
  Object.freeze({ comp:  2.3, amp: 0.011, ang: -0.84, q: 0.26, fase: 0.89, espuma: 0.20, profMin: 0.45 }),
]);

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// Extrai direção unitária (wx, wy) e força (wz) de qualquer formato de vento ({x,y,z}, array ou número).
export function normalizarVento(vento = PADRAO_VENTO) {
  let vx = PADRAO_VENTO.x;
  let vy = PADRAO_VENTO.y;
  let vz = PADRAO_VENTO.z;
  if (typeof vento === 'number' && Number.isFinite(vento)) {
    vz = vento;
  } else if (Array.isArray(vento)) {
    if (Number.isFinite(vento[0])) vx = vento[0];
    if (Number.isFinite(vento[1])) vy = vento[1];
    if (Number.isFinite(vento[2])) vz = vento[2];
  } else if (vento && typeof vento === 'object') {
    if (Number.isFinite(vento.x)) vx = vento.x;
    if (Number.isFinite(vento.y)) vy = vento.y;
    if (Number.isFinite(vento.z)) vz = vento.z;
  }
  const len2 = vx * vx + vy * vy;
  if (len2 > 1e-6) {
    const inv = 1.0 / Math.sqrt(len2);
    vx *= inv;
    vy *= inv;
  } else {
    vx = 0.833666;
    vy = 0.552269;
  }
  return { x: vx, y: vy, z: clamp(vz, 0.0, 2.5) };
}

// Energia do vento (0 = calmo/neblina, ~0.34 = brisa padrão, 1 = temporal).
// Espelha exatamente: clamp((uWind.z - 0.35) / 1.45, 0.0, 1.0) em materials.js.
export function energiaVento(vento = PADRAO_VENTO) {
  const w = normalizarVento(vento);
  return clamp((w.z - 0.35) / 1.45, 0.0, 1.0);
}

// Atenuação global por profundidade (em blocos):
// Em água rasa/corrente/margem (profundidade <= 0.35 blocos) o deslocamento vertical zera
// completamente para não abrir frestas nos voxels da margem nem inundar tanques rasos.
export function atenProfundidade(profundidade = 7) {
  if (!Number.isFinite(profundidade) || profundidade <= 0.35) return 0.0;
  return smoothstep(0.35, 4.6, profundidade);
}

// Atenuação por banda conforme a profundidade (ondas longas sentem o fundo antes das curtas,
// como em WaterSurface.waterSurfaceCascadeAttenuation do Tidewater).
function atenBanda(profundidade, profMin) {
  if (profundidade <= 0.35) return 0.0;
  const base = smoothstep(0.35, profMin * 1.45, profundidade);
  // Leve empinamento (shoaling de Green) antes de quebrar na zona rasa intermediária:
  const shoal = 1.0 + 0.18 * smoothstep(0.6, 1.8, profundidade) * (1.0 - smoothstep(1.8, 4.2, profundidade));
  return base * shoal;
}

// Avalia o estado completo da superfície Gerstner multi-banda em (x, z, t).
// Espelha exatamente a função GLSL `twGerstnerSurface` em public/src/render/oceano-tidewater.js.
export function ondaCompleta(x, z, t = 0, vento = PADRAO_VENTO, profundidade = 7) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(t)) {
    return { dx: 0, dy: 0, dz: 0, nx: 0, ny: 1, nz: 0, crista: 0, espuma: 0, energia: 0, atenuacao: 0 };
  }
  const env = atenProfundidade(profundidade);
  const w = normalizarVento(vento);
  const energy = clamp((w.z - 0.35) / 1.45, 0.0, 1.0);
  if (env <= 0.0) {
    return { dx: 0, dy: 0, dz: 0, nx: 0, ny: 1, nz: 0, crista: 0, espuma: 0, energia: energy, atenuacao: 0 };
  }

  // Escala de amplitude com o vento (mesmo em calmaria há uma ondulação oceânica residual suave).
  const ampScale = (0.42 + 0.88 * energy) * env;
  const speedScale = 0.78 + 0.34 * energy;

  let dx = 0.0;
  let dy = 0.0;
  let dz = 0.0;
  let dHx = 0.0;
  let dHz = 0.0;
  let jacobian = 1.0;
  let cristaAcum = 0.0;

  for (let i = 0; i < BANDAS_GERSTNER.length; i++) {
    const b = BANDAS_GERSTNER[i];
    const att = atenBanda(profundidade, b.profMin);
    if (att <= 1e-5) continue;

    const ca = Math.cos(b.ang);
    const sa = Math.sin(b.ang);
    const dirX = w.x * ca - w.y * sa;
    const dirZ = w.x * sa + w.y * ca;

    const k = (Math.PI * 2.0) / b.comp;
    const omega = Math.sqrt(GRAVIDADE_ONDA * k) * speedScale;
    const A = b.amp * ampScale * att;
    const Q = b.q * (0.65 + 0.35 * energy);

    const theta = k * (dirX * x + dirZ * z) - omega * t + b.fase;
    const s = Math.sin(theta);
    const c = Math.cos(theta);

    // Trocoide de Gerstner com leve assimetria de crista (Tidewater crest sharpening)
    const crestSharp = s + 0.16 * (s * s - 0.5);
    dx -= Q * A * dirX * c;
    dz -= Q * A * dirZ * c;
    dy += A * crestSharp;

    const dCrest = c * (1.0 + 0.32 * s);
    dHx += k * A * dirX * dCrest;
    dHz += k * A * dirZ * dCrest;
    jacobian -= k * Q * A * s * b.espuma;
    cristaAcum += Math.max(0.0, s) * b.espuma * att;
  }

  // Normal analítica da superfície deslocada
  const nxRaw = -dHx;
  const nyRaw = 1.0;
  const nzRaw = -dHz;
  const nLen = Math.sqrt(nxRaw * nxRaw + nyRaw * nyRaw + nzRaw * nzRaw) || 1.0;
  const nx = nxRaw / nLen;
  const ny = nyRaw / nLen;
  const nz = nzRaw / nLen;

  const crista = clamp(cristaAcum * (0.45 + 0.55 * energy), 0.0, 1.0);
  const espuma = clamp((1.0 - jacobian) * 1.45 * energy + crista * 0.35 * energy, 0.0, 1.0);

  return {
    dx,
    dy: clamp(dy, -0.48, 0.48),
    dz,
    nx,
    ny,
    nz,
    crista,
    espuma,
    energia: energy,
    atenuacao: env,
  };
}

// Altura da superfície da onda relativa ao nível de repouso (metros).
// Assinatura principal contratada com @submarino e tests/mar-tidewater.test.js.
export function alturaOnda(x, z, t = 0, vento = PADRAO_VENTO, profundidade = 7) {
  return ondaCompleta(x, z, t, vento, profundidade).dy;
}

// Normal unitária { x, y, z } da superfície da onda em (x, z, t).
export function normalOnda(x, z, t = 0, vento = PADRAO_VENTO, profundidade = 7) {
  const r = ondaCompleta(x, z, t, vento, profundidade);
  return { x: r.nx, y: r.ny, z: r.nz };
}

// Deslocamento 3D { x, y, z } do vértice Gerstner em (x, z, t).
export function deslocamentoOnda(x, z, t = 0, vento = PADRAO_VENTO, profundidade = 7) {
  const r = ondaCompleta(x, z, t, vento, profundidade);
  return { x: r.dx, y: r.dy, z: r.dz };
}

// Corrida de swash na praia (ShoreWaves.js do Tidewater):
// Calcula a excursão vertical/horizontal da lâmina d'água na areia e a faixa de areia molhada.
export function swashPraia(x, z, t = 0, vento = PADRAO_VENTO) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(t)) {
    return { runup: 0, maxRunup: 0, tau: 0, subindo: false };
  }
  const w = normalizarVento(vento);
  const energy = clamp((w.z - 0.35) / 1.45, 0.0, 1.0);
  const along = -w.y * x + w.x * z;
  const cross = w.x * x + w.y * z;
  // Variação ao longo da praia (grupos de ondas / sets do ShoreWaves.js)
  const setMod = 0.78 + 0.22 * Math.sin(along * 0.045 + t * 0.11) * Math.cos(along * 0.019 - 0.7);
  const fase = (t / PERIODO_SWASH) + Math.sin(along * 0.035) * 0.18 + cross * 0.008;
  const tau = fase - Math.floor(fase);
  // Uprush rápido (0..0.42 do período), backwash lento (0.42..0.97)
  let envelope = 0.0;
  const subindo = tau < 0.42;
  if (subindo) {
    const u = tau / 0.42;
    envelope = 1.0 - (1.0 - u) * (1.0 - u);
  } else if (tau < 0.97) {
    const b = (tau - 0.42) / 0.55;
    envelope = Math.max(0.0, 1.0 - b * b * (3.0 - 2.0 * b));
  }
  const maxRunup = (0.22 + 0.46 * energy) * setMod;
  return {
    runup: maxRunup * envelope,
    maxRunup,
    tau,
    subindo,
  };
}
