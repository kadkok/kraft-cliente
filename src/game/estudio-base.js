// Kraft — estúdio de skins, aba "Skin (.png)": a base do boneco. Carrega uma skin no formato compatível com o do
// Minecraft (64×64, o antigo 64×32, braços clássicos ou finos, HD em múltiplos de 64 até 1024), confere no aparelho,
// converte o formato antigo para o quadrado e envia ao mundo (o servidor confere de novo: PNG, quadrado, até 1 MB).
// Também escolhe uma das skins do jogo e baixa a skin atual em 64×64.

import { SKINS_JOGO, SKIN_PNG_MAX, dimensaoEntradaOk, detectarBracoFino, normalizeSkinPixels } from '../../shared/skin-atlas.js';
import { atlas64 } from '../render/estudio-skins.js';

const NOMES_JOGO = { explorador: 'Explorador', botanica: 'Botânica', mineiro: 'Mineiro' };

export const HTML_BASE = `
  <p class="skin-nota">Use uma skin no formato compatível com o do Minecraft: PNG 64×64, o antigo 64×32 ou HD em múltiplos de 64 até 1024×1024. Ela vira a base do seu boneco e todos no mundo veem.</p>
  <div class="skin-base-atual"><canvas data-base-mini width="64" height="64" aria-label="Skin base atual"></canvas><span data-base-info></span></div>
  <label>Carregar skin (.png) <input data-base-file type="file" accept="image/png,.png"></label>
  <label>Braços <select data-base-bracos><option value="auto">Automático</option><option value="classic">Clássicos (4 px)</option><option value="slim">Finos (3 px)</option></select></label>
  <fieldset><legend>Skins do jogo</legend><div class="skin-actions">
    ${SKINS_JOGO.map((id) => `<button type="button" data-base-jogo="${id}">${NOMES_JOGO[id]}</button>`).join('')}
  </div></fieldset>
  <p class="skin-nota" data-base-aviso hidden>O criador de personagem está pintando o corpo por cima desta base (aba Criar personagem → Corpo).</p>
  <div class="skin-actions"><button type="button" data-base-baixar>Baixar minha skin (.png)</button><button type="button" data-base-padrao>Voltar à base padrão</button></div>`;

// Lê o arquivo, confere e devolve { blob (PNG quadrado), slim, w, h, legado }.
export async function prepararSkinPng(file) {
  if (!file) throw new Error('Nenhum arquivo escolhido.');
  if ((file.type && file.type !== 'image/png') || (!file.type && !/\.png$/i.test(file.name || ''))) throw new Error('A skin precisa ser um arquivo PNG.');
  if (file.size > 4 * 1024 * 1024) throw new Error('Arquivo grande demais (até 4 MB).');
  const cabeca = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (cabeca[0] !== 0x89 || cabeca[1] !== 0x50 || cabeca[2] !== 0x4e || cabeca[3] !== 0x47) throw new Error('O arquivo não é um PNG de verdade.');
  const bmp = await createImageBitmap(file, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const w = bmp.width, h = bmp.height;
  try {
    if (!dimensaoEntradaOk(w, h)) throw new Error(`Skin de ${w}×${h} fora do padrão: use 64×64, 64×32 ou HD em múltiplos de 64 até 1024.`);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const legado = h === w / 2;
    const dados = g.getImageData(0, 0, w, h).data;
    const slim = legado ? false : detectarBracoFino(w, h, dados);
    const px = normalizeSkinPixels(w, h, dados);
    c.height = w;
    g.putImageData(new ImageData(px, w, w), 0, 0);
    const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('A skin não pôde ser convertida.');
    if (blob.size > SKIN_PNG_MAX) throw new Error('A skin convertida passa de 1 MB.');
    return { blob, slim, w, h, legado };
  } finally { bmp.close(); }
}

export function initAbaBase({ dialog, draft, requestPreview, status, enviar, url, game, net, gmAtivo }) {
  const q = (n) => dialog.querySelector(`[data-${n}]`);
  const detectado = new Map();   // id → braços finos detectados no arquivo (para o "Automático")
  let envio = null;

  async function mini() {
    const skin = draft();
    const info = q('base-info');
    const b = skin.base;
    info.textContent = !b ? 'Base: Explorador (padrão do jogo)'
      : SKINS_JOGO.includes(b.id) ? `Base: ${NOMES_JOGO[b.id]} (do jogo) · braços ${b.slim ? 'finos' : 'clássicos'}`
        : `Base: skin enviada · braços ${b.slim ? 'finos' : 'clássicos'}`;
    q('base-aviso').hidden = !skin.criador?.corpo;
    const sel = q('base-bracos');
    if (b && !SKINS_JOGO.includes(b.id) && detectado.has(b.id)) sel.value = detectado.get(b.id) === b.slim ? 'auto' : b.slim ? 'slim' : 'classic';
    else sel.value = b?.slim ? 'slim' : (sel.value === 'auto' ? 'auto' : 'classic');
    try {
      const { canvas } = await atlas64({ base: skin.base }, url);
      const ctx = q('base-mini').getContext('2d');
      ctx.clearRect(0, 0, 64, 64);
      ctx.drawImage(canvas, 0, 0);
    } catch { /* prévia pequena é só enfeite */ }
  }
  function sync() {
    q('base-file').disabled = !!envio || !net.playing || net.offline;
    for (const b of dialog.querySelectorAll('[data-base-jogo]')) b.setAttribute('aria-pressed', String(draft().base?.id === b.dataset.baseJogo));
    mini();
  }
  function bracoEscolhido(id) {
    const v = q('base-bracos').value;
    return v === 'auto' ? !!detectado.get(id) : v === 'slim';
  }

  q('base-file').onchange = async () => {
    const file = q('base-file').files[0];
    q('base-file').value = '';
    if (!file) return;
    const job = {};
    envio = job;
    sync();
    status('Conferindo a skin…');
    try {
      const pronta = await prepararSkinPng(file);
      if (envio !== job) return;
      status('Enviando a skin…');
      const id = await enviar(pronta.blob, 'skin');
      if (envio !== job) return;
      detectado.set(id, pronta.slim);
      q('base-bracos').value = 'auto';
      draft().base = { id, slim: pronta.slim };
      requestPreview();
      status(`Skin ${pronta.w}×${pronta.h}${pronta.legado ? ' (formato antigo, convertida)' : ''} carregada · braços ${pronta.slim ? 'finos' : 'clássicos'} (detectado). Toque em Aplicar no jogo.`);
    } catch (e) {
      if (envio === job) status(e.message || 'Não foi possível carregar a skin.');
    } finally {
      if (envio === job) envio = null;
      sync();
    }
  };
  q('base-bracos').onchange = () => {
    const d = draft();
    d.base = d.base ? { ...d.base, slim: bracoEscolhido(d.base.id) } : { id: 'explorador', slim: bracoEscolhido('explorador') };
    requestPreview();
    sync();
  };
  for (const b of dialog.querySelectorAll('[data-base-jogo]')) b.onclick = () => {
    draft().base = { id: b.dataset.baseJogo, slim: q('base-bracos').value === 'slim' };
    requestPreview();
    sync();
    status(`Base: ${NOMES_JOGO[b.dataset.baseJogo]}.`);
  };
  q('base-padrao').onclick = () => { draft().base = null; q('base-bracos').value = 'auto'; requestPreview(); sync(); status('Base padrão do jogo.'); };
  q('base-baixar').onclick = async () => {
    try {
      const { canvas } = await atlas64(draft(), url);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      const a = document.createElement('a');
      const nome = String(game.name || 'jogador').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'jogador';
      a.download = `kraft-skin-${nome}.png`;
      a.href = URL.createObjectURL(blob);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      status('Skin 64×64 baixada (a pintura; cabelo e acessórios 3D não vão no arquivo).');
    } catch { status('Não foi possível gerar o arquivo da skin.'); }
  };
  return { sync, ocupado: () => !!envio, gmAtivo };
}
