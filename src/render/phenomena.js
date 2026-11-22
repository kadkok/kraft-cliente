// Contrato puro e reutilizável: contexto + semente + identidade do evento => decisão.
// Jev fornece a política artística versionada; nenhuma chamada remota durante o jogo.
import { hash3, mulberry32 } from '../../shared/noise.js';
import { BLOCKS } from '../../shared/blocks.js';
import { JEV_POLICY } from './jev-policy.js';

export { JEV_POLICY };
export function eventSeed(seed, dimension, x, y, z, event = 0, stream = 0) {
  return hash3(x, y, z, hash3(dimension, event, stream, seed));
}
export function variantFor(family, seed) {
  const options = JEV_POLICY.weights[family];
  if (!options) throw new Error('Família desconhecida: ' + family);
  let p = mulberry32(seed)();
  for (const option of options) { p -= option.weight; if (p <= 0) return option.variant; }
  return options[options.length - 1].variant;
}
export function materialFamily(id) {
  const sound = BLOCKS[id]?.sound;
  if (sound === 'wood') return 'wood';
  if (sound === 'glass') return 'glass';
  if (['dirt', 'sand', 'grass', 'snow', 'gravel'].includes(sound)) return 'earth';
  return 'stone';
}

// Partição completa do volume: os fragmentos começam encaixados no bloco original.
export function fracturePlan({ seed, dimension = 0, x, y, z, id, event = 0 }) {
  const h = eventSeed(seed, dimension, x, y, z, event, id);
  const rnd = mulberry32(h), family = materialFamily(id), variant = variantFor(family, h);
  const cuts = family === 'wood' ? (variant==='splinter'?[4,1,3]:[3,2,2])
    : family === 'earth' ? (variant==='compact'?[2,2,2]:[3,3,3])
    : family === 'glass' ? (variant==='crack'?[2,1,2]:[3,1,3]) : [2,2,2];
  const bounds = cuts.map(n => [0, ...Array.from({ length: n - 1 }, (_, i) => (i + 0.8 + rnd() * 0.4) / n), 1]);
  const pieces = [];
  const inward = variant === 'collapse' || variant === 'slump';
  for (let i = 0; i < cuts[0]; i++) for (let j = 0; j < cuts[1]; j++) for (let k = 0; k < cuts[2]; k++) {
    const indices = [i,j,k], size = indices.map((v,a) => bounds[a][v+1] - bounds[a][v]);
    const center = indices.map((v,a) => bounds[a][v] + size[a] / 2);
    const spread = (family === 'glass' ? 1.05 : family === 'earth' ? 0.38 : 0.6) * (variant==='fracture'||variant==='snap'?1.4:variant==='compact'?.55:1);
    const spin = variant==='slump'?.25:variant==='shatter'||variant==='splinter'?1.4:1;
    pieces.push({ size, center,
      velocity: [(center[0]-.5)*(inward ? -.35 : spread) + (rnd()-.5)*.18, -.1-rnd()*.3, (center[2]-.5)*(inward ? -.35 : spread)+(rnd()-.5)*.18],
      spin: [(rnd()-.5)*2*spin, (rnd()-.5)*1.5*spin, (rnd()-.5)*2*spin],
      delay: .025 + rnd()*.045, life: (family === 'earth' ? .6 : .88) + rnd()*.25,
    });
  }
  return { seed: h, family, variant, pieces };
}

// Um evento por célula de 4 m e janela de 3 s, independente da ordem de exploração.
// As taxas são limites artísticos locais; não confundir probabilidade JEV com física.
export function leafPlan(seed, dimension, cellX, cellZ, slot, windSpeed = null) {
  const h = eventSeed(seed, dimension, cellX, 0, cellZ, slot, 117);
  const rnd = mulberry32(h);
  const weather = mulberry32(eventSeed(seed, dimension, Math.floor(cellX/8), 0, Math.floor(cellZ/8), Math.floor(slot/4), 19))();
  const family = windSpeed===null ? (weather < .35 ? 'calm' : weather < .88 ? 'breeze' : 'gust') : windSpeed<1.5?'calm':windSpeed<5?'breeze':'gust';
  if (rnd() > (family === 'calm' ? .20 : family === 'breeze' ? .38 : .58)) return null;
  return { seed: h, family, variant: variantFor(family, h),
    x: cellX*4 + Math.floor(rnd()*4), z: cellZ*4 + Math.floor(rnd()*4),
    birth: slot*3 + rnd()*2.5, phase: rnd()*6.28, size: .16+rnd()*.12,
    speed: .55+rnd()*.4, drift: .12+rnd()*.2, offset: rnd(), life: 7+rnd()*3,
  };
}
