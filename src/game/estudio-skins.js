import * as THREE from '../three.js';
import { normalizarSkin, CAMADAS_SKIN, PECAS_EXPLORADOR } from '../../shared/estudio-skins.js';
import { buildBody } from '../render/avatars.js';
import { aplicarSkin, limparSkin, fumacaSkin } from '../render/estudio-skins.js';
import { criarParticulasMc } from '../render/mc-particulas.js';
import { HTML_BASE, initAbaBase } from './estudio-base.js';
import { HTML_PINTOR, initPintor } from './estudio-pintor.js';
import { HTML_CRIADOR, initCriador } from './estudio-criador.js';
import { HTML_MOCKUP, initMockup } from './estudio-mockup.js';

const labels = { frente: 'Peito', costas: 'Costas', rosto: 'Rosto' };
export const arquivoSkin = (slug, id) => `f/${encodeURIComponent(slug)}/${id}`;

export function initEstudioSkins({ game, net, ui, self, avatars }) {
  const open = document.createElement('button');
  open.className = 'btn teal';
  open.textContent = 'Estúdio de skins';
  ui.el.pauseCard.children[1].after(open);

  const dialog = document.createElement('dialog');
  dialog.className = 'skin-studio';
  dialog.innerHTML = `
    <header><h2>Estúdio de skins</h2><div class="skin-actions"><button type="button" data-expand aria-label="Maximizar">⛶</button><button type="button" data-close aria-label="Fechar">×</button></div></header>
    <div class="skin-layout">
      <section class="skin-preview" aria-label="Prévia 3D">
        <div data-stage tabindex="0" aria-label="Personagem em 3D. Arraste para girar."></div>
        <label>Girar <input data-turn type="range" min="-180" max="180" value="0"></label>
        <label>Zoom <input data-zoom type="range" min=".75" max="1.4" step=".01" value="1"></label>
        <div class="skin-actions"><button data-light>Lua</button><button data-walk>Andar</button></div>
      </section>
      <section class="skin-controls" aria-label="Edição da skin">
        <div class="skin-tabs skin-sections" role="group" aria-label="Seções do estúdio">
          <button data-panel="traje">Provador</button><button data-panel="criador">Criar personagem</button><button data-panel="base">Skin (.png)</button><button data-panel="pintor">Pintor</button><button data-panel="mockup">Mockup para IA</button><button data-panel="design">Estampas e rosto</button><button data-panel="gm" hidden>Modo GM</button><button data-panel="biblioteca">Coleção</button>
        </div>
        <section data-page="traje" class="skin-page">
          <button type="button" class="skin-look" data-explorador>
            <span>Explorador</span><small>Jaqueta musgo, botas de trilha e mochila</small>
          </button>
          <fieldset><legend>Peças do look</legend>
            ${Object.entries(PECAS_EXPLORADOR).map(([key, label]) => `<label>${label}<input type="checkbox" data-piece="${key}"></label>`).join('')}
          </fieldset>
          <label>Cor da jaqueta <input data-shirt type="color" value="#465b43"></label>
          <button data-default>Restaurar aparência padrão</button>
        </section>
        <section data-page="criador" class="skin-page" hidden>${HTML_CRIADOR}</section>
        <section data-page="base" class="skin-page" hidden>${HTML_BASE}</section>
        <section data-page="pintor" class="skin-page" hidden>${HTML_PINTOR}</section>
        <section data-page="mockup" class="skin-page" hidden>${HTML_MOCKUP}</section>
        <section data-page="design" class="skin-page" hidden>
        <div class="skin-tabs" role="group" aria-label="Região da imagem">
          <button data-layer="frente">Peito</button><button data-layer="costas">Costas</button><button data-layer="rosto">Rosto</button>
        </div>
        <label><span data-filelabel>Imagem do peito</span><input data-file type="file" accept="image/png,image/jpeg,image/webp"></label>
        <button data-remove>Remover imagem</button>
        <fieldset data-transforms><legend>Posição e tamanho</legend>
          <label>Horizontal <input data-value="x" type="range" min="-1" max="1" step=".01"></label>
          <label>Vertical <input data-value="y" type="range" min="-1" max="1" step=".01"></label>
          <label>Escala <input data-value="escala" type="range" min=".1" max="3" step=".01"></label>
          <label>Giro <input data-value="giro" type="range" min="-180" max="180" step="1"></label>
          <label>Opacidade <input data-value="opacidade" type="range" min="0" max="1" step=".01"></label>
        </fieldset>
        </section>
        <section data-page="gm" class="skin-page" hidden>
        <fieldset data-gm hidden><legend>Efeitos de GM</legend>
          <label>Região <select data-effect="regiao"><option value="torso">Camisa</option><option value="head">Cabeça</option><option value="armL">Braço esquerdo</option><option value="armR">Braço direito</option><option value="legL">Perna esquerda</option><option value="legR">Perna direita</option>${Object.entries(PECAS_EXPLORADOR).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
          <label>Cor do brilho <input data-effect="cor" type="color"></label>
          <label>Brilho <input data-effect="brilho" type="range" min="0" max="1" step=".01"></label>
          <label>Reflexo <input data-effect="reflexo" type="range" min="0" max="1" step=".01"></label>
          <label>Fumaça <input data-effect="fumaca" type="range" min="0" max="1" step=".01"></label>
        </fieldset>
        </section>
        <section data-page="biblioteca" class="skin-page" hidden>
        <fieldset><legend>Minhas skins</legend>
          <label>Skin salva <select data-library></select></label>
          <label>Nome <input data-name type="text" maxlength="32" placeholder="Ex. Explorador lunar"></label>
          <div class="skin-actions"><button data-save>Salvar na coleção</button></div>
        </fieldset>
        </section>
        <p data-status role="status"></p>
        <button class="btn primary" data-apply>Aplicar no jogo</button>
      </section>
    </div>`;
  document.body.append(dialog);
  const q = (name) => dialog.querySelector(`[data-${name}]`);
  const status = (value) => { q('status').textContent = value; };
  const storage = () => `kraft.skins.${game.slug}.${game.name.toLowerCase()}`;
  const blank = () => normalizarSkin({ gm: {} }, true);
  let draft, layer, panel = 'traje', gm = false, preview, timer, uploadJob = null, walking = false, night = false;
  let aguardando = 0, esperandoInicio = null, esperaInicio = 0;
  const url = (id) => arquivoSkin(game.slug, id);
  const contexto = { dialog, draft: () => draft, requestPreview: () => requestPreview(), status: (v) => status(v), enviar: (b, t) => enviar(b, t), url, game, net,
    gmAtivo: () => gm, sync: () => sync(), aplicar: () => q('apply').click() };
  const abaBase = initAbaBase(contexto), pintor = initPintor(contexto), criador = initCriador(contexto), mockup = initMockup(contexto);

  function read() {
    try { return JSON.parse(localStorage.getItem(storage())) || { active: null, entries: [] }; }
    catch { return { active: null, entries: [] }; }
  }
  function write(data) {
    try { localStorage.setItem(storage(), JSON.stringify(data)); return true; }
    catch { status('O navegador não conseguiu salvar a skin neste aparelho.'); return false; }
  }
  function carregar(body, skin) {
    aplicarSkin(body, skin, url).catch(() => { if (dialog.open) status('Não foi possível carregar a prévia da skin.'); });
  }
  function requestPreview() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!preview) return;
      const skin = normalizarSkin(draft, gm);
      const doPintor = panel === 'pintor' && pintor.previa(skin || {});
      const doMockup = !doPintor && panel === 'mockup' && mockup.previa();
      if (doPintor) aplicarSkin(preview.body, doPintor.skin, url, doPintor.opts).catch(() => {});
      else if (doMockup) aplicarSkin(preview.body, doMockup.skin, url, doMockup.opts).catch(() => {});
      else carregar(preview.body, skin);
    }, 60);
  }
  // envio de arquivo ao mundo com a chave da sessão (tipo 'skin' = PNG de skin, conferido no servidor)
  async function enviar(blob, tipo = '') {
    if (!net.playing || net.offline) throw new Error('Conecte-se ao mundo para enviar arquivos.');
    const response = await fetch(`api/enviar?mundo=${encodeURIComponent(game.slug)}${tipo ? '&tipo=' + tipo : ''}`, {
      method: 'POST', headers: { 'X-Lavra-Chave': net.key, 'Content-Type': blob.type || 'image/png' }, body: blob
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) throw new Error(result.erro || 'O envio foi recusado.');
    return result.id;
  }
  function selectLayer(key) {
    layer = key;
    for (const k of CAMADAS_SKIN) dialog.querySelector(`[data-layer="${k}"]`).setAttribute('aria-pressed', String(k === key));
    q('filelabel').textContent = `Imagem · ${labels[layer]}`;
    q('transforms').disabled = q('remove').disabled = !draft[layer];
    for (const input of dialog.querySelectorAll('[data-value]')) input.value = draft[layer]?.[input.dataset.value] ?? 0;
    q('turn').value = key === 'costas' ? 180 : 0;
  }
  const tabs = [...dialog.querySelectorAll('[data-panel]')];
  function showPanel(name) {
    const antes = panel;
    panel = name === 'gm' && !gm ? 'traje' : name;
    for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.panel === panel));
    for (const section of dialog.querySelectorAll('[data-page]')) section.hidden = section.dataset.page !== panel;
    if (panel === 'pintor' && antes !== 'pintor' && dialog.open) pintor.abrir();
    dialog.classList.toggle('skin-pintando', panel === 'pintor');
    if (panel === 'base') abaBase.sync();
    if (antes !== panel && (antes === 'pintor' || panel === 'pintor' || antes === 'mockup' || panel === 'mockup')) requestPreview();
  }
  function sync() {
    q('shirt').value = draft.camisa || (draft.traje?.jaqueta ? '#465b43' : '#e8873a');
    for (const input of dialog.querySelectorAll('[data-piece]')) input.checked = !!draft.traje?.[input.dataset.piece];
    tabs.find((tab) => tab.dataset.panel === 'gm').hidden = !gm;
    showPanel(panel);
    for (const option of q('effect="regiao"').options) {
      option.disabled = Object.hasOwn(PECAS_EXPLORADOR, option.value) && !draft.traje?.[option.value];
    }
    draft.gm.regiao = normalizarSkin(draft, true).gm.regiao;
    q('gm').hidden = !gm;
    for (const input of dialog.querySelectorAll('[data-effect]')) input.value = draft.gm[input.dataset.effect];
    selectLayer(layer || 'frente');
    criador.sync();
    abaBase.sync();
    requestPreview();
  }
  function library() {
    q('library').replaceChildren(new Option('Escolha uma skin', ''));
    for (const item of read().entries) q('library').add(new Option(item.nome, item.nome));
  }

  function startPreview() {
    const stage = q('stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    stage.append(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, .1, 20);
    const body = buildBody();
    const sky = new THREE.HemisphereLight(0xf1f5ff, 0x3c4758, 2);
    const key = new THREE.DirectionalLight(0xfff0d5, 3);
    key.position.set(2, 3, -3);
    scene.add(body.root, sky, key);
    const particles = criarParticulasMc(scene, { name: 'baixa' });
    const resize = new ResizeObserver(() => {
      const w = Math.max(stage.clientWidth, 1), h = Math.max(stage.clientHeight, 1);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    resize.observe(stage);
    let last = performance.now();
    renderer.setAnimationLoop((now) => {
      const dt = Math.min(.05, (now - last) / 1000);
      last = now;
      const angle = Number(q('turn').value) * Math.PI / 180;
      const narrow = Math.min(camera.aspect, 1);
      const closeup = (layer === 'rosto' && panel === 'design') || (panel === 'criador' && criador.perto());
      const zoom = Number(q('zoom').value);
      const alto = body.head.parent?.scale.y || 1, extra = body.pecasCriador?.extraTopo || 0;
      const radius = (closeup ? 1.25 : 3.95 + extra * 2) / (Math.max(.55, narrow) * zoom);
      const y = (closeup ? 1.58 : 1.0) * alto + extra * (closeup ? .5 : .6);
      camera.position.set(Math.sin(angle) * radius, y + .14, -Math.cos(angle) * radius);
      camera.lookAt(0, y, 0);
      sky.intensity = night ? .25 : 2;
      key.intensity = night ? .3 : 3;
      const step = walking ? Math.sin(now / 125) * .52 : 0;
      body.armL.rotation.x = body.legR.rotation.x = step;
      body.armR.rotation.x = body.legL.rotation.x = -step;
      fumacaSkin(body, particles, dt);
      particles.update(dt);
      renderer.render(scene, camera);
    });
    preview = { body, dispose() {
      resize.disconnect();
      renderer.setAnimationLoop(null);
      limparSkin(body);
      body.dispose();
      particles.malha.geometry.dispose();
      particles.malha.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      stage.replaceChildren();
    } };
  }

  open.addEventListener('click', () => {
    draft = read().active || blank();
    q('name').value = '';
    draft.gm ||= blank().gm;
    layer = 'frente';
    showPanel('traje');
    library();
    q('file').disabled = !net.playing || net.offline;
    status(net.offline ? 'Conecte-se ao mundo para enviar imagens.' : net.playing ? '' : 'Conectando ao mundo…');
    dialog.showModal();
    try { startPreview(); }
    catch { status('A prévia 3D está indisponível neste aparelho.'); }
    sync();
  });
  q('close').onclick = () => dialog.close();
  q('expand').onclick = () => {
    const expanded = dialog.classList.toggle('skin-expanded');
    q('expand').setAttribute('aria-label', expanded ? 'Restaurar tamanho' : 'Maximizar');
  };
  dialog.querySelector('header').ondblclick = (event) => {
    if (!event.target.closest('button')) q('expand').click();
  };
  for (const tab of tabs) tab.onclick = () => showPanel(tab.dataset.panel);
  q('explorador').onclick = () => {
    draft.traje = Object.fromEntries(Object.keys(PECAS_EXPLORADOR).map((slot) => [slot, true]));
    draft.camisa = '#465b43';
    sync();
    q('turn').value = 23;
    status('Explorador no provador.');
  };
  for (const input of dialog.querySelectorAll('[data-piece]')) {
    input.onchange = () => {
      draft.traje ||= {};
      draft.traje[input.dataset.piece] = input.checked;
      sync();
    };
  }
  const stage = q('stage');
  let drag;
  stage.onpointerdown = (event) => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX };
    stage.setPointerCapture(event.pointerId);
  };
  stage.onpointermove = (event) => {
    if (drag?.id !== event.pointerId) return;
    const turn = q('turn');
    turn.value = ((Number(turn.value) + (event.clientX - drag.x) * .75 + 540) % 360) - 180;
    drag.x = event.clientX;
  };
  stage.onlostpointercapture = () => { drag = null; };
  dialog.addEventListener('close', () => {
    uploadJob = null;
    pintor.fechar();
    mockup.fechar();
    q('file').value = '';
    clearTimeout(timer);
    preview?.dispose();
    preview = null;
  });
  q('light').onclick = () => { night = !night; q('light').textContent = night ? 'Sol' : 'Lua'; };
  q('walk').onclick = () => { walking = !walking; q('walk').textContent = walking ? 'Parar' : 'Andar'; };
  for (const tab of dialog.querySelectorAll('[data-layer]')) tab.onclick = () => selectLayer(tab.dataset.layer);
  q('shirt').oninput = () => { draft.camisa = q('shirt').value; requestPreview(); };
  for (const input of dialog.querySelectorAll('[data-value]')) {
    input.oninput = () => { draft[layer][input.dataset.value] = Number(input.value); requestPreview(); };
  }
  for (const input of dialog.querySelectorAll('[data-effect]')) {
    input.oninput = () => {
      draft.gm[input.dataset.effect] = input.type === 'range' ? Number(input.value) : input.value;
      requestPreview();
    };
  }
  q('remove').onclick = () => { draft[layer] = null; selectLayer(layer); requestPreview(); };
  q('default').onclick = () => { draft = blank(); q('name').value = ''; sync(); };
  q('library').onchange = () => {
    const saved = read().entries.find((item) => item.nome === q('library').value);
    if (!saved) return;
    draft = saved.skin;
    draft.gm ||= blank().gm;
    q('name').value = saved.nome;
    sync();
  };
  q('save').onclick = () => {
    const nome = q('name').value.trim();
    if (!nome) return status('Dê um nome para salvar a skin.');
    const data = read();
    data.entries = data.entries.filter((item) => item.nome !== nome);
    data.entries.unshift({ nome, skin: normalizarSkin(draft, gm) });
    data.entries = data.entries.slice(0, 24);
    if (write(data)) { library(); q('library').value = nome; status('Skin salva neste aparelho.'); }
  };
  q('file').onchange = async () => {
    const file = q('file').files[0];
    q('file').value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
      status('Use PNG, JPEG ou WebP de até 12 MB.');
      return;
    }
    const job = {}, selected = layer;
    uploadJob = job;
    q('file').disabled = true;
    status('Enviando imagem…');
    try {
      const bmp = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      try {
        const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
        canvas.width = Math.max(1, Math.round(bmp.width * scale));
        canvas.height = Math.max(1, Math.round(bmp.height * scale));
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      } finally { bmp.close(); }
      if (uploadJob !== job) return;
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('A imagem não pôde ser convertida.');
      if (uploadJob !== job) return;
      const enviado = await enviar(blob);
      if (uploadJob !== job) return;
      draft[selected] = { id: enviado, x: 0, y: 0, giro: 0, escala: 1, opacidade: 1 };
      selectLayer(layer);
      requestPreview();
      status(`Imagem adicionada · ${labels[selected]}.`);
    } catch (error) {
      if (uploadJob === job) status(error.message || 'Não foi possível enviar a imagem.');
    } finally {
      if (uploadJob === job) { uploadJob = null; q('file').disabled = !net.playing || net.offline; }
    }
  };

  q('apply').onclick = () => {
    if (uploadJob || abaBase.ocupado()) return status('Aguarde o envio da imagem.');
    if (!net.playing && !net.offline) return status('Aguarde a conexão com o mundo.');
    const data = read();
    const skin = normalizarSkin(draft, gm);
    const hasEffects = skin.gm && (skin.gm.brilho || skin.gm.reflexo || skin.gm.fumaca);
    data.active = skin.base || skin.criador || skin.traje || skin.camisa || CAMADAS_SKIN.some((key) => skin[key]) || hasEffects ? skin : null;
    write(data);
    if (net.offline) {
      carregar(self, data.active);
      dialog.close();
      return;
    }
    clearTimeout(aguardando);
    q('apply').disabled = true;
    net.send({ t: 'skin', skin: data.active });
    aguardando = setTimeout(() => { q('apply').disabled = false; status('O servidor não confirmou a skin.'); }, 3500);
  };

  game.hooks.other.push((msg) => {
    if (msg.t === 'gm') {
      gm = !!(msg.isGm && msg.ativo);
      if (dialog.open) sync();
    }
    if (msg.t !== 'skin') return;
    if (msg.id === net.id && msg.inicio) {
      // na entrada o servidor manda a skin lembrada pelo nome; sem nenhuma lá, vale a última deste aparelho
      clearTimeout(esperaInicio);
      const local = esperandoInicio;
      esperandoInicio = null;
      if (msg.skin) {
        carregar(self, msg.skin);
        const data = read();
        data.active = { ...msg.skin, gm: msg.skin.gm || data.active?.gm || null };
        write(data);
      } else if (local) net.send({ t: 'skin', skin: local });
      return;
    }
    if (msg.id === net.id) {
      carregar(self, msg.skin);
      if (aguardando) {
        clearTimeout(aguardando);
        aguardando = 0;
        q('apply').disabled = false;
        if (dialog.open) dialog.close();
        ui.toast('Skin aplicada.');
      }
      return;
    }
    const entry = avatars.list.get(msg.id);
    if (entry) carregar(entry.body, msg.skin);
  });
  return {
    onSpawn() {
      const saved = read().active;
      carregar(self, net.offline ? normalizarSkin(saved, false) : null);
      if (net.offline || !net.playing) return;
      // espera a skin lembrada pelo servidor (mensagem `skin` com `inicio`); servidor antigo não manda: vale a local
      esperandoInicio = saved || null;
      clearTimeout(esperaInicio);
      esperaInicio = setTimeout(() => { if (esperandoInicio) net.send({ t: 'skin', skin: esperandoInicio }); esperandoInicio = null; }, 3000);
    }
  };
}
