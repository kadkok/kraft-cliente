// LAVRA — ícones dos blocos desenhados a partir das mesmas texturas procedurais do jogo.

import {
  TEX, KIND, FUNC, TEX_INDEX, TINT_B0, TINT_C0, TINT_D0, B, IS_STAIR,
  K_CROSS, K_MODEL, K_LIQUID, F_WHEEL, F_WING, F_PROPELLER, F_CANNON, F_SEAT, F_BALLOON,
} from '../../shared/blocks.js';

const GRASS = [0.44, 0.7, 0.27], LEAF = [0.3, 0.62, 0.2];

export function createIcons(data, S) {
  const layers = new Map(), icons = new Map(), avgs = new Map();
  const firstCut = TEX_INDEX.glass;

  // Canvas 2D de uma camada, já com a tinta padrão e o alpha resolvido.
  function layerCanvas(layer) {
    let c = layers.get(layer);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const cut = (layer >= firstCut && layer < TINT_B0) || layer === TEX_INDEX.tall_grass || layer === TEX_INDEX.fern || layer >= TINT_D0;
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const s = (layer * S * S + (S - 1 - y) * S + x) * 4, d = (y * S + x) * 4;
        let r = data[s], g = data[s + 1], b = data[s + 2], a = data[s + 3];
        if (layer >= TINT_D0) { r *= LEAF[0]; g *= LEAF[1]; b *= LEAF[2]; }
        else if (layer >= TINT_C0) { r *= GRASS[0]; g *= GRASS[1]; b *= GRASS[2]; }
        else if (layer >= TINT_B0) { const m = 1 - a / 255; r *= 1 + (GRASS[0] - 1) * m; g *= 1 + (GRASS[1] - 1) * m; b *= 1 + (GRASS[2] - 1) * m; }
        if (!cut) a = 255;
        img.data[d] = r; img.data[d + 1] = g; img.data[d + 2] = b; img.data[d + 3] = a;
        if (a > 127) { sr += r; sg += g; sb += b; n++; }
      }
    }
    ctx.putImageData(img, 0, 0);
    avgs.set(layer, n ? [sr / n / 255, sg / n / 255, sb / n / 255] : [0.5, 0.5, 0.5]);
    layers.set(layer, c);
    return c;
  }

  function avgColor(blockId) {
    if (blockId === B.WATER) return [0.2, 0.45, 0.6];
    const layer = TEX[blockId * 6 + 2];
    layerCanvas(layer);
    return avgs.get(layer);
  }

  function cube(ctx, n, top, left, right) {
    const k = n / 64;
    const face = (tex, a, b, c, d, e, f, shade, path) => {
      ctx.save();
      ctx.setTransform(a * k / S, b * k / S, c * k / S, d * k / S, e * k, f * k);
      ctx.drawImage(tex, 0, 0);
      ctx.restore();
      if (shade > 0) {
        ctx.beginPath();
        path.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
        ctx.closePath();
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    };
    face(top, 28, 14, -28, 14, 32, 3, 0, null);
    face(left, 28, 14, 0, 30, 4, 17, 0.2, [[4, 17], [32, 31], [32, 61], [4, 47]]);
    face(right, 28, -14, 0, 30, 32, 31, 0.42, [[32, 31], [60, 17], [60, 47], [32, 61]]);
  }

  function stairIcon(ctx, n, top, left, right) {
    const k = n / 64;
    const drawPoly = (tex, a, b, c, d, e, f, shade, pts) => {
      ctx.save();
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
      ctx.closePath();
      ctx.clip();
      ctx.save();
      ctx.setTransform(a * k / S, b * k / S, c * k / S, d * k / S, e * k, f * k);
      ctx.drawImage(tex, 0, 0);
      ctx.restore();
      if (shade > 0) {
        ctx.fillStyle = `rgba(0,0,0,${shade})`;
        ctx.fillRect(0, 0, n, n);
      }
      ctx.restore();
    };
    drawPoly(top, 28, 14, -28, 14, 32, 3, 0, [[32, 3], [60, 17], [46, 24], [18, 10]]);
    drawPoly(left, 28, 14, 0, 30, 18, 10, 0.2, [[18, 10], [46, 24], [46, 39], [18, 25]]);
    drawPoly(top, 28, 14, -28, 14, 32, 18, 0.04, [[18, 25], [46, 39], [32, 46], [4, 32]]);
    drawPoly(left, 28, 14, 0, 30, 4, 17, 0.22, [[4, 32], [32, 46], [32, 61], [4, 47]]);
    drawPoly(right, 28, -14, 0, 30, 32, 31, 0.42, [[32, 46], [46, 39], [46, 24], [60, 17], [60, 47], [32, 61]]);
  }

  // Ícone de um bloco (canvas quadrado).
  function icon(blockId, n = 64) {
    const key = blockId + ':' + n;
    let c = icons.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = n;
    const ctx = c.getContext('2d');
    const k = n / 64;
    const kind = KIND[blockId];
    if (kind === K_LIQUID) {
      const g = ctx.createLinearGradient(0, 0, n, n);
      g.addColorStop(0, '#5fb7d6'); g.addColorStop(1, '#1d5f8a');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(32 * k, 5 * k); ctx.bezierCurveTo(54 * k, 30 * k, 52 * k, 58 * k, 32 * k, 58 * k);
      ctx.bezierCurveTo(12 * k, 58 * k, 10 * k, 30 * k, 32 * k, 5 * k); ctx.fill();
    } else if (kind === K_CROSS) {
      ctx.drawImage(layerCanvas(TEX[blockId * 6]), 4 * k, 4 * k, 56 * k, 56 * k);
    } else if (kind === K_MODEL) {
      const tex = layerCanvas(TEX[blockId * 6]);
      const pat = ctx.createPattern(tex, 'repeat');
      const fn = FUNC[blockId];
      ctx.fillStyle = pat; ctx.strokeStyle = pat;
      if (fn === F_WHEEL) {
        ctx.beginPath(); ctx.arc(32 * k, 32 * k, 26 * k, 0, 7); ctx.fill();
        ctx.drawImage(layerCanvas(TEX_INDEX.hubcap), 14 * k, 14 * k, 36 * k, 36 * k);
      } else if (fn === F_WING) {
        ctx.beginPath(); ctx.moveTo(6 * k, 38 * k); ctx.lineTo(40 * k, 18 * k); ctx.lineTo(60 * k, 24 * k); ctx.lineTo(26 * k, 46 * k); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(6 * k, 38 * k, 2, 2);
      } else if (fn === F_PROPELLER) {
        const bl = ctx.createPattern(layerCanvas(TEX_INDEX.blade), 'repeat');
        ctx.fillStyle = bl;
        for (let i = 0; i < 3; i++) {
          ctx.save(); ctx.translate(32 * k, 32 * k); ctx.rotate(i * 2.094 + 0.4);
          ctx.beginPath(); ctx.ellipse(0, -15 * k, 5.5 * k, 15 * k, 0, 0, 7); ctx.fill(); ctx.restore();
        }
        ctx.fillStyle = pat; ctx.beginPath(); ctx.arc(32 * k, 32 * k, 7 * k, 0, 7); ctx.fill();
      } else if (fn === F_CANNON) {
        ctx.save(); ctx.translate(32 * k, 34 * k); ctx.rotate(-0.5);
        ctx.fillRect(-10 * k, -7 * k, 38 * k, 14 * k); ctx.restore();
        ctx.beginPath(); ctx.arc(22 * k, 42 * k, 13 * k, 0, 7); ctx.fill();
      } else if (fn === F_SEAT) {
        ctx.fillRect(16 * k, 34 * k, 34 * k, 12 * k); ctx.fillRect(14 * k, 10 * k, 10 * k, 36 * k);
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(18 * k, 46 * k, 4 * k, 12 * k); ctx.fillRect(44 * k, 46 * k, 4 * k, 12 * k);
      } else if (fn === F_BALLOON) {
        ctx.beginPath(); ctx.arc(32 * k, 28 * k, 22 * k, 0, 7); ctx.fill();
        ctx.fillStyle = 'rgba(40,30,20,0.9)'; ctx.fillRect(27 * k, 52 * k, 10 * k, 7 * k);
      } else ctx.fillRect(8 * k, 8 * k, 48 * k, 48 * k);
    } else if (IS_STAIR[blockId]) {
      stairIcon(ctx, n, layerCanvas(TEX[blockId * 6 + 2]), layerCanvas(TEX[blockId * 6 + 5]), layerCanvas(TEX[blockId * 6]));
    } else {
      cube(ctx, n, layerCanvas(TEX[blockId * 6 + 2]), layerCanvas(TEX[blockId * 6 + 5]), layerCanvas(TEX[blockId * 6]));
    }
    icons.set(key, c);
    return c;
  }

  return { icon, avgColor, layerCanvas };
}
