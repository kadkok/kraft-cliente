// LAVRA — Espaço Funcional do Futebol no cliente:
// - Detecção da área jogável do campo (bloqueia quebrar/construir/ferramentas/combate e troca a barra pela Barra de 9 Skills)
// - Exceção do GM: botão/tecla G Modo GM (ligado = edição livre + Estúdio GM; desligado = regras e skills normais)
// - Física local sincronizada com spin/curva (efeito Magnus) + previsão 3D curva ao vivo (Desktop, Mobile e VR)
// - Animações corporais expressivas para todas as skills (3ª pessoa + jogadores remotos) e pose sentada na arquibancada
// - Estádio 3D (pintura HD, traves+rede deformável, refletores, bandeiras, arquibancadas sentáveis, chuteiras 3D e VFX)
// - Lobby da partida (time, tempo, gols, robôs), perfil de XP/Skins/Chuteiras e Estúdio de Personalização GM com presets
// - API do painel (`game.futebol.painel`, 19/11): o painel do PC e o menu do VR (game/menu-vr.js) leem o mesmo estado e
//   mandam as mesmas mensagens por aqui; as listas (tempos, metas, presets, ajustes do GM) moram em game/futebol-painel.js
// - Eventos para quem não vê o HTML (VR): `game.futebol.on(fn)` com fn('aviso', { texto, time }) nas faixas (lateral,
//   escanteio…) e fn('placar', { titulo, sub, time }) no GOL!/VITÓRIA!; `pertoDaBola(m)` para o gatilho do VR chutar
import * as THREE from '../three.js';
import { BOLA, passoBola } from '../../shared/bola.js';
import {
  zonaCampo, noEspaco, esferaNoEspaco, SKILLS_FUTEBOL, calcularSkillChute,
  customFutebolPadrao, FUT_SKINS, FUT_CHUTEIRAS, nivelFutebol, perfilFutebolPadrao,
} from '../../shared/espacos.js';
import {
  TEMPOS_PARTIDA, METAS_PARTIDA, ROBOS_LINHA, MSG_FUT, PRESETS_GM, presetAtivo,
  SECOES_GM, linhasDaSecao, lerCampo, gravarCampo, textoCampo,
} from './futebol-painel.js';
import { tecla } from './teclas.js';
import { buildBody } from '../render/avatars.js';
import { SOLID as SOLIDO } from '../../shared/blocks.js';
import {
  createEstadio3D, texturaBolaEstilo, materialCamisa, aplicarChuteiras3D, tirarChuteiras3D,
} from './estadio3d.js';
import { criarTorcida } from './torcida.js';   // torcida instanciada para estádio grande (19/11)

// ---- sons sintetizados: apito de juiz, torcida e chutes especiais --------------------------------------------------
function apito(ac, saida, vol = 0.32, dur = 1.15, vezes = 1) {
  for (let k = 1; k < vezes; k++) setTimeout(() => apito(ac, saida, vol, dur, 1), k * (dur * 1000 + 180));
  const t0 = ac.currentTime + 0.02;
  const g = ac.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.025); g.gain.setValueAtTime(vol, t0 + dur - 0.09); g.gain.linearRampToValueAtTime(0, t0 + dur);
  const trem = ac.createGain(); trem.gain.value = 0.55;
  const lfo = ac.createOscillator(); lfo.frequency.value = 27; const lfoG = ac.createGain(); lfoG.gain.value = 0.45; lfo.connect(lfoG).connect(trem.gain);
  for (const [fq, a] of [[3150, 0.6], [3320, 0.35], [6300, 0.08]]) { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = fq; const og = ac.createGain(); og.gain.value = a; o.connect(og).connect(trem); o.start(t0); o.stop(t0 + dur); }
  trem.connect(g).connect(saida); lfo.start(t0); lfo.stop(t0 + dur);
}
function ruido(ac, seg) { const b = ac.createBuffer(1, Math.floor(ac.sampleRate * seg), ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
function torcida(ac, saida, vol = 0.5, dur = 4.2) {
  const t0 = ac.currentTime + 0.05;
  const g = ac.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.45); g.gain.setValueAtTime(vol, t0 + dur * 0.45); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  g.connect(saida);
  const f1 = ac.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 760; f1.Q.value = 3;
  const f2 = ac.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1700; f2.Q.value = 4;
  const vozes = ac.createGain(); vozes.gain.value = 0.11; f1.connect(vozes); f2.connect(vozes); vozes.connect(g);
  for (let i = 0; i < 24; i++) {
    const o = ac.createOscillator(); o.type = 'sawtooth'; const base = 150 + Math.random() * 230;
    o.frequency.setValueAtTime(base, t0); o.frequency.linearRampToValueAtTime(base * (1.12 + Math.random() * 0.2), t0 + 0.4 + Math.random() * 0.4); o.frequency.linearRampToValueAtTime(base * 0.9, t0 + dur);
    const vib = ac.createOscillator(); vib.frequency.value = 4 + Math.random() * 3; const vg = ac.createGain(); vg.gain.value = base * 0.03; vib.connect(vg).connect(o.frequency);
    o.connect(f1); o.connect(f2); const a = t0 + Math.random() * 0.25; o.start(a); vib.start(a); o.stop(t0 + dur); vib.stop(t0 + dur);
  }
  const n = ac.createBufferSource(); n.buffer = ruido(ac, dur); const nb = ac.createBiquadFilter(); nb.type = 'bandpass'; nb.frequency.value = 900; nb.Q.value = 0.6;
  const ng = ac.createGain(); ng.gain.value = 0.35; n.connect(nb).connect(ng).connect(g); n.start(t0);
  const clap = ruido(ac, 0.05);
  for (let i = 0; i < 65; i++) {
    const s = ac.createBufferSource(); s.buffer = clap; const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const cg = ac.createGain(); const at = t0 + 0.3 + Math.random() * (dur - 0.8); cg.gain.setValueAtTime(0.25 + Math.random() * 0.2, at); cg.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    s.connect(hp).connect(cg).connect(g); s.start(at);
  }
}
function somChute(ac, saida, forte = false, vol = 0.35) {
  const t0 = ac.currentTime + 0.005;
  const o = ac.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime(forte ? 185 : 140, t0);
  o.frequency.exponentialRampToValueAtTime(38, t0 + (forte ? 0.19 : 0.11));
  const g = ac.createGain(); g.gain.setValueAtTime(vol * (forte ? 1.2 : 0.7), t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + (forte ? 0.21 : 0.13));
  o.connect(g).connect(saida); o.start(t0); o.stop(t0 + 0.23);
  if (forte) {
    const s = ac.createBufferSource(); s.buffer = ruido(ac, 0.16);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400;
    const ng = ac.createGain(); ng.gain.setValueAtTime(vol * 0.45, t0); ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    s.connect(bp).connect(ng).connect(saida); s.start(t0);
  }
}

const SKILL_SVGS = {
  passe:    'M4 17l13-10m0 0h-6m6 0v6',
  toque:    'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm0-4a3 3 0 1 0 0-6',
  drible:   'M4 18c4-1 5-6 8-6s4-5 8-6m-3-2l3 2-2 3',
  alto:     'M4 19C7 7 14 5 20 11m-4-5l4 5-5 1',
  falta:    'M4 19c2-9 9-12 16-8m-1-5l2 5-5 1M11 19v-5',
  cabeca:   'M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-5 11l3-6h4l3 6M12 10v3',
  forte:    'M13 3L4 14h6l-1 7 9-11h-6l1-7z',
  colocado: 'M4 18c8 0 13-5 15-13m-4 2l4-2 1 4',
  especial: 'M12 3l2.6 5.4 6 .8-4.3 4.2 1 6L12 16.5 6.7 19.4l1-6-4.3-4.2 6-.8L12 3z',
};

const ANIM_DUR = {
  passe: 0.34, toque: 0.26, drible: 0.42, alto: 0.42, falta: 0.50,
  cabeca: 0.38, forte: 0.48, colocado: 0.45, bicicleta: 0.72,
  voleio: 0.52, carrinho: 0.56, especial: 0.52,
};

const fmtTempo = (seg) => {
  const s = Math.max(0, Math.ceil(Number(seg) || 0));
  const m = Math.floor(s / 60), r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};
// texto do estado da partida (aba Partida do PC e seção Futebol do VR)
export function textoPartida(p) {
  return p?.estado === 'jogo' ? `Partida oficial em andamento${p.duracao ? ' · ' + fmtTempo(p.restante) : ''}`
    : p?.estado === 'fim' ? 'Partida encerrada' : 'Jogo livre — Começar para partida oficial com XP';
}

export function initBola({ game, net, scene, camera, player, ui, world, device, input, interaction, avatars, self, atmosphere, openOverlay, closeOverlay }) {
  let estiloBolaAtual = 'classica';
  const bolaMat = new THREE.MeshStandardMaterial({ map: texturaBolaEstilo('classica'), roughness: 0.42, metalness: 0.04 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(BOLA.r, 32, 20), bolaMat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.visible = false; mesh.name = 'bola';
  scene.add(mesh);

  const estadio = createEstadio3D({ scene, game });
  const get = world.getBlock;
  const st = {
    campo: null, zona: null, placar: [0, 0], lados: ['Azul', 'Vermelho'], seq: 0,
    partida: { estado: 'livre', meta: 5, duracao: 0, restante: 0, robos: { linha: 0, goleiro: false, juiz: false } },
    custom: customFutebolPadrao(),
    reposicao: null, times: {}, perfis: {},
  };
  let isGm = false, gmAtivo = false;
  let skillIdx = 0, curvaLado = 1;
  let noCampoAtivo = false, ultimoAvisoCampo = 0, ultimoAvisoBloq = 0;
  let sentadoArq = null; // { x, y, z, yaw } quando sentado na arquibancada
  let selfEstavaSentado = false;
  const cooldowns = new Map(); // skillId -> timestamp de liberação

  const meuTime = () => { const t = st.times?.[game.name]; return t === 0 || t === 1 ? t : undefined; };
  const meuPerfil = () => {
    const k = String(game.name || '').toLowerCase();
    return (k && st.perfis?.[k]) || { nome: game.name || '', ...perfilFutebolPadrao() };
  };
  const possoTocar = () => { const r = st.reposicao; return !r || r.livre || meuTime() === undefined || meuTime() === r.time; };
  const local = { p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0], parada: true, quique: 0.55 };
  const srv = { p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0], parada: true, quique: 0.55 };
  let tem = false, acc = 0, accS = 0, meuToque = -9, ultToqueEnvio = 0, comemora = { lado: -1, ate: 0 };
  const agora = () => performance.now() / 1000;
  const estaLonge = () => !st.campo || (game.dim || 0) !== 0 || Math.hypot(player.pos[0] - st.campo.centro[0], player.pos[2] - st.campo.centro[2]) > 110;
  const ouvintes = [];
  const emitir = (k, v) => { for (const f of ouvintes) { try { f(k, v); } catch (e) { console.error(e); } } };

  // ---- API do painel: o painel do PC (abaixo) e o menu do VR (game/menu-vr.js) usam só isto --------------------------
  // estado() é um retrato para desenhar; as ações mandam as mesmas mensagens `fut`/`gm` de sempre (o servidor decide).
  const painel = {
    estado() {
      const p = st.partida || {}, r = p.robos || {}, prof = meuPerfil(), c = st.custom || customFutebolPadrao();
      return {
        temCampo: !!st.campo && (game.dim || 0) === 0, perto: !estaLonge(), noCampo: noCampoAtivo,
        placar: st.placar.slice(), lados: st.lados.slice(), cores: [c.times[0].cor, c.times[1].cor],
        partida: { estado: p.estado || 'livre', meta: p.meta | 0, duracao: p.duracao || 0, restante: p.restante || 0, texto: textoPartida(p) },
        robos: { linha: r.linha | 0, goleiro: !!r.goleiro, juiz: !!r.juiz },
        meuTime: meuTime(), isGm, gmAtivo,
        perfil: { ...prof, nivel: nivelFutebol(prof.xp) },
        skill: skillIdx, curva: curvaLado, custom: c, reposicao: st.reposicao,
      };
    },
    escolherTime(t) { net.send?.(MSG_FUT.time(t)); },
    alternarPartida() { net.send?.(MSG_FUT.partida(st.partida?.estado)); },
    zerar() { net.send?.(MSG_FUT.zerar()); },
    meta(n) { net.send?.(MSG_FUT.meta(n)); },
    tempo(seg) { net.send?.(MSG_FUT.tempo(seg)); },
    robos(mudar) { net.send?.(MSG_FUT.robos(st.partida?.robos, mudar)); },
    alternarGm() { net.send?.(MSG_FUT.gm(!gmAtivo)); },
    perfil(o) { net.send?.(MSG_FUT.perfil(o)); },                       // { chuteira } ou { skin }
    rascunho() { return structuredClone(st.custom || customFutebolPadrao()); },
    aplicarPreset(id) {
      const pr = PRESETS_GM.find((x) => x.id === id);
      if (!pr) return null;
      const cfg = structuredClone(pr.cfg);
      net.send?.(MSG_FUT.custom(cfg));
      ui.toast(`👑 Preset "${pr.nome}" aplicado ao estádio!`, 2400);
      return cfg;
    },
    restaurarPadrao() { const cfg = customFutebolPadrao(); net.send?.(MSG_FUT.custom(cfg)); ui.toast('↺ Personalização restaurada para o padrão!', 2400); return cfg; },
    salvarCustom(draft) { net.send?.(MSG_FUT.custom(draft)); ui.toast('👑 Personalização do estádio aplicada!', 2600); },   // o servidor limpa (limparCustomFutebol)
  };

  // ---- HUD do Futebol: placar, botões rápidos (Partida / GM), avisos, barra de força e Barra de 9 Skills -----------
  const css = (el, o) => Object.assign(el.style, o);
  const hudBar = document.createElement('div');
  hudBar.className = 'fut-top-bar';

  const placar = document.createElement('div');
  placar.className = 'fut-placar';
  const nomeA = document.createElement('span'), nomeB = document.createElement('span'), meio = document.createElement('span'), relogioSpan = document.createElement('span');
  css(meio, { margin: '0 8px', color: '#fff' });
  css(relogioSpan, { marginLeft: '8px', color: '#fde047', fontVariantNumeric: 'tabular-nums' });
  placar.append(document.createTextNode('⚽ '), nomeA, meio, nomeB, relogioSpan);

  const mkHudBtn = (txt, fn, bg, title = '') => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = txt;
    if (title) b.title = title;
    b.style.background = bg || 'linear-gradient(180deg, rgba(32,76,46,.92), rgba(16,42,24,.9))';
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); fn(); });
    return b;
  };
  const btnPartidaHud = mkHudBtn('⚽ Partida / XP', () => abrirPainel('partida'), null, 'Painel da partida e XP (E no campo ou H)');
  const btnGmToggle = mkHudBtn('👑 GM: OFF', () => painel.alternarGm(), 'linear-gradient(180deg, rgba(70,56,24,.92), rgba(38,28,12,.9))', 'Alternar Modo GM (tecla G)');
  btnGmToggle.style.display = 'none';
  const btnGmStudio = mkHudBtn('⚙️ Estúdio GM', () => abrirPainel('gm'), 'linear-gradient(180deg, rgba(168,108,24,.94), rgba(112,62,12,.92))', 'Abrir Estúdio GM (Shift+G ou H)');
  btnGmStudio.style.display = 'none';
  hudBar.append(placar, btnPartidaHud, btnGmToggle, btnGmStudio);

  const aviso = document.createElement('div');
  aviso.className = 'fut-aviso';
  const avisoTit = document.createElement('div'), avisoSub = document.createElement('div'); css(avisoSub, { font: '700 clamp(14px, 2.4vw, 18px) system-ui, sans-serif', marginTop: '6px' });
  aviso.append(avisoTit, avisoSub);

  const barra = document.createElement('div');
  barra.className = 'fut-barra';
  const enche = document.createElement('div'); css(enche, { height: '100%', width: '0%', background: 'linear-gradient(90deg, #4ade80, #facc15 58%, #f97316)' });
  const rotulo = document.createElement('div'); css(rotulo, { position: 'absolute', inset: '0', textAlign: 'center', font: '700 11px/18px system-ui', color: '#fff', textShadow: '0 1px 2px #000' });
  barra.append(enche, rotulo);

  const faixa = document.createElement('div');
  faixa.className = 'fut-faixa';

  // ---- Barra de 9 Skills de Futebol (substitui a barra de blocos dentro do campo!) ---------------------------------
  const skillBar = document.createElement('div');
  skillBar.id = 'fut-skills';
  skillBar.className = 'fut-skillbar hide';
  const skillBtns = SKILLS_FUTEBOL.map((sk, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fskill' + (idx === 0 ? ' on' : '');
    b.title = `${sk.tecla} · ${sk.nome}: ${sk.desc}`;
    b.setAttribute('aria-label', sk.nome);
    b.style.setProperty('--sk-cor', sk.cor);
    b.innerHTML = `<i>${sk.tecla}</i><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="${SKILL_SVGS[sk.id]}"/></svg><span>${sk.curto}</span><em class="cd"></em>`;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.blur(); selectSkill(idx); });
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); selectSkill(idx); });
    skillBar.appendChild(b);
    return b;
  });

  // Botões compactos de toque dentro do campo (Usar Skill + Inverter Curva)
  const botoes = document.createElement('div');
  botoes.className = 'fut-touch-acts hide';
  const mkTouchBtn = (txt, cls) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'fut-tbtn ' + cls; b.textContent = txt;
    botoes.appendChild(b); return b;
  };
  const bExec = mkTouchBtn('Chutar', 'exec');
  const bCurva = mkTouchBtn('Curva →', 'curva');
  bExec.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); comecaAcao(); });
  bExec.addEventListener('pointerup', (e) => { e.preventDefault(); e.stopPropagation(); soltaAcao(); });
  bExec.addEventListener('pointercancel', () => cancelarAcao());
  bCurva.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); alternarCurva(); });

  document.body.append(hudBar, aviso, barra, faixa, skillBar, botoes);
  let avisoAte = 0, faixaAte = 0;

  // ---- Posicionamento sem colisão da .fut-top-bar (Desktop, iPad, Celular retrato/paisagem, F3 debug, bússola) ----
  let lastLayoutKey = '';
  function layoutHudBar(visivel) {
    const hud = ui?.el?.hud;
    if (!visivel) {
      if (lastLayoutKey !== 'off') {
        lastLayoutKey = 'off';
        hud?.style?.setProperty('--fut-top-bot', '0px');
        document.documentElement.style.setProperty('--fut-top-bot', '0px');
      }
      return;
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    const compact = vw < 980 || vh < 520 || !!hud?.classList?.contains('celular');
    const bus = document.getElementById('bussola');
    const bRect = bus && bus.style.display !== 'none' ? bus.getBoundingClientRect() : null;
    const dEl = ui?.el?.debug;
    const dRect = dEl && !dEl.classList.contains('hide') ? dEl.getBoundingClientRect() : null;
    const cEl = ui?.el?.corner;
    const cRect = cEl && !hud?.classList?.contains('hide') ? cEl.getBoundingClientRect() : null;
    const busBotRaw = hud ? parseFloat(hud.style.getPropertyValue('--bussola-bot')) || 0 : 0;
    const key = [
      vw, vh, compact ? 1 : 0, gmAtivo ? 1 : 0, isGm ? 1 : 0,
      bRect ? `${Math.round(bRect.left)},${Math.round(bRect.bottom)}` : '0',
      Math.round(busBotRaw),
      dRect ? Math.round(dRect.bottom) : 0,
      cRect ? `${Math.round(cRect.left)},${Math.round(cRect.bottom)}` : '0',
    ].join('|');
    if (key === lastLayoutKey) return;
    lastLayoutKey = key;

    if (compact) {
      let topPx = 8;
      if (bRect && bRect.height > 0) topPx = Math.max(topPx, busBotRaw > 0 ? busBotRaw + 2 : bRect.bottom + 4);
      if (cRect && cRect.height > 0 && vw < 680) topPx = Math.max(topPx, cRect.bottom + 4);
      if (dRect && dRect.height > 0) topPx = Math.max(topPx, dRect.bottom + 6);
      hudBar.style.left = 'calc(8px + var(--safe-l, 0px))';
      hudBar.style.top = Math.round(topPx) + 'px';
      hudBar.style.maxWidth = 'calc(100vw - 16px - var(--safe-l, 0px) - var(--safe-r, 0px))';
      const barRect = hudBar.getBoundingClientRect();
      const botVal = Math.round(Math.max(topPx + 32, barRect.bottom) + 4) + 'px';
      hud?.style?.setProperty('--fut-top-bot', botVal);
      document.documentElement.style.setProperty('--fut-top-bot', botVal);
    } else {
      let topPx = 12;
      if (dRect && dRect.height > 0) topPx = Math.max(topPx, Math.round(dRect.bottom + 8));
      let maxW = Math.max(260, vw - 24);
      if (bRect && bRect.height > 0 && topPx < bRect.bottom + 24) {
        maxW = Math.max(220, Math.floor(bRect.left - 22));
      } else if (cRect && cRect.height > 0 && topPx < cRect.bottom + 16) {
        maxW = Math.max(260, Math.floor(cRect.left - 22));
      }
      hudBar.style.left = 'calc(12px + var(--safe-l, 0px))';
      hudBar.style.top = topPx + 'px';
      hudBar.style.maxWidth = maxW + 'px';
      hud?.style?.setProperty('--fut-top-bot', '0px');
      document.documentElement.style.setProperty('--fut-top-bot', '0px');
    }
  }

  function aviso2(txt, time) {
    faixa.textContent = txt; faixaAte = performance.now() + 2600; faixa.style.display = 'block';
    const c0 = st.custom.times[0].cor, c1 = st.custom.times[1].cor;
    faixa.style.background = time === 0 ? c0 : time === 1 ? c1 : 'linear-gradient(180deg, rgba(30,36,44,.94), rgba(12,16,22,.88))';
    emitir('aviso', { texto: txt, time, cor: time === 0 ? c0 : time === 1 ? c1 : null });
  }

  function selectSkill(i) {
    skillIdx = ((i % SKILLS_FUTEBOL.length) + SKILLS_FUTEBOL.length) % SKILLS_FUTEBOL.length;
    skillBtns.forEach((b, k) => b.classList.toggle('on', k === skillIdx));
    const sk = SKILLS_FUTEBOL[skillIdx];
    bExec.textContent = sk.curto;
    game.audio?.play?.('tick', 0.85, 0.95 + skillIdx * 0.03);
  }
  function alternarCurva() {
    curvaLado = -curvaLado;
    bCurva.textContent = curvaLado > 0 ? 'Curva →' : 'Curva ←';
    ui.toast(`Curva do chute: ${curvaLado > 0 ? 'para a Direita →' : 'para a Esquerda ←'}`, 1600);
  }

  // ---- Modal unificado K14 (fluido, rolagem interna, maximizável): Partida / Perfil XP & Skins / Estúdio GM --------
  const modal = document.createElement('div');
  modal.id = 'fut-modal';
  modal.className = 'screen veil hide';
  const modalCard = document.createElement('div');
  modalCard.className = 'card panel fut-card';
  modal.appendChild(modalCard);
  modal.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === modal) fecharPainel(); });
  modal.addEventListener('mousedown', (e) => e.stopPropagation());
  document.body.appendChild(modal);

  let abaModal = 'partida';
  let gmDraft = null;
  let modalMax = false;
  let modalTitEl = null;

  function abrirPainel(aba = 'partida') {
    abaModal = aba === 'gm' && (!isGm || !gmAtivo) ? 'partida' : aba;
    gmDraft = painel.rascunho();
    openOverlay?.('futebol');
    modal.classList.remove('hide');
    renderModal(true);
  }
  function fecharPainel() {
    if (modal.classList.contains('hide')) return;
    modal.classList.add('hide');
    gmDraft = null;
    if (game.overlay === 'futebol') closeOverlay?.();
    if (game.state === 'PLAYING') document.getElementById('c')?.focus?.();
  }
  game.hooks.other.push((m) => {
    if (m.t === 'overlay-closed' && m.was === 'futebol') { modal.classList.add('hide'); gmDraft = null; }
  });

  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  };

  function toggleModalMax() {
    modalMax = !modalMax;
    modalCard.classList.toggle('max', modalMax);
    if (!modalMax) { modalCard.style.width = ''; modalCard.style.height = ''; }
    renderModal(true);
  }

  function renderModal(forcar = false) {
    if (modal.classList.contains('hide')) return;
    if (abaModal === 'gm' && (!isGm || !gmAtivo)) abaModal = 'partida';
    const placarTit = `⚽ ${st.lados[0]} ${st.placar[0]} × ${st.placar[1]} ${st.lados[1]}`;
    // Evita perder foco de inputs/sliders enquanto o GM edita e chega atualização de rede
    if (!forcar && abaModal === 'gm' && modal.contains(document.activeElement)) {
      if (modalTitEl) modalTitEl.textContent = placarTit;
      return;
    }

    const p = st.partida || {}, r = p.robos || {}, prof = meuPerfil();
    const nv = nivelFutebol(prof.xp);
    const tabs = el('div', { class: 'tabs fut-modal-tabs' },
      el('button', { class: 'btn small' + (abaModal === 'partida' ? ' on' : ''), type: 'button', text: '⚽ Partida', onclick: () => { abaModal = 'partida'; renderModal(true); } }),
      el('button', { class: 'btn small' + (abaModal === 'perfil' ? ' on' : ''), type: 'button', text: `⭐ XP (${prof.xp}) & Skins`, onclick: () => { abaModal = 'perfil'; renderModal(true); } }),
      isGm && gmAtivo ? el('button', { class: 'btn small' + (abaModal === 'gm' ? ' on' : ''), type: 'button', text: '👑 Estúdio GM', onclick: () => { abaModal = 'gm'; gmDraft = painel.rascunho(); renderModal(true); } }) : null,
    );
    modalTitEl = el('h2', { text: placarTit });
    const header = el('div', { class: 'fut-modal-head', ondblclick: toggleModalMax },
      modalTitEl,
      el('button', { class: 'btn small', type: 'button', title: modalMax ? 'Restaurar tamanho' : 'Maximizar painel', 'aria-label': modalMax ? 'Restaurar tamanho' : 'Maximizar painel', text: modalMax ? '🗗' : '⬜', onclick: toggleModalMax }),
      el('button', { class: 'btn small', type: 'button', text: 'Fechar', onclick: fecharPainel }),
    );
    const body = el('div', { class: 'fut-modal-body' });
    let footer = null;

    if (abaModal === 'partida') {
      const t = meuTime();
      body.append(
        el('div', { class: 'note', text: textoPartida(p) }),
        el('div', { class: 'fut-section' },
          el('h3', { text: 'Escolher Time' }),
          el('div', { class: 'tri' },
            el('button', { class: 'btn small' + (t === 0 ? ' on' : ''), type: 'button', text: st.lados[0], onclick: () => painel.escolherTime(0) }),
            el('button', { class: 'btn small' + (t === 1 ? ' on' : ''), type: 'button', text: st.lados[1], onclick: () => painel.escolherTime(1) }),
            el('button', { class: 'btn small' + (t === undefined ? ' on' : ''), type: 'button', text: 'Livre', onclick: () => painel.escolherTime(-1) }),
          ),
        ),
        isGm ? null : el('div', { class: 'note', text: '👑 Só o GM começa, encerra e configura partidas (tempo, gols, placar e robôs).' }),
        !isGm ? null : el('div', { class: 'fut-section' },
          el('h3', { text: 'Tempo de Jogo' }),
          el('div', { class: 'row' }, ...TEMPOS_PARTIDA.map(([seg, lbl]) =>
            el('button', { class: 'btn small' + ((p.duracao || 0) === seg ? ' on' : ''), type: 'button', text: lbl, onclick: () => painel.tempo(seg) }),
          )),
          el('h3', { text: 'Gols para Vencer' }),
          el('div', { class: 'row' }, ...METAS_PARTIDA.map(([n, lbl]) =>
            el('button', { class: 'btn small' + ((p.meta | 0) === n ? ' on' : ''), type: 'button', text: lbl, onclick: () => painel.meta(n) }),
          )),
        ),
        !isGm ? null : el('div', { class: 'fut-section' },
          el('h3', { text: 'NPCs / Robôs por Time' }),
          el('div', { class: 'row' }, ...ROBOS_LINHA.map((n) =>
            el('button', { class: 'btn small' + ((r.linha | 0) === n ? ' on' : ''), type: 'button', text: `${n} linha`, onclick: () => painel.robos({ linha: n }) }),
          )),
          el('div', { class: 'row' },
            el('button', { class: 'btn small' + (r.goleiro ? ' on' : ''), type: 'button', text: 'Goleiros', onclick: () => painel.robos({ goleiro: !r.goleiro }) }),
            el('button', { class: 'btn small' + (r.juiz ? ' on' : ''), type: 'button', text: 'Juiz', onclick: () => painel.robos({ juiz: !r.juiz }) }),
          ),
        ),
        isGm ? el('div', { class: 'row' },
          el('button', { class: 'btn small' + (gmAtivo ? ' on' : ''), type: 'button', text: gmAtivo ? '👑 Modo GM: LIGADO (clique ou G p/ jogar normal)' : '👑 Modo GM: DESLIGADO (clique ou G p/ editar campo)', onclick: () => painel.alternarGm() }),
        ) : null,
      );
      footer = isGm ? el('div', { class: 'fut-modal-footer' },
        el('button', { class: 'btn primary', type: 'button', text: p.estado === 'jogo' ? 'Encerrar Partida' : 'Começar Partida Oficial', onclick: () => { painel.alternarPartida(); fecharPainel(); } }),
        el('button', { class: 'btn small', type: 'button', text: 'Zerar Placar', onclick: () => painel.zerar() }),
      ) : null;
    } else if (abaModal === 'perfil') {
      body.append(
        el('div', { class: 'fut-xp-box' },
          el('strong', { text: `⭐ Nível ${nv} · ${prof.xp} XP de Futebol` }),
          el('div', { class: 'note', text: `Gols oficiais: ${prof.gols} · Vitórias: ${prof.vitorias} · Partidas: ${prof.partidas}` }),
          el('div', { class: 'note', text: 'Ganhe XP marcando gols (+25 XP, +10 bônus em chute especial) e vencendo (+100 XP) em partidas oficiais contra time adversário ativo.' }),
        ),
        el('div', { class: 'fut-section' },
          el('h3', { text: 'Chuteiras 3D (todos os jogadores usam)' }),
          el('div', { class: 'fut-grid2' }, ...FUT_CHUTEIRAS.map((ch) => {
            const ok = prof.xp >= ch.xp, on = prof.chuteira === ch.id;
            return el('button', {
              class: 'btn small' + (on ? ' on' : ''), type: 'button',
              text: `${ch.nome}${ok ? (on ? ' ✓' : '') : ` (${ch.xp} XP)`}`,
              onclick: () => painel.perfil({ chuteira: ch.id }),
            });
          })),
        ),
        el('div', { class: 'fut-section' },
          el('h3', { text: 'Skins Especiais de Futebol' }),
          el('div', { class: 'fut-grid2' }, ...FUT_SKINS.map((sk) => {
            const ok = prof.xp >= sk.xp, on = prof.skin === sk.id;
            return el('button', {
              class: 'btn small' + (on ? ' on' : ''), type: 'button', title: sk.desc,
              text: `${sk.nome}${ok ? (on ? ' ✓' : '') : ` (${sk.xp} XP)`}`,
              onclick: () => painel.perfil({ skin: sk.id }),
            });
          })),
        ),
      );
    } else if (abaModal === 'gm' && isGm && gmAtivo) {
      if (!gmDraft) gmDraft = painel.rascunho();
      const draft = gmDraft;
      // cada ajuste vem de CAMPOS_GM (game/futebol-painel.js), a mesma lista do menu do VR
      const widget = (c) => {
        const v = lerCampo(draft, c), muda = (x) => gravarCampo(draft, c, x);
        if (c.tipo === 'texto') {
          const inp = el('input', { type: 'text', value: v, maxlength: String(c.max || 20) });
          inp.addEventListener('keydown', (e) => e.stopPropagation());
          inp.addEventListener('keyup', (e) => e.stopPropagation());
          inp.addEventListener('input', () => muda(inp.value));
          return el('label', { class: 'field' }, el('span', { text: c.rotulo }), inp);
        }
        if (c.tipo === 'cor') {
          const inp = el('input', { type: 'color', value: v });
          inp.addEventListener('input', () => muda(inp.value));
          return el('label', { class: 'btn small colorbtn' }, c.rotulo + ' ', inp);
        }
        if (c.tipo === 'opcao') {
          const s = el('select', {}, ...c.opcoes.map((o) => {
            const op = el('option', { value: o, text: o });
            if (o === v) op.selected = true;
            return op;
          }));
          s.addEventListener('change', () => muda(s.value));
          return el('label', { class: 'field' }, el('span', { text: c.rotulo }), s);
        }
        if (c.tipo === 'faixa') {
          const out = el('output', { text: textoCampo(c, v) });
          const inp = el('input', { type: 'range', min: String(c.min), max: String(c.max), step: String(c.passo), value: String(v) });
          inp.addEventListener('input', () => { const n = Number(inp.value); out.textContent = textoCampo(c, n); muda(n); });
          return el('div', { class: 'set' }, el('span', { text: c.rotulo }), out, inp);
        }
        const inp = el('input', { type: 'checkbox' });                 // 'liga'
        inp.checked = !!v;
        inp.addEventListener('change', () => muda(inp.checked));
        return el('label', { class: 'toggle' }, el('span', { text: c.rotulo }), inp);
      };
      const aplicarPreset = (pr) => { const cfg = painel.aplicarPreset(pr.id); if (cfg) gmDraft = cfg; renderModal(true); };
      const restaurarPadrao = () => { gmDraft = painel.restaurarPadrao(); renderModal(true); };

      body.append(
        el('div', { class: 'fut-section' },
          el('h3', { text: 'Presets Rápidos (1 clique — aplica ao vivo)' }),
          el('div', { class: 'fut-presets' }, ...PRESETS_GM.map((pr) => el('button', {
            class: 'btn small fut-preset-btn' + (presetAtivo(draft, pr) ? ' on' : ''), type: 'button',
            'data-preset': pr.id,
            onclick: () => aplicarPreset(pr),
          },
          el('i', { class: 'fut-swatch', style: `background:${pr.cfg.times[0].cor}` }),
          el('i', { class: 'fut-swatch', style: `background:${pr.cfg.times[1].cor}` }),
          el('span', { text: pr.nome })))),
        ),
        ...SECOES_GM.map((sec) => el('div', { class: 'fut-section' },
          el('h3', { text: sec.titulo(draft) }),
          ...linhasDaSecao(sec.id).map((linha) => (linha.length > 1 ? el('div', { class: 'row' }, ...linha.map(widget)) : widget(linha[0]))),
        )),
      );
      footer = el('div', { class: 'fut-modal-footer' },
        el('button', { class: 'btn small', type: 'button', text: 'Restaurar padrão', onclick: restaurarPadrao }),
        el('button', { class: 'btn primary', type: 'button', text: 'Salvar e Aplicar no Estádio', onclick: () => { painel.salvarCustom(draft); fecharPainel(); } }),
      );
    }

    modalCard.replaceChildren(...[header, tabs, body, footer].filter(Boolean));
  }

  // ---- Animações corporais de skills (3ª pessoa local `self` e jogadores remotos `avatars`) ------------------------
  const animAtivas = new WeakMap(); // body -> { tipo, t, dur, curva }
  const animCorpos = new Set();

  function getRootBone(body) {
    return body?.root?.getObjectByName?.('root') || null;
  }
  function resetarPoseExtra(body) {
    if (!body) return;
    const rb = getRootBone(body);
    if (rb) { rb.rotation.set(0, 0, 0); rb.position.set(0, 0, 0); }
    if (body.head) { body.head.rotation.y = 0; body.head.rotation.z = 0; }
    if (body.armL) body.armL.rotation.z = 0;
    if (body.armR) body.armR.rotation.z = 0;
    if (body.legL) body.legL.rotation.z = 0;
    if (body.legR) body.legR.rotation.z = 0;
    if (body.elbowL) body.elbowL.rotation.x = 0.08;
    if (body.elbowR) body.elbowR.rotation.x = 0.08;
    if (body.kneeL) body.kneeL.rotation.x = 0;
    if (body.kneeR) body.kneeR.rotation.x = 0;
  }
  function dispararAnimSkill(body, tipo = 'passe', curva = 1) {
    if (!body) return;
    const id = ANIM_DUR[tipo] ? tipo : 'passe';
    animAtivas.set(body, { tipo: id, t: 0, dur: ANIM_DUR[id], curva: curva < 0 ? -1 : 1 });
    animCorpos.add(body);
  }
  function aplicarPoseSkill(body, anim) {
    const u = Math.max(0, Math.min(1, anim.t / anim.dur));
    const rb = getRootBone(body);
    const lado = anim.curva || 1;
    // Curva rápida de ataque e retorno suave: pico em ~0.42
    const pico = u < 0.35 ? Math.sin((u / 0.35) * (Math.PI / 2)) : Math.cos(((u - 0.35) / 0.65) * (Math.PI / 2));
    // Balanço clássico de chute: puxa perna para trás (-), depois chicoteia para frente (+)
    const chuteWave = (back, fwd) => (u < 0.28
      ? -back * Math.sin((u / 0.28) * (Math.PI / 2))
      : u < 0.56
        ? -back + (back + fwd) * Math.sin(((u - 0.28) / 0.28) * (Math.PI / 2))
        : fwd * Math.cos(((u - 0.56) / 0.44) * (Math.PI / 2)));

    if (rb) { rb.rotation.set(0, 0, 0); rb.position.set(0, 0, 0); }
    if (body.armL) body.armL.rotation.z = 0;
    if (body.armR) body.armR.rotation.z = 0;
    if (body.legL) body.legL.rotation.z = 0;
    if (body.legR) body.legR.rotation.z = 0;

    switch (anim.tipo) {
      case 'passe': {
        const w = chuteWave(0.55, 1.15);
        if (body.legR) { body.legR.rotation.x = w; body.legR.rotation.z = 0.22 * pico; }
        if (body.kneeR) body.kneeR.rotation.x = w < 0 ? w * 0.55 : -0.1 * pico;
        if (body.legL) body.legL.rotation.x = -0.22 * pico;
        if (body.kneeL) body.kneeL.rotation.x = -0.25 * pico;
        if (body.armL) { body.armL.rotation.x = 0.65 * pico; body.armL.rotation.z = -0.28 * pico; }
        if (body.armR) { body.armR.rotation.x = -0.45 * pico; body.armR.rotation.z = 0.24 * pico; }
        if (rb) rb.rotation.x = -0.1 * pico;
        break;
      }
      case 'toque': {
        const w = chuteWave(0.25, 0.7);
        if (body.legR) body.legR.rotation.x = w;
        if (body.kneeR) body.kneeR.rotation.x = -0.35 * pico;
        if (body.armL) body.armL.rotation.z = -0.26 * pico;
        if (body.armR) body.armR.rotation.z = 0.26 * pico;
        break;
      }
      case 'drible': {
        const s2 = Math.sin(u * Math.PI * 2);
        if (rb) { rb.rotation.z = -lado * 0.34 * pico; rb.rotation.y = lado * 0.3 * pico; rb.position.y = -0.08 * pico; }
        if (body.legL) body.legL.rotation.x = 0.65 * s2;
        if (body.legR) body.legR.rotation.x = -0.65 * s2;
        if (body.kneeL) body.kneeL.rotation.x = -0.45 * pico;
        if (body.kneeR) body.kneeR.rotation.x = -0.45 * pico;
        if (body.armL) { body.armL.rotation.z = -0.58 * pico; body.armL.rotation.x = -0.3 * s2; }
        if (body.armR) { body.armR.rotation.z = 0.58 * pico; body.armR.rotation.x = 0.3 * s2; }
        break;
      }
      case 'alto': {
        const w = chuteWave(0.75, 1.38);
        if (body.legR) body.legR.rotation.x = w;
        if (body.kneeR) body.kneeR.rotation.x = w < 0 ? w * 0.65 : 0;
        if (body.legL) body.legL.rotation.x = -0.28 * pico;
        if (body.armL) { body.armL.rotation.x = 0.85 * pico; body.armL.rotation.z = -0.45 * pico; }
        if (body.armR) { body.armR.rotation.x = -0.55 * pico; body.armR.rotation.z = 0.45 * pico; }
        if (rb) rb.rotation.x = -0.26 * pico;
        break;
      }
      case 'falta':
      case 'colocado': {
        const forte = anim.tipo === 'falta';
        const w = chuteWave(forte ? 0.98 : 0.82, forte ? 1.48 : 1.36);
        if (rb) { rb.rotation.z = lado * (forte ? 0.34 : 0.3) * pico; rb.rotation.y = -lado * 0.28 * pico; rb.rotation.x = -0.18 * pico; }
        if (body.legR) { body.legR.rotation.x = w; body.legR.rotation.z = -lado * 0.36 * pico; }
        if (body.kneeR) body.kneeR.rotation.x = w < 0 ? w * 0.72 : -0.06;
        if (body.legL) body.legL.rotation.x = -0.26 * pico;
        if (body.armL) { body.armL.rotation.x = 0.8 * pico; body.armL.rotation.z = -0.78 * pico; }
        if (body.armR) { body.armR.rotation.x = -0.5 * pico; body.armR.rotation.z = 0.55 * pico; }
        break;
      }
      case 'cabeca': {
        const snap = u < 0.32 ? -Math.sin((u / 0.32) * (Math.PI / 2)) * 0.55 : Math.sin(((u - 0.32) / 0.68) * Math.PI);
        if (rb) { rb.rotation.x = snap * 0.44; rb.position.y = Math.sin(u * Math.PI) * 0.18; }
        if (body.head) body.head.rotation.x = -snap * 0.78;
        if (body.armL) { body.armL.rotation.x = -0.82 * pico; body.armL.rotation.z = -0.35 * pico; }
        if (body.armR) { body.armR.rotation.x = -0.82 * pico; body.armR.rotation.z = 0.35 * pico; }
        if (body.kneeL) body.kneeL.rotation.x = -0.35 * pico;
        if (body.kneeR) body.kneeR.rotation.x = -0.35 * pico;
        break;
      }
      case 'forte': {
        const w = chuteWave(1.18, 1.68);
        if (rb) { rb.rotation.x = -0.28 * pico; rb.rotation.y = (u < 0.32 ? -0.32 : 0.38) * pico; }
        if (body.legR) body.legR.rotation.x = w;
        if (body.kneeR) body.kneeR.rotation.x = w < 0 ? w * 0.78 : 0;
        if (body.legL) body.legL.rotation.x = -0.36 * pico;
        if (body.kneeL) body.kneeL.rotation.x = -0.3 * pico;
        if (body.armL) { body.armL.rotation.x = 1.05 * pico; body.armL.rotation.z = -0.65 * pico; }
        if (body.armR) { body.armR.rotation.x = -0.85 * pico; body.armR.rotation.z = 0.65 * pico; }
        break;
      }
      case 'bicicleta': {
        // Giro acrobático invertido em torno do centro de massa (y=0.9) sem afundar no chão
        const inv = Math.sin(u * Math.PI);
        const ang = -inv * (Math.PI * 1.12);
        const lift = inv * 0.56;
        if (rb) {
          rb.rotation.x = ang;
          rb.rotation.z = lado * 0.18 * inv;
          rb.position.set(0, 0.9 * (1 - Math.cos(ang)) + lift, -0.9 * Math.sin(ang));
        }
        const tesoura = Math.sin(u * Math.PI * 1.45);
        if (body.legR) body.legR.rotation.x = 1.55 * Math.max(0, tesoura);
        if (body.legL) body.legL.rotation.x = 1.15 * inv - 0.85 * Math.max(0, tesoura);
        if (body.kneeL) body.kneeL.rotation.x = -0.55 * inv;
        if (body.kneeR) body.kneeR.rotation.x = -0.15 * inv;
        if (body.armL) { body.armL.rotation.z = -0.95 * inv; body.armL.rotation.x = -0.4 * inv; }
        if (body.armR) { body.armR.rotation.z = 0.95 * inv; body.armR.rotation.x = -0.4 * inv; }
        break;
      }
      case 'voleio':
      case 'especial': {
        const w = chuteWave(0.72, 1.58);
        const ar = Math.sin(u * Math.PI);
        if (rb) { rb.rotation.z = lado * 0.68 * ar; rb.rotation.x = -0.18 * ar; rb.position.y = ar * 0.34; }
        if (body.legR) { body.legR.rotation.x = w; body.legR.rotation.z = -lado * 0.45 * ar; }
        if (body.legL) body.legL.rotation.x = -0.42 * ar;
        if (body.kneeL) body.kneeL.rotation.x = -0.55 * ar;
        if (body.armL) { body.armL.rotation.z = -0.85 * ar; body.armL.rotation.x = 0.45 * ar; }
        if (body.armR) { body.armR.rotation.z = 0.85 * ar; body.armR.rotation.x = -0.45 * ar; }
        break;
      }
      case 'carrinho': {
        // Inclinação rente ao gramado com perna estendida no desarme
        const slide = u < 0.2 ? u / 0.2 : u < 0.72 ? 1 : (1 - u) / 0.28;
        if (rb) {
          rb.rotation.x = -1.16 * slide;
          rb.rotation.z = lado * 0.26 * slide;
          rb.position.set(0, -0.56 * slide, 0.22 * slide);
        }
        if (body.legR) body.legR.rotation.x = 1.38 * slide;
        if (body.kneeR) body.kneeR.rotation.x = 0;
        if (body.legL) body.legL.rotation.x = 0.42 * slide;
        if (body.kneeL) body.kneeL.rotation.x = -1.18 * slide;
        if (body.armL) { body.armL.rotation.x = -0.95 * slide; body.armL.rotation.z = -0.45 * slide; }
        if (body.armR) { body.armR.rotation.x = 0.55 * slide; body.armR.rotation.z = 0.75 * slide; }
        break;
      }
    }
  }
  function atualizarAnimacoesCorpo(dt) {
    // Pose sentada na arquibancada em 3ª pessoa
    if (sentadoArq && self?.root?.visible) {
      selfEstavaSentado = true;
      const rb = getRootBone(self);
      if (rb) { rb.rotation.set(0, 0, 0); rb.position.set(0, -0.32, 0.08); }
      if (self.legL) self.legL.rotation.x = 1.38;
      if (self.legR) self.legR.rotation.x = 1.38;
      if (self.kneeL) self.kneeL.rotation.x = -1.28;
      if (self.kneeR) self.kneeR.rotation.x = -1.28;
      if (self.armL) { self.armL.rotation.x = 0.35; self.armL.rotation.z = -0.14; }
      if (self.armR) { self.armR.rotation.x = 0.35; self.armR.rotation.z = 0.14; }
    } else if (selfEstavaSentado) {
      selfEstavaSentado = false;
      resetarPoseExtra(self);
    }

    for (const body of [...animCorpos]) {
      const a = animAtivas.get(body);
      if (!a) { animCorpos.delete(body); continue; }
      a.t += dt;
      if (a.t >= a.dur) {
        animAtivas.delete(body);
        animCorpos.delete(body);
        resetarPoseExtra(body);
        continue;
      }
      if (body.root?.visible) aplicarPoseSkill(body, a);
    }
  }

  // ---- robôs (jogadores, goleiros, juiz) com camisas personalizadas e chuteiras 3D ---------------------------------
  const GEO_CAMISA = new THREE.BoxGeometry(0.49, 0.62, 0.26);
  const robos = new Map();
  function estiloCamisaRobo(time, papel) {
    const cfg = st.custom || customFutebolPadrao();
    if (papel === 2) return materialCamisa(cfg.juiz.cor, '#ffffff', 'liso');
    if (papel === 1) return materialCamisa(time === 0 ? cfg.goleiro.corA : cfg.goleiro.corB, '#18181b', 'faixa');
    const t = cfg.times[time === 1 ? 1 : 0];
    return materialCamisa(t.cor, t.cor2, t.padrao);
  }
  function atualizarUniformesRobos() {
    for (const r of robos.values()) {
      if (r.camisa) r.camisa.material = estiloCamisaRobo(r.time, r.papel);
    }
  }
  function limparRobos() {
    for (const r of robos.values()) { scene.remove(r.b.root); r.b.dispose?.(); }
    robos.clear();
  }
  function recebeRobos(lista) {
    const vistos = new Set(), t = agora();
    for (const n of lista || []) {
      const [id, time, papel, x, y, z, rumo, acao, vel] = n; vistos.add(id);
      let r = robos.get(id);
      if (!r) {
        const b = buildBody();
        const camisa = new THREE.Mesh(GEO_CAMISA, estiloCamisaRobo(time, papel));
        camisa.position.y = (18 / 32) * 1.8; camisa.castShadow = game.plataforma === 'pc';
        (b.root.getObjectByName('root') || b.root).add(camisa);
        aplicarChuteiras3D(b, papel === 1 ? 'ouro' : 'classica');
        scene.add(b.root);
        r = { b, camisa, time, papel, fila: [], fase: Math.random() * 6 };
        robos.set(id, r);
      }
      r.fila.push({ t, p: [x / 100, y / 100, z / 100], rumo: rumo / 100 }); if (r.fila.length > 5) r.fila.shift();
      r.acao = acao; r.vel = vel / 10; r.papel = papel; r.time = time;
    }
    for (const [id, r] of robos) if (!vistos.has(id)) { scene.remove(r.b.root); r.b.dispose?.(); robos.delete(id); }
  }
  function animaRobos(dt) {
    const tq = agora() - 0.12;
    for (const r of robos.values()) {
      const f = r.fila; if (!f.length) continue;
      let a = f[0], b2 = f[f.length - 1];
      for (let i = 1; i < f.length; i++) if (f[i].t >= tq) { a = f[i - 1]; b2 = f[i]; break; }
      const k = b2.t > a.t ? Math.max(0, Math.min(1, (tq - a.t) / (b2.t - a.t))) : 1, B = r.b;
      B.root.position.set(a.p[0] + (b2.p[0] - a.p[0]) * k, a.p[1] + (b2.p[1] - a.p[1]) * k, a.p[2] + (b2.p[2] - a.p[2]) * k);
      let dy = b2.rumo - a.rumo; dy = ((dy + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI; B.root.rotation.y = a.rumo + dy * k;
      r.fase += dt * (2 + r.vel * 2.2);
      const passo = Math.sin(r.fase) * Math.min(0.9, r.vel * 0.18);
      if (B.legL) { B.legL.rotation.x = passo; B.legR.rotation.x = r.acao === 1 ? 1.3 : -passo; }
      if (B.armL) { B.armL.rotation.x = -passo * 0.8; B.armR.rotation.x = passo * 0.8; B.armL.rotation.z = 0; B.armR.rotation.z = 0; }
      if (r.papel === 2 && B.armR && r.acao === 0) B.armR.rotation.x = passo * 0.8;
      B.root.rotation.z = r.acao === 2 ? (r.fase % 2 > 1 ? 1.1 : -1.1) : 0;
      if (r.papel === 1 && B.armL && r.acao !== 2) { B.armL.rotation.z = -0.4; B.armR.rotation.z = 0.4; }
    }
  }

  // ---- Uniforme de futebol (chuteira 3D + camisa do time/skin) nos jogadores humanos (próprio + remotos) -----------
  // Só dentro do campo (pedidos do Kadmus, 19/11: primeiro a chuteira, depois a camisa): veste ao entrar na zona do
  // campo (a mesma do espaço funcional, `zonaCampo`, no plano 0) e tira ao passar 1 m além dela (folga para não piscar
  // quem anda na linha). Conferido a cada 0,25 s no laço e em toda mudança de time, perfil ou cores (`recebeEstado`).
  // Os robôs da partida vivem no campo e seguem uniformizados; a torcida veste a camisa do time na arquibancada.
  const FOLGA_CAMPO = 1;
  function vestirUniforme(body, nome, pos) {
    if (!body) return;
    const zona = st.campo && st.zona && (game.dim || 0) === 0 ? st.zona : null;
    const dentro = !!(zona && pos && esferaNoEspaco(zona, pos, body._noCampo ? FOLGA_CAMPO : 0));
    body._noCampo = dentro;
    if (!dentro) {
      tirarChuteiras3D(body);
      if (body._camisaFut) body._camisaFut.visible = false;
      return;
    }
    const prof = st.perfis?.[String(nome || '').toLowerCase()] || perfilFutebolPadrao();
    aplicarChuteiras3D(body, prof.chuteira || 'classica');
    const time = nome ? st.times?.[nome] : undefined;
    const querCamisa = time === 0 || time === 1 || (prof.skin && prof.skin !== 'uniforme');
    if (!querCamisa) { if (body._camisaFut) body._camisaFut.visible = false; return; }
    const cfg = (st.custom || customFutebolPadrao()).times[time === 1 ? 1 : 0];
    const mat = materialCamisa(cfg.cor, cfg.cor2, cfg.padrao, prof.skin || 'uniforme');
    if (!body._camisaFut) {
      const cm = new THREE.Mesh(GEO_CAMISA, mat);
      cm.name = 'camisa-futebol';
      cm.position.y = (18 / 32) * 1.8;
      cm.castShadow = game.plataforma === 'pc';
      (body.root.getObjectByName('root') || body.root).add(cm);
      body._camisaFut = cm;
    } else if (body._camisaFut.material !== mat) body._camisaFut.material = mat;
    body._camisaFut.visible = true;
  }
  function sincronizarAvatares() {
    const corpos = [[self, game.name, player.pos]];
    if (avatars?.list) for (const a of avatars.list.values()) corpos.push([a.body, a.name, a.pos]);
    for (const [body, nome, pos] of corpos) {
      if (!body) continue;
      if (st.campo) { vestirUniforme(body, nome, pos); continue; }
      // campo apagado: tira o uniforme e solta a malha da camisa
      tirarChuteiras3D(body); body._noCampo = false;
      if (body._camisaFut) { body._camisaFut.parent?.remove(body._camisaFut); body._camisaFut = null; }
    }
  }

  // ---- Percurso previsto 3D com curva Magnus real (pontos + linha contínua para nitidez máxima em Desktop e VR) ----
  const MAXP = 150, pts = new Float32Array(MAXP * 3);
  const geoP = new THREE.BufferGeometry(); geoP.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const pontosMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, transparent: true, opacity: 0.92, depthWrite: false });
  const pontos = new THREE.Points(geoP, pontosMat);
  pontos.frustumCulled = false; pontos.visible = false; scene.add(pontos);
  const linhaMat = new THREE.LineBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.78, depthWrite: false });
  const curvaLinha = new THREE.Line(geoP, linhaMat);
  curvaLinha.frustumCulled = false; curvaLinha.visible = false; scene.add(curvaLinha);
  const anelMat = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
  const anel = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 28), anelMat);
  anel.rotation.x = -Math.PI / 2; anel.visible = false; scene.add(anel);

  function esconderPrevia() {
    barra.style.display = 'none';
    pontos.visible = curvaLinha.visible = anel.visible = false;
  }
  function preve(v0, w0, cor = '#ffe27a') {
    const b = { p: local.p.slice(), v: v0.slice(), w: (w0 || [0, 0, 0]).slice(), parada: false, quique: local.quique };
    let n = 0;
    for (let i = 0; i < 60 * 3.0 && !b.parada; i++) {
      passoBola(b, get);
      if (i % 2 === 0 && n < MAXP) { pts.set(b.p, n * 3); n++; }
    }
    pontosMat.color.set(cor); linhaMat.color.set(cor); anelMat.color.set(cor);
    geoP.setDrawRange(0, n); geoP.attributes.position.needsUpdate = true;
    pontos.visible = curvaLinha.visible = n > 1;
    anel.position.set(b.p[0], b.p[1] - BOLA.r + 0.04, b.p[2]); anel.visible = true;
  }

  // ---- Execução das 9 Skills de Futebol ----------------------------------------------------------------------------
  const dir = new THREE.Vector3();
  const pertoDaBola = (m = 2.9, aerea = false) => tem && mesh.visible && Math.hypot(
    local.p[0] - player.pos[0],
    local.p[1] - (player.pos[1] + (aerea ? 1.55 : 1.05)),
    local.p[2] - player.pos[2],
  ) <= m;

  function getAimDir(overrideDir = null) {
    if (Array.isArray(overrideDir) && overrideDir.length === 3) {
      const len = Math.hypot(overrideDir[0], overrideDir[1], overrideDir[2]);
      if (len > 1e-4) return [overrideDir[0] / len, overrideDir[1] / len, overrideDir[2] / len];
    }
    if (game.xr?.presenting && Array.isArray(game.aimRay) && game.aimRay.length >= 6) {
      const len = Math.hypot(game.aimRay[3], game.aimRay[4], game.aimRay[5]);
      if (len > 1e-4) return [game.aimRay[3] / len, game.aimRay[4] / len, game.aimRay[5] / len];
    }
    camera.getWorldDirection(dir);
    return [dir.x, dir.y, dir.z];
  }

  function dispararVfxEstadio(payload) {
    if (typeof estadio.efeitoChute === 'function') estadio.efeitoChute(payload);
    else estadio.dispararVfx?.(payload);
  }

  function executarSkill(sk, carga, aimDir = null) {
    const now = agora();
    if ((cooldowns.get(sk.id) || 0) > now) return false;
    if (!pertoDaBola(sk.alcance + 0.25, !!sk.aerea)) return false;
    if (!possoTocar()) { aviso2(`Reposição do ${st.lados[st.reposicao.time]}: espere a bola rolar`); return false; }
    const dArr = getAimDir(aimDir);
    const res = calcularSkillChute(sk.id, { dir: dArr, carga, curva: curvaLado, bolaRelY: local.p[1] - player.pos[1] });
    local.v = res.v.slice();
    local.w = res.w.slice();
    local.parada = false;
    meuToque = now;
    cooldowns.set(sk.id, now + sk.cd);
    if (res.impulsoJogador) {
      player.vel[0] += res.impulsoJogador[0] * 0.45;
      player.vel[1] = Math.max(player.vel[1], res.impulsoJogador[1]);
      player.vel[2] += res.impulsoJogador[2] * 0.45;
    }
    dispararAnimSkill(self, res.subtipo || sk.id, curvaLado);
    net.send?.({ t: 'skill', id: sk.id, dir: dArr.map((x) => Math.round(x * 1000) / 1000), carga: Math.round(carga * 100) / 100, curva: curvaLado });
    const ac = game.audio?.ctx, out = game.audio?.out;
    if (ac && out) somChute(ac, out, !!res.especial, 0.36);
    if (res.especial) {
      dispararVfxEstadio({ tipo: res.especial, subtipo: res.subtipo, skill: sk.id, cor: res.cor, p: local.p, v: res.v, w: res.w });
      if (['bicicleta', 'voleio', 'carrinho'].includes(res.subtipo)) {
        const lbl = { bicicleta: '⭐ BICICLETA!', voleio: '⚡ VOLEIO!', carrinho: '💨 CARRINHO!' }[res.subtipo];
        if (lbl) aviso2(lbl, meuTime());
      }
    }
    return true;
  }

  let segura = 0, carregando = false;
  const CURTO = 0.16, CHEIO = 0.95;
  const cargaAgora = () => Math.max(0, Math.min(1, (agora() - segura - CURTO) / CHEIO));
  function cancelarAcao() {
    segura = 0; carregando = false;
    esconderPrevia();
  }
  function comecaAcao(aimDir = null) {
    if (!segura) segura = agora();
    const sk = SKILLS_FUTEBOL[skillIdx];
    if (noCampoAtivo && !sk.carga) {
      segura = 0;
      executarSkill(sk, 0.5, aimDir);
    }
  }
  function soltaAcao(aimDir = null) {
    if (!segura) return;
    const dt = agora() - segura, c = dt < CURTO ? 0.25 : cargaAgora();
    segura = 0; carregando = false;
    esconderPrevia();
    if (game.state !== 'PLAYING') return;
    if (noCampoAtivo) {
      executarSkill(SKILLS_FUTEBOL[skillIdx], c, aimDir);
      return;
    }
    // Fora da área (ou GM com Modo GM ligado): mantém compatibilidade com o chute clássico F
    if (!pertoDaBola(2.6)) return;
    if (!possoTocar()) { aviso2(`Reposição do ${st.lados[st.reposicao.time]}: espere a bola rolar`); return; }
    executarSkill(dt < CURTO ? SKILLS_FUTEBOL[0] : SKILLS_FUTEBOL[6], c, aimDir);
  }

  // ---- Arquibancada segura (nunca prende o jogador!) ---------------------------------------------------------------
  function levantarArquibancada(avisar = false) {
    if (!sentadoArq) return false;
    const s = sentadoArq;
    sentadoArq = null;
    if (Math.hypot(player.pos[0] - s.x, player.pos[1] - s.y, player.pos[2] - s.z) < 2.2) {
      player.pos[1] = s.y + 0.18;
      player.vel[0] = player.vel[1] = player.vel[2] = 0;
    }
    if (selfEstavaSentado) { selfEstavaSentado = false; resetarPoseExtra(self); }
    if (avisar) ui.toast('Levantou da arquibancada.', 1600);
    return true;
  }

  // Assento ao alcance de quem pode sentar agora (fora do campo, sem forma na mão, sem estar pilotando)
  const assentoLivre = () => (!noCampoAtivo && !input?.shapeMode && !game.machines?.seat && st.campo && (game.dim || 0) === 0
    ? estadio.assentoPerto(player.pos) : null);
  function sentar(ass) {
    sentadoArq = ass;
    player.pos[0] = ass.x; player.pos[1] = ass.y; player.pos[2] = ass.z;
    player.prev[0] = ass.x; player.prev[1] = ass.y; player.prev[2] = ass.z;
    player.vel[0] = player.vel[1] = player.vel[2] = 0;
    player.yaw = ass.yaw;
    ui.toast(`🪑 Sentado na arquibancada — ${tecla(game, 'levantar')} levanta.`, 2600);
  }
  // A ação 'interact' (F no PC, Usar no toque, B no VR, X no controle) senta e levanta: vale em todo aparelho (19/11).
  function assentoPorAcao() {
    if (game.state !== 'PLAYING' || game.overlay || !input?.wasPressed('interact')) return;
    if (sentadoArq) { levantarArquibancada(true); return; }
    const ass = assentoLivre();
    if (ass) sentar(ass);
  }

  // Passo fixo: quando sentado na arquibancada, fixa posição sem gravidade/dano de queda e levanta com movimento/pulo
  game.hooks.fixed.push((dt, intent) => {
    if (!sentadoArq) return false;
    if (game.state !== 'PLAYING' || (game.dim || 0) !== 0 || !st.campo || noCampoAtivo) {
      levantarArquibancada(false);
      return false;
    }
    // Se o jogador foi teleportado para longe (/tp, /inicio), solta imediatamente
    if (Math.hypot(player.pos[0] - sentadoArq.x, player.pos[1] - sentadoArq.y, player.pos[2] - sentadoArq.z) > 2.2) {
      sentadoArq = null;
      return false;
    }
    // Pulo, agachar ou andar (WASD/stick) levantam imediatamente
    if (intent && (intent.jump || intent.sneak || Math.hypot(intent.x, intent.z) > 0.35)) {
      levantarArquibancada(false);
      return false;
    }
    player.prev[0] = player.pos[0] = sentadoArq.x;
    player.prev[1] = player.pos[1] = sentadoArq.y;
    player.prev[2] = player.pos[2] = sentadoArq.z;
    player.vel[0] = player.vel[1] = player.vel[2] = 0;
    player.onGround = true;
    return true;
  });

  // ---- Atalhos de teclado (zero conflito com main.js / input.js) ---------------------------------------------------
  const digitando = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  addEventListener('keydown', (e) => {
    if (e.repeat || digitando(e.target) || game.state !== 'PLAYING' || game.overlay || !st.campo) return;
    if (e.code === 'KeyF') {
      // sentar e levantar da arquibancada vão pela ação 'interact' (F aqui, Usar no toque, B no VR): ver assentoPorAcao
      if (sentadoArq || assentoLivre()) return;
      comecaAcao();
    } else if (e.code === 'KeyQ' && noCampoAtivo) {
      alternarCurva();
    } else if (e.code === 'KeyG' && !e.ctrlKey && !e.altKey && !e.metaKey && !input?.shapeMode && !game.machines?.seat && !estaLonge()) {
      if (game.mode === 'gm') { if (e.shiftKey) abrirPainel('gm'); return; }
      if (e.shiftKey) {
        if (isGm && gmAtivo) abrirPainel('gm');
        else if (isGm) ui.toast('👑 Ative o Modo GM primeiro (tecla G) para abrir o Estúdio GM.', 2400);
        else abrirPainel('partida');
      } else if (isGm) {
        net.send?.({ t: 'gm', ativo: !gmAtivo });
      } else {
        abrirPainel('partida');
      }
    } else if (e.code === 'KeyH' && !e.ctrlKey && !e.altKey && !e.metaKey && !input?.shapeMode && !estaLonge()) {
      abrirPainel(game.mode === 'gm' || (isGm && gmAtivo) ? 'gm' : 'partida');
    }
  });
  addEventListener('keyup', (e) => { if (e.code === 'KeyF') soltaAcao(); });
  addEventListener('blur', cancelarAcao);

  // Hook de interação (prioritário!): dentro do espaço funcional do campo, intercepta clique esquerdo/direito/pick
  // e bloqueia completamente quebrar, construir, formas, árvores, ferramentas e combate!
  let mouseAtivo = false;
  game.hooks.interact.unshift((dt, playing) => {
    if (!noCampoAtivo) {
      if (mouseAtivo) { mouseAtivo = false; soltaAcao(); }
      return false;
    }
    if (!playing) return true;
    const apertado = input?.isDown('break') || input?.isDown('place');
    if (apertado && !mouseAtivo) { mouseAtivo = true; comecaAcao(); }
    else if (!apertado && mouseAtivo) { mouseAtivo = false; soltaAcao(); }
    const sk = SKILLS_FUTEBOL[skillIdx];
    const dirCurva = ['colocado', 'falta', 'drible', 'especial'].includes(sk.id) ? ` · ${tecla(game, 'curva')} curva ${curvaLado > 0 ? '→' : '←'}` : '';
    const gmDica = isGm ? ` · ${tecla(game, 'gm')}: Modo GM` : '';
    ui.setHint(`⚽ ${sk.tecla}. ${sk.nome} — ${tecla(game, 'chute')} p/ jogar · ${tecla(game, 'skill')} troca${dirCurva}${gmDica}`);
    return true;
  });

  // ---- Torcida nas arquibancadas (com camisas personalizadas pelo GM!) ---------------------------------------------
  let torcedores = [], chaveArq = '';
  let torcidaGrande = null;
  function montaTorcida() {
    const arqs = st.campo?.arquibancadas || [], fundos = st.campo?.arquibancadasFundos || [];
    const cfg = st.custom || customFutebolPadrao();
    const chave = JSON.stringify({ arqs, fundos, t: cfg.times });
    if (chave === chaveArq) return;
    chaveArq = chave;
    for (const tc of torcedores) { scene.remove(tc.b.root); tc.b.dispose?.(); }
    torcedores = [];
    torcidaGrande?.dispose(); torcidaGrande = null;
    // estádio grande (centenas de lugares): a torcida inteira em seis desenhos (game/torcida.js)
    const lugares = arqs.reduce((n, a) => n + (a.x1 - a.x0 + 1), 0) + fundos.reduce((n, a) => n + (a.z1 - a.z0 + 1), 0);
    if (lugares > 160) { torcidaGrande = criarTorcida({ scene, fileiras: arqs, fundos, times: cfg.times, pc: game.plataforma === 'pc' }); return; }
    for (const a of arqs) {
      const lado = a.lado ? 1 : 0;
      const tCfg = cfg.times[lado];
      const dens = Number(tCfg.torcida ?? 1);
      if (dens <= 0.01) continue;
      const limiar = Math.max(0.05, 1 - (game.plataforma === 'pc' ? 0.65 : 0.4) * dens);
      const mat = materialCamisa(tCfg.cor, tCfg.cor2, tCfg.padrao);
      for (let x = a.x0; x <= a.x1; x += 1) {
        const h = Math.abs(Math.sin(x * 12.9898 + a.z * 78.233) * 43758.5453) % 1;
        if (h < limiar) continue;
        const b = buildBody();
        const camisa = new THREE.Mesh(GEO_CAMISA, mat);
        camisa.position.y = (18 / 32) * 1.8; camisa.castShadow = game.plataforma === 'pc';
        (b.root.getObjectByName('root') || b.root).add(camisa);
        // torcedor fica na arquibancada, fora do campo: sem chuteira (19/11)
        b.root.position.set(x + 0.5, a.y, a.z + 0.5); b.root.rotation.y = a.olhar > a.z ? Math.PI : 0;
        b.root.scale.setScalar(0.92 + h * 0.12); scene.add(b.root);
        torcedores.push({ b, lado, fase: h * 6.28, z: a.z, frente: b.root.rotation.y });
      }
    }
  }
  function animaTorcida(t) {
    const fest = agora() < comemora.ate ? comemora.lado : -1;
    torcidaGrande?.anima(t, fest);
    for (const tc of torcedores) {
      const { b } = tc, ganha = fest === tc.lado, perde = fest >= 0 && !ganha;
      if (!(t < (tc.chaoAte || 0))) {
        tc.chaoAte = t + 3;
        const x = Math.floor(b.root.position.x), z = Math.floor(b.root.position.z);
        for (let y = Math.floor(tc.yLugar ?? (tc.yLugar = b.root.position.y)) + 2; y > tc.yLugar - 8; y--) {
          const id = world.getBlock(x, y - 1, z); if (id && SOLIDO[id]) { b.root.userData.y0 = y; break; }
        }
      }
      const y0 = b.root.userData.y0 ?? tc.yLugar ?? b.root.position.y;
      b.root.position.y = y0 + (ganha ? Math.abs(Math.sin(t * 9 + tc.fase)) * 0.38 : 0);
      if (b.armL && b.armR) {
        const braco = ganha ? -2.9 + Math.sin(t * 14 + tc.fase) * 0.25 : perde ? -0.15 : Math.sin(t * 1.3 + tc.fase) * 0.06;
        b.armL.rotation.x = braco; b.armR.rotation.x = ganha ? braco : perde ? -0.15 : -Math.sin(t * 1.3 + tc.fase) * 0.06;
        b.armL.rotation.z = ganha ? -0.35 : 0; b.armR.rotation.z = ganha ? 0.35 : 0;
      }
      if (b.head) {
        const dx = local.p[0] - b.root.position.x, dz = local.p[2] - b.root.position.z;
        const alvo = Math.atan2(-dx, -dz) - b.root.rotation.y, d = ((alvo + Math.PI) % 6.2832 + 6.2832) % 6.2832 - Math.PI;
        b.head.rotation.y += (Math.max(-1.1, Math.min(1.1, d)) - b.head.rotation.y) * 0.15;
        b.head.rotation.x = perde ? 0.45 : ganha ? -0.35 : 0;
      }
    }
  }

  // ---- Atualiza HUD de placar, GM e estado do espaço funcional -----------------------------------------------------
  function desenhaPlacar() {
    const c = st.custom || customFutebolPadrao();
    nomeA.textContent = st.lados[0]; nomeA.style.color = c.times[0].cor;
    nomeB.textContent = st.lados[1]; nomeB.style.color = c.times[1].cor;
    meio.textContent = `${st.placar[0]} × ${st.placar[1]}`;
    relogioSpan.textContent = st.partida?.estado === 'jogo' && st.partida?.duracao > 0 ? `⏱ ${fmtTempo(st.partida.restante)}` : '';
  }

  function atualizarBotoesGm() {
    const noModo = game.mode === 'gm';
    game.isGm = isGm || noModo;
    game.gmAtivo = gmAtivo || noModo;
    btnGmToggle.style.display = isGm && !noModo ? 'inline-flex' : 'none';
    btnGmToggle.textContent = gmAtivo ? '👑 GM: ON' : '👑 GM: OFF';
    btnGmToggle.style.background = gmAtivo
      ? 'linear-gradient(180deg, rgba(224,142,28,.96), rgba(164,84,12,.94))'
      : 'linear-gradient(180deg, rgba(52,58,70,.92), rgba(28,32,40,.9))';
    btnGmStudio.style.display = noModo || (isGm && gmAtivo) ? 'inline-flex' : 'none';
    lastLayoutKey = '';
    if (game.gmAtivo) {
      aplicarEstadoEspaco(false);
      levantarArquibancada(false);
    }
    renderModal(true);
  }

  function podeEditarBloco(x, y, z) {
    if (gmAtivo || !st.zona || (game.dim || 0) !== 0) return true;
    const bloq = noEspaco(st.zona, player.pos) || noEspaco(st.zona, [x + 0.5, y + 0.5, z + 0.5]);
    if (bloq) {
      const now = performance.now();
      if (now - ultimoAvisoBloq > 2400) {
        ultimoAvisoBloq = now;
        ui.toast(isGm ? `⚽ Campo protegido! ${game.xr?.presenting ? 'No menu (X) → Futebol, ligue o Modo GM' : 'Aperte G ou clique em 👑 GM'} para editar.` : '⚽ Área do campo protegida para o jogo de futebol.', 2400);
      }
      return false;
    }
    return true;
  }

  function aplicarEstadoEspaco(ativo) {
    if (ativo === noCampoAtivo) return;
    noCampoAtivo = ativo;
    game.espacoAtivo = ativo ? st.zona : null;
    ui.el.hud.classList.toggle('espaco-futebol', ativo);
    skillBar.classList.toggle('hide', !ativo);
    if (ativo) {
      levantarArquibancada(false);
      if (game.tool) { game.tool = null; if (input) input.shapeMode = false; }
      if (interaction) { interaction.locked = true; interaction.digging = null; interaction.miniMode = false; }
      if (game.groups?.recording) game.groups.cancel();
      if (game.machines?.seat) game.machines.standUp?.();
      if (player.flying && !game.modeRules?.atravessa) player.flying = false;
      if (game.overlay === 'palette' || game.overlay === 'editor' || game.overlay === 'crafting') closeOverlay?.();
      const now = performance.now();
      if (now - ultimoAvisoCampo > 2500) {
        ultimoAvisoCampo = now;
        ui.toast(`⚽ Em campo! Habilidades de futebol: ${tecla(game, 'skill')} troca · ${tecla(game, 'chute')} joga.`, 3200);
      }
    } else {
      cancelarAcao();
      mouseAtivo = false;
      if (interaction) {
        const r = game.modeRules;
        interaction.locked = r ? (!r.quebra && !r.poe) : false;
      }
    }
  }

  // ---- Rede --------------------------------------------------------------------------------------------------------
  function aplicarVisualBola() {
    const cfg = (st.custom || customFutebolPadrao()).bola;
    if (cfg.estilo !== estiloBolaAtual) {
      estiloBolaAtual = cfg.estilo;
      bolaMat.map = texturaBolaEstilo(estiloBolaAtual);
      bolaMat.emissive.set(estiloBolaAtual === 'neon' ? '#083344' : '#000000');
      bolaMat.needsUpdate = true;
    }
    mesh.scale.setScalar(cfg.escala || 1);
    local.quique = srv.quique = cfg.quique || 0.55;
  }

  function recebeEstado(f) {
    if (!f) {
      st.campo = null; st.zona = null; st.times = {}; st.reposicao = null; tem = false; mesh.visible = false;
      levantarArquibancada(false);
      aplicarEstadoEspaco(false);
      fecharPainel();
      limparRobos();
      montaTorcida();
      sincronizarAvatares();
      estadio.sincronizar(null, null);
      hudBar.style.display = 'none';
      botoes.classList.add('hide');
      aviso.style.display = 'none';
      faixa.style.display = 'none';
      layoutHudBar(false);
      return;
    }
    st.campo = f.campo;
    st.zona = zonaCampo(f.campo);
    st.placar = f.placar || [0, 0];
    st.lados = f.lados || f.campo?.lados || st.lados;
    if (f.partida) st.partida = f.partida;
    if (f.custom) st.custom = f.custom;
    st.reposicao = f.reposicao || null;
    if (f.times) st.times = f.times;
    if (f.perfis) st.perfis = f.perfis;
    if (f.p) {
      const p = f.p.map((x) => x / 100);
      srv.p = p.slice(); srv.v = [0, 0, 0]; srv.w = [0, 0, 0]; srv.parada = true;
      local.p = p.slice(); local.v = [0, 0, 0]; local.w = [0, 0, 0]; local.parada = true;
      tem = true;
    }
    aplicarVisualBola();
    estadio.sincronizar(st.campo, st.custom);
    // Se o assento atual foi removido (ex.: arquibancadas apagadas/desligadas), levanta o jogador
    if (sentadoArq && !estadio.assentoPerto([sentadoArq.x, sentadoArq.y, sentadoArq.z])) levantarArquibancada(false);
    montaTorcida();
    atualizarUniformesRobos();
    sincronizarAvatares();
    renderModal(false);
  }

  function animarJogadorRemoto(m, tipoFallback = 'passe') {
    const ehEu = (m.autorId != null && m.autorId === net.id) || (m.por && m.por === game.name);
    if (ehEu || !avatars?.list) return;
    let av = m.autorId != null ? avatars.list.get(m.autorId) : null;
    if (!av && m.por) {
      for (const a of avatars.list.values()) if (a.name === m.por) { av = a; break; }
    }
    if (!av?.body) return;
    const now = agora();
    if (now - (av._ultSkillAnimT || 0) < 0.12) return;
    av._ultSkillAnimT = now;
    const tipo = m.subtipo || m.skill || m.especial || m.tipo || tipoFallback;
    const spin = Array.isArray(m.spin) ? m.spin : Array.isArray(m.w) ? m.w : null;
    const curva = Number(m.curva) || (spin && spin[1] ? Math.sign(spin[1]) : 1);
    dispararAnimSkill(av.body, tipo, curva);
  }

  const volPerto = () => { const d = st.campo ? Math.hypot(player.pos[0] - st.campo.centro[0], player.pos[2] - st.campo.centro[2]) : 0; return Math.max(0.15, 1 - d / 140); };

  game.hooks.other.push((m) => {
    if (m.t === 'welcome' || m.t === 'dim') recebeEstado(m.futebol);
    else if (m.t === 'futebol') recebeEstado(m);
    else if (m.t === 'gm') { isGm = !!m.isGm; gmAtivo = !!m.ativo; atualizarBotoesGm(); }
    else if (m.t === 'futTempo') { st.partida.restante = m.restante; }
    else if (m.t === 'futXp') {
      if (m.perfil && m.nome) st.perfis[m.nome.toLowerCase()] = m.perfil;
      ui.toast(`⭐ +${m.ganho} XP de Futebol (${m.motivo})${m.subiuNivel ? ` — Nível ${m.subiuNivel}!` : ''}`, 4200);
      renderModal(false);
    } else if (m.t === 'futFx') {
      const p = Array.isArray(m.p) ? m.p.map((x) => x / 100) : local.p;
      const v = Array.isArray(m.v) ? m.v.map((x) => x / 100) : local.v;
      const w = Array.isArray(m.spin) ? m.spin.map((x) => x / 100) : Array.isArray(m.w) ? m.w.map((x) => x / 100) : local.w;
      const ehEu = (m.autorId != null && m.autorId === net.id) || (m.por && m.por === game.name);
      if (!ehEu) {
        dispararVfxEstadio({ tipo: m.especial || m.tipo || m.skill, subtipo: m.subtipo || m.skill, skill: m.skill, cor: m.cor || '#facc15', p, v, w });
        const ac = game.audio?.ctx, out = game.audio?.out;
        if (ac && out) somChute(ac, out, true, 0.28 * volPerto());
        animarJogadorRemoto(m, m.subtipo || m.skill || m.tipo || 'forte');
      }
    } else if (m.t === 'bola') {
      if (m.s && m.s <= st.seq && m.s > st.seq - 1000) return; st.seq = m.s || st.seq;
      srv.p = m.p.map((x) => x / 100); srv.v = m.v.map((x) => x / 100);
      srv.w = Array.isArray(m.spin) ? m.spin.map((x) => x / 100) : Array.isArray(m.w) ? m.w.map((x) => x / 100) : [0, 0, 0];
      srv.parada = !!m.q;
      if (m.skill || m.especial || m.subtipo) animarJogadorRemoto(m, m.subtipo || m.skill || m.especial);
      if (!srv.parada) for (let i = 0; i < 4; i++) passoBola(srv, get);
      if (!tem) { local.p = srv.p.slice(); local.v = srv.v.slice(); local.w = srv.w.slice(); local.parada = srv.parada; tem = true; }
      else if (srv.parada === false) local.parada = false;
    } else if (m.t === 'fut') recebeRobos(m.n);
    else if (m.t === 'join') setTimeout(sincronizarAvatares, 60);
    else if (m.t === 'apito') {
      const ac = game.audio?.ctx, out = game.audio?.out, k = volPerto();
      if (ac && out) apito(ac, out, 0.28 * k, m.tipo === 'fim' ? 0.9 : m.tipo === 'início' ? 1.1 : 0.38, m.tipo === 'fim' ? 3 : 1);
      const txt = { lateral: 'Lateral', escanteio: 'Escanteio', 'tiro de meta': 'Tiro de meta', saida: 'Saída de bola', 'início': 'Começou a partida!', fim: 'Fim de jogo', falta: 'Falta!' }[m.tipo] || '';
      if (txt) aviso2(txt + (m.nome ? ' — ' + m.nome : ''), m.time);
    } else if (m.t === 'vitoria') {
      avisoTit.textContent = m.time < 0 ? 'EMPATE!' : 'VITÓRIA!';
      avisoSub.textContent = `${m.nome} · ${st.lados[0]} ${m.placar[0]} × ${m.placar[1]} ${st.lados[1]}`;
      aviso.style.display = 'block'; avisoAte = performance.now() + 6000;
      emitir('placar', { titulo: avisoTit.textContent, sub: avisoSub.textContent, time: m.time, ms: 6000 });
      comemora = { lado: m.time, ate: agora() + 9 };
      const ac = game.audio?.ctx, out = game.audio?.out; if (ac && out) torcida(ac, out, 0.6 * volPerto(), 6);
    } else if (m.t === 'gol') {
      st.placar = m.placar; st.lados = m.lados || st.lados;
      avisoTit.textContent = 'GOL!';
      avisoSub.textContent = `${m.lado}${m.por ? ' — ' + m.por : ''} · ${st.lados[0]} ${st.placar[0]} × ${st.placar[1]} ${st.lados[1]}`;
      aviso.style.display = 'block'; avisoAte = performance.now() + 3200;
      emitir('placar', { titulo: 'GOL!', sub: avisoSub.textContent, time: st.lados.indexOf(m.lado), ms: 3200 });
      comemora = { lado: st.lados.indexOf(m.lado), ate: agora() + 5 };
      const ac = game.audio?.ctx, out = game.audio?.out;
      if (ac && out) { const k = volPerto(); apito(ac, out, 0.3 * k); setTimeout(() => torcida(ac, out, 0.55 * k), 350); }
    }
  });

  // ---- Laço principal: espaço funcional, física com Magnus, animações corporais, estádio 3D e arquibancadas -------
  const pAnt = [0, 0, 0]; let pAntOk = false, vestirT = 0;
  game.hooks.frame.push((dt) => {
    const t = agora();
    const ok = st.campo && tem && (game.dim || 0) === 0;
    mesh.visible = !!ok;

    // Checar espaço funcional do campo (bloqueio para não-GMs ou GM com modo GM desligado)
    const dentro = !!(st.zona && (game.dim || 0) === 0 && !gmAtivo && noEspaco(st.zona, player.pos));
    aplicarEstadoEspaco(dentro && game.state === 'PLAYING');
    if (dentro && game.state === 'PLAYING' && player.flying && !game.modeRules?.atravessa) player.flying = false;

    assentoPorAcao();
    // Dica da arquibancada funcional
    if (sentadoArq) {
      if (game.state !== 'PLAYING' || !st.campo) levantarArquibancada(false);
      else ui.setHint(`🪑 Assistindo na arquibancada — ${tecla(game, 'levantar')} levanta`);
    } else if (!dentro && st.campo && (game.dim || 0) === 0 && game.state === 'PLAYING' && !game.overlay && estadio.assentoPerto(player.pos)) {
      ui.setHint(`🪑 Arquibancada — ${tecla(game, 'interact')} senta para assistir`);
    } else if (!noCampoAtivo && st.campo && game.state === 'PLAYING' && !game.overlay && api.pertoDaBola(2.6)) {
      // fora da zona (ou GM com o Modo GM ligado), com a bola ao alcance: o chute clássico (F, Chutar, gatilho do VR)
      ui.setHint(`⚽ Bola — ${tecla(game, 'chuteLivre')}: toque curto · segure para o chute carregado`);
    }

    const overlayEscondeHud = !!game.overlay && game.overlay !== 'futebol';
    const mostrarHudBar = !estaLonge() && !overlayEscondeHud && (game.state === 'PLAYING' || game.state === 'PAUSED');
    hudBar.style.display = mostrarHudBar ? 'flex' : 'none';
    if (mostrarHudBar) desenhaPlacar();
    layoutHudBar(mostrarHudBar);
    if (avisoAte && performance.now() > avisoAte) { aviso.style.display = 'none'; avisoAte = 0; }
    if (faixaAte && performance.now() > faixaAte) { faixa.style.display = 'none'; faixaAte = 0; }

    // Cooldown visual nos slots de skill
    if (noCampoAtivo) {
      for (let i = 0; i < SKILLS_FUTEBOL.length; i++) {
        const sk = SKILLS_FUTEBOL[i], fim = cooldowns.get(sk.id) || 0;
        const frac = fim > t ? Math.min(1, (fim - t) / sk.cd) : 0;
        const cdEl = skillBtns[i].querySelector('.cd');
        if (cdEl) cdEl.style.height = frac > 0.01 ? `${Math.round(frac * 100)}%` : '0%';
      }
    }

    // Estádio 3D + rede deformável + refletores noturnos + bandeiras + cometa Magnus + VFX + animações corporais
    const sunH = Number.isFinite(atmosphere?.state?.elevation) ? atmosphere.state.elevation : (atmosphere?.sunDir?.y ?? 0.5);
    estadio.atualizar(Math.min(dt, 0.05), t, ok ? local.p : null, ok ? local.v : null, sunH, ok ? local.w : null);
    animaTorcida(t);
    animaRobos(Math.min(dt, 0.1));
    atualizarAnimacoesCorpo(Math.min(dt, 0.1));
    if ((vestirT -= dt) <= 0) { vestirT = 0.25; sincronizarAvatares(); }   // uniforme só dentro do campo

    if (!ok) { botoes.classList.add('hide'); esconderPrevia(); return; }
    dt = Math.min(dt, 0.1);
    acc += dt; accS += dt;
    while (acc >= BOLA.passo) { acc -= BOLA.passo; if (!local.parada) passoBola(local, get); }
    while (accS >= BOLA.passo) { accS -= BOLA.passo; if (!srv.parada) passoBola(srv, get); }

    const ex = srv.p[0] - local.p[0], ey = srv.p[1] - local.p[1], ez = srv.p[2] - local.p[2], erro = Math.hypot(ex, ey, ez);
    const k = Math.min(1, dt * (t - meuToque < 0.35 ? 1.5 : 7));
    if (erro > 2.5 && t - meuToque > 0.35) {
      local.p = srv.p.slice(); local.v = srv.v.slice(); local.w = srv.w.slice(); local.parada = srv.parada;
    } else {
      local.p[0] += ex * k; local.p[1] += ey * k; local.p[2] += ez * k;
      for (let i = 0; i < 3; i++) { local.v[i] += (srv.v[i] - local.v[i]) * k; local.w[i] += (srv.w[i] - local.w[i]) * k; }
      if (srv.parada && erro < 0.05) { local.v = [0, 0, 0]; local.w = [0, 0, 0]; local.parada = true; }
    }

    // Pé na bola (condução)
    const pp = player.pos, vx = pAntOk ? (pp[0] - pAnt[0]) / Math.max(dt, 1e-3) : 0, vz = pAntOk ? (pp[2] - pAnt[2]) / Math.max(dt, 1e-3) : 0;
    pAnt[0] = pp[0]; pAnt[1] = pp[1]; pAnt[2] = pp[2]; pAntOk = true;
    const dx = local.p[0] - pp[0], dz = local.p[2] - pp[2], d = Math.hypot(dx, dz);
    if (game.state === 'PLAYING' && !player.noclip && !sentadoArq && possoTocar() && d < 0.35 + BOLA.r && local.p[1] > pp[1] - BOLA.r && local.p[1] < pp[1] + 1.8) {
      const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0, vel = Math.min(14, Math.hypot(vx, vz)), ida = vel * 1.25 + 1.2;
      local.v = [nx * ida, Math.max(local.v[1], 0.6), nz * ida]; local.w = [0, 0, 0]; local.parada = false;
      local.p[0] = pp[0] + nx * (0.35 + BOLA.r + 0.02); local.p[2] = pp[2] + nz * (0.35 + BOLA.r + 0.02);
      meuToque = t;
      if (t - ultToqueEnvio > 1 / 15) { ultToqueEnvio = t; net.send?.({ t: 'toque', p: local.p.map((x) => Math.round(x * 100) / 100), v: local.v.map((x) => Math.round(x * 100) / 100) }); }
    }

    // Giro visual real da bola: rotação de rolagem + spin real (w) no ar!
    const mx = local.p[0] - mesh.position.x, mz = local.p[2] - mesh.position.z, md = Math.hypot(mx, mz);
    const wMag = Math.hypot(local.w[0], local.w[1], local.w[2]);
    if (wMag > 0.25) {
      mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(local.w[0], local.w[1], local.w[2]).normalize(), wMag * dt));
    } else if (md > 1e-4 && md < 3) {
      mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(mz, 0, -mx).normalize(), md / BOLA.r));
    }
    mesh.position.set(local.p[0], local.p[1], local.p[2]);

    // Barra de carga e trajetória 3D curva Magnus ao vivo (Desktop, Mobile e VR!)
    const sk = SKILLS_FUTEBOL[skillIdx];
    const perto = pertoDaBola(noCampoAtivo ? sk.alcance + 0.25 : 2.6, !!sk.aerea);
    if (segura && perto && t - segura > CURTO) {
      carregando = true; const c = cargaAgora();
      if (!game.xr?.presenting) {
        barra.style.display = 'block'; enche.style.width = Math.round(c * 100) + '%';
        rotulo.textContent = `${sk.nome} · ${Math.round(c * 100)}%`;
      } else barra.style.display = 'none';
      const dArr = getAimDir();
      const prev = calcularSkillChute(sk.id, { dir: dArr, carga: c, curva: curvaLado, bolaRelY: local.p[1] - player.pos[1] });
      preve(prev.v, prev.w, prev.cor);
    } else if (carregando && !perto) {
      esconderPrevia(); carregando = false;
    }

    // Botões de toque dentro do campo (ou perto da bola)
    const mostraTouch = !!(device?.touch && game.state === 'PLAYING' && !game.overlay && (noCampoAtivo || pertoDaBola(3.2)));
    botoes.classList.toggle('hide', !mostraTouch);
    bCurva.classList.toggle('hide', !noCampoAtivo);
  });

  const api = {
    get campo() { return st.campo; },
    get placar() { return st.placar; },
    get noCampo() { return noCampoAtivo; },
    get skillAtual() { return SKILLS_FUTEBOL[skillIdx]; },
    get curvaLado() { return curvaLado; },
    get cargaAtual() { return segura && (agora() - segura > CURTO) ? cargaAgora() : 0; },
    get isGm() { return isGm; },
    get gmAtivo() { return gmAtivo; },
    get sentado() { return !!sentadoArq; },
    painel,                                         // estado e ações do painel da partida (PC e VR)
    on(fn) { ouvintes.push(fn); return () => { const i = ouvintes.indexOf(fn); if (i >= 0) ouvintes.splice(i, 1); }; },
    // bola ao alcance do chute de fora da zona (o F do PC; o gatilho do VR usa isto): plano 0, bola à vista, não sentado
    pertoDaBola: (m = 2.6) => !sentadoArq && (game.dim || 0) === 0 && !!st.campo && pertoDaBola(m),
    selectSkill,
    alternarCurva,
    abrirPainel,
    fecharPainel,
    comecaAcao,
    soltaAcao,
    cancelarAcao,
    podeEditarBloco,
    levantarArquibancada,
    dispararAnimSkill,
    bola: mesh, local, srv, estadio,
    get torcedores() { return torcedores.length; },
  };
  game.futebol = api;
  return api;
}
