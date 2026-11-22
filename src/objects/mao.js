// Kraft — a mão: pegar, levar, girar e soltar peças livres; pôr peça no ar; o ímã; conjuntos; pré-formas.
// Pedido do Kadmus (20/11/2026): "quero maior e mais fácil mobilidade com objetos… modelar no ar blocos de tronco de
// árvore, montar uma estrutura e posicionar a estrutura inteira no lugar desejado, salvar pré-formas… deitar ela na
// horizontal… engrossar ou afinar o tronco… ativar ou desativar o 'ímã'".
// As contas (ímã, apoio, relativo/absoluto, pré-forma) são de public/shared/pecas.js; o dono dos conjuntos e das
// pré-formas é o servidor (server/pecas.js). Aqui fica o que quem joga faz com a mira e as teclas.
//
// Como se usa (teclado e mouse; no toque valem os botões do canto e os da forma):
//   Q (ou botão do meio)   mirando uma peça: pega — a peça e o conjunto inteiro dela. Shift+Q pega só ela (sai do conjunto)
//   botão direito          solta onde está · Q ou B cancela (volta para onde estava)
//   roda                   afasta e aproxima: a peça fica "no ar", na distância da mão, e se apoia no que a mira tocar antes
//   T/G gira 15° · Y/H inclina 15° · X tomba 90° · R/F tamanho · setas ↑↓ comprimento, ←→ grossura
//   I                      liga e desliga o ímã: ligado, a peça entra na grade de 1/8, encosta e alinha pelas vizinhas, e
//                          o que encosta COLA (vira um conjunto, que anda junto); desligado, fica livre e não cola
//   C deixa uma cópia e segue com a peça na mão · J marca a peça da mira (ao soltar, cola nela sem precisar encostar)
//   U desfaz o conjunto que está na mão
// Com uma forma escolhida na tela de blocos (E) valem as mesmas teclas; cada clique põe uma peça nova. Pré-forma: mire
// numa peça, F, "Guardar como pré-forma"; depois é só escolher o nome na tela de blocos e clicar onde quiser.
//
// Para quem desenha (Astra): `game.pecas` = { ima, mao, alvo, colaEm, preformas } — `mao` = { n, peca (id), dist } com
// algo na mão, senão null; `alvo` = a peça na mira; `colaEm` = id da peça em que a carga vai colar ao soltar (0 = não
// cola). Os contornos e o fantasma daqui são provisórios, do mesmo traço do editor de objetos.

import * as THREE from '../three.js';
import { BLOCKS, KIND, K_AIR, K_LIQUID, REPLACEABLE, B } from '../../shared/blocks.js';
import { Y_TOP } from '../../shared/constants.js';
import { eToraDeMadeira, secaoTora } from '../../shared/corte-tora.js';
import { raycastVoxels } from '../world/raycast.js';
import { shapeGeometry, painelGrosso } from './shapes.js';
import { stepSize, stepTurn, stepTilt, stepThick, stepLength, nextOrient, ORIENT_LABEL, shapePlaceQuat } from './sizing.js';
import { alinhar, apoioDaCarga, relativa, absoluta, girarY, tombar, DIST_MIN, DIST_MAX, DIST_PADRAO, PECAS_MAX, ESCALA_MIN, ESCALA_MAX, limpaNome } from '../../shared/pecas.js';
import { orientBlock } from '../game/interaction.js';
import { h } from '../ui/ui.js';

const COR_SOLTA = 0xf4a64e, COR_COLA = 0x3fd0b0;
const ESCALAS = [0.1, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10];
const FANTASMAS_MAX = 240, CONTORNOS_MAX = 48;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fmt = (v) => (Math.round(v * 1000) / 1000).toLocaleString('pt-BR');
const fmt1 = (v) => (Math.round(v * 10) / 10).toLocaleString('pt-BR');
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const UMA = [0, 0, 0], SEM_GIRO = [0, 0, 0, 1];

const CSS = `
.pecas-teclas { position: absolute; left: calc(12px + var(--safe-l)); top: 50%; transform: translateY(-50%); z-index: 6; padding: 10px 12px;
  display: grid; grid-template-columns: auto 1fr; gap: 3px 10px; align-items: baseline; font-size: 12px; color: var(--muted);
  background: linear-gradient(160deg, rgba(20, 32, 46, .78), rgba(9, 15, 23, .82)) padding-box, var(--edge) border-box;
  border: 1px solid transparent; border-radius: 12px; pointer-events: none; max-width: 250px; }
.pecas-teclas.hide { display: none; }
.pecas-teclas b { grid-column: 1 / -1; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; margin-bottom: 2px;
  background: linear-gradient(90deg, #ffd9a0, #f4a64e); -webkit-background-clip: text; background-clip: text; color: transparent; }
.pecas-teclas kbd { font: inherit; font-weight: 700; color: var(--ink); white-space: nowrap; }
.pecas-teclas .ima-on { background: linear-gradient(90deg, #8ff0d8, #3fd0b0); -webkit-background-clip: text; background-clip: text; color: transparent; font-weight: 700; }
.pecas-pf { display: flex; flex-wrap: wrap; gap: 6px; flex-basis: 100%; align-items: center; }
.pecas-pf > span { font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); margin-right: 4px; }
.pecas-pf .pf { display: inline-flex; }
.pecas-pf .pf .btn:first-child { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.pecas-pf .pf .btn.x { border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 8px 9px; min-width: 0; }
#hud.toque .pecas-teclas { display: none; }
`;

export function initMao({ game, player, net, ui, input, scene, interaction, store, world, objects, device, edit, showSel, nomes, sincOrient, lembrar, closeOverlay, aoMudar }) {
  const estilo = document.createElement('style'); estilo.textContent = CSS; document.head.appendChild(estilo);
  const teclado = !(device && device.touch);
  let ima = store.get('peca.ima', true) !== false;
  let dist = clamp(Number(store.get('peca.dist', DIST_PADRAO)) || DIST_PADRAO, DIST_MIN, DIST_MAX);
  let carga = null;            // o que está na mão: { mao (entrada), itens, q, k, e, dist, so, marcada, volta }
  let alvo = null;             // a peça na mira (entrada) quando não há nada na mão
  let colaEm = 0;              // id da peça em que a carga vai colar ao soltar
  let avisouTeclas = false, souGm = false;
  const pfs = new Map();       // id → cabeçalho { id, nome, por, n, k }
  const dados = new Map();     // id → pré-forma inteira (com as peças), pedida ao servidor quando se escolhe
  const colavel = (o) => !!o && !o.bau && !o.fixo && o.dec !== 'litoral';
  const criativo = () => !game.modeRules || !!game.modeRules.criativo;
  const som = (n, v = 0.6, t = 1.1, mat) => game.audio?.play(n, v, t, mat);
  const nomeDe = (o) => nomes[o.s] || 'Objeto';

  // ---- o que se vê: fantasma da forma nova, fantasma da pré-forma, contornos -----------------------------------------
  const matFantasma = new THREE.MeshBasicMaterial({ color: COR_SOLTA, transparent: true, opacity: 0.32, depthWrite: false });
  const ghost = new THREE.Mesh(shapeGeometry('cubo'), matFantasma);
  ghost.visible = false; ghost.renderOrder = 7; scene.add(ghost);
  const grupoPf = new THREE.Group(); grupoPf.visible = false; grupoPf.userData.pf = 0; scene.add(grupoPf);
  const geoBorda = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const bordas = [];
  let nBordas = 0;
  function borda(o, cor, folga = 0.03) {
    if (nBordas >= CONTORNOS_MAX) return;
    let l = bordas[nBordas];
    if (!l) {
      l = new THREE.LineSegments(geoBorda, new THREE.LineBasicMaterial({ color: cor, transparent: true, opacity: 0.85, depthTest: false }));
      l.renderOrder = 8; scene.add(l); bordas.push(l);
    }
    nBordas++;
    l.visible = true;
    l.material.color.setHex(cor);
    l.position.set(o.p[0], o.p[1], o.p[2]);
    l.quaternion.set(o.q[0], o.q[1], o.q[2], o.q[3]);
    l.scale.set(o.k[0] + folga, o.k[1] + folga, (o.s === 'painel' ? Math.max(0.08, o.k[2]) : o.k[2]) + folga);
  }
  // no fim do quadro (frame): some o que não foi desenhado neste quadro (também quando outro sistema ficou com a mira)
  const fimBordas = () => { for (let i = nBordas; i < bordas.length; i++) bordas[i].visible = false; nBordas = 0; };
  function escalaDaMalha(m, s, k, mat) {
    m.scale.set(k[0], k[1], s === 'painel' && !painelGrosso(s, k, mat) ? 1 : k[2]);
  }
  function montaFantasmaPf(pf) {
    while (grupoPf.children.length) grupoPf.remove(grupoPf.children[0]);
    for (const x of pf.l.slice(0, FANTASMAS_MAX)) {
      const grosso = painelGrosso(x.s, x.k, x.m);
      const m = new THREE.Mesh(shapeGeometry(grosso || x.s === 'modelo' ? 'cubo' : x.s), matFantasma);
      m.position.set(x.rp[0], x.rp[1], x.rp[2]);
      m.quaternion.set(x.rq[0], x.rq[1], x.rq[2], x.rq[3]);
      escalaDaMalha(m, x.s, x.k, x.m);
      m.renderOrder = 7;
      grupoPf.add(m);
    }
    grupoPf.userData.pf = pf.id;
  }
  function esconde() { ghost.visible = false; grupoPf.visible = false; }

  // ---- a mira: o primeiro que o raio toca até a distância da mão (bloco, árvore, peça) ou o ponto no ar -------------------
  const vox = { hit: false };
  const leitor = (x, y, z) => (world.selectionBlock || world.getBlock)(x, y, z);
  leitor.shape = (x, y, z) => world.getBlock.shape?.(x, y, z) ?? 15;
  leitor.mini = (x, y, z) => world.getMini?.(x, y, z) ?? 0;
  const para = (id) => KIND[id] !== K_LIQUID;
  // `folga` = o raio da carga: uma superfície logo depois da distância da mão, que a peça já tocaria, também conta
  // como apoio (senão a peça ficaria "no ar" enfiada no chão).
  function mirar(o, d, alcance, folga = 0) {
    const ate = alcance + folga;
    let t = ate, tipo = 'ar', n = null, entry = null;
    raycastVoxels(leitor, o[0], o[1], o[2], d[0], d[1], d[2], ate, para, vox);
    if (vox.hit && vox.t <= ate) { t = vox.t; tipo = 'bloco'; n = vox.nx || vox.ny || vox.nz ? [vox.nx, vox.ny, vox.nz] : [0, 1, 0]; }
    const tr = game.trees?.aim ? game.trees.aim(o, d, t) : null;
    if (tr && tr.t < t && tr.normal) { t = tr.t; tipo = 'arvore'; n = tr.normal; }
    const ob = objects.raycast(o, d, t);
    if (ob && ob.t <= t) { t = ob.t; tipo = 'peca'; n = ob.normal; entry = ob.entry; }
    if (tipo === 'ar') t = alcance;
    return { tipo, t, n, entry, pt: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] };
  }
  const folgaDe = (k, e = 1) => Math.min(3, Math.hypot(k[0], k[1], k[2]) * e / 2);
  // as peças perto o bastante para o ímã considerar (fora as que estão na mão e as esferas-ambiente)
  function vizinhas(p, raio) {
    const l = [];
    for (const e of objects.list.values()) {
      if (e.held || e.env) continue;
      const o = e.o, r = e.radius + raio + 0.6;
      const dx = o.p[0] - p[0], dy = o.p[1] - p[1], dz = o.p[2] - p[2];
      if (dx * dx + dy * dy + dz * dz <= r * r) l.push(o);
    }
    return l;
  }
  // Onde a carga fica: apoiada na superfície mirada (ou no ar), e, com o ímã, alinhada e talvez colada.
  // q = giro da referência; caixa = { s, k } da peça de referência; pecas = [{ rp, rq, k, s }] relativas a ela.
  function posar(q, caixa, pecas, escala, m, marcada) {
    let p;
    if (m.n) { const a = apoioDaCarga(q, pecas, [-m.n[0], -m.n[1], -m.n[2]], escala); p = [m.pt[0] + m.n[0] * a, m.pt[1] + m.n[1] * a, m.pt[2] + m.n[2] * a]; }
    else p = [m.pt[0], m.pt[1], m.pt[2]];
    let junta = 0, qf = q;
    if (ima) {
      const k = [caixa.k[0] * escala, caixa.k[1] * escala, caixa.k[2] * escala];
      const raio = Math.hypot(k[0], k[1], k[2]) / 2;
      const r = alinhar({ s: caixa.s, p, q, k }, vizinhas(p, raio), { normal: m.n, preferida: m.entry ? m.entry.o.id : 0 });
      p = r.p; qf = r.q;
      const viz = r.alvo ? objects.list.get(r.alvo) : null;
      if (r.contato && viz && colavel(viz.o)) junta = r.alvo;
      else if (m.tipo === 'peca' && colavel(m.entry.o)) junta = m.entry.o.id;      // apoiada numa peça: cola nela
    }
    if (marcada && objects.list.has(marcada)) junta = marcada;                       // J: cola na marcada, encoste ou não
    if (net.offline) junta = 0;                                                      // conjuntos são do servidor
    return { p, q: qf, junta };
  }
  const passoDist = (v, dir) => clamp(Math.round((dir > 0 ? v + Math.max(0.25, v * 0.12) : v - Math.max(0.25, v * 0.107)) * 20) / 20, DIST_MIN, DIST_MAX);
  function passoEscala(v, dir) {
    if (dir > 0) return ESCALAS.find((s) => s > v + 1e-6) ?? v;
    for (let i = ESCALAS.length - 1; i >= 0; i--) if (ESCALAS[i] < v - 1e-6) return ESCALAS[i];
    return v;
  }

  // ---- o ímã ---------------------------------------------------------------------------------------------------------------
  function setIma(on, calado) {
    ima = !!on;
    store.set('peca.ima', ima);
    if (!calado) {
      ui.toast(ima ? 'Ímã ligado: a peça entra na grade, alinha pelas vizinhas e o que encosta cola.' : 'Ímã desligado: a peça fica livre, sem grade e sem colar.', 2600);
      som('tick', 0.7, ima ? 1.3 : 0.8);
    }
    atualizaPaleta();
  }

  // ---- pegar, soltar, cancelar -------------------------------------------------------------------------------------------
  function pegar(entry, so, o, d) {
    if (!entry || carga) return false;
    const ob = entry.o;
    if (!criativo()) { ui.toast('Pegar e mover peças é do modo criativo (/modo criativo).'); return false; }
    if (ob.bau) { ui.toast('O baú não se pega: mire nele e aperte F para abrir.'); return false; }
    if (!colavel(ob) || entry.env) { ui.toast('Esta peça faz parte da paisagem: não se move.'); return false; }
    let membros = [entry];
    if (ob.g && !so) {
      membros = objects.membros(ob.g).filter((e) => colavel(e.o));
      if (membros.length > PECAS_MAX) { ui.toast(`Conjunto grande demais para a mão (${membros.length} peças; o máximo é ${PECAS_MAX}).`); return false; }
    }
    let dd = dist;
    if (o && d) dd = (ob.p[0] - o[0]) * d[0] + (ob.p[1] - o[1]) * d[1] + (ob.p[2] - o[2]) * d[2];
    else dd = Math.hypot(ob.p[0] - player.pos[0], ob.p[1] - (player.pos[1] + 1.5), ob.p[2] - player.pos[2]);
    carga = {
      mao: entry, so: !!(so && ob.g), q: [...ob.q], k: [...ob.k], e: 1, marcada: 0, dist: clamp(dd, DIST_MIN, DIST_MAX),
      volta: game.tool && game.tool.type === 'shape' ? game.tool : null,
      itens: membros.map((e) => ({ e, o0: { p: [...e.o.p], q: [...e.o.q], k: [...e.o.k] }, k: [...e.o.k], s: e.o.s, ...relativa(ob, e.o) })),
    };
    for (const it of carga.itens) it.e.held = true;
    game.tool = null;
    som('tick', 0.8, 1.25);
    if (teclado && !avisouTeclas) { avisouTeclas = true; ui.toast('Peça na mão: botão direito solta · Q cancela · as teclas estão no quadro à esquerda.', 4200); }
    return true;
  }
  function largaMao() {
    if (!carga) return;
    for (const it of carga.itens) it.e.held = false;
    if (carga.volta && !game.tool) game.tool = carga.volta;
    carga = null; colaEm = 0;
  }
  function cancelar(calado) {
    if (!carga) return;
    for (const it of carga.itens) if (!it.e.dead && objects.list.has(it.e.o.id)) objects.preview(it.e.o.id, mudou(it.e.o, it.o0));
    largaMao();
    if (!calado) som('tick', 0.6, 0.8);
  }
  // só o que mudou: mandar `k` igual refaz o material da peça à toa
  function mudou(o, novo) {
    const part = { p: novo.p, q: novo.q };
    if (novo.k && (novo.k[0] !== o.k[0] || novo.k[1] !== o.k[1] || novo.k[2] !== o.k[2])) part.k = novo.k;
    return part;
  }
  // linha compacta de uma peça para o servidor: [id, p×3, q×4, k×3], arredondada (a mensagem tem teto de 96 KB)
  const a3 = (v) => Math.round(v * 1000) / 1000, a5 = (v) => Math.round(v * 1e5) / 1e5;
  const linha = (o) => [o.id, a3(o.p[0]), a3(o.p[1]), a3(o.p[2]), a5(o.q[0]), a5(o.q[1]), a5(o.q[2]), a5(o.q[3]), a3(o.k[0]), a3(o.k[1]), a3(o.k[2])];
  const kDe = (it, c) => (c.itens.length === 1 ? c.k : c.e === 1 ? it.o0.k : it.o0.k.map((v) => Math.round(clamp(v * c.e, 0.02, 4000) * 1000) / 1000));
  function soltar(pose) {
    const c = carga;
    if (net.offline) for (const it of c.itens) objects.update(it.e.o.id, { p: [...it.e.o.p], q: [...it.e.o.q], k: [...it.e.o.k] });
    else net.send({ t: 'pc', op: 'mover', l: c.itens.map((it) => linha(it.e.o)), ...(pose.junta ? { junta: pose.junta } : {}), ...(c.so ? { so: true } : {}) });
    som('place', 0.9, 0.95 + Math.random() * 0.1, 'wood');
    largaMao();
  }
  function carimbar(pose) {
    const c = carga;
    if (net.offline) {
      if (c.itens.length > 1) return ui.toast('Copiar conjuntos precisa do servidor.');
      const o = c.mao.o;
      objects.create({ s: o.s, p: [...o.p], q: [...o.q], k: [...o.k], m: { ...o.m }, f: o.f });
    } else net.send({ t: 'pc', op: 'copiar', l: c.itens.map((it) => linha(it.e.o)), ...(pose.junta ? { junta: pose.junta } : {}) });
    som('place', 0.9, 1.1, 'wood');
  }

  // ---- com algo na mão ------------------------------------------------------------------------------------------------------
  function segurar(playing, o, d) {
    const c = carga;
    if (c.mao.dead || !objects.list.has(c.mao.o.id)) { cancelar(true); return false; }        // a peça sumiu (alguém apagou)
    c.itens = c.itens.filter((it) => !it.e.dead && objects.list.has(it.e.o.id));
    const uma = c.itens.length === 1, flat = c.mao.o.s === 'painel';
    if (playing) {
      let t = false;
      if (input.wasPressed('turnL')) { c.q = girarY(c.q, 15); t = true; }
      if (input.wasPressed('turnR')) { c.q = girarY(c.q, -15); t = true; }
      if (input.wasPressed('turn45')) { c.q = girarY(c.q, 45); t = true; }
      if (input.wasPressed('tiltU')) { c.q = tombar(c.q, player.yaw, 15); t = true; }
      if (input.wasPressed('tiltD')) { c.q = tombar(c.q, player.yaw, -15); t = true; }
      if (input.wasPressed('orient')) { c.q = tombar(c.q, player.yaw, 90); t = true; }
      for (const [acao, dir] of [['grow', 1], ['shrink', -1]]) {
        if (!input.wasPressed(acao)) continue;
        if (uma) c.k = stepSize(c.k, dir, flat); else c.e = clamp(passoEscala(c.e, dir), ESCALA_MIN, ESCALA_MAX);
        t = true;
      }
      if (uma) {
        if (input.wasPressed('longer')) { c.k = stepLength(c.k, 1); t = true; }
        if (input.wasPressed('shorter')) { c.k = stepLength(c.k, -1); t = true; }
        if (input.wasPressed('thicker')) { c.k = stepThick(c.k, 1, flat); t = true; }
        if (input.wasPressed('thinner')) { c.k = stepThick(c.k, -1, flat); t = true; }
      } else if (input.wasPressed('longer') || input.wasPressed('shorter') || input.wasPressed('thicker') || input.wasPressed('thinner')) {
        ui.toast('Comprimento e grossura valem para uma peça só: Shift+Q pega só ela. R/F muda o tamanho do conjunto inteiro.', 3600);
      }
      if (input.wasPressed('far')) { c.dist = passoDist(c.dist, 1); t = true; }
      if (input.wasPressed('near')) { c.dist = passoDist(c.dist, -1); t = true; }
      if (t) som('tick', 0.5, 1.1);
    }
    if (uma) c.itens[0].k = c.k;
    const m = mirar(o, d, c.dist, folgaDe(c.k, uma ? 1 : c.e));
    const pecas = uma ? [{ rp: UMA, rq: SEM_GIRO, k: c.k, s: c.mao.o.s }] : c.itens;
    const pose = posar(c.q, { s: c.mao.o.s, k: c.k }, pecas, uma ? 1 : c.e, m, c.marcada);
    for (const it of c.itens) {
      const a = uma ? pose : absoluta(pose, it, c.e);
      objects.preview(it.e.o.id, mudou(it.e.o, { p: a.p, q: a.q, k: kDe(it, c) }));
    }
    colaEm = pose.junta;
    // contornos: a peça da mão, e (verde) onde vai colar
    borda(c.mao.o, COR_SOLTA);
    const viz = pose.junta ? objects.list.get(pose.junta) : null;
    if (viz) borda(viz.o, COR_COLA, 0.06);
    const n = c.itens.length;
    ui.setHint(`Na mão: ${nomeDe(c.mao.o)}${n > 1 ? ` + ${n - 1} (conjunto${c.e !== 1 ? ` × ${fmt(c.e)}` : ''})` : ` · ${fmt(c.k[1])} × ${fmt(Math.max(c.k[0], c.k[2]))} m`}`
      + ` · ${m.tipo === 'ar' ? `no ar a ${fmt1(c.dist)} m` : 'apoiada'} · ímã ${ima ? 'ligado' : 'desligado'}${viz ? ' → cola ao soltar' : ''}`);
    if (playing) {
      if (input.wasPressed('place')) soltar(pose);
      else if (input.wasPressed('pick')) cancelar();
      else if (input.wasPressed('stamp')) carimbar(pose);
      else if (input.wasPressed('pjoin')) {
        // marca a peça da mira: ao soltar, a carga entra no conjunto dela, encoste ou não
        const alvoJ = objects.raycast(o, d, 48)?.entry;
        if (net.offline) ui.toast('Conjuntos precisam do servidor.');
        else if (!alvoJ || !colavel(alvoJ.o)) ui.toast('Mire na peça em que a da mão deve colar e aperte J.');
        else if (c.marcada === alvoJ.o.id) { c.marcada = 0; ui.toast('Marca tirada.'); }
        else { c.marcada = alvoJ.o.id; ui.toast('Marcada: ao soltar, o que está na mão entra no conjunto dessa peça, mesmo sem encostar.', 3600); som('tick', 0.7, 1.4); }
      } else if (input.wasPressed('psplit')) {
        if (!c.mao.o.g) ui.toast('A peça da mão já está solta.');
        else if (!net.offline) { net.send({ t: 'pc', op: 'soltar', id: c.mao.o.id, tudo: true }); ui.toast('Conjunto desfeito: ao soltar, cada peça fica por si.'); }
      }
    }
    return true;
  }

  // ---- com uma forma (ou pré-forma) escolhida: cada clique põe uma nova ---------------------------------------------------
  function colocar(playing, o, d, tool, hit) {
    const pf = tool.s === 'preforma';
    const flat = tool.s === 'painel';
    if (playing) {
      if (!pf && (input.hotbar >= 0 || tool.sel !== game.sel)) {       // 1–9 (ou um toque na barra) troca o material
        tool.sel = game.sel;
        const b = game.hotbar[game.sel];
        if (b && b < BLOCKS.length && KIND[b] !== K_AIR) tool.m = { t: 'b', b };
      }
      let t = false;
      for (const [acao, dir] of [['grow', 1], ['shrink', -1]]) {
        if (!input.wasPressed(acao)) continue;
        if (pf) tool.e = clamp(passoEscala(tool.e || 1, dir), ESCALA_MIN, ESCALA_MAX); else tool.k = stepSize(tool.k, dir, flat);
        t = true;
      }
      if (!pf) {
        if (input.wasPressed('longer')) { tool.k = stepLength(tool.k, 1); t = true; }
        if (input.wasPressed('shorter')) { tool.k = stepLength(tool.k, -1); t = true; }
        if (input.wasPressed('thicker')) { tool.k = stepThick(tool.k, 1, flat); t = true; }
        if (input.wasPressed('thinner')) { tool.k = stepThick(tool.k, -1, flat); t = true; }
      }
      if (input.wasPressed('turnL')) { tool.r = stepTurn(tool.r, +1); t = true; }
      if (input.wasPressed('turnR')) { tool.r = stepTurn(tool.r, -1); t = true; }
      if (input.wasPressed('turn45')) { tool.r = stepTurn(tool.r, +3); t = true; }
      if (input.wasPressed('tiltU')) { tool.i = stepTilt(tool.i, +1); t = true; }
      if (input.wasPressed('tiltD')) { tool.i = stepTilt(tool.i, -1); t = true; }
      if (input.wasPressed('orient')) { sincOrient(nextOrient(tool.o)); t = true; }
      if (input.wasPressed('far')) { dist = passoDist(dist, 1); store.set('peca.dist', dist); t = true; }
      if (input.wasPressed('near')) { dist = passoDist(dist, -1); store.set('peca.dist', dist); t = true; }
      if (t) { if (!pf) lembrar(tool); som('tick', 0.6, 1.1); }
    }
    let pecas, caixa, escala = 1;
    if (pf) {
      if (!tool.dados) tool.dados = dados.get(tool.pf) || null;
      if (!tool.dados) { esconde(); ui.setHint(`Pré-forma "${tool.nome}": buscando as peças…`); return true; }
      pecas = tool.dados.l; caixa = { s: 'cubo', k: tool.dados.k }; escala = tool.e || 1;
    } else { pecas = [{ rp: UMA, rq: SEM_GIRO, k: tool.k, s: tool.s }]; caixa = { s: tool.s, k: tool.k }; }
    const m = mirar(o, d, dist, folgaDe(caixa.k, escala));
    const q = shapePlaceQuat(pf ? 'cubo' : tool.s, player.yaw, m.n, tool.r || 0, tool.o || 'v', tool.i || 0);
    const pose = posar(q, caixa, pecas, escala, m, 0);
    colaEm = pose.junta;
    matFantasma.color.setHex(pose.junta ? COR_COLA : COR_SOLTA);
    if (pf) {
      if (grupoPf.userData.pf !== tool.dados.id || grupoPf.userData.n !== tool.dados.l.length) { montaFantasmaPf(tool.dados); grupoPf.userData.n = tool.dados.l.length; }
      ghost.visible = false; grupoPf.visible = true;
      grupoPf.position.set(pose.p[0], pose.p[1], pose.p[2]); grupoPf.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]); grupoPf.scale.setScalar(escala);
    } else {
      const grosso = painelGrosso(tool.s, tool.k, tool.m);
      grupoPf.visible = false; ghost.visible = true;
      ghost.geometry = shapeGeometry(grosso ? 'cubo' : tool.s);
      ghost.position.set(pose.p[0], pose.p[1], pose.p[2]); ghost.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]);
      escalaDaMalha(ghost, tool.s, tool.k, tool.m);
    }
    const viz = pose.junta ? objects.list.get(pose.junta) : null;
    if (viz) borda(viz.o, COR_COLA, 0.06);
    const onde = m.tipo === 'ar' ? `no ar a ${fmt1(dist)} m` : 'apoiada';
    const imaTxt = `ímã ${ima ? 'ligado' : 'desligado'}${viz ? ' → cola ao pôr' : ''}`;
    if (pf) ui.setHint(`Pré-forma "${tool.nome}"${escala !== 1 ? ` × ${fmt(escala)}` : ''} · ${tool.r || 0}° · ${onde} · ${imaTxt}`);
    else {
      const mat = tool.m.t === 'b' ? (BLOCKS[tool.m.b]?.name || 'bloco') : 'cor';
      const incl = tool.i ? ` · inclinada ${tool.i}°` : '';
      ui.setHint(`${nomes[tool.s]} (${ORIENT_LABEL[tool.o || 'v']}) de ${mat} · ${fmt(tool.k[1])} × ${fmt(Math.max(tool.k[0], flat ? 0 : tool.k[2]))} m · ${tool.r || 0}°${incl} · ${onde} · ${imaTxt}`);
    }
    if (playing) {
      if (input.wasPressed('place')) {
        if (pf) {
          if (net.offline) ui.toast('Pré-formas precisam do servidor.');
          else net.send({ t: 'pc', op: 'pf-por', pf: tool.pf, p: pose.p, q: pose.q, e: escala, ...(pose.junta ? { junta: pose.junta } : {}) });
        } else objects.create({ s: tool.s, p: pose.p, q: pose.q, k: tool.k, m: tool.m, f: tool.f }, false, pose.junta);
        som('place', 0.9, 0.95 + Math.random() * 0.1, 'wood');
      } else if (hit && input.wasPressed('break')) objects.destroy(hit.entry.o.id);     // quebrar apaga a peça mirada, como sempre
      else if (hit && input.wasPressed('pick')) pegar(hit.entry, input.isDown('sneak'), o, d);
    }
    return true;
  }

  // ---- a vez da mão na mira (chamado pelo editor de objetos; devolve true se tratou) ---------------------------------------
  let miraViva = false;
  function interact(dt, playing, o, d) {
    miraViva = true;
    if (playing && input.wasPressed('magnet')) setIma(!ima);
    let tool = game.tool && game.tool.type === 'shape' ? game.tool : null;
    if ((tool || carga) && playing && input.wasPressed('tool')) {             // B: sai da forma; com peça na mão, cancela
      if (carga) cancelar(); else game.tool = null;
      esconde(); showSel(null);
      return false;
    }
    if (carga && !criativo()) cancelar(true);
    if (carga) { esconde(); showSel(null); alvo = null; return segurar(playing, o, d); }
    // a peça na mira, de perto (editar, pegar, apagar): não passa de um bloco ou de uma árvore que esteja na frente
    const v = interaction.target, tree = game.treeAim;
    const limite = Math.min(v.hit ? v.t : interaction.reach + 3, tree?.t ?? Infinity);
    const hit = objects.raycast(o, d, limite);
    alvo = hit ? hit.entry : null;
    if (tool) { showSel(alvo); return colocar(playing, o, d, tool, hit); }
    esconde(); colaEm = 0;
    if (!hit) { showSel(null); return false; }
    const ob = hit.entry.o, conj = ob.g ? objects.membros(ob.g) : null;
    showSel(hit.entry);
    if (conj) for (const e of conj) if (e !== hit.entry) borda(e.o, COR_SOLTA, 0.02);
    const pode = criativo() && colavel(ob) && !hit.entry.env;
    let acaoMachado;
    if (game.machado?.equipado() && ob.s === 'tora') {
      if (!eToraDeMadeira(ob)) acaoMachado = 'o machado corta madeira';
      else if (!criativo()) acaoMachado = 'rachar exige criativo ou GM';
      else acaoMachado = ob.g ? 'solte do conjunto para rachar' : 'golpeie para rachar';
    } else if (game.machado?.equipado() && secaoTora(ob.s)) acaoMachado = 'madeira já rachada';
    ui.setHint(`${nomeDe(ob)}${conj ? ` · conjunto de ${conj.length}` : ''}`
      + (teclado ? ` — ${pode ? (conj ? 'Q pega o conjunto · Shift+Q só esta · ' : 'Q pega · ') : ''}F edita · ${acaoMachado || 'quebrar apaga'}` : ` — Usar edita · ${acaoMachado || 'quebrar apaga'}`));
    if (playing) {
      if (input.wasPressed('interact')) { edit(hit.entry); return true; }
      if (pode && input.wasPressed('pick')) { pegar(hit.entry, input.isDown('sneak'), o, d); return true; }
      if (input.wasPressed('break')) { objects.destroy(ob.id); return true; }
      if (input.wasPressed('place')) {
        // bloco encostado no objeto
        const x = Math.floor(hit.point[0] + hit.normal[0] * 0.5), y = Math.floor(hit.point[1] + hit.normal[1] * 0.5), z = Math.floor(hit.point[2] + hit.normal[2] * 0.5);
        const item = game.hotbar[game.sel], cel = world.getBlock(x, y, z);
        if (item && y > (Number.isFinite(world.fundo) ? world.fundo : 0) && y < Y_TOP && cel !== -1 && REPLACEABLE[cel] && !player.occupies(x, y, z)) interaction.set(x, y, z, orientBlock(item, d, Math.round(hit.normal[0]), Math.round(hit.normal[1]), Math.round(hit.normal[2])));
      }
    }
    return true;
  }

  // ---- pré-formas -------------------------------------------------------------------------------------------------------------
  function usarPreforma(id) {
    const cab = pfs.get(id);
    if (!cab) return;
    if (net.offline) return ui.toast('Pré-formas precisam do servidor.');
    if (!criativo()) return ui.toast('Pré-formas são do modo criativo (/modo criativo).');
    if (carga) cancelar(true);
    game.tool = { type: 'shape', s: 'preforma', pf: id, nome: cab.nome, k: [...cab.k], r: 0, o: 'v', i: 0, e: 1, m: { t: 'c', c: '#c8c8c8' }, f: 1, dados: dados.get(id) || null };
    if (!game.tool.dados) net.send({ t: 'pc', op: 'pf-ver', pf: id });
    ui.toast(`Pré-forma "${cab.nome}": clique direito põe uma cópia · R/F tamanho · T/G gira · Y/H inclina · roda distância · B sai.`, 5200);
  }
  function salvarPreforma(entry, nome) {
    const n = limpaNome(nome);
    if (!entry) return false;
    if (net.offline) { ui.toast('Pré-formas precisam do servidor.'); return false; }
    if (!n) { ui.toast('Dê um nome à pré-forma.'); return false; }
    net.send({ t: 'pc', op: 'pf-salvar', id: entry.o.id, nome: n });
    return true;
  }
  function apagarPreforma(id) { if (!net.offline) net.send({ t: 'pc', op: 'pf-apagar', pf: id }); }
  // tira a peça do conjunto (`tudo` desfaz o conjunto inteiro); `apagar` remove do mundo o conjunto todo
  function soltarPeca(entry, tudo) { if (entry?.o.g && !net.offline) net.send({ t: 'pc', op: 'soltar', id: entry.o.id, tudo: !!tudo }); }
  function apagarConjunto(entry) { if (entry?.o.g && !net.offline) net.send({ t: 'pc', op: 'apagar', id: entry.o.id }); }

  // a faixa das pré-formas e do ímã na tela de blocos (o editor a encaixa junto das formas)
  const faixa = h('div', { class: 'pecas-pf' });
  function atualizaPaleta() {
    const lista = [...pfs.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    const eu = String(game.name || '').toLowerCase();
    faixa.replaceChildren(
      h('span', { text: 'Pré-formas:' }),
      ...(lista.length ? lista.map((x) => h('span', { class: 'pf' },
        h('button', { class: 'btn small', type: 'button', text: `${x.nome} (${x.n})`, title: `${plural(x.n, 'peça', 'peças')}, ${fmt(x.k[0])} × ${fmt(x.k[1])} × ${fmt(x.k[2])} m${x.por ? ' — guardada por ' + x.por : ''}`, onclick: () => { closeOverlay(); usarPreforma(x.id); } }),
        (String(x.por || '').toLowerCase() === eu || souGm) ? h('button', { class: 'btn small x', type: 'button', text: '×', title: `Apagar a pré-forma "${x.nome}"`, 'aria-label': `Apagar a pré-forma ${x.nome}`, onclick: () => apagarPreforma(x.id) }) : null))
        : [h('span', { class: 'note', text: 'nenhuma ainda — mire numa peça, aperte F e use "Guardar como pré-forma".' })]),
      h('button', { class: 'btn small' + (ima ? ' on' : ''), type: 'button', text: ima ? 'Ímã: ligado' : 'Ímã: desligado', title: 'Liga e desliga o ímã das peças (tecla I)', onclick: () => setIma(!ima) }));
  }

  // ---- o que vem do servidor ----------------------------------------------------------------------------------------------------
  function onPc(m) {
    switch (m.op) {
      case 'mover':
        for (const r of Array.isArray(m.l) ? m.l : []) {
          const e = objects.list.get(r[0]);
          if (!e) continue;
          const novo = { p: [r[1], r[2], r[3]], q: [r[4], r[5], r[6], r[7]], k: [r[8], r[9], r[10]] };
          const it = carga && carga.itens.find((x) => x.e === e);
          if (it) it.o0 = novo;                              // está na minha mão: guarda como "de onde veio"
          else objects.applyServer(r[0], mudou(e.o, novo));
        }
        break;
      case 'g': for (const r of Array.isArray(m.l) ? m.l : []) if (objects.list.has(r[0])) objects.applyServer(r[0], { g: r[1] || 0 }); aoMudar?.(); break;
      case 'novos': for (const o of Array.isArray(m.l) ? m.l : []) if (o && Number.isInteger(o.id)) objects.addServer(o); break;
      case 'pf+': if (m.pf && Number.isInteger(m.pf.id)) { pfs.set(m.pf.id, m.pf); dados.delete(m.pf.id); atualizaPaleta(); } break;
      case 'pf-':
        pfs.delete(m.id); dados.delete(m.id); atualizaPaleta();
        if (game.tool && game.tool.pf === m.id) { game.tool = null; esconde(); ui.toast('Essa pré-forma foi apagada.'); }
        break;
      case 'pf':
        if (m.pf && Number.isInteger(m.pf.id) && Array.isArray(m.pf.l)) {
          dados.set(m.pf.id, m.pf);
          if (game.tool && game.tool.pf === m.pf.id) { game.tool.dados = m.pf; game.tool.k = [...m.pf.k]; }
        }
        break;
      default:
    }
  }
  game.hooks.other.push((m) => {
    if (m.t === 'pc') onPc(m);
    else if (m.t === 'welcome' || m.t === 'offline') {
      if (carga) { carga = null; colaEm = 0; }             // o mundo foi recarregado: as entradas antigas não valem mais
      pfs.clear(); dados.clear();
      for (const x of (m.t === 'welcome' && Array.isArray(m.preformas)) ? m.preformas : []) if (x && Number.isInteger(x.id)) pfs.set(x.id, x);
      if (game.tool && game.tool.s === 'preforma') game.tool = null;
      atualizaPaleta();
    } else if (m.t === 'gm') { souGm = !!m.isGm; atualizaPaleta(); }
    else if (m.t === 'spawned') atualizaPaleta();
  });

  // ---- o quadro de teclas e os botões do canto ---------------------------------------------------------------------------------
  const quadro = h('div', { class: 'pecas-teclas hide', 'aria-hidden': 'true' });
  ui.el.hud.append(quadro);
  let quadroChave = '';
  function linhas(modo, varias) {
    const l = [];
    if (modo === 'mao') l.push(['Botão direito', 'solta aqui'], ['Q ou B', 'cancela (volta)']);
    else l.push(['Botão direito', 'põe uma'], ['B', 'sai']);
    l.push(['Roda', 'perto · longe'], ['T · G', 'gira 15°'], ['Y · H', 'inclina 15°'], ['X', modo === 'mao' ? 'tomba 90°' : 'deita · em pé']);
    l.push(['R · F', varias ? 'tamanho do conjunto' : 'tamanho']);
    if (!varias) l.push(['↑ · ↓', 'comprimento'], ['← · →', 'grossura']);
    if (modo === 'mao') l.push(['C', 'deixa uma cópia'], ['J', 'marca onde colar'], ...(varias ? [['U', 'desfaz o conjunto']] : []));
    else if (modo === 'forma') l.push(['1–9', 'material'], ['Q', 'pega a peça mirada']);
    return l;
  }
  function atualizaQuadro() {
    const tool = game.tool && game.tool.type === 'shape' ? game.tool : null;
    const modo = carga ? 'mao' : tool ? (tool.s === 'preforma' ? 'pre' : 'forma') : '';
    const on = !!modo && teclado && game.state === 'PLAYING' && !game.overlay;
    const varias = carga ? carga.itens.length > 1 : modo === 'pre';
    const chave = on ? `${modo}:${varias}:${ima}` : '';
    if (chave === quadroChave) return;
    quadroChave = chave;
    quadro.classList.toggle('hide', !on);
    if (!on) return;
    quadro.replaceChildren(h('b', { text: modo === 'mao' ? 'Peça na mão' : modo === 'pre' ? 'Pré-forma' : 'Forma a colocar' }),
      ...linhas(modo, varias).flatMap(([k, v]) => [h('kbd', { text: k }), h('span', { text: v })]),
      h('kbd', { text: 'I' }), h('span', { class: ima ? 'ima-on' : '', text: ima ? 'ímã ligado: alinha e cola' : 'ímã desligado: livre' }));
  }
  const parar = (b) => { b.addEventListener('pointerdown', (e) => e.stopPropagation()); return b; };
  const bPegar = parar(h('button', { class: 'btn small hide', type: 'button', text: 'Pegar', title: 'Pega a peça da mira e o conjunto dela (tecla Q)', onclick: () => { if (alvo) pegar(alvo, false); } }));
  const bVolta = parar(h('button', { class: 'btn small hide', type: 'button', text: 'Cancelar', title: 'Devolve a peça para onde estava (tecla Q)', onclick: () => cancelar() }));
  const bIma = parar(h('button', { class: 'btn small hide', type: 'button', text: 'Ímã', title: 'Liga e desliga o ímã das peças (tecla I)', onclick: () => setIma(!ima) }));
  ui.el.corner.prepend(bPegar, bVolta, bIma);
  const mostra = (el, on) => { if (el.classList.contains('hide') === on) el.classList.toggle('hide', !on); };
  let paletaAberta = false;

  function frame() {
    const tool = game.tool && game.tool.type === 'shape' ? game.tool : null;
    // com uma forma escolhida ou uma peça na mão, R/F/T/G/Y/H/X, as setas e a roda mudam de papel (input.js, ALT_KEYS)
    input.shapeMode = !!(tool || carga);
    const jogando = game.state === 'PLAYING';
    if (carga && game.state !== 'PLAYING' && game.state !== 'PAUSED') cancelar(true);   // saiu do mundo com a peça na mão
    fimBordas();
    // Pegar e Cancelar só fazem falta onde não há tecla (toque); o do ímã mostra o estado em qualquer aparelho
    mostra(bPegar, !teclado && jogando && !carga && !tool && !!alvo && criativo() && colavel(alvo.o));
    mostra(bVolta, !teclado && jogando && !!carga);
    mostra(bIma, jogando && !!(carga || tool));
    if (game.overlay === 'palette' && !paletaAberta) atualizaPaleta();     // ao abrir a tela de blocos: nome e GM de agora
    paletaAberta = game.overlay === 'palette';
    const rotulo = ima ? 'Ímã: ligado' : 'Ímã: desligado';
    if (bIma.textContent !== rotulo) bIma.textContent = rotulo;
    if (bIma.classList.contains('on') !== ima) bIma.classList.toggle('on', ima);
    if (!tool && !carga) esconde();
    if (!miraViva) alvo = null;                 // outro sistema ficou com a mira neste quadro (baú, bicho, painel aberto)
    miraViva = false;
    atualizaQuadro();
  }

  atualizaPaleta();
  const api = {
    interact, frame, pegar, cancelar, setIma, usarPreforma, salvarPreforma, apagarPreforma, soltarPeca, apagarConjunto,
    faixa, colavel,
    get ima() { return ima; },
    get mao() { return carga ? { n: carga.itens.length, peca: carga.mao.o.id, dist: carga.dist } : null; },
    get alvo() { return alvo; },
    get colaEm() { return colaEm; },
    get preformas() { return [...pfs.values()]; },
  };
  game.pecas = api;
  return api;
}
