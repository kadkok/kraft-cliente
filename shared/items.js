// LAVRA — itens soltos no chão e a mochila de quem joga (pedido do Kadmus, 16/11/2026: "quando quebrar eu posso pegar
// ou deixar"). Puro: o servidor é o dono dos itens (server/items.js) e os testes usam este módulo direto.
//
// Régua: o Minecraft.
// - Quebrar um bloco solta UM item dele no lugar. dropOf diz qual: quase sempre o próprio bloco; Gramado solta Terra;
//   folhagem, capim, samambaia e arbusto seco não soltam nada; peça direcional solta a peça da paleta; um quarto de
//   bloco (mini-bloco) não solta nada; bloco do Minecraft solta o próprio bloco no primeiro estado dele.
// - O item é um cubinho de 25 cm que pula, cai, escorrega um pouco e para; na água, boia. Fica ITEM_LIFE segundos no
//   chão e some. Dois iguais encostados viram uma pilha só (até STACK).
// - Pegar ou deixar: quem passa perto pega sozinho (coleta automática, ligada por padrão), depois de PICK_DELAY segundos
//   (item largado da mochila: THROW_DELAY). Com a coleta automática desligada, nada entra sozinho: a tecla P pega o que
//   estiver a até HAND_REACH metros. Quem não quer o item, não passa por cima (ou desliga a coleta).
// - Mochila: BAG_SLOTS espaços de até STACK iguais. Cheia, o item fica no chão.
//
// Item = { b, s }: o id do bloco e, só nos blocos do Minecraft, o estado MC (MC_BASE + n); nos outros, s = 0.
// Tesouro (moeda, gema, relíquia, arma lendária) = { b: TESOURO_BASE + n, s: 0 } (shared/tesouros.js): não é bloco,
// não se põe no mundo, só vai e vem entre chão, mochila e baú.
import { B, BLOCKS, BASE, KIND, LEVEL, K_LIQUID, IS_STAIR, isValidBlock } from './blocks.js';
import { isMiniState, miniMask, isMcState, mcIdDoEstado, IS_MC } from './minis.js';
import { MC_BASE, MC_BLOCOS, MC_POR_NOME, mcBloco } from './mc-estados.js';
import { mcNomePt } from './mc-nomes.js';
import { boxSolid } from './surfaces.js';
import { isTesouro, nomeDe } from './tesouros.js';   // tesouros, gemas e armas lendárias (shared/tesouros.js)

export const ITEM_HALF = 0.125;     // meio lado do cubinho (m)
export const STACK = 64;            // iguais por espaço da mochila e por pilha no chão
export const BAG_SLOTS = 36;        // espaços da mochila
export const ITEM_LIFE = 300;       // segundos no chão até sumir (o mesmo do Minecraft)
export const PICK_DELAY = 0.5;      // segundos até poder ser pego, depois de cair de um bloco quebrado
export const THROW_DELAY = 2;       // segundos até poder ser pego, depois de largado da mochila
export const HAND_REACH = 3;        // tecla P: alcance (m), medido do meio do corpo
export const MAX_ITEMS = 1500;      // itens no chão por mundo; passou disso, o mais velho some
export const STEP = 1 / 60;         // passo da física (s)
// Alcance da coleta automática: a caixa de quem joga (0,6 × 1,8 m, a partir dos pés) alargada 1 m para os lados e
// 0,5 m para cima e para baixo, como no Minecraft, contra a caixa do item.
export const REACH_XZ = 0.3 + 1 + ITEM_HALF, REACH_DOWN = 0.5 + ITEM_HALF, REACH_UP = 1.8 + 0.5 + ITEM_HALF;

// ---- o que cada bloco solta ----------------------------------------------------------------------------------------
// Bloco do LAVRA → o que ele solta, quando não é ele mesmo (0 = nada). BLOCKS[id].drop (blocks.js) já diz que ar,
// água, véu e capim não soltam nada; aqui ficam as exceções do Minecraft.
const DROP_AS = new Map([
  [B.GRASS, B.DIRT], [B.ROOT, B.LOG], [B.PINE_ROOT, B.PINE_LOG],
  [B.LEAVES, 0], [B.PINE_LEAVES, 0], [B.FERN, 0], [B.DRY_SHRUB, 0],
]);
// Blocos do Minecraft, pelo nome: o que solta outro bloco e o que não solta nada.
const MC_DROP_AS = { grass_block: 'dirt', podzol: 'dirt', mycelium: 'dirt', dirt_path: 'dirt', farmland: 'dirt', stone: 'cobblestone' };
const MC_NO_DROP = /(_leaves|^short_grass|^tall_grass|^fern|^large_fern|^dead_bush|^seagrass|^tall_seagrass|^fire|^soul_fire|^air|^cave_air|^void_air|^water|^lava|^bubble_column|^light)$/;

// Um item válido: bloco existente que não é ar nem líquido; bloco do Minecraft só com um estado da sua classe.
export function validItem(b, s) {
  if (isTesouro(b)) return s === 0;   // tesouro: não é bloco, não tem estado
  if (!isValidBlock(b) || b === B.AIR || b === B.BEDROCK || b === B.PORTAL || KIND[b] === K_LIQUID || LEVEL[b] > 0) return false;
  if (IS_MC(b)) return isMcState(s) && mcIdDoEstado(s) === b;
  return s === 0;
}

// O que sai de um bloco `id` (com o estado `s` do mapa de mini-blocos) quando alguém o quebra: { b, s } ou null.
export function dropOf(id, s = 0) {
  if (!isValidBlock(id) || id === B.AIR) return null;
  if (IS_MC(id)) {
    if (!isMcState(s)) return null;
    let i = mcBloco(s - MC_BASE);
    const nome = MC_BLOCOS[i].n;
    if (MC_NO_DROP.test(nome)) return null;
    const as = MC_DROP_AS[nome];
    if (as && MC_POR_NOME.has(as)) i = MC_POR_NOME.get(as);
    const st = MC_BASE + MC_BLOCOS[i].s, b = mcIdDoEstado(st);
    return b > 0 ? { b, s: st } : null;
  }
  if (isMiniState(s) && !IS_STAIR[id] && miniMask(s) !== 15) return null;   // um quarto de bloco não vira item
  const meta = BLOCKS[id];
  if (!meta || meta.drop === 0) return null;
  let b = DROP_AS.has(id) ? DROP_AS.get(id) : (meta.drop || id);
  if (!b) return null;
  b = BASE[b] || b;                     // peça direcional (propulsor virado para cima…) solta a da paleta
  return validItem(b, 0) ? { b, s: 0 } : null;
}

// O item que se gasta para pôr o bloco `id` (com o estado `s`), no sobrevivência: a peça da paleta (peça virada gasta a
// de base; escada, a escada); bloco do Minecraft gasta o próprio bloco, em qualquer estado. null = não sai da mochila
// (água, por exemplo: no Minecraft ela pede balde).
export function placeItem(id, s = 0) {
  if (!isValidBlock(id) || id === B.AIR) return null;
  if (IS_MC(id)) {
    if (!isMcState(s)) return null;
    const st = MC_BASE + MC_BLOCOS[mcBloco(s - MC_BASE)].s, b = mcIdDoEstado(st);
    return b > 0 ? { b, s: st } : null;
  }
  const b = BASE[id] || id;
  return validItem(b, 0) ? { b, s: 0 } : null;
}

export function itemName(b, s = 0) {
  if (isTesouro(b)) return nomeDe(b);
  if (isMcState(s)) return mcNomePt(MC_BLOCOS[mcBloco(s - MC_BASE)].n);
  return BLOCKS[b]?.name || 'Item';
}
export const itemKey = (b, s) => b * 65536 + s;

// ---- física de um item ---------------------------------------------------------------------------------------------
// it = { p: [x, y, z] (centro do cubinho), v: [vx, vy, vz] (m/s), rest, ground, stuck }. read(x, y, z) = leitor de
// blocos com .shape (e .mini), o mesmo das colisões de quem joga. Devolve true enquanto o item se move.
const G = 16;                 // gravidade dos itens do Minecraft (0,04 bloco por tique² a 20 tiques por segundo)
const AIR_DRAG = 0.4;         // perda de velocidade por segundo no ar
const GROUND_FRICTION = 10;   // no chão o item para em menos de meio segundo
const WATER_DRAG = 3.2, BUOY = 22;   // na água: freia e sobe (empuxo maior que a gravidade: boia)
export function stepItem(it, read, dt = STEP) {
  const p = it.p, v = it.v, h = ITEM_HALF;
  const hit = (x, y, z) => boxSolid(read, x - h, y - h, z - h, x + h, y + h, z + h);
  if (hit(p[0], p[1], p[2])) {
    // dentro de um bloco (alguém construiu em cima): sobe até achar lugar, como no Minecraft
    for (let dy = 0.0625; dy <= 1.5; dy += 0.0625) {
      if (!hit(p[0], p[1] + dy, p[2])) { p[1] += dy; v[0] = v[1] = v[2] = 0; it.rest = false; it.stuck = 0; return true; }
    }
    it.stuck = (it.stuck || 0) + dt;
    return false;
  }
  const cell = read(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]));
  const wet = cell > 0 && KIND[cell] === K_LIQUID;
  v[1] += (wet ? BUOY - G : -G) * dt;
  const drag = Math.exp(-(wet ? WATER_DRAG : AIR_DRAG) * dt);
  v[0] *= drag; v[2] *= drag;
  if (wet) v[1] *= drag;
  if (v[1] < -40) v[1] = -40;
  // vertical primeiro: é ele que diz se o item está no chão
  let ground = false;
  const dy = v[1] * dt;
  if (!hit(p[0], p[1] + dy, p[2])) p[1] += dy;
  else {
    let lo = 0, hi = 1;
    for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (hit(p[0], p[1] + dy * m, p[2])) hi = m; else lo = m; }
    p[1] += dy * lo;
    if (v[1] < 0) ground = true;
    v[1] = v[1] < -4 ? -v[1] * 0.2 : 0;     // quique pequeno quando cai de alto
  }
  for (const a of [0, 2]) {
    const d = v[a] * dt;
    if (!d) continue;
    const q = [p[0], p[1], p[2]];
    q[a] += d;
    if (!hit(q[0], q[1], q[2])) { p[a] = q[a]; continue; }
    let lo = 0, hi = 1;
    for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; q[a] = p[a] + d * m; if (hit(q[0], q[1], q[2])) hi = m; else lo = m; }
    p[a] += d * lo;
    v[a] = 0;
  }
  if (ground) { const f = Math.exp(-GROUND_FRICTION * dt); v[0] *= f; v[2] *= f; }
  it.ground = ground;
  it.stuck = 0;
  if ((ground || wet) && Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]) < 0.06) { v[0] = v[1] = v[2] = 0; it.rest = true; return false; }
  return true;
}

// Dois itens podem virar uma pilha? Iguais, com espaço na pilha e encostados como no Minecraft: a caixa de um, alargada
// meio bloco para os lados (não para cima), toca a do outro — até 0,75 m de lado e na mesma altura.
export const MERGE_XZ = 0.5 + 2 * ITEM_HALF, MERGE_Y = 2 * ITEM_HALF;
export function mergeable(a, b) {
  return a.b === b.b && a.s === b.s && a.n < STACK && b.n < STACK &&
    Math.abs(a.p[0] - b.p[0]) < MERGE_XZ && Math.abs(a.p[2] - b.p[2]) < MERGE_XZ && Math.abs(a.p[1] - b.p[1]) < MERGE_Y;
}

// A coleta automática alcança o item? feet = posição de quem joga (os pés), p = centro do item.
export function inReach(feet, p) {
  return Math.abs(p[0] - feet[0]) <= REACH_XZ && Math.abs(p[2] - feet[2]) <= REACH_XZ &&
    p[1] >= feet[1] - REACH_DOWN && p[1] <= feet[1] + REACH_UP;
}
// A tecla P alcança? Distância do meio do corpo (pés + 0,9 m) ao item.
export function inHandReach(feet, p) {
  const dx = p[0] - feet[0], dy = p[1] - (feet[1] + 0.9), dz = p[2] - feet[2];
  return dx * dx + dy * dy + dz * dz <= HAND_REACH * HAND_REACH;
}

// ---- mochila -------------------------------------------------------------------------------------------------------
// BAG_SLOTS espaços; cada um é [b, s, n] ou 0.
export const newBag = () => new Array(BAG_SLOTS).fill(0);
// Guarda até n itens { b, s }: completa as pilhas iguais, depois ocupa espaços vazios. Devolve quantos entraram.
export function bagAdd(bag, b, s, n) {
  let left = n;
  for (const e of bag) {
    if (!left) break;
    if (e && e[0] === b && e[1] === s && e[2] < STACK) { const k = Math.min(left, STACK - e[2]); e[2] += k; left -= k; }
  }
  for (let i = 0; i < bag.length && left; i++) if (!bag[i]) { const k = Math.min(left, STACK); bag[i] = [b, s, k]; left -= k; }
  return n - left;
}
// Tira até n do espaço i. Devolve [b, s, quantos] ou null.
export function bagTake(bag, i, n) {
  const e = bag[i];
  if (!e || !(n > 0)) return null;
  const k = Math.min(n, e[2]);
  e[2] -= k;
  if (!e[2]) bag[i] = 0;
  return [e[0], e[1], k];
}
export const bagTotal = (bag) => bag.reduce((n, e) => n + (e ? e[2] : 0), 0);
export const bagUsed = (bag) => bag.reduce((n, e) => n + (e ? 1 : 0), 0);
// Mochila vinda do arquivo ou da rede: só o que é item válido, sem passar da pilha.
export function cleanBag(raw) {
  const bag = newBag();
  if (!Array.isArray(raw)) return bag;
  for (let i = 0; i < BAG_SLOTS; i++) {
    const e = raw[i];
    if (Array.isArray(e) && e.length === 3 && Number.isInteger(e[0]) && Number.isInteger(e[1]) && Number.isInteger(e[2]) &&
      e[2] > 0 && validItem(e[0], e[1])) bag[i] = [e[0], e[1], Math.min(STACK, e[2])];
  }
  return bag;
}
