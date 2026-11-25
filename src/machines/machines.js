// LAVRA — máquinas: montar a partir dos blocos ligados a um assento, pilotar, estacionar de volta
// na grade, e as armas (canhão, dinamite, explosões). A física roda no aparelho de quem pilota;
// os outros recebem a posição pela rede.

import * as THREE from '../three.js';
import {
  B, KIND, FUNC, FACING, DIRS, NATURAL, REPLACEABLE, SOLID, BLOCKS, rotateYaw,
  K_MODEL, F_SEAT, F_CANNON, F_DYNAMITE, F_WHEEL, LEVEL,
} from '../../shared/blocks.js';
import { Y_TOP, SEA } from '../../shared/constants.js';
import { buildBody, newState, stepBody, parkCells, toWorld, applyImpulse, syncRotation } from './physics.js';
import { createParts } from './parts.js';
import { createPeles } from './pele.js';
import { peleDe } from '../../shared/barcos-pele.js';
import { raycastVoxels } from '../world/raycast.js';
import { initSuperBomba } from '../game/super-bomba.js';
import { RAIO as RAIO_SUPER } from '../../shared/super-bomba.js';

const MAX_BLOCKS = 1500;
const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function initMachines(ctx) {
  const { game, world, player, net, ui, input, scene, interaction, effects, store } = ctx;
  const superBomba = initSuperBomba({ game, player, world, net, ui, salvarSolo: ctx.salvarCrateraSolo, blast });
  const parts = createParts(() => game.icons);
  const peles = createPeles();     // modelo .glb no lugar dos cubos, para a máquina com assinatura registrada (shared/barcos-pele.js)
  const list = new Map();          // id -> máquina
  const group = new THREE.Group(); group.name = 'maquinas'; scene.add(group);
  const chunkParts = new THREE.Group(); chunkParts.name = 'pecas'; scene.add(chunkParts);
  // o barco boia nas ondas que a tela desenha (render/oceano.js → game.mar), quando o mar do arquipélago está ligado
  const env = { getBlock: world.getBlock, mar0: SEA, marAltura: (x, z) => (game.mar?.ligado && game.dim === 0 ? game.mar.altura(x, z) : NaN) };
  let seat = null;                 // { m, i } quando estou sentado
  let localId = -1;
  const tmp = [0, 0, 0], tmp2 = [0, 0, 0], q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();

  // ---- peças soltas na grade ----------------------------------------------------------------
  world.listeners.models = (c, models) => {
    if (c.partGroup) { chunkParts.remove(c.partGroup); c.partGroup = null; }
    if (models && models.length) { c.partGroup = parts.chunkGroup(c.cx, c.cz, models); chunkParts.add(c.partGroup); }
  };

  // ---- entidade ---------------------------------------------------------------------------------
  function create(d) {
    if (list.has(d.id)) destroy(d.id);
    const body = buildBody(d.blocks, { casco: true });
    const p = d.p || [d.org[0] + body.com[0], d.org[1] + body.com[1], d.org[2] + body.com[2]];
    const st = newState(p, d.q);
    const g = new THREE.Group();
    const cubes = parts.blockMesh(d.blocks, body.com);
    if (cubes) g.add(cubes);
    const nodes = [];
    d.blocks.forEach((b, i) => {
      if (KIND[b[3]] !== K_MODEL) return;
      const n = parts.build(b[3]);
      n.position.set(b[0] + 0.5 - body.com[0], b[1] + 0.5 - body.com[1], b[2] + 0.5 - body.com[2]);
      g.add(n);
      nodes[i] = n;
    });
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(g);
    const m = {
      id: d.id, blocks: d.blocks, body, st, g, nodes, owner: d.owner || 0, seats: d.seats ? [...d.seats] : body.parts.seats.map(() => 0),
      prevP: [...st.p], prevQ: [...st.q], target: null, sendT: 0, ctl: { drive: 0, steer: 0, lift: 0 }, sentSleep: false,
    };
    list.set(d.id, m);
    // pele: os cubos aparecem só até o modelo chegar; se ele não abrir, ficam (m.pele.erro) e nada mais muda
    const pele = peleDe(d.blocks);
    if (pele) peles.vestir(m, pele);
    place(m, 1);
    return m;
  }
  const comPele = (m) => !!m.pele && !m.pele.erro;
  function destroy(id) {
    const m = list.get(id);
    if (!m) return;
    if (seat && seat.m === m) standUp(false);
    if (game.audio) game.audio.removeEmitter?.('mach-' + id);
    peles.despir(m);               // o modelo é dividido entre as máquinas: sai de m.g antes da limpeza abaixo
    group.remove(m.g);
    m.g.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.groups && o.geometry.groups.length) o.geometry.dispose(); });
    list.delete(id);
  }
  function machineKind(m) {
    const parts = m.body?.parts;
    if (parts?.thrust?.some((t) => t.prop)) return 'helice';
    if (parts?.wheels?.length) return 'carro';
    if (parts?.balloons?.length || parts?.thrust?.length) return 'queimador';
    if (m.st?.inWater) return 'barco';
    return 'motor';
  }
  const mine = (m) => m.owner === net.id || net.offline;

  function place(m, alpha) {
    const st = m.st, a = alpha;
    m.g.position.set(m.prevP[0] + (st.p[0] - m.prevP[0]) * a, m.prevP[1] + (st.p[1] - m.prevP[1]) * a, m.prevP[2] + (st.p[2] - m.prevP[2]) * a);
    q1.set(m.prevQ[0], m.prevQ[1], m.prevQ[2], m.prevQ[3]); q2.set(st.q[0], st.q[1], st.q[2], st.q[3]);
    m.g.quaternion.copy(q1).slerp(q2, a);
    // rodas descem até o chão e giram; hélices giram
    for (const w of m.body.parts.wheels) {
      const n = m.nodes[w.i]; if (!n) continue;
      n.userData.wheel.position.y = -(0.45 - Math.min(0.45, w.comp));
      n.userData.spin.rotation.x = -w.spin;
    }
    for (const t of m.body.parts.thrust) { if (!t.prop) continue; const n = m.nodes[t.i]; if (n) n.userData.spin.rotation.z = t.spin; }
  }

  // posição no mundo de um ponto do corpo (relativo ao centro de massa)
  function worldPoint(m, r, out) { toWorld(m.st.R, r, out); out[0] += m.st.p[0]; out[1] += m.st.p[1]; out[2] += m.st.p[2]; return out; }

  // ---- montar ------------------------------------------------------------------------------------
  // Uma roda só se prende pelo eixo ou por cima (suspensão): o piso em que ela pisa não entra na máquina.
  const wheelHolds = (wheelId, dx, dy, dz) => {
    if (dy === 1) return true;
    const ax = DIRS[FACING[wheelId]];
    return dy === 0 && (ax[0] !== 0 ? dx !== 0 : dz !== 0);
  };
  function assemble(x, y, z) {
    const seen = new Set();
    const out = [], queue = [[x, y, z, 0, 0, 0]];
    while (queue.length) {
      const [cx, cy, cz, fx, fy, fz] = queue.pop();
      const key = cx + ',' + cy + ',' + cz;
      if (seen.has(key)) continue;
      const id = world.getBlock(cx, cy, cz);
      if (id <= 0 || NATURAL[id]) continue;
      // cheguei numa roda vindo de (f): só vale se a roda se prende por esse lado
      if (FUNC[id] === F_WHEEL && (fx || fy || fz) && !wheelHolds(id, -fx, -fy, -fz)) continue;
      seen.add(key);
      out.push([cx, cy, cz, id]);
      if (out.length > MAX_BLOCKS) { ui.toast(`Máquina grande demais (mais de ${MAX_BLOCKS} blocos): ela está encostada em outra construção. Deixe um vão de 1 bloco em volta.`, 7000); return; }
      for (const n of NB) {
        if (FUNC[id] === F_WHEEL && !wheelHolds(id, n[0], n[1], n[2])) continue;
        queue.push([cx + n[0], cy + n[1], cz + n[2], n[0], n[1], n[2]]);
      }
    }
    if (out.length < 2) return ui.toast('Ligue o assento a pelo menos um bloco de obra para formar a máquina.');
    if (net.offline) {
      for (const b of out) world.setBlock(b[0], b[1], b[2], B.AIR);
      const org = [Math.min(...out.map((b) => b[0])), Math.min(...out.map((b) => b[1])), Math.min(...out.map((b) => b[2]))];
      const m = create({ id: localId--, org, blocks: out.map((b) => [b[0] - org[0], b[1] - org[1], b[2] - org[2], b[3]]), owner: net.id });
      sit(m, 0);
      return;
    }
    net.send({ t: 'm+', blocks: out });
  }

  function sit(m, i) {
    seat = { m, i };
    m.seats[i] = net.id;
    if (i === 0) m.owner = net.id;
    player.flying = false;
    game.hideSelf = true;
    game.camWant = Math.min(30, Math.max(6, m.body.radius * 1.8 + 3));
    ui.toast(comPele(m) ? 'W/S acelera · A/D vira · G ancora · X desvira · F sai'
      : 'W/S acelera · A/D vira · Espaço/Shift sobe e desce · clique atira · G estaciona · X desvira · F sai', 7000);
  }
  function standUp(tell = true) {
    if (!seat) return;
    const { m, i } = seat;
    m.seats[i] = 0;
    m.ctl.drive = m.ctl.steer = m.ctl.lift = 0;
    worldPoint(m, m.body.parts.seats[i].r, tmp);
    seat = null;
    game.hideSelf = false; game.camWant = undefined;
    player.teleport(tmp[0], tmp[1] + 1.1, tmp[2]);
    if (tell && !net.offline) net.send({ t: 'ms', id: m.id, seat: -1 });
  }

  // Máquina com pele não volta à grade (o casco de blocos reapareceria no lugar do modelo): o G só a segura onde está.
  function ancorar(m) {
    const st = m.st;
    if (Math.hypot(st.v[0], st.v[1], st.v[2]) >= 2) return ui.toast('Pare o barco antes de ancorar.');
    st.v.fill(0); st.w.fill(0);
    ui.toast('Barco ancorado.');
  }
  function park(m) {
    if (comPele(m)) return ancorar(m);
    const st = m.st;
    if (Math.hypot(st.v[0], st.v[1], st.v[2]) > 2) return ui.toast('Pare a máquina antes de estacionar.');
    const cells = parkCells(m.body, st, rotateYaw);
    if (!cells) return ui.toast('A máquina precisa estar em pé para estacionar. Aperte X para desvirar.');
    for (const c of cells) {
      const cur = world.getBlock(c[0], c[1], c[2]);
      if (c[1] <= (Number.isFinite(world.fundo) ? world.fundo : 0) || c[1] >= Y_TOP || cur === -1 || !REPLACEABLE[cur]) return ui.toast('Não há espaço livre aqui para estacionar.');
    }
    if (net.offline) { const id = m.id; destroy(id); for (const c of cells) world.setBlock(c[0], c[1], c[2], c[3]); return; }
    net.send({ t: 'm-', id: m.id, cells });
  }

  function flip(m) {
    const st = m.st;
    toWorld(st.R, [0, 0, -1], tmp);
    const yaw = Math.atan2(-tmp[0], -tmp[2]);
    st.q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    st.p[1] += 1.6; st.v.fill(0); st.w.fill(0); st.asleep = false; st.still = 0;
  }

  // ---- armas ------------------------------------------------------------------------------------------
  const shots = [];
  const shotGeo = new THREE.SphereGeometry(0.16, 10, 8), shotMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1c });
  const flashGeo = new THREE.SphereGeometry(1, 16, 12);
  const flashes = [];
  const hitInfo = {};
  let shotSeq = 0;
  function spawnShot(p, v, own) {
    const mesh = new THREE.Mesh(shotGeo, shotMat);
    mesh.position.set(p[0], p[1], p[2]);
    scene.add(mesh);
    shots.push({ eid: 'shot-' + (++shotSeq), p: [...p], v: [...v], life: 7, own, mesh });
  }
  function fire(p, dir, baseV) {
    const v = [baseV[0] + dir[0] * 58, baseV[1] + dir[1] * 58 + 1.5, baseV[2] + dir[2] * 58];
    spawnShot(p, v, true);
    effects.burst(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]), [0.9, 0.9, 0.9], 6, 0.6);
    if (game.audio) game.audio.play('shot', 0.9, 0.9 + Math.random() * 0.2, 'metal', p, { vel: baseV });
    if (!net.offline) net.send({ t: 'sh', p: p.map((x) => +x.toFixed(2)), v: v.map((x) => +x.toFixed(2)) });
  }
  function flash(x, y, z, r) {
    const grande = r === RAIO_SUPER;
    const mesh = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: grande ? 0xffad68 : 0xffd9a0, transparent: true, opacity: grande ? 0.48 : 0.9, depthWrite: false, fog: false }));
    mesh.position.set(x, y, z); mesh.scale.setScalar(0.3);
    scene.add(mesh);
    flashes.push({ mesh, t: 0, r, grande });
  }
  // efeitos e empurrão de uma explosão (em todos os clientes)
  function blast(x, y, z, r) {
    flash(x, y, z, r);
    if (r === RAIO_SUPER) r /= 2.5; // a onda alcança a borda da cratera
    if (game.audio) game.audio.play('boom', Math.min(1.4, 0.6 + r * 0.15), 0.7 + Math.random() * 0.15, 'stone', [x, y, z]);
    const dx = player.pos[0] - x, dy = player.pos[1] + 0.9 - y, dz = player.pos[2] - z, d = Math.hypot(dx, dy, dz);
    game.shake = Math.max(game.shake || 0, Math.max(0, 1 - d / (r * 6)) * 0.5);
    if (!seat && d < r * 2.2 && d > 0.01) {
      const k = (1 - d / (r * 2.2)) * 16 / d;
      player.vel[0] += dx * k; player.vel[1] += Math.max(2, dy * k + 4); player.vel[2] += dz * k;
      player.onGround = false;
    }
    for (const m of list.values()) {
      if (!mine(m)) continue;
      const ex = m.st.p[0] - x, ey = m.st.p[1] - y, ez = m.st.p[2] - z, ed = Math.hypot(ex, ey, ez);
      if (ed > r * 2.5 + m.body.radius || ed < 0.01) continue;
      const k = Math.max(0, 1 - ed / (r * 2.5 + m.body.radius)) * 7 * Math.sqrt(m.body.mass) / ed;
      applyImpulse(m.body, m.st, [ex * k, ey * k + 2, ez * k], [0, -0.3, 0]);
    }
  }
  // quem causou a explosão decide os blocos destruídos e avisa a todos
  function explode(x, y, z, r) {
    const edits = [], chain = [];
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z), ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
      const bx = cx + dx, by = cy + dy, bz = cz + dz;
      const d = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z);
      if (d > r || by <= (Number.isFinite(world.fundo) ? world.fundo : 0) || by >= Y_TOP) continue;
      const id = world.getBlock(bx, by, bz);
      if (id <= 0 || id === B.BEDROCK || LEVEL[id]) continue;
      if (FUNC[id] === F_DYNAMITE) chain.push([bx, by, bz]);
      else if (d > r * 0.6 && Math.random() < (d / r - 0.6) * 2.2) continue; // borda irregular
      edits.push([bx, by, bz, B.AIR]);
    }
    for (const e of edits) world.setBlock(e[0], e[1], e[2], B.AIR);
    for (let i = 0; i < Math.min(edits.length, 10); i++) { const e = edits[(i * 7) % edits.length]; effects.burst(e[0], e[1], e[2], [0.35, 0.3, 0.26], 8, 2.2); }
    blast(x, y, z, r);
    if (!net.offline) { for (let i = 0; i < edits.length; i += 400) net.send({ t: 'bb', l: edits.slice(i, i + 400) }); net.send({ t: 'ex', p: [+x.toFixed(1), +y.toFixed(1), +z.toFixed(1)], r }); }
    chain.forEach((c, i) => setTimeout(() => explode(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5, 4), 180 + i * 90));
  }
  const fuses = new Set();
  function ignite(x, y, z) {
    const k = x + ',' + y + ',' + z;
    if (fuses.has(k)) return;
    fuses.add(k);
    ui.toast('Pavio aceso! Afaste-se.', 2200);
    setTimeout(() => { fuses.delete(k); if (FUNC[world.getBlock(x, y, z)] === F_DYNAMITE) { interaction.set(x, y, z, B.AIR); explode(x + 0.5, y + 0.5, z + 0.5, 4); } }, 2400);
  }

  // ---- rede ---------------------------------------------------------------------------------------------
  game.hooks.other.push((msg) => {
    switch (msg.t) {
      case 'welcome': for (const id of [...list.keys()]) destroy(id); for (const d of msg.machines || []) create(d); break;
      case 'offline': for (const id of [...list.keys()]) destroy(id); break;
      case 'm+': {
        for (const b of msg.cells) world.setBlock(b[0], b[1], b[2], B.AIR);
        const m = create(msg.m);
        if (msg.m.owner === net.id) sit(m, 0);
        break;
      }
      case 'm-': {
        destroy(msg.id);
        for (const c of msg.cells) world.setBlock(c[0], c[1], c[2], c[3]);
        break;
      }
      case 'mv': {
        const m = list.get(msg.id);
        if (m && !(seat && seat.m === m && seat.i === 0)) { m.target = { p: msg.p, q: msg.q, v: msg.v, t: performance.now() / 1000 }; m.owner = msg.by; }
        break;
      }
      case 'ms': {
        const m = list.get(msg.id);
        if (!m) break;
        for (let i = 0; i < m.seats.length; i++) if (m.seats[i] === msg.pid) m.seats[i] = 0;
        if (msg.seat >= 0) { m.seats[msg.seat] = msg.pid; if (msg.seat === 0) m.owner = msg.pid; if (msg.pid === net.id) sit(m, msg.seat); }
        break;
      }
      case 'sh': spawnShot(msg.p, msg.v, false); break;
      case 'ex': blast(msg.p[0], msg.p[1], msg.p[2], msg.r); break;
      case 'bb':
        for (const e of msg.l) {
          const was = world.getBlock(e[0], e[1], e[2]);
          world.setBlock(e[0], e[1], e[2], e[3], e[4] || 0);   // 5º campo: terra moldada
          if (!msg.q && e[3] === B.AIR && was > 0 && was !== B.WATER && was !== B.PORTAL) {   // q: obra por área, sem efeito de quebra
            effects?.breakBlock?.(e[0], e[1], e[2], was);
          }
        }
        break;
      case 'leave': for (const m of list.values()) for (let i = 0; i < m.seats.length; i++) if (m.seats[i] === msg.id) m.seats[i] = 0; break;
    }
  });

  // ---- física (passo fixo) ------------------------------------------------------------------------------------
  game.hooks.fixed.push((dt, intent) => {
    for (const m of list.values()) {
      m.prevP[0] = m.st.p[0]; m.prevP[1] = m.st.p[1]; m.prevP[2] = m.st.p[2];
      m.prevQ[0] = m.st.q[0]; m.prevQ[1] = m.st.q[1]; m.prevQ[2] = m.st.q[2]; m.prevQ[3] = m.st.q[3];
      const piloting = seat && seat.m === m && seat.i === 0;
      if (piloting) { m.ctl.drive = intent.z; m.ctl.steer = intent.x; m.ctl.lift = (intent.jump ? 1 : 0) - (intent.sneak ? 1 : 0); }
      else if (m.seats[0] === 0) { m.ctl.drive = m.ctl.steer = m.ctl.lift = 0; }
      if (piloting || (mine(m) && m.seats[0] === 0)) {
        stepBody(m.body, m.st, m.ctl, dt, env);
        if (!net.offline) {
          m.sendT -= dt;
          if (!m.st.asleep) m.sentSleep = false;
          if (m.sendT <= 0 && !m.sentSleep) {
            m.sendT = 1 / 15;
            if (m.st.asleep) m.sentSleep = true;
            const s = m.st;
            net.send({ t: 'mv', id: m.id, p: s.p.map((x) => +x.toFixed(3)), q: s.q.map((x) => +x.toFixed(4)), v: s.v.map((x) => +x.toFixed(2)) });
          }
        }
      } else if (m.target) {
        // máquina de outra pessoa: persegue o último estado recebido, extrapolando pela velocidade
        const t = m.target, age = Math.min(0.25, performance.now() / 1000 - t.t), k = Math.min(1, dt * 14);
        for (let i = 0; i < 3; i++) m.st.p[i] += (t.p[i] + t.v[i] * age - m.st.p[i]) * k;
        q1.set(m.st.q[0], m.st.q[1], m.st.q[2], m.st.q[3]).slerp(q2.set(t.q[0], t.q[1], t.q[2], t.q[3]), k);
        m.st.q[0] = q1.x; m.st.q[1] = q1.y; m.st.q[2] = q1.z; m.st.q[3] = q1.w;
        m.st.v[0] = t.v[0]; m.st.v[1] = t.v[1]; m.st.v[2] = t.v[2];
        syncRotation(m.st); // matriz em dia para quem vai de carona ou mira num canhão
      }
    }
    if (!seat) return false;
    // sentado: o corpo do jogador acompanha o assento
    const m = seat.m;
    worldPoint(m, m.body.parts.seats[seat.i].r, tmp);
    player.prev[0] = player.pos[0]; player.prev[1] = player.pos[1]; player.prev[2] = player.pos[2];
    player.pos[0] = tmp[0]; player.pos[1] = tmp[1] - 0.6; player.pos[2] = tmp[2];
    player.vel[0] = m.st.v[0]; player.vel[1] = m.st.v[1]; player.vel[2] = m.st.v[2];
    player.onGround = false;
    return true;
  });

  // ---- por quadro ------------------------------------------------------------------------------------------------
  game.hooks.frame.push((dt, alpha) => {
    // motor: quem pilota ouve em primeira pessoa; todas as outras máquinas em movimento viram emissores 3D com Doppler
    if (game.audio) {
      if (seat && seat.i === 0 && game.state === 'PLAYING') {
        const m = seat.m, thr = Math.min(1, Math.abs(m.ctl.drive) + Math.abs(m.ctl.lift) * 0.7);
        game.audio.engine(0.4 + 0.6 * thr, 0.2 + 0.45 * thr + Math.min(0.9, Math.hypot(m.st.v[0], m.st.v[1], m.st.v[2]) / 32), machineKind(m));
      } else game.audio.engine(0, 0);
      for (const m of list.values()) {
        const isSelfPilot = seat && seat.m === m && seat.i === 0 && game.state === 'PLAYING';
        const sp = Math.hypot(m.st.v[0], m.st.v[1], m.st.v[2]);
        if (isSelfPilot || sp < 0.45 || game.state !== 'PLAYING') {
          game.audio.removeEmitter?.('mach-' + m.id);
        } else {
          game.audio.setEmitter?.('mach-' + m.id, {
            key: 'ambiente.' + machineKind(m),
            pos: m.st.p,
            vel: m.st.v,
            volume: Math.min(0.65, 0.16 + sp / 30),
            pitch: 0.78 + Math.min(0.75, sp / 32),
            refDist: 6,
            maxDist: 68,
          });
        }
      }
    }
    for (const m of list.values()) place(m, alpha);
    // tiros: com emissor 3D em voo (efeito Doppler na passagem do projétil)
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.life -= dt;
      s.v[1] -= 13 * dt;
      const sp = Math.hypot(s.v[0], s.v[1], s.v[2]), step = sp * dt;
      raycastVoxels(world.getBlock, s.p[0], s.p[1], s.p[2], s.v[0] / sp, s.v[1] / sp, s.v[2] / sp, step, (id) => SOLID[id] === 1, hitInfo);
      if (hitInfo.hit || s.life <= 0 || s.p[1] < (Number.isFinite(world.fundo) ? world.fundo : 0) - 5) {
        if (game.audio) game.audio.removeEmitter?.(s.eid);
        if (hitInfo.hit && s.own) explode(s.p[0] + s.v[0] / sp * hitInfo.t, s.p[1] + s.v[1] / sp * hitInfo.t, s.p[2] + s.v[2] / sp * hitInfo.t, 2.7);
        scene.remove(s.mesh); shots[i] = shots[shots.length - 1]; shots.pop();
        continue;
      }
      s.p[0] += s.v[0] * dt; s.p[1] += s.v[1] * dt; s.p[2] += s.v[2] * dt;
      s.mesh.position.set(s.p[0], s.p[1], s.p[2]);
      if (game.audio && game.state === 'PLAYING') {
        game.audio.setEmitter?.(s.eid, { key: 'ambiente.vento_forte', pos: s.p, vel: s.v, volume: 0.42, pitch: 1.5, refDist: 4, maxDist: 52 });
      }
    }
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt * (f.grande ? 0.8 : 3.2);
      f.mesh.scale.setScalar(0.3 + f.r * (f.grande ? 1 : 1.5) * Math.min(1, f.t));
      f.mesh.material.opacity = Math.max(0, (f.grande ? 0.48 : 0.9) * (1 - f.t));
      if (f.t >= 1) { scene.remove(f.mesh); f.mesh.material.dispose(); flashes[i] = flashes[flashes.length - 1]; flashes.pop(); }
    }
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 1.4);
  });

  // ---- mira e comandos -----------------------------------------------------------------------------------------------
  let fireT = 0;
  game.hooks.interact.push((dt, playing, o, d) => {
    fireT -= dt;
    if (seat) {
      const m = seat.m, pilot = seat.i === 0;
      ui.setHint(pilot ? `Pilotando — ${Math.round(Math.hypot(m.st.v[0], m.st.v[1], m.st.v[2]) * 3.6)} km/h` : 'De carona');
      if (!playing) return true;
      if (input.wasPressed('interact')) { standUp(); return true; }
      if (pilot) {
        if (input.wasPressed('park')) park(m);
        if (input.wasPressed('flip')) flip(m);
        if ((input.isDown('fire') || input.isDown('break')) && fireT <= 0 && m.body.parts.cannons.length) {
          fireT = Math.max(0.16, 0.9 / m.body.parts.cannons.length);
          const c = m.body.parts.cannons[(m.nextCannon = ((m.nextCannon || 0) + 1) % m.body.parts.cannons.length)];
          toWorld(m.st.R, c.dir, tmp2);
          worldPoint(m, [c.r[0] + c.dir[0] * 0.9, c.r[1] + c.dir[1] * 0.9, c.r[2] + c.dir[2] * 0.9], tmp);
          fire([tmp[0], tmp[1], tmp[2]], [tmp2[0], tmp2[1], tmp2[2]], m.st.v);
          toWorld(m.st.R, c.r, tmp);
          applyImpulse(m.body, m.st, [-tmp2[0] * 4, -tmp2[1] * 4, -tmp2[2] * 4], tmp);
        }
      }
      return true;
    }
    // a pé: assento, canhão e dinamite da grade respondem ao "usar"
    const t = interaction.target;
    if (!t.hit||t.t>(game.treeAim?.t??Infinity)) return false;
    const fn = FUNC[t.id];
    if (t.id === B.SUPER_BOMBA) {
      if (playing && input.wasPressed('interact')) { superBomba.acender([t.x, t.y, t.z]); return true; }
      return false;
    }
    if (fn === F_SEAT) ui.setHint('Assento do piloto — F monta a máquina e senta');
    else if (fn === F_CANNON) ui.setHint('Canhão — F dispara');
    else if (fn === F_DYNAMITE) ui.setHint('Dinamite — F acende o pavio');
    else return false;
    if (playing && input.wasPressed('interact')) {
      if (fn === F_SEAT) assemble(t.x, t.y, t.z);
      else if (fn === F_DYNAMITE) ignite(t.x, t.y, t.z);
      else if (fireT <= 0) { fireT = 0.8; const dir = DIRS[FACING[t.id]]; fire([t.x + 0.5 + dir[0] * 0.9, t.y + 0.5 + dir[1] * 0.9, t.z + 0.5 + dir[2] * 0.9], dir, [0, 0, 0]); }
      return true;
    }
    return false;
  });

  // sentar numa máquina já montada: mirar em qualquer parte dela (com pele, no modelo: os cubos escondidos não contam)
  const ray = new THREE.Raycaster();
  function machineSeatAt(o, d, max, fresco) {
    ray.set(new THREE.Vector3(o[0], o[1], o[2]), new THREE.Vector3(d[0], d[1], d[2])); ray.far = max;
    const hits = ray.intersectObjects(group.children, true);    // cubos e peças das máquinas sem pele
    const hp = peles.mira(ray, list, fresco);                   // malhas dos modelos (pele.js dosa a conta)
    if (!hits.length || (hp && hp.t < hits[0].distance)) return hp;
    let n = hits[0].object;
    while (n.parent && n.parent !== group) n = n.parent;
    for (const m of list.values()) if (m.g === n) return { m, t: hits[0].distance };
    return null;
  }
  game.hooks.interact.unshift((dt, playing, o, d) => {
    if (seat) return false;
    const h = machineSeatAt(o, d, Math.min(interaction.target.hit ? interaction.target.t : 7,game.treeAim?.t??Infinity), input.wasPressed('interact'));
    if (!h) return false;
    const free = h.m.seats.findIndex((p) => p === 0);
    const nome = comPele(h.m) ? h.m.pele.nome : `Máquina (${h.m.blocks.length} blocos)`;
    ui.setHint(free >= 0 ? `${nome} — F ${free === 0 ? 'pilota' : 'vai de carona'}` : comPele(h.m) ? `${nome} — lotado` : 'Máquina lotada');
    if (playing && input.wasPressed('interact') && free >= 0) {
      if (net.offline) sit(h.m, free); else net.send({ t: 'ms', id: h.m.id, seat: free });
    }
    return true;
  });

  return { list, assemble, sit, standUp, park, flip, explode, fire, ignite, superBomba, seatAt: machineSeatAt, get seat() { return seat; }, parts, peles };
}
