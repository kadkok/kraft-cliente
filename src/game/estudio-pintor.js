// Kraft — estúdio de skins, aba "Pintor": editor pixel a pixel do atlas 64×64 (formato compatível com o do
// Minecraft), com as regiões marcadas (cabeça, tronco, braços, pernas; camada de dentro e de fora), lápis, borracha,
// balde, conta-gotas, pintura espelhada, paleta e cor livre, desfazer/refazer, zoom, grade e camada de fora liga/desliga.
// A prévia 3D é o mesmo boneco do estúdio, ao vivo. Salvar = PNG → envio ao mundo → vira a base (aba Skin).
// Mouse e toque pelos eventos de ponteiro (touch-action: none na tela).

import { regiaoDe, regioes, espelho, preencher, copiarLado, normalizeSkinPixels, NOMES_PARTES, NOMES_FACES } from '../../shared/skin-atlas.js';
import { atlas64 } from '../render/estudio-skins.js';

const PALETA = ['#1d1612', '#3b2618', '#7a4b2a', '#c98d65', '#f1c9a5', '#ffffff', '#b9c0c8', '#5b6470', '#2b2f3a', '#c0463a', '#f08a3c', '#e0c034', '#4f8f4a', '#2f8c8c', '#3f7fbf', '#7a4fa3'];
const COR_PARTE = { head: '#ffd36e', torso: '#7de4df', armR: '#ff8a7a', armL: '#c39bff', legR: '#8fe08a', legL: '#6fb6ff' };
const NEUTRA = [154, 163, 173, 255];

export const HTML_PINTOR = `
  <div class="pintor-linha"><label>Começar de <select data-p-fonte>
    <option value="atual">Minha skin atual</option><option value="explorador">Explorador</option><option value="botanica">Botânica</option><option value="mineiro">Mineiro</option><option value="branco">Em branco</option>
  </select></label><button type="button" data-p-comecar>Começar</button></div>
  <div class="skin-tabs pintor-ferramentas" role="group" aria-label="Ferramentas">
    <button type="button" data-p-tool="lapis">Lápis</button><button type="button" data-p-tool="borracha">Borracha</button><button type="button" data-p-tool="balde">Balde</button><button type="button" data-p-tool="conta">Conta-gotas</button>
    <button type="button" data-p-desfazer>Desfazer</button><button type="button" data-p-refazer>Refazer</button>
  </div>
  <div class="skin-tabs" role="group" aria-label="Opções">
    <button type="button" data-p-espelho aria-pressed="false">Espelhar</button><button type="button" data-p-grade aria-pressed="true">Grade</button><button type="button" data-p-fora aria-pressed="true">Camada de fora</button>
  </div>
  <div class="pintor-tela" data-p-caixa><canvas data-p-tela aria-label="Atlas da skin, 64 por 64. Toque para pintar."></canvas></div>
  <p class="pintor-regiao" data-p-regiao role="status"></p>
  <div class="pintor-cores" data-p-paleta role="group" aria-label="Paleta"></div>
  <label>Cor livre <input type="color" data-p-cor value="#3f7fbf"></label>
  <div class="pintor-legenda">${Object.entries(NOMES_PARTES).map(([k, n]) => `<span><i style="background:${COR_PARTE[k]}"></i>${n}</span>`).join('')}<span><i class="tracejado"></i>Camada de fora</span></div>
  <label>Zoom <input type="range" data-p-zoom min="4" max="14" step="1" value="6"></label>
  <label>Braços finos <input type="checkbox" data-p-fino></label>
  <div class="skin-actions"><button type="button" data-p-copiar="R">Braço e perna: direito → esquerdo</button><button type="button" data-p-copiar="L">esquerdo → direito</button></div>
  <button type="button" class="btn primary" data-p-salvar>Usar como minha skin</button>`;

export function initPintor({ dialog, draft, requestPreview, status, enviar, url, net }) {
  const q = (n) => dialog.querySelector(`[data-${n}]`);
  const tela = q('p-tela'), ctx = tela.getContext('2d');
  const atlas = document.createElement('canvas');
  atlas.width = atlas.height = 64;
  const actx = atlas.getContext('2d', { willReadFrequently: true });
  let px = null, slim = false, tool = 'lapis', cor = [63, 127, 191, 255], espelhar = false, grade = true, fora = true, zoom = 6;
  let desfazer = [], refazer = [], arrasto = null, mira = null, comecado = false, salvando = false;

  // ---- desenho da tela ----
  const xadrez = document.createElement('canvas');
  xadrez.width = xadrez.height = 128;
  { const g = xadrez.getContext('2d'); for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { g.fillStyle = (x + y) % 2 ? '#26323d' : '#1c2630'; g.fillRect(x, y, 1, 1); } }
  function desenhar() {
    if (!px) return;
    const L = 64 * zoom;
    if (tela.width !== L) { tela.width = tela.height = L; }
    actx.putImageData(new ImageData(px, 64, 64), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(xadrez, 0, 0, L, L);
    ctx.drawImage(atlas, 0, 0, L, L);
    // área que o formato não usa: escurecida
    ctx.fillStyle = 'rgba(4,8,12,.72)';
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (!regiaoDe(x, y, slim)) ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
    const regs = regioes(slim);
    if (!fora) { ctx.fillStyle = 'rgba(8,14,20,.8)'; for (const r of regs) if (r.camada === 'fora') ctx.fillRect(r.rect[0] * zoom, r.rect[1] * zoom, r.rect[2] * zoom, r.rect[3] * zoom); }
    if (grade && zoom >= 5) {
      ctx.strokeStyle = 'rgba(255,255,255,.09)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 64; i++) { ctx.moveTo(i * zoom + .5, 0); ctx.lineTo(i * zoom + .5, L); ctx.moveTo(0, i * zoom + .5); ctx.lineTo(L, i * zoom + .5); }
      ctx.stroke();
    }
    for (const r of regs) {
      ctx.strokeStyle = COR_PARTE[r.parte];
      ctx.globalAlpha = r.camada === 'fora' ? .65 : .95;
      ctx.setLineDash(r.camada === 'fora' ? [4, 3] : []);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(r.rect[0] * zoom + 1, r.rect[1] * zoom + 1, r.rect[2] * zoom - 2, r.rect[3] * zoom - 2);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    if (mira) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(mira[0] * zoom, mira[1] * zoom, zoom, zoom);
      const m = espelhar && espelho(mira[0], mira[1], slim);
      if (m) { ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.strokeRect(m[0] * zoom, m[1] * zoom, zoom, zoom); }
    }
  }
  function previa() { desenhar(); requestPreview(); }

  // ---- estado ----
  function guardar() { desfazer.push(new Uint8ClampedArray(px)); if (desfazer.length > 60) desfazer.shift(); refazer = []; botoes(); }
  function botoes() {
    q('p-desfazer').disabled = !desfazer.length;
    q('p-refazer').disabled = !refazer.length;
    q('p-salvar').disabled = !px || salvando || !net.playing || net.offline;
    for (const b of dialog.querySelectorAll('[data-p-tool]')) b.setAttribute('aria-pressed', String(b.dataset.pTool === tool));
    q('p-espelho').setAttribute('aria-pressed', String(espelhar));
    q('p-grade').setAttribute('aria-pressed', String(grade));
    q('p-fora').setAttribute('aria-pressed', String(fora));
    q('p-fino').checked = slim;
  }
  async function comecar(fonte) {
    try {
      if (fonte === 'branco') {
        px = new Uint8ClampedArray(64 * 64 * 4);
        for (const r of regioes(slim)) if (r.camada === 'dentro') {
          const [x, y, w, h] = r.rect;
          for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px.set([214, 219, 224, 255], (yy * 64 + xx) * 4);
        }
      } else {
        const skin = fonte === 'atual' ? draft() : { base: { id: fonte, slim: q('p-fino').checked } };
        const a = await atlas64(skin, url);
        slim = a.slim;
        px = new Uint8ClampedArray(a.canvas.getContext('2d').getImageData(0, 0, 64, 64).data);
      }
      desfazer = []; refazer = [];
      comecado = true;
      botoes();
      previa();
      status(fonte === 'branco' ? 'Pintor: skin em branco.' : `Pintor: começando de ${q('p-fonte').selectedOptions[0].textContent.toLowerCase()}.`);
    } catch { status('Não foi possível abrir a skin no pintor.'); }
  }

  // ---- ferramentas ----
  const pode = (x, y) => { const r = regiaoDe(x, y, slim); return r && (fora || r.camada === 'dentro') ? r : null; };
  function pintar(x, y) {
    for (const p of espelhar ? [[x, y], espelho(x, y, slim)] : [[x, y]]) {
      if (!p) continue;
      const r = pode(p[0], p[1]);
      if (!r) continue;
      const i = (p[1] * 64 + p[0]) * 4;
      const valor = tool === 'borracha' ? (r.camada === 'fora' ? [0, 0, 0, 0] : NEUTRA) : cor;
      px.set(valor, i);
    }
  }
  function linha(x0, y0, x1, y1) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      pintar(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) { e += dy; x0 += sx; }
      if (e2 <= dx) { e += dx; y0 += sy; }
    }
  }
  function celula(ev) {
    const r = tela.getBoundingClientRect();
    return [Math.floor((ev.clientX - r.left) / r.width * 64), Math.floor((ev.clientY - r.top) / r.height * 64)];
  }
  function mostrarRegiao(x, y) {
    const r = regiaoDe(x, y, slim);
    q('p-regiao').textContent = r ? `${NOMES_PARTES[r.parte]} · ${NOMES_FACES[r.face]} · camada de ${r.camada} · (${x}, ${y})` : `(${x}, ${y}) · fora das regiões da skin`;
  }
  function setCor(hex) {
    const n = parseInt(hex.slice(1), 16);
    cor = [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
    q('p-cor').value = hex;
  }
  tela.addEventListener('pointerdown', (ev) => {
    if (!px || arrasto) return;
    ev.preventDefault();
    const [x, y] = celula(ev);
    mira = [x, y];
    mostrarRegiao(x, y);
    if (tool === 'conta') {
      const i = (y * 64 + x) * 4;
      if (regiaoDe(x, y, slim) && px[i + 3]) { setCor('#' + [px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')); tool = 'lapis'; botoes(); }
      desenhar();
      return;
    }
    if (tool === 'balde') {
      if (!pode(x, y)) return desenhar();
      guardar();
      preencher(px, x, y, cor, slim);
      const m = espelhar && espelho(x, y, slim);
      if (m && pode(m[0], m[1])) preencher(px, m[0], m[1], cor, slim);
      return previa();
    }
    guardar();
    arrasto = { id: ev.pointerId, x, y };
    try { tela.setPointerCapture(ev.pointerId); } catch { /* ponteiro sintético */ }
    pintar(x, y);
    previa();
  });
  tela.addEventListener('pointermove', (ev) => {
    if (!px) return;
    const [x, y] = celula(ev);
    if (!arrasto) { if (ev.pointerType === 'mouse') { mira = [x, y]; mostrarRegiao(x, y); desenhar(); } return; }
    if (arrasto.id !== ev.pointerId || (x === arrasto.x && y === arrasto.y)) return;
    linha(arrasto.x, arrasto.y, x, y);
    arrasto.x = x; arrasto.y = y;
    mira = [x, y];
    previa();
  });
  const soltar = () => { arrasto = null; };
  tela.addEventListener('pointerup', soltar);
  tela.addEventListener('pointercancel', soltar);
  tela.addEventListener('lostpointercapture', soltar);

  for (const b of dialog.querySelectorAll('[data-p-tool]')) b.onclick = () => { tool = b.dataset.pTool; botoes(); };
  q('p-espelho').onclick = () => { espelhar = !espelhar; botoes(); desenhar(); };
  q('p-grade').onclick = () => { grade = !grade; botoes(); desenhar(); };
  q('p-fora').onclick = () => { fora = !fora; botoes(); previa(); };
  q('p-desfazer').onclick = () => { if (!desfazer.length) return; refazer.push(px); px = desfazer.pop(); botoes(); previa(); };
  q('p-refazer').onclick = () => { if (!refazer.length) return; desfazer.push(px); px = refazer.pop(); botoes(); previa(); };
  q('p-zoom').oninput = () => { zoom = Number(q('p-zoom').value); desenhar(); };
  q('p-fino').onchange = () => { slim = q('p-fino').checked; botoes(); previa(); };
  q('p-cor').oninput = () => { setCor(q('p-cor').value); if (tool === 'borracha' || tool === 'conta') { tool = 'lapis'; botoes(); } };
  for (const hex of PALETA) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pintor-amostra';
    b.style.background = `linear-gradient(160deg, ${hex}, ${hex} 60%, #0004)`;
    b.setAttribute('aria-label', 'Cor ' + hex);
    b.onclick = () => { setCor(hex); if (tool !== 'balde') tool = 'lapis'; botoes(); };
    q('p-paleta').append(b);
  }
  for (const b of dialog.querySelectorAll('[data-p-copiar]')) b.onclick = () => { if (!px) return; guardar(); px = copiarLado(px, b.dataset.pCopiar, slim); previa(); };
  q('p-comecar').onclick = () => comecar(q('p-fonte').value);
  q('p-salvar').onclick = async () => {
    if (!px || salvando) return;
    salvando = true;
    botoes();
    status('Enviando a skin pintada…');
    try {
      actx.putImageData(new ImageData(normalizeSkinPixels(64, 64, px), 64, 64), 0, 0);
      const blob = await new Promise((resolve) => atlas.toBlob(resolve, 'image/png'));
      const id = await enviar(blob, 'skin');
      const d = draft();
      d.base = { id, slim };
      // a pintura agora contém tudo: as camadas pintadas do criador e as estampas saem (as peças 3D ficam)
      if (d.criador) d.criador = { ...d.criador, corpo: null, rosto: null, camisa: null, calca: null, sapato: null };
      d.camisa = ''; d.frente = d.costas = d.rosto = null;
      // a jaqueta do Explorador pinta o tronco e os braços por cima: com ela vestida, a pintura não apareceria
      const tirouJaqueta = !!d.traje?.jaqueta;
      if (tirouJaqueta) d.traje = { ...d.traje, jaqueta: false };
      status(`Skin pintada virou a sua base${tirouJaqueta ? ' (a jaqueta do Explorador saiu: ela cobriria a pintura)' : ''}. Toque em Aplicar no jogo para todos verem.`);
      requestPreview();
    } catch (e) {
      status(e.message || 'Não foi possível enviar a skin pintada.');
    } finally { salvando = false; botoes(); }
  };

  return {
    abrir() {
      // zoom inicial que cabe na largura da tela (celular em pé: 5; PC: 6 a 8)
      const cabe = Math.floor((q('p-caixa').clientWidth - 2) / 64);
      if (cabe >= 4) { zoom = Math.min(8, cabe); q('p-zoom').value = String(zoom); }
      if (!comecado) comecar('atual'); else { botoes(); desenhar(); }
    },
    fechar() { comecado = false; px = null; desfazer = []; refazer = []; mira = null; },
    // o que a prévia 3D mostra enquanto o pintor está aberto: a pintura como base e só as peças 3D por cima
    previa(skin) {
      if (!px) return null;
      actx.putImageData(new ImageData(px, 64, 64), 0, 0);
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      c.getContext('2d').drawImage(atlas, 0, 0);
      const so3d = skin.criador ? { ...skin.criador, corpo: null, rosto: null, camisa: null, calca: null, sapato: null } : null;
      const traje = skin.traje ? { ...skin.traje, jaqueta: false } : null;
      return { skin: { ...skin, base: null, criador: so3d, traje, camisa: '', frente: null, costas: null, rosto: null }, opts: { base: c, slim, semFora: !fora } };
    },
  };
}
