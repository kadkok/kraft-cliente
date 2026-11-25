// LAVRA — as balsas do arquipélago no aparelho (pedido do Kadmus, 19/11/2026: "um cais em cada ilha e uma balsa com
// npc fazendo o trajeto todos os dias"). Lógica e horário: shared/balsa.js (função do relógio de verdade). Aqui:
//   - o casco de cada linha (balsa de madeira de duas pontas, com casa do leme, bancos, boias e lanternas) e o balseiro
//     ao leme, montados por código; a posição sai de estadoBalsa(linha, hora do servidor) a cada quadro;
//   - embarque: o convés é chão de verdade para quem joga. Quem está a bordo é levado junto (posição e rumo), anda
//     pelo convés, encosta na amurada e pode pular fora. O servidor não precisa saber: a posição de cada um já vai
//     para ele como sempre;
//   - letreiro: perto de um cais mostra as próximas partidas; a bordo, o destino e o tempo que falta;
//   - ficha do balseiro para quem mira nele (nome, idade, o que está fazendo), pedida ao servidor ('balseiro?').
// Para os outros sistemas: game.balsas = { linhas, estados, portos, agora(), bordo } (o mapa e a bússola leem daqui).
import * as THREE from '../three.js';
import { BALSA, COR_LINHA_TEMA, criarLinhas, estadoBalsa, partidas } from '../../shared/balsa.js';
import { caisEspera } from '../../shared/cais.js';
import { MAR_NIVEL } from '../../shared/mar.js';
import { buildBody } from '../render/avatars.js';
import { U } from '../render/materials.js';
import { MODELOS_ILHAS, carregarModeloIlha } from './ilhas-props.js';

const MX = BALSA.comp / 2, MZ = BALSA.boca / 2;       // meio comprimento e meia boca do casco
const AMURADA = 0.95, FINA = MZ - 0.22;                // altura e linha de dentro da amurada
const BICO = 7.6;                                      // daí até a ponta o casco afina e a amurada dá lugar ao portaló
const mmss = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const MULHER = new Set(['Dona Nair', 'Rosa']);
const COR_TEMA = COR_LINHA_TEMA;

// ---- texturas feitas no aparelho ---------------------------------------------------------------------------------
function texTabuas(base, veio, n = 8) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    const h = 256 / n, k = 0.86 + rnd() * 0.24;
    g.fillStyle = `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`;
    g.fillRect(0, i * h, 256, h);
    g.strokeStyle = `rgba(${veio[0]},${veio[1]},${veio[2]},0.5)`; g.lineWidth = 1;
    for (let j = 0; j < 7; j++) { const y = i * h + 3 + rnd() * (h - 6); g.globalAlpha = 0.25 + rnd() * 0.35; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + rnd() * 4 - 2, 170, y + rnd() * 4 - 2, 256, y); g.stroke(); }
    g.globalAlpha = 1; g.fillStyle = 'rgba(20,12,6,0.55)'; g.fillRect(0, i * h, 256, 2);
    const emenda = rnd() * 256; g.fillRect(emenda, i * h, 2, h);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function texLetreiro(texto, cor) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 96);
  gr.addColorStop(0, '#fbf3df'); gr.addColorStop(1, '#e6d6b0'); g.fillStyle = gr; g.fillRect(0, 0, 512, 96);
  g.fillStyle = cor; g.fillRect(0, 0, 512, 10); g.fillRect(0, 86, 512, 10);
  g.fillStyle = '#2a2018'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let px = 46; do { g.font = `800 ${px}px system-ui, sans-serif`; px -= 2; } while (g.measureText(texto).width > 480 && px > 18);
  g.fillText(texto, 256, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// prisma entre dois contornos (lista de [x, z]) em duas alturas: laterais + tampa de baixo
function prisma(cima, baixo, y1, y0) {
  const n = cima.length, pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, k = pos.length / 3;
    pos.push(cima[i][0], y1, cima[i][1], cima[j][0], y1, cima[j][1], baixo[j][0], y0, baixo[j][1], baixo[i][0], y0, baixo[i][1]);
    idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
  }
  const k0 = pos.length / 3;
  for (const p of baixo) pos.push(p[0], y0, p[1]);
  for (let i = 1; i < n - 1; i++) idx.push(k0, k0 + i, k0 + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const contorno = (e) => [[-MX, -2.6 * e], [-8.2 * e - (1 - e) * MX, -MZ * e], [8.2 * e + (1 - e) * MX, -MZ * e], [MX, -2.6 * e], [MX, 2.6 * e], [8.2 * e + (1 - e) * MX, MZ * e], [-8.2 * e - (1 - e) * MX, MZ * e], [-MX, 2.6 * e]];
// meia largura livre do convés na posição u (dentro da amurada)
const meiaLivre = (u) => { const a = Math.abs(u); return a <= BICO ? FINA : FINA + (2.25 - FINA) * Math.min(1, (a - BICO) / (MX - BICO)); };

export function initBalsa({ game, scene, camera, net, player, ui, avatars }) {
  const pc = game.plataforma === 'pc' || !game.plataforma;
  // ---- hora do servidor -------------------------------------------------------------------------------------------
  let desvio = 0, acertos = 0, seq = 0, ultimoPedido = -1e9;
  const pedidos = new Map();
  // para ensaio e sonda: ?balsat=<s> põe o relógio das balsas nesse instante do ciclo (&balsav=0 congela; 1 = corre)
  const qs = new URLSearchParams(location.search), tForcado = qs.has('balsat') ? Number(qs.get('balsat')) : NaN, vForcado = qs.has('balsav') ? Number(qs.get('balsav')) : 1, tPagina = performance.now();
  const forca = { t: tForcado, v: vForcado, de: tPagina };
  const agora = () => (Number.isFinite(forca.t) ? forca.t + (performance.now() - forca.de) / 1000 * forca.v : (Date.now() + desvio) / 1000);
  function pedeHora() { const n = ++seq; pedidos.set(n, performance.now()); if (pedidos.size > 8) pedidos.delete(pedidos.keys().next().value); net?.send?.({ t: 'balsa?', n }); ultimoPedido = performance.now(); }

  // ---- materiais compartilhados -----------------------------------------------------------------------------------
  const M = {};
  const mat = (nome, o) => M[nome] || (M[nome] = new THREE.MeshStandardMaterial(o));
  const tConves = texTabuas([168, 126, 78], [70, 44, 20], 8), tCasco = texTabuas([104, 70, 42], [40, 24, 12], 6), tTelha = texTabuas([168, 68, 48], [80, 26, 18], 10);
  // esteira: duas faixas de espuma que abrem e somem para trás (alfa pintado num canvas)
  const tEsteira = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    let s = 11; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let k = 0; k < 520; k++) {
      const x = rnd() * 256, f = x / 256, abre = 10 + f * 20, y = 32 + (rnd() < 0.5 ? -1 : 1) * (abre * (0.55 + rnd() * 0.45)) + (rnd() - 0.5) * 6;
      g.fillStyle = `rgba(255,255,255,${(0.5 * (1 - f) * (1 - f) * (0.4 + rnd() * 0.6)).toFixed(3)})`;
      g.beginPath(); g.ellipse(x, y, 5 + rnd() * 9, 1.5 + rnd() * 2.5, 0, 0, 6.2832); g.fill();
    }
    for (let k = 0; k < 160; k++) { const x = rnd() * 150, f = x / 150; g.fillStyle = `rgba(255,255,255,${(0.35 * (1 - f) * rnd()).toFixed(3)})`; g.beginPath(); g.ellipse(x, 32 + (rnd() - 0.5) * 14, 4 + rnd() * 6, 1 + rnd() * 2, 0, 0, 6.2832); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const sombra = (o, lanca = true) => { o.castShadow = pc && lanca; o.receiveShadow = true; return o; };
  const caixa = (pai, w, h, d, m, x, y, z, ry = 0, rz = 0) => { const o = sombra(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)); o.position.set(x, y, z); o.rotation.set(0, ry, rz); pai.add(o); return o; };

  function criaBarco(L, tema) {
    const g = new THREE.Group(); g.name = 'balsa-' + L.id;
    const cor = COR_TEMA[tema] || '#c9a24a';
    const mConves = mat('conves', { map: tConves, roughness: 0.82 }), mMadeira = mat('madeira', { map: tCasco, roughness: 0.78 });
    const mEscura = mat('escura', { color: '#3a2a1c', roughness: 0.7 }), mBranco = mat('branco', { color: '#efe9da', roughness: 0.6 });
    const mFundo = mat('fundo', { color: '#6a2a22', roughness: 0.85, side: THREE.DoubleSide }), mFerro = mat('ferro', { color: '#2b2f36', roughness: 0.5, metalness: 0.6 });
    const mCostado = mat('costado', { map: tCasco, roughness: 0.78, side: THREE.DoubleSide });
    const mFaixa = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.6, side: THREE.DoubleSide });
    // casco: obra viva (vermelho escuro), costado de madeira e uma faixa na cor da ilha de destino
    g.add(sombra(new THREE.Mesh(prisma(contorno(1), contorno(0.9), -0.62, -1.5), mFundo)));
    g.add(sombra(new THREE.Mesh(prisma(contorno(1.012), contorno(1.0), -0.06, -0.64), mCostado)));
    g.add(sombra(new THREE.Mesh(prisma(contorno(1.02), contorno(1.02), -0.2, -0.36), mFaixa)));
    // convés
    const cv = contorno(1), sh = new THREE.Shape(); cv.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z)));
    const gc = new THREE.ShapeGeometry(sh); gc.rotateX(Math.PI / 2);
    const uv = gc.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
    const conves = new THREE.Mesh(gc, mConves); conves.position.y = 0; conves.receiveShadow = true; conves.material.side = THREE.DoubleSide; g.add(conves);
    // amuradas (os dois bordos), cinta de cima, pontaletes e os bicos que fecham até o portaló
    for (const sz of [-1, 1]) {
      const z = sz * (MZ - 0.1);
      caixa(g, BICO * 2, AMURADA, 0.14, mMadeira, 0, AMURADA / 2, z);
      caixa(g, BICO * 2 + 0.2, 0.09, 0.3, mEscura, 0, AMURADA + 0.02, z);
      for (let x = -BICO; x <= BICO + 0.01; x += 1.9) caixa(g, 0.16, AMURADA + 0.06, 0.2, mEscura, x, AMURADA / 2, z - sz * 0.02);
      for (const sx of [-1, 1]) {
        const x0 = sx * BICO, z0 = z, x1 = sx * (MX - 0.25), z1 = sz * 2.5, len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0);
        caixa(g, len, AMURADA, 0.14, mMadeira, (x0 + x1) / 2, AMURADA / 2, (z0 + z1) / 2, ang);
        caixa(g, len + 0.1, 0.09, 0.3, mEscura, (x0 + x1) / 2, AMURADA + 0.02, (z0 + z1) / 2, ang);
        caixa(g, 0.24, AMURADA + 0.35, 0.24, mEscura, x1, (AMURADA + 0.35) / 2, z1);                // cabeço do portaló
        const lz = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.22), mat('luz', { color: '#ffe2a0', emissive: '#ffb648', emissiveIntensity: 1.6, roughness: 0.4 }));
        lz.position.set(x1, AMURADA + 0.5, z1); g.add(lz);
      }
      // boias salva-vidas penduradas por fora
      for (const x of [-4.6, 4.6]) { const b = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.1, 8, 18), mat('boia', { color: '#e2572b', roughness: 0.55 })); b.position.set(x, 0.42, z + sz * 0.12); b.castShadow = pc; g.add(b); }
    }
    // rampas das duas pontas (descem quando a balsa está encostada naquele lado)
    const rampas = [-1, 1].map((sx) => {
      const p = new THREE.Group(); p.position.set(sx * (MX - 0.05), 0.02, 0);
      caixa(p, 1.25, 0.09, 4.9, mConves, sx * 0.6, 0, 0);
      caixa(p, 1.25, 0.05, 0.12, mFerro, sx * 0.6, 0.06, 2.4); caixa(p, 1.25, 0.05, 0.12, mFerro, sx * 0.6, 0.06, -2.4);
      g.add(p); return p;
    });
    // bancos compridos a bombordo e carga amarrada (caixotes e barris) junto à amurada
    for (const x of [-3.4, 3.4]) { caixa(g, 4.6, 0.09, 0.55, mConves, x, 0.48, -MZ + 0.62); for (const dx of [-2, 0, 2]) caixa(g, 0.1, 0.46, 0.5, mEscura, x + dx, 0.23, -MZ + 0.62); }
    caixa(g, 0.9, 0.9, 0.9, mMadeira, -6.3, 0.45, -MZ + 0.85, 0.2); caixa(g, 0.7, 0.7, 0.7, mMadeira, -6.2, 1.25, -MZ + 0.9, 0.5);
    for (const [x, z] of [[6.2, -MZ + 0.8], [6.9, -MZ + 1.05]]) { const b = sombra(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.33, 0.9, 12), mMadeira)); b.position.set(x, 0.45, z); g.add(b); const a = new THREE.Mesh(new THREE.TorusGeometry(0.365, 0.025, 6, 16), mFerro); a.rotation.x = Math.PI / 2; a.position.set(x, 0.62, z); g.add(a); }
    // casa do leme, a boreste: quatro esteios, meia parede, telhado de telha e o letreiro da linha nos dois lados
    const casa = new THREE.Group(); casa.position.set(0, 0, MZ - 1.75); g.add(casa);
    for (const [x, z] of [[-1.55, -1.1], [1.55, -1.1], [-1.55, 1.1], [1.55, 1.1]]) caixa(casa, 0.16, 2.35, 0.16, mEscura, x, 1.175, z);
    caixa(casa, 3.1, 0.95, 0.1, mMadeira, 0, 0.475, 1.12);
    caixa(casa, 3.9, 0.12, 3.2, mEscura, 0, 2.38, 0);
    const telha = new THREE.MeshStandardMaterial({ map: tTelha, roughness: 0.75 });
    caixa(casa, 3.7, 0.16, 3.0, telha, 0, 2.5, 0); caixa(casa, 2.5, 0.16, 1.9, telha, 0, 2.66, 0); caixa(casa, 1.2, 0.14, 0.8, telha, 0, 2.8, 0);
    const mLet = new THREE.MeshStandardMaterial({ map: texLetreiro(`${game.balsas?.nomePrincipal || 'PRINCIPAL'} ⇄ ${L.nome}`.toUpperCase(), cor), roughness: 0.7 });
    // (na testeira do telhado, acima da cabeça de quem está no convés)
    for (const sx of [-1, 1]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.5), mLet); pl.position.set(sx * 1.96, 2.13, 0); pl.rotation.y = sx * Math.PI / 2; casa.add(pl); }
    for (const sz of [-1, 1]) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 0.5), mLet); pl.position.set(0, 2.13, sz * 1.62); pl.rotation.y = sz > 0 ? 0 : Math.PI; casa.add(pl); }
    // roda do leme num pedestal, no meio da casa (substituída pelo timão 3D timao-balsa.glb assim que carrega)
    caixa(casa, 0.34, 0.95, 0.34, mEscura, 0, 0.475, 0);
    const roda = new THREE.Group(); roda.position.set(0, 1.15, 0); casa.add(roda);
    const aro = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 6, 20), mEscura); aro.rotation.y = Math.PI / 2; roda.add(aro);
    for (let k = 0; k < 4; k++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.02, 0.04), mEscura); r.rotation.x = k * Math.PI / 4; roda.add(r); }
    let vivo = true;
    carregarModeloIlha(MODELOS_ILHAS.timaoBalsa).then((it) => {
      if (!vivo || !it?.geometry) return;
      while (roda.children.length) {
        const ch = roda.children.pop();
        if (ch.geometry && !ch.geometry.userData?.shared) ch.geometry.dispose();
      }
      const timao = sombra(new THREE.Mesh(it.geometry, it.material));
      timao.name = 'timao-3d';
      roda.add(timao);
    }).catch(() => {});
    carregarModeloIlha(MODELOS_ILHAS.sinoCais).then((it) => {
      if (!vivo || !it?.geometry) return;
      const sino = sombra(new THREE.Mesh(it.geometry, it.material));
      sino.name = 'sino-balsa-3d';
      sino.scale.setScalar(0.45);
      sino.position.set(1.38, 1.25, -1.08);
      casa.add(sino);
    }).catch(() => {});
    // lanternas penduradas no beiral e um mastro curto com a flâmula da ilha
    for (const [x, z] of [[-1.7, -1.35], [1.7, -1.35]]) { caixa(casa, 0.03, 0.3, 0.03, mFerro, x, 2.16, z); const lz = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.2), M.luz); lz.position.set(x, 1.92, z); casa.add(lz); }
    caixa(casa, 0.07, 1.7, 0.07, mEscura, 1.3, 3.6, 0.9);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5, 6, 1), new THREE.MeshStandardMaterial({ color: cor, roughness: 0.8, side: THREE.DoubleSide })); fl.position.set(1.3 - 0.58, 4.15, 0.9); casa.add(fl);
    // luz de verdade na casa do leme (só no PC; acende de noite)
    let lamp = null;
    if (pc) { lamp = new THREE.PointLight('#ffc27a', 0, 16, 1.6); lamp.position.set(0, 2.0, MZ - 1.75); g.add(lamp); }
    // esteira de espuma atrás (duas faixas que somem); aparece com a balsa andando
    const mEsp = new THREE.MeshBasicMaterial({ map: tEsteira, color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
    const esteira = new THREE.Mesh(new THREE.PlaneGeometry(30, 9, 1, 1), mEsp); esteira.rotation.x = -Math.PI / 2; esteira.renderOrder = 4; g.add(esteira);

    // o balseiro
    const b = buildBody(), osso = b.root.getObjectByName('root') || b.root, cab = b.head || osso, mulher = MULHER.has(L.balseiro), U8 = 1.8 / 32;
    b.setSkin?.(null, mulher, 'explorador');
    b.mats?.skin?.color?.set(['#e2bf9c', '#c99a72', '#a87650', '#f3dcc6'][L.i % 4]);
    const veste = (geo, m, pai, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = pc; pai.add(o); return o; };
    veste(new THREE.BoxGeometry(0.5, 0.63, 0.27), mat('japona', { color: '#22344f', roughness: 0.85 }), osso, 0, 18 * U8, 0);
    veste(new THREE.BoxGeometry(0.52, 0.1, 0.52), mBranco, cab, 0, 8 * U8 + 0.05, 0);                       // quepe
    veste(new THREE.BoxGeometry(0.54, 0.04, 0.2), mat('pala', { color: '#141820', roughness: 0.5 }), cab, 0, 8 * U8 + 0.0, -0.3);
    if (mulher) veste(new THREE.BoxGeometry(0.5, 0.6, 0.12), mat('cabelo', { color: '#3a2416', roughness: 0.95 }), cab, 0, -0.06, 0.26);
    else if (L.i % 2 === 0) veste(new THREE.BoxGeometry(0.36, 0.16, 0.08), mat('barba', { color: '#d8d4cc', roughness: 0.95 }), cab, 0, -0.16, -0.27);
    casa.add(b.root);
    g.visible = false; scene.add(g);
    return { g, casa, roda, rampas, fl, lamp, esteira, mEsp, corpo: b, L, yaw: 0, sent: 1, parar: () => { vivo = false; }, mats: [mFaixa, telha, mLet, fl.material, mEsp] };
  }

  // ---- mundo atual: linhas, portos, cascos ---------------------------------------------------------------------
  let genRef = null, linhas = [], barcos = [], portos = [];
  const estados = [], refs = [];
  const api = { linhas, estados, portos, agora, bordo: -1, nomePrincipal: 'Ilha Principal',
    // só para ensaio: põe o relógio das balsas no instante t (s) andando v vezes mais rápido (NaN volta ao do servidor)
    relogio(t, v = 1) { forca.t = t; forca.v = v; forca.de = performance.now(); },
    painel: () => (painel.style.display === 'none' ? '' : pTit.textContent + ' | ' + pLin.textContent),
    dispose() {
      desmonta();
      for (const t of [tConves, tCasco, tTelha, tEsteira]) t?.dispose?.();
      for (const k of Object.keys(M)) M[k]?.dispose?.();
      painel.remove();
      ficha.remove();
    } };
  game.balsas = api;
  function desmonta() {
    for (const b of barcos) { b.parar?.(); scene.remove(b.g); b.g.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); }); b.corpo?.dispose?.(); for (const m of b.mats) { m.map?.dispose(); m.dispose(); } }
    barcos = []; linhas = []; portos = []; estados.length = 0; refs.length = 0; api.bordo = -1;
  }
  function monta(gen) {
    desmonta();
    const arq = gen?.arq, mapa = arq?.mapa;
    if (!arq || !mapa || (game.dim || 0) !== 0) { api.linhas = linhas; api.portos = portos; return; }
    portos = (arq.portos || []).map((q) => ({ id: q.id, nome: q.nome, cais: q.cais, espera: caisEspera(q.cais) }));
    api.nomePrincipal = portos.find((q) => q.id === 'principal')?.nome || 'Ilha Principal';
    const nomeDe = (id) => arq.ilhas.find((il) => il.id === id)?.nome || id;
    linhas = portos.some((q) => q.id === 'principal') ? criarLinhas(mapa, nomeDe).filter((L) => portos.some((q) => q.id === L.id)) : [];
    barcos = linhas.map((L) => criaBarco(L, arq.ilhas.find((il) => il.id === L.id)?.ficha?.tema));
    linhas.forEach(() => { estados.push({}); refs.push(null); });
    api.linhas = linhas; api.portos = portos;
  }

  // ---- letreiro (cais e bordo) e ficha do balseiro --------------------------------------------------------------
  const painel = document.createElement('div');
  Object.assign(painel.style, { position: 'fixed', left: '50%', top: '98px', transform: 'translateX(-50%)', maxWidth: 'min(92vw, 560px)', padding: '8px 16px', borderRadius: '12px', zIndex: 14, display: 'none',
    background: 'linear-gradient(180deg, rgba(14,34,52,.92), rgba(8,20,34,.9))', border: '1px solid rgba(160,220,255,.32)', color: '#eaf6ff', font: '600 13px system-ui, sans-serif', textAlign: 'center', pointerEvents: 'none', textShadow: '0 1px 2px #000' });
  const pTit = document.createElement('div'), pLin = document.createElement('div'), pBar = document.createElement('div'), pFio = document.createElement('div');
  Object.assign(pTit.style, { font: '800 15px system-ui, sans-serif', marginBottom: '2px' });
  Object.assign(pLin.style, { whiteSpace: 'pre-line', lineHeight: '1.45' });
  Object.assign(pBar.style, { height: '5px', borderRadius: '3px', marginTop: '6px', background: 'linear-gradient(90deg, rgba(255,255,255,.14), rgba(255,255,255,.08))', overflow: 'hidden', display: 'none' });
  Object.assign(pFio.style, { height: '100%', width: '0%', background: 'linear-gradient(90deg, #58c7ff, #b6f3ff)' });
  pBar.appendChild(pFio); painel.append(pTit, pLin, pBar); (ui?.el?.hud || document.body).appendChild(painel);
  const ficha = document.createElement('div');
  Object.assign(ficha.style, { position: 'fixed', left: '50%', bottom: '150px', transform: 'translateX(-50%)', maxWidth: '520px', padding: '8px 14px', borderRadius: '10px', zIndex: 15, display: 'none',
    background: 'linear-gradient(180deg, rgba(34,26,16,.92), rgba(18,14,8,.88))', border: '1px solid rgba(255,230,180,.3)', color: '#f6ecd8', font: '600 13px system-ui, sans-serif', textAlign: 'center', pointerEvents: 'none', textShadow: '0 1px 2px #000' });
  const fTit = document.createElement('div'), fMis = document.createElement('div');
  Object.assign(fTit.style, { font: '800 15px system-ui, sans-serif' }); Object.assign(fMis.style, { margin: '3px 0 0', color: '#ffe2a8' });
  ficha.append(fTit, fMis); document.body.appendChild(ficha);
  const fichas = new Map();
  let miraI = -1, pedidoFicha = 0, relogioPainel = 0;

  game.hooks.other.push((m) => {
    if (m.t === 'balsa') {
      const t0 = pedidos.get(m.n); pedidos.delete(m.n);
      const ida = t0 === undefined ? 0 : Math.min(2000, performance.now() - t0) / 2, novo = m.agora + ida - Date.now();
      desvio = acertos++ ? desvio + (novo - desvio) * 0.35 : novo;
    } else if (m.t === 'balseiro') { fichas.set(m.i, m); if (miraI === m.i) mostraFicha(m); }
    else if (m.t === 'welcome' || m.t === 'dim') genRef = null;
  });
  function mostraFicha(f) { fTit.textContent = `${f.nome} · balseir${MULHER.has(f.nome) ? 'a' : 'o'} · ${f.idade} anos`; fMis.textContent = `${f.missao} — ${f.linha}`; ficha.style.display = 'block'; }

  // ---- quadro: põe cada balsa no lugar ----------------------------------------------------------------------------
  const v3 = new THREE.Vector3(), dirCam = new THREE.Vector3(), posCam = new THREE.Vector3(), tmpEst = {}, ATRASO_REDE = 0.2;

  // começo do quadro (antes da física e da câmera): estado de cada balsa neste instante e quem está a bordo vai junto
  let tQuadro = 0;
  game.hooks.pre.push(() => {
    if (game.gen !== genRef) { genRef = game.gen; monta(game.gen); if (linhas.length) pedeHora(); }
    if (!linhas.length) return;
    tQuadro = agora();
    const mar = game.mar;
    for (let i = 0; i < linhas.length; i++) {
      const st = estadoBalsa(linhas[i], tQuadro, estados[i]), andando = Math.min(1, Math.abs(st.v) / 3);
      let sobe = 0; st.cab = 0; st.bal = 0;
      if (mar?.ligado && andando > 0.01 && Math.hypot(st.x - player.pos[0], st.z - player.pos[2]) < 400) {
        const a0 = mar.altura(st.x, st.z) - MAR_NIVEL, a1 = mar.altura(st.x + st.tx * 7, st.z + st.tz * 7) - MAR_NIVEL, a2 = mar.altura(st.x - st.tx * 7, st.z - st.tz * 7) - MAR_NIVEL;
        const a3 = mar.altura(st.x - st.tz * 3, st.z + st.tx * 3) - MAR_NIVEL, a4 = mar.altura(st.x + st.tz * 3, st.z - st.tx * 3) - MAR_NIVEL;
        sobe = (a0 * 0.4 + (a1 + a2 + a3 + a4) * 0.15) * 0.3 * andando; st.cab = Math.atan2(a1 - a2, 14) * 0.5 * andando; st.bal = Math.atan2(a3 - a4, 6) * 0.4 * andando;
      }
      st.y = BALSA.conves + sobe; st.ang = Math.atan2(-st.tz, st.tx); st.andando = andando;
    }
    const i = api.bordo; if (i < 0) return;
    const st = estados[i], r = refs[i];
    if (!r) { refs[i] = { x: st.x, z: st.z, ang: st.ang, y: st.y }; return; }
    const da = st.ang - r.ang, c = Math.cos(da), s = Math.sin(da);
    for (const q of [player.pos, player.prev]) {
      const ox = q[0] - r.x, oz = q[2] - r.z;
      q[0] = st.x + ox * c + oz * s; q[2] = st.z - ox * s + oz * c; q[1] += st.y - r.y;
    }
    player.yaw += da;
    r.x = st.x; r.z = st.z; r.ang = st.ang; r.y = st.y;
  });

  // ---- quadro: desenha cada balsa onde o começo do quadro a pôs ---------------------------------------------------
  game.hooks.frame.push((dt) => {
    if (!linhas.length) { if (painel.style.display !== 'none') painel.style.display = 'none'; return; }
    if (performance.now() - ultimoPedido > (acertos < 3 ? 4000 : 30000)) pedeHora();
    const t = tQuadro, noite = (U.uSunDir?.value?.y ?? 1) < 0.06;
    camera.getWorldPosition(posCam);
    linhas.forEach((L, i) => {
      const st = estados[i], b = barcos[i];
      if (st.x === undefined) return;
      const longe = Math.hypot(st.x - posCam.x, st.z - posCam.z);
      b.g.visible = longe < 950;
      const ang = st.ang, andando = st.andando, cab = st.cab, bal = st.bal;
      if (!b.g.visible) return;
      b.g.position.set(st.x, st.y, st.z);
      b.g.rotation.set(0, 0, 0); b.g.rotateY(ang); b.g.rotateZ(cab); b.g.rotateX(bal);
      // rampas: desce a do lado encostado
      b.rampas[0].rotation.z += ((st.fase === 0 ? 0 : -0.42) - b.rampas[0].rotation.z) * Math.min(1, dt * 1.6);
      b.rampas[1].rotation.z += ((st.fase === 2 ? 0 : 0.42) - b.rampas[1].rotation.z) * Math.min(1, dt * 1.6);
      // balseiro: de frente para onde a balsa vai (parado no cais, olha para o cais de onde vai sair)
      const sent = st.fase === 1 || st.fase === 0 ? 1 : -1;
      b.sent += (sent - b.sent) * Math.min(1, dt * 2.5);
      const B = b.corpo, tt = performance.now() / 1000 + i;
      B.root.position.set(-0.62 * b.sent, 0, 0); B.root.rotation.y = b.sent > 0 ? -Math.PI / 2 : Math.PI / 2;
      if (Math.abs(b.sent) < 0.92) B.root.rotation.y = -Math.PI / 2 * b.sent;
      const gira = andando > 0.05 ? Math.sin(tt * 0.7) * 0.5 : 0;
      b.roda.rotation.x = gira;
      // braços à frente, no timão (rosto do boneco em −Z: girar o braço em +x leva a mão para a frente; com −x ia para trás)
      if (B.armL) { const acena = (st.fase === 0 || st.fase === 2) && st.falta < 22 ? Math.sin(tt * 7) * 0.5 : 0; B.armL.rotation.x = 1.15 + gira * 0.2; B.armR.rotation.x = acena ? 2.6 - acena : 1.15 - gira * 0.2; B.armR.rotation.z = acena ? 0.35 : 0; }
      if (B.legL) { B.legL.rotation.x = 0; B.legR.rotation.x = 0; }
      // flâmula e esteira
      const pa = b.fl.geometry.attributes.position; for (let k = 0; k < pa.count; k++) pa.setZ(k, Math.sin(tt * 6 + pa.getX(k) * 5) * 0.07 * (0.5 - pa.getX(k)));
      pa.needsUpdate = true;
      b.mEsp.opacity = 0.85 * andando; b.esteira.visible = andando > 0.03;
      const tras = st.v < 0 ? 1 : -1;
      b.esteira.position.set(tras * (MX + 13.5), -(st.y - MAR_NIVEL) + 0.08, 0);
      // O início da textura (u=0) é denso junto ao casco. O V abre e se dissipa no sentido da popa.
      b.esteira.scale.x = tras;
      if (b.lamp) b.lamp.intensity = noite ? 26 : 0;
    });

    // os outros jogadores chegam com ~0,2 s de atraso (rede + suavização): quem está num convés que anda apareceria
    // para trás, fora do casco. Quem cai dentro do casco de 0,2 s atrás é desenhado no mesmo lugar do convés de agora.
    if (avatars?.list?.size) {
      for (let i = 0; i < linhas.length; i++) {
        const st = estados[i]; if (st.x === undefined || Math.abs(st.v) < 0.3 || !barcos[i].g.visible) continue;
        const ant = estadoBalsa(linhas[i], t - ATRASO_REDE, tmpEst), angAnt = Math.atan2(-ant.tz, ant.tx);
        for (const a of avatars.list.values()) {
          const q = a.body?.root?.position; if (!q || Math.abs(q.y - BALSA.conves) > 3.5) continue;
          const dx = q.x - ant.x, dz = q.z - ant.z, u = dx * ant.tx + dz * ant.tz, w = -dx * ant.tz + dz * ant.tx;
          if (Math.abs(u) > MX + 0.6 || Math.abs(w) > MZ + 0.4) continue;
          q.x = st.x + u * st.tx - w * st.tz; q.z = st.z + u * st.tz + w * st.tx; q.y += st.y - BALSA.conves;
          a.body.root.rotation.y += st.ang - angAnt;
        }
      }
    }

    // letreiro, duas vezes por segundo
    if ((relogioPainel -= dt) <= 0) {
      relogioPainel = 0.5;
      let txt = null, tit = '', prog = -1;
      const p = player.pos;
      if (api.bordo >= 0) {
        const L = linhas[api.bordo], st = estados[api.bordo];
        tit = `⛴ Balsa ${api.nomePrincipal} ⇄ ${L.nome} · ${MULHER.has(L.balseiro) ? 'balseira' : 'balseiro'} ${L.balseiro}`;
        if (st.fase === 0 || st.fase === 2) txt = `No cais da ${st.fase === 0 ? api.nomePrincipal : L.nome}. Parte para a ${st.fase === 0 ? L.nome : api.nomePrincipal} em ${mmss(st.falta)}.`;
        else { txt = `Rumo à ${st.fase === 1 ? L.nome : api.nomePrincipal} — chegada em ${mmss(st.falta)}.`; prog = st.fase === 1 ? st.d / L.total : 1 - st.d / L.total; }
      } else if ((game.dim || 0) === 0) {
        let perto = null, dm = 46;
        for (const q of portos) { const d = Math.hypot(q.espera[0] - p[0], q.espera[2] - p[2]); if (d < dm && Math.abs(p[1] - q.espera[1]) < 12) { dm = d; perto = q; } }
        if (perto) {
          const lado = perto.id === 'principal' ? 0 : 1;
          tit = `⚓ Cais da ${perto.nome}`;
          txt = partidas(linhas, t, lado, perto.id).slice(0, lado === 0 ? 3 : 1).map((q) => `⛴ ${lado === 0 ? q.linha.nome : api.nomePrincipal} — ${q.noCais ? `no cais, parte em ${mmss(q.emSegundos)}` : `chega em ${mmss(q.chegaEm)}`}`).join('\n');
        }
      }
      if (txt && game.state === 'PLAYING') { pTit.textContent = tit; pLin.textContent = txt; pBar.style.display = prog >= 0 ? 'block' : 'none'; if (prog >= 0) pFio.style.width = Math.round(Math.max(0, Math.min(1, prog)) * 100) + '%'; painel.style.display = 'block'; }
      else painel.style.display = 'none';
    }

    // mira no balseiro: o mais perto da linha do olhar, a até 7 m
    camera.getWorldDirection(dirCam);
    let melhor = -1, dm = 0.7;
    barcos.forEach((b, i) => {
      if (!b.g.visible) return;
      b.corpo.root.getWorldPosition(v3); v3.y += 1.1;
      v3.sub(posCam); const ao = v3.dot(dirCam); if (ao < 0.5 || ao > 7) return;
      const lado = v3.addScaledVector(dirCam, -ao).length(); if (lado < dm) { dm = lado; melhor = i; }
    });
    if (melhor !== miraI) { miraI = melhor; if (melhor < 0) ficha.style.display = 'none'; else { const f = fichas.get(melhor); if (f) mostraFicha(f); } }
    if (miraI >= 0 && game.state === 'PLAYING' && performance.now() - pedidoFicha > 1500) { pedidoFicha = performance.now(); net?.send?.({ t: 'balseiro?', i: miraI }); }
    if (game.state !== 'PLAYING' && ficha.style.display === 'block') ficha.style.display = 'none';

  });

  // ---- colisão: o convés é chão; a amurada e o costado seguram ------------------------------------------------------
  const HW = 0.3;
  const anterior = player.extra;
  player.extra = (p) => {
    if (anterior) anterior(p);
    if (!linhas.length || (game.dim || 0) !== 0 || p.noclip) { api.bordo = -1; return; }
    let aBordo = -1;
    for (let i = 0; i < linhas.length; i++) {
      const st = estados[i]; if (st.x === undefined) continue;
      const dx = p.pos[0] - st.x, dz = p.pos[2] - st.z;
      if (dx * dx + dz * dz > 14 * 14) continue;
      let u = dx * st.tx + dz * st.tz, w = -dx * st.tz + dz * st.tx;
      const Y = st.y, dentro = Math.abs(u) <= MX && Math.abs(w) <= (Math.abs(u) <= 8.2 ? MZ : MZ - (MZ - 2.6) * (Math.abs(u) - 8.2) / (MX - 8.2));
      if (!dentro) {
        // de fora, na altura do costado (nadando ou andando no fundo raso): o casco empurra para o lado mais perto
        continue;
      }
      const pe = p.pos[1];
      if (pe < Y - 0.95) {                                   // debaixo do convés, dentro do contorno: sai pelo lado mais perto
        if (pe > Y - 3.2) { const fu = MX - Math.abs(u), fw = MZ - Math.abs(w); if (fu < fw) u = Math.sign(u || 1) * (MX + HW); else w = Math.sign(w || 1) * (MZ + HW); p.pos[0] = st.x + u * st.tx - w * st.tz; p.pos[2] = st.z + u * st.tz + w * st.tx; }
        continue;
      }
      // pisa no convés
      if (pe <= Y + 0.03 && p.vel[1] <= 0.01) {
        p.pos[1] = Y; p.vel[1] = 0;
        if (!p.onGround) { p.onGround = true; if (p.flying) p.flying = false; }
      }
      if (p.pos[1] <= Y + 2.4 && !p.flying) aBordo = i;
      // amurada: segura quem está abaixo da cinta (dá para pular por cima)
      if (p.pos[1] < Y + AMURADA - 0.1) {
        const lim = meiaLivre(u) - HW;
        if (Math.abs(u) < MX - 0.9 && Math.abs(w) > lim) { w = Math.sign(w) * lim; p.pos[0] = st.x + u * st.tx - w * st.tz; p.pos[2] = st.z + u * st.tz + w * st.tx; }
      }
      break;
    }
    if (aBordo !== api.bordo) { api.bordo = aBordo; if (aBordo >= 0) { const st = estados[aBordo]; refs[aBordo] = { x: st.x, z: st.z, ang: st.ang, y: st.y }; } }
  };
  return api;
}
