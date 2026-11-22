// LAVRA — leis da matéria solta. Código puro e determinístico (servidor, cliente offline e testes).
//
// Duas leis, as duas conservam a matéria (nenhum bloco some nem aparece):
//   · QUEDA: areia, cascalho, neve e cinza não se sustentam no ar. Tirou o apoio, caem em linha reta até pousar
//     (afundam na água, esmagam planta). A coluna de cima vem junto.
//   · DESLIZAMENTO: num desabamento, tudo o que é solo (também terra, relva e argila) escorrega até o barranco ficar
//     num ângulo que se sustenta: nenhum degrau de solo com mais de um bloco de altura. O que tem peso firme em cima
//     (pedra, tronco, parede) não se move: raiz e fundação seguram o chão.
// Quem decide QUANDO um barranco desaba é o diretor da natureza (server/nature.js, com o Jev); aqui está só o COMO.

import { B, KIND, SOLID, K_CROSS, K_LIQUID } from './blocks.js';
import { Y_TOP } from './constants.js';
// O fundo do plano vem do leitor (`get.fundo`: Y_MIN no plano de cima desde a profundidade em dobro, 0 nos outros; sem
// ele, 0, como sempre). "Chão firme" é a camada logo acima da rocha-mãe do fundo (era y ≤ 1).
const fundoDo = (get) => (Number.isInteger(get?.fundo) ? get.fundo : 0);

export const LOOSE = new Uint8Array(128);     // cai sozinho ao perder o apoio
LOOSE[B.SAND] = LOOSE[B.GRAVEL] = LOOSE[B.SNOW] = LOOSE[B.ASH] = 1;
export const SOIL = new Uint8Array(128);      // escorrega num desabamento
SOIL[B.SAND] = SOIL[B.GRAVEL] = SOIL[B.SNOW] = SOIL[B.ASH] = SOIL[B.DIRT] = SOIL[B.GRASS] = SOIL[B.CLAY] = 1;
const MATTER = { [B.GRASS]: B.DIRT };          // o que o bloco vira ao sair do lugar (relva arrancada é terra)

// um bloco em queda entra em ar, em água e por cima de planta rasteira
const open = (b) => b === B.AIR || (b > 0 && (KIND[b] === K_CROSS || KIND[b] === K_LIQUID));

// ---- queda -------------------------------------------------------------------------------------------------------
// Chamado depois que a célula (x, y, z) mudou. Devolve as mudanças que a lei impõe: [[x, y, z, bloco], ...].
// get(x, y, z) lê o mundo JÁ com a mudança que provocou a chamada. max limita quantos blocos caem de uma vez.
export function settleColumn(get, x, y, z, max = 96) {
  const done = new Map();                       // "y" -> bloco, só nesta coluna (a queda é sempre vertical)
  const at = (yy) => (done.has(yy) ? done.get(yy) : get(x, yy, z));
  const F = fundoDo(get);
  let moved = 0, yy = y;
  // Remove plantas (K_CROSS) que ficaram sem apoio sólido diretamente abaixo
  for (let py = Math.max(F + 1, y); py < Y_TOP && py <= y + 16; py++) {
    const b = at(py);
    if (b > 0 && KIND[b] === K_CROSS) {
      const below = at(py - 1);
      if (!(below > 0 && (SOLID[below] === 1 || KIND[below] === K_CROSS))) done.set(py, B.AIR);
    } else if (!open(b) && py > y) break;
  }
  // se a célula que mudou ficou vazia, sobe pelo vão (uma cratera pode ter vários blocos de altura) até achar matéria
  if (!LOOSE[at(yy)]) for (let i = 0; i < 16 && yy < Y_TOP - 1 && open(at(yy)); i++) yy++;
  // daí para cima, todo bloco solto sem apoio cai; o primeiro que estiver firme encerra a coluna
  for (; yy < Y_TOP - 1 && moved < max; yy++) {
    const b = at(yy);
    if (!LOOSE[b]) break;
    let land = yy;
    while (land > F + 1 && open(at(land - 1))) land--;
    if (land === yy) break;
    done.set(yy, B.AIR);
    done.set(land, b);
    const up = at(yy + 1);
    if (up > 0 && KIND[up] === K_CROSS) done.set(yy + 1, B.AIR);    // a planta que estava em cima perde o chão
    moved++;
  }
  const out = [];
  for (const [yy, id] of done) if (get(x, yy, z) !== id) out.push([x, yy, z, id]);
  return out.sort((a, b) => a[1] - b[1]);
}

const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const solidMatter = (b) => b > 0 && !open(b) && b !== B.BEDROCK && b !== B.PORTAL && b !== B.BALLOON;

// ---- colapso estrutural -------------------------------------------------------------------------------------------
// Nenhum material sólido pode ficar flutuando após a remoção de um apoio inferior.
// Se um bloco quebrado sustentava algo acima (ou conectado apenas por ele) sem outra conexão com o chão,
// todo o conjunto desconectado desmorona para cair por gravidade e se despedaçar no impacto.
export function crumbleUnsupported(get, x, y, z, max = 512) {
  const cache = new Map();
  const at = (cx, cy, cz) => {
    const k = `${cx},${cy},${cz}`;
    if (!cache.has(k)) cache.set(k, get(cx, cy, cz));
    return cache.get(k);
  };
  if (!open(at(x, y, z))) return [];
  const F = fundoDo(get);

  const seeds = [];
  for (let i = 1; i <= 16 && y + i < Y_TOP - 1; i++) {
    if (!open(at(x, y + i, z))) { seeds.push([x, y + i, z]); break; }
  }
  if (!open(at(x, y - 1, z))) {
    seeds.push(
      [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1],
      [x + 1, y + 1, z], [x - 1, y + 1, z], [x, y + 1, z + 1], [x, y + 1, z - 1],
    );
  }
  if (!seeds.length) return [];

  const done = new Map();
  const safe = new Set();
  for (const [sx, sy, sz] of seeds) {
    const sk = `${sx},${sy},${sz}`;
    if (done.has(sk) || safe.has(sk) || !solidMatter(at(sx, sy, sz))) continue;
    const seen = new Set([sk]);
    const queue = [[sx, sy, sz]];
    let anchored = false;
    for (let qi = 0; qi < queue.length; qi++) {
      const [cx, cy, cz] = queue[qi];
      if (cy <= F + 1 || queue.length > max) { anchored = true; break; }
      for (const [dx, dy, dz] of NB6) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        if (ny < F || ny >= Y_TOP) continue;
        const nb = at(nx, ny, nz);
        if (nb === -1 || nb === B.BEDROCK || nb === B.PORTAL || nb === B.BALLOON) { anchored = true; break; }
        if (!solidMatter(nb)) continue;
        const nk = `${nx},${ny},${nz}`;
        if (done.has(nk)) continue;
        if (safe.has(nk)) { anchored = true; break; }
        if (seen.has(nk)) continue;
        seen.add(nk);
        queue.push([nx, ny, nz]);
      }
      if (anchored) break;
    }
    if (anchored) {
      for (const k of seen) safe.add(k);
    } else {
      for (const [bx, by, bz] of queue) {
        done.set(`${bx},${by},${bz}`, [bx, by, bz, B.AIR]);
        const up = at(bx, by + 1, bz);
        if (up > 0 && KIND[up] === K_CROSS) done.set(`${bx},${by + 1},${bz}`, [bx, by + 1, bz, B.AIR]);
      }
    }
  }
  return [...done.values()].sort((a, b) => a[1] - b[1]);
}

// ---- deslizamento --------------------------------------------------------------------------------------------------
// Altura do barranco num ponto de chão: o maior desnível, a até 2 blocos de distância, entre este topo e o topo vizinho.
// surface(x, z) devolve o topo sólido da coluna. Serve para achar onde a encosta está mais perto de ceder.
export function cliffHeight(surface, x, z) {
  const h = surface(x, z);
  let drop = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const d = h - surface(x + dx, z + dz);
    if (d > drop) drop = d;
  }
  return drop;
}

// Desaba o solo em volta de (cx, cy, cz). Copia a região para uma grade, relaxa a grade (autômato de pilha de areia)
// e devolve a diferença: [[x, y, z, bloco], ...], no máximo `budget` blocos movidos.
// Nada sai da caixa de raio R: o que escorrega fica dentro dela. turn (inteiro) gira a preferência de direção, para
// dois desabamentos no mesmo lugar não escorrerem sempre para o mesmo lado.
export function collapse(get, cx, cy, cz, R = 5, budget = 300, turn = 0) {
  cx = Math.floor(cx); cy = Math.floor(cy); cz = Math.floor(cz);
  const W = 2 * R + 1, y0 = Math.max(fundoDo(get) + 1, cy - R - 6), y1 = Math.min(Y_TOP - 2, cy + R + 2), H = y1 - y0 + 1;
  const grid = new Uint8Array(W * W * H), orig = new Uint8Array(W * W * H);
  const idx = (i, j, k) => i + k * W + j * W * W;              // i = x, j = y, k = z dentro da caixa
  for (let j = 0; j < H; j++) for (let k = 0; k < W; k++) for (let i = 0; i < W; i++) {
    const b = get(cx - R + i, y0 + j, cz - R + k);
    grid[idx(i, j, k)] = orig[idx(i, j, k)] = b < 0 ? B.BEDROCK : b;      // pedaço de mundo desconhecido conta como rocha
  }
  const SIDE = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  // só o miolo redondo se solta; a borda da caixa segura como parede
  const inside = (i, k) => (i - R) * (i - R) + (k - R) * (k - R) <= R * R;
  let moved = 0;
  for (let pass = 0; pass < 48 && moved < budget; pass++) {
    let any = false;
    scan: for (let j = 1; j < H - 1; j++) {                                // de baixo para cima: a base sai, o de cima acompanha
      for (let k = 1; k < W - 1; k++) for (let i = 1; i < W - 1; i++) {
        if (moved >= budget) break scan;
        const c = idx(i, j, k), b = grid[c];
        if (!SOIL[b] || !inside(i, k)) continue;
        const up = grid[idx(i, j + 1, k)];
        // sobe pelo solo empilhado: se no topo da pilha há carga firme (pedra, tronco, parede), a pilha inteira está ancorada
        let a = j + 1;
        while (a < H - 1 && SOIL[grid[idx(i, a, k)]]) a++;
        if (!open(grid[idx(i, a, k)])) continue;
        let ti = i, tk = k, tj = j;
        if (open(grid[idx(i, j - 1, k)])) tj = j - 1;                      // sem apoio: cai
        else {
          // escorrega para um lado se ali houver um degrau de mais de um bloco (o lado e o de baixo dele livres)
          for (let s = 0; s < 4; s++) {
            const d = SIDE[(s + turn + i * 7 + k * 13 + pass) & 3], ni = i + d[0], nk = k + d[1];
            if (ni < 1 || nk < 1 || ni >= W - 1 || nk >= W - 1) continue;
            if (open(grid[idx(ni, j, nk)]) && open(grid[idx(ni, j - 1, nk)])) { ti = ni; tk = nk; tj = j - 1; break; }
          }
          if (tj === j) continue;
        }
        while (tj > 0 && open(grid[idx(ti, tj - 1, tk)])) tj--;            // e segue caindo até pousar
        if (tj === 0) continue;                                            // não há chão dentro da caixa: fica onde está
        grid[c] = B.AIR;
        grid[idx(ti, tj, tk)] = MATTER[b] || b;
        if (up > 0 && KIND[up] === K_CROSS) grid[idx(i, j + 1, k)] = B.AIR;
        moved++; any = true;
      }
    }
    if (!any) break;
  }
  const out = [];
  for (let j = 0; j < H; j++) for (let k = 0; k < W; k++) for (let i = 0; i < W; i++) {
    const c = idx(i, j, k);
    if (grid[c] !== orig[c]) out.push([cx - R + i, y0 + j, cz - R + k, grid[c]]);
  }
  return out;
}
