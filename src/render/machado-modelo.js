// LAVRA — o machado realista (pedido do Kadmus, 19/11/2026, com a referência screen.toys/firewood).
//
// Modelo: "Two-Handed Axe" do Free CC0 Melee Weapons Pack (3dmodelscc0, itch.io), CC0. Cabo encurtado para 80 cm e
// texturas a 1024 px (tools/realismo/… e assets/tools/PROCEDENCIA-machado.md). 624 triângulos: serve a todo aparelho.
// Carrega uma vez e entrega no molde das outras ferramentas (render/equipment.js): cabo em +Y, origem onde a mão
// segura. Enquanto não chega (ou se faltar o arquivo), vale o machado de pixel de sempre.
import * as THREE from '../three.js';

let pronto = null, pedido = null;
export const machadoReal = () => pronto;

// Um céu mínimo para o aço refletir (o jogo não tem mapa de ambiente): azul em cima, claro no horizonte, terra embaixo.
function ceuParaReflexo(renderer) {
  if (!renderer) return null;
  const W = 32, H = 16, d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);                       // 0 = embaixo … 1 = em cima
    const c = v > 0.5 ? [150 + (0.5 - (v - 0.5)) * 190, 185 + (0.5 - (v - 0.5)) * 120, 235] : [60 + v * 300, 52 + v * 290, 40 + v * 270];
    for (let x = 0; x < W; x++) { const o = (y * W + x) * 4; d[o] = Math.min(255, c[0]); d[o + 1] = Math.min(255, c[1]); d[o + 2] = Math.min(255, c[2]); d[o + 3] = 255; }
  }
  const t = new THREE.DataTexture(d, W, H);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromEquirectangular(t).texture;
  pm.dispose(); t.dispose();
  return env;
}

export function carregarMachado(renderer) {
  if (pedido) return pedido;
  pedido = import('../../vendor/three-gltf.js')
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync('assets/tools/machado.glb'))
    .then((gltf) => {
      let malha = null;
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => { if (o.isMesh && !malha) malha = o; });
      if (!malha) return null;
      const g = malha.geometry.clone();
      g.applyMatrix4(malha.matrixWorld);
      g.rotateY(-Math.PI / 2);                 // a lâmina (+X no arquivo) passa a apontar para a frente da mão, como a picareta
      g.computeBoundingSphere(); g.userData.shared = true; g.userData.style = 'machado-cc0-3dmodelscc0';
      const m = malha.material;
      m.envMap = ceuParaReflexo(renderer); m.envMapIntensity = 0.9;
      if (m.normalScale) m.normalScale.set(1.15, 1.15);
      m.needsUpdate = true;
      pronto = { geometry: g, material: m };
      return pronto;
    })
    .catch((e) => { console.warn('[machado] modelo realista não carregou; fica o de sempre:', e?.message || e); return null; });
  return pedido;
}
