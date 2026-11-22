// LAVRA — mirar e interagir com os bichos do pacote (grupos 'fauna'): dica com espécie, sexo, idade e o que faz;
// F carinho · F com planta na mão oferece comida · clique bate. A reação vem do servidor (Jev ou chances do bicho).
import { ACOES_ANIMAL } from '../../shared/animais.js';
import { ESPECIES } from '../../shared/especies.js';
import { eComida } from '../../shared/equino.js';
import { B } from '../../shared/blocks.js';

const ALCANCE = 4.5;
const NOMES = {};
export function initBichos({ game, net, ui, input, nomes = {} }) {
  const nat = game.nature;
  Object.assign(NOMES, nomes);
  let golpeAte = 0;
  const pos = (g, i) => { const s = nat.bodies.get(g.id); if (!s) return null; const o = 1 + i * 5; return s.b.length > o + 4 ? [s.b[o] / 100, s.b[o + 1] / 100, s.b[o + 2] / 100, s.b[o + 4] | 0] : null; };
  const nome = (g, i) => {
    const a = g.fa?.[i] || [], e = ESPECIES[g.e], anos = (a[5] || 0) / 10, p = pos(g, i), acao = p ? ACOES_ANIMAL[p[3] >> 3] : '';
    const fase = ['filhote', 'jovem', '', 'idoso'][a[3] ?? 2];
    const quem = NOMES[g.e] || g.e;
    const idade = anos >= 1 ? `${Math.floor(anos)} ano${anos >= 2 ? 's' : ''}` : `${Math.max(1, Math.round(anos * 12))} ${Math.round(anos * 12) > 1 ? 'meses' : 'mês'}`;
    if (acao === 'morto') return `${quem} morto`;
    return `${quem} (${a[0] === 1 ? 'macho' : 'fêmea'}${fase ? ', ' + fase : ''}, ${idade}${a[2] ? ', prenhe' : ''})${acao ? ' — ' + acao : ''}${e?.perigo > 0.5 ? ' · perigoso' : ''}`;
  };
  game.hooks.interact.unshift((dt, playing, o, d) => {
    if (game.cavalos?.montado) return false;
    let best = null, bt = Math.min(ALCANCE, game.treeAim?.t ?? Infinity);
    for (const g of nat.groups.values()) {
      if (g.k !== 'fauna') continue;
      const e = ESPECIES[g.e]; if (!e) continue;
      const n = g.fa?.length || 0;
      for (let i = 0; i < n; i++) {
        const p = pos(g, i); if (!p) continue;
        const cres = (g.fa[i]?.[1] ?? 100) / 100, r = Math.max(0.15, e.alt * 0.6 * cres);
        const cx = p[0] - o[0], cy = p[1] + e.alt * 0.6 * cres - o[1], cz = p[2] - o[2], tca = cx * d[0] + cy * d[1] + cz * d[2];
        if (tca < 0) continue;
        const d2 = cx * cx + cy * cy + cz * cz - tca * tca; if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2); if (t < bt) { bt = t; best = { g, i }; }
      }
    }
    if (!best) return false;
    const comida = eComida(game.hotbar[game.sel] || 0, B);
    ui.setHint(`${nome(best.g, best.i)} — F ${comida ? 'oferece comida' : 'carinho'}`);
    if (!playing) return true;
    if (input.wasPressed('interact')) net.send({ t: 'fa', op: comida ? 'oferecer' : 'tocar', g: best.g.id, i: best.i });
    else if (input.isDown('break') && performance.now() > golpeAte) { golpeAte = performance.now() + 450; net.send({ t: 'fa', op: 'golpe', g: best.g.id, i: best.i }); }
    return true;
  });
  return {};
}
