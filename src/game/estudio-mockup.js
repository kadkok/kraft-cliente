// Kraft — estúdio de skins, aba "Mockup para IA". Ida: baixa um pacote (.zip) com ficha técnica, gabarito do atlas,
// folha com frente/costas/laterais no boneco do jogo, prompt em português e um exemplo de resposta, para a pessoa
// levar à IA que quiser. O jogo NÃO envia nada a IA nenhuma. Volta: lê o que a IA devolveu (.zip, resposta.json,
// skin .png ou o JSON colado), confere tudo (shared/mockup-ia.js), mostra no boneco ao lado e aplica pelo fluxo de
// sempre: PNG → envio ao mundo (tipo=skin, conferido no servidor) → receita → "Aplicar no jogo".

import {
  montarFicha, exemploResposta, validarResposta, pintarFaces, analisarSkin, gabarito64, criarZip, lerZip, escolherArquivos,
  FORMATO_RESPOSTA, PARTES, FACES, EFEITOS, ZIP_MAX_BYTES, listaFaces,
} from '../../shared/mockup-ia.js';
import { normalizarSkin } from '../../shared/estudio-skins.js';
import { CATALOGO, SLOTS_ACESSORIO } from '../../shared/criador.js';
import { SKIN_PNG_MAX, dimensaoEntradaOk } from '../../shared/skin-atlas.js';
import { comporAtlas, atlas64, slimDaSkin } from '../render/estudio-skins.js';
import { folhaMockup, guia640, canvasDe, pngDe, medidasRenderer, NOMES_SLOT } from '../render/mockup-folha.js';
import { prepararSkinPng } from './estudio-base.js';

export const HTML_MOCKUP = `
  <p class="skin-nota">Leve o seu personagem para <b>qualquer IA</b> (ChatGPT, Claude, Gemini, uma IA local…) e traga de volta skins, roupas e acessórios que encaixam no boneco do jogo. O Kraft <b>não envia nada</b> para IA nenhuma: você baixa o pacote e entrega à IA que quiser.</p>
  <fieldset><legend>1 · Levar para a IA</legend>
    <div class="skin-actions">
      <button type="button" class="btn primary" data-m-pacote>Baixar pacote para IA (.zip)</button>
      <button type="button" data-m-gabarito>Só o gabarito (.png)</button>
      <button type="button" data-m-copiar>Copiar o prompt</button>
    </div>
    <p class="skin-nota">O pacote tem: o prompt em português, a ficha técnica (atlas, faces, slots e limites do jogo), o gabarito 64×64 que já é uma skin válida, o guia 640×640 com o nome de cada face, a folha com frente, costas e laterais no boneco, a sua skin atual e um exemplo de ida e volta.</p>
  </fieldset>
  <fieldset><legend>2 · Trazer o resultado</legend>
    <label>Arquivos da IA <input data-m-arquivos type="file" multiple accept=".zip,.json,.png,application/zip,application/json,image/png"></label>
    <label class="skin-m-colar">Ou cole o JSON <textarea data-m-texto rows="4" spellcheck="false" placeholder='{"formato": "${FORMATO_RESPOSTA}", "versao": 1, ...}'></textarea></label>
    <div class="skin-actions"><button type="button" data-m-conferir>Conferir o texto colado</button><button type="button" data-m-exemplo>Testar com o exemplo</button></div>
    <div class="skin-m-relatorio" data-m-relatorio aria-live="polite"></div>
    <div class="skin-actions"><button type="button" class="btn primary" data-m-aplicar disabled>Aplicar no jogo</button><button type="button" data-m-descartar disabled>Descartar</button></div>
  </fieldset>`;

const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nomeArquivo = (s) => String(s || 'jogador').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'jogador';
const SKIN_JOGO = ['explorador', 'botanica', 'mineiro'];

// O prompt em português que vai no pacote (e no "Copiar o prompt").
export function textoPrompt(ficha) {
  const faces = FACES.join(', '), partes = PARTES.map((p) => `${p.chave} (${p.nome.toLowerCase()})`).join(', ');
  const slots = Object.entries(SLOTS_ACESSORIO).map(([slot, k]) => `  - ${slot}: ${CATALOGO[k].slice(1).map((o) => o.id).join(', ')}`).join('\n');
  const ori = ficha.boneco.orientacao_medida || {};
  const oriTxt = Object.entries(ori).map(([f, o]) => `  - ${f}: direita do desenho = ${o.direita_do_desenho}; para baixo no desenho = ${o.baixo_do_desenho}`).join('\n');
  return `KRAFT · MOCKUP DO PERSONAGEM PARA IA (versão ${ficha.versao})
Você vai criar uma skin (e, se quiser, roupas e acessórios) para o boneco do jogo Kraft.
Arquivos anexos deste pacote: kraft-ficha-ia.json (as regras exatas), gabarito-64.png (a planificação/UV
colorida por região), guia-atlas-640.png (o mesmo gabarito com o nome de cada face), folha-mockup.png
(frente, costas e laterais no boneco de verdade) e minha-skin-64.png (a skin de agora, para partir dela).

O QUE O JOGO ACEITA (siga à risca; o jogo confere tudo e recusa o resto)
1. A skin é um ATLAS de 64×64 pixels no layout compatível com o das skins de Minecraft. Não é um desenho do
   personagem: é a planificação das caixas do boneco (cabeça 8×8×8, tronco 8×12×4, braços 4×12×4 ou finos
   3×12×4, pernas 4×12×4), cada face num retângulo fixo. Os retângulos estão em kraft-ficha-ia.json → partes.
   HD: pode ser quadrado em múltiplos de 64 até 1024×1024 (cada pixel de 64 vira um bloco). Até 1 MB.
2. Duas camadas: "dentro" (sempre opaca) e "fora" (roupa/cabelo por cima, transparente onde não houver nada;
   alfa abaixo de 50% some). Pixel art nítido: sem antisserrilhado, sem sombra projetada, sem perspectiva.
3. Faces: ${faces}. Direita/esquerda são as do PERSONAGEM. Orientação medida na malha do jogo:
${oriTxt}
4. Partes: ${partes}.
5. Acessórios 3D existem só nestes slots, UM por slot, com uma cor #rrggbb:
  - cabelo (no criador.cabelo): ${CATALOGO.cabelos.slice(1).map((o) => o.id).join(', ')}
${slots}
   Peças prontas do traje Explorador (sim/não): ${Object.keys(ficha.traje_explorador.pecas).join(', ')}.
   Proporções (só visual): altura e largura de 0,90 a 1,10. Não existe modelo 3D novo: só as opções acima.
6. Habilidades: o único efeito ligado à skin que o jogo tem são efeitos visuais de GM: ${Object.keys(EFEITOS).join(', ')}
   (intensidade 0 a 1, uma cor e uma região para todos), e só aparecem para quem está com o Modo GM ligado
   (o servidor confere). Poderes de jogo (voar, velocidade, dano, cura, escudo, teletransporte…) NÃO existem:
   pode sugerir como ideia, mas eles voltam marcados como "ideia" e não são aplicados.

COMO RESPONDER
Devolva UM bloco JSON (resposta.json) no formato abaixo e, se você gera imagens, um skin.png de 64×64 citado em
"skin_png". Se você não gera imagem com pixel exato, pinte pelo JSON: "pixels.faces" com uma linha de texto por
linha da face (largura e altura exatas da face, uma letra por pixel, letras da "paleta"), ou uma cor só por face.
Chave da face: "parte.face" para a camada de dentro e "parte.face.fora" para a de fora (ex.: "cabeca.frente",
"tronco.costas.fora"). "partir_de" diz de onde começa o que você não pintar: atual, vazio, explorador,
botanica ou mineiro. Não invente campos: campo desconhecido é ignorado e id fora da lista é recusado.

Exemplo completo (é o exemplo/resposta.json do pacote; cole no jogo para ver):
${JSON.stringify(ficha.resposta.exemplo, null, 1)}

DEPOIS
No Kraft: pausa → Estúdio de skins → Mockup para IA → "Trazer o resultado": escolha o .zip, o resposta.json e o
skin.png, ou cole o JSON. O jogo confere, mostra no boneco e só vale para todos depois de "Aplicar no jogo".
`;
}

export function initMockup({ dialog, draft, requestPreview, status, enviar, url, game, gmAtivo, sync, aplicar }) {
  const q = (n) => dialog.querySelector(`[data-${n}]`);
  let pendente = null;        // resultado conferido: { r, canvas, slim, blob, origem }
  let ocupado = false;

  function baixar(blob, nome) {
    const a = document.createElement('a');
    a.download = nome;
    a.href = URL.createObjectURL(blob);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  }
  const bytesDe = async (blob) => new Uint8Array(await blob.arrayBuffer());
  function fichaAgora() { return montarFicha({ ...medidasRenderer(), geradoEm: new Date().toISOString() }); }

  // ---------------------------------------------------------------------------------------------------- ida
  async function pacote() {
    const skin = draft();
    const ficha = fichaAgora();
    const nome = nomeArquivo(game.name);
    const data = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    status('Montando a folha do mockup no boneco…');
    const folha = await folhaMockup({ skin, url, nome: game.name, data });
    const { canvas: atual } = await atlas64(skin, url);
    const ex = await processar(validarResposta(exemploResposta(), { gmAtivo: true }), []);
    const arquivos = [
      { nome: 'LEIA-ME-IA.txt', dados: textoPrompt(ficha) },
      { nome: 'kraft-ficha-ia.json', dados: JSON.stringify(ficha, null, 1) },
      { nome: 'gabarito-64.png', dados: await bytesDe(await pngDe(canvasDe(gabarito64(false)))) },
      { nome: 'gabarito-64-bracos-finos.png', dados: await bytesDe(await pngDe(canvasDe(gabarito64(true)))) },
      { nome: 'guia-atlas-640.png', dados: await bytesDe(await pngDe(guia640(false))) },
      { nome: 'guia-atlas-640-bracos-finos.png', dados: await bytesDe(await pngDe(guia640(true))) },
      { nome: 'folha-mockup.png', dados: await bytesDe(await pngDe(folha)) },
      { nome: 'minha-skin-64.png', dados: await bytesDe(await pngDe(atual)) },
      { nome: 'exemplo/resposta.json', dados: JSON.stringify(exemploResposta(), null, 1) },
      { nome: 'exemplo/resultado-esperado.png', dados: await bytesDe(ex.blob) },
    ];
    const zip = criarZip(arquivos);
    baixar(new Blob([zip], { type: 'application/zip' }), `kraft-mockup-ia-${nome}.zip`);
    status(`Pacote baixado (${arquivos.length} arquivos, ${Math.round(zip.length / 1024)} KB). Leve-o à IA que quiser.`);
    return zip;
  }
  q('m-pacote').onclick = () => {
    if (ocupado) return;
    ocupado = true;
    pacote().catch((e) => status(e.message || 'Não foi possível montar o pacote.')).finally(() => { ocupado = false; });
  };
  q('m-gabarito').onclick = async () => {
    baixar(await pngDe(canvasDe(gabarito64(slimDaSkin(draft())))), 'kraft-gabarito-64.png');
    status('Gabarito 64×64 baixado: ele já é uma skin válida (cada região numa cor).');
  };
  q('m-copiar').onclick = async () => {
    try { await navigator.clipboard.writeText(textoPrompt(fichaAgora())); status('Prompt copiado. Anexe também os arquivos do pacote.'); }
    catch { status('O navegador não deixou copiar; o prompt está no LEIA-ME-IA.txt do pacote.'); }
  };

  // --------------------------------------------------------------------------------------------------- volta
  // Monta o atlas final de uma resposta conferida: PNG da IA (ou o ponto de partida) + pintura por face.
  async function processar(r, pngs) {
    let canvas = null, slim = r.bracos ? r.bracos === 'finos' : null, origem = '';
    const avisos = [];
    if (r.skinPng || (!r.pintura.length && pngs.length)) {
      const alvo = r.skinPng ? pngs.find((p) => p.nome.split('/').pop().toLowerCase() === r.skinPng.toLowerCase()) : pngs.length === 1 ? pngs[0] : null;
      if (!alvo) throw new Error(r.skinPng ? `A resposta cita "${r.skinPng}", mas esse PNG não veio junto.` : 'Vieram vários PNG; diga qual em "skin_png".');
      const file = alvo.file || new File([alvo.dados], alvo.nome.split('/').pop(), { type: 'image/png' });
      const pronta = await prepararSkinPng(file);
      const bmp = await createImageBitmap(pronta.blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = bmp.width;
      canvas.getContext('2d').drawImage(bmp, 0, 0);
      bmp.close();
      slim ??= pronta.slim;
      origem = `PNG ${pronta.w}×${pronta.h}${pronta.legado ? ' (formato antigo, convertido)' : ''}`;
    } else if (r.pintura.length) {
      const atual = draft();
      if (r.partirDe === 'vazio') {
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const g = canvas.getContext('2d');
        slim ??= false;
        g.fillStyle = '#8a8f96';
        for (const f of listaFaces(slim)) if (f.camada === 'dentro') g.fillRect(...f.rect);
        origem = 'começando do zero';
      } else {
        const id = SKIN_JOGO.includes(r.partirDe) ? r.partirDe : null;
        slim ??= id ? false : slimDaSkin(atual);
        ({ canvas } = await comporAtlas(id ? { base: { id, slim } } : atual, url));
        origem = id ? `começando da skin ${id}` : 'começando da skin atual';
      }
    }
    if (canvas && r.pintura.length) {
      // a pintura conferia as faces com o braço de agora; se o PNG mudou o braço, confere de novo com ele
      const g = canvas.getContext('2d', { willReadFrequently: true });
      const img = g.getImageData(0, 0, canvas.width, canvas.height);
      pintarFaces(img.data, canvas.width, r.pintura);
      g.putImageData(img, 0, 0);
      origem += ` + ${r.pintura.length} face(s) pintadas pelo JSON`;
    }
    let blob = null;
    if (canvas) {
      if (!dimensaoEntradaOk(canvas.width, canvas.height)) throw new Error(`Atlas de ${canvas.width}×${canvas.height} fora do padrão.`);
      const dados = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.width).data;
      avisos.push(...analisarSkin(canvas.width, dados, !!slim).avisos);
      blob = await pngDe(canvas);
      if (blob.size > SKIN_PNG_MAX) throw new Error(`A skin final tem ${Math.round(blob.size / 1024)} KB; o jogo aceita até 1 MB.`);
    }
    return { r, canvas, slim: !!slim, blob, origem, avisos };
  }

  // Receita que a resposta produz por cima do rascunho atual (a mesma regra do pintor: com pintura nova, saem as
  // partes pintadas do criador, as estampas e a jaqueta, a menos que a própria resposta peça).
  function receita(p) {
    const base = draft(), r = p.r, novo = { ...base };
    const criador = { ...(base.criador || {}) };
    if (p.canvas) {
      for (const k of ['corpo', 'rosto', 'camisa', 'calca', 'sapato']) delete criador[k];
      novo.frente = novo.costas = novo.rosto = null;
      novo.camisa = '';
      if (novo.traje?.jaqueta && !r.traje?.jaqueta) novo.traje = { ...novo.traje, jaqueta: false };
    }
    if (r.criador) Object.assign(criador, r.criador);
    novo.criador = Object.keys(criador).length ? criador : null;
    if (r.traje) novo.traje = { ...(novo.traje || {}), ...r.traje };
    if (r.gm) novo.gm = { ...(base.gm || {}), ...r.gm };
    return novo;
  }

  function relatorio(p, erro) {
    const el = q('m-relatorio');
    if (erro) {
      el.innerHTML = `<p class="skin-m-erro"><b>Não deu para usar:</b></p><ul>${erro.map((e) => `<li>${escapar(e)}</li>`).join('')}</ul>`;
      return;
    }
    const r = p.r, h = r.habilidades, linhas = [];
    linhas.push(`<p class="skin-m-ok"><b>Conferido${r.nome ? ` · ${escapar(r.nome)}` : ''}.</b> ${p.canvas ? `Skin ${p.canvas.width}×${p.canvas.width} (${escapar(p.origem)}), braços ${p.slim ? 'finos' : 'clássicos'}.` : 'Sem pintura nova: só peças e efeitos.'}</p>`);
    const ac = r.criador?.acess || {}, pecas = [];
    if (r.criador?.cabelo) pecas.push(`cabelo ${r.criador.cabelo.estilo}`);
    for (const [slot, v] of Object.entries(ac)) pecas.push(`${NOMES_SLOT[slot] || slot}: ${v.id}`);
    if (r.criador?.prop) pecas.push(`proporção ${r.criador.prop.altura}×${r.criador.prop.largura}`);
    if (r.traje) pecas.push(`traje: ${Object.entries(r.traje).filter(([, v]) => v).map(([k]) => k).join(', ') || 'nenhuma peça'}`);
    if (pecas.length) linhas.push(`<p>Peças: ${escapar(pecas.join(' · '))}</p>`);
    if (h.aplicaveis.length) linhas.push(`<p>Habilidades aplicáveis (efeito visual de GM): ${escapar(h.aplicaveis.map((x) => `${x.nome} (${x.efeito.tipo})`).join(', '))}</p>`);
    if (h.so_gm.length) linhas.push(`<p>Só com o Modo GM ligado (o servidor corta para quem não é GM): ${escapar(h.so_gm.map((x) => `${x.nome} (${x.efeito.tipo})`).join(', '))}</p>`);
    if (h.ideias.length) linhas.push(`<p class="skin-m-ideia">Ideias que o jogo NÃO tem (não aplicadas): ${escapar(h.ideias.map((x) => `${x.nome}: ${x.motivo}`).join('; '))}</p>`);
    const avisos = [...r.avisos, ...p.avisos];
    if (avisos.length) linhas.push(`<ul class="skin-m-aviso">${avisos.map((a) => `<li>${escapar(a)}</li>`).join('')}</ul>`);
    el.innerHTML = linhas.join('');
  }

  function limpar(msg) {
    pendente = null;
    q('m-aplicar').disabled = q('m-descartar').disabled = true;
    if (msg !== undefined) q('m-relatorio').textContent = msg;
    requestPreview();
  }

  // Ponto único de entrada da volta: arquivos (File[]) e/ou texto colado.
  async function receber(arquivos, texto) {
    if (ocupado) return;
    ocupado = true;
    limpar('');
    status('Conferindo o resultado da IA…');
    try {
      const lidos = [];
      for (const f of arquivos) {
        if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
          if (f.size > ZIP_MAX_BYTES) throw new Error('O .zip passa de 8 MB.');
          const inflar = async (b) => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
          for (const a of await lerZip(await bytesDe(f), inflar)) if (!a.nome.startsWith('__MACOSX/')) lidos.push(a);
        } else if (/\.json$/i.test(f.name) || f.type === 'application/json') {
          if (f.size > 256 * 1024) throw new Error(`"${f.name}" passa de 256 KB.`);
          lidos.push({ nome: f.name, dados: await bytesDe(f) });
        } else if (/\.png$/i.test(f.name) || f.type === 'image/png') {
          lidos.push({ nome: f.name, dados: null, file: f });
        } else throw new Error(`"${f.name}": use .zip, .json ou .png.`);
      }
      const { resposta, pngs } = escolherArquivos(lidos.map((a) => a.file ? { ...a, nome: a.nome } : a));
      const fonte = texto?.trim() ? texto : resposta?.texto;
      let r;
      if (fonte) r = validarResposta(fonte, { gmAtivo: gmAtivo(), slimPadrao: slimDaSkin(draft()) });
      else if (pngs.length) r = validarResposta({ formato: FORMATO_RESPOSTA, versao: 1 }, { gmAtivo: gmAtivo() });
      else throw new Error('Não achei resposta.json (formato kraft-resposta-ia) nem skin .png.');
      if (!r.ok) { relatorio(null, r.erros); status('O resultado tem erros: nada foi aplicado.'); return; }
      if (pngs.length) r.avisos = r.avisos.filter((a) => !a.startsWith('A resposta não muda nada'));
      const p = await processar(r, pngs.map((a) => ({ ...a, dados: a.dados })));
      pendente = p;
      relatorio(p);
      q('m-aplicar').disabled = q('m-descartar').disabled = false;
      requestPreview();
      status('Prévia no boneco ao lado. Nada mudou para os outros ainda: toque em Aplicar no jogo.');
    } catch (e) {
      relatorio(null, [e.message || String(e)]);
      status('O resultado foi recusado: nada foi aplicado.');
    } finally { ocupado = false; }
  }
  q('m-arquivos').onchange = () => { const fs = [...q('m-arquivos').files]; q('m-arquivos').value = ''; if (fs.length) receber(fs, ''); };
  q('m-conferir').onclick = () => { const t = q('m-texto').value; if (!t.trim()) return status('Cole o JSON que a IA devolveu.'); receber([], t); };
  q('m-exemplo').onclick = () => { q('m-texto').value = JSON.stringify(exemploResposta(), null, 1); receber([], q('m-texto').value); };
  q('m-descartar').onclick = () => { limpar(''); status('Resultado descartado.'); };
  q('m-aplicar').onclick = async () => {
    if (!pendente || ocupado) return;
    ocupado = true;
    q('m-aplicar').disabled = true;
    try {
      const p = pendente, novo = receita(p), d = draft();
      if (p.blob) {
        status('Enviando a skin ao mundo…');
        const id = await enviar(p.blob, 'skin');
        novo.base = { id, slim: p.slim };
      }
      // aplica no rascunho do estúdio (mesmo objeto) e segue pelo botão de sempre (rede + confirmação do servidor)
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, novo);
      const nome = dialog.querySelector('[data-name]');
      if (p.r.nome && nome && !nome.value) nome.value = p.r.nome;
      limpar('Aplicado no rascunho. Enviando ao servidor…');
      sync();
      aplicar();
    } catch (e) {
      status(e.message || 'O envio foi recusado.');
      q('m-aplicar').disabled = false;
    } finally { ocupado = false; }
  };

  return {
    // prévia do resultado ainda não aplicado (o estúdio chama quando esta aba está aberta)
    previa() {
      if (!pendente) return null;
      // normalizada como o servidor faria (efeito de GM só aparece para quem está com o Modo GM ligado)
      return { skin: normalizarSkin(receita(pendente), gmAtivo()), opts: pendente.canvas ? { base: pendente.canvas, slim: pendente.slim } : {} };
    },
    fechar() { limpar(''); },
    pacote, receber,
  };
}
