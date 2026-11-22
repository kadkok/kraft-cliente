// Kraft — o nome do botão de cada ação em cada aparelho, para as dicas e os avisos falarem a língua de quem joga
// (19/11/2026, paridade PC × toque × VR: no visor "aperte F" não ajuda ninguém). Puro: sem DOM.
//   pc    = teclado e mouse · toque = botões na tela (celular, iPad) · vr = controles do Meta Quest (xr.js)
// O mapa completo, ação por ação, está em docs/paridade-controles.md.
export const TECLAS = Object.freeze({
  interact: { pc: 'F', toque: 'Usar', vr: 'B' },
  quebrar: { pc: 'clique', toque: 'Quebrar', vr: 'gatilho direito' },
  chute: { pc: 'clique ou F', toque: 'Chutar', vr: 'gatilho direito' },
  chuteLivre: { pc: 'F', toque: 'Chutar', vr: 'gatilho direito' },          // fora da zona do campo, perto da bola
  skill: { pc: '1–9', toque: 'a barra de habilidades', vr: 'gatilho/aperto esquerdos' },
  curva: { pc: 'Q', toque: 'Curva', vr: 'B' },
  gm: { pc: 'G', toque: 'botão 👑', vr: 'X → Futebol' },
  painelFut: { pc: 'G ou H', toque: '⚽ Partida', vr: 'X → Futebol' },
  mochila: { pc: 'E', toque: 'Mochila', vr: 'X → Mochila' },
  levantar: { pc: 'F, Espaço ou WASD', toque: 'Usar, Pular ou o polegar', vr: 'B, A ou o analógico' },
  pegar: { pc: 'P', toque: 'Pegar', vr: 'X → Mochila → Pegar' },
  menu: { pc: 'Esc', toque: 'Menu', vr: 'X' },
});

export function plataformaDe(game) {
  return game?.xr?.presenting ? 'vr' : game?.toque ? 'toque' : 'pc';
}

export function tecla(game, acao) {
  const t = TECLAS[acao];
  return t ? t[plataformaDe(game)] || t.pc : '';
}
