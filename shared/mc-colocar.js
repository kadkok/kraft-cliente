// LAVRA — o estado de um bloco do Minecraft ao ser colocado (fase 5 de docs/plano-blocos-minecraft.md), pelas regras do
// getStateForPlacement de cada tipo no Minecraft: para onde quem coloca olha, qual face foi clicada e onde na face.
//
// mcColocar(v, look, normal, fy) → [[dx, dy, dz, v'], ...] ou [] (não cabe)
//   v      = MC_BASE + estado escolhido na paleta (as propriedades que a regra não decide ficam como estão)
//   look   = direção do olhar [x, y, z]; normal = face clicada [nx, ny, nz] (inteiros); fy = altura do clique na face (0..1)
// Porta, capim alto e flores altas ocupam duas células (metade de baixo e de cima).
import { MC_BASE, mcEstado, mcNumero } from './mc-estados.js';

const DIR = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };
const OPOSTA = { north: 'south', south: 'north', east: 'west', west: 'east', up: 'down', down: 'up' };
const horizDe = (v) => (Math.abs(v[0]) > Math.abs(v[2]) ? (v[0] > 0 ? 'east' : 'west') : (v[2] > 0 ? 'south' : 'north'));
const dirDe = (v) => { const a = v.map(Math.abs); return a[1] > a[0] && a[1] > a[2] ? (v[1] > 0 ? 'up' : 'down') : horizDe(v); };
const normalNome = (n) => (n[1] > 0 ? 'up' : n[1] < 0 ? 'down' : n[0] > 0 ? 'east' : n[0] < 0 ? 'west' : n[2] > 0 ? 'south' : 'north');

// virados para QUEM COLOCA (a frente olha para o jogador): fornalha, baú, bancada de cartografia…
const FRENTE_PARA_MIM = /(furnace|smoker|chest|barrel|dispenser|dropper|observer|crafter|lectern|loom|stonecutter|grindstone|beehive|bee_nest|carved_pumpkin|jack_o_lantern|anvil|end_portal_frame|piston|campfire|shelf|vault|trial_spawner|decorated_pot|chiseled_bookshelf|bed|comparator|repeater)$/;
// presos na parede: a face clicada decide
const NA_PAREDE = /(wall_torch|ladder|wall_sign|wall_hanging_sign|wall_banner|wall_head|wall_skull|tripwire_hook|wall_fan|cocoa)$/;
// apontam para a face clicada (6 lados)
const PARA_A_FACE = /(end_rod|lightning_rod|amethyst_cluster|amethyst_bud|hopper|shulker_box|pointed_dripstone)$/;

export function mcColocar(v, look, normal, fy = 0.5) {
  let { nome, props } = mcEstado(v - MC_BASE);
  const p = { ...props };
  const nn = normalNome(normal), olhar = horizDe(look);
  // tocha num lado vira tocha de parede (e a de parede no chão volta a ser de pé)
  const parede = { torch: 'wall_torch', soul_torch: 'soul_wall_torch', redstone_torch: 'redstone_wall_torch' };
  if (parede[nome] && normal[1] === 0) { nome = parede[nome]; p.facing = nn; }
  else if (Object.values(parede).includes(nome) && normal[1] !== 0) { nome = Object.keys(parede).find((k) => parede[k] === nome); delete p.facing; }
  else if (/_sign$/.test(nome) && !/wall|hanging/.test(nome) && normal[1] === 0) { nome = nome.replace(/_sign$/, '_wall_sign'); p.facing = nn; }
  if (normal[1] < 0 && nome === 'torch') return [];              // tocha não fica no teto
  const N = mcNumero(nome, {}); if (N < 0) return [];
  const nprops = mcEstado(N).props;                               // propriedades do bloco final (pode ter mudado de nome)
  const tem2 = (k) => k in nprops;
  if (tem2('facing')) {
    const seis = ['up', 'down'].some((d) => mcNumero(nome, { facing: d }) !== mcNumero(nome, { facing: 'north' }));
    if (NA_PAREDE.test(nome) || (tem2('face') && normal[1] === 0)) p.facing = nn;
    else if (PARA_A_FACE.test(nome)) p.facing = seis ? nn : (normal[1] === 0 ? nn : OPOSTA[olhar]);
    else if (FRENTE_PARA_MIM.test(nome)) p.facing = seis ? OPOSTA[dirDe(look)] : OPOSTA[olhar];
    else if (/trapdoor$/.test(nome)) p.facing = normal[1] === 0 ? nn : OPOSTA[olhar];
    else p.facing = olhar;                                        // escada, porta, portão, cama…: para onde se olha
  }
  if (tem2('face')) p.face = normal[1] > 0 ? 'floor' : normal[1] < 0 ? 'ceiling' : 'wall';
  if (tem2('axis')) p.axis = normal[0] ? 'x' : normal[2] ? 'z' : 'y';
  const emCima = normal[1] < 0 || (normal[1] === 0 && fy > 0.5);
  if (tem2('type') && /_slab$/.test(nome)) p.type = emCima ? 'top' : 'bottom';
  if (tem2('half') && (/_stairs$/.test(nome) || /trapdoor$/.test(nome))) p.half = emCima ? 'top' : 'bottom';
  if (tem2('hanging')) p.hanging = normal[1] < 0 ? 'true' : 'false';
  if (tem2('attachment') && nome === 'bell') p.attachment = normal[1] > 0 ? 'floor' : normal[1] < 0 ? 'ceiling' : 'single_wall';
  if (tem2('rotation')) {                                         // placa de pé: 16 direções, de frente para quem coloca
    const ang = Math.atan2(-look[0], look[2]);                    // 0 = sul
    p.rotation = String(((Math.round(ang / (Math.PI / 8)) % 16) + 16 + 8) % 16);
  }
  // duas células: porta, capim alto, flores altas (half = lower / upper)
  if (tem2('half') && mcNumero(nome, { half: 'upper' }) !== mcNumero(nome, { half: 'lower' })) {
    const baixo = MC_BASE + mcNumero(nome, { ...p, half: 'lower' }), cima = MC_BASE + mcNumero(nome, { ...p, half: 'upper' });
    return [[0, 0, 0, baixo], [0, 1, 0, cima]];
  }
  return [[0, 0, 0, MC_BASE + mcNumero(nome, p)]];
}
// o estado "da paleta" de um bloco: todas as propriedades no primeiro valor
export const mcPadrao = (nome) => { const n = mcNumero(nome, {}); return n < 0 ? 0 : MC_BASE + n; };
