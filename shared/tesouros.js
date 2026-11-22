// Kraft — tesouros, baús e armas lendárias (pedido do Kadmus, 19/11/2026: "quero mais mistérios enterrados, baús,
// pictogramas em ruínas, armas lendárias e minérios e pedras preciosas raros e caros").
// Puro: o servidor (server/baus.js, server/armas.js), o aparelho (game/baus.js, game/items.js) e os testes usam este
// módulo. Nada aqui sorteia com Math.random: o saque sai da semente (mesma semente, mesmo baú, em qualquer lugar).
//
// Item de tesouro = { b: TESOURO_BASE + n, s: 0 }, n = posição no CATALOGO. Fica acima de todo id de bloco (< 256) e
// de todo estado de bloco do Minecraft (MC_BASE 256 + ~11.900), para nunca se confundir com eles na mochila nem na
// barra. Valor em moedas de cobre (1 prata = 10 cobres, 1 ouro = 100 cobres): é o dado para a troca futura com os
// comerciantes dos povoados.
//
// Armas lendárias: cada uma existe UMA vez por mundo (o servidor anota onde ela nasceu; a vaga não volta). Saem quase só
// de baús de ruína, de baús muito fundos e dos baús "lendários" (lugar desenhado, um tesouro garantido).
//
// Pedras preciosas: aqui estão as LAPIDADAS (item de valor). A frente da profundidade pode criar blocos de pedra bruta;
// `ligarPedraBruta(idDoBloco, chaveDaGema)` diz qual gema cada bloco vira (o dado é trocável sem mexer no resto).
//
// Contrato para quem desenha (Astra): `aparencia` é só o bloco cujo desenho serve de ícone e de cubinho no chão até
// existir arte própria; `tipo` (moeda, gema, reliquia, arma) e `raridade` dizem a moldura/brilho; `arma.efeito` diz o
// efeito a desenhar no golpe (mensagem `{ t: 'lenda', e, p, id }` do servidor).
import { B } from './blocks.js';

export const TESOURO_BASE = 30000;
export const RARIDADES = ['comum', 'incomum', 'raro', 'epico', 'lendario'];
export const NOME_RARIDADE = { comum: 'comum', incomum: 'incomum', raro: 'raro', epico: 'épico', lendario: 'lendário' };

const T = (chave, nome, tipo, raridade, valor, aparencia, extra = {}) => Object.freeze({ chave, nome, tipo, raridade, valor, aparencia, ...extra });

export const CATALOGO = Object.freeze([
  // ---- moedas ----
  T('cobre', 'Moeda de cobre', 'moeda', 'comum', 1, B.COPPER_ORE),
  T('prata', 'Moeda de prata', 'moeda', 'incomum', 10, B.IRON_ORE),
  T('ouro', 'Moeda de ouro', 'moeda', 'raro', 100, B.GOLD_ORE),
  // ---- pedras preciosas lapidadas ----
  T('ametista', 'Ametista lapidada', 'gema', 'incomum', 60, B.CRYSTAL_ORE),
  T('safira', 'Safira lapidada', 'gema', 'raro', 160, B.GLASS_BLUE),
  T('esmeralda', 'Esmeralda lapidada', 'gema', 'raro', 220, B.GLASS_GOLD),
  T('rubi', 'Rubi lapidado', 'gema', 'epico', 320, B.GLASS_RED),
  T('diamante', 'Diamante lapidado', 'gema', 'epico', 480, B.GLASS),
  T('opala', 'Opala negra', 'gema', 'lendario', 1300, B.GLASS_SMOKE),
  // ---- relíquias ----
  T('mapa', 'Mapa de couro rasgado', 'reliquia', 'comum', 25, B.PLANKS,
    { historia: 'Metade de um mapa. A outra metade, dizem, está com quem cavou mais fundo.' }),
  T('calice', 'Cálice de bronze', 'reliquia', 'incomum', 90, B.COPPER_ORE,
    { historia: 'Usado nos brindes das primeiras aldeias, antes das cidades.' }),
  T('placa', 'Placa de pedra com pictogramas', 'reliquia', 'raro', 170, B.STONE_BRICKS,
    { historia: 'Desenhos de gente, de rios debaixo da terra e de uma porta atrás da água.' }),
  T('coroa', 'Coroa de prata dos reis afogados', 'reliquia', 'epico', 700, B.GLASS_SILVER,
    { historia: 'Do reino que o mar levou. Ainda cheira a sal.' }),
  T('idolo', 'Ídolo de jade', 'reliquia', 'epico', 850, B.GLASS_GOLD,
    { historia: 'Pequeno, frio e pesado demais para o tamanho.' }),
  T('mascara', 'Máscara de ouro dos primeiros', 'reliquia', 'lendario', 2200, B.GOLD_BLOCK,
    { historia: 'O rosto de quem fez as primeiras ruínas. Ninguém sabe o nome.' }),
  // ---- armas lendárias (uma de cada por mundo) ----
  T('aurora', 'Lâmina da Aurora', 'arma', 'lendario', 6000, B.GOLD_BLOCK, {
    historia: 'Forjada na primeira manhã do mundo. Quem a encara vê o sol nascer e esquece de lutar.',
    arma: { dano: 12, alcance: 6.5, recarga: 300, efeito: 'clarao', segundos: 3 } }),
  T('trovao', 'Martelo do Trovão Surdo', 'arma', 'lendario', 7000, B.STEEL, {
    historia: 'Caiu de uma tempestade que ninguém ouviu. Cada pancada ecoa nos que estão em volta.',
    arma: { dano: 14, alcance: 6, recarga: 650, efeito: 'trovao', raio: 3.5, fracao: 0.6 } }),
  T('sombra', 'Adaga da Sombra Funda', 'arma', 'lendario', 5500, B.BASALT, {
    historia: 'Achada no fundo mais escuro. Corta rápido, e o corte não fecha.',
    arma: { dano: 7, alcance: 5.5, recarga: 150, efeito: 'sangria', porSegundo: 2, segundos: 4 } }),
  T('mares', 'Lança das Marés Antigas', 'arma', 'lendario', 6500, B.GLASS_BLUE, {
    historia: 'Dos guardiões do reino afogado. Alcança longe e empurra como a onda.',
    arma: { dano: 10, alcance: 9, recarga: 450, efeito: 'mare', empurrao: 5 } }),
  T('raiz', 'Machado da Raiz Primeira', 'arma', 'lendario', 6200, B.LOG, {
    historia: 'Feito da primeira árvore. Quem ele fere fica preso ao chão como raiz.',
    arma: { dano: 11, alcance: 6, recarga: 420, efeito: 'enraizar', segundos: 4 } }),
]);

const POR_CHAVE = new Map(CATALOGO.map((t, n) => [t.chave, n]));
export const ARMAS = Object.freeze(CATALOGO.filter((t) => t.tipo === 'arma').map((t) => t.chave));
export const GEMAS = Object.freeze(CATALOGO.filter((t) => t.tipo === 'gema').map((t) => t.chave));

export const isTesouro = (b) => Number.isInteger(b) && b >= TESOURO_BASE && b < TESOURO_BASE + CATALOGO.length;
export const tesouroDe = (b) => (isTesouro(b) ? CATALOGO[b - TESOURO_BASE] : null);
export const idDe = (chave) => (POR_CHAVE.has(chave) ? TESOURO_BASE + POR_CHAVE.get(chave) : 0);
export const nomeDe = (b) => tesouroDe(b)?.nome || null;
export const valorDe = (b) => tesouroDe(b)?.valor || 0;
export const armaDe = (b) => tesouroDe(b)?.arma || null;
export const aparenciaDe = (b) => (isTesouro(b) ? tesouroDe(b).aparencia : b);   // bloco para ícone/cubinho provisório
export function valorDaLista(l) { let v = 0; for (const e of l || []) if (e) v += valorDe(e[0]) * e[2]; return v; }
export function textoDoValor(v) {
  const o = Math.floor(v / 100), p = Math.floor((v % 100) / 10), c = v % 10, out = [];
  if (o) out.push(`${o} ouro`); if (p) out.push(`${p} prata`); if (c || !out.length) out.push(`${c} cobre`);
  return out.join(', ');
}

// pedra bruta (bloco da frente da profundidade) → gema lapidada
const BRUTA = new Map();
export function ligarPedraBruta(bloco, chave) { if (GEMAS.includes(chave)) BRUTA.set(bloco, chave); }
export const gemaDaPedra = (bloco) => (BRUTA.has(bloco) ? idDe(BRUTA.get(bloco)) : 0);

// ---- sorteio determinístico ----------------------------------------------------------------------------------------
export function hash32(...ns) {
  let h = 0x811c9dc5;
  for (const n of ns) { h = Math.imul(h ^ (n | 0), 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; }
  return h >>> 0;
}
export function sorteador(semente) {   // mulberry32: só soma, xor, deslocamento e Math.imul (igual em todo aparelho)
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- tabelas de saque ----------------------------------------------------------------------------------------------
// [chave, peso, mínimo, máximo]; 'lenda' = uma arma lendária ainda não achada neste mundo (sem vaga: opala + ouro).
export const BAU_SLOTS = 27;
export const NIVEIS = Object.freeze(['raso', 'fundo', 'muito_fundo', 'ruina', 'lendario']);
export const NOME_NIVEL = { raso: 'raso', fundo: 'fundo', muito_fundo: 'muito fundo', ruina: 'de ruína', lendario: 'lendário' };
export const SAQUE = Object.freeze({
  raso: { rolagens: [3, 6], itens: [['cobre', 60, 3, 14], ['prata', 22, 1, 4], ['mapa', 8, 1, 1], ['ametista', 6, 1, 1], ['calice', 3, 1, 1], ['ouro', 1, 1, 1]] },
  fundo: { rolagens: [4, 7], itens: [['prata', 40, 2, 9], ['cobre', 20, 5, 20], ['ouro', 12, 1, 3], ['ametista', 10, 1, 2], ['safira', 7, 1, 1],
    ['esmeralda', 5, 1, 1], ['calice', 5, 1, 1], ['placa', 3, 1, 1]] },
  muito_fundo: { rolagens: [5, 8], itens: [['ouro', 30, 2, 6], ['prata', 25, 4, 12], ['safira', 10, 1, 2], ['esmeralda', 9, 1, 2], ['rubi', 7, 1, 1],
    ['diamante', 5, 1, 1], ['coroa', 2.5, 1, 1], ['idolo', 2, 1, 1], ['opala', 0.8, 1, 1], ['lenda', 0.3, 1, 1]] },
  ruina: { rolagens: [4, 8], itens: [['placa', 22, 1, 2], ['prata', 25, 2, 8], ['ouro', 14, 1, 4], ['calice', 10, 1, 1], ['esmeralda', 7, 1, 1],
    ['rubi', 5, 1, 1], ['idolo', 3, 1, 1], ['coroa', 3, 1, 1], ['mascara', 1, 1, 1], ['lenda', 0.8, 1, 1]] },
  lendario: { rolagens: [5, 8], garantido: ['lenda'], itens: [['ouro', 35, 3, 9], ['diamante', 12, 1, 2], ['rubi', 12, 1, 2], ['opala', 4, 1, 1],
    ['mascara', 4, 1, 1], ['coroa', 8, 1, 1], ['idolo', 8, 1, 1]] },
});
// nível pela fundura (metros abaixo do chão natural do lugar): o que a frente da profundidade e a colocação usam
export function nivelPorProfundidade(fundura) { return fundura < 25 ? 'raso' : fundura < 60 ? 'fundo' : 'muito_fundo'; }

// Sorteia o conteúdo de um baú: { itens: [27 × ([b, 0, n] | 0)], lendas: [chaves das armas que nasceram aqui] }.
// `disponiveis` = armas lendárias que ainda não existem neste mundo (o servidor sabe).
export function sortearSaque(nivel, semente, disponiveis = ARMAS) {
  const tab = SAQUE[nivel] || SAQUE.raso, r = sorteador(hash32(semente, NIVEIS.indexOf(nivel) + 1, 0x7e50));
  const livres = [...disponiveis].filter((k) => ARMAS.includes(k));
  const sai = [], lendas = [];
  const poe = (chave, n) => {
    if (chave === 'lenda') {
      if (!livres.length) { poe('opala', 1); poe('ouro', 2 + Math.floor(r() * 4)); return; }
      const k = livres.splice(Math.floor(r() * livres.length), 1)[0];
      lendas.push(k); sai.push([idDe(k), 0, 1]); return;
    }
    const b = idDe(chave); if (!b) return;
    const ja = sai.find((e) => e[0] === b && e[2] + n <= 64);
    if (ja) ja[2] += n; else sai.push([b, 0, n]);
  };
  for (const g of tab.garantido || []) poe(g, 1);
  const total = tab.itens.reduce((s, it) => s + it[1], 0);
  const rolagens = tab.rolagens[0] + Math.floor(r() * (tab.rolagens[1] - tab.rolagens[0] + 1));
  for (let i = 0; i < rolagens; i++) {
    let x = r() * total, it = tab.itens[tab.itens.length - 1];
    for (const cand of tab.itens) { x -= cand[1]; if (x < 0) { it = cand; break; } }
    poe(it[0], it[2] + Math.floor(r() * (it[3] - it[2] + 1)));
  }
  // espalha pelos espaços do baú, como no Minecraft (posições sorteadas, sem repetir)
  const itens = new Array(BAU_SLOTS).fill(0), vagas = [...Array(BAU_SLOTS).keys()];
  for (const e of sai) { if (!vagas.length) break; itens[vagas.splice(Math.floor(r() * vagas.length), 1)[0]] = e; }
  return { itens, lendas };
}
