// LAVRA — barra do modo GM. Só aparece com game.mode === 'gm'. O servidor confere de novo cada pedido.
// Faixa do HUD, não uma janela travada: quebra a linha e acompanha a largura da tela.
import { h } from '../ui/ui.js';
import { ARVORES } from '../../shared/gm.js';

const CSS = `
.gm-barra { position: absolute; z-index: 6; left: 50%; top: calc(8px + env(safe-area-inset-top, 0px)); transform: translateX(-50%);
  width: min(980px, calc(100vw - 16px)); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; pointer-events: auto;
  padding: 8px; border-radius: 12px; color: #eef3f8;
  background: linear-gradient(180deg, rgba(28, 36, 48, .92), rgba(12, 16, 24, .9));
  box-shadow: 0 8px 24px rgba(0, 0, 0, .35), inset 0 0 0 1px rgba(255, 255, 255, .16); }
.gm-barra.hide { display: none !important; }
.gm-barra .btn { padding: 6px 8px; }
.gm-barra input, .gm-barra select { min-width: 0; padding: 6px 8px; border-radius: 8px; color: #eef3f8;
  border: 1px solid rgba(255, 255, 255, .28); background: linear-gradient(180deg, rgba(18, 24, 34, .95), rgba(8, 10, 16, .95)); }
.gm-barra .gm-pin { font: 600 12px/1.3 system-ui; color: #d5deea; }
`;

export function initGm({ game, net, ui, mapa }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  let pin = null, outro = null, origem = false;
  const pinTxt = h('span', { class: 'gm-pin', text: 'Nenhum ponto marcado.' });
  const nomeAnel = h('input', { type: 'text', maxlength: '24', placeholder: 'Nome do par (opcional)', autocomplete: 'off' });
  const nomePessoa = h('input', { type: 'text', maxlength: '24', placeholder: 'Nome de quem joga', autocomplete: 'off' });
  const especie = h('input', { type: 'text', maxlength: '32', placeholder: 'Espécie (coelho, lobo…)', autocomplete: 'off' });
  const tipoArvore = h('select', {}, Object.keys(ARVORES).map((k) => h('option', { value: k, text: k })));
  const manda = (op, extra = {}) => {
    if (game.mode !== 'gm') return ui.toast('Entre no modo GM.');
    if (net.offline) return ui.toast('O modo GM precisa do servidor.');
    net.send({ t: 'gmop', op, ...extra });
  };
  const marcar = (fn) => {
    if (!mapa?.escolher) return ui.toast('O mapa ainda não está pronto.');
    const ok = mapa.escolher(fn);
    if (!ok) ui.toast('Feche o que está aberto e marque no mapa.');
  };
  const bar = h('div', { class: 'gm-barra hide' },
    h('button', { class: 'btn small', type: 'button', text: 'Marcar no mapa', onclick: () => marcar((x, z) => { pin = { x, z }; pinTxt.textContent = `Ponto ${x}, ${z}. Ir agora confirma.`; }) }),
    h('button', { class: 'btn small', type: 'button', text: 'Ir agora', onclick: () => { if (!pin) return ui.toast('Marque um ponto no mapa.'); manda('mapa', pin); } }),
    pinTxt,
    h('button', { class: 'btn small', type: 'button', text: 'Anel aqui', onclick: () => { origem = true; manda('anel', { passo: 'aqui' }); } }),
    h('button', { class: 'btn small', type: 'button', text: 'Outro lado', onclick: () => marcar((x, z) => { outro = { x, z }; ui.toast(`Outro lado em ${x}, ${z}.`); }) }),
    nomeAnel,
    h('button', { class: 'btn small', type: 'button', text: 'Plantar os dois', onclick: () => { if (!origem || !outro) return ui.toast('Marque a origem e o outro lado.'); manda('anel', { passo: 'plantar', ...outro, nome: nomeAnel.value }); } }),
    h('button', { class: 'btn small', type: 'button', text: 'Apagar anel', onclick: () => manda('apagar', { nome: nomeAnel.value }) }),
    nomePessoa,
    h('button', { class: 'btn small', type: 'button', text: 'Ir até', onclick: () => manda('ir', { nome: nomePessoa.value }) }),
    h('button', { class: 'btn small', type: 'button', text: 'Trazer', onclick: () => manda('trazer', { nome: nomePessoa.value }) }),
    especie,
    h('button', { class: 'btn small', type: 'button', text: 'Bicho adulto', onclick: () => manda('bicho', { nome: especie.value }) }),
    tipoArvore,
    h('button', { class: 'btn small', type: 'button', text: 'Árvore grande', onclick: () => manda('arvore', { nome: tipoArvore.value }) }),
    h('button', { class: 'btn small', type: 'button', text: 'Aldeia aqui', onclick: () => manda('povoado') }),
    h('button', { class: 'btn small', type: 'button', text: 'Carro', onclick: () => manda('carro') }),
    h('button', { class: 'btn small', type: 'button', text: 'Avião', onclick: () => manda('aviao') }),
    h('button', { class: 'btn small', type: 'button', text: 'Barco', onclick: () => manda('barco') }),
    h('button', { class: 'btn small', type: 'button', text: 'Bola', onclick: () => manda('bola') }),
    h('button', { class: 'btn small', type: 'button', text: 'Ilha no mar', onclick: () => manda('ilha') }),
  );
  ui.el.hud.append(bar);
  game.hooks.frame.push(() => { bar.classList.toggle('hide', game.mode !== 'gm' || game.state !== 'PLAYING'); });
  return { bar };
}
