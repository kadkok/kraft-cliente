// Poder de ADM do GM no aparelho (server/world.js → comandoAdm; pedido do Kadmus, 22/11/2026).
// Stun: o servidor manda { t: 'stun', s } (s = segundos; 0 = solto). Enquanto durar, o passo fixo do jogador não roda
// (o mesmo caminho do assento das máquinas), então o boneco fica parado no ar ou no chão; o servidor também recusa a
// posição e as ações de quem está em stun, de modo que um aparelho antigo, sem este arquivo, também não anda para os outros.
export function initAdm({ game, ui }) {
  let ate = 0;
  game.adm = { get emStun() { return performance.now() < ate; } };
  game.hooks.other.push((m) => {
    if (m.t === 'stun') {
      const s = Math.max(0, Number(m.s) || 0);
      ate = s > 0 ? performance.now() + s * 1000 : 0;
      if (s > 0) ui?.toast?.(`⚡ Paralisado pelo GM por ${Math.ceil(s)} s.`, 3000);
    } else if (m.t === 'welcome' || m.t === 'offline') ate = 0;
  });
  game.hooks.fixed.push(() => performance.now() < ate);
}
