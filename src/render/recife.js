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

const S = { rock: 0, star: 1, brain: 2, brainWide: 3, porites: 4, acropora: 5, finger: 6, fire: 7, plate: 8, pillar: 9, gorgonian: 10, sponge: 11, urchin: 12, anemone: 13, rubble: 14, grass: 15, fan: 16, plume: 17, lettuce: 18, algae: 19, sargassum: 20 };
const MODELS = {
  rock: (r, l) => Geo.createMound(r, l, 'rock'), slab: (r, l) => Geo.createMound(r, l, 'slab'), boulder: (r, l) => Geo.createMound(r, l, 'boulder'),
  knobby: (r, l) => Geo.createMound(r, l, 'knobby'), dome: Geo.createDome, lobes: Geo.createLobes, pillars: Geo.createPillars, elkhorn: Geo.createElkhorn,
  staghorn: Geo.createStaghorn, fingers: Geo.createFingers, blades: Geo.createBlades, plates: Geo.createPlates, rod: Geo.createSeaRod, whip: Geo.createWhips,
  barrel: Geo.createBarrel, tubes: (r, l) => Geo.createTubes(r, l, false), vase: (r, l) => Geo.createTubes(r, l, true), rope: Geo.createRopes, urchin: Geo.createUrchin,
  anemone: Geo.createAnemone, rubble: Geo.createRubble, grass: Geo.createSeagrass, fan: Geo.createSeaFan, plume: Geo.createSeaPlume, lettuce: Geo.createLettuce,
  wallPlates: Geo.createWallPlates, wire: Geo.createWireCoral, blackCoral: Geo.createBlackCoral, ear: Geo.createEarSponge, meadow: Geo.createMeadow,
  halimeda: Geo.createHalimeda, penicillus: Geo.createPenicillus, sargassum: Geo.createSargassum, starfish: Geo.createStarfish, cucumber: Geo.createCucumber, conch: Geo.createConch,
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
};
// abundância por zona [crista, frente, trás, manchas, talude] em cada camada (Reef.js → LAYERS); espaçamento ×1,5
// em relação ao Tidewater (o mundo do LAVRA tem muito mais recife em volta da ilha)
const LAYERS = [
  { occ: 0, spacing: 3.0, allow: 0.45, types: { slab: [1.5, 1.2, 1.5, 1.5, 0.8], rock: [1.8, 1.8, 1.6, 2, 1.2], boulder: [1.2, 3, 0.7, 1.8, 2.0], lobes: [0.4, 2.4, 0.4, 1.2, 1.8], brainWide: [1.0, 1.5, 0.5, 1.0, 0.8], elkhorn: [5, 0.3, 0, 0, 0], barrel: [0, 0.5, 0, 0.1, 0.3], barrelDeep: [0, 0, 0, 0, 1.4], pillar: [0.05, 0.2, 0.02, 0.05, 0], plate: [0, 0.35, 0, 0.15, 0.4], wallPlate: [0, 0.1, 0, 0, 1.6], ear: [0, 0.1, 0, 0.05, 0.4] } },
  { occ: 1, spacing: 0.85, allow: 0.25, types: { brain: [1.2, 0.9, 0.5, 0.8, 0.5], knobby: [1.4, 0.7, 0.7, 0.7, 0.3], starlet: [0.3, 0.5, 1.0, 0.5, 0.3], staghorn: [0.8, 4, 0.5, 1.2, 0.3], finger: [0.5, 0.4, 2, 0.6, 0], fire: [1.2, 0.15, 0.2, 0.2, 0], plate: [0, 0.25, 0, 0.1, 0.6], lobes: [0.2, 0.8, 0.2, 0.5, 0.7], elkhorn: [2.5, 0.15, 0, 0, 0], lettuce: [0.3, 0.9, 0.9, 0.6, 0.8], wallPlate: [0, 0, 0, 0, 1.0], rod: [0.6, 1.0, 0.6, 0.8, 0.3], fan: [0.8, 0.5, 0.2, 0.5, 0.2], plume: [0.2, 0.6, 0.3, 0.4, 0.2], tube: [0.4, 1.6, 0.2, 0.7, 1.4], vase: [0.1, 0.8, 0, 0.3, 1.0], rope: [0.2, 0.7, 0.2, 0.4, 0.8], ear: [0, 0.3, 0, 0.1, 0.9], anemone: [0.2, 0.2, 0.15, 0.15, 0.05], sargassum: [1.6, 0.15, 0.5, 0.2, 0] } },
  { occ: 4, spacing: 1.15, allow: 0.3, types: { rod: [2.2, 3.6, 1.4, 2.4, 1.2], plume: [0.8, 2.4, 0.8, 1.4, 1.0], whip: [0.5, 1.3, 0.6, 1.0, 1.0], fan: [2.0, 1.2, 0.3, 0.9, 0.3], fanDeep: [0, 0.2, 0, 0.1, 2.2], wire: [0, 0.05, 0, 0, 1.2], blackCoral: [0, 0, 0, 0, 0.8] } },
  { occ: 2, spacing: 0.6, allow: 0.12, types: { urchin: [0.3, 0.15, 0.4, 0.2, 0.05], rubble: [0.5, 0.8, 1.0, 0.7, 0.4], knobby: [0.3, 0.15, 0.2, 0.15, 0.1], brain: [0.15, 0.15, 0.1, 0.1, 0.1], rod: [0.4, 0.6, 0.3, 0.4, 0.3], fan: [0.3, 0.2, 0.1, 0.2, 0.2], finger: [0.2, 0.2, 0.6, 0.2, 0], starlet: [0.1, 0.15, 0.3, 0.15, 0.1], plume: [0.2, 0.3, 0.2, 0.2, 0.2], staghorn: [0.2, 0.8, 0.1, 0.2, 0], tube: [0.1, 0.35, 0.05, 0.15, 0.4], lettuce: [0.1, 0.3, 0.3, 0.2, 0.2], sargassum: [1.4, 0.1, 0.4, 0.1, 0], halimeda: [0.3, 0.25, 1.4, 0.5, 0.2], penicillus: [0.1, 0.05, 0.6, 0.2, 0] } },
  // areia: vida miúda espalhada, capim marinho em prados
  { occ: 3, spacing: 1.4, allow: -1, sand: true, types: { meadow: [0, 0, 2.5, 0.6, 0], starfish: [0.1, 0.2, 0.5, 0.3, 0.1], cucumber: [0, 0.1, 0.3, 0.2, 0.3], conch: [0.1, 0.1, 0.4, 0.2, 0.05], halimeda: [0.1, 0.1, 0.6, 0.2, 0], penicillus: [0, 0.05, 0.5, 0.1, 0] } },
];

const CEL = 16, RAIO = 58, PERTO = 13;
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
  } else if (st == ${S.rubble}.0) { alb = mix(alb, vC2, smoothstep(0.2, 0.5, n1 + 0.3) * 0.6); }
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float prof = max(${MAR_NIVEL.toFixed(2)} - vWorld.y, 0.0);
  float ndl = max(dot(N, uLightDir), 0.0);
  float cau = causticas(vWorld.xz + N.xz * 0.3, uTime) * smoothstep(-0.2, 0.6, N.y) * exp(-prof * 0.08);
  float fino = (st == ${S.gorgonian}.0 || st == ${S.fan}.0 || st == ${S.grass}.0 || st == ${S.algae}.0 || st == ${S.sargassum}.0 || st == ${S.plume}.0) ? 0.35 : 0.0;
  vec3 luz = uSunColor * (ndl * (0.75 + cau * 1.6) + fino * 0.3) * exp(-prof * vec3(0.12, 0.035, 0.02)) * 0.85
           + mix(uAmbGround, uAmbSky, 0.5 + 0.5 * N.y) * (0.45 + 0.55 * ao);
  vec3 cor = alb * luz * (0.5 + 0.5 * ao);
  vec4 nv = fogAt(length(cameraPosition - vWorld), -V, vWorld.y);
  outColor = vec4(finish(mix(cor, nv.rgb, nv.a)), 1.0);
}
`;

export function initRecife({ scene, camera, game }) {
  const pc = game.plataforma === 'pc' || !game.plataforma;
  const raio = pc ? RAIO : RAIO * 0.6;
  // modelos (perto = nível 0, longe = nível 2), um lote de instâncias por tipo e nível
  const mat = new THREE.RawShaderMaterial({ name: 'recife', glslVersion: THREE.GLSL3, uniforms: { ...U }, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide });
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
  // zona de um ponto do fundo: [crista, frente, trás, manchas, talude] (pesos)
  function zona(prof, s) {
    if (prof < 1.0 || s < 4) return null;
    if (prof > 19) return null;
    const z = [0, 0, 0, 0, 0];
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
        if (s < 3 || s > 160 || arq.p(x, z) > 0) { rnd(); rnd(); continue; }
        const topo = gen.height(Math.floor(x), Math.floor(z)) + 1, prof = MAR_NIVEL - topo;
        const zn = zona(prof, s);
        if (!zn) { rnd(); continue; }
        // manchas de recife e canais de areia (a estrutura só onde a mancha é forte)
        const F = vnoise(x * 0.045, z * 0.045, seed ^ 0x2468) * 0.65 + vnoise(x * 0.13, z * 0.13, seed ^ 0x1357) * 0.35;
        if (L.sand ? F > 0.62 : F < 0.38 + L.allow * 0.5) { rnd(); continue; }
        // sorteio do tipo pela abundância na zona
        const zi = zn.indexOf(1);
        let tot = 0; for (const t in L.types) tot += L.types[t][zi];
        if (tot <= 0) { rnd(); continue; }
        let r = rnd() * tot * (L.sand ? 4 : 1.25), tipo = null;   // parte das vagas fica vazia (respiro)
        for (const t in L.types) { r -= L.types[t][zi]; if (r <= 0) { tipo = t; break; } }
        if (!tipo) continue;
        const T = TYPES[tipo];
        const esc = T.scale[0] + (T.scale[1] - T.scale[0]) * Math.pow(rnd(), 1.6);
        const sy = T.sy[0] + (T.sy[1] - T.sy[0]) * rnd(), sxz = T.sxz[0] + (T.sxz[1] - T.sxz[0]) * rnd();
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
    celulas.set(k, c);
    if (celulas.size > 400) celulas.delete(celulas.keys().next().value);
    return c;
  }
  let ultimo = null, genUsado = null;
  const tmp = new THREE.Vector3();
  let orcamento = 0, faltou = false;
  function refazer(px, pz) {
    faltou = false;
    for (const l of lotes.values()) l.n = 0;
    const c0x = Math.floor((px - raio) / CEL), c1x = Math.floor((px + raio) / CEL), c0z = Math.floor((pz - raio) / CEL), c1z = Math.floor((pz + raio) / CEL);
    for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
      if (!celulas.has(cx + ',' + cz)) { if (orcamento <= 0) { faltou = true; continue; } orcamento--; }
      for (const o of celula(cx, cz)) {
        const d = Math.hypot(o.x - px, o.z - pz);
        if (d > raio) continue;
        const nivel = d < PERTO * Math.max(1, o.esc) ? 0 : 2;
        const l = lote(o.tipo, nivel);
        if (l.n >= l.max) continue;
        const k = l.n * 4, T = TYPES[o.tipo];
        l.g.attributes.iA.array.set([o.x, o.y, o.z, o.esc], k);
        l.g.attributes.iQ.array.set([o.q.x, o.q.y, o.q.z, o.q.w], k);
        l.g.attributes.iB.array.set([o.sxz, o.sy, o.sxz, o.flex], k);
        l.g.attributes.iC1.array.set([o.c1[0], o.c1[1], o.c1[2], o.seed], k);
        l.g.attributes.iC2.array.set([o.c2[0], o.c2[1], o.c2[2], T.s], k);
        l.n++;
      }
    }
    for (const l of lotes.values()) {
      l.g.instanceCount = l.n; l.m.visible = l.n > 0;
      for (const a of ['iA', 'iQ', 'iB', 'iC1', 'iC2']) l.g.attributes[a].needsUpdate = true;
    }
  }
  game.hooks.frame.push(() => {
    const on = !!(game.gen && game.gen.arq && game.dim === 0);
    if (!on) { for (const l of lotes.values()) l.m.visible = false; return; }
    camera.getWorldPosition(tmp);
    if (genUsado !== game.gen) { genUsado = game.gen; celulas.clear(); ultimo = null; }
    orcamento = 3;                                  // células novas por quadro (geração em parcelas)
    if (!ultimo || faltou || Math.hypot(tmp.x - ultimo[0], tmp.z - ultimo[1]) > 5) { ultimo = [tmp.x, tmp.z]; refazer(tmp.x, tmp.z); }
  });
  game.recife = { lotes, celulas };
}
