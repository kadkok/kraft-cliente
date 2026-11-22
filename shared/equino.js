// LAVRA — o cavalo como bicho de verdade (pedido do Kadmus, 17/11/2026). Código puro e determinístico: roda igual no
// servidor e nos testes. Aqui mora a biologia (necessidades, cio, gestação, crescimento), os sentidos (visão com ponto
// cego, audição, faro com o vento), o juízo de cada coisa percebida (ameaça, risco, barulho, amigável, aceitável,
// alimento), a memória (confiança por pessoa, costume com o que se repete) e a escolha do que fazer.
//
// Quem decide a reação a uma interação, no instante do fato, é o Jev (server/equinos.js pergunta); sem ele, valem
// as chances de `chancesReacao`, montadas com o estado do animal. O sorteio é sempre `rand01(semente, cavalo, evento)`.
//
// Tempo: a rotina (fome, sede, bexiga, intestino, sono) anda `ritmo.rotina` vezes mais rápido que o relógio de
// verdade, e a vida (idade, cio, gestação, crescimento) anda `ritmo.vida` vezes. A DURAÇÃO de cada ato (urinar,
// beber, empinar, deitar) é a de verdade, em segundos reais: o que se comprime são os intervalos, não os gestos.
// O cansaço também é real: correr cansa em segundos de verdade.
//
// Números de referência (cavalo adulto, por dia de cavalo): pasta ~15 h em turnos de 2–4 h; bebe 3–5 vezes; urina
// 6–8 vezes; defeca 8–12 vezes; dorme ~3 h cochilando em pé e ~1 h deitado (sono profundo só deitado, e só quando
// outro da manada fica de vigia). Égua: cio a cada 21 dias, por 5–7, na estação de dias longos; gestação de 340
// dias; potro em pé em ~1 h, mama várias vezes por hora, desmama aos 6 meses, adulto aos 4 anos.

import { rand01, hash32 } from './nature.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const DIA = 86400;

export const RITMO_PADRAO = { rotina: 12, vida: 120 };

// Ações (o número vai pela rede, em 5 bits). A ordem não muda: só se acrescenta no fim.
export const ACOES = ['parado', 'andar', 'trotar', 'galopar', 'pastar', 'beber', 'deitar', 'dormir_pe', 'dormir',
  'urinar', 'defecar', 'empinar', 'coice', 'corcovear', 'pular', 'nadar', 'alerta', 'cheirar', 'relinchar', 'mamar',
  'cortejar', 'cobrir', 'aceitar', 'parir', 'montado', 'levantar', 'sacudir', 'rolar', 'morto'];
export const ACAO = Object.fromEntries(ACOES.map((n, i) => [n, i]));

// Atos que não se interrompem por vontade própria (só um susto forte corta) e quanto duram (s reais).
export const DURACAO = {
  urinar: [14, 24], defecar: [6, 11], beber: [30, 70], empinar: [2.4, 3.4], coice: [1.2, 1.6], corcovear: [3, 4.6],
  relinchar: [2, 3], cheirar: [3, 6], sacudir: [2, 3], rolar: [12, 20], cobrir: [12, 18], aceitar: [14, 20],
  parir: [70, 110], levantar: [3, 4], deitar: [3, 4], mamar: [25, 45], cortejar: [8, 16], pular: [1.2, 1.6],
};
const FIRMES = new Set(['urinar', 'defecar', 'empinar', 'coice', 'corcovear', 'relinchar', 'sacudir', 'rolar', 'cobrir',
  'aceitar', 'parir', 'levantar', 'deitar', 'pular', 'cheirar', 'mamar']);

// Velocidades de verdade (m/s) e o que custam.
export const MARCHA = { passo: 1.6, trote: 3.8, galope: 8.5, disparada: 12.5 };
export function marchaDe(v) { return v < 0.25 ? 'parado' : v < 2.6 ? 'andar' : v < 5.6 ? 'trotar' : 'galopar'; }

// Fases da vida (para quem desenha e para o Jev): potro → jovem → adulto → idoso → morto.
export function fase(c) { return c.morto ? 'morto' : potro(c) ? 'potro' : !adulto(c) ? 'jovem' : anos(c) > 20 ? 'idoso' : 'adulto'; }

export const ESPECIE = {
  idadeAdulta: 1460, desmame: 180, gestacao: 340, ciclo: 21, cio: 6, posParto: 9, vidaMax: [9000, 12000],
  visaoDia: 140, visaoNoite: 45, pontoCego: 0.26,          // rad para cada lado, bem atrás da cauda
  ouvido: 1, faro: 60,
};

// Um cavalo novo. o = { sexo: 'M'|'F', idadeDias, mae, pai, nome }.
export function novoCavalo(seed, o = {}) {
  const u = (k) => rand01(seed, 9001, k);
  const sexo = o.sexo === 'M' || o.sexo === 'F' ? o.sexo : u(1) < 0.5 ? 'M' : 'F';
  const macho = sexo === 'M';
  const idade = Number.isFinite(o.idadeDias) ? o.idadeDias : ESPECIE.idadeAdulta + u(2) * 4000;
  return {
    id: o.id ?? (seed >>> 0),
    sexo, idade, nome: o.nome || '',
    pelagem: Math.floor(u(3) * 4),
    // temperamento: macho é mais ousado; cada um tem o seu
    ousadia: clamp01(0.3 + u(4) * 0.5 + (macho ? 0.15 : 0)),
    docilidade: clamp01(0.25 + u(5) * 0.6 - (macho ? 0.08 : 0)),
    curiosidade: clamp01(0.2 + u(6) * 0.7),
    sociavel: clamp01(0.45 + u(7) * 0.5),
    fome: 0.2 + u(8) * 0.3, sede: 0.1 + u(9) * 0.4, bexiga: u(10) * 0.7, intestino: u(11) * 0.8,
    sono: u(12) * 0.5, rem: u(13) * 0.5, fadiga: 0, medo: 0, saude: 1,
    cio: macho ? 0 : u(14) * ESPECIE.ciclo,            // dia dentro do ciclo da égua
    prenhe: null, lactacao: 0, mae: o.mae ?? null, pai: o.pai ?? null, vidaMax: ESPECIE.vidaMax[0] + u(15) * (ESPECIE.vidaMax[1] - ESPECIE.vidaMax[0]),
    confianca: {}, costume: {}, aceitouCobertura: 0, montadoPor: null, domado: 0,
    ato: { a: 'parado', ate: 0, alvo: null, vel: 0, olhar: null, de: 0 },
    alarme: null, fuga: null, ev: 0, morto: false,
  };
}

export const adulto = (c) => c.idade >= ESPECIE.idadeAdulta;
export const potro = (c) => c.idade < ESPECIE.desmame * 2;
export const emCio = (c, estacao = true) => c.sexo === 'F' && adulto(c) && !c.prenhe && estacao && (c.cio % ESPECIE.ciclo) < ESPECIE.cio;
// Tamanho relativo ao adulto (o potro nasce com ~45% da altura e cresce depressa no primeiro ano).
export function crescimento(c) { const a = Math.min(1, c.idade / ESPECIE.idadeAdulta); return 0.45 + 0.55 * (1 - (1 - a) ** 2.2); }
export const anos = (c) => c.idade / 365;

// ---- fisiologia ---------------------------------------------------------------------------------------------------
// ctx: { calor 0..1, noite, estacao (dias longos), velocidade (m/s do corpo), molhado }
// Devolve os eventos de vida que aconteceram: 'cio', 'parto', 'desmame', 'velhice'.
export function passoFisiologia(c, ctx, dt, ritmo = RITMO_PADRAO) {
  if (c.morto || !(dt > 0)) return [];
  const out = [];
  const kd = (ritmo.rotina / DIA) * dt, kv = (ritmo.vida / DIA) * dt;   // dias de cavalo neste passo
  const a = c.ato.a, calor = clamp01(ctx.calor ?? 0.4), v = ctx.velocidade || 0;
  const filhote = potro(c), lact = c.lactacao > 0;
  // comer e beber
  c.fome = clamp01(c.fome + kd * (1.6 + (lact ? 0.7 : 0) + (c.prenhe ? 0.3 : 0)) - (a === 'pastar' ? kd * 2.6 : 0) - (a === 'mamar' ? kd * 9 : 0));
  c.sede = clamp01(c.sede + kd * 3 * (1 + calor * 0.6 + c.fadiga * 0.8 + (lact ? 0.5 : 0)) - (a === 'beber' ? dt / 40 : 0) - (a === 'mamar' ? kd * 6 : 0) - ((ctx.chuva || 0) > 0.2 ? kd * 4 : 0));
  if (ctx.semAgua && c.sede > 0.8) c.sede = 0.8;   // território sem água doce ao alcance: vive do orvalho e do pasto, com sede, sem morrer dela
  // o que entra sai: bexiga e intestino (o cio e o susto apressam)
  c.bexiga = clamp01(c.bexiga + kd * (6.5 + (emCio(c, ctx.estacao) ? 4 : 0)) + (a === 'beber' ? dt / 400 : 0) - (a === 'urinar' ? dt / 10 : 0));
  c.intestino = clamp01(c.intestino + kd * 9.5 * (1 + c.medo * 2) - (a === 'defecar' ? dt / 5 : 0));
  // sono: pressão sobe acordado; cochilo em pé alivia; deitado alivia mais e paga o sono profundo
  const dormindo = a === 'dormir_pe' || a === 'dormir';
  const velho = anos(c) > 20;
  c.sono = clamp01(c.sono + kd * (filhote ? 2.2 : velho ? 1.3 : 1) * (ctx.noite ? 1.4 : 0.8) - (a === 'dormir_pe' ? kd * 7 : 0) - (a === 'dormir' ? kd * 10 : 0));
  c.rem = clamp01(c.rem + kd * (filhote ? 2 : 1) - (a === 'dormir' ? kd * 24 : 0));
  // cansaço: em segundos de verdade. Galope cansa; descanso recupera.
  const esforco = v > 4.5 ? ((v / MARCHA.galope) ** 2) * 0.02 : v > 2.6 ? 0.003 : 0;
  c.fadiga = clamp01(c.fadiga + esforco * dt - (v < 0.3 ? 0.012 : v < 2.6 ? 0.005 : 0) * dt * (dormindo ? 1.5 : 1));
  // medo assenta com o tempo (mais devagar logo depois de um susto)
  c.medo = clamp01(c.medo - dt * (c.alarme && ctx.agora - c.alarme.t < 20 ? 0.02 : 0.06));
  if (c.medo < 0.08) c.alarme = null;
  // saúde: sede e fome extremas machucam; descanso cura
  if (c.sede >= 1 || c.fome >= 1) c.saude = clamp01(c.saude - dt * 0.0006);
  else if (c.saude < 1 && c.medo < 0.2) c.saude = clamp01(c.saude + dt * 0.0004 * (dormindo ? 2 : 1));
  // costume esquece devagar (dias de cavalo)
  for (const k in c.costume) { c.costume[k] *= Math.exp(-kd * 0.5); if (c.costume[k] < 0.02) delete c.costume[k]; }
  // vida
  const antes = c.idade;
  c.idade += kv;
  if (antes < ESPECIE.desmame && c.idade >= ESPECIE.desmame) out.push('desmame');
  if (c.lactacao > 0) c.lactacao = Math.max(0, c.lactacao - kv);
  if (c.sexo === 'F' && adulto(c)) {
    const estava = emCio(c, ctx.estacao);
    if (!c.prenhe) c.cio = (c.cio + kv) % ESPECIE.ciclo;
    if (!estava && emCio(c, ctx.estacao)) { out.push('cio'); c.aceitouCobertura = 0; }
  }
  if (c.prenhe) { c.prenhe.dias += kv; if (c.prenhe.dias >= ESPECIE.gestacao && !c.prenhe.pronta) { c.prenhe.pronta = true; out.push('parto'); } }
  if (c.idade > c.vidaMax) { c.saude = clamp01(c.saude - dt * 0.002); if (c.saude <= 0) { c.morto = true; out.push('velhice'); } }
  return out;
}

// ---- sentidos -----------------------------------------------------------------------------------------------------
// Percebe um ponto? Visão quase em volta toda (ponto cego atrás), alcance menor de noite e com neblina; ouvido pelo
// volume; faro quando o vento traz o cheiro (de onde o vento vem até o cavalo).
// s = { pos, alto (volume 0..1 a 10 m; 0 = silencioso), cheiro (bool) } ; eu = { pos, rumo } ; amb = { noite, nevoa, vento [x,z] }
export function percebe(eu, s, amb = {}) {
  const dx = s.pos[0] - eu.pos[0], dz = s.pos[2] - eu.pos[2], d = Math.hypot(dx, dz, s.pos[1] - eu.pos[1]) || 0.01;
  const alcance = (amb.noite ? ESPECIE.visaoNoite : ESPECIE.visaoDia) * (1 - 0.6 * clamp01(amb.nevoa || 0));
  const frente = Math.atan2(dx, dz), dif = Math.abs(((frente - eu.rumo + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI);
  const atras = dif > Math.PI - ESPECIE.pontoCego;
  const ve = d < alcance && !atras;
  const ouve = (s.alto || 0) > 0 && (s.alto * 10) / d > 0.06;
  let fareja = false;
  if (s.cheiro && amb.vento) {
    const w = Math.hypot(amb.vento[0], amb.vento[1]);
    if (w > 0.3) { const cosv = (-dx * amb.vento[0] - dz * amb.vento[1]) / (d * w); fareja = cosv > 0.7 && d < ESPECIE.faro * Math.min(2, w / 3); }
  }
  return { ve, ouve, fareja, atras, d, perto: d < 4 };
}

// Juízo de uma coisa percebida: devolve { cat, risco 0..1 }.
// s.tipo: 'pessoa' | 'maquina' | 'explosao' | 'trovao' | 'quebra' | 'desabamento' | 'tiro' | 'cavalo_fugindo' | 'garanhao' | 'criatura'
// s: { vel (m/s), aproxima (m/s, positivo = vindo), agachado, chave (pessoa), forca (0..1, para barulhos) }
export function julgar(c, s, p) {
  const costume = c.costume[s.tipo] || 0, conf = s.chave ? c.confianca[s.chave] || 0 : 0;
  let risco = 0;
  switch (s.tipo) {
    case 'pessoa': {
      risco = 0.3 + (s.vel > 3.4 ? 0.3 : 0) + clamp01((s.aproxima || 0) / 4) * 0.25 + (p.d < 4 ? 0.15 : 0) + (p.atras && p.d < 3.5 ? 0.35 : 0)
        - (s.agachado ? 0.12 : 0) - conf * 0.6 - costume * 0.25;
      break;
    }
    case 'maquina': risco = 0.35 + clamp01((s.vel || 0) / 8) * 0.5 + (p.d < 12 ? 0.2 : 0) - costume * 0.3; break;
    case 'explosao': risco = 0.85 + (s.forca || 0.5) * 0.3 - costume * 0.2; break;
    case 'tiro': risco = 0.75 - costume * 0.3; break;
    case 'trovao': risco = 0.45 + (s.forca || 0.5) * 0.3 - costume * 0.5; break;
    case 'desabamento': risco = 0.7 - costume * 0.2; break;
    case 'quebra': risco = p.d < 6 ? 0.25 - costume * 0.3 : 0.08; break;
    case 'cavalo_fugindo': risco = 0.45 + (s.forca || 0.5) * 0.45; break;
    case 'criatura': risco = 0.7 - costume * 0.1; break;
    case 'garanhao': risco = c.sexo === 'M' && adulto(c) ? 0.5 : 0.15; break;
    default: risco = 0.2;
  }
  risco *= 1 - c.ousadia * 0.35;
  if (potro(c)) risco = Math.min(1, risco * 1.25);
  risco = clamp01(risco);
  let cat;
  if (s.tipo === 'pessoa') cat = risco > 0.62 ? 'ameaca' : risco > 0.4 ? 'risco' : conf > 0.35 ? 'amigavel' : 'aceitavel';
  else if (s.tipo === 'quebra' || s.tipo === 'trovao') cat = risco > 0.5 ? 'risco' : 'barulho';
  else cat = risco > 0.62 ? 'ameaca' : risco > 0.35 ? 'risco' : 'aceitavel';
  return { cat, risco };
}

// Comida que se oferece na mão (id de bloco do jogo): capim, samambaia, junco, flor, folhagem.
export function eComida(id, B) {
  if (!B) return false;
  return id === B.TALL_GRASS || id === B.FERN || id === B.REEDS || id === B.GRASS || id === B.LEAVES
    || id === B.FLOWER_YELLOW || id === B.FLOWER_RED || id === B.FLOWER_BLUE || id === B.FLOWER_WHITE;
}

// ---- reações (o que se pode fazer diante de cada evento) ------------------------------------------------------------
// Para cada evento: as opções e o que cada uma quer dizer (vai ao Jev como critério).
export const REACOES = {
  aproximacao: { ignorar: 'segue no que fazia, só de olho', observar: 'para, ergue a cabeça e encara com as orelhas para a frente', aproximar: 'vai até a pessoa, curioso', cheirar: 'estica o pescoço e cheira', afastar: 'se afasta andando', trotar_longe: 'se afasta trotando, desconfiado', fugir: 'dispara a galope' },
  aproximacao_rapida: { observar: 'para e encara, tenso', trotar_longe: 'trota para longe', fugir: 'dispara a galope', empinar: 'empina e bufa para intimidar', relinchar: 'relincha alto avisando a manada' },
  susto_atras: { coice: 'escoiceia para trás por reflexo', pular: 'salta para a frente assustado', fugir: 'dispara a galope', observar: 'vira a cabeça e encara' },
  toque: { aceitar: 'aceita o carinho e relaxa, abaixa a cabeça', cheirar: 'cheira a mão com calma', afastar: 'se esquiva e se afasta', morder: 'ameaça morder, orelhas para trás', coice: 'escoiceia' },
  oferta_comida: { comer: 'come da mão com cuidado', cheirar: 'cheira, desconfiado, mas não come', afastar: 'não aceita e se afasta' },
  tentativa_montar: { aceitar_montaria: 'fica parado e deixa montar', corcovear: 'corcoveia para derrubar quem montou', empinar: 'empina e não deixa', afastar: 'se esquiva e se afasta', coice: 'escoiceia' },
  agressao: { fugir: 'dispara a galope', coice: 'devolve com um coice', empinar: 'empina e ameaça', morder: 'morde' },
  barulho_forte: { ignorar: 'nem liga', observar: 'ergue a cabeça e procura a origem', trotar_longe: 'se afasta trotando', fugir: 'dispara a galope', empinar: 'empina assustado' },
  garanhao_rival: { ameacar: 'arqueia o pescoço, bufa e empina', relinchar: 'relincha desafiando', avancar: 'avança contra o rival', recuar: 'recua com a manada' },
  cortejo: { aceitar: 'fica parada, cauda de lado, aceita a cobertura', recusar: 'recusa com coice e guincho', afastar: 'se afasta sem brigar' },
  potro_ameacado: { proteger: 'fica entre o potro e a ameaça', fugir_juntos: 'foge levando o potro', atacar: 'avança contra a ameaça' },
};

// Chances sem o Jev, a partir do estado do animal. ctx: { conf, d, vel, saciedade, comPotro, dominante }
export function chancesReacao(c, evento, ctx = {}) {
  const ous = c.ousadia, doc = c.docilidade, cur = c.curiosidade, medo = c.medo, conf = ctx.conf || 0;
  const macho = c.sexo === 'M' && adulto(c), filhote = potro(c), cansado = c.fadiga > 0.7;
  const p = {};
  switch (evento) {
    case 'aproximacao':
      p.ignorar = 0.25 + doc * 0.3 + conf * 0.3; p.observar = 0.35 + (1 - doc) * 0.2;
      p.aproximar = cur * 0.35 + conf * 0.6; p.cheirar = cur * 0.25 + conf * 0.3;
      p.afastar = (1 - conf) * 0.25 + medo * 0.3; p.trotar_longe = (1 - doc) * 0.15 + medo * 0.4 - conf * 0.2;
      p.fugir = medo * 0.5 + (filhote ? 0.15 : 0) - conf * 0.4 - (cansado ? 0.2 : 0); break;
    case 'aproximacao_rapida':
      p.observar = 0.25 + ous * 0.2 + conf * 0.3; p.trotar_longe = 0.3; p.fugir = 0.35 + medo * 0.4 + (filhote ? 0.2 : 0) - conf * 0.4 - (cansado ? 0.25 : 0);
      p.empinar = macho ? 0.15 + ous * 0.25 : 0.03; p.relinchar = c.sexo === 'M' ? 0.15 : 0.08; break;
    case 'susto_atras':
      p.coice = 0.25 + (1 - doc) * 0.35 - conf * 0.3; p.pular = 0.3; p.fugir = 0.25 + medo * 0.3; p.observar = 0.1 + conf * 0.5; break;
    case 'toque':
      p.aceitar = 0.2 + doc * 0.4 + conf * 0.8; p.cheirar = 0.2 + cur * 0.2; p.afastar = (1 - conf) * 0.3 + medo * 0.3;
      p.morder = (1 - doc) * 0.12 + (macho ? 0.05 : 0) - conf * 0.15; p.coice = (1 - doc) * 0.06 + medo * 0.1 - conf * 0.1; break;
    case 'oferta_comida':
      p.comer = 0.25 + c.fome * 0.6 + conf * 0.5 + cur * 0.15; p.cheirar = 0.3 + (1 - conf) * 0.2; p.afastar = medo * 0.4 + (1 - conf) * 0.15 - c.fome * 0.2; break;
    case 'tentativa_montar':
      p.aceitar_montaria = conf > 0.25 ? 0.15 + conf * 0.9 + doc * 0.3 + c.domado * 0.6 : 0.03 + doc * 0.05;
      p.corcovear = 0.3 + (1 - doc) * 0.3 - c.domado * 0.4 - conf * 0.2; p.empinar = macho ? 0.2 : 0.08;
      p.afastar = 0.25 - conf * 0.2; p.coice = (1 - doc) * 0.1 - conf * 0.1; break;
    case 'agressao':
      p.fugir = 0.5 + medo * 0.3 + (filhote ? 0.3 : 0); p.coice = 0.2 + ous * 0.2; p.empinar = macho ? 0.25 : 0.05; p.morder = macho ? 0.15 : 0.05; break;
    case 'barulho_forte':
      p.ignorar = 0.05 + (c.costume.explosao || 0) * 0.5; p.observar = 0.25 + ous * 0.2; p.trotar_longe = 0.25; p.fugir = 0.35 + medo * 0.3 + (filhote ? 0.2 : 0) - (cansado ? 0.2 : 0); p.empinar = 0.08 + (macho ? 0.1 : 0); break;
    case 'garanhao_rival':
      p.ameacar = 0.3 + ous * 0.3; p.relinchar = 0.25; p.avancar = ous * 0.35 + (ctx.dominante ? 0.15 : 0); p.recuar = (1 - ous) * 0.35; break;
    case 'cortejo':
      p.aceitar = emCio(c) ? 0.55 + (ctx.saciedade || 0) * 0.1 : 0.02; p.recusar = emCio(c) ? 0.2 : 0.6; p.afastar = 0.2; break;
    case 'potro_ameacado':
      p.proteger = 0.45 + ous * 0.3; p.fugir_juntos = 0.35 + medo * 0.3; p.atacar = ous * 0.25; break;
    default: p.observar = 1;
  }
  for (const k in p) p[k] = Math.max(0.001, p[k]);
  return p;
}

// Põe em prática a reação escolhida. Devolve o ato novo. evento = { tipo, pos, chave, agora, seed }
export function aplicarReacao(c, nome, ev, eu) {
  const agora = ev.agora, pos = ev.pos || eu.pos, chave = ev.chave;
  const longe = (dist) => { const dx = eu.pos[0] - pos[0], dz = eu.pos[2] - pos[2], l = Math.hypot(dx, dz) || 1; return [eu.pos[0] + (dx / l) * dist, eu.pos[1], eu.pos[2] + (dz / l) * dist]; };
  const perto = (dist) => { const dx = pos[0] - eu.pos[0], dz = pos[2] - eu.pos[2], l = Math.hypot(dx, dz) || 1, k = Math.max(0, l - dist) / l; return [eu.pos[0] + dx * k, eu.pos[1], eu.pos[2] + dz * k]; };
  const conf = (dv) => { if (chave) c.confianca[chave] = Math.max(-1, Math.min(1, (c.confianca[chave] || 0) + dv)); };
  const dur = (a) => { const r = DURACAO[a] || [3, 5], u = rand01(ev.seed || 1, c.id, 77); return r[0] + (r[1] - r[0]) * u; };
  const set = (a, extra = {}) => { c.ato = { a, de: agora, ate: agora + (extra.dur ?? dur(a)), alvo: extra.alvo || null, vel: extra.vel || 0, olhar: extra.olhar === undefined ? pos : extra.olhar, motivo: ev.tipo }; return c.ato; };
  switch (nome) {
    case 'ignorar': return c.ato;
    case 'observar': c.medo = clamp01(c.medo + 0.1); return set('alerta', { dur: 4 + rand01(ev.seed, c.id, 3) * 6 });
    case 'aproximar': conf(0.03); return set('andar', { alvo: perto(1.8), vel: MARCHA.passo, dur: 12 });
    case 'cheirar': conf(0.02); return set('cheirar');
    case 'afastar': return set('andar', { alvo: longe(10), vel: MARCHA.passo * 1.2, dur: 12, olhar: null });
    case 'trotar_longe': c.medo = clamp01(c.medo + 0.25); return set('trotar', { alvo: longe(22), vel: MARCHA.trote, dur: 12, olhar: null });
    case 'fugir': case 'fugir_juntos': c.medo = clamp01(Math.max(c.medo, 0.8)); conf(-0.03); c.alarme = { pos: [...pos], t: agora }; return set('galopar', { alvo: longe(55 + rand01(ev.seed, c.id, 5) * 30), vel: MARCHA.disparada * (1 - c.fadiga * 0.5), dur: 14, olhar: null });
    case 'empinar': case 'ameacar': c.medo = clamp01(c.medo + 0.2); return set('empinar');
    case 'relinchar': return set('relinchar');
    case 'coice': conf(-0.05); return set('coice', { olhar: null });
    case 'pular': c.medo = clamp01(c.medo + 0.4); return set('pular', { alvo: longe(4), vel: MARCHA.trote });
    case 'aceitar': if (ev.tipo === 'cortejo') { c.aceitouCobertura = agora; return set('aceitar', { olhar: null }); } conf(0.08); c.medo = clamp01(c.medo - 0.2); return set('parado', { dur: 6 });
    case 'comer': conf(0.12); c.fome = clamp01(c.fome - 0.08); return set('pastar', { dur: 8 });
    case 'morder': conf(-0.04); return set('cheirar', { dur: 1.5 });
    case 'aceitar_montaria': conf(0.05); c.montadoPor = chave; c.domado = clamp01(c.domado + 0.15); return set('montado', { dur: 1e9 });
    case 'corcovear': conf(-0.04); c.domado = clamp01(c.domado + 0.04); return set('corcovear');
    case 'recusar': return set('coice', { olhar: null });
    case 'avancar': return set('galopar', { alvo: perto(1.5), vel: MARCHA.galope, dur: 6 });
    case 'recuar': return set('trotar', { alvo: longe(25), vel: MARCHA.trote, dur: 10 });
    case 'proteger': return set('alerta', { alvo: perto(3), dur: 8 });
    case 'atacar': return set('galopar', { alvo: perto(1), vel: MARCHA.galope, dur: 5 });
    default: return set('alerta', { dur: 3 });
  }
}

// ---- rotina: o que fazer agora --------------------------------------------------------------------------------------
// ctx = { agora, noite, calor, chuva, estacao, pos, rumo,
//   pasto(): ponto bom de capim perto (ou null) · agua(): ponto de água perto (ou null) · sombra(): ponto sob árvore (ou null)
//   centro: centro da manada · mae: { pos, ato } da mãe (potro) · vigia: alguém da manada acordado e em pé
//   egua: égua em cio por perto (para o garanhão): { pos, id, aceitou } · garanhao: { pos } (para a égua em cio)
//   seed }
export function decidir(c, ctx) {
  const agora = ctx.agora, a = c.ato;
  if (c.morto) { c.ato = { a: 'morto', de: agora, ate: 1e12, alvo: null, vel: 0, olhar: null }; return c.ato; }
  const u = (k) => rand01(ctx.seed || 1, c.id, Math.floor(agora / 7) * 31 + k);
  const set = (nome, extra = {}) => {
    const r = DURACAO[nome];
    const dur = extra.dur ?? (r ? r[0] + (r[1] - r[0]) * u(1) : 8 + u(2) * 10);
    c.ato = { a: nome, de: agora, ate: agora + dur, alvo: extra.alvo || null, vel: extra.vel || 0, olhar: extra.olhar || null, motivo: extra.motivo || 'rotina' };
    return c.ato;
  };
  if (c.montadoPor) return a.a === 'montado' ? a : set('montado', { dur: 1e9 });
  // atos firmes seguem até o fim; susto forte corta (menos parto)
  if (FIRMES.has(a.a) && agora < a.ate && !(c.medo > 0.85 && a.a !== 'parir')) return a;
  // depois de deitar vem dormir; de dormir deitado, levantar
  if (a.a === 'deitar') return set('dormir', { dur: 120 + u(3) * 240 });
  if (a.a === 'dormir' && (agora >= a.ate || c.medo > 0.3 || (c.rem < 0.05 && c.sono < 0.1))) return set('levantar');
  if (a.a === 'parir' && agora >= a.ate) return set('levantar');
  // reação em curso (fuga, afastar, aproximar) segue até o prazo ou até chegar
  if (a.motivo && a.motivo !== 'rotina' && agora < a.ate) {
    if (!a.alvo) return a;
    const d = Math.hypot(a.alvo[0] - ctx.pos[0], a.alvo[2] - ctx.pos[2]);
    if (d > 1.5) return a;
  }
  // 1. medo: foge do alarme ou fica alerta
  if (c.medo > 0.6 && c.alarme) {
    const dx = ctx.pos[0] - c.alarme.pos[0], dz = ctx.pos[2] - c.alarme.pos[2], l = Math.hypot(dx, dz) || 1;
    if (l < 60) return set('galopar', { alvo: [ctx.pos[0] + (dx / l) * 40, ctx.pos[1], ctx.pos[2] + (dz / l) * 40], vel: MARCHA.galope * (1 - c.fadiga * 0.55), dur: 8, motivo: 'medo' });
  }
  if (c.medo > 0.3 && c.alarme) return set('alerta', { dur: 3 + u(4) * 4, olhar: c.alarme.pos });
  // 2. parto
  if (c.prenhe && c.prenhe.pronta) return set('parir', { motivo: 'parto' });
  // 3. o corpo pede
  if (c.bexiga > 0.92) return set('urinar');
  if (c.intestino > 0.93) return set('defecar');
  // 4. potro: mama e segue a mãe
  if (potro(c) && ctx.mae) {
    const dm = Math.hypot(ctx.mae.pos[0] - ctx.pos[0], ctx.mae.pos[2] - ctx.pos[2]);
    if (c.idade < ESPECIE.desmame && (c.fome > 0.35 || c.sede > 0.5) && dm < 3) return set('mamar', { olhar: ctx.mae.pos });
    if (dm > 4) return set(dm > 12 ? 'trotar' : 'andar', { alvo: ctx.mae.pos, vel: dm > 12 ? MARCHA.trote : MARCHA.passo * 1.3, dur: 6 });
  }
  // 5. sede
  if (c.sede > 0.62 || (a.a === 'beber' && c.sede > 0.05 && agora < a.ate)) {
    const ag = ctx.agua && ctx.agua();
    if (ag) {
      const d = Math.hypot(ag[0] - ctx.pos[0], ag[2] - ctx.pos[2]);
      if (d < 2.2) return set('beber', { olhar: ag });
      return set(d > 30 ? 'trotar' : 'andar', { alvo: ag, vel: d > 30 ? MARCHA.trote : MARCHA.passo, dur: 15 });
    }
  }
  // 6. cio e cobertura (garanhão procura a égua em cio; égua em cio fica perto dele)
  if (c.sexo === 'M' && adulto(c) && ctx.egua) {
    const d = Math.hypot(ctx.egua.pos[0] - ctx.pos[0], ctx.egua.pos[2] - ctx.pos[2]);
    if (ctx.egua.aceitou && d < 2.6) return set('cobrir', { olhar: ctx.egua.pos, motivo: 'cobertura' });
    if (d > 2.2) return set('andar', { alvo: ctx.egua.pos, vel: MARCHA.passo * 1.2, dur: 8, olhar: ctx.egua.pos });
    // recusado, insiste depois de um tempo (como o garanhão de verdade); enquanto isso fica por perto
    if (!ctx.egua.aceitou && a.a !== 'cortejar' && agora - (c.cortejou || -1e9) > 40) { c.cortejou = agora; return set('cortejar', { olhar: ctx.egua.pos, motivo: 'cortejo' }); }
  }
  // égua no cio procura o garanhão e fica perto dele
  if (ctx.garanhao && emCio(c, ctx.estacao)) {
    const d = Math.hypot(ctx.garanhao.pos[0] - ctx.pos[0], ctx.garanhao.pos[2] - ctx.pos[2]);
    if (d > 6) return set('andar', { alvo: ctx.garanhao.pos, vel: MARCHA.passo, dur: 8, olhar: ctx.garanhao.pos });
  }
  // 7. sono: cochila em pé; deita só de noite (ou muito cansado), seguro e com alguém de vigia
  const seguro = c.medo < 0.12;
  if (seguro && c.rem > 0.55 && (ctx.noite || c.rem > 0.9) && ctx.vigia !== false && !c.prenhe?.pronta) return set('deitar');
  if (seguro && c.sono > 0.65) return set('dormir_pe', { dur: 60 + u(5) * 180 });
  if (a.a === 'dormir_pe' && agora < a.ate && seguro && c.sono > 0.1) return a;
  // 8. calor do meio-dia: procura sombra
  if ((ctx.calor || 0) > 0.75 && ctx.sombra && u(6) < 0.4) { const s = ctx.sombra(); if (s && Math.hypot(s[0] - ctx.pos[0], s[2] - ctx.pos[2]) > 2) return set('andar', { alvo: s, vel: MARCHA.passo, dur: 20 }); }
  // 9. fome: pasta (andando devagar de tufo em tufo)
  if (c.fome > 0.45 || (a.a === 'pastar' && c.fome > 0.08)) {
    const p = ctx.pasto && ctx.pasto();
    if (p && Math.hypot(p[0] - ctx.pos[0], p[2] - ctx.pos[2]) > 3.5) return set('andar', { alvo: p, vel: MARCHA.passo * 0.8, dur: 14 });
    return set('pastar', { dur: 15 + u(7) * 25, alvo: [ctx.pos[0] + (u(8) - 0.5) * 2.5, ctx.pos[1], ctx.pos[2] + (u(9) - 0.5) * 2.5], vel: 0.35 });
  }
  // 10. manada: ninguém fica longe
  if (ctx.centro) {
    const d = Math.hypot(ctx.centro[0] - ctx.pos[0], ctx.centro[2] - ctx.pos[2]);
    if (d > 14) return set(d > 30 ? 'trotar' : 'andar', { alvo: ctx.centro, vel: d > 30 ? MARCHA.trote : MARCHA.passo, dur: 10 });
  }
  // 11. o resto do tempo: parado, se sacode, rola na terra (depois de suar), relincha, anda um pouco
  const r = u(10);
  if (c.fadiga > 0.3 && r < 0.08) return set('rolar');
  if (r < 0.1) return set('sacudir');
  if (r < 0.14 && c.sociavel > 0.6) return set('relinchar');
  if (r < 0.45) return set('andar', { alvo: [ctx.pos[0] + (u(11) - 0.5) * 12, ctx.pos[1], ctx.pos[2] + (u(12) - 0.5) * 12], vel: MARCHA.passo, dur: 12 });
  return set('parado', { dur: 8 + u(13) * 14 });
}

// Velocidade e ponto que o corpo físico deve perseguir neste instante (o resto é com shared/bodies.js).
export function vontade(c, pos) {
  const a = c.ato;
  const parado = { x: pos[0], y: pos[1], z: pos[2], speed: 0 };
  if (!a.alvo || !(a.vel > 0)) return parado;
  if (['urinar', 'cobrir', 'aceitar', 'parir', 'deitar', 'dormir', 'dormir_pe', 'levantar', 'empinar', 'coice', 'beber', 'mamar', 'relinchar', 'alerta', 'cheirar', 'montado', 'morto'].includes(a.a)) return parado;
  let vel = a.vel * (1 - c.fadiga * 0.5) * (0.6 + 0.4 * c.saude);
  if (potro(c)) vel *= 0.85;
  if (anos(c) > 20) vel *= 0.8 - Math.min(0.3, (anos(c) - 20) * 0.03);   // velhice: mais devagar a cada ano
  return { x: a.alvo[0], y: a.alvo[1], z: a.alvo[2], speed: vel };
}

// ---- cobertura e parto -----------------------------------------------------------------------------------------------
// Chance de a cobertura emprenhar (égua jovem e saudável ~60% por cio).
export function concebe(egua, u) {
  if (!emCio(egua) || egua.prenhe) return false;
  const idade = anos(egua), base = idade < 15 ? 0.6 : idade < 20 ? 0.45 : 0.25;
  return u < base * (0.6 + 0.4 * egua.saude);
}
export function emprenhar(egua, pai) { egua.prenhe = { dias: 0, pai: pai.id, pronta: false }; }
// O potro que nasce (sexo e temperamento sorteados; herda um pouco da mãe e do pai).
export function nascer(egua, seed, paiTemper = null) {
  const f = novoCavalo(seed, { idadeDias: 0, mae: egua.id, pai: egua.prenhe?.pai ?? null });
  f.pelagem = rand01(seed, 1, 2) < 0.5 ? egua.pelagem : (paiTemper?.pelagem ?? f.pelagem);
  f.ousadia = clamp01((f.ousadia + egua.ousadia + (paiTemper?.ousadia ?? f.ousadia)) / 3);
  f.docilidade = clamp01((f.docilidade + egua.docilidade) / 2);
  f.fome = 0.3; f.sede = 0.2; f.sono = 0.6; f.rem = 0.6;
  egua.prenhe = null; egua.lactacao = ESPECIE.desmame; egua.cio = ESPECIE.ciclo - ESPECIE.posParto;   // cio do potro ~9 dias depois
  return f;
}

// ---- rede e gravação ---------------------------------------------------------------------------------------------------
// Atributos que o desenho precisa (mudam pouco): [sexo 0|1, crescimento*100, pelagem, prenhe 0|1, domado*100, montadoPor? 1:0]
export function atributos(c) { return [c.sexo === 'M' ? 1 : 0, Math.round(crescimento(c) * 100), c.pelagem, c.prenhe ? 1 : 0, Math.round(c.domado * 100), c.montadoPor ? 1 : 0]; }

const GUARDA = ['id', 'sexo', 'idade', 'nome', 'pelagem', 'ousadia', 'docilidade', 'curiosidade', 'sociavel', 'fome', 'sede', 'bexiga', 'intestino',
  'sono', 'rem', 'fadiga', 'saude', 'cio', 'prenhe', 'lactacao', 'mae', 'pai', 'vidaMax', 'confianca', 'costume', 'domado', 'morto'];
const r3 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
export function guardar(c) { const o = {}; for (const k of GUARDA) o[k] = typeof c[k] === 'object' && c[k] !== null ? JSON.parse(JSON.stringify(c[k])) : r3(c[k]); return o; }
export function carregar(o) {
  const c = novoCavalo(o.id >>> 0, { sexo: o.sexo, idadeDias: o.idade, id: o.id });
  for (const k of GUARDA) if (o[k] !== undefined) c[k] = o[k];
  c.confianca = o.confianca && typeof o.confianca === 'object' ? o.confianca : {};
  c.costume = o.costume && typeof o.costume === 'object' ? o.costume : {};
  return c;
}

// Quando a manada fica longe de todos, a vida segue sem ninguém olhando: envelhece, gesta, pare, cresce.
// Devolve os potros nascidos no período (para a manada acordar com eles).
export function avancarAusente(c, dtReal, ritmo, seed) {
  const nasc = [];
  if (c.morto || !(dtReal > 0)) return nasc;
  const kv = (ritmo.vida / DIA) * dtReal;
  c.idade += kv;
  if (c.lactacao > 0) c.lactacao = Math.max(0, c.lactacao - kv);
  if (c.sexo === 'F' && adulto(c) && !c.prenhe) c.cio = (c.cio + kv) % ESPECIE.ciclo;
  if (c.prenhe) {
    c.prenhe.dias += kv;
    if (c.prenhe.dias >= ESPECIE.gestacao) {
      const desde = c.prenhe.dias - ESPECIE.gestacao;             // dias de vida do potro quando a manada acorda
      const f = nascer(c, hash32(seed, c.id, Math.floor(c.idade)));
      f.idade = desde; c.lactacao = Math.max(0, ESPECIE.desmame - desde);
      nasc.push(f);
    }
  }
  // a rotina se acertou sozinha: necessidades em níveis comuns
  c.fome = 0.3; c.sede = 0.3; c.bexiga = 0.4; c.intestino = 0.4; c.sono = 0.3; c.rem = 0.3; c.fadiga = 0; c.medo = 0; c.alarme = null;
  if (c.idade > c.vidaMax) c.morto = true;
  return nasc;
}
