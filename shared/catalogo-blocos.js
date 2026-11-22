// LAVRA — catálogo único dos blocos que se colocam (painel de blocos, tecla E; pedido do Kadmus, 22/11/2026: "o painel
// de blocos está ruim demais, principalmente no modo criativo").
// Antes havia dois catálogos: "Tudo" (79 blocos do jogo) e uma aba Minecraft à parte, cortada em 180, em ordem
// alfabética do nome em inglês. Aqui os dois viram uma lista só, nas MESMAS categorias, com os parentes juntos
// (a família de cada madeira, as 16 cores em ordem de arco-íris, a pedra com a sua escada, laje e muro).
// Módulo puro (sem DOM): a interface (src/ui/ui.js) e os testes leem daqui.
//
// Entrada do catálogo: { v, nome, cat, chave, mc, busca }
//   v      valor que vai na barra de atalhos: id do bloco do jogo, ou MC_BASE + estado padrão do bloco do Minecraft
//   nome   nome em português, como aparece na tela
//   cat    chave de CATEGORIAS
//   chave  identidade estável para favoritos e recentes: 'b<id>' (bloco do jogo) ou 'mc:<nome em inglês>'
//   mc     true para bloco do Minecraft
//   busca  texto normalizado (sem acento, minúsculo) onde a busca procura: nome, nome em inglês, apelidos e categoria

import { BLOCKS, PALETTE, IS_GLASS, BASE, B } from './blocks.js';
import { MC_BLOCOS, MC_BASE, MC_CLASSE, mcEstado } from './mc-estados.js';
import { mcPadrao } from './mc-colocar.js';
import { mcNomePt, mcNorm } from './mc-nomes.js';

// [chave, rótulo]. 'tudo', 'favoritos', 'recentes' e 'minecraft' não são categorias de bloco: são filtros.
export const CATEGORIAS = [
  ['natureza', 'Natureza'], ['madeira', 'Madeira'], ['pedra', 'Pedra e obra'], ['cor', 'Cores'], ['vidro', 'Vidro e luz'],
  ['planta', 'Plantas'], ['minerio', 'Minérios'], ['decor', 'Decoração'], ['mecanismo', 'Mecanismos'], ['maquina', 'Máquinas'],
];
export const FILTROS = [['tudo', 'Tudo'], ['favoritos', '★ Favoritos'], ['recentes', 'Recentes'], ...CATEGORIAS, ['minecraft', 'Minecraft']];
const ORDEM_CAT = new Map(CATEGORIAS.map(([k], i) => [k, i]));
const ROTULO = new Map(FILTROS);

// os mesmos blocos que a aba Minecraft antiga escondia (ui/mc-paleta.js → ESCONDE): versões de parede, pedaços de
// planta, peças internas. O teste confere que as duas expressões são iguais.
export const MC_ESCONDE = /(^|_)wall_(torch|sign|hanging_sign|banner|head|skull|fan)$|_plant$|^(moving_piston|piston_head|attached_.*_stem|tall_seagrass|frosted_ice|bubble_column|end_gateway|end_portal|nether_portal|fire|soul_fire)$|^(potted_|infested_)/;

const CORES = ['white', 'light_gray', 'gray', 'black', 'brown', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'light_blue', 'blue', 'purple', 'magenta', 'pink'];
const TINGIDOS = ['wool', 'carpet', 'concrete', 'concrete_powder', 'terracotta', 'glazed_terracotta', 'stained_glass', 'stained_glass_pane', 'candle', 'candle_cake', 'bed', 'banner', 'shulker_box'];
const MADEIRAS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak', 'bamboo', 'crimson', 'warped'];
// ordem das peças dentro da família de uma madeira
const PECAS_MADEIRA = ['log', 'stem', 'block', 'stripped_log', 'stripped_stem', 'stripped_block', 'wood', 'hyphae', 'stripped_wood', 'stripped_hyphae', 'planks', 'mosaic', 'stairs', 'mosaic_stairs', 'slab', 'mosaic_slab', 'fence', 'fence_gate', 'door', 'trapdoor', 'pressure_plate', 'button', 'sign', 'hanging_sign', 'shelf'];
const RE_COR = new RegExp(`^(${CORES.join('|')})_(${TINGIDOS.join('|')})$`);
const RE_MADEIRA = new RegExp(`^(stripped_)?(${[...MADEIRAS].sort((a, b) => b.length - a.length).join('|')})_(.+)$`);

const RE_PLANTA = /(_leaves|_sapling|_propagule|_tulip|_orchid|_bluet|_daisy|_rose|_bush|_blossom|eyeblossom|_petals|wildflowers|_fungus|_roots|_vines?$|_lichen|_sprouts|_wart$|_crop$|_mushroom$|_mushroom_block$|mushroom_stem|coral|dripleaf|_pickle|_litter|^(dandelion|poppy|allium|cornflower|lily_of_the_valley|lily_pad|torchflower|sunflower|lilac|peony|pitcher_plant|short_grass|tall_grass|grass|fern|large_fern|dead_bush|bush|vine|azalea|flowering_azalea|moss_block|moss_carpet|pale_moss_block|pale_moss_carpet|pale_hanging_moss|cactus|cactus_flower|sugar_cane|bamboo|bamboo_sapling|kelp|seagrass|wheat|carrots|potatoes|beetroots|cocoa|melon|pumpkin|carved_pumpkin|hay_block|nether_wart_block|warped_wart_block|short_dry_grass|tall_dry_grass|hanging_roots|big_dripleaf|small_dripleaf|glow_lichen|melon_stem|pumpkin_stem|big_dripleaf_stem|chorus_flower|dried_kelp_block)$)/;
const RE_MINERIO = /(_ore$|^raw_.*_block$|^(coal|iron|gold|diamond|emerald|lapis|redstone|netherite|copper|amethyst)_block$|^(budding_amethyst|amethyst_cluster|large_amethyst_bud|medium_amethyst_bud|small_amethyst_bud|ancient_debris|gilded_blackstone)$)/;
const RE_LUZ = /(^glass$|^glass_pane$|^tinted_glass$|torch$|lantern$|^glowstone$|^shroomlight$|_froglight$|^end_rod$|campfire$|^candle$|^redstone_lamp$|^beacon$|copper_bulb$|^sea_lantern$)/;
const RE_MECANISMO = /(_button$|_pressure_plate$|rail$|^lever$|^repeater$|^comparator$|^redstone_wire$|^redstone_torch$|piston$|^observer$|^dispenser$|^dropper$|^hopper$|^daylight_detector$|^tripwire|^target$|^note_block$|^tnt$|sculk_sensor$|^sculk_shrieker$|^sculk_catalyst$|^lightning_rod$|command_block$|^structure_block$|^jigsaw$|^test_block$|^test_instance_block$|^crafter$|^iron_door$|^iron_trapdoor$|copper_door$|copper_trapdoor$|^slime_block$|^honey_block$)/;
const RE_NATUREZA = /^(dirt|coarse_dirt|rooted_dirt|grass_block|podzol|mycelium|dirt_path|farmland|mud|clay|sand|red_sand|gravel|suspicious_sand|suspicious_gravel|snow|snow_block|powder_snow|ice|packed_ice|blue_ice|stone|cobblestone|mossy_cobblestone|granite|diorite|andesite|deepslate|cobbled_deepslate|tuff|calcite|dripstone_block|pointed_dripstone|basalt|smooth_basalt|blackstone|obsidian|crying_obsidian|netherrack|soul_sand|soul_soil|end_stone|magma_block|bedrock|sculk|sponge|wet_sponge|bone_block|crimson_nylium|warped_nylium|frogspawn|turtle_egg|sniffer_egg|muddy_mangrove_roots|cobweb|reinforced_deepslate|sculk_vein|resin_clump)$/;
const RE_OBRA = /(bricks?(_|$)|tiles?(_|$)|^polished_|^cut_|^chiseled_|^smooth_|^cracked_|^mossy_|_stairs$|_slab$|_wall$|sandstone|quartz|purpur|prismarine|^terracotta$|copper|^packed_mud$|^resin_block$|_pillar$)/;

// categoria de um bloco do Minecraft pelo nome em inglês (a primeira regra que casar vale)
export function categoriaMc(n) {
  if (RE_COR.test(n)) return 'cor';
  if (RE_NATUREZA.test(n)) return 'natureza';                    // antes da madeira: "crimson_nylium" é chão, não tábua
  if (RE_PLANTA.test(n)) return 'planta';
  if (RE_MINERIO.test(n)) return 'minerio';
  if (RE_LUZ.test(n)) return 'vidro';
  if (RE_MADEIRA.test(n)) return 'madeira';
  if (RE_MECANISMO.test(n)) return 'mecanismo';
  if (/bookshelf$/.test(n)) return 'decor';
  if (RE_OBRA.test(n)) return 'pedra';
  return 'decor';
}

// família e posição dentro dela, para os parentes ficarem lado a lado na grade
const PREFIXOS = /^(waxed_)?(exposed_|weathered_|oxidized_)?(polished_|cut_|chiseled_|smooth_|cracked_|mossy_|cobbled_)?/;
const SUFIXOS = [['_stairs', 3], ['_slab', 4], ['_wall', 5], ['_pillar', 2], ['_door', 6], ['_trapdoor', 7], ['_grate', 8], ['_bulb', 9]];
function ordemMc(n, cat) {
  if (cat === 'cor') { const m = RE_COR.exec(n); return [String(TINGIDOS.indexOf(m[2])).padStart(2, '0'), CORES.indexOf(m[1])]; }
  if (cat === 'madeira') {
    const m = RE_MADEIRA.exec(n) || [0, n.startsWith('stripped_') ? 'stripped_' : '', 'bamboo', 'block'];
    const peca = (m[1] || '') + m[3], i = PECAS_MADEIRA.indexOf(peca);
    return [String(MADEIRAS.indexOf(m[2])).padStart(2, '0'), i < 0 ? 90 : i];
  }
  if (cat === 'pedra') {
    let base = n, lugar = 0;
    for (const [s, k] of SUFIXOS) if (base.endsWith(s)) { base = base.slice(0, -s.length); lugar = k; break; }
    const pre = PREFIXOS.exec(base);
    const tipo = pre[3] ? ['polished_', 'cut_', 'chiseled_', 'smooth_', 'cracked_', 'mossy_', 'cobbled_'].indexOf(pre[3]) + 1 : 0;
    const idade = pre[2] ? ['exposed_', 'weathered_', 'oxidized_'].indexOf(pre[2]) + 1 : 0;
    base = base.slice(pre[0].length).replace(/_(bricks?|tiles?|block)$/, (s) => { lugar += s.includes('brick') ? 20 : s.includes('tile') ? 40 : 0; return ''; });
    if (/^red_/.test(base) && /sandstone|nether/.test(base)) base = base.slice(4) + '~vermelho';
    return [base, (pre[1] ? 1000 : 0) + idade * 200 + tipo * 60 + lugar];
  }
  const grupos = cat === 'planta' ? G_PLANTA : cat === 'natureza' ? G_NATUREZA : cat === 'minerio' ? G_MINERIO : null;
  let g = 99;
  if (grupos) { g = grupos.findIndex((re) => re.test(n)); if (g < 0) g = 98; }
  return [String(g).padStart(2, '0') + mcNorm(mcNomePt(n)), 0];
}
// tipos dentro de uma categoria, na ordem em que aparecem (o primeiro que casar)
const G_PLANTA = [/_leaves$/, /_sapling$|_propagule$/, /^(short_grass|tall_grass|grass|fern|large_fern|short_dry_grass|tall_dry_grass|dead_bush|bush|firefly_bush|sweet_berry_bush|leaf_litter)$/,
  /tulip|orchid|bluet|daisy|rose|blossom|petals|wildflowers|^(dandelion|poppy|allium|cornflower|lily_of_the_valley|torchflower|sunflower|lilac|peony|pitcher_plant|cactus_flower|chorus_flower)$/,
  /azalea|moss|vine|lichen|_roots$/, /mushroom|fungus|wart|sprouts/, /^(wheat|carrots|potatoes|beetroots|cocoa|melon|pumpkin|carved_pumpkin|hay_block|melon_stem|pumpkin_stem|pitcher_crop|torchflower_crop|sugar_cane|cactus|bamboo)$/,
  /coral/, /kelp|seagrass|pickle|lily_pad|dripleaf/];
const G_NATUREZA = [/dirt|grass_block|podzol|mycelium|farmland|^mud$|clay|nylium|roots/, /sand|gravel/, /^(stone|cobblestone|mossy_cobblestone|granite|diorite|andesite|tuff|calcite|dripstone_block|pointed_dripstone)$/,
  /deepslate|basalt|blackstone|obsidian|bedrock/, /snow|ice/, /netherrack|soul_|magma|end_stone/, /sculk|sponge|bone|egg|frogspawn|cobweb|resin/];
const G_MINERIO = [/_ore$/, /^raw_/, /_block$/, /amethyst/];

const chaveNativa = (id) => 'b' + id;
function catNativa(id) {
  const g = BLOCKS[id].group;
  if (IS_GLASS[id] || id === B.LAMP) return 'vidro';
  if (id === B.LEAVES || id === B.PINE_LEAVES || id === B.CACTUS) return 'planta';
  if (/^água mística$/i.test(BLOCKS[id].name)) return 'natureza';
  if (g === 'obra') return 'pedra';
  if (g === 'minério') return 'minerio';
  if (g === 'máquina') return 'maquina';
  return ORDEM_CAT.has(g) ? g : g === 'planta' ? 'planta' : 'decor';
}

let lista = null, porChave = null;
// A lista inteira, já na ordem de mostrar: categoria por categoria; dentro de cada uma, os blocos do jogo primeiro e
// depois os do Minecraft por família. `comMc = false` devolve só os do jogo (enquanto o pacote do Minecraft não chega).
export function catalogo(comMc = true) {
  if (!lista) {
    const nat = PALETTE.map((id, i) => ({ v: id, nome: BLOCKS[id].name, cat: catNativa(id), chave: chaveNativa(id), mc: false, o: ['', i] }));
    const mc = MC_BLOCOS.filter((b) => !MC_ESCONDE.test(b.n) && MC_CLASSE[b.s] <= 2).map((b) => {
      const cat = categoriaMc(b.n);
      return { v: mcPadrao(b.n), nome: mcNomePt(b.n), cat, chave: 'mc:' + b.n, mc: true, en: b.n, o: ordemMc(b.n, cat) };
    }).filter((e) => e.v >= MC_BASE);
    lista = [...nat, ...mc];
    for (const e of lista) e.busca = mcNorm(`${e.nome} ${e.en || ''} ${ROTULO.get(e.cat)} ${e.mc ? 'minecraft' : ''}`);
    lista.sort((a, b) => ORDEM_CAT.get(a.cat) - ORDEM_CAT.get(b.cat) || (a.mc ? 1 : 0) - (b.mc ? 1 : 0)
      || (a.o[0] < b.o[0] ? -1 : a.o[0] > b.o[0] ? 1 : 0) || a.o[1] - b.o[1] || (a.nome < b.nome ? -1 : a.nome > b.nome ? 1 : 0));
    lista.forEach((e, i) => { e.i = i; delete e.o; });
    porChave = new Map(lista.map((e) => [e.chave, e]));
  }
  return comMc ? lista : lista.filter((e) => !e.mc);
}

// a entrada de um valor da barra (qualquer estado de um bloco do Minecraft cai na entrada do bloco)
export function chaveDe(v) {
  if (!(v > 0)) return '';
  if (v >= MC_BASE) { const e = mcEstado(v - MC_BASE); return e && e.nome ? 'mc:' + e.nome : ''; }
  return BLOCKS[v] ? chaveNativa(BASE[v] || v) : '';
}
export function entradaDe(v) { catalogo(); return porChave.get(chaveDe(v)) || null; }
export function entradaDaChave(k) { catalogo(); return porChave.get(k) || null; }

// Filtra a lista. filtro = chave de FILTROS; texto = o que foi digitado; favoritos/recentes = listas de chaves.
// Com texto, a busca vale no catálogo inteiro (o filtro de categoria é ignorado: quem digita quer achar, não navegar),
// cada palavra tem de aparecer, e o que COMEÇA com o texto vem antes.
export function filtrar({ filtro = 'tudo', texto = '', favoritos = [], recentes = [], comMc = true } = {}) {
  const todos = catalogo(comMc);
  const q = mcNorm(texto);
  if (q) {
    const palavras = q.split(' ');
    const achados = todos.filter((e) => palavras.every((p) => e.busca.includes(p)));
    // nome igual → palavra inteira no começo ("lã" antes de "laje") → começa com → alguma palavra começa com → contém → resto
    const peso = (e) => {
      const n = mcNorm(e.nome);
      if (n === q) return 0;
      const ps = n.split(' ');
      if (ps[0] === palavras[0]) return 1;
      if (n.startsWith(q)) return 2;
      if (palavras.every((p) => ps.some((w) => w.startsWith(p)))) return 3;
      return n.includes(q) ? 4 : 5;
    };
    return achados.map((e) => [peso(e), e]).sort((a, b) => a[0] - b[0] || a[1].i - b[1].i).map((x) => x[1]);
  }
  if (filtro === 'favoritos' || filtro === 'recentes') {
    const out = [];
    for (const k of filtro === 'favoritos' ? favoritos : recentes) { const e = entradaDaChave(k); if (e && (comMc || !e.mc)) out.push(e); }
    return filtro === 'favoritos' ? out.sort((a, b) => a.i - b.i) : out;
  }
  if (filtro === 'minecraft') return todos.filter((e) => e.mc);
  if (filtro === 'tudo') return todos;
  return todos.filter((e) => e.cat === filtro);
}

// quantos blocos há em cada filtro (para o rótulo das abas)
export function contagens(comMc = true) {
  const c = { tudo: 0, minecraft: 0 };
  for (const e of catalogo(comMc)) { c.tudo++; if (e.mc) c.minecraft++; c[e.cat] = (c[e.cat] || 0) + 1; }
  return c;
}
