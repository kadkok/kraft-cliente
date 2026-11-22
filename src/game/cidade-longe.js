// LAVRA — a Ilha Metrópole vista de longe (19/11/2026). O jogo só carrega ~150 m de mundo em volta de quem olha, e a
// cidade tem torres a 300 m da costa: do mar e da balsa ela sumiria. Aqui cada prédio da ficha da cidade
// (shared/cidade.js → predios) ganha uma caixa simples, todas numa única malha instanciada, que aparece só enquanto o
// pedaço de mundo de verdade daquele prédio ainda não está desenhado — chegou perto, a caixa sai e fica o prédio.
// As caixas usam as coordenadas do mundo, como o relevo das ilhas.
// Enfeite só do aparelho: não muda bloco, colisão nem lei.
import * as THREE from '../three.js';
import { U } from '../render/materials.js';
import { ckey } from '../../shared/constants.js';

const CHAO = 52;
const COR = { torre: [0.24, 0.3, 0.38], escritorio: [0.3, 0.3, 0.32], reboco: [0.4, 0.36, 0.28], tijolo: [0.24, 0.2, 0.18], casa: [0.34, 0.24, 0.2], loja: [0.36, 0.33, 0.29],
  farol: [0.5, 0.5, 0.48], 'torre-relogio': [0.4, 0.35, 0.25], mercado: [0.3, 0.24, 0.19], estadio: [0.3, 0.31, 0.33] };

export function initCidadeLonge({ game, scene, camera, world }) {
  let genRef = null, malha = null, lista = [], cid = null;
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), S = new THREE.Vector3(), Q = new THREE.Quaternion(), cam = new THREE.Vector3(), cor = new THREE.Color();
  function desmonta() { if (malha) { scene.remove(malha); malha.geometry.dispose(); malha.material.dispose(); malha = null; } lista = []; cid = null; }
  function monta(gen) {
    desmonta();
    const il = (game.dim || 0) === 0 ? gen?.arq?.ilhas?.find((i) => i.tema === 5) : null;
    let c = null; try { c = il?.cidade; } catch { c = null; }
    if (!c?.predios?.length) return;
    cid = { x: il.x, z: il.z, r: il.r };
    for (const p of c.predios) {
      const alt = p.tipo === 'estadio' ? 15 : Math.min(70, (p.altura || CHAO + 4) - CHAO);
      if (alt < 3) continue;
      const v = 0.86 + 0.28 * (Math.abs(Math.sin(p.id * 12.9898) * 43758.5453) % 1);
      lista.push({ x: (p.x0 + p.x1 + 1) / 2, z: (p.z0 + p.z1 + 1) / 2, w: p.x1 - p.x0 + 0.4, d: p.z1 - p.z0 + 0.4, h: alt, c: (COR[p.tipo] || COR.reboco).map((k) => k * v), k: ckey(Math.floor((p.x0 + p.x1) / 32), Math.floor((p.z0 + p.z1) / 32)) });
    }
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
    malha = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.85, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0 }), lista.length);
    malha.name = 'cidade-de-longe'; malha.frustumCulled = false; malha.castShadow = false; malha.receiveShadow = false; malha.renderOrder = 4;
    scene.add(malha);
  }
  let relogio = 0;
  game.hooks.frame.push((dt) => {
    if (game.gen !== genRef) { genRef = game.gen; monta(game.gen); relogio = 0; }
    if (!malha) return;
    camera.getWorldPosition(cam);
    const longe = Math.hypot(cam.x - cid.x, cam.z - cid.z);
    if (longe > 5200) { malha.visible = false; return; }
    malha.visible = true;
    // de perto as caixas mudam conforme o mundo carrega: confere a cada quadro; de longe, basta 4 vezes por segundo
    if (longe > cid.r + 500 && (relogio -= dt) > 0) return;
    relogio = 0.25;
    const dia = Math.min(1, Math.max(0, ((U.uSunDir?.value?.y ?? 1) + 0.08) / 0.3));
    malha.material.emissiveIntensity = (1 - dia) * 0.05;
    for (let i = 0; i < lista.length; i++) {
      const p = lista[i];
      if (world.chunks.get(p.k)?.hasMesh) { S.set(0, 0, 0); P.set(p.x, -50, p.z); M.compose(P, Q, S); malha.setMatrixAt(i, M); continue; }   // o prédio de verdade já está lá
      const d = Math.hypot(p.x - cam.x, CHAO - cam.y, p.z - cam.z);
      P.set(p.x, CHAO, p.z); S.set(p.w, p.h, p.d);
      M.compose(P, Q, S); malha.setMatrixAt(i, M);
      // bruma: quanto mais longe, mais perto da cor do ar
      const br = 1 - Math.exp(-d * 0.00075);
      cor.setRGB(p.c[0] + (0.4 - p.c[0]) * br, p.c[1] + (0.47 - p.c[1]) * br, p.c[2] + (0.56 - p.c[2]) * br); malha.setColorAt(i, cor);
    }
    malha.instanceMatrix.needsUpdate = true; if (malha.instanceColor) malha.instanceColor.needsUpdate = true;
  });
  return { get n() { return lista.length; } };
}
