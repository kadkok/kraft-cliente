// Kraft (LAVRA) — perigos do fundo. Pedido do Kadmus (19/11/2026): "quanto maior a profundidade, maior deverá ser a
// dificuldade, crie situações de riscos que podem ocasionar fatalidades". Decisão dele: vale a REGRA DO MODO, como no
// Minecraft — dano e morte só no sobrevivência e na aventura; criativo e espectador não sentem nada.
//
// Lei pura (sem rede, sem DOM): o servidor (server/perigos.js: gás, calor, soterrado, desabamento, ritmo de quebra) e
// o aparelho (game/modes.js: tempo de quebra e fôlego) usam as MESMAS contas.
//
// FUNDURA = altura natural do chão na coluna (gen.height) − y. Não depende do que alguém construiu ou cavou: um poço
// aberto é tão fundo quanto um túnel. Com a profundidade em dobro (19/11: o fundo desceu de y 0 para −64) o fundo do
// mundo fica a ~115–175 m do chão (debaixo das serras, mais); as faixas vão até 120 m:
//   até 16 m   nada muda (porão, alicerce, mina rasa)
//   16 m+      a rocha endurece aos poucos: tempo de quebra × 1 → × 3,5 aos 120 m (pedra: 1,4 s → 4,9 s)
//   24 m+      quebrar rocha pode soltar o teto: chance por bloco de 0 → 6 % aos 100 m, com 1,5 s de aviso;
//              dano de 4 → 12 (de 20) em quem estiver embaixo
//   32 m+      bolsões de gás invisíveis: 4 % → 30 % das células de 16 m têm um, de raio 2,5–5,5 m; respirar ali
//              tira 1 → 3 de vida por segundo depois de 1 s de aviso
//   40 m+      o fôlego debaixo d'água encurta: 15 s → 8 s aos 120 m (água fria e funda)
//   60 m+      calor: 1 de vida a cada 10 s → a cada 2,5 s aos 120 m; dentro d'água, nada
//   sempre     soterrado (cabeça dentro de bloco sólido: desabamento, cascalho, bloco posto em cima): 1 por segundo
// Números ajustáveis por LAVRA_PERIGO_* (servidor); LAVRA_PERIGO=0 desliga tudo.
import { B, NATURAL, BLOCKS, HARD, SOLID, OPAQUE } from './blocks.js';

const envN = (k, d) => { const v = Number(globalThis.process?.env?.[k]); return Number.isFinite(v) && v >= 0 ? v : d; };

export const PERIGOS = Object.freeze({
  ligado: globalThis.process?.env?.LAVRA_PERIGO !== '0',
  passo: 0.5,                                                           // o servidor confere quem joga a cada 0,5 s
  dureza: Object.freeze({ de: 16, ate: 120, max: envN('LAVRA_PERIGO_DUREZA_MAX', 3.5) }),
  // ritmo de quebra conferido pelo servidor: entre duas quebras de rocha da mesma pessoa tem de passar ao menos
  // folga × tempo do bloco − atraso (o aparelho espera o tempo inteiro + 0,25 s; a folga cobre a rede)
  ritmo: Object.freeze({ folga: 0.7, atraso: 0.15 }),
  teto: Object.freeze({ de: 24, ate: 100, chance: envN('LAVRA_PERIGO_TETO_CHANCE', 0.06), aviso: envN('LAVRA_PERIGO_TETO_AVISO_S', 1.5),
    alturaMin: 2, alturaMax: 4, danoMin: 4, danoMax: 12 }),
  gas: Object.freeze({ de: 32, ate: 120, celula: 16, chanceMin: 0.04, chanceMax: envN('LAVRA_PERIGO_GAS_CHANCE', 0.3),
    raioMin: 2.5, raioMax: 5.5, aviso: 1, danoMax: 3 }),
  folego: Object.freeze({ de: 40, ate: 120, normal: 15, min: 8 }),
  calor: Object.freeze({ de: envN('LAVRA_PERIGO_CALOR_DE', 60), ate: 120, intervaloMax: 10, intervaloMin: 2.5 }),
  soterrado: Object.freeze({ carencia: 1, intervalo: 1 }),
});

export const suave = (a, b, v) => { if (v <= a) return 0; if (v >= b) return 1; const t = (v - a) / (b - a); return t * t * (3 - 2 * t); };

// fundura de uma célula (inteira): chão natural da coluna − y
export function funduraEm(gen, x, y, z) {
  if (!gen?.height) return 0;
  return Math.floor(gen.height(Math.floor(x), Math.floor(z))) - Math.floor(y);
}

// rocha = bloco natural de pedra ou minério (pedra, basalto, arenito, minérios); terra, areia, cascalho e obra não
export function ehRocha(id) {
  if (!id || id === B.BEDROCK || id === B.PORTAL || !NATURAL[id]) return false;
  const m = BLOCKS[id];
  return !!m && (m.sound === 'stone' || m.group === 'minério');
}

// (a) a rocha endurece com a fundura
export const fatorDureza = (d, R = PERIGOS) => 1 + (R.dureza.max - 1) * suave(R.dureza.de, R.dureza.ate, d);
export function tempoDeQuebra(id, d, R = PERIGOS) {
  if (id === B.BEDROCK || id === B.PORTAL) return Infinity;
  const base = HARD[id] ?? 1;
  return R.ligado && ehRocha(id) ? base * fatorDureza(d, R) : base;
}

// (c) teto: chance de soltar a cada bloco de rocha quebrado, quantos blocos acima e o dano em quem estiver embaixo
export const severidadeTeto = (d, R = PERIGOS) => suave(R.teto.de, R.teto.ate, d);
export const chanceTeto = (d, R = PERIGOS) => (d < R.teto.de ? 0 : R.teto.chance * severidadeTeto(d, R));
export const alturaTeto = (d, R = PERIGOS) => R.teto.alturaMin + Math.round((R.teto.alturaMax - R.teto.alturaMin) * severidadeTeto(d, R));
export const danoTeto = (d, R = PERIGOS) => Math.round(R.teto.danoMin + (R.teto.danoMax - R.teto.danoMin) * severidadeTeto(d, R));

// (e) fôlego debaixo d'água, em segundos
export const folegoEm = (d, R = PERIGOS) => R.folego.normal - (R.folego.normal - R.folego.min) * suave(R.folego.de, R.folego.ate, d);

// (d) calor: 0 … 1 e o intervalo entre um dano e outro
export const calorEm = (d, R = PERIGOS) => (d < R.calor.de ? 0 : suave(R.calor.de, R.calor.ate, d));
export const intervaloCalor = (h, R = PERIGOS) => R.calor.intervaloMax + (R.calor.intervaloMin - R.calor.intervaloMax) * h;

// sorteio inteiro determinístico (só + × e deslocamentos: igual em todo aparelho)
export function mistura(...v) {
  let h = 0x811c9dc5 | 0;
  for (const n of v) { h = Math.imul(h ^ (n | 0), 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; }
  return h >>> 0;
}
export const sorteio = (...v) => mistura(...v) / 4294967296;

// (b) bolsões de gás: no máximo um por célula de `celula` m (em 3D), decidido pela semente e pela fundura do centro.
// Devolve { x, y, z, r } ou null. `cache` (Map) é opcional: o servidor guarda as células já vistas.
export function bolsao(seed, gen, cx, cy, cz, R = PERIGOS, cache = null) {
  const k = cx + ',' + cy + ',' + cz;
  if (cache && cache.has(k)) return cache.get(k);
  const C = R.gas.celula, h = mistura(seed, cx, cy, cz, 0x6a5);
  const px = cx * C + (h & 15) * C / 16, py = cy * C + ((h >>> 4) & 15) * C / 16, pz = cz * C + ((h >>> 8) & 15) * C / 16;
  const d = funduraEm(gen, px, py, pz);
  let b = null;
  if (d >= R.gas.de) {
    const chance = R.gas.chanceMin + (R.gas.chanceMax - R.gas.chanceMin) * suave(R.gas.de, R.gas.ate, d);
    if (sorteio(seed, cx, cy, cz, 0x9a5) < chance) {
      const r = R.gas.raioMin + (R.gas.raioMax - R.gas.raioMin) * sorteio(seed, cx, cy, cz, 0x7a1);
      b = { x: px, y: py, z: pz, r };
    }
  }
  if (cache) { if (cache.size > 8192) cache.clear(); cache.set(k, b); }
  return b;
}
// concentração de gás no ponto (0 … 1): 1 no centro do bolsão, 0 na borda e fora; `extras` = bolsões postos à mão
export function gasEm(seed, gen, x, y, z, R = PERIGOS, cache = null, extras = null) {
  if (!R.ligado) return 0;
  let c = 0;
  const testa = (b) => { if (!b) return; const dd = Math.hypot(x - b.x, y - b.y, z - b.z); if (dd < b.r) c = Math.max(c, 1 - dd / b.r); };
  if (extras) for (const b of extras) testa(b);
  if (funduraEm(gen, x, y, z) >= R.gas.de - R.gas.raioMax) {
    const C = R.gas.celula, cx = Math.floor(x / C), cy = Math.floor(y / C), cz = Math.floor(z / C);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) testa(bolsao(seed, gen, cx + dx, cy + dy, cz + dz, R, cache));
  }
  return c;
}

// cabeça presa dentro de bloco cheio (escada e mini-bloco não prendem; folhagem e vidro não sufocam)
export const sufoca = (id, estado = 0) => !!id && SOLID[id] === 1 && OPAQUE[id] === 1 && !estado;
