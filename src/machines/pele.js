// LAVRA — pele de máquina: um modelo .glb desenhado no lugar dos cubos e das peças de uma máquina cuja lista de blocos
// bate com uma assinatura de shared/barcos-pele.js. É só desenho: física, colisão do casco, assentos e rede continuam
// sendo os dos blocos. O material é o que vier no arquivo (padrão do three); daqui não sai shader nem textura.
//
// Cada arquivo é aberto uma vez (geometria, materiais e texturas ficam com o modelo guardado); cada máquina leva um
// clone, que divide tudo isso com os outros. Por isso NADA do modelo é descartado quando a máquina some.
//
// vestir(m, pele) deixa em m.pele = { nome, arquivo, pronta, erro, no, tris, fim }:
//   pronta  o modelo está em m.g e os cubos foram escondidos
//   erro    por que o arquivo não abriu (os cubos ficam, e a máquina volta a ser uma máquina de blocos comum)
//   no      o grupo do modelo dentro de m.g (centro da caixa do modelo na origem dele)
//   tris    triângulos do modelo (para quem mede o peso)
//   fim     promessa que se cumpre quando o modelo chegou ou falhou (nunca rejeita)
//   (e, de uso daqui: malhas = as malhas do clone; raio = bola em volta do centro de massa que contém o modelo)
// Só modelo parado: animação e esqueleto do arquivo não são tocados (o clone simples não refaz esqueleto).
//
// Mira: vale o que se vê. Com o modelo no lugar, os cubos escondidos deixam de responder ao raio (o casco de blocos
// pode ser mais largo ou mais estreito que o modelo) e quem responde é o modelo. Só que o raio do three contra uma
// malha testa triângulo por triângulo (3,5 ms por raio num modelo de 266 mil, medido): por isso as malhas da pele
// também não respondem ao raio comum (raycast vazio) e quem quer saber se a mira está num modelo pergunta a mira(),
// que dosa a conta.

import * as THREE from '../three.js';

const ZERO = [0, 0, 0];
const SEM_RAIO = () => {};
const MIRA_MS = 120;            // de quanto em quanto tempo a mira refaz a conta contra os modelos

// Abre um .glb e devolve a cena dele. O mesmo carregador dos objetos (objects/objects.js), sem depender daquele arquivo.
let loaderP = null;
function abrirGlb(arquivo) {
  loaderP ||= import('../../vendor/three-gltf.js').then((m) => new m.GLTFLoader()).catch((e) => { loaderP = null; throw e; });
  const buf = fetch(arquivo).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); });
  return Promise.all([buf, loaderP]).then(([b, loader]) => new Promise((res, rej) => loader.parse(b, '', res, rej))).then((gltf) => gltf.scene);
}

// abrir(arquivo) → Promise<Object3D>: trocável nos testes (padrão: o .glb do servidor).
export function createPeles({ abrir = abrirGlb } = {}) {
  const modelos = new Map();     // arquivo -> Promise<{ cena, centro, tamanho, tris }>
  const avisados = new Set();

  function carregar(arquivo) {
    let p = modelos.get(arquivo);
    if (p) return p;
    p = Promise.resolve().then(() => abrir(arquivo))
      .then((cena) => {
        cena.updateMatrixWorld(true);
        const caixa = new THREE.Box3().setFromObject(cena, true);   // exata, vértice por vértice (a mesma conta da caixa.py)
        if (caixa.isEmpty()) throw new Error('modelo sem malha');
        let tris = 0;
        cena.traverse((o) => {
          if (o !== cena) o.matrixAutoUpdate = false;               // parado dentro do barco: a matriz local já está feita
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          o.castShadow = !mats.some((x) => x && x.transparent);     // vidro recebe sombra, mas não faz a de uma parede
          o.receiveShadow = true;
          const g = o.geometry;
          tris += g ? (g.index ? g.index.count : g.attributes.position?.count || 0) / 3 : 0;
        });
        return { cena, centro: caixa.getCenter(new THREE.Vector3()), tamanho: caixa.getSize(new THREE.Vector3()), tris: Math.round(tris) };
      });
    modelos.set(arquivo, p);
    p.catch(() => { if (modelos.get(arquivo) === p) modelos.delete(arquivo); });   // não abriu: a próxima máquina tenta de novo
    return p;
  }

  function vestir(m, pele) {
    const e = m.pele = { nome: pele.nome, arquivo: pele.arquivo, pronta: false, erro: null, no: null, tris: 0, fim: null };
    e.fim = carregar(pele.arquivo).then((mod) => {
      if (m.pele !== e) return;                                     // a máquina foi desfeita enquanto o arquivo vinha
      const maior = Math.max(mod.tamanho.x, mod.tamanho.z);
      if (!(pele.comprimento > 0) || !(maior > 0) || !Array.isArray(pele.pos)) throw new Error('registro da pele incompleto');
      const no = new THREE.Group();
      no.name = 'pele';
      const dentro = mod.cena.clone(true);
      dentro.position.sub(mod.centro);                              // centro da caixa do modelo na origem do nó
      dentro.updateMatrix(); dentro.matrixAutoUpdate = false;
      no.add(dentro);
      const malhas = [];
      dentro.traverse((o) => { if (o.isMesh) { malhas.push(o); o.raycast = SEM_RAIO; } });
      // mesma conta dos cubos: o ponto P do casco fica em (P − centro de massa) dentro de m.g
      const c = pele.canto || ZERO, com = m.body.com;
      no.position.set(pele.pos[0] - c[0] - com[0], pele.pos[1] - c[1] - com[1], pele.pos[2] - c[2] - com[2]);
      no.rotation.y = pele.yaw || 0;
      const escala = pele.comprimento / maior;
      no.scale.setScalar(escala);
      no.updateMatrix(); no.matrixAutoUpdate = false;
      e.malhas = malhas;
      e.raio = no.position.length() + mod.tamanho.length() * escala / 2;   // bola em volta do centro de massa que contém o modelo
      // cubos e peças continuam em m.g (as rodas e hélices seguem com seus nós): só não se desenham nem respondem à mira
      for (const f of m.g.children) { f.visible = false; f.traverse((o) => { if (o.isMesh) o.raycast = SEM_RAIO; }); }
      m.g.add(no);
      e.no = no; e.tris = mod.tris; e.pronta = true;
    }).catch((err) => {
      if (m.pele !== e) return;
      e.erro = String(err?.message || err);
      if (!avisados.has(pele.arquivo)) { avisados.add(pele.arquivo); console.warn(`[pele] ${pele.arquivo} não abriu (${e.erro}): ${pele.nome} fica com os blocos.`); }
    });
    return e;
  }

  // Em que máquina com pele a mira (um THREE.Raycaster já apontado, com `far`) bate primeiro: { m, t } ou null.
  // maquinas = Map id → máquina. A conta é refeita a cada MIRA_MS (entre uma e outra vale a última resposta) ou na
  // hora, com `fresco` (quem aperta a tecla de usar não pode agir sobre uma resposta velha).
  const batidas = [];
  let miraT = -Infinity, miraHit = null;
  function mira(raycaster, maquinas, fresco) {
    const agora = performance.now();
    if (!fresco && agora - miraT < MIRA_MS) return miraHit && maquinas.get(miraHit.m.id) === miraHit.m && miraHit.m.pele?.pronta ? miraHit : null;
    miraT = agora; miraHit = null;
    const o = raycaster.ray.origin;
    for (const m of maquinas.values()) {
      const e = m.pele;
      if (!e || !e.pronta) continue;
      const g = m.g.position;                                       // longe demais para o alcance do raio: nem olha as malhas
      if (Math.hypot(g.x - o.x, g.y - o.y, g.z - o.z) > raycaster.far + e.raio) continue;
      batidas.length = 0;
      for (const malha of e.malhas) Object.getPrototypeOf(malha).raycast.call(malha, raycaster, batidas);
      for (const h of batidas) if (!miraHit || h.distance < miraHit.t) miraHit = { m, t: h.distance };
    }
    batidas.length = 0;
    return miraHit;
  }

  // Tira o modelo da máquina (os cubos voltam a aparecer). O modelo guardado e os outros clones não são tocados.
  function despir(m) {
    const e = m.pele;
    if (!e) return;
    m.pele = null;
    if (!e.no) return;
    m.g.remove(e.no);
    for (const f of m.g.children) { f.visible = true; f.traverse((o) => { if (o.raycast === SEM_RAIO) delete o.raycast; }); }
  }

  return { vestir, despir, mira, carregar, modelos };
}
