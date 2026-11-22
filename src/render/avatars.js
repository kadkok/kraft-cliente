// LAVRA — corpos dos outros jogadores (e, depois, de NPCs): um explorador articulado,
// de capacete com lanterna e mochila, na cor de cada pessoa. Interpolado entre os
// estados que chegam da rede.

import * as THREE from '../three.js';
import { buildMinecraftBody } from './minecraft-avatar.js';

export function buildBody(colorHex = '#e8873a') {
  return buildMinecraftBody(colorHex);
}

const DELAY = 0.13; // segundos de atraso proposital para ter sempre dois estados entre os quais interpolar

let shared = null;
function geoms() {
  if (shared) return shared;
  const limb = new THREE.CapsuleGeometry(0.085, 0.5, 3, 8);
  limb.translate(0, -0.3, 0);                     // pivô no ombro/quadril
  const leg = new THREE.CapsuleGeometry(0.1, 0.52, 3, 8);
  leg.translate(0, -0.34, 0);
  shared = {
    torso: new THREE.CapsuleGeometry(0.19, 0.36, 4, 10),
    head: new THREE.SphereGeometry(0.17, 14, 10),
    helmet: new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
    brim: new THREE.CylinderGeometry(0.215, 0.215, 0.025, 16),
    lamp: new THREE.SphereGeometry(0.045, 8, 6),
    pack: new THREE.BoxGeometry(0.28, 0.36, 0.15),
    limb, leg,
    held: new THREE.BoxGeometry(0.2, 0.2, 0.2),
  };
  for (const k in shared) shared[k].userData.shared = true;   // compartilhadas: ninguém deve descartá-las
  return shared;
}

export function nameTag(name, color) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '600 44px system-ui, sans-serif';
  ctx.font = font;
  const w = Math.min(600, Math.ceil(ctx.measureText(name).width) + 56);
  c.width = w; c.height = 76;
  const g = ctx.createLinearGradient(0, 0, w, 76);
  g.addColorStop(0, 'rgba(16,26,38,0.86)'); g.addColorStop(1, 'rgba(8,13,20,0.86)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(2, 2, w - 4, 72, 26); ctx.fill();
  const g2 = ctx.createLinearGradient(0, 0, w, 0);
  g2.addColorStop(0, color); g2.addColorStop(1, '#ffffff');
  ctx.strokeStyle = g2; ctx.lineWidth = 3; ctx.stroke();
  ctx.font = font; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2, 40, w - 40);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, fog: false }));
  s.scale.set(w / 76 * 0.26, 0.26, 1);
  s.position.y = 2.18;
  s.renderOrder = 5;
  return s;
}

// Mantido para comparação visual de QA; os jogadores usam buildExplorerBody.
export function buildPrimitiveBody(colorHex) {
  const G = geoms();
  const base = new THREE.Color(colorHex);
  const mats = {
    jacket: new THREE.MeshLambertMaterial({ color: base.clone() }),
    pants: new THREE.MeshLambertMaterial({ color: new THREE.Color(0x2c3442) }),
    skin: new THREE.MeshLambertMaterial({ color: new THREE.Color(0xd9a27e) }),
    helmet: new THREE.MeshLambertMaterial({ color: base.clone().lerp(new THREE.Color(0xffffff), 0.45) }),
    pack: new THREE.MeshLambertMaterial({ color: base.clone().multiplyScalar(0.45) }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2c0) }),
  };
  const colors = {};
  for (const k in mats) colors[k] = mats[k].color.clone();
  const root = new THREE.Group();
  const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = !mat.isMeshBasicMaterial; parent.add(m); return m; };
  const torso = add(root, G.torso, mats.jacket, 0, 1.08, 0);
  add(root, G.pack, mats.pack, 0, 1.12, 0.21);
  const head = new THREE.Group(); head.position.set(0, 1.56, 0); root.add(head);
  add(head, G.head, mats.skin, 0, 0.06, 0);
  add(head, G.helmet, mats.helmet, 0, 0.08, 0);
  add(head, G.brim, mats.helmet, 0, 0.1, -0.03);
  add(head, G.lamp, mats.lamp, 0, 0.17, -0.185);
  const armL = add(root, G.limb, mats.jacket, -0.27, 1.38, 0), armR = add(root, G.limb, mats.jacket, 0.27, 1.38, 0);
  const legL = add(root, G.leg, mats.pants, -0.105, 0.78, 0), legR = add(root, G.leg, mats.pants, 0.105, 0.78, 0);
  return { root, mats, colors, torso, head, armL, armR, legL, legR };
}

export function createAvatars(scene, lightProbe) {
  const list = new Map();
  const group = new THREE.Group();
  group.name = 'jogadores';
  scene.add(group);

  function add(p) {
    if (list.has(p.id)) remove(p.id);
    const body = buildBody(p.color || '#e8873a');
    const tag = nameTag(p.name || '?', p.color || '#e8873a');
    body.root.add(tag);
    body.root.visible = false;
    group.add(body.root);
    const a = { id: p.id, name: p.name, color: p.color, body, tag, snaps: [], phase: 0, speed: 0, shade: 1, last: [0, 0, 0], pos: [0, 0, 0], held: 0, flags: 0 };
    list.set(p.id, a);
    if (p.p) push(p.id, p.p[0], p.p[1], p.p[2], p.r ? p.r[0] : 0, p.r ? p.r[1] : 0, p.h || 0, p.f || 0);
    return a;
  }
  function remove(id) {
    const a = list.get(id);
    if (!a) return;
    group.remove(a.body.root);
    if (a.body.dispose) a.body.dispose();
    else for (const k in a.body.mats) a.body.mats[k].dispose();
    a.tag.material.map.dispose(); a.tag.material.dispose();
    list.delete(id);
  }
  function clear() { for (const id of [...list.keys()]) remove(id); }

  function push(id, x, y, z, yaw, pitch, held, flags) {
    const a = list.get(id);
    if (!a) return;
    const t = performance.now() / 1000;
    a.snaps.push({ t, x, y, z, yaw, pitch });
    if (a.snaps.length > 6) a.snaps.shift();
    a.held = held; a.flags = flags;
  }

  function update(dt) {
    const rt = performance.now() / 1000 - DELAY;
    for (const a of list.values()) {
      const s = a.snaps;
      if (!s.length) continue;
      let i = s.length - 1;
      while (i > 0 && s[i - 1].t > rt) i--;
      const b = s[i], a0 = s[Math.max(0, i - 1)];
      const span = b.t - a0.t;
      const k = span > 1e-4 ? Math.min(1.25, Math.max(0, (rt - a0.t) / span)) : 1;
      const x = a0.x + (b.x - a0.x) * k, y = a0.y + (b.y - a0.y) * k, z = a0.z + (b.z - a0.z) * k;
      let dy = b.yaw - a0.yaw;
      dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const yaw = a0.yaw + dy * k, pitch = a0.pitch + (b.pitch - a0.pitch) * k;
      const body = a.body;
      body.root.visible = true;
      body.root.position.set(x, y, z);
      body.root.rotation.y = yaw; // o rosto da skin fica em −Z, que é a frente de quem joga (17/11: o + π deixava todo mundo de costas)
      body.head.rotation.x = -pitch;
      const moved = Math.hypot(x - a.last[0], z - a.last[2]);
      a.last[0] = x; a.last[1] = y; a.last[2] = z;
      a.pos[0] = x; a.pos[1] = y; a.pos[2] = z;
      const sp = dt > 0 ? moved / dt : 0;
      a.speed += (Math.min(sp, 7) - a.speed) * Math.min(1, dt * 10);
      // passos: a cada ~2 m andados avisa quem cuida do som (um salto grande é teleporte, não conta)
      if (moved < 1 && a.speed > 0.6) { a.walked = (a.walked || 0) + moved; if (a.walked > 2.1) { a.walked = 0; if (api.onStep) api.onStep(x, y, z); } }
      a.phase += a.speed * dt * 2.3;
      const sw = Math.sin(a.phase) * Math.min(1, a.speed / 3.5) * 0.9;
      body.legL.rotation.x = sw; body.legR.rotation.x = -sw;
      body.armL.rotation.x = -sw * 0.8; body.armR.rotation.x = sw * 0.8;
      if(body.elbowL){body.elbowL.rotation.x=.08;body.elbowR.rotation.x=.08;body.kneeL.rotation.x=-Math.max(0,-sw)*.5;body.kneeR.rotation.x=-Math.max(0,sw)*.5;}
      // penumbra aproximada: escurece quem está debaixo de teto
      const target = lightProbe ? lightProbe(x, y + 1, z) : 1;
      a.shade += (target - a.shade) * Math.min(1, dt * 5);
      for (const key in body.mats) if (key !== 'lamp') body.mats[key].color.copy(body.colors[key]).multiplyScalar(a.shade);
    }
  }

  // algum avatar ocupa a célula (x,y,z)? (para não colocar bloco dentro de alguém)
  function occupies(x, y, z) {
    for (const a of list.values()) {
      const p = a.pos;
      if (x + 1 > p[0] - 0.3 && x < p[0] + 0.3 && y + 1 > p[1] && y < p[1] + 1.8 && z + 1 > p[2] - 0.3 && z < p[2] + 0.3) return true;
    }
    return false;
  }

  const api = { list, add, remove, clear, push, update, occupies, group, onStep: null };
  return api;
}
