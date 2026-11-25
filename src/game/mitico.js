// Kraft — mundo mítico no aparelho (pedido do Kadmus, 23/11/2026): com o modo GM ligado, quebrar a rocha-mãe mais funda
// (y = Y_MIN, o fundo do mundo de cima) pede a passagem ao servidor, que confere tudo (server/mitico.js) e leva ao plano.
import { B } from '../../shared/blocks.js';
import { Y_MIN } from '../../shared/constants.js';

export function initMitico({ game, net }) {
  game.hooks.interact.unshift((dt, playing) => {
    if (!playing || !game.gmAtivo || (game.dim || 0) !== 0 || net.offline) return false;
    const L = window.LAVRA, hit = L?.interaction?.target, input = L?.input;
    if (!hit || !input || hit.y !== Y_MIN || !input.wasPressed('break')) return false;
    if (L.world.getBlock(hit.x, hit.y, hit.z) !== B.BEDROCK) return false;
    net.send({ t: 'gmop', op: 'mitico', x: hit.x, y: hit.y, z: hit.z });
    return true;
  });
}
