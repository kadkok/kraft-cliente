// Kraft — elevador de verdade no aparelho (pedido do Kadmus, 23/11/2026). Desenha a cabine de cada elevador no ponto da
// viagem que o servidor mandou ({ t: 'elevadores', l }) e carrega quem está dentro (a cabine é chão que sobe e desce).
// F dentro da cabine: seletor de andares (1–9 ou clique); F olhando a porta azul de um andar: chama a cabine.
// Quem decide a viagem e abre/fecha as portas é o servidor (server/elevador.js). Sem asset: só geometria simples.
import * as THREE from '../three.js';
import { h } from '../ui/ui.js';
import { dentroDoVao, alturaCabine, celulasPorta, nomeAndar, ALT_CAB } from '../../shared/elevador.js';

const CSS = `
.el-tela[hidden] { display: none !important; }
.el-tela { position: fixed; inset: 0; z-index: 66; display: grid; place-items: center; padding: 12px; background: #050b1288; }
.el-caixa { width: min(100%, 20rem); max-height: 100%; overflow: auto; box-sizing: border-box; padding: 1rem; color: #e9f1f7; }
.el-caixa h2 { margin: 0 0 .5rem; font-size: 1.05rem; }
.el-lista { display: grid; gap: .35rem; }
.el-lista button { text-align: left; }
.el-lista button[aria-current="true"] { outline: 2px solid #8fd3ff; }
.el-lista button kbd { display: inline-block; min-width: 1.3em; margin-right: .5em; opacity: .7; font: inherit; }
.el-hud { position: fixed; left: 50%; top: 18%; transform: translateX(-50%); z-index: 20; padding: .3rem .7rem; border-radius: .5rem; background: #0b1622cc; color: #e9f1f7; font: 600 .85rem system-ui, sans-serif; pointer-events: none; }
.el-hud[hidden] { display: none; }
`;

export function initElevador({ game, net, openOverlay, closeOverlay }) {
  document.head.append(h('style', { text: CSS }));
  const lista = h('div', { class: 'el-lista' });
  const titulo = h('h2', { id: 'el-titulo', text: 'Elevador' });
  const caixa = h('section', { class: 'panel el-caixa', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'el-titulo', tabindex: '-1' }, titulo, lista);
  const tela = h('div', { class: 'el-tela' }, caixa); tela.hidden = true;
  const hud = h('div', { class: 'el-hud', role: 'status' }); hud.hidden = true;
  document.body.append(tela, hud);
  const els = new Map();   // id -> { e, t0, grupo, yAnt }
  let montado = null, pedido = 0, embarcado = null, extraPronto = false;
  const mats = {};
  const mat = () => {
    if (mats.piso) return mats;
    mats.piso = new THREE.MeshLambertMaterial({ color: 0x6b7480 });
    mats.teto = new THREE.MeshLambertMaterial({ color: 0x9aa4ad });
    mats.vidro = new THREE.MeshLambertMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
    mats.friso = new THREE.MeshLambertMaterial({ color: 0xd8b25a, emissive: 0x2a1d00 });
    return mats;
  };
  function cabine(e) {
    const g = new THREE.Group(), m = mat(), H = ALT_CAB - 0.08;
    const caixa3 = (sx, sy, sz, x, y, z, mm) => { const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mm); b.position.set(x, y, z); g.add(b); return b; };
    caixa3(e.w - 0.04, 0.14, e.c - 0.04, e.w / 2, -0.07, e.c / 2, m.piso);                 // piso (o topo é o chão dos pés)
    caixa3(e.w - 0.04, 0.1, e.c - 0.04, e.w / 2, H + 0.05, e.c / 2, m.teto);               // teto
    const fx = e.frente[0] === 'x', mais = e.frente[1] === '+';
    for (const lado of ['x-', 'x+', 'z-', 'z+']) {                                          // vidro nos lados, a frente aberta
      if (lado === e.frente) continue;
      const ex = lado[0] === 'x', p = lado[1] === '+';
      if (ex) caixa3(0.04, H, e.c - 0.04, p ? e.w - 0.03 : 0.03, H / 2, e.c / 2, m.vidro);
      else caixa3(e.w - 0.04, H, 0.04, e.w / 2, H / 2, p ? e.c - 0.03 : 0.03, m.vidro);
    }
    const fr = 0.06;   // friso dourado na boca da cabine
    if (fx) { const x = mais ? e.w - fr / 2 : fr / 2; caixa3(fr, fr, e.c, x, 0.01, e.c / 2, m.friso); caixa3(fr, fr, e.c, x, H, e.c / 2, m.friso); }
    else { const z = mais ? e.c - fr / 2 : fr / 2; caixa3(e.w, fr, fr, e.w / 2, 0.01, z, m.friso); caixa3(e.w, fr, fr, e.w / 2, H, z, m.friso); }
    g.position.set(e.x, alturaCabine(e, 0), e.z);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
    return g;
  }
  const cena = () => window.LAVRA?.scene;
  function receber(l) {
    const vivos = new Set();
    for (const e of l) {
      vivos.add(e.id);
      let r = els.get(e.id);
      if (r && (r.e.w !== e.w || r.e.c !== e.c || r.e.x !== e.x || r.e.z !== e.z || r.e.frente !== e.frente)) { cena()?.remove(r.grupo); r = null; }
      if (!r) { r = { e, t0: 0, grupo: cabine(e), yAnt: null }; cena()?.add(r.grupo); els.set(e.id, r); }
      r.e = e;
      r.t0 = performance.now() - (e.mov ? e.mov.dur - e.mov.falta : 0);
      if (!r.grupo.parent) cena()?.add(r.grupo);
    }
    for (const [id, r] of els) if (!vivos.has(id)) { cena()?.remove(r.grupo); els.delete(id); }
    if (!tela.hidden && montado && els.has(montado)) montar(montado);
  }
  const yCab = (r) => alturaCabine(r.e, performance.now() - r.t0);
  const pedir = () => { if (!net.offline) net.send({ t: 'gmop', op: 'elevador', a: 'lista' }); };
  game.hooks.other.push((m) => {
    if (m.t === 'elevadores' && Array.isArray(m.l)) receber(m.l);
    else if (m.t === 'welcome') { for (const r of els.values()) cena()?.remove(r.grupo); els.clear(); clearTimeout(pedido); pedido = setTimeout(pedir, 1700); }
    if (m.t === 'overlay-closed' && m.was === 'elevador') tela.hidden = true;
  });

  // quem está dentro do vão, com os pés perto do piso da cabine
  function dentro(p) {
    if ((game.dim || 0) !== 0) return null;
    for (const r of els.values()) {
      if (!dentroDoVao(r.e, p.pos[0], p.pos[2])) continue;
      const y = yCab(r);
      if (p.pos[1] > y - 1.3 && p.pos[1] < y + 1.0) return r;
    }
    return null;
  }
  // começo do quadro: quem estava na cabine sobe/desce junto (antes da física e da câmera, como a balsa)
  game.hooks.pre.push(() => {
    const player = window.LAVRA?.player;
    if (!player) return;
    if (!extraPronto) {   // pendura o colisor depois de todos os outros (encadeado: não tira o de ninguém)
      extraPronto = true;
      const anterior = player.extra;
      player.extra = (p) => {
        if (anterior) anterior(p);
        if (p.noclip) { embarcado = null; return; }
        const r = dentro(p);
        if (!r) { embarcado = null; return; }
        const y = yCab(r);
        if (p.pos[1] <= y + 0.02 && p.vel[1] <= 0.5) { p.pos[1] = y; if (p.vel[1] < 0) p.vel[1] = 0; p.onGround = true; embarcado = r.e.id; }
        else if (p.pos[1] > y + 0.3) embarcado = null;
      };
    }
    for (const r of els.values()) {
      const y = yCab(r);
      // quem estava em pé no piso da cabine no quadro anterior acompanha o deslocamento inteiro dela (mesmo num quadro
      // longo, em que a cabine anda vários metros de uma vez)
      const emPe = r.yAnt !== null && dentroDoVao(r.e, player.pos[0], player.pos[2]) && Math.abs(player.pos[1] - r.yAnt) < 0.45;
      if ((emPe || embarcado === r.e.id) && r.yAnt !== null && !player.noclip && (game.dim || 0) === 0) {
        const dy = y - r.yAnt; player.pos[1] += dy; player.prev[1] += dy;
        if (dy > 0 && player.vel[1] < 0) player.vel[1] = 0;
      }
      r.yAnt = y;
    }
  });
  game.hooks.frame.push(() => {
    for (const r of els.values()) { r.grupo.position.y = yCab(r); if (!r.grupo.parent) cena()?.add(r.grupo); }
    const p = window.LAVRA?.player;
    const r = p ? dentro(p) : null;
    if (r) {
      const e = r.e;
      hud.textContent = e.mov ? `🛗 ${nomeAndar(e.mov.de)} → ${nomeAndar(e.mov.para)}` : `🛗 ${nomeAndar(e.andar)} · F escolhe o andar`;
      hud.hidden = false;
    } else hud.hidden = true;
    if (!tela.hidden && game.overlay !== 'elevador') tela.hidden = true;
  });

  function escolher(id, k) {
    if (!net.offline) net.send({ t: 'gmop', op: 'elevador', id, andar: k });
    if (game.overlay === 'elevador') closeOverlay();
    tela.hidden = true;
  }
  function montar(id) {
    const r = els.get(id); if (!r) return;
    const e = r.e, atual = e.mov ? e.mov.para : e.andar;
    titulo.textContent = `Elevador nº ${e.id}`;
    lista.replaceChildren(...e.andares.map((_, k) => h('button', { class: 'btn', type: 'button', 'aria-current': String(k === atual), onclick: () => escolher(id, k) },
      h('kbd', { text: String(k + 1) }), nomeAndar(k))), h('button', { class: 'btn small', type: 'button', text: 'Fechar (Esc)', onclick: () => { closeOverlay(); tela.hidden = true; } }));
  }
  function abrirSeletor(id) {
    if (game.overlay && game.overlay !== 'elevador') return;
    montado = id; montar(id);
    openOverlay('elevador'); tela.hidden = false; caixa.focus({ preventScroll: true });
  }
  caixa.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeOverlay(); tela.hidden = true; return; }
    const n = Number(ev.key), r = els.get(montado);
    if (r && Number.isInteger(n) && n >= 1 && n <= r.e.andares.length) { ev.preventDefault(); ev.stopPropagation(); escolher(montado, n - 1); return; }
    if (ev.key !== 'Tab' && ev.key !== 'Enter' && ev.key !== ' ') ev.stopPropagation();
  });
  // F: dentro da cabine abre o seletor; olhando a porta azul de um andar chama a cabine para lá
  game.hooks.interact.unshift((dt, playing) => {
    if (!playing || !els.size) return false;
    const L = window.LAVRA, input = L?.input;
    if (!input || !input.wasPressed('interact')) return false;
    const r = dentro(L.player);
    if (r) { abrirSeletor(r.e.id); return true; }
    const hit = L.interaction?.target;
    if (!hit) return false;
    for (const q of els.values()) {
      for (let k = 0; k < q.e.andares.length; k++) {
        if (celulasPorta(q.e, k).some((c) => c[0] === hit.x && c[1] === hit.y && c[2] === hit.z)) { escolher(q.e.id, k); return true; }
      }
    }
    return false;
  });
  game.elevador = { lista: () => [...els.values()].map((r) => ({ ...r.e, y: yCab(r) })), dentro: () => { const p = window.LAVRA?.player; const r = p && dentro(p); return r ? r.e.id : null; }, embarcado: () => embarcado, abrir: abrirSeletor, escolher };
}
