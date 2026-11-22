import { SEA, Y_MIN, Y_TOP } from '../../shared/constants.js';
import { TREM, problemaVia, tracarVia, tipoVia } from '../../shared/ferrovia.js';

const cores = { solo: '#ddd4aa', ponte: '#f2ac5e', vidro: '#62d6ec', tunel: '#c39bed' };
const tipos = { solo: 'superfície', ponte: 'ponte', vidro: 'túnel de vidro', tunel: 'túnel de montanha' };

export function editorFerrovia({ game, tela, topo, st }) {
  const entrada = document.createElement('button');
  entrada.type = 'button';
  entrada.textContent = 'Ferrovia';
  entrada.className = 'ferrovia-abrir';
  entrada.hidden = true;
  topo.append(entrada);
  const painel = document.createElement('section');
  painel.className = 'ferrovia-editor';
  painel.setAttribute('aria-label', 'Editor de vias');
  painel.hidden = true;
  painel.innerHTML = `<div class="ferrovia-titulo"><strong>Traçar ferrovia</strong><div><button type="button" data-a="ampliar" aria-label="Maximizar editor" aria-pressed="false">⤢</button> <button type="button" data-a="fechar" aria-label="Fechar editor">×</button></div></div>
    <label>Linha <select data-f="linha"><option value="">Nova linha</option></select></label>
    <label>Nome <input data-f="nome" maxlength="44" placeholder="Expresso das Ilhas"></label>
    <p>Toque no mapa para marcar o trajeto. Arraste um ponto para movê-lo.</p>
    <label>Altura do trilho (m) <input data-f="altura" type="number" step="1"></label>
    <div class="ferrovia-presets"><button type="button" data-a="solo">No solo</button><button type="button" data-a="ponte">Sobre o mar</button><button type="button" data-a="vidro">Sob o mar</button></div>
    <div class="ferrovia-presets"><button type="button" data-a="inserir">Inserir após o ponto</button><button type="button" data-a="remover">Remover ponto</button></div>
    <output aria-live="polite"></output><div class="ferrovia-acoes"><button type="button" data-a="desfazer">Desfazer</button><button type="button" data-a="excluir">Excluir linha</button><button type="button" data-a="salvar">Salvar linha</button></div>`;
  tela.append(painel);
  const campo = (k) => painel.querySelector('[data-f="' + k + '"]'),
    acao = (k) => painel.querySelector('[data-a="' + k + '"]');
  const lista = campo('linha'),
    nome = campo('nome'),
    altura = campo('altura'),
    status = painel.querySelector('output');
  altura.min = Y_MIN + 4;
  altura.max = Y_TOP - 8;
  let pontos = [],
    id = '',
    rev = 0,
    selecionado = -1,
    arrastando = null,
    arrastou = false,
    via = null,
    confirmar = false,
    pendente = false,
    inserir = false,
    historico = [];
  let pedidoNovo = null;
  const permitido = () => !!game.ferrovia?.podeEditar;
  const chao = (x, z) => game.gen.height(Math.floor(x), Math.floor(z)) + 1;
  const mundo = (mx, my) => [
    Math.round(st.cx + (mx - st.w / 2) * st.esc),
    Math.round(st.cz + (my - st.h / 2) * st.esc),
  ];
  const clonar = (ps) => ps.map((p) => p.slice());
  function guardar() {
    historico.push({ pontos: clonar(pontos), selecionado });
    if (historico.length > 64) historico.shift();
  }
  function recalcular() {
    const extensao = pontos.reduce(
      (d, p, i) => d + (i ? Math.hypot(p[0] - pontos[i - 1][0], p[2] - pontos[i - 1][2]) : 0),
      0,
    );
    via =
      extensao <= TREM.maxComprimento &&
      pontos.length > 1 &&
      pontos.every((p, i) => !i || p[0] !== pontos[i - 1][0] || p[2] !== pontos[i - 1][2])
        ? tracarVia(pontos)
        : null;
    const p = pontos[selecionado];
    altura.disabled = !p;
    altura.value = p ? String(Math.round(p[1])) : '';
    if (via) for (const n of via.nos) n.tipo = tipoVia(n.p[1], chao(n.p[0], n.p[2]));
    const falha = problemaVia(pontos);
    const info = p
      ? 'Ponto ' +
        (selecionado + 1) +
        ' · ' +
        tipos[tipoVia(p[1], chao(p[0], p[2]))] +
        ' · terreno ' +
        chao(p[0], p[2]) +
        ' m. '
      : '';
    status.textContent =
      info + (falha || Math.round(via.comprimento) + ' m de via. Estações A e B nas extremidades.');
    acao('remover').disabled = acao('inserir').disabled = !p;
    acao('inserir').textContent = inserir ? 'Toque para inserir' : 'Inserir após o ponto';
    acao('salvar').disabled = pendente || !!falha;
    acao('desfazer').disabled = !historico.length;
    acao('excluir').hidden = !id;
    acao('excluir').textContent = confirmar ? 'Confirmar exclusão' : 'Excluir linha';
  }
  function opcoes() {
    const ativo = id;
    lista.replaceChildren(new Option('Nova linha', ''));
    for (const l of game.ferrovia?.linhas.values() || []) lista.add(new Option(l.nome, l.id));
    lista.value = ativo;
  }
  function carregar(alvo = '') {
    pedidoNovo = null;
    const l = game.ferrovia?.linhas.get(alvo);
    id = l?.id || '';
    rev = l?.rev || 0;
    pontos = l ? clonar(l.pontos) : [];
    selecionado = pontos.length - 1;
    nome.value = l?.nome || '';
    confirmar = false;
    inserir = false;
    historico = [];
    pendente = false;
    opcoes();
    recalcular();
  }
  function fechar() {
    painel.hidden = true;
    arrastando = null;
  }
  entrada.onclick = () => {
    if (!permitido()) return;
    if (!painel.hidden) return fechar();
    painel.hidden = false;
    opcoes();
    recalcular();
  };
  function ampliar() {
    const cheia = painel.classList.toggle('ampliado'),
      b = acao('ampliar');
    b.setAttribute('aria-label', cheia ? 'Restaurar editor' : 'Maximizar editor');
    b.setAttribute('aria-pressed', String(cheia));
  }
  acao('ampliar').onclick = ampliar;
  painel.querySelector('.ferrovia-titulo').ondblclick = (e) => {
    if (!e.target.closest('button')) ampliar();
  };
  acao('fechar').onclick = fechar;
  lista.onchange = () => carregar(lista.value);
  painel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') fechar();
  });
  altura.onchange = () => {
    if (!pontos[selecionado] || altura.value === '') return recalcular();
    guardar();
    pontos[selecionado][1] = Math.max(Y_MIN + 4, Math.min(Y_TOP - 8, Math.round(altura.valueAsNumber)));
    recalcular();
  };
  for (const tipo of ['solo', 'ponte', 'vidro'])
    acao(tipo).onclick = () => {
      const p = pontos[selecionado];
      if (!p) return;
      guardar();
      const h = chao(p[0], p[2]);
      p[1] = tipo === 'solo' ? h : tipo === 'ponte' ? Math.max(h, SEA + 8) : SEA - 8;
      recalcular();
    };
  acao('inserir').onclick = () => {
    inserir = !inserir;
    recalcular();
  };
  acao('remover').onclick = () => {
    if (selecionado < 0) return;
    guardar();
    pontos.splice(selecionado, 1);
    selecionado = Math.min(selecionado, pontos.length - 1);
    inserir = false;
    recalcular();
  };
  acao('desfazer').onclick = () => {
    const salvo = historico.pop();
    if (salvo) {
      pontos = salvo.pontos;
      selecionado = salvo.selecionado;
      recalcular();
    }
  };
  function enviar(acaoNome) {
    if (!permitido() || pendente) return;
    if (acaoNome === 'salvar' && !nome.value.trim()) {
      status.textContent = 'Dê um nome à linha antes de salvar.';
      nome.focus();
      return;
    }
    if (!id && !pedidoNovo) pedidoNovo = globalThis.crypto?.randomUUID?.();
    pendente = game.ferrovia.enviar({ acao: acaoNome, id, rev, novo: pedidoNovo, pontos, nome: nome.value });
    recalcular();
    if (pendente) status.textContent = 'Salvando a linha…';
  }
  acao('salvar').onclick = () => enviar('salvar');
  acao('excluir').onclick = () => {
    if (confirmar) return enviar('excluir');
    confirmar = true;
    recalcular();
    status.textContent = 'Confirmar remove a linha e restaura o terreno.';
  };
  function perto(x, z) {
    let mais = -1,
      raio = 13 * st.esc;
    pontos.forEach((p, i) => {
      const d = Math.hypot(p[0] - x, p[2] - z);
      if (d < raio) {
        mais = i;
        raio = d;
      }
    });
    return mais;
  }
  const aberto = () => !painel.hidden && permitido() && !pendente;
  function clicar(mx, my) {
    if (!aberto()) return false;
    const [x, z] = mundo(mx, my),
      n = perto(x, z);
    if (n >= 0) selecionado = n;
    else if (pontos.length < TREM.maxPontos) {
      guardar();
      const novo = [x, pontos[selecionado]?.[1] ?? Math.max(SEA + 2, chao(x, z)), z];
      selecionado = inserir ? selecionado + 1 : pontos.length;
      pontos.splice(selecionado, 0, novo);
      inserir = false;
    }
    confirmar = false;
    recalcular();
    return true;
  }
  function inicio(mx, my) {
    if (!aberto()) return false;
    const i = perto(...mundo(mx, my));
    if (i < 0) return false;
    selecionado = i;
    arrastando = i;
    arrastou = false;
    recalcular();
    return true;
  }
  function mover(mx, my) {
    if (arrastando === null || !aberto()) return false;
    const [x, z] = mundo(mx, my),
      p = pontos[arrastando];
    if (p[0] === x && p[2] === z) return true;
    if (!arrastou) {
      guardar();
      arrastou = true;
    }
    p[0] = x;
    p[2] = z;
    recalcular();
    return true;
  }
  function desenhar(ctx, px, pz) {
    entrada.hidden = !permitido();
    if (!permitido()) fechar();
    ctx.save();
    const desenha = (v, rascunho) => {
      if (!v) return;
      let cor = null;
      const passo = Math.max(1, Math.min(48, Math.floor(st.esc / 2)));
      ctx.lineWidth = rascunho ? 3 : 2;
      let a = v.nos[0].p;
      for (let i = 1; i < v.nos.length; i += passo) {
        const b = v.nos[Math.min(i + passo - 1, v.nos.length - 1)].p;
        const proxima = rascunho ? cores[v.nos[Math.min(i + passo - 1, v.nos.length - 1)].tipo] : '#8fd6ca';
        if (proxima !== cor) {
          if (cor) ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(px(a[0]), pz(a[2]));
          cor = proxima;
          ctx.strokeStyle = cor;
        }
        ctx.lineTo(px(b[0]), pz(b[2]));
        a = b;
      }
      if (cor) ctx.stroke();
    };
    for (const l of game.ferrovia?.linhas.values() || []) {
      if (!painel.hidden && id === l.id) continue;
      desenha(l.via, false);
      for (const [j, n] of [0, l.via.nos.length - 1].entries()) {
        const p = l.via.nos[n].p;
        ctx.fillStyle = '#e6fcfb';
        ctx.font = 'bold 12px system-ui';
        ctx.fillText(l.nome + ' · ' + (j ? 'B' : 'A'), px(p[0]) + 5, pz(p[2]) - 6);
      }
    }
    if (!painel.hidden) {
      desenha(via, true);
      pontos.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(px(p[0]), pz(p[2]), i === selecionado ? 6 : 4, 0, Math.PI * 2);
        ctx.fillStyle = i === selecionado ? '#fff3be' : '#f1f4ef';
        ctx.fill();
        ctx.strokeStyle = '#453d38';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    }
    ctx.restore();
  }
  const api = {
    clicar,
    inicio,
    mover,
    desenhar,
    soltar() {
      const foi = arrastando !== null;
      arrastando = null;
      return foi;
    },
    fechar,
    atualizar: opcoes,
    reiniciar() {
      carregar();
      fechar();
    },
    resposta(m) {
      pendente = false;
      if (m.ok) {
        carregar();
        fechar();
      } else {
        recalcular();
        status.textContent = m.texto;
      }
    },
  };
  game.ferrovia?.conectarEditor(api);
  return api;
}
