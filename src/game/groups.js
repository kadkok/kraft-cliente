// LAVRA — obras no cliente: abrir e fechar a obra, escolher a camada, trocar todos de uma vez, desagrupar.
// O dono das obras é o servidor (server/world.js → groupOp); aqui fica o espelho (shared/groups.js), a gravação da
// obra aberta e os comandos de quem joga. Sem servidor não há obras.
//
// Como se usa (teclado · os mesmos comandos estão nos botões do canto e na tela de blocos):
//   O  abre a obra; tudo o que for colocado entra nela; O de novo fecha e os blocos viram um conjunto
//   J  com a obra aberta: junta o bloco (ou a obra inteira) que está na mira · fora dela: troca o bloco mirado pelo da
//      mão, e se ele é de uma obra troca TODOS os blocos dela
//   L  quando o bloco mirado está em obras dentro de obras: escolhe a camada (de dentro para fora)
//   U  desfaz a camada escolhida (os blocos e as obras de dentro sobem um nível) · com a obra aberta: cancela
//
// Para quem desenha (realce do conjunto, ícones): game.groups
//   .all        espelho das obras deste plano: at(x, y, z), chain(id), get(id), each(id, fn), cells(id), count(id)
//   .active     a obra na mira, já na camada escolhida: { id, name, by, count, layer, layers, chain } ou null
//   .recording  a obra aberta: { cells: Map("x,y,z" -> [x, y, z]), kids: Set(id) } ou null
//   .on(fn)     fn(oQue) a cada mudança: 'ativa' | 'abre' | 'fecha' | 'grava' | 'nova' | 'desfeita' | 'saiu' | 'mundo'

import { createGroups, cellKey, unflat, GROUP_MAX_CELLS, GROUP_MAX_KIDS } from '../../shared/groups.js';
import { B, BLOCKS, LEVEL } from '../../shared/blocks.js';
import { h } from '../ui/ui.js';

const whole = (x, y, z) => Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function initGroups({ game, world, net, ui, input, interaction, device, closeOverlay }) {
  const groups = createGroups();
  const keys = !(device && device.touch);      // no toque não há tecla para citar
  let rec = null;                               // a obra aberta: { cells, kids, where }
  let sel = 0;                                  // a camada escolhida (id de obra) para o bloco mirado
  let active = null, activeKey = '';
  let full = false;
  const listeners = [];
  const emit = (what) => { for (const f of listeners) f(what); };
  const where = () => game.slug + ':' + game.dim;
  const say = (text, ms) => ui.toast(text, ms);

  // ---- a obra na mira ---------------------------------------------------------------------------------------
  function current() {
    const t = interaction.target;
    if (!t.hit) return null;
    const inner = groups.at(t.x, t.y, t.z);
    if (!inner) return null;
    const chain = groups.chain(inner);
    let layer = chain.indexOf(sel);
    if (layer < 0) { layer = 0; sel = chain[0]; }        // outra obra na mira: começa pela camada de dentro
    const g = groups.get(chain[layer]);
    return { id: g.id, name: g.name, by: g.by, count: groups.count(g.id), layer, layers: chain.length, chain };
  }

  // ---- comandos -----------------------------------------------------------------------------------------------
  function toggle() {
    if (net.offline) return say('As obras precisam do servidor.');
    if (!rec) {
      rec = { cells: new Map(), kids: new Set(), where: where() };
      full = false;
      say('Obra aberta: o que você colocar entra nela.', 4500);       // as teclas ficam na dica, embaixo
      game.audio.play('open', 1, 1.1);
      return emit('abre');
    }
    // fecha: vão os blocos que ainda existem e as obras que ainda existem
    const flat = [];
    for (const c of rec.cells.values()) {
      const b = world.getBlock(c[0], c[1], c[2]);
      if (b > 0 && !LEVEL[b] && !groups.at(c[0], c[1], c[2])) flat.push(c[0], c[1], c[2]);
    }
    const kids = [...rec.kids].filter((id) => groups.get(id) && !groups.get(id).up);
    rec = null;
    emit('fecha');
    if (!flat.length && kids.length < 2) return say('Obra fechada sem nada para agrupar.');
    net.send({ t: 'g', op: 'new', c: flat, k: kids });
  }
  function cancel() {
    rec = null;
    say('Obra cancelada: nada foi agrupado.');
    emit('fecha');
  }
  // com a obra aberta: junta (ou tira) o bloco ou a obra que está na mira
  function include() {
    const t = interaction.target;
    if (!rec || !t.hit) return;
    const inner = groups.at(t.x, t.y, t.z);
    if (inner) {
      const top = groups.root(inner), g = groups.get(top);
      if (rec.kids.delete(top)) say(`${g.name} saiu da obra aberta.`);
      else if (rec.kids.size >= GROUP_MAX_KIDS) say(`Uma obra leva no máximo ${GROUP_MAX_KIDS} obras dentro.`);
      else { rec.kids.add(top); say(`${g.name} (${plural(groups.count(top), 'bloco', 'blocos')}) entra na obra aberta.`); }
    } else if (t.id > 0 && !LEVEL[t.id] && t.id !== B.BEDROCK && t.id !== B.PORTAL) {
      const key = cellKey(t.x, t.y, t.z);
      if (rec.cells.delete(key)) say('Bloco fora da obra aberta.');
      else if (rec.cells.size >= GROUP_MAX_CELLS) say(`Uma obra leva no máximo ${GROUP_MAX_CELLS} blocos.`);
      else rec.cells.set(key, [t.x, t.y, t.z]);
    }
    game.audio.play('tick', 1, 1.25);
    emit('grava');
  }
  function swap() {
    if (rec) return include();
    const t = interaction.target;
    if (!t.hit) return;
    const item = game.hotbar[game.sel];
    if (!item || !BLOCKS[item] || LEVEL[item]) return say('Escolha na barra o bloco que vai entrar no lugar.');
    const cur = current();
    if (cur) {
      if (net.offline) return say('As obras precisam do servidor.');
      return net.send({ t: 'g', op: 'set', id: cur.id, b: item });
    }
    // bloco solto: troca só ele
    if (t.id === item || t.id === B.BEDROCK || t.id === B.PORTAL) return;
    interaction.set(t.x, t.y, t.z, item);
    game.audio.play('place', 1, 0.9 + Math.random() * 0.2, BLOCKS[item].sound);
  }
  function ungroup() {
    if (rec) return cancel();
    const cur = current();
    if (!cur) return say('Mire num bloco de uma obra para desagrupar.');
    if (net.offline) return say('As obras precisam do servidor.');
    net.send({ t: 'g', op: 'del', id: cur.id });
  }
  function layerUp() {
    const cur = current();
    if (!cur || cur.layers < 2) return;
    sel = cur.chain[(cur.layer + 1) % cur.layers];
    game.audio.play('tick', 1, 1);
  }

  // ---- o que o jogador coloca e quebra enquanto a obra está aberta -----------------------------------------------
  game.hooks.edit.push((x, y, z, id, placed) => {
    if (!rec) return;
    const key = cellKey(x, y, z);
    if (!placed) { if (rec.cells.delete(key)) emit('grava'); return; }
    if (groups.at(x, y, z)) return;
    if (rec.cells.size >= GROUP_MAX_CELLS) {
      if (!full) { full = true; say(`A obra aberta chegou a ${GROUP_MAX_CELLS} blocos: feche esta e abra outra.`, 6000); }
      return;
    }
    rec.cells.set(key, [x, y, z]);
    emit('grava');
  });

  // ---- o que vem do servidor -------------------------------------------------------------------------------------
  let palBtn = null;
  game.hooks.other.push((m) => {
    switch (m.t) {
      case 'welcome':                                   // mundo ou plano novo (ou a volta de uma queda de conexão)
        groups.load(m.groups || []);
        if (rec && rec.where !== where()) rec = null;
        sel = 0;
        emit('mundo');
        break;
      case 'offline': groups.clear(); rec = null; sel = 0; emit('mundo'); break;
      case 'g+': {
        const g = m.g;
        if (!g || !groups.add({ id: g.id, cells: unflat(g.c, whole), kids: Array.isArray(g.k) ? g.k : [], name: g.name, by: g.by })) break;
        if (m.from === net.id) {
          const inside = groups.get(g.id).kids.size;
          say(`${g.name} fechada: ${plural(groups.count(g.id), 'bloco', 'blocos')}${inside ? `, com ${plural(inside, 'obra', 'obras')} dentro` : ''}.`, 4500);
          game.audio.play('tick', 1, 1.4);
        }
        emit('nova');
        break;
      }
      case 'g-': {
        const g = groups.get(m.id), name = g ? g.name : 'Obra';
        if (!groups.ungroup(m.id)) break;
        if (m.from === net.id) say(`${name} desagrupada.`);
        emit('desfeita');
        break;
      }
      case 'gx':
        if (Array.isArray(m.l)) for (let i = 0; i + 2 < m.l.length; i += 3) groups.cellGone(m.l[i], m.l[i + 1], m.l[i + 2]);
        emit('saiu');
        break;
      case 'g=':
        say(m.n ? `${plural(m.n, 'bloco trocado', 'blocos trocados')} por ${BLOCKS[m.b] ? BLOCKS[m.b].name : 'outro bloco'}.` : 'A obra já era toda desse bloco.');
        break;
      case 'boot': {
        // na tela de blocos o ponteiro está solto: é onde se clica com o mouse
        palBtn = h('button', { class: 'btn small', type: 'button', text: 'Agrupar', onclick: () => { closeOverlay(); toggle(); } });
        ui.paletteExtra().append(h('div', { class: 'shapes wide' }, palBtn,
          h('button', { class: 'btn small', type: 'button', text: 'Desagrupar', onclick: () => { closeOverlay(); ungroup(); } })));
        break;
      }
      default:
    }
  });

  // ---- botões do canto (toque, ou ponteiro solto) e o estado de cada quadro ----------------------------------------
  const grpIco = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  grpIco.setAttribute('viewBox', '0 0 24 24'); grpIco.setAttribute('aria-hidden', 'true'); grpIco.setAttribute('class', 'ico');
  grpIco.innerHTML = '<path fill="currentColor" d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm12 2v2h-2v2h2v2h2v-2h2v-2h-2v-2h-2Z"/>';
  const grpLbl = h('span', { class: 'lbl', text: 'Agrupar' });
  const bGroup = h('button', { class: 'btn small btn-icon-mob', type: 'button', title: 'Abre uma obra; de novo, fecha e agrupa (tecla O)', 'aria-label': 'Agrupar obra', onclick: () => toggle() }, grpIco, grpLbl);
  const bInc = h('button', { class: 'btn small hide', type: 'button', text: 'Juntar', title: 'Junta à obra aberta o bloco ou a obra da mira (tecla J)', onclick: () => include() });
  const bSwap = h('button', { class: 'btn small hide', type: 'button', text: 'Trocar todos', title: 'Troca todos os blocos da obra pelo bloco da mão (tecla J)', onclick: () => swap() });
  const bLayer = h('button', { class: 'btn small hide', type: 'button', text: 'Camada', title: 'Escolhe a camada: da obra de dentro para a de fora (tecla L)', onclick: () => layerUp() });
  const bUn = h('button', { class: 'btn small hide', type: 'button', text: 'Desagrupar', title: 'Desfaz a camada escolhida (tecla U)', onclick: () => ungroup() });
  ui.el.corner.prepend(bGroup, bInc, bSwap, bLayer, bUn);
  const show = (el, on) => { if (el.classList.contains('hide') === on) el.classList.toggle('hide', !on); };
  const label = (el, text) => { const t = el === bGroup ? grpLbl : el; if (t.textContent !== text) t.textContent = text; };

  game.hooks.frame.push(() => {
    const inGame = game.state === 'PLAYING' || game.state === 'PAUSED';
    if (game.state === 'PLAYING' && !game.overlay) {
      if (input.wasPressed('group')) toggle();
      if (input.wasPressed('ungroup')) ungroup();
      if (input.wasPressed('swap')) swap();
      if (input.wasPressed('layer')) layerUp();
    }
    if (rec && rec.where !== where()) rec = null;       // saiu do plano com a obra aberta: ela não vale no outro
    active = inGame ? current() : null;
    const key = active ? active.id + ':' + active.count : '';
    if (key !== activeKey) { activeKey = key; emit('ativa'); }
    label(bGroup, rec ? 'Fechar obra' : 'Agrupar');
    if (bGroup.classList.contains('on') !== !!rec) bGroup.classList.toggle('on', !!rec);
    if (palBtn) label(palBtn, rec ? 'Fechar obra' : 'Agrupar');
    show(bInc, !!rec);
    show(bSwap, !rec && !!active);
    show(bLayer, !rec && !!active && active.layers > 1);
    show(bUn, !!rec || !!active);
    label(bUn, rec ? 'Cancelar obra' : 'Desagrupar');
  });

  // a dica do bloco mirado ganha o estado da obra (main.js chama game.hint com o nome do bloco)
  game.hint = (base) => {
    if (rec) {
      const n = rec.cells.size, o = rec.kids.size;
      return `Obra aberta: ${plural(n, 'bloco', 'blocos')}${o ? ' + ' + plural(o, 'obra', 'obras') : ''}` + (keys ? ' — O fecha · J junta o da mira · U cancela' : '');
    }
    if (!active) return base;
    const camada = active.layers > 1 ? `, camada ${active.layer + 1} de ${active.layers}` : '';
    return `${base} · ${active.name} (${plural(active.count, 'bloco', 'blocos')}${camada})`
      + (keys ? ` — J troca todos · U desagrupa${active.layers > 1 ? ' · L camada' : ''}` : '');
  };

  const api = {
    all: groups,
    get active() { return active; },
    get recording() { return rec; },
    on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    toggle, include, swap, ungroup, layerUp, cancel,
  };
  game.groups = api;
  return api;
}
