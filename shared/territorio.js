// LAVRA — onde mora cada bicho: territórios (pedido do Kadmus, 19/11/2026: "diminua a quantidade de animais… está
// ficando surreal o acúmulo, não é assim na natureza, quero realismo nisso também").
//
// Como era: o jogo mantinha 8 grupos de bichos EM VOLTA DE CADA PESSOA. Por onde ela andava nasciam mais, e o mundo
// ia enchendo. Medido no motor, com a semente do mundo oficial: parado ao lado do campo, 46 bichos a menos de 100 m
// (20 bois e 6 cavalos entre eles); andando 14 minutos, 69 em média a menos de 100 m, picos de 244 a menos de 150 m e
// 537 bichos guardados no fim.
//
// Como é: o mundo é dividido em territórios de CELULA metros de lado e cada território tem, ou não tem, um morador de
// cada guilda. Quem decide é a semente do mundo: o mesmo território dá sempre o mesmo morador, para todos, para
// sempre. Andar não cria bicho: só mostra quem mora ali. Um território que perde o morador (caça, predador, velhice)
// fica vazio por um tempo e depois é ocupado de novo por gente da mesma espécie.
//   · bicho grande (rebanho, manada, solitário de porte)   um território em ~10 tem morador, conforme o bioma
//   · bicho pequeno, ave, inseto                            um em ~5
//   · predador e gigante do mar                             um bando por bloco de SUPER × SUPER territórios (384 m),
//                                                           e nem todo bloco tem: são raros, como na natureza
// Código puro: o servidor diz o bioma de cada ponto; os testes conferem a densidade.
import { rand01, hash32 } from './nature.js';
import { ESPECIES, IDS } from './especies.js';

export const CELULA = 96;         // lado de um território (m)
export const SUPER = 4;           // predadores e gigantes: um sorteio por bloco de SUPER × SUPER territórios
// Quanto de vida cada bioma sustenta (1 = savana, recife, água doce).
export const RIQUEZA = { savana: 1, floresta: 0.95, campo: 0.85, 'floresta fria': 0.8, praia: 0.75, montanha: 0.6, neve: 0.45, deserto: 0.35, doce: 1, recife: 1, mar: 1 };
// Chance de um território ter morador de cada guilda num bioma de riqueza 1 (os de bloco valem para o bloco inteiro).
export const OCUPACAO = { grande: 0.12, pequeno: 0.26, ave: 0.3, inseto: 0.14, doce: 0.45, costeiro: 0.3, pelagico: 0.1, predador: 0.42, gigante: 0.3 };
// Tamanho máximo do grupo que se vê junto, por guilda (a ficha diz o natural; bandos gigantes ficam para as migrações).
const TETO = { grande: 22, pequeno: 5, ave: 8, inseto: 8, doce: 12, costeiro: 6, pelagico: 18, predador: 7, gigante: 3 };
export const GUILDAS = ['grande', 'pequeno', 'ave', 'inseto', 'doce', 'costeiro', 'pelagico'];
export const GUILDAS_BLOCO = ['predador', 'gigante'];
const DE_AGUA = new Set(['doce', 'costeiro', 'pelagico', 'gigante']);
const AGUAS = new Set(['doce', 'recife', 'mar']);
export const eAgua = (bioma) => AGUAS.has(bioma);

const massaMedia = (e) => (e.massa[0] + e.massa[1]) / 2;
// A que guilda(s) a espécie pertence (pela ficha). Peixe que vive em rio e mar entra nas duas.
const CACHE = new Map();
export function guildasDe(id) {
  if (CACHE.has(id)) return CACHE.get(id);
  const e = ESPECIES[id], out = [];
  if (e && !e.extinto) {
    if (e.meio === 'agua') {
      if (e.biomas.includes('doce')) out.push('doce');
      if (e.biomas.includes('recife')) out.push('costeiro');
      if (e.biomas.includes('mar')) out.push(massaMedia(e) >= 1000 || (e.dieta === 'carnivoro' && e.perigo >= 0.4) ? 'gigante' : 'pelagico');
    } else if (e.dieta !== 'herbivoro' && e.dieta !== 'insetivoro' && e.classe !== 'ave' && e.perigo >= 0.5 && massaMedia(e) >= 30) out.push('predador');
    else if (e.classe === 'invertebrado') out.push('inseto');
    else if (e.classe === 'ave') out.push('ave');
    else out.push(e.alt >= 0.6 || massaMedia(e) >= 40 ? 'grande' : 'pequeno');
  }
  CACHE.set(id, out);
  return out;
}
// Espécies de uma guilda que vivem num bioma, com o peso de encontro (a abundância da ficha).
const POR = new Map();
export function candidatos(guilda, bioma) {
  const k = guilda + '|' + bioma;
  if (POR.has(k)) return POR.get(k);
  const out = [];
  for (const id of IDS) {
    if (!guildasDe(id).includes(guilda)) continue;
    const e = ESPECIES[id];
    if (!e.biomas.includes(bioma)) continue;
    if (e.meio !== 'agua' && eAgua(bioma)) continue;                 // bicho de terra nasce em terra (o anfíbio, na margem)
    out.push([id, e.abund]);
  }
  POR.set(k, out);
  return out;
}
function sorteia(lista, u) {
  let s = 0; for (const [, w] of lista) s += w;
  let x = u * s;
  for (const [id, w] of lista) { x -= w; if (x <= 0) return id; }
  return lista.length ? lista[lista.length - 1][0] : null;
}
// Quantos indivíduos tem o grupo que mora ali: do mínimo natural para cima, com os grupos pequenos mais comuns.
export function tamanhoGrupo(id, guilda, u) {
  const e = ESPECIES[id], max = Math.max(e.grupo[0], Math.min(e.grupo[1], TETO[guilda] || 8));
  return e.grupo[0] + Math.floor(u * u * (max - e.grupo[0] + 1));
}
// Até onde o grupo se afasta de casa (m): quem é grande e quem caça anda mais.
export function raioDoLar(id) {
  const e = ESPECIES[id], g = guildasDe(id)[0];
  if (g === 'predador' || g === 'gigante') return 150;
  if (g === 'pelagico') return 90;
  if (e.meio === 'ar' || e.voa) return 70;
  return Math.max(18, Math.min(60, 20 + e.alt * 20));
}
export const celulaDe = (x, z) => [Math.floor(x / CELULA), Math.floor(z / CELULA)];
export const chaveDe = (cx, cz, guilda) => cx + ',' + cz + ',' + guilda;
const N_GUILDA = Object.fromEntries([...GUILDAS, ...GUILDAS_BLOCO].map((g, i) => [g, i + 1]));

// Quem vive na beira da água: 'doce' (hipopótamo, castor, sapo, cisne, grou, crocodilo…) ou 'mar' (foca, pinguim,
// caranguejo). Só mora em território que tenha essa água, e a casa fica na margem dela.
export function margemDe(id) {
  const e = ESPECIES[id];
  if (!e || e.meio === 'agua') return null;
  if (e.biomas.includes('doce')) return e.meio === 'anfibio' || e.biomas.every((b) => b === 'doce') ? 'doce' : 'doce?';   // 'doce?' = gosta de água doce, mas vive sem ela
  return e.meio === 'anfibio' ? 'mar' : null;
}
const DA_GUILDA = new Map();
function daGuilda(g) { if (!DA_GUILDA.has(g)) DA_GUILDA.set(g, IDS.filter((id) => guildasDe(id).includes(g) && ESPECIES[id].meio !== 'agua')); return DA_GUILDA.get(g); }

// Os moradores do território (cx, cz). biomaEm(x, z) devolve o bioma daquele ponto ('campo', 'floresta'… ou, sobre
// água, 'doce' | 'recife' | 'mar'). densidade multiplica todas as chances (1 = o padrão).
// Devolve [{ k (chave do território + guilda), g (guilda), especie, n, x, z (onde fica a casa), margem (a casa é um
// ponto de água: o bicho mora na beira dela), seed }].
// opt.peso(id) multiplica a frequência de uma espécie dentro da guilda; opt.ativa(id) = false deixa a vaga dela vazia
// (o sorteio é feito com todas, para que ligar uma espécie não a faça tomar o lugar das outras).
export function moradores(seed, cx, cz, biomaEm, densidade = 1, opt = {}) {
  // seis pontos do território, olhados uma vez: terra de que bioma, água doce, recife ou mar aberto
  const terra = [], doce = [], recife = [], mar = [];
  for (let k = 0; k < 6; k++) {
    const x = (cx + 0.12 + 0.76 * rand01(seed, hash32(cx, cz, 11), k * 2 + 1)) * CELULA, z = (cz + 0.12 + 0.76 * rand01(seed, hash32(cx, cz, 13), k * 2 + 2)) * CELULA;
    const b = biomaEm(x, z);
    if (!b) continue;
    (b === 'doce' ? doce : b === 'recife' ? recife : b === 'mar' ? mar : terra).push({ x, z, b });
  }
  const pega = (lista, i) => (lista.length ? lista[i % lista.length] : null);
  const sal = recife.length ? recife : mar;
  const out = [];
  const tenta = (g, s, p, lista, casa) => {
    if (!p || !lista.length) return;
    if (rand01(s, 1) >= OCUPACAO[g] * (RIQUEZA[p.b] ?? 0.5) * densidade) return;
    const especie = sorteia(opt.peso ? lista.map(([id, w]) => [id, w * opt.peso(id)]) : lista, rand01(s, 2));
    if (!especie || (opt.ativa && !opt.ativa(especie))) return;
    const h = casa ? casa(especie) : null, q = h || p;
    out.push({ k: chaveDe(cx, cz, g), g, especie, n: tamanhoGrupo(especie, g, rand01(s, 3)), x: q.x, z: q.z, margem: !!h, seed: s });
  };
  for (const g of GUILDAS) {
    const i = N_GUILDA[g], s = hash32(seed, hash32(cx, cz, 101), i);
    if (g === 'doce') tenta(g, s, pega(doce, i), candidatos(g, 'doce'));
    else if (g === 'costeiro') tenta(g, s, pega(recife, i), candidatos(g, 'recife'));
    else if (g === 'pelagico') tenta(g, s, pega(mar, i), candidatos(g, 'mar'));
    else {
      const p = pega(terra, i);
      if (!p) continue;
      // de terra: quem é do bioma; quem é de margem só entra se o território tem a água dele (e pesa o dobro: a água
      // junta bicho)
      const lista = [];
      for (const id of daGuilda(g)) {
        const e = ESPECIES[id], m = margemDe(id), noBioma = e.biomas.includes(p.b);
        if (!m || m === 'doce?') { if (noBioma) lista.push([id, e.abund * (m && doce.length ? 2 : 1)]); else if (m && doce.length) lista.push([id, e.abund * 2]); }
        else if (m === 'doce') { if (doce.length) lista.push([id, e.abund * 2]); }
        else if (sal.length && noBioma) lista.push([id, e.abund * 2]);
      }
      tenta(g, s, p, lista, (id) => { const m = margemDe(id); return m === 'doce' || (m === 'doce?' && doce.length) ? pega(doce, i) : m === 'mar' ? pega(sal, i) : null; });
    }
  }
  // predador e gigante do mar: um por bloco; a toca cai num dos territórios do bloco
  const sx = Math.floor(cx / SUPER), sz = Math.floor(cz / SUPER);
  for (const g of GUILDAS_BLOCO) {
    const i = N_GUILDA[g], s = hash32(seed, hash32(sx, sz, 211), i);
    const tx = sx * SUPER + Math.floor(rand01(s, 4) * SUPER), tz = sz * SUPER + Math.floor(rand01(s, 5) * SUPER);
    if (tx !== cx || tz !== cz) continue;
    if (g === 'gigante') { tenta(g, s, pega(mar, i), candidatos(g, 'mar')); continue; }
    const p = pega(terra, i);
    if (!p) continue;
    const lista = [];
    for (const id of daGuilda(g)) {
      const e = ESPECIES[id], m = margemDe(id);
      if (m === 'doce' ? doce.length : m === 'mar' ? sal.length && e.biomas.includes(p.b) : e.biomas.includes(p.b)) lista.push([id, e.abund]);
    }
    tenta(g, s, p, lista, (id) => { const m = margemDe(id); return m === 'doce' ? pega(doce, i) : m === 'mar' ? pega(sal, i) : null; });
  }
  return out;
}
