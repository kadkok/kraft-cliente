// LAVRA — movimentos dos blocos do Minecraft (pedido do Kadmus em 16/11/2026: "importe todos os motions do minecraft";
// inventário completo em docs/movimentos-minecraft.md). Só LÓGICA: quem solta partícula, onde, quando, com que
// velocidade e por quanto tempo — o "tique de animação" de cada bloco. O desenho é de render/mc-particulas.js (contrato
// no topo dele) e o balanço de folhas e plantas é do shader do terreno, com a classe gravada por tools/mc/movimentos.py.
//
// Como no Minecraft, cada bloco perto de quem joga ganha tiques de animação ao acaso: até 16 blocos, ~0,42 por segundo
// (PERTO); de 16 a 32, ~0,05 (LONGE). O que no Minecraft é tique de entidade de bloco (fumaça da fogueira, chamas do
// gerador, chama das velas, nota do toca-discos) roda "sempre", no próprio ritmo, enquanto estiver no alcance.
// As regras seguem o comportamento dos blocos do 1.21.8; números, cores e formas são do LAVRA.
//
// Uso (main.js): initMovimentosMc({ game, world, camera, quality, particulas, noite: () => U.uNight.value })
// Para testes: criarEmissoresMc({ world, particulas, rand, noite, chuva }) → { varrer(x, y, z), tique(x, y, z) }.
import { MC_BASE, mcEstado } from '../../shared/mc-estados.js';
import { B, SOLID } from '../../shared/blocks.js';
import { CW, ckey } from '../../shared/constants.js';

export const TIPO = {
  fumaca: 0, fumacaGrande: 1, fogueira: 2, chama: 3, brasa: 4, gota: 5, folha: 6, esporo: 7, esporoCaindo: 8,
  portal: 9, portalInverso: 10, faisca: 11, glifo: 12, poeira: 13, vagalume: 14, bolha: 15, nota: 16,
};

export const PERTO = 0.42, LONGE = 0.05;
const TIQUE = 1 / 20;

const COR = {
  fumaca: [0.62, 0.62, 0.62], escura: [0.32, 0.31, 0.3], fogueira: [0.74, 0.73, 0.72], sinal: [0.86, 0.86, 0.85],
  chama: [1, 1, 1], alma: [0.35, 0.92, 1.0], brasa: [1.0, 0.42, 0.08], agua: [0.42, 0.58, 0.86], lava: [1.0, 0.38, 0.05],
  mel: [0.95, 0.62, 0.12], lagrima: [0.58, 0.18, 0.95], roxo: [0.62, 0.26, 0.98], lilas: [0.82, 0.6, 1.0],
  branco: [1.0, 0.98, 0.92], glifo: [0.86, 0.78, 1.0], redstone: [1.0, 0.08, 0.04], vagalume: [0.86, 1.0, 0.42],
  bolha: [0.82, 0.92, 1.0], esporo: [0.55, 0.82, 0.38], esporoRosa: [0.96, 0.6, 0.86], micelio: [0.78, 0.72, 0.84],
};
// folhas que caem: cor da folha e chance por tique de animação (no 1.21.8: 1% nas tingidas, 10% na cerejeira, 2% na
// pálida; aqui o dobro, porque no LAVRA as árvores de blocos MC são poucas e baixas)
const FOLHAS = {
  oak_leaves: [[0.33, 0.52, 0.2], 0.02], spruce_leaves: [[0.36, 0.56, 0.36], 0.02], birch_leaves: [[0.5, 0.65, 0.32], 0.02],
  jungle_leaves: [[0.3, 0.55, 0.16], 0.02], acacia_leaves: [[0.42, 0.55, 0.18], 0.02], dark_oak_leaves: [[0.27, 0.45, 0.16], 0.02],
  mangrove_leaves: [[0.5, 0.66, 0.16], 0.02], azalea_leaves: [[0.38, 0.54, 0.22], 0.02],
  flowering_azalea_leaves: [[0.62, 0.48, 0.66], 0.02], cherry_leaves: [[0.98, 0.72, 0.84], 0.2], pale_oak_leaves: [[0.72, 0.74, 0.68], 0.04],
};
const CORES16 = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan',
  'purple', 'blue', 'brown', 'green', 'red', 'black'];
// onde fica a chama de cada vela, com 1, 2, 3 ou 4 velas no bloco (posições do modelo do 1.21.8)
const VELAS = [[[0.5, 0.5, 0.5]], [[0.375, 0.44, 0.5], [0.625, 0.5, 0.44]],
  [[0.5, 0.313, 0.625], [0.375, 0.44, 0.5], [0.56, 0.5, 0.44]],
  [[0.44, 0.313, 0.56], [0.625, 0.44, 0.56], [0.375, 0.44, 0.375], [0.56, 0.5, 0.375]]];
const DIR = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const OPOSTO = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] };
const ESTANTES = [];
for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2) for (let dy = 0; dy <= 1; dy++) ESTANTES.push([dx, dy, dz]);

// ---- regras: nome do bloco → (props, nome) → lista de programas { por, sempre, alcance, fn(c, e) } ---------------------
//   por: vezes por segundo (tique de animação perto, ou o ritmo próprio quando `sempre`) · alcance em blocos (padrão 32)
export const REGRAS = new Map();
const regra = (nomes, f) => { for (const n of [].concat(nomes)) REGRAS.set(n, f); };
const aceso = (p) => p.lit === 'true';
const fumacaNa = (c, x, y, z, cor = COR.fumaca, tam = 0.16) => c.solta(TIPO.fumaca, x, y, z, (c.r() - 0.5) * 0.06, 0.32 + c.r() * 0.12, (c.r() - 0.5) * 0.06, 0.9 + c.r() * 1.3, tam, cor);

// tochas: a chama acesa é a da malha (mc-malha.js, "chamas"); daqui sai a fumaça na ponta dela
regra(['torch', 'soul_torch'], () => [{ por: PERTO, fn: (c, e) => fumacaNa(c, e.x + 0.5, e.y + 0.95, e.z + 0.5) }]);
regra(['wall_torch', 'soul_wall_torch'], (p) => [{ por: PERTO, fn: (c, e) => { const [ox, oz] = OPOSTO[p.facing] || [0, 0]; fumacaNa(c, e.x + 0.5 + 0.27 * ox, e.y + 1.17, e.z + 0.5 + 0.27 * oz); } }]);
regra('redstone_torch', (p) => aceso(p) ? [{ por: PERTO, fn: (c, e) => c.poeira(e.x + 0.5 + (c.r() - 0.5) * 0.2, e.y + 0.7 + (c.r() - 0.5) * 0.2, e.z + 0.5 + (c.r() - 0.5) * 0.2, 1) }] : null);
regra('redstone_wall_torch', (p) => aceso(p) ? [{ por: PERTO, fn: (c, e) => { const [ox, oz] = OPOSTO[p.facing] || [0, 0]; c.poeira(e.x + 0.5 + 0.27 * ox + (c.r() - 0.5) * 0.2, e.y + 0.92 + (c.r() - 0.5) * 0.2, e.z + 0.5 + 0.27 * oz + (c.r() - 0.5) * 0.2, 1); } }] : null);

// fogueira acesa: coluna de fumaça (alta e longa com fardo de feno embaixo: "fogueira de sinal"); a comum ainda solta brasas
regra(['campfire', 'soul_campfire'], (p, nome) => !aceso(p) ? null : [
  { sempre: true, por: 2.2, alcance: 64, fn: (c, e) => { const n = c.r() < 0.5 ? 2 : 3, sinal = c.nome(e.x, e.y - 1, e.z) === 'hay_block'; for (let i = 0; i < n; i++) c.fogueira(e, sinal); if (c.r() < 0.3) fumacaNa(c, e.x + 0.25 + c.r() * 0.5, e.y + 0.4, e.z + 0.25 + c.r() * 0.5); } },
  ...(nome === 'campfire' ? [{ por: PERTO * 0.2, fn: (c, e) => c.brasa(e.x + 0.5, e.y + 0.5, e.z + 0.5) }] : []),
]);
// fogo: três rolos de fumaça escura por tique, dentro do bloco
regra(['fire', 'soul_fire'], () => [{ por: PERTO, fn: (c, e) => { for (let i = 0; i < 3; i++) c.solta(TIPO.fumacaGrande, e.x + c.r(), e.y + 0.5 + c.r() * 0.5, e.z + c.r(), 0, 0.5 + c.r() * 0.2, 0, 1.6 + c.r() * 1.4, 0.3, COR.escura); } }]);
// fornalhas acesas: fumaça (e chama, na comum) na boca, do lado para onde ela olha
const boca = (alto, chama) => (p) => !aceso(p) ? null : [{ por: PERTO, fn: (c, e) => {
  const d = DIR[p.facing] || DIR.north, lado = c.r() * 0.6 - 0.3;
  const x = e.x + 0.5 + (d[0] ? d[0] * 0.52 : lado), z = e.z + 0.5 + (d[2] ? d[2] * 0.52 : lado), y = e.y + c.r() * alto;
  fumacaNa(c, x, y, z);
  if (chama) c.solta(TIPO.chama, x, y, z, 0, 0, 0, 0.5 + c.r() * 0.6, 0.15, COR.chama);
} }];
regra('furnace', boca(6 / 16, true));
regra('blast_furnace', boca(9 / 16, false));
regra('smoker', (p) => aceso(p) ? [{ por: PERTO, fn: (c, e) => fumacaNa(c, e.x + 0.5, e.y + 1.1, e.z + 0.5) }] : null);
// velas acesas: chama em cada pavio, renovada o tempo todo (no Minecraft ela pisca do mesmo jeito) e um fio de fumaça às vezes
const velas = (pontos) => [
  { sempre: true, por: 1.6, alcance: 32, fn: (c, e) => { for (const [px, py, pz] of pontos) c.solta(TIPO.chama, e.x + px, e.y + py, e.z + pz, 0, 0, 0, 0.8 + c.r() * 0.35, 0.075, COR.chama); } },
  { por: PERTO, fn: (c, e) => { for (const [px, py, pz] of pontos) if (c.r() < 0.3) fumacaNa(c, e.x + px, e.y + py + 0.05, e.z + pz, COR.fumaca, 0.07); } },
];
regra(['candle', ...CORES16.map((k) => k + '_candle')], (p) => aceso(p) ? velas(VELAS[Math.min(4, Math.max(1, +p.candles || 1)) - 1]) : null);
regra(['candle_cake', ...CORES16.map((k) => k + '_candle_cake')], (p) => aceso(p) ? velas([[0.5, 1.0, 0.5]]) : null);

// folhas: caem de baixo da copa (só se o bloco de baixo não for cheio) e pingam na chuva a céu aberto
regra(Object.keys(FOLHAS), (p, nome) => [{ por: PERTO, fn: (c, e) => {
  if (c.solido(e.x, e.y - 1, e.z)) return;
  if (c.chuva() > 0.2 && c.r() < 1 / 15 && c.ceuAberto(e.x, e.y + 1, e.z)) c.gota(e.x + 0.1 + c.r() * 0.8, e.y - 0.02, e.z + 0.1 + c.r() * 0.8, COR.agua);
  const [cor, chance] = FOLHAS[nome];
  if (c.r() >= chance) return;
  const x = e.x + c.r(), z = e.z + c.r(), y = e.y - 0.06, chao = c.chao(e.x, e.y - 1, e.z), desce = 0.55 + c.r() * 0.35;
  const j = 0.88 + c.r() * 0.24;
  c.solta(TIPO.folha, x, y, z, 0, desce, 0, Math.min(25, (y - chao) / desce + 1.5 + c.r()), 0.15 + c.r() * 0.05, [cor[0] * j, cor[1] * j, cor[2] * j], 0, chao);
} }]);
// flor de esporos: nuvem de esporos no ar em volta (até 10 blocos) e um esporo caindo de baixo dela
regra('spore_blossom', () => [{ por: PERTO, fn: (c, e) => {
  const chao = c.chao(e.x, e.y - 1, e.z), y0 = e.y + 0.7;
  c.solta(TIPO.esporoCaindo, e.x + c.r(), y0, e.z + c.r(), 0, 0, 0, Math.min(30, (y0 - chao) / 0.28 + 0.5), 0.05, COR.esporoRosa, 0, chao);
  for (let i = 0; i < 14; i++) {
    const x = e.x + Math.floor(c.r() * 21) - 10, y = e.y - Math.floor(c.r() * 10), z = e.z + Math.floor(c.r() * 21) - 10;
    if (!c.ar(x, y, z)) continue;
    c.solta(TIPO.esporo, x + c.r(), y + c.r(), z + c.r(), (c.r() - 0.5) * 0.04, (c.r() - 0.5) * 0.02, (c.r() - 0.5) * 0.04, 3 + c.r() * 3, 0.045, COR.esporo);
  }
} }]);
// barra do End: faíscas soltas ao longo dela
regra('end_rod', (p) => [{ por: PERTO * 0.2, fn: (c, e) => {
  const d = DIR[p.facing] || DIR.up, g = 0.4 - (c.r() + c.r()) * 0.4;
  c.solta(TIPO.faisca, e.x + 0.55 - c.r() * 0.1 + d[0] * g, e.y + 0.55 - c.r() * 0.1 + d[1] * g, e.z + 0.55 - c.r() * 0.1 + d[2] * g,
    (c.r() - 0.5) * 0.1, (c.r() - 0.5) * 0.1, (c.r() - 0.5) * 0.1, 2 + c.r() * 2, 0.07, COR.branco, 2.2);
} }]);
// portal do Nether e baú do End: pontos roxos puxados para o bloco
regra('nether_portal', (p) => [{ por: PERTO, fn: (c, e) => {
  for (let i = 0; i < 4; i++) {
    let x = e.x + c.r(), z = e.z + c.r(), vx = (c.r() - 0.5) * 0.5, vz = (c.r() - 0.5) * 0.5;
    const y = e.y + c.r(), vy = (c.r() - 0.5) * 0.5, k = c.r() < 0.5 ? 1 : -1;
    if (p.axis === 'z') { x = e.x + 0.5 + 0.25 * k; vx = c.r() * 2 * k; } else { z = e.z + 0.5 + 0.25 * k; vz = c.r() * 2 * k; }
    c.solta(TIPO.portal, x, y, z, vx, vy, vz, 1.2 + c.r(), 0.07, c.tom(COR.roxo, 0.6), 2.0);
  }
} }]);
regra('ender_chest', () => [{ por: PERTO, fn: (c, e) => {
  for (let i = 0; i < 3; i++) {
    const j = c.r() < 0.5 ? 1 : -1, k = c.r() < 0.5 ? 1 : -1;
    c.solta(TIPO.portal, e.x + 0.5 + 0.25 * j, e.y + c.r(), e.z + 0.5 + 0.25 * k, c.r() * j, (c.r() - 0.5) * 0.125, c.r() * k, 1.2 + c.r(), 0.06, c.tom(COR.roxo, 0.6), 2.0);
  }
} }]);
regra('end_gateway', () => [{ por: PERTO, fn: (c, e) => {
  for (let i = 0; i < 2; i++) c.solta(TIPO.portal, e.x + c.r(), e.y + c.r(), e.z + c.r(), (c.r() - 0.5) * 2, (c.r() - 0.5) * 2, (c.r() - 0.5) * 2, 1.2 + c.r(), 0.07, c.tom(COR.roxo, 0.6), 2.0);
} }]);
regra('end_portal', () => [{ por: PERTO, fn: (c, e) => fumacaNa(c, e.x + c.r(), e.y + 0.8, e.z + c.r(), COR.escura) }]);
// mesa de encantamento: glifos que voam de cada estante (a 2 blocos, com ar no meio) até o livro
regra('enchanting_table', () => [{ por: PERTO, alcance: 24, fn: (c, e) => {
  for (const [dx, dy, dz] of ESTANTES) {
    if (c.r() >= 1 / 16) continue;
    if (c.nome(e.x + dx, e.y + dy, e.z + dz) !== 'bookshelf' || !c.ar(e.x + Math.trunc(dx / 2), e.y + dy, e.z + Math.trunc(dz / 2))) continue;
    const sx = e.x + dx + c.r(), sy = e.y + dy + 0.4 + c.r() * 0.6, sz = e.z + dz + c.r();
    c.solta(TIPO.glifo, sx, sy, sz, e.x + 0.5 - sx, e.y + 1.1 - sy, e.z + 0.5 - sz, 1.0 + c.r() * 0.8, 0.07, COR.glifo, 1.8);
  }
} }]);
// âncora de renascimento carregada: pontos roxos subindo do topo
regra('respawn_anchor', (p) => !(+p.charges > 0) ? null : [{ por: PERTO, fn: (c, e) => c.solta(TIPO.portalInverso, e.x + 0.5 + (0.5 - c.r()), e.y + 1, e.z + 0.5 + (0.5 - c.r()), 0, c.r() * 0.8, 0, 1.4 + c.r(), 0.06, c.tom(COR.lilas, 0.7), 2.0) }]);
// obsidiana chorona: lágrima roxa numa face aberta (de lado ou de baixo), que pende e cai
regra('crying_obsidian', () => [{ por: PERTO * 0.2, fn: (c, e) => {
  const faces = [DIR.down, DIR.north, DIR.south, DIR.east, DIR.west], d = faces[Math.floor(c.r() * faces.length)];
  if (c.solido(e.x + d[0], e.y + d[1], e.z + d[2])) return;
  const x = e.x + (d[0] ? 0.5 + 0.55 * d[0] : c.r()), z = e.z + (d[2] ? 0.5 + 0.55 * d[2] : c.r());
  const y = d[1] < 0 ? e.y - 0.05 : e.y + 0.1 + c.r() * 0.8;
  c.gota(x, y, z, COR.lagrima);
} }]);
// estalactite: pinga pela ponta; com água (ou lava) em cima da raiz pinga mais, e pinga aquilo
regra('pointed_dripstone', (p) => p.vertical_direction !== 'down' || p.thickness !== 'tip' ? null : [{ por: PERTO, fn: (c, e) => {
  if (c.r() > 0.12) return;
  let y = e.y + 1, k = 0;
  while (k++ < 11 && c.nome(e.x, y, e.z) === 'pointed_dripstone') y++;
  const acima = c.nome(e.x, y, e.z) === 'dripstone_block' ? c.fluido(e.x, y + 1, e.z) : null;
  if (!acima && c.r() > 0.02 / 0.12) return;
  c.gota(e.x + 0.5, e.y + 0.25, e.z + 0.5, acima === 'lava' ? COR.lava : COR.agua);
} }]);
regra('mycelium', () => [{ por: PERTO * 0.1, fn: (c, e) => c.solta(TIPO.esporo, e.x + c.r(), e.y + 1.1, e.z + c.r(), 0, 0.03, 0, 2 + c.r() * 2, 0.04, COR.micelio) }]);
// redstone: pó vermelho nas tochinhas do repetidor ligado. O fio com força e o minério aceso também soltam pó no
// Minecraft, mas força e "aceso" do minério não mudam o desenho e o LAVRA não os guarda (não há redstone): ficam de fora.
regra('repeater', (p) => p.powered !== 'true' ? null : [{ por: PERTO, fn: (c, e) => {
  const d = DIR[p.facing] || DIR.north, g = (c.r() < 0.5 ? -5 : (+p.delay || 1) * 2 - 1) / 16;
  c.poeira(e.x + 0.5 + (c.r() - 0.5) * 0.2 + g * d[0], e.y + 0.4 + (c.r() - 0.5) * 0.2, e.z + 0.5 + (c.r() - 0.5) * 0.2 + g * d[2], 1);
} }]);
regra('wither_rose', () => [{ por: PERTO, fn: (c, e) => { for (let i = 0; i < 3; i++) if (c.r() < 0.5) fumacaNa(c, e.x + 0.4 + c.r() * 0.2, e.y + 0.1 + c.r() * 0.5, e.z + 0.4 + c.r() * 0.2, COR.escura, 0.09); } }]);
regra('brewing_stand', () => [{ por: PERTO, fn: (c, e) => fumacaNa(c, e.x + 0.4 + c.r() * 0.2, e.y + 0.7 + c.r() * 0.3, e.z + 0.4 + c.r() * 0.2, COR.fumaca, 0.08) }]);
// gerador de monstros: chamas e fumaça por dentro enquanto alguém está a até 16 blocos
regra('spawner', () => [{ sempre: true, por: 10, alcance: 16, fn: (c, e) => {
  const x = e.x + c.r(), y = e.y + c.r(), z = e.z + c.r();
  fumacaNa(c, x, y, z); c.solta(TIPO.chama, x, y, z, 0, 0, 0, 0.5 + c.r() * 0.5, 0.14, COR.chama);
} }]);
// câmara de provação e cofre: chamas pequenas enquanto ativos (azuis no modo agourento)
regra('trial_spawner', (p) => {
  const s = p.trial_spawner_state, forte = s === 'active' || s === 'ejecting_reward';
  if (!forte && s !== 'waiting_for_players' && s !== 'waiting_for_reward_ejection') return null;
  const cor = p.ominous === 'true' ? COR.alma : COR.chama;
  return [{ sempre: true, por: forte ? 4 : 1, alcance: 24, fn: (c, e) => { const x = e.x + 0.2 + c.r() * 0.6, y = e.y + 0.2 + c.r() * 0.6, z = e.z + 0.2 + c.r() * 0.6; c.solta(TIPO.chama, x, y, z, 0, 0.05, 0, 0.5 + c.r() * 0.4, 0.1, cor); if (forte && c.r() < 0.5) fumacaNa(c, x, y, z); } }];
});
regra('vault', (p) => p.vault_state === 'inactive' ? null : [{ sempre: true, por: 1, alcance: 24, fn: (c, e) => c.solta(TIPO.chama, e.x + 0.3 + c.r() * 0.4, e.y + 0.3 + c.r() * 0.4, e.z + 0.3 + c.r() * 0.4, 0, 0.05, 0, 0.5 + c.r() * 0.4, 0.08, p.ominous === 'true' ? COR.alma : COR.chama) }]);
// arbusto de vagalumes: à noite, vagalumes em volta (até 5 blocos)
regra('firefly_bush', () => [{ por: PERTO, fn: (c, e) => {
  if (c.noite() < 0.5 || c.r() >= 0.1) return;
  const x = e.x + c.r() * 10 - 5, y = e.y + c.r() * 5, z = e.z + c.r() * 10 - 5;
  if (c.ar(Math.floor(x), Math.floor(y), Math.floor(z))) c.solta(TIPO.vagalume, x, y, z, 0, 0, 0, 8 + c.r() * 6, 0.07, COR.vagalume, 2.4);
} }]);
// lava parada com ar em cima: estala uma brasa de vez em quando
regra('lava', () => [{ por: PERTO * 0.01, fn: (c, e) => { if (c.ar(e.x, e.y + 1, e.z)) c.brasa(e.x + c.r(), e.y + 1, e.z + c.r()); } }]);
// coluna de bolhas: sobe (areia das almas) ou desce rodando (magma)
regra('bubble_column', () => [{ por: PERTO * 2, fn: (c, e) => {
  let y = e.y, k = 0;
  while (k++ < 64 && c.nome(e.x, y - 1, e.z) === 'bubble_column') y--;
  if (c.nome(e.x, y - 1, e.z) === 'magma_block') c.solta(TIPO.bolha, e.x + 0.5, e.y + 0.8, e.z + 0.5, 0, -0.8, 0, 0.6 + c.r() * 0.4, 0.09, COR.bolha);
  else for (let i = 0; i < 2; i++) c.solta(TIPO.bolha, e.x + c.r(), e.y + c.r(), e.z + c.r(), 0, 2.2 + c.r() * 0.6, 0, 0.45 + c.r() * 0.4, 0.08, COR.bolha);
} }]);
// colmeia cheia de mel: pinga mel por baixo
regra(['beehive', 'bee_nest'], (p) => +p.honey_level < 5 ? null : [{ por: PERTO * 0.7, fn: (c, e) => { if (!c.solido(e.x, e.y - 1, e.z)) c.gota(e.x + 0.15 + c.r() * 0.7, e.y - 0.03, e.z + 0.15 + c.r() * 0.7, COR.mel); } }]);
// toca-discos: a nota sai quando toca um disco; o LAVRA ainda não tem discos (TIPO.nota fica pronto para quando tiver)

// ---- motor -----------------------------------------------------------------------------------------------------------
function semear(s) { return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// programas de um estado MC (n = estado − MC_BASE), guardados na primeira consulta; null = o bloco não se mexe
const _prog = new Map();
export function programasMc(n) {
  if (_prog.has(n)) return _prog.get(n);
  let l = null;
  try { const { nome, props } = mcEstado(n); const f = REGRAS.get(nome); l = f ? f(props, nome) : null; } catch { l = null; }
  if (l && !l.length) l = null;
  _prog.set(n, l);
  return l;
}

export function criarEmissoresMc({ world, particulas, rand = Math.random, noite = () => 0, chuva = () => 0, escala = 1 }) {
  const get = (x, y, z) => world.getBlock(x, y, z);
  const solido = (x, y, z) => !!SOLID[get(x, y, z)];
  const ar = (x, y, z) => get(x, y, z) === B.AIR;
  const nome = (x, y, z) => { const s = world.getMini(x, y, z); if (s < MC_BASE) return null; try { return mcEstado(s - MC_BASE).nome; } catch { return null; } };
  const chao = (x, y, z) => { for (let k = 0; k < 40; k++, y--) if (y <= 0 || solido(x, y, z)) return y + 1; return y; };
  const luz = (x, y, z) => { const v = world.getLight(Math.floor(x), Math.floor(y), Math.floor(z)) | 0; return [(v & 15) / 15, (v >> 4) / 15]; };
  const c = {
    r: rand, solido, ar, nome, chao, noite, chuva,
    ceuAberto: (x, y, z) => ((world.getLight(x, y, z) | 0) & 15) >= 15,
    fluido: (x, y, z) => { const id = get(x, y, z); if (id === B.WATER || (id >= B.FLOW_1 && id <= B.FLOW_7)) return 'agua'; const n = nome(x, y, z); return n === 'water' ? 'agua' : n === 'lava' ? 'lava' : null; },
    tom: (cor, min) => { const k = min + rand() * (1 - min); return [cor[0] * k, cor[1] * k, cor[2] * k]; },
    matiz: (h) => { const f = (n) => { const k = (n + h * 6) % 6; return 1 - Math.max(0, Math.min(1, Math.min(k, 4 - k))); }; return [f(5), f(3), f(1)]; },
    solta(tipo, x, y, z, vx, vy, vz, vida, tam, cor, extra = 0, ch = y - 64) {
      const [ceu, bloco] = luz(x, y, z);
      particulas.soltar(tipo, x, y, z, vx, vy, vz, vida, tam, rand(), ch, cor[0], cor[1], cor[2], extra, ceu, bloco);
    },
    poeira(x, y, z, forca) { const k = 0.35 + 0.65 * forca; c.solta(TIPO.poeira, x, y, z, 0, 0, 0, 0.6 + rand() * 0.8, 0.06, [COR.redstone[0] * k, COR.redstone[1], COR.redstone[2]], 1.2); },
    gota(x, y, z, cor) {
      const ch = chao(Math.floor(x), Math.floor(y) - (y % 1 < 0.1 ? 1 : 0), Math.floor(z)), pend = 0.6 + rand() * 0.7;
      c.solta(TIPO.gota, x, y, z, 0, 0, 0, pend + Math.sqrt(Math.max(0, y - ch) / 6) + 0.05, 0.075, cor, pend, ch);
    },
    brasa(x, y, z) {
      const ch = chao(Math.floor(x), Math.floor(y), Math.floor(z));
      c.solta(TIPO.brasa, x, y, z, (rand() - 0.5) * 1.2, 1.0 + rand() * 3, (rand() - 0.5) * 1.2, 1.2 + rand() * 1.2, 0.07, COR.brasa, 2.6, ch);
      if (rand() < 0.5) fumacaNa(c, x, y + 0.1, z);
    },
    fogueira(e, sinal) {
      const s1 = rand() < 0.5 ? 1 : -1, s2 = rand() < 0.5 ? 1 : -1;
      c.solta(TIPO.fogueira, e.x + 0.5 + rand() / 3 * s1, e.y + rand() + rand(), e.z + 0.5 + rand() / 3 * s2, (rand() - 0.5) * 0.08, sinal ? 1.35 + rand() * 0.2 : 1.1 + rand() * 0.3, (rand() - 0.5) * 0.08,
        sinal ? 14 + rand() * 5 : 4 + rand() * 2.5, sinal ? 0.85 + rand() * 0.3 : 0.7 + rand() * 0.3, sinal ? COR.sinal : COR.fogueira);
    },
  };
  let lista = [];
  // células MC com movimento a até 64 blocos (o alcance de cada programa filtra depois); roda a cada meio segundo
  function varrer(px, py, pz) {
    lista = [];
    const R = Math.ceil(64 / CW), qx = Math.floor(px / CW), qz = Math.floor(pz / CW);
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const cx = qx + dx, cz = qz + dz, mp = world.minis.get(ckey(cx, cz));
      if (!mp) continue;
      for (const [i, st] of mp) {
        if (st < MC_BASE) continue;
        const progs = programasMc(st - MC_BASE);
        if (!progs) continue;
        lista.push({ x: cx * CW + (i & 15), y: i >> 8, z: cz * CW + ((i >> 4) & 15), progs });
      }
    }
    return lista.length;
  }
  // um tique (1/20 s): cada programa no alcance sorteia se roda
  function tique(px, py, pz) {
    for (const e of lista) {
      const d = Math.max(Math.abs(e.x + 0.5 - px), Math.abs(e.y + 0.5 - py), Math.abs(e.z + 0.5 - pz));
      for (const pr of e.progs) {
        if (d > (pr.alcance || 32)) continue;
        const ritmo = pr.sempre ? pr.por : d <= 16 ? pr.por : pr.por * (LONGE / PERTO);
        if (rand() < ritmo * escala * TIQUE) pr.fn(c, e);
      }
    }
  }
  return { varrer, tique, get emissores() { return lista.length; }, contexto: c };
}

export function initMovimentosMc({ game, world, camera, quality = {}, particulas, noite = () => 0 }) {
  const em = criarEmissoresMc({ world, particulas, noite, chuva: () => game.weather?.rain || 0, escala: quality.name === 'baixa' ? 0.5 : 1 });
  const cam = { x: 0, y: 0, z: 0 }, v = camera.position.clone();
  let acc = 0, desdeVarrer = 9, onde = '';
  game.hooks.frame.push((dt) => {
    const aqui = game.slug + ':' + game.dim;
    if (aqui !== onde) { onde = aqui; particulas.limpar(); desdeVarrer = 9; }
    camera.getWorldPosition(v); cam.x = v.x; cam.y = v.y; cam.z = v.z;
    if (game.state === 'PLAYING' || game.state === 'PAUSED') {
      if ((desdeVarrer += dt) >= 0.5) { desdeVarrer = 0; em.varrer(cam.x, cam.y, cam.z); }
      acc = Math.min(acc + dt, 0.25);
      while (acc >= TIQUE) { acc -= TIQUE; em.tique(cam.x, cam.y, cam.z); }
    }
    const w = game.weather?.wind;
    particulas.update(dt, w);
  });
  const api = { get emissores() { return em.emissores; }, get ativas() { return particulas.ativas; }, get soltas() { return particulas.soltas; } };
  game.movimentosMc = api;
  return api;
}
