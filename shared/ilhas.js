// LAVRA — ilhas temáticas do arquipélago (pedido do Kadmus, 19/11/2026: "a ilha ficou pequena demais… podemos ter
// novas ilhas no jogo através do longínquo mar"; "uma ilha floresta densa… a ilha com vulcão… a ilha montanhosa com
// grandes montanhas nevadas e muitos pinheiros… uma ilha caribe, totalmente temática de praia e paradisíaca… a ilha
// metrópole, com prédios, ruas e um grande estádio de futebol").
//
// Cada ilha é uma função fechada da sua ficha (dado puro, gravado em `mapa.ilhas` do mundo; shared/arquipelago.js
// entrega cada ponto do mundo à ilha cuja caixa o contém):
//   { id, nome, tema: 'floresta' | 'vulcao' | 'neve' | 'caribe' | 'metropole' | 'selvagem', x, z, r, semente,
//     cais: [x, z, dx, dz] }      // onde o cais sai da areia e para onde aponta (quem escolhe é tools/ilhas/criar.mjs)
// A ilha NÃO vem do relevo antigo do mundo: tem forma, relevo, clima e vegetação próprios do tema. Fora da caixa de
// todas as ilhas o mar é o de sempre, e a ilha principal (região 0 do mapa) não muda um bloco.
//
// O que a ilha entrega ao gerador (worldgen.js):
//   caixa                região [x0, z0, x1, z1] em que ela responde (com folga para a plataforma e o talude)
//   s(x, z)              distância com sinal até a costa (m; negativo = terra adentro), como arquipelago.s
//   rel(x, z)            altura relativa ao mar (praia, relevo do tema, lagoas abaixo de zero, fundo do mar)
//   clima(x, z)          peso 0..1 do clima do tema ali; a temperatura e a umidade ficam em .T e .M
//   topo(...)            bloco da superfície quando o tema muda a regra geral (cinza e basalto no vulcão, cascalho
//                        na praia fria, areia no miolo do caribe)
//   arvore(...)          o tema ajusta a árvore sorteada (mata fechada, coqueiral, cone pelado do vulcão)
//   lava(x, z)           nível (y) do lago de lava naquele ponto, ou 0
//   agua(x, z)           nível (y) de lagoa alta / cachoeira acima do mar, ou 0 (selvagem)
//   planta(...)          ajuste de vegetação rasteira do tema (opcional)
//   obras(...), semPlanta(x, z)   (metrópole) a cidade carimbada no pedaço e onde não nasce planta rasteira
//
// Determinismo: só + − × ÷, floor, sqrt, abs, min/max (nada de sin/cos/pow), como noise.js. A grade de distância à
// costa é feita uma vez, na primeira consulta dentro da caixa (aparelho longe de uma ilha nunca paga por ela).
import { createSimplex, hash3, clamp, lerp } from './noise.js';
import { B } from './blocks.js';
import { criarCidade } from './cidade.js';

export const T_FLORESTA = 1, T_VULCAO = 2, T_NEVE = 3, T_CARIBE = 4, T_METROPOLE = 5, T_SELVAGEM = 6;
export const PRAIA_ILHA = 40;     // a mesma faixa de praia da ilha principal (arquipelago.js → PRAIA)
const PASSO = 4, LONGE = 1e6, FUNDO = -38;
const D8 = [[1, 0], [0.70710678, 0.70710678], [0, 1], [-0.70710678, 0.70710678], [-1, 0], [-0.70710678, -0.70710678], [0, -1], [0.70710678, -0.70710678]];

// borda: recorte da costa em três escalas (fração do raio) · raso/talude: até onde vai a plataforma clara e onde o
// fundo chega ao oceano aberto (m da costa) · alc: até onde pode haver terra (× raio) · T, M: clima do tema
export const TEMAS = {
  floresta: { id: T_FLORESTA, nome: 'floresta densa', T: 0.50, M: 0.92, borda: [0.22, 0.11, 0.05], raso: 34, talude: 150, alc: 1.42 },
  vulcao: { id: T_VULCAO, nome: 'vulcão', T: 0.60, M: 0.78, borda: [0.13, 0.07, 0.035], raso: 26, talude: 130, alc: 1.3 },
  neve: { id: T_NEVE, nome: 'montanhas nevadas', T: 0.26, M: 0.74, borda: [0.20, 0.12, 0.06], raso: 30, talude: 140, alc: 1.42, ex: 1.2, ez: 0.86 },
  caribe: { id: T_CARIBE, nome: 'caribe', T: 0.70, M: 0.62, borda: [0.16, 0.09, 0.04], raso: 120, talude: 260, alc: 1.62 },
  metropole: { id: T_METROPOLE, nome: 'metrópole', T: 0.52, M: 0.52, borda: [0.10, 0.05, 0.02], raso: 34, talude: 150, alc: 1.2 },
  selvagem: { id: T_SELVAGEM, nome: 'selvagem', T: 0.78, M: 0.96, borda: [0.23, 0.13, 0.06], raso: 30, talude: 145, alc: 1.48 },
};

const sstep = (a, b, x) => { const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
function fbm(n, x, z, oct) {
  let a = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * n(x, z); norm += a; x = x * 2.03 + 31.7; z = z * 2.03 - 17.3; a *= 0.5; }
  return s / norm;
}
function ridged(n, x, z, oct) {
  let a = 1, s = 0, norm = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(n(x, z)); v *= v;
    s += a * v * w; norm += a; w = clamp(v * 1.5, 0, 1);
    x = x * 2.07 + 13.1; z = z * 2.07 + 41.9; a *= 0.5;
  }
  return s / norm;
}
// distância de (px, pz) ao segmento (ax, az)–(bx, bz)
function distSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
  const dx = px - ax - vx * t, dz = pz - az - vz * t;
  return Math.sqrt(dx * dx + dz * dz);
}

export function fichaValida(f) {
  return !!(f && TEMAS[f.tema] && Number.isFinite(f.x) && Number.isFinite(f.z) && f.r >= 80 && f.r <= 900);
}

// ruidoMar(x, z): o mesmo ruído suave (−1..1) que o arquipélago usa no fundo do mar (a emenda com o oceano aberto
// tem de ser exata na borda da caixa).
export function criarIlha(ficha, sementeMundo, ruidoMar) {
  const P = TEMAS[ficha.tema], tema = P.id;
  const cx = ficha.x, cz = ficha.z, r = ficha.r;
  const sem = hash3(ficha.semente | 0, tema, 0x11a5, sementeMundo | 0);
  const n = createSimplex(sem).n2, m = createSimplex(sem ^ 0x5bd1e995).n2;
  const h8 = (k) => D8[hash3(k, 3, 9, sem) & 7];
  const [a1, a2, a3] = P.borda;
  const ext = Math.ceil((r * P.alc * (P.ex || 1) + P.talude + PASSO * 3) / PASSO) * PASSO;
  const bx0 = Math.floor(cx / PASSO) * PASSO - ext, bz0 = Math.floor(cz / PASSO) * PASSO - ext;
  const NX = (2 * ext) / PASSO + 1, NZ = NX, bx1 = bx0 + 2 * ext, bz1 = bz0 + 2 * ext;

  // ---- traços próprios de cada tema (posições saem da semente da ilha) ------------------------------------------
  const eixo = h8(1);                                     // direção principal (cordilheira, boca da laguna…)
  const lado = h8(2);
  // vulcão: a boca fica um pouco fora do centro
  const vx = cx + eixo[0] * r * 0.06, vz = cz + eixo[1] * r * 0.06, RC = r * 0.8, RCRA = 30, HC = 110;
  const kr = 1 - RCRA / RC, HRIM = HC * (0.2 * kr + 0.3 * kr * kr + 0.5 * kr * kr * kr), PISO = HRIM - 21;
  // caribe: laguna deslocada do centro, canal até o mar e três ilhotas de areia
  const lgx = cx + eixo[0] * r * 0.24, lgz = cz + eixo[1] * r * 0.24, LGR = r * 0.37;
  // selvagem: lagoa esmeralda principal, segunda lagoa escondida, garganta sinuosa e cachoeira em degraus
  const slx = cx - eixo[0] * r * 0.14, slz = cz - eixo[1] * r * 0.14, SLR = r * 0.22;
  const lx2 = cx + lado[0] * r * 0.36, lz2 = cz + lado[1] * r * 0.36, SLR2 = r * 0.11;
  const wfx = slx + eixo[0] * (SLR * 0.85), wfz = slz + eixo[1] * (SLR * 0.85);
  const wfLocal = (x, z) => [-(x - wfx) * eixo[1] + (z - wfz) * eixo[0], (x - wfx) * eixo[0] + (z - wfz) * eixo[1]];
  const ilhotas = tema === T_CARIBE ? [0, 1, 2].map((k) => { const d = D8[(hash3(k, 5, 1, sem) + (k * 3) + 2) & 7], f = 1.28 + (hash3(k, 6, 2, sem) & 255) / 255 * 0.18; return [d[0] * f, d[1] * f, 0.085 + (hash3(k, 7, 3, sem) & 255) / 255 * 0.04]; })
    .filter(([u, v]) => u * eixo[0] + v * eixo[1] < 0.9) : [];

  // ---- forma: > 0 é terra ------------------------------------------------------------------------------------------
  function forma(x, z) {
    let u = (x - cx) / r, v = (z - cz) / r;
    if (P.ex) { const a = u * eixo[0] + v * eixo[1], b = -u * eixo[1] + v * eixo[0]; u = a / P.ex; v = b / P.ez; }
    const ro = Math.sqrt(u * u + v * v);
    let f = 1 + a1 * n(u * 1.15 + 13.7, v * 1.15 - 4.2) + a2 * n(u * 2.9 - 7.1, v * 2.9 + 9.3) + a3 * n(u * 6.7 + 2.2, v * 6.7 + 5.5) - ro;
    for (const [iu, iv, ir] of ilhotas) { const du = (x - cx) / r - iu, dv = (z - cz) / r - iv, g = ir * (1 + 0.3 * n(du * 9 + 1.5, dv * 9 - 2.5)) - Math.sqrt(du * du + dv * dv); if (g > f) f = g; }
    return f;
  }

  // ---- grade de distância à costa (na primeira consulta) -------------------------------------------------------
  let S = null;
  function prepara() {
    const N = NX * NZ, keep = new Uint8Array(N);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) keep[i + j * NX] = forma(bx0 + i * PASSO, bz0 + j * PASSO) > 0 ? 1 : 0;
    const DO = new Float32Array(N), DI = new Float32Array(N), D2 = 1.4142135;
    for (let k = 0; k < N; k++) { DO[k] = keep[k] ? 0 : LONGE; DI[k] = keep[k] ? LONGE : 0; }
    const chanfro = (D) => {
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        const k = i + j * NX; let v = D[k];
        if (i > 0) v = Math.min(v, D[k - 1] + 1);
        if (j > 0) { v = Math.min(v, D[k - NX] + 1); if (i > 0) v = Math.min(v, D[k - NX - 1] + D2); if (i < NX - 1) v = Math.min(v, D[k - NX + 1] + D2); }
        D[k] = v;
      }
      for (let j = NZ - 1; j >= 0; j--) for (let i = NX - 1; i >= 0; i--) {
        const k = i + j * NX; let v = D[k];
        if (i < NX - 1) v = Math.min(v, D[k + 1] + 1);
        if (j < NZ - 1) { v = Math.min(v, D[k + NX] + 1); if (i < NX - 1) v = Math.min(v, D[k + NX + 1] + D2); if (i > 0) v = Math.min(v, D[k + NX - 1] + D2); }
        D[k] = v;
      }
    };
    chanfro(DO); chanfro(DI);
    S = new Float32Array(N);
    for (let k = 0; k < N; k++) S[k] = keep[k] ? -(DI[k] - 0.5) * PASSO : (DO[k] - 0.5) * PASSO;
  }
  function s(x, z) {
    const fx = (x - bx0) / PASSO, fz = (z - bz0) / PASSO;
    if (fx < 0 || fz < 0 || fx > NX - 1 || fz > NZ - 1) return LONGE;
    if (!S) prepara();
    const i = Math.min(NX - 2, Math.floor(fx)), j = Math.min(NZ - 2, Math.floor(fz));
    const u = fx - i, v = fz - j, k = i + j * NX;
    return (S[k] * (1 - u) + S[k + 1] * u) * (1 - v) + (S[k + NX] * (1 - u) + S[k + NX + 1] * u) * v;
  }

  // ---- fundo do mar pela distância à costa: plataforma clara, talude e oceano aberto (emenda exata na borda) ----
  function fundo(d, x, z) {
    const nn = ruidoMar(x, z);
    if (d <= P.raso) return -d * (3.06 / P.raso) + nn * 0.35;
    const t = sstep(P.raso, P.talude, d);
    return -3.06 + (FUNDO + 3.06) * t + nn * (0.6 + 2.4 * t);
  }

  // ---- relevo de dentro, por tema (e = metros terra adentro) ---------------------------------------------------
  function coneDe(x, z) { const dx = x - vx, dz = z - vz; return Math.sqrt(dx * dx + dz * dz); }
  function interior(x, z, e) {
    if (tema === T_FLORESTA) {
      const relevo = 0.5 + 0.5 * fbm(n, x * 0.0062, z * 0.0062, 4), crista = ridged(m, x * 0.0041 + 7.3, z * 0.0041 - 3.1, 3);
      const sobe = sstep(34, 150, e);
      let h = 2.7 + sobe * (4 + 17 * relevo) + sstep(90, 240, e) * 16 * crista + fbm(m, x * 0.031, z * 0.031, 2) * 1.4 * sobe;
      // igarapés: vales rasos no nível do mar ao longo das linhas onde um ruído lento cruza o zero (só nas baixadas)
      const rio = Math.abs(m(x * 0.0027 + 700, z * 0.0027 + 700));
      if (rio < 0.07 && e > 46) {
        const w = (1 - sstep(9, 21, h)) * sstep(46, 70, e);
        const alvo = rio < 0.018 ? -1.7 : lerp(-1.7, h, sstep(0.018, 0.07, rio));
        if (alvo < h) h = lerp(h, alvo, w);
      }
      // lagos de mata: bacias no miolo
      const lago = (1 - sstep(-0.66, -0.52, n(x * 0.0048 + 31.4, z * 0.0048 - 12.9))) * sstep(74, 112, e);
      if (lago > 0) h = lerp(h, -2.6, lago);
      return h;
    }
    if (tema === T_VULCAO) {
      const baixo = 2.7 + sstep(34, 120, e) * (3 + 6 * (0.5 + 0.5 * fbm(m, x * 0.008, z * 0.008, 3)));
      const q = coneDe(x, z);
      if (q < RCRA * 0.5) return PISO - 3.4 * (1 - sstep(0, RCRA * 0.5, q));             // bacia do lago de lava
      const ux = (x - vx) / q, uz = (z - vz) / q;
      const rav = Math.abs(m(ux * 2.6 + 5.1, uz * 2.6 - 9.3));        // muda com o ângulo: ravinas que descem o cone
      const fora = (qq) => {                                          // encosta a qq metros da boca, nesta direção
        const k = clamp(1 - qq / RC, 0, 1);
        const c = HC * (0.2 * k + 0.3 * k * k + 0.5 * k * k * k) * (1 + 0.07 * fbm(n, (vx + ux * qq) * 0.011, (vz + uz * qq) * 0.011, 3))
          - 8 * 4 * k * (1 - k) * (1 - sstep(0, 0.2, rav));
        return baixo * (1 - 0.8 * sstep(0.05, 0.5, k)) + Math.max(0, c);
      };
      if (q < RCRA) return PISO + (fora(RCRA) - PISO) * sstep(0.5, 1, q / RCRA);          // paredão de dentro da cratera
      return fora(q);
    }
    if (tema === T_NEVE) {
      const mt = ridged(n, x * 0.0034 + 90, z * 0.0034 + 90, 5), colinas = 0.5 + 0.5 * fbm(m, x * 0.0075, z * 0.0075, 3);
      let h = 2.7 + sstep(34, 110, e) * (5 + 9 * colinas) + sstep(46, 250, e) * (mt * 106 - 11) * (0.8 + 0.2 * colinas);
      if (h > 84) h = 84 + (h - 84) * 0.4;
      // lago de degelo: bacia num vale alto do miolo
      const lago = (1 - sstep(-0.7, -0.56, m(x * 0.0043 - 61.7, z * 0.0043 + 22.1))) * sstep(80, 120, e) * (1 - sstep(0.16, 0.3, mt));
      if (lago > 0) h = lerp(h, -2.8, lago);
      return h;
    }
    if (tema === T_CARIBE) {
      let h = 2.3 + sstep(30, 110, e) * (1.0 + 4.2 * (0.5 + 0.5 * fbm(n, x * 0.012, z * 0.012, 3)));
      const dx = x - lgx, dz = z - lgz, dl = Math.sqrt(dx * dx + dz * dz) / (LGR * (1 + 0.12 * m(x * 0.01 + 4, z * 0.01 - 6)));
      const lag = 1 - sstep(0.74, 1.0, dl);
      if (lag > 0) h = lerp(h, -2.7 + 0.5 * n(x * 0.03, z * 0.03), lag);
      return h;
    }
    if (tema === T_SELVAGEM) {
      const morro = 0.5 + 0.5 * fbm(m, x * 0.0068 + 11.2, z * 0.0068 - 7.4, 4);
      const crista = ridged(n, x * 0.0044 - 23.1, z * 0.0044 + 19.7, 4);
      const sobe = sstep(30, 125, e);
      let h = 2.6 + sobe * (5 + 18 * morro + 34 * crista * sstep(52, 165, e)) + fbm(m, x * 0.031, z * 0.031, 2) * 1.6 * sobe;
      // garganta tropical sinuosa saindo da lagoa esmeralda
      const proj = -(x - slx) * eixo[0] - (z - slz) * eixo[1];
      const lat = (x - slx) * eixo[1] - (z - slz) * eixo[0] + 24 * n(x * 0.008 + 7.1, z * 0.008 - 3.9);
      if (proj > -SLR * 0.2 && proj < r * 0.92 && e > 18) {
        const gLarg = 13 + 4 * m(x * 0.014, z * 0.014), gDist = Math.abs(lat) / gLarg;
        if (gDist < 1.35) {
          const wg = (1 - sstep(0.55, 1.35, gDist)) * sstep(18, 36, e) * (1 - sstep(r * 0.78, r * 0.92, proj));
          const fundoG = gDist < 0.45 ? -2.8 : lerp(-2.8, Math.max(h, 11), sstep(0.45, 1.0, gDist));
          h = lerp(h, fundoG, wg);
        }
      }
      // lagoas esmeralda
      const dx1 = x - slx, dz1 = z - slz;
      const dl1 = Math.sqrt(dx1 * dx1 + dz1 * dz1) / (SLR * (1 + 0.16 * m(x * 0.012 + 3.2, z * 0.012 - 5.1)));
      const lag1 = 1 - sstep(0.72, 1.0, dl1);
      if (lag1 > 0) h = lerp(h, -3.5 + 0.5 * m(x * 0.03, z * 0.03), lag1);
      const dx2 = x - lx2, dz2 = z - lz2;
      const dl2 = Math.sqrt(dx2 * dx2 + dz2 * dz2) / (SLR2 * (1 + 0.14 * n(x * 0.015 - 2.1, z * 0.015 + 6.3)));
      const lag2 = (1 - sstep(0.68, 1.0, dl2)) * sstep(42, 68, e);
      if (lag2 > 0) h = lerp(h, -2.9 + 0.4 * n(x * 0.03, z * 0.03), lag2);
      // anfiteatro e degraus da cachoeira na borda alta da lagoa esmeralda
      const [au, v] = wfLocal(x, z), u = Math.abs(au);
      if (u <= 13 && v >= -6 && v <= 18) {
        let tw = h;
        if (u <= 4.5 && v >= 4 && v <= 12) tw = 15.0;
        else if (u <= 2.2 && v >= 1 && v < 4) tw = 17.6;
        else if (u <= 2.2 && v >= -1 && v < 1) tw = 11.0;
        else if (u <= 2.2 && v >= -3 && v < -1) tw = 5.0;
        else if (u <= 2.2 && v >= -5.5 && v < -3) tw = -3.6;
        else if (u <= 8 && v >= 0 && v <= 15.5) tw = 22.0;
        else if (u <= 6 && v >= -5 && v < 0) tw = lerp(5.0, 21.0, (v + 5) / 5);
        const bw = (u <= 6.5 && v >= -4.5 && v <= 14.5) ? 1 : (1 - sstep(7.5, 13, u)) * (v < -4 ? sstep(-6, -4, v) : v > 14 ? 1 - sstep(14, 18, v) : 1);
        h = lerp(h, tw, bw);
      }
      return h;
    }
    // metrópole: patamar plano para a cidade (as ruas, os prédios e o estádio são de shared/cidade.js)
    return 3.0;
  }
  // caribe: passagem da laguna para o mar (corta a restinga e a plataforma)
  function canal(x, z) {
    if (tema !== T_CARIBE) return 0;
    const d = distSeg(x, z, lgx, lgz, cx + eixo[0] * r * 1.7, cz + eixo[1] * r * 1.7);
    return 1 - sstep(8, 17, d + 3 * n(x * 0.02, z * 0.02));
  }

  function rel(x, z) {
    const d = s(x, z);
    if (d >= LONGE) return FUNDO + ruidoMar(x, z) * 3;
    let h;
    if (d > 0) h = fundo(d, x, z);
    else {
      const e = -d, pr = 0.7 + e * 0.05 + ruidoMar(x * 0.5, z * 0.5) * 0.25;
      if (e <= PRAIA_ILHA * 0.35) h = pr;
      else { const it = interior(x, z, e); h = e >= PRAIA_ILHA ? it : it + (pr - it) * sstep(-PRAIA_ILHA, -PRAIA_ILHA * 0.35, d); }
    }
    if (tema === T_CARIBE && d < 60) { const c = canal(x, z); if (c > 0 && h > -1.9) h = lerp(h, -1.9, c); }
    return h;
  }

  // ---- clima do tema: cheio na ilha, esmaece sobre a plataforma ------------------------------------------------
  const il = { id: ficha.id, nome: ficha.nome, tema, ficha, caixa: [bx0, bz0, bx1, bz1], x: cx, z: cz, r, T: P.T, M: P.M, s, rel, forma };
  il.clima = (x, z) => 1 - sstep(40, 150, s(x, z));
  // quanto do cone do vulcão há aqui (0 = baixada … 1 = boca); 0 nos outros temas
  il.cone = (x, z) => (tema === T_VULCAO ? clamp(1 - coneDe(x, z) / RC, 0, 1) : 0);
  il.vulcao = tema === T_VULCAO ? { x: vx, z: vz, raio: RCRA, borda: HRIM, piso: PISO } : null;
  il.laguna = tema === T_CARIBE ? { x: lgx, z: lgz, raio: LGR } : null;
  il.lagoa = tema === T_SELVAGEM ? { x: slx, z: slz, raio: SLR } : null;
  il.cachoeira = tema === T_SELVAGEM ? { x: wfx, z: wfz, dx: eixo[0], dz: eixo[1], yBase: 48, yTopo: 67 } : null;

  // bloco da superfície: `top` é o que a regra geral escolheu; r = sorteio 0..1 da coluna; H = altura (blocos)
  il.topo = (x, z, H, sea, slope, r, top) => {
    // praia fria de cascalho, com lajes de pedra em manchas (nunca pedra solta sorteada bloco a bloco)
    if (tema === T_NEVE) return top === B.SAND ? (n(x * 0.07 + 41, z * 0.07 - 19) + 0.4 * m(x * 0.21, z * 0.21) > 0.62 ? B.STONE : B.GRAVEL) : top;
    if (tema === T_VULCAO) {
      const k = il.cone(x, z), q = coneDe(x, z);
      if (top === B.SAND) return B.ASH;                                                    // praia e fundo raso de areia vulcânica
      if (q < RCRA + 3) return B.BASALT;
      // veios de lava: descem pelas ravinas do alto do cone (as mesmas do relevo), com falhas ao longo do caminho
      if (k > 0.52 && k < 0.9) {
        const ux = (x - vx) / q, uz = (z - vz) / q, rav = Math.abs(m(ux * 2.6 + 5.1, uz * 2.6 - 9.3));
        if (rav < 0.02 + 0.015 * (k - 0.52) && n(x * 0.045 + 61, z * 0.045 - 37) > -0.25 - (k - 0.52) * 1.2) return B.MAGMA;
      }
      // cinza em campos contínuos (mancha larga + recorte fino), nunca bloco solto sorteado
      const mancha = n(x * 0.035 + 17, z * 0.035 - 23), fina = m(x * 0.11 + 3.3, z * 0.11 - 8.1);
      if (k > 0.5 + 0.08 * mancha) return mancha + 0.35 * fina > 0.3 ? B.ASH : B.BASALT;   // cone pelado
      if (k > 0.3 + 0.1 * mancha && (top === B.GRASS || top === B.DIRT)) return mancha + 0.3 * fina > 0.22 ? B.ASH : fina > 0.42 ? B.GRAVEL : B.BASALT;   // faixa de lava velha
      return top === B.STONE && k > 0.2 ? B.BASALT : top;
    }
    if (tema === T_CARIBE) {
      if (top !== B.GRASS && top !== B.DIRT) return top;
      const e = -s(x, z), mato = n(x * 0.021 + 8.8, z * 0.021 + 3.3) + 0.5 * m(x * 0.06, z * 0.06);
      return e < 62 || mato < 0.12 ? B.SAND : top;                                         // areia quase até o miolo; ilhas de vegetação
    }
    if (tema === T_SELVAGEM) {
      const e = -s(x, z);
      if (H < sea && e > 16) return n(x * 0.09 + 4.1, z * 0.09 - 7.3) > 0.08 ? B.CLAY : B.SAND;   // fundo claro esmeralda das lagoas e garganta
      const [au, v] = wfLocal(x, z);
      if (Math.abs(au) <= 9 && v >= -5 && v <= 16) {
        if (Math.abs(au) <= 4.5 && v >= 4 && v <= 12) return B.CLAY;
        if (Math.abs(au) <= 2.2 && v >= -5 && v < 4) return m(x * 0.15, z * 0.15) > 0.2 ? B.BASALT : B.STONE;
        if (slope >= 2) return m(x * 0.08, z * 0.08) > 0.35 ? B.BASALT : B.STONE;
      }
      if (top === B.SNOW) return B.GRASS;
      if (slope >= 3 && e > 20) return m(x * 0.08, z * 0.08) > 0.35 ? B.BASALT : B.STONE;
      return top;
    }
    return top;
  };

  // árvore sorteada na célula: `a` = { kind, dens, th, rad, clareira } já com a regra geral; devolve false para tirar.
  // praia = distância com sinal à costa quando o ponto está na faixa da praia (senão null); r2, r3 = sorteios 0..1
  il.arvore = (a, x, z, y, sea, praia, r2, r3) => {
    if (tema === T_NEVE) { if (a.kind === 5) return false; if (a.kind !== 1) { a.kind = 1; a.dens = 0.5; } a.dens = Math.max(a.dens, y - sea > 26 ? 0.2 : 0.8); a.clareira = 0.55; return true; }
    if (tema === T_FLORESTA) {
      if (a.kind === 5) return true;
      a.kind = 0; a.dens = 0.9; a.clareira = 0.82;
      a.th = 6 + Math.floor(r2 * 6); a.rad = 2.9 + r3 * 1.0; if (r2 > 0.8) { a.th += 3; a.rad = 3.9; }
      return true;
    }
    if (tema === T_VULCAO) {
      const k = il.cone(x, z);
      if (k > 0.34) return false;                                                           // cone: nada cresce
      if (a.kind === 5) return true;
      a.kind = 0; a.dens = 0.85 * (1 - sstep(0.2, 0.34, k)); a.clareira = 0.6; return true;
    }
    if (tema === T_CARIBE) {
      const e = -s(x, z);
      if (e < 6) return false;
      const bosque = n(x * 0.016 - 3.1, z * 0.016 + 7.7);
      a.kind = 5; a.dens = e < 34 ? 0.5 : 0.1 + 0.55 * sstep(-0.1, 0.5, bosque); a.clareira = 1; return true;
    }
    if (tema === T_METROPOLE) return a.kind === 5;                                          // só os coqueiros da orla; a cidade planta as suas
    if (tema === T_SELVAGEM) {
      const e = -s(x, z);
      if (e < 5) return false;
      if (e < 13) { a.kind = 5; a.dens = 0.42; a.clareira = 1; return true; }               // coqueiros na orla selvagem
      const [au, v] = wfLocal(x, z);
      if (Math.abs(au) < 12 && v > -7 && v < 18) return false;                              // anfiteatro da cachoeira livre
      if (a.kind === 5) return true;
      const cl = n(x * 0.016 + 51.3, z * 0.016 - 33.7) + 0.35 * m(x * 0.041, z * 0.041);
      if (cl > 0.42) return false;                                                          // clareiras ensolaradas no meio da selva
      a.kind = 0; a.dens = 0.93; a.clareira = 0.90;
      a.th = 6 + Math.floor(r2 * 7); a.rad = 3.0 + r3 * 1.2;
      if (r2 > 0.80) { a.th += 3; a.rad = 4.1; }
      return true;
    }
    return true;
  };

  // rocha de dentro (o que aparece em paredão e quando se cava): basalto no cone do vulcão
  il.rocha = (x, z) => (tema === T_VULCAO && il.cone(x, z) > 0.1 ? B.BASALT : B.STONE);
  il.liquido = B.MAGMA;   // o que enche o lago da cratera (ver lava)

  // metrópole: ruas, prédios e estádio são obra do próprio mundo (shared/cidade.js), montada na primeira consulta
  if (tema === T_METROPOLE) {
    let cid = null;
    const cidade = () => cid || (cid = criarCidade({ x: cx, z: cz, r, s, semente: sem, cais: ficha.cais || null }));
    Object.defineProperty(il, 'cidade', { get: cidade });
    il.obras = (x0, z0, set, alt) => cidade().obras(x0, z0, set, alt);
    // onde o gerador não põe capim nem flor (gramado do estádio, ruas, pisos): quem sabe é a cidade
    il.semPlanta = (x, z) => { const c = cidade(); return c.semPlanta ? c.semPlanta(x, z) : false; };
    // topo (y) do prédio que cobre a coluna, ou 0: para a silhueta da cidade vista de longe (retrato, não colisão)
    let grade = null;
    il.topoObra = (x, z) => {
      if (!grade) {
        grade = new Map();
        for (const p of cidade().predios || []) {
          if (!(p.altura > 0) || p.tipo === 'estadio') continue;
          for (let a = p.x0 >> 4; a <= p.x1 >> 4; a++) for (let b = p.z0 >> 4; b <= p.z1 >> 4; b++) { const k = a * 65536 + b; let l = grade.get(k); if (!l) grade.set(k, l = []); l.push(p); }
        }
      }
      const l = grade.get((x >> 4) * 65536 + (z >> 4)); if (!l) return 0;
      let t = 0;
      for (let k = 0; k < l.length; k++) { const p = l[k]; if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1 && p.altura > t) t = p.altura; }
      return t;
    };
  }

  il.lava = (x, z) => {
    if (tema !== T_VULCAO) return 0;
    const q = coneDe(x, z);
    return q < RCRA * 0.6 ? PISO + 1.6 : 0;
  };
  il.agua = (x, z) => {
    if (tema !== T_SELVAGEM) return 0;
    const [au, v] = wfLocal(x, z), u = Math.abs(au);
    if (u <= 4.5 && v >= 4 && v <= 12) return 19.0;
    if (u <= 2.2 && v >= 1 && v < 4) return 19.0;
    if (u <= 2.2 && v >= -1 && v < 1) return 18.2;
    if (u <= 2.2 && v >= -3 && v < -1) return 12.2;
    if (u <= 2.2 && v >= -5.2 && v < -3) return 6.2;
    return 0;
  };
  il.planta = tema === T_SELVAGEM ? (x, z, ground, H, sea, r, beira) => {
    if (ground !== B.GRASS) return 0;
    if (beira) return r > 0.36 ? B.REEDS : B.FERN;
    if (r < 0.26) return B.FERN;
    if (r < 0.48) return B.TALL_GRASS;
    if (r < 0.62) {
      const f = n(x * 0.04 + 19.2, z * 0.04 - 11.8) + (r - 0.55) * 2.5;
      return f < -0.25 ? B.FLOWER_BLUE : f < 0.05 ? B.FLOWER_YELLOW : f < 0.35 ? B.FLOWER_WHITE : B.FLOWER_RED;
    }
    return 0;
  } : null;
  return il;
}
