// LAVRA — serviços da Ilha Metrópole (pedido do Kadmus, 24/11/2026: "onde estão os carros na grande metrópole,
// aeroporto, policiamento, bombeiros e médicos e hospital e escola?").
//
// Quem chama é shared/cidade.js (planejar): criarServicos(ctx) devolve
//   quarteirao(q)   true se o quarteirão q (coordenadas locais u0, v0) é de um serviço: o serviço é montado nele
//   depois()        monta o que fica fora da malha (o aeroporto no aterro da costa sul e a avenida de acesso)
//   ocupado(x, z)   coluna tomada por um serviço fora da malha (lá o gerador não planta árvore nem capim)
//   servicos        lista para o mapa e para os moradores: { tipo, nome, x, z, porta, frente, vagas: [[x, z, rumo]] }
// Como em cidade.js: função fechada da ficha da ilha, só operações exatas (nada de sin/cos/pow/Math.random).
//
// Cada edifício é uma "caixa" de voxels (Uint16Array) montada uma vez no plano e carimbada por coluna; 0 = não mexe,
// AR = ar explícito. O chão do quarteirão usa o retrato da cidade (pinta) como o resto da malha.
//
// Planta (u = x − centro, v = z − centro da ilha; quarteirões de 43 m entre as ruas a cada 56 m):
//   Hospital Central   u 54…96,    v 54…96     (a sudeste da Praça Central): 6 andares, heliponto, pronto-socorro
//   Escola Municipal   u 54…96,    v 166…208   2 andares em L, quadra poliesportiva, parquinho, mastro
//   Delegacia          u −152…−110, v 110…152  3 andares, pátio das viaturas coberto, antena de rádio
//   Quartel dos Bombeiros u 110…152, v 110…152 3 portões de garagem, torre de treino
//   Aeroporto          aterro na costa sul (u −175…215, v 384…477), ligado à Travessa de u = 47 por uma avenida:
//                      pista de 360 × 24 m, pista de táxi, pátio, terminal com três pontes de embarque, torre de
//                      controle, dois hangares e biruta.
// Nenhum desses lugares tinha obra de jogador gravada (conferido em world.json → edits, 24/11).

const AR = 0xffff;

// letras 5 de altura (linha de cima primeiro); M e a cruz com 5 de largura
const FONTE = {
  A: ['010', '101', '111', '101', '101'], B: ['110', '101', '110', '101', '110'], C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'], E: ['111', '100', '110', '100', '111'], H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'], L: ['100', '100', '100', '100', '111'], O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'], R: ['110', '101', '110', '101', '101'], S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'], U: ['101', '101', '101', '101', '111'], N: ['101', '111', '111', '111', '101'],
  M: ['10001', '11011', '10101', '10001', '10001'], ' ': ['0', '0', '0', '0', '0'],
  '+': ['00100', '00100', '11111', '00100', '00100'],
};
export function larguraTexto(t) { let w = 0; for (const ch of t) w += (FONTE[ch] || FONTE[' '])[0].length + 1; return Math.max(0, w - 1); }

// caixa de voxels: [x0, x1] × [y0, y1] × [z0, z1] (mundo)
function caixa(x0, y0, z0, x1, y1, z1) {
  const W = x1 - x0 + 1, H = y1 - y0 + 1, D = z1 - z0 + 1, d = new Uint16Array(W * H * D);
  const i = (x, y, z) => (x - x0) + W * ((z - z0) + D * (y - y0));
  const den = (x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
  const c = {
    x0, y0, z0, x1, y1, z1,
    set(x, y, z, b) { if (den(x, y, z)) d[i(x, y, z)] = b === 0 ? AR : b; },
    get(x, y, z) { if (!den(x, y, z)) return 0; const v = d[i(x, y, z)]; return v === AR ? 0 : v; },
    tem(x, y, z) { return den(x, y, z) && d[i(x, y, z)] !== 0; },
    box(xa, ya, za, xb, yb, zb, b) { for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) for (let x = xa; x <= xb; x++) c.set(x, y, z, b); },
    // paredes de um retângulo (sem teto nem piso)
    casca(xa, ya, za, xb, yb, zb, f) {
      for (let y = ya; y <= yb; y++) for (let z = za; z <= zb; z++) for (let x = xa; x <= xb; x++) {
        if (x !== xa && x !== xb && z !== za && z !== zb) continue;
        const b = typeof f === 'function' ? f(x, y, z) : f; if (b !== undefined && b !== null) c.set(x, y, z, b);
      }
    },
    col(S, x, z) {
      if (x < x0 || x > x1 || z < z0 || z > z1) return;
      for (let y = y0; y <= y1; y++) { const v = d[i(x, y, z)]; if (v) S(x, y, z, v === AR ? 0 : v); }
    },
  };
  return c;
}

// texto numa fachada: (ax, az) é a ponta da esquerda (de quem olha), n = normal para fora; y = linha de cima
function escreve(c, texto, ax, ytopo, az, n, letra, fundo) {
  const rx = n[1], rz = -n[0];              // direita de quem olha a fachada de fora
  let a = 0;
  for (const ch of texto) {
    const g = FONTE[ch] || FONTE[' '];
    for (let r = 0; r < 5; r++) for (let k = 0; k < g[r].length; k++) {
      const on = g[r][k] === '1';
      if (on || fundo) c.set(ax + rx * (a + k), ytopo - r, az + rz * (a + k), on ? letra : fundo);
    }
    if (fundo) for (let r = 0; r < 5; r++) c.set(ax + rx * (a + g[0].length), ytopo - r, az + rz * (a + g[0].length), fundo);
    a += g[0].length + 1;
  }
}

export function criarServicos(ctx) {
  const { CX, CZ, B, K, H, pinta, ocupa, poe, predios, pracas, arvore, poste } = ctx;
  const W = (u) => CX + u, Zw = (v) => CZ + v;
  const servicos = [];
  const fora = [];                                        // retângulos fora da malha: sem árvore, sem capim
  const ASF = B.PLASTER_DARK;

  function registra(tipo, nome, c, porta, frente, extra = {}) {
    const id = predios.length + 1;
    predios.push({ id, tipo, x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1, y: 52, andares: extra.andares || 1, porta, frente, altura: extra.altura || c.y1 + 1 });
    servicos.push({ tipo, nome, x: (c.x0 + c.x1) >> 1, z: (c.z0 + c.z1) >> 1, porta, frente, vagas: extra.vagas || [] });
  }
  const carimba = (c, pri = 2) => poe({ x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1, pri, col(S, x, z) { c.col(S, x, z); } });

  // fachada padrão de um bloco de andares: pilares a cada `passo`, janelas de 2 de altura, laje marcada
  // lajes: lista de y das lajes (a primeira é o piso do térreo, 51; a última é a cobertura)
  function bloco(c, xa, za, xb, zb, lajes, m) {
    const topo = lajes[lajes.length - 1];
    for (let y = 52; y <= topo + 1; y++) c.casca(xa, y, za, xb, y, zb, (x, yy, z) => {
      const quina = (x === xa || x === xb) && (z === za || z === zb);
      if (yy === topo + 1) return m.parapeito;
      if (lajes.includes(yy)) return m.laje;
      if (quina) return m.quina;
      const a = (z === za || z === zb) ? x - xa : z - za;
      const f = lajes.findIndex((l, k) => k + 1 < lajes.length && yy > l && yy < lajes[k + 1]);
      const r = yy - lajes[f];
      if (a % m.passo === 0) return m.pilar;
      if (f === 0) return r <= (m.vitrine || 3) ? (m.vidroTerreo || m.vidro) : m.parede;
      return r >= 1 && r <= 2 ? m.vidro : m.parede;
    });
    for (const l of lajes) for (let z = za + 1; z < zb; z++) for (let x = xa + 1; x < xb; x++) {
      if (l === 51) { c.set(x, 51, z, m.piso); continue; }
      const luz = l !== topo && ((x - xa) % 6 === 3) && ((z - za) % 6 === 3);
      c.set(x, l, z, luz ? B.LAMP : (l === topo ? m.cobertura : m.laje));
    }
  }
  // porta (vão) numa fachada: centro (px, pz), largura w, altura h, normal n
  function vao(c, px, pz, n, w, h, y0 = 52) {
    const rx = n[1], rz = -n[0], m = (w - 1) >> 1;
    for (let k = -m; k <= w - 1 - m; k++) for (let y = y0; y < y0 + h; y++) c.set(px + rx * k, y, pz + rz * k, 0);
  }
  function mastro(c, x, z, yBase, hgt, bandeira) {
    for (let y = yBase; y < yBase + hgt; y++) c.set(x, y, z, B.STEEL);
    c.set(x, yBase + hgt, z, B.GOLD_BLOCK);
    bandeira.forEach((linha, r) => { for (let k = 0; k < linha.length; k++) c.set(x + 1 + k, yBase + hgt - 1 - r, z, linha[k]); });
  }
  const BRASIL = () => [[B.PLASTER_GREEN, B.PLASTER_YELLOW, B.PLASTER_YELLOW, B.PLASTER_GREEN], [B.PLASTER_YELLOW, B.PLASTER_BLUE, B.PLASTER_BLUE, B.PLASTER_YELLOW], [B.PLASTER_GREEN, B.PLASTER_YELLOW, B.PLASTER_YELLOW, B.PLASTER_GREEN]];
  // estacionamento no retrato do chão: asfalto com faixas brancas a cada 3 (vagas em z se emX)
  function estacionamento(x0, z0, x1, z1, emX) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const a = emX ? x - x0 : z - z0, b = emX ? z - z0 : x - x0, L = emX ? z1 - z0 : x1 - x0;
      const linha = a % 3 === 0 && (b <= 4 || b >= L - 4);
      pinta(x, z, linha ? K.BRANCA : K.ASF);
    }
  }
  function jardimFrente(x0, z0, x1, z1, livre) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (!livre(x, z)) pinta(x, z, (x === x0 || x === x1 || z === z0 || z === z1) ? K.SEBE : ((H(x, z, 9) & 7) === 0 ? K.FLOR : K.CANTEIRO));
  }

  // ================================================================================================================
  // HOSPITAL CENTRAL
  function hospital(q) {
    const { x0, z0, x1, z1 } = q;
    const c = caixa(x0, 51, z0, x1, 84, z1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) pinta(x, z, ((x + z) & 7) === 0 ? K.PISO_B : K.PISO_D);
    const bx0 = x0 + 5, bx1 = x0 + 37, bz0 = z0 + 8, bz1 = z0 + 26, cx = x0 + 21;
    const lajes = [51, 57, 61, 65, 69, 73, 77];
    bloco(c, bx0, bz0, bx1, bz1, lajes, { parede: B.PLASTER_WHITE, pilar: B.PLASTER_WHITE, quina: B.MARBLE, laje: B.PLASTER_WHITE, parapeito: B.MARBLE, vidro: B.GLASS_BLUE, vidroTerreo: B.GLASS, piso: B.MARBLE, cobertura: B.CONCRETE, passo: 4, vitrine: 4 });
    ocupa(x0, z0, x1, z1);
    // faixa vermelha com o nome na fachada norte (1º andar) e cruz vermelha nas duas fachadas compridas
    const t = 'HOSPITAL', wt = larguraTexto(t);
    for (let x = bx0 + 1; x < bx1; x++) for (let y = 58; y <= 60; y++) if (!c.tem(x, y, bz0) || c.get(x, y, bz0) === B.GLASS_BLUE) c.set(x, y, bz0, B.PLASTER_RED);
    for (let x = bx0 + 1; x < bx1; x++) { c.set(x, 57, bz0, B.PLASTER_RED); c.set(x, 61, bz0, B.PLASTER_RED); }
    escreve(c, t, cx + (wt >> 1), 61, bz0, [0, -1], B.PLASTER_WHITE, null);
    for (const [zf, n] of [[bz0, [0, -1]], [bz1, [0, 1]]]) {
      for (let y = 66; y <= 76; y++) for (let k = -4; k <= 4; k++) c.set(cx + k, y, zf, B.PLASTER_WHITE);
      for (let y = 67; y <= 75; y++) for (let k = -1; k <= 1; k++) c.set(cx + k, y, zf, B.GLASS_RED);
      for (let y = 70; y <= 72; y++) for (let k = -4 + 1; k <= 3; k++) c.set(cx + k, y, zf, B.GLASS_RED);
      void n;
    }
    // entrada principal com marquise
    vao(c, cx, bz0, [0, -1], 5, 4);
    for (let z = z0 + 3; z < bz0; z++) for (let x = cx - 4; x <= cx + 4; x++) c.set(x, 57, z, (x === cx - 4 || x === cx + 4 || z === z0 + 3) ? B.STEEL : B.GLASS_SMOKE);
    for (const x of [cx - 4, cx + 4]) for (let y = 52; y <= 56; y++) c.set(x, y, z0 + 3, B.STEEL);
    // pronto-socorro na fachada leste: portão largo, faixa vermelha e cobertura das ambulâncias
    const pz = bz0 + 9;
    vao(c, bx1, pz, [1, 0], 5, 4);
    for (let z = pz - 4; z <= pz + 4; z++) for (let y = 56; y <= 56; y++) c.set(bx1, y, z, B.PLASTER_RED);
    for (let z = pz - 4; z <= pz + 4; z++) for (let x = bx1 + 1; x <= x1 - 1; x++) c.set(x, 57, z, (z === pz - 4 || z === pz + 4 || x === x1 - 1) ? B.PLASTER_RED : B.PLASTER_WHITE);
    for (const z of [pz - 4, pz + 4]) for (let y = 52; y <= 56; y++) c.set(x1 - 1, y, z, B.STEEL);
    for (let z = pz - 3; z <= pz + 3; z++) for (let x = bx1 + 1; x <= x1 - 1; x++) pinta(x, z, (z === pz) ? K.AMARELA : K.ASF);
    escreve(c, '+', bx1 + 1 + 0, 62, pz + 2, [1, 0], B.GLASS_RED, B.PLASTER_WHITE);
    // recepção, sala de espera e enfermaria no térreo
    for (let x = cx - 4; x <= cx + 4; x++) c.set(x, 52, bz0 + 6, B.PLASTER_BLUE);
    for (let k = 0; k < 4; k++) for (let x = cx - 6; x <= cx + 6; x += 3) c.set(x, 52, bz0 + 9 + k * 2, B.STAIR_CONCRETE);
    for (let z = bz0 + 2; z <= bz1 - 2; z += 3) for (const x of [bx0 + 2, bx0 + 6]) { c.set(x, 52, z, B.PLASTER_WHITE); c.set(x + 1, 52, z, B.PLASTER_WHITE); c.set(x + 2, 52, z, B.PLASTER_BLUE); }
    for (let x = bx1 - 7; x <= bx1 - 2; x++) c.set(x, 52, bz0 + 2, B.PLASTER_WHITE);
    // heliponto na cobertura: círculo amarelo, H branco, luzes nas quinas
    const hx = cx, hz = (bz0 + bz1) >> 1;
    for (let z = bz0 + 1; z < bz1; z++) for (let x = bx0 + 1; x < bx1; x++) {
      const d2 = (x - hx) * (x - hx) + (z - hz) * (z - hz);
      if (d2 <= 64 && d2 >= 42) c.set(x, 77, z, B.PLASTER_YELLOW);
      else if (d2 < 42) c.set(x, 77, z, B.PLASTER_DARK);
    }
    for (let dz = -3; dz <= 3; dz++) { c.set(hx - 2, 77, hz + dz, B.PLASTER_WHITE); c.set(hx + 2, 77, hz + dz, B.PLASTER_WHITE); }
    for (let dx = -1; dx <= 1; dx++) c.set(hx + dx, 77, hz, B.PLASTER_WHITE);
    for (const [qx, qz] of [[bx0, bz0], [bx1, bz0], [bx0, bz1], [bx1, bz1]]) c.set(qx, 79, qz, B.LAMP);
    // casa de máquinas e antena no canto oeste do teto
    c.box(bx0 + 2, 78, bz0 + 2, bx0 + 5, 80, bz0 + 5, B.CONCRETE); for (let y = 81; y <= 84; y++) c.set(bx0 + 3, y, bz0 + 3, B.STEEL);
    // estacionamento ao sul, jardim e árvores na frente
    estacionamento(x0 + 2, z0 + 30, x1 - 2, z1 - 1, true);
    for (const x of [x0 + 2, x0 + 9, x1 - 9, x1 - 2]) if (x < cx - 5 || x > cx + 5) arvore(x, z0 + 1, 0.9);
    const vagas = [];
    for (let k = 0; k < 3; k++) vagas.push([bx1 + 3 + k * 0, pz - 2 + k * 2, 1]);
    for (let x = x0 + 3; x <= x1 - 4; x += 3) vagas.push([x, z0 + 32, 0]);
    carimba(c);
    registra('hospital', 'Hospital Central', c, [cx, 52, bz0], [cx, 52, z0 - 1], { andares: 6, altura: 85, vagas });
    pracas.push({ nome: 'Hospital Central', x: cx, z: z0 + 4, raio: 6 });
  }

  // ================================================================================================================
  // ESCOLA MUNICIPAL
  function escola(q) {
    const { x0, z0, x1, z1 } = q;
    const c = caixa(x0, 51, z0, x1, 70, z1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) pinta(x, z, K.PISO_C);
    ocupa(x0, z0, x1, z1);
    const m = { parede: B.PLASTER_YELLOW, pilar: B.PLASTER_WHITE, quina: B.PLASTER_WHITE, laje: B.PLASTER_WHITE, parapeito: B.PLASTER_WHITE, vidro: B.GLASS, piso: B.PLANKS, cobertura: B.CONCRETE, passo: 3 };
    const lajes = [51, 56, 60];
    bloco(c, x0 + 3, z0 + 4, x0 + 39, z0 + 13, lajes, m);            // ala norte (salas de aula)
    bloco(c, x0 + 3, z0 + 13, x0 + 12, z0 + 33, lajes, m);           // ala oeste (biblioteca, refeitório)
    // a junção das alas fica aberta por dentro
    for (let x = x0 + 4; x <= x0 + 11; x++) for (let y = 52; y <= 59; y++) if (y !== 56) c.set(x, y, z0 + 13, 0);
    const cx = x0 + 21;
    vao(c, cx, z0 + 4, [0, -1], 3, 3);
    vao(c, x0 + 12, z0 + 24, [1, 0], 3, 3);
    vao(c, x0 + 30, z0 + 13, [0, 1], 3, 3);
    // frontão com o nome
    const t = 'ESCOLA', wt = larguraTexto(t);
    for (let x = cx - (wt >> 1) - 2; x <= cx + (wt >> 1) + 2; x++) for (let y = 61; y <= 67; y++) c.set(x, y, z0 + 4, B.PLASTER_BLUE);
    escreve(c, t, cx + (wt >> 1), 66, z0 + 4, [0, -1], B.PLASTER_WHITE, null);
    // carteiras nas salas (blocos de tábua em fileiras) e quadro-negro
    for (let x = x0 + 9; x <= x0 + 36; x += 9) for (let z = z0 + 5; z <= z0 + 12; z++) for (let y = 52; y <= 55; y++) c.set(x, y, z, (z === z0 + 11 && y <= 53) ? 0 : B.PLASTER_WHITE);
    for (let k = 0; k < 4; k++) {
      const xa = x0 + 9 * k + 4;
      for (let x = xa + 1; x <= xa + 6; x += 2) for (const z of [z0 + 6, z0 + 8]) c.set(x, 52, z, B.PLANKS);
      for (let x = xa + 2; x <= xa + 5; x++) for (let y = 53; y <= 54; y++) c.set(x, y, z0 + 12, B.PLASTER_GREEN);
    }
    // quadra poliesportiva: piso azul, linhas brancas, traves, alambrado baixo
    const qx0 = x0 + 17, qx1 = x0 + 40, qz0 = z0 + 17, qz1 = z0 + 33, qcx = (qx0 + qx1) >> 1, qcz = (qz0 + qz1) >> 1;
    for (let z = qz0 - 1; z <= qz1 + 1; z++) for (let x = qx0 - 1; x <= qx1 + 1; x++) {
      const borda = x === qx0 - 1 || x === qx1 + 1 || z === qz0 - 1 || z === qz1 + 1;
      if (borda) { c.set(x, 51, z, B.CONCRETE); if (((x + z) & 3) === 0) { c.set(x, 52, z, B.STEEL); c.set(x, 53, z, B.STEEL); c.set(x, 54, z, B.STEEL); } else c.set(x, 52, z, B.GLASS); continue; }
      const linha = x === qx0 || x === qx1 || z === qz0 || z === qz1 || x === qcx || ((x - qcx) * (x - qcx) + (z - qcz) * (z - qcz) >= 6 && (x - qcx) * (x - qcx) + (z - qcz) * (z - qcz) <= 10);
      c.set(x, 51, z, linha ? B.PLASTER_WHITE : B.PLASTER_BLUE);
    }
    for (const [gx, s] of [[qx0, 1], [qx1, -1]]) {
      for (const dz of [-2, 2]) { c.set(gx, 52, qcz + dz, B.STEEL); c.set(gx, 53, qcz + dz, B.STEEL); }
      for (let dz = -2; dz <= 2; dz++) c.set(gx, 54, qcz + dz, B.STEEL);
      void s;
    }
    vao(c, qcx, qz0 - 1, [0, -1], 3, 3);
    // parquinho: areia, balanço e escorregador
    for (let z = z0 + 36; z <= z1 - 1; z++) for (let x = x0 + 3; x <= x0 + 14; x++) c.set(x, 51, z, B.SAND);
    for (const x of [x0 + 4, x0 + 9]) for (let y = 52; y <= 55; y++) c.set(x, y, z0 + 39, B.STEEL);
    for (let x = x0 + 4; x <= x0 + 9; x++) c.set(x, 56, z0 + 39, B.STEEL);
    for (const x of [x0 + 6, x0 + 7]) c.set(x, 52, z0 + 39, B.PLANKS);
    for (let k = 0; k < 4; k++) c.set(x0 + 12, 52 + k, z0 + 37 + k, B.CONCRETE);
    for (let y = 52; y <= 55; y++) c.set(x0 + 13, y, z0 + 41, B.PLASTER_RED);
    mastro(c, x0 + 2, z0 + 1, 52, 11, BRASIL());
    for (const x of [x0 + 8, x0 + 32, x0 + 38]) arvore(x, z0 + 1, 0.85);
    arvore(x0 + 39, z0 + 38, 1); arvore(x0 + 20, z0 + 39, 0.9);
    carimba(c);
    registra('escola', 'Escola Municipal', c, [cx, 52, z0 + 4], [cx, 52, z0 - 1], { andares: 2, altura: 68 });
  }

  // ================================================================================================================
  // DELEGACIA DE POLÍCIA
  function delegacia(q) {
    const { x0, z0, x1, z1 } = q;
    const c = caixa(x0, 51, z0, x1, 90, z1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) pinta(x, z, ((x - z) & 7) === 0 ? K.PISO_A : K.PISO_D);
    ocupa(x0, z0, x1, z1);
    const bx0 = x0 + 6, bx1 = x0 + 36, bz0 = z0 + 6, bz1 = z0 + 20, cx = x0 + 21;
    bloco(c, bx0, bz0, bx1, bz1, [51, 57, 61, 65], { parede: B.PLASTER_WHITE, pilar: B.PLASTER_WHITE, quina: B.PLASTER_BLUE, laje: B.PLASTER_BLUE, parapeito: B.PLASTER_BLUE, vidro: B.GLASS_SMOKE, vidroTerreo: B.GLASS_SMOKE, piso: B.STONE_BRICKS, cobertura: B.CONCRETE, passo: 3 });
    vao(c, cx, bz0, [0, -1], 3, 4);
    vao(c, cx, bz1, [0, 1], 3, 4);
    for (let k = 1; k <= 2; k++) for (let x = cx - 2; x <= cx + 2; x++) c.set(x, 51, bz0 - k, B.STONE_BRICKS);
    // letreiro no parapeito e sirenes nas quinas do teto
    const t = 'POLICIA', wt = larguraTexto(t);
    for (let x = cx - (wt >> 1) - 1; x <= cx + (wt >> 1) + 1; x++) for (let y = 66; y <= 72; y++) c.set(x, y, bz0, B.PLASTER_BLUE);
    escreve(c, t, cx + (wt >> 1), 71, bz0, [0, -1], B.PLASTER_WHITE, null);
    c.set(cx + (wt >> 1) - 13, 72, bz0, B.PLASTER_WHITE);            // acento do I (POLÍCIA)
    c.set(bx0, 67, bz0, B.GLASS_RED); c.set(bx1, 67, bz0, B.GLASS_BLUE); c.set(bx0, 67, bz1, B.GLASS_BLUE); c.set(bx1, 67, bz1, B.GLASS_RED);
    // antena de rádio
    for (let y = 66; y <= 88; y++) c.set(bx1 - 3, y, bz1 - 3, B.STEEL);
    for (let y = 66; y <= 80; y += 7) { c.set(bx1 - 4, y, bz1 - 3, B.STEEL); c.set(bx1 - 2, y, bz1 - 3, B.STEEL); }
    c.set(bx1 - 3, 89, bz1 - 3, B.GLASS_RED);
    // balcão de atendimento e celas no térreo
    for (let x = cx - 4; x <= cx + 4; x++) c.set(x, 52, bz0 + 4, B.PLASTER_BLUE);
    for (let k = 0; k < 3; k++) {
      const xa = bx0 + 2 + k * 4;
      for (let y = 52; y <= 56; y++) for (let z = bz1 - 5; z < bz1; z++) { c.set(xa, y, z, B.STONE_BRICKS); c.set(xa + 4, y, z, B.STONE_BRICKS); }
      for (let x = xa + 1; x <= xa + 3; x++) { for (let y = 52; y <= 55; y++) c.set(x, y, bz1 - 5, ((x - xa) & 1) ? B.STEEL : 0); c.set(x, 56, bz1 - 5, B.STEEL); }
    }
    // pátio das viaturas: asfalto, vagas e cobertura de aço; muro com portão para a rua de trás
    for (let z = bz1 + 2; z <= z1 - 1; z++) for (let x = x0 + 2; x <= x1 - 2; x++) pinta(x, z, ((x - x0) % 4 === 0 && z <= bz1 + 8) ? K.BRANCA : K.ASF);
    for (let z = bz1 + 2; z <= bz1 + 8; z++) for (let x = x0 + 2; x <= x1 - 2; x++) c.set(x, 57, z, (z === bz1 + 8 || x === x0 + 2 || x === x1 - 2) ? B.PLASTER_BLUE : B.STEEL);
    for (let x = x0 + 2; x <= x1 - 2; x += 8) for (let y = 52; y <= 56; y++) c.set(x, y, bz1 + 8, B.STEEL);
    for (let x = x0; x <= x1; x++) for (let y = 52; y <= 53; y++) if (Math.abs(x - cx) > 4) c.set(x, y, z1, B.STONE_BRICKS);
    for (let z = bz1 + 1; z <= z1; z++) for (let y = 52; y <= 53; y++) { c.set(x0, y, z, B.STONE_BRICKS); c.set(x1, y, z, B.STONE_BRICKS); }
    for (let z = z1 - 1; z <= z1; z++) for (let x = cx - 4; x <= cx + 4; x++) pinta(x, z, K.ASF);
    mastro(c, x0 + 3, z0 + 2, 52, 10, BRASIL());
    for (const x of [x0 + 10, x0 + 32]) arvore(x, z0 + 2, 0.85);
    const vagas = [];
    for (let x = x0 + 4; x <= x1 - 4; x += 4) vagas.push([x, bz1 + 5, 2]);
    carimba(c);
    registra('delegacia', 'Delegacia de Polícia', c, [cx, 52, bz0], [cx, 52, z0 - 1], { andares: 3, altura: 90, vagas });
  }

  // ================================================================================================================
  // QUARTEL DOS BOMBEIROS
  function bombeiros(q) {
    const { x0, z0, x1, z1 } = q;
    const c = caixa(x0, 51, z0, x1, 84, z1);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) pinta(x, z, K.PISO_D);
    ocupa(x0, z0, x1, z1);
    const bx0 = x0 + 2, bx1 = x0 + 40, bz0 = z0 + 8, bz1 = z0 + 24;
    bloco(c, bx0, bz0, bx1, bz1, [51, 58, 63], { parede: B.PLASTER_RED, pilar: B.PLASTER_RED, quina: B.PLASTER_WHITE, laje: B.PLASTER_WHITE, parapeito: B.PLASTER_WHITE, vidro: B.GLASS, vidroTerreo: B.PLASTER_RED, piso: B.CONCRETE, cobertura: B.CONCRETE, passo: 4, vitrine: 5 });
    // três portões de garagem (abertos) na frente e atrás, com moldura branca; porta de pedestre
    const portoes = [x0 + 9, x0 + 18, x0 + 27];
    for (const px of portoes) {
      for (const [zf, n] of [[bz0, [0, -1]], [bz1, [0, 1]]]) {
        vao(c, px, zf, n, 7, 5);
        for (let k = -4; k <= 4; k++) c.set(px + k, 57, zf, B.PLASTER_WHITE);
        for (let y = 52; y <= 56; y++) { c.set(px - 4, y, zf, B.PLASTER_WHITE); c.set(px + 4, y, zf, B.PLASTER_WHITE); }
      }
      for (let z = z0; z < bz0; z++) for (let k = -3; k <= 3; k++) pinta(px + k, z, (z & 1) && Math.abs(k) === 3 ? K.AMARELA : K.ASF);
    }
    vao(c, x0 + 35, bz0, [0, -1], 2, 3);
    // letreiro: faixa branca no parapeito, letras vermelhas
    const t = 'BOMBEIROS', wt = larguraTexto(t), cx = x0 + 21;
    for (let x = cx - (wt >> 1) - 1; x <= cx + (wt >> 1) + 1; x++) for (let y = 64; y <= 70; y++) c.set(x, y, bz0, B.PLASTER_WHITE);
    escreve(c, t, cx + (wt >> 1), 69, bz0, [0, -1], B.PLASTER_RED, null);
    // sirene e luzes no teto
    for (const x of [bx0 + 1, bx1 - 1]) c.set(x, 64, bz0 + 1, B.GLASS_RED);
    // torre de treino nos fundos: janelas em todos os andares, escada de aço por fora
    const tx0 = x0 + 31, tz0 = z0 + 29, tx1 = tx0 + 6, tz1 = tz0 + 6;
    for (let y = 52; y <= 80; y++) c.casca(tx0, y, tz0, tx1, y, tz1, (x, yy, z) => {
      const quina = (x === tx0 || x === tx1) && (z === tz0 || z === tz1);
      if (quina || yy % 5 === 1) return B.PLASTER_WHITE;
      const a = (z === tz0 || z === tz1) ? x - tx0 : z - tz0;
      return (a === 3 && yy % 5 >= 2 && yy % 5 <= 4) ? 0 : B.PLASTER_RED;
    });
    for (let z = tz0 + 1; z < tz1; z++) for (let x = tx0 + 1; x < tx1; x++) { c.set(x, 81, z, B.CONCRETE); for (let y = 56; y <= 76; y += 5) c.set(x, y, z, B.PLANKS); }
    for (let y = 52; y <= 81; y++) { c.set(tx0 - 1, y, tz0 + 1, B.STEEL); c.set(tx0 - 1, y, tz0 + 5, B.STEEL); if (y % 2 === 0) for (let z = tz0 + 2; z <= tz0 + 4; z++) c.set(tx0 - 1, y, z, B.STEEL); }
    for (let x = tx0; x <= tx1; x++) { c.set(x, 82, tz0, B.STEEL); c.set(x, 82, tz1, B.STEEL); }
    // pátio de manobras, hidrante e mangueiras secando
    for (let z = bz1 + 1; z <= z1 - 1; z++) for (let x = x0 + 1; x <= x0 + 29; x++) pinta(x, z, (x - x0) % 9 === 0 ? K.AMARELA : K.ASF);
    c.set(x0 + 3, 52, z0 + 3, B.PLASTER_RED); c.set(x0 + 3, 53, z0 + 3, B.PLASTER_RED);
    for (let x = x0 + 4; x <= x0 + 26; x++) c.set(x, 55, z1 - 2, (x & 1) ? B.PLASTER_RED : B.STEEL);
    for (const x of [x0 + 4, x0 + 26]) for (let y = 52; y <= 54; y++) c.set(x, y, z1 - 2, B.STEEL);
    mastro(c, x0 + 38, z0 + 2, 52, 10, BRASIL());
    const vagas = portoes.map((px) => [px, bz0 + 7, 0]);
    carimba(c);
    registra('bombeiros', 'Quartel dos Bombeiros', c, [x0 + 35, 52, bz0], [x0 + 35, 52, z0 - 1], { andares: 2, altura: 83, vagas });
  }

  const PLANO = new Map([['54,54', hospital], ['54,166', escola], ['-152,110', delegacia], ['110,110', bombeiros]]);
  function quarteirao(q) {
    const f = PLANO.get(q.u0 + ',' + q.v0);
    if (!f || q.av >= 0) return false;
    f(q);
    return true;
  }

  // ================================================================================================================
  // AEROPORTO (aterro na costa sul)
  const A = { u0: -175, u1: 215, v0: 384, v1: 477 };
  const AV = { u: 47, v0: 331, v1: 383 };          // avenida de acesso (eixo em u = 47)
  function depois() {
    const ax0 = W(A.u0), ax1 = W(A.u1), az0 = Zw(A.v0), az1 = Zw(A.v1);
    fora.push([ax0, az0, ax1, az1], [W(AV.u - 7), Zw(AV.v0 + 6), W(AV.u + 7), Zw(AV.v1)]);
    // zonas (v local): 384–391 meio-fio e pista de desembarque · 392–410 terminal/hangares · 411–428 pátio ·
    // 429–435 pista de táxi · 436–441 grama · 442–465 pista · 466–474 grama · 475–477 muro do aterro
    const RW0 = 442, RW1 = 465, RU0 = -160, RU1 = 200;
    function chaoAero(u, v) {
      if (v >= 475 || u <= A.u0 + 2 || u >= A.u1 - 2) return B.STONE_BRICKS;
      if (v >= RW0 && v <= RW1 && u >= RU0 && u <= RU1) {
        const lamp = (v === RW0 || v === RW1) && ((u - RU0) % 10 === 0);
        if (lamp) return B.LAMP;
        if (u <= RU0 + 1 || u >= RU1 - 1) return (v - RW0) % 3 === 0 ? B.GLASS_RED : ASF;   // luzes de cabeceira
        if (v === RW0 + 1 || v === RW1 - 1) return B.PLASTER_WHITE;                         // bordas
        const pu = Math.min(u - RU0, RU1 - u);
        if (pu >= 4 && pu <= 13 && v >= RW0 + 3 && v <= RW1 - 3 && ((v - RW0) % 3) !== 0) return B.PLASTER_WHITE;  // "piano"
        if (pu >= 30 && pu <= 41 && (v === RW0 + 6 || v === RW0 + 7 || v === RW1 - 6 || v === RW1 - 7)) return B.PLASTER_WHITE; // zona de toque
        const mv = (RW0 + RW1) >> 1;
        if ((v === mv || v === mv + 1) && pu > 18 && (((u - RU0) % 20) < 10)) return B.PLASTER_WHITE;          // eixo tracejado
        return ASF;
      }
      // pista de táxi e as duas saídas para a pista
      const saida = (u >= RU0 + 8 && u <= RU0 + 14) || (u >= RU1 - 14 && u <= RU1 - 8);
      if ((v >= 429 && v <= 435 && u >= RU0 + 8 && u <= RU1 - 8) || (saida && v >= 429 && v < RW0)) {
        const eixoT = (v === 432 && u >= RU0 + 11 && u <= RU1 - 11) || (saida && (u === RU0 + 11 || u === RU1 - 11) && v >= 432);
        if (eixoT) return B.PLASTER_YELLOW;
        if ((v === 429 || v === 435) && !saida) return ((u & 3) === 0) ? B.LAMP : ASF;
        return ASF;
      }
      if (v >= 411 && v <= 428 && u >= -80 && u <= 175) {
        const guia = (u === 20 || u === 45 || u === 70) && v >= 419;                                     // linhas de entrada nas posições
        const parada = (v === 418) && (Math.abs(u - 20) <= 3 || Math.abs(u - 45) <= 3 || Math.abs(u - 70) <= 3);
        if (guia || parada) return B.PLASTER_YELLOW;
        if ((v === 411 || v === 428) && ((u & 7) === 0)) return B.LAMP;
        return B.CONCRETE;
      }
      if (v >= 384 && v <= 391) {
        if (v === 384) return Math.abs(u - AV.u) <= 3 ? ASF : B.STONE_BRICKS;                     // meio-fio (aberto na avenida)
        if (u >= -25 && u <= 98) return v === 388 && (u & 7) < 4 ? B.PLASTER_WHITE : ASF;          // desembarque
        return B.GRASS;
      }
      if (v >= 392 && v <= 410) {
        if (u >= -25 && u <= -3) return ((u + 25) % 3 === 0 && v !== 401) ? B.PLASTER_WHITE : ASF; // estacionamento
        return B.CONCRETE;
      }
      return B.GRASS;
    }
    // o aterro: do fundo do mar (ou da areia) até y 51, por coluna; nada de árvore nem capim em cima
    poe({ x0: ax0, z0: az0, x1: ax1, z1: az1, pri: 0, col(S, x, z, alt) {
      const u = x - CX, v = z - CZ;
      const y0 = Math.max(4, Math.min(50, (alt ? alt(x, z) : 30) - 3));
      for (let y = y0; y <= 50; y++) S(x, y, z, (u <= A.u0 + 2 || u >= A.u1 - 2 || v >= 475) ? B.STONE_BRICKS : (y >= 49 ? B.DIRT : B.STONE));
      S(x, 51, z, chaoAero(u, v));
      for (let y = 52; y <= 60; y++) S(x, y, z, 0);
      if (v === 477 || u === A.u0 || u === A.u1) S(x, 52, z, B.STONE_BRICKS);      // mureta do aterro
    } });
    // avenida de acesso: 7 de pista, meio-fio e calçada, postes; aterro por baixo onde for praia ou mar
    poe({ x0: W(AV.u - 7), z0: Zw(AV.v0), x1: W(AV.u + 7), z1: Zw(AV.v1), pri: 0, col(S, x, z, alt) {
      const t = Math.abs(x - W(AV.u)), v = z - CZ;
      const a = alt ? alt(x, z) : 51;
      if (v < AV.v0 + 6 && a >= 51) { if (t <= 6) S(x, 51, z, t <= 3 ? ASF : t === 4 ? B.STONE_BRICKS : B.CONCRETE); return; }
      if (t === 7) { if (a < 51) for (let y = Math.max(4, a - 3); y <= 52; y++) S(x, y, z, B.STONE_BRICKS); return; }
      for (let y = Math.max(4, Math.min(50, a - 3)); y <= 50; y++) S(x, y, z, B.STONE);
      S(x, 51, z, t <= 3 ? (t === 0 && (v & 7) < 4 ? B.PLASTER_YELLOW : ASF) : t === 4 ? B.STONE_BRICKS : B.CONCRETE);
      for (let y = 52; y <= 60; y++) S(x, y, z, 0);
      if (t === 6 && (v % 14) === 0) { for (let y = 52; y <= 56; y++) S(x, y, z, B.PLASTER_DARK); S(x, 57, z, B.PLASTER_DARK); }
      if (t === 5 && (v % 14) === 0) S(x, 56, z, B.LAMP);
    } });

    // ---- terminal de passageiros ----------------------------------------------------------------------------
    {
      const tx0 = W(0), tx1 = W(90), tz0 = Zw(392), tz1 = Zw(410);
      const c = caixa(tx0, 51, Zw(385), tx1, 72, Zw(420));
      for (let y = 52; y <= 64; y++) c.casca(tx0, y, tz0, tx1, y, tz1, (x, yy, z) => {
        const ponta = x === tx0 || x === tx1;
        if (yy === 58 || yy === 64) return B.STEEL;
        if (ponta) return (z - tz0) % 6 === 0 ? B.STEEL : B.PLASTER_WHITE;
        if ((x - tx0) % 5 === 0) return B.STEEL;
        return B.GLASS_BLUE;
      });
      for (let z = tz0 + 1; z < tz1; z++) for (let x = tx0 + 1; x < tx1; x++) {
        c.set(x, 51, z, B.MARBLE);
        c.set(x, 58, z, ((x - tx0) % 6 === 3 && (z - tz0) % 6 === 3) ? B.LAMP : B.CONCRETE);
        c.set(x, 64, z, ((x - tx0) % 8 === 4 && (z - tz0) % 6 === 3) ? B.GLASS : B.STEEL);
      }
      for (let x = tx0; x <= tx1; x++) { c.set(x, 65, tz0, B.STEEL); c.set(x, 65, tz1, B.STEEL); }
      // vãos de entrada (lado da cidade) e de embarque (lado da pista)
      for (const u of [15, 45, 75]) vao(c, W(u), tz0, [0, -1], 3, 4);
      for (const u of [20, 45, 70]) vao(c, W(u), tz1, [0, 1], 3, 4);
      // marquise contínua sobre o desembarque
      for (let z = Zw(386); z < tz0; z++) for (let x = tx0; x <= tx1; x++) c.set(x, 59, z, (z === Zw(386)) ? B.STEEL : B.GLASS_SMOKE);
      for (let x = tx0; x <= tx1; x += 10) for (let y = 52; y <= 58; y++) c.set(x, y, Zw(386), B.STEEL);
      // balcões de check-in, esteira e cadeiras do embarque
      for (let k = 0; k < 6; k++) for (let x = W(8 + k * 13); x <= W(12 + k * 13); x++) c.set(x, 52, tz0 + 6, B.PLASTER_BLUE);
      for (let x = W(4); x <= W(86); x++) c.set(x, 52, tz0 + 9, (x & 1) ? B.STEEL : B.PLASTER_DARK);
      for (let x = W(4); x <= W(86); x += 2) for (const z of [tz1 - 4, tz1 - 3]) c.set(x, 52, z, B.STAIR_CONCRETE);
      // letreiro luminoso no lado da cidade
      const t = 'AEROPORTO', wt = larguraTexto(t), cx = W(45);
      for (let x = cx - (wt >> 1) - 2; x <= cx + (wt >> 1) + 2; x++) for (let y = 65; y <= 71; y++) c.set(x, y, tz0, B.PLASTER_DARK);
      escreve(c, t, cx + (wt >> 1), 70, tz0, [0, -1], B.LAMP, null);
      // três pontes de embarque (túneis de vidro sobre pilares)
      for (const u of [20, 45, 70]) {
        const px = W(u);
        for (let z = tz1 + 1; z <= Zw(417); z++) for (let dx = -2; dx <= 2; dx++) for (let y = 55; y <= 59; y++) {
          const parede = Math.abs(dx) === 2, piso = y === 55, teto = y === 59;
          if (piso || teto) c.set(px + dx, y, z, B.STEEL); else if (parede) c.set(px + dx, y, z, B.GLASS_SMOKE); else c.set(px + dx, y, z, 0);
        }
        for (let dx = -1; dx <= 1; dx++) for (let y = 56; y <= 58; y++) c.set(px + dx, y, tz1, 0);
        for (const dx of [-2, 2]) for (let y = 52; y <= 54; y++) c.set(px + dx, y, Zw(416), B.STEEL);
        for (let dx = -2; dx <= 2; dx++) for (let y = 55; y <= 59; y++) c.set(px + dx, y, Zw(417), y === 55 || y === 59 || Math.abs(dx) === 2 ? B.STEEL : B.GLASS_SMOKE);
      }
      // escada interna até o mezanino das pontes (degraus de concreto)
      for (let k = 0; k < 4; k++) for (let x = W(40); x <= W(42); x++) c.set(x, 52 + k, tz1 - 6 + k, B.CONCRETE);
      for (let x = tx0 + 1; x < tx1; x++) for (let z = tz1 - 2; z < tz1; z++) c.set(x, 55, z, B.CONCRETE);
      carimba(c);
      const vagas = [];
      for (let u = -24; u <= -6; u += 3) for (const v of [394, 408]) vagas.push([W(u), Zw(v), v < 400 ? 2 : 0]);
      for (const u of [10, 30, 60, 80]) vagas.push([W(u), Zw(389), 1]);
      registra('aeroporto', 'Aeroporto da Metrópole', c, [W(45), 52, tz0], [W(45), 52, Zw(387)], { andares: 2, altura: 72, vagas });
      servicos[servicos.length - 1].posicoes = [20, 45, 70].map((u) => [W(u), Zw(423), 2]);
      servicos[servicos.length - 1].pista = { x0: W(RU0), x1: W(RU1), z: Zw((RW0 + RW1) >> 1), y: 52 };
    }
    // ---- torre de controle ---------------------------------------------------------------------------------
    {
      const cx = W(103), cz = Zw(399);
      const c = caixa(cx - 5, 51, cz - 5, cx + 5, 98, cz + 5);
      for (let y = 52; y <= 54; y++) c.casca(cx - 3, y, cz - 3, cx + 3, y, cz + 3, B.CONCRETE);
      c.box(cx - 3, 55, cz - 3, cx + 3, 55, cz + 3, B.CONCRETE);
      vao(c, cx, cz - 3, [0, -1], 1, 2);
      for (let y = 55; y <= 84; y++) c.casca(cx - 2, y, cz - 2, cx + 2, y, cz + 2, (x, yy, z) => ((x === cx || z === cz) && yy % 6 === 0 ? B.GLASS_SMOKE : B.CONCRETE));
      c.box(cx - 4, 85, cz - 4, cx + 4, 85, cz + 4, B.CONCRETE);
      for (let y = 86; y <= 88; y++) c.casca(cx - 4, y, cz - 4, cx + 4, y, cz + 4, (x, yy, z) => ((x === cx - 4 || x === cx + 4) && (z === cz - 4 || z === cz + 4) ? B.STEEL : B.GLASS_SMOKE));
      c.box(cx - 5, 89, cz - 5, cx + 5, 89, cz + 5, B.STEEL);
      for (let x = cx - 2; x <= cx + 2; x++) c.set(x, 86, cz + 2, B.PLASTER_DARK);
      c.set(cx, 85, cz, B.LAMP);
      for (let y = 90; y <= 96; y++) c.set(cx, y, cz, B.STEEL);
      c.set(cx, 97, cz, B.GLASS_RED); c.set(cx + 1, 90, cz, B.STEEL); c.set(cx + 2, 90, cz, B.STEEL); c.set(cx + 2, 91, cz, B.LAMP);
      carimba(c);
      registra('torre-controle', 'Torre de Controle', c, [cx, 52, cz - 3], [cx, 52, cz - 6], { altura: 98 });
    }
    // ---- hangares (teto em arco) ----------------------------------------------------------------------------
    for (const [u0, nome] of [[-75, 'Hangar Oeste'], [128, 'Hangar Leste']]) {
      const hx0 = W(u0), hx1 = W(u0 + 42), hz0 = Zw(390), hz1 = Zw(410), hcx = (hx0 + hx1) >> 1;
      const c = caixa(hx0, 51, hz0, hx1, 70, hz1);
      const topoEm = (x) => { const d = x - hcx; return 52 + 15 - Math.floor((d * d) / 30); };       // de 67 no meio a ~53 nas pontas
      for (let x = hx0; x <= hx1; x++) {
        const ty = topoEm(x);
        for (let z = hz0; z <= hz1; z++) {
          c.set(x, 51, z, B.CONCRETE);
          const lado = x === hx0 || x === hx1, fundo = z === hz0, frente = z === hz1;
          for (let y = 52; y <= ty; y++) {
            if (y === ty) { c.set(x, y, z, (x - hx0) % 6 === 0 ? B.PLASTER_WHITE : B.STEEL); continue; }
            if (lado || fundo) c.set(x, y, z, y <= 53 ? B.CONCRETE : ((x - hx0) % 6 === 0 || (z - hz0) % 6 === 0 ? B.PLASTER_WHITE : B.STEEL));
            else if (frente) c.set(x, y, z, (y > 62 || lado) ? B.STEEL : 0);
          }
          if (z % 5 === 0 && (x - hx0) % 7 === 3 && !lado) c.set(x, ty - 1, z, B.LAMP);
        }
      }
      for (let y = 52; y <= 62; y++) { c.set(hx0, y, hz1, B.PLASTER_WHITE); c.set(hx1, y, hz1, B.PLASTER_WHITE); }
      vao(c, hcx, hz0, [0, -1], 2, 3);
      carimba(c);
      registra('hangar', nome, c, [hcx, 52, hz0], [hcx, 52, Zw(389)], { altura: 68 });
    }
    // ---- biruta ---------------------------------------------------------------------------------------------
    {
      const bx = W(208), bz = Zw(438);
      const c = caixa(bx - 1, 51, bz - 1, bx + 6, 60, bz + 1);
      for (let y = 52; y <= 58; y++) c.set(bx, y, bz, B.STEEL);
      for (let k = 1; k <= 5; k++) c.set(bx + k, 58, bz, (k & 1) ? B.PLASTER_RED : B.PLASTER_WHITE);
      c.set(bx, 59, bz, B.GLASS_RED);
      carimba(c);
    }
  }

  const ocupado = (x, z) => { for (const r of fora) if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return true; return false; };
  return { quarteirao, depois, ocupado, servicos };
}
