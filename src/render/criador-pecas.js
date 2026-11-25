// Kraft — criador de personagem: peças 3D em voxel presas nos ossos do boneco (cabelo, chapéu e óculos na cabeça;
// costas e pescoço no tronco). Tudo o que vai na mesma junta vira UMA malha com cor por vértice: no máximo duas
// malhas a mais por boneco (cabeça e tronco), com um material só, compartilhado por todos os bonecos.
// Medidas em unidades da skin (1/32 da altura do boneco, SKIN_UNIT); a frente do boneco é −Z.
// DESENHO PROVISÓRIO: formas simples de caixa, um primeiro traço do Claude. O Astra pode trocar as caixas por um
// desenho melhor mantendo os ids do catálogo (shared/criador.js) e o limite de peso (poucas centenas de triângulos).

import * as THREE from '../three.js';
import { SKIN_UNIT as U } from '../../shared/skin-atlas.js';

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 });
material.userData.shared = true;

// Cabeça: centro da cabeça = origem; cabeça de −4 a 4 nos três eixos (camada de fora até ±4,5).
// [cx, cy, cz, sx, sy, sz, tom (multiplica a cor), topo (some debaixo de chapéu)]
const CABELOS = {
  curto: [[0, 4.6, 0.3, 9.4, 1.4, 9, 1, 1], [-4.7, 2.4, 0.8, 0.6, 3, 7.4, 0.92], [4.7, 2.4, 0.8, 0.6, 3, 7.4, 0.92], [0, 1.8, 4.7, 9.4, 4.4, 0.6, 0.88], [0, 3.6, -4.65, 9.4, 0.9, 0.5, 1.04]],
  espetado: null, franja: null, longo: null, rabo: null, coque: null, trancas: null,
  volume: [[0, 5.2, 0.5, 11, 3, 11, 1, 1], [-5.3, 1.6, 0.6, 1.6, 5.8, 10, 0.9], [5.3, 1.6, 0.6, 1.6, 5.8, 10, 0.9], [0, 1.2, 5.3, 11, 6.6, 1.6, 0.86], [0, 4, -5.1, 11, 1.6, 1, 1.05]],
  moicano: [[0, 5.5, 0.5, 1.8, 2.6, 9.6, 1, 1], [0, 2.5, 4.75, 1.8, 4, 0.6, 0.9]],
};
const base = CABELOS.curto;
CABELOS.espetado = [...base, ...[[-3, 5.9, -1.5, 1.6, 1.6, 1.6, 1.08], [-1, 6.3, 0, 1.7, 2, 1.7, 1], [1.2, 6, -1.8, 1.6, 1.6, 1.6, 1.1], [3, 6.1, 0.6, 1.6, 1.8, 1.6, 0.95], [0.2, 6.6, 1.8, 1.7, 2.2, 1.7, 1.04], [-2.2, 6, 2.4, 1.6, 1.6, 1.6, 0.92]].map((b) => [...b, 1])];
CABELOS.franja = [...base, [0, 2.9, -4.75, 9.4, 2.2, 0.6, 1.06], [-2.4, 1.6, -4.8, 4.2, 0.9, 0.5, 1]];
CABELOS.longo = [...base, [0, -1.6, 4.8, 9.4, 11, 0.7, 0.84], [-4.8, -0.2, 1.2, 0.7, 8.4, 6, 0.9], [4.8, -0.2, 1.2, 0.7, 8.4, 6, 0.9]];
CABELOS.rabo = [...base, [0, 2.2, 5.25, 2.2, 2, 1, 0.7], [0, -1.6, 5.7, 1.8, 6, 1.4, 0.92], [0, -4.8, 5.8, 1.3, 1.6, 1.1, 0.86]];
CABELOS.coque = [...base, [0, 5.7, 2.4, 3.6, 3, 3.6, 1.06, 1], [0, 4.3, 2.4, 2.6, 0.6, 2.6, 0.7, 1]];
CABELOS.trancas = [...base, ...[-1, 1].flatMap((s) => [0, 1, 2, 3, 4].map((k) => [s * 4.4, -0.5 - k * 1.5, -2.6, 1.4, 1.4, 1.4, k % 2 ? 0.88 : 1]))];

const CHAPEUS = {
  bone: [[0, 4.9, 0.2, 9.6, 1.8, 9.6, 1, 0], [0, 4.25, -6.1, 8.6, 0.5, 4.2, 0.85], [0, 5.95, 0.2, 1, 0.5, 1, 1.25]],
  gorro: [[0, 4.6, 0, 9.8, 3.2, 9.8, 1], [0, 3, 0, 10.2, 1, 10.2, 0.8], [0, 6.8, 0, 2, 2, 2, 1.35]],
  'aba-larga': [[0, 5.7, 0, 8.2, 3, 8.2, 1], [0, 4.3, 0, 15, 0.5, 15, 0.92], [0, 4.8, 0, 8.4, 0.7, 8.4, 0.6]],
  cartola: [[0, 7.6, 0, 7.4, 6, 7.4, 1], [0, 4.5, 0, 11, 0.5, 11, 0.9], [0, 5.1, 0, 7.6, 1, 7.6, 0.55]],
  coroa: [[0, 5, 0, 9.6, 1.4, 9.6, 1], ...[[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2], [0, -4.4], [0, 4.4], [-4.4, 0], [4.4, 0]].map(([x, z]) => [x, 6.4, z, 1.2, 1.6, 1.2, 1.1]), [0, 5, -4.9, 1.2, 1.2, 0.4, 1.6]],
  faixa: [[0, 2.9, 0, 9.6, 1, 9.6, 1]],
};
const lente = (x, g) => [[x, 0.9, -4.75, 2.8, g, 0.3], [x, -1.4, -4.75, 2.8, g, 0.3], [x - 1.35, -0.25, -4.75, g, 2.5, 0.3], [x + 1.35, -0.25, -4.75, g, 2.5, 0.3]];
const hastes = [[0, 0.4, -4.75, 0.6, 0.35, 0.3], [-4.75, 0.4, -2.3, 0.3, 0.35, 4.8], [4.75, 0.4, -2.3, 0.3, 0.35, 4.8]];
const OCULOS = {
  redondos: [...lente(-1.5, 0.3), ...lente(1.5, 0.3), ...hastes],
  quadrados: [...lente(-1.5, 0.5), ...lente(1.5, 0.5), ...hastes],
  viseira: [[0, -0.2, -4.8, 9.2, 1.9, 0.35, 1], [0, 0.85, -4.85, 9.2, 0.3, 0.35, 1.3], ...hastes.slice(1)],
  escuros: [...lente(-1.5, 0.4), ...lente(1.5, 0.4), ...hastes, [-1.5, -0.25, -4.7, 2.5, 2, 0.2, 0.35], [1.5, -0.25, -4.7, 2.5, 2, 0.2, 0.35]],
};
// Tronco: origem nos pés; o tronco vai de y 12 a 24, z de −2 a 2 (costas em +Z).
const COSTAS = {
  capa: [[0, 13.2, 2.75, 8.6, 11.4, 0.4, 1], [0, 23.6, 1.6, 8.8, 0.8, 1.8, 0.8], [0, 7.7, 2.75, 8.6, 0.4, 0.42, 0.75]],
  mochila: [[0, 17, 3.3, 6, 7, 2.4, 1], [0, 20, 3.4, 6.2, 1.6, 2.6, 0.82], [0, 15, 4.6, 3.6, 2.4, 0.4, 0.9], [-2.2, 18.5, -2.3, 1, 6.5, 0.3, 0.7], [2.2, 18.5, -2.3, 1, 6.5, 0.3, 0.7], [-2.2, 24.15, 0.4, 1, 0.3, 5, 0.7], [2.2, 24.15, 0.4, 1, 0.3, 5, 0.7]],
  foguete: [[-1.6, 17.2, 3.4, 2.6, 7, 2.6, 1], [1.6, 17.2, 3.4, 2.6, 7, 2.6, 1], [-1.6, 13, 3.4, 1.6, 1.4, 1.6, 0.45], [1.6, 13, 3.4, 1.6, 1.4, 1.6, 0.45], [0, 18, 2.9, 1.4, 4.4, 1.6, 0.7], [-1.6, 21, 3.4, 2.8, 0.6, 2.8, 1.25], [1.6, 21, 3.4, 2.8, 0.6, 2.8, 1.25]],
};
const PESCOCO = {
  cachecol: [[0, 23.3, 0, 9.2, 1.6, 4.8, 1], [1.8, 19.9, -2.6, 1.8, 5, 0.5, 0.9], [1.8, 17.2, -2.6, 1.8, 0.6, 0.55, 0.75]],
  colar: [[0, 22.5, -2.3, 4, 0.35, 0.3, 1], [-2, 23.2, -2.25, 0.35, 1.2, 0.3, 1], [2, 23.2, -2.25, 0.35, 1.2, 0.3, 1], [0, 21.8, -2.35, 0.9, 0.9, 0.35, 1.4]],
  gravata: [[0, 23.1, -2.3, 1, 1, 0.35, 0.85], [0, 19.9, -2.3, 1.3, 5.2, 0.28, 1], [0, 17.1, -2.3, 0.8, 0.7, 0.28, 0.9]],
};
export const PECAS = { CABELOS, CHAPEUS, OCULOS, COSTAS, PESCOCO };

function caixas(criador) {
  const cabeca = [], tronco = [];
  const ac = criador?.acess || {};
  const chapeu = ac.chapeu && ac.chapeu.id !== 'faixa' ? ac.chapeu : null;
  if (criador?.cabelo) for (const b of CABELOS[criador.cabelo.estilo] || []) if (!(chapeu && b[7])) cabeca.push([b, criador.cabelo.cor]);
  if (ac.chapeu) for (const b of CHAPEUS[ac.chapeu.id] || []) cabeca.push([b, ac.chapeu.cor]);
  if (ac.oculos) for (const b of OCULOS[ac.oculos.id] || []) cabeca.push([b, ac.oculos.id === 'escuros' && b[6] < 0.5 ? '#1c2228' : ac.oculos.cor]);
  if (ac.costas) for (const b of COSTAS[ac.costas.id] || []) tronco.push([b, ac.costas.cor]);
  if (ac.pescoco) for (const b of PESCOCO[ac.pescoco.id] || []) tronco.push([b, ac.pescoco.cor]);
  return { cabeca, tronco };
}

const caixa = new THREE.BoxGeometry(1, 1, 1);
function malha(lista, dy) {
  if (!lista.length) return null;
  const n = caixa.index.count, pos = new Float32Array(lista.length * n * 3), nor = new Float32Array(lista.length * n * 3), cor = new Float32Array(lista.length * n * 3);
  const P = caixa.attributes.position, N = caixa.attributes.normal, c = new THREE.Color();
  let o = 0;
  lista.forEach(([[cx, cy, cz, sx, sy, sz, tom = 1], hex], k) => {
    c.set(hex).convertSRGBToLinear();
    const varia = tom * (0.95 + 0.1 * (((k * 2654435761) >>> 0) % 97) / 97);
    for (const i of caixa.index.array) {
      // sombra leve embaixo de cada caixa (a face de baixo mais escura): dá volume sem textura
      const f = varia * (N.getY(i) < -0.5 ? 0.72 : N.getY(i) > 0.5 ? 1.08 : 1);
      pos[o] = (P.getX(i) * sx + cx) * U; pos[o + 1] = (P.getY(i) * sy + cy + dy) * U; pos[o + 2] = (P.getZ(i) * sz + cz) * U;
      nor[o] = N.getX(i); nor[o + 1] = N.getY(i); nor[o + 2] = N.getZ(i);
      cor[o] = Math.min(1, c.r * f); cor[o + 1] = Math.min(1, c.g * f); cor[o + 2] = Math.min(1, c.b * f);
      o += 3;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(cor, 3));
  g.computeBoundingSphere();
  return g;
}

// Veste (ou tira, com criador null) as peças 3D do criador no boneco. Reconstrói só o que mudou.
export function vestirCriador(body, criador) {
  const atual = body.pecasCriador ||= { chave: '', malhas: [] };
  const { cabeca, tronco } = caixas(criador);
  const chave = JSON.stringify([cabeca, tronco]);
  if (chave === atual.chave) return;
  for (const m of atual.malhas) { m.removeFromParent(); m.geometry.dispose(); }
  atual.malhas = [];
  atual.chave = chave;
  // quanto o que está na cabeça passa da altura do nome flutuante (avatars.js sobe o nome isso)
  const topo = cabeca.reduce((t, [b]) => Math.max(t, b[1] + b[4] / 2), 0);
  atual.extraTopo = Math.max(0, topo - 8) * U;
  for (const [lista, junta, dy] of [[cabeca, body.head, 4], [tronco, body.head?.parent, 0]]) {
    const g = junta && malha(lista, dy);
    if (!g) continue;
    const m = new THREE.Mesh(g, material);
    m.name = 'criador-' + (junta === body.head ? 'cabeca' : 'tronco');
    m.castShadow = m.receiveShadow = true;
    junta.add(m);
    atual.malhas.push(m);
  }
}

// Proporções (só visual): escala o osso raiz a partir dos pés. Não mexe na caixa de colisão de ninguém.
export function proporcaoCriador(body, prop) {
  const raiz = body.head?.parent;
  if (!raiz) return;
  raiz.scale.set(prop?.largura || 1, prop?.altura || 1, prop?.largura || 1);
}
