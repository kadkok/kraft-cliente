// Perfurador na mão de quem joga. /perfurar entra; W fura na direção do olhar.
import * as THREE from '../three.js';
import { BLOCKS } from '../../shared/blocks.js';

const V = 5.5;
const FORMAS = ['quadrado', 'redondo'];
const NOME = { quadrado: 'QUADRADO', redondo: 'REDONDO' };

function modelo() {
  const g = new THREE.Group();
  const corpo = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.4, 2.6),
    new THREE.MeshStandardMaterial({ color: '#f2b318', roughness: 0.45, metalness: 0.35 }),
  );
  corpo.position.set(0, 0.2, 1.1);
  const broca = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.08, 1.4, 8),
    new THREE.MeshStandardMaterial({ color: '#d7dde4', roughness: 0.3, metalness: 0.7 }),
  );
  broca.rotation.x = Math.PI / 2;
  broca.position.set(0, 0.2, 2.6);
  g.add(corpo, broca);
  g.userData = { broca };
  return g;
}

export function initPerfurador({ game, player, net, ui, scene, input }) {
  let dentro = false, obj = null, ajuda = false;
  let forma = 'quadrado', raio = 2, teto = 'fechado', pos = null, giro = 0, curso = null;
  const eixoDe = () => {
    const cp = Math.cos(player.pitch);
    const x = -Math.sin(player.yaw) * cp, y = Math.sin(player.pitch), z = -Math.cos(player.yaw) * cp;
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ay >= ax && ay >= az) return { eixo: 1, sinal: y >= 0 ? 1 : -1 };
    if (ax >= az) return { eixo: 0, sinal: x >= 0 ? 1 : -1 };
    return { eixo: 2, sinal: z >= 0 ? 1 : -1 };
  };
  const painel = () => {
    let h = document.querySelector('.perfurador-hud');
    if (h) return h;
    h = document.createElement('div');
    h.className = 'perfurador-hud';
    h.style.cssText = 'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:linear-gradient(180deg,#2a2416,#14120c);color:#ffe7a3;font:600 14px/1.35 system-ui,sans-serif;padding:8px 14px;border-radius:10px;border:1px solid #e2b657;pointer-events:none;z-index:30;text-align:center;white-space:normal;max-width:min(920px,92vw)';
    document.body.appendChild(h);
    return h;
  };
  const blocoMao = () => game.hotbar?.[game.sel] | 0;
  const mostra = () => {
    const h = painel();
    h.style.display = dentro ? 'block' : 'none';
    if (!dentro) return;
    const nome = BLOCKS[blocoMao()]?.name || 'escolha um bloco';
    const topo = teto === 'ceu' ? 'vala até o céu' : 'teto fechado';
    h.innerHTML = `🕳️ <b>${NOME[forma]}</b> · raio ${raio} · ${topo} · revestimento ${nome}<br><span style="color:#f3ead2;font-weight:400;font-size:12px">W fura · S recua · mouse aponta · N forma · + − raio · H teto · o bloco na mão reveste · F sai</span>`;
  };
  function entrar() {
    dentro = true;
    player.flying = true;
    const o = eixoDe();
    pos = [Math.floor(player.pos[0]), Math.floor(player.pos[1] + 1), Math.floor(player.pos[2])];
    pos[o.eixo] += o.sinal;
    if (!obj) { obj = modelo(); scene.add(obj); }
    if (!ajuda) { ajuda = true; ui.toast?.('🕳️ Perfurador: aponte e segure W. N troca a forma, H abre a vala até o céu. O bloco na mão reveste.'); }
    mostra();
  }
  function sair() {
    if (!dentro) return;
    dentro = false;
    curso = null;
    player.flying = false;
    mostra();
  }
  addEventListener('keydown', (e) => {
    if (!dentro) return;
    const alvo = e.target;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyN' && !e.repeat) { forma = FORMAS[(FORMAS.indexOf(forma) + 1) % FORMAS.length]; mostra(); }
    if (e.code === 'KeyH' && !e.repeat) { teto = teto === 'ceu' ? 'fechado' : 'ceu'; mostra(); e.preventDefault(); }
    const mais = e.key === '+' || e.code === 'NumpadAdd';
    const menos = e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract';
    if (mais) { raio = Math.min(10, raio + 1); mostra(); e.preventDefault(); }
    if (menos) { raio = Math.max(1, raio - 1); mostra(); e.preventDefault(); }
  });
  game.hooks.other.push((m) => { if (m.t === 'perfurar' && m.a === 'chamar') entrar(); });
  let envio = null;
  game.hooks.fixed.push((dt, intent) => {
    if (!dentro) return false;
    if (game.state !== 'PLAYING' || game.dim || game.overlay) { if (game.dim) sair(); return true; }
    if (input.wasPressed('interact')) { curso = null; sair(); return false; }
    const andando = (intent.z || 0) !== 0;
    if (!andando) curso = null;
    else if (!curso) curso = eixoDe();
    const o = curso || eixoDe();
    const passo = (intent.z || 0) * V * dt;
    pos[o.eixo] += o.sinal * passo;
    const aqui = pos.map(Math.floor);
    player.prev.splice(0, 3, ...player.pos);
    player.pos.splice(0, 3, aqui[0] + 0.5, aqui[1] - 0.2, aqui[2] + 0.5);
    player.vel.fill(0); player.onGround = false; player.inWater = player.headInWater = false;
    const marca = aqui.join(',') + ':' + o.eixo + ':' + o.sinal + ':' + forma + ':' + raio + ':' + blocoMao() + ':' + teto;
    if (intent.z > 0 && marca !== envio && net.online) {
      envio = marca;
      net.send({ t: 'gmop', op: 'perfurar', x: aqui[0], y: aqui[1], z: aqui[2], eixo: o.eixo, sinal: o.sinal, forma, raio, bloco: blocoMao(), teto });
    }
    return true;
  });
  let hudT = 0;
  game.hooks.frame.push((dt) => {
    if (!obj || !pos) return;
    if (game.state === 'MENU' && dentro) { curso = null; sair(); }
    const o = curso || eixoDe();
    obj.visible = dentro && !game.dim;
    obj.position.set(pos[0], pos[1], pos[2]);
    obj.rotation.set(0, 0, 0);
    if (o.eixo === 0) obj.rotation.y = o.sinal > 0 ? Math.PI / 2 : -Math.PI / 2;
    else if (o.eixo === 1) obj.rotation.x = o.sinal > 0 ? -Math.PI / 2 : Math.PI / 2;
    else if (o.sinal < 0) obj.rotation.y = Math.PI;
    giro += dt * (dentro ? 18 : 0);
    obj.userData.broca.rotation.y = giro;
    if (dentro && (hudT -= dt) <= 0) { hudT = 0.25; mostra(); }
  });
  return { entrar, sair, get dentro() { return dentro; } };
}
