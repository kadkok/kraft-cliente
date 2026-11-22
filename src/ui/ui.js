// LAVRA — interface em DOM: menu, HUD, paleta, pausa e chat.
// Não conhece regras do jogo: recebe dados prontos e devolve eventos por `on`.

import { BLOCKS } from '../../shared/blocks.js';
import { FILTROS, filtrar, chaveDe, entradaDe } from '../../shared/catalogo-blocos.js';
import { MAX_CHAT, MAX_NAME } from '../../shared/constants.js';
import { TIME_RATES, dayLasts } from '../../shared/clock.js';

// criação de elementos sem innerHTML: texto de jogador nunca vira marcação
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null) e.append(kid);
  return e;
}

// Grupos dos blocos do jogo (BLOCKS[id].group): quem usa hoje é o menu do VR (game/menu-vr.js). O painel de blocos do
// PC e do toque usa o catálogo único de shared/catalogo-blocos.js (FILTROS), com os blocos do Minecraft junto.
export const GROUPS = [['minecraft', 'Minecraft'], ['todos', 'Tudo'], ['natureza', 'Natureza'], ['madeira', 'Madeira'], ['obra', 'Obra'], ['cor', 'Cores'], ['máquina', 'Máquinas'], ['planta', 'Plantas'], ['minério', 'Minérios']];

function svgIcon(path, box = '0 0 24 24') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', box);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ico');
  s.innerHTML = `<path fill="currentColor" d="${path}"/>`;
  return s;
}

const ICONS = {
  blocos: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Zm8 3.2 5.6-3.1L12 4.5 6.4 7.6 12 10.7Zm-6.5.2v5l5.7 3.2v-5l-5.7-3.2Zm13 0-5.7 3.2v5l5.7-3.2v-5Z',
  mapa: 'M15 4.2 9 2.3 3.4 4.5A1 1 0 0 0 2.8 5.4v14.8a1 1 0 0 0 1.4.9L9 19l6 1.9 5.6-2.2a1 1 0 0 0 .6-.9V3a1 1 0 0 0-1.4-.9L15 4.2Zm-1 1.6v12.8l-4-1.3V4.5l4 1.3Zm-9-.1 3-.9v12.6l-3 1.2V5.7Zm14 .1v11.6l-3 1.2V5.8l3-.9Z',
  chat: 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8.5L4 21.5V18a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 5v2h12V9H6Zm0 4v2h8v-2H6Z',
  menu: 'M3 6h18v2.2H3V6Zm0 5h18v2.2H3V11Zm0 5h18v2.2H3V16Z',
};

export function createUI({ root, icons, device, settings, on }) {
  let iconsRef = icons;
  let mcRef = null;
  const $ = {};

  // ---- HUD ------------------------------------------------------------------
  $.hotbar = h('div', { class: 'hotbar', role: 'toolbar', 'aria-label': 'Barra de atalhos' });
  $.invBtn = device.touch ? h('button', {
    class: 'slot inv-slot', type: 'button', title: 'Blocos e Mochila', 'aria-label': 'Blocos e Mochila',
    onclick: () => on.palette(),
  }, h('span', { class: 'dots', text: '···' })) : null;
  if ($.invBtn) {
    $.invBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    $.hotbar.append($.invBtn);
  }
  $.hint = h('div', { class: 'hint' });
  $.chatlog = h('div', { class: 'chatlog', 'aria-live': 'polite' });
  $.chatInput = h('input', { type: 'text', maxlength: MAX_CHAT, placeholder: 'Mensagem (Enter envia, Esc cancela)', autocomplete: 'off', 'aria-label': 'Mensagem do chat' });
  $.chatbox = h('form', { class: 'chatbox hide' }, $.chatInput);
  $.toasts = h('div', { class: 'toasts' });
  $.debug = h('div', { class: 'debug hide' });
  $.underwater = h('div', { class: 'underwater' });
  $.cross = h('div', { class: 'cross' });
  $.who = h('div', { class: 'who panel hide' });
  $.trunk = h('button', { class: 'btn small hide', type: 'button', text: 'Tronco: Redondo', onclick: () => on.trunkMode?.() });
  $.trunk.addEventListener('pointerdown', (e) => e.stopPropagation());
  const cbtn = (cls, ico, label, title, fn) => {
    const b = h('button', { class: 'btn small ' + cls, type: 'button', title: title || label, 'aria-label': title || label, onclick: fn },
      svgIcon(ICONS[ico]), h('span', { class: 'lbl', text: label }));
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return b;
  };
  $.corner = h('div', { class: 'corner' },
    $.trunk,
    cbtn('btn-blocos btn-icon-mob', 'blocos', 'Blocos', 'Blocos e Mochila', () => on.palette()),
    cbtn('btn-mapa btn-icon-mob', 'mapa', 'Mapa', 'Mapa do mundo (tecla M)', () => on.map?.()),
    cbtn('btn-chat btn-icon-mob', 'chat', 'Chat', 'Chat (tecla T)', () => on.chatOpen('')),
    cbtn('btn-menu btn-icon-mob', 'menu', 'Menu', 'Pausa e opções (Esc)', () => on.pause()));
  $.touch = h('div', { class: 'touch' });
  $.hud = h('div', { id: 'hud', class: 'hide' + (device.touch ? ' toque' : '') }, $.underwater, h('div', { class: 'vignette' }), $.touch, $.cross, $.hint, $.chatlog, $.chatbox, $.hotbar, $.toasts, $.debug, $.corner, $.who);
  const syncHudClass = () => {
    const cel = !!device.touch && (innerWidth <= 540 || (innerWidth <= 960 && innerHeight <= 500));
    $.hud.classList.toggle('celular', cel);
  };
  syncHudClass();
  addEventListener('resize', syncHudClass);

  $.chatbox.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $.chatInput.value.trim();
    $.chatInput.value = '';
    on.chatSend(v);
  });
  $.chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Escape') { $.chatInput.value = ''; on.chatSend(''); }
  });
  $.chatInput.addEventListener('keyup', (e) => e.stopPropagation());

  // ---- menu inicial ---------------------------------------------------------------
  $.name = h('input', { type: 'text', maxlength: MAX_NAME, placeholder: 'Como te chamam?', autocomplete: 'nickname', 'aria-label': 'Seu nome' });
  $.world = h('input', { type: 'text', maxlength: 32, placeholder: 'principal', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Nome do mundo' });
  $.partida = h('select', { 'aria-label': 'Tipo de partida' },
    h('option', { value: 'solo', text: 'Jogar sozinho neste aparelho' }),
    h('option', { value: 'multiplayer', text: 'Multiplayer online' }));
  $.play = h('button', { class: 'btn primary', type: 'submit', text: 'Jogar' });
  $.vr = h('button', { class: 'btn teal hide', type: 'button', text: 'Entrar em VR', onclick: () => on.vr() });
  $.status = h('div', { class: 'status' });
  $.loadbar = h('i');
  const keys = device.touch
    ? [['Polegar esquerdo', 'andar'], ['Arrastar à direita', 'olhar'], ['Toque / segurar', 'colocar / quebrar'], ['Pular 2×', 'voar'], ['Blocos', 'escolher o que colocar'], ['Mapa', 'ver mundo, povoados e obras'], ['Bússola', 'no topo (ajuste na pausa)']]
    : [['W A S D', 'andar'], ['Mouse', 'olhar'], ['Clique esq. / dir.', 'quebrar / colocar'], ['Espaço', 'pular (2× = voar)'], ['W 2× ou R', 'correr'], ['Shift', 'agachar'],
      ['1–9 · roda', 'barra de atalhos'], ['E', 'todos os blocos'], ['T', 'chat'], ['F', 'usar (assento, canhão…)'],
      ['O · J · U', 'abrir/fechar obra · trocar todos · desagrupar'], ['Q · I', 'pegar e levar peça (formas da tecla E) · ímã'], ['M', 'mapa'], ['N', 'bússola: onde estão os outros (/onde)'], ['Esc', 'menu']];
  $.help = h('div', { class: 'help panel' }, h('h3', { text: 'Como jogar' }),
    h('dl', null, keys.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])));
  $.menu = h('div', { id: 'menu', class: 'screen' },
    h('form', { class: 'card panel', onsubmit: (e) => { e.preventDefault(); on.play(); } },
      h('h1', { class: 'logo', text: 'KRAFT' }),
      h('p', { class: 'tag', text: 'Um mundo de blocos com luz de verdade. Leve, no navegador, com quem você quiser.' }),
      h('label', { class: 'field' }, h('span', { text: 'Seu nome' }), $.name),
      h('label', { class: 'field' }, h('span', { text: 'Partida' }), $.partida),
      h('label', { class: 'field' }, h('span', { text: 'Mundo' }), $.world),
      h('div', { class: 'row' }, $.play, $.vr),
      h('div', { class: 'bar' }, $.loadbar),
      $.status),
    $.help);
  let worldTimer = 0;
  $.partida.addEventListener('change', () => { clearTimeout(worldTimer); on.partidaChanged(); });
  $.world.addEventListener('input', () => { clearTimeout(worldTimer); worldTimer = setTimeout(() => on.worldChanged($.world.value), 700); });
  for (const inp of [$.name, $.world, $.partida]) { inp.addEventListener('keydown', (e) => e.stopPropagation()); inp.addEventListener('keyup', (e) => e.stopPropagation()); }

  // ---- pausa / configurações ------------------------------------------------------
  const slider = (key, label, min, max, step, fmt) => {
    const out = h('output', { text: fmt(settings[key]) });
    const inp = h('input', { type: 'range', min, max, step, value: settings[key], 'aria-label': label });
    inp.addEventListener('input', () => { const v = Number(inp.value); out.textContent = fmt(v); on.setting(key, v); });
    return h('div', { class: 'set' }, h('span', { text: label }), out, inp);
  };
  const toggle = (key, label, value) => {
    const inp = h('input', { type: 'checkbox' });
    inp.checked = value;
    inp.addEventListener('change', () => on.setting(key, inp.checked));
    return h('label', { class: 'toggle' }, h('span', { text: label }), inp);
  };
  // Duração do dia: não é ajuste do aparelho, é uma lei do mundo. Quem mexe muda para todos que estão nele.
  const rateText = (r) => (r <= 0 ? 'tempo parado' : r === 1 ? '24 h, como no mundo real' : dayLasts(r));
  const rateOut = h('output', { text: rateText(1) });
  const rateInp = h('input', { type: 'range', min: 0, max: TIME_RATES.length - 1, step: 1, value: 1, 'aria-label': 'Duração do dia' });
  rateInp.addEventListener('input', () => { rateOut.textContent = rateText(TIME_RATES[Number(rateInp.value)]); });
  rateInp.addEventListener('change', () => on.timeRate(TIME_RATES[Number(rateInp.value)]));
  $.timeRate = h('div', { class: 'set' }, h('span', { text: 'Duração do dia' }), rateOut, rateInp);
  $.vr2 = h('button', { class: 'btn teal hide', type: 'button', text: 'Entrar em VR', onclick: () => on.vr() });
  $.pauseCard = h('div', { class: 'card panel' },
    h('h2', { text: 'Pausa' }),
    h('button', { class: 'btn primary', type: 'button', text: 'Continuar', onclick: () => on.resume() }),
    slider('distance', 'Distância de visão', 3, 16, 1, (v) => `${v} chunks`),
    slider('fov', 'Campo de visão', 55, 100, 1, (v) => `${v}°`),
    slider('sensitivity', 'Sensibilidade', 0.3, 2.5, 0.05, (v) => v.toFixed(2) + '×'),
    slider('volume', 'Volume', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'),
    slider('music', 'Música', 0, 1, 0.05, (v) => (v > 0 ? Math.round(v * 100) + '%' : 'desligada')),
    $.timeRate,
    toggle('invertY', 'Inverter o eixo vertical', settings.invertY),
    toggle('autoJump', 'Pulo automático em degraus', !!settings.autoJump),
    // no celular, no iPad e no visor o realismo é só a pele (chão e casca de foto): main.js → quality.real.leve
    toggle('real', device.mobile ? 'Realismo: chão e casca de foto' : 'Realismo: relva, sombra fina e foco', settings.real !== false),
    $.compassToggle = (() => {
      const inp = h('input', { type: 'checkbox', checked: true });
      inp.addEventListener('change', () => on.compass?.(inp.checked));
      return h('label', { class: 'toggle' }, h('span', { text: 'Mostrar bússola' }), inp);
    })(),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'Copiar convite', onclick: () => on.invite() }),
      $.vr2,
      h('button', { class: 'btn', type: 'button', text: 'Sair para o menu', onclick: () => on.leave() })));
  $.pause = h('div', { id: 'pause', class: 'screen veil hide' }, $.pauseCard);

  // ---- painel de blocos (tecla E) --------------------------------------------------------------
  // Refeito em 22/11/2026 (pedido do Kadmus: "está ruim demais, principalmente no modo criativo"): antes os blocos
  // ficavam abaixo de 845 px de mochila, bancada e formas, um bloco por abertura, com dois catálogos separados.
  // Três páginas: BLOCOS (o catálogo inteiro de shared/catalogo-blocos.js, com busca, categorias, favoritos, recentes
  // e a barra dos 9 espaços dentro do painel), FORMAS E PEÇAS e MOCHILA — as duas últimas são o que os outros módulos
  // penduram em paletteExtra() (game/items.js, game/crafting.js, objects/editor.js, objects/mao.js, game/groups.js),
  // separadas só por CSS. Fora do criativo vale a classe so-mochila (game/modes.js): só a mochila aparece.
  // Clique num bloco: vai para o espaço marcado da barra, o painel FICA ABERTO e a marca passa ao espaço seguinte
  // (como no Minecraft de celular); ao fechar, a mão fica com o último bloco escolhido. Teclas 1–9 com o ponteiro num
  // bloco mandam para aquele espaço; botão direito (ou segurar o dedo) marca favorito; E ou Esc fecham.
  const PAGINAS = [['blocos', 'Blocos'], ['ferramentas', 'Formas e peças'], ['mochila', 'Mochila']];
  const MAX_RECENTES = 27, ICONE = 72;
  const guardado = (k) => { try { const v = JSON.parse(localStorage.getItem('lavra.paleta.' + k)); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; } };
  const guardar = (k, v) => { try { localStorage.setItem('lavra.paleta.' + k, JSON.stringify(v)); } catch { /* cheio ou bloqueado */ } };
  let favoritos = guardado('fav'), recentes = guardado('rec');
  let filtro = 'tudo', texto = '', pagina = 'blocos';
  let barra = [], barraSel = 0, ultimoPosto = -1, apontado = null, atual = 0, marcaMostrada = '', total = 0;
  const celulas = new Map();                 // chave do catálogo → { e, el, ok }
  $.grid = h('div', { class: 'grid', role: 'listbox', 'aria-label': 'Blocos' });
  $.tabs = h('div', { class: 'tabs pal-cats', role: 'tablist', 'aria-label': 'Categorias' });
  $.busca = h('input', { type: 'search', class: 'pal-busca busca-mc', placeholder: 'Buscar bloco: pedra, carvalho, vidro, escada, door…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Buscar bloco' });
  $.palInfo = h('div', { class: 'pal-info', 'aria-live': 'polite' });
  $.palBarra = h('div', { class: 'pal-barra', role: 'toolbar', 'aria-label': 'Barra de atalhos: onde o bloco escolhido vai' });
  $.paletteExtra = h('div', { class: 'row palette-extra' });
  $.palTitulo = h('h2', { text: 'Blocos' });
  $.palFechar = h('button', { class: 'btn small pal-fechar', type: 'button', text: 'Fechar', title: 'Fechar (E ou Esc)', 'aria-label': 'Fechar', onclick: () => on.paletteClose() });
  $.palPaginas = h('div', { class: 'pal-paginas pal-so-criativo', role: 'tablist', 'aria-label': 'Páginas do painel' },
    PAGINAS.map(([k, rotulo]) => h('button', { class: 'btn small', type: 'button', text: rotulo, 'data-pagina': k, onclick: () => irPagina(k) })));
  $.palNota = h('p', { class: 'note' });
  // (o primeiro .btn dentro do painel é o Fechar: as sondas tools/qa-itens.mjs e qa-modos.mjs fecham por ele)
  $.palette = h('div', { id: 'palette', class: 'screen veil hide', 'data-pagina': 'blocos' },
    h('div', { class: 'card panel' },
      h('div', { class: 'pal-topo' }, $.palTitulo, $.palFechar, $.palPaginas),
      h('div', { class: 'pal-blocos pal-so-criativo' }, h('div', { class: 'pal-linha' }, $.busca, $.tabs), $.grid),
      $.paletteExtra,
      h('div', { class: 'pal-rodape pal-so-criativo' }, $.palInfo, $.palBarra),
      $.palNota));
  $.palette.addEventListener('pointerdown', (e) => { if (e.target === $.palette) on.paletteClose(); });
  const painelAberto = () => !$.palette.classList.contains('hide');
  const soMochila = () => $.palette.classList.contains('so-mochila');

  // ícone de uma entrada do catálogo (canvas do cache dos ícones; null enquanto a fonte não chegou)
  const iconeDe = (v, n) => (v >= 256 ? (mcRef ? mcRef.icone(v, n) : null) : (iconsRef && BLOCKS[v] ? iconsRef.icon(v, n) : null));
  const nomeDe = (v) => (!v ? 'vazio' : v >= 256 ? (entradaDe(v)?.nome || (mcRef ? mcRef.nome(v) : 'bloco do Minecraft')) : (BLOCKS[v] ? BLOCKS[v].name : 'vazio'));
  function desenha(c) {
    if (c.ok) return;
    const cv = iconeDe(c.e.v, ICONE);
    if (!cv) return;
    // o canvas do cache entra direto na célula (tamanho ICONE é só deste painel): 971 blocos sem cópia de imagem
    const velho = c.el.firstChild;
    if (velho !== cv) c.el.replaceChild(cv, velho);
    c.ok = true;
  }
  // só desenha o ícone de quem chega perto da área visível da grade
  const olheiro = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((es) => { for (const x of es) if (x.isIntersecting) { const c = celulas.get(x.target._chave); if (c) desenha(c); } }, { root: $.grid, rootMargin: '240px 0px' })
    : null;
  function celulaDe(e) {
    let c = celulas.get(e.chave);
    if (!c) {
      const el = h('button', { class: 'cell' + (e.mc ? ' mc' : ''), type: 'button', title: e.nome, 'aria-label': e.nome, role: 'option' },
        h('canvas', { width: ICONE, height: ICONE }), h('span', { class: 'nome', text: e.nome }));
      el._chave = e.chave;
      c = { e, el, ok: false };
      celulas.set(e.chave, c);
      if (olheiro) olheiro.observe(el); else desenha(c);
    }
    return c;
  }
  // quando a fonte dos ícones chega ou muda, o olheiro não avisa de novo quem já estava à vista: desenha à mão
  function desenhaVisiveis() {
    if (!painelAberto()) return;
    const g = $.grid.getBoundingClientRect();
    for (const el of $.grid.children) { const c = celulas.get(el._chave); if (!c || c.ok) continue; const r = el.getBoundingClientRect(); if (r.bottom > g.top - 240 && r.top < g.bottom + 240) desenha(c); }
  }
  const entradaDoAlvo = (alvo) => { const el = alvo && alvo.closest ? alvo.closest('.cell') : null; return el && celulas.get(el._chave) ? celulas.get(el._chave).e : null; };

  function marcas() {
    const chaveAtual = chaveDe(barra[barraSel] ?? atual), fav = new Set(favoritos);
    for (const c of celulas.values()) { c.el.classList.toggle('on', c.e.chave === chaveAtual); c.el.classList.toggle('fav', fav.has(c.e.chave)); }
  }
  function renderAbas() {
    $.tabs.replaceChildren(...FILTROS.map(([k, rotulo]) => h('button', {
      class: 'btn small' + (k === filtro && !texto ? ' on' : ''), type: 'button', text: rotulo, role: 'tab', 'aria-selected': k === filtro && !texto ? 'true' : 'false',
      onclick: () => { filtro = k; texto = ''; $.busca.value = ''; renderAbas(); renderGrade(); },
    })));
  }
  function renderGrade() {
    const lista = filtrar({ filtro, texto, favoritos, recentes, comMc: !!mcRef });
    total = lista.length;
    $.grid.replaceChildren(...lista.map((e) => celulaDe(e).el));
    if (!lista.length) {
      $.grid.append(h('p', { class: 'note pal-vazio', text: texto ? `Nada com “${texto}”. Tente outro nome (vale em inglês também).`
        : filtro === 'favoritos' ? 'Nenhum favorito ainda. Botão direito (ou segurar o dedo) num bloco marca com ★.'
          : filtro === 'recentes' ? 'Os últimos blocos que você escolher aparecem aqui.' : 'Nada por aqui ainda.' }));
    }
    $.grid.scrollTop = 0;
    marcas();
    info(null);
  }
  function renderBarra() {
    for (let i = 0; i < 9; i++) {
      let sl = $.palBarra.children[i];
      if (!sl) {
        sl = h('button', { class: 'slot', type: 'button', onclick: () => { ultimoPosto = -1; on.hotbar(i); } }, h('i', { text: String(i + 1) }), h('canvas', { width: 64, height: 64 }));
        $.palBarra.append(sl);
      }
      sl.classList.toggle('on', i === barraSel);
      if (sl._item !== barra[i]) {
        const cv = barra[i] ? iconeDe(barra[i], 64) : null, ctx = sl.lastChild.getContext('2d');
        ctx.clearRect(0, 0, 64, 64);
        if (barra[i] && !cv) continue;                       // o ícone ainda não chegou: tenta de novo na próxima
        if (cv) ctx.drawImage(cv, 0, 0);
        sl._item = barra[i];
        sl.title = `Espaço ${i + 1}: ${nomeDe(barra[i])}`;
        sl.setAttribute('aria-label', sl.title);
      }
    }
  }
  function info(e) {
    apontado = e;
    if (e) $.palInfo.replaceChildren(h('b', { text: e.nome }), ` · ${FILTROS.find(([k]) => k === e.cat)?.[1] || ''}${e.mc ? ' · Minecraft' : ''}${favoritos.includes(e.chave) ? ' · ★' : ''}`);
    else $.palInfo.replaceChildren(h('b', { text: `${total} ${total === 1 ? 'bloco' : 'blocos'}` }), ` · vai para o espaço ${barraSel + 1} da barra (clique num espaço para mudar).`);
  }
  function lembrar(k) { if (!k) return; recentes = [k, ...recentes.filter((x) => x !== k)].slice(0, MAX_RECENTES); guardar('rec', recentes); }
  function escolher(e, espaco) {
    const direto = Number.isInteger(espaco), i = direto ? espaco : barraSel, saiu = barra[i];
    on.pickBlock(e.v, i, true);                 // main.js: põe no espaço i sem fechar o painel
    if (saiu && chaveDe(saiu) !== e.chave) lembrar(chaveDe(saiu));    // o que saiu da barra fica à mão nos recentes
    lembrar(e.chave);
    if (!painelAberto()) return;                // um main.js antigo fecha ao escolher: não mexe na marca
    if (!direto) { ultimoPosto = i; on.hotbar((i + 1) % 9); }
    if (filtro === 'recentes' && !texto) renderGrade();
  }
  function favoritar(e) {
    const tinha = favoritos.includes(e.chave);
    favoritos = tinha ? favoritos.filter((k) => k !== e.chave) : [...favoritos, e.chave];
    guardar('fav', favoritos);
    if (filtro === 'favoritos' && !texto) renderGrade(); else marcas();
    info(e);
    api.toast(tinha ? `${e.nome} saiu dos favoritos.` : `★ ${e.nome} nos favoritos.`, 1800);
  }
  function irPagina(k) {
    pagina = PAGINAS.some(([p]) => p === k) ? k : 'blocos';
    $.palette.dataset.pagina = pagina;
    for (const b of $.palPaginas.children) { const sim = b.dataset.pagina === pagina; b.classList.toggle('on', sim); b.setAttribute('aria-selected', sim ? 'true' : 'false'); }
    $.palNota.textContent = pagina !== 'blocos' ? ''
      : device.touch ? 'Toque: põe no espaço marcado e passa ao seguinte · segure o dedo: favorito ★ · toque num espaço da barra para escolher onde vai.'
        : 'Clique: põe no espaço marcado e passa ao seguinte · 1–9 com o ponteiro no bloco: manda para aquele espaço · botão direito: favorito ★ · / busca · E fecha.';
  }
  // cliques, favorito e nome na faixa de baixo (um ouvinte para a grade inteira)
  let toqueLongo = 0, engoleClique = false, toqueX = 0, toqueY = 0;
  $.grid.addEventListener('click', (ev) => { const e = entradaDoAlvo(ev.target); if (engoleClique) { engoleClique = false; return; } if (e) escolher(e); });
  $.grid.addEventListener('contextmenu', (ev) => {
    const e = entradaDoAlvo(ev.target); if (!e) return;
    ev.preventDefault();
    if (engoleClique) return;                                   // o toque longo já marcou
    clearTimeout(toqueLongo); favoritar(e);
    if (ev.pointerType && ev.pointerType !== 'mouse') engoleClique = true;
  });
  $.grid.addEventListener('pointerover', (ev) => { const e = entradaDoAlvo(ev.target); if (e !== apontado) info(e); });
  $.grid.addEventListener('pointerleave', () => info(null));
  $.grid.addEventListener('pointerdown', (ev) => {
    engoleClique = false; clearTimeout(toqueLongo); toqueX = ev.clientX; toqueY = ev.clientY;
    const e = ev.pointerType === 'mouse' ? null : entradaDoAlvo(ev.target);
    if (e) toqueLongo = setTimeout(() => { engoleClique = true; favoritar(e); }, 520);
  });
  $.grid.addEventListener('pointermove', (ev) => { if (Math.abs(ev.clientX - toqueX) + Math.abs(ev.clientY - toqueY) > 10) clearTimeout(toqueLongo); }, { passive: true });
  for (const tipo of ['pointerup', 'pointercancel', 'scroll']) $.grid.addEventListener(tipo, () => clearTimeout(toqueLongo), { passive: true });
  $.busca.addEventListener('input', () => { texto = $.busca.value; renderAbas(); renderGrade(); });
  // teclado com o painel aberto (na captura: o jogo não vê estas teclas, senão o E reabriria o painel no mesmo instante)
  addEventListener('keydown', (ev) => {
    if (!painelAberto()) return;
    const alvo = ev.target, digitando = alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT');
    if (ev.code === 'Escape') {                                  // com texto na busca, o primeiro Esc só limpa
      if (alvo === $.busca && $.busca.value) { ev.preventDefault(); ev.stopPropagation(); $.busca.value = ''; texto = ''; renderAbas(); renderGrade(); }
      return;
    }
    if (digitando) {
      if (alvo === $.busca && ev.code === 'Enter') { const e = entradaDoAlvo($.grid.querySelector('.cell')); if (e) escolher(e); ev.preventDefault(); }
      ev.stopPropagation();                                      // digitar não anda, não fecha e não troca de espaço
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.code === 'KeyE') { ev.preventDefault(); ev.stopPropagation(); on.paletteClose(); return; }
    if (soMochila() || pagina !== 'blocos') return;
    if (ev.code === 'Slash' || ev.code === 'Tab') { ev.preventDefault(); ev.stopPropagation(); $.busca.focus(); $.busca.select(); return; }
    const d = /^(?:Digit|Numpad)([1-9])$/.exec(ev.code);
    if (d) { ev.preventDefault(); ev.stopPropagation(); const i = Number(d[1]) - 1; if (apontado) escolher(apontado, i); else { ultimoPosto = -1; on.hotbar(i); } }
  }, true);
  function abrirPainel(valorNaMao) {
    atual = valorNaMao || 0; ultimoPosto = -1; texto = ''; $.busca.value = '';
    marcaMostrada = '';
    irPagina(pagina);
    renderAbas(); renderGrade(); renderBarra();
  }
  // ao fechar (por E, Esc, Fechar ou clique fora): a mão fica com o último bloco escolhido nesta abertura
  function aoFecharPainel() {
    clearTimeout(toqueLongo);
    if ($.busca === document.activeElement) $.busca.blur();
    if (ultimoPosto >= 0 && !soMochila()) { const i = ultimoPosto; ultimoPosto = -1; if (i !== barraSel) on.hotbar(i); }
  }

  root.append($.hud, $.menu, $.pause, $.palette);

  // ---- API ---------------------------------------------------------------------------
  const chatLines = [];
  const ouvintes = [];   // quem precisa ver avisos e chat fora do HTML (o letreiro do VR, game/menu-vr.js)
  const contar = (tipo, a) => { for (const f of ouvintes) { try { f(tipo, a); } catch (e) { console.error(e); } } };
  const api = {
    el: $,
    on,                  // os mesmos eventos dos botões desta interface (o menu do VR chama por aqui)
    ouvir(fn) { ouvintes.push(fn); },
    setIcons(i) { iconsRef = i; for (const c of celulas.values()) if (!c.e.mc) c.ok = false; desenhaVisiveis(); },
    // ícones dos blocos do Minecraft: chegam depois (pacote de texturas); até lá o painel mostra só os do jogo
    setMcPaleta(p) {
      mcRef = p;
      for (const s of $.hotbar.children) s._item = undefined;
      for (const s of $.palBarra.children) s._item = undefined;
      for (const c of celulas.values()) if (c.e.mc) c.ok = false;
      if (painelAberto()) { renderGrade(); renderBarra(); desenhaVisiveis(); }
    },
    screen(name) { // 'menu' | 'pause' | 'palette' | null
      if (name !== 'palette' && painelAberto()) aoFecharPainel();
      $.menu.classList.toggle('hide', name !== 'menu');
      $.pause.classList.toggle('hide', name !== 'pause');
      $.palette.classList.toggle('hide', name !== 'palette');
      $.who.classList.toggle('hide', name !== 'pause');
    },
    hud(show) { $.hud.classList.toggle('hide', !show); },
    menuValues() { return { name: $.name.value, world: $.world.value, partida: $.partida.value }; },
    setPartida(partida) { $.partida.value = partida; },
    setMenu(name, world) { $.name.value = name || ''; $.world.value = world || ''; },
    setStatus(text, strong) {
      $.status.replaceChildren(...(strong ? [h('b', { text: strong }), ' ' + text] : [text]));
    },
    setLoading(f) { $.loadbar.style.width = Math.round(f * 100) + '%'; },
    setPlayLabel(t, disabled) { $.play.textContent = t; $.play.disabled = !!disabled; },
    showVR(show) { $.vr.classList.toggle('hide', !show); $.vr2.classList.toggle('hide', !show); },
    setHotbar(items, sel) {
      barra = items; barraSel = sel;
      if (painelAberto() && !soMochila()) {
        renderBarra();
        const marca = sel + ':' + items[sel];
        if (marca !== marcaMostrada) { marcaMostrada = marca; marcas(); if (!apontado) info(null); }
      }
      const kids = $.hotbar.querySelectorAll('.slot:not(.inv-slot)');
      for (let i = 0; i < items.length; i++) {
        let s = kids[i];
        if (!s) {
          s = h('button', { class: 'slot', type: 'button', onclick: () => on.hotbar(i) }, h('i', { text: String(i + 1) }), h('canvas', { width: 64, height: 64 }));
          s.addEventListener('pointerdown', (e) => e.stopPropagation());
          $.hotbar.insertBefore(s, $.invBtn || null);
        }
        s.classList.toggle('on', i === sel);
        if (s._item !== items[i] && iconsRef) {
          s._item = items[i];
          const ctx = s.lastChild.getContext('2d');
          ctx.clearRect(0, 0, 64, 64);
          const mc = items[i] >= 256;
          if (mc && !mcRef) { s._item = undefined; continue; }
          if (items[i]) ctx.drawImage(mc ? mcRef.icone(items[i], 64) : iconsRef.icon(items[i], 64), 0, 0);
          s.title = items[i] ? (mc ? mcRef.nome(items[i]) : BLOCKS[items[i]].name) : 'vazio';
          s.setAttribute('aria-label', s.title);
        }
      }
    },
    setHint(text) { if ($.hint.textContent !== text) $.hint.textContent = text; },
    setTrunkMode(square, show) {
      const label = square ? 'Tronco: Quadrado' : 'Tronco: Redondo';
      if ($.trunk.textContent !== label) $.trunk.textContent = label;
      $.trunk.classList.toggle('hide', !show);
    },
    palette(current) { abrirPainel(current); },
    paletteExtra() { return $.paletteExtra; },
    chatAdd(name, color, text, sys) {
      const p = h('p', { class: sys ? 'sys' : '' });
      if (name) p.append(h('b', { text: name + ': ', style: `color:${/^#[0-9a-f]{6}$/i.test(color) ? color : '#fff'}` }));
      p.append(text);
      $.chatlog.append(p);
      chatLines.push(p);
      if (chatLines.length > 40) chatLines.shift().remove();
      setTimeout(() => p.classList.add('old'), 9000);
      contar('chat', { nome: name, cor: color, texto: text, sys: !!sys });
    },
    chatOpen(prefix) {
      $.chatbox.classList.remove('hide');
      $.chatlog.classList.add('open');
      $.chatInput.value = prefix || '';
      $.chatInput.focus();
    },
    chatClose() { $.chatbox.classList.add('hide'); $.chatlog.classList.remove('open'); $.chatInput.blur(); },
    get chatIsOpen() { return !$.chatbox.classList.contains('hide'); },
    toast(text, ms = 3200) {
      const t = h('div', { class: 'toast', text });
      $.toasts.append(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 450); }, ms);
      contar('toast', { texto: text, ms });
    },
    setDebug(text) { $.debug.classList.toggle('hide', !text); if (text) $.debug.textContent = text; },
    setUnderwater(on2) { $.underwater.classList.toggle('on', on2); },
    // o relógio do mundo mudou de ritmo (aqui ou por outra pessoa): acerta o controle
    setTimeRate(rate) {
      let best = 0;
      for (let i = 1; i < TIME_RATES.length; i++) if (Math.abs(TIME_RATES[i] - rate) < Math.abs(TIME_RATES[best] - rate)) best = i;
      rateInp.value = best;
      rateOut.textContent = rateText(rate);
    },
    setCross(show) { $.cross.classList.toggle('hide', !show); },
    setCompass(v) { const inp = $.compassToggle?.querySelector('input'); if (inp) inp.checked = !!v; },
    setPlayers(list) {
      $.who.replaceChildren(h('h4', { text: `Neste mundo (${list.length})` }),
        ...list.map((p) => h('div', null, h('span', { style: `background:linear-gradient(135deg, ${p.color}, #fff)` }), p.name)));
    },
  };
  return api;
}
