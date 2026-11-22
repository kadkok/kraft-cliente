// LAVRA — HUD Náutico: Minimapa Circular Batimétrico & Régua de Profundidade / Sonda (Sonar)
// Licença MIT · Adaptado de dgreenheck/tidewater (src/game/Minimap.js, src/game/GameHUD.js, src/ui/UI.js).

import { B, BLOCKS, KIND, K_CROSS, LEVEL } from '../../shared/blocks.js';
import { SEA, DIM_MACRO, EYE_H } from '../../shared/constants.js';
import { BIOME, MACRO_SEA } from '../../shared/worldgen.js';

const N = 256;                 // resolução do canvas batimétrico circular (px)
const EXT = 384;               // metros cobertos pela janela batimétrica (N / EXT = px por metro)
const PPM = N / EXT;
const RECENTER_DIST = 68;      // recentra o bake quando o jogador se afasta do centro (m)
const MAX_BAKE_MS = 2.8;       // orçamento máximo por quadro para o bake incremental (≤ 4 ms/frame)
const CARDEAIS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];

const ICON = {
  fish: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 12c3-4 7-6 11-6 3 0 5 2 7 4l-2 2 2 2c-2 2-4 4-7 4-4 0-8-2-11-6Zm12-1.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/></svg>',
  anchor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="5" r="2"/><path d="M12 7v13M7 11h10M4 14c1 4 4 6 8 6s7-2 8-6"/></svg>',
  boat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v9H6l6-9Zm1 2 5 7h-5V5ZM3 14h18l-3 5H6l-3-5Z"/></svg>',
  spawn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9L12 2.5Z"/></svg>',
  campo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1"><circle cx="12" cy="12" r="9"/><polygon points="12,7.5 15.5,10 14.2,14.2 9.8,14.2 8.5,10" fill="currentColor"/></svg>',
  vila: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4 3 11h2v9h5v-6h4v6h5v-9h2L12 4Z"/></svg>',
};

// Paleta batimétrica e costeira do Tidewater (sRGB 0..255)
const C = {
  abyss: [7, 26, 52],
  deep: [12, 44, 78],
  mid: [22, 104, 150],
  shallow: [62, 186, 190],
  foam: [186, 232, 226],
  grassSea: [34, 110, 108],
  rubble: [30, 84, 104],
  sand: [232, 216, 172],
  wet: [206, 190, 150],
  grass: [128, 160, 88],
  scrub: [88, 128, 64],
  forest: [52, 92, 50],
  taiga: [52, 96, 84],
  savanna: [164, 158, 78],
  desert: [222, 196, 132],
  snow: [236, 240, 246],
  ice: [170, 208, 236],
  rock: [132, 134, 126],
  path: [205, 182, 136],
  scarp: [176, 146, 104],
  pad: [196, 184, 162],
  wood: [178, 140, 92],
  roof: [180, 88, 64],
};

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (e0, e1, x) => {
  const t = sat((x - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

// Ruído determinístico leve para manchas de alga/recife no fundo do mar
function hash2(x, z) {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) ^ 0x5bd1e995;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function garantirCssNautico() {
  if (typeof document === 'undefined' || !document.head) return null;
  let link = document.getElementById('lavra-nautico-css') || document.querySelector('link[href*="nautico.css"]');
  if (!link) {
    link = document.createElement('link');
    link.id = 'lavra-nautico-css';
    link.rel = 'stylesheet';
    link.href = 'css/nautico.css';
    document.head.appendChild(link);
  }
  return link;
}

function intersecta(a, b, pad = 6) {
  if (!a || !b || b.width <= 0 || b.height <= 0) return false;
  return (
    a.left - pad < b.right &&
    a.right + pad > b.left &&
    a.top - pad < b.bottom &&
    a.bottom + pad > b.top
  );
}

/**
 * Inicializa o Minimapa Circular Rotativo, a Régua de Profundidade (Depth Sounder) e o Sonar Náutico estilo Tidewater.
 * @param {object} opts
 * @param {object} opts.game
 * @param {object} opts.world
 * @param {object} opts.player
 * @param {object} [opts.avatars]
 * @param {function} [opts.getWind]
 * @param {function} [opts.getSeaInfo]
 */
export function initHudNautico({ game, world, player, avatars, getWind, getSeaInfo } = {}) {
  garantirCssNautico();

  const host =
    document.getElementById('hud') ||
    document.getElementById('ui') ||
    document.body;

  const root = h('div', 'tw-nautico-root');
  host.appendChild(root);

  // ── 1. Minimapa Circular Rotativo (.gm-map.tw-glass) ──────────────────────
  const mapEl = h(
    'div',
    'gm-map tw-glass',
    `<div class="gm-map-view">` +
      `<canvas width="${N}" height="${N}"></canvas>` +
      `<div class="gm-map-vig"></div>` +
      `<div class="gm-map-marks"></div>` +
      `<div class="gm-map-me"><svg viewBox="0 0 24 24"><path d="M12 2 20 21 12 16.5 4 21Z" fill="#fff" stroke="#0b1418" stroke-width="1.4" stroke-linejoin="round"/></svg></div>` +
    `</div>` +
    `<div class="gm-map-label">000° N · 0, 0</div>`,
  );
  mapEl.setAttribute('aria-label', 'Minimapa náutico');
  const mapView = mapEl.querySelector('.gm-map-view');
  const mapCanvas = mapEl.querySelector('canvas');
  const mapMarks = mapEl.querySelector('.gm-map-marks');
  const mapLabel = mapEl.querySelector('.gm-map-label');

  const northEl = h('div', 'gm-map-n', 'N');
  mapMarks.appendChild(northEl);

  const fishEls = [
    h('div', 'gm-map-fish', '<i></i><i></i>'),
    h('div', 'gm-map-fish', '<i></i><i></i>'),
  ];
  fishEls.forEach((f) => mapMarks.prepend(f));

  // ── 2. Régua de Profundidade & Sonda Náutica (.tw-depth.tw-glass) ─────────
  const depthEl = h(
    'div',
    'tw-depth tw-glass is-on',
    `<div class="tw-depth-ruler-wrap">` +
      `<canvas class="tw-depth-tape"></canvas>` +
      `<span class="tw-depth-mark"></span>` +
      `<div class="tw-water-col" title="Posição na coluna d'água">` +
        `<span class="tw-water-col-surf"></span>` +
        `<span class="tw-water-col-floor"></span>` +
        `<span class="tw-water-col-player"></span>` +
      `</div>` +
    `</div>` +
    `<div class="tw-depth-read">` +
      `<div class="tw-depth-head">` +
        `<div class="tw-depth-line"><span class="tw-depth-num">0.0</span><span class="tw-unit">m</span></div>` +
        `<button type="button" class="tw-nautico-toggle" title="Recolher / Expandir Sonda Náutica" aria-label="Alternar Sonda Náutica">−</button>` +
      `</div>` +
      `<div class="tw-depth-exact">Profundidade: 0.0 m</div>` +
      `<div class="tw-depth-zone" data-zone="Praia">Praia</div>` +
      `<div class="tw-depth-details">` +
        `<div class="tw-depth-col-info">` +
          `<div class="tw-depth-col-row"><span class="tw-col-lbl-a">Sup:</span><b class="tw-col-val-a">0.0 m</b></div>` +
          `<div class="tw-depth-col-row"><span class="tw-col-lbl-b">Fundo:</span><b class="tw-col-val-b">0.0 m</b></div>` +
        `</div>` +
        `<div class="tw-depth-alert">⚠️ Pressão elevada</div>` +
        `<div class="tw-depth-wind"><span>Vento</span><b class="tw-wind-val">8.5 m/s · Brisa</b></div>` +
        `<div class="gm-sonar"><span>Sonar</span><b class="gm-sonar-d">0.0 m</b><span class="gm-sonar-dots">●○○○</span></div>` +
      `</div>` +
    `</div>`,
  );

  const depthCanvas = depthEl.querySelector('.tw-depth-tape');
  const depthNum = depthEl.querySelector('.tw-depth-num');
  const depthExact = depthEl.querySelector('.tw-depth-exact');
  const depthZone = depthEl.querySelector('.tw-depth-zone');
  const colPlayer = depthEl.querySelector('.tw-water-col-player');
  const colFloor = depthEl.querySelector('.tw-water-col-floor');
  const colLblA = depthEl.querySelector('.tw-col-lbl-a');
  const colValA = depthEl.querySelector('.tw-col-val-a');
  const colLblB = depthEl.querySelector('.tw-col-lbl-b');
  const colValB = depthEl.querySelector('.tw-col-val-b');
  const alertEl = depthEl.querySelector('.tw-depth-alert');
  const windVal = depthEl.querySelector('.tw-wind-val');
  const sonarD = depthEl.querySelector('.gm-sonar-d');
  const sonarDots = depthEl.querySelector('.gm-sonar-dots');
  const toggleBtn = depthEl.querySelector('.tw-nautico-toggle');

  root.append(mapEl, depthEl);

  // Estado interno
  let visivelForcado = true;
  let recolhidoManual = false;
  let lastFrameId = -1;
  let viewSize = -1;
  let radiusM = 110;
  let fishTimer = 0;
  let fishPts = [];
  let sonarTimer = 0;
  let layoutTimer = 0;
  let depthDrawn = null;
  let surfDrawn = null;
  let customMarkers = [];
  const markerDom = new Map();
  const colCache = new Map();

  const bake = {
    x0: -EXT / 2,
    z0: -EXT / 2,
    cx: 0,
    cz: 0,
    row: 0,
    done: false,
    neverPainted: true,
    seed: -1,
    dim: -1,
    ctx: mapCanvas.getContext('2d'),
    img: null,
    h: new Float32Array(N * N),
    rgb: new Uint8ClampedArray(N * N * 3),
  };
  bake.img = bake.ctx.createImageData(N, N);

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      viewSize = mapView.clientWidth;
      layoutTimer = 0;
      depthDrawn = null;
    });
    ro.observe(mapView);
  }

  // Botão discreto para recolher/expandir a régua de profundidade sem perder foco do canvas
  toggleBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    recolhidoManual = !recolhidoManual;
    depthEl.classList.toggle('is-collapsed', recolhidoManual);
    toggleBtn.textContent = recolhidoManual ? '+' : '−';
    depthDrawn = null;
  });

  function setStyle(el, prop, val) {
    const k = '__tw_' + prop;
    if (el[k] === val) return;
    el[k] = val;
    if (prop.startsWith('--')) el.style.setProperty(prop, val);
    else el.style[prop] = val;
  }

  function setToggle(el, cls, on) {
    const k = '__tw_c_' + cls;
    if (el[k] === on) return;
    el[k] = on;
    el.classList.toggle(cls, on);
  }

  function seaLevel() {
    return game?.dim === DIM_MACRO ? MACRO_SEA : SEA;
  }

  // ── Amostragem de coluna (terreno carregado + gerador determinístico) ──────
  function sampleColumn(wx, wz) {
    const bx = Math.floor(wx), bz = Math.floor(wz);
    const key = ((bx + 65536) << 16) ^ ((bz + 65536) & 0xffff);
    const cached = colCache.get(key);
    if (cached && cached.bx === bx && cached.bz === bz) return cached;

    const seaY = seaLevel();
    const gen = game?.gen;
    const hRel = gen?.heightRel ? gen.heightRel(wx, wz) : (gen?.height ? gen.height(wx, wz) - seaY : 0);
    const biome = gen?.biomeAt ? gen.biomeAt(bx, bz) : BIOME.PLAINS;

    let hgt = hRel;
    let floorId = B.SAND;
    let topId = B.GRASS;
    let isWater = hgt < 0;
    let reef = 0;
    let seagrass = 0;
    let structure = 0;

    if (world?.isLoaded?.(bx, bz)) {
      let y = world.topSolid(bx, bz);
      if (y >= 0) {
        let id = world.getBlock(bx, y, bz);
        if (KIND[id] === K_CROSS && y > 1) {
          y--;
          id = world.getBlock(bx, y, bz);
        }
        if (LEVEL[id] > 0) {
          isWater = true;
          let f = y;
          while (f > 1 && LEVEL[world.getBlock(bx, f, bz)] > 0) f--;
          floorId = world.getBlock(bx, f, bz);
          const voxDepth = Math.max(0.35, y - f);
          const genDepth = hRel < 0 ? -hRel : voxDepth;
          // Combina a profundidade real dos blocos com a fração contínua do gerador para batimetria suave
          const dep = Math.abs(voxDepth - genDepth) < 2.2 ? (voxDepth * 0.45 + genDepth * 0.55) : voxDepth;
          hgt = -dep;
        } else {
          isWater = false;
          topId = id;
          const voxAlt = y - seaY;
          hgt = Math.abs(voxAlt - hRel) < 2.2 ? Math.max(0.05, voxAlt * 0.55 + hRel * 0.45) : Math.max(0.05, voxAlt);
          if (BLOCKS[id]?.group === 'obra' || id === B.PLANKS || id === B.PINE_PLANKS || id === B.STONE_BRICKS || id === B.BRICKS || id === B.ROOF) {
            structure = 1;
          }
        }
      }
    }

    if (isWater) {
      const dep = -hgt;
      const n1 = hash2(bx >> 2, bz >> 2);
      const n2 = hash2((bx + 17) >> 3, (bz - 31) >> 3);
      if (floorId === B.GRAVEL || floorId === B.STONE || floorId === B.BASALT || (dep > 1.8 && dep < 14 && n2 > 0.62)) {
        reef = sat(0.45 + n1 * 0.55);
      }
      if (dep > 0.8 && dep < 9.5 && (floorId === B.SAND || floorId === B.CLAY || floorId === B.DIRT) && n1 > 0.44) {
        seagrass = sat((n1 - 0.44) * 1.7);
      }
    }

    // Cor base antes do relevo sombreado
    let c;
    if (isWater) {
      const dep = Math.max(0.1, -hgt);
      c = dep < 5.5
        ? mix(C.shallow, C.mid, smooth(0.25, 5.5, dep))
        : dep < 22
          ? mix(C.mid, C.deep, smooth(5.5, 22, dep))
          : mix(C.deep, C.abyss, smooth(22, 42, dep));
      if (seagrass > 0) c = mix(c, C.grassSea, seagrass * 0.52);
      if (reef > 0) c = mix(c, C.rubble, reef * 0.58);
      c = mix(c, C.foam, smooth(0.65, 0.0, dep) * 0.46);
    } else if (structure) {
      c = topId === B.ROOF || topId === B.BRICKS ? C.roof : (topId === B.PLANKS || topId === B.PINE_PLANKS ? C.wood : C.pad);
    } else if (topId === B.SNOW || biome === BIOME.SNOW) {
      c = C.snow;
    } else if (topId === B.ICE) {
      c = C.ice;
    } else {
      const isSand = topId === B.SAND || topId === B.SANDSTONE || biome === BIOME.BEACH || biome === BIOME.DESERT;
      const isRock = topId === B.STONE || topId === B.GRAVEL || topId === B.BASALT || biome === BIOME.ALPINE;
      c = biome === BIOME.DESERT
        ? C.desert
        : biome === BIOME.SAVANNA
          ? C.savanna
          : biome === BIOME.TAIGA
            ? C.taiga
            : mix(C.grass, C.scrub, smooth(4, 16, hgt));
      if (biome === BIOME.FOREST || topId === B.LEAVES || topId === B.PINE_LEAVES) {
        c = mix(c, C.forest, 0.65);
      } else {
        c = mix(c, C.forest, smooth(12, 36, hgt));
      }
      const sandWeight = isSand ? (biome === BIOME.DESERT ? 0.92 : Math.max(0.78, smooth(2.6, 0.4, hgt))) : smooth(1.8, 0.35, hgt);
      c = mix(c, C.sand, sandWeight);
      c = mix(c, C.wet, smooth(0.65, 0.0, hgt) * 0.62);
      if (isRock) c = mix(c, C.rock, 0.78);
    }

    const res = { bx, bz, hgt, isWater, floorId, topId, reef, seagrass, r: c[0], g: c[1], b: c[2] };
    if (colCache.size > 24000) colCache.clear();
    colCache.set(key, res);
    return res;
  }

  // ── Bake incremental do canvas batimétrico (≤ 4 ms/frame) ─────────────────
  function resetBake(cx, cz) {
    bake.cx = Math.round(cx);
    bake.cz = Math.round(cz);
    bake.x0 = bake.cx - EXT / 2;
    bake.z0 = bake.cz - EXT / 2;
    bake.row = 0;
    bake.done = false;
    bake.seed = game?.seed ?? 0;
    bake.dim = game?.dim ?? 0;
  }

  function paintRowRange(r0, r1) {
    for (let py = r0; py < r1; py++) {
      const wz = bake.z0 + (py + 0.5) / PPM;
      const rowOff = py * N;
      for (let px = 0; px < N; px++) {
        const wx = bake.x0 + (px + 0.5) / PPM;
        const s = sampleColumn(wx, wz);
        const i = rowOff + px;
        bake.h[i] = s.hgt;
        const o3 = i * 3;
        bake.rgb[o3] = s.r;
        bake.rgb[o3 + 1] = s.g;
        bake.rgb[o3 + 2] = s.b;
      }
    }
  }

  function finalizeBakeImage() {
    const d = bake.img.data;
    const hArr = bake.h;
    const rgb = bake.rgb;
    const stepM = 1 / PPM;

    for (let py = 0; py < N; py++) {
      const y0 = Math.max(0, py - 1), y1 = Math.min(N - 1, py + 1);
      for (let px = 0; px < N; px++) {
        const i = py * N + px;
        const hgt = hArr[i];
        const o3 = i * 3;
        let r = rgb[o3], g = rgb[o3 + 1], b = rgb[o3 + 2];

        const x0 = Math.max(0, px - 1), x1 = Math.min(N - 1, px + 1);
        const gx = (hArr[py * N + x1] - hArr[py * N + x0]) / (2 * stepM);
        const gz = (hArr[y1 * N + px] - hArr[y0 * N + px]) / (2 * stepM);

        if (hgt >= 0) {
          // Relevo sombreado com luz vinda do noroeste (estilo Tidewater)
          const nl = (-gx * -0.6 + -gz * -0.6 + 0.53) / Math.sqrt(gx * gx + gz * gz + 1);
          const s = 0.72 + 0.44 * sat(nl / 0.53);
          r *= s; g *= s; b *= s;

          // Linha costeira clara e nítida onde a terra encontra o mar
          if (
            py > 0 && py < N - 1 && px > 0 && px < N - 1 &&
            (hArr[i - 1] < 0 || hArr[i + 1] < 0 || hArr[i - N] < 0 || hArr[i + N] < 0)
          ) {
            r = r * 0.28 + 245 * 0.72;
            g = g * 0.28 + 241 * 0.72;
            b = b * 0.28 + 228 * 0.72;
          }
        } else {
          // Sutil sombreamento de talude submarino + contornos batimétricos suaves
          const slope = (-gx * -0.45 + -gz * -0.45) * 0.08;
          const s = Math.max(0.82, Math.min(1.14, 1 + slope));
          r *= s; g *= s; b *= s;
        }

        const o4 = i * 4;
        d[o4] = r;
        d[o4 + 1] = g;
        d[o4 + 2] = b;
        d[o4 + 3] = 255;
      }
    }
    bake.ctx.putImageData(bake.img, 0, 0);
    bake.done = true;
    bake.neverPainted = false;
  }

  function bakeStep(px, pz) {
    if (!game?.ready) return;
    if (
      bake.seed !== game.seed ||
      bake.dim !== game.dim ||
      Math.hypot(px - bake.cx, pz - bake.cz) > RECENTER_DIST
    ) {
      resetBake(px, pz);
    }
    if (bake.done) return;

    // No primeiro quadro em que o mundo está pronto, gera uma prévia rápida para nunca exibir canvas vazio
    if (bake.neverPainted) {
      const step = 2;
      for (let py = 0; py < N; py += step) {
        const wz = bake.z0 + (py + 0.5) / PPM;
        for (let px0 = 0; px0 < N; px0 += step) {
          const wx = bake.x0 + (px0 + 0.5) / PPM;
          const s = sampleColumn(wx, wz);
          for (let dy = 0; dy < step && py + dy < N; dy++) {
            for (let dx = 0; dx < step && px0 + dx < N; dx++) {
              const idx = (py + dy) * N + (px0 + dx);
              bake.h[idx] = s.hgt;
              const o3 = idx * 3;
              bake.rgb[o3] = s.r;
              bake.rgb[o3 + 1] = s.g;
              bake.rgb[o3 + 2] = s.b;
            }
          }
        }
      }
      finalizeBakeImage();
      bake.done = false;
      bake.row = 0;
      return;
    }

    const t0 = performance.now();
    while (bake.row < N && performance.now() - t0 < MAX_BAKE_MS) {
      const next = Math.min(N, bake.row + 16);
      paintRowRange(bake.row, next);
      bake.row = next;
    }
    if (bake.row >= N) finalizeBakeImage();
  }

  // Quando o jogador constrói ou quebra um bloco, atualiza a célula no minimapa
  if (game?.hooks?.edit) {
    game.hooks.edit.push((bx, _by, bz) => {
      const key = ((Math.floor(bx) + 65536) << 16) ^ ((Math.floor(bz) + 65536) & 0xffff);
      colCache.delete(key);
      const py = Math.floor((bz - bake.z0) * PPM);
      if (py >= 0 && py < N) {
        paintRowRange(Math.max(0, py - 1), Math.min(N, py + 2));
        finalizeBakeImage();
      }
    });
  }

  // ── Marcadores do Minimapa ────────────────────────────────────────────────
  function ensureMarkerDom(id, kind, iconHtml, color, hot) {
    let m = markerDom.get(id);
    if (!m) {
      const el = h('div', `gm-mk is-${kind}`, `<b></b><i>${iconHtml}</i>`);
      mapMarks.appendChild(el);
      m = { el, arrow: el.firstChild, iconEl: el.lastChild, kind, iconHtml };
      markerDom.set(id, m);
    }
    if (m.kind !== kind) {
      m.el.className = `gm-mk is-${kind}`;
      m.kind = kind;
    }
    if (m.iconHtml !== iconHtml) {
      m.iconEl.innerHTML = iconHtml;
      m.iconHtml = iconHtml;
    }
    if (color) setStyle(m.el, '--mk-color', color);
    setToggle(m.el, 'is-hot', !!hot);
    return m;
  }

  function gatherMarkers(px, pz) {
    const list = [];
    if (game?.spawn) {
      list.push({
        id: 'spawn',
        kind: 'spawn',
        x: game.spawn.x,
        z: game.spawn.z,
        icon: ICON.spawn,
      });
    }
    const campo = game?.futebol?.campo;
    if (campo && Array.isArray(campo.centro)) {
      list.push({
        id: 'campo',
        kind: 'campo',
        x: campo.centro[0],
        z: campo.centro[2],
        icon: ICON.campo,
      });
    }
    if (avatars?.list && game?.players) {
      for (const [id, av] of avatars.list) {
        const snap = av.snaps?.[av.snaps.length - 1];
        const info = game.players.get(id);
        if (!snap || !info) continue;
        const inicial = String(info.name || 'J').trim().charAt(0).toUpperCase() || 'J';
        list.push({
          id: 'pl:' + id,
          kind: 'player',
          x: snap.x,
          z: snap.z,
          icon: inicial,
          color: info.color || '#e8873a',
        });
      }
    }
    const povos = game?.mapa?.povos;
    if (Array.isArray(povos) && povos.length) {
      let best = null, bestD = 1e9;
      for (const p of povos) {
        const d = Math.hypot(p[2] - px, p[3] - pz);
        if (d < bestD) { bestD = d; best = p; }
      }
      if (best) {
        list.push({
          id: 'povo:' + best[1],
          kind: 'vila',
          x: best[2],
          z: best[3],
          icon: ICON.vila,
        });
      }
    }
    for (const cm of customMarkers) {
      if (!cm) continue;
      if (typeof cm.hideWhen === 'function' && cm.hideWhen()) continue;
      const pos = typeof cm.pos === 'function' ? cm.pos() : (cm.x != null && cm.z != null ? { x: cm.x, z: cm.z } : null);
      if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) continue;
      const kind = cm.kind || cm.tipo || 'boat';
      const iconHtml =
        cm.icon && ICON[cm.icon]
          ? ICON[cm.icon]
          : cm.icon || ICON[kind] || (kind === 'pier' ? ICON.anchor : kind === 'vila' ? ICON.vila : ICON.boat);
      list.push({
        id: 'custom:' + (cm.id || kind),
        kind,
        x: pos.x,
        z: pos.z,
        icon: iconHtml,
        color: cm.color || null,
        hot: !!cm.hot,
      });
    }
    const costaMarkers = game?.costa?.marcadores?.();
    if (Array.isArray(costaMarkers)) {
      for (const cm of costaMarkers) {
        if (!cm || !Number.isFinite(cm.x) || !Number.isFinite(cm.z)) continue;
        const kind = cm.kind || 'boat';
        const id = 'costa:' + (cm.id || kind);
        if (list.some((m) => m.id === id || m.id === 'custom:' + cm.id)) continue;
        list.push({
          id,
          kind,
          x: cm.x,
          z: cm.z,
          icon: kind === 'vila' ? ICON.anchor : ICON.boat,
          color: cm.color || null,
          hot: !!cm.hot,
        });
      }
    }
    return list;
  }

  // ── Sonar & Cardumes (dois pontos mais ricos em fauna aquática ao redor) ──
  function habitatScoreAt(wx, wz) {
    const s = sampleColumn(wx, wz);
    if (!s.isWater) return { depth: 0, rich: 0, s };
    const depth = Math.max(0, -s.hgt);
    if (depth < 0.8) return { depth, rich: 0.1, s };
    const shallows = smooth(3.5, 1.0, depth) * 0.45;
    const reef = s.reef * smooth(0.8, 2.5, depth) * 0.95;
    const seagrass = s.seagrass * 0.65;
    const bay = smooth(1.8, 5.0, depth) * (1 - smooth(18, 30, depth)) * 0.72;
    const deep = smooth(14, 26, depth) * 0.6;
    const rich = shallows + reef + seagrass + bay + deep;
    return { depth, rich, s };
  }

  function findRichestWater(x, z, r) {
    const pts = [];
    for (let ring = 1; ring <= 3; ring++) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2 + ring * 0.4;
        const d = (r * ring) / 3;
        const px = x + Math.cos(ang) * d;
        const pz = z + Math.sin(ang) * d;
        const { depth, rich } = habitatScoreAt(px, pz);
        if (depth >= 1.2 && rich > 0.62) pts.push({ x: px, z: pz, rich });
      }
    }
    pts.sort((a, b) => b.rich - a.rich);
    const out = [];
    for (const q of pts) {
      if (out.every((o) => Math.hypot(o.x - q.x, o.z - q.z) > 24)) {
        out.push(q);
        if (out.length === 2) break;
      }
    }
    return out;
  }

  // ── Desenho da fita graduada da Régua de Profundidade (Tidewater UI.js) ───
  function drawDepthTape(depthM, subM) {
    const w = depthCanvas.clientWidth, hh = depthCanvas.clientHeight;
    if (!w || !hh) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * dpr), H = Math.round(hh * dpr);
    if (depthCanvas.width !== W || depthCanvas.height !== H) {
      depthCanvas.width = W;
      depthCanvas.height = H;
    }
    const g = depthCanvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);

    const span = 14;
    const ppm = hh / span;
    const cy = hh / 2;
    const fade = (y, p = 1.6) => Math.pow(1 - Math.min(1, Math.abs(y - cy) / cy), p);

    g.font = `500 ${Math.max(8, hh / 20).toFixed(1)}px "JetBrains Mono", ui-monospace, monospace`;
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.lineWidth = 1;

    const d0 = Math.max(0, Math.floor(depthM - span / 2));
    const d1 = Math.ceil(depthM + span / 2);
    for (let d = d0; d <= d1; d += 0.5) {
      const y = Math.round(cy + (d - depthM) * ppm) + 0.5;
      const a = fade(y);
      if (a <= 0.01) continue;
      const whole = d % 1 === 0;
      const major = d % 5 === 0;
      const len = major ? w * 0.42 : whole ? w * 0.23 : w * 0.12;
      g.strokeStyle = `rgba(190, 238, 244, ${((major ? 0.92 : whole ? 0.52 : 0.28) * a).toFixed(3)})`;
      g.beginPath();
      g.moveTo(w - len, y);
      g.lineTo(w, y);
      g.stroke();
      if (major) {
        g.fillStyle = `rgba(222, 246, 250, ${(0.88 * a).toFixed(3)})`;
        g.fillText(String(d), w - len - 3, y);
      }
    }

    // Linha ondulada da superfície do mar (0.0 m)
    const ys = cy - depthM * ppm;
    if (ys >= -4 && ys <= hh + 4) {
      g.strokeStyle = `rgba(95, 227, 212, ${(0.95 * fade(ys, 1.2)).toFixed(3)})`;
      g.lineWidth = 1.6;
      g.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const y = ys + Math.sin(x * 0.45) * 1.4;
        if (x) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
    }

    // Indicador da profundidade do jogador na fita quando submerso
    if (subM > 0.05) {
      const yp = Math.max(4, Math.min(hh - 4, cy + (subM - depthM) * ppm));
      g.fillStyle = 'rgba(255, 184, 107, 0.92)';
      g.beginPath();
      g.arc(6, yp, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }

  // ── Prevenção de sobreposição com elementos do HUD (Desktop & Mobile) ─────
  function adjustSafeLayout() {
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const hotbar = host.querySelector?.('.hotbar') || document.querySelector('.hotbar');
    const futSkills = document.getElementById('fut-skills');
    const corner = host.querySelector?.('.corner') || document.querySelector('.corner');
    const debugEl = host.querySelector?.('.debug:not(.hide)') || document.querySelector('.debug:not(.hide)');
    const chatbox = host.querySelector?.('.chatbox:not(.hide)') || document.querySelector('.chatbox:not(.hide)');
    const touchBtns = host.querySelectorAll ? [...host.querySelectorAll('.tbtn')] : [];

    // 1) Posição vertical segura do Minimapa Circular (.gm-map)
    let mapBottom = 16;
    const mapSize = vw <= 640 ? 118 : vw <= 920 ? 144 : 176;
    const mapRight = vw <= 640 ? 8 : 16;
    const mapLeftEdge = vw - mapRight - mapSize;

    for (const bar of [hotbar, futSkills]) {
      if (!bar) continue;
      const r = bar.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > mapLeftEdge - 10) {
        mapBottom = Math.max(mapBottom, Math.round(vh - r.top + 10));
      }
    }
    for (const tb of touchBtns) {
      const r = tb.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > mapLeftEdge - 10 && r.top > vh * 0.35) {
        mapBottom = Math.max(mapBottom, Math.round(vh - r.top + 10));
      }
    }
    if (corner) {
      const rc = corner.getBoundingClientRect();
      if (rc.height > 0 && vh - mapBottom - mapSize < rc.bottom + 8) {
        mapBottom = Math.max(12, Math.round(vh - rc.bottom - mapSize - 8));
      }
    }
    setStyle(root, '--tw-map-bottom', `${mapBottom}px`);
    setStyle(root, '--tw-map-right', `${mapRight}px`);

    // 2) Posição vertical segura da Régua de Profundidade (.tw-depth)
    const depthH = depthEl.offsetHeight || (vw <= 640 ? 148 : 220);
    let minTop = 58;
    let maxBottom = vh - 86;
    if (debugEl) {
      const rd = debugEl.getBoundingClientRect();
      if (rd.width > 0 && rd.height > 0) minTop = Math.max(minTop, Math.round(rd.bottom + 10));
    }
    if (chatbox) {
      const rch = chatbox.getBoundingClientRect();
      if (rch.width > 0 && rch.height > 0) maxBottom = Math.min(maxBottom, Math.round(rch.top - 10));
    }
    const idealCenter = Math.round(vh * (vw <= 640 ? 0.38 : 0.46));
    const clampedCenter = Math.max(
      Math.round(minTop + depthH / 2),
      Math.min(Math.round(Math.max(minTop + depthH / 2, maxBottom - depthH / 2)), idealCenter),
    );
    setStyle(root, '--tw-depth-top', `${clampedCenter}px`);
  }

  // ── Classificação da zona marítima e leitura da coluna d'água ─────────────
  function classifyMaritimeZone(waterDepth, distCoast, s, subDepth) {
    if (waterDepth <= 0.05) {
      return distCoast <= 18 || s.topId === B.SAND ? 'Praia' : 'Praia';
    }
    if (waterDepth < 1.35) return 'Praia';
    if (s.reef > 0.35 && waterDepth >= 1.4 && waterDepth <= 13.5) return 'Recife';
    if (waterDepth < 4.8) return 'Raso';
    if (waterDepth < 16.0) return 'Baía';
    return 'Águas Profundas';
  }

  function updateDepthAndSonar(dt, px, py, pz, placeInfo) {
    const seaY = seaLevel();
    const s = sampleColumn(px, pz);
    const waterSurfaceY = seaY + 0.88;
    const eyeY = py + EYE_H;

    // Profundidade total da lâmina d'água neste ponto (0 se em terra firme)
    const waterDepth = s.isWater ? Math.max(0, -s.hgt) : 0;
    // Profundidade de submersão do jogador (distância abaixo da superfície)
    const subDepth = s.isWater || player?.inWater || placeInfo?.underwater
      ? Math.max(0, waterSurfaceY - (player?.headInWater ? eyeY : py + 0.9))
      : 0;
    // Distância do jogador até o fundo do mar
    const floorY = s.isWater ? seaY - waterDepth : seaY + s.hgt;
    const distToFloor = Math.max(0, py - floorY);

    // Proximidade do mar (mesmo quando na areia da praia)
    let nearSeaWaterDepth = waterDepth;
    let distCoast = s.isWater ? 0 : 999;
    if (!s.isWater) {
      for (const r of [6, 14, 26, 42]) {
        for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r * 0.7, r * 0.7], [-r * 0.7, -r * 0.7]]) {
          const ns = sampleColumn(px + dx, pz + dz);
          if (ns.isWater) {
            const d = Math.hypot(dx, dz);
            if (d < distCoast) {
              distCoast = d;
              nearSeaWaterDepth = Math.max(nearSeaWaterDepth, -ns.hgt);
            }
          }
        }
        if (distCoast < 999) break;
      }
    }

    const effectiveDepth = s.isWater ? waterDepth : (distCoast <= 32 ? nearSeaWaterDepth : 0);
    const zona = classifyMaritimeZone(waterDepth, distCoast, s, subDepth);

    // A régua aparece ao entrar na água (pedido do Kadmus, 19/11, como no Tidewater) e some 1,5 s depois de sair;
    // pilotando máquina sobre o mar ela também fica (barco).
    const naAgua = !!(player?.inWater || player?.headInWater || placeInfo?.underwater || (game?.pilotando && s.isWater));
    if (naAgua) reguaAte = performance.now() + 1500;
    setToggle(depthEl, 'is-on', performance.now() < reguaAte);

    const depthStr = effectiveDepth.toFixed(1);
    if (depthNum.textContent !== depthStr) depthNum.textContent = depthStr;
    const exactStr = `Profundidade: ${depthStr} m`;
    if (depthExact.textContent !== exactStr) depthExact.textContent = exactStr;

    if (depthZone.textContent !== zona) {
      depthZone.textContent = zona;
      depthZone.dataset.zone = zona;
    }

    // Posição do jogador na coluna d'água
    const inOrOverWater = s.isWater || player?.inWater || placeInfo?.underwater;
    if (inOrOverWater) {
      colLblA.textContent = 'Sup:';
      colValA.textContent = `${subDepth.toFixed(1)} m`;
      colLblB.textContent = 'Fundo:';
      colValB.textContent = `${distToFloor.toFixed(1)} m`;
      const ratio = waterDepth > 0.2 ? sat(subDepth / waterDepth) : 0;
      setStyle(colPlayer, 'top', `${(6 + ratio * 80).toFixed(1)}%`);
      const floorPct = Math.round(10 + (1 - sat(waterDepth / 36)) * 18);
      setStyle(colFloor, 'height', `${floorPct}%`);
    } else {
      const altMar = Math.max(0, py - seaY);
      colLblA.textContent = 'Alt. mar:';
      colValA.textContent = `+${altMar.toFixed(1)} m`;
      colLblB.textContent = 'Costa:';
      colValB.textContent = distCoast < 900 ? `${Math.round(distCoast)} m` : 'terra';
      setStyle(colPlayer, 'top', '6%');
      setStyle(colFloor, 'height', '14%');
    }

    // Alerta visual de profundidade (mergulho profundo ou baixio raso)
    let alertText = '';
    if (subDepth >= 8.0) {
      alertText = `⚠️ Mergulho profundo (${subDepth.toFixed(1)} m)`;
    } else if (inOrOverWater && waterDepth > 0.4 && waterDepth < 1.6 && s.reef > 0.3) {
      alertText = '⚠️ Recife raso';
    }
    const hasAlert = alertText.length > 0;
    setToggle(depthEl, 'is-alert', hasAlert);
    if (hasAlert && alertEl.textContent !== alertText) alertEl.textContent = alertText;

    // Vento e estado do mar (U.uWind)
    const wVec = (typeof getWind === 'function' ? getWind() : null) || window.LAVRA?.U?.uWind?.value;
    let windStrength = wVec && Number.isFinite(wVec.z) ? wVec.z : 0.85;
    if (game?.weather?.wind && Array.isArray(game.weather.wind)) {
      windStrength = Math.max(windStrength, Math.hypot(game.weather.wind[0], game.weather.wind[1]) / 10);
    }
    const windSpeedMs = Math.max(0.5, windStrength * 10);
    const wx = wVec && Number.isFinite(wVec.x) ? wVec.x : 0.83;
    const wz = wVec && Number.isFinite(wVec.y) ? wVec.y : 0.55;
    const windDeg = ((Math.atan2(wx, -wz) * 180) / Math.PI + 360) % 360;
    const windCard = CARDEAIS[Math.round(windDeg / 45) % 8];
    const seaState =
      windSpeedMs < 3.8 ? 'Calmo' : windSpeedMs < 9.5 ? 'Brisa' : windSpeedMs < 15.5 ? 'Agitado' : 'Ressaca';
    const windTxt = `${windSpeedMs.toFixed(1)} m/s ${windCard} · ${seaState}`;
    if (windVal.textContent !== windTxt) windVal.textContent = windTxt;

    // Sonar (fauna aquática / profundidade)
    sonarTimer -= dt;
    if (sonarTimer <= 0) {
      sonarTimer = 0.35;
      const { rich } = habitatScoreAt(px, pz);
      const nearRich = s.isWater ? rich : (distCoast <= 28 ? 0.55 : 0.15);
      const dotsCount = Math.max(0, Math.min(4, Math.round(sat(nearRich / 1.35) * 4)));
      const dotsStr = '●'.repeat(dotsCount) + '○'.repeat(4 - dotsCount);
      if (sonarDots.textContent !== dotsStr) sonarDots.textContent = dotsStr;
      const sDepthStr = `${effectiveDepth.toFixed(1)} m`;
      if (sonarD.textContent !== sDepthStr) sonarD.textContent = sDepthStr;
    }

    // Redesenha a fita graduada quando a profundidade muda
    if (
      !recolhidoManual &&
      (depthDrawn === null ||
        Math.abs(effectiveDepth - depthDrawn) > 0.02 ||
        Math.abs(subDepth - (surfDrawn ?? 0)) > 0.04)
    ) {
      depthDrawn = effectiveDepth;
      surfDrawn = subDepth;
      drawDepthTape(effectiveDepth, subDepth);
    }

    return { isNearSea: s.isWater || distCoast <= 64 || (placeInfo?.seaWater || 0) > 0.05 };
  }

  // ── Atualização por quadro ────────────────────────────────────────────────
  function update(dt = 0.016, yawArg, placeArg) {
    if (game?.frames != null) {
      if (game.frames === lastFrameId) return;
      lastFrameId = game.frames;
    }

    const ov = game?.overlay;
    const hideForOverlay = ov === 'mapa' || ov === 'palette' || ov === 'editor';
    const emFutebol = game?.espacoAtivo?.tipo === 'futebol';
    const mapaAberto = !!game?.mapa?.aberto;
    const emVR = !!game?.xr?.presenting;
    const playing = !game || game.state === 'PLAYING';
    const show = visivelForcado && playing && !hideForOverlay && !emFutebol && !mapaAberto && !emVR;

    setToggle(root, 'is-hidden', !show);
    if (!show) return;

    const px = player?.pos ? player.pos[0] : 0;
    const py = player?.pos ? player.pos[1] : SEA;
    const pz = player?.pos ? player.pos[2] : 0;
    const yaw = Number.isFinite(yawArg) ? yawArg : (player?.yaw || 0);
    const placeInfo = placeArg || (typeof getSeaInfo === 'function' ? getSeaInfo() : null);

    layoutTimer -= dt;
    if (layoutTimer <= 0) {
      layoutTimer = 0.4;
      adjustSafeLayout();
    }

    // 1) Atualiza bake incremental do minimapa
    bakeStep(px, pz);

    // 2) Atualiza régua de profundidade & sonda
    const { isNearSea } = updateDepthAndSonar(dt, px, py, pz, placeInfo);

    // 3) Transformação rotativa do Minimapa Circular (Tidewater Minimap.js)
    if (viewSize <= 0 || !ro) viewSize = mapView.clientWidth || 166;
    const size = viewSize;
    if (!size) return;
    const R = size / 2;

    // Vetor para frente (fx, fz) e para a direita (rx, rz) no plano XZ do LAVRA (yaw 0 = -Z norte)
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = -fz;
    const rz = fx;

    const inWater = !!(player?.inWater || placeInfo?.underwater);
    const wantRadius = inWater ? 155 : 105;
    radiusM += (wantRadius - radiusM) * (1 - Math.exp(-Math.max(0.001, dt) * 1.8));
    const kpm = R / radiusM;

    const rot = -Math.PI / 2 - Math.atan2(fz, fx);
    const scale = kpm / PPM;
    setStyle(
      mapCanvas,
      'transform',
      `translate(${R.toFixed(1)}px, ${R.toFixed(1)}px) rotate(${rot.toFixed(4)}rad) scale(${scale.toFixed(4)}) translate(${(-(px - bake.x0) * PPM).toFixed(2)}px, ${(-(pz - bake.z0) * PPM).toFixed(2)}px)`,
    );

    const placeOnRim = (el, dx, dz, edgeInset, arrow) => {
      let sx = (dx * rx + dz * rz) * kpm;
      let sy = -(dx * fx + dz * fz) * kpm;
      const r = Math.hypot(sx, sy);
      const max = R - edgeInset;
      const edge = r > max;
      if (edge && r > 1e-4) {
        sx *= max / r;
        sy *= max / r;
      }
      setStyle(el, 'transform', `translate(${(R + sx).toFixed(1)}px, ${(R + sy).toFixed(1)}px)`);
      if (arrow && edge) {
        setStyle(arrow, 'transform', `rotate(${Math.atan2(sx, -sy).toFixed(3)}rad)`);
      }
      return edge;
    };

    // Posiciona o N na borda do minimapa
    placeOnRim(northEl, 0, -1e6, 9);

    // Posiciona os marcadores (spawn, campo, jogadores, povoados e customizados da Fase 2)
    const activeMarkers = gatherMarkers(px, pz);
    const seenIds = new Set();
    for (const m of activeMarkers) {
      seenIds.add(m.id);
      const dom = ensureMarkerDom(m.id, m.kind, m.icon, m.color, m.hot);
      setStyle(dom.el, 'display', '');
      const edge = placeOnRim(dom.el, m.x - px, m.z - pz, 12, dom.arrow);
      setToggle(dom.el, 'is-edge', edge);
    }
    for (const [id, dom] of markerDom) {
      if (!seenIds.has(id)) {
        dom.el.remove();
        markerDom.delete(id);
      }
    }

    // Anéis suaves de sonar/cardume (.gm-map-fish) quando no mar ou próximo à costa
    fishTimer -= dt;
    if (isNearSea && fishTimer <= 0) {
      fishTimer = 1.5;
      fishPts = findRichestWater(px, pz, radiusM * 0.82);
    } else if (!isNearSea) {
      fishPts = [];
    }
    for (let i = 0; i < fishEls.length; i++) {
      const q = isNearSea ? fishPts[i] : null;
      setToggle(fishEls[i], 'is-on', !!q);
      if (q) placeOnRim(fishEls[i], q.x - px, q.z - pz, 14);
    }

    // Rótulo inferior discreto de rumo e coordenadas
    const hdg = Math.round(((-yaw * 180) / Math.PI + 360) % 360) % 360;
    const card = CARDEAIS[Math.round(hdg / 45) % 8];
    const lblTxt = `${String(hdg).padStart(3, '0')}° ${card} · ${Math.round(px)}, ${Math.round(pz)}`;
    if (mapLabel.textContent !== lblTxt) mapLabel.textContent = lblTxt;
  }

  let reguaAte = 0;   // até quando a régua de profundidade fica na tela (ms)
  function setMarcadores(list = []) {
    customMarkers = Array.isArray(list) ? list.slice() : [];
  }

  function setVisivel(on) {
    visivelForcado = !!on;
    setToggle(root, 'is-hidden', !visivelForcado);
  }

  function dispose() {
    if (ro) ro.disconnect();
    markerDom.clear();
    colCache.clear();
    root.remove();
  }

  const api = {
    update,
    setMarcadores,
    setVisivel,
    dispose,
    el: { root, mapEl, depthEl, mapCanvas, depthCanvas },
  };

  if (game) {
    game.hudNautico = api;
    if (Array.isArray(game.hooks?.frame)) {
      game.hooks.frame.push((dt) => update(dt, player?.yaw, typeof getSeaInfo === 'function' ? getSeaInfo() : null));
    }
    if (Array.isArray(game.hooks?.other)) {
      game.hooks.other.push((m) => {
        if (m && (m.t === 'welcome' || m.t === 'dim' || m.t === 'offline')) {
          colCache.clear();
          bake.neverPainted = true;
          resetBake(player?.pos?.[0] || 0, player?.pos?.[2] || 0);
        }
      });
    }
  }

  return api;
}
