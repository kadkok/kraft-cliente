// LAVRA — o convívio com os bichos no modo sobrevivência (pedido do Kadmus, 19/11/2026: "interações que um jogador em
// modo sobrevivência pode ter com eles: amizade doméstica ou doma, predação para alimento, equitação, gado,
// adestramento…"). Regras puras: o servidor aplica (server/fauna.js, server/equinos.js), o aparelho mostra.
//
//   AMIZADE   todo bicho guarda quanto confia em cada pessoa (−1…1). Sobe ficando por perto sem assustar, com
//             carinho aceito e com comida da mão (a comida certa para a espécie); cai com pancada e perseguição.
//   DOMA      quem pode ser amansado (DOMA) vira "seu" quando a confiança passa do limiar e ele come da sua mão:
//             ganha dono, nome, obedece a ordens e deixa o bando selvagem. Lobo só criado desde filhote. Zebra,
//             cervo, leão, urso… nunca: no máximo se acostumam com você.
//   GADO      vaca e cabra com cria dão leite; galinha põe ovo; todos dão carne e couro no abate; criam entre si.
//   ORDENS    seguir, ficar; o lobo criado também guarda e ataca. A obediência se aprende: repetição e recompensa.
//   MONTARIA  cavalo, dromedário e camelo. Em pelo dá para andar; galopar e saltar sem sela derruba. Sela = 5 couros.
//   CAÇA      golpe tira vida do bicho conforme a arma; ferida de lâmina sangra; bicho que não viu você leva o dobro.
//             A carcaça rende carne, couro, penas e ossos conforme o porte; bicho grande pede lâmina para cortar.
import { ESPECIES } from './especies.js';
import { rand01 } from './nature.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const massaMedia = (e) => (e.massa[0] + e.massa[1]) / 2;

// ---- quem é o quê para gente ----------------------------------------------------------------------------------------
// doma: 3 doméstico (amansa fácil) · 2 amansa com paciência · 1 só criado desde filhote · ausente = nunca
// uso: montaria | gado | companheiro · ordens que aprende · da: o que dá em vida
export const RELACAO = {
  cavalo: { doma: 2, uso: 'montaria', ordens: ['seguir', 'ficar'] },
  dromedario: { doma: 2, uso: 'montaria', ordens: ['seguir', 'ficar'] },
  camelo: { doma: 2, uso: 'montaria', ordens: ['seguir', 'ficar'] },
  gado: { doma: 3, uso: 'gado', ordens: ['seguir', 'ficar'], da: ['leite'] },
  cabra: { doma: 3, uso: 'gado', ordens: ['seguir', 'ficar'], da: ['leite'] },
  porco: { doma: 2, uso: 'gado', ordens: ['seguir', 'ficar'] },
  galinha: { doma: 3, uso: 'gado', ordens: ['seguir', 'ficar'], da: ['ovo'] },
  gato: { doma: 2, uso: 'companheiro', ordens: ['seguir', 'ficar'] },
  lobo: { doma: 1, uso: 'companheiro', ordens: ['seguir', 'ficar', 'guardar', 'atacar'] },
  coelho: { doma: 2, uso: 'companheiro', ordens: ['seguir', 'ficar'] },
  esquilo: { doma: 2, uso: 'companheiro', ordens: ['seguir', 'ficar'] },
  corvo: { doma: 2, uso: 'companheiro', ordens: ['seguir', 'ficar'] },
  gralha: { doma: 2, uso: 'companheiro', ordens: ['seguir', 'ficar'] },
};
export const LIMIAR_DOMA = { 3: 0.45, 2: 0.7, 1: 0.8 };
export const relacaoDe = (especie) => RELACAO[especie] || null;
export const NOME_ORDEM = { seguir: 'seguir você', ficar: 'ficar aqui', guardar: 'guardar o lugar', atacar: 'atacar o que você mirar', livre: 'ficar à vontade' };

// ---- comida da mão -----------------------------------------------------------------------------------------------------
// Classe de comida do que se tem na mão: 'pasto' (capim, flor, junco, folha), 'carne', 'peixe', 'ovo', 'leite' ou null.
export function classeComida(b, s, B, objDe) {
  const o = objDe ? objDe(b, s) : null;
  if (o) return o.tipo || null;
  if (!B || s) return null;
  return b === B.TALL_GRASS || b === B.FERN || b === B.REEDS || b === B.LEAVES || b === B.FLOWER_YELLOW || b === B.FLOWER_RED || b === B.FLOWER_BLUE || b === B.FLOWER_WHITE ? 'pasto' : null;
}
// O que cada dieta aceita da mão.
const ACEITA = { herbivoro: ['pasto'], onivoro: ['pasto', 'carne', 'peixe', 'ovo'], carnivoro: ['carne', 'peixe'], piscivoro: ['peixe'], insetivoro: [] };
export function comeDaMao(especie, classe) {
  const e = ESPECIES[especie];
  if (!e || !classe) return false;
  if (especie === 'gato') return classe === 'peixe' || classe === 'carne' || classe === 'leite';
  if (especie === 'galinha') return classe === 'pasto';                        // grão, semente, verdura
  return (ACEITA[e.dieta] || []).includes(classe);
}
export const comidaPreferida = (especie) => { const e = ESPECIES[especie]; return especie === 'gato' ? 'peixe ou carne' : !e ? '' : e.dieta === 'herbivoro' ? 'capim, flor ou junco' : e.dieta === 'onivoro' ? 'capim, flor, carne ou ovo' : e.dieta === 'carnivoro' ? 'carne ou peixe' : e.dieta === 'piscivoro' ? 'peixe' : ''; };

// ---- doma ----------------------------------------------------------------------------------------------------------------
// c = o bicho (animais.js ou equino.js: os dois guardam confianca, docilidade, idade). maturidade em dias.
export function podeDomar(especie, c, maturidade) {
  const r = RELACAO[especie];
  if (!r || !r.doma) return false;
  if (r.doma === 1) return c.idade < maturidade * 0.7 || !!c.criadoPor;      // lobo: só o filhote (ou o que já foi criado por gente)
  return true;
}
export function limiarDoma(especie, c) { const r = RELACAO[especie]; return r ? LIMIAR_DOMA[r.doma] - (c.docilidade - 0.5) * 0.15 : 9; }
// Quanto a confiança muda em cada gesto (o bicho com fome se afeiçoa mais a quem dá de comer).
export const GANHO = { comer: (c) => 0.1 + 0.1 * clamp01(c.fome), carinho: 0.06, presenca: 0.0015, pancada: -0.25, susto: -0.05 };
// Depois de comer da mão: passou do limiar e pode ser amansado? Devolve true se virou de alguém.
export function tentarDomar(especie, c, chave, maturidade) {
  if (c.dono || !chave || !podeDomar(especie, c, maturidade)) return false;
  if ((c.confianca[chave] || 0) < limiarDoma(especie, c)) return false;
  c.dono = chave; c.ordem = 'livre'; c.treino = c.treino || {};
  c.docilidade = Math.max(c.docilidade, 0.7); c.medo = 0;
  return true;
}
// Como está a relação com esta pessoa, em palavras (para a dica na tela).
export function humor(especie, c, chave) {
  const conf = chave ? c.confianca?.[chave] || 0 : 0;
  if (c.dono) return c.dono === chave ? 'seu' : 'tem dono';
  if (conf < -0.2) return 'com medo de você';
  if (conf < 0.15) return 'arisco';
  if (conf < 0.4) return 'desconfiado';
  if (conf < limiarDoma(especie, c)) return 'acostumado com você';
  return RELACAO[especie]?.doma ? 'quase manso' : 'manso com você';
}

// ---- ordens (adestramento) -----------------------------------------------------------------------------------------------
// Obedece? No começo nem sempre: cada ordem se aprende. u = sorteio 0..1. Devolve true se obedeceu (e aprende um pouco).
export function obedece(c, ordem, u) {
  c.treino = c.treino || {};
  const t = c.treino[ordem] || 0, chance = ordem === 'livre' ? 1 : 0.4 + 0.6 * t;
  const ok = u < chance;
  if (ok) c.treino[ordem] = clamp01(t + 0.1);
  return ok;
}
// Recompensa logo depois de obedecer (comida da mão em até 10 s): fixa o aprendizado.
export function recompensa(c, agora) { if (c.obedeceu && agora - c.obedeceu.t < 10) { c.treino[c.obedeceu.o] = clamp01((c.treino[c.obedeceu.o] || 0) + 0.2); c.obedeceu = null; return true; } return false; }
export const nivelTreino = (c, ordem) => Math.round(100 * (c.treino?.[ordem] || 0));

// ---- o que o bicho dá em vida ----------------------------------------------------------------------------------------------
export const LEITE_CADA = 600, OVO_CADA = 720;     // segundos de verdade entre uma ordenha e outra, e entre um ovo e outro
// Pode ordenhar agora? Devolve '' (pode) ou o motivo.
export function semLeite(especie, c, agora, adulto) {
  if (!RELACAO[especie]?.da?.includes('leite')) return 'não dá leite';
  if (c.sexo !== 'F' || !adulto) return 'só a fêmea adulta dá leite';
  if (!(c.lactacao > 0)) return 'só dá leite a que teve cria';
  if (agora - (c.leiteEm || -1e9) < LEITE_CADA) return 'já foi ordenhada há pouco';
  return '';
}

// ---- caça: vida do bicho, dano da arma, rendimento da carcaça ----------------------------------------------------------------
// Pontos de vida pelo porte (a pessoa tem 20): coelho 3, galinha 4, lobo 14, cabra 17, cervo 27, leão 28, urso 34,
// cavalo 48, boi 60, hipopótamo 88, elefante 148.
export const vidaDoBicho = (especie, massa) => Math.max(1, Math.round(2.2 * Math.sqrt(Math.max(0.05, massa ?? massaMedia(ESPECIES[especie])))));
// Um golpe: arma = { dano, corta }. ctx = { desprevenido (não viu quem bateu: dormindo, pastando de costas), cabeca }.
// Devolve { dano (pontos de vida), fracao (da saúde 0..1), sangra (pontos por segundo, por SANGRA_S segundos) }.
export const SANGRA_S = 40;
export function golpeNoBicho(especie, massa, arma, ctx = {}) {
  const vida = vidaDoBicho(especie, massa);
  const dano = arma.dano * (ctx.desprevenido ? 2.5 : 1);
  return { dano, vida, fracao: dano / vida, sangra: arma.corta ? (dano * 0.9) / SANGRA_S : 0, critico: !!ctx.desprevenido };
}
// O que a carcaça rende: [[objeto, quantos], …]. carneKg = carne que sobrou nela (o que os bichos comeram não volta).
export function rendimento(especie, massa, carneKg) {
  const e = ESPECIES[especie], out = [];
  if (!e) return out;
  const m = massa ?? massaMedia(e), kg = carneKg ?? m * 0.6;
  if (e.classe === 'invertebrado') return out;
  const porcoes = Math.max(1, Math.min(24, Math.round(2.2 * Math.log2(1 + kg / 1.5))));
  if (kg >= 0.25) out.push([e.classe === 'peixe' ? 'peixe_cru' : e.classe === 'ave' ? 'ave_crua' : 'carne_crua', porcoes]);
  if (e.classe === 'mamifero' && m >= 15) out.push(['couro', Math.max(1, Math.min(5, Math.round(Math.log10(m) * 1.6 - 0.9)))]);
  if (e.classe === 'reptil' && m >= 40) out.push(['couro', Math.max(1, Math.min(4, Math.round(Math.log10(m))))]);
  if (e.classe === 'ave') out.push(['pena', Math.max(1, Math.min(8, Math.round(1 + Math.log2(1 + m) * 1.6)))]);
  if (m >= 4 && e.classe !== 'peixe') out.push(['osso', Math.max(1, Math.min(4, Math.round(Math.log10(m) + 0.4)))]);
  return out;
}
// Carcaça de bicho com mais de 5 kg pede lâmina (faca, lança) para esfolar e cortar.
export const pedeLamina = (especie, massa) => (massa ?? massaMedia(ESPECIES[especie])) > 5;

// ---- montaria ---------------------------------------------------------------------------------------------------------------
// Quem se monta, a altura da sela (fração da altura do bicho) e as marchas (m/s) vêm da ficha.
export function montaria(especie) {
  const r = RELACAO[especie], e = ESPECIES[especie];
  if (!r || r.uso !== 'montaria' || !e) return null;
  return { passo: e.vel[0], trote: e.vel[1], galope: e.vel[2] * 0.92, assento: especie === 'cavalo' ? 0.39 : 0.86, salto: e.salto };
}
// Sem sela: galope e salto derrubam (chance por segundo de galope; no salto, na hora).
export const QUEDA_EM_PELO = { galope: 0.12, salto: 0.5 };
export function caiEmPelo(sela, marcha, u, dt = 1) { if (sela) return false; return marcha === 'salto' ? u < QUEDA_EM_PELO.salto : marcha === 'galope' ? u < QUEDA_EM_PELO.galope * dt : false; }

// ---- fome de quem joga (sobrevivência) ---------------------------------------------------------------------------------------
// A barra vai de 0 a 20. Parado gasta 1 ponto a cada FOME_S segundos; andar, correr, nadar e pular gastam mais.
export const FOME_MAX = 20, FOME_S = 150;
export function gastoDeFome(vel, nadando, dt) { return (dt / FOME_S) * (1 + (vel > 4.5 ? 1.6 : vel > 1 ? 0.5 : 0) + (nadando ? 1 : 0)); }
// Come um objeto: devolve { fome (nova), enjoo (segundos passando mal) }. u = sorteio.
export function comer(fome, come, u) { return { fome: Math.min(FOME_MAX, fome + come.fome), enjoo: come.risco && u < come.risco ? 20 : 0, cura: !!come.cura }; }
export const sorteio = (seed, a, b) => rand01(seed, a, b);
