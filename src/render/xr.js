// LAVRA — realidade virtual (WebXR): Meta Quest e outros visores.
// Mão esquerda: analógico anda, gatilho/aperto trocam o bloco, Y liga o voo, X abre o MENU (☰, game/menu-vr.js).
// Mão direita: analógico gira (em passos) e sobe/desce no voo, gatilho quebra, aperto coloca, A pula, B usa.
// Pulso esquerdo: ☰ Menu · 🗺 Mapa · Curva (no campo). Perto da bola, o gatilho direito chuta (toque curto ou segurar
// para carregar, como o F do PC). Quadros 3D de outros módulos entram no laser por `game.vrPaineis` (19/11): cada um
// { mesh, visivel(), apontar(uv|null), clique(uv), rolar(eixoY) }; com um deles aberto o analógico direito rola.

import * as THREE from '../three.js';
import { BLOCKS } from '../../shared/blocks.js';
import { MC_BASE } from '../../shared/mc-estados.js';
import { mcNomePt } from '../../shared/mc-nomes.js';
import { empilharMarcadores } from '../game/bussola.js';
import { VR_MAP_W, VR_MAP_H } from '../game/mapa.js';
import { SKILLS_FUTEBOL } from '../../shared/espacos.js';

function drawPill(ctx, x, y, w, h, r, c0, c1, border) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.stroke(); }
}

function makeButton(w, h, cw, ch, action) {
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.userData = { vrAction: action, ctx, tex, cw, ch, key: '' };
  return mesh;
}

function paintButton(mesh, label, { active = false, hover = false, tone = 'slate' } = {}) {
  const u = mesh.userData;
  const key = `${label}|${active ? 1 : 0}|${hover ? 1 : 0}|${tone}`;
  if (key === u.key) return;
  u.key = key;
  const { ctx, tex, cw, ch } = u;
  ctx.clearRect(0, 0, cw, ch);
  const cols = tone === 'close'
    ? (hover ? ['rgba(180,68,52,0.96)', 'rgba(110,32,24,0.96)'] : ['rgba(130,44,34,0.92)', 'rgba(72,22,18,0.92)'])
    : active
      ? ['rgba(244,166,78,0.95)', 'rgba(180,86,32,0.95)']
      : (hover ? ['rgba(68,94,124,0.96)', 'rgba(32,48,68,0.96)'] : ['rgba(32,48,66,0.92)', 'rgba(14,22,32,0.92)']);
  drawPill(ctx, 3, 3, cw - 6, ch - 6, 16, cols[0], cols[1], hover ? 'rgba(255,222,150,0.95)' : 'rgba(255,255,255,0.28)');
  ctx.fillStyle = '#f8f5ee';
  ctx.font = `700 ${Math.round(ch * 0.43)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, cw / 2, ch / 2 + 1);
  tex.needsUpdate = true;
}

export function createXR({ renderer, scene, rig, pivot, camera, input, player, game, ui, interaction, icons, settings }) {
  const src = input.source('vr');
  const api = { supported: false, presenting: false, enter, update, sync: () => {}, turn: 0, error: '' };
  // Sem WebXR (iPad, ou página aberta por http da rede, que não é contexto seguro): update vira nada.
  // O update de baixo usa variáveis declaradas mais adiante; chamado depois deste retorno, dava erro a cada quadro.
  if (!navigator.xr) { api.update = () => {}; return api; }
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local-floor');
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => { api.supported = ok; ui.showVR(ok); }).catch(() => {});

  // ---- bússola 3D no topo do campo de visão ------------------------------------
  const compCanvas = document.createElement('canvas'); compCanvas.width = 768; compCanvas.height = 158;
  const compCtx = compCanvas.getContext('2d');
  const compTex = new THREE.CanvasTexture(compCanvas);
  compTex.colorSpace = THREE.SRGBColorSpace; compTex.minFilter = THREE.LinearFilter;
  const vrCompass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.56, 0.115),
    new THREE.MeshBasicMaterial({ map: compTex, transparent: true, depthWrite: false, depthTest: false, fog: false }),
  );
  vrCompass.position.set(0, 0.31, -1.25);
  vrCompass.rotation.x = 0.22;
  vrCompass.renderOrder = 14;
  vrCompass.visible = false;
  camera.add(vrCompass);
  let compKey = '';

  function drawVrCompass() {
    const snap = game.bussola?.snapshot?.();
    const show = api.presenting && game.state === 'PLAYING' && !!snap?.ligada && !game.mapa?.aberto && !game.menuVr?.visivel;
    vrCompass.visible = show;
    if (!show) return;
    const key = Math.round(snap.heading * 2) + '|' + snap.marcadores.map((m) => `${m.id}:${Math.round(m.t * 200)}:${m.texto}`).join(';');
    if (key === compKey) return;
    compKey = key;
    const ctx = compCtx, W = 768;
    ctx.clearRect(0, 0, W, 158);
    drawPill(ctx, 8, 6, W - 16, 54, 14, 'rgba(14,20,28,0.88)', 'rgba(8,12,18,0.72)', 'rgba(232,238,245,0.28)');
    // agulha central dourada
    const ng = ctx.createLinearGradient(0, 2, 0, 62);
    ng.addColorStop(0, '#ffd27a'); ng.addColorStop(1, 'rgba(255,170,60,0.28)');
    ctx.fillStyle = ng; ctx.fillRect(W / 2 - 2, 3, 4, 60);
    // cardeais
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const c of snap.cardeais) {
      const x = 28 + c.t * (W - 56);
      ctx.font = c.label.length === 1 ? '700 22px system-ui, sans-serif' : '600 18px system-ui, sans-serif';
      ctx.fillStyle = c.label === 'N' ? '#ffd27a' : c.label.length === 1 ? '#ffffff' : 'rgba(232,238,245,0.72)';
      ctx.fillText(c.label, x, 33);
    }
    // marcadores de jogadores e povoado abaixo da faixa
    ctx.font = '600 17px system-ui, sans-serif';
    empilharMarcadores(snap.marcadores, W - 56, (m) => ctx.measureText(m.texto).width + 32);
    for (const m of snap.marcadores) {
      if (m.row > 1) continue;
      const w = Math.min(260, ctx.measureText(m.texto).width + 30);
      const cx = Math.max(w / 2 + 10, Math.min(W - w / 2 - 10, 28 + m.t * (W - 56)));
      const y = 70 + m.row * 40;
      drawPill(ctx, cx - w / 2, y, w, 32, 9, 'rgba(20,28,40,0.92)', 'rgba(10,14,22,0.84)', 'rgba(255,255,255,0.24)');
      ctx.fillStyle = m.cor || '#ffd27a';
      ctx.beginPath(); ctx.arc(cx - w / 2 + 12, y + 16, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#f6f2e9'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(m.texto, cx - w / 2 + 22, y + 17);
    }
    compTex.needsUpdate = true;
  }

  // ---- mapa 3D flutuante em VR ---------------------------------------------------
  const mapBoard = new THREE.Group();
  mapBoard.visible = false;
  (scene || rig.parent || rig).add(mapBoard);
  const frameBg = document.createElement('canvas'); frameBg.width = 64; frameBg.height = 64;
  const fCtx = frameBg.getContext('2d');
  drawPill(fCtx, 0, 0, 64, 64, 6, '#141e2c', '#0b1018', 'rgba(255,220,160,0.35)');
  const frameTex = new THREE.CanvasTexture(frameBg); frameTex.colorSpace = THREE.SRGBColorSpace;
  const frameMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 0.77),
    new THREE.MeshBasicMaterial({ map: frameTex, transparent: true, fog: false }),
  );
  frameMesh.renderOrder = 10;
  mapBoard.add(frameMesh);

  let mapTex = null, mapScreen = null, lastMapVer = -1, wasMapOpen = false;
  const mapAnchor = new THREE.Vector3();
  const btnPlus = makeButton(0.22, 0.068, 220, 68, 'zoomIn'); btnPlus.position.set(-0.37, -0.33, 0.008); btnPlus.renderOrder = 12;
  const btnMinus = makeButton(0.22, 0.068, 220, 68, 'zoomOut'); btnMinus.position.set(-0.125, -0.33, 0.008); btnMinus.renderOrder = 12;
  const btnCenter = makeButton(0.22, 0.068, 220, 68, 'center'); btnCenter.position.set(0.125, -0.33, 0.008); btnCenter.renderOrder = 12;
  const btnClose = makeButton(0.22, 0.068, 220, 68, 'close'); btnClose.position.set(0.37, -0.33, 0.008); btnClose.renderOrder = 12;
  mapBoard.add(btnPlus, btnMinus, btnCenter, btnClose);
  const mapButtons = [btnPlus, btnMinus, btnCenter, btnClose];

  function ensureMapScreen() {
    if (mapScreen || !game.mapa?.canvas) return;
    mapTex = new THREE.CanvasTexture(game.mapa.canvas);
    mapTex.colorSpace = THREE.SRGBColorSpace;
    mapTex.minFilter = THREE.LinearFilter;
    mapTex.magFilter = THREE.LinearFilter;
    mapTex.generateMipmaps = false;
    mapScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 0.61), new THREE.MeshBasicMaterial({ map: mapTex, fog: false }));
    mapScreen.position.set(0, 0.04, 0.005);
    mapScreen.renderOrder = 11;
    mapScreen.userData = { vrAction: 'mapPan' };
    mapBoard.add(mapScreen);
  }

  // ---- controles ---------------------------------------------------------------
  const hands = [0, 1].map((i) => {
    const ctrl = renderer.xr.getController(i);
    const hnd = { ctrl, side: '', gp: null, prev: [] };
    ctrl.addEventListener('connected', (e) => { hnd.side = e.data.handedness; hnd.gp = e.data.gamepad || null; build(hnd); });
    ctrl.addEventListener('disconnected', () => {
      if (hnd.side === 'left') { wrist = null; wristCtx = null; wristTex = null; wristMapBtn = null; wristCurvaBtn = null; wristMenuBtn = null; leftBtns = []; }
      else if (hnd.side === 'right') { laser = null; if (vrFutHolding) { vrFutHolding = false; game.futebol?.cancelarAcao?.(); } }
      hnd.side = ''; hnd.gp = null; ctrl.clear();
    });
    rig.add(ctrl);
    return hnd;
  });
  const metal = new THREE.MeshLambertMaterial({ color: 0x3a4250 });
  const laserMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
  let laser = null, wrist = null, wristCtx = null, wristTex = null, wristKey = '';
  let wristMapBtn = null, wristCurvaBtn = null, wristMenuBtn = null, leftBtns = [];
  let vrFutHolding = false;
  const emCampoFutebol = () => game.espacoAtivo?.tipo === 'futebol' && !game.gmAtivo && !!game.futebol;

  function build(hnd) {
    hnd.ctrl.clear();
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.12, 10), metal);
    grip.rotation.x = Math.PI / 2; grip.position.z = 0.05;
    hnd.ctrl.add(grip);
    if (hnd.side === 'right') {
      laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), laserMat);
      hnd.ctrl.add(laser);
    } else if (hnd.side === 'left') {
      // barra de atalhos / skills + botões de Mapa e Curva presos ao pulso
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 160;
      wristCtx = c.getContext('2d');
      wristTex = new THREE.CanvasTexture(c);
      wristTex.colorSpace = THREE.SRGBColorSpace;
      wrist = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.053), new THREE.MeshBasicMaterial({ map: wristTex, transparent: true, depthWrite: false, fog: false }));
      wrist.position.set(0, 0.06, -0.02); wrist.rotation.x = -0.9;
      wrist.renderOrder = 6;
      // três botões no pulso: ☰ Menu (o mesmo do X), 🗺 Mapa e Curva (só no campo)
      wristMenuBtn = makeButton(0.104, 0.042, 240, 96, 'menu');
      wristMenuBtn.position.set(-0.056, 0.095, -0.049); wristMenuBtn.rotation.x = -0.9; wristMenuBtn.renderOrder = 7;
      wristMapBtn = makeButton(0.104, 0.042, 240, 96, 'toggleMap');
      wristMapBtn.position.set(0.056, 0.095, -0.049); wristMapBtn.rotation.x = -0.9; wristMapBtn.renderOrder = 7;
      wristCurvaBtn = makeButton(0.104, 0.042, 240, 96, 'flipCurva');
      wristCurvaBtn.position.set(0.112, 0.095, -0.049); wristCurvaBtn.rotation.x = -0.9; wristCurvaBtn.renderOrder = 7;
      wristCurvaBtn.visible = false;
      leftBtns = [wristMenuBtn, wristMapBtn, wristCurvaBtn];
      hnd.ctrl.add(wrist, wristMenuBtn, wristMapBtn, wristCurvaBtn);
      wristKey = '';
    }
  }

  let hoverObj = null, mapDragUv = null;
  function drawWrist() {
    const futOn = emCampoFutebol();
    const curva = futOn ? (game.futebol.curvaLado || 1) : 1;
    if (wristMenuBtn) {
      wristMenuBtn.position.x = futOn ? -0.112 : -0.056;
      paintButton(wristMenuBtn, '☰ Menu', { active: !!game.menuVr?.visivel, hover: hoverObj === wristMenuBtn });
    }
    if (wristMapBtn) {
      wristMapBtn.position.x = futOn ? 0 : 0.056;
      paintButton(wristMapBtn, '🗺 Mapa', { active: !!game.mapa?.aberto, hover: hoverObj === wristMapBtn });
    }
    if (wristCurvaBtn) {
      wristCurvaBtn.visible = futOn;
      if (futOn) paintButton(wristCurvaBtn, curva > 0 ? '↪ Curva →' : '↩ Curva ←', { active: curva < 0, hover: hoverObj === wristCurvaBtn });
    }
    if (!wristCtx) return;
    if (futOn) {
      const sk = game.futebol.skillAtual || SKILLS_FUTEBOL[0];
      const carga = game.futebol.cargaAtual || 0;
      const key = `fut:${sk.id}:${curva}:${Math.round(carga * 20)}`;
      if (key === wristKey) return;
      wristKey = key;
      const ctx = wristCtx;
      ctx.clearRect(0, 0, 1024, 160);
      const g = ctx.createLinearGradient(0, 0, 1024, 160);
      g.addColorStop(0, 'rgba(14,36,24,0.94)'); g.addColorStop(1, 'rgba(8,18,12,0.95)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(4, 4, 1016, 152, 28); ctx.fill();
      ctx.strokeStyle = 'rgba(134,239,172,0.35)'; ctx.lineWidth = 3; ctx.stroke();
      for (let i = 0; i < SKILLS_FUTEBOL.length; i++) {
        const s = SKILLS_FUTEBOL[i], x = 22 + i * 110, sel = s.id === sk.id;
        ctx.fillStyle = sel ? 'rgba(255,255,255,0.16)' : 'rgba(16,28,22,0.88)';
        ctx.beginPath(); ctx.roundRect(x, 14, 98, 92, 16); ctx.fill();
        ctx.strokeStyle = sel ? s.cor : 'rgba(255,255,255,0.16)';
        ctx.lineWidth = sel ? 5 : 2;
        ctx.stroke();
        ctx.fillStyle = s.cor;
        ctx.beginPath(); ctx.roundRect(x + 12, 22, 74, 8, 4); ctx.fill();
        ctx.fillStyle = '#d1fae5'; ctx.font = '700 20px system-ui, sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(String(s.tecla), x + 10, 52);
        ctx.fillStyle = '#ffffff'; ctx.font = '700 21px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(s.curto, x + 49, 86, 88);
      }
      if (carga > 0.01) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath(); ctx.roundRect(22, 112, 980, 10, 5); ctx.fill();
        const cg = ctx.createLinearGradient(22, 0, 1002, 0);
        cg.addColorStop(0, '#4ade80'); cg.addColorStop(0.6, '#facc15'); cg.addColorStop(1, '#f97316');
        ctx.fillStyle = cg;
        ctx.beginPath(); ctx.roundRect(22, 112, Math.round(980 * Math.min(1, carga)), 10, 5); ctx.fill();
      }
      ctx.fillStyle = '#f8fafc'; ctx.font = '700 25px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`⚽ ${sk.tecla}. ${sk.nome}  ·  Curva: ${curva > 0 ? 'Direita →' : 'Esquerda ←'} (B)`, 512, 147);
      wristTex.needsUpdate = true;
      return;
    }
    const key = game.hotbar.join(',') + ':' + game.sel;
    if (key === wristKey) return;
    wristKey = key;
    const ctx = wristCtx;
    ctx.clearRect(0, 0, 1024, 160);
    const g = ctx.createLinearGradient(0, 0, 1024, 160);
    g.addColorStop(0, 'rgba(24,38,54,0.92)'); g.addColorStop(1, 'rgba(10,17,26,0.92)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(4, 4, 1016, 152, 30); ctx.fill();
    for (let i = 0; i < 9; i++) {
      const x = 24 + i * 110;
      if (i === game.sel) {
        const s = ctx.createLinearGradient(x, 16, x + 96, 112);
        s.addColorStop(0, '#f4a64e'); s.addColorStop(1, '#c8602a');
        ctx.fillStyle = s; ctx.beginPath(); ctx.roundRect(x - 6, 12, 108, 108, 20); ctx.fill();
      }
      if (game.hotbar[i] && icons()) ctx.drawImage(icons().icon(game.hotbar[i], 96), x, 18, 96, 96);
    }
    ctx.fillStyle = '#ffffff'; ctx.font = '600 26px system-ui, sans-serif'; ctx.textAlign = 'center';
    const cur = game.hotbar[game.sel];
    ctx.fillText((cur >= MC_BASE ? mcNomePt(cur) : BLOCKS[cur]?.name) || '', 512, 147);
    wristTex.needsUpdate = true;
  }

  const btn = (hnd, i) => !!(hnd.gp && hnd.gp.buttons[i] && (hnd.gp.buttons[i].pressed || hnd.gp.buttons[i].value > 0.55));
  const edge = (hnd, i) => { const now = btn(hnd, i), was = !!hnd.prev[i]; hnd.prev[i] = now; return now && !was; };

  function syncMapBoard() {
    const aberto = api.presenting && game.state === 'PLAYING' && !!game.mapa?.aberto;
    if (aberto && !wasMapOpen) {
      ensureMapScreen();
      camera.getWorldPosition(headPos);
      camera.getWorldDirection(headDir);
      headDir.y = 0;
      if (headDir.lengthSq() < 1e-4) headDir.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
      else headDir.normalize();
      const by = headPos.y - 0.05;
      mapBoard.position.set(headPos.x + headDir.x * 1.15, by, headPos.z + headDir.z * 1.15);
      mapBoard.lookAt(headPos.x, by, headPos.z);
      mapAnchor.set(player.pos[0], player.pos[1], player.pos[2]);
    } else if (aberto) {
      mapBoard.position.x += player.pos[0] - mapAnchor.x;
      mapBoard.position.y += player.pos[1] - mapAnchor.y;
      mapBoard.position.z += player.pos[2] - mapAnchor.z;
      mapAnchor.set(player.pos[0], player.pos[1], player.pos[2]);
    }
    wasMapOpen = aberto;
    mapBoard.visible = aberto;
    if (!aberto) { mapDragUv = null; return; }
    paintButton(btnPlus, '＋ Zoom', { hover: hoverObj === btnPlus });
    paintButton(btnMinus, '－ Zoom', { hover: hoverObj === btnMinus });
    paintButton(btnCenter, '◎ Centrar', { hover: hoverObj === btnCenter });
    paintButton(btnClose, '✕ Fechar', { hover: hoverObj === btnClose, tone: 'close' });
    if (mapTex && game.mapa && game.mapa.ver !== lastMapVer) {
      mapTex.needsUpdate = true;
      lastMapVer = game.mapa.ver;
    }
  }

  function runVrAction(action) {
    if (action === 'menu') game.menuVr?.alternar?.();
    else if (action === 'toggleMap') {
      if (game.mapa?.aberto) game.mapa.fecha();
      else { if (game.menuVr?.visivel) game.menuVr.fechar(); game.mapa?.abre(); }
    }
    else if (action === 'flipCurva') game.futebol?.alternarCurva?.();
    else if (action === 'zoomIn') game.mapa?.zoom(-1);
    else if (action === 'zoomOut') game.mapa?.zoom(1);
    else if (action === 'center') game.mapa?.centrar();
    else if (action === 'close') game.mapa?.fecha();
  }

  // ---- sessão -------------------------------------------------------------------
  async function enter() {
    if (api.presenting || !api.supported) return;
    try {
      const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
      renderer.xr.setFoveation?.(1);
      await renderer.xr.setSession(session);
      api.presenting = true;
      api.turn = player.yaw;
      player.pitch = 0;
      player.autoJump = true;
      pivot.position.set(0, 0, 0); pivot.rotation.set(0, 0, 0);
      camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
      game.camDist = 0;
      if (game.state === 'PAUSED') game.resumeFromXR?.();
      ui.toast('VR: X (ou ☰ no pulso) abre o menu — futebol, modo, mochila, blocos, baú. Clique do analógico direito ou 🗺 abre o mapa.', 6000);
      session.addEventListener('end', () => {
        api.presenting = false;
        vrCompass.visible = false;
        mapBoard.visible = false;
        wasMapOpen = false; hoverObj = null; mapDragUv = null;
        if (vrFutHolding) { vrFutHolding = false; game.futebol?.cancelarAcao?.(); }
        if (game.mapa?.aberto) game.mapa.fecha();
        game.menuVr?.aoSairDoVr?.();
        src.clear();
        game.aimRay = null;
        player.autoJump = !!settings.autoJump;
        game.afterXR?.();
      });
    } catch (e) {
      api.error = String(e && e.message || e);
      ui.toast('Não foi possível entrar em VR: ' + api.error, 6000);
    }
  }

  const headPos = new THREE.Vector3(), headDir = new THREE.Vector3(), cpos = new THREE.Vector3(), cdir = new THREE.Vector3(), q = new THREE.Quaternion();
  const lastHead = new THREE.Vector3(), raycaster = new THREE.Raycaster();
  let turned = false, firstFrame = true;

  // Chamado a cada quadro enquanto a sessão está ativa, ANTES da física.
  function update() {
    if (!api.presenting) { firstFrame = true; vrCompass.visible = false; mapBoard.visible = false; return; }
    const futOn = emCampoFutebol();
    // fora da zona do campo (ou GM com o Modo GM ligado), com a bola ao alcance: o gatilho direito chuta (o F do PC)
    const chuteLivre = !futOn && game.state === 'PLAYING' && !game.overlay && !game.machines?.seat && !!game.futebol?.pertoDaBola?.(2.6);
    if (futOn && player.flying && !game.modeRules?.atravessa) player.flying = false;
    let mx = 0, mz = 0, my = 0;
    hoverObj = null;
    for (const hnd of hands) {
      if (!hnd.gp) continue;
      const a = hnd.gp.axes;
      const sx = a.length >= 4 ? a[2] : a[0] || 0, sy = a.length >= 4 ? a[3] : a[1] || 0;
      if (hnd.side === 'left') {
        if (Math.hypot(sx, sy) > 0.18) { mx = sx; mz = -sy; }
        if (edge(hnd, 0)) src.tap('hotNext');
        if (edge(hnd, 1)) src.tap('hotPrev');
        src.set('sprint', btn(hnd, 3));
        // X: abre e fecha o menu (19/11). A troca de página da barra virou a aba Blocos do menu; a curva segue no B
        // e no botão do pulso, no campo.
        if (edge(hnd, 4)) runVrAction('menu');
        if (edge(hnd, 5)) {
          if (futOn) player.flying = false;
          else if (!game.modeRules || game.modeRules.voa) { player.flying = !player.flying; if (player.flying) player.vel[1] = 0; }
        }
      } else if (hnd.side === 'right') {
        if (Math.abs(sx) > 0.65 && !turned) { api.turn -= Math.sign(sx) * (settings.snapTurn ? Math.PI / 6 : 0); turned = true; }
        else if (Math.abs(sx) < 0.3) turned = false;
        if (!settings.snapTurn && Math.abs(sx) > 0.2) api.turn -= sx * 0.03;
        const paineis = (game.vrPaineis || []).filter((p) => p.visivel());
        if (paineis.length) { for (const p of paineis) p.rolar?.(sy); }          // quadro aberto: o analógico rola
        else if (player.flying && !futOn && Math.abs(sy) > 0.35) my = -sy;
        if (edge(hnd, 3)) runVrAction('toggleMap');
        // mira pelo controle
        hnd.ctrl.getWorldPosition(cpos);
        hnd.ctrl.getWorldQuaternion(q);
        cdir.set(0, 0, -1).applyQuaternion(q);
        // com o menu aberto a mira do mundo fica onde estava (obras e plano nano agem no bloco que estava na mira)
        game.aimRay = game.menuVr?.miraFixa || [cpos.x, cpos.y, cpos.z, cdir.x, cdir.y, cdir.z];
        const trig = btn(hnd, 0), trigDown = edge(hnd, 0), gripHeld = btn(hnd, 1);
        const uiTargets = [];
        for (const b of leftBtns) if (b.visible) uiTargets.push(b);
        if (mapBoard.visible) {
          if (mapScreen) uiTargets.push(mapScreen);
          for (const b of mapButtons) uiTargets.push(b);
        }
        for (const p of paineis) uiTargets.push(p.mesh);
        let uiHit = null;
        if (uiTargets.length) {
          raycaster.set(cpos, cdir);
          raycaster.near = 0.05; raycaster.far = 8;
          uiHit = raycaster.intersectObjects(uiTargets, false)[0] || null;
        }
        const painel = uiHit?.object?.userData?.vrPainel || null;
        for (const p of paineis) if (p !== painel) p.apontar(null);
        if (uiHit) {
          if (vrFutHolding) { vrFutHolding = false; game.futebol?.cancelarAcao?.(); }
          hoverObj = uiHit.object;
          laserMat.color.setHex(0x88e8ff);
          if (laser) laser.scale.z = Math.max(0.05, uiHit.distance);
          if (painel) {
            game.mapa?.cursorUv?.(null, null);
            if (uiHit.uv) { painel.apontar(uiHit.uv); if (trigDown) painel.clique(uiHit.uv); }
          } else if (uiHit.object === mapScreen && uiHit.uv) {
            game.mapa?.cursorUv?.(uiHit.uv.x, uiHit.uv.y);
            if (trigDown) mapDragUv = { u: uiHit.uv.x, v: uiHit.uv.y };
            else if (trig && mapDragUv) {
              const du = uiHit.uv.x - mapDragUv.u, dv = uiHit.uv.y - mapDragUv.v, esc = game.mapa?.escala || 2;
              mapDragUv.u = uiHit.uv.x; mapDragUv.v = uiHit.uv.y;
              game.mapa?.mover?.(-du * VR_MAP_W * esc, dv * VR_MAP_H * esc);
            } else if (!trig) mapDragUv = null;
          } else {
            game.mapa?.cursorUv?.(null, null);
            if (!trig) mapDragUv = null;
            if (trigDown) runVrAction(uiHit.object.userData.vrAction);
          }
          src.set('break', false);
          src.set('place', false);
          src.set('jump', btn(hnd, 4));
          src.set('interact', futOn ? false : btn(hnd, 5));
        } else if ((futOn && !game.overlay) || chuteLivre) {     // com menu ou mapa aberto, o gatilho não chuta
          game.mapa?.cursorUv?.(null, null);
          if (!trig) mapDragUv = null;
          // No campo de futebol (GM OFF): bloqueia quebrar/pôr blocos e usa gatilho/grip direito para carregar/chutar a skill.
          // Fora da zona, perto da bola (19/11): o gatilho chuta como o F do PC (curto = toque, segurar = chute carregado);
          // o aperto continua pondo bloco e o B continua usando.
          src.set('break', false);
          src.set('place', futOn ? false : gripHeld);
          const sk = game.futebol.skillAtual;
          laserMat.color.set(futOn ? (sk?.cor || '#4ade80') : '#ffe27a');
          if (laser) laser.scale.z = futOn ? 5.5 : 3;
          const fireHeld = futOn ? (trig || gripHeld) : trig;
          if (fireHeld && !vrFutHolding) {
            vrFutHolding = true;
            game.futebol.comecaAcao([cdir.x, cdir.y, cdir.z]);
          } else if (!fireHeld && vrFutHolding) {
            vrFutHolding = false;
            game.futebol.soltaAcao([cdir.x, cdir.y, cdir.z]);
          }
          src.set('jump', btn(hnd, 4));
          if (futOn) { if (edge(hnd, 5)) game.futebol.alternarCurva(); src.set('interact', false); }
          else src.set('interact', btn(hnd, 5));
        } else {
          if (vrFutHolding) { vrFutHolding = false; game.futebol?.cancelarAcao?.(); }
          laserMat.color.setHex(0xffd9a0);
          game.mapa?.cursorUv?.(null, null);
          if (!trig) mapDragUv = null;
          src.set('break', trig);
          src.set('place', gripHeld);
          if (laser) laser.scale.z = interaction.target.hit ? Math.max(0.05, interaction.target.t) : interaction.reach;
          src.set('jump', btn(hnd, 4));
          src.set('interact', btn(hnd, 5));
        }
      }
    }
    src.axes(mx, mz, my);

    // a cabeça manda no olhar e na direção de andar
    camera.getWorldDirection(headDir);
    player.yaw = Math.atan2(-headDir.x, -headDir.z);
    player.pitch = Math.asin(Math.max(-1, Math.min(1, headDir.y)));

    // passos reais na sala movem o corpo (com colisão); o chão da sala acompanha o corpo
    headPos.copy(camera.position);                      // posição local da cabeça na sala
    if (firstFrame) { lastHead.copy(headPos); firstFrame = false; }
    const dx = headPos.x - lastHead.x, dz = headPos.z - lastHead.z;
    lastHead.copy(headPos);
    const c = Math.cos(api.turn), s = Math.sin(api.turn);
    if (Math.abs(dx) + Math.abs(dz) < 0.5) player.nudge(dx * c + dz * s, -dx * s + dz * c);
    rig.rotation.set(0, api.turn, 0);
    drawWrist();
  }

  // posiciona a sala para a cabeça ficar sobre o corpo (chamar depois de calcular a posição interpolada)
  function place(x, y, z) {
    const c = Math.cos(api.turn), s = Math.sin(api.turn);
    const hx = camera.position.x, hz = camera.position.z;
    rig.position.set(x - (hx * c + hz * s), y, z - (-hx * s + hz * c));
  }

  function sync() {
    if (!api.presenting) { vrCompass.visible = false; mapBoard.visible = false; return; }
    syncMapBoard();
    drawVrCompass();
    drawWrist();
  }

  api.place = place;
  api.sync = sync;
  api.sessao = () => renderer.xr.getSession();
  api.sair = () => { const s = renderer.xr.getSession(); if (s) s.end().catch(() => {}); };   // "Sair do VR" do menu
  return api;
}
