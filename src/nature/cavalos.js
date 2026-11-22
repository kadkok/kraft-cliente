// LAVRA — cavalos do lado de quem joga (pedido do Kadmus, 17/11/2026): mirar, interagir e montar.
//   Mirando um cavalo (até 4,5 m): a dica mostra quem é (garanhão, égua, potro; idade; prenhe; domado).
//   F            carinho (tocar)                      · F com capim/samambaia/flor na mão: oferecer comida
//   Shift + F    tentar montar (o cavalo decide: aceita, corcoveia, empina, se afasta…)
//   clique       bater (ele lembra: perde a confiança e pode revidar)
//   Montado:     W anda a trote · W+Shift a passo · W+Ctrl galopa · S para (e recua devagar) · A/D desvia
//                o rumo segue a câmera · Espaço pula · F desce
// A física do cavalo montado é a mesma dos bichos (shared/bodies.js), rodando aqui; o servidor confere cada posição
// (velocidade possível, sem atravessar bloco) e manda corrigir se não bater. O cavalo pode derrubar quem monta.
import { BODY, newBody, stepBody } from '../../shared/bodies.js';
import { ACOES, MARCHA, eComida } from '../../shared/equino.js';
import { B } from '../../shared/blocks.js';

const ALCANCE = 4.5, SELA = 0.62, PULO = Math.sqrt(2 * 24 * 1.7);

export function initCavalos({ game, world, player, net, ui, input }) {
  const nat = game.nature;
  const api = { montado: null, eu: player.pos };
  game.cavalos = api;
  let golpeAte = 0, envio = 0, puloSolto = true;

  // corpo i do grupo g, como chegou da rede (último retrato)
  const corpoNaRede = (g, i) => { const s = nat.bodies.get(g.id); if (!s) return null; const o = 1 + i * 5; return s.b.length > o + 4 ? { x: s.b[o] / 100, y: s.b[o + 1] / 100, z: s.b[o + 2] / 100, yaw: s.b[o + 3] / 100, f: s.b[o + 4] } : null; };
  const descricao = (g, i) => {
    const a = g.eq?.[i]; if (!a) return 'Cavalo';
    const anos = (a[7] || 0) / 10, macho = a[0] === 1, cres = a[1];
    const quem = cres < 60 ? (macho ? 'potro' : 'potra') : anos < 4 ? (macho ? 'cavalo jovem' : 'égua jovem') : macho ? 'garanhão' : 'égua';
    const extra = [anos >= 1 ? `${Math.floor(anos)} ano${Math.floor(anos) > 1 ? 's' : ''}` : `${Math.max(1, Math.round(anos * 12))} ${Math.round(anos * 12) > 1 ? 'meses' : 'mês'}`];
    if (a[3]) extra.push('prenhe'); if (a[4] >= 50) extra.push('domado'); if (anos > 20) extra.push('idoso');
    const s = nat.bodies.get(g.id), acao = s ? ACOES[(s.b[1 + i * 5 + 4] | 0) >> 3] : '';
    if (acao === 'morto') return `${quem[0].toUpperCase() + quem.slice(1)} morto`;
    return `${quem[0].toUpperCase() + quem.slice(1)} (${extra.join(', ')})${acao ? ' — ' + acao.replace('_', ' ') : ''}`;
  };
  // cavalo na mira: esfera em volta do lombo de cada corpo
  function mira(o, d, max) {
    let best = null, bt = max;
    for (const g of nat.groups.values()) {
      if (g.k !== 'manada') continue;
      const n = nat.bodies.get(g.id)?.b; if (!n) continue;
      for (let i = 0; 1 + i * 5 + 4 < n.length; i++) {
        if (api.montado && api.montado.g === g.id && api.montado.i === i) continue;
        const c = corpoNaRede(g, i), cres = (g.eq?.[i]?.[1] ?? 100) / 100, r = 0.95 * cres;
        const cx = c.x - o[0], cy = c.y + 1.15 * cres - o[1], cz = c.z - o[2];
        const tca = cx * d[0] + cy * d[1] + cz * d[2];
        if (tca < 0) continue;
        const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
        if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (t < bt) { bt = t; best = { g, i, t }; }
      }
    }
    return best;
  }

  game.hooks.interact.unshift((dt, playing, o, d) => {
    api.eu = player.pos;
    if (api.montado) {
      ui.setHint('Montado — W trote · Shift+W passo · Ctrl+W galope · S para · Espaço pula · F desce');
      if (playing && input.wasPressed('interact')) desmontar(true);
      return true;
    }
    const lim = Math.min(ALCANCE, game.treeAim?.t ?? Infinity);
    const h = mira(o, d, lim);
    if (!h) return false;
    const naMao = game.hotbar[game.sel] || 0, comida = eComida(naMao, B);
    ui.setHint(`${descricao(h.g, h.i)} — F ${comida ? 'oferece comida' : 'carinho'} · Shift+F montar`);
    if (!playing) return true;
    if (input.wasPressed('interact')) {
      const op = input.isDown('sneak') ? 'montar' : comida ? 'oferecer' : 'tocar';
      net.send({ t: 'eq', op, g: h.g.id, i: h.i });
      if (op === 'montar') ui.toast('Você tenta montar…', 1800);
    } else if (input.isDown('break') && performance.now() > golpeAte) {
      golpeAte = performance.now() + 450;
      net.send({ t: 'eq', op: 'golpe', g: h.g.id, i: h.i });
    }
    return true;
  });

  function montar(g, i) {
    const c = corpoNaRede(g, i); if (!c) return;
    const b = newBody('manada', g.id * 64 + i, c.x, c.y, c.z);
    b.yaw = c.yaw; b.on = true;
    api.montado = { g: g.id, i, b, cres: (g.eq?.[i]?.[1] ?? 100) / 100 };
    player.flying = false;
    game.camWant = 6;
    ui.toast('O cavalo aceitou você. W trote · Shift+W passo · Ctrl+W galope · S para · A/D desvia · Espaço pula · F desce', 7000);
  }
  function desmontar(avisar, motivo = '') {
    const m = api.montado; if (!m) return;
    api.montado = null; game.camWant = undefined;
    const lado = m.b.yaw + Math.PI / 2;
    player.teleport(m.b.x + Math.sin(lado) * 1.3, m.b.y + 0.3, m.b.z + Math.cos(lado) * 1.3);
    if (motivo === 'derrubado') { player.vel[1] = 5; player.vel[0] = Math.sin(lado) * 4; player.vel[2] = Math.cos(lado) * 4; ui.toast('O cavalo derrubou você!', 3000); }
    if (avisar && !net.offline) net.send({ t: 'eq', op: 'desmontar', g: m.g, i: m.i });
  }

  // física do cavalo montado, no passo fixo do jogo: quem joga vai na sela
  game.hooks.fixed.unshift((dt, intent) => {
    const m = api.montado;
    if (!m) return false;
    const b = m.b, spec = BODY.manada;
    // rumo: para onde a câmera olha, com A/D desviando; marcha pela tecla
    const desvio = -(intent.x || 0) * 0.65;                // D vira para a direita (rumo diminui)
    const rumo = player.yaw + Math.PI + desvio;           // a câmera olha para −sin/−cos do yaw
    let vel = 0, fx = Math.sin(rumo), fz = Math.cos(rumo), longe = 3;
    // (a física limita a velocidade pela distância até o ponto desejado: o ponto vai à frente conforme a marcha)
    if (intent.z > 0.1) vel = intent.sprint ? MARCHA.disparada * 0.92 : intent.sneak ? MARCHA.passo : MARCHA.trote;
    else if (intent.z < -0.1) { vel = 0.8; fx = -fx; fz = -fz; longe = 1.5; }
    if (Math.abs(intent.x) > 0.1 && intent.z === 0) { vel = MARCHA.passo * 0.6; }
    if (vel > 2) longe = vel * 0.7 + 2;
    const W = { x: b.x + fx * longe, y: b.y, z: b.z + fz * longe, speed: vel, fly: false, brave: true, water: true, seed: 1, yaw: vel > 0 ? undefined : rumo };
    if (intent.jump && puloSolto && b.on && !b.wet) { b.vy = PULO; b.on = false; puloSolto = false; }
    if (!intent.jump) puloSolto = true;
    stepBody(world.getBlock, b, spec, W, dt);
    // de ré, o corpo vira para trás: mantém a frente
    if (intent.z < -0.1) b.yaw = rumo + Math.PI;
    player.prev[0] = player.pos[0]; player.prev[1] = player.pos[1]; player.prev[2] = player.pos[2];
    player.pos[0] = b.x; player.pos[1] = b.y + SELA * m.cres; player.pos[2] = b.z;
    player.vel[0] = b.vx; player.vel[1] = b.vy; player.vel[2] = b.vz;
    player.onGround = false;
    const t = performance.now();
    if (t - envio > 100 && !net.offline) { envio = t; net.send({ t: 'eq', op: 'pos', g: m.g, i: m.i, p: [b.x, b.y, b.z], yaw: b.yaw, wet: b.wet }); }
    return true;
  });

  // avisos do servidor
  game.hooks.other.push((msg) => {
    if (msg.t === 'eq' && msg.op === 'corrige' && api.montado && msg.g === api.montado.g) { const b = api.montado.b; b.x = msg.p[0]; b.y = msg.p[1]; b.z = msg.p[2]; b.vx = b.vy = b.vz = 0; return; }
    if (msg.t === 'welcome' || msg.t === 'offline' || msg.t === 'dim') { if (api.montado) { api.montado = null; game.camWant = undefined; } return; }
    if (msg.t !== 'nat' || !Array.isArray(msg.eq)) return;
    const eu = String(game.name || '').toLowerCase();
    for (const e of msg.eq) {
      if (e.op === 'montou' && e.quem === eu) { const g = nat.groups.get(e.g); if (g) montar(g, e.i); }
      else if (e.op === 'recusou' && e.quem === eu) ui.toast({ corcovear: 'Ele corcoveou e não deixou montar.', empinar: 'Ele empinou e não deixou montar.', afastar: 'Ele se esquivou.', coice: 'Ele escoiceou!' }[e.reacao] || 'Ele não deixou montar.', 3000);
      else if (e.op === 'desmontou' && api.montado && api.montado.g === e.g && api.montado.i === e.i) desmontar(false, e.motivo);
      else if (e.op === 'reagiu' && e.evento && (e.evento === 'toque' || e.evento === 'oferta_comida')) {
        const g = nat.groups.get(e.g), b = g && corpoNaRede(g, e.i);
        const txt = { aceitar: 'Ele aceitou o carinho.', comer: 'Ele comeu da sua mão.', cheirar: 'Ele cheira sua mão, desconfiado.', afastar: 'Ele se afastou.', morder: 'Ele tentou morder!', coice: 'Ele escoiceou!' }[e.reacao];
        if (txt && b && Math.hypot(b.x - player.pos[0], b.z - player.pos[2]) < 6) ui.toast(txt, 2200);
      } else if (e.op === 'nasceu') ui.toast(`Nasceu um${e.sexo === 'F' ? 'a potra' : ' potro'} na manada.`, 3500);
    }
  });
  return api;
}
