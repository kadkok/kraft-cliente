// Kraft — criador de personagem: pinta no atlas (qualquer múltiplo de 64, o estúdio usa 640) o corpo, as roupas e o
// rosto da receita (shared/criador.js). Composição determinística: a mesma receita sai igual em todo aparelho
// (o "ruído" do tecido e da pele vem de um resumo da posição, não de Math.random).
// DESENHO PROVISÓRIO: rostos, padrões e sombreado são um primeiro traço do Claude; o Astra pode refinar à vontade,
// mantendo os ids do catálogo (a receita que já está salva nos mundos continua valendo).

import { skinParts, skinRects } from '../../shared/skin-atlas.js';

const FACE_W = 16;   // o rosto é desenhado numa grade 16×16 (meio pixel do formato de 64)

function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function css([r, g, b]) { return `rgb(${Math.max(0, Math.min(255, r | 0))},${Math.max(0, Math.min(255, g | 0))},${Math.max(0, Math.min(255, b | 0))})`; }
const mul = (c, f) => c.map((v) => v * f);
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
function ruido(x, y, k = 0) {
  let h = Math.imul(x * 374761393 + y * 668265263 + k * 2147483647, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Pinta uma célula do formato de 64 (tom com degradê vertical leve e grão do tecido).
function celula(ctx, S, x, y, cor, ly = 0, h = 1, grao = 0.05) {
  const f = (1 + 0.07 * (0.5 - ly / Math.max(1, h))) * (1 + (ruido(x, y) - 0.5) * grao);
  ctx.fillStyle = css(mul(cor, f));
  ctx.fillRect(x * S, y * S, S, S);
}
// Percorre as células de uma face: fn(lx, ly, w, h) devolve a cor (ou null = não pinta).
function face(ctx, S, rect, fn, grao) {
  const [x, y, w, h] = rect;
  for (let ly = 0; ly < h; ly++) for (let lx = 0; lx < w; lx++) {
    const c = fn(lx, ly, w, h);
    if (c) celula(ctx, S, x + lx, y + ly, c, ly, h, grao);
  }
}
const partes = (slim) => Object.fromEntries(skinParts(slim).map((p) => [p.name, p]));
const rects = (p, fora = false) => skinRects(p.size, fora ? p.outer : p.base);
function limparFora(ctx, S, p, faces = [0, 1, 2, 3, 4, 5]) {
  const r = rects(p, true);
  for (const f of faces) ctx.clearRect(r[f][0] * S, r[f][1] * S, r[f][2] * S, r[f][3] * S);
}

// ---- rosto: olhos (4×3, o direito é o espelho do esquerdo), sobrancelhas (4×2), boca (6×3) ----
const OLHOS = {
  redondos: ['.ww.', 'wpph', '.ww.'],
  amendoados: ['....', 'wwph', '.kk.'],
  sonolentos: ['kkkk', 'wwpp', '....'],
  brilhantes: ['.pp.', 'phpp', '.pp.'],
  fechados: ['....', 'k..k', '.kk.'],
  grandes: ['wwww', 'wpph', 'wppw'],
};
const SOBRANCELHAS = { nenhuma: [], retas: ['kkkk'], arqueadas: ['.kk.', 'k..k'], grossas: ['kkkk', 'kkkk'], bravas: ['kk..', '..kk'] };
const BOCAS = {
  sorriso: ['k....k', '.kkkk.'],
  neutra: ['......', '.kkkk.'],
  aberta: ['.kkkk.', '.krrk.', '..kk..'],
  'de-lado': ['.....k', '.kkkk.'],
  surpresa: ['..kk..', '..kk..'],
  dentes: ['kkkkkk', 'kwwwwk', '.kkkk.'],
};
function desenho(ctx, s, ox, oy, linhas, col0, row0, cores, espelhar = false) {
  linhas.forEach((linha, r) => [...linha].forEach((ch, c) => {
    const cor = cores[ch];
    if (!cor) return;
    const cc = espelhar ? linha.length - 1 - c : c;
    ctx.fillStyle = css(cor);
    ctx.fillRect(ox + (col0 + cc) * s, oy + (row0 + r) * s, s, s);
  }));
}
function pintarRosto(ctx, S, cabeca, rosto, pele, corSobrancelha) {
  const [x, y, w, h] = rects(cabeca)[5];
  const s = (w * S) / FACE_W, ox = x * S, oy = y * S;
  // pele do rosto (grade fina, com o mesmo grão)
  for (let r = 0; r < FACE_W; r++) for (let c = 0; c < FACE_W; c++) {
    ctx.fillStyle = css(mul(pele, (1 + 0.05 * (0.5 - r / FACE_W)) * (1 + (ruido(c + 900, r + 900) - 0.5) * 0.04)));
    ctx.fillRect(ox + c * s, oy + r * s, s, s);
  }
  const cores = { w: rgb('#f4f1ea'), p: rgb(rosto.corOlhos), h: rgb('#ffffff'), k: rgb('#2a1d17'), r: rgb('#9c3b36') };
  const olho = OLHOS[rosto.olhos] || OLHOS.redondos;
  desenho(ctx, s, ox, oy, olho, 3, 7, cores);
  desenho(ctx, s, ox, oy, olho, 9, 7, cores, true);
  const sb = SOBRANCELHAS[rosto.sobrancelhas] || [];
  const coresSb = { k: corSobrancelha };
  desenho(ctx, s, ox, oy, sb, 3, 5, coresSb);
  desenho(ctx, s, ox, oy, sb, 9, 5, coresSb, true);
  desenho(ctx, s, ox, oy, BOCAS[rosto.boca] || BOCAS.sorriso, 5, 11, cores);
  // bochechas levemente mais quentes
  ctx.fillStyle = css(mix(pele, [214, 112, 104], 0.18));
  for (const c of [2, 12]) ctx.fillRect(ox + c * s, oy + 10 * s, 2 * s, s);
}

// ---- roupas ----
function corCamisa(cam, lx, ly, w, h, fi, eFrente) {
  const c = rgb(cam.cor), c2 = rgb(cam.cor2);
  switch (cam.padrao) {
    case 'listras': if (fi !== 2 && fi !== 3 && ly % 3 === 0) return c2; break;
    case 'xadrez': if (((lx >> 1) + (ly >> 1)) % 2) return mix(c, c2, 0.45); break;
    case 'gola': if (eFrente && ((ly === 0 && lx >= 2 && lx <= w - 3) || (ly === 1 && lx >= 3 && lx <= w - 4))) return c2; break;
    case 'faixa': if ((fi === 5 || fi === 4) && Math.abs(lx - ly * w / h) < 1.2) return c2; break;
    case 'bolinhas': if (fi !== 2 && fi !== 3 && (lx * 3 + ly * 5) % 7 === 0) return c2; break;
  }
  return c;
}

export function pintarCriador(ctx, criador, slim) {
  if (!criador) return;
  const S = ctx.canvas.width / 64, P = partes(slim);
  const corpo = criador.corpo;
  const amostra = (px, py) => { const d = ctx.getImageData(px * S + (S >> 1), py * S + (S >> 1), 1, 1).data; return [d[0], d[1], d[2]]; };
  // pele do rosto quando o corpo não é do criador: a cor da bochecha da base
  const peleRosto = corpo ? rgb(corpo.cabeca) : amostra(rects(P.head)[5][0] + 1, rects(P.head)[5][1] + 6);

  if (corpo) {
    const cores = { head: corpo.cabeca, torso: corpo.tronco, armL: corpo.bracos, armR: corpo.bracos, legL: corpo.pernas, legR: corpo.pernas };
    for (const p of Object.values(P)) {
      const c = rgb(cores[p.name]);
      rects(p).forEach((r, fi) => face(ctx, S, r, () => fi === 2 ? mul(c, 1.03) : fi === 3 ? mul(c, 0.9) : c, 0.04));
      limparFora(ctx, S, p);
    }
  }

  const cabelo = criador.cabelo;
  // o cabelo só pinta o couro cabeludo quando o corpo também é do criador; sobre uma base (PNG ou pintor) fica só em 3D
  if (cabelo && corpo) {
    const c = rgb(cabelo.cor), r = rects(P.head), longo = ['longo', 'volume', 'trancas', 'rabo'].includes(cabelo.estilo);
    const moi = cabelo.estilo === 'moicano';
    face(ctx, S, r[2], (lx) => !moi || (lx >= 3 && lx <= 4) ? c : null, 0.12);
    face(ctx, S, r[4], (lx, ly) => moi ? (lx >= 3 && lx <= 4 && ly < 5 ? c : null) : ly < (longo ? 8 : 5) ? c : null, 0.12);
    if (!moi) {
      face(ctx, S, r[0], (lx, ly) => ly < (longo ? 4 : 2) ? c : null, 0.12);
      face(ctx, S, r[1], (lx, ly) => ly < (longo ? 4 : 2) ? c : null, 0.12);
    }
  }

  const cam = criador.camisa, calca = criador.calca;
  if (cam) {
    const ate = calca && calca.estilo !== 'macacao' ? 10 : 12;
    rects(P.torso).forEach((r, fi) => face(ctx, S, r, (lx, ly, w, h) => {
      if (fi === 3 && calca) return null;
      if (h === 12 && ly >= ate) return null;
      if (cam.estilo === 'regata' && fi === 5 && ((ly === 0 && lx >= 2 && lx <= 5) || (ly === 1 && lx >= 3 && lx <= 4))) return null;
      let c = corCamisa(cam, lx, ly, w, h, fi, fi === 5);
      if (cam.estilo === 'moletom' && fi === 5) {
        if (ly >= 6 && ly <= 8 && lx >= 1 && lx <= 6) c = mul(c, 0.86);
        if (ly >= 1 && ly <= 3 && (lx === 2 || lx === 5)) c = rgb(cam.cor2);
      }
      if (cam.estilo === 'moletom' && fi === 2 && (lx === 0 || lx === w - 1 || ly === 0 || ly === 3)) c = mul(c, 0.82);
      if (cam.estilo === 'social' && fi === 5) {
        if (ly === 0 && (lx === 1 || lx === 2 || lx === 5 || lx === 6)) c = rgb('#f4f2ec');
        if (lx === 3 && ly % 2 === 0 && ly > 0) c = rgb(cam.cor2);
      }
      return c;
    }, 0.06));
    const manga = { camiseta: 4, 'manga-longa': 11, moletom: 11, social: 11, regata: 0 }[cam.estilo] ?? 4;
    for (const p of [P.armL, P.armR]) {
      if (manga) rects(p).forEach((r, fi) => face(ctx, S, r, (lx, ly, w, h) => {
        if (fi === 3) return null;
        if (fi === 2) return corCamisa(cam, lx, ly, w, h, fi, false);
        if (ly >= manga) return null;
        const c = corCamisa(cam, lx, ly, w, h, fi, false);
        return ly === manga - 1 && manga < 11 ? mul(c, 0.85) : c;
      }, 0.06));
      if (!corpo) limparFora(ctx, S, p);
    }
    if (!corpo) limparFora(ctx, S, P.torso);
  }

  if (calca) {
    const c = rgb(calca.cor), c2 = rgb(calca.cor2);
    const ate = calca.estilo === 'bermuda' ? 6 : 12;
    for (const p of [P.legL, P.legR]) {
      const ladoDeFora = p.name === 'legR' ? 0 : 1;
      rects(p).forEach((r, fi) => face(ctx, S, r, (lx, ly, w, h) => {
        if (fi === 3) return null;
        if (h === 12 && ly >= ate) return null;
        if (calca.padrao === 'listra-lateral' && fi === ladoDeFora && (lx === 1 || lx === 2)) return c2;
        if (calca.padrao === 'xadrez' && ((lx >> 1) + (ly >> 1)) % 2) return mix(c, c2, 0.45);
        if (calca.padrao === 'joelheira' && fi === 5 && ate === 12 && (ly === 5 || ly === 6)) return c2;
        if (ly === ate - 1 && ate < 12) return mul(c, 0.85);
        return c;
      }, 0.07));
      if (!corpo) limparFora(ctx, S, p);
    }
    rects(P.torso).forEach((r, fi) => face(ctx, S, r, (lx, ly, w, h) => {
      if (calca.estilo === 'macacao') {
        if (fi === 3) return c;
        if (h !== 12) return null;
        if (ly >= 5) return ly === 5 && (fi === 5 || fi === 4) && (lx === 1 || lx === w - 2) ? c2 : c;
        return (fi === 5 || fi === 4) && (lx === 1 || lx === w - 2) ? mul(c, 0.92) : null;
      }
      if (fi === 3) return c;
      if (h !== 12 || ly < 10) return null;
      return ly === 11 ? mul(c, 0.72) : c;   // cós e cinto
    }, 0.07));
  }

  const sap = criador.sapato;
  if (sap) {
    const c = rgb(sap.cor), sola = rgb('#ece8df'), escura = rgb('#2b2522');
    const desde = { tenis: 10, bota: 7, sapatilha: 11 }[sap.estilo] ?? 10;
    for (const p of [P.legL, P.legR]) {
      rects(p).forEach((r, fi) => face(ctx, S, r, (lx, ly, w, h) => {
        if (fi === 3) return sap.estilo === 'bota' ? escura : sap.estilo === 'tenis' ? sola : mul(c, 0.8);
        if (h !== 12) return null;
        if (sap.estilo === 'sapatilha' && fi === 5 && ly === 10 && (lx === 1 || lx === 2)) return c;
        if (ly < desde) return null;
        if (sap.estilo === 'tenis') return ly === 11 ? sola : fi === 5 && (lx === 1 || lx === 2) ? rgb('#f7f5f0') : c;
        if (sap.estilo === 'bota') return ly === 11 ? escura : ly === 7 ? mul(c, 1.18) : c;
        return c;
      }, 0.05));
      if (!corpo && !calca) {
        const rf = rects(p, true);
        for (const f of [0, 1, 4, 5]) ctx.clearRect(rf[f][0] * S, (rf[f][1] + desde) * S, rf[f][2] * S, (12 - desde) * S);
      }
    }
  }

  if (criador.rosto) {
    const sb = cabelo ? mul(rgb(cabelo.cor), 0.8) : rgb('#3a2a20');
    pintarRosto(ctx, S, P.head, criador.rosto, peleRosto, sb);
    if (!corpo) limparFora(ctx, S, P.head, [5]);
  }
}
