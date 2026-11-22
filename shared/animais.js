// LAVRA — o motor dos bichos (pedido do Kadmus, 17/11/2026: todos os animais com hábitos, ciclo da vida e física de
// verdade). Generaliza shared/equino.js: o que lá era número do cavalo aqui vem da ficha da espécie (shared/especies.js).
// Código puro e determinístico (servidor, cliente e testes). O cavalo segue no equino.js até migrar.
//
//   · necessidades no ritmo do corpo: quem pesa menos come, bebe e excreta mais vezes (lei de Kleiber, massa^-¼);
//     carnívoro come pouco e caça; herbívoro pasta; ruminante deita para ruminar;
//   · sono pela hora de atividade (diurno dorme de noite, noturno de dia, crepuscular no meio do dia e da noite);
//   · reprodução pela estação do lugar do mundo, gestação/incubação e ninhada da ficha; de ovos e desovas só sobrevivem
//     poucos (como na natureza);
//   · sentidos e juízo como no cavalo, com a cadeia alimentar: predador da ficha é ameaça; presa, comida;
//   · tempo: `ritmo.rotina` (necessidades) e `ritmo.vida` (idade e reprodução), iguais aos do cavalo.
import { rand01, hash32 } from './nature.js';
import { ESPECIES, CACA } from './especies.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DIA = 86400;
export const RITMO_ANIMAL = { rotina: 12, vida: 120 };

export const ACOES_ANIMAL = ['parado', 'andar', 'trotar', 'correr', 'pastar', 'beber', 'deitar', 'dormir', 'urinar', 'defecar',
  'atacar', 'chamar', 'alerta', 'cheirar', 'mamar', 'cortejar', 'acasalar', 'parir', 'levantar', 'nadar', 'voar', 'pousar',
  'cacar', 'comer', 'ruminar', 'subir', 'limpar', 'pular', 'morto', 'fugir'];
export const ACAO_ANIMAL = Object.fromEntries(ACOES_ANIMAL.map((n, i) => [n, i]));
const FIRMES = new Set(['urinar', 'defecar', 'atacar', 'chamar', 'cheirar', 'mamar', 'acasalar', 'parir', 'levantar', 'deitar', 'comer', 'limpar', 'pular']);
const DURACAO = { urinar: [6, 14], defecar: [4, 8], beber: [15, 40], atacar: [1.2, 2], chamar: [2, 4], cheirar: [2, 5], mamar: [15, 35],
  cortejar: [6, 14], acasalar: [6, 14], parir: [40, 90], levantar: [2, 3], deitar: [2, 3], comer: [20, 60], limpar: [4, 10], pular: [1, 1.5] };
const RUMINANTES = new Set(['cabra', 'gado', 'cervo', 'caribu', 'alce', 'impala', 'gnu', 'girafa', 'dromedario', 'camelo']);

export const esp = (c) => ESPECIES[c.especie];
export const adultoA = (c) => c.idade >= esp(c).vida[0];
export const filhoteA = (c) => c.idade < esp(c).vida[0] * 0.35;
export function crescimentoA(c) { const e = esp(c), a = Math.min(1, c.idade / e.vida[0]); const ini = e.classe === 'mamifero' ? 0.35 : 0.2; return ini + (1 - ini) * (1 - (1 - a) ** 2); }
export const anosA = (c) => c.idade / 365;
export function faseA(c) { const e = esp(c); return c.morto ? 'morto' : filhoteA(c) ? 'filhote' : !adultoA(c) ? 'jovem' : anosA(c) > e.vida[4] * 0.75 ? 'idoso' : 'adulto'; }
// fator de metabolismo (1 = cavalo de 450 kg)
export const metabolismo = (e) => Math.min(6, Math.pow(Math.max(0.0005, (e.massa[0] + e.massa[1]) / 2) / 450, -0.25));
// a espécie está na estação de reprodução? (mês 0–11 e latitude do lugar do mundo)
export function naEstacao(e, mes, lat = -20) {
  const sul = lat < 0, m = sul ? (mes + 6) % 12 : mes;      // m no calendário do norte
  switch (e.estacao) { case 'primavera': return m >= 2 && m <= 5; case 'inverno': return m >= 9 || m <= 1; case 'chuvas': return lat < 0 ? (mes >= 10 || mes <= 2) : (mes >= 5 && mes <= 8); default: return true; }
}
export const MARCHA_DE = (e) => ({ passo: e.vel[0], trote: e.vel[1], corrida: e.vel[2] });

// ---- energia, como no mundo real ----------------------------------------------------------------------------------
// Gasto diário = taxa metabólica de campo (Kleiber: 70·M^0,75 kcal/dia vezes um fator da classe: endotérmico gasta
// muito, réptil/peixe pouco). Presa vale a parte comestível vezes as calorias por kg. O estômago tem limite e a reserva
// (gordura) dura dias: leão ~9, ave pequena horas, réptil meses. Fome = o quanto falta na reserva (e o estômago cheio
// acalma). Só quem vive de caçar (carnívoro e piscívoro) usa este balanço; herbívoro, onívoro e insetívoro pastam e
// forrageiam pela rotina (o mato não acaba), mas carniceiro come carcaça quando acha.
const K_FMR = { mamifero: 2.6, ave: 3.6, reptil: 0.25, anfibio: 0.2, peixe: 0.3, invertebrado: 0.6 };
const KCAL_KG = { peixe: 1000, invertebrado: 1200 }, COMESTIVEL = { mamifero: 0.6, ave: 0.65, reptil: 0.55, anfibio: 0.5, peixe: 0.65, invertebrado: 0.8 };
const ESTOMAGO = { mamifero: 0.15, ave: 0.12, reptil: 0.5, anfibio: 0.3, peixe: 0.15, invertebrado: 0.3 };
export const massaMedia = (e) => (e.massa[0] + e.massa[1]) / 2;
export const massaDe = (c) => { const e = esp(c); return (c.sexo === 'M' ? e.massa[0] : e.massa[1]) * Math.pow(crescimentoA(c), 3); };
export const kcalDia = (e, m = massaMedia(e)) => K_FMR[e.classe] * 70 * Math.pow(Math.max(1e-6, m), 0.75);
export const kcalPorKg = (e) => KCAL_KG[e.classe] || 1300;
export const carneDe = (c) => massaDe(c) * (COMESTIVEL[esp(c).classe] || 0.6);          // kg comestíveis do corpo
export const estomagoKg = (c) => massaDe(c) * (c.especie === 'komodo' ? 0.8 : ESTOMAGO[esp(c).classe] || 0.15);
export function diasDeReserva(e) { const m = massaMedia(e); return e.classe === 'mamifero' ? 2 + 3 * Math.log10(m + 1) : e.classe === 'ave' ? 0.5 + 1.5 * Math.log10(m + 1) : e.classe === 'reptil' ? 60 : e.classe === 'anfibio' ? 30 : e.classe === 'peixe' ? 20 : 7; }
export const caca = (c) => esp(c).dieta === 'carnivoro' || esp(c).dieta === 'piscivoro';
export const reservaMax = (c) => kcalDia(esp(c), massaDe(c)) * diasDeReserva(esp(c));

// Chance de captura numa tentativa: a taxa medida da espécie, corrigida por velocidade (com cansaço), presa fraca
// (filhote, velha, ferida), caça em grupo, emboscada (de perto dá certo, de longe quase nunca), vigilância do grupo da
// presa (muitos olhos), presa já assustada, noite para o noturno e presa grande demais.
// ctx = { aliados, distInicio, grupoPresa, noite }
// predadores vorazes e ferozes (18/11): caçam com pouca fome e a chance de cada bote é FEROZ × a taxa de sucesso real
export const FOME_CACA_A = 0.22, FEROZ = Number(globalThis.process?.env?.LAVRA_FEROZ || 1.6);
export function chanceCaptura(pred, presa, ctx = {}) {
  const ep = esp(pred), eq = esp(presa), C = CACA[pred.especie] || { sucesso: 0.2 };
  let p = C.sucesso;
  const fraca = filhoteA(presa) || anosA(presa) > eq.vida[4] * 0.75 || presa.saude < 0.6;
  const vPred = ep.vel[2] * (1 - pred.fadiga * 0.6), vPresa = eq.vel[2] * (1 - presa.fadiga * 0.6) * (fraca ? 0.65 : 1);
  p *= Math.min(2, Math.max(0.25, Math.pow(vPred / Math.max(0.05, vPresa), 1.2)));
  if (fraca) p *= 1.6;
  if (C.grupo && ctx.aliados > 0) p *= 1 + Math.min(0.5, ctx.aliados * 0.12);
  if (C.emboscada) p *= (ctx.distInicio ?? 99) < 6 ? 1.5 : 0.5;
  p /= 1 + 0.04 * (ctx.grupoPresa || 0);
  if (presa.medo > 0.6) p *= 0.7;
  if (ctx.noite && ep.ativo === 'noturno') p *= 1.2;
  const rel = massaDe(presa) / Math.max(1e-6, massaDe(pred));
  if (rel > 1.5) p *= Math.max(0.15, 1.5 / rel);
  return Math.max(0.01, Math.min(0.9, p * FEROZ));
}
// Quanto vale caçar esta presa: energia que dá para comer (até encher o estômago) × chance ÷ risco de se ferir.
export function valorDaPresa(pred, presa, p) {
  const eq = esp(presa), kg = Math.min(carneDe(presa), estomagoKg(pred) * 1.2), rel = massaDe(presa) / Math.max(1e-6, massaDe(pred));
  return kg * kcalPorKg(eq) * p / (1 + Math.max(0, rel - 0.5) * 1.5 + eq.perigo);
}

// Um bicho novo da espécie. o = { sexo, idadeDias, mae, pai, id }
export function novoAnimal(especie, seed, o = {}) {
  const e = ESPECIES[especie];
  if (!e) throw new Error('espécie desconhecida: ' + especie);
  const u = (k) => rand01(seed, 9101, k);
  const sexo = o.sexo === 'M' || o.sexo === 'F' ? o.sexo : u(1) < 0.5 ? 'M' : 'F';
  const macho = sexo === 'M';
  const idade = Number.isFinite(o.idadeDias) ? o.idadeDias : e.vida[0] * (1 + u(2) * 2.5);
  const vida = e.vida[4] * 365;
  return {
    especie, id: o.id ?? (seed >>> 0), sexo, idade,
    ousadia: clamp01(e.ousadia * 0.7 + u(4) * 0.3 + (macho ? 0.08 : 0)), docilidade: clamp01(0.2 + u(5) * 0.6),
    curiosidade: clamp01(0.15 + u(6) * 0.7), sociavel: clamp01(e.social === 'solitario' ? 0.1 + u(7) * 0.3 : 0.5 + u(7) * 0.5),
    fome: 0.2 + u(8) * 0.3, sede: 0.1 + u(9) * 0.4, bexiga: u(10) * 0.7, intestino: u(11) * 0.8, sono: u(12) * 0.5,
    fadiga: 0, medo: 0, saude: 1, cio: u(14) * 21, prenhe: null, lactacao: 0, mae: o.mae ?? null, pai: o.pai ?? null,
    vidaMax: vida * (0.75 + u(15) * 0.35), confianca: {}, costume: {}, ato: { a: 'parado', ate: 0, alvo: null, vel: 0, olhar: null, de: 0 },
    alarme: null, presa: null, ev: 0, morto: false, causa: null, reserva: null, estomago: 0, descansoCaca: 0,
  };
}

// ---- fisiologia --------------------------------------------------------------------------------------------------
// ctx: { calor, hora, noite, mes, lat, velocidade, agora, molhado }  · devolve eventos: 'cio', 'parto', 'velhice', 'fome', 'sede'
export function passoAnimal(c, ctx, dt, ritmo = RITMO_ANIMAL) {
  if (c.morto || !(dt > 0)) return [];
  const e = esp(c), out = [];
  const kd = (ritmo.rotina / DIA) * dt * metabolismo(e), kv = (ritmo.vida / DIA) * dt;
  const a = c.ato.a, carn = caca(c), v = ctx.velocidade || 0;
  const aquatico = e.meio === 'agua';
  if (carn && !filhoteA(c)) {
    // balanço de energia (kd já tem o metabolismo; aqui as contas são em kcal e dias de bicho)
    const dias = (ritmo.rotina / DIA) * dt, R = reservaMax(c);
    if (c.reserva === null || c.reserva === undefined) c.reserva = R * (0.5 + rand01(c.id, 3, 1) * 0.4);
    const gasto = kcalDia(e, massaDe(c)) * dias * (1 + 2 * Math.min(1, (v / Math.max(0.1, e.vel[2])) ** 2));
    const digere = Math.min(c.estomago, kcalPorKg(e) * estomagoKg(c) * dias * 1.5);
    c.estomago -= digere; c.reserva = Math.min(R, c.reserva + digere - gasto);
    const cheio = c.estomago / Math.max(1, kcalPorKg(e) * estomagoKg(c));
    c.fome = clamp01(1 - c.reserva / R - cheio * 0.5);
    if (c.reserva <= 0) { c.reserva = 0; c.fome = 1; }
  } else c.fome = clamp01(c.fome + kd * (carn ? 0.9 : 1.6) - (a === 'pastar' ? kd * 2.6 : 0) - (a === 'comer' ? dt / 40 : 0) - (a === 'mamar' ? kd * 9 : 0));
  if (!aquatico) {
    c.sede = clamp01(c.sede + kd * 2.6 * (1 + (ctx.calor || 0.4) * 0.6 + c.fadiga * 0.8) - (a === 'beber' ? dt / 30 : 0) - (ctx.molhado ? kd * 3 : 0) - ((ctx.chuva || 0) > 0.2 ? kd * 4 : 0));
    // sem água doce ao alcance (território seco), o bicho tira a água do orvalho, da chuva e do que come: passa sede,
    // mas não morre dela. Com água por perto ele vai beber antes disso.
    if (ctx.semAgua && c.sede > 0.8) c.sede = 0.8;
  } else c.sede = 0;
  if (e.classe === 'mamifero' && !aquatico) {
    c.bexiga = clamp01(c.bexiga + kd * 6 + (a === 'beber' ? dt / 500 : 0) - (a === 'urinar' ? dt / 8 : 0));
    c.intestino = clamp01(c.intestino + kd * (carn ? 2 : 8) * (1 + c.medo * 2) - (a === 'defecar' ? dt / 5 : 0));
  } else { c.bexiga = 0; c.intestino = clamp01(c.intestino + kd * 4 - (a === 'defecar' ? dt / 3 : 0)); }
  // sono: a pressão sobe acordado; sobe mais na hora em que a espécie descansa
  const hora = ctx.hora ?? 12, descanso = horaDeDescanso(e, hora);
  c.sono = clamp01(c.sono + kd * (filhoteA(c) ? 2 : 1) * (descanso ? 2.2 : 0.5) - (a === 'dormir' ? kd * 9 : 0));
  // cansaço real
  const corrida = e.vel[2], esforco = v > e.vel[1] * 1.2 ? ((v / Math.max(0.1, corrida)) ** 2) * 0.03 : 0;
  c.fadiga = clamp01(c.fadiga + esforco * dt - (v < e.vel[0] * 0.3 ? 0.015 : 0.004) * dt);
  c.medo = clamp01(c.medo - dt * (c.alarme && ctx.agora - c.alarme.t < 15 ? 0.025 : 0.07));
  if (c.medo < 0.08) c.alarme = null;
  if (c.sede >= 1 || c.fome >= 1) { c.saude = clamp01(c.saude - dt * 0.0008); if (c.saude <= 0) { c.morto = true; c.causa = c.fome >= 1 ? 'fome' : 'sede'; out.push(c.causa); } }
  else if (c.saude < 1 && c.medo < 0.2) c.saude = clamp01(c.saude + dt * 0.0005);
  for (const k in c.costume) { c.costume[k] *= Math.exp(-kd * 0.5); if (c.costume[k] < 0.02) delete c.costume[k]; }
  // vida
  c.idade += kv;
  if (c.lactacao > 0) c.lactacao = Math.max(0, c.lactacao - kv);
  if (c.sexo === 'F' && adultoA(c)) {
    const antes = emCioA(c, ctx);
    if (!c.prenhe) c.cio = (c.cio + kv) % 21;
    if (!antes && emCioA(c, ctx)) out.push('cio');
  }
  if (c.prenhe) { c.prenhe.dias += kv; if (c.prenhe.dias >= e.vida[1] && !c.prenhe.pronta) { c.prenhe.pronta = true; out.push('parto'); } }
  if (c.idade > c.vidaMax) { c.saude = clamp01(c.saude - dt * 0.002); if (c.saude <= 0 && !c.morto) { c.morto = true; c.causa = 'velhice'; out.push('velhice'); } }
  return out;
}
export function horaDeDescanso(e, h) {
  switch (e.ativo) { case 'diurno': return h < 5.5 || h > 19.5; case 'noturno': return h > 8 && h < 17; case 'crepuscular': return (h > 11 && h < 15) || h < 3; default: return h > 1 && h < 4; }
}
export const emCioA = (c, ctx = {}) => c.sexo === 'F' && adultoA(c) && !c.prenhe && naEstacao(esp(c), ctx.mes ?? 10, ctx.lat ?? -20) && (c.cio % 21) < 4;

// ---- juízo (a cadeia alimentar entra aqui) ---------------------------------------------------------------------------
// s = { tipo: 'pessoa' | 'bicho' | barulhos…, especie (se bicho), vel, aproxima, agachado, chave, forca }  p = percepção
export function julgarA(c, s, p) {
  const e = esp(c), costume = c.costume[s.tipo] || 0, conf = s.chave ? c.confianca[s.chave] || 0 : 0;
  let risco = 0, cat = 'aceitavel';
  if (s.tipo === 'bicho') {
    const o = ESPECIES[s.especie];
    if (e.predadores?.includes(s.especie)) { risco = 0.75 + (o?.ousadia || 0) * 0.2; cat = 'ameaca'; }
    else if (e.presas?.includes(s.especie)) { risco = 0; cat = 'alimento'; }
    else if (o && o.perigo > 0.5 && (o.massa[0] > e.massa[0] * 3)) { risco = 0.45; cat = 'risco'; }
    else { risco = 0.05; cat = 'aceitavel'; }
  } else if (s.tipo === 'pessoa') {
    // gente: o porte decide muito (bicho grande e perigoso não foge de gente; bicho pequeno foge de longe)
    const porte = Math.min(1, Math.pow(((e.massa[0] + e.massa[1]) / 2) / 80, 0.3));
    risco = 0.45 - porte * 0.25 + (s.vel > 3.4 ? 0.3 : 0) + clamp01((s.aproxima || 0) / 4) * 0.25 + (p.d < 4 ? 0.15 : 0) + (p.atras && p.d < 3 ? 0.3 : 0)
      - (s.agachado ? 0.12 : 0) - conf * 0.6 - costume * 0.25;
    risco = clamp01(risco * (1 - e.ousadia * 0.5));
    cat = risco > 0.6 ? 'ameaca' : risco > 0.38 ? 'risco' : conf > 0.35 ? 'amigavel' : 'aceitavel';
  } else {
    risco = clamp01(({ explosao: 0.9, tiro: 0.8, trovao: 0.5, desabamento: 0.7, quebra: p.d < 6 ? 0.25 : 0.06 }[s.tipo] ?? 0.2) + (s.forca || 0) * 0.2 - costume * 0.4) * (1 - e.ousadia * 0.3);
    cat = risco > 0.5 ? 'risco' : 'barulho';
  }
  if (filhoteA(c)) risco = Math.min(1, risco * 1.25);
  return { cat, risco };
}

// ---- reações ---------------------------------------------------------------------------------------------------------
export const REACOES_ANIMAL = {
  aproximacao: { ignorar: 'segue no que fazia, de olho', observar: 'para e encara', aproximar: 'chega perto, curioso', afastar: 'se afasta andando', fugir: 'foge correndo', ameacar: 'encara, abaixa a cabeça e avisa que vai atacar', chamar: 'chama o grupo com a voz' },
  aproximacao_rapida: { observar: 'para e encara, tenso', fugir: 'foge correndo', ameacar: 'se ergue e ameaça', atacar: 'avança e ataca', chamar: 'dá o alarme ao grupo' },
  susto_atras: { fugir: 'dispara para longe', atacar: 'reage atacando por reflexo', pular: 'salta assustado', observar: 'vira e encara' },
  toque: { aceitar: 'aceita o toque e relaxa', cheirar: 'cheira a mão', afastar: 'se esquiva', atacar: 'morde ou escoiceia' },
  oferta_comida: { comer: 'come da mão', cheirar: 'cheira, desconfiado, e não come', afastar: 'não aceita e se afasta' },
  agressao: { fugir: 'foge correndo', atacar: 'revida', ameacar: 'ameaça', chamar: 'grita de dor e chama o grupo' },
  barulho_forte: { ignorar: 'nem liga', observar: 'procura a origem', fugir: 'foge correndo', chamar: 'dá o alarme' },
  predador: { fugir: 'foge correndo', alerta: 'congela e observa o predador', chamar: 'dá o alarme ao grupo', defender: 'enfrenta o predador em grupo' },
  cortejo: { aceitar: 'aceita o macho', recusar: 'recusa e ataca', afastar: 'se afasta' },
  presa_humana: { ignorar: 'deixa a pessoa em paz', observar: 'fica olhando, avaliando', espreitar: 'segue a pessoa de longe, escondido', atacar: 'ataca a pessoa para comer' },
};
export function chancesReacaoA(c, evento, ctx = {}) {
  const e = esp(c), ous = c.ousadia, doc = c.docilidade, cur = c.curiosidade, medo = c.medo, conf = ctx.conf || 0, filhote = filhoteA(c), perig = e.perigo;
  const grupo = e.social !== 'solitario', p = {};
  switch (evento) {
    case 'aproximacao': p.ignorar = 0.2 + doc * 0.2 + conf * 0.3 + perig * 0.2; p.observar = 0.35; p.aproximar = cur * 0.3 + conf * 0.6; p.afastar = (1 - conf) * 0.3 + medo * 0.3; p.fugir = medo * 0.6 + (1 - ous) * 0.25 + (filhote ? 0.2 : 0) - conf * 0.4; p.ameacar = perig * 0.4 + ous * 0.1; p.chamar = grupo ? 0.08 : 0.01; break;
    case 'aproximacao_rapida': p.observar = 0.2 + ous * 0.2; p.fugir = 0.4 + (1 - ous) * 0.4 + medo * 0.3 - conf * 0.3; p.ameacar = perig * 0.5; p.atacar = perig * ous * 0.35; p.chamar = grupo ? 0.12 : 0.02; break;
    case 'susto_atras': p.fugir = 0.35 + (1 - ous) * 0.3; p.atacar = perig * 0.4 + (1 - doc) * 0.1; p.pular = 0.25; p.observar = 0.1 + conf * 0.5; break;
    case 'toque': p.aceitar = 0.15 + doc * 0.4 + conf * 0.8; p.cheirar = 0.2 + cur * 0.2; p.afastar = (1 - conf) * 0.35 + medo * 0.3; p.atacar = perig * 0.4 + (1 - doc) * 0.08 - conf * 0.2; break;
    case 'oferta_comida': p.comer = (e.dieta === 'herbivoro' || e.dieta === 'onivoro' ? 0.3 + c.fome * 0.6 : 0.02) + conf * 0.5; p.cheirar = 0.3; p.afastar = medo * 0.4 + (1 - conf) * 0.15; break;
    case 'agressao': p.fugir = 0.5 + (1 - ous) * 0.4 + (filhote ? 0.3 : 0); p.atacar = perig * 0.6 + ous * 0.15; p.ameacar = perig * 0.2; p.chamar = grupo ? 0.15 : 0.02; break;
    case 'barulho_forte': p.ignorar = 0.05 + (c.costume.explosao || 0) * 0.5 + perig * 0.2; p.observar = 0.25 + ous * 0.2; p.fugir = 0.4 + medo * 0.3 + (1 - ous) * 0.2; p.chamar = grupo ? 0.1 : 0.01; break;
    case 'predador': p.fugir = 0.6 + medo * 0.3 - (ctx.cercado ? 0.3 : 0); p.alerta = 0.2; p.chamar = grupo ? 0.2 : 0.01; p.defender = grupo && !filhote ? ous * 0.3 + (e.massa[0] > 200 ? 0.2 : 0) : 0.001; break;
    case 'presa_humana': { const g = (CACA[c.especie]?.gente || 0) * c.fome * c.fome; p.atacar = g; p.espreitar = g * 3; p.observar = 0.3; p.ignorar = 0.6 - g; break; }
    case 'cortejo': p.aceitar = emCioA(c, ctx) ? 0.6 : 0.02; p.recusar = emCioA(c, ctx) ? 0.15 : 0.6; p.afastar = 0.2; break;
    default: p.observar = 1;
  }
  for (const k in p) p[k] = Math.max(0.001, p[k]);
  return p;
}
export function aplicarReacaoA(c, nome, ev, eu) {
  const e = esp(c), M = MARCHA_DE(e), agora = ev.agora, pos = ev.pos || eu.pos, chave = ev.chave;
  const longe = (dist) => { const dx = eu.pos[0] - pos[0], dz = eu.pos[2] - pos[2], l = Math.hypot(dx, dz) || 1; return [eu.pos[0] + (dx / l) * dist, eu.pos[1], eu.pos[2] + (dz / l) * dist]; };
  const perto = (dist) => { const dx = pos[0] - eu.pos[0], dz = pos[2] - eu.pos[2], l = Math.hypot(dx, dz) || 1, k = Math.max(0, l - dist) / l; return [eu.pos[0] + dx * k, eu.pos[1], eu.pos[2] + dz * k]; };
  const conf = (dv) => { if (chave) c.confianca[chave] = Math.max(-1, Math.min(1, (c.confianca[chave] || 0) + dv)); };
  const dur = (a) => { const r = DURACAO[a] || [3, 5], u = rand01(ev.seed || 1, c.id, 77); return r[0] + (r[1] - r[0]) * u; };
  const set = (a, x = {}) => { c.ato = { a, de: agora, ate: agora + (x.dur ?? dur(a)), alvo: x.alvo || null, vel: x.vel || 0, olhar: x.olhar === undefined ? pos : x.olhar, motivo: ev.tipo }; return c.ato; };
  const escala = Math.max(1, Math.sqrt(e.alt) * 8);              // fuga proporcional ao porte
  switch (nome) {
    case 'ignorar': return c.ato;
    case 'observar': case 'alerta': c.medo = clamp01(c.medo + 0.1); return set('alerta', { dur: 3 + rand01(ev.seed, c.id, 3) * 5 });
    case 'aproximar': conf(0.03); return set('andar', { alvo: perto(Math.max(0.5, e.alt * 1.5)), vel: M.passo, dur: 10 });
    case 'cheirar': conf(0.02); return set('cheirar');
    case 'afastar': return set('andar', { alvo: longe(escala), vel: M.passo * 1.3, dur: 10, olhar: null });
    case 'fugir': c.medo = clamp01(Math.max(c.medo, 0.8)); conf(-0.03); c.alarme = { pos: [...pos], t: agora }; return set('fugir', { alvo: longe(escala * 5), vel: M.corrida * (1 - c.fadiga * 0.5), dur: 10, olhar: null });
    case 'ameacar': return set('chamar', { dur: 2.5 });
    case 'chamar': return set('chamar');
    case 'atacar': case 'defender': conf(-0.05); return set('atacar', { alvo: perto(0.3), vel: M.corrida * 0.8 });
    case 'pular': c.medo = clamp01(c.medo + 0.4); return set('pular', { alvo: longe(e.alt * 4), vel: M.trote });
    case 'aceitar': if (ev.tipo === 'cortejo') { c.aceitou = agora; return set('parado', { dur: 15, olhar: null }); } conf(0.08); c.medo = clamp01(c.medo - 0.2); return set('parado', { dur: 6 });
    case 'comer': conf(0.12); c.fome = clamp01(c.fome - 0.08); return set('comer', { dur: 6 });
    case 'recusar': return set('atacar', { dur: 1.5, olhar: null });
    case 'espreitar': return set('andar', { alvo: perto(10), vel: M.passo, dur: 15 });
    default: return set('alerta', { dur: 3 });
  }
}

// ---- rotina ---------------------------------------------------------------------------------------------------------
// ctx = { agora, hora, noite, calor, mes, lat, pos, molhado, seed, centro, mae: {pos}, vigia,
//   pasto(), agua(), sombra(), arvore(): pontos do mundo · presa: { pos, id, dist } (carnívoro com fome) ·
//   predador: { pos, dist } · parceiro: { pos, aceitou } (macho, fêmea no cio) }
export function decidirA(c, ctx) {
  const e = esp(c), M = MARCHA_DE(e), agora = ctx.agora, a = c.ato;
  if (c.morto) { c.ato = { a: 'morto', de: agora, ate: 1e12, alvo: null, vel: 0, olhar: null }; return c.ato; }
  const u = (k) => rand01(ctx.seed || 1, c.id, Math.floor(agora / 7) * 31 + k);
  const set = (nome, x = {}) => { const r = DURACAO[nome]; c.ato = { a: nome, de: agora, ate: agora + (x.dur ?? (r ? r[0] + (r[1] - r[0]) * u(1) : 6 + u(2) * 10)), alvo: x.alvo || null, vel: x.vel || 0, olhar: x.olhar || null, motivo: x.motivo || 'rotina' }; return c.ato; };
  const dist = (p) => Math.hypot(p[0] - ctx.pos[0], p[2] - ctx.pos[2]);
  const roda = (r) => [ctx.pos[0] + (u(11) - 0.5) * r, ctx.pos[1], ctx.pos[2] + (u(12) - 0.5) * r];
  const aquatico = e.meio === 'agua', voador = e.meio === 'ar' || e.voa;
  // gestos leves (limpar-se, cheirar, chamar) cedem à presa à vista e ao predador; o resto só a um susto forte
  const urgente = ctx.predador || (caca(c) && c.fome > FOME_CACA_A && ctx.presa);
  if (FIRMES.has(a.a) && agora < a.ate && !(c.medo > 0.85 && a.a !== 'parir') && !(urgente && ['limpar', 'cheirar', 'chamar'].includes(a.a))) return a;
  if (a.a === 'deitar') return set('dormir', { dur: 60 + u(3) * 200 });
  if (a.a === 'dormir' && (agora >= a.ate || c.medo > 0.3 || c.sono < 0.05)) return set('levantar');
  if (a.a === 'parir' && agora >= a.ate) return set('levantar');
  if (a.motivo && a.motivo !== 'rotina' && agora < a.ate && (!a.alvo || dist(a.alvo) > 1)) return a;
  // 1. predador à vista: foge (manada junta), ou fica alerta
  if (ctx.predador && ctx.predador.dist < Math.max(8, e.alt * 25) * (1 - c.ousadia * 0.4)) {
    const dx = ctx.pos[0] - ctx.predador.pos[0], dz = ctx.pos[2] - ctx.predador.pos[2], l = Math.hypot(dx, dz) || 1;
    c.medo = Math.max(c.medo, 0.8); c.alarme = { pos: [...ctx.predador.pos], t: agora };
    return set('fugir', { alvo: [ctx.pos[0] + dx / l * 30, ctx.pos[1], ctx.pos[2] + dz / l * 30], vel: M.corrida * (1 - c.fadiga * 0.5), dur: 6, motivo: 'predador' });
  }
  if (c.medo > 0.6 && c.alarme) {
    const dx = ctx.pos[0] - c.alarme.pos[0], dz = ctx.pos[2] - c.alarme.pos[2], l = Math.hypot(dx, dz) || 1;
    if (l < 50) return set('fugir', { alvo: [ctx.pos[0] + dx / l * 25, ctx.pos[1], ctx.pos[2] + dz / l * 25], vel: M.corrida * (1 - c.fadiga * 0.5), dur: 6, motivo: 'medo' });
  }
  if (c.medo > 0.3 && c.alarme) return set('alerta', { dur: 3 + u(4) * 3, olhar: c.alarme.pos });
  if (c.prenhe && c.prenhe.pronta) return set('parir', { motivo: 'parto' });
  if (c.bexiga > 0.92) return set('urinar');
  if (c.intestino > 0.93) return set('defecar');
  // filhote segue a mãe e mama
  if (filhoteA(c) && ctx.mae) {
    const dm = dist(ctx.mae.pos);
    if (e.classe === 'mamifero' && c.idade < e.vida[0] * 0.25 && c.fome > 0.35 && dm < 2 + e.alt) return set('mamar', { olhar: ctx.mae.pos });
    if (dm > 2 + e.alt * 3) return set(dm > 10 ? 'trotar' : 'andar', { alvo: ctx.mae.pos, vel: dm > 10 ? M.trote : M.passo * 1.3, dur: 5 });
  }
  // 2. sede (quem é da água não bebe)
  if (!aquatico && (c.sede > 0.62 || (a.a === 'beber' && c.sede > 0.05 && agora < a.ate))) {
    const ag = ctx.agua && ctx.agua();
    if (ag) { const d = dist(ag); if (d < 1.5 + e.alt) return set('beber', { olhar: ag }); return set(voador && d > 20 ? 'voar' : d > 25 ? 'trotar' : 'andar', { alvo: ag, vel: voador && d > 20 ? M.corrida * 0.6 : d > 25 ? M.trote : M.passo, dur: 12 }); }
  }
  // 3. fome: carnívoro caça; herbívoro pasta; onívoro e insetívoro forrageiam
  const carn = e.dieta === 'carnivoro' || e.dieta === 'piscivoro';
  if (c.fome > FOME_CACA_A && carn && ctx.presa && agora >= (c.descansoCaca || 0) && c.estomago < kcalPorKg(e) * estomagoKg(c) * 0.5) {
    if (ctx.presa.dist < 0.6 + e.alt * 0.6) return set('atacar', { alvo: ctx.presa.pos, olhar: ctx.presa.pos, motivo: 'caca' });
    const perto = ctx.presa.dist < 12;
    return set(perto ? 'correr' : 'andar', { alvo: ctx.presa.pos, vel: perto ? M.corrida : M.passo * 0.8, dur: 4, olhar: ctx.presa.pos, motivo: 'caca' });
  }
  if (ctx.carcaca && c.fome > 0.3) {
    if (ctx.carcaca.dist < 0.8 + e.alt) return set('comer', { dur: 20, olhar: ctx.carcaca.pos, motivo: 'carniça' });
    return set('andar', { alvo: ctx.carcaca.pos, vel: M.trote, dur: 6, olhar: ctx.carcaca.pos });
  }
  if (c.fome > 0.45 || (['pastar', 'comer'].includes(a.a) && c.fome > 0.08)) {
    if (e.dieta === 'herbivoro' || e.dieta === 'onivoro' || e.dieta === 'insetivoro') {
      const p = ctx.pasto && ctx.pasto();
      if (p && dist(p) > 2.5 + e.alt) return set('andar', { alvo: p, vel: M.passo * 0.8, dur: 12 });
      return set(e.dieta === 'herbivoro' ? 'pastar' : 'comer', { dur: 12 + u(7) * 20, alvo: roda(2 + e.alt), vel: M.passo * 0.25 });
    }
  }
  // 4. ruminante satisfeito deita e rumina
  if (RUMINANTES.has(c.especie) && c.fome < 0.3 && c.medo < 0.1 && u(13) < 0.25 && a.a !== 'ruminar') return set('ruminar', { dur: 40 + u(14) * 120 });
  if (a.a === 'ruminar' && agora < a.ate && c.medo < 0.1) return a;
  // 5. cio: macho procura a fêmea; corteja; acasala se ela aceitou
  if (ctx.parceiro && c.sexo === 'M' && adultoA(c)) {
    const d = dist(ctx.parceiro.pos);
    if (ctx.parceiro.aceitou && d < 1 + e.alt * 1.5) return set('acasalar', { olhar: ctx.parceiro.pos, motivo: 'acasalamento' });
    if (d > 1 + e.alt * 1.2) return set('andar', { alvo: ctx.parceiro.pos, vel: M.passo * 1.2, dur: 6, olhar: ctx.parceiro.pos });
    if (!ctx.parceiro.aceitou && agora - (c.cortejou || -1e9) > 30) { c.cortejou = agora; return set('cortejar', { olhar: ctx.parceiro.pos, motivo: 'cortejo' }); }
  }
  // 6. sono na hora de descanso da espécie (só deita com vigia, se é de grupo)
  if (c.sono > 0.6 && c.medo < 0.12 && (ctx.vigia !== false || e.social === 'solitario')) return set(voador || aquatico ? 'dormir' : 'deitar', { dur: 60 + u(5) * 200 });
  // 7. grupo: ninguém fica longe
  if (ctx.centro && e.social !== 'solitario') { const d = dist(ctx.centro), lim = 4 + e.alt * 6; if (d > lim) return set(d > lim * 3 ? 'trotar' : 'andar', { alvo: ctx.centro, vel: d > lim * 3 ? M.trote : M.passo, dur: 8 }); }
  // 8. calor: sombra (ou água, para quem é anfíbio)
  if ((ctx.calor || 0) > 0.75 && u(6) < 0.35) { const s = e.meio === 'anfibio' ? ctx.agua && ctx.agua() : ctx.sombra && ctx.sombra(); if (s && dist(s) > 2) return set('andar', { alvo: s, vel: M.passo, dur: 16 }); }
  // 8b. casa: quem anda sozinho também não vai embora do território (o grupo já volta pelo centro, regra 7)
  if (ctx.lar && ctx.raioLar && dist(ctx.lar) > ctx.raioLar) return set(voador ? 'voar' : aquatico ? 'nadar' : 'andar', { alvo: voador ? [ctx.lar[0], ctx.lar[1] + 6, ctx.lar[2]] : ctx.lar, vel: voador ? M.corrida * 0.5 : M.passo * 1.2, dur: 14 });
  // 9. o resto do tempo
  const r = u(10);
  if (voador && r < 0.3) return set('voar', { alvo: [ctx.pos[0] + (u(15) - 0.5) * 40, ctx.pos[1] + 4 + u(16) * 10, ctx.pos[2] + (u(17) - 0.5) * 40], vel: M.corrida * 0.5, dur: 8 });
  if (e.meio === 'arvore' && r < 0.25 && ctx.arvore) { const t = ctx.arvore(); if (t) return set('andar', { alvo: t, vel: M.trote, dur: 8 }); }
  if (r < 0.06) return set('limpar');
  if (r < 0.1 && e.social !== 'solitario') return set('chamar');
  if (r < 0.14) return set('cheirar');
  if (aquatico || r < 0.5) return set(aquatico ? 'nadar' : 'andar', { alvo: roda(aquatico ? 10 : 6 + e.alt * 4), vel: M.passo, dur: 8 });
  return set('parado', { dur: 6 + u(13) * 12 });
}
export function vontadeA(c, pos) {
  const e = esp(c), a = c.ato;
  if (!a.alvo || !(a.vel > 0)) return { x: pos[0], y: pos[1], z: pos[2], speed: 0, fly: false };
  if (['urinar', 'acasalar', 'parir', 'deitar', 'dormir', 'levantar', 'beber', 'mamar', 'chamar', 'alerta', 'cheirar', 'morto', 'ruminar', 'limpar'].includes(a.a)) return { x: pos[0], y: pos[1], z: pos[2], speed: 0, fly: false };
  let vel = a.vel * (1 - c.fadiga * 0.5) * (0.6 + 0.4 * c.saude);
  if (filhoteA(c)) vel *= 0.8;
  if (anosA(c) > e.vida[4] * 0.75) vel *= 0.75;
  return { x: a.alvo[0], y: a.alvo[1], z: a.alvo[2], speed: vel, fly: a.a === 'voar' || (e.meio === 'ar' && a.a === 'fugir') };
}

// ---- reprodução -------------------------------------------------------------------------------------------------------
export function emprenharA(f, m) { f.prenhe = { dias: 0, pai: m.id, pronta: false }; }
// procriar demora (18/11, Kadmus: "aumente o tempo de demora para procriar"): 25% de chance por cio (era 60%) e, depois
// de parir, INTERVALO_CRIA segundos de verdade sem emprenhar (padrão 4 h; LAVRA_FAUNA_CRIA_H muda)
export const INTERVALO_CRIA = Number(globalThis.process?.env?.LAVRA_FAUNA_CRIA_H || 4) * 3600;
export function concebeA(f, u, ctx) { return emCioA(f, ctx) && !f.prenhe && !(f.ultimaCria !== undefined && ctx?.agora !== undefined && ctx.agora - f.ultimaCria < INTERVALO_CRIA) && u < 0.25 * (0.6 + 0.4 * f.saude); }
// Filhotes que nascem (e sobrevivem): mamífero, a ninhada da ficha (até 4 visíveis); ovos e desovas, poucos.
export function nascerA(f, seed) {
  const e = esp(f), [mn, mx] = [e.vida[2], e.vida[3]];
  let n = mn + Math.floor(rand01(seed, 1, 1) * (mx - mn + 1));
  if (e.ovos || e.classe === 'peixe') n = Math.max(1, Math.min(3, Math.round(Math.log10(n + 1) + rand01(seed, 1, 2))));
  n = Math.min(4, n);
  const out = [];
  for (let k = 0; k < n; k++) {
    const b = novoAnimal(f.especie, hash32(seed, k, 7), { idadeDias: 0, mae: f.id, pai: f.prenhe?.pai ?? null });
    b.fome = 0.3; b.sede = 0.2; b.sono = 0.6;
    out.push(b);
  }
  f.prenhe = null; if (e.classe === 'mamifero') f.lactacao = e.vida[0] * 0.25;
  return out;
}
export function avancarAusenteA(c, dtReal, ritmo, seed) {
  const nasc = [];
  if (c.morto || !(dtReal > 0)) return nasc;
  const e = esp(c), kv = (ritmo.vida / DIA) * dtReal;
  c.idade += kv;
  if (c.lactacao > 0) c.lactacao = Math.max(0, c.lactacao - kv);
  if (c.prenhe) { c.prenhe.dias += kv; if (c.prenhe.dias >= e.vida[1]) { const desde = c.prenhe.dias - e.vida[1]; for (const b of nascerA(c, hash32(seed, c.id, Math.floor(c.idade)))) { b.idade = desde; nasc.push(b); } } }
  c.fome = 0.3; c.sede = 0.3; c.bexiga = 0.4; c.intestino = 0.4; c.sono = 0.3; c.fadiga = 0; c.medo = 0; c.alarme = null;
  if (c.idade > c.vidaMax) { c.morto = true; c.causa = 'velhice'; }
  return nasc;
}
// atributos para quem desenha: [sexo, crescimento*100, prenhe, fase(0 filhote,1 jovem,2 adulto,3 idoso), olhar|0, anos*10]
export function atributosA(c) { const f = faseA(c); return [c.sexo === 'M' ? 1 : 0, Math.round(crescimentoA(c) * 100), c.prenhe ? 1 : 0, f === 'filhote' ? 0 : f === 'jovem' ? 1 : f === 'idoso' ? 3 : 2, c.ato.olhar ? c.ato.olhar.map((v) => Math.round(v * 10) / 10) : 0, Math.round(anosA(c) * 10)]; }
const GUARDA = ['especie', 'id', 'sexo', 'idade', 'ultimaCria', 'reserva', 'estomago', 'ousadia', 'docilidade', 'curiosidade', 'sociavel', 'fome', 'sede', 'bexiga', 'intestino', 'sono', 'fadiga', 'saude', 'cio', 'prenhe', 'lactacao', 'mae', 'pai', 'vidaMax', 'confianca', 'costume', 'morto', 'causa'];
export function guardarA(c) { const o = {}; for (const k of GUARDA) o[k] = typeof c[k] === 'number' ? Math.round(c[k] * 1000) / 1000 : c[k] && typeof c[k] === 'object' ? JSON.parse(JSON.stringify(c[k])) : c[k]; return o; }
export function carregarA(o) { const c = novoAnimal(o.especie, o.id >>> 0, { sexo: o.sexo, idadeDias: o.idade, id: o.id }); for (const k of GUARDA) if (o[k] !== undefined) c[k] = o[k]; c.confianca ||= {}; c.costume ||= {}; return c; }
