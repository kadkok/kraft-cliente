// LAVRA — aldeões dos povos no aparelho (server/povos.js manda { t: 'povo', l: [[id, x, y, z, rumo, ação, cor, criança,
// sexo, papel, visual, idoso]] } a 10/s). Cada um com cara própria (18/11, Kadmus: "todos os aldeões têm a mesma skin… não
// vi mulheres nem crianças nem o líder"): skin e tom de pele variados, roupa na cor do ofício, cabelo comprido e saia nas
// mulheres, cabelo grisalho nos velhos, criança menor, líder com cocar de penas e capa, caçador com arco, guerreiro com
// lança, pescador com vara. Ações: 3 mirando · 4 carregando · 5 dormindo · 6 colhendo (abaixado) · 7 trabalhando ·
// 8 pescando. Mirar num aldeão mostra a ficha (nome, ofício, idade, missão, competências), pedida ao servidor ('aldeao?').
import * as THREE from '../three.js';
import { buildBody } from '../render/avatars.js';

const PAPEIS = ['líder', 'caçador', 'coletor', 'pescador', 'curandeiro', 'guerreiro', 'artesão', 'agricultor', 'comerciante', 'criança'];
const SKINS = ['explorador', 'botanica', 'mineiro'];
const PELE = ['#ffffff', '#f3dcc6', '#e2bf9c', '#c99a72', '#a87650', '#8a5d3c'];
const ROUPA_OFICIO = { 'líder': '#7a1f1f', caçador: '#6a4a2a', coletor: '#5f7a3a', pescador: '#3a5f7a', curandeiro: '#e8e0c8', guerreiro: '#4a3a3a', artesão: '#8a6a3a', agricultor: '#7a8a3a', comerciante: '#3a3a7a', criança: '#b08a5a' };
const CABELO = ['#2a1a10', '#4a2e18', '#1a1a1a', '#6a4422', '#8a5a2a'];
// gente da Ilha Metrópole (cor 9 no pacote do servidor): roupa de cidade — prefeito de terno, faixa e cartola, guarda de
// farda e quepe (sem lança), operário de macacão, médico de jaleco
const ROUPA_URBANA = { 'líder': '#23272f', comerciante: '#5a3a6a', artesão: '#c2761e', guerreiro: '#1f3a5f', agricultor: '#3f7a3a', curandeiro: '#eef2f2', pescador: '#3a5f7a', criança: '#c08a4a', coletor: '#5f7a3a', caçador: '#6a4a2a' };

export function initPovos({ game, scene, camera, net }) {
  const mats = new Map();
  const mat = (c, r = 0.9) => { const k = c + r; if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: r })); return mats.get(k); };
  const caixa = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const G = { roupa: caixa(0.49, 0.62, 0.26), saia: caixa(0.56, 0.36, 0.34), cabeloLongo: caixa(0.5, 0.62, 0.12), touca: caixa(0.5, 0.14, 0.5), pena: caixa(0.06, 0.38, 0.04), capa: caixa(0.5, 0.9, 0.05),
    lanca: caixa(0.05, 2.0, 0.05), vara: caixa(0.035, 1.8, 0.035), carne: caixa(0.42, 0.22, 0.3), arco: new THREE.TorusGeometry(0.42, 0.025, 4, 12, Math.PI * 0.9),
    cartola: caixa(0.36, 0.3, 0.36), aba: caixa(0.6, 0.04, 0.6), faixa: caixa(0.51, 0.1, 0.28), quepe: caixa(0.52, 0.13, 0.52), pala: caixa(0.5, 0.035, 0.18) };
  const gente = new Map(), fichas = new Map();
  const agora = () => performance.now() / 1000, U = 1.8 / 32;

  function monta(id, cor, crianca, sexo, papelI, visual, idoso) {
    const papel = PAPEIS[papelI] || 'coletor', b = buildBody(), osso = b.root.getObjectByName('root') || b.root, cab = b.head || osso;
    b.setSkin?.(null, !!sexo, SKINS[visual % SKINS.length]);
    b.mats?.skin?.color?.set(PELE[(visual >> 2) % PELE.length]);                      // tom de pele
    const s = game.plataforma === 'pc';
    const add = (geo, m, pai, x, y, z, rx = 0, rz = 0) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.rotation.set(rx, 0, rz); me.castShadow = s; pai.add(me); return me; };
    const urbano = cor === 9, corRoupa = (urbano ? ROUPA_URBANA[papel] : ROUPA_OFICIO[papel]) || '#7a6a5a';
    add(G.roupa, mat(corRoupa), osso, 0, 18 * U, 0);
    const cabelo = idoso ? '#c8c8c0' : CABELO[(visual >> 5) % CABELO.length];
    if (sexo) { add(G.saia, mat(corRoupa), osso, 0, 12 * U - 0.08, 0); add(G.cabeloLongo, mat(cabelo, 0.95), cab, 0, -0.08, 0.26); }
    add(G.touca, mat(cabelo, 0.95), cab, 0, 8 * U + 0.07, 0);                        // cabelo em cima
    let item = null;
    if (urbano && papel === 'líder') {                                                 // prefeito: faixa no peito e cartola
      add(G.faixa, mat('#d8b23a', 0.6), osso, 0, 19.5 * U, 0);
      add(G.aba, mat('#16181c', 0.7), cab, 0, 8 * U + 0.16, 0); add(G.cartola, mat('#16181c', 0.7), cab, 0, 8 * U + 0.33, 0);
    } else if (urbano && papel === 'guerreiro') {                                       // guarda: quepe com pala, sem lança
      add(G.quepe, mat('#16284a', 0.8), cab, 0, 8 * U + 0.2, 0); add(G.pala, mat('#0e1420', 0.5), cab, 0, 8 * U + 0.15, -0.32);
    } else if (papel === 'líder') {                                                    // cocar de penas e capa
      ['#d23a2a', '#f2c23a', '#2a8ad2', '#f2f2e8', '#2ab26a'].forEach((c, k) => add(G.pena, mat(c, 0.8), cab, (k - 2) * 0.11, 8 * U + 0.3, -0.05 + Math.abs(k - 2) * 0.04, -0.15, (k - 2) * 0.22));
      add(G.capa, mat('#5a1414'), osso, 0, 17 * U, 0.17);
    } else if (papel === 'caçador') item = add(G.arco, mat('#5a3a1e', 0.8), osso, 0, 20 * U, 0.2, 0, Math.PI / 2);
    else if (papel === 'guerreiro') item = add(G.lanca, mat('#6a5a3a', 0.8), osso, 0.28, 1.0, 0.12);
    else if (papel === 'pescador') item = add(G.vara, mat('#8a6a3a', 0.8), osso, 0.3, 1.0, -0.2, 0.9);
    const carne = add(G.carne, mat('#8a3a2a', 0.7), osso, 0, 1.0, -0.35); carne.visible = false;
    b.root.scale.setScalar(crianca ? 0.6 + (visual % 5) * 0.03 : sexo ? 0.95 : 1.02);
    scene.add(b.root);
    return { b, item, carne, papel, fila: [], fase: Math.random() * 6 };
  }

  game.hooks.other.push((m) => {
    if (m.t === 'welcome' || m.t === 'dim') { for (const g of gente.values()) scene.remove(g.b.root); gente.clear(); return; }
    if (m.t === 'aldeao') { fichas.set(m.id, m); if (alvoId === m.id) mostraFicha(m); return; }
    if (m.t !== 'povo') return;
    const t = agora(), vistos = new Set();
    for (const [id, x, y, z, rumo, acao, cor, crianca, sexo, papelI, visual, idoso] of m.l || []) {
      vistos.add(id);
      let g = gente.get(id);
      if (!g) { g = monta(id, cor, crianca, sexo, papelI ?? 2, visual ?? id, idoso); gente.set(id, g); }
      g.fila.push({ t, p: [x / 100, y / 100, z / 100], rumo: rumo / 100 }); if (g.fila.length > 5) g.fila.shift();
      g.acao = acao;
    }
    for (const [id, g] of gente) if (!vistos.has(id)) { scene.remove(g.b.root); gente.delete(id); }
  });

  // ficha de quem está na mira
  const ficha = document.createElement('div');
  Object.assign(ficha.style, { position: 'fixed', left: '50%', bottom: '150px', transform: 'translateX(-50%)', maxWidth: '520px', padding: '8px 14px', borderRadius: '10px', zIndex: 15, display: 'none',
    background: 'linear-gradient(180deg, rgba(34,26,16,.92), rgba(18,14,8,.88))', border: '1px solid rgba(255,230,180,.3)', color: '#f6ecd8', font: '600 13px system-ui, sans-serif', textAlign: 'center', pointerEvents: 'none', textShadow: '0 1px 2px #000' });
  const fTit = document.createElement('div'), fMis = document.createElement('div'), fComp = document.createElement('div');
  Object.assign(fTit.style, { font: '800 15px system-ui' }); Object.assign(fMis.style, { margin: '3px 0', color: '#ffe2a8' }); Object.assign(fComp.style, { fontSize: '12px', opacity: '.9' });
  ficha.append(fTit, fMis, fComp); document.body.appendChild(ficha);
  function mostraFicha(f) {
    fTit.textContent = `${f.nome} · ${f.papel} · ${f.idade} anos`;
    fMis.textContent = `${f.missao}${f.povo ? ' — ' + f.povo : ''}`;
    fComp.textContent = Object.entries(f.comp || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
    ficha.style.display = 'block';
  }
  let alvoId = 0, pedido = 0;
  const ray = new THREE.Raycaster(), dir = new THREE.Vector3(), pos = new THREE.Vector3(), c = new THREE.Vector3();

  game.hooks.frame.push((dt) => {
    if ((game.dim || 0) !== 0) { for (const g of gente.values()) g.b.root.visible = false; ficha.style.display = 'none'; return; }
    const tq = agora() - 0.15;
    for (const g of gente.values()) {
      const f = g.fila; if (!f.length) continue;
      let a = f[0], c2 = f[f.length - 1];
      for (let i = 1; i < f.length; i++) if (f[i].t >= tq) { a = f[i - 1]; c2 = f[i]; break; }
      const k = c2.t > a.t ? Math.max(0, Math.min(1, (tq - a.t) / (c2.t - a.t))) : 1, B = g.b;
      const nx = a.p[0] + (c2.p[0] - a.p[0]) * k, nz = a.p[2] + (c2.p[2] - a.p[2]) * k, vel = Math.hypot(nx - B.root.position.x, nz - B.root.position.z) / Math.max(dt, 1e-3);
      B.root.visible = true;
      B.root.position.set(nx, a.p[1] + (c2.p[1] - a.p[1]) * k + (g.acao === 5 ? 0.25 : 0), nz);
      let dy = c2.rumo - a.rumo; dy = ((dy + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI; B.root.rotation.y = a.rumo + dy * k;
      B.root.rotation.x = g.acao === 5 ? -Math.PI / 2 : g.acao === 6 ? -0.45 : 0;        // deitado · abaixado colhendo
      g.fase += dt * (2.2 + Math.min(vel, 4) * 2.4);
      const passo = g.acao === 5 ? 0 : Math.sin(g.fase) * Math.min(0.8, vel * 0.28), t = agora();
      if (B.legL) { B.legL.rotation.x = g.acao === 6 ? 0.45 : passo; B.legR.rotation.x = g.acao === 6 ? 0.45 : -passo; }
      if (B.armL) {
        B.armR.rotation.z = 0;
        if (g.acao === 3) { B.armL.rotation.x = -1.5; B.armR.rotation.x = -1.4; B.armR.rotation.z = 0.35; }
        else if (g.acao === 4) { B.armL.rotation.x = -1.1; B.armR.rotation.x = -1.1; }
        else if (g.acao === 6) { B.armL.rotation.x = -0.9 + Math.sin(t * 3) * 0.3; B.armR.rotation.x = -0.9 - Math.sin(t * 3) * 0.3; }
        else if (g.acao === 7) { B.armL.rotation.x = -0.4; B.armR.rotation.x = -1.2 + Math.abs(Math.sin(t * 5)) * 1.0; }      // martelando
        else if (g.acao === 8) { B.armL.rotation.x = -1.0; B.armR.rotation.x = -1.0; }
        else { B.armL.rotation.x = -passo * 0.8; B.armR.rotation.x = passo * 0.8; }
      }
      if (g.item && g.papel === 'caçador') { g.item.position.set(g.acao === 3 ? -0.15 : 0, g.acao === 3 ? 1.15 : 20 * U, g.acao === 3 ? -0.45 : 0.2); g.item.rotation.set(0, g.acao === 3 ? Math.PI / 2 : 0, Math.PI / 2); }
      if (g.item && g.papel === 'pescador') g.item.rotation.x = g.acao === 8 ? -0.9 : 0.9;
      g.carne.visible = g.acao === 4;
    }
    // mira: o aldeão mais perto da linha do olhar, a até 9 m
    camera.getWorldPosition(pos); camera.getWorldDirection(dir);
    let melhor = 0, dm = 0.6;
    for (const [id, g] of gente) {
      c.copy(g.b.root.position); c.y += g.b.root.scale.y * 1.1;
      const v = c.clone().sub(pos), along = v.dot(dir); if (along < 0.5 || along > 9) continue;
      const lado = v.addScaledVector(dir, -along).length(); if (lado < dm) { dm = lado; melhor = id; }
    }
    if (melhor !== alvoId) { alvoId = melhor; if (!melhor) ficha.style.display = 'none'; else { const f = fichas.get(melhor); if (f) mostraFicha(f); } }
    if (alvoId && game.state === 'PLAYING' && agora() - pedido > 1.5) { pedido = agora(); net?.send?.({ t: 'aldeao?', id: alvoId }); }
    if (game.state !== 'PLAYING' && ficha.style.display === 'block') ficha.style.display = 'none';
  });
  const api = { get total() { return gente.size; } };
  game.povos = api;
  return api;
}
