// LAVRA — o corpo animado de um cavalo (pedido direto do Kadmus, 17/11/2026: "motions" naturais do animal).
// Modelo: assets/fauna/cavalo/cavalo-real.glb ("Horse" de henry_7, CC BY 4.0; procedência ao lado), 100 ossos e 28
// animações. Este módulo só desenha: quem decide o que o cavalo faz é a biologia (shared/equino.js) no servidor, e
// quem move o corpo é a física (shared/bodies.js). Aqui:
//   · a ação manda o clipe (pastar → comer, dormir em pé, deitar, levantar, empinar, coice, corcovear, pular, nadar…);
//   · andando, quem manda é a velocidade real do corpo: passo (Walk), trote (sintetizado da caminhada, pares diagonais),
//     meio-galope e galope (Gallop), cada um no compasso da passada; virando, as versões _L/_R;
//   · gestos que o modelo não traz são feitos nos ossos, por cima do clipe: cauda erguida (urinar, defecar, égua que
//     aceita a cobertura), postura de urinar do macho (pernas de trás esticadas), pescoço e cabeça virando para o que
//     o cavalo olha, cabeça erguida e boca aberta no relincho, respiração no sono;
//   · tamanho pelo crescimento (potro ~45%), égua um pouco menor, pelagem por tingimento, sela só no cavalo domado.
import * as THREE from '../three.js';

export const ALTURA_MODELO = 20.4;                 // unidades do modelo do casco ao alto da cabeça
export const ALTURA = 1.95;                        // m, adulto
const ESCALA = ALTURA / ALTURA_MODELO;
export const PELAGENS = [[1, 1, 1], [0.6, 0.45, 0.36], [0.82, 0.82, 0.86], [0.3, 0.27, 0.26]];

// Ossos usados pelos gestos (nomes do modelo).
const OSSO = {
  cauda: 'BN_Tail_00_061_067', cauda1: 'BN_Tail_01_062_068',
  pescoco: ['BN_Neck_00_06_06', 'BN_Neck_01_07_07', 'BN_Neck_02_011_011', 'BN_Neck_03_012_012'], cabeca: 'BN_Head_00_016_015', queixo: 'BN_Jaw_027_026',
  coxaE: 'BN_L_Thing_051_054', coxaD: 'BN_R_Thing_056_060', bracoE: 'BN_L_UpperArm_039_040', bracoD: 'BN_R_UpperArm_044_046',
  barriga: 'BN_Stomach_050_053', coluna: 'BN_Spine_01_03_03',
};
const TRASEIRA = /BN_[LR]_(Thing|Calf|HorseLink|Foot|Toe_2)/;

// Ação → [clipe, compasso, modo]. modo: 'laco' (repete) · 'uma' (uma vez e fica no fim) · 'fim' (já no último quadro)
const MAPA = {
  parado: ['1 Ilde', 1, 'laco'], alerta: ['2 Ilde', 1, 'laco'], pastar: ['6 Eat', 1, 'laco'], beber: ['6 Eat', 0.55, 'laco'],
  deitar: ['Fallen', 1, 'uma'], dormir: ['Death', 1, 'fim'], dormir_pe: ['Sleep', 0.8, 'laco'], urinar: ['1 Ilde', 0.3, 'laco'],
  defecar: ['1 Ilde', 0.3, 'laco'], empinar: ['Buck_1', 1, 'uma'], coice: ['5 Attack_2', 1, 'uma'], corcovear: ['Falling', 1, 'uma'],
  pular: ['Jump_Run', 1.2, 'uma'], nadar: ['Swim', 1, 'laco'], cheirar: ['3 Ilde', 1, 'laco'], relinchar: ['2 Ilde', 1, 'laco'],
  mamar: ['6 Eat', 0.5, 'laco'], cortejar: ['2 Ilde', 1.2, 'laco'], cobrir: ['Buck_1', 0.35, 'segura'], aceitar: ['1 Ilde', 0.3, 'laco'],
  parir: ['Fallen', 1, 'uma'], levantar: ['Arise', 1, 'uma'], sacudir: ['3 Ilde', 1.4, 'laco'], rolar: ['Fallen', 1.3, 'uma'],
  morto: ['Death', 1, 'uma'],
};
const LOCOMOVE = new Set(['andar', 'trotar', 'galopar', 'montado', 'parado', 'alerta', 'cheirar', 'cortejar', 'nadar', 'pastar']);

// Trote: a caminhada do modelo é lateral (traseira D, dianteira D, traseira E, dianteira E, um quarto de ciclo entre
// cada uma). Adiantando as traseiras 22% do ciclo, cada traseira pisa junto com a dianteira do lado oposto.
function sintetizarTrote(walk) {
  const D = walk.duration, off = 0.22 * D;
  const tracks = walk.tracks.map((t) => {
    if (!TRASEIRA.test(t.name)) return t.clone();
    const n = t.getValueSize(), it = t.createInterpolant(new Float32Array(n)), vals = new Float32Array(t.times.length * n);
    t.times.forEach((tt, k) => { const v = it.evaluate((tt + off) % D); vals.set(v, k * n); });
    const T = t.constructor;
    return new T(t.name, Float32Array.from(t.times), vals);
  });
  return new THREE.AnimationClip('Trot', D, tracks);
}

// Prepara o modelo carregado (uma vez): clipes por nome, trote, materiais por pelagem.
export function prepararCavalo(gltf) {
  const clips = {};
  for (const c of gltf.animations) clips[c.name.replace('Skeleton|', '')] = c;
  if (clips.Walk) clips.Trot = sintetizarTrote(clips.Walk);
  const base = gltf.scene;
  base.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
  // materiais tingidos (um jogo por pelagem, compartilhado entre os cavalos)
  const mats = PELAGENS.map((cor) => {
    const m = new Map();
    base.traverse((o) => {
      if (!o.isMesh || m.has(o.material)) return;
      const nome = o.material.name;
      if (nome === 'Horse' || nome === 'Hair') { const c = o.material.clone(); c.color.setRGB(cor[0], cor[1], cor[2]); if (nome === 'Hair' && cor[0] < 0.7) c.color.multiplyScalar(0.55); m.set(o.material, c); }
    });
    return m;
  });
  return { base, clips, mats };
}

// Clona o modelo com esqueleto próprio (o que SkeletonUtils.clone faz).
export function clonarComOssos(src) {
  const copia = src.clone(true);
  const ossos = new Map(); copia.traverse((o) => { if (o.isBone) ossos.set(o.name, o); });
  const orig = []; src.traverse((o) => { if (o.isSkinnedMesh) orig.push(o); });
  let k = 0;
  copia.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const s = orig[k++];
    o.skeleton = new THREE.Skeleton(s.skeleton.bones.map((b) => ossos.get(b.name)), s.skeleton.boneInverses);
    o.bind(o.skeleton, s.bindMatrix);
  });
  return { copia, ossos };
}

const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _ax = new THREE.Vector3();
// gira um osso em volta de um eixo do MUNDO, mantendo a pose do clipe por baixo
function girar(osso, eixo, ang) {
  if (!osso || !ang) return;
  osso.parent.getWorldQuaternion(_qp);
  _qi.copy(_qp).invert();
  _q.setFromAxisAngle(eixo, ang);
  osso.quaternion.premultiply(_qp).premultiply(_q).premultiply(_qi);
  osso.updateMatrixWorld(true);
}

export class CorpoCavalo {
  constructor(prep, seed = 0) {
    const { copia, ossos } = clonarComOssos(prep.base);
    this.raiz = new THREE.Group();
    this.modelo = copia; this.raiz.add(copia);
    this.ossos = ossos; this.prep = prep; this.seed = seed;
    this.mixer = new THREE.AnimationMixer(copia);
    this.acoes = {}; this.atual = null; this.chave = ''; this.pelagem = -1;
    this.sela = []; copia.traverse((o) => { if (o.isMesh && o.material?.name === 'Saddle') this.sela.push(o); });
    this.vel = 0; this.giro = 0; this.ultimo = null; this.t = 0;
    this.olhar = 0; this.ergue = 0; this.cauda = 0; this.estica = 0; this.boca = 0;
  }
  acao(nome) {
    let a = this.acoes[nome];
    if (!a) { const c = this.prep.clips[nome]; if (!c) return null; a = this.acoes[nome] = this.mixer.clipAction(c); }
    return a;
  }
  // troca de clipe com transição suave
  tocar(nome, compasso, modo, fade = 0.35, segura = 0.42) {
    const chave = nome + ':' + modo;
    const a = this.acao(nome);
    if (!a) return;
    a.timeScale = compasso;
    if (chave === this.chave) return;
    const velha = this.atual;
    a.reset();
    a.setLoop(modo === 'laco' ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = modo !== 'laco';
    if (modo === 'fim') { a.time = a.getClip().duration - 0.01; a.paused = true; }
    if (modo === 'segura') { a.time = a.getClip().duration * segura; a.paused = true; }
    // fase aleatória por cavalo nos laços (a manada não anda em passo de desfile)
    if (modo === 'laco') a.time = ((this.seed % 997) / 997) * a.getClip().duration;
    a.enabled = true; a.setEffectiveWeight(1); a.play();
    if (velha && velha !== a) velha.crossFadeTo(a, fade, false);
    this.atual = a; this.chave = chave;
  }
  // a = nome da ação; attrs = [sexo, crescimento*100, pelagem, prenhe, domado*100, montado, olhar|0, anos*10]
  // pos/rumo: onde o corpo está; molhado: na água; olharPara: [x,y,z] ou null
  atualizar(dt, a, pos, rumo, attrs, molhado, olharPara) {
    this.t += dt;
    // velocidade e giro medidos no próprio corpo (o que a física fez de verdade)
    if (this.ultimo && dt > 0) {
      const v = Math.hypot(pos[0] - this.ultimo[0], pos[2] - this.ultimo[2]) / dt;
      this.vel += (Math.min(v, 16) - this.vel) * (1 - Math.exp(-dt * 6));
      const dg = ((rumo - this.ultimo[3] + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI;
      this.giro += (dg / dt - this.giro) * (1 - Math.exp(-dt * 4));
    }
    this.ultimo = [pos[0], pos[1], pos[2], rumo];
    // aparência
    const macho = attrs?.[0] === 1, cres = (attrs?.[1] ?? 100) / 100, pel = attrs?.[2] ?? 0, domado = (attrs?.[4] ?? 0) >= 50 || attrs?.[5] === 1;
    const s = ESCALA * cres * (macho ? 1 : 0.95);
    this.raiz.scale.setScalar(s);
    this.afunda = molhado && (this.vel > 0.3 || a === 'nadar') ? 0.75 * cres : 0;
    this.raiz.position.set(pos[0], pos[1] - this.afunda, pos[2]);
    this.raiz.rotation.set(0, rumo, 0);
    if (pel !== this.pelagem) { this.pelagem = pel; const m = this.prep.mats[pel % this.prep.mats.length]; this.modelo.traverse((o) => { if (o.isMesh) { const orig = o.userData.matOrig || (o.userData.matOrig = o.material); o.material = m.get(orig) || orig; } }); }
    for (const o of this.sela) o.visible = domado;
    // clipe
    const v = this.vel, nadando = molhado && (v > 0.3 || a === 'nadar');
    let clipe, compasso = 1, modo = 'laco';
    if (nadando) { clipe = Math.abs(this.giro) > 0.4 ? (this.giro > 0 ? 'Swim_L' : 'Swim_R') : 'Swim'; compasso = Math.max(0.6, Math.min(1.4, v / 1.5)); }
    else if (LOCOMOVE.has(a) && v > (a === 'pastar' ? 0.6 : 0.3)) {
      const vira = Math.abs(this.giro) > 0.45 ? (this.giro > 0 ? '_L' : '_R') : '';
      if (v < 2.6) { clipe = 'Walk' + vira; compasso = Math.max(0.55, Math.min(1.6, v / 1.6)); }
      else if (v < 5.6) { clipe = 'Trot'; compasso = 1.15 + (v - 2.6) * 0.12; }
      else { clipe = 'Gallop' + vira; compasso = v < 7.5 ? 1.0 + (v - 5.6) * 0.1 : Math.min(1.7, 1.2 + (v - 7.5) * 0.09); }
    } else {
      const m = MAPA[a] || MAPA.parado;
      [clipe, compasso, modo] = m;
      if (a === 'parado' && (this.seed & 3) === 1) clipe = '3 Ilde';
    }
    this.tocar(clipe, compasso, modo, modo === 'fim' ? 1.6 : 0.35);
    this.mixer.update(dt);
    this.raiz.updateMatrixWorld(true);
    // gestos por cima do clipe
    const k = 1 - Math.exp(-dt * 3);
    const quer = (alvo, atual) => atual + (alvo - atual) * k;
    this.cauda = quer(a === 'urinar' || a === 'defecar' ? 0.75 : a === 'aceitar' ? 0.6 : 0, this.cauda);
    this.estica = quer(a === 'urinar' && macho ? 1 : 0, this.estica);
    this.ergue = quer(a === 'relinchar' ? 0.35 : a === 'alerta' ? 0.15 : a === 'cortejar' ? 0.2 : 0, this.ergue);
    this.boca = quer(a === 'relinchar' && Math.sin(this.t * 7) > -0.2 ? 0.35 : 0, this.boca);
    const direita = _ax.set(-Math.cos(rumo), 0, Math.sin(rumo)).clone();
    const cima = new THREE.Vector3(0, 1, 0);
    if (this.cauda > 0.01) { girar(this.ossos.get(OSSO.cauda), direita, -this.cauda); girar(this.ossos.get(OSSO.cauda1), direita, -this.cauda * 0.4); }
    if (this.estica > 0.01) {
      girar(this.ossos.get(OSSO.coxaE), direita, -this.estica * 0.32); girar(this.ossos.get(OSSO.coxaD), direita, -this.estica * 0.32);
      girar(this.ossos.get(OSSO.bracoE), direita, this.estica * 0.12); girar(this.ossos.get(OSSO.bracoD), direita, this.estica * 0.12);
    }
    if (this.ergue > 0.01) for (const n of OSSO.pescoco.slice(0, 2)) girar(this.ossos.get(n), direita, -this.ergue * 0.5);
    if (this.boca > 0.01) girar(this.ossos.get(OSSO.queixo), direita, this.boca);
    // olhar: pescoço e cabeça viram para o que o cavalo observa (até ~70°), só parado ou andando devagar
    let alvo = 0;
    if (olharPara && v < 2 && ['parado', 'alerta', 'cheirar', 'cortejar', 'relinchar', 'aceitar', 'andar', 'montado'].includes(a)) {
      const dx = olharPara[0] - pos[0], dz = olharPara[2] - pos[2];
      const dif = ((Math.atan2(dx, dz) - rumo + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI;
      alvo = Math.max(-1.2, Math.min(1.2, dif));
    }
    this.olhar = quer(alvo, this.olhar);
    if (Math.abs(this.olhar) > 0.01) { for (const n of OSSO.pescoco) girar(this.ossos.get(n), cima, this.olhar * 0.17); girar(this.ossos.get(OSSO.cabeca), cima, this.olhar * 0.3); }
    // dormindo: a respiração mexe a barriga
    if (a === 'dormir' || a === 'dormir_pe' || a === 'deitar') { const b = this.ossos.get(OSSO.coluna); if (b) girar(b, direita, Math.sin(this.t * 1.3) * 0.015); }
  }
  descartar() { this.mixer.stopAllAction(); this.raiz.removeFromParent(); }
}

export async function carregarCavalo(url = '/kraft-cliente/assets/fauna/cavalo/cavalo-real.glb') {
  const { GLTFLoader } = await import('../../vendor/three-gltf.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  return prepararCavalo(gltf);
}
