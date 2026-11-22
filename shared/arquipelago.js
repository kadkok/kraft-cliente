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

  function rel(x, z) {
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
  const base = { rel, s, p, caixa: [bx0, bz0, bx1, bz1], passo, NX, NZ, ilhas, ilhaEm: () => null, portos, obras, semArvore, mapa };
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
  };
}
