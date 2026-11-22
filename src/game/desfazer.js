// LAVRA — desfazer e refazer (Hermes, 21/11/2026; pedido do Kadmus: "ctrl + z para desfazer uma ação, isso ajudaria
// muito em caso de apagar ou quebrar algo sem querer").
//
//   Ctrl+Z            desfaz a última ação de bloco (quebrar ou pôr)
//   Ctrl+Y            refaz (também Ctrl+Shift+Z); no Mac, Cmd no lugar de Ctrl
//   toque             botão "↶ Desfazer" no canto, quando há o que desfazer (no VR ainda não tem botão)
//
// Como funciona: todo bloco que quem joga põe ou quebra passa por interaction.set(). Este módulo embrulha essa função
// e guarda, para cada célula, como ela estava ANTES e como ficou DEPOIS. Tudo o que muda na mesma ação (porta de duas
// partes, planta que cai junto, obra trocada) vira um passo só. Desfazer manda de volta o estado de antes pelo caminho
// normal (interaction.set original → net.sendBlock), então o servidor confere tudo como numa edição comum: área
// protegida, limite de edições, véu. Se ele recusar, devolve o bloco certo sozinho.
//
// Regras:
// - Só nos modos em que pôr não gasta da mochila (criativo, ou GM ligado). No sobrevivência, desfazer uma quebra
//   criaria bloco do nada e desfazer um pôr devolveria o bloco sem tirá-lo da mochila. Lá aparece um aviso.
// - Se outra coisa mexeu na célula depois (outro jogador, a água, a queda), aquela célula fica como está. Desfazer não
//   apaga a obra dos outros.
// - Não põe bloco sólido onde há alguém em pé.
// - Ficam de fora nesta versão: peças e objetos (mão/editor), máquinas, explosões e o tronco que tomba inteiro (a
//   árvore cai pelo servidor; desfazer devolve só o bloco quebrado).
// - A memória é deste aparelho e da dimensão atual. Trocar de mundo ou dimensão zera a lista. Guarda até 200 passos.
import { B, FUNC, F_DYNAMITE, SOLID, BLOCKS } from '../../shared/blocks.js';
import { h } from '../ui/ui.js';

const MAX_PASSOS = 200, MAX_CELULAS = 256;

export function initDesfazer({ game, world, interaction, player, ui, device }) {
  const desfeitos = [], refeitos = [];
  let aberto = null;          // passo em montagem (fecha no fim da tarefa atual do navegador)
  let aplicando = false;      // desfazer/refazer em curso: não grava de novo
  const original = interaction.set.bind(interaction);
  const mini = (x, y, z) => world.getMini?.(x, y, z) || 0;

  interaction.set = function (x, y, z, id, m = 0) {
    if (!aplicando) {
      const antes = world.getBlock(x, y, z);
      // o pavio da dinamite apaga o próprio bloco sozinho, segundos depois: isso não é ação de quem joga
      const pavio = id === B.AIR && antes > 0 && FUNC[antes] === F_DYNAMITE;
      if (antes !== -1 && !pavio) gravar(x, y, z, antes, mini(x, y, z), id, m || 0);
    }
    return original(x, y, z, id, m);
  };

  function gravar(x, y, z, idA, mA, idD, mD) {
    if (idA === idD && mA === mD) return;
    if (!aberto) {
      aberto = { cel: new Map(), dim: game.dim };
      queueMicrotask(fechar);
    }
    const k = x + ',' + y + ',' + z;
    const ja = aberto.cel.get(k);
    if (ja) { ja.d = [idD, mD]; return; }   // mesma célula duas vezes na mesma ação: vale o primeiro "antes"
    if (aberto.cel.size < MAX_CELULAS) aberto.cel.set(k, { x, y, z, a: [idA, mA], d: [idD, mD] });
  }
  function fechar() {
    const p = aberto; aberto = null;
    if (!p || !p.cel.size) return;
    desfeitos.push({ dim: p.dim, cel: [...p.cel.values()] });
    if (desfeitos.length > MAX_PASSOS) desfeitos.shift();
    refeitos.length = 0;      // ação nova depois de desfazer: o "refazer" antigo deixa de valer
  }

  const podeAgora = () => {
    const r = game.modeRules;
    if (r && r.poe !== 'infinito') { ui.toast('Desfazer (Ctrl+Z) só funciona no modo criativo: no sobrevivência ele criaria blocos do nada.', 3800); return false; }
    return true;
  };
  const ocupado = (x, y, z, id) => SOLID[id] && (player.occupies?.(x, y, z) || interaction.blocked?.(x, y, z));

  // aplica um passo numa direção: de 'd' (como ficou) para 'a' (como era), ou o contrário no refazer
  function aplicar(passo, de, para) {
    let feitas = 0, puladas = 0;
    aplicando = true;
    try {
      for (let i = passo.cel.length - 1; i >= 0; i--) {
        const c = passo.cel[i];
        const [idEsp, mEsp] = c[de], [idNovo, mNovo] = c[para];
        const agora = world.getBlock(c.x, c.y, c.z);
        if (agora === -1 || agora !== idEsp || mini(c.x, c.y, c.z) !== mEsp || ocupado(c.x, c.y, c.z, idNovo)) { puladas++; continue; }
        original(c.x, c.y, c.z, idNovo, mNovo);
        feitas++;
      }
    } finally { aplicando = false; }
    return { feitas, puladas };
  }

  function passo(origem, destino, de, para, verbo) {
    if (!podeAgora()) return;
    fechar();
    while (origem.length && origem[origem.length - 1].dim !== game.dim) origem.pop();
    const p = origem.pop();
    if (!p) { ui.toast(verbo === 'desfazer' ? 'Nada para desfazer.' : 'Nada para refazer.', 1600); return; }
    const { feitas, puladas } = aplicar(p, de, para);
    if (!feitas) { ui.toast(`Não deu para ${verbo}: alguém (ou a água, ou a queda) já mexeu nesses blocos.`, 3200); return; }
    destino.push(p);
    const c0 = p.cel[0], nome = BLOCKS[c0[para][0] || c0[de][0]]?.name || 'bloco';
    game.audio?.play(c0[para][0] ? 'place' : 'break', 0.8, verbo === 'desfazer' ? 0.85 : 1.1);
    ui.toast((verbo === 'desfazer' ? '↶ Desfeito' : '↷ Refeito') + (feitas > 1 ? ` (${feitas} blocos)` : `: ${nome}`)
      + (puladas ? ` · ${puladas} já tinham mudado e ficaram como estão` : '')
      + (origem.length ? ` · faltam ${origem.length}` : ''), 1800);
  }
  const desfazer = () => passo(desfeitos, refeitos, 'd', 'a', 'desfazer');
  const refazer = () => passo(refeitos, desfeitos, 'a', 'd', 'refazer');

  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.code !== 'KeyZ' && e.code !== 'KeyY') return;
    const alvo = e.target;
    if (alvo && (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return;   // digitando no chat ou num campo
    if (game.state !== 'PLAYING') return;
    e.preventDefault();
    e.stopImmediatePropagation();   // sozinho, Y liga o mini-bloco (input/input.js); com Ctrl, é só refazer
    if (e.code === 'KeyY' || e.shiftKey) refazer(); else desfazer();
  }, true);

  // trocou de mundo ou de dimensão: os blocos guardados não valem mais
  game.hooks.other.push((m) => {
    if (m.t === 'welcome' || m.t === 'offline') { desfeitos.length = 0; refeitos.length = 0; aberto = null; }
  });

  // toque (celular, iPad): um botão "↶ Desfazer" no canto, só quando há o que desfazer e o modo permite
  if (device?.touch && ui.el?.corner) {
    const bt = h('button', { class: 'btn small btn-mini hide', type: 'button', title: 'Desfaz a última ação de bloco (Ctrl+Z no PC)', text: '↶ Desfazer',
      onclick: () => { if (game.state === 'PLAYING' && !game.overlay) desfazer(); } });
    bt.addEventListener('pointerdown', (e) => e.stopPropagation());
    ui.el.corner.prepend(bt);
    game.hooks.frame.push(() => {
      const mostra = game.state === 'PLAYING' && !game.overlay && desfeitos.length > 0 && (game.modeRules?.poe ?? 'infinito') === 'infinito';
      if (bt.classList.contains('hide') === mostra) bt.classList.toggle('hide', !mostra);
    });
  }

  const api = { desfazer, refazer, get passos() { return desfeitos.length; }, get refazer_() { return refeitos.length; } };
  game.desfazer = api;
  return api;
}
