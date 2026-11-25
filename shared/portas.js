// Kraft — portas feitas de QUALQUER bloco (pedido do Kadmus, 23/11/2026). Contas puras, iguais no servidor e no
// aparelho: quais células a porta ocupa fechada e aberta, para cada jeito de abrir (preset). Quem manda é o servidor
// (server/portas.js); o aparelho só usa isto para saber se o bloco clicado é de uma porta.
//
// Porta = retângulo vertical de w × h blocos. Origem o = canto de baixo à esquerda; eixo 'x' (a folha corre em x, a
// passagem é em z) ou 'z'; lado s = +1/-1 = para onde ela gira/tomba (o lado oposto a quem a criou: abre para dentro).

export const PORTA_MAX_W = 8, PORTA_MAX_H = 8, PORTAS_MAX = 400, AUTO_MAX = 120;

// id → { nome, auto (s em que fecha sozinha, 0 = não fecha) }
export const PRESETS_PORTA = Object.freeze({
  giro: { nome: 'Giro (dobradiça à esquerda)', auto: 0 },
  'giro-dir': { nome: 'Giro (dobradiça à direita)', auto: 0 },
  'giro-duplo': { nome: 'Giro duplo (duas folhas)', auto: 0 },
  correr: { nome: 'Correr para a esquerda', auto: 0 },
  'correr-dir': { nome: 'Correr para a direita', auto: 0 },
  dupla: { nome: 'Correr dupla (abre ao meio)', auto: 0 },
  subir: { nome: 'Levadiça (sobe)', auto: 0 },
  descer: { nome: 'Alçapão de parede (afunda no chão)', auto: 0 },
  ponte: { nome: 'Ponte levadiça (tomba para fora)', auto: 0 },
  sumir: { nome: 'Passagem secreta (some e fecha sozinha)', auto: 8 },
});
export const presetValido = (p) => Object.prototype.hasOwnProperty.call(PRESETS_PORTA, p);

const vet = (p) => ({ a: p.eixo === 'x' ? [1, 0, 0] : [0, 0, 1], n: p.eixo === 'x' ? [0, 0, p.s] : [p.s, 0, 0] });

// células da porta fechada: [[x, y, z], …]
export function celulasFechada(p) {
  const { a } = vet(p), out = [];
  for (let j = 0; j < p.h; j++) for (let i = 0; i < p.w; i++) out.push([p.x + a[0] * i, p.y + j, p.z + a[2] * i]);
  return out;
}

// células da porta aberta: a folha que gira fica em pé no lado de dentro, encostada no batente (a coluna da dobradiça
// também libera o vão: no voxel não existe meia volta). O que cair dentro de parede fica escondido ali dentro.
export function celulasAberta(p) {
  const { a, n } = vet(p), out = [], { w, h } = p;
  const em = (i, j, k, desl = 0) => [p.x + a[0] * (i + desl) + n[0] * k, p.y + j, p.z + a[2] * (i + desl) + n[2] * k];
  switch (p.preset) {
    case 'giro': for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) out.push(em(0, j, k + 1)); break;
    case 'giro-dir': for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) out.push(em(w - 1, j, k + 1)); break;
    case 'giro-duplo': {
      const L = Math.ceil(w / 2), R = w - L;
      for (let j = 0; j < h; j++) { for (let k = 0; k < L; k++) out.push(em(0, j, k + 1)); for (let k = 0; k < R; k++) out.push(em(w - 1, j, k + 1)); }
      break;
    }
    case 'correr': for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(em(i, j, 0, -w)); break;
    case 'correr-dir': for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(em(i, j, 0, w)); break;
    case 'dupla': {
      const L = Math.ceil(w / 2), R = w - L;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(em(i, j, 0, i < L ? -L : R));
      break;
    }
    case 'subir': for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(em(i, j + h, 0)); break;
    case 'descer': for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push(em(i, j - h, 0)); break;
    case 'ponte': for (let k = 0; k < h; k++) for (let i = 0; i < w; i++) out.push(em(i, 0, k + 1)); break;
    case 'sumir': default: break;
  }
  return out;
}

export const chaveCel = (x, y, z) => x + ',' + y + ',' + z;

// a porta "pega" o clique: o bloco é dela agora, ou fica no vão/no batente (para fechar a que sumiu ou subiu)
export function portaNoClique(p, x, y, z) {
  for (const c of p.cel || []) if (c[0] === x && c[1] === y && c[2] === z) return true;
  if (!p.aberta) return false;
  const x0 = p.x, z0 = p.z, x1 = p.eixo === 'x' ? p.x + p.w - 1 : p.x, z1 = p.eixo === 'x' ? p.z : p.z + p.w - 1;
  return x >= x0 - 1 && x <= x1 + 1 && z >= z0 - 1 && z <= z1 + 1 && y >= p.y - 1 && y <= p.y + p.h;
}
