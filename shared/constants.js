// LAVRA — constantes compartilhadas por cliente, worker e servidor.
// Tudo aqui é dado puro: nenhum import, nenhum efeito colateral.

export const GAME_NAME = 'LAVRA';   // nome de código (pasta, serviço, /api/info e o log "LAVRA no ar" que testes e ferramentas esperam). O nome que o jogador vê é Kraft (19/11/2026).
export const PROTOCOL = 1;

// Geometria do mundo -------------------------------------------------------
export const CW = 16;            // largura do chunk em X e Z
// Profundidade em dobro (19/11/2026, pedido do Kadmus: "o dobro de profundidade atual"). O plano de cima desce até
// Y_MIN sem mover a superfície: todo y do mundo (jogador, edição, objeto, campo, mensagem, world.json) continua o
// mesmo de antes; só passa a existir chão abaixo de 0. Os outros planos (Zona, macro, nano) não descem: o fundo deles
// continua em 0 (fundoDe). Não existe mais `CH` — ele queria dizer "topo do mundo" e mudaria de sentido calado:
//   Y_TOP    topo do mundo (exclusivo), o 160 de sempre
//   Y_MIN    fundo do plano de cima (rocha-mãe); os outros planos usam fundoDe(d) = 0
//   CAMADAS  camadas guardadas por pedaço (de Y_MIN a Y_TOP − 1), em TODOS os planos (abaixo do fundo, rocha-mãe)
export const Y_MIN = -64;
export const Y_TOP = 160;
export const CAMADAS = Y_TOP - Y_MIN;    // 224
export const SEA = 48;           // nível do mar (último bloco de água)
export const CHUNK_VOL = CW * CW * CAMADAS;
// Fundo do plano d (a célula da rocha-mãe que nunca se edita): 0 nos planos que não descem.
export const fundoDe = (d) => (d ? 0 : Y_MIN);
// Menor y que alguém pode editar no plano d (o mesmo "y ≥ 1" de sempre fora do plano de cima).
export const yEdMin = (d) => fundoDe(d) + 1;

// Dois índices dentro do pedaço, com y do MUNDO (pode ser negativo):
//  · EDIÇÃO (chave dos mapas de edições e de mini-blocos, gravada no world.json e na rede): x + z·16 + y·256. Com y < 0 o
//    número fica negativo. Decodificar SEMPRE com >> e &: x = i & 15, z = (i >> 4) & 15, y = i >> 8 (nunca >>> nem /).
//  · ARMAZENAMENTO (posição no vetor de voxels do pedaço): o mesmo número + YOFF (nunca negativo, cabe em 16 bits).
export const YOFF = -Y_MIN << 8;
export const eidx = (x, y, z) => (x & 15) + ((z & 15) << 4) + (y << 8);
export const vidx = (x, y, z) => x + (z << 4) + ((y - Y_MIN) << 8);   // x e z já locais (0..15)

// Chave numérica de chunk (cabe com folga em um double).
export const ckey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
export const ckeyX = (k) => Math.floor(k / 65536) - 32768;
export const ckeyZ = (k) => (k % 65536) - 32768;

// Planos e dimensões ---------------------------------------------------------
// 0 = superfície (plano normal) · 1 = Zona Fantasma · 2 = plano macro · 16 em diante = planos nano (um por bloco)
export const DIM_ZONE = 1, DIM_MACRO = 2, DIM_NANO0 = 16;
export const FRACTAL = 100;      // blocos por lado em cada salto de escala (nano -> normal -> macro)

// Luz ----------------------------------------------------------------------
export const MAX_LIGHT = 15;

// Tempo --------------------------------------------------------------------
// A hora do mundo é contada em segundos de jogo. Quanto tempo de verdade um dia leva é o "ritmo" do relógio
// (shared/clock.js), escolhido por quem joga: no ritmo 1 o dia dura 24 h, como no mundo real.
export const DAY_LENGTH = 86400; // segundos de jogo em um dia: fração do dia × 24 = hora
export const DAY_PORTION = 0.54; // fração do dia com o sol acima do horizonte (~13 h, como nos trópicos)

// Jogador ------------------------------------------------------------------
export const PLAYER_W = 0.6;
export const PLAYER_H = 1.8;
export const EYE_H = 1.62;
export const REACH = 6.5;

// Rede ---------------------------------------------------------------------
export const NET_TICK_HZ = 12;
export const MAX_NAME = 16;
export const MAX_CHAT = 200;
export const MAX_PLAYERS = 24;

// Limpa um nome de jogador ou de mundo vindo de fora.
export function cleanName(s, max = MAX_NAME) {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0);
    if (c < 32 || c === 127 || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e)) continue;
    out += ch;
    if (out.length >= max) break;
  }
  return out.trim();
}

// Nome de mundo vira um identificador seguro para URL e para nome de arquivo.
export function worldSlug(s) {
  const base = cleanName(String(s || ''), 32).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || 'principal';
}

// Semente determinística a partir de texto (FNV-1a de 32 bits).
export function seedFromString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
