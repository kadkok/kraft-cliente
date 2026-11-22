// LAVRA — as balsas do arquipélago (pedido do Kadmus, 19/11/2026: "um cais em cada ilha e uma balsa com npc fazendo o
// trajeto todos os dias"). Lógica pura, igual no servidor e em todo aparelho.
//
// Uma linha por ilha temática, sempre entre o cais da ilha principal e o cais daquela ilha. A balsa é de duas pontas
// (como as balsas de travessia de verdade): encosta de ponta nos dois cais e nunca dá meia-volta — vai e volta pelo
// mesmo traçado. Cada linha tem a sua balsa e o seu balseiro.
//
// O horário é função do relógio DE VERDADE (segundos desde 1970), não da hora do mundo: o relógio do mundo pode estar
// parado ou acelerado por quem joga, e a balsa tem de passar do mesmo jeito. Por isso não há estado a gravar: a
// posição de cada balsa em qualquer instante sai de estadoBalsa(linha, agora). As linhas saem do cais principal uma
// depois da outra, em intervalos iguais (com 5 linhas e ciclo de 10 min, parte uma balsa a cada 2 min).
//
// Dado no mapa do mundo (tools/ilhas/criar.mjs): mapa.balsas = [{ id: <id da ilha>, pontos: [[x, z], ...] }], do ponto
// de atracação no cais principal ao ponto de atracação no cais da ilha (o primeiro e o último trecho são retos, no
// eixo de cada cais).
import { SEA } from './constants.js';

export const BALSA = {
  comp: 19, boca: 8,          // casco (m): comprimento e largura
  conves: SEA + 2,            // y do piso do convés (o mesmo do cais: quem embarca não sobe nem desce degrau)
  ciclo: 600,                 // s de uma ida e volta completa
  parada: 75,                 // s encostada em cada cais
  manobra: 16,                // s para ganhar e para perder velocidade
};
export const BALSEIROS = ['Tião', 'Zeca', 'Dona Nair', 'Bento', 'Seu Juca', 'Mané', 'Rosa', 'Chico'];
export const COR_LINHA_TEMA = Object.freeze({
  caribe: '#19b5c4', metropole: '#8a93a6', vulcao: '#c2452d', neve: '#dfe9f5', floresta: '#2f8f46', selvagem: '#16a34a',
});
export const BALSEIRO_TEMA = Object.freeze({
  caribe: 'Tião', metropole: 'Zeca', vulcao: 'Dona Nair', neve: 'Bento', floresta: 'Seu Juca', selvagem: 'Mané',
});

// ---- traçado: curva suave pelos pontos, amostrada a cada ~3 m, com o comprimento acumulado ------------------------
export function criarLinha(ficha, i, n, nomeDe = (id) => id) {
  const P = ficha.pontos;
  if (!Array.isArray(P) || P.length < 2) return null;
  const xs = [], zs = [], acum = [0];
  const pt = (k) => P[Math.max(0, Math.min(P.length - 1, k))];
  for (let k = 0; k < P.length - 1; k++) {
    const a = pt(k - 1), b = pt(k), c = pt(k + 1), d = pt(k + 2);
    const len = Math.hypot(c[0] - b[0], c[1] - b[1]), passos = Math.max(1, Math.ceil(len / 3));
    // o primeiro e o último trecho são retos (a balsa entra e sai no eixo do cais)
    const reto = k === 0 || k === P.length - 2;
    for (let j = 0; j < passos; j++) {
      const t = j / passos, t2 = t * t, t3 = t2 * t;
      if (reto) { xs.push(b[0] + (c[0] - b[0]) * t); zs.push(b[1] + (c[1] - b[1]) * t); continue; }
      // Catmull-Rom (tangentes limitadas ao tamanho do próprio trecho, para não fazer laço em trecho curto)
      const lim = (v, w) => { const l = Math.hypot(v, w), m = l > len ? len / l : 1; return [v * m, w * m]; };
      const [m1x, m1z] = lim((c[0] - a[0]) / 2, (c[1] - a[1]) / 2), [m2x, m2z] = lim((d[0] - b[0]) / 2, (d[1] - b[1]) / 2);
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      xs.push(h00 * b[0] + h10 * m1x + h01 * c[0] + h11 * m2x); zs.push(h00 * b[1] + h10 * m1z + h01 * c[1] + h11 * m2z);
    }
  }
  xs.push(P[P.length - 1][0]); zs.push(P[P.length - 1][1]);
  for (let k = 1; k < xs.length; k++) acum.push(acum[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]));
  const total = acum[acum.length - 1];
  return { id: ficha.id, i, nome: nomeDe(ficha.id), balseiro: BALSEIRO_TEMA[ficha.id] || BALSEIROS[i % BALSEIROS.length], xs, zs, acum, total, fase: (i * BALSA.ciclo) / Math.max(1, n) };
}
export function criarLinhas(mapa, nomeDe) {
  const l = Array.isArray(mapa?.balsas) ? mapa.balsas : [];
  return l.map((f, i) => criarLinha(f, i, l.length, nomeDe)).filter(Boolean);
}

// ponto do traçado a `d` metros do cais principal: { x, z, tx, tz } (posição e direção unitária, da principal à ilha)
export function pontoLinha(L, d, out = {}) {
  const A = L.acum; d = d <= 0 ? 0 : d >= L.total ? L.total : d;
  let a = 0, b = A.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (A[m] <= d) a = m; else b = m; }
  const seg = A[b] - A[a] || 1, f = (d - A[a]) / seg;
  out.x = L.xs[a] + (L.xs[b] - L.xs[a]) * f; out.z = L.zs[a] + (L.zs[b] - L.zs[a]) * f;
  // direção: média de uma janela curta (o casco não treme nas emendas da curva)
  const i0 = Math.max(0, a - 2), i1 = Math.min(A.length - 1, b + 2), dx = L.xs[i1] - L.xs[i0], dz = L.zs[i1] - L.zs[i0], l = Math.hypot(dx, dz) || 1;
  out.tx = dx / l; out.tz = dz / l;
  return out;
}

// fração do caminho andada depois de `t` segundos de uma travessia de `T` segundos (arranca e freia em `m` segundos)
export function avanco(t, T, m = BALSA.manobra) {
  if (t <= 0) return 0; if (t >= T) return 1;
  const v = 1 / (T - m);                        // velocidade de cruzeiro (fração por segundo)
  if (t < m) return 0.5 * v * t * t / m;
  if (t > T - m) { const r = T - t; return 1 - 0.5 * v * r * r / m; }
  return v * (t - m / 2);
}

// Estado de uma balsa no instante `agora` (segundos de verdade):
//   fase: 0 no cais principal · 1 indo para a ilha · 2 no cais da ilha · 3 voltando
//   falta: segundos até a fase mudar · d: metros do cais principal · v: velocidade com sinal (m/s; negativa voltando)
//   x, z, tx, tz: posição do centro do casco e a direção do traçado (o casco fica sempre nessa direção)
export function estadoBalsa(L, agora, out = {}) {
  const C = BALSA.ciclo, P = BALSA.parada, T = (C - 2 * P) / 2;
  let tau = (agora + L.fase) % C; if (tau < 0) tau += C;
  let fase, falta, f;
  if (tau < P) { fase = 0; falta = P - tau; f = 0; }
  else if (tau < P + T) { fase = 1; falta = P + T - tau; f = avanco(tau - P, T); }
  else if (tau < 2 * P + T) { fase = 2; falta = 2 * P + T - tau; f = 1; }
  else { fase = 3; falta = C - tau; f = 1 - avanco(tau - 2 * P - T, T); }
  out.fase = fase; out.falta = falta; out.d = f * L.total;
  // velocidade pela diferença de meio segundo (basta para o som, a esteira e o balanço)
  if (fase === 1 || fase === 3) {
    const t0 = fase === 1 ? tau - P : tau - 2 * P - T, e = 0.25;
    const df = (avanco(t0 + e, T) - avanco(t0 - e, T)) / (2 * e);
    out.v = (fase === 1 ? df : -df) * L.total;
  } else out.v = 0;
  pontoLinha(L, out.d, out);
  return out;
}

// próximas partidas de um cais: lado 0 = cais principal (todas as linhas), lado 1 = cais da ilha `id` (só a dela).
// Devolve [{ linha, emSegundos, noCais }] em ordem; noCais = a balsa está encostada agora (parte em emSegundos).
export function partidas(linhas, agora, lado, id = null) {
  const C = BALSA.ciclo, P = BALSA.parada, T = (C - 2 * P) / 2, out = [];
  for (const L of linhas) {
    if (lado === 1 && L.id !== id) continue;
    let tau = (agora + L.fase) % C; if (tau < 0) tau += C;
    const sai = lado === 0 ? P : 2 * P + T, chega = lado === 0 ? 0 : P + T;      // instante do ciclo em que parte/encosta
    const noCais = tau >= chega && tau < sai;
    const em = ((sai - tau) % C + C) % C;
    out.push({ linha: L, emSegundos: em, noCais, chegaEm: noCais ? 0 : ((chega - tau) % C + C) % C });
  }
  return out.sort((a, b) => a.emSegundos - b.emSegundos);
}
