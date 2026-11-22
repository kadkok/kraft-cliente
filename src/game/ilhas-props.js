// LAVRA — Modelos 3D (.glb Meshy + Blender) das ilhas temáticas, cais e balsas:
//   - Ilha Selvagem: totens antigos musgosos (totem-selvagem.glb) e tufos de plantas tropicais (planta-selvagem.glb)
//   - Ilha do Vulcão: fumarolas rochosas (fumarola-vulcao.glb) e aglomerados de obsidiana/enxofre (obsidiana-vulcao.glb)
//   - Cais e Balsas: sino naval de bronze nos cais (sino-cais.glb), timão nas balsas (timao-balsa.glb) e bóias de canal (boia-mar.glb)
// Cache compartilhado por URL, InstancedMesh por modelo com corte por distância (60 fps) e dispose() completo de GPU.
import * as THREE from '../three.js';
import { SEA } from '../../shared/constants.js';
import { CAIS, CAIS_DIRS, caisPonto } from '../../shared/cais.js';
import { MAR_NIVEL } from '../../shared/mar.js';
import { hash3 } from '../../shared/noise.js';

export const MODELOS_ILHAS = Object.freeze({
  totemSelvagem: '/kraft-cliente/assets/ilhas/totem-selvagem.glb',
  plantaSelvagem: '/kraft-cliente/assets/ilhas/planta-selvagem.glb',
  fumarolaVulcao: '/kraft-cliente/assets/ilhas/fumarola-vulcao.glb',
  obsidianaVulcao: '/kraft-cliente/assets/ilhas/obsidiana-vulcao.glb',
  sinoCais: '/kraft-cliente/assets/ilhas/sino-cais.glb',
  timaoBalsa: '/kraft-cliente/assets/ilhas/timao-balsa.glb',
  boiaMar: '/kraft-cliente/assets/ilhas/boia-mar.glb',
});

let loaderP = null;
const cacheModelos = new Map();

function marcarCompartilhado(root) {
  let meshPrincipal = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!meshPrincipal) meshPrincipal = o;
    if (o.geometry) {
      o.geometry.userData = o.geometry.userData || {};
      o.geometry.userData.shared = true;
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      m.userData = m.userData || {};
      m.userData.shared = true;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
    }
  });
  return meshPrincipal;
}

function descartarMaterial(m) {
  if (!m) return;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
    if (m[k] && typeof m[k].dispose === 'function') m[k].dispose();
  }
  if (typeof m.dispose === 'function') m.dispose();
}

export function carregarModeloIlha(url, customLoader = null) {
  if (cacheModelos.has(url)) return cacheModelos.get(url);
  const p = (customLoader
    ? Promise.resolve(customLoader)
    : (loaderP ||= import('../../vendor/three-gltf.js').then((m) => new m.GLTFLoader()))
  ).then((loader) => loader.loadAsync(url)).then((gltf) => {
    const root = gltf.scene || gltf.scenes?.[0];
    const mesh = root ? marcarCompartilhado(root) : null;
    if (!mesh) throw new Error(`Modelo sem malha: ${url}`);
    const item = { url, gltf, root, mesh, geometry: mesh.geometry, material: mesh.material };
    cacheModelos.set(url, Promise.resolve(item));
    cacheModelos.set(url + ':val', item);
    return item;
  });
  cacheModelos.set(url, p);
  return p;
}

export function limparCacheModelosIlha() {
  for (const [k, v] of cacheModelos.entries()) {
    if (!k.endsWith(':val') || !v) continue;
    v.root?.traverse?.((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach(descartarMaterial);
      else descartarMaterial(o.material);
    });
  }
  cacheModelos.clear();
}

// Sorteio determinístico [0..1) a partir de inteiros
const rnd01 = (a, b, c, s = 0x51e7) => (hash3(a | 0, b | 0, c | 0, s) >>> 8) / 16777216;

// Calcula as posições determinísticas dos modelos 3D nas ilhas e nos cais (puro, funciona em Node e no navegador).
export function calcularPropsIlhas(gen) {
  const out = {
    selvagem: { totens: [], plantas: [] },
    vulcao: { fumarolas: [], obsidianas: [] },
    cais: { sinos: [], boias: [] },
  };
  const arq = gen?.arq;
  if (!arq) return out;
  const H = (x, z) => gen.height(Math.round(x), Math.round(z));

  // 1) Ilha Selvagem: totens guardiões no cais, na lagoa/cachoeira e em clareiras + plantas tropicais gigantes
  const ilSelv = (arq.ilhas || []).find((i) => i.ficha?.tema === 'selvagem' || i.id === 'selvagem');
  if (ilSelv) {
    const c = ilSelv.ficha?.cais;
    if (Array.isArray(c) && c.length >= 4) {
      const d = CAIS_DIRS[c[2]], yawCais = Math.atan2(d[0], d[1]);
      for (const a of [-3.5, 3.5]) {
        const [px, pz] = caisPonto(c, -1, a);
        const y = Math.max(CAIS.deck, H(px, pz) + 1);
        out.selvagem.totens.push({ x: px + 0.5, y, z: pz + 0.5, yaw: yawCais, escala: 1.05, local: 'cais' });
      }
      for (const t of [-2, -5]) for (const a of [-4.8, 4.8]) {
        const [px, pz] = caisPonto(c, t, a);
        const y = Math.max(SEA + 1, H(px, pz) + 0.9);
        out.selvagem.plantas.push({ x: px + 0.5, y, z: pz + 0.5, yaw: rnd01(px, pz, 11) * 6.2832, escala: 0.95 });
      }
    }
    if (ilSelv.lagoa) {
      const lx = Math.round(ilSelv.lagoa.x), lz = Math.round(ilSelv.lagoa.z), lr = ilSelv.lagoa.raio || 36;
      const tx = lx - Math.round(lr * 0.75), tz = lz - 6, ty = H(tx, tz);
      if (ty >= SEA + 1) out.selvagem.totens.push({ x: tx + 0.5, y: ty + 1, z: tz + 0.5, yaw: Math.atan2(lx - tx, lz - tz), escala: 1.12, local: 'lagoa' });
    }
    if (ilSelv.cachoeira) {
      const wc = ilSelv.cachoeira;
      const tx = Math.round(wc.x - wc.dx * 8 - wc.dz * 6), tz = Math.round(wc.z - wc.dz * 8 + wc.dx * 6), ty = H(tx, tz);
      if (ty >= SEA + 2) out.selvagem.totens.push({ x: tx + 0.5, y: ty + 1, z: tz + 0.5, yaw: Math.atan2(wc.x - tx, wc.z - tz), escala: 1.15, local: 'cachoeira' });
    }
    // Totens em clareiras e cristas da selva
    for (let k = 0; k < 28 && out.selvagem.totens.length < 10; k++) {
      const ang = k * 2.39996, r = 34 + (k * 19) % Math.max(60, Math.floor(ilSelv.r * 0.65));
      const x = Math.round(ilSelv.x + Math.cos(ang) * r), z = Math.round(ilSelv.z + Math.sin(ang) * r);
      if (ilSelv.s(x, z) > -24) continue;
      const y = H(x, z);
      if (y < SEA + 3 || y > SEA + 34) continue;
      out.selvagem.totens.push({ x: x + 0.5, y: y + 1, z: z + 0.5, yaw: rnd01(x, z, k) * 6.2832, escala: 0.92 + rnd01(z, x, k) * 0.28, local: 'selva' });
    }
    // Plantas tropicais gigantes espalhadas pela selva, lagoa e encostas
    for (let k = 0; k < 110 && out.selvagem.plantas.length < 44; k++) {
      const ang = k * 2.39996 + 0.4, r = 16 + ((k * 23) % Math.max(80, Math.floor(ilSelv.r * 0.78)));
      const x = Math.round(ilSelv.x + Math.cos(ang) * r), z = Math.round(ilSelv.z + Math.sin(ang) * r);
      if (ilSelv.s(x, z) > -14) continue;
      const y = H(x, z);
      if (y < SEA + 1 || y > SEA + 38) continue;
      out.selvagem.plantas.push({
        x: x + 0.5,
        y: y + 0.85,
        z: z + 0.5,
        yaw: rnd01(x, z, k + 100) * 6.2832,
        escala: 0.75 + rnd01(z, x, k + 200) * 0.5,
      });
    }
  }

  // 2) Ilha do Vulcão: fumarolas rochosas na borda da cratera e flancos do cone + aglomerados de obsidiana/enxofre
  const ilVulc = (arq.ilhas || []).find((i) => i.vulcao);
  if (ilVulc && ilVulc.vulcao) {
    const v = ilVulc.vulcao, rc = v.raio || 34;
    // 6 fumarolas na borda da cratera
    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2 + 0.25;
      const dist = rc * (0.98 + (k % 2) * 0.12);
      const x = Math.round(v.x + Math.cos(ang) * dist), z = Math.round(v.z + Math.sin(ang) * dist);
      const y = H(x, z);
      out.vulcao.fumarolas.push({ x: x + 0.5, y: y + 0.45, z: z + 0.5, yaw: ang + Math.PI, escala: 0.88 + (k % 3) * 0.12, local: 'cratera' });
    }
    // 8 fumarolas nos flancos do cone e trilha do cais
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2 + 0.6;
      const dist = rc * (1.55 + (k % 3) * 0.42);
      const x = Math.round(v.x + Math.cos(ang) * dist), z = Math.round(v.z + Math.sin(ang) * dist);
      const y = H(x, z);
      if (y <= SEA + 4) continue;
      out.vulcao.fumarolas.push({ x: x + 0.5, y: y + 0.4, z: z + 0.5, yaw: rnd01(x, z, k) * 6.2832, escala: 0.82 + rnd01(z, x, k) * 0.3, local: 'cone' });
    }
    // Aglomerados de obsidiana/enxofre na borda da cratera, ravinas de lava e base do cone
    for (let k = 0; k < 30; k++) {
      const ang = k * 2.39996 + 0.15;
      const dist = k < 10 ? rc * (0.88 + (k % 3) * 0.14) : rc * (1.25 + ((k * 17) % 100) / 50);
      const x = Math.round(v.x + Math.cos(ang) * dist), z = Math.round(v.z + Math.sin(ang) * dist);
      const y = H(x, z);
      if (y <= SEA + 2) continue;
      out.vulcao.obsidianas.push({
        x: x + 0.5,
        y: y + 0.55,
        z: z + 0.5,
        yaw: rnd01(x, z, k + 300) * 6.2832,
        escala: 0.8 + rnd01(z, x, k + 400) * 0.45,
      });
    }
    const cv = ilVulc.ficha?.cais;
    if (Array.isArray(cv) && cv.length >= 4) {
      for (const a of [-4.5, 4.5]) {
        const [ox, oz] = caisPonto(cv, -3, a);
        const oy = Math.max(SEA + 1, H(ox, oz) + 0.8);
        out.vulcao.obsidianas.push({ x: ox + 0.5, y: oy, z: oz + 0.5, yaw: rnd01(ox, oz, 55) * 6.2832, escala: 0.95 });
      }
    }
  }

  // 3) Cais e canal marítimo: um sino naval de bronze na cabeça de cada cais e par de bóias de canal na aproximação
  for (const q of arq.portos || []) {
    const c = q.cais;
    if (!Array.isArray(c) || c.length < 4) continue;
    const L = c[3], d = CAIS_DIRS[c[2]];
    const [sx, sz] = caisPonto(c, L + 1, 2.2);
    const yawSino = Math.atan2(-d[1], d[0]);
    out.cais.sinos.push({ id: q.id, x: sx + 0.5, y: CAIS.deck + 1, z: sz + 0.5, yaw: yawSino, escala: 1.0 });
    for (const [dt, a] of [[16, -10], [16, 10], [44, -13], [44, 13]]) {
      const [bx, bz] = caisPonto(c, L + CAIS.cabeca + dt, a);
      out.cais.boias.push({
        id: q.id,
        x: bx + 0.5,
        y: MAR_NIVEL,
        z: bz + 0.5,
        yaw: rnd01(bx, bz, dt) * 6.2832,
        fase: rnd01(bz, bx, dt) * 6.2832,
        escala: 1.0,
      });
    }
  }
  return out;
}

function criarInstancias(item, lista, pc) {
  if (!item || !lista.length) return null;
  const im = new THREE.InstancedMesh(item.geometry, item.material, lista.length);
  im.castShadow = !!pc;
  im.receiveShadow = true;
  im.frustumCulled = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw || 0, 0);
    dummy.scale.setScalar(p.escala || 1);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  }
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  im.boundingSphere.radius += 4; // inclui o balanço das boias na maré
  return im;
}

export function initIlhasProps({ game, scene, camera, customLoader = null }) {
  const pc = game.plataforma === 'pc' || !game.plataforma;
  const grupo = new THREE.Group();
  grupo.name = 'ilhas-props-3d';
  const grupoSelvagem = new THREE.Group();
  grupoSelvagem.name = 'ilhas-props-selvagem';
  const grupoCais = new THREE.Group();
  grupoCais.name = 'ilhas-props-cais';
  grupo.add(grupoSelvagem, grupoCais);
  scene.add(grupo);

  let genRef = null, dados = null, meshTotens = null, meshPlantas = null;
  const portos = [];
  let tokenMontagem = 0, destruido = false;
  const posCam = new THREE.Vector3(), dummy = new THREE.Object3D();

  function limparMalhas() {
    for (const m of [meshTotens, meshPlantas, ...portos.map(p => p.mesh)]) {
      if (!m) continue;
      m.parent?.remove(m);
      m.dispose?.();
    }
    meshTotens = meshPlantas = null;
    portos.length = 0;
  }

  function montarPortos(item, lista, boias) {
    const porPorto = new Map();
    for (const p of lista) {
      if (!porPorto.has(p.id)) porPorto.set(p.id, []);
      porPorto.get(p.id).push(p);
    }
    for (const pontos of porPorto.values()) {
      const mesh = criarInstancias(item, pontos, pc);
      grupoCais.add(mesh);
      portos.push({ mesh, pontos, boias });
    }
  }

  function montar(gen) {
    limparMalhas();
    dados = null;
    const meuToken = ++tokenMontagem;
    if (destruido || !gen?.arq || (game.dim || 0) !== 0) return;
    dados = calcularPropsIlhas(gen);

    if (dados.selvagem.totens.length) {
      carregarModeloIlha(MODELOS_ILHAS.totemSelvagem, customLoader).then((it) => {
        if (destruido || meuToken !== tokenMontagem) return;
        meshTotens = criarInstancias(it, dados.selvagem.totens, pc);
        if (meshTotens) grupoSelvagem.add(meshTotens);
      }).catch(() => {});
    }
    if (dados.selvagem.plantas.length) {
      carregarModeloIlha(MODELOS_ILHAS.plantaSelvagem, customLoader).then((it) => {
        if (destruido || meuToken !== tokenMontagem) return;
        meshPlantas = criarInstancias(it, dados.selvagem.plantas, pc);
        if (meshPlantas) grupoSelvagem.add(meshPlantas);
      }).catch(() => {});
    }
    if (dados.cais.sinos.length) {
      carregarModeloIlha(MODELOS_ILHAS.sinoCais, customLoader).then((it) => {
        if (destruido || meuToken !== tokenMontagem) return;
        montarPortos(it, dados.cais.sinos, false);
      }).catch(() => {});
    }
    if (dados.cais.boias.length) {
      carregarModeloIlha(MODELOS_ILHAS.boiaMar, customLoader).then((it) => {
        if (destruido || meuToken !== tokenMontagem) return;
        montarPortos(it, dados.cais.boias, true);
      }).catch(() => {});
    }
  }

  game.hooks.other.push((m) => {
    if (m.t === 'welcome' || m.t === 'dim') genRef = null;
  });

  game.hooks.frame.push(() => {
    if (destruido) return;
    if (game.gen !== genRef) {
      genRef = game.gen;
      montar(game.gen);
    }
    if (!dados || (game.dim || 0) !== 0) {
      grupo.visible = false;
      return;
    }
    grupo.visible = true;
    camera.getWorldPosition(posCam);

    const ilSelv = game.gen?.arq?.ilhas?.find((i) => i.ficha?.tema === 'selvagem' || i.id === 'selvagem');
    if (ilSelv) {
      const ds = Math.hypot(ilSelv.x - posCam.x, ilSelv.z - posCam.z);
      grupoSelvagem.visible = ds < 980;
    } else {
      grupoSelvagem.visible = false;
    }

    // Anima suavemente as bóias de canal próximas à câmera na ondulação do mar
    const mar = game.mar, tt = performance.now() / 1000;
    for (const { mesh, pontos, boias } of portos) {
      const dist = Math.max(0, mesh.boundingSphere.center.distanceTo(posCam) - mesh.boundingSphere.radius);
      mesh.visible = dist < (pc ? 1100 : 800);
      mesh.castShadow = pc && dist < 165;
      if (!boias || dist > 520) continue;
      let mudou = false;
      for (let i = 0; i < pontos.length; i++) {
        const b = pontos[i];
        if (Math.hypot(b.x - posCam.x, b.z - posCam.z) > 520) continue;
        const yMar = mar?.ligado ? mar.altura(b.x, b.z) : MAR_NIVEL + Math.sin(tt * 1.6 + b.fase) * 0.08;
        const oscX = Math.sin(tt * 1.4 + b.fase) * 0.07;
        const oscZ = Math.cos(tt * 1.2 + b.fase * 1.3) * 0.07;
        dummy.position.set(b.x, yMar, b.z);
        dummy.rotation.set(oscX, b.yaw, oscZ);
        dummy.scale.setScalar(b.escala || 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mudou = true;
      }
      if (mudou) mesh.instanceMatrix.needsUpdate = true;
    }
  });

  const api = {
    grupo,
    grupoSelvagem,
    grupoCais,
    dados: () => dados,
    contagens: () => ({
      totens: dados?.selvagem.totens.length || 0,
      plantas: dados?.selvagem.plantas.length || 0,
      fumarolas: dados?.vulcao.fumarolas.length || 0,
      obsidianas: dados?.vulcao.obsidianas.length || 0,
      sinos: dados?.cais.sinos.length || 0,
      boias: dados?.cais.boias.length || 0,
      malhasAtivas: [meshTotens, meshPlantas].filter(Boolean).length + portos.length,
    }),
    recarregar: () => montar(game.gen),
    dispose: (limparCache = false) => {
      destruido = true;
      tokenMontagem++;
      limparMalhas();
      scene.remove(grupo);
      if (limparCache) limparCacheModelosIlha();
    },
  };
  game.ilhasProps = api;
  return api;
}
