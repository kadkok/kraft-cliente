// LAVRA — mapeamento acústico de materiais para todos os blocos (nativos e Minecraft 1.21.8).
// Puro: compartilhado entre cliente e testes.
import { MC_BASE, mcEstado, MC_N } from './mc-estados.js';

const RULES = [
  [/(water|kelp|seagrass|bubble_column)/, 'water'],
  [/(leaves|vine|azalea|moss|lily_pad|fern|sapling|bush|roots|sprouts|dripleaf)/, 'leaves'],
  [/(flower|tulip|orchid|daisy|dandelion|poppy|allium|bluet|cornflower|rose|peony|lilac|sunflower|grass|wheat|carrot|potato|beetroot|sugar_cane|bamboo|cactus|mushroom|fungus|wart|crop)/, 'plant'],
  [/(snow|powder_snow|ice_?packed)/, 'snow'],
  [/(glass|ice|amethyst|crystal|lantern|sea_lantern|glowstone|beacon|frosted_ice)/, 'glass'],
  [/(sand|red_sand|soul_sand|concrete_powder|ash)/, 'sand'],
  [/(gravel|cobble|cobbled)/, 'gravel'],
  [/(iron|gold|copper|netherite|anvil|chain|hopper|cauldron|bell|rail|lightning_rod|heavy_core|comparator|repeater)/, 'metal'],
  [/(planks|log|wood|stem|hyphae|oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|crimson|warped|pale_oak|chest|barrel|bookshelf|crafting|lectern|loom|composter|ladder|sign|door|trapdoor|fence|gate|scaffolding|beehive|bee_nest|jukebox|note_block|bed|wool|carpet)/, 'wood'],
  [/(dirt|mud|clay|farmland|mycelium|podzol|soul_soil|coarse_dirt|rooted_dirt)/, 'dirt'],
  [/(grass_block)/, 'grass'],
];

/**
 * Retorna a chave de material acústico ('stone', 'wood', 'sand', 'glass', 'metal', etc.)
 * para um bloco do LAVRA ou do Minecraft.
 */
export function mcSoundOf(name) {
  if (!name) return 'stone';
  if (name === 'grass_block' || name === 'short_grass' || name === 'tall_grass') return 'grass';
  for (const [re, mat] of RULES) if (re.test(name)) return mat;
  return 'stone';
}

export function soundOfBlock(BLOCKS, id, miniState = 0) {
  if (miniState >= MC_BASE && miniState < MC_BASE + MC_N) {   // só estado MC (a visão unilateral mora acima)
    try {
      const st = mcEstado(miniState - MC_BASE);
      if (st?.nome) return mcSoundOf(st.nome);
    } catch { /* estado fora do intervalo: cai no bloco base */ }
  }
  return BLOCKS?.[id]?.sound || 'stone';
}
