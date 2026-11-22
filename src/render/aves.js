// LAVRA — aves do litoral (pedido do Kadmus, 19/11/2026: "O COMPORTAMENTO DOS PÁSSAROS" do Tidewater). Feito pelo
// Claude a pedido direto dele. Comportamentos tirados de dgreenheck/tidewater (MIT) — src/world/wildlife/Birds.js,
// Shorebirds.js, Gulls.js — com corpos e voo refeitos aqui para WebGL2:
//   gaivotas   planam em térmicas sobre a baía (rajadas de batida de asa, asa em "M"), pousam no píer, na cabana, nas
//              torres de salva-vidas e nos botes, descansam em bandinhos na areia; quem chega a 7 m as espanta: elas
//              levantam voo gritando, circulam e pousam em outro lugar
//   trinta-réis patrulham além da arrebentação, pairam contra o vento e mergulham para pescar (respingo e som)
//   fragatas   planam bem alto sobre a ilha, de asas paradas e dobradas
//   maçaricos  correm na beira acompanhando o vai-e-vem da onda (descem quando ela recua, sobem quando ela chega)
// São enfeite do lugar, como as partículas: cada aparelho tem as suas (não passam pelo servidor, não têm corpo
// físico, não são caçadas). Só no mundo com mapa de arquipélago.
import * as THREE from '../three.js';
import { U, COMMON } from './materials.js';
import { costa as marCosta, MAR_NIVEL } from '../../shared/mar.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const aprox = (rate, dt) => 1 - Math.exp(-rate * dt);

// espécies: medidas e modelagem de dgreenheck/tidewater (src/world/wildlife/BirdShapes.js, MIT): estações do corpo
// [z, y, meia largura, meia altura em cima, embaixo], pescoço, bico, cauda em leque, asa de 3 ossos com perfil de asa,
// posição dobrada; cores (linear) por parte: plumagem de cada espécie.
const SPECIES = {
  gaivota: { length: 0.42, span: 1.03,
    body: [[-0.125, 0.012, 0.017, 0.01, 0.01], [-0.095, 0.007, 0.033, 0.024, 0.027], [-0.045, 0, 0.049, 0.038, 0.045], [0.01, 0, 0.054, 0.042, 0.049], [0.055, 0.005, 0.049, 0.039, 0.045], [0.088, 0.014, 0.036, 0.033, 0.033], [0.108, 0.022, 0.029, 0.03, 0.027], [0.132, 0.027, 0.028, 0.03, 0.024], [0.154, 0.025, 0.021, 0.025, 0.018], [0.17, 0.02, 0.012, 0.015, 0.012]],
    neck: [0.066, 0.104], bill: { z: 0.163, y: 0.018, len: 0.046, pitch: -0.07, w: 0.0056, up: 0.0068, low: 0.0062, hook: 0.0035, gonys: 0.0022, pouch: 0 },
    tail: { z: -0.118, y: 0.012, w: 0.017, len: [0.112, 0.113, 0.115, 0.116], spread: 0.32 },
    wing: { root: [0.03, 0.022, 0.03], span: 0.485, elbow: 0.23, wrist: 0.47, thick: [0.15, 0.08, 0.035], le: [[0, 0.045], [0.23, 0.052], [0.47, 0.046], [0.7, 0.008], [0.87, -0.042], [1, -0.1]], chord: [[0, 0.165], [0.23, 0.165], [0.47, 0.15], [0.7, 0.112], [0.87, 0.072], [1, 0.014]] },
    fold: { front: 0.07, tip: -0.285, top: 0.034, h: 0.058, minX: 0.009 }, legs: { hip: [0.022, -0.03, -0.004], tibia: 0.048, tarsus: 0.052, r: 0.0034, toe: 0.036 },
    cor: { baixo: [0.85, 0.85, 0.84], manto: [0.16, 0.17, 0.19], cabeca: [0.025, 0.025, 0.03], ponta: [0.02, 0.02, 0.022], bico: [0.32, 0.04, 0.035], perna: [0.25, 0.04, 0.04], cauda: [0.86, 0.86, 0.85] }, vel: 9, flap: 3.1 },
  trinta: { length: 0.47, span: 1.3,
    body: [[-0.12, 0.012, 0.016, 0.009, 0.009], [-0.09, 0.006, 0.03, 0.021, 0.023], [-0.045, 0, 0.043, 0.033, 0.037], [0.01, 0, 0.046, 0.036, 0.04], [0.055, 0.004, 0.04, 0.033, 0.036], [0.088, 0.013, 0.027, 0.027, 0.026], [0.11, 0.021, 0.022, 0.03, 0.021], [0.133, 0.025, 0.022, 0.028, 0.019], [0.155, 0.023, 0.017, 0.02, 0.015], [0.17, 0.019, 0.01, 0.012, 0.01]],
    neck: [0.066, 0.105], bill: { z: 0.162, y: 0.017, len: 0.064, pitch: -0.1, w: 0.0058, up: 0.0062, low: 0.0058, hook: 0.0012, gonys: 0.0015, pouch: 0 },
    tail: { z: -0.114, y: 0.012, w: 0.016, len: [0.085, 0.098, 0.128, 0.168], spread: 0.24 },
    wing: { root: [0.028, 0.02, 0.028], span: 0.62, elbow: 0.2, wrist: 0.43, thick: [0.14, 0.07, 0.03], le: [[0, 0.04], [0.2, 0.05], [0.43, 0.045], [0.7, 0.0], [0.88, -0.06], [1, -0.13]], chord: [[0, 0.15], [0.2, 0.15], [0.43, 0.135], [0.7, 0.1], [0.88, 0.06], [1, 0.012]] },
    fold: { front: 0.07, tip: -0.25, top: 0.031, h: 0.05, minX: 0.008 }, legs: { hip: [0.02, -0.028, 0.0], tibia: 0.03, tarsus: 0.032, r: 0.0032, toe: 0.03 },
    cor: { baixo: [0.9, 0.9, 0.9], manto: [0.55, 0.58, 0.62], cabeca: [0.015, 0.015, 0.018], ponta: [0.28, 0.29, 0.31], bico: [0.9, 0.32, 0.03], perna: [0.02, 0.02, 0.02], cauda: [0.88, 0.88, 0.88] }, vel: 8, flap: 4.2 },
  pelicano: { length: 1.25, span: 2.1,
    body: [[-0.31, 0.03, 0.045, 0.028, 0.028], [-0.245, 0.02, 0.09, 0.068, 0.07], [-0.12, 0, 0.13, 0.1, 0.11], [0.02, 0, 0.14, 0.11, 0.12], [0.12, 0.012, 0.125, 0.105, 0.11], [0.19, 0.05, 0.088, 0.095, 0.09], [0.225, 0.105, 0.058, 0.066, 0.068], [0.255, 0.135, 0.046, 0.05, 0.042], [0.28, 0.139, 0.039, 0.044, 0.034], [0.302, 0.131, 0.026, 0.029, 0.024]],
    neck: [0.13, 0.215], bill: { z: 0.288, y: 0.126, len: 0.33, pitch: -0.3, w: 0.027, up: 0.013, low: 0.012, hook: 0.013, gonys: 0, pouch: 0.05 },
    tail: { z: -0.3, y: 0.03, w: 0.045, len: [0.145, 0.143, 0.138, 0.128], spread: 0.36 },
    wing: { root: [0.1, 0.07, 0.08], span: 0.95, elbow: 0.28, wrist: 0.55, thick: [0.14, 0.08, 0.035], le: [[0, 0.11], [0.28, 0.11], [0.55, 0.09], [0.8, 0.035], [0.93, -0.02], [1, -0.085]], chord: [[0, 0.43], [0.28, 0.41], [0.55, 0.38], [0.8, 0.31], [0.93, 0.23], [1, 0.11]] },
    fold: { front: 0.17, tip: -0.42, top: 0.1, h: 0.15, minX: 0.025 }, legs: { hip: [0.06, -0.09, -0.03], tibia: 0.085, tarsus: 0.075, r: 0.0085, toe: 0.095 },
    cor: { baixo: [0.07, 0.065, 0.06], manto: [0.11, 0.1, 0.09], cabeca: [0.62, 0.56, 0.36], ponta: [0.04, 0.04, 0.04], bico: [0.42, 0.34, 0.27], perna: [0.05, 0.05, 0.05], cauda: [0.2, 0.19, 0.17] }, vel: 8, flap: 1.9 },
  fragata: { length: 1.0, span: 2.3,
    body: [[-0.172, 0.012, 0.022, 0.015, 0.015], [-0.12, 0.004, 0.048, 0.036, 0.038], [-0.04, 0, 0.068, 0.053, 0.058], [0.045, 0, 0.068, 0.053, 0.06], [0.11, 0.01, 0.047, 0.043, 0.045], [0.15, 0.022, 0.031, 0.033, 0.032], [0.178, 0.029, 0.03, 0.033, 0.028], [0.203, 0.031, 0.029, 0.032, 0.026], [0.224, 0.028, 0.022, 0.025, 0.019], [0.24, 0.024, 0.013, 0.015, 0.011]],
    neck: [0.105, 0.16], bill: { z: 0.233, y: 0.024, len: 0.115, pitch: -0.04, w: 0.0075, up: 0.0075, low: 0.006, hook: 0.013, gonys: 0, pouch: 0 },
    tail: { z: -0.165, y: 0.012, w: 0.02, len: [0.14, 0.2, 0.31, 0.42], spread: 0.1 },
    wing: { root: [0.05, 0.03, 0.05], span: 1.1, elbow: 0.19, wrist: 0.41, thick: [0.13, 0.07, 0.03], le: [[0, 0.07], [0.19, 0.08], [0.41, 0.09], [0.68, 0.01], [0.88, -0.09], [1, -0.19]], chord: [[0, 0.3], [0.19, 0.29], [0.41, 0.26], [0.68, 0.17], [0.88, 0.09], [1, 0.018]] },
    fold: { front: 0.11, tip: -0.48, top: 0.05, h: 0.075, minX: 0.012 }, legs: { hip: [0.03, -0.05, 0.0], tibia: 0.022, tarsus: 0.022, r: 0.005, toe: 0.04 },
    cor: { baixo: [0.018, 0.018, 0.022], manto: [0.012, 0.012, 0.016], cabeca: [0.012, 0.012, 0.016], ponta: [0.01, 0.01, 0.012], bico: [0.25, 0.25, 0.27], perna: [0.05, 0.03, 0.03], cauda: [0.012, 0.012, 0.016] }, vel: 10, flap: 1.6 },
  macarico: { length: 0.2, span: 0.38,
    body: [[-0.066, 0.007, 0.011, 0.007, 0.007], [-0.046, 0.004, 0.021, 0.017, 0.019], [-0.016, 0, 0.029, 0.025, 0.029], [0.014, 0, 0.03, 0.026, 0.029], [0.038, 0.004, 0.025, 0.023, 0.024], [0.056, 0.012, 0.017, 0.018, 0.016], [0.069, 0.017, 0.016, 0.018, 0.015], [0.082, 0.019, 0.015, 0.017, 0.013], [0.093, 0.017, 0.011, 0.013, 0.009], [0.1, 0.014, 0.006, 0.007, 0.005]],
    neck: [0.043, 0.062], bill: { z: 0.096, y: 0.0135, len: 0.027, pitch: -0.06, w: 0.0026, up: 0.0028, low: 0.0024, hook: 0.0004, gonys: 0, pouch: 0 },
    tail: { z: -0.062, y: 0.008, w: 0.01, len: [0.05, 0.048, 0.045, 0.041], spread: 0.3 },
    wing: { root: [0.016, 0.012, 0.012], span: 0.174, elbow: 0.22, wrist: 0.46, thick: [0.15, 0.08, 0.035], le: [[0, 0.016], [0.22, 0.019], [0.46, 0.017], [0.7, 0.001], [0.88, -0.016], [1, -0.038]], chord: [[0, 0.06], [0.22, 0.058], [0.46, 0.052], [0.7, 0.04], [0.88, 0.025], [1, 0.005]] },
    fold: { front: 0.035, tip: -0.1, top: 0.022, h: 0.03, minX: 0.005 }, legs: { hip: [0.011, -0.021, 0.004], tibia: 0.02, tarsus: 0.024, r: 0.0019, toe: 0.017 },
    cor: { baixo: [0.86, 0.86, 0.84], manto: [0.42, 0.41, 0.39], cabeca: [0.6, 0.6, 0.58], ponta: [0.05, 0.05, 0.05], bico: [0.02, 0.02, 0.02], perna: [0.02, 0.02, 0.02], cauda: [0.45, 0.44, 0.42] }, vel: 7, flap: 9 },
};
const ESP = SPECIES;
const pe = (sp) => -(sp.legs.hip[1] - sp.legs.tibia * 0.8 - sp.legs.tarsus) + 0.004;   // do centro do corpo aos pés (em pé)
const NB = 12, NR = 10, RING_S = [0, 0.06, 0.16, 0.29, 0.43, 0.56, 0.66, 0.74, 0.81, 0.875, 0.94, 1];
const NBL = 5, NRB = 8, BILL_T = [0, 0.22, 0.48, 0.72, 0.9], NT = 7, WV = [0, 0.18, 0.55, 1];
const AIR_TOP = [0.05, 1.0, 0.62, 0], AIR_BOT = [0.05, 0.42, 0.22, 0], AIR_CAMBER = [0, 0.05, 0.045, 0];
const prof = (pts, x) => {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i], t = (x - a[0]) / (b[0] - a[0]), s = t * t * (3 - 2 * t); return a[1] + (b[1] - a[1]) * (0.4 * t + 0.6 * s); }
  return pts[pts.length - 1][1];
};
const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);
const sm01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const spanStations = (W) => { const e = W.elbow, w = W.wrist; return [0, e * 0.5, e, (e + w) / 2, w, w + (1 - w) * 0.3, w + (1 - w) * 0.58, w + (1 - w) * 0.82, 1]; };

// corpo de uma espécie: pose de voo (asas abertas em ±x, frente +z) e dobrada; partes: 0 corpo 1 pescoço 2 cabeça
// 3 bico 4 cauda 5 braço 6 antebraço 7 mão 8 perna (em pé; recolhida no voo)
function corpoAve(sp) {
  const pos = [], fold = [], info = [], idx = [];
  const vtx = (p, f, pt, w, u, v) => { pos.push(...p); fold.push(...f); info.push(pt, w, u, v); return pos.length / 3 - 1; };
  const B = sp.body, z0 = B[0][0], z1 = B[B.length - 1][0];
  const col = (k) => B.map((s) => [s[0], s[k]]);
  const Y = col(1), HW = col(2), HT = col(3), HB = col(4);
  const partOf = (z) => (z < sp.neck[0] ? 0 : z < sp.neck[1] ? 1 : 2);
  const first = pos.length / 3;
  for (let i = 0; i < NB; i++) {
    const s = RING_S[i], z = z0 + (z1 - z0) * s, y = prof(Y, z), hw = prof(HW, z), ht = prof(HT, z), hb = prof(HB, z);
    for (let j = 0; j < NR; j++) {
      const th = j / NR * TAU, c = Math.cos(th), sn = Math.sin(th);
      const p = [hw * spow(sn, 0.85), y + (c > 0 ? ht : hb) * spow(c, 0.85), z];
      vtx(p, p, partOf(z), 0, s, c);
    }
  }
  const rear = vtx([0, prof(Y, z0), z0 - prof(HW, z0) * 0.5], [0, prof(Y, z0), z0 - prof(HW, z0) * 0.5], 0, 0, 0, 0);
  const fz = z1 + prof(HW, z1) * 0.6, front = vtx([0, prof(Y, z1), fz], [0, prof(Y, z1), fz], 2, 0, 1, 0);
  const P = (i, j) => first + i * NR + (j % NR);
  for (let i = 0; i < NB - 1; i++) for (let j = 0; j < NR; j++) idx.push(P(i, j), P(i + 1, j), P(i, j + 1), P(i, j + 1), P(i + 1, j), P(i + 1, j + 1));
  for (let j = 0; j < NR; j++) { idx.push(rear, P(0, j), P(0, j + 1)); idx.push(front, P(NB - 1, j + 1), P(NB - 1, j)); }
  // bico
  const Bl = sp.bill, fb = pos.length / 3;
  const billAt = (t) => {
    const cz = Bl.z + t * Bl.len * Math.cos(Bl.pitch), cy = Bl.y + t * Bl.len * Math.sin(Bl.pitch) - Bl.hook * sm01(0.72, 1, t) * 1.3;
    const taper = 1 - 0.72 * Math.pow(t, 1.3);
    return { cz, cy, hw: Bl.w * taper, up: Bl.up * (1 - 0.65 * Math.pow(t, 1.2)), low: Bl.low * (1 - 0.7 * Math.pow(t, 1.1)) + Bl.gonys * Math.exp(-Math.pow((t - 0.78) / 0.08, 2)) + Bl.pouch * Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.7) * 1.05)) * (1 - t * 0.6) };
  };
  for (let i = 0; i < NBL; i++) {
    const b = billAt(BILL_T[i]);
    for (let j = 0; j < NRB; j++) { const th = j / NRB * TAU, c = Math.cos(th), sn = Math.sin(th); const p = [b.hw * spow(sn, 0.8), b.cy + (c > 0 ? b.up : b.low) * spow(c, 0.8), b.cz]; vtx(p, p, 3, 0, BILL_T[i], c); }
  }
  const tp = billAt(1), billTip = vtx([0, tp.cy - tp.low * 0.2, tp.cz + 0.002], [0, tp.cy - tp.low * 0.2, tp.cz + 0.002], 3, 0, 1, 0);
  const PB = (i, j) => fb + i * NRB + (j % NRB);
  for (let i = 0; i < NBL - 1; i++) for (let j = 0; j < NRB; j++) idx.push(PB(i, j), PB(i + 1, j), PB(i, j + 1), PB(i, j + 1), PB(i + 1, j), PB(i + 1, j + 1));
  for (let j = 0; j < NRB; j++) idx.push(billTip, PB(NBL - 1, j + 1), PB(NBL - 1, j));
  // cauda em leque (duas camadas)
  const T = sp.tail, ft = pos.length / 3;
  for (const layer of [1, -1]) for (let r = 0; r < 3; r++) {
    const f = r / 2;
    for (let k = 0; k < NT; k++) {
      const a = k / (NT - 1) * 2 - 1, len = T.len[Math.round(Math.abs(a) * 3)], ang = a * T.spread;
      const p = [a * T.w + Math.sin(ang) * len * f, T.y + layer * 0.0012 * (1 - f * 0.6) * (sp.length / 0.4) - 0.004 * f * f * (sp.length / 0.4), T.z - Math.cos(ang) * len * f];
      vtx(p, p, 4, 0, f, layer);
    }
  }
  const PT = (l, r, k) => ft + l * 3 * NT + r * NT + k;
  for (let r = 0; r < 2; r++) for (let k = 0; k < NT - 1; k++) {
    idx.push(PT(0, r, k), PT(0, r, k + 1), PT(0, r + 1, k), PT(0, r, k + 1), PT(0, r + 1, k + 1), PT(0, r + 1, k));
    idx.push(PT(1, r, k), PT(1, r + 1, k), PT(1, r, k + 1), PT(1, r, k + 1), PT(1, r + 1, k), PT(1, r + 1, k + 1));
  }
  // asas
  const Wg = sp.wing, Fd = sp.fold, us = spanStations(Wg);
  const flankX = (y, z) => { if (z < z0 || z > z1) return 0; const yc = prof(Y, z), hw = prof(HW, z), hh = y > yc ? prof(HT, z) : prof(HB, z); const d = (y - yc) / hh; return d >= 1 ? 0 : hw * Math.sqrt(1 - d * d); };
  for (const side of [1, -1]) {
    const fw = pos.length / 3;
    for (let i = 0; i < 9; i++) {
      const u = us[i], le = prof(Wg.le, u), c = prof(Wg.chord, u);
      const th = u < Wg.wrist ? Wg.thick[0] + (Wg.thick[1] - Wg.thick[0]) * u / Wg.wrist : Wg.thick[1] + (Wg.thick[2] - Wg.thick[1]) * (u - Wg.wrist) / (1 - Wg.wrist);
      const x = Wg.root[0] + u * Wg.span;
      const pt = u < Wg.elbow ? 5 : u < Wg.wrist ? 6 : 7;
      const a = Math.pow(u, 0.85), zfA = Fd.front + (Fd.tip - Fd.front) * a, hA = Fd.h * Math.pow(1 - a, 0.55) * (1 - 0.25 * a) + Fd.h * 0.08;
      for (const [v, s2] of [[0, 1], [WV[1], 1], [WV[2], 1], [1, 0], [WV[2], -1], [WV[1], -1]]) {
        const k = WV.indexOf(v), ht = s2 >= 0 ? AIR_TOP[k] : -AIR_BOT[k];
        const y = Wg.root[1] + (AIR_CAMBER[k] + ht * th) * c;
        const p = [side * x, y, Wg.root[2] + le - v * c];
        const yTop = prof(Y, Math.min(Math.max(zfA, z0), z1)) + Fd.top * (1 - 0.55 * a) - 0.004 * a, yf = yTop - v * hA, zf = zfA - v * hA * 0.35;
        const xf = Math.max(flankX(yf, zf) * 1.06, Fd.minX * (1 - 0.3 * v)) + (s2 >= 0 ? 0.0035 : -0.001) * (sp.length / 0.4) + 0.0015 * (1 - u);
        vtx(p, [side * xf, yf, zf], pt, side, u, s2 >= 0 ? 1 : -1);
      }
    }
    const PW = (i, j) => fw + i * 6 + (j % 6);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 6; j++) {
      if (side < 0) idx.push(PW(i, j), PW(i, j + 1), PW(i + 1, j), PW(i, j + 1), PW(i + 1, j + 1), PW(i + 1, j));
      else idx.push(PW(i, j), PW(i + 1, j), PW(i, j + 1), PW(i, j + 1), PW(i + 1, j), PW(i + 1, j + 1));
    }
  }
  // pernas em pé (tubo quadrado quadril → joelho → tornozelo + 3 dedos); no voo o shader as recolhe ao quadril
  const Lg = sp.legs;
  for (const side of [1, -1]) {
    const hip = [side * Lg.hip[0], Lg.hip[1], Lg.hip[2]], knee = [hip[0], hip[1] - Lg.tibia * 0.8, hip[2] - Lg.tibia * 0.45], ank = [knee[0], knee[1] - Lg.tarsus, knee[2] + Lg.tarsus * 0.12];
    const fl = pos.length / 3, nodes = [hip, knee, ank], R = Lg.r;
    for (let r = 0; r < 3; r++) for (let j = 0; j < 4; j++) { const a = j / 4 * TAU + Math.PI / 4; const p = [nodes[r][0] + Math.cos(a) * R * 1.2, nodes[r][1], nodes[r][2] + Math.sin(a) * R * 1.2]; vtx(p, hip, 8, side, r / 2, 0); }
    const PL = (r, j) => fl + r * 4 + (j % 4);
    for (let r = 0; r < 2; r++) for (let j = 0; j < 4; j++) idx.push(PL(r, j), PL(r, j + 1), PL(r + 1, j), PL(r, j + 1), PL(r + 1, j + 1), PL(r + 1, j));
    const c0 = vtx([ank[0], ank[1] - 0.002, ank[2] - Lg.toe * 0.12], hip, 8, side, 1, 0);
    for (const a of [-0.5, 0, 0.5]) {
      const t1 = vtx([ank[0] + Math.sin(a * side) * Lg.toe, ank[1] - 0.002, ank[2] + Math.cos(a) * Lg.toe], hip, 8, side, 1, 0);
      const t2 = vtx([ank[0] + Math.sin(a * side) * Lg.toe * 0.3 + 0.002, ank[1] - 0.002, ank[2] + Math.cos(a) * Lg.toe * 0.3], hip, 8, side, 1, 0);
      idx.push(c0, t1, t2, c0, t2, t1);
    }
  }
  const n = pos.length / 3;
  const normais = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.setIndex(idx); g.computeVertexNormals(); return g.attributes.normal.array; };
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normais(pos), 3));
  g.setAttribute('aFold', new THREE.Float32BufferAttribute(fold, 3));
  g.setAttribute('aFoldN', new THREE.Float32BufferAttribute(normais(fold), 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setIndex(idx);
  return { g, n, sp };
}

// cores e ombro/cotovelo/pulso de cada espécie entram como uniformes do seu material
const VS = /* glsl */`
precision highp float;
in vec3 position, normal, aFold, aFoldN;
in vec4 aInfo, iPos, iPose, iExtra;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec4 uOmbro;           // xyz ombro esquerdo (+x), w = fração do cotovelo
uniform vec2 uPulso;           // x = fração do pulso, y = encurvar da mão no planeio ("M")
uniform vec3 cBaixo, cManto, cCabeca, cPonta, cBico, cPerna, cCauda;
out vec3 vCor, vWorld, vN;
vec3 giraZ(vec3 p, vec3 c, float a) { vec3 d = p - c; float ca = cos(a), sa = sin(a); return c + vec3(d.x * ca - d.y * sa, d.x * sa + d.y * ca, d.z); }
void main() {
  float parte = aInfo.x, lado = aInfo.y, u = aInfo.z, v = aInfo.w;
  float lift = iPose.z, dobra = iPose.w;
  vec3 p = position, n = normal;
  if (parte > 4.5 && parte < 7.5) {
    // asa: o braço sobe com a batida; o antebraço e a mão somam; no planeio a mão cai (o "M")
    float glide = 1.0 - clamp(abs(lift) * 2.5, 0.0, 1.0);
    float a = lift * (0.65 + 0.35 * u) + smoothstep(uPulso.x, 1.0, u) * (uPulso.y + iExtra.z) * glide * 0.6
            - smoothstep(0.0, uOmbro.w, u) * 0.08 * glide;
    vec3 sh = vec3(lado * uOmbro.x, uOmbro.y, uOmbro.z);
    p = giraZ(p, sh, lado * a);
    n = giraZ(n, vec3(0.0), lado * a);
    p = mix(p, aFold, dobra); n = normalize(mix(n, aFoldN, dobra));
  } else if (parte > 7.5) {
    p = mix(aFold, p, iExtra.y);                      // pernas: em pé (1) ou recolhidas no quadril (0)
  }
  // cor por parte (plumagem)
  vec3 c = cBaixo;
  if (parte < 0.5) c = mix(cBaixo, cManto, smoothstep(0.1, 0.55, v));
  else if (parte < 1.5) c = mix(cBaixo, cCabeca, smoothstep(0.0, 1.0, u * 0.0 + 0.5) * smoothstep(-0.2, 0.6, v));
  else if (parte < 2.5) c = cCabeca;
  else if (parte < 3.5) c = cBico;
  else if (parte < 4.5) c = cCauda;
  else if (parte < 7.5) c = mix(v > 0.0 ? cManto : mix(cBaixo, cManto, 0.25), cPonta, smoothstep(0.78, 0.9, u));
  else c = cPerna;
  vCor = c;
  float sc = iExtra.x;
  p *= sc;
  float pitch = iPose.x, bank = iPose.y, yaw = iPos.w;
  float cb = cos(bank), sb = sin(bank), cp = cos(pitch), sp = sin(pitch), cy = cos(yaw), sy = sin(yaw);
  p = vec3(p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z); n = vec3(n.x * cb - n.y * sb, n.x * sb + n.y * cb, n.z);
  p = vec3(p.x, p.y * cp + p.z * sp, -p.y * sp + p.z * cp); n = vec3(n.x, n.y * cp + n.z * sp, -n.y * sp + n.z * cp);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy); n = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);
  vec3 w = iPos.xyz + p;
  vWorld = w; vN = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;
const FS = /* glsl */`
precision highp float;
${COMMON}
uniform vec3 cameraPosition;
in vec3 vCor, vWorld, vN;
out vec4 outColor;
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  float ndl = dot(N, uLightDir);
  vec3 luz = uSunColor * max(ndl * 0.8 + 0.2, 0.0) + mix(uAmbGround, uAmbSky, 0.5 + 0.5 * N.y);
  // penas: um pouco de luz atravessa as bordas finas contra o sol
  luz += uSunColor * pow(max(dot(-V, uLightDir), 0.0), 6.0) * 0.25;
  vec3 c = vCor * luz;
  vec4 nv = fogAt(length(cameraPosition - vWorld), -V, vWorld.y);
  outColor = vec4(finish(mix(c, nv.rgb, nv.a)), 1.0);
}
`;

export function initAves({ scene, camera, game, player }) {
  const pc = game.plataforma === 'pc' || !game.plataforma;
  const lotes = {};
  for (const nome of Object.keys(ESP)) {
    const sp = ESP[nome], { g } = corpoAve(sp), max = 64, C = sp.cor;
    const v3 = (a) => ({ value: new THREE.Vector3(...a) });
    const uniforms = { ...U, uOmbro: { value: new THREE.Vector4(sp.wing.root[0], sp.wing.root[1], sp.wing.root[2], sp.wing.elbow) },
      uPulso: { value: new THREE.Vector2(sp.wing.wrist, nome === 'fragata' ? -0.55 : -0.3) },
      cBaixo: v3(C.baixo), cManto: v3(C.manto), cCabeca: v3(C.cabeca), cPonta: v3(C.ponta), cBico: v3(C.bico), cPerna: v3(C.perna), cCauda: v3(C.cauda) };
    const mat = new THREE.RawShaderMaterial({ name: 'aves-' + nome, glslVersion: THREE.GLSL3, uniforms, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide });
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.setAttribute('iPose', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.setAttribute('iExtra', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.visible = false; m.name = 'aves-' + nome;
    scene.add(m);
    lotes[nome] = { g, m, max };
  }

  let aves = [], genUsado = null, t = 0, poleiros = [], poleirosEm = -1;
  let semente = 1119;
  const rnd = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
  const chao = (x, z) => game.gen.height(Math.round(x), Math.round(z)) + 1;
  const sCosta = (x, z) => game.gen.arq.s(x, z);
  const somar = (nome, x, y, z, vol = 0.6) => { try { game.audio?.play(nome, vol, 0.9 + rnd() * 0.25, 'stone', [x, y, z]); } catch { /* sem som */ } };
  // um ponto de praia a partir do centro da ilha, num ângulo, com a distância à costa pedida
  function pontoCosta(ang, sAlvo) {
    const cx = 60, cz = -130, dx = Math.cos(ang), dz = Math.sin(ang);
    let ant = null;
    for (let r = 40; r < 600; r += 1.5) {
      const x = cx + dx * r, z = cz + dz * r, s = sCosta(x, z);
      if (ant !== null && ant < sAlvo && s >= sAlvo) return [x, z];
      ant = s;
    }
    return null;
  }
  // poleiros: objetos da praia decorada (píer, cabana, torres, botes)
  function montarPoleiros() {
    poleiros = [];
    const lista = game.objects?.list;
    if (!lista) return;
    for (const e of lista.values()) {
      const o = e.o;
      if (!o || o.dec !== 'litoral') continue;
      const q = o.q, yaw = Math.atan2(2 * (q[3] * q[1] + q[0] * q[2]), 1 - 2 * (q[1] * q[1] + q[0] * q[0]));
      const fx = Math.sin(yaw), fz = Math.cos(yaw), topo = o.p[1] + o.k[1] / 2;
      if (o.nome === 'pier') for (const f of [-0.42, -0.2, 0.05, 0.3, 0.46]) poleiros.push({ x: o.p[0] + fx * f * o.k[2], y: topo - 0.2, z: o.p[2] + fz * f * o.k[2], livre: true });
      else if (o.nome === 'cabana' || o.nome === 'salva') poleiros.push({ x: o.p[0], y: topo + 0.05, z: o.p[2], livre: true });
      else if (o.nome?.startsWith('bote')) poleiros.push({ x: o.p[0] + fx * o.k[2] * 0.4, y: topo, z: o.p[2] + fz * o.k[2] * 0.4, livre: true });
    }
  }
  function nova(esp, extra = {}) { return { esp, x: 0, y: 30, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, bank: 0, lift: 0, dobra: 0, pernas: 0, fase: rnd() * 100, est: 'voo', tm: 0, ...extra }; }
  function povoar() {
    aves = [];
    const cx = 60, cz = -130;
    for (let i = 0; i < (pc ? 16 : 9); i++) {
      // térmicas sobre a costa: um ponto da beira-mar, ao redor da ilha
      const c = pontoCosta(rnd() * TAU, 10) || [cx, cz];
      aves.push(nova('gaivota', { cx: c[0], cz: c[1], raio: 18 + rnd() * 30, alt: MAR_NIVEL + 10 + rnd() * 22, giro: rnd() < 0.5 ? -1 : 1, ang: rnd() * TAU, tm: 6 + rnd() * 25 }));
    }
    for (let i = 0; i < (pc ? 5 : 3); i++) aves.push(nova('trinta', { ang: rnd() * TAU, tm: rnd() * 10, est: 'patrulha' }));
    for (let i = 0; i < 5; i++) aves.push(nova('pelicano', { est: 'fila', i, a0: rnd() * TAU }));
    for (let i = 0; i < 3; i++) aves.push(nova('fragata', { cx: cx + (rnd() - 0.5) * 200, cz: cz + (rnd() - 0.5) * 200, raio: 60 + rnd() * 50, alt: MAR_NIVEL + 55 + rnd() * 35, giro: rnd() < 0.5 ? -1 : 1, ang: rnd() * TAU, est: 'plana' }));
    for (let b = 0; b < (pc ? 4 : 2); b++) {
      const a0 = rnd() * TAU;
      for (let i = 0; i < 6; i++) aves.push(nova('macarico', { a: a0 + (i - 3) * 0.004, est: 'beira', off: rnd() * 2, tm: rnd() * 3 }));
    }
    for (const a of aves) {
      if (a.esp === 'gaivota' || a.esp === 'fragata') { a.x = a.cx + Math.cos(a.ang) * a.raio; a.z = a.cz + Math.sin(a.ang) * a.raio; a.y = a.alt; }
    }
  }
  // voo até um ponto: aceleração limitada, rumo e rolagem pela curva, arfagem pela subida
  function voar(a, dt, tx, ty, tz, vel, bater) {
    const dx = tx - a.x, dy = ty - a.y, dz = tz - a.z, d = Math.hypot(dx, dy, dz) || 1;
    const k = aprox(1.6, dt);
    a.vx = lerp(a.vx, dx / d * vel, k); a.vy = lerp(a.vy, clamp(dy / d * vel, -4, 3), k); a.vz = lerp(a.vz, dz / d * vel, k);
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    const yaw = Math.atan2(a.vx, a.vz), dyaw = angDiff(a.yaw, yaw);
    a.yaw += dyaw * aprox(3, dt);
    a.bank = lerp(a.bank, clamp(-dyaw * 2.2, -0.8, 0.8), aprox(3, dt));
    a.pitch = lerp(a.pitch, clamp(a.vy * 0.12, -0.6, 0.5), aprox(3, dt));
    a.dobra = lerp(a.dobra, 0, aprox(5, dt)); a.pernas = lerp(a.pernas, 0, aprox(6, dt));
    const sp = ESP[a.esp];
    const porta = bater ? 1 : clamp(Math.sin(t * 0.23 + a.fase) * 0.5 + 0.5 > 0.68 ? 1 : 0, 0, 1);
    a.porta = lerp(a.porta || 0, porta, aprox(4, dt));
    a.lift = a.porta * Math.sin(t * TAU * sp.flap + a.fase * 7) * 0.6 + 0.08;
    return d;
  }
  function pousado(a, dt, px, py, pz) {
    a.x = lerp(a.x, px, aprox(6, dt)); a.y = lerp(a.y, py + pe(ESP[a.esp]), aprox(6, dt)); a.z = lerp(a.z, pz, aprox(6, dt));
    a.vx = a.vy = a.vz = 0;
    a.dobra = lerp(a.dobra, 1, aprox(5, dt)); a.pernas = lerp(a.pernas, 1, aprox(5, dt));
    a.bank = lerp(a.bank, 0, aprox(5, dt)); a.pitch = lerp(a.pitch, -0.05 + Math.sin(t * 0.7 + a.fase) * 0.04, aprox(4, dt));
    a.lift = 0;
    if (rnd() < dt * 0.15) a.yawAlvo = a.yaw + (rnd() - 0.5) * 2.4;
    if (a.yawAlvo !== undefined) a.yaw += angDiff(a.yaw, a.yawAlvo) * aprox(2, dt);
  }
  function espanta(a, pp) { const dx = a.x - pp[0], dz = a.z - pp[2]; return dx * dx + dz * dz + (a.y - pp[1]) ** 2 < 49; }

  function passo(dt, pp) {
    for (const a of aves) {
      if (a.esp === 'gaivota') {
        a.tm -= dt;
        if (a.est === 'voo') {
          a.ang += a.giro * dt * ESP.gaivota.vel / a.raio;
          const tx = a.cx + Math.cos(a.ang) * a.raio, tz = a.cz + Math.sin(a.ang) * a.raio;
          voar(a, dt, tx, a.alt + Math.sin(a.ang * 2 + a.fase) * 3, tz, ESP.gaivota.vel, false);
          if (a.tm <= 0) {
            // escolhe onde descer: um poleiro livre (píer, cabana, torre, bote) ou a areia, em bando
            const livres = poleiros.filter((p) => p.livre && Math.hypot(p.x - a.x, p.z - a.z) < 180);
            if (livres.length && rnd() < 0.65) { const p = livres[Math.floor(rnd() * livres.length)]; p.livre = false; a.alvo = p; a.est = 'desce'; }
            else {
              // areia mais perto de onde ela está (o ângulo dela visto do meio da ilha)
              const c = pontoCosta(Math.atan2(a.z + 130, a.x - 60) + (rnd() - 0.5) * 0.3, -6 - rnd() * 6);
              if (c) { a.alvo = { x: c[0] + (rnd() - 0.5) * 4, z: c[1] + (rnd() - 0.5) * 4, y: chao(c[0], c[1]), areia: true }; a.est = 'desce'; } else a.tm = 10;
            }
          }
        } else if (a.est === 'desce') {
          const p = a.alvo, dh = Math.hypot(p.x - a.x, p.z - a.z);
          if (dh > 7) voar(a, dt, p.x, p.y + 0.4 + Math.min(12, dh * 0.25), p.z, Math.max(4, ESP.gaivota.vel * 0.8), false);
          else {
            // aproximação final: freia de asas abertas para cima, pernas para baixo, e encosta no poleiro
            const k = aprox(1.8, dt);
            a.x = lerp(a.x, p.x, k); a.z = lerp(a.z, p.z, k); a.y = lerp(a.y, p.y + pe(ESP.gaivota), k);
            a.yaw += angDiff(a.yaw, Math.atan2(p.x - a.x, p.z - a.z)) * aprox(4, dt);
            a.pitch = lerp(a.pitch, 0.55, aprox(4, dt)); a.bank = lerp(a.bank, 0, aprox(4, dt));
            a.lift = 0.75 + Math.sin(t * TAU * 4 + a.fase) * 0.45; a.pernas = lerp(a.pernas, 1, aprox(3, dt));
            if (dh < 0.35 && Math.abs(a.y - p.y) < 0.6) { a.est = 'pousada'; a.tm = 25 + rnd() * 60; a.yawAlvo = a.yaw; }
          }
        } else if (a.est === 'pousada') {
          const p = a.alvo;
          pousado(a, dt, p.x, p.y, p.z);
          if (p.areia && rnd() < dt * 0.2) { p.x += Math.sin(a.yaw) * 0.25; p.z += Math.cos(a.yaw) * 0.25; p.y = chao(p.x, p.z); }   // passinhos na areia
          if (espanta(a, pp) || a.tm <= 0) {
            if (espanta(a, pp)) somar('gull', a.x, a.y, a.z, 0.7);
            if (!p.areia) p.livre = true;
            a.est = 'voo'; a.tm = 20 + rnd() * 40;
            const fx = a.x - pp[0], fz = a.z - pp[2], l = Math.hypot(fx, fz) || 1;
            a.cx = a.x + fx / l * 30; a.cz = a.z + fz / l * 30; a.alt = MAR_NIVEL + 8 + rnd() * 18;
            a.vy = 3; a.ang = Math.atan2(a.z - a.cz, a.x - a.cx);
          }
        }
        if (a.est !== 'pousada' && rnd() < dt * 0.02) somar('gull', a.x, a.y, a.z, 0.35);
      } else if (a.esp === 'trinta') {
        a.tm -= dt;
        if (!a.base || a.tm < -30) { const c = pontoCosta(rnd() * TAU, 30 + rnd() * 40); if (c) a.base = c; a.tm = 6 + rnd() * 8; a.est = 'patrulha'; }
        if (!a.base) continue;
        if (a.est === 'patrulha') {
          voar(a, dt, a.base[0] + Math.cos(t * 0.15 + a.fase) * 25, MAR_NIVEL + 9, a.base[1] + Math.sin(t * 0.15 + a.fase) * 25, ESP.trinta.vel, false);
          if (a.tm <= 0) { a.est = 'paira'; a.tm = 2.5 + rnd() * 3; }
        } else if (a.est === 'paira') {
          // pairando contra o vento: parado no ar, batidas rápidas e curtas
          const w = U.uWind.value; a.yaw += angDiff(a.yaw, Math.atan2(-w.x, -w.y)) * aprox(2, dt);
          a.vx = a.vy = a.vz = 0; a.y += Math.sin(t * 3 + a.fase) * 0.01; a.pitch = 0.35; a.bank = 0;
          a.lift = Math.sin(t * TAU * 7 + a.fase) * 0.35 + 0.1; a.dobra = 0;
          a.tm -= dt;
          if (a.tm <= 0) { a.est = 'mergulho'; a.vy = 0; }
        } else if (a.est === 'mergulho') {
          a.vy = Math.max(a.vy - 22 * dt, -16); a.y += a.vy * dt; a.pitch = -1.3; a.dobra = lerp(a.dobra, 0.85, aprox(8, dt)); a.lift = 0;
          let agua = game.mar?.altura ? game.mar.altura(a.x, a.z) : MAR_NIVEL;
          if (!Number.isFinite(agua)) agua = MAR_NIVEL;
          if (a.y <= agua || a.y < MAR_NIVEL - 0.8) { somar('splash', a.x, agua, a.z, 0.5); a.est = 'sobe'; a.tm = 0.5; a.y = Math.max(a.y, agua); }
        } else if (a.est === 'sobe') {
          a.tm -= dt;
          voar(a, dt, a.x + Math.sin(a.yaw) * 10, MAR_NIVEL + 9, a.z + Math.cos(a.yaw) * 10, 6, true);
          if (a.y > MAR_NIVEL + 7) { a.est = 'patrulha'; a.tm = 6 + rnd() * 10; if (rnd() < 0.4) somar('tern', a.x, a.y, a.z, 0.4); }
        }
      } else if (a.esp === 'pelicano') {
        // fila rasando a ondulação (efeito solo), além da arrebentação, dando a volta na ilha; a batida de asa
        // começa no da frente e desce a fila
        const ang = (aves.find((b) => b.esp === 'pelicano' && b.i === 0)?.a0 ?? 0) + t * 0.012 - a.i * 0.012;
        if (!a.rota || Math.abs(angDiff(a.rotaAng, ang)) > 0.01) { a.rota = pontoCosta(ang, 55); a.rotaAng = ang; }
        if (!a.rota) continue;
        const agua = game.mar?.altura ? game.mar.altura(a.rota[0], a.rota[1]) : MAR_NIVEL;
        voar(a, dt, a.rota[0], agua + 1.3, a.rota[1], ESP.pelicano.vel, false);
        const onda = Math.sin(t * 0.35 - a.i * 0.9);
        a.porta = onda > 0.55 ? 1 : 0;
        a.lift = a.porta * Math.sin(t * TAU * ESP.pelicano.flap - a.i * 0.8) * 0.55 + 0.04;
      } else if (a.esp === 'fragata') {
        a.ang += a.giro * dt * ESP.fragata.vel / a.raio;
        voar(a, dt, a.cx + Math.cos(a.ang) * a.raio, a.alt + Math.sin(t * 0.05 + a.fase) * 6, a.cz + Math.sin(a.ang) * a.raio, ESP.fragata.vel, false);
        a.lift = 0.12; a.porta = 0;                     // asa parada, dobrada no pulso
      } else if (a.esp === 'macarico') {
        // correm na beira: a linha d'água vai e vem com a onda (shared/mar.js → costa)
        if (!a.p0) { a.p0 = pontoCosta(a.a, -1); if (!a.p0) continue; const q = pontoCosta(a.a, 4) || a.p0; a.dir = [q[0] - a.p0[0], q[1] - a.p0[1]]; const l = Math.hypot(...a.dir) || 1; a.dir = [a.dir[0] / l, a.dir[1] / l]; a.x = a.p0[0]; a.z = a.p0[1]; a.y = chao(a.x, a.z); }
        const onda = marCosta(a.p0[0], a.p0[1], game.mar?.fase ?? t / 9.5, 0.1, 0, game.mar?.estado ?? 0.35);
        const alvoS = -0.5 + clamp(-onda.y * 6, -2.5, 3) + a.off;
        const tx = a.p0[0] + a.dir[0] * alvoS + Math.sin(a.fase) * 1.2, tz = a.p0[1] + a.dir[1] * alvoS + Math.cos(a.fase) * 1.2;
        const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
        let fuga = espanta(a, pp) ? 1 : 0;
        const vel = fuga ? 3.2 : clamp(d * 2, 0, 2.6);
        if (fuga) { const fx = a.x - pp[0], fz = a.z - pp[2], l = Math.hypot(fx, fz) || 1; a.x += fx / l * vel * dt; a.z += fz / l * vel * dt; a.p0[0] += fx / l * vel * dt; a.p0[1] += fz / l * vel * dt; }
        else if (d > 0.05) { a.x += dx / d * vel * dt; a.z += dz / d * vel * dt; a.yaw += angDiff(a.yaw, Math.atan2(dx, dz)) * aprox(8, dt); }
        a.y = chao(a.x, a.z) + pe(ESP.macarico);
        a.pitch = d < 0.2 && Math.sin(t * 5 + a.fase * 3) > 0.6 ? -0.5 : 0;   // bicando
        a.dobra = 1; a.pernas = 1; a.lift = 0; a.bank = 0;
      }
    }
  }
  function enviar() {
    const cont = {};
    for (const n in lotes) cont[n] = 0;
    for (const a of aves) {
      const l = lotes[a.esp], k = cont[a.esp];
      if (k >= l.max) continue;
      l.g.attributes.iPos.array.set([a.x, a.y, a.z, a.yaw], k * 4);
      l.g.attributes.iPose.array.set([a.pitch, a.bank, a.lift, a.dobra], k * 4);
      const sp = ESP[a.esp];
      l.g.attributes.iExtra.array.set([1, a.pernas, 0, 0], k * 4);
      cont[a.esp] = k + 1;
    }
    for (const n in lotes) {
      const l = lotes[n]; l.g.instanceCount = cont[n];
      l.g.attributes.iPos.needsUpdate = l.g.attributes.iPose.needsUpdate = l.g.attributes.iExtra.needsUpdate = true;
      l.m.visible = cont[n] > 0;
    }
  }

  // vitrine para conferir os corpos (só teste): ?aves=vitrine&vit=x,y,z — uma de cada, em pé e voando, paradas
  const qs = new URLSearchParams(location.search);
  const vitrine = qs.get('aves') === 'vitrine' ? (qs.get('vit') || '0,60,0').split(',').map(Number) : null;
  function montarVitrine() {
    if (aves.length && aves[0].vit) { for (const a of aves) if (a.lift !== undefined && a.est === 'voo') a.lift = Math.sin(t * 6) * 0.5 + 0.1; return; }
    aves = [];
    let i = 0;
    for (const esp of Object.keys(ESP)) {
      const x = vitrine[0] + i * 2.2, z = vitrine[2];
      aves.push({ ...nova(esp), vit: 1, est: 'pousada', x, y: chao(x, z) + pe(ESP[esp]), z, yaw: 1.57, dobra: 1, pernas: 1, lift: 0, pitch: 0, bank: 0 });
      aves.push({ ...nova(esp), vit: 1, est: 'voo', x, y: vitrine[1] + 1.4, z, yaw: 1.57, dobra: 0, pernas: 0, lift: 0.2, pitch: 0, bank: 0.2 });
      i++;
    }
  }
  game.hooks.frame.push((dt) => {
    const on = !!(game.gen && game.gen.arq && game.dim === 0);
    if (!on) { for (const n in lotes) lotes[n].m.visible = false; return; }
    if (genUsado !== game.gen) { genUsado = game.gen; povoar(); poleirosEm = -1; }
    const nObj = game.objects?.list?.size ?? 0;
    if (nObj !== poleirosEm) { poleirosEm = nObj; montarPoleiros(); }
    dt = Math.min(dt || 0.016, 0.1);
    t += dt;
    const pp = player?.pos || [0, 0, 0];
    if (vitrine) montarVitrine(); else passo(dt, pp);
    enviar();
  });
  game.aves = { lista: () => aves };
}
