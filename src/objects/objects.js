// LAVRA — objetos livres: formas geométricas, painéis de imagem, esferas-ambiente e modelos
// importados (.glb do Blender). Cada objeto tem posição, rotação e tamanho livres (fora da grade).

import * as THREE from '../three.js';
import { TEX, KIND, K_CUTOUT, K_CROSS, B, IS_GLASS } from '../../shared/blocks.js';
import { shapeGeometry, shapeRepeat, shapeSDF, buildTriGrid, sphereVsTriGrid, painelGrosso } from './shapes.js';
import { dividirTora, secaoTora } from '../../shared/corte-tora.js';
import { shapeWorldHalfY } from './sizing.js';

export const OF_SOLID = 1, OF_UNLIT = 2, OF_INSIDE = 4, OF_HOLLOW = 8, OF_MESH = 16;
const PR = 0.3; // raio das esferas que representam o corpo do jogador

export function createObjects({ scene, game, net, camera, lightProbe, ui, store, icons }) {
  const group = new THREE.Group();
  group.name = 'objetos';
  scene.add(group);
  const list = new Map();       // id -> entrada
  const blockTex = new Map();   // camada -> textura 2D base
  const imgTex = new Map();     // id do arquivo -> Promise<Texture>
  const glbBuf = new Map();     // id do arquivo -> Promise<ArrayBuffer>
  const mixers = new Set();
  let fibra = null;
  const abrindo = new Map();
  let loaderP = null, localId = -1, probeI = 0;
  const fileUrl = (id) => game.localFiles?.get(id) || `f/${encodeURIComponent(game.slug)}/${id}`;

  function baseBlockTexture(layer) {
    let t = blockTex.get(layer);
    if (!t) {
      t = new THREE.CanvasTexture(icons().layerCanvas(layer));
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      blockTex.set(layer, t);
    }
    return t;
  }
  function imageTexture(id) {
    let p = imgTex.get(id);
    if (!p) {
      p = new Promise((resolve, reject) => new THREE.TextureLoader().load(fileUrl(id), (t) => {
        t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; resolve(t);
      }, undefined, reject));
      imgTex.set(id, p);
    }
    return p;
  }

  // caixa com UV em metros (a textura de bloco ladrilha certo em cada face)
  function tiledBox(k) {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const uv = g.attributes.uv;
    const s = [[k[2], k[1]], [k[2], k[1]], [k[0], k[2]], [k[0], k[2]], [k[0], k[1]], [k[0], k[1]]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) uv.setXY(f * 4 + i, uv.getX(f * 4 + i) * s[f][0], uv.getY(f * 4 + i) * s[f][1]);
    return g;
  }

  function makeMaterial(e) {
    const o = e.o;
    e.glass = false;
    const unlit = !!(o.f & OF_UNLIT), inside = !!(o.f & OF_INSIDE);
    const grosso = painelGrosso(o.s, o.k, o.m);                      // painel com espessura: é uma caixa, não uma folha
    const side = ((o.s === 'painel' && !grosso) || inside) ? THREE.DoubleSide : THREE.FrontSide;
    const M = unlit ? THREE.MeshBasicMaterial : THREE.MeshLambertMaterial;
    const opts = { side };
    if (unlit) { opts.toneMapped = false; opts.fog = !inside; }
    let mat;
    if (o.m.t === 'b') {
      const cut = KIND[o.m.b] === K_CUTOUT || KIND[o.m.b] === K_CROSS;
      const t = baseBlockTexture(TEX[o.m.b * 6]).clone();
      if (o.s !== 'cubo' && !grosso) { const r = shapeRepeat(o.s, o.k); t.repeat.set(r[0], r[1]); }   // cubo e painel grosso ladrilham pela própria caixa (tiledBox)
      t.needsUpdate = true;
      e.ownTex = t;
      if (IS_GLASS[o.m.b] && !unlit) {
        // Vidro em qualquer forma (pedido do Kadmus, 15/11): translúcido, não só a moldura. O recorte (alphaTest)
        // apagava o painel inteiro; aqui o painel fica com um mínimo de opacidade e ganha brilho do sol.
        // O vidro dos blocos do mundo tem shader próprio (render/glass-shader.js); este é o das formas livres.
        // Vidro inteiro, sem moldura, em qualquer forma e tamanho (Kadmus, 15/11): a moldura do bloco repetida a cada
        // metro virava grade numa pirâmide grande. A cor vem do miolo do bloco (repetição zero + deslocamento ao
        // centro = um texel só), então cada vidro (claro, fumê, azul…) mantém o seu tom.
        t.repeat.set(0, 0); t.offset.set(0.5, 0.5);
        mat = new THREE.MeshPhongMaterial({ ...opts, map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, shininess: 90, specular: 0x8a8a8a });
        // Opacidade mínima baixa de frente e maior de lado (Fresnel aproximado): sem moldura, é a borda que mostra a forma.
        mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', 'float glassFres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);\n\tdiffuseColor.a = max(diffuseColor.a, 0.14 + 0.62 * glassFres);\n\t#include <opaque_fragment>'); };
        mat.customProgramCacheKey = () => 'forma-vidro';
        e.glass = true;
      } else mat = new M({ ...opts, map: t, alphaTest: cut ? 0.5 : 0, side: cut ? THREE.DoubleSide : side });
      if ((o.s === 'tora' || secaoTora(o.s)) && !e.glass) {
        // pontas da tora: o corte do tronco (a face de cima do bloco: os anéis), inteiro em cada ponta
        const t2 = baseBlockTexture(TEX[o.m.b * 6 + 2]).clone();
        t2.needsUpdate = true;
        e.ownTex2 = t2;
        e.mat2 = new M({ ...opts, map: t2, alphaTest: cut ? 0.5 : 0, side: cut ? THREE.DoubleSide : side });
      }
      if (secaoTora(o.s) && !e.glass) {
        if (!fibra) {
          fibra = new THREE.TextureLoader().load('assets/tools/veio-madeira-06.webp');
          fibra.colorSpace = THREE.SRGBColorSpace;
          fibra.anisotropy = 4;
        }
        e.matCorte = new M({ ...opts, map: fibra });
      }
      if (o.m.b === B.LAMP || o.m.b === B.CRYSTAL_ORE) e.glow = true;
    } else if (o.m.t === 'i') {
      mat = new M({ ...opts, color: 0x8a8f96, alphaTest: /\.(png|webp)$/.test(o.m.i) ? 0.5 : 0 });
      imageTexture(o.m.i).then((base) => {
        if (e.dead || e.mat !== mat) return;
        const t = base.clone();
        if (inside && o.s !== 'painel') { t.wrapS = THREE.RepeatWrapping; t.repeat.x = -1; } // por dentro a imagem não fica espelhada
        t.needsUpdate = true;
        e.ownTex = t;
        mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;
        e.base = mat.color.clone();
      }).catch(() => {});
    } else {
      mat = new M({ ...opts, color: o.m.t === 'c' ? o.m.c : '#c8c8c8' });
    }
    e.base = mat.color.clone();
    e.lit = !unlit;
    return mat;
  }

  function loadModel(e) {
    const id = e.o.m.i;
    let p = glbBuf.get(id);
    if (!p) { p = fetch(game.localFiles?.get(id) || fileUrl(id) + '?leve=1').then((r) => { if (!r.ok) throw new Error('modelo indisponível'); return r.arrayBuffer(); }); glbBuf.set(id, p); }
    loaderP ||= import('../../vendor/three-gltf.js').then((m) => new m.GLTFLoader());
    Promise.all([p, loaderP]).then(([buf, loader]) => new Promise((res, rej) => loader.parse(buf.slice(0), '', res, rej))).then((gltf) => {
      if (e.dead) return;
      const sc = gltf.scene;
      const box = new THREE.Box3().setFromObject(sc);
      const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      sc.position.sub(center);
      e.modelSize = [Math.max(size.x, 1e-3), Math.max(size.y, 1e-3), Math.max(size.z, 1e-3)];
      e.inner = sc;
      e.mesh.add(sc);
      e.mesh.remove(e.placeholder);
      shadowFlags(e);
      if (e.fitOnLoad) { // recém-importado: assume o tamanho real do arquivo (1 unidade do Blender = 1 m)
        const k = e.modelSize.map((v) => Math.min(400, Math.max(0.05, Math.round(v * 100) / 100)));
        e.fitOnLoad = false;
        api.update(e.o.id, { k, p: [e.o.p[0], Math.round((e.o.p[1] + k[1] / 2) * 100) / 100, e.o.p[2]] });
      }
      applyTransform(e);
      if (gltf.animations && gltf.animations.length) {
        e.mixer = new THREE.AnimationMixer(sc);
        for (const clip of gltf.animations) e.mixer.clipAction(clip).play();
        mixers.add(e.mixer);
      }
      if (e.o.f & OF_MESH) buildModelCollision(e);
    }).catch((err) => { if (!e.dead) ui.toast('Não consegui abrir o modelo: ' + (err.message || err)); });
  }

  function buildModelCollision(e) {
    if (!e.inner) return;
    const pos = [];
    const v = new THREE.Vector3();
    e.mesh.updateWorldMatrix(true, true);
    const inv = new THREE.Matrix4().copy(e.mesh.matrixWorld).invert();
    const sx = e.mesh.scale.x, sy = e.mesh.scale.y, sz = e.mesh.scale.z;
    e.inner.traverse((m) => {
      if (!m.isMesh || !m.geometry.attributes.position || pos.length > 2.7e6) return;
      const g = m.geometry, p = g.attributes.position, idx = g.index;
      const mat = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const n = idx ? idx.count : p.count;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(mat);
        pos.push(v.x * sx, v.y * sy, v.z * sz); // espaço local já no tamanho real, sem rotação
      }
    });
    e.tri = pos.length >= 9 ? buildTriGrid(new Float32Array(pos)) : null;
  }

  function applyTransform(e) {
    abrindo.delete(e);
    const o = e.o, m = e.mesh;
    m.position.set(o.p[0], o.p[1], o.p[2]);
    m.quaternion.set(o.q[0], o.q[1], o.q[2], o.q[3]);
    if (o.s === 'modelo') {
      const s = e.modelSize || [1, 1, 1];
      m.scale.set(o.k[0] / s[0], o.k[1] / s[1], o.k[2] / s[2]);
    } else if (o.s === 'cubo' && o.m.t === 'b') m.scale.set(o.k[0], o.k[1], o.k[2]);
    else m.scale.set(o.k[0], o.k[1], o.s === 'painel' && !painelGrosso(o.s, o.k, o.m) ? 1 : o.k[2]);
    m.updateMatrix();
    e.inv.copy(m.quaternion).invert();
    e.radius = Math.hypot(o.k[0], o.k[1], o.k[2]) / 2;
    e.env = !!(o.f & OF_INSIDE) && Math.min(o.k[0], o.k[1], o.k[2]) >= 24 && o.s !== 'painel';
    m.frustumCulled = !e.env;
    m.renderOrder = e.env ? -5 : 0;
  }

  function build(e) {
    const o = e.o;
    if (e.mesh) dispose(e, true);
    if (o.s === 'modelo') {
      e.mesh = new THREE.Group();
      e.placeholder = new THREE.Mesh(shapeGeometry('cubo'), new THREE.MeshLambertMaterial({ color: 0x7c8794, wireframe: true }));
      e.mesh.add(e.placeholder);
      e.mat = null; e.lit = false;
      loadModel(e);
    } else {
      e.mat = makeMaterial(e);
      const grosso = painelGrosso(o.s, o.k, o.m);
      const geo = ((o.s === 'cubo' || grosso) && o.m.t === 'b') ? (e.ownGeo = tiledBox(o.k)) : shapeGeometry(grosso ? 'cubo' : o.s);
      e.mesh = new THREE.Mesh(geo, e.matCorte ? [e.mat, e.mat2, e.mat2, e.matCorte] : e.mat2 ? [e.mat, e.mat2, e.mat2] : e.mat);   // tora: lateral + as duas pontas
    }
    e.mesh.userData.entry = e;
    e.mesh.matrixAutoUpdate = false;
    applyTransform(e);
    shadowFlags(e);
    group.add(e.mesh);
    e.probe = -1;
  }

  // quem brilha por conta própria ou serve de céu não projeta nem recebe sombra
  function shadowFlags(e) {
    const on = !e.env && !(e.o.f & OF_UNLIT);
    // vidro deixa a luz passar: recebe sombra, mas não projeta a de uma parede sólida
    e.mesh.traverse((m) => { if (m.isMesh) { m.castShadow = on && !e.glass; m.receiveShadow = on; } });
  }

  function dispose(e, keep) {
    abrindo.delete(e);
    if (e.mesh) group.remove(e.mesh);
    if (e.mat) e.mat.dispose();
    if (e.matCorte) { e.matCorte.dispose(); e.matCorte = null; }
    if (e.mat2) { e.mat2.dispose(); e.mat2 = null; }
    if (e.ownTex) { e.ownTex.dispose(); e.ownTex = null; }
    if (e.ownTex2) { e.ownTex2.dispose(); e.ownTex2 = null; }
    if (e.ownGeo) { e.ownGeo.dispose(); e.ownGeo = null; }
    if (e.mixer) { mixers.delete(e.mixer); e.mixer = null; }
    if (e.inner) {
      e.inner.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); for (const mt of [].concat(m.material)) { for (const k in mt) if (mt[k] && mt[k].isTexture) mt[k].dispose(); mt.dispose(); } } });
      e.inner = null;
    }
    e.tri = null; e.mesh = null;
    if (!keep) e.dead = true;
  }

  // ---- armazenamento / rede ---------------------------------------------------------
  function add(o, opts) {
    if (o.id < 0) localId = Math.min(localId, o.id - 1);
    if (list.has(o.id)) remove(o.id);
    const e = { o: { ...o, p: [...o.p], q: [...o.q], k: [...o.k], m: { ...o.m } }, mesh: null, mat: null, inv: new THREE.Quaternion(), radius: 1, dead: false, fitOnLoad: !!(opts && opts.fit) };
    list.set(o.id, e);
    build(e);
    return e;
  }
  function remove(id) {
    const e = list.get(id);
    if (!e) return;
    dispose(e);
    list.delete(id);
  }
  function patch(id, part) {
    const e = list.get(id);
    if (!e) return;
    const o = e.o;
    const shapeOrMat = part.s !== undefined || part.m !== undefined;
    if (part.s !== undefined) o.s = part.s;
    if (part.p) o.p = [...part.p];
    if (part.q) o.q = [...part.q];
    if (part.k) o.k = [...part.k];
    if (part.m) o.m = { ...part.m };
    if (part.f !== undefined) o.f = part.f;
    if (part.g !== undefined) { if (part.g) o.g = part.g; else delete o.g; }   // conjunto de peças (server/pecas.js)
    if (shapeOrMat) return build(e);
    if (o.s !== 'modelo' && (part.f !== undefined || (part.k && (o.m.t === 'b' || o.s === 'painel')))) return build(e); // material/ladrilho mudam
    applyTransform(e);
    if (o.s === 'modelo') {
      if (!(o.f & OF_MESH)) e.tri = null;
      else if (part.k || part.f !== undefined || !e.tri) buildModelCollision(e);
    }
  }
  function saveLocal() { if (net.offline) store.set('off.obj.' + game.slug, [...list.values()].map((e) => e.o)); }

  let sendT = 0, pending = new Map();
  const api = {
    list, group,
    clear() { for (const id of [...list.keys()]) remove(id); },
    loadAll(arr) { api.clear(); for (const o of arr || []) add(o); },
    onMessage(m) {
      if (m.t === 'pc' && m.op === 'rachada') {
        const original = list.get(m.id)?.o;
        remove(m.id);
        for (const metade of m.l) {
          const e = add(metade);
          if (!original) continue;
          const h = secaoTora(metade.s);
          const rot = new THREE.Quaternion().fromArray(original.q);
          const de = new THREE.Vector3(h.cx * original.k[0], 0, h.cz * original.k[2])
            .applyQuaternion(rot).add(tmpV.fromArray(original.p));
          abrindo.set(e, { t: 0, de, rot, para: e.mesh.position.clone(), fim: e.mesh.quaternion.clone() });
          e.mesh.position.copy(de); e.mesh.quaternion.copy(rot); e.mesh.updateMatrix();
        }
        game.machado?.efeitoCorte(m.l[0].m.b, m.ponto, m.dir);
        if (api.onRemoved) api.onRemoved(m.id);
        return;
      }
      if (m.t === 'o+') { const e = add(m.o, { fit: m.from === net.id && api.fitNext }); if (m.from === net.id) { api.lastId = m.o.id; api.fitNext = false; if (api.onCreated) api.onCreated(e); } }
      else if (m.t === 'o~') { if (m.from !== net.id) patch(m.id, m.o); } // o próprio eco já foi aplicado na hora
      else if (m.t === 'o-') { remove(m.id); if (api.onRemoved) api.onRemoved(m.id); }
    },
    // `junta` = id da peça vizinha em que esta nasce encostada com o ímã: entra no conjunto dela (só com servidor)
    create(o, fit, junta = 0) {
      if (net.offline) {
        const e = add({ ...o, id: localId-- }, { fit });
        api.lastId = e.o.id; saveLocal();
        if (api.onCreated) api.onCreated(e);
        return;
      }
      api.fitNext = !!fit;
      net.send(junta ? { t: 'o+', o, junta } : { t: 'o+', o });
    },
    rachar(id, ponto, dir) {
      if (!net.offline) { net.send({ t: 'pc', op: 'rachar', id, ponto, dir }); return; }
      const o = list.get(id)?.o;
      if (!o || o.fixo || o.bau || o.g || o.dec === 'litoral') return;
      const partes = dividirTora(o, ponto, dir);
      if (!partes) return;
      api.onMessage({ t: 'pc', op: 'rachada', id, ponto, dir, l: partes.map(m => ({ ...m, id: localId--, by: o.by })) });
      saveLocal();
    },
    // só neste aparelho, sem avisar o servidor: é como a peça que está na mão acompanha a mira (objects/mao.js)
    preview(id, part) { patch(id, part); },
    // o que o servidor mandou (lote de peças movidas, conjunto novo): aplica sem devolver nada
    applyServer(id, part) { patch(id, part); },
    addServer(o) { return add(o); },
    saveLocal,
    // as peças de um conjunto (campo g)
    membros(g) { const l = []; if (g) for (const e of list.values()) if (e.o.g === g) l.push(e); return l; },
    // aplica na hora e envia com folga (arrastar um controle não inunda o servidor)
    update(id, part) {
      patch(id, part);
      if (net.offline) return saveLocal();
      pending.set(id, { ...(pending.get(id) || {}), ...part });
    },
    destroy(id) {
      if (net.offline) { remove(id); saveLocal(); if (api.onRemoved) api.onRemoved(id); return; }
      net.send({ t: 'o-', id });
    },
    flush(dt) {
      sendT -= dt;
      if (sendT > 0 || pending.size === 0) return;
      sendT = 0.12;
      for (const [id, part] of pending) net.send({ t: 'o~', id, o: part });
      pending.clear();
    },

    // ---- por quadro: animações, penumbra, esfera-ambiente -----------------------------
    frame(dt) {
      for (const [e, a] of abrindo) {
        a.t = Math.min(1, a.t + dt / 0.22);
        const k = 1 - (1 - a.t) ** 3;
        e.mesh.position.lerpVectors(a.de, a.para, k);
        e.mesh.quaternion.slerpQuaternions(a.rot, a.fim, k);
        e.mesh.updateMatrix();
        if (a.t === 1) abrindo.delete(e);
      }
      for (const m of mixers) m.update(dt);
      api.flush(dt);
      // penumbra aproximada, um objeto por quadro
      if (list.size) {
        const arr = [...list.values()];
        const e = arr[probeI++ % arr.length];
        if (e.lit && e.mat && !e.glow) {
          const pr = lightProbe(e.o.p[0], e.o.p[1] + shapeWorldHalfY(e.o.k, e.o.q, e.o.s === 'painel') + 0.2, e.o.p[2]);
          if (pr !== e.probe) { e.probe = pr; e.mat.color.copy(e.base).multiplyScalar(pr); if (e.mat2) e.mat2.color.copy(e.mat.color); if (e.matCorte) e.matCorte.color.copy(e.mat.color); }
        }
      }
      // dentro de uma esfera-ambiente? ela vira o céu: sem névoa e com alcance de visão até a parede
      let inside = false, far = 900;
      const cp = camera.getWorldPosition(tmpV);
      for (const e of list.values()) {
        if (!e.env) continue;
        const d = Math.hypot(cp.x - e.o.p[0], cp.y - e.o.p[1], cp.z - e.o.p[2]);
        far = Math.max(far, (d + e.radius) * 1.05);
        local(e, cp.x, cp.y, cp.z, lp);
        if (shapeSDF(e.o.s, e.o.k, lp[0], lp[1], lp[2]) < 0) inside = true;
      }
      api.inside = inside;
      if (camera.far !== far) { camera.far = far; camera.updateProjectionMatrix(); }
    },

    // ---- colisão do jogador ---------------------------------------------------------------
    collide(p) {
      for (const e of list.values()) {
        const o = e.o;
        if (!(o.f & OF_SOLID) || e.held) continue;      // a peça que está na mão não empurra quem a carrega
        const dx = p.pos[0] - o.p[0], dy = p.pos[1] + 0.9 - o.p[1], dz = p.pos[2] - o.p[2];
        const reach = e.radius + 1.3;
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
        for (let s = 0; s < 3; s++) {
          const cy = p.pos[1] + 0.3 + s * 0.6;
          local(e, p.pos[0], cy, p.pos[2], lp);
          let px = 0, py = 0, pz = 0, hit = false;
          if (e.tri) {
            push[0] = push[1] = push[2] = 0;
            hit = sphereVsTriGrid(e.tri, lp, PR, push);
            px = push[0]; py = push[1]; pz = push[2];
          } else if (o.s !== 'modelo' || !(o.f & OF_MESH)) {
            const sh = o.s === 'modelo' ? 'cubo' : o.s;
            const hollow = o.f & OF_HOLLOW;
            const sdf = (x, y, z) => { const d = shapeSDF(sh, o.k, x, y, z); return hollow ? Math.abs(d) - 0.12 : d; };
            const d = sdf(lp[0], lp[1], lp[2]);
            if (d < PR) {
              const h = 0.02;
              let gx = sdf(lp[0] + h, lp[1], lp[2]) - sdf(lp[0] - h, lp[1], lp[2]);
              let gy = sdf(lp[0], lp[1] + h, lp[2]) - sdf(lp[0], lp[1] - h, lp[2]);
              let gz = sdf(lp[0], lp[1], lp[2] + h) - sdf(lp[0], lp[1], lp[2] - h);
              const gl = Math.hypot(gx, gy, gz);
              if (gl > 1e-6) { const k = (PR - d) / gl; px = gx * k; py = gy * k; pz = gz * k; hit = true; }
            }
          }
          if (!hit) continue;
          tmpV.set(px, py, pz).applyQuaternion(e.mesh.quaternion);
          const l = tmpV.length();
          if (l < 1e-6) continue;
          p.pos[0] += tmpV.x; p.pos[1] += tmpV.y; p.pos[2] += tmpV.z;
          const nx = tmpV.x / l, ny = tmpV.y / l, nz = tmpV.z / l;
          const vn = p.vel[0] * nx + p.vel[1] * ny + p.vel[2] * nz;
          if (vn < 0) { p.vel[0] -= nx * vn; p.vel[1] -= ny * vn; p.vel[2] -= nz * vn; }
          if (ny > 0.55) { if (!p.onGround && vn < -6) p.landed = -vn; p.onGround = true; if (p.flying) p.flying = false; }
        }
      }
    },

    // ---- raio --------------------------------------------------------------------------------
    raycast(o, d, max) {
      ray.set(tmpV.set(o[0], o[1], o[2]), tmpV2.set(d[0], d[1], d[2]));
      rc.ray.copy(ray); rc.far = max; rc.near = 0;
      hits.length = 0;
      rc.intersectObjects(group.children, true, hits);
      for (const h of hits) {
        let n = h.object;
        while (n && !n.userData.entry) n = n.parent;
        if (!n || n.userData.entry.env || n.userData.entry.held) continue; // nem a parede da esfera-ambiente nem a peça que está na mão entram na mira
        const e = n.userData.entry;
        const nrm = h.face ? tmpV.copy(h.face.normal).transformDirection(h.object.matrixWorld) : tmpV.set(0, 1, 0);
        if (nrm.x * d[0] + nrm.y * d[1] + nrm.z * d[2] > 0) nrm.negate();
        return { entry: e, t: h.distance, point: [h.point.x, h.point.y, h.point.z], normal: [nrm.x, nrm.y, nrm.z] };
      }
      return null;
    },
  };

  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), ray = new THREE.Ray(), rc = new THREE.Raycaster(), hits = [];
  const lp = [0, 0, 0], push = [0, 0, 0];
  function local(e, x, y, z, out) {
    tmpV2.set(x - e.o.p[0], y - e.o.p[1], z - e.o.p[2]).applyQuaternion(e.inv);
    out[0] = tmpV2.x; out[1] = tmpV2.y; out[2] = tmpV2.z;
  }
  return api;
}
