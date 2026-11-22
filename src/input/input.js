// LAVRA — entrada em duas camadas. Os ouvintes só ESCREVEM aqui; o jogo só LÊ.
// Teclado, mouse, toque, controle e VR convergem para o mesmo vocabulário de ações:
// nenhum sistema do jogo enxerga 'KeyW'.

export const ACTIONS = [
  'jump', 'sneak', 'sprint', 'break', 'place', 'pick', 'interact', 'inventory', 'chat', 'command',
  'pause', 'debug', 'view', 'hotNext', 'hotPrev', 'fire', 'park', 'flip', 'tool',
  'group', 'ungroup', 'swap', 'layer',     // obras: abrir/fechar, desagrupar, trocar (ou juntar), camada
  'grow', 'shrink', 'turnL', 'turnR', 'turn45', 'orient', // forma a colocar: aumentar, diminuir, girar e vertical/horizontal (só no modo de forma)
  'mini',                                  // alterna modo mini-bloco (1/4 de bloco, 0,5 x 0,5 x 1 m)
  'trunkMode',                             // alterna tronco redondo/tubular vs quadrado (cubo)
  'collect',                               // pega os itens soltos perto (game/items.js)
  'axe',
  'magnet',                                // liga/desliga o ímã das peças livres (objects/mao.js)
  // peça na mão ou a colocar (só no modo de forma): inclinar, comprimento, grossura, distância, carimbar, marcar/desfazer conjunto
  'tiltU', 'tiltD', 'longer', 'shorter', 'thicker', 'thinner', 'far', 'near', 'stamp', 'pjoin', 'psplit',
];

export function createInput() {
  const sources = new Map();   // nome da fonte -> { axes: {mx, mz, my}, down: Set }
  const pressed = new Set();   // bordas de subida deste quadro
  const escondidas = new Set();
  const look = { dx: 0, dy: 0 };
  const api = {
    hotbar: -1,                // pedido de selecionar um espaço (0..8), -1 = nada
    shapeMode: false,          // com uma forma escolhida, R/F/T/G viram tamanho e giro (ALT_KEYS); quem liga é o editor
    aim: null,                 // {x, y} em pixels: mirar por um ponto da tela (toque)
    enabled: true,
    source(name) {
      let s = sources.get(name);
      if (!s) { s = { mx: 0, mz: 0, my: 0, down: new Set() }; sources.set(name, s); }
      return {
        axes(mx, mz, my = 0) { s.mx = mx; s.mz = mz; s.my = my; },
        set(action, on) {
          if (on) { if (!s.down.has(action)) { s.down.add(action); pressed.add(action); } }
          else s.down.delete(action);
        },
        tap(action) { pressed.add(action); },
        look(dx, dy) { look.dx += dx; look.dy += dy; },
        clear() { s.mx = s.mz = s.my = 0; s.down.clear(); },
      };
    },
    isDown(action) { return !escondidas.has(action) && api.rawDown(action); },
    suppress(action, on) { if (on) escondidas.add(action); else escondidas.delete(action); },
    rawDown(action) {
      if (!api.enabled) return false;
      for (const s of sources.values()) if (s.down.has(action)) return true;
      return false;
    },
    rawPressed(action) { return api.enabled && pressed.has(action); },
    wasPressed(action) { return !escondidas.has(action) && api.rawPressed(action); },
    // eixo de movimento somado e limitado ao círculo unitário (diagonal não é mais rápida)
    move(out) {
      let mx = 0, mz = 0, my = 0;
      if (api.enabled) for (const s of sources.values()) { mx += s.mx; mz += s.mz; my += s.my; }
      const l = Math.hypot(mx, mz);
      if (l > 1) { mx /= l; mz /= l; }
      out.x = mx; out.z = mz; out.y = Math.max(-1, Math.min(1, my));
      return out;
    },
    takeLook(out) { out.x = look.dx; out.y = look.dy; look.dx = look.dy = 0; return out; },
    endFrame() { pressed.clear(); api.hotbar = -1; },
    clearAll() { escondidas.clear(); for (const s of sources.values()) { s.mx = s.mz = s.my = 0; s.down.clear(); } pressed.clear(); look.dx = look.dy = 0; },
  };
  return api;
}

// ---- teclado e mouse ---------------------------------------------------------------
const KEYS = {
  Space: 'jump', ShiftLeft: 'sneak', ShiftRight: 'sneak', ControlLeft: 'sprint', KeyR: 'sprint',
  KeyE: 'inventory', KeyT: 'chat', Enter: 'chat', Slash: 'command', F3: 'debug', KeyV: 'view',
  KeyF: 'interact', KeyQ: 'pick', KeyG: 'park', KeyX: 'flip', KeyC: 'fire', KeyB: 'tool', KeyY: 'mini', KeyK: 'trunkMode',   // mini-blocos: Y (18/11: o M abre o mapa, game/mapa.js)
  PageDown: 'planeIn', PageUp: 'planeOut',
  KeyO: 'group', KeyU: 'ungroup', KeyJ: 'swap', KeyL: 'layer',
  KeyP: 'collect',
  KeyI: 'magnet', KeyZ: 'axe',
};
// No modo de forma (input.shapeMode: forma a colocar ou peça na mão) estas teclas trocam de papel; correr segue nos
// dois toques em W e o chat no Enter. Três pares de teclas vizinhas: R/F tamanho, T/G giro, Y/H inclinação. As setas
// deixam de andar (o WASD segue andando) e viram comprimento (↑↓) e grossura (←→); a roda vira a distância da mão.
const ALT_KEYS = {
  KeyR: 'grow', KeyF: 'shrink', KeyT: 'turnL', KeyG: 'turnR', KeyX: 'orient', KeyY: 'tiltU', KeyH: 'tiltD',
  ArrowUp: 'longer', ArrowDown: 'shorter', ArrowRight: 'thicker', ArrowLeft: 'thinner',
  KeyC: 'stamp', KeyJ: 'pjoin', KeyU: 'psplit',
};
// Correr: dois toques seguidos em W (como no Minecraft), segurando o segundo. É o jeito seguro num navegador:
// Ctrl+W fecha a aba e Ctrl+Shift+W fecha a janela, e nenhuma página consegue impedir esses dois atalhos.
const DOUBLE_TAP_MS = 300;

export function attachKeyboardMouse(input, canvas, opts) {
  const src = input.source('teclado');
  const dash = input.source('corrida');     // a corrida dos dois toques em W: vale enquanto o W seguir apertado
  let lastForward = -1e9;
  const held = new Set();
  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  };
  const refreshAxes = () => {
    const setas = !input.shapeMode;      // no modo de forma as setas medem a peça em vez de andar
    const mx = (held.has('KeyD') || (setas && held.has('ArrowRight')) ? 1 : 0) - (held.has('KeyA') || (setas && held.has('ArrowLeft')) ? 1 : 0);
    const mz = (held.has('KeyW') || (setas && held.has('ArrowUp')) ? 1 : 0) - (held.has('KeyS') || (setas && held.has('ArrowDown')) ? 1 : 0);
    src.axes(mx, mz, 0);
  };
  const onKeyDown = (e) => {
    if (typing(e)) return;
    if (e.code === 'Escape') return; // o navegador já solta o ponteiro; o jogo reage a isso
    if (e.code === 'Tab' || e.code === 'F3' || e.code === 'Space' || e.code === 'Slash' || e.code.startsWith('Arrow') || e.code.startsWith('Page')) e.preventDefault();
    // Com o ponteiro travado o teclado é do jogo: Ctrl+D, Ctrl+J, Ctrl+U, Ctrl+1, Alt+seta... não abrem favoritos,
    // downloads, código-fonte nem trocam de aba. (Ctrl+W, Ctrl+T e Ctrl+N o navegador não deixa segurar.)
    if ((e.ctrlKey || e.metaKey || e.altKey) && locked()) e.preventDefault();
    if (e.repeat || ((e.ctrlKey || e.metaKey || e.altKey) && e.code === 'KeyZ')) return;
    held.add(e.code);
    refreshAxes();
    if (e.code === 'KeyW') {
      const now = performance.now();
      if (now - lastForward < DOUBLE_TAP_MS) dash.set('sprint', true);
      lastForward = now;
    }
    const a = (input.shapeMode && ALT_KEYS[e.code]) || KEYS[e.code];
    if (a) src.set(a, true);
    if (e.code.startsWith('Digit')) { const n = Number(e.code.slice(5)); if (n >= 1 && n <= 9) input.hotbar = n - 1; }
  };
  const onKeyUp = (e) => {
    held.delete(e.code);
    refreshAxes();
    if (e.code === 'KeyW') dash.set('sprint', false);
    // solta os dois papéis: o modo pode ter mudado com a tecla apertada
    const a = KEYS[e.code], b = ALT_KEYS[e.code];
    if (a) src.set(a, false);
    if (b) src.set(b, false);
  };
  const locked = () => document.pointerLockElement === canvas;
  const onMouseMove = (e) => {
    if (!locked()) return;
    const k = 0.0022 * opts.sensitivity();
    src.look(e.movementX * k, e.movementY * k * (opts.invertY() ? -1 : 1));
  };
  const btn = ['break', 'pick', 'place'];
  const onMouseDown = (e) => {
    if (!locked()) return;
    if (btn[e.button]) src.set(btn[e.button], true);
    e.preventDefault();
  };
  const onMouseUp = (e) => { if (btn[e.button]) src.set(btn[e.button], false); };
  const onWheel = (e) => {
    if (!locked()) return;
    // no modo de forma a roda afasta e aproxima a peça (o material se troca pelos números 1–9)
    if (input.shapeMode) src.tap(e.deltaY > 0 ? 'near' : 'far');
    else src.tap(e.deltaY > 0 ? 'hotNext' : 'hotPrev');
    e.preventDefault();
  };
  const clear = () => { held.clear(); src.clear(); dash.clear(); };
  const onVis = () => { if (document.hidden) clear(); };

  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('blur', clear);
  document.addEventListener('visibilitychange', onVis);
  // ctrlHeld: há um Ctrl apertado agora? (o aviso de saída do main.js usa isso para pegar o Ctrl+W sem querer)
  return { clear, locked, ctrlHeld: () => held.has('ControlLeft') || held.has('ControlRight') };
}

// ---- controle (Gamepad API) --------------------------------------------------------------
export function createGamepad(input, opts) {
  const src = input.source('controle');
  const map = [[0, 'jump'], [1, 'sneak'], [2, 'interact'], [3, 'inventory'], [4, 'hotPrev'], [5, 'hotNext'],
    [6, 'place'], [7, 'break'], [8, 'collect'], [9, 'pause'], [10, 'sprint'], [11, 'view'], [12, 'fire'], [13, 'park'], [14, 'pick'], [15, 'tool']];
  const dz = (x, y) => { // zona morta radial
    const l = Math.hypot(x, y);
    if (l < 0.16) return [0, 0];
    const k = Math.min(1, (l - 0.16) / 0.84) / l;
    return [x * k, y * k];
  };
  let active = false;
  return {
    get active() { return active; },
    poll(dt) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gp = null;
      for (const p of pads) if (p && p.connected && p.mapping === 'standard') { gp = p; break; }
      if (!gp) { if (active) { src.clear(); active = false; } return; }
      active = true;
      const [mx, mz] = dz(gp.axes[0] || 0, gp.axes[1] || 0);
      const [lx, ly] = dz(gp.axes[2] || 0, gp.axes[3] || 0);
      src.axes(mx, -mz, 0);
      const k = 2.6 * opts.sensitivity() * dt;
      if (lx || ly) src.look(lx * Math.abs(lx) * k * 1.4, ly * Math.abs(ly) * k * (opts.invertY() ? -1 : 1));
      for (const [i, a] of map) {
        const b = gp.buttons[i];
        src.set(a, !!b && (b.pressed || b.value > 0.5));
      }
    },
  };
}
