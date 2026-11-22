// LAVRA — a natureza viva: tempo (céu limpo, chuva, tempestade...) e grupos de bichos (cardumes, rebanhos, bandos
// de pássaros, enxames de insetos). Código puro, dividido por servidor e cliente.
//
// A ideia é uma "mecânica estatística determinística":
//   · ESTATÍSTICA: o que cada grupo e o céu fazem a seguir sai de probabilidades. Quem as dá é o Jev (server/jev.js),
//     olhando o estado do mundo; sem ele, valem as tabelas daqui.
//   · DETERMINÍSTICA: o sorteio usa números tirados da semente do mundo (mesma entrada, mesmo resultado), e o
//     movimento de cada indivíduo é uma função fechada de (grupo, índice, instante). O servidor só manda o estado do
//     grupo; cada aparelho calcula as mesmas posições, sem trocar mensagens por bicho.

// ---- sorteio determinístico ---------------------------------------------------------------------------------
export function hash32(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export const rand01 = (a, b = 0, c = 0) => hash32(a, b, c) / 4294967296;

// Escolhe uma chave de { chave: peso } com u em [0, 1). As chaves são percorridas em ordem alfabética, então o
// resultado não depende da ordem em que o objeto foi montado. Pesos inválidos contam zero.
export function pick(probs, u) {
  const keys = Object.keys(probs).sort();
  let total = 0;
  for (const k of keys) { const p = Number(probs[k]); if (p > 0) total += p; }
  if (!(total > 0)) return keys[0];
  let acc = 0;
  for (const k of keys) {
    const p = Number(probs[k]);
    if (!(p > 0)) continue;
    acc += p / total;
    if (u < acc) return k;
  }
  return keys[keys.length - 1];
}

// ---- tempo ----------------------------------------------------------------------------------------------------
// cover = fração do céu coberta; rain = força da chuva; fog = neblina; wind = faixa do vento (m/s); raios = pode relampejar
export const WEATHER = {
  limpo: { nome: 'céu limpo', cover: 0.3, rain: 0, fog: 0, wind: [0, 3], raios: false },
  nublado: { nome: 'nublado', cover: 0.7, rain: 0, fog: 0.1, wind: [1, 5], raios: false },
  neblina: { nome: 'neblina', cover: 0.6, rain: 0, fog: 0.85, wind: [0, 1.5], raios: false },
  garoa: { nome: 'garoa', cover: 0.8, rain: 0.25, fog: 0.25, wind: [1, 5], raios: false },
  chuva: { nome: 'chuva', cover: 0.92, rain: 0.65, fog: 0.35, wind: [3, 8], raios: false },
  tempestade: { nome: 'tempestade', cover: 1, rain: 1, fog: 0.5, wind: [8, 16], raios: true, escuro: 0.3 },
  // temporal (19/11/2026, pedido do Kadmus): a tempestade severa. É a única que faz dano natural (server/temporal.js).
  // escuro = quanto as nuvens fecham além do céu coberto (0 = nada … 1 = dia virando noite).
  temporal: { nome: 'temporal', cover: 1, rain: 1, fog: 0.65, wind: [18, 30], raios: true, escuro: 1 },
};
export const WEATHER_KINDS = Object.keys(WEATHER);
// Sem o Jev: para onde o tempo costuma ir a partir de cada estado.
export const WEATHER_NEXT = {
  // 21/11/2026 (Kadmus: "só fica chovendo, eu quero ver dias ensolarados e outros tempos"): o tempo deixou de copiar o
  // de Ipatinga (LAVRA_TEMPO_REAL=0 no serviço) e esta tabela foi puxada para o sol. Na média longa: ~65% limpo,
  // ~21% nublado, ~4% neblina, ~5% garoa, ~4% chuva, ~1% tempestade; um céu limpo dura em média uns 13 min (Hermes).
  limpo: { limpo: 0.85, nublado: 0.12, neblina: 0.03 },
  nublado: { limpo: 0.35, nublado: 0.4, garoa: 0.12, chuva: 0.08, neblina: 0.05 },
  neblina: { limpo: 0.5, nublado: 0.3, neblina: 0.2 },
  garoa: { limpo: 0.15, nublado: 0.4, garoa: 0.25, chuva: 0.2 },
  chuva: { nublado: 0.3, garoa: 0.25, chuva: 0.3, tempestade: 0.15 },
  tempestade: { nublado: 0.25, chuva: 0.45, tempestade: 0.27, temporal: 0.03 },
  temporal: { tempestade: 0.7, chuva: 0.3 },
};
// Temporal: muito raro e passageiro, "para não destruir tudo" (Kadmus, 19/11). Tempos em segundos de verdade.
export const TEMPORAL = {
  dura: [300, 600],       // quanto dura ("rápido mas não tanto, uns 5 a 10 minutos" — Kadmus): passa sozinho para tempestade, mesmo fixado por comando
  descanso: 6 * 3600,     // depois de um, a natureza não traz outro antes disto (o comando /clima temporal pode)
  ventoDano: 17,          // m/s: daqui para cima o vento derruba árvore
  arvores: 5,             // teto de árvores derrubadas (vento + raio) perto de cada pessoa, por temporal
  raioCada: 0.4,          // os raios caem neste fator do intervalo da tempestade comum
  raioParte: 0.5,         // chance de o raio partir a árvore em que cai
  longe: 12,              // nada cai a menos disto (m) de um pedaço de mundo com obra de alguém
};

// Vento em m/s a partir do tipo de tempo e de uma força 0..1 dentro da faixa dele; a direção gira devagar com a hora.
export function windOf(kind, force, seed, t) {
  const w = WEATHER[kind] || WEATHER.limpo;
  const v = w.wind[0] + (w.wind[1] - w.wind[0]) * Math.max(0, Math.min(1, force));
  const a = (seed % 6283) / 1000 + t * 0.0007;
  return [Math.cos(a) * v, Math.sin(a) * v];
}

// ---- grupos de bichos ----------------------------------------------------------------------------------------
// n = tamanho do grupo; raio = espalhamento (m); vel = passo normal (m/s); corre = em fuga; modos: o primeiro é o de repouso.
export const SWARMS = {
  cardume: { nome: 'cardume de peixes', n: [16, 34], raio: 3, vel: 1.4, corre: 5.5, habitat: 'agua', modos: ['nadar', 'alimentar', 'abrigar', 'migrar', 'fugir'] },
  palhaco: { nome: 'peixe-palhaço', n: [2, 5], raio: 2.2, vel: 1.1, corre: 4.4, habitat: 'recife', depth: [1, 22], modos: ['nadar', 'forragear', 'abrigar', 'descansar', 'curioso', 'fugir'] },
  salmao: { nome: 'cardume de salmões', n: [6, 12], raio: 3.6, vel: 2.1, corre: 6.2, habitat: 'pelagico', depth: [3, 28], modos: ['nadar', 'forragear', 'migrar', 'descansar', 'curioso', 'fugir'] },
  atum: { nome: 'cardume de atuns', n: [4, 8], raio: 4.2, vel: 2.9, corre: 7.5, habitat: 'pelagico', depth: [5, 34], modos: ['nadar', 'forragear', 'migrar', 'descansar', 'curioso', 'fugir'] },
  agulhao: { nome: 'agulhão', n: [1, 3], raio: 4.5, vel: 3.3, corre: 8.5, habitat: 'pelagico', depth: [5, 36], modos: ['nadar', 'forragear', 'migrar', 'descansar', 'curioso', 'fugir'] },
  tubarao: { nome: 'tubarão', n: [1, 2], raio: 6.0, vel: 2.4, corre: 7.2, habitat: 'abissal', depth: [10, 44], modos: ['patrulhar', 'nadar', 'forragear', 'descansar', 'curioso', 'fugir'] },
  arraia: { nome: 'arraia-manta', n: [1, 3], raio: 4.0, vel: 1.7, corre: 4.8, habitat: 'fundo', depth: [3, 28], modos: ['planar', 'nadar', 'forragear', 'descansar', 'curioso', 'fugir'] },
  tartaruga: { nome: 'tartaruga-marinha', n: [1, 3], raio: 3.5, vel: 1.35, corre: 3.6, habitat: 'recife', depth: [2, 24], modos: ['nadar', 'forragear', 'respirar', 'descansar', 'curioso', 'fugir'] },
  golfinho: { nome: 'golfinhos', n: [3, 6], raio: 5.0, vel: 2.8, corre: 7.0, habitat: 'pelagico', depth: [4, 34], modos: ['nadar', 'forragear', 'respirar', 'descansar', 'curioso', 'fugir'] },
  orca: { nome: 'orca', n: [1, 3], raio: 7.0, vel: 2.5, corre: 6.8, habitat: 'abissal', depth: [12, 44], modos: ['patrulhar', 'nadar', 'forragear', 'respirar', 'descansar', 'curioso', 'fugir'] },
  baleia: { nome: 'baleia-azul', n: [1, 1], raio: 9.0, vel: 1.9, corre: 4.2, habitat: 'abissal', depth: [16, 44], modos: ['migrar', 'nadar', 'forragear', 'respirar', 'descansar', 'curioso', 'fugir'] },
  polvo: { nome: 'polvo', n: [1, 2], raio: 2.5, vel: 1.0, corre: 3.8, habitat: 'fundo', depth: [2, 26], modos: ['nadar', 'forragear', 'abrigar', 'descansar', 'curioso', 'fugir'] },
  aguaviva: { nome: 'água-viva', n: [3, 7], raio: 3.0, vel: 0.6, corre: 1.4, habitat: 'pelagico', depth: [2, 30], modos: ['derivar', 'nadar', 'descansar', 'abrigar', 'curioso'] },
  rebanho: { nome: 'rebanho', n: [5, 10], raio: 5.5, vel: 1.15, corre: 6.5, habitat: 'relva', modos: ['pastar', 'descansar', 'beber', 'migrar', 'fugir'] },
  manada: { nome: 'manada de cavalos', n: [3, 7], raio: 7, vel: 1.5, corre: 11, habitat: 'relva', modos: ['pastar', 'descansar', 'beber', 'galopar', 'migrar', 'fugir'] },
  fauna: { nome: 'bichos', n: [1, 60], raio: 6, vel: 1, corre: 5, habitat: 'relva', modos: ['pastar', 'descansar', 'fugir'] },   // espécies do pacote (server/fauna.js)
  bando: { nome: 'bando de pássaros', n: [9, 18], raio: 7.5, vel: 7.2, corre: 11, habitat: 'ar', modos: ['circular', 'pousar', 'migrar', 'fugir'] },
  enxame: { nome: 'borboletas e insetos', n: [16, 32], raio: 2.2, vel: 0.9, corre: 2.2, habitat: 'flores', modos: ['enxamear', 'pairar', 'dispersar'] },
  ratos: { nome: 'pequenos mamíferos', n: [2, 5], raio: 3.2, vel: 1.6, corre: 5.2, habitat: 'relva', modos: ['farejar', 'correr', 'esconder', 'fugir'] },
  sapos: { nome: 'sapos e anfíbios', n: [3, 6], raio: 2.8, vel: 0.85, corre: 3.2, habitat: 'margem', modos: ['parar', 'saltar', 'coaxar', 'mergulhar'] },
};
export const SWARM_KINDS = Object.keys(SWARMS);
// O que cada modo quer dizer (vai para o Jev como critério da pergunta; em português claro).
export const MODE_TEXT = {
  nadar: 'nada em círculo, tranquilo', alimentar: 'sobe e se espalha para comer perto da superfície', abrigar: 'desce e se aperta no fundo',
  forragear: 'busca alimento perto do coral ou da anêmona', curioso: 'aproxima-se devagar para observar sem perder o abrigo de vista',
  respirar: 'sobe até a superfície do mar para renovar o oxigênio', patrulhar: 'patrulha as profundezas em silêncio',
  planar: 'desliza suavemente próximo ao leito arenoso', derivar: 'pulsa devagar à deriva na correnteza',
  pastar: 'come relva, quase parado', descansar: 'deita e descansa', beber: 'caminha até a água mais próxima',
  migrar: 'segue em grupo para outro lugar', fugir: 'dispara para longe da ameaça',
  galopar: 'dispara a galope pelo campo, sem ameaça, e depois sossega',
  circular: 'voa em círculos sobre o lugar', pousar: 'desce ao chão ou às copas e cisca',
  enxamear: 'voa agitado em volta das flores', pairar: 'paira devagar, quase parado', dispersar: 'se desfaz e some',
  farejar: 'anda aos poucos farejando o chão', correr: 'corre de um canto a outro', esconder: 'some na toca ou no capim',
  parar: 'fica parado na margem', saltar: 'salta de um ponto a outro', coaxar: 'coaxa parado, inflando o papo', mergulhar: 'pula na água e some',
};
// Sem o Jev: pesos de cada modo conforme a hora, o tempo e a ameaça por perto (0..1).
export function fallbackModes(kind, ctx) {
  const { dia = true, chuva = 0, ameaca = 0 } = ctx;
  const f = ameaca * ameaca * 3;
  switch (kind) {
    case 'cardume': return { nadar: 0.5, alimentar: dia ? 0.3 - chuva * 0.2 : 0.08, abrigar: (dia ? 0.08 : 0.3) + chuva * 0.3, migrar: 0.12, fugir: f };
    case 'palhaco': return { nadar: dia ? 0.45 : 0.1, forragear: dia ? 0.35 - chuva * 0.15 : 0.05, descansar: dia ? 0.08 : 0.65, abrigar: (dia ? 0.06 : 0.2) + chuva * 0.25, curioso: dia ? 0.06 : 0, fugir: f };
    case 'salmao':
    case 'atum':
    case 'agulhao': return { nadar: 0.42, forragear: dia ? 0.3 : 0.12, migrar: 0.18, descansar: dia ? 0.05 : 0.4, curioso: 0.05, fugir: f };
    case 'tubarao': return { patrulhar: 0.45, nadar: 0.25, forragear: dia ? 0.12 : 0.35, descansar: 0.08, curioso: 0.1, fugir: f * 0.4 };
    case 'arraia': return { planar: 0.5, nadar: 0.22, forragear: 0.16, descansar: 0.06, curioso: 0.06, fugir: f };
    case 'tartaruga': return { nadar: 0.4, forragear: dia ? 0.25 : 0.1, respirar: 0.15, descansar: dia ? 0.1 : 0.45, curioso: 0.1, fugir: f };
    case 'golfinho': return { nadar: 0.42, forragear: 0.22, respirar: 0.18, descansar: 0.04, curioso: 0.14, fugir: f };
    case 'orca': return { patrulhar: 0.35, nadar: 0.25, forragear: 0.18, respirar: 0.14, curioso: 0.08, fugir: f * 0.3 };
    case 'baleia': return { migrar: 0.4, nadar: 0.3, respirar: 0.15, forragear: 0.1, curioso: 0.05, fugir: f * 0.2 };
    case 'polvo': return { nadar: 0.28, forragear: dia ? 0.18 : 0.45, abrigar: dia ? 0.35 : 0.12, descansar: 0.12, curioso: 0.07, fugir: f };
    case 'aguaviva': return { derivar: 0.55, nadar: 0.3, descansar: 0.1, curioso: 0.05 };
    case 'rebanho': return { pastar: dia ? 0.55 - chuva * 0.3 : 0.1, descansar: (dia ? 0.12 : 0.7) + chuva * 0.25, beber: dia ? 0.12 : 0.03, migrar: 0.14, fugir: f };
    case 'fauna': return { pastar: 0.6, descansar: 0.3, fugir: f };
    case 'manada': return { pastar: dia ? 0.5 - chuva * 0.3 : 0.1, descansar: (dia ? 0.12 : 0.65) + chuva * 0.25, beber: dia ? 0.1 : 0.03, galopar: dia ? 0.1 - chuva * 0.06 : 0.01, migrar: 0.12, fugir: f };
    case 'bando': return { circular: dia ? 0.45 - chuva * 0.3 : 0.05, pousar: (dia ? 0.3 : 0.9) + chuva * 0.5, migrar: dia ? 0.2 : 0.02, fugir: f };
    case 'ratos': return { farejar: dia ? 0.35 : 0.5, correr: dia ? 0.2 : 0.35, esconder: (dia ? 0.4 : 0.12) + chuva * 0.6, fugir: f };
    case 'sapos': return { parar: dia ? 0.55 : 0.2, saltar: 0.2 + chuva * 0.2, coaxar: (dia ? 0.08 : 0.5) + chuva * 0.5, mergulhar: 0.08 + f };
    default: return { enxamear: dia ? 0.6 - chuva : 0, pairar: dia ? 0.3 - chuva * 0.5 : 0.05, dispersar: (dia ? 0.05 : 0.9) + chuva * 2 };
  }
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
// Quanto o grupo perambula em volta do ponto de repouso (m) em cada modo.
const ROAM = { nadar: 2.5, alimentar: 4, abrigar: 0.8, forragear: 2.2, curioso: 1.2, respirar: 1.4, patrulhar: 5.5, planar: 3.5, derivar: 1.6, pastar: 2.2, descansar: 0, beber: 0.6, galopar: 0, circular: 4, pousar: 0.6, enxamear: 0.9, pairar: 0.4, dispersar: 3, migrar: 0, fugir: 0 };
// Modos em que o grupo some de vista (toca, fundo d'água, enxame desfeito): os indivíduos encolhem até sumir em FADE segundos.
export const HIDDEN = { esconder: 1, mergulhar: 1, dispersar: 1 };
const FADE = 3;

// Centro do grupo no instante t (segundos no relógio do servidor): vai de p0 a p1 entre t0 e t1 e depois fica
// rondando p1 devagar. Devolve também, em out[3] e out[4], a direção do deslocamento (x, z) e em out[5] a velocidade.
export function groupCenter(g, t, out) {
  const span = g.t1 - g.t0;
  const k = span > 0 ? clamp01((t - g.t0) / span) : 1;
  const e = k * k * (3 - 2 * k);
  const dx = g.p1[0] - g.p0[0], dy = g.p1[1] - g.p0[1], dz = g.p1[2] - g.p0[2];
  const roam = ROAM[g.m] || 0, ph = (g.s % 997) * 0.0063;
  const rx = roam * (Math.sin(t * 0.05 + ph) + 0.5 * Math.sin(t * 0.021 + ph * 2)) * k;
  const rz = roam * (Math.cos(t * 0.043 + ph * 1.7) + 0.5 * Math.sin(t * 0.017 + ph)) * k;
  out[0] = g.p0[0] + dx * e + rx; out[1] = g.p0[1] + dy * e; out[2] = g.p0[2] + dz * e + rz;
  // velocidade do trecho: derivada do "suavizar" (6k(1-k)) vezes o comprimento sobre a duração
  const len = Math.hypot(dx, dz), sp = span > 0 && k < 1 ? (6 * k * (1 - k) * len) / span : 0;
  out[3] = len > 1e-6 ? dx / len : Math.cos(ph * 9); out[4] = len > 1e-6 ? dz / len : Math.sin(ph * 9); out[5] = sp;
  return out;
}

// Anda-e-para: o bicho fica quieto num ponto, de repente vai até outro e para de novo. Cada indivíduo tem o seu
// compasso. D = [x, z, rumo, andando 0..1 (fração do trecho já percorrida; 0 = parado)].
const D = [0, 0, 0, 0];
function dart(s, i, t, every, moveFrac, radius) {
  const q = t / every + rand01(s, i, 9) * 7;
  const k = Math.floor(q), f = q - k;
  const ax = (rand01(s, i * 31 + 7, k) - 0.5) * 2 * radius, az = (rand01(s, i * 31 + 8, k) - 0.5) * 2 * radius;
  const bx = (rand01(s, i * 31 + 7, k + 1) - 0.5) * 2 * radius, bz = (rand01(s, i * 31 + 8, k + 1) - 0.5) * 2 * radius;
  const mv = clamp01((f - (1 - moveFrac)) / moveFrac), e = mv * mv * (3 - 2 * mv);
  D[0] = ax + (bx - ax) * e; D[1] = az + (bz - az) * e;
  D[2] = Math.atan2(bx - ax, bz - az); D[3] = mv > 0 && mv < 1 ? mv : 0;
  return D;
}

const C = [0, 0, 0, 0, 0, 0];
// Pose do indivíduo i no instante t.
// out = [x, y, z, rumo (radianos em volta de Y; 0 = +Z), batida 0..1 (asa, cauda, passo, papo), nochao 0|1, presenca 0..1].
// O y de quem anda no chão (nochao = 1) é só uma referência: quem desenha encosta no terreno. presenca < 1 = sumindo.
export function memberPose(g, i, t, out) {
  groupCenter(g, t, C);
  const s = g.s, a0 = rand01(s, i, 1) * 6.2832, u = rand01(s, i, 2), v = rand01(s, i, 3), w = rand01(s, i, 4);
  const moving = clamp01(C[5] / 1.2), travel = Math.atan2(C[3], C[4]);
  const R = g.r;
  let x = 0, y = 0, z = 0, yaw = 0, beat = 0, ground = 0;
  if (g.k === 'cardume') {
    const tight = g.m === 'abrigar' ? 0.55 : g.m === 'alimentar' ? 1.5 : g.m === 'fugir' ? 0.5 : 1;
    const om = (0.35 + 0.3 * w) * (g.m === 'alimentar' ? 0.5 : g.m === 'fugir' ? 2.2 : 1);
    const rr = R * tight * (0.3 + 0.7 * Math.sqrt(u)), an = a0 + om * t;
    // parado, o cardume gira em volta do centro; em viagem, cada peixe segura um lugar na formação
    const cx = Math.cos(an) * rr, cz = Math.sin(an) * rr;
    const fx = Math.cos(a0) * rr * 0.6, fz = Math.sin(a0) * rr * 1.3;
    const ct = Math.cos(travel), st = Math.sin(travel);
    const mx = fx * ct + fz * st, mz = -fx * st + fz * ct;
    x = cx + (mx - cx) * moving; z = cz + (mz - cz) * moving;
    y = (v - 0.5) * R * tight * 0.8 + 0.2 * Math.sin(t * 1.3 + a0 * 3);
    const tang = Math.atan2(-Math.sin(an), Math.cos(an));   // tangente do círculo
    yaw = tang + shortest(travel - tang) * moving;
    beat = 0.5 + 0.5 * Math.sin(t * (7 + 6 * moving) + a0 * 5);
  } else if (g.k === 'rebanho' || g.k === 'manada') {
    const pack = g.m === 'pastar' ? 1 : g.m === 'descansar' ? 0.75 : 0.6;
    const d = R * pack * Math.sqrt(u);
    let ox = Math.cos(a0) * d, oz = Math.sin(a0) * d;
    if (g.m === 'pastar') { ox += 0.9 * Math.sin(t * 0.07 + a0 * 5); oz += 0.9 * Math.cos(t * 0.06 + a0 * 3); }
    // em marcha o grupo se alonga atrás de quem vai na frente
    const ct = Math.cos(travel), st = Math.sin(travel);
    const lx = ox * 0.6, lz = oz * 1.4 - R * 0.5;
    const mx = lx * ct + lz * st, mz = -lx * st + lz * ct;
    x = ox + (mx - ox) * moving; z = oz + (mz - oz) * moving;
    const idle = a0 + 1.4 * Math.sin(t * 0.03 + a0 * 7);
    yaw = idle + shortest(travel - idle) * moving;
    beat = moving > 0.05 ? 0.5 + 0.5 * Math.sin(t * (5 + 7 * moving) + a0 * 3) : g.m === 'pastar' ? 0.5 + 0.5 * Math.sin(t * 0.5 + a0 * 4) : 0;
    ground = 1;
  } else if (g.k === 'bando') {
    if (g.m === 'pousar' && moving < 0.05) {
      const d = R * 0.8 * Math.sqrt(u);
      x = Math.cos(a0) * d + 0.3 * Math.sin(t * 0.4 + a0 * 6); z = Math.sin(a0) * d + 0.3 * Math.cos(t * 0.33 + a0 * 4);
      yaw = a0 + 2 * Math.sin(t * 0.2 + a0 * 9); beat = 0; ground = 1;
    } else {
      // em círculo: um anel inclinado; em viagem: um V atrás de quem puxa
      const ring = R * (0.55 + 0.7 * u), om = (g.v * 0.5) / ring, an = a0 + om * t;
      const cx = Math.cos(an) * ring, cz = Math.sin(an) * ring, cy = (v - 0.5) * 3 + 0.8 * Math.sin(an * 2 + a0);
      const rank = Math.floor((i + 1) / 2), side = i % 2 ? 1 : -1;
      const fx = side * rank * 1.3, fz = -rank * 1.1, fy = -rank * 0.12;
      const ct = Math.cos(travel), st = Math.sin(travel);
      const mx = fx * ct + fz * st, mz = -fx * st + fz * ct;
      x = cx + (mx - cx) * moving; z = cz + (mz - cz) * moving; y = cy + (fy - cy) * moving;
      const tang = Math.atan2(-Math.sin(an), Math.cos(an));
      yaw = tang + shortest(travel - tang) * moving;
      beat = 0.5 + 0.5 * Math.sin(t * (9 + 4 * w) + a0 * 3);
    }
  } else if (g.k === 'ratos') {
    const fast = g.m === 'correr' || g.m === 'fugir';
    const d = dart(s, i, t, fast ? 1.1 : 3.2, fast ? 0.7 : 0.3, R * (fast ? 1.3 : 1));
    x = d[0] * (1 - moving * 0.7); z = d[1] * (1 - moving * 0.7);
    yaw = d[2] + shortest(travel - d[2]) * moving;
    beat = d[3] > 0 || moving > 0.05 ? 0.5 + 0.5 * Math.sin(t * 22 + a0 * 3) : 0;
    ground = 1;
  } else if (g.k === 'sapos') {
    const hop = g.m === 'saltar' || g.m === 'mergulhar';
    const d = dart(s, i, t, hop ? 2.2 : 7, hop ? 0.3 : 0.08, R);
    x = d[0]; z = d[1]; yaw = d[2];
    y = d[3] > 0 ? Math.sin(d[3] * Math.PI) * 0.45 : 0;                       // o salto é um arco
    beat = g.m === 'coaxar' ? 0.5 + 0.5 * Math.sin(t * (2.2 + w) + a0 * 5) : 0;   // papo inflando
    ground = 1;
  } else {
    // insetos: zumbido em três eixos, cada um com a sua frequência
    const r = R * (0.3 + 0.7 * u) * (g.m === 'dispersar' ? 2.5 : g.m === 'pairar' ? 0.6 : 1), q = g.m === 'pairar' ? 0.45 : 1;
    x = Math.sin(t * (0.7 + 0.9 * w) * q + a0) * r; z = Math.cos(t * (0.6 + 1.1 * v) * q + a0 * 2) * r;
    y = 0.5 + 0.45 * Math.sin(t * (0.9 + 0.8 * u) * q + a0 * 3);
    yaw = Math.atan2(Math.cos(t * (0.7 + 0.9 * w) * q + a0), -Math.sin(t * (0.6 + 1.1 * v) * q + a0 * 2));
    beat = 0.5 + 0.5 * Math.sin(t * 24 + a0 * 7);
  }
  out[0] = C[0] + x; out[1] = C[1] + y; out[2] = C[2] + z; out[3] = yaw; out[4] = beat; out[5] = ground;
  out[6] = presence(g, t);
  return out;
}
// Quanto do grupo está à vista (0..1). fi = instante em que apareceu (ou reapareceu): entra aos poucos; em modo
// escondido (toca, fundo d'água, enxame desfeito), sai aos poucos.
export function presence(g, t) {
  return HIDDEN[g.m] ? 1 - clamp01((t - g.t0) / FADE) : g.fi ? clamp01((t - g.fi) / FADE) : 1;
}
// menor diferença entre dois ângulos, em (-π, π]
function shortest(d) { return ((d + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI; }
