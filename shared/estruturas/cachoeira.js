// Kraft — caverna atrás da cachoeira (pedido do Kadmus, 19/11/2026). Puro e determinístico (shared/estruturas.js).
//
// Onde nasce: num paredão natural — planalto contínuo atrás, chão quase plano na frente, 9 a 26 m de queda, acima do
// mar, fora de deserto, savana, neve, praia e oceano.
// Como é (vista de lado, v = para fora do paredão):
//   · no alto, um olho d'água (fontes) num rebaixo do planalto, com uma bica na beira: a lei da água (shared/water.js)
//     faz a corrente passar pela bica e cair como uma cortina de 3 ou 5 m de largura, rente à rocha molhada (basalto);
//   · embaixo, um poço de fontes rebaixado um bloco no gramado, com margem fechada (a água espalhada pela queda fica
//     dentro dele), juncos, samambaias e pedras;
//   · atrás da cortina, um vão de 4 m de altura escavado no pé do paredão (a laje de cima é o beiral de onde a água cai)
//     com piso de pedra seco: entra-se pelo lado da cortina e passa-se por trás dela;
//   · no fundo do vão, a boca de uma galeria que leva a um salão em domo com lago, cristais que brilham, estalactites,
//     às vezes uma fresta de luz coberta por uma moita lá em cima, e um baú.
import { B, KIND, K_CUBE, NATURAL } from '../blocks.js';
import { BIOME } from '../worldgen.js';
import {
  planta_, olhoLivre, criarPlanta, ruido2, ruido3, rng, sorte, semear, cavarBolha, cavarGaleria, formacao, cristais, paredeNaDirecao,
  estabilizar, sementeDoSitio, FRENTE, ESSENCIAL, MOLDE, MOLDE_OK, POSTE, TRES_QUARTOS, SEA, Y_TOP,
} from '../estruturas.js';

const PROIBIDOS = new Set([BIOME.OCEAN, BIOME.BEACH, BIOME.DESERT, BIOME.SAVANNA, BIOME.SNOW]);
const suave = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const SOLO = new Set([B.GRASS, B.DIRT, B.SAND, B.GRAVEL, B.CLAY, B.SNOW]);
// rocha em estratos: camadas finas e onduladas de basalto na pedra, contínuas ao longo da parede
const rocha = (x, y, z, s) => {
  const n = y + Math.floor(ruido2(x * 0.07, z * 0.07, s + 70) * 4), k = ((n % 8) + 8) % 8, f = ruido2(x * 0.16, z * 0.16, s + 71);
  return k === 0 && f > 0.38 ? B.SANDSTONE : k === 4 && f > 0.55 ? B.CLAY : B.STONE;   // estratos que vêm e somem
};

export function podeNascer(ctx, x, z) {
  if (PROIBIDOS.has(ctx.bioma(x, z))) return null;
  const H = ctx.height;
  let melhor = null;
  for (let rot = 0; rot < 4; rot++) {
    const [ox, oz] = FRENTE[rot], ax = -oz, az = ox;
    const at = (u, v) => H(x + u * ax + v * ox, z + u * az + v * oz);
    const hb = at(0, -3);
    if (hb - at(0, 7) < 8) continue;                                     // atalho: sem queda, nem olha o resto
    let ok = true, tmax = hb;
    for (let u = -5; u <= 5 && ok; u++) { const h = at(u, -3); if (Math.abs(h - hb) > 3) ok = false; if (h > tmax) tmax = h; }
    if (!ok) continue;                                                   // a beira do alto é contínua ao longo da frente
    const pes = [];
    for (let u = -5; u <= 5; u++) for (let v = 5; v <= 9; v++) pes.push(at(u, v));
    pes.sort((a, b) => a - b);
    const espalho = pes[pes.length - 1] - pes[0];
    if (espalho > 5) continue;                                           // chão sem grande desnível na frente
    const yb = pes[Math.floor(pes.length * 0.3)], alto = hb - yb;
    if (alto < 8 || alto > 26 || yb < SEA + 2 || tmax + 8 >= Y_TOP) continue;
    // a encosta de verdade deve passar perto de v = 0 (meia altura entre v = −1 e v = 2)
    const meio = yb + alto / 2, h0 = at(0, -1), h1 = at(0, 2);
    const nota = alto - espalho * 1.5 - (h0 < meio ? 4 : 0) - (h1 > meio ? 4 : 0);
    if (!melhor || nota > melhor.nota) melhor = { rot, yb, alto, nota };
  }
  if (!melhor) return null;
  return { tipo: 'cachoeira', x, y: melhor.yb, z, rot: melhor.rot, alto: melhor.alto, nota: melhor.nota, semente: sementeDoSitio(ctx, 'cachoeira', x, z) };
}

export function gerar(ctx, s) {
  const yb = s.y, Ht = yb + s.alto, S = s.semente & 0x7fffffff;
  const P = criarPlanta(ctx, { tipo: 'cachoeira', ancora: [s.x, yb, s.z], rot: s.rot, semente: s.semente, nome: CACHOEIRA.nome });
  const r = rng(s.semente);
  const cw = s.alto >= 12 ? 2 : 1;          // meia-largura da cortina d'água (3 ou 5 m)
  const hAlc = 4;                           // altura do vão atrás da água
  const AL = cw + 2;                        // meia-largura do vão
  // queda alta: dois lances — a água bate num degrau de rocha (yL) e cai de novo um bloco mais longe da parede (vQ = 2)
  const degrau = s.alto >= 12, vQ = degrau ? 2 : 1;
  const yL = degrau ? yb + hAlc + 1 + Math.max(2, Math.round((s.alto - hAlc - 1) * 0.4)) : -Infinity;
  const V0 = -9, V1 = 12, UB = AL + 8, UM = UB + 6;
  const L = P.L;
  const xz = (u, v) => { const p = L(u, 0, v); return [p[0], p[2]]; };
  const Hn = (u, v) => { const [x, z] = xz(u, v); return ctx.height(x, z); };
  const topoNat = (u, v) => { const [x, z] = xz(u, v); return ctx.natural(x, ctx.height(x, z), z); };

  // 1) anfiteatro: o chão (yb) ocupa v ≥ vb(u) — reto atrás da água, em ferradura dos lados, aberto para a frente
  const vb = (u) => {
    const au = Math.abs(u);
    if (au <= AL + 1) return 1;
    const e = au - AL - 1;
    return 1 + 0.3 * e * e + Math.round((ruido2(u * 0.37, 5.1, S) - 0.5) * 2.4);
  };
  const chao = (u, v) => Math.abs(u) <= UB && v >= vb(u) && v <= V1;
  const nascente = (u, v) => Math.abs(u) <= AL && v >= -5 && v <= 0;      // alto plano em volta do olho d'água
  const k2 = (u, v) => (u + 64) * 128 + (v + 64);
  // distância (em colunas, 4 vizinhos) até o chão e até o alto da nascente, para a rocha baixar devagar por fora
  const distancia = (fonte) => {
    const d = new Map(), fila = [];
    for (let u = -UM; u <= UM; u++) for (let v = V0 - 3; v <= V1 + 3; v++) if (fonte(u, v)) { d.set(k2(u, v), 0); fila.push([u, v]); }
    for (let i = 0; i < fila.length; i++) {
      const [u, v] = fila[i], n = d.get(k2(u, v));
      if (n >= 6) continue;
      for (const [eu, ev] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = k2(u + eu, v + ev);
        if (d.has(q) || Math.abs(u + eu) > UM || v + ev < V0 - 3 || v + ev > V1 + 3) continue;
        d.set(q, n + 1); fila.push([u + eu, v + ev]);
      }
    }
    return (u, v) => d.get(k2(u, v)) ?? 99;
  };
  const dChao = distancia(chao), dAlto = distancia(nascente);
  const alvo = new Map();
  for (let u = -UM; u <= UM; u++) for (let v = V0; v <= V1 + 2; v++) {
    const hn = Hn(u, v);
    let a = hn;
    if (chao(u, v)) {
      a = yb;
      if (v > V1 - 3) a = Math.round(yb + (hn - yb) * (v - (V1 - 3)) / 3);   // a frente se mistura com a encosta
    } else {
      const parede = Ht - Math.max(0, v - 1) * (Ht - yb) / (V1 - 1);         // as paredes baixam para a frente
      const porChao = dChao(u, v) <= 5 ? parede - (dChao(u, v) - 1) : -Infinity;
      const porAlto = nascente(u, v) ? Ht : dAlto(u, v) <= 5 ? Ht - dAlto(u, v) : -Infinity;
      const t = Math.min(Ht, Math.round(Math.max(porChao, porAlto)));
      if (t > hn) a = t;
    }
    alvo.set(k2(u, v), a);
  }
  const alvoDe = (u, v) => alvo.get(k2(u, v)) ?? Hn(u, v);
  // célula exposta: alguma coluna vizinha (4 lados) fica abaixo dela
  const exposta = (u, y, v) => alvoDe(u + 1, v) < y || alvoDe(u - 1, v) < y || alvoDe(u, v + 1) < y || alvoDe(u, v - 1) < y;

  // 2) molda as colunas (chão, paredes e o alto da nascente são essenciais: árvore ali recusa o lugar; a rampa de
  // fora das paredes é enfeite: árvore ali só fica com o seu chão)
  for (let u = -UM; u <= UM; u++) for (let v = V0; v <= V1 + 2; v++) {
    const [x, z] = xz(u, v), hn = Hn(u, v), a = alvoDe(u, v);
    if (a === hn && !chao(u, v) && dChao(u, v) > 1) continue;
    const F = chao(u, v) || dChao(u, v) <= 2 || nascente(u, v) ? ESSENCIAL : 0;
    let topo = topoNat(u, v);
    if (!MOLDE_OK[topo] || topo === B.SAND) topo = B.GRASS;
    const sub = topo === B.GRASS ? B.DIRT : topo;
    if (a > hn) {
      for (let y = hn; y <= a; y++) {
        const exp = exposta(u, y, v);
        const b = y === a ? topo : exp ? rocha(x, y, z, S) : y >= a - 2 ? sub : rocha(x, y, z, S);
        P.por(x, y, z, b, y === a && MOLDE_OK[b] ? MOLDE : 0, F);
      }
    } else if (a < hn) {
      for (let y = a + 1; y <= hn + 1; y++) P.cavar(x, y, z, F);
      P.por(x, a, z, topo, MOLDE, F);
      if (topo === B.GRASS) for (let y = a - 2; y < a; y++) P.por(x, y, z, B.DIRT, 0, F);
    }
    // parede é rocha: o solo que ficou exposto abaixo do topo vira pedra (com estratos de basalto)
    for (let y = Math.min(yb, a) + 1; y <= a - 1; y++) {
      const b = P.ler(x, y, z);
      if (SOLO.has(b) && exposta(u, y, v)) P.por(x, y, z, rocha(x, y, z, S), 0, F);
    }
  }

  // 3) paredes vivas: saliências, beira recortada, pedras no chão (longe da água e do vão)
  const parede1 = (u, v) => !chao(u, v) && dChao(u, v) === 1;
  for (let u = -UB; u <= UB; u++) for (let v = 1; v <= V1; v++) {
    if (!chao(u, v) || Math.abs(u) <= AL + 1 && v <= 2) continue;
    for (const [eu, ev] of [[1, 0], [-1, 0], [0, -1]]) {
      if (!parede1(u + eu, v + ev)) continue;
      const topo = alvoDe(u + eu, v + ev), [x, z] = xz(u, v);
      for (let y = yb + 2; y <= topo - 2; y++) {
        if (ruido3(x * 0.21, y * 0.34, z * 0.21, S + 2) < 0.7) continue;
        if (P.ler(x, y, z) !== B.AIR) continue;
        P.por(x, y, z, rocha(x, y, z, S), 0);
        if (P.ler(x, y + 1, z) === B.AIR && sorte(S, x, y, z) < 0.5) P.por(x, y + 1, z, sorte(S, x, y, z, 1) < 0.6 ? B.FERN : B.TALL_GRASS, 0);
      }
    }
  }
  for (let u = -UB; u <= UB; u++) for (let v = V0; v <= V1; v++) {
    if (!parede1(u, v) || Math.abs(u) <= AL + 1) continue;
    const a = alvoDe(u, v), [x, z] = xz(u, v);
    if (a >= yb + 4 && ruido2(x * 0.7, z * 0.7, S + 1) > 0.68) P.ar(x, a, z);
  }

  // 4) olho d'água no alto + bica + rocha molhada atrás da cortina
  for (let u = -cw; u <= cw; u++) {
    for (let v = -3; v <= 0; v++) {
      const [x, z] = xz(u, v);
      for (let y = Ht + 1; y <= Math.max(Ht + 1, Hn(u, v) + 1); y++) P.cavar(x, y, z, ESSENCIAL);   // planalto mais alto: abre um rego
      if (v < 0) {
        P.por(x, Ht, z, B.WATER, 0, ESSENCIAL);
        P.por(x, Ht - 1, z, sorte(S, x, z, 1) < 0.3 ? B.CLAY : B.GRAVEL, 0, ESSENCIAL);
        P.fontes.push([x, Ht, z]);
      } else {
        P.ar(x, Ht, z, ESSENCIAL);
        P.por(x, Ht - 1, z, B.BASALT, 0, ESSENCIAL);
      }
    }
    for (let y = yb + hAlc + 1; y < Ht - 1; y++) { const [x, z] = xz(u, 0); P.por(x, y, z, B.BASALT, 0, ESSENCIAL); }
  }
  // margens do olho d'água e da bica: sempre firmes (a água não escapa pelo lado)
  for (const u of [-cw - 1, cw + 1]) for (let v = -3; v <= 0; v++) { const [x, z] = xz(u, v); if (!P.cheio(x, Ht, z)) P.por(x, Ht, z, B.STONE, 0, ESSENCIAL); if (!P.cheio(x, Ht - 1, z)) P.por(x, Ht - 1, z, B.STONE, 0, ESSENCIAL); }
  for (let u = -cw; u <= cw; u++) { const [x, z] = xz(u, -4); if (!P.cheio(x, Ht, z)) P.por(x, Ht, z, B.STONE, 0, ESSENCIAL); }
  // caminho da água: livre de cima até o poço (no degrau, o lance de baixo cai em vQ = 2)
  for (let u = -cw; u <= cw; u++) {
    for (let y = degrau ? yL + 1 : yb; y <= Ht; y++) { const [x, z] = xz(u, 1); P.ar(x, y, z, ESSENCIAL); }
    if (degrau) for (let y = yb; y <= yL + 1; y++) { const [x, z] = xz(u, 2); P.ar(x, y, z, ESSENCIAL); }
  }
  if (degrau) {
    // o degrau: laje de rocha em v = 1 do teto do vão até yL (basalto molhado atrás da água), com bordas que seguram
    // a água no meio (ela só sai pela frente)
    for (let u = -AL - 1; u <= AL + 1; u++) for (let y = yb + hAlc + 1; y <= yL; y++) {
      const [x, z] = xz(u, 1);
      P.por(x, y, z, Math.abs(u) <= cw + 1 ? B.BASALT : rocha(x, y, z, S), 0, ESSENCIAL);
    }
    for (const u of [-cw - 1, cw + 1]) { const [x, z] = xz(u, 1); P.por(x, yL + 1, z, B.STONE, 0, ESSENCIAL); }
  }
  if (cw >= 2) { const [x, z] = xz(0, 0); P.por(x, Ht, z, B.STONE, 0, ESSENCIAL); }   // pedra no meio da bica: dois fios

  // 5) poço embaixo: rebaixado um bloco no chão (yb), margem fechada, fundo de cascalho e areia
  const pu = cw + 3.2, pv = 2.6, pc = vQ + 2.2;
  for (let u = -Math.ceil(pu) - 1; u <= Math.ceil(pu) + 1; u++) for (let v = 0; v <= 8; v++) {
    const du = u / pu, dv = (v - pc) / pv, d = du * du + dv * dv + (ruido2(u * 0.6, v * 0.6, S + 3) - 0.5) * 0.35;
    const debaixo = Math.abs(u) <= cw && v === vQ;
    if (d > 1 && !debaixo) continue;
    if (v < vQ) continue;
    const [x, z] = xz(u, v), fundo = d < 0.45 || debaixo ? 2 : 1;
    P.ar(x, yb, z, ESSENCIAL);
    for (let k = 1; k <= fundo; k++) { P.por(x, yb - k, z, B.WATER, 0, ESSENCIAL); P.fontes.push([x, yb - k, z]); }
    P.por(x, yb - fundo - 1, z, sorte(S, x, z, 2) < 0.5 ? B.GRAVEL : sorte(S, x, z, 3) < 0.5 ? B.SAND : B.CLAY, 0, ESSENCIAL);
  }
  // margem: todo vizinho do poço no nível yb − 1 e yb fica firme (a água espalhada pela queda não sai dali)
  for (let u = -Math.ceil(pu) - 2; u <= Math.ceil(pu) + 2; u++) for (let v = 0; v <= 9; v++) {
    const [x, z] = xz(u, v);
    if (P.ler(x, yb - 1, z) === B.WATER) continue;
    for (const [eu, ev] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [nx, nz] = xz(u + eu, v + ev);
      if (P.ler(nx, yb - 1, nz) !== B.WATER) continue;
      for (const y of [yb - 1, yb]) if (!P.cheio(x, y, z)) P.por(x, y, z, y === yb ? B.GRASS : B.DIRT, y === yb ? MOLDE : 0, ESSENCIAL);
      break;
    }
  }

  // 6) vão atrás da cortina, com piso de pedra seco
  for (let u = -AL; u <= AL; u++) for (let v = -1; v <= vQ - 1; v++) {
    const [x, z] = xz(u, v);
    for (let y = yb + 1; y <= yb + hAlc; y++) P.ar(x, y, z, ESSENCIAL);
    P.por(x, yb, z, B.STONE, 0, ESSENCIAL);
    if (!P.cheio(x, yb + hAlc + 1, z)) P.por(x, yb + hAlc + 1, z, rocha(x, yb + hAlc + 1, z, S), 0, ESSENCIAL);
    for (let y = yb - 1; y >= yb - 3; y--) if (!P.cheio(x, y, z)) P.por(x, y, z, B.STONE, 0, ESSENCIAL);
  }
  // fundo do vão irregular (sem tocar a boca)
  for (let u = -AL; u <= AL; u++) {
    if (Math.abs(u) <= 1) continue;
    for (let y = yb + 1; y <= yb + hAlc - 1; y++) if (ruido3(u * 0.5, y * 0.5, 9.1, S + 4) > 0.62) { const [x, z] = xz(u, -2); P.cavar(x, y, z); }
  }

  // 7) galeria e salão
  const R = 5 + (s.alto >= 16 ? 1 : 0) + (r() < 0.4 ? 1 : 0), RY = 4.5;
  const hu = Math.round((r() - 0.5) * 4), hv = -(7 + R);
  let hmin = Infinity;
  for (let u = hu - R - 1; u <= hu + R + 1; u++) for (let v = hv - R - 1; v <= hv + R + 1; v++) hmin = Math.min(hmin, Hn(u, v));
  const yf = Math.min(yb, hmin - 11);
  if (yf < yb - 6 || yf < ctx.yMin + 6) return null;
  const pontos = [[0, yb, -1.5], [0.4, yb, -4], [hu * 0.6, (yb + yf) / 2, -6], [hu, yf, hv + R * 0.6]].map(([u, y, v]) => { const p = L(u, 0, v); return [p[0] + 0.5, y, p[2] + 0.5]; });
  cavarGaleria(P, pontos, { r: 1.25, alt: 3, s: S + 5 });
  const [hx, , hz] = L(hu, 0, hv), cx = hx + 0.5, cz = hz + 0.5;
  cavarBolha(P, [cx, yf + RY * 0.55, cz], [R, RY, R * 0.85], { chao: yf, amp: 0.3, s: S + 6 });
  P.notas.push(`salão em ${hx} ${yf + 1} ${hz}, raio ${R}`);

  // lago no fundo do salão
  const [lx, , lz] = L(hu + Math.round((r() - 0.5) * 3), 0, hv - Math.round(R * 0.45));
  const lr = 2.2 + r() * 1;
  for (let ex = -4; ex <= 4; ex++) for (let ez = -4; ez <= 4; ez++) {
    const x = lx + ex, z = lz + ez, d = (ex * ex + ez * ez) / (lr * lr) + (ruido2(x * 0.5, z * 0.5, S + 7) - 0.5) * 0.4;
    if (d > 1 || !P.vazio(x, yf + 1, z)) continue;
    const fundo = d < 0.4 ? 2 : 1;
    let cercado = true;                                   // só onde a borda do lago é rocha (a água não foge pela galeria)
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = P.ler(x + nx, yf, z + nz); if (!(b === B.WATER || P.cheio(x + nx, yf, z + nz))) cercado = false; }
    if (!cercado) continue;
    for (let k = 0; k < fundo; k++) { P.por(x, yf - k, z, B.WATER, 0, ESSENCIAL); P.fontes.push([x, yf - k, z]); }
    P.por(x, yf - fundo, z, d < 0.5 ? B.SAND : B.GRAVEL, 0);
  }

  // cristais nas paredes e no teto, estalactites, umas estalagmites
  const centro = [Math.floor(cx), yf + 2, Math.floor(cz)];
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1]];
  const usados = new Set();
  for (let i = 0; i < 4; i++) {
    let k = Math.floor(r() * dirs.length); while (usados.has(k)) k = (k + 1) % dirs.length; usados.add(k);
    const d = dirs[k], alt = yf + 1 + Math.floor(r() * 3);
    const w = paredeNaDirecao(P, centro[0], alt, centro[2], [Math.sign(d[0]), 0, Math.sign(d[2])]);
    if (w) cristais(P, ...w.celula, w.n, { s: S + 20 + i, tam: 3 + Math.floor(r() * 3) });
  }
  const tetoC = paredeNaDirecao(P, centro[0] + 1, yf + 2, centro[2] - 1, [0, 1, 0]);
  if (tetoC) cristais(P, ...tetoC.celula, tetoC.n, { s: S + 31, tam: 4 });
  for (let i = 0; i < 7; i++) {
    const x = Math.floor(cx + (r() - 0.5) * R * 1.4), z = Math.floor(cz + (r() - 0.5) * R * 1.2);
    if (!P.vazio(x, yf + 1, z)) continue;
    let yt = yf + 1; while (yt < yf + 12 && P.vazio(x, yt, z)) yt++;
    if (yt - yf < 4) continue;
    formacao(P, x, yt - 1, z, 1 + Math.floor(r() * 3), { desce: true, mat: r() < 0.7 ? B.MARBLE : B.SANDSTONE, s: S + 40 + i });
  }
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(cx + (r() - 0.5) * R * 1.5), z = Math.floor(cz + (r() - 0.5) * R * 1.3);
    if (!P.vazio(x, yf + 1, z) || P.ler(x, yf, z) === B.WATER || !P.cheio(x, yf, z)) continue;
    formacao(P, x, yf + 1, z, 1 + Math.floor(r() * 2), { desce: false, mat: B.MARBLE, s: S + 50 + i });
  }

  // fresta de luz até o planalto, tampada por uma moita (às vezes)
  if (r() < 0.6) {
    const fx = Math.floor(cx + (r() - 0.5) * 3), fz = Math.floor(cz + (r() - 0.5) * 3);
    let y = yf + 1; while (y < Ht + 30 && P.vazio(fx, y, fz)) y++;
    const hs = P.topo(fx, fz, Math.max(ctx.height(fx, fz), Ht) + 8);
    if (hs - y < 14 && hs > y) {
      for (let yy = y; yy < hs; yy++) P.cavar(fx, yy, fz);
      P.por(fx, hs, fz, B.LEAVES, 0);
      if (P.ler(fx, hs + 1, fz) !== B.AIR && !P.cheio(fx, hs + 1, fz)) P.ar(fx, hs + 1, fz);
      for (const [ex, ez] of [[1, 0], [0, 1], [-1, 0]]) if (sorte(S, fx + ex, fz + ez, 9) < 0.6 && P.ler(fx + ex, hs + 1, fz + ez) === B.AIR && P.cheio(fx + ex, hs, fz + ez)) P.por(fx + ex, hs + 1, fz + ez, B.LEAVES, 0);
      P.notas.push(`fresta de luz em ${fx} ${hs} ${fz}`);
    }
  }

  // 8) vida: juncos e samambaias na beira do poço e ao pé das paredes, pedras arredondadas, trepadeiras penduradas
  const temAgua = (u, v, r) => { for (let e = -r; e <= r; e++) for (let f = -r; f <= r; f++) { const [qx, qz] = xz(u + e, v + f); if (P.ler(qx, yb - 1, qz) === B.WATER) return true; } return false; };
  const pePared = (u, v) => [[1, 0], [-1, 0], [0, -1], [0, 1]].some(([e, f]) => parede1(u + e, v + f));
  for (let i = 0; i < 5; i++) {                            // afloramentos de pedra rentes ao chão
    const u = Math.round((r() - 0.5) * 2 * (AL + 4)), v = vQ + 2 + Math.floor(r() * 8);
    for (const [e, f] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0]]) {
      if (r() < 0.35) continue;
      const [x, z] = xz(u + e, v + f), y = alvoDe(u + e, v + f);
      if (!chao(u + e, v + f) || temAgua(u + e, v + f, 0) || P.ler(x, y, z) !== B.GRASS) continue;
      P.por(x, y, z, B.STONE, MOLDE);
      if (planta_(P.ler(x, y + 1, z))) P.ar(x, y + 1, z);
    }
  }
  for (let u = -UB; u <= UB; u++) for (let v = 1; v <= V1; v++) {
    if (!chao(u, v)) continue;
    const [x, z] = xz(u, v), y = alvoDe(u, v);
    if (P.ler(x, y, z) !== B.GRASS || P.ler(x, y + 1, z) !== B.AIR) continue;
    const t = sorte(S, x, z, 5);
    if (temAgua(u, v, 2)) P.por(x, y + 1, z, t < 0.4 ? B.REEDS : t < 0.62 ? B.FERN : t < 0.68 ? B.FLOWER_BLUE : t < 0.8 ? B.TALL_GRASS : B.AIR, 0);
    else if (pePared(u, v)) P.por(x, y + 1, z, t < 0.45 ? B.FERN : t < 0.6 ? B.TALL_GRASS : B.AIR, 0);
    else if (t < 0.14) P.por(x, y + 1, z, t < 0.05 ? B.FERN : t < 0.07 ? B.FLOWER_BLUE : B.TALL_GRASS, 0);
  }
  for (let u = -UB; u <= UB; u++) for (let v = 1; v <= V1; v++) {   // trepadeiras: da beira da parede para baixo
    if (!chao(u, v) || Math.abs(u) <= AL + 1 && v <= 2 || sorte(S, u, v, 77) > 0.3) continue;
    for (const [e, f] of [[1, 0], [-1, 0], [0, -1]]) {
      if (!parede1(u + e, v + f)) continue;
      const topo = alvoDe(u + e, v + f), [x, z] = xz(u, v), [bx, bz] = xz(u + e, v + f), comp = 2 + Math.floor(sorte(S, u, v, 78) * 4);
      for (let k = 1; k <= comp; k++) {
        const y = topo - k + 1;
        if (y <= yb + 2 || P.ler(x, y, z) !== B.AIR || !P.cheio(bx, y, bz)) break;
        P.por(x, y, z, B.LEAVES, 0);
      }
      break;
    }
  }
  // samambaias no vão (a sombra úmida atrás da água)
  for (const u of [-AL, AL]) { const [x, z] = xz(u, -1); if (P.ler(x, yb + 1, z) === B.AIR) P.por(x, yb + 1, z, B.FERN, 0); }

  // 9) baú no salão, na beira do lago, longe da galeria
  let melhor = null;
  for (let ex = -R; ex <= R; ex++) for (let ez = -R; ez <= R; ez++) {
    const x = Math.floor(cx) + ex, z = Math.floor(cz) + ez, y = yf + 1;
    if (P.ler(x, y, z) !== B.AIR || !P.cheio(x, y - 1, z) || P.ler(x, y - 1, z) === B.WATER || !P.vazio(x, y + 1, z)) continue;
    let agua = 0, parede = 0;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { if (P.ler(x + nx, yf, z + nz) === B.WATER) agua++; if (P.cheio(x + nx, y, z + nz)) parede++; }
    const [ex0, , ez0] = L(0, 0, -2), dg = Math.abs(x - ex0) + Math.abs(z - ez0);
    const nota = dg + (agua ? 6 : 0) + (parede ? 3 : 0) - (parede > 1 ? 8 : 0);
    if (!melhor || nota > melhor.nota) melhor = { x, y, z, nota };
  }
  if (melhor) {
    P.ar(melhor.x, melhor.y, melhor.z, ESSENCIAL);
    P.baus.push({ x: melhor.x, y: melhor.y, z: melhor.z, nivel: 'fundo', i: 0 });
  }

  P.entrada = L(0, yb + 1, -1);
  // pontos de vista para fotos e para o GM (de, para): de fora, de trás da água e de dentro do salão
  const c = (q) => [q[0] + 0.5, q[1], q[2] + 0.5];
  P.vista = { de: c(L(Math.round(AL * 0.7), yb + 3, 11)), para: c(L(0, yb + s.alto * 0.4, 0)) };
  P.vistas = {
    fora: { de: olhoLivre(P, P.vista.de), para: P.vista.para },
    atras: { de: c(L(-AL + 1, yb + 2.6, -0.5)), para: c(L(1, yb + 2, vQ + 3)) },
    dentro: { de: c(L(hu, yf + 2.8, hv + R * 0.3)), para: c(L(hu, yf + 1.3, hv - R * 0.6)) },
  };
  estabilizar(P);
  return P;
}

export const CACHOEIRA = Object.freeze({
  chave: 'cachoeira', nome: 'Caverna atrás da cachoeira', sal: 11,
  descricao: 'paredão com olho d\'água no alto e cortina caindo num poço; atrás da água, um vão seco e a boca de um salão com lago e cristais',
  celula: 512, chance: 0.45, busca: 64, passo: 3, melhorDe: 24, raio: 24,
  raridade: 'uma a cada ~2–4 km² de serra (precisa de paredão de 9–26 m; fora de deserto, savana, neve e praia)',
  podeNascer, gerar,
});
