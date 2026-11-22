// Kraft — o MODELO do menu do VR (19/11/2026, pedido do Kadmus: "no óculos VR nenhum botão abriu o menu do futebol";
// "quem joga com mobile ou principalmente com VR precisa ter todas as opções de jogo similares a como aparece no PC").
// Puro: sem DOM, sem three. Recebe um retrato do jogo (`estado`, montado por game/menu-vr.js) e devolve as abas, os
// itens de cada seção, o desenho deles em pixels do quadro e quem foi tocado pelo laser. Quem executa as ações é o
// game/menu-vr.js, sempre pelos mesmos caminhos do PC (API do futebol, modos, mochila, baú, obras, ajustes).
//
// Itens (o que o pintor desenha):
//   { tipo: 'titulo', texto } · { tipo: 'nota', texto, tom? } · { tipo: 'quebra' }
//   { tipo: 'botao', texto, acao, arg, on?, desligado?, tom?: 'primario'|'perigo'|'time', cor?, larg? }
//   { tipo: 'passo', rotulo, valor, acao, arg, larg? }      → partes 'menos' (−) e 'mais' (+)
//   { tipo: 'ciclo', rotulo, valor, cor?, acao, arg, larg? } → partes 'menos' (◀) e 'mais' (▶)
//   { tipo: 'celula', acao, arg, item: [b, s, n] | null, on?, marca?: 'barra'|'lenda', larg }
// `larg` é a fração da largura do conteúdo (padrão 1). A ação de passo/ciclo recebe { ...arg, dir: −1 | 1 }.
import { SKILLS_FUTEBOL, FUT_CHUTEIRAS, FUT_SKINS } from '../../shared/espacos.js';
import {
  TEMPOS_PARTIDA, METAS_PARTIDA, ROBOS_LINHA, PRESETS_GM, SECOES_GM, CAMPOS_GM,
  presetAtivo, lerCampo, textoCampo, textoMeta, textoTempo,
} from './futebol-painel.js';

// ---- geometria do quadro (pixels do canvas; no VR o quadro tem ~1,25 m de largura) -------------------------------------
export const PAINEL_W = 1280, PAINEL_H = 860;
export const TOPO_H = 78, ABAS_W = 252, GAP = 10, RODAPE_H = 60;
export const CONTEUDO = Object.freeze({ x: ABAS_W + 18, y: TOPO_H + 10, w: PAINEL_W - ABAS_W - 18 - 26, h: PAINEL_H - TOPO_H - 10 - 16 - RODAPE_H });
export const FECHAR = Object.freeze({ x: PAINEL_W - 196, y: 14, w: 180, h: 52 });
// rodapé: o último aviso do jogo (no VR o HTML dos avisos não aparece) ou a ajuda dos controles
export const RODAPE = Object.freeze({ x: 18, y: PAINEL_H - RODAPE_H + 2, w: PAINEL_W - 36, h: RODAPE_H - 14 });
export const AJUDA_CONTROLES = 'X ou ✕ fecha · gatilho direito clica · analógico direito rola';
export const ABA_H = 58;
const ALTURA = { titulo: 44, botao: 66, passo: 66, ciclo: 66, quebra: 0 };
const LINHA_NOTA = 30;

export const ABAS = Object.freeze([
  { id: 'futebol', rotulo: 'Futebol', icone: '⚽' },
  { id: 'gm', rotulo: 'Estúdio GM', icone: '👑' },
  { id: 'modo', rotulo: 'Modo de jogo', icone: '🎮' },
  { id: 'mochila', rotulo: 'Mochila', icone: '🎒' },
  { id: 'blocos', rotulo: 'Blocos', icone: '🧱' },
  { id: 'bau', rotulo: 'Baú', icone: '📦' },
  { id: 'obras', rotulo: 'Construção', icone: '🏗' },
  { id: 'mundo', rotulo: 'Mapa e mundo', icone: '🗺' },
  { id: 'ajustes', rotulo: 'Ajustes', icone: '⚙' },
  { id: 'chat', rotulo: 'Chat', icone: '💬' },
  { id: 'sair', rotulo: 'Sair', icone: '🚪' },
]);

// Ajustes da pausa que valem no visor (sensibilidade, campo de visão e eixo invertido não se aplicam ao VR).
export const AJUSTES = Object.freeze([
  { chave: 'volume', rotulo: 'Volume', min: 0, max: 1, passo: 0.1, fmt: (v) => `${Math.round(v * 100)}%` },
  { chave: 'music', rotulo: 'Música', min: 0, max: 1, passo: 0.1, fmt: (v) => (v > 0 ? `${Math.round(v * 100)}%` : 'desligada') },
  { chave: 'distance', rotulo: 'Distância de visão', min: 3, max: 16, passo: 1, fmt: (v) => `${v} chunks` },
]);
export const passoAjuste = (a, v, dir) => Math.round(Math.max(a.min, Math.min(a.max, (Number(v) || 0) + (dir < 0 ? -1 : 1) * a.passo)) * 100) / 100;

export const FRASES_CHAT = Object.freeze(['Oi! 👋', 'Vem jogar bola!', 'Gooool!', 'Boa jogada!', 'Espera aí!', 'Vem aqui!',
  'Vamos construir?', 'Tô no VR 🥽', 'Já volto', 'Tchau!']);

// Qual seção uma tela do PC vira no VR (o HTML não aparece dentro do visor).
export function secaoDoOverlay(overlay, estado) {
  if (overlay === 'bau') return 'bau';
  if (overlay === 'futebol') return 'futebol';
  if (overlay === 'palette') return estado?.modo?.regras?.criativo && !estado?.espacoAtivo ? 'blocos' : 'mochila';
  if (overlay === 'chat') return 'chat';
  if (!overlay || overlay === 'menu-vr' || overlay === 'mapa') return null;
  return 'tela';
}

export function abasVisiveis(e) {
  const r = e.modo?.regras || {};
  return ABAS.filter((a) => {
    if (a.id === 'futebol') return !!e.futebol?.temCampo;
    if (a.id === 'gm') return !!(e.futebol?.temCampo && e.futebol.isGm && e.futebol.gmAtivo);
    if (a.id === 'blocos') return !!r.criativo && !e.espacoAtivo;
    if (a.id === 'bau') return !!e.bau;
    if (a.id === 'obras') return !!r.poe && !e.espacoAtivo;
    return true;
  });
}

// A seção que aparece: a pedida, se a aba existe; senão a primeira.
export function secaoValida(e, pedida) {
  if (e.pausado) return 'sair';
  if (pedida === 'tela') return 'tela';
  const abas = abasVisiveis(e);
  return abas.some((a) => a.id === pedida) ? pedida : abas[0].id;
}

// ---- conteúdo de cada seção ------------------------------------------------------------------------------------------
const B = (texto, acao, arg, o = {}) => ({ tipo: 'botao', texto, acao, arg, ...o });
const T = (texto) => ({ tipo: 'titulo', texto });
const N = (texto, tom) => ({ tipo: 'nota', texto, tom });

function futebol(e) {
  const f = e.futebol;
  if (!f?.temCampo) return [N('Este mundo não tem campo de futebol.')];
  const p = f.partida, r = f.robos, t = f.meuTime, sk = SKILLS_FUTEBOL[f.skill] || SKILLS_FUTEBOL[0];
  const out = [
    N(`⚽ ${f.lados[0]} ${f.placar[0]} × ${f.placar[1]} ${f.lados[1]} · ${p.texto}`, 'destaque'),
    T('Seu time'),
    B(f.lados[0], 'fut.time', 0, { on: t === 0, tom: 'time', cor: f.cores[0], larg: 1 / 3 }),
    B(f.lados[1], 'fut.time', 1, { on: t === 1, tom: 'time', cor: f.cores[1], larg: 1 / 3 }),
    B('Livre', 'fut.time', -1, { on: t === undefined, larg: 1 / 3 }),
    T('Partida'),
    B(p.estado === 'jogo' ? 'Encerrar partida' : 'Começar partida oficial', 'fut.partida', null, { tom: 'primario', larg: 1 / 2 }),
    B('Zerar placar', 'fut.zerar', null, { larg: 1 / 2 }),
    T('Gols para vencer'),
    { tipo: 'passo', rotulo: 'Meta', valor: textoMeta(p.meta), acao: 'fut.metaPasso', arg: {}, larg: 1 / 2 },
    ...METAS_PARTIDA.map(([n, lbl]) => B(lbl, 'fut.meta', n, { on: p.meta === n, larg: 1 / 8 })),
    T('Tempo de jogo'),
    ...TEMPOS_PARTIDA.map(([seg, lbl]) => B(lbl, 'fut.tempo', seg, { on: (p.duracao || 0) === seg, larg: 1 / 4 })),
    T('Robôs por time'),
    ...ROBOS_LINHA.map((n) => B(`${n} na linha`, 'fut.robos', { linha: n }, { on: r.linha === n, larg: 1 / 4 })),
    B('Goleiros', 'fut.robos', { goleiro: !r.goleiro }, { on: r.goleiro, larg: 1 / 2 }),
    B('Juiz', 'fut.robos', { juiz: !r.juiz }, { on: r.juiz, larg: 1 / 2 }),
    T(`Habilidade do gatilho — ${sk.tecla}. ${sk.nome}`),
    ...SKILLS_FUTEBOL.map((s, i) => B(`${s.tecla}. ${s.curto}`, 'fut.skill', i, { on: i === f.skill, cor: s.cor, larg: 1 / 5 })),
    B(f.curva > 0 ? 'Curva: direita →' : 'Curva: esquerda ←', 'fut.curva', null, { on: f.curva < 0, larg: 1 / 5 }),
    N('No campo: gatilho direito joga (segure para carregar o chute) · gatilho/aperto esquerdos trocam a habilidade · B inverte a curva. Fora do campo, perto da bola, o gatilho direito chuta como o F do PC.'),
  ];
  if (f.isGm) {
    out.push(T('Modo GM'),
      B(f.gmAtivo ? '👑 Modo GM: LIGADO' : '👑 Modo GM: DESLIGADO', 'fut.gm', null, { on: f.gmAtivo, larg: 1 / 2 }),
      f.gmAtivo ? B('⚙ Abrir o Estúdio GM', 'aba', 'gm', { larg: 1 / 2 }) : B('Ligue o Modo GM para o Estúdio', null, null, { desligado: true, larg: 1 / 2 }));
  }
  const prof = f.perfil;
  out.push(T('XP e visual'),
    N(`⭐ Nível ${prof.nivel} · ${prof.xp} XP · Gols oficiais ${prof.gols} · Vitórias ${prof.vitorias} · Partidas ${prof.partidas}`),
    ...FUT_CHUTEIRAS.map((ch) => {
      const ok = prof.xp >= ch.xp, on = prof.chuteira === ch.id;
      return B(`${ch.nome}${ok ? (on ? ' ✓' : '') : ` (${ch.xp} XP)`}`, 'fut.chuteira', ch.id, { on, desligado: !ok, larg: 1 / 2 });
    }),
    ...FUT_SKINS.map((s) => {
      const ok = prof.xp >= s.xp, on = prof.skin === s.id;
      return B(`${s.nome}${ok ? (on ? ' ✓' : '') : ` (${s.xp} XP)`}`, 'fut.skin', s.id, { on, desligado: !ok, larg: 1 / 2 });
    }));
  return out;
}

function estudioGm(e) {
  const f = e.futebol, d = e.gmRascunho;
  if (!f?.isGm || !f.gmAtivo || !d) return [N('Só para GM com o Modo GM ligado (aba Futebol).')];
  const out = [
    N('Os ajustes ficam no rascunho até "Salvar e aplicar" (os presets aplicam na hora), como no Estúdio GM do PC.'),
    T('Presets rápidos (1 clique — aplica ao vivo)'),
    ...PRESETS_GM.map((pr) => B(pr.nome, 'gm.preset', pr.id, { on: presetAtivo(d, pr), larg: 1 / 4 })),
  ];
  for (const sec of SECOES_GM) {
    out.push(T(sec.titulo(d)));
    for (const c of CAMPOS_GM) {
      if (c.secao !== sec.id) continue;
      const v = lerCampo(d, c);
      if (c.tipo === 'liga') out.push(B(`${c.rotulo}: ${v ? 'sim' : 'não'}`, 'gm.campo', { id: c.id, dir: 1 }, { on: !!v, larg: 1 / 2 }));
      else if (c.tipo === 'faixa') out.push({ tipo: 'passo', rotulo: c.rotulo, valor: textoCampo(c, v), acao: 'gm.campo', arg: { id: c.id }, larg: 1 / 2 });
      else out.push({ tipo: 'ciclo', rotulo: c.rotulo, valor: String(v), cor: c.tipo === 'cor' ? v : null, acao: 'gm.campo', arg: { id: c.id }, larg: 1 / 2 });
    }
  }
  out.push({ tipo: 'quebra' },
    B('Restaurar padrão', 'gm.restaurar', null, { larg: 1 / 3 }),
    B('Desfazer o rascunho', 'gm.recarregar', null, { larg: 1 / 3 }),
    B('Salvar e aplicar no estádio', 'gm.salvar', null, { tom: 'primario', larg: 1 / 3 }));
  return out;
}

function modo(e) {
  const m = e.modo, r = m.regras || {};
  const out = [
    T('Modo de jogo (como no Minecraft)'),
    ...m.lista.map(([id, nome]) => B(nome, 'modo.set', id, { on: id === m.id, larg: 1 / 4 })),
    N(m.texto || ''),
  ];
  if (r.voa && !e.espacoAtivo) {
    out.push(T('Voo'), B(m.voando ? 'Voar: ligado' : 'Voar: desligado', 'modo.voar', null, { on: m.voando, larg: 1 / 2 }),
      N('Também: A duas vezes (como Espaço 2× no PC). Voando, o analógico direito sobe e desce.'));
  }
  if (e.futebol?.isGm) {
    out.push(T('GM'), B(e.futebol.gmAtivo ? '👑 Modo GM: LIGADO' : '👑 Modo GM: DESLIGADO', 'fut.gm', null, { on: e.futebol.gmAtivo, larg: 1 / 2 }),
      N('Ligado: todos os blocos à mão e pôr sem gastar em qualquer modo; no campo de futebol, edição liberada e Estúdio GM.'));
  }
  return out;
}

function grade(lista, acao, sel, barra, marcaLenda) {
  return lista.map((it, k) => ({ tipo: 'celula', acao, arg: k, item: it || null, on: k === sel, marca: barra && k < 9 ? 'barra' : marcaLenda?.(it) ? 'lenda' : null, larg: 1 / 9 }));
}

function mochila(e) {
  const m = e.mochila;
  if (m.invisivel) return [N('No modo espectador não se usa a mochila.')];
  if (m.offline) return [N('Sem servidor, quebrar não solta itens e não há mochila.')];
  const s = m.sel >= 0 ? m.l[m.sel] : null;
  const out = [
    N(`${m.total} ${m.total === 1 ? 'item' : 'itens'} · ${m.usados} de ${m.l.length} espaços · ${s ? `escolhido: ${s[2]} ${m.nome(s)} — toque noutro espaço para trocar de lugar` : m.barra ? 'os 9 primeiros são a barra: toque num item e depois num espaço da barra' : 'toque num item para escolher'}`),
  ];
  if (m.barra) out.push(T('Barra (os 9 primeiros)'), ...grade(m.l.slice(0, 9), 'mochila.slot', m.sel, true), T('Resto da mochila'),
    ...grade(m.l.slice(9), 'mochila.slot', m.sel - 9, false).map((c) => ({ ...c, arg: c.arg + 9 })));
  else out.push(T('Mochila'), ...grade(m.l, 'mochila.slot', m.sel, false));
  out.push({ tipo: 'quebra' },
    B('Largar 1', 'mochila.largar', false, { desligado: !s, larg: 1 / 4 }),
    B('Largar tudo', 'mochila.largar', true, { desligado: !s, larg: 1 / 4 }),
    B(m.auto ? 'Pegar ao passar: ligado' : 'Pegar ao passar: desligado', 'mochila.coleta', null, { on: m.auto, larg: 1 / 4 }),
    B('Pegar o que está perto', 'mochila.pegar', null, { larg: 1 / 4 }));
  return out;
}

function blocos(e) {
  const b = e.blocos;
  return [
    T('Barra: escolha o espaço'),
    ...b.barra.map((id, i) => ({ tipo: 'celula', acao: 'blocos.barra', arg: i, item: id ? [id, 0, 1] : null, on: i === b.sel, larg: 1 / 9 })),
    T('Grupos'),
    ...b.grupos.map(([g, nome]) => B(nome, 'blocos.grupo', g, { on: g === b.grupo, larg: 1 / 4 })),
    ...b.lista.map((id) => ({ tipo: 'celula', acao: 'blocos.bloco', arg: id, item: [id, 0, 1], on: id === b.barra[b.sel], larg: 1 / 9 })),
    N('Toque num bloco para pôr no espaço escolhido da barra. Os blocos do Minecraft (aba de busca) ficam na tela E do PC e do celular por enquanto.'),
  ];
}

function bau(e) {
  const b = e.bau;
  if (!b) return [N('Nenhum baú aberto. Mire num baú e aperte B.')];
  return [
    N(`📦 Baú ${b.nivel} · vale ${b.valor}${b.lenda ? ` · há uma arma lendária aqui: ${b.lenda}` : ''}`, b.lenda ? 'destaque' : null),
    B(b.um ? 'Levar: 1 por vez' : 'Levar: a pilha toda', 'bau.um', null, { on: b.um, larg: 1 / 2 }),
    B('Fechar o baú', 'bau.fechar', null, { tom: 'perigo', larg: 1 / 2 }),
    T('No baú'), ...grade(b.l, 'bau.pegar', -1, false, b.ehLenda),
    T('Sua mochila'), ...grade(b.mochila, 'bau.por', -1, b.barra),
  ];
}

function obras(e) {
  const o = e.obras, r = e.modo?.regras || {};
  const out = [];
  if (r.criativo) {
    const rec = o.gravando, a = o.ativa;
    out.push(T('Obras (conjuntos de blocos)'),
      N(rec ? `Obra aberta: ${rec.n} ${rec.n === 1 ? 'bloco' : 'blocos'}${rec.o ? ` + ${rec.o} obras` : ''} — o que você colocar entra nela.`
        : a ? `Na mira: ${a.name} (${a.count} ${a.count === 1 ? 'bloco' : 'blocos'}${a.layers > 1 ? `, camada ${a.layer + 1} de ${a.layers}` : ''}).`
          : 'Mire num bloco de uma obra ANTES de abrir o menu: Trocar todos, Camada e Desagrupar valem para o que estava na mira.'),
      B(rec ? 'Fechar obra' : 'Agrupar (abrir obra)', 'obras.agrupar', null, { on: !!rec, larg: 1 / 3 }),
      B('Juntar o da mira', 'obras.juntar', null, { desligado: !rec, larg: 1 / 3 }),
      B('Trocar todos', 'obras.trocar', null, { desligado: !!rec || !a, larg: 1 / 3 }),
      B('Camada', 'obras.camada', null, { desligado: !!rec || !a || a.layers < 2, larg: 1 / 3 }),
      B(rec ? 'Cancelar obra' : 'Desagrupar', 'obras.desagrupar', null, { desligado: !rec && !a, tom: 'perigo', larg: 1 / 3 }));
    if (o.offline) out.push(N('As obras precisam do servidor.'));
  }
  out.push(T('Peças'),
    B(o.mini ? 'Mini-bloco (¼): ligado' : 'Mini-bloco (¼): desligado', 'obras.mini', null, { on: o.mini, larg: 1 / 2 }),
    B(o.machado ? 'Guardar machado' : 'Equipar machado', 'obras.machado', null, { on: o.machado }),
    B(o.tronco ? 'Tronco: quadrado' : 'Tronco: redondo', 'obras.tronco', null, { on: o.tronco, larg: 1 / 2 }),
    N('Mini-bloco: o gatilho e o aperto põem e tiram ¼ de bloco (a tecla Y do PC). Tronco: como o K do PC.'));
  return out;
}

function mundo(e) {
  const w = e.mundo;
  const planos = w.dim === 0 ? [['nano', 'Mergulhar no bloco da mira (nano)'], ['macro', 'Subir para o macro']] : [['normal', 'Voltar ao plano normal']];
  return [
    B('🗺 Abrir o mapa', 'mundo.mapa', null, { tom: 'primario', larg: 1 / 2 }),
    B(w.bussola ? 'Bússola: ligada' : 'Bússola: desligada', 'mundo.bussola', null, { on: w.bussola, larg: 1 / 2 }),
    T('Planos (escala do mundo)'),
    ...planos.map(([k, txt]) => B(txt, 'mundo.plano', k, { desligado: w.offline, larg: 1 / 2 })),
    T('Caminhos'),
    B('Voltar ao ponto de início', 'mundo.inicio', null, { desligado: w.dim !== 0, larg: 1 / 2 }),
    B('Povoados perto (/povos)', 'mundo.povos', null, { desligado: w.offline, larg: 1 / 2 }),
    N('No mapa: gatilho arrasta, botões Zoom e Centrar embaixo. A resposta dos comandos aparece nos avisos.'),
  ];
}

function ajustes(e) {
  const a = e.ajustes;
  return [
    ...AJUSTES.map((x) => ({ tipo: 'passo', rotulo: x.rotulo, valor: x.fmt(a[x.chave]), acao: 'ajuste.passo', arg: { chave: x.chave }, larg: 1 / 2 })),
    { tipo: 'ciclo', rotulo: 'Duração do dia (vale para o mundo todo)', valor: a.dia, acao: 'ajuste.dia', arg: {}, larg: 1 },
    T('No visor'),
    B(a.autoJump ? 'Pulo automático: ligado' : 'Pulo automático: desligado', 'ajuste.liga', 'autoJump', { on: a.autoJump, larg: 1 / 2 }),
    B(a.snapTurn ? 'Giro em passos (30°): ligado' : 'Giro em passos: desligado (giro suave)', 'ajuste.liga', 'snapTurn', { on: a.snapTurn, larg: 1 / 2 }),
    B(a.real ? 'Realismo (chão de foto): ligado' : 'Realismo (chão de foto): desligado', 'ajuste.real', null, { on: a.real, larg: 1 / 2 }),
    N('Trocar o realismo recarrega o jogo e sai do VR. Sensibilidade, campo de visão e eixo invertido não valem no visor (quem olha é a cabeça).'),
  ];
}

function chat(e) {
  const c = e.chat;
  const out = [T('Últimas mensagens')];
  if (!c.linhas.length) out.push(N('Nenhuma mensagem ainda.'));
  for (const l of c.linhas.slice(-6)) out.push(N(l.nome ? `${l.nome}: ${l.texto}` : l.texto, l.sys ? 'sys' : null));
  out.push(T('Mandar uma frase'), ...FRASES_CHAT.map((t) => B(t, 'chat.frase', t, { larg: 1 / 3 })));
  if (c.teclado) out.push(B('⌨ Escrever com o teclado do óculos', 'chat.teclado', null, { larg: 1 }));
  out.push(N(c.teclado ? 'O teclado do óculos aparece por cima do jogo; Enter manda.'
    : 'Para escrever qualquer coisa, use o chat no PC ou no celular (o navegador deste óculos não ofereceu teclado dentro do VR).'));
  return out;
}

function sair(e) {
  return [
    B(e.pausado ? '▶ Continuar jogando' : 'Fechar o menu e continuar', 'sair.continuar', null, { tom: 'primario', larg: 1 }),
    B('Sair do VR (volta à tela do navegador)', 'sair.vr', null, { larg: 1 / 2 }),
    B('Sair para o menu inicial', 'sair.menu', null, { tom: 'perigo', larg: 1 / 2 }),
    N('O menu abre e fecha no X do controle esquerdo ou no botão ☰ do pulso.'),
  ];
}

function tela(e) {
  return [
    N(`Esta tela do PC (${e.overlay}) ainda não tem versão dentro do VR.`, 'destaque'),
    B('Fechar esta tela', 'tela.fechar', null, { tom: 'primario', larg: 1 / 2 }),
    N('A bancada de trabalho e o editor de objetos continuam só no PC e no celular por enquanto.'),
  ];
}

const SECOES = { futebol, gm: estudioGm, modo, mochila, blocos, bau, obras, mundo, ajustes, chat, sair, tela };

export function conteudoDaSecao(secao, e) { return (SECOES[secao] || modo)(e); }

// ---- desenho em pixels: fluxo em linhas (frações da largura), altura da nota pelo texto ----------------------------
const estimar = (texto, larguraPx) => Math.max(1, Math.ceil((String(texto).length * 12.6) / Math.max(80, larguraPx - 28)));

export function montarLayout(itens, largura = CONTEUDO.w, medirLinhas = estimar) {
  const out = [];
  let x = 0, y = 0, alturaLinha = 0;
  const novaLinha = () => { if (x > 0) { y += alturaLinha + GAP; x = 0; alturaLinha = 0; } };
  for (const it of itens) {
    if (it.tipo === 'quebra') { novaLinha(); continue; }
    const frac = it.tipo === 'titulo' || it.tipo === 'nota' ? 1 : (it.larg || 1);
    if (frac >= 0.999 || it.tipo === 'titulo') novaLinha();
    let w = Math.floor(largura * frac - (frac < 0.999 ? GAP * (1 - frac) : 0));
    if (x > 0 && x + w > largura + 1) novaLinha();
    if (it.tipo === 'celula') w = Math.floor((largura - GAP * 8) / 9);
    let h = it.tipo === 'celula' ? w : it.tipo === 'nota' ? medirLinhas(it.texto, w) * LINHA_NOTA + 14 : ALTURA[it.tipo] || 66;
    const r = { ...it, x, y, w, h };
    if (it.tipo === 'passo' || it.tipo === 'ciclo') {
      const bw = 64;
      r.partes = { menos: { x: x + w - bw * 2 - 8, y: y + 5, w: bw, h: h - 10 }, mais: { x: x + w - bw, y: y + 5, w: bw, h: h - 10 } };
    }
    out.push(r);
    x += w + GAP;
    alturaLinha = Math.max(alturaLinha, h);
    if (frac >= 0.999) novaLinha();
  }
  const altura = y + alturaLinha;
  return { itens: out, altura };
}

export const rolagemMaxima = (layout) => Math.max(0, layout.altura - CONTEUDO.h + 8);

const dentro = (r, x, y) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
export const retanguloDaAba = (i) => ({ x: 14, y: TOPO_H + 6 + i * (ABA_H + 6), w: ABAS_W - 14, h: ABA_H });

// Quem está no ponto (x, y) do quadro: { aba }, { fechar: true } ou { item, parte, rect }. `rolagem` em pixels.
export function acharAlvo(modelo, x, y) {
  if (dentro(FECHAR, x, y)) return { fechar: true, rect: FECHAR };
  if (x < ABAS_W + 4) {
    for (let i = 0; i < modelo.abas.length; i++) { const r = retanguloDaAba(i); if (dentro(r, x, y)) return { aba: modelo.abas[i].id, rect: r }; }
    return null;
  }
  if (!dentro(CONTEUDO, x, y)) return null;
  const cx = x - CONTEUDO.x, cy = y - CONTEUDO.y + modelo.rolagem;
  for (const it of modelo.layout.itens) {
    if (!dentro(it, cx, cy)) continue;
    const tela = (r) => ({ x: r.x + CONTEUDO.x, y: r.y + CONTEUDO.y - modelo.rolagem, w: r.w, h: r.h, conteudo: true });   // conteudo: recortar na janela
    if (it.partes) {
      for (const k of ['menos', 'mais']) if (dentro(it.partes[k], cx, cy)) return { item: it, parte: k, rect: tela(it.partes[k]) };
      return { item: it, parte: null, rect: null };
    }
    if (!it.acao || it.desligado) return { item: it, parte: null, rect: null };
    return { item: it, parte: null, rect: tela(it) };
  }
  return null;
}

// O que o clique faz: [acao, arg] ou null.
export function acaoDoAlvo(alvo) {
  if (!alvo) return null;
  if (alvo.fechar) return ['fechar', null];
  if (alvo.aba) return ['aba', alvo.aba];
  const it = alvo.item;
  if (!it || !it.acao || it.desligado) return null;
  if (it.partes) return alvo.parte ? [it.acao, { ...(it.arg || {}), dir: alvo.parte === 'menos' ? -1 : 1 }] : null;
  return [it.acao, it.arg];
}

// Tudo de uma vez: abas, seção, itens, desenho e rolagem (limitada).
export function montarModelo(e, secaoPedida, rolagemPedida = 0, medirLinhas) {
  const abas = e.pausado ? ABAS.filter((a) => a.id === 'sair') : abasVisiveis(e);
  const secao = secaoValida(e, secaoPedida);
  const itens = conteudoDaSecao(secao, e);
  const layout = montarLayout(itens, CONTEUDO.w, medirLinhas);
  const rolagem = Math.max(0, Math.min(rolagemMaxima(layout), rolagemPedida || 0));
  const aba = ABAS.find((a) => a.id === secao);
  return { abas, secao, titulo: secao === 'tela' ? 'Tela do PC' : aba ? `${aba.icone} ${aba.rotulo}` : '', itens, layout, rolagem, placar: e.futebol?.temCampo ? e.futebol : null };
}

export { textoTempo };
