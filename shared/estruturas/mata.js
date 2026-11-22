// Kraft — caverna escondida na mata (pedido do Kadmus, 19/11/2026). Puro e determinístico (shared/estruturas.js).
//
// Onde nasce: numa encosta de floresta (bioma floresta ou taiga) com mata fechada em volta (pelo menos 5 árvores a até
// 14 m), a boca a 3 m ou mais de qualquer tronco, terra cobrindo a boca (a encosta sobe atrás dela).
// Como é: uma boca pequena (2 × 3) no barranco, quase escondida entre moitas, samambaias e pedras, com raízes de
// tronco penduradas na frente; dela desce uma galeria torta, em degraus naturais (o chão que fica é terreno de verdade
// e ganha rampa), até um salão abaixo das raízes da mata: raízes atravessando o teto, um poço, cristais que brilham,
// uma fresta de luz tampada por uma moita lá em cima, uma pintura rupestre em ocre (caçada ou mãos) e um baú.
import { B } from '../blocks.js';
import { BIOME } from '../worldgen.js';
import { nivelPorProfundidade } from '../tesouros.js';
import {
  criarPlanta, ruido2, rng, sorte, cavarBolha, cavarGaleria, formacao, cristais, paredeNaDirecao, estabilizar,
  sementeDoSitio, planta_, olhoLivre, FRENTE, ESSENCIAL, MOLDE, MOLDE_OK, POSTE, Y_TOP, SEA,
} from '../estruturas.js';
import { montarPainel } from './pictogramas.js';

const MATAS = new Set([BIOME.FOREST, BIOME.TAIGA]);

export function podeNascer(ctx, x, z) {
  if (!MATAS.has(ctx.bioma(x, z))) return null;
  const H = ctx.height, h0 = H(x, z);
  if (h0 < SEA + 4 || h0 + 12 >= Y_TOP) return null;
  // árvores: mata fechada em volta, mas nenhum tronco a menos de 3 m da boca
  let perto = 0, cola = false;
  for (const t of ctx.arvores(x - 14, z - 14, x + 14, z + 14)) {
    if (t.kind !== 0 && t.kind !== 1) continue;
    const d2 = (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z);
    if (d2 <= 196) perto++;
    if (d2 < 10) cola = true;
  }
  if (perto < 5 || cola) return null;
  let melhor = null;
  for (let rot = 0; rot < 4; rot++) {
    const [ox, oz] = FRENTE[rot], ax = -oz, az = ox;
    const at = (u, v) => H(x + u * ax + v * ox, z + u * az + v * oz);
    const sobe = at(0, -4) - at(0, 4);
    if (sobe < 3 || sobe > 11) continue;                                 // encosta, não paredão nem chão plano
    if (at(0, -3) < h0 + 4) continue;                                     // terra por cima da boca
    if (Math.abs(at(-3, 0) - h0) > 2 || Math.abs(at(3, 0) - h0) > 2) continue;   // não é crista nem grota
    if (at(0, 2) > h0 || at(0, 4) > h0 + 1) continue;                     // a frente desce (a boca olha para baixo)
    const nota = perto + Math.min(sobe, 8);
    if (!melhor || nota > melhor.nota) melhor = { rot, nota };
  }
  if (!melhor) return null;
  return { tipo: 'mata', x, y: h0, z, rot: melhor.rot, nota: melhor.nota, semente: sementeDoSitio(ctx, 'mata', x, z) };
}

export function gerar(ctx, s) {
  const h0 = s.y, S = s.semente & 0x7fffffff;
  const P = criarPlanta(ctx, { tipo: 'mata', ancora: [s.x, h0, s.z], rot: s.rot, semente: s.semente, nome: MATA.nome });
  const r = rng(s.semente), L = P.L;
  const xz = (u, v) => { const p = L(u, 0, v); return [p[0], p[2]]; };
  const Hn = (u, v) => { const [x, z] = xz(u, v); return ctx.height(x, z); };
  const c = (q) => [q[0] + 0.5, q[1], q[2] + 0.5];

  // 1) salão: fundo o bastante para o teto ter rocha (e raízes) por cima, longe dos troncos (a regra das árvores confere)
  const lado = r() < 0.5 ? -1 : 1;                      // para que lado a galeria entorta
  const R = 4.5 + r() * 1.5, RY = 3.4 + r() * 0.6;
  const hu = lado * (3 + Math.floor(r() * 3)), hv = -(12 + Math.floor(r() * 4));
  let hmin = Infinity;
  for (let u = hu - 7; u <= hu + 7; u++) for (let v = hv - 7; v <= hv + 7; v++) hmin = Math.min(hmin, Hn(u, v));
  const yf = Math.min(h0 - 6, hmin - Math.ceil(RY * 2) - 6);
  if (yf < ctx.yMin + 6 || h0 - yf > 22) return null;

  // 2) boca: 2 de largura e 3 de altura, cavada no barranco; a galeria desce em curva até o salão
  const arco = lado > 0 ? 1 : 0;                       // a fileira de cima é só meia boca (arco torto)
  for (let u = 0; u <= 1; u++) for (let v = -3; v <= 1; v++) {
    const [x, z] = xz(u, v);
    for (let y = h0 + 1; y <= h0 + 3; y++) if (y < h0 + 3 || u === arco || v < -1) P.cavar(x, y, z, ESSENCIAL);
    if (v <= 0 && !P.cheio(x, h0, z)) P.por(x, h0, z, B.STONE, 0, ESSENCIAL);
  }
  const passo = (h0 - yf) / 4;
  const pontos = [
    [0.5, h0, -2], [0.5 + lado * 0.6, h0 - passo * 0.6, -5], [lado * 2.2, h0 - passo * 1.6, -7.5],
    [hu * 0.8, h0 - passo * 2.8, hv + 4.5], [hu, yf, hv + R * 0.4],
  ].map(([u, y, v]) => { const p = L(u, 0, v); return [p[0] + 0.5, Math.round(y), p[2] + 0.5]; });
  cavarGaleria(P, pontos, { r: 1.1, alt: 3, amp: 0.3, s: S + 1 });
  const [hx, , hz] = L(hu, 0, hv), cx = hx + 0.5, cz = hz + 0.5;
  cavarBolha(P, [cx, yf + RY * 0.6, cz], [R, RY, R * 0.9], { chao: yf, amp: 0.3, s: S + 2 });
  P.notas.push(`salão em ${hx} ${yf + 1} ${hz}`);

  // 3) esconderijo: moitas dos dois lados e em cima da boca, samambaias e pedras na frente, raízes penduradas
  const chao = (u, v) => { const [x, z] = xz(u, v); return P.topo(x, z, Hn(u, v) + 4, Hn(u, v) - 6); };
  const moita = (u, v, alt) => {
    const [x, z] = xz(u, v), y0 = chao(u, v) + 1;
    for (let k = 0; k < alt; k++) if (P.ler(x, y0 + k, z) === B.AIR || planta_(P.ler(x, y0 + k, z))) P.por(x, y0 + k, z, B.LEAVES, 0);
  };
  for (const [u, v, a] of [[-1, 0, 2], [-1, 1, 1], [-2, 0, 1], [2, 0, 2], [2, 1, 1], [3, -1, 1], [-1, -1, 2], [2, -1, 2]]) if (r() < 0.85) moita(u, v, a);
  for (let u = -1; u <= 2; u++) {                       // moita por cima da boca, caindo na frente
    const [x, z] = xz(u, 0), y = h0 + 4;
    if (P.ler(x, y, z) === B.AIR && P.cheio(...L(u, y, -1))) P.por(x, y, z, B.LEAVES, 0);
    const [x2, z2] = xz(u, -1), t = chao(u, -1);
    if (P.ler(x2, t + 1, z2) === B.AIR && r() < 0.7) P.por(x2, t + 1, z2, B.LEAVES, 0);
  }
  for (const u of [0, 1]) {                             // raízes penduradas da beira de cima (uma de cada lado)
    if (r() < 0.35) continue;
    const [x, z] = xz(u * 3 - 1, 1);
    for (let y = h0 + 3; y >= h0 + 2; y--) if (P.ler(x, y, z) === B.AIR && (P.cheio(x, y + 1, z) || P.ler(x, y + 1, z) === B.ROOT)) P.por(x, y, z, B.ROOT, 0);
  }
  for (let u = -3; u <= 4; u++) for (let v = 1; v <= 4; v++) {
    const [x, z] = xz(u, v), y = chao(u, v);
    if (P.ler(x, y + 1, z) !== B.AIR || !MOLDE_OK[P.ler(x, y, z)]) continue;
    const t = sorte(S, x, z, 3);
    if (t < 0.4) P.por(x, y + 1, z, B.FERN, 0);
    else if (t < 0.5) P.por(x, y, z, B.STONE, MOLDE);             // pedra rente ao chão
    else if (t < 0.56) P.por(x, y + 1, z, B.TALL_GRASS, 0);
  }

  // 4) salão: raízes atravessando o teto, poço, cristais, estalactites curtas
  // raiz pendurada: poste de mini-bloco de tronco (meio metro), mudando de canto a cada metro como raiz torta
  const raiz = (x, z) => {
    let y = yf + 1; while (y < yf + 14 && P.vazio(x, y, z)) y++;
    if (y - yf < 4) return;
    const comp = 1 + Math.floor(sorte(S, x, z, 7) * 3);
    let q = Math.floor(sorte(S, x, z, 8) * 4);
    for (let k = 1; k <= comp && y - k > yf + 1; k++) {
      if (P.ler(x, y - k, z) !== B.AIR) break;
      P.por(x, y - k, z, B.LOG, POSTE(q));
      q = (q + (sorte(S, x, z, k) < 0.5 ? 1 : 3)) & 3;
    }
  };
  for (let i = 0; i < 4; i++) {                         // tufos de raízes
    const qx = Math.floor(cx + (r() - 0.5) * R * 1.3), qz = Math.floor(cz + (r() - 0.5) * R * 1.2);
    for (let k = 0; k < 4; k++) if (r() < 0.6) raiz(qx + Math.floor(r() * 3) - 1, qz + Math.floor(r() * 3) - 1);
  }
  // poço num canto do salão (só onde a borda é rocha)
  const [px, , pz] = L(hu - lado * Math.round(R * 0.45), 0, hv - 1);
  for (let ex = -3; ex <= 3; ex++) for (let ez = -3; ez <= 3; ez++) {
    const x = px + ex, z = pz + ez, d = (ex * ex + ez * ez) / 4.4 + (ruido2(x * 0.5, z * 0.5, S + 3) - 0.5) * 0.4;
    if (d > 1 || P.ler(x, yf + 1, z) !== B.AIR) continue;
    let cercado = true;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = P.ler(x + nx, yf, z + nz); if (!(b === B.WATER || P.cheio(x + nx, yf, z + nz))) cercado = false; }
    if (!cercado) continue;
    P.por(x, yf, z, B.WATER, 0, ESSENCIAL); P.fontes.push([x, yf, z]);
    if (d < 0.45) { P.por(x, yf - 1, z, B.WATER, 0, ESSENCIAL); P.fontes.push([x, yf - 1, z]); P.por(x, yf - 2, z, B.CLAY, 0); }
    else P.por(x, yf - 1, z, B.GRAVEL, 0);
  }
  const centro = [Math.floor(cx), yf + 2, Math.floor(cz)];
  for (const [i, d] of [[0, [1, 0, 0]], [1, [-1, 0, 1]], [2, [0, 0, -1]]]) {
    const w = paredeNaDirecao(P, centro[0], yf + 1 + (i % 2), centro[2], d);
    if (w) cristais(P, ...w.celula, w.n, { s: S + 10 + i, tam: 2 + i });
  }
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(cx + (r() - 0.5) * R * 1.3), z = Math.floor(cz + (r() - 0.5) * R * 1.2);
    let y = yf + 1; while (y < yf + 12 && P.vazio(x, y, z)) y++;
    if (y - yf >= 4 && P.ler(x, y - 1, z) === B.AIR) formacao(P, x, y - 1, z, 1 + Math.floor(r() * 2), { mat: B.STONE, s: S + 20 + i, base: false });
  }

  // 5) fresta de luz até o chão da mata, tampada por uma moita
  const fx = Math.floor(cx + lado), fz = Math.floor(cz);
  let yt = yf + 1; while (yt < yf + 16 && P.vazio(fx, yt, fz)) yt++;
  const hs = ctx.height(fx, fz);
  if (hs - yt < 14 && hs > yt) {
    for (let y = yt; y < hs; y++) P.cavar(fx, y, fz);
    P.por(fx, hs, fz, B.LEAVES, 0);
    if (P.ler(fx, hs + 1, fz) !== B.AIR && !P.cheio(fx, hs + 1, fz)) P.ar(fx, hs + 1, fz);
    P.notas.push(`fresta de luz em ${fx} ${hs} ${fz}`);
  }

  // 6) pintura rupestre na parede do fundo do salão (ocre sobre a rocha), virada para quem entra
  const [ox, oz] = P.eixoV;
  const n = [ox, 0, oz];                                // a parede do fundo olha para a boca (+v)
  const w = paredeNaDirecao(P, centro[0], yf + 2, centro[2], [-ox, 0, -oz]);
  if (w) {
    const dir = [n[2], 0, -n[0]];                       // direita de quem olha a parede
    const bx = w.celula[0] - dir[0] * 3, bz = w.celula[2] - dir[2] * 3;
    P.pictos.push(montarPainel(P, {
      x: bx, y: yf + 1, z: bz, n, larg: 6, alt: 4, motivo: r() < 0.5 ? 'cacada' : 'maos',
      fundo: B.STONE, traco: r() < 0.6 ? B.PLASTER_RED : B.PLASTER_YELLOW, abrir: 4, moldura: B.STONE,
    }));
  }

  // 7) baú no salão, encostado numa parede, longe do poço e da boca da galeria
  let melhor = null;
  const [gx, , gz] = L(hu, 0, hv + R * 0.4);
  for (let ex = -6; ex <= 6; ex++) for (let ez = -6; ez <= 6; ez++) {
    const x = Math.floor(cx) + ex, z = Math.floor(cz) + ez, y = yf + 1;
    if (P.ler(x, y, z) !== B.AIR || !P.cheio(x, y - 1, z) || P.ler(x, y - 1, z) === B.WATER || P.ler(x, y + 1, z) !== B.AIR) continue;
    let parede = 0, agua = 0;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { if (P.cheio(x + nx, y, z + nz)) parede++; if (P.ler(x + nx, yf, z + nz) === B.WATER) agua++; }
    if (parede !== 1 || agua) continue;
    const nota = Math.abs(x - gx) + Math.abs(z - gz) + sorte(S, x, z, 9);
    if (!melhor || nota > melhor.nota) melhor = { x, y, z, nota };
  }
  if (melhor) {
    P.ar(melhor.x, melhor.y, melhor.z, ESSENCIAL);
    P.baus.push({ x: melhor.x, y: melhor.y, z: melhor.z, nivel: nivelPorProfundidade(ctx.height(melhor.x, melhor.z) - melhor.y), i: 0 });
  }

  P.entrada = L(0, h0 + 1, 1);
  P.vista = { de: c(L(1, h0 + 2.2, 7)), para: c(L(0.5, h0 + 1.5, -1)) };
  P.vistas = {
    fora: { de: olhoLivre(P, P.vista.de), para: P.vista.para },
    perto: { de: c(L(2, h0 + 1.7, 3)), para: c(L(0, h0 + 1.6, -2)) },
    dentro: { de: c(L(hu, yf + 2.4, hv + R * 0.55)), para: c(L(hu, yf + 1.6, hv - R)) },
  };
  estabilizar(P);
  return P;
}

export const MATA = Object.freeze({
  chave: 'mata', nome: 'Caverna escondida na mata', sal: 23,
  descricao: 'boca pequena entre moitas, raízes e pedras numa encosta de floresta, descendo para um salão com raízes no teto, poço, cristais e uma pintura rupestre',
  celula: 384, chance: 0.4, busca: 48, passo: 3, melhorDe: 12, raio: 22,
  raridade: 'uma a cada ~1–2 km² de floresta em encosta (precisa de mata fechada: 5 árvores a até 14 m)',
  podeNascer, gerar,
});
