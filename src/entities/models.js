// LAVRA — corpos das criaturas da Zona Fantasma, montados por código (formas simples, articuladas).
// Cada função devolve { root, parts, height } com o corpo olhando para -Z e os pés em y = 0.

import * as THREE from '../three.js';
import { buildBody } from '../render/avatars.js';

const lam = (c, e) => new THREE.MeshLambertMaterial({ color: c, emissive: e || 0x000000 });
const glow = (c) => new THREE.MeshBasicMaterial({ color: c });
const G = {
  box: new THREE.BoxGeometry(1, 1, 1), sph: new THREE.SphereGeometry(0.5, 16, 12), cone: new THREE.ConeGeometry(0.5, 1, 10),
  cap: new THREE.CapsuleGeometry(0.5, 1, 4, 10), tor: new THREE.TorusGeometry(0.5, 0.06, 8, 28), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
};
function part(parent, geo, mat, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
// perna com o pivô no quadril
function leg(parent, mat, x, y, z, len, thick) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  part(g, G.cap, mat, 0, -len / 2, 0, thick, len / 2, thick);
  return g;
}

export const MODELS = {
  // pré-história: fera baixa e comprida, de presas longas
  dentefera() {
    const root = new THREE.Group();
    const hide = lam(0xa9762e), dark = lam(0x4a3216), bone = lam(0xeee6cf);
    part(root, G.cap, hide, 0, 0.72, 0.1, 0.5, 0.55, 0.5, Math.PI / 2);
    const head = new THREE.Group(); head.position.set(0, 0.86, -0.72); root.add(head);
    part(head, G.box, hide, 0, 0, -0.1, 0.42, 0.36, 0.5);
    part(head, G.box, dark, 0, -0.16, -0.16, 0.36, 0.1, 0.4);
    for (const sx of [-1, 1]) {
      part(head, G.cone, bone, sx * 0.13, -0.3, -0.3, 0.09, 0.42, 0.09, Math.PI);
      part(head, G.sph, glow(0xffd24a), sx * 0.13, 0.08, -0.34, 0.07, 0.07, 0.04);
      part(head, G.cone, dark, sx * 0.16, 0.24, 0.02, 0.1, 0.18, 0.06);
    }
    for (let i = 0; i < 5; i++) part(root, G.cone, dark, 0, 1.06 - i * 0.02, -0.3 + i * 0.22, 0.1, 0.24, 0.1);
    part(root, G.cone, hide, 0, 0.74, 0.86, 0.16, 0.7, 0.16, -Math.PI / 2 - 0.2);
    const legs = [leg(root, dark, -0.22, 0.6, -0.34, 0.6, 0.13), leg(root, dark, 0.22, 0.6, -0.34, 0.6, 0.13), leg(root, dark, -0.22, 0.6, 0.46, 0.6, 0.14), leg(root, dark, 0.22, 0.6, 0.46, 0.6, 0.14)];
    return { root, legs, head, height: 1.1 };
  },
  // idade média: uma armadura vazia que anda
  armadura() {
    const b = buildBody('#7d8590');
    b.mats.skin.color.set(0x0c0c10); b.colors.skin.set(0x0c0c10);
    b.mats.helmet.color.set(0x9aa3ad); b.colors.helmet.set(0x9aa3ad);
    b.mats.pants.color.set(0x545b66); b.colors.pants.set(0x545b66);
    b.mats.lamp.color.set(0xff3b2f);
    const steel = lam(0xc9d0d8);
    part(b.armR, G.box, steel, 0, -0.62, -0.42, 0.05, 0.1, 0.95);
    part(b.armR, G.box, lam(0x5a4630), 0, -0.62, 0.1, 0.07, 0.07, 0.2);
    part(b.armL, G.cyl, lam(0x6c2f2f), -0.1, -0.4, -0.02, 0.5, 0.06, 0.5, 0, 0, Math.PI / 2);
    b.root.scale.setScalar(1.1);
    return { root: b.root, legs: [b.legL, b.legR], arms: [b.armL, b.armR], head: b.head, body: b, height: 2.0, frenteZ: true };
  },
  // futuro: esfera de vidro flutuante com um olho e um anel
  vigia() {
    const root = new THREE.Group();
    const core = new THREE.Group(); core.position.y = 0.5; root.add(core);
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fe6ff, emissive: 0x0d3a4a, transparent: true, opacity: 0.72 });
    part(core, G.sph, glass, 0, 0, 0, 0.8, 0.8, 0.8);
    const eye = part(core, G.sph, glow(0xff5a3c), 0, 0, -0.26, 0.26, 0.26, 0.14);
    const ring = part(core, G.tor, lam(0x2c3540, 0x0a1a22), 0, 0, 0, 1.05, 1.05, 1.05, Math.PI / 2);
    for (const sx of [-1, 1]) part(core, G.cone, lam(0x2c3540), sx * 0.3, 0.44, 0, 0.05, 0.3, 0.05, 0, 0, -sx * 0.4);
    return { root, core, ring, eye, height: 0.9, floats: true };
  },
  // antiguidade: gigante de bronze, pesado
  colosso() {
    const root = new THREE.Group();
    const bronze = lam(0xb07a3a), verd = lam(0x4e8f7a), dark = lam(0x5c3d1c);
    part(root, G.box, bronze, 0, 2.5, 0, 1.5, 1.6, 0.9);
    part(root, G.box, verd, 0, 2.9, -0.46, 0.9, 0.5, 0.06);
    part(root, G.box, dark, 0, 1.6, 0, 1.2, 0.36, 0.8);
    const head = new THREE.Group(); head.position.set(0, 3.7, 0); root.add(head);
    part(head, G.box, bronze, 0, 0, 0, 0.8, 0.8, 0.8);
    part(head, G.box, verd, 0, 0.46, 0, 0.9, 0.14, 0.9);
    for (const sx of [-1, 1]) part(head, G.box, glow(0x7df9ff), sx * 0.2, 0.06, -0.41, 0.16, 0.1, 0.04);
    const arm = (sx) => { const g = new THREE.Group(); g.position.set(sx * 1.05, 3.1, 0); root.add(g); part(g, G.box, bronze, 0, -0.8, 0, 0.5, 1.7, 0.5); part(g, G.box, dark, 0, -1.8, 0, 0.66, 0.6, 0.66); return g; };
    const lg = (sx) => { const g = new THREE.Group(); g.position.set(sx * 0.42, 1.5, 0); root.add(g); part(g, G.box, bronze, 0, -0.75, 0, 0.56, 1.5, 0.6); part(g, G.box, verd, 0, -1.42, -0.06, 0.66, 0.2, 0.8); return g; };
    return { root, legs: [lg(-1), lg(1)], arms: [arm(-1), arm(1)], head, height: 4.2 };
  },
  // antes do tempo: massa escura, bocarra e muitos olhos
  devorador() {
    const root = new THREE.Group();
    const core = new THREE.Group(); core.position.y = 1.6; root.add(core);
    const flesh = lam(0x17111f, 0x12041c);
    part(core, G.sph, flesh, 0, 0, 0, 3, 2.6, 3);
    part(core, G.sph, glow(0x000000), 0, -0.1, -1.05, 1.5, 1.1, 0.9);
    const teeth = lam(0xe9e2d0);
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; part(core, G.cone, teeth, Math.cos(a) * 0.74, -0.1 + Math.sin(a) * 0.52, -1.38, 0.12, 0.34, 0.12, Math.PI / 2 + Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); }
    const eyes = [];
    for (let i = 0; i < 11; i++) { const a = i * 2.4, r = 0.9 + (i % 3) * 0.22; eyes.push(part(core, G.sph, glow(i % 2 ? 0xc56bff : 0xff4d6d), Math.cos(a) * r, 0.5 + Math.sin(a * 1.7) * 0.5, -1.0 - (i % 2) * 0.12, 0.14, 0.14, 0.08)); }
    const tails = [];
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; tails.push(part(core, G.cone, flesh, Math.cos(a) * 1.0, -1.3, 0.3 + Math.sin(a) * 0.9, 0.3, 1.8, 0.3, Math.PI + Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3)); }
    return { root, core, eyes, tails, height: 3.2, floats: true };
  },
};
