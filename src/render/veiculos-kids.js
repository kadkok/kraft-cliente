import * as THREE from '../three.js';
import { VEICULOS } from '../../shared/veiculos-kids.js';

let carregador;
const moldes = new Map();
function modelo(tipo) {
  if (!moldes.has(tipo)) {
    const url = new URL('../../assets/veiculos-kids/' + tipo + '.glb', import.meta.url);
    carregador ||= import('../../vendor/three-gltf.js').then(({ GLTFLoader }) => new GLTFLoader());
    moldes.set(
      tipo,
      carregador
        .then((c) => c.loadAsync(url.href))
        .then((g) => g.scene)
        .catch((e) => {
          moldes.delete(tipo);
          throw e;
        }),
    );
  }
  return moldes.get(tipo);
}
export function criarVisual(tipo) {
  const raiz = new THREE.Group(),
    giram = [];
  raiz.name = 'Veículo · ' + VEICULOS[tipo].nome;
  let saiu = false;
  const pronto = modelo(tipo).then((original) => {
    if (saiu) return;
    const copia = original.clone(true);
    copia.scale.setScalar(VEICULOS[tipo].escala);
    copia.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = Array.isArray(o.material)
          ? o.material.some(m => !m.transparent)
          : !o.material.transparent;
        o.receiveShadow = true;
      }
      if (o.name.startsWith('giro_')) giram.push([o, o.name.split('_')[1]]);
      else if (!o.isBone) {
        // A peça acompanha o movimento do pai. Só o pivô animado precisa recompor sua matriz local.
        o.updateMatrix();
        o.matrixAutoUpdate = false;
      }
    });
    raiz.add(copia);
  });
  return {
    raiz,
    pronto,
    atualizar(v, dt) {
      raiz.position.set(v.x, v.y, v.z);
      raiz.rotation.set(v.pitch, v.h, v.roll, 'YXZ');
      for (const [o, eixo] of giram) {
        let taxa = v.v * 3;
        if (tipo === 'helicoptero') taxa = v.rpm * (eixo === 'y' ? 22 : 30);
        if (tipo === 'aviao') taxa = v.rpm > 0 ? 48 * v.rpm : Math.max(0, v.v) * 3;
        o.rotation[eixo] += taxa * dt;
      }
    },
    liberar() {
      saiu = true;
      raiz.removeFromParent();
      raiz.clear();
      giram.length = 0;
    },
  };
}

export function emissaoRastro(v) {
  if (v?.tipo === 'aviao' && v.voo && v.fumaca) return 'fumaca';
  if (v?.tipo !== 'barco' && v?.tipo !== 'submarino') return null;
  if (v.prof < -0.9) return Math.abs(v.vy) > 0.4 ? 'bolhas' : null;
  return Math.abs(v.v) > 1 ? 'espuma' : null;
}

export function criarRastro(scene) {
  const n = 40,
    pos = new Float32Array(n * 3),
    cores = new Float32Array(n * 3);
  let proximo = 0,
    tempo = 0,
    espera = 0;
  const vida = new Float32Array(n), sobe = new Uint8Array(n),
    cor = new THREE.Color();
  pos.fill(-10000);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geom.setAttribute('color', new THREE.BufferAttribute(cores, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.42,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
  });
  const pontos = new THREE.Points(geom, mat);
  pontos.frustumCulled = false;
  pontos.visible = false;
  scene.add(pontos);
  return {
    atualizar(v, dt, emissao = null) {
      if (!emissao && !pontos.visible) return;
      tempo += dt;
      espera -= dt;
      const fuma = emissao === 'fumaca', bolhas = emissao === 'bolhas', espuma = emissao === 'espuma';
      if (emissao && espera <= 0) {
        espera = fuma ? 0.09 : 0.14;
        const i = proximo;
        proximo = (proximo + 1) % n;
        const distancia = VEICULOS[v.tipo].escala * (fuma ? 2 : 1.65);
        const lateral = espuma ? (i % 2 === 0 ? -0.5 : 0.5) : 0;
        const sentido = espuma && v.v < 0 ? -1 : 1;
        pos[i * 3] = v.x - Math.sin(v.h) * distancia * sentido + Math.cos(v.h) * lateral;
        pos[i * 3 + 1] = v.y + (fuma ? 0.25 : bolhas ? 0.5 : 0.02);
        pos[i * 3 + 2] = v.z - Math.cos(v.h) * distancia * sentido - Math.sin(v.h) * lateral;
        if (fuma) cor.setHSL((tempo * 0.35) % 1, 0.8, 0.63);
        else cor.set(0xd1f6ff);
        cor.toArray(cores, i * 3);
        vida[i] = fuma ? 3 : 1.45;
        sobe[i] = espuma ? 0 : 1;
        geom.attributes.color.needsUpdate = true;
      }
      let vis = false;
      for (let i = 0; i < n; i++)
        if (vida[i] > 0) {
          vida[i] -= dt;
          if (vida[i] <= 0) pos[i * 3 + 1] = -10000;
          else {
            vis = true;
            if (sobe[i]) pos[i * 3 + 1] += dt * 0.22;
          }
        }
      if (vis || pontos.visible) geom.attributes.position.needsUpdate = true;
      pontos.visible = vis;
    },
    limpar() {
      vida.fill(0);
      pos.fill(-10000);
      geom.attributes.position.needsUpdate = true;
      pontos.visible = false;
    },
  };
}
