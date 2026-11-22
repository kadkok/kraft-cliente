import { arquivoFerroviario } from './ferrovia-local.js';
import { SEA } from '../../shared/constants.js';
import { TREM, tracarVia, pontoVia, poseVia, horarioVia, viagem } from '../../shared/ferrovia.js';
import { corredores, dentroTunel } from '../../shared/ferrovia-terreno.js';
import { criarComposicao, trechoVisual, liberarTrem } from '../render/trem-bala.js';

const distancia = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const TAM = 64,
  VISTA = 240;
export function initFerrovia({ game, world, player, net, ui, input, scene }) {
  const linhas = new Map();
  const arquivo = arquivoFerroviario();
  const avisos = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kraft-ferrovias') : null;
  let sessao = 0;
  if (avisos) avisos.onmessage = ({ data }) => {
    if (net.offline && data === chaveMundo) carregarLocal();
  };
  let indice = null,
    bordo = null,
    proxima = null,
    aguardando = null,
    editor = null;
  let ladoAssento = 1,
    rumoAnterior = null,
    disponivel = false,
    chaveMundo = '';
  const barra = document.createElement('div'),
    aviso = document.createElement('span'),
    botao = document.createElement('button');
  barra.className = 'ferrovia-embarque';
  barra.hidden = true;
  botao.type = 'button';
  barra.append(aviso, botao);
  document.body.append(barra);
  const agora = () => game.balsas?.agora?.() ?? Date.now() / 1000;
  const estacao = (l, n) => poseVia(l.via, n ? l.horario.fim : l.horario.ini);
  function sair(l, restaurar = false) {
    const estado = l.estado,
      qual = estado.estacao >= 0 ? estado.estacao : Number(estado.s > l.via.comprimento / 2);
    const { p, rumo } = estacao(l, qual);
    const x = p[0] + 2.55 * Math.cos(rumo),
      z = p[2] - 2.55 * Math.sin(rumo);
    player.teleport(
      x,
      restaurar ? Math.max(SEA + 1.1, game.gen.height(Math.floor(x), Math.floor(z)) + 1.2) : p[1] + 0.72,
      z,
    );
    bordo = null;
    aguardando = null;
    rumoAnterior = null;
  }
  function usar() {
    if (bordo) {
      if (bordo.estado.estacao >= 0) sair(bordo);
      else ui.toast('O desembarque abre quando o trem parar na próxima estação.');
      return;
    }
    if (!proxima) return;
    const { l, n } = proxima;
    if (l.estado.estacao === n) {
      bordo = l;
      aguardando = null;
      player.flying = false;
      ladoAssento = n ? -1 : 1;
      rumoAnterior = null;
      player.yaw = estacao(l, n).rumo + (n ? 0 : Math.PI);
      player.pitch = 0;
    } else aguardando = aguardando?.l === l && aguardando.n === n ? null : { l, n };
  }
  botao.addEventListener('click', usar);
  game.hooks.interact.unshift((_dt, jogando) => {
    if (!jogando || game.overlay || (!proxima && !bordo) || !input.wasPressed('interact')) return false;
    usar();
    return true;
  });
  function sincronizar(novas, troca = false) {
    const ids = new Set(novas.map((l) => l.id));
    for (const [id, l] of linhas)
      if (troca || !ids.has(id) || novas.find((n) => n.id === id)?.rev !== l.rev) {
        if (bordo === l) sair(l, true);
        if (aguardando?.l === l) aguardando = null;
        liberarTrem(l.trem.g);
        for (const faixa of l.faixas) if (faixa.g) liberarTrem(faixa.g);
        linhas.delete(id);
      }
    for (const dados of novas)
      if (!linhas.has(dados.id)) {
        const via = tracarVia(dados.pontos),
          horario = horarioVia(via),
          trem = criarComposicao(),
          faixas = [];
        for (let s = 0; s < via.comprimento; s += TAM)
          faixas.push({ s, centro: pontoVia(via, Math.min(s + TAM / 2, via.comprimento)), g: null });
        scene.add(trem.g);
        linhas.set(dados.id, {
          ...dados,
          via,
          horario,
          trem,
          faixas,
          estado: viagem(horario, agora() - dados.inicio),
        });
      }
    indice = novas.length ? corredores(novas, game.gen.height) : null;
    world.definirFerrovia(indice);
    editor?.atualizar();
  }
  async function carregarLocal(comando) {
    const atual = sessao, chave = chaveMundo;
    try {
      const { lista, resultado } = await arquivo.consultar(chave, comando);
      if (resultado?.alterou) avisos?.postMessage(chave);
      if (atual !== sessao || !net.offline) return;
      sincronizar(lista);
      if (resultado) { editor?.resposta(resultado); ui.toast(resultado.texto); }
    } catch {
      if (atual !== sessao || !net.offline) return;
      const texto = 'O aparelho não conseguiu acessar o arquivo dos trilhos. Confira o espaço e a permissão de armazenamento.';
      editor?.resposta({ ok: false, texto }); ui.toast(texto);
    }
  }
  game.hooks.other.push((m) => {
    if (m.t === 'welcome' || m.t === 'dim' || m.t === 'offline') {
      // Mesmo id/revisão em outro mundo ou durante reconexão nunca herda um assento.
      const solo = m.t === 'offline';
      const chave = [solo ? 'solo' : 'multi', game.slug, game.seed, game.dim].join('/');
      sessao++;
      disponivel = solo || Array.isArray(m.ferrovias);
      bordo = null;
      aguardando = null;
      proxima = null;
      sincronizar(m.ferrovias || [], chave !== chaveMundo);
      chaveMundo = chave;
      editor?.reiniciar();
      if (solo) carregarLocal();
    } else if (m.t === 'ferrovias') sincronizar(m.linhas || []);
    else if (m.t === 'ferrovia-resposta') {
      editor?.resposta(m);
      ui.toast(m.texto);
    }
  });
  game.hooks.pre.push(() => {
    if ((game.dim || 0) !== 0 || game.state !== 'PLAYING') {
      barra.hidden = true;
      proxima = null;
      return;
    }
    proxima = null;
    let menor = 9;
    const hora = agora();
    for (const l of linhas.values()) {
      const st = (l.estado = viagem(l.horario, hora - l.inicio));
      const perto = distancia(pontoVia(l.via, st.s), player.pos) < VISTA * 1.7 || bordo === l;
      l.trem.g.visible = perto;
      if (perto) l.trem.atualizar(l.via, st);
      for (const [n, s] of [
        [0, l.horario.ini],
        [1, l.horario.fim],
      ]) {
        const d = distancia(pontoVia(l.via, s), player.pos);
        if (d < menor) {
          menor = d;
          proxima = { l, n };
        }
      }
    }
    if (aguardando && (!proxima || proxima.l !== aguardando.l || proxima.n !== aguardando.n)) aguardando = null;
    if (aguardando && proxima?.l.estado.estacao === aguardando.n) usar();
    if (bordo) {
      const st = bordo.estado,
        p = poseVia(bordo.via, st.s + ladoAssento * (TREM.entreCarros / 2 + 1.05), 3);
      if (rumoAnterior !== null)
        player.yaw += Math.atan2(Math.sin(p.rumo - rumoAnterior), Math.cos(p.rumo - rumoAnterior));
      rumoAnterior = p.rumo;
      player.teleport(p.p[0], p.p[1] + 0.24, p.p[2]);
      player.onGround = true;
      player.inWater = player.headInWater = false;
    }
    // Orçamento por quadro compartilhado por todas as linhas. As distantes só guardam seu traçado.
    const inicio = performance.now();
    for (const l of linhas.values())
      for (const faixa of l.faixas) {
        const d = distancia(faixa.centro, player.pos);
        if (faixa.g && d > VISTA + TAM + 48) {
          liberarTrem(faixa.g);
          faixa.g = null;
        }
        if (!faixa.g && d < VISTA + TAM && performance.now() - inicio < 3) {
          faixa.g = trechoVisual(l.via, faixa.s, Math.min(l.via.comprimento, faixa.s + TAM), game.gen.height, l.nome);
          scene.add(faixa.g);
        }
      }
    const l = bordo || proxima?.l;
    barra.hidden = !l || !!game.overlay;
    if (!l) return;
    const st = l.estado,
      n = bordo ? st.estacao : proxima.n;
    aviso.textContent =
      l.nome +
      ' · ' +
      (bordo
        ? st.estacao >= 0
          ? 'Estação ' + (st.estacao ? 'B' : 'A')
          : Math.round(st.v * 3.6) + ' km/h  →  ' + (st.volta ? 'A' : 'B')
        : 'Estação ' + (n ? 'B' : 'A'));
    botao.disabled = !!bordo && st.estacao < 0;
    botao.textContent = bordo
      ? st.estacao >= 0
        ? 'Desembarcar (F)'
        : 'Em viagem'
      : st.estacao === n
        ? 'Embarcar (F)'
        : aguardando
          ? 'Cancelar espera (F)'
          : 'Aguardar o trem (F)';
  });
  game.hooks.fixed.push(() => !!bordo && game.state === 'PLAYING');
  game.ferrovia = {
    linhas,
    get corredores() {
      return indice;
    },
    get disponivel() {
      return disponivel;
    },
    get podeEditar() {
      return disponivel && !game.dim && (net.offline || (net.online && game.gmAtivo));
    },
    get bordo() {
      return bordo?.id || null;
    },
    seco: (x, y, z) => dentroTunel(indice, x, y, z),
    conectarEditor(e) {
      editor = e;
    },
    enviar(m) {
      if (!this.podeEditar) return false;
      if (net.offline) {
        carregarLocal({ msg: m, altura: game.gen.height, edicoes: world.edits });
        return true;
      }
      if (!net.online) {
        ui.toast('Conecte-se ao mundo para salvar a ferrovia.');
        return false;
      }
      net.send({ t: 'ferrovia', ...m });
      return true;
    },
  };
  return game.ferrovia;
}
