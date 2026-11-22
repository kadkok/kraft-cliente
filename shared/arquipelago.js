// LAVRA — mapa de arquipélago (pedido do Kadmus, 19/11/2026): o mundo jogável passa a ser só a ilha do campo de
// futebol e as obras em volta; todo o resto vira um oceano enorme, e a costa do que fica ganha uma praia larga.
//
// Liga só para o mundo que tem `mapa` no world.json (o servidor manda em `gen.mapa`, junto da semente). Mundo sem o
// campo não muda nada: o gerador segue idêntico ao de antes, bloco a bloco (invariante "Terreno é função do código").
//
// Contrato do `mapa` (dado puro, gravado no mundo; quem converte é tools/litoral/converter.mjs):
//   { tipo: 'ilhas', v: 1,
//     caixa:    [x0, z0, x1, z1]      região calculada (fora dela tudo é oceano fundo)
//     passo:    4                     metros por ponto da grade
//     manter:   [[x, z, rx, rz], ...] pedaços de terra (suavizados) que contêm estes pontos ficam, cortados na elipse
//                                     de raios rx, rz em volta do ponto (separa a ilha de um continente encostado)
//     proteger: [[x, z, r], ...]      círculos onde o terreno original não muda nunca (obras de quem joga); a borda
//                                     de cada um esmaece em `PROT_BORDA` metros. Círculo com o centro em terra
//                                     também entra no que fica (vira ilhota com praia); submerso, só guarda o fundo
//     ilhas:    [{ id, nome, tema, x, z, r, semente, cais }, ...]   v: 2 — ilhas temáticas longe da principal
//                                     (shared/ilhas.js): cada uma responde pela sua caixa, com relevo, clima e
//                                     vegetação do tema; a região acima (a ilha principal) não muda um bloco
//     cais:     [[x, z, dir, L], ...]  cais da balsa na ilha principal (shared/cais.js); o de cada ilha temática vai
//                                     na ficha dela. São blocos do gerador, só dentro da caixa de cada cais
//     fossas:   [[cx, cz, rx, rz, fundo, talude], ...]   (opcional; 22/11/2026) fossas abissais: elipse de centro
//                                     (cx, cz) e semi-eixos rx (leste–oeste) e rz (norte–sul), em metros; `fundo` =
//                                     altura do piso relativa ao mar (−110…−40); `talude` = largura da parede em
//                                     metros (8…120), contada para DENTRO da elipse. Vale também fora da `caixa`.
//                                     Quem grava num mundo salvo é tools/fossa/criar.mjs. Ver "Fossas abissais" abaixo
//   }
//
// Saída para o gerador (worldgen.js):
//   rel(x, z)   altura relativa ao mar, já com praia/oceano (no lugar de heightRel)
//   s(x, z)     distância com sinal até a costa do que ficou (m; negativo = terra adentro, positivo = mar)
//   p(x, z)     0..1, quanto o ponto está protegido (1 = terreno original intocado)
//   ilhaEm(x, z) a ilha temática que responde por aquele ponto (ou null) · ilhas: todas, na ordem do mapa
//   portos       [{ id, nome, cais }]: o cais da ilha principal e o de cada ilha temática
//   obras(x0, z0, set, alt)   carimba no pedaço as obras do próprio mundo (cais; cidade da metrópole), ou null
//   semArvore(x, z)           ali não nasce árvore (em cima de uma obra do mundo)
//   relSemFossa(x, z), afundar(x, z, h), fossas, distFossas(x, z), fossaPerto(...)   ver "Fossas abissais"
//
// Determinismo: só + − × ÷, floor, sqrt, min/max (nada de sin/cos/pow). A grade é calculada uma vez por gerador, a
// partir da altura original, em Float32Array (arredondamento IEEE, igual em todo aparelho e no servidor).

import { criarIlha, fichaValida } from './ilhas.js';
import { caisValido, caisCaixa, carimbaCais } from './cais.js';

export const PRAIA = 40;          // largura da faixa de terra que vira praia (m)
export const PROT_BORDA = 14;     // esmaecimento da proteção em volta de cada círculo (m)
const FUNDO = -38;                // fundo do oceano aberto, relativo ao mar (m)
const LONGE = 1e6;

const sstep = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };

export function mapaValido(m) {
  return !!(m && m.tipo === 'ilhas' && Array.isArray(m.caixa) && m.caixa.length === 4 && m.caixa.every(Number.isFinite)
    && m.caixa[2] > m.caixa[0] && m.caixa[3] > m.caixa[1] && Array.isArray(m.manter));
}

// ---- Fossas abissais (pedido do Kadmus, 22/11/2026: um naufrágio "enorme e muito profundo") -------------------------
// O oceano do arquipélago tem 38 m; abrir um abismo com blocos editados custaria mais de um milhão de edições gravadas.
// A fossa é DADO do mapa: servidor e aparelhos montam o mesmo buraco com o mesmo código.
//   · fora da elipse `rel` sai idêntico, bit a bit, ao de antes; mapa sem `fossas` não muda um bloco;
//   · dentro, além do talude: piso em `fundo`, com ondulação suave de sedimento (±1,35 m);
//   · na faixa do talude: escarpa de rocha em patamares (o começo da queda serpenteia, os patamares sobem e descem,
//     há contrafortes e rugosidade: tudo pelo ruído que o gerador entrega);
//   · trava: só afunda onde o fundo de hoje já é mar aberto fundo (abaixo de FOSSA.mar; efeito inteiro abaixo de
//     FOSSA.marCheio) e onde a proteção p(x, z) é 0. Nunca corta ilha, praia, plataforma rasa nem obra, e nunca sobe o chão;
//   · entrada inválida é ignorada (fossaValida), e só as primeiras FOSSA.max contam.
// A parede é medida pela família de elipses (rx − m, rz − m): m = quantos metros para dentro o ponto está (achado por
// bisseção, só + − × e comparações). Com rx 260, rz 100 e talude 40 a largura real da parede fica entre 34,5 e 40 m.
export const FOSSA = Object.freeze({
  max: 16,                          // fossas por mapa
  raioMin: 20, fundoMin: -110, fundoMax: -40, taludeMin: 8, taludeMax: 120,
  mar: -30, marCheio: -34,          // trava do mar aberto fundo (altura relativa de hoje)
  folgaRio: 22, esmaeceRio: 10,     // worldgen: nenhum rio subterrâneo a menos de `folgaRio` m da elipse (22 m = nenhum
                                    // no pedaço de 16 × 16 que toca a fossa); dali o rio volta em `esmaeceRio` m
});
export const FOSSA_ALCANCE = FOSSA.folgaRio + FOSSA.esmaeceRio;   // além disto (por distFossa) a fossa não muda NADA (32 m)
export function fossaValida(f) {
  if (!Array.isArray(f) || f.length < 6) return false;
  for (let i = 0; i < 6; i++) if (typeof f[i] !== 'number' || !Number.isFinite(f[i])) return false;
  return f[2] >= FOSSA.raioMin && f[3] >= FOSSA.raioMin && f[4] >= FOSSA.fundoMin && f[4] <= FOSSA.fundoMax
    && f[5] >= FOSSA.taludeMin && f[5] <= FOSSA.taludeMax;
}
// as fossas válidas de um mapa, já com o que se calcula uma vez só
export function fossasDe(mapa) {
  const out = [];
  if (!mapa || !Array.isArray(mapa.fossas)) return out;
  for (const f of mapa.fossas) {
    if (out.length >= FOSSA.max) break;
    if (!fossaValida(f)) continue;
    const [cx, cz, rx, rz, fundo, talude] = f;
    const rmin = Math.min(rx, rz), longe = 1 + FOSSA_ALCANCE / rmin;
    out.push(Object.freeze({
      cx, cz, rx, rz, fundo, talude, rmin,
      mMax: Math.min(talude, rmin - 0.5),                                   // até onde a parede entra (a elipse de dentro não degenera)
      patamares: Math.max(1, Math.min(6, Math.floor((FUNDO - fundo) / 15 + 0.5))),
      q2Longe: longe * longe,                                               // (dx/rx)² + (dz/rz)² acima disto: fora do alcance
      hDiag: Math.sqrt((rx * rx + rz * rz) / 2),                            // até onde a elipse vai na diagonal (função de suporte a 45°)
    }));
  }
  return out;
}
// Distância do ponto até a elipse da fossa, estimada POR BAIXO: nunca passa da distância de verdade (é o que faz o
// alcance valer: quem está a menos de N m de verdade está sempre a menos de N m por aqui). ≤ 0 dentro. É a maior de
// três contas que, cada uma, fica aquém da distância real:
//   · 1ª ordem: (F − 1) ÷ |∇F|, com F = raio normalizado (F é convexa); exata sobre os eixos, justa perto da borda;
//   · distância até a caixa da elipse, e até a reta que encosta nela a 45°: seguram a conta além das pontas de uma
//     elipse muito comprida, onde a 1ª ordem sozinha erraria por muito.
// Medido: com rx 260 e rz 100, onde ela dá 22 m a distância real vai de 22 a 23,4 m, e onde dá 32 m, de 32 a 34,6 m;
// numa elipse de 500 × 20, de 22 a 28,8 m e de 32 a 41,5 m.
export function distFossa(f, x, z) {
  const dx = x - f.cx, dz = z - f.cz, u = dx / f.rx, v = dz / f.rz, q2 = u * u + v * v;
  if (q2 <= 1) return (Math.sqrt(q2) - 1) * f.rmin;
  const F = Math.sqrt(q2), G = Math.sqrt(u * u / (f.rx * f.rx) + v * v / (f.rz * f.rz));
  const ax = Math.abs(dx), az = Math.abs(dz), bx = Math.max(ax - f.rx, 0), bz = Math.max(az - f.rz, 0);
  return Math.max((F - 1) * F / G, Math.sqrt(bx * bx + bz * bz), (ax + az) * 0.7071067811865476 - f.hDiag);
}

// baseRel(x, z): altura relativa original do gerador. ruido(x, z): ruído suave em −1..1 (o simplex do próprio gerador).
// semente: a do mundo (as ilhas temáticas tiram dela, e da própria ficha, o seu ruído).
export function createArquipelago(baseRel, mapa, ruido, semente = 0) {
  const passo = Math.max(2, mapa.passo | 0 || 4);
  const [bx0, bz0, bx1, bz1] = mapa.caixa;
  const NX = Math.floor((bx1 - bx0) / passo) + 1, NZ = Math.floor((bz1 - bz0) / passo) + 1, N = NX * NZ;
  const at = (i, j) => i + j * NX;

  // 1) terra original, suavizada (a costa natural é cheia de recortes de um bloco; a praia pede um contorno largo)
  const A = new Float32Array(N), T = new Float32Array(N);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) A[at(i, j)] = baseRel(bx0 + i * passo, bz0 + j * passo) > 0.3 ? 1 : 0;
  const R = 3;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) { const ii = i + k; if (ii >= 0 && ii < NX) { s += A[at(ii, j)]; n++; } }
      T[at(i, j)] = s / n;
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) { const jj = j + k; if (jj >= 0 && jj < NZ) { s += T[at(i, jj)]; n++; } }
      A[at(i, j)] = s / n;
    }
  }

  // 2) pedaços de terra que ficam: os que contêm (ou estão a até 60 m de) um ponto de `manter`
  const keep = new Uint8Array(N), seen = new Uint8Array(N), fila = new Int32Array(N);
  const land = (k) => A[k] > 0.5;
  for (const [mx, mz, rx = 1e5, rz = 1e5] of mapa.manter) {
    const ok = (k) => { const i = k % NX, j = (k - i) / NX, dx = (bx0 + i * passo - mx) / rx, dz = (bz0 + j * passo - mz) / rz; return dx * dx + dz * dz <= 1; };
    const ci = Math.round((mx - bx0) / passo), cj = Math.round((mz - bz0) / passo);
    let best = -1, bd = 1e9;
    const rr = Math.ceil(60 / passo);
    for (let j = cj - rr; j <= cj + rr; j++) for (let i = ci - rr; i <= ci + rr; i++) {
      if (i < 0 || j < 0 || i >= NX || j >= NZ || !land(at(i, j))) continue;
      const d = (i - ci) * (i - ci) + (j - cj) * (j - cj);
      if (d < bd) { bd = d; best = at(i, j); }
    }
    if (best < 0 || seen[best] || !ok(best)) continue;
    let h = 0, t = 0; fila[t++] = best; seen[best] = 1;
    while (h < t) {
      const k = fila[h++]; keep[k] = 1;
      const i = k % NX, j = (k - i) / NX;
      if (i > 0 && !seen[k - 1] && land(k - 1) && ok(k - 1)) { seen[k - 1] = 1; fila[t++] = k - 1; }
      if (i < NX - 1 && !seen[k + 1] && land(k + 1) && ok(k + 1)) { seen[k + 1] = 1; fila[t++] = k + 1; }
      if (j > 0 && !seen[k - NX] && land(k - NX) && ok(k - NX)) { seen[k - NX] = 1; fila[t++] = k - NX; }
      if (j < NZ - 1 && !seen[k + NX] && land(k + NX) && ok(k + NX)) { seen[k + NX] = 1; fila[t++] = k + NX; }
    }
  }

  // 3) proteção das obras: círculo inteiro = terreno original; a borda esmaece
  const P = new Float32Array(N);
  for (const c of mapa.proteger || []) {
    const [cx, cz, r] = c;
    const ext = r + PROT_BORDA;
    const emTerra = baseRel(cx, cz) > 0;     // obra submersa protege o fundo, mas não vira "terra que fica" (sem praia em volta)
    const i0 = Math.max(0, Math.floor((cx - ext - bx0) / passo)), i1 = Math.min(NX - 1, Math.ceil((cx + ext - bx0) / passo));
    const j0 = Math.max(0, Math.floor((cz - ext - bz0) / passo)), j1 = Math.min(NZ - 1, Math.ceil((cz + ext - bz0) / passo));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = bx0 + i * passo - cx, dz = bz0 + j * passo - cz;
      const d = Math.sqrt(dx * dx + dz * dz);
      const v = d <= r ? 1 : d >= ext ? 0 : 1 - (d - r) / PROT_BORDA;
      const k = at(i, j);
      if (v > P[k]) P[k] = v;
      if (d <= r && emTerra) keep[k] = 1;   // o que é obra em terra fica, mesmo fora dos pedaços escolhidos
    }
  }

  // 4) distância com sinal até a borda do que fica (chanfro de dois passes; pesos 1 e √2, em pontos da grade)
  const DO = new Float32Array(N), DI = new Float32Array(N);
  for (let k = 0; k < N; k++) { DO[k] = keep[k] ? 0 : LONGE; DI[k] = keep[k] ? LONGE : 0; }
  const D2 = 1.4142135;
  const chanfro = (D) => {
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = at(i, j); let v = D[k];
      if (i > 0) v = Math.min(v, D[k - 1] + 1);
      if (j > 0) { v = Math.min(v, D[k - NX] + 1); if (i > 0) v = Math.min(v, D[k - NX - 1] + D2); if (i < NX - 1) v = Math.min(v, D[k - NX + 1] + D2); }
      D[k] = v;
    }
    for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
      const k = at(i, j); let v = D[k];
      if (i < NX - 1) v = Math.min(v, D[k + 1] + 1);
      if (j < NZ - 1) { v = Math.min(v, D[k + NX] + 1); if (i < NX - 1) v = Math.min(v, D[k + NX + 1] + D2); if (i > 0) v = Math.min(v, D[k + NX - 1] + D2); }
      D[k] = v;
    }
  };
  chanfro(DO); chanfro(DI);
  const S = new Float32Array(N);
  for (let k = 0; k < N; k++) S[k] = keep[k] ? -(DI[k] - 0.5) * passo : (DO[k] - 0.5) * passo;

  // amostragem bilinear (fora da caixa: mar aberto, sem proteção)
  function bil(G, x, z, fora) {
    const fx = (x - bx0) / passo, fz = (z - bz0) / passo;
    if (fx < 0 || fz < 0 || fx > NX - 1 || fz > NZ - 1) return fora;
    const i = Math.min(NX - 2, Math.floor(fx)), j = Math.min(NZ - 2, Math.floor(fz));
    const u = fx - i, v = fz - j, k = at(i, j);
    return (G[k] * (1 - u) + G[k + 1] * u) * (1 - v) + (G[k + NX] * (1 - u) + G[k + NX + 1] * u) * v;
  }
  const s = (x, z) => bil(S, x, z, LONGE);
  const p = (x, z) => bil(P, x, z, 0);

  // perfil do fundo do mar pela distância à costa: plataforma rasa e clara (água turquesa), talude, oceano aberto
  function fundo(d, x, z) {
    const n = ruido(x, z);
    if (d <= 34) return -d * 0.09 + n * 0.35;                          // até ~3 m: areia rasa
    const t = sstep(34, 150, d);
    return -3.06 + (FUNDO + 3.06) * t + n * (0.6 + 2.4 * t);
  }

  function relSemFossa(x, z) {
    const d = s(x, z);
    if (d < -PRAIA) return baseRel(x, z);                              // miolo da ilha: exatamente o original
    const pr = p(x, z);
    if (pr >= 1) return baseRel(x, z);                                 // obra de quem joga: intocado
    let alvo, w;
    if (d <= 0) { alvo = 0.7 + -d * 0.05 + ruido(x * 0.5, z * 0.5) * 0.25; w = sstep(-PRAIA, -PRAIA * 0.35, d); }
    else { alvo = fundo(d, x, z); w = 1; }
    w *= 1 - pr;
    if (w >= 1) return alvo;
    const h0 = baseRel(x, z);
    return h0 + (alvo - h0) * w;
  }

  // ---- fossas abissais (ver o cabeçalho "Fossas abissais") ----------------------------------------------------------
  const FO = fossasDe(mapa), NF = FO.length;
  // o ponto (dx, dz), relativo ao centro, está dentro da elipse encolhida em m metros? (sem divisão: m < rmin)
  const dentroDe = (f, dx, dz, m) => { const a = f.rx - m, b = f.rz - m; return dx * dx * b * b + dz * dz * a * a <= a * a * b * b; };
  // altura-alvo da fossa f num ponto de DENTRO da elipse, partindo do fundo de hoje h (devolve ≤ h quando afunda)
  function perfil(f, x, z, dx, dz, h) {
    let lo = 0, hi = f.mMax;                                                 // quantos metros para dentro da borda
    if (dentroDe(f, dx, dz, hi)) lo = hi;
    else for (let i = 0; i < 14; i++) { const m = (lo + hi) * 0.5; if (dentroDe(f, dx, dz, m)) lo = m; else hi = m; }
    const tau = lo / f.talude;                                               // 0 na borda … 1 no fim da parede
    let ini = 0;
    if (tau < 1) {
      ini = 0.3 * (0.5 + 0.5 * ruido(x * 0.45 + 31.7, z * 0.45 - 12.9));     // a queda começa de 0 a 30 % talude adentro
      if (tau <= ini) return h;
    }
    // piso: sedimento com ondulação suave (±1,35 m; ondas de ~160 m e de ~45 m)
    const piso = f.fundo + ruido(x * 0.3 + 5.5, z * 0.3 - 9.1) + 0.35 * ruido(x * 1.1 - 2.2, z * 1.1 + 6.6);
    const queda = h - piso;                                                  // quanto há para descer aqui
    if (queda <= 0) return h;
    if (tau >= 1) return piso;                                               // além do talude
    let t = (tau - ini) / (1 - ini);
    t += 0.8 * ruido(x * 1.05 + 77.7, z * 1.05 - 55.5) * t * (1 - t);        // contrafortes e reentrâncias (~45 m)
    const w0 = 1 - (1 - t) * (1 - t);                                        // escarpa: íngreme no alto, talude ao pé
    const u = w0 * f.patamares + 1.4 * w0 * (1 - w0) * ruido(x * 1.9 - 7.3, z * 1.9 + 44.1);   // patamares que sobem e descem
    const k = Math.floor(u);
    let w = w0 + ((k + sstep(0.3, 0.7, u - k)) / f.patamares - w0) * 0.65;
    w = w < 0 ? 0 : w > 1 ? 1 : w;
    // rugosidade da rocha (~9 m de onda, até ±1,6 m; some na borda, no pé da parede e em fossa rasa)
    const rug = Math.min(1.6, queda * 0.04) * ruido(x * 5.3 + 3.1, z * 5.3 + 8.8) * sstep(0, 0.2, w) * (1 - sstep(0.85, 1, w));
    return h - queda * w + rug;
  }
  // Aplica as fossas ao fundo de hoje h = relSemFossa(x, z). Devolve o próprio h (o MESMO número) onde nada muda.
  function afundar(x, z, h) {
    let r = h, g = -1;
    for (let i = 0; i < NF; i++) {
      const f = FO[i], dx = x - f.cx, dz = z - f.cz;
      if (dx >= f.rx || dx <= -f.rx || dz >= f.rz || dz <= -f.rz) continue;
      const u = dx / f.rx, v = dz / f.rz;
      if (u * u + v * v >= 1) continue;                                      // fora da elipse: idêntico
      if (g < 0) g = p(x, z) > 0 ? 0 : sstep(-FOSSA.mar, -FOSSA.marCheio, -h);   // trava: mar aberto fundo e sem proteção
      if (g <= 0) return h;
      const alvo = perfil(f, x, z, dx, dz, h);
      const c = h + (alvo - h) * g;
      if (c < r) r = c;                                                      // só afunda; com duas fossas vale a mais funda
    }
    return r;
  }
  const rel = NF ? (x, z) => afundar(x, z, relSemFossa(x, z)) : relSemFossa;
  // menor distância (estimada por baixo, distFossa) do ponto até uma fossa; além do alcance devolve LONGE
  function distFossas(x, z) {
    let d = LONGE;
    for (let i = 0; i < NF; i++) {
      const f = FO[i], u = (x - f.cx) / f.rx, v = (z - f.cz) / f.rz;
      if (u * u + v * v >= f.q2Longe) continue;                              // (F − 1)·rmin ≥ alcance: longe demais
      const e = distFossa(f, x, z);
      if (e < d) d = e;
    }
    return d;
  }
  // alguma fossa encosta no retângulo (x0…x1, z0…z1)? (pela caixa da elipse; é só um filtro barato por pedaço)
  function fossaPerto(x0, z0, x1, z1) {
    for (let i = 0; i < NF; i++) { const f = FO[i]; if (x1 > f.cx - f.rx && x0 < f.cx + f.rx && z1 > f.cz - f.rz && z0 < f.cz + f.rz) return true; }
    return false;
  }

  // ilhas temáticas (v: 2): cada uma responde dentro da própria caixa. Ficha inválida, ou caixa que encosta na região
  // da ilha principal ou na de outra ilha, é ignorada (a ilha principal nunca perde um bloco por causa de uma ficha).
  const ilhas = [];
  for (const f of Array.isArray(mapa.ilhas) ? mapa.ilhas : []) {
    if (!fichaValida(f)) continue;
    const il = criarIlha(f, semente, ruido), c = il.caixa;
    const toca = (o) => c[0] <= o[2] && c[2] >= o[0] && c[1] <= o[3] && c[3] >= o[1];
    if (toca([bx0, bz0, bx1, bz1]) || ilhas.some((o) => toca(o.caixa))) continue;
    ilhas.push(il);
  }
  // obras do próprio mundo: os cais (o da ilha principal vem em mapa.cais) e o que cada ilha traz (cidade)
  const portos = [];
  for (const c of Array.isArray(mapa.cais) ? mapa.cais : []) if (caisValido(c)) portos.push({ id: 'principal', nome: mapa.nome || 'Ilha Principal', tema: null, cais: c, caixa: caisCaixa(c) });
  for (const il of ilhas) if (caisValido(il.ficha.cais)) portos.push({ id: il.id, nome: il.nome, tema: il.ficha.tema, cais: il.ficha.cais, caixa: caisCaixa(il.ficha.cais) });
  const comObra = ilhas.filter((il) => il.obras);
  const obras = portos.length || comObra.length ? (x0, z0, set, alt) => {
    for (const q of portos) carimbaCais(q.cais, x0, z0, set, alt, q.tema);
    for (const il of comObra) { const c = il.caixa; if (x0 + 15 >= c[0] && x0 <= c[2] && z0 + 15 >= c[1] && z0 <= c[3]) il.obras(x0, z0, set, alt); }
  } : null;
  const semArvore = (x, z) => {
    for (const q of portos) { const c = q.caixa; if (x >= c[0] - 2 && x <= c[2] + 2 && z >= c[1] - 2 && z <= c[3] + 2) return true; }
    return false;
  };
  const base = { rel, relSemFossa, afundar, fossas: FO, distFossas, fossaPerto, s, p, caixa: [bx0, bz0, bx1, bz1], passo, NX, NZ, ilhas, ilhaEm: () => null, portos, obras, semArvore, mapa };
  if (!ilhas.length) return base;
  const ilhaEm = (x, z) => {
    for (let k = 0; k < ilhas.length; k++) { const c = ilhas[k].caixa; if (x >= c[0] && x <= c[2] && z >= c[1] && z <= c[3]) return ilhas[k]; }
    return null;
  };
  return {
    ...base, ilhaEm,
    rel: (x, z) => { const il = ilhaEm(x, z); return il ? il.rel(x, z) : rel(x, z); },
    s: (x, z) => { const il = ilhaEm(x, z); return il ? il.s(x, z) : s(x, z); },
    p: (x, z) => (ilhaEm(x, z) ? 0 : p(x, z)),
    // dentro de uma ilha temática vale o relevo dela e a fossa não age (worldgen.height pede relSemFossa + afundar
    // quando o mapa tem fossas: sem isto as ilhas sairiam com o relevo do mar de antes). Fora delas, a conta da fossa.
    relSemFossa: (x, z) => { const il = ilhaEm(x, z); return il ? il.rel(x, z) : relSemFossa(x, z); },
    afundar: (x, z, h) => (ilhaEm(x, z) ? h : afundar(x, z, h)),
  };
}
