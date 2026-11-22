// LAVRA — modo de jogo no aparelho de quem joga (pedido do Kadmus, 16/11/2026: "quero que tenha modos de jogo, similar
// ao minecraft"). As regras estão em shared/modes.js e quem manda é o servidor: ele guarda o modo de cada um (pelo nome)
// e manda `modo { m }`; aqui o aparelho se ajusta. Troca pelo chat (/modo sobrevivência…) ou pela tela de pausa.
//
// O que muda aqui: voo (sobrevivência e aventura não voam; o pulo duplo liga, o passo fixo desliga), atravessar blocos
// (espectador: player.noclip), quebrar (sobrevivência: segura pelo tempo do bloco, HARD em blocks.js; aventura e
// espectador: interaction.locked), de que espaço da mochila sai o bloco posto (net.blockSlot), dano de queda (cada
// bloco acima de 3, como no Minecraft) e de afogamento (15 s de fôlego, depois 2 por segundo), e a interface: classe
// `modo-<id>` no HUD, tela de blocos só com a mochila fora do criativo, botões do criativo escondidos.
// A barra de atalhos vira os 9 primeiros espaços da mochila fora do criativo (game/items.js).
//
// Para quem desenha: game.mode, game.modeRules e interaction.digging ({ x, y, z, k } enquanto se quebra no
// sobrevivência: as rachaduras do bloco são da frente visual; hoje há só uma barrinha provisória sob a mira).
import { MODES, MODE_IDS, DEFAULT_MODE, rulesOf, rulesFor } from '../../shared/modes.js';
import { B, HARD } from '../../shared/blocks.js';
import { tempoDeQuebra, funduraEm, folegoEm } from '../../shared/perigos.js';   // rocha mais dura e fôlego curto no fundo (19/11)
import { h } from '../ui/ui.js';

const AIR_MAX = 15;     // segundos de fôlego debaixo d'água (300 tiques do Minecraft)
const TEXT = {
  criativo: 'Modo Criativo: blocos sem fim, voo (pulo duas vezes) e quebra rápida. Quebrar não solta item.',
  sobrevivencia: 'Modo Sobrevivência: quebrar leva o tempo do bloco e solta o item; a barra é a sua mochila e pôr gasta dela; queda e afogamento machucam.',
  aventura: 'Modo Aventura: anda, pega e larga itens, mas não quebra nem põe blocos.',
  espectador: 'Modo Espectador: voa atravessando tudo, invisível para os outros; não mexe em nada.',
  gm: 'Modo GM: voa atravessando tudo, constrói sem fim, invisível, e a barra de poderes. A entrada pede a senha do servidor.',
};
export const TEXTO_MODOS = TEXT;   // o menu do VR (game/menu-vr.js) mostra o mesmo texto da pausa
const CSS = `
.modo-oculto { display: none !important; }
#hud.modo-espectador .hotbar, #hud.modo-espectador .hint, #hud.modo-espectador .cross { display: none !important; }
#palette.so-mochila .tabs, #palette.so-mochila .grid, #palette.so-mochila .card > .note, #palette.so-mochila .palette-extra > :not(.mochila) { display: none !important; }
.modos { display: grid; gap: 8px; }
.modos > span { font-size: 13px; color: var(--muted, #c3ccd6); }
.modos-botoes { display: grid; grid-template-columns: repeat(auto-fit, minmax(88px, 1fr)); gap: 6px; }
.modos-botoes .btn { padding: 8px 4px; }
.gm-senha-linha { display: flex; gap: 6px; }
.gm-senha-linha.hide { display: none !important; }
.gm-senha-linha input { flex: 1; min-width: 0; padding: 8px; border-radius: 8px; color: #eef3f8;
  border: 1px solid rgba(255, 255, 255, .28); background: linear-gradient(180deg, rgba(18, 24, 34, .95), rgba(8, 10, 16, .95)); }
.quebrando { position: absolute; left: 50%; top: calc(50% + 18px); transform: translateX(-50%); width: 64px; height: 6px; border-radius: 4px; overflow: hidden;
  background: linear-gradient(90deg, rgba(10, 16, 24, .7), rgba(20, 30, 42, .7)); box-shadow: 0 0 0 1px rgba(255, 255, 255, .25); }
.quebrando > i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #f4a64e, #ffd27a); }
.folego { position: absolute; left: 50%; bottom: calc(132px + var(--safe-b, 0px)); transform: translateX(-50%); width: min(240px, 46vw); height: 7px; border-radius: 6px; overflow: hidden;
  background: linear-gradient(90deg, rgba(10, 16, 24, .72), rgba(20, 30, 42, .72)); box-shadow: 0 0 0 1px rgba(255, 255, 255, .22); }
#hud.celular .folego { bottom: calc(68px + var(--safe-b, 0px)); width: min(176px, 44vw); height: 6px; }
.folego > i { display: block; height: 100%; width: 100%; background: linear-gradient(90deg, #2f8fd6, #8ad8ff); transition: width .2s; }
.hotbar .slot b.conta { position: absolute; right: 4px; bottom: 1px; font: 700 11px/1 system-ui; color: #fff; text-shadow: 0 1px 2px #000, 0 0 3px #000; pointer-events: none; }
.mochila-grade .cell.barra { box-shadow: inset 0 -3px 0 rgba(244, 166, 78, .75); }
`;

export function initModes({ game, player, net, ui, input, interaction, store, closeOverlay }) {
  let mode = null;
  let gmLigado = false, regrasDeAntes = null;   // GM com o Modo GM ligado constrói como no criativo em qualquer modo (shared/modes.js → rulesFor)
  let creativeHotbar = null;     // a barra do criativo fica guardada enquanto a barra é a mochila
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  ui.paletteExtra().classList.add('palette-extra');

  // ---- interface: escolha do modo na tela de pausa, barrinha de quebra e fôlego --------------------------------------
  const buttons = new Map();
  const senhaGm = h('input', { type: 'password', maxlength: '64', placeholder: 'Senha do modo GM', autocomplete: 'off' });
  const senhaLinha = h('div', { class: 'gm-senha-linha hide' }, senhaGm, h('button', { class: 'btn small', type: 'button', text: 'Entrar', onclick: () => enviarSenhaGm() }));
  const enviarSenhaGm = () => {
    const k = senhaGm.value;
    senhaGm.value = '';
    if (!k) return ui.toast('Digite a senha do modo GM.');
    if (net.offline) return ui.toast('Sem servidor, só o modo criativo.');
    net.send({ t: 'modo', m: 'gm', k });
  };
  senhaGm.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); enviarSenhaGm(); }
  });
  const pick = (m) => {
    if (m === mode) return;
    if (net.offline) { if (m !== 'criativo') ui.toast('Sem servidor, só o modo criativo.'); return; }
    if (m === 'gm') { senhaLinha.classList.remove('hide'); senhaGm.focus(); return; }
    senhaLinha.classList.add('hide');
    net.send({ t: 'modo', m });
  };
  const row = h('div', { class: 'modos-botoes' }, MODE_IDS.map((m) => {
    const b = h('button', { class: 'btn small', type: 'button', text: MODES[m].nome, title: TEXT[m], onclick: () => pick(m) });
    buttons.set(m, b);
    return b;
  }));
  const card = ui.el.pauseCard;
  card.insertBefore(h('div', { class: 'modos' }, h('span', { text: 'Modo de jogo (como no Minecraft)' }), row, senhaLinha), card.children[2] || null);
  const digBar = h('i'), dig = h('div', { class: 'quebrando hide', 'aria-hidden': 'true' }, digBar);
  const airBar = h('i'), air = h('div', { class: 'folego hide', role: 'progressbar', 'aria-label': 'Fôlego' }, airBar);
  ui.el.hud.append(dig, air);
  const title = ui.el.palette.querySelector('h2');

  function apply(m, announce) {
    const was = mode;
    mode = MODES[m] ? m : DEFAULT_MODE;
    const r = rulesFor(mode, gmLigado), wr = was ? regrasDeAntes : null;
    regrasDeAntes = r;
    game.mode = mode;
    game.modeRules = r;
    player.speedScale = r.gm ? 2.6 : 1;
    if (r.gm) game.gmAtivo = true;
    if (mode === 'gm') senhaLinha.classList.add('hide');
    player.noclip = r.atravessa;
    if (game.espacoAtivo && !game.gmAtivo) {
      if (!r.atravessa) player.flying = false;
    } else if (r.atravessa || (wr && wr.atravessa && r.voa)) player.flying = true;   // saindo do espectador para o criativo: segue voando
    else if (!r.voa) player.flying = false;
    interaction.locked = (!!game.espacoAtivo && !game.gmAtivo) || (!r.quebra && !r.poe);
    // tempo de quebra: o do bloco (HARD) e, na rocha, × a dureza da fundura (shared/perigos.js); o servidor confere o ritmo
    interaction.breakTime = r.quebra === 'tempo' ? (id, x, y, z) => tempoDeQuebra(id, (game.dim || 0) === 0 && Number.isFinite(y) ? funduraEm(game.gen, x, y, z) : 0) : null;
    interaction.digging = null;
    net.blockSlot = r.poe === 'mochila' ? () => game.sel : null;
    // a barra: a do criativo fica guardada; fora dele, quem a preenche é a mochila (game/items.js)
    if (!r.criativo && (!wr || wr.criativo)) creativeHotbar = game.hotbar.slice();
    if (r.criativo && creativeHotbar) { for (let i = 0; i < 9; i++) game.hotbar[i] = creativeHotbar[i]; store.set('hotbar', game.hotbar); creativeHotbar = null; }
    if (!r.criativo && game.tool && game.tool.type === 'shape') { game.tool = null; input.shapeMode = false; }   // formas livres são do criativo
    // interface
    for (const id of MODE_IDS) ui.el.hud.classList.toggle('modo-' + id, id === mode);
    ui.el.palette.classList.toggle('so-mochila', !r.criativo);
    if (title) title.textContent = r.criativo ? 'Blocos' : 'Mochila';
    for (const b of ui.el.corner.children) {
      const t = b.textContent || '';
      const keep = r.criativo || /^(Chat|Menu|Mapa)$/.test(t) || (/^(Mochila|Pegar)/.test(t) && !r.invisivel) || (/^(Tronco:|Mini)/.test(t) && !!r.poe);
      b.classList.toggle('modo-oculto', !keep);
    }
    for (const [id, b] of buttons) b.classList.toggle('on', id === mode);
    if (announce && was !== mode) ui.toast(TEXT[mode], 5200);
  }
  apply(DEFAULT_MODE, false);

  game.hooks.other.push((m) => {
    if (m.t === 'modo') apply(m.m, mode !== null);
    else if (m.t === 'gm') {
      // o Modo GM mudou: as regras de construção mudam junto (lista inteira de blocos, pôr sem gastar)
      const antes = gmLigado;
      gmLigado = !!(m.isGm && m.ativo);
      if (gmLigado !== antes && mode !== null) {
        apply(mode, false);
        if (!rulesOf(mode).criativo && !rulesOf(mode).invisivel) ui.toast(gmLigado ? 'Modo GM: todos os blocos à mão (E abre a lista) e pôr não gasta da mochila.' : 'Modo GM desligado: a barra volta a ser a mochila.', 4200);
      }
    }
    else if (m.t === 'offline') apply('criativo', false);
  });

  // ---- no passo fixo (antes da física): voo, queda e afogamento ------------------------------------------------------
  let airTop = null, wasGround = true, breath = AIR_MAX, drown = 0, lastY = null, airMax = AIR_MAX;
  // fôlego: 15 s na superfície, menos no fundo (água fria e funda: shared/perigos.js → folegoEm)
  const folego = () => ((game.dim || 0) === 0 && game.gen ? folegoEm(funduraEm(game.gen, player.pos[0], player.pos[1] + 1.6, player.pos[2])) : AIR_MAX);
  game.hooks.fixed.push((dt) => {
    const r = game.modeRules;
    if ((!r.voa || (game.espacoAtivo && !game.gmAtivo && !r.atravessa)) && player.flying) player.flying = false;    // o pulo duplo do main.js liga o voo; fora do criativo (ou em espaço funcional), não
    if (r.atravessa && !player.noclip) player.noclip = true;
    if (!r.dano || game.state !== 'PLAYING' || !game.hurt) { airTop = null; breath = AIR_MAX; drown = 0; return false; }
    // queda: conta do ponto mais alto desde que saiu do chão; água e voo zeram (cair na água não machuca), e um salto
    // de posição maior que a queda possível num passo (/tp, renascer, troca de plano) também, como no Minecraft
    const y = player.pos[1];
    if (lastY !== null && Math.abs(y - lastY) > 2) airTop = null;
    lastY = y;
    if (player.onGround) {
      if (airTop !== null && !wasGround) { const dmg = Math.round(airTop - y - 3); if (dmg > 0) game.hurt(dmg, 'a queda'); }
      airTop = null;
    } else if (player.inWater || player.flying) airTop = null;
    else airTop = airTop === null ? y : Math.max(airTop, y);
    wasGround = player.onGround;
    // afogamento: 15 s de fôlego (menos no fundo), depois 2 de dano por segundo; fora d'água o fôlego volta depressa
    airMax = folego();
    if (breath > airMax) breath = airMax;
    if (player.headInWater) {
      breath -= dt;
      if (breath <= 0) { breath = 0; drown += dt; if (drown >= 1) { drown = 0; game.hurt(2, 'a água'); } }
    } else { breath = Math.min(airMax, breath + dt * 6); drown = 0; }
    return false;
  });

  // ---- por quadro: barrinhas, tela de blocos do espectador, e o Q (pegar bloco) fora do criativo ---------------------
  game.hooks.frame.push(() => {
    const r = game.modeRules;
    const d = interaction.digging;
    dig.classList.toggle('hide', !d);
    if (d) digBar.style.width = Math.round(d.k * 100) + '%';
    const showAir = r.dano && breath < airMax - 0.05 && game.state === 'PLAYING';
    air.classList.toggle('hide', !showAir);
    if (showAir) airBar.style.width = Math.round(breath / airMax * 100) + '%';
    if (((r.invisivel && !r.gm) || (game.espacoAtivo && !game.gmAtivo)) && game.overlay === 'palette') closeOverlay();     // espectador e espaços funcionais não usam a paleta; o modo GM constrói
    if (!game.espacoAtivo && !r.criativo && creativeHotbar && input.wasPressed('pick')) {
      // o main.js pôs o bloco mirado na barra e guardou: fora do criativo, o Q escolhe o espaço da barra que tem o item
      store.set('hotbar', creativeHotbar);
      const want = interaction.pick();
      const k = game.items ? game.items.bag.l.findIndex((e, i) => i < 9 && e && e[0] === want) : -1;
      if (k >= 0) game.sel = k;
    }
  });

  const api = { get mode() { return mode; }, get rules() { return game.modeRules; }, set: pick, apply };
  game.modes = api;
  return api;
}
