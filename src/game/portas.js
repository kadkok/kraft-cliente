// Kraft — portas de qualquer bloco, no aparelho (pedido do Kadmus, 23/11/2026). O servidor manda a lista das portas
// do plano ({ t: 'portas', l }); clicar (usar) num bloco de uma porta pede ao servidor para abrir/fechar. Quem troca os
// blocos é o servidor (server/portas.js); aqui não se põe nada no mundo. Comandos: /porta (ajuda no chat).
import { portaNoClique } from '../../shared/portas.js';

export function initPortas({ game, net }) {
  let portas = [], pedido = 0;
  const pedir = () => { if (!net.offline) net.send({ t: 'gmop', op: 'porta', a: 'lista' }); };
  game.hooks.other.push((m) => {
    if (m.t === 'portas' && Array.isArray(m.l)) portas = m.l;
    else if (m.t === 'welcome' || m.t === 'dim') { portas = []; clearTimeout(pedido); pedido = setTimeout(pedir, 1500); }
  });
  // antes dos outros cliques (baú, porta do Minecraft): o bloco é de uma porta nossa?
  game.hooks.interact.unshift((dt, playing) => {
    if (!playing || !portas.length || game.modeRules?.invisivel && !game.modeRules?.gm) return false;
    const L = window.LAVRA, hit = L?.interaction?.target, input = L?.input;
    if (!hit || !input) return false;
    const usar = input.wasPressed('interact'), por = input.wasPressed('place') && !input.isDown('sneak');
    if (!usar && !por) return false;
    // bloco da porta: clicar ou usar. Batente/vão de porta aberta (a que sumiu, subiu ou correu): só a tecla de usar,
    // para não roubar o clique de quem está construindo ao lado
    const naPorta = (q) => (q.cel || []).some((c) => c[0] === hit.x && c[1] === hit.y && c[2] === hit.z);
    const p = portas.find(naPorta) || (usar ? portas.find((q) => portaNoClique(q, hit.x, hit.y, hit.z)) : null);
    if (!p) return false;
    net.send({ t: 'gmop', op: 'porta', a: 'alternar', id: p.id });
    game.audio?.play?.(p.aberta ? 'close' : 'open', 0.85, 1.0);
    return true;
  });
  return { lista: () => portas };
}
