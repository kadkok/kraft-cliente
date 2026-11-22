// Kraft — cliente instalável: o lado da página.
//
// Três coisas, todas do aparelho de quem joga:
//  1. Liga o service worker (public/sw.js), que guarda os arquivos do jogo no aparelho e entrega dali. Conta à rede
//     (net.setBootBuild) com que versão a página abriu e, antes de uma recarga pedida pelo servidor, manda o aparelho
//     buscar a versão nova (net.beforeReload).
//  2. Instalar: botão no menu e na pausa quando o navegador oferece (Chrome/Edge no PC e no Android); no iPad e no
//     iPhone, o caminho pelo Safari, que não tem botão.
//  3. Seção "Este aparelho" da pausa: os ajustes da tabela AJUSTES (config.js), o que já está guardado de cada pacote,
//     baixar o que falta, atualizar agora, apagar o que foi guardado.
//
// Para quem desenha e para o menu do VR — `game.cliente`:
//   ligado        o service worker cuida desta página (false: página comum, http sem cadeado, `?sw=0`, automação)
//   instalado     aberto como aplicativo instalado
//   podeInstalar  o navegador ofereceu a instalação; instalar() abre a pergunta dele
//   versao        versão dos arquivos com que a página abriu (null fora do cliente)
//   estado()      → { versao, bytes, tem, pacotes: [{ id, nome, bytes, n, tem, nTem, reserva }] }   (tem = já no aparelho;
//                 pacote de reserva não entra nos totais nem no "baixar o que falta")
//   baixar(ids?, aviso?)  baixa o que falta (todos os pacotes sem ids); aviso({ feito, total, n, de, falhas })
//   parar()       interrompe o download
//   atualizar()   busca a versão nova e recarrega
//   on(fn)        avisa quando algo acima muda
// O service worker só existe em endereço seguro (https ou localhost). Automação (navigator.webdriver) fica de fora, a
// não ser com `?sw=1`; `?sw=0` desliga neste aparelho e apaga o que ele guardou.

import { h } from '../ui/ui.js';
import { AJUSTES } from '../config.js';

const MB = (b) => (b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: b < 10485760 ? 1 : 0 }) + ' MB';

export function initCliente({ game, net, ui, device, settings, params }) {
  const portatil = !!document.querySelector('meta[name="kraft-portatil"]');
  const temSW = !portatil && 'serviceWorker' in navigator && window.isSecureContext;
  const querSW = params.get('sw') !== '0' && (!navigator.webdriver || params.get('sw') === '1');
  const modo = (q) => typeof matchMedia === 'function' && matchMedia(`(display-mode: ${q})`).matches;
  const ouvintes = [];
  const avisar = () => { for (const f of ouvintes) { try { f(api); } catch (e) { console.error(e); } } };
  let oferta = null;       // o evento do navegador que abre a pergunta de instalar
  let ultimoProgresso = '';
  let baixando = null;     // { parar }

  const api = {
    ligado: false,
    // lido na partida: depois, a tela cheia do próprio jogo também responde a "display-mode: fullscreen"
    instalado: portatil || modo('standalone') || modo('fullscreen') || modo('minimal-ui') || navigator.standalone === true,
    podeInstalar: false,
    versao: null,
    on(fn) { ouvintes.push(fn); },
    async instalar() {
      if (!oferta) return false;
      const ev = oferta;
      oferta = null; api.podeInstalar = false;
      ev.prompt();
      const r = await ev.userChoice.catch(() => null);
      avisar();
      return !!r && r.outcome === 'accepted';
    },
    estado(faltam) { return pedir({ t: 'estado', faltam }); },
    async baixar(ids, aviso) {
      if (!api.ligado || baixando) return null;
      let parar = false;
      baixando = { parar() { parar = true; } };
      const st = await pedir({ t: 'estado', faltam: ids && ids.length ? ids : true });
      if (!st || !st.faltam) { baixando = null; avisar(); return null; }
      const fila = st.faltam.slice();
      const p = { feito: 0, total: fila.reduce((a, f) => a + f[1], 0), n: 0, de: fila.length, falhas: 0, parado: false };
      p.parado = parar; baixando = { parar() { p.parado = true; } };
      avisar();
      // os pedidos passam pelo service worker, que guarda cada resposta; aqui só se lê até o fim
      const um = async () => {
        while (fila.length && !p.parado) {
          const [caminho, bytes] = fila.shift();
          const ok = await pedir({ t: 'arquivo', p: caminho, versao: st.versao }, 120000);
          if (!ok) p.falhas++;
          p.n++; if (ok) p.feito += bytes;
          if (aviso) aviso(p);
        }
      };
      await Promise.all([um(), um(), um()]);
      if (!ids?.length && !p.parado && !p.falhas) {
        p.completo = await pedir({ t: 'concluir', versao: st.versao });
        if (!p.completo) p.falhas++;
      }
      baixando = null;
      avisar();
      return p;
    },
    get baixando() { return !!baixando; },
    parar() { if (baixando) baixando.parar(); },
    async atualizar() {
      if (baixando) return;
      ui.toast('Verificando a atualização do cliente…');
      if (api.ligado) {
        const r = await pedir({ t: 'atualizar', ms: 15000 }, 300000);
        if (!r || r.versao === api.versao) { ui.toast('O aparelho continua com a versão instalada.'); return; }
      }
      game.recarregar();
    },
    async esquecer() { const ok = await pedir({ t: 'esquecer' }); avisar(); return !!ok; },
  };
  game.cliente = api;

  function pedir(msg, ms = 12000) {
    return new Promise((resolve) => {
      const sw = temSW && navigator.serviceWorker.controller;
      if (!sw) return resolve(null);
      const canal = new MessageChannel();
      const t = setTimeout(() => resolve(null), ms);
      canal.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
      try { sw.postMessage(msg, [canal.port2]); } catch { clearTimeout(t); resolve(null); }
    });
  }

  // ---- service worker ------------------------------------------------------------------------
  // volta a ser página comum: tira o service worker e apaga o que ele guardou
  const desfazer = async () => {
    api.ligado = false;
    net.beforeReload = null;
    avisar();
    await Promise.all([
      navigator.serviceWorker.getRegistrations().then(rs => Promise.all(rs.filter(r => r.scope === new URL('/kraft-cliente/', location.origin).href).map(r => r.unregister()))),
      window.caches && caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('kraft-kraft-cliente-')).map(k => caches.delete(k))))
    ]).catch(() => {});
  };
  if (temSW && params.get('sw') === '0') desfazer();
  else if (temSW && querSW) {
    // a página já nasceu pelas mãos do service worker: a versão dela é a dos arquivos guardados
    const assumir = () => {
      api.ligado = !!navigator.serviceWorker.controller;
      if (!api.ligado) { avisar(); return; }
      pedir({ t: 'estado' }).then((st) => { if (st && st.versao) { api.versao = st.versao; net.setBootBuild(st.versao, !document.querySelector('meta[name="kraft-multiplayer"]')); avisar(); } });
      // antes de recarregar por ordem do servidor, o aparelho busca a versão nova (até 8 s; sem resposta, recarrega assim mesmo)
      net.beforeReload = () => pedir({ t: 'atualizar', ms: 12000 }, 300000);
      avisar();
    };
    navigator.serviceWorker.addEventListener('controllerchange', assumir);
    if (navigator.serviceWorker.controller) assumir();
    async function registrar() {
      const multi = params.get('partida') === 'multiplayer' || (!params.has('partida') && params.has('mundo'));
      if (multi && !document.querySelector('meta[name="kraft-multiplayer"]')) {
        // O servidor pode ter desativado o instalador. Registrar de novo o worker que está saindo
        // intercepta a inicialização dos workers do terreno na próxima navegação.
        const info = await fetch('/api/info', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
        if (info?.cliente === false) { desfazer(); return; }
      }
      if (!navigator.serviceWorker.controller) await navigator.serviceWorker.register('/kraft-cliente/sw.js', { scope: '/kraft-cliente/', updateViaCache: 'none' });
    }
    registrar().catch((e) => console.warn('Cliente instalável indisponível:', e.message));
  }

  // ---- instalar --------------------------------------------------------------------------------
  addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); oferta = e; api.podeInstalar = true; avisar(); });
  addEventListener('appinstalled', () => {
    oferta = null; api.podeInstalar = false; api.instalado = true; avisar();
    ui.toast('Kraft instalado. Preparando os arquivos para jogar sem internet.', 5000);
    if (api.ligado && !api.baixando) baixarTudo();
  });
  const botaoInstalar = () => h('button', { class: 'btn small teal instalar hide', type: 'button', text: 'Instalar o Kraft neste aparelho', onclick: () => api.instalar() });
  const comoNoIOS = device.ios && !api.instalado
    ? 'No iPad e no iPhone: no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.' : '';

  // menu inicial: o botão aparece só quando o navegador oferece a instalação
  const instalarMenu = botaoInstalar();
  const cartao = ui.el.menu.querySelector('.card');
  const baixarMenu = h('button', { class: 'btn small', type: 'button', text: 'Baixar para jogar offline', onclick: () => baixarTudo() });
  const estadoMenu = h('p', { class: 'note', role: 'status' });
  const baixarPC = h('a', { class: 'btn small', href: 'https://github.com/kadkok/kraft-cliente/releases/latest/download/Kraft-PC.zip', text: 'Baixar para Windows ou Linux' });
  if (cartao) cartao.append(instalarMenu, baixarMenu, baixarPC, estadoMenu);

  // ---- pausa: "Este aparelho" ---------------------------------------------------------------
  const pendentes = new Set();
  const aplicar = h('button', { class: 'btn small primary hide', type: 'button', text: 'Aplicar (recarrega o jogo)', onclick: () => game.recarregar() });
  const mudou = (a, v) => {
    ui.on.setting(a.chave, v);
    pendentes.add(a.chave);
    aplicar.classList.remove('hide');
  };
  const linhas = AJUSTES.map((a) => {
    if (a.tipo === 'liga') {
      const inp = h('input', { type: 'checkbox' });
      inp.checked = settings[a.chave] !== false;
      inp.addEventListener('change', () => mudou(a, inp.checked));
      return h('label', { class: 'toggle' }, h('span', { text: a.rotulo }), inp);
    }
    const ops = a.opcoes(device);
    const sel = h('select', { 'aria-label': a.rotulo }, ops.map(([v, t]) => h('option', { value: String(v), text: t })));
    const atual = ops.find(([v]) => v === settings[a.chave]) || ops[0];
    sel.value = String(atual[0]);
    sel.addEventListener('change', () => { const o = ops.find(([v]) => String(v) === sel.value); if (o) mudou(a, o[0]); });
    sel.addEventListener('keydown', (e) => e.stopPropagation());
    return h('label', { class: 'field' }, h('span', { text: a.rotulo }), sel);
  });

  const instalarPausa = botaoInstalar();
  const situacao = h('p', { class: 'note' });
  const guardado = h('p', { class: 'note' });
  const porPacote = h('p', { class: 'note' });
  function baixarTudo() {
    if (api.baixando) { api.parar(); return; }
    // pede ao navegador para não apagar sozinho o que for guardado (ele pode recusar; no iPad, só o uso frequente garante)
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch { /* sem essa função */ }
    ultimoProgresso = 'Preparando os arquivos…';
    api.baixar(null, (p) => {
      ultimoProgresso = `Baixando ${MB(p.feito)} de ${MB(p.total)} · ${p.n}/${p.de}`;
      guardado.textContent = estadoMenu.textContent = ultimoProgresso;
    }).then((p) => {
      ultimoProgresso = p?.completo ? 'Pronto para jogar offline.' : p?.parado ? 'Download pausado. Você pode continuar depois.' : 'Download incompleto. Toque para continuar.';
      ui.toast(ultimoProgresso); pintar();
    });
  }
  const baixar = h('button', { class: 'btn small hide', type: 'button', text: 'Baixar o que falta', onclick: baixarTudo });
  const atualizar = h('button', { class: 'btn small hide', type: 'button', text: 'Atualizar agora', onclick: () => api.atualizar() });
  const apagar = h('button', { class: 'btn small hide', type: 'button', text: 'Apagar o que foi guardado', onclick: () => api.esquecer().then(pintar) });
  const secao = h('details', { class: 'aparelho' },
    h('summary', { text: 'Este aparelho: qualidade e instalação' }),
    linhas, aplicar,
    situacao, instalarPausa, guardado, porPacote,
    h('div', { class: 'row' }, baixar, atualizar, apagar));
  const card = ui.el.pauseCard;
  card.insertBefore(secao, card.querySelector('.row:last-of-type'));

  async function pintar() {
    baixarMenu.classList.toggle('hide', !api.ligado);
    baixarMenu.textContent = api.baixando ? 'Pausar download' : 'Baixar para jogar offline';
    estadoMenu.textContent = portatil ? 'Pronto para jogar offline neste computador.' : ultimoProgresso || comoNoIOS;
    for (const b of [instalarMenu, instalarPausa]) b.classList.toggle('hide', !api.podeInstalar);
    situacao.textContent = api.instalado ? 'Kraft instalado neste aparelho.'
      : api.podeInstalar ? 'Instalado, o Kraft ganha ícone próprio e abre em tela cheia.'
        : comoNoIOS || (!window.isSecureContext ? 'Instalar e guardar os arquivos só funcionam pelo endereço seguro (https).' : '');
    situacao.classList.toggle('hide', !situacao.textContent);
    for (const b of [baixar, atualizar, apagar]) b.classList.toggle('hide', !api.ligado);
    baixar.textContent = api.baixando ? 'Parar o download' : 'Baixar o que falta';
    if (!api.ligado) { guardado.textContent = ''; porPacote.textContent = ''; return; }
    if (api.baixando) return;
    const st = await api.estado();
    if (!st || !st.versao) { guardado.textContent = 'Os arquivos ainda não estão sendo guardados neste aparelho (vale a partir da próxima abertura).'; porPacote.textContent = ''; return; }
    const falta = st.bytes - st.tem;
    baixarMenu.classList.toggle('hide', falta <= 0);
    if (!falta && st.bytes) estadoMenu.textContent = 'Pronto para jogar offline.' + (comoNoIOS ? ' ' + comoNoIOS : '');
    else if (falta > 0) baixarMenu.textContent = `Baixar para jogar offline (${MB(falta)})`;
    guardado.textContent = `Guardado neste aparelho: ${MB(st.tem)} de ${MB(st.bytes)} · versão ${st.versao}`;
    porPacote.textContent = st.pacotes.filter((p) => p.n && !p.reserva).map((p) => `${p.nome} ${Math.floor(100 * p.tem / (p.bytes || 1))}%`).join(' · ');
    baixar.classList.toggle('hide', falta <= 0);
    if (falta > 0) baixar.textContent = `Baixar o que falta (${MB(falta)})`;
    apagar.classList.toggle('hide', st.tem <= 0);
  }
  secao.addEventListener('toggle', pintar);
  api.on(pintar);
  pintar();

  // O pacote completo é baixado ao instalar ou pelo botão do menu. Durante a partida só os recursos usados são lidos.

  return api;
}
