// LAVRA — a natureza no cliente. Guarda o tempo e os grupos de bichos que o servidor manda (server/nature.js) e entrega
// a quem desenha. Cada bicho é um corpo simulado no servidor (shared/bodies.js: tem peso, força, não atravessa bloco nem
// outro corpo); aqui chegam as posições dele algumas vezes por segundo e o desenho desliza de uma para a outra.
//
// Lógica e aparência ficam separadas de propósito:
//   · game.weather  — o tempo, já suavizado quadro a quadro. É daqui que céu, chuva e som devem ler:
//       { kind, cover 0..1 (céu coberto), rain 0..1, fog 0..1, escuro 0..1 (nuvens de tempestade; 1 = temporal),
//         wind [x, z] em m/s, flash 0..1 (clarão de raio) }
//   · game.nature.groups — os grupos vivos (id, k = tipo, m = modo, n = quantos...)
//   · game.nature.setSkin(tipo, pele) — troca quem desenha um tipo de grupo. Uma pele é um objeto com
//       begin(), put(x, y, z, rumo, batida, presenca, grupo, i) e end(). As peles daqui são formas simples e provisórias,
//       só para a simulação poder ser vista: modelos, texturas e sons de verdade entram trocando a pele.
//   · game.nature.on(evento, fn) — 'raio' (p, distância), 'tempo' (tipo novo), 'modo' (grupo, modo novo),
//       'desabamento' (p, blocos movidos, distância).
//   · game.nature.setWeatherLook(fn | null) — troca (ou desliga) a cara provisória do tempo feita aqui: céu que fecha
//       e escurece, neblina, riscos de chuva e o clarão do raio. Quem fizer o tempo de verdade nos shaders chama
//       setWeatherLook(null) e lê game.weather.

import * as THREE from '../three.js';
import { U } from '../render/materials.js';
import { WEATHER, SWARMS, groupCenter, memberPose, presence } from '../../shared/nature.js';
import { SEA } from '../../shared/constants.js';
import { B, SOLID } from '../../shared/blocks.js';
import { shapeHeight } from '../../shared/surfaces.js';
import { reefSpotsInRange } from '../../shared/reef.js';

const VIEW = 165;
const ATRASO = 0.36;   // s: dois intervalos entre retratos (6/s) — sempre há um retrato à frente do instante desenhado      // além disto o grupo não é desenhado (m)

// ---- peles provisórias: formas de poucos triângulos, instanciadas ---------------------------------------------
// Junta caixas [largura, altura, comprimento, x, y, z] numa geometria só. A frente do bicho é +Z.
function boxes(list) {
  const pos = [], nor = [], idx = [];
  for (const [w, h, d, x, y, z] of list) {
    const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position, n = g.attributes.normal, base = pos.length / 3;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}
// Corpo em losango com duas asas em V (pássaro, borboleta): bater asa é só esticar e inverter o Y da instância.
function winged(body, span, chord, lift) {
  const g = new THREE.OctahedronGeometry(1, 0).scale(body[0], body[1], body[2]);
  const p = Array.from(g.attributes.position.array);
  for (const s of [-1, 1]) p.push(0, 0, chord, 0, 0, -chord, s * span, lift, -chord * 0.3);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  out.computeVertexNormals();
  g.dispose();
  return out;
}
const GEO = {
  cardume: () => boxes([[0.1, 0.17, 0.36, 0, 0, 0.02], [0.07, 0.12, 0.12, 0, 0, 0.24], [0.02, 0.2, 0.13, 0, 0, -0.22]]),
  palhaco: () => boxes([[0.09, 0.13, 0.24, 0, 0, 0.01], [0.06, 0.09, 0.08, 0, 0, 0.16], [0.02, 0.14, 0.09, 0, 0, -0.15]]),
  rebanho: () => boxes([[0.46, 0.44, 0.95, 0, 0.5, 0], [0.3, 0.3, 0.36, 0, 0.66, 0.6], [0.12, 0.3, 0.12, -0.15, 0.15, 0.32], [0.12, 0.3, 0.12, 0.15, 0.15, 0.32], [0.12, 0.3, 0.12, -0.15, 0.15, -0.32], [0.12, 0.3, 0.12, 0.15, 0.15, -0.32], [0.08, 0.1, 0.05, -0.11, 0.85, 0.5], [0.08, 0.1, 0.05, 0.11, 0.85, 0.5]]),
  bando: () => winged([0.06, 0.06, 0.17], 0.3, 0.09, 0.09),
  enxame: () => winged([0.012, 0.012, 0.05], 0.09, 0.06, 0.05),
  ratos: () => boxes([[0.11, 0.1, 0.2, 0, 0.06, 0], [0.08, 0.08, 0.09, 0, 0.07, 0.14], [0.02, 0.02, 0.18, 0, 0.05, -0.19], [0.05, 0.05, 0.02, -0.04, 0.13, 0.12], [0.05, 0.05, 0.02, 0.04, 0.13, 0.12]]),
  sapos: () => boxes([[0.2, 0.12, 0.2, 0, 0.07, 0], [0.16, 0.09, 0.1, 0, 0.1, 0.13], [0.07, 0.06, 0.16, -0.12, 0.04, -0.06], [0.07, 0.06, 0.16, 0.12, 0.04, -0.06], [0.05, 0.05, 0.05, -0.06, 0.17, 0.14], [0.05, 0.05, 0.05, 0.06, 0.17, 0.14]]),
};
const TONES = {
  cardume: ['#5fa8d3', '#e8833a', '#f2c14e', '#91a79c', '#d95d74', '#6ec4a7'],
  palhaco: ['#f46b27', '#ff823a', '#f6f2ea', '#e6581c', '#f49d56'],
  rebanho: ['#e8dfc8', '#c4a47c', '#8c6239', '#5c544d', '#d6b892', '#3d352e'],
  bando: ['#3b6ea5', '#d94e34', '#e8b931', '#4a7c59', '#987352', '#e6e1d6'],
  enxame: ['#f28c28', '#3a86ff', '#ffbe0b', '#ff5d8f', '#7ae582', '#e8dff5'],
  ratos: ['#8e8170', '#6e665f', '#b09b7d', '#a4643b', '#d2c4b0'],
  sapos: ['#588b47', '#758856', '#d4a024', '#3d7a68', '#8c6d46'],
};

function instancedSkin(scene, kind, opt = {}) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: opt.double ? THREE.DoubleSide : THREE.FrontSide });
  const mesh = new THREE.InstancedMesh(GEO[kind](), mat, opt.max || 256);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.count = 0; mesh.name = 'natureza-' + kind;
  scene.add(mesh);
  const tones = TONES[kind].map((c) => new THREE.Color(c));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), s = new THREE.Vector3(), v = new THREE.Vector3();
  let n = 0;
  return {
    mesh,
    begin() { n = 0; },
    // batida 0..1: asa (pássaro, inseto), cauda (peixe), passo (rebanho, rato), papo (sapo)
    put(x, y, z, yaw, beat, presence, g, i) {
      if (n >= mesh.instanceMatrix.count) return;
      const size = (opt.size || 1) * (0.85 + 0.3 * ((g.s >>> (i % 16)) & 7) / 7) * presence;
      let sy = size, roll = 0, bob = 0, wag = 0;
      if (opt.flap) sy = size * (beat * 2 - 1) * 1.7 || 1e-3;            // asa sobe e desce passando pelo plano
      if (opt.wag) wag = (beat - 0.5) * 0.5;                              // o peixe serpenteia
      if (opt.step) bob = Math.abs(beat - 0.5) * opt.step;                // quem anda balança um pouco
      if (opt.puff) sy = size * (1 + beat * 0.35);                        // o papo do sapo
      e.set(0, yaw + wag, roll);
      m.compose(v.set(x, y + bob, z), q.setFromEuler(e), s.set(size, sy, size));
      mesh.setMatrixAt(n, m);
      mesh.setColorAt(n, tones[(g.s + i * (opt.mix || 0)) % tones.length]);
      n++;
    },
    end() {
      mesh.count = n;
      if (n) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    },
    dispose() { scene.remove(mesh); mesh.geometry.dispose(); mat.dispose(); },
  };
}

// ---- a natureza ---------------------------------------------------------------------------------------------------
export function initNature({ game, world, net, scene, camera, atmosphere, lightProbe, effects }) {
  const weather = { kind: 'limpo', cover: WEATHER.limpo.cover, rain: 0, fog: 0, escuro: 0, wind: [0, 0], flash: 0, target: 'limpo', force: 0.4, raios: 0, windTarget: [0, 0] };   // escuro: nuvens de tempestade e de temporal (0…1)
  const groups = new Map();
  const bodies = new Map();           // id do grupo -> { a, b: [x, y, z, rumo, estado, ...] dos dois últimos retratos, ta, tb }
  const skins = {};
  const listeners = { raio: [], tempo: [], modo: [], desabamento: [] };
  let offset = null;                 // relógio do servidor - relógio daqui (s)
  const emit = (ev, ...a) => { for (const f of listeners[ev]) { try { f(...a); } catch (err) { console.error('[natureza]', err); } } };

  const nat = {
    weather, groups, bodies, skins, reefs: [],
    // instante no relógio do servidor (é nele que os grupos se movem)
    time() { return Date.now() / 1000 + (offset || 0); },
    setSkin(kind, skin) { if (skins[kind] && skins[kind].dispose) skins[kind].dispose(); skins[kind] = skin; },
    setReefSkin(skin) { reefSkin = skin; },
    on(ev, fn) { if (listeners[ev]) listeners[ev].push(fn); },
    setWeatherLook(fn) { look = fn; if (!fn) rain.visible = false; },
    setRainOwned(v) { this.rainOwned = !!v; },
    pose: memberPose, center: groupCenter,
  };

  // ---- cara provisória do tempo ---------------------------------------------------------------------------------
  // Roda depois de a atmosfera montar o céu do quadro e só ajusta o que ela deixou: fecha e escurece as nuvens,
  // apaga o sol, engrossa a bruma, risca a chuva em volta de quem olha e acende tudo no clarão do raio.
  const DROPS = 900, BOX = [44, 30, 44];
  const rainPos = new Float32Array(DROPS * 6), rainSeed = new Float32Array(DROPS * 3);
  for (let i = 0; i < DROPS * 3; i++) rainSeed[i] = Math.random();
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xb4c4dc, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  rain.frustumCulled = false; rain.visible = false; rain.renderOrder = 5; rain.name = 'chuva-provisoria';
  scene.add(rain);
  let rainT = 0, shelter = 0;
  const grey = new THREE.Vector3();
  function defaultLook(dt, cam) {
    const over = Math.max(0, Math.min(1, (weather.cover - 0.3) / 0.7)), wet = weather.rain, fl = weather.flash;
    if (game.dim === 0) {
      U.uCloudCover.value -= over * 0.34;                              // limiar menor = mais nuvem
      const dim = 1 - 0.78 * over * (0.4 + 0.6 * Math.max(wet, weather.fog * 0.6));
      U.uSunColor.value.multiplyScalar(dim);
      U.uSunGlow.value.multiplyScalar(dim);
      U.uAmbSky.value.multiplyScalar(1 - 0.52 * over * wet);
      U.uCloudLit.value.multiplyScalar(1 - 0.62 * over * (0.3 + 0.7 * wet));
      U.uCloudDark.value.multiplyScalar(1 - 0.45 * over * wet);
      const l = (U.uHorizon.value.x + U.uHorizon.value.y + U.uHorizon.value.z) / 3 * (1 - 0.35 * wet);
      grey.set(l * 0.92, l * 0.96, l);
      U.uHorizon.value.lerp(grey, 0.75 * over * Math.max(wet, weather.fog));
      U.uZenith.value.lerp(grey.multiplyScalar(0.7), 0.7 * over * Math.max(wet, weather.fog * 0.8));
      const mist = atmosphere && atmosphere.state.underwater ? 0 : Math.max(weather.fog, wet * 0.6);   // debaixo d'água a névoa é a da água
      U.uHaze.value.x = Math.min(0.96, U.uHaze.value.x + mist * 0.6);
      U.uHaze.value.y *= 1 + mist * 3.5;
      // nuvens de tempestade e de temporal (weather.escuro): o dia escurece além do céu fechado, quase noite no temporal
      const breu = weather.escuro;
      if (breu > 0.001) {
        U.uSunColor.value.multiplyScalar(1 - 0.8 * breu); U.uSunGlow.value.multiplyScalar(1 - 0.8 * breu);
        U.uAmbSky.value.multiplyScalar(1 - 0.5 * breu);
        U.uCloudLit.value.multiplyScalar(1 - 0.62 * breu); U.uCloudDark.value.multiplyScalar(1 - 0.6 * breu);
        U.uHorizon.value.multiplyScalar(1 - 0.5 * breu); U.uZenith.value.multiplyScalar(1 - 0.58 * breu);
      }
      if (fl > 0) { U.uAmbSky.value.addScalar(fl * 1.6); U.uCloudLit.value.addScalar(fl * 2.2); U.uCloudDark.value.addScalar(fl * 1.2); }
      // objetos e bichos usam as luzes do three: acompanham o céu ajustado
      if (atmosphere) {
        atmosphere.sun.color.setRGB(U.uSunColor.value.x, U.uSunColor.value.y, U.uSunColor.value.z);
        atmosphere.hemi.color.setRGB(U.uAmbSky.value.x, U.uAmbSky.value.y, U.uAmbSky.value.z);
      }
    }
    // chuva: riscos que caem numa caixa em volta da câmera, inclinados pelo vento; debaixo de teto, somem
    const want = nat.rainOwned || game.dim !== 0 || wet <= 0.03 ? 0 : 1;
    const roof = lightProbe ? (lightProbe(cam.x, cam.y, cam.z) < 0.9 ? 1 : 0) : 0;
    shelter += (roof - shelter) * Math.min(1, dt * 3);
    const op = want * Math.min(0.5, 0.14 + wet * 0.36) * (1 - shelter);
    rain.material.opacity += (op - rain.material.opacity) * Math.min(1, dt * 2);
    rain.visible = rain.material.opacity > 0.01;
    if (!rain.visible) return;
    rainT += dt;
    const n = Math.floor(DROPS * Math.min(1, 0.25 + wet)), fall = 19 + 9 * wet, wx = weather.wind[0] * 0.55, wz = weather.wind[1] * 0.55, len = 0.5 + 0.5 * wet;
    for (let i = 0; i < n; i++) {
      const o = i * 6, s = i * 3;
      let x = rainSeed[s] * BOX[0] + wx * rainT, y = rainSeed[s + 1] * BOX[1] - fall * rainT * (0.85 + 0.3 * rainSeed[s + 2]), z = rainSeed[s + 2] * BOX[2] + wz * rainT;
      x = cam.x + ((x - cam.x) % BOX[0] + BOX[0] * 1.5) % BOX[0] - BOX[0] / 2;
      y = cam.y + ((y - cam.y) % BOX[1] + BOX[1] * 1.5) % BOX[1] - BOX[1] / 2;
      z = cam.z + ((z - cam.z) % BOX[2] + BOX[2] * 1.5) % BOX[2] - BOX[2] / 2;
      rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
      rainPos[o + 3] = x - wx * 0.045 * len; rainPos[o + 4] = y + len; rainPos[o + 5] = z - wz * 0.045 * len;
    }
    rainGeo.setDrawRange(0, n * 2);
    rainGeo.attributes.position.needsUpdate = true;
  }
  let look = defaultLook, reefSkin = null;
  game.nature = nat; game.weather = weather;

  skins.cardume = instancedSkin(scene, 'cardume', { wag: true, mix: 0, max: 420 });
  skins.palhaco = instancedSkin(scene, 'palhaco', { wag: true, mix: 1, max: 64 });
  skins.rebanho = instancedSkin(scene, 'rebanho', { step: 0.08, mix: 1, max: 96 });
  skins.bando = instancedSkin(scene, 'bando', { flap: true, double: true, mix: 0, max: 180 });
  skins.enxame = instancedSkin(scene, 'enxame', { flap: true, double: true, mix: 1, max: 220 });
  skins.ratos = instancedSkin(scene, 'ratos', { step: 0.03, mix: 1, max: 64 });
  skins.sapos = instancedSkin(scene, 'sapos', { puff: true, mix: 1, max: 64 });

  // raio provisório: uma linha quebrada do alto até o chão, que pisca e some
  const bolts = [];
  function bolt(p) {
    const pts = [];
    let x = p[0] + (Math.random() - 0.5) * 30, z = p[2] + (Math.random() - 0.5) * 30;
    const top = p[1] + 110;
    for (let i = 0; i <= 14; i++) {
      const k = i / 14;
      pts.push(new THREE.Vector3(x + (p[0] - x) * k + (Math.random() - 0.5) * 7 * (1 - k), top + (p[1] - top) * k, z + (p[2] - z) * k + (Math.random() - 0.5) * 7 * (1 - k)));
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xeaf2ff, transparent: true, opacity: 1, fog: false, toneMapped: false }));
    line.frustumCulled = false;
    scene.add(line);
    bolts.push({ line, t: 0 });
  }

  function onNat(m) {
    if (typeof m.now === 'number') {
      const o = m.now - Date.now() / 1000;
      // a mensagem demora um pouco a chegar: a maior diferença vista é a mais próxima da verdade
      offset = offset === null || Math.abs(o - offset) > 3 ? o : Math.max(offset, o);
    }
    if (m.full) { groups.clear(); for (const id of bodies.keys()) if (!(m.g || []).some((g) => g.id === id)) bodies.delete(id); }
    if (m.w && WEATHER[m.w.k]) {
      if (m.w.k !== weather.target) emit('tempo', m.w.k);
      weather.target = m.w.k; weather.force = m.w.f; weather.raios = m.w.raios || 0;
      weather.coverReal = typeof m.w.cover === 'number' ? m.w.cover : null; weather.real = !!m.w.real;
      if (Array.isArray(m.w.wind)) weather.windTarget = [Number(m.w.wind[0]) || 0, Number(m.w.wind[1]) || 0];
    }
    for (const g of m.g || []) {
      if (!SWARMS[g.k] || !Array.isArray(g.p0) || !Array.isArray(g.p1)) continue;
      const old = groups.get(g.id);
      groups.set(g.id, g);
      if (old && old.m !== g.m) emit('modo', g, g.m);
    }
    for (const id of m.gx || []) { groups.delete(id); bodies.delete(id); }
  }
  // posições dos corpos: guarda os dois últimos retratos de cada grupo para deslizar entre eles
  function onBodies(m) {
    if (typeof m.now !== 'number') return;
    for (const row of m.l || []) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const cur = bodies.get(row[0]);
      const same = cur && cur.b.length === row.length;
      // histórico curto (17/11): o desenho anda ATRASO atrás e desliza entre os dois retratos que cercam esse instante
      const h = same && cur.h ? cur.h : [];
      h.push({ r: row, t: m.now }); if (h.length > 8) h.shift();
      bodies.set(row[0], { a: same ? cur.b : row, ta: same ? cur.tb : m.now - 0.17, b: row, tb: m.now, h });
    }
  }

  game.hooks.other.push((m) => {
    if (m.t === 'nat') onNat(m);
    else if (m.t === 'nb') onBodies(m);
    else if (m.t === 'welcome' || m.t === 'offline') { groups.clear(); bodies.clear(); }     // mundo ou dimensão nova: o servidor manda de novo o que houver
    else if (m.t === 'desaba' && Array.isArray(m.p)) {
      // o servidor já mandou os blocos no novo lugar; aqui é só o que se vê e se ouve: poeira e o ronco da terra descendo
      const cam = camera.getWorldPosition(new THREE.Vector3());
      const d = Math.hypot(m.p[0] - cam.x, m.p[1] - cam.y, m.p[2] - cam.z);
      emit('desabamento', m.p, m.n || 0, d);
      if (effects) for (const q of m.pts || []) effects.burst(q[0], q[1], q[2], [0.46, 0.37, 0.27], 9, 1.3);
      if (game.audio && d < 110) {
        game.audio.play('land', 1, 0.7, 'dirt', m.p);
        for (let i = 0; i < 7; i++) setTimeout(() => game.audio.play('break', 0.9, 0.6 + Math.random() * 0.4, i % 2 ? 'gravel' : 'dirt', m.p), 60 + i * 130 + Math.random() * 90);
      }
      if (d < 30) game.shake = Math.max(game.shake || 0, 0.25 * (1 - d / 30));
    } else if (m.t === 'raio' && Array.isArray(m.p)) {
      const cam = camera.getWorldPosition(new THREE.Vector3());
      const d = Math.hypot(m.p[0] - cam.x, m.p[1] - cam.y, m.p[2] - cam.z);
      weather.flash = Math.max(weather.flash, Math.max(0.25, 1 - d / 220));
      bolt(m.p);
      emit('raio', m.p, d);
      // o trovão chega depois do clarão pela própria física de propagação (343 m/s) em audio.play
      if (game.audio) game.audio.play('thunder', Math.max(0.35, 1.35 - d / 260), 0.9 + Math.random() * 0.2, 'stone', m.p);
    }
  });

  let lastReefX = 1e9, lastReefZ = 1e9, reefPoll = 0;
  function seabedAt(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    if (world.getBlock(ix, SEA, iz) !== B.WATER) return SEA;
    for (let y = SEA - 1; y >= SEA - 23; y--) {
      const b = world.getBlock(ix, y, iz);
      if (b !== B.WATER && SOLID[b] === 1) return y;
    }
    return SEA - 24;
  }
  function seabedSurfaceAt(wx, wz) {
    const ix = Math.floor(wx), iz = Math.floor(wz);
    if (world.getBlock(ix, SEA, iz) !== B.WATER) return null;
    const fx = wx - ix, fz = wz - iz;
    for (let y = SEA - 1; y >= SEA - 23; y--) {
      const b = world.getBlock(ix, y, iz);
      if (b === B.WATER) continue;
      if (SOLID[b] !== 1) return null;
      const sh = typeof world.getShape === 'function' ? world.getShape(ix, y, iz) : 15;
      if (sh === 16) continue;
      const h = shapeHeight(sh, fx, fz);
      if (h > 1e-4 || SOLID[world.getBlock(ix, y - 1, iz)] !== 1) return y + h;
    }
    return null;
  }
  if (game.hooks?.edit) game.hooks.edit.push(() => { lastReefX = 1e9; reefPoll = 0; });

  const cam = new THREE.Vector3();
  const groupVoiceT = new Map();
  game.hooks.frame.push((dt) => {
    // tempo: caminha devagar para o alvo (uma virada leva uns vinte segundos)
    const w = WEATHER[weather.target] || WEATHER.limpo, k = Math.min(1, dt * 0.12), strong = 0.5 + 0.5 * weather.force;
    weather.cover += ((weather.coverReal ?? w.cover) - weather.cover) * k;
    weather.rain += (w.rain * strong - weather.rain) * k;
    weather.fog += (w.fog - weather.fog) * k;
    weather.escuro += ((w.escuro || 0) - weather.escuro) * k;
    weather.wind[0] += (weather.windTarget[0] - weather.wind[0]) * k; weather.wind[1] += (weather.windTarget[1] - weather.wind[1]) * k;
    weather.kind = weather.target;
    weather.flash = Math.max(0, weather.flash - dt * 2.2);
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.t += dt;
      b.line.material.opacity = b.t < 0.07 ? 1 : b.t < 0.12 ? 0.25 : Math.max(0, 1 - (b.t - 0.12) / 0.22);
      if (b.t > 0.34) { scene.remove(b.line); b.line.geometry.dispose(); b.line.material.dispose(); bolts.splice(i, 1); }
    }

    camera.getWorldPosition(cam);
    if (look) look(dt, cam);

    const tNow = nat.time();
    if (game.dim === 0 && (Math.hypot(cam.x - lastReefX, cam.z - lastReefZ) > 10 || (nat.reefs.length === 0 && tNow > reefPoll))) {
      lastReefX = cam.x; lastReefZ = cam.z;
      reefPoll = tNow + 2.0;
      const spots = reefSpotsInRange(world.seed || 1, cam.x, cam.z, 65, seabedAt, SEA);
      for (const sp of spots) {
        if (!sp.props) continue;
        sp.props = sp.props.filter((pr) => {
          const sy = seabedSurfaceAt(sp.x + pr.dx, sp.z + pr.dz);
          if (sy === null) return false;
          pr.y = sy;
          return true;
        });
      }
      nat.reefs = spots.filter((sp) => !sp.props || sp.props.length > 0);
    }
    if (reefSkin) reefSkin.update(nat.reefs, tNow, game.dim);

    // bichos: cada um desenhado onde o corpo dele está no servidor, deslizando entre os dois últimos retratos
    for (const key in skins) skins[key].begin();
    // Baleia de verdade mais perto (m): o canto debaixo d'água só toca se houver uma (game.audio lê nat.baleiaDist).
    let baleiaDist = Infinity;
    if (game.dim === 0 && groups.size) {
      const t = nat.time(), tr = t - 0.2;
      for (const g of groups.values()) {
        const skin = skins[g.k], s = bodies.get(g.id);
        if (!skin || !s) continue;
        const vis = presence(g, t);
        if (vis <= 0.01) continue;
        if (g.k === 'baleia') baleiaDist = Math.min(baleiaDist, Math.hypot(s.b[1] / 100 - cam.x, s.b[3] / 100 - cam.z));
        // par de retratos que cerca o instante desenhado (antes ia sempre entre os dois últimos e, com o atraso maior
        // que o intervalo entre retratos, o bicho andava aos trancos: parava, saltava)
        let RA = s.a, RB = s.b, TA = s.ta, TB = s.tb;
        if (s.h && s.h.length >= 2) {
          const h = s.h, tq = t - ATRASO;
          let j = 1; while (j < h.length - 1 && h[j].t < tq) j++;
          RA = h[j - 1].r; TA = h[j - 1].t; RB = h[j].r; TB = h[j].t;
        }
        const span = Math.max(0.02, TB - TA), k = Math.max(0, Math.min(1.25, ((s.h && s.h.length >= 2 ? t - ATRASO : tr) - TA) / span));
        if ((s.b[1] / 100 - cam.x) ** 2 + (s.b[3] / 100 - cam.z) ** 2 > VIEW * VIEW) continue;
        for (let o = 1, i = 0; o + 4 < s.b.length; o += 5, i++) {
          const ax = RA[o] / 100, ay = RA[o + 1] / 100, az = RA[o + 2] / 100, bx = RB[o] / 100, by = RB[o + 1] / 100, bz = RB[o + 2] / 100;
          const speed = Math.hypot(bx - ax, by - ay, bz - az) / span, st = s.b[o + 4];
          let dy = (RB[o + 3] - RA[o + 3]) / 100;
          dy = ((dy + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI;
          // batida: passo de quem anda, cauda de quem nada, asa de quem voa, papo de sapo que coaxa
          let beat = 0;
          if (g.k === 'cardume' || g.k === 'palhaco' || g.k === 'salmao' || g.k === 'atum' || g.k === 'agulhao' || g.k === 'golfinho') {
            beat = 0.5 + 0.5 * Math.sin(t * (5.5 + 4.2 * speed) + i * 1.7);
          } else if (g.k === 'tubarao' || g.k === 'orca' || g.k === 'arraia' || g.k === 'tartaruga') {
            beat = 0.5 + 0.5 * Math.sin(t * (2.6 + 1.8 * speed) + i * 1.9);
          } else if (g.k === 'baleia' || g.k === 'polvo') {
            beat = 0.5 + 0.5 * Math.sin(t * (1.8 + 1.0 * speed) + i * 2.1);
          } else if (g.k === 'aguaviva') {
            beat = Math.pow(Math.max(0, Math.sin(t * 2.2 + i * 1.4)), 2);
          } else if (g.k === 'bando' || g.k === 'enxame') beat = st & 4 ? 0.5 + 0.5 * Math.sin(t * (g.k === 'enxame' ? 24 : 10) + i * 2.1) : 0.66;
          else if (g.k === 'sapos') beat = g.m === 'coaxar' && st & 1 ? 0.5 + 0.5 * Math.sin(t * 2.6 + i * 1.9) : 0;
          else beat = speed > 0.15 ? 0.5 + 0.5 * Math.sin(t * (5 + 4 * speed) + i * 2.3) : 0.5;
          const wx = ax + (bx - ax) * k, wy = ay + (by - ay) * k, wz = az + (bz - az) * k;
          skin.put(wx, wy, wz, RA[o + 3] / 100 + dy * k, beat, vis, g, i);
          if (i === 0 && game.audio && game.state === 'PLAYING') {
            const nxt = (groupVoiceT.get(g.id) ?? (t + 2 + Math.random() * 6));
            if (!groupVoiceT.has(g.id)) groupVoiceT.set(g.id, nxt);
            if (t >= nxt) {
              groupVoiceT.set(g.id, t + 5 + Math.random() * 9);
              const vel = [(bx - ax) / span, (by - ay) / span, (bz - az) / span];
              const p = [wx, wy, wz];
              if (g.k === 'bando') game.audio.play(Math.random() < 0.35 ? 'ambiente.corvo' : 'ambiente.passaro', 0.45, 0.92 + Math.random() * 0.16, 'stone', p, { vel });
              else if (g.k === 'sapos' && g.m === 'coaxar') game.audio.play('ambiente.sapo', 0.45, 0.9 + Math.random() * 0.2, 'stone', p, { vel });
              else if (g.k === 'rebanho' && speed > 1.8) game.audio.play('ambiente.galope', 0.4, 0.9 + Math.random() * 0.18, 'grass', p, { vel });
              // Só o sopro de verdade (mar.whale_blow), e só com o bicho na flor d'água: é quando ele respira.
              else if ((g.k === 'baleia' || g.k === 'orca') && wy > SEA - 2.5) game.audio.play('whale_blow', 0.55, 0.9 + Math.random() * 0.14, 'water', p, { vel });
            }
          }
        }
      }
    }
    for (const key in skins) skins[key].end();
    nat.baleiaDist = baleiaDist;
  });

  return nat;
}
