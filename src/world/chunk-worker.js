// LAVRA — worker de chunks: gera terreno, calcula luz e malha, e pinta as texturas.
// Sem estado de mundo: cada pedido traz o que precisa. Dá para ter vários em paralelo.

import { createWorldGen } from '../../shared/worldgen.js';
import { createMesher, transferList } from './mesher.js';
import { generateTextures, generateSurface } from '../render/texgen.js';
import { mcCarregar } from './mc-malha.js';

let gen = null;
let mesher = null;
let mcPilha = 'realista';     // pacote dos blocos do Minecraft (vem no init)

self.onmessage = (e) => {
  const m = e.data;
  switch (m.t) {
    case 'init':
      gen = createWorldGen(m.seed, m.dim | 0, m.opt || null);
      if (m.mcPilha) mcPilha = m.mcPilha;
      mesher = createMesher(gen);
      self.postMessage({ t: 'ready', epoch: m.epoch });
      break;
    case 'gen': {
      const r = gen.generate(m.cx, m.cz);
      self.postMessage({ t: 'gen', epoch: m.epoch, cx: m.cx, cz: m.cz, vox: r.vox, maxY: r.maxY, minY: r.minY }, [r.vox.buffer]);   // maxY/minY em y do mundo
      break;
    }
    case 'mesh': mcCarregar(mcPilha).then(() => {   // blocos do Minecraft: os modelos chegam uma vez por worker, antes da primeira malha
      const t0 = performance.now();
      const r = mesher.mesh(m.cx, m.cz, m.chunks, m.maxYs, m.protectedCells, m.miniCells, m.minYs);
      r.t = 'mesh'; r.epoch = m.epoch; r.cx = m.cx; r.cz = m.cz; r.rev = m.rev;
      r.ms = performance.now() - t0;
      self.postMessage(r, transferList(r));
    }); break;
    case 'tex': {
      const data = generateTextures(m.size, m.names);
      const surf = m.surface ? generateSurface(m.size, m.names, data) : null;
      self.postMessage({ t: 'tex', size: m.size, data, surf }, surf ? [data.buffer, surf.buffer] : [data.buffer]);
      break;
    }
  }
};
