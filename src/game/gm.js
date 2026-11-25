// Ferramentas do modo GM. O servidor confere a autorização de cada operação.
import { h } from '../ui/ui.js';
import { ARVORES } from '../../shared/gm.js';
import { initStargate } from './stargate.js';
import { initPortas } from './portas.js';
import { initElevador } from './elevador.js';
import { initMitico } from './mitico.js';   // GM quebra a rocha-mãe mais funda: mundo mítico (23/11)   // elevador de verdade (23/11): cabine, seletor de andares   // portas de qualquer bloco (23/11): clicar abre/fecha   // portal secreto da ilhota do Karlion (23/11): lista de ilhas ao cruzar o anel

const CSS = `
.gm-acesso[hidden], .gm-tela[hidden] { display: none !important; }
.gm-tela { position: fixed; inset: 0; z-index: 65; display: grid; place-items: center; padding: clamp(7px, 2.5vw, 30px); background: #09131dc2; }
.gm-barra { width: min(100%, 52rem); max-width: 100%; max-height: 100%; min-width: min(15rem, 100%); min-height: min(10rem, 100%); box-sizing: border-box; resize: both; overflow: auto; padding: clamp(.65rem, 2vw, 1.3rem); color: #eef3f8; }
.gm-tela.ampliada .gm-barra { width: 100% !important; height: 100% !important; resize: none; }
.gm-cabeca, .gm-acoes { display: flex; align-items: center; flex-wrap: wrap; gap: .45rem; }
.gm-cabeca { position: sticky; top: 0; z-index: 1; background: #192835; padding: .2rem 0 .45rem; }
.gm-cabeca h2 { flex: 1; margin: 0; }
.gm-grupos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); gap: .65rem; margin: 1rem 0; }
.gm-grupos fieldset { min-width: 0; margin: 0; padding: .65rem; border: 1px solid #506171; border-radius: .6rem; }
.gm-grupos legend { padding: 0 .3rem; font-weight: 700; }
.gm-grupos label, .gm-grupos .gm-pin { display: block; margin: .25rem 0; }
.gm-pin { font-size: .85rem; color: #d5deea; }
.gm-grupos input, .gm-grupos select { display: block; width: 100%; box-sizing: border-box; margin: .2rem 0 .45rem; padding: .45rem; border: 1px solid #8698a6; border-radius: .35rem; color: #f4f7fa; background: #14212b; font: inherit; }
.gm-barra :focus-visible { outline: 2px solid #ffcf7d; outline-offset: 2px; }

`;

export function initGm({ game, net, ui, mapa, openOverlay, closeOverlay, pausar, touch }) {
  document.head.append(h('style', { text: CSS }));
  initStargate({ game, net, ui, openOverlay, closeOverlay });
  initPortas({ game, net });
  initElevador({ game, net, openOverlay, closeOverlay });
  initMitico({ game, net });
  let pin = null,
    outro = null,
    origem = false;
  let entradaVista = false,
    voltarDoMapa = false,
    soltouEm = -Infinity;
  const botao = (text, onclick) => h('button', { class: 'btn small', type: 'button', text, onclick });
  const acoes = (...filhos) => h('div', { class: 'gm-acoes' }, ...filhos);
  const campo = (rotulo, max, placeholder) => {
    const el = h('input', { type: 'text', maxlength: String(max), placeholder, autocomplete: 'off' });
    return { el, linha: h('label', {}, rotulo, el) };
  };
  const grupo = (nome, ...filhos) => h('fieldset', {}, h('legend', { text: nome }), ...filhos);
  const pinTxt = h('span', { class: 'gm-pin', 'aria-live': 'polite', text: 'Nenhum ponto marcado.' });
  const anel = campo('Nome do par de anéis', 24, 'Opcional');
  const pessoa = campo('Nome de quem joga', 24, 'Nome do jogador');
  const especie = campo('Espécie', 32, 'Coelho, lobo…');
  const arvore = h(
    'select',
    {},
    Object.keys(ARVORES).map((k) => h('option', { value: k, text: k })),
  );
  function manda(op, extra = {}) {
    if (game.mode !== 'gm') return ui.toast('Entre no modo GM.');
    if (net.offline) return ui.toast('O modo GM precisa do servidor.');
    net.send({ t: 'gmop', op, ...extra });
  }
  function marcar(fn) {
    if (!mapa?.escolher) return ui.toast('O mapa ainda não está pronto.');
    closeOverlay(false);
    voltarDoMapa = true;
    if (!mapa.escolher(fn)) {
      voltarDoMapa = false;
      abrir();
      ui.toast('Não foi possível abrir o mapa.');
    }
  }
  const ampliar = botao('Maximizar', alternarTamanho);
  ampliar.setAttribute('aria-pressed', 'false');
  const voltar = botao('Voltar ao jogo', () => closeOverlay());
  const menu = botao('Menu do jogo', () => {
    closeOverlay(false);
    pausar();
  });
  const cabeca = h(
    'header',
    { class: 'gm-cabeca' },
    h('h2', { id: 'gm-titulo', text: 'Painel GM' }),
    ampliar,
    menu,
    voltar,
  );
  const grupos = h(
    'div',
    { class: 'gm-grupos' },
    grupo(
      'Mapa',
      acoes(
        botao('Marcar no mapa', () =>
          marcar((x, z) => {
            pin = { x, z };
            pinTxt.textContent = 'Ponto ' + x + ', ' + z + '. Ir agora confirma.';
          }),
        ),
        botao('Ir agora', () => (pin ? manda('mapa', pin) : ui.toast('Marque um ponto no mapa.'))),
      ),
      pinTxt,
    ),
    grupo(
      'Anéis',
      anel.linha,
      acoes(
        botao('Anel aqui', () => {
          origem = true;
          manda('anel', { passo: 'aqui' });
        }),
        botao('Outro lado', () =>
          marcar((x, z) => {
            outro = { x, z };
            ui.toast('Outro lado em ' + x + ', ' + z + '.');
          }),
        ),
        botao('Plantar os dois', () =>
          origem && outro
            ? manda('anel', { passo: 'plantar', ...outro, nome: anel.el.value })
            : ui.toast('Marque a origem e o outro lado.'),
        ),
        botao('Apagar anel', () => manda('apagar', { nome: anel.el.value })),
      ),
    ),
    grupo(
      'Jogadores',
      pessoa.linha,
      acoes(
        botao('Ir até', () => manda('ir', { nome: pessoa.el.value })),
        botao('Trazer', () => manda('trazer', { nome: pessoa.el.value })),
      ),
    ),
    grupo(
      'Natureza',
      especie.linha,
      botao('Bicho adulto', () => manda('bicho', { nome: especie.el.value })),
      h('label', {}, 'Tipo de árvore', arvore),
      acoes(
        botao('Árvore grande', () => manda('arvore', { nome: arvore.value })),
        botao('Aldeia aqui', () => manda('povoado')),
        botao('Ilha no mar', () => manda('ilha')),
      ),
    ),
    grupo(
      'Veículos e bola',
      acoes(
        ...[
          ['Carro', 'carro'],
          ['Avião', 'aviao'],
          ['Barco', 'barco'],
          ['Bola', 'bola'],
        ].map(([nome, op]) => botao(nome, () => manda(op))),
      ),
    ),
  );
  const bar = h(
    'section',
    {
      class: 'panel gm-barra',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'gm-titulo',
      tabindex: '-1',
    },
    cabeca,
    grupos,
  );
  const tela = h('div', { class: 'gm-tela' }, bar);
  const acesso = botao(touch ? 'Painel GM' : 'Painel GM · F2', () => abrir());
  acesso.classList.add('gm-acesso');
  acesso.setAttribute('aria-haspopup', 'dialog');
  acesso.title = 'Abrir o painel GM (Esc ou F2)';
  acesso.hidden = tela.hidden = true;
  document.body.append(tela);
  ui.el.corner.append(acesso);

  function alternarTamanho() {
    const grande = tela.classList.toggle('ampliada');
    ampliar.textContent = grande ? 'Restaurar' : 'Maximizar';
    ampliar.setAttribute('aria-pressed', String(grande));
  }
  cabeca.addEventListener('dblclick', (e) => {
    if (!e.target.closest('button')) alternarTamanho();
  });
  function abrir(aoSoltar = false) {
    if (game.mode !== 'gm' || game.state !== 'PLAYING' || game.overlay) return false;
    entradaVista = true;
    if (aoSoltar) soltouEm = performance.now();
    openOverlay('gm');
    tela.hidden = false;
    bar.focus({ preventScroll: true });
    return true;
  }
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.code === 'F2') return;
    e.stopPropagation(); // Letras, espaço e as teclas de edição pertencem ao campo em foco.
    if (e.key !== 'Tab') return;
    const itens = [...bar.querySelectorAll('button,input,select')].filter((el) => !el.disabled);
    if (e.shiftKey && (e.target === itens[0] || e.target === bar)) {
      e.preventDefault();
      itens.at(-1)?.focus();
    }
    if (!e.shiftKey && e.target === itens.at(-1)) {
      e.preventDefault();
      itens[0]?.focus();
    }
  });
  addEventListener(
    'keydown',
    (e) => {
      if (
        e.code !== 'F2' ||
        e.repeat ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        game.mode !== 'gm' ||
        game.state !== 'PLAYING'
      )
        return;
      if (game.overlay === 'gm') closeOverlay();
      else if (!abrir()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  game.hooks.other.push((m) => {
    if (m.t === 'overlay-closed' && m.was === 'gm') {
      tela.hidden = true;
      if (bar.contains(document.activeElement)) document.activeElement.blur();
    }
    if (m.t === 'overlay-closed' && m.was === 'mapa' && voltarDoMapa) {
      voltarDoMapa = false;
      abrir();
    }
    if (m.t === 'welcome' || m.t === 'offline') {
      pin = outro = null;
      origem = voltarDoMapa = entradaVista = false;
      anel.el.value = pessoa.el.value = especie.el.value = '';
      pinTxt.textContent = 'Nenhum ponto marcado.';
    }
  });
  game.hooks.frame.push(() => {
    const gm = game.mode === 'gm',
      jogando = game.state === 'PLAYING';
    if (!gm) {
      entradaVista = voltarDoMapa = false;
      if (game.overlay === 'gm') closeOverlay();
    }
    if (gm && jogando && !entradaVista && !game.overlay) abrir();
    if (!jogando || game.overlay !== 'gm') tela.hidden = true;
    const esconder = !gm || !jogando || !!game.overlay;
    if (acesso.hidden !== esconder) acesso.hidden = esconder;
  });
  return {
    abrir,
    aoContinuar: () => !entradaVista && abrir(),
    // Alguns navegadores entregam pointerlockchange antes do keydown do mesmo Escape.
    acabouDeSoltar: () => performance.now() - soltouEm < 100,
  };
}
