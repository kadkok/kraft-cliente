// LAVRA — pele da manada de cavalos (tipo 'manada'), pedido direto do Kadmus em 17/11/2026.
// Cada cavalo é um CorpoCavalo (render/cavalo-animacao.js): modelo realista com esqueleto, clipe escolhido pela ação
// que o servidor decidiu (bits altos de `nb`, nomes em shared/equino.js → ACOES) e pela velocidade real do corpo,
// gestos nos ossos, tamanho pelo crescimento, pelagem e sela pelos atributos do grupo (`g.eq[i]`).
// O cavalo que eu monto é desenhado pela posição local (game.cavalos.montado), sem o atraso da rede.
// Contrato da pele (nature/nature.js): begin(), put(x, y, z, rumo, batida, presenca, grupo, i), end(), dispose().
import * as THREE from '../three.js';
import { ACOES } from '../../shared/equino.js';
import { carregarCavalo, CorpoCavalo } from './cavalo-animacao.js';

const LONGE = 70;              // além disto (m), a animação roda a cada 3 quadros
const ESTERCO = 160;           // bolinhas de esterco no mundo, no máximo

export function createHorseSkin(scene, { nature, game, shadow = true } = {}) {
  let prep = null, dead = false, falhou = false;
  carregarCavalo().then((p) => { if (!dead) prep = p; if (!shadow) p.base.traverse((o) => { if (o.isMesh) o.castShadow = false; }); })
    .catch((e) => { falhou = true; console.warn('[cavalo]', e); });
  const corpos = new Map();
  let agora = performance.now() / 1000, dt = 0, quadro = 0;
  // esterco: bolinhas que caem do cavalo, ficam um tempo no chão e somem
  const bola = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.055, 1), new THREE.MeshStandardMaterial({ color: 0x3b2c1c, roughness: 0.95 }), ESTERCO);
  bola.count = 0; bola.frustumCulled = false; bola.castShadow = false; bola.receiveShadow = true; scene.add(bola);
  const bolas = [];                                   // { x, y, z, vy, chao, fim }
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _q = new THREE.Quaternion();
  const caem = (corpo, base) => {
    const cauda = corpo.ossos.get('BN_Tail_00_061_067');
    if (!cauda) return;
    cauda.getWorldPosition(_p);
    for (let k = 0; k < 3; k++) {
      if (bolas.length >= ESTERCO) bolas.shift();
      bolas.push({ x: _p.x + (Math.random() - 0.5) * 0.12, y: _p.y - 0.15, z: _p.z + (Math.random() - 0.5) * 0.12, vy: 0, chao: base + 0.04 + Math.random() * 0.05, fim: agora + 180 + Math.random() * 60, r: Math.random() * 6 });
    }
  };

  return {
    stats: { kind: 'manada', modelo: 'cavalo-real.glb' },
    begin() {
      const t = performance.now() / 1000;
      dt = Math.min(0.1, Math.max(0, t - agora)); agora = t; quadro++;
    },
    put(x, y, z, rumo, batida, presenca, g, i) {
      if (!prep || falhou) return;
      const key = g.id * 64 + i;
      let e = corpos.get(key);
      if (!e) { e = { corpo: new CorpoCavalo(prep, (g.s ^ (i * 2654435761)) >>> 0), visto: agora, acc: 0, acao: '' }; scene.add(e.corpo.raiz); corpos.set(key, e); }
      const s = nature.bodies.get(g.id), flags = s ? s.b[1 + i * 5 + 4] | 0 : 0;
      let acao = ACOES[flags >> 3] || 'parado', molhado = !!(flags & 2);
      const attrs = Array.isArray(g.eq?.[i]) ? g.eq[i] : null;
      const olhar = attrs && Array.isArray(attrs[6]) ? attrs[6] : null;
      const m = game?.cavalos?.montado;
      if (m && m.g === g.id && m.i === i) { x = m.b.x; y = m.b.y; z = m.b.z; rumo = m.b.yaw; molhado = !!m.b.wet; acao = 'montado'; }
      // longe da câmera, a animação anda em passos maiores
      e.acc += dt;
      const cam = game?.cavalos?.eu;
      const longe = cam && (x - cam[0]) ** 2 + (z - cam[2]) ** 2 > LONGE * LONGE;
      if (!longe || quadro % 3 === (key % 3) || e.acc > 0.2) {
        e.corpo.atualizar(e.acc, acao, [x, y, z], rumo, attrs, molhado, olhar);
        e.acc = 0;
      } else { e.corpo.raiz.position.set(x, y - (e.corpo.afunda || 0), z); e.corpo.raiz.rotation.y = rumo; }   // posição em todo quadro (17/11); só o esqueleto espaçado
      if (presenca < 1) e.corpo.raiz.scale.multiplyScalar(Math.max(0.01, presenca));
      if (acao === 'defecar' && e.acao !== 'defecar') { e.esterco = agora + 1.5; e.base = y; }
      if (e.esterco && agora > e.esterco && acao === 'defecar') { caem(e.corpo, e.base); e.esterco = agora + 1.2 + Math.random(); }
      if (acao !== 'defecar') e.esterco = 0;
      e.acao = acao;
      e.corpo.raiz.visible = true; e.visto = agora;
    },
    end() {
      for (const [k, e] of corpos) {
        if (agora - e.visto > 0.3) e.corpo.raiz.visible = false;
        if (agora - e.visto > 15) { e.corpo.descartar(); corpos.delete(k); }
      }
      // esterco caindo e assentado
      let n = 0;
      for (let k = bolas.length - 1; k >= 0; k--) if (agora > bolas[k].fim) bolas.splice(k, 1);
      for (const b of bolas) {
        if (b.y > b.chao) { b.vy -= 24 * dt; b.y = Math.max(b.chao, b.y + b.vy * dt); }
        _p.set(b.x, b.y, b.z); _q.setFromAxisAngle(_s.set(0, 1, 0), b.r);
        const k = Math.min(1, (b.fim - agora) / 20);         // some aos poucos no fim
        _s.set(1, 0.8, 1).multiplyScalar(Math.max(0.2, k));
        bola.setMatrixAt(n++, _m.compose(_p, _q, _s));
      }
      bola.count = n; bola.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      dead = true;
      for (const e of corpos.values()) e.corpo.descartar();
      corpos.clear();
      scene.remove(bola); bola.geometry.dispose(); bola.material.dispose();
    },
  };
}
