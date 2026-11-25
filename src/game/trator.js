// LAVRA — o trator de terraplenagem no aparelho (pedido do Kadmus, 24/11/2026; o servidor é server/trator.js).
// /trator chama o trator na sua frente e você já entra nele. Dirigindo:
//   W/S anda e dá ré · A/D vira · Espaço sobe a lâmina · Shift desce a lâmina · N troca o modo · + − largura
//   H céu ou túnel · [ ] altura do túnel · . montanha ou rampa · , corte de 1 vira rampa · ` árvores · ; corpo
//   F (ou /trator de novo) sai do trator. O bloco na mão é a superfície; o corpo fica por baixo.
// Modos da lâmina: NIVELAR (corta o que passa e aterra o que falta, até o nível da lâmina), CORTAR (só corta),
// ATERRAR (só levanta vales e buracos), LEVANTADA (só anda; com árvores, ainda planta). Corte até o céu não deixa teto.
// Corte baixo deixa o material acima. Sem rampa, a pá alta levanta uma montanha. Com rampa, sobe um bloco por passada.
// Quem decide o que muda é o servidor (só criativo ou GM, só terreno natural): o aparelho só manda os golpes.
import * as THREE from '../three.js';
import { B, BLOCKS, SOLID, LEVEL } from '../../shared/blocks.js';
import { revestimentoValido } from '../../shared/perfurador.js';

const MODOS = ['nivelar', 'cortar', 'aterrar', 'levantada'];
const NOME = { nivelar: 'NIVELAR', cortar: 'CORTAR', aterrar: 'ATERRAR', levantada: 'LÂMINA LEVANTADA' };
const CORPOS = [B.DIRT, B.STONE, B.SAND, B.GRAVEL, B.CLAY, B.GRASS, B.DEEP_STONE];
const VMAX = 6.5, VRE = 3, ACEL = 5, GIRO = 1.25, DEGRAU = 1.25, CAM = 9;

function modelo() {
  const g = new THREE.Group();
  const m = (c, r = 0.6, mt = 0.15) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: mt });
  const amarelo = m('#f2b318'), escuro = m('#2b2b2b', 0.8), aco = m('#8d939b', 0.4, 0.6), vidro = new THREE.MeshStandardMaterial({ color: '#9fc3d8', roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.22, depthWrite: false }), preto = m('#151515', 0.9);
  const cx = (w, h, d, mat, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); g.add(o); return o; };
  // esteiras
  for (const s of [-1, 1]) {
    cx(0.9, 1.0, 5.0, preto, s * 1.45, 0.5, 0);
    for (let k = -2; k <= 2; k++) cx(0.92, 0.12, 0.25, escuro, s * 1.45, 1.02, k * 1.0);
    cx(0.95, 0.6, 0.6, escuro, s * 1.45, 0.5, 2.3); cx(0.95, 0.6, 0.6, escuro, s * 1.45, 0.5, -2.3);
  }
  // corpo, motor e cabine
  cx(2.2, 1.0, 4.4, amarelo, 0, 1.4, -0.1);
  cx(1.9, 0.9, 1.9, amarelo, 0, 2.3, 0.95);                   // capô (frente)
  cx(0.25, 1.2, 0.25, escuro, 0.55, 3.2, 1.5);                 // escapamento
  cx(2.0, 0.15, 2.1, amarelo, 0, 3.95, -1.0);                  // teto da cabine
  for (const [x, z] of [[-0.95, -0.05], [0.95, -0.05], [-0.95, -1.95], [0.95, -1.95]]) cx(0.12, 1.9, 0.12, escuro, x, 2.95, z);
  cx(1.8, 1.4, 0.05, vidro, 0, 2.9, -0.05); cx(0.05, 1.4, 1.8, vidro, -0.95, 2.9, -1.0); cx(0.05, 1.4, 1.8, vidro, 0.95, 2.9, -1.0);
  cx(1.0, 0.7, 0.8, escuro, 0, 2.25, -1.2);                    // banco
  const giro = cx(0.3, 0.25, 0.3, new THREE.MeshBasicMaterial({ color: '#ff9a10' }), 0.7, 4.15, -1.6);   // giroflex
  // ripper atrás
  cx(1.6, 0.25, 0.4, aco, 0, 1.0, -2.6); for (const x of [-0.5, 0.5]) cx(0.18, 1.0, 0.18, aco, x, 0.5, -2.8);
  // braços e lâmina (a lâmina sobe e desce)
  const lam = new THREE.Group(); lam.position.set(0, 0, 3.4); g.add(lam);
  const placa = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.5, 0.3), amarelo); placa.position.set(0, 0.75, 0.2); lam.add(placa);
  const corte = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 0.4), aco); corte.position.set(0, 0.09, 0.3); lam.add(corte);
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 2.4), amarelo); b.position.set(s * 1.4, 0.7, -1.1); b.rotation.x = 0.15; lam.add(b); }
  const pist = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 6), aco); pist.position.set(0, 1.5, -1.0); pist.rotation.x = 1.0; lam.add(pist);
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = false; });
  g.userData = { lam, giro };
  return g;
}

export function initTrator({ game, player, world, net, ui, scene, input }) {
  let t = null;                 // { x, y, z, h, v, nivel, modo, largura, corte, alt, rampa, degrau, arvores, corpo }
  let obj = null, dentro = false, camAnt, golpe = 0, hud = null, ajudaVista = false;
  const teclas = new Set();

  function chaoEm(x, z, de) {
    const ix = Math.floor(x), iz = Math.floor(z);
    if (!world.isLoaded(ix, iz)) return null;
    for (let y = Math.floor(de) + 3; y > de - 40; y--) { const id = world.getBlock(ix, y, iz); if (SOLID[id] && !LEVEL[id]) return y + 1; }
    return null;
  }
  // altura das esteiras: o mais alto dos quatro cantos (o trator não afunda no buraco que está cavando)
  function apoio(x, z, h, ref) {
    const fx = Math.sin(h), fz = Math.cos(h), lx = Math.cos(h), lz = -Math.sin(h);
    let m = -1e9;
    for (const [a, b] of [[-1.3, -2.0], [1.3, -2.0], [-1.3, 2.0], [1.3, 2.0], [0, 0]]) { const y = chaoEm(x + lx * a + fx * b, z + lz * a + fz * b, ref); if (y !== null && y > m) m = y; }
    return m > -1e9 ? m : null;
  }
  function painel() {
    if (hud) return hud;
    hud = document.createElement('div');
    hud.className = 'trator-hud';
    hud.style.cssText = 'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:linear-gradient(180deg,#2a2416,#14120c);color:#ffe7a3;font:600 14px/1.35 system-ui,sans-serif;padding:8px 14px;border-radius:10px;border:1px solid #e2b657;pointer-events:none;z-index:30;text-align:center;white-space:normal;max-width:min(920px,92vw)';
    document.body.appendChild(hud);
    return hud;
  }
  function superficie() {
    const id = game.hotbar?.[game.sel] | 0;
    return revestimentoValido(id) ? id : 0;
  }
  function mostra() {
    const h = painel(); h.style.display = dentro ? 'block' : 'none';
    if (!dentro || !t) return;
    const dif = t.nivel - Math.round(t.y);
    const corte = t.corte === 'tunel' ? `túnel altura ${t.alt}` : 'corte até o céu';
    const supId = superficie();
    const supNome = supId ? (BLOCKS[supId]?.name || 'bloco') : 'gramado ou areia';
    const corpoNome = BLOCKS[t.corpo]?.name || 'Terra';
    const aterro = t.rampa ? 'rampa (+1 por passada)' : 'montanha';
    h.innerHTML = `🚜 <b>${NOME[t.modo]}</b> · lâmina no nível ${t.nivel}${dif ? ' (' + (dif > 0 ? '+' : '') + dif + ')' : ''} · largura ${t.largura} m · ${Math.abs(t.v).toFixed(1)} m/s` +
      `<br>${corte} · superfície ${supNome} · corpo ${corpoNome} · ${aterro} · cortes de 1 ${t.degrau ? 'viram rampa' : 'ficam cubo'} · árvores ${t.arvores ? 'sim' : 'não'}` +
      `<br><span style="color:#f3ead2;font-weight:400;font-size:12px">W/S anda · A/D vira · Espaço/Shift lâmina · N modo · + − largura · H céu/túnel · [ ] altura · . montanha/rampa · , rampa de 1 · ' árvores · ; corpo · F sai</span>`;
  }
  function chamar() {
    if (game.state !== 'PLAYING' || game.dim) return ui.toast?.('O trator só trabalha na superfície.');
    if (dentro) return sair();
    if (game.garagem?.atual || game.machines?.seat || game.ferrovia?.bordo || game.cavalos?.montado) return ui.toast?.('Desça do veículo antes de chamar o trator.');
    const h = player.yaw + Math.PI, x = player.pos[0] + Math.sin(h) * 5, z = player.pos[2] + Math.cos(h) * 5;
    const y = apoio(x, z, h, player.pos[1]) ?? Math.floor(player.pos[1]);
    if (!t) t = { x, y, z, h, v: 0, nivel: y, modo: 'nivelar', largura: 5, corte: 'ceu', alt: 3, rampa: false, degrau: false, arvores: false, corpo: B.DIRT };
    else Object.assign(t, { x, y, z, h, v: 0, nivel: y });
    if (!obj) { obj = modelo(); scene.add(obj); }
    entrar();
  }
  function entrar() {
    dentro = true; camAnt = game.camWant; game.camWant = CAM;
    player.flying = false; player.yaw = t.h + Math.PI; player.pitch = -0.32;
    t.nivel = Math.round(t.y);
    if (!ajudaVista) { ajudaVista = true; ui.toast?.('🚜 Trator: Shift cava, Espaço aterra. H escolhe céu ou túnel. O ponto troca montanha e rampa.'); }
    mostra();
  }
  function sair() {
    if (!dentro) return;
    dentro = false; game.camWant = camAnt; teclas.clear();
    const lado = 3, x = t.x + Math.cos(t.h) * lado, z = t.z - Math.sin(t.h) * lado;
    player.teleport(x, (chaoEm(x, z, t.y + 4) ?? t.y) + 0.05, z);
    mostra();
  }
  addEventListener('keydown', (e) => {
    if (!dentro) return;
    const alvo = e.target; if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
    const colchete = e.key === '[' || e.key === ']' || e.code === 'BracketLeft' || e.code === 'BracketRight';
    if ((e.ctrlKey || e.metaKey || e.altKey) && !colchete) return;
    if (e.code === 'KeyN' && !e.repeat) { t.modo = MODOS[(MODOS.indexOf(t.modo) + 1) % MODOS.length]; mostra(); }
    if (e.code === 'KeyH' && !e.repeat) { t.corte = t.corte === 'tunel' ? 'ceu' : 'tunel'; mostra(); e.preventDefault(); }
    const mais = e.key === '+' || e.code === 'NumpadAdd';
    const menos = e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract';
    if (mais) { t.largura = Math.min(10, t.largura + 1); mostra(); e.preventDefault(); }
    if (menos) { t.largura = Math.max(1, t.largura - 1); mostra(); e.preventDefault(); }
    if (t.corte === 'tunel' && (e.code === 'BracketLeft' || e.key === '[')) { t.alt = Math.max(1, t.alt - 1); mostra(); e.preventDefault(); }
    if (t.corte === 'tunel' && (e.code === 'BracketRight' || e.key === ']')) { t.alt = Math.min(8, t.alt + 1); mostra(); e.preventDefault(); }
    if (!e.repeat && (e.key === '.' || e.code === 'Period')) { t.rampa = !t.rampa; mostra(); e.preventDefault(); }
    if (!e.repeat && (e.key === ',' || e.code === 'Comma')) { t.degrau = !t.degrau; mostra(); e.preventDefault(); }
    if (!e.repeat && (e.key === '`' || e.code === 'Backquote' || (e.code === 'Quote' && !e.shiftKey))) { t.arvores = !t.arvores; mostra(); e.preventDefault(); }
    if (!e.repeat && (e.key === ';' || e.code === 'Semicolon')) {
      t.corpo = CORPOS[(CORPOS.indexOf(t.corpo) + 1) % CORPOS.length];
      mostra(); e.preventDefault();
    }
  });

  game.hooks.other.push((m) => {
    if (m.t === 'trator') {
      if (m.a === 'chamar') chamar();
      else if (m.a === 'progresso' && m.p < 100) ui.toast?.(`🚜 Obra do trator: ${m.p}%`);
    }
    if (m.t === 'leave' || m.t === 'offline') { /* nada */ }
  });

  let sobeT = 0, desceT = 0;
  game.hooks.fixed.push((dt, intent) => {
    if (!dentro || !t) return false;
    if (game.state !== 'PLAYING' || game.dim) { if (game.dim) sair(); return true; }
    if (game.overlay) return true;
    if (input.wasPressed('interact')) { sair(); return false; }
    // lâmina: segurar sobe/desce 1 bloco a cada 0,35 s
    if (intent.jump) { if ((sobeT -= dt) <= 0) { t.nivel = Math.min(Math.round(t.y) + 12, t.nivel + 1); sobeT = 0.35; mostra(); } } else sobeT = 0;
    if (intent.sneak) { if ((desceT -= dt) <= 0) { t.nivel = Math.max(Math.round(t.y) - 6, t.nivel - 1); desceT = 0.35; mostra(); } } else desceT = 0;
    // andar e virar (esteira: vira parado também)
    const quer = (intent.z || 0) * (intent.z > 0 ? VMAX : VRE);
    t.v += Math.max(-ACEL * dt, Math.min(ACEL * dt, quer - t.v));
    if (!intent.z && Math.abs(t.v) < 0.15) t.v = 0;
    const virar = -(intent.x || 0) * GIRO * dt;
    t.h += virar; player.yaw += virar;
    const nx = t.x + Math.sin(t.h) * t.v * dt, nz = t.z + Math.cos(t.h) * t.v * dt;
    const ny = apoio(nx, nz, t.h, t.y);
    if (ny !== null && ny - t.y <= DEGRAU) { t.x = nx; t.z = nz; t.y += (ny - t.y) * Math.min(1, dt * 8); if (Math.abs(ny - t.y) < 0.02) t.y = ny; }
    else if (ny === null || ny - t.y > DEGRAU) t.v = 0;      // paredão: a lâmina vai cortando até passar
    // se o chão sumiu por baixo (cavou), assenta
    const aqui = apoio(t.x, t.z, t.h, t.y + 1);
    if (aqui !== null && aqui < t.y - 0.02) t.y = Math.max(aqui, t.y - 6 * dt);
    // golpes da lâmina: com ela abaixada, a cada 0,1 s enquanto anda (e a cada 0,4 s parada, empurrando)
    golpe -= dt;
    const trabalha = t.modo !== 'levantada' || t.arvores;
    if (trabalha && golpe <= 0 && net.online && (Math.abs(t.v) > 0.3 || intent.z)) {
      golpe = 0.1;
      const fx = Math.sin(t.h), fz = Math.cos(t.h), d = t.v >= 0 ? 3.6 : -3.4;
      net.send({
        t: 'gmop', op: 'trator', a: 'lamina',
        x: t.x + fx * d, z: t.z + fz * d, h: t.v >= 0 ? t.h : t.h + Math.PI,
        y: t.nivel, l: t.largura, m: t.modo,
        corte: t.corte, alt: t.alt, rampa: t.rampa ? 1 : 0, degrau: t.degrau ? 1 : 0,
        arvores: t.arvores ? 1 : 0, sup: superficie(), corpo: t.corpo,
      });
    }
    // o jogador vai sentado na cabine
    const bx = t.x - Math.sin(t.h) * 1.0, bz = t.z - Math.cos(t.h) * 1.0;
    player.prev.splice(0, 3, ...player.pos);
    player.pos.splice(0, 3, bx, t.y + 1.7, bz);
    player.vel.fill(0); player.onGround = true; player.inWater = player.headInWater = false;
    return true;
  });
  let tHud = 0, tGiro = 0;
  game.hooks.frame.push((dt) => {
    if (!obj || !t) return;
    if (game.state === 'MENU' && dentro) sair();
    obj.visible = !game.dim && Math.hypot(t.x - player.pos[0], t.z - player.pos[2]) < 220;
    obj.position.set(t.x, t.y, t.z); obj.rotation.y = t.h;
    // lâmina: posição de acordo com o nível (do −1,2 ao +1,5 em relação ao chão das esteiras)
    const alvoL = t.modo === 'levantada' ? 1.1 : Math.max(-1.2, Math.min(1.5, t.nivel - t.y));
    const L = obj.userData.lam; L.position.y += (alvoL - L.position.y) * Math.min(1, dt * 6);
    L.scale.x = 0.45 + (t.largura - 1) / 9 * 1.3;
    tGiro += dt; obj.userData.giro.material.color.set((Math.floor(tGiro * 3) & 1) && dentro ? '#ff9a10' : '#5a3000');
    if (dentro) { if ((tHud -= dt) <= 0) { tHud = 0.25; mostra(); } game.audio?.setEmitter?.('trator-motor', { key: 'ambiente.motor', pos: [t.x, t.y + 1, t.z], volume: 0.22, pitch: 0.6 + Math.abs(t.v) * 0.05, refDist: 3, maxDist: 40 }); }
    else game.audio?.removeEmitter?.('trator-motor');
  });
  return { chamar, sair, get dentro() { return dentro; } };
}
