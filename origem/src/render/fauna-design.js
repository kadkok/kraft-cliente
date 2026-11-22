// Aparência apenas. Semente do grupo + índice: nunca sorteia nem decide comportamento.
export const FAUNA = Object.freeze({
  cardume: { capacity: 420, range: 68, roughness: .32, metalness: .14, colors: ['#5fa8d3', '#e8833a', '#f2c14e', '#91a79c', '#d95d74', '#6ec4a7'] },
  rebanho: { capacity: 96, range: 130, roughness: .88, metalness: .02, colors: ['#e8dfc8', '#c4a47c', '#8c6239', '#5c544d', '#d6b892', '#3d352e'] },
  bando: { capacity: 180, range: 115, roughness: .72, metalness: .04, colors: ['#3b6ea5', '#d94e34', '#e8b931', '#4a7c59', '#987352', '#e6e1d6'] },
  enxame: { capacity: 220, range: 42, roughness: .56, metalness: .06, colors: ['#f28c28', '#3a86ff', '#ffbe0b', '#ff5d8f', '#7ae582', '#e8dff5'] },
  ratos: { capacity: 64, range: 38, roughness: .84, metalness: .02, colors: ['#8e8170', '#6e665f', '#b09b7d', '#a4643b', '#d2c4b0'] },
  sapos: { capacity: 64, range: 40, roughness: .42, metalness: .08, colors: ['#588b47', '#758856', '#d4a024', '#3d7a68', '#8c6d46'] },
  palhaco: { capacity: 64, range: 72, roughness: .28, metalness: .08, glb: '/assets/fauna/palhaco.glb', motion: 'fish', flex: .32, colors: ['#f46b27', '#ff7b32', '#ea5b1b', '#f88f46', '#e05218'] },
  salmao: { capacity: 72, range: 90, roughness: .26, metalness: .16, glb: '/assets/fauna/salmao.glb', motion: 'fish', flex: .30, colors: ['#889aa4', '#9aaab2', '#7a8c98', '#a2b0b8', '#80949e'] },
  atum: { capacity: 48, range: 100, roughness: .22, metalness: .22, glb: '/assets/fauna/atum.glb', motion: 'fish', flex: .24, colors: ['#4a6c8a', '#3f5e7a', '#567a98', '#426480', '#507290'] },
  agulhao: { capacity: 24, range: 110, roughness: .22, metalness: .22, glb: '/assets/fauna/agulhao.glb', motion: 'fish', flex: .22, colors: ['#486f92', '#3d5f80', '#527ca0', '#446888', '#5b84a8'] },
  tubarao: { capacity: 16, range: 120, roughness: .34, metalness: .10, glb: '/assets/fauna/tubarao.glb', motion: 'fish', flex: .20, colors: ['#62707a', '#55636d', '#6e7c86', '#5c6a74', '#74828c'] },
  arraia: { capacity: 24, range: 105, roughness: .38, metalness: .06, glb: '/assets/fauna/arraia.glb', motion: 'ray', flex: .32, colors: ['#3a444d', '#444e58', '#2e3840', '#4e5862', '#343e46'] },
  tartaruga: { capacity: 24, range: 95, roughness: .52, metalness: .04, glb: '/assets/fauna/tartaruga.glb', motion: 'turtle', flex: .45, colors: ['#586b42', '#64764c', '#4e6039', '#6e7e54', '#54663f'] },
  golfinho: { capacity: 36, range: 115, roughness: .24, metalness: .10, glb: '/assets/fauna/golfinho.glb', motion: 'cetacean', flex: .26, colors: ['#6c8092', '#788c9e', '#607486', '#8296a8', '#687c8e'] },
  orca: { capacity: 16, range: 135, roughness: .24, metalness: .12, glb: '/assets/fauna/orca.glb', motion: 'cetacean', flex: .22, colors: ['#283038', '#303840', '#202830', '#384048', '#2c343c'] },
  baleia: { capacity: 8, range: 160, roughness: .32, metalness: .08, glb: '/assets/fauna/baleia.glb', motion: 'cetacean', flex: .16, colors: ['#486680', '#50708a', '#405e76', '#587892', '#44627c'] },
  polvo: { capacity: 16, range: 78, roughness: .46, metalness: .04, glb: '/assets/fauna/polvo.glb', motion: 'octopus', flex: .24, colors: ['#9c4a38', '#a85440', '#8e4030', '#b25e48', '#964636'] },
  aguaviva: { capacity: 48, range: 85, roughness: .18, metalness: .04, glb: '/assets/fauna/aguaviva.glb', motion: 'jelly', flex: .26, colors: ['#86b4d8', '#94c0e2', '#a2b0e0', '#8cb8dc', '#98c4e4'] },
});

export function faunaSeed(seed, index) {
  let h = ((seed | 0) ^ Math.imul((index | 0) + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ h >>> 16, 0x85ebca6b);
  h = Math.imul(h ^ h >>> 13, 0xc2b2ae35);
  return (h ^ h >>> 16) >>> 0;
}

export function faunaAppearance(kind, seed, index) {
  const h = faunaSeed(seed, index), spec = FAUNA[kind];
  return { variant: h % spec.colors.length, size: .88 + ((h >>> 8) & 255) / 255 * .15,
    warmth: .94 + ((h >>> 16) & 255) / 255 * .12 };
}

// Atlas autoral 4×4, 256px RGBA; detalhes com contraste baixo e mipmaps no destino.
// 0 pelo, 1 pena, 2 asa de borboleta, 3 escama, 4 pele de sapo, 5 lã, 6 liso, 7 pele nua.
export function faunaAtlas(size = 256) {
  const data = new Uint8Array(size * size * 4), tile = size / 4;
  const clamp = x => Math.max(0, Math.min(1, x));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const tx = x % tile, ty = y % tile, u = (tx + .5) / tile, v = (ty + .5) / tile;
    const cell = Math.floor(x / tile) + Math.floor(y / tile) * 4;
    const noise = (faunaSeed(x, y) & 255) / 255;
    let shade = 1;
    if (cell === 0) shade = .84 + .10 * noise + .055 * Math.sin((u * 29 + v * 3) * 6.283);
    if (cell === 1) {
      const ribs = Math.abs(Math.sin((v * 11 + Math.abs(u - .5) * 5) * 6.283));
      shade = .94 + .045 * ribs + .015 * noise;
    }
    if (cell === 2) {
      const a = Math.atan2(v - .44, u * 1.1), r = Math.hypot(u * .88, (v - .46) * 1.1);
      const veins = Math.abs(Math.sin(a * 15 + r * 2.4));
      shade = veins < .10 || r > .86 ? .16 : .84 + .14 * noise;
      const dots = Math.abs(Math.sin(a * 19));
      if (r > .75 && r < .82 && dots > .91) shade = 1;
    }
    if (cell === 3) {
      const row = Math.floor(v * 10), qx = ((u * 10 + (row % 2) * .5) % 1) - .5;
      const qy = (v * 10) % 1;
      shade = .92 + .065 * clamp(1 - Math.abs(qy - .25 - qx * qx) * 2.1) + .015 * noise;
    }
    if (cell === 4) {
      const a = Math.sin(u * 38 + Math.sin(v * 19) * 3) * Math.cos(v * 31 + Math.sin(u * 13));
      shade = a > .72 ? .62 + .13 * noise : .92 + .07 * noise;
    }
    if (cell === 5) {
      const qx = ((u * 8 + Math.floor(v * 8) % 2 * .5) % 1) - .5, qy = (v * 8) % 1 - .5;
      shade = .91 + .075 * clamp(1 - Math.hypot(qx, qy) * 1.35) + .015 * noise;
    }
    if (cell === 7) shade = .92 + .07 * noise;
    const n = (x + y * size) * 4, c = Math.round(clamp(shade) * 255);
    data[n] = data[n + 1] = data[n + 2] = c; data[n + 3] = 255;
  }
  return data;
}
