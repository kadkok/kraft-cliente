// Kraft — "Mockup para IA" do estúdio de skins: o pacote que a pessoa leva para QUALQUER IA (no aparelho dela, o
// jogo não manda nada para fora) e a conferência do que a IA devolve. Só lógica pura, sem DOM nem three: serve ao
// estúdio (game/estudio-mockup.js) e aos testes. O desenho das vistas fica em render/mockup-folha.js.
//
// Ida:   ficha (kraft-ficha-ia.json) + gabarito do atlas (PNG 64×64 utilizável e guia 640×640) + folha com frente,
//        costas e laterais no boneco do jogo + prompt em português + exemplo de resposta. Tudo num .zip.
// Volta: resposta.json (formato "kraft-resposta-ia") e/ou um PNG de skin. Tudo passa por `validarResposta`, que só
//        devolve o que o renderer e o servidor de hoje aceitam (listas fechadas do criador, cores #rrggbb, faixas,
//        dimensões exatas de cada face). O resto volta como erro ou aviso, nunca é aplicado em silêncio.

import { skinParts, skinRects, SKINS_JOGO, SKIN_PNG_MAX } from './skin-atlas.js';
import { CATALOGO, SLOTS_ACESSORIO, PROP_MIN, PROP_MAX } from './criador.js';
import { PECAS_EXPLORADOR } from './estudio-skins.js';

export const FORMATO_FICHA = 'kraft-ficha-ia';
export const FORMATO_RESPOSTA = 'kraft-resposta-ia';
export const VERSAO_MOCKUP = 1;
export const RESPOSTA_MAX_BYTES = 256 * 1024;
export const ZIP_MAX_BYTES = 8 * 1024 * 1024;
export const ZIP_MAX_ARQUIVOS = 32;

// Nomes em português (os da ficha e da resposta) ↔ nomes do código.
export const PARTES = [
  { chave: 'cabeca', parte: 'head', nome: 'Cabeça', osso: 'head' },
  { chave: 'tronco', parte: 'torso', nome: 'Tronco', osso: 'root' },
  { chave: 'bracoD', parte: 'armR', nome: 'Braço direito', osso: 'armR (+ cotovelo)' },
  { chave: 'bracoE', parte: 'armL', nome: 'Braço esquerdo', osso: 'armL (+ cotovelo)' },
  { chave: 'pernaD', parte: 'legR', nome: 'Perna direita', osso: 'legR (+ joelho)' },
  { chave: 'pernaE', parte: 'legL', nome: 'Perna esquerda', osso: 'legL (+ joelho)' },
];
// Mesma ordem de skinRects (BoxGeometry): +X, −X, +Y, −Y, +Z, −Z. A frente do boneco é −Z e a direita dele é +X.
export const FACES = ['direita', 'esquerda', 'topo', 'base', 'costas', 'frente'];
export const CAMADAS = ['dentro', 'fora'];
// Habilidades: o que de fato existe no jogo ligado à skin. São efeitos VISUAIS que o servidor só publica com o Modo
// GM ligado (world.normalizarSkinDe → normalizarSkin(raw, gmAtivo)). Não há poder de jogo por skin.
export const EFEITOS = { brilho: 'Brilho (emissivo)', reflexo: 'Reflexo (metálico)', fumaca: 'Fumaça (partículas)' };
export const REGIOES_EFEITO = ['torso', 'head', 'armL', 'armR', 'legL', 'legR', ...Object.keys(PECAS_EXPLORADOR)];
const PARTIR_DE = ['atual', 'vazio', ...SKINS_JOGO];

const parteDe = Object.fromEntries(PARTES.map((p) => [p.chave, p]));
const hexOk = (v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const idsDe = (k) => CATALOGO[k].map((o) => o.id);

// Retângulo [x, y, w, h] de uma face no atlas de 64 px.
export function retanguloFace(chave, face, camada = 'dentro', slim = false) {
  const p = parteDe[chave];
  const f = FACES.indexOf(face);
  if (!p || f < 0 || !CAMADAS.includes(camada)) return null;
  const part = skinParts(slim).find((x) => x.name === p.parte);
  return skinRects(part.size, camada === 'dentro' ? part.base : part.outer)[f];
}

// Todas as faces, com a chave usada na resposta ("cabeca.frente" = camada de dentro, "cabeca.frente.fora").
export function listaFaces(slim = false) {
  const out = [];
  for (const p of PARTES) for (const camada of CAMADAS) for (const face of FACES) {
    out.push({ chave: `${p.chave}.${face}${camada === 'fora' ? '.fora' : ''}`, parte: p.chave, face, camada, rect: retanguloFace(p.chave, face, camada, slim) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Gabarito 64×64: cada parte com um matiz, cada face com um tom, a frente com uma seta para cima (o topo da face) e
// a camada de fora transparente. Serve de skin de verdade (o boneco fica "colorido por região" no jogo).
const MATIZ = { cabeca: 0, tronco: 130, bracoD: 215, bracoE: 185, pernaD: 30, pernaE: 280 };
const TOM_FACE = [0.62, 0.5, 0.78, 0.36, 0.44, 0.7];
export function hslRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}
export function corGabarito(chave, face) { return hslRgb(MATIZ[chave], 0.62, TOM_FACE[FACES.indexOf(face)]); }

export function gabarito64(slim = false) {
  const px = new Uint8ClampedArray(64 * 64 * 4);
  for (const f of listaFaces(slim)) {
    if (f.camada !== 'dentro') continue;
    const [x, y, w, h] = f.rect, [r, g, b] = corGabarito(f.parte, f.face);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = (yy * 64 + xx) * 4;
      // borda da face 1 px mais escura: mostra onde uma face acaba no boneco
      const borda = xx === x || yy === y || xx === x + w - 1 || yy === y + h - 1;
      const k = borda && w > 2 && h > 2 ? 0.72 : 1;
      px[i] = r * k; px[i + 1] = g * k; px[i + 2] = b * k; px[i + 3] = 255;
    }
    // marca "topo da face" (2 px claros no meio da primeira linha) e, na frente, um ponto central
    if (w >= 3) for (const xx of [x + (w >> 1) - 1, x + (w >> 1)]) { const i = (y * 64 + xx) * 4; px[i] = px[i + 1] = px[i + 2] = 250; }
    if (f.face === 'frente') { const i = ((y + (h >> 1)) * 64 + x + (w >> 1)) * 4; px[i] = px[i + 1] = px[i + 2] = 20; }
  }
  return px;
}

// ---------------------------------------------------------------------------------------------------------------
// Ficha técnica: tudo o que a IA precisa saber, com os números do código de hoje. `extra` vem do aparelho
// (render/mockup-folha.js): caixas reais das peças 3D por slot e a orientação medida de cada face na malha do jogo.
export function montarFicha(extra = {}) {
  const partes = PARTES.map((p) => {
    const part = skinParts(false).find((x) => x.name === p.parte), fino = skinParts(true).find((x) => x.name === p.parte);
    const faces = {}, finos = {};
    for (const face of FACES) {
      faces[face] = { dentro: retanguloFace(p.chave, face, 'dentro'), fora: retanguloFace(p.chave, face, 'fora') };
      if (fino.size[0] !== part.size[0]) finos[face] = { dentro: retanguloFace(p.chave, face, 'dentro', true), fora: retanguloFace(p.chave, face, 'fora', true) };
    }
    return {
      chave: p.chave, nome: p.nome, osso: p.osso, tamanho_px: { largura: part.size[0], altura: part.size[1], profundidade: part.size[2] },
      faces, ...(Object.keys(finos).length ? { faces_bracos_finos: finos, tamanho_px_bracos_finos: { largura: fino.size[0], altura: fino.size[1], profundidade: fino.size[2] } } : {}),
    };
  });
  const opcoes = (k) => CATALOGO[k].map((o) => ({ id: o.id, nome: o.nome }));
  const slots = {
    cabelo: { osso: 'head', opcoes: opcoes('cabelos'), campos: { estilo: 'id da lista', cor: '#rrggbb' }, nota: 'Some debaixo de chapéu (menos a faixa de cabeça).' },
    ...Object.fromEntries(Object.entries(SLOTS_ACESSORIO).map(([slot, k]) => [slot, {
      osso: slot === 'costas' || slot === 'pescoco' ? 'root (tronco)' : 'head', opcoes: opcoes(k), campos: { id: 'id da lista', cor: '#rrggbb' },
    }])),
  };
  for (const [slot, info] of Object.entries(extra.caixas || {})) if (slots[slot]) slots[slot].caixa_max_unidades = info;
  return {
    formato: FORMATO_FICHA, versao: VERSAO_MOCKUP, jogo: 'Kraft (kraft.k14.uk)',
    gerado_em: extra.geradoEm || null,
    privacidade: 'O jogo não envia este pacote a nenhuma IA. Você leva os arquivos para a IA que quiser.',
    atlas: {
      largura: 64, altura: 64, origem: 'canto superior esquerdo (x para a direita, y para baixo)',
      hd: 'também aceita PNG quadrado em múltiplos de 64 até 1024×1024 (cada pixel de 64 vira um bloco)',
      atlas_no_jogo: 640, png_max_bytes: SKIN_PNG_MAX,
      camada_dentro: 'sempre opaca (o jogo força alfa 255)', camada_fora: 'transparente onde não houver nada; o renderer corta o alfa em 50% (alphaTest 0,5)',
      fora_das_regioes: 'ignorado pelo jogo', estilo: 'pixel art nítido, sem antisserrilhado, sem sombra projetada, sem perspectiva: é a planificação (UV) do boneco',
      formato_compativel: 'layout compatível com o das skins de Minecraft (64×64, braços clássicos de 4 px ou finos de 3 px). Arte, nomes e logos de terceiros não.',
    },
    boneco: {
      altura_m: 1.8, unidade_m: 1.8 / 32, frente: '−Z', direita_do_personagem: '+X', ossos: 10,
      proporcoes: { altura: [PROP_MIN, PROP_MAX], largura: [PROP_MIN, PROP_MAX], nota: 'só visual: colisão e física não mudam' },
      bracos: { classicos_px: 4, finos_px: 3, deteccao: 'no PNG, x 54–55 e y 20–31 transparentes = braços finos' },
      faces: 'cada face é pintada como você a vê olhando de fora; direita/esquerda são as do PERSONAGEM (a direita dele aparece à esquerda de quem olha de frente)',
      orientacao_medida: extra.orientacao || null,
    },
    partes,
    slots,
    traje_explorador: { pecas: PECAS_EXPLORADOR, nota: 'peças 3D prontas do jogo (sim/não). A jaqueta pinta o tronco e os braços por cima.' },
    renderer: {
      pecas_do_criador: 'no máximo 2 malhas extras por boneco (cabeça e tronco), 1 material compartilhado, cor por vértice',
      um_item_por_slot: true, cores: '#rrggbb', modelos_3d_novos: 'não: só as opções da lista',
      peso_medido: { padrao_triangulos: 2912, criador_completo_triangulos: 3356, tudo_junto_triangulos: 4196 },
      ordem: ['base (PNG)', 'pintura do criador (se ligada)', 'estampas', 'peças 3D nos ossos'],
    },
    habilidades: {
      aplicaveis: Object.entries(EFEITOS).map(([tipo, nome]) => ({ tipo, nome, intensidade: [0, 1], requer: 'Modo GM ligado (o servidor confere e corta para quem não é GM)' })),
      campos_comuns: { cor: '#rrggbb (uma só para todos os efeitos)', regiao: REGIOES_EFEITO },
      nao_existe: 'Não há poderes de jogo por skin (voar, correr mais, dano, cura, escudo, teletransporte, invisibilidade...). Pode sugerir, mas eles voltam marcados como IDEIA e não são aplicados.',
    },
    resposta: {
      formato: FORMATO_RESPOSTA, versao: VERSAO_MOCKUP,
      arquivos: 'resposta.json (obrigatório) e, se quiser, skin.png (64×64 ou HD) citado em "skin_png"',
      campos: {
        nome: 'texto até 32 letras', bracos: '"classicos" | "finos"',
        partir_de: `de onde a pintura começa quando não há skin_png: ${PARTIR_DE.map((x) => `"${x}"`).join(' | ')}`,
        skin_png: 'nome do PNG enviado junto (opcional)',
        pixels: '{ paleta: { "a": "#rrggbb", ".": "transparente" }, faces: { "cabeca.frente": ["linha de largura w", ... h linhas] | "#rrggbb" } }',
        criador: '{ cabelo, acess: { chapeu, oculos, costas, pescoco }, prop } (e, se quiser, corpo/rosto/camisa/calca/sapato do criador, que pintam POR CIMA da skin)',
        traje: '{ cabelo, jaqueta, luvas, botas, mochila: true | false }',
        habilidades: '[ { nome, descricao, efeito?: { tipo, intensidade, cor, regiao } } ]',
      },
      exemplo: extra.exemplo || exemploResposta(),
    },
  };
}

// Exemplo de ida e volta (original do Kraft): parte da Botânica, pinta o rosto e o peito, chapéu e capa, e duas
// habilidades: uma aplicável (fumaça, com Modo GM) e uma ideia que o jogo não tem (voo).
export function exemploResposta() {
  const rosto = ['hhhhhhhh', 'hhhhhhhh', 'pppppppp', 'pwoppowp', 'pppppppp', 'ppprrppp', 'pppppppp', 'pppppppp'];
  const peito = ['vvvvvvvv', 'vvvvvvvv', 'vvvdvvvv', 'vvvddvvv', 'vvvvdvvv', 'vvvvvvvv', 'gggggggg', 'vvvvvvvv', 'vvvvvvvv', 'vvvvvvvv', 'vvvvvvvv', 'vvvvvvvv'];
  return {
    formato: FORMATO_RESPOSTA, versao: VERSAO_MOCKUP, nome: 'Guardiã do Mangue', bracos: 'classicos', partir_de: 'botanica',
    pixels: {
      paleta: { h: '#2a1d14', p: '#c98d65', w: '#f4f1ea', o: '#2f6b4a', r: '#9c3f3a', v: '#2f7a5c', d: '#e3c25a', g: '#5a3b22', '.': 'transparente' },
      faces: { 'cabeca.frente': rosto, 'tronco.frente': peito, 'tronco.costas': '#276a4f' },
    },
    criador: { acess: { chapeu: { id: 'aba-larga', cor: '#8a6a3a' }, costas: { id: 'capa', cor: '#1f5a46' } }, prop: { altura: 1.04, largura: 1 } },
    habilidades: [
      { nome: 'Névoa do mangue', descricao: 'Fumaça suave saindo da capa.', efeito: { tipo: 'fumaca', intensidade: 0.4, cor: '#9fd8c0', regiao: 'torso' } },
      { nome: 'Voo das garças', descricao: 'Planar sobre a água.' },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Conferência da resposta. Devolve { ok, erros[], avisos[], nome, bracos, partirDe, skinPng, pintura[], criador,
// traje, gm, habilidades: { aplicaveis[], so_gm[], ideias[] } }. `gmAtivo`: o aparelho está com o Modo GM ligado
// (o servidor confere de novo; aqui é só para dizer a verdade na tela).
const CAMPOS_RESPOSTA = ['formato', 'versao', 'nome', 'bracos', 'partir_de', 'skin_png', 'pixels', 'criador', 'traje', 'habilidades', 'observacoes'];
const CAMPOS_CRIADOR = ['corpo', 'prop', 'rosto', 'cabelo', 'camisa', 'calca', 'sapato', 'acess'];

export function validarResposta(raw, { gmAtivo = false, slimPadrao = false } = {}) {
  const erros = [], avisos = [];
  const out = { ok: false, erros, avisos, nome: '', bracos: null, partirDe: 'atual', skinPng: null, pintura: [], criador: null, traje: null, gm: null, habilidades: { aplicaveis: [], so_gm: [], ideias: [] } };
  if (typeof raw === 'string') {
    if (raw.length > RESPOSTA_MAX_BYTES) { erros.push('A resposta passa de 256 KB.'); return out; }
    // IAs costumam embrulhar o JSON em ```json ... ```: tira a cerca antes de ler
    const limpo = raw.trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
    try { raw = JSON.parse(limpo); } catch (e) { erros.push(`resposta.json não é JSON válido (${String(e.message).slice(0, 80)}).`); return out; }
  }
  raw = obj(raw);
  if (!raw) { erros.push('A resposta precisa ser um objeto JSON.'); return out; }
  if (raw.formato !== FORMATO_RESPOSTA) erros.push(`"formato" precisa ser "${FORMATO_RESPOSTA}".`);
  if (raw.versao !== VERSAO_MOCKUP) erros.push(`"versao" precisa ser ${VERSAO_MOCKUP}.`);
  for (const k of Object.keys(raw)) if (!CAMPOS_RESPOSTA.includes(k)) avisos.push(`Campo "${k}" não existe no formato e foi ignorado.`);
  if (raw.nome !== undefined) {
    if (typeof raw.nome !== 'string' || !raw.nome.trim()) avisos.push('"nome" precisa ser texto; ignorado.');
    else { out.nome = raw.nome.trim().slice(0, 32); if (raw.nome.trim().length > 32) avisos.push('"nome" cortado em 32 letras.'); }
  }
  if (raw.bracos !== undefined) {
    if (raw.bracos === 'classicos' || raw.bracos === 'finos') out.bracos = raw.bracos;
    else erros.push('"bracos" precisa ser "classicos" ou "finos".');
  }
  if (raw.partir_de !== undefined) {
    if (PARTIR_DE.includes(raw.partir_de)) out.partirDe = raw.partir_de;
    else erros.push(`"partir_de" precisa ser um de: ${PARTIR_DE.join(', ')}.`);
  }
  if (raw.skin_png !== undefined) {
    if (typeof raw.skin_png === 'string' && /^[\w .()-]{1,80}\.png$/i.test(raw.skin_png)) out.skinPng = raw.skin_png;
    else erros.push('"skin_png" precisa ser o nome de um arquivo .png (sem pastas).');
  }
  if (raw.pixels !== undefined) pixels(raw.pixels, out.bracos ? out.bracos === 'finos' : !!slimPadrao, out, erros, avisos);
  if (raw.criador !== undefined) criador(raw.criador, out, erros, avisos);
  if (raw.traje !== undefined) {
    const t = obj(raw.traje);
    if (!t) erros.push('"traje" precisa ser um objeto { peça: true/false }.');
    else {
      const traje = {};
      for (const [k, v] of Object.entries(t)) {
        if (!Object.hasOwn(PECAS_EXPLORADOR, k)) { avisos.push(`Peça de traje "${k}" não existe (há: ${Object.keys(PECAS_EXPLORADOR).join(', ')}).`); continue; }
        if (typeof v !== 'boolean') { erros.push(`traje.${k} precisa ser true ou false.`); continue; }
        traje[k] = v;
      }
      out.traje = Object.values(traje).some(Boolean) ? traje : null;
    }
  }
  if (raw.habilidades !== undefined) habilidades(raw.habilidades, out, erros, avisos, gmAtivo);
  if (!out.skinPng && !out.pintura.length && !out.criador && !out.traje && !out.gm) avisos.push('A resposta não muda nada no boneco (sem skin_png, pixels, criador, traje ou efeito).');
  out.ok = erros.length === 0;
  return out;
}

function pixels(raw, slim, out, erros, avisos) {
  const p = obj(raw);
  if (!p) { erros.push('"pixels" precisa ser um objeto { paleta, faces }.'); return; }
  const paleta = new Map();
  const pal = p.paleta === undefined ? {} : obj(p.paleta);
  if (!pal) { erros.push('"pixels.paleta" precisa ser um objeto { letra: "#rrggbb" }.'); return; }
  for (const [k, v] of Object.entries(pal)) {
    if ([...k].length !== 1) { erros.push(`Paleta: a chave "${k}" precisa ser UM caractere.`); continue; }
    if (v === 'transparente' || v === null) paleta.set(k, null);
    else if (hexOk(v)) paleta.set(k, v.toLowerCase());
    else erros.push(`Paleta "${k}": "${v}" não é #rrggbb nem "transparente".`);
  }
  const faces = obj(p.faces);
  if (!faces) { erros.push('"pixels.faces" precisa ser um objeto { "parte.face": linhas | "#rrggbb" }.'); return; }
  const chaves = Object.keys(faces);
  if (chaves.length > 72) { erros.push('"pixels.faces" tem mais de 72 faces (o boneco tem 72).'); return; }
  for (const chave of chaves) {
    const m = /^([a-zA-Z]+)\.([a-z]+)(\.fora)?$/.exec(chave);
    const rect = m && retanguloFace(m[1], m[2], m[3] ? 'fora' : 'dentro', slim);
    if (!rect) { erros.push(`Face "${chave}" não existe. Use parte.face ou parte.face.fora, com parte em ${PARTES.map((x) => x.chave).join('/')} e face em ${FACES.join('/')}.`); continue; }
    const [, , w, h] = rect, fora = !!m[3], v = faces[chave];
    if (typeof v === 'string') {
      if (!hexOk(v) && v !== 'transparente') { erros.push(`${chave}: cor "${v}" não é #rrggbb.`); continue; }
      if (v === 'transparente' && !fora) { erros.push(`${chave}: a camada de dentro não pode ser transparente.`); continue; }
      out.pintura.push({ chave, rect, cores: Array.from({ length: w * h }, () => v === 'transparente' ? null : v.toLowerCase()) });
      continue;
    }
    if (!Array.isArray(v) || v.length !== h || v.some((l) => typeof l !== 'string')) {
      erros.push(`${chave}: precisa de ${h} linhas de texto (largura ${w}); veio ${Array.isArray(v) ? v.length + ' linhas' : typeof v}.`);
      continue;
    }
    const cores = [];
    let ruim = null;
    v.forEach((linha, y) => {
      const cs = [...linha];
      if (cs.length !== w) { ruim ||= `${chave}: a linha ${y + 1} tem ${cs.length} pixels; a face tem ${w} de largura.`; return; }
      for (const c of cs) {
        if (!paleta.has(c)) { ruim ||= `${chave}: "${c}" (linha ${y + 1}) não está na paleta.`; return; }
        const cor = paleta.get(c);
        if (cor === null && !fora) { ruim ||= `${chave}: transparente na camada de dentro (linha ${y + 1}); a de dentro é sempre opaca.`; return; }
        cores.push(cor);
      }
    });
    if (ruim) { erros.push(ruim); continue; }
    out.pintura.push({ chave, rect, cores });
  }
  for (const k of Object.keys(p)) if (k !== 'paleta' && k !== 'faces') avisos.push(`pixels.${k} não existe e foi ignorado.`);
}

function criador(raw, out, erros, avisos) {
  const c = obj(raw);
  if (!c) { erros.push('"criador" precisa ser um objeto.'); return; }
  const res = {};
  for (const k of Object.keys(c)) if (!CAMPOS_CRIADOR.includes(k)) avisos.push(`criador.${k} não existe e foi ignorado.`);
  const lista = (k, v, campo) => {
    if (idsDe(k).includes(v)) return true;
    erros.push(`${campo}: "${v}" não está na lista (${idsDe(k).join(', ')}).`);
    return false;
  };
  const cor = (v, campo) => { if (hexOk(v)) return v.toLowerCase(); erros.push(`${campo}: "${v}" não é #rrggbb.`); return null; };
  if (c.cabelo !== undefined && c.cabelo !== null) {
    const h = obj(c.cabelo);
    if (!h) erros.push('criador.cabelo precisa ser { estilo, cor }.');
    else if (lista('cabelos', h.estilo, 'criador.cabelo.estilo')) { const k = cor(h.cor, 'criador.cabelo.cor'); if (k) res.cabelo = { estilo: h.estilo, cor: k }; }
  }
  if (c.acess !== undefined && c.acess !== null) {
    const a = obj(c.acess);
    if (!a) erros.push('criador.acess precisa ser { chapeu, oculos, costas, pescoco }.');
    else {
      const acess = {};
      for (const [slot, v] of Object.entries(a)) {
        const k = SLOTS_ACESSORIO[slot];
        if (!k) { erros.push(`Slot "${slot}" não existe (há: ${Object.keys(SLOTS_ACESSORIO).join(', ')}). Um item por slot.`); continue; }
        if (v === null) continue;
        const item = obj(v);
        if (!item) { erros.push(`criador.acess.${slot} precisa ser { id, cor }.`); continue; }
        if (!lista(k, item.id, `criador.acess.${slot}.id`)) continue;
        const cc = cor(item.cor, `criador.acess.${slot}.cor`);
        if (cc && item.id !== CATALOGO[k][0].id) acess[slot] = { id: item.id, cor: cc };
      }
      if (Object.keys(acess).length) res.acess = acess;
    }
  }
  if (c.prop !== undefined && c.prop !== null) {
    const p = obj(c.prop);
    if (!p) erros.push('criador.prop precisa ser { altura, largura }.');
    else {
      const faixa = (v, campo) => {
        if (v === undefined) return 1;
        if (!Number.isFinite(v)) { erros.push(`${campo} precisa ser número.`); return 1; }
        if (v < PROP_MIN || v > PROP_MAX) avisos.push(`${campo} ${v} fora de ${PROP_MIN}–${PROP_MAX}: cortado.`);
        return Math.round(Math.min(PROP_MAX, Math.max(PROP_MIN, v)) * 100) / 100;
      };
      const prop = { altura: faixa(p.altura, 'criador.prop.altura'), largura: faixa(p.largura, 'criador.prop.largura') };
      if (prop.altura !== 1 || prop.largura !== 1) res.prop = prop;
    }
  }
  // As partes PINTADAS do criador vão inteiras para o normalizador do jogo (que corta o que não conhece); avisamos
  // que elas cobrem a skin.
  for (const k of ['corpo', 'rosto', 'camisa', 'calca', 'sapato']) {
    if (c[k] === undefined || c[k] === null) continue;
    if (!obj(c[k])) { erros.push(`criador.${k} precisa ser um objeto.`); continue; }
    res[k] = c[k];
    avisos.push(`criador.${k} pinta por cima da skin (como na aba Criar personagem).`);
  }
  out.criador = Object.keys(res).length ? res : null;
}

function habilidades(raw, out, erros, avisos, gmAtivo) {
  if (!Array.isArray(raw)) { erros.push('"habilidades" precisa ser uma lista.'); return; }
  if (raw.length > 12) avisos.push('Só as 12 primeiras habilidades foram lidas.');
  const gm = { brilho: 0, reflexo: 0, fumaca: 0, cor: null, regiao: null };
  for (const h0 of raw.slice(0, 12)) {
    const h = obj(h0);
    if (!h || typeof h.nome !== 'string' || !h.nome.trim()) { erros.push('Cada habilidade precisa de "nome".'); continue; }
    const item = { nome: h.nome.trim().slice(0, 48), descricao: typeof h.descricao === 'string' ? h.descricao.slice(0, 200) : '' };
    const e = obj(h.efeito);
    if (!e || !Object.hasOwn(EFEITOS, e.tipo)) {
      out.habilidades.ideias.push({ ...item, motivo: e ? `efeito "${e.tipo}" não existe no jogo` : 'sem efeito que o jogo tenha' });
      continue;
    }
    const intensidade = Number.isFinite(e.intensidade) ? Math.min(1, Math.max(0, e.intensidade)) : 0.6;
    if (e.cor !== undefined && !hexOk(e.cor)) { erros.push(`${item.nome}: cor "${e.cor}" não é #rrggbb.`); continue; }
    if (e.regiao !== undefined && !REGIOES_EFEITO.includes(e.regiao)) { erros.push(`${item.nome}: região "${e.regiao}" não existe (${REGIOES_EFEITO.join(', ')}).`); continue; }
    if (e.cor && gm.cor && e.cor.toLowerCase() !== gm.cor) avisos.push(`${item.nome}: o jogo usa UMA cor para todos os efeitos; ficou ${gm.cor}.`);
    if (e.regiao && gm.regiao && e.regiao !== gm.regiao) avisos.push(`${item.nome}: o jogo usa UMA região para todos os efeitos; ficou ${gm.regiao}.`);
    gm.cor ||= e.cor ? e.cor.toLowerCase() : null;
    gm.regiao ||= e.regiao || null;
    gm[e.tipo] = Math.max(gm[e.tipo], intensidade);
    (gmAtivo ? out.habilidades.aplicaveis : out.habilidades.so_gm).push({ ...item, efeito: { tipo: e.tipo, intensidade } });
  }
  if (gm.brilho || gm.reflexo || gm.fumaca) {
    out.gm = { brilho: gm.brilho, reflexo: gm.reflexo, fumaca: gm.fumaca, cor: gm.cor || '#81eaff', regiao: gm.regiao || 'torso' };
    if (out.gm.regiao in PECAS_EXPLORADOR && !out.traje?.[out.gm.regiao]) avisos.push(`O efeito na peça "${out.gm.regiao}" só aparece com essa peça do traje ligada; senão vai para o tronco.`);
  }
}

// Pinta a pintura conferida num atlas RGBA quadrado de lado `lado` (múltiplo de 64): cada pixel de 64 vira um bloco.
export function pintarFaces(rgba, lado, pintura) {
  const s = lado / 64;
  for (const { rect: [x, y, w], cores } of pintura) {
    cores.forEach((cor, k) => {
      const px = x + (k % w), py = y + Math.floor(k / w);
      const [r, g, b, a] = cor ? [parseInt(cor.slice(1, 3), 16), parseInt(cor.slice(3, 5), 16), parseInt(cor.slice(5, 7), 16), 255] : [0, 0, 0, 0];
      for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
        const i = ((py * s + yy) * lado + px * s + xx) * 4;
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
      }
    });
  }
  return rgba;
}

// Diagnóstico de um PNG que a IA devolveu (já do tamanho certo): IA de imagem muitas vezes desenha o personagem
// em vez da planificação. Mede quanto há de pintura FORA das regiões (o jogo ignora) e se a camada de dentro está
// quase vazia/uniforme. Só gera avisos; quem barra é a dimensão e o tipo.
export function analisarSkin(lado, rgba, slim = false) {
  const s = lado / 64, dentro = new Uint8Array(64 * 64);
  for (const f of listaFaces(slim)) { const [x, y, w, h] = f.rect; for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) dentro[yy * 64 + xx] = 1; }
  let fora = 0, totalFora = 0, opacas = 0;
  const cores = new Set();
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = ((y * s) * lado + x * s) * 4;
    if (!dentro[y * 64 + x]) { totalFora++; if (rgba[i + 3] > 0) fora++; continue; }
    if (rgba[i + 3] > 0) { opacas++; cores.add((rgba[i] >> 3) << 10 | (rgba[i + 1] >> 3) << 5 | rgba[i + 2] >> 3); }
  }
  const avisos = [];
  const fracFora = totalFora ? fora / totalFora : 0;
  if (fracFora > 0.25) avisos.push(`${Math.round(fracFora * 100)}% da área fora das regiões está pintada: parece um desenho do personagem, não a planificação (UV). O jogo ignora essa parte.`);
  if (cores.size <= 2) avisos.push('A skin tem 1 ou 2 cores só nas regiões do corpo.');
  return { fracFora, opacas, cores: cores.size, avisos };
}

// ---------------------------------------------------------------------------------------------------------------
// ZIP mínimo (sem compressão ao escrever; ao ler aceita "stored" e "deflate" com o descompressor que o aparelho der).
const TABELA_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// arquivos: [{ nome, dados: Uint8Array | string }]. Devolve Uint8Array.
export function criarZip(arquivos, data = new Date(2026, 10, 23, 12, 0, 0)) {
  const enc = new TextEncoder(), partes = [], central = [];
  const dosT = (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1);
  const dosD = ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate();
  let off = 0;
  for (const a of arquivos) {
    const nome = enc.encode(a.nome), dados = typeof a.dados === 'string' ? enc.encode(a.dados) : a.dados, crc = crc32(dados);
    const loc = new DataView(new ArrayBuffer(30));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true); loc.setUint16(8, 0, true);
    loc.setUint16(10, dosT, true); loc.setUint16(12, dosD, true); loc.setUint32(14, crc, true); loc.setUint32(18, dados.length, true);
    loc.setUint32(22, dados.length, true); loc.setUint16(26, nome.length, true); loc.setUint16(28, 0, true);
    partes.push(new Uint8Array(loc.buffer), nome, dados);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true);
    cen.setUint16(12, dosT, true); cen.setUint16(14, dosD, true); cen.setUint32(16, crc, true); cen.setUint32(20, dados.length, true);
    cen.setUint32(24, dados.length, true); cen.setUint16(28, nome.length, true); cen.setUint32(42, off, true);
    central.push(new Uint8Array(cen.buffer), nome);
    off += 30 + nome.length + dados.length;
  }
  const tamCentral = central.reduce((s, p) => s + p.length, 0);
  const fim = new DataView(new ArrayBuffer(22));
  fim.setUint32(0, 0x06054b50, true); fim.setUint16(8, arquivos.length, true); fim.setUint16(10, arquivos.length, true);
  fim.setUint32(12, tamCentral, true); fim.setUint32(16, off, true);
  const tudo = [...partes, ...central, new Uint8Array(fim.buffer)];
  const out = new Uint8Array(tudo.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of tudo) { out.set(p, o); o += p.length; }
  return out;
}

// Lê um .zip: [{ nome, dados }]. `inflar(bytes) → Promise<Uint8Array>` descomprime "deflate" cru.
export async function lerZip(bytes, inflar) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.length > ZIP_MAX_BYTES) throw new Error('O .zip passa de 8 MB.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fim = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { fim = i; break; }
  if (fim < 0) throw new Error('Arquivo .zip inválido.');
  const n = dv.getUint16(fim + 10, true);
  if (n > ZIP_MAX_ARQUIVOS) throw new Error(`O .zip tem ${n} arquivos (até ${ZIP_MAX_ARQUIVOS}).`);
  let p = dv.getUint32(fim + 16, true);
  const dec = new TextDecoder(), out = [];
  let total = 0;
  for (let k = 0; k < n; k++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('Diretório do .zip corrompido.');
    const metodo = dv.getUint16(p + 10, true), comp = dv.getUint32(p + 20, true), tam = dv.getUint32(p + 24, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
    const nome = dec.decode(bytes.subarray(p + 46, p + 46 + ln));
    p += 46 + ln + le + lc;
    if (nome.endsWith('/')) continue;
    total += tam;
    if (tam > ZIP_MAX_BYTES || total > ZIP_MAX_BYTES) throw new Error('O conteúdo do .zip passa de 8 MB.');
    if (loc + 30 > bytes.length || dv.getUint32(loc, true) !== 0x04034b50) throw new Error('Arquivo dentro do .zip corrompido.');
    const ini = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
    const bruto = bytes.subarray(ini, ini + comp);
    let dados;
    if (metodo === 0) dados = bruto.slice();
    else if (metodo === 8) dados = await inflar(bruto);
    else throw new Error(`"${nome}" usa uma compressão que o jogo não lê.`);
    if (dados.length !== tam) throw new Error(`"${nome}" veio com tamanho errado.`);
    out.push({ nome, dados });
  }
  return out;
}

// Escolhe, entre os arquivos recebidos, a resposta e o PNG. Aceita: resposta.json, qualquer .json com o formato
// certo (o mais raso primeiro) e o PNG citado em skin_png (ou o único PNG de skin, se não houver resposta).
export function escolherArquivos(arquivos) {
  const nomeBase = (n) => n.split('/').pop();
  const fundo = (n) => n.split('/').length;
  const jsons = arquivos.filter((a) => /\.json$/i.test(a.nome)).sort((a, b) => fundo(a.nome) - fundo(b.nome) || (nomeBase(a.nome) === 'resposta.json' ? -1 : 1));
  const dec = new TextDecoder();
  let resposta = null;
  for (const a of jsons) {
    const texto = typeof a.dados === 'string' ? a.dados : dec.decode(a.dados);
    try { const j = JSON.parse(texto); if (j?.formato === FORMATO_RESPOSTA) { resposta = { nome: a.nome, texto }; break; } } catch { /* outro json */ }
    if (!resposta && nomeBase(a.nome) === 'resposta.json') resposta = { nome: a.nome, texto };
  }
  // um .json sozinho é a resposta, mesmo quebrado: assim o erro de leitura aparece em vez de "não achei"
  if (!resposta && jsons.length === 1) {
    const a = jsons[0];
    resposta = { nome: a.nome, texto: typeof a.dados === 'string' ? a.dados : dec.decode(a.dados) };
  }
  // os PNG do próprio pacote (gabarito, guia, folha, exemplo) só contam quando vieram sozinhos
  let pngs = arquivos.filter((a) => /\.png$/i.test(a.nome));
  if (pngs.length > 1) pngs = pngs.filter((a) => !/^(gabarito|guia-atlas|folha-mockup|minha-skin|resultado-esperado)/i.test(nomeBase(a.nome)));
  return { resposta, pngs };
}
