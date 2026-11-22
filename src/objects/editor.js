// LAVRA — ferramenta de objetos: colocar formas, importar imagens e modelos .glb,
// criar esfera-ambiente e editar tamanho/rotação/material de qualquer objeto.

import * as THREE from '../three.js';
import { BLOCKS, KIND, K_AIR, B, REPLACEABLE } from '../../shared/blocks.js';
import { h } from '../ui/ui.js';
import { createObjects, OF_SOLID, OF_UNLIT, OF_INSIDE, OF_HOLLOW, OF_MESH } from './objects.js';
import { SHAPES, PAINEL_ESPESSURA, shapeGeometry } from './shapes.js';
import { ORIENT_LABEL, stepSize, mainSize, shapePlaceQuat, faceAnchor, mockupHold } from './sizing.js';
import { initMao } from './mao.js';   // pegar, levar e soltar peças; pôr no ar; ímã; conjuntos; pré-formas (20/11)

const r2 = (v) => Math.round(v * 100) / 100;
const snap = (v) => Math.round(v * 8) / 8;
import { FORMAS_LENHA } from '../../shared/corte-tora.js';
const NAMES = Object.fromEntries([...SHAPES, ...FORMAS_LENHA.map(s => [s, 'Meia tora']), ['modelo', 'Modelo 3D']]);

export function initObjects(ctx) {
  const { game, player, net, ui, input, scene, camera, interaction, store, lightProbe, openOverlay, closeOverlay, atmosphere, world } = ctx;
  const objects = createObjects({ scene, game, net, camera, lightProbe, ui, store, icons: () => game.icons });
  game.objects = objects;
  game.localFiles = new Map();
  player.extra = (p) => objects.collide(p);

  // contorno do objeto mirado (o fantasma da forma a colocar e a peça na mão são de objects/mao.js)
  let mao = null;
  const sel = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xf4a64e, transparent: true, opacity: 0.9, depthTest: false }));
  sel.visible = false; sel.renderOrder = 8; scene.add(sel);
  const showSel = (e) => {
    sel.visible = !!e;
    if (!e) return;
    sel.position.set(e.o.p[0], e.o.p[1], e.o.p[2]);
    sel.quaternion.set(e.o.q[0], e.o.q[1], e.o.q[2], e.o.q[3]);
    sel.scale.set(e.o.k[0] + 0.02, e.o.k[1] + 0.02, (e.o.s === 'painel' ? Math.max(0.08, e.o.k[2]) : e.o.k[2]) + 0.02);
  };

  // ---- envio de arquivos ---------------------------------------------------------------------
  let localN = 0;
  async function upload(blob, tipo) {
    if (net.offline) {
      const ext = tipo === 'glb' ? 'glb' : blob.type === 'image/png' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp';
      const id = 'local' + String(++localN).padStart(15, '0') + '.' + ext;
      game.localFiles.set(id, URL.createObjectURL(blob));
      ui.toast('Modo offline: este arquivo vale só até fechar a página.');
      return id;
    }
    const res = await fetch(`api/enviar?mundo=${encodeURIComponent(game.slug)}&tipo=${tipo}`, {
      method: 'POST', headers: { 'X-Lavra-Chave': net.key, 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.id) throw new Error(j.erro || 'envio recusado');
    return j.id;
  }

  // Reduz a imagem (no máximo 2048 px; panorama 2:1 até 4096) e codifica leve.
  async function prepareImage(file) {
    const bmp = await createImageBitmap(file);
    const pano = Math.abs(bmp.width / bmp.height - 2) < 0.06;
    const max = pano ? 4096 : 2048;
    const sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * sc)), hh = Math.max(1, Math.round(bmp.height * sc));
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    const cx = c.getContext('2d');
    cx.drawImage(bmp, 0, 0, w, hh);
    // tem transparência? amostra pequena
    const t = document.createElement('canvas'); t.width = t.height = 48;
    const tx = t.getContext('2d'); tx.drawImage(bmp, 0, 0, 48, 48);
    const px = tx.getImageData(0, 0, 48, 48).data;
    let alpha = false;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 250) { alpha = true; break; }
    bmp.close?.();
    const to = (type, q) => new Promise((res) => c.toBlob(res, type, q));
    let blob = await to('image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') blob = alpha ? await to('image/png') : await to('image/jpeg', 0.88);
    return { blob, w, h: hh, pano };
  }

  function pickFile(accept) {
    return new Promise((resolve) => {
      const inp = h('input', { type: 'file', accept, style: 'display:none' });
      inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
      inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
      document.body.append(inp);
      inp.click();
    });
  }

  // posição a alguns metros na frente do jogador
  function inFront(dist, up = 0) {
    const s = Math.sin(player.yaw), c = Math.cos(player.yaw);
    return [snap(player.pos[0] - s * dist), snap(player.pos[1] + up), snap(player.pos[2] - c * dist)];
  }
  const yawQuat = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

  async function importImage(forEntry) {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      ui.toast('Preparando a imagem…', 1500);
      const img = await prepareImage(file);
      const id = await upload(img.blob, 'img');
      if (forEntry) {
        const part = { m: { t: 'i', i: id } };
        if (forEntry.o.s === 'painel') part.k = [forEntry.o.k[0], r2(forEntry.o.k[0] * img.h / img.w), forEntry.o.k[2]];
        objects.update(forEntry.o.id, part);
        refreshPanel();
      } else {
        const wide = 2;
        beginImageCarry(id, [wide, r2(wide * img.h / img.w), 0.05]);   // a imagem segue a mira até o clique (ramo exp/imagem-mockup, 20/11)
      }
    } catch (e) { ui.toast('Não consegui importar a imagem: ' + (e.message || e), 6000); }
  }

  async function importModel() {
    const file = await pickFile('.glb,model/gltf-binary');
    if (!file) return;
    if (file.size > 48 * 1024 * 1024) return ui.toast('O modelo passa de 48 MB. Exporte do Blender com texturas menores.', 6000);
    try {
      ui.toast('Enviando o modelo…', 2500);
      const id = await upload(file, 'glb');
      objects.create({ s: 'modelo', p: inFront(4, 0), q: yawQuat(player.yaw + Math.PI), k: [1, 1, 1], m: { t: 'g', i: id }, f: OF_SOLID | OF_MESH }, true);
      ui.toast('Modelo colocado no tamanho original. Mire nele e aperte F para ajustar.');
    } catch (e) { ui.toast('Não consegui importar o modelo: ' + (e.message || e), 6000); }
  }

  function envSphere() {
    objects.onCreated = (e) => { objects.onCreated = null; edit(e); };
    objects.create({ s: 'esfera', p: [r2(player.pos[0]), r2(player.pos[1] + 8), r2(player.pos[2])], q: [0, 0, 0, 1], k: [160, 160, 160], m: { t: 'c', c: '#7fb2e5' }, f: OF_UNLIT | OF_INSIDE });
    ui.toast('Esfera-ambiente criada em volta de você. Importe uma imagem 360° para forrar o lado de dentro.', 6000);
  }

  // ---- painel de edição ------------------------------------------------------------------------
  let cur = null;       // entrada em edição
  const card = h('div', { class: 'card panel' });
  const panel = h('div', { id: 'editor', class: 'screen hide' }, card);
  ui.el.hud.parentNode.append(panel);
  const numField = (label, value, step, min, max, onchange) => {
    const inp = h('input', { type: 'number', value: String(value), step, min, max, 'aria-label': label });
    inp.addEventListener('keydown', (e) => e.stopPropagation());
    inp.addEventListener('keyup', (e) => e.stopPropagation());
    inp.addEventListener('change', () => { let v = Number(inp.value); if (!Number.isFinite(v)) return; v = Math.min(max, Math.max(min, v)); inp.value = String(v); onchange(v); });
    return h('label', { class: 'field' }, h('span', { text: label }), inp);
  };
  const check = (label, bit) => {
    const inp = h('input', { type: 'checkbox' });
    inp.checked = !!(cur.o.f & bit);
    inp.addEventListener('change', () => { objects.update(cur.o.id, { f: inp.checked ? (cur.o.f | bit) : (cur.o.f & ~bit) }); });
    return h('label', { class: 'toggle' }, h('span', { text: label }), inp);
  };
  const eul = new THREE.Euler(), qq = new THREE.Quaternion();

  function refreshPanel() {
    if (!cur) return;
    const o = cur.o;
    eul.setFromQuaternion(qq.set(o.q[0], o.q[1], o.q[2], o.q[3]), 'YXZ');
    const deg = [eul.y, eul.x, eul.z].map((v) => Math.round(v * 180 / Math.PI));
    const setRot = (i, v) => {
      deg[i] = v;
      qq.setFromEuler(eul.set(deg[1] * Math.PI / 180, deg[0] * Math.PI / 180, deg[2] * Math.PI / 180, 'YXZ'));
      objects.update(o.id, { q: [qq.x, qq.y, qq.z, qq.w] });
    };
    const presetRot = (pitch, roll) => {
      deg[1] = pitch; deg[2] = roll;
      qq.setFromEuler(eul.set(pitch * Math.PI / 180, deg[0] * Math.PI / 180, roll * Math.PI / 180, 'YXZ'));
      objects.update(o.id, { q: [qq.x, qq.y, qq.z, qq.w] });
      refreshPanel();
    };
    const orientBtn = (label, pitch, roll, active) => h('button', {
      class: 'btn small' + (active ? ' on' : ''), type: 'button', text: label, onclick: () => presetRot(pitch, roll),
    });
    const setK = (i, v) => { const k = [...o.k]; k[i] = v; objects.update(o.id, { k }); };
    const setP = (i, v) => { const p = [...o.p]; p[i] = v; objects.update(o.id, { p }); };
    const scaleAll = (f) => { objects.update(o.id, { k: o.k.map((v) => Math.min(4000, Math.max(0.02, r2(v * f)))) }); refreshPanel(); };
    const rot = (label, i) => {
      const out = h('output', { text: deg[i] + '°' });
      const inp = h('input', { type: 'range', min: -180, max: 180, step: 5, value: deg[i], 'aria-label': label });
      inp.addEventListener('input', () => { out.textContent = inp.value + '°'; setRot(i, Number(inp.value)); });
      return h('div', { class: 'set' }, h('span', { text: label }), out, inp);
    };
    const color = h('input', { type: 'color', value: o.m.t === 'c' ? o.m.c : '#c8c8c8', 'aria-label': 'Cor' });
    color.addEventListener('input', () => objects.update(o.id, { m: { t: 'c', c: color.value } }));
    const isModel = o.s === 'modelo';
    // mover e guardar (objects/mao.js): pegar a peça ou o conjunto dela, soltar do conjunto, guardar como pré-forma
    const conj = o.g ? objects.membros(o.g) : null;
    const movel = mao.colavel(o);
    const nomePf = h('input', { type: 'text', maxlength: 40, placeholder: 'Nome da pré-forma', 'aria-label': 'Nome da pré-forma', style: 'flex:1;min-width:0;padding:8px 10px;border-radius:10px' });
    const guardar = () => { if (mao.salvarPreforma(cur, nomePf.value)) nomePf.value = ''; };
    nomePf.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Enter') guardar(); });
    nomePf.addEventListener('keyup', (e) => e.stopPropagation());
    const pegarDaqui = (so) => { const e = cur; closeOverlay(); mao.pegar(e, so); };
    card.replaceChildren(...[
      h('div', { class: 'row' }, h('h2', { text: NAMES[o.s] || 'Objeto' }), h('button', { class: 'btn small', type: 'button', text: 'Concluir', onclick: () => closeOverlay() })),
      movel ? h('h3', { text: conj ? `Conjunto de ${conj.length} peças` : 'Mover e guardar' }) : null,
      movel ? h('div', { class: 'row' },
        h('button', { class: 'btn small teal', type: 'button', text: conj ? 'Pegar o conjunto' : 'Pegar', title: 'Leva na mão: botão direito solta, Q cancela (tecla Q, mirando a peça)', onclick: () => pegarDaqui(false) }),
        conj ? h('button', { class: 'btn small', type: 'button', text: 'Pegar só esta', title: 'A peça sai do conjunto e vem para a mão (Shift+Q)', onclick: () => pegarDaqui(true) }) : null) : null,
      movel && conj ? h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', text: 'Soltar esta peça', title: 'A peça sai do conjunto e fica onde está', onclick: () => mao.soltarPeca(cur, false) }),
        h('button', { class: 'btn small', type: 'button', text: 'Desfazer conjunto', title: 'Todas as peças ficam soltas, onde estão', onclick: () => mao.soltarPeca(cur, true) })) : null,
      movel ? h('div', { class: 'row' }, nomePf,
        h('button', { class: 'btn small', type: 'button', text: 'Guardar como pré-forma', title: conj ? 'Guarda o conjunto inteiro com esse nome; depois ele aparece na tela de blocos (E)' : 'Guarda esta peça com esse nome; depois ela aparece na tela de blocos (E)', onclick: guardar })) : null,
      isModel ? null : h('div', { class: 'shapes' }, SHAPES.map(([s, label]) => h('button', {
        class: 'btn small' + (s === o.s ? ' on' : ''), type: 'button', text: label, onclick: () => { objects.update(o.id, { s }); refreshPanel(); },
      }))),
      h('h3', { text: 'Tamanho (metros)' }),
      h('div', { class: 'tri' }, numField('Largura', o.k[0], 0.25, 0.02, 4000, (v) => setK(0, v)), numField('Altura', o.k[1], 0.25, 0.02, 4000, (v) => setK(1, v)), numField('Fundo', o.k[2], 0.25, 0.02, 4000, (v) => setK(2, v))),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', text: '÷ 2', onclick: () => scaleAll(0.5) }),
        h('button', { class: 'btn small', type: 'button', text: '− 10%', onclick: () => scaleAll(0.9) }),
        h('button', { class: 'btn small', type: 'button', text: '+ 10%', onclick: () => scaleAll(1.1) }),
        h('button', { class: 'btn small', type: 'button', text: '× 2', onclick: () => scaleAll(2) })),
      h('h3', { text: 'Posição' }),
      h('div', { class: 'tri' }, numField('X', o.p[0], 0.125, -1e6, 1e6, (v) => setP(0, v)), numField('Y', o.p[1], 0.125, -500, 3000, (v) => setP(1, v)), numField('Z', o.p[2], 0.125, -1e6, 1e6, (v) => setP(2, v))),
      h('h3', { text: 'Rotação' }),
      h('div', { class: 'tri' },
        orientBtn('Vertical', 0, 0, Math.abs(deg[1]) < 15 && Math.abs(deg[2]) < 15),
        orientBtn('Horiz. ↕', -90, 0, Math.abs(Math.abs(deg[1]) - 90) < 15 && Math.abs(deg[2]) < 15),
        orientBtn('Horiz. ↔', 0, 90, Math.abs(Math.abs(deg[2]) - 90) < 15 && Math.abs(deg[1]) < 15)),
      rot('Girar', 0), rot('Inclinar', 1), rot('Tombar', 2),
      isModel ? null : h('h3', { text: 'Material' }),
      isModel ? null : h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', text: 'Bloco da barra', title: 'Usa o bloco selecionado na barra de atalhos', onclick: () => { const b = game.hotbar[game.sel]; if (b && b < BLOCKS.length && KIND[b] !== K_AIR) { objects.update(o.id, { m: { t: 'b', b } }); } } }),
        h('button', { class: 'btn small', type: 'button', text: 'Imagem…', onclick: () => importImage(cur) }),
        h('label', { class: 'btn small colorbtn' }, 'Cor ', color)),
      h('h3', { text: 'Comportamento' }),
      check('Sólido (dá para pisar e esbarrar)', OF_SOLID),
      isModel ? check('Colisão pela malha do modelo', OF_MESH) : check('Oco (só a casca colide)', OF_HOLLOW),
      isModel ? null : check('Brilho próprio (não escurece à noite)', OF_UNLIT),
      isModel ? null : check('Visível por dentro (esfera-ambiente)', OF_INSIDE),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', text: 'Duplicar', onclick: () => { const c = { s: o.s, p: [o.p[0] + o.k[0], o.p[1], o.p[2]], q: o.q, k: o.k, m: o.m, f: o.f }; closeOverlay(); objects.create(c); } }),
        h('button', { class: 'btn small', type: 'button', text: 'Apagar', onclick: () => { const id = o.id; closeOverlay(); objects.destroy(id); } }),
        movel && conj ? h('button', { class: 'btn small', type: 'button', text: 'Apagar o conjunto', title: `Tira do mundo as ${conj.length} peças do conjunto`, onclick: () => { const e = cur; closeOverlay(); mao.apagarConjunto(e); } }) : null),
      h('p', { class: 'note', text: o.by ? `Criado por ${o.by}.` : '' })].filter(Boolean));
  }
  function edit(e) {
    cur = e; objects.editing = e.o.id;
    openOverlay('editor');
    panel.classList.remove('hide');
    refreshPanel();
  }
  objects.onRemoved = (id) => { if (cur && cur.o.id === id) closeOverlay(); };

  // ---- paleta: formas e importações --------------------------------------------------------------
  let curOrient = store.get('forma.orient', 'v') === 'h' ? 'h' : 'v';
  let btnVert = null, btnHoriz = null;
  const syncOrientBtns = () => {
    btnVert?.classList.toggle('on', curOrient === 'v');
    btnHoriz?.classList.toggle('on', curOrient === 'h');
  };
  const setOrient = (o) => {
    curOrient = o === 'h' ? 'h' : 'v';
    store.set('forma.orient', curOrient);
    if (game.tool && game.tool.type === 'shape') {
      game.tool.o = curOrient;
      rememberTool(game.tool);
    }
    syncOrientBtns();
  };
  function fillPalette() {
    const row = ui.paletteExtra();
    btnVert = h('button', { class: 'btn small', type: 'button', text: 'Vertical', onclick: () => setOrient('v') });
    btnHoriz = h('button', { class: 'btn small', type: 'button', text: 'Horizontal', onclick: () => setOrient('h') });
    syncOrientBtns();
    row.replaceChildren(
      h('div', { class: 'orient-bar' }, h('span', { text: 'Posição das formas:' }), btnVert, btnHoriz),
      h('div', { class: 'shapes wide' },
        SHAPES.map(([s, label]) => h('button', { class: 'btn small', type: 'button', text: label, onclick: () => { setTool(s); closeOverlay(); } })),
        h('button', { class: 'btn small teal', type: 'button', text: 'Imagem…', onclick: () => { closeOverlay(); importImage(null); } }),
        h('button', { class: 'btn small teal', type: 'button', text: 'Modelo .glb…', onclick: () => { closeOverlay(); importModel(); } }),
        h('button', { class: 'btn small teal', type: 'button', text: 'Esfera-ambiente', onclick: () => { closeOverlay(); envSphere(); } })),
      mao.faixa);                                 // pré-formas guardadas e o botão do ímã (objects/mao.js)
  }
  const ehTronco = (b) => b === B.LOG || b === B.PINE_LOG;
  function setTool(shape) {
    const last = store.get('forma.' + shape, null);
    let k = last && last.k ? last.k : shape === 'painel' ? [2, 2, PAINEL_ESPESSURA] : shape === 'toro' ? [2, 0.6, 2] : shape === 'tora' ? [0.5, 2, 0.5] : [1, 1, 1];
    if (shape === 'painel' && !(k[2] >= PAINEL_ESPESSURA)) k = [k[0], k[1], PAINEL_ESPESSURA];   // o tamanho lembrado de antes era da folha fina
    let b = game.hotbar[game.sel];
    if (shape === 'tora' && !ehTronco(b)) b = B.LOG;          // a tora nasce de tronco; 1–9 troca por qualquer bloco da barra
    const r = last && Number.isFinite(last.r) ? last.r : 0;   // giro extra em graus (T/G)
    const i = last && Number.isFinite(last.i) ? last.i : 0;   // inclinação extra em graus (Y/H)
    const o = curOrient;
    // `sel` = o espaço da barra em que o material foi escolhido: o material só troca quando a escolha na barra mudar
    game.tool = { type: 'shape', s: shape, k, r, i, o, sel: game.sel, m: b && b < BLOCKS.length && KIND[b] !== K_AIR ? { t: 'b', b } : { t: 'c', c: '#c8c8c8' }, f: OF_SOLID };
    ui.toast(toque()
      ? `${NAMES[shape]} (${ORIENT_LABEL[o]}): toque para pôr; os botões da forma mudam tamanho, giro e posição.`
      : `${NAMES[shape]} (${ORIENT_LABEL[o]}): botão direito põe · a roda afasta e aproxima (põe até no ar) · I liga/desliga o ímã · o resto das teclas está no quadro à esquerda.`, 5600);
  }
  const rememberTool = (t) => store.set('forma.' + t.s, { k: [...t.k], r: t.r || 0, i: t.i || 0, o: t.o || curOrient });
  const toque = () => ui.el.hud.classList.contains('toque');

  // ---- mensagens e quadro -------------------------------------------------------------------------
  game.hooks.other.push((m) => {
    if (m.t === 'welcome') objects.loadAll(m.objects);
    else if (m.t === 'offline') objects.loadAll(store.get('off.obj.' + m.slug, []));
    else if (m.t === 'o+' || m.t === 'o~' || m.t === 'o-' || (m.t === 'pc' && m.op === 'rachada')) objects.onMessage(m);
    else if (m.t === 'overlay-closed' && m.was === 'editor') { panel.classList.add('hide'); cur = null; objects.editing = 0; }
    else if (m.t === 'overlay-closed' && m.was === 'palette') { /* nada */ }
    else if (m.t === 'boot') fillPalette();
  });
  game.hooks.frame.push((dt) => {
    mao.frame();                // com forma escolhida ou peça na mão, as teclas mudam de papel (input.shapeMode)
    if (game.tool && game.tool.type === 'image') input.shapeMode = true;   // imagem na mira: R/F mudam o tamanho
    objects.frame(dt);
    atmosphere.state.envInside = !!objects.inside;
    if (cur && panel.classList.contains('hide') === false) showSel(cur);
  });

  // ---- imagem na mira (ramo exp/imagem-mockup, 20/11; portado para a estrutura do mao.js em 22/11) -------------
  // Importada a imagem, ela segue a mira encostada no que se olha: R/F mudam o tamanho, o clique posiciona e segurar
  // o clique sobre a mesma face de um bloco por MOCKUP_HOLD a encosta no centro daquela face (mockup). B/ferramenta
  // cancela. O mao.js só cuida de ferramenta do tipo 'shape'; a imagem é tratada aqui, antes dele.
  const imgGhost = new THREE.Mesh(shapeGeometry('painel'), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.94, depthWrite: false, side: THREE.DoubleSide }));
  imgGhost.visible = false; imgGhost.renderOrder = 7; scene.add(imgGhost);
  let carry = { down: false, key: null, t: 0 };
  const MOCKUP_HOLD = 0.55;
  const fmtM = (v) => (v >= 10 ? Math.round(v) : Math.round(v * 100) / 100).toString().replace('.', ',');
  const ivq = new THREE.Quaternion(), iax = new THREE.Vector3();
  function endCarry() {
    const map = imgGhost.material.map;
    imgGhost.material.map = null; imgGhost.material.color.set(0xffffff);
    if (map) map.dispose();
    imgGhost.visible = false;
    carry = { down: false, key: null, t: 0 };
    if (game.tool && game.tool.type === 'image') game.tool = null;
  }
  function beginImageCarry(id, k) {
    endCarry();
    game.tool = { type: 'image', id, k: [...k] };
    const url = game.localFiles.get(id) || `f/${encodeURIComponent(game.slug)}/${id}`;
    new THREE.TextureLoader().load(url, (t) => {
      if (!game.tool || game.tool.type !== 'image' || game.tool.id !== id) { t.dispose(); return; }
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      imgGhost.material.map = t; imgGhost.material.needsUpdate = true;
    });
    ui.toast('Imagem na mira. R aumenta, F diminui. Clique posiciona. Segure sobre um bloco para virar mockup.', 6500);
  }
  function poseOn(pt, n, k) {
    const flat = Math.abs(n[1]) >= 0.7;
    const pq = shapePlaceQuat('painel', player.yaw, n, 0, flat ? 'h' : 'v');
    ivq.set(pq[0], pq[1], pq[2], pq[3]);
    let ext = 0;
    const kk = [k[0], k[1], 0.06];
    for (let i = 0; i < 3; i++) {
      iax.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(ivq);
      ext += Math.abs(iax.x * n[0] + iax.y * n[1] + iax.z * n[2]) * kk[i] / 2;
    }
    return { p: [snap(pt[0] + n[0] * ext), snap(pt[1] + n[1] * ext), snap(pt[2] + n[2] * ext)], q: [ivq.x, ivq.y, ivq.z, ivq.w] };
  }
  const dropImage = (p, q, k, id) => objects.create({ s: 'painel', p, q, k: [...k], m: { t: 'i', i: id }, f: OF_SOLID });
  function carryImage(dt, playing, o, d) {
    const tool = game.tool;
    if (input.wasPressed('tool')) { endCarry(); return true; }
    let mudou = false;
    if (input.wasPressed('grow')) { tool.k = stepSize(tool.k, +1, true); mudou = true; }
    if (input.wasPressed('shrink')) { tool.k = stepSize(tool.k, -1, true); mudou = true; }
    if (mudou) game.audio?.play('tick', 0.6, 1.1);
    const vox = interaction.target, tree = game.treeAim;
    let pt = null, n = null;
    if (tree && (!vox.hit || tree.t < vox.t)) { pt = tree.point; n = tree.normal; }
    else if (vox.hit) { pt = [o[0] + d[0] * vox.t, o[1] + d[1] * vox.t, o[2] + d[2] * vox.t]; n = [vox.nx, vox.ny, vox.nz]; }
    let pose;
    if (pt && n) pose = poseOn(pt, n, tool.k);
    else { const q = yawQuat(player.yaw); pose = { p: inFront(3, 1.4), q }; ivq.set(q[0], q[1], q[2], q[3]); }
    imgGhost.visible = true;
    imgGhost.position.set(pose.p[0], pose.p[1], pose.p[2]);
    imgGhost.quaternion.copy(ivq);
    imgGhost.scale.set(tool.k[0], tool.k[1], 1);
    const noBloco = vox.hit && vox.id && !REPLACEABLE[vox.id] && !(tree && tree.t < vox.t);
    const faceKey = noBloco ? `${vox.x},${vox.y},${vox.z},${vox.nx},${vox.ny},${vox.nz}` : null;
    const next = mockupHold(carry, { down: !!(playing && input.isDown('place')), faceKey, dt, hold: MOCKUP_HOLD });
    carry = { down: next.down, key: next.key, t: next.t };
    imgGhost.material.color.set(next.t > 0 ? 0xffe2b0 : 0xffffff);
    if (playing && next.commit === 'mockup' && faceKey) {
      const [x, y, z, nx, ny, nz] = faceKey.split(',').map(Number);
      const flat = Math.abs(ny) >= 0.7;
      dropImage(faceAnchor(x, y, z, nx, ny, nz).map(snap), shapePlaceQuat('painel', player.yaw, [nx, ny, nz], 0, flat ? 'h' : 'v'), tool.k, tool.id);
      ui.toast('A imagem virou mockup neste bloco.');
      endCarry();
    } else if (playing && next.commit === 'place') {
      dropImage(pose.p, pose.q, tool.k, tool.id);
      ui.toast('Imagem posicionada.');
      endCarry();
    } else if (next.t > 0) ui.setHint(`Mockup neste bloco… ${Math.min(100, Math.round(next.t / MOCKUP_HOLD * 100))}%`);
    else ui.setHint(`Imagem ${fmtM(mainSize(tool.k, true))} m · R/F tamanho · clique posiciona · segure sobre um bloco para mockup`);
    return true;
  }

  // A mira sobre os objetos: editar (F), apagar (quebrar), pôr bloco encostado, pegar e levar (Q), pôr forma nova
  // (apoiada ou no ar), ímã, conjuntos e pré-formas — tudo em objects/mao.js.
  mao = initMao({
    game, player, net, ui, input, scene, interaction, store, world, objects, closeOverlay, edit, showSel,
    device: { touch: toque() }, nomes: NAMES, sincOrient: setOrient, lembrar: rememberTool,
    aoMudar: () => { if (cur && !panel.classList.contains('hide')) refreshPanel(); },
  });
  game.hooks.interact.push((dt, playing, o, d) => {
    if (game.overlay === 'editor') return true;
    if (game.tool && game.tool.type === 'image') return carryImage(dt, playing, o, d);
    return mao.interact(dt, playing, o, d);
  });

  // lembra o último tamanho usado de cada forma
  const baseUpdate = objects.update;
  objects.update = (id, part) => { baseUpdate(id, part); const e = objects.list.get(id); if (e && part.k && e.o.s !== 'modelo') { const was = store.get('forma.' + e.o.s, null); store.set('forma.' + e.o.s, { k: e.o.k, r: was && Number.isFinite(was.r) ? was.r : 0 }); if (game.tool && game.tool.s === e.o.s) game.tool.k = [...e.o.k]; } };

  return { objects, edit, importImage, importModel, envSphere, setTool, mao };
}
