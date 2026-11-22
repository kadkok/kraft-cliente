// LAVRA — chão fotografado (prova de realismo, ramo exp/realismo).
//
// Só carregamento: os materiais escaneados de public/assets/real (preparados por tools/realismo/preparar.py a partir do
// acervo do Poly Haven, CC0; procedência em real.json) viram texturas e entram no registro U. Quem desenha com elas é
// o shader do terreno (materials.js, trecho "Chão fotografado"). Sem os arquivos, sem rede ou com demora, U.uChao.x
// fica em 0 e o gramado segue como era.
import * as THREE from '../three.js';
import { U } from './materials.js';
import { CW } from '../../shared/constants.js';
import { TEX_INDEX } from '../../shared/blocks.js';

const BASE = 'assets/real';

function textura(url, cor, aniso) {
  return new Promise((ok, falha) => new THREE.TextureLoader().load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = cor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.anisotropy = aniso; t.generateMipmaps = true; t.needsUpdate = true;
    ok(t);
  }, undefined, falha));
}

// Mapa das copas: a folhagem empilhada em cada coluna (chunk.canopy, do mesher), juntada num quadrado de LADO metros em
// volta de quem olha (1 ponto = 1 m). O terreno lê para pôr folha seca debaixo das árvores; nada aqui decide regra de jogo.
const PEDACOS = 12, LADO = PEDACOS * CW;
function initCopa({ world, camera, game }) {
  const dados = new Uint8Array(LADO * LADO);
  const tex = new THREE.DataTexture(dados, LADO, LADO, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1; tex.needsUpdate = true;
  U.uCopa.value = tex;
  let sujo = true, cx0 = 1e9, cz0 = 1e9, espera = 0;
  const anterior = world.listeners.models;
  world.listeners.models = (chunk, models) => { anterior?.(chunk, models); sujo = true; };
  const olho = new THREE.Vector3();
  function refazer(cx, cz) {
    cx0 = cx; cz0 = cz; sujo = false;
    dados.fill(0);
    const bx = cx - PEDACOS / 2, bz = cz - PEDACOS / 2;
    for (const c of world.chunks.values()) {
      const k = c.canopy; if (!k || !c.hasMesh) continue;
      const px = c.cx - bx, pz = c.cz - bz;
      if (px < 0 || pz < 0 || px >= PEDACOS || pz >= PEDACOS) continue;
      for (let z = 0; z < CW; z++) dados.set(k.subarray(z * CW, z * CW + CW), (pz * CW + z) * LADO + px * CW);
    }
    tex.needsUpdate = true;
    U.uCopaInfo.value.set(bx * CW - 0.5, bz * CW - 0.5, 1 / LADO, 1);   // −0,5: o centro do ponto é o meio da coluna
  }
  game.hooks.frame.push((dt) => {
    camera.getWorldPosition(olho);
    const cx = Math.floor(olho.x / CW), cz = Math.floor(olho.z / CW);
    espera -= dt;
    if (cx !== cx0 || cz !== cz0 || (sujo && espera <= 0)) { refazer(cx, cz); espera = 0.3; }
  });
}

// Cor média (linear) da foto do gramado em uso: é dela que o chão fotografado parte. A relva faz a mesma conta
// (render/relva.js); aqui ela vale também onde não há relva (celular, visor, &relva=0).
function initCorDoGramado(game) {
  let feita = false;
  game.hooks.frame.push(() => {
    if (feita) return;
    const d = game.texData, n = game.texSize;
    if (!d || !n) return;
    const o = TEX_INDEX.grass_top * n * n * 4;
    let r = 0, g = 0, b = 0;
    const L = (v) => { v /= 255; return v * v * (v * 0.305 + 0.695); };
    for (let i = 0; i < n * n; i++) { r += L(d[o + i * 4]); g += L(d[o + i * 4 + 1]); b += L(d[o + i * 4 + 2]); }
    U.uRelvaCor.value.set(r / (n * n), g / (n * n), b / (n * n), 1);
    feita = true;
  });
}

export async function initRealChao({ renderer, quality, game, world, camera }) {
  if (!quality.real || quality.real.chao === false) return null;
  initCopa({ world, camera, game });
  initCorDoGramado(game);
  // no celular e no visor o chão de foto vale mais perto: além disso a tela não mostra o desenho e a conta pesa
  if (quality.real.leve) { U.uChao.value.y = 30; U.uCasca.value.z = 40; }
  // enquanto as fotos não chegam, os amostradores apontam para um ponto cinza (o shader nem os lê: uChao.x = 0)
  const vazio = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); vazio.needsUpdate = true;
  for (const k of ['uChaoCor0', 'uChaoSup0', 'uChaoCor1', 'uChaoSup1', 'uCascaCor', 'uCascaSup']) if (!U[k].value) U[k].value = vazio;
  try {
    const info = await (await fetch(`${BASE}/real.json`, { cache: 'no-cache' })).json();
    // no perfil leve o chão é visto de lado sem as lâminas por cima: com menos de 4 de anisotropia a foto vira um borrão em faixas
    const m = info.materiais, aniso = Math.min(Math.max(quality.aniso || 4, quality.real.leve ? 4 : 1), renderer.capabilities.getMaxAnisotropy());
    const v = encodeURIComponent(info.feito_em || '');
    const [c0, s0, c1, s1] = await Promise.all([
      textura(`${BASE}/${m.grama.cor}?v=${v}`, true, aniso), textura(`${BASE}/${m.grama.sup}?v=${v}`, false, aniso),
      textura(`${BASE}/${m.folhas.cor}?v=${v}`, true, aniso), textura(`${BASE}/${m.folhas.sup}?v=${v}`, false, aniso),
    ]);
    U.uChaoCor0.value = c0; U.uChaoSup0.value = s0; U.uChaoCor1.value = c1; U.uChaoSup1.value = s1;
    U.uChaoMed.value.set(m.grama.media[0], m.grama.media[1], m.grama.media[2]);
    U.uChao.value.set(1, U.uChao.value.y, m.grama.metros, m.folhas.metros);
    if (m.casca) {
      const [cc, cs] = await Promise.all([textura(`${BASE}/${m.casca.cor}?v=${v}`, true, aniso), textura(`${BASE}/${m.casca.sup}?v=${v}`, false, aniso)]);
      U.uCascaCor.value = cc; U.uCascaSup.value = cs;
      U.uCascaMed.value.set(m.casca.media[0], m.casca.media[1], m.casca.media[2]);
      U.uCasca.value.x = 1; U.uCasca.value.y = m.casca.metros;
    }
    if (game) game.realChao = info;
    return info;
  } catch (e) {
    console.warn('[real] chão fotografado não carregou:', e?.message || e);
    return null;
  }
}
