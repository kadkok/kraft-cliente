// LAVRA — controles de toque (iPad, celular): polegar esquerdo anda, arrastar à direita olha,
// toque curto coloca, toque longo quebra; botões para pular, descer e agir na mira.

import { h } from '../ui/ui.js';

const HOLD_MS = 360, TAP_MS = 260, SLOP = 12;

const TOUCH_ICONS = {
  jump: 'M12 4l-6 6h4v8h4v-8h4l-6-6Z',
  down: 'M12 20l6-6h-4V6h-4v8H6l6 6Z',
  brk: 'M14.7 3.3a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1-1.4 1.4l-1.5-1.5-8.9 8.9 1.6 1.6-1.4 1.4-4-4 1.4-1.4 1.6 1.6 8.9-8.9-1.5-1.5a1 1 0 0 1 0-1.4Z',
  plc: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z',
  use: 'M18 11V6a1.5 1.5 0 0 0-3 0v4h-1V4.5a1.5 1.5 0 0 0-3 0V10h-1V5.5a1.5 1.5 0 0 0-3 0V12l-1.4-1.2a1.4 1.4 0 0 0-2 2L8 19a4 4 0 0 0 3 1.5h4.2A3.8 3.8 0 0 0 19 16.7V11h-1Z',
  park: 'M6 5h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm3 3v8h6V8H9Z',
  flip: 'M7 7h8.2l-2-2 1.4-1.4L19 8l-4.4 4.4-1.4-1.4 2-2H7v7h10v-2h2v3a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h1Z',
};

function touchBtn(label, cls, icoKey) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<path fill="currentColor" d="${TOUCH_ICONS[icoKey]}"/>`;
  const tl = h('span', { class: 'tl', text: label });
  const el = h('div', { class: 'tbtn ' + cls, role: 'button', 'aria-label': label }, s, tl);
  el._tl = tl;
  return el;
}

export function attachTouch(input, canvas, layer, opts) {
  const src = input.source('toque');
  const stick = h('div', { class: 'stick' }, h('b'));
  const knob = stick.firstChild;
  const bJump = touchBtn('Pular', 'jump', 'jump');
  const bDown = touchBtn('Descer', 'down hide', 'down');
  const bBreak = touchBtn('Quebrar', 'brk', 'brk');
  const bPlace = touchBtn('Pôr', 'plc', 'plc');
  const bUse = touchBtn('Usar', 'use', 'use');
  // só aparecem quando se pilota uma máquina
  const bPark = touchBtn('Parar', 'park hide', 'park');
  const bFlip = touchBtn('Virar', 'flip hide', 'flip');
  layer.append(stick, bJump, bDown, bBreak, bPlace, bUse, bPark, bFlip);

  let isShape = false;
  let inSpaceMode = false;
  const releaseBtn = (el) => {
    el.classList.remove('on');
    if (el._act) { src.set(el._act, false); el._act = null; }
  };
  // botões: segurar = ação mantida
  const bind = (el, action) => {
    const pick = () => (typeof action === 'function' ? action() : action);
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
      el.classList.add('on');
      const a = pick();
      el._act = a;
      src.set(a, true);
    };
    const up = (e) => {
      e.preventDefault();
      el.classList.remove('on');
      if (el._act) { src.set(el._act, false); el._act = null; }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  bind(bJump, 'jump'); bind(bDown, 'sneak'); bind(bBreak, 'break'); bind(bPlace, 'place'); bind(bUse, 'interact');
  bind(bPark, () => (isShape ? 'turn45' : 'park'));
  bind(bFlip, () => (isShape ? 'orient' : 'flip'));

  let move = null;   // { id, ox, oy }
  let lookP = null;  // { id, x, y, sx, sy, t0, moved, holding, timer }
  let ax = 0, az = 0;
  const setAxes = () => src.axes(ax, az, 0);

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ponteiro já solto */ }
    if (!move && e.clientX < window.innerWidth * 0.38) {
      move = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      stick.style.display = 'block';
      stick.style.left = e.clientX + 'px'; stick.style.top = e.clientY + 'px';
      knob.style.transform = '';
      return;
    }
    if (!lookP) {
      lookP = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t0: performance.now(), moved: false, holding: false, timer: 0 };
      const lp = lookP;
      if (!inSpaceMode) {
        lp.timer = setTimeout(() => {
          if (lookP !== lp || lp.moved || inSpaceMode) return;
          lp.holding = true;                       // toque longo parado: quebra onde o dedo está
          opts.aim(lp.x, lp.y);
          src.set('break', true);
        }, HOLD_MS);
      }
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (move && e.pointerId === move.id) {
      let dx = e.clientX - move.ox, dy = e.clientY - move.oy;
      const l = Math.hypot(dx, dy), max = 52;
      if (l > max) { dx *= max / l; dy *= max / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // zona morta radial; a direção vem do vetor, a força do quanto o polegar saiu do centro
      const dead = 0.14;
      const m = Math.min(1, l / max);
      const g = m < dead ? 0 : (m - dead) / (1 - dead);
      const cl = Math.hypot(dx, dy) || 1;
      ax = (dx / cl) * g; az = (-dy / cl) * g;
      setAxes();
      src.set('sprint', m > 0.96);
      return;
    }
    if (lookP && e.pointerId === lookP.id) {
      const dx = e.clientX - lookP.x, dy = e.clientY - lookP.y;
      lookP.x = e.clientX; lookP.y = e.clientY;
      if (!lookP.moved && Math.hypot(e.clientX - lookP.sx, e.clientY - lookP.sy) > SLOP) lookP.moved = true;
      if (lookP.holding) opts.aim(lookP.x, lookP.y);   // quebrando: o dedo move a mira, não a câmera
      else if (lookP.moved) {
        const k = 0.0052 * opts.sensitivity();
        src.look(dx * k, dy * k * (opts.invertY() ? -1 : 1));
      }
    }
  });
  const end = (e) => {
    if (move && e.pointerId === move.id) {
      move = null; ax = az = 0; setAxes(); src.set('sprint', false);
      stick.style.display = 'none';
      return;
    }
    if (lookP && e.pointerId === lookP.id) {
      clearTimeout(lookP.timer);
      if (lookP.holding) { src.set('break', false); opts.aim(null); }
      else if (!inSpaceMode && !lookP.moved && performance.now() - lookP.t0 < TAP_MS && e.type === 'pointerup') {
        opts.aim(lookP.x, lookP.y);              // toque curto: coloca onde tocou
        src.tap('place');
        setTimeout(() => opts.aim(null), 60);
      }
      lookP = null;
    }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  // sem zoom por gesto nem menu de contexto por toque longo
  for (const ev of ['gesturestart', 'gesturechange', 'contextmenu']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.target === canvas) e.preventDefault(); }, { passive: false });

  return {
    // chamado a cada quadro: mostra "Descer" só quando faz sentido; no espaço funcional (futebol) esconde quebrar/pôr/usar
    update(flying, inWater, seated, shapeMode = false, shapeOrient = 'v', inSpace = false) {
      const nextSpace = !!inSpace;
      if (nextSpace && !inSpaceMode) {
        if (lookP) {
          clearTimeout(lookP.timer);
          if (lookP.holding) { lookP.holding = false; src.set('break', false); opts.aim(null); }
        }
        releaseBtn(bBreak); releaseBtn(bPlace); releaseBtn(bUse); releaseBtn(bDown); releaseBtn(bPark); releaseBtn(bFlip);
      }
      inSpaceMode = nextSpace;
      isShape = !seated && !inSpaceMode && !!shapeMode;
      const shp = isShape;
      bDown.classList.toggle('hide', inSpaceMode || !(flying || inWater || seated));
      bPark.classList.toggle('hide', inSpaceMode || (!seated && !shp));
      bFlip.classList.toggle('hide', inSpaceMode || (!seated && !shp));
      bBreak.classList.toggle('hide', inSpaceMode);
      bUse.classList.toggle('hide', inSpaceMode);
      bJump._tl.textContent = seated ? 'Subir' : 'Pular'; bBreak._tl.textContent = seated ? 'Atirar' : 'Quebrar'; bUse._tl.textContent = seated ? 'Sair' : 'Usar';
      bPark._tl.textContent = shp ? 'Girar' : 'Parar';
      bFlip._tl.textContent = shp ? (shapeOrient === 'h' ? 'Em pé' : 'Deitar') : 'Virar';
      bPlace.classList.toggle('hide', !!seated || inSpaceMode);
    },
    clear() { src.clear(); move = null; lookP = null; stick.style.display = 'none'; },
  };
}
