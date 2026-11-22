// Kraft (LAVRA) — perigos do fundo no aparelho (pedido do Kadmus, 19/11/2026; lei em shared/perigos.js, servidor em
// server/perigos.js). Aqui só sons que já existem e o tremor de câmera que o dano já usa: o DESENHO é do Astra.
//
// CONTRATO para quem desenha e sonoriza — mensagens do servidor:
//   { t: 'perigo', k: 'teto', e: 'range', em, p }  o teto acima de p = [x, y, z] cai em `em` s. Hoje: rangido de pedra
//        repetido e tremor leve. Falta desenhar: pó e pedrinhas caindo do teto, rachaduras em volta de p.
//   { t: 'perigo', k: 'teto', e: 'caiu', p, n }    caiu (n blocos viraram cascalho e desceram). Hoje: estrondo grave e
//        tremor pela distância. Falta desenhar: nuvem de pó que assenta em ~3 s.
//   { t: 'perigo', k: 'gas' | 'calor' | 'soterrado', v }   faixa 0 … 1 na cabeça de quem joga (0 = saiu), só quando muda.
//        Fica em `game.perigo = { gas, calor, soterrado }`. Falta desenhar: névoa esverdeada e vista turva (gás), ar
//        tremendo e vinheta quente (calor), tela escura e som abafado (soterrado).
// Avisos em texto chegam como `sys` (chat). A vida é a de sempre (mensagem `dano`, entities.js): vale a regra do modo.
export function initPerigos({ game, player }) {
  game.perigo = { gas: 0, calor: 0, soterrado: 0 };
  const rangendo = [];   // { p, ate, prox }
  const longe = (p) => Math.hypot(player.pos[0] - p[0], player.pos[1] - p[1], player.pos[2] - p[2]);
  game.hooks.other.push((m) => {
    if (m.t !== 'perigo') return;
    if (m.k === 'teto' && Array.isArray(m.p)) {
      const p = [m.p[0] + 0.5, m.p[1] + 1.5, m.p[2] + 0.5];
      if (m.e === 'range') rangendo.push({ p, ate: performance.now() + (Number(m.em) || 1.5) * 1000, prox: 0 });
      else if (m.e === 'caiu') {
        game.audio?.play('boom', 0.9, 0.55, 'stone', p);
        game.audio?.play('break', 0.8, 0.6, 'gravel', p);
        const d = longe(p);
        game.shake = Math.max(game.shake || 0, d < 6 ? 0.6 : d < 14 ? 0.3 : 0.12);
      }
    } else if (m.k in game.perigo) game.perigo[m.k] = Math.max(0, Math.min(1, Number(m.v) || 0));
  });
  game.hooks.frame.push(() => {
    if (!rangendo.length) return;
    const agora = performance.now();
    for (let i = rangendo.length - 1; i >= 0; i--) {
      const r = rangendo[i];
      if (agora > r.ate) { rangendo.splice(i, 1); continue; }
      if (agora < r.prox) continue;
      r.prox = agora + 260 + Math.random() * 220;
      game.audio?.play('break', 0.35, 0.45 + Math.random() * 0.15, 'stone', r.p);
      if (longe(r.p) < 10) game.shake = Math.max(game.shake || 0, 0.08);
    }
  });
}
