import * as THREE from '../three.js';
import { TREM, pontoVia, poseVia, tipoVia } from '../../shared/ferrovia.js';

const caixa = new THREE.BoxGeometry(1, 1, 1),
  eixo = new THREE.Vector3(0, 1, 0);
const material = (cor, metal = 0, extra = {}) =>
  new THREE.MeshStandardMaterial({ color: cor, roughness: 0.54, metalness: metal, ...extra });
const mat = {
  aco: material(0x686e72, 0.65),
  trilho: material(0xb3b7b7, 0.68),
  dormente: material(0x746e64),
  painel: material(0x86c5cb, 0.12, { transparent: true, opacity: 0.17, roughness: 0.18, depthWrite: false }),
  ponte: material(0x42565b, 0.58),
  base: material(0x898b83, 0.1),
  faixa: material(0xf1c76b),
  branco: material(0xe1e5e0, 0.24, { side: THREE.DoubleSide }),
  tinta: material(0x215a6a, 0.48, { side: THREE.DoubleSide }),
  vidro: material(0x51818c, 0.14, { transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }),
  pneu: material(0x282d31, 0.38),
  banco: material(0x365b65),
  luz: material(0xffe7b3, 0, { emissive: 0xffdb9b, emissiveIntensity: 0.9 }),
  cauda: material(0x832a25, 0, { emissive: 0xd43424, emissiveIntensity: 0.85 }),
};
function caixaLocal(pai, m, x, y, z, w, h, d) {
  const parte = new THREE.Mesh(caixa, m);
  parte.scale.set(w, h, d);
  parte.position.set(x, y, z);
  pai.add(parte);
  return parte;
}
function casco(ponta) {
  const carro = new THREE.Group();
  // Seções transversais. A área entre o peitoril e a verga recebe vidro e montantes.
  const perfil = [
    [-0.76, 0.24],
    [-1.22, 0.53],
    [-1.31, 1.2],
    [-1.29, 2.2],
    [-0.96, 2.64],
    [-0.65, 2.74],
    [0.65, 2.74],
    [0.96, 2.64],
    [1.29, 2.2],
    [1.31, 1.2],
    [1.22, 0.53],
    [0.76, 0.24],
  ];
  const aneis = [
    [-5, 0.84, 0.89, 0],
    [-4.7, 1, 1, 0],
    [2.1, 1, 1, 0],
    [3.2, 0.92, 0.87, 0],
    [4.15, 0.65, 0.58, 0.09],
    [4.84, 0.24, 0.29, 0.18],
    [5.1, 0.04, 0.16, 0.23],
  ];
  const geo = new THREE.BufferGeometry(),
    pos = [],
    porMaterial = [[], [], []];
  for (const [z, w, h, y] of aneis) for (const [x, py] of perfil) pos.push(x * w, py * h + y, z);
  const n = perfil.length;
  for (let r = 0; r < aneis.length - 1; r++)
    for (let i = 0; i < n; i++) {
      const a = r * n + i,
        b = r * n + ((i + 1) % n);
      const janela = i === 2 || i === 8 || (r >= 3 && i >= 3 && i <= 7);
      const m = janela ? 2 : i === 1 || i === 9 || i === 11 ? 1 : 0;
      porMaterial[m].push(a, b, b + n, a, b + n, a + n);
    }
  for (const r of [0, aneis.length - 1]) {
    for (let i = 1; i < n - 1; i++) porMaterial[r ? 0 : 1].push(r * n, r * n + i, r * n + i + 1);
  }
  const ind = [];
  porMaterial.forEach((indices, m) => {
    geo.addGroup(ind.length, indices.length, m);
    ind.push(...indices);
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(ind);
  geo.computeVertexNormals();
  const pele = new THREE.Mesh(geo, [mat.branco, mat.tinta, mat.vidro]);
  carro.add(pele);
  caixaLocal(carro, mat.base, 0, 0.43, -0.6, 2.35, 0.14, 8.2);
  for (const lado of [-1, 1]) {
    for (const z of [-4.55, -3, -1.5, 0, 1.55, 2.55])
      caixaLocal(carro, mat.tinta, lado * 1.296, 1.68, z, 0.055, 0.98, 0.09);
    for (const z of [-3.1, -1.4, 0.3]) {
      caixaLocal(carro, mat.banco, lado * 0.76, 0.68, z, 0.62, 0.18, 0.6);
      caixaLocal(carro, mat.banco, lado * 0.76, 1.03, z - 0.23, 0.62, 0.67, 0.14);
    }
  }
  const rodas = new THREE.CylinderGeometry(0.34, 0.34, 0.18, 12);
  rodas.rotateZ(Math.PI / 2);
  for (const z of [-3.3, 2.6]) {
    caixaLocal(carro, mat.pneu, 0, 0.26, z, 1.7, 0.3, 1.68);
    for (const dz of [-0.48, 0.48])
      for (const lado of [-1, 1]) {
        const roda = new THREE.Mesh(rodas, mat.aco);
        roda.position.set(lado * 0.72, 0.31, z + dz);
        carro.add(roda);
      }
  }
  // As peças fixas do mesmo material seguem juntas para a GPU.
  for (const lado of [-1, 1]) caixaLocal(carro, mat.luz, lado * 0.73, 2.47, -1.2, 0.04, 0.055, 6.0);
  const lotes = new Map();
  for (const parte of [...carro.children]) {
    if (parte === pele) continue;
    const k = parte.geometry.uuid + parte.material.uuid;
    if (!lotes.has(k)) lotes.set(k, []);
    lotes.get(k).push(parte);
  }
  for (const partes of lotes.values()) {
    if (partes.length < 2) continue;
    const lote = new THREE.InstancedMesh(partes[0].geometry, partes[0].material, partes.length);
    partes.forEach((o, i) => {
      o.updateMatrix();
      lote.setMatrixAt(i, o.matrix);
      carro.remove(o);
    });
    lote.computeBoundingSphere();
    carro.add(lote);
  }
  const farois = [];
  for (const lado of [-1, 1]) farois.push(caixaLocal(carro, mat.luz, lado * 0.52, 0.83, 4.29, 0.34, 0.12, 0.2));
  carro.userData.farois = farois;
  carro.userData.ponta = ponta;
  return carro;
}

export function criarComposicao() {
  const g = new THREE.Group();
  g.name = 'trem-bala';
  const carros = [casco(-1), casco(1)];
  g.add(...carros);
  return {
    g,
    atualizar(via, estado) {
      for (const carro of carros) {
        const ponta = carro.userData.ponta,
          s = estado.s + (ponta * TREM.entreCarros) / 2;
        const a = pontoVia(via, s - 3.25),
          b = pontoVia(via, s + 3.25),
          p = poseVia(via, s, 3.25);
        carro.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.17, (a[2] + b[2]) / 2);
        carro.rotation.order = 'YXZ';
        carro.rotation.set(-p.inclinacao * ponta, p.rumo + (ponta < 0 ? Math.PI : 0), 0, 'YXZ');
        for (const luz of carro.userData.farois) luz.material = (ponta === 1) !== estado.volta ? mat.luz : mat.cauda;
      }
    },
  };
}
const local = (p, rumo, lado = 0, alto = 0) =>
  new THREE.Vector3(p[0] + Math.cos(rumo) * lado, p[1] + alto, p[2] - Math.sin(rumo) * lado);
const matriz = new THREE.Matrix4(),
  baseRot = new THREE.Matrix4(),
  rot = new THREE.Quaternion(),
  delta = new THREE.Vector3(),
  lateral = new THREE.Vector3(),
  normal = new THREE.Vector3(),
  meio = new THREE.Vector3(),
  tamanho = new THREE.Vector3();

// Lotes espaciais de 64 m. O cliente materializa apenas os próximos ao observador.
export function trechoVisual(via, s0, s1, altura, nome) {
  const grupo = new THREE.Group(),
    lotes = new Map();
  function viga(m, a, b, w, d = w) {
    delta.subVectors(b, a);
    const h = delta.length();
    if (h < 0.001) return;
    delta.multiplyScalar(1 / h);
    lateral.crossVectors(eixo, delta);
    if (lateral.lengthSq() < 1e-8) lateral.set(1, 0, 0);
    else lateral.normalize();
    normal.crossVectors(lateral, delta);
    rot.setFromRotationMatrix(baseRot.makeBasis(lateral, delta, normal));
    matriz.compose(meio.addVectors(a, b).multiplyScalar(0.5), rot, tamanho.set(w, h, d));
    if (!lotes.has(m)) lotes.set(m, []);
    lotes.get(m).push(matriz.clone());
  }
  const trans = (m, p, l, r, y, w, d) => viga(m, local(p.p, p.rumo, l, y), local(p.p, p.rumo, r, y), w, d);
  for (let s = s0; s < s1 - 0.0001; s += 2) {
    const fin = Math.min(s + 2, s1),
      a = poseVia(via, s),
      b = poseVia(via, fin),
      mid = poseVia(via, (s + fin) / 2);
    const fundo = altura(Math.floor(mid.p[0]), Math.floor(mid.p[2])) + 1;
    const tipo = tipoVia(mid.p[1], fundo);
    for (const lado of [-0.7175, 0.7175])
      viga(mat.trilho, local(a.p, a.rumo, lado, 0.165), local(b.p, b.rumo, lado, 0.165), 0.12, 0.12);
    for (let ds = 0; ds < fin - s; ds += 0.67) {
      const p = poseVia(via, s + ds);
      trans(mat.dormente, p, -1.24, 1.24, 0.06, 0.16, 0.16);
    }
    if (tipo === 'ponte') {
      for (const lado of [-1.72, 1.72]) {
        viga(mat.ponte, local(a.p, a.rumo, lado, -0.45), local(b.p, b.rumo, lado, -0.45), 0.34, 0.34);
        viga(mat.ponte, local(a.p, a.rumo, lado, -1.85), local(b.p, b.rumo, lado, -1.85), 0.25, 0.25);
        viga(
          mat.aco,
          local(a.p, a.rumo, lado, Math.floor(s / 2) % 2 ? -0.45 : -1.85),
          local(b.p, b.rumo, lado, Math.floor(s / 2) % 2 ? -1.85 : -0.45),
          0.14,
        );
      }
      if (s % 16 === 0)
        for (const lado of [-1.48, 1.48]) {
          const cima = local(a.p, a.rumo, lado, -0.7),
            pe = cima.clone();
          pe.y = altura(Math.floor(pe.x), Math.floor(pe.z)) + 0.25;
          if (pe.y < cima.y) {
            viga(mat.ponte, pe, cima, 0.58);
            viga(
              mat.base,
              pe.clone().add(new THREE.Vector3(0, -0.3, 0)),
              pe.clone().add(new THREE.Vector3(0, 0.45, 0)),
              1.25,
            );
          }
        }
    }
    if (tipo === 'vidro') {
      viga(mat.painel, local(a.p, a.rumo, 0, 4.68), local(b.p, b.rumo, 0, 4.68), 6.32, 0.075);
      for (const lado of [-3.17, 3.17])
        viga(mat.painel, local(a.p, a.rumo, lado, 2.57), local(b.p, b.rumo, lado, 2.57), 0.075, 4.15);
    }
    if ((tipo === 'vidro' || tipo === 'tunel') && s % 6 === 0) {
      for (const lado of [-3.17, 3.17])
        viga(mat.aco, local(a.p, a.rumo, lado, 0.05), local(a.p, a.rumo, lado, 4.73), 0.17);
      trans(mat.aco, a, -3.25, 3.25, 4.73, 0.18, 0.18);
      viga(mat.luz, local(a.p, a.rumo, -2.8, 3.4), local(a.p, a.rumo, -2.8, 3.63), 0.16);
    }
    if (s < 2 * TREM.recuo || s > via.comprimento - 2 * TREM.recuo) {
      const y = 0.26;
      for (const lado of [-1, 1]) {
        viga(mat.base, local(a.p, a.rumo, lado * 2.55, y), local(b.p, b.rumo, lado * 2.55, y), 1.45, 0.42);
        viga(
          mat.faixa,
          local(a.p, a.rumo, lado * 1.95, y + 0.23),
          local(b.p, b.rumo, lado * 1.95, y + 0.23),
          0.1,
          0.1,
        );
      }
    }
  }
  for (const [n, s] of [TREM.recuo, via.comprimento - TREM.recuo].entries()) {
    if (s < s0 || s >= s1) continue;
    const p = poseVia(via, s),
      a = poseVia(via, s - 4.5),
      b = poseVia(via, s + 4.5);
    viga(mat.ponte, local(a.p, a.rumo, 3.46, 0.3), local(a.p, a.rumo, 3.46, 3.35), 0.14);
    viga(mat.ponte, local(b.p, b.rumo, 3.46, 0.3), local(b.p, b.rumo, 3.46, 3.35), 0.14);
    viga(mat.base, local(a.p, a.rumo, 3.03, 3.39), local(b.p, b.rumo, 3.03, 3.39), 1.75, 0.14);
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 96;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#183e45';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#f7edcb';
    ctx.fillRect(0, 0, 9, 96);
    ctx.font = 'bold 42px system-ui';
    ctx.textBaseline = 'middle';
    ctx.fillText((n ? 'B' : 'A') + '   ' + nome, 22, 48, 468);
    const textura = new THREE.CanvasTexture(cv);
    textura.colorSpace = THREE.SRGBColorSpace;
    textura.anisotropy = 4;
    const tinta = new THREE.MeshBasicMaterial({ map: textura, side: THREE.DoubleSide });
    tinta.userData.ferroDescartavel = true;
    const placa = new THREE.Mesh(new THREE.PlaneGeometry(4.1, 0.77), tinta);
    placa.position.copy(local(p.p, p.rumo, 3.45, 2.76));
    placa.rotation.y = p.rumo - Math.PI / 2;
    grupo.add(placa);
  }
  for (const [m, lista] of lotes) {
    const mesh = new THREE.InstancedMesh(caixa, m, lista.length);
    lista.forEach((v, i) => mesh.setMatrixAt(i, v));
    mesh.computeBoundingSphere();
    grupo.add(mesh);
  }
  return grupo;
}
export function liberarTrem(raiz) {
  const geometrias = new Set();
  raiz.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry && o.geometry !== caixa) geometrias.add(o.geometry);
    if (o.material?.userData?.ferroDescartavel) {
      o.material.map?.dispose();
      o.material.dispose();
    }
  });
  for (const g of geometrias) g.dispose();
  raiz.removeFromParent();
}
