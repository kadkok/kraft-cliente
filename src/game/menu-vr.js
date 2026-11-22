// Kraft — MENU DO VR (19/11/2026, pedido do Kadmus: "quem joga com mobile ou principalmente com VR precisa ter todas as
// opções de jogo similares a como aparece no PC… no óculos VR nenhum botão abriu o menu do futebol").
// Dentro da sessão imersiva o HTML não aparece: este módulo mostra, num quadro 3D operado pelo laser do controle
// direito (como o quadro do mapa de render/xr.js), as mesmas opções das telas do PC, em abas:
//   ⚽ Futebol (time, começar/parar, zerar, meta − +, tempo, robôs, goleiro, juiz, habilidade, curva, XP/visual, Modo GM)
//   👑 Estúdio GM (presets e todos os ajustes do PC) · 🎮 Modo de jogo · 🎒 Mochila · 🧱 Blocos · 📦 Baú (quando aberto)
//   🏗 Construção (obras, mini-bloco, tronco) · 🗺 Mapa e mundo · ⚙ Ajustes · 💬 Chat (frases rápidas) · 🚪 Sair
// Abre e fecha no X do controle esquerdo e no botão ☰ do pulso (render/xr.js). Também aparece sozinho quando uma tela do
// PC se abre durante o VR (baú pelo B, painel do futebol, mochila, chat): a tela vira a aba correspondente, e uma tela
// sem versão no VR (bancada, editor de objetos) ganha um aviso com "Fechar" — antes ela prendia o jogador, invisível.
// O modelo (abas, itens, desenho em pixels, quem o laser tocou) é puro e testado: game/menu-vr-modelo.js. As ações vão
// pelos MESMOS caminhos do PC: game.futebol.painel (game/bola.js), game.modes, game.items, game.baus, game.groups,
// game.mapa, game.bussola e os eventos da interface (`ui.on`: setting, timeRate, chatSend, hotbar, trunkMode…).
// Com o menu aberto a mira do mundo fica parada onde estava (`miraFixa`, lida por xr.js): as ações de obra e o
// mergulho no plano nano valem para o bloco que estava na mira antes de abrir.
// Também aqui, só no VR: o LETREIRO (avisos do jogo, chat, faixas e GOL! do futebol, que no PC são HTML) e a DICA de
// ação da mira ("📦 Baú — B abre"), presos à cabeça logo abaixo da bússola e embaixo do campo de visão.
//
// Contrato para quem desenha (Astra): o desenho de hoje é provisório e funcional (gradiente, texto claro sobre escuro).
//   game.menuVr.setPintor(fn) troca o pintor do quadro: fn(ctx, modelo, { icone(item) → canvas, hover }) desenha no
//   canvas de PAINEL_W × PAINEL_H (menu-vr-modelo.js) usando modelo.abas, modelo.layout.itens (x, y, w, h em pixels do
//   conteúdo; some CONTEUDO.x/.y e subtraia modelo.rolagem), modelo.titulo e modelo.placar. Não mude as posições: o
//   laser acerta pelo mesmo desenho (acharAlvo). O realce do item sob o laser é a malha `realce` (textura própria).
//   O letreiro e a dica têm pintores próprios: setPintorLetreiro(fn(ctx, W, H, mensagens)), setPintorDica(fn(ctx, W, H, texto)).
import * as THREE from '../three.js';
import {
  PAINEL_W, PAINEL_H, TOPO_H, CONTEUDO, FECHAR, RODAPE, AJUDA_CONTROLES, retanguloDaAba, rolagemMaxima,
  montarModelo, acharAlvo, acaoDoAlvo, secaoDoOverlay, AJUSTES, passoAjuste,
} from './menu-vr-modelo.js';
import { CAMPO_GM, passoCampo, proximaMeta } from './futebol-painel.js';
import { MODES, MODE_IDS } from '../../shared/modes.js';
import { TEXTO_MODOS } from './modes.js';
import { BLOCKS, PALETTE } from '../../shared/blocks.js';
import { itemName, bagTotal, bagUsed } from '../../shared/items.js';
import { NOME_NIVEL, textoDoValor, valorDaLista, tesouroDe } from '../../shared/tesouros.js';
import { TIME_RATES, dayLasts } from '../../shared/clock.js';
import { GROUPS } from '../ui/ui.js';

const LARG_M = 1.25;                                   // largura do quadro no VR, em metros
const ALT_M = LARG_M * PAINEL_H / PAINEL_W;
const DIST = 1.15;                                     // a quantos metros da cabeça o quadro aparece
const PX = LARG_M / PAINEL_W;                          // metros por pixel do quadro
const textoDia = (r) => (r <= 0 ? 'tempo parado' : r === 1 ? '24 h, como no mundo real' : `o dia dura ${dayLasts(r)}`);

// ---- pintor provisório do quadro ------------------------------------------------------------------------------------------
function pilula(ctx, x, y, w, h, r, c0, c1, borda, larguraBorda = 2) {
  const g = ctx.createLinearGradient(x, y, x + w * 0.35, y + h);
  g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  if (borda) { ctx.strokeStyle = borda; ctx.lineWidth = larguraBorda; ctx.stroke(); }
}
function escurecer(hex, k) {
  const n = parseInt(String(hex || '#888888').slice(1), 16);
  const c = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
// texto que cabe: diminui a letra até caber (mínimo 15 px) e corta com reticências
function caber(ctx, texto, maxW, tam, peso = 700) {
  let t = tam;
  ctx.font = `${peso} ${t}px system-ui, sans-serif`;
  while (t > 15 && ctx.measureText(texto).width > maxW) { t -= 1; ctx.font = `${peso} ${t}px system-ui, sans-serif`; }
  if (ctx.measureText(texto).width <= maxW) return texto;
  let s = texto;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function quebrarLinhas(ctx, texto, maxW) {
  const palavras = String(texto).split(/\s+/), linhas = [];
  let atual = '';
  for (const p of palavras) {
    const t = atual ? atual + ' ' + p : p;
    if (ctx.measureText(t).width > maxW && atual) { linhas.push(atual); atual = p; } else atual = t;
  }
  if (atual) linhas.push(atual);
  return linhas;
}
const TONS = {
  normal: ['rgba(40,58,78,0.94)', 'rgba(14,23,34,0.96)'],
  on: ['#f4a64e', '#c8602a'],
  primario: ['#48c9b0', '#23808f'],
  perigo: ['rgba(150,48,38,0.95)', 'rgba(82,24,20,0.96)'],
};

export function pintorPadrao(ctx, m, { icone }) {
  const W = PAINEL_W, H = PAINEL_H;
  ctx.clearRect(0, 0, W, H);
  pilula(ctx, 2, 2, W - 4, H - 4, 30, 'rgba(24,38,54,0.97)', 'rgba(9,15,23,0.98)', 'rgba(255,255,255,0.24)', 3);
  // topo: título, placar e Fechar
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = '#ffd9a0'; ctx.font = '800 30px system-ui, sans-serif';
  ctx.fillText('☰ Kraft', 26, TOPO_H / 2 + 2);
  ctx.fillStyle = '#f6f2e9'; ctx.font = '700 28px system-ui, sans-serif';
  ctx.fillText(caber(ctx, m.titulo, 340, 28), 170, TOPO_H / 2 + 2);
  if (m.placar) {
    const f = m.placar, cx = 720, y = TOPO_H / 2 + 2;
    pilula(ctx, cx - 200, 16, 400, 48, 14, 'rgba(16,42,24,0.95)', 'rgba(8,22,12,0.95)', 'rgba(220,255,220,0.3)');
    ctx.textAlign = 'center'; ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff'; ctx.fillText(`${f.placar[0]} × ${f.placar[1]}`, cx, y);
    ctx.textAlign = 'right'; ctx.fillStyle = f.cores[0]; ctx.fillText(caber(ctx, `⚽ ${f.lados[0]}`, 150, 24, 800), cx - 46, y);
    ctx.textAlign = 'left'; ctx.fillStyle = f.cores[1]; ctx.fillText(caber(ctx, f.lados[1], 150, 24, 800), cx + 46, y);
  }
  pilula(ctx, FECHAR.x, FECHAR.y, FECHAR.w, FECHAR.h, 14, ...TONS.perigo, 'rgba(255,255,255,0.3)');
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '700 25px system-ui, sans-serif';
  ctx.fillText('✕ Fechar (X)', FECHAR.x + FECHAR.w / 2, FECHAR.y + FECHAR.h / 2 + 1);
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(18, TOPO_H, W - 36, 2);
  // abas
  m.abas.forEach((a, i) => {
    const r = retanguloDaAba(i), on = a.id === m.secao;
    pilula(ctx, r.x, r.y, r.w, r.h, 14, ...(on ? TONS.on : TONS.normal), on ? 'rgba(255,226,160,0.9)' : 'rgba(255,255,255,0.18)');
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
    ctx.fillText(caber(ctx, `${a.icone}  ${a.rotulo}`, r.w - 28, 24, on ? 800 : 650), r.x + 16, r.y + r.h / 2 + 1);
  });
  // conteúdo (rolado e recortado)
  ctx.save();
  ctx.beginPath(); ctx.rect(CONTEUDO.x - 4, CONTEUDO.y - 4, CONTEUDO.w + 8, CONTEUDO.h + 8); ctx.clip();
  ctx.translate(CONTEUDO.x, CONTEUDO.y - m.rolagem);
  for (const it of m.layout.itens) {
    if (it.y + it.h < m.rolagem - 10 || it.y > m.rolagem + CONTEUDO.h + 10) continue;
    pintarItem(ctx, it, icone);
  }
  ctx.restore();
  // rodapé: último aviso ou a ajuda dos controles
  const aviso = !!m.rodape;
  pilula(ctx, RODAPE.x, RODAPE.y, RODAPE.w, RODAPE.h, 14, ...(aviso ? ['rgba(48,40,18,0.92)', 'rgba(24,20,8,0.92)'] : ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.02)']),
    aviso ? 'rgba(255,226,138,0.5)' : 'rgba(255,255,255,0.12)');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = aviso ? '#ffe28a' : '#9aa6b2';
  ctx.fillText(caber(ctx, aviso ? m.rodape : AJUDA_CONTROLES, RODAPE.w - 40, 24, aviso ? 700 : 600), RODAPE.x + RODAPE.w / 2, RODAPE.y + RODAPE.h / 2 + 1);
  // barra de rolagem
  const max = rolagemMaxima(m.layout);
  if (max > 0) {
    const x = W - 20, y0 = CONTEUDO.y, h = CONTEUDO.h, alto = Math.max(60, h * h / (h + max)), y = y0 + (h - alto) * (m.rolagem / max);
    pilula(ctx, x, y0, 8, h, 4, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.04)');
    pilula(ctx, x, y, 8, alto, 4, '#f4a64e', '#c8602a');
  }
}

function pintarItem(ctx, it, icone) {
  ctx.textBaseline = 'middle';
  if (it.tipo === 'titulo') {
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffd9a0';
    ctx.fillText(caber(ctx, it.texto.toUpperCase(), it.w, 21, 750), it.x + 4, it.y + it.h / 2 + 4);
    return;
  }
  if (it.tipo === 'nota') {
    if (it.tom === 'destaque') pilula(ctx, it.x, it.y, it.w, it.h, 12, 'rgba(60,48,20,0.55)', 'rgba(30,24,10,0.55)', 'rgba(255,226,138,0.35)');
    ctx.textAlign = 'left'; ctx.font = `${it.tom === 'destaque' ? 700 : 500} 22px system-ui, sans-serif`;
    ctx.fillStyle = it.tom === 'destaque' ? '#ffe28a' : it.tom === 'sys' ? '#9fe8d8' : '#c3ccd6';
    quebrarLinhas(ctx, it.texto, it.w - 24).forEach((l, i) => ctx.fillText(l, it.x + 12, it.y + 22 + i * 30));
    return;
  }
  if (it.tipo === 'celula') {
    const on = !!it.on;
    pilula(ctx, it.x, it.y, it.w, it.h, 14, ...(on ? ['rgba(244,166,78,0.42)', 'rgba(200,96,42,0.34)'] : ['rgba(40,58,78,0.9)', 'rgba(14,23,34,0.92)']),
      on ? '#f4a64e' : it.marca === 'lenda' ? 'rgba(246,210,122,0.95)' : 'rgba(255,255,255,0.18)', on || it.marca === 'lenda' ? 4 : 2);
    if (it.item) {
      const cv = icone(it.item);
      if (cv) ctx.drawImage(cv, it.x + 12, it.y + 10, it.w - 24, it.h - 24);
      if (it.item[2] > 1) {
        ctx.textAlign = 'right'; ctx.font = '800 21px system-ui, sans-serif';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(String(it.item[2]), it.x + it.w - 8, it.y + it.h - 14);
        ctx.fillStyle = '#fff'; ctx.fillText(String(it.item[2]), it.x + it.w - 8, it.y + it.h - 14);
      }
    }
    if (it.marca === 'barra') { const g = ctx.createLinearGradient(it.x, 0, it.x + it.w, 0); g.addColorStop(0, '#f4a64e'); g.addColorStop(1, '#c8602a'); ctx.fillStyle = g; ctx.fillRect(it.x + 10, it.y + it.h - 6, it.w - 20, 4); }
    return;
  }
  if (it.tipo === 'passo' || it.tipo === 'ciclo') {
    pilula(ctx, it.x, it.y, it.w, it.h, 14, ...TONS.normal, 'rgba(255,255,255,0.2)');
    const fimTexto = it.partes.menos.x - 10;
    ctx.textAlign = 'left'; ctx.fillStyle = '#c3ccd6';
    const rot = caber(ctx, it.rotulo, Math.max(60, (fimTexto - it.x) * 0.55), 21, 600);
    ctx.fillText(rot, it.x + 14, it.y + it.h / 2);
    const rw = ctx.measureText(rot).width;
    let vx = it.x + 24 + rw;
    if (it.cor) {
      const g = ctx.createRadialGradient(vx + 12, it.y + it.h / 2 - 3, 2, vx + 14, it.y + it.h / 2, 15);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, it.cor); g.addColorStop(1, escurecer(it.cor, 0.6));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(vx + 14, it.y + it.h / 2, 14, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();
      vx += 36;
    }
    ctx.fillStyle = '#f6f2e9';
    ctx.fillText(caber(ctx, it.valor, Math.max(40, fimTexto - vx), 25, 800), vx, it.y + it.h / 2);
    const [a, b] = it.tipo === 'passo' ? ['−', '+'] : ['◀', '▶'];
    for (const [k, s] of [['menos', a], ['mais', b]]) {
      const p = it.partes[k];
      pilula(ctx, p.x, p.y, p.w, p.h, 12, ...TONS.on, 'rgba(255,226,160,0.7)');
      ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = '800 30px system-ui, sans-serif';
      ctx.fillText(s, p.x + p.w / 2, p.y + p.h / 2 + 1);
    }
    return;
  }
  // botão
  const tom = it.on ? TONS.on : it.tom === 'primario' ? TONS.primario : it.tom === 'perigo' ? TONS.perigo
    : it.tom === 'time' && it.cor ? [it.cor, escurecer(it.cor, 0.45)] : TONS.normal;
  ctx.globalAlpha = it.desligado ? 0.42 : 1;
  pilula(ctx, it.x, it.y, it.w, it.h, 14, ...tom, it.on ? 'rgba(255,226,160,0.95)' : 'rgba(255,255,255,0.22)', it.on ? 3 : 2);
  if (it.cor && it.tom !== 'time') {
    const g = ctx.createLinearGradient(it.x, 0, it.x + it.w, 0); g.addColorStop(0, it.cor); g.addColorStop(1, escurecer(it.cor, 0.6));
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(it.x + 12, it.y + 6, it.w - 24, 6, 3); ctx.fill();
  }
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  const t = caber(ctx, it.texto, it.w - 20, 24, 750);
  ctx.strokeText(t, it.x + it.w / 2, it.y + it.h / 2 + 2);
  ctx.fillText(t, it.x + it.w / 2, it.y + it.h / 2 + 2);
  ctx.globalAlpha = 1;
}

// ---- letreiro (avisos) e dica, presos à cabeça ------------------------------------------------------------------------------
function pintorLetreiroPadrao(ctx, W, H, msgs) {
  ctx.clearRect(0, 0, W, H);
  if (!msgs.length) return;
  const placar = msgs.find((m) => m.grande);
  if (placar) {
    pilula(ctx, 40, 6, W - 80, H - 12, 26, 'rgba(20,30,16,0.86)', 'rgba(8,14,8,0.8)', placar.cor || 'rgba(255,226,138,0.6)', 4);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff7d6'; ctx.font = '900 88px system-ui, sans-serif'; ctx.fillText(placar.titulo, W / 2, 82);
    ctx.fillStyle = '#ffe28a'; ctx.fillText(caber(ctx, placar.sub || '', W - 140, 30, 700), W / 2, 168);
    return;
  }
  const ult = msgs.slice(-2);
  ult.forEach((m, i) => {
    const y = H - (ult.length - i) * 100 + 4;
    ctx.font = '700 30px system-ui, sans-serif';
    const linhas = quebrarLinhas(ctx, m.texto, W - 140).slice(0, 2);
    const w = Math.min(W - 40, Math.max(...linhas.map((l) => ctx.measureText(l).width)) + 70);
    const fundo = m.cor ? [m.cor, escurecer(m.cor, 0.45)] : ['rgba(24,38,54,0.92)', 'rgba(11,19,29,0.92)'];
    pilula(ctx, (W - w) / 2, y, w, 92, 20, ...fundo, 'rgba(255,255,255,0.3)');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f6f2e9';
    linhas.forEach((l, k) => ctx.fillText(l, W / 2, y + 46 + (k - (linhas.length - 1) / 2) * 34));
  });
}
function pintorDicaPadrao(ctx, W, H, texto) {
  ctx.clearRect(0, 0, W, H);
  if (!texto) return;
  ctx.font = '700 32px system-ui, sans-serif';
  const linhas = quebrarLinhas(ctx, texto, W - 90).slice(0, 2);
  if (linhas.length === 2 && ctx.measureText(linhas[1]).width > W - 90) linhas[1] = caber(ctx, linhas[1], W - 90, 32, 700);
  const w = Math.min(W - 20, Math.max(...linhas.map((l) => ctx.measureText(l).width)) + 60), h = linhas.length * 42 + 22;
  pilula(ctx, (W - w) / 2, (H - h) / 2, w, h, 22, 'rgba(14,20,28,0.88)', 'rgba(8,12,18,0.8)', 'rgba(255,217,160,0.45)');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f6f2e9';
  ctx.font = '700 32px system-ui, sans-serif';
  linhas.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (i - (linhas.length - 1) / 2) * 42 + 1));
}

function planoDeCanvas(w, h, largM, { semProfundidade = false } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(largM, largM * h / w),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: !semProfundidade, fog: false }));
  return { cv, ctx, tex, mesh };
}

export function initMenuVr({ game, net, ui, player, interaction, camera, scene, store, settings, openOverlay, closeOverlay }) {
  // ---- quadro ----------------------------------------------------------------------------------------------------------------
  const quadro = planoDeCanvas(PAINEL_W, PAINEL_H, LARG_M);
  quadro.mesh.renderOrder = 12;
  const grupo = new THREE.Group();
  grupo.visible = false; grupo.name = 'menu-vr';
  grupo.add(quadro.mesh);
  scene.add(grupo);
  // realce do item sob o laser: moldura dourada esticada sobre o item (sem redesenhar o quadro a cada passada do laser)
  const realceCv = document.createElement('canvas'); realceCv.width = 256; realceCv.height = 128;
  {
    const c = realceCv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 256, 128); g.addColorStop(0, 'rgba(255,236,170,0.95)'); g.addColorStop(1, 'rgba(244,166,78,0.95)');
    c.strokeStyle = g; c.lineWidth = 9; c.beginPath(); c.roundRect(6, 6, 244, 116, 22); c.stroke();
    const f = c.createLinearGradient(0, 0, 0, 128); f.addColorStop(0, 'rgba(255,240,200,0.16)'); f.addColorStop(1, 'rgba(255,200,120,0.08)');
    c.fillStyle = f; c.fill();
  }
  const realceTex = new THREE.CanvasTexture(realceCv); realceTex.colorSpace = THREE.SRGBColorSpace;
  const realce = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: realceTex, transparent: true, depthWrite: false, fog: false }));
  realce.position.z = 0.004; realce.renderOrder = 13; realce.visible = false;
  grupo.add(realce);

  let pintor = pintorPadrao, pintorLetreiro = pintorLetreiroPadrao, pintorDica = pintorDicaPadrao;
  const st = {
    secao: null, rolagem: {}, selMochila: -1, umPorVez: false, grupoBlocos: 'todos', rascunhoGm: null,
    alvo: null, mira: null, ritmo: null, overlayVisto: null, modelo: null, chave: '', desenhadoEm: 0, montadoEm: 0, sujo: true,
    chat: [], ultimaRolagem: 0,
  };
  const ancora = new THREE.Vector3(), cab = new THREE.Vector3(), dir = new THREE.Vector3();
  const presente = () => !!game.xr?.presenting;
  const P = () => game.futebol?.painel;

  // ---- o retrato do jogo que o modelo lê -------------------------------------------------------------------------------------
  function retrato() {
    const r = game.modeRules || {};
    const bag = game.items?.bag || { l: [], auto: true };
    const l = bag.l || [];
    const f = P()?.estado?.() || null;
    if (f?.isGm && f.gmAtivo && !st.rascunhoGm) st.rascunhoGm = P().rascunho();
    if (!(f?.isGm && f.gmAtivo)) st.rascunhoGm = null;
    const aberto = game.baus?.aberto || null;
    const lendaIt = aberto?.l?.find((e) => e && tesouroDe(e[0])?.arma);
    const rec = game.groups?.recording;
    const ritmo = st.ritmo ?? net.rate ?? 1;
    return {
      overlay: game.overlay, pausado: game.state === 'PAUSED', espacoAtivo: !!game.espacoAtivo,
      futebol: f, gmRascunho: st.rascunhoGm,
      modo: { id: game.mode, regras: r, texto: TEXTO_MODOS[game.mode] || '', voando: !!player.flying, lista: MODE_IDS.map((m) => [m, MODES[m].nome]) },
      mochila: { l, auto: bag.auto !== false, sel: st.selMochila, barra: !r.criativo, invisivel: !!r.invisivel, offline: !!net.offline,
        total: bagTotal(l), usados: bagUsed(l), nome: (e) => itemName(e[0], e[1]) },
      blocos: { grupo: st.grupoBlocos, grupos: GROUPS.filter(([g]) => g !== 'minecraft'), sel: game.sel, barra: game.hotbar.slice(0, 9),
        lista: PALETTE.filter((id) => st.grupoBlocos === 'todos' || BLOCKS[id].group === st.grupoBlocos) },
      bau: aberto ? { nivel: NOME_NIVEL[aberto.nivel] || aberto.nivel || '', valor: textoDoValor(valorDaLista(aberto.l)), l: aberto.l.slice(0, 27),
        lenda: lendaIt ? tesouroDe(lendaIt[0]).nome : '', ehLenda: (e) => !!(e && tesouroDe(e[0])?.arma), mochila: l, barra: !r.criativo, um: st.umPorVez } : null,
      obras: { gravando: rec ? { n: rec.cells.size, o: rec.kids.size } : null, ativa: game.groups?.active || null, mini: !!interaction.miniMode,
        tronco: !!interaction.squareTrunk, machado: !!game.machado?.equipado(), offline: !!net.offline },
      mundo: { bussola: !!game.bussola?.ligada, dim: game.dim || 0, offline: !!net.offline },
      ajustes: { volume: settings.volume, music: settings.music, distance: settings.distance, autoJump: !!player.autoJump,
        snapTurn: settings.snapTurn !== false, real: settings.real !== false, dia: textoDia(ritmo) },
      chat: { linhas: st.chat, teclado: !!game.xr?.sessao?.()?.isSystemKeyboardSupported },
    };
  }

  // ícones das células: o desenho de game/items.js (bloco, bloco do Minecraft ou tesouro), guardado por item
  const icones = new Map();
  function icone(item) {
    const k = item[0] + ':' + (item[1] || 0);
    let cv = icones.get(k);
    if (cv) return cv;
    if (!game.icons || !game.items?.icon) return null;
    cv = document.createElement('canvas'); cv.width = cv.height = 64;
    game.items.icon(cv, item[0], item[1] || 0, 64);
    icones.set(k, cv);
    return cv;
  }

  // ---- abrir, fechar, posição -------------------------------------------------------------------------------------------------
  const visivel = () => presente() && ((game.state === 'PLAYING' && !!game.overlay && game.overlay !== 'mapa') || game.state === 'PAUSED');
  let estavaVisivel = false;
  function posicionar() {
    camera.getWorldPosition(cab);
    camera.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)); else dir.normalize();
    const y = cab.y - 0.1;
    grupo.position.set(cab.x + dir.x * DIST, y, cab.z + dir.z * DIST);
    grupo.lookAt(cab.x, y, cab.z);
    ancora.set(player.pos[0], player.pos[1], player.pos[2]);
  }
  function secaoInicial(e) {
    if (e.futebol?.temCampo && (e.futebol.noCampo || e.futebol.perto)) return 'futebol';
    if (st.secao) return st.secao;
    return e.modo.regras?.criativo && !e.espacoAtivo ? 'blocos' : 'mochila';
  }
  function abrir(secao) {
    if (!presente()) return false;
    if (game.state === 'PAUSED') return true;
    if (game.state !== 'PLAYING') return false;
    if (game.mapa?.aberto) game.mapa.fecha();
    if (!game.overlay) {
      st.mira = Array.isArray(game.aimRay) ? game.aimRay.slice() : null;   // a mira do mundo fica onde estava
      openOverlay('menu-vr');
    }
    st.secao = secao || secaoInicial(retrato());
    st.sujo = true;
    game.audio?.play?.('open', 0.8, 1.05);
    return true;
  }
  function fechar() {
    const o = game.overlay;
    if (game.state === 'PAUSED') { ui.on?.resume?.(); return; }
    if (o === 'bau') game.baus?.fechar?.();
    else if (o === 'futebol') game.futebol?.fecharPainel?.();
    else if (o) closeOverlay();
    st.alvo = null;
    game.audio?.play?.('tick', 0.7, 0.9);
  }
  const alternar = () => (visivel() ? fechar() : abrir());

  // ---- ações (os mesmos caminhos do PC) ----------------------------------------------------------------------------------
  const avisar = (t, ms = 2200) => ui.toast(t, ms);
  const acoes = {
    aba(id) { st.secao = id; if (id === 'gm' && !st.rascunhoGm && P()) st.rascunhoGm = P().rascunho(); },
    fechar,
    'fut.time': (t) => P()?.escolherTime(t),
    'fut.partida': () => P()?.alternarPartida(),
    'fut.zerar': () => P()?.zerar(),
    'fut.meta': (n) => P()?.meta(n),
    'fut.metaPasso': ({ dir: d }) => { const p = P(); if (p) p.meta(proximaMeta(p.estado().partida.meta, d)); },
    'fut.tempo': (seg) => P()?.tempo(seg),
    'fut.robos': (mudar) => P()?.robos(mudar),
    'fut.skill': (i) => game.futebol?.selectSkill(i),
    'fut.curva': () => game.futebol?.alternarCurva(),
    'fut.gm': () => P()?.alternarGm(),
    'fut.chuteira': (id) => P()?.perfil({ chuteira: id }),
    'fut.skin': (id) => P()?.perfil({ skin: id }),
    'gm.preset': (id) => { const cfg = P()?.aplicarPreset(id); if (cfg) st.rascunhoGm = cfg; },
    'gm.campo': ({ id, dir: d }) => { if (st.rascunhoGm && CAMPO_GM[id]) passoCampo(st.rascunhoGm, CAMPO_GM[id], d); },
    'gm.restaurar': () => { const cfg = P()?.restaurarPadrao(); if (cfg) st.rascunhoGm = cfg; },
    'gm.recarregar': () => { if (P()) { st.rascunhoGm = P().rascunho(); avisar('Rascunho de volta ao que está no estádio.'); } },
    'gm.salvar': () => { if (st.rascunhoGm) P()?.salvarCustom(structuredClone(st.rascunhoGm)); },
    'modo.set': (m) => game.modes?.set(m),
    'modo.voar': () => { if (!game.modeRules?.voa || game.espacoAtivo) return; player.flying = !player.flying; if (player.flying) player.vel[1] = 0; },
    'mochila.slot': (k) => {
      const l = game.items?.bag?.l || [];
      if (st.selMochila >= 0 && st.selMochila !== k) { game.items.trocar(st.selMochila, k); st.selMochila = -1; }
      else st.selMochila = st.selMochila === k || !l[k] ? -1 : k;
    },
    'mochila.largar': (tudo) => { if (st.selMochila >= 0) game.items?.largar(st.selMochila, tudo); },
    'mochila.coleta': () => game.items?.alternarColeta(),
    'mochila.pegar': () => game.items?.collectNear(),
    'blocos.grupo': (g) => { st.grupoBlocos = g; st.rolagem.blocos = 0; },
    'blocos.barra': (i) => ui.on?.hotbar?.(i),
    // o mesmo que main.js → pickBlock, sem fechar a tela (no visor se escolhe vários espaços de uma vez)
    'blocos.bloco': (id) => { game.hotbar[game.sel] = id; store.set('hotbar', game.hotbar); ui.setHotbar(game.hotbar, game.sel); game.audio?.play?.('tick', 1, 1.2); },
    'bau.pegar': (i) => game.baus?.pegar(i, st.umPorVez ? 1 : 0),
    'bau.por': (k) => game.baus?.por(k, st.umPorVez ? 1 : 0),
    'bau.um': () => { st.umPorVez = !st.umPorVez; },
    'bau.fechar': () => game.baus?.fechar(),
    'obras.agrupar': () => game.groups?.toggle(),
    'obras.juntar': () => game.groups?.include(),
    'obras.trocar': () => game.groups?.swap(),
    'obras.camada': () => game.groups?.layerUp(),
    'obras.desagrupar': () => game.groups?.ungroup(),
    // o mesmo que main.js faz na tecla Y (ação 'mini')
    'obras.mini': () => {
      interaction.miniMode = !interaction.miniMode;
      game.audio?.play?.('tick', 1, interaction.miniMode ? 1.15 : 0.85);
      avisar(interaction.miniMode ? 'Modo mini-bloco (0,5 × 0,5 × 1 m): o gatilho e o aperto põem e tiram ¼ de bloco.' : 'Modo bloco inteiro.', 2600);
    },
    'obras.machado': () => game.machado?.alternar(),
    'obras.tronco': () => ui.on?.trunkMode?.(),
    'mundo.mapa': () => { fechar(); game.mapa?.abre(); },
    'mundo.bussola': () => game.bussola?.alternar(),
    'mundo.plano': (k) => ui.on?.chatSend?.('/' + k),                  // main.js → changePlane (usa a mira parada)
    'mundo.inicio': () => ui.on?.chatSend?.('/inicio'),
    'mundo.povos': () => net.chat('/povos'),
    'ajuste.passo': ({ chave, dir: d }) => { const a = AJUSTES.find((x) => x.chave === chave); if (a) ui.on?.setting?.(chave, passoAjuste(a, settings[chave], d)); },
    'ajuste.liga': (chave) => ui.on?.setting?.(chave, chave === 'autoJump' ? !player.autoJump : settings[chave] === false),
    'ajuste.real': () => ui.on?.setting?.('real', settings.real === false),
    'ajuste.dia': ({ dir: d }) => {
      const atual = st.ritmo ?? net.rate ?? 1;
      let i = 0;
      for (let k = 1; k < TIME_RATES.length; k++) if (Math.abs(TIME_RATES[k] - atual) < Math.abs(TIME_RATES[i] - atual)) i = k;
      st.ritmo = TIME_RATES[Math.max(0, Math.min(TIME_RATES.length - 1, i + d))];
      ui.on?.timeRate?.(st.ritmo);
    },
    'chat.frase': (t) => net.chat(t),
    'chat.teclado': () => ui.on?.chatOpen?.(''),
    'sair.continuar': () => fechar(),
    'sair.vr': () => game.xr?.sair?.(),
    'sair.menu': () => { game.xr?.sair?.(); setTimeout(() => ui.on?.leave?.(), 400); },
    'tela.fechar': () => closeOverlay(),
  };

  function executar(acao, arg) {
    const f = acoes[acao];
    if (!f) return;
    try { f(arg); } catch (e) { console.error('[menu-vr]', acao, e); }
    st.sujo = true;
    game.audio?.play?.('tick', 0.85, 1.05);
  }

  // ---- laser (chamado por render/xr.js) ------------------------------------------------------------------------------------
  const daUv = (uv) => [uv.x * PAINEL_W, (1 - uv.y) * PAINEL_H];
  function posicionarRealce(rect) {
    if (!rect) { realce.visible = false; return; }
    const doConteudo = !!rect.conteudo;                                        // item rolado: recorta na janela do conteúdo
    const y0 = Math.max(rect.y, doConteudo ? CONTEUDO.y : 0), y1 = Math.min(rect.y + rect.h, doConteudo ? CONTEUDO.y + CONTEUDO.h : PAINEL_H);
    if (y1 <= y0) { realce.visible = false; return; }
    realce.visible = true;
    realce.position.set((rect.x + rect.w / 2) * PX - LARG_M / 2, ALT_M / 2 - ((y0 + y1) / 2) * PX, 0.004);
    realce.scale.set(rect.w * PX + 0.01, (y1 - y0) * PX + 0.01, 1);
  }
  const painelLaser = {
    mesh: quadro.mesh,
    visivel: () => grupo.visible,
    apontar(uv) {
      if (!uv || !st.modelo) { st.alvo = null; realce.visible = false; return; }
      const [x, y] = daUv(uv);
      st.alvo = acharAlvo(st.modelo, x, y);
      posicionarRealce(st.alvo?.rect || null);
    },
    clique(uv) {
      if (!st.modelo) return;
      const [x, y] = daUv(uv);
      const a = acaoDoAlvo(acharAlvo(st.modelo, x, y));
      if (a) executar(a[0], a[1]);
    },
    rolar(v) {
      const agora = performance.now(), dt = Math.min(0.1, (agora - (st.ultimaRolagem || agora)) / 1000);
      st.ultimaRolagem = agora;
      if (!st.modelo || Math.abs(v) < 0.25) return;
      const s = st.modelo.secao;
      st.rolagem[s] = Math.max(0, Math.min(rolagemMaxima(st.modelo.layout), (st.rolagem[s] || 0) + v * 900 * dt));
      st.sujo = true;
    },
  };
  quadro.mesh.userData.vrPainel = painelLaser;
  (game.vrPaineis ||= []).push(painelLaser);

  // ---- letreiro e dica (só no VR) -----------------------------------------------------------------------------------------
  const letreiro = planoDeCanvas(1024, 232, 0.8, { semProfundidade: true });
  letreiro.mesh.position.set(0, 0.14, -1.25); letreiro.mesh.rotation.x = 0.1; letreiro.mesh.renderOrder = 15; letreiro.mesh.visible = false;
  const dica = planoDeCanvas(1024, 128, 0.8, { semProfundidade: true });
  dica.mesh.position.set(0, -0.3, -1.2); dica.mesh.rotation.x = -0.24; dica.mesh.renderOrder = 15; dica.mesh.visible = false;
  camera.add(letreiro.mesh, dica.mesh);
  const avisos = [];          // { texto, cor?, ate, grande?, titulo?, sub? }
  let chaveLetreiro = '', textoDica = '';
  function aviso(m) {
    m.ate = performance.now() + Math.max(1500, Math.min(m.grande ? 6000 : 4500, m.ms || 3000));
    if (m.grande) for (let i = avisos.length - 1; i >= 0; i--) if (avisos[i].grande) avisos.splice(i, 1);
    avisos.push(m);
    if (avisos.length > 6) avisos.shift();
  }
  ui.ouvir?.((tipo, a) => {
    if (tipo === 'toast') aviso({ texto: a.texto, ms: a.ms });
    else if (tipo === 'chat') {
      st.chat.push({ nome: a.nome, texto: a.texto, sys: a.sys });
      if (st.chat.length > 30) st.chat.shift();
      aviso({ texto: a.nome ? `${a.nome}: ${a.texto}` : a.texto, ms: 4200 });
    }
  });
  game.futebol?.on?.((tipo, a) => {
    if (tipo === 'aviso') aviso({ texto: a.texto, cor: a.cor, ms: 2600 });
    else if (tipo === 'placar') aviso({ grande: true, titulo: a.titulo, sub: a.sub, ms: a.ms, cor: a.time === 0 || a.time === 1 ? P()?.estado().cores[a.time] : null });
  });
  // o aviso mais recente em uma linha (vai no rodapé do quadro quando o menu está aberto)
  const ultimoAviso = () => { const m = avisos[avisos.length - 1]; return m ? (m.grande ? `${m.titulo} ${m.sub || ''}`.trim() : m.texto) : ''; };
  function desenharLetreiro() {
    const agora = performance.now();
    for (let i = avisos.length - 1; i >= 0; i--) if (avisos[i].ate < agora) avisos.splice(i, 1);
    // com o quadro aberto o aviso vai no rodapé dele (o letreiro ficaria por cima dos botões)
    const on = presente() && game.state === 'PLAYING' && avisos.length > 0 && !grupo.visible;
    letreiro.mesh.visible = on;
    if (!on) { chaveLetreiro = ''; return; }
    const chave = avisos.map((m) => (m.grande ? m.titulo + m.sub : m.texto)).join('|');
    if (chave === chaveLetreiro) return;
    chaveLetreiro = chave;
    pintorLetreiro(letreiro.ctx, 1024, 232, avisos);
    letreiro.tex.needsUpdate = true;
  }
  function desenharDica() {
    // só as dicas de ação ("📦 Baú — B abre"); o nome do bloco mirado ficaria sempre na frente dos olhos
    const t = ui.el?.hint?.textContent || '';
    const want = presente() && game.state === 'PLAYING' && !game.overlay && t.includes(' — ') ? t : '';
    dica.mesh.visible = !!want;
    if (want === textoDica) return;
    textoDica = want;
    if (want) { pintorDica(dica.ctx, 1024, 128, want); dica.tex.needsUpdate = true; }
  }

  // ---- a cada quadro -----------------------------------------------------------------------------------------------------------
  game.hooks.frame.push(() => {
    desenharLetreiro();
    desenharDica();
    const v = visivel();
    // tela do PC aberta durante o VR (baú pelo B, painel do futebol, mochila, chat): vira a aba correspondente
    const o = game.overlay;
    if (o !== st.overlayVisto) {
      st.overlayVisto = o;
      const s = secaoDoOverlay(o, retrato());
      if (s && presente()) { st.secao = s; st.rolagem[s] = 0; st.sujo = true; if (!st.mira && Array.isArray(game.aimRay)) st.mira = game.aimRay.slice(); }
      if (!o) st.mira = null;
    }
    if (v && !estavaVisivel) { posicionar(); st.sujo = true; }
    if (!v && estavaVisivel) { realce.visible = false; st.alvo = null; st.mira = null; }
    estavaVisivel = v;
    grupo.visible = v;
    if (!v) return;
    grupo.position.x += player.pos[0] - ancora.x; grupo.position.y += player.pos[1] - ancora.y; grupo.position.z += player.pos[2] - ancora.z;
    ancora.set(player.pos[0], player.pos[1], player.pos[2]);
    const agora = performance.now();
    if (!st.sujo && agora - st.montadoEm < 120) return;
    st.montadoEm = agora;
    st.sujo = false;
    const e = retrato();
    const medir = (texto, w) => { quadro.ctx.font = '500 22px system-ui, sans-serif'; return quebrarLinhas(quadro.ctx, texto, w - 24).length; };
    const m = montarModelo(e, st.secao || secaoInicial(e), st.rolagem[st.secao] || 0, medir);
    m.rodape = ultimoAviso();
    if (m.secao !== st.secao) st.secao = m.secao;
    st.rolagem[m.secao] = m.rolagem;
    st.modelo = m;
    const chave = JSON.stringify([m.secao, m.rolagem, m.abas.map((a) => a.id), m.itens, m.placar && [m.placar.placar, m.placar.lados], m.rodape]);
    if (chave === st.chave) return;
    st.chave = chave;
    pintor(quadro.ctx, m, { icone, hover: st.alvo });
    quadro.tex.needsUpdate = true;
    if (st.alvo) posicionarRealce(st.alvo.rect);
  });

  const api = {
    abrir, fechar, alternar,
    get visivel() { return grupo.visible; },
    get secao() { return st.modelo?.secao || st.secao; },
    get modelo() { return st.modelo; },
    // a mira do mundo enquanto o menu está aberto (render/xr.js usa no lugar do raio do controle)
    get miraFixa() { return grupo.visible || (presente() && game.overlay && game.overlay !== 'mapa') ? st.mira : null; },
    executar,                                 // para sondas e testes: a mesma porta do clique
    aoSairDoVr() { if (game.overlay === 'menu-vr') closeOverlay(); grupo.visible = false; letreiro.mesh.visible = false; dica.mesh.visible = false; st.mira = null; },
    setPintor(fn) { pintor = fn || pintorPadrao; st.chave = ''; st.sujo = true; },
    setPintorLetreiro(fn) { pintorLetreiro = fn || pintorLetreiroPadrao; chaveLetreiro = ''; },
    setPintorDica(fn) { pintorDica = fn || pintorDicaPadrao; textoDica = ''; },
    painel: painelLaser, quadro: quadro.mesh, letreiro: letreiro.mesh, dica: dica.mesh,
  };
  game.menuVr = api;
  return api;
}
