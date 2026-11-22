// Kraft — gruta-catedral (pedido do Kadmus, 19/11/2026). Puro e determinístico (shared/estruturas.js).
//
// Onde nasce: debaixo de terra firme (nada de mar, praia ou água por cima), com rocha de sobra: o teto do domo fica a
// 7 m ou mais abaixo do chão mais baixo em volta. O piso fica entre −8 e ~40 (acima dos rios subterrâneos, que nunca
// passam de −14: item 71).
// Como é: uma nave em domo de 24 a 30 m de largura e 16 a 21 de altura, com uma nave lateral; colunas em ampulheta de
// mármore e arenito (estalactite que encontrou a estalagmite); dezenas de estalactites em cachos e estalagmites embaixo;
// um lago debaixo de um óculo — um poço aberto até a superfície (uma dolina entre samambaias) por onde desce um facho de
// luz; no fundo do lago, água mística que brilha; cachos de cristais roxos nas paredes; um geodo (nicho forrado de
// cristal) com o baú; e a chegada: uma galeria em espiral que desce da superfície e abre numa sacada alta, de onde se vê
// o salão inteiro e se desce por uma bancada encostada na parede. Pular do óculo no lago não machuca (água zera a queda).
import { B } from '../blocks.js';
import { BIOME } from '../worldgen.js';
import { nivelPorProfundidade } from '../tesouros.js';
import {
  criarPlanta, ruido2, rng, sorte, cavarBolha, cavarGaleria, formacao, pilar, cristais, paredeNaDirecao, estabilizar,
  sementeDoSitio, planta_, dir32, cone, olhoLivre, ESSENCIAL, MOLDE, SEA, Y_TOP,
} from '../estruturas.js';
import { montarPainel } from './pictogramas.js';

const FORA = new Set([BIOME.OCEAN, BIOME.BEACH]);
const PISO_MIN = -8;                       // acima dos rios subterrâneos (teto mais alto de rio: −14)

export function podeNascer(ctx, x, z, variante) {
  if (FORA.has(ctx.bioma(x, z))) return null;
  const H = ctx.height;
  let hmin = Infinity, hmax = -Infinity;
  for (let ex = -21; ex <= 21; ex += 3) for (let ez = -21; ez <= 21; ez += 3) {
    if (ex * ex + ez * ez > 441) continue;
    const h = H(x + ex, z + ez);
    if (h < hmin) hmin = h; if (h > hmax) hmax = h;
  }
  if (hmin < SEA + 3 || hmax + 4 >= Y_TOP) return null;
  const sem = sementeDoSitio(ctx, 'catedral', x, z);
  const Hd = 19 + (sem % 6), extra = (sem >>> 8) % 7;
  const yf = Math.max(PISO_MIN, hmin - 8 - Hd - extra);
  if (yf + Hd + 7 > hmin) return null;
  return { tipo: 'catedral', x, y: yf, z, rot: 0, hmin, Hd, nota: hmin - hmax, semente: sem, variante: variante || null };
}

export function gerar(ctx, s) {
  const S = s.semente & 0x7fffffff, r = rng(s.semente), yf = s.y, Hd = s.Hd;
  const P = criarPlanta(ctx, { tipo: 'catedral', ancora: [s.x, yf, s.z], rot: 0, semente: s.semente, nome: CATEDRAL.nome });
  const cx = s.x + 0.5, cz = s.z + 0.5, R = 13 + Math.floor(r() * 4);
  const ponto = (k, t) => { const d = dir32(k); return [cx + d[0] * t, cz + d[1] * t]; };
  const celula = (k, t) => ponto(k, t).map(Math.floor);

  // 1) nave principal e nave lateral
  cavarBolha(P, [cx, yf + Hd * 0.42, cz], [R, Hd * 0.6, R * 0.88], { chao: yf, amp: 0.26, s: S + 1, escala: 0.11 });
  const kL = Math.floor(r() * 32);
  const [lx0, lz0] = ponto(kL, R * 0.9);
  cavarBolha(P, [lx0, yf + Hd * 0.28, lz0], [R * 0.48, Hd * 0.34, R * 0.44], { chao: yf + 1, amp: 0.3, s: S + 2, escala: 0.16 });
  const tetoEm = (x, z, de = yf + 1) => { let y = de; while (y < yf + Hd + 8 && P.vazio(x, y, z)) y++; return y; };   // 1ª célula cheia acima

  // 2) óculo: poço aberto até a superfície, onde não houver árvore; o lago fica debaixo dele
  let oculo = null;
  for (let i = 0; i < 18 && !oculo; i++) {
    const [ox, oz] = i === 0 ? [Math.floor(cx), Math.floor(cz)] : celula(Math.floor(r() * 32), 1.5 + r() * R * 0.5);
    const hs = ctx.height(ox, oz);
    if (hs <= SEA + 1) continue;
    let plano = true;                                       // dolina só em chão quase plano (na encosta vira um corte)
    for (const [ex, ez] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (Math.abs(ctx.height(ox + ex, oz + ez) - hs) > 2) plano = false;
    if (!plano) continue;
    let livre = true;
    for (const t of ctx.arvores(ox - 6, oz - 6, ox + 6, oz + 6)) if ((t.x - ox) * (t.x - ox) + (t.z - oz) * (t.z - oz) < 26) livre = false;
    if (livre) oculo = [ox, oz, hs];
  }
  const [lagoX, lagoZ] = oculo ? [oculo[0], oculo[1]] : celula(kL + 16, R * 0.35);
  if (oculo) {
    const [ox, oz, hs] = oculo, y0 = tetoEm(ox, oz);
    for (let ex = -2; ex <= 2; ex++) for (let ez = -2; ez <= 2; ez++) {
      const d2 = ex * ex + ez * ez;
      if (d2 > 2.3) continue;
      for (let y = y0 - 1; y <= hs + 1; y++) P.cavar(ox + ex, y, oz + ez, ESSENCIAL);
    }
    // a dolina: a borda em volta do poço afunda um bloco (o terreno em volta ganha rampa sozinho)
    for (let ex = -4; ex <= 4; ex++) for (let ez = -4; ez <= 4; ez++) {
      const d2 = ex * ex + ez * ez, x = ox + ex, z = oz + ez;
      if (d2 <= 2.3 || d2 > 12.5) continue;
      const h = ctx.height(x, z);
      if (d2 <= 6.5) { P.cavar(x, h, z); P.cavar(x, h + 1, z); if (P.ler(x, h - 1, z) === B.DIRT || P.ler(x, h - 1, z) === B.STONE) P.por(x, h - 1, z, d2 <= 4 ? B.STONE : B.GRASS, MOLDE); }
      else if (P.ler(x, h + 1, z) === B.AIR || planta_(P.ler(x, h + 1, z))) {
        const t = sorte(S, x, z, 1);
        if (t < 0.35) P.por(x, h + 1, z, B.FERN, 0); else if (t < 0.45) P.por(x, h, z, B.STONE, MOLDE);
      }
    }
    P.notas.push(`óculo em ${ox} ${hs} ${oz}`);
  }

  // 3) lago: fundo de 2 a 3, areia e cascalho; no meio, água mística que brilha debaixo da água
  const lr = 4.2 + r() * 1.6;
  for (let ex = -7; ex <= 7; ex++) for (let ez = -7; ez <= 7; ez++) {
    const x = lagoX + ex, z = lagoZ + ez, d = (ex * ex + ez * ez) / (lr * lr) + (ruido2(x * 0.3, z * 0.3, S + 3) - 0.5) * 0.45;
    if (d > 1 || P.ler(x, yf + 1, z) !== B.AIR) continue;
    let cercado = true;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const b = P.ler(x + nx, yf, z + nz); if (!(b === B.WATER || P.cheio(x + nx, yf, z + nz))) cercado = false; }
    if (!cercado) continue;
    const fundo = d < 0.25 ? 3 : d < 0.6 ? 2 : 1;
    for (let k = 0; k < fundo; k++) { P.por(x, yf - k, z, B.WATER, 0, ESSENCIAL); P.fontes.push([x, yf - k, z]); }
    P.por(x, yf - fundo, z, d < 0.12 ? B.MYSTIC_WATER : d < 0.5 ? B.SAND : sorte(S, x, z, 2) < 0.5 ? B.GRAVEL : B.CLAY, 0);
  }

  // 4) colunas em ampulheta
  const nCol = 2 + Math.floor(r() * 2), usados = [];
  for (let i = 0; i < nCol; i++) {
    for (let tent = 0; tent < 8; tent++) {
      const k = Math.floor(r() * 32), t = R * (0.38 + r() * 0.25), [x, z] = celula(k, t);
      if (Math.hypot(x - lagoX, z - lagoZ) < lr + 2.5 || usados.some(([a, b]) => Math.hypot(a - x, b - z) < 7)) continue;
      const y1 = tetoEm(x, z) - 1;
      if (y1 - yf < 8 || P.ler(x, yf, z) === B.WATER) continue;
      pilar(P, x, z, yf + 1, y1, { rMax: 2 + r() * 0.9, rMin: 0.8 + r() * 0.5, mat: B.MARBLE, mat2: B.SANDSTONE, s: S + 10 + i });
      usados.push([x, z]);
      break;
    }
  }

  // 5) estalactites em cachos e estalagmites debaixo de algumas
  const pares = [];
  for (let c = 0; c < 9; c++) {
    const [qx, qz] = celula(Math.floor(r() * 32), R * (0.15 + r() * 0.65));
    const n = 3 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const x = qx + Math.floor(r() * 5) - 2, z = qz + Math.floor(r() * 5) - 2;
      if (!P.vazio(x, yf + 1, z)) continue;
      const yt = tetoEm(x, z), alto = yt - yf - 1;
      if (alto < 6) continue;
      const comp = Math.min(7, 1 + Math.floor(r() * Math.max(2, alto / 3)));
      formacao(P, x, yt - 1, z, comp, { desce: true, mat: r() < 0.72 ? B.MARBLE : B.SANDSTONE, s: S + 100 + c * 10 + i });
      if (comp >= 3) pares.push([x, z]);
    }
  }
  for (const [x, z] of pares) {
    if (r() < 0.45 || P.ler(x, yf, z) === B.WATER || !P.cheio(x, yf, z) || P.ler(x, yf + 1, z) !== B.AIR) continue;
    formacao(P, x, yf + 1, z, 1 + Math.floor(r() * 4), { desce: false, mat: r() < 0.7 ? B.MARBLE : B.SANDSTONE, s: S + 300 + x * 3 + z });
  }

  // 5b) estalactites grandes em cone onde o teto é mais alto (as que se veem da sacada) e cristais no teto do domo
  const grandes = [];
  for (let i = 0; i < 24 && grandes.length < 6; i++) {
    const [x, z] = celula(Math.floor(r() * 32), R * (0.1 + r() * 0.5));
    if (oculo && Math.hypot(x - oculo[0], z - oculo[1]) < 4) continue;
    if (grandes.some(([a, b]) => Math.hypot(a - x, b - z) < 5)) continue;
    const yt = tetoEm(x, z), alto = yt - yf - 1;
    if (alto < Hd * 0.65) continue;
    cone(P, x, yt - 1, z, Math.min(Math.floor(alto * 0.45), 6 + Math.floor(r() * 6)), { r0: 1.3 + r() * 0.9, s: S + 200 + i });
    grandes.push([x, z]);
  }
  for (let i = 0; i < 6; i++) {
    const [x, z] = celula(Math.floor(r() * 32), R * (0.2 + r() * 0.55));
    const yt = tetoEm(x, z);
    if (yt - yf < Hd * 0.5 || !P.cheio(x, yt, z)) continue;
    cristais(P, x, yt, z, [0, -1, 0], { s: S + 450 + i, tam: 3 + Math.floor(r() * 3) });
  }

  // 6) cristais pelas paredes, em várias alturas
  for (let i = 0; i < 9; i++) {
    const k = Math.floor(r() * 32), d = dir32(k), y = yf + 2 + Math.floor(r() * Hd * 0.55);
    const w = paredeNaDirecao(P, Math.floor(cx), y, Math.floor(cz), [Math.round(d[0] * 1.3), 0, Math.round(d[1] * 1.3)], R + 6);
    if (w) cristais(P, ...w.celula, w.n, { s: S + 400 + i, tam: 3 + Math.floor(r() * 4) });
  }

  // 7) geodo: nicho redondo forrado de cristal, com o baú dentro
  const kG = kL + 8 + Math.floor(r() * 16);
  const dG = dir32(kG), yG = yf + 1;
  const wG = paredeNaDirecao(P, Math.floor(cx), yG + 1, Math.floor(cz), [Math.round(dG[0] * 1.3), 0, Math.round(dG[1] * 1.3)], R + 6);
  let bau = null;
  if (wG) {
    const [gx, , gz] = wG.celula, ncx = gx - wG.n[0] * 1.5 + 0.5, ncz = gz - wG.n[2] * 1.5 + 0.5;
    cavarBolha(P, [ncx, yG + 1.2, ncz], [2.2, 1.9, 2.2], { chao: yG - 1, amp: 0.15, s: S + 500 });
    for (let ex = -4; ex <= 4; ex++) for (let ez = -4; ez <= 4; ez++) for (let y = yG - 1; y <= yG + 4; y++) {
      const x = Math.floor(ncx) + ex, z = Math.floor(ncz) + ez;
      if (!P.cheio(x, y, z) || P.ler(x, y, z) === B.WATER) continue;
      const toca = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, c]) => {
        const q = [x + a, y + b, z + c];
        return P.vazio(...q) && Math.hypot(q[0] + 0.5 - ncx, q[2] + 0.5 - ncz) < 2.6 && q[1] >= yG;
      });
      if (!toca) continue;
      const t = sorte(S, x, y, z);
      P.por(x, y, z, t < 0.06 ? B.SAPPHIRE_ORE : t < 0.4 ? B.CRYSTAL_ORE : B.PHANTOM_CRYSTAL, 0);
    }
    for (let i = 0; i < 4; i++) {                          // lascas no teto do geodo
      const x = Math.floor(ncx) + Math.floor(r() * 3) - 1, z = Math.floor(ncz) + Math.floor(r() * 3) - 1;
      const yt = tetoEm(x, z, yG);
      if (yt - yG >= 2 && P.ler(x, yt - 1, z) === B.AIR) formacao(P, x, yt - 1, z, 1, { mat: B.PHANTOM_CRYSTAL, s: S + 520 + i, base: false });
    }
    const bx = Math.floor(ncx), bz = Math.floor(ncz);
    if (P.ler(bx, yG, bz) === B.AIR && P.cheio(bx, yG - 1, bz)) bau = [bx, yG, bz];
    P.notas.push(`geodo em ${bx} ${yG} ${bz}`);
  }
  const fundura = s.hmin - yf;
  const nivel = s.variante === 'lendaria' || sorte(S, 77) < 0.1 ? 'lendario' : nivelPorProfundidade(Math.max(25, fundura));
  if (bau) { P.ar(...bau, ESSENCIAL); P.baus.push({ x: bau[0], y: bau[1], z: bau[2], nivel, i: 0 }); }

  // 8) sacada alta + bancada descendo encostada na parede + galeria em espiral até a superfície
  const kB = kL + 16 + (r() < 0.5 ? -3 : 3), sg = r() < 0.5 ? 1 : -1;
  const yB = yf + Math.round(Hd * 0.42);
  const parede = (kf, y) => {                               // distância do centro até a parede, na direção kf, altura y
    const k0 = Math.floor(kf), f = kf - k0, a = dir32(k0), b = dir32(k0 + 1);
    let dx = a[0] + (b[0] - a[0]) * f, dz = a[1] + (b[1] - a[1]) * f;
    const n = Math.sqrt(dx * dx + dz * dz); dx /= n; dz /= n;
    for (let t = 2; t < R + 8; t += 0.5) if (P.cheio(Math.floor(cx + dx * t), y, Math.floor(cz + dz * t))) return { t, dx, dz };
    return null;
  };
  const sac = parede(kB, yB + 1);
  if (sac) {
    // sacada: meia-lua de piso em frente à parede, com parapeito de pedra moldada nas pontas
    for (let t = sac.t - 4; t <= sac.t; t += 0.5) for (let lat = -2.5; lat <= 2.5; lat += 0.5) {
      const x = Math.floor(cx + sac.dx * t - sac.dz * lat), z = Math.floor(cz + sac.dz * t + sac.dx * lat);
      if (Math.abs(lat) > 2.5 - Math.max(0, sac.t - 2 - t) * 0.6) continue;
      if (!P.cheio(x, yB, z)) P.por(x, yB, z, B.STONE, MOLDE, ESSENCIAL);
      for (let y = yB + 1; y <= yB + 3; y++) if (P.cheio(x, y, z) && !(P.marca(x, y, z) & ESSENCIAL)) P.cavar(x, y, z);
    }
    // bancada: desce 1 a cada 1/64 de volta, encostada na parede, até o chão
    let y = yB;
    for (let i = 1; y > yf + 1 && i < 64; i++) {
      const kf = kB + sg * i * 0.5;
      y = yB - Math.floor(i * 0.85);
      if (y <= yf) break;
      const w = parede(kf, y + 1) || parede(kf, y);
      if (!w) continue;
      for (let t = w.t - 2.6; t <= w.t - 0.4; t += 0.4) {
        const x = Math.floor(cx + w.dx * t), z = Math.floor(cz + w.dz * t);
        if (!P.cheio(x, y, z)) P.por(x, y, z, B.STONE, MOLDE, ESSENCIAL);
        for (let yy = y + 1; yy <= y + 3; yy++) if (P.cheio(x, yy, z) && !(P.marca(x, yy, z) & ESSENCIAL)) P.cavar(x, yy, z);
      }
    }
    // galeria: da sacada para dentro da rocha e em espiral para cima até furar a superfície
    const RG = R + 6;
    const pts = [[cx + sac.dx * (sac.t - 1), yB, cz + sac.dz * (sac.t - 1)], [cx + sac.dx * RG, yB, cz + sac.dz * RG]];
    let yg = yB, saiu = null;
    for (let i = 1; i < 40; i++) {
      const kf = kB - sg * i;
      const k0 = Math.floor(kf), d = dir32(k0);
      const x = cx + d[0] * RG, z = cz + d[1] * RG;
      yg += 1.6;
      const hs = ctx.height(Math.floor(x), Math.floor(z));
      if (yg + 1 >= hs) { pts.push([x, Math.min(Math.round(yg), hs), z]); saiu = [Math.floor(x), hs + 1, Math.floor(z)]; break; }
      pts.push([x, Math.round(yg), z]);
    }
    if (!saiu) return null;
    cavarGaleria(P, pts, { r: 1.2, alt: 3, amp: 0.25, s: S + 600 });
    // boca da galeria: a terra das paredes do corte vira pedra (uma fenda na rocha), moitas e samambaias em volta
    for (let ex = -4; ex <= 4; ex++) for (let ez = -4; ez <= 4; ez++) for (let dy = -6; dy <= 1; dy++) {
      const x = saiu[0] + ex, z = saiu[2] + ez, y = saiu[1] + dy, b = P.ler(x, y, z);
      if ((b !== B.DIRT && b !== B.GRASS) || P.tem(x, y, z) && P.marca(x, y, z)) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, c]) => P.ler(x + a, y, z + c) === B.AIR && P.tem(x + a, y, z + c))) P.por(x, y, z, B.STONE, P.vazio(x, y + 1, z) ? MOLDE : 0);
    }
    for (let ex = -3; ex <= 3; ex++) for (let ez = -3; ez <= 3; ez++) {
      const x = saiu[0] + ex, z = saiu[2] + ez, h = P.topo(x, z, ctx.height(x, z) + 2, ctx.height(x, z) - 4);
      if (P.ler(x, h + 1, z) !== B.AIR || !P.cheio(x, h, z) || P.tem(x, h + 1, z)) continue;
      const t = sorte(S, x, z, 6), borda = Math.abs(ex) === 2 || Math.abs(ez) === 2;
      if (borda && t < 0.3) { P.por(x, h + 1, z, B.LEAVES, 0); if (t < 0.12 && P.ler(x, h + 2, z) === B.AIR) P.por(x, h + 2, z, B.LEAVES, 0); }
      else if (t < 0.45) P.por(x, h + 1, z, B.FERN, 0);
    }
    P.entrada = saiu;
    P.notas.push(`sacada em ${Math.floor(cx + sac.dx * (sac.t - 2))} ${yB + 1} ${Math.floor(cz + sac.dz * (sac.t - 2))}`);
    const ver = [cx + sac.dx * (sac.t - 2.5), yB + 2.6, cz + sac.dz * (sac.t - 2.5)];
    P.vistas = {
      sacada: { de: ver, para: Math.hypot(lagoX + 0.5 - ver[0], lagoZ + 0.5 - ver[2]) > R * 0.5 ? [lagoX + 0.5, yf + 3, lagoZ + 0.5] : [cx - sac.dx * R * 0.8, yf + Hd * 0.3, cz - sac.dz * R * 0.8] },
      lago: { de: [lagoX + 0.5 + sac.dx * (lr + 4), yf + 2.6, lagoZ + 0.5 + sac.dz * (lr + 4)], para: [lagoX + 0.5, yf + 1, lagoZ + 0.5] },
      entrada: { de: olhoLivre(P, [saiu[0] + 6.5, saiu[1] + 3, saiu[2] + 0.5]), para: [saiu[0] + 0.5, saiu[1] - 1, saiu[2] + 0.5] },
    };
    if (oculo) P.vistas.oculo = { de: olhoLivre(P, [oculo[0] + 7.5, oculo[2] + 4, oculo[1] + 0.5]), para: [oculo[0] + 0.5, oculo[2] - 2, oculo[1] + 0.5] };
    P.vista = P.vistas.sacada;
  } else return null;

  // 9) a lenda das luas na parede, de frente para o lago
  const kP = kL + 16;
  const dP = dir32(kP), wP = paredeNaDirecao(P, lagoX, yf + 2, lagoZ, [Math.round(dP[0] * 1.3), 0, Math.round(dP[1] * 1.3)], R + 6);
  if (wP && wP.n[1] === 0) {
    const n = wP.n, dir = [n[2], 0, -n[0]];
    P.pictos.push(montarPainel(P, {
      x: wP.celula[0] - dir[0] * 3, y: yf + 2, z: wP.celula[2] - dir[2] * 3, n, larg: 6, alt: 4, motivo: 'luas',
      fundo: B.STONE, traco: B.PLASTER_YELLOW, abrir: 4, moldura: B.STONE,
    }));
  }

  estabilizar(P);
  return P;
}

export const CATEDRAL = Object.freeze({
  chave: 'catedral', nome: 'Gruta-catedral', sal: 37, variantes: ['lendaria'],
  descricao: 'nave em domo com colunas, estalactites e estalagmites, lago com fundo que brilha debaixo de um óculo de luz, cristais, um geodo com baú e a chegada por uma sacada alta',
  celula: 1024, chance: 0.5, busca: 64, passo: 8, melhorDe: 1, raio: 34,
  raridade: 'uma a cada ~2 km² de terra firme (debaixo da superfície; o baú dela é lendário 1 vez em 10)',
  podeNascer, gerar,
});
