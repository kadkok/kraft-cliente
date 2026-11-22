// Contrato visual dos materiais. Não simula acontecimentos, água, dano ou física.
// O estado íntegro é compartilhado; só blocos alterados ocupam o cache esparso.
import { B, BLOCKS, BASE, KIND, K_CROSS } from '../../shared/blocks.js';
import { hash3 } from '../../shared/noise.js';

const common = ['wet', 'slime', 'vegetation', 'submerged', 'corrupted', 'scorched', 'lightning'];
const mineral = [...common, 'cracked', 'broken', 'fragmented', 'paint', 'carved', 'engraved', 'polished', 'eroded'];
const profile = (family, states, response) => Object.freeze({ family, states: Object.freeze(states), response: Object.freeze(response) });
export const MATERIAL_PROFILES = Object.freeze({
  rock: profile('rock', mineral, { debris: 'stone', wetDarkening: .22, porous: .35 }),
  sandstone: profile('sandstone', mineral, { debris: 'stone', wetDarkening: .32, porous: .85 }),
  marble: profile('marble', mineral, { debris: 'stone', wetDarkening: .13, porous: .12 }),
  granite: profile('granite', mineral, { debris: 'stone', wetDarkening: .16, porous: .18 }),
  metal: profile('metal', [...common, 'broken', 'fragmented', 'paint', 'carved', 'engraved', 'polished', 'rusted', 'deformed'], { debris: 'metal', wetDarkening: .08, porous: 0 }),
  gold: profile('gold', [...common, 'broken', 'fragmented', 'paint', 'carved', 'engraved', 'polished', 'deformed'], { debris: 'metal', wetDarkening: .05, porous: 0 }),
  wood: profile('wood', [...common, 'burning', 'cracked', 'broken', 'fragmented', 'paint', 'carved', 'engraved'], { debris: 'wood', wetDarkening: .30, porous: .65 }),
  soil: profile('soil', ['wet', 'slime', 'vegetation', 'submerged', 'corrupted', 'scorched', 'lightning', 'cracked', 'broken', 'eroded'], { debris: 'earth', wetDarkening: .4, porous: .9 }),
  loose: profile('loose', ['wet', 'slime', 'vegetation', 'submerged', 'corrupted', 'scorched', 'lightning', 'eroded'], { debris: 'earth', wetDarkening: .32, porous: 1 }),
  plant: profile('plant', ['wet', 'submerged', 'corrupted', 'scorched', 'lightning', 'burning', 'broken', 'wilted'], { debris: 'leaf', wetDarkening: .12, porous: .2 }),
  glass: profile('glass', ['wet', 'slime', 'submerged', 'corrupted', 'scorched', 'lightning', 'cracked', 'broken', 'fragmented', 'paint', 'engraved'], { debris: 'glass', wetDarkening: .03, porous: 0 }),
  ice: profile('ice', ['wet', 'submerged', 'corrupted', 'cracked', 'broken', 'fragmented', 'carved', 'eroded'], { debris: 'glass', wetDarkening: .04, porous: 0 }),
  snow: profile('snow', ['wet', 'submerged', 'corrupted', 'broken', 'eroded'], { debris: 'earth', wetDarkening: .06, porous: .8 }),
  fixed: profile('fixed', common, { debris: null, wetDarkening: .12, porous: 0 }),
  none: profile('none', [], { debris: null, wetDarkening: 0, porous: 0 }),
});
export const INTACT = Object.freeze({});
const named = new Map([[B.SANDSTONE, 'sandstone'], [B.MARBLE, 'marble'], [B.GOLD_BLOCK, 'gold'], [B.BEDROCK, 'fixed'],
  [B.DIRT, 'soil'], [B.GRASS, 'soil'], [B.CLAY, 'soil'], [B.SAND, 'loose'], [B.GRAVEL, 'loose'], [B.ASH, 'loose'],
  [B.ICE, 'ice'], [B.SNOW, 'snow'], [B.AIR, 'none'], [B.WATER, 'none'], [B.MYSTIC_WATER, 'none'], [B.PORTAL, 'none']]);

export function materialProfile(id, definition = BLOCKS[id]) {
  if (!definition) return MATERIAL_PROFILES.none;
  // Ao cadastrar novos elementos, Claude pode declarar materialFamily sem mudar este módulo.
  if (MATERIAL_PROFILES[definition.materialFamily]) return MATERIAL_PROFILES[definition.materialFamily];
  const explicit = named.get(BASE[id] || id);
  if (explicit) return MATERIAL_PROFILES[explicit];
  if (KIND[id] === K_CROSS || ['plant', 'leaves'].includes(definition.sound)) return MATERIAL_PROFILES.plant;
  return MATERIAL_PROFILES[({ wood: 'wood', metal: 'metal', glass: 'glass', dirt: 'soil', sand: 'loose', gravel: 'loose' })[definition.sound] || 'rock'];
}

export function normalizeMaterialState(id, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return INTACT;
  const out = {}, allowed = materialProfile(id).states;
  for (const key of allowed) {
    const value = input[key];
    if (key === 'paint') {
      if (value && /^#[0-9a-f]{6}$/i.test(value.color) && Number.isFinite(value.amount) && value.amount > 0)
        out.paint = Object.freeze({ color: value.color.toLowerCase(), amount: Math.min(1, value.amount) });
    } else if (key === 'engraved' || key === 'carved') {
      if (value && typeof value.pattern === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value.pattern) && Number.isFinite(value.amount) && value.amount > 0)
        out[key] = Object.freeze({ pattern: value.pattern, amount: Math.min(1, value.amount) });
    } else if (Number.isFinite(value) && value > 0) out[key] = Math.min(1, value);
  }
  return Object.keys(out).length ? Object.freeze(out) : INTACT;
}

export function materialLayers(id, state = INTACT, seed = 0) {
  const normalized = normalizeMaterialState(id, state);
  return Object.entries(normalized).map(([kind, value]) => ({ kind,
    intensity: typeof value === 'number' ? value : value.amount,
    detail: typeof value === 'object' ? value : null,
    seed: hash3(seed | 0, id | 0, kind.split('').reduce((n, c) => Math.imul(n, 31) + c.charCodeAt(0) | 0, 17)),
    channel: ['broken', 'fragmented', 'carved', 'deformed'].includes(kind) ? 'geometry' : kind === 'wet' || kind === 'polished' ? 'surface' : 'color',
  }));
}

export function createMaterialStateStore(capacity = 2048) {
  const states = new Map(), stats = { changed: 0, rejected: 0, size: 0, capacity };
  const key = (dim, x, y, z) => `${dim}:${x},${y},${z}`;
  function clear() { states.clear(); stats.size = 0; }
  function accept(m) {
    if (m?.t === 'welcome' || m?.t === 'offline') { clear(); return false; }
    if (m?.t !== 'material') return false;
    if (m.v !== 1 || !['dim', 'x', 'y', 'z', 'id', 'rev'].every(k => Number.isSafeInteger(m[k])) || !BLOCKS[m.id] || m.rev < 0 || !m.state || typeof m.state !== 'object' || Array.isArray(m.state)) { stats.rejected++; return false; }
    const k = key(m.dim, m.x, m.y, m.z), previous = states.get(k);
    if (previous && m.rev <= previous.rev) { stats.rejected++; return false; }
    // Snapshot absoluto do servidor: zero limpa uma camada; nunca somar por quadro.
    const state = normalizeMaterialState(m.id, m.state);
    states.delete(k); states.set(k, { id: m.id, rev: m.rev, seed: Number.isSafeInteger(m.seed) ? m.seed : 0, state });
    if (states.size > capacity) states.delete(states.keys().next().value);
    stats.size = states.size; stats.changed++; return true;
  }
  return { stats, accept, clear,
    profile: materialProfile, layers: materialLayers,
    get(dim, x, y, z, id) { const v = states.get(key(dim, x, y, z)); return v?.id === id ? v.state : INTACT; },
    dispose: clear,
  };
}
