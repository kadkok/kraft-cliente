// LAVRA — bússola dos jogadores (pedido do Kadmus, 17/11/2026: "os jogadores poderiam compartilhar direção para
// poderem ser localizados uns pelos outros").
//
// Faixa no topo da tela com os pontos cardeais (N, NE, L, SE, S, SO, O, NO) girando com o olhar e, para cada outro
// jogador no mesmo plano, um marcador na direção dele com o nome, a distância e ↑/↓ quando está bem acima ou abaixo.
// Quem fica fora da faixa (atrás de você) aparece preso na borda com ◀ ou ▶ para o lado mais curto de virar.
// A posição dos outros já chega a todos (é a mesma que move os bonecos, `avatars.list[id].snaps`); quem está no modo
// espectador não tem boneco e não aparece. Tecla N mostra/esconde; no chat: /bussola, /onde (lista com rumo e
// distância de cada um). Eixos do mundo: +X leste, −Z norte.
export const CARDEAIS = [['N', 0], ['NE', 45], ['L', 90], ['SE', 135], ['S', 180], ['SO', 225], ['O', 270], ['NO', 315]];
export const CAMPO = 200;   // graus mostrados de ponta a ponta da faixa

const graus = (r) => (r * 180) / Math.PI;
const norm = (a) => ((a % 360) + 540) % 360 - 180;            // −180…180
const rumoDe = (dx, dz) => (graus(Math.atan2(dx, -dz)) + 360) % 360;   // 0 = norte, 90 = leste
const nomeRumo = (r) => CARDEAIS[Math.round(r / 45) % 8][0];
const fmtDist = (d) => (d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km');

/** Calcula posição horizontal normalizada (0..1) das marcações da bússola e pinos de jogadores/povoados. */
export function calcularBussola({ yaw = 0, pos = [0, 0, 0], outros = [], povos = [], descobrir = [], cais = [] }) {
  const heading = (graus(-yaw) + 360) % 360;   // yaw 0 olha para −Z (norte); girar à esquerda soma
  const cardeais = [];
  for (const [label, deg] of CARDEAIS) {
    const rel = norm(deg - heading);
    if (Math.abs(rel) <= CAMPO / 2 - 4) cardeais.push({ label, deg, rel, t: 0.5 + rel / CAMPO });
  }
  const itens = [];
  for (const o of outros) {
    const dx = o.x - pos[0], dz = o.z - pos[2], dy = (o.y ?? pos[1]) - pos[1], d = Math.hypot(dx, dz);
    const rel = norm(rumoDe(dx, dz) - heading), fora = Math.abs(rel) > CAMPO / 2;
    const clamped = fora ? Math.sign(rel) * (CAMPO / 2) : rel;
    const alt = dy > 4 ? ' ↑' : dy < -4 ? ' ↓' : '';
    itens.push({
      id: o.id, kind: 'player', cor: o.cor || '#e8873a', fora,
      t: 0.5 + clamped / CAMPO,
      texto: (fora && rel < 0 ? '◀ ' : '') + (o.nome || 'alguém') + ' · ' + fmtDist(d) + alt + (fora && rel > 0 ? ' ▶' : ''),
    });
  }
  const pv = [...(povos || []).map(([tipo, nome, x, z]) => ({ id: 'pv:' + nome, txt: (tipo === 'tribo' ? '⛺ ' : tipo === 'aldeia' ? '🏘 ' : '🏰 ') + nome, x, z })),
    ...(descobrir || []).map(([tipo, x, z]) => ({ id: 'pd:' + x + ',' + z, txt: '❔ ' + tipo, x, z }))]
    .map((o) => ({ ...o, d: Math.hypot(o.x - pos[0], o.z - pos[2]) })).sort((a, b) => a.d - b.d)[0];
  if (pv && pv.d > 25) {
    const rel = norm(rumoDe(pv.x - pos[0], pv.z - pos[2]) - heading), fora = Math.abs(rel) > CAMPO / 2;
    const clamped = fora ? Math.sign(rel) * (CAMPO / 2) : rel;
    itens.push({
      id: pv.id, kind: 'povo', cor: '#c8902a', fora,
      t: 0.5 + clamped / CAMPO,
      texto: (fora && rel < 0 ? '◀ ' : '') + pv.txt + ' · ' + fmtDist(pv.d) + (fora && rel > 0 ? ' ▶' : ''),
    });
  }
  // cais da balsa mais perto (19/11; game/balsa.js → portos), enquanto dá para ir a pé até ele
  const cs = (cais || []).map((q) => ({ id: 'cais:' + q.id, x: q.espera[0], z: q.espera[2], d: Math.hypot(q.espera[0] - pos[0], q.espera[2] - pos[2]) })).sort((a, b) => a.d - b.d)[0];
  if (cs && cs.d > 25 && cs.d < 900) {
    const rel = norm(rumoDe(cs.x - pos[0], cs.z - pos[2]) - heading), fora = Math.abs(rel) > CAMPO / 2;
    const clamped = fora ? Math.sign(rel) * (CAMPO / 2) : rel;
    itens.push({ id: cs.id, kind: 'cais', cor: '#3f9fd8', fora, t: 0.5 + clamped / CAMPO, texto: (fora && rel < 0 ? '◀ ' : '') + '⚓ cais · ' + fmtDist(cs.d) + (fora && rel > 0 ? ' ▶' : '') });
  }
  return { heading, cardeais, marcadores: empilharMarcadores(itens, 480) };
}

/** Empilha marcadores próximos horizontalmente em linhas distintas para nunca se sobreporem. */
export function empilharMarcadores(itens, largura, larguraDe = (m) => Math.max(76, m.texto.length * 6.8 + 16)) {
  const ord = itens.map((m) => ({ m, x: m.t * largura, w: larguraDe(m) })).sort((a, b) => a.x - b.x);
  const linhas = [];
  for (const o of ord) {
    let l = 0;
    while (linhas[l] !== undefined && o.x - o.w / 2 < linhas[l] + 4) l++;
    linhas[l] = o.x + o.w / 2;
    o.m.row = l;
  }
  return itens;
}

/** Define largura e topo da bússola sem colidir com safe-area ou botões/painéis do topo. */
export function layoutBussola({ vw, vh = 800, safeTop = 0, obstacles = [], compact = false }) {
  const estreita = vw < 760;
  const boxW = Math.round(
    estreita
      ? Math.min(compact ? 360 : 460, vw * 0.84)
      : (compact && vh < 520 ? Math.min(340, vw * 0.42) : Math.min(480, vw * 0.40)),
  );
  const x0 = vw / 2 - boxW / 2, x1 = vw / 2 + boxW / 2;
  let top = Math.round(safeTop + (compact ? 6 : 10));
  const list = [...obstacles].filter((o) => o && o.width > 0 && o.height > 0 && o.right > x0 - 12 && o.left < x1 + 12)
    .sort((a, b) => a.bottom - b.bottom);
  for (const o of list) if (o.bottom > top - 2 && o.top < top + (compact ? 30 : 38)) top = Math.round(o.bottom + (compact ? 5 : 8));
  return { boxW, top };
}

export function initBussola({ game, player, avatars, ui }) {
  let ligada = true;
  try { ligada = localStorage.getItem('lavra.bussola') !== '0'; } catch { /* sem armazenamento */ }

  const host = ui?.el?.hud || document.body;
  const safeProbe = document.createElement('div');
  Object.assign(safeProbe.style, { position: 'fixed', top: 'var(--safe-t, 0px)', left: '0', width: '0', height: '0', visibility: 'hidden', pointerEvents: 'none' });
  host.appendChild(safeProbe);

  const faixa = document.createElement('div');
  faixa.id = 'bussola';
  Object.assign(faixa.style, {
    position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)', width: 'min(40vw, 480px)', height: '30px',
    background: 'linear-gradient(180deg, rgba(14,20,28,.78), rgba(8,12,18,.55))', border: '1px solid rgba(232,238,245,.18)',
    borderRadius: '8px', overflow: 'visible', pointerEvents: 'none', zIndex: 8, font: '600 12px system-ui, sans-serif',
    color: '#e8eef5', boxShadow: '0 2px 10px rgba(0,0,0,.35)', display: 'none',
  });
  const centro = document.createElement('div');
  Object.assign(centro.style, { position: 'absolute', left: '50%', top: '-3px', width: '2px', height: '36px', marginLeft: '-1px',
    background: 'linear-gradient(180deg, #ffd27a, rgba(255,170,60,.2))' });
  faixa.appendChild(centro);
  const marcas = new Map(CARDEAIS.map(([t, g]) => {
    const el = document.createElement('div');
    el.textContent = t;
    Object.assign(el.style, { position: 'absolute', top: '7px', transform: 'translateX(-50%)', fontSize: t.length === 1 ? '13px' : '11px',
      opacity: t.length === 1 ? '1' : '.65', textShadow: '0 1px 2px #000' });
    faixa.appendChild(el);
    return [t, { el, g }];
  }));
  const pinos = new Map();
  host.appendChild(faixa);

  function pino(id) {
    let p = pinos.get(id);
    if (p) return p;
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', top: '31px', transform: 'translateX(-50%)', whiteSpace: 'nowrap', padding: '2px 7px',
      borderRadius: '6px', background: 'linear-gradient(180deg, rgba(20,28,40,.92), rgba(10,14,22,.8))', fontSize: '11px',
      border: '1px solid rgba(255,255,255,.2)', textShadow: '0 1px 2px #000' });
    const ponto = document.createElement('div');
    Object.assign(ponto.style, { position: 'absolute', top: '-12px', left: '50%', width: '9px', height: '9px', marginLeft: '-4.5px',
      borderRadius: '50%', boxShadow: '0 0 6px rgba(255,255,255,.6)' });
    const texto = document.createElement('span');
    el.append(ponto, texto); faixa.appendChild(el);
    p = { el, ponto, texto }; pinos.set(id, p);
    return p;
  }

  // onde está cada outro jogador agora (último retrato do boneco)
  function outros() {
    const out = [];
    for (const [id, a] of avatars.list) {
      const s = a.snaps?.[a.snaps.length - 1]; if (!s) continue;
      const info = game.players.get(id); if (!info) continue;
      out.push({ id, nome: info.name || 'alguém', cor: info.color || '#e8873a', x: s.x, y: s.y, z: s.z });
    }
    return out;
  }

  function snapshot() {
    return {
      ligada,
      ...calcularBussola({ yaw: player.yaw, pos: player.pos, outros: outros(), povos: game.mapa?.povos, descobrir: game.mapa?.descobrir, cais: game.balsas?.portos }),
    };
  }

  let proximoLayout = 0, layout = null, debugAnterior, wAnterior, hAnterior;
  game.hooks.frame.push(() => {
    const ov = game.overlay;
    const esconderOverlay = ov === 'mapa' || ov === 'palette' || ov === 'editor';
    const ver = ligada && game.state === 'PLAYING' && !game.xr?.presenting && !esconderOverlay;
    faixa.style.display = ver ? 'block' : 'none';
    if (!ver) { host.style?.setProperty?.('--bussola-bot', '0px'); return; }
    const compact = !!host.classList?.contains('celular');
    const debug = ui?.el?.debug && !ui.el.debug.classList.contains('hide');
    const agora = performance.now();
    if (!layout || agora >= proximoLayout || innerWidth !== wAnterior || innerHeight !== hAnterior || debug !== debugAnterior) {
      const obs = [];
      if (ui?.el?.corner) obs.push(ui.el.corner.getBoundingClientRect());
      if (debug) obs.push(ui.el.debug.getBoundingClientRect());
      layout = layoutBussola({ vw: innerWidth, vh: innerHeight, safeTop: safeProbe.getBoundingClientRect().top, obstacles: obs, compact });
      const mudou = innerWidth !== wAnterior || innerHeight !== hAnterior;
      proximoLayout = agora + 350; wAnterior = innerWidth; hAnterior = innerHeight; debugAnterior = debug;
      faixa.style.top = layout.top + 'px'; faixa.style.width = layout.boxW + 'px';
      faixa.style.height = compact ? '24px' : '30px'; centro.style.height = compact ? '28px' : '36px';
      for (const [k, m] of marcas) {
        m.el.style.top = compact ? '5px' : '7px';
        m.el.style.fontSize = compact ? (k.length === 1 ? '11px' : '9.5px') : (k.length === 1 ? '13px' : '11px');
      }
      if (mudou) for (const p of pinos.values()) p.largura = 0;
    }
    const { boxW: largura, top } = layout;
    const { cardeais, marcadores } = calcularBussola({ yaw: player.yaw, pos: player.pos, outros: outros(), povos: game.mapa?.povos, descobrir: game.mapa?.descobrir, cais: game.balsas?.portos });
    const visC = new Set(cardeais.map((c) => c.label));
    for (const [k, m] of marcas) m.el.style.display = visC.has(k) ? 'block' : 'none';
    for (const c of cardeais) marcas.get(c.label).el.style.left = Math.round(c.t * largura) + 'px';
    const vistos = new Set();
    for (const o of marcadores) {
      vistos.add(o.id);
      const p = pino(o.id);
      p.el.style.display = 'block';
      p.el.style.left = Math.round(o.t * largura) + 'px';
      p.ponto.style.background = o.kind === 'povo' ? 'radial-gradient(circle at 35% 35%, #fff6d0, #c8902a)' : `radial-gradient(circle at 35% 35%, #fff, ${o.cor})`;
      if (p.texto.textContent !== o.texto) { p.texto.textContent = o.texto; p.largura = 0; }
      p.el.style.opacity = o.kind === 'player' && o.fora ? '.75' : '1';
    }
    for (const [id, p] of pinos) if (!vistos.has(id)) { p.el.remove(); pinos.delete(id); }
    empilharMarcadores(marcadores, largura, (m) => {
      const p = pinos.get(m.id);
      return p.largura || (p.largura = p.el.offsetWidth || 90);
    });
    const pinTop0 = compact ? 25 : 31;
    let maxRow = -1;
    for (const o of marcadores) {
      const p = pinos.get(o.id); if (p) p.el.style.top = (pinTop0 + o.row * 22) + 'px';
      if (o.row > maxRow) maxRow = o.row;
    }
    host.style?.setProperty?.('--bussola-bot', Math.round(top + (compact ? 28 : 36) + (maxRow >= 0 ? (maxRow + 1) * 22 + 8 : 5)) + 'px');
  });

  function alternar(v = !ligada) {
    ligada = !!v;
    try { localStorage.setItem('lavra.bussola', ligada ? '1' : '0'); } catch { /* sem armazenamento */ }
    ui?.setCompass?.(ligada);
  }
  ui?.setCompass?.(ligada);
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyN' || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (game.state === 'PLAYING') alternar();
  });

  // comandos do chat que são só deste aparelho; devolve true quando tratou
  function comando(texto, toast) {
    if (texto === '/bussola') { alternar(); toast(ligada ? 'Bússola ligada (tecla N).' : 'Bússola desligada (tecla N).'); return true; }
    if (texto === '/onde') {
      const eu = player.pos, lista = outros();
      if (!lista.length) { toast('Ninguém mais neste plano agora.'); return true; }
      toast(lista.map((o) => { const dx = o.x - eu[0], dz = o.z - eu[2]; return `${o.nome}: ${Math.round(Math.hypot(dx, dz))} m a ${nomeRumo(rumoDe(dx, dz))} (x ${Math.round(o.x)}, z ${Math.round(o.z)})`; }).join(' · '), 7000);
      return true;
    }
    return false;
  }
  const api = { get ligada() { return ligada; }, alternar, comando, outros, snapshot };
  game.bussola = api;
  return api;
}
