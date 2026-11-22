// Peles de fauna: draw calls instanciados com deformação biomecânica na GPU.
// Suporta malhas síncronas e modelos .glb reais carregados sob demanda.
import * as THREE from '../three.js';
import { FAUNA, faunaAppearance, faunaAtlas } from './fauna-design.js';
import { faunaGeometry, reefGeometry } from './fauna-models.js';

const KINDS = Object.keys(FAUNA);
const MOTION_MAP = { cardume: 0, rebanho: 1, bando: 2, enxame: 3, ratos: 4, sapos: 5, fish: 6, ray: 7, cetacean: 8, turtle: 9, jelly: 10, octopus: 11 };

const DEFORM = /* glsl */`
attribute vec4 aJoint, aPose;
attribute vec3 aCoat;
attribute float aCoatMask;
void faunaRotate(inout vec3 p, inout vec3 n, float angle, int axis) {
  float c = cos(angle), s = sin(angle);
  mat2 r = mat2(c, s, -s, c);
  if (axis == 0) { p.yz = r * p.yz; n.yz = r * n.yz; }
  else if (axis == 1) { p.zx = r * p.zx; n.zx = r * n.zx; }
  else { p.xy = r * p.xy; n.xy = r * n.xy; }
}
void faunaDeform(inout vec3 p, inout vec3 n) {
  float part = aJoint.w, beat = aPose.x * 2.0 - 1.0;
  vec3 pivot = aJoint.xyz;
  #if FAUNA_KIND <= 5
    p -= pivot;
  #endif
  #if FAUNA_KIND == 0
    // Peixe cardume clássico: o impulso cresce em direção à cauda.
    p += pivot;
    float flex = clamp(-p.z / .18, 0.0, 1.0);
    faunaRotate(p, n, beat * .28 * flex, 1);
    p -= pivot;
    if (part > .5 && part < 2.5) faunaRotate(p, n, (part < 1.5 ? -1.0 : 1.0) * beat * .16, 2);
  #elif FAUNA_KIND == 1
    if (part > 3.5 && part < 7.5) {
      float side = (part == 4.0 || part == 7.0) ? 1.0 : -1.0;
      faunaRotate(p, n, side * beat * .38 * aPose.y, 0);
    }
    if (part == 8.0) faunaRotate(p, n, aPose.z * (.83 + .1 * beat), 0);
    if (part == 3.0) faunaRotate(p, n, beat * .12, 0);
  #elif FAUNA_KIND == 2
    if (part > .5 && part < 2.5) {
      float side = part < 1.5 ? -1.0 : 1.0;
      faunaRotate(p, n, side * 1.32 * (1.0 - aPose.y), 1);
      faunaRotate(p, n, side * (.82 * beat * aPose.y + .08), 2);
    }
    if (part == 3.0) faunaRotate(p, n, beat * .06 * aPose.y, 0);
  #elif FAUNA_KIND == 3
    if (part > .5 && part < 2.5) faunaRotate(p, n, (part < 1.5 ? -1.0 : 1.0) * (.2 + 1.05 * aPose.x), 2);
  #elif FAUNA_KIND == 4
    if (part > 3.5 && part < 7.5) faunaRotate(p, n, (part == 4.0 || part == 7.0 ? 1.0 : -1.0) * beat * .5 * aPose.y, 0);
    if (part == 3.0) faunaRotate(p, n, beat * .14 * aPose.y, 1);
  #elif FAUNA_KIND == 5
    if (part == 9.0) { p.y *= 1.0 + .24 * aPose.x * aPose.z; n.y /= 1.0 + .24 * aPose.x * aPose.z; }
    if (part == 6.0 || part == 7.0) faunaRotate(p, n, beat * .16 * aPose.y, 0);
  #elif FAUNA_KIND == 6
    // Peixes GLB (palhaço, salmão, atum, agulhão, tubarão): ondulação progressiva até a cauda.
    faunaRotate(p, n, beat * aJoint.x * aJoint.z, 1);
  #elif FAUNA_KIND == 7
    // Arraia manta: onda vertical suave do corpo às pontas das asas.
    float sg = p.x < 0.0 ? -1.0 : 1.0;
    faunaRotate(p, n, -sg * beat * aJoint.x * aJoint.y * 0.9, 2);
  #elif FAUNA_KIND == 8
    // Cetáceos (golfinho, orca, baleia): batimento vertical da cauda.
    faunaRotate(p, n, beat * aJoint.x * aJoint.z, 0);
  #elif FAUNA_KIND == 9
    // Tartaruga: remada assimétrica nas nadadeiras dianteiras.
    if (aJoint.w > 0.5) {
      float sg = p.x < 0.0 ? -1.0 : 1.0;
      faunaRotate(p, n, -sg * beat * aJoint.x * 0.75, 2);
      faunaRotate(p, n, beat * aJoint.x * 0.25, 1);
    }
  #elif FAUNA_KIND == 10
    // Água-viva: contração rítmica do sino e atraso nos braços orais.
    float pulse = aPose.x;
    if (aJoint.y > 0.48) {
      float rad = 1.0 - 0.16 * pulse;
      p.xz *= rad;
      p.y *= 1.0 + 0.12 * pulse;
    } else {
      float trail = (0.48 - aJoint.y) * 2.0;
      p.xz += vec2(beat, -beat * 0.5) * 0.05 * trail;
    }
  #elif FAUNA_KIND == 11
    // Polvo: respiração do manto e ondulação dos 8 tentáculos.
    if (aJoint.y > 0.52) {
      p *= 1.0 + 0.06 * beat;
    } else {
      p.y += sin(beat * 3.1415 + p.x * 6.0 + p.z * 6.0) * 0.045 * (1.0 - aJoint.y);
    }
  #endif
  #if FAUNA_KIND <= 5
    p += pivot;
  #endif
}
`;

function animateMaterial(mat, motionIndex, depth = false) {
  mat.onBeforeCompile = shader => {
    shader.vertexShader = `#define FAUNA_KIND ${motionIndex}\n${DEFORM}\n` + shader.vertexShader;
    if (depth) {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position; vec3 faunaNormal = normal; faunaDeform(transformed, faunaNormal);');
    } else {
      shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 faunaPosition = position; faunaDeform(faunaPosition, objectNormal);');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = faunaPosition;');
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= mix(vec3(1.0), aCoat, aCoatMask);');
    }
  };
  mat.customProgramCacheKey = () => `lavra-fauna-v2-${motionIndex}-${depth ? 'depth' : 'lit'}`;
}

function prepareMarineGeometry(srcGeo, spec, pose, coat) {
  const geo = srcGeo.clone();
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const count = geo.attributes.position.count;
  const posAttr = geo.attributes.position;
  const lenZ = Math.max(1e-4, bb.max.z - bb.min.z);
  const lenY = Math.max(1e-4, bb.max.y - bb.min.y);
  const halfX = Math.max(1e-4, Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)));
  const jArr = new Float32Array(count * 4);
  const flexAmp = spec.flex || 0.25;
  const isTurtle = spec.motion === 'turtle';

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i), y = posAttr.getY(i), z = posAttr.getZ(i);
    const tailT = Math.min(1, Math.max(0, (bb.max.z - z) / lenZ));
    const normY = Math.min(1, Math.max(0, (y - bb.min.y) / lenY));
    const wingT = Math.min(1, Math.max(0, Math.abs(x) / halfX));
    const frontFlipper = isTurtle && wingT > 0.28 && (z - bb.min.z) / lenZ > 0.34 ? 1 : 0;
    const o = i * 4;
    jArr[o] = flexAmp;
    jArr[o + 1] = spec.motion === 'ray' ? wingT : normY;
    jArr[o + 2] = tailT * tailT;
    jArr[o + 3] = frontFlipper;
  }
  geo.setAttribute('aJoint', new THREE.BufferAttribute(jArr, 4));
  if (!geo.attributes.color) {
    const cArr = new Float32Array(count * 3);
    cArr.fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(cArr, 3));
  }
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  }
  geo.setAttribute('aCoatMask', new THREE.BufferAttribute(new Float32Array(count), 1));
  if (pose) geo.setAttribute('aPose', pose);
  if (coat) geo.setAttribute('aCoat', coat);
  return geo;
}

export function createFaunaSkin(scene, kind, atlas, { camera, quality = {}, nature } = {}) {
  const spec = FAUNA[kind], capacity = quality.name === 'baixa' ? Math.ceil(spec.capacity * .65) : spec.capacity;
  const motionIndex = spec.motion ? MOTION_MAP[spec.motion] : KINDS.indexOf(kind);
  const pose = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  const coat = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  pose.setUsage(THREE.DynamicDrawUsage); coat.setUsage(THREE.DynamicDrawUsage);

  let geo = faunaGeometry(kind);
  if (spec.motion) {
    const prepped = prepareMarineGeometry(geo, spec, pose, coat);
    geo.dispose();
    geo = prepped;
  } else {
    geo.setAttribute('aPose', pose); geo.setAttribute('aCoat', coat);
  }

  const material = new THREE.MeshStandardMaterial({
    map: spec.glb ? null : atlas,
    color: 0xffffff,
    vertexColors: true,
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: THREE.DoubleSide,
    transparent: kind === 'aguaviva',
    opacity: kind === 'aguaviva' ? 0.84 : 1.0,
  });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  animateMaterial(material, motionIndex); animateMaterial(depth, motionIndex, true);
  const mesh = new THREE.InstancedMesh(geo, material, capacity);
  mesh.name = `natureza-${kind}-natural`; mesh.count = 0; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.customDepthMaterial = depth;
  mesh.castShadow = !!quality.shadow && (kind === 'rebanho' || kind === 'bando' || kind === 'ratos' || kind === 'sapos');
  mesh.receiveShadow = true; scene.add(mesh);

  const colors = spec.colors.map(c => new THREE.Color(c)), matrix = new THREE.Matrix4(), color = new THREE.Color();
  const pos = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), euler = new THREE.Euler();
  const eye = new THREE.Vector3();
  const range = spec.range * (quality.name === 'baixa' ? .75 : 1), range2 = range * range;
  const stats = { kind, capacity, visible: 0, culled: 0, trianglesPerAnimal: (geo.index ? geo.index.count : geo.attributes.position.count) / 3, draws: 1 };
  let n = 0, dead = false;

  if (typeof window !== 'undefined' && spec.glb) {
    import('./carregador-glb.js').then(({ carregarGlb }) => carregarGlb(spec.glb)).then((gltf) => {   // GLTFLoader único (20/11)
      if (dead) return;
      let found = null;
      gltf.scene.traverse((o) => { if (!found && o.isMesh) found = o; });
      if (!found?.geometry) return;
      const newGeo = prepareMarineGeometry(found.geometry, spec, pose, coat);
      const oldGeo = mesh.geometry;
      mesh.geometry = newGeo;
      oldGeo.dispose();
      const srcMat = Array.isArray(found.material) ? found.material[0] : found.material;
      if (srcMat?.map) {
        material.map = srcMat.map;
        material.normalMap = srcMat.normalMap || null;
        material.roughnessMap = srcMat.roughnessMap || null;
        material.needsUpdate = true;
      }
      stats.trianglesPerAnimal = (newGeo.index ? newGeo.index.count : newGeo.attributes.position.count) / 3;
    }).catch((err) => console.warn('[fauna glb]', kind, err));
  }

  return {
    mesh, stats,
    begin() { n = 0; stats.culled = 0; if (camera) camera.getWorldPosition(eye); },
    put(x, y, z, yaw = 0, beat = .5, presence = 1, group = {}, index = 0) {
      if (dead || n >= capacity || !Number.isFinite(x + y + z + yaw + beat + presence) || presence <= .01) return;
      const distance2 = (x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2;
      if (camera && distance2 > range2) { stats.culled++; return; }
      const a = faunaAppearance(kind, group.s || 0, index);
      const fade = camera ? Math.min(1, Math.max(0, (range - Math.sqrt(distance2)) / (range * .12))) : 1;
      const size = (spec.glb ? 1 : a.size) * Math.min(1, Math.max(0, presence)) * fade;
      pos.set(x, y, z); euler.set(0, yaw, 0); rotation.setFromEuler(euler); scale.setScalar(size);
      matrix.compose(pos, rotation, scale); mesh.setMatrixAt(n, matrix);
      if (spec.glb) coat.setXYZ(n, a.warmth, a.warmth, a.warmth);
      else { color.copy(colors[a.variant]).multiplyScalar(a.warmth); coat.setXYZ(n, color.r, color.g, color.b); }
      const mode = group.m;
      let active = 1, special = 0;
      if (kind === 'rebanho') { active = mode === 'descansar' ? 0 : mode === 'pastar' ? .12 : 1; special = mode === 'pastar' ? 1 : mode === 'beber' ? .8 : 0; }
      if (kind === 'bando') {
        const body = nature?.bodies?.get(group.id), flagIndex = 5 + index * 5;
        const flags = body?.b?.[flagIndex];
        active = Number.isFinite(flags) ? ((flags & 4) ? 1 : 0)
          : mode === 'pousar' && (beat === 0 || Math.abs(beat - .66) < 1e-6) ? 0 : 1;
      }
      if (kind === 'ratos') active = beat === 0 || mode === 'esconder' ? 0 : 1;
      if (kind === 'sapos') { active = mode === 'saltar' || mode === 'mergulhar' ? 1 : 0; special = mode === 'coaxar' ? 1 : 0; }
      pose.setXYZW(n, Math.min(1, Math.max(0, beat)), active, special, 0); n++;
    },
    end() {
      mesh.count = n; stats.visible = n;
      if (!n || dead) return;
      for (const [attr, width] of [[mesh.instanceMatrix, 16], [pose, 4], [coat, 3]]) {
        attr.clearUpdateRanges(); attr.addUpdateRange(0, n * width); attr.needsUpdate = true;
      }
    },
    dispose() { if (dead) return; dead = true; mesh.count = 0; scene.remove(mesh); mesh.dispose(); mesh.geometry.dispose(); material.dispose(); depth.dispose(); },
  };
}

function createReefSkins(scene) {
  const MAX_INST = 260;
  const uTime = { value: 0 };
  const types = ['coral', 'anemona', 'alga_marinha', 'ourico', 'estrela_do_mar'];
  const meshes = {};
  let dead = false, lastReefs = null;

  for (const t of types) {
    const geo = reefGeometry(t);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: t === 'alga_marinha' || t === 'anemona' ? 0.45 : 0.72,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    if (t === 'anemona' || t === 'alga_marinha') {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uReefTime = uTime;
        shader.vertexShader = 'attribute vec4 aJoint;\nuniform float uReefTime;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `vec3 transformed = position;
           if (aJoint.w > 0.5) {
             float sway = sin(uReefTime * 1.8 + position.y * 2.5 + position.x * 3.0) * 0.09 * clamp(position.y, 0.0, 1.5);
             transformed.x += sway;
             transformed.z += cos(uReefTime * 1.4 + position.z * 2.5) * 0.06 * clamp(position.y, 0.0, 1.5);
           }`
        );
      };
      mat.customProgramCacheKey = () => `lavra-reef-sway-${t}`;
    }
    const m = new THREE.InstancedMesh(geo, mat, MAX_INST);
    m.name = `natureza-recife-${t}`;
    m.count = 0;
    m.frustumCulled = false;
    m.receiveShadow = true;
    scene.add(m);
    meshes[t] = m;
  }

  if (typeof window !== 'undefined') {
    import('./carregador-glb.js').then(({ carregarGlb }) => carregarGlb('/assets/fauna/coral.glb')).then((gltf) => {   // GLTFLoader único (20/11)
      if (dead) return;
      let found = null;
      gltf.scene.traverse((o) => { if (!found && o.isMesh) found = o; });
      if (!found?.geometry) return;
      const g = found.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.color) {
        const c = new Float32Array(g.attributes.position.count * 3);
        c.fill(1);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      }
      const old = meshes.coral.geometry;
      meshes.coral.geometry = g;
      old.dispose();
    }).catch((err) => console.warn('[reef coral glb]', err));
  }

  const mat4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), euler = new THREE.Euler(), scl = new THREE.Vector3();
  const counts = { coral: 0, anemona: 0, alga_marinha: 0, ourico: 0, estrela_do_mar: 0 };

  return {
    update(reefs, t, dim) {
      if (dead) return;
      uTime.value = t;
      if (dim !== 0 || !Array.isArray(reefs) || reefs.length === 0) {
        for (const k of types) meshes[k].count = 0;
        lastReefs = null;
        return;
      }
      if (reefs === lastReefs) return;
      lastReefs = reefs;
      for (const k of types) counts[k] = 0;

      for (const sp of reefs) {
        const list = sp.props && sp.props.length ? sp.props : [{ kind: sp.kind, dx: 0, dz: 0, scale: sp.radius || 1, yaw: 0 }];
        for (const pr of list) {
          const bucket = pr.kind === 'coral_ramificado' || pr.kind === 'coral_cerebro' ? 'coral' : pr.kind;
          const m = meshes[bucket];
          if (!m || counts[bucket] >= MAX_INST) continue;
          const yOff = bucket === 'coral' ? -0.12 : -0.05;
          pos.set(sp.x + pr.dx, (pr.y ?? sp.y) + yOff, sp.z + pr.dz);
          euler.set(0, pr.yaw || 0, 0);
          quat.setFromEuler(euler);
          scl.setScalar(pr.scale || 1);
          mat4.compose(pos, quat, scl);
          m.setMatrixAt(counts[bucket]++, mat4);
        }
      }
      for (const k of types) {
        meshes[k].count = counts[k];
        if (counts[k]) meshes[k].instanceMatrix.needsUpdate = true;
      }
    },
    dispose() {
      if (dead) return;
      dead = true;
      for (const k of types) {
        const m = meshes[k];
        m.count = 0;
        scene.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}

export function installFaunaSkins(scene, nature, options = {}) {
  if (!nature?.setSkin) return null;
  const atlas = new THREE.DataTexture(faunaAtlas(), 256, 256, THREE.RGBAFormat);
  atlas.name = 'lavra-fauna-atlas-original'; atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.magFilter = THREE.LinearFilter; atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.generateMipmaps = true; atlas.anisotropy = Math.min(4, options.quality?.aniso || 1); atlas.needsUpdate = true;
  const skins = {}, stats = { version: 2, atlasSize: 256, textureBytesWithMipmaps: 349524, families: {} };
  for (const kind of KINDS) {
    const skin = createFaunaSkin(scene, kind, atlas, { ...options, nature });
    nature.setSkin(kind, skin); skins[kind] = skin; stats.families[kind] = skin.stats;
  }
  const reefSkin = createReefSkins(scene);
  if (nature.setReefSkin) nature.setReefSkin(reefSkin);
  let dead = false;
  return { nature, skins, reefSkin, atlas, stats,
    dispose() {
      if (dead) return; dead = true;
      for (const kind of KINDS) { if (nature.skins?.[kind] === skins[kind]) delete nature.skins[kind]; skins[kind].dispose(); }
      if (nature.setReefSkin) nature.setReefSkin(null);
      reefSkin.dispose();
      atlas.dispose();
    },
  };
}
