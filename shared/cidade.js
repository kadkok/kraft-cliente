// LAVRA — a cidade da Ilha Metrópole (pedido do Kadmus, 19/11/2026: "a ilha metrópole, com prédios, ruas e um grande
// estádio de futebol, grande o suficiente para jogar com 7 jogadores de cada lado… cheio de arquibancadas… nessa
// ilha podemos ver outros construtos e mais npc").
//
// Contrato (quem chama é shared/ilhas.js, para a ilha de tema 'metropole'):
//   criarCidade({ x, z, r, s, semente, cais }) → {
//     obras(x0, z0, set, alt)   carimba no pedaço [x0, x0+15] × [z0, z0+15] os blocos da cidade que caem nele;
//                               set(x, y, z, bloco) escreve; alt(x, z) = altura do terreno na coluna
//     semArvore(x, z)           ali o gerador não planta (a cidade inteira: as árvores dela são dela)
//     semPlanta(x, z)           ali o gerador não põe capim nem flor (gramado do estádio, ruas, pisos, lotes)
//     campo, arquibancadas      o estádio, nos números que server/bola.js entende (montarCampo de shared/bola.js)
//     arquibancadasFundos       fileiras atrás dos gols (correm em z: { z0, z1, x, y, lado, olharX }); o formato de
//                               server/bola.js só conhece fileiras que correm em x
//     predios, ruas, pracas     dados para os moradores (portas, calçadas) e para o mapa
//   }
// Função fechada da ficha da ilha: nada é gravado no mundo, e o mesmo código dá a mesma cidade no servidor e em todo
// aparelho. Só operações exatas (nada de sin/cos/pow/Math.random), como noise.js.
//
// Como é feita: na primeira consulta o plano inteiro é montado (≈ 40 ms): um retrato do chão da cidade (ruas,
// calçadas, praças, jardins: um código por coluna), a lista de prédios (cada um descrito por números: lote, andares,
// materiais, estilo de fachada) e as obras especiais (estádio, praça, parque, mercado, torre do relógio, farol). Tudo
// fica indexado por pedaço de 16 × 16; `obras` só percorre o que toca o pedaço e calcula cada coluna na hora.
//
// Planta (coordenadas locais u = x − centro, v = z − centro da ilha; o cais da balsa chega pelo oeste, em v = 0):
//   Avenida do Cais (v = 0): do Largo do Cais (torre do relógio) à Praça Central (u ±40) e daí à Esplanada do Estádio.
//   Ruas a cada 56 m (u, v = ±47, ±103, ±159, ±215, ±271, ±327); quarteirões de 43 m; centro com torres de vidro,
//   anel de prédios de tijolo e reboco, borda com casas e lojas. Parque com lago e coreto a noroeste; mercado coberto
//   ao lado do cais; farol na ponta nordeste; estádio a leste (campo de 65 × 43, 12 degraus nos quatro lados).
import { hash3, createSimplex } from './noise.js';
import { B } from './blocks.js';
import { montarCampo } from './bola.js';
import { criarServicos } from './cidade-servicos.js';

export const CIDADE = {
  chao: 51,            // bloco do chão da cidade (o pé pisa em 52)
  limite: -46,         // só se constrói onde s(x, z) <= limite (a orla fica natural)
  quadra: 56,          // passo da malha de ruas
  meiaRua: 6,          // rua: pista de 7 (−3…3), meio-fio em ±4, calçada ±5…6
  meiaAvenida: 11,     // avenida: canteiro central (−1…1), pistas 2…8, meio-fio 9, calçada 10…11
  campo: { meio: 32, meiaLarg: 21, largGol: 5, altGol: 2 },   // 65 × 43 (ver o fim de docs/ilha-metropole.md)
};

export function criarCidade(ilha) {
  let P = null;
  const plano = () => P || (P = planejar(ilha));
  return {
    ilha,
    obras(x0, z0, set, alt) { plano().obras(x0, z0, set, alt); },
    semArvore(x, z) { return plano().naCidade(x, z); },
    semPlanta(x, z) { return plano().semPlanta(x, z); },
    get campo() { return plano().campo; },
    get arquibancadas() { return plano().arquibancadas; },
    get arquibancadasFundos() { return plano().arquibancadasFundos; },
    get predios() { return plano().predios; },
    get ruas() { return plano().ruas; },
    get pracas() { return plano().pracas; },
    get estadio() { return plano().estadio; },
    get servicos() { return plano().servicos; },   // hospital, escola, delegacia, bombeiros, aeroporto (cidade-servicos.js)
    chao(x, z) { return plano().chao(x, z); },       // código do chão da cidade numa coluna (0 = natural; testes e mapa)
  };
}

// ---- códigos do chão (retrato da cidade, um byte por coluna) -----------------------------------------------------
const K = {
  ASF: 1, AMARELA: 2, BRANCA: 3, MEIOFIO: 4, CALCADA: 5, CANTEIRO: 6, FLOR: 7, SEBE: 8,
  PISO_A: 9, PISO_B: 10, PISO_C: 11, PISO_D: 12, CASCALHO: 13, LAGO: 14, MARGEM: 15, CAMINHO: 16,
  ONDA: 17, GRAMADO: 18, LINHA: 19, CAPIM: 20, LOTE: 21, ESTADIO: 22, FAIXA_CALC: 23,
};
// asfalto: reboco escuro (o basalto do pacote de texturas tem veios ondulados que não lembram asfalto)
const ASFALTO = B.PLASTER_DARK;
const CHAO = new Uint8Array(32);
CHAO[K.ASF] = ASFALTO; CHAO[K.AMARELA] = B.PLASTER_YELLOW; CHAO[K.BRANCA] = B.PLASTER_WHITE;
CHAO[K.MEIOFIO] = B.STONE_BRICKS; CHAO[K.CALCADA] = B.CONCRETE; CHAO[K.CANTEIRO] = B.GRASS; CHAO[K.FLOR] = B.GRASS;
CHAO[K.SEBE] = B.GRASS; CHAO[K.PISO_A] = B.STONE_BRICKS; CHAO[K.PISO_B] = B.MARBLE; CHAO[K.PISO_C] = B.SANDSTONE;
CHAO[K.PISO_D] = B.CONCRETE; CHAO[K.CASCALHO] = B.GRAVEL; CHAO[K.MARGEM] = B.SAND; CHAO[K.CAMINHO] = B.STONE_BRICKS;
CHAO[K.ONDA] = B.BASALT; CHAO[K.GRAMADO] = B.GRASS; CHAO[K.LINHA] = B.PLASTER_WHITE; CHAO[K.CAPIM] = B.GRASS;
CHAO[K.FAIXA_CALC] = B.STONE_BRICKS;
// prioridade de pintura das ruas (quem é mais alto vence no cruzamento)
const PRI = new Uint8Array(32);
PRI[K.CANTEIRO] = 1; PRI[K.CALCADA] = 2; PRI[K.FAIXA_CALC] = 2; PRI[K.MEIOFIO] = 3; PRI[K.ASF] = 5;
const POSTE = B.PLASTER_DARK;      // coluna de poste: escura, para ler como haste fina e não como pilar
const FLORES = [B.FLOWER_YELLOW, B.FLOWER_RED, B.FLOWER_BLUE, B.FLOWER_WHITE];

// paletas por quarteirão: paredes, frisos, persianas (harmônicas entre si, nada de cor solta)
const TONS = [
  { nome: 'terracota', paredes: [B.BRICKS, B.PLASTER_RED, B.PLASTER_YELLOW, B.SANDSTONE, B.BRICKS], frisos: [B.STONE_BRICKS, B.PLASTER_WHITE, B.SANDSTONE], persianas: [B.PINE_PLANKS, B.PLASTER_GREEN] },
  { nome: 'litoral', paredes: [B.PLASTER_BLUE, B.PLASTER_WHITE, B.PLASTER_GREEN, B.PLASTER_YELLOW, B.PLASTER_WHITE], frisos: [B.PLASTER_WHITE, B.MARBLE, B.CONCRETE], persianas: [B.PLASTER_BLUE, B.PINE_PLANKS, B.PLASTER_GREEN] },
  { nome: 'pedra', paredes: [B.STONE_BRICKS, B.BRICKS, B.SANDSTONE, B.CONCRETE, B.PLASTER_WHITE], frisos: [B.MARBLE, B.STONE_BRICKS, B.PLASTER_DARK], persianas: [B.PLANKS, B.PLASTER_DARK] },
  { nome: 'colonial', paredes: [B.PLASTER_YELLOW, B.PLASTER_WHITE, B.PLASTER_BLUE, B.PLASTER_RED, B.PLASTER_GREEN], frisos: [B.PLASTER_WHITE, B.MARBLE, B.SANDSTONE], persianas: [B.PLASTER_GREEN, B.PLASTER_BLUE, B.PINE_PLANKS] },
];
const VIDROS = [B.GLASS_BLUE, B.GLASS_SILVER, B.GLASS_SMOKE, B.GLASS_MIRROR, B.GLASS_BLUE, B.GLASS_SILVER, B.GLASS_GOLD];
const QUINAS = [B.STEEL, B.PLASTER_DARK, B.MARBLE, B.STEEL, B.CONCRETE];

// letras 3 × 5 do placar (linha de cima primeiro)
const LETRAS = {
  K: ['101', '101', '110', '101', '101'], R: ['110', '101', '110', '101', '101'], A: ['010', '101', '111', '101', '101'],
  F: ['111', '100', '110', '100', '100'], T: ['111', '010', '010', '010', '010'],
};

// ==================================================================================================================
function planejar(ilha) {
  const s = ilha.s;
  const CX = Math.round(ilha.x), CZ = Math.round(ilha.z);
  const SEM = hash3(ilha.semente | 0, 0x0c1d, 0x7a7e, 5);
  const H = (a, b, c) => hash3(a | 0, b | 0, c | 0, SEM);
  const U = (a, b, c) => H(a, b, c) / 4294967296;
  const ru = createSimplex(SEM ^ 0x3e1).n2;
  const LIM = CIDADE.limite;

  // ---- retrato do chão ---------------------------------------------------------------------------------------
  const RR = Math.max(200, Math.min(420, Math.ceil(ilha.r * 1.02))), NW = 2 * RR + 1, RX0 = CX - RR, RZ0 = CZ - RR;
  const G = new Uint8Array(NW * NW), OK = new Uint8Array(NW * NW), OCC = new Uint8Array(NW * NW), NR = new Uint8Array(NW * NW);
  const ri = (x, z) => { const i = x - RX0, j = z - RZ0; return i >= 0 && j >= 0 && i < NW && j < NW ? i + j * NW : -1; };
  // máscara do que é construível, amostrada de 2 em 2 m (s é suave: a folga entre −46 e a praia, em −40, sobra)
  for (let j = 0; j < NW; j += 2) for (let i = 0; i < NW; i += 2) {
    if (s(RX0 + i + 0.5, RZ0 + j + 0.5) > LIM) continue;
    OK[i + j * NW] = 1; if (i + 1 < NW) OK[i + 1 + j * NW] = 1;
    if (j + 1 < NW) { OK[i + (j + 1) * NW] = 1; if (i + 1 < NW) OK[i + 1 + (j + 1) * NW] = 1; }
  }
  const ok = (x, z) => { const k = ri(x, z); return k >= 0 && OK[k] === 1; };
  const okCaixa = (x0, z0, x1, z1, m = 0) => {
    const a = x0 - m, b = x1 + m, c = z0 - m, d = z1 + m, mx = (x0 + x1) >> 1, mz = (z0 + z1) >> 1;
    return ok(a, c) && ok(b, c) && ok(a, d) && ok(b, d) && ok(mx, mz) && ok(mx, c) && ok(mx, d) && ok(a, mz) && ok(b, mz);
  };
  const pinta = (x, z, c) => { const k = ri(x, z); if (k >= 0 && OK[k]) G[k] = c; };
  const pintaP = (x, z, c) => { const k = ri(x, z); if (k >= 0 && OK[k] && PRI[c] >= PRI[G[k]]) G[k] = c; };
  const chao = (x, z) => { const k = ri(x, z); return k >= 0 ? G[k] : 0; };
  const ocupa = (x0, z0, x1, z1, v = 1) => {
    const i0 = Math.max(0, x0 - RX0), i1 = Math.min(NW - 1, x1 - RX0);
    const j0 = Math.max(0, z0 - RZ0), j1 = Math.min(NW - 1, z1 - RZ0);
    for (let j = j0; j <= j1; j++) { const row = j * NW; for (let i = i0; i <= i1; i++) OCC[row + i] = v; }
  };
  const semRua = (x0, z0, x1, z1) => {
    const i0 = x0 - RX0, i1 = x1 - RX0, j0 = z0 - RZ0, j1 = z1 - RZ0;
    for (let j = Math.max(0, j0); j <= Math.min(NW - 1, j1); j++) {
      const row = j * NW;
      for (let i = Math.max(0, i0); i <= Math.min(NW - 1, i1); i++) {
        const c = G[row + i]; if (c && c !== K.CANTEIRO && c !== K.FLOR && c !== K.SEBE) return false;
      }
    }
    return true;
  };
  const livre = (x0, z0, x1, z1) => {
    const i0 = x0 - RX0, i1 = x1 - RX0, j0 = z0 - RZ0, j1 = z1 - RZ0;
    if (i0 < 0 || j0 < 0 || i1 >= NW || j1 >= NW) return false;
    for (let j = j0; j <= j1; j++) {
      const row = j * NW;
      for (let i = i0; i <= i1; i++) { const k = row + i; if (OCC[k] || !OK[k]) return false; }
    }
    return true;
  };

  // ---- índice por pedaço ----------------------------------------------------------------------------------------
  const idx = new Map();
  const itens = [];
  function poe(it) {
    it.ord = itens.length; itens.push(it);
    for (let cz = Math.floor(it.z0 / 16); cz <= Math.floor(it.z1 / 16); cz++) for (let cx = Math.floor(it.x0 / 16); cx <= Math.floor(it.x1 / 16); cx++) {
      const k = cx + ',' + cz; let l = idx.get(k); if (!l) idx.set(k, (l = [])); l.push(it);
    }
    return it;
  }

  const predios = [], ruas = [], pracas = [];
  const W = (u) => CX + u, Zw = (v) => CZ + v;            // local → mundo

  // ==============================================================================================================
  // 1) MALHA DE RUAS
  const LINHAS = [-327, -271, -215, -159, -103, -47, 47, 103, 159, 215, 271, 327];
  const hR = CIDADE.meiaRua, hA = CIDADE.meiaAvenida;
  // superquadras (sem rua por dentro): parque a noroeste e estádio a leste
  const PARQUE = { u0: -152, v0: -152, u1: -54, v1: -54 };
  const ESTADIO_Q = { u0: 110, v0: -96, u1: 264, v1: 96 };
  const PRACA = { u0: -40, v0: -40, u1: 40, v1: 40 };
  const dentroQ = (q, u, v) => u >= q.u0 - 7 && u <= q.u1 + 7 && v >= q.v0 - 7 && v <= q.v1 + 7;
  const segs = [];
  // ruas Leste–Oeste (eixo x, em v = c) e Norte–Sul (eixo z, em u = c), de cruzamento a cruzamento
  for (const c of LINHAS) for (let k = 0; k + 1 < LINHAS.length; k++) {
    const a0 = LINHAS[k], a1 = LINHAS[k + 1], m = (a0 + a1) / 2;
    for (const eixo of ['x', 'z']) {
      const u = eixo === 'x' ? m : c, v = eixo === 'x' ? c : m;
      if (dentroQ(PARQUE, u, v) && !(eixo === 'x' ? (c === -159 || c === -47) : (c === -159 || c === -47))) continue;
      if (dentroQ(ESTADIO_Q, u, v) && !(eixo === 'z' && (c === 103 || c === 271)) && !(eixo === 'x' && (c === -103 || c === 103))) continue;
      segs.push({ eixo, c, a0, a1, meia: hR, av: false });
    }
  }
  // a avenida: do cais (oeste) à praça e da praça ao estádio
  segs.push({ eixo: 'x', c: 0, a0: -RR, a1: -41, meia: hA, av: true, oeste: true });
  segs.push({ eixo: 'x', c: 0, a0: 41, a1: 109, meia: hA, av: true });
  // cruzamentos de cada trecho: { a (posição ao longo dele), m (meia largura da rua que cruza) }
  for (const sg of segs) {
    const m = new Map();
    for (const o of segs) if (o !== sg && o.eixo !== sg.eixo && o.c >= sg.a0 && o.c <= sg.a1 && sg.c >= o.a0 && sg.c <= o.a1) m.set(o.c, Math.max(m.get(o.c) || 0, o.meia));
    sg.cruz = [...m].map(([a, mm]) => ({ a, m: mm }));
  }
  const temCruz = (sg, a) => sg.cruz.some((c) => c.a === a);
  const celSeg = (sg, a, t) => (sg.eixo === 'x' ? [W(a), Zw(sg.c + t)] : [W(sg.c + t), Zw(a)]);
  const kSeg = (sg, a, t) => (sg.eixo === 'x' ? ri(CX + a, CZ + sg.c + t) : ri(CX + sg.c + t, CZ + a));
  // passe 1: calçadas, meio-fio e canteiro; passe 2: pista; passe 3: faixas
  for (const sg of segs) for (let a = sg.a0; a <= sg.a1; a++) for (let t = -sg.meia; t <= sg.meia; t++) {
    const at = Math.abs(t);
    let c;
    if (sg.av) c = at <= 1 ? (at === 1 ? K.MEIOFIO : K.CANTEIRO) : at <= 8 ? 0 : at === 9 ? K.MEIOFIO : (at === 10 && (a & 7) === 0 ? K.FAIXA_CALC : K.CALCADA);
    else c = at <= 3 ? 0 : at === 4 ? K.MEIOFIO : K.CALCADA;
    if (!c) continue;
    const k = kSeg(sg, a, t);
    if (k >= 0 && OK[k] && PRI[c] >= PRI[G[k]]) G[k] = c;
  }
  for (const sg of segs) for (let a = sg.a0; a <= sg.a1; a++) for (let t = -sg.meia; t <= sg.meia; t++) {
    const at = Math.abs(t);
    if (sg.av ? (at < 2 || at > 8) : at > 3) continue;
    const k = kSeg(sg, a, t);
    if (k < 0 || !OK[k]) continue;
    G[k] = K.ASF; if (NR[k] < 255) NR[k]++;
  }
  for (const sg of segs) {
    const pista = sg.av ? 8 : 3;
    for (let a = sg.a0; a <= sg.a1; a++) {
      let zebra = false, longe = true;
      for (const c of sg.cruz) { const d = Math.abs(a - c.a); if (d > c.m && d <= c.m + 4) zebra = true; if (d <= c.m + 7) longe = false; }
      for (let t = -pista; t <= pista; t++) {
        const at = Math.abs(t);
        if (sg.av && at < 2) continue;
        const k = kSeg(sg, a, t);
        if (k < 0 || G[k] !== K.ASF || NR[k] !== 1) continue;
        if (zebra) { if ((t & 1) === 0) G[k] = K.BRANCA; continue; }
        if (!longe) continue;
        if (!sg.av && t === 0 && (a & 7) < 4) G[k] = K.AMARELA;                // faixa dupla amarela tracejada (mão dupla)
        if (sg.av && at === 5 && (a & 7) < 4) G[k] = K.BRANCA;                  // divisão de faixas
      }
    }
    // dados para os moradores (só o trecho que existe de fato)
    let p0 = null, p1 = null;
    for (let a = sg.a0; a <= sg.a1; a++) { const k = kSeg(sg, a, 0); if (k >= 0 && OK[k]) { const xz = celSeg(sg, a, 0); if (!p0) p0 = xz; p1 = xz; } }
    if (p0 && (p0[0] !== p1[0] || p0[1] !== p1[1])) ruas.push({ a: p0, b: p1, largura: sg.av ? 14 : 7, calcada: sg.av ? 3 : 2, nome: sg.av ? 'Avenida do Cais' : null });
  }
  // nomes das ruas: as que correm em x são "Rua", as em z "Travessa", numeradas a partir do centro
  for (const r of ruas) if (!r.nome) { const ex = r.a[1] === r.b[1]; r.nome = (ex ? 'Rua ' : 'Travessa ') + (1 + LINHAS.indexOf(ex ? r.a[1] - CZ : r.a[0] - CX)); }

  // mobiliário das ruas: postes de luz e árvores nos canteiros
  for (const sg of segs) {
    for (let a = sg.a0 + 4; a <= sg.a1 - 4; a++) {
      if (sg.cruz.some((c) => Math.abs(a - c.a) < c.m + 9)) continue;
      if (sg.av) {
        const fase = ((a % 24) + 24) % 24;
        if (fase === 0) { const [x, z] = celSeg(sg, a, 0); if (ok(x, z)) poste(x, z, 'duplo', sg.eixo); }
        else if (fase === 12) { const [x, z] = celSeg(sg, a, 0); if (ok(x, z)) arvore(x, z, 1); }
        if (fase === 6 || fase === 18) for (const t of [-10, 10]) { const [x, z] = celSeg(sg, a, t); if (ok(x, z) && chao(x, z) === K.CALCADA) { pinta(x, z, K.CANTEIRO); arvore(x, z, 0.9); } }
        if (fase === 0) for (const t of [-10, 10]) { const [x, z] = celSeg(sg, a, t); if (ok(x, z) && chao(x, z) === K.CALCADA) { const [qx, qz] = celSeg(sg, a, t > 0 ? t - 1 : t + 1); poste(x, z, 'braco', [qx - x, qz - z]); } }
      } else if (((a % 20) + 20) % 20 === 10) {
        const t = ((a / 20) & 1) ? 5 : -5;
        const [x, z] = celSeg(sg, a, t);
        if (ok(x, z) && chao(x, z) === K.CALCADA) { const [qx, qz] = celSeg(sg, a, t > 0 ? 4 : -4); poste(x, z, 'braco', [qx - x, qz - z]); }
      }
    }
  }

  // ==============================================================================================================
  // 2) PROPS: árvore e poste (itens pequenos, carimbados inteiros pelo recorte)
  function arvore(x, z, porte = 1, especie = -1) {
    const h = H(x, 911, z);
    const tipo = especie >= 0 ? especie : (h & 7) < 6 ? 0 : (h & 7) === 6 ? 1 : 2;   // 0 frondosa · 1 pinheiro · 2 colunar
    const th = Math.max(3, Math.round((tipo === 1 ? 6 : tipo === 2 ? 5 : 4) * porte + ((h >>> 3) & 3) * 0.5));
    const rad = tipo === 1 ? 2.6 * porte : tipo === 2 ? 1.6 : (2.1 + ((h >>> 6) & 3) * 0.3) * porte;
    const ri2 = Math.ceil(rad) + 1;
    const tronco = tipo === 1 ? B.PINE_LOG : B.LOG, folha = tipo === 1 ? B.PINE_LEAVES : B.LEAVES;
    const yT = 52 + th, topo = tipo === 1 ? yT + 4 : yT + (tipo === 2 ? 3 : 2);
    const k = ri(x, z); if (k >= 0) OCC[k] = 2;
    poe({ x0: x - ri2, z0: z - ri2, x1: x + ri2, z1: z + ri2, pri: 1, tudo(S, X0 = -1e9, Z0 = -1e9, X1 = 1e9, Z1 = 1e9) {
      if (x >= X0 && x <= X1 && z >= Z0 && z <= Z1) {
        S(x, 51, z, B.GRASS);
        for (let y = 52; y < yT; y++) S(x, y, z, tronco);
      }
      const dz0 = Math.max(-ri2, Z0 - z), dz1 = Math.min(ri2, Z1 - z);
      const dx0 = Math.max(-ri2, X0 - x), dx1 = Math.min(ri2, X1 - x);
      for (let y = yT - 2; y <= topo; y++) for (let dz = dz0; dz <= dz1; dz++) for (let dx = dx0; dx <= dx1; dx++) {
        if (dx === 0 && dz === 0 && y < yT) continue;
        let q, lim;
        if (tipo === 1) { const rr = rad * (topo - y + 0.6) / (topo - yT + 3); q = dx * dx + dz * dz; lim = rr * rr; if (y < yT - 1) continue; }
        else if (tipo === 2) { const dy = (y - (yT + 0.5)) / 2.4; q = dx * dx + dz * dz + dy * dy * rad * rad; lim = rad * rad; }
        else { const dy = (y - (yT + 0.4)) * 1.25; q = dx * dx + dz * dz + dy * dy; lim = rad * rad; }
        const ruido = (hash3(x + dx, y, z + dz, SEM ^ 0x77) & 255) / 255;
        if (q <= lim + 0.6 - ruido * 1.6) S(x + dx, y, z + dz, folha);
      }
      if ((tipo === 0 || tipo === 2) && x >= X0 && x <= X1 && z >= Z0 && z <= Z1) S(x, yT, z, B.LOG);            // galho que segura a copa
    } });
  }
  function poste(x, z, tipo, dir) {
    const k = ri(x, z); if (k >= 0) OCC[k] = 2;
    poe({ x0: x - 2, z0: z - 2, x1: x + 2, z1: z + 2, pri: 1, tudo(S) {
      if (tipo === 'duplo') {
        S(x, 51, z, B.STONE_BRICKS);
        for (let y = 52; y <= 58; y++) S(x, y, z, POSTE);
        const [ax, az] = dir === 'x' ? [0, 1] : [1, 0];
        for (const sg of [-1, 1]) { S(x + ax * sg, 59, z + az * sg, B.STEEL); S(x + ax * sg * 2, 59, z + az * sg * 2, B.STEEL); S(x + ax * sg * 2, 58, z + az * sg * 2, B.LAMP); }
        S(x, 59, z, B.STEEL);
      } else if (tipo === 'braco') {
        for (let y = 52; y <= 56; y++) S(x, y, z, POSTE);
        S(x, 57, z, POSTE); S(x + dir[0], 57, z + dir[1], POSTE); S(x + dir[0], 56, z + dir[1], B.LAMP);
      } else {                                                     // poste de praça: coluna e lanterna
        S(x, 51, z, B.STONE_BRICKS);
        for (let y = 52; y <= 54; y++) S(x, y, z, POSTE);
        S(x, 55, z, B.LAMP); S(x, 56, z, POSTE);
      }
    } });
  }
  // canteiro com flores e borda (cx, cz, meia largura em x e z)
  function canteiro(x0, z0, x1, z1, borda = true) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const b = x === x0 || x === x1 || z === z0 || z === z1;
      pinta(x, z, b && borda ? K.SEBE : K.FLOR);
    }
  }

  // ==============================================================================================================
  // 3) PRÉDIOS
  // P: { tipo, estilo, x0, z0, x1, z1, W, D, frente (0 N −z · 1 L +x · 2 S +z · 3 O −x), aPorta, hT, hA, n, ins[],
  //      R (laje de cobertura), materiais…, telhado (0 plano · 2 duas águas · 4 quatro águas), extras[] }
  const SAI = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  function portaDe(P) {
    const a = P.aPorta;
    if (P.frente === 0) return [P.x0 + a, P.z0];
    if (P.frente === 1) return [P.x1, P.z0 + a];
    if (P.frente === 2) return [P.x0 + a, P.z1];
    return [P.x0, P.z0 + a];
  }
  function registra(P) {
    if (!livre(P.x0, P.z0, P.x1, P.z1)) return null;
    P.W = P.x1 - P.x0 + 1; P.D = P.z1 - P.z0 + 1;
    const L = P.frente === 0 || P.frente === 2 ? P.W : P.D;
    if (P.aPorta === undefined) P.aPorta = (L - 1) >> 1;
    P.R = 52 + P.hT + (P.n - 1) * P.hA;
    // ponto na calçada diante da porta: anda para fora até achar calçada, pista ou praça; pavimenta o caminho
    const [px, pz] = portaDe(P), [ox, oz] = SAI[P.frente];
    let fx = px + ox, fz = pz + oz, achou = false, praca = null;
    const caminho = [];
    for (let d = 1; d <= 10; d++) {
      const c = chao(fx, fz);
      if (c === K.CALCADA || c === K.MEIOFIO || c === K.FAIXA_CALC) { achou = true; break; }
      const k = ri(fx, fz); if (k < 0 || !OK[k] || OCC[k] === 1 || OCC[k] === 2) break;
      if (c === K.PISO_A || c === K.PISO_B || c === K.PISO_C || c === K.PISO_D || c === K.ONDA || c === K.CAMINHO) { if (!praca) praca = [fx, fz]; }
      else if (!praca) caminho.push([fx, fz]);
      fx += ox; fz += oz;
    }
    if (!achou) { if (!praca) return null; [fx, fz] = praca; }
    for (const [x, z] of caminho) { pinta(x, z, K.CAMINHO); const k = ri(x, z); OCC[k] = 3; }
    ocupa(P.x0, P.z0, P.x1, P.z1);
    const m = P.marquise || P.telhado ? 1 : 0;
    P.id = predios.length + 1;
    predios.push({ id: P.id, tipo: P.tipo, x0: P.x0, z0: P.z0, x1: P.x1, z1: P.z1, y: 52, andares: P.n, porta: [px, 52, pz], frente: [fx, 52, fz], altura: P.R + 1 });
    poe({ x0: P.x0 - m, z0: P.z0 - m, x1: P.x1 + m, z1: P.z1 + m, pri: 2, col(S, x, z) { colPredio(P, S, x, z); for (const e of P.extras) if (x >= e.x0 && x <= e.x1 && z >= e.z0 && z <= e.z1) e.col(S, x, z); } });
    return P;
  }

  // ---- extras do telhado ----------------------------------------------------------------------------------------
  function caixaDagua(P, cx, cz) {
    const y = P.R + 1;
    P.extras.push({ x0: cx - 1, z0: cz - 1, x1: cx + 1, z1: cz + 1, col(S, x, z) {
      const q = Math.abs(x - cx) + Math.abs(z - cz);
      if (Math.abs(x - cx) === 1 && Math.abs(z - cz) === 1) { S(x, y, z, B.STEEL); return; }
      S(x, y, z, B.STEEL); S(x, y + 1, z, B.PLASTER_BLUE); S(x, y + 2, z, B.PLASTER_BLUE);
      if (q === 0) S(x, y + 3, z, B.CONCRETE);
    } });
  }
  function antena(P, ax, az, h, base) {
    const y0 = (base ?? P.R) + 1;
    P.extras.push({ x0: ax, z0: az, x1: ax, z1: az, col(S, x, z) { for (let y = y0; y < y0 + h; y++) S(x, y, z, B.STEEL); S(x, y0 + h, z, B.LAMP); } });
  }
  function casaMaquinas(P, x0, z0, x1, z1, h, mat) {
    const y0 = P.R + 1;
    P.extras.push({ x0, z0, x1, z1, col(S, x, z) {
      const borda = x === x0 || x === x1 || z === z0 || z === z1;
      for (let y = y0; y < y0 + h; y++) if (borda) S(x, y, z, (y === y0 + h - 1) ? B.STEEL : mat);
      S(x, y0 + h, z, B.STEEL);
    } });
  }
  function paineis(P, x0, z0, x1, z1) {
    const y = P.R + 1;
    P.extras.push({ x0, z0, x1, z1, col(S, x, z) { if (((P.W >= P.D ? z - z0 : x - x0) % 3) !== 2) S(x, y, z, B.GLASS_SMOKE); } });
  }
  function jardimTeto(P, yBase) {
    const y = yBase + 1;
    P.extras.push({ x0: P.x0 + 1, z0: P.z0 + 1, x1: P.x1 - 1, z1: P.z1 - 1, col(S, x, z) {
      if (Math.min(x - P.x0, z - P.z0, P.x1 - x, P.z1 - z) !== 1) return;
      S(x, y - 1, z, B.DIRT); S(x, y, z, B.GRASS);
      const h = H(x, y, z);
      S(x, y + 1, z, (h & 3) === 0 ? B.LEAVES : (h & 3) === 1 ? FLORES[(h >>> 2) & 3] : B.TALL_GRASS);
    } });
  }

  // ---- fábrica de prédios por tipo ---------------------------------------------------------------------------
  // lote: { x0, z0, x1, z1, frente, faces (máscara das faces que dão para a rua) }, tom: paleta do quarteirão
  function torre(L, dn, tom, hh) {
    const P = { tipo: 'torre', estilo: 'vidro', ...L, hT: 5, hA: 3, extras: [], luzes: 0.16 };
    const ml = Math.min(L.x1 - L.x0, L.z1 - L.z0) + 1;
    P.n = Math.max(10, Math.min(17, 11 + Math.round((1 - Math.min(1, dn / 0.36)) * 8) + (hh % 3)));    // 10–17 andares: laje até y 105
    P.vidro = VIDROS[(hh >>> 4) % VIDROS.length]; P.faixa = [B.STEEL, B.GLASS_SMOKE, B.PLASTER_DARK, B.CONCRETE][(hh >>> 8) & 3];
    P.quina = QUINAS[(hh >>> 10) % QUINAS.length]; P.montante = (hh >>> 13) & 1 ? B.STEEL : P.quina; P.per = 3 + ((hh >>> 14) & 1);
    if (P.vidro === B.GLASS_GOLD) { P.faixa = B.PLASTER_DARK; P.quina = B.PLASTER_DARK; }
    P.base = B.STONE_BRICKS; P.piso = B.MARBLE; P.laje = B.CONCRETE; P.cobertura = B.CONCRETE; P.cornija = P.quina; P.verga = B.GLASS;
    P.ins = new Array(P.n).fill(0);
    if (P.n >= 12 && ml >= 11) for (let f = P.n - 4; f < P.n; f++) P.ins[f] = 2;
    if (P.n >= 15 && ml >= 15) for (let f = P.n - 2; f < P.n; f++) P.ins[f] = 4;
    if (!registra(P)) return null;
    // coroa: casa de máquinas recuada, antena com luz e luzes de balizamento nas quinas
    const k = P.ins[P.n - 1], cx = (P.x0 + P.x1) >> 1, cz = (P.z0 + P.z1) >> 1, wi = P.W - 2 * k, di = P.D - 2 * k;
    if (wi >= 7 && di >= 7) casaMaquinas(P, cx - 2, cz - 1, cx + 1, cz + 1, 3, (hh >>> 16) & 1 ? P.vidro : B.CONCRETE);
    antena(P, cx, cz, 5 + ((hh >>> 18) & 7), P.R + 3);
    for (const [qx, qz] of [[P.x0 + k, P.z0 + k], [P.x1 - k, P.z0 + k], [P.x0 + k, P.z1 - k], [P.x1 - k, P.z1 - k]]) P.extras.push({ x0: qx, z0: qz, x1: qx, z1: qz, col(S, x, z) { S(x, P.R + 2, z, B.LAMP); } });
    if (P.ins[P.n - 1] > 0) { const f = P.ins.findIndex((v) => v > 0); jardimTeto(P, 52 + P.hT + (f - 1) * P.hA); }
    return P;
  }
  function escritorio(L, dn, tom, hh) {
    const P = { tipo: 'escritorio', estilo: (hh & 1) ? 'grade' : 'fita', ...L, hT: 4, hA: 4, extras: [], luzes: 0.12 };
    P.n = Math.max(5, Math.min(10, 6 + Math.round((1 - Math.min(1, dn / 0.5)) * 3) + ((hh >>> 2) % 3) - 1));
    P.pilar = [B.CONCRETE, B.MARBLE, B.SANDSTONE, B.PLASTER_WHITE, B.STONE_BRICKS][(hh >>> 4) % 5];
    P.faixa = (hh >>> 7) & 1 ? P.pilar : B.CONCRETE; P.vidro = [B.GLASS, B.GLASS_SMOKE, B.GLASS_BLUE, B.GLASS_SILVER][(hh >>> 9) & 3];
    P.vidroTerreo = B.GLASS; P.base = B.STONE_BRICKS; P.piso = B.STONE_BRICKS; P.laje = B.CONCRETE; P.cobertura = B.GRAVEL; P.cornija = P.pilar; P.verga = P.vidro;
    P.ins = new Array(P.n).fill(0);
    if (P.n >= 8 && Math.min(P.x1 - P.x0, P.z1 - P.z0) >= 10) P.ins[P.n - 1] = 1;
    P.marquise = B.STEEL;
    if (!registra(P)) return null;
    const cx = (P.x0 + P.x1) >> 1, cz = (P.z0 + P.z1) >> 1;
    if ((hh >>> 13) & 1) caixaDagua(P, cx + 2, cz); else casaMaquinas(P, cx + 1, cz - 1, cx + 3, cz + 1, 3, P.pilar);
    paineis(P, P.x0 + 2, P.z0 + 2, cx - 1, P.z1 - 2);
    if ((hh >>> 12) & 1) antena(P, cx - 2, cz + 2, 4);
    return P;
  }
  function apartamento(L, dn, tom, hh, rua) {
    const tijolo = (hh & 3) === 0 || tom.nome === 'terracota' && (hh & 1);
    const P = { tipo: tijolo ? 'tijolo' : 'reboco', estilo: tijolo ? 'tijolo' : 'reboco', ...L, hT: 4, hA: 4, extras: [], rec: true, luzes: 0.1 };
    const alto = dn < 0.56;
    P.n = alto ? 4 + ((hh >>> 3) % 4) : 3 + ((hh >>> 3) % 3);
    if (rua) P.n = Math.min(7, P.n + 1);
    P.parede = tijolo ? B.BRICKS : tom.paredes[(hh >>> 6) % tom.paredes.length];
    if (P.parede === B.BRICKS && !tijolo) P.parede = B.PLASTER_WHITE;
    P.friso = tom.frisos[(hh >>> 9) % tom.frisos.length]; if (P.friso === P.parede) P.friso = B.STONE_BRICKS;
    P.pilar = tijolo ? B.BRICKS : P.friso;
    P.persiana = !tijolo && ((hh >>> 11) & 1) ? tom.persianas[(hh >>> 12) % tom.persianas.length] : 0;
    P.per = P.persiana ? 4 : 3;
    P.janela = B.GLASS; P.base = B.STONE_BRICKS; P.piso = B.PLANKS; P.laje = B.PLANKS; P.cobertura = B.CONCRETE; P.cornija = P.friso; P.verga = B.PLANKS;
    P.loja = rua || ((hh >>> 15) & 3) === 0; P.perLoja = 4;
    P.letreiro = [B.PLASTER_DARK, B.PINE_PLANKS, P.friso, B.PLASTER_GREEN, B.PLASTER_RED][(hh >>> 17) % 5];
    P.marquise = P.loja ? [B.PLASTER_RED, B.PLASTER_GREEN, B.PLASTER_BLUE, B.PLASTER_YELLOW, B.STEEL][(hh >>> 20) % 5] : 0;
    P.ins = new Array(P.n).fill(0);
    P.telhado = !alto && ((hh >>> 23) & 3) === 0 ? 4 : 0;
    if (!registra(P)) return null;
    if (!P.telhado) {
      const cx = (P.x0 + P.x1) >> 1, cz = (P.z0 + P.z1) >> 1;
      const eq = (hh >>> 25) & 7;
      if (P.W >= 6 && P.D >= 6 && eq < 2) caixaDagua(P, cx + ((hh >>> 28) & 1 ? 1 : -1), cz);
      else if (P.W >= 7 && P.D >= 7 && eq < 4) casaMaquinas(P, cx - 1, cz - 1, cx + 1, cz, 2, P.friso);
      else if (eq < 6 && P.W >= 6 && P.D >= 6) jardimTeto(P, P.R);
      if (((hh >>> 29) & 3) === 0) antena(P, P.x0 + 1, P.z0 + 1, 3);
    }
    return P;
  }
  function casa(L, dn, tom, hh) {
    const P = { tipo: 'casa', estilo: 'casa', ...L, hT: 3, hA: 4, extras: [], rec: true, luzes: 0.2 };
    P.n = (hh & 3) === 0 ? 2 : 1;
    P.parede = tom.paredes[(hh >>> 3) % tom.paredes.length]; if (P.parede === B.CONCRETE) P.parede = B.PLASTER_WHITE;
    P.friso = tom.frisos[(hh >>> 6) % tom.frisos.length]; if (P.friso === P.parede) P.friso = B.PLASTER_WHITE;
    P.pilar = P.friso; P.janela = B.GLASS; P.per = 3; P.persiana = ((hh >>> 8) & 1) ? tom.persianas[(hh >>> 9) % tom.persianas.length] : 0;
    if (P.persiana) P.per = 4;
    P.base = B.STONE_BRICKS; P.piso = B.PLANKS; P.laje = B.PLANKS; P.cobertura = B.ROOF; P.cornija = P.friso; P.verga = B.PINE_PLANKS;
    P.telhado = ((hh >>> 12) & 3) === 0 ? 4 : 2; P.cumeX = (P.x1 - P.x0) >= (P.z1 - P.z0);
    P.telha = [B.ROOF, B.ROOF, B.ROOF, B.PLASTER_DARK][(hh >>> 14) % 4];
    P.chamine = ((hh >>> 17) & 3) === 0;
    P.ins = new Array(P.n).fill(0);
    return registra(P);
  }
  function loja(L, dn, tom, hh) {
    const P = { tipo: 'loja', estilo: 'loja', ...L, hT: 4, hA: 4, extras: [], rec: true, luzes: 0.3 };
    P.n = (hh & 1) ? 2 : 1;
    P.parede = tom.paredes[(hh >>> 2) % tom.paredes.length]; P.friso = tom.frisos[(hh >>> 5) % tom.frisos.length];
    if (P.friso === P.parede) P.friso = B.PLASTER_WHITE;
    P.pilar = P.friso; P.janela = B.GLASS; P.per = 3; P.perLoja = 3;
    P.letreiro = [B.PLASTER_DARK, B.PLASTER_RED, B.PLASTER_GREEN, B.PLASTER_BLUE, B.PINE_PLANKS][(hh >>> 8) % 5];
    P.marquise = [B.PLASTER_RED, B.PLASTER_GREEN, B.PLASTER_YELLOW, B.PLASTER_BLUE, B.PLASTER_WHITE][(hh >>> 11) % 5];
    P.listra = ((hh >>> 14) & 1) ? B.PLASTER_WHITE : 0;
    P.base = B.STONE_BRICKS; P.piso = B.STONE_BRICKS; P.laje = B.CONCRETE; P.cobertura = B.CONCRETE; P.cornija = P.friso; P.verga = B.GLASS;
    P.ins = new Array(P.n).fill(0);
    if (!registra(P)) return null;
    if (P.W >= 6 && P.D >= 6 && ((hh >>> 16) & 3) === 0) caixaDagua(P, (P.x0 + P.x1) >> 1, (P.z0 + P.z1) >> 1);
    return P;
  }

  // o farol escolhe o seu cabo antes do loteamento (ver 8)
  {
    let fx = 0, fz = 0, achou = false;
    for (const [dx, dz] of [[0.6, -0.8], [0.7071, -0.7071], [0.8, -0.6], [0.45, -0.89]]) {
      let best = null;
      for (let t = 200; t < RR; t += 1) {
        const x = Math.round(CX + dx * t), z = Math.round(CZ + dz * t);
        if (okCaixa(x - 6, z - 6, x + 6, z + 6) && livre(x - 6, z - 6, x + 6, z + 6) && semRua(x - 7, z - 7, x + 7, z + 7)) best = [x, z];
        else if (best && s(x, z) > 0) break;
      }
      if (best) { [fx, fz] = best; achou = true; break; }
    }
    if (achou) farol(fx, fz);
  }
  // ==============================================================================================================
  // 4) QUARTEIRÕES E LOTES
  // serviços (24/11): hospital, escola, delegacia e bombeiros tomam quarteirões inteiros; o aeroporto fica no aterro
  const servicos = criarServicos({ CX, CZ, B, K, H, pinta, ocupa, poe, predios, pracas, arvore, poste });
  const cortes = (a0, a1, wmin, wmax, sem) => {
    const out = []; let a = a0, i = 0;
    while (a <= a1) {
      let w = wmin + (H(sem, i++, 31) % (wmax - wmin + 1));
      if (a1 - (a + w - 1) < wmin) w = a1 - a + 1;
      out.push([a, a + w - 1]); a += w;
    }
    return out;
  };
  // lotes de perímetro (quarteirão europeu: prédios encostados na calçada, miolo verde)
  function lotesPerimetro(q, dp, wmin, wmax, sem) {
    const lotes = [];
    const { x0, z0, x1, z1 } = q, D = z1 - z0 + 1;
    const dN = D < 2 * dp + 4 ? Math.floor(D / 2) : dp, dS = D < 2 * dp + 4 ? D - dN : dp;
    for (const [a, b] of cortes(x0, x1, wmin, wmax, sem * 4)) lotes.push({ x0: a, z0, x1: b, z1: z0 + dN - 1, frente: 0 });
    for (const [a, b] of cortes(x0, x1, wmin, wmax, sem * 4 + 1)) lotes.push({ x0: a, z0: z1 - dS + 1, x1: b, z1, frente: 2 });
    if (D >= 2 * dp + 4) {
      for (const [a, b] of cortes(z0 + dN, z1 - dS, wmin, wmax, sem * 4 + 2)) lotes.push({ x0, z0: a, x1: x0 + dp - 1, z1: b, frente: 3 });
      for (const [a, b] of cortes(z0 + dN, z1 - dS, wmin, wmax, sem * 4 + 3)) lotes.push({ x0: x1 - dp + 1, z0: a, x1, z1: b, frente: 1 });
    }
    return lotes;
  }
  const quarteiroes = [];
  for (let i = 0; i + 1 < LINHAS.length; i++) for (let j = 0; j + 1 < LINHAS.length; j++) {
    const u0 = LINHAS[i] + 7, u1 = LINHAS[i + 1] - 7, v0 = LINHAS[j] + 7, v1 = LINHAS[j + 1] - 7;
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    if (dentroQ(PARQUE, mu, mv) || dentroQ(ESTADIO_Q, mu, mv)) continue;
    if (mu > PRACA.u0 && mu < PRACA.u1 && mv > PRACA.v0 && mv < PRACA.v1) continue;
    if (v0 < 0 && v1 > 0 && u1 < 110) {                                   // a avenida corta o quarteirão ao meio
      quarteiroes.push({ u0, v0, u1, v1: -hA - 1, av: 2 }); quarteiroes.push({ u0, v0: hA + 1, u1, v1, av: 0 });
    } else quarteiroes.push({ u0, v0, u1, v1, av: -1 });
  }
  // Largo do Cais e mercado: os dois quarteirões que encostam na avenida logo depois do cais
  const largo = { u0: -RR, v0: -34, u1: -334, v1: 34 };
  let mercadoQ = null, nPracinhas = 0;
  for (const q of quarteiroes) {
    q.x0 = W(q.u0); q.z0 = Zw(q.v0); q.x1 = W(q.u1); q.z1 = Zw(q.v1);
    const mu = (q.u0 + q.u1) / 2, mv = (q.v0 + q.v1) / 2, dn = Math.sqrt(mu * mu + mv * mv) / 330;
    const hq = H(q.u0, q.v0, 77);
    const tom = TONS[(hq >>> 3) % TONS.length];
    if (servicos.quarteirao(q)) continue;
    if (!mercadoQ && q.av === 0 && q.u0 === LINHAS[0] + 7) { mercadoQ = q; continue; }
    // quarteirão só em parte na terra: o que couber vira jardim de bairro
    const inteiro = okCaixa(q.x0, q.z0, q.x1, q.z1, 1);
    const tipoQ = dn < 0.36 ? 'centro' : dn < 0.56 ? 'medio' : dn < 0.74 ? ((hq & 3) === 0 ? 'casas' : 'medio') : 'casas';
    const pracinha = inteiro && tipoQ !== 'centro' && (hq % 11) === 3;
    if (pracinha) { pracinhaDe(q, hq); continue; }
    const rua = q.av >= 0;           // encosta na avenida: térreo de loja
    if (tipoQ === 'centro') {
      const Wq = q.x1 - q.x0 + 1, Dq = q.z1 - q.z0 + 1;
      const nx = Wq >= 60 ? 3 : 2, nz = Dq >= 36 ? 2 : 1;
      const xs = cortes(q.x0, q.x1, Math.floor(Wq / nx), Math.floor(Wq / nx), hq).slice(0, nx), zs = nz === 2 ? [[q.z0, q.z0 + (Dq >> 1) - 1], [q.z0 + (Dq >> 1), q.z1]] : [[q.z0, q.z1]];
      xs[xs.length - 1][1] = q.x1;
      for (let a = 0; a < xs.length; a++) for (let b = 0; b < zs.length; b++) {
        const lx0 = xs[a][0], lx1 = xs[a][1], lz0 = zs[b][0], lz1 = zs[b][1];
        if (!okCaixa(lx0, lz0, lx1, lz1, 1)) { jardim(lx0, lz0, lx1, lz1); continue; }
        const fr = nz === 1 ? (q.av === 2 ? 2 : 0) : (b === 0 ? 0 : 2);
        const hh = H(lx0, lz0, 101), dnl = Math.sqrt(((lx0 + lx1) / 2 - CX) ** 2 + ((lz0 + lz1) / 2 - CZ) ** 2) / 330;
        // praça do prédio: piso, canteiros e postes; a torre fica recuada 3
        for (let z = lz0; z <= lz1; z++) for (let x = lx0; x <= lx1; x++) pinta(x, z, ((x + z) & 7) === 0 ? K.PISO_B : K.PISO_D);
        const m = 3, L = { x0: lx0 + m, z0: lz0 + m, x1: lx1 - m, z1: lz1 - m, frente: fr };
        let P = (hh & 7) < 6 ? torre(L, dnl, tom, hh) : escritorio({ x0: lx0 + 2, z0: lz0 + 2, x1: lx1 - 2, z1: lz1 - 2, frente: fr }, dnl, tom, hh);
        if (!P) continue;
        // canteiros nas quinas da praça do prédio
        for (const [cx, cz] of [[lx0 + 1, lz0 + 1], [lx1 - 1, lz0 + 1], [lx0 + 1, lz1 - 1], [lx1 - 1, lz1 - 1]]) if (livre(cx, cz, cx, cz)) { pinta(cx, cz, K.SEBE); }
      }
    } else if (tipoQ === 'medio') {
      for (const L of lotesPerimetro(q, 11 + (hq & 1), 7, 13, hq)) {
        if (!okCaixa(L.x0, L.z0, L.x1, L.z1, 1)) continue;
        // faces que encostam no vizinho (empenas cegas); a de quina dá para a rua e tem janela
        L.cego = 0;
        if (L.frente === 0 || L.frente === 2) { if (L.x0 > q.x0) L.cego |= 8; if (L.x1 < q.x1) L.cego |= 2; }
        else { L.cego |= 1 | 4; }
        const hh = H(L.x0, L.z0, 202), dnl = Math.sqrt(((L.x0 + L.x1) / 2 - CX) ** 2 + ((L.z0 + L.z1) / 2 - CZ) ** 2) / 330;
        const naAv = rua && ((q.av === 2 && L.frente === 2) || (q.av === 0 && L.frente === 0));
        if (dnl < 0.5 && (hh % 9) === 0) escritorio(L, dnl, tom, hh);
        else if (!naAv && (hh % 7) === 0 && dnl > 0.5) loja(L, dnl, tom, hh);
        else apartamento(L, dnl, tom, hh, naAv);
      }
      arvoresMiolo(q, 9);
    } else {
      for (const L of lotesPerimetro(q, 15, 9, 13, hq)) {
        if (!okCaixa(L.x0, L.z0, L.x1, L.z1, 1)) continue;
        const hh = H(L.x0, L.z0, 303);
        const esquina = L.x0 === q.x0 || L.x1 === q.x1;
        if (esquina && (hh & 3) === 0 && L.frente !== 1 && L.frente !== 3) { loja({ ...L, ...(L.frente === 0 ? { z1: L.z0 + 9 } : { z0: L.z1 - 9 }) }, 1, tom, hh); continue; }
        lote_casa(L, tom, hh);
      }
      arvoresMiolo(q, 8);
    }
  }
  // casa no lote: recuo de jardim na frente, sebe, caminho até a porta, quintal
  function lote_casa(L, tom, hh) {
    const lw = L.frente === 0 || L.frente === 2 ? L.x1 - L.x0 + 1 : L.z1 - L.z0 + 1;
    const rec = 3 + (hh & 1), lado = 1, fundo = 3 + ((hh >>> 1) & 1);
    const prof = (L.frente === 0 || L.frente === 2 ? L.z1 - L.z0 + 1 : L.x1 - L.x0 + 1) - rec - fundo;
    const larg = Math.min(lw - 2 * lado, 7 + ((hh >>> 2) % 4));
    const off = lado + ((hh >>> 5) % Math.max(1, lw - 2 * lado - larg + 1));
    let C;
    if (L.frente === 0) C = { x0: L.x0 + off, x1: L.x0 + off + larg - 1, z0: L.z0 + rec, z1: L.z0 + rec + prof - 1 };
    else if (L.frente === 2) C = { x0: L.x0 + off, x1: L.x0 + off + larg - 1, z1: L.z1 - rec, z0: L.z1 - rec - prof + 1 };
    else if (L.frente === 3) C = { z0: L.z0 + off, z1: L.z0 + off + larg - 1, x0: L.x0 + rec, x1: L.x0 + rec + prof - 1 };
    else C = { z0: L.z0 + off, z1: L.z0 + off + larg - 1, x1: L.x1 - rec, x0: L.x1 - rec - prof + 1 };
    C.frente = L.frente;
    // jardim da frente com sebe na divisa (o caminho abre a sebe)
    for (let z = L.z0; z <= L.z1; z++) for (let x = L.x0; x <= L.x1; x++) {
      const naFrente = L.frente === 0 ? z < C.z0 : L.frente === 2 ? z > C.z1 : L.frente === 3 ? x < C.x0 : x > C.x1;
      if (!naFrente) continue;
      const divisa = L.frente === 0 ? z === L.z0 : L.frente === 2 ? z === L.z1 : L.frente === 3 ? x === L.x0 : x === L.x1;
      pinta(x, z, divisa ? K.SEBE : ((H(x, z, 5) & 7) === 0 ? K.FLOR : K.CANTEIRO));
    }
    const P = casa(C, 1, tom, hh);
    if (!P) return;
    // árvore no quintal, se couber
    const [ox, oz] = SAI[L.frente];
    const tx = ((C.x0 + C.x1) >> 1) - ox * (Math.floor(prof / 2) + 3), tz = ((C.z0 + C.z1) >> 1) - oz * (Math.floor(prof / 2) + 3);
    if (livre(tx - 2, tz - 2, tx + 2, tz + 2)) arvore(tx, tz, 0.8);
  }
  function arvoresMiolo(q, passo) {
    for (let z = q.z0 + 3; z <= q.z1 - 3; z += passo) for (let x = q.x0 + 3; x <= q.x1 - 3; x += passo) {
      const h = H(x, z, 404), tx = x + (h & 3) - 1, tz = z + ((h >>> 2) & 3) - 1;
      if ((h >>> 5) % 3 === 0) continue;
      if (livre(tx - 3, tz - 3, tx + 3, tz + 3)) arvore(tx, tz, 0.9 + ((h >>> 8) & 3) * 0.1);
    }
  }
  function jardim(x0, z0, x1, z1) {
    for (let z = z0 + 2; z <= z1 - 2; z += 7) for (let x = x0 + 2; x <= x1 - 2; x += 7) { const h = H(x, z, 505); const tx = x + (h & 1), tz = z + ((h >>> 1) & 1); if (livre(tx - 2, tz - 2, tx + 2, tz + 2) && (h >>> 3) % 3) arvore(tx, tz, 1); }
  }
  // pracinha de bairro: caminhos em cruz, canteiros, árvores e uma banca de revista
  function pracinhaDe(q, hq) {
    const cx = (q.x0 + q.x1) >> 1, cz = (q.z0 + q.z1) >> 1;
    for (let z = q.z0; z <= q.z1; z++) for (let x = q.x0; x <= q.x1; x++) {
      const borda = x === q.x0 || x === q.x1 || z === q.z0 || z === q.z1;
      const cruz = Math.abs(x - cx) <= 1 || Math.abs(z - cz) <= 1;
      const roda = Math.abs(Math.sqrt((x - cx) ** 2 + (z - cz) ** 2) - 6) < 1.2;
      if (cruz || roda) pinta(x, z, K.PISO_C); else if (borda) pinta(x, z, K.SEBE);
    }
    canteiro(cx - 2, cz - 2, cx + 2, cz + 2, false);
    arvore(cx, cz, 1.25, 0);
    for (const [dx, dz] of [[-9, -9], [9, -9], [-9, 9], [9, 9], [-15, 0], [15, 0], [0, -14], [0, 14]]) if (livre(cx + dx - 2, cz + dz - 2, cx + dx + 2, cz + dz + 2)) arvore(cx + dx, cz + dz, 1);
    for (const [dx, dz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) poste(cx + dx, cz + dz, 'praca');
    pracas.push({ nome: 'Pracinha ' + (++nPracinhas), x: cx, z: cz, raio: Math.min(q.x1 - q.x0, q.z1 - q.z0) >> 1 });
  }

  // ==============================================================================================================
  // 5) PRAÇA CENTRAL: calçada portuguesa em ondas, canteiros nos quadrantes, chafariz com obelisco
  {
    const x0 = W(PRACA.u0), z0 = Zw(PRACA.v0), x1 = W(PRACA.u1), z1 = Zw(PRACA.v1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const u = x - CX, v = z - CZ, d = Math.sqrt(u * u + v * v), au = Math.abs(u), av = Math.abs(v);
      let c;
      if (d < 9.5) c = K.PISO_B;
      else if (d < 12.5) c = K.PISO_A;
      else if (au <= 4 || av <= 4) c = (Math.abs(au - av) < 1 ? K.PISO_A : K.PISO_B);
      else if (d >= 16 && d < 31 && au > 7 && av > 7) c = (d < 17 || d > 30 || au < 8.5 || av < 8.5) ? K.SEBE : K.FLOR;
      else {
        const tri = Math.abs((((u % 14) + 14) % 14) - 7);           // ondas de Copacabana: faixas pretas e brancas em zigue-zague
        c = ((((v + tri) % 8) + 8) % 8) < 3 ? K.ONDA : K.PISO_B;
      }
      if (au >= 39 || av >= 39) c = K.PISO_A;
      pinta(x, z, c);
    }
    ocupa(CX - 12, CZ - 12, CX + 12, CZ + 12, 1);
    // árvores nos canteiros e postes no anel
    for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (const [a, b] of [[14, 22], [22, 14], [19, 19], [26, 10], [10, 26]]) arvore(CX + su * a, CZ + sv * b, 1.1, (a + b) % 3 === 0 ? 2 : 0);
      for (const [a, b] of [[7, 7], [34, 7], [7, 34], [34, 34]]) poste(CX + su * a, CZ + sv * b, 'praca');
    }
    // bancas de revista nas entradas (verdes, como as do Rio)
    for (const [bx, bz] of [[CX - 30, CZ - 6], [CX + 30, CZ + 6]]) banca(bx, bz);
    chafariz(CX, CZ);
    pracas.push({ nome: 'Praça Central', x: CX, z: CZ, raio: 40 });
  }
  function banca(bx, bz) {
    ocupa(bx - 1, bz - 1, bx + 1, bz + 1, 1);
    poe({ x0: bx - 2, z0: bz - 2, x1: bx + 2, z1: bz + 2, pri: 2, tudo(S) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        S(bx + dx, 51, bz + dz, B.STONE_BRICKS);
        const frente = dz === 1 && dx === 0;
        S(bx + dx, 52, bz + dz, frente ? B.PLANKS : B.PLASTER_GREEN);
        S(bx + dx, 53, bz + dz, frente ? B.AIR : (Math.abs(dx) + Math.abs(dz) === 2 ? B.PLASTER_GREEN : B.GLASS));
        S(bx + dx, 54, bz + dz, B.PLASTER_GREEN);
      }
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2) S(bx + dx, 55, bz + dz, B.PLASTER_GREEN);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) S(bx + dx, 55, bz + dz, dx === 0 && dz === 0 ? B.LAMP : B.PLASTER_DARK);
    } });
  }
  function chafariz(cx, cz) {
    poe({ x0: cx - 9, z0: cz - 9, x1: cx + 9, z1: cz + 9, pri: 2, col(S, x, z) {
      const u = x - cx, v = z - cz, d = Math.sqrt(u * u + v * v), q = Math.max(Math.abs(u), Math.abs(v));
      if (d < 8.5) S(x, 51, z, B.STONE_BRICKS);
      if (d >= 7.5 && d < 8.5) { S(x, 52, z, B.MARBLE); return; }      // borda da bacia (banco de sentar)
      if (d < 7.5 && d >= 3.5) { S(x, 52, z, B.WATER); return; }       // espelho d'água em bacia fechada
      if (d < 3.5 && d >= 2.5) { S(x, 52, z, B.MARBLE); S(x, 53, z, B.MARBLE); S(x, 54, z, B.WATER); S(x, 55, z, B.AIR); return; }
      if (d < 2.5) {
        // pedestal, segunda bacia e obelisco com ponta de ouro
        S(x, 52, z, B.MARBLE); S(x, 53, z, B.MARBLE);
        if (d < 2.5 && d >= 1.5) { S(x, 54, z, B.WATER); return; }
        if (q === 0 || (q === 1 && d < 1.2)) {
          const topo = q === 0 ? 70 : 62;
          for (let y = 54; y <= topo; y++) S(x, y, z, y === 58 ? B.GOLD_BLOCK : B.MARBLE);
          if (q === 0) { S(x, 71, z, B.GOLD_BLOCK); S(x, 72, z, B.GOLD_BLOCK); }
          if (q === 1) S(x, 54, z, B.LAMP);
        } else { S(x, 54, z, B.MARBLE); S(x, 55, z, B.MARBLE); }
      }
    } });
  }

  // ==============================================================================================================
  // 6) PARQUE: lago com ilha, ponte em arco, coreto, caminhos de cascalho, muitas árvores
  {
    const x0 = W(PARQUE.u0), z0 = Zw(PARQUE.v0), x1 = W(PARQUE.u1), z1 = Zw(PARQUE.v1);
    const pcx = (x0 + x1) >> 1, pcz = (z0 + z1) >> 1;
    const lcx = pcx + 4, lcz = pcz + 6;
    const lago = (x, z) => { const du = (x - lcx) / 30, dv = (z - lcz) / 19; return du * du + dv * dv + 0.16 * ru(x * 0.06, z * 0.06); };
    const ilhota = (x, z) => (x - lcx - 8) ** 2 + (z - lcz + 2) ** 2 < 10;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const q = lago(x, z), du = x - pcx, dv = z - pcz;
      const borda = x === x0 || x === x1 || z === z0 || z === z1;
      const entrada = Math.abs(du) <= 2 || Math.abs(dv) <= 2;
      let c = 0;
      if (q < 1 && !ilhota(x, z)) c = K.LAGO;
      else if (q < 1.13) c = ilhota(x, z) ? 0 : K.MARGEM;
      else if (Math.abs(q - 1.42) < 0.07) c = K.CASCALHO;                          // caminho em volta do lago
      else if (entrada && q > 1.42) c = K.CASCALHO;                                 // caminhos das quatro entradas
      else if (borda) c = K.SEBE;
      else if (q > 1.6 && ru(x * 0.09 + 40, z * 0.09) > 0.55) c = K.FLOR;           // manchas de flores
      if (c) pinta(x, z, c);
      const k = ri(x, z);
      if (k >= 0) { const cg = G[k]; OCC[k] = (cg === K.LAGO || cg === K.MARGEM || cg === K.CASCALHO || cg === K.SEBE) ? 1 : 0; }
    }
    // ponte em arco de norte a sul cruzando o lago na altura da ilhota
    const bx = lcx - 6;
    let ba = null, bb = null;
    for (let z = lcz - 30; z <= lcz + 30; z++) if (chao(bx, z) === K.LAGO || chao(bx, z) === K.MARGEM) { if (ba === null) ba = z; bb = z; }
    if (ba !== null) {
      ba -= 1; bb += 1;
      const meio = (ba + bb) / 2, meiaL = (bb - ba) / 2;
      ocupa(bx - 2, ba, bx + 2, bb, 1);
      poe({ x0: bx - 2, z0: ba, x1: bx + 2, z1: bb, pri: 3, col(S, x, z) {
        const t = Math.abs(z - meio) / meiaL, yd = 51 + Math.floor(3 * (1 - t * t) + 0.5), dx = x - bx;
        if (Math.abs(dx) <= 1) { S(x, yd, z, B.PLANKS); if (yd > 51) S(x, yd - 1, z, B.PINE_PLANKS); }
        else if (Math.abs(dx) === 2) {
          S(x, yd, z, B.PINE_PLANKS); S(x, yd + 1, z, ((z - ba) % 3 === 0) ? B.LOG : B.PINE_PLANKS);
          if ((z - ba) % 6 === 0 && yd > 51) for (let y = 48; y < yd; y++) S(x, y, z, B.LOG);
          if (z === ba + 1 || z === bb - 1 || z === Math.round(meio)) { S(x, yd + 2, z, B.LOG); S(x, yd + 3, z, B.LAMP); }
        }
      } });
    }
    // árvores: ilhota, beira do lago e o resto do parque
    arvore(lcx + 8, lcz - 2, 1.3, 0);
    for (let z = z0 + 4; z <= z1 - 4; z += 6) for (let x = x0 + 4; x <= x1 - 4; x += 6) {
      const h = H(x, z, 606), tx = x + (h & 3) - 1, tz = z + ((h >>> 2) & 3) - 1;
      if ((h >>> 4) % 5 === 0) continue;
      const q = lago(tx, tz);
      if (q < 1.6) continue;
      if (livre(tx - 2, tz - 2, tx + 2, tz + 2)) arvore(tx, tz, 0.95 + ((h >>> 7) & 3) * 0.12, (h >>> 9) % 5 === 0 ? 1 : (h >>> 9) % 5 === 1 ? 2 : 0);
    }
    // coreto (pavilhão octogonal) a sudeste do lago, no caminho
    const kx = pcx + 30, kz = pcz + 34;
    if (okCaixa(kx - 5, kz - 5, kx + 5, kz + 5)) { coreto(kx, kz); }
    for (let a = 0; a < 16; a++) {
      const px = x0 + 6 + ((a * 37) % (x1 - x0 - 12)), pz = z0 + 6 + ((a * 53) % (z1 - z0 - 12));
      if (chao(px, pz) === 0 && livre(px, pz, px, pz) && lago(px, pz) > 1.5) poste(px, pz, 'praca');
    }
    pracas.push({ nome: 'Parque da Ilha', x: pcx, z: pcz, raio: 50 }, { nome: 'Lago do Parque', x: lcx, z: lcz, raio: 25, agua: true });
  }
  function coreto(kx, kz) {
    ocupa(kx - 5, kz - 5, kx + 5, kz + 5, 1);
    for (let z = kz - 6; z <= kz + 6; z++) for (let x = kx - 6; x <= kx + 6; x++) if (Math.sqrt((x - kx) ** 2 + (z - kz) ** 2) < 6.5) pinta(x, z, K.CASCALHO);
    poe({ x0: kx - 5, z0: kz - 5, x1: kx + 5, z1: kz + 5, pri: 2, col(S, x, z) {
      const dx = x - kx, dz = z - kz, oct = Math.max(Math.abs(dx), Math.abs(dz), (Math.abs(dx) + Math.abs(dz)) * 0.7071 + 0.3);
      if (oct > 5.2) return;
      if (oct <= 4.2) S(x, 52, z, B.MARBLE);
      if (oct > 3.5 && oct <= 4.2) { S(x, 51, z, B.STONE_BRICKS); if ((Math.abs(dx) === 4 && Math.abs(dz) <= 1 && dz !== 0) || (Math.abs(dz) === 4 && Math.abs(dx) <= 1 && dx !== 0) || (Math.abs(dx) === 3 && Math.abs(dz) === 3)) for (let y = 53; y <= 56; y++) S(x, y, z, B.PLASTER_WHITE); }
      // telhado em cone escalonado
      for (let L = 0; L <= 4; L++) { const r = 5.2 - L * 1.15; if (oct <= r && oct > r - 1.2) S(x, 57 + L, z, L === 0 ? B.PLASTER_WHITE : B.ROOF); }
      if (dx === 0 && dz === 0) { S(x, 56, z, B.LAMP); S(x, 61, z, B.ROOF); S(x, 62, z, B.GOLD_BLOCK); }
    } });
  }

  // ==============================================================================================================
  // 7) LARGO DO CAIS (calçada portuguesa) e TORRE DO RELÓGIO; MERCADO COBERTO ao lado
  {
    const x0 = W(largo.u0), z0 = Zw(largo.v0), x1 = W(largo.u1), z1 = Zw(largo.v1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (!ok(x, z)) continue;
      const u = x - CX, v = z - CZ, tri = Math.abs((((v % 12) + 12) % 12) - 6);
      pinta(x, z, ((((u + tri) % 8) + 8) % 8) < 3 ? K.ONDA : K.PISO_B);
      if (Math.abs(v) === 34 || u === largo.u1) pinta(x, z, K.PISO_A);
    }
    // a torre fica ao norte da avenida, onde o caminho do cais encontra o largo
    let tx = W(-343), tz = Zw(-22);
    for (let k = 0; k < 20 && !okCaixa(tx - 5, tz - 5, tx + 5, tz + 5); k++) tx += 1;
    if (okCaixa(tx - 5, tz - 5, tx + 5, tz + 5)) torreRelogio(tx, tz);
    for (const dv of [-14, 14]) for (const du of [-352, -340]) { const px = W(du), pz = Zw(dv); if (ok(px, pz) && livre(px, pz, px, pz)) poste(px, pz, 'praca'); }
    for (const dv of [-28, 26]) { const px = W(-337), pz = Zw(dv); if (livre(px - 2, pz - 2, px + 2, pz + 2)) arvore(px, pz, 1.05, 2); }
    pracas.push({ nome: 'Largo do Cais', x: W(-345), z: CZ, raio: 18 });
  }
  function torreRelogio(tx, tz) {
    ocupa(tx - 4, tz - 4, tx + 4, tz + 4, 1);
    predios.push({ id: predios.length + 1, tipo: 'torre-relogio', x0: tx - 3, z0: tz - 3, x1: tx + 3, z1: tz + 3, y: 52, andares: 1, porta: [tx, 52, tz + 3], frente: [tx, 52, tz + 5], altura: 104 });
    for (let z = tz - 4; z <= tz + 4; z++) for (let x = tx - 4; x <= tx + 4; x++) pinta(x, z, K.PISO_A);
    poe({ x0: tx - 4, z0: tz - 4, x1: tx + 4, z1: tz + 4, pri: 2, col(S, x, z) {
      const dx = x - tx, dz = z - tz, q = Math.max(Math.abs(dx), Math.abs(dz)), quina = Math.abs(dx) === Math.abs(dz);
      S(x, 51, z, B.STONE_BRICKS);
      if (q === 4) { if (!(dx === 0 && dz === 4)) S(x, 52, z, B.STONE_BRICKS); S(x, 81, z, B.STONE_BRICKS); S(x, 89, z, B.STONE_BRICKS); S(x, 95, z, B.ROOF); return; }
      // face de cada lado (para o mostrador e a porta): a = posição na face, −3…3
      const face = Math.abs(dz) === 3 && !quina ? (dz > 0 ? 2 : 0) : Math.abs(dx) === 3 && !quina ? (dx > 0 ? 1 : 3) : -1;
      const a = face === 0 || face === 2 ? dx : dz;
      for (let y = 52; y <= 94; y++) {
        if (q === 3) {
          let b;
          if (quina) b = B.STONE_BRICKS;
          else if (y <= 80) {
            if (face === 2 && a === 0 && y <= 53) b = B.AIR;                                  // porta
            else if (Math.abs(a) === 0 && y >= 57 && (y - 57) % 6 < 3) b = B.GLASS;           // seteiras
            else b = (y % 8 === 0) ? B.STONE_BRICKS : B.SANDSTONE;
          } else if (y === 81) b = B.STONE_BRICKS;
          else if (y <= 88) {
            const dy = y - 85, dd = Math.abs(a) + Math.abs(dy) * 1.0;                        // mostrador 5 × 5 sem as quinas
            if (Math.abs(a) <= 2 && Math.abs(dy) <= 2 && !(Math.abs(a) === 2 && Math.abs(dy) === 2)) b = (a === 0 && dy >= 0 && dy <= 2) || (dy === 0 && a === 1) ? B.PLASTER_DARK : dd === 0 ? B.GOLD_BLOCK : B.GLASS_GOLD;
            else b = B.MARBLE;
          } else if (y === 89) b = B.STONE_BRICKS;
          else b = Math.abs(a) <= 1 && y <= 93 ? B.AIR : B.SANDSTONE;                          // campanário em arco
          S(x, y, z, b);
        } else if (q <= 2) {
          if (y === 55 || y === 81 || y === 89) S(x, y, z, B.PLANKS);                           // pisos
          if (q === 2 && y === 85 && (Math.abs(dx) === 0 || Math.abs(dz) === 0)) S(x, y, z, B.LAMP); // luz atrás do mostrador
          if (q === 0 && y === 91) S(x, y, z, B.GOLD_BLOCK);                                    // sino
          if (q === 0 && y >= 92) S(x, y, z, B.STEEL);
        }
      }
      // telhado piramidal e pináculo
      for (let L = 1; L <= 4; L++) if (q === 4 - L) S(x, 95 + L, z, B.ROOF);
      if (q <= 3) S(x, 95, z, B.ROOF);
      if (q === 0) { S(x, 100, z, B.GOLD_BLOCK); for (let y = 101; y <= 104; y++) S(x, y, z, B.STEEL); }
      if (q === 3 && y94Lamp(dx, dz)) S(x, 94, z, B.LAMP);
    } });
  }
  function y94Lamp(dx, dz) { return Math.abs(dx) === 3 && Math.abs(dz) === 3; }

  if (mercadoQ) mercado(mercadoQ);
  function mercado(q) {
    const x0 = q.x0 + 1, x1 = q.x1 - 1, z0 = q.z0 + 1, z1 = q.z1 - 1;
    if (!okCaixa(x0, z0, x1, z1, 1)) return;
    ocupa(x0 - 1, z0 - 1, x1 + 1, z1 + 1, 1);
    const D = z1 - z0 + 1, De = D + 2, cz = (z0 + z1) / 2;
    for (let z = q.z0; z <= q.z1; z++) for (let x = q.x0; x <= q.x1; x++) pinta(x, z, ((x - z) & 3) === 0 ? K.PISO_C : K.PISO_A);
    predios.push({ id: predios.length + 1, tipo: 'mercado', x0, z0, x1, z1, y: 52, andares: 1, porta: [(x0 + x1) >> 1, 52, z0], frente: [(x0 + x1) >> 1, 52, q.z0 - 1], altura: 66 });
    pracas.push({ nome: 'Mercado Coberto', x: (x0 + x1) >> 1, z: Math.round(cz), raio: 14, coberto: true });
    const barracas = [], zr0 = Math.round(cz) - 7, zr1 = Math.round(cz) + 5;
    for (let x = x0 + 3; x + 2 <= x1 - 3; x += 5) for (const zr of [zr0, zr1]) barracas.push([x, zr, H(x, zr, 707)]);
    poe({ x0: x0 - 1, z0: z0 - 1, x1: x1 + 1, z1: z1 + 1, pri: 2, col(S, x, z) {
      const i = x - x0, j = z - z0, borda = x === x0 || x === x1 || z === z0 || z === z1;
      const fora = x < x0 || x > x1 || z < z0 || z > z1;
      const jj = j + 1, e = Math.min(jj, De - 1 - jj), yr = 58 + (e >> 1);
      // cobertura em duas águas de telha, claraboia de vidro na cumeeira e nervuras de aço
      const nerv = ((x - x0) % 4) === 0;
      S(x, yr, z, e >= 12 ? (nerv ? B.STEEL : B.GLASS_SMOKE) : nerv ? B.STEEL : B.ROOF);
      if (fora) return;
      S(x, 51, z, (i % 6 === 0 || j % 6 === 0) ? B.STONE_BRICKS : B.SANDSTONE);
      const pilar = borda && ((z === z0 || z === z1) ? (i % 4) === 0 : (j % 4) === 0) && !(z === z0 && Math.abs(x - ((x0 + x1) >> 1)) <= 2);
      if (pilar) for (let y = 52; y < 58; y++) S(x, y, z, y === 52 ? B.STONE_BRICKS : y === 57 ? B.SANDSTONE : B.STEEL);
      if (borda) S(x, 57, z, B.SANDSTONE);
      // oitões fechados com rosácea de vidro dourado
      if (x === x0 || x === x1) for (let y = 58; y < yr; y++) { const dz = z - cz, dy = y - 60; S(x, y, z, dz * dz + dy * dy * 2.2 < 18 ? ((Math.abs(dz) + Math.abs(dy)) % 3 === 0 ? B.STEEL : B.GLASS_GOLD) : B.SANDSTONE); }
      // luminárias penduradas no eixo
      if (Math.abs(z - cz) < 0.6 && ((x - x0) % 8) === 4) { for (let y = 58; y < yr; y++) S(x, y, z, B.STEEL); S(x, 57, z, B.LAMP); }
      // barracas: balcão de tábua, mercadoria, toldo listrado em postes
      if ((z >= zr0 && z <= zr0 + 1) || (z >= zr1 && z <= zr1 + 1)) {
        for (const [bx, bz, hb] of barracas) {
          if (x < bx || x > bx + 2 || z < bz || z > bz + 1) continue;
          const cor = [B.PLASTER_RED, B.PLASTER_GREEN, B.PLASTER_BLUE, B.PLASTER_YELLOW][hb & 3];
          const frente = bz < cz ? bz + 1 : bz;
          if (z === frente) { S(x, 52, z, B.PLANKS); S(x, 53, z, [B.LEAVES, B.PLASTER_YELLOW, B.PLASTER_RED, B.GOLD_BLOCK, B.PLASTER_GREEN, B.LEAVES][(hb >>> (2 + x - bx)) % 6]); }
          if ((x === bx || x === bx + 2) && z !== frente) for (let y = 52; y <= 54; y++) S(x, y, z, B.LOG);
          S(x, 55, z, ((x - bx) & 1) ? B.PLASTER_WHITE : cor);
        }
      }
    } });
  }

  // ==============================================================================================================
  // 8) FAROL na ponta nordeste
  function farol(fx, fz) {
    ocupa(fx - 6, fz - 6, fx + 6, fz + 6, 1);
    for (let z = fz - 6; z <= fz + 6; z++) for (let x = fx - 6; x <= fx + 6; x++) { const d = Math.sqrt((x - fx) ** 2 + (z - fz) ** 2); if (d < 6.5) pinta(x, z, d < 5.5 ? K.PISO_A : K.CASCALHO); }
    // porta virada para o centro da ilha
    const dxc = CX - fx, dzc = CZ - fz, ad = Math.abs(dxc) > Math.abs(dzc);
    const pd = ad ? [Math.sign(dxc), 0] : [0, Math.sign(dzc)];
    predios.push({ id: predios.length + 1, tipo: 'farol', x0: fx - 3, z0: fz - 3, x1: fx + 3, z1: fz + 3, y: 52, andares: 1, porta: [fx + pd[0] * 3, 52, fz + pd[1] * 3], frente: [fx + pd[0] * 6, 52, fz + pd[1] * 6], altura: 92 });
    pracas.push({ nome: 'Farol', x: fx, z: fz, raio: 6 });
    poe({ x0: fx - 5, z0: fz - 5, x1: fx + 5, z1: fz + 5, pri: 2, col(S, x, z) {
      const dx = x - fx, dz = z - fz, d = Math.sqrt(dx * dx + dz * dz);
      if (d > 5.3) return;
      S(x, 51, z, B.STONE_BRICKS);
      for (let y = 52; y <= 82; y++) {
        const r = 3.55 - (y - 52) * 0.035;
        if (d < r && d >= r - 1.05) {
          const porta = y <= 53 && dx === pd[0] * 3 && dz === pd[1] * 3;
          const janela = (y === 62 || y === 63 || y === 72 || y === 73) && (dx === 0 || dz === 0);
          S(x, y, z, porta ? B.AIR : janela ? B.GLASS : (Math.floor((y - 52) / 5) & 1) ? B.PLASTER_RED : B.PLASTER_WHITE);
        } else if (d < r - 1.05 && (y === 62 || y === 72)) S(x, y, z, B.PLANKS);
      }
      if (d < 4.6) S(x, 83, z, B.STEEL);                                  // galeria
      if (d < 4.6 && d >= 3.7) S(x, 84, z, B.GLASS);                      // guarda-corpo de vidro
      if (d < 2.4) {
        if (d >= 1.5) { for (let y = 84; y <= 87; y++) S(x, y, z, y === 84 ? B.STEEL : B.GLASS); }
        else for (let y = 84; y <= 87; y++) S(x, y, z, y === 84 ? B.STEEL : B.LAMP);
        S(x, 88, z, B.PLASTER_RED);
      }
      if (d < 1.5) S(x, 89, z, B.PLASTER_RED);
      if (dx === 0 && dz === 0) { S(x, 90, z, B.STEEL); S(x, 91, z, B.GOLD_BLOCK); }
    } });
  }

  // ==============================================================================================================
  // 9) ESTÁDIO (campo 65 × 43, recuo de 5 atrás dos gols e 4 nas laterais; 12 degraus em volta; concurso por baixo;
  //    fachada em arcos com faixa de vidro; cobertura nas laterais; quatro torres de refletor; placar KRAFT)
  const C = CIDADE.campo;
  const FX = W(Math.round((ESTADIO_Q.u0 + ESTADIO_Q.u1) / 2) - 4), FZ = CZ;
  const AX = C.meio + 5, AZ = C.meiaLarg + 4;          // meio retângulo do gramado (campo + recuos)
  const KD = 13;                                       // anel 0 = mureta, 1…12 = degraus, 13 = fachada
  const YD = (k) => 52 + k;                            // topo do degrau k (o pé fica em YD + 1)
  let campo = null, arquibancadas = [], arquibancadasFundos = [], estadio = null;
  const estadioCabe = okCaixa(FX - AX - KD - 16, FZ - AZ - KD - 16, FX + AX + KD + 16, FZ + AZ + KD + 16);
  if (estadioCabe) {
    // esplanada: piso de praça em grade e alamedas
    const q = { x0: W(ESTADIO_Q.u0), z0: Zw(ESTADIO_Q.v0), x1: W(ESTADIO_Q.u1), z1: Zw(ESTADIO_Q.v1) };
    const ext = (x, z) => { const ox = Math.max(0, Math.abs(x - FX) - AX), oz = Math.max(0, Math.abs(z - FZ) - AZ); return Math.sqrt(ox * ox + oz * oz); };
    for (let z = q.z0; z <= q.z1; z++) for (let x = q.x0; x <= q.x1; x++) {
      const e = ext(x, z), ax = Math.abs(x - FX), az = Math.abs(z - FZ);
      const eixo = az <= 5 || ax <= 5, anel = e < KD + 6, borda = x - q.x0 < 4 || q.x1 - x < 4 || z - q.z0 < 4 || q.z1 - z < 4;
      if (anel || eixo || borda) {
        const tri = Math.abs((((x - FX) % 10) + 10) % 10 - 5);
        pinta(x, z, anel ? (Math.abs(e - (KD + 5)) < 0.5 ? K.PISO_C : K.PISO_A) : eixo ? (((((az <= 5 ? z : x) + tri) % 6) + 6) % 6 < 2 ? K.PISO_C : K.PISO_A) : K.PISO_A);
      } else if (Math.abs(e - (KD + 6.6)) < 0.6 || x - q.x0 === 4 || q.x1 - x === 4 || z - q.z0 === 4 || q.z1 - z === 4 || ax === 6 || az === 6) pinta(x, z, K.SEBE);
      else if (ru(x * 0.07, z * 0.07) > 0.35) pinta(x, z, K.FLOR);
    }
    for (let z = FZ - AZ - KD - 1; z <= FZ + AZ + KD + 1; z++) for (let x = FX - AX - KD - 1; x <= FX + AX + KD + 1; x++) if (ext(x, z) <= KD + 0.001) { const k = ri(x, z); if (k >= 0) { G[k] = K.ESTADIO; OCC[k] = 1; } }
    // alamedas de árvores na esplanada (fora do anel e longe das torres de refletor)
    for (let z = q.z0 + 3; z <= q.z1 - 3; z += 7) for (let x = q.x0 + 3; x <= q.x1 - 3; x += 7) {
      const e = ext(x, z);
      if (e < KD + 9) continue;
      if (Math.abs(Math.abs(x - FX) - (AX + 12)) < 5 && Math.abs(Math.abs(z - FZ) - (AZ + 12)) < 5) continue;
      if (Math.abs(z - FZ) <= 6 || Math.abs(x - FX) <= 6) continue;                         // eixos de entrada livres
      const tx = x + (H(x, z, 9) & 1), tz = z + ((H(x, z, 9) >>> 1) & 1);
      if (chao(tx, tz) === K.PISO_A || chao(tx, tz) === K.PISO_C) continue;
      if (livre(tx - 2, tz - 2, tx + 2, tz + 2)) arvore(tx, tz, 1 + (H(x, z, 10) & 3) * 0.1, (H(x, z, 11) % 5) === 0 ? 2 : 0);
    }
    // postes no anel e ao longo dos eixos de entrada
    for (let a = -AX - KD - 4; a <= AX + KD + 4; a += 10) for (const sz of [-1, 1]) { const x = FX + a, z = FZ + sz * (AZ + KD + 4); if (livre(x, z, x, z)) poste(x, z, 'praca'); }
    for (let a = -AZ - KD + 2; a <= AZ + KD - 2; a += 10) for (const sx of [-1, 1]) { const x = FX + sx * (AX + KD + 4), z = FZ + a; if (Math.abs(a) > 5 && livre(x, z, x, z)) poste(x, z, 'praca'); }
    campo = montarCampo(FX, 52, FZ, 'x', C.meio, C.largGol, C.altGol, C.meiaLarg);
    // fileiras: uma por degrau e por lado (laterais: Azul ao norte, Vermelho ao sul); vomitórios abrem as 3 primeiras
    const vomX = [-24, 24, 0], vomZ = [0];
    for (let k = 1; k < KD; k++) for (const lado of [0, 1]) {
      const z = lado === 0 ? FZ - AZ - 1 - k : FZ + AZ + 1 + k;
      let ini = FX - AX;
      const cortesX = k <= 3 ? vomX.map((v) => FX + v).sort((a, b) => a - b) : [];
      for (const c of [...cortesX, FX + AX + 3]) {
        const fim = Math.min(FX + AX, c - 2);
        if (fim >= ini) arquibancadas.push({ x0: ini, x1: fim, z, y: YD(k) + 1, lado, olhar: FZ });
        ini = c + 2;
      }
      const x = lado === 0 ? FX - AX - 1 - k : FX + AX + 1 + k;                              // fundos (atrás dos gols)
      if (k <= 3) { arquibancadasFundos.push({ z0: FZ - AZ, z1: FZ - 2, x, y: YD(k) + 1, lado, olharX: FX }); arquibancadasFundos.push({ z0: FZ + 2, z1: FZ + AZ, x, y: YD(k) + 1, lado, olharX: FX }); }
      else arquibancadasFundos.push({ z0: FZ - AZ, z1: FZ + AZ, x, y: YD(k) + 1, lado, olharX: FX });
    }
    estadio = { nome: 'Arena Kraft', x: FX, z: FZ, x0: FX - AX - KD, z0: FZ - AZ - KD, x1: FX + AX + KD, z1: FZ + AZ + KD, degraus: KD - 1, lugares: arquibancadas.reduce((n, a) => n + a.x1 - a.x0 + 1, 0) + arquibancadasFundos.reduce((n, a) => n + a.z1 - a.z0 + 1, 0), entradas: [] };
    // entradas: vomitórios no meio de cada lado e nos dois terços das laterais
    const vom = (dx, dz) => (Math.abs(dz) > AZ && vomX.some((v) => Math.abs(dx - v) <= 1)) || (Math.abs(dx) > AX && vomZ.some((v) => Math.abs(dz - v) <= 1));
    for (const [ex, ez] of [[FX - AX - KD - 2, FZ], [FX + AX + KD + 2, FZ], [FX, FZ - AZ - KD - 2], [FX, FZ + AZ + KD + 2]]) estadio.entradas.push([ex, 52, ez]);
    predios.push({ id: predios.length + 1, tipo: 'estadio', x0: estadio.x0, z0: estadio.z0, x1: estadio.x1, z1: estadio.z1, y: 52, andares: 1, porta: [FX - AX - KD, 52, FZ + 3], frente: [FX - AX - KD - 2, 52, FZ + 3], altura: 99 });
    pracas.push({ nome: 'Esplanada do Estádio', x: FX, z: FZ, raio: 90 });
    const placarSet = new Set();                                                          // letras do placar KRAFT
    { const txt = 'KRAFT'; let a = -Math.floor((txt.length * 4 - 1) / 2); for (const ch of txt) { const L = LETRAS[ch]; for (let r = 0; r < 5; r++) for (let c2 = 0; c2 < 3; c2++) if (L[r][c2] === '1') placarSet.add(((a + c2 + 32) << 8) | (75 - r)); a += 4; } }
    const corTime = [B.PLASTER_BLUE, B.PLASTER_RED];
    poe({ x0: FX - AX - KD, z0: FZ - AZ - KD, x1: FX + AX + KD, z1: FZ + AZ + KD, pri: 2, col(S, x, z) {
      const dx = x - FX, dz = z - FZ, adx = Math.abs(dx), adz = Math.abs(dz);
      const ox = Math.max(0, adx - AX), oz = Math.max(0, adz - AZ);
      if (ox === 0 && oz === 0) { gramado(S, x, z, dx, dz); return; }
      const d = Math.sqrt(ox * ox + oz * oz), k = Math.ceil(d - 1e-9) - 1;
      if (k > KD) return;
      // coordenada ao longo do perímetro (padrão de pilares e corredores)
      const lateral = ox === 0, fundo = oz === 0, p = lateral ? dx : fundo ? dz : (ox > oz ? dz : dx);
      const time = dz < 0 ? 0 : 1;
      S(x, 51, z, B.CONCRETE);
      const vomit = k <= 5 && vom(dx, dz);
      if (k === 0) {                                                       // mureta de vidro sobre faixa escura
        if (vomit) return;
        S(x, 52, z, ((p % 4) + 4) % 4 === 0 ? B.LAMP : B.PLASTER_DARK); S(x, 53, z, B.GLASS); return;   // placas de LED acendem o gramado à noite
      }
      if (k < KD) {
        const yt = YD(k);
        const corredor = ((p % 12) + 12) % 12 === 6;
        const assento = corredor ? B.STONE_BRICKS : (k & 1) ? (fundo ? B.MARBLE : corTime[time]) : B.CONCRETE;
        const conc = k >= 6;                                               // concurso (galeria) por baixo das fileiras altas
        for (let y = 52; y <= yt; y++) {
          let b = y === yt ? assento : B.CONCRETE;
          if (vomit && y <= 54) b = B.AIR;
          else if (conc && y <= 55) b = (k === 9 && ((p % 6) + 6) % 6 === 3) ? B.CONCRETE : B.AIR;
          else if (conc && y === 56 && k === 9 && ((p % 6) + 6) % 6 === 0) b = B.LAMP;
          else if (k >= 10 && y >= 58 && y <= 61 && y < yt - 0) b = B.AIR;   // galeria alta atrás da faixa de vidro
          else if (k === 11 && y === 62 && ((p % 6) + 6) % 6 === 3 && y < yt) b = B.LAMP;
          if (b !== B.AIR || y > 51) S(x, y, z, b);
        }
        if (lateral && Math.abs(dx) <= AX && k >= 4) cobertura(S, x, z, k, p);
        return;
      }
      // anel 13: fachada
      const ph = ((p % 6) + 6) % 6;
      const pilar = ph === 0;
      for (let y = 52; y <= 68; y++) {
        let b;
        if (pilar) b = y >= 67 ? B.STEEL : B.MARBLE;
        else if (y <= 54) b = B.AIR;
        else if (y === 55) b = (ph === 1 || ph === 5) ? B.CONCRETE : B.AIR;
        else if (y === 56) b = ph === 3 ? B.LAMP : B.CONCRETE;
        else if (y === 57) b = B.CONCRETE;
        else if (y <= 61) b = ph === 3 ? B.STEEL : B.GLASS_BLUE;
        else if (y === 62) b = B.STEEL;
        else if (y <= 66) b = ph === 3 ? B.GLASS_BLUE : (ph & 1) ? B.PLASTER_WHITE : B.STEEL;
        else if (y === 67) b = B.STEEL;
        else b = B.PLASTER_WHITE;
        S(x, y, z, b);
      }
      if (pilar && ((p % 12) + 12) % 12 === 0) S(x, 69, z, B.LAMP);
      if (lateral && Math.abs(dx) <= AX) cobertura(S, x, z, k, p);
      // placar KRAFT sobre a fachada do fundo leste (letras de luz em painel escuro, moldura de aço)
      if (fundo && dx > 0 && adz <= 11) {
        const dzKey = (dz + 32) << 8;
        for (let y = 69; y <= 77; y++) {
          const bordaP = adz === 11 || y === 69 || y === 77;
          S(x, y, z, bordaP ? B.STEEL : placarSet.has(dzKey | y) ? B.LAMP : B.PLASTER_DARK);
        }
      }
    } });
    // torres de refletor
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) torreRefletor(FX + sx * (AX + 12), FZ + sz * (AZ + 12), -sx, -sz);
  }
  function cobertura(S, x, z, k, p) {
    // cobertura em balanço sobre as laterais, caindo para o campo (1 a cada 3): nervuras de aço a cada 6 com treliça
    // por baixo, painéis de vidro fumê; testeira de aço com refletores; atrás, a parede que a sustenta
    const yr = 67 + Math.floor(k / 3), ph = ((p % 6) + 6) % 6;
    if (k === 4) { S(x, yr, z, B.STEEL); S(x, yr + 1, z, B.STEEL); if (((p % 3) + 3) % 3 === 0) S(x, yr - 1, z, B.LAMP); return; }
    S(x, yr, z, ph === 0 ? B.STEEL : B.GLASS_SMOKE);
    if (ph === 0 && k >= 9 && k < KD) for (let y = yr - (k - 8); y < yr; y++) S(x, y, z, B.STEEL);      // mão-francesa
    if (k === KD) { for (let y = 69; y < yr; y++) S(x, y, z, ph === 0 ? B.STEEL : B.CONCRETE); S(x, yr + 1, z, B.STEEL); }
  }
  function gramado(S, x, z, dx, dz) {
    const px = dx, pz = dz, apx = Math.abs(px), apz = Math.abs(pz);
    const M = C.meio, L = C.meiaLarg;
    let linha = false;
    if (apx <= M && apz <= L) {
      if (apz === L || apx === M || px === 0) linha = true;
      const dc = Math.sqrt(px * px + pz * pz); if (Math.abs(dc - 6) < 0.5 || (px === 0 && pz === 0)) linha = true;
      const ga = 9, gl = 12, pa = 3, pl = 6;                                        // grande área 9 × 25, pequena 3 × 13
      if ((apx === M - ga && apz <= gl) || (apz === gl && apx >= M - ga)) linha = true;
      if ((apx === M - pa && apz <= pl) || (apz === pl && apx >= M - pa)) linha = true;
      if (apx === M - 7 && pz === 0) linha = true;                                  // marca do pênalti
      const dp = Math.sqrt((apx - (M - 7)) ** 2 + pz * pz); if (Math.abs(dp - 5) < 0.5 && apx < M - ga) linha = true;   // meia-lua
      if (apx === M - 1 && apz === L - 1) linha = true;                             // cantos
    }
    S(x, 51, z, linha ? B.PLASTER_WHITE : B.GRASS);
    // gols (mesmo desenho de obras/campo_futebol.mjs): traves e travessão de mármore, rede de vidro 2 m atrás
    const meia = (C.largGol + 1) / 2;                                               // trave em ±3 para gol de 5
    if (apx === M && apz === meia) { S(x, 52, z, B.MARBLE); S(x, 53, z, B.MARBLE); }
    if (apx === M && apz <= meia) S(x, 54, z, B.MARBLE);
    if (apx === M + 2 && apz <= meia) for (let y = 52; y <= 54; y++) S(x, y, z, B.GLASS);
    if (apx === M + 1 && apz === meia) for (let y = 52; y <= 54; y++) S(x, y, z, B.GLASS);
    if ((apx === M + 1 || apx === M + 2) && apz < meia) S(x, 54, z, B.GLASS);
    // bancos de reservas cobertos na lateral norte, perto do meio
    if (pz === -(L + 3) && apx >= 4 && apx <= 9) { S(x, 52, z, B.PLANKS); S(x, 55, z, B.GLASS_SMOKE); }
    if (pz === -(L + 4) && apx >= 4 && apx <= 9) { for (let y = 52; y <= 54; y++) S(x, y, z, apx === 4 || apx === 9 ? B.STEEL : B.GLASS); S(x, 55, z, B.GLASS_SMOKE); }
  }
  function torreRefletor(tx, tz, sx, sz) {
    poe({ x0: tx - 2, z0: tz - 2, x1: tx + 2, z1: tz + 2, pri: 2, col(S, x, z) {
      const dx = x - tx, dz = z - tz, adx = Math.abs(dx), adz = Math.abs(dz);
      S(x, 51, z, B.CONCRETE);
      if (adx <= 1 && adz <= 1) { S(x, 52, z, B.CONCRETE); if (adx + adz <= 1) S(x, 53, z, B.CONCRETE); S(x, 94, z, B.STEEL); }
      if (adx === 0 && adz === 0) for (let y = 54; y <= 93; y++) S(x, y, z, (y % 10) === 4 ? B.PLASTER_DARK : B.STEEL);
      // cabeça: plataforma, lâmpadas nas faces voltadas para o campo, costas e teto de aço
      S(x, 95, z, B.STEEL);
      for (let y = 96; y <= 98; y++) {
        const frenteX = dx * sx === 2, frenteZ = dz * sz === 2, costas = dx * sx === -2 || dz * sz === -2;
        S(x, y, z, frenteX || frenteZ ? B.LAMP : costas ? B.STEEL : B.AIR);
      }
      S(x, 99, z, B.STEEL);
    } });
  }

  // ==============================================================================================================
  servicos.depois();
  // ordem de carimbo em cada pedaço: miudezas (árvores, postes) antes dos prédios e das obras
  for (const l of idx.values()) l.sort((a, b) => a.pri - b.pri || a.ord - b.ord);

  function obras(x0, z0, set, alt) {
    const X0 = x0, Z0 = z0, X1 = x0 + 15, Z1 = z0 + 15;
    // chão
    for (let z = Z0; z <= Z1; z++) {
      const j = z - RZ0; if (j < 0 || j >= NW) continue;
      for (let x = X0; x <= X1; x++) {
        const i = x - RX0; if (i < 0 || i >= NW) continue;
        const c = G[i + j * NW]; if (!c || c === K.ESTADIO) continue;
        if (c === K.LAGO) { set(x, 51, z, B.AIR); set(x, 50, z, B.WATER); set(x, 49, z, B.WATER); set(x, 48, z, B.CLAY); continue; }
        set(x, 51, z, CHAO[c]);
        if (c === K.FLOR) { const h = hash3(x, 52, z, SEM); if ((h & 3) !== 0) set(x, 52, z, (h & 12) === 0 ? B.TALL_GRASS : FLORES[(h >>> 4) & 3]); }
        else if (c === K.SEBE) { set(x, 52, z, B.LEAVES); }
        else if (c === K.MARGEM) set(x, 50, z, B.SAND);
      }
    }
    const l = idx.get(Math.floor(x0 / 16) + ',' + Math.floor(z0 / 16));
    if (!l) return;
    const S = (x, y, z, b) => { if (x >= X0 && x <= X1 && z >= Z0 && z <= Z1 && y >= 1 && y <= 140) set(x, y, z, b); };
    for (const it of l) {
      if (it.tudo) { it.tudo(S, X0, Z0, X1, Z1); continue; }
      const ax = Math.max(X0, it.x0), bx = Math.min(X1, it.x1), az = Math.max(Z0, it.z0), bz = Math.min(Z1, it.z1);
      for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) it.col(S, x, z, alt);
    }
  }

  return {
    obras, campo, arquibancadas, arquibancadasFundos, predios, ruas, pracas, estadio, servicos: servicos.servicos,
    naCidade: (x, z) => { const k = ri(x, z); return (k >= 0 && OK[k] === 1) || servicos.ocupado(x, z); },
    semPlanta: (x, z) => { if (servicos.ocupado(x, z)) return true; const k = ri(x, z); if (k < 0) return false; const c = G[k]; return OCC[k] !== 0 || (c !== 0 && c !== K.CANTEIRO && c !== K.FLOR); },
    // para testes e ferramentas: o código do chão de uma coluna (0 = natural)
    chao,
  };
}

const REC = 255;      // marca de janela rebaixada: vão na fachada e vidro um bloco para dentro (dá sombra e fundura)
// ---- coluna de um prédio ------------------------------------------------------------------------------------------
function colPredio(P, S, x, z) {
  const i = x - P.x0, j = z - P.z0, W = P.W, D = P.D;
  if (i < 0 || j < 0 || i >= W || j >= D) { fora(P, S, x, z, i, j); return; }
  const dc = Math.min(i, j, W - 1 - i, D - 1 - j);
  const n = P.n, ins = P.ins, hT = P.hT, hA = P.hA, y1 = 52 + hT;
  S(x, 51, z, dc === 0 ? P.base : P.piso);
  const kMax = ins[n - 1];
  if (dc > kMax + 1) {
    const centro = i === (W >> 1) && j === (D >> 1);
    for (let f = 1, y = y1; f < n; f++, y += hA) S(x, y, z, f === 1 && centro ? B.LAMP : P.laje);
    topo(P, S, x, z, i, j, dc, y1 + (n - 1) * hA, kMax, true);
    return;
  }
  let f = 0, r = 0, hF = hT;
  for (let y = 52; y < 140; y++) {
    if (f >= n) { topo(P, S, x, z, i, j, dc, y, kMax, true); return; }
    const k = ins[f];
    if (dc < k) { topo(P, S, x, z, i, j, dc, y, ins[f - 1], false); return; }
    if (dc === k) { const b = fachada(P, f, r, i, j, k, y); S(x, y, z, b === REC ? B.AIR : b); }
    else if (dc === k + 1 && P.rec && r > 0 && recuada(P, f, r, i, j, k, y)) S(x, y, z, P.janela);
    else if (r === 0 && f > 0) S(x, y, z, (dc === k + 1 && ((hash3(x, y, z, 0x1a7e) & 1023) < P.luzes * 1024)) || (f === 1 && i === (W >> 1) && j === (D >> 1)) ? B.LAMP : P.laje);
    if (++r === hF) { f++; r = 0; hF = hA; }
  }
}
// a célula de dentro (anel k + 1) está atrás de uma janela rebaixada?
function recuada(P, f, r, i, j, k, y) {
  const Wi = P.W - 2 * k, Di = P.D - 2 * k, ii = i - k, jj = j - k;
  if (jj === 1 && ii >= 1 && ii <= Wi - 2 && fachada(P, f, r, i, j - 1, k, y) === REC) return true;
  if (jj === Di - 2 && ii >= 1 && ii <= Wi - 2 && fachada(P, f, r, i, j + 1, k, y) === REC) return true;
  if (ii === 1 && jj >= 1 && jj <= Di - 2 && fachada(P, f, r, i - 1, j, k, y) === REC) return true;
  if (ii === Wi - 2 && jj >= 1 && jj <= Di - 2 && fachada(P, f, r, i + 1, j, k, y) === REC) return true;
  return false;
}
// laje de cobertura (do topo ou do terraço de um recuo), platibanda e telhado
function topo(P, S, x, z, i, j, dc, y, kBorda, doTopo) {
  if (doTopo && P.telhado) { telhado(P, S, x, z, i, j, dc); return; }
  S(x, y, z, P.cobertura);
  if (dc === kBorda) { S(x, y + 1, z, P.cornija); if (P.tipo === 'torre' && doTopo) S(x, y + 2, z, P.cornija); }
}
function telhaY(P, i, j) {
  const We = P.W + 2, De = P.D + 2, ii = i + 1, jj = j + 1;
  const e = P.telhado === 4 ? Math.min(ii, We - 1 - ii, jj, De - 1 - jj) : P.cumeX ? Math.min(jj, De - 1 - jj) : Math.min(ii, We - 1 - ii);
  return P.R - 1 + e;
}
function telhado(P, S, x, z, i, j, dc) {
  const yr = telhaY(P, i, j), R = P.R, telha = P.telha || B.ROOF;
  const oitao = P.telhado === 2 && (P.cumeX ? (i === 0 || i === P.W - 1) : (j === 0 || j === P.D - 1));
  if (dc > 0) S(x, R, z, P.laje);
  for (let y = R; y < yr; y++) {
    if (oitao) {
      const meio = P.cumeX ? Math.abs(2 * j - (P.D - 1)) <= 1 : Math.abs(2 * i - (P.W - 1)) <= 1;
      S(x, y, z, meio && y === yr - 2 ? B.GLASS : P.parede);
    } else if (dc === 0) S(x, y, z, P.parede);
  }
  S(x, yr, z, telha);
  if (P.chamine && i === P.W - 2 && j === 1) for (let y = R; y <= yr + 2; y++) S(x, y, z, B.BRICKS);
}
// fora da planta: beiral do telhado e marquise da frente
function fora(P, S, x, z, i, j) {
  if (P.telhado && i >= -1 && i <= P.W && j >= -1 && j <= P.D) { S(x, telhaY(P, i, j), z, P.telha || B.ROOF); return; }
  if (!P.marquise) return;
  const f = P.frente, d = f === 0 ? -j : f === 2 ? j - (P.D - 1) : f === 1 ? i - (P.W - 1) : -i;
  const a = f === 0 || f === 2 ? i : j, L = f === 0 || f === 2 ? P.W : P.D;
  if (d !== 1 || a < 1 || a > L - 2) return;
  const listra = P.listra && (a & 1) ? P.listra : P.marquise;
  S(x, 52 + P.hT, z, listra);
}

// ---- fachada: o bloco de uma célula da casca do prédio ----------------------------------------------------------
function fachada(P, f, r, i, j, k, y) {
  const Wi = P.W - 2 * k, Di = P.D - 2 * k, ii = i - k, jj = j - k;
  const fn = jj === 0, fs = jj === Di - 1, fw = ii === 0, fe = ii === Wi - 1;
  const quina = (fn || fs) && (fw || fe);
  let face, a, L;
  if (fn || fs) { face = fn ? 0 : 2; a = ii; L = Wi; } else { face = fe ? 1 : 3; a = jj; L = Di; }
  const dist = Math.abs(2 * a - (L - 1)) >> 1;
  const frente = face === P.frente;
  if (f === 0 && k === 0 && frente && a === P.aPorta && !quina) return r <= 1 ? B.AIR : P.verga;
  switch (P.estilo) {
    case 'vidro': {
      if (quina) return P.quina;
      if (f === 0) { if (r === P.hT - 1) return P.faixa; return dist % 4 === 3 ? P.quina : B.GLASS; }
      if (r === 0) return P.faixa;
      return dist % P.per === (P.per >> 1) ? P.montante : P.vidro;
    }
    case 'grade': case 'fita': {
      if (quina) return P.pilar;
      if (f === 0) { if (r === P.hT - 1) return P.faixa; return dist % 3 === 2 ? P.pilar : P.vidroTerreo; }
      if (P.estilo === 'fita') { if (r <= 1) return P.faixa; return dist % 6 === 5 ? P.pilar : P.vidro; }
      if (r === 0) return P.faixa;
      return dist % 3 === 2 ? P.pilar : P.vidro;
    }
    case 'tijolo': case 'reboco': {
      if (quina) return P.estilo === 'tijolo' ? ((y & 1) ? B.STONE_BRICKS : B.BRICKS) : P.friso;
      if (f === 0) {
        if (P.loja && frente) { if (r === P.hT - 1) return P.letreiro; return dist % P.perLoja === 2 ? P.friso : B.GLASS; }
        if (r === P.hT - 1) return P.friso;
        if ((r === 1 || r === 2) && dist % P.per === 0) return REC;
        return r === 0 ? B.STONE_BRICKS : P.parede;
      }
      const janCol = dist % P.per === 0, pm = dist % P.per;
      if ((P.cego >> face) & 1) return r === 0 && f === 1 ? P.friso : P.parede;              // empena: parede cega com friso
      if (r === 0) return f === 1 ? P.friso : P.parede;
      if (r === 1) return janCol ? P.friso : P.parede;
      if (janCol) return REC;
      if (P.persiana && (pm === 1 || pm === P.per - 1)) return P.persiana;
      return P.parede;
    }
    case 'casa': {
      if (quina) return P.pilar;
      const janCol = dist % P.per === 1, pm = dist % P.per;
      if (f === 0) {
        if (r === 0) return P.parede;
        if (janCol && !(frente && Math.abs(a - P.aPorta) <= 1)) return REC;
        if (P.persiana && (pm === 0 || pm === 2) && !(frente && Math.abs(a - P.aPorta) <= 1) && L > 4) return P.persiana;
        return P.parede;
      }
      if (r === 0) return P.friso;
      if ((r === 2 || r === 3) && janCol) return REC;
      return P.parede;
    }
    case 'loja': {
      if (quina) return P.pilar;
      if (f === 0) { if (r === P.hT - 1) return P.letreiro; if (frente || face === (P.frente + 1) % 4 || face === (P.frente + 3) % 4) return dist % P.perLoja === 2 && !frente ? P.parede : dist % 5 === 4 ? P.pilar : B.GLASS; return P.parede; }
      if (r === 0) return P.friso;
      if ((r === 2 || r === 3) && dist % 3 === 1) return REC;
      return P.parede;
    }
  }
  return P.parede || B.CONCRETE;
}
