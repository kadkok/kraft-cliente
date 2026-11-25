// Kraft — elevador de verdade (pedido do Kadmus, 23/11/2026): poço de vidro, portas de andar, cabine que sobe e desce
// levando quem está dentro, seletor de andares. Contas puras, iguais no servidor (server/elevador.js) e no aparelho
// (src/game/elevador.js): onde ficam o poço, as portas de cada andar e a altura da cabine a cada instante.
//
// Elevador = { id, x, z (canto do vão, o menor), w (largura em x), c (comprimento em z), frente ('x+','x-','z+','z-': o
// lado das portas), andares: [y dos pés em cada andar, crescente], andar (índice parado), mov: { de, para, dur } }.

export const ELEV_MIN = 1, ELEV_MAX = 5, ANDARES_MAX = 16, ALTURA_MIN = 3, ALTURA_MAX = 12, ALT_CAB = 3, VEL = 3;   // m/s
export const ELEV_MAX_N = 120;

export const dentroDoVao = (e, x, z) => x >= e.x && x < e.x + e.w && z >= e.z && z < e.z + e.c;

// duração (ms) da viagem entre dois andares
export const duracao = (e, de, para) => Math.max(600, Math.round(Math.abs(e.andares[para] - e.andares[de]) / VEL * 1000));

// altura do piso da cabine (y dos pés) com t ms desde a partida (sem viagem: o andar parado)
export function alturaCabine(e, t) {
  if (!e.mov) return e.andares[e.andar];
  const a = e.andares[e.mov.de], b = e.andares[e.mov.para], k = Math.max(0, Math.min(1, t / e.mov.dur));
  const s = k * k * (3 - 2 * k);   // arranca e freia suave
  return a + (b - a) * s;
}

// células da frente (portas do andar k): a parede do lado `frente`, na largura do vão, 2 blocos de altura
export function celulasPorta(e, k) {
  const y = e.andares[k], out = [];
  const fx = e.frente === 'x+' ? e.x + e.w : e.frente === 'x-' ? e.x - 1 : null;
  const fz = e.frente === 'z+' ? e.z + e.c : e.frente === 'z-' ? e.z - 1 : null;
  for (let dy = 0; dy < 2; dy++) {
    if (fx !== null) for (let z = e.z; z < e.z + e.c; z++) out.push([fx, y + dy, z]);
    else for (let x = e.x; x < e.x + e.w; x++) out.push([x, y + dy, fz]);
  }
  return out;
}

export const topoPoco = (e) => e.andares[e.andares.length - 1] + ALT_CAB + 1;

// paredes do poço (anel em volta do vão, do fundo ao topo), o piso do fundo e a tampa; sem as células de porta
export function celulasPoco(e) {
  const y0 = e.andares[0] - 1, y1 = topoPoco(e), portas = new Set();
  e.andares.forEach((_, k) => { for (const q of celulasPorta(e, k)) portas.add(q.join()); });
  const parede = [], fundo = [], tampa = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = e.x - 1; x <= e.x + e.w; x++) for (let z = e.z - 1; z <= e.z + e.c; z++) {
      const borda = x === e.x - 1 || x === e.x + e.w || z === e.z - 1 || z === e.z + e.c;
      if (borda) { if (!portas.has([x, y, z].join())) parede.push([x, y, z]); }
      else if (y === y0) fundo.push([x, y, z]);
      else if (y === y1) tampa.push([x, y, z]);
    }
  }
  return { parede, fundo, tampa };
}

// o vão de dentro (o que precisa estar livre para a cabine andar)
export function celulasVao(e) {
  const out = [];
  for (let y = e.andares[0]; y < topoPoco(e); y++) for (let x = e.x; x < e.x + e.w; x++) for (let z = e.z; z < e.z + e.c; z++) out.push([x, y, z]);
  return out;
}

// plataforma de chegada na frente de cada andar de cima (2 de fundo, largura do vão + 2), só onde houver ar
export function celulasPlataforma(e, k) {
  const y = e.andares[k] - 1, out = [];
  for (let p = 1; p <= 2; p++) {
    if (e.frente === 'x+' || e.frente === 'x-') {
      const x = e.frente === 'x+' ? e.x + e.w + p : e.x - 1 - p;
      for (let z = e.z - 1; z <= e.z + e.c; z++) out.push([x, y, z]);
    } else {
      const z = e.frente === 'z+' ? e.z + e.c + p : e.z - 1 - p;
      for (let x = e.x - 1; x <= e.x + e.w; x++) out.push([x, y, z]);
    }
  }
  return out;
}

export const nomeAndar = (k) => (k === 0 ? 'Térreo' : `${k}º andar`);
