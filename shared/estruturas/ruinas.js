// Kraft — ruínas com pictogramas (pedido do Kadmus, 19/11/2026). Puro e determinístico (shared/estruturas.js).
//
// Onde nasce: em chão aberto e quase plano (desnível de até 3 m numa roda de 20 m), fora de mar, praia, neve e alta
// montanha, sem árvore em cima do piso. No deserto, tudo de arenito; nos outros lugares, pedra talhada e mármore.
// Como é: o que sobrou de um templo antigo — piso elevado (estilóbata) com as bordas quebradas e a grama tomando conta,
// escadaria na frente, duas fileiras de colunas (umas inteiras com capitel e arquitrave, outras partidas em alturas
// diferentes, uma caída no chão em pedaços), a parede do fundo partida com o PICTOGRAMA principal gravado, pedaços de
// muro dos lados, entulho em volta e, debaixo do piso, uma CÂMARA ENTERRADA: uma escada desce por um buraco no piso
// até uma sala de pedra com três pictogramas nas paredes, pedras que brilham no teto e o baú de ruína num pedestal.
import { B } from '../blocks.js';
import { BIOME } from '../worldgen.js';
import { stairState } from '../minis.js';
import {
  criarPlanta, ruido2, rng, sorte, estabilizar, sementeDoSitio, planta_, olhoLivre, FRENTE, ESSENCIAL, MOLDE, MOLDE_OK,
  TRES_QUARTOS, MEIO_Y, POSTE, SEA, Y_TOP,
} from '../estruturas.js';
import { montarPainel } from './pictogramas.js';

const PROIBIDOS = new Set([BIOME.OCEAN, BIOME.BEACH, BIOME.SNOW, BIOME.ALPINE]);

export function podeNascer(ctx, x, z) {
  const bio = ctx.bioma(x, z);
  if (PROIBIDOS.has(bio)) return null;
  const H = ctx.height, hs = [];
  for (let ex = -10; ex <= 10; ex += 2) for (let ez = -10; ez <= 10; ez += 2) if (ex * ex + ez * ez <= 110) hs.push(H(x + ex, z + ez));
  hs.sort((a, b) => a - b);
  const espalho = hs[hs.length - 1] - hs[0];
  if (espalho > 3) return null;
  const y0 = hs[hs.length >> 1];
  if (y0 < SEA + 3 || y0 + 14 >= Y_TOP) return null;
  for (const t of ctx.arvores(x - 12, z - 12, x + 12, z + 12)) if ((t.x - x) * (t.x - x) + (t.z - z) * (t.z - z) < 110) return null;
  const sem = sementeDoSitio(ctx, 'ruinas', x, z);
  const topo = ctx.natural(x, H(x, z), z);
  return { tipo: 'ruinas', x, y: y0, z, rot: sem & 3, deserto: bio === BIOME.DESERT || topo === B.SAND, nota: -espalho, semente: sem };
}

export function gerar(ctx, s) {
  const y0 = s.y, S = s.semente & 0x7fffffff, r = rng(s.semente);
  const P = criarPlanta(ctx, { tipo: 'ruinas', ancora: [s.x, y0, s.z], rot: s.rot, semente: s.semente, nome: RUINAS.nome });
  P.posta = 'postas';
  const L = P.L, [ox, oz] = P.eixoV, [ax, az] = P.eixoU;
  const c = (q) => [q[0] + 0.5, q[1], q[2] + 0.5];
  const M = s.deserto
    ? { piso: B.SANDSTONE, coluna: B.SANDSTONE, base: B.SANDSTONE, muro: B.SANDSTONE, escada: B.STAIR_SANDSTONE, painel: B.SANDSTONE, traco: B.BASALT, chao: B.SAND }
    : { piso: B.STONE_BRICKS, coluna: B.MARBLE, base: B.STONE_BRICKS, muro: B.STONE_BRICKS, escada: B.STAIR_STONE_BRICKS, painel: B.SANDSTONE, traco: B.BASALT, chao: B.GRASS };
  const por = (u, y, v, b, m = 0, f = 0) => { const [x, , z] = L(u, y, v); P.por(x, y, z, b, m, f); };
  const ler = (u, y, v) => { const [x, , z] = L(u, y, v); return P.ler(x, y, z); };
  const ar = (u, y, v, f = 0) => { const [x, , z] = L(u, y, v); P.ar(x, y, z, f); };
  const Hn = (u, v) => { const [x, , z] = L(u, 0, v); return ctx.height(x, z); };
  const U0 = -6, U1 = 6, V0 = -11, V1 = 5;   // piso

  // 1) piso elevado: topo em y0 + 1, fundação até o chão; bordas comidas pelo tempo (a grama volta)
  for (let u = U0; u <= U1; u++) for (let v = V0; v <= V1; v++) {
    const hn = Hn(u, v), borda = u === U0 || u === U1 || v === V0 || v === V1;
    const gasto = ruido2(u * 0.45 + 3, v * 0.45, S + 1);
    for (let y = hn + 1; y <= y0 + 3; y++) { const b = ler(u, y, v); if (b !== B.AIR && !P.cheio(...L(u, y, v))) ar(u, y, v); }   // planta e capim saem
    if (borda && gasto > 0.55 && !(v === V0)) {             // canto quebrado: o chão natural volta (sem degrau)
      for (let y = y0 + 2; y <= hn; y++) ar(u, y, v, ESSENCIAL);
      if (hn > y0) por(u, y0 + 1, v, M.chao, MOLDE_OK[M.chao] ? MOLDE : 0, ESSENCIAL);
      continue;
    }
    for (let y = Math.min(hn, y0) + 1; y <= y0; y++) por(u, y, v, B.STONE, 0, ESSENCIAL);   // fundação
    for (let y = y0 + 2; y <= hn; y++) ar(u, y, v, ESSENCIAL);                                  // chão mais alto: rebaixa
    const t = sorte(S, u, v, 2);
    if (!borda && t < 0.09 && !s.deserto) { por(u, y0 + 1, v, B.GRASS, MOLDE, ESSENCIAL); if (t < 0.05) por(u, y0 + 2, v, B.TALL_GRASS); }
    else if (!borda && t < 0.12) por(u, y0 + 1, v, s.deserto ? B.SAND : B.GRAVEL, 0, ESSENCIAL);
    else por(u, y0 + 1, v, M.piso, 0, ESSENCIAL);
  }
  // escadaria da frente (sobe para dentro do templo), com degraus faltando
  const sobeDentro = stairState([-ox, 0, -oz], 1);
  for (let u = -3; u <= 3; u++) {
    const t = sorte(S, u, 31);
    if (t < 0.15) continue;
    const hn = Hn(u, V1 + 1);
    for (let y = hn + 1; y <= y0; y++) por(u, y, V1 + 1, B.STONE, 0, ESSENCIAL);
    por(u, y0 + 1, V1 + 1, M.escada, sobeDentro, ESSENCIAL);
    if (ler(u, y0 + 2, V1 + 1) !== B.AIR && !P.cheio(...L(u, y0 + 2, V1 + 1))) ar(u, y0 + 2, V1 + 1);
  }

  // 2) colunas: inteiras (com capitel), partidas em alturas diferentes e uma caída
  const COL_V = [-8, -4, 0, 4], inteira = new Map();
  let caida = null;
  for (const u of [-5, 5]) for (const v of COL_V) {
    const t = sorte(S, u, v, 3), alt = t < 0.42 ? 5 : 1 + Math.floor(sorte(S, u, v, 4) * 4);
    por(u, y0 + 2, v, M.base, 0, ESSENCIAL);
    for (let k = 1; k <= alt; k++) {
      const topo = k === alt && alt < 5;
      por(u, y0 + 2 + k, v, M.coluna, topo ? (sorte(S, u, v, k) < 0.5 ? TRES_QUARTOS(k + u) : MEIO_Y(v & 1)) : 0, ESSENCIAL);
    }
    if (alt === 5) { por(u, y0 + 8, v, M.base, 0, ESSENCIAL); inteira.set(u + ',' + v, true); }
    else if (!caida && alt <= 2) caida = [u, v, alt];
  }
  // arquitrave sobre colunas inteiras vizinhas
  for (const u of [-5, 5]) for (let i = 0; i + 1 < COL_V.length; i++) {
    const v0 = COL_V[i], v1 = COL_V[i + 1];
    if (!inteira.get(u + ',' + v0) || !inteira.get(u + ',' + v1)) continue;
    for (let v = v0; v <= v1; v++) por(u, y0 + 9, v, M.base, 0, ESSENCIAL);
  }
  // a coluna caída: os pedaços deitados no chão, para fora do piso
  if (caida) {
    const [u, v, alt] = caida, sinal = Math.sign(u);
    for (let k = 1; k <= 7 - alt; k++) {
      const uu = u + sinal * (k + 1);
      if (k === 3) continue;                                   // falta um pedaço: quebrou na queda
      const hn = Math.abs(uu) > U1 ? Hn(uu, v) : y0 + 1;
      const [x, , z] = L(uu, 0, v);
      if (P.ler(x, hn + 1, z) !== B.AIR && P.cheio(x, hn + 1, z)) continue;
      P.por(x, hn + 1, z, k === 7 - alt ? M.base : M.coluna, k === 4 ? MEIO_Y(1) : 0);
      if (planta_(P.ler(x, hn + 2, z))) P.ar(x, hn + 2, z);
    }
  }

  // 3) parede do fundo partida, com o pictograma principal; pedaços de muro dos lados
  const VP = V0 + 2;                                           // linha da parede (o painel fica na face de dentro)
  for (let u = -4; u <= 4; u++) {
    const alto = 4 + Math.floor(ruido2(u * 0.6, 1.7, S + 5) * 4) - (Math.abs(u) >= 4 ? 2 : 0);
    for (let y = y0 + 2; y <= y0 + 1 + alto; y++) por(u, y, VP, M.muro, 0, ESSENCIAL);
    const topo = y0 + 1 + alto;
    if (sorte(S, u, 41) < 0.35) por(u, topo + 1, VP, M.muro, TRES_QUARTOS(u));
  }
  const n = [ox, 0, oz], motivoPrincipal = ['mapa', 'cacada', 'arvore', 'espiral'][Math.floor(r() * 4)];
  {
    const [bx, , bz] = L(2, 0, VP);                            // a direita de quem olha para −v é −u: começa em u = 2
    P.pictos.push(montarPainel(P, { x: bx, y: y0 + 2, z: bz, n, larg: 6, alt: 4, motivo: motivoPrincipal, fundo: M.painel, traco: M.traco, abrir: 1 }));
  }
  for (const u of [-5, 5]) for (let v = VP; v <= VP + 3; v++) {
    const alt = 1 + Math.floor(sorte(S, u, v, 6) * (v === VP ? 4 : 3));
    for (let y = y0 + 2; y <= y0 + 1 + alt; y++) if (P.ler(...L(u, y, v)) === B.AIR) por(u, y, v, M.muro, y === y0 + 1 + alt && sorte(S, u, v, y) < 0.4 ? TRES_QUARTOS(v) : 0);
  }
  // moita e capim tomando o alto da parede
  for (let u = -4; u <= 4; u++) {
    if (sorte(S, u, 51) > 0.3) continue;
    let y = y0 + 12; while (y > y0 + 2 && ler(u, y, VP) === B.AIR) y--;
    if (P.cheio(...L(u, y, VP)) && ler(u, y + 1, VP) === B.AIR) por(u, y + 1, VP, B.LEAVES);
  }

  // 4) câmara enterrada: sala de pedra de 6 × 6 × 4 debaixo do fundo do piso, escada pelo buraco do piso
  const CU0 = -3, CU1 = 2, CV0 = -9, CV1 = -4, CY0 = y0 - 4, CY1 = y0 - 1;
  for (let u = CU0 - 1; u <= CU1 + 1; u++) for (let v = CV0 - 1; v <= CV1 + 1; v++) for (let y = CY0 - 1; y <= CY1 + 1; y++) {
    const dentro = u >= CU0 && u <= CU1 && v >= CV0 && v <= CV1 && y >= CY0 && y <= CY1;
    if (dentro) ar(u, y, v, ESSENCIAL);
    else if (y === CY0 - 1) por(u, y, v, (u + v) % 3 === 0 ? B.MARBLE : M.piso, 0, ESSENCIAL);
    else por(u, y, v, M.muro, 0, ESSENCIAL);
  }
  // pedras que brilham no teto (os antigos as puseram ali)
  for (const [u, v] of [[CU0, CV0], [CU1, CV0], [CU0, CV1], [CU1, CV1]]) if (sorte(S, u, v, 61) < 0.75) por(u, CY1 + 1, v, B.CRYSTAL_ORE, 0, ESSENCIAL);
  // escada: desce de v = 1 (no piso) até dentro da câmara, em u = 1 e 2
  const desce = stairState([ox, 0, oz], 1);                   // degraus que sobem para +v (quem desce vai para −v)
  for (let k = 0; k <= 5; k++) for (const u of [1, 2]) {
    const v = 1 - k, y = y0 + 1 - k;
    por(u, y, v, M.escada, desce, ESSENCIAL);
    for (let yy = y + 1; yy <= y + 3; yy++) if (!(yy >= y0 + 2 && k <= 1)) ar(u, yy, v, ESSENCIAL);
    for (let yy = y - 1; yy >= Math.min(y0, y - 3); yy--) if (!P.cheio(...L(u, yy, v))) por(u, yy, v, B.STONE, 0, ESSENCIAL);
  }
  // pictogramas da câmara: fundo, esquerda e direita (para quem desce a escada olhando para −v)
  const [ex0, , ez0] = L(CU1, 0, CV0 - 1);
  P.pictos.push(montarPainel(P, { x: ex0, y: CY0, z: ez0, n, larg: 6, alt: 4, motivo: 'porta_agua', fundo: M.painel, traco: M.traco, abrir: 0 }));
  const [lx0, , lz0] = L(CU0 - 1, 0, CV0);
  P.pictos.push(montarPainel(P, { x: lx0, y: CY0, z: lz0, n: [ax, 0, az], larg: 6, alt: 4, motivo: 'estrelas', fundo: M.painel, traco: M.traco, abrir: 0 }));
  const [rx0, , rz0] = L(CU1 + 1, 0, CV1);
  P.pictos.push(montarPainel(P, { x: rx0, y: CY0, z: rz0, n: [-ax, 0, -az], larg: 6, alt: 4, motivo: 'serpente', fundo: M.painel, traco: M.traco, abrir: 0 }));
  // pedestal e baú de ruína no meio da câmara, de frente para a escada
  por(-1, CY0, -7, M.base, 0, ESSENCIAL);
  por(-1, CY0 + 1, -7, B.AIR, 0, ESSENCIAL);
  const [bx, , bz] = L(-1, 0, -7);
  P.baus.push({ x: bx, y: CY0 + 1, z: bz, nivel: 'ruina', i: 0 });
  // terra que caiu pelo buraco do piso, num canto
  por(CU1, CY0, CV1, s.deserto ? B.SANDSTONE : B.DIRT, MOLDE);

  // 5) entulho em volta e vida (samambaias, flores, capim) nas frestas
  for (let i = 0; i < 14; i++) {
    const u = Math.round((r() - 0.5) * 22), v = Math.round(V0 + r() * (V1 - V0 + 6));
    if (u >= U0 && u <= U1 && v >= V0 && v <= V1 + 1) continue;
    const hn = Hn(u, v), [x, , z] = L(u, 0, v);
    if (P.tem(x, hn + 1, z) || P.cheio(x, hn + 1, z) || !P.cheio(x, hn, z)) continue;
    const t = r();
    P.por(x, hn + 1, z, t < 0.5 ? M.muro : M.coluna, t < 0.35 ? TRES_QUARTOS(i) : t < 0.6 ? MEIO_Y(i & 1) : t < 0.75 ? POSTE(i) : 0);
  }
  for (let u = U0 - 3; u <= U1 + 3; u++) for (let v = V0 - 3; v <= V1 + 4; v++) {
    const [x, , z] = L(u, 0, v);
    let y = y0 + 12; while (y > y0 - 6 && !P.cheio(x, y, z)) y--;
    if (P.ler(x, y + 1, z) !== B.AIR) continue;
    const b = P.ler(x, y, z), t = sorte(S, x, z, 7);
    if ((b === B.GRASS || b === B.DIRT) && t < 0.18) P.por(x, y + 1, z, t < 0.06 ? B.FERN : t < 0.1 ? B.FLOWER_WHITE : t < 0.12 ? B.FLOWER_YELLOW : B.TALL_GRASS);
    else if (b === M.piso && t < 0.03 && !s.deserto) P.por(x, y + 1, z, B.TALL_GRASS);
    else if (s.deserto && b === B.SAND && t < 0.04) P.por(x, y + 1, z, B.DRY_SHRUB);
  }

  P.entrada = L(0, y0 + 2, V1 + 2);
  P.vista = { de: c(L(7, y0 + 4.5, V1 + 10)), para: c(L(0, y0 + 4, -4)) };
  P.vistas = {
    fora: { de: olhoLivre(P, P.vista.de), para: P.vista.para },
    painel: { de: c(L(-0.5, y0 + 3.6, VP + 6)), para: c(L(-0.5, y0 + 3.6, VP)) },
    camara: { de: c(L(1.5, CY0 + 1.6, CV1 + 0.4)), para: c(L(-0.5, CY0 + 1.5, CV0 - 1)) },
  };
  estabilizar(P);
  return P;
}

export const RUINAS = Object.freeze({
  chave: 'ruinas', nome: 'Ruínas com pictogramas', sal: 53,
  descricao: 'templo antigo partido — piso elevado, escadaria, colunas inteiras, partidas e caídas, parede do fundo com um pictograma gravado — e, debaixo do piso, uma câmara enterrada com três pictogramas e o baú de ruína',
  celula: 640, chance: 0.4, busca: 64, passo: 4, melhorDe: 6, raio: 16,
  raridade: 'uma a cada ~1,5–2 km² de chão aberto e plano (no deserto, de arenito)',
  podeNascer, gerar,
});
