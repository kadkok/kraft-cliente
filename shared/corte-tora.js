// Cada seção é metade dos 24 lados da tora. O nome da forma guarda a orientação
// no formato de objeto que o editor já sabe mover, copiar e salvar.
import { qConj, qRot, qMul, qEixo } from './pecas.js';
import { MADEIRA } from './machado.js';

export const LADOS_TORA = 24;
const PASSO = 2 * Math.PI / LADOS_TORA;
const secoes = new Map();
for (let inicio = 0; inicio < LADOS_TORA; inicio++) {
  const arco = [];
  for (let i = 0; i <= LADOS_TORA / 2; i++) {
    const a = ((inicio + i) % LADOS_TORA) * PASSO;
    arco.push([Math.sin(a) / 2, Math.cos(a) / 2]);
  }
  const xs = arco.map(p => p[0]), zs = arco.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const meio = (inicio + LADOS_TORA / 4) * PASSO;
  const s = 'meia-tora-' + inicio;
  secoes.set(s, { s, inicio, arco, nx: Math.sin(meio), nz: Math.cos(meio),
    cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 });
}
export const FORMAS_LENHA = [...secoes.keys()];
export const secaoTora = forma => secoes.get(forma);
export const eToraDeMadeira = o => o?.s === 'tora' && o.m?.t === 'b' && !!MADEIRA[o.m.b];
const vetor = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);

// Distância aos planos da face atingida e das pontas, em metros, mesmo numa
// tora elíptica ou muito comprida que o jogador acertou longe do centro.
function naSuperficie(k, local) {
  const [x, y, z] = local, rx = k[0] / 2, rz = k[2] / 2;
  const ang = Math.atan2(x / rx, z / rz);
  const meio = (Math.floor(ang / PASSO) + 0.5) * PASSO;
  const nx = Math.sin(meio) / rx, nz = Math.cos(meio) / rz;
  const lado = (nx * x + nz * z - Math.cos(PASSO / 2)) / Math.hypot(nx, nz);
  return Math.abs(Math.max(lado, Math.abs(y) - k[1] / 2)) <= 0.025;
}

export function dividirTora(o, ponto, direcao) {
  if (!eToraDeMadeira(o) || !vetor(ponto) || !vetor(direcao)) return null;
  if (Math.abs(Math.hypot(...direcao) - 1) > 0.02) return null;
  const inversa = qConj(o.q);
  const local = qRot(inversa, ponto.map((v, i) => v - o.p[i]));
  if (!naSuperficie(o.k, local)) return null;
  const dir = qRot(inversa, direcao);
  const topo = Math.hypot(dir[0], dir[2]) < 0.04;
  const ang = Math.atan2((topo ? local[0] : dir[0]) / o.k[0], (topo ? local[2] : dir[2]) / o.k[2]);
  const inicio = (Math.round(ang / PASSO) + LADOS_TORA) % LADOS_TORA;
  const diametro = Math.min(o.k[0], o.k[2]);
  const afastamento = Math.min(0.17, 0.13 * diametro);
  const vertical = qRot(o.q, [0, 1, 0])[1];
  // Uma peça em pé abre sobre o pé externo. A que está deitada mantém o eixo
  // de apoio; uma tora muito longa recebe apenas uma inclinação pequena.
  const inclinacao = Math.max(0, Math.abs(vertical) * 2 - 1) *
    Math.min(0.28, Math.atan2(Math.min(0.42, 0.42 * diametro), o.k[1]));
  return [inicio, (inicio + LADOS_TORA / 2) % LADOS_TORA].map(i => {
    const h = secaoTora(FORMAS_LENHA[i]);
    const nx = h.nx / o.k[0], nz = h.nz / o.k[2], n = Math.hypot(nx, nz);
    const ux = nx / n, uz = nz / n;
    const centro = [h.cx * o.k[0] + afastamento * ux, 0, h.cz * o.k[2] + afastamento * uz];
    let q = [...o.q];
    if (inclinacao > 0) {
      const sinal = Math.sign(vertical);
      const giro = qEixo(uz * sinal, 0, -ux * sinal, inclinacao);
      const borda = Math.max(...h.arco.map(([x,z]) => (x-h.cx)*o.k[0]*ux + (z-h.cz)*o.k[2]*uz));
      const doPe = [-ux * borda, sinal * o.k[1] / 2, -uz * borda];
      const girado = qRot(giro, doPe);
      for (let a = 0; a < 3; a++) centro[a] += girado[a] - doPe[a];
      q = qMul(o.q, giro);
    }
    const delta = qRot(o.q, centro);
    return { s: h.s, p: o.p.map((v, a) => v + delta[a]), q,
      k: [h.w * o.k[0], o.k[1], h.d * o.k[2]], m: { ...o.m }, f: o.f };
  });
}
