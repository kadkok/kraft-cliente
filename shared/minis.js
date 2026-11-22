// LAVRA — mini-blocos (pedido do Kadmus, 15/11/2026). Puro: cliente, worker e servidor.
//
// Um mini-bloco é 1/4 de um bloco: 0,5 × 0,5 × 1 m. Cabe em quatro dentro de um espaço de 1 m e tem um eixo:
// em pé (Y, pilar/parede fina) ou deitado (X ou Z, viga/piso/teto de meio metro). Só existe em construção:
// o terreno natural do mapa nunca tem estado de mini-bloco (o estado só nasce de um 'b' de quem joga).
//
// Estado de um espaço = um byte: bits 0–3 = quartos ocupados, bits 4–5 = eixo (1 = Y, 2 = X, 3 = Z); 0 = bloco inteiro.
// O material é o próprio bloco do espaço (tábuas, pedra, vidro…): não há blocos novos. O estado mora num mapa irmão
// das edições (cliente: world.minis; servidor: dimMinis), então quem não conhece mini-bloco continua lendo só o bloco.
//
// Quartos: os dois eixos perpendiculares ao eixo do mini-bloco (a, b) são cortados ao meio; quarto = qa + 2·qb.
//   eixo Y: a = x, b = z · eixo X: a = y, b = z · eixo Z: a = x, b = y
import { SOLID, KIND, K_CUBE, K_CUTOUT, FUNC, LEVEL, B, NATURAL } from './blocks.js';
import { MC_BASE, MC_N, MC_CLASSE } from './mc-estados.js';

export const AXIS_Y = 1, AXIS_X = 2, AXIS_Z = 3;
export const miniState = (axis, mask) => ((axis & 3) << 4) | (mask & 15);
export const miniAxis = (s) => (s >> 4) & 3;
export const miniMask = (s) => s & 15;
export const isMiniState = (s) => Number.isInteger(s) && s > 0 && s < 64 && miniAxis(s) > 0 && miniMask(s) > 0;

// Quem pode virar mini-bloco: bloco de construção sólido, cubo ou recortado (vidro), que não seja peça de máquina,
// líquido, matéria solta (areia, cascalho, neve e cinza caem: a lei da queda não carrega o estado) nem especial.
const LOOSE_IDS = [B.SAND, B.GRAVEL, B.SNOW, B.ASH];
export const MINI_OK = new Uint8Array(256);
for (let id = 1; id < 128; id++) {
  if (SOLID[id] && (KIND[id] === K_CUBE || KIND[id] === K_CUTOUT) && !FUNC[id] && !LEVEL[id]) MINI_OK[id] = 1;
}
for (const id of [B.BEDROCK, B.PORTAL, B.ROOT, B.PINE_ROOT, ...LOOSE_IDS, B.MC_SOLIDO, B.MC_RECORTE, B.MC_FORMA]) if (id !== undefined) MINI_OK[id] = 0;   // bloco MC guarda o estado MC no lugar do mini

// Terra moldada (Kadmus, 16/11/2026: "use rampas nas ruas e terras, não deixe blocos quadrados sem acabamento").
// Edição comum fica cubo (a forma de terreno não arredonda construção de ninguém). Uma obra de paisagem — estrada,
// margem, aterro — marca o espaço com o estado MOLDE no mesmo mapa dos mini-blocos: o bloco continua editado (gravado,
// enviado), mas para a forma conta como chão natural e ganha rampa. Só vale para bloco de terreno natural cúbico.
export const MOLDE = 64;
export const isMolde = (s) => s === MOLDE;
export const MOLDE_OK = new Uint8Array(256);
for (let id = 1; id < 128; id++) if (NATURAL[id] && SOLID[id] && KIND[id] === K_CUBE && !LEVEL[id]) MOLDE_OK[id] = 1;
for (const id of [B.BEDROCK, B.LOG, B.PINE_LOG, B.CACTUS, B.ROOT, B.PINE_ROOT]) if (id !== undefined) MOLDE_OK[id] = 0;
// Tronco quadrado: por padrão troncos colocados são tubulares/redondos; o estado 65 mantém o bloco inteiro cúbico.
export const TRONCO_QUADRADO = 65;
export const isTroncoQuadrado = (s) => s === TRONCO_QUADRADO;
export const TRONCO_OK = new Uint8Array(256);
for (const id of [B.LOG, B.PINE_LOG, B.ROOT, B.PINE_ROOT]) if (id !== undefined) TRONCO_OK[id] = 1;
// Bloco do Minecraft: valor MC_BASE + n no mesmo mapa; o id da célula tem de ser o da classe do estado n
// (0 sólido → MC_SOLIDO, 1 recorte → MC_RECORTE, 2 forma → MC_FORMA; entidade e fluido ainda não se colocam).
export const isMcState = (s) => Number.isInteger(s) && s >= MC_BASE && s < MC_BASE + MC_N;
export const mcIdDoEstado = (s) => { if (!isMcState(s)) return -1; const c = MC_CLASSE[s - MC_BASE]; return c === 0 ? B.MC_SOLIDO : c === 1 ? B.MC_RECORTE : c === 2 ? B.MC_FORMA : -1; };
export const IS_MC = (id) => id === B.MC_SOLIDO || id === B.MC_RECORTE || id === B.MC_FORMA;
// o estado que um espaço guarda com este bloco: mini-bloco válido, terra moldada válida, tronco quadrado, estado MC da classe certa ou nada
export const keepState = (s, id) => (isMiniState(s) && MINI_OK[id]) || (isMolde(s) && MOLDE_OK[id]) || (isTroncoQuadrado(s) && TRONCO_OK[id]) || (isMcState(s) && mcIdDoEstado(s) === id) ? s : 0;

// eixo a partir da normal da face clicada: no chão ou no teto fica em pé; numa lateral, deita apontando para fora
export function axisFromNormal(nx, ny, nz) {
  return ny !== 0 ? AXIS_Y : nx !== 0 ? AXIS_X : AXIS_Z;
}
// (a, b) de um ponto do espaço, em coordenadas 0..1 dentro dele
function ab(axis, fx, fy, fz) {
  return axis === AXIS_Y ? [fx, fz] : axis === AXIS_X ? [fy, fz] : [fx, fy];
}
// quarto (0..3) que contém o ponto (fx, fy, fz) do espaço, para um eixo
export function quarterAt(axis, fx, fy, fz) {
  const [a, b] = ab(axis, fx, fy, fz);
  return (a >= 0.5 ? 1 : 0) + (b >= 0.5 ? 2 : 0);
}

// caixa [x0, y0, z0, x1, y1, z1] de um quarto
export function quarterBox(axis, q) {
  const a0 = (q & 1) * 0.5, b0 = ((q >> 1) & 1) * 0.5;
  if (axis === AXIS_Y) return [a0, 0, b0, a0 + 0.5, 1, b0 + 0.5];
  if (axis === AXIS_X) return [0, a0, b0, 1, a0 + 0.5, b0 + 0.5];
  return [a0, b0, 0, a0 + 0.5, b0 + 0.5, 1];
}

// todas as caixas de um estado (vazio se não for estado de mini-bloco)
export function miniBoxes(s) {
  if (!isMiniState(s)) return [];
  const axis = miniAxis(s), mask = miniMask(s), out = [];
  for (let q = 0; q < 4; q++) if (mask & (1 << q)) out.push(quarterBox(axis, q));
  return out;
}

// estado depois de pôr (+) ou tirar (−) um quarto; 0 = espaço vazio
export function withQuarter(s, axis, q, on) {
  const mask = on ? (miniMask(s) | (1 << q)) : (miniMask(s) & ~(1 << q));
  return mask ? miniState(axis, mask) : 0;
}

// Estado padrão de uma escada de 2 degraus (3/4 de bloco subindo para +X).
export const DEFAULT_STAIR_STATE = miniState(AXIS_Z, 11);

// Escolhe a orientação da escada pelo olhar horizontal e face clicada (ny < 0 = teto/invertida).
export function stairState(look = [1, 0, 0], ny = 1) {
  const ax = Math.abs(look[0] || 0), az = Math.abs(look[2] || 0);
  if (ax >= az) {
    return (look[0] || 0) >= 0
      ? (ny < 0 ? miniState(AXIS_Z, 14) : miniState(AXIS_Z, 11))
      : (ny < 0 ? miniState(AXIS_Z, 13) : miniState(AXIS_Z, 7));
  }
  return (look[2] || 0) >= 0
    ? (ny < 0 ? miniState(AXIS_X, 14) : miniState(AXIS_X, 13))
    : (ny < 0 ? miniState(AXIS_X, 11) : miniState(AXIS_X, 7));
}
