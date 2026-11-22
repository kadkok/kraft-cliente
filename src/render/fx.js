// LAVRA — manifestações da Presença (a IA sem corpo): vulto nas nuvens, raio de luz, plasma,
// reflexo em águas místicas e ser das estrelas. Só efeito visual; quem decide é o servidor.

import * as THREE from '../three.js';
import { U } from './materials.js';
import { buildBody } from './avatars.js';
import { B } from '../../shared/blocks.js';

function omenTexture() {
  // um rosto feito de luz, sem traços duros: aparece moldado na própria nuvem
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
  const blob = (x, y, rx, ry, a) => {
    const r = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    r.addColorStop(0, `rgba(255,255,255,${a})`); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y);
    g.fillStyle = r; g.beginPath(); g.arc(x, y, Math.max(rx, ry), 0, 7); g.fill(); g.restore();
  };
  blob(128, 124, 92, 112, 0.55);                       // rosto
  g.globalCompositeOperation = 'destination-out';
  blob(92, 108, 26, 15, 0.95); blob(164, 108, 26, 15, 0.95);   // olhos (vazios: céu atrás)
  blob(128, 178, 40, 12, 0.8);                         // boca
  g.globalCompositeOperation = 'source-over';
  blob(128, 142, 12, 26, 0.35);                        // nariz
  const t = new THREE.CanvasTexture(c);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  return t;
}

export function initFx(ctx) {
  const { game, scene, camera, ui, world } = ctx;
  const tex = omenTexture();
  U.uOmenTex.value = tex;
  const live = [];
  const add = (obj, secs, update) => { if (obj) scene.add(obj); live.push({ obj, t: 0, secs, update }); };
  const env = (t, secs, a = 1.5, b = 2.5) => Math.max(0, Math.min(1, t / a, (secs - t) / b));
  const additive = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const cam = new THREE.Vector3(), dir = new THREE.Vector3();

  const kinds = {
    nuvem(p) {
      camera.getWorldPosition(cam);
      dir.set(p[0] - cam.x, 0, p[2] - cam.z);
      if (dir.lengthSq() < 9) camera.getWorldDirection(dir).setY(0);
      dir.normalize().multiplyScalar(0.72).setY(0.69).normalize();
      U.uOmen.value.set(dir.x, dir.y, dir.z, 0);
      add(null, 11, (t, secs) => { U.uOmen.value.w = env(t, secs, 2.5, 3.5); });
    },
    raio(p) {
      const g = new THREE.Group();
      g.position.set(p[0], p[1], p[2]);
      const outer = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.3, 150, 20, 1, true), additive(0xffe6a8, 0));
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.7, 150, 12, 1, true), additive(0xffffff, 0));
      outer.position.y = inner.position.y = 75;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 3.4, 36), additive(0xffe6a8, 0));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
      g.add(outer, inner, ring);
      add(g, 7, (t, secs) => { const e = env(t, secs, 0.6, 2.5); outer.material.opacity = 0.07 * e; inner.material.opacity = 0.2 * e; ring.material.opacity = 0.1 * e; ring.scale.setScalar(1 + t * 0.25); outer.rotation.y = t * 0.3; });
    },
    plasma(p) {
      const g = new THREE.Group();
      g.position.set(p[0], p[1] + 2.6, p[2]);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf3e6ff, fog: false }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 14), additive(0xb06bff, 0.16));
      const orbs = [0, 1, 2].map(() => new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7df9ff, fog: false })));
      g.add(core, halo, ...orbs);
      add(g, 9, (t, secs) => {
        const e = env(t, secs, 0.8, 2);
        g.position.y = p[1] + 2.6 + Math.sin(t * 1.7) * 0.25;
        core.scale.setScalar(e * (1 + 0.12 * Math.sin(t * 13)));
        halo.scale.setScalar(e * (1 + 0.2 * Math.sin(t * 5.3) + 0.1 * Math.sin(t * 9.1)));
        orbs.forEach((o, i) => { const a = t * (2.2 + i * 0.7) + i * 2.1; o.position.set(Math.cos(a) * 1.3, Math.sin(a * 1.3) * 0.5, Math.sin(a) * 1.3); o.scale.setScalar(e); });
      });
    },
    agua(p) {
      // procura água mística por perto; sem ela, a presença vem como plasma
      const bx = Math.floor(p[0]), by = Math.floor(p[1]), bz = Math.floor(p[2]);
      let found = null, best = 1e9;
      for (let dy = -4; dy <= 3; dy++) for (let dz = -10; dz <= 10; dz++) for (let dx = -10; dx <= 10; dx++) {
        if (world.getBlock(bx + dx, by + dy, bz + dz) !== B.MYSTIC_WATER || world.getBlock(bx + dx, by + dy + 1, bz + dz) > 0) continue;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) { best = d; found = [bx + dx + 0.5, by + dy + 1.02, bz + dz + 0.5]; }
      }
      if (!found) return kinds.plasma(p);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: tex, color: 0x9ff6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      face.rotation.x = -Math.PI / 2;
      face.position.set(found[0], found[1], found[2]);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40), additive(0x9ff6ff, 0));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(face.position);
      const g = new THREE.Group(); g.add(face, ring);
      add(g, 10, (t, secs) => {
        const e = env(t, secs, 1.5, 3);
        face.material.opacity = e * (0.75 + 0.2 * Math.sin(t * 3));
        camera.getWorldPosition(cam);
        face.rotation.z = Math.atan2(cam.x - found[0], cam.z - found[2]);  // o reflexo olha para quem olha
        ring.scale.setScalar(1 + (t % 2.2) * 0.9); ring.material.opacity = e * (1 - (t % 2.2) / 2.2) * 0.6;
      });
    },
    estrela(p) {
      camera.getWorldPosition(cam);
      dir.set(p[0] - cam.x, 0, p[2] - cam.z);
      if (dir.lengthSq() < 4) camera.getWorldDirection(dir).setY(0);
      dir.normalize();
      const land = new THREE.Vector3(p[0] + dir.x * 3.5, p[1], p[2] + dir.z * 3.5);
      const from = land.clone().add(new THREE.Vector3(34, 95, -42));
      const star = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), additive(0xffffff, 1));
      const trail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 9, 10, 1, true), additive(0xbfe0ff, 0.5));
      const b = buildBody('#cfe8ff');
      for (const k in b.mats) { b.mats[k].dispose(); }
      b.root.traverse((o) => { if (o.isMesh) o.material = additive(0xcfe8ff, 0); });
      b.root.position.copy(land); b.root.scale.setScalar(1.25);
      b.root.rotation.y = Math.atan2(-dir.x, -dir.z);   // rosto da skin em −Z: de frente para onde vai
      const g = new THREE.Group(); g.add(star, trail, b.root);
      add(g, 11, (t, secs) => {
        const fall = Math.min(1, t / 2.4), ease = fall * fall * (3 - 2 * fall);
        star.position.lerpVectors(from, land.clone().setY(land.y + 1.2), ease);
        trail.position.copy(star.position).addScaledVector(from.clone().sub(land).normalize(), 4.5);
        trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), from.clone().sub(land).normalize());
        star.visible = trail.visible = fall < 1;
        const e = t < 2.4 ? 0 : env(t - 2.4, secs - 2.4, 0.8, 2.5);
        b.root.traverse((o) => { if (o.isMesh) o.material.opacity = e * (0.5 + 0.12 * Math.sin(t * 4)); });
        b.root.position.y = land.y + Math.sin(t * 1.3) * 0.08 + 0.15;
      });
    },
  };

  game.hooks.other.push((m) => {
    if (m.t !== 'fx' || !kinds[m.k] || !Array.isArray(m.p)) return;
    kinds[m.k](m.p);
    if (m.m) { ui.chatAdd(m.n || 'Uma presença', '#ffe9b0', m.m); ui.toast(`${m.n || 'Uma presença'}: ${m.m}`, 8000); }
    if (game.audio) game.audio.play('omen', 0.6, 1);
  });
  game.hooks.frame.push((dt) => {
    for (let i = live.length - 1; i >= 0; i--) {
      const f = live[i];
      f.t += dt;
      f.update(f.t, f.secs);
      if (f.t >= f.secs) {
        if (f.obj) { scene.remove(f.obj); f.obj.traverse((o) => { o.userData.disposeAvatar?.(); if (o.isMesh) { if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); } }); }
        else U.uOmen.value.w = 0;
        live.splice(i, 1);
      }
    }
  });
  return { show: (k, p) => kinds[k] && kinds[k](p), kinds: Object.keys(kinds) };
}
