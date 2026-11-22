// LAVRA — criaturas e NPCs no cliente: desenho, interpolação, golpes, vida do jogador,
// travessia do véu e o gesto do ritual. A simulação é do servidor (server/entities.js).

import * as THREE from '../three.js';
import { B } from '../../shared/blocks.js';
import { MODELS } from './models.js';
import { buildBody, nameTag } from '../render/avatars.js';
import { h } from '../ui/ui.js';
import { armaDe } from '../../shared/tesouros.js';   // arma lendária na mão: alcance, recarga e golpe (server/armas.js)

export function initEntities(ctx) {
  const { game, world, player, net, ui, input, scene, interaction, effects, lightProbe, respawn } = ctx;
  const list = new Map();
  const group = new THREE.Group(); group.name = 'seres'; scene.add(group);
  game.hp = game.maxHp = 20;
  game.hurt = (v, de) => hurt(v, de);   // queda e afogamento (game/modes.js) machucam pelo mesmo caminho
  let hurtT = 99, regenT = 0, crossT = 0, lastFoe = '';

  // HUD: barra de vida e clarão de dor
  const bar = h('i');
  const life = h('div', { class: 'vida hide', role: 'progressbar', 'aria-label': 'Vida' }, bar);
  const pain = h('div', { class: 'dor' });
  ui.el.hud.append(pain, life);
  const showLife = () => { bar.style.width = Math.max(0, game.hp / game.maxHp * 100) + '%'; };

  // feixe dos tiros dos vigias
  const beams = [];
  const beamMat = new THREE.LineBasicMaterial({ color: 0xff7a5a, transparent: true, opacity: 1, fog: false });

  function add(e) {
    if (list.has(e.id)) remove(e.id);
    let m;
    if (e.k === 'npc') { const b = buildBody(e.color || '#c9a227'); b.root.add(nameTag(e.name, e.color || '#c9a227')); m = { root: b.root, legs: [b.legL, b.legR], arms: [b.armL, b.armR], head: b.head, height: 1.8, frenteZ: true }; }
    else m = (MODELS[e.type] || MODELS.dentefera)();
    m.root.position.set(e.p[0], e.p[1], e.p[2]);
    m.root.rotation.y = e.yaw + (m.frenteZ ? 0 : Math.PI);   // boneco com skin (NPC, armadura) tem o rosto em −Z; as criaturas, em +Z
    group.add(m.root);
    list.set(e.id, { ...e, m, tp: [...e.p], tyaw: e.yaw, pos: [...e.p], yaw: e.yaw, phase: 0, speed: 0, atk: 0, flash: 0, last: [...e.p] });
  }
  function remove(id, morte) {
    const e = list.get(id);
    if (!e) return;
    if (morte && game.audio) game.audio.play('growl', 1, 0.55, e.type, e.pos);
    if (morte) for (let i = 0; i < 4; i++) effects.burst(Math.floor(e.pos[0]), Math.floor(e.pos[1] + i * e.m.height / 4), Math.floor(e.pos[2]), [0.25, 0.1, 0.35], 14, 1.6);
    group.remove(e.m.root);
    list.delete(id);
  }
  function clear() { for (const id of [...list.keys()]) remove(id); }

  function die() {
    ui.toast(lastFoe ? `Você caiu diante de ${lastFoe}.` : 'Você caiu.', 4500);
    net.send({ t: 'morri', de: lastFoe });
    game.hp = game.maxHp; showLife();
    respawn();
  }
  function hurt(v, de) {
    if (game.modeRules && !game.modeRules.dano) return;    // criativo e espectador não levam dano (game/modes.js)
    lastFoe = de || '';
    game.hp -= v; hurtT = 0;
    pain.classList.add('on');
    setTimeout(() => pain.classList.remove('on'), 180);
    game.shake = Math.max(game.shake || 0, 0.25);
    if (game.audio) game.audio.play('hurt', 0.8, 0.9 + Math.random() * 0.2);
    showLife();
    if (game.hp <= 0) die();
  }

  game.hooks.other.push((m) => {
    switch (m.t) {
      case 'welcome': clear(); for (const e of m.entities || []) add(e); game.hp = game.maxHp; showLife(); break;
      case 'offline': clear(); break;
      case 'e+': add(m.e); break;
      case 'e-': remove(m.id, m.morte); break;
      case 'es': for (const s of m.l) { const e = list.get(s[0]); if (!e) continue; e.tp[0] = s[1]; e.tp[1] = s[2]; e.tp[2] = s[3]; e.tyaw = s[4]; if (s[5] < e.hp && game.audio && e.k === 'cr') game.audio.play('hurt', 0.85, 0.9 + Math.random() * 0.2, e.type, e.pos); if (s[5] < e.hp) e.flash = 0.18; e.hp = s[5]; } break;
      case 'golpe': { const e = list.get(m.id); if (e) { e.atk = 0.35; if (game.audio) game.audio.play('hit', 0.7, 0.9 + Math.random() * 0.2, e.type, e.pos); } break; }
      case 'tiro': {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...m.a), new THREE.Vector3(...m.b)]), beamMat.clone());
        scene.add(line); beams.push({ line, t: 0.3 });
        if (game.audio) game.audio.play('shot', 0.72, 1.35, 'metal', m.a);
        break;
      }
      case 'dano': hurt(m.v, m.de); break;
    }
  });

  game.hooks.frame.push((dt) => {
    for (const e of list.values()) {
      const k = Math.min(1, dt * 11), m = e.m;
      e.pos[0] += (e.tp[0] - e.pos[0]) * k; e.pos[1] += (e.tp[1] - e.pos[1]) * k; e.pos[2] += (e.tp[2] - e.pos[2]) * k;
      let dy = e.tyaw - e.yaw;
      dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      e.yaw += dy * k;
      const moved = Math.hypot(e.pos[0] - e.last[0], e.pos[2] - e.last[2]);
      const vel = dt > 0 ? [(e.pos[0] - e.last[0]) / dt, (e.pos[1] - e.last[1]) / dt, (e.pos[2] - e.last[2]) / dt] : [0, 0, 0];
      e.last[0] = e.pos[0]; e.last[1] = e.pos[1]; e.last[2] = e.pos[2];
      // criatura rosna de tempos em tempos: quanto maior o corpo, mais grave a voz (com Doppler pela velocidade)
      if (e.k === 'cr' && game.audio && game.state === 'PLAYING' && (e.voiceT = (e.voiceT ?? 2 + Math.random() * 6) - dt) <= 0) {
        e.voiceT = 4 + Math.random() * 9;
        game.audio.play('growl', 0.9, Math.max(0.5, Math.min(1.5, 1.9 / Math.max(1, m.height))) * (0.92 + Math.random() * 0.16), e.type, e.pos, { vel });
      }
      e.speed += (Math.min(8, dt > 0 ? moved / dt : 0) - e.speed) * Math.min(1, dt * 8);
      e.phase += e.speed * dt * 2.2 + dt * 0.6;
      const bob = m.floats ? Math.sin(e.phase * 0.9) * 0.18 : 0;
      m.root.position.set(e.pos[0], e.pos[1] + bob, e.pos[2]);
      m.root.rotation.y = e.yaw + (m.frenteZ ? 0 : Math.PI);
      const sw = Math.sin(e.phase * 1.6) * Math.min(1, e.speed / 2.5) * 0.8;
      if (m.legs) m.legs.forEach((l, i) => { l.rotation.x = (i % 2 ? -1 : 1) * sw * (m.legs.length === 4 && i > 1 ? -1 : 1); });
      e.atk = Math.max(0, e.atk - dt);
      const lunge = e.atk > 0 ? Math.sin((0.35 - e.atk) / 0.35 * Math.PI) : 0;
      if (m.arms) { m.arms[0].rotation.x = -sw * 0.7 - lunge * 1.6; m.arms[1].rotation.x = sw * 0.7 - lunge * 1.9; }
      if (m.head && !m.arms) m.head.rotation.x = -lunge * 0.6;
      if (m.ring) { m.ring.rotation.z += dt * 2.4; m.ring.rotation.x = Math.PI / 2 + Math.sin(e.phase) * 0.3; }
      if (m.tails) m.tails.forEach((t, i) => { t.rotation.z = Math.sin(e.phase * 0.8 + i) * 0.35; });
      if (m.core && lunge) m.core.scale.setScalar(1 + lunge * 0.12); else if (m.core) m.core.scale.setScalar(1);
      // pisca ao levar golpe
      e.flash = Math.max(0, e.flash - dt);
      m.root.visible = !(e.flash > 0 && Math.floor(e.flash * 30) % 2 === 0);
    }
    for (let i = beams.length - 1; i >= 0; i--) {
      const b = beams[i];
      b.t -= dt; b.line.material.opacity = Math.max(0, b.t / 0.3);
      if (b.t <= 0) { scene.remove(b.line); b.line.geometry.dispose(); b.line.material.dispose(); beams.splice(i, 1); }
    }
    // vida: volta devagar depois de um tempo sem apanhar
    hurtT += dt;
    if (game.hp < game.maxHp && hurtT > 6) { regenT += dt; if (regenT > 1.2) { regenT = 0; game.hp = Math.min(game.maxHp, game.hp + 1); showLife(); } }
    let danger = game.dim === 1 || game.hp < game.maxHp || !!game.modeRules?.dano;   // no sobrevivência a vida fica sempre à vista
    if (!danger) for (const e of list.values()) if (e.k === 'cr') { danger = true; break; }
    life.classList.toggle('hide', !danger || game.state === 'MENU');

    if (game.state !== 'PLAYING') return;
    // dentro do véu: pede a travessia
    crossT -= dt;
    if (crossT <= 0 && !net.offline) {
      crossT = 0.35;
      const x = Math.floor(player.pos[0]), y = Math.floor(player.pos[1] + 0.4), z = Math.floor(player.pos[2]);
      if (world.getBlock(x, y, z) === B.PORTAL || world.getBlock(x, y + 1, z) === B.PORTAL) net.send({ t: 'atravessar' });
    }
    // na Zona, cair das ilhas custa caro
    if (game.dim === 1 && player.pos[1] < 5) { hurt(6, 'o vazio'); if (game.hp > 0) respawn(); }
  });

  // mira: criatura na frente leva o golpe antes do bloco
  const hitT = { t: 0 };
  // arma lendária na barra (fora do criativo a barra são os 9 primeiros espaços da mochila): o servidor confere
  const armaNaMao = () => { if (!game.modeRules || game.modeRules.criativo) return null; const e = game.items?.bag?.l?.[game.sel]; return e ? armaDe(e[0]) : null; };
  game.hooks.interact.unshift((dt, playing, o, d) => {
    hitT.t -= dt;
    const arma = armaNaMao(), alc = arma ? arma.alcance : 5.4;
    let best = null, bt = interaction.target.hit ? Math.min(interaction.target.t, alc) : alc;
    bt=Math.min(bt,game.treeAim?.t??Infinity);
    for (const e of list.values()) {
      if (e.k !== 'cr') continue;
      const r = Math.max(0.6, e.m.height * 0.5), cy = e.pos[1] + e.m.height * 0.5;
      const lx = e.pos[0] - o[0], ly = cy - o[1], lz = e.pos[2] - o[2];
      const tca = lx * d[0] + ly * d[1] + lz * d[2];
      if (tca < 0) continue;
      const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
      if (d2 > r * r) continue;
      const t = tca - Math.sqrt(r * r - d2);
      if (t < bt) { bt = t; best = e; }
    }
    if (best) {
      ui.setHint(`${best.name} — ${Math.max(0, best.hp)}/${best.max}`);
      if (playing && input.isDown('break') && hitT.t <= 0) { hitT.t = arma ? arma.recarga / 1000 : 0.32; net.send(arma ? { t: 'atk', id: best.id, a: game.sel } : { t: 'atk', id: best.id }); best.flash = 0.12; if (game.audio) game.audio.play('hit', 0.6, 1.2 + Math.random() * 0.2, 'stone', best.pos); }
      return true;
    }
    // o ritual não tem dica na tela: só quem sabe a receita tenta
    const t = interaction.target;
    if (playing && t.hit && t.t<(game.treeAim?.t??Infinity) && (t.id === B.BASALT || t.id === B.CRYSTAL_ORE) && game.hotbar[game.sel] === B.GOLD_BLOCK && input.wasPressed('interact')) net.send({ t: 'ritual', x: t.x, y: t.y, z: t.z });
    return false;
  });

  return { list, hurt };
}
