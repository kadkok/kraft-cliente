// LAVRA — receitas de fabricação (2x2 na mochila, 3x3 na mesa de trabalho) e fundição (fornalha).
// Puro: compartilhado entre cliente (prévia + livro de receitas) e servidor (validação + execução).
import { B, BLOCKS } from './blocks.js';
import { MC_BASE, MC_POR_NOME, MC_BLOCOS, mcEstado } from './mc-estados.js';
import { mcIdDoEstado } from './minis.js';
import { itemName, STACK } from './items.js';

const mcItem = (nome) => {
  const i = MC_POR_NOME.get(nome);
  if (i === undefined) return null;
  const s = MC_BASE + MC_BLOCOS[i].s;
  const b = mcIdDoEstado(s);
  return b > 0 ? { b, s } : null;
};

const itemEq = (a, b) => a && b && a[0] === b.b && a[1] === b.s;

const LOG_SET = new Set([B.LOG, B.PINE_LOG, B.ROOT, B.PINE_ROOT]);
const PLANKS_SET = new Set([B.PLANKS, B.PINE_PLANKS]);
const MC_LOG_NAMES = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;
const MC_PLANK_NAMES = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)_planks$/;

function mcNameOf(b, s) {
  if (s < MC_BASE) return '';
  return mcEstado(s - MC_BASE)?.nome || '';
}

function matchesTag(b, s, tag) {
  if (tag === 'log') return (s === 0 && LOG_SET.has(b)) || MC_LOG_NAMES.test(mcNameOf(b, s));
  if (tag === 'planks') return (s === 0 && PLANKS_SET.has(b)) || MC_PLANK_NAMES.test(mcNameOf(b, s));
  if (tag === 'stone') return (s === 0 && b === B.STONE) || /^(stone|cobblestone)$/.test(mcNameOf(b, s));
  return false;
}

export function matchesIngredient(cell, ing) {
  if (!cell || !ing) return false;
  const [b, s] = cell;
  if (typeof ing === 'string') return matchesTag(b, s, ing);
  if (Array.isArray(ing)) return ing.some((x) => matchesIngredient(cell, x));
  return b === ing.b && s === (ing.s || 0);
}

const lv = (b, n = 1) => ({ b, s: 0, n });
const mc = (nome, n = 1) => {
  const it = mcItem(nome);
  return it ? { b: it.b, s: it.s, n } : null;
};

function shaped(id, nome, grupo, shape, key, out, minSize = null) {
  if (!out) return null;
  const h = shape.length, w = Math.max(...shape.map((r) => r.length));
  const size = minSize ?? (h <= 2 && w <= 2 ? 2 : 3);
  return { id, nome, grupo, type: 'shaped', size, shape, key, out };
}

function shapeless(id, nome, grupo, ingredients, out, minSize = null) {
  if (!out) return null;
  const size = minSize ?? (ingredients.length <= 4 ? 2 : 3);
  return { id, nome, grupo, type: 'shapeless', size, ingredients, out };
}

const L = {
  log: { b: B.LOG, s: 0 },
  pineLog: { b: B.PINE_LOG, s: 0 },
  planks: { b: B.PLANKS, s: 0 },
  pinePlanks: { b: B.PINE_PLANKS, s: 0 },
  stone: { b: B.STONE, s: 0 },
  stoneBricks: { b: B.STONE_BRICKS, s: 0 },
  dirt: { b: B.DIRT, s: 0 },
  sand: { b: B.SAND, s: 0 },
  gravel: { b: B.GRAVEL, s: 0 },
  clay: { b: B.CLAY, s: 0 },
  snow: { b: B.SNOW, s: 0 },
  sandstone: { b: B.SANDSTONE, s: 0 },
  marble: { b: B.MARBLE, s: 0 },
  concrete: { b: B.CONCRETE, s: 0 },
  bricks: { b: B.BRICKS, s: 0 },
  glass: { b: B.GLASS, s: 0 },
  coal: { b: B.COAL_ORE, s: 0 },
  iron: { b: B.IRON_ORE, s: 0 },
  copper: { b: B.COPPER_ORE, s: 0 },
  gold: { b: B.GOLD_ORE, s: 0 },
  crystal: { b: B.CRYSTAL_ORE, s: 0 },
  steel: { b: B.STEEL, s: 0 },
  ash: { b: B.ASH, s: 0 },
  reeds: { b: B.REEDS, s: 0 },
  plasterWhite: { b: B.PLASTER_WHITE, s: 0 },
  flowerRed: { b: B.FLOWER_RED, s: 0 },
  flowerYellow: { b: B.FLOWER_YELLOW, s: 0 },
  flowerBlue: { b: B.FLOWER_BLUE, s: 0 },
  fern: { b: B.FERN, s: 0 },
  torch: mc('torch'),
  furnace: mc('furnace'),
};

export const RECIPES = [
  // ---- Essenciais (2x2: Mochila e Mesa de trabalho) ----
  shapeless('tabuas_pinheiro', 'Tábuas de pinheiro', 'essencial', [[L.pineLog, { b: B.PINE_ROOT, s: 0 }, mcItem('spruce_log')].filter(Boolean)], lv(B.PINE_PLANKS, 4), 2),
  shapeless('tabuas', 'Tábuas', 'essencial', ['log'], lv(B.PLANKS, 4), 2),
  shaped('mesa_trabalho', 'Mesa de trabalho', 'essencial', ['PP', 'PP'], { P: 'planks' }, mc('crafting_table', 1), 2),
  shaped('tocha', 'Tocha', 'essencial', ['C', 'P'], { C: L.coal, P: 'planks' }, mc('torch', 4), 2),
  shaped('fornalha', 'Fornalha', 'essencial', ['SSS', 'S S', 'SSS'], { S: 'stone' }, mc('furnace', 1), 3),
  shaped('barril', 'Barril', 'essencial', ['PSP', 'P P', 'PSP'], { P: 'planks', S: 'log' }, mc('barrel', 1), 3),
  shaped('lampiao', 'Lampião', 'essencial', [' I ', 'ITI', ' I '], { I: L.iron, T: L.torch }, mc('lantern', 1), 3),
  shaped('fogueira', 'Fogueira', 'essencial', [' C ', 'LLL'], { C: L.coal, L: 'log' }, mc('campfire', 1), 3),
  shaped('defumador', 'Defumador', 'essencial', [' L ', 'LFL', ' L '], { L: 'log', F: L.furnace }, mc('smoker', 1), 3),
  shaped('alto_forno', 'Alto-forno', 'essencial', ['III', 'IFI', 'SSS'], { I: L.iron, F: L.furnace, S: 'stone' }, mc('blast_furnace', 1), 3),

  // ---- Construção LAVRA ----
  shaped('pedra_talhada', 'Pedra talhada', 'construcao', ['SS', 'SS'], { S: 'stone' }, lv(B.STONE_BRICKS, 4), 2),
  shaped('tijolos', 'Tijolos', 'construcao', ['CC', 'CC'], { C: L.clay }, lv(B.BRICKS, 4), 2),
  shaped('arenito', 'Arenito', 'construcao', ['SS', 'SS'], { S: L.sand }, lv(B.SANDSTONE, 1), 2),
  shaped('concreto', 'Concreto', 'construcao', ['SG', 'GS'], { S: L.sand, G: L.gravel }, lv(B.CONCRETE, 4), 2),
  shaped('marmore', 'Mármore', 'construcao', ['SC', 'CS'], { S: 'stone', C: L.clay }, lv(B.MARBLE, 4), 2),
  shaped('aco', 'Chapa de aço', 'construcao', ['IC', 'CI'], { I: L.iron, C: L.coal }, lv(B.STEEL, 2), 2),
  shapeless('vidro', 'Vidro', 'construcao', [L.sand, L.sand, L.sand, L.coal], lv(B.GLASS, 4), 2),
  shaped('lanterna', 'Lanterna', 'construcao', [' G ', 'GCG', ' G '], { G: L.glass, C: L.crystal }, lv(B.LAMP, 2), 3),
  shaped('telha', 'Telha', 'construcao', ['BBB'], { B: L.bricks }, lv(B.ROOF, 6), 3),
  shaped('bloco_ouro', 'Bloco de ouro', 'construcao', ['GGG', 'GGG', 'GGG'], { G: L.gold }, lv(B.GOLD_BLOCK, 1), 3),
  shaped('reboco_branco', 'Reboco branco', 'construcao', ['CN', 'NC'], { C: L.clay, N: L.snow }, lv(B.PLASTER_WHITE, 4), 2),
  shapeless('reboco_vermelho', 'Reboco vermelho', 'construcao', [L.plasterWhite, L.flowerRed], lv(B.PLASTER_RED, 1), 2),
  shapeless('reboco_amarelo', 'Reboco amarelo', 'construcao', [L.plasterWhite, L.flowerYellow], lv(B.PLASTER_YELLOW, 1), 2),
  shapeless('reboco_verde', 'Reboco verde', 'construcao', [L.plasterWhite, L.fern], lv(B.PLASTER_GREEN, 1), 2),
  shapeless('reboco_azul', 'Reboco azul', 'construcao', [L.plasterWhite, L.flowerBlue], lv(B.PLASTER_BLUE, 1), 2),
  shapeless('reboco_grafite', 'Reboco grafite', 'construcao', [L.plasterWhite, L.coal], lv(B.PLASTER_DARK, 1), 2),

  // ---- Vidros tingidos (3x3) ----
  shaped('vidro_fume', 'Vidro fumê', 'construcao', ['GGG', 'GCG', 'GGG'], { G: L.glass, C: L.coal }, lv(B.GLASS_SMOKE, 8), 3),
  shaped('vidro_dourado', 'Vidro dourado', 'construcao', ['GGG', 'GOG', 'GGG'], { G: L.glass, O: L.gold }, lv(B.GLASS_GOLD, 8), 3),
  shaped('vidro_prata', 'Vidro prata', 'construcao', ['GGG', 'GIG', 'GGG'], { G: L.glass, I: L.iron }, lv(B.GLASS_SILVER, 8), 3),
  shaped('vidro_espelho', 'Vidro espelho', 'construcao', ['GGG', 'GCG', 'GGG'], { G: L.glass, C: L.crystal }, lv(B.GLASS_MIRROR, 8), 3),
  shaped('vidro_azul', 'Vidro azul', 'construcao', ['GGG', 'GFG', 'GGG'], { G: L.glass, F: L.flowerBlue }, lv(B.GLASS_BLUE, 8), 3),
  shaped('vidro_vermelho', 'Vidro vermelho', 'construcao', ['GGG', 'GFG', 'GGG'], { G: L.glass, F: L.flowerRed }, lv(B.GLASS_RED, 8), 3),

  // ---- Escadas e acabamentos (3x3) ----
  shaped('escada_tabuas', 'Escada de tábuas', 'acabamento', ['X  ', 'XX ', 'XXX'], { X: L.planks }, lv(B.STAIR_PLANKS, 4), 3),
  shaped('escada_pinheiro', 'Escada de pinheiro', 'acabamento', ['X  ', 'XX ', 'XXX'], { X: L.pinePlanks }, lv(B.STAIR_PINE, 4), 3),
  shaped('escada_pedra', 'Escada de pedra', 'acabamento', ['X  ', 'XX ', 'XXX'], { X: L.stone }, lv(B.STAIR_STONE, 4), 3),
  shaped('escada_pedra_talhada', 'Escada de pedra talhada', 'acabamento', ['X  ', 'XX ', 'XXX'], { X: L.stoneBricks }, lv(B.STAIR_STONE_BRICKS, 4), 3),
  shaped('escada_tijolos', 'Escada de tijolos', 'acabamento', ['X  ', 'XX ', 'XXX'], { X: L.bricks }, lv(B.STAIR_BRICKS, 4), 3),
  shaped('escada_marmore', 'Escada de mármore', 'acabamento', ['X  ', 'XX ', 'XXX'], { X: L.marble }, lv(B.STAIR_MARBLE, 4), 3),
  shaped('escada_arenito', 'Escada de arenito', 'acabamento', ['X  ', 'XX ', 'XXX'], { X: L.sandstone }, lv(B.STAIR_SANDSTONE, 4), 3),
  shaped('escada_concreto', 'Escada de concreto', 'acabamento', ['X  ', 'XX ', 'XXX'], { X: L.concrete }, lv(B.STAIR_CONCRETE, 4), 3),

  // ---- Portas, cercas, lajes e detalhes (Minecraft, 3x3) ----
  shaped('porta_carvalho', 'Porta de carvalho', 'acabamento', ['PP', 'PP', 'PP'], { P: L.planks }, mc('oak_door', 3), 3),
  shaped('porta_pinheiro', 'Porta de pinheiro', 'acabamento', ['PP', 'PP', 'PP'], { P: L.pinePlanks }, mc('spruce_door', 3), 3),
  shaped('alcapao_carvalho', 'Alçapão de carvalho', 'acabamento', ['PPP', 'PPP'], { P: L.planks }, mc('oak_trapdoor', 2), 3),
  shaped('alcapao_pinheiro', 'Alçapão de pinheiro', 'acabamento', ['PPP', 'PPP'], { P: L.pinePlanks }, mc('spruce_trapdoor', 2), 3),
  shaped('cerca_carvalho', 'Cerca de carvalho', 'acabamento', ['PLP', 'PLP'], { P: L.planks, L: L.log }, mc('oak_fence', 3), 3),
  shaped('cerca_pinheiro', 'Cerca de pinheiro', 'acabamento', ['PLP', 'PLP'], { P: L.pinePlanks, L: L.pineLog }, mc('spruce_fence', 3), 3),
  shaped('portao_carvalho', 'Portão de carvalho', 'acabamento', ['LPL', 'LPL'], { P: 'planks', L: 'log' }, mc('oak_fence_gate', 1), 3),
  shaped('escada_mao', 'Escada de mão', 'acabamento', ['P P', 'PPP', 'P P'], { P: 'planks' }, mc('ladder', 3), 3),
  shaped('estante', 'Estante', 'acabamento', ['PPP', 'RRR', 'PPP'], { P: 'planks', R: L.reeds }, mc('bookshelf', 1), 3),
  shaped('laje_carvalho', 'Laje de tábuas', 'acabamento', ['PPP'], { P: L.planks }, mc('oak_slab', 6), 3),
  shaped('laje_pinheiro', 'Laje de pinheiro', 'acabamento', ['PPP'], { P: L.pinePlanks }, mc('spruce_slab', 6), 3),
  shaped('laje_pedra', 'Laje de pedra', 'acabamento', ['SSS'], { S: L.stone }, mc('stone_slab', 6), 3),
  shaped('laje_pedra_talhada', 'Laje de pedra talhada', 'acabamento', ['SSS'], { S: L.stoneBricks }, mc('stone_brick_slab', 6), 3),
  shaped('laje_tijolos', 'Laje de tijolos', 'acabamento', ['BBB'], { B: L.bricks }, mc('brick_slab', 6), 3),
  shaped('painel_vidro', 'Painel de vidro', 'acabamento', ['GGG', 'GGG'], { G: L.glass }, mc('glass_pane', 16), 3),
  shaped('grade_ferro', 'Grade de ferro', 'acabamento', ['III', 'III'], { I: L.iron }, mc('iron_bars', 16), 3),

  // ---- Peças de máquinas (3x3 na Mesa de trabalho) ----
  shaped('roda', 'Roda', 'maquinas', [' L ', 'LIL', ' L '], { L: 'log', I: L.iron }, lv(B.WHEEL, 2), 3),
  shaped('assento', 'Assento do piloto', 'maquinas', ['P  ', 'PP ', 'PIP'], { P: 'planks', I: L.iron }, lv(B.SEAT, 1), 3),
  shaped('motor', 'Motor', 'maquinas', ['SIS', 'KCK', 'SIS'], { S: L.steel, I: L.iron, K: L.copper, C: L.coal }, lv(B.MOTOR, 1), 3),
  shaped('helice', 'Hélice', 'maquinas', ['I I', ' L ', 'I I'], { I: L.iron, L: 'log' }, lv(B.PROPELLER, 1), 3),
  shaped('asa', 'Asa', 'maquinas', ['PPP', 'PPP'], { P: 'planks' }, lv(B.WING + 1, 2), 3),
  shaped('propulsor', 'Propulsor', 'maquinas', [' S ', 'SCS', ' K '], { S: L.steel, C: L.crystal, K: L.coal }, lv(B.THRUSTER, 1), 3),
  shaped('giroscopio', 'Giroscópio', 'maquinas', [' K ', 'KCK', ' K '], { K: L.copper, C: L.crystal }, lv(B.GYRO, 1), 3),
  shaped('balao', 'Balão', 'maquinas', ['PPP', 'P P', ' C '], { P: 'planks', C: L.coal }, lv(B.BALLOON, 1), 3),
  shaped('canhao', 'Canhão', 'maquinas', ['SSS', 'CS ', 'S  '], { S: L.steel, C: L.coal }, lv(B.CANNON, 1), 3),
  shaped('dinamite', 'Dinamite', 'maquinas', ['SCS', 'CAC', 'SCS'], { S: L.sand, C: L.coal, A: L.ash }, lv(B.DYNAMITE, 2), 3),
].filter(Boolean);

export const RECIPE_BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

// ---- Fundição na fornalha -------------------------------------------------------------------------------------------
export const SMELT_RECIPES = [
  { id: 'smelt_glass', nome: 'Vidro (areia)', input: L.sand, out: lv(B.GLASS, 1) },
  { id: 'smelt_bricks', nome: 'Tijolos (argila)', input: L.clay, out: lv(B.BRICKS, 1) },
  { id: 'smelt_steel', nome: 'Chapa de aço (ferro)', input: L.iron, out: lv(B.STEEL, 1) },
  { id: 'smelt_stone_bricks', nome: 'Pedra talhada (pedra)', input: L.stone, out: lv(B.STONE_BRICKS, 1) },
  { id: 'smelt_coal', nome: 'Carvão (tronco)', input: 'log', out: lv(B.COAL_ORE, 1) },
  { id: 'smelt_lamp', nome: 'Lanterna (ouro)', input: L.gold, out: lv(B.LAMP, 1) },
];

export function fuelYield(b, s = 0) {
  if (s === 0 && b === B.COAL_ORE) return 8;
  if (matchesTag(b, s, 'log')) return 4;
  if (matchesTag(b, s, 'planks')) return 2;
  return 0;
}

export function matchSmelt(cell) {
  if (!cell) return null;
  for (const r of SMELT_RECIPES) {
    if (matchesIngredient(cell, r.input)) return r;
  }
  return null;
}

// ---- Verificação de grade (2x2 ou 3x3) ------------------------------------------------------------------------------
function matchShapedAt(cells, size, recipe, flipX) {
  let minR = size, maxR = -1, minC = size, maxC = -1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (cells[r * size + c]) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR < 0) return false;
  const h = recipe.shape.length, w = Math.max(...recipe.shape.map((row) => row.length));
  if (maxR - minR + 1 !== h || maxC - minC + 1 !== w) return false;
  for (let r = 0; r < h; r++) {
    const row = recipe.shape[r];
    for (let c = 0; c < w; c++) {
      const ch = row[flipX ? w - 1 - c : c] || ' ';
      const cell = cells[(minR + r) * size + (minC + c)];
      if (ch === ' ') {
        if (cell) return false;
      } else {
        if (!matchesIngredient(cell, recipe.key[ch])) return false;
      }
    }
  }
  return true;
}

function matchShapeless(filled, ingredients) {
  if (filled.length !== ingredients.length) return false;
  const used = new Uint8Array(filled.length);
  const dfs = (i) => {
    if (i === ingredients.length) return true;
    for (let j = 0; j < filled.length; j++) {
      if (used[j] || !matchesIngredient(filled[j], ingredients[i])) continue;
      used[j] = 1;
      if (dfs(i + 1)) return true;
      used[j] = 0;
    }
    return false;
  };
  return dfs(0);
}

export function matchGrid(rawCells, size = 3) {
  if (!Array.isArray(rawCells) || rawCells.length !== size * size) return null;
  const cells = rawCells.map((c) => (Array.isArray(c) && c[0] > 0 ? [c[0] | 0, (c[1] | 0) || 0] : null));
  const filled = cells.filter(Boolean);
  if (!filled.length) return null;
  for (const recipe of RECIPES) {
    if (recipe.size > size) continue;
    const hit = recipe.type === 'shaped'
      ? matchShapedAt(cells, size, recipe, false) || matchShapedAt(cells, size, recipe, true)
      : matchShapeless(filled, recipe.ingredients);
    if (!hit) continue;
    const counts = new Map();
    for (const [b, s] of filled) {
      const k = b * 65536 + s;
      const cur = counts.get(k);
      if (cur) cur.n++;
      else counts.set(k, { b, s, n: 1 });
    }
    return { recipe, out: { ...recipe.out }, consume: [...counts.values()] };
  }
  return null;
}

// Quantidade disponível de cada item na mochila
function bagCounts(bag) {
  const list = [];
  for (const e of bag || []) {
    if (!e || !(e[2] > 0)) continue;
    const hit = list.find((x) => x.b === e[0] && x.s === e[1]);
    if (hit) hit.n += e[2];
    else list.push({ b: e[0], s: e[1], n: e[2] });
  }
  return list;
}

function pickFromBag(avail, ing) {
  for (const item of avail) {
    if (item.n > 0 && matchesIngredient([item.b, item.s], ing)) {
      item.n--;
      return [item.b, item.s];
    }
  }
  return null;
}

export function canCraftRecipe(recipe, bag) {
  if (!recipe || !Array.isArray(bag)) return false;
  const avail = bagCounts(bag);
  if (recipe.type === 'shaped') {
    for (const row of recipe.shape) {
      for (const ch of row) {
        if (ch === ' ') continue;
        if (!pickFromBag(avail, recipe.key[ch])) return false;
      }
    }
    return true;
  }
  for (const ing of recipe.ingredients) {
    if (!pickFromBag(avail, ing)) return false;
  }
  return true;
}

// Monta a grade (size x size) para uma receita usando os itens da mochila (ou null se faltar algo).
export function fillRecipeGrid(recipe, bag, size = 3) {
  if (!recipe || recipe.size > size || !Array.isArray(bag)) return null;
  const avail = bagCounts(bag);
  const grid = new Array(size * size).fill(0);
  if (recipe.type === 'shaped') {
    for (let r = 0; r < recipe.shape.length; r++) {
      const row = recipe.shape[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === ' ') continue;
        const picked = pickFromBag(avail, recipe.key[ch]);
        if (!picked) return null;
        grid[r * size + c] = picked;
      }
    }
    return grid;
  }
  for (let i = 0; i < recipe.ingredients.length; i++) {
    const picked = pickFromBag(avail, recipe.ingredients[i]);
    if (!picked) return null;
    grid[i] = picked;
  }
  return grid;
}

// Quantas vezes dá para fabricar um conjunto de consumos `consume` ({b, s, n}) com a mochila `bag` (limitado ao teto).
export function maxCraftTimes(consume, bag, maxOut = STACK) {
  if (!consume.length || !Array.isArray(bag)) return 0;
  const avail = bagCounts(bag);
  let best = maxOut;
  for (const req of consume) {
    const found = avail.find((x) => x.b === req.b && x.s === req.s);
    const have = found ? found.n : 0;
    best = Math.min(best, Math.floor(have / req.n));
  }
  return Math.max(0, best);
}

export function ingredientLabel(ing) {
  if (ing === 'log') return 'Tronco';
  if (ing === 'planks') return 'Tábuas';
  if (ing === 'stone') return 'Pedra';
  if (Array.isArray(ing)) return ingredientLabel(ing[0]);
  return itemName(ing.b, ing.s || 0);
}

export function recipeIngredientsSummary(recipe) {
  const list = [];
  const push = (ing) => {
    const label = ingredientLabel(ing);
    const ex = list.find((x) => x.label === label);
    if (ex) ex.n++;
    else {
      const rep = typeof ing === 'string'
        ? (ing === 'log' ? L.log : ing === 'planks' ? L.planks : L.stone)
        : Array.isArray(ing) ? ing[0] : ing;
      list.push({ label, b: rep.b, s: rep.s || 0, n: 1 });
    }
  };
  if (recipe.type === 'shaped') {
    for (const row of recipe.shape) for (const ch of row) if (ch !== ' ') push(recipe.key[ch]);
  } else {
    for (const ing of recipe.ingredients) push(ing);
  }
  return list;
}

export const BLOCK_NAME_OF = (b, s = 0) => (s >= MC_BASE ? itemName(b, s) : BLOCKS[b]?.name || itemName(b, s));
