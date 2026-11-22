// LAVRA — mapa (pedido do Kadmus, 18/11/2026: "preciso de um mapa que se abra ao apertar o M").
// Tela inteira vista de cima, norte para cima. Onde o pedaço do mundo já está carregado, cada pixel é o bloco de verdade
// do topo (as construções aparecem); mais longe, o terreno sai do próprio gerador (game.gen: altura e bioma), então dá
// para ver quilômetros. Relevo sombreado pela diferença de altura; mar mais escuro conforme a profundidade.
// Marcas: você (seta para onde olha), os outros jogadores, os povoados avistados (server/povos.js → 'povos'), o campo de
// futebol e o ponto de nascer. Roda = zoom no cursor · arrastar = mover · botões: + − centralizar · M ou Esc fecha.
// Desenha em ladrilhos de 128 px guardados por escala, preenchidos aos poucos (≤ 7 ms por quadro): não engasga o jogo.
import { B, BLOCKS, KIND, K_CROSS, LEVEL } from '../../shared/blocks.js';
import { SEA } from '../../shared/constants.js';
import { BIOME } from '../../shared/worldgen.js';

const T = 128, ESCALAS = [0.5, 1, 2, 4, 8, 16];
import { editorFerrovia } from './editor-ferrovia.js';

export const VR_MAP_W = 960, VR_MAP_H = 600;

/** Passo de escala ao fazer pinça com dois dedos (−1 aproxima, +1 afasta, 0 mantém). */
export function passoPinca(distAtual, distBase) {
  if (!(distAtual > 0 && distBase > 0)) return 0;
  const r = distAtual / distBase;
  return r >= 1.38 ? -1 : r <= 0.72 ? 1 : 0;
}

/** Mantém caixinha flutuante dentro da tela, inclusive em celulares estreitos. */
export function clampBox(x, y, boxW, boxH, W, H, minTop = 52) {
  return {
    left: Math.max(12, Math.min(Math.max(12, W - boxW - 12), x)),
    top: Math.max(minTop, Math.min(Math.max(minTop, H - boxH - 12), y)),
  };
}
const COR_BIOMA = { [BIOME.OCEAN]: [38, 70, 120], [BIOME.BEACH]: [214, 200, 150], [BIOME.PLAINS]: [92, 150, 68], [BIOME.FOREST]: [48, 112, 52],
  [BIOME.TAIGA]: [52, 96, 86], [BIOME.SNOW]: [236, 240, 246], [BIOME.DESERT]: [214, 186, 112], [BIOME.SAVANNA]: [168, 164, 78], [BIOME.ALPINE]: [128, 128, 128] };
const COR_BLOCO = { [B.GRASS]: [92, 150, 68], [B.DIRT]: [128, 96, 64], [B.SAND]: [214, 200, 150], [B.GRAVEL]: [130, 126, 120], [B.STONE]: [125, 125, 128],
  [B.SNOW]: [236, 240, 246], [B.ICE]: [170, 205, 235], [B.LEAVES]: [44, 104, 46], [B.PINE_LEAVES]: [38, 86, 70], [B.LOG]: [110, 82, 52], [B.PINE_LOG]: [96, 72, 48],
  [B.PLANKS]: [176, 138, 88], [B.PINE_PLANKS]: [150, 112, 72], [B.STONE_BRICKS]: [140, 140, 142], [B.BRICKS]: [160, 82, 64], [B.GLASS]: [190, 220, 235],
  [B.CLAY]: [160, 150, 140], [B.SANDSTONE]: [214, 196, 140], [B.MARBLE]: [232, 232, 228], [B.CONCRETE]: [170, 170, 170], [B.ROOF]: [176, 84, 60],
  [B.PLASTER_WHITE]: [236, 232, 222], [B.LAMP]: [255, 226, 150], [B.BASALT]: [60, 60, 66] };

export function initMapa({ game, world, player, avatars, net, openOverlay, closeOverlay, device }) {
  const st = { aberto: false, cx: 0, cz: 0, esc: 2, povos: [], descobrir: [], obras: [], ladrilhos: new Map(), fila: [], arrasta: null, pinca: null, ver: 0, w: VR_MAP_W, h: VR_MAP_H };
  const css = (el, o) => Object.assign(el.style, o);
  const tela = document.createElement('div');
  css(tela, { position: 'fixed', inset: '0', zIndex: 60, display: 'none', background: 'linear-gradient(180deg, #0b1016, #121a24)', cursor: 'grab', userSelect: 'none', touchAction: 'none' });
  const cv = document.createElement('canvas'); css(cv, { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none' });
  const topo = document.createElement('div');
  css(topo, { position: 'absolute', left: 'calc(12px + env(safe-area-inset-left, 0px))', top: 'calc(10px + env(safe-area-inset-top, 0px))', right: 'calc(12px + env(safe-area-inset-right, 0px))', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', color: '#e8eef5', font: '700 13px system-ui, sans-serif', textShadow: '0 1px 2px #000', pointerEvents: 'none' });
  const titulo = document.createElement('div'); titulo.textContent = '🗺 Mapa'; css(titulo, { fontSize: '16px' });
  const info = document.createElement('div'); css(info, { opacity: '.9', fontWeight: '600' });
  const ajuda = document.createElement('div');
  ajuda.textContent = device?.touch ? 'toque numa 🏗 para dar nome · arrastar: mover · pinça: zoom' : 'clique numa 🏗 para dar nome · roda: zoom · arrastar: mover · M ou Esc: fechar';
  css(ajuda, { opacity: '.72', fontWeight: '600' });
  const fecharBtn = document.createElement('button');
  fecharBtn.type = 'button'; fecharBtn.textContent = '✕ Fechar';
  css(fecharBtn, { marginLeft: 'auto', minHeight: '38px', padding: '6px 12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.32)', cursor: 'pointer', pointerEvents: 'auto', touchAction: 'manipulation',
    background: 'linear-gradient(180deg, rgba(46,60,78,.95), rgba(18,26,38,.95))', color: '#f6f2e9', font: '700 13px system-ui' });
  fecharBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  fecharBtn.addEventListener('click', (e) => { e.stopPropagation(); fecha(); });
  topo.append(titulo, info, ajuda, fecharBtn);
  const botoes = document.createElement('div'); css(botoes, { position: 'absolute', right: 'calc(14px + env(safe-area-inset-right, 0px))', bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', display: 'flex', flexDirection: 'column', gap: '8px' });
  const botao = (txt, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; css(b, { width: '46px', height: '44px', borderRadius: '10px', border: '1px solid rgba(255,255,255,.3)', cursor: 'pointer', touchAction: 'manipulation',
    background: 'linear-gradient(180deg, rgba(40,52,68,.95), rgba(18,24,34,.95))', color: '#f0f4f8', font: '800 18px system-ui' }); b.addEventListener('pointerdown', (e) => e.stopPropagation()); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); botoes.appendChild(b); return b; };
  const centrar = () => { st.cx = player.pos[0]; st.cz = player.pos[2]; };
  botao('+', () => zoom(-1)); botao('−', () => zoom(1)); botao('◎', centrar);
  tela.append(cv, topo, botoes);
  document.body.appendChild(tela);
  const ctx = cv.getContext('2d');
  const ferroviario = editorFerrovia({game,tela,topo,st});
  const moverFortaleza=fecharBtn.cloneNode(false);
  moverFortaleza.style.marginLeft='0';
  let escolhendoMar=false;
  function selecionarMar(ativo) {
    escolhendoMar=ativo;
    moverFortaleza.textContent=ativo ? 'Toque no mar para mover · Cancelar' : 'Mover fortaleza';
    moverFortaleza.setAttribute('aria-pressed',String(ativo));
  }
  selecionarMar(false);
  moverFortaleza.addEventListener('click',()=>{ ferroviario.fechar(); selecionarMar(!escolhendoMar); });
  topo.insertBefore(moverFortaleza,fecharBtn);

  // ---- cor de um ponto -------------------------------------------------------------------------------------------
  function amostra(x, z) {          // → [r, g, b, altura]
    x = Math.floor(x); z = Math.floor(z);
    if (world.isLoaded?.(x, z)) {
      let y = world.topSolid(x, z);
      if (y >= 0) {
        let id = world.getBlock(x, y, z);
        if (KIND[id] === K_CROSS) { y--; id = world.getBlock(x, y, z); }
        if (LEVEL[id] > 0) { let f = y; while (f > 1 && LEVEL[world.getBlock(x, f, z)] > 0) f--; const k = Math.max(0.35, 1 - (y - f) / 26); return [40 * k + 10, 80 * k + 20, 140 * k + 30, y]; }
        const c = COR_BLOCO[id] || (BLOCKS[id]?.group === 'obra' ? [190, 180, 160] : [120, 120, 110]);
        return [c[0], c[1], c[2], y];
      }
    }
    if (!game.gen) return [20, 26, 34, SEA];
    const h = game.gen.height(x, z);
    if (h < SEA) { const k = Math.max(0.35, 1 - (SEA - h) / 30); return [38 * k + 8, 70 * k + 14, 120 * k + 24, SEA]; }
    const c = COR_BIOMA[game.gen.biomeAt(x, z)] || [90, 140, 70];
    return [c[0], c[1], c[2], h];
  }
  function ladrilho(esc, tx, tz) {
    const k = esc + ':' + tx + ':' + tz;
    let L = st.ladrilhos.get(k);
    if (!L) { L = { k, esc, tx, tz, cv: null, pronto: false }; st.ladrilhos.set(k, L); st.fila.push(L); }
    return L;
  }
  function desenhaLadrilho(L) {
    const c = document.createElement('canvas'); c.width = T; c.height = T;
    const g = c.getContext('2d'), img = g.createImageData(T, T), x0 = L.tx * T * L.esc, z0 = L.tz * T * L.esc;
    const alt = new Float32Array((T + 1) * (T + 1)), cor = new Uint8ClampedArray(T * T * 3);
    for (let j = 0; j <= T; j++) for (let i = 0; i <= T; i++) {
      const a = amostra(x0 + i * L.esc, z0 + j * L.esc); alt[i + j * (T + 1)] = a[3];
      if (i < T && j < T) { const o = (i + j * T) * 3; cor[o] = a[0]; cor[o + 1] = a[1]; cor[o + 2] = a[2]; }
    }
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const h = alt[i + j * (T + 1)], hx = alt[i + 1 + j * (T + 1)], hz = alt[i + (j + 1) * (T + 1)];
      const sombra = Math.max(-0.35, Math.min(0.35, ((h - hx) + (h - hz)) * 0.09 / Math.max(0.5, L.esc * 0.5))), k = 0.86 + (h - SEA) / 300 + sombra;
      const o = (i + j * T) * 3, p = (i + j * T) * 4;
      img.data[p] = cor[o] * k; img.data[p + 1] = cor[o + 1] * k; img.data[p + 2] = cor[o + 2] * k; img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0); L.cv = c; L.pronto = true;
  }

  // ---- desenho ---------------------------------------------------------------------------------------------------
  function desenha() {
    const vr = !!game.xr?.presenting;
    const W = vr ? VR_MAP_W : (cv.clientWidth || VR_MAP_W), H = vr ? VR_MAP_H : (cv.clientHeight || VR_MAP_H);
    const dpr = vr ? 1 : Math.min(2, devicePixelRatio || 1);
    st.w = W; st.h = H;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = st.esc > 1;
    ctx.fillStyle = '#0d131b'; ctx.fillRect(0, 0, W, H);
    const esc = st.esc, px = (x) => W / 2 + (x - st.cx) / esc, pz = (z) => H / 2 + (z - st.cz) / esc;
    const tx0 = Math.floor((st.cx - (W / 2) * esc) / (T * esc)), tx1 = Math.floor((st.cx + (W / 2) * esc) / (T * esc));
    const tz0 = Math.floor((st.cz - (H / 2) * esc) / (T * esc)), tz1 = Math.floor((st.cz + (H / 2) * esc) / (T * esc));
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
      const L = ladrilho(esc, tx, tz), sx = px(tx * T * esc), sz = pz(tz * T * esc);
      if (L.pronto) ctx.drawImage(L.cv, Math.floor(sx), Math.floor(sz), T + 1, T + 1);
      else { ctx.fillStyle = 'rgba(40,52,64,.6)'; ctx.fillRect(sx, sz, T, T); }
    }
    ferroviario.desenhar(ctx, px, pz);
    // marcas
    const rotulos = [];   // nome que cairia em cima de outro: fica só o ícone
    const marca = (x, z, icone, nome, cor = '#fff') => {
      const sx = px(x), sz = pz(z); if (sx < -40 || sz < -40 || sx > W + 40 || sz > H + 40) return;
      ctx.font = '18px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icone, sx, sz);
      if (nome) { ctx.font = '700 12px system-ui'; const w = ctx.measureText(nome).width + 6, r = [sx - w / 2, sz + 9, sx + w / 2, sz + 23]; if (rotulos.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) nome = ''; else rotulos.push(r); }
      if (nome) { ctx.font = '700 12px system-ui'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(nome, sx, sz + 16); ctx.fillStyle = cor; ctx.fillText(nome, sx, sz + 16); }
    };
    if (game.spawn) marca(game.spawn.x, game.spawn.z, '★', 'início', '#ffe27a');
    // arquipélago (19/11): as outras ilhas, os cais, as linhas de balsa (tracejado) e onde cada balsa está agora
    const arqM = game.gen?.arq, bal = game.balsas;
    if (arqM?.ilhas?.length && (game.dim || 0) === 0) {
      if (bal?.linhas?.length) {
        ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1.5;
        const salto = Math.max(1, Math.round(esc * 2));
        for (const L of bal.linhas) { ctx.beginPath(); for (let k = 0; k < L.xs.length; k += salto) { if (k) ctx.lineTo(px(L.xs[k]), pz(L.zs[k])); else ctx.moveTo(px(L.xs[k]), pz(L.zs[k])); } ctx.lineTo(px(L.xs[L.xs.length - 1]), pz(L.zs[L.zs.length - 1])); ctx.stroke(); }
        ctx.restore();
      }
      for (const il of arqM.ilhas) marca(il.x, il.z, '🏝', il.nome, '#d8f4ff');
      for (const q of bal?.portos || []) marca(q.espera[0], q.espera[2], '⚓', q.id === 'principal' ? 'cais' : '', '#ffe9c2');
      for (const e of bal?.estados || []) if (e.x !== undefined) marca(e.x, e.z, '⛴', '', '#fff');
    }
    if ((game.dim || 0) === 0 && game.costa?.marcadores) {
      for (const m of game.costa.marcadores()) {
        marca(m.x, m.z, m.icone || (m.kind === 'vila' ? '⚓' : '🚤'), m.nome || '', m.cor || '#d8f4ff');
      }
    }
    const gelo=game.gen?.fortaleza;
    if (gelo) marca(gelo[0],gelo[1],'❄','Fortaleza da Solidão');
    const campo = game.futebol?.campo; if (campo) marca(campo.centro[0], campo.centro[2], '⚽', 'campo');
    for (const [tipo, x, z] of st.descobrir) marca(x, z, '❔', tipo + ' a descobrir', '#cfe3ff');
    for (const [tipo, nome, x, z] of st.povos) marca(x, z, tipo === 'tribo' ? '⛺' : tipo === 'aldeia' ? '🏘' : '🏰', nome, '#ffe9c2');
    for (const [id, a] of avatars.list) { const s = a.snaps?.[a.snaps.length - 1], p = game.players.get(id); if (s && p) { ctx.fillStyle = p.color || '#e8873a'; ctx.beginPath(); ctx.arc(px(s.x), pz(s.z), 5, 0, 6.283); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke(); marca(s.x, s.z, '', p.name, '#fff'); } }
    // construções de quem joga: contorno da área e nome (clique para dar ou trocar o nome)
    for (const [id, nome, x, z, n, x0, z0, x1, z1] of [...st.obras].sort((a, b) => (b[1] ? 1 : 0) - (a[1] ? 1 : 0))) {   // as já nomeadas primeiro (ganham o lugar do nome)
      ctx.strokeStyle = 'rgba(255,214,120,.55)'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.strokeRect(px(x0), pz(z0), (x1 - x0) / esc, (z1 - z0) / esc); ctx.setLineDash([]);
      marca(x, z, '🏗', nome || 'sem nome', nome ? '#ffe9b0' : '#c8ced6');
    }
    // você: seta para onde olha (yaw 0 = norte, para cima)
    const sx = px(player.pos[0]), sz = pz(player.pos[2]);
    ctx.save(); ctx.translate(sx, sz); ctx.rotate(-player.yaw);
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.fillStyle = '#ffd34d'; ctx.fill(); ctx.strokeStyle = '#1a1206'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    // rosa dos ventos (abaixo da barra superior no DOM para não bater no botão Fechar)
    const infoTxt = `você: x ${Math.round(player.pos[0])}, z ${Math.round(player.pos[2])} · ${esc >= 1 ? esc + ' m' : '1/' + Math.round(1 / esc) + ' m'} por pixel`
      + (st.mouse ? ` · cursor: x ${Math.round(st.cx + (st.mouse[0] - W / 2) * esc)}, z ${Math.round(st.cz + (st.mouse[1] - H / 2) * esc)}` : '');
    if (vr) {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(14,20,28,.86)'); g.addColorStop(1, 'rgba(10,16,24,.72)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, 42);
      ctx.font = '700 18px system-ui'; ctx.fillStyle = '#ffe2b0'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText('🗺 Mapa', 16, 22);
      ctx.font = '600 16px system-ui'; ctx.fillStyle = '#e8eef5';
      ctx.fillText(infoTxt, 128, 22);
      ctx.font = '800 16px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
      ctx.fillText('N ▲', W - 18, 22);
    } else {
      ajuda.style.display = W < 540 ? 'none' : 'block';
      ctx.font = '800 14px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('N ▲', W - 36, Math.max(76, (topo.offsetHeight || 40) + 28));
      info.textContent = infoTxt;
    }
    st.ver++;
  }

  function zoom(d, em) {
    const i = Math.max(0, Math.min(ESCALAS.length - 1, ESCALAS.indexOf(st.esc) + d)), nova = ESCALAS[i];
    if (em) { const W = st.w, H = st.h, wx = st.cx + (em[0] - W / 2) * st.esc, wz = st.cz + (em[1] - H / 2) * st.esc; st.cx = wx - (em[0] - W / 2) * nova; st.cz = wz - (em[1] - H / 2) * nova; }
    st.esc = nova;
  }
  const ptrs = new Map();
  const parPinca = () => {
    const [a, b] = [...ptrs.values()];
    return { dist: Math.hypot(b.x - a.x, b.y - a.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoom(e.deltaY > 0 ? 1 : -1, [e.offsetX, e.offsetY]); }, { passive: false });
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
    if (ptrs.size === 1 && ferroviario.inicio(e.offsetX, e.offsetY)) return;
    if (ptrs.size > 1) ferroviario.soltar();
    if (ptrs.size === 1) { st.arrasta = [e.clientX, e.clientY, st.cx, st.cz]; st.pinca = null; tela.style.cursor = 'grabbing'; }
    else if (ptrs.size === 2) { st.arrasta = null; st.pinca = parPinca(); }
  });
  cv.addEventListener('pointermove', (e) => {
    st.mouse = [e.offsetX, e.offsetY];
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) >= 8) p.moved = true;
    if (ptrs.size >= 2 && st.pinca) {
      const cur = parPinca(), rect = cv.getBoundingClientRect();
      st.cx -= (cur.mx - st.pinca.mx) * st.esc; st.cz -= (cur.my - st.pinca.my) * st.esc;
      st.pinca.mx = cur.mx; st.pinca.my = cur.my;
      const step = passoPinca(cur.dist, st.pinca.dist);
      if (step) { zoom(step, [cur.mx - rect.left, cur.my - rect.top]); st.pinca.dist = cur.dist; }
      return;
    }
    if (ptrs.size === 1 && ferroviario.mover(e.offsetX, e.offsetY)) return;
    if (st.arrasta) { st.cx = st.arrasta[2] - (e.clientX - st.arrasta[0]) * st.esc; st.cz = st.arrasta[3] - (e.clientY - st.arrasta[1]) * st.esc; }
  });
  const solta = (e) => {
    const p = ptrs.get(e.pointerId);
    ptrs.delete(e.pointerId);
    if (ferroviario.soltar()) return;
    const eraArrasta = st.arrasta && ptrs.size === 0;
    if (ptrs.size === 1) {
      const [rest] = ptrs.values();
      st.arrasta = [rest.x, rest.y, st.cx, st.cz]; st.pinca = null;
    } else if (ptrs.size === 0) {
      st.arrasta = null; st.pinca = null; tela.style.cursor = 'grab';
      if (eraArrasta && p && !p.moved && e.type === 'pointerup') clique(e.offsetX, e.offsetY);
    }
  };
  cv.addEventListener('pointerup', solta);
  cv.addEventListener('pointercancel', solta);
  // clique numa construção: caixinha para dar (ou trocar) o nome
  const caixa = document.createElement('div');
  css(caixa, { position: 'absolute', display: 'none', padding: '10px', borderRadius: '10px', background: 'linear-gradient(180deg, rgba(30,40,54,.97), rgba(14,20,28,.97))', border: '1px solid rgba(255,255,255,.3)', color: '#eef', font: '600 13px system-ui', zIndex: 2 });
  const rot = document.createElement('div'); rot.textContent = 'Nome da construção'; css(rot, { marginBottom: '6px' });
  const campoNome = document.createElement('input'); campoNome.maxLength = 32; css(campoNome, { width: 'min(200px, 56vw)', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,.35)', background: 'rgba(0,0,0,.35)', color: '#fff', font: '600 14px system-ui' });
  const salvar = document.createElement('button'); salvar.textContent = 'Salvar'; css(salvar, { marginLeft: '6px', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,.3)', background: 'linear-gradient(180deg, #5a8a4a, #335a2a)', color: '#fff', font: '700 13px system-ui', cursor: 'pointer' });
  caixa.append(rot, campoNome, salvar); tela.appendChild(caixa);
  let obraAlvo = null;
  const fechaCaixa = () => { caixa.style.display = 'none'; obraAlvo = null; };
  const envia = () => { if (obraAlvo) net?.send?.({ t: 'nomear', x: obraAlvo[2], z: obraAlvo[3], nome: campoNome.value }); fechaCaixa(); };
  salvar.addEventListener('click', (e) => { e.stopPropagation(); envia(); });
  campoNome.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') envia(); else if (e.key === 'Escape') fechaCaixa(); });
  function clique(mx, my) {
    if (ferroviario.clicar(mx, my)) { selecionarMar(false); fechaCaixa(); return; }
    if (escolhendoMar && (net.offline || game.gmFortaleza)) {
      selecionarMar(false);
      const x=Math.round(st.cx+(mx-st.w/2)*st.esc),z=Math.round(st.cz+(my-st.h/2)*st.esc);
      game.comandoFortaleza('/fortaleza mover '+x+' '+z); return;
    }
    const W = st.w, H = st.h, px = (x) => W / 2 + (x - st.cx) / st.esc, pz = (z) => H / 2 + (z - st.cz) / st.esc;
    const raio = device?.touch ? 30 : 22;
    const o = st.obras.map((k) => ({ k, d: Math.hypot(px(k[2]) - mx, pz(k[3]) - my) })).filter((q) => q.d < raio).sort((a, b) => a.d - b.d)[0];
    if (!o) { fechaCaixa(); return; }
    obraAlvo = o.k; campoNome.value = o.k[1] || '';
    const pos = clampBox(mx + 12, my + 12, 290, 92, W, H, (topo.offsetHeight || 42) + 12);
    css(caixa, { display: 'block', left: pos.left + 'px', top: pos.top + 'px' });
    setTimeout(() => campoNome.focus(), 0);
  }

  function abre() {
    if (st.aberto || game.state !== 'PLAYING' || game.overlay) return;
    selecionarMar(false);
    moverFortaleza.hidden=!(game.gen?.fortaleza && (net.offline || game.gmFortaleza));
    st.aberto = true; st.cx = player.pos[0]; st.cz = player.pos[2];
    for (const [k, L] of st.ladrilhos) if (Math.abs(L.tx * T * L.esc - st.cx) < 400 && Math.abs(L.tz * T * L.esc - st.cz) < 400) st.ladrilhos.delete(k);   // perto de você redesenha (o mundo muda)
    st.fila = st.fila.filter((L) => st.ladrilhos.has(L.k));
    openOverlay?.('mapa'); tela.style.display = game.xr?.presenting ? 'none' : 'block'; net?.send?.({ t: 'construcoes?' });
  }
  function fecha() { if (!st.aberto) return; st.aberto = false; st.mouse = null; ptrs.clear(); tela.style.display = 'none'; fechaCaixa(); ferroviario.fechar(); if (game.overlay === 'mapa') closeOverlay?.(); }
  addEventListener('keydown', (e) => {
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (caixa.style.display === 'block' && (e.code === 'KeyM' || e.code === 'Escape')) return;   // digitando o nome
    if (e.code === 'KeyM' && !e.repeat) { e.preventDefault(); st.aberto ? fecha() : abre(); }
    else if (e.code === 'Escape' && st.aberto) { e.preventDefault(); fecha(); }
  });
  game.hooks.other.push((m) => {
    if (m.t === 'welcome' || m.t === 'dim') { st.povos = m.povos || []; st.ladrilhos.clear(); st.fila = []; }
    else if (m.t === 'construcoes') st.obras = m.l || [];
    else if (m.t === 'povos') { st.povos = m.l || []; if (m.d) st.descobrir = m.d; }
    else if (m.t === 'overlay-closed' && m.was === 'mapa' && st.aberto) { st.aberto = false; st.mouse = null; ptrs.clear(); tela.style.display = 'none'; fechaCaixa(); ferroviario.fechar(); }
  });
  game.hooks.frame.push(() => {
    if (!st.aberto) return;
    if (game.state !== 'PLAYING') { fecha(); return; }
    tela.style.display = game.xr?.presenting ? 'none' : 'block';
    // preenche ladrilhos que faltam, os mais perto do centro primeiro, até ~7 ms por quadro
    const t0 = performance.now();
    st.fila.sort((a, b) => (a.esc !== st.esc) - (b.esc !== st.esc) || Math.hypot(a.tx * T * a.esc - st.cx, a.tz * T * a.esc - st.cz) - Math.hypot(b.tx * T * b.esc - st.cx, b.tz * T * b.esc - st.cz));
    while (st.fila.length && performance.now() - t0 < 7) { const L = st.fila.shift(); if (!L.pronto) desenhaLadrilho(L); }
    if (st.ladrilhos.size > 900) { for (const [k, L] of st.ladrilhos) { if (L.esc !== st.esc) st.ladrilhos.delete(k); if (st.ladrilhos.size < 500) break; } }
    desenha();
  });
  const api = {
    abre, fecha, zoom, centrar,
    mover(dx, dz) { st.cx += dx; st.cz += dz; },
    cursorUv(u, v) { st.mouse = u == null ? null : [u * st.w, (1 - v) * st.h]; },
    canvas: cv,
    get aberto() { return st.aberto; },
    get escala() { return st.esc; },
    get ver() { return st.ver; },
    get povos() { return st.povos; },
    get descobrir() { return st.descobrir; },
  };
  game.mapa = api;
  return api;
}
