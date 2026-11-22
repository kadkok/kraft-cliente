// Kraft — o que só existia por tecla ganha botão no toque (celular e iPad), sem entupir a tela: cada botão aparece só
// quando faz sentido (19/11/2026, paridade PC × toque × VR; mapa completo em docs/paridade-controles.md).
//   - "Mini ¼" no canto: só com um bloco que aceita mini-bloco na mão e podendo pôr (fora do campo de futebol e sem
//     forma livre). Manda a mesma ação 'mini' da tecla Y (main.js liga e desliga e avisa).
//   - "Câmera: 1ª/3ª pessoa" na pausa: o V do PC (o mesmo `game.view` que a ação 'view' alterna).
// Os outros botões novos do toque moram com quem os possui: "Pegar" (game/items.js, tecla P), "Levar: 1 por vez" na tela
// do baú (game/baus.js, botão direito do PC), "Usar" na arquibancada senta e levanta (game/bola.js, tecla F).
// Para quem desenha (Astra): os botões usam as classes da casa (.btn small, .btn-mini no canto); só CSS e texto.
import { MINI_OK } from '../../shared/minis.js';
import { h } from '../ui/ui.js';

export function initToqueExtra({ game, ui, input, interaction, device }) {
  if (!device?.touch) return null;
  const src = input.source('toque-extra');
  const mini = h('button', { class: 'btn small btn-mini hide', type: 'button', title: 'Mini-bloco: põe e tira ¼ de bloco (tecla Y no PC)', text: 'Mini ¼',
    onclick: () => { if (game.state === 'PLAYING' && !game.overlay) src.tap('mini'); } });
  mini.addEventListener('pointerdown', (e) => e.stopPropagation());
  ui.el.corner.prepend(mini);

  const vista = h('button', { class: 'btn', type: 'button', text: 'Câmera: 1ª pessoa',
    onclick: () => { game.view = (game.view + 1) % 2; marcarVista(); } });
  const marcarVista = () => { vista.textContent = game.view === 1 ? 'Câmera: 3ª pessoa' : 'Câmera: 1ª pessoa'; vista.classList.toggle('on', game.view === 1); };
  const linha = ui.el.pauseCard.querySelector('.row:last-of-type');
  if (linha) linha.prepend(vista); else ui.el.pauseCard.append(vista);

  game.hooks.frame.push(() => {
    const r = game.modeRules || {}, na = game.hotbar[game.sel] | 0;
    const mostra = game.state === 'PLAYING' && !game.overlay && !game.espacoAtivo && !game.tool && !!r.poe && (interaction.miniMode || (na > 0 && na < 256 && !!MINI_OK[na]));
    if (mini.classList.contains('hide') === mostra) mini.classList.toggle('hide', !mostra);
    const on = !!interaction.miniMode;
    if (mini.classList.contains('on') !== on) { mini.classList.toggle('on', on); mini.textContent = on ? 'Mini ¼: ligado' : 'Mini ¼'; }
    if (game.state === 'PAUSED') marcarVista();
  });
  return { mini, vista };
}
