// LAVRA — peças com geometria própria (roda, hélice, asa, canhão, assento, balão) e a malha
// de blocos de uma máquina. Usa os materiais padrão do three com as texturas dos blocos.

import * as THREE from '../three.js';
import {
  TEX, TEX_INDEX, KIND, FUNC, FACING, DIRS, K_CUBE, K_CUTOUT, K_MODEL,
  F_WHEEL, F_WING, F_PROPELLER, F_CANNON, F_SEAT, F_BALLOON,
} from '../../shared/blocks.js';

export function createParts(icons) {
  const mats = new Map();
  function mat(layer, cut) {
    const key = layer + (cut ? 'c' : '');
    let m = mats.get(key);
    if (!m) {
      const t = new THREE.CanvasTexture(icons().layerCanvas(layer));
      t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
      m = new THREE.MeshLambertMaterial({ map: t, alphaTest: cut ? 0.5 : 0, side: cut ? THREE.DoubleSide : THREE.FrontSide });
      mats.set(key, m);
    }
    return m;
  }
  const L = (name) => mat(TEX_INDEX[name]);
  const G = {};
  const geo = (name, make) => (G[name] ||= make());
  const zAxis = new THREE.Vector3(0, 0, 1), v = new THREE.Vector3();
  const mesh = (g, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; };

  // Monta a peça do bloco `id`, centrada na célula. userData: { spin, wheel } quando houver parte móvel.
  function build(id) {
    const fn = FUNC[id], f = FACING[id];
    const root = new THREE.Group();
    if (fn === F_WHEEL) {
      const g = geo('wheel', () => { const c = new THREE.CylinderGeometry(0.5, 0.5, 0.44, 22); c.rotateZ(Math.PI / 2); return c; });
      const w = new THREE.Mesh(g, [L('tire'), L('hubcap'), L('hubcap')]);
      const holder = new THREE.Group(); holder.add(w); root.add(holder);
      if (f === 4) root.rotation.y = Math.PI / 2;
      root.userData.wheel = holder; root.userData.spin = w; root.userData.spinAxis = 'x';
    } else if (fn === F_WING) {
      root.add(mesh(geo('wing', () => new THREE.BoxGeometry(1, 0.14, 1)), L('wing')));
      if (f === 0) root.rotation.z = Math.PI / 2; else if (f === 4) root.rotation.x = Math.PI / 2;
    } else if (fn === F_PROPELLER) {
      root.add(mesh(geo('hub', () => { const c = new THREE.CylinderGeometry(0.13, 0.2, 0.62, 12); c.rotateX(Math.PI / 2); return c; }), L('metal_dark'), 0, 0, -0.12));
      const spin = new THREE.Group(); spin.position.z = 0.2;
      for (let i = 0; i < 3; i++) {
        const b = mesh(geo('blade', () => { const c = new THREE.BoxGeometry(0.17, 0.5, 0.035); c.translate(0, 0.27, 0); return c; }), L('blade'));
        b.rotation.z = i * 2.094; b.rotation.order = 'ZYX'; b.rotation.y = 0.35;
        spin.add(b);
      }
      spin.add(mesh(geo('nose', () => { const c = new THREE.ConeGeometry(0.13, 0.22, 12); c.rotateX(Math.PI / 2); return c; }), L('steel'), 0, 0, 0.12));
      root.add(spin);
      root.quaternion.setFromUnitVectors(zAxis, v.fromArray(DIRS[f]));
      root.userData.spin = spin; root.userData.spinAxis = 'z';
    } else if (fn === F_CANNON) {
      root.add(mesh(geo('cbase', () => new THREE.BoxGeometry(0.76, 0.76, 0.5)), L('steel'), 0, 0, -0.25));
      root.add(mesh(geo('barrel', () => { const c = new THREE.CylinderGeometry(0.2, 0.24, 0.72, 14); c.rotateX(Math.PI / 2); return c; }), L('metal_dark'), 0, 0, 0.14));
      root.add(mesh(geo('muzzle', () => { const c = new THREE.CylinderGeometry(0.25, 0.25, 0.1, 14); c.rotateX(Math.PI / 2); return c; }), L('metal_dark'), 0, 0, 0.45));
      root.quaternion.setFromUnitVectors(zAxis, v.fromArray(DIRS[f]));
    } else if (fn === F_SEAT) {
      root.add(mesh(geo('sbase', () => new THREE.BoxGeometry(0.7, 0.14, 0.7)), L('metal_dark'), 0, -0.43, 0));
      root.add(mesh(geo('scush', () => new THREE.BoxGeometry(0.82, 0.2, 0.8)), L('seat'), 0, -0.27, 0));
      root.add(mesh(geo('sback', () => new THREE.BoxGeometry(0.82, 0.72, 0.16)), L('seat'), 0, 0.12, 0.34));
      // modelado olhando para -Z; gira em Y até a direção do assento
      const d = DIRS[f];
      root.rotation.y = Math.atan2(-d[0], -d[2]);
    } else if (fn === F_BALLOON) {
      root.add(mesh(geo('balloon', () => new THREE.SphereGeometry(0.5, 18, 12)), L('balloon')));
    }
    return root;
  }

  const FACE = [ // normal, e os 4 cantos em ordem anti-horária vistos de fora
    [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
    [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
    [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
  ];
  const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

  // Malha dos blocos cúbicos de uma máquina (faces internas removidas), em torno do centro de massa.
  function blockMesh(blocks, com) {
    const occ = new Map();
    for (const b of blocks) if (KIND[b[3]] === K_CUBE || KIND[b[3]] === K_CUTOUT) occ.set(b[0] + ',' + b[1] + ',' + b[2], b[3]);
    const byLayer = new Map();
    for (const [x, y, z, id] of blocks) {
      const kind = KIND[id];
      if (kind !== K_CUBE && kind !== K_CUTOUT) continue;
      for (let d = 0; d < 6; d++) {
        const [n, c] = FACE[d];
        const nb = occ.get((x + n[0]) + ',' + (y + n[1]) + ',' + (z + n[2]));
        if (nb !== undefined && (KIND[nb] === K_CUBE || nb === id)) continue;
        const layer = TEX[id * 6 + d];
        const key = layer + (kind === K_CUTOUT ? 'c' : '');
        let a = byLayer.get(key);
        if (!a) { a = { layer, cut: kind === K_CUTOUT, pos: [], nrm: [], uv: [], idx: [] }; byLayer.set(key, a); }
        const base = a.pos.length / 3;
        for (let i = 0; i < 4; i++) {
          a.pos.push(x + c[i][0] - com[0], y + c[i][1] - com[1], z + c[i][2] - com[2]);
          a.nrm.push(n[0], n[1], n[2]);
          a.uv.push(UV[i][0], UV[i][1]);
        }
        a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const pos = [], nrm = [], uv = [], idx = [], materials = [];
    const g = new THREE.BufferGeometry();
    for (const a of byLayer.values()) {
      const off = pos.length / 3, start = idx.length;
      pos.push(...a.pos); nrm.push(...a.nrm); uv.push(...a.uv);
      for (const i of a.idx) idx.push(i + off);
      g.addGroup(start, a.idx.length, materials.length);
      materials.push(mat(a.layer, a.cut));
    }
    if (!pos.length) return null;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return new THREE.Mesh(g, materials);
  }

  // Peças soltas na grade do mundo: um grupo por chunk, refeito quando a malha do chunk muda.
  function chunkGroup(cx, cz, models) {
    const g = new THREE.Group();
    g.position.set(cx * 16, 0, cz * 16);
    for (let i = 0; i < models.length; i += 5) {
      const id = models[i + 3];
      if (KIND[id] !== K_MODEL) continue;
      const p = build(id);
      p.position.set(models[i] + 0.5, models[i + 1] + 0.5, models[i + 2] + 0.5);
      g.add(p);
    }
    g.updateMatrixWorld(true);
    g.traverse((o) => { o.matrixAutoUpdate = false; if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  return { build, blockMesh, chunkGroup, mat };
}
