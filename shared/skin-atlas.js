// Kraft — o atlas de skin no formato compatível com o do Minecraft (64×64, camada de dentro e de fora, braços
// clássicos de 4 px ou finos de 3 px). Só lógica pura, sem DOM nem three: serve ao aparelho (estúdio, pintor,
// avatar) e ao servidor (conferência do PNG enviado). `render/skin-layout.js` reexporta daqui.

export const SKIN_UNIT = 1.8 / 32;
export const SKINS_JOGO = ['explorador', 'botanica', 'mineiro'];   // skins originais do jogo (public/assets/skin/)
export const SKIN_PNG_MAX = 1024 * 1024;                           // 1 MB: um 1024×1024 bem comprimido cabe folgado
export const NOMES_PARTES = { head: 'Cabeça', torso: 'Tronco', armR: 'Braço direito', armL: 'Braço esquerdo', legR: 'Perna direita', legL: 'Perna esquerda' };
export const NOMES_FACES = ['lado direito', 'lado esquerdo', 'topo', 'base', 'costas', 'frente'];

export function skinParts(slim = false) {
  const a = slim ? 3 : 4;
  return [
    { name: 'torso', bone: 0, size: [8, 12, 4], at: [0, 18, 0], base: [16, 16], outer: [16, 32] },
    { name: 'head', bone: 1, size: [8, 8, 8], at: [0, 28, 0], base: [0, 0], outer: [32, 0] },
    { name: 'armL', bone: 2, size: [a, 12, 4], at: [-4 - a / 2, 18, 0], base: [32, 48], outer: [48, 48] },
    { name: 'armR', bone: 3, size: [a, 12, 4], at: [4 + a / 2, 18, 0], base: [40, 16], outer: [40, 32] },
    { name: 'legL', bone: 4, size: [4, 12, 4], at: [-2, 6, 0], base: [16, 48], outer: [0, 48] },
    { name: 'legR', bone: 5, size: [4, 12, 4], at: [2, 6, 0], base: [0, 16], outer: [0, 32] },
  ];
}
// Ordem BoxGeometry: direita, esquerda, topo, fundo, costas, frente (-Z).
export function skinRects([w, h, d], [x, y]) {
  return [[x, y + d, d, h], [x + d + w, y + d, d, h], [x + d, y, w, d], [x + d + w, y, w, d], [x + 2 * d + w, y + d, w, h], [x + d, y + d, w, h]];
}
export function skinPivots(slim = false) {
  const a = slim ? 3 : 4;
  return [[0, 0, 0], [0, 24, 0], [-4 - a / 2, 24, 0], [4 + a / 2, 24, 0], [-2, 12, 0], [2, 12, 0]].map((p) => p.map((x) => x * SKIN_UNIT));
}

// Mapa 64×64 → { parte, camada, face, rect } (null fora das regiões usadas). Guardado por slim.
const mapas = new Map();
function mapa(slim) {
  const k = slim ? 1 : 0;
  if (mapas.has(k)) return mapas.get(k);
  const m = new Array(64 * 64).fill(null);
  for (const part of skinParts(slim)) for (const [camada, at] of [['dentro', part.base], ['fora', part.outer]]) {
    skinRects(part.size, at).forEach((rect, face) => {
      const [x, y, w, h] = rect;
      const reg = { parte: part.name, camada, face, rect };
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) m[yy * 64 + xx] = reg;
    });
  }
  mapas.set(k, m);
  return m;
}
export function regiaoDe(x, y, slim = false) {
  if (!(x >= 0 && x < 64 && y >= 0 && y < 64)) return null;
  return mapa(slim)[(y | 0) * 64 + (x | 0)];
}
export function regioes(slim = false) {
  const out = [];
  for (const part of skinParts(slim)) for (const [camada, at] of [['dentro', part.base], ['fora', part.outer]]) {
    skinRects(part.size, at).forEach((rect, face) => out.push({ parte: part.name, camada, face, rect }));
  }
  return out;
}

// Espelho esquerdo ↔ direito (plano x = 0 do boneco): cabeça e tronco espelham neles mesmos, braço e perna
// trocam de lado. Faces laterais trocam entre si (0 ↔ 1) e tudo inverte na horizontal — a mesma regra da
// conversão do formato antigo 64×32. Devolve [x, y] ou null fora das regiões.
const PAR = { head: 'head', torso: 'torso', armL: 'armR', armR: 'armL', legL: 'legR', legR: 'legL' };
export function espelho(x, y, slim = false) {
  const r = regiaoDe(x, y, slim);
  if (!r) return null;
  const part = skinParts(slim).find((p) => p.name === PAR[r.parte]);
  const face = r.face === 0 ? 1 : r.face === 1 ? 0 : r.face;
  const [tx, ty, tw] = skinRects(part.size, r.camada === 'dentro' ? part.base : part.outer)[face];
  const lx = (x | 0) - r.rect[0], ly = (y | 0) - r.rect[1];
  return [tx + tw - 1 - lx, ty + ly];
}
// Copia uma parte inteira para a do outro lado, espelhada (braço/perna direito → esquerdo ou o contrário).
export function copiarLado(rgba, de = 'R', slim = false) {
  const out = new Uint8ClampedArray(rgba);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const r = regiaoDe(x, y, slim);
    if (!r || !(r.parte === 'arm' + de || r.parte === 'leg' + de)) continue;
    const m = espelho(x, y, slim);
    const s = (y * 64 + x) * 4, d = (m[1] * 64 + m[0]) * 4;
    for (let k = 0; k < 4; k++) out[d + k] = rgba[s + k];
  }
  return out;
}

// Balde: enche a área da mesma cor ligada pelos 4 lados, sem sair da face em que começou (não vaza para outra parte).
export function preencher(rgba, x, y, cor, slim = false) {
  const r = regiaoDe(x, y, slim);
  if (!r) return 0;
  const [rx, ry, rw, rh] = r.rect;
  const at = (xx, yy) => (yy * 64 + xx) * 4;
  const i0 = at(x | 0, y | 0);
  const alvo = [rgba[i0], rgba[i0 + 1], rgba[i0 + 2], rgba[i0 + 3]];
  if (alvo.every((v, k) => v === cor[k])) return 0;
  const igual = (i) => rgba[i] === alvo[0] && rgba[i + 1] === alvo[1] && rgba[i + 2] === alvo[2] && rgba[i + 3] === alvo[3];
  const pilha = [[x | 0, y | 0]];
  let n = 0;
  while (pilha.length) {
    const [px, py] = pilha.pop();
    if (px < rx || py < ry || px >= rx + rw || py >= ry + rh) continue;
    const i = at(px, py);
    if (!igual(i)) continue;
    rgba[i] = cor[0]; rgba[i + 1] = cor[1]; rgba[i + 2] = cor[2]; rgba[i + 3] = cor[3];
    n++;
    pilha.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  return n;
}

// Braços finos: no formato de 64 px, a coluna de 2 px que sobra atrás do braço direito (x 54–55, y 20–31)
// fica transparente numa skin de braços finos. Funciona em qualquer múltiplo de 64.
export function detectarBracoFino(width, height, rgba) {
  if (width < 64 || height !== width) return false;
  const s = width / 64;
  for (let y = 20 * s; y < 32 * s; y++) for (let x = 54 * s; x < 56 * s; x++) if (rgba[(y * width + x) * 4 + 3] > 0) return false;
  return true;
}

// Tamanho aceito na entrada: lado de 64 a 1024 em múltiplos de 64, quadrado ou o formato antigo (altura = metade).
export function dimensaoEntradaOk(w, h) {
  return Number.isInteger(w) && w >= 64 && w <= 1024 && w % 64 === 0 && (h === w || h === w / 2);
}
// O que vai para o servidor é sempre quadrado (o aparelho converte o formato antigo antes de enviar).
export function dimensaoSkinOk(w, h) { return dimensaoEntradaOk(w, h) && h === w; }

// Lê largura e altura do cabeçalho de um PNG (assinatura + bloco IHDR). Devolve null se não for PNG.
export function cabecalhoPng(buf) {
  if (!buf || buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  if (String.fromCharCode(buf[12], buf[13], buf[14], buf[15]) !== 'IHDR') return null;
  const u32 = (o) => ((buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3]) >>> 0;
  return { w: u32(16), h: u32(20) };
}
// Conferência do servidor para um PNG de skin: tipo, tamanho em bytes e dimensões.
export function conferirSkinPng(buf) {
  if (!buf || buf.length > SKIN_PNG_MAX) return 'A skin passa de 1 MB.';
  const c = cabecalhoPng(buf);
  if (!c) return 'A skin precisa ser um arquivo PNG.';
  if (!dimensaoSkinOk(c.w, c.h)) return 'Skin fora do padrão: use 64×64 (ou 64×32 antigo) ou HD em múltiplos de 64 até 1024.';
  return null;
}

// Converte o formato antigo (64×32) para o quadrado e deixa a camada de dentro opaca (a transparência é da de fora).
export function normalizeSkinPixels(width, height, rgba) {
  if (!dimensaoEntradaOk(width, height) || rgba.length !== width * height * 4) throw Error('Use PNG no padrão 64×64 (ou o antigo 64×32), até 1024 px. A skin Kraft usa 640×640.');
  const scale = width / 64, out = new Uint8ClampedArray(width * width * 4);
  out.set(rgba);
  if (height === width / 2) {
    // Copia pernas e braços direitos para os esquerdos, espelhando as faces.
    for (const [from, to] of [[[0, 16], [16, 48]], [[40, 16], [32, 48]]]) {
      const a = skinRects([4, 12, 4], from), b = skinRects([4, 12, 4], to);
      for (let face = 0; face < 6; face++) {
        const [sx, sy, w, h] = a[face === 0 ? 1 : face === 1 ? 0 : face].map((v) => v * scale), [dx, dy] = b[face].map((v) => v * scale);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(rgba.subarray(((sy + y) * width + sx + w - 1 - x) * 4, ((sy + y) * width + sx + w - x) * 4), ((dy + y) * width + dx + x) * 4);
      }
    }
  }
  for (const part of skinParts(false)) for (const rect of skinRects(part.size, part.base)) {
    const [x, y, w, h] = rect.map((v) => v * scale);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) out[(yy * width + xx) * 4 + 3] = 255;
  }
  return out;
}

// Reduz um atlas quadrado de qualquer múltiplo de 64 para 64×64: média de cada bloco (cor pesada pela opacidade);
// a opacidade vira 0 ou 255 (corte em 50%), como o formato espera.
export function reduzirPara64(width, rgba) {
  const s = width / 64, out = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
      const i = ((y * s + yy) * width + x * s + xx) * 4, al = rgba[i + 3];
      r += rgba[i] * al; g += rgba[i + 1] * al; b += rgba[i + 2] * al; a += al;
    }
    const o = (y * 64 + x) * 4;
    if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
    out[o + 3] = a / (s * s) >= 128 ? 255 : 0;
  }
  return out;
}
