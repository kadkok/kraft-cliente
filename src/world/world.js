// LAVRA — o mundo no cliente: guarda os voxels dos chunks carregados, reparte o
// trabalho entre os workers e mantém as malhas na cena.
// Dono dos dados: esta thread. Os workers são funções puras (gerar, malhar).

import * as THREE from '../three.js';
import { CW, ckey, Y_MIN, Y_TOP, YOFF, fundoDe } from '../../shared/constants.js';
// Profundidade em dobro (19/11/2026): `c.vox` guarda as camadas de Y_MIN a Y_TOP − 1 em todos os planos (índice de
// armazenamento = índice da edição + YOFF). Os mapas de edições e de mini-blocos seguem com o índice de EDIÇÃO (y do
// mundo, que pode ser negativo: decodificar com >> e &). `c.maxY` e `c.minY` estão em y do mundo: maior y ocupado e
// menor y aberto (ar, água, ou qualquer célula editada) — o mesher pula o que está abaixo do menor dos 9 pedaços.
// O fundo do plano (`fundo`) é Y_MIN no plano de cima e 0 nos outros: abaixo dele tudo lê rocha-mãe, como sempre.
import { B, KIND, K_AIR } from '../../shared/blocks.js';

const SHARED_QUADS = 16384; // 65536 vértices: cabe em índice de 16 bits

import { surfaceShape } from '../../shared/surfaces.js';
import { isMiniState, MINI_OK, keepState, MOLDE } from '../../shared/minis.js';

import { blocosFerroviarios } from '../../shared/ferrovia-terreno.js';

export function createWorld({ scene, materials, quality }) {
  const group = new THREE.Group();
  group.name = 'terreno';
  scene.add(group);

  const chunks = new Map();   // chave -> chunk
  let ferrovia = null;
  const edits = new Map();    // chave -> Map(índice -> bloco): tudo o que difere do terreno gerado
  let mcPilha = 'realista';   // pilha de pacotes dos blocos do Minecraft (world/mc-malha.js no worker)
  const minis = new Map();    // chave -> Map(índice -> estado mini-bloco)
  const urgent = [];          // remalhar já (edição do jogador)
  const soon = [];            // remalhar logo (vizinhos afetados pela luz)
  const applyQueue = [];      // malhas prontas esperando subir para a GPU
  // quem quer saber do mundo: models (peças com modelo), block (x, y, z, id: um bloco mudou), chunk (cx, cz: um pedaço
  // ganhou ou trocou os seus voxels), reset (mundo ou dimensão nova)
  const listeners = { models: null, loaded: null, block: null, chunk: null, surface: null, reset: null };
  let epoch = 0, seed = 0, dim = 0, fundo = fundoDe(0);
  let radius = quality.distance;
  let spiral = buildSpiral(radius);
  let pcx = 1e9, pcz = 1e9, planDirty = true;
  const stats = { chunks: 0, meshed: 0, pending: 0, quads: 0, genMs: 0, meshMs: 0, jobs: 0 };

  // índice de quads compartilhado por todas as malhas pequenas
  const sharedIdx = new Uint16Array(SHARED_QUADS * 6);
  for (let q = 0, i = 0; q < SHARED_QUADS; q++) {
    const b = q * 4;
    sharedIdx[i++] = b; sharedIdx[i++] = b + 1; sharedIdx[i++] = b + 2;
    sharedIdx[i++] = b; sharedIdx[i++] = b + 2; sharedIdx[i++] = b + 3;
  }
  const sharedIndex = new THREE.BufferAttribute(sharedIdx, 1);

  // ---- workers ---------------------------------------------------------------
  const workers = [];
  const texWaiters = [];
  for (let i = 0; i < quality.workers; i++) {
    const w = new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' });
    const slot = { w, load: 0 };
    w.onmessage = (e) => onMessage(slot, e.data);
    w.onerror = (e) => console.error('[worker de chunks]', e.message || e);
    workers.push(slot);
  }

  function onMessage(slot, m) {
    if (m.t === 'tex') { const r = texWaiters.shift(); if (r) r(m); return; }
    if (m.t === 'ready') return;
    slot.load--;
    stats.pending--;
    if (m.epoch !== epoch) return;
    const c = chunks.get(ckey(m.cx, m.cz));
    if (!c) return;
    if (m.t === 'gen') {
      c.genPending = false;
      c.vox = m.vox;
      c.maxY = m.maxY;
      c.minY = Number.isFinite(m.minY) ? m.minY : fundo;
      const ed = edits.get(c.key);
      if (ed) for (const [i, id] of ed) { c.vox[i + YOFF] = id; const y = i >> 8; if (id && y > c.maxY) c.maxY = y; if (y < c.minY) c.minY = y; }
      aplicarFerrovia(c);
      if (listeners.chunk) listeners.chunk(c.cx, c.cz);
      planDirty = true;
      stats.jobs++;
    } else if (m.t === 'mesh') {
      c.meshPending = false;
      c.meshedRev = m.rev;
      stats.meshMs += (m.ms - stats.meshMs) * 0.05;
      applyQueue.push(c, m);
      if (c.rev !== m.rev) planDirty = true;
    }
  }

  function freeWorker(maxLoad) {
    let best = null;
    for (const s of workers) if (s.load < maxLoad && (!best || s.load < best.load)) best = s;
    return best;
  }

  function requestTextures(size, names, surface) {
    return new Promise((resolve) => {
      texWaiters.push(resolve);
      workers[0].w.postMessage({ t: 'tex', size, names, surface });
    });
  }

  // ---- ciclo de vida -----------------------------------------------------------
  function buildSpiral(r) {
    const list = [];
    for (let dz = -r - 2; dz <= r + 2; dz++) for (let dx = -r - 2; dx <= r + 2; dx++) {
      const d2 = dx * dx + dz * dz;
      // gera até r+2: todo chunk malhável (até r+0,5) precisa dos 8 vizinhos, que ficam até 1,42 além
      if (d2 <= (r + 2) * (r + 2)) list.push([dx, dz, d2]);
    }
    return list.sort((a, b) => a[2] - b[2]);
  }

  function disposeMeshes(c) {
    for (let i = 0; i < c.meshes.length; i++) {
      const m = c.meshes[i];
      if (!m) continue;
      group.remove(m);
      if (m.geometry.index === sharedIndex) m.geometry.index = null; // não deixa o three apagar o índice de todos
      m.geometry.dispose();
      c.meshes[i] = null;
    }
    if (c.quads) { stats.quads -= c.quads; c.quads = 0; }
    if (c.hasMesh) { c.hasMesh = false; stats.meshed--; }
    if (listeners.models) listeners.models(c, null);
  }

  function reset(newSeed, newDim = 0, opt = null) {
    epoch++;
    seed = newSeed >>> 0; dim = newDim; fundo = fundoDe(dim); getBlock.fundo = fundo;
    for (const c of chunks.values()) disposeMeshes(c);
    chunks.clear(); edits.clear(); minis.clear(); ferrovia = null;
    urgent.length = soon.length = applyQueue.length = 0;
    stats.chunks = stats.meshed = stats.quads = 0;
    pcx = pcz = 1e9; planDirty = true; lastChunk = null;
    if (listeners.reset) listeners.reset();
    for (const s of workers) s.w.postMessage({ t: 'init', seed, dim, opt, epoch, mcPilha });
  }

  function aplicarFerrovia(c) {
    const ed = edits.get(c.key);
    if (c.ferroOrig) {
      for (const [i, v] of c.ferroOrig) if (!ed?.has(i)) c.vox[i + YOFF] = v;
      c.ferroOrig = null;
    }
    const via = blocosFerroviarios(ferrovia, c.cx, c.cz);
    if (!via) return;
    c.ferroOrig = new Map();
    for (const [i, id] of via) {
      if (ed?.has(i)) continue;
      c.ferroOrig.set(i, c.vox[i + YOFF]);
      c.vox[i + YOFF] = id;
      if (id) c.maxY = Math.max(c.maxY, i >> 8);
      c.minY = Math.min(c.minY, i >> 8);
    }
  }
  function definirFerrovia(indice) {
    const anterior = ferrovia;
    ferrovia = indice;
    for (const c of chunks.values()) {
      const k = c.cx + ',' + c.cz;
      if (!c.vox || !(anterior?.has(k) || indice?.has(k))) continue;
      aplicarFerrovia(c);
      if (listeners.chunk) listeners.chunk(c.cx, c.cz);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const n = chunks.get(ckey(c.cx + dx, c.cz + dz));
        if (n) n.rev++;
      }
    }
    planDirty = true;
  }

  function setDistance(r) {
    radius = r;
    spiral = buildSpiral(r);
    pcx = pcz = 1e9; planDirty = true;
  }

  function getOrCreate(cx, cz) {
    const key = ckey(cx, cz);
    let c = chunks.get(key);
    if (!c) {
      c = { cx, cz, key, vox: null, maxY: 0, minY: 0, genPending: false, meshPending: false, rev: 0, meshedRev: -1, meshes: [null, null, null], quads: 0, hasMesh: false, models: null };
      chunks.set(key, c);
      stats.chunks++;
    }
    return c;
  }

  const nb = new Array(9), nbMax = new Array(9), nbMin = new Array(9), nbProtected = new Array(9), nbMinis = new Array(9);
  function gatherNeighbors(c) {
    let i = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++, i++) {
      const n = chunks.get(ckey(c.cx + dx, c.cz + dz));
      if (!n || !n.vox) return false;
      nb[i] = n.vox; nbMax[i] = n.maxY; nbMin[i] = n.minY;
      const mp = minis.get(n.key);
      // terra moldada é edição, mas não é protegida: ganha rampa como o chão natural. O mesher recebe índices de
      // ARMAZENAMENTO (edição + YOFF): nunca negativos, cabem nos 16 bits de baixo ao lado do estado do mini-bloco.
      nbProtected[i]=Uint32Array.from([...(edits.get(n.key)?.keys()||[])].filter((idx)=>mp?.get(idx)!==MOLDE),(idx)=>idx+YOFF);
      nbMinis[i] = mp && mp.size ? Uint32Array.from(mp.entries(), ([idx, st]) => (idx + YOFF) | (st << 16)) : null;
    }
    return true;
  }

  function dispatchMesh(c, maxLoad) {
    if (c.meshPending || !c.vox) return false;
    const s = freeWorker(maxLoad);
    if (!s) return false;
    if (!gatherNeighbors(c)) return false;
    c.meshPending = true;
    s.load++; stats.pending++;
    s.w.postMessage({ t: 'mesh', epoch, cx: c.cx, cz: c.cz, rev: c.rev, chunks: nb.slice(), maxYs: nbMax.slice(), minYs: nbMin.slice(), protectedCells: nbProtected.slice(), miniCells: nbMinis.slice() });
    return true;
  }

  function drainList(list, maxLoad) {
    for (let i = 0; i < list.length;) {
      const c = list[i];
      if (!chunks.has(c.key) || c.rev === c.meshedRev) { list[i] = list[list.length - 1]; list.pop(); continue; }
      if (c.meshPending) { i++; continue; }
      if (dispatchMesh(c, maxLoad)) { list[i] = list[list.length - 1]; list.pop(); } else i++;
    }
  }

  function schedule() {
    drainList(urgent, 6);
    drainList(soon, 3);
    if (!planDirty) return;
    let blocked = false;
    const r2 = (radius + 0.5) * (radius + 0.5);
    for (let k = 0; k < spiral.length; k++) {
      const o = spiral[k];
      const c = getOrCreate(pcx + o[0], pcz + o[1]);
      if (!c.vox) {
        if (!c.genPending) {
          const s = freeWorker(2);
          if (!s) { blocked = true; break; }
          c.genPending = true; s.load++; stats.pending++;
          s.w.postMessage({ t: 'gen', epoch, cx: c.cx, cz: c.cz });
        } else blocked = true;
        continue;
      }
      if (o[2] <= r2 && c.rev !== c.meshedRev) {
        if (c.meshPending) { blocked = true; continue; }
        if (!freeWorker(2)) { blocked = true; break; }
        if (!dispatchMesh(c, 2)) blocked = true;
      }
    }
    if (!blocked) planDirty = false;
  }

  function unloadFar() {
    const lim = (radius + 4) * (radius + 4);
    for (const c of chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > lim && !c.genPending && !c.meshPending) {
        disposeMeshes(c);
        chunks.delete(c.key);
        stats.chunks--;
      }
    }
    lastChunk = null;
  }

  function applyMesh(c, r) {
    if (!chunks.has(c.key)) return;
    disposeMeshes(c);
    const h = Math.max(1, r.maxY - r.minY);
    for (let i = 0; i < r.parts.length; i++) {
      const p = r.parts[i];
      if (!p) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('aPos', new THREE.BufferAttribute(p.pos, 4));
      g.setAttribute('aDat', new THREE.BufferAttribute(p.dat, 4));
      if(p.normal)g.setAttribute('aSlopeNormal',new THREE.BufferAttribute(p.normal,3));
      if(p.uv)g.setAttribute('aUv',new THREE.BufferAttribute(p.uv,4));                // blocos do Minecraft (parte 4)
      const quads = p.n >> 2;
      if (quads <= SHARED_QUADS) g.setIndex(sharedIndex);
      else {
        const idx = new Uint32Array(quads * 6);
        for (let q = 0, k = 0; q < quads; q++) {
          const b = q * 4;
          idx[k++] = b; idx[k++] = b + 1; idx[k++] = b + 2; idx[k++] = b; idx[k++] = b + 2; idx[k++] = b + 3;
        }
        g.setIndex(new THREE.BufferAttribute(idx, 1));
      }
      g.setDrawRange(0, quads * 6);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, (r.minY + r.maxY) / 2, 8), Math.sqrt(128 + h * h / 4) + 1);
      // parte 5 (mesher.js): opaco abaixo de y 0, posição Int16 — mesmo material e mesma sombra da parte 0
      const opaco = i === 0 || i === 5;
      const mesh = new THREE.Mesh(g, opaco ? materials.opaque : i === 1 ? materials.cutout : i === 2 ? materials.water : i === 4 ? materials.mc : materials.slope);
      mesh.position.set(c.cx * CW, 0, c.cz * CW);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      if (i === 2) mesh.renderOrder = 2;
      else if (materials.depthOpaque) { mesh.castShadow = true; mesh.customDepthMaterial = opaco ? materials.depthOpaque : i === 3 ? materials.depthSlope : i === 4 ? materials.depthMc : materials.depthCutout; }
      group.add(mesh);
      c.meshes[i] = mesh;
      c.quads += quads;
    }
    stats.quads += c.quads;
    c.hasMesh = true; stats.meshed++;
    c.models = r.models;
    c.plants = r.plants || null;   // shared/plantas.js (corpos 3D das plantas, render/plantas3d.js)
    c.lawn = r.lawn || null;       // shared/relva.js (células de gramado à mostra, render/relva.js)
    c.canopy = r.canopy || null;   // shared/relva.js (folhagem por coluna: chão de folha seca debaixo das copas)
    c.lightField = r.lightField;
    c.lightBase = Number.isFinite(r.lightBase) ? r.lightBase : 0;   // y do mundo da primeira camada de lightField
    c.surfaceShapes = r.surfaceShapes;
    if (listeners.surface) listeners.surface(c.cx,c.cz);
    if (listeners.models) listeners.models(c, r.models);
  }

  // Chamar a cada quadro com a posição do jogador.
  function update(px, pz) {
    if (epoch === 0) return; // ainda sem semente: os workers nem foram iniciados
    const cx = Math.floor(px / CW), cz = Math.floor(pz / CW);
    if (cx !== pcx || cz !== pcz) {
      pcx = cx; pcz = cz; planDirty = true;
      unloadFar();
    }
    schedule();
    const uploadStart=performance.now();
    for (let n = 0; n < quality.uploadsPerFrame && applyQueue.length; n++) {
      const c = applyQueue.shift(), r = applyQueue.shift();
      applyMesh(c, r);
      // Terreno, folhagem, árvore e colisão são substituídos juntos. Se uma
      // aplicação custou caro, a próxima espera o próximo quadro.
      if(performance.now()-uploadStart>=5)break;
    }
  }

  // ---- acesso a blocos ---------------------------------------------------------
  let lastChunk = null;
  function chunkAt(cx, cz) {
    if (lastChunk && lastChunk.cx === cx && lastChunk.cz === cz) return lastChunk;
    const c = chunks.get(ckey(cx, cz));
    if (c) lastChunk = c;
    return c;
  }
  // -1 = chunk ainda não carregado. Abaixo do fundo do plano: rocha-mãe; acima do topo: ar.
  function getBlock(x, y, z) {
    if (y < fundo) return B.BEDROCK;
    if (y >= Y_TOP) return B.AIR;
    const c = chunkAt(x >> 4, z >> 4);
    if (!c || !c.vox) return -1;
    return c.vox[(x & 15) + ((z & 15) << 4) + ((y - Y_MIN) << 8)];
  }
  function isEdited(x,y,z){const k=ckey(x>>4,z>>4),i=(x&15)+((z&15)<<4)+(y<<8);return (edits.get(k)?.has(i)||false)&&minis.get(k)?.get(i)!==MOLDE;}
  function getMini(x,y,z){return y<fundo||y>=Y_TOP?0:(minis.get(ckey(x>>4,z>>4))?.get((x&15)+((z&15)<<4)+(y<<8))||0);}
  function getShape(x,y,z){return surfaceShape(getBlock,isEdited,x,y,z);}
  getBlock.mini=getMini;
  getBlock.shape=getShape;
  getBlock.fundo=fundo;   // leis (shared/laws.js) e água leem o fundo do plano por aqui
  // Copia para `out` os blocos da caixa que começa em (x0, y0, z0) e mede sx × sy × sz. Ordem de uma textura 3D:
  // x corre mais rápido, depois y, depois z (índice = ix + iy·sx + iz·sx·sy). Pedaço de mundo ainda não carregado sai
  // como ar. Devolve quantas colunas ficaram sem dado. Serve a quem precisa do mundo em bloco (campo de voxels da luz).
  function readRegion(x0, y0, z0, sx, sy, sz, out) {
    let missing = 0;
    for (let iz = 0; iz < sz; iz++) {
      const z = z0 + iz;
      for (let ix = 0; ix < sx; ix++) {
        const x = x0 + ix, c = chunkAt(x >> 4, z >> 4), base = ix + iz * sx * sy;
        if (!c || !c.vox) { missing++; for (let iy = 0; iy < sy; iy++) out[base + iy * sx] = 0; continue; }
        const col = (x & 15) + ((z & 15) << 4);
        for (let iy = 0; iy < sy; iy++) { const y = y0 + iy; out[base + iy * sx] = y < fundo ? B.BEDROCK : y >= Y_TOP ? 0 : c.vox[col + ((y - Y_MIN) << 8)]; }
      }
    }
    return missing;
  }

  function isLoaded(x, z) {
    const c = chunkAt(Math.floor(x) >> 4, Math.floor(z) >> 4);
    return !!(c && c.vox);
  }

  // RG8: índice da forma em dois bytes. O worker já resolveu proteção e quinas;
  // copiar só sua lista esparsa evita recalcular rampas no laço de renderização.
  function readSurfaceRegion(x0,y0,z0,sx,sy,sz,out) {
    out.fill(0);for(let i=0;i<out.length;i+=2)out[i]=15;
    for(let cz=z0>>4;cz<=(z0+sz-1)>>4;cz++)for(let cx=x0>>4;cx<=(x0+sx-1)>>4;cx++){
      const list=chunkAt(cx,cz)?.surfaceShapes;if(!list)continue;
      for(let n=0;n<list.length;n+=2){
        const index=list[n],shape=list[n+1],x=cx*16+(index&15)-x0,y=(index>>8)+Y_MIN-y0,z=cz*16+((index>>4)&15)-z0;   // a lista vem com índice de armazenamento
        if(x<0||x>=sx||y<0||y>=sy||z<0||z>=sz)continue;
        const i=2*(x+y*sx+z*sx*sy);out[i]=shape&255;out[i+1]=shape>>8;
      }
    }
  }

  function recordEdit(key, i, id) {
    let ed = edits.get(key);
    if (!ed) { ed = new Map(); edits.set(key, ed); }
    ed.set(i, id);
  }
  function recordMini(key, i, mini) {
    let mp = minis.get(key);
    if (mini) {
      if (!mp) { mp = new Map(); minis.set(key, mp); }
      mp.set(i, mini);
    } else if (mp) {
      mp.delete(i);
      if (!mp.size) minis.delete(key);
    }
  }

  // Aplica uma edição (local ou vinda da rede). Devolve o bloco anterior, ou -1 se o chunk não está carregado.
  function setBlock(x, y, z, id, mini = 0) {
    if (y < fundo + 1 || y >= Y_TOP) return -1;   // a rocha-mãe do fundo nunca se edita (y ≥ 1 fora do plano de cima)
    const cx = x >> 4, cz = z >> 4, key = ckey(cx, cz);
    const i = (x & 15) + ((z & 15) << 4) + (y << 8);
    const m = keepState(mini, id);
    const wasEdited=edits.get(key)?.has(i)||false;
    const prevMini = minis.get(key)?.get(i) || 0;
    recordEdit(key, i, id);
    recordMini(key, i, m);
    const c = chunks.get(key);
    if (!c || !c.vox) return -1;
    const prev = c.vox[i + YOFF];
    if (prev === id && prevMini === m && wasEdited) return prev;
    c.vox[i + YOFF] = id;
    if (listeners.block) listeners.block(x, y, z, id);
    if (id && y > c.maxY) c.maxY = y;
    if (y < c.minY) c.minY = y;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = dx === 0 && dz === 0 ? c : chunks.get(ckey(cx + dx, cz + dz));
      if (!n) continue;
      n.rev++;
      if (n.meshedRev < 0 && !n.meshPending) continue; // ainda nem foi malhado: o plano normal cuida
      const lx = x & 15, lz = z & 15;
      const near = (dx === 0 || (dx < 0 ? lx === 0 : lx === 15)) && (dz === 0 || (dz < 0 ? lz === 0 : lz === 15));
      (near ? urgent : soon).push(n);
    }
    return prev;
  }

  // Carrega em lote as edições vindas do servidor: { "cx,cz": [índice, bloco, ...] }
  function loadEdits(obj) {
    for (const k in obj) {
      const [cx, cz] = k.split(',').map(Number);
      const arr = obj[k];
      const key = ckey(cx, cz);
      for (let j = 0; j < arr.length; j += 2) recordEdit(key, arr[j], arr[j + 1]);
      const c = chunks.get(key);
      if (c && c.vox) {
        for (let j = 0; j < arr.length; j += 2) {
          const y = arr[j] >> 8;
          c.vox[arr[j] + YOFF] = arr[j + 1];
          if (arr[j + 1] && y > c.maxY) c.maxY = y;
          if (y < c.minY) c.minY = y;
        }
        if (listeners.chunk) listeners.chunk(cx, cz);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const n = chunks.get(ckey(cx + dx, cz + dz));
          if (n) n.rev++;
        }
      }
    }
    planDirty = true;
  }

  function exportEdits() {
    const out = {};
    for (const [key, ed] of edits) {
      const arr = [];
      for (const [i, id] of ed) arr.push(i, id);
      const cx = Math.floor(key / 65536) - 32768, cz = (key % 65536) - 32768;
      out[cx + ',' + cz] = arr;
    }
    return out;
  }

  function loadMinis(obj) {
    for (const k in obj) {
      const [cx, cz] = k.split(',').map(Number);
      const arr = obj[k];
      const key = ckey(cx, cz);
      for (let j = 0; j < arr.length; j += 2) recordMini(key, arr[j], arr[j + 1]);
      const c = chunks.get(key);
      if (c && c.vox) {
        if (listeners.chunk) listeners.chunk(cx, cz);
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          const n = chunks.get(ckey(cx + dx, cz + dz));
          if (n) n.rev++;
        }
      }
    }
    planDirty = true;
  }

  function exportMinis() {
    const out = {};
    for (const [key, mp] of minis) {
      if (!mp.size) continue;
      const arr = [];
      for (const [i, m] of mp) arr.push(i, m);
      const cx = Math.floor(key / 65536) - 32768, cz = (key % 65536) - 32768;
      out[cx + ',' + cz] = arr;
    }
    return out;
  }

  // Altura do primeiro bloco não-vazio da coluna (para nascer, sondar luz etc.). Procura do topo até y 0, como sempre:
  // o subsolo novo abaixo de 0 não é "superfície", e −1 continua querendo dizer "nada" (ou pedaço não carregado).
  function topSolid(x, z, fromY = Y_TOP - 1) {
    const c = chunkAt(x >> 4, z >> 4);
    if (!c || !c.vox) return -1;
    const base = (x & 15) + ((z & 15) << 4);
    for (let y = Math.min(fromY, c.maxY); y >= 0; y--) {
      const k = KIND[c.vox[base + ((y - Y_MIN) << 8)]];
      if (k !== K_AIR) return y;
    }
    return -1;
  }

  function progress() {
    // fração dos chunks do raio de visão que já têm malha
    const want = spiral.reduce((n, o) => n + (o[2] <= (radius + 0.5) * (radius + 0.5) ? 1 : 0), 0);
    return Math.min(1, stats.meshed / Math.max(1, want));
  }

  function getLight(x,y,z){
    x=Math.floor(x);y=Math.floor(y);z=Math.floor(z);
    if(y<fundo)return 0;
    const c=chunkAt(x>>4,z>>4);
    if(!c?.lightField)return 15;
    const ly=y-c.lightBase;            // abaixo da base do campo de luz o pedaço é rocha fechada: escuro
    return ly<0?0:c.lightField[(ly<<8)+((z&15)<<4)+(x&15)]??15;
  }

  return {
    group, chunks, edits, minis, stats, listeners,
    setMcPilha(p) { mcPilha = p; }, mcPilha: () => mcPilha,
    reset, definirFerrovia, update, setDistance, getBlock, getMini, getLight, getShape, isEdited, setBlock, readRegion, readSurfaceRegion, isLoaded, loadEdits, exportEdits, loadMinis, exportMinis, topSolid,
    requestTextures, progress,
    get seed() { return seed; }, get dim() { return dim; }, get radius() { return radius; }, get fundo() { return fundo; },
  };
}
