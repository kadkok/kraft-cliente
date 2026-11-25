// LAVRA — itens no chão e mochila, no aparelho de quem joga (pedido do Kadmus, 16/11/2026: "quando quebrar eu posso
// pegar ou deixar"). O servidor é o dono (server/items.js; regras em shared/items.js): aqui se espelha o que ele manda,
// desenha-se cada item (pele provisória, trocável), anima-se a coleta e mostra-se a mochila.
//
// Quem joga: quebrou, o bloco cai como um cubinho; passou perto, ele entra na mochila (coleta automática). Quem não
// quer, não passa por cima, ou desliga a coleta (botão na mochila, /coleta desliga) e pega só com a tecla P (botão
// Select do controle; no toque, o botão "Pegar" que aparece quando há item ao alcance; no VR, menu → Mochila).
// A mochila fica na tela de blocos (E): 36 espaços; tocar num espaço e "Largar" joga na frente. As portas de troca
// (`trocar`, `largar`, `alternarColeta`) são as mesmas para a tela do PC/celular e para a aba Mochila do VR.
//
// Para quem desenha (Astra): game.items.setSkin({ begin(), put(x, y, z, giro, escala, b, s, n, luz, item), end() })
// troca o desenho dos itens no chão. put recebe o CENTRO do cubinho já com o balanço e o giro (rad, em volta de Y);
// escala 1 = cubinho de 25 cm (encolhe ao ser pego); luz 0..1 (sombra de teto); n = tamanho da pilha; item = { id, b,
// s, n }. setSkin(null) volta à pele provisória (cubinhos com as texturas do bloco, planta em X). Som da coleta: chave
// 'pegar' do motor de som; sem arquivo gravado, toca um estalo curto ('tick' agudo).
// Também: game.items.list (id → { id, b, s, n, p }), game.items.bag ({ l, auto }), game.items.on(fn) com
// fn('bag', bag) e fn('pego', { b, s, n }).
import * as THREE from '../three.js';
import { TEX, KIND, K_CROSS, K_CUTOUT } from '../../shared/blocks.js';
import { MC_BASE } from '../../shared/mc-estados.js';
import { BAG_SLOTS, HAND_REACH, itemName, itemKey, bagTotal, bagUsed, cleanBag, inHandReach } from '../../shared/items.js';
import { h } from '../ui/ui.js';
import { isTesouro, aparenciaDe, valorDe, textoDoValor, tesouroDe, NOME_RARIDADE } from '../../shared/tesouros.js';
import { isObj } from '../../shared/objetos.js';
import { createObjIcones } from '../ui/obj-icones.js';

const FLY = 0.2;           // segundos do item voando até quem pegou
const FEED_MS = 2600;      // quanto tempo o "+3 Terra" fica na tela

const CSS = `
.itens-feed { position: absolute; right: calc(16px + var(--safe-r, 0px)); bottom: calc(96px + var(--safe-b, 0px)); display: grid; gap: 6px; justify-items: end; pointer-events: none; }
#hud.celular .itens-feed { left: calc(8px + var(--safe-l, 0px)); right: auto; bottom: calc(64px + var(--safe-b, 0px)); justify-items: start; }
.itens-linha { display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 6px; border-radius: 12px; font-size: 14px; color: var(--ink, #f6f2e9);
  background: linear-gradient(135deg, rgba(24, 38, 54, .9), rgba(11, 19, 29, .92)) padding-box, linear-gradient(135deg, #f4a64e, #c8602a) border-box;
  border: 1px solid transparent; text-shadow: 0 1px 2px #000; transition: opacity .4s, transform .25s; }
.itens-linha canvas { width: 26px; height: 26px; }
.itens-linha.out { opacity: 0; transform: translateX(14px); }
.itens-dica { padding: 6px 14px; border-radius: 999px; font-size: 13.5px; font-weight: 600; color: #fff; border: 1px solid transparent;
  background: linear-gradient(135deg, rgba(14, 58, 66, .92), rgba(9, 32, 42, .94)) padding-box, linear-gradient(135deg, #48c9b0, #23808f) border-box;
  text-shadow: 0 1px 2px #000; }
.mochila { flex: 1 1 100%; display: grid; gap: 8px; padding: 10px 12px; border-radius: 14px; border: 1px solid transparent;
  background: linear-gradient(160deg, rgba(40, 58, 78, .55), rgba(16, 26, 38, .65)) padding-box, linear-gradient(160deg, rgba(244, 166, 78, .55), rgba(255, 255, 255, .06)) border-box; }
.mochila-topo { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mochila-topo b { font-size: 15px; }
.mochila-topo span { flex: 1 1 auto; font-size: 12.5px; color: var(--muted, #c3ccd6); }
.mochila-grade { display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 5px; }
.mochila-grade .cell { padding: 4px; border-radius: 10px; }
.mochila-grade .cell.vazio { opacity: .45; cursor: default; }
.mochila-grade .cell small { bottom: 1px; right: 4px; left: auto; font-size: 11px; font-weight: 700; }
.mochila-acoes { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mochila-acoes .note { flex: 1 1 200px; }
`;

export function initItems({ game, world, player, net, ui, input, scene, store, lightProbe, avatars, openOverlay }) {
  const list = new Map();                  // id -> item espelhado
  let bag = { l: new Array(BAG_SLOTS).fill(0), auto: true };
  let sel = -1;                             // espaço escolhido na mochila
  const listeners = [];
  const emit = (k, v) => { for (const f of listeners) f(k, v); };
  // objetos (carne, couro, corda, sela…): itens que não são blocos; os ícones são provisórios (ui/obj-icones.js)
  const objIcones = createObjIcones();
  game.objIcones = objIcones;
  game.hotbarObj = new Array(9).fill(0);        // o objeto de cada espaço da barra (0 = bloco ou vazio); game.hotbar fica 0 nesses
  const now = () => performance.now() / 1000;

  // ---- espelho do que o servidor manda -----------------------------------------------------------------------------
  function add(i, b, s, n, p, v = null) {
    const t = now();
    list.set(i, { id: i, b, s, n, p: p.slice(), to: p.slice(), v: v ? v.slice() : null, born: t, phase: (i * 2.39996) % 6.2832, gone: null });
  }
  function leave(it, extra) {
    if (!it || it.gone) return;
    const t = now();
    if (extra && extra.to) it.gone = { t0: t, who: extra.to, from: it.p.slice() };
    else if (extra && extra.into && list.has(extra.into)) it.gone = { t0: t, into: extra.into, from: it.p.slice() };
    else it.gone = { t0: t, fade: true, from: it.p.slice() };
  }
  function got(m) {             // o servidor disse que eu peguei m.took
    const it = list.get(m.i);
    if (!it || !(m.took > 0)) return;
    feedAdd(it.b, it.s, m.took);
    game.audio.play('pegar', 0.85, 0.92 + Math.random() * 0.18);
    emit('pego', { b: it.b, s: it.s, n: m.took });
    if (!seenHint) {
      seenHint = true;
      try { store.set('itens.dica', true); } catch { /* sem armazenamento: avisa de novo na próxima vez */ }
      ui.toast('Guardado na mochila: tecla E (ou o botão Mochila) para ver e largar.', 4200);
    }
  }
  let seenHint = false;
  try { seenHint = !!store.get('itens.dica', false); } catch { /* sem armazenamento */ }

  game.hooks.other.push((m) => {
    switch (m.t) {
      case 'welcome': {         // mundo novo ou outro plano: o servidor manda tudo o que está no chão
        list.clear();
        for (const r of m.items || []) add(r[0], r[1], r[2], r[3], [r[4], r[5], r[6]]);
        break;
      }
      case 'offline': list.clear(); bag = { l: new Array(BAG_SLOTS).fill(0), auto: true }; renderBag(); break;
      // o editor de formas refaz a área extra da tela de blocos ao começar (replaceChildren): a mochila volta para o topo
      case 'boot': placeBag(); renderBag(); break;
      case 'it+': add(m.i, m.b, m.s, m.n, m.p, m.v); break;
      case 'itp': {
        const l = m.l;
        for (let k = 0; k + 3 < l.length; k += 4) {
          const it = list.get(l[k]);
          if (!it) continue;
          it.to[0] = l[k + 1]; it.to[1] = l[k + 2]; it.to[2] = l[k + 3];
          it.v = null;          // daqui em diante, segue o servidor
        }
        break;
      }
      case 'itn': {
        const it = list.get(m.i);
        if (it) it.n = m.n;
        if (m.to === net.id) got(m);
        break;
      }
      case 'it-': {
        if (m.to === net.id) got(m);
        leave(list.get(m.i), m);
        break;
      }
      case 'modo': renderBag(); break;     // a barra marcada na mochila depende do modo (game/modes.js)
      case 'bag': {
        bag = { l: cleanBag(m.l), auto: m.auto !== false };
        if (sel >= 0 && !bag.l[sel]) sel = -1;
        renderBag();
        emit('bag', bag);
        break;
      }
    }
  });

  // ---- pele provisória: cubinhos com as texturas do bloco (planta em X), em lotes por bloco --------------------------
  function provisionalSkin() {
    const root = new THREE.Group();
    root.name = 'itens';
    scene.add(root);
    const boxGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const crossGeo = (() => {   // dois planos cruzados de 32 cm, como a planta no mundo
      const g = new THREE.BufferGeometry(), r = 0.16, pos = [], uv = [], nor = [], idx = [];
      for (const [ax, az] of [[1, 1], [1, -1]]) {
        const base = pos.length / 3, dx = r * ax * Math.SQRT1_2, dz = r * az * Math.SQRT1_2;
        pos.push(-dx, -r, -dz, dx, -r, dz, dx, r, dz, -dx, r, -dz);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        for (let k = 0; k < 4; k++) nor.push(-az * Math.SQRT1_2, 0, ax * Math.SQRT1_2);
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setIndex(idx);
      return g;
    })();
    const texs = new Map(), mcTexs = new Map(), pools = new Map();
    const M = new THREE.Matrix4(), V = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), C = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
    function tex(layer) {
      let t = texs.get(layer);
      if (!t) {
        t = new THREE.CanvasTexture(game.icons.layerCanvas(layer));
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        texs.set(layer, t);
      }
      return t;
    }
    function mcTex(s) {
      let t = mcTexs.get(s);
      if (!t) {
        t = new THREE.CanvasTexture(game.mcPaleta.icone(s, 64));
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        mcTexs.set(s, t);
      }
      return t;
    }
    const objTexs = new Map();
    function objTex(s) { let t = objTexs.get(s); if (!t) { t = new THREE.CanvasTexture(objIcones.icone(s, 64)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; objTexs.set(s, t); } return t; }
    function materials(b, s) {
      if (isObj(b, s)) return new THREE.MeshLambertMaterial({ map: objTex(s), alphaTest: 0.35, side: THREE.DoubleSide });   // objeto: o ícone em duas plaquinhas cruzadas
      if (s >= MC_BASE && game.mcPaleta) return new THREE.MeshLambertMaterial({ map: mcTex(s), alphaTest: 0.4 });
      const kind = KIND[b], cut = kind === K_CUTOUT || kind === K_CROSS;
      if (kind === K_CROSS) return new THREE.MeshLambertMaterial({ map: tex(TEX[b * 6]), alphaTest: 0.5, side: THREE.DoubleSide });
      const byLayer = new Map(), out = [];
      for (let f = 0; f < 6; f++) {   // ordem das faces do BoxGeometry = a do LAVRA: +X −X +Y −Y +Z −Z
        const L = TEX[b * 6 + f];
        let m = byLayer.get(L);
        if (!m) { m = new THREE.MeshLambertMaterial({ map: tex(L), alphaTest: cut ? 0.5 : 0, side: cut ? THREE.DoubleSide : THREE.FrontSide }); byLayer.set(L, m); }
        out.push(m);
      }
      return out;
    }
    function ensure(p, need) {
      if (p.mesh && need <= p.cap) return;
      let cap = Math.max(16, p.cap);
      while (cap < need) cap *= 2;
      p.mats ||= materials(p.b, p.s);
      const mesh = new THREE.InstancedMesh(isObj(p.b, p.s) || (p.s < MC_BASE && KIND[p.b] === K_CROSS) ? crossGeo : boxGeo, p.mats, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.name = 'itens-' + p.b + (p.s ? '-' + p.s : '');
      if (p.mesh) {         // cresceu no meio do quadro: leva o que já foi posto
        mesh.instanceMatrix.array.set(p.mesh.instanceMatrix.array.subarray(0, p.n * 16));
        mesh.instanceColor.array.set(p.mesh.instanceColor.array.subarray(0, p.n * 3));
        root.remove(p.mesh);
        p.mesh.dispose();
      }
      root.add(mesh);
      p.mesh = mesh;
      p.cap = cap;
    }
    return {
      begin() { for (const p of pools.values()) p.n = 0; },
      put(x, y, z, yaw, scale, b, s, n, light) {
        if (!game.icons && !isObj(b, s)) return;
        if (isTesouro(b)) { b = aparenciaDe(b); s = 0; }   // tesouro: cubinho com o desenho da aparência
        const key = s >= MC_BASE ? itemKey(b, s) : b;
        let p = pools.get(key);
        if (!p) { p = { b, s: s || 0, mesh: null, cap: 0, n: 0, mats: null }; pools.set(key, p); }
        ensure(p, p.n + 1);
        M.compose(V.set(x, y, z), Q.setFromAxisAngle(UP, yaw), S.setScalar(scale));
        p.mesh.setMatrixAt(p.n, M);
        p.mesh.setColorAt(p.n, C.setScalar(light));
        p.n++;
      },
      end() {
        for (const p of pools.values()) {
          if (!p.mesh) continue;
          p.mesh.count = p.n;
          p.mesh.visible = p.n > 0;
          p.mesh.instanceMatrix.needsUpdate = true;
          p.mesh.instanceColor.needsUpdate = true;
        }
      },
      hide() { root.visible = false; },
      show() { root.visible = true; },
    };
  }
  const provisional = provisionalSkin();
  let skin = provisional;

  // Pilha maior aparece com mais cubinhos (como no Minecraft): 1, 2, 3 ou 4.
  const COPIES = [[0, 0, 0], [0.07, 0.05, 0.06], [-0.06, 0.1, -0.05], [0.04, 0.15, -0.07]];
  const copiesOf = (n) => (n >= 32 ? 4 : n >= 16 ? 3 : n >= 2 ? 2 : 1);

  const tmp = [0, 0, 0];
  function whereIs(who) {
    if (who === net.id) { tmp[0] = player.pos[0]; tmp[1] = player.pos[1] + 1.0; tmp[2] = player.pos[2]; return tmp; }
    const a = avatars.list.get(who);
    if (!a || !a.pos) return null;
    tmp[0] = a.pos[0]; tmp[1] = a.pos[1] + 0.9; tmp[2] = a.pos[2];
    return tmp;
  }

  // ---- por quadro ----------------------------------------------------------------------------------------------------
  let nearCount = 0;
  // Fora do criativo a barra de atalhos são os 9 primeiros espaços da mochila, com a contagem em cada um.
  function hotbarFromBag() {
    const on = !!game.modeRules && !game.modeRules.criativo;
    if (on) {
      for (let i = 0; i < 9; i++) {
        const item = bag.l[i];
        const obj = item && isObj(item[0], item[1]) ? item[1] : 0;
        game.hotbarObj[i] = obj;
        game.hotbar[i] = !item || obj || isTesouro(item[0]) ? 0 : (item[1] >= MC_BASE ? item[1] : item[0]);
      }
    } else if (game.hotbarObj.some(Boolean)) game.hotbarObj.fill(0);
    const slots = ui.el.hotbar.children;
    for (let i = 0; i < slots.length && i < 9; i++) {
      // tesouro na barra (arma lendária, gema…): não é bloco, não se põe; o desenho vem do ícone do item
      const t = on && bag.l[i] && isTesouro(bag.l[i][0]) ? bag.l[i][0] : 0, cv = slots[i].querySelector('canvas');
      if (cv && slots[i]._tesouro !== t) { slots[i]._tesouro = t; if (t) { slots[i]._item = 0; icon(cv, t, 0, 64); slots[i].title = itemName(t, 0); } else slots[i]._item = undefined; }   // _item = 0: a ui.js não apaga o desenho
      let c = slots[i].querySelector('b.conta');
      if (!c) { c = h('b', { class: 'conta' }); slots[i].prepend(c); }   // antes: ui.js desenha o ícone no último filho (o canvas)
      const want = on && bag.l[i] && bag.l[i][2] > 1 ? String(bag.l[i][2]) : '';
      if (c.textContent !== want) c.textContent = want;
      // objeto na barra: o ui.js vê o espaço como vazio; o ícone e o nome entram por cima (todo quadro: são 9 no máximo)
      const o = game.hotbarObj[i];
      if (o && cv && cv.getContext) { const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, 64, 64); ctx.drawImage(objIcones.icone(o, 64), 0, 0); const nome = itemName(0, o); if (slots[i].title !== nome) { slots[i].title = nome; slots[i].setAttribute('aria-label', nome); } slots[i]._obj = o; }
      else if (slots[i]._obj) { slots[i]._obj = 0; if (!t) slots[i]._item = undefined; }   // saiu o objeto: o ui.js redesenha o espaço
    }
  }
  game.hooks.frame.push((dt) => {
    const t = now();
    hotbarFromBag();
    const show = game.ready && (game.state === 'PLAYING' || game.state === 'PAUSED');
    skin.begin();
    nearCount = 0;
    if (show) {
      const follow = 1 - Math.exp(-dt * 22);
      for (const it of [...list.values()]) {
        let scale = 1;
        if (it.gone) {
          const g = it.gone, k = Math.min(1, (t - g.t0) / FLY);
          let to = null;
          if (g.who) to = whereIs(g.who);
          else if (g.into) { const o = list.get(g.into); to = o ? o.p : null; }
          if (to) for (let a = 0; a < 3; a++) it.p[a] = g.from[a] + (to[a] - g.from[a]) * k * k;
          scale = g.fade ? 1 - k : 1 - 0.6 * k;
          if (k >= 1) { list.delete(it.id); continue; }
        } else if (it.v && t - it.born < 0.2) {
          // até chegar a primeira posição do servidor, o item segue o pulo que nasceu com ele
          it.v[1] -= 16 * dt;
          for (let a = 0; a < 3; a++) it.p[a] += it.v[a] * dt;
        } else {
          for (let a = 0; a < 3; a++) it.p[a] += (it.to[a] - it.p[a]) * follow;
          if (!bag.auto && inHandReach(player.pos, it.p)) nearCount++;
        }
        const yaw = t * 1.1 + it.phase, bob = 0.07 + 0.05 * Math.sin(t * 2.4 + it.phase);
        const light = lightProbe(it.p[0], it.p[1] + 0.3, it.p[2]);
        const copies = copiesOf(it.n), c = Math.cos(yaw), s = Math.sin(yaw);
        for (let k = 0; k < copies; k++) {
          const o = COPIES[k];
          skin.put(it.p[0] + (o[0] * c + o[2] * s) * scale, it.p[1] + bob + o[1] * scale, it.p[2] + (o[2] * c - o[0] * s) * scale,
            yaw + k * 0.5, scale, it.b, it.s, it.n, light, it);
        }
      }
    }
    skin.end();
    frameFeed(t);
    if (game.overlay === 'palette' && bagEl.parentNode !== ui.paletteExtra()) placeBag();
    // tecla P (Select no controle): pega o que estiver perto, com a coleta automática ligada ou não
    if (game.state === 'PLAYING' && !game.overlay && input.wasPressed('collect')) collectNear();
  });

  function collectNear() {
    if (net.offline) return ui.toast('Sem servidor, quebrar não solta itens.');
    let n = 0;
    for (const it of list.values()) if (!it.gone && inHandReach(player.pos, it.p)) n++;
    if (!n) return ui.toast('Nada para pegar a até 3 m.', 1600);
    net.send({ t: 'pegar' });
  }

  // ---- interface: "+3 Terra" ao pegar, e a mochila na tela de blocos -------------------------------------------------
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const feedEl = h('div', { class: 'itens-feed', 'aria-live': 'polite' });
  const hintEl = h('div', { class: 'itens-dica hide' });
  feedEl.append(hintEl);
  ui.el.hud.append(feedEl);
  const feed = new Map();     // chave do item -> linha
  function icon(cv, b, s, size) {
    const ctx = cv.getContext('2d');
    if (isObj(b, s)) { ctx.clearRect(0, 0, size, size); ctx.drawImage(objIcones.icone(s, size), 0, 0, size, size); return; }
    if (!game.icons) return;
    ctx.clearRect(0, 0, size, size);
    if (isTesouro(b)) ctx.drawImage(game.icons.icon(aparenciaDe(b), size), 0, 0, size, size);   // provisório (Astra)
    else if (s >= MC_BASE && game.mcPaleta) ctx.drawImage(game.mcPaleta.icone(s, size), 0, 0, size, size);
    else ctx.drawImage(game.icons.icon(b, size), 0, 0, size, size);
  }
  function feedAdd(b, s, n) {
    const key = itemKey(b, s);
    let f = feed.get(key);
    if (!f) {
      const cv = h('canvas', { width: 52, height: 52 }), label = h('span');
      f = { el: h('div', { class: 'itens-linha' }, cv, label), label, n: 0, t: 0 };
      icon(cv, b, s, 52);
      feedEl.insertBefore(f.el, hintEl);
      feed.set(key, f);
    }
    f.n += n;
    f.t = performance.now();
    f.label.textContent = `+${f.n} ${itemName(b, s)}`;
    f.el.classList.remove('out');
  }
  function frameFeed() {
    const ms = performance.now();
    for (const [k, f] of feed) {
      const age = ms - f.t;
      if (age > FEED_MS) f.el.classList.add('out');
      if (age > FEED_MS + 450) { f.el.remove(); feed.delete(k); }
    }
    const want = nearCount ? `${game.toque ? 'Pegar' : 'P'} pega ${nearCount === 1 ? 'o item' : nearCount + ' itens'} aqui perto` : '';
    if (hintEl.textContent !== want) { hintEl.textContent = want; hintEl.classList.toggle('hide', !want); }
    // toque: sem tecla P, um botão "Pegar" aparece só quando há item ao alcance (com a coleta automática desligada)
    if (pegarBtn) {
      const mostra = !!nearCount && game.state === 'PLAYING' && !game.overlay;
      if (pegarBtn.classList.contains('hide') === mostra) pegarBtn.classList.toggle('hide', !mostra);
      if (mostra) { const t = nearCount > 1 ? `Pegar ${nearCount}` : 'Pegar'; if (pegarBtn.textContent !== t) pegarBtn.textContent = t; }
    }
  }

  // botão no canto: abre a tela de blocos, onde fica a mochila
  const cornerBtn = h('button', { class: 'btn small btn-mochila', type: 'button', text: 'Mochila', title: 'Mochila: o que você pegou (tecla E)', onclick: () => { if (game.state === 'PLAYING') openOverlay('palette'); } });
  ui.el.corner.prepend(cornerBtn);
  const pegarBtn = game.toque ? h('button', { class: 'btn small btn-pegar hide', type: 'button', text: 'Pegar', title: 'Pega os itens a até 3 m (tecla P no PC)', onclick: () => { if (game.state === 'PLAYING' && !game.overlay) collectNear(); } }) : null;
  if (pegarBtn) { pegarBtn.addEventListener('pointerdown', (e) => e.stopPropagation()); ui.el.corner.prepend(pegarBtn); }

  const bagEl = h('div', { class: 'mochila' });
  let craftEl = null;
  function placeBag() { ui.paletteExtra().prepend(bagEl); }
  placeBag();
  function largar(k, all) {
    const e = bag.l[k];
    if (!e || net.offline) return;
    net.send({ t: 'largar', k, n: all ? e[2] : 1 });
  }
  const throwSel = (all) => largar(sel, all);
  const trocar = (a, b) => { if (a >= 0 && b >= 0 && a !== b && !net.offline) net.send({ t: 'troca', a, b }); };
  function alternarColeta() { if (net.offline) return; bag.auto = !bag.auto; net.send({ t: 'coleta', on: bag.auto }); renderBag(); }
  function renderBag() {
    const total = bagTotal(bag.l), used = bagUsed(bag.l);
    cornerBtn.textContent = total ? `Mochila ${total}` : 'Mochila';
    if (ui.el.invBtn) { ui.el.invBtn.dataset.n = total ? String(total) : ''; }
    const toggle = h('button', {
      class: 'btn small' + (bag.auto ? ' on' : ''), type: 'button',
      text: bag.auto ? 'Pegar ao passar: ligado' : 'Pegar ao passar: desligado',
      title: bag.auto ? 'O que estiver perto entra sozinho. Clique para pegar só com a tecla P.' : 'Nada entra sozinho; a tecla P pega o que estiver a até 3 m. Clique para ligar.',
      onclick: alternarColeta,
    });
    const grid = h('div', { class: 'mochila-grade' });
    for (let i = 0; i < BAG_SLOTS; i++) {
      const e = bag.l[i];
      const bar = i < 9 && game.modeRules && !game.modeRules.criativo ? ' barra' : '';
      const move = () => { trocar(sel, i); sel = -1; renderBag(); };   // item escolhido vai para este espaço
      if (!e) { grid.append(h('button', { class: 'cell vazio' + bar, type: 'button', 'aria-label': 'espaço vazio', onclick: () => { if (sel >= 0) move(); } })); continue; }
      const tz = tesouroDe(e[0]);
      const name = itemName(e[0], e[1]) + (tz ? ` — ${NOME_RARIDADE[tz.raridade]}, vale ${textoDoValor(valorDe(e[0]))}${tz.arma ? ' (arma lendária)' : ''}` : '');
      const cv = h('canvas', { width: 64, height: 64 });
      icon(cv, e[0], e[1], 64);
      grid.append(h('button', {
        class: 'cell' + (i === sel ? ' on' : '') + bar, type: 'button', title: `${e[2]} ${name}`, 'aria-label': `${e[2]} ${name}`,
        onclick: () => { if (sel >= 0 && sel !== i) return move(); sel = sel === i ? -1 : i; renderBag(); },
      }, cv, h('small', { text: String(e[2]) })));
    }
    const s = sel >= 0 ? bag.l[sel] : null;
    const actions = h('div', { class: 'mochila-acoes' },
      h('button', { class: 'btn small', type: 'button', text: 'Largar 1', disabled: !s, onclick: () => throwSel(false) }),
      h('button', { class: 'btn small', type: 'button', text: 'Largar tudo', disabled: !s, onclick: () => throwSel(true) }),
      h('span', { class: 'note', text: net.offline ? 'Sem servidor, quebrar não solta itens.'
        : s ? `${s[2]} ${itemName(s[0], s[1])}: largar joga na sua frente; tocar noutro espaço muda de lugar.`
        : game.modeRules && !game.modeRules.criativo ? 'Os 9 primeiros espaços são a barra. Toque num item e depois noutro espaço para trocar de lugar. P pega o que estiver perto.'
        : 'No criativo, quebrar não solta item (como no Minecraft). Os itens que você pegar ficam aqui.' }));
    bagEl.replaceChildren(
      h('div', { class: 'mochila-topo' }, h('b', { text: 'Mochila' }), h('span', { text: `${total} ${total === 1 ? 'item' : 'itens'} · ${used} de ${BAG_SLOTS} espaços` }), toggle),
      grid, actions);
    if (craftEl) bagEl.append(craftEl);
  }
  renderBag();

  const api = {
    list, get bag() { return bag; },
    setSkin(s) { if (skin === provisional && s) provisional.hide(); skin = s || provisional; if (skin === provisional) provisional.show(); },
    on(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    collectNear,
    trocar, largar, alternarColeta,
    render: renderBag,
    icon,
    setCraftMount(el) { craftEl = el; renderBag(); },
  };
  game.items = api;
  // a mochila desenha os ícones quando eles ficam prontos (as texturas são pintadas depois de a página abrir)
  const waitIcons = setInterval(() => { if (game.icons) { clearInterval(waitIcons); renderBag(); } }, 500);
  return api;
}
