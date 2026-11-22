// Kraft — baú no aparelho (server/baus.js é o dono). Mirar o baú e apertar F abre (Usar no toque, B no VR); a tela mostra o
// baú e a mochila: clique leva a pilha toda de um lado para o outro, botão direito leva só 1 (no toque, o botão "Levar: 1
// por vez"); Esc ou o botão fecham. No VR a tela é a aba Baú do menu (game/menu-vr.js), pelas mesmas `pegar`/`por` daqui.
// Quem decide se pode (distância, modo, espaço) é o servidor: aqui só se pede e se desenha o que ele mandou.
//
// Contrato para quem desenha (Astra): o baú é um objeto do mundo com `o.bau` (forma 'cubo' de tábuas, provisória);
// o desenho dele (tampa que abre, ferragens, brilho do baú lendário) entra pelo `objects/` lendo `o.bau`, sem mexer
// aqui. Ícones dos tesouros: `game.items.icon` (hoje o desenho do bloco `aparencia` do catálogo, shared/tesouros.js).
import { BAU_SLOTS, valorDaLista, textoDoValor, tesouroDe, valorDe, NOME_NIVEL, NOME_RARIDADE } from '../../shared/tesouros.js';
import { itemName, BAG_SLOTS } from '../../shared/items.js';
import { h } from '../ui/ui.js';
import { KIND, K_CROSS } from '../../shared/blocks.js';
import { tecla } from './teclas.js';

export const ALCANCE_MIRA = 4.5;

const CSS = `
.bau-tela { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 16px;
  background: linear-gradient(180deg, rgba(6, 10, 16, .55), rgba(6, 10, 16, .78)); pointer-events: auto; }
.bau-tela.hide { display: none; }
.bau-card { width: min(720px, 100%); max-height: 100%; overflow: auto; display: grid; gap: 10px; padding: 16px 18px;
  background: var(--panel) padding-box, var(--edge) border-box; border: 1px solid transparent; border-radius: 16px; color: var(--ink); }
.bau-topo { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.bau-topo b { font-size: 17px; }
.bau-topo .bau-valor { margin-left: auto; font-weight: 700; background: linear-gradient(90deg, #f6d27a, #f4a64e); -webkit-background-clip: text; background-clip: text; color: transparent; }
.bau-lado { display: grid; gap: 6px; }
.bau-lado h4 { margin: 0; font-size: 13px; color: var(--muted); font-weight: 600; letter-spacing: .02em; }
.bau-tela .cell.lenda { box-shadow: inset 0 0 0 2px rgba(246, 210, 122, .85); }
.bau-rodape { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
`;

export function initBaus({ game, net, ui, input, interaction, openOverlay, closeOverlay }) {
  const estilo = document.createElement('style'); estilo.textContent = CSS; document.head.appendChild(estilo);
  let aberto = null;                       // { id (objeto do baú), nivel, l, valor } — o que o servidor mandou
  let umPorVez = false;                    // toque: sem botão direito, o clique leva 1 quando ligado
  // as duas portas de troca (tela do PC/celular e aba Baú do VR): n = 0 leva a pilha toda
  const pegar = (i, n = 0) => net.send(n > 0 ? { t: 'bau', op: 'pegar', i, n } : { t: 'bau', op: 'pegar', i });
  const por = (k, n = 0) => net.send(n > 0 ? { t: 'bau', op: 'por', k, n } : { t: 'bau', op: 'por', k });
  const tela = h('div', { class: 'bau-tela hide', role: 'dialog', 'aria-label': 'Baú' });
  tela.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.appendChild(tela);

  function celula(e, extra, onLeva, onUm) {
    if (!e) return h('button', { class: 'cell vazio', type: 'button', 'aria-label': 'espaço vazio' });
    const t = tesouroDe(e[0]);
    const nome = itemName(e[0], e[1]) + (t ? ` — ${NOME_RARIDADE[t.raridade]}, vale ${textoDoValor(valorDe(e[0]))}` : '');
    const cv = h('canvas', { width: 64, height: 64 });
    game.items?.icon(cv, e[0], e[1], 64);
    const b = h('button', { class: 'cell' + (t?.arma ? ' lenda' : '') + extra, type: 'button', title: `${e[2]} ${nome}`, 'aria-label': `${e[2]} ${nome}`, onclick: onLeva },
      cv, h('small', { text: String(e[2]) }));
    b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); onUm(); });
    return b;
  }
  function render() {
    if (!aberto) return;
    const bag = game.items?.bag?.l || [];
    const gradeBau = h('div', { class: 'mochila-grade' });
    for (let i = 0; i < BAU_SLOTS; i++) {
      gradeBau.append(celula(aberto.l[i], '', () => pegar(i, umPorVez ? 1 : 0), () => pegar(i, 1)));
    }
    const gradeMochila = h('div', { class: 'mochila-grade' });
    for (let k = 0; k < BAG_SLOTS; k++) {
      const barra = k < 9 && game.modeRules && !game.modeRules.criativo ? ' barra' : '';
      gradeMochila.append(celula(bag[k], barra, () => por(k, umPorVez ? 1 : 0), () => por(k, 1)));
    }
    const lenda = aberto.l.find((e) => e && tesouroDe(e[0])?.arma);
    tela.replaceChildren(h('div', { class: 'bau-card' },
      h('div', { class: 'bau-topo' },
        h('b', { text: `📦 Baú ${NOME_NIVEL[aberto.nivel] || ''}`.trim() }),
        h('span', { class: 'note', text: lenda ? `Há uma arma lendária aqui: ${tesouroDe(lenda[0]).nome}.` : '' }),
        h('span', { class: 'bau-valor', text: `vale ${textoDoValor(valorDaLista(aberto.l))}` })),
      h('div', { class: 'bau-lado' }, h('h4', { text: 'No baú' }), gradeBau),
      h('div', { class: 'bau-lado' }, h('h4', { text: 'Sua mochila' }), gradeMochila),
      h('div', { class: 'bau-rodape' },
        h('span', { class: 'note', text: game.toque ? 'Toque leva a pilha toda (ou 1, com o botão ao lado).' : 'Clique leva a pilha toda · botão direito leva só 1 · Esc fecha.' }),
        game.toque ? h('button', { class: 'btn small' + (umPorVez ? ' on' : ''), type: 'button', text: umPorVez ? 'Levar: 1 por vez' : 'Levar: a pilha toda',
          onclick: () => { umPorVez = !umPorVez; render(); } }) : null,
        h('button', { class: 'btn small', type: 'button', text: 'Fechar', onclick: () => fechar(true) }))));
  }
  function abrir(m) {
    aberto = { id: m.id, nivel: m.nivel, l: Array.isArray(m.l) ? m.l : [], valor: m.valor || 0 };
    if (game.overlay !== 'bau') openOverlay('bau');
    tela.classList.remove('hide');
    render();
    game.audio?.play('abrir', 0.8, 1);
  }
  function fechar(avisar) {
    if (!aberto) return;
    aberto = null;
    tela.classList.add('hide');
    if (avisar) net.send({ t: 'bau', op: 'fechar' });
    if (game.overlay === 'bau') closeOverlay();
    game.audio?.play('fechar', 0.7, 1);
  }

  game.hooks.other.push((m) => {
    if (m.t === 'bau') { if (m.op === 'conteudo') abrir(m); else if (m.op === 'fechado') fechar(false); }
    else if (m.t === 'overlay-closed' && m.was === 'bau') fechar(true);       // Esc
    else if (m.t === 'bag' && aberto) render();                               // a mochila mudou
  });

  // Mira: baú na frente → dica; F abre (vem antes do editor de formas, que abriria o editor do objeto).
  game.hooks.interact.unshift((dt, playing, o, d) => {
    if (game.overlay === 'bau') return true;
    if (!game.objects?.raycast) return false;
    // planta rasteira na frente (capim, flor) não esconde o baú; bloco de verdade, sim
    const vox = interaction.target, barra = vox.hit && KIND[vox.id] !== K_CROSS;
    const lim = Math.min(barra ? vox.t : ALCANCE_MIRA, ALCANCE_MIRA, game.treeAim?.t ?? Infinity);
    const hit = game.objects.raycast(o, d, lim);
    const obj = hit?.entry?.o;
    if (!obj || !obj.bau) return false;
    ui.setHint(`📦 Baú — ${tecla(game, 'interact')} abre` + (game.modeRules?.criativo ? ' · quebrar recolhe (o que há dentro cai no chão)' : ''));
    if (playing && input.wasPressed('interact')) net.send({ t: 'bau', op: 'abrir', id: obj.id });
    else if (playing && input.wasPressed('break') && game.modeRules?.criativo) game.objects.destroy(obj.id);
    return true;
  });

  const api = { get aberto() { return aberto; }, abrirPor: (id) => net.send({ t: 'bau', op: 'abrir', id }), fechar: () => fechar(true), pegar, por };
  game.baus = api;
  return api;
}
