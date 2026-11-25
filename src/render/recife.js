// LAVRA — o recife de corais do arquipélago (pedido do Kadmus, 19/11/2026: "CORAIS NO SUBMERSO… a vida marinha
// repaginada para ficar lindo como motions e artes finalizadas e não como os retalhos atuais"). Feito pelo Claude a
// pedido direto dele. Modelos dos organismos: render/recife/geometria.js (traduzido de dgreenheck/tidewater, MIT);
// tipos, paletas e zoneamento de src/world/Reef.js; o desenho (material) foi refeito aqui em GLSL.
//
// Zonas pela fundura e pela distância à costa (shared/arquipelago.js → s): crista rasa (chifre-de-alce, coral-de-fogo,
// leques balançando), frente do recife (moitas de chifre-de-veado, corais-estrela, cérebros, placas, floresta de
// gorgônias, esponjas), recife de trás na areia rasa (dedos, estrelinhas, ouriços, halimeda), manchas soltas e o
// talude fundo (placas de parede, barris grandes, leques fundos, coral-negro, esponja-orelha). Manchas de recife e
// canais de areia saem de um ruído; tudo é determinístico (semente do mundo + célula), feito em pedaços de 16 m só em
// volta de quem olha. É desenho: não tem colisão, não muda blocos. Nada perto de obra de quem joga.
import * as THREE from '../three.js';
import { U, COMMON } from './materials.js';
import * as Geo from './recife/geometria.js';
import { MAR_NIVEL } from '../../shared/mar.js';
import { AGUA_GLSL } from './agua-clara.js';
import { CAUSTICA_GLSL } from './causticas.js';

const S = { rock: 0, star: 1, brain: 2, brainWide: 3, porites: 4, acropora: 5, finger: 6, fire: 7, plate: 8, pillar: 9, gorgonian: 10, sponge: 11, urchin: 12, anemone: 13, rubble: 14, grass: 15, fan: 16, plume: 17, lettuce: 18, algae: 19, sargassum: 20, kelp: 21, iridescent: 22, magenta: 23, ship: 24, whale: 25 };
const MODELS = {
  rock: (r, l) => Geo.createMound(r, l, 'rock'), slab: (r, l) => Geo.createMound(r, l, 'slab'), boulder: (r, l) => Geo.createMound(r, l, 'boulder'),
  knobby: (r, l) => Geo.createMound(r, l, 'knobby'), dome: Geo.createDome, lobes: Geo.createLobes, pillars: Geo.createPillars, elkhorn: Geo.createElkhorn,
  staghorn: Geo.createStaghorn, fingers: Geo.createFingers, blades: Geo.createBlades, plates: Geo.createPlates, rod: Geo.createSeaRod, whip: Geo.createWhips,
  barrel: Geo.createBarrel, tubes: (r, l) => Geo.createTubes(r, l, false), vase: (r, l) => Geo.createTubes(r, l, true), rope: Geo.createRopes, urchin: Geo.createUrchin,
  anemone: Geo.createAnemone, rubble: Geo.createRubble, grass: Geo.createSeagrass, fan: Geo.createSeaFan, plume: Geo.createSeaPlume, lettuce: Geo.createLettuce,
  wallPlates: Geo.createWallPlates, wire: Geo.createWireCoral, blackCoral: Geo.createBlackCoral, ear: Geo.createEarSponge, meadow: Geo.createMeadow,
  halimeda: Geo.createHalimeda, penicillus: Geo.createPenicillus, sargassum: Geo.createSargassum, starfish: Geo.createStarfish, cucumber: Geo.createCucumber, conch: Geo.createConch,
  kelpColumn: Geo.createKelpColumn, iridescentFoliage: Geo.createIridescentFoliage, magentaCover: Geo.createMagentaCover,
  rockArch: Geo.createRockArch, sunkenShipHull: Geo.createSunkenShipHull, whaleFluke: Geo.createWhaleFlukeSculpture,
};
// tipo: modelo, superfície, balanço, tamanho, esticar (y, xz), alinhar ao fundo, enterrar, paletas (sRGB)
const TYPES = {
  slab: { model: 'slab', s: S.rock, scale: [2.2, 4.8], sy: [0.6, 1.1], sxz: [0.75, 1.3], align: 0.6, sink: 0.12, c1: [0x8e7c6a, 0x867262, 0x968270, 0x7e6c60], c2: [0xb07a92, 0xba88a0, 0xa4708a, 0xc496a8] },
  rock: { model: 'rock', s: S.rock, scale: [1.0, 3.6], sy: [0.6, 1.1], sxz: [0.8, 1.25], align: 0.3, sink: 0.14, c1: [0x8c7a68, 0x827060, 0x947e6c, 0x7a6a5c], c2: [0xb07a92, 0xbc8aa2, 0xa06c86, 0xc898ac] },
  boulder: { model: 'boulder', s: S.star, scale: [0.8, 2.6], sy: [0.6, 1.1], sxz: [0.85, 1.2], align: 0.6, sink: 0.05, c1: [0xae8e56, 0xa4885a, 0x98885a, 0xb49660, 0x9e8250], c2: [0x8c9068, 0x84886a, 0xb4a078] },
  lobes: { model: 'lobes', s: S.star, scale: [0.8, 1.8], sy: [0.8, 1.3], sxz: [0.85, 1.2], align: 0.4, sink: 0.03, c1: [0xb09460, 0xb89c68, 0xa48a5c, 0xac8e58], c2: [0x8e9068, 0xc0ac86] },
  brain: { model: 'dome', s: S.brain, scale: [0.35, 1.3], sy: [0.75, 1.15], sxz: [0.85, 1.2], align: 0.7, sink: 0.04, c1: [0xb89c60, 0xac9258, 0xc0a468, 0xa0925c], c2: [0x6e6e4c, 0x7a6a4c, 0x646a52] },
  brainWide: { model: 'dome', s: S.brainWide, scale: [0.8, 2.0], sy: [0.6, 1.0], sxz: [0.85, 1.2], align: 0.6, sink: 0.05, c1: [0x9a7650, 0xa8845a, 0x8c6c4e, 0x9c7c56], c2: [0x7a8468, 0x8e8c70, 0xa89a74] },
  starlet: { model: 'dome', s: S.porites, scale: [0.25, 0.8], sy: [0.7, 1.1], sxz: [0.85, 1.2], align: 0.7, sink: 0.05, c1: [0xa87858, 0xb08262, 0x9a7058], c2: [0x86624a] },
  knobby: { model: 'knobby', s: S.porites, scale: [0.25, 0.85], sy: [0.6, 1.1], sxz: [0.8, 1.25], align: 0.7, sink: 0.05, c1: [0x9c8244, 0x947a40, 0x8c8046, 0xa2884c], c2: [0x7e7640] },
  pillar: { model: 'pillars', s: S.pillar, scale: [0.8, 1.4], sy: [0.8, 1.2], sxz: [0.9, 1.1], align: 0.1, sink: 0.02, c1: [0xb09470, 0xb89c78, 0xa48a68], c2: [0xd8c8a8] },
  elkhorn: { model: 'elkhorn', s: S.acropora, scale: [1.0, 2.4], sy: [0.7, 1.0], sxz: [0.85, 1.2], align: 0.2, sink: 0.03, c1: [0xb48440, 0xac7c3a, 0xa07438, 0xbc8e4c], c2: [0xd8c8a0, 0xe0d2ac] },
  staghorn: { model: 'staghorn', s: S.acropora, scale: [0.8, 1.5], sy: [0.8, 1.2], sxz: [0.85, 1.2], align: 0.15, sink: 0.03, c1: [0xb89462, 0xac8a5a, 0xc09c6a, 0xa4885e], c2: [0xf0e8d8, 0xe4dcc8] },
  finger: { model: 'fingers', s: S.finger, scale: [0.9, 1.9], sy: [0.8, 1.3], sxz: [0.85, 1.2], align: 0.5, sink: 0.02, c1: [0xb09a80, 0xb8a084, 0xa4928a], c2: [0xd8ccb8, 0xd0c4c8] },
  fire: { model: 'blades', s: S.fire, scale: [0.7, 1.5], sy: [0.8, 1.2], sxz: [0.85, 1.2], align: 0.4, sink: 0.02, c1: [0xd0a858, 0xc49e50, 0xd4b064], c2: [0xf4ecd4] },
  plate: { model: 'plates', s: S.plate, scale: [0.8, 1.8], sy: [0.8, 1.2], sxz: [0.85, 1.2], align: 0.5, sink: 0.02, c1: [0x9a7c58, 0x8c7050, 0xa4845e], c2: [0xd0c0a4] },
  rod: { model: 'rod', s: S.gorgonian, flex: 0.25, scale: [0.65, 1.6], sy: [0.8, 1.2], sxz: [0.8, 1.2], align: 0.15, sink: 0.01, c1: [0x9a7a66, 0xa88a60, 0x8c6c70, 0xb08c62, 0x9a7486, 0x8a5a8c, 0x7a4c7e, 0xc0a062], c2: [0xc0b0a0, 0xc8b894, 0xb898c0] },
  whip: { model: 'whip', s: S.gorgonian, flex: 0.5, scale: [0.6, 1.3], sy: [0.8, 1.2], sxz: [0.8, 1.2], align: 0.1, sink: 0.01, c1: [0x9a7248, 0x86583e, 0xa47e4a, 0x7a4a58], c2: [0xa88c60] },
  barrel: { model: 'barrel', s: S.sponge, scale: [0.7, 1.5], sy: [0.8, 1.2], sxz: [0.9, 1.1], align: 0.2, sink: 0.04, c1: [0x8c5040, 0x9a6050, 0x7c5448, 0x8a6258], c2: [0x60342a] },
  tube: { model: 'tubes', s: S.sponge, scale: [0.8, 1.6], sy: [0.8, 1.3], sxz: [0.9, 1.1], align: 0.2, sink: 0.02, c1: [0xd0b040, 0x9a6040, 0xd07030, 0xa49656, 0xc8a040, 0x8a5aa0], c2: [0x5a4020] },
  vase: { model: 'vase', s: S.sponge, scale: [0.8, 1.5], sy: [0.8, 1.2], sxz: [0.9, 1.1], align: 0.2, sink: 0.02, c1: [0xa092cc, 0x9282c0, 0xaa90b8], c2: [0x6a5a98] },
  rope: { model: 'rope', s: S.sponge, scale: [0.8, 1.5], sy: [0.9, 1.1], sxz: [0.9, 1.1], align: 0.5, sink: 0.0, c1: [0x86407a, 0x984040, 0x742e66], c2: [0x5a2a50] },
  urchin: { model: 'urchin', s: S.urchin, scale: [0.8, 1.2], sy: [0.9, 1.1], sxz: [0.9, 1.1], align: 0.6, sink: 0.0, c1: [0x141014, 0x181418], c2: [0x2a1a2a] },
  anemone: { model: 'anemone', s: S.anemone, flex: 0.35, scale: [0.9, 1.5], sy: [0.9, 1.1], sxz: [0.9, 1.1], align: 0.7, sink: 0.0, c1: [0xdccca8, 0xd0c0a0, 0xd8c8c0], c2: [0xc870a4, 0xa864b8, 0xd890a8] },
  rubble: { model: 'rubble', s: S.rubble, scale: [0.8, 1.8], sy: [0.8, 1.2], sxz: [0.8, 1.2], align: 1.0, sink: 0.0, c1: [0xa09484], c2: [0xb07a92, 0xbc8aa2, 0x969460] },
  fan: { model: 'fan', s: S.fan, flex: 0.38, scale: [0.4, 1.2], sy: [0.85, 1.15], sxz: [0.85, 1.15], align: 0.1, sink: 0.01, c1: [0x7a4a80, 0x8a5890, 0x6a3a62, 0x9a6a92, 0xa89458, 0x8a7a48], c2: [0x5e2e60, 0x6e3e70, 0x7a6a40] },
  plume: { model: 'plume', s: S.plume, flex: 0.55, scale: [0.65, 1.6], sy: [0.85, 1.2], sxz: [0.85, 1.15], align: 0.1, sink: 0.01, c1: [0x8a8a48, 0x7a7a40, 0x9a8a50, 0x8a7448, 0x6e3e6e, 0x7a4a62], c2: [0xaaa060, 0x9a7a60] },
  lettuce: { model: 'lettuce', s: S.lettuce, scale: [0.7, 1.7], sy: [0.8, 1.25], sxz: [0.85, 1.2], align: 0.4, sink: 0.02, c1: [0x9a7a48, 0xa88a50, 0x8c7244, 0xb09458], c2: [0xd8cca8, 0xc8b890] },
  wallPlate: { model: 'wallPlates', s: S.plate, scale: [0.8, 1.9], sy: [0.8, 1.15], sxz: [0.85, 1.2], align: 0.7, sink: 0.02, c1: [0x8a6e50, 0x7c6448, 0x94785a, 0x806a54], c2: [0xd4c4a4, 0xc8b89c] },
  wire: { model: 'wire', s: S.gorgonian, flex: 0.35, scale: [0.7, 1.3], sy: [0.9, 1.1], sxz: [0.9, 1.1], align: 0.55, sink: 0.01, c1: [0x8a7a50, 0x7a6a44, 0x9a7a4a], c2: [0xa89868] },
  blackCoral: { model: 'blackCoral', s: S.gorgonian, flex: 0.2, scale: [0.6, 1.4], sy: [0.85, 1.15], sxz: [0.85, 1.15], align: 0.4, sink: 0.01, c1: [0x6a6a3a, 0x7a6436, 0x5a5a38], c2: [0x9a8a50] },
  ear: { model: 'ear', s: S.sponge, scale: [0.6, 1.4], sy: [0.85, 1.2], sxz: [0.9, 1.1], align: 0.35, sink: 0.03, c1: [0xc0602c, 0xb8502a, 0xc87034, 0xa84830], c2: [0x6a2a1a] },
  barrelDeep: { model: 'barrel', s: S.sponge, scale: [1.2, 2.3], sy: [0.85, 1.25], sxz: [0.9, 1.1], align: 0.25, sink: 0.04, c1: [0x8c5040, 0x9a6050, 0x7c5448, 0x946a58], c2: [0x60342a] },
  fanDeep: { model: 'fan', s: S.fan, flex: 0.22, scale: [0.9, 1.7], sy: [0.85, 1.15], sxz: [0.85, 1.15], align: 0.2, sink: 0.01, c1: [0x7a4a80, 0x8a5890, 0x9a6a92, 0xa89458, 0x9a4a60], c2: [0x5e2e60, 0x6e3e70, 0x7a6a40] },
  meadow: { model: 'meadow', s: S.grass, flex: 0.55, scale: [0.85, 1.2], sy: [0.75, 1.2], sxz: [0.85, 1.15], align: 0.8, sink: 0.0, c1: [0x6a8a3a, 0x78963e, 0x5e7e34, 0x82983f], c2: [0x9a8a52] },
  halimeda: { model: 'halimeda', s: S.algae, flex: 0.12, scale: [0.8, 1.5], sy: [0.8, 1.3], sxz: [0.85, 1.15], align: 0.3, sink: 0.0, c1: [0x8aae4a, 0x7ea444, 0x9ab852], c2: [0xd8dcb0] },
  penicillus: { model: 'penicillus', s: S.algae, flex: 0.1, scale: [0.8, 1.4], sy: [0.8, 1.3], sxz: [0.9, 1.1], align: 0.2, sink: 0.0, c1: [0x7a9a4a, 0x88a050, 0x6e8e44], c2: [0xd0d0b0] },
  starfish: { model: 'starfish', s: S.anemone, scale: [0.8, 1.3], sy: [0.9, 1.1], sxz: [0.9, 1.1], align: 1.0, sink: 0.0, c1: [0xd0602a, 0xc8702c, 0xd8803a, 0xb8502a], c2: [0xe0b070] },
  cucumber: { model: 'cucumber', s: S.sponge, scale: [0.8, 1.4], sy: [0.9, 1.1], sxz: [0.8, 1.2], align: 1.0, sink: 0.05, c1: [0x3a2a1e, 0x4a3424, 0x2e2420], c2: [0x2a1e18] },
  conch: { model: 'conch', s: S.rubble, scale: [0.8, 1.3], sy: [0.9, 1.1], sxz: [0.9, 1.1], align: 1.0, sink: 0.15, c1: [0xa09484], c2: [0xd8a090, 0xe0b098] },
  sargassum: { model: 'sargassum', s: S.sargassum, flex: 0.9, scale: [0.7, 1.5], sy: [0.8, 1.3], sxz: [0.85, 1.15], align: 0.2, sink: 0.0, c1: [0x8a6a2a, 0x9a7a32, 0x7a5e26, 0xa08036], c2: [0x6a5a26] },
  kelp: { model: 'kelpColumn', s: S.kelp, flex: 1.15, scale: [5.5, 13.5], sy: [0.9, 1.2], sxz: [0.85, 1.2], align: 0.05, sink: 0.01, c1: [0x2a7a3b, 0x368842, 0x42943e, 0x2e6e36], c2: [0xd4b83a, 0x8ce25a, 0xf2d04b] },
  iridescent: { model: 'iridescentFoliage', s: S.iridescent, flex: 0.52, scale: [1.1, 2.3], sy: [0.85, 1.25], sxz: [0.85, 1.2], align: 0.25, sink: 0.02, c1: [0x7e289e, 0x942ab4, 0x6a228c, 0xa8329c], c2: [0xff5cd6, 0x52e5ff, 0xff7ae2] },
  magenta: { model: 'magentaCover', s: S.magenta, flex: 0.18, scale: [1.2, 2.5], sy: [0.8, 1.2], sxz: [0.9, 1.25], align: 0.85, sink: 0.01, c1: [0xb81d7a, 0xc82286, 0x9e1868, 0xd42c92], c2: [0xff6ee0, 0xe052ff, 0xff8ae8] },
  arch: { model: 'rockArch', s: S.rock, flex: 0.0, scale: [4.2, 7.2], sy: [0.85, 1.15], sxz: [0.85, 1.2], align: 0.15, sink: 0.08, c1: [0x6c6258, 0x786c60, 0x5e564e], c2: [0xb45c96, 0x4ca878, 0xc472a8] },
  shipHull: { model: 'sunkenShipHull', s: S.ship, flex: 0.0, scale: [5.4, 7.6], sy: [0.95, 1.1], sxz: [0.95, 1.1], align: 0.35, sink: 0.06, c1: [0x583e2a, 0x4c3422, 0x624630], c2: [0x3c8c64, 0xb85a94] },
  whaleFluke: { model: 'whaleFluke', s: S.whale, flex: 0.0, scale: [5.2, 7.4], sy: [0.95, 1.12], sxz: [0.95, 1.1], align: 0.12, sink: 0.05, c1: [0x5e6e78, 0x52626c, 0x687882], c2: [0x52d6b4, 0xd8b84a] },
};
// abundância por zona [crista, frente, trás, manchas, talude] em cada camada (Reef.js → LAYERS); espaçamento ×1,5
// em relação ao Tidewater (o mundo do LAVRA tem muito mais recife em volta da ilha)
const LAYERS = [
  { occ: 0, spacing: 3.0, allow: 0.45, types: { slab: [1.5, 1.2, 1.5, 1.5, 0.8], rock: [1.8, 1.8, 1.6, 2, 1.2], boulder: [1.2, 3, 0.7, 1.8, 2.0], lobes: [0.4, 2.4, 0.4, 1.2, 1.8], brainWide: [1.0, 1.5, 0.5, 1.0, 0.8], elkhorn: [5, 0.3, 0, 0, 0], barrel: [0, 0.5, 0, 0.1, 0.3], barrelDeep: [0, 0, 0, 0, 1.4], pillar: [0.05, 0.2, 0.02, 0.05, 0], plate: [0, 0.35, 0, 0.15, 0.4], wallPlate: [0, 0.1, 0, 0, 1.6], ear: [0, 0.1, 0, 0.05, 0.4], arch: [0, 0.08, 0, 0.06, 0.22] } },
  { occ: 1, spacing: 0.85, allow: 0.25, types: { brain: [1.2, 0.9, 0.5, 0.8, 0.5], knobby: [1.4, 0.7, 0.7, 0.7, 0.3], starlet: [0.3, 0.5, 1.0, 0.5, 0.3], staghorn: [0.8, 4, 0.5, 1.2, 0.3], finger: [0.5, 0.4, 2, 0.6, 0], fire: [1.2, 0.15, 0.2, 0.2, 0], plate: [0, 0.25, 0, 0.1, 0.6], lobes: [0.2, 0.8, 0.2, 0.5, 0.7], elkhorn: [2.5, 0.15, 0, 0, 0], lettuce: [0.3, 0.9, 0.9, 0.6, 0.8], wallPlate: [0, 0, 0, 0, 1.0], rod: [0.6, 1.0, 0.6, 0.8, 0.3], fan: [0.8, 0.5, 0.2, 0.5, 0.2], plume: [0.2, 0.6, 0.3, 0.4, 0.2], tube: [0.4, 1.6, 0.2, 0.7, 1.4], vase: [0.1, 0.8, 0, 0.3, 1.0], rope: [0.2, 0.7, 0.2, 0.4, 0.8], ear: [0, 0.3, 0, 0.1, 0.9], anemone: [0.2, 0.2, 0.15, 0.15, 0.05], sargassum: [1.6, 0.15, 0.5, 0.2, 0], iridescent: [0.4, 1.3, 0.35, 0.9, 1.1], magenta: [0.6, 1.4, 0.8, 1.1, 0.9] } },
  { occ: 4, spacing: 1.15, allow: 0.3, types: { rod: [2.2, 3.6, 1.4, 2.4, 1.2], plume: [0.8, 2.4, 0.8, 1.4, 1.0], whip: [0.5, 1.3, 0.6, 1.0, 1.0], fan: [2.0, 1.2, 0.3, 0.9, 0.3], fanDeep: [0, 0.2, 0, 0.1, 2.2], wire: [0, 0.05, 0, 0, 1.2], blackCoral: [0, 0, 0, 0, 0.8], kelp: [0, 1.4, 0, 1.1, 3.2], iridescent: [0.3, 1.1, 0.2, 0.8, 1.2] } },
  { occ: 2, spacing: 0.6, allow: 0.12, types: { urchin: [0.3, 0.15, 0.4, 0.2, 0.05], rubble: [0.5, 0.8, 1.0, 0.7, 0.4], knobby: [0.3, 0.15, 0.2, 0.15, 0.1], brain: [0.15, 0.15, 0.1, 0.1, 0.1], rod: [0.4, 0.6, 0.3, 0.4, 0.3], fan: [0.3, 0.2, 0.1, 0.2, 0.2], finger: [0.2, 0.2, 0.6, 0.2, 0], starlet: [0.1, 0.15, 0.3, 0.15, 0.1], plume: [0.2, 0.3, 0.2, 0.2, 0.2], staghorn: [0.2, 0.8, 0.1, 0.2, 0], tube: [0.1, 0.35, 0.05, 0.15, 0.4], lettuce: [0.1, 0.3, 0.3, 0.2, 0.2], sargassum: [1.4, 0.1, 0.4, 0.1, 0], halimeda: [0.3, 0.25, 1.4, 0.5, 0.2], penicillus: [0.1, 0.05, 0.6, 0.2, 0], magenta: [0.4, 0.9, 0.6, 0.7, 0.5] } },
  // areia: vida miúda espalhada, capim marinho em prados
  { occ: 3, spacing: 1.4, allow: -1, sand: true, types: { meadow: [0, 0, 2.5, 0.6, 0], starfish: [0.1, 0.2, 0.5, 0.3, 0.1], cucumber: [0, 0.1, 0.3, 0.2, 0.3], conch: [0.1, 0.1, 0.4, 0.2, 0.05], halimeda: [0.1, 0.1, 0.6, 0.2, 0], penicillus: [0, 0.05, 0.5, 0.1, 0], magenta: [0, 0.3, 0.6, 0.4, 0.2] } },
];

// (24/11/2026) Vida até o fundo, a pedido direto do Kadmus com a referência Abyssal Garden ("não foi até as áreas mais
// profundas do mar, nem mesmo vi bolhas ou peixes em grande quantidade"). Antes nada nascia abaixo de 19 m (quase todo
// o mar do arquipélago tem 26 a 43 m): agora há a zona FUNDO, com jardins e florestas de alga gigante em manchas largas
// separadas por areia; os cardumes são grandes (dezenas a centenas de peixes nadando em bloco) e existem em qualquer
// fundura; há arraias no mar aberto e colunas de bolhas que saem de fontes no chão. Com a água clara vê-se mais longe:
// o alcance subiu de 58 para 84 m no PC.
// abundância na zona FUNDO (19 a 70 m), por camada de LAYERS
const FUNDO = [
  { slab: 0.9, rock: 1.4, boulder: 1.6, lobes: 0.9, barrelDeep: 1.7, wallPlate: 0.9, ear: 0.6, arch: 0.34, plate: 0.35, brainWide: 0.5 },
  { lettuce: 0.7, plate: 0.5, tube: 1.6, vase: 1.2, rope: 0.9, ear: 1.0, anemone: 0.5, iridescent: 1.0, magenta: 1.1, lobes: 0.5, rod: 0.4, fan: 0.6, brain: 0.35, fire: 0.25, staghorn: 0.3 },
  { fanDeep: 2.4, wire: 1.0, blackCoral: 1.0, whip: 1.0, plume: 1.0, rod: 0.9, kelp: 1.3, iridescent: 0.8, fan: 0.8 },
  { rubble: 0.5, tube: 0.3, magenta: 0.4, rod: 0.2, fan: 0.2, urchin: 0.15, starlet: 0.2 },
  { starfish: 0.2, cucumber: 0.35, conch: 0.08, magenta: 0.22 },
];
const FUNDO_DE = 19, FUNDO_ATE = 70;
const CEL = 16, RAIO = 84, PERTO = 13, PERTO_MAX = 17;
const CARDUME_CEL = 32, FONTE_CEL = 24;
const srgbLin = (h) => { const f = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4)); return [f(((h >> 16) & 255) / 255), f(((h >> 8) & 255) / 255), f((h & 255) / 255)]; };
function hash32(a, b, c) { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; }
function rngDe(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// ruído de valor suave (manchas de recife, canais de areia)
function vnoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const h = (i, j) => hash32(xi + i, zi + j, seed) / 4294967296;
  return (h(0, 0) * (1 - u) + h(1, 0) * u) * (1 - v) + (h(0, 1) * (1 - u) + h(1, 1) * u) * v;
}

const VS = /* glsl */`
precision highp float;
in vec3 position, normal;
in vec4 aData, iA, iQ, iB, iC1, iC2;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform float uTime;
out vec3 vWorld, vN, vLocal, vC1, vC2;
out vec4 vData, vInfo;
vec3 rotQ(vec4 q, vec3 v) { vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
void main() {
  vec3 sc = iB.xyz * iA.w;
  vec3 p = position * sc;
  float seed = iC1.w, flex = iB.w;
  vLocal = p; vData = aData; vInfo = vec4(seed, iC2.w, iA.w, 0.0);
  vC1 = iC1.rgb; vC2 = iC2.rgb;
  vec3 n = normalize(rotQ(iQ, normal / sc));
  // forma maciça: um empeno suave por colônia (nenhuma igual à outra)
  if (flex < 0.0) { vec3 w = position * 3.1 + seed * 17.0; p += vec3(sin(w.y * 1.7 + w.z), sin(w.z * 1.3 + w.x * 1.1) * 0.6, sin(w.x * 1.9 + w.y * 0.7)) * (-flex * iA.w * (aData.x * 0.8 + 0.2)); }
  float some = 1.0 - smoothstep(${(RAIO * 0.75).toFixed(1)}, ${(RAIO * 0.97).toFixed(1)}, length(iA.xyz - cameraPosition));
  vec3 w = rotQ(iQ, p * some) + iA.xyz;
  if (flex > 0.0) {
    // o que é mole balança com a ondulação (mais na ponta), com um tremor próprio
    float t = aData.x, ph = uTime * 1.7 + seed * 40.0 + aData.w * 12.0;
    vec2 swell = vec2(sin(uTime * 0.766 - iA.x * 0.09), cos(uTime * 0.61 - iA.z * 0.07)) * 0.3;
    vec2 d = (swell + vec2(sin(ph), cos(ph * 0.77)) * 0.06) * flex * t * t * some;
    float h = max(w.y - iA.y, 0.1);
    w += vec3(d.x, -dot(d, d) / (h * 2.0), d.y);
  }
  vWorld = w; vN = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;
const FS = /* glsl */`
precision highp float;
${COMMON}
uniform vec3 cameraPosition;
uniform sampler2D uCaust;
uniform vec3 uAguaCeu;
${AGUA_GLSL}
${CAUSTICA_GLSL}
in vec3 vWorld, vN, vLocal, vC1, vC2;
in vec4 vData, vInfo;
out vec4 outColor;
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z); }
float polipos(vec3 p, float esp) { vec3 q = p * (3.14159 / esp); vec3 w = q + sin(q.yzx * 0.47) * 1.4 + sin(q.zxy * 0.29 + 1.7) * 1.1; return abs(sin(w.x) * sin(w.y) * sin(w.z)); }
// cáusticas do sol no fundo (duas redes que andam em sentidos diferentes)
float causticas(vec2 p, float t) {
  vec2 a = p * 0.55 + vec2(t * 0.11, t * 0.07), b = p * 0.43 - vec2(t * 0.09, -t * 0.12);
  float c = abs(sin(a.x + sin(a.y * 1.3)) * sin(a.y + sin(a.x * 1.1))) + abs(sin(b.x * 1.2 + sin(b.y)) * sin(b.y * 0.9 + sin(b.x * 1.4)));
  return pow(max(1.0 - c * 0.75, 0.0), 4.0);
}
void main() {
  float st = floor(vInfo.y + 0.5), seed = vInfo.x;
  float t = vData.x, ao = vData.y, part = vData.z, rnd = vData.w;
  vec3 P = vLocal + seed * 17.0;
  float px = length(fwidth(vWorld));
  float n1 = vn3(P * 3.0) - 0.5, n2 = vn3(P * 9.0 + 3.7) - 0.5;
  vec3 c1 = vC1 * (1.0 + vec3(n1, n1 * 0.5, -n1 * 0.5) * 0.36) * (1.0 + n2 * 0.24);
  vec3 alb = c1;
  float fina = 1.0 - smoothstep(0.01, 0.04, px);
  if (st == ${S.rock}.0) {                          // rocha do recife: tufo de algas, crosta coralina rosada nas laterais
    float up = clamp(normalize(vN).y, 0.0, 1.0);
    alb = mix(alb, vec3(0.14, 0.11, 0.07), smoothstep(-0.2, 0.3, n1 + up * 0.3) * 0.6);
    alb = mix(alb, vC2 * (0.9 + n2 * 0.3), smoothstep(0.05, 0.3, vn3(P * 5.0) * 0.8 - 0.25) * (1.0 - up * 0.5) * 0.85);
  } else if (st == ${S.brain}.0 || st == ${S.brainWide}.0) {   // cérebro: sulcos em labirinto
    float k = st == ${S.brain}.0 ? 22.0 : 13.0;
    float m = abs(sin((vn3(P * 2.2) * 6.0 + P.x * 0.6) * k * 0.15 + vn3(P * 7.0) * 2.0));
    alb = mix(vC2, alb, smoothstep(0.15, 0.55, m) * mix(1.0, 0.5, 1.0 - fina) + (1.0 - fina) * 0.3);
  } else if (st == ${S.star}.0 || st == ${S.porites}.0 || st == ${S.pillar}.0) {   // copos dos pólipos
    float pp = polipos(P, st == ${S.porites}.0 ? 0.004 : 0.009) * fina;
    alb *= 0.82 + pp * 0.35; alb = mix(alb, vC2, smoothstep(0.3, 0.7, n1 + 0.5) * 0.35);
  } else if (st == ${S.acropora}.0 || st == ${S.finger}.0 || st == ${S.fire}.0) {   // pontas claras de crescimento
    alb = mix(alb, vC2, smoothstep(0.78, 0.98, t)); alb *= 0.85 + polipos(P, 0.006) * 0.3 * fina;
  } else if (st == ${S.plate}.0 || st == ${S.lettuce}.0) {
    alb = mix(alb, vC2, smoothstep(0.7, 1.0, t) * 0.6);
  } else if (st == ${S.gorgonian}.0 || st == ${S.plume}.0) {
    alb = mix(vC2, alb, smoothstep(0.0, 0.25, t)); alb *= 0.85 + polipos(P, 0.004) * 0.3 * fina;
  } else if (st == ${S.fan}.0) {                    // leque-do-mar: treliça vazada
    vec2 g = vLocal.xy * 38.0 + vec2(vn3(P * 6.0), vn3(P * 6.0 + 9.0)) * 2.5;
    float malha = min(abs(fract(g.x) - 0.5), abs(fract(g.y + g.x * 0.3) - 0.5));
    if (malha > 0.17 && t > 0.08 && px < 0.06) discard;
    alb = mix(vC2, alb, smoothstep(0.0, 0.2, t));
  } else if (st == ${S.sponge}.0) {                 // poros escuros
    float poro = smoothstep(0.75, 0.9, vn3(P * 26.0)) * fina;
    alb = mix(alb, vC2, poro * 0.8 + smoothstep(0.85, 1.0, t) * 0.3 * (1.0 - step(0.5, part)));
  } else if (st == ${S.urchin}.0) { alb = mix(alb, vC2, t);
  } else if (st == ${S.anemone}.0) { alb = mix(alb, vC2, smoothstep(0.4, 1.0, t));
  } else if (st == ${S.grass}.0 || st == ${S.algae}.0 || st == ${S.sargassum}.0) {
    alb = mix(alb, vC2, smoothstep(0.8, 1.0, t) * 0.5);
  } else if (st == ${S.kelp}.0) {                   // kelp gigante com nervuras translúcidas e fagulhas verde/ouro
    float rib = abs(sin(vLocal.y * 28.0 + vn3(P * 8.0) * 3.0));
    alb = mix(alb, vC2 * 0.82, smoothstep(0.55, 1.0, t) * 0.42 + (1.0 - rib) * 0.18 * step(0.5, part));
  } else if (st == ${S.iridescent}.0 || st == ${S.magenta}.0) {  // folhagem roxo/rosa iridescente e tapete magenta
    alb = mix(alb, vC2, smoothstep(0.35, 0.95, t) * 0.65 + part * 0.25);
  } else if (st == ${S.ship}.0) {                   // casco de galeão naufragado: tábuas escuras + musgo/cracas
    float plank = smoothstep(0.1, 0.25, abs(fract(vLocal.y * 5.5 + n1 * 0.4) - 0.5));
    alb *= 0.72 + 0.28 * plank;
    alb = mix(alb, vC2, smoothstep(0.15, 0.55, n1 + 0.35) * (0.4 + 0.4 * part));
  } else if (st == ${S.whale}.0) {                  // escultura de cauda de baleia em pedra com pátina dourada/turquesa
    alb = mix(alb, vC2, smoothstep(0.2, 0.75, n1 + part * 0.45) * 0.58);
  } else if (st == ${S.rubble}.0) { alb = mix(alb, vC2, smoothstep(0.2, 0.5, n1 + 0.3) * 0.6); }
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float prof = max(${MAR_NIVEL.toFixed(2)} - vWorld.y, 0.0);
  float distOlho = length(cameraPosition - vWorld);
  // Luz da água clara (render/agua-clara.js): sol direto pela coluna d'água, com a rede de refração (render/causticas.js),
  // e a luz difusa de cima pela fundura. O que é fino (alga, leque, capim) deixa passar luz: recebe o sol também por trás.
  float ndl = clamp((dot(N, uLightDir) + 0.22) / 1.22, 0.0, 1.0);
  float redeLuz = causticaDoMar(vWorld, ${MAR_NIVEL.toFixed(2)}, distOlho);
  float cau = max(redeLuz - 1.0, 0.0);                    // quanto a rede passa da média (para as fagulhas da alga)
  float fino = (st == ${S.gorgonian}.0 || st == ${S.fan}.0 || st == ${S.grass}.0 || st == ${S.algae}.0 || st == ${S.sargassum}.0 || st == ${S.plume}.0 || st == ${S.kelp}.0 || st == ${S.iridescent}.0) ? 0.38 : 0.0;
  float cima = 0.5 + 0.5 * N.y;
  vec3 solAgua = uSunColor * aguaSol(prof, uLightDir.y);
  vec3 luz = solAgua * ((ndl * mix(1.0, redeLuz, smoothstep(-0.3, 0.5, N.y)) + fino * 0.3) * 0.9)
           + (uAguaCeu * aguaCeu(prof) * (0.22 + 0.78 * cima) + solAgua * vec3(0.05, 0.046, 0.034) * (1.0 - cima)) * (0.45 + 0.55 * ao);
  vec3 cor = alb * luz * (0.5 + 0.5 * ao);
  // Fagulhas verde/ouro cintilantes nas colunas de Kelp quando tocadas pela luz e pelas cáusticas
  if (st == ${S.kelp}.0) {
    vec3 H = normalize(uLightDir + V);
    float cellSpeck = h31(floor(P * 70.0));
    float glint = smoothstep(0.86, 0.995, cellSpeck) * (0.35 + 0.65 * pow(max(dot(N, H), 0.0), 14.0)) * (0.45 + 1.35 * cau) * smoothstep(0.0035, 0.012, px);
    vec3 goldGreen = mix(vec3(0.22, 1.0, 0.52), vec3(1.0, 0.86, 0.28), fract(cellSpeck * 17.3));
    cor += goldGreen * glint * 1.35 * exp(-prof * 0.022);
  }
  // Iridescência Fresnel de filme fino + bioluminescência suave na folhagem roxa/rosa, tapete magenta, leques e anêmonas
  if (st == ${S.iridescent}.0 || st == ${S.magenta}.0 || st == ${S.anemone}.0 || st == ${S.fan}.0) {
    float fres = pow(1.0 - abs(dot(N, V)), 2.2);
    vec3 irid = 0.5 + 0.5 * cos(6.28318 * (fres * 0.75 + t * 0.4 + vec3(0.82, 0.14, 0.56)));
    float strength = (st == ${S.iridescent}.0 || st == ${S.magenta}.0) ? 0.52 : 0.24;
    cor = mix(cor, cor * 0.6 + irid * (0.45 + 0.55 * luz), fres * strength);
    if (st == ${S.iridescent}.0 || st == ${S.magenta}.0) {
      cor += mix(vec3(0.88, 0.18, 0.72), vec3(0.32, 0.88, 1.0), fres) * (0.14 + 0.22 * part) * smoothstep(0.25, 1.0, t);
    }
  }
  vec4 nv = fogAt(distOlho, -V, vWorld.y);
  outColor = vec4(finish(mix(cor, nv.rgb, nv.a)), 1.0);
}
`;

// ---- Cardumes, Arraias-Manta e Bolhas/Plâncton 100% na GPU (Zero alocações JS por quadro) --------------------------
const VS_FAUNA_MAR = /* glsl */`
precision highp float;
in vec3 position, normal;
// iOrbit: centro do cardume (xyz) e raio da volta (o sinal é o sentido) · iColor: cor + (fase na volta; + 100 = arraia)
// iExtra: (segundo raio da volta, sobe-e-desce, espalhamento do cardume em metros, semente deste peixe)
in vec4 aData, iOrbit, iColor, iExtra;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform float uTime;
out vec3 vWorld, vN, vCol;
out vec4 vData;
// a volta do cardume: um laço torto, que sobe e desce (o mesmo desenho de caminho do Abyssal Garden)
vec3 caminho(vec3 c, float R, float R2, float ya, float a) {
  return c + vec3(cos(a) * R + cos(a * 2.3 + 1.3) * R2, sin(a * 1.7 + 0.6) * ya, sin(a) * R + sin(a * 1.9) * R2);
}
void main() {
  float raw = iColor.w;
  float isManta = step(100.0, raw);
  float phase = raw - isManta * 100.0;
  float R = abs(iOrbit.w);
  float dirSign = iOrbit.w >= 0.0 ? 1.0 : -1.0;
  float sem = iExtra.w;
  // o espalhamento vem com a classe de tamanho do cardume na dezena (0 = miúdos de recife … 3 = peixes grandes de mar aberto)
  float classe = floor(iExtra.z / 10.0), espalha = iExtra.z - classe * 10.0;
  // todo o cardume anda na mesma velocidade angular (senão se desfaz); a fase de cada peixe só o põe mais à frente ou atrás
  float speed = isManta > 0.5 ? (0.42 / max(R, 3.0)) : (1.35 / max(R, 2.5));
  float ang = uTime * speed * dirSign + phase * 6.2831853;
  // lugar deste peixe no cardume (um borrão achatado em volta do caminho) e um vaguear miúdo
  vec3 hs = fract(sin(vec3(sem * 127.1 + 1.7, sem * 311.7 + 4.1, sem * 74.7 + 9.2)) * 43758.5453) - 0.5;
  vec3 fora = hs * espalha * vec3(1.0, 0.55, 1.0)
            + vec3(sin(uTime * 0.7 + sem * 50.0), cos(uTime * 0.9 + sem * 31.0), sin(uTime * 0.6 + sem * 77.0)) * (0.35 * (1.0 - isManta));
  vec3 p0 = caminho(iOrbit.xyz, R, iExtra.x, iExtra.y, ang) + fora;
  vec3 p1 = caminho(iOrbit.xyz, R, iExtra.x, iExtra.y, ang + 0.04 * dirSign) + fora;
  vec3 fwd = normalize(p1 - p0 + vec3(1e-5, 0.0, 0.0));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd) + vec3(0.0, 0.0, 1e-5));
  vec3 up = cross(fwd, right);
  float scale = isManta > 0.5 ? (1.25 + 0.45 * fract(sem * 7.13)) : (0.9 + 0.5 * fract(sem * 13.7)) * (1.0 + 0.65 * classe);
  vec3 p = position * scale;
  vec3 n = normal;
  if (isManta > 0.5) {
    // Bater de asas gracioso das arraias-manta (onda viajante do peito para a ponta das asas)
    float wx = abs(aData.x);
    float flap = sin(uTime * 2.35 + sem * 19.0 - wx * 2.2 - aData.y * 1.4) * (0.28 * wx * wx + 0.04 * aData.y) * scale;
    p.y += flap;
    n = normalize(vec3(n.x - sign(aData.x) * flap * 0.45, n.y, n.z));
  } else {
    // Nado em onda S ao longo da espinha do peixe
    float bt = aData.x;
    float sway = sin(uTime * (9.0 + 5.0 * fract(sem * 7.0)) + sem * 31.0 - bt * 5.2) * (0.045 * bt * bt) * scale;
    p.x += sway;
  }
  vec3 worldPos = p0 + right * p.x + up * p.y + fwd * (-p.z);
  worldPos.y = min(worldPos.y, ${(MAR_NIVEL - 0.6).toFixed(2)});
  float fade = 1.0 - smoothstep(${(RAIO * 0.80).toFixed(1)}, ${(RAIO * 0.99).toFixed(1)}, length(p0 - cameraPosition));
  worldPos = mix(p0, worldPos, fade);
  vWorld = worldPos;
  vN = normalize(right * n.x + up * n.y - fwd * n.z);
  vCol = iColor.rgb;
  vData = vec4(aData.xyz, isManta);
  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}
`;

const FS_FAUNA_MAR = /* glsl */`
precision highp float;
${COMMON}
uniform vec3 cameraPosition;
uniform sampler2D uCaust;
uniform vec3 uAguaCeu;
${AGUA_GLSL}
${CAUSTICA_GLSL}
in vec3 vWorld, vN, vCol;
in vec4 vData;
out vec4 outColor;
void main() {
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float prof = max(${MAR_NIVEL.toFixed(2)} - vWorld.y, 0.0);
  float distOlho = length(cameraPosition - vWorld);
  float isManta = vData.w;
  vec3 alb = vCol;
  float brilho = 0.9;
  if (isManta > 0.5) {
    // Dorso azul-ardósia com marcas claras e ventre prateado
    float belly = 1.0 - vData.z;
    float spots = smoothstep(0.35, 0.7, cos(vData.x * 9.0) * cos(vData.y * 7.0));
    alb = mix(alb * (0.65 + 0.45 * spots), vec3(0.86, 0.92, 0.96), belly * 0.85);
    brilho = 0.2;
  } else {
    // Listras tropicais vibrantes e cauda iridescente
    float stripe = smoothstep(0.15, 0.55, sin(vData.x * 22.0));
    vec3 accent = vec3(vCol.b, vCol.r * 0.9 + 0.1, vCol.g);
    alb = mix(alb, accent, stripe * 0.55 + vData.z * 0.35);
  }
  // luz da água clara: sol pela coluna d'água com a rede de refração (o cardume cintila ao cruzar os fios de luz)
  float ndl = clamp(dot(N, uLightDir) * 0.7 + 0.3, 0.0, 1.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);
  float cima = 0.5 + 0.5 * N.y;
  vec3 solAgua = uSunColor * aguaSol(prof, uLightDir.y) * mix(1.0, causticaDoMar(vWorld, ${MAR_NIVEL.toFixed(2)}, distOlho), 0.8);
  vec3 ceuAgua = uAguaCeu * aguaCeu(prof);
  vec3 luz = solAgua * ndl + ceuAgua * (0.3 + 0.7 * cima) + solAgua * vec3(0.05, 0.046, 0.034) * (1.0 - cima);
  vec3 H = normalize(uLightDir + V);
  vec3 cor = alb * luz + solAgua * pow(max(dot(N, H), 0.0), 16.0) * brilho + ceuAgua * fres * 0.22;
  vec4 nv = fogAt(distOlho, -V, vWorld.y);
  outColor = vec4(finish(mix(cor, nv.rgb, nv.a)), 1.0);
}
`;

// ---- Colunas de bolhas (24/11/2026): cada fonte no chão solta bolhas que sobem até a superfície, bamboleando e
// crescendo com a subida (a mesma conta do Abyssal Garden). Um quadradinho virado para quem olha por bolha.
// iB0 = (x, y da fonte, z, fase) · iB1 = (velocidade de subida m/s, semente 1, semente 2, tamanho 0..1)
const VS_BOLHAS = /* glsl */`
precision highp float;
in vec3 position;        // canto do quadrado em xy (−1..1)
in vec4 iB0, iB1;
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform vec3 uWind;
uniform float uTime, uPx;
out vec2 vUv;
out vec3 vWorld;
out float vA;
void main() {
  float altura = max(${(MAR_NIVEL - 0.12).toFixed(2)} - iB0.y, 0.5);
  float sobe = fract(uTime * iB1.x / altura + iB0.w);
  float y = iB0.y + sobe * altura;
  vec2 vai = vec2(sin(y * 0.9 + iB1.y * 30.0) + 0.5 * sin(y * 2.3 + iB1.z * 17.0), cos(y * 0.8 + iB1.z * 30.0) + 0.5 * sin(y * 2.0 + iB1.y * 11.0));
  vec2 corrente = length(uWind.xy) > 1e-4 ? normalize(uWind.xy) : vec2(0.83, 0.55);
  vec3 c = vec3(iB0.x, y, iB0.z) + vec3(vai.x, 0.0, vai.y) * (0.06 + 0.9 * sobe * iB1.y) + vec3(corrente.x, 0.0, corrente.y) * (sobe * 1.6);
  float d = length(c - cameraPosition);
  float tam = (0.028 + 0.085 * iB1.w * iB1.w) * (1.0 + 1.6 * sobe);
  tam = max(tam, d * 1.3 / uPx);                                  // nunca menor que ~1,3 pixel: longe vira um ponto de luz
  vA = smoothstep(0.0, 0.03, sobe) * (1.0 - smoothstep(0.93, 1.0, sobe)) * smoothstep(0.5, 2.2, d) * (1.0 - smoothstep(${(RAIO * 0.8).toFixed(1)}, ${(RAIO * 0.98).toFixed(1)}, d))
     * step(cameraPosition.y, ${(MAR_NIVEL + 0.4).toFixed(2)});
  vec3 dir = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), cima = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 w = c + (dir * position.x + cima * position.y) * (tam * step(0.002, vA));
  vUv = position.xy; vWorld = w;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;
const FS_BOLHAS = /* glsl */`
precision highp float;
${COMMON}
uniform vec3 cameraPosition;
uniform vec3 uAguaCeu;
${AGUA_GLSL}
in vec2 vUv;
in vec3 vWorld;
in float vA;
out vec4 outColor;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  // bolha: aro claro, um brilho forte do sol em cima e um reflexo fraco embaixo; o miolo é quase vazio
  float aro = smoothstep(0.55, 0.88, r) * (1.0 - smoothstep(0.90, 1.0, r));
  vec2 a = vUv - vec2(-0.35, 0.42), b = vUv - vec2(0.25, -0.5);
  float alto = exp(-dot(a, a) * 22.0), baixo = exp(-dot(b, b) * 12.0) * 0.25;
  float disco = 1.0 - smoothstep(0.90, 1.0, r);
  float prof = max(${MAR_NIVEL.toFixed(2)} - vWorld.y, 0.0);
  float dist = length(cameraPosition - vWorld);
  vec3 luz = uSunColor * aguaSol(prof, uLightDir.y) * 0.55 + uAguaCeu * aguaCeu(prof) * 1.2;
  vec3 cor = luz * vec3(0.80, 0.97, 1.0) * (aro * 0.55 + alto * 1.6 + baixo + disco * 0.05) * exp(-AGUA_EXT * dist) * vA;
  outColor = vec4(finish(cor), vA * disco * 0.10);
}
`;

// Partículas submersas toroidais 100% na GPU: bolhas subindo em hélice + partículas douradas/ciano flutuando
const VS_PARTICULAS_MAR = /* glsl */`
precision highp float;
in vec3 position, normal;
in vec4 iSeed; // (x0, y0, z0, kindAndPhase) kind >= 0.5 = bolha subindo, < 0.5 = plâncton/fagulha flutuando
uniform mat4 viewMatrix, projectionMatrix;
uniform vec3 cameraPosition;
uniform float uTime;
out vec3 vWorld, vN;
out vec2 vKind; // (isBubble, seed)
void main() {
  float isBubble = step(0.5, iSeed.w);
  float ph = fract(iSeed.w * 17.31);
  vec3 box = vec3(34.0, 16.0, 34.0);
  vec3 drift = isBubble > 0.5
    ? vec3(sin(uTime * 1.9 + ph * 25.0) * 0.38, uTime * (1.15 + ph * 0.85), cos(uTime * 1.7 + ph * 19.0) * 0.38)
    : vec3(sin(uTime * 0.45 + ph * 14.0) * 1.1, sin(uTime * 0.6 + ph * 21.0) * 0.45, cos(uTime * 0.4 + ph * 17.0) * 1.1);
  vec3 rel = mod(iSeed.xyz + drift - cameraPosition + box * 0.5, box) - box * 0.5;
  vec3 center = cameraPosition + rel;
  // Só desenha abaixo da superfície do mar e acima do fundo próximo
  float under = step(center.y, ${(MAR_NIVEL - 0.3).toFixed(2)}) * step(cameraPosition.y, ${(MAR_NIVEL + 6.0).toFixed(2)});
  float r = isBubble > 0.5 ? (0.04 + 0.055 * ph) : (0.015 + 0.018 * ph);
  float distFade = 1.0 - smoothstep(11.0, 16.5, length(rel));
  vec3 w = center + position * (r * under * distFade);
  vWorld = w; vN = normal; vKind = vec2(isBubble, ph);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const FS_PARTICULAS_MAR = /* glsl */`
precision highp float;
${COMMON}
uniform vec3 cameraPosition;
in vec3 vWorld, vN;
in vec2 vKind;
out vec4 outColor;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vWorld);
  float isBubble = vKind.x, ph = vKind.y;
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.0);
  vec3 H = normalize(uLightDir + V);
  float spec = pow(max(dot(N, H), 0.0), 24.0);
  vec3 cor = isBubble > 0.5
    ? mix(vec3(0.35, 0.82, 0.98), vec3(1.0), fres * 0.65 + spec * 0.9)
    : mix(vec3(0.28, 1.0, 0.64), vec3(1.0, 0.88, 0.34), ph) * (0.75 + 0.6 * spec);
  vec4 nv = fogAt(length(cameraPosition - vWorld), -V, vWorld.y);
  outColor = vec4(finish(mix(cor, nv.rgb, nv.a)), 1.0);
}
`;

export function initRecife({ scene, camera, game }) {
  const pc = game.plataforma === 'pc' || !game.plataforma;
  const raio = pc ? RAIO : RAIO * 0.42;
  // modelos (perto = nível 0, longe = nível 2), um lote de instâncias por tipo e nível
  const mat = new THREE.RawShaderMaterial({ name: 'recife', glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide });
  mat.uniforms = U;
  const lotes = new Map();   // "tipo:nivel" -> { g, m, max, n }
  const geoCache = new Map();
  function lote(tipo, nivel) {
    const k = tipo + ':' + nivel;
    let l = lotes.get(k);
    if (l) return l;
    const T = TYPES[tipo];
    const gk = T.model + ':' + nivel;
    let base = geoCache.get(gk);
    if (!base) { base = MODELS[T.model](rngDe(hash32(gk.length, nivel, 77) ^ 0x5bd1), nivel); geoCache.set(gk, base); }
    const g = new THREE.InstancedBufferGeometry();
    for (const a of ['position', 'normal', 'aData']) g.setAttribute(a, base.attributes[a]);
    g.setIndex(base.index);
    const max = 2048;
    for (const a of ['iA', 'iQ', 'iB', 'iC1', 'iC2']) g.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.visible = false; m.name = 'recife-' + k;
    scene.add(m);
    l = { g, m, max, n: 0 };
    lotes.set(k, l);
    return l;
  }
  // zona de um ponto do fundo: [crista, frente, trás, manchas, talude, fundo] (pesos)
  function zona(prof, s) {
    if (prof < 1.0 || s < 4) return null;
    if (prof > FUNDO_ATE) return null;
    const z = [0, 0, 0, 0, 0, 0];
    if (prof > FUNDO_DE) { z[5] = 1; return z; }
    if (prof < 3.8 && s > 14 && s < 46) z[0] = 1;
    else if (prof < 4 && s <= 14) z[2] = 1;
    else if (prof < 10) z[1] = 1;
    else z[4] = 1;
    return z;
  }
  const celulas = new Map();
  function celula(cx, cz) {
    const k = cx + ',' + cz;
    let c = celulas.get(k);
    if (c) return c;
    c = [];
    const gen = game.gen, arq = gen.arq, seed = gen.seed >>> 0;
    for (let li = 0; li < LAYERS.length; li++) {
      const L = LAYERS[li], rnd = rngDe(hash32(cx, cz, seed ^ (li * 7919)));
      const n = Math.floor(CEL / L.spacing);
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = cx * CEL + (i + rnd()) * L.spacing, z = cz * CEL + (j + rnd()) * L.spacing;
        const s = arq.s(x, z);
        if (s < 3 || arq.p(x, z) > 0) { rnd(); rnd(); continue; }
        const topo = gen.height(Math.floor(x), Math.floor(z)) + 1, prof = MAR_NIVEL - topo;
        if (s > 160 && prof <= FUNDO_DE) { rnd(); rnd(); continue; }      // raso longe da costa (banco de areia): fica limpo
        const zn = zona(prof, s);
        if (!zn) { rnd(); continue; }
        const zi = zn.indexOf(1), fundo = zi === 5;
        // manchas de recife e canais de areia (a estrutura só onde a mancha é forte)
        const F = vnoise(x * 0.045, z * 0.045, seed ^ 0x2468) * 0.65 + vnoise(x * 0.13, z * 0.13, seed ^ 0x1357) * 0.35;
        let floresta = 0;
        if (fundo) {
          // no fundo a vida vem em manchas largas: jardins de 60 a 100 m separados por areia, e florestas de alga
          const jardim = vnoise(x * 0.012, z * 0.012, seed ^ 0x6a7d) * 0.7 + vnoise(x * 0.031, z * 0.031, seed ^ 0x33c1) * 0.3;
          floresta = vnoise(x * 0.017 + 9.3, z * 0.017 - 4.1, seed ^ 0x5eaf);
          if (jardim < 0.43 && floresta < 0.6) { rnd(); continue; }
          if (L.sand ? F > 0.7 : F < 0.3 + L.allow * 0.4) { rnd(); continue; }
        } else if (L.sand ? F > 0.62 : F < 0.38 + L.allow * 0.5) { rnd(); continue; }
        // sorteio do tipo pela abundância na zona (no fundo, a tabela FUNDO; a alga gigante quase só nas florestas)
        const tabela = fundo ? FUNDO[li] : L.types;
        const peso = (t) => (fundo ? tabela[t] * (t === 'kelp' ? (floresta > 0.6 ? 9 : 0.12) : (floresta > 0.6 ? 0.45 : 1)) : tabela[t][zi]);
        let tot = 0; for (const t in tabela) tot += peso(t);
        if (tot <= 0) { rnd(); continue; }
        let r = rnd() * tot * (L.sand ? 4 : fundo ? 2.2 : 1.25), tipo = null;   // parte das vagas fica vazia (respiro; no fundo, mais)
        for (const t in tabela) { r -= peso(t); if (r <= 0) { tipo = t; break; } }
        if (!tipo) continue;
        const T = TYPES[tipo];
        if (tipo === 'kelp' && prof < 4.2) continue;
        if (tipo === 'arch' && prof < 5.5) continue;
        let esc = T.scale[0] + (T.scale[1] - T.scale[0]) * Math.pow(rnd(), 1.6);
        const sy = T.sy[0] + (T.sy[1] - T.sy[0]) * rnd(), sxz = T.sxz[0] + (T.sxz[1] - T.sxz[0]) * rnd();
        if (tipo === 'kelp' && fundo) esc *= 1.55;                // no fundo a alga é gigante de verdade (até ~20 m)
        if (tipo === 'kelp') esc = Math.min(esc, Math.max(2.2, (prof - 0.75) / sy));
        if (tipo === 'arch') esc = Math.min(esc, Math.max(2.6, (prof - 1.1) / (sy * 1.2)));
        // alinhado entre o vertical e a inclinação do fundo
        const hx = gen.height(Math.floor(x) + 1, Math.floor(z)) - gen.height(Math.floor(x) - 1, Math.floor(z));
        const hz = gen.height(Math.floor(x), Math.floor(z) + 1) - gen.height(Math.floor(x), Math.floor(z) - 1);
        const nrm = new THREE.Vector3(-hx * 0.5, 1, -hz * 0.5).normalize();
        const eixo = new THREE.Vector3(0, 1, 0).lerp(nrm, T.align).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), eixo).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2));
        const c1 = srgbLin(T.c1[Math.floor(rnd() * T.c1.length)]), c2 = srgbLin(T.c2[Math.floor(rnd() * T.c2.length)]);
        const v = 0.88 + rnd() * 0.24;
        c.push({ tipo, x, y: topo - T.sink * esc * sy - 0.15, z, esc, sy, sxz, q, c1: c1.map((a) => a * v), c2, seed: rnd(), flex: T.flex ?? (T.s === S.rock || T.s === S.star || T.s === S.brain || T.s === S.brainWide ? -0.06 : 0) });
      }
    }
    // Set pieces determinísticos (Casco de Galeão Naufragado, Escultura de Cauda de Baleia em Pedra e Arcos Monumentais)
    // em células costeiras fundas (prof 6.5..18.5 m), sem jamais colidir nem alterar voxels
    const hSet = hash32(cx, cz, seed ^ 0x9e3779b9);
    if ((hSet % 19) === 0) {
      const rndS = rngDe(hSet);
      const sx = cx * CEL + (0.25 + rndS() * 0.5) * CEL, sz = cz * CEL + (0.25 + rndS() * 0.5) * CEL;
      const ss = arq.s(sx, sz);
      if (ss >= 14 && arq.p(sx, sz) <= 0) {
        const topoS = gen.height(Math.floor(sx), Math.floor(sz)) + 1, profS = MAR_NIVEL - topoS;
        if (profS >= 6.8 && profS <= FUNDO_ATE && (ss <= 145 || profS > FUNDO_DE)) {
          const piece = (hSet >>> 5) % 3 === 0 ? 'shipHull' : (hSet >>> 5) % 3 === 1 ? 'whaleFluke' : 'arch';
          const TS = TYPES[piece];
          const escS = Math.min((TS.scale[0] + (TS.scale[1] - TS.scale[0]) * rndS()) * (profS > FUNDO_DE ? 1.5 : 1), Math.max(3.2, profS - 1.4));
          const qS = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rndS() * Math.PI * 2);
          c.push({
            tipo: piece, x: sx, y: topoS - TS.sink * escS - 0.12, z: sz,
            esc: escS, sy: 1, sxz: 1, q: qS,
            c1: srgbLin(TS.c1[0]), c2: srgbLin(TS.c2[0]), seed: rndS(), flex: 0,
          });
        }
      }
    }
    celulas.set(k, c);
    if (celulas.size > 400) celulas.delete(celulas.keys().next().value);
    return c;
  }

  // ---- Malhas instanciadas de Arraias-Manta, Cardumes de Peixes e Partículas Submersas (Zero GC por frame) ----------
  const matFauna = new THREE.RawShaderMaterial({ name: 'recife-fauna-mar', glslVersion: THREE.GLSL3, vertexShader: VS_FAUNA_MAR, fragmentShader: FS_FAUNA_MAR, side: THREE.DoubleSide });
  matFauna.uniforms = U;
  const matPart = new THREE.RawShaderMaterial({ name: 'recife-particulas-mar', glslVersion: THREE.GLSL3, vertexShader: VS_PARTICULAS_MAR, fragmentShader: FS_PARTICULAS_MAR });
  matPart.uniforms = U;

  function criarLoteFauna(baseGeo, max, name) {
    const g = new THREE.InstancedBufferGeometry();
    for (const a of ['position', 'normal', 'aData']) g.setAttribute(a, baseGeo.attributes[a]);
    g.setIndex(baseGeo.index);
    g.setAttribute('iOrbit', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.setAttribute('iExtra', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, matFauna); m.frustumCulled = false; m.visible = false; m.name = name;
    scene.add(m);
    return { g, m, max, n: 0 };
  }
  // um bicho no lote: centro e raio da volta, cor, fase (+100 = arraia), segundo raio, sobe-e-desce, espalhamento, semente
  function poe(lf, x, y, z, R, cor, fase, R2, ya, esp, sem) {
    if (lf.n >= lf.max) return false;
    const k = lf.n * 4, o = lf.g.attributes.iOrbit.array, c = lf.g.attributes.iColor.array, e = lf.g.attributes.iExtra.array;
    o[k] = x; o[k + 1] = y; o[k + 2] = z; o[k + 3] = R;
    c[k] = cor[0]; c[k + 1] = cor[1]; c[k + 2] = cor[2]; c[k + 3] = fase;
    e[k] = R2; e[k + 1] = ya; e[k + 2] = esp; e[k + 3] = sem;
    lf.n++;
    return true;
  }
  const loteMantas = criarLoteFauna(Geo.createMantaRay(pc ? 0 : 1), pc ? 72 : 24, 'recife-arraias-manta');
  const lotePeixes = criarLoteFauna(Geo.createReefFish(pc ? 0 : 1), pc ? 1500 : 320, 'recife-cardumes');            // cardumes perto de quem olha
  const lotePeixesLonge = criarLoteFauna(Geo.createReefFish(1), pc ? 5200 : 700, 'recife-cardumes-longe');            // os de longe: peixe de 40 triângulos

  // colunas de bolhas: um quadradinho por bolha, tudo na placa (VS_BOLHAS)
  const maxBolhas = pc ? 3600 : 520;
  const gBolhas = new THREE.InstancedBufferGeometry();
  gBolhas.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  gBolhas.setIndex([0, 1, 2, 0, 2, 3]);
  gBolhas.setAttribute('iB0', new THREE.InstancedBufferAttribute(new Float32Array(maxBolhas * 4), 4));
  gBolhas.setAttribute('iB1', new THREE.InstancedBufferAttribute(new Float32Array(maxBolhas * 4), 4));
  gBolhas.instanceCount = 0;
  const matBolhas = new THREE.RawShaderMaterial({ name: 'recife-bolhas', glslVersion: THREE.GLSL3, vertexShader: VS_BOLHAS, fragmentShader: FS_BOLHAS,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });
  matBolhas.uniforms = { ...U, uPx: { value: 900 } };
  const meshBolhas = new THREE.Mesh(gBolhas, matBolhas);
  meshBolhas.frustumCulled = false; meshBolhas.visible = false; meshBolhas.renderOrder = 4; meshBolhas.name = 'recife-bolhas';
  scene.add(meshBolhas);
  let nBolhas = 0;

  // Partículas submersas pré-alocadas 1 única vez (bolhas subindo + plâncton verde/ouro flutuando)
  const nPart = pc ? 960 : 420;
  const gPart = new THREE.InstancedBufferGeometry();
  const sph = new THREE.OctahedronGeometry(1, 1);
  gPart.setAttribute('position', sph.attributes.position);
  gPart.setAttribute('normal', sph.attributes.normal);
  if (sph.index) gPart.setIndex(sph.index);
  const seedArr = new Float32Array(nPart * 4);
  const rngP = rngDe(20261124);
  for (let i = 0; i < nPart; i++) {
    seedArr[i * 4]     = (rngP() - 0.5) * 34;
    seedArr[i * 4 + 1] = (rngP() - 0.5) * 16;
    seedArr[i * 4 + 2] = (rngP() - 0.5) * 34;
    seedArr[i * 4 + 3] = (i < nPart * 0.34 ? 1.0 : 0.0) + rngP() * 0.49;
  }
  gPart.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seedArr, 4));
  gPart.instanceCount = nPart;
  const meshPart = new THREE.Mesh(gPart, matPart);
  meshPart.frustumCulled = false; meshPart.visible = false; meshPart.name = 'recife-particulas-mar';
  scene.add(meshPart);

  const FISH_PAL = [
    [0.15, 0.78, 0.95], [1.0, 0.72, 0.14], [0.95, 0.32, 0.68],
    [0.24, 0.92, 0.58], [0.62, 0.36, 0.98], [1.0, 0.45, 0.22],
  ];
  let ultimo = null, genUsado = null;
  const tmp = new THREE.Vector3();
  let orcamento = 0, faltou = false;
  function refazer(px, pz) {
    faltou = false;
    for (const l of lotes.values()) l.n = 0;
    loteMantas.n = 0; lotePeixes.n = 0; lotePeixesLonge.n = 0;
    const fontes = [];                              // fontes de bolhas à vista: [x, y, z, quantas, semente]
    const gen = game.gen, arq = gen.arq, seed = gen.seed >>> 0;
    const c0x = Math.floor((px - raio) / CEL), c1x = Math.floor((px + raio) / CEL), c0z = Math.floor((pz - raio) / CEL), c1z = Math.floor((pz + raio) / CEL);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      if (!celulas.has(cx + ',' + cz)) { if (orcamento <= 0) { faltou = true; continue; } orcamento--; }
      const lista = celula(cx, cz);
      for (const o of lista) {
        const d = Math.hypot(o.x - px, o.z - pz);
        if (d > raio) continue;
        const nivel = d < Math.min(PERTO_MAX, PERTO * Math.max(1, o.esc)) ? 0 : 2;
        const l = lote(o.tipo, nivel);
        if (l.n >= l.max) continue;
        const k = l.n * 4, T = TYPES[o.tipo];
        const oArr = l.g.attributes.iA.array, qArr = l.g.attributes.iQ.array, bArr = l.g.attributes.iB.array, c1Arr = l.g.attributes.iC1.array, c2Arr = l.g.attributes.iC2.array;
        oArr[k] = o.x; oArr[k + 1] = o.y; oArr[k + 2] = o.z; oArr[k + 3] = o.esc;
        qArr[k] = o.q.x; qArr[k + 1] = o.q.y; qArr[k + 2] = o.q.z; qArr[k + 3] = o.q.w;
        bArr[k] = o.sxz; bArr[k + 1] = o.sy; bArr[k + 2] = o.sxz; bArr[k + 3] = o.flex;
        c1Arr[k] = o.c1[0]; c1Arr[k + 1] = o.c1[1]; c1Arr[k + 2] = o.c1[2]; c1Arr[k + 3] = o.seed;
        c2Arr[k] = o.c2[0]; c2Arr[k + 1] = o.c2[1]; c2Arr[k + 2] = o.c2[2]; c2Arr[k + 3] = T.s;
        l.n++;
      }
      // peça com fonte de bolhas própria: o casco naufragado solta ar preso
      for (const o of lista) if (o.tipo === 'shipHull' && Math.hypot(o.x - px, o.z - pz) <= raio) fontes.push([o.x, o.y + 0.6, o.z, 30, hash32(cx, cz, 911)]);
    }
    // ---- Cardumes e arraias (24/11/2026): um cardume por célula larga de 32 m em 7 de cada 10 células, em qualquer
    // fundura a partir de 4 m — inclusive no mar aberto e sobre o fundo de 30 a 40 m. O cardume inteiro dá uma volta larga
    // e torta em bloco (VS_FAUNA_MAR); os de perto usam o peixe detalhado, os de longe o simples.
    {
      const q0x = Math.floor((px - raio - 16) / CARDUME_CEL), q1x = Math.floor((px + raio + 16) / CARDUME_CEL);
      const q0z = Math.floor((pz - raio - 16) / CARDUME_CEL), q1z = Math.floor((pz + raio + 16) / CARDUME_CEL);
      for (let qz = q0z; qz <= q1z; qz++) for (let qx = q0x; qx <= q1x; qx++) {
        const hF = hash32(qx, qz, seed ^ 0x517cc1b7), rndF = rngDe(hF);
        const mx = (qx + 0.2 + rndF() * 0.6) * CARDUME_CEL, mz = (qz + 0.2 + rndF() * 0.6) * CARDUME_CEL;
        const d = Math.hypot(mx - px, mz - pz);
        if (d > raio + 14 || arq.s(mx, mz) < 8) continue;
        const alt = (x, z) => gen.height(Math.floor(x), Math.floor(z)) + 1;
        const topoC = alt(mx, mz), profF = MAR_NIVEL - topoC;
        if (profF < 4.2 || profF > FUNDO_ATE) continue;
        let R = 5 + rndF() * 9;
        // o chão mais alto por onde a volta passa: o cardume nada acima dele
        const topoF = Math.max(topoC, alt(mx + R, mz), alt(mx - R, mz), alt(mx, mz + R), alt(mx, mz - R));
        const livre = MAR_NIVEL - topoF - 3.0;                  // água onde o cardume cabe, com folga do chão e da superfície
        if (livre < 1.2) continue;
        const sentido = rndF() < 0.5 ? 1 : -1;
        // Arraia-manta planando: no raso perto do recife e no mar aberto, às vezes em par
        if (profF >= 5.5 && (hF % 3) === 0) {
          const Rm = Math.min(7 + rndF() * 9, 16), ym = topoF + 1.8 + Math.min(livre * 0.62, 18);
          const n = rndF() < 0.35 ? 2 : 1, f0 = rndF();
          for (let k = 0; k < n; k++) poe(loteMantas, mx, ym + k * 1.4, mz, Rm * sentido, [0.16, 0.24, 0.36], 100.0 + (f0 + k * 0.045) % 1, Rm * 0.3, Math.min(1.8, livre * 0.1), 0, rndF());
        }
        if ((hF % 10) < 7) {
          const pal = FISH_PAL[(hF >>> 4) % FISH_PAL.length];
          const cheio = pc ? 46 + Math.floor(rndF() * rndF() * 210) : 14 + Math.floor(rndF() * 34);
          const ya = Math.min(2.6, livre * 0.2);
          const cy = topoF + 1.6 + ya + rndF() * Math.max(0.4, Math.min(livre - 2 * ya - 0.6, 16));
          // classe de tamanho: recife raso = miúdos; mar aberto e fundo = também médios e grandes (em cardumes menores)
          const classe = profF < 9 ? (rndF() < 0.75 ? 0 : 1) : Math.min(3, Math.floor(rndF() * rndF() * 4.2));
          const R2 = R * (0.22 + rndF() * 0.2), esp = Math.min(9.5, Math.min(1.5 + rndF() * 2.4 + cheio * 0.008 + classe * 0.9, Math.max(1.2, livre * 0.8))) + classe * 10;
          const fase0 = rndF();
          const quantos = Math.max(8, Math.round(cheio / (1 + classe * 0.9)));
          const lf = d - R < 24 ? lotePeixes : lotePeixesLonge;
          for (let f = 0; f < quantos; f++) {
            const fase = (fase0 + (rndF() - 0.5) * 0.07 + 1) % 1;
            if (!poe(lf, mx, cy, mz, R * sentido, pal, fase, R2, ya, esp, rndF()) && !poe(lf === lotePeixes ? lotePeixesLonge : lotePeixes, mx, cy, mz, R * sentido, pal, fase, R2, ya, esp, rndF())) break;
          }
        }
      }
    }
    // ---- Fontes de bolhas: 1 em cada 3 células de 24 m tem uma; a coluna sobe do chão até a superfície ----
    {
      nBolhas = 0;
      const b0 = gBolhas.attributes.iB0.array, b1 = gBolhas.attributes.iB1.array;
      const f0x = Math.floor((px - raio) / FONTE_CEL), f1x = Math.floor((px + raio) / FONTE_CEL), f0z = Math.floor((pz - raio) / FONTE_CEL), f1z = Math.floor((pz + raio) / FONTE_CEL);
      for (let fz = f0z; fz <= f1z; fz++) for (let fx = f0x; fx <= f1x; fx++) {
        const h = hash32(fx, fz, seed ^ 0x0b01ba5);
        if ((h % 100) >= 46) continue;
        const r = rngDe(h), x = (fx + 0.15 + r() * 0.7) * FONTE_CEL, z = (fz + 0.15 + r() * 0.7) * FONTE_CEL;
        if (Math.hypot(x - px, z - pz) > raio || arq.s(x, z) < 6 || arq.p(x, z) > 0) continue;
        const topo = gen.height(Math.floor(x), Math.floor(z)) + 1, prof = MAR_NIVEL - topo;
        if (prof < 2.5 || prof > FUNDO_ATE) continue;
        fontes.push([x, topo + 0.08, z, (pc ? 34 : 10) + Math.floor(r() * (pc ? 50 : 14)), h]);
      }
      for (const [x, y, z, n, h] of fontes) {
        const r = rngDe(h ^ 0x7f4a7c15);
        for (let k = 0; k < n && nBolhas < maxBolhas; k++) {
          const i = nBolhas * 4;
          b0[i] = x + (r() - 0.5) * 0.5; b0[i + 1] = y; b0[i + 2] = z + (r() - 0.5) * 0.5; b0[i + 3] = r();
          b1[i] = 0.9 + r() * 1.3; b1[i + 1] = r(); b1[i + 2] = r(); b1[i + 3] = r();
          nBolhas++;
        }
      }
      gBolhas.instanceCount = nBolhas;
      gBolhas.attributes.iB0.needsUpdate = true; gBolhas.attributes.iB1.needsUpdate = true;
    }
    for (const l of lotes.values()) {
      l.g.instanceCount = l.n; l.m.visible = l.n > 0;
      for (const a of ['iA', 'iQ', 'iB', 'iC1', 'iC2']) l.g.attributes[a].needsUpdate = true;
    }
    for (const lf of [loteMantas, lotePeixes, lotePeixesLonge]) {
      lf.g.instanceCount = lf.n; lf.m.visible = lf.n > 0;
      lf.g.attributes.iOrbit.needsUpdate = true;
      lf.g.attributes.iColor.needsUpdate = true;
      lf.g.attributes.iExtra.needsUpdate = true;
    }
  }
  game.hooks.frame.push(() => {
    const on = !!(game.gen && game.gen.arq && game.dim === 0);
    if (!on) {
      for (const l of lotes.values()) l.m.visible = false;
      loteMantas.m.visible = false; lotePeixes.m.visible = false; lotePeixesLonge.m.visible = false; meshPart.visible = false; meshBolhas.visible = false;
      return;
    }
    camera.getWorldPosition(tmp);
    meshPart.visible = tmp.y < MAR_NIVEL + 5.5 && (lotePeixes.n > 0 || lotes.size > 0);
    meshBolhas.visible = nBolhas > 0 && tmp.y < MAR_NIVEL + 0.4;
    // pixels por radiano (para a bolha de longe nunca ficar menor que um ponto)
    matBolhas.uniforms.uPx.value = (globalThis.LAVRA?.renderer?.domElement?.height || 900) / (2 * Math.tan((camera.fov || 72) * Math.PI / 360));
    if (genUsado !== game.gen) { genUsado = game.gen; celulas.clear(); ultimo = null; }
    orcamento = 3;                                  // células novas por quadro (geração em parcelas)
    if (!ultimo || faltou || Math.hypot(tmp.x - ultimo[0], tmp.z - ultimo[1]) > 5) { ultimo = [tmp.x, tmp.z]; refazer(tmp.x, tmp.z); }
  });
  game.recife = { lotes, celulas, loteMantas, lotePeixes, lotePeixesLonge, meshPart, meshBolhas,
    // contagem do que está à vista agora (para a sonda e para quem quiser mostrar)
    get stats() { let o = 0; for (const l of lotes.values()) o += l.n; return { organismos: o, peixes: lotePeixes.n + lotePeixesLonge.n, arraias: loteMantas.n, bolhas: nBolhas, celulas: celulas.size }; } };
}
