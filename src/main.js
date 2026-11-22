// LAVRA — ponto de entrada: monta os sistemas, guarda a máquina de estados e roda o único
// laço do jogo (passo fixo de 60 Hz para a física, desenho interpolado).

import * as THREE from './three.js';
import { U, createTerrainMaterials, makeBlockTextureArray, makeSurfaceArray, makeNoiseTexture } from './render/materials.js';
import { loadBlockMaps, applyBlockMaps, makeReliefArray } from './world/blockmaps.js';
import { carregarPacoteMc, texturaVaziaMc } from './world/mc-pacote.js';
import { criarPaletaMc } from './ui/mc-paleta.js';
import { isMcState, TRONCO_OK } from '../shared/minis.js';
import { mcEstado, MC_BASE } from '../shared/mc-estados.js';
import { soundOfBlock } from '../shared/mc-sound.js';
import { createAtmosphere } from './render/atmosphere.js';
import { createEffects } from './render/effects.js';
import { createPost } from './render/post.js';
import { createGlassLayer } from './render/glass.js';
import { createVoxelField } from './render/voxelfield.js';
import { createAmbient } from './render/ambient.js';
import { createAvatars, buildBody } from './render/avatars.js';
import { createWorld } from './world/world.js';
import { raycastVoxels } from './world/raycast.js';
import { createWorldGen, MACRO_SEA } from '../shared/worldgen.js';
import { TEXTURES, BLOCKS, DEFAULT_HOTBAR, B, OPAQUE, SOLID, KIND, LEVEL, K_AIR, K_CROSS, K_CUBE, K_CUTOUT, isValidBlock } from '../shared/blocks.js';
import { Y_TOP, Y_MIN, SEA, EYE_H, DIM_MACRO, DIM_NANO0, worldSlug, seedFromString, cleanName } from '../shared/constants.js';
import { settleColumn, crumbleUnsupported } from '../shared/laws.js';
import { createWater, wetAt } from '../shared/water.js';
import { detectDevice, pickQuality, loadSettings, saveSettings, REAL } from './config.js';
import { createInput, attachKeyboardMouse, createGamepad } from './input/input.js';
import { attachTouch } from './input/touch.js';
import { createXR } from './render/xr.js';
import { aplicarFosco } from './render/vr-fosco.js';
import { initObjects } from './objects/editor.js';
import { initMachines } from './machines/machines.js';
import { initEntities } from './entities/entities.js';
import { initFx } from './render/fx.js';
import { initNature } from './nature/nature.js';
import { createHorseSkin } from './render/fauna-cavalo.js';
import { initCavalos } from './nature/cavalos.js';
import { createFaunaSkin } from './render/fauna-bichos.js';
import { initBichos } from './nature/bichos.js';
import { NOMES as FAUNA_NOMES } from './nature/bichos-nomes.js';
import { initTrees } from './nature/trees.js';
import { initPlantas3d } from './render/plantas3d.js';   // plantas com corpo 3D (shared/plantas.js)
import { initRelva } from './render/relva.js';           // relva viva (prova de realismo, ?real=1)
import { initVooPlanetario } from './render/voo-planetario.js';
import { initOceano } from './render/oceano.js';         // mar contínuo do arquipélago (só com mapa de ilhas)
import { initCoqueiros } from './render/coqueiros.js';   // coqueiros da praia do arquipélago
import { initAves } from './render/aves.js';             // gaivotas, trinta-réis, fragatas e maçaricos do litoral
import { initRecife } from './render/recife.js';         // recife de corais em volta da ilha (modelos do Tidewater)
import { initRealChao } from './render/real-chao.js';    // chão fotografado (prova de realismo, ?real=1)
import { initChuva } from './render/chuva.js';            // chuva: riscos, respingos e o mapa do que a apara
import { initSky } from './nature/sky.js';
import { initTrails } from './nature/trails.js';
import { initMovimentosMc } from './world/mc-movimentos.js';
import { criarParticulasMc } from './render/mc-particulas.js';
import { createAudio } from './audio/audio.js';
import { waveEnergyOfWind, classifyCoastalStepMaterial } from './audio/physics.js';
import { createPlayer } from './game/player.js';
import { createInteraction } from './game/interaction.js';
import { comandoSolo as comandoFortalezaSolo, posicaoSolo as posicaoFortalezaSolo } from './game/fortaleza.js';
import { blocoDaFortaleza, dentroDoPalacio, foraDoPalacio, naGeleira } from '../shared/fortaleza.js';
import { initGroups } from './game/groups.js';
import { initItems } from './game/items.js';
import { initBaus } from './game/baus.js';     // baús com tesouros (server/baus.js)
import { initCliente } from './game/cliente.js';   // cliente instalável: instalar, arquivos no aparelho, ajustes do aparelho
import { initMenuVr } from './game/menu-vr.js';           // menu do VR: as telas do PC num quadro 3D (X ou ☰ no pulso)
import { initToqueExtra } from './game/toque-extra.js';   // toque: botões do que só existia por tecla (mini-bloco, câmera)
import { initDesfazer } from './game/desfazer.js';     // Ctrl+Z desfaz e Ctrl+Y refaz a última ação de bloco (Hermes, 21/11)
import { initCrafting } from './game/crafting.js';
import { initModes } from './game/modes.js';
import { initMachado } from './game/machado.js';
import { initBussola } from './game/bussola.js';
import { initAdm } from './game/adm.js';   // stun do GM (server/world.js → comandoAdm)
import { initPerigos } from './game/perigos.js';   // perigos do fundo: som e tremor (19/11)
import { initBola } from './game/bola.js';
import { initTelaCheia } from './game/tela-cheia.js';
import { initPovos } from './game/povos.js';
import { initCidadeLonge } from './game/cidade-longe.js';   // perfil da Ilha Metrópole visto de longe (caixas até o mundo carregar)
import { initVulcao } from './game/vulcao.js';   // penacho de fumaça e clarão da cratera da Ilha do Vulcão
import { initIlhasProps } from './game/ilhas-props.js';   // modelos 3D (.glb Meshy) das ilhas, cais e bóias de canal
import { mapaSolo, sementeArquipelago } from '../shared/mapa-solo.js';
import { initFerrovia } from './game/ferrovia.js';
import { initGaragem } from './game/veiculos-kids.js';
import { initBalsa } from './game/balsa.js';   // balsas entre as ilhas do arquipélago (shared/balsa.js, server/balsa.js)
import { initCosta } from './game/costa.js';   // costa Tidewater: vila costeira, píer/deck e barco 3D (shared/costa.js, server/costa.js)
import { initMapa } from './game/mapa.js';   // mapa na tecla M   // aldeões das tribos, aldeias e cidades (server/povos.js)   // tela cheia + teclado travado: Ctrl+W não fecha o jogo   // bola de futebol, gol e placar (server/bola.js)
import { initGm } from './game/gm.js';
import { initHudNautico } from './game/hud-nautico.js';
import { initVrDesempenho } from './game/vr-desempenho.js';   // regulador de desempenho no visor   // bússola dos jogadores (direção e distância dos outros)
import { createNet } from './net/net.js';
import { createUI } from './ui/ui.js';
import { createIcons } from './ui/icons.js';

const params = new URLSearchParams(location.search);
const TEST = (params.has('teste') || Boolean(navigator.webdriver)) && !params.has('lock');          // automação: sem trava de ponteiro
const device = detectDevice();
const settings = loadSettings();
const quality = pickQuality(device, params.get('q') || (settings.quality !== 'auto' ? settings.quality : null), settings);   // + os ajustes do aparelho (config.js → AJUSTES)
if (settings.distance) quality.distance = settings.distance; else settings.distance = quality.distance;
if (params.get('dist')) quality.distance = settings.distance = Number(params.get('dist'));
// Realismo (config.js → REAL): ligado por padrão no PC, no perfil alto. Desliga pelo ajuste "Realismo" da pausa ou com
// ?real=0 (e ?real=1 liga mesmo com o ajuste desligado). Cada parte sai com &sombraperto=0, &relva=0, &chao=0, &foco=0,
// &tom=0 ou &luz=0, para comparar uma de cada vez.
const querReal = params.get('real') === '1' || (params.get('real') !== '0' && settings.real !== false);
if (querReal && params.get('post') !== '0' && quality.name === 'alta' && !device.mobile && quality.shadow && quality.post) {
  quality.real = JSON.parse(JSON.stringify(REAL));
  if (params.get('sombraperto') === '0') delete quality.real.shadowNear;
  if (params.get('relva') === '0') delete quality.real.relva;
  if (params.get('chao') === '0') quality.real.chao = false;
  if (params.get('foco') === '0') quality.real.camera.foco = 0;
  if (params.get('tom') === '0') quality.real.camera.tom = '';
  if (params.get('luz') === '0') delete quality.real.luz;
} else if (querReal && params.get('chao') !== '0') {
  // Celular, iPad, visor e perfis mais leves (19/11, relato do Kadmus: "lá o piso fica com um reflexo plástico muito
  // feio"): entra só a pele do realismo — chão e casca escaneados, foscos. Relva, sombra de perto, lente e o balanço
  // de luz da prova continuam só no PC, perfil alto.
  quality.real = { leve: true };
}
if (settings.autoJump === null) settings.autoJump = device.touch || device.quest;
const store = {
  get(k, d) { try { const v = localStorage.getItem('lavra.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lavra.' + k, JSON.stringify(v)); } catch { /* cheio ou bloqueado */ } },
};

// ---- render --------------------------------------------------------------------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance', stencil: false });
let pixelRatio = Math.min(window.devicePixelRatio || 1, quality.dpr);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const shaderErrors = [];
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  shaderErrors.push({ vs: gl.getShaderInfoLog(vs), fs: gl.getShaderInfoLog(fs), link: gl.getProgramInfoLog(program) });
  console.error('[shader]', gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs));
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.08, 900);
const rig = new THREE.Group();      // pés do jogador (no VR: o chão da sala)
const pivot = new THREE.Group();    // altura dos olhos; gira no eixo X (olhar para cima/baixo)
rig.add(pivot); pivot.add(camera); scene.add(rig);

if (params.get('post') === '0') quality.post = null;
// pós-processamento (HDR, bloom, raios de sol); null no perfil baixo, no Quest ou se a GPU não desenha em meio-float
const post = createPost(renderer, quality.post, quality.real?.camera || null);
// Saída direta (baixa, Quest, post=0 ou sem HDR): não aloca o campo para reflexos.
if (!post) quality.rt = null;
renderer.info.autoReset = false;      // vários passos por quadro: a contagem de desenhos é zerada à mão, uma vez por quadro
// recorte com cobertura parcial (folhas sem serrilhado) só onde há MSAA de verdade
const materials = createTerrainMaterials(quality, { a2c: quality.antialias && (!post || post.cfg.msaa > 0) });
const atmosphere = createAtmosphere(scene, quality);
atmosphere.setupShadows(renderer);
const world = createWorld({ scene, materials, quality });
const glassLayer = createGlassLayer(world.group, materials);
// o contexto só é lido depois da partida (quadro a quadro e nas quebras): game, net e interaction já existem
const effects = createEffects(scene, { getContext: () => ({ scene, world, camera, quality, game, net, interaction, input }) });
const ambient = createAmbient(scene);
// A matéria do ar entra depois. Se o arquivo não veio neste deploy, o jogo segue com a chuva em linhas.
const materia = { update() {}, forcar() {} };
import('./render/materia.js').then(({ createMateria }) => {
  Object.assign(materia, createMateria(scene, quality, world));
  nature.setRainOwned?.(true);
}).catch(() => {});
U.uNoise.value = makeNoiseTexture(256);
U.uOmenTex.value = U.uNoise.value;

// sonda de luz aproximada: há teto opaco logo acima?
function lightProbe(x, y, z) {
  const bx = Math.floor(x), bz = Math.floor(z), y0 = Math.floor(y);
  for (let yy = y0; yy < y0 + 24 && yy < Y_TOP; yy++) {
    const b = world.getBlock(bx, yy, bz);
    if (b === -1) break;
    if (b > 0 && OPAQUE[b]) return 0.32;
  }
  return 1;
}
function surfaceMaterialAt(bx, by, bz, py, underId, inWater = false) {
  const feetId = world.getBlock(bx, Math.floor(py + 0.08), bz);
  if (inWater || (feetId > 0 && LEVEL[feetId] > 0)) return 'water';
  const rawMat = underId > 0 ? soundOfBlock(BLOCKS, underId, world.getMini(bx, by, bz)) : 'dirt';
  if (rawMat !== 'sand') return rawMat;
  const seaY = game.dim === DIM_MACRO ? MACRO_SEA : SEA;
  const nearSeaLevel = Math.abs(py - (seaY + 1)) <= 2.3 || Math.abs(by - seaY) <= 2;
  let nearWater = false;
  if (nearSeaLevel || (place.water || 0) > 0.03) {
    outer: for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      if (LEVEL[world.getBlock(bx + dx, by, bz + dz)] > 0 || LEVEL[world.getBlock(bx + dx, seaY, bz + dz)] > 0) {
        nearWater = true;
        break outer;
      }
    }
  }
  return classifyCoastalStepMaterial(rawMat, { inWater: false, nearWater, nearSeaLevel, rain: game.weather?.rain || 0 });
}

const avatars = createAvatars(scene, lightProbe);
// passos dos outros jogadores: só de quem pisa em chão firme, ouvidos do lugar onde estão
avatars.onStep = (x, y, z) => {
  const bx = Math.floor(x), by = Math.floor(y - 0.2), bz = Math.floor(z);
  const under = world.getBlock(bx, by, bz);
  if (under > 0 && SOLID[under] && game.audio) game.audio.play('step', 0.9, 0.85 + Math.random() * 0.3, surfaceMaterialAt(bx, by, bz, y, under, false), [x, y, z]);
};
const self = buildBody('#e8873a'); // o próprio corpo, só visto em terceira pessoa
self.root.visible = false;
scene.add(self.root);

// ---- jogo ------------------------------------------------------------------------------
const input = createInput();
const player = createPlayer(world);
player.autoJump = !!settings.autoJump;
const game = {
  state: 'BOOT', overlay: null, name: '', slug: '', seed: 0, dim: 0, gen: null, ready: false,
  hotbar: store.get('hotbar', DEFAULT_HOTBAR).filter((v) => isValidBlock(v) || isMcState(v)).concat(DEFAULT_HOTBAR).slice(0, 9), sel: 0,
  view: 0, camDist: 0, fps: 60, frames: 0, players: new Map(), color: '#e8873a', debug: false, lastJump: -9, xr: null,
  // plataforma (18/11, pedido do Kadmus: "o render deve ser diferente para mobiles e vr do que para pc"): cada sistema
  // pesado (bichos, plantas 3D, plateia) se ajusta por ela; o regulador do VR (game/vr-desempenho.js) ajusta por cima
  plataforma: device.quest ? 'visor' : device.mobile ? 'celular' : 'pc',
  toque: !!device.touch,        // botões na tela (celular, iPad): as dicas falam "Usar", não "F" (game/teclas.js)
  real: quality.real || null,   // prova de realismo ligada (config.js → REAL)
  hooks: { pre: [], frame: [], fixed: [], other: [], interact: [], edit: [] },   // pre: no começo de cada quadro, antes da física e da câmera (quem carrega o jogador: a balsa)   // sistemas das próximas etapas se penduram aqui (edit: bloco posto ou quebrado por quem joga)
};
// recarrega o jogo e volta direto ao mundo (ajuste que só vale na partida: realismo, qualidade, limite de quadros…)
game.recarregar = () => { savePosition(); try { if (game.name && game.state !== 'MENU') sessionStorage.setItem('lavra.voltar', game.name); } catch { /* sem armazenamento de sessão */ } leavingOnPurpose = true; net.reload(); };
const kbm = attachKeyboardMouse(input, canvas, { sensitivity: () => settings.sensitivity, invertY: () => settings.invertY });
const gamepad = createGamepad(input, { sensitivity: () => settings.sensitivity, invertY: () => settings.invertY });

let voltouSozinho = false;   // a página recarregou sozinha (versão nova no ar) e está devolvendo ao mundo quem jogava
const net = createNet({
  welcome(m) {
    const fresh = game.partidaLocal || game.seed !== m.seed || !game.gen || game.slug !== m.world || game.dim !== (m.dim || 0);
    game.partidaLocal = false;
    game.slug = m.world; game.color = m.color;
    if (fresh) startWorld(m.seed, m.dim || 0, m.gen || null);
    world.loadEdits(m.edits || {});
    world.loadMinis(m.minis || {});
    avatars.clear(); game.players.clear();
    for (const p of m.players) if (p.id !== net.id) { avatars.add(p); game.players.set(p.id, p); }
    refreshStatus();
    for (const f of game.hooks.other) f(m);
  },
  spawned(name) {
    game.name = name;
    store.set('nome', name);
    if (game.state === 'MENU') {
      placePlayer();
      // &pose=x,y,z[,giro,inclinação]: entra já nesse ponto, olhando para lá (serve para mostrar uma cena pronta)
      // (só na entrada de verdade: quando a página recarrega sozinha por versão nova, quem jogava volta para onde estava)
      const pose = (params.get('pose') || '').split(',').map(Number);
      if (!voltouSozinho && pose.length >= 3 && pose.every(Number.isFinite)) { player.teleport(pose[0], pose[1], pose[2]); if (pose.length >= 5) { player.yaw = pose[3]; player.pitch = pose[4]; } }
      transition('PLAYING');
    }
    refreshPlayers();
  },
  state(list) {
    for (const s of list) if (s[0] !== net.id) {
      avatars.push(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]);
      if (s[8]) game.garagem?.receber(s[0], [s[1],s[2],s[3]], s[8]);
      else game.garagem?.remover(s[0]);
    }
  },
  block(m) {
    // edição de outra pessoa: ouve-se de onde veio (as minhas já tocaram na hora do clique)
    if (m.by && m.by !== net.id && game.state === 'PLAYING') {
      const was = world.getBlock(m.x, m.y, m.z), wasMini = world.getMini(m.x, m.y, m.z), nm = m.m || 0, pos = [m.x + 0.5, m.y + 0.5, m.z + 0.5];
      if ((m.id === 0 && was > 0) || (m.id > 0 && nm > 0 && wasMini > 0 && nm < wasMini)) game.audio.play('break', 1, 0.9 + Math.random() * 0.2, soundOfBlock(BLOCKS, was, wasMini), pos);
      else if (m.id > 0 && (was !== m.id || nm !== wasMini)) game.audio.play('place', 1, 0.9 + Math.random() * 0.2, soundOfBlock(BLOCKS, m.id, nm), pos);
    }
    world.setBlock(m.x, m.y, m.z, m.id, m.m || 0);
  },
  join(p) { if (p.id === net.id) return; if(p.veiculo) game.garagem?.receber(p.id,p.p,p.veiculo); avatars.add(p); game.players.set(p.id, p); refreshPlayers(); refreshStatus(); },
  leave(id) { avatars.remove(id); game.players.delete(id); refreshPlayers(); refreshStatus(); for (const f of game.hooks.other) f({ t: 'leave', id }); },
  chat(m) { ui.chatAdd(m.name, m.color, m.m, false); },
  sys(m) { ui.chatAdd('', '', m, true); },
  error(m, fatal) { ui.toast(m, 6000); if (fatal) ui.setStatus(m); },
  dropped() { ui.toast('Conexão perdida. Tentando voltar…', 4000); },
  offline(slug) {
    game.partidaLocal = true;
    game.slug = slug;
    avatars.clear(); game.players.clear();
    let terreno = store.get('off.terreno.' + slug, null);
    if (!terreno) {
      const antigo = ['off.', 'off.minis.', 'off.obj.', 'arvores.off.', 'relogio.'].some(k => store.get(k + slug, null) !== null);
      terreno = antigo ? 'classico' : 'ilhas';
      store.set('off.terreno.' + slug, terreno);
      if (antigo && !store.get('off.pos.' + slug, null)) {
        const pos = store.get('pos.' + slug, null);
        if (pos) store.set('off.pos.' + slug, pos);
      }
    }
    if (terreno === 'ilhas') startWorld(sementeArquipelago, 0, { mapa: mapaSolo, fortaleza: posicaoFortalezaSolo(store,slug) });
    else startWorld(seedFromString('lavra:' + slug));
    world.loadEdits(store.get('off.' + slug, {}));
    world.loadMinis(store.get('off.minis.' + slug, {}));
    net.startLocalClock(store.get('relogio.' + slug, null));   // sem servidor, o relógio do mundo é o deste aparelho
    refreshStatus();
    for (const f of game.hooks.other) f({ t: 'offline', slug });
  },
  localEdit() { offlineDirty = true; },
  reloading() { leavingOnPurpose = true; },      // recarga pedida pelo servidor: sai sem a pergunta do navegador
  outdated() { ui.toast('Este aparelho ficou com uma versão antiga do jogo. Pausa → Este aparelho → Atualizar agora.', 9000); },
  clock(rate) { if (ui) ui.setTimeRate(rate); },
  other(m) {
    if (m.t === 'dim') return switchDimension(m);
    if (m.t === 'gm') game.gmFortaleza = !!m.isGm;
    if (m.t === 'fortaleza-voltar' && m.p) {
      player.teleport(...m.p); game.pendingSpawn=false;
      ui.toast('A entrada no palácio é exclusiva do GM. Você pode visitar a geleira.',4500); return;
    }
    for (const f of game.hooks.other) f(m);
  },
});
let offlineDirty = false;
// sem servidor, a lei da água roda neste aparelho (quatro passos por segundo, só no plano normal, que desce até Y_MIN)
const offWater = createWater({ get: (x, y, z) => world.getBlock(x, y, z), set: (x, y, z, id) => { world.setBlock(x, y, z, id); offlineDirty = true; }, sea: SEA, budget: 200, fundo: Y_MIN });
let offWaterT = 0;

game.audio = createAudio(() => settings.volume, () => settings.music);
game.audio.setWorld({
  getBlock: (x, y, z) => world.getBlock(x, y, z),
  isOpaque: (id) => id > 0 && OPAQUE[id] === 1,
  isWater: (id) => id > 0 && LEVEL[id] > 0,
  isSolid: (id) => id > 0 && SOLID[id] === 1,
});
game.comandoFortaleza = texto => net.offline
  ? comandoFortalezaSolo(texto,{game,world,store,player,ui,startWorld,mapa:mapaSolo})
  : net.chat(texto);
const interaction = createInteraction({
  world, player,
  canEdit: (x, y, z) => (game.futebol ? game.futebol.podeEditarBloco(x, y, z) : true),
  beforeBreak:(x,y,z)=>game.trees?.cutBlock(x,y,z)||false,
  tentativaProtegida: ({x,y,z,id}) => {
    const c=game.gen?.fortaleza;
    if (net.offline || game.gmFortaleza || !naGeleira(c,x,z) || y<40 || y>159 || !id || LEVEL[id]) return false;
    if (!blocoDaFortaleza(c,x,y,z) && !world.isEdited(x,y,z)) return false;
    net.send({t:'fortaleza-tocar',x,y,z}); return true;
  },
  // com servidor, é ele quem aplica as leis (queda e colapso estrutural); offline, este aparelho aplica
  send: (x, y, z, id, m = 0) => {
    net.sendBlock(x, y, z, id, m);
    if (net.offline) {
      for (const c of settleColumn(world.getBlock, x, y, z)) {
        world.setBlock(c[0], c[1], c[2], c[3]);
        offWater.touch(c[0], c[1], c[2]);
      }
      for (const c of crumbleUnsupported(world.getBlock, x, y, z)) {
        const was = world.getBlock(c[0], c[1], c[2]);
        world.setBlock(c[0], c[1], c[2], c[3]);
        if (c[3] === B.AIR && was > 0 && was !== B.WATER) effects.breakBlock(c[0], c[1], c[2], was);
        offWater.touch(c[0], c[1], c[2]);
      }
      offWater.touch(x, y, z);
    }
  },
  onBreak: (x, y, z, id, mini = 0) => { effects.breakBlock(x, y, z, id); game.audio.play('break', 1, 0.9 + Math.random() * 0.2, soundOfBlock(BLOCKS, id, mini)); for (const f of game.hooks.edit) f(x, y, z, id, false); },
  onPlace: (x, y, z, id, mini = 0) => { game.audio.play('place', 1, 0.9 + Math.random() * 0.2, soundOfBlock(BLOCKS, id, mini)); for (const f of game.hooks.edit) f(x, y, z, id, true); },
  onDig: (x, y, z, id, mini = 0) => { game.audio.play('dig', 0.55, 0.9 + Math.random() * 0.2, soundOfBlock(BLOCKS, id, mini)); },
});
interaction.blocked = (x, y, z) => avatars.occupies(x, y, z);
interaction.squareTrunk = !!store.get('troncoQuadrado', false);
function toggleTrunkMode(force = !interaction.squareTrunk) {
  interaction.squareTrunk = !!force;
  store.set('troncoQuadrado', interaction.squareTrunk);
  game.audio.play('tick', 1, interaction.squareTrunk ? 0.92 : 1.12);
  ui.toast(interaction.squareTrunk
    ? 'Tronco quadrado (bloco inteiro). K alterna para redondo.'
    : 'Tronco redondo (tubular conectado). K alterna para quadrado.', 2600);
}

let icons = null;
const ui = createUI({
  root: document.getElementById('ui'), icons: null, device, settings,
  on: {
    play() {
      const v = ui.menuValues();
      const name = cleanName(v.name) || 'Viajante';
      if (net.world !== worldSlug(v.world)) connect(worldSlug(v.world));
      if (!game.ready && v.partida === 'solo') return;
      net.spawn(name);
    },
    vr() { if (!game.xr) return; game.xr.enter(); if (game.state === 'MENU') this.play(); else if (game.state === 'PAUSED') transition('PLAYING'); },
    worldChanged(v) { const slug = worldSlug(v); if (game.state === 'MENU' && net.world !== slug) connect(slug); },
    partidaChanged() {
      const v = ui.menuValues();
      const u = new URL(location.href); u.searchParams.set('partida', v.partida);
      history.replaceState(null, '', u);
      if (game.state === 'MENU') connect(worldSlug(v.world));
    },
    resume() { transition('PLAYING'); },
    pause() { if (game.state === 'PLAYING') { closeOverlay(); transition('PAUSED'); } },
    leave() {
      savePosition(); transition('MENU'); net.leaveGame(); ui.setPartida('solo');
      const u = new URL(location.href); u.searchParams.set('partida', 'solo'); history.replaceState(null, '', u);
      connect(worldSlug(ui.menuValues().world));
    },
    // duração do dia: com servidor, vale para o mundo inteiro; offline, só aqui
    timeRate(rate) {
      if (net.offline) { net.setLocalRate(rate); store.set('relogio.' + game.slug, net.clockState()); return; }
      // espera a pessoa parar de mexer no controle: vale a última escolha, e o servidor recebe um pedido só
      clearTimeout(game.rateTimer);
      game.rateTimer = setTimeout(() => net.send({ t: 'ritmo', v: rate }), 450);
    },
    invite() {
      if (net.offline) { ui.toast('Para convidar alguém, escolha Multiplayer online no menu.'); return; }
      const url = `${location.origin}${location.pathname}?partida=multiplayer&mundo=${encodeURIComponent(game.slug)}`;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
        () => ui.toast('Convite copiado: ' + url), () => ui.toast(url, 9000));
    },
    setting(key, value) {
      settings[key] = value; saveSettings(settings);
      if (key === 'fov') { camera.fov = value; camera.updateProjectionMatrix(); }
      if (key === 'distance') world.setDistance(value);
      if (key === 'autoJump') player.autoJump = value;
      // realismo: os shaders são montados na partida, então a troca vale recarregando (volta direto ao mundo)
      if (key === 'quality') { settings.distance = 0; saveSettings(settings); }   // perfil novo: vale a distância de visão dele
      if (key === 'real') { game.recarregar(); return; }
      for (const f of game.hooks.other) f({ t: 'setting', key, value });
    },
    palette() {
      if (game.state !== 'PLAYING') return;
      if (game.espacoAtivo?.tipo === 'futebol') { game.futebol?.abrirPainel('partida'); return; }
      if (game.espacoAtivo) return;
      openOverlay('palette'); game.audio.play('open', 1, 1);
    },
    paletteClose() { closeOverlay(); },
    map() { if (game.state === 'PLAYING') { if (game.mapa?.aberto) game.mapa.fecha(); else game.mapa?.abre(); } },
    compass(v) { game.bussola?.alternar(v); },
    trunkMode() { if (game.state === 'PLAYING' && !game.espacoAtivo) toggleTrunkMode(); },
    // espaco e manter vêm do painel de blocos (ui.js): põe naquele espaço da barra e deixa o painel aberto
    pickBlock(id, espaco, manter) {
      const i = Number.isInteger(espaco) && espaco >= 0 && espaco < 9 ? espaco : game.sel;
      game.hotbar[i] = id; store.set('hotbar', game.hotbar); ui.setHotbar(game.hotbar, game.sel);
      if (!manter) closeOverlay();
      game.audio.play('tick', 1, 1.2);
    },
    hotbar(i) { if (i !== game.sel) game.audio.play('tick', 1, 1); game.sel = i; ui.setHotbar(game.hotbar, game.sel); },
    chatOpen(prefix) { if (game.state === 'PLAYING') { openOverlay('chat'); ui.chatOpen(prefix); } },
    chatSend(text) {
      if (/^\/(garagem|veiculo)(?:\s|$)/i.test(text)) {
        closeOverlay();
        const arg=text.trim().split(/\s+/)[1]?.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        if (!arg) game.garagem.abrir();
        else if (arg==='sair') game.garagem.sair();
        else game.garagem.chamar(arg === 'carro' ? 'jipe' : arg === 'heli' ? 'helicoptero' : arg);
        return;
      }
      if (net.offline && /^\/fortaleza(?:\s|$)/i.test(text)) {
        game.comandoFortaleza(text); closeOverlay(); return;
      }
      const k = text === '/nano' ? 'nano' : text === '/macro' ? 'macro' : text === '/normal' ? 'normal' : '';
      // /inicio: volta ao ponto do primeiro nascimento neste mundo (o mesmo cálculo da primeira entrada, sem a posição salva)
      if (text === '/inicio') {
        if (game.dim !== 0) ui.toast('O início fica no plano normal: use /normal antes.');
        else { placePlayer(true); savePosition(); ui.toast('De volta ao ponto onde você nasceu a primeira vez neste mundo.'); }
      } else if (text === '/tronco' || text === '/tronco redondo' || text === '/tronco quadrado') {
        toggleTrunkMode(text === '/tronco' ? !interaction.squareTrunk : text === '/tronco quadrado');
      } else if (game.bussola?.comando(text, (m, ms) => ui.toast(m, ms)) || game.telaCheia?.comando(text, (m, ms) => ui.toast(m, ms)) || machado.comando(text)) { /* /bussola, /onde, /telacheia: só deste aparelho */
      } else if (k) changePlane(k); else if (text) net.chat(text);
      closeOverlay();
    },
  },
});

// mira por um ponto da tela (toque) ou por um raio pronto (controle de VR)
const ndc = new THREE.Vector2(), screenRay = new THREE.Raycaster(), rayBuf = [0, 0, 0, 0, 0, -1];
const touch = device.touch ? attachTouch(input, canvas, ui.el.touch, {
  sensitivity: () => settings.sensitivity, invertY: () => settings.invertY,
  aim: (x, y) => { game.aimScreen = x === null ? null : [x, y]; },
}) : null;
game.xr = createXR({ renderer, scene, rig, pivot, camera, input, player, game, ui, interaction, icons: () => icons, settings });
initVrDesempenho({ game, renderer, world, quality, atmosphere });
game.afterXR = () => { if (game.state === 'PLAYING') transition('PAUSED'); onResize(); };
const machines = initMachines({ game, world, player, net, ui, input, scene, interaction, effects, store });
game.machines = machines;
const entities = initEntities({ game, world, player, net, ui, input, scene, interaction, effects, lightProbe, respawn });
const fx = initFx({ game, scene, camera, ui, world });
const nature = initNature({ game, world, net, scene, camera, atmosphere, lightProbe, effects });
if (materia.points) nature.setRainOwned?.(true);
const chuva = initChuva({ scene, world, game, quality, params });   // null com ?chuva=0 (voltam os pontos da matéria do ar)
if (chuva) { nature.setRainOwned?.(true); game.chuva = chuva; }
nature.setSkin('manada', createHorseSkin(scene, { nature, game, shadow: !!quality.shadow }));   // manada de cavalos (render/fauna-cavalo.js)
const cavalos = initCavalos({ game, world, player, net, ui, input });              // mirar, carinho, comida, montaria (nature/cavalos.js)
nature.setSkin('fauna', createFaunaSkin(scene, { nature, game, shadow: !!quality.shadow }));       // bichos do pacote (render/fauna-bichos.js)
initBichos({ game, net, ui, input, nomes: FAUNA_NOMES });                                       // mirar e interagir com eles (nature/bichos.js)
const skyReal = initSky({ game, net, scene, camera, atmosphere, store, renderer });   // sol, lua, planetas e estrelas de verdade, se o mundo tem um lugar na Terra
// Trilhas no chão macio: quem passa (gente, rebanho, rato, sapo) deixa a areia, a argila e a terra molhada um pouco mais
// fundas e mais escuras. A terra molha onde a chuva chega, onde encosta em água e, quando o servidor passar a guardar o
// estado dos materiais, onde a célula estiver marcada como molhada (effects.materials, contrato do Codex).
const trails = quality.trails ? initTrails({
  game, world, player, camera, avatars, THREE,
  openSky: (x, y, z) => lightProbe(x + 0.5, y, z + 0.5) > 0.5,
  wetOf: (x, y, z, id) => effects.materials.get(game.dim, x, y, z, id).wet || 0,
}) : null;
// Só os dados: a textura das marcas e os uniforms uTrail, uTrailInfo e uTrailCam ficam no registro U. O desenho da
// trilha no terreno é de quem cuida dos shaders (trecho pronto e modo de usar no topo de nature/trails.js).
if (trails) Object.assign(U, trails.uniforms);
game.trails = trails;
// Luz de perto: uma caixa de voxels em volta da câmera, na GPU, para traçar raios só onde se olha (docs/luz-de-perto.md).
// Aqui fica a fundação: o campo, os uniforms (uVox, uVoxProps, uVoxOrigin, uVoxSize, uVoxRange no registro U) e a
// atualização por quadro. Os efeitos em si são shader, de quem cuida do visual.
const voxels = quality.rt ? createVoxelField({ world, size: quality.rt.size, range: quality.rt.range }) : null;
game.voxels = voxels;
if (voxels) {
  Object.assign(U, voxels.uniforms);
  const at = new THREE.Vector3();
  game.hooks.frame.push(() => {
    // no VR cada olho custaria um traçado: o alcance zero avisa os shaders de que não há campo (voxelFocus devolve 0)
    const on = game.ready && !renderer.xr.isPresenting;
    U.uVoxRange.value = on ? quality.rt.range : 0;
    if (on) voxels.update(camera.getWorldPosition(at));
  });
}
const objectTools = initObjects({ game, player, net, ui, input, scene, camera, interaction, store, lightProbe, openOverlay, closeOverlay, atmosphere, world });
// obras: conjuntos de blocos que mudam juntos (abrir, construir, fechar; trocar um troca todos; camadas; desagrupar)
const trees = initTrees({ game, world, player, net, ui, input, scene, materials, quality, interaction, store });
initPlantas3d({ scene, world, camera, game, quality, player });   // capim, samambaia, flores, arbusto e taboa em 3D
initRelva({ scene, world, camera, game, quality, player });       // lâminas de grama sobre o gramado (só com ?real=1)
game.vooPlanetario = initVooPlanetario({scene,game,player});
initOceano({ scene, camera, game, world });                      // oceano até o horizonte, ondas e arrebentação (só no arquipélago)
initCoqueiros({ scene, camera, game, player });                           // coqueiros de verdade na faixa de praia
initAves({ scene, camera, game, player });                        // aves do litoral (enfeite do lugar, cada aparelho as suas)
initRecife({ scene, camera, game });                              // recife de corais (zonas pela fundura, balanço na ondulação)
initRealChao({ renderer, quality, game, world, camera });         // materiais escaneados no topo do gramado (só com ?real=1)
const obras = initGroups({ game, world, net, ui, input, interaction, device, closeOverlay });
// modos de jogo como no Minecraft: criativo, sobrevivência, aventura e espectador (game/modes.js)
initModes({ game, player, net, ui, input, interaction, store, closeOverlay });
initBussola({ game, player, avatars, ui });
const machado = initMachado({ game, world, player, input, interaction, effects, ui, camera, store });
initAdm({ game, ui });                                            // stun do GM: segura o jogador parado
initPerigos({ game, player });                                    // teto rangendo/caindo, gás, calor (server/perigos.js)
initBola({ game, net, scene, camera, player, ui, world, device, input, interaction, avatars, self, atmosphere, openOverlay, closeOverlay });
initTelaCheia({ game, canvas, device });
initPovos({ game, scene, camera, net });
initBalsa({ game, scene, camera, net, player, ui, avatars });
initFerrovia({ game, world, player, net, ui, input, scene });
game.garagem = initGaragem({game,player,world,net,ui,scene,avatars,store,input,openOverlay,closeOverlay});
initVulcao({ game, scene, camera });
initIlhasProps({ game, scene, camera });
initCidadeLonge({ game, scene, camera, world });
initMapa({ game, world, player, avatars, net, openOverlay, closeOverlay, device });
initGm({ game, net, ui, mapa: game.mapa });
const hudNautico = initHudNautico({ game, world, player, avatars, getWind: () => U.uWind.value, getSeaInfo: () => place });
game.hudNautico = hudNautico;
initCosta({ game, world, player, net, ui, input, scene, camera, avatars });
// itens soltos e mochila: quebrou, o bloco cai como item; passou perto (ou tecla P), entra na mochila (game/items.js)
const items = initItems({ game, world, player, net, ui, input, scene, store, lightProbe, avatars, openOverlay });
initBaus({ game, net, ui, input, interaction, openOverlay, closeOverlay });   // F no baú abre (game/baus.js)
initCliente({ game, net, ui, device, settings, quality, params });   // service worker, botão de instalar e a seção "Este aparelho" da pausa
// fabricação (2x2 na mochila, 3x3 na mesa de trabalho, fornalha e portas/alçapões/barris)
const crafting = initCrafting({ game, world, net, ui, input, interaction, openOverlay, closeOverlay });
initMenuVr({ game, net, ui, player, interaction, camera, scene, store, settings, openOverlay, closeOverlay });
initToqueExtra({ game, ui, input, interaction, device });
initDesfazer({ game, world, interaction, player, ui, device });
// movimentos dos blocos do Minecraft: fumaça, chamas, folhas caindo, gotas, esporos, portal… (lógica em world/, desenho em render/)
initMovimentosMc({ game, world, camera, quality, particulas: criarParticulasMc(scene, quality), noite: () => U.uNight.value });

// Troca de plano: nano mergulha no bloco mirado; macro sobe a escala; normal volta.
function changePlane(k) {
  if (net.offline) return ui.toast('Os planos nano e macro precisam do servidor.');
  const t = interaction.target;
  if (k === 'nano') {
    if (!t.hit) return ui.toast('Mire num bloco para mergulhar nele.');
    net.send({ t: 'plano', k, x: t.x, y: t.y, z: t.z });
  } else net.send({ t: 'plano', k });
}

// ---- máquina de estados -----------------------------------------------------------------
const LEGAL = { BOOT: ['MENU'], MENU: ['PLAYING'], PLAYING: ['PAUSED', 'MENU'], PAUSED: ['PLAYING', 'MENU'] };
function transition(to) {
  if (!LEGAL[game.state].includes(to)) { console.warn(`transição ilegal: ${game.state} -> ${to}`); return false; }
  game.state = to;
  input.clearAll(); kbm.clear();
  if (to === 'MENU') { ui.screen('menu'); ui.hud(false); game.overlay = null; unlock(); self.root.visible = false; }
  else if (to === 'PLAYING') { ui.screen(null); ui.hud(true); lock(); }
  else if (to === 'PAUSED') { ui.screen('pause'); unlock(); }
  return true;
}
const wantsLock = () => !device.touch && !TEST && !(game.xr && game.xr.presenting);
function lock() {
  if (!wantsLock() || document.pointerLockElement === canvas) return;
  canvas.focus();
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* o navegador recusou; um clique resolve */ }
}
function unlock() { if (document.pointerLockElement === canvas) document.exitPointerLock(); }
function openOverlay(kind) {
  if (game.espacoAtivo && (kind === 'palette' || kind === 'editor' || kind === 'crafting')) return;
  game.overlay = kind;
  input.clearAll(); kbm.clear();
  unlock();
  if (kind === 'palette') { ui.palette(game.hotbar[game.sel]); crafting?.renderQuick(); ui.screen('palette'); }
}
function closeOverlay() {
  if (!game.overlay) return;
  const was = game.overlay;
  game.overlay = null;
  if (was === 'chat') ui.chatClose();
  for (const f of game.hooks.other) f({ t: 'overlay-closed', was });
  if (game.state === 'PLAYING') { ui.screen(null); lock(); }
}
document.addEventListener('pointerlockchange', () => {
  // Esc solta o ponteiro: sem tela aberta, isso é "pausar"
  if (document.pointerLockElement !== canvas && game.state === 'PLAYING' && !game.overlay && wantsLock()) transition('PAUSED');
});
canvas.addEventListener('click', () => { if (game.state === 'PLAYING' && !game.overlay) lock(); });
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  if (game.overlay) closeOverlay();
  else if (game.state === 'PAUSED') transition('PLAYING');
  else if (game.state === 'PLAYING' && !wantsLock()) transition('PAUSED');
  // tela cheia com teclado preso (game/tela-cheia.js): o Esc chega aqui com o ponteiro ainda preso — solta e pausa como antes
  else if (game.state === 'PLAYING' && document.pointerLockElement === canvas) { unlock(); transition('PAUSED'); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { input.clearAll(); savePosition(); } });
addEventListener('pagehide', savePosition);
// Sair sem querer: Ctrl (correr) + W é o atalho de fechar a aba e Ctrl+Shift+W o de fechar a janela, e nenhuma página
// consegue impedi-los. Com um Ctrl apertado durante o jogo, o navegador pergunta antes de sair. A recarga pedida pelo
// servidor (melhoria aplicada) passa sem pergunta.
let leavingOnPurpose = false;
addEventListener('beforeunload', (e) => {
  if (leavingOnPurpose || TEST || game.state !== 'PLAYING' || !kbm.ctrlHeld()) return;
  e.preventDefault();
  e.returnValue = '';
});

// ---- mundo ---------------------------------------------------------------------------------
function startWorld(seed, dim = 0, opt = null) {
  game.seed = seed >>> 0;
  game.foraDoSalao = null;
  game.dim = dim;
  game.gen = createWorldGen(game.seed, dim, opt);
  game.spawn = game.gen.findSpawn();
  world.reset(game.seed, dim, opt);
  player.teleport(game.spawn.x, game.spawn.y, game.spawn.z);
  game.ready = true;
}
// O servidor mandou para outra dimensão (véu atravessado, exílio, libertação).
function switchDimension(m) {
  savePosition();
  const prevDim = game.dim;
  const d = m.dim || 0;
  startWorld(game.seed, d, m.gen || null);
  world.loadEdits(m.edits || {});
  world.loadMinis(m.minis || {});
  avatars.clear(); game.players.clear();
  for (const p of m.players || []) if (p.id !== net.id) { avatars.add(p); game.players.set(p.id, p); }
  for (const f of game.hooks.other) f({ ...m, t: 'welcome' });
  player.flying = false;
  if (Number.isFinite(m.yaw)) player.yaw = m.yaw;
  if (m.p) { player.teleport(m.p[0], m.p[1] + 0.05, m.p[2]); game.pendingSpawn=false; }
  else game.pendingSpawn = true;                       // sem ponto marcado: nasce no ponto de partida da dimensão
  if ((d === 1 || prevDim === 1) && game.audio) game.audio.play('portal', 0.85, 1);
  ui.toast(d === 1 ? 'Você atravessou o véu. Esta é a Zona Fantasma.'
    : d === DIM_MACRO ? 'Plano macro: cada bloco aqui é um cubo de 100 blocos do plano normal. /normal desce onde você estiver.'
    : d >= DIM_NANO0 ? `Plano nano: você está dentro de um bloco de ${BLOCKS[m.gen?.block]?.name || 'matéria'}. /normal volta.`
    : 'Você está de volta ao plano normal.', 6000);
  refreshPlayers();
}
// Volta ao ponto de partida da dimensão atual (queda, derrota).
function respawn() {
  const s = game.dim === 1 ? game.gen.findSpawn(Math.floor(player.pos[0]), Math.floor(player.pos[2])) : game.spawn;
  player.teleport(s.x, s.y + 0.05, s.z);
  player.flying = false;
  if (game.dim === 0) game.pendingSpawn = true;
}
function connect(slug) {
  const destino = document.querySelector('meta[name="kraft-multiplayer"]')?.content;
  if (ui.menuValues().partida === 'multiplayer' && destino && new URL(destino).origin !== location.origin) {
    const url = new URL(destino); url.searchParams.set('partida', 'multiplayer'); url.searchParams.set('mundo', slug);
    savePosition(); location.assign(url); return;
  }
  salvarSolo();
  game.ready = false;
  game.gmFortaleza = false;
  for (const f of game.hooks.other) f({ t: 'gm', isGm: false, ativo: false });
  ui.setStatus('Abrindo o mundo…');
  net.connect(slug, ui.menuValues().partida);
}
function placePlayer(ignoreSaved) {
  const saved = ignoreSaved ? null : store.get((net.offline ? 'off.pos.' : 'pos.') + game.slug, null);
  if (saved && saved.length >= 5 && saved.every(Number.isFinite)) {
    player.teleport(saved[0], saved[1], saved[2]); player.yaw = saved[3]; player.pitch = saved[4];
  } else {
    // nasce em chão de verdade: procura em volta uma coluna cujo topo não seja copa nem tronco
    const s = game.spawn;
    const sx = Math.floor(s.x), sz = Math.floor(s.z);
    let best = null;
    search: for (let r = 0; r <= 10; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const top = world.topSolid(sx + dx, sz + dz);
        if (top < 0) continue;
        let y = top;
        if (KIND[world.getBlock(sx + dx, y, sz + dz)] === K_CROSS) y--;   // planta rasteira não conta
        const b = world.getBlock(sx + dx, y, sz + dz);
        if (b > 0 && KIND[b] === K_CUBE && b !== B.LOG && b !== B.PINE_LOG && b !== B.CACTUS) { best = [sx + dx + 0.5, y + 1.01, sz + dz + 0.5]; break search; }
      }
    }
    if (best) player.teleport(best[0], best[1], best[2]); else player.teleport(s.x, s.y, s.z);
    player.yaw = 0.6; player.pitch = -0.1;
  }
  player.flying = false;
}
function salvarSolo() {
  if (!net.offline || !game.ready || !game.partidaLocal || !game.slug) return;
  if (offlineDirty) {
    store.set('off.' + game.slug, world.exportEdits());
    store.set('off.minis.' + game.slug, world.exportMinis());
    offlineDirty = false;
  }
  store.set('relogio.' + game.slug, net.clockState());
}
function savePosition() {
  salvarSolo();
  if ((game.state !== 'PLAYING' && game.state !== 'PAUSED') || game.dim !== 0) return;
  store.set((net.offline ? 'off.pos.' : 'pos.') + game.slug, [...player.pos.map((v) => Math.round(v * 100) / 100), player.yaw, player.pitch]);
  store.set('mundo', game.slug);
}
function refreshStatus() {
  const n = game.players.size;
  if (net.offline) ui.setStatus('O mundo e as linhas de trem ficam salvos neste aparelho.', 'Partida solo');
  else ui.setStatus(n === 0 ? 'ninguém por aqui ainda. Chame alguém com o link do mundo.' : n === 1 ? '1 pessoa jogando agora.' : `${n} pessoas jogando agora.`, `Mundo “${game.slug}” —`);
}
function refreshPlayers() {
  ui.setPlayers([{ name: game.name + ' (você)', color: game.color }, ...[...game.players.values()].map((p) => ({ name: p.name, color: p.color }))]);
}

// ---- som do lugar ---------------------------------------------------------------------------
// Algumas vezes por segundo olha em volta (teto, água, árvores, relva) e entrega esse retrato ao motor de som,
// que decide o vento, os pássaros, o eco de caverna e o resto.
const place = { playing: false, underwater: false, enclosed: 0, night: 0, alt: 0, speed: 0, fallSpeed: 0, water: 0, seaWater: 0, waveEnergy: 0, rain: 0, wind: 0, trees: 0, grass: 0, beach: 0, shoreX: 0.83, shoreZ: 0.55, shoreDist: 60, seaY: SEA, depthBelowSurface: 0, nearPier: false, zone: false, nano: false, nearGround: true, dripPos: null };
const heard = { enclosed: 0, water: 0, seaWater: 0, trees: 0, grass: 0, beach: 0 };
let placeT = 0;
// Primeiro bloco não-vazio da coluna, de `de` para baixo, também no subsolo novo (y < 0, profundidade em dobro):
// world.topSolid só desce até 0 (e −1 lá quer dizer "nada"). null = nada ou pedaço não carregado.
function topoAbaixo(x, z, de) {
  const t = world.topSolid(x, z, de);
  if (t >= 0) return t;
  for (let y = Math.min(de, -1); y >= world.fundo; y--) { const b = world.getBlock(x, y, z); if (b === -1) return null; if (KIND[b] !== K_AIR) return y; }
  return null;
}
function surveyPlace(cx, cy, cz) {
  let roof = 0, water = 0, seaWater = 0, seaCols = 0, trees = 0, grass = 0, beach = 0, n = 0;
  let seaVecX = 0, seaVecZ = 0, bestSeaD2 = 1e9, nearPier = false, bestPier = null, bestPierD2 = 1e9;
  const bx = Math.floor(cx), by = Math.floor(cy), bz = Math.floor(cz);
  // teto: cinco colunas em volta da cabeça
  for (const [dx, dz] of [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    for (let y = by + 1; y < by + 22 && y < Y_TOP; y++) {
      const b = world.getBlock(bx + dx, y, bz + dz);
      if (b === -1) break;
      if (b > 0 && OPAQUE[b]) { roof++; break; }
    }
  }
  const hasSea = game.dim === 0 || game.dim === DIM_MACRO;
  const seaY = game.dim === DIM_MACRO ? MACRO_SEA : SEA;
  place.seaY = seaY;
  // chão em volta: uma grade de 7x7 colunas, de 4 em 4 blocos
  for (let dz = -12; dz <= 12; dz += 4) for (let dx = -12; dx <= 12; dx += 4) {
    const top = topoAbaixo(bx + dx, bz + dz, Math.min(Y_TOP - 1, by + 14));
    if (top === null) continue;
    n++;
    const d2 = dx * dx + dz * dz;
    const near = 1 / (1 + d2 / 60);
    const b = world.getBlock(bx + dx, top, bz + dz), up = world.getBlock(bx + dx, top + 1, bz + dz);
    if (LEVEL[up] || LEVEL[b]) {
      if (Math.abs(top - by) < 9) {
        water += near;
        const surfY = LEVEL[up] ? top + 1 : top;
        const skyOpen = ((world.getLight(bx + dx, surfY + 1, bz + dz) | 0) & 15) >= 14;
        if (hasSea && skyOpen && Math.abs(surfY - seaY) <= 3) {
          seaWater += near;
          seaCols++;
          seaVecX += dx * near;
          seaVecZ += dz * near;
          if (d2 < bestSeaD2) bestSeaD2 = d2;
        }
      }
    } else if (KIND[b] === K_CUTOUT) trees++;
    else if (b === B.GRASS || KIND[b] === K_CROSS) grass++;
    else if (b === B.SAND && Math.abs(top - seaY) <= 4) beach++;
  }
  const ground = topoAbaixo(bx, bz, by);
  place.nearGround = ground !== null && by - ground < 9;
  heard.enclosed = roof / 5;
  heard.water = Math.min(1, water / 2.2);
  heard.seaWater = seaCols >= 4 ? Math.min(1, seaWater / 2.0) : 0;
  heard.trees = n ? Math.min(1, trees / n * 3) : 0;
  heard.grass = n ? grass / n : 0;
  heard.beach = n ? Math.min(1, beach / n * 2.5) : 0;
  const sLen = Math.hypot(seaVecX, seaVecZ);
  if (sLen > 1e-3) { place.shoreX = seaVecX / sLen; place.shoreZ = seaVecZ / sLen; }
  place.shoreDist = bestSeaD2 < 1e8 ? Math.max(2, Math.sqrt(bestSeaD2)) : 60;

  // Fontes sonoras localizadas no mundo:
  // Água parada (B.WATER sem queda nem corrente) NÃO emite som de rio/cachoeira.
  const raining = (game.weather?.rain || 0) > 0.2;
  let bestWaterfall = null, bestWfD = 1e9, bestRiver = null, bestRvD = 1e9;
  let bestFire = null, bestFireD = 1e9, bestPortal = null, bestPortalD = 1e9;
  let bestDrip = null, bestDripD = 1e9;
  for (let dy = -3; dy <= 5; dy++) for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
    const x = bx + dx, y = by + dy, z = bz + dz;
    const b = world.getBlock(x, y, z);
    if (b <= 0) continue;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (LEVEL[b] > 0) {
      const aboveB = world.getBlock(x, y + 1, z);
      const aboveL = LEVEL[aboveB] || 0;
      const belowB = world.getBlock(x, y - 1, z);
      const belowL = belowB > 0 ? LEVEL[belowB] : 0;
      const sideAir = world.getBlock(x + 1, y, z) === B.AIR || world.getBlock(x - 1, y, z) === B.AIR || world.getBlock(x, y, z + 1) === B.AIR || world.getBlock(x, y, z - 1) === B.AIR;
      const falling = (aboveL > 0 && belowL > 0 && sideAir) || (b >= B.FLOW_1 && b <= B.FLOW_7 && belowB === B.AIR);
      if (falling) {
        if (d2 < bestWfD) { bestWfD = d2; bestWaterfall = [x + 0.5, y + 0.5, z + 0.5]; }
      } else if (b >= B.FLOW_1 && b <= B.FLOW_7 && d2 < bestRvD) {
        bestRvD = d2; bestRiver = [x + 0.5, y + 0.5, z + 0.5];
      } else if (hasSea && Math.abs(y - seaY) <= 1 && aboveB > 0 && soundOfBlock(BLOCKS, aboveB, world.getMini(x, y + 1, z)) === 'wood') {
        nearPier = true;
        if (d2 < bestPierD2) { bestPierD2 = d2; bestPier = [x + 0.5, seaY + 0.3, z + 0.5]; }
      }
      continue;
    }
    if (b === B.PORTAL) {
      if (d2 < bestPortalD) { bestPortalD = d2; bestPortal = [x + 0.5, y + 0.5, z + 0.5]; }
      continue;
    }
    if (d2 < bestDripD && world.getBlock(x, y - 1, z) === B.AIR) {
      if (SOLID[b] && LEVEL[world.getBlock(x, y + 1, z)] > 0) {
        bestDripD = d2; bestDrip = [x + 0.5, y - 0.1, z + 0.5];
      } else if (raining && KIND[b] === K_CUTOUT && ((world.getLight(x, y + 1, z) | 0) & 15) >= 14) {
        bestDripD = d2; bestDrip = [x + 0.5, y - 0.1, z + 0.5];
      }
    }
    if (b >= B.MC_SOLIDO && b <= B.MC_FORMA) {
      const st = world.getMini(x, y, z);
      if (st >= MC_BASE) {
        const mc = mcEstado(st - MC_BASE);
        if (mc && (/^(campfire|soul_campfire|fire|soul_fire)$/.test(mc.nome) || (/^(furnace|blast_furnace|smoker)$/.test(mc.nome) && mc.props?.lit === 'true')) && mc.props?.lit !== 'false') {
          if (d2 < bestFireD) { bestFireD = d2; bestFire = [x + 0.5, y + 0.5, z + 0.5]; }
        } else if ((mc?.nome === 'nether_portal' || mc?.nome === 'end_portal') && d2 < bestPortalD) {
          bestPortalD = d2; bestPortal = [x + 0.5, y + 0.5, z + 0.5];
        } else if (d2 < bestDripD && ((mc?.nome === 'pointed_dripstone' && mc.props?.vertical_direction === 'down' && mc.props?.thickness === 'tip') || (mc?.nome === 'crying_obsidian' && world.getBlock(x, y - 1, z) === B.AIR))) {
          bestDripD = d2; bestDrip = [x + 0.5, y - 0.1, z + 0.5];
        }
      }
    }
  }
  place.dripPos = bestDrip;
  place.nearPier = nearPier;
  if (bestWaterfall) game.audio.setEmitter('world-waterfall', { key: 'ambiente.cachoeira', pos: bestWaterfall, volume: 0.56, refDist: 4, maxDist: 34 });
  else game.audio.removeEmitter('world-waterfall');
  if (bestRiver) game.audio.setEmitter('world-river', { key: 'ambiente.agua', pos: bestRiver, volume: 0.42, pitch: 1.06, refDist: 3.5, maxDist: 22 });
  else game.audio.removeEmitter('world-river');
  if (bestFire) game.audio.setEmitter('world-fire', { key: 'ambiente.fogo', pos: bestFire, volume: 0.58, refDist: 3.5, maxDist: 24 });
  else game.audio.removeEmitter('world-fire');
  if (bestPortal) game.audio.setEmitter('world-portal', { key: 'ambiente.portal', pos: bestPortal, volume: 0.55, refDist: 4, maxDist: 28 });
  else game.audio.removeEmitter('world-portal');
  if (bestPier) game.audio.setEmitter('world-pier', { key: 'ambiente.pier_lap', pos: bestPier, volume: 0.36, refDist: 3.5, maxDist: 18 });
  else game.audio.removeEmitter('world-pier');
}
function frameAudio(dt, cam, under) {
  placeT -= dt;
  if (placeT <= 0 && game.ready) { placeT = 0.3; surveyPlace(cam.x, cam.y, cam.z); }
  const k = Math.min(1, dt * 2.5);
  for (const key in heard) place[key] += (heard[key] - place[key]) * k;
  place.playing = game.state === 'PLAYING';
  place.underwater = under;
  const seaY = game.dim === DIM_MACRO ? MACRO_SEA : SEA;
  place.seaY = seaY;
  place.depthBelowSurface = under ? Math.max(0, seaY + 0.88 - cam.y) : 0;
  place.night = U.uNight.value;
  place.zone = game.dim === 1; place.nano = game.dim >= DIM_NANO0;
  place.alt = Math.max(0, Math.min(1, (cam.y - SEA - 6) / 70));
  place.speed = game.state === 'PLAYING' ? Math.hypot(player.vel[0], player.vel[1], player.vel[2]) : 0;
  place.fallSpeed = (game.state === 'PLAYING' && !player.onGround && !player.flying && !player.inWater && player.vel[1] < -6) ? -player.vel[1] : 0;
  place.rain = game.weather?.rain || 0;
  place.wind = game.weather?.wind ? Math.min(1, Math.hypot(game.weather.wind[0], game.weather.wind[1]) / 14) : 0;
  place.waveEnergy = (game.dim === 0 || game.dim === DIM_MACRO) ? waveEnergyOfWind(U.uWind.value.z) : 0;
  const vx = game.state === 'PLAYING' ? player.vel[0] : 0, vy = game.state === 'PLAYING' ? player.vel[1] : 0, vz = game.state === 'PLAYING' ? player.vel[2] : 0;
  game.audio.listen(cam.x, cam.y, cam.z, game.state === 'MENU' ? rig.rotation.y : player.yaw, vx, vy, vz);
  game.audio.update(dt, place);
  hudNautico.update(dt, player.yaw, place);
  ambient.update(dt, cam, place, renderer.domElement.height, camera.fov);
  if (!place.underwater && !place.zone) ambient.uniforms.uMotes.value *= 0.12;
  materia.update(dt, cam, place, renderer.domElement.height, camera.fov, game.weather);
  // chuva de verdade (render/chuva.js): com ela ligada, a matéria do ar deixa de desenhar a parcela dela
  if (chuva) { chuva.update(dt, cam, place); if (materia.uniforms) materia.uniforms.uAmt2.value.x = 0; }
}

// ---- laço ------------------------------------------------------------------------------------
const STEP = 1 / 60;
let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0, slowT = 0, fastT = 0, saveT = 0, foscoT = 2;
// Teto de quadros (pedido do Kadmus, 20/11/2026): sem ele o jogo desenhava 155 quadros/s no monitor de 155 Hz e
// deixava a RX 7600 no teto de potência (135–145 W), e a placa travou duas vezes. 60 no PC e 30 no celular/tablet
// ("para mobile precisa ser 30"); `?fps=N` muda, `?fps=0` solta (a sonda com `--uncap 1`). No VR não vale: quem
// dita o ritmo é o visor (72/90 Hz).
const FPS_MAX = (() => { const v = Number(params.get('fps')); return params.has('fps') && v >= 0 ? v : settings.fps > 0 ? Math.min(60, settings.fps) : game.plataforma === 'celular' ? 30 : 60; })();   // settings.fps: ajuste "Limite de quadros" de quem joga (nunca acima de 60)
const QUADRO_MIN = FPS_MAX > 0 ? 1000 / FPS_MAX : 0;
const FPS_ALVO = FPS_MAX || 60;   // a resolução adaptativa mede contra o teto: 30 no celular não é "lento"
let proximoQuadro = 0;
const mv = { x: 0, y: 0, z: 0 }, lk = { x: 0, y: 0 }, intent = { x: 0, z: 0, jump: false, sneak: false, sprint: false };
const eye = [0, 0, 0], look = [0, 0, -1], camHit = {};
const menuCam = new THREE.Vector3();

function frameInput(dt) {
  gamepad.poll(dt);
  const playing = game.state === 'PLAYING' && !game.overlay;
  input.enabled = playing;
  input.takeLook(lk);
  if (playing && !(game.xr && game.xr.presenting)) {
    player.yaw -= lk.x;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - lk.y));
  }
  if (game.state === 'PLAYING' || game.state === 'PAUSED') {
    if (input.wasPressed('pause')) { if (game.state === 'PLAYING') { closeOverlay(); transition('PAUSED'); } else transition('PLAYING'); }
  }
  if (!playing) { intent.x = intent.z = 0; intent.jump = intent.sneak = intent.sprint = false; return; }

  const emFutebol = game.espacoAtivo?.tipo === 'futebol';
  if (input.wasPressed('inventory')) {
    if (game.garagem?.atual) return game.garagem.sair();
    if (game.costa?.usaTeclaE?.()) return;
    game.audio.play('open', 1, 1);
    if (emFutebol) return game.futebol?.abrirPainel('partida');
    return openOverlay('palette');
  }
  if (input.wasPressed('chat')) { openOverlay('chat'); return ui.chatOpen(''); }
  if (input.wasPressed('command')) { openOverlay('chat'); return ui.chatOpen('/'); }
  if (input.wasPressed('debug')) game.debug = !game.debug;
  if (input.wasPressed('view')) game.view = (game.view + 1) % 2;
  if (!emFutebol) {
    if (input.wasPressed('planeIn')) changePlane(game.dim === DIM_MACRO ? 'normal' : 'nano');
    if (input.wasPressed('planeOut')) changePlane(game.dim >= DIM_NANO0 ? 'normal' : 'macro');
    if (input.wasPressed('mini')) {
      interaction.miniMode = !interaction.miniMode;
      game.audio.play('tick', 1, interaction.miniMode ? 1.15 : 0.85);
      ui.toast(interaction.miniMode ? `Modo mini-bloco (0,5 × 0,5 × 1 m): ${device.touch ? 'toque' : 'clique'} para pôr 1/4 de bloco. ${device.touch ? 'O botão Mini' : 'Y'} desativa.` : 'Modo bloco inteiro.', 2400);
    }
    if (input.wasPressed('trunkMode')) toggleTrunkMode();
  }
  if (emFutebol && game.futebol) {
    if (input.hotbar >= 0) game.futebol.selectSkill(input.hotbar);
    const curI = (game.futebol.skillAtual?.tecla || 1) - 1;
    if (input.wasPressed('hotNext')) game.futebol.selectSkill(curI + 1);
    if (input.wasPressed('hotPrev')) game.futebol.selectSkill(curI - 1);
  } else {
    const selWas = game.sel;
    if (input.hotbar >= 0) game.sel = input.hotbar;
    if (input.wasPressed('hotNext')) game.sel = (game.sel + 1) % 9;
    if (input.wasPressed('hotPrev')) game.sel = (game.sel + 8) % 9;
    if (game.sel !== selWas) game.audio.play('tick', 1, 0.9 + game.sel * 0.03);
  }
  if (input.wasPressed('jump')) {
    const now = performance.now() / 1000;
    if (!emFutebol && now - game.lastJump < 0.3) { player.flying = !player.flying; game.lastJump = -9; if (player.flying) player.vel[1] = 0; } else game.lastJump = now;
  }
  input.move(mv);
  intent.x = mv.x; intent.z = mv.z;
  intent.jump = input.isDown('jump') || mv.y > 0.5;
  intent.sneak = input.isDown('sneak') || mv.y < -0.5;
  intent.sprint = input.isDown('sprint');
}

function frameGame(dt, alpha) {
  const centro = game.gen?.fortaleza;
  if (centro && net.online && !game.gmFortaleza && game.state === 'PLAYING') {
    const p=player.pos;
    if (dentroDoPalacio(centro,p)) {
      player.teleport(...(game.foraDoSalao || foraDoPalacio(centro)));
      if (!game.avisoSalao || performance.now()-game.avisoSalao>2000) {
        ui.toast('A entrada no palácio é exclusiva do GM. Você pode visitar a geleira.',3500);
        game.avisoSalao=performance.now();
      }
    } else if (naGeleira(centro,p[0],p[2])) {
      const fora=game.foraDoSalao ||= [0,0,0]; fora[0]=p[0]; fora[1]=p[1]; fora[2]=p[2];
    } else game.foraDoSalao=null;
  }
  const playing = game.state === 'PLAYING' && !game.overlay;
  const xr = game.xr && game.xr.presenting;
  player.eye(alpha, eye);

  if (game.state === 'MENU' || game.state === 'BOOT') {
    // câmera passeando em volta do ponto de nascimento
    const s = game.spawn || { x: 0, y: 70, z: 0 };
    const a = performance.now() / 1000 * 0.045;
    menuCam.set(s.x + Math.cos(a) * 26, s.y + 15, s.z + Math.sin(a) * 26);
    rig.position.copy(menuCam); rig.rotation.set(0, Math.PI / 2 - a + 0.5, 0);
    pivot.position.set(0, 0, 0); pivot.rotation.set(-0.2, 0, 0); camera.position.set(0, 0, 0);
    world.update(s.x, s.z);
    ui.setLoading(game.ready ? world.progress() : 0);
    ui.setPlayLabel(game.ready && world.progress() > 0.25 ? 'Jogar' : 'Carregando…', !(game.ready && world.progress() > 0.25));
  } else {
    // mira e ações
    const cp = Math.cos(player.pitch);
    look[0] = -Math.sin(player.yaw) * cp; look[1] = Math.sin(player.pitch); look[2] = -Math.cos(player.yaw) * cp;
    {
      let ray = xr ? game.aimRay : null;
      if (!xr && game.aimScreen) {
        ndc.set(game.aimScreen[0] / window.innerWidth * 2 - 1, -(game.aimScreen[1] / window.innerHeight) * 2 + 1);
        screenRay.setFromCamera(ndc, camera);
        const o = screenRay.ray.origin, d = screenRay.ray.direction;
        rayBuf[0] = o.x; rayBuf[1] = o.y; rayBuf[2] = o.z; rayBuf[3] = d.x; rayBuf[4] = d.y; rayBuf[5] = d.z;
        ray = rayBuf;
      }
      game.ray = ray;
      if (ray) interaction.aim(ray[0], ray[1], ray[2], ray[3], ray[4], ray[5]);
      else interaction.aim(eye[0], eye[1], eye[2], look[0], look[1], look[2]);
      // objetos, máquinas etc. têm a vez antes dos blocos: quem tratar a mira devolve true
      const ro = ray ? [ray[0], ray[1], ray[2]] : eye, rd = ray ? [ray[3], ray[4], ray[5]] : look;
      game.treeAim=game.trees?.aim(ro,rd,interaction.reach+3)||null;
      let handled = false;
      for (const f of game.hooks.interact) if (f(dt, playing, ro, rd)) { handled = true; break; }
      if (handled) effects.target(null);
      else if (playing) {
        if (input.wasPressed('pick')) { const id = interaction.pick(); if (id) { game.hotbar[game.sel] = id; store.set('hotbar', game.hotbar); } }
        interaction.update(dt, {
          breakHeld: input.isDown('break'), breakPressed: input.wasPressed('break'),
          placeHeld: input.isDown('place'), placePressed: input.wasPressed('place'),
        }, game.hotbar[game.sel], ray ? [ray[3], ray[4], ray[5]] : look);
      }
      const held = game.hotbar[game.sel];
      const showTrunk = !!(TRONCO_OK[held] && !interaction.miniMode && game.modeRules?.poe && !game.tool && !game.espacoAtivo);
      ui.setTrunkMode(interaction.squareTrunk, showTrunk);
      if (!handled) {
        effects.target(interaction.target);
        let hint = crafting.hintFor(interaction.target) || (game.hint ? game.hint(interaction.targetName()) : interaction.targetName());
        if (showTrunk) {
          const tag = `Tronco ${interaction.squareTrunk ? 'quadrado' : 'redondo'} (K alterna)`;
          hint = hint ? `${hint} · ${tag}` : tag;
        }
        ui.setHint(hint);
      }
    }
    ui.setHotbar(game.hotbar, game.sel);

    // câmera
    if (!xr) {
      rig.position.set(eye[0], eye[1] - EYE_H, eye[2]);
      rig.rotation.set(0, player.yaw, 0);
      pivot.position.set(0, EYE_H + (game.view !== 1 && game.garagem?.atual?.tipo === 'balao' ? 2.5 : 0), 0);
      pivot.rotation.set(player.pitch, 0, 0);
      let want = game.view === 1 ? 4.2 : 0;
      if (game.camWant !== undefined) want = game.camWant;
      if (game.garagem?.atual) want = game.view === 1 ? 0 : game.garagem.distanciaCamera;
      if (want > 0) {
        raycastVoxels(world.getBlock, eye[0], eye[1], eye[2], -look[0], -look[1], -look[2], want + 0.3, (id) => SOLID[id] === 1, camHit);
        if (camHit.hit) want = Math.max(0.3, camHit.t - 0.3);
      }
      game.camDist += (want - game.camDist) * Math.min(1, dt * 12);
      camera.position.set(0, 0, game.camDist);
      if (game.shake > 0) camera.position.add(menuCam.set(Math.random() - 0.5, Math.random() - 0.5, 0).multiplyScalar(game.shake * 0.5));
    } else game.xr.place(eye[0], eye[1] - EYE_H, eye[2]);
    if (touch) touch.update(player.flying, player.inWater, !!(machines && machines.seat) || !!game.pilotando, input.shapeMode, game.tool?.o, !!game.espacoAtivo);
    self.root.visible = !xr && game.camDist > 0.6 && !game.hideSelf;
    if (self.root.visible) {
      self.root.position.set(eye[0], eye[1] - EYE_H, eye[2]);
      self.root.rotation.y = player.yaw;   // rosto da skin em −Z = frente (17/11)
      self.head.rotation.x = -player.pitch;
      const sw = Math.sin(player.walked * 2.3) * Math.min(1, Math.hypot(player.vel[0], player.vel[2]) / 3.5) * 0.9;
      self.legL.rotation.x = sw; self.legR.rotation.x = -sw; self.armL.rotation.x = -sw * 0.8; self.armR.rotation.x = sw * 0.8;
      if (game.garagem?.atual) game.garagem.posar(self, game.garagem.atual);
    }
    if (game.pendingSpawn && world.isLoaded(game.spawn.x, game.spawn.z)) { game.pendingSpawn = false; placePlayer(true); }
    // sons do corpo: passo orgânico no chão/água rasa/areia molhada/madeira, salto, queda e respiração realista
    if (player.jumped) {
      player.jumped = false;
      const bx = Math.floor(player.pos[0]), bz = Math.floor(player.pos[2]);
      let by = Math.floor(player.pos[1] - 0.08), under = world.getBlock(bx, by, bz);
      if (under <= 0) { by = Math.floor(player.pos[1] - 0.38); under = world.getBlock(bx, by, bz); }
      game.audio.play('jump', player.sneaking ? 0.24 : 0.38, 0.94 + Math.random() * 0.12, surfaceMaterialAt(bx, by, bz, player.pos[1], under, player.inWater));
    }
    if (player.onGround && !player.flying) {
      if (game.nextStepDist == null) game.nextStepDist = 1.85;
      if (player.walked - (game.stepAt || 0) >= game.nextStepDist) {
        game.stepAt = player.walked;
        game.nextStepDist = (player.sneaking ? 1.48 : 1.82) * (0.88 + Math.random() * 0.24);
        const bx = Math.floor(player.pos[0]), bz = Math.floor(player.pos[2]);
        let by = Math.floor(player.pos[1] - 0.08);
        let under = world.getBlock(bx, by, bz);
        if (under <= 0) { by = Math.floor(player.pos[1] - 0.38); under = world.getBlock(bx, by, bz); }
        const stepVol = player.sneaking ? 0.36 : 0.95;
        const surfMat = surfaceMaterialAt(bx, by, bz, player.pos[1], under, player.inWater);
        if (surfMat === 'water') game.audio.play('step', stepVol * 0.72, 1, 'water');
        else if (under > 0) game.audio.play('step', stepVol, 1, surfMat);
        const inFeet = world.getBlock(bx, Math.floor(player.pos[1] + 0.15), bz);
        if (inFeet === B.TALL_GRASS || KIND[inFeet] === K_CROSS) game.audio.play('step', stepVol * 0.42, 1.04, 'leaves');
      }
    } else {
      game.stepAt = player.walked;
    }
    if (player.landed) {
      const bx = Math.floor(player.pos[0]), bz = Math.floor(player.pos[2]);
      let by = Math.floor(player.pos[1] - 0.08);
      let under = world.getBlock(bx, by, bz);
      if (under <= 0) { by = Math.floor(player.pos[1] - 0.38); under = world.getBlock(bx, by, bz); }
      const mat = surfaceMaterialAt(bx, by, bz, player.pos[1], under, player.inWater);
      game.audio.play('land', Math.min(1, player.landed / 14), 1, mat);
      if (player.landed > 13.5 && !player.inWater) {
        const hard = Math.min(1, (player.landed - 13) / 14);
        game.audio.play('fall', 0.35 + hard * 0.55, 0.94 + Math.random() * 0.12, mat);
        game.audio.play('exhale', 0.28 + hard * 0.25, 0.95 + Math.random() * 0.1);
      }
      player.landed = 0;
    }
    // mergulho e respiração: submerge ao afundar a cabeça, emerge ao voltar à tona, fôlego em mergulho longo
    if (player.headInWater) {
      if (!game.wasHeadInWater) game.audio.play('submerge', 0.78, 0.95 + Math.random() * 0.1, 'water');
      game.subSec = (game.subSec || 0) + dt;
    } else {
      if (game.wasHeadInWater) game.audio.play('emerge', 0.72, 0.95 + Math.random() * 0.1, 'water');
      if ((game.subSec || 0) >= 2.2) {
        game.audio.play('gasp', Math.min(0.82, 0.38 + game.subSec * 0.055), 0.94 + Math.random() * 0.12);
      }
      game.subSec = 0;
    }
    game.wasHeadInWater = !!player.headInWater;
    game.breathCd = Math.max(0, (game.breathCd || 0) - dt);
    if (player.sprinting && player.onGround) {
      game.sprintSec = (game.sprintSec || 0) + dt;
      if (game.sprintSec > 4.5 && game.breathCd <= 0) {
        game.audio.play('breath', Math.min(0.38, 0.22 + (game.sprintSec - 4.5) * 0.025), 0.95 + Math.random() * 0.1);
        game.breathCd = 1.9 + Math.random() * 0.6;
      }
      if (game.sprintSec > 3.5) game.recoverT = Math.min(4.5, (game.sprintSec - 3.0) * 0.6);
    } else {
      game.sprintSec = Math.max(0, (game.sprintSec || 0) - dt * 1.4);
      if ((game.recoverT || 0) > 0 && !player.headInWater) {
        game.recoverT = Math.max(0, game.recoverT - dt);
        if (game.breathCd <= 0) {
          game.audio.play('breath', 0.24, 0.93 + Math.random() * 0.1);
          game.breathCd = 1.7 + Math.random() * 0.7;
        }
      }
    }
    // água: o mergulho ao entrar/sair, as braçadas enquanto nada (uw_swim submerso, swim na superfície)
    game.audio.water(player.inWater, Math.hypot(...player.vel), player.vel[1], dt);
    if (player.inWater && !player.flying) {
      game.swimT = (game.swimT || 0) + dt * Math.hypot(player.vel[0], player.vel[1], player.vel[2]);
      if (game.swimT > 2.6) {
        game.swimT = 0;
        game.audio.play(player.headInWater ? 'uw_swim' : 'swim', 0.8, 0.85 + Math.random() * 0.3, 'water');
      }
    }
    world.update(player.pos[0], player.pos[2]);
    net.sendState(performance.now(), player.pos, player.yaw, player.pitch, game.hotbar[game.sel] || 0, (player.flying ? 1 : 0) | (xr ? 2 : 0) | (player.sneaking ? 8 : 0), game.garagem?.pose);
  }

  const camWorld = camera.getWorldPosition(menuCam);
  atmosphere.state.tunelSeco = game.ferrovia.seco(camWorld.x, camWorld.y, camWorld.z);
  const under = !atmosphere.state.tunelSeco && wetAt(world.getBlock, camWorld.x, camWorld.y, camWorld.z);
  atmosphere.state.underwater = under;
  ui.setUnderwater(under);
  frameAudio(dt, camWorld, under);
  atmosphere.update(net.time(), world.radius * 16, game.dim === 1, game.dim === 0 ? SEA + 0.88 : game.dim === DIM_MACRO ? MACRO_SEA + 0.88 : -1e4);
  avatars.update(dt);
  effects.update(dt);
  for (const f of game.hooks.frame) f(dt, alpha);
  if (game.xr?.sync) game.xr.sync();

  if (game.debug) {
    const ri = renderer.info.render, t = interaction.target;
    ui.setDebug(
      `Kraft  ${game.fps.toFixed(0)} fps  ${ri.calls} draws  ${(ri.triangles / 1000).toFixed(0)}k tri  x${pixelRatio.toFixed(2)}\n` +
      `pos ${player.pos.map((v) => v.toFixed(1)).join(' ')}  ${player.flying ? 'voando' : player.onGround ? 'chão' : 'ar'}${player.inWater ? ' água' : ''}\n` +
      `chunks ${world.stats.meshed}/${world.stats.chunks}  ${(world.stats.quads / 1000).toFixed(0)}k quads  malha ${world.stats.meshMs.toFixed(1)} ms  fila ${world.stats.pending}\n` +
      `mundo ${game.slug} semente ${game.seed}  ${net.offline ? 'offline' : net.online ? 'online' : 'conectando'}  jogadores ${game.players.size + 1}\n` +
      (t.hit ? `mira ${interaction.targetName() || BLOCKS[t.id]?.name} em ${t.x} ${t.y} ${t.z}` : 'mira —'));
  } else ui.setDebug(null);
}

// Foco de câmera (prova de realismo): a que distância está o que se vê no centro da tela. Anda pelo raio do olhar até
// o primeiro bloco sólido (passos de 25 cm, até 80 m); sem nada à frente, foca longe.
const focoDir = new THREE.Vector3(), focoDe = new THREE.Vector3();
// O foco atravessa o que é transparente (pedido do Kadmus, 19/11: "o foco está travando no vidro e não me permite ver
// com foco o que está lá fora"): vidros, gelo e os vidros do Minecraft. O espelho continua sendo alvo.
const FOCO_ATRAVESSA = new Set([B.GLASS, B.GLASS_SMOKE, B.GLASS_GOLD, B.GLASS_SILVER, B.GLASS_BLUE, B.GLASS_RED, B.ICE]);
function focoTransparente(b, x, y, z) {
  if (FOCO_ATRAVESSA.has(b)) return true;
  if (b === B.MC_RECORTE || b === B.MC_SOLIDO) {
    const st = world.getBlock.mini?.(x, y, z) || 0;
    if (st >= MC_BASE) { const nome = mcEstado(st - MC_BASE)?.nome || ''; return /glass|ice/.test(nome) && !/packed|blue_ice/.test(nome); }
  }
  return false;
}
function focoNoCentro() {
  camera.getWorldPosition(focoDe); camera.getWorldDirection(focoDir);
  for (let t = 0.5; t < 80; t += t < 12 ? 0.25 : 0.75) {
    const x = Math.floor(focoDe.x + focoDir.x * t), y = Math.floor(focoDe.y + focoDir.y * t), z = Math.floor(focoDe.z + focoDir.z * t);
    const b = world.getBlock(x, y, z);
    if (b === -1) break;
    if (b > 0 && SOLID[b] === 1 && !focoTransparente(b, x, y, z)) return t;
  }
  return 120;
}

function loop(now) {
  if (QUADRO_MIN && !renderer.xr.isPresenting) {
    // folga de 2 ms: num monitor de 60 Hz o quadro chega com tremida e não pode ser pulado (cairia para 30)
    if (now + 2 < proximoQuadro) return;
    proximoQuadro = now - proximoQuadro > QUADRO_MIN ? now + QUADRO_MIN : proximoQuadro + QUADRO_MIN;
  }
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) dt = 0.001;
  if (dt > 0.25) dt = 0.25;                    // voltou de uma aba em segundo plano: não deixa a física disparar
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { game.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; adaptResolution(); }
  U.uTime.value += dt;

  if (game.xr) game.xr.update();
  frameInput(dt);
  for (const f of game.hooks.pre) f(dt);
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 6) {
    if (game.state === 'PLAYING' || game.state === 'PAUSED') {
      let seated = false;
      for (const f of game.hooks.fixed) if (f(STEP, intent)) seated = true;
      if (!seated) player.step(STEP, intent);
    }
    acc -= STEP; steps++;
  }
  if (steps === 6) acc = 0;
  // no VR quem fecha a imagem são os próprios shaders (o visor tem o framebuffer dele)
  const usePost = !!post && !renderer.xr.isPresenting;
  U.uDirect.value = usePost ? 0 : 1;
  U.uHeadset.value = renderer.xr.isPresenting ? 1 : 0;
  if (renderer.xr.isPresenting) {
    if ((foscoT += dt) > 2) { foscoT = 0; aplicarFosco(scene); }
  } else foscoT = 2;
  frameGame(dt, acc / STEP);
  atmosphere.aimShadow(renderer, camera.getWorldPosition(menuCam));
  if (usePost && quality.real?.camera?.foco > 0) post.setFoco(focoNoCentro());
  renderer.info.reset();
  if (usePost) post.render(scene, camera, atmosphere.state);
  else renderer.render(scene, camera);
  atmosphere.afterRender();
  input.endFrame();
  game.frames++;

  saveT += dt;
  if (net.offline && game.dim === 0 && (offWaterT += dt) > 0.25) { offWaterT = 0; if (offWater.pending()) offWater.step(); }
  if (saveT > 5) {
    saveT = 0; savePosition();

  }
}

// Resolução adaptativa: cai quando o aparelho não acompanha e sobe de volta quando sobra.
// Se baixar não ajudou (tela travada em 30 Hz, GPU ocupada por outro programa), desfaz e espera:
// piorar a imagem sem ganhar quadros não serve a ninguém.
let trial = null, holdUntil = 0;
function adaptResolution() {
  if (game.xr && game.xr.presenting) return;
  const cap = Math.min(window.devicePixelRatio || 1, quality.dpr), now = performance.now();
  if (trial) {
    if (now - trial.t < 2000) return;
    if (game.fps < trial.fps * 1.15) { pixelRatio = trial.from; renderer.setPixelRatio(pixelRatio); holdUntil = now + 60000; }
    trial = null; slowT = fastT = 0;
    return;
  }
  if (game.fps < FPS_ALVO * 0.7) { slowT += 0.5; fastT = 0; } else if (game.fps > FPS_ALVO * 0.95) { fastT += 0.5; slowT = 0; } else { slowT = fastT = 0; }
  if (slowT >= 2.5 && pixelRatio > 0.6 && now > holdUntil) {
    trial = { t: now, fps: game.fps, from: pixelRatio };
    pixelRatio = Math.max(0.6, pixelRatio - 0.15); renderer.setPixelRatio(pixelRatio); slowT = 0;
  }
  if (fastT >= 8 && pixelRatio < cap) { pixelRatio = Math.min(cap, pixelRatio + 0.1); renderer.setPixelRatio(pixelRatio); fastT = 0; }
}

function onResize() {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);

// ---- partida -------------------------------------------------------------------------------------
window.LAVRA = { THREE, trees, post, glassLayer, ambient, materia, nature, skyReal, trails, voxels, obras, objectTools, machines, entities, crafting, fx, renderer, scene, camera, rig, pivot, world, player, net, ui, input, game, interaction, avatars, effects, atmosphere, U, shaderErrors, settings, quality, device, store, transition, state: game };

ui.setPartida(params.get('partida') === 'multiplayer' || (!params.has('partida') && params.has('mundo')) ? 'multiplayer' : 'solo');
ui.setMenu(params.get('nome') || store.get('nome', ''), params.get('mundo') || store.get('mundo', 'principal'));
world.setMcPilha(params.get('pacote') || store.get('pacoteMc', 'realista'));   // blocos do Minecraft: formas e texturas desta pilha
ui.setStatus('Pintando as texturas…');
world.requestTextures(quality.texSize, TEXTURES, !!quality.pbr).then(async (m) => {
  const maps = params.get('blocos') === '0' ? null : await loadBlockMaps(m.size, TEXTURES);
  const relief = maps && maps.strips.length ? applyBlockMaps(maps, m.size, TEXTURES.length, m.data, m.surf) : null;
  game.blockMaps = maps ? maps.strips.map((s) => s.name) : [];
  U.uTexSize.value = m.size;
  U.uTex.value = makeBlockTextureArray(m.data, m.size, TEXTURES.length, Math.min(quality.aniso, renderer.capabilities.getMaxAnisotropy()));
  // blocos do Minecraft: folha do pacote escolhido (?pacote=minecraft|realista); até chegar, uma camada cinza
  U.uMcTex.value = texturaVaziaMc();
  // resolução da folha: o original é pixel art de 16 (nítido, sem borrar); a Realista vai a 128 (nativo do rotrBLOCKS) no perfil alto
  const resMc = world.mcPilha() === 'minecraft' ? 16 : quality.texSize >= 256 ? 128 : 64;
  carregarPacoteMc(world.mcPilha(), resMc, Math.min(quality.aniso, renderer.capabilities.getMaxAnisotropy()))
    .then((r) => { if (r) {
      U.uMcTex.value = r.textura; game.pacoteMc = r.info.pilha;
      const pal = criarPaletaMc({ malhaUrl: new URL(`assets/mc/malha-${world.mcPilha()}.json`, location.href).href, pacote: r });   // aba Minecraft da tecla E
      pal.pronto.then(() => { game.mcPaleta = pal; ui.setMcPaleta(pal); ui.setHotbar(game.hotbar, game.sel); game.items?.render(); crafting?.renderQuick(); });
    } }).catch(() => {});
  if (m.surf) U.uSurf.value = makeSurfaceArray(m.surf, m.size, TEXTURES.length);
  if (relief && m.surf) {
    U.uRel.value = makeReliefArray(relief, m.size, TEXTURES.length);
    U.uRelInfo.value.x = params.get('relevo') === '0' ? 0 : 1;
  }
  icons = createIcons(m.data, m.size);
  game.icons = icons; game.texData = m.data; game.texSize = m.size;
  ui.setIcons(icons);
  ui.setHotbar(game.hotbar, game.sel);
  transition('MENU');
  connect(worldSlug(ui.menuValues().world));
  for (const f of game.hooks.other) f({ t: 'boot' });
  // volta direto ao mundo: nos testes (`auto=1`) e depois de um recarregamento pedido pelo servidor (versão nova no ar)
  let voltar = null;
  try { voltar = sessionStorage.getItem('lavra.voltar'); sessionStorage.removeItem('lavra.voltar'); } catch { /* sem armazenamento de sessão */ }
  voltouSozinho = !!voltar;
  if (params.has('auto') || voltar) {
    const wait = setInterval(() => { if (game.ready && world.progress() > 0.3) { clearInterval(wait); net.spawn(cleanName(params.get('nome') || voltar || '') || 'Teste'); } }, 150);
  }
});
renderer.setAnimationLoop(loop);

export { game, world, player, net, ui, input, scene, camera, rig, pivot, renderer, interaction, avatars, effects, atmosphere, settings, quality, device, store, materials, lightProbe, transition, openOverlay, closeOverlay };
