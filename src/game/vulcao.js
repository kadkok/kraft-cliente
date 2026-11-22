// LAVRA — o penacho da Ilha do Vulcão (pedido do Kadmus, 19/11/2026: "outra ilha pode ser a ilha com vulcão"): fumaça
// que sobe da cratera, é levada pelo vento do mundo e se desfaz no alto, e o clarão do lago de lava (forte de noite).
// Enfeite só do aparelho: não muda bloco, colisão nem lei. De onde sai: a ficha da ilha (game.gen.arq.ilhas → vulcao).
// O penacho fica sobre a cratera em coordenadas do mundo, à mesma profundidade do relevo.
import * as THREE from '../three.js';
import { SEA } from '../../shared/constants.js';
import { U } from '../render/materials.js';
import { MODELOS_ILHAS, carregarModeloIlha, calcularPropsIlhas } from './ilhas-props.js';

const ALTO = 170;         // até onde a fumaça sobe acima da cratera (m)
const VIDA = 34;          // segundos de cada baforada, da boca até sumir

function texBaforada() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  let s = 23; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 26; k++) {
    const x = 64 + (rnd() - 0.5) * 56, y = 64 + (rnd() - 0.5) * 56, r = 16 + rnd() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(255,255,255,${(0.16 + rnd() * 0.16).toFixed(3)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  // borda sempre transparente
  const m = g.createRadialGradient(64, 64, 34, 64, 64, 64); m.addColorStop(0, 'rgba(0,0,0,0)'); m.addColorStop(1, 'rgba(0,0,0,1)');
  g.globalCompositeOperation = 'destination-out'; g.fillStyle = m; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function texClarao() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,206,140,0.85)'); gr.addColorStop(0.22, 'rgba(255,120,44,0.34)'); gr.addColorStop(0.55, 'rgba(255,70,16,0.09)'); gr.addColorStop(1, 'rgba(255,60,10,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function initVulcao({ game, scene, camera, customLoader = null }) {
  const pc = game.plataforma === 'pc' || !game.plataforma, N = pc ? 44 : 24;
  const tBaf = texBaforada(), tCl = texClarao();
  const grupo = new THREE.Group(); grupo.name = 'vulcao-penacho'; grupo.visible = false; scene.add(grupo);
  const grupoProps = new THREE.Group(); grupoProps.name = 'vulcao-props-3d'; grupoProps.visible = false; scene.add(grupoProps);
  const bafs = [];
  for (let i = 0; i < N; i++) {
    const m = new THREE.SpriteMaterial({ map: tBaf, transparent: true, depthWrite: false, fog: false, opacity: 0 });
    const sp = new THREE.Sprite(m); sp.renderOrder = 5; grupo.add(sp);
    // cada baforada tem o seu desvio (fixo) para o penacho não ser um tubo liso
    const h = (k) => { const x = Math.sin((i + 1) * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
    bafs.push({ sp, m, fase: i / N + h(1) * 0.02, lx: h(2) - 0.5, lz: h(3) - 0.5, gira: (h(4) - 0.5) * 0.5, gordo: 0.8 + h(5) * 0.5 });
  }
  const mCl = new THREE.SpriteMaterial({ map: tCl, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const clarao = new THREE.Sprite(mCl); clarao.renderOrder = 5; grupo.add(clarao);
  const cam = new THREE.Vector3(), cor = new THREE.Color(), dummy = new THREE.Object3D();
  let vento = [2, 1], genRef = null, dadosVulcao = null, meshFumarolas = null, meshObsidianas = null;
  let token = 0, destruido = false;

  function limparProps() {
    for (const m of [meshFumarolas, meshObsidianas]) {
      if (!m) continue;
      m.parent?.remove(m);
      m.dispose?.();
    }
    meshFumarolas = meshObsidianas = null;
  }

  function criarInstancias(item, lista) {
    if (!item || !lista?.length) return null;
    const im = new THREE.InstancedMesh(item.geometry, item.material, lista.length);
    im.castShadow = !!pc;
    im.receiveShadow = true;
    im.frustumCulled = false;
    for (let i = 0; i < lista.length; i++) {
      const p = lista[i];
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.yaw || 0, 0);
      dummy.scale.setScalar(p.escala || 1);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    return im;
  }

  function montarProps(gen) {
    limparProps();
    dadosVulcao = null;
    if (destruido || !gen?.arq || (game.dim || 0) !== 0) return;
    dadosVulcao = calcularPropsIlhas(gen).vulcao;
    const meuToken = ++token;
    if (dadosVulcao.fumarolas.length) {
      carregarModeloIlha(MODELOS_ILHAS.fumarolaVulcao, customLoader).then((it) => {
        if (destruido || meuToken !== token) return;
        meshFumarolas = criarInstancias(it, dadosVulcao.fumarolas);
        if (meshFumarolas) grupoProps.add(meshFumarolas);
      }).catch(() => {});
    }
    if (dadosVulcao.obsidianas.length) {
      carregarModeloIlha(MODELOS_ILHAS.obsidianaVulcao, customLoader).then((it) => {
        if (destruido || meuToken !== token) return;
        meshObsidianas = criarInstancias(it, dadosVulcao.obsidianas);
        if (meshObsidianas) grupoProps.add(meshObsidianas);
      }).catch(() => {});
    }
  }

  game.hooks.other?.push?.((m) => {
    if (m.t === 'welcome' || m.t === 'dim') genRef = null;
  });

  game.hooks.frame.push((dt) => {
    if (destruido) return;
    if (game.gen !== genRef) { genRef = game.gen; montarProps(game.gen); }
    const il = (game.dim || 0) === 0 ? game.gen?.arq?.ilhas?.find((i) => i.vulcao) : null;
    if (!il) { grupo.visible = false; grupoProps.visible = false; return; }
    const v = il.vulcao, boca = [v.x, SEA + v.borda + 2, v.z], lago = SEA + v.piso + 3;
    camera.getWorldPosition(cam);
    const d = Math.hypot(boca[0] - cam.x, boca[1] - cam.y, boca[2] - cam.z);
    grupoProps.visible = d < 980;
    if (d > 9000) { grupo.visible = false; return; }
    grupo.visible = true;
    const [ox, oy, oz] = boca;
    const w = game.weather?.wind; if (w) { vento[0] += (w[0] - vento[0]) * Math.min(1, dt * 0.3); vento[1] += (w[1] - vento[1]) * Math.min(1, dt * 0.3); }
    const dia = Math.min(1, Math.max(0, ((U.uSunDir?.value?.y ?? 1) + 0.08) / 0.3)), t = performance.now() / 1000;
    for (const b of bafs) {
      const a = (t / VIDA + b.fase) % 1, a2 = a * a;
      // sobe depressa na boca e vai parando; o vento deita o penacho; abre em leque
      const sobe = ALTO * (1 - (1 - a) * (1 - a)), abre = 6 + 70 * a2;
      const x = vento[0] * 9 * a2 * VIDA / 10 + b.lx * abre + Math.sin(t * 0.21 + b.fase * 40) * 3 * a;
      const z = vento[1] * 9 * a2 * VIDA / 10 + b.lz * abre + Math.cos(t * 0.17 + b.fase * 31) * 3 * a;
      b.sp.position.set(ox + x, oy + sobe, oz + z);
      const tam = (16 + 92 * a) * b.gordo; b.sp.scale.set(tam, tam, 1);
      b.m.rotation = b.gira * t * 0.2 + b.fase * 6;
      b.m.opacity = Math.min(1, a * 9) * (1 - a) * (1 - a) * 0.95;
      // cinza escuro na boca, mais claro no alto; de noite some no escuro, menos o pé, aceso pela lava
      const claro = 0.1 + 0.42 * a, brasa = (1 - Math.min(1, a * 5)) * (1.6 - dia * 1.2);
      cor.setRGB((claro * (0.2 + 0.8 * dia)) + brasa * 1.0, (claro * (0.2 + 0.8 * dia)) * 0.97 + brasa * 0.32, (claro * (0.2 + 0.8 * dia)) * 0.95 + brasa * 0.06);
      b.m.color.copy(cor);
    }
    // clarão sobre o lago de lava
    clarao.position.set(ox, lago + 8, oz);
    const pulsa = 0.85 + 0.15 * Math.sin(t * 1.7) * Math.sin(t * 0.63);
    clarao.scale.set(110 * pulsa, 74 * pulsa, 1);
    mCl.opacity = (0.22 + 0.4 * (1 - dia)) * pulsa;
  });
  const api = {
    grupo,
    grupoProps,
    contagens: () => ({
      fumarolas: dadosVulcao?.fumarolas.length || 0,
      obsidianas: dadosVulcao?.obsidianas.length || 0,
      malhasAtivas: [meshFumarolas, meshObsidianas].filter(Boolean).length,
    }),
    dispose() {
      destruido = true;
      token++;
      limparProps();
      for (const b of bafs) b.m.dispose();
      mCl.dispose();
      tBaf.dispose();
      tCl.dispose();
      scene.remove(grupo);
      scene.remove(grupoProps);
    },
  };
  game.vulcao = api;
  return api;
}
