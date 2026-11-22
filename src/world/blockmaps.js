// LAVRA — materiais de arquivo dos blocos: cor, normal, rugosidade, altura e oclusão que vêm de imagens de verdade
// (hoje: arenito, pedra e tábuas, do Poly Haven, preparados no Blender; ver arte/blocos/LEIAME.md e PARA-ASTRA.md).
//
// Esta parte é só o carregamento e os dados. tools/blocos.py grava em public/assets/blocos uma faixa PNG por camada e
// por tamanho de textura:   [ cor | superfície (normal x, normal y, rugosidade) | relevo (altura, oclusão) ]
// Aqui as faixas substituem, nas matrizes já pintadas pelo gerador (render/texgen.js), só as camadas que têm arquivo; o
// resto fica como está. É a mesma regra dos sons gravados: tem arquivo, usa; não tem, vale o que o código pinta. Sem
// manifesto, sem rede ou com demora, loadBlockMaps devolve null e o jogo segue igual a antes.
//
// O que fica pronto para quem desenha (main.js faz a ligação):
//   - U.uTex e U.uSurf já chegam com as camadas trocadas: nenhum shader precisa mudar para a cor, a normal e a
//     rugosidade novas aparecerem;
//   - U.uRel  = sampler2DArray, 2 bytes por texel, mesmas camadas e mesmo tamanho de uTex:
//               r = altura (1 = topo da face; 0 = uRelInfo.z metros abaixo dele) · g = oclusão (1 = aberto, 0 = fresta);
//               camada sem arquivo vale 1, 1 (sem profundidade, sem sombra de fresta);
//   - U.uRelInfo = vec4: x = 1 quando há relevo de arquivo (0 = não consultar uRel) · y = alcance sugerido para o relevo
//               de perto, em metros · z = profundidade máxima que o mapa representa, em metros (0,125);
//   - game.blockMaps = nomes das camadas que vieram de arquivo.
// O DESENHO do relevo (paralaxe, sombra dentro da fresta, o que mais couber) é de quem cuida dos shaders. No ramo
// exp/blocos-pbr há uma amostra em render/materials.js (bloco RELIEF), só para a prova: pode ser trocada inteira.
// Na URL: &blocos=0 volta às texturas pintadas e &relevo=0 põe uRelInfo.x em 0 (para comparar).

import * as THREE from '../three.js';

const BASE = 'assets/blocos';

function wait(ms) { return new Promise((resolve) => setTimeout(() => resolve(null), ms)); }

async function fetchStrip(url, size) {
  const r = await fetch(url);
  if (!r.ok) return null;
  // sem pré-multiplicar e sem conversão de cor: dois terços da faixa são dados, não imagem
  const bmp = await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  if (bmp.width !== size * 3 || bmp.height !== size) return null;
  const cv = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(size * 3, size)
    : Object.assign(document.createElement('canvas'), { width: size * 3, height: size });
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  return cx.getImageData(0, 0, size * 3, size).data;
}

// size: lado da textura do perfil; names: nomes das camadas na ordem de blocks.js.
// Devolve { manifest, strips: [{ name, layer, px }] } ou null.
export function loadBlockMaps(size, names, { timeoutMs = 8000 } = {}) {
  const job = (async () => {
    try {
      const r = await fetch(`${BASE}/manifesto.json`, { cache: 'no-cache' });
      if (!r.ok) return null;
      const manifest = await r.json();
      if (!manifest || !manifest.camadas || !(manifest.tamanhos || []).includes(size)) return null;
      const strips = await Promise.all(names.map(async (name, layer) => {
        if (!manifest.camadas[name]) return null;
        try {
          const px = await fetchStrip(`${BASE}/${size}/${name}.png?v=${manifest.v}`, size);
          return px ? { name, layer, px } : null;
        } catch { return null; }
      }));
      return { manifest, strips: strips.filter(Boolean) };
    } catch { return null; }
  })();
  return Promise.race([job, wait(timeoutMs)]);
}

// Escreve as faixas nas matrizes do gerador: albedo (RGBA por camada) e surf (normal x, normal y, rugosidade, metal;
// pode ser null no perfil sem relevo). Devolve a matriz de relevo, 2 bytes por texel (altura, oclusão).
export function applyBlockMaps(maps, size, layers, albedo, surf) {
  const relief = new Uint8Array(size * size * 2 * layers).fill(255);
  const row = size * 3 * 4;
  for (const s of maps.strips) {
    const base = s.layer * size * size;
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * row;        // a imagem vem de pé; no jogo a coordenada v cresce para cima
      for (let x = 0; x < size; x++) {
        const t = base + y * size + x, o = t * 4;
        const a = src + x * 4, b = a + size * 4, c = b + size * 4;
        albedo[o] = s.px[a]; albedo[o + 1] = s.px[a + 1]; albedo[o + 2] = s.px[a + 2];
        albedo[o + 3] = 255;                   // opaco e sem luz própria (nas camadas sem tinta, alfa < 1 é emissão)
        if (surf) { surf[o] = s.px[b]; surf[o + 1] = s.px[b + 1]; surf[o + 2] = s.px[b + 2]; }   // o metal fica o da tabela
        relief[t * 2] = s.px[c]; relief[t * 2 + 1] = s.px[c + 1];
      }
    }
  }
  return relief;
}

// A matriz de relevo como textura (dados, sem sRGB), no mesmo molde das outras matrizes de camadas.
export function makeReliefArray(data, size, layers) {
  const t = new THREE.DataArrayTexture(data, size, size, layers);
  t.format = THREE.RGFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
