import { h } from '../ui/ui.js';
import { VEICULOS, TIPOS } from '../../shared/veiculos-kids.js';

export function painelGaragem({ ui, game, openOverlay, closeOverlay, chamar, acao, sair, entrar }) {
  const botao = (nome, fn) => h('button', { type: 'button', class: 'btn', text: nome, onclick: fn });
  const destino = h('span', { 'aria-live': 'polite', class: 'garagem-status' });
  const opcoes = h('div', { class: 'garagem-opcoes' });
  for (const tipo of TIPOS) {
    const nome = VEICULOS[tipo].nome;
    const img = h('img', {
      src: new URL('../../assets/veiculos-kids/' + tipo + '.webp', import.meta.url).href,
      alt: '',
      loading: 'lazy',
    });
    opcoes.append(
      h(
        'button',
        {
          class: 'garagem-opcao',
          type: 'button',
          'aria-label': 'Chamar ' + nome,
          onclick: () => {
            if (chamar(tipo)) closeOverlay();
          },
        },
        img,
        h('span', { text: nome }),
      ),
    );
  }
  const fechar = botao('Fechar', () => closeOverlay());
  const ampliar = botao('Maximizar', () => alternarTamanho());
  ampliar.setAttribute('aria-pressed', 'false');
  const titulo = h('header', {}, h('h2', { text: 'Garagem' }), ampliar, fechar);
  function alternarTamanho() {
    const cheia = tela.classList.toggle('garagem-ampliada');
    ampliar.textContent = cheia ? 'Restaurar' : 'Maximizar';
    ampliar.setAttribute('aria-pressed', String(cheia));
  }
  titulo.addEventListener('dblclick', (e) => {
    if (!e.target.closest('button')) alternarTamanho();
  });
  const tela = h(
    'div',
    { class: 'garagem-tela', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Garagem' },
    h(
      'section',
      { class: 'panel garagem-painel' },
      titulo,
      h('p', { text: 'Escolha um veículo para pilotar perto de onde você está olhando.' }),
      opcoes,
      destino,
    ),
  );
  const abrir = () => {
    if (game.state !== 'PLAYING') return;
    if (game.dim !== 0) {
      ui.toast('A garagem fica na superfície.');
      return;
    }
    if (game.overlay) closeOverlay();
    openOverlay('garagem');
    destino.textContent = '';
    tela.hidden = false;
    opcoes.querySelector('button')?.focus();
  };
  const acesso = botao('Garagem', abrir);
  acesso.classList.add('garagem-acesso');
  ui.el.corner.insertBefore(acesso, ui.el.corner.querySelector('.btn-menu'));
  const nomeHUD = h('strong', {}),
    leitura = h('span', {}),
    especial = botao('Ação', acao),
    sai = botao('Sair', sair),
    embarca = botao('Embarcar', entrar);
  const teclas = { sobe: false, desce: false };
  const segurar = (rotulo, chave) => {
    const b = botao(rotulo, () => {});
    b.setAttribute('aria-label', rotulo);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      teclas[chave] = true;
    });
    for (const evento of ['pointerup', 'pointercancel', 'lostpointercapture'])
      b.addEventListener(evento, () => {
        teclas[chave] = false;
      });
    return b;
  };
  const cima = segurar('Subir', 'sobe'),
    baixo = segurar('Descer', 'desce');
  const hud = h(
    'div',
    { class: 'garagem-hud' },
    h('div', { class: 'garagem-medidas' }, nomeHUD, leitura),
    cima,
    baixo,
    especial,
    sai,
    embarca,
  );
  tela.hidden = hud.hidden = true;
  document.body.append(tela);
  ui.el.hud.append(hud);
  tela.addEventListener('click', (e) => {
    if (e.target === tela) closeOverlay();
  });
  game.hooks.other.push((m) => {
    if (m.t === 'overlay-closed' && m.was === 'garagem') tela.hidden = true;
  });
  return {
    abrir,
    teclas,
    erro(m) {
      destino.textContent = m;
      ui.toast(m);
    },
    atualizar(v, perto) {
      const ativo = game.state === 'PLAYING' && !game.overlay && game.dim === 0;
      const esconder = !ativo || (!v && !perto);
      if (hud.hidden !== esconder) hud.hidden = esconder;
      if (acesso.hidden !== (game.dim !== 0)) acesso.hidden = game.dim !== 0;
      if (hud.hidden) {
        teclas.sobe = teclas.desce = false;
        return;
      }
      const qual = v || perto,
        def = VEICULOS[qual.tipo];
      nomeHUD.textContent = def.nome;
      embarca.hidden = !!v;
      sai.hidden = especial.hidden = !v;
      cima.hidden = baixo.hidden = !(v && (v.tipo === 'balao' || v.tipo === 'helicoptero'));
      if (!v) {
        leitura.textContent = '';
        return;
      }
      leitura.textContent = Math.round(Math.max(Math.abs(v.v), Math.hypot(v.vx, v.vz)) * 3.6) + ' km/h';
      if (qual.tipo === 'submarino')
        leitura.textContent += ' · ' + Math.round(-v.prof) + ' m de profundidade';
      if (['balao', 'aviao', 'helicoptero'].includes(qual.tipo))
        leitura.textContent += ' · ' + Math.round(v.y - 49) + ' m acima do mar';
      especial.textContent =
        v.tipo === 'submarino' && v.mergulho
          ? 'Voltar à superfície'
          : v.tipo === 'balao' && v.passeio
            ? 'Encerrar passeio'
            : v.tipo === 'aviao' && v.fumaca
              ? 'Desligar fumaça'
              : def.acao;
    },
  };
}
