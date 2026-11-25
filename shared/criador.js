// Kraft — criador de personagem "monte o seu": a receita compacta que vai pela rede e o catálogo fechado de peças.
// Tudo é original do Kraft. O aparelho monta o boneco a partir da receita (render/criador-atlas.js pinta o atlas,
// render/criador-pecas.js põe as peças 3D nos ossos); o servidor só aceita o que está neste catálogo.
//
// Receita (todas as partes opcionais; parte ausente ou null = não aplica e a base aparece):
//   { corpo:  { pele, cabeca, tronco, bracos, pernas, fino },          cores '#rrggbb'; fino = braços de 3 px
//     prop:   { altura, largura },                                     0,90–1,10 (só visual: não muda colisão)
//     rosto:  { olhos, sobrancelhas, boca, corOlhos },
//     cabelo: { estilo, cor },
//     camisa: { estilo, padrao, cor, cor2 },  calca: { estilo, padrao, cor, cor2 },  sapato: { estilo, cor },
//     acess:  { chapeu: { id, cor }, oculos: { id, cor }, costas: { id, cor }, pescoco: { id, cor } } }

const lista = (pares) => pares.map(([id, nome]) => ({ id, nome }));
export const CATALOGO = {
  olhos: lista([['redondos', 'Redondos'], ['amendoados', 'Amendoados'], ['sonolentos', 'Sonolentos'], ['brilhantes', 'Brilhantes'], ['fechados', 'Sorrindo de olho fechado'], ['grandes', 'Grandes']]),
  sobrancelhas: lista([['nenhuma', 'Nenhuma'], ['retas', 'Retas'], ['arqueadas', 'Arqueadas'], ['grossas', 'Grossas'], ['bravas', 'Bravas']]),
  bocas: lista([['sorriso', 'Sorriso'], ['neutra', 'Neutra'], ['aberta', 'Aberta'], ['de-lado', 'De lado'], ['surpresa', 'Surpresa'], ['dentes', 'Dentes à mostra']]),
  cabelos: lista([['nenhum', 'Sem cabelo'], ['curto', 'Curto'], ['espetado', 'Espetado'], ['franja', 'Franja'], ['longo', 'Longo'], ['rabo', 'Rabo de cavalo'], ['coque', 'Coque'], ['volume', 'Volumoso'], ['moicano', 'Moicano'], ['trancas', 'Tranças']]),
  camisas: lista([['nenhuma', 'Nenhuma'], ['camiseta', 'Camiseta'], ['manga-longa', 'Manga longa'], ['regata', 'Regata'], ['moletom', 'Moletom'], ['social', 'Camisa social']]),
  padroes: lista([['liso', 'Liso'], ['listras', 'Listras'], ['xadrez', 'Xadrez'], ['gola', 'Gola em V'], ['faixa', 'Faixa diagonal'], ['bolinhas', 'Bolinhas']]),
  calcas: lista([['nenhuma', 'Nenhuma'], ['calca', 'Calça'], ['bermuda', 'Bermuda'], ['macacao', 'Macacão']]),
  padroesCalca: lista([['liso', 'Liso'], ['listra-lateral', 'Listra lateral'], ['xadrez', 'Xadrez'], ['joelheira', 'Joelheira']]),
  sapatos: lista([['nenhum', 'Descalço'], ['tenis', 'Tênis'], ['bota', 'Bota'], ['sapatilha', 'Sapatilha']]),
  chapeus: lista([['nenhum', 'Nenhum'], ['bone', 'Boné'], ['gorro', 'Gorro'], ['aba-larga', 'Chapéu de aba larga'], ['cartola', 'Cartola'], ['coroa', 'Coroa'], ['faixa', 'Faixa de cabeça']]),
  oculos: lista([['nenhum', 'Nenhum'], ['redondos', 'Redondos'], ['quadrados', 'Quadrados'], ['viseira', 'Viseira'], ['escuros', 'Escuros']]),
  costas: lista([['nenhuma', 'Nada'], ['capa', 'Capa'], ['mochila', 'Mochila'], ['foguete', 'Mochila-foguete']]),
  pescoco: lista([['nenhum', 'Nada'], ['cachecol', 'Cachecol'], ['colar', 'Colar'], ['gravata', 'Gravata']]),
};
export const SLOTS_ACESSORIO = { chapeu: 'chapeus', oculos: 'oculos', costas: 'costas', pescoco: 'pescoco' };
export const PROP_MIN = 0.9, PROP_MAX = 1.1;
export const TONS_PELE = ['#f6d7c3', '#eec1a0', '#d9a27e', '#c98d65', '#a86f4c', '#8d5a3b', '#6b4329', '#4a2d1c'];
export const CORES_CABELO = ['#1d1612', '#3b2618', '#6a4327', '#9b6a3c', '#d7b06a', '#e9e0c9', '#b2412e', '#5b7bd6', '#c4569a', '#3f9a72'];

const ids = (k) => CATALOGO[k].map((o) => o.id);
const hex = (v, fb) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fb;
const de = (k, v, fb) => ids(k).includes(v) ? v : fb;
const faixa = (v, fb = 1) => Number.isFinite(v) ? Math.round(Math.min(PROP_MAX, Math.max(PROP_MIN, v)) * 100) / 100 : fb;
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : null;

export function normalizarCriador(raw) {
  raw = obj(raw);
  if (!raw) return null;
  const out = {};
  const corpo = obj(raw.corpo);
  if (corpo) {
    const pele = hex(corpo.pele, '#c98d65');
    out.corpo = { pele, cabeca: hex(corpo.cabeca, pele), tronco: hex(corpo.tronco, pele), bracos: hex(corpo.bracos, pele), pernas: hex(corpo.pernas, pele), fino: corpo.fino === true };
  } else out.corpo = null;
  const prop = obj(raw.prop);
  out.prop = prop ? { altura: faixa(prop.altura), largura: faixa(prop.largura) } : null;
  if (out.prop && out.prop.altura === 1 && out.prop.largura === 1) out.prop = null;
  const rosto = obj(raw.rosto);
  out.rosto = rosto ? {
    olhos: de('olhos', rosto.olhos, 'redondos'), sobrancelhas: de('sobrancelhas', rosto.sobrancelhas, 'retas'),
    boca: de('bocas', rosto.boca, 'sorriso'), corOlhos: hex(rosto.corOlhos, '#3b2a1e'),
  } : null;
  const cabelo = obj(raw.cabelo);
  out.cabelo = cabelo && de('cabelos', cabelo.estilo, 'nenhum') !== 'nenhum' ? { estilo: cabelo.estilo, cor: hex(cabelo.cor, '#3b2618') } : null;
  const camisa = obj(raw.camisa);
  out.camisa = camisa && de('camisas', camisa.estilo, 'nenhuma') !== 'nenhuma'
    ? { estilo: camisa.estilo, padrao: de('padroes', camisa.padrao, 'liso'), cor: hex(camisa.cor, '#3f7fbf'), cor2: hex(camisa.cor2, '#f0ede4') } : null;
  const calca = obj(raw.calca);
  out.calca = calca && de('calcas', calca.estilo, 'nenhuma') !== 'nenhuma'
    ? { estilo: calca.estilo, padrao: de('padroesCalca', calca.padrao, 'liso'), cor: hex(calca.cor, '#34465e'), cor2: hex(calca.cor2, '#d9d3c4') } : null;
  const sapato = obj(raw.sapato);
  out.sapato = sapato && de('sapatos', sapato.estilo, 'nenhum') !== 'nenhum' ? { estilo: sapato.estilo, cor: hex(sapato.cor, '#2c2a2a') } : null;
  const acess = obj(raw.acess), a = {};
  for (const [slot, k] of Object.entries(SLOTS_ACESSORIO)) {
    const v = obj(acess?.[slot]);
    const id = v ? de(k, v.id, CATALOGO[k][0].id) : CATALOGO[k][0].id;
    if (id !== CATALOGO[k][0].id) a[slot] = { id, cor: hex(v.cor, '#b84a3a') };
  }
  out.acess = Object.keys(a).length ? a : null;
  return Object.values(out).some(Boolean) ? out : null;
}

// Ponto de partida do "Começar a criar" e do "Restaurar padrão" dentro do criador.
export function criadorPadrao() {
  return normalizarCriador({
    corpo: { pele: '#c98d65' }, rosto: { olhos: 'redondos', sobrancelhas: 'retas', boca: 'sorriso', corOlhos: '#3b2a1e' },
    cabelo: { estilo: 'curto', cor: '#3b2618' },
    camisa: { estilo: 'camiseta', padrao: 'liso', cor: '#3f7fbf', cor2: '#f0ede4' },
    calca: { estilo: 'calca', padrao: 'liso', cor: '#34465e', cor2: '#d9d3c4' },
    sapato: { estilo: 'tenis', cor: '#2c2a2a' },
  });
}

// Aleatório: `sorte()` devolve [0, 1) (Math.random no aparelho; um gerador fixo nos testes).
const CORES_ROUPA = ['#3f7fbf', '#c0463a', '#4f8f4a', '#e0a634', '#7a4fa3', '#2b2f3a', '#e9e4d6', '#d8708f', '#2f8c8c', '#8a5a33', '#5b6470', '#f08a3c'];
export function criadorAleatorio(sorte = Math.random) {
  const um = (arr) => arr[Math.floor(sorte() * arr.length) % arr.length];
  const doCat = (k, pular = 0) => um(ids(k).slice(pular));
  const pele = um(TONS_PELE);
  const acess = {};
  for (const [slot, k] of Object.entries(SLOTS_ACESSORIO)) if (sorte() < 0.35) acess[slot] = { id: doCat(k, 1), cor: um(CORES_ROUPA) };
  return normalizarCriador({
    corpo: { pele, fino: sorte() < 0.5 },
    prop: { altura: 0.94 + Math.round(sorte() * 12) / 100, largura: 0.95 + Math.round(sorte() * 10) / 100 },
    rosto: { olhos: doCat('olhos'), sobrancelhas: doCat('sobrancelhas'), boca: doCat('bocas'), corOlhos: um(['#3b2a1e', '#2d5f8a', '#3f7a44', '#6b4b2a', '#1f1f24']) },
    cabelo: { estilo: doCat('cabelos', 1), cor: um(CORES_CABELO) },
    camisa: { estilo: doCat('camisas', 1), padrao: doCat('padroes'), cor: um(CORES_ROUPA), cor2: um(CORES_ROUPA) },
    calca: { estilo: doCat('calcas', 1), padrao: doCat('padroesCalca'), cor: um(CORES_ROUPA), cor2: um(CORES_ROUPA) },
    sapato: { estilo: doCat('sapatos', 1), cor: um(CORES_ROUPA) },
    acess,
  });
}
