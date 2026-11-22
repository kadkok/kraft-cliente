// Kraft — dados do painel do futebol, num lugar só (19/11/2026, pedido do Kadmus: "quem joga com mobile ou
// principalmente com VR precisa ter todas as opções de jogo similares a como aparece no PC"). Puro: sem DOM, sem three.
//
// Quem usa: o painel do PC (game/bola.js → "⚽ Partida / XP" e "⚙️ Estúdio GM") e o menu do VR (game/menu-vr.js). Os dois
// leem as MESMAS listas daqui e mandam as MESMAS mensagens pela API de game/bola.js (`game.futebol.painel`); quem decide
// e limita é o servidor (server/bola.js → painel, shared/espacos.js → limparCustomFutebol). Nada de regra repetida:
//   - TEMPOS_PARTIDA, METAS_PARTIDA, ROBOS_LINHA: os botões da aba Partida;
//   - PRESETS_GM: os presets de 1 clique do Estúdio GM;
//   - CAMPOS_GM: cada ajuste do Estúdio GM (onde mora no objeto `custom`, tipo, faixa, rótulo). O PC desenha um campo de
//     texto, cor, lista, faixa ou caixa; o VR desenha ◀ ▶ (texto, cor, lista), − + (faixa) ou um botão (caixa). As faixas
//     são as mesmas que o servidor aceita (o teste tests/futebol-painel.test.js confere com limparCustomFutebol).
import { PADROES_CAMISA, PADROES_BANDEIRA, ESTILOS_BOLA, customFutebolPadrao } from '../../shared/espacos.js';

export const TEMPOS_PARTIDA = Object.freeze([[0, 'Sem tempo'], [180, '3 min'], [300, '5 min'], [600, '10 min']]);
export const METAS_PARTIDA = Object.freeze([[0, 'Só tempo'], [3, '3 gols'], [5, '5 gols'], [10, '10 gols']]);
export const META_MAX = 30;                       // o servidor aceita 0–30 (server/bola.js → numInt)
export const ROBOS_LINHA = Object.freeze([0, 1, 2, 3]);

export const textoMeta = (n) => ((n | 0) <= 0 ? 'Só tempo' : `${n | 0} ${(n | 0) === 1 ? 'gol' : 'gols'}`);
export const proximaMeta = (n, dir) => Math.max(0, Math.min(META_MAX, (n | 0) + (dir < 0 ? -1 : 1)));
export const textoTempo = (seg) => {
  const s = Math.max(0, Math.ceil(Number(seg) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// As mensagens do painel (as mesmas para o PC e o VR; game/bola.js manda, server/bola.js → painel e world.js → 'gm'
// recebem). Testadas contra o servidor de verdade em tests/futebol-painel.test.js.
export const MSG_FUT = Object.freeze({
  time: (t) => ({ t: 'fut', op: 'time', time: t === 0 || t === 1 ? t : -1 }),
  partida: (estado) => ({ t: 'fut', op: estado === 'jogo' ? 'parar' : 'comecar' }),
  zerar: () => ({ t: 'fut', op: 'zerar' }),
  meta: (n) => ({ t: 'fut', op: 'meta', n: Math.max(0, Math.min(META_MAX, n | 0)) }),
  tempo: (seg) => ({ t: 'fut', op: 'tempo', seg: Math.max(0, seg | 0) }),
  robos: (r, mudar) => ({ t: 'fut', op: 'robos', linha: r?.linha | 0, goleiro: !!r?.goleiro, juiz: !!r?.juiz, ...mudar }),
  gm: (ativo) => ({ t: 'gm', ativo: !!ativo }),
  perfil: (o) => ({ t: 'fut', op: 'perfil', ...o }),
  custom: (c) => ({ t: 'fut', op: 'custom', custom: c }),
});

// Presets de 1 clique do Estúdio GM (aplicam ao vivo).
export const PRESETS_GM = Object.freeze([
  {
    id: 'classico', nome: 'Clássico',
    cfg: {
      times: [
        { nome: 'Azul', cor: '#2f6fd6', cor2: '#ffffff', padrao: 'liso', bandeira: 'faixas', torcida: 1 },
        { nome: 'Vermelho', cor: '#d63a2f', cor2: '#ffd23a', padrao: 'listras', bandeira: 'cruz', torcida: 1 },
      ],
      bola: { estilo: 'classica', quique: 0.55, escala: 1 },
      juiz: { cor: '#18181b', rigor: 5 },
      goleiro: { corA: '#ffd23a', corB: '#3ad66b', reflexo: 6, velocidade: 6 },
      npcs: { velocidade: 6, chute: 6, passe: 6, marcacao: 6 },
      estadio: { refletores: true, linhasHd: true, traves3d: true, arquibancadas3d: true },
    },
  },
  {
    id: 'copa-ouro', nome: 'Copa Ouro',
    cfg: {
      times: [
        { nome: 'Dourado', cor: '#d99b1e', cor2: '#18181b', padrao: 'faixa', bandeira: 'estrela', torcida: 1.25 },
        { nome: 'Real', cor: '#1e3a8a', cor2: '#facc15', padrao: 'bicolor', bandeira: 'chevron', torcida: 1.25 },
      ],
      bola: { estilo: 'ouro', quique: 0.6, escala: 1.05 },
      juiz: { cor: '#0f172a', rigor: 7 },
      goleiro: { corA: '#f97316', corB: '#38bdf8', reflexo: 8, velocidade: 8 },
      npcs: { velocidade: 8, chute: 8, passe: 8, marcacao: 7 },
      estadio: { refletores: true, linhasHd: true, traves3d: true, arquibancadas3d: true },
    },
  },
  {
    id: 'noturno-neon', nome: 'Noturno Neon',
    cfg: {
      times: [
        { nome: 'Ciano', cor: '#06b6d4', cor2: '#0f172a', padrao: 'listras', bandeira: 'chevron', torcida: 1.25 },
        { nome: 'Magenta', cor: '#ec4899', cor2: '#1e1b4b', padrao: 'faixa', bandeira: 'estrela', torcida: 1.25 },
      ],
      bola: { estilo: 'neon', quique: 0.65, escala: 1.05 },
      juiz: { cor: '#facc15', rigor: 6 },
      goleiro: { corA: '#a855f7', corB: '#22c55e', reflexo: 8, velocidade: 7 },
      npcs: { velocidade: 8, chute: 8, passe: 7, marcacao: 7 },
      estadio: { refletores: true, linhasHd: true, traves3d: true, arquibancadas3d: true },
    },
  },
  {
    id: 'selecao-br', nome: 'Seleção BR',
    cfg: {
      times: [
        { nome: 'Brasil', cor: '#facc15', cor2: '#16a34a', padrao: 'faixa', bandeira: 'estrela', torcida: 1.5 },
        { nome: 'Rivais', cor: '#38bdf8', cor2: '#ffffff', padrao: 'listras', bandeira: 'faixas', torcida: 1.25 },
      ],
      bola: { estilo: 'classica', quique: 0.55, escala: 1 },
      juiz: { cor: '#18181b', rigor: 6 },
      goleiro: { corA: '#16a34a', corB: '#1e3a8a', reflexo: 7, velocidade: 7 },
      npcs: { velocidade: 7, chute: 8, passe: 8, marcacao: 7 },
      estadio: { refletores: true, linhasHd: true, traves3d: true, arquibancadas3d: true },
    },
  },
]);

// O preset que está valendo no rascunho (mesma conta que o painel do PC fazia).
export function presetAtivo(custom, preset) {
  const t = custom?.times, p = preset.cfg;
  return !!(t && t[0]?.nome === p.times[0].nome && t[1]?.nome === p.times[1].nome && custom.bola?.estilo === p.bola.estilo);
}

// Cores e nomes para quem não tem seletor de cor nem teclado (VR): ◀ ▶ percorre a lista, a partir do valor de agora.
export const CORES_RAPIDAS = Object.freeze(['#2f6fd6', '#d63a2f', '#ffffff', '#18181b', '#ffd23a', '#3ad66b', '#16a34a', '#facc15',
  '#06b6d4', '#ec4899', '#a855f7', '#f97316', '#1e3a8a', '#d99b1e', '#38bdf8', '#0f172a']);
export const NOMES_RAPIDOS = Object.freeze(['Azul', 'Vermelho', 'Verde', 'Amarelo', 'Branco', 'Preto', 'Roxo', 'Laranja',
  'Dourado', 'Real', 'Brasil', 'Rivais', 'Ciano', 'Magenta']);

// Cada ajuste do Estúdio GM. `linha`: os que o PC põe lado a lado. Faixas = as de limparCustomFutebol.
const TIME = (i) => {
  const s = i === 0 ? 'time-a' : 'time-b';
  return [
    { secao: s, id: `t${i}-nome`, caminho: ['times', i, 'nome'], tipo: 'texto', rotulo: 'Nome do Time', max: 20 },
    { secao: s, id: `t${i}-cor`, caminho: ['times', i, 'cor'], tipo: 'cor', rotulo: 'Camisa', linha: `t${i}-cores` },
    { secao: s, id: `t${i}-cor2`, caminho: ['times', i, 'cor2'], tipo: 'cor', rotulo: 'Detalhe', linha: `t${i}-cores` },
    { secao: s, id: `t${i}-padrao`, caminho: ['times', i, 'padrao'], tipo: 'opcao', opcoes: PADROES_CAMISA, rotulo: 'Padrão Camisa', linha: `t${i}-padroes` },
    { secao: s, id: `t${i}-bandeira`, caminho: ['times', i, 'bandeira'], tipo: 'opcao', opcoes: PADROES_BANDEIRA, rotulo: 'Bandeira', linha: `t${i}-padroes` },
    { secao: s, id: `t${i}-torcida`, caminho: ['times', i, 'torcida'], tipo: 'faixa', min: 0, max: 1.5, passo: 0.25, fmt: 'pct', rotulo: 'Torcida' },
  ];
};
export const SECOES_GM = Object.freeze([
  { id: 'time-a', titulo: (c) => `Time A — ${c?.times?.[0]?.nome || 'Azul'}` },
  { id: 'time-b', titulo: (c) => `Time B — ${c?.times?.[1]?.nome || 'Vermelho'}` },
  { id: 'bola', titulo: () => 'Bola & Juiz' },
  { id: 'goleiros', titulo: () => 'Goleiros e Capacidades dos NPCs (1–10)' },
  { id: 'estadio', titulo: () => 'Estádio 3D' },
]);
export const CAMPOS_GM = Object.freeze([
  ...TIME(0), ...TIME(1),
  { secao: 'bola', id: 'bola-estilo', caminho: ['bola', 'estilo'], tipo: 'opcao', opcoes: ESTILOS_BOLA, rotulo: 'Estilo da Bola', linha: 'bola-juiz' },
  { secao: 'bola', id: 'juiz-cor', caminho: ['juiz', 'cor'], tipo: 'cor', rotulo: 'Uniforme Juiz', linha: 'bola-juiz' },
  { secao: 'bola', id: 'bola-quique', caminho: ['bola', 'quique'], tipo: 'faixa', min: 0.3, max: 0.85, passo: 0.05, fmt: 'pct', rotulo: 'Quique da Bola' },
  { secao: 'bola', id: 'bola-escala', caminho: ['bola', 'escala'], tipo: 'faixa', min: 0.75, max: 1.5, passo: 0.05, fmt: 'pct', rotulo: 'Tamanho da Bola' },
  { secao: 'bola', id: 'juiz-rigor', caminho: ['juiz', 'rigor'], tipo: 'faixa', min: 1, max: 10, passo: 1, fmt: 'de10', rotulo: 'Rigor do Juiz' },
  { secao: 'goleiros', id: 'gol-corA', caminho: ['goleiro', 'corA'], tipo: 'cor', rotulo: 'Goleiro A', linha: 'gol-cores' },
  { secao: 'goleiros', id: 'gol-corB', caminho: ['goleiro', 'corB'], tipo: 'cor', rotulo: 'Goleiro B', linha: 'gol-cores' },
  { secao: 'goleiros', id: 'gol-reflexo', caminho: ['goleiro', 'reflexo'], tipo: 'faixa', min: 1, max: 10, passo: 1, fmt: 'de10', rotulo: 'Reflexo do Goleiro' },
  { secao: 'goleiros', id: 'gol-vel', caminho: ['goleiro', 'velocidade'], tipo: 'faixa', min: 1, max: 10, passo: 1, fmt: 'de10', rotulo: 'Velocidade Goleiro' },
  { secao: 'goleiros', id: 'npc-vel', caminho: ['npcs', 'velocidade'], tipo: 'faixa', min: 1, max: 10, passo: 1, fmt: 'de10', rotulo: 'Velocidade NPCs' },
  { secao: 'goleiros', id: 'npc-chute', caminho: ['npcs', 'chute'], tipo: 'faixa', min: 1, max: 10, passo: 1, fmt: 'de10', rotulo: 'Chute dos NPCs' },
  { secao: 'goleiros', id: 'npc-passe', caminho: ['npcs', 'passe'], tipo: 'faixa', min: 1, max: 10, passo: 1, fmt: 'de10', rotulo: 'Passe dos NPCs' },
  { secao: 'goleiros', id: 'npc-marcacao', caminho: ['npcs', 'marcacao'], tipo: 'faixa', min: 1, max: 10, passo: 1, fmt: 'de10', rotulo: 'Marcação NPCs' },
  { secao: 'estadio', id: 'est-refletores', caminho: ['estadio', 'refletores'], tipo: 'liga', rotulo: 'Torres de refletores noturnos' },
  { secao: 'estadio', id: 'est-linhas', caminho: ['estadio', 'linhasHd'], tipo: 'liga', rotulo: 'Pintura HD do gramado e linhas' },
  { secao: 'estadio', id: 'est-traves', caminho: ['estadio', 'traves3d'], tipo: 'liga', rotulo: 'Traves 3D e rede física' },
  { secao: 'estadio', id: 'est-arquibancadas', caminho: ['estadio', 'arquibancadas3d'], tipo: 'liga', rotulo: 'Arquibancadas 3D sentáveis' },
]);
export const CAMPO_GM = Object.freeze(Object.fromEntries(CAMPOS_GM.map((c) => [c.id, c])));

const PADRAO = customFutebolPadrao();
const noCaminho = (o, caminho) => caminho.reduce((a, k) => (a == null ? undefined : a[k]), o);

// Valor do ajuste no rascunho (o padrão quando falta, como o painel do PC fazia com `?? 5`).
export function lerCampo(custom, campo) {
  const v = noCaminho(custom, campo.caminho);
  if (campo.tipo === 'liga') return v !== false;
  return v ?? noCaminho(PADRAO, campo.caminho);
}

// Escreve no rascunho já dentro do que o servidor aceita (o servidor confere de novo ao receber).
export function gravarCampo(custom, campo, valor) {
  const c = campo.caminho;
  let alvo = custom;
  for (let i = 0; i < c.length - 1; i++) { if (alvo[c[i]] == null) alvo[c[i]] = typeof c[i + 1] === 'number' ? [] : {}; alvo = alvo[c[i]]; }
  const k = c[c.length - 1];
  if (campo.tipo === 'faixa') {
    const n = Number(valor);
    if (!Number.isFinite(n)) return false;
    const passos = Math.round((Math.max(campo.min, Math.min(campo.max, n)) - campo.min) / campo.passo);
    alvo[k] = Math.round((campo.min + passos * campo.passo) * 1000) / 1000;
  } else if (campo.tipo === 'cor') {
    if (typeof valor !== 'string' || !/^#[0-9a-f]{6}$/i.test(valor)) return false;
    alvo[k] = valor.toLowerCase();
  } else if (campo.tipo === 'opcao') {
    if (!campo.opcoes.includes(valor)) return false;
    alvo[k] = valor;
  } else if (campo.tipo === 'texto') {
    alvo[k] = String(valor).slice(0, campo.max || 20);
  } else if (campo.tipo === 'liga') alvo[k] = !!valor;
  return true;
}

// Um passo para um lado (VR: − + nas faixas, ◀ ▶ nas listas, cores e nomes). Devolve o valor novo, já gravado.
export function passoCampo(custom, campo, dir) {
  const d = dir < 0 ? -1 : 1, v = lerCampo(custom, campo);
  let novo = v;
  if (campo.tipo === 'faixa') novo = v + d * campo.passo;
  else if (campo.tipo === 'liga') novo = !v;
  else {
    const lista = campo.tipo === 'opcao' ? campo.opcoes : campo.tipo === 'cor' ? CORES_RAPIDAS : NOMES_RAPIDOS;
    const cmp = (a) => (campo.tipo === 'cor' ? String(a).toLowerCase() === String(v).toLowerCase() : a === v);
    const i = lista.findIndex(cmp);
    novo = i < 0 ? lista[d > 0 ? 0 : lista.length - 1] : lista[(i + d + lista.length) % lista.length];
  }
  gravarCampo(custom, campo, novo);
  return lerCampo(custom, campo);
}

export function textoCampo(campo, v) {
  if (campo.tipo === 'faixa') return campo.fmt === 'pct' ? `${Math.round(v * 100)}%` : `${v}/10`;
  if (campo.tipo === 'liga') return v ? 'ligado' : 'desligado';
  return String(v);
}

// Os ajustes de uma seção, agrupados por linha (o PC põe os de mesma `linha` lado a lado).
export function linhasDaSecao(secao) {
  const out = [];
  for (const c of CAMPOS_GM) {
    if (c.secao !== secao) continue;
    const ult = out[out.length - 1];
    if (c.linha && ult && ult[0].linha === c.linha) ult.push(c);
    else out.push([c]);
  }
  return out;
}
