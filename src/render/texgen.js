// LAVRA — texturas procedurais dos blocos. Código puro (roda no worker).
// Cada função recebe (u, v) em [0,1) com v para CIMA e escreve cor sRGB 0..1 em o[0..3].
// Alpha: nos opacos, 1 - alpha = brilho próprio; em grass_side, 1 - alpha = máscara de tinta;
// nas texturas de recorte, alpha = cobertura.
// Areia de coral, ondulações e grãos adaptados de dgreenheck/tidewater (MIT License).
import {preparedTexture, preparedSurface} from './terrain-art.js';
import {GLASS_TEXTURES} from '../../shared/blocks.js';
import {GLASS_STYLES} from './glass-styles.js';

function h2(ix, iy, seed) {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// ruído de valor periódico (px, py células por volta)
function vn(x, y, px, py, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const x0 = ((ix % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((iy % py) + py) % py, y1 = (y0 + 1) % py;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = h2(x0, y0, seed), b = h2(x1, y0, seed), c = h2(x0, y1, seed), d = h2(x1, y1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(u, v, fx, fy, oct, seed) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * vn(u * fx, v * fy, fx, fy, seed + i * 101);
    n += a; fx *= 2; fy *= 2; a *= 0.5;
  }
  return s / n;
}
let wd1 = 0, wd2 = 0, wid = 0;
function worley(u, v, nx, ny, seed) {
  const x = u * nx, y = v * ny;
  const ix = Math.floor(x), iy = Math.floor(y);
  wd1 = 9; wd2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const wx = ((cx % nx) + nx) % nx, wy = ((cy % ny) + ny) % ny;
      const px = cx + 0.15 + 0.7 * h2(wx, wy, seed), py = cy + 0.15 + 0.7 * h2(wx, wy, seed + 7);
      const d = Math.hypot(x - px, y - py);
      if (d < wd1) { wd2 = wd1; wd1 = d; wid = wx + wy * nx; } else if (d < wd2) wd2 = d;
    }
  }
}
// Traços: cada célula da grade tem um risco curto com direção própria. Devolve em sd a distância ao risco
// mais próximo (em células) e em sid a célula dona dele. Ladrilha em nx por ny.
let sd = 0, sid = 0;
function strokes(u, v, nx, ny, seed, len) {
  const x = u * nx, y = v * ny;
  const ix = Math.floor(x), iy = Math.floor(y);
  sd = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const wx = ((cx % nx) + nx) % nx, wy = ((cy % ny) + ny) % ny;
      const px = cx + 0.2 + 0.6 * h2(wx, wy, seed), py = cy + 0.2 + 0.6 * h2(wx, wy, seed + 7);
      const a = h2(wx, wy, seed + 13) * 6.2832, l = len * (0.5 + 0.5 * h2(wx, wy, seed + 21));
      const ex = Math.cos(a) * l, ey = Math.sin(a) * l;
      const t = sat(((x - px) * ex + (y - py) * ey) / (ex * ex + ey * ey) + 0.5);
      const d = Math.hypot(x - px - ex * (t - 0.5), y - py - ey * (t - 0.5)) * (1 + 0.9 * t);   // afina para a ponta
      if (d < sd) { sd = d; sid = wx + wy * nx; }
    }
  }
}
const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ss = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
function set(o, r, g, b, a = 1) { o[0] = r; o[1] = g; o[2] = b; o[3] = a; }
function mul(o, k) { o[0] *= k; o[1] *= k; o[2] *= k; }
function blend(o, r, g, b, t) { o[0] = mix(o[0], r, t); o[1] = mix(o[1], g, t); o[2] = mix(o[2], b, t); }
// distância de (u,v) ao segmento a-b
function seg(u, v, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = sat(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(u - ax - dx * t, v - ay - dy * t);
}

// ---- rochas e solos -----------------------------------------------------------
function rock(u, v, s, o, r, g, b, contrast, cells) {
  const n = fbm(u, v, 4, 4, 6, s);
  const warm = fbm(u, v, 2, 2, 2, s + 50) - 0.5;
  // blocos da rocha: cada célula com um tom, separadas por fendas finas e fundas
  const wx = (fbm(u, v, 5, 5, 3, s + 80) - 0.5) * 0.12, wy = (fbm(u, v, 5, 5, 3, s + 81) - 0.5) * 0.12;   // entorta as fendas
  worley(u + wx, v + wy, cells, cells, s + 9);
  const plate = 0.95 + 0.1 * h2(wid, 4, s);
  // a fenda só aparece em parte do contorno: rocha rachada, não pedra de calçada
  const open = ss(0.42, 0.62, fbm(u, v, 3, 3, 2, s + 85));
  const crack = 1 - open * (1 - ss(0.0, 0.045, wd2 - wd1));
  worley(u + wy, v + wx, cells * 3, cells * 3, s + 19);
  const fine = 1 - (1 - open) * 0.6 * (1 - ss(0.0, 0.06, wd2 - wd1));
  // estrato: faixas quase horizontais, tortas
  const band = fbm(u, v + 0.06 * fbm(u, v, 3, 3, 2, s + 70), 2, 9, 3, s + 60) - 0.5;
  const grit = h2((u * 997) | 0, (v * 991) | 0, s);
  let k = (1 - contrast * 0.5 + contrast * n) * plate * (0.6 + 0.4 * crack) * (0.86 + 0.14 * fine) * (1 + band * 0.3 * contrast);
  k *= 0.96 + 0.08 * grit;
  if (grit > 0.975) k *= 1.22; else if (grit < 0.03) k *= 0.8;      // grãos claros e escuros de mineral
  set(o, r * k * (1 + warm * 0.09), g * k, b * k * (1 - warm * 0.1));
}
const T = {};
T.stone = (u, v, s, o) => rock(u, v, s, o, 0.56, 0.56, 0.58, 0.55, 5);
T.bedrock = (u, v, s, o) => { rock(u, v, s, o, 0.2, 0.2, 0.22, 1.1, 4); };
T.basalt = (u, v, s, o) => { rock(u, v, s, o, 0.2, 0.2, 0.23, 0.5, 6); };
T.dirt = (u, v, s, o) => {
  const n = fbm(u, v, 5, 5, 5, s);
  const damp = fbm(u, v, 2, 2, 3, s + 40);                    // manchas mais úmidas, mais escuras
  set(o, 0.46 - 0.05 * damp, 0.31 - 0.03 * damp, 0.19);
  mul(o, 0.6 + 0.62 * n);
  // torrões: células com miolo claro e fresta escura entre elas
  worley(u + 0.05 * (n - 0.5), v + 0.05 * (damp - 0.5), 8, 8, s + 5);
  mul(o, 0.9 + 0.13 * ss(0.0, 0.3, wd2 - wd1));
  // pedrinhas: algumas células pequenas viram seixo, com luz de um lado
  worley(u, v, 13, 13, s + 3);
  if (wd1 < 0.3 * h2(wid, 8, s) && h2(wid, 9, s) > 0.86) {
    const t = h2(wid, 2, s);
    blend(o, 0.48 + 0.2 * t, 0.44 + 0.16 * t, 0.38 + 0.12 * t, 0.8);
    mul(o, 0.8 + 0.5 * ss(0.22, 0.0, wd1));
  }
  // fiapos de raiz
  strokes(u, v, 7, 7, s + 90, 0.55);
  if (sd < 0.035 && (sid % 3) === 0) blend(o, 0.6, 0.5, 0.36, 0.55);
  const grit = h2((u * 640) | 0, (v * 640) | 0, s);
  mul(o, 0.93 + 0.14 * grit);
  if (grit > 0.955) mul(o, 0.7);
};
T.sand = (u, v, s, o) => {
  const n = fbm(u, v, 6, 6, 5, s);
  // Ondulação assimétrica do vento (Tidewater Terrain.js / DetailTextures.js): cristas finas e cavas sombreadas
  const warp = fbm(u, v, 3, 3, 3, s + 4) * 1.4 + fbm(u, v, 7, 7, 2, s + 11) * 0.45;
  const ph = (v * 8 + u * 2 + warp) * 6.2832;
  const rip1 = Math.pow(Math.sin(ph) * 0.5 + 0.5, 1.6);
  const ripple = (rip1 - 0.48) * 1.35 + Math.sin(ph * 2 + 1.3) * 0.15;
  // Grão duplo de areia de coral + fragmentos esparsos de concha (Worley)
  const gritA = h2((u * 811) | 0, (v * 823) | 0, s);
  const gritB = h2((u * 409) | 0, (v * 419) | 0, s + 19);
  const grit = gritA * 0.58 + gritB * 0.42;
  const hue = fbm(u, v, 3, 3, 2, s + 30) - 0.5;
  set(o, 0.85 + hue * 0.045, 0.77 + hue * 0.02, 0.61 - hue * 0.05);
  mul(o, 0.89 + 0.12 * n + 0.058 * ripple + 0.095 * (grit - 0.5));
  worley(u, v, 14, 14, s + 23);
  if (h2(wid, 5, s) < 0.18 && wd1 < 0.24) {
    const peb = ss(0.24, 0.0, wd1);
    blend(o, 0.91, 0.86, 0.76, peb * 0.42);
  }
  if (gritA > 0.982) mul(o, 1.15);                            // grão de quartzo/concha brilhante
  else if (gritA < 0.022) mul(o, 0.76);                       // grão mineral escuro
};
T.gravel = (u, v, s, o) => {
  worley(u, v, 9, 9, s);
  const tone = h2(wid, 3, s), warm = h2(wid, 5, s);
  set(o, 0.42 + 0.3 * tone, 0.41 + 0.27 * tone, 0.4 + 0.24 * tone - 0.08 * warm);
  mul(o, (0.75 + 0.35 * ss(0.5, 0.0, wd1)) * (0.45 + 0.55 * ss(0.0, 0.14, wd2 - wd1)));
};
T.clay = (u, v, s, o) => {
  set(o, 0.6, 0.62, 0.66);
  mul(o, 0.9 + 0.14 * fbm(u, v, 3, 12, 4, s));
};
T.snow = (u, v, s, o) => {
  const n = fbm(u, v, 4, 4, 4, s);
  set(o, 0.9 + 0.06 * n, 0.93 + 0.05 * n, 0.98);
  if (h2((u * 512) | 0, (v * 512) | 0, s) > 0.985) mul(o, 1.05);
};
T.ice = (u, v, s, o) => {
  const n = fbm(u, v, 3, 3, 4, s);
  set(o, 0.58 + 0.14 * n, 0.78 + 0.1 * n, 0.93);
  worley(u, v, 4, 4, s + 2);
  blend(o, 0.93, 0.97, 1, 0.7 * ss(0.035, 0.0, wd2 - wd1));
};
T.sandstone = (u, v, s, o) => {
  const band = fbm(u, v, 2, 14, 3, s);
  set(o, 0.82, 0.71, 0.5);
  mul(o, 0.84 + 0.26 * band + 0.05 * (h2((u * 700) | 0, (v * 700) | 0, s) - 0.5));
  const line = Math.abs(((v * 5 + 0.08 * fbm(u, v, 4, 1, 2, s + 8)) % 1) - 0.5);
  mul(o, 0.86 + 0.14 * ss(0.0, 0.07, line));
};
T.marble = (u, v, s, o) => {
  const w = fbm(u, v, 3, 3, 4, s);
  const vein = Math.abs(Math.sin((u * 2 + v * 3 + w * 4.5) * 6.2832));
  set(o, 0.92, 0.91, 0.89);
  mul(o, 0.93 + 0.07 * w);
  blend(o, 0.55, 0.56, 0.6, 0.55 * ss(0.12, 0.0, vein));
};
T.concrete = (u, v, s, o) => {
  set(o, 0.63, 0.63, 0.62);
  mul(o, 0.9 + 0.14 * fbm(u, v, 6, 6, 4, s));
  if (h2((u * 96) | 0, (v * 96) | 0, s) > 0.985) mul(o, 0.7);
  const e = Math.min(u, 1 - u, v, 1 - v);
  mul(o, 0.9 + 0.1 * ss(0.0, 0.03, e));
};
function plaster(r, g, b) {
  return (u, v, s, o) => {
    set(o, r, g, b);
    mul(o, 0.9 + 0.14 * fbm(u, v, 5, 5, 4, s) + 0.04 * (h2((u * 400) | 0, (v * 400) | 0, s) - 0.5));
  };
}
T.plaster_white = plaster(0.93, 0.92, 0.88);
T.plaster_red = plaster(0.74, 0.22, 0.18);
T.plaster_yellow = plaster(0.93, 0.74, 0.22);
T.plaster_green = plaster(0.3, 0.58, 0.3);
T.plaster_blue = plaster(0.22, 0.42, 0.74);
T.plaster_dark = plaster(0.22, 0.23, 0.26);

// ---- minérios -------------------------------------------------------------------
function ore(r, g, b, glow, r2, g2, b2) {
  return (u, v, s, o) => {
    T.stone(u, v, 1013, o);
    const n = fbm(u, v, 5, 5, 3, s + 31);
    const m = ss(0.57, 0.63, n);
    if (m > 0) {
      const sh = 0.7 + 0.6 * fbm(u, v, 16, 16, 2, s + 5);
      const t2 = r2 === undefined ? 0 : ss(0.4, 0.6, fbm(u, v, 7, 7, 2, s + 77));
      blend(o, mix(r, r2 ?? r, t2) * sh, mix(g, g2 ?? g, t2) * sh, mix(b, b2 ?? b, t2) * sh, m);
      if (glow) o[3] = 1 - glow * m;
    } else mul(o, 0.8 + 0.2 * ss(0.5, 0.57, 0.57 - (n - 0.5)));
  };
}
T.coal_ore = ore(0.07, 0.07, 0.08);
T.iron_ore = ore(0.74, 0.52, 0.38);
T.copper_ore = ore(0.82, 0.46, 0.22, 0, 0.26, 0.64, 0.52);
T.gold_ore = ore(0.98, 0.8, 0.22);
T.crystal_ore = ore(0.45, 0.9, 1.0, 0.85, 0.78, 0.55, 1.0);

// ---- madeiras ---------------------------------------------------------------------
function bark(r, g, b, fx) {
  return (u, v, s, o) => {
    const wob = (fbm(u, v, 3, 3, 2, s + 40) - 0.5) * 0.09;
    const n = fbm(u + wob, v, fx, 3, 4, s);
    const ridge = Math.abs(2 * vn((u + wob) * fx * 2, v * 4, fx * 2, 4, s + 9) - 1);
    set(o, r, g, b);
    mul(o, (0.72 + 0.5 * n) * (0.62 + 0.38 * ss(0.0, 0.3, ridge)));
    if (h2((u * 300) | 0, (v * 90) | 0, s) > 0.9) mul(o, 0.85);
  };
}
T.log_side = bark(0.4, 0.3, 0.21, 12);
T.pine_side = bark(0.33, 0.22, 0.16, 9);
function rings(r, g, b) {
  return (u, v, s, o) => {
    const dx = u - 0.5, dy = v - 0.5;
    const d = Math.hypot(dx, dy) + 0.025 * (fbm(u, v, 4, 4, 3, s) - 0.5);
    const ring = 0.5 + 0.5 * Math.sin(d * 95);
    set(o, r, g, b);
    mul(o, 0.82 + 0.2 * ring);
    if (d > 0.43) { set(o, r * 0.5, g * 0.46, b * 0.42); mul(o, 0.8 + 0.4 * fbm(u, v, 16, 16, 2, s + 3)); }
  };
}
T.log_top = rings(0.74, 0.6, 0.4);
T.pine_top = rings(0.78, 0.56, 0.36);
function planks(r, g, b) {
  return (u, v, s, o) => {
    const row = Math.floor(v * 4);
    const uu = u + h2(row, 1, s) * 0.7;
    const board = Math.floor(uu * 2) + row * 7;
    const grain = fbm(uu, v, 3, 40, 4, s + board * 13);
    set(o, r, g, b);
    mul(o, (0.82 + 0.28 * grain) * (0.9 + 0.2 * h2(board, 9, s)));
    const fv = v * 4 - row, fu = uu * 2 - Math.floor(uu * 2);
    mul(o, 0.55 + 0.45 * ss(0.0, 0.07, Math.min(fv, 1 - fv)) * ss(0.0, 0.02, Math.min(fu, 1 - fu)));
  };
}
T.planks = planks(0.72, 0.56, 0.36);
T.pine_planks = planks(0.56, 0.37, 0.24);

// ---- alvenaria ----------------------------------------------------------------------
function brickwork(rows, cols, mortar, paint) {
  return (u, v, s, o) => {
    const row = Math.floor(v * rows);
    const uu = u + (row & 1) * (0.5 / cols);
    const col = Math.floor(uu * cols);
    const fu = uu * cols - col, fv = v * rows - row;
    const id = ((col % cols) + cols) % cols + row * 17;
    const e = Math.min(fu * (rows / cols) * 2, (1 - fu) * (rows / cols) * 2, fv, 1 - fv);
    if (e < mortar) { set(o, 0.62, 0.6, 0.56); mul(o, 0.85 + 0.2 * fbm(u, v, 16, 16, 2, s)); return; }
    paint(u, v, s, o, id);
    mul(o, 0.9 + 0.1 * ss(mortar, mortar + 0.12, e));
    if (fv > 0.82) mul(o, 1.06);
  };
}
T.stone_bricks = brickwork(2, 2, 0.045, (u, v, s, o, id) => {
  rock(u, v, s, o, 0.6, 0.6, 0.61, 0.4, 7); mul(o, 0.88 + 0.2 * h2(id, 3, s));
});
T.bricks = brickwork(4, 2, 0.07, (u, v, s, o, id) => {
  const t = h2(id, 5, s);
  set(o, 0.62 + 0.14 * t, 0.27 + 0.06 * t, 0.2);
  mul(o, 0.85 + 0.25 * fbm(u, v, 12, 12, 3, s));
});
T.roof = (u, v, s, o) => {
  const row = Math.floor(v * 4);
  const uu = u * 4 + (row & 1) * 0.5;
  const fu = uu - Math.floor(uu), fv = v * 4 - row;
  const arch = Math.sqrt(sat(1 - (fu - 0.5) * (fu - 0.5) * 4));
  const t = h2(Math.floor(uu) & 3, row, s);
  set(o, 0.72 + 0.08 * t, 0.36 + 0.05 * t, 0.22);
  mul(o, (0.6 + 0.45 * arch) * (0.72 + 0.28 * ss(0.0, 0.3, fv)) * (0.9 + 0.15 * fbm(u, v, 10, 10, 2, s)));
};

// ---- metais e peças -----------------------------------------------------------------
function brushed(o, u, v, s, r, g, b) {
  set(o, r, g, b);
  mul(o, 0.9 + 0.16 * fbm(u, v, 2, 48, 3, s));
}
function rivets(o, u, v, n) {
  const fu = u * n - Math.floor(u * n), fv = v * n - Math.floor(v * n);
  const d = Math.hypot(fu - 0.5, fv - 0.5);
  const edge = Math.min(u, 1 - u, v, 1 - v);
  if (edge < 0.11 && d < 0.2) mul(o, 0.72 + 1.2 * ss(0.2, 0.0, d) * (fv > 0.5 ? 1 : 0.6));
}
T.steel = (u, v, s, o) => {
  brushed(o, u, v, s, 0.58, 0.6, 0.63);
  const e = Math.min(u, 1 - u, v, 1 - v);
  mul(o, 0.8 + 0.2 * ss(0.0, 0.05, e));
  rivets(o, u, v, 4);
};
T.metal_dark = (u, v, s, o) => { brushed(o, u, v, s, 0.24, 0.25, 0.28); };
T.gold_block = (u, v, s, o) => {
  brushed(o, u, v, s, 0.98, 0.78, 0.2);
  const e = Math.min(u, 1 - u, v, 1 - v);
  mul(o, 0.72 + 0.28 * ss(0.0, 0.1, e) + 0.18 * ss(0.5, 0.2, Math.abs(u + v - 1)));
};
T.wing = (u, v, s, o) => {
  brushed(o, u, v, s, 0.84, 0.86, 0.89);
  const e = Math.min(u, 1 - u, v, 1 - v);
  mul(o, 0.86 + 0.14 * ss(0.0, 0.04, e));
  rivets(o, u, v, 8);
};
T.blade = (u, v, s, o) => {
  brushed(o, u, v, s, 0.3, 0.27, 0.24);
  if (u > 0.82) set(o, 0.92, 0.72, 0.15);
};
T.engine_side = (u, v, s, o) => {
  brushed(o, u, v, s, 0.33, 0.35, 0.38);
  const e = Math.min(u, 1 - u, v, 1 - v);
  if (e > 0.14) {
    const fin = (v * 9) % 1;
    mul(o, 0.45 + 0.75 * ss(0.15, 0.5, Math.abs(fin - 0.5) * 2));
    if (v > 0.68 && v < 0.76) blend(o, 0.86, 0.3, 0.12, 0.9);
  } else rivets(o, u, v, 4);
  mul(o, 0.85 + 0.15 * ss(0.0, 0.04, e));
};
T.engine_top = (u, v, s, o) => {
  brushed(o, u, v, s, 0.33, 0.35, 0.38);
  const d = Math.hypot(u - 0.5, v - 0.5);
  if (d < 0.36) {
    const ang = Math.atan2(v - 0.5, u - 0.5);
    const blade = Math.abs(Math.sin(ang * 4 + d * 9));
    set(o, 0.1, 0.1, 0.11); mul(o, 0.6 + 1.3 * blade * ss(0.36, 0.25, d));
    if (d < 0.07) set(o, 0.6, 0.62, 0.65);
  } else if (d < 0.4) mul(o, 1.5);
  rivets(o, u, v, 4);
};
T.thruster_side = (u, v, s, o) => {
  brushed(o, u, v, s, 0.5, 0.52, 0.55);
  const e = Math.min(u, 1 - u, v, 1 - v);
  mul(o, 0.8 + 0.2 * ss(0.0, 0.05, e));
  if (v > 0.38 && v < 0.62) {
    const stripe = ((u + v) * 5) % 1 < 0.5;
    blend(o, stripe ? 0.95 : 0.12, stripe ? 0.74 : 0.12, stripe ? 0.12 : 0.13, 0.92);
  }
  rivets(o, u, v, 4);
};
T.thruster_nozzle = (u, v, s, o) => {
  brushed(o, u, v, s, 0.3, 0.31, 0.34);
  const d = Math.hypot(u - 0.5, v - 0.5);
  if (d < 0.4) {
    set(o, 0.07, 0.07, 0.08);
    const g = ss(0.34, 0.0, d);
    blend(o, 1.0, 0.55 + 0.4 * g, 0.15 + 0.6 * g * g, g);
    o[3] = 1 - 0.9 * g;
  } else if (d < 0.45) mul(o, 1.6);
};
T.thruster_front = (u, v, s, o) => {
  brushed(o, u, v, s, 0.5, 0.52, 0.55);
  const d = Math.hypot(u - 0.5, v - 0.5);
  if (d < 0.38) {
    set(o, 0.09, 0.09, 0.1);
    const g = Math.min((u * 8) % 1, (v * 8) % 1);
    if (g < 0.22) set(o, 0.42, 0.44, 0.47);
  } else if (d < 0.43) mul(o, 1.4);
};
T.gyro = (u, v, s, o) => {
  brushed(o, u, v, s, 0.42, 0.44, 0.48);
  const d = Math.hypot(u - 0.5, v - 0.5);
  const ring = Math.abs(((d * 7) % 1) - 0.5);
  if (d < 0.43) mul(o, 0.6 + 0.8 * ss(0.0, 0.3, ring));
  if (d < 0.13) { const g = ss(0.13, 0.0, d); set(o, 0.3 + 0.5 * g, 0.9, 1.0); o[3] = 1 - 0.9 * g; }
  rivets(o, u, v, 4);
};
T.dynamite_side = (u, v, s, o) => {
  const fu = (u * 3) % 1;
  const round = Math.sqrt(sat(1 - (fu - 0.5) * (fu - 0.5) * 4));
  set(o, 0.8, 0.14, 0.12); mul(o, 0.45 + 0.7 * round);
  if (v > 0.4 && v < 0.62) { set(o, 0.9, 0.84, 0.66); mul(o, 0.6 + 0.5 * round); if (Math.abs(v - 0.51) < 0.05 && (u * 10) % 1 < 0.6) mul(o, 0.3); }
  if (v > 0.93 || v < 0.05) mul(o, 0.6);
};
T.dynamite_top = (u, v, s, o) => {
  set(o, 0.2, 0.16, 0.13);
  const fu = (u * 3) % 1, fv = (v * 3) % 1;
  const d = Math.hypot(fu - 0.5, fv - 0.5);
  if (d < 0.44) { set(o, 0.78, 0.15, 0.12); mul(o, 0.7 + 0.5 * ss(0.44, 0.1, d)); }
  if (d < 0.09) set(o, 0.92, 0.88, 0.75);
};
T.tire = (u, v, s, o) => {
  set(o, 0.09, 0.09, 0.1);
  const row = Math.floor(v * 8);
  const fu = ((u * 6 + (row & 1) * 0.5) % 1), fv = (v * 8) % 1;
  mul(o, 0.6 + 0.9 * ss(0.08, 0.2, Math.min(fu, 1 - fu, fv, 1 - fv)));
  mul(o, 0.9 + 0.3 * fbm(u, v, 16, 16, 2, s));
};
T.hubcap = (u, v, s, o) => {
  const d = Math.hypot(u - 0.5, v - 0.5);
  const ang = Math.atan2(v - 0.5, u - 0.5);
  set(o, 0.09, 0.09, 0.1);
  if (d < 0.36) {
    brushed(o, u, v, s, 0.7, 0.72, 0.75);
    const spoke = Math.abs(Math.sin(ang * 2.5));
    if (d > 0.1 && spoke < 0.42) set(o, 0.12, 0.12, 0.13);
    mul(o, 0.8 + 0.4 * ss(0.36, 0.0, d));
  } else if (d > 0.47) mul(o, 0.6);
};
T.seat = (u, v, s, o) => {
  set(o, 0.52, 0.2, 0.16);
  const fu = (u * 4) % 1, fv = (v * 4) % 1;
  const q = Math.min(fu, 1 - fu, fv, 1 - fv);
  mul(o, (0.62 + 0.5 * ss(0.0, 0.3, q)) * (0.9 + 0.2 * fbm(u, v, 24, 24, 2, s)));
};
T.balloon = (u, v, s, o) => {
  const gore = Math.floor(u * 8);
  if (gore & 1) set(o, 0.93, 0.9, 0.82); else set(o, 0.86, 0.26, 0.2);
  const fu = (u * 8) % 1;
  mul(o, (0.8 + 0.25 * Math.sin(fu * 3.1416)) * (0.93 + 0.1 * fbm(u, v, 20, 20, 2, s)));
};
T.lamp = (u, v, s, o) => {
  const e = Math.min(u, 1 - u, v, 1 - v);
  if (e < 0.1 || Math.abs(u - 0.5) < 0.03 || Math.abs(v - 0.5) < 0.03) {
    brushed(o, u, v, s, 0.2, 0.18, 0.16); mul(o, 0.8 + 0.5 * ss(0.0, 0.1, e));
    return;
  }
  const d = Math.hypot(u - 0.5, v - 0.5);
  const g = ss(0.62, 0.0, d);
  set(o, 1.0, 0.72 + 0.2 * g, 0.34 + 0.4 * g);
  mul(o, 0.92 + 0.1 * fbm(u, v, 8, 8, 2, s));
  o[3] = 0.04;
};
// Uma costela de mandacaru: sulco escuro nas bordas, crista verde-azulada, aréola de lã e espinho.
T.cactus_side = (u, v, s, o) => {
  const d = Math.abs(u - 0.5) * 2;
  const groove = d * d;
  set(o, 0.20 + 0.10 * (1 - groove), 0.36 + 0.14 * (1 - groove), 0.24 + 0.08 * (1 - groove));
  mul(o, (0.72 + 0.28 * (1 - groove)) * (0.90 + 0.16 * fbm(u, v, 10, 18, 3, s)));
  const av = (v * 7) % 1;
  const du = (u - 0.5) / 0.07, dv = (av - 0.25) / 0.16;
  const oval = du * du + dv * dv;
  if (oval < 1) blend(o, 0.58, 0.44, 0.26, (1 - oval) * 0.8);
  if (oval < 0.2) set(o, 0.36, 0.26, 0.14);
};
T.cactus_top = (u, v, s, o) => {
  const dx = u - 0.5, dz = v - 0.5, d = Math.hypot(dx, dz);
  const rib = 0.5 + 0.5 * Math.cos(Math.atan2(dz, dx) * 6);
  set(o, 0.22, 0.40, 0.26);
  mul(o, 0.75 + 0.35 * rib * ss(0.34, 0.02, d));
  if (d < 0.08) blend(o, 0.72, 0.62, 0.40, ss(0.08, 0.0, d));
  mul(o, 0.92 + 0.1 * fbm(u, v, 8, 8, 2, s));
};

// ---- Zona Fantasma e coisas místicas --------------------------------------------------------
T.shadow_stone = (u, v, s, o) => {
  rock(u, v, s, o, 0.2, 0.17, 0.26, 0.7, 5);
  const vein = Math.abs(Math.sin((u * 3 + v * 2 + fbm(u, v, 3, 3, 3, s + 5) * 5) * 6.2832));
  if (vein < 0.06) { blend(o, 0.62, 0.36, 0.95, 0.75); o[3] = 0.72; }
};
T.ash = (u, v, s, o) => {
  set(o, 0.46, 0.44, 0.47);
  mul(o, 0.8 + 0.3 * fbm(u, v, 8, 8, 4, s) + 0.06 * (h2((u * 600) | 0, (v * 600) | 0, s) - 0.5));
};
T.phantom_crystal = (u, v, s, o) => {
  worley(u, v, 4, 4, s);
  const facet = ss(0.0, 0.5, wd2 - wd1), tone = h2(wid, 3, s);
  set(o, 0.5 + 0.3 * tone, 0.3 + 0.2 * facet, 0.95);
  mul(o, 0.4 + 0.5 * facet);
  o[3] = 0.72 + 0.2 * facet;   // brilho próprio discreto: só as arestas entre as facetas acendem
};
// magma (19/11, ilha do vulcão): placas escuras de lava fria com as frestas acesas (alfa < 1 = luz própria)
T.magma = (u, v, s, o) => {
  worley(u, v, 5, 5, s);
  const borda = wd2 - wd1, n = fbm(u, v, 6, 6, 4, s + 9), placa = h2(wid, 5, s);
  set(o, 0.17 + 0.05 * n + 0.04 * placa, 0.12 + 0.03 * n, 0.11 + 0.02 * placa);
  mul(o, 0.7 + 0.45 * ss(0.08, 0.55, borda));
  const fresta = 1 - ss(0.015, 0.13 + 0.07 * n, borda);
  if (fresta > 0.01) {
    const q = fresta * fresta;
    blend(o, 1.0, 0.36 + 0.5 * q, 0.04 + 0.3 * q * q, Math.min(1, fresta * 1.4));
    o[3] = 1 - 0.8 * q;
  }
};
T.mystic_water = (u, v, s, o) => {
  const n = fbm(u, v, 4, 4, 4, s), w = Math.sin((u * 3 + n * 2.5) * 6.2832) * Math.sin((v * 3 + n * 2.5) * 6.2832);
  set(o, 0.16 + 0.2 * n, 0.62 + 0.3 * w * w, 0.8 + 0.15 * n);
  o[3] = 0.3 + 0.3 * n;
};
T.portal = (u, v, s, o) => {
  const dx = u - 0.5, dy = v - 0.5, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
  const sw = fbm(u, v, 4, 4, 3, s);
  const arm = 0.5 + 0.5 * Math.sin(a * 3 + d * 18 + sw * 4);
  set(o, 0.5 + 0.4 * arm, 0.2 + 0.25 * arm, 0.95, arm > 0.34 || d < 0.16 ? 1 : 0);
  mul(o, 0.6 + 0.7 * arm);
};

// ---- recortes ---------------------------------------------------------------------------
T.glass = (u, v, s, o) => {
  const e = Math.min(u, 1 - u, v, 1 - v);
  set(o, 0.82, 0.92, 0.97, 0);
  if (e < 0.045) { o[3] = 1; mul(o, 0.8 + 0.2 * ss(0, 0.045, e)); return; }
  const g = Math.abs(u - v + 0.3), g2 = Math.abs(u - v - 0.12);
  if ((g < 0.018 && u > 0.2 && u < 0.6) || (g2 < 0.012 && u > 0.45 && u < 0.8)) { set(o, 0.96, 0.99, 1); o[3] = 1; }
};
// Ícones dos novos acabamentos; o shader de vidro usa as propriedades ópticas.
for(let i=1;i<GLASS_TEXTURES.length;i++) {
  const style=GLASS_STYLES[i];
  T[GLASS_TEXTURES[i]]=(u,v,s,o)=>{
    const edge=Math.min(u,1-u,v,1-v);
    const sheen=Math.exp(-Math.pow((u+v-.95)*3.5,2))*.18;
    const shade=.78+.22*v;
    set(o,...style.icon.map(c=>Math.min(1,c*shade+sheen)));
    o[3]=style.opaque?1:(edge<.035?.9:.46);
  };
}
function stemAndLeaves(u, v, o) {
  const cx = 0.5 + 0.03 * Math.sin(v * 7);
  if (v < 0.6 && Math.abs(u - cx) < 0.024) { set(o, 0.22, 0.48, 0.18); return true; }
  for (const side of [-1, 1]) {
    const lx = cx + side * 0.11, ly = 0.24 + (side > 0 ? 0.1 : 0);
    const a = (u - lx) / 0.11, b = (v - ly) / 0.045;
    if (a * a + b * b < 1) { set(o, 0.25, 0.54, 0.2); mul(o, 0.8 + 0.3 * (1 - Math.abs(b))); return true; }
  }
  return false;
}
function flower(pr, pg, pb, cr, cg, cb, petals) {
  return (u, v, s, o) => {
    set(o, 0.24, 0.5, 0.2, 0);
    const hx = 0.5 + 0.03 * Math.sin(0.6 * 7), hy = 0.7;
    const dx = u - hx, dy = v - hy;
    const d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    const r = 0.13 + 0.09 * Math.abs(Math.cos(ang * petals * 0.5));
    if (d < 0.07) { set(o, cr, cg, cb); mul(o, 0.8 + 0.4 * ss(0.07, 0, d)); return; }
    if (d < r) { set(o, pr, pg, pb); mul(o, 0.72 + 0.4 * (d / r)); return; }
    if (stemAndLeaves(u, v, o)) return;
  };
}
T.flower_yellow = flower(0.98, 0.82, 0.16, 0.85, 0.5, 0.1, 8);
T.flower_red = flower(0.88, 0.14, 0.12, 0.15, 0.12, 0.12, 5);
T.flower_blue = flower(0.32, 0.46, 0.95, 0.98, 0.9, 0.4, 6);
T.flower_white = flower(0.97, 0.97, 0.95, 0.98, 0.82, 0.2, 10);
T.dry_shrub = (u, v, s, o) => {
  set(o, 0.48, 0.36, 0.22, 0);
  for (let i = 0; i < 9; i++) {
    const a = (h2(i, 1, s) - 0.5) * 2.2, len = 0.35 + 0.55 * h2(i, 2, s);
    const bx = 0.5 + Math.sin(a) * len, by = Math.cos(a) * len;
    const mx = 0.5 + Math.sin(a) * len * 0.45, my = Math.cos(a) * len * 0.45;
    if (seg(u, v, 0.5, 0, mx, my) < 0.02 || seg(u, v, mx, my, bx, by) < 0.013 ||
      seg(u, v, mx, my, mx + Math.sin(a + 0.9) * len * 0.3, my + Math.cos(a + 0.9) * len * 0.3) < 0.011) {
      o[3] = 1; mul(o, 0.8 + 0.4 * h2(i, 3, s)); return;
    }
  }
};
T.reeds = (u, v, s, o) => {
  set(o, 0.5, 0.56, 0.28, 0);
  for (let i = 0; i < 6; i++) {
    const x0 = 0.12 + 0.76 * (i + h2(i, 1, s) * 0.6) / 6, h = 0.6 + 0.38 * h2(i, 2, s), lean = (h2(i, 3, s) - 0.5) * 0.14;
    if (v > h) continue;
    const t = v / h, x = x0 + lean * t * t;
    if (Math.abs(u - x) < 0.022) { set(o, 0.42 + 0.2 * t, 0.56 - 0.06 * t, 0.26, 1); if (t > 0.78 && (i & 1)) set(o, 0.4, 0.26, 0.14, 1); return; }
    if (t > 0.78 && (i & 1) && Math.abs(u - x) < 0.04) { set(o, 0.42, 0.28, 0.15, 1); return; }
  }
};
function blades(n, width, serr, step) {
  return (u, v, s, o) => {
    set(o, 0.75, 0.75, 0.75, 0);
    for (let j = 0; j < n; j++) {
      const i = (j * step) % n;                          // ordem embaralhada: quem fica na frente não segue da esquerda para a direita
      const x0 = 0.07 + 0.86 * (i + 0.6 * h2(i, 1, s)) / n, h = 0.42 + 0.58 * h2(i, 2, s), lean = (h2(i, 3, s) - 0.5) * 0.42;
      if (v > h) continue;
      const t = v / h, x = x0 + lean * t * t;
      let w = width * (1 - t * 0.9) * (0.7 + 0.6 * h2(i, 5, s)) + 0.005;
      if (serr) w = width * Math.sin(Math.min(1, t * 1.15 + 0.05) * 3.1416) * (0.55 + 0.45 * ((t * 13) % 1)) + 0.01;
      const e = Math.abs(u - x) / w;
      if (e < 1) {
        // folha: base escura (sombra das vizinhas), ponta clara, nervura no meio, bordas caindo; as de trás mais escuras
        let k = (0.26 + 0.5 * t) * (0.8 + 0.3 * h2(i, 4, s)) * (1 - 0.22 * e * e) * (1 - 0.3 * j / n);
        if (e < 0.16) k *= 1.14;
        const dry = h2(i, 6, s) > 0.82 ? t * 0.25 : 0;   // ponta seca em algumas
        set(o, k * (1 + dry), k * (1 + dry * 0.3), k * (0.97 - dry * 0.6), 1); return;
      }
    }
  };
}
T.tall_grass = blades(17, 0.03, false, 7);
T.fern = blades(6, 0.11, true, 5);
T.grass_side = (u, v, s, o) => {
  // corte do gramado: uma faixa de relva em cima, folhas soltas caindo sobre a terra e a terra embaixo
  const turf = 0.13 + 0.07 * vn(u * 9, 0, 9, 1, s) + 0.04 * vn(u * 31, 0, 31, 1, s + 2);
  let k = -1;
  if (v > 1 - turf) k = (0.36 + 0.34 * fbm(u, v, 40, 8, 3, s + 5)) * (0.72 + 0.28 * (v - (1 - turf)) / turf);
  else {
    // folhas penduradas: cada uma nasce na faixa e desce afinando, com uma leve curva
    const N = 26;
    const cell = Math.floor(u * N);
    for (let d = -1; d <= 1 && k < 0; d++) {
      const i = ((cell + d) % N + N) % N;
      const x0 = (cell + d + 0.2 + 0.6 * h2(i, 1, s)) / N;
      const len = 0.1 + 0.34 * h2(i, 2, s) * h2(i, 5, s) + 0.06 * h2(i, 6, s);
      const t = (1 - turf - v) / len;                           // 0 na raiz, 1 na ponta
      if (t < 0 || t > 1) continue;
      const x = x0 + (h2(i, 3, s) - 0.5) * 0.05 * t * t;
      const w = (0.016 + 0.012 * h2(i, 4, s)) * (1 - t * 0.9);
      if (Math.abs(u - x) < w) k = (0.34 + 0.3 * h2(i, 7, s)) * (0.95 - 0.3 * t);
    }
  }
  if (k >= 0) { set(o, k, k, k * 0.97, 0); return; }
  T.dirt(u, v, 1017, o); o[3] = 1;
  mul(o, 0.6 + 0.4 * ss(1 - turf, 1 - turf - 0.2, v));         // sombra da relva sobre a terra logo abaixo
};
T.grass_top = (u, v, s, o) => {
  const n = fbm(u, v, 7, 7, 4, s);
  // duas camadas de folhas: as de baixo mais escuras e largas, as de cima finas e claras
  strokes(u, v, 15, 15, s + 3, 0.7);
  const under = ss(0.36, 0.08, sd) * (0.5 + 0.5 * h2(sid, 1, s));
  strokes(u, v, 26, 26, s + 11, 0.72);
  const tone = h2(sid, 2, s);
  const over = ss(0.32, 0.06, sd);
  strokes(u, v, 37, 37, s + 17, 0.6);
  const tips = ss(0.26, 0.05, sd) * h2(sid, 3, s);
  let k = 0.36 + 0.16 * n + 0.16 * under + over * (0.1 + 0.2 * tone) + tips * 0.2;
  k *= 0.95 + 0.1 * h2((u * 512) | 0, (v * 512) | 0, s);
  const dry = over * (tone > 0.84 ? 1 : 0);                 // uma ou outra folha seca, amarelada
  const hue = fbm(u, v, 4, 4, 2, s + 33) - 0.5;
  set(o, k * (1 + hue * 0.1 + dry * 0.22), k * (1 + dry * 0.06), k * (1 - hue * 0.1 - dry * 0.2));
};
function foliage(cr, cg, cb, needles) {
  return (u, v, s, o) => {
    const blot = fbm(u, v, 5, 5, 3, s + 4);           // manchas grandes de luz e sombra
    let k, cover;
    if (needles) {
      const st = fbm(u + v * 0.55, v, 6, 40, 2, s + 8);
      const st2 = fbm(u - v * 0.55, v, 6, 40, 2, s + 18);
      k = 0.34 + 0.5 * Math.max(st, st2) + 0.3 * blot;
      cover = !(Math.max(st, st2) < 0.42 && blot < 0.5);
    } else {
      // tufos grandes dão o volume: miolo fundo e escuro, pontas claras
      worley(u, v, 5, 5, s + 60);
      const tuft = ss(0.75, 0.1, wd1);
      // folhas: riscos largos e curtos, cada um com a sua nervura clara
      strokes(u, v, 10, 10, s, 0.55);
      const tone = h2(sid, 2, s);
      const leaf = ss(0.46, 0.3, sd), rib = ss(0.06, 0.0, sd), edge = ss(0.2, 0.44, sd);
      strokes(u, v, 10, 10, s + 31, 0.55);                       // segunda leva de folhas, por trás
      const leaf2 = ss(0.46, 0.3, sd);
      k = leaf > 0.5 ? 0.42 + 0.14 * blot + 0.1 * tuft + 0.22 * tone + rib * 0.12 - edge * 0.12
        : 0.2 + 0.12 * blot + 0.12 * tuft + leaf2 * (0.1 + 0.1 * h2(sid, 2, s));
      cover = leaf > 0.5 || leaf2 > 0.5 || (tuft > 0.5 && blot > 0.5);   // entre as folhas, só os miolos fechados cobrem
    }
    const hue = fbm(u, v, 3, 3, 2, s + 33) - 0.5;
    set(o, cr * k * (1 + hue * 0.2), cg * k, cb * k * (1 - hue * 0.25), cover ? 1 : 0);
  };
}
T.leaves = foliage(0.95, 1.0, 0.9, false);
T.pine_leaves = foliage(0.6, 0.84, 0.76, true);
T.sakura = (u,v,s,o) => {
  T.leaves(u,v,s,o);
  if (!o[3]) return;
  const luz=o[1];
  worley(u,v,11,11,s+19);
  const flor=wd1<.66 && fbm(u,v,4,4,2,s+9)>.24;
  if (flor) set(o,.72+.28*luz,.38+.51*luz+.08*wd1,.48+.43*luz+.06*wd1,1);
  else set(o,.20+.29*luz,.20+.36*luz,.15+.22*luz,1);
};

// Gera todas as camadas: Uint8Array RGBA de size x size x camadas.
export function generateTextures(size, names) {
  const data = new Uint8Array(size * size * 4 * names.length);
  const o = [0, 0, 0, 1];
  let legacyIndex=0;
  for (let li = 0; li < names.length; li++) {
    // Camadas novas não mudam a semente das plantas/portal já aprovados.
    const seed = legacyIndex * 7919 + 13;
    if(!GLASS_TEXTURES.slice(1).includes(names[li])&&names[li]!=='magma')legacyIndex++;
    if(preparedTexture(names[li],size,data,li*size*size*4))continue;
    const fn = T[names[li]];
    if (!fn) throw new Error('textura sem gerador: ' + names[li]);
    let di = li * size * size * 4;
    for (let py = 0; py < size; py++) {
      const v = (py + 0.5) / size;
      for (let px = 0; px < size; px++, di += 4) {
        o[3] = 1;
        fn((px + 0.5) / size, v, seed, o);
        data[di] = sat(o[0]) * 255;
        data[di + 1] = sat(o[1]) * 255;
        data[di + 2] = sat(o[2]) * 255;
        data[di + 3] = sat(o[3]) * 255;
      }
    }
  }
  return data;
}


// Relevo, rugosidade e metal de cada material: [força do relevo, rugosidade, metal]. O que não está aqui usa o padrão.
const SURF = {
  bedrock: [1.3, 0.9, 0], stone: [1.1, 0.86, 0], basalt: [1.1, 0.7, 0], dirt: [0.9, 0.96, 0], sand: [0.45, 0.92, 0], gravel: [1.4, 0.9, 0],
  clay: [0.4, 0.7, 0], snow: [0.3, 0.55, 0], ice: [0.25, 0.1, 0], log_side: [1.5, 0.88, 0], pine_side: [1.5, 0.88, 0], log_top: [0.6, 0.8, 0],
  pine_top: [0.6, 0.8, 0], planks: [0.9, 0.62, 0], pine_planks: [0.9, 0.62, 0], stone_bricks: [1.3, 0.8, 0], bricks: [1.2, 0.82, 0],
  coal_ore: [1.2, 0.6, 0], iron_ore: [1.2, 0.6, 0], copper_ore: [1.2, 0.55, 0], gold_ore: [1.2, 0.45, 0], crystal_ore: [1.2, 0.3, 0],
  lamp: [0.4, 0.3, 0], sandstone: [0.8, 0.85, 0], cactus_side: [0.28, 0.46, 0], cactus_top: [0.18, 0.5, 0], marble: [0.2, 0.2, 0], concrete: [0.5, 0.8, 0],
  roof: [1.2, 0.5, 0], steel: [0.5, 0.3, 1], gold_block: [0.45, 0.22, 1], metal_dark: [0.4, 0.38, 1], wing: [0.35, 0.28, 1], blade: [0.4, 0.5, 0],
  engine_side: [1.0, 0.45, 1], engine_top: [1.0, 0.45, 1], thruster_side: [0.7, 0.4, 1], thruster_nozzle: [0.8, 0.5, 1], thruster_front: [0.9, 0.5, 1],
  gyro: [0.8, 0.35, 1], tire: [1.2, 0.9, 0], hubcap: [0.6, 0.3, 1], seat: [0.9, 0.7, 0], balloon: [0.5, 0.5, 0], glass: [0.1, 0.06, 0],
  plaster_white: [0.35, 0.8, 0], plaster_red: [0.35, 0.8, 0], plaster_yellow: [0.35, 0.8, 0], plaster_green: [0.35, 0.8, 0], plaster_blue: [0.35, 0.8, 0], plaster_dark: [0.35, 0.8, 0],
  shadow_stone: [1.1, 0.5, 0], ash: [0.5, 0.95, 0], phantom_crystal: [0.9, 0.12, 0], mystic_water: [0.4, 0.08, 0], portal: [0.2, 0.3, 0], magma: [1.0, 0.6, 0],
  grass_top: [0.7, 0.85, 0], grass_side: [0.9, 0.9, 0], leaves: [0.9, 0.6, 0], pine_leaves: [0.9, 0.65, 0],
};
for(let i=1;i<GLASS_TEXTURES.length;i++)SURF[GLASS_TEXTURES[i]]=[.05,GLASS_STYLES[i].rough,GLASS_STYLES[i].opaque?1:0];

// Deriva o mapa de superfície das texturas já pintadas: o claro-escuro vira altura, a altura vira normal.
// Saída RGBA por texel: normal x, normal y, rugosidade, metal.
export function generateSurface(size, names, albedo) {
  const out = new Uint8Array(size * size * 4 * names.length);
  const lum = new Float32Array(size * size);
  const m = size - 1;                       // size é potência de 2: "& m" dá a volta (a textura ladrilha)
  for (let li = 0; li < names.length; li++) {
    const [bump, rough, metal] = SURF[names[li]] || [0.8, 0.85, 0];
    const base = li * size * size * 4;
    if (preparedSurface(names[li], size, out, base)) continue;   // pacote realista: relevo e brilho do próprio LabPBR
    for (let i = 0; i < size * size; i++) lum[i] = (albedo[base + i * 4] * 0.299 + albedo[base + i * 4 + 1] * 0.587 + albedo[base + i * 4 + 2] * 0.114) / 255;
    // Fotos não são mapas de altura: limitar o relevo inferido evita frestas pretas.
    const photo = ['stone','stone_bricks','dirt','sand','gravel','clay','log_side','pine_side','planks','pine_planks','concrete','sandstone','basalt','grass_top','grass_side'].includes(names[li]);
    const k = bump * size * 0.034 * (photo ? .45 : 1);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const xl = (x - 1) & m, xr = (x + 1) & m, yd = ((y - 1) & m) * size, yu = ((y + 1) & m) * size, yc = y * size;
      // Sobel: derivada suave nos dois eixos
      const dx = (lum[xr + yd] + 2 * lum[xr + yc] + lum[xr + yu]) - (lum[xl + yd] + 2 * lum[xl + yc] + lum[xl + yu]);
      const dy = (lum[xl + yu] + 2 * lum[x + yu] + lum[xr + yu]) - (lum[xl + yd] + 2 * lum[x + yd] + lum[xr + yd]);
      let nx = -dx * k * 0.25, ny = -dy * k * 0.25;
      const l = Math.hypot(nx, ny, 1);
      nx /= l; ny /= l;
      const o = base + (x + yc) * 4, h = lum[x + yc];
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round(Math.min(1, Math.max(0.04, rough + (0.5 - h) * 0.22)) * 255);   // fundo das frestas mais fosco
      out[o + 3] = metal ? 255 : 0;
    }
  }
  return out;
}
