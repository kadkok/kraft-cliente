// LAVRA — portal secreto (stargate) no aparelho: mostra a lista de ilhas que o servidor mandou ao entrar no anel da
// ilhota do Karlion (server/stargate.js) e devolve a escolha. Quem confere e leva é o servidor; aqui não há salto.
// Discreto: só aparece para quem está dentro do anel; teclas 1–9 escolhem, Esc fica.
import { h } from '../ui/ui.js';

const CSS = `
.sg-tela[hidden] { display: none !important; }
.sg-tela { position: fixed; inset: 0; z-index: 66; display: grid; place-items: center; padding: 12px; background: #050b12a8; }
.sg-caixa { width: min(100%, 24rem); max-height: 100%; overflow: auto; box-sizing: border-box; padding: 1rem; color: #e9f1f7; }
.sg-caixa h2 { margin: 0 0 .25rem; font-size: 1.05rem; letter-spacing: .04em; }
.sg-caixa p { margin: 0 0 .7rem; font-size: .85rem; color: #b9c8d4; }
.sg-lista { display: grid; gap: .4rem; }
.sg-lista button { text-align: left; }
.sg-lista button kbd { display: inline-block; min-width: 1.3em; margin-right: .5em; opacity: .7; font: inherit; }
.sg-caixa :focus-visible { outline: 2px solid #8fd3ff; outline-offset: 2px; }
`;

export function initStargate({ game, net, ui, openOverlay, closeOverlay }) {
  document.head.append(h('style', { text: CSS }));
  const lista = h('div', { class: 'sg-lista' });
  const caixa = h('section', { class: 'panel sg-caixa', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sg-titulo', tabindex: '-1' },
    h('h2', { id: 'sg-titulo', text: 'Portal' }),
    h('p', { text: 'Para onde o anel leva você?' }),
    lista);
  const tela = h('div', { class: 'sg-tela' }, caixa);
  tela.hidden = true;
  document.body.append(tela);
  let ids = [], respondeu = true, ofertas = 0;

  function responder(id) {
    if (respondeu) return;
    respondeu = true;
    if (!net.offline) net.send({ t: 'gmop', op: 'stargate', id: id ?? '' });
    if (game.overlay === 'stargate') closeOverlay();
    tela.hidden = true;
  }
  function abrir(m) {
    const l = Array.isArray(m.lista) ? m.lista.slice(0, 9) : [];
    if (!l.length || game.state !== 'PLAYING') return;
    if (game.overlay && game.overlay !== 'stargate') return;   // algo aberto: o servidor manda de novo na próxima entrada
    ids = l.map((f) => String(f.id));
    lista.replaceChildren(
      ...l.map((f, i) => h('button', { class: 'btn', type: 'button', onclick: () => responder(ids[i]) }, h('kbd', { text: String(i + 1) }), String(f.nome || f.id))),
      h('button', { class: 'btn small', type: 'button', text: 'Ficar aqui (Esc)', onclick: () => responder(null) }),
    );
    respondeu = false; ofertas++;
    openOverlay('stargate');
    tela.hidden = false;
    caixa.focus({ preventScroll: true });
    clearTimeout(abrir.t);
    abrir.t = setTimeout(() => { if (!respondeu) responder(null); }, Math.max(5000, Math.min(60000, Number(m.ate) || 45000) - 1500));
  }
  caixa.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return responder(null); }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= ids.length) { e.preventDefault(); e.stopPropagation(); return responder(ids[n - 1]); }
    if (e.key !== 'Tab' && e.key !== 'Enter' && e.key !== ' ') e.stopPropagation();
  });
  game.hooks.other.push((m) => {
    if (m.t === 'stargate') abrir(m);
    if (m.t === 'overlay-closed' && m.was === 'stargate' && !respondeu) responder(null);
    if (m.t === 'welcome' || m.t === 'offline') {   // chegada (dim) ou queda: a lista não vale mais
      respondeu = true; tela.hidden = true; clearTimeout(abrir.t);   // a tela vazia fecha no próximo quadro (abaixo)
    }
  });
  game.hooks.frame.push(() => {
    if (!tela.hidden && game.overlay !== 'stargate') tela.hidden = true;
    if (tela.hidden && respondeu && game.overlay === 'stargate') closeOverlay();   // nunca deixa o jogo preso numa tela vazia
  });
  game.stargate = { aberto: () => !tela.hidden, escolher: (id) => responder(id), ofertas: () => ofertas };
}
