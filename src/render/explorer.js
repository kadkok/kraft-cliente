// Diesel, THEUNSEENVULGA (CC0), adaptado para Lavra. Veja assets/avatar/LICENSE.txt.
// Buffers síncronos e seis ossos: conserva buildBody e os pivôs já animados pelo jogo.
import * as THREE from '../three.js';
import { AVATAR_DATA } from '../../assets/avatar/geometry.js';

let geometryCache = null, textures = null;
function decode(base64, ArrayType) {
  const raw = atob(base64), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new ArrayType(bytes.buffer);
}
function resources() {
  if (geometryCache) return;
  geometryCache = {}; textures = {};
  const loader = new THREE.TextureLoader();
  for (const name of ['skin', 'clothes', 'details']) {
    const tex = loader.load(new URL(`../../assets/avatar/${name}.png`, import.meta.url).href);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; textures[name] = tex;
  }
  for (const [name, data] of Object.entries(AVATAR_DATA.parts)) {
    const geometry = new THREE.BufferGeometry();
    for (const [field, attr, width, Type] of [['p', 'position', 3, Float32Array], ['n', 'normal', 3, Float32Array], ['uv', 'uv', 2, Float32Array], ['j', 'skinIndex', 4, Uint16Array], ['w', 'skinWeight', 4, Float32Array]])
      geometry.setAttribute(attr, new THREE.BufferAttribute(decode(data[field], Type), width));
    geometry.setIndex(new THREE.BufferAttribute(decode(data.idx, Uint16Array), 1));
    geometry.userData.shared = true; geometry.computeBoundingSphere(); geometryCache[name] = geometry;
  }
}

export function buildExplorerBody(colorHex = '#e8873a') {
  resources();
  const root = new THREE.Group(); root.name = 'explorador-lavra';
  const bones = AVATAR_DATA.pivots.map((pivot, i) => { const bone = new THREE.Bone(); bone.name = ['root', 'head', 'armL', 'armR', 'legL', 'legR'][i]; bone.position.fromArray(pivot); return bone; });
  root.add(bones[0]); for (let i = 1; i < bones.length; i++) bones[0].add(bones[i]);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones); skeleton.calculateInverses();
  const base = new THREE.Color(colorHex), mats = {}, colors = {}, meshes = [];
  for (const [name, geo] of Object.entries(geometryCache)) {
    const color = name === 'jacket' ? base.clone().lerp(new THREE.Color('#ffffff'), .6) : new THREE.Color('#ffffff');
    const mat = new THREE.MeshStandardMaterial({ color, map: textures[name === 'jacket' ? 'clothes' : name],
      roughness: name === 'skin' ? .78 : name === 'details' ? .65 : .88, metalness: 0 });
    mats[name] = mat; colors[name] = mat.color.clone();
    const mesh = new THREE.SkinnedMesh(geo, mat); mesh.name = 'explorador-' + name;
    mesh.castShadow = mesh.receiveShadow = true;
    // O alcance é pequeno; a esfera estática precisa cobrir braços/pernas durante o passo.
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, .9, 0), 1.35);
    root.add(mesh); mesh.bind(skeleton, new THREE.Matrix4()); meshes.push(mesh);
  }
  let disposed = false;
  function dispose() { if (disposed) return; disposed = true; skeleton.dispose(); for (const mat of Object.values(mats)) mat.dispose(); }
  root.userData.disposeAvatar = dispose;
  root.userData.avatar = { origin: AVATAR_DATA.origin, height: AVATAR_DATA.height, bones: 6, triangles: meshes.reduce((n, m) => n + m.geometry.index.count / 3, 0), draws: meshes.length };
  return { root, mats, colors, skeleton, dispose, torso: meshes[0], head: bones[1], armL: bones[2], armR: bones[3], legL: bones[4], legR: bones[5] };
}
