// LAVRA — registro de blocos e de camadas de textura.
// Dado puro, usado igual por cliente, worker e servidor.

export const K_AIR = 0;     // vazio
export const K_CUBE = 1;    // cubo opaco
export const K_CUTOUT = 2;  // cubo com recorte (folhagem, vidro)
export const K_CROSS = 3;   // planta em X (dois planos cruzados)
export const K_LIQUID = 4;  // água
export const K_MODEL = 5;   // peça com geometria própria (roda, asa, hélice...)

// Camadas do array de texturas. A ORDEM importa: o shader descobre a classe de
// tinta só comparando o índice da camada com os limites abaixo.
export const GLASS_TEXTURES = ['glass','glass_smoke','glass_gold','glass_silver','glass_mirror','glass_blue','glass_red'];
export const TEXTURES = [
  // classe 0 — sem tinta (opacos; alpha < 1 = emissivo)
  'bedrock', 'stone', 'dirt', 'sand', 'gravel', 'clay', 'snow', 'ice',
  'log_side', 'log_top', 'pine_side', 'pine_top', 'planks', 'pine_planks',
  'stone_bricks', 'bricks', 'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore',
  'crystal_ore', 'lamp', 'sandstone', 'cactus_side', 'cactus_top', 'basalt',
  'marble', 'concrete', 'roof', 'steel', 'gold_block',
  'plaster_white', 'plaster_red', 'plaster_yellow', 'plaster_green', 'plaster_blue', 'plaster_dark',
  'engine_side', 'engine_top', 'thruster_side', 'thruster_nozzle', 'thruster_front', 'gyro',
  'dynamite_side', 'dynamite_top', 'metal_dark', 'tire', 'hubcap', 'wing', 'seat', 'balloon', 'blade',
  'shadow_stone', 'ash', 'phantom_crystal', 'mystic_water',
  'magma',   // 19/11: crosta de lava com frestas acesas (ilha do vulcão); camada nova entra no fim da classe
  // classe 0 — sem tinta (recorte; alpha = cobertura)
  ...GLASS_TEXTURES, 'portal', 'flower_yellow', 'flower_red', 'flower_blue', 'flower_white', 'dry_shrub', 'reeds',
  // classe 1 — tinta de grama só onde a máscara (alpha) manda
  'grass_side',
  // classe 2 — tinta de grama em tudo
  'grass_top', 'tall_grass', 'fern',
  // classe 3 — tinta de folhagem em tudo
  'leaves', 'pine_leaves', 'sakura',
];
export const TEX_INDEX = Object.fromEntries(TEXTURES.map((n, i) => [n, i]));
export const TINT_B0 = TEX_INDEX.grass_side;  // início da classe 1
export const TINT_C0 = TEX_INDEX.grass_top;   // início da classe 2
export const TINT_D0 = TEX_INDEX.leaves;      // início da classe 3

export const B = {
  AIR: 0, BEDROCK: 1, STONE: 2, DIRT: 3, GRASS: 4, SAND: 5, GRAVEL: 6, CLAY: 7,
  SNOW: 8, ICE: 9, WATER: 10, LOG: 11, LEAVES: 12, PINE_LOG: 13, PINE_LEAVES: 14,
  PLANKS: 15, STONE_BRICKS: 16, BRICKS: 17, GLASS: 18, COAL_ORE: 19, IRON_ORE: 20,
  COPPER_ORE: 21, GOLD_ORE: 22, CRYSTAL_ORE: 23, LAMP: 24, SANDSTONE: 25, CACTUS: 26,
  TALL_GRASS: 27, FERN: 28, FLOWER_YELLOW: 29, FLOWER_RED: 30, FLOWER_BLUE: 31,
  FLOWER_WHITE: 32, DRY_SHRUB: 33, REEDS: 34, BASALT: 35, MARBLE: 36, CONCRETE: 37,
  ROOF: 38, STEEL: 39, GOLD_BLOCK: 40, PINE_PLANKS: 41,
  PLASTER_WHITE: 42, PLASTER_RED: 43, PLASTER_YELLOW: 44, PLASTER_GREEN: 45,
  PLASTER_BLUE: 46, PLASTER_DARK: 47,
  // peças funcionais (as direcionais ocupam um id por orientação)
  MOTOR: 48, GYRO: 49, DYNAMITE: 50, BALLOON: 51,
  THRUSTER: 52,   // 52..57  empuxo para +X -X +Y -Y +Z -Z
  PROPELLER: 58,  // 58..63
  CANNON: 64,     // 64..69
  WHEEL: 70,      // 70 eixo X, 71 eixo Z
  WING: 72,       // 72 normal X, 73 normal Y, 74 normal Z
  SEAT: 75,       // 75..78  frente para +X -X +Z -Z
  // Zona Fantasma e coisas místicas
  SHADOW_STONE: 79, ASH: 80, PHANTOM_CRYSTAL: 81, PORTAL: 82, MYSTIC_WATER: 83,
  // água corrente: altura em oitavos, de 1 (fio d'água) a 7 (quase cheia); só a lei da água (water.js) põe e tira
  FLOW_1: 84, FLOW_2: 85, FLOW_3: 86, FLOW_4: 87, FLOW_5: 88, FLOW_6: 89, FLOW_7: 90,
  GLASS_SMOKE: 91, GLASS_GOLD: 92, GLASS_SILVER: 93, GLASS_MIRROR: 94, GLASS_BLUE: 95, GLASS_RED: 96,
  ROOT: 97, PINE_ROOT: 98,
  STAIR_PLANKS: 99, STAIR_PINE: 100, STAIR_STONE: 101, STAIR_STONE_BRICKS: 102,
  STAIR_BRICKS: 103, STAIR_MARBLE: 104, STAIR_SANDSTONE: 105, STAIR_CONCRETE: 106,
  // blocos do Minecraft (docs/plano-blocos-minecraft.md): o id diz só a classe; o bloco e o estado exatos moram no
  // mapa `minis` da célula (valor MC_BASE + n, shared/mc-estados.js)
  MC_SOLIDO: 107, MC_RECORTE: 108, MC_FORMA: 109,
  // profundidade em dobro (19/11): rocha profunda abaixo da rocha de hoje e pedras preciosas brutas, só no subsolo novo
  // (shared/minerios.js: faixas de fundura, raridade e valor). Camadas de textura emprestadas até o Astra desenhar as
  // próprias (contrato no topo de shared/minerios.js).
  DEEP_STONE: 110, SAPPHIRE_ORE: 111, EMERALD_ORE: 112, RUBY_ORE: 113, DIAMOND_ORE: 114,
  MAGMA: 115, SUPER_BOMBA: 116, SAKURA: 117,
  VISAO: 126,   // visão unilateral (23/11): por fora a face do bloco escolhido, por dentro transparente (shared/minis.js → VISAO_BASE)   // crosta de lava com frestas acesas: o lago da cratera e os veios do vulcão (shared/ilhas.js)
};

export const GLASS_IDS = [B.GLASS,B.GLASS_SMOKE,B.GLASS_GOLD,B.GLASS_SILVER,B.GLASS_MIRROR,B.GLASS_BLUE,B.GLASS_RED];
export const STAIR_IDS = [
  B.STAIR_PLANKS, B.STAIR_PINE, B.STAIR_STONE, B.STAIR_STONE_BRICKS,
  B.STAIR_BRICKS, B.STAIR_MARBLE, B.STAIR_SANDSTONE, B.STAIR_CONCRETE,
];
export const BLOCK_COUNT = 118;
const N = 128; // folga para os arrays tipados
export const IS_GLASS = new Uint8Array(N);
for (const id of GLASS_IDS) IS_GLASS[id] = 1;
export const IS_STAIR = new Uint8Array(N);
for (const id of STAIR_IDS) IS_STAIR[id] = 1;

export const KIND = new Uint8Array(N);
export const OPAQUE = new Uint8Array(N);       // bloqueia luz e esconde a face vizinha
export const SOLID = new Uint8Array(N);        // colide com o jogador
export const EMIT = new Uint8Array(N);         // luz emitida (0..15)
export const SKY_DROP = new Uint8Array(N);     // atenuação extra da luz do céu
export const AO_OCC = new Uint8Array(N);       // escurece cantos (oclusão de ambiente)
export const REPLACEABLE = new Uint8Array(N);  // pode ser substituído ao colocar um bloco
export const TEX = new Uint8Array(N * 6);      // camada por face: +X -X +Y -Y +Z -Z
export const HARD = new Float32Array(N);       // segundos para quebrar à mão
export const BLOCKS = new Array(N).fill(null); // metadados para a interface
export const MASS = new Float32Array(N);       // massa do bloco numa máquina (água = 1)
export const NATURAL = new Uint8Array(N);      // terreno: nunca entra numa máquina
export const FUNC = new Uint8Array(N);         // função da peça (F_*)
export const FACING = new Uint8Array(N).fill(255); // direção da peça: 0..5 = +X -X +Y -Y +Z -Z
export const BASE = new Uint8Array(N);         // id base (o que aparece na paleta)

export const F_NONE = 0, F_MOTOR = 1, F_GYRO = 2, F_DYNAMITE = 3, F_BALLOON = 4, F_THRUSTER = 5,
  F_PROPELLER = 6, F_CANNON = 7, F_WHEEL = 8, F_WING = 9, F_SEAT = 10;
export const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function def(id, o) {
  const kind = o.kind ?? K_CUBE;
  const opaque = o.opaque ?? (kind === K_CUBE);
  KIND[id] = kind;
  OPAQUE[id] = opaque ? 1 : 0;
  SOLID[id] = o.solid === false ? 0 : (kind === K_CUBE || kind === K_CUTOUT || kind === K_MODEL) ? 1 : 0;
  EMIT[id] = o.emit ?? 0;
  SKY_DROP[id] = o.skyDrop ?? 0;
  AO_OCC[id] = (opaque || o.aoOcc) ? 1 : 0;
  REPLACEABLE[id] = (kind === K_AIR || kind === K_CROSS || kind === K_LIQUID) ? 1 : 0;
  HARD[id] = o.hard ?? 1;
  MASS[id] = o.mass ?? 1.5;
  NATURAL[id] = o.natural ? 1 : 0;
  FUNC[id] = o.func ?? 0;
  FACING[id] = o.facing ?? 255;
  BASE[id] = o.base ?? id;
  const t = o.tex;
  if (t) {
    const side = TEX_INDEX[typeof t === 'string' ? t : t.side];
    const top = TEX_INDEX[typeof t === 'string' ? t : (t.top ?? t.side)];
    const bottom = TEX_INDEX[typeof t === 'string' ? t : (t.bottom ?? t.top ?? t.side)];
    if (side === undefined || top === undefined || bottom === undefined) {
      throw new Error('textura desconhecida no bloco ' + o.name);
    }
    TEX.set([side, side, top, bottom, side, side], id * 6);
  }
  if (o.faces) TEX.set(o.faces.map((n) => TEX_INDEX[n]), id * 6);
  BLOCKS[id] = {
    id,
    name: o.name,
    sound: o.sound ?? 'stone',
    placeable: o.placeable ?? true,
    drop: o.drop === undefined ? id : o.drop,
    group: o.group ?? 'natureza',
    ...(o.materialFamily ? {materialFamily:o.materialFamily} : {}),
  };
}

def(B.AIR, { natural: true, name: 'Ar', kind: K_AIR, hard: 0, placeable: false, drop: 0 });
def(B.SAKURA, { natural: true, name: 'Cerejeira em flor', kind: K_CUTOUT, tex: 'sakura', hard: 0.2, sound: 'leaves', skyDrop: 1 });
def(B.BEDROCK, { natural: true, name: 'Rocha-mãe', tex: 'bedrock', hard: Infinity, placeable: false, sound: 'stone' });
def(B.STONE, { natural: true, name: 'Pedra', tex: 'stone', hard: 1.4, sound: 'stone' });
def(B.DIRT, { natural: true, name: 'Terra', tex: 'dirt', hard: 0.5, sound: 'dirt' });
def(B.GRASS, { natural: true, name: 'Gramado', tex: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' }, hard: 0.6, sound: 'grass' });
def(B.SAND, { natural: true, name: 'Areia', tex: 'sand', hard: 0.45, sound: 'sand' });
def(B.GRAVEL, { natural: true, name: 'Cascalho', tex: 'gravel', hard: 0.55, sound: 'gravel' });
def(B.CLAY, { natural: true, name: 'Argila', tex: 'clay', hard: 0.6, sound: 'dirt' });
def(B.SNOW, { natural: true, name: 'Neve', tex: 'snow', hard: 0.3, sound: 'snow' });
def(B.ICE, { natural: true, name: 'Gelo', tex: 'ice', hard: 0.5, sound: 'glass' });
def(B.WATER, { natural: true, name: 'Água', kind: K_LIQUID, hard: 0, sound: 'water', drop: 0 });
def(B.LOG, { natural: true, name: 'Tronco', tex: { side: 'log_side', top: 'log_top' }, hard: 1.0, sound: 'wood', group: 'madeira' });
def(B.ROOT, { natural:true, name:'Raiz de árvore', tex:{side:'log_side',top:'log_top'}, hard:1.3, sound:'wood', group:'madeira' });
def(B.LEAVES, { natural: true, name: 'Folhagem', kind: K_CUTOUT, tex: 'leaves', hard: 0.2, sound: 'leaves', skyDrop: 1, aoOcc: true });
def(B.PINE_LOG, { natural: true, name: 'Tronco de pinheiro', tex: { side: 'pine_side', top: 'pine_top' }, hard: 1.0, sound: 'wood', group: 'madeira' });
def(B.PINE_ROOT, { natural:true, name:'Raiz de pinheiro', tex:{side:'pine_side',top:'pine_top'}, hard:1.3, sound:'wood', group:'madeira' });
def(B.PINE_LEAVES, { natural: true, name: 'Folhagem de pinheiro', kind: K_CUTOUT, tex: 'pine_leaves', hard: 0.2, sound: 'leaves', skyDrop: 1, aoOcc: true });
def(B.PLANKS, { mass: 0.6, name: 'Tábuas', tex: 'planks', hard: 0.8, sound: 'wood', group: 'madeira' });
def(B.PINE_PLANKS, { mass: 0.6, name: 'Tábuas de pinheiro', tex: 'pine_planks', hard: 0.8, sound: 'wood', group: 'madeira' });
def(B.STONE_BRICKS, { mass: 2.4, name: 'Pedra talhada', tex: 'stone_bricks', hard: 1.6, sound: 'stone', group: 'obra' });
def(B.BRICKS, { mass: 2.0, name: 'Tijolos', tex: 'bricks', hard: 1.6, sound: 'stone', group: 'obra' });
def(B.GLASS, { mass: 0.9, name: 'Vidro', kind: K_CUTOUT, tex: 'glass', hard: 0.3, sound: 'glass', group: 'obra' });
for (const [i,name] of ['Vidro fumê','Vidro dourado','Vidro prata','Vidro espelho','Vidro azul','Vidro vermelho'].entries()) {
  const id = GLASS_IDS[i+1];
  def(id, { mass:0.9, name, kind:K_CUTOUT, tex:GLASS_TEXTURES[i+1], hard:0.3, sound:'glass', materialFamily:'glass', group:'obra', skyDrop:id===B.GLASS_MIRROR?14:0 });
}
def(B.COAL_ORE, { natural: true, name: 'Carvão', tex: 'coal_ore', hard: 1.8, sound: 'stone', group: 'minério' });
def(B.IRON_ORE, { natural: true, name: 'Minério de ferro', tex: 'iron_ore', hard: 2.2, sound: 'stone', group: 'minério' });
def(B.COPPER_ORE, { natural: true, name: 'Minério de cobre', tex: 'copper_ore', hard: 2.0, sound: 'stone', group: 'minério' });
def(B.GOLD_ORE, { natural: true, name: 'Minério de ouro', tex: 'gold_ore', hard: 2.4, sound: 'stone', group: 'minério' });
def(B.CRYSTAL_ORE, { natural: true, name: 'Cristal', tex: 'crystal_ore', hard: 2.6, sound: 'glass', emit: 7, group: 'minério' });
def(B.LAMP, { mass: 0.7, name: 'Lanterna', tex: 'lamp', hard: 0.4, sound: 'glass', emit: 15, group: 'obra' });
def(B.SANDSTONE, { natural: true, name: 'Arenito', tex: 'sandstone', hard: 1.0, sound: 'stone' });
def(B.CACTUS, { natural: true, name: 'Cacto', tex: { side: 'cactus_side', top: 'cactus_top' }, hard: 0.4, sound: 'leaves' });
def(B.TALL_GRASS, { natural: true, name: 'Capim', kind: K_CROSS, tex: 'tall_grass', hard: 0, sound: 'plant', drop: 0, group: 'planta' });
def(B.FERN, { natural: true, name: 'Samambaia', kind: K_CROSS, tex: 'fern', hard: 0, sound: 'plant', group: 'planta' });
def(B.FLOWER_YELLOW, { natural: true, name: 'Flor amarela', kind: K_CROSS, tex: 'flower_yellow', hard: 0, sound: 'plant', group: 'planta' });
def(B.FLOWER_RED, { natural: true, name: 'Flor vermelha', kind: K_CROSS, tex: 'flower_red', hard: 0, sound: 'plant', group: 'planta' });
def(B.FLOWER_BLUE, { natural: true, name: 'Flor azul', kind: K_CROSS, tex: 'flower_blue', hard: 0, sound: 'plant', group: 'planta' });
def(B.FLOWER_WHITE, { natural: true, name: 'Flor branca', kind: K_CROSS, tex: 'flower_white', hard: 0, sound: 'plant', group: 'planta' });
def(B.DRY_SHRUB, { natural: true, name: 'Arbusto seco', kind: K_CROSS, tex: 'dry_shrub', hard: 0, sound: 'plant', group: 'planta' });
def(B.REEDS, { natural: true, name: 'Junco', kind: K_CROSS, tex: 'reeds', hard: 0, sound: 'plant', group: 'planta' });
def(B.BASALT, { natural: true, name: 'Basalto', tex: 'basalt', hard: 1.8, sound: 'stone' });
def(B.MARBLE, { mass: 2.6, name: 'Mármore', tex: 'marble', hard: 1.5, sound: 'stone', group: 'obra' });
def(B.CONCRETE, { mass: 2.3, name: 'Concreto', tex: 'concrete', hard: 1.5, sound: 'stone', group: 'obra' });
def(B.ROOF, { mass: 1.6, name: 'Telha', tex: 'roof', hard: 1.2, sound: 'stone', group: 'obra' });
def(B.STEEL, { mass: 3.2, name: 'Chapa de aço', tex: 'steel', hard: 3.0, sound: 'metal', group: 'obra' });
def(B.GOLD_BLOCK, { mass: 6.0, name: 'Bloco de ouro', tex: 'gold_block', hard: 2.5, sound: 'metal', group: 'obra' });
def(B.PLASTER_WHITE, { mass: 1.2, name: 'Reboco branco', tex: 'plaster_white', hard: 1.0, sound: 'stone', group: 'cor' });
def(B.PLASTER_RED, { mass: 1.2, name: 'Reboco vermelho', tex: 'plaster_red', hard: 1.0, sound: 'stone', group: 'cor' });
def(B.PLASTER_YELLOW, { mass: 1.2, name: 'Reboco amarelo', tex: 'plaster_yellow', hard: 1.0, sound: 'stone', group: 'cor' });
def(B.PLASTER_GREEN, { mass: 1.2, name: 'Reboco verde', tex: 'plaster_green', hard: 1.0, sound: 'stone', group: 'cor' });
def(B.PLASTER_BLUE, { mass: 1.2, name: 'Reboco azul', tex: 'plaster_blue', hard: 1.0, sound: 'stone', group: 'cor' });
def(B.PLASTER_DARK, { mass: 1.2, name: 'Reboco grafite', tex: 'plaster_dark', hard: 1.0, sound: 'stone', group: 'cor' });

const STAIR_DEFS = [
  [B.STAIR_PLANKS, 'Escada de tábuas', 'planks', 0.6, 0.8, 'wood', 'madeira'],
  [B.STAIR_PINE, 'Escada de pinheiro', 'pine_planks', 0.6, 0.8, 'wood', 'madeira'],
  [B.STAIR_STONE, 'Escada de pedra', 'stone', 1.8, 1.4, 'stone', 'obra'],
  [B.STAIR_STONE_BRICKS, 'Escada de pedra talhada', 'stone_bricks', 2.0, 1.6, 'stone', 'obra'],
  [B.STAIR_BRICKS, 'Escada de tijolos', 'bricks', 1.7, 1.6, 'stone', 'obra'],
  [B.STAIR_MARBLE, 'Escada de mármore', 'marble', 2.2, 1.5, 'stone', 'obra'],
  [B.STAIR_SANDSTONE, 'Escada de arenito', 'sandstone', 1.6, 1.0, 'stone', 'obra'],
  [B.STAIR_CONCRETE, 'Escada de concreto', 'concrete', 2.0, 1.5, 'stone', 'obra'],
];
for (const [id, name, tex, mass, hard, sound, group] of STAIR_DEFS) {
  def(id, { name, tex, mass, hard, sound, group, opaque: false });
}


// ---- peças funcionais -------------------------------------------------------
// Faces na ordem +X -X +Y -Y +Z -Z.
const DIR_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
def(B.MOTOR, { name: 'Motor', tex: { side: 'engine_side', top: 'engine_top' }, hard: 1.5, sound: 'metal', group: 'máquina', func: F_MOTOR, mass: 2.5 });
def(B.GYRO, { name: 'Giroscópio', tex: 'gyro', hard: 1.2, sound: 'metal', group: 'máquina', func: F_GYRO, mass: 1.2 });
def(B.DYNAMITE, { name: 'Dinamite', tex: { side: 'dynamite_side', top: 'dynamite_top' }, hard: 0.3, sound: 'wood', group: 'máquina', func: F_DYNAMITE, mass: 0.8 });
def(B.SUPER_BOMBA, { name: 'Super Bomba', tex: { side: 'dynamite_side', top: 'phantom_crystal', bottom: 'metal_dark' }, hard: 0.5, sound: 'metal', group: 'máquina', mass: 2, emit: 7 });
def(B.BALLOON, { name: 'Balão', kind: K_MODEL, tex: 'balloon', hard: 0.2, sound: 'leaves', group: 'máquina', func: F_BALLOON, mass: 0.1 });
for (let f = 0; f < 6; f++) {
  // propulsor: bocal na face oposta ao empuxo, entrada de ar na face do empuxo
  const faces = new Array(6).fill('thruster_side');
  faces[f] = 'thruster_front';
  faces[f ^ 1] = 'thruster_nozzle';
  def(B.THRUSTER + f, { name: 'Propulsor', faces, hard: 1.2, sound: 'metal', group: 'máquina', func: F_THRUSTER, facing: f, base: B.THRUSTER, mass: 1.2, placeable: f === 0 });
  def(B.PROPELLER + f, { name: 'Hélice', kind: K_MODEL, tex: 'metal_dark', hard: 0.6, sound: 'metal', group: 'máquina', func: F_PROPELLER, facing: f, base: B.PROPELLER, mass: 0.6, placeable: f === 0 });
  def(B.CANNON + f, { name: 'Canhão', kind: K_MODEL, tex: 'metal_dark', hard: 2.0, sound: 'metal', group: 'máquina', func: F_CANNON, facing: f, base: B.CANNON, mass: 2.0, placeable: f === 0 });
}
// roda: FACING guarda o eixo (0 = X, 4 = Z)
def(B.WHEEL, { name: 'Roda', kind: K_MODEL, tex: 'tire', hard: 0.6, sound: 'wood', group: 'máquina', func: F_WHEEL, facing: 0, base: B.WHEEL, mass: 0.8 });
def(B.WHEEL + 1, { name: 'Roda', kind: K_MODEL, tex: 'tire', hard: 0.6, sound: 'wood', group: 'máquina', func: F_WHEEL, facing: 4, base: B.WHEEL, mass: 0.8, placeable: false });
// asa: FACING guarda a normal da placa (0 = X, 2 = Y, 4 = Z)
[0, 2, 4].forEach((f, i) => def(B.WING + i, { name: 'Asa', kind: K_MODEL, tex: 'wing', hard: 0.4, sound: 'metal', group: 'máquina', func: F_WING, facing: f, base: B.WING, mass: 0.35, placeable: i === 1 }));
// assento: FACING é para onde o piloto olha
[0, 1, 4, 5].forEach((f, i) => def(B.SEAT + i, { name: 'Assento do piloto', kind: K_MODEL, tex: 'seat', hard: 0.5, sound: 'wood', group: 'máquina', func: F_SEAT, facing: f, base: B.SEAT, mass: 0.6, placeable: i === 0 }));

def(B.SHADOW_STONE, { natural: true, name: 'Pedra-sombra', tex: 'shadow_stone', hard: 2.2, sound: 'stone' });
def(B.ASH, { natural: true, name: 'Cinza', tex: 'ash', hard: 0.4, sound: 'sand' });
def(B.PHANTOM_CRYSTAL, { natural: true, name: 'Cristal fantasma', tex: 'phantom_crystal', hard: 2.4, sound: 'glass', emit: 11 });
// o véu do portal: atravessável, luminoso, só o servidor coloca
def(B.PORTAL, { natural: true, name: 'Véu do portal', kind: K_CUTOUT, tex: 'portal', hard: Infinity, sound: 'glass', emit: 12, solid: false, placeable: false, drop: 0 });
def(B.MYSTIC_WATER, { natural: true, name: 'Água mística', tex: 'mystic_water', hard: 0.6, sound: 'water', emit: 9, group: 'obra' });

// Blocos do Minecraft. Até a malha própria (fase 3) eles se desenham com uma textura do LAVRA; não estão na paleta.
def(B.MC_SOLIDO, { name: 'Bloco do Minecraft', tex: 'stone', hard: 1.5, sound: 'stone', group: 'minecraft', placeable: false });
def(B.VISAO, { name: 'Visão unilateral', kind: K_CUBE, opaque: false, tex: 'glass', hard: 0.6, sound: 'glass', group: 'construcao', placeable: false, drop: 0 });   // /visao (server/visao.js)
def(B.MC_RECORTE, { name: 'Bloco do Minecraft (recorte)', kind: K_CUTOUT, tex: 'glass', hard: 0.5, sound: 'glass', group: 'minecraft', placeable: false });
def(B.MC_FORMA, { name: 'Peça do Minecraft', kind: K_MODEL, tex: 'planks', hard: 0.8, sound: 'wood', group: 'minecraft', placeable: false });
def(B.DEEP_STONE, { natural: true, name: 'Rocha profunda', tex: 'shadow_stone', hard: 2.2, sound: 'stone' });
// pedras brutas: duas camadas de cristal combinadas (lados / topo e fundo) para cada uma sair diferente até ter a sua
def(B.SAPPHIRE_ORE, { natural: true, name: 'Safira bruta', tex: 'phantom_crystal', hard: 2.8, sound: 'glass', emit: 6, group: 'minério' });
def(B.EMERALD_ORE, { natural: true, name: 'Esmeralda bruta', tex: { side: 'phantom_crystal', top: 'crystal_ore' }, hard: 3.0, sound: 'glass', emit: 7, group: 'minério' });
def(B.RUBY_ORE, { natural: true, name: 'Rubi bruto', tex: { side: 'crystal_ore', top: 'phantom_crystal' }, hard: 3.2, sound: 'glass', emit: 8, group: 'minério' });
def(B.DIAMOND_ORE, { natural: true, name: 'Diamante bruto', tex: 'crystal_ore', hard: 3.6, sound: 'glass', emit: 9, group: 'minério' });
def(B.MAGMA, { natural: true, name: 'Magma', tex: 'magma', hard: 2.0, sound: 'stone', emit: 12 });

// Água corrente. Um byte por bloco não guarda metadado, então cada altura é um id: FLOW0 + n é o nível n (1..7).
// A fonte (B.WATER) vale 8. Ninguém coloca nem recolhe água corrente: ela nasce e seca pela lei.
export const FLOW0 = B.FLOW_1 - 1;
for (let n = 1; n <= 7; n++) {
  def(FLOW0 + n, { natural: true, name: 'Água corrente', kind: K_LIQUID, hard: 0, sound: 'water', drop: 0, placeable: false });
}
// Altura da água na célula, em oitavos: 8 = fonte, 1..7 = corrente, 0 = sem água.
export const LEVEL = new Uint8Array(N);
LEVEL[B.WATER] = 8;
for (let n = 1; n <= 7; n++) LEVEL[FLOW0 + n] = n;

// Variante de uma peça direcional apontando para a direção dada (0..5).
export function withFacing(baseId, dir) {
  const fn = FUNC[baseId];
  if (fn === F_THRUSTER || fn === F_PROPELLER || fn === F_CANNON) return BASE[baseId] + dir;
  if (fn === F_WHEEL) return B.WHEEL + ((dir >> 1) === 2 ? 1 : 0);            // eixo Z ou X
  if (fn === F_WING) return B.WING + (dir >> 1);                               // normal X, Y ou Z
  if (fn === F_SEAT) return B.SEAT + (dir === 0 ? 0 : dir === 1 ? 1 : dir === 5 ? 3 : 2);
  return baseId;
}
// Gira uma peça em torno de Y em passos de 90° (para estacionar uma máquina girada).
// Um passo leva +X para -Z, -Z para -X, -X para +Z e +Z para +X.
const YAW_NEXT = [5, 4, 2, 3, 0, 1];
export function rotateYaw(id, steps) {
  let f = FACING[id];
  if (f === 255) return id;
  for (let i = 0; i < (steps & 3); i++) f = YAW_NEXT[f];
  const fn = FUNC[id];
  if (fn === F_WHEEL || fn === F_WING) f &= ~1; // eixo/normal não têm sentido
  return withFacing(BASE[id], f);
}

// Ordem da paleta do modo criativo.
export const PALETTE = [
  B.GRASS, B.DIRT, B.STONE, B.SAND, B.GRAVEL, B.CLAY, B.SANDSTONE, B.BASALT, B.DEEP_STONE, B.MAGMA, B.SNOW, B.ICE,
  B.LOG, B.PLANKS, B.STAIR_PLANKS, B.PINE_LOG, B.PINE_PLANKS, B.STAIR_PINE, B.LEAVES, B.PINE_LEAVES, B.SAKURA, B.CACTUS,
  B.STONE_BRICKS, B.BRICKS, B.MARBLE, B.CONCRETE,
  B.STAIR_STONE, B.STAIR_STONE_BRICKS, B.STAIR_BRICKS, B.STAIR_MARBLE, B.STAIR_SANDSTONE, B.STAIR_CONCRETE,
  B.ROOF, B.STEEL, B.GOLD_BLOCK, ...GLASS_IDS, B.LAMP,
  B.PLASTER_WHITE, B.PLASTER_RED, B.PLASTER_YELLOW, B.PLASTER_GREEN, B.PLASTER_BLUE, B.PLASTER_DARK,
  B.COAL_ORE, B.IRON_ORE, B.COPPER_ORE, B.GOLD_ORE, B.CRYSTAL_ORE, B.SAPPHIRE_ORE, B.EMERALD_ORE, B.RUBY_ORE, B.DIAMOND_ORE,
  B.TALL_GRASS, B.FERN, B.FLOWER_YELLOW, B.FLOWER_RED, B.FLOWER_BLUE, B.FLOWER_WHITE, B.DRY_SHRUB, B.REEDS,
  B.WATER,
  B.SEAT, B.MOTOR, B.WHEEL, B.PROPELLER, B.THRUSTER, B.WING + 1, B.GYRO, B.BALLOON, B.CANNON, B.DYNAMITE, B.SUPER_BOMBA,
  B.SHADOW_STONE, B.ASH, B.PHANTOM_CRYSTAL, B.MYSTIC_WATER,
];

export const DEFAULT_HOTBAR = [
  B.GRASS, B.STONE, B.PLANKS, B.LOG, B.STONE_BRICKS, B.GLASS, B.LAMP, B.STAIR_STONE_BRICKS, B.SAND,
];

export const isValidBlock = (id) => Number.isInteger(id) && id >= 0 && id < BLOCK_COUNT && BLOCKS[id] !== null;
