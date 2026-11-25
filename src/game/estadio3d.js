// LAVRA — Estádio 3D de produção para o Futebol & Modo GM:
// - Limpeza rigorosa de recursos WebGL (geometrias, materiais, InstancedMeshes, luzes e CanvasTextures) sem vazamentos
// - Gramado HD com faixas de corte naturais, micro-textura orgânica, marcações FIFA completas e áreas técnicas pontilhadas
// - Traves 3D com suportes traseiros/hastes metálicas + malha de rede nítida com física de onda 2D acoplada entre vizinhos
// - Torres de refletores com treliças diagonais, bancos de LED e halos/cones volumétricos aditivos (entardecer/noite)
// - Bancos de reservas (dugouts cobertos), placas perimetrais LED dinâmicas com cores/nomes do GM e arquibancadas instanciadas
// - Bandeiras de escanteio e bandeirões multi-segmento ondulando ao vento
// - Chuteiras 3D detalhadas (solado, travas, contraforte, cadarços, listras) com cache sem vazamento
// - VFX ricos por chute especial (bicicleta dourada, voleio energético, carrinho com tufos de grama/poeira, cometa Magnus)
import * as THREE from '../three.js';
import { BOLA } from '../../shared/bola.js';
import { FUT_CHUTEIRAS, customFutebolPadrao } from '../../shared/espacos.js';
import { SKIN_UNIT } from '../render/skin-layout.js';
import { U } from '../render/materials.js';

// ---- Utilitários de limpeza GPU e PRNG determinístico --------------------------------------------------------------
const MAT_TEX_SLOTS = [
  'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
  'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap',
];

function disposeMaterial(mat, disposedMats, disposedTexs) {
  if (!mat || disposedMats.has(mat) || mat.userData?.shared) return;
  disposedMats.add(mat);
  for (const slot of MAT_TEX_SLOTS) {
    const tex = mat[slot];
    if (tex && tex.isTexture && !tex.userData?.shared && !disposedTexs.has(tex)) {
      disposedTexs.add(tex);
      tex.dispose();
    }
  }
  mat.dispose?.();
}

function disposeSubtree(rootObj) {
  if (!rootObj) return;
  const disposedGeos = new Set();
  const disposedMats = new Set();
  const disposedTexs = new Set();
  rootObj.traverse((child) => {
    if (child.geometry && !child.geometry.userData?.shared && !disposedGeos.has(child.geometry)) {
      disposedGeos.add(child.geometry);
      child.geometry.dispose();
    }
    if (child.material) {
      if (Array.isArray(child.material)) {
        for (const m of child.material) disposeMaterial(m, disposedMats, disposedTexs);
      } else {
        disposeMaterial(child.material, disposedMats, disposedTexs);
      }
    }
    if (child.isInstancedMesh || child.isLight) child.dispose?.();
  });
}

function makeRng(seed = 1337) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---- Textura da bola por estilo escolhido pelo GM (cache podado automaticamente) -----------------------------------
const bolaTexCache = new Map();
let ultimoEstiloBola = 'classica';

function pruneBolaCache(keepEstilo) {
  const keep = keepEstilo || ultimoEstiloBola;
  for (const [k, tex] of bolaTexCache) {
    if (k !== keep) {
      tex.dispose?.();
      bolaTexCache.delete(k);
    }
  }
}

export function texturaBolaEstilo(estilo = 'classica') {
  ultimoEstiloBola = estilo || 'classica';
  if (bolaTexCache.has(ultimoEstiloBola)) return bolaTexCache.get(ultimoEstiloBola);
  const W = 512, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), f = (1 + Math.sqrt(5)) / 2, u = 1 / f;
  const norm = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
  const pent = [
    [-1, f, 0], [1, f, 0], [-1, -f, 0], [1, -f, 0], [0, -1, f], [0, 1, f],
    [0, -1, -f], [0, 1, -f], [f, 0, -1], [f, 0, 1], [-f, 0, -1], [-f, 0, 1],
  ].map(norm);
  const hexa = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    for (const c of [-1, 1]) hexa.push(norm([a, b, c]));
    hexa.push(norm([0, a * u, b * f]), norm([a * u, b * f, 0]), norm([a * f, 0, b * u]));
  }
  const todos = [...pent.map((v) => [v, 1]), ...hexa.map((v) => [v, 0])];
  const pal = {
    classica: { p: [22, 24, 30], h: [244, 245, 247], s: [82, 86, 94] },
    ouro:     { p: [216, 166, 30], h: [250, 245, 228], s: [142, 104, 20] },
    neon:     { p: [12, 17, 28], h: [22, 32, 48], s: [38, 246, 255] },
    retro:    { p: [112, 66, 34], h: [146, 92, 52], s: [64, 36, 18] },
  }[ultimoEstiloBola] || { p: [22, 24, 30], h: [244, 245, 247], s: [82, 86, 94] };
  const seamW = ultimoEstiloBola === 'neon' ? 0.017 : 0.010;
  const isRetro = ultimoEstiloBola === 'retro';

  for (let y = 0; y < H; y++) {
    const lat = (y / H) * Math.PI, sLat = Math.sin(lat), cLat = Math.cos(lat);
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      const dx = sLat * Math.cos(lon), dy = cLat, dz = sLat * Math.sin(lon);
      let m1 = -2, m2 = -2, preto = 0;
      for (let i = 0; i < todos.length; i++) {
        const v = todos[i][0];
        const c = dx * v[0] + dy * v[1] + dz * v[2];
        if (c > m1) { m2 = m1; m1 = c; preto = todos[i][1]; } else if (c > m2) m2 = c;
      }
      const gap = m1 - m2;
      const base = preto ? pal.p : pal.h;
      const tSeam = gap < seamW ? 1 - (gap / seamW) * 0.45 : gap < seamW * 1.45 ? (1 - (gap - seamW) / (seamW * 0.45)) * 0.55 : 0;
      const grain = isRetro ? (((Math.sin(x * 1.7 + y * 2.3) * 43758.5) % 1) * 10 - 5) : 0;
      const shade = 0.94 + 0.06 * clamp((m1 - 0.86) / 0.14, 0, 1);
      const k = (y * W + x) * 4;
      img.data[k]     = clamp(Math.round((base[0] * (1 - tSeam) + pal.s[0] * tSeam) * shade + grain), 0, 255);
      img.data[k + 1] = clamp(Math.round((base[1] * (1 - tSeam) + pal.s[1] * tSeam) * shade + grain), 0, 255);
      img.data[k + 2] = clamp(Math.round((base[2] * (1 - tSeam) + pal.s[2] * tSeam) * shade + grain), 0, 255);
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  bolaTexCache.set(ultimoEstiloBola, tex);
  return tex;
}

// ---- Camisas personalizáveis (padrões do GM + skins especiais XP) com LRU + poda em limpar() -----------------------
const camisaTexCache = new Map();
const MAX_CAMISA_CACHE = 32;

function disposeCamisaEntry(mat) {
  if (!mat) return;
  mat.map?.dispose?.();
  mat.dispose?.();
}

function pruneCamisaCache(cfgAtivo = null) {
  if (!cfgAtivo) {
    for (const mat of camisaTexCache.values()) disposeCamisaEntry(mat);
    camisaTexCache.clear();
    return;
  }
  const t0 = cfgAtivo.times?.[0] || customFutebolPadrao().times[0];
  const t1 = cfgAtivo.times?.[1] || customFutebolPadrao().times[1];
  const juiz = cfgAtivo.juiz || customFutebolPadrao().juiz;
  const gol = cfgAtivo.goleiro || customFutebolPadrao().goleiro;
  const validPrefixes = new Set([
    `${t0.cor}|${t0.cor2}|${t0.padrao}`,
    `${t1.cor}|${t1.cor2}|${t1.padrao}`,
    `${juiz.cor}|#ffffff|liso`,
    `${gol.corA}|#18181b|faixa`,
    `${gol.corB}|#18181b|faixa`,
  ]);
  for (const [key, mat] of camisaTexCache) {
    const idx = key.lastIndexOf('|');
    const prefix = idx >= 0 ? key.slice(0, idx) : key;
    if (!validPrefixes.has(prefix)) {
      disposeCamisaEntry(mat);
      camisaTexCache.delete(key);
    }
  }
}

export function materialCamisa(cor1 = '#2f6fd6', cor2 = '#ffffff', padrao = 'liso', skinEspecial = 'uniforme') {
  const key = `${cor1}|${cor2}|${padrao}|${skinEspecial}`;
  if (camisaTexCache.has(key)) {
    const hit = camisaTexCache.get(key);
    // Atualiza ordem LRU
    camisaTexCache.delete(key);
    camisaTexCache.set(key, hit);
    return hit;
  }
  while (camisaTexCache.size >= MAX_CAMISA_CACHE) {
    const oldestKey = camisaTexCache.keys().next().value;
    disposeCamisaEntry(camisaTexCache.get(oldestKey));
    camisaTexCache.delete(oldestKey);
  }
  const W = 128, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const c1 = skinEspecial === 'lenda' ? '#121318' : skinEspecial === 'craque_ouro' ? '#b8860b' : cor1;
  const c2 = skinEspecial === 'lenda' || skinEspecial === 'craque_ouro' || skinEspecial === 'camisa10' ? '#ffd740' : cor2;
  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, W, H);

  if (padrao === 'listras') {
    ctx.fillStyle = c2;
    for (let x = 8; x < W; x += 24) ctx.fillRect(x, 0, 10, H);
  } else if (padrao === 'faixa') {
    ctx.fillStyle = c2;
    ctx.beginPath();
    ctx.moveTo(-10, H * 0.2); ctx.lineTo(W + 10, H * 0.72);
    ctx.lineTo(W + 10, H * 0.96); ctx.lineTo(-10, H * 0.44);
    ctx.closePath(); ctx.fill();
  } else if (padrao === 'bicolor') {
    ctx.fillStyle = c2;
    ctx.fillRect(W / 2, 0, W / 2, H);
  }
  // Micro-trama esportiva sutil
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

  // Gola, ombros e barra esportiva
  ctx.fillStyle = c2;
  ctx.fillRect(0, 0, W, 10);
  ctx.fillRect(0, H - 8, W, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 10, W, 2);

  // Detalhes especiais por skin de XP
  if (skinEspecial === 'camisa10' || skinEspecial === 'craque_ouro' || skinEspecial === 'lenda') {
    ctx.fillStyle = '#ffe57f';
    ctx.fillRect(0, H * 0.36, W, 5);
    ctx.font = '900 54px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.72)'; ctx.lineWidth = 6;
    const num = skinEspecial === 'lenda' ? '★' : '10';
    ctx.strokeText(num, W / 2, H * 0.57);
    ctx.fillText(num, W / 2, H * 0.57);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    roughness: skinEspecial === 'lenda' || skinEspecial === 'craque_ouro' ? 0.34 : 0.70,
    metalness: skinEspecial === 'lenda' || skinEspecial === 'craque_ouro' ? 0.44 : 0.06,
  });
  camisaTexCache.set(key, mat);
  return mat;
}

// ---- Textura de bandeira personalizável pelo GM (com trama têxtil e costura) ---------------------------------------
function texturaBandeira(cor1, cor2, padrao = 'faixas') {
  const W = 256, H = 160, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = cor1; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = cor2;
  if (padrao === 'faixas') {
    ctx.fillRect(0, H * 0.24, W, H * 0.16);
    ctx.fillRect(0, H * 0.60, W, H * 0.16);
  } else if (padrao === 'cruz') {
    ctx.fillRect(W * 0.41, 0, W * 0.18, H);
    ctx.fillRect(0, H * 0.40, W, H * 0.20);
  } else if (padrao === 'chevron') {
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.5, H * 0.5); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(W * 0.14, 0); ctx.lineTo(W * 0.62, H * 0.5); ctx.lineTo(W * 0.14, H); ctx.stroke();
  } else if (padrao === 'estrela') {
    ctx.save(); ctx.translate(W * 0.5, H * 0.5);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 44 : 18, a = (i * Math.PI) / 5 - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  // Trama sutil de tecido e bainha costurada
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let x = 0; x < W; x += 6) ctx.fillRect(x, 0, 1, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  // Bainha reforçada no lado do mastro
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(0, 0, 10, H);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// ---- Chuteiras 3D detalhadas (solado, 6 travas, contraforte, cano, cadarços e listras laterais) --------------------
let cleatGeos = null;
const cleatMatsCache = new Map();

function getCleatGeos() {
  if (cleatGeos) return cleatGeos;
  const g = {
    upper:   new THREE.BoxGeometry(0.242, 0.125, 0.30),
    toe:     new THREE.BoxGeometry(0.218, 0.082, 0.145),
    collar:  new THREE.BoxGeometry(0.232, 0.052, 0.185),
    heel:    new THREE.BoxGeometry(0.252, 0.128, 0.095),
    tongue:  new THREE.BoxGeometry(0.135, 0.032, 0.145),
    lace:    new THREE.BoxGeometry(0.145, 0.016, 0.022),
    stripe:  new THREE.BoxGeometry(0.016, 0.034, 0.175),
    sole:    new THREE.BoxGeometry(0.256, 0.036, 0.425),
    midsole: new THREE.BoxGeometry(0.250, 0.018, 0.395),
    stud:    new THREE.CylinderGeometry(0.015, 0.009, 0.038, 6),
  };
  for (const k in g) g[k].userData.shared = true;
  cleatGeos = g;
  return cleatGeos;
}

function getCleatMats(cfg) {
  if (cleatMatsCache.has(cfg.id)) return cleatMatsCache.get(cfg.id);
  const glowing = cfg.id === 'fogo' || cfg.id === 'relampago';
  const metallic = cfg.id === 'ouro';
  const mats = {
    upper: new THREE.MeshStandardMaterial({
      color: cfg.cor,
      roughness: metallic ? 0.26 : 0.48,
      metalness: metallic ? 0.62 : 0.12,
    }),
    detalhe: new THREE.MeshStandardMaterial({
      color: cfg.detalhe,
      roughness: 0.32,
      metalness: metallic ? 0.45 : 0.18,
      emissive: glowing ? new THREE.Color(cfg.detalhe) : new THREE.Color(0x000000),
      emissiveIntensity: glowing ? 0.48 : 0,
    }),
    heel: new THREE.MeshStandardMaterial({
      color: cfg.id === 'classica' ? '#27272a' : cfg.detalhe,
      roughness: 0.36,
      metalness: 0.35,
    }),
    sole: new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.78, metalness: 0.15 }),
    stud: new THREE.MeshStandardMaterial({ color: cfg.travas, roughness: 0.25, metalness: 0.78 }),
  };
  for (const k in mats) mats[k].userData.shared = true;
  cleatMatsCache.set(cfg.id, mats);
  return mats;
}

// Tira as chuteiras do corpo (o pé volta ao da skin). Geometrias e materiais são compartilhados: nada a liberar.
export function tirarChuteiras3D(body) {
  if (!body?._chuteiras) return;
  for (const grp of body._chuteiras) grp.parent?.remove(grp);
  body._chuteiras = null;
  body._chuteiraId = null;
}

export function aplicarChuteiras3D(body, chuteiraId = 'classica') {
  if (!body || !body.kneeL || !body.kneeR) return;
  const cfg = FUT_CHUTEIRAS.find((c) => c.id === chuteiraId) || FUT_CHUTEIRAS[0];
  if (body._chuteiraId === cfg.id && body._chuteiras?.length === 2) return;
  tirarChuteiras3D(body);
  const G = getCleatGeos();
  const M = getCleatMats(cfg);

  const makeBoot = () => {
    const g = new THREE.Group();
    g.name = 'chuteira-3d';
    const footY = -6 * SKIN_UNIT + 0.078;
    g.position.set(0, footY, -0.045);

    // Cabedal principal + biqueira aerodinâmica
    const up = new THREE.Mesh(G.upper, M.upper); up.position.set(0, 0.012, 0.01); up.castShadow = true;
    const toe = new THREE.Mesh(G.toe, M.upper); toe.position.set(0, -0.012, -0.175); toe.castShadow = true;
    // Cano esportivo (collar) + contraforte traseiro estruturado
    const collar = new THREE.Mesh(G.collar, M.detalhe); collar.position.set(0, 0.082, 0.055);
    const heel = new THREE.Mesh(G.heel, M.heel); heel.position.set(0, 0.014, 0.132);
    // Língua inclinada + 3 cadarços cruzados no peito do pé
    const tongue = new THREE.Mesh(G.tongue, M.upper); tongue.position.set(0, 0.068, -0.075); tongue.rotation.x = 0.28;
    g.add(up, toe, collar, heel, tongue);
    for (let i = 0; i < 3; i++) {
      const lc = new THREE.Mesh(G.lace, M.detalhe);
      lc.position.set(0, 0.076 - i * 0.013, -0.032 - i * 0.042);
      lc.rotation.x = 0.22;
      g.add(lc);
    }
    // Listras laterais duplas (ambos os lados)
    for (const side of [-1, 1]) {
      const s1 = new THREE.Mesh(G.stripe, M.detalhe);
      s1.position.set(side * 0.124, 0.016, -0.045);
      s1.rotation.x = -0.18;
      const s2 = new THREE.Mesh(G.stripe, M.detalhe);
      s2.position.set(side * 0.124, -0.016, -0.015);
      s2.rotation.x = -0.18;
      g.add(s1, s2);
    }
    // Entressola colorida + solado escuro + 6 travas metálicas visíveis (4 dianteiras + 2 traseiras)
    const midsole = new THREE.Mesh(G.midsole, M.detalhe); midsole.position.set(0, -0.052, -0.035);
    const sole = new THREE.Mesh(G.sole, M.sole); sole.position.set(0, -0.072, -0.035);
    g.add(midsole, sole);
    const studCoords = [
      [-0.078, -0.195], [0.078, -0.195],
      [-0.084, -0.085], [0.084, -0.085],
      [-0.076,  0.105], [0.076,  0.105],
    ];
    for (const [sx, sz] of studCoords) {
      const st = new THREE.Mesh(G.stud, M.stud);
      st.position.set(sx, -0.102, sz);
      g.add(st);
    }
    return g;
  };
  const bL = makeBoot(), bR = makeBoot();
  body.kneeL.add(bL);
  body.kneeR.add(bR);
  body._chuteiras = [bL, bR];
  body._chuteiraId = cfg.id;
}

// ---- Escolha do lado dos bancos de reservas (evitando conflito com arquibancadas) ----------------------------------
function escolherLadoBancos(campo) {
  const arqs = campo.arquibancadas || [];
  if (!arqs.length) return -1;
  const ex = campo.eixo === 'x';
  let minDistNeg = Infinity, minDistPos = Infinity;
  for (const a of arqs) {
    const coordJ = ex ? a.z : (a.x0 + a.x1) * 0.5;
    if (coordJ <= campo.ladoMin) minDistNeg = Math.min(minDistNeg, campo.ladoMin - coordJ);
    else if (coordJ >= campo.ladoMax) minDistPos = Math.min(minDistPos, coordJ - campo.ladoMax);
  }
  return minDistPos > minDistNeg ? 1 : -1;
}

// ---- Pintura HD do gramado e marcações FIFA completas (com faixas naturais, micro-textura e áreas técnicas) --------
function criarPinturaCampo(campo, altaRes = true, benchDir = -1) {
  const ex = campo.eixo === 'x';
  const comp = Math.max(8, campo.linhaB - campo.linhaA);
  const larg = Math.max(6, campo.ladoMax - campo.ladoMin);
  const apronI = 2.4; // margem verde atrás das linhas de fundo (cobre interior do gol)
  const apronJ = 2.9; // margem verde nas laterais (cobre áreas técnicas pontilhadas)
  const totalComp = comp + apronI * 2;
  const totalLarg = larg + apronJ * 2;

  const W = altaRes ? 2048 : 1024;
  const H = Math.max(512, Math.round(W * (totalLarg / totalComp)));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const pxPerM = W / totalComp;
  const pyPerM = H / totalLarg;

  const x0 = apronI * pxPerM, x1 = (apronI + comp) * pxPerM;
  const y0 = apronJ * pyPerM, y1 = (apronJ + larg) * pyPerM;
  const pitchW = x1 - x0, pitchH = y1 - y0;
  const midX = W * 0.5, midY = H * 0.5;

  // 1. Gramado de entorno (borda ligeiramente mais profunda)
  ctx.fillStyle = 'rgba(34, 96, 33, 0.94)';
  ctx.fillRect(0, 0, W, H);

  // 2. Faixas naturais de corte (número par para dividir perfeitamente na linha de meio-campo)
  const stripes = 14;
  const sw = pitchW / stripes;
  for (let i = 0; i < stripes; i++) {
    const sx = x0 + i * sw;
    const par = i % 2 === 0;
    const grad = ctx.createLinearGradient(sx, y0, sx + sw, y0);
    if (par) {
      grad.addColorStop(0, 'rgba(52, 134, 46, 0.96)');
      grad.addColorStop(0.08, 'rgba(58, 144, 50, 0.96)');
      grad.addColorStop(0.92, 'rgba(56, 141, 49, 0.96)');
      grad.addColorStop(1, 'rgba(49, 128, 44, 0.96)');
    } else {
      grad.addColorStop(0, 'rgba(42, 116, 38, 0.96)');
      grad.addColorStop(0.08, 'rgba(46, 124, 41, 0.96)');
      grad.addColorStop(0.92, 'rgba(44, 120, 40, 0.96)');
      grad.addColorStop(1, 'rgba(40, 112, 37, 0.96)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(sx, y0, sw + 0.8, pitchH);
  }
  // Faixas sutis cruzadas (efeito xadrez suave de corte profissional)
  const hStripes = 8;
  const sh = pitchH / hStripes;
  for (let j = 0; j < hStripes; j++) {
    if (j % 2 === 0) continue;
    ctx.fillStyle = 'rgba(255, 255, 210, 0.038)';
    ctx.fillRect(x0, y0 + j * sh, pitchW, sh);
  }

  // 3. Variação orgânica natural do solo / clorofila + micro-textura multi-escala de fios de grama
  const rng = makeRng(Math.round(comp * 100 + larg * 17));
  for (let i = 0; i < (altaRes ? 85 : 40); i++) {
    const bx = rng() * W, by = rng() * H, br = (0.04 + rng() * 0.09) * W;
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    const bright = rng() > 0.45;
    g.addColorStop(0, bright ? 'rgba(116, 198, 84, 0.055)' : 'rgba(20, 62, 18, 0.065)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(bx - br, by - br, br * 2, br * 2);
  }
  // Sutil desgaste natural nas pequenas áreas e marcas do pênalti
  const gaProf = Math.min(comp * 0.18, 8.5), gaLarg = Math.min(larg * 0.68, 17);
  const paProf = Math.min(comp * 0.07, 3.2), paLarg = Math.min(larg * 0.42, 10.5);
  const penDist = gaProf * 0.72;
  for (const dir of [1, -1]) {
    const gx = (dir === 1 ? x0 : x1) + dir * (paProf * 0.42) * pxPerM;
    const wg = ctx.createRadialGradient(gx, midY, 0, gx, midY, paProf * 0.9 * pxPerM);
    wg.addColorStop(0, 'rgba(132, 138, 72, 0.14)');
    wg.addColorStop(1, 'rgba(132, 138, 72, 0)');
    ctx.fillStyle = wg;
    ctx.beginPath(); ctx.ellipse(gx, midY, paProf * 0.9 * pxPerM, (paLarg * 0.34) * pyPerM, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Fios de grama orgânicos em 3 tons (luz, médio, sombra)
  const bladeN = altaRes ? 14000 : 4800;
  const tones = ['rgba(155, 224, 106, 0.11)', 'rgba(84, 168, 62, 0.11)', 'rgba(18, 56, 18, 0.12)'];
  for (let tIdx = 0; tIdx < 3; tIdx++) {
    ctx.fillStyle = tones[tIdx];
    const count = Math.floor(bladeN / 3);
    for (let i = 0; i < count; i++) {
      const gx = rng() * W, gy = rng() * H;
      const bw = 1.2 + rng() * 1.4, bh = 2.6 + rng() * 4.2;
      ctx.fillRect(gx, gy, bw, bh);
    }
  }

  // 4. Pintura nítida das linhas brancas (~13 cm reais) com leve halo de contraste
  const lw = Math.max(3, Math.round(0.13 * pxPerM));
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';

  // Sombra sutil sob a tinta branca para nitidez impecável de longe e de perto
  const drawLines = (strokeStyle, fillStyle, width) => {
    ctx.strokeStyle = strokeStyle;
    ctx.fillStyle = fillStyle;
    ctx.lineWidth = width;

    // Linhas laterais, linhas de fundo e meio-campo
    ctx.strokeRect(x0, y0, pitchW, pitchH);
    ctx.beginPath(); ctx.moveTo(midX, y0); ctx.lineTo(midX, y1); ctx.stroke();

    // Círculo central e ponto central
    const rCentro = Math.min(comp * 0.115, larg * 0.22);
    ctx.beginPath();
    ctx.ellipse(midX, midY, rCentro * pxPerM, rCentro * pyPerM, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(midX, midY, Math.max(4, width * 1.35), Math.max(4, width * 1.35 * (pyPerM / pxPerM)), 0, 0, Math.PI * 2);
    ctx.fill();

    // Grande área, pequena área, marca do pênalti e meia-lua (penalty arc) nos dois lados
    const arcR = rCentro * 0.86;
    for (const dir of [1, -1]) {
      const xBase = dir === 1 ? x0 : x1;
      const xGa = xBase + dir * gaProf * pxPerM;
      const yGa0 = midY - (gaLarg * 0.5) * pyPerM, hGa = gaLarg * pyPerM;
      ctx.strokeRect(Math.min(xBase, xGa), yGa0, Math.abs(xGa - xBase), hGa);

      const xPa = xBase + dir * paProf * pxPerM;
      const yPa0 = midY - (paLarg * 0.5) * pyPerM, hPa = paLarg * pyPerM;
      ctx.strokeRect(Math.min(xBase, xPa), yPa0, Math.abs(xPa - xBase), hPa);

      const xPen = xBase + dir * penDist * pxPerM;
      ctx.beginPath();
      ctx.ellipse(xPen, midY, Math.max(4, width * 1.3), Math.max(4, width * 1.3 * (pyPerM / pxPerM)), 0, 0, Math.PI * 2);
      ctx.fill();

      // Meia-lua (penalty arc) fiel em coordenadas reais do mundo
      const dxBox = gaProf - penDist;
      if (arcR > dxBox) {
        const ang = Math.acos(clamp(dxBox / arcR, -1, 1));
        ctx.beginPath();
        if (dir === 1) ctx.ellipse(xPen, midY, arcR * pxPerM, arcR * pyPerM, 0, -ang, ang);
        else ctx.ellipse(xPen, midY, arcR * pxPerM, arcR * pyPerM, 0, Math.PI - ang, Math.PI + ang);
        ctx.stroke();
      }
    }

    // Quartos de círculo de escanteio nos 4 cantos + marcas de distância (9,15m proporcionais) fora das linhas
    const rcM = Math.min(1.05, larg * 0.045);
    const rcX = Math.max(8, rcM * pxPerM), rcY = Math.max(8, rcM * pyPerM);
    for (const [cx, cy, a0, a1] of [
      [x0, y0, 0, Math.PI * 0.5],
      [x1, y0, Math.PI * 0.5, Math.PI],
      [x1, y1, Math.PI, Math.PI * 1.5],
      [x0, y1, Math.PI * 1.5, Math.PI * 2],
    ]) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, rcX, rcY, 0, a0, a1);
      ctx.stroke();
    }
    const tickOff = Math.min(comp * 0.14, 4.2);
    const tickLen = 0.42;
    for (const sx of [x0 + tickOff * pxPerM, x1 - tickOff * pxPerM]) {
      ctx.beginPath(); ctx.moveTo(sx, y0 - tickLen * pyPerM); ctx.lineTo(sx, y0 - 0.12 * pyPerM); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, y1 + 0.12 * pyPerM); ctx.lineTo(sx, y1 + tickLen * pyPerM); ctx.stroke();
    }
    for (const sy of [y0 + tickOff * pyPerM, y1 - tickOff * pyPerM]) {
      ctx.beginPath(); ctx.moveTo(x0 - tickLen * pxPerM, sy); ctx.lineTo(x0 - 0.12 * pxPerM, sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1 + 0.12 * pxPerM, sy); ctx.lineTo(x1 + tickLen * pxPerM, sy); ctx.stroke();
    }

    // Áreas técnicas pontilhadas na lateral dos bancos de reservas
    const techYEdge = benchDir < 0 ? y0 : y1;
    const techY0 = techYEdge + benchDir * (0.55 * pyPerM);
    const techY1 = techYEdge + benchDir * (2.05 * pyPerM);
    const techTop = Math.min(techY0, techY1);
    const techH = Math.abs(techY1 - techY0);
    const boxHalfSpan = Math.min(comp * 0.13, 5.4);
    const boxGap = Math.min(comp * 0.055, 2.2);
    ctx.save();
    ctx.setLineDash([Math.max(5, width * 2.2), Math.max(4, width * 1.6)]);
    ctx.lineWidth = Math.max(2, width * 0.78);
    for (const side of [-1, 1]) {
      const txA = midX + side * boxGap * pxPerM;
      const txB = midX + side * (boxGap + boxHalfSpan) * pxPerM;
      ctx.strokeRect(Math.min(txA, txB), techTop, Math.abs(txB - txA), techH);
    }
    ctx.restore();
  };

  drawLines('rgba(16, 46, 16, 0.35)', 'rgba(16, 46, 16, 0.35)', lw + 2);
  drawLines('rgba(248, 252, 246, 0.96)', 'rgba(248, 252, 246, 0.96)', lw);

  // 5. Suavização (feather) da borda externa da margem via destination-out (preserva 100% do interior do campo)
  ctx.globalCompositeOperation = 'destination-out';
  const fadeX = Math.max(12, Math.round(0.48 * pxPerM));
  const fadeY = Math.max(12, Math.round(0.48 * pyPerM));
  const drawEdgeOut = (gx0, gy0, gx1, gy1, rx, ry, rw, rh) => {
    const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(rx, ry, rw, rh);
  };
  drawEdgeOut(0, 0, fadeX, 0, 0, 0, fadeX, H);
  drawEdgeOut(W, 0, W - fadeX, 0, W - fadeX, 0, fadeX, H);
  drawEdgeOut(0, 0, 0, fadeY, 0, 0, W, fadeY);
  drawEdgeOut(0, H, 0, H - fadeY, 0, H - fadeY, W, fadeY);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = altaRes ? 8 : 4;
  const geo = new THREE.PlaneGeometry(totalComp, totalLarg);
  geo.rotateX(-Math.PI / 2);
  if (!ex) geo.rotateY(Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const midI = (campo.linhaA + campo.linhaB) * 0.5, midJ = (campo.ladoMin + campo.ladoMax) * 0.5;
  mesh.position.set(ex ? midI : midJ, campo.alto[0] + 0.035, ex ? midJ : midI);
  mesh.receiveShadow = true;
  mesh.name = 'campo-pintura-hd';
  return mesh;
}

// ---- Textura nítida da rede do gol (nylon trançado com nós) + malha física de onda 2D ------------------------------
function criarTexturaRede() {
  const S = 256, cells = 4, step = S / cells;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  // Sombra sutil do cordão para profundidade
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.32)';
  ctx.lineWidth = 7.5;
  for (let i = 0; i <= cells; i++) {
    const p = i * step;
    ctx.beginPath(); ctx.moveTo(p + 1.5, 0); ctx.lineTo(p + 1.5, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p + 1.5); ctx.lineTo(S, p + 1.5); ctx.stroke();
  }
  // Cordão principal branco-nylon nítido
  ctx.strokeStyle = 'rgba(246, 250, 255, 0.96)';
  ctx.lineWidth = 5.0;
  for (let i = 0; i <= cells; i++) {
    const p = i * step;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  // Brilho interno do fio + nós reforçados nas interseções
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1.8;
  for (let i = 0; i <= cells; i++) {
    const p = i * step - 0.8;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
  for (let iy = 0; iy <= cells; iy++) for (let ix = 0; ix <= cells; ix++) {
    ctx.beginPath();
    ctx.arc(ix * step, iy * step, 3.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  return tex;
}

// Painel de rede física 2D (tecido com acoplamento entre vizinhos, UV escalada diretamente para compartilhar 1 textura GPU)
function criarPainelRede(w, h, segW, segH, pos, rotY, rotX, repU, repV, netMat, fixBottom = true, fixTop = true, fixLeft = true, fixRight = true) {
  const geo = new THREE.PlaneGeometry(w, h, segW, segH);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repU, uv.getY(i) * repV);
  uv.needsUpdate = true;

  const mesh = new THREE.Mesh(geo, netMat);
  mesh.position.set(pos[0], pos[1], pos[2]);
  mesh.rotation.order = 'YXZ';
  mesh.rotation.y = rotY;
  mesh.rotation.x = rotX;
  mesh.updateMatrixWorld(true);

  const gp = geo.attributes.position;
  const n = gp.count;
  const cols = segW + 1, rows = segH + 1;
  const rest = new Float32Array(n * 3);
  const disp = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const pinned = new Uint8Array(n);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const idx = r * cols + c;
    rest[idx * 3] = gp.getX(idx);
    rest[idx * 3 + 1] = gp.getY(idx);
    rest[idx * 3 + 2] = gp.getZ(idx);
    if ((fixTop && r === 0) || (fixBottom && r === rows - 1) || (fixLeft && c === 0) || (fixRight && c === cols - 1)) {
      pinned[idx] = 1;
    }
  }
  return {
    mesh, geo, rest, disp, vel, pinned, cols, rows,
    halfW: w * 0.5, halfH: h * 0.5,
    ativo: false,
    invMat: new THREE.Matrix4(),
    localPt: new THREE.Vector3(),
    localVel: new THREE.Vector3(),
  };
}

function criarGol3D(campo, lado, castShadow, netMat) {
  const ex = campo.eixo === 'x';
  const dirFora = lado === 'A' ? -1 : 1;
  const linha = lado === 'A' ? campo.linhaA : campo.linhaB;
  const y0 = campo.alto[0], y1 = campo.alto[1];
  const alt = Math.max(2, y1 - y0), larg = Math.max(3, campo.abre[1] - campo.abre[0]);
  const midJ = (campo.abre[0] + campo.abre[1]) * 0.5;
  const prof = 2.15;

  const grp = new THREE.Group();
  grp.name = `gol-3d-${lado}`;
  // Origem na boca do gol: +Z para o fundo da rede, +X ao longo da largura
  grp.position.set(ex ? linha : midJ, y0, ex ? midJ : linha);
  grp.rotation.y = ex ? (dirFora > 0 ? Math.PI / 2 : -Math.PI / 2) : (dirFora > 0 ? 0 : Math.PI);

  const postMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.24, metalness: 0.38 });
  const steelMat = new THREE.MeshStandardMaterial({ color: '#cbd5e1', roughness: 0.38, metalness: 0.72 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.52, metalness: 0.65 });
  const cableMat = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.45, metalness: 0.75 });

  const rPost = 0.088;
  const postGeo = new THREE.CylinderGeometry(rPost, rPost, alt, 16);
  const barGeo = new THREE.CylinderGeometry(rPost, rPost, larg, 16); barGeo.rotateZ(Math.PI / 2);
  const elbowGeo = new THREE.SphereGeometry(rPost * 1.04, 12, 10);
  const collarGeo = new THREE.CylinderGeometry(rPost * 1.38, rPost * 1.48, 0.12, 14);
  const supGeo = new THREE.CylinderGeometry(0.048, 0.048, prof, 10); supGeo.rotateX(Math.PI / 2);
  const backGeo = new THREE.CylinderGeometry(0.048, 0.048, larg, 10); backGeo.rotateZ(Math.PI / 2);
  const backPostGeo = new THREE.CylinderGeometry(0.046, 0.052, alt, 10);

  // Hastes traseiras externas de tensionamento (estilo estádio FIFA com esticadores!)
  const stanchionZ = prof + 0.32;
  const stanchionH = alt + 0.22;
  const stanchionGeo = new THREE.CylinderGeometry(0.042, 0.058, stanchionH, 10);
  const tensionRodGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.36, 8); tensionRodGeo.rotateX(Math.PI / 2);
  const diagDy = Math.max(0.5, alt - 0.12);
  const diagLen = Math.hypot(prof, diagDy);
  const diagGeo = new THREE.CylinderGeometry(0.032, 0.032, diagLen, 8);
  const clipGeo = new THREE.TorusGeometry(rPost * 1.08, 0.012, 6, 10);

  for (const s of [-1, 1]) {
    const sx = s * larg * 0.5;
    // Traves frontais + cotovelos arredondados + soquete metálico na base
    const p = new THREE.Mesh(postGeo, postMat); p.position.set(sx, alt * 0.5, 0); p.castShadow = castShadow; grp.add(p);
    const elb = new THREE.Mesh(elbowGeo, postMat); elb.position.set(sx, alt, 0); grp.add(elb);
    const col = new THREE.Mesh(collarGeo, darkMat); col.position.set(sx, 0.06, 0); grp.add(col);

    // Armação metálica traseira (superior, inferior e coluna de fundo)
    const bp = new THREE.Mesh(backPostGeo, steelMat); bp.position.set(sx, alt * 0.5, prof); grp.add(bp);
    const stTop = new THREE.Mesh(supGeo, steelMat); stTop.position.set(sx, alt, prof * 0.5); grp.add(stTop);
    const stBot = new THREE.Mesh(supGeo, darkMat); stBot.position.set(sx, 0.05, prof * 0.5); grp.add(stBot);

    // Haste diagonal de reforço lateral (D-strut) ligando base da trave ao topo traseiro
    const diag = new THREE.Mesh(diagGeo, steelMat);
    diag.position.set(sx, (alt + 0.12) * 0.5, prof * 0.5);
    diag.rotation.x = Math.atan2(prof, diagDy);
    grp.add(diag);

    // Mastro traseiro de esticamento da rede + cabos esticadores (topo, meio e base)
    const stPole = new THREE.Mesh(stanchionGeo, darkMat);
    stPole.position.set(sx * 1.03, stanchionH * 0.5, stanchionZ);
    stPole.rotation.x = -0.05;
    grp.add(stPole);
    const stBase = new THREE.Mesh(collarGeo, darkMat); stBase.position.set(sx * 1.03, 0.06, stanchionZ); grp.add(stBase);
    for (const ty of [alt, alt * 0.52, 0.14]) {
      const rod = new THREE.Mesh(tensionRodGeo, cableMat);
      rod.position.set(sx * 1.015, ty, prof + 0.16);
      grp.add(rod);
    }
  }
  const bar = new THREE.Mesh(barGeo, postMat); bar.position.set(0, alt, 0); bar.castShadow = castShadow; grp.add(bar);
  const backTop = new THREE.Mesh(backGeo, steelMat); backTop.position.set(0, alt, prof); grp.add(backTop);
  const backBot = new THREE.Mesh(backGeo, darkMat); backBot.position.set(0, 0.05, prof); grp.add(backBot);

  // Haste central de sustentação traseira (mantém o teto e fundo da rede perfeitamente esticados)
  const midBackPost = new THREE.Mesh(stanchionGeo, darkMat);
  midBackPost.position.set(0, stanchionH * 0.5, stanchionZ);
  midBackPost.rotation.x = -0.05;
  grp.add(midBackPost);
  for (const ty of [alt, alt * 0.55, 0.14]) {
    const rod = new THREE.Mesh(tensionRodGeo, cableMat);
    rod.position.set(0, ty, prof + 0.16);
    grp.add(rod);
  }
  // Presilhas de fixação da rede no travessão
  const clipCount = Math.max(4, Math.round(larg * 1.4));
  for (let i = 1; i < clipCount; i++) {
    const cx = -larg * 0.5 + (i / clipCount) * larg;
    const cl = new THREE.Mesh(clipGeo, darkMat);
    cl.position.set(cx, alt, 0);
    cl.rotation.y = Math.PI / 2;
    grp.add(cl);
  }

  // 4 painéis de rede deformáveis com alta densidade para propagação fluida de ondas 2D
  const repX = Math.max(4, Math.round(larg * 1.9));
  const repY = Math.max(3, Math.round(alt * 1.9));
  const repZ = Math.max(2, Math.round(prof * 1.9));
  const redes = [
    criarPainelRede(larg, alt, 16, 10, [0, alt * 0.5, prof], 0, 0, repX, repY, netMat, true, true, true, true),
    criarPainelRede(prof, alt, 7, 10, [-larg * 0.5, alt * 0.5, prof * 0.5], Math.PI / 2, 0, repZ, repY, netMat, true, true, true, true),
    criarPainelRede(prof, alt, 7, 10, [larg * 0.5, alt * 0.5, prof * 0.5], -Math.PI / 2, 0, repZ, repY, netMat, true, true, true, true),
    criarPainelRede(larg, prof, 16, 7, [0, alt, prof * 0.5], 0, Math.PI / 2, repX, repZ, netMat, true, true, true, true),
  ];
  for (const r of redes) grp.add(r.mesh);
  return { grp, redes };
}

// ---- Texturas procedurais para halos e cones volumétricos dos refletores (descartadas com o estádio) ---------------
function criarTexturaHaloRefletor() {
  const S = 128, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S * 0.5, S * 0.5, 0, S * 0.5, S * 0.5, S * 0.5);
  g.addColorStop(0.0, 'rgba(255, 253, 240, 1.0)');
  g.addColorStop(0.22, 'rgba(255, 246, 214, 0.72)');
  g.addColorStop(0.55, 'rgba(255, 232, 178, 0.22)');
  g.addColorStop(1.0, 'rgba(255, 224, 160, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function criarTexturaConeVolumetrico() {
  const W = 128, H = 256, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  // Gradiente suave do topo (próximo aos LEDs, y=0) até o gramado (y=H)
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, 'rgba(255, 250, 232, 0.78)');
  g.addColorStop(0.18, 'rgba(255, 244, 212, 0.42)');
  g.addColorStop(0.58, 'rgba(255, 238, 196, 0.14)');
  g.addColorStop(1.0, 'rgba(255, 232, 180, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Raios verticais sutis simulando múltiplos focos do banco de LEDs
  for (let i = 0; i < 8; i++) {
    const x = ((i + 0.5) / 8) * W;
    const rg = ctx.createLinearGradient(x - 10, 0, x + 10, 0);
    rg.addColorStop(0, 'rgba(255,255,255,0)');
    rg.addColorStop(0.5, 'rgba(255,255,245,0.14)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - 10, 0, 20, H * 0.85);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

function mergeTranslatedGeos(baseGeo, offsets) {
  const pos = baseGeo.attributes.position.array, norm = baseGeo.attributes.normal.array, uv = baseGeo.attributes.uv.array;
  const idx = baseGeo.index.array, vCount = baseGeo.attributes.position.count, iCount = idx.length, n = offsets.length;
  const outPos = new Float32Array(vCount * 3 * n), outNorm = new Float32Array(vCount * 3 * n), outUv = new Float32Array(vCount * 2 * n);
  const outIdx = new Uint16Array(iCount * n);
  for (let k = 0; k < n; k++) {
    const [ox, oy, oz] = offsets[k], vOff = k * vCount, pOff = vOff * 3, uOff = vOff * 2, iOff = k * iCount;
    for (let i = 0; i < vCount * 3; i += 3) {
      outPos[pOff + i] = pos[i] + ox; outPos[pOff + i + 1] = pos[i + 1] + oy; outPos[pOff + i + 2] = pos[i + 2] + oz;
    }
    outNorm.set(norm, pOff); outUv.set(uv, uOff);
    for (let i = 0; i < iCount; i++) outIdx[iOff + i] = idx[i] + vOff;
  }
  baseGeo.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(outNorm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(outUv, 2));
  g.setIndex(new THREE.BufferAttribute(outIdx, 1));
  return g;
}

// ---- Torres de refletores com treliças diagonais, banco de LEDs 3×6 e cones/halos volumétricos aditivos -----------
function criarRefletores(campo, pcMode) {
  const ex = campo.eixo === 'x';
  const x0 = (ex ? campo.linhaA : campo.ladoMin) - 3.6, x1 = (ex ? campo.linhaB : campo.ladoMax) + 3.6;
  const z0 = (ex ? campo.ladoMin : campo.linhaA) - 3.6, z1 = (ex ? campo.ladoMax : campo.linhaB) + 3.6;
  const y0 = campo.alto[0], cx = campo.centro[0], cz = campo.centro[2];
  const grp = new THREE.Group(); grp.name = 'refletores-3d';

  const steelMat = new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.48, metalness: 0.72 });
  const concreteMat = new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.88, metalness: 0.05 });
  const headMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.42, metalness: 0.6 });
  const lampMat = new THREE.MeshStandardMaterial({
    color: '#fffef2', emissive: '#fff4cf', emissiveIntensity: 0.35, roughness: 0.16, metalness: 0.1,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: '#ef4444', emissive: '#ff2424', emissiveIntensity: 0.4, roughness: 0.2,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    map: criarTexturaHaloRefletor(),
    color: '#fff6da',
    transparent: true,
    opacity: 0.04,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const coneMat = new THREE.MeshBasicMaterial({
    map: criarTexturaConeVolumetrico(),
    color: '#fff5d6',
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const H = 14.8;
  const bays = 6;
  const rBot = 0.46, rTop = 0.22;
  const pedGeo = new THREE.BoxGeometry(1.35, 0.85, 1.35);
  const strutGeo = new THREE.CylinderGeometry(1, 1, 1, 6); // escalado por instância em InstancedMesh
  const bankGeo = new THREE.BoxGeometry(3.2, 1.48, 0.36);
  const finsGeo = mergeTranslatedGeos(new THREE.BoxGeometry(3.05, 0.14, 0.18), [[0, -0.42, -0.22], [0, 0, -0.22], [0, 0.42, -0.22]]);
  const ledOffsets = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) ledOffsets.push([(c - 2.5) * 0.49, (r - 1) * 0.44, 0.19]);
  const ledsGeo = mergeTranslatedGeos(new THREE.PlaneGeometry(0.42, 0.34), ledOffsets);
  const catwalkGeo = new THREE.BoxGeometry(2.6, 0.1, 0.75);
  const beaconGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const haloGeo = new THREE.PlaneGeometry(5.6, 3.6);
  const coneLen = 22.0;
  const coneGeo = new THREE.ConeGeometry(6.8, coneLen, 20, 1, true);
  coneGeo.rotateX(-Math.PI / 2);
  coneGeo.translate(0, 0, coneLen * 0.5);

  const cantos = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]];
  // Acumula matrizes de todas as barras da treliça (4 torres) num único InstancedMesh para 60fps
  const strutMatrices = [];
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), mid = new THREE.Vector3(), diff = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
  const pushStrut = (ax, ay, az, bx, by, bz, radius) => {
    pA.set(ax, ay, az); pB.set(bx, by, bz);
    diff.subVectors(pB, pA);
    const len = diff.length();
    if (len < 1e-4) return;
    mid.addVectors(pA, pB).multiplyScalar(0.5);
    quat.setFromUnitVectors(upAxis, diff.divideScalar(len));
    scale.set(radius, len, radius);
    strutMatrices.push(new THREE.Matrix4().compose(mid, quat, scale));
  };

  const lights = [];
  const cones = [];
  const halos = [];
  const cornersSign = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

  cantos.forEach(([tx, tz], idx) => {
    // Base de concreto
    const ped = new THREE.Mesh(pedGeo, concreteMat);
    ped.position.set(tx, y0 + 0.425, tz);
    ped.castShadow = pcMode;
    ped.receiveShadow = true;
    grp.add(ped);

    // 4 montantes principais inclinados (pirâmide truncada metálica)
    const yBase = y0 + 0.8;
    const yTop = y0 + H;
    for (const [sx, sz] of cornersSign) {
      pushStrut(tx + sx * rBot, yBase, tz + sz * rBot, tx + sx * rTop, yTop, tz + sz * rTop, 0.058);
    }
    // Anéis horizontais + treliças diagonais em X em cada vão
    for (let b = 0; b < bays; b++) {
      const f0 = b / bays, f1 = (b + 1) / bays;
      const ya = yBase + (yTop - yBase) * f0, yb = yBase + (yTop - yBase) * f1;
      const ra = rBot + (rTop - rBot) * f0, rb = rBot + (rTop - rBot) * f1;
      for (let side = 0; side < 4; side++) {
        const [sx0, sz0] = cornersSign[side];
        const [sx1, sz1] = cornersSign[(side + 1) % 4];
        // Travessa horizontal no topo do vão
        pushStrut(tx + sx0 * rb, yb, tz + sz0 * rb, tx + sx1 * rb, yb, tz + sz1 * rb, 0.032);
        // Treliça diagonal em X (dupla no PC, alternada no mobile para ultra leveza)
        pushStrut(tx + sx0 * ra, ya, tz + sz0 * ra, tx + sx1 * rb, yb, tz + sz1 * rb, 0.025);
        if (pcMode) {
          pushStrut(tx + sx1 * ra, ya, tz + sz1 * ra, tx + sx0 * rb, yb, tz + sz0 * rb, 0.025);
        }
      }
    }

    // Cabeça do refletor apontada ao centro do gramado
    const top = new THREE.Group();
    top.position.set(tx, yTop, tz);
    top.rotation.y = Math.atan2(cx - tx, cz - tz);

    const catwalk = new THREE.Mesh(catwalkGeo, steelMat);
    catwalk.position.set(0, -0.1, -0.18);
    top.add(catwalk);

    const bank = new THREE.Group();
    bank.position.set(0, 0.65, 0.16);
    bank.rotation.x = 0.52;
    const housing = new THREE.Mesh(bankGeo, headMat);
    housing.castShadow = pcMode;
    // Aletas traseiras de dissipação + matriz 3×6 de módulos LED fundidas em 2 malhas compartilhadas
    bank.add(housing, new THREE.Mesh(finsGeo, steelMat), new THREE.Mesh(ledsGeo, lampMat));
    // Halo luminoso aditivo frontal + cone volumétrico descendo até o campo
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.set(0, 0, 0.24);
    bank.add(halo);
    halos.push(halo);

    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.set(0, 0, 0.16);
    cone.visible = false;
    bank.add(cone);
    cones.push(cone);

    top.add(bank);

    // Sinalizador vermelho de topo (pisca à noite)
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.set(0, 1.56, 0);
    top.add(beacon);

    grp.add(top);

    // Luzes reais de estádio: 4 no PC, 2 diagonais em mobile/VR
    if (pcMode || idx === 0 || idx === 3) {
      const pl = new THREE.PointLight(0xfff4db, 0, 72, 1.22);
      pl.position.set(tx + (cx - tx) * 0.14, yTop - 0.8, tz + (cz - tz) * 0.14);
      grp.add(pl);
      lights.push(pl);
    }
  });

  // 1 único InstancedMesh para todas as barras de treliça das 4 torres!
  const trussInst = new THREE.InstancedMesh(strutGeo, steelMat, strutMatrices.length);
  for (let i = 0; i < strutMatrices.length; i++) trussInst.setMatrixAt(i, strutMatrices[i]);
  trussInst.instanceMatrix.needsUpdate = true;
  trussInst.castShadow = pcMode;
  trussInst.name = 'refletores-trelica-instanced';
  grp.add(trussInst);

  return { grp, lights, lampMat, beaconMat, haloMat, coneMat, cones, halos, pcMode };
}

// ---- Bancos de reservas (dugouts cobertos com cobertura translúcida e cadeiras dos times) --------------------------
function criarBancosReservas(campo, custom, benchDir = -1, pcMode = true) {
  const ex = campo.eixo === 'x';
  const comp = campo.linhaB - campo.linhaA;
  const midI = (campo.linhaA + campo.linhaB) * 0.5;
  const edgeJ = benchDir < 0 ? campo.ladoMin : campo.ladoMax;
  const jPos = edgeJ + benchDir * 2.55;
  const y0 = campo.alto[0];

  const grp = new THREE.Group();
  grp.name = 'bancos-reservas-3d';

  const w = Math.min(5.2, Math.max(3.6, comp * 0.125));
  const h = 2.15, d = 1.28;

  const plinthMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.85, metalness: 0.1 });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.42, metalness: 0.72 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: '#dbeafe', roughness: 0.14, metalness: 0.2, transparent: true, opacity: 0.36, side: THREE.DoubleSide,
  });

  const plinthGeo = new THREE.BoxGeometry(w + 0.2, 0.14, d + 0.14);
  const backPostGeo = new THREE.BoxGeometry(0.08, h - 0.1, 0.08);
  const roofRibGeo = new THREE.BoxGeometry(0.07, 0.07, d + 0.16);
  const topBeamGeo = new THREE.BoxGeometry(w, 0.08, 0.08);
  const backGlassGeo = new THREE.PlaneGeometry(w - 0.08, h - 0.34);
  const sideGlassGeo = new THREE.PlaneGeometry(d - 0.08, h - 0.34);
  const roofGeo = new THREE.PlaneGeometry(w + 0.1, d + 0.24);
  const fasciaGeo = new THREE.BoxGeometry(w + 0.12, 0.2, 0.06);
  const seatBaseGeo = new THREE.BoxGeometry(0.54, 0.1, 0.48);
  const seatBackGeo = new THREE.BoxGeometry(0.52, 0.66, 0.09);
  const seatAccentGeo = new THREE.BoxGeometry(0.18, 0.56, 0.105);
  const seatLegGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.36, 8);

  const offsetI = Math.min(comp * 0.105, 4.9);
  const rotY = ex ? (benchDir < 0 ? 0 : Math.PI) : (benchDir < 0 ? Math.PI / 2 : -Math.PI / 2);

  for (let side = 0; side < 2; side++) {
    const tCfg = custom.times[side];
    const teamMat = new THREE.MeshStandardMaterial({ color: tCfg.cor, roughness: 0.45, metalness: 0.15 });
    const accentMat = new THREE.MeshStandardMaterial({ color: tCfg.cor2, roughness: 0.4, metalness: 0.2 });

    const dug = new THREE.Group();
    const posI = midI + (side === 0 ? -offsetI : offsetI);
    dug.position.set(ex ? posI : jPos, y0, ex ? jPos : posI);
    dug.rotation.y = rotY;

    // Base elevada
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.set(0, 0.07, 0);
    plinth.receiveShadow = true;
    dug.add(plinth);

    // Colunas traseiras + costelas do teto
    const ribXs = [-w * 0.48, -w * 0.16, w * 0.16, w * 0.48];
    for (const rx of ribXs) {
      const bp = new THREE.Mesh(backPostGeo, frameMat);
      bp.position.set(rx, h * 0.5, -d * 0.46);
      bp.castShadow = pcMode;
      dug.add(bp);
      const rib = new THREE.Mesh(roofRibGeo, frameMat);
      rib.position.set(rx, h - 0.05, 0.02);
      rib.rotation.x = -0.14;
      dug.add(rib);
    }
    const rearBeam = new THREE.Mesh(topBeamGeo, frameMat); rearBeam.position.set(0, h - 0.14, -d * 0.46); dug.add(rearBeam);
    const frontBeam = new THREE.Mesh(topBeamGeo, frameMat); frontBeam.position.set(0, h + 0.04, d * 0.48); dug.add(frontBeam);

    // Fechamento translúcido de policarbonato (fundo, laterais e cobertura inclinada)
    const backGlass = new THREE.Mesh(backGlassGeo, glassMat);
    backGlass.position.set(0, h * 0.5, -d * 0.46);
    dug.add(backGlass);
    for (const sx of [-1, 1]) {
      const sg = new THREE.Mesh(sideGlassGeo, glassMat);
      sg.position.set(sx * (w * 0.49), h * 0.5, 0);
      sg.rotation.y = Math.PI / 2;
      dug.add(sg);
    }
    const roof = new THREE.Mesh(roofGeo, glassMat);
    roof.position.set(0, h - 0.02, 0.02);
    roof.rotation.x = -Math.PI / 2 - 0.14;
    dug.add(roof);

    // Faixa superior frontal com cor do time
    const fascia = new THREE.Mesh(fasciaGeo, teamMat);
    fascia.position.set(0, h + 0.04, d * 0.52);
    dug.add(fascia);

    // 4 poltronas esportivas de banco de reservas
    const seatN = 4;
    for (let i = 0; i < seatN; i++) {
      const sx = ((i / (seatN - 1)) - 0.5) * (w - 1.15);
      const leg = new THREE.Mesh(seatLegGeo, frameMat); leg.position.set(sx, 0.30, -0.1); dug.add(leg);
      const sb = new THREE.Mesh(seatBaseGeo, teamMat); sb.position.set(sx, 0.49, -0.02); dug.add(sb);
      const bk = new THREE.Mesh(seatBackGeo, teamMat); bk.position.set(sx, 0.84, -0.24); bk.rotation.x = -0.14; dug.add(bk);
      const ac = new THREE.Mesh(seatAccentGeo, accentMat); ac.position.set(sx, 0.85, -0.24); ac.rotation.x = -0.14; dug.add(ac);
    }
    grp.add(dug);
  }
  return grp;
}

// ---- Placas perimetrais LED refletindo cores e nomes personalizados dos dois times do GM ---------------------------
function texturaPlacaLED(custom) {
  const t0 = custom.times[0], t1 = custom.times[1];
  const W = 1024, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Fundo LED escuro de alto contraste
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, W, H);

  // Metade esquerda (Time A) e metade direita (Time B) com faixas diagonais vibrantes
  const drawHalf = (xOff, team, opp) => {
    const g = ctx.createLinearGradient(xOff, 0, xOff + W * 0.5, 0);
    g.addColorStop(0.0, team.cor);
    g.addColorStop(0.75, team.cor);
    g.addColorStop(1.0, '#090e1a');
    ctx.fillStyle = g;
    ctx.fillRect(xOff, 10, W * 0.5, H - 20);

    // Barras superior e inferior na cor secundária
    ctx.fillStyle = team.cor2;
    ctx.fillRect(xOff, 0, W * 0.5, 10);
    ctx.fillRect(xOff, H - 10, W * 0.5, 10);

    // Divisores chevron estilizados
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    for (let k = 0; k < 2; k++) {
      const cx = xOff + 28 + k * 24;
      ctx.beginPath();
      ctx.moveTo(cx, 12); ctx.lineTo(cx + 12, 12);
      ctx.lineTo(cx + 26, H * 0.5); ctx.lineTo(cx + 12, H - 12);
      ctx.lineTo(cx, H - 12); ctx.lineTo(cx + 14, H * 0.5);
      ctx.closePath(); ctx.fill();
    }

    // Nome personalizado do time em tipografia esportiva de estádio
    const label = `${String(team.nome || 'TIME').toUpperCase()}  ★  ARENA KRAFT`;
    ctx.font = '900 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.78)';
    ctx.strokeText(label, xOff + W * 0.27, H * 0.53, W * 0.42);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, xOff + W * 0.27, H * 0.53, W * 0.42);

    // Pequeno detalhe luminoso na cor do adversário na transição
    ctx.fillStyle = opp.cor2;
    ctx.fillRect(xOff + W * 0.5 - 6, 12, 6, H - 24);
  };
  drawHalf(0, t0, t1);
  drawHalf(W * 0.5, t1, t0);

  // Grade sutil de pontos LED (dot-matrix)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  for (let x = 0; x < W; x += 6) ctx.fillRect(x, 0, 1, H);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function criarPlacasLED(campo, custom, benchDir = -1) {
  const ex = campo.eixo === 'x';
  const comp = campo.linhaB - campo.linhaA;
  const midI = (campo.linhaA + campo.linhaB) * 0.5;
  const y0 = campo.alto[0];
  const boardH = 0.86, boardD = 0.14;

  const grp = new THREE.Group();
  grp.name = 'placas-led-3d';

  const ledTex = texturaPlacaLED(custom);
  const ledMat = new THREE.MeshStandardMaterial({
    map: ledTex,
    emissive: new THREE.Color('#ffffff'),
    emissiveMap: ledTex,
    emissiveIntensity: 0.55,
    roughness: 0.35,
    metalness: 0.1,
  });
  const backMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.65, metalness: 0.5 });

  // Cria uma placa de comprimento `len` virada para local +Z
  const addBoard = (len, iCenter, jCenter, rotY) => {
    if (len < 1.6) return;
    const g = new THREE.Group();
    g.position.set(ex ? iCenter : jCenter, y0 + boardH * 0.5, ex ? jCenter : iCenter);
    g.rotation.y = rotY;

    const frame = new THREE.Mesh(new THREE.BoxGeometry(len, boardH, boardD), backMat);
    frame.rotation.x = -0.08;
    g.add(frame);

    const screenGeo = new THREE.PlaneGeometry(len - 0.08, boardH - 0.08);
    const repU = Math.max(0.5, len / 10.5);
    const uv = screenGeo.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * repU);
    uv.needsUpdate = true;

    const screen = new THREE.Mesh(screenGeo, ledMat);
    screen.position.set(0, 0.004, boardD * 0.5 + 0.01);
    screen.rotation.x = -0.08;
    g.add(screen);
    grp.add(g);
  };

  // 1. Lateral oposta aos bancos: placa contínua ao longo do campo
  const oppDir = -benchDir;
  const oppJ = (oppDir < 0 ? campo.ladoMin : campo.ladoMax) + oppDir * 1.85;
  const rotOpp = ex ? (oppDir < 0 ? 0 : Math.PI) : (oppDir < 0 ? Math.PI / 2 : -Math.PI / 2);
  addBoard(comp - 2.2, midI, oppJ, rotOpp);

  // 2. Lateral dos bancos: duas alas à esquerda e à direita das áreas técnicas
  const benchJ = (benchDir < 0 ? campo.ladoMin : campo.ladoMax) + benchDir * 1.85;
  const rotBench = ex ? (benchDir < 0 ? 0 : Math.PI) : (benchDir < 0 ? Math.PI / 2 : -Math.PI / 2);
  const gapHalf = Math.min(comp * 0.22, 8.6);
  const wingLen = Math.max(0, (comp * 0.5) - gapHalf - 1.1);
  if (wingLen >= 2.0) {
    addBoard(wingLen, campo.linhaA + 1.1 + wingLen * 0.5, benchJ, rotBench);
    addBoard(wingLen, campo.linhaB - 1.1 - wingLen * 0.5, benchJ, rotBench);
  }

  // 3. Fundo dos gols (flanqueando as traves, sem obstruir a rede)
  const wingJA0 = campo.ladoMin + 1.2, wingJA1 = campo.abre[0] - 1.3;
  const wingJB0 = campo.abre[1] + 1.3, wingJB1 = campo.ladoMax - 1.2;
  for (const [iLine, dirIn] of [[campo.linhaA - 2.65, 1], [campo.linhaB + 2.65, -1]]) {
    const rotEnd = ex ? (dirIn > 0 ? Math.PI / 2 : -Math.PI / 2) : (dirIn > 0 ? 0 : Math.PI);
    if (wingJA1 - wingJA0 >= 1.8) addBoard(wingJA1 - wingJA0, iLine, (wingJA0 + wingJA1) * 0.5, rotEnd);
    if (wingJB1 - wingJB0 >= 1.8) addBoard(wingJB1 - wingJB0, iLine, (wingJB0 + wingJB1) * 0.5, rotEnd);
  }

  return { grp, ledTex, ledMat };
}

// ---- Bandeiras de escanteio e bandeirões multi-segmento (ondulação natural ao vento) -------------------------------
function criarBandeiras(campo, custom) {
  const ex = campo.eixo === 'x';
  const x0 = ex ? campo.linhaA : campo.ladoMin, x1 = ex ? campo.linhaB : campo.ladoMax;
  const z0 = ex ? campo.ladoMin : campo.linhaA, z1 = ex ? campo.ladoMax : campo.linhaB;
  const y0 = campo.alto[0];
  const grp = new THREE.Group(); grp.name = 'bandeiras-3d';

  const poleMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.35, metalness: 0.2 });
  const finialMat = new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.25, metalness: 0.7 });
  const baseMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.6, metalness: 0.5 });

  const cPole = new THREE.CylinderGeometry(0.024, 0.032, 1.65, 8);
  const cFinial = new THREE.SphereGeometry(0.048, 8, 6);
  const cFlagTemplate = new THREE.PlaneGeometry(0.62, 0.38, 10, 4);
  cFlagTemplate.translate(0.31, 0, 0);

  const panos = [];
  const t0 = custom.times[0], t1 = custom.times[1];
  const tex0 = texturaBandeira(t0.cor, t0.cor2, t0.bandeira);
  const tex1 = texturaBandeira(t1.cor, t1.cor2, t1.bandeira);
  const mat0 = new THREE.MeshLambertMaterial({ map: tex0, side: THREE.DoubleSide });
  const mat1 = new THREE.MeshLambertMaterial({ map: tex1, side: THREE.DoubleSide });

  // 4 bandeirinhas de escanteio com topo dourado
  const cantos = [
    [x0, z0, ex ? mat0 : mat0], [x0, z1, ex ? mat0 : mat1],
    [x1, z0, ex ? mat1 : mat0], [x1, z1, ex ? mat1 : mat1],
  ];
  for (const [fx, fz, mat] of cantos) {
    const pole = new THREE.Mesh(cPole, poleMat); pole.position.set(fx, y0 + 0.825, fz); grp.add(pole);
    const fin = new THREE.Mesh(cFinial, finialMat); fin.position.set(fx, y0 + 1.66, fz); grp.add(fin);
    const geo = cFlagTemplate.clone();
    const flag = new THREE.Mesh(geo, mat);
    flag.position.set(fx, y0 + 1.44, fz);
    grp.add(flag);
    panos.push({ geo, base: new Float32Array(geo.attributes.position.array), span: 0.62, ampMax: 0.12, fase: fx * 0.4 + fz * 0.3 });
  }
  cFlagTemplate.dispose();

  // 2 bandeirões gigantes de torcida (fora da zona dos bancos de reservas!)
  const midI = (campo.linhaA + campo.linhaB) * 0.5;
  const bigOff = Math.min(9.2, Math.max(4.5, (campo.linhaB - campo.linhaA) * 0.2));
  const bigPoleGeo = new THREE.CylinderGeometry(0.055, 0.085, 6.8, 10);
  const bigPedGeo = new THREE.CylinderGeometry(0.24, 0.3, 0.35, 10);
  const bigFinGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const bigFlagTemplate = new THREE.PlaneGeometry(3.2, 1.88, 16, 6);
  bigFlagTemplate.translate(1.6, 0, 0);

  const banners = [
    [ex ? midI - bigOff : campo.ladoMin - 3.6, ex ? campo.ladoMin - 3.6 : midI - bigOff, mat0],
    [ex ? midI + bigOff : campo.ladoMax + 3.6, ex ? campo.ladoMax + 3.6 : midI + bigOff, mat1],
  ];
  for (const [bx, bz, mat] of banners) {
    const ped = new THREE.Mesh(bigPedGeo, baseMat); ped.position.set(bx, y0 + 0.175, bz); grp.add(ped);
    const pole = new THREE.Mesh(bigPoleGeo, poleMat); pole.position.set(bx, y0 + 3.4, bz); grp.add(pole);
    const fin = new THREE.Mesh(bigFinGeo, finialMat); fin.position.set(bx, y0 + 6.84, bz); grp.add(fin);
    const geo = bigFlagTemplate.clone();
    const flag = new THREE.Mesh(geo, mat);
    flag.position.set(bx, y0 + 5.75, bz);
    grp.add(flag);
    panos.push({ geo, base: new Float32Array(geo.attributes.position.array), span: 3.2, ampMax: 0.34, fase: bx * 0.25 + bz * 0.25 });
  }
  bigFlagTemplate.dispose();

  return { grp, panos };
}

// ---- Arquibancadas 3D instanciadas de alto acabamento (mantendo assentoPerto() exato!) -----------------------------
function criarArquibancadas3D(campo, custom, pcMode = true) {
  const grp = new THREE.Group(); grp.name = 'arquibancadas-3d';
  const assentos = [];
  const arqs = campo.arquibancadas || [];
  if (!arqs.length) return { grp, assentos };

  // Contagem prévia para alocar InstancedMeshes com tamanho exato
  let totalSeats = 0;
  for (const a of arqs) totalSeats += Math.max(0, Math.floor(a.x1) - Math.floor(a.x0) + 1);
  if (!totalSeats) return { grp, assentos };

  const seatMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.46, metalness: 0.08 });
  const frameMat = new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.56, metalness: 0.55 });
  const concreteMat = new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.88, metalness: 0.05 });

  const seatGeo = new THREE.BoxGeometry(0.66, 0.095, 0.48);
  const backGeo = new THREE.BoxGeometry(0.66, 0.46, 0.085);
  const crestGeo = new THREE.BoxGeometry(0.60, 0.085, 0.098);
  const legGeo = new THREE.BoxGeometry(0.075, 0.34, 0.095);
  const railGeo = new THREE.BoxGeometry(1, 0.09, 0.14);
  const riserGeo = new THREE.BoxGeometry(1, 0.14, 0.88);

  const instSeat = new THREE.InstancedMesh(seatGeo, seatMat, totalSeats);
  const instBack = new THREE.InstancedMesh(backGeo, seatMat, totalSeats);
  const instCrest = new THREE.InstancedMesh(crestGeo, seatMat, totalSeats);
  const instLegs = new THREE.InstancedMesh(legGeo, frameMat, totalSeats * 2);
  const instRail = new THREE.InstancedMesh(railGeo, frameMat, arqs.length);
  const instRiser = new THREE.InstancedMesh(riserGeo, concreteMat, arqs.length);
  instRiser.receiveShadow = true;

  const cTeam = [new THREE.Color(custom.times[0].cor), new THREE.Color(custom.times[1].cor)];
  const cAccent = [new THREE.Color(custom.times[0].cor2), new THREE.Color(custom.times[1].cor2)];

  const dummy = new THREE.Object3D();
  const basePos = new THREE.Vector3();
  const localOff = new THREE.Vector3();
  const qYaw = new THREE.Quaternion();
  const qBack = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3(1, 0, 0);
  const tiltBack = new THREE.Quaternion().setFromAxisAngle(right, 0.14);

  let sIdx = 0;
  let lIdx = 0;
  let rIdx = 0;

  for (const a of arqs) {
    const lado = a.lado ? 1 : 0;
    const olharZ = a.olhar > a.z ? 1 : -1;
    const yaw = olharZ > 0 ? Math.PI : 0;
    qYaw.setFromAxisAngle(up, yaw);
    qBack.copy(qYaw).multiply(tiltBack);

    const xStart = Math.floor(a.x0), xEnd = Math.floor(a.x1);
    const rowLen = Math.max(1, xEnd - xStart + 1);
    const rowCenterX = (xStart + xEnd) * 0.5 + 0.5;

    // Viga metálica contínua sob cada fileira + degrau de acabamento (instanciados: 2 draw calls no total)
    dummy.position.set(rowCenterX, a.y + 0.08, a.z + 0.5);
    dummy.quaternion.identity();
    dummy.scale.set(rowLen, 1, 1);
    dummy.updateMatrix();
    instRail.setMatrixAt(rIdx, dummy.matrix);

    dummy.position.set(rowCenterX, a.y - 0.15, a.z + 0.5);
    dummy.scale.set(rowLen + 0.12, 1, 1);
    dummy.updateMatrix();
    instRiser.setMatrixAt(rIdx, dummy.matrix);
    rIdx++;

    for (let x = xStart; x <= xEnd; x++) {
      basePos.set(x + 0.5, a.y - 0.12, a.z + 0.5);
      // Assento ergonômico
      localOff.set(0, 0.31, -0.02).applyQuaternion(qYaw).add(basePos);
      dummy.position.copy(localOff); dummy.quaternion.copy(qYaw); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      instSeat.setMatrixAt(sIdx, dummy.matrix);
      instSeat.setColorAt(sIdx, cTeam[lado]);

      // Encosto inclinado
      localOff.set(0, 0.54, 0.21).applyQuaternion(qYaw).add(basePos);
      dummy.position.copy(localOff); dummy.quaternion.copy(qBack); dummy.updateMatrix();
      instBack.setMatrixAt(sIdx, dummy.matrix);
      instBack.setColorAt(sIdx, cTeam[lado]);

      // Friso superior do encosto na cor secundária do time
      localOff.set(0, 0.74, 0.245).applyQuaternion(qYaw).add(basePos);
      dummy.position.copy(localOff); dummy.quaternion.copy(qBack); dummy.updateMatrix();
      instCrest.setMatrixAt(sIdx, dummy.matrix);
      instCrest.setColorAt(sIdx, cAccent[lado]);

      // Pés metálicos duplos
      for (const lx of [-0.25, 0.25]) {
        localOff.set(lx, 0.15, 0.02).applyQuaternion(qYaw).add(basePos);
        dummy.position.copy(localOff); dummy.quaternion.copy(qYaw); dummy.updateMatrix();
        instLegs.setMatrixAt(lIdx++, dummy.matrix);
      }

      // Mantém coordenadas exatas de assentoPerto()
      assentos.push({ x: x + 0.5, y: a.y + 0.22, z: a.z + 0.5, yaw, lado });
      sIdx++;
    }
  }

  for (const im of [instSeat, instBack, instCrest]) {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = pcMode;
    im.receiveShadow = true;
    grp.add(im);
  }
  instLegs.instanceMatrix.needsUpdate = true;
  instRail.instanceMatrix.needsUpdate = true;
  instRiser.instanceMatrix.needsUpdate = true;
  grp.add(instLegs, instRail, instRiser);

  return { grp, assentos };
}

// ---- Fita luminosa 3D (cometa Magnus) pré-alocada com zero alocações por quadro ------------------------------------
const TRAIL_MAX = 28;
function criarTrilhaCometa() {
  // 2 planos cruzados (horizontal + vertical) ao longo de TRAIL_MAX amostras = 4 vértices/amostra
  const vertCount = TRAIL_MAX * 4;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const indices = [];
  for (let i = 0; i < TRAIL_MAX - 1; i++) {
    const a0 = i * 4, b0 = (i + 1) * 4;
    // Fita horizontal (vértices 0, 1)
    indices.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0);
    // Fita vertical (vértices 2, 3)
    indices.push(a0 + 2, a0 + 3, b0 + 2, a0 + 3, b0 + 3, b0 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.setDrawRange(0, 0);

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.86,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'bola-trilha-cometa';

  const pts = [];
  const tmpColor = new THREE.Color();
  const white = new THREE.Color('#ffffff');

  function clear() {
    pts.length = 0;
    geo.setDrawRange(0, 0);
    mesh.visible = false;
  }

  function push(p, width, colorHex, maxLife = 0.42) {
    if (!p) return;
    const last = pts[0];
    if (last && Math.hypot(p[0] - last.x, p[1] - last.y, p[2] - last.z) < 0.06) return;
    tmpColor.set(colorHex || '#facc15');
    pts.unshift({ x: p[0], y: p[1], z: p[2], w: width, r: tmpColor.r, g: tmpColor.g, b: tmpColor.b, age: 0, life: maxLife });
    if (pts.length > TRAIL_MAX) pts.length = TRAIL_MAX;
  }

  function update(dt) {
    for (let i = pts.length - 1; i >= 0; i--) {
      pts[i].age += dt;
      if (pts[i].age >= pts[i].life) pts.splice(i, 1);
    }
    const n = pts.length;
    if (n < 2) {
      geo.setDrawRange(0, 0);
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const posArr = geo.attributes.position.array;
    const colArr = geo.attributes.color.array;

    for (let i = 0; i < n; i++) {
      const cur = pts[i];
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(n - 1, i + 1)];
      let tx = prev.x - next.x, ty = prev.y - next.y, tz = prev.z - next.z;
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl; ty /= tl; tz /= tl;
      // Vetor lateral horizontal perpendicular à tangente
      let sx = -tz, sz = tx;
      const sl = Math.hypot(sx, sz);
      if (sl > 1e-4) { sx /= sl; sz /= sl; } else { sx = 1; sz = 0; }

      const kAge = clamp(1 - cur.age / cur.life, 0, 1);
      const kIdx = 1 - i / (n - 1);
      const fade = kAge * kIdx;
      const halfW = cur.w * fade;
      // Núcleo branco-quente próximo à bola, transicionando para cor do efeito
      const hot = fade * fade * 0.55;
      const cr = (cur.r * (1 - hot) + white.r * hot) * fade;
      const cg = (cur.g * (1 - hot) + white.g * hot) * fade;
      const cb = (cur.b * (1 - hot) + white.b * hot) * fade;

      const baseV = i * 4 * 3;
      // Horizontal strip (-side, +side)
      posArr[baseV]     = cur.x - sx * halfW; posArr[baseV + 1] = cur.y;         posArr[baseV + 2] = cur.z - sz * halfW;
      posArr[baseV + 3] = cur.x + sx * halfW; posArr[baseV + 4] = cur.y;         posArr[baseV + 5] = cur.z + sz * halfW;
      // Vertical strip (-Y, +Y)
      posArr[baseV + 6] = cur.x;              posArr[baseV + 7] = cur.y - halfW; posArr[baseV + 8] = cur.z;
      posArr[baseV + 9] = cur.x;              posArr[baseV + 10] = cur.y + halfW; posArr[baseV + 11] = cur.z;

      for (let v = 0; v < 4; v++) {
        colArr[baseV + v * 3] = cr;
        colArr[baseV + v * 3 + 1] = cg;
        colArr[baseV + v * 3 + 2] = cb;
      }
    }
    geo.setDrawRange(0, (n - 1) * 12);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  function dispose() {
    clear();
    geo.dispose();
    mat.dispose();
  }

  return { mesh, push, update, clear, dispose };
}

// ---- Controlador principal do Estádio 3D + Física da Rede 2D + VFX de Chutes Especiais -----------------------------
export function createEstadio3D({ scene, game } = {}) {
  const root = new THREE.Group(); root.name = 'estadio-futebol-3d';
  scene?.add(root);
  let chave = '';
  let redes = [], panos = [], refletores = null, placas = null, assentos = [], assentosBox = null;

  // Grupo e geometrias compartilhadas de VFX (limpos com rigor em limpar()/dispose())
  const vfxGrp = new THREE.Group(); vfxGrp.name = 'futebol-vfx';
  scene?.add(vfxGrp);
  const trilha = criarTrilhaCometa();
  vfxGrp.add(trilha.mesh);

  const ondas = [], particulas = [];
  const MAX_PARTICULAS = 140;
  let rastroAte = 0, rastroCor = '#facc15', rastroCd = 0, rastroSpinHint = 0;
  const prevBolaV = [0, 0, 0];
  let temPrevBolaV = false;

  const ringGeo = new THREE.RingGeometry(0.26, 0.48, 28);
  const flashGeo = new THREE.SphereGeometry(0.32, 12, 10);
  const partGeo = new THREE.SphereGeometry(0.072, 6, 5);
  const tuftGeo = new THREE.BoxGeometry(0.055, 0.14, 0.04);
  const sparkGeo = new THREE.ConeGeometry(0.045, 0.24, 5);
  sparkGeo.rotateX(Math.PI / 2);
  for (const g of [ringGeo, flashGeo, partGeo, tuftGeo, sparkGeo]) g.userData.shared = true;

  function limparVfx() {
    for (let i = ondas.length - 1; i >= 0; i--) {
      const o = ondas[i];
      vfxGrp.remove(o.mesh);
      o.mesh.material?.dispose?.();
    }
    ondas.length = 0;
    for (let i = particulas.length - 1; i >= 0; i--) {
      const q = particulas[i];
      vfxGrp.remove(q.mesh);
      q.mesh.material?.dispose?.();
    }
    particulas.length = 0;
    trilha.clear();
    rastroAte = 0;
    rastroSpinHint = 0;
    temPrevBolaV = false;
  }

  function limpar(cfgAtivo = null) {
    disposeSubtree(root);
    while (root.children.length) root.remove(root.children[0]);
    redes = []; panos = []; refletores = null; placas = null; assentos = []; assentosBox = null;
    limparVfx();
    pruneCamisaCache(cfgAtivo);
    pruneBolaCache(cfgAtivo?.bola?.estilo);
  }

  function dispose() {
    limpar(null);
    trilha.dispose();
    for (const g of [ringGeo, flashGeo, partGeo, tuftGeo, sparkGeo]) g.dispose();
    scene?.remove(root);
    scene?.remove(vfxGrp);
  }

  function sincronizar(campo, custom) {
    const cfg = custom || customFutebolPadrao();
    pruneBolaCache(cfg.bola?.estilo);
    pruneCamisaCache(campo ? cfg : null);

    const novaChave = campo ? JSON.stringify({ c: campo, e: cfg.estadio, t: cfg.times }) : '';
    if (novaChave === chave) return;
    chave = novaChave;
    limpar(campo ? cfg : null);
    if (!campo) return;

    const pcMode = (game?.plataforma ?? 'pc') === 'pc';
    const benchDir = escolherLadoBancos(campo);

    if (cfg.estadio?.linhasHd !== false) {
      root.add(criarPinturaCampo(campo, pcMode, benchDir));
    }
    if (cfg.estadio?.traves3d !== false) {
      const netMat = new THREE.MeshLambertMaterial({
        map: criarTexturaRede(),
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        alphaTest: 0.12,
      });
      const gA = criarGol3D(campo, 'A', pcMode, netMat);
      const gB = criarGol3D(campo, 'B', pcMode, netMat);
      root.add(gA.grp, gB.grp);
      redes.push(...gA.redes, ...gB.redes);
    }
    if (cfg.estadio?.refletores !== false) {
      refletores = criarRefletores(campo, pcMode);
      root.add(refletores.grp);
    }
    // Bancos de reservas cobertos + placas perimetrais LED com identidade do GM
    root.add(criarBancosReservas(campo, cfg, benchDir, pcMode));
    placas = criarPlacasLED(campo, cfg, benchDir);
    root.add(placas.grp);

    const band = criarBandeiras(campo, cfg);
    root.add(band.grp);
    panos = band.panos;

    if (cfg.estadio?.arquibancadas3d !== false) {
      const arq = criarArquibancadas3D(campo, cfg, pcMode);
      root.add(arq.grp);
      assentos = arq.assentos;
      if (assentos.length) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let i = 0; i < assentos.length; i++) {
          const a = assentos[i];
          if (a.x < minX) minX = a.x; if (a.x > maxX) maxX = a.x;
          if (a.y < minY) minY = a.y; if (a.y > maxY) maxY = a.y;
          if (a.z < minZ) minZ = a.z; if (a.z > maxZ) maxZ = a.z;
        }
        assentosBox = { minX: minX - 2.7, maxX: maxX + 2.7, minY: minY - 2.7, maxY: maxY + 2.7, minZ: minZ - 2.7, maxZ: maxZ + 2.7 };
      }
    }
    root.updateMatrixWorld(true);
  }

  function pushParticula(pObj) {
    if (particulas.length >= MAX_PARTICULAS) {
      const old = particulas.shift();
      vfxGrp.remove(old.mesh);
      old.mesh.material?.dispose?.();
    }
    vfxGrp.add(pObj.mesh);
    particulas.push(pObj);
  }

  function addOnda(geo, cor, pos, dirV, dur, maxScale, additive = true, flat = false, baseOpacity = 0.9) {
    const mat = new THREE.MeshBasicMaterial({
      color: cor,
      transparent: true,
      opacity: baseOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    if (flat) {
      m.rotation.x = -Math.PI / 2;
    } else if (dirV && Math.hypot(dirV[0], dirV[1], dirV[2]) > 0.2) {
      m.lookAt(pos[0] + dirV[0], pos[1] + dirV[1], pos[2] + dirV[2]);
    } else {
      m.rotation.x = -Math.PI / 2;
    }
    vfxGrp.add(m);
    ondas.push({ mesh: m, t: 0, dur, maxScale, baseOpacity });
  }

  function dispararVfx({ tipo, cor = '#facc15', p, v, w } = {}) {
    if (!p) return;
    const pos = Array.isArray(p) ? p : [0, 0, 0];
    const hasV = Array.isArray(v) && Math.hypot(v[0], v[1], v[2]) > 0.2;
    const spinMag = Array.isArray(w) ? Math.hypot(w[0], w[1], w[2]) : 0;

    if (tipo === 'bicicleta') {
      // Explosão dourada acrobática: duplo anel + flash central dourado + 26 faíscas brilhantes
      addOnda(ringGeo, '#facc15', pos, v, 0.52, 6.2, true, false, 0.96);
      addOnda(ringGeo, '#fef08a', pos, null, 0.44, 4.8, true, true, 0.82);
      addOnda(flashGeo, '#fffbeb', pos, null, 0.24, 3.4, true, false, 0.92);
      const cols = ['#facc15', '#fef08a', '#f59e0b', '#ffffff'];
      for (let i = 0; i < 26; i++) {
        const pm = new THREE.MeshBasicMaterial({
          color: cols[i % cols.length], transparent: true, opacity: 0.96, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const m = new THREE.Mesh(i % 2 === 0 ? sparkGeo : partGeo, pm);
        m.position.set(pos[0], pos[1], pos[2]);
        const a = (i / 26) * Math.PI * 2 + Math.random() * 0.25;
        const spd = 3.2 + Math.random() * 6.8;
        const vx = Math.cos(a) * spd + (hasV ? v[0] * 0.12 : 0);
        const vy = 1.8 + Math.random() * 5.2;
        const vz = Math.sin(a) * spd + (hasV ? v[2] * 0.12 : 0);
        if (i % 2 === 0) m.lookAt(pos[0] + vx, pos[1] + vy, pos[2] + vz);
        pushParticula({ mesh: m, t: 0, dur: 0.52 + Math.random() * 0.36, vx, vy, vz, grav: 8.5, grow: 0 });
      }
      rastroCor = '#facc15';
      rastroSpinHint = Math.max(18, spinMag);
      rastroAte = performance.now() / 1000 + 1.45;
      return;
    }

    if (tipo === 'voleio') {
      // Flash de energia direcional + anéis duplos no eixo do disparo + rajada de faíscas
      addOnda(flashGeo, '#fff7ed', pos, null, 0.2, 3.0, true, false, 0.94);
      addOnda(ringGeo, '#fb923c', pos, v, 0.42, 5.6, true, false, 0.95);
      addOnda(ringGeo, '#fde047', pos, v, 0.3, 3.6, true, false, 0.85);
      const cols = ['#fb923c', '#facc15', '#fff7ed'];
      for (let i = 0; i < 20; i++) {
        const pm = new THREE.MeshBasicMaterial({
          color: cols[i % cols.length], transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const m = new THREE.Mesh(sparkGeo, pm);
        m.position.set(pos[0], pos[1], pos[2]);
        const a = Math.random() * Math.PI * 2, spd = 2.4 + Math.random() * 5.0;
        const vx = Math.cos(a) * spd + (hasV ? v[0] * 0.28 : 0);
        const vy = 0.6 + Math.random() * 3.4 + (hasV ? v[1] * 0.18 : 0);
        const vz = Math.sin(a) * spd + (hasV ? v[2] * 0.28 : 0);
        m.lookAt(pos[0] + vx, pos[1] + vy, pos[2] + vz);
        pushParticula({ mesh: m, t: 0, dur: 0.4 + Math.random() * 0.28, vx, vy, vz, grav: 7.5, grow: 0 });
      }
      rastroCor = '#fb923c';
      rastroSpinHint = Math.max(14, spinMag);
      rastroAte = performance.now() / 1000 + 1.25;
      return;
    }

    if (tipo === 'carrinho') {
      // Nuvem de poeira/grama rasteira + tufos de grama 3D voando + arco deslizante azul-celeste
      const gPos = [pos[0], pos[1] - 0.18, pos[2]];
      addOnda(ringGeo, '#38bdf8', gPos, null, 0.42, 4.4, true, true, 0.82);
      const grassCols = ['#4ade80', '#22c55e', '#16a34a', '#15803d'];
      for (let i = 0; i < 16; i++) {
        const pm = new THREE.MeshBasicMaterial({ color: grassCols[i % grassCols.length], transparent: true, opacity: 0.95, depthWrite: false });
        const m = new THREE.Mesh(tuftGeo, pm);
        m.position.set(pos[0] + (Math.random() - 0.5) * 0.45, pos[1] - 0.12, pos[2] + (Math.random() - 0.5) * 0.45);
        m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        const a = Math.random() * Math.PI * 2, spd = 1.6 + Math.random() * 3.8;
        pushParticula({
          mesh: m, t: 0, dur: 0.52 + Math.random() * 0.34,
          vx: Math.cos(a) * spd + (hasV ? v[0] * 0.22 : 0),
          vy: 2.2 + Math.random() * 3.8,
          vz: Math.sin(a) * spd + (hasV ? v[2] * 0.22 : 0),
          grav: 11.5, spin: (Math.random() - 0.5) * 12, grow: 0,
        });
      }
      // Nuvem de poeira/neblina de grama que se expande
      const dustCols = ['#bbf7d0', '#d9f99d', '#a8a29e'];
      for (let i = 0; i < 10; i++) {
        const pm = new THREE.MeshBasicMaterial({ color: dustCols[i % dustCols.length], transparent: true, opacity: 0.58, depthWrite: false });
        const m = new THREE.Mesh(partGeo, pm);
        m.position.set(pos[0] + (Math.random() - 0.5) * 0.5, pos[1] - 0.1, pos[2] + (Math.random() - 0.5) * 0.5);
        m.scale.setScalar(1.8 + Math.random() * 1.4);
        const a = Math.random() * Math.PI * 2, spd = 0.8 + Math.random() * 2.2;
        pushParticula({
          mesh: m, t: 0, dur: 0.55 + Math.random() * 0.3,
          vx: Math.cos(a) * spd + (hasV ? v[0] * 0.15 : 0),
          vy: 0.9 + Math.random() * 1.6,
          vz: Math.sin(a) * spd + (hasV ? v[2] * 0.15 : 0),
          grav: 1.8, grow: 2.4,
        });
      }
      rastroCor = '#38bdf8';
      rastroAte = performance.now() / 1000 + 0.65;
      return;
    }

    // Demais chutes especiais: colocado, falta, forte, drible, cabeca
    const isMagnus = tipo === 'colocado' || tipo === 'falta';
    const isForte = tipo === 'forte';
    const isDrible = tipo === 'drible';

    addOnda(ringGeo, cor, pos, isDrible ? null : v, isForte ? 0.48 : 0.42, isForte ? 5.8 : 4.8, true, isDrible, 0.9);
    if (isForte || isMagnus) {
      addOnda(ringGeo, '#ffffff', pos, v, 0.28, 3.4, true, false, 0.8);
      if (isForte) addOnda(flashGeo, '#ffedd5', pos, null, 0.18, 2.8, true, false, 0.85);
    }

    const qtd = isForte ? 22 : isMagnus ? 18 : isDrible ? 12 : 14;
    for (let i = 0; i < qtd; i++) {
      const pCor = isDrible && i % 2 === 0 ? '#4ade80' : cor;
      const pm = new THREE.MeshBasicMaterial({
        color: pCor,
        transparent: true,
        opacity: 0.94,
        depthWrite: false,
        blending: isDrible ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      const useTuft = isDrible && i % 2 === 0;
      const m = new THREE.Mesh(useTuft ? tuftGeo : (isForte || isMagnus ? sparkGeo : partGeo), pm);
      m.position.set(pos[0], pos[1], pos[2]);
      const a = Math.random() * Math.PI * 2, spd = (isForte ? 3.0 : 2.0) + Math.random() * 5.4;
      const vx = Math.cos(a) * spd + (hasV ? v[0] * 0.16 : 0);
      const vy = 1.4 + Math.random() * 4.0;
      const vz = Math.sin(a) * spd + (hasV ? v[2] * 0.16 : 0);
      if (!useTuft && (isForte || isMagnus)) m.lookAt(pos[0] + vx, pos[1] + vy, pos[2] + vz);
      pushParticula({
        mesh: m, t: 0, dur: 0.42 + Math.random() * 0.34,
        vx, vy, vz, grav: useTuft ? 11.0 : 8.5, spin: useTuft ? 9 : 0, grow: 0,
      });
    }

    if (isForte || isMagnus || tipo === 'cabeca') {
      rastroCor = cor;
      rastroSpinHint = isMagnus ? Math.max(24, spinMag) : Math.max(8, spinMag);
      rastroAte = performance.now() / 1000 + (isMagnus ? 1.55 : isForte ? 1.35 : 0.85);
    }
  }

  // Método opcional para outros módulos registrarem manualmente posição/spin/cor do cometa da bola
  function registrarRastroBola(p, v, w, cor) {
    if (!p) return;
    const spinMag = Array.isArray(w) ? Math.hypot(w[0], w[1], w[2]) : 0;
    const spd = Array.isArray(v) ? Math.hypot(v[0], v[1], v[2]) : 0;
    const width = clamp(0.11 + spinMag * 0.0065 + spd * 0.004, 0.11, 0.34);
    trilha.push(p, width, cor || rastroCor, clamp(0.32 + spinMag * 0.012, 0.32, 0.62));
  }

  // ---- Atualização quadro a quadro: física 2D da rede, vento nas bandeiras, refletores/LEDs e VFX ---------------------
  function atualizar(dtRaw, t, bolaP, bolaV, sunHeight = 0.5, bolaW = null) {
    const dt = clamp(Number(dtRaw) || 0, 0.0001, 0.05);

    // 1. Física realista de onda 2D nas redes dos gols (acoplamento entre vizinhos + impulso direcional no ponto exato)
    if (redes.length) {
      const hasBall = Array.isArray(bolaP);
      const bSpeed = hasBall && Array.isArray(bolaV) ? Math.hypot(bolaV[0], bolaV[1], bolaV[2]) : 0;
      const subSteps = dt > 0.028 ? 3 : dt > 0.015 ? 2 : 1;
      const h = dt / subSteps;

      for (const r of redes) {
        let perto = false;
        if (hasBall) {
          r.invMat.copy(r.mesh.matrixWorld).invert();
          r.localPt.set(bolaP[0], bolaP[1], bolaP[2]).applyMatrix4(r.invMat);
          perto = Math.abs(r.localPt.z) < 1.35
            && Math.abs(r.localPt.x) < r.halfW + 0.9
            && Math.abs(r.localPt.y) < r.halfH + 0.9;
        }
        if (!perto && !r.ativo) continue;

        if (perto && Array.isArray(bolaV) && bSpeed > 0.01) {
          r.localVel.set(bolaV[0], bolaV[1], bolaV[2]).transformDirection(r.invMat).multiplyScalar(bSpeed);
        } else {
          r.localVel.set(0, 0, 0);
        }

        const gp = r.geo.attributes.position;
        const { cols, rows, rest, disp, vel, pinned } = r;
        const n = gp.count;
        const raio = BOLA.r + 0.56;
        let maxE = 0;

        for (let step = 0; step < subSteps; step++) {
          // Passo 1: forças (impacto direcional da bola + onda 2D por vizinhos + retorno elástico + amortecimento)
          for (let row = 0; row < rows; row++) {
            const rU = row > 0 ? row - 1 : row;
            const rD = row < rows - 1 ? row + 1 : row;
            for (let col = 0; col < cols; col++) {
              const i = row * cols + col;
              if (pinned[i]) continue;
              const k = i * 3;

              if (perto) {
                const vx0 = rest[k] + disp[k] - r.localPt.x;
                const vy0 = rest[k + 1] + disp[k + 1] - r.localPt.y;
                const vz0 = rest[k + 2] + disp[k + 2] - r.localPt.z;
                const dist = Math.hypot(vx0, vy0, vz0);
                if (dist < raio) {
                  const u = 1 - dist / raio;
                  const falloff = u * u;
                  const invD = dist > 1e-4 ? 1 / dist : 0;
                  const imp = falloff * (5.2 + bSpeed * 1.45);
                  // Impulso direcional da velocidade da bola + repulsão normal no ponto de contato
                  vel[k]     += (r.localVel.x * 0.42 + vx0 * invD * 2.2) * imp * h;
                  vel[k + 1] += (r.localVel.y * 0.42 + vy0 * invD * 2.2) * imp * h;
                  vel[k + 2] += (r.localVel.z * 0.95 + vz0 * invD * 3.4) * imp * h;
                }
              }

              // Acoplamento 2D (4 vizinhos cardeais + 4 diagonais para propagação radial suave)
              const cL = col > 0 ? col - 1 : col;
              const cR = col < cols - 1 ? col + 1 : col;
              const iL = (row * cols + cL) * 3, iR = (row * cols + cR) * 3;
              const iU = (rU * cols + col) * 3, iD = (rD * cols + col) * 3;
              const iUL = (rU * cols + cL) * 3, iUR = (rU * cols + cR) * 3;
              const iDL = (rD * cols + cL) * 3, iDR = (rD * cols + cR) * 3;

              for (let a = 0; a < 3; a++) {
                const selfD = disp[k + a];
                const selfV = vel[k + a];
                const lapCard = disp[iL + a] + disp[iR + a] + disp[iU + a] + disp[iD + a] - 4 * selfD;
                const lapDiag = disp[iUL + a] + disp[iUR + a] + disp[iDL + a] + disp[iDR + a] - 4 * selfD;
                const velLap = vel[iL + a] + vel[iR + a] + vel[iU + a] + vel[iD + a] - 4 * selfV;

                const kRest = a === 2 ? 22 : 44;
                const kWave = a === 2 ? 128 : 88;
                const acc = -kRest * selfD + kWave * (lapCard + 0.25 * lapDiag) - 4.4 * selfV + 1.5 * velLap;
                vel[k + a] = clamp(selfV + acc * h, -18, 18);
              }
            }
          }

          // Passo 2: integração simplética da posição dos vértices
          maxE = 0;
          for (let i = 0; i < n; i++) {
            if (pinned[i]) continue;
            const k = i * 3;
            disp[k]     = clamp(disp[k] + vel[k] * h, -0.36, 0.36);
            disp[k + 1] = clamp(disp[k + 1] + vel[k + 1] * h, -0.36, 0.36);
            disp[k + 2] = clamp(disp[k + 2] + vel[k + 2] * h, -0.95, 0.95);
            const e = Math.abs(disp[k]) + Math.abs(disp[k + 1]) + Math.abs(disp[k + 2])
              + (Math.abs(vel[k]) + Math.abs(vel[k + 1]) + Math.abs(vel[k + 2])) * 0.08;
            if (e > maxE) maxE = e;
          }
        }

        for (let i = 0; i < n; i++) {
          const k = i * 3;
          gp.setXYZ(i, rest[k] + disp[k], rest[k + 1] + disp[k + 1], rest[k + 2] + disp[k + 2]);
        }
        gp.needsUpdate = true;
        r.geo.computeVertexNormals();
        r.ativo = maxE > 0.005;
      }
    }

    // 2. Bandeiras de escanteio e bandeirões com ondulação harmônica multi-segmento no vento
    if (panos.length) {
      const wVec = U?.uWind?.value;
      const windStr = wVec ? clamp(Math.hypot(wVec.x, wVec.z), 0.65, 1.65) : 1.0;
      const gust = 0.85 + 0.28 * Math.sin(t * 1.45) + 0.14 * Math.sin(t * 3.1 + 0.7);
      for (const p of panos) {
        const gp = p.geo.attributes.position;
        const invSpan = 1 / Math.max(0.1, p.span);
        for (let i = 0; i < gp.count; i++) {
          const bx = p.base[i * 3], by = p.base[i * 3 + 1];
          const u = clamp(bx * invSpan, 0, 1); // 0 preso ao mastro, 1 ponta livre
          const env = u * Math.sqrt(u) * p.ampMax * windStr * gust;
          const w1 = Math.sin(t * 5.6 - u * 5.4 + by * 0.9 + p.fase);
          const w2 = 0.34 * Math.sin(t * 9.8 - u * 10.2 - by * 1.7 + p.fase * 1.6);
          const dz = (w1 + w2) * env;
          const dy = 0.18 * env * Math.cos(t * 4.2 - u * 4.0 + p.fase);
          const dx = -Math.min(bx * 0.08, dz * dz * 0.28); // preserva comprimento natural do tecido
          gp.setXYZ(i, bx + dx, by + dy, dz);
        }
        gp.needsUpdate = true;
      }
    }

    // 3. Refletores volumétricos e placas LED reagindo ao ciclo dia / entardecer / noite (atmosphere)
    const sunArg = Number.isFinite(sunHeight) ? sunHeight : 0.5;
    const noiteArg = clamp((0.28 - sunArg) / 0.36, 0, 1);
    const noiteAtm = clamp(Math.max(U?.uNight?.value || 0, (U?.uDusk?.value?.w || 0) * 0.7), 0, 1);
    const noite = Math.max(noiteArg, noiteAtm);

    if (refletores) {
      const pot = noite > 0.02 ? 14 + noite * 195 : 0;
      for (const pl of refletores.lights) pl.intensity = pot;
      refletores.lampMat.emissiveIntensity = 0.25 + noite * 3.2;
      refletores.haloMat.opacity = 0.03 + noite * 0.72;
      const showCones = noite > 0.05;
      refletores.coneMat.opacity = showCones ? (noite - 0.05) * (refletores.pcMode ? 0.145 : 0.105) : 0;
      for (const c of refletores.cones) c.visible = showCones;
      const blink = Math.sin(t * 3.4) > 0.2 ? 1 : 0.15;
      refletores.beaconMat.emissiveIntensity = 0.2 + noite * 2.4 * blink;
    }

    if (placas) {
      placas.ledTex.offset.x = (t * 0.045) % 1;
      placas.ledMat.emissiveIntensity = 0.45 + noite * 1.15;
    }

    // 4. Trilha luminosa / cometa proporcional ao efeito Magnus + partículas de chutes especiais
    const now = performance.now() / 1000;
    if (Array.isArray(bolaP) && Array.isArray(bolaV)) {
      const spd = Math.hypot(bolaV[0], bolaV[1], bolaV[2]);
      let spinMag = Array.isArray(bolaW) ? Math.hypot(bolaW[0], bolaW[1], bolaW[2]) : 0;

      // Infere curvatura lateral Magnus mesmo quando bolaW não é enviado diretamente
      let curvAcc = 0;
      if (temPrevBolaV && spd > 5 && dt > 0.001) {
        const dvx = (bolaV[0] - prevBolaV[0]) / dt;
        const dvz = (bolaV[2] - prevBolaV[2]) / dt;
        const hSpd = Math.hypot(bolaV[0], bolaV[2]);
        if (hSpd > 3) curvAcc = Math.abs(bolaV[0] * dvz - bolaV[2] * dvx) / hSpd;
      }
      prevBolaV[0] = bolaV[0]; prevBolaV[1] = bolaV[1]; prevBolaV[2] = bolaV[2];
      temPrevBolaV = true;

      const magnusIntensity = Math.max(spinMag, curvAcc * 2.2, now < rastroAte ? rastroSpinHint * clamp((rastroAte - now) / 1.2, 0, 1) : 0);
      const showTrail = (now < rastroAte && spd > 3.5) || (spd > 11.5 && magnusIntensity > 4.5) || spd > 18.5;

      if (showTrail) {
        const trailCor = now < rastroAte ? rastroCor : magnusIntensity > 8 ? '#22d3ee' : '#fde047';
        const width = clamp(0.11 + magnusIntensity * 0.006 + spd * 0.0035, 0.11, 0.34);
        trilha.push(bolaP, width, trailCor, clamp(0.32 + magnusIntensity * 0.011, 0.30, 0.58));

        // Faíscas espirais ao longo do arco Magnus
        rastroCd -= dt;
        const stepCd = magnusIntensity > 12 ? 0.022 : 0.036;
        if (rastroCd <= 0) {
          rastroCd = stepCd;
          const pm = new THREE.MeshBasicMaterial({
            color: trailCor, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
          });
          const m = new THREE.Mesh(partGeo, pm);
          const ang = t * (10 + magnusIntensity * 0.5);
          const rad = clamp(magnusIntensity * 0.009, 0.03, 0.22);
          m.position.set(bolaP[0] + Math.cos(ang) * rad, bolaP[1] + Math.sin(ang) * rad * 0.7, bolaP[2] + Math.sin(ang) * rad);
          m.scale.setScalar(0.8 + clamp(magnusIntensity * 0.02, 0, 0.7));
          pushParticula({
            mesh: m, t: 0, dur: 0.28 + Math.random() * 0.14,
            vx: -bolaV[0] * 0.06 + (Math.random() - 0.5) * 1.1,
            vy: 0.35 + (Math.random() - 0.5) * 0.8,
            vz: -bolaV[2] * 0.06 + (Math.random() - 0.5) * 1.1,
            grav: 2.2, grow: 0,
          });
        }
      }
    } else {
      temPrevBolaV = false;
    }
    trilha.update(dt);

    for (let i = ondas.length - 1; i >= 0; i--) {
      const o = ondas[i]; o.t += dt;
      const k = o.t / o.dur;
      if (k >= 1) { vfxGrp.remove(o.mesh); o.mesh.material.dispose(); ondas.splice(i, 1); continue; }
      const ease = 1 - (1 - k) * (1 - k);
      o.mesh.scale.setScalar(0.8 + ease * o.maxScale);
      o.mesh.material.opacity = (1 - k) * o.baseOpacity;
    }
    for (let i = particulas.length - 1; i >= 0; i--) {
      const q = particulas[i]; q.t += dt;
      const k = q.t / q.dur;
      if (k >= 1) { vfxGrp.remove(q.mesh); q.mesh.material.dispose(); particulas.splice(i, 1); continue; }
      q.vy -= (q.grav ?? 9.5) * dt;
      q.mesh.position.x += q.vx * dt;
      q.mesh.position.y += q.vy * dt;
      q.mesh.position.z += q.vz * dt;
      if (q.spin) { q.mesh.rotation.x += q.spin * dt; q.mesh.rotation.z += q.spin * 0.7 * dt; }
      if (q.grow > 0) q.mesh.scale.addScalar(q.grow * dt);
      else q.mesh.scale.setScalar(Math.max(0.08, 1 - k));
      q.mesh.material.opacity = (1 - k) * 0.9;
    }
  }

  function assentoPerto(pos) {
    if (!pos || !assentos.length) return null;
    const px = Array.isArray(pos) ? pos[0] : pos.x;
    const py = Array.isArray(pos) ? pos[1] : pos.y;
    const pz = Array.isArray(pos) ? pos[2] : pos.z;
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return null;
    if (assentosBox && (px < assentosBox.minX || px > assentosBox.maxX || py < assentosBox.minY || py > assentosBox.maxY || pz < assentosBox.minZ || pz > assentosBox.maxZ)) return null;
    let best = null, dm2 = 2.6 * 2.6;
    for (let i = 0; i < assentos.length; i++) {
      const a = assentos[i], dx = px - a.x, dy = py - a.y, dz = pz - a.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < dm2) { dm2 = d2; best = a; }
    }
    return best;
  }

  return {
    sincronizar,
    atualizar,
    dispararVfx,
    efeitoChute: dispararVfx,
    registrarRastroBola,
    assentoPerto,
    limpar,
    dispose,
    get assentos() { return assentos; },
  };
}
