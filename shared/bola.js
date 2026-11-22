// LAVRA — bola de futebol: física pura (servidor manda; teste em tests/bola.test.js). Pedido do Kadmus, 17/11/2026:
// "coloque uma bola funcional em campo e placar de gol sempre que ela entrar na trave".
//
// A bola é uma caixa de lado 2r para a colisão com os blocos (mesma conta dos itens e dos bichos: rampas, escadas,
// traves e a rede de vidro valem), com gravidade de verdade, arrasto do ar, atrito de rolagem na grama e quique que
// perde força. Gol = a bola passou INTEIRA da linha de fundo, entre as traves e abaixo do travessão (regra do futebol).
import { boxSolid } from './surfaces.js';

export const BOLA = {
  r: 0.3,           // raio (m): a de verdade tem 0,11; num mundo de blocos de 1 m a 0,3 é a que se vê e se acerta
  g: 9.8,           // gravidade (m/s²)
  ar: 0.12,         // arrasto do ar (fração da velocidade por segundo)
  rola: 2.2,        // atrito de rolagem na grama (m/s²)
  quique: 0.55,     // quanto da velocidade sobra no quique (chão e paredes)
  magnus: 0.045,    // força lateral/vertical da rotação (efeito Magnus — curva real no ar)
  spinAr: 0.35,     // amortecimento da rotação no ar (por segundo)
  spinMax: 34,      // rotação máxima (rad/s)
  max: 32,          // velocidade máxima (m/s)
  passo: 1 / 60,    // passo da física (s)
};

const hit = (get, p, r) => boxSolid(get, p[0] - r, p[1] - r, p[2] - r, p[0] + r, p[1] + r, p[2] + r);

// um passo: b = { p: [x, y, z] (centro), v: [vx, vy, vz], w?: [wx, wy, wz] (spin rad/s), parada } — devolve true se tocou o chão
export function passoBola(b, get, dt = BOLA.passo) {
  if (!b || !b.p || !b.v) return false;
  const stepDt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : BOLA.passo;
  if (stepDt <= 0) return false;
  const { r } = BOLA, p = b.p, v = b.v, w = b.w;
  if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
    v[0] = v[1] = v[2] = 0;
    if (w) w[0] = w[1] = w[2] = 0;
    b.parada = true;
    return false;
  }
  const clampVel = () => {
    for (let i = 0; i < 3; i++) if (!Number.isFinite(v[i])) v[i] = 0;
    const s = Math.hypot(v[0], v[1], v[2]);
    if (!Number.isFinite(s)) { v[0] = v[1] = v[2] = 0; }
    else if (s > BOLA.max) { const f = BOLA.max / s; v[0] *= f; v[1] *= f; v[2] *= f; }
  };
  clampVel();
  if (w) {
    for (let i = 0; i < 3; i++) {
      w[i] = Number.isFinite(w[i]) ? Math.max(-BOLA.spinMax, Math.min(BOLA.spinMax, w[i])) : 0;
    }
  }
  if (hit(get, p, r)) { p[1] += 0.25; v[1] = Math.max(v[1], 0); return false; }       // nasceu dentro de bloco: sobe
  v[1] -= BOLA.g * stepDt;
  // Efeito Magnus real: a = magnus * (w × v) — curva lateral (wy) e mergulho/flutuação (wx/wz)
  if (w && (w[0] || w[1] || w[2])) {
    const mx = w[1] * v[2] - w[2] * v[1];
    const my = w[2] * v[0] - w[0] * v[2];
    const mz = w[0] * v[1] - w[1] * v[0];
    const mf = BOLA.magnus * stepDt;
    v[0] += mx * mf; v[1] += my * mf; v[2] += mz * mf;
    const sw = Math.exp(-BOLA.spinAr * stepDt);
    w[0] *= sw; w[1] *= sw; w[2] *= sw;
    if (Math.hypot(w[0], w[1], w[2]) < 0.08) { w[0] = w[1] = w[2] = 0; }
  }
  const k = Math.exp(-BOLA.ar * stepDt); v[0] *= k; v[1] *= k; v[2] *= k;
  clampVel();
  const quique = Number.isFinite(b.quique) ? Math.max(0.1, Math.min(0.95, b.quique)) : BOLA.quique;
  let chao = false;
  for (const a of [1, 0, 2]) {
    const d = v[a] * stepDt; if (!d) continue;
    p[a] += d;
    if (hit(get, p, r)) {
      p[a] -= d;
      const caiu = a === 1 && v[1] < 0;
      const imp = Math.abs(v[a]);
      if (caiu) chao = true;
      v[a] = -v[a] * quique;
      if (w) {
        if (caiu) {
          // efeito no quique da grama: velocidade da base = w × (0,-r,0) = (+wz*r, 0, -wx*r);
          // logo o atrito do gramado empurra no sentido oposto (-wz, 0, +wx): topspin acelera, backspin segura!
          const grip = Math.min(1, imp / 6 + 0.35) * 0.055;
          v[0] -= w[2] * grip; v[2] += w[0] * grip;
          w[0] *= 0.62; w[1] *= 0.72; w[2] *= 0.62;
        } else {
          w[0] *= 0.55; w[1] *= 0.55; w[2] *= 0.55;
        }
      }
      if (Math.abs(v[a]) < (a === 1 ? 1.2 : 0.3)) v[a] = 0;   // quique pequeno vira repouso naquele eixo
      clampVel();
    }
  }
  if (!chao) chao = hit(get, [p[0], p[1] - 0.03, p[2]], r);
  if (chao) {
    if (w && (w[0] || w[2])) {
      // tração residual de topspin/backspin no gramado ao rolar
      v[0] -= w[2] * 0.08 * stepDt;
      v[2] += w[0] * 0.08 * stepDt;
    }
    const h = Math.hypot(v[0], v[2]);
    if (h > 0) { const nh = Math.max(0, h - BOLA.rola * stepDt); v[0] *= nh / h; v[2] *= nh / h; }
    if (w) {
      const sw = Math.exp(-2.6 * stepDt);
      w[0] *= sw; w[1] *= sw; w[2] *= sw;
      if (Math.hypot(w[0], w[1], w[2]) < 0.08) { w[0] = w[1] = w[2] = 0; }
    }
    clampVel();
    const hf = Math.hypot(v[0], v[2]);
    if (hf < 0.05 && Math.abs(v[1]) < 0.05) { v[0] = v[1] = v[2] = 0; if (w) w[0] = w[1] = w[2] = 0; b.parada = true; }
  }
  return chao;
}

// campo: { eixo: 'x'|'z', linhaA, linhaB (coordenada das bordas EXTERNAS das linhas de fundo: A < B),
//          abre: [min, max] (no outro eixo, entre as traves), alto: [y0, y1] (chão até o travessão) }
// devolve 'A' (a bola entrou no gol do lado A: ponto para B), 'B', ou null
export function golDe(campo, p) {
  const { r } = BOLA, i = campo.eixo === 'x' ? 0 : 2, j = i === 0 ? 2 : 0;
  if (p[j] < campo.abre[0] || p[j] > campo.abre[1] || p[1] < campo.alto[0] || p[1] > campo.alto[1]) return null;
  if (p[i] < campo.linhaA - r) return 'A';
  if (p[i] > campo.linhaB + r) return 'B';
  return null;
}

// Saída da bola entre dois passos (ant → p), regra do futebol: a bola só sai quando passa INTEIRA da linha, e só é gol
// quando ATRAVESSA a linha de fundo vinda de dentro do campo, entre as traves e abaixo do travessão — bola que bate na
// rede por fora (atrás do gol) não atravessou a linha e não conta (18/11). Devolve null ou
//   { tipo: 'gol', lado: 'A'|'B' } · { tipo: 'lateral', ponto } · { tipo: 'fundo', lado: 'A'|'B', ponto } (fora do gol)
export function saidaDe(campo, ant, p) {
  const { r } = BOLA, i = campo.eixo === 'x' ? 0 : 2, j = i === 0 ? 2 : 0;
  const dentroJ = (q) => q[j] >= campo.ladoMin - r && q[j] <= campo.ladoMax + r;
  const naBoca = p[j] >= campo.abre[0] && p[j] <= campo.abre[1] && p[1] >= campo.alto[0] && p[1] <= campo.alto[1];
  for (const [lado, lim, fora] of [['A', campo.linhaA - r, (x) => x < campo.linhaA - r], ['B', campo.linhaB + r, (x) => x > campo.linhaB + r]]) {
    if (fora(p[i]) && !fora(ant[i]) && dentroJ(ant)) {
      if (naBoca) return { tipo: 'gol', lado };
      const ponto = [0, 0, 0]; ponto[i] = lim; ponto[j] = p[j]; ponto[1] = p[1];
      return { tipo: 'fundo', lado, ponto };
    }
  }
  const dentroI = (q) => q[i] >= campo.linhaA - r && q[i] <= campo.linhaB + r;
  if (!dentroJ(p) && dentroJ(ant) && dentroI(p)) {
    const ponto = p.slice(); ponto[j] = p[j] < campo.ladoMin ? campo.ladoMin : campo.ladoMax;
    return { tipo: 'lateral', ponto };
  }
  return null;
}

// completa um campo gravado antes das laterais existirem (meia largura 12, a do campo do Kadmus)
export function completarCampo(c, meiaLarg = 12) {
  if (c && c.ladoMin === undefined) { const o = Math.round((c.abre[0] + c.abre[1] - 1) / 2); c.ladoMin = o - meiaLarg; c.ladoMax = o + meiaLarg + 1; }
  return c;
}

// campo a partir dos números do gerador: centro (célula), topo do gramado, eixo longo, meio comprimento (do centro à
// célula da linha de fundo), largura e altura do gol (vão livre, em blocos)
export function montarCampo(cx, yTopo, cz, eixo, meio, largGol, altGol, meiaLarg = 12) {
  const c = eixo === 'x' ? cx : cz, o = eixo === 'x' ? cz : cx;
  const meia = (largGol - 1) / 2;
  return {
    eixo, centro: [cx + 0.5, yTopo + BOLA.r + 0.05, cz + 0.5],
    linhaA: c - meio, linhaB: c + meio + 1, ladoMin: o - meiaLarg, ladoMax: o + meiaLarg + 1,
    abre: [o - meia, o + meia + 1], alto: [yTopo, yTopo + altGol],
    lados: ['Azul', 'Vermelho'],   // time que defende o gol do lado A e o do lado B (as torcidas usam essas cores)
  };
}
