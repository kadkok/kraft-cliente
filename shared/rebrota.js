// Rebrota (pedido do Kadmus, 19/11/2026): a raiz cortada que segue fixa no chão de terra solta um broto que cresce até
// virar árvore frondosa, e o galho deixado parado na terra cria raiz própria e vira árvore também.
// Puro (sem DOM, sem Three): números, curva de crescimento, espaço livre e a descrição da árvore nova.
// O estado (árvores plantadas, relógio, galhos enraizando) mora em falling-trees.js, igual no servidor e offline.
//
// Contrato para quem desenha (Astra): `forest.plantadas` (Map id → planta) e as mensagens `planta` / `planta-`.
//   planta = { id, t: {x,y,z,kind,th,rad,h}, base: 'raiz'|'galho', k, estado: 'toco'|'crescendo'|'adulta', s, g, cortados }
//   - t é a árvore ADULTA (a mesma receita de treeGraph/plantTree); g (0..1) é o tamanho de agora: o desenho de hoje
//     (nature/trees.js) monta a árvore adulta e escala o grupo por g em volta de `pivo(planta)`. Não há cara própria
//     de broto: com g = 0,08 sai uma miniatura da árvore. Um broto de verdade (folhinhas, caule verde) entra trocando
//     esse desenho, sem mexer na lógica.
//   - k = altura do toco natural que ficou (nós de tronco 0..k-1 são do gerador e já desenhados pelo resto do jogo);
//     k = 0 (galho) quer dizer que a raiz também é da planta.
import { B, SOLID, KIND, K_CROSS } from './blocks.js';
import { hash3 } from './noise.js';
import { treeVoxelMap, isTreeWood } from './trees.js';

const env = (k, d) => { const v = Number(globalThis.process?.env?.[k]); return Number.isFinite(v) && v > 0 ? v : d; };

// Tempo em segundos de verdade (nada de "dia de 20 min"). Biologia de verdade leva anos; aqui o broto aparece na mesma
// sessão de jogo e a árvore fica adulta em um dia, como os cavalos têm a vida apertada (item 33 do CLAUDE.md).
export const REBROTA = {
  broto: env('LAVRA_REBROTA_BROTO_MIN', 8) * 60,          // raiz viva → broto visível (dormência da gema)
  galho: env('LAVRA_GALHO_RAIZ_MIN', 30) * 60,             // galho parado na terra → raiz própria e broto (mais lento)
  adulta: env('LAVRA_REBROTA_ADULTA_H', 24) * 3600,        // broto → árvore adulta frondosa
  estagios: 10,                                            // degraus de tamanho; cada um confere o espaço antes
  g0: 0.08,                                                // tamanho do broto: 8% da árvore adulta
  desiste: env('LAVRA_REBROTA_DESISTE_H', 12) * 3600,      // obstruída tanto tempo seguido: a planta morre
  distMin: 3.5,                                            // m entre troncos (galho que enraíza; o gerador põe árvores a 2–8 m); a raiz rebrota no lugar
  areaLado: 32, areaMax: 6,                                // até 6 árvores de galho por quadrado de 32 m
  porMae: 2,                                               // cada árvore cortada dá no máximo 2 filhas de galho
  totalGalho: 300, totalPlantas: 800,                      // tetos do mundo inteiro
  chanceGalho: Math.min(1, env('LAVRA_GALHO_CHANCE', 0.6)),  // nem todo galho pega (sorteio fixo pela semente)
  ritmo: env('LAVRA_REBROTA_RITMO', 1),                    // multiplica o relógio (ensaio); 1 = tempo de verdade
  atrasoMax: 30 * 86400,                                   // servidor desligado: o tempo anda no máximo 30 dias
  passo: 1,                                                // s de verdade entre duas conferências
};

export const terraFirme = (b) => b === B.DIRT || b === B.GRASS;

// tamanho do degrau s (0 = broto, estagios-1 = adulta)
export function gDoEstagio(s, R = REBROTA) {
  const n = R.estagios - 1;
  if (s >= n) return 1;
  return Math.round((R.g0 + (1 - R.g0) * Math.max(0, s) / n) * 10000) / 10000;
}
// degrau que a idade (s de crescimento) já permite
export function estagioDaIdade(idade, R = REBROTA) {
  const n = R.estagios - 1;
  return Math.max(0, Math.min(n, Math.floor((idade / R.adulta) * n + 1e-9)));
}

// ponto do mundo em volta do qual a planta cresce: o topo do toco (raiz) ou o chão (galho)
export const pivo = (p) => [p.t.x + 0.5, p.t.y + 1 + (p.k || 0), p.t.z + 0.5];

// Células ocupadas pela planta no tamanho g: a receita adulta (plantTree) encolhida em volta do pivô.
// tronco = madeira (precisa de ar ou planta rasteira natural); copa = folhas (aceita outras copas, nunca bloco posto).
export function celulasDaPlanta(p, seed, g) {
  const P = pivo(p), base = p.t.y + 1 + (p.k || 0), tronco = new Map(), copa = new Map();
  for (const [x, y, z, id] of treeVoxelMap(p.t, seed).values()) {
    const madeira = isTreeWood(id);
    if (madeira && y < base) continue;                       // toco natural: já é do gerador
    const cx = Math.floor(P[0] + g * (x + 0.5 - P[0])), cy = Math.floor(P[1] + g * (y + 0.5 - P[1])), cz = Math.floor(P[2] + g * (z + 0.5 - P[2]));
    const k = cx + ',' + cy + ',' + cz;
    if (madeira) { tronco.set(k, [cx, cy, cz]); copa.delete(k); }
    else if (!tronco.has(k)) copa.set(k, [cx, cy, cz]);
  }
  return { tronco: [...tronco.values()], copa: [...copa.values()] };
}

// O espaço do tamanho g está livre? Nunca atravessa nem apaga bloco de quem joga. -1 (pedaço não carregado) = espera.
export function espacoLivre(p, seed, g, get, edited) {
  const { tronco, copa } = celulasDaPlanta(p, seed, g);
  for (const [x, y, z] of tronco) {
    const b = get(x, y, z);
    if (b === -1 || b === undefined) return false;
    if (b === B.AIR) continue;
    if (KIND[b] === K_CROSS && !edited(x, y, z)) continue;   // capim, flor, samambaia natural: a árvore cresce por cima
    return false;
  }
  for (const [x, y, z] of copa) {
    const b = get(x, y, z);
    if (b === -1 || b === undefined) return false;
    if (b === B.AIR) continue;
    if (edited(x, y, z)) return false;                       // bloco posto por alguém (vidro, folha, flor…)
    if (b === B.LEAVES || b === B.PINE_LEAVES || KIND[b] === K_CROSS || !SOLID[b]) continue;   // copas se misturam
    return false;
  }
  return true;
}

// Alguma célula da árvore adulta cai numa zona proibida (campo de futebol)? Decide se ela pode nascer ali.
export function tocaZona(p, seed, zona) {
  if (!zona) return false;
  const { tronco, copa } = celulasDaPlanta(p, seed, 1);
  for (const c of tronco) if (zona(c[0], c[1], c[2])) return true;
  for (const c of copa) if (zona(c[0], c[1], c[2])) return true;
  return false;
}

// Árvore que nasce de um galho em (x, z) com o chão no bloco y: a espécie da mãe, o porte sorteado pela semente
// com as mesmas faixas do gerador (shared/worldgen.js → treeAt).
export function arvoreDoGalho(seed, kind, x, y, z) {
  const h = hash3(x, 913, z, (seed ^ 0x6b2d17a3) >>> 0);
  const r2 = ((h >>> 20) & 0xff) / 256, r3 = ((h >>> 28) & 0xf) / 16;
  let th, rad;
  if (kind === 1) { th = 7 + Math.floor(r2 * 6); rad = 2.2 + r3 * 0.9; }
  else if (kind === 2) { th = 4 + Math.floor(r2 * 3); rad = 3.2 + r3 * 0.7; }
  else if (kind === 4) { th = 5 + Math.floor(r2 * 3); rad = 3; }
  else { kind = 0; th = 4 + Math.floor(r2 * 4); rad = 2.3 + r3 * 1.1; if (r2 > 0.92) { th += 3; rad = 3.9; } }
  return { x, y, z, kind, th, rad: Math.round(rad * 1000) / 1000, h };
}

export const sorteio = (seed, a, b, c) => hash3(a | 0, b | 0, c | 0, (seed ^ 0x3a91c5e7) >>> 0) / 4294967296;
