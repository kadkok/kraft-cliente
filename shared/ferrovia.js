// Metros e segundos. O editor, o trem e o servidor usam a mesma linha central.
import { SEA, Y_MIN, Y_TOP } from './constants.js';

export const TREM = Object.freeze({
  carro: 10,
  entreCarros: 10.6,
  recuo: 11.2,
  parada: 18,
  aceleracao: 1.2,
  freio: 1.55,
  maxima: 82,
  maxPontos: 64,
  maxComprimento: 12000,
});
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const plano = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

export function problemaVia(pontos) {
  if (!Array.isArray(pontos) || pontos.length < 2 || pontos.length > TREM.maxPontos)
    return 'Marque de 2 a 64 pontos no mapa.';
  let total = 0;
  for (let i = 0; i < pontos.length; i++) {
    const p = pontos[i];
    if (
      !Array.isArray(p) ||
      p.length !== 3 ||
      !p.every(Number.isFinite) ||
      Math.max(Math.abs(p[0]), Math.abs(p[2])) > 30000 ||
      p[1] < Y_MIN + 4 ||
      p[1] > Y_TOP - 8
    )
      return 'Ponto fora dos limites da ferrovia.';
    if (!i) continue;
    const a = pontos[i - 1],
      d = plano(a, p);
    if (d < 8) return 'Deixe pelo menos 8 m entre os pontos.';
    if (Math.abs(p[1] - a[1]) > d * 0.12) return 'Rampa acima de 12%. Afaste os pontos ou aproxime as alturas.';
    if (i > 1) {
      const b = pontos[i - 2];
      const cos = ((a[0] - b[0]) * (p[0] - a[0]) + (a[2] - b[2]) * (p[2] - a[2])) / (plano(a, b) * d);
      if (cos < -0.75) return 'Curva muito fechada. Abra a curva com mais espaço.';
    }
    total += dist(a, p);
  }
  if (total < 40) return 'A linha precisa de 40 m para acomodar o trem e as duas plataformas.';
  if (total > TREM.maxComprimento) return 'Limite de 12 km por linha.';
  return '';
}

// Tangentes com o comprimento do vão atual, para um ponto distante não puxar um vão curto.
export function tracarVia(pontos) {
  const nos = [];
  let comprimento = 0;
  function add(p) {
    if (nos.length) comprimento += dist(nos[nos.length - 1].p, p);
    nos.push({ p, s: comprimento });
  }
  for (let i = 0; i < pontos.length - 1; i++) {
    const a = pontos[i],
      b = pontos[i + 1],
      antes = pontos[i - 1] || a,
      depois = pontos[i + 2] || b;
    const span = plano(a, b),
      na = span / (plano(antes, a) + span || 1),
      nb = span / (span + plano(b, depois) || 1);
    const passos = Math.max(1, Math.ceil(span / 2));
    if (!i) add(a);
    for (let j = 1; j <= passos; j++) {
      const t = j / passos,
        tt = t * t,
        h = tt * (3 - 2 * t);
      add(
        a.map(
          (v, k) =>
            v + (b[k] - v) * h + (b[k] - antes[k]) * na * t * (1 - t) * (1 - t) + (depois[k] - v) * nb * tt * (t - 1),
        ),
      );
    }
  }
  return { nos, comprimento };
}

function intervalo(lista, valor, campo) {
  let lo = 0,
    hi = lista.length - 1;
  while (hi - lo > 1) {
    const m = (hi + lo) >> 1;
    if (lista[m][campo] <= valor) lo = m;
    else hi = m;
  }
  return lo;
}
export function pontoVia(via, distancia) {
  const s = Math.max(0, Math.min(via.comprimento, distancia));
  const i = intervalo(via.nos, s, 's'),
    a = via.nos[i],
    b = via.nos[i + 1];
  const t = (s - a.s) / (b.s - a.s || 1);
  return a.p.map((v, k) => v + (b.p[k] - v) * t);
}
export function poseVia(via, s, eixo = 1) {
  const a = pontoVia(via, s - eixo),
    b = pontoVia(via, s + eixo),
    p = pontoVia(via, s);
  return { p, rumo: Math.atan2(b[0] - a[0], b[2] - a[2]), inclinacao: Math.atan2(b[1] - a[1], plano(a, b)) };
}
export function tipoVia(y, chao) {
  if (chao >= y + 2) return 'tunel';
  if (chao < SEA && y < SEA + 2) return 'vidro';
  if (y > chao + 2.5) return 'ponte';
  return 'solo';
}
export function horarioVia(via) {
  const ini = TREM.recuo,
    fim = via.comprimento - TREM.recuo;
  const am = [
    { s: ini },
    ...via.nos.filter((n) => n.s > ini + 0.1 && n.s < fim - 0.1).map((n) => ({ s: n.s })),
    { s: fim },
  ];
  for (const n of am) {
    const a = poseVia(via, n.s - 3).rumo,
      b = poseVia(via, n.s + 3).rumo;
    const angulo = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    n.v = Math.min(TREM.maxima, Math.sqrt((1.35 * 6) / Math.max(0.0001, angulo)));
  }
  am[0].v = 0;
  am[am.length - 1].v = 0;
  for (let i = 1; i < am.length; i++)
    am[i].v = Math.min(am[i].v, Math.sqrt(am[i - 1].v ** 2 + 2 * TREM.aceleracao * (am[i].s - am[i - 1].s)));
  for (let i = am.length - 2; i >= 0; i--)
    am[i].v = Math.min(am[i].v, Math.sqrt(am[i + 1].v ** 2 + 2 * TREM.freio * (am[i + 1].s - am[i].s)));
  am[0].t = 0;
  for (let i = 1; i < am.length; i++) am[i].t = am[i - 1].t + (2 * (am[i].s - am[i - 1].s)) / (am[i - 1].v + am[i].v);
  return { am, tempo: am[am.length - 1].t, ini, fim };
}
export function viagem(h, segundos) {
  const meia = TREM.parada + h.tempo,
    ciclo = 2 * meia;
  const fase = ((segundos % ciclo) + ciclo) % ciclo,
    volta = fase >= meia,
    t = fase % meia;
  if (t < TREM.parada)
    return { s: volta ? h.fim : h.ini, v: 0, estacao: volta ? 1 : 0, volta, espera: TREM.parada - t };
  const rel = volta ? h.tempo - (t - TREM.parada) : t - TREM.parada;
  const i = intervalo(h.am, rel, 't'),
    a = h.am[i],
    b = h.am[i + 1],
    dt = rel - a.t,
    acc = (b.v - a.v) / (b.t - a.t);
  return { s: a.s + a.v * dt + 0.5 * acc * dt * dt, v: a.v + acc * dt, estacao: -1, volta, espera: 0 };
}
