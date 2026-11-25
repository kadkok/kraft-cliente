// Kraft — "Mockup para IA": desenhos do pacote, feitos com o MESMO boneco e o mesmo compositor do jogo
// (buildBody + aplicarSkin): a folha com frente, costas e laterais, o guia 640×640 do atlas e as medidas tiradas da
// malha de verdade (orientação de cada face na UV e caixa máxima das peças 3D de cada slot). Nada sai do aparelho.

import * as THREE from '../three.js';
import { buildBody } from './avatars.js';
import { aplicarSkin, limparSkin } from './estudio-skins.js';
import { minecraftGeometry } from './minecraft-avatar.js';
import { PECAS } from './criador-pecas.js';
import { SKIN_UNIT as U, skinParts } from '../../shared/skin-atlas.js';
import { PARTES, FACES, listaFaces, gabarito64, corGabarito } from '../../shared/mockup-ia.js';

export function canvasDe(rgba, lado = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = lado;
  c.getContext('2d').putImageData(new ImageData(rgba, lado, lado), 0, 0);
  return c;
}
export const pngDe = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error('PNG não gerado.')), 'image/png'));

// Orientação MEDIDA na malha do jogo: para cada face, para onde apontam a direita e o "para baixo" do desenho no
// atlas. Regressão linear da posição dos vértices contra a coordenada no atlas (só vértices do miolo da face).
const EIXOS = [['+X', 'direita do personagem'], ['-X', 'esquerda do personagem'], ['+Y', 'cima'], ['-Y', 'baixo'], ['+Z', 'costas'], ['-Z', 'frente']];
function eixo(v) {
  const a = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])], k = a.indexOf(Math.max(...a));
  const [nome, txt] = EIXOS[k * 2 + (v[k] < 0 ? 1 : 0)];
  return `${nome} (${txt})`;
}
export function orientacaoFaces(slim = false) {
  const g = minecraftGeometry(slim, false), P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv;
  const NORMAIS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const res = {};
  for (const f of listaFaces(slim)) {
    if (f.camada !== 'dentro') continue;
    const [x, y, w, h] = f.rect, n = NORMAIS[FACES.indexOf(f.face)];
    const pts = [];
    for (let i = 0; i < P.count; i++) {
      const ax = UV.getX(i) * 64, ay = (1 - UV.getY(i)) * 64;
      if (ax < x + 0.01 || ax > x + w - 0.01 || ay < y + 0.01 || ay > y + h - 0.01) continue;
      if (N.getX(i) * n[0] + N.getY(i) * n[1] + N.getZ(i) * n[2] < 0.9) continue;
      pts.push([ax, ay, P.getX(i), P.getY(i), P.getZ(i)]);
    }
    if (pts.length < 3) continue;
    // mínimos quadrados: pos = a·ax + b·ay + c, para cada eixo
    const m = pts.length, sx = pts.reduce((s, p) => s + p[0], 0) / m, sy = pts.reduce((s, p) => s + p[1], 0) / m;
    let xx = 0, yy = 0, xy = 0;
    for (const p of pts) { xx += (p[0] - sx) ** 2; yy += (p[1] - sy) ** 2; xy += (p[0] - sx) * (p[1] - sy); }
    const det = xx * yy - xy * xy || 1e-9, a = [0, 0, 0], b = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const sk = pts.reduce((s, p) => s + p[2 + k], 0) / m;
      let xk = 0, yk = 0;
      for (const p of pts) { xk += (p[0] - sx) * (p[2 + k] - sk); yk += (p[1] - sy) * (p[2 + k] - sk); }
      a[k] = (yy * xk - xy * yk) / det; b[k] = (xx * yk - xy * xk) / det;
    }
    const item = { direita_do_desenho: eixo(a), baixo_do_desenho: eixo(b) };
    const atual = res[f.face];
    if (!atual) res[f.face] = item;
    else if (atual.direita_do_desenho !== item.direita_do_desenho || atual.baixo_do_desenho !== item.baixo_do_desenho) res[`${f.parte}.${f.face}`] = item;
  }
  return res;
}

// Caixa máxima (unidades de skin, 1/32 da altura do boneco) que cada slot ocupa somando todas as opções da lista.
// Cabeça: origem no centro da cabeça (a cabeça vai de −4 a 4). Tronco: origem nos pés (tronco de y 12 a 24).
export function caixasSlots() {
  const caixa = (grupo) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const lista of Object.values(grupo)) for (const b of lista || []) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b[k] - b[k + 3] / 2); max[k] = Math.max(max[k], b[k] + b[k + 3] / 2);
    }
    const r = (v) => Math.round(v * 100) / 100;
    return { min: min.map(r), max: max.map(r) };
  };
  return {
    cabelo: { ...caixa(PECAS.CABELOS), origem: 'centro da cabeça' },
    chapeu: { ...caixa(PECAS.CHAPEUS), origem: 'centro da cabeça' },
    oculos: { ...caixa(PECAS.OCULOS), origem: 'centro da cabeça' },
    costas: { ...caixa(PECAS.COSTAS), origem: 'pés (tronco de y 12 a 24)' },
    pescoco: { ...caixa(PECAS.PESCOCO), origem: 'pés (tronco de y 12 a 24)' },
  };
}

// Guia 640×640 (mesmo lado do atlas do jogo): gabarito ampliado, grade de 1 px, contorno e nome de cada face, camada
// de fora hachurada. Sobreposto 1:1 a uma skin de 640 ou 10× a uma de 64.
const CURTO = { cabeca: 'CABEÇA', tronco: 'TRONCO', bracoD: 'BR. DIR', bracoE: 'BR. ESQ', pernaD: 'PERNA DIR', pernaE: 'PERNA ESQ' };
export function guia640(slim = false) {
  const c = document.createElement('canvas');
  c.width = c.height = 640;
  const g = c.getContext('2d');
  g.fillStyle = '#10161c';
  g.fillRect(0, 0, 640, 640);
  g.imageSmoothingEnabled = false;
  g.drawImage(canvasDe(gabarito64(slim)), 0, 0, 640, 640);
  g.strokeStyle = 'rgba(255,255,255,.10)';
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i <= 64; i++) { g.moveTo(i * 10 + .5, 0); g.lineTo(i * 10 + .5, 640); g.moveTo(0, i * 10 + .5); g.lineTo(640, i * 10 + .5); }
  g.stroke();
  for (const f of listaFaces(slim)) {
    const [x, y, w, h] = f.rect.map((v) => v * 10), [r, gg, b] = corGabarito(f.parte, f.face);
    if (f.camada === 'fora') {
      g.save();
      g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.strokeStyle = `rgba(${r},${gg},${b},.55)`;
      for (let k = -h; k < w; k += 8) { g.beginPath(); g.moveTo(x + k, y + h); g.lineTo(x + k + h, y); g.stroke(); }
      g.restore();
      g.setLineDash([4, 3]);
    }
    g.strokeStyle = f.camada === 'fora' ? 'rgba(255,255,255,.7)' : 'rgba(0,0,0,.85)';
    g.lineWidth = f.camada === 'fora' ? 1 : 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    g.setLineDash([]);
    // nome da face (2 linhas quando cabe): parte / face (+ "fora")
    const fs = Math.max(7, Math.min(11, Math.floor(Math.min(w / 5.2, h / 3))));
    g.font = `600 ${fs}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = f.camada === 'fora' ? '#ffffff' : '#081016';
    g.strokeStyle = f.camada === 'fora' ? 'rgba(0,0,0,.75)' : 'rgba(255,255,255,.55)';
    g.lineWidth = 3;
    g.lineJoin = 'round';
    const l1 = CURTO[f.parte], l2 = f.face + (f.camada === 'fora' ? ' · fora' : '');
    const escrever = (t, tx, ty) => { g.strokeText(t, tx, ty, w - 4); g.fillText(t, tx, ty, w - 4); };
    if (h >= fs * 2.6) { escrever(l1, x + w / 2, y + h / 2 - fs * .62); escrever(l2, x + w / 2, y + h / 2 + fs * .62); }
    else escrever(l2, x + w / 2, y + h / 2);
    g.lineWidth = 1;
  }
  return c;
}

// Pontos dos slots no boneco (para marcar na folha). [osso, x, y, z em unidades, direção para fora]
const PONTOS = [
  ['chapeu', 'head', 0, 9.2, 0, [0, 1, 0]],
  ['oculos', 'head', 0, 4.4, -4.9, [0, 0, -1]],
  ['cabelo', 'head', 0, 7.2, 4.8, [0, 0, 1]],
  ['pescoco', 'root', 0, 23, -2.4, [0, 0, -1]],
  ['costas', 'root', 0, 17, 3.4, [0, 0, 1]],
];
export const NOMES_SLOT = { chapeu: 'Chapéu', oculos: 'Óculos', cabelo: 'Cabelo', pescoco: 'Pescoço', costas: 'Costas' };
const VISTAS = [['Frente', 0], ['Costas', 180], ['Lado direito do personagem', 90], ['Lado esquerdo do personagem', -90]];

// Folha do mockup: linha 1 = o boneco como está (com peças 3D e pontos dos slots); linha 2 = o gabarito no boneco
// (mostra onde cada região do atlas cai). Devolve um canvas.
export async function folhaMockup({ skin, url, nome = '', data = '' }) {
  const VW = 360, VH = 520, M = 20, TOPO = 78, W = M + VISTAS.length * (VW + M), H = TOPO + 2 * (VH + 34) + 150;
  const folha = document.createElement('canvas');
  folha.width = W; folha.height = H;
  const g = folha.getContext('2d');
  g.fillStyle = '#0d1620'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#e8f3f2'; g.font = '700 30px system-ui, sans-serif'; g.textBaseline = 'top';
  g.fillText('Kraft · mockup do personagem para IA', M, 18);
  g.font = '16px system-ui, sans-serif'; g.fillStyle = '#9fc2c9';
  g.fillText(`${nome ? nome + ' · ' : ''}vistas ortográficas do boneco do jogo (1,8 m, frente = −Z) · ${data}`, M, 54);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(VW, VH, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const sky = new THREE.HemisphereLight(0xf1f5ff, 0x3c4758, 2.2), key = new THREE.DirectionalLight(0xfff0d5, 2.4);
  scene.add(sky, key);
  const alto = 2.7, cam = new THREE.OrthographicCamera(-alto * VW / VH / 2, alto * VW / VH / 2, alto / 2, -alto / 2, .1, 20);
  const slim = !!(skin?.criador?.corpo ? skin.criador.corpo.fino : skin?.base?.slim);
  const linhas = [
    { titulo: 'Como está agora (peças 3D nos slots)', preparar: (body) => aplicarSkin(body, skin, url), pontos: true },
    { titulo: 'Gabarito no boneco: onde cada região do atlas aparece', preparar: (body) => aplicarSkin(body, {}, url, { base: canvasDe(gabarito64(slim)), slim }) },
  ];
  try {
    for (const [li, linha] of linhas.entries()) {
      const body = buildBody();
      scene.add(body.root);
      try {
        await linha.preparar(body);
        body.root.updateMatrixWorld(true);
        const y0 = TOPO + li * (VH + 34);
        g.fillStyle = '#cfe7e4'; g.font = '600 17px system-ui, sans-serif';
        g.fillText(linha.titulo, M, y0 + 4);
        for (const [vi, [rotulo, graus]] of VISTAS.entries()) {
          const a = graus * Math.PI / 180, x0 = M + vi * (VW + M), yv = y0 + 28;
          cam.position.set(Math.sin(a) * 6, 1.15, -Math.cos(a) * 6);
          cam.lookAt(0, 1.15, 0);
          cam.updateMatrixWorld(true);
          key.position.set(Math.sin(a - .5) * 3, 3, -Math.cos(a - .5) * 3);
          renderer.setClearColor(0x16222d, 1);
          renderer.render(scene, cam);
          g.drawImage(renderer.domElement, x0, yv, VW, VH);
          g.strokeStyle = '#2c4252'; g.strokeRect(x0 + .5, yv + .5, VW - 1, VH - 1);
          g.fillStyle = '#e8f3f2'; g.font = '600 15px system-ui, sans-serif';
          g.fillText(rotulo, x0 + 10, yv + 10);
          if (!linha.pontos) continue;
          const para = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
          PONTOS.forEach(([slot, osso, px, py, pz, dir], k) => {
            const n = new THREE.Vector3(...dir);
            if (n.y < .5 && n.dot(para) < .15) return;
            const junta = osso === 'head' ? body.head : body.head.parent;
            const p = junta.localToWorld(new THREE.Vector3(px * U, (py + (osso === 'head' ? 4 : 0)) * U, pz * U)).project(cam);
            const sx = x0 + (p.x + 1) / 2 * VW, sy = yv + (1 - p.y) / 2 * VH;
            g.beginPath(); g.arc(sx, sy, 10, 0, Math.PI * 2);
            g.fillStyle = 'rgba(255,214,90,.92)'; g.fill();
            g.strokeStyle = '#1b1300'; g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
            g.fillStyle = '#1b1300'; g.font = '700 13px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(String(k + 1), sx, sy + .5);
            g.textAlign = 'left'; g.textBaseline = 'top';
          });
        }
      } finally {
        scene.remove(body.root);
        limparSkin(body);
        body.dispose();
      }
    }
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
  // legenda
  const yl = TOPO + 2 * (VH + 34) + 8;
  g.font = '600 16px system-ui, sans-serif'; g.fillStyle = '#ffd65a'; g.textBaseline = 'top';
  g.fillText(`Slots: ${PONTOS.map(([s], k) => `${k + 1} ${NOMES_SLOT[s]}`).join('   ')}`, M, yl);
  g.font = '15px system-ui, sans-serif'; g.fillStyle = '#cfe7e4';
  let x = M;
  for (const p of PARTES) {
    const [r, gg, b] = corGabarito(p.chave, 'frente');
    g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(x, yl + 34, 18, 18);
    g.fillStyle = '#cfe7e4'; g.fillText(p.nome, x + 24, yl + 35);
    x += 24 + g.measureText(p.nome).width + 26;
  }
  g.fillStyle = '#9fc2c9';
  g.fillText('Cada face tem um tom (topo mais claro, base mais escura); 2 px claros marcam a linha de cima da face; o ponto escuro marca o centro da frente.', M, yl + 66);
  g.fillText('Direita/esquerda são as do personagem. As peças 3D só existem nas opções da lista da ficha; a camada de fora fica 0,25–0,5 px acima da de dentro.', M, yl + 90);
  return folha;
}

// Medidas que entram na ficha (para a IA): orientação das faces e caixas dos slots, tiradas do código de hoje.
export function medidasRenderer() {
  return { orientacao: orientacaoFaces(false), caixas: caixasSlots(), partes: skinParts(false).map((p) => p.name) };
}
