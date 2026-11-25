// LAVRA — ícones dos objetos (shared/objetos.js: itens que não são blocos). PROVISÓRIOS, desenhados por código só para
// a mochila, a barra e o item no chão não ficarem em branco. Contrato para quem desenha (Astra):
//   game.objIcones.trocar({ sela: canvasOuImagem, corda: … })   troca o desenho de um objeto pelo id dele
//   game.objIcones.icone(numero, tamanho) → canvas quadrado, fundo transparente
// Cada desenho é feito numa grade de 64 × 64 (o contexto já vem na escala do tamanho pedido).
import { OBJETOS, OBJ_POR_NUMERO } from '../../shared/objetos.js';

const grad = (c, x0, y0, x1, y1, ...cores) => { const g = c.createLinearGradient(x0, y0, x1, y1); cores.forEach((cor, i) => g.addColorStop(i / (cores.length - 1), cor)); return g; };
const traco = (c, cor, larg, pts, fecha = false) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); if (fecha) c.closePath(); c.strokeStyle = cor; c.lineWidth = larg; c.lineJoin = c.lineCap = 'round'; c.stroke(); };
const forma = (c, cor, pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fillStyle = cor; c.fill(); };
const elipse = (c, cor, x, y, rx, ry, rot = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); c.fillStyle = cor; c.fill(); };
// um pedaço de carne com osso (cru = rosado, assado = dourado)
const carne = (clara, escura, gordura) => (c) => {
  c.beginPath(); c.moveTo(14, 38); c.bezierCurveTo(8, 22, 26, 8, 42, 14); c.bezierCurveTo(58, 20, 58, 40, 46, 50); c.bezierCurveTo(34, 60, 18, 54, 14, 38); c.closePath();
  c.fillStyle = grad(c, 12, 12, 54, 56, clara, escura); c.fill(); c.strokeStyle = gordura; c.lineWidth = 3; c.stroke();
  elipse(c, gordura, 34, 32, 6, 5); elipse(c, grad(c, 30, 28, 38, 36, '#fffaf0', '#e6dcc6'), 34, 32, 3.4, 2.8);
};
const peixe = (clara, escura) => (c) => {
  c.beginPath(); c.moveTo(8, 32); c.bezierCurveTo(18, 14, 40, 14, 48, 30); c.lineTo(58, 20); c.lineTo(56, 44); c.lineTo(48, 34); c.bezierCurveTo(40, 50, 18, 50, 8, 32); c.closePath();
  c.fillStyle = grad(c, 8, 16, 50, 50, clara, escura); c.fill();
  elipse(c, '#1b1f24', 18, 29, 2.2, 2.2); traco(c, 'rgba(255,255,255,.45)', 1.5, [[26, 24], [30, 32], [26, 40]]);
};
const ovo = (clara, escura) => (c) => { c.beginPath(); c.ellipse(32, 35, 15, 20, 0, 0, Math.PI * 2); c.fillStyle = grad(c, 20, 14, 46, 58, clara, escura); c.fill(); elipse(c, 'rgba(255,255,255,.55)', 26, 26, 4, 6, -0.4); };
const DESENHO = {
  carne_crua: carne('#e8798a', '#a8323f', '#f6e3d2'),
  carne_assada: carne('#c98a4a', '#6e3d1c', '#e8c98c'),
  ave_crua: carne('#f0b9a8', '#c9806f', '#f8ead8'),
  ave_assada: carne('#d9a45a', '#8a5524', '#f0d9a0'),
  peixe_cru: peixe('#9fc4d8', '#4f7f9c'),
  peixe_assado: peixe('#d9b47a', '#8a5e2c'),
  ovo: ovo('#fbf3e2', '#d8c7a4'),
  ovo_cozido: ovo('#fffdf6', '#e9dcc0'),
  leite: (c) => {   // cuia de leite
    c.beginPath(); c.moveTo(10, 28); c.bezierCurveTo(12, 52, 52, 52, 54, 28); c.closePath(); c.fillStyle = grad(c, 10, 28, 54, 52, '#b98452', '#6e4526'); c.fill();
    elipse(c, grad(c, 12, 22, 52, 34, '#ffffff', '#e6ecf2'), 32, 28, 22, 6); traco(c, '#8a5a33', 2, [[10, 28], [54, 28]]);
  },
  couro: (c) => {   // pele esticada
    forma(c, grad(c, 8, 8, 56, 56, '#b98048', '#6b4423'), [[14, 8], [26, 13], [38, 13], [50, 8], [53, 22], [47, 32], [53, 44], [50, 57], [38, 51], [26, 51], [14, 57], [11, 44], [17, 32], [11, 22]]);
    forma(c, 'rgba(232,190,140,.35)', [[22, 18], [42, 18], [44, 32], [42, 46], [22, 46], [20, 32]]);
  },
  pena: (c) => { traco(c, '#e9e4d8', 2, [[14, 54], [50, 10]]); c.beginPath(); c.moveTo(20, 46); c.bezierCurveTo(14, 26, 34, 8, 50, 10); c.bezierCurveTo(52, 26, 40, 44, 20, 46); c.closePath(); c.fillStyle = grad(c, 16, 44, 50, 10, '#cfd8e2', '#f7f9fb'); c.fill(); traco(c, 'rgba(120,130,145,.5)', 1, [[26, 40], [44, 16]]); },
  osso: (c) => { traco(c, grad(c, 14, 50, 50, 14, '#e8dfc8', '#fbf7ea'), 9, [[20, 44], [44, 20]]); for (const [x, y] of [[15, 43], [21, 49], [43, 15], [49, 21]]) elipse(c, '#f6f0df', x, y, 6, 6); },
  corda: (c) => {   // rolo de corda
    for (let k = 0; k < 4; k++) { c.beginPath(); c.ellipse(32, 26 + k * 6, 20 - k * 0.6, 8, 0, 0, Math.PI * 2); c.strokeStyle = grad(c, 12, 20, 52, 52, k % 2 ? '#d9b77a' : '#c49a58', '#8f6a34'); c.lineWidth = 6; c.stroke(); }
    traco(c, '#b98d4c', 5, [[50, 44], [56, 56]]);
    for (let a = 0; a < 6; a++) traco(c, 'rgba(90,62,26,.45)', 1.2, [[14 + a * 7, 22], [18 + a * 7, 30]]);
  },
  cabresto: (c) => {   // cabeçada de corda com argola
    c.beginPath(); c.ellipse(28, 28, 16, 20, -0.3, 0, Math.PI * 2); c.strokeStyle = grad(c, 10, 8, 46, 50, '#d9b77a', '#8f6a34'); c.lineWidth = 5; c.stroke();
    traco(c, '#c49a58', 5, [[16, 20], [40, 34]]); traco(c, '#b98d4c', 5, [[40, 40], [56, 56]]);
    c.beginPath(); c.arc(41, 40, 5, 0, Math.PI * 2); c.strokeStyle = grad(c, 36, 35, 46, 45, '#e6e9ee', '#8b929c'); c.lineWidth = 3; c.stroke();
  },
  sela: (c) => {   // sela de perfil: assento, aba, loro e estribo
    c.beginPath(); c.moveTo(8, 26); c.bezierCurveTo(14, 12, 22, 16, 30, 22); c.bezierCurveTo(40, 28, 48, 20, 56, 14); c.bezierCurveTo(58, 26, 52, 36, 40, 36); c.lineTo(20, 36); c.bezierCurveTo(12, 36, 8, 32, 8, 26); c.closePath();
    c.fillStyle = grad(c, 8, 12, 56, 38, '#a8693a', '#5e3516'); c.fill();
    forma(c, grad(c, 18, 34, 44, 54, '#8a5328', '#4f2b12'), [[18, 34], [44, 34], [42, 50], [32, 55], [22, 50]]);
    traco(c, '#3b2010', 2.5, [[31, 36], [31, 50]]);
    c.beginPath(); c.moveTo(25, 50); c.lineTo(37, 50); c.lineTo(35, 60); c.lineTo(27, 60); c.closePath(); c.strokeStyle = grad(c, 25, 50, 37, 60, '#e6e9ee', '#8b929c'); c.lineWidth = 2.6; c.stroke();
    traco(c, 'rgba(255,220,170,.35)', 1.5, [[14, 24], [28, 25], [44, 26]]);
  },
  faca: (c) => { forma(c, grad(c, 30, 6, 44, 38, '#c9cfd6', '#7d858f'), [[40, 6], [46, 12], [30, 38], [22, 32]]); traco(c, grad(c, 12, 56, 26, 36, '#8a5a33', '#5a3719'), 8, [[14, 54], [25, 37]]); traco(c, '#d9b77a', 2, [[19, 40], [28, 44]]); },
  lanca: (c) => { traco(c, grad(c, 8, 58, 44, 20, '#8a5a33', '#b98452'), 4, [[8, 58], [44, 20]]); forma(c, grad(c, 40, 4, 58, 24, '#d5dae0', '#7d858f'), [[58, 4], [52, 22], [46, 18], [42, 12]]); traco(c, '#d9b77a', 2.2, [[40, 20], [46, 26]]); },
  arco: (c) => { c.beginPath(); c.moveTo(18, 6); c.bezierCurveTo(52, 16, 52, 48, 18, 58); c.strokeStyle = grad(c, 18, 6, 44, 58, '#b98452', '#6e4526'); c.lineWidth = 5; c.lineCap = 'round'; c.stroke(); traco(c, '#efe6d2', 1.4, [[18, 6], [18, 58]]); },
  flecha: (c) => { traco(c, '#b98452', 3, [[10, 54], [48, 16]]); forma(c, grad(c, 44, 6, 58, 20, '#d5dae0', '#7d858f'), [[58, 6], [52, 20], [48, 16], [44, 12]]); forma(c, '#f1ece0', [[10, 54], [8, 44], [16, 48]]); forma(c, '#e2dccd', [[10, 54], [20, 56], [16, 48]]); },
  racao: (c) => { forma(c, grad(c, 12, 20, 52, 58, '#cdbb86', '#8a7a46'), [[14, 24], [50, 24], [54, 56], [10, 56]]); traco(c, '#6e5f33', 2.5, [[18, 24], [26, 14], [38, 14], [46, 24]]); for (const [x, y] of [[24, 36], [34, 40], [42, 34], [28, 48], [40, 48]]) elipse(c, '#e6d9a8', x, y, 3, 2, 0.5); },
};

export function createObjIcones() {
  const feitos = new Map(), trocados = {};
  function icone(numero, tamanho = 64) {
    const k = numero + ':' + tamanho;
    let cv = feitos.get(k);
    if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = cv.height = tamanho;
    const c = cv.getContext('2d'), o = OBJ_POR_NUMERO.get(numero);
    if (o && trocados[o.id]) c.drawImage(trocados[o.id], 0, 0, tamanho, tamanho);
    else {
      c.scale(tamanho / 64, tamanho / 64);
      c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 3; c.shadowOffsetY = 1.5;
      const d = o && DESENHO[o.id];
      if (d) d(c);
      else { elipse(c, grad(c, 12, 12, 52, 52, '#7f8c99', '#3d4753'), 32, 32, 20, 20); c.shadowColor = 'transparent'; c.fillStyle = '#fff'; c.font = '700 22px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText((o?.nome || '?')[0], 32, 33); }
    }
    feitos.set(k, cv);
    return cv;
  }
  return { icone, trocar(mapa) { Object.assign(trocados, mapa); feitos.clear(); }, ids: () => Object.keys(OBJETOS) };
}
