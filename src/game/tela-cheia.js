// LAVRA — tela cheia com teclado travado (relato do Kadmus, 18/11/2026: "meu jogo fica fechando toda hora quando aperto
// ctrl, shift e W… preciso apertar eles para correr e voar em alta velocidade").
//
// Ctrl+W (fechar aba) e Ctrl+Shift+W (fechar janela) são do navegador e nenhuma página os segura — a não ser em tela
// cheia pedida pela própria página com a Keyboard Lock API (navigator.keyboard.lock): aí o Chrome entrega TODAS as
// teclas ao jogo, inclusive essas. Então, ao clicar para jogar, o jogo entra em tela cheia e trava o teclado.
// O Esc continua chegando ao jogo (pausa); para sair da tela cheia, segura-se o Esc (o próprio Chrome avisa).
// Fora da tela cheia vale a outra proteção (input.js + main.js): correr com W 2× ou R, atalhos com Ctrl contidos e o
// navegador perguntando antes de fechar a aba se houver um Ctrl apertado. `/telacheia` liga/desliga (guardado no aparelho).
export function initTelaCheia({ game, canvas, device }) {
  let ligada = !(device?.touch || device?.quest || device?.ios);
  try { const v = localStorage.getItem('lavra.telacheia'); if (v !== null) ligada = v === '1'; } catch { /* sem armazenamento */ }
  const pode = () => !!document.documentElement.requestFullscreen;
  const travar = () => { try { navigator.keyboard?.lock?.()?.catch(() => {}); } catch { /* sem Keyboard Lock: fica a outra proteção */ } };

  // o clique no jogo é o gesto que o navegador exige para a tela cheia
  canvas.addEventListener('mousedown', () => {
    if (!ligada || !pode() || document.fullscreenElement || game.xr?.presenting) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }, true);
  document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) travar(); else try { navigator.keyboard?.unlock?.(); } catch { /* nada */ } });

  function comando(texto, toast) {
    if (texto !== '/telacheia') return false;
    ligada = !ligada;
    try { localStorage.setItem('lavra.telacheia', ligada ? '1' : '0'); } catch { /* sem armazenamento */ }
    if (!ligada && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    toast(ligada ? 'Tela cheia ao jogar: ligada (o teclado fica todo do jogo; segure Esc para sair).' : 'Tela cheia ao jogar: desligada.', 5000);
    return true;
  }
  const api = { get ligada() { return ligada; }, comando };
  game.telaCheia = api;
  return api;
}
