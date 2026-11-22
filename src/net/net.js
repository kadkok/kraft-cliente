// LAVRA — cliente de rede. Um WebSocket, mensagens JSON, reconexão sozinha.
// Sem servidor (página aberta de um host estático), o jogo segue offline.

import { PROTOCOL, NET_TICK_HZ } from '../../shared/constants.js';
import { createClock } from '../../shared/clock.js';

export function createNet(on) {
  let ws = null, world = '', name = '', wantPlay = false, closedByUs = false;
  let retryMs = 800, retryTimer = 0, helloTimer = 0;
  let aparelho = '', avatar = '';
  function pedidoSpawn(nome) {
    const chave = 'kraft.avatar.' + String(nome).trim().toLowerCase();
    if (avatar !== chave) {
      avatar = chave; aparelho = '';
      try { aparelho = localStorage.getItem(chave) || ''; } catch {}
      if (!/^[a-f0-9]{32}$/.test(aparelho)) {
        aparelho = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
        try { localStorage.setItem(chave, aparelho); } catch {}
      }
    }
    // chave de GM lembrada neste aparelho para este nome (server/world.js: gmAparelhos); só vai se existir
    let gmtk = '';
    try { gmtk = localStorage.getItem('kraft.gm.' + String(nome).trim().toLowerCase()) || ''; } catch {}
    return /^[0-9a-f]{64}$/.test(gmtk) ? { t: 'spawn', name: nome, aparelho, gmtk } : { t: 'spawn', name: nome, aparelho };
  }
  const clock = createClock();  // online: acompanha o relógio do servidor; offline: é o próprio relógio do mundo
  // Versão do jogo com que esta página foi carregada. Página comum: a primeira que o servidor informar (ela acabou de
  // baixar os arquivos dele). Cliente instalado: a dos arquivos guardados no aparelho, que game/cliente.js informa por
  // `setBootBuild` — é assim que um aparelho aberto com arquivos antigos percebe e se atualiza.
  let bootBuild = null, serverBuild = null, mesmaDistribuicao = true;
  let tzMin = new Date().getTimezoneOffset();   // fuso do relógio do mundo (minutos a oeste de Greenwich); online, é o do servidor
  let lastSend = 0, lastPos = '';
  const api = {
    id: 0, key: '', online: false, playing: false, offline: false,

    connect(slug, modo = 'multiplayer') {
      world = slug; closedByUs = false; api.offline = false;
      clearTimeout(helloTimer);
      clearTimeout(retryTimer);
      if (ws) { ws.onclose = null; ws.close(); ws = null; }
      api.online = false; api.playing = false;
      api.key = ''; api.id = 0; api.local = null; lastPos = ''; lastSend = 0;
      if (modo === 'solo') {
        wantPlay = false; serverBuild = null; retryMs = 800; tzMin = new Date().getTimezoneOffset();
        goOffline(); return;
      }
      let sock;
      try { sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
      catch { on.error('Multiplayer indisponível. Você pode escolher Jogar sozinho.', true); return; }
      ws = sock;
      helloTimer = setTimeout(() => { if (!api.online && ws === sock) sock.close(); }, 4000);
      sock.onopen = () => ws === sock && sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL, world }));   // protocolo diferente: o servidor recusa e manda atualizar
      sock.onmessage = (e) => { if (ws !== sock) return; let m; try { m = JSON.parse(e.data); } catch { return; } handle(m); };
      sock.onclose = () => {
        if (ws !== sock) return;
        clearTimeout(helloTimer);
        const was = api.online;
        api.online = false; api.playing = false;
        if (closedByUs || api.offline) return;
        if (was) on.dropped();
        else on.error('Multiplayer indisponível. Tentando reconectar. O modo solo está disponível no menu.', true);
        retryTimer = setTimeout(() => api.connect(world), retryMs);
        retryMs = Math.min(8000, retryMs * 1.7);
      };
      sock.onerror = () => { /* onclose cuida */ };
    },

    spawn(n) {
      name = n; wantPlay = true;
      if (api.offline) { api.playing = true; on.spawned(n || 'Viajante'); return; }
      api.send(pedidoSpawn(n));
    },
    leaveGame() { wantPlay = false; api.playing = false; api.close(); },
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    sendBlock(x, y, z, id, m = 0) {
      if (api.offline) return on.localEdit();
      const o = m ? { t: 'b', x, y, z, id, m } : { t: 'b', x, y, z, id };
      if (id && api.blockSlot) { const k = api.blockSlot(); if (k >= 0) o.k = k; }   // sobrevivência: de que espaço da mochila sai (game/modes.js)
      api.send(o);
    },
    blockSlot: null,
    chat(m) {
      if (api.offline) return on.chat({ name, color: '#f4a64e', m });
      api.send({ t: 'c', m });
    },
    // chamado a cada quadro; envia no máximo NET_TICK_HZ vezes por segundo e só se mudou
    sendState(now, p, yaw, pitch, held, flags) {
      if (!api.playing || api.offline || now - lastSend < 1000 / NET_TICK_HZ) return;
      const s = `${p[0].toFixed(2)},${p[1].toFixed(2)},${p[2].toFixed(2)},${yaw.toFixed(2)},${pitch.toFixed(2)},${held},${flags}`;
      if (s === lastPos && now - lastSend < 1000) return;
      lastPos = s; lastSend = now;
      api.send({ t: 'p', p: [p[0], p[1], p[2]], r: [yaw, pitch], h: held, f: flags });
    },
    time() { return clock.time(); },
    // o instante de verdade (UTC, em ms) a que a hora do mundo corresponde: é por ele que se calcula o céu
    utcMs() { return (clock.time() + tzMin * 60) * 1000; },
    local: null,                 // lugar do mundo na Terra ({ lat, lon, alt, nome }) ou null
    get rate() { return clock.rate; },
    // acompanha um relógio vindo de fora (o do servidor); sem ritmo informado, mantém o atual
    setLocalTime(t, rate) { clock.follow(t, typeof rate === 'number' ? rate : clock.rate); if (on.clock) on.clock(clock.rate); },
    // só neste aparelho: põe o relógio numa hora (0..24). Serve aos testes e ao jogo offline.
    setHour(h) { clock.setHour(h); },
    // jogo offline: este aparelho é o dono do relógio (saved = { time, rate, real } guardado da última vez)
    startLocalClock(saved) { clock.load(saved && saved.time, saved ? saved.rate : undefined, saved ? saved.real : undefined); if (on.clock) on.clock(clock.rate); },
    setLocalRate(rate) { clock.setRate(rate); if (on.clock) on.clock(clock.rate); },
    clockState() { return clock.state(); },
    close() { closedByUs = true; clearTimeout(retryTimer); clearTimeout(helloTimer); if (ws) { ws.onclose = null; ws.close(); ws = null; } api.online = false; },
    // cliente instalado (game/cliente.js): com que versão esta página abriu, e o que fazer antes de recarregar
    // (buscar a versão nova para o aparelho; devolve uma promessa, e a recarga espera por ela)
    setBootBuild(v, mesmaOrigem = true) { if (!v) return; bootBuild = v; mesmaDistribuicao = mesmaOrigem; if (mesmaDistribuicao && serverBuild !== null && serverBuild !== v) reloadPage('conexao'); },
    get build() { return bootBuild; },
    get serverBuild() { return serverBuild; },
    beforeReload: null,
    reload() { reloadPage('jogador'); },
    get world() { return world; },
  };

  function goOffline() {
    if (api.offline) return;
    api.offline = true; api.online = false;
    clearTimeout(retryTimer);
    if (ws) { ws.onclose = null; try { ws.close(); } catch { /* já fechado */ } ws = null; }
    on.offline(world);
  }

  // O servidor avisa que o jogo mudou (versão nova publicada): recarrega a página sozinho e, se a pessoa estava
  // jogando, guarda o nome para voltar direto ao mundo. A trava de 10 s evita recarregar em círculo.
  let recarregando = false;
  // modo: 'jogador' = pedido de quem joga (recarrega sempre) · 'conexao' = ao encontrar o servidor em outra versão ·
  // sem modo = aviso do servidor com a página aberta (tools/aplicar.mjs)
  function reloadPage(modo) {
    if (recarregando) return;
    try {
      const last = Number(sessionStorage.getItem('lavra.recarregou') || 0);
      // recarregou há pouco e, ao reencontrar o servidor, continua diferente dele: o aparelho não conseguiu a versão
      // nova. Avisa quem joga e para (sem a trava, recarregaria em círculo).
      if (modo !== 'jogador' && Date.now() - last < 10000) { if (modo === 'conexao' && on.outdated) on.outdated(); return; }
      sessionStorage.setItem('lavra.recarregou', String(Date.now()));
      if (wantPlay) sessionStorage.setItem('lavra.voltar', name || 'Viajante');
    } catch { /* sem armazenamento de sessão: recarrega do mesmo jeito */ }
    recarregando = true;
    closedByUs = true;
    if (on.reloading) on.reloading();
    let antes = null;
    try { antes = api.beforeReload ? api.beforeReload() : null; } catch { /* recarrega assim mesmo */ }
    Promise.resolve(antes).catch(() => {}).then(() => location.reload());
  }

  function handle(m) {
    if (m && m.t === 'gm-chave' && typeof m.nome === 'string' && /^[0-9a-f]{64}$/.test(m.tk || '')) {   // senha de GM aceita: lembra o aparelho
      try { localStorage.setItem('kraft.gm.' + m.nome.slice(0, 24), m.tk); } catch {}
      return;
    }
    switch (m.t) {
      case 'key': api.key = m.key; break;
      case 'welcome':
        api.online = true; api.id = m.id; retryMs = 800;
        clearTimeout(helloTimer);
        api.setLocalTime(m.time, typeof m.rate === 'number' ? m.rate : 1);
        if (typeof m.tz === 'number') tzMin = m.tz;
        api.local = m.local || null;
        on.welcome(m);
        if (wantPlay) api.send(pedidoSpawn(name)); // reconexão no meio do jogo
        break;
      case 'spawned': api.playing = true; on.spawned(m.name); break;
      case 'time': api.setLocalTime(m.time, m.rate); break;
      case 'pong': api.setLocalTime(m.time, m.rate); break;
      case 'local': api.local = m.local || null; if (typeof m.tz === 'number') tzMin = m.tz; if (on.other) on.other(m); break;
      case 'build': serverBuild = m.id; if (bootBuild === null) bootBuild = m.id; else if (mesmaDistribuicao && m.id !== bootBuild) reloadPage('conexao'); break;
      case 's': on.state(m.l); break;
      case 'b': on.block(m); break;
      case 'join': on.join(m.p); break;
      case 'leave': on.leave(m.id); break;
      case 'c': on.chat(m); break;
      case 'sys': on.sys(m.m); break;
      case 'err': on.error(m.m, !!m.fatal); if (m.reload) reloadPage('conexao'); break;
      case 'reload': reloadPage(); break;
      default: if (on.other) on.other(m);
    }
  }

  return api;
}
